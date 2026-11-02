import test from "node:test";
import assert from "node:assert/strict";
import { AdapterGateway } from "../src/adapter-gateway.mjs";

const now = Date.parse("2026-11-02T12:00:00.000Z");
const snapshot = (id = "snapshot-1", generatedAt = now) => ({
  schemaVersion: 1,
  sourceId: "example.adapter",
  snapshotId: id,
  generatedAt: new Date(generatedAt).toISOString(),
  connectionState: "connected",
  synchronized: true,
  agents: [{ id: "agent-1", status: "active" }],
  tasks: [{ id: "task-1", status: "running" }]
});

function makeAdapter({ connect = async () => {}, disconnect = async () => {}, getSnapshot = async () => snapshot(), subscribe = callback => { subscribe.callback = callback; return () => { subscribe.callback = null; }; } } = {}) {
  return {
    apiVersion: 1,
    metadata: { id: "example.adapter", name: "Example", version: "1.0.0" },
    capabilities: ["read_state"],
    connect,
    disconnect,
    getSnapshot,
    subscribe
  };
}

function makeEvent(sequence, type, payload, overrides = {}) {
  return {
    schemaVersion: 1,
    sourceId: "example.adapter",
    sessionId: "session-1",
    sequence,
    type,
    timestamp: new Date(now).toISOString(),
    payload,
    ...overrides
  };
}

test("gateway connects only explicitly supplied valid adapter and requires initial snapshot", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  const result = await gateway.connect(makeAdapter());
  assert.equal(result.connected, true);
  assert.equal(result.verified, true);
  assert.equal(result.state.connectionState, "live");
  assert.equal(gateway.getState().agents[0].status, "active");
  await gateway.disconnect();
  assert.equal(gateway.getState().connectionState, "disconnected");
});

test("invalid adapter is rejected without attempting connection", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  let connected = false;
  const adapter = makeAdapter({ connect: async () => { connected = true; } });
  adapter.subscribe = undefined;
  const result = await gateway.connect(adapter);
  assert.equal(result.connected, false);
  assert.equal(result.validation.valid, false);
  assert.equal(connected, false);
});

test("failed connection never exposes verified operational state", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  const result = await gateway.connect(makeAdapter({ connect: async () => { throw new Error("auth_required"); } }));
  assert.equal(result.connected, false);
  assert.equal(result.state.connectionState, "error");
  assert.equal(result.state.authoritativeStateVerified, false);
});

test("gateway rejects duplicate and out-of-order events", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  await gateway.connect(makeAdapter());
  const first = gateway.receiveEvent(makeEvent(1, "diagnostic", { message: "ok" }));
  const duplicate = gateway.receiveEvent(makeEvent(1, "snapshot", snapshot("bad")));
  const older = gateway.receiveEvent(makeEvent(0, "snapshot", snapshot("old")));
  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(older.accepted, false);
  assert.equal(gateway.getState().agents[0].status, "active");
});

test("gateway binds event source identity to the selected adapter", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  await gateway.connect(makeAdapter());
  const result = gateway.receiveEvent(makeEvent(1, "snapshot", snapshot("spoofed"), { sourceId: "other.adapter" }));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "source_identity_mismatch");
  assert.equal(gateway.getState().agents[0].status, "active");
});

test("gateway consumes a fresh snapshot event and rejects expired events", async () => {
  const gateway = new AdapterGateway({ now: () => now });
  await gateway.connect(makeAdapter());
  const result = gateway.receiveEvent(makeEvent(1, "snapshot", snapshot("snapshot-2")));
  assert.equal(result.accepted, true);
  assert.equal(result.state.connectionState, "live");
  const stale = gateway.receiveEvent(makeEvent(2, "heartbeat", {}, { timestamp: new Date(now - 60_000).toISOString() }));
  assert.equal(stale.accepted, false);
  assert.equal(gateway.getState().authoritativeStateVerified, true);
});

test("gateway heartbeat cannot independently restore expired session", async () => {
  let current = now;
  const gateway = new AdapterGateway({ now: () => current, ttlMs: 5_000 });
  await gateway.connect(makeAdapter());
  current += 6_000;
  const stale = gateway.checkHealth();
  assert.equal(stale.connectionState, "stale");
  assert.equal(stale.authoritativeStateVerified, false);
});

test("disconnect removes subscription and notifies listeners", async () => {
  let callback = null;
  let unsubscribed = false;
  const adapter = makeAdapter({
    subscribe: cb => { callback = cb; return () => { unsubscribed = true; callback = null; }; }
  });
  const gateway = new AdapterGateway({ now: () => now });
  const events = [];
  gateway.onEvent(event => events.push(event.type));
  await gateway.connect(adapter);
  await gateway.disconnect();
  assert.equal(unsubscribed, true);
  assert.equal(callback, null);
  assert.ok(events.includes("gateway_disconnected"));
  assert.equal(gateway.receiveEvent(makeEvent(1, "heartbeat", {})).reason, "no_adapter_selected");
});
