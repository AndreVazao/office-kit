import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWindowsNodeIdentityRuntime } from "../src/windows.mjs";

const hostExecutable = process.env.OFFICE_KIT_CNG_HOST_PATH;

function sqliteAdapter(database) {
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
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}
const skipReason = process.platform !== "win32"
  ? "Windows identity runtime integration requires a Windows runner."
  : !hostExecutable
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published native helper."
    : false;

test("Windows runtime persists identity, rotation and one-time challenges across manager restarts", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-windows-identity-"));
  const filename = join(directory, "identity.sqlite");
  const installationId = "officekit-runtime-" + randomUUID().replaceAll("-", "");
  let database;
  let runtime;
  try {
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    const identity = await runtime.manager.create({
      organizationId: "office-kit-ci",
      nodeId: "node:windows-runtime"
    });
    const publicIdentity = await runtime.manager.getPublicIdentity();
    assert.equal(publicIdentity.identityFingerprint, identity.identityFingerprint);
    assert.equal(runtime.keyStore.getCapabilities().persistent, true);
    assert.equal(runtime.keyStore.getCapabilities().hardwareBacked, false);
    assert.equal(await runtime.keyStore.hasKey(identity.keyId), true);

    const challenge = await runtime.manager.createChallenge({ audience: "office-kit-ci-verifier" });
    const proof = await runtime.manager.provePossession(challenge);
    assert.equal(await runtime.manager.verifyProof({
      publicKey: publicIdentity.publicKey,
      challenge,
      signature: proof.signature,
      algorithm: proof.algorithm
    }), true);

    const rotated = await runtime.manager.rotate();
    assert.equal(rotated.generation, identity.generation + 1);
    assert.notEqual(rotated.keyId, identity.keyId);
    assert.notEqual(rotated.identityFingerprint, identity.identityFingerprint);
    assert.equal(await runtime.keyStore.hasKey(identity.keyId), false);
    assert.equal(await runtime.keyStore.hasKey(rotated.keyId), true);

    database.close();
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    const restoredIdentity = await runtime.manager.getPublicIdentity();
    assert.equal(restoredIdentity.identityFingerprint, rotated.identityFingerprint);
    assert.equal((await runtime.manager.reconcile()).status, "active");
    await assert.rejects(runtime.manager.provePossession(challenge), /challenge_replayed_or_already_consumed/);

    const postRestartChallenge = await runtime.manager.createChallenge({ audience: "office-kit-ci-verifier" });
    const postRestartProof = await runtime.manager.provePossession(postRestartChallenge);
    assert.equal(await runtime.manager.verifyProof({
      publicKey: restoredIdentity.publicKey,
      challenge: postRestartChallenge,
      signature: postRestartProof.signature,
      algorithm: postRestartProof.algorithm
    }), true);

    assert.equal(await runtime.manager.revoke(), true);
    assert.equal(await runtime.keyStore.hasKey(rotated.keyId), false);
    assert.equal(await runtime.manager.getPublicIdentity(), null);

    database.close();
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    assert.equal((await runtime.manager.reconcile()).status, "revoked");
    assert.equal(await runtime.manager.getPublicIdentity(), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows runtime recovers interrupted rotation and revocation key cleanup", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-windows-cleanup-"));
  const filename = join(directory, "identity.sqlite");
  const installationId = "officekit-cleanup-" + randomUUID().replaceAll("-", "");
  let database;
  let runtime;
  try {
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    const identity = await runtime.manager.create({
      organizationId: "office-kit-ci",
      nodeId: "node:windows-cleanup"
    });

    const deleteKey = runtime.keyStore.deleteKey.bind(runtime.keyStore);
    let failRotationDelete = true;
    runtime.keyStore.deleteKey = async keyId => {
      if (failRotationDelete && keyId === identity.keyId) {
        failRotationDelete = false;
        throw new Error("injected_rotation_delete_failure");
      }
      return deleteKey(keyId);
    };

    await assert.rejects(runtime.manager.rotate(), /identity_rotated_key_cleanup_pending/);
    const rotationPending = await runtime.metadataStore.get();
    assert.equal(rotationPending.pendingKeyDeletionIds.includes(identity.keyId), true);
    assert.equal(await runtime.keyStore.hasKey(identity.keyId), true);

    database.close();
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    const rotationRecovery = await runtime.manager.reconcile();
    assert.equal(rotationRecovery.status, "active");
    assert.deepEqual(rotationRecovery.pendingKeyDeletionIds, []);
    assert.equal(await runtime.keyStore.hasKey(identity.keyId), false);

    const rotatedMetadata = await runtime.metadataStore.get();
    assert.notEqual(rotatedMetadata.keyId, identity.keyId);
    assert.equal(await runtime.keyStore.hasKey(rotatedMetadata.keyId), true);
    assert.notEqual(
      (await runtime.manager.getPublicIdentity()).identityFingerprint,
      identity.identityFingerprint
    );

    const deleteRotatedKey = runtime.keyStore.deleteKey.bind(runtime.keyStore);
    let failRevocationDelete = true;
    runtime.keyStore.deleteKey = async keyId => {
      if (failRevocationDelete && keyId === rotatedMetadata.keyId) {
        failRevocationDelete = false;
        throw new Error("injected_revocation_delete_failure");
      }
      return deleteRotatedKey(keyId);
    };

    await assert.rejects(runtime.manager.revoke(), /identity_revoked_key_deletion_pending/);
    const revokedPending = await runtime.metadataStore.get();
    assert.equal(Boolean(revokedPending.revokedAt), true);
    assert.equal(revokedPending.keyDeletionPending, true);
    assert.equal(await runtime.keyStore.hasKey(rotatedMetadata.keyId), true);

    database.close();
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database: sqliteAdapter(database), installationId, hostExecutable });
    const revokeRecovery = await runtime.manager.reconcile();
    assert.equal(revokeRecovery.status, "revoked");
    assert.equal(revokeRecovery.pendingKeyDeletionIds.length, 0);
    assert.equal(await runtime.keyStore.hasKey(rotatedMetadata.keyId), false);
    assert.equal(await runtime.manager.getPublicIdentity(), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
