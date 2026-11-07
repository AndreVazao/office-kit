function validateInstallationId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw new TypeError("invalid_identity_installation_id");
  }
}

function validateMetadata(value, installationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_identity_metadata");
  }
  if (value.installationId !== undefined && value.installationId !== installationId) {
    throw new TypeError("identity_metadata_installation_scope_mismatch");
  }
  const revision = value.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("invalid_identity_metadata_revision");
  }
  return { ...value, installationId, revision };
}

/**
 * Durable SQLite implementation of NodeIdentityMetadataStore.
 * The host owns the SQLite connection, file path, driver and OS-level protection.
 * This store persists public identity metadata only; private keys belong in a
 * platform keystore and must never be written to this database.
 */
export class SqliteNodeIdentityMetadataStore {
  #database;
  #installationId;

  constructor({ database, installationId }) {
    if (!database || typeof database.exec !== "function"
      || typeof database.prepare !== "function"
      || typeof database.transaction !== "function") {
      throw new TypeError("sqlite_identity_database_required");
    }
    validateInstallationId(installationId);
    this.#database = database;
    this.#installationId = installationId;
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS office_kit_node_identity_metadata (
        installation_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);
  }

  async get() {
    const row = this.#database.prepare(
      "SELECT revision, metadata_json FROM office_kit_node_identity_metadata WHERE installation_id = ?"
    ).get(this.#installationId);
    if (!row) return null;
    let parsed;
    try {
      parsed = JSON.parse(row.metadata_json);
    } catch (cause) {
      const error = new Error("identity_metadata_corrupt_state");
      error.code = "identity_metadata_corrupt_state";
      error.cause = cause;
      throw error;
    }
    const metadata = validateMetadata(parsed, this.#installationId);
    if (metadata.revision !== row.revision) {
      throw new Error("identity_metadata_revision_mismatch");
    }
    return structuredClone(metadata);
  }

  async compareAndSet(expectedRevision, next) {
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new TypeError("invalid_identity_expected_revision");
    }
    const metadata = validateMetadata(next, this.#installationId);
    const expectedNextRevision = (expectedRevision ?? 0) + 1;
    if (metadata.revision !== expectedNextRevision) {
      throw new TypeError("identity_metadata_revision_must_increment_once");
    }
    const serialized = JSON.stringify(metadata);
    const transaction = this.#database.transaction(() => {
      const row = this.#database.prepare(
        "SELECT revision FROM office_kit_node_identity_metadata WHERE installation_id = ?"
      ).get(this.#installationId);
      const actualRevision = row?.revision ?? null;
      if (actualRevision !== expectedRevision) return false;
      if (row) {
        this.#database.prepare(
          "UPDATE office_kit_node_identity_metadata SET revision = ?, metadata_json = ? WHERE installation_id = ? AND revision = ?"
        ).run(metadata.revision, serialized, this.#installationId, expectedRevision);
      } else {
        this.#database.prepare(
          "INSERT INTO office_kit_node_identity_metadata (installation_id, revision, metadata_json) VALUES (?, ?, ?)"
        ).run(this.#installationId, metadata.revision, serialized);
      }
      return true;
    });
    return transaction.immediate();
  }
}
