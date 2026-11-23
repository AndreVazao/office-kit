import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createPublisherPolicyPayload,
  createPublisherPolicyEnvelope,
  verifyPublisherPolicyEnvelope,
  readPublisherPolicyPublicKey,
  loadPublisherPolicy
} from "../src/index.mjs";

const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH ?? "";
const skipReason = process.platform !== "win32"
  ? "Native publisher-policy CNG integration requires Windows."
  : !helperPath
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published CNG host."
    : false;

function callCng(request) {
  const result = spawnSync(helperPath, [], {
    input: JSON.stringify(request) + "\n",
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("publisher_policy_cng_command_failed:" + (result.stderr || result.error?.message || "unknown"));
  }
  return JSON.parse(String(result.stdout ?? "").trim());
}

test("machine CNG publisher policy key is read directly and authenticates the policy envelope", {
  skip: skipReason
}, () => {
  const installationId = "officekit-" + randomBytes(16).toString("hex");
  let provisionAttempted = false;
  let keyProvisioned = false;
  let directory;
  try {
    provisionAttempted = true;
    const provisioned = callCng({
      command: "publisher-policy-provision",
      installationId
    });
    keyProvisioned = true;
    assert.equal(provisioned.machineScope, true);
    assert.equal(provisioned.keySize, 3072);
    assert.equal(provisioned.privateKeyExportable, false);

    const payload = createPublisherPolicyPayload({
      edition: "vst",
      installationId,
      policyVersion: 1,
      createdAt: new Date().toISOString(),
      publisherSpkiSha256: "ab".repeat(32)
    });
    const signed = callCng({
      command: "publisher-policy-sign",
      installationId,
      payload: payload.toString("base64")
    });
    assert.equal(signed.ok, true);
    assert.equal(signed.algorithm, "RSA-3072-SHA256-PKCS1");
    const signature = Buffer.from(signed.signature, "base64");
    const envelope = createPublisherPolicyEnvelope({ payload, signature });

    const publicKey = readPublisherPolicyPublicKey(installationId);
    assert.equal(publicKey.keyName, provisioned.keyName);
    assert.deepEqual(publicKey.publicKeySpki, Buffer.from(provisioned.publicKeySpki, "base64"));
    assert.equal(publicKey.privateKeyExportable, false);
    assert.match(publicKey.securityDescriptorSddl, /O:BA/i);

    const verified = verifyPublisherPolicyEnvelope({
      envelope,
      publicKeySpki: publicKey.publicKeySpki,
      expectedInstallationId: installationId,
      expectedEdition: "vst"
    });
    assert.equal(verified.installationId, installationId);
    assert.equal(verified.edition, "vst");

    directory = mkdtempSync(join(tmpdir(), "office-kit-publisher-policy-cng-"));
    const policyPath = join(directory, "publisher-policy.json");
    writeFileSync(policyPath, envelope);
    const loaded = loadPublisherPolicy({
      policyPath,
      installationId,
      edition: "vst"
    });
    assert.equal(loaded.keyName, provisioned.keyName);
    assert.equal(loaded.publisherSpkiSha256, "ab".repeat(32));

    const wrongEditionRejected = () => verifyPublisherPolicyEnvelope({
      envelope,
      publicKeySpki: publicKey.publicKeySpki,
      expectedInstallationId: installationId,
      expectedEdition: "universal"
    });
    assert.throws(wrongEditionRejected, /publisher_policy_edition_mismatch/);
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
    if (provisionAttempted) {
      const deleted = callCng({
        command: "publisher-policy-delete",
        installationId,
        confirmInstallationId: installationId
      });
      if (keyProvisioned) assert.equal(deleted.deleted, true);
    }
  }
});
