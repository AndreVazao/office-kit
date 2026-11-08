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

test("requires a loopback endpoint, injected secure session provider and bounded freshness TTL", () => {
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
  assert.throws(() => new DgmMatReadOnlyAdapter({ getAccessToken: tokenProvider, snapshotTtlMs: 30_001 }), /snapshotTtlMs/);
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

test("maps only allowlisted runtime metadata and verifies a fresh source timestamp", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    now: () => fixedNow,
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async () => response(freshState())
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "connected");
  assert.equal(snapshot.synchronized, true);
  assert.equal(snapshot.generatedAt, new Date(fixedNow).toISOString());
  assert.equal(snapshot.backend.runtimeStatus, "running");
  assert.equal(snapshot.backend.systemState, "READY");
  assert.equal(snapshot.backend.bootPhase, "COMPLETE");
  assert.equal(snapshot.backend.nodeStatus, "ONLINE");
  assert.equal(snapshot.backend.degraded, false);
  assert.equal(snapshot.backend.freshness, "fresh");
  assert.equal(snapshot.backend.sourceAgeMs, 0);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.tasks, []);
  assert.equal("private_agent" in snapshot.backend, false);
  assert.equal("private_task" in snapshot.backend, false);
  assert.equal("secret" in snapshot.backend, false);
  await adapter.disconnect();
});

test("marks old runtime state stale instead of promoting the request time", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    now: () => fixedNow,
    snapshotTtlMs: 30_000,
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async () => response(freshState({ timestamp: fixedNow / 1000 - 31 }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.synchronized, false);
  assert.equal(snapshot.backend.freshness, "stale");
  assert.equal(snapshot.backend.sourceAgeMs, 31_000);
  assert.equal(snapshot.generatedAt, new Date(fixedNow - 31_000).toISOString());
  await adapter.disconnect();
});

test("missing and future source timestamps remain unverified", async () => {
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
    assert.notEqual(snapshot.backend.freshness, "fresh");
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

test("publishes only read-only route and freshness contract metadata", () => {
  assert.deepEqual(dgmMatAdapterContract.allowedMethods, ["GET"]);
  assert.deepEqual(dgmMatAdapterContract.allowedPaths, ["/runtime/state"]);
  assert.equal(dgmMatAdapterContract.sourceTimestampField, "timestamp");
  assert.equal(dgmMatAdapterContract.requiresInjectedSecureSession, true);
  assert.equal(dgmMatAdapterContract.remotePairingSupported, false);
});
