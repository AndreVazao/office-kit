const SECRET_KEY = /(?:token|password|secret|api[_-]?key|authorization|cookie|private[_-]?key)/i;
const SECRET_TEXT = [
  /bearer\\s+[A-Za-z0-9._~+\\/-]+=*/gi,
  /((?:token|password|secret|api[_-]?key|authorization|cookie)\\s*[:=]\\s*)[^\\s,;]+/gi
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

/**
 * Durable incident history isolated per Office Kit installation.
 * The host owns the SQLite connection, file ACLs, encryption, backup and
 * retention policy. Incident content is sanitized before persistence.
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
    this.#database = database;
    this.#installationId = installationId;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS office_kit_incidents (
        installation_id TEXT NOT NULL,
        incident_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        incident_json TEXT NOT NULL,
        PRIMARY KEY (installation_id, incident_id)
      );
      CREATE INDEX IF NOT EXISTS office_kit_incidents_recent
        ON office_kit_incidents (installation_id, occurred_at DESC);
    `);
  }

  async append(incident) {
    const safe = validateIncident(incident, this.#installationId);
    const serialized = JSON.stringify(safe);
    try {
      this.#database.prepare(`
        INSERT INTO office_kit_incidents
          (installation_id, incident_id, occurred_at, status, origin, incident_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        this.#installationId,
        safe.id,
        typeof safe.occurredAt === "string" ? safe.occurredAt : new Date().toISOString(),
        typeof safe.status === "string" ? safe.status : "unknown",
        typeof safe.origin === "string" ? safe.origin : "indeterminate",
        serialized
      );
    } catch (error) {
      if (String(error?.message ?? "").toLowerCase().includes("unique")) {
        throw new Error("duplicate_incident_id");
      }
      throw error;
    }
    return safe.id;
  }

  async update(id, patch) {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/.test(id)
      || !patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError("invalid_incident_update");
    }
    const row = this.#database.prepare(`
      SELECT incident_json FROM office_kit_incidents
      WHERE installation_id = ? AND incident_id = ?
    `).get(this.#installationId, id);
    if (!row) throw new Error("incident_not_found");
    let current;
    try { current = JSON.parse(row.incident_json); }
    catch (cause) {
      const error = new Error("incident_corrupt_state");
      error.cause = cause;
      throw error;
    }
    const safePatch = sanitize(patch);
    const next = validateIncident({ ...current, ...safePatch, id, installationId: this.#installationId }, this.#installationId);
    const result = this.#database.prepare(`
      UPDATE office_kit_incidents
      SET occurred_at = ?, status = ?, origin = ?, incident_json = ?
      WHERE installation_id = ? AND incident_id = ?
    `).run(
      next.occurredAt,
      next.status,
      next.origin,
      JSON.stringify(next),
      this.#installationId,
      id
    );
    if (Number(result.changes) !== 1) throw new Error("incident_update_conflict");
    return id;
  }

  async get(id) {
    const row = this.#database.prepare(`
      SELECT incident_json FROM office_kit_incidents
      WHERE installation_id = ? AND incident_id = ?
    `).get(this.#installationId, id);
    if (!row) return null;
    try { return structuredClone(validateIncident(JSON.parse(row.incident_json), this.#installationId)); }
    catch (cause) {
      const error = new Error("incident_corrupt_state");
      error.cause = cause;
      throw error;
    }
  }

  async list(options = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("incident_list_limit_out_of_range");
    }
    const rows = this.#database.prepare(`
      SELECT incident_json FROM office_kit_incidents
      WHERE installation_id = ?
      ORDER BY occurred_at DESC, incident_id DESC
      LIMIT ?
    `).all(this.#installationId, limit);
    return rows.map(row => {
      try { return structuredClone(validateIncident(JSON.parse(row.incident_json), this.#installationId)); }
      catch (cause) {
        const error = new Error("incident_corrupt_state");
        error.cause = cause;
        throw error;
      }
    });
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
