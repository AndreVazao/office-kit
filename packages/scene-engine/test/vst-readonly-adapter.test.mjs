import test from "node:test";
import assert from "node:assert/strict";
import { VstReadOnlyAdapter, vstAdapterContract } from "../src/vst-readonly-adapter.mjs";
import { RuntimeSession } from "../src/runtime-session.mjs";

const fixedNow = Date.parse("2026-11-12T12:00:00.000Z");
const firstSessionId = "11111111-1111-4111-8111-111111111111";
const secondSessionId = "22222222-2222-4222-8222-222222222222";
const response = (data, status = 200, contentType = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name.toLowerCase() === "content-type" ? contentType : null },
  json: async () => data
});
const state = (overrides = {}) => ({
  ok: true,
  status: "OFF",
  mode: "PAPER",
  open_positions_count: 0,
  opportunities_count: 0,
  updated_at_ms: fixedNow,
  health_state: "unknown",
  allow_new_tasks: false,
  allow_risk_bearing_actions: false,
  health_checked_at_ms: 0,
  agents: [{ id: "must-not-copy", status: "active", token: "must-not-copy" }],
  tasks: [{ id: "must-not-copy", status: "running", secret: "must-not-copy" }],
  ...overrides
});
const createAdapter = overrides => new VstReadOnlyAdapter({
  now: () => fixedNow,
  createSessionId: () => firstSessionId,
  getAccessToken: async () => "vst-local-token-0123456789",
  fetchImpl: async () => response(state()),
  ...overrides
});

function waitFor(promise, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test_wait_timeout")), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

test("requires an exact loopback VST endpoint and an injected secure token provider", () => {
  const tokenProvider = async () => "vst-local-token-0123456789";
  for (const baseUrl of [
    "http://192.168.1.20:8765",
    "http://127.0.0.1:8766",
    "http://127.0.0.1:8765/untrusted-path",
    "http://127.0.0.1:8765/?target=other",
    "http://user:pass@127.0.0.1:8765"
  ]) {
    assert.throws(() => new VstReadOnlyAdapter({ getAccessToken: tokenProvider, baseUrl }), /loopback/);
  }
  assert.throws(() => new VstReadOnlyAdapter({
    getAccessToken: tokenProvider,
    baseUrl: "https://127.0.0.1:8765"
  }), /loopback/);
  assert.throws(() => new VstReadOnlyAdapter(), /secure_token_provider/);
});

test("uses only authenticated loopback GET /observer/summary with X-Token", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(state());
    }
  });
  const connected = await adapter.connect();
  assert.equal(connected.connected, true);
  assert.equal(connected.sessionId, firstSessionId);
  assert.deepEqual(adapter.capabilities, ["read_state"]);
  assert.equal(calls[0].url, "http://127.0.0.1:8765/observer/summary");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["X-Token"], "vst-local-token-0123456789");
  assert.equal(Object.hasOwn(calls[0].init.headers, "Authorization"), false);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await adapter.disconnect();
});

test("maps only the bounded observer fields and never invents agents, tasks or authority", async () => {
  const adapter = createAdapter();
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.sourceId, "vazao-sovereign-trader");
  assert.equal(snapshot.connectionState, "connected");
  assert.equal(snapshot.synchronized, true);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.tasks, []);
  assert.equal(snapshot.backend.transportReachable, true);
  assert.equal(snapshot.backend.engineStatus, "OFF");
  assert.equal(snapshot.backend.engineRunning, false);
  assert.equal(snapshot.backend.mode, "PAPER");
  assert.equal(snapshot.backend.paperOnly, true);
  assert.equal(snapshot.backend.openPositionsCount, 0);
  assert.equal(snapshot.backend.opportunitiesCount, 0);
  assert.equal(snapshot.backend.healthState, "unknown");
  assert.equal(snapshot.backend.healthFreshness, "unavailable");
  assert.equal(snapshot.backend.allowNewTasks, false);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.runtimeReadiness, "unverified");
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "fresh");
  assert.equal(snapshot.backend.sourceTimestampSemantics, "last_observer_publish_time_not_engine_readiness");
  assert.equal(JSON.stringify(snapshot).includes("must-not-copy"), false);
  await adapter.disconnect();
});

test("fresh observer publication becomes a verified read-only snapshot, not engine readiness", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({
      status: "RUNNING",
      mode: "PAPER",
      open_positions_count: 3,
      opportunities_count: 5,
      updated_at_ms: fixedNow - 2_000,
      health_state: "healthy",
      allow_new_tasks: true,
      allow_risk_bearing_actions: true,
      health_checked_at_ms: fixedNow - 1_000
    }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.synchronized, true);
  assert.equal(snapshot.backend.engineRunning, true);
  assert.equal(snapshot.backend.healthFreshness, "fresh");
  assert.equal(snapshot.backend.allowNewTasks, true);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.runtimeReadiness, "unverified");
  await adapter.disconnect();
});

test("stale observer publication is rejected by RuntimeSession freshness validation", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({ updated_at_ms: fixedNow - 60_000 }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "stale");
  const session = new RuntimeSession({ now: () => fixedNow, ttlMs: 30_000 });
  session.connect();
  session.transportConnected();
  const result = session.receiveSnapshot(snapshot);
  assert.equal(result.connectionState, "stale");
  assert.equal(result.authoritativeStateVerified, false);
  assert.deepEqual(result.agents, []);
  assert.deepEqual(result.tasks, []);
  await adapter.disconnect();
});

test("future or missing source timestamps remain synchronizing and never become authoritative", async () => {
  for (const override of [
    { updated_at_ms: fixedNow + 5_000 },
    { updated_at_ms: undefined }
  ]) {
    const adapter = createAdapter({ fetchImpl: async () => response(state(override)) });
    await adapter.connect();
    const snapshot = await adapter.getSnapshot();
    assert.equal(snapshot.synchronized, false);
    assert.ok(["future_or_clock_skew", "unavailable"].includes(snapshot.backend.sourceSnapshotFreshness));
    const session = new RuntimeSession({ now: () => fixedNow, ttlMs: 30_000 });
    session.connect();
    session.transportConnected();
    const result = session.receiveSnapshot(snapshot);
    assert.equal(result.connectionState, "synchronizing");
    assert.equal(result.authoritativeStateVerified, false);
    await adapter.disconnect();
  }
});

test("REAL mode is reported as configuration only and never grants execution authority", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({ status: "RUNNING", mode: "REAL" }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.backend.mode, "REAL");
  assert.equal(snapshot.backend.paperOnly, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.deepEqual(adapter.capabilities, ["read_state"]);
  await adapter.disconnect();
});

test("rejects malformed tokens and never includes provider errors or secrets in events", async () => {
  const missing = createAdapter({ getAccessToken: async () => "short" });
  await assert.rejects(missing.connect(), /vst_local_token_unavailable/);

  const providerFailure = createAdapter({
    getAccessToken: async () => { throw new Error("X-Token private-owner-secret"); }
  });
  await assert.rejects(providerFailure.connect(), /vst_token_provider_failed/);

  const transportFailure = createAdapter({
    fetchImpl: async () => { throw new Error("Authorization: X-Token private-owner-secret"); }
  });
  await assert.rejects(transportFailure.connect(), /vst_transport_error/);
  assert.equal(JSON.stringify(transportFailure).includes("private-owner-secret"), false);
});

test("fails closed on 401/403 and never follows redirects", async () => {
  for (const status of [401, 403]) {
    const adapter = createAdapter({
      fetchImpl: async (_url, init) => {
        assert.equal(init.redirect, "error");
        return response({ error: "private detail" }, status);
      }
    });
    await assert.rejects(adapter.connect(), /vst_auth_rejected/);
    await adapter.disconnect();
  }
});

test("rejects non-JSON and malformed observer responses", async () => {
  const contentType = createAdapter({
    fetchImpl: async () => response({}, 200, "text/html")
  });
  await assert.rejects(contentType.connect(), /vst_invalid_content_type/);

  const invalid = createAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => []
    })
  });
  await assert.rejects(invalid.connect(), /vst_invalid_response/);
});

test("bounds the complete token-provider and HTTP operation with one deadline", async () => {
  const adapter = createAdapter({
    timeoutMs: 250,
    getAccessToken: async () => new Promise(() => {})
  });
  await assert.rejects(adapter.connect(), /vst_request_timeout/);
});

test("a newer connect attempt aborts the previous pending connection", async () => {
  let firstSignalStarted;
  const firstStarted = new Promise(resolve => { firstSignalStarted = resolve; });
  let calls = 0;
  const adapter = createAdapter({
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        firstSignalStarted(init.signal);
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("first_connection_aborted")), { once: true });
        });
      }
      return response(state());
    }
  });

  const first = adapter.connect();
  const firstSignal = await waitFor(firstStarted);
  const second = await adapter.connect();
  assert.equal(firstSignal.aborted, true);
  assert.equal(second.connected, true);
  await assert.rejects(first, /vst_connection_superseded/);
  await adapter.disconnect();
});

test("disconnect aborts an in-flight token-provider request and supersedes connect", async () => {
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const adapter = createAdapter({
    getAccessToken: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("provider_cancelled")), { once: true });
      signalStarted(signal);
    })
  });

  const connecting = adapter.connect();
  const signal = await waitFor(started);
  await adapter.disconnect();
  assert.equal(signal.aborted, true);
  await assert.rejects(connecting, /vst_connection_superseded/);
});

test("disconnect aborts an in-flight polling fetch and suppresses its late result", async () => {
  let calls = 0;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return response(state());
      signalStarted(init.signal);
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("fetch_aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  });

  await adapter.connect();
  const signal = await waitFor(started);
  await adapter.disconnect();
  assert.equal(signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 2);
});

test("authentication rejection during polling stops further requests until explicit disconnect", async () => {
  let calls = 0;
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(state()) : response({}, 401);
    }
  });
  await adapter.connect();
  const eventPromise = new Promise(resolve => {
    const unsubscribe = adapter.subscribe(event => {
      if (event.type === "connection") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  const event = await waitFor(eventPromise);
  assert.equal(event.payload.reason, "vst_auth_rejected");
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal(calls, 2);
  await adapter.disconnect();
});

test("each reconnect receives a new UUID and a late prior poll cannot emit into the new session", async () => {
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
  await waitFor(oldPollStarted);
  await adapter.disconnect();

  const second = await adapter.connect();
  assert.equal(second.sessionId, secondSessionId);
  assert.notEqual(first.sessionId, second.sessionId);
  const events = [];
  const unsubscribe = adapter.subscribe(event => events.push(event));
  const newEvent = await waitFor(new Promise(resolve => {
    const off = adapter.subscribe(event => {
      if (event.type === "snapshot") {
        off();
        resolve(event);
      }
    });
  }));
  assert.equal(newEvent.sessionId, secondSessionId);

  releaseOldPoll(response(state()));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(events.filter(event => event.sessionId === firstSessionId).length, 0);
  assert.equal(events.filter(event => event.sessionId === secondSessionId).length, 1);
  unsubscribe();
  await adapter.disconnect();
});

test("publishes the exact VST read-only route and timestamp contract", () => {
  assert.equal(vstAdapterContract.id, "vazao-sovereign-trader");
  assert.deepEqual(vstAdapterContract.allowedMethods, ["GET"]);
  assert.deepEqual(vstAdapterContract.allowedPaths, ["/observer/summary"]);
  assert.equal(vstAdapterContract.authenticationHeader, "X-Token");
  assert.equal(vstAdapterContract.requiredScope, "read_private_state");
  assert.equal(vstAdapterContract.sourceTimestampField, "updated_at_ms");
  assert.equal(vstAdapterContract.sourceTimestampSemantics, "last_observer_publish_time_not_engine_readiness");
  assert.equal(vstAdapterContract.remoteConnectionSupported, false);
  assert.deepEqual(vstAdapterContract.capabilities, ["read_state"]);
});
