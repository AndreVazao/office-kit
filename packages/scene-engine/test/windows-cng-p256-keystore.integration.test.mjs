import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WindowsCngP256KeyStore } from "../src/windows-cng-p256-keystore.mjs";

const hostExecutable = process.env.OFFICE_KIT_CNG_HOST_PATH;
const skipReason = process.platform !== "win32"
  ? "Windows CNG integration requires a Windows runner."
  : !hostExecutable
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published native helper."
    : false;

test("Windows CNG persists a non-exportable P-256 key across helper processes and isolates installations", {
  skip: skipReason
}, async () => {
  const installationId = "officekit-ci-" + randomUUID().replaceAll("-", "");
  const otherInstallationId = "officekit-ci-" + randomUUID().replaceAll("-", "");
  const firstProcess = new WindowsCngP256KeyStore({ hostExecutable, installationId });
  const secondProcess = new WindowsCngP256KeyStore({ hostExecutable, installationId });
  const otherInstallation = new WindowsCngP256KeyStore({ hostExecutable, installationId: otherInstallationId });
  let keyId;

  try {
    const pair = await firstProcess.createKeyPair();
    keyId = pair.keyId;
    assert.equal(pair.algorithm, "ECDSA-P256-SHA256");
    assert.equal(pair.publicKey.length, 65);
    assert.match(pair.keyId, /^ok-[a-f0-9]{16}-[a-f0-9]{32}$/);

    assert.equal(firstProcess.getCapabilities().persistent, true);
    assert.equal(firstProcess.getCapabilities().protectionLevel, "os-protected");
    assert.equal(firstProcess.getCapabilities().hardwareBacked, false);
    assert.equal(firstProcess.getCapabilities().privateKeyNonExportable, true);

    assert.equal(await secondProcess.hasKey(keyId), true);
    assert.equal(await secondProcess.checkNonExportable(keyId), true);

    const message = new TextEncoder().encode("Office Kit Windows CNG persistence integration");
    const signature = await secondProcess.sign(keyId, message, pair.algorithm);
    assert.equal(signature.length, 64);
    assert.equal(await secondProcess.verify(pair.publicKey, message, signature, pair.algorithm), true);
    assert.equal(await secondProcess.verify(pair.publicKey, new TextEncoder().encode("tampered"), signature, pair.algorithm), false);

    assert.equal(await otherInstallation.hasKey(keyId), false);
    await assert.rejects(otherInstallation.sign(keyId, message, pair.algorithm), /key_scope_mismatch/);

    assert.equal(await secondProcess.deleteKey(keyId), true);
    assert.equal(await firstProcess.hasKey(keyId), false);
  } finally {
    if (keyId && await firstProcess.hasKey(keyId).catch(() => false)) {
      await firstProcess.deleteKey(keyId).catch(() => false);
    }
  }
});
