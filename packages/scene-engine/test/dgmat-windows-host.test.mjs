import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsDgmMatHost } from "../src/dgmat-windows-host.mjs";

function makeFetch() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", authorization: options.headers?.Authorization ?? null });
    if (url.endsWith("/auth/session")) {
      return {
        ok: true,
        status: 201,
        headers: { get: () => "application/json" },
        async json() {
          return {
            token_type: "Bearer",
            access_token: "local-session-token-0123456789",
            expires_in: 300,
            scopes: ["local-client"],
            session_id: "dgm-mat-session-0001"
          };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async json() {
        return { timestamp: Date.now() / 1000, agents: [], tasks: [] };
      }
    };
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
    installationId: "officekit-dgmat-test-00000000000000000000000000000000",
    ready: Promise.resolve({ status: "empty" }),
    createSecretStore(namespace) {
      calls.namespace = namespace;
      return {
        async setSecret(name, value) { assert.equal(name, "bootstrap"); secret = value; },
        async getSecret(name) { assert.equal(name, "bootstrap"); return secret; },
        async destroy() { calls.destroyed += 1; const hadSecret = secret !== null; secret = null; return { deletedCount: hadSecret ? 1 : 0, keyDeleted: true }; }
      };
    },
    async health() { return { status: "ready", identityStatus: "empty" }; },
    async close() { closed = true; calls.closed += 1; }
  };
}

test("DGM-MAT Windows host requires explicit credential consent and explicit connect", async () => {
  const host = makeHost();
  const { fetchImpl, calls } = makeFetch();
  const bootstrapSecret = "bootstrap-credential-" + "0123456789".repeat(5);
  const composed = createWindowsDgmMatHost({
    hostFactory: () => host,
    sessionProviderOptions: { fetchImpl, timeoutMs: 1_000 },
    adapterOptions: { fetchImpl, timeoutMs: 1_000, pollIntervalMs: 60_000 }
  });

  try {
    assert.equal(host.calls.namespace, "dgmat.bootstrap");
    assert.equal(calls.length, 0);
    assert.equal(composed.edition, "dgmat");
    await assert.rejects(
      composed.provisionBootstrapCredential({ secret: bootstrapSecret }),
      /owner_consent_required/
    );
    await assert.rejects(
      composed.provisionBootstrapCredential({ secret: "short", ownerConsent: true }),
      /bootstrap_credential_invalid/
    );
    assert.equal(host.secret, null);
    const provisioned = await composed.provisionBootstrapCredential({
      secret: bootstrapSecret,
      ownerConsent: true
    });
    assert.equal(provisioned.stored, true);
    assert.equal(host.secret, bootstrapSecret);
    assert.equal(calls.length, 0);

    const connected = await composed.connect();
    assert.equal(connected.connected, true);
    assert.equal(calls.filter(call => call.url.endsWith("/auth/session")).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith("/runtime/state")).length, 1);

    const snapshot = await composed.getSnapshot();
    assert.equal(snapshot.synchronized, false);
    assert.equal(snapshot.connectionState, "synchronizing");
    assert.equal(snapshot.backend.sourceSnapshotFreshness, "unverified");
    assert.deepEqual(snapshot.agents, []);
    assert.deepEqual(snapshot.tasks, []);
    assert.ok(calls.every(call => call.url.endsWith("/auth/session")
      ? call.method === "POST"
      : call.method === "GET"));
    const health = await composed.health();
    assert.equal(health.edition, "dgmat");
    assert.equal(health.adapterConnected, true);
    assert.equal(health.backendOperationalState, "unverified");
    assert.equal(health.backendSession.authenticated, true);

    const removed = await composed.removeBootstrapCredential({ ownerConsent: true });
    assert.equal(removed.deletedCount, 1);
    assert.equal(removed.keyDeleted, true);
    assert.equal(host.secret, null);
    await assert.rejects(composed.connect(), /bootstrap_credential_invalid/);
    assert.equal(calls.filter(call => call.url.endsWith("/auth/session")).length, 1);
  } finally {
    await composed.close();
  }
  assert.equal(host.closed, true);
  assert.equal(host.calls.closed, 1);
});

test("DGM-MAT Windows host rejects mismatched session and adapter endpoints before creating a host", () => {
  let created = false;
  assert.throws(() => createWindowsDgmMatHost({
    hostFactory: () => { created = true; return makeHost(); },
    sessionProviderOptions: { baseUrl: "http://127.0.0.1:8181" },
    adapterOptions: { baseUrl: "http://localhost:8181" }
  }), /endpoint_mismatch/);
  assert.equal(created, false);
});

test("DGM-MAT Windows host rejects non-loopback endpoints before host creation", () => {
  let created = false;
  assert.throws(() => createWindowsDgmMatHost({
    hostFactory: () => { created = true; return makeHost(); },
    sessionProviderOptions: { baseUrl: "http://example.com:8181" }
  }), /exact_loopback_endpoint_required/);
  assert.equal(created, false);
});
