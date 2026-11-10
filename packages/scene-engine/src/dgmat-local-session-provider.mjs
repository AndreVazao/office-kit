const DEFAULT_BASE_URL = "http://127.0.0.1:8181";
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,63}$/;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;

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

async function runWithDeadline(run, timeoutMs, timeoutCode, parentSignal) {
  const controller = new AbortController();
  let timer;
  let removeParentAbort = () => {};
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  const parentAbort = new Promise((_, reject) => {
    if (!parentSignal) return;
    const onAbort = () => {
      controller.abort();
      reject(new Error(timeoutCode));
    };
    if (parentSignal.aborted) {
      onAbort();
      return;
    }
    parentSignal.addEventListener("abort", onAbort, { once: true });
    removeParentAbort = () => parentSignal.removeEventListener("abort", onAbort);
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
    removeParentAbort();
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
    const now = this.#clock();
    if (this.#accessToken && now + 15_000 < this.#expiresAt) return this.#accessToken;
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.#issueSession(signal);
    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = null;
    }
  }

  async #issueSession(parentSignal) {
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

        this.#accessToken = payload.access_token;
        this.#expiresAt = this.#clock() + payload.expires_in * 1000;
        return this.#accessToken;
      } finally {
        bootstrapCredential = null;
      }
    }, this.#timeoutMs, "dgm_mat_session_exchange_timeout", parentSignal);
  }

  invalidate() {
    this.#accessToken = null;
    this.#expiresAt = 0;
    return { invalidated: true };
  }

  async disconnect() {
    this.invalidate();
    return { disconnected: true };
  }

  getState() {
    return Object.freeze({
      authenticated: Boolean(this.#accessToken && this.#clock() < this.#expiresAt),
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
