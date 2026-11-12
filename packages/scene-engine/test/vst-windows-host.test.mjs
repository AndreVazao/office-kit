import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsVstHost } from "../src/vst-windows-host.mjs";

const fixedNow = Date.parse("2026-11-12T12:00:00.000Z");
const response = data => ({
  ok: true,
  status: 200,
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

function makeFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method ?? "GET",
      token: options.headers?.["X-Token"] ?? null,
      authorization: options.headers?.Authorization ?? null
    });
    return response(observerState());
  };
  return { fetchImpl, calls };
}

function makeHost() {
  let secret = null;
  let closed = false;
  const calls = { closed: 0, namespace: null, destroyed: 0 };
  return {
    calls,
    get closed() { return closed; },
    get secret() { return secret; },
    installationId: "officekit-vst-test-00000000000000000000000000000000",
    ready: Promise.resolve({ status: "empty" }),
    createSecretStore(namespace) {
      calls.namespace = namespace;
      return {
        async setSecret(name, value) {
          assert.equal(name, "owner-token");
          secret = value;
        },
        async getSecret(name) {
          assert.equal(name, "owner-token");
          return secret;
        },
        hasSecret(name) {
          assert.equal(name, "owner-token");
          return secret !== null;
        },
        async destroy() {
          calls.destroyed += 1;
          const hadSecret = secret !== null;
          secret = null;
          return { deletedCount: hadSecret ? 1 : 0, keyDeleted: true };
        }
      };
    },
    async health() { return { status: "ready", identityStatus: "empty" }; },
    async close() { closed = true; calls.closed += 1; }
  };
}

test("VST Windows host requires explicit consent and never auto-connects on credential provisioning", async () => {
  const host = makeHost();
  const { fetchImpl, calls } = makeFetch();
  const ownerToken = "vst-owner-token-" + "0123456789".repeat(4);
  const composed = createWindowsVstHost({
    hostFactory: () => host,
    adapterOptions: { fetchImpl, now: () => fixedNow, timeoutMs: 1_000, pollIntervalMs: 60_000 }
  });

  try {
    assert.equal(host.calls.namespace, "vst.local-api");
    assert.equal(calls.length, 0);
    assert.equal(composed.edition, "vst");
    await assert.rejects(
      composed.provisionLocalApiToken({ token: ownerToken }),
      /owner_consent_required/
    );
    await assert.rejects(
      composed.provisionLocalApiToken({ token: "short", ownerConsent: true }),
      /token_invalid/
    );
    assert.equal(host.secret, null);

    const provisioned = await composed.provisionLocalApiToken({
      token: ownerToken,
      ownerConsent: true
    });
    assert.equal(provisioned.stored, true);
    assert.equal(provisioned.namespace, "vst.local-api");
    assert.equal(provisioned.hardwareBacked, false);
    assert.equal(provisioned.tokenCachedInMemory, false);
    assert.equal(host.secret, ownerToken);
    assert.equal(calls.length, 0);

    const credentialState = composed.getCredentialState();
    assert.equal(credentialState.configured, true);
    assert.equal(credentialState.tokenExposed, false);
    assert.equal(JSON.stringify(credentialState).includes(ownerToken), false);

    const health = await composed.health();
    assert.equal(health.edition, "vst");
    assert.equal(health.adapterConnected, false);
    assert.equal(health.credentialsConfigured, true);
    assert.equal(health.backendOperationalState, "unverified");
    assert.equal(health.backendReadOnly, true);
    assert.equal(JSON.stringify(health).includes(ownerToken), false);

    const connected = await composed.connect();
    assert.equal(connected.connected, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8765/observer/summary");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].token, ownerToken);
    assert.equal(calls[0].authorization, null);

    const snapshot = await composed.getSnapshot();
    assert.equal(snapshot.backend.engineStatus, "OFF");
    assert.equal(snapshot.backend.mode, "PAPER");
    assert.equal(snapshot.backend.executionAuthorized, false);
    assert.equal(snapshot.backend.runtimeReadiness, "unverified");
    assert.deepEqual(snapshot.agents, []);
    assert.deepEqual(snapshot.tasks, []);

    const removed = await composed.removeLocalApiToken({ ownerConsent: true });
    assert.equal(removed.deletedCount, 1);
    assert.equal(removed.keyDeleted, true);
    assert.equal(host.secret, null);
    await assert.rejects(composed.connect(), /vst_local_token_unavailable/);
    assert.equal(calls.length, 2);
  } finally {
    await composed.close();
  }
  assert.equal(host.closed, true);
  assert.equal(host.calls.closed, 1);
});

test("VST Windows host rejects non-loopback endpoints before creating a host", () => {
  let created = false;
  assert.throws(() => createWindowsVstHost({
    hostFactory: () => { created = true; return makeHost(); },
    adapterOptions: { baseUrl: "http://192.168.1.20:8765" }
  }), /exact_loopback_endpoint_required/);
  assert.equal(created, false);
});

test("VST Windows host rejects a host without the secure secret-store contract", () => {
  assert.throws(() => createWindowsVstHost({
    hostFactory: () => ({ ready: Promise.resolve(), close: async () => {} })
  }), /secret_store_unavailable/);
});


test("VST Windows host rejects an incomplete secret-vault implementation", () => {
  let closed = false;
  assert.throws(() => createWindowsVstHost({
    hostFactory: () => ({
      ready: Promise.resolve(),
      createSecretStore: () => ({ getSecret: async () => null }),
      async close() { closed = true; }
    })
  }), /secret_store_unavailable/);
  assert.equal(closed, false, "host close is asynchronous and is requested by the failure path");
});
