import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteNodeIdentityMetadataStore } from "../src/sqlite-node-identity-metadata-store.mjs";

function adapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
      try { const result = callback(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
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

const identity = revision => ({
  installationId: "install-desktop-01",
  organizationId: "acme-office",
  nodeId: "node:desktop-01",
  keyId: "key-123",
  publicKey: "public-key-only",
  identityFingerprint: "aa",
  algorithm: "Ed25519",
  generation: revision,
  revision
});

test("persists public identity metadata and enforces atomic revision CAS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-identity-"));
  const filename = join(directory, "identity.sqlite");
  let db;
  try {
    db = new DatabaseSync(filename);
    const store = new SqliteNodeIdentityMetadataStore({
      database: adapter(db),
      installationId: "install-desktop-01"
    });
    assert.equal(await store.get(), null);
    assert.equal(await store.compareAndSet(null, identity(1)), true);
    assert.equal(await store.compareAndSet(null, identity(1)), false);
    assert.equal(await store.compareAndSet(0, identity(1)), false);
    assert.equal(await store.compareAndSet(1, identity(2)), true);
    const saved = await store.get();
    assert.equal(saved.revision, 2);
    assert.equal(saved.keyId, "key-123");
    assert.equal("privateKey" in saved, false);
    assert.equal(await store.compareAndSet(1, identity(2)), false);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("isolates metadata by installation and rejects scope changes", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const first = new SqliteNodeIdentityMetadataStore({ database: adapter(db), installationId: "install-one" });
    const second = new SqliteNodeIdentityMetadataStore({ database: adapter(db), installationId: "install-two" });
    assert.equal(await first.compareAndSet(null, identity(1)), true);
    assert.equal(await second.get(), null);
    await assert.rejects(
      first.compareAndSet(1, { ...identity(2), installationId: "install-two" }),
      /identity_metadata_installation_scope_mismatch/
    );
  } finally {
    db.close();
  }
});

test("rejects corrupt metadata and persisted revision mismatch", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new SqliteNodeIdentityMetadataStore({ database: adapter(db), installationId: "install-desktop-01" });
    db.prepare("INSERT INTO office_kit_node_identity_metadata (installation_id, revision, metadata_json) VALUES (?, ?, ?)")
      .run("install-desktop-01", 1, "{broken");
    await assert.rejects(store.get(), /identity_metadata_corrupt_state/);
    db.prepare("UPDATE office_kit_node_identity_metadata SET metadata_json = ? WHERE installation_id = ?")
      .run(JSON.stringify(identity(2)), "install-desktop-01");
    await assert.rejects(store.get(), /identity_metadata_revision_mismatch/);
  } finally {
    db.close();
  }
});

test("rejects non-monotonic metadata revisions and invalid installation IDs", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new SqliteNodeIdentityMetadataStore({ database: adapter(db), installationId: "install-desktop-01" });
    assert.throws(() => new SqliteNodeIdentityMetadataStore({ database: adapter(db), installationId: "../other" }), /invalid_identity_installation_id/);
    return assert.rejects(store.compareAndSet(null, identity(2)), /identity_metadata_revision_must_increment_once/);
  } finally {
    db.close();
  }
});
