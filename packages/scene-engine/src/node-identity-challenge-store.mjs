/**
 * Atomic one-time challenge nonce stores.
 * The SQLite implementation uses the host-owned connection and never stores secrets.
 */
export class InMemoryNodeIdentityChallengeStore {
  #used = new Map();
  persistent = false;

  async consume({ nonce, expiresAt, now }) {
    if (typeof nonce !== "string" || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)) {
      throw new TypeError("invalid_challenge_replay_record");
    }
    for (const [key, expiry] of this.#used) {
      if (expiry <= now) this.#used.delete(key);
    }
    if (expiresAt <= now || this.#used.has(nonce)) return false;
    this.#used.set(nonce, expiresAt);
    return true;
  }
}

/**
 * Durable, cross-process nonce consumption. The host owns DB file, driver,
 * ACLs, encryption and backup. A unique primary key makes consume atomic.
 */
export class SqliteNodeIdentityChallengeStore {
  #database;
  persistent = true;

  constructor({ database }) {
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_identity_challenge_database_required");
    }
    this.#database = database;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS office_kit_identity_challenge_replay (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async consume({ nonce, expiresAt, now }) {
    if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)
      || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now)) {
      throw new TypeError("invalid_challenge_replay_record");
    }
    if (expiresAt <= now) return false;
    const transaction = this.#database.transaction(() => {
      this.#database.prepare(
        "DELETE FROM office_kit_identity_challenge_replay WHERE expires_at <= ?"
      ).run(now);
      try {
        this.#database.prepare(
          "INSERT INTO office_kit_identity_challenge_replay (nonce, expires_at) VALUES (?, ?)"
        ).run(nonce, expiresAt);
        return true;
      } catch (error) {
        if (String(error?.message ?? "").toLowerCase().includes("unique")) return false;
        throw error;
      }
    });
    return transaction.immediate();
  }
}
