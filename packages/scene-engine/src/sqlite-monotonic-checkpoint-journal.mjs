import { randomUUID } from "node:crypto";

const INSTALLATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const HASH = /^[a-f0-9]{64}$/;

function validateCheckpoint(value, installationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.installationId !== installationId
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || value.protocolVersion !== 1
    || (value.sequence === 0
      ? value.eventHash !== null || value.eventMac !== null
      : !HASH.test(value.eventHash ?? "") || !HASH.test(value.eventMac ?? ""))) {
    throw new Error("sqlite_monotonic_checkpoint_invalid");
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
  return left.installationId === right.installationId
    && left.generation === right.generation
    && left.sequence === right.sequence
    && left.eventHash === right.eventHash
    && left.eventMac === right.eventMac;
}

function immediate(database, operation) {
  const transaction = database.transaction(operation);
  if (!transaction || typeof transaction.immediate !== "function") {
    throw new TypeError("sqlite_immediate_transaction_required");
  }
  return transaction.immediate();
}

function parseJson(value, errorCode) {
  try { return JSON.parse(value); }
  catch { throw new Error(errorCode); }
}

/**
 * SQLite persistence adapter for monotonic checkpoint coordination.
 *
 * The caller must provide a cross-process exclusive lock shared by every
 * writer of this database. The host must configure durable SQLite settings
 * (WAL or rollback journal as appropriate, synchronous=FULL) before use.
 * This adapter stores checkpoint metadata and prepare records; it does not
 * append incident events or provide a hardware monotonic anchor.
 */
export class SqliteMonotonicCheckpointJournal {
  #database;
  #installationId;
  #lockProvider;
  #makeId;

  constructor({ database, installationId, lockProvider, makeId = randomUUID } = {}) {
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_monotonic_database_required");
    }
    if (typeof installationId !== "string" || !INSTALLATION_ID.test(installationId)) {
      throw new TypeError("sqlite_monotonic_installation_id_invalid");
    }
    if (!lockProvider || typeof lockProvider.acquire !== "function") {
      throw new TypeError("sqlite_monotonic_cross_process_lock_required");
    }
    if (typeof makeId !== "function") throw new TypeError("sqlite_monotonic_id_provider_invalid");
    this.#database = database;
    this.#installationId = installationId;
    this.#lockProvider = lockProvider;
    this.#makeId = makeId;

    const initial = {
      installationId,
      generation: 0,
      sequence: 0,
      eventHash: null,
      eventMac: null,
      protocolVersion: 1
    };
    database.exec([
      "CREATE TABLE IF NOT EXISTS office_kit_monotonic_checkpoints (",
      "  installation_id TEXT PRIMARY KEY,",
      "  generation INTEGER NOT NULL CHECK (generation >= 0),",
      "  sequence INTEGER NOT NULL CHECK (sequence >= 0),",
      "  event_hash TEXT,",
      "  event_mac TEXT,",
      "  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1)",
      ");",
      "CREATE TABLE IF NOT EXISTS office_kit_monotonic_prepares (",
      "  installation_id TEXT PRIMARY KEY,",
      "  prepare_id TEXT NOT NULL UNIQUE,",
      "  expected_json TEXT NOT NULL,",
      "  next_json TEXT NOT NULL,",
      "  payload_json TEXT NOT NULL",
      ");"
    ].join("\n"));
    immediate(database, () => {
      database.prepare([
        "INSERT OR IGNORE INTO office_kit_monotonic_checkpoints",
        "(installation_id, generation, sequence, event_hash, event_mac, protocol_version)",
        "VALUES (?, ?, ?, ?, ?, ?)"
      ].join(" ")).run(
        installationId, initial.generation, initial.sequence,
        initial.eventHash, initial.eventMac, initial.protocolVersion
      );
    });
  }

  async withExclusiveLock(operation) {
    if (typeof operation !== "function") throw new TypeError("sqlite_monotonic_lock_operation_required");
    const lease = await this.#lockProvider.acquire({
      resource: "office-kit-monotonic-checkpoint:" + this.#installationId
    });
    if (!lease || typeof lease.release !== "function") {
      throw new Error("sqlite_monotonic_lock_acquire_unconfirmed");
    }
    try { return await operation(); }
    finally { await lease.release(); }
  }

  async readCheckpoint() {
    const row = this.#database.prepare([
      "SELECT generation, sequence, event_hash, event_mac, protocol_version",
      "FROM office_kit_monotonic_checkpoints WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    if (!row) throw new Error("sqlite_monotonic_checkpoint_missing");
    return validateCheckpoint({
      installationId: this.#installationId,
      generation: Number(row.generation),
      sequence: Number(row.sequence),
      eventHash: row.event_hash,
      eventMac: row.event_mac,
      protocolVersion: Number(row.protocol_version)
    }, this.#installationId);
  }

  async readPreparedCheckpoint() {
    const row = this.#database.prepare([
      "SELECT prepare_id, expected_json, next_json, payload_json",
      "FROM office_kit_monotonic_prepares WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    if (!row) return null;
    const expected = validateCheckpoint(parseJson(row.expected_json, "sqlite_monotonic_prepare_corrupt"), this.#installationId);
    const next = validateCheckpoint(parseJson(row.next_json, "sqlite_monotonic_prepare_corrupt"), this.#installationId);
    const payload = parseJson(row.payload_json, "sqlite_monotonic_prepare_corrupt");
    return Object.freeze({ id: row.prepare_id, expected, next, payload });
  }

  async prepareCheckpoint({ expected, next, payload = null } = {}) {
    const before = validateCheckpoint(expected, this.#installationId);
    const target = validateCheckpoint(next, this.#installationId);
    if (target.generation !== before.generation + 1 || target.sequence < before.sequence) {
      throw new Error("sqlite_monotonic_transition_invalid");
    }
    const payloadJson = JSON.stringify(payload);
    if (typeof payloadJson !== "string" || payloadJson.length > 1_048_576) {
      throw new Error("sqlite_monotonic_payload_invalid");
    }
    const id = this.#makeId();
    if (typeof id !== "string" || !id || id.length > 256) {
      throw new Error("sqlite_monotonic_prepare_id_invalid");
    }
    return immediate(this.#database, () => {
      const current = this.#readCheckpointSync();
      if (!sameCheckpoint(current, before)) throw new Error("sqlite_monotonic_checkpoint_compare_failed");
      if (this.#database.prepare(
        "SELECT 1 AS present FROM office_kit_monotonic_prepares WHERE installation_id = ?"
      ).get(this.#installationId)) throw new Error("sqlite_monotonic_prepare_already_exists");
      this.#database.prepare([
        "INSERT INTO office_kit_monotonic_prepares",
        "(installation_id, prepare_id, expected_json, next_json, payload_json)",
        "VALUES (?, ?, ?, ?, ?)"
      ].join(" ")).run(
        this.#installationId, id, JSON.stringify(before), JSON.stringify(target), payloadJson
      );
      return Object.freeze({ id, expected: before, next: target, payload });
    });
  }

  #readCheckpointSync() {
    const row = this.#database.prepare([
      "SELECT generation, sequence, event_hash, event_mac, protocol_version",
      "FROM office_kit_monotonic_checkpoints WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    if (!row) throw new Error("sqlite_monotonic_checkpoint_missing");
    return validateCheckpoint({
      installationId: this.#installationId,
      generation: Number(row.generation),
      sequence: Number(row.sequence),
      eventHash: row.event_hash,
      eventMac: row.event_mac,
      protocolVersion: Number(row.protocol_version)
    }, this.#installationId);
  }

  async finalizeCheckpoint(record) {
    if (!record || typeof record.id !== "string") throw new Error("sqlite_monotonic_prepare_invalid");
    const target = validateCheckpoint(record.next, this.#installationId);
    const expected = validateCheckpoint(record.expected, this.#installationId);
    return immediate(this.#database, () => {
      const pending = this.#database.prepare([
        "SELECT prepare_id, expected_json, next_json FROM office_kit_monotonic_prepares",
        "WHERE installation_id = ?"
      ].join(" ")).get(this.#installationId);
      if (!pending || pending.prepare_id !== record.id) throw new Error("sqlite_monotonic_prepare_missing");
      const persistedExpected = validateCheckpoint(parseJson(pending.expected_json, "sqlite_monotonic_prepare_corrupt"), this.#installationId);
      const persistedNext = validateCheckpoint(parseJson(pending.next_json, "sqlite_monotonic_prepare_corrupt"), this.#installationId);
      if (!sameCheckpoint(persistedExpected, expected) || !sameCheckpoint(persistedNext, target)) {
        throw new Error("sqlite_monotonic_prepare_mismatch");
      }
      const current = this.#readCheckpointSync();
      if (sameCheckpoint(current, target)) {
        this.#database.prepare("DELETE FROM office_kit_monotonic_prepares WHERE installation_id = ? AND prepare_id = ?")
          .run(this.#installationId, record.id);
        return;
      }
      if (!sameCheckpoint(current, expected)) throw new Error("sqlite_monotonic_checkpoint_compare_failed");
      const updated = this.#database.prepare([
        "UPDATE office_kit_monotonic_checkpoints",
        "SET generation = ?, sequence = ?, event_hash = ?, event_mac = ?, protocol_version = ?",
        "WHERE installation_id = ? AND generation = ? AND sequence = ?"
      ].join(" ")).run(
        target.generation, target.sequence, target.eventHash, target.eventMac,
        target.protocolVersion, this.#installationId, expected.generation, expected.sequence
      );
      if (Number(updated.changes) !== 1) throw new Error("sqlite_monotonic_checkpoint_update_conflict");
      this.#database.prepare("DELETE FROM office_kit_monotonic_prepares WHERE installation_id = ? AND prepare_id = ?")
        .run(this.#installationId, record.id);
    });
  }

  async discardPreparedCheckpoint(id) {
    if (typeof id !== "string" || !id) throw new TypeError("sqlite_monotonic_prepare_id_invalid");
    return immediate(this.#database, () => {
      const deleted = this.#database.prepare([
        "DELETE FROM office_kit_monotonic_prepares WHERE installation_id = ? AND prepare_id = ?"
      ].join(" ")).run(this.#installationId, id);
      if (Number(deleted.changes) !== 1) throw new Error("sqlite_monotonic_prepare_missing");
    });
  }
}
