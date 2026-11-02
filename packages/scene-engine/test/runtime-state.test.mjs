import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRuntimeSnapshot, runtimeStateContract } from "../src/runtime-state.mjs";

const now = Date.parse("2026-11-02T12:00:00.000Z");
const snapshot = overrides => ({
  schemaVersion: 1,
  sourceId: "test-backend",
  snapshotId: "snapshot-1",
  generatedAt: new Date(now - 1_000).toISOString(),
  connectionState: "connected",
  synchronized: true,
  agents: [{ id: "agent-1", status: "active" }],
  tasks: [{ id: "task-1", status: "running" }],
  ...overrides
});

test("fresh synchronized snapshots preserve validated agent and task states", () => {
  const result = normalizeRuntimeSnapshot(snapshot(), { now, ttlMs: 30_000 });
  assert.equal(result.valid, true);
  assert.equal(result.connectionState, "live");
  assert.equal(result.authoritativeStateVerified, true);
  assert.equal(result.agents[0].status, "active");
  assert.equal(result.tasks[0].status, "running");
});

test("invalid schema, missing provenance and unknown statuses are rejected", () => {
  for (const invalid of [
    snapshot({ schemaVersion: 2 }),
    snapshot({ sourceId: "" }),
    snapshot({ snapshotId: "" }),
    snapshot({ agents: [{ id: "a", status: "magic" }] }),
    snapshot({ tasks: [{ id: "t", status: "executing" }] })
  ]) {
    assert.equal(normalizeRuntimeSnapshot(invalid, { now }).valid, false);
  }
});

test("expired or future snapshots never report live operational states", () => {
  const expired = normalizeRuntimeSnapshot(snapshot({ generatedAt: new Date(now - 60_000).toISOString() }), { now, ttlMs: 30_000 });
  assert.equal(expired.connectionState, "stale");
  assert.equal(expired.authoritativeStateVerified, false);
  assert.equal(expired.agents[0].status, "unknown");
  const future = normalizeRuntimeSnapshot(snapshot({ generatedAt: new Date(now + 5_000).toISOString() }), { now });
  assert.equal(future.connectionState, "stale");
});

test("reconnection remains synchronizing until a fresh snapshot is synchronized", () => {
  const result = normalizeRuntimeSnapshot(snapshot({ connectionState: "synchronizing", synchronized: false }), { now });
  assert.equal(result.connectionState, "synchronizing");
  assert.equal(result.authoritativeStateVerified, false);
  assert.equal(result.tasks[0].status, "unknown");
});

test("disconnected and error states do not expose operational statuses as confirmed", () => {
  for (const state of ["disconnected", "connecting", "error"]) {
    const result = normalizeRuntimeSnapshot(snapshot({ connectionState: state }), { now });
    assert.equal(result.connectionState, state);
    assert.equal(result.authoritativeStateVerified, false);
    assert.equal(result.agents[0].status, "unknown");
  }
});

test("contract exposes only the documented status vocabulary", () => {
  assert.deepEqual(runtimeStateContract.taskStatuses, ["proposed", "awaiting_approval", "running", "completed", "blocked", "failed"]);
});
