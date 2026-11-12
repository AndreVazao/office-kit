import test from "node:test";
import assert from "node:assert/strict";
import { SqliteMonotonicCheckpointCoordinator } from "../src/sqlite-monotonic-checkpoint.mjs";

const installationId = "officekit-checkpoint-test-001";
const hash = marker => marker.repeat(64);

function point(generation, sequence, marker = "a") {
  return {
    installationId,
    generation,
    sequence,
    eventHash: sequence === 0 ? null : hash(marker),
    eventMac: sequence === 0 ? null : hash(marker),
    protocolVersion: 1
  };
}

function providerFixture(initial = point(0, 0)) {
  let state = {
    status: "protected",
    installationId,
    anchorId: "fake-anchor",
    checkpoint: structuredClone(initial)
  };
  const provider = {
    capabilities: async () => ({
      hardwareBacked: true,
      rollbackResistant: true,
      atomicCompareAndAdvance: true,
      durableAcrossRestart: true,
      scope: "test-only-fake"
    }),
    read: async () => structuredClone(state),
    advance: async (expected, next) => {
      if (state.status !== "protected"
        || JSON.stringify(state.checkpoint) !== JSON.stringify(expected)) {
        throw new Error("fake_compare_failed");
      }
      state.checkpoint = structuredClone(next);
      return { status: "protected", installationId };
    }
  };
  return {
    provider,
    read: () => structuredClone(state),
    set: next => { state = structuredClone(next); }
  };
}

function journalFixture(initial = point(0, 0)) {
  let local = structuredClone(initial);
  let prepared = null;
  let serial = 0;
  let locked = false;
  const journal = {
    async withExclusiveLock(operation) {
      if (locked) throw new Error("fake_lock_busy");
      locked = true;
      try { return await operation(); }
      finally { locked = false; }
    },
    async readCheckpoint() { return structuredClone(local); },
    async readPreparedCheckpoint() { return structuredClone(prepared); },
    async prepareCheckpoint(record) {
      if (prepared) throw new Error("fake_prepare_exists");
      prepared = { id: `prepare-${++serial}`, ...structuredClone(record) };
      return structuredClone(prepared);
    },
    async finalizeCheckpoint(record) {
      if (!prepared || prepared.id !== record.id) throw new Error("fake_prepare_missing");
      local = structuredClone(prepared.next);
      prepared = null;
    },
    async discardPreparedCheckpoint(id) {
      if (prepared?.id !== id) throw new Error("fake_prepare_missing");
      prepared = null;
    }
  };
  return {
    journal,
    read: () => ({ local: structuredClone(local), prepared: structuredClone(prepared) }),
    stage: async (next, payload = {}) => journal.prepareCheckpoint({
      expected: structuredClone(local), next: structuredClone(next), payload
    })
  };
}

test("commits prepare, external anchor, then journal finalization", async () => {
  const anchor = providerFixture();
  const storage = journalFixture();
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  const target = point(1, 1, "b");
  const result = await coordinator.commit({ next: target, payload: { eventId: "event-1" } });
  assert.equal(result.status, "protected");
  assert.deepEqual(result.checkpoint, target);
  assert.deepEqual(storage.read(), { local: target, prepared: null });
  assert.deepEqual(anchor.read().checkpoint, target);
});

test("recovers a crash after anchor advance and before SQLite finalization", async () => {
  const anchor = providerFixture();
  const storage = journalFixture();
  const target = point(1, 1, "b");
  const prepared = await storage.stage(target, { eventId: "event-crash" });
  await anchor.provider.advance(point(0, 0), target);
  assert.ok(prepared.id);
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  const result = await coordinator.recover();
  assert.equal(result.recovered, "finalized");
  assert.deepEqual(storage.read(), { local: target, prepared: null });
});

test("discards a durable prepare when the anchor was not advanced", async () => {
  const anchor = providerFixture();
  const storage = journalFixture();
  await storage.stage(point(1, 1, "b"));
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  const result = await coordinator.recover();
  assert.equal(result.recovered, "discarded_uncommitted_prepare");
  assert.deepEqual(storage.read(), { local: point(0, 0), prepared: null });
});

test("fails closed when anchor and prepared journal state disagree", async () => {
  const anchor = providerFixture(point(4, 8, "d"));
  const storage = journalFixture(point(3, 7, "c"));
  await storage.stage(point(4, 8, "d"));
  anchor.set({
    status: "protected", installationId, anchorId: "fake-anchor",
    checkpoint: point(5, 9, "e")
  });
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  await assert.rejects(coordinator.recover(), /monotonic_anchor_mismatch/);
  assert.ok(storage.read().prepared);
});

test("does not report software or unsupported state as protected", async () => {
  const anchor = providerFixture();
  anchor.set({ status: "unsupported" });
  const storage = journalFixture();
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  const state = await coordinator.recover();
  assert.equal(state.status, "unsupported");
  await assert.rejects(
    coordinator.commit({ next: point(1, 1, "b") }),
    /monotonic_anchor_not_protected/
  );
  assert.deepEqual(storage.read(), { local: point(0, 0), prepared: null });
});

test("resolves an ambiguous provider error by reading the durable anchor", async () => {
  const anchor = providerFixture();
  const originalAdvance = anchor.provider.advance;
  anchor.provider.advance = async (expected, next) => {
    await originalAdvance(expected, next);
    throw new Error("transport_lost_after_commit");
  };
  const storage = journalFixture();
  const coordinator = new SqliteMonotonicCheckpointCoordinator({
    provider: anchor.provider, journal: storage.journal, installationId
  });
  const target = point(1, 1, "b");
  const result = await coordinator.commit({ next: target });
  assert.equal(result.recovered, "finalized_after_ambiguous_advance");
  assert.deepEqual(storage.read(), { local: target, prepared: null });
});
