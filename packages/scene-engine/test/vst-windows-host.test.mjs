import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsVstHost } from "../src/vst-windows-host.mjs";

const fixedNow = Date.parse("2026-11-12T12:00:00.000Z");
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => "application/json" },
  json: async () => data
});
const observerState = () => ({
  ok: true,
  status: "OFF",
  mode: "PAPER",
  open_positions_count: 0,
  opportunities_count: 0,
  updated_at_ms: fixedNow,
  health_state: "unknown",
  allow_new_tasks: false,
  allow_risk_bearing_actions: false,
  health_checked_at_ms: 0
});

function makeFetch({ rejectAuth = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method ?? "GET",
      token: options.headers?.["X-Token"] ?? null,
      authorization: options.headers?.Authorization ?? null
    });
    const path = new URL(url).pathname;
    if (rejectAuth && path === "/status") return response({ ok: false }, 401);
    return response(path === "/observer/summary" ? observerState() : { ok: true, path });
  };
  return { fetchImpl, calls };
}

function makeHost() {
  let closed = false;
  const calls = { closed: 0 };
  return {
    calls,
    get closed() { return closed; },
    ready: Promise.resolve({ status: "ready" }),
    async health() { return { status: "ready", identityStatus: "empty" }; },
    async close() { closed = true; calls.closed += 1; }
  };
}

test("VST host keeps the owner token in session memory and exposes read-only cockpit data", async () => {
  const host = makeHost();
  const { fetchImpl, calls } = makeFetch();
  const ownerToken = "vst-owner-token-" + "0123456789".repeat(4);
  const composed = createWindowsVstHost({
    hostFactory: () => host,
    adapterOptions: { fetchImpl, now: () => fixedNow, timeoutMs: 1_000, pollIntervalMs: 60_000 }
  });

  try {
    assert.equal(composed.edition, "vst");
    assert.equal(composed.getCredentialState().configured, false);
    await assert.rejects(composed.setSessionToken({ token: ownerToken }), /owner_consent_required/);
    await assert.rejects(composed.setSessionToken({ token: "short", ownerConsent: true }), /token_invalid/);
    await assert.rejects(composed.connect(), /session_token_unavailable/);
    assert.equal(calls.length, 0);

    const configured = await composed.setSessionToken({ token: ownerToken, ownerConsent: true });
    assert.equal(configured.configured, true);
    assert.equal(configured.storage, "memory-session");
    assert.equal(configured.persistent, false);
    assert.equal(configured.tokenExposed, false);
    assert.equal(calls.length, 0, "setting a session token must not auto-connect");
    assert.equal(JSON.stringify(composed.getCredentialState()).includes(ownerToken), false);
    assert.equal(composed.getCredentialState().persistent, false);

    const connected = await composed.connect();
    assert.equal(connected.connected, true);
    assert.equal(calls[0].url, "http://127.0.0.1:8765/observer/summary");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].token, ownerToken);
    assert.equal(calls[0].authorization, null);

    const snapshot = await composed.getCockpitSnapshot();
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.authority.executionAuthorized, false);
    assert.equal(snapshot.sections.status.state, "available");
    assert.ok(calls.some(call => call.url.endsWith("/status") && call.method === "GET"));
    assert.ok(calls.every(call => call.method === "GET"));
    assert.ok(calls.every(call => call.token === ownerToken));
    assert.equal(JSON.stringify(snapshot).includes(ownerToken), false);

    const health = await composed.health();
    assert.equal(health.edition, "vst");
    assert.equal(health.adapterConnected, true);
    assert.equal(health.credentialsConfigured, true);
    assert.equal(health.credentialStorage, "memory-session");
    assert.equal(health.backendOperationalState, "unverified");
    assert.equal(health.backendReadOnly, true);
    assert.equal(JSON.stringify(health).includes(ownerToken), false);

    const disconnected = await composed.disconnect();
    assert.equal(disconnected.tokenCleared, true);
    assert.equal(composed.getCredentialState().configured, false);
    assert.equal(composed.getCredentialState().storage, "memory-session");
    await assert.rejects(composed.connect(), /session_token_unavailable/);
  } finally {
    await composed.close();
  }
  assert.equal(host.closed, true);
  assert.equal(host.calls.closed, 1);
  assert.equal(composed.getCredentialState().storage, "closed");
});

test("VST host clears the in-memory token after authentication rejection", async () => {
  const host = makeHost();
  const { fetchImpl } = makeFetch({ rejectAuth: true });
  const composed = createWindowsVstHost({
    hostFactory: () => host,
    adapterOptions: { fetchImpl, now: () => fixedNow, timeoutMs: 1_000, pollIntervalMs: 60_000 }
  });
  try {
    await composed.setSessionToken({
      token: "vst-owner-token-" + "0123456789".repeat(4),
      ownerConsent: true
    });
    await composed.connect();
    await assert.rejects(composed.getCockpitSnapshot(), /vst_auth_rejected/);
    assert.equal(composed.getCredentialState().configured, false);
    assert.equal(composed.getCredentialState().persistent, false);
  } finally {
    await composed.close();
  }
});

test("VST host requires explicit consent to clear a session token", async () => {
  const host = makeHost();
  const composed = createWindowsVstHost({ hostFactory: () => host });
  try {
    await composed.setSessionToken({
      token: "vst-owner-token-" + "0123456789".repeat(4),
      ownerConsent: true
    });
    await assert.rejects(composed.clearSessionToken(), /owner_consent_required/);
    const result = await composed.clearSessionToken({ ownerConsent: true });
    assert.equal(result.cleared, true);
    assert.equal(composed.getCredentialState().configured, false);
  } finally {
    await composed.close();
  }
});

test("VST host rejects non-loopback endpoints before creating a host", () => {
  let created = false;
  assert.throws(() => createWindowsVstHost({
    hostFactory: () => { created = true; return makeHost(); },
    adapterOptions: { baseUrl: "http://192.168.1.20:8765" }
  }), /exact_loopback_endpoint_required/);
  assert.equal(created, false);
});

test("VST host rejects a host without the required lifecycle contract", () => {
  assert.throws(() => createWindowsVstHost({
    hostFactory: () => ({ ready: Promise.resolve(), close: async () => {} })
  }), /lifecycle_unavailable/);
});
