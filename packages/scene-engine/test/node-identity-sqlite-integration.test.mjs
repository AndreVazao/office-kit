import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EphemeralEd25519KeyStore, NodeIdentityManager } from "../src/node-identity.mjs";
import { SqliteNodeIdentityMetadataStore } from "../src/sqlite-node-identity-metadata-store.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // The package supports Node 20; real node:sqlite integration runs on Node 22+.
}

const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync }, fn);
const installationId = "office-kit-test-installation-01";

function sqliteAdapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return {
    exec: sql => database.exec(sql),
    prepare: sql => database.prepare(sql),
    transaction
  };
}

function createManager(database, keyStore, clock = Date.now) {
  const metadataStore = new SqliteNodeIdentityMetadataStore({
    database: sqliteAdapter(database),
    installationId
  });
  return new NodeIdentityManager({
    keyStore,
    metadataStore,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size)),
    clock,
    allowEphemeral: true
  });
}

function createKeyStore() {
  return new EphemeralEd25519KeyStore({
    subtle: webcrypto.subtle,
    randomUUID: () => webcrypto.randomUUID()
  });
}

sqliteTest("NodeIdentityManager rehydrates, rotates and revokes through durable SQLite metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-identity-lifecycle-"));
  const filename = join(directory, "identity.sqlite");
  const keyStore = createKeyStore();
  let database;

  try {
    database = new DatabaseSync(filename);
    let manager = createManager(database, keyStore);
    const created = await manager.create({
      organizationId: "acme-office",
      nodeId: "node:desktop-01"
    });
    const initialPublicIdentity = await manager.getPublicIdentity();
    assert.equal(initialPublicIdentity.identityFingerprint, created.identityFingerprint);

    database.close();
    database = new DatabaseSync(filename);
    manager = createManager(database, keyStore);
    assert.equal(
      (await manager.getPublicIdentity()).identityFingerprint,
      initialPublicIdentity.identityFingerprint
    );

    const rotated = await manager.rotate();
    assert.equal(rotated.generation, created.generation + 1);
    assert.notEqual(rotated.identityFingerprint, created.identityFingerprint);

    database.close();
    database = new DatabaseSync(filename);
    manager = createManager(database, keyStore);
    assert.deepEqual(await manager.reconcile(), {
      status: "active",
      pendingKeyDeletionIds: []
    });
    assert.equal(
      (await manager.getPublicIdentity()).identityFingerprint,
      rotated.identityFingerprint
    );

    assert.equal(await manager.revoke(), true);
    database.close();
    database = new DatabaseSync(filename);
    manager = createManager(database, keyStore);
    assert.equal((await manager.reconcile()).status, "revoked");
    assert.equal(await manager.getPublicIdentity(), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

sqliteTest("reconciles interrupted rotation key cleanup after reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-identity-rotate-recovery-"));
  const filename = join(directory, "identity.sqlite");
  const keyStore = createKeyStore();
  let database;

  try {
    database = new DatabaseSync(filename);
    let manager = createManager(database, keyStore);
    const previous = await manager.create({
      organizationId: "acme-office",
      nodeId: "node:desktop-02"
    });
    const deleteKey = keyStore.deleteKey.bind(keyStore);
    keyStore.deleteKey = async keyId => keyId === previous.keyId ? false : deleteKey(keyId);

    await assert.rejects(manager.rotate(), /identity_rotated_key_cleanup_pending/);
    const pending = await new SqliteNodeIdentityMetadataStore({
      database: sqliteAdapter(database),
      installationId
    }).get();
    assert.deepEqual([...pending.pendingKeyDeletionIds], [previous.keyId]);

    database.close();
    keyStore.deleteKey = deleteKey;
    database = new DatabaseSync(filename);
    manager = createManager(database, keyStore);
    const reconciled = await manager.reconcile();

    assert.equal(reconciled.status, "active");
    assert.deepEqual(reconciled.pendingKeyDeletionIds, []);
    assert.equal(await keyStore.hasKey(previous.keyId), false);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

sqliteTest("reconciles interrupted revocation cleanup after reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-identity-revoke-recovery-"));
  const filename = join(directory, "identity.sqlite");
  const keyStore = createKeyStore();
  let database;

  try {
    database = new DatabaseSync(filename);
    let manager = createManager(database, keyStore);
    const identity = await manager.create({
      organizationId: "acme-office",
      nodeId: "node:desktop-03"
    });
    const deleteKey = keyStore.deleteKey.bind(keyStore);
    keyStore.deleteKey = async () => false;

    await assert.rejects(manager.revoke(), /identity_revoked_key_deletion_pending/);
    const tombstone = await new SqliteNodeIdentityMetadataStore({
      database: sqliteAdapter(database),
      installationId
    }).get();
    assert.ok(tombstone.revokedAt);
    assert.equal(tombstone.keyDeletionPending, true);

    database.close();
    keyStore.deleteKey = deleteKey;
    database = new DatabaseSync(filename);
    manager = createManager(database, keyStore);
    const reconciled = await manager.reconcile();

    assert.equal(reconciled.status, "revoked");
    assert.equal(reconciled.pendingKeyDeletionIds.length, 0);
    assert.equal(await keyStore.hasKey(identity.keyId), false);
    assert.equal(await manager.getPublicIdentity(), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
