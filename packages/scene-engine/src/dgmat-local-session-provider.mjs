const DEFAULT_BASE_URL = "http://127.0.0.1:8181";
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,63}$/;

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

/**
 * Exchanges a host-keystore supplied bootstrap credential for a short-lived
 * DGM-MAT local-client session. Bootstrap credentials are never retained.
 * This provider is intended for the desktop host on the DGM-MAT PC only.
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

  async getAccessToken() {
    const now = this.#clock();
    if (this.#accessToken && now + 15_000 < this.#expiresAt) return this.#accessToken;
    if (this.#inFlight) return this.#inFlight;

    this.#inFlight = this.#issueSession();
    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = null;
    }
  }

  async #issueSession() {
    let bootstrapCredential;
    try {
      bootstrapCredential = await this.#getBootstrapCredential();
    } catch {
      throw new Error("dgm_mat_bootstrap_credential_unavailable");
    }
    if (typeof bootstrapCredential !== "string"
      || bootstrapCredential.length < 60
      || bootstrapCredential.trim() !== bootstrapCredential
      || /\s/.test(bootstrapCredential)) {
      throw new Error("dgm_mat_bootstrap_credential_invalid");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
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
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("dgm_mat_session_exchange_timeout");
      throw new Error("dgm_mat_session_exchange_failed");
    } finally {
      clearTimeout(timer);
      bootstrapCredential = null;
    }

    if (!response?.ok || response.status !== 201) {
      const status = Number.isInteger(response?.status) ? response.status : 0;
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
      throw new Error("dgm_mat_session_response_invalid_json");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || payload.token_type !== "Bearer"
      || typeof payload.access_token !== "string"
      || payload.access_token.length < 16
      || /\s/.test(payload.access_token)
      || !Number.isSafeInteger(payload.expires_in)
      || payload.expires_in < 30
      || payload.expires_in > 1800
      || !Array.isArray(payload.scopes)
      || !payload.scopes.includes("local-client")
      || typeof payload.session_id !== "string"
      || payload.session_id.length < 8) {
      throw new Error("dgm_mat_session_response_invalid");
    }

    this.#accessToken = payload.access_token;
    this.#expiresAt = this.#clock() + payload.expires_in * 1000;
    return this.#accessToken;
  }

  invalidate() {
    this.#accessToken = null;
    this.#expiresAt = 0;
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
  maxSessionSeconds: 1800,
  requiredScope: "local-client"
});
