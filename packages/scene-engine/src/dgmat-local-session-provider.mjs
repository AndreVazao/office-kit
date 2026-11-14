const DEFAULT_BASE_URL = "http://127.0.0.1:8181";
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,63}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const MAX_DATE_MS = 8_640_000_000_000_000;

function readClock(clock) {
  let value;
  try { value = clock(); }
  catch { throw new Error("dgm_mat_clock_invalid"); }
  if (!Number.isFinite(value) || Object.is(value, -0) || Math.abs(value) > MAX_DATE_MS) {
    throw new Error("dgm_mat_clock_invalid");
  }
  return value;
}

function isExactLoopbackBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      && url.port === "8181"
      && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function runWithDeadline(run, timeoutMs, timeoutCode, parentSignal, lifecycleSignal) {
  const controller = new AbortController();
  let timer;
  const abortListeners = [];
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  const parentAbort = new Promise((_, reject) => {
    const signals = [parentSignal, lifecycleSignal].filter(Boolean);
    const onAbort = () => {
      controller.abort();
      reject(new Error(timeoutCode));
    };
    for (const signal of signals) {
      if (signal.aborted) {
        onAbort();
        break;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      abortListeners.push(() => signal.removeEventListener("abort", onAbort));
    }
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      timeout,
      parentAbort
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(timeoutCode);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    for (const remove of abortListeners) remove();
  }
}

/**
 * Exchanges a host-keystore supplied bootstrap credential for a short-lived
 * DGM-MAT local-client session. Bootstrap credentials are never retained.
 * The complete keystore/fetch/body exchange has one deadline and remains
 * restricted to the exact loopback origin.
 */
export class DgmMatLocalSessionProvider {
  #getBootstrapCredential;
  #fetch;
  #clock;
  #timeoutMs;
  #baseUrl;
  #clientId;
  #accessToken = null;
  #expiresAt = 0;
  #inFlight = null;
  #generation = 0;
  #lifecycleController = new AbortController();

  constructor({
    getBootstrapCredential,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    baseUrl = DEFAULT_BASE_URL,
    clientId = "office-kit-dgmat",
    timeoutMs = 5_000
  } = {}) {
    if (typeof getBootstrapCredential !== "function") {
      throw new TypeError("dgm_mat_bootstrap_keystore_provider_required");
    }
    if (typeof fetchImpl !== "function") throw new TypeError("fetch_implementation_required");
    if (typeof now !== "function") throw new TypeError("clock_provider_required");
    if (!isExactLoopbackBase(baseUrl)) throw new TypeError("dgm_mat_exact_loopback_endpoint_required");
    if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
      throw new TypeError("dgm_mat_client_id_invalid");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15_000) {
      throw new TypeError("timeout_ms_out_of_range");
    }
    this.#getBootstrapCredential = getBootstrapCredential;
    this.#fetch = fetchImpl;
    this.#clock = now;
    this.#timeoutMs = timeoutMs;
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#clientId = clientId;
  }

  async getAccessToken({ signal } = {}) {
    if (signal?.aborted) throw new Error("dgm_mat_session_exchange_timeout");
    const now = readClock(this.#clock);
    if (this.#accessToken && now + 15_000 < this.#expiresAt) return this.#accessToken;
    if (this.#inFlight) return this.#inFlight;

    const generation = this.#generation;
    const pending = this.#issueSession(signal, this.#lifecycleController.signal, generation);
    this.#inFlight = pending;
    try {
      const token = await pending;
      if (generation !== this.#generation) throw new Error("dgm_mat_session_exchange_timeout");
      return token;
    } finally {
      if (this.#inFlight === pending) this.#inFlight = null;
    }
  }

  async #issueSession(parentSignal, lifecycleSignal, generation) {
    return runWithDeadline(async signal => {
      let bootstrapCredential;
      try {
        try {
          bootstrapCredential = await this.#getBootstrapCredential({ signal });
        } catch {
          if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");
          throw new Error("dgm_mat_bootstrap_credential_unavailable");
        }
        if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");
        if (typeof bootstrapCredential !== "string"
          || bootstrapCredential.length < 60
          || bootstrapCredential.length > 8_192
          || bootstrapCredential.trim() !== bootstrapCredential
          || /\s/.test(bootstrapCredential)) {
          throw new Error("dgm_mat_bootstrap_credential_invalid");
        }

        let response;
        try {
          response = await this.#fetch(this.#baseUrl + "/auth/session", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + bootstrapCredential,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({ client_id: this.#clientId }),
            cache: "no-store",
            redirect: "error",
            signal
          });
        } catch {
          if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");
          throw new Error("dgm_mat_session_exchange_failed");
        } finally {
          bootstrapCredential = null;
        }
        if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");

        if (!response?.ok || response.status !== 201) {
          const status = Number.isInteger(response?.status) && response.status >= 0 && response.status <= 599
            ? response.status : 0;
          throw new Error(status === 401 || status === 403
            ? "dgm_mat_bootstrap_credential_rejected"
            : "dgm_mat_session_exchange_http_" + status);
        }
        const contentType = response.headers?.get?.("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw new Error("dgm_mat_session_response_invalid_content_type");
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");
          throw new Error("dgm_mat_session_response_invalid_json");
        }
        if (signal.aborted) throw new Error("dgm_mat_session_exchange_timeout");
        if (!payload || typeof payload !== "object" || Array.isArray(payload)
          || payload.token_type !== "Bearer"
          || typeof payload.access_token !== "string"
          || payload.access_token.length < 16
          || payload.access_token.length > 4_096
          || payload.access_token.trim() !== payload.access_token
          || /\s/.test(payload.access_token)
          || !Number.isSafeInteger(payload.expires_in)
          || payload.expires_in < 30
          || payload.expires_in > 1800
          || !Array.isArray(payload.scopes)
          || !payload.scopes.includes("local-client")
          || typeof payload.session_id !== "string"
          || !SESSION_ID_PATTERN.test(payload.session_id)) {
          throw new Error("dgm_mat_session_response_invalid");
        }

        if (generation !== this.#generation) {
          throw new Error("dgm_mat_session_exchange_timeout");
        }
        const issuedAt = readClock(this.#clock);
        const expiresAt = issuedAt + payload.expires_in * 1000;
        if (!Number.isFinite(expiresAt) || Math.abs(expiresAt) > MAX_DATE_MS) {
          throw new Error("dgm_mat_clock_invalid");
        }
        this.#accessToken = payload.access_token;
        this.#expiresAt = expiresAt;
        return this.#accessToken;
      } finally {
        bootstrapCredential = null;
      }
    }, this.#timeoutMs, "dgm_mat_session_exchange_timeout", parentSignal, lifecycleSignal);
  }

  invalidate() {
    this.#generation += 1;
    this.#lifecycleController.abort();
    this.#lifecycleController = new AbortController();
    this.#inFlight = null;
    this.#accessToken = null;
    this.#expiresAt = 0;
    return { invalidated: true };
  }

  async disconnect() {
    this.invalidate();
    return { disconnected: true };
  }

  getState() {
    const now = readClock(this.#clock);
    return Object.freeze({
      authenticated: Boolean(this.#accessToken && now < this.#expiresAt),
      expiresAt: this.#expiresAt ? new Date(this.#expiresAt).toISOString() : null,
      storage: "memory-only-session-token",
      bootstrapCredentialRetained: false
    });
  }
}

export const dgmMatLocalSessionContract = Object.freeze({
  id: "dgm-mat-local-session",
  endpoint: DEFAULT_BASE_URL + "/auth/session",
  method: "POST",
  loopbackOnly: true,
  bootstrapCredentialSource: "injected-host-keystore-provider",
  accessTokenStorage: "memory-only",
  exchangeDeadlineIncludes: Object.freeze(["bootstrap-credential-provider", "fetch", "response-body"]),
  maxSessionSeconds: 1800,
  requiredScope: "local-client"
});
