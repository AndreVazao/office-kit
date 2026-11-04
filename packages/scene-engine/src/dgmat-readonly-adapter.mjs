const DEFAULT_BASE_URL = "http://127.0.0.1:8181";
const SOURCE_ID = "dgm-mat";
const ALLOWED_PATHS = new Set(["/runtime/status"]);
const isLoopbackUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port === "8181" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};

/**
 * Read-only DGM-MAT adapter.
 *
 * The host injects an access-token provider backed by its secure local session
 * manager. This adapter never reads bootstrap files, stores credentials, pairs
 * remote clients, or issues non-GET requests.
 */
export class DgmMatReadOnlyAdapter {
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    getAccessToken,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    timeoutMs = 5_000,
    pollIntervalMs = 5_000
  } = {}) {
    if (!isLoopbackUrl(baseUrl)) throw new TypeError("dgm_mat_loopback_http_endpoint_required");
    if (typeof getAccessToken !== "function") throw new TypeError("dgm_mat_secure_session_provider_required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) throw new TypeError("timeoutMs must be between 250 and 30000");
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) throw new TypeError("pollIntervalMs must be between 1000 and 60000");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.apiVersion = 1;
    this.metadata = Object.freeze({ id: SOURCE_ID, name: "DGM-MAT read-only adapter", version: "0.1.0" });
    this.capabilities = Object.freeze(["read_state"]);
    this.connected = false;
    this.listeners = new Set();
    this.pollTimer = null;
    this.inFlight = false;
    this.sequence = 0;
    this.sessionId = "dgm-mat-session";
  }

  async #get(path) {
    if (!ALLOWED_PATHS.has(path)) throw new Error("dgm_mat_route_not_allowlisted");
    const token = await this.getAccessToken();
    if (typeof token !== "string" || token.length < 16 || token.trim() !== token || /\s/.test(token)) {
      throw new Error("dgm_mat_local_session_unavailable");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.baseUrl + path, {
        method: "GET",
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });
      if (!response || !response.ok) {
        const status = Number.isInteger(response?.status) ? response.status : 0;
        throw new Error(status === 401 || status === 403 ? "dgm_mat_session_rejected" : "dgm_mat_http_" + status);
      }
      const contentType = response.headers?.get?.("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) throw new Error("dgm_mat_invalid_content_type");
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("dgm_mat_invalid_response");
      return data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("dgm_mat_request_timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect() {
    if (this.connected) return { connected: true, sourceId: SOURCE_ID };
    await this.#get("/runtime/status");
    this.connected = true;
    this.sequence = 0;
    this.#startPolling();
    return { connected: true, sourceId: SOURCE_ID, mode: "read-only" };
  }

  async getSnapshot() {
    if (!this.connected) throw new Error("dgm_mat_adapter_not_connected");
    const status = await this.#get("/runtime/status");
    // The current DGM-MAT status route does not provide a verifiable source
    // timestamp or synchronization watermark. Keep the payload unverified.
    return {
      schemaVersion: 1,
      sourceId: SOURCE_ID,
      snapshotId: "dgm-mat-" + this.now() + "-" + (++this.sequence),
      generatedAt: new Date(this.now()).toISOString(),
      connectionState: "synchronizing",
      synchronized: false,
      agents: [],
      tasks: [],
      backend: {
        runtimeStatus: typeof status.status === "string" ? status.status : "unknown",
        degraded: typeof status.is_degraded === "boolean" ? status.is_degraded : null,
        activeMissionCount: Number.isSafeInteger(status.missions_active) ? status.missions_active : null,
        receivedAt: new Date(this.now()).toISOString(),
        freshness: "unverified_source_timestamp"
      }
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    if (!this.connected) throw new Error("dgm_mat_adapter_not_connected");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(type, payload) {
    const event = Object.freeze({
      schemaVersion: 1,
      sourceId: SOURCE_ID,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      type,
      timestamp: new Date(this.now()).toISOString(),
      payload
    });
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* An observer cannot interrupt polling. */ }
    }
  }

  #startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (!this.connected || this.inFlight) return;
      this.inFlight = true;
      try {
        const snapshot = await this.getSnapshot();
        this.#emit("snapshot", snapshot);
      } catch (error) {
        this.#emit("connection", { state: "error", reason: error instanceof Error ? error.message : "dgm_mat_poll_failed" });
      } finally {
        this.inFlight = false;
      }
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  async disconnect() {
    this.connected = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.listeners.clear();
    return { disconnected: true };
  }
}

export const dgmMatAdapterContract = Object.freeze({
  id: SOURCE_ID,
  mode: "read-only",
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedMethods: Object.freeze(["GET"]),
  allowedPaths: Object.freeze([...ALLOWED_PATHS]),
  requiresInjectedSecureSession: true,
  remotePairingSupported: false,
  sourceFreshnessVerified: false
});
