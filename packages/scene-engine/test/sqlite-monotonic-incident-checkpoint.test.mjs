import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync }, fn);

import { createInProcessExclusiveLockProvider } from "../src/exclusive-operation-lock.mjs";
import { SqliteOfficeIncidentStore } from "../src/sqlite-office-incident-store.mjs";
import { SqliteMonotonicCheckpointJournal } from "../src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../src/sqlite-monotonic-checkpoint.mjs";
import { MonotonicIncidentWriter } from "../src/monotonic-incident-writer.mjs";

const installationId = "officekit-monotonic-incident-01";
const cryptoProvider = Object.freeze({
  sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
  randomUUID
});
const macKey = Buffer.alloc(32, 0x41);
const macProvider = Object.freeze({
  keyId: "test-incident-mac-v1",
  hmacSha256Hex: value => createHmac("sha256", macKey).update(value, "utf8").digest("hex")
});

function adapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec("BEGIN " + mode);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}

function openDatabase(filename = ":memory:") {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  return { database, adapter: adapter(database) };
}

function incident(id) {
  return {
    schemaVersion: 1, id, occurredAt: "2026-11-13T12:00:00.000Z",
    edition: "universal", status: "degraded", origin: "transport",
    confidence: "probable", diagnostics: [{ probeId: "observer", ok: false, evidence: "timeout" }],
    recoveryAttempts: [], outcome: "unresolved"
  };
}

function point(generation, sequence, eventHash = null, eventMac = null) {
  return { installationId, generation, sequence, eventHash, eventMac, protocolVersion: 1 };
}

function anchorFixture(initial = point(0, 0)) {
  let state = { status: "protected", installationId, anchorId: "test-only-fake-anchor", checkpoint: structuredClone(initial) };
  return {
    provider: {
      async capabilities() {
        return {
          hardwareBacked: true, rollbackResistant: true,
          atomicCompareAndAdvance: true, durableAcrossRestart: true,
          scope: "test-only-fake"
        };
      },
      async read() { return structuredClone(state); },
      async advance(expected, next) {
        if (JSON.stringify(state.checkpoint) !== JSON.stringify(expected)) throw new Error("fake_anchor_compare_failed");
        state.checkpoint = structuredClone(next);
        return { status: "protected", installationId };
      }
    },
    read: () => structuredClone(state)
  };
}

function createStore(database, lock) {
  const store = new SqliteOfficeIncidentStore({
    database, installationId, cryptoProvider, requireMac: true, writeLockProvider: lock
  });
  store.configureMacProvider(macProvider);
  return store;
}

function createJournal(database, lock, store, applyPreparedPayload) {
  return new SqliteMonotonicCheckpointJournal({
    database, installationId, lockProvider: lock, makeId: randomUUID,
    applyPreparedPayload: applyPreparedPayload ?? ((payload, checkpoint) => (
      store.applyPreparedMonotonicPayload(payload, checkpoint)
    ))
  });
}

function transitionFromPayload(expected, payload) {
  return {
    next: {
      ...expected, generation: expected.generation + 1,
      sequence: payload.sequence, eventHash: payload.eventHash, eventMac: payload.eventMac
    },
    payload
  };
}

async function stageAppend(journal, store, id) {
  let staged;
  await journal.withExclusiveLock(async () => {
    const expected = await journal.readCheckpoint();
    const payload = store.prepareMonotonicAppend(incident(id));
    staged = { expected, ...transitionFromPayload(expected, payload) };
    await journal.prepareCheckpoint(staged);
  });
  return staged;
}

sqliteTest("commits an incident event, HMAC and checkpoint metadata in one finalization transaction", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const anchor = anchorFixture();
    const coordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor.provider, journal, installationId });
    const result = await coordinator.commit({
      prepareTransition: ({ expected }) => {
        const payload = store.prepareMonotonicAppend(incident("incident-anchored-001"));
        return transitionFromPayload(expected, payload);
      }
    });
    assert.equal(result.status, "protected");
    assert.equal(result.checkpoint.sequence, 1);
    assert.equal((await store.get("incident-anchored-001")).revision, 1);
    assert.equal(store.verifyIntegrity().eventCount, 1);
    assert.equal(await journal.readPreparedCheckpoint(), null);
    assert.deepEqual(await journal.readCheckpoint(), result.checkpoint);
    assert.deepEqual(anchor.read().checkpoint, result.checkpoint);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("recovery finalizes the prepared incident after the external anchor advanced", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-anchored-recovery-"));
  const filename = join(directory, "journal.sqlite");
  let opened = openDatabase(filename);
  let lock = createInProcessExclusiveLockProvider();
  let store = createStore(opened.adapter, lock);
  let journal = createJournal(opened.adapter, lock, store);
  const anchor = anchorFixture();
  try {
    const staged = await stageAppend(journal, store, "incident-anchored-recovery");
    await anchor.provider.advance(staged.expected, staged.next);
    await lock.close();
    opened.database.close();

    opened = openDatabase(filename);
    lock = createInProcessExclusiveLockProvider();
    store = createStore(opened.adapter, lock);
    journal = createJournal(opened.adapter, lock, store);
    const coordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor.provider, journal, installationId });
    const recovered = await coordinator.recover();
    assert.equal(recovered.recovered, "finalized");
    assert.equal(recovered.checkpoint.sequence, 1);
    assert.equal((await store.get("incident-anchored-recovery")).revision, 1);
    assert.equal(store.verifyIntegrity().eventCount, 1);
    await lock.close();
  } finally {
    try { await lock.close(); } catch {}
    try { opened.database.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
    macKey.fill(0);
  }
});

sqliteTest("recovery discards a prepared incident when the external anchor stayed at its predecessor", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const anchor = anchorFixture();
    const staged = await stageAppend(journal, store, "incident-uncommitted-prepare");
    const coordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor.provider, journal, installationId });
    const recovered = await coordinator.recover();
    assert.equal(recovered.recovered, "discarded_uncommitted_prepare");
    assert.equal(await store.get("incident-uncommitted-prepare"), null);
    assert.equal(store.verifyIntegrity().eventCount, 0);
    assert.deepEqual(await journal.readCheckpoint(), staged.expected);
    assert.equal(await journal.readPreparedCheckpoint(), null);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("rolls back event rows and checkpoint metadata together when finalization fails", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const failingJournal = createJournal(opened.adapter, lock, store, (payload, checkpoint) => {
      store.applyPreparedMonotonicAppend(payload, checkpoint);
      throw new Error("forced_finalize_failure");
    });
    const anchor = anchorFixture();
    const failingCoordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor.provider, journal: failingJournal, installationId });
    await assert.rejects(failingCoordinator.commit({
      prepareTransition: ({ expected }) => {
        const payload = store.prepareMonotonicAppend(incident("incident-finalize-rollback"));
        return transitionFromPayload(expected, payload);
      }
    }), /forced_finalize_failure/);

    assert.equal(await store.get("incident-finalize-rollback"), null);
    assert.equal(store.verifyIntegrity().eventCount, 0);
    assert.equal((await failingJournal.readCheckpoint()).sequence, 0);
    assert.ok(await failingJournal.readPreparedCheckpoint());

    const recoveryJournal = createJournal(opened.adapter, lock, store);
    const recoveryCoordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor.provider, journal: recoveryJournal, installationId });
    const recovered = await recoveryCoordinator.recover();
    assert.equal(recovered.recovered, "finalized");
    assert.equal((await store.get("incident-finalize-rollback")).revision, 1);
    assert.equal(store.verifyIntegrity().eventCount, 1);
    assert.equal(await recoveryJournal.readPreparedCheckpoint(), null);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("rejects a checkpoint whose event hash differs from its prepared append", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const payload = store.prepareMonotonicAppend(incident("incident-mismatch"));
    const expected = await journal.readCheckpoint();
    const transition = transitionFromPayload(expected, payload);
    await assert.rejects(journal.prepareCheckpoint({
      expected, next: { ...transition.next, eventHash: "f".repeat(64) }, payload
    }), /sqlite_monotonic_event_payload_mismatch/);
    assert.equal(await journal.readPreparedCheckpoint(), null);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});


sqliteTest("rejects sequence advancement without an incident append payload", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const expected = await journal.readCheckpoint();
    await assert.rejects(journal.prepareCheckpoint({
      expected,
      next: point(expected.generation + 1, 1, "a".repeat(64), "b".repeat(64)),
      payload: null
    }), /sqlite_monotonic_incident_payload_required/);
    assert.equal(await journal.readPreparedCheckpoint(), null);
    assert.equal((await journal.readCheckpoint()).sequence, 0);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("fails closed if a prepared incident payload is removed before finalization", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const expected = await journal.readCheckpoint();
    const payload = store.prepareMonotonicAppend(incident("incident-tampered-prepare"));
    const transition = transitionFromPayload(expected, payload);
    const prepared = await journal.prepareCheckpoint({ expected, ...transition });

    opened.database.prepare(
      "UPDATE office_kit_monotonic_prepares SET payload_json = ? WHERE installation_id = ?"
    ).run("null", installationId);

    await assert.rejects(journal.finalizeCheckpoint(prepared), /sqlite_monotonic_incident_payload_required/);
    assert.equal(await store.get("incident-tampered-prepare"), null);
    assert.equal((await journal.readCheckpoint()).sequence, 0);
    assert.ok(await journal.readPreparedCheckpoint());
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});


sqliteTest("routes incident creation and updates through the monotonic checkpoint coordinator", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const anchor = anchorFixture();
    const coordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: anchor.provider, journal, installationId
    });
    const writer = new MonotonicIncidentWriter({ incidentStore: store, coordinator });

    const id = await writer.append(incident("incident-anchored-writer-001"));
    assert.equal(id, "incident-anchored-writer-001");
    assert.equal((await store.get(id)).revision, 1);

    const updatedId = await writer.update(id, { status: "resolved", outcome: "fixed" });
    assert.equal(updatedId, id);
    const snapshot = await store.get(id);
    assert.equal(snapshot.revision, 2);
    assert.equal(snapshot.status, "resolved");
    assert.equal(snapshot.outcome, "fixed");

    const events = store.listEvents();
    assert.deepEqual(events.map(event => event.eventType), ["incident.created", "incident.updated"]);
    assert.deepEqual(events.map(event => event.revision), [1, 2]);
    const integrity = store.verifyIntegrity();
    assert.equal(integrity.eventCount, 2);

    const checkpoint = await journal.readCheckpoint();
    assert.equal(checkpoint.sequence, 2);
    assert.equal(checkpoint.eventHash, integrity.headHash);
    assert.deepEqual(anchor.read().checkpoint, checkpoint);
    assert.equal(await journal.readPreparedCheckpoint(), null);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("rejects an anchored incident write when the provider is unsupported", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const anchor = anchorFixture();
    anchor.provider.read = async () => ({ status: "unsupported" });
    const coordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: anchor.provider, journal, installationId
    });
    const writer = new MonotonicIncidentWriter({ incidentStore: store, coordinator });

    await assert.rejects(
      writer.append(incident("incident-unsupported-anchor")),
      /monotonic_anchor_not_protected/
    );
    assert.equal(await store.get("incident-unsupported-anchor"), null);
    assert.equal(await journal.readPreparedCheckpoint(), null);
    assert.equal((await journal.readCheckpoint()).sequence, 0);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});

sqliteTest("binds an anchored update to the exact predecessor snapshot", async () => {
  const opened = openDatabase();
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const anchor = anchorFixture();
    const coordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: anchor.provider, journal, installationId
    });
    const writer = new MonotonicIncidentWriter({ incidentStore: store, coordinator });
    const id = await writer.append(incident("incident-update-predecessor"));
    const expected = await journal.readCheckpoint();
    const payload = store.prepareMonotonicUpdate(id, { status: "resolved" });
    const tampered = { ...payload, previousSnapshotHash: "f".repeat(64) };
    const checkpoint = {
      ...expected,
      generation: expected.generation + 1,
      sequence: tampered.sequence,
      eventHash: tampered.eventHash,
      eventMac: tampered.eventMac
    };

    assert.throws(
      () => store.applyPreparedMonotonicUpdate(tampered, checkpoint),
      /incident_monotonic_update_predecessor_mismatch/
    );
    assert.equal((await store.get(id)).revision, 1);
    assert.equal(store.verifyIntegrity().eventCount, 1);
    assert.equal((await journal.readCheckpoint()).sequence, 1);
  } finally {
    await lock.close();
    opened.database.close();
    macKey.fill(0);
  }
});
