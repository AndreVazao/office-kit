import test from "node:test";
import assert from "node:assert/strict";
import { DgmMatReadOnlyAdapter, dgmMatAdapterContract } from "../src/dgmat-readonly-adapter.mjs";

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name === "content-type" ? "application/json" : null },
  json: async () => data
});

const fixedNow = Date.parse("2026-11-08T12:00:00.000Z");
const freshState = (overrides = {}) => ({
  timestamp: fixedNow / 1000,
  runtime_status: "running",
  system_state: "READY",
  boot_phase: "COMPLETE",
  node_status: "ONLINE",
  is_degraded: false,
  agents: { private_agent: { status: "active", secret: "do-not-copy" } },
  tasks: { private_task: { status: "running", secret: "do-not-copy" } },
  ...overrides
});

test("requires a loopback endpoint and injected secure session provider", () => {
  const tokenProvider = async () => "abcdefghijklmnop";
  for (const baseUrl of [
    "http://192.168.1.20:8181",
    "http://127.0.0.1:8182",
    "http://127.0.0.1:8181/untrusted-path",
    "http://127.0.0.1:8181/?target=other",
    "http://user:pass@127.0.0.1:8181"
  ]) {
    assert.throws(() => new DgmMatReadOnlyAdapter({ getAccessToken: tokenProvider, baseUrl }), /loopback/);
  }
  assert.throws(() => new DgmMatReadOnlyAdapter({ getAccessToken: tokenProvider, baseUrl: "https://127.0.0.1:8181" }), /loopback/);
  assert.throws(() => new DgmMatReadOnlyAdapter(), /secure_session_provider/);
});

test("uses the timestamped runtime state endpoint with authenticated GET only", async () => {
  const calls = [];
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(freshState());
    }
  });
  const result = await adapter.connect();
  assert.equal(result.connected, true);
  assert.deepEqual(adapter.capabilities, ["read_state"]);
  assert.equal(calls[0].url, "http://127.0.0.1:8181/runtime/state");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secure-session-token-123");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  await adapter.disconnect();
});

test("exposes source mutation time for diagnostics but never claims a live snapshot", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    now: () => fixedNow,
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async () => response(freshState())
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "synchronizing");
  assert.equal(snapshot.synchronized, false);
  assert.equal(snapshot.generatedAt, new Date(fixedNow).toISOString());
  assert.equal(snapshot.backend.transportReachable, true);
  assert.equal(snapshot.backend.runtimeStatus, "running");
  assert.equal(snapshot.backend.systemState, "READY");
  assert.equal(snapshot.backend.bootPhase, "COMPLETE");
  assert.equal(snapshot.backend.nodeStatus, "ONLINE");
  assert.equal(snapshot.backend.degraded, false);
  assert.equal(snapshot.backend.sourceStateUpdatedAt, new Date(fixedNow).toISOString());
  assert.equal(snapshot.backend.sourceStateMutationAgeMs, 0);
  assert.equal(snapshot.backend.sourceStateMutationAge, "recent_mutation");
  assert.equal(snapshot.backend.sourceTimestampSemantics, "last_state_mutation_not_snapshot_heartbeat");
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "unverified");
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.tasks, []);
  assert.equal("private_agent" in snapshot.backend, false);
  assert.equal("private_task" in snapshot.backend, false);
  assert.equal("secret" in snapshot.backend, false);
  await adapter.disconnect();
});

test("an old state mutation timestamp does not imply a stale transport or promote activity", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    now: () => fixedNow,
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async () => response(freshState({ timestamp: fixedNow / 1000 - 31 }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "synchronizing");
  assert.equal(snapshot.synchronized, false);
  assert.equal(snapshot.backend.transportReachable, true);
  assert.equal(snapshot.backend.sourceStateMutationAgeMs, 31_000);
  assert.equal(snapshot.backend.sourceStateMutationAge, "older_mutation");
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "unverified");
  await adapter.disconnect();
});

test("missing and future source mutation timestamps remain unverified", async () => {
  for (const state of [
    freshState({ timestamp: undefined }),
    freshState({ timestamp: fixedNow / 1000 + 60 })
  ]) {
    const adapter = new DgmMatReadOnlyAdapter({
      now: () => fixedNow,
      getAccessToken: async () => "secure-session-token-123",
      fetchImpl: async () => response(state)
    });
    await adapter.connect();
    const snapshot = await adapter.getSnapshot();
    assert.equal(snapshot.synchronized, false);
    assert.equal(snapshot.backend.sourceSnapshotFreshness, "unverified");
    assert.notEqual(snapshot.backend.sourceStateMutationAge, "recent_mutation");
    await adapter.disconnect();
  }
});

test("fails closed on rejected sessions, invalidates the injected token and never follows redirects", async () => {
  let invalidations = 0;
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "secure-session-token-123",
    invalidateAccessToken: () => { invalidations += 1; },
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return response({}, 401);
    }
  });
  await assert.rejects(adapter.connect(), /session_rejected/);
  assert.equal(invalidations, 1);
});

test("refuses missing or malformed session tokens", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "short",
    fetchImpl: async () => response(freshState())
  });
  await assert.rejects(adapter.connect(), /session_unavailable/);
});

test("publishes only read-only route and honest source timestamp semantics", () => {
  assert.deepEqual(dgmMatAdapterContract.allowedMethods, ["GET"]);
  assert.deepEqual(dgmMatAdapterContract.allowedPaths, ["/runtime/state"]);
  assert.equal(dgmMatAdapterContract.sourceTimestampField, "timestamp");
  assert.equal(dgmMatAdapterContract.sourceTimestampSemantics, "last_state_mutation_not_snapshot_heartbeat");
  assert.equal(dgmMatAdapterContract.sourceSnapshotFreshnessVerified, false);
  assert.equal(dgmMatAdapterContract.requiresInjectedSecureSession, true);
  assert.equal(dgmMatAdapterContract.remotePairingSupported, false);
});
