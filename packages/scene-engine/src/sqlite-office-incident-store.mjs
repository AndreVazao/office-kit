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
  persistent = true;

  constructor({ database, installationId }) {
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_incident_database_required");
    }
    validateInstallationId(installationId);
    const transaction = database.transaction(() => {});
    if (!transaction || typeof transaction.immediate !== "function") {
      throw new TypeError("sqlite_immediate_transaction_required");
    }
    this.#database = database;
    this.#installationId = installationId;
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
  }

  async append(incident) {
    const safe = validateIncident(incident, this.#installationId);
    const stored = { ...safe, revision: 1 };
    const serialized = JSON.stringify(stored);
    try {
      runImmediate(this.#database, () => {
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
      });
    } catch (error) {
      if (String(error?.message ?? "").toLowerCase().includes("unique")) {
        throw new Error("duplicate_incident_id");
      }
      throw error;
    }
    return stored.id;
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
    return runImmediate(this.#database, () => {
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
      return id;
    });
  }

  async get(id) {
    const row = this.#database.prepare([
      "SELECT incident_json, revision FROM office_kit_incidents",
      "WHERE installation_id = ? AND incident_id = ?"
    ].join(" ")).get(this.#installationId, id);
    if (!row) return null;
    return parseStoredIncident(row, this.#installationId);
  }

  async list(options = {}) {
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
    return JSON.stringify({
      schemaVersion: 1,
      installationId: this.#installationId,
      exportedAt: new Date().toISOString(),
      incidents: await this.list(options)
    }, null, 2);
  }
}
