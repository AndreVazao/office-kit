import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWindowsHost } from "../src/index.mjs";

const skipReason = process.platform === "win32" && process.env.OFFICE_KIT_CNG_HOST_PATH
  ? false
  : "Requires the native Windows CNG helper supplied by the Windows CI job.";


test("native TBS TPM metadata probe never provisions an anchor or promotes journal protection", {
  skip: skipReason
}, () => {
  const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH;
  const result = spawnSync(helperPath, [], {
    input: JSON.stringify({
      command: "tpm-info",
      installationId: "office-kit-tpm-probe-test"
    }) + "\n",
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.ok, true);
  assert.ok([
    "detected_tpm_2_0",
    "detected_tpm_1_2",
    "not_present",
    "unsupported_schema",
    "unsupported_tpm_version",
    "unavailable"
  ].includes(response.status));
  assert.equal(response.monotonicAnchorAvailable, false);
  assert.equal(response.provisioningPerformed, false);
  if (response.status === "detected_tpm_2_0") {
    assert.equal(response.tpmVersion, "2.0");
    assert.equal(response.protectionPromotionAllowed, false);
  }
});

test("native TBS TPM capability probe sends only GetCapability and never provisions NV", {
  skip: skipReason
}, () => {
  const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH;
  const result = spawnSync(helperPath, [], {
    input: JSON.stringify({
      command: "tpm-capabilities",
      installationId: "office-kit-tpm-capabilities-test"
    }) + "\n",
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.ok, true);
  assert.ok([
    "capabilities_read",
    "not_present",
    "unsupported_tpm_1_2",
    "unsupported_tpm_version",
    "unavailable",
    "tpm_command_rejected"
  ].includes(response.status));
  assert.equal(response.nvProvisioningPerformed, false);
  assert.equal(response.monotonicAnchorAvailable, false);
  assert.equal(response.protectionPromotionAllowed, false);
  if (response.status === "capabilities_read") {
    assert.equal(response.tpmResponded, true);
    assert.equal(response.tpmVersion, "2.0");
    assert.equal(response.tbsCommandPermissionVerified, false);
    for (const value of Object.values(response.advertisedNvCommands)) {
      assert.equal(typeof value, "boolean");
    }
  }
});

function createTestMonotonicAnchorFactory() {
  let state = null;
  return ({ installationId }) => {
    if (!state) state = {
      status: "protected", installationId, anchorId: "test-only-fake-monotonic-anchor",
      checkpoint: { installationId, generation: 0, sequence: 0, eventHash: null, eventMac: null, protocolVersion: 1 }
    };
    if (state.installationId !== installationId) throw new Error("test_anchor_installation_mismatch");
    return Object.freeze({
      async capabilities() { return { hardwareBacked: true, rollbackResistant: true, atomicCompareAndAdvance: true, durableAcrossRestart: true, scope: "test-only-fake" }; },
      async read() { return structuredClone(state); },
      async advance(expected, next) {
        const current = state.checkpoint;
        if (current.generation !== expected.generation || current.sequence !== expected.sequence
          || current.eventHash !== expected.eventHash || current.eventMac !== expected.eventMac) throw new Error("test_anchor_compare_failed");
        state.checkpoint = structuredClone(next);
        return { status: "protected", installationId };
      }
    });
  };
}

function runtimeFactory() {
  return {
    capabilities: Object.freeze({ providerId: "incident-journal-cng-integration", persistent: true, hardwareBacked: false }),
    manager: {
      async reconcile() { return { status: "empty" }; },
      async getPublicIdentity() { return null; }
    }
  };
}

test("Windows host protects incident journal MAC key with CNG and a test-only anchor across restarts", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-journal-cng-"));
  const appDataPath = join(directory, "OfficeKit");
  const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH;
  let host;
  let reopened;
  const hostOptions = {
    platform: "win32",
    appDataPath,
    helperPath,
    publisherPolicyLoader: ({ installationId, edition }) => ({
        installationId,
        edition: edition ?? "universal",
        signatureIndex: 0,
        publisherSpkiSha256: "a".repeat(64),
        revocationPolicy: { runtimeStartup: "cache-only-chain-exclude-root-fail-closed" }
      }),
    verifyHelper: () => true,
    resolveUserSid: () => "S-1-5-21-100",
    applyAcl: () => {},
    runtimeFactory,
    monotonicAnchorProviderFactory: createTestMonotonicAnchorFactory()
  };
  try {
    host = createWindowsHost(hostOptions);
    await host.ready;
    const protection = await host.getIncidentProtectionState();
    assert.equal(protection.status, "protected");
    assert.equal(protection.writeEnabled, true);
    assert.equal(protection.hardwareBacked, true);
    const initial = host.incidentStore.verifyIntegrity();
    assert.equal(initial.status, "keyed_hmac_chain");
    assert.equal(initial.verification, "sha256_plus_keystore_hmac");
    assert.equal(initial.eventCount, 0);

    await assert.rejects(
      host.rotateIncidentJournalMacKey(),
      /incident_key_rotation_owner_consent_required/
    );
    await host.incidentStore.append({
      id: "incident-cng-persistence-01",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport",
      evidence: { code: "transport_timeout", detail: "read-only test observation" }
    });
    assert.equal(host.incidentStore.verifyIntegrity().eventCount, 1);

    const rotation = await host.rotateIncidentJournalMacKey({ ownerConsent: true });
    assert.equal(rotation.rotated, true);
    assert.equal(rotation.previousKeyId, "windows-cng:incident-journal-mac-v1");
    assert.equal(rotation.activeKeyId, "windows-cng:incident-journal-mac-v2");
    assert.equal(rotation.historicalKeysRetained, true);
    assert.deepEqual(host.getIncidentJournalKeyState().retainedKeyIds, [
      "windows-cng:incident-journal-mac-v1",
      "windows-cng:incident-journal-mac-v2"
    ]);

    await host.incidentStore.append({
      id: "incident-cng-persistence-02",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "adapter",
      evidence: { code: "adapter_auth_rejected", detail: "post-rotation read-only test observation" }
    });
    const rotatedIntegrity = host.incidentStore.verifyIntegrity();
    assert.equal(rotatedIntegrity.eventCount, 2);
    assert.deepEqual(rotatedIntegrity.keyIds, [
      "windows-cng:incident-journal-mac-v1",
      "windows-cng:incident-journal-mac-v2"
    ]);
    await host.close();
    host = null;

    reopened = createWindowsHost(hostOptions);
    await reopened.ready;
    const restored = reopened.incidentStore.verifyIntegrity();
    assert.equal(restored.status, "keyed_hmac_chain");
    assert.equal(restored.eventCount, 2);
    assert.deepEqual(restored.keyIds, [
      "windows-cng:incident-journal-mac-v1",
      "windows-cng:incident-journal-mac-v2"
    ]);
    assert.equal(reopened.getIncidentJournalKeyState().activeKeyId, "windows-cng:incident-journal-mac-v2");
    const restoredEvents = await reopened.incidentStore.list();
    // The incident store lists newest events first; verify both key generations survive restart.
    assert.equal(restoredEvents[0].id, "incident-cng-persistence-02");
    assert.equal(restoredEvents[1].id, "incident-cng-persistence-01");
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host keeps authenticated-only incident journaling in the native CNG vault across restarts", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-journal-cng-authenticated-only-"));
  const appDataPath = join(directory, "OfficeKit");
  const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH;
  const hostOptions = {
    platform: "win32",
    appDataPath,
    helperPath,
    verifyHelper: () => true,
    resolveUserSid: () => "S-1-5-21-100",
    applyAcl: () => {},
    runtimeFactory
  };
  let host;
  let reopened;
  try {
    host = createWindowsHost(hostOptions);
    await host.ready;

    const initialProtection = await host.getIncidentProtectionState();
    assert.equal(initialProtection.status, "authenticated_only");
    assert.equal(initialProtection.integrity, "sha256_plus_keystore_hmac");
    assert.equal(initialProtection.rollbackProtection, "unsupported");
    assert.equal(initialProtection.writeEnabled, true);
    assert.equal(initialProtection.hardwareBacked, false);

    const journalVault = host.createSecretStore("incident.journal");
    assert.equal(await journalVault.getSecret("monotonic-anchor-enrolled"), null);

    const id = "incident-authenticated-only-cng-001";
    await host.incidentStore.append({
      id,
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport",
      evidence: { code: "authenticated_only_cng_test", detail: "native CNG journal test" }
    });
    await host.incidentStore.update(id, { status: "resolved", outcome: "recovered" });

    const writtenIntegrity = host.incidentStore.verifyIntegrity();
    assert.equal(writtenIntegrity.status, "keyed_hmac_chain");
    assert.equal(writtenIntegrity.verification, "sha256_plus_keystore_hmac");
    assert.equal(writtenIntegrity.eventCount, 2);
    assert.equal(writtenIntegrity.externalAnchor, false);
    assert.equal(writtenIntegrity.tamperResistance, false);

    await host.close();
    host = null;

    reopened = createWindowsHost(hostOptions);
    await reopened.ready;
    const restoredProtection = await reopened.getIncidentProtectionState();
    assert.equal(restoredProtection.status, "authenticated_only");
    assert.equal(restoredProtection.rollbackProtection, "unsupported");
    assert.equal(restoredProtection.writeEnabled, true);
    assert.equal(restoredProtection.hardwareBacked, false);
    assert.equal((await reopened.incidentStore.get(id)).outcome, "recovered");
    assert.equal(reopened.incidentStore.verifyIntegrity().eventCount, 2);
    assert.deepEqual(reopened.incidentStore.listEvents().map(event => event.eventType), [
      "incident.created",
      "incident.updated"
    ]);
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host preserves CNG enrollment marker and blocks downgrade when a protected anchor disappears", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-journal-cng-no-downgrade-"));
  const appDataPath = join(directory, "OfficeKit");
  const helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH;
  const hostOptions = {
    platform: "win32",
    appDataPath,
    helperPath,
    verifyHelper: () => true,
    resolveUserSid: () => "S-1-5-21-100",
    applyAcl: () => {},
    runtimeFactory
  };
  const protectedAnchorFactory = createTestMonotonicAnchorFactory();
  let host;
  let reopened;
  try {
    host = createWindowsHost({
      ...hostOptions,
      monotonicAnchorProviderFactory: protectedAnchorFactory
    });
    await host.ready;
    assert.equal((await host.getIncidentProtectionState()).status, "protected");
    await host.incidentStore.append({
      id: "incident-protected-cng-enrollment-001",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport",
      evidence: { code: "protected_anchor_test", detail: "test-only fake anchor" }
    });
    await host.close();
    host = null;

    reopened = createWindowsHost(hostOptions);
    await reopened.ready;
    const protection = await reopened.getIncidentProtectionState();
    assert.equal(protection.status, "recovery_required");
    assert.equal(protection.writeEnabled, false);
    assert.equal(protection.reason, "previously_protected_anchor_unavailable");
    assert.equal(
      await reopened.createSecretStore("incident.journal").getSecret("monotonic-anchor-enrolled"),
      "true"
    );
    await assert.rejects(
      reopened.incidentStore.append({
        id: "incident-cng-downgrade-must-block-001",
        occurredAt: new Date().toISOString(),
        status: "degraded",
        origin: "transport"
      }),
      /windows_host_incident_writes_unavailable/
    );
    assert.equal((await reopened.incidentStore.list()).length, 1);
    assert.equal(reopened.incidentStore.verifyIntegrity().eventCount, 1);
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
