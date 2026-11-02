import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeSimulator } from "../src/runtime-simulator.mjs";

const initialNow = Date.parse("2026-11-02T12:00:00.000Z");
const makeSnapshot = (now, overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "generic-test-source",
  snapshotId: "snapshot-1",
  generatedAt: new Date(now).toISOString(),
  connectionState: "connected",
  synchronized: true,
  agents: [{ id: "agent-1", status: "active" }],
  tasks: [{ id: "task-1", status: "running" }],
  ...overrides
});

function setup() {
  let now = initialNow;
  const simulator = new RuntimeSimulator({ now: () => now, ttlMs: 10_000 });
  return { simulator, now: () => now, advance: ms => { now += ms; } };
}

test("simulator connects and becomes live only after a valid synchronized snapshot", () => {
  const { simulator, now } = setup();
  assert.equal(simulator.connect().state.connectionState, "connecting");
  assert.equal(simulator.transportConnected().state.connectionState, "synchronizing");
  const result = simulator.publishSnapshot(makeSnapshot(now()));
  assert.equal(result.state.connectionState, "live");
  assert.equal(result.state.authoritativeStateVerified, true);
  assert.equal(result.state.agents[0].status, "active");
  assert.deepEqual(result.events.map(event => event.sequence), [1, 2, 3]);
});

test("duplicate snapshot identifiers are ignored and do not mutate live state", () => {
  const { simulator, now } = setup();
  simulator.connect();
  simulator.transportConnected();
  const snapshot = makeSnapshot(now());
  simulator.publishSnapshot(snapshot);
  const duplicate = simulator.publishSnapshot({ ...snapshot, agents: [{ id: "agent-1", status: "blocked" }] });
  assert.equal(duplicate.event.type, "snapshot_ignored_duplicate");
  assert.equal(duplicate.event.reason, "duplicate_snapshot_id");
  assert.equal(duplicate.state.connectionState, "live");
  assert.equal(duplicate.state.agents[0].status, "active");
});

test("an out-of-order stale snapshot cannot restore operational verification", () => {
  const { simulator, now, advance } = setup();
  simulator.connect();
  simulator.transportConnected();
  simulator.publishSnapshot(makeSnapshot(now(), { snapshotId: "newer" }));
  advance(1_000);
  const oldSnapshot = makeSnapshot(now() - 20_000, { snapshotId: "older" });
  const result = simulator.publishSnapshot(oldSnapshot);
  assert.equal(result.state.connectionState, "stale");
  assert.equal(result.state.authoritativeStateVerified, false);
  assert.equal(result.state.agents[0].status, "unknown");
  assert.equal(result.state.tasks[0].status, "unknown");
});

test("heartbeat and health checks cannot make an unsynchronized session live", () => {
  const { simulator } = setup();
  simulator.connect();
  simulator.transportConnected();
  assert.equal(simulator.heartbeat().state.connectionState, "synchronizing");
  assert.equal(simulator.checkHealth().state.authoritativeStateVerified, false);
});

test("disconnect and reconnect require a fresh snapshot", () => {
  const { simulator, now } = setup();
  simulator.connect();
  simulator.transportConnected();
  simulator.publishSnapshot(makeSnapshot(now()));
  assert.equal(simulator.disconnect().state.connectionState, "disconnected");
  assert.equal(simulator.connect().state.connectionState, "connecting");
  assert.equal(simulator.transportConnected().state.connectionState, "synchronizing");
  assert.equal(simulator.getState().authoritativeStateVerified, false);
  const next = simulator.publishSnapshot(makeSnapshot(now(), { snapshotId: "snapshot-2" }));
  assert.equal(next.state.connectionState, "live");
});

test("event history is ordered, filterable and defensive", () => {
  const { simulator } = setup();
  simulator.connect();
  simulator.transportConnected();
  simulator.heartbeat();
  assert.deepEqual(simulator.getEvents({ afterSequence: 1 }).map(event => event.sequence), [2, 3]);
  const events = simulator.getEvents();
  events[0].type = "tampered";
  assert.equal(simulator.getEvents()[0].type, "connect");
  assert.throws(() => simulator.getEvents({ afterSequence: -1 }), TypeError);
});

test("invalid snapshot fails closed and records an event", () => {
  const { simulator, now } = setup();
  simulator.connect();
  simulator.transportConnected();
  const result = simulator.publishSnapshot(makeSnapshot(now(), { schemaVersion: 999 }));
  assert.equal(result.state.connectionState, "error");
  assert.equal(result.state.authoritativeStateVerified, false);
  assert.equal(result.event.type, "snapshot_received");
});
