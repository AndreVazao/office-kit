/**
 * Routes every supported incident mutation through the monotonic checkpoint
 * coordinator. The store and checkpoint journal must share the same SQLite
 * database and exclusive operation lock.
 *
 * This class does not provide a hardware anchor. The coordinator must reject
 * writes unless its provider reports a provisioned, verified protected state.
 */
export class MonotonicIncidentWriter {
  #incidentStore;
  #coordinator;

  constructor({ incidentStore, coordinator } = {}) {
    if (!incidentStore
      || typeof incidentStore.prepareMonotonicAppend !== "function"
      || typeof incidentStore.prepareMonotonicUpdate !== "function") {
      throw new TypeError("monotonic_incident_store_invalid");
    }
    if (!coordinator || typeof coordinator.commit !== "function") {
      throw new TypeError("monotonic_incident_coordinator_invalid");
    }
    this.#incidentStore = incidentStore;
    this.#coordinator = coordinator;
  }

  async #commit(preparePayload) {
    let payload;
    let target;
    const result = await this.#coordinator.commit({
      prepareTransition: ({ expected }) => {
        payload = preparePayload();
        if (!payload || payload.installationId !== expected.installationId
          || !Number.isSafeInteger(payload.sequence)
          || payload.sequence !== expected.sequence + 1
          || !/^[a-f0-9]{64}$/.test(payload.eventHash ?? "")
          || !/^[a-f0-9]{64}$/.test(payload.eventMac ?? "")
          || typeof payload.snapshot?.id !== "string") {
          throw new Error("monotonic_incident_transition_invalid");
        }
        target = Object.freeze({
          ...expected,
          generation: expected.generation + 1,
          sequence: payload.sequence,
          eventHash: payload.eventHash,
          eventMac: payload.eventMac
        });
        return { next: target, payload };
      }
    });

    if (!payload || result?.status !== "protected"
      || !result.checkpoint
      || result.checkpoint.installationId !== target.installationId
      || result.checkpoint.generation !== target.generation
      || result.checkpoint.sequence !== target.sequence
      || result.checkpoint.eventHash !== target.eventHash
      || result.checkpoint.eventMac !== target.eventMac) {
      throw new Error("monotonic_incident_commit_unconfirmed");
    }
    return payload.snapshot.id;
  }

  append(incident) {
    return this.#commit(() => this.#incidentStore.prepareMonotonicAppend(incident));
  }

  update(id, patch) {
    return this.#commit(() => this.#incidentStore.prepareMonotonicUpdate(id, patch));
  }
}
