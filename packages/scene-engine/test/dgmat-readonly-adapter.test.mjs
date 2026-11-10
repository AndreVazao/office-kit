import test from "node:test";
import assert from "node:assert/strict";
import { DgmMatReadOnlyAdapter, dgmMatAdapterContract } from "../src/dgmat-readonly-adapter.mjs";

const fixedNow = Date.parse("2026-11-10T12:00:00.000Z");
const firstSessionId = "11111111-1111-4111-8111-111111111111";
const secondSessionId = "22222222-2222-4222-8222-222222222222";
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name === "content-type" ? "application/json" : null },
  json: async () => data
});
const state = (overrides = {}) => ({
  timestamp: fixedNow / 1000,
  runtime_status: "RUNNING",
  system_state: "READY",
  boot_phase: "COMPLETE",
  node_status: "ONLINE",
  is_degraded: false,
  agents: { private_agent: { status: "active", secret: "must-not-copy" } },
  tasks: { private_task: { status: "running", secret: "must-not-copy" } },
  ...overrides
});
const createAdapter = overrides => new DgmMatReadOnlyAdapter({
  now: () => fixedNow,
  createSessionId: () => firstSessionId,
  getAccessToken: async () => "secure-session-token-123456",
  fetchImpl: async () => response(state()),
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
  assert.throws(() => new DgmMatReadOnlyAdapter({
    getAccessToken: tokenProvider,
    baseUrl: "https://127.0.0.1:8181"
  }), /loopback/);
  assert.throws(() => new DgmMatReadOnlyAdapter(), /secure_session_provider/);
});

test("uses only authenticated loopback GET /runtime/state", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(state());
    }
  });
  const result = await adapter.connect();
  assert.equal(result.connected, true);
  assert.equal(result.sessionId, firstSessionId);
  assert.deepEqual(adapter.capabilities, ["read_state"]);
  assert.equal(calls[0].url, "http://127.0.0.1:8181/runtime/state");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secure-session-token-123456");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await adapter.disconnect();
});

test("maps only allowlisted state fields and never claims a live snapshot", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({
      runtime_status: "RUNNING",
      system_state: "READY",
      boot_phase: "COMPLETE",
      node_status: "ONLINE",
      secret: "private-secret-value"
    }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "synchronizing");
  assert.equal(snapshot.synchronized, false);
  assert.equal(snapshot.generatedAt, new Date(fixedNow).toISOString());
  assert.equal(snapshot.backend.transportReachable, true);
  assert.equal(snapshot.backend.runtimeStatus, "RUNNING");
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
  assert.equal("secret" in snapshot.backend, false);
  await adapter.disconnect();
});

test("does not confuse an old state mutation with stale transport or live activity", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({ timestamp: fixedNow / 1000 - 31 }))
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

test("missing and future source timestamps remain unverified", async () => {
  for (const payload of [
    state({ timestamp: undefined }),
    state({ timestamp: fixedNow / 1000 + 60 })
  ]) {
    const adapter = createAdapter({ fetchImpl: async () => response(payload) });
    await adapter.connect();
    const snapshot = await adapter.getSnapshot();
    assert.equal(snapshot.synchronized, false);
    assert.equal(snapshot.backend.sourceSnapshotFreshness, "unverified");
    assert.notEqual(snapshot.backend.sourceStateMutationAge, "recent_mutation");
    await adapter.disconnect();
  }
});

test("unsafe status strings are not copied into snapshots", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({
      runtime_status: "BearerPrivateCredential",
      system_state: "a".repeat(40)
    }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.backend.runtimeStatus, "unknown");
  assert.equal(snapshot.backend.systemState, "unknown");
  assert.equal(JSON.stringify(snapshot).includes("BearerPrivateCredential"), false);
  await adapter.disconnect();
});

test("a hanging token provider is bounded by the complete request deadline", async () => {
  let providerSignal;
  const adapter = createAdapter({
    timeoutMs: 250,
    getAccessToken: async ({ signal }) => {
      providerSignal = signal;
      return new Promise(() => {});
    }
  });
  await assert.rejects(adapter.connect(), /dgm_mat_request_timeout/);
  assert.equal(providerSignal.aborted, true);
});

test("a hanging fetch or response body is bounded by the same request deadline", async () => {
  const hangingFetch = createAdapter({
    timeoutMs: 250,
    fetchImpl: async () => new Promise(() => {})
  });
  await assert.rejects(hangingFetch.connect(), /dgm_mat_request_timeout/);

  const hangingBody = createAdapter({
    timeoutMs: 250,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => new Promise(() => {})
    })
  });
  await assert.rejects(hangingBody.connect(), /dgm_mat_request_timeout/);
});

test("awaits asynchronous token invalidation and still fails closed when invalidation rejects", async () => {
  let invalidated = false;
  const adapter = createAdapter({
    invalidateAccessToken: async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      invalidated = true;
    },
    fetchImpl: async () => response({}, 401)
  });
  await assert.rejects(adapter.connect(), /dgm_mat_session_rejected/);
  assert.equal(invalidated, true);

  const failingInvalidation = createAdapter({
    invalidateAccessToken: async () => { throw new Error("private invalidation detail"); },
    fetchImpl: async () => response({}, 403)
  });
  await assert.rejects(failingInvalidation.connect(), /dgm_mat_session_rejected/);
});

test("provider and fetch errors never enter connection events verbatim", async () => {
  let tokenCalls = 0;
  const providerFailure = createAdapter({
    pollIntervalMs: 1_000,
    getAccessToken: async () => {
      tokenCalls += 1;
      if (tokenCalls === 1) return "secure-session-token-123456";
      throw new Error("Bearer private-token-value");
    }
  });
  await providerFailure.connect();
  const providerEventPromise = new Promise(resolve => {
    const unsubscribe = providerFailure.subscribe(event => {
      if (event.type === "connection") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  const providerEvent = await providerEventPromise;
  assert.equal(providerEvent.payload.reason, "dgm_mat_session_provider_failed");
  assert.equal(JSON.stringify(providerEvent).includes("private-token-value"), false);
  await providerFailure.disconnect();

  let fetchCalls = 0;
  const fetchFailure = createAdapter({
    pollIntervalMs: 1_000,
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return response(state());
      throw new Error("Authorization: Bearer private-fetch-token");
    }
  });
  await fetchFailure.connect();
  const fetchEventPromise = new Promise(resolve => {
    const unsubscribe = fetchFailure.subscribe(event => {
      if (event.type === "connection") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  const fetchEvent = await fetchEventPromise;
  assert.equal(fetchEvent.payload.reason, "dgm_mat_transport_error");
  assert.equal(JSON.stringify(fetchEvent).includes("private-fetch-token"), false);
  await fetchFailure.disconnect();
});

test("each reconnect gets a new UUID and a late prior-generation poll cannot emit", async () => {
  let fetchCalls = 0;
  let signalOldPoll;
  const oldPollStarted = new Promise(resolve => { signalOldPoll = resolve; });
  let releaseOldPoll;
  const oldPoll = new Promise(resolve => { releaseOldPoll = resolve; });
  const sessionIds = [firstSessionId, secondSessionId];
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    createSessionId: () => sessionIds.shift(),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 2) {
        signalOldPoll();
        return oldPoll;
      }
      return response(state());
    }
  });

  const first = await adapter.connect();
  assert.equal(first.sessionId, firstSessionId);
  const firstPoll = oldPollStarted;
  await firstPoll;
  await adapter.disconnect();

  const second = await adapter.connect();
  assert.equal(second.sessionId, secondSessionId);
  assert.notEqual(first.sessionId, second.sessionId);
  const events = [];
  const unsubscribe = adapter.subscribe(event => events.push(event));

  const newEvent = await new Promise(resolve => {
    const off = adapter.subscribe(event => {
      if (event.type === "snapshot") {
        off();
        resolve(event);
      }
    });
  });
  assert.equal(newEvent.sessionId, secondSessionId);

  releaseOldPoll(response(state()));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(events.filter(event => event.sessionId === firstSessionId).length, 0);
  assert.equal(events.filter(event => event.sessionId === secondSessionId).length, 1);
  unsubscribe();
  await adapter.disconnect();
});

test("fails closed on rejected sessions and never follows redirects", async () => {
  const adapter = createAdapter({
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return response({}, 401);
    }
  });
  await assert.rejects(adapter.connect(), /session_rejected/);
});

test("refuses missing or malformed session tokens", async () => {
  const adapter = createAdapter({
    getAccessToken: async () => "short"
  });
  await assert.rejects(adapter.connect(), /session_unavailable/);
});

test("publishes the read-only route and honest source timestamp contract", () => {
  assert.deepEqual(dgmMatAdapterContract.allowedMethods, ["GET"]);
  assert.deepEqual(dgmMatAdapterContract.allowedPaths, ["/runtime/state"]);
  assert.equal(dgmMatAdapterContract.sourceTimestampField, "timestamp");
  assert.equal(dgmMatAdapterContract.sourceTimestampSemantics, "last_state_mutation_not_snapshot_heartbeat");
  assert.equal(dgmMatAdapterContract.sourceSnapshotFreshnessVerified, false);
  assert.equal(dgmMatAdapterContract.requiresInjectedSecureSession, true);
  assert.equal(dgmMatAdapterContract.sessionIdentity, "fresh-uuid-per-connection");
  assert.equal(dgmMatAdapterContract.remotePairingSupported, false);
});
