import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWindowsNodeIdentityRuntime } from "../src/windows.mjs";

const hostExecutable = process.env.OFFICE_KIT_CNG_HOST_PATH;
const skipReason = process.platform !== "win32"
  ? "Windows identity runtime integration requires a Windows runner."
  : !hostExecutable
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published native helper."
    : false;

test("Windows runtime persists identity and one-time challenges across manager restarts", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-windows-identity-"));
  const filename = join(directory, "identity.sqlite");
  const installationId = "officekit-runtime-" + randomUUID().replaceAll("-", "");
  let database;
  let runtime;
  try {
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database, installationId, hostExecutable });
    const identity = await runtime.manager.create({
      organizationId: "office-kit-ci",
      nodeId: "node:windows-runtime"
    });
    const publicIdentity = await runtime.manager.getPublicIdentity();
    assert.equal(publicIdentity.identityFingerprint, identity.identityFingerprint);
    assert.equal(runtime.keyStore.getCapabilities().persistent, true);
    assert.equal(runtime.keyStore.getCapabilities().hardwareBacked, false);

    const challenge = await runtime.manager.createChallenge({ audience: "office-kit-ci-verifier" });
    const proof = await runtime.manager.provePossession(challenge);
    assert.equal(await runtime.manager.verifyProof({
      publicKey: publicIdentity.publicKey,
      challenge,
      signature: proof.signature,
      algorithm: proof.algorithm
    }), true);

    database.close();
    database = new DatabaseSync(filename);
    runtime = createWindowsNodeIdentityRuntime({ database, installationId, hostExecutable });
    assert.equal(
      (await runtime.manager.getPublicIdentity()).identityFingerprint,
      identity.identityFingerprint
    );
    assert.equal((await runtime.manager.reconcile()).status, "active");
    await assert.rejects(runtime.manager.provePossession(challenge), /challenge_replayed_or_already_consumed/);
    assert.equal(await runtime.manager.revoke(), true);
    assert.equal(await runtime.manager.getPublicIdentity(), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
