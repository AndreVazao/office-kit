import { RuntimeSession } from "./runtime-session.mjs";

/**
 * Deterministic, backend-neutral simulator for exercising adapter lifecycles.
 * It emits contract-v1 snapshots and drives RuntimeSession without sockets,
 * timers, credentials, project-specific imports, or command execution.
 */
export class RuntimeSimulator {
  constructor({ now = () => Date.now(), ttlMs = 30_000, sourceId = "office-kit-simulator" } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (typeof sourceId !== "string" || !sourceId.trim()) throw new TypeError("sourceId must be a non-empty string.");
    this.now = now;
    this.sourceId = sourceId;
    this.session = new RuntimeSession({ now, ttlMs });
    this.sequence = 0;
    this.lastSnapshotId = null;
    this.events = [];
  }

  #record(type, state, details = {}) {
    const event = Object.freeze({
      sequence: ++this.sequence,
      type,
      at: new Date(this.now()).toISOString(),
      connectionState: state.connectionState,
      authoritativeStateVerified: state.authoritativeStateVerified,
      ...details
    });
    this.events.push(event);
    return { state, event, events: this.events.map(item => ({ ...item })) };
  }

  connect() {
    this.lastSnapshotId = null;
    return this.#record("connect", this.session.connect());
  }

  transportConnected() {
    return this.#record("transport_connected", this.session.transportConnected());
  }

  publishSnapshot(snapshot) {
    if (snapshot?.snapshotId && snapshot.snapshotId === this.lastSnapshotId) {
      return this.#record("snapshot_ignored_duplicate", this.session.getState(), {
        snapshotId: snapshot.snapshotId,
        reason: "duplicate_snapshot_id"
      });
    }
    const state = this.session.receiveSnapshot(snapshot);
    if (state.connectionState === "live" && snapshot?.snapshotId) this.lastSnapshotId = snapshot.snapshotId;
    return this.#record("snapshot_received", state, { snapshotId: snapshot?.snapshotId ?? null });
  }

  heartbeat(at = this.now()) {
    return this.#record("heartbeat", this.session.heartbeat(at));
  }

  checkHealth() {
    return this.#record("health_check", this.session.checkHealth());
  }

  disconnect(reason) {
    this.lastSnapshotId = null;
    return this.#record("disconnect", this.session.disconnect(reason));
  }

  fail(reason) {
    this.lastSnapshotId = null;
    return this.#record("failure", this.session.fail(reason));
  }

  getState() {
    return this.session.getState();
  }

  getEvents({ afterSequence = 0 } = {}) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError("afterSequence must be a non-negative safe integer.");
    }
    return this.events.filter(event => event.sequence > afterSequence).map(event => ({ ...event }));
  }
}
