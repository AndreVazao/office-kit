import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EphemeralEd25519KeyStore, NodeIdentityManager } from "../src/node-identity.mjs";
import { SqliteNodeIdentityMetadataStore } from "../src/sqlite-node-identity-metadata-store.mjs";

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

function createManager(database, keyStore, clock) {
  const metadataStore = new SqliteNodeIdentityMetadataStore({
    database: sqliteAdapter(database),
    installationId: "office-kit-lifecycle-test"
  });
  return new NodeIdentityManager({
    keyStore,
    metadataStore,
    allowEphemeral: true,
    clock,
    digest: async value => new Uint8Array(createHash("sha256").update(value).digest()),
    randomBytes: async size => new Uint8Array(randomBytes(size))
  });
}

test("SQLite identity metadata survives database reopen across manager lifecycle operations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-identity-lifecycle-"));
  const filename = join(directory, "identity.sqlite");
  let database;
  let now = 1_800_000_000_000;
  const clock = () => now;
  // This provider is deliberately ephemeral and remains in this test process.
  // The test proves metadata durability, not OS-keystore or process-restart durability.
  const keyStore = new EphemeralEd25519KeyStore({
    subtle: webcrypto.subtle,
    randomUUID: () => webcrypto.randomUUID()
  });

  try {
    database = new DatabaseSync(filename);
    const firstManager = createManager(database, keyStore, clock);
    const first = await firstManager.create({
      organizationId: "acme-office",
      nodeId: "node:desktop-01"
    });
    assert.equal((await firstManager.getPublicIdentity()).identityFingerprint, first.identityFingerprint);
    database.close();
    database = null;

    database = new DatabaseSync(filename);
    const afterReopen = createManager(database, keyStore, clock);
    const restored = await afterReopen.getPublicIdentity();
    assert.equal(restored.keyId, undefined);
    assert.equal(restored.nodeId, "node:desktop-01");
    assert.equal(restored.identityFingerprint, first.identityFingerprint);
    const challenge = await afterReopen.createChallenge({ audience: "node:desktop-01" });
    const proof = await afterReopen.provePossession(challenge);
    assert.equal(proof.keyId, first.keyId);
    assert.equal(await afterReopen.verifyProof({
      publicKey: restored.publicKey,
      challenge,
      signature: proof.signature
    }), true);

    const rotated = await afterReopen.rotate();
    assert.equal(rotated.generation, first.generation + 1);
    assert.notEqual(rotated.keyId, first.keyId);
    assert.equal(await keyStore.hasKey(first.keyId), false);
    database.close();
    database = null;

    database = new DatabaseSync(filename);
    const afterRotation = createManager(database, keyStore, clock);
    assert.equal((await afterRotation.reconcile()).status, "active");
    assert.equal((await afterRotation.getPublicIdentity()).identityFingerprint, rotated.identityFingerprint);

    assert.equal(await afterRotation.revoke(), true);
    assert.equal(await afterRotation.getPublicIdentity(), null);
    database.close();
    database = null;

    database = new DatabaseSync(filename);
    const afterRevocation = createManager(database, keyStore, clock);
    assert.equal((await afterRevocation.reconcile()).status, "revoked");
    assert.equal(await afterRevocation.getPublicIdentity(), null);
    assert.equal(await keyStore.hasKey(rotated.keyId), false);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
