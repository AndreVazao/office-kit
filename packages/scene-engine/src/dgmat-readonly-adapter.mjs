import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "http://127.0.0.1:8181";
const SOURCE_ID = "dgm-mat";
const ALLOWED_PATHS = new Set(["/runtime/state"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODES = new Set([
  "dgm_mat_request_timeout",
  "dgm_mat_session_rejected",
  "dgm_mat_session_provider_failed",
  "dgm_mat_transport_error",
  "dgm_mat_invalid_content_type",
  "dgm_mat_invalid_response",
  "dgm_mat_invalid_response_body",
  "dgm_mat_local_session_unavailable",
  "dgm_mat_poll_failed",
  "dgm_mat_clock_invalid",
  "dgm_mat_session_identity_unavailable",
  "dgm_mat_connection_superseded",
  "dgm_mat_bootstrap_credential_unavailable",
  "dgm_mat_bootstrap_credential_invalid",
  "dgm_mat_bootstrap_credential_rejected",
  "dgm_mat_session_exchange_timeout",
  "dgm_mat_session_exchange_failed",
  "dgm_mat_session_response_invalid_content_type",
  "dgm_mat_session_response_invalid_json",
  "dgm_mat_session_response_invalid"
]);

const isLoopbackUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && url.port === "8181"
      && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};

function safeErrorCode(error, fallback = "dgm_mat_transport_error") {
  const value = error instanceof Error ? error.message : "";
  if (SAFE_ERROR_CODES.has(value)) return value;
  if (/^dgm_mat_http_(?:0|[1-5][0-9]{2})$/.test(value)) return value;
  if (/^dgm_mat_session_exchange_http_(?:0|[1-5][0-9]{2})$/.test(value)) return value;
  return fallback;
}

async function runWithDeadline(run, timeoutMs, timeoutCode) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      timeout
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error(timeoutCode);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function safeStatus(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 24
    || !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(normalized)
    || /(?:bearer|token|secret|api.?key|password|cookie|authorization)/i.test(normalized)) {
    return fallback;
  }
  return normalized;
}

/**
 * Read-only DGM-MAT adapter.
 *
 * The adapter uses only authenticated loopback GET /runtime/state. The source
 * timestamp describes the last state mutation, not a heartbeat or snapshot
 * generation time; transport reachability is therefore never promoted to a
 * synchronized/live operational snapshot.
 */
export class DgmMatReadOnlyAdapter {
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    getAccessToken,
    invalidateAccessToken = async () => {},
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    createSessionId = randomUUID,
    timeoutMs = 5_000,
    pollIntervalMs = 5_000
  } = {}) {
    if (!isLoopbackUrl(baseUrl)) throw new TypeError("dgm_mat_loopback_http_endpoint_required");
    if (typeof getAccessToken !== "function") throw new TypeError("dgm_mat_secure_session_provider_required");
    if (typeof invalidateAccessToken !== "function") throw new TypeError("invalidateAccessToken must be a function");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation required");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof createSessionId !== "function") throw new TypeError("createSessionId must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
      throw new TypeError("timeoutMs must be between 250 and 30000");
    }
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) {
      throw new TypeError("pollIntervalMs must be between 1000 and 60000");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getAccessToken = getAccessToken;
    this.invalidateAccessToken = invalidateAccessToken;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.createSessionId = createSessionId;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.apiVersion = 1;
    this.metadata = Object.freeze({ id: SOURCE_ID, name: "DGM-MAT read-only adapter", version: "0.3.0" });
    this.capabilities = Object.freeze(["read_state"]);
    this.connected = false;
    this.listeners = new Set();
    this.pollTimer = null;
    this.inFlightGeneration = null;
    this.connectionGeneration = 0;
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.sessionId = null;
  }

  async #get(path) {
    if (!ALLOWED_PATHS.has(path)) throw new Error("dgm_mat_route_not_allowlisted");
    return runWithDeadline(async signal => {
      let token;
      try {
        token = await this.getAccessToken({ signal });
      } catch (error) {
        throw new Error(safeErrorCode(error, "dgm_mat_session_provider_failed"));
      }
      if (signal.aborted) throw new Error("dgm_mat_request_timeout");
      if (typeof token !== "string" || token.length < 16 || token.length > 4_096
        || token.trim() !== token || /\s/.test(token)) {
        throw new Error("dgm_mat_local_session_unavailable");
      }

      let response;
      try {
        response = await this.fetchImpl(this.baseUrl + path, {
          method: "GET",
          headers: { Authorization: "Bearer " + token, Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal
        });
      } catch (error) {
        if (signal.aborted || error?.name === "AbortError") throw new Error("dgm_mat_request_timeout");
        throw new Error("dgm_mat_transport_error");
      }
      if (signal.aborted) throw new Error("dgm_mat_request_timeout");

      if (!response || !response.ok) {
        const status = Number.isInteger(response?.status) && response.status >= 0 && response.status <= 599
          ? response.status : 0;
        if (status === 401 || status === 403) {
          try {
            await runWithDeadline(
              invalidationSignal => this.invalidateAccessToken({ signal: invalidationSignal }),
              this.timeoutMs,
              "dgm_mat_invalidation_timeout"
            );
          } catch {
            // Authentication remains rejected even if local invalidation fails or stalls.
          }
          throw new Error("dgm_mat_session_rejected");
        }
        throw new Error("dgm_mat_http_" + status);
      }

      const contentType = response.headers?.get?.("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("dgm_mat_invalid_content_type");
      }
      let data;
      try {
        data = await response.json();
      } catch {
        if (signal.aborted) throw new Error("dgm_mat_request_timeout");
        throw new Error("dgm_mat_invalid_response_body");
      }
      if (signal.aborted) throw new Error("dgm_mat_request_timeout");
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("dgm_mat_invalid_response");
      }
      return data;
    }, this.timeoutMs, "dgm_mat_request_timeout");
  }

  #toSnapshot(state) {
    const receivedAt = this.now();
    if (!Number.isFinite(receivedAt) || Math.abs(receivedAt) > 8_640_000_000_000_000) {
      throw new Error("dgm_mat_clock_invalid");
    }

    const sourceTimestampSeconds = typeof state.timestamp === "number"
      && Number.isFinite(state.timestamp)
      && !Object.is(state.timestamp, -0)
      && state.timestamp > 0
      && state.timestamp <= 8_640_000_000_000
      ? state.timestamp
      : null;
    const sourceTimestampMs = sourceTimestampSeconds === null ? null : sourceTimestampSeconds * 1000;
    const sourceAgeMs = sourceTimestampMs === null ? null : receivedAt - sourceTimestampMs;
    const timestampValid = sourceTimestampMs !== null
      && Number.isFinite(sourceTimestampMs)
      && sourceTimestampMs > 0
      && sourceTimestampMs <= 8_640_000_000_000_000;
    const mutationAge = !timestampValid
      ? "unavailable"
      : sourceAgeMs < 0
        ? "future_or_clock_skew"
        : sourceAgeMs <= 30_000 ? "recent_mutation" : "older_mutation";

    return {
      schemaVersion: 1,
      sourceId: SOURCE_ID,
      snapshotId: "dgm-mat-" + (sourceTimestampMs ?? "unavailable") + "-" + (++this.snapshotSequence),
      generatedAt: new Date(receivedAt).toISOString(),
      connectionState: "synchronizing",
      synchronized: false,
      agents: [],
      tasks: [],
      backend: {
        transportReachable: true,
        runtimeStatus: safeStatus(state.runtime_status),
        systemState: safeStatus(state.system_state),
        bootPhase: safeStatus(state.boot_phase),
        nodeStatus: safeStatus(state.node_status),
        degraded: typeof state.is_degraded === "boolean" ? state.is_degraded : null,
        sourceStateUpdatedAt: timestampValid ? new Date(sourceTimestampMs).toISOString() : null,
        sourceStateMutationAgeMs: timestampValid ? sourceAgeMs : null,
        sourceStateMutationAge: mutationAge,
        sourceTimestampSemantics: "last_state_mutation_not_snapshot_heartbeat",
        sourceSnapshotFreshness: "unverified",
        receivedAt: new Date(receivedAt).toISOString()
      }
    };
  }

  async connect() {
    if (this.connected) return { connected: true, sourceId: SOURCE_ID, sessionId: this.sessionId };
    const generation = ++this.connectionGeneration;
    await this.#get("/runtime/state");
    if (generation !== this.connectionGeneration) throw new Error("dgm_mat_connection_superseded");

    let sessionId;
    try {
      sessionId = this.createSessionId();
    } catch {
      throw new Error("dgm_mat_session_identity_unavailable");
    }
    if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
      throw new Error("dgm_mat_session_identity_unavailable");
    }

    this.sessionId = sessionId;
    this.connected = true;
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.#startPolling(generation);
    return { connected: true, sourceId: SOURCE_ID, mode: "read-only", sessionId };
  }

  async getSnapshot() {
    if (!this.connected) throw new Error("dgm_mat_adapter_not_connected");
    const state = await this.#get("/runtime/state");
    return this.#toSnapshot(state);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    if (!this.connected) throw new Error("dgm_mat_adapter_not_connected");
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

  #startPolling(generation) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (!this.connected || generation !== this.connectionGeneration || this.inFlightGeneration === generation) return;
      this.inFlightGeneration = generation;
      try {
        const snapshot = await this.getSnapshot();
        this.#emit("snapshot", snapshot, generation);
      } catch (error) {
        this.#emit("connection", { state: "error", reason: safeErrorCode(error, "dgm_mat_poll_failed") }, generation);
      } finally {
        if (this.inFlightGeneration === generation) this.inFlightGeneration = null;
      }
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  async disconnect() {
    this.connectionGeneration += 1;
    this.connected = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.inFlightGeneration = null;
    this.listeners.clear();
    this.sequence = 0;
    this.snapshotSequence = 0;
    this.sessionId = null;
    return { disconnected: true };
  }
}

export const dgmMatAdapterContract = Object.freeze({
  id: SOURCE_ID,
  mode: "read-only",
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedMethods: Object.freeze(["GET"]),
  allowedPaths: Object.freeze([...ALLOWED_PATHS]),
  sourceTimestampField: "timestamp",
  sourceTimestampSemantics: "last_state_mutation_not_snapshot_heartbeat",
  sourceSnapshotFreshnessVerified: false,
  requiresInjectedSecureSession: true,
  sessionIdentity: "fresh-uuid-per-connection",
  remotePairingSupported: false
});
