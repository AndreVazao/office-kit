const TABLE = "office_installation_lifecycle_state";

function assertDatabase(database) {
  if (!database || typeof database.exec !== "function" || typeof database.prepare !== "function") {
    throw new TypeError("installation_lifecycle_sqlite_database_required");
  }
}

function assertInstallationId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new TypeError("installation_lifecycle_installation_id_invalid");
  }
}

/**
 * SQLite-backed lifecycle state store.
 * Uses a single transaction per save; the host configures WAL and synchronous=FULL.
 * The store shares the host database and never owns/closes its connection.
 */
export class SqliteInstallationLifecycleStore {
  constructor({ database, installationId, clock = Date.now } = {}) {
    assertDatabase(database);
    assertInstallationId(installationId);
    if (typeof clock !== "function") throw new TypeError("installation_lifecycle_clock_required");
    this.database = database;
    this.installationId = installationId;
    this.clock = clock;
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        installation_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.readStatement = database.prepare(
      `SELECT state_json FROM ${TABLE} WHERE installation_id = ?`
    );
    this.writeStatement = database.prepare(`
      INSERT INTO ${TABLE} (installation_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(installation_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `);
  }

  load() {
    const row = this.readStatement.get(this.installationId);
    if (!row) return null;
    let value;
    try {
      value = JSON.parse(row.state_json);
    } catch {
      throw new Error("installation_lifecycle_sqlite_state_corrupt");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("installation_lifecycle_sqlite_state_invalid");
    }
    return value;
  }

  save(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError("installation_lifecycle_record_required");
    }
    const serialized = JSON.stringify(record);
    if (typeof serialized !== "string") throw new TypeError("installation_lifecycle_record_not_serializable");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.writeStatement.run(this.installationId, serialized, this.clock());
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* Preserve original write failure. */ }
      throw error;
    }
    return structuredClone(record);
  }
}
