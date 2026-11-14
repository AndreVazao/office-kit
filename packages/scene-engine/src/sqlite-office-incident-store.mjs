import { createInProcessExclusiveLockProvider } from "./exclusive-operation-lock.mjs";

const ZERO_HASH = "0".repeat(64);
const MAC_DOMAIN = "office-kit-incident-event-mac-v1";
const EVENT_TYPES = new Set(["incident.imported_snapshot", "incident.created", "incident.updated"]);
const MONOTONIC_UPDATE_KIND = "office-kit.monotonic-incident-update.v1";
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY = /(?:token|password|secret|api[_-]?key|authorization|cookie|private[_-]?key)/i;
const SECRET_TEXT = [
  /bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /((?:token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi
];

function validateInstallationId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw new TypeError("invalid_incident_installation_id");
  }
}

function sanitize(value, depth = 0) {
  if (depth > 20) throw new RangeError("incident_payload_too_deep");
  if (typeof value === "string") {
    return SECRET_TEXT.reduce((text, pattern) => text.replace(pattern, "$1[REDACTED]"), value).slice(0, 4_000);
  }
  if (Array.isArray(value)) return value.slice(0, 2_000).map(item => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitize(child, depth + 1);
    }
    return output;
  }
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  return null;
}

function validateIncident(value, installationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/.test(value.id)) {
    throw new TypeError("invalid_office_incident");
  }
  const safe = sanitize(value);
  if (safe.installationId !== undefined && safe.installationId !== installationId) {
    throw new TypeError("incident_installation_scope_mismatch");
  }
  return { ...safe, installationId, schemaVersion: 1 };
}

function runImmediate(database, operation) {
  const transaction = database.transaction(operation);
  if (!transaction || typeof transaction.immediate !== "function") {
    throw new TypeError("sqlite_immediate_transaction_required");
  }
  return transaction.immediate();
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string"
    || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function parseStoredIncident(row, installationId) {
  let parsed;
  try { parsed = JSON.parse(row.incident_json); }
  catch (cause) {
    const error = new Error("incident_corrupt_state");
    error.cause = cause;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("incident_corrupt_state");
  }
  const revision = Number(row.revision ?? parsed.revision ?? 1);
  if (!Number.isSafeInteger(revision) || revision < 1
    || (parsed.revision !== undefined && parsed.revision !== revision)) {
    throw new Error("incident_corrupt_state");
  }
  return structuredClone(validateIncident({ ...parsed, revision }, installationId));
}

/**
 * Durable incident history isolated per Office Kit installation.
 * Read/modify/write operations require BEGIN IMMEDIATE and a monotonic revision.
 * The host owns the SQLite connection, file ACLs, encryption, backup and retention.
 */
export class SqliteOfficeIncidentStore {
  #database;
  #installationId;
  #cryptoProvider;
  #macProvider = null;
  #macProviders = new Map();
  #integrityRequired;
  #writeLockProvider;
  #integrityReady = false;
  persistent = true;

  constructor({ database, installationId, cryptoProvider, requireMac = false, writeLockProvider } = {}) {
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_incident_database_required");
    }
    if (!cryptoProvider || typeof cryptoProvider.sha256Hex !== "function"
      || typeof cryptoProvider.randomUUID !== "function") {
      throw new TypeError("incident_crypto_provider_required");
    }
    validateInstallationId(installationId);
    const transaction = database.transaction(() => {});
    if (!transaction || typeof transaction.immediate !== "function") {
      throw new TypeError("sqlite_immediate_transaction_required");
    }
    if (typeof requireMac !== "boolean") throw new TypeError("incident_mac_requirement_invalid");
    this.#database = database;
    this.#installationId = installationId;
    this.#cryptoProvider = cryptoProvider;
    this.#integrityRequired = requireMac;
    this.#writeLockProvider = writeLockProvider ?? createInProcessExclusiveLockProvider();
    if (!this.#writeLockProvider || typeof this.#writeLockProvider.acquire !== "function") {
      throw new TypeError("incident_write_lock_provider_invalid");
    }
    this.#database.exec([
      "CREATE TABLE IF NOT EXISTS office_kit_incidents (",
      "  installation_id TEXT NOT NULL,",
      "  incident_id TEXT NOT NULL,",
      "  occurred_at TEXT NOT NULL,",
      "  status TEXT NOT NULL,",
      "  origin TEXT NOT NULL,",
      "  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),",
      "  incident_json TEXT NOT NULL,",
      "  PRIMARY KEY (installation_id, incident_id)",
      ");",
      "CREATE INDEX IF NOT EXISTS office_kit_incidents_recent",
      "  ON office_kit_incidents (installation_id, occurred_at DESC);"
    ].join("\n"));
    const columns = this.#database.prepare("PRAGMA table_info(office_kit_incidents)").all();
    if (!columns.some(column => column.name === "revision")) {
      this.#database.exec("ALTER TABLE office_kit_incidents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)");
    }
    this.#database.exec([
      "CREATE TABLE IF NOT EXISTS office_kit_incident_events (",
      "  installation_id TEXT NOT NULL,",
      "  sequence INTEGER NOT NULL CHECK (sequence >= 1),",
      "  event_id TEXT NOT NULL,",
      "  incident_id TEXT NOT NULL,",
      "  event_type TEXT NOT NULL,",
      "  revision INTEGER NOT NULL CHECK (revision >= 1),",
      "  previous_hash TEXT NOT NULL,",
      "  event_json TEXT NOT NULL,",
      "  event_hash TEXT NOT NULL,",
      "  PRIMARY KEY (installation_id, sequence),",
      "  UNIQUE (installation_id, event_id)",
      ");",
      "CREATE TABLE IF NOT EXISTS office_kit_incident_chain_heads (",
      "  installation_id TEXT PRIMARY KEY,",
      "  sequence INTEGER NOT NULL CHECK (sequence >= 1),",
      "  head_hash TEXT NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS office_kit_incident_event_macs (",
      "  installation_id TEXT NOT NULL,",
      "  sequence INTEGER NOT NULL CHECK (sequence >= 1),",
      "  key_id TEXT NOT NULL,",
      "  previous_mac TEXT NOT NULL,",
      "  event_mac TEXT NOT NULL,",
      "  PRIMARY KEY (installation_id, sequence)",
      ");",
      "CREATE TRIGGER IF NOT EXISTS office_kit_incident_event_macs_immutable_update",
      "BEFORE UPDATE ON office_kit_incident_event_macs BEGIN",
      "  SELECT RAISE(ABORT, 'incident_event_mac_immutable');",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS office_kit_incident_event_macs_immutable_delete",
      "BEFORE DELETE ON office_kit_incident_event_macs BEGIN",
      "  SELECT RAISE(ABORT, 'incident_event_mac_immutable');",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS office_kit_incident_events_immutable_update",
      "BEFORE UPDATE ON office_kit_incident_events BEGIN",
      "  SELECT RAISE(ABORT, 'incident_event_immutable');",
      "END;",
      "CREATE TRIGGER IF NOT EXISTS office_kit_incident_events_immutable_delete",
      "BEFORE DELETE ON office_kit_incident_events BEGIN",
      "  SELECT RAISE(ABORT, 'incident_event_immutable');",
      "END;"
    ].join("\n"));
    this.#seedLegacySnapshots();
  }

  async #withWriteLock(operation) {
    if (typeof operation !== "function") throw new TypeError("incident_write_operation_required");
    const lease = await this.#writeLockProvider.acquire({
      resource: "office-kit-incident-store:" + this.#installationId
    });
    if (!lease || typeof lease.release !== "function") {
      throw new Error("incident_write_lock_acquire_unconfirmed");
    }
    try { return await operation(); }
    finally { await lease.release(); }
  }

  #appendEvent(eventType, snapshot) {
    if (!EVENT_TYPES.has(eventType)) throw new Error("incident_event_type_invalid");
    if (!snapshot || snapshot.installationId !== this.#installationId
      || typeof snapshot.id !== "string" || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
      throw new Error("incident_event_snapshot_invalid");
    }
    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    const sequence = Number(head?.sequence ?? 0) + 1;
    const event = {
      schemaVersion: 1,
      installationId: this.#installationId,
      sequence,
      eventId: this.#cryptoProvider.randomUUID(),
      incidentId: snapshot.id,
      eventType,
      revision: snapshot.revision,
      occurredAt: typeof snapshot.occurredAt === "string" ? snapshot.occurredAt : new Date().toISOString(),
      previousHash: head?.head_hash ?? ZERO_HASH,
      payload: snapshot
    };
    const eventJson = stableJson(event);
    const eventHash = this.#cryptoProvider.sha256Hex(eventJson);
    if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
      throw new Error("incident_crypto_provider_invalid_hash");
    }
    this.#database.prepare([
      "INSERT INTO office_kit_incident_events",
      "(installation_id, sequence, event_id, incident_id, event_type, revision, previous_hash, event_json, event_hash)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, sequence, event.eventId, snapshot.id, eventType,
      snapshot.revision, event.previousHash, eventJson, eventHash
    );
    if (this.#macProvider) {
      const previousMacRow = this.#database.prepare(
        "SELECT event_mac FROM office_kit_incident_event_macs WHERE installation_id = ? ORDER BY sequence DESC LIMIT 1"
      ).get(this.#installationId);
      const previousMac = previousMacRow?.event_mac ?? ZERO_HASH;
      const eventMac = this.#macProvider.hmacSha256Hex(this.#macMessage(sequence, eventHash, previousMac));
      if (typeof eventMac !== "string" || !/^[a-f0-9]{64}$/.test(eventMac)) {
        throw new Error("incident_mac_provider_invalid_result");
      }
      this.#database.prepare([
        "INSERT INTO office_kit_incident_event_macs (installation_id, sequence, key_id, previous_mac, event_mac)",
        "VALUES (?, ?, ?, ?, ?)"
      ].join(" ")).run(this.#installationId, sequence, this.#macProvider.keyId, previousMac, eventMac);
    }
    if (head) {
      const updated = this.#database.prepare([
        "UPDATE office_kit_incident_chain_heads SET sequence = ?, head_hash = ?",
        "WHERE installation_id = ? AND sequence = ? AND head_hash = ?"
      ].join(" ")).run(sequence, eventHash, this.#installationId, head.sequence, head.head_hash);
      if (Number(updated.changes) !== 1) throw new Error("incident_event_chain_head_conflict");
    } else {
      this.#database.prepare([
        "INSERT INTO office_kit_incident_chain_heads (installation_id, sequence, head_hash)",
        "VALUES (?, ?, ?)"
      ].join(" ")).run(this.#installationId, sequence, eventHash);
    }
    return event;
  }

  /**
   * Builds an immutable incident append payload while the caller holds the
   * shared host operation lock. The event is not visible until checkpoint finalize.
   */
  prepareMonotonicAppend(incident) {
    if (!this.#integrityReady || !this.#macProvider) throw new Error("incident_integrity_key_unavailable");
    this.#verifyEventChain();
    const safe = validateIncident(incident, this.#installationId);
    const snapshot = {
      ...safe,
      occurredAt: typeof safe.occurredAt === "string" ? safe.occurredAt : new Date().toISOString(),
      status: typeof safe.status === "string" ? safe.status : "unknown",
      origin: typeof safe.origin === "string" ? safe.origin : "indeterminate",
      revision: 1
    };
    const existing = this.#database.prepare(
      "SELECT 1 AS present FROM office_kit_incidents WHERE installation_id = ? AND incident_id = ?"
    ).get(this.#installationId, snapshot.id);
    if (existing) throw new Error("duplicate_incident_id");
    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    const sequence = Number(head?.sequence ?? 0) + 1;
    const event = {
      schemaVersion: 1,
      installationId: this.#installationId,
      sequence,
      eventId: this.#cryptoProvider.randomUUID(),
      incidentId: snapshot.id,
      eventType: "incident.created",
      revision: 1,
      occurredAt: snapshot.occurredAt,
      previousHash: head?.head_hash ?? ZERO_HASH,
      payload: snapshot
    };
    if (typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)) {
      throw new Error("incident_event_id_invalid");
    }
    const eventJson = stableJson(event);
    const eventHash = this.#cryptoProvider.sha256Hex(eventJson);
    if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
      throw new Error("incident_crypto_provider_invalid_hash");
    }
    const previousMacRow = this.#database.prepare(
      "SELECT event_mac FROM office_kit_incident_event_macs WHERE installation_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(this.#installationId);
    const previousMac = previousMacRow?.event_mac ?? ZERO_HASH;
    const eventMac = this.#macProvider.hmacSha256Hex(this.#macMessage(sequence, eventHash, previousMac));
    if (typeof eventMac !== "string" || !/^[a-f0-9]{64}$/.test(eventMac)) {
      throw new Error("incident_mac_provider_invalid_result");
    }
    return Object.freeze({
      kind: "office-kit.monotonic-incident-append.v1",
      schemaVersion: 1,
      installationId: this.#installationId,
      sequence,
      snapshot: structuredClone(snapshot),
      eventJson,
      eventHash,
      keyId: this.#macProvider.keyId,
      previousMac,
      eventMac
    });
  }

  /**
   * Builds a prepared update payload. The caller must hold the same exclusive
   * operation lock used by the checkpoint journal. The predecessor revision
   * and digest prevent a stale prepare from overwriting a newer snapshot.
   */
  prepareMonotonicUpdate(id, patch) {
    if (!this.#integrityReady || !this.#macProvider) throw new Error("incident_integrity_key_unavailable");
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/.test(id)
      || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("invalid_incident_update");
    }
    if (["id", "installationId", "schemaVersion", "revision"].some(key => Object.hasOwn(patch, key))) {
      throw new TypeError("incident_update_reserved_field");
    }
    const safePatch = sanitize(patch);
    this.#verifyEventChain();
    const row = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ? AND incident_id = ?"
    ].join(" ")).get(this.#installationId, id);
    if (!row) throw new Error("incident_not_found");
    const current = parseStoredIncident(row, this.#installationId);
    if (current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("incident_revision_exhausted");
    const revision = current.revision + 1;
    const validated = validateIncident({
      ...current,
      ...safePatch,
      id,
      installationId: this.#installationId
    }, this.#installationId);
    const occurredAt = typeof validated.occurredAt === "string"
      ? validated.occurredAt
      : new Date().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) throw new TypeError("incident_occurred_at_invalid");
    const snapshot = {
      ...validated,
      occurredAt,
      status: typeof validated.status === "string" ? validated.status : "unknown",
      origin: typeof validated.origin === "string" ? validated.origin : "indeterminate",
      revision
    };
    const previousSnapshotHash = this.#cryptoProvider.sha256Hex(stableJson(current));
    if (typeof previousSnapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(previousSnapshotHash)) {
      throw new Error("incident_crypto_provider_invalid_hash");
    }
    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    const sequence = Number(head?.sequence ?? 0) + 1;
    const event = {
      schemaVersion: 1,
      installationId: this.#installationId,
      sequence,
      eventId: this.#cryptoProvider.randomUUID(),
      incidentId: id,
      eventType: "incident.updated",
      revision,
      occurredAt: snapshot.occurredAt,
      previousHash: head?.head_hash ?? ZERO_HASH,
      payload: snapshot
    };
    if (typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)) {
      throw new Error("incident_event_id_invalid");
    }
    const eventJson = stableJson(event);
    const eventHash = this.#cryptoProvider.sha256Hex(eventJson);
    if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
      throw new Error("incident_crypto_provider_invalid_hash");
    }
    const previousMacRow = this.#database.prepare(
      "SELECT event_mac FROM office_kit_incident_event_macs WHERE installation_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(this.#installationId);
    const previousMac = previousMacRow?.event_mac ?? ZERO_HASH;
    const eventMac = this.#macProvider.hmacSha256Hex(this.#macMessage(sequence, eventHash, previousMac));
    if (typeof eventMac !== "string" || !/^[a-f0-9]{64}$/.test(eventMac)) {
      throw new Error("incident_mac_provider_invalid_result");
    }
    return Object.freeze({
      kind: MONOTONIC_UPDATE_KIND,
      schemaVersion: 1,
      installationId: this.#installationId,
      sequence,
      previousRevision: current.revision,
      previousSnapshotHash,
      snapshot: structuredClone(snapshot),
      eventJson,
      eventHash,
      keyId: this.#macProvider.keyId,
      previousMac,
      eventMac
    });
  }

  /**
   * Applies a prepared append inside the checkpoint journal's active SQLite
   * transaction. Snapshot, event, MAC and checkpoint metadata commit together.
   */
  applyPreparedMonotonicAppend(payload, checkpoint) {
    if (!this.#integrityReady || !this.#macProvider) throw new Error("incident_integrity_key_unavailable");
    if (!payload || payload.kind !== "office-kit.monotonic-incident-append.v1"
      || payload.schemaVersion !== 1 || payload.installationId !== this.#installationId
      || !Number.isSafeInteger(payload.sequence) || payload.sequence < 1
      || typeof payload.eventJson !== "string"
      || !/^[a-f0-9]{64}$/.test(payload.eventHash ?? "")
      || !/^[a-f0-9]{64}$/.test(payload.previousMac ?? "")
      || !/^[a-f0-9]{64}$/.test(payload.eventMac ?? "")
      || typeof payload.keyId !== "string" || !this.#macProviders.has(payload.keyId)) {
      throw new Error("incident_monotonic_payload_invalid");
    }
    if (!checkpoint || checkpoint.installationId !== this.#installationId
      || checkpoint.sequence !== payload.sequence
      || checkpoint.eventHash !== payload.eventHash
      || checkpoint.eventMac !== payload.eventMac) {
      throw new Error("incident_monotonic_checkpoint_payload_mismatch");
    }
    const snapshot = {
      ...validateIncident(payload.snapshot, this.#installationId),
      occurredAt: typeof payload.snapshot?.occurredAt === "string" ? payload.snapshot.occurredAt : new Date().toISOString(),
      status: typeof payload.snapshot?.status === "string" ? payload.snapshot.status : "unknown",
      origin: typeof payload.snapshot?.origin === "string" ? payload.snapshot.origin : "indeterminate",
      revision: 1
    };
    if (stableJson(snapshot) !== stableJson(payload.snapshot)) {
      throw new Error("incident_monotonic_snapshot_mismatch");
    }
    let event;
    try { event = JSON.parse(payload.eventJson); }
    catch { throw new Error("incident_monotonic_event_corrupt"); }
    if (stableJson(event) !== payload.eventJson
      || event?.schemaVersion !== 1
      || event.installationId !== this.#installationId
      || event.sequence !== payload.sequence
      || typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)
      || event.incidentId !== snapshot.id
      || event.eventType !== "incident.created"
      || event.revision !== 1
      || event.occurredAt !== snapshot.occurredAt
      || !/^[a-f0-9]{64}$/.test(event.previousHash ?? "")
      || stableJson(event.payload) !== stableJson(snapshot)) {
      throw new Error("incident_monotonic_event_mismatch");
    }

    this.#verifyEventChain();
    const existing = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ? AND incident_id = ?"
    ].join(" ")).get(this.#installationId, snapshot.id);
    if (existing) {
      const existingSnapshot = parseStoredIncident(existing, this.#installationId);
      const eventRow = this.#database.prepare([
        "SELECT event_json, event_hash FROM office_kit_incident_events",
        "WHERE installation_id = ? AND sequence = ?"
      ].join(" ")).get(this.#installationId, payload.sequence);
      const macRow = this.#database.prepare([
        "SELECT key_id, previous_mac, event_mac FROM office_kit_incident_event_macs",
        "WHERE installation_id = ? AND sequence = ?"
      ].join(" ")).get(this.#installationId, payload.sequence);
      const head = this.#database.prepare([
        "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
        "WHERE installation_id = ?"
      ].join(" ")).get(this.#installationId);
      if (stableJson(existingSnapshot) === stableJson(snapshot)
        && eventRow?.event_json === payload.eventJson
        && eventRow?.event_hash === payload.eventHash
        && macRow?.key_id === payload.keyId
        && macRow?.previous_mac === payload.previousMac
        && macRow?.event_mac === payload.eventMac
        && Number(head?.sequence) === payload.sequence
        && head?.head_hash === payload.eventHash) return snapshot.id;
      throw new Error("incident_monotonic_existing_event_conflict");
    }

    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    const expectedSequence = Number(head?.sequence ?? 0) + 1;
    const previousHash = head?.head_hash ?? ZERO_HASH;
    if (expectedSequence !== payload.sequence || event.previousHash !== previousHash) {
      throw new Error("incident_monotonic_event_head_conflict");
    }
    const expectedHash = this.#cryptoProvider.sha256Hex(payload.eventJson);
    if (expectedHash !== payload.eventHash) throw new Error("incident_monotonic_event_hash_mismatch");
    const previousMacRow = this.#database.prepare(
      "SELECT event_mac FROM office_kit_incident_event_macs WHERE installation_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(this.#installationId);
    const previousMac = previousMacRow?.event_mac ?? ZERO_HASH;
    if (previousMac !== payload.previousMac) throw new Error("incident_monotonic_mac_head_conflict");
    const macProvider = this.#macProviders.get(payload.keyId);
    const expectedMac = macProvider.hmacSha256Hex(this.#macMessage(payload.sequence, payload.eventHash, previousMac));
    if (!constantTimeHexEqual(expectedMac, payload.eventMac)) {
      throw new Error("incident_monotonic_event_mac_mismatch");
    }

    this.#database.prepare([
      "INSERT INTO office_kit_incidents",
      "(installation_id, incident_id, occurred_at, status, origin, revision, incident_json)",
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, snapshot.id, snapshot.occurredAt, snapshot.status,
      snapshot.origin, 1, JSON.stringify(snapshot)
    );
    this.#database.prepare([
      "INSERT INTO office_kit_incident_events",
      "(installation_id, sequence, event_id, incident_id, event_type, revision, previous_hash, event_json, event_hash)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, payload.sequence, event.eventId, snapshot.id,
      event.eventType, event.revision, event.previousHash, payload.eventJson, payload.eventHash
    );
    this.#database.prepare([
      "INSERT INTO office_kit_incident_event_macs",
      "(installation_id, sequence, key_id, previous_mac, event_mac)",
      "VALUES (?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, payload.sequence, payload.keyId, payload.previousMac, payload.eventMac
    );
    if (head) {
      const updated = this.#database.prepare([
        "UPDATE office_kit_incident_chain_heads SET sequence = ?, head_hash = ?",
        "WHERE installation_id = ? AND sequence = ? AND head_hash = ?"
      ].join(" ")).run(
        payload.sequence, payload.eventHash, this.#installationId, head.sequence, head.head_hash
      );
      if (Number(updated.changes) !== 1) throw new Error("incident_event_chain_head_conflict");
    } else {
      this.#database.prepare([
        "INSERT INTO office_kit_incident_chain_heads (installation_id, sequence, head_hash)",
        "VALUES (?, ?, ?)"
      ].join(" ")).run(this.#installationId, payload.sequence, payload.eventHash);
    }
    this.#verifyEventChain();
    return snapshot.id;
  }

  /**
   * Applies a prepared update in the checkpoint journal's active SQLite
   * transaction. The current snapshot must still match the prepared predecessor.
   */
  applyPreparedMonotonicUpdate(payload, checkpoint) {
    if (!this.#integrityReady || !this.#macProvider) throw new Error("incident_integrity_key_unavailable");
    if (!payload || payload.kind !== MONOTONIC_UPDATE_KIND
      || payload.schemaVersion !== 1 || payload.installationId !== this.#installationId
      || !Number.isSafeInteger(payload.sequence) || payload.sequence < 2
      || !Number.isSafeInteger(payload.previousRevision) || payload.previousRevision < 1
      || !/^[a-f0-9]{64}$/.test(payload.previousSnapshotHash ?? "")
      || typeof payload.eventJson !== "string"
      || !/^[a-f0-9]{64}$/.test(payload.eventHash ?? "")
      || !/^[a-f0-9]{64}$/.test(payload.previousMac ?? "")
      || !/^[a-f0-9]{64}$/.test(payload.eventMac ?? "")
      || typeof payload.keyId !== "string" || !this.#macProviders.has(payload.keyId)) {
      throw new Error("incident_monotonic_update_payload_invalid");
    }
    if (!checkpoint || checkpoint.installationId !== this.#installationId
      || checkpoint.sequence !== payload.sequence
      || checkpoint.eventHash !== payload.eventHash
      || checkpoint.eventMac !== payload.eventMac) {
      throw new Error("incident_monotonic_checkpoint_payload_mismatch");
    }
    const snapshot = {
      ...validateIncident(payload.snapshot, this.#installationId),
      occurredAt: typeof payload.snapshot?.occurredAt === "string" ? payload.snapshot.occurredAt : "",
      status: typeof payload.snapshot?.status === "string" ? payload.snapshot.status : "unknown",
      origin: typeof payload.snapshot?.origin === "string" ? payload.snapshot.origin : "indeterminate",
      revision: payload.snapshot?.revision
    };
    if (Number.isNaN(Date.parse(snapshot.occurredAt))
      || snapshot.revision !== payload.previousRevision + 1
      || stableJson(snapshot) !== stableJson(payload.snapshot)) {
      throw new Error("incident_monotonic_update_snapshot_mismatch");
    }
    let event;
    try { event = JSON.parse(payload.eventJson); }
    catch { throw new Error("incident_monotonic_event_corrupt"); }
    if (stableJson(event) !== payload.eventJson
      || event?.schemaVersion !== 1
      || event.installationId !== this.#installationId
      || event.sequence !== payload.sequence
      || typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)
      || event.incidentId !== snapshot.id
      || event.eventType !== "incident.updated"
      || event.revision !== snapshot.revision
      || event.occurredAt !== snapshot.occurredAt
      || !/^[a-f0-9]{64}$/.test(event.previousHash ?? "")
      || stableJson(event.payload) !== stableJson(snapshot)) {
      throw new Error("incident_monotonic_update_event_mismatch");
    }

    this.#verifyEventChain();
    const existing = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ? AND incident_id = ?"
    ].join(" ")).get(this.#installationId, snapshot.id);
    if (!existing) throw new Error("incident_monotonic_update_missing");
    const current = parseStoredIncident(existing, this.#installationId);
    if (current.revision === snapshot.revision && stableJson(current) === stableJson(snapshot)) {
      const eventRow = this.#database.prepare([
        "SELECT event_json, event_hash FROM office_kit_incident_events",
        "WHERE installation_id = ? AND sequence = ?"
      ].join(" ")).get(this.#installationId, payload.sequence);
      const macRow = this.#database.prepare([
        "SELECT key_id, previous_mac, event_mac FROM office_kit_incident_event_macs",
        "WHERE installation_id = ? AND sequence = ?"
      ].join(" ")).get(this.#installationId, payload.sequence);
      const head = this.#database.prepare([
        "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
        "WHERE installation_id = ?"
      ].join(" ")).get(this.#installationId);
      if (eventRow?.event_json === payload.eventJson
        && eventRow?.event_hash === payload.eventHash
        && macRow?.key_id === payload.keyId
        && macRow?.previous_mac === payload.previousMac
        && macRow?.event_mac === payload.eventMac
        && Number(head?.sequence) === payload.sequence
        && head?.head_hash === payload.eventHash) return snapshot.id;
      throw new Error("incident_monotonic_existing_update_conflict");
    }
    if (current.revision !== payload.previousRevision
      || this.#cryptoProvider.sha256Hex(stableJson(current)) !== payload.previousSnapshotHash) {
      throw new Error("incident_monotonic_update_predecessor_mismatch");
    }

    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    const expectedSequence = Number(head?.sequence ?? 0) + 1;
    const previousHash = head?.head_hash ?? ZERO_HASH;
    if (expectedSequence !== payload.sequence || event.previousHash !== previousHash) {
      throw new Error("incident_monotonic_event_head_conflict");
    }
    const expectedHash = this.#cryptoProvider.sha256Hex(payload.eventJson);
    if (expectedHash !== payload.eventHash) throw new Error("incident_monotonic_event_hash_mismatch");
    const previousMacRow = this.#database.prepare(
      "SELECT event_mac FROM office_kit_incident_event_macs WHERE installation_id = ? ORDER BY sequence DESC LIMIT 1"
    ).get(this.#installationId);
    const previousMac = previousMacRow?.event_mac ?? ZERO_HASH;
    if (previousMac !== payload.previousMac) throw new Error("incident_monotonic_mac_head_conflict");
    const macProvider = this.#macProviders.get(payload.keyId);
    const expectedMac = macProvider.hmacSha256Hex(this.#macMessage(payload.sequence, payload.eventHash, previousMac));
    if (!constantTimeHexEqual(expectedMac, payload.eventMac)) {
      throw new Error("incident_monotonic_event_mac_mismatch");
    }

    const updated = this.#database.prepare([
      "UPDATE office_kit_incidents",
      "SET occurred_at = ?, status = ?, origin = ?, revision = ?, incident_json = ?",
      "WHERE installation_id = ? AND incident_id = ? AND revision = ?"
    ].join(" ")).run(
      snapshot.occurredAt, snapshot.status, snapshot.origin, snapshot.revision,
      JSON.stringify(snapshot), this.#installationId, snapshot.id, payload.previousRevision
    );
    if (Number(updated.changes) !== 1) throw new Error("incident_update_conflict");
    this.#database.prepare([
      "INSERT INTO office_kit_incident_events",
      "(installation_id, sequence, event_id, incident_id, event_type, revision, previous_hash, event_json, event_hash)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, payload.sequence, event.eventId, snapshot.id,
      event.eventType, event.revision, event.previousHash, payload.eventJson, payload.eventHash
    );
    this.#database.prepare([
      "INSERT INTO office_kit_incident_event_macs",
      "(installation_id, sequence, key_id, previous_mac, event_mac)",
      "VALUES (?, ?, ?, ?, ?)"
    ].join(" ")).run(
      this.#installationId, payload.sequence, payload.keyId, payload.previousMac, payload.eventMac
    );
    if (head) {
      const moved = this.#database.prepare([
        "UPDATE office_kit_incident_chain_heads SET sequence = ?, head_hash = ?",
        "WHERE installation_id = ? AND sequence = ? AND head_hash = ?"
      ].join(" ")).run(
        payload.sequence, payload.eventHash, this.#installationId, head.sequence, head.head_hash
      );
      if (Number(moved.changes) !== 1) throw new Error("incident_event_chain_head_conflict");
    } else {
      this.#database.prepare([
        "INSERT INTO office_kit_incident_chain_heads (installation_id, sequence, head_hash)",
        "VALUES (?, ?, ?)"
      ].join(" ")).run(this.#installationId, payload.sequence, payload.eventHash);
    }
    this.#verifyEventChain();
    return snapshot.id;
  }

  applyPreparedMonotonicPayload(payload, checkpoint) {
    if (payload?.kind === "office-kit.monotonic-incident-append.v1") {
      return this.applyPreparedMonotonicAppend(payload, checkpoint);
    }
    if (payload?.kind === MONOTONIC_UPDATE_KIND) {
      return this.applyPreparedMonotonicUpdate(payload, checkpoint);
    }
    throw new Error("incident_monotonic_payload_kind_invalid");
  }

  #macMessage(sequence, eventHash, previousMac) {
    return [MAC_DOMAIN, this.#installationId, String(sequence), eventHash, previousMac].join("\0");
  }

  hasMacRecords() {
    const row = this.#database.prepare(
      "SELECT COUNT(*) AS count FROM office_kit_incident_event_macs WHERE installation_id = ?"
    ).get(this.#installationId);
    return Number(row.count) > 0;
  }

  configureMacProvider(provider) {
    if (!provider || typeof provider.keyId !== "string") {
      throw new TypeError("incident_mac_provider_invalid");
    }
    return this.configureMacKeyring({
      providers: [provider],
      activeKeyId: provider.keyId
    });
  }

  configureMacKeyring({ providers, activeKeyId } = {}) {
    if (!Array.isArray(providers) || providers.length < 1 || providers.length > 32
      || typeof activeKeyId !== "string") {
      throw new TypeError("incident_mac_keyring_invalid");
    }
    const nextProviders = new Map();
    for (const provider of providers) {
      if (!provider || typeof provider.keyId !== "string"
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(provider.keyId)
        || typeof provider.hmacSha256Hex !== "function"
        || nextProviders.has(provider.keyId)) {
        throw new TypeError("incident_mac_provider_invalid");
      }
      nextProviders.set(provider.keyId, provider);
    }
    const activeProvider = nextProviders.get(activeKeyId);
    if (!activeProvider) throw new Error("incident_mac_active_key_unavailable");

    if (!this.#integrityReady) this.#verifyEventChain({ allowUnkeyed: true });

    const previousProviders = this.#macProviders;
    const previousActive = this.#macProvider;
    const previousReady = this.#integrityReady;
    this.#macProviders = nextProviders;
    this.#macProvider = activeProvider;

    try {
      const rows = this.#database.prepare(
        "SELECT sequence, event_hash FROM office_kit_incident_events WHERE installation_id = ? ORDER BY sequence ASC"
      ).all(this.#installationId);
      const macRows = this.#database.prepare(
        "SELECT COUNT(*) AS count FROM office_kit_incident_event_macs WHERE installation_id = ?"
      ).get(this.#installationId);
      if (Number(macRows.count) !== 0 && Number(macRows.count) !== rows.length) {
        throw new Error("incident_mac_chain_incomplete");
      }
      if (Number(macRows.count) === 0 && rows.length > 0) {
        runImmediate(this.#database, () => {
          let previousMac = ZERO_HASH;
          for (const row of rows) {
            const eventMac = activeProvider.hmacSha256Hex(
              this.#macMessage(Number(row.sequence), row.event_hash, previousMac)
            );
            if (typeof eventMac !== "string" || !/^[a-f0-9]{64}$/.test(eventMac)) {
              throw new Error("incident_mac_provider_invalid_result");
            }
            this.#database.prepare([
              "INSERT INTO office_kit_incident_event_macs (installation_id, sequence, key_id, previous_mac, event_mac)",
              "VALUES (?, ?, ?, ?, ?)"
            ].join(" ")).run(
              this.#installationId, Number(row.sequence), activeProvider.keyId, previousMac, eventMac
            );
            previousMac = eventMac;
          }
        });
      }
      this.#integrityReady = true;
      return this.#verifyEventChain();
    } catch (error) {
      this.#macProviders = previousProviders;
      this.#macProvider = previousActive;
      this.#integrityReady = previousReady;
      throw error;
    }
  }

  getMacKeyIds() {
    return this.#database.prepare([
      "SELECT DISTINCT key_id FROM office_kit_incident_event_macs",
      "WHERE installation_id = ? ORDER BY key_id ASC"
    ].join(" ")).all(this.#installationId).map(row => row.key_id);
  }

  #verifyEventChain({ allowUnkeyed = false } = {}) {
    if (this.#integrityRequired && !this.#integrityReady && !allowUnkeyed) {
      throw new Error("incident_integrity_key_unavailable");
    }
    const rows = this.#database.prepare([
      "SELECT sequence, event_json, event_hash FROM office_kit_incident_events",
      "WHERE installation_id = ? ORDER BY sequence ASC"
    ].join(" ")).all(this.#installationId);
    let previousHash = ZERO_HASH;
    const latestByIncident = new Map();
    let expectedSequence = 1;
    let headMac = null;

    for (const row of rows) {
      let event;
      try { event = JSON.parse(row.event_json); }
      catch { throw new Error("incident_event_chain_corrupt"); }

      const payload = event?.payload;
      const previous = typeof event?.incidentId === "string"
        ? latestByIncident.get(event.incidentId)
        : null;
      const isFirstForIncident = !previous;
      if (!event || event.schemaVersion !== 1
        || event.installationId !== this.#installationId
        || event.sequence !== expectedSequence
        || Number(row.sequence) !== expectedSequence
        || event.previousHash !== previousHash
        || typeof event.eventId !== "string" || !EVENT_ID_PATTERN.test(event.eventId)
        || !EVENT_TYPES.has(event.eventType)
        || typeof event.incidentId !== "string"
        || !Number.isSafeInteger(event.revision) || event.revision < 1
        || typeof event.occurredAt !== "string" || Number.isNaN(Date.parse(event.occurredAt))
        || !payload || typeof payload !== "object" || Array.isArray(payload)
        || payload.id !== event.incidentId
        || payload.installationId !== this.#installationId
        || payload.revision !== event.revision
        || !/^[a-f0-9]{64}$/.test(event.previousHash)
        || stableJson(event) !== row.event_json) {
        throw new Error("incident_event_chain_corrupt");
      }

      if (isFirstForIncident) {
        if (!["incident.created", "incident.imported_snapshot"].includes(event.eventType)
          || (event.eventType === "incident.created" && event.revision !== 1)) {
          throw new Error("incident_event_revision_chain_corrupt");
        }
      } else if (event.eventType !== "incident.updated" || event.revision !== previous.revision + 1) {
        throw new Error("incident_event_revision_chain_corrupt");
      }

      const expectedHash = this.#cryptoProvider.sha256Hex(row.event_json);
      if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)
        || expectedHash !== row.event_hash) {
        throw new Error("incident_event_chain_corrupt");
      }
      previousHash = expectedHash;
      latestByIncident.set(event.incidentId, event);
      expectedSequence += 1;
    }

    if (this.#macProvider) {
      const macRows = this.#database.prepare([
        "SELECT sequence, key_id, previous_mac, event_mac FROM office_kit_incident_event_macs",
        "WHERE installation_id = ? ORDER BY sequence ASC"
      ].join(" ")).all(this.#installationId);
      if (macRows.length !== rows.length) throw new Error("incident_mac_chain_incomplete");
      let previousMac = ZERO_HASH;
      for (let index = 0; index < macRows.length; index += 1) {
        const macRow = macRows[index];
        const eventRow = rows[index];
        const keyProvider = this.#macProviders.get(macRow.key_id);
        const expectedMac = keyProvider?.hmacSha256Hex(
          this.#macMessage(Number(eventRow.sequence), eventRow.event_hash, previousMac)
        );
        if (Number(macRow.sequence) !== Number(eventRow.sequence)
          || !keyProvider
          || macRow.previous_mac !== previousMac
          || typeof expectedMac !== "string"
          || !constantTimeHexEqual(expectedMac, macRow.event_mac)) {
          throw new Error("incident_mac_chain_corrupt");
        }
        previousMac = expectedMac;
      }
      headMac = rows.length ? previousMac : null;
    } else {
      const macCount = this.#database.prepare(
        "SELECT COUNT(*) AS count FROM office_kit_incident_event_macs WHERE installation_id = ?"
      ).get(this.#installationId);
      if (Number(macCount.count) !== 0 && !allowUnkeyed) throw new Error("incident_integrity_key_unavailable");
    }

    const head = this.#database.prepare([
      "SELECT sequence, head_hash FROM office_kit_incident_chain_heads",
      "WHERE installation_id = ?"
    ].join(" ")).get(this.#installationId);
    if (rows.length === 0 ? Boolean(head) : (
      !head || Number(head.sequence) !== rows.length || head.head_hash !== previousHash
    )) {
      throw new Error("incident_event_chain_corrupt");
    }

    const snapshots = this.#database.prepare([
      "SELECT incident_id, incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ?"
    ].join(" ")).all(this.#installationId);
    if (snapshots.length !== latestByIncident.size) throw new Error("incident_event_snapshot_mismatch");
    for (const row of snapshots) {
      const snapshot = parseStoredIncident(row, this.#installationId);
      const latest = latestByIncident.get(row.incident_id);
      if (!latest || stableJson(latest.payload) !== stableJson(snapshot)
        || latest.revision !== snapshot.revision) {
        throw new Error("incident_event_snapshot_mismatch");
      }
    }

    return Object.freeze({
      status: this.#macProvider ? "keyed_hmac_chain" : "unkeyed_hash_chain",
      verification: this.#macProvider ? "sha256_plus_keystore_hmac" : "sha256_chain_only",
      eventCount: rows.length,
      headHash: rows.length ? previousHash : null,
      headMac,
      externalAnchor: false,
      macAlgorithm: this.#macProvider ? "HMAC-SHA-256" : null,
      keyId: this.#macProvider?.keyId ?? null,
      keyIds: this.#macProviders.size ? [...this.#macProviders.keys()].sort() : [],
      tamperEvidence: Boolean(this.#macProvider),
      tamperResistance: false
    });
  }

  #seedLegacySnapshots() {
    const existing = this.#database.prepare(
      "SELECT COUNT(*) AS count FROM office_kit_incident_events WHERE installation_id = ?"
    ).get(this.#installationId);
    if (Number(existing.count) === 0) {
      const rows = this.#database.prepare([
        "SELECT incident_id, incident_json, revision FROM office_kit_incidents",
        "WHERE installation_id = ? ORDER BY incident_id ASC"
      ].join(" ")).all(this.#installationId);
      if (rows.length) {
        runImmediate(this.#database, () => {
          const recheck = this.#database.prepare(
            "SELECT COUNT(*) AS count FROM office_kit_incident_events WHERE installation_id = ?"
          ).get(this.#installationId);
          if (Number(recheck.count) !== 0) return;
          for (const row of rows) this.#appendEvent("incident.imported_snapshot", parseStoredIncident(row, this.#installationId));
        });
      }
    }
    this.#verifyEventChain({ allowUnkeyed: true });
  }

  verifyIntegrity() {
    return this.#verifyEventChain();
  }

  listEvents() {
    this.#verifyEventChain();
    return this.#database.prepare([
      "SELECT event_json FROM office_kit_incident_events",
      "WHERE installation_id = ? ORDER BY sequence ASC"
    ].join(" ")).all(this.#installationId).map(row => structuredClone(JSON.parse(row.event_json)));
  }

  async append(incident) {
    const safe = validateIncident(incident, this.#installationId);
    const stored = { ...safe, revision: 1 };
    const serialized = JSON.stringify(stored);
    try {
      return await this.#withWriteLock(() => {
        runImmediate(this.#database, () => {
          this.#verifyEventChain();
          this.#database.prepare([
            "INSERT INTO office_kit_incidents",
            "  (installation_id, incident_id, occurred_at, status, origin, revision, incident_json)",
            "VALUES (?, ?, ?, ?, ?, ?, ?)"
          ].join("\n")).run(
            this.#installationId,
            stored.id,
            typeof stored.occurredAt === "string" ? stored.occurredAt : new Date().toISOString(),
            typeof stored.status === "string" ? stored.status : "unknown",
            typeof stored.origin === "string" ? stored.origin : "indeterminate",
            stored.revision,
            serialized
          );
          this.#appendEvent("incident.created", stored);
        });
        return stored.id;
      });
    } catch (error) {
      if (String(error?.message ?? "").toLowerCase().includes("unique")) {
        throw new Error("duplicate_incident_id");
      }
      throw error;
    }
  }

  async update(id, patch) {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/.test(id)
      || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("invalid_incident_update");
    }
    if (["id", "installationId", "schemaVersion", "revision"].some(key => Object.hasOwn(patch, key))) {
      throw new TypeError("incident_update_reserved_field");
    }
    const safePatch = sanitize(patch);
    return this.#withWriteLock(() => runImmediate(this.#database, () => {
      this.#verifyEventChain();
      const row = this.#database.prepare([
        "SELECT incident_json, revision FROM office_kit_incidents",
        "WHERE installation_id = ? AND incident_id = ?"
      ].join(" ")).get(this.#installationId, id);
      if (!row) throw new Error("incident_not_found");
      const current = parseStoredIncident(row, this.#installationId);
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("incident_revision_exhausted");
      const revision = current.revision + 1;
      const next = {
        ...validateIncident({
          ...current,
          ...safePatch,
          id,
          installationId: this.#installationId
        }, this.#installationId),
        revision
      };
      const result = this.#database.prepare([
        "UPDATE office_kit_incidents",
        "SET occurred_at = ?, status = ?, origin = ?, revision = ?, incident_json = ?",
        "WHERE installation_id = ? AND incident_id = ? AND revision = ?"
      ].join(" ")).run(
        next.occurredAt,
        next.status,
        next.origin,
        revision,
        JSON.stringify(next),
        this.#installationId,
        id,
        current.revision
      );
      if (Number(result.changes) !== 1) throw new Error("incident_update_conflict");
      this.#appendEvent("incident.updated", next);
      return id;
    }));
  }

  async get(id) {
    this.#verifyEventChain();
    const row = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ? AND incident_id = ?"
    ].join(" ")).get(this.#installationId, id);
    if (!row) return null;
    return parseStoredIncident(row, this.#installationId);
  }

  async list(options = {}) {
    this.#verifyEventChain();
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("incident_list_limit_out_of_range");
    }
    const rows = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ?",
      "ORDER BY occurred_at DESC, incident_id DESC",
      "LIMIT ?"
    ].join(" ")).all(this.#installationId, limit);
    return rows.map(row => parseStoredIncident(row, this.#installationId));
  }

  async export(options = {}) {
    if (options.ownerConsent !== true) throw new Error("incident_export_consent_required");
    const integrity = this.#verifyEventChain();
    const limit = options.limit ?? 100;
    return JSON.stringify({
      schemaVersion: 2,
      installationId: this.#installationId,
      exportedAt: new Date().toISOString(),
      ownerConsent: true,
      integrity,
      events: this.listEvents(),
      incidents: await this.list({ limit })
    }, null, 2);
  }
}
