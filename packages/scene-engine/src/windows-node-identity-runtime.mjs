import { createHash, randomBytes } from "node:crypto";
import { NodeIdentityManager } from "./node-identity.mjs";
import { SqliteNodeIdentityMetadataStore } from "./sqlite-node-identity-metadata-store.mjs";
import { SqliteNodeIdentityChallengeStore } from "./node-identity-challenge-store.mjs";
import { WindowsCngP256KeyStore } from "./windows-cng-p256-keystore.mjs";

/**
 * Compose the production Windows identity providers around a host-owned SQLite
 * connection and the published CNG helper. The host remains responsible for
 * the database path, ACLs, backups, helper installation and process lifecycle.
 */
export function createWindowsNodeIdentityRuntime({
  database,
  installationId,
  hostExecutable,
  spawnImpl,
  timeoutMs,
  clock = Date.now
} = {}) {
  if (!database || typeof database.exec !== "function"
    || typeof database.prepare !== "function"
    || typeof database.transaction !== "function") {
    throw new TypeError("windows_identity_sqlite_database_required");
  }
  if (typeof clock !== "function") throw new TypeError("windows_identity_clock_required");

  const keyStore = new WindowsCngP256KeyStore({
    hostExecutable,
    installationId,
    ...(spawnImpl ? { spawnImpl } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
  const metadataStore = new SqliteNodeIdentityMetadataStore({ database, installationId });
  const challengeStore = new SqliteNodeIdentityChallengeStore({ database });
  const manager = new NodeIdentityManager({
    keyStore,
    metadataStore,
    challengeStore,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size)),
    clock
  });

  return Object.freeze({
    manager,
    keyStore,
    metadataStore,
    challengeStore,
    capabilities: keyStore.getCapabilities()
  });
}
