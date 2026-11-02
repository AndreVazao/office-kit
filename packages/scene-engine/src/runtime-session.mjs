import { normalizeRuntimeSnapshot } from "./runtime-state.mjs";

/**
 * Deterministic lifecycle coordinator for a backend adapter.
 * It models connection/synchronization state only; it opens no sockets and
 * sends no commands. The host adapter remains responsible for authentication.
 */
export class RuntimeSession {
  constructor({ now = () => Date.now(), ttlMs = 30_000 } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("ttlMs must be positive and finite.");
    this.now = now;
    this.ttlMs = ttlMs;
    this.state = "disconnected";
    this.lastHeartbeatAt = null;
    this.snapshot = null;
    this.lastResult = this.#emptyResult();
  }

  #emptyResult() {
    return {
      connectionState: this.state,
      authoritativeStateVerified: false,
      agents: [],
      tasks: [],
      reason: this.state === "disconnected" ? "not_connected" : null
    };
  }

  #unverified(state, reason) {
    this.state = state;
    const base = this.snapshot
      ? normalizeRuntimeSnapshot(this.snapshot, { now: this.now(), ttlMs: this.ttlMs })
      : this.#emptyResult();
    this.lastResult = {
      ...base,
      connectionState: state,
      authoritativeStateVerified: false,
      reason,
      agents: (base.agents ?? []).map(agent => ({ ...agent, status: "unknown" })),
      tasks: (base.tasks ?? []).map(task => ({ ...task, status: "unknown" }))
    };
    return this.getState();
  }

  connect() {
    this.lastHeartbeatAt = null;
    return this.#unverified("connecting", "connection_attempt");
  }

  transportConnected() {
    this.lastHeartbeatAt = this.now();
    return this.#unverified("synchronizing", "awaiting_fresh_synchronized_snapshot");
  }

  receiveSnapshot(snapshot) {
    if (this.state !== "synchronizing" && this.state !== "connected" && this.state !== "live") {
      return this.#unverified(this.state, "snapshot_ignored_without_active_transport");
    }
    const normalized = normalizeRuntimeSnapshot(snapshot, { now: this.now(), ttlMs: this.ttlMs });
    if (!normalized.valid) {
      this.snapshot = null;
      return this.#unverified("error", "invalid_snapshot");
    }
    this.snapshot = snapshot;
    if (normalized.connectionState !== "live") {
      return this.#unverified(normalized.connectionState, "snapshot_not_fresh_and_synchronized");
    }
    this.lastHeartbeatAt = this.now();
    this.state = "live";
    this.lastResult = { ...normalized, reason: null };
    return this.getState();
  }

  heartbeat(at = this.now()) {
    if (!Number.isFinite(at) || at > this.now() || this.now() - at > this.ttlMs) {
      return this.#unverified("stale", "heartbeat_invalid_or_expired");
    }
    if (this.state === "disconnected" || this.state === "connecting" || this.state === "error") {
      return this.#unverified(this.state, "heartbeat_without_healthy_transport");
    }
    this.lastHeartbeatAt = at;
    if (this.state !== "live") {
      return this.#unverified("synchronizing", "heartbeat_received_but_snapshot_not_synchronized");
    }
    return this.getState();
  }

  checkHealth() {
    if (this.state === "disconnected" || this.state === "connecting" || this.state === "error") {
      return this.getState();
    }
    if (this.lastHeartbeatAt === null || this.now() - this.lastHeartbeatAt > this.ttlMs) {
      return this.#unverified("stale", "heartbeat_timeout");
    }
    if (this.state !== "live") return this.getState();
    const normalized = this.snapshot
      ? normalizeRuntimeSnapshot(this.snapshot, { now: this.now(), ttlMs: this.ttlMs })
      : null;
    if (!normalized?.valid || normalized.connectionState !== "live") {
      return this.#unverified(normalized?.connectionState ?? "synchronizing", "snapshot_expired_or_unsynchronized");
    }
    this.lastResult = { ...normalized, connectionState: "live", authoritativeStateVerified: true, reason: null };
    return this.getState();
  }

  disconnect(reason = "transport_disconnected") {
    this.lastHeartbeatAt = null;
    return this.#unverified("disconnected", reason);
  }

  fail(reason = "transport_error") {
    this.lastHeartbeatAt = null;
    return this.#unverified("error", reason);
  }

  getState() {
    return {
      ...this.lastResult,
      connectionState: this.state,
      lastHeartbeatAt: this.lastHeartbeatAt === null ? null : new Date(this.lastHeartbeatAt).toISOString(),
      agents: (this.lastResult.agents ?? []).map(agent => ({ ...agent })),
      tasks: (this.lastResult.tasks ?? []).map(task => ({ ...task }))
    };
  }
}
