import test from "node:test";
import assert from "node:assert/strict";
import { SocialSimulationEngine, socialSimulationContract } from "../src/social-simulation.mjs";

const agents = [
  { id: "a", name: "Ada", departmentId: "research" },
  { id: "b", name: "Turing", departmentId: "research" },
  { id: "c", name: "Grace", departmentId: "operations" }
];

test("starts every enabled avatar in explicitly simulated social mode", () => {
  const engine = new SocialSimulationEngine({ agents, seed: 7, now: 1_000 });
  const snapshot = engine.snapshot();
  assert.equal(snapshot.mode, "offline_social_simulation");
  assert.equal(snapshot.backendConnected, false);
  assert.equal(snapshot.simulated, true);
  assert.equal(snapshot.agents.length, 3);
  for (const agent of snapshot.agents) {
    assert.equal(agent.simulated, true);
    assert.equal(agent.authority, "local_social_simulation");
    assert.equal(agent.status, "social");
    assert.equal(agent.taskId, undefined);
    assert.equal(agent.progress, undefined);
  }
});

test("same seed and clock produce reproducible behavior for QA", () => {
  const first = new SocialSimulationEngine({ agents, seed: 123, now: 10_000 });
  const second = new SocialSimulationEngine({ agents, seed: 123, now: 10_000 });
  assert.deepEqual(first.snapshot().agents, second.snapshot().agents);
});

test("activities change after variable durations and remain independent of render FPS", () => {
  const engine = new SocialSimulationEngine({ agents, seed: 91, now: 0, minDecisionMs: 1, maxDecisionMs: 2 });
  const before = engine.snapshot();
  const after = engine.advance(10_000);
  assert.ok(after.agents.some((agent, index) => agent.activity !== before.agents[index].activity ||
    agent.location !== before.agents[index].location || agent.startedAt !== before.agents[index].startedAt));
  assert.equal(after.generatedAt, new Date(10_000).toISOString());
});

test("allows repeated activity types without a fixed repeating routine", () => {
  const engine = new SocialSimulationEngine({ agents, seed: 4, now: 0, minDecisionMs: 1, maxDecisionMs: 1 });
  const observed = new Set();
  for (let time = 1; time <= 100; time += 1) {
    for (const agent of engine.advance(time).agents) observed.add(agent.activity);
  }
  assert.ok(observed.size >= 4);
  assert.ok(socialSimulationContract.activities.includes("smoke_break"));
  assert.ok(socialSimulationContract.activities.includes("conversation"));
});

test("supports enabling and disabling an avatar without fabricating backend state", () => {
  const engine = new SocialSimulationEngine({ agents, seed: 3, now: 100 });
  assert.equal(engine.setAgentEnabled("b", false).agents.length, 2);
  assert.equal(engine.setAgentEnabled("b", true).agents.length, 3);
  assert.throws(() => engine.setAgentEnabled("missing", true), /unknown_agent/);
});

test("rejects invalid agents, duplicate IDs, invalid intervals and backwards time", () => {
  assert.throws(() => new SocialSimulationEngine({ agents: [{ id: "" }] }), /non-empty/);
  assert.throws(() => new SocialSimulationEngine({ agents: [{ id: "x" }, { id: "x" }] }), /unique/);
  assert.throws(() => new SocialSimulationEngine({ agents, minDecisionMs: 10, maxDecisionMs: 1 }), /decision interval/);
  const engine = new SocialSimulationEngine({ agents, now: 100 });
  assert.throws(() => engine.advance(99), /backwards/);
});
