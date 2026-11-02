import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeSession } from "../src/runtime-session.mjs";

const initialNow = Date.parse("2026-11-02T12:00:00.000Z");
const makeSnapshot = (now, overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "fake-backend",
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
  const session = new RuntimeSession({ now: () => now, ttlMs: 10_000 });
  return { session, advance: ms => { now += ms; }, now: () => now };
}

test("connection is not live until a fresh synchronized snapshot arrives", () => {
  const { session, now } = setup();
  assert.equal(session.connect().connectionState, "connecting");
  assert.equal(session.transportConnected().connectionState, "synchronizing");
  assert.equal(session.getState().authoritativeStateVerified, false);
  const live = session.receiveSnapshot(makeSnapshot(now()));
  assert.equal(live.connectionState, "live");
  assert.equal(live.authoritativeStateVerified, true);
  assert.equal(live.agents[0].status, "active");
});

test("heartbeat timeout marks all operational statuses unknown", () => {
  const { session, advance, now } = setup();
  session.connect();
  session.transportConnected();
  session.receiveSnapshot(makeSnapshot(now()));
  advance(10_001);
  const state = session.checkHealth();
  assert.equal(state.connectionState, "stale");
  assert.equal(state.authoritativeStateVerified, false);
  assert.equal(state.agents[0].status, "unknown");
  assert.equal(state.tasks[0].status, "unknown");
});

test("reconnect requires a new synchronized snapshot", () => {
  const { session, now } = setup();
  session.connect();
  session.transportConnected();
  session.receiveSnapshot(makeSnapshot(now()));
  session.disconnect();
  assert.equal(session.connect().authoritativeStateVerified, false);
  assert.equal(session.transportConnected().connectionState, "synchronizing");
  assert.equal(session.getState().tasks[0].status, "unknown");
  const next = session.receiveSnapshot(makeSnapshot(now(), { snapshotId: "snapshot-2" }));
  assert.equal(next.connectionState, "live");
  assert.equal(next.tasks[0].status, "running");
});

test("invalid snapshots fail closed", () => {
  const { session, now } = setup();
  session.connect();
  session.transportConnected();
  const state = session.receiveSnapshot(makeSnapshot(now(), { sourceId: "" }));
  assert.equal(state.connectionState, "error");
  assert.equal(state.authoritativeStateVerified, false);
  assert.equal(state.agents.length, 0);
});

test("heartbeats cannot promote an unsynchronized connection to live", () => {
  const { session } = setup();
  session.connect();
  session.transportConnected();
  const state = session.heartbeat();
  assert.equal(state.connectionState, "synchronizing");
  assert.equal(state.authoritativeStateVerified, false);
});

test("disconnection and explicit transport failure clear heartbeat authority", () => {
  const { session, now } = setup();
  session.connect();
  session.transportConnected();
  session.receiveSnapshot(makeSnapshot(now()));
  assert.equal(session.fail("test_failure").connectionState, "error");
  assert.equal(session.getState().lastHeartbeatAt, null);
  assert.equal(session.disconnect().connectionState, "disconnected");
});
