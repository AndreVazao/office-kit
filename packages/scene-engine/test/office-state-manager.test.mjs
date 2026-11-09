import test from "node:test";
import assert from "node:assert/strict";
import { resolveOfficeActivityState, officeActivityStateContract } from "../src/office-state-manager.mjs";

const social = [{ id: "a", name: "Ada", activity: "coffee_break", location: "kitchen" }];

test("backend absent uses local social mode with explicit offline disclaimer", () => {
  const state = resolveOfficeActivityState({ backendConfigured: false, socialAgents: social });
  assert.equal(state.mode, "offline_social_simulation");
  assert.match(state.banner, /OFFLINE/);
  assert.equal(state.agents[0].simulated, true);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.showProgressBars, false);
});

test("configured but never connected remains synchronizing, not falsely infirmary or live", () => {
  const state = resolveOfficeActivityState({ backendConfigured: true, connectionState: "connecting", everConnected: false, socialAgents: social });
  assert.equal(state.mode, "synchronizing");
  assert.equal(state.infirmary, null);
  assert.equal(state.operationalStateVerified, false);
});

test("loss after a confirmed session enters infirmary and preserves simulated movement", () => {
  const state = resolveOfficeActivityState({
    backendConfigured: true, connectionState: "error", everConnected: true,
    failureOrigin: "transport", failureConfidence: "probable", incidentId: "incident-1", socialAgents: social,
    agents: [{ id: "a", status: "active", taskId: "task-1" }],
    tasks: [{ id: "task-1", status: "running", progress: 72 }]
  });
  assert.equal(state.mode, "infirmary");
  assert.equal(state.infirmary.incidentId, "incident-1");
  assert.equal(state.agents[0].healthStatus, "infirmary");
  assert.equal(state.agents[0].simulated, true);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.showProgressBars, false);
});

test("live mode exposes progress only when backend supplies a valid running task percentage", () => {
  const state = resolveOfficeActivityState({
    backendConfigured: true, connectionState: "live", synchronized: true, authoritativeStateVerified: true,
    agents: [{ id: "a", taskId: "task-1" }, { id: "b", taskId: "task-2" }],
    tasks: [{ id: "task-1", status: "running", progress: 72 }, { id: "task-2", status: "running" }]
  });
  assert.equal(state.mode, "live");
  assert.equal(state.agents[0].progress, 72);
  assert.equal(state.agents[0].showProgressBar, true);
  assert.equal(state.agents[1].progress, null);
  assert.equal(state.agents[1].showProgressBar, false);
});

test("unsynchronized snapshots never show real work or progress", () => {
  const state = resolveOfficeActivityState({
    backendConfigured: true, connectionState: "synchronizing", synchronized: false,
    authoritativeStateVerified: false, agents: [{ id: "a", taskId: "task-1" }],
    tasks: [{ id: "task-1", status: "running", progress: 80 }], socialAgents: social
  });
  assert.equal(state.mode, "synchronizing");
  assert.equal(state.agents[0].simulated, true);
  assert.equal(state.agents[0].progress, null);
  assert.equal(state.showProgressBars, false);
});

test("rejects invalid connection state and backend configuration type", () => {
  assert.throws(() => resolveOfficeActivityState({}), /backendConfigured/);
  assert.throws(() => resolveOfficeActivityState({ backendConfigured: true, connectionState: "magic" }), /invalid_connection_state/);
  assert.deepEqual(officeActivityStateContract.modes, ["offline_social_simulation", "synchronizing", "infirmary", "live"]);
});
