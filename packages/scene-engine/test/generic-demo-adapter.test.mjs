import test from "node:test";
import assert from "node:assert/strict";
import { AdapterCatalog } from "../src/adapter-catalog.mjs";
import { AdapterGateway } from "../src/adapter-gateway.mjs";
import { GenericDemoAdapter } from "../src/generic-demo-adapter.mjs";

const epoch = Date.parse("2026-11-03T12:00:00.000Z");

function setup({ ttlMs = 5_000 } = {}) {
  let current = epoch;
  const adapter = new GenericDemoAdapter({ now: () => current, ttlMs });
  const catalog = new AdapterCatalog();
  const gateway = new AdapterGateway({ now: () => current, ttlMs });
  return {
    adapter, catalog, gateway,
    advance: ms => { current += ms; },
    now: () => current
  };
}

test("catalog selection is explicit and does not connect the demonstration adapter", async () => {
  const { adapter, catalog } = setup();
  assert.equal(catalog.register(adapter).registered, true);
  assert.equal(adapter.connectCount, 0);
  const selected = catalog.select("office-kit.demo");
  assert.equal(selected.selected, true);
  assert.equal(adapter.connectCount, 0);
});

test("host-selected adapter connects through gateway and requires initial synchronized snapshot", async () => {
  const { adapter, catalog, gateway } = setup();
  catalog.register(adapter);
  const selection = catalog.select(adapter.metadata.id, { requiredCapabilities: ["read_state", "read_agents"] });
  assert.equal(selection.selected, true);
  const result = await gateway.connect(selection.adapter);
  assert.equal(result.connected, true);
  assert.equal(result.verified, true);
  assert.equal(result.state.connectionState, "live");
  assert.equal(result.state.agents[0].status, "active");
  assert.equal(result.state.tasks[0].status, "running");
});

test("agent and task updates flow as authoritative snapshots through the gateway", async () => {
  const { adapter, gateway } = setup();
  await gateway.connect(adapter);
  adapter.setAgentStatus("demo-agent-1", "blocked");
  adapter.setTaskStatus("demo-task-1", "completed");
  const state = gateway.getState();
  assert.equal(state.authoritativeStateVerified, true);
  assert.equal(state.agents[0].status, "blocked");
  assert.equal(state.tasks[0].status, "completed");
});

test("heartbeat maintains freshness but timeout removes operational verification", async () => {
  const { adapter, gateway, advance } = setup();
  await gateway.connect(adapter);
  advance(4_000);
  adapter.heartbeat();
  assert.equal(gateway.getState().connectionState, "live");
  advance(5_001);
  const state = gateway.checkHealth();
  assert.equal(state.connectionState, "stale");
  assert.equal(state.authoritativeStateVerified, false);
  assert.equal(state.agents[0].status, "unknown");
});

test("duplicate, out-of-order and foreign-source events are rejected", async () => {
  const { adapter, gateway } = setup();
  await gateway.connect(adapter);
  const first = adapter.emitEvent("diagnostic", { code: "demo" });
  const duplicate = gateway.receiveEvent(first);
  const older = gateway.receiveEvent({ ...first, sequence: first.sequence - 1 });
  const foreign = gateway.receiveEvent({ ...first, sequence: first.sequence + 1, sourceId: "spoofed.source" });
  assert.equal(duplicate.accepted, true);
  assert.equal(gateway.receiveEvent(first).accepted, false);
  assert.equal(older.accepted, false);
  assert.equal(foreign.reason, "source_identity_mismatch");
  assert.equal(gateway.getState().authoritativeStateVerified, true);
});

test("transport failure and explicit disconnect fail closed and clean subscriptions", async () => {
  const { adapter, gateway } = setup();
  await gateway.connect(adapter);
  adapter.failTransport();
  assert.equal(gateway.getState().connectionState, "error");
  assert.equal(gateway.getState().authoritativeStateVerified, false);
  await gateway.disconnect();
  assert.equal(gateway.getState().connectionState, "disconnected");
  assert.equal(adapter.listeners.size, 0);
  assert.equal(adapter.disconnectCount, 1);
});

test("reconnection requires a new snapshot before returning to live", async () => {
  const { adapter, gateway } = setup();
  await gateway.connect(adapter);
  await gateway.disconnect();
  const reconnect = await gateway.connect(adapter);
  assert.equal(reconnect.state.connectionState, "live");
  assert.equal(reconnect.verified, true);
  assert.equal(adapter.connectCount, 2);
  assert.equal(adapter.snapshotSequence, 2);
});

test("invalid demonstration data is rejected and no write capability is exposed", () => {
  assert.throws(() => new GenericDemoAdapter({ agents: [{ id: "bad", status: "execute" }] }), TypeError);
  const adapter = new GenericDemoAdapter();
  assert.deepEqual(adapter.capabilities, ["read_state", "read_agents", "read_tasks"]);
});
