import test from "node:test";
import assert from "node:assert/strict";
import { DgmMatLocalSessionProvider } from "../src/dgmat-local-session-provider.mjs";

const bootstrap = "b".repeat(72);
const jsonResponse = (payload, status = 201) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name === "content-type" ? "application/json" : null },
  json: async () => payload
});
const validSession = (overrides = {}) => ({
  access_token: "short-lived-access-token-123456",
  token_type: "Bearer",
  expires_in: 1800,
  expires_at: 1_800_000_000,
  session_id: "session-12345678",
  scopes: ["local-client"],
  ...overrides
});

test("requires an injected host keystore provider and exact loopback origin", () => {
  assert.throws(() => new DgmMatLocalSessionProvider(), /keystore_provider/);
  const provider = async () => bootstrap;
  for (const baseUrl of [
    "http://192.168.1.20:8181",
    "http://127.0.0.1:8182",
    "http://127.0.0.1:8181/auth",
    "http://127.0.0.1:8181/?next=elsewhere",
    "http://user:pass@127.0.0.1:8181",
    "https://127.0.0.1:8181"
  ]) {
    assert.throws(() => new DgmMatLocalSessionProvider({ getBootstrapCredential: provider, baseUrl }), /loopback_endpoint/);
  }
});

test("exchanges bootstrap credential only through loopback POST and caches access token in memory", async () => {
  const calls = [];
  let credentialReads = 0;
  const provider = new DgmMatLocalSessionProvider({
    now: () => 1_800_000_000_000,
    getBootstrapCredential: async () => { credentialReads += 1; return bootstrap; },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(validSession());
    }
  });

  const first = await provider.getAccessToken();
  const second = await provider.getAccessToken();
  assert.equal(first, second);
  assert.equal(credentialReads, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8181/auth/session");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + bootstrap);
  assert.deepEqual(JSON.parse(calls[0].init.body), { client_id: "office-kit-dgmat" });
  assert.equal(provider.getState().storage, "memory-only-session-token");
  assert.equal(provider.getState().bootstrapCredentialRetained, false);
  await provider.disconnect();
  assert.equal(provider.getState().authenticated, false);
});

test("rejects invalid session clock values before reading bootstrap credentials", async () => {
  for (const invalidClock of [NaN, Infinity, -Infinity, 8_640_000_000_000_001, -8_640_000_000_000_001]) {
    let credentialReads = 0;
    let fetchCalls = 0;
    const provider = new DgmMatLocalSessionProvider({
      now: () => invalidClock,
      getBootstrapCredential: async () => { credentialReads += 1; return bootstrap; },
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse(validSession()); }
    });
    await assert.rejects(provider.getAccessToken(), /dgm_mat_clock_invalid/);
    assert.equal(credentialReads, 0);
    assert.equal(fetchCalls, 0);
    assert.throws(() => provider.getState(), /dgm_mat_clock_invalid/);
  }
});

test("does not cache a session when the clock becomes invalid before expiry is recorded", async () => {
  let clockCalls = 0;
  let invalidDuringIssue = true;
  let fetchCalls = 0;
  const provider = new DgmMatLocalSessionProvider({
    now: () => {
      clockCalls += 1;
      if (invalidDuringIssue && clockCalls >= 2) return NaN;
      return 1_800_000_000_000;
    },
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(validSession());
    }
  });

  await assert.rejects(provider.getAccessToken(), /dgm_mat_clock_invalid/);
  assert.equal(fetchCalls, 1);
  assert.throws(() => provider.getState(), /dgm_mat_clock_invalid/);

  invalidDuringIssue = false;
  clockCalls = 0;
  const token = await provider.getAccessToken();
  assert.equal(token, "short-lived-access-token-123456");
  assert.equal(fetchCalls, 2);
  assert.equal(provider.getState().authenticated, true);
});

test("coalesces concurrent session exchanges", async () => {
  let calls = 0;
  const provider = new DgmMatLocalSessionProvider({
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return jsonResponse(validSession());
    }
  });
  const tokens = await Promise.all([
    provider.getAccessToken(),
    provider.getAccessToken(),
    provider.getAccessToken()
  ]);
  assert.equal(calls, 1);
  assert.equal(new Set(tokens).size, 1);
});

test("rejects missing local bootstrap credential without making a request", async () => {
  let calls = 0;
  const provider = new DgmMatLocalSessionProvider({
    getBootstrapCredential: async () => "invalid",
    fetchImpl: async () => { calls += 1; return jsonResponse(validSession()); }
  });
  await assert.rejects(provider.getAccessToken(), /bootstrap_credential_invalid/);
  assert.equal(calls, 0);
});

test("fails closed on rejected bootstrap credential and malformed session scopes", async () => {
  const rejected = new DgmMatLocalSessionProvider({
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => jsonResponse({}, 401)
  });
  await assert.rejects(rejected.getAccessToken(), /bootstrap_credential_rejected/);

  const wrongScope = new DgmMatLocalSessionProvider({
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => jsonResponse(validSession({ scopes: ["operator"] }))
  });
  await assert.rejects(wrongScope.getAccessToken(), /session_response_invalid/);
});

test("refreshes an expiring token and invalidation clears the cached session", async () => {
  let now = 10_000;
  let calls = 0;
  const provider = new DgmMatLocalSessionProvider({
    now: () => now,
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(validSession({ access_token: "access-token-number-" + calls, expires_in: 30 }));
    }
  });
  const first = await provider.getAccessToken();
  now += 20_000;
  const second = await provider.getAccessToken();
  assert.notEqual(first, second);
  assert.equal(calls, 2);
  provider.invalidate();
  assert.equal(provider.getState().authenticated, false);
});


test("one exchange deadline includes a hanging bootstrap keystore provider", async () => {
  let providerSignal;
  const provider = new DgmMatLocalSessionProvider({
    timeoutMs: 250,
    getBootstrapCredential: async ({ signal }) => {
      providerSignal = signal;
      return new Promise(() => {});
    },
    fetchImpl: async () => jsonResponse(validSession())
  });
  await assert.rejects(provider.getAccessToken(), /dgm_mat_session_exchange_timeout/);
  assert.equal(providerSignal.aborted, true);
  assert.equal(provider.getState().authenticated, false);
});

test("one exchange deadline includes fetch and response-body parsing", async () => {
  const hangingFetch = new DgmMatLocalSessionProvider({
    timeoutMs: 250,
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => new Promise(() => {})
  });
  await assert.rejects(hangingFetch.getAccessToken(), /dgm_mat_session_exchange_timeout/);

  const hangingBody = new DgmMatLocalSessionProvider({
    timeoutMs: 250,
    getBootstrapCredential: async () => bootstrap,
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      headers: { get: () => "application/json" },
      json: async () => new Promise(() => {})
    })
  });
  await assert.rejects(hangingBody.getAccessToken(), /dgm_mat_session_exchange_timeout/);
  assert.equal(hangingBody.getState().authenticated, false);
});

test("disconnect aborts in-flight bootstrap work and prevents late session resurrection", async () => {
  let credentialReads = 0;
  let fetchCalls = 0;
  let firstSignal;
  let signalReady;
  const started = new Promise(resolve => { signalReady = resolve; });
  let releaseFirstCredential;
  const firstCredential = new Promise(resolve => { releaseFirstCredential = resolve; });
  const provider = new DgmMatLocalSessionProvider({
    timeoutMs: 5_000,
    getBootstrapCredential: async ({ signal }) => {
      credentialReads += 1;
      if (credentialReads === 1) {
        firstSignal = signal;
        signalReady();
        return firstCredential;
      }
      return bootstrap;
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(validSession({ access_token: "fresh-session-token-123456" }));
    }
  });

  const pending = provider.getAccessToken();
  await started;
  await provider.disconnect();
  await assert.rejects(pending, /dgm_mat_session_exchange_timeout/);
  assert.equal(firstSignal.aborted, true);
  releaseFirstCredential(bootstrap);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCalls, 0);
  assert.equal(provider.getState().authenticated, false);

  const freshToken = await provider.getAccessToken();
  assert.equal(freshToken, "fresh-session-token-123456");
  assert.equal(fetchCalls, 1);
});

test("caller cancellation aborts the bootstrap exchange and provider errors are normalized", async () => {
  const controller = new AbortController();
  let providerStarted;
  const started = new Promise(resolve => { providerStarted = resolve; });
  const provider = new DgmMatLocalSessionProvider({
    timeoutMs: 5_000,
    getBootstrapCredential: async ({ signal }) => {
      providerStarted(signal);
      return new Promise(() => {});
    },
    fetchImpl: async () => jsonResponse(validSession())
  });
  const request = provider.getAccessToken({ signal: controller.signal });
  const providerSignal = await started;
  controller.abort();
  await assert.rejects(request, /dgm_mat_session_exchange_timeout/);
  assert.equal(providerSignal.aborted, true);

  const unsafeProvider = new DgmMatLocalSessionProvider({
    getBootstrapCredential: async () => { throw new Error("Bearer private-bootstrap-secret"); },
    fetchImpl: async () => jsonResponse(validSession())
  });
  await assert.rejects(unsafeProvider.getAccessToken(), /dgm_mat_bootstrap_credential_unavailable/);
});
