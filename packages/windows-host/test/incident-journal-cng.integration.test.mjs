import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWindowsHost } from "../src/index.mjs";

const skipReason = process.platform === "win32" && process.env.OFFICE_KIT_CNG_HOST_PATH
  ? false
  : "Requires the native Windows CNG helper supplied by the Windows CI job.";

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
