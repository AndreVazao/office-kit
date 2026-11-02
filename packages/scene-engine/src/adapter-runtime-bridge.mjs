import { RuntimeSession } from "./runtime-session.mjs";
import { normalizeAdapterEvent, validateAdapter } from "./adapter-contract.mjs";

/**
 * Explicit bridge between a caller-selected adapter and the neutral session.
 * This class performs no discovery and never selects or loads an adapter.
 * The caller must authenticate/authorize the adapter before constructing it.
 */
export class AdapterRuntimeBridge {
  constructor(adapter, { now = () => Date.now(), ttlMs = 30_000, maxEventAgeMs = ttlMs } = {}) {
    const validation = validateAdapter(adapter);
    if (!validation.valid) {
      throw new TypeError(`Invalid adapter: ${validation.errors.join(" ")}`);
    }
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (!Number.isFinite(maxEventAgeMs) || maxEventAgeMs <= 0) throw new TypeError("maxEventAgeMs must be positive and finite.");
    this.adapter = adapter;
    this.now = now;
    this.maxEventAgeMs = maxEventAgeMs;
    this.session = new RuntimeSession({ now, ttlMs });
    this.unsubscribe = null;
    this.started = false;
    this.lastSequence = 0;
    this.sourceId = null;
    this.sessionId = null;
    this.lastEventResult = null;
  }

  async start() {
    if (this.started) throw new Error("Adapter bridge is already started.");
    this.started = true;
    this.lastSequence = 0;
    this.sourceId = null;
    this.sessionId = null;
    this.session.connect();
    try {
      await this.adapter.connect();
      this.session.transportConnected();
      this.unsubscribe = this.adapter.subscribe(event => {
        // Event callbacks may be synchronous or asynchronous; callers can inspect
        // lastEventResult for the latest accepted/rejected envelope.
        this.lastEventResult = this.receiveEvent(event);
      });
      const snapshot = await this.adapter.getSnapshot();
      const state = this.session.receiveSnapshot(snapshot);
      if (state.connectionState !== "live") {
        this.#unsubscribe();
        this.started = false;
        return { started: false, state, reason: "initial_snapshot_not_verified" };
      }
      return { started: true, state };
    } catch (error) {
      this.#unsubscribe();
      this.started = false;
      const state = this.session.fail("adapter_start_failed");
      return { started: false, state, error: error instanceof Error ? error.message : String(error) };
    }
  }

  receiveEvent(event) {
    if (!this.started) {
      return { valid: false, accepted: false, reason: "bridge_not_started" };
    }
    const result = normalizeAdapterEvent(event, {
      lastSequence: this.lastSequence,
      now: this.now(),
      maxAgeMs: this.maxEventAgeMs
    });
    if (!result.valid || !result.accepted) return result;

    const normalized = result.event;
    if (this.sourceId === null) {
      this.sourceId = normalized.sourceId;
      this.sessionId = normalized.sessionId;
    } else if (normalized.sourceId !== this.sourceId || normalized.sessionId !== this.sessionId) {
      return { valid: true, accepted: false, reason: "source_or_session_changed_without_reconnect" };
    }

    if (this.lastSequence > 0 && normalized.sequence !== this.lastSequence + 1) {
      const state = this.session.fail("adapter_event_sequence_gap");
      return {
        valid: true,
        accepted: false,
        reason: "sequence_gap",
        expectedSequence: this.lastSequence + 1,
        receivedSequence: normalized.sequence,
        state
      };
    }

    if (normalized.type === "snapshot") {
      const state = this.session.receiveSnapshot(normalized.payload);
      if (state.connectionState !== "live") {
        return { valid: true, accepted: false, reason: "snapshot_not_verified", state };
      }
    } else if (normalized.type === "heartbeat") {
      const state = this.session.heartbeat(normalized.timestamp ? Date.parse(normalized.timestamp) : this.now());
      if (!state.authoritativeStateVerified) {
        return { valid: true, accepted: false, reason: "heartbeat_did_not_verify_state", state };
      }
    } else if (normalized.type === "connection" || normalized.type === "diagnostic") {
      // Informational envelopes are accepted and sequenced but cannot elevate
      // runtime authority. Connection lifecycle remains controlled by the bridge.
    } else {
      return { valid: true, accepted: false, reason: "incremental_agent_task_events_not_supported_yet" };
    }

    this.lastSequence = normalized.sequence;
    return { valid: true, accepted: true, event: normalized, state: this.session.getState() };
  }

  getState() {
    return this.session.getState();
  }

  async stop() {
    if (!this.started) return this.session.disconnect("bridge_stopped");
    this.#unsubscribe();
    try {
      await this.adapter.disconnect();
    } finally {
      this.started = false;
      this.sourceId = null;
      this.sessionId = null;
      this.lastSequence = 0;
      this.session.disconnect("bridge_stopped");
    }
    return this.session.getState();
  }

  #unsubscribe() {
    if (typeof this.unsubscribe === "function") {
      try { this.unsubscribe(); } finally { this.unsubscribe = null; }
    }
  }
}
