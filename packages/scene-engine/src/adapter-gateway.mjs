import { RuntimeSession } from "./runtime-session.mjs";
import { normalizeAdapterEvent, validateAdapter } from "./adapter-contract.mjs";

/**
 * Connects an explicitly selected adapter to the neutral runtime session.
 * No discovery, implicit adapter selection, credentials, or command dispatch.
 * The host must authenticate and authorize an adapter before passing it here.
 */
export class AdapterGateway {
  constructor({ now = () => Date.now(), ttlMs = 30_000, maxEventAgeMs = ttlMs } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    this.now = now;
    this.maxEventAgeMs = maxEventAgeMs;
    this.session = new RuntimeSession({ now, ttlMs });
    this.adapter = null;
    this.unsubscribe = null;
    this.eventSequences = new Map();
    this.listeners = new Set();
    this.lastError = null;
  }

  onEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(event) {
    const immutable = Object.freeze({ ...event });
    for (const listener of this.listeners) {
      try { listener(immutable); } catch { /* Observers cannot break the runtime. */ }
    }
  }

  #failClosed(reason) {
    this.lastError = reason;
    const state = this.session.fail(reason);
    this.#emit({ type: "gateway_error", reason, state });
    return state;
  }

  async connect(adapter) {
    if (this.adapter) await this.disconnect();
    const validation = validateAdapter(adapter);
    if (!validation.valid) {
      this.adapter = null;
      this.session.disconnect("adapter_contract_invalid");
      return { connected: false, validation, state: this.session.getState() };
    }

    this.adapter = adapter;
    this.eventSequences.clear();
    this.lastError = null;
    this.session.connect();
    try {
      await adapter.connect();
      this.session.transportConnected();
      const snapshot = await adapter.getSnapshot();
      const state = this.session.receiveSnapshot(snapshot);
      if (state.connectionState !== "live" || !state.authoritativeStateVerified) {
        this.#emit({ type: "initial_snapshot_not_live", state });
      }
      const unsubscribe = adapter.subscribe(event => this.receiveEvent(event));
      if (typeof unsubscribe === "function") this.unsubscribe = unsubscribe;
      return {
        connected: true,
        validation,
        state,
        verified: state.connectionState === "live" && state.authoritativeStateVerified
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "adapter_connect_failed";
      const state = this.#failClosed(reason);
      this.adapter = null;
      return { connected: false, validation, state, error: reason };
    }
  }

  receiveEvent(event) {
    if (!this.adapter) {
      return { accepted: false, reason: "no_adapter_selected" };
    }
    const key = `${event?.sourceId ?? ""}::${event?.sessionId ?? ""}`;
    const lastSequence = this.eventSequences.get(key) ?? 0;
    const normalized = normalizeAdapterEvent(event, {
      lastSequence,
      now: this.now(),
      maxAgeMs: this.maxEventAgeMs
    });
    if (!normalized.valid || !normalized.accepted) {
      this.#emit({ type: "event_rejected", reason: normalized.reason ?? "invalid_event", errors: normalized.errors ?? [] });
      return normalized;
    }

    const item = normalized.event;
    this.eventSequences.set(key, item.sequence);
    let state = this.session.getState();
    if (item.type === "snapshot") {
      state = this.session.receiveSnapshot(item.payload);
    } else if (item.type === "heartbeat") {
      state = this.session.heartbeat(Date.parse(item.timestamp));
    } else if (item.type === "connection") {
      if (item.payload?.state === "disconnected") state = this.session.disconnect("adapter_event_disconnected");
      else if (item.payload?.state === "error") state = this.session.fail("adapter_event_error");
    }
    this.#emit({ type: "adapter_event", event: item, state });
    return { ...normalized, state };
  }

  checkHealth() {
    return this.session.checkHealth();
  }

  getState() {
    return this.session.getState();
  }

  async disconnect() {
    if (this.unsubscribe) {
      try { this.unsubscribe(); } catch { /* Best-effort listener cleanup. */ }
      this.unsubscribe = null;
    }
    const adapter = this.adapter;
    this.adapter = null;
    let disconnectError = null;
    if (adapter) {
      try { await adapter.disconnect(); }
      catch (error) { disconnectError = error instanceof Error ? error.message : "adapter_disconnect_failed"; }
    }
    const state = this.session.disconnect(disconnectError ?? "adapter_disconnected");
    this.eventSequences.clear();
    this.#emit({ type: "gateway_disconnected", state, error: disconnectError });
    return { state, error: disconnectError };
  }
}
