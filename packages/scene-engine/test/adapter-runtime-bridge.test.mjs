import test from "node:test";
import assert from "node:assert/strict";
import { AdapterRuntimeBridge } from "../src/adapter-runtime-bridge.mjs";

const initialNow = Date.parse("2026-11-02T12:00:00.000Z");
const makeSnapshot = (now, overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "generic-source",
  snapshotId: "snapshot-1",
  generatedAt: new Date(now).toISOString(),
  connectionState: "connected",
  synchronized: true,
  agents: [{ id: "agent-1", status: "active" }],
  tasks: [{ id: "task-1", status: "running" }],
  ...overrides
});
const makeEvent = (now, sequence, overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "adapter-source",
  sessionId: "adapter-session-1",
  sequence,
  type: "heartbeat",
  timestamp: new Date(now).toISOString(),
  payload: {},
  ...overrides
});

function setup({ snapshot, capabilities = ["read_state"] } = {}) {
  let now = initialNow;
  let handler = null;
  let connected = false;
  let disconnected = false;
  let unsubscribed = false;
  const adapter = {
    apiVersion: 1,
    metadata: { id: "test.adapter", name: "Test adapter", version: "1.0.0" },
    capabilities,
    async connect() { connected = true; },
    async disconnect() { disconnected = true; },
    async getSnapshot() { return snapshot ?? makeSnapshot(now); },
    subscribe(callback) { handler = callback; return () => { unsubscribed = true; handler = null; }; }
  };
  const bridge = new AdapterRuntimeBridge(adapter, { now: () => now, ttlMs: 10_000 });
  return {
    bridge,
    emit(event) { handler?.(event); },
    advance(ms) { now += ms; },
    now: () => now,
    flags: () => ({ connected, disconnected, unsubscribed })
  };
}

test("bridge starts only after a fresh synchronized initial snapshot", async () => {
  const { bridge, flags } = setup();
  const result = await bridge.start();
  assert.equal(result.started, true);
  assert.equal(result.state.connectionState, "live");
  assert.equal(result.state.authoritativeStateVerified, true);
  assert.equal(flags().connected, true);
});

test("bridge rejects duplicate and out-of-order event sequence numbers", async () => {
  const { bridge, emit, now } = setup();
  await bridge.start();
  const first = bridge.receiveEvent(makeEvent(now(), 1));
  const duplicate = bridge.receiveEvent(makeEvent(now(), 1));
  const older = bridge.receiveEvent(makeEvent(now(), 0));
  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate_or_out_of_order");
  assert.equal(older.accepted, false);
  assert.equal(older.reason, "duplicate_or_out_of_order");
});

test("bridge fails closed when a sequence gap appears", async () => {
  const { bridge, now } = setup();
  await bridge.start();
  bridge.receiveEvent(makeEvent(now(), 1));
  const gap = bridge.receiveEvent(makeEvent(now(), 3));
  assert.equal(gap.accepted, false);
  assert.equal(gap.reason, "sequence_gap");
  assert.equal(gap.state.connectionState, "error");
  assert.equal(gap.state.authoritativeStateVerified, false);
});

test("bridge rejects stale events and source/session changes", async () => {
  const { bridge, now, advance } = setup();
  await bridge.start();
  advance(31_000);
  const stale = bridge.receiveEvent(makeEvent(now() - 31_000, 1));
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale_or_future_event");
  const changed = bridge.receiveEvent(makeEvent(now(), 1, { sourceId: "different-source" }));
  assert.equal(changed.accepted, false);
  assert.equal(changed.reason, "source_or_session_changed_without_reconnect");
});

test("bridge stop unsubscribes and disconnects adapter", async () => {
  const { bridge, flags } = setup();
  await bridge.start();
  const state = await bridge.stop();
  assert.equal(state.connectionState, "disconnected");
  assert.equal(flags().disconnected, true);
  assert.equal(flags().unsubscribed, true);
});

test("bridge does not start with invalid initial snapshot", async () => {
  const { bridge } = setup({ snapshot: makeSnapshot(initialNow, { schemaVersion: 999 }) });
  const result = await bridge.start();
  assert.equal(result.started, false);
  assert.equal(result.state.authoritativeStateVerified, false);
});
