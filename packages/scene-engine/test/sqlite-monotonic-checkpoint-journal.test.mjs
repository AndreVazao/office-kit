import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteMonotonicCheckpointJournal } from "../src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../src/sqlite-monotonic-checkpoint.mjs";

const installationId = "officekit-sqlite-checkpoint-01";
const hash = value => value.repeat(64);
const point = (generation, sequence, marker = "a") => ({
  installationId, generation, sequence,
  eventHash: sequence === 0 ? null : hash(marker),
  eventMac: sequence === 0 ? null : hash(marker),
  protocolVersion: 1
});

function openDatabase(filename) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
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
  return {
    database,
    adapter: { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction }
  };
}

function lockProvider() {
  let busy = false;
  return {
    async acquire() {
      if (busy) throw new Error("test_lock_busy");
      busy = true;
      let released = false;
      return { async release() {
        if (released) throw new Error("test_lock_double_release");
        released = true;
        busy = false;
      } };
    }
  };
}

function anchorFixture(initial = point(0, 0)) {
  let checkpoint = structuredClone(initial);
  const provider = {
    async capabilities() {
      return {
        hardwareBacked: true, rollbackResistant: true,
        atomicCompareAndAdvance: true, durableAcrossRestart: true,
        scope: "fake-test-only"
      };
    },
    async read() {
      return { status: "protected", installationId, anchorId: "fake-only", checkpoint: structuredClone(checkpoint) };
    },
    async advance(expected, next) {
      if (JSON.stringify(checkpoint) !== JSON.stringify(expected)) throw new Error("anchor_compare_failed");
      checkpoint = structuredClone(next);
      return { status: "protected", installationId };
    }
  };
  return { provider, read: () => structuredClone(checkpoint) };
}

test("persists prepared and finalized checkpoints across SQLite reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-monotonic-sqlite-"));
  const filename = join(directory, "journal.sqlite");
  const lock = lockProvider();
  try {
    let opened = openDatabase(filename);
    let journal = new SqliteMonotonicCheckpointJournal({
      database: opened.adapter, installationId, lockProvider: lock, makeId: () => "prepare-one"
    });
    const expected = point(0, 0);
    const next = point(1, 1, "b");
    const record = await journal.prepareCheckpoint({ expected, next, payload: { kind: "test-event" } });
    assert.equal(record.id, "prepare-one");
    assert.deepEqual(await journal.readPreparedCheckpoint(), record);
    opened.database.close();

    opened = openDatabase(filename);
    journal = new SqliteMonotonicCheckpointJournal({ database: opened.adapter, installationId, lockProvider: lock });
    assert.deepEqual(await journal.readPreparedCheckpoint(), record);
    await journal.finalizeCheckpoint(record);
    assert.deepEqual(await journal.readCheckpoint(), next);
    assert.equal(await journal.readPreparedCheckpoint(), null);
    await journal.finalizeCheckpoint(record);
    assert.deepEqual(await journal.readCheckpoint(), next);
    opened.database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("coordinates a real SQLite checkpoint journal with a fake anchor and recovers a committed anchor after reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-monotonic-recovery-"));
  const filename = join(directory, "journal.sqlite");
  const lock = lockProvider();
  const anchor = anchorFixture();
  try {
    let opened = openDatabase(filename);
    let journal = new SqliteMonotonicCheckpointJournal({
      database: opened.adapter, installationId, lockProvider: lock, makeId: () => "prepare-recovery"
    });
    const coordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: anchor.provider, journal, installationId
    });
    const target = point(1, 1, "c");
    const committed = await coordinator.commit({ next: target, payload: { eventId: "event-1" } });
    assert.equal(committed.rollbackProtection, "protected");
    assert.deepEqual(await journal.readCheckpoint(), target);
    opened.database.close();

    opened = openDatabase(filename);
    journal = new SqliteMonotonicCheckpointJournal({ database: opened.adapter, installationId, lockProvider: lock });
    const recoveredCoordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: anchor.provider, journal, installationId
    });
    const recovered = await recoveredCoordinator.recover();
    assert.equal(recovered.status, "protected");
    assert.deepEqual(recovered.checkpoint, target);
    opened.database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retains a prepared checkpoint and rejects duplicate prepares or unrelated discard", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-monotonic-mismatch-"));
  const filename = join(directory, "journal.sqlite");
  const lock = lockProvider();
  try {
    const opened = openDatabase(filename);
    const journal = new SqliteMonotonicCheckpointJournal({
      database: opened.adapter, installationId, lockProvider: lock, makeId: () => "prepare-mismatch"
    });
    const expected = point(0, 0);
    const next = point(1, 1, "d");
    const record = await journal.prepareCheckpoint({ expected, next });
    await assert.rejects(
      journal.prepareCheckpoint({ expected, next: point(1, 2, "e") }),
      /sqlite_monotonic_prepare_already_exists/
    );
    await assert.rejects(journal.discardPreparedCheckpoint("wrong-id"), /sqlite_monotonic_prepare_missing/);
    assert.equal((await journal.readPreparedCheckpoint()).id, record.id);
    opened.database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
