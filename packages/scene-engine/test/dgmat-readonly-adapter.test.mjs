import test from "node:test";
import assert from "node:assert/strict";
import { DgmMatReadOnlyAdapter } from "../src/dgmat-readonly-adapter.mjs";

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name === "content-type" ? "application/json" : null },
  json: async () => data
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

test("uses authenticated GET only and exposes read-only capability", async () => {
  const calls = [];
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response({ status: "running", is_degraded: false, missions_active: 2 }); }
  });
  const result = await adapter.connect();
  assert.equal(result.connected, true);
  assert.deepEqual(adapter.capabilities, ["read_state"]);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secure-session-token-123");
  assert.equal(calls[0].init.cache, "no-store");
  await adapter.disconnect();
});

test("maps only allowlisted runtime summary and does not claim authoritative freshness", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    now: () => Date.parse("2026-11-04T12:00:00.000Z"),
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async () => response({ status: "running", is_degraded: true, missions_active: 3, secret: "must-not-leak" })
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "synchronizing");
  assert.equal(snapshot.synchronized, false);
  assert.deepEqual(snapshot.agents, []);
  assert.equal(snapshot.backend.runtimeStatus, "running");
  assert.equal(snapshot.backend.degraded, true);
  assert.equal(snapshot.backend.activeMissionCount, 3);
  assert.equal("secret" in snapshot.backend, false);
  await adapter.disconnect();
});

test("fails closed on expired/rejected sessions and never follows redirects", async () => {
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "secure-session-token-123",
    fetchImpl: async (_url, init) => { assert.equal(init.redirect, "error"); return response({}, 401); }
  });
  await assert.rejects(adapter.connect(), /session_rejected/);
});

test("refuses missing or malformed session tokens", async () => {
  const adapter = new DgmMatReadOnlyAdapter({ getAccessToken: async () => "short", fetchImpl: async () => response({}) });
  await assert.rejects(adapter.connect(), /session_unavailable/);
});

test("invalidates the injected local session after authentication rejection", async () => {
  let invalidations = 0;
  const adapter = new DgmMatReadOnlyAdapter({
    getAccessToken: async () => "secure-session-token-123",
    invalidateAccessToken: () => { invalidations += 1; },
    fetchImpl: async () => response({}, 401)
  });
  await assert.rejects(adapter.connect(), /session_rejected/);
  assert.equal(invalidations, 1);
});
