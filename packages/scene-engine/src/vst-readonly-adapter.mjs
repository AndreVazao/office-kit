import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const SOURCE_ID = "vazao-sovereign-trader";
const ALLOWED_PATHS = new Set(["/observer/summary"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENGINE_STATUSES = new Set([
  "OFF", "STARTING", "RUNNING", "PAUSED", "STOPPING",
  "SAFE_MODE", "KILL_SWITCH", "DEGRADED", "ERROR", "UNKNOWN"
]);
const MODES = new Set(["PAPER", "REAL", "UNKNOWN"]);
const HEALTH_STATES = new Set(["healthy", "degraded", "quarantined", "unknown", "unavailable", "blocked", "failed"]);
const SAFE_ERROR_CODES = new Set([
  "vst_request_timeout",
  "vst_token_provider_failed",
  "vst_local_token_unavailable",
  "vst_local_token_vault_unavailable",
  "vst_local_token_invalid",
  "vst_auth_rejected",
  "vst_transport_error",
  "vst_invalid_content_type",
  "vst_invalid_response",
  "vst_invalid_response_body",
  "vst_clock_invalid",
  "vst_session_identity_unavailable",
  "vst_connection_superseded",
  "vst_adapter_not_connected",
  "vst_adapter_connect_failed",
  "vst_poll_failed"
]);

const isLoopbackUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && url.port === "8765"
      && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};

function safeErrorCode(error, fallback = "vst_transport_error") {
  const value = error instanceof Error ? error.message : "";
  if (SAFE_ERROR_CODES.has(value)) return value;
  if (/^vst_http_(?:0|[1-5][0-9]{2})$/.test(value)) return value;
  return fallback;
}

async function runWithDeadline(run, timeoutMs, timeoutCode, { signal: parentSignal, abortCode = "vst_connection_superseded" } = {}) {
  if (parentSignal?.aborted) throw new Error(abortCode);
  const controller = new AbortController();
  let timer;
  let parentAbortHandler;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  const operations = [Promise.resolve().then(() => run(controller.signal)), timeout];
  if (parentSignal) {
    operations.push(new Promise((_, reject) => {
      parentAbortHandler = () => {
        controller.abort();
        reject(new Error(abortCode));
      };
      parentSignal.addEventListener("abort", parentAbortHandler, { once: true });
      if (parentSignal.aborted) parentAbortHandler();
    }));
  }
  try {
    return await Promise.race(operations);
  } catch (error) {
    if (parentSignal?.aborted) throw new Error(abortCode);
    if (controller.signal.aborted || error?.name === "AbortError") throw new Error(timeoutCode);
    throw error;
  } finally {
    clearTimeout(timer);
    if (parentSignal && parentAbortHandler) {
      parentSignal.removeEventListener("abort", parentAbortHandler);
    }
  }
}

function safeEnum(value, allowed, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function safeHealthState(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return HEALTH_STATES.has(normalized) ? normalized : "unknown";
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
}

function safeTimestamp(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000
    ? value
    : null;
}

function freshnessFor(timestampMs, now, ttlMs) {
  if (timestampMs === null) return { state: "unavailable", ageMs: null };
  const ageMs = now - timestampMs;
  if (ageMs < 0) return { state: "future_or_clock_skew", ageMs };
  if (ageMs <= ttlMs) return { state: "fresh", ageMs };
  return { state: "stale", ageMs };
}

/**
 * Read-only VST adapter.
 *
 * It uses only authenticated loopback GET /observer/summary with X-Token.
 * The observer timestamp is the latest publication time, not proof of engine
 * readiness, PAPER/REAL authorization, agent activity, or trading authority.
 */
export class VstReadOnlyAdapter {
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    getAccessToken,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    createSessionId = randomUUID,
    timeoutMs = 5_000,
    pollIntervalMs = 10_000,
    ttlMs = 30_000
  } = {}) {
    if (!isLoopbackUrl(baseUrl)) throw new TypeError("vst_loopback_http_endpoint_required");
    if (typeof getAccessToken !== "function") throw new TypeError("vst_secure_token_provider_required");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch_implementation_required");
    if (typeof now !== "function") throw new TypeError("clock_provider_required");
    if (typeof createSessionId !== "function") throw new TypeError("session_identity_provider_required");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
      throw new TypeError("timeout_ms_out_of_range");
    }
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) {
      throw new TypeError("poll_interval_ms_out_of_range");
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 120_000) {
      throw new TypeError("snapshot_ttl_ms_out_of_range");
    }

    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.createSessionId = createSessionId;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.ttlMs = ttlMs;
    this.apiVersion = 1;
    this.metadata = Object.freeze({ id: SOURCE_ID, name: "Vazao Sovereign Trader read-only adapter", version: "0.1.0" });
    this.capabilities = Object.freeze(["read_state"]);
    this.connected = false;
    this.listeners = new Set();
    this.pollTimer = null;
    this.inFlightGeneration = null;
    this.connectionGeneration = 0;
    this.connectionAbortController = null;
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.sessionId = null;
    this.authenticationRejected = false;
  }

  async #get(path, { signal } = {}) {
    if (!ALLOWED_PATHS.has(path)) throw new Error("vst_route_not_allowlisted");
    return runWithDeadline(async signal => {
      let token;
      try {
        token = await this.getAccessToken({ signal });
      } catch (error) {
        if (signal.aborted) throw new Error("vst_request_timeout");
        throw new Error(safeErrorCode(error, "vst_token_provider_failed"));
      }
      if (signal.aborted) throw new Error("vst_request_timeout");
      if (typeof token !== "string" || token.length < 16 || token.length > 8_192
        || token.trim() !== token || /\s/.test(token)) {
        throw new Error("vst_local_token_unavailable");
      }

      let response;
      try {
        response = await this.fetchImpl(this.baseUrl + path, {
          method: "GET",
          headers: { "X-Token": token, Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal
        });
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw new Error("vst_request_timeout");
        throw new Error("vst_transport_error");
      } finally {
        token = null;
      }
      if (signal.aborted) throw new Error("vst_request_timeout");

      if (!response || !response.ok) {
        const status = Number.isInteger(response?.status) && response.status >= 0 && response.status <= 599
          ? response.status : 0;
        if (status === 401 || status === 403) {
          this.authenticationRejected = true;
          throw new Error("vst_auth_rejected");
        }
        throw new Error("vst_http_" + status);
      }

      const contentType = response.headers?.get?.("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("vst_invalid_content_type");
      }
      let data;
      try {
        data = await response.json();
      } catch {
        if (signal.aborted) throw new Error("vst_request_timeout");
        throw new Error("vst_invalid_response_body");
      }
      if (signal.aborted) throw new Error("vst_request_timeout");
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("vst_invalid_response");
      }
      return data;
    }, this.timeoutMs, "vst_request_timeout", { signal });
  }

  #toSnapshot(source) {
    const receivedAt = this.now();
    if (!Number.isFinite(receivedAt) || receivedAt <= 0 || receivedAt > 8_640_000_000_000_000) {
      throw new Error("vst_clock_invalid");
    }

    const observerAccepted = source.ok === true;
    const updatedAtMs = observerAccepted ? safeTimestamp(source.updated_at_ms) : null;
    const freshness = freshnessFor(updatedAtMs, receivedAt, this.ttlMs);
    const healthCheckedAtMs = observerAccepted ? safeTimestamp(source.health_checked_at_ms) : null;
    const healthFreshness = freshnessFor(healthCheckedAtMs, receivedAt, this.ttlMs);
    const engineStatus = observerAccepted ? safeEnum(source.status, ENGINE_STATUSES, "UNKNOWN") : "UNKNOWN";
    const mode = observerAccepted ? safeEnum(source.mode, MODES, "UNKNOWN") : "UNKNOWN";
    const synchronized = observerAccepted && freshness.state === "fresh"
      && engineStatus !== "UNKNOWN" && mode !== "UNKNOWN";
    const generatedAtMs = updatedAtMs !== null && freshness.ageMs >= 0 ? updatedAtMs : receivedAt;
    const sourceUpdatedAt = updatedAtMs !== null ? new Date(updatedAtMs).toISOString() : null;
    const healthCheckedAt = healthCheckedAtMs !== null ? new Date(healthCheckedAtMs).toISOString() : null;

    return {
      schemaVersion: 1,
      sourceId: SOURCE_ID,
      snapshotId: "vst-" + (updatedAtMs ?? "unavailable") + "-" + (++this.snapshotSequence),
      generatedAt: new Date(generatedAtMs).toISOString(),
      connectionState: observerAccepted && updatedAtMs !== null ? "connected" : "synchronizing",
      synchronized,
      agents: [],
      tasks: [],
      backend: {
        transportReachable: true,
        engineStatus,
        engineRunning: engineStatus === "RUNNING",
        observerResponseAccepted: observerAccepted,
        mode,
        paperOnly: mode === "PAPER",
        openPositionsCount: observerAccepted ? safeCount(source.open_positions_count) : null,
        opportunitiesCount: observerAccepted ? safeCount(source.opportunities_count) : null,
        healthState: observerAccepted ? safeHealthState(source.health_state) : "unknown",
        healthCheckedAt,
        healthAgeMs: healthFreshness.ageMs,
        healthFreshness: healthFreshness.state,
        allowNewTasks: observerAccepted && source.allow_new_tasks === true,
        allowRiskBearingActions: false,
        executionAuthorized: false,
        runtimeReadiness: "unverified",
        sourceStateUpdatedAt: sourceUpdatedAt,
        sourceStateAgeMs: freshness.ageMs,
        sourceSnapshotFreshness: freshness.state,
        sourceTimestampSemantics: "last_observer_publish_time_not_engine_readiness",
        receivedAt: new Date(receivedAt).toISOString()
      }
    };
  }

  async connect() {
    if (this.connected && this.authenticationRejected) throw new Error("vst_auth_rejected");
    if (this.connected) return { connected: true, sourceId: SOURCE_ID, sessionId: this.sessionId };
    const previousController = this.connectionAbortController;
    this.connectionAbortController = null;
    previousController?.abort();
    const generation = ++this.connectionGeneration;
    const controller = new AbortController();
    this.connectionAbortController = controller;
    try {
      await this.#get("/observer/summary", { signal: controller.signal });
      if (generation !== this.connectionGeneration) throw new Error("vst_connection_superseded");

      let sessionId;
      try {
        sessionId = this.createSessionId();
      } catch {
        throw new Error("vst_session_identity_unavailable");
      }
      if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
        throw new Error("vst_session_identity_unavailable");
      }

      this.sessionId = sessionId;
      this.connected = true;
      this.authenticationRejected = false;
      this.sequence = 0;
      this.snapshotSequence = 0;
      this.#startPolling(generation);
      return { connected: true, sourceId: SOURCE_ID, mode: "read-only", sessionId };
    } catch (error) {
      const superseded = generation !== this.connectionGeneration || controller.signal.aborted;
      if (this.connectionAbortController === controller) {
        this.connectionAbortController = null;
        controller.abort();
        this.connected = false;
        this.sessionId = null;
        this.#stopPolling();
      }
      if (superseded) throw new Error("vst_connection_superseded");
      throw error;
    }
  }

  async getSnapshot() {
    if (!this.connected) throw new Error("vst_adapter_not_connected");
    if (this.authenticationRejected) throw new Error("vst_auth_rejected");
    const controller = this.connectionAbortController;
    if (!controller || controller.signal.aborted) throw new Error("vst_adapter_not_connected");
    return this.#toSnapshot(await this.#get("/observer/summary", { signal: controller.signal }));
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    if (!this.connected) throw new Error("vst_adapter_not_connected");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(type, payload, generation) {
    if (!this.connected || generation !== this.connectionGeneration || !this.sessionId) return;
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

  #stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.inFlightGeneration = null;
  }

  #startPolling(generation) {
    this.#stopPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.connected || generation !== this.connectionGeneration || this.inFlightGeneration === generation) return;
      this.inFlightGeneration = generation;
      try {
        const snapshot = await this.getSnapshot();
        this.#emit("snapshot", snapshot, generation);
      } catch (error) {
        this.#emit("connection", {
          state: "error",
          reason: safeErrorCode(error, "vst_poll_failed")
        }, generation);
        if (this.authenticationRejected) this.#stopPolling();
      } finally {
        if (this.inFlightGeneration === generation) this.inFlightGeneration = null;
      }
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  async disconnect() {
    this.connectionGeneration += 1;
    this.connected = false;
    const controller = this.connectionAbortController;
    this.connectionAbortController = null;
    controller?.abort();
    this.#stopPolling();
    this.listeners.clear();
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.sessionId = null;
    this.authenticationRejected = false;
    return { disconnected: true };
  }
}

export const vstAdapterContract = Object.freeze({
  id: SOURCE_ID,
  mode: "read-only",
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedMethods: Object.freeze(["GET"]),
  allowedPaths: Object.freeze([...ALLOWED_PATHS]),
  authenticationHeader: "X-Token",
  requiredScope: "read_private_state",
  responseSuccessField: "ok",
  requiresSuccessfulObserverEnvelope: true,
  sourceTimestampField: "updated_at_ms",
  sourceTimestampSemantics: "last_observer_publish_time_not_engine_readiness",
  snapshotFreshnessTtlMs: 30_000,
  requiresInjectedSecureTokenProvider: true,
  sessionIdentity: "fresh-uuid-per-connection",
  remoteConnectionSupported: false,
  capabilities: Object.freeze(["read_state"])
});
