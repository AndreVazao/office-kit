import {
  advanceMonotonicAnchor,
  inspectMonotonicAnchor,
  validateMonotonicAnchorProvider
} from "./monotonic-anchor.mjs";

const HASH = /^[a-f0-9]{64}$/;

function checkpoint(value, installationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.installationId !== installationId
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || value.protocolVersion !== 1
    || (value.sequence === 0
      ? value.eventHash !== null || value.eventMac !== null
      : !HASH.test(value.eventHash ?? "") || !HASH.test(value.eventMac ?? ""))) {
    throw new Error("monotonic_checkpoint_invalid");
  }
  return Object.freeze({
    installationId,
    generation: value.generation,
    sequence: value.sequence,
    eventHash: value.eventHash,
    eventMac: value.eventMac,
    protocolVersion: 1
  });
}

function sameCheckpoint(left, right) {
  return left.generation === right.generation
    && left.sequence === right.sequence
    && left.eventHash === right.eventHash
    && left.eventMac === right.eventMac
    && left.installationId === right.installationId;
}

function validateJournal(journal) {
  const methods = [
    "withExclusiveLock", "readCheckpoint", "readPreparedCheckpoint",
    "prepareCheckpoint", "finalizeCheckpoint", "discardPreparedCheckpoint"
  ];
  if (!journal || methods.some(name => typeof journal[name] !== "function")) {
    throw new TypeError("monotonic_checkpoint_journal_adapter_invalid");
  }
  return journal;
}

/**
 * Coordinates a durable SQLite journal adapter with an external monotonic
 * anchor using prepare -> anchor advance -> journal finalize.
 *
 * The adapter must persist prepareCheckpoint before resolving, make finalize
 * idempotent, and implement withExclusiveLock across all processes sharing
 * the same database. This class never claims protection when the provider
 * reports anything other than "protected".
 */
export class SqliteMonotonicCheckpointCoordinator {
  #provider;
  #journal;
  #installationId;

  constructor({ provider, journal, installationId } = {}) {
    if (typeof installationId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(installationId)) {
      throw new TypeError("monotonic_anchor_installation_id_invalid");
    }
    this.#provider = validateMonotonicAnchorProvider(provider);
    this.#journal = validateJournal(journal);
    this.#installationId = installationId;
  }

  async #inspect() {
    return inspectMonotonicAnchor(this.#provider, this.#installationId);
  }

  async #reconcileLocked() {
    const anchor = await this.#inspect();
    const local = checkpoint(
      await this.#journal.readCheckpoint(),
      this.#installationId
    );
    const prepared = await this.#journal.readPreparedCheckpoint();

    if (anchor.status !== "protected") {
      if (prepared) throw new Error("monotonic_anchor_recovery_required");
      return Object.freeze({
        status: anchor.status,
        rollbackProtection: anchor.rollbackProtection,
        localCheckpoint: local
      });
    }

    if (prepared) {
      if (!prepared || typeof prepared.id !== "string" || !prepared.id
        || prepared.id.length > 256) {
        throw new Error("monotonic_checkpoint_prepare_corrupt");
      }
      const expected = checkpoint(prepared.expected, this.#installationId);
      const next = checkpoint(prepared.next, this.#installationId);
      if (!sameCheckpoint(local, expected)
        || next.generation !== expected.generation + 1
        || next.sequence < expected.sequence) {
        throw new Error("monotonic_anchor_mismatch");
      }

      if (sameCheckpoint(anchor.checkpoint, next)) {
        await this.#journal.finalizeCheckpoint(prepared);
        const finalized = checkpoint(
          await this.#journal.readCheckpoint(),
          this.#installationId
        );
        if (!sameCheckpoint(finalized, next)
          || await this.#journal.readPreparedCheckpoint()) {
          throw new Error("monotonic_checkpoint_finalize_unconfirmed");
        }
        return Object.freeze({
          status: "protected",
          rollbackProtection: "protected",
          recovered: "finalized",
          checkpoint: finalized
        });
      }

      if (sameCheckpoint(anchor.checkpoint, expected)) {
        await this.#journal.discardPreparedCheckpoint(prepared.id);
        if (await this.#journal.readPreparedCheckpoint()) {
          throw new Error("monotonic_checkpoint_discard_unconfirmed");
        }
        return Object.freeze({
          status: "protected",
          rollbackProtection: "protected",
          recovered: "discarded_uncommitted_prepare",
          checkpoint: local
        });
      }
      throw new Error("monotonic_anchor_mismatch");
    }

    if (!sameCheckpoint(anchor.checkpoint, local)) {
      throw new Error("monotonic_anchor_mismatch");
    }
    return Object.freeze({
      status: "protected",
      rollbackProtection: "protected",
      recovered: null,
      checkpoint: local
    });
  }

  async recover() {
    return this.#journal.withExclusiveLock(() => this.#reconcileLocked());
  }

  async commit({ next, payload, prepareTransition } = {}) {
    if (prepareTransition !== undefined && typeof prepareTransition !== "function") {
      throw new TypeError("monotonic_checkpoint_transition_factory_invalid");
    }
    if (prepareTransition && (next !== undefined || payload !== undefined)) {
      throw new Error("monotonic_checkpoint_transition_arguments_conflict");
    }
    return this.#journal.withExclusiveLock(async () => {
      const reconciled = await this.#reconcileLocked();
      if (reconciled.status !== "protected") {
        throw new Error("monotonic_anchor_not_protected");
      }
      const expected = checkpoint(reconciled.checkpoint, this.#installationId);
      const transition = prepareTransition
        ? await prepareTransition(Object.freeze({ installationId: this.#installationId, expected }))
        : { next, payload };
      if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
        throw new TypeError("monotonic_checkpoint_transition_invalid");
      }
      const target = checkpoint(transition.next, this.#installationId);
      const preparedPayload = transition.payload ?? null;
      if (target.generation !== expected.generation + 1
        || target.sequence < expected.sequence) {
        throw new Error("monotonic_checkpoint_transition_invalid");
      }

      const prepared = await this.#journal.prepareCheckpoint({
        expected,
        next: target,
        payload: preparedPayload
      });
      if (!prepared || typeof prepared.id !== "string" || !prepared.id) {
        throw new Error("monotonic_checkpoint_prepare_unconfirmed");
      }
      const persisted = await this.#journal.readPreparedCheckpoint();
      if (!persisted || persisted.id !== prepared.id
        || !sameCheckpoint(checkpoint(persisted.expected, this.#installationId), expected)
        || !sameCheckpoint(checkpoint(persisted.next, this.#installationId), target)) {
        throw new Error("monotonic_checkpoint_prepare_unconfirmed");
      }

      try {
        await advanceMonotonicAnchor(this.#provider, {
          installationId: this.#installationId,
          expected,
          next: target
        });
      } catch (error) {
        // Resolve ambiguous provider failures by reading durable state. The
        // prepared record is retained whenever the outcome cannot be proven.
        try {
          const recovered = await this.#reconcileLocked();
          if (recovered.status === "protected"
            && sameCheckpoint(recovered.checkpoint, target)) {
            return Object.freeze({
              status: "protected",
              rollbackProtection: "protected",
              recovered: "finalized_after_ambiguous_advance",
              checkpoint: recovered.checkpoint
            });
          }
        } catch {
          // Preserve the prepare record for explicit recovery on next startup.
        }
        throw error;
      }

      await this.#journal.finalizeCheckpoint(prepared);
      const finalized = checkpoint(
        await this.#journal.readCheckpoint(),
        this.#installationId
      );
      if (!sameCheckpoint(finalized, target)
        || await this.#journal.readPreparedCheckpoint()) {
        throw new Error("monotonic_checkpoint_finalize_unconfirmed");
      }
      return Object.freeze({
        status: "protected",
        rollbackProtection: "protected",
        recovered: null,
        checkpoint: finalized
      });
    });
  }
}
