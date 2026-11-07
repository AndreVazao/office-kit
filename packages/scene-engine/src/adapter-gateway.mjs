import { RuntimeSession } from "./runtime-session.mjs";
import { normalizeAdapterEvent, validateAdapter } from "./adapter-contract.mjs";

/**
 * Connects an explicitly selected adapter to the neutral runtime session.
 * No discovery, implicit adapter selection, credentials, or command dispatch.
 * The host must authenticate and authorize an adapter before passing it here.
 */
export class AdapterGateway {
  constructor({ now = () => Date.now(), ttlMs = 30_000, maxEventAgeMs = ttlMs, maxBufferedEvents = 256 } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("ttlMs must be positive and finite.");
    if (!Number.isFinite(maxEventAgeMs) || maxEventAgeMs <= 0) throw new TypeError("maxEventAgeMs must be positive and finite.");
    if (!Number.isSafeInteger(maxBufferedEvents) || maxBufferedEvents < 1 || maxBufferedEvents > 4096) {
      throw new TypeError("maxBufferedEvents must be an integer between 1 and 4096.");
    }
    this.now = now;
    this.maxEventAgeMs = maxEventAgeMs;
    this.maxBufferedEvents = maxBufferedEvents;
    this.session = new RuntimeSession({ now, ttlMs });
    this.adapter = null;
    this.unsubscribe = null;
    this.eventSequences = new Map();
    this.activeSessionId = null;
    this.lastSequence = 0;
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

  #clearSubscription() {
    if (!this.unsubscribe) return;
    try { this.unsubscribe(); } catch { /* Best-effort listener cleanup. */ }
    this.unsubscribe = null;
  }

  async connect(adapter) {
    if (this.adapter || this.unsubscribe) await this.disconnect();
    const validation = validateAdapter(adapter);
    if (!validation.valid) {
      this.adapter = null;
      this.session.disconnect("adapter_contract_invalid");
      return { connected: false, validation, state: this.session.getState() };
    }

    this.adapter = adapter;
    this.eventSequences.clear();
    this.activeSessionId = null;
    this.lastSequence = 0;
    this.lastError = null;
    this.session.connect();
    let snapshotReady = false;
    const pendingEvents = [];

    try {
      await adapter.connect();
      this.session.transportConnected();

      const unsubscribe = adapter.subscribe(event => {
        if (!snapshotReady) {
          if (pendingEvents.length >= this.maxBufferedEvents) {
            this.#failClosed("adapter_initial_event_buffer_overflow");
            pendingEvents.length = 0;
            return;
          }
          pendingEvents.push(event);
          return;
        }
        this.receiveEvent(event);
      });
      if (typeof unsubscribe === "function") this.unsubscribe = unsubscribe;

      const snapshot = await adapter.getSnapshot();
      let state = this.session.receiveSnapshot(snapshot);
      snapshotReady = true;

      for (const event of pendingEvents) {
        this.receiveEvent(event);
        if (this.session.getState().connectionState === "error") break;
      }
      pendingEvents.length = 0;
      state = this.session.getState();
      if (state.connectionState !== "live" || !state.authoritativeStateVerified) {
        this.#emit({ type: "initial_snapshot_not_live", state });
      }
      return {
        connected: true,
        validation,
        state,
        verified: state.connectionState === "live" && state.authoritativeStateVerified
      };
    } catch (error) {
      this.#clearSubscription();
      try { await adapter.disconnect(); } catch { /* Preserve the original connection error. */ }
      this.adapter = null;
      this.activeSessionId = null;
      this.lastSequence = 0;
      const reason = error instanceof Error ? error.message : "adapter_connect_failed";
      const state = this.#failClosed(reason);
      return { connected: false, validation, state, error: reason };
    }
  }

  receiveEvent(event) {
    if (!this.adapter) return { accepted: false, reason: "no_adapter_selected" };
    if (event?.sourceId !== this.adapter.metadata.id) {
      this.#emit({ type: "event_rejected", reason: "source_identity_mismatch", errors: [] });
      return { valid: true, accepted: false, reason: "source_identity_mismatch", errors: [] };
    }

    const normalized = normalizeAdapterEvent(event, {
      lastSequence: this.lastSequence,
      now: this.now(),
      maxAgeMs: this.maxEventAgeMs
    });
    if (!normalized.valid || !normalized.accepted) {
      this.#emit({ type: "event_rejected", reason: normalized.reason ?? "invalid_event", errors: normalized.errors ?? [] });
      return normalized;
    }

    const item = normalized.event;
    if (this.activeSessionId === null) {
      this.activeSessionId = item.sessionId;
    } else if (item.sessionId !== this.activeSessionId) {
      const state = this.#failClosed("adapter_session_changed_without_reconnect");
      return { ...normalized, accepted: false, reason: "session_changed_without_reconnect", state };
    }

    if (this.lastSequence > 0 && item.sequence !== this.lastSequence + 1) {
      const expectedSequence = this.lastSequence + 1;
      const state = this.#failClosed("adapter_event_sequence_gap");
      return {
        ...normalized,
        accepted: false,
        reason: "sequence_gap",
        expectedSequence,
        receivedSequence: item.sequence,
        state
      };
    }

    this.lastSequence = item.sequence;
    this.eventSequences.set(item.sessionId, item.sequence);
    let state = this.session.getState();

    if (item.type === "snapshot") {
      state = this.session.receiveSnapshot(item.payload);
    } else if (item.type === "heartbeat") {
      state = this.session.heartbeat(Date.parse(item.timestamp));
    } else if (item.type === "connection") {
      if (item.payload?.state === "disconnected") state = this.session.disconnect("adapter_event_disconnected");
      else if (item.payload?.state === "error") state = this.session.fail("adapter_event_error");
    } else if (item.type === "agent" || item.type === "task") {
      state = this.#failClosed("incremental_agent_task_events_not_supported_yet");
      return { ...normalized, accepted: false, reason: "incremental_agent_task_events_not_supported_yet", state };
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
    this.#clearSubscription();
    const adapter = this.adapter;
    this.adapter = null;
    let disconnectError = null;
    if (adapter) {
      try { await adapter.disconnect(); }
      catch (error) { disconnectError = error instanceof Error ? error.message : "adapter_disconnect_failed"; }
    }
    const state = this.session.disconnect(disconnectError ?? "adapter_disconnected");
    this.eventSequences.clear();
    this.activeSessionId = null;
    this.lastSequence = 0;
    this.#emit({ type: "gateway_disconnected", state, error: disconnectError });
    return { state, error: disconnectError };
  }
}
