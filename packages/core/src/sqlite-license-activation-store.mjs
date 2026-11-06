const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * SQLite-backed activation store for a host-provided better-sqlite3-compatible
 * connection. The host owns the database file, encryption/OS permissions,
 * backup policy and driver lifecycle. No filesystem path or secret is handled
 * by the Office Kit core.
 *
 * Required driver surface: exec(sql), prepare(sql).get(...), prepare(sql).run(...),
 * and transaction(fn).immediate(). The immediate transaction acquires the
 * SQLite write reservation before reading, preventing concurrent seat races
 * across processes sharing the same database.
 */
export class SqliteLicenseActivationStore {
  #db;
  #select;
  #upsert;

  constructor({ database } = {}) {
    if (!database || typeof database.exec !== "function" || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_database_driver_required");
    }
    this.#db = database;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS office_kit_license_activations (
        license_id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.#select = this.#db.prepare(
      "SELECT state_json FROM office_kit_license_activations WHERE license_id = ?"
    );
    this.#upsert = this.#db.prepare(`
      INSERT INTO office_kit_license_activations (license_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(license_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `);
  }

  async read(key) {
    const licenseId = this.#licenseIdFromKey(key);
    const row = this.#select.get(licenseId);
    if (!row) return null;
    let state;
    try { state = JSON.parse(row.state_json); }
    catch { throw new Error("license_activation_store_corrupt_state"); }
    if (!isRecord(state) || state.licenseId !== licenseId || state.schemaVersion !== 1) {
      throw new Error("license_activation_store_invalid_state");
    }
    return structuredClone(state);
  }

  async transact(key, updater) {
    const licenseId = this.#licenseIdFromKey(key);
    if (typeof updater !== "function") throw new TypeError("license_activation_updater_required");
    const transaction = this.#db.transaction(() => {
      const row = this.#select.get(licenseId);
      let current = null;
      if (row) {
        try { current = JSON.parse(row.state_json); }
        catch { throw new Error("license_activation_store_corrupt_state"); }
        if (!isRecord(current) || current.licenseId !== licenseId || current.schemaVersion !== 1) {
          throw new Error("license_activation_store_invalid_state");
        }
      }
      const updaterState = current === null ? null : structuredClone(current);
      const update = updater(updaterState);
      if (!isRecord(update) || !Object.prototype.hasOwnProperty.call(update, "state")
        || !Object.prototype.hasOwnProperty.call(update, "result")) {
        throw new TypeError("license_activation_updater_result_invalid");
      }
      if (update.state !== updaterState) {
        if (!isRecord(update.state) || update.state.schemaVersion !== 1 || update.state.licenseId !== licenseId) {
          throw new TypeError("license_activation_next_state_invalid");
        }
        const updatedAt = typeof update.state.updatedAt === "string"
          ? update.state.updatedAt : new Date().toISOString();
        this.#upsert.run(licenseId, JSON.stringify(update.state), updatedAt);
      }
      return structuredClone(update.result);
    });
    if (typeof transaction.immediate !== "function") {
      throw new TypeError("sqlite_immediate_transactions_required");
    }
    return transaction.immediate();
  }

  #licenseIdFromKey(key) {
    const prefix = "office-kit/license-activations/";
    if (typeof key !== "string" || !key.startsWith(prefix)) throw new TypeError("license_activation_store_key_invalid");
    const licenseId = key.slice(prefix.length);
    if (!licenseId || licenseId.length > 128 || licenseId.includes("/")) {
      throw new TypeError("license_activation_store_key_invalid");
    }
    return licenseId;
  }
}
