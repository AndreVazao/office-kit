import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWindowsHost, verifyAuthenticodeHelper } from "../src/index.mjs";
import { constants, createHash, generateKeyPairSync, sign as signData } from "node:crypto";
import { createPublisherPolicyPayload, createPublisherPolicyEnvelope, verifyPublisherPolicyEnvelope, readPublisherPolicyPublicKey, loadPublisherPolicy } from "../src/index.mjs";
import { GenericDemoAdapter } from "../../scene-engine/src/generic-demo-adapter.mjs";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

const testSecrets = new Map();
function fakeSecretVault({ installationId, namespace }) {
  if (typeof namespace !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(namespace)) {
    throw new TypeError("windows_cng_secret_namespace_invalid");
  }
  const scoped = name => [installationId, namespace, name].join("\\0");
  return Object.freeze({
    async getSecret(name) { return testSecrets.get(scoped(name)) ?? null; },
    async setSecret(name, value) { testSecrets.set(scoped(name), value); return { stored: true, name }; },
    hasSecret(name) { return testSecrets.has(scoped(name)); },
    getCapabilities() { return Object.freeze({ providerId: "test-secret-vault", protectionLevel: "test-only", hardwareBacked: false }); }
  });
}

function runtimeFactory() {
  let identity = null;
  return {
    capabilities: Object.freeze({ providerId: "test", persistent: true, hardwareBacked: false }),
    manager: {
      async getPublicIdentity() { return identity; },
      async reconcile() { return { status: identity ? "active" : "empty" }; },
      async create({ organizationId, nodeId }) {
        identity = { organizationId, nodeId, generation: 1, algorithm: "ECDSA-P256-SHA256", identityFingerprint: "aa:bb" };
        return identity;
      },
      async rotate() { throw new Error("not_used"); },
      async revoke() { identity = null; return true; }
    }
  };
}

function createTestMonotonicAnchorFactory({ holdAdvance = false } = {}) {
  let state = null;
  let enteredResolve;
  let releaseResolve;
  const advanceEntered = new Promise(resolve => { enteredResolve = resolve; });
  const advanceGate = new Promise(resolve => { releaseResolve = resolve; });
  return {
    waitForAdvance: () => advanceEntered,
    releaseAdvance: () => releaseResolve?.(),
    factory: ({ installationId }) => {
      if (!state) state = {
        status: "protected", installationId, anchorId: "test-only-fake-monotonic-anchor",
        checkpoint: { installationId, generation: 0, sequence: 0, eventHash: null, eventMac: null, protocolVersion: 1 }
      };
      if (state.installationId !== installationId) throw new Error("test_anchor_installation_mismatch");
      return Object.freeze({
        async capabilities() { return { hardwareBacked: true, rollbackResistant: true, atomicCompareAndAdvance: true, durableAcrossRestart: true, scope: "test-only-fake" }; },
        async read() { return structuredClone(state); },
        async advance(expected, next) {
          if (holdAdvance) { enteredResolve?.(); await advanceGate; }
          const current = state.checkpoint;
          if (current.installationId !== expected.installationId || current.generation !== expected.generation
            || current.sequence !== expected.sequence || current.eventHash !== expected.eventHash || current.eventMac !== expected.eventMac) {
            throw new Error("test_anchor_compare_failed");
          }
          state.checkpoint = structuredClone(next);
          return { status: "protected", installationId };
        }
      });
    }
  };
}

function setup(directory, overrides = {}) {
  const helperPath = join(directory, "helper.exe");
  writeFileSync(helperPath, "test helper");
  return createWindowsHost({
    platform: "win32",
    appDataPath: join(directory, "OfficeKit"),
    helperPath,
    resolveUserSid: () => "S-1-5-21-100",
    applyAcl: () => {},
    verifyHelper: () => true,
    runtimeFactory,
    secretVaultFactory: fakeSecretVault,
    ...overrides
  });
}

test("Windows host starts local-only, persists installation identity and reports honest health", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-"));
  let host;
  try {
    host = setup(directory);
    const initial = await host.health();
    assert.equal(initial.status, "ready");
    assert.equal(initial.identityStatus, "empty");
    assert.match(initial.installationId, /^officekit-[a-f0-9]{32}$/);
    assert.equal(initial.identity, null);

    const identity = await host.manager.create({ organizationId: "office-kit-test", nodeId: "node:host-test" });
    assert.equal(identity.generation, 1);
    const active = await host.health();
    assert.equal(active.status, "ready");
    assert.equal(active.identityStatus, "active");
    assert.equal(active.identity.identityFingerprint, "aa:bb");
    assert.equal(active.capabilities.hardwareBacked, false);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host keeps incident journaling available in authenticated-only mode without a TPM anchor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-authenticated-only-"));
  let host;
  try {
    host = setup(directory);
    await host.ready;
    const protection = await host.getIncidentProtectionState();
    assert.equal(protection.status, "authenticated_only");
    assert.equal(protection.integrity, "sha256_plus_keystore_hmac");
    assert.equal(protection.rollbackProtection, "unsupported");
    assert.equal(protection.writeEnabled, true);
    assert.equal(protection.hardwareBacked, false);
    assert.equal("monotonicCheckpointJournal" in host, false);
    const id = "incident-authenticated-only-001";
    await host.incidentStore.append({ id, status: "degraded", origin: "transport" });
    await host.incidentStore.update(id, { outcome: "recovered" });
    assert.equal((await host.incidentStore.get(id)).outcome, "recovered");
    assert.equal(host.incidentStore.verifyIntegrity().eventCount, 2);
    await host.close();
    host = null;
    host = setup(directory);
    await host.ready;
    assert.equal((await host.getIncidentProtectionState()).status, "authenticated_only");
    assert.equal((await host.incidentStore.get(id)).outcome, "recovered");
    assert.equal(host.incidentStore.verifyIntegrity().eventCount, 2);
    assert.equal((await host.health()).incidentProtection.writeEnabled, true);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host refuses authenticated-only downgrade after monotonic protection was established", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-no-downgrade-"));
  const anchor = createTestMonotonicAnchorFactory();
  let host;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    assert.equal((await host.getIncidentProtectionState()).status, "protected");
    await host.incidentStore.append({
      id: "incident-protected-before-restart-001",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    await host.close();
    host = null;
    host = setup(directory);
    await host.ready;
    const protection = await host.getIncidentProtectionState();
    assert.equal(protection.status, "recovery_required");
    assert.equal(protection.writeEnabled, false);
    assert.equal(protection.reason, "previously_protected_anchor_unavailable");
    await assert.rejects(host.incidentStore.append({
      id: "incident-must-not-downgrade-001",
      status: "degraded",
      origin: "transport"
    }), /windows_host_incident_writes_unavailable/);
    assert.equal((await host.incidentStore.list()).length, 1);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("Windows host exposes an installation-scoped generic CNG secret vault", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-secret-vault-"));
  let host;
  try {
    host = setup(directory);
    await host.ready;
    const vault = host.createSecretStore("dgmat.bootstrap");
    assert.equal(vault.getCapabilities().providerId, "test-secret-vault");
    assert.equal(vault.getCapabilities().protectionLevel, "test-only");
    assert.equal(vault.getCapabilities().hardwareBacked, false);
    assert.throws(() => host.createSecretStore("../dgmat"), /namespace_invalid/);
    const closedHost = host;
    await host.close();
    host = null;
    assert.throws(() => closedHost.createSecretStore("dgmat.bootstrap"), /windows_host_stopped/);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host rejects an untrusted helper before opening its database", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-trust-"));
  try {
    assert.throws(() => setup(directory, { verifyHelper: () => false }), /windows_host_cng_helper_untrusted/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host enforces a single process lock and releases it on close", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-lock-"));
  let first;
  try {
    first = setup(directory);
    assert.throws(() => setup(directory), /windows_host_already_running/);
    await first.close();
    first = null;
    const second = setup(directory);
    await second.close();
  } finally {
    await first?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host routes incident writes through the monotonic checkpoint before exposing them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-monotonic-lock-"));
  const anchor = createTestMonotonicAnchorFactory({ holdAdvance: true });
  let host;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    assert.equal((await host.getIncidentProtectionState()).checkpoint.sequence, 0);
    const append = host.incidentStore.append({ id: "incident-monotonic-lock-001", occurredAt: new Date().toISOString(), status: "degraded", origin: "transport" });
    await anchor.waitForAdvance();
    assert.equal((await host.incidentStore.list()).length, 0);
    let rotationSettled = false;
    const rotationPromise = host.rotateIncidentJournalMacKey({ ownerConsent: true })
      .then(value => ({ value }), error => ({ error }))
      .then(result => { rotationSettled = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rotationSettled, false);
    anchor.releaseAdvance();
    await append;
    const rotationResult = await rotationPromise;
    assert.equal(rotationResult.error, undefined);
    assert.equal(rotationResult.value.rotated, true);
    assert.equal(host.getIncidentJournalKeyState().activeKeyId, "windows-cng:incident-journal-mac-v2");
    assert.equal((await host.incidentStore.list()).length, 1);
    await host.incidentStore.update("incident-monotonic-lock-001", { status: "resolved", outcome: "fixed" });
    const updated = await host.incidentStore.get("incident-monotonic-lock-001");
    assert.equal(updated.revision, 2);
    assert.equal(updated.status, "resolved");
    assert.deepEqual(host.incidentStore.listEvents().map(event => event.eventType), ["incident.created", "incident.updated"]);
    const protection = await host.getIncidentProtectionState();
    assert.equal(protection.status, "protected");
    assert.equal(protection.checkpoint.sequence, 2);
    assert.equal(host.incidentStore.verifyIntegrity().headMac, protection.checkpoint.eventMac);
    const store = host.incidentStore;
    await host.close();
    host = null;
    await assert.rejects(store.append({ id: "incident-after-host-close", status: "degraded", origin: "transport" }), /windows_host_stopped/);
  } finally {
    anchor.releaseAdvance();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host refuses redirected or invalid installation metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-metadata-"));
  const appDataPath = join(directory, "OfficeKit");
  try {
    const host = setup(directory);
    await host.close();
    writeFileSync(join(appDataPath, "installation.json"), JSON.stringify({ installationId: "other" }));
    assert.throws(() => setup(directory), /windows_host_installation_id_corrupt/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host rejects non-Windows execution and relative storage paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-platform-"));
  try {
    assert.throws(() => createWindowsHost({ platform: "linux" }), /windows_host_requires_windows/);
    assert.throws(() => createWindowsHost({
      platform: "win32",
      appDataPath: "relative",
      helperPath: "relative"
    }), /windows_host_app_data_path_must_be_absolute/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("Authenticode verifier never takes the publisher pin from the process environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-signer-"));
  const helperPath = join(directory, "helper.exe");
  writeFileSync(helperPath, "test helper");
  const expectedThumbprint = "A".repeat(40);
  const previous = process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
  let command;
  try {
    process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT = expectedThumbprint;
    assert.throws(() => verifyAuthenticodeHelper(helperPath, {
      spawnImpl: () => {
        throw new Error("verifier_must_not_run_without_authenticated_policy");
      }
    }), /windows_host_publisher_policy_unavailable/);
    assert.throws(() => verifyAuthenticodeHelper(helperPath, {
      spawnImpl: () => ({ status: 0, stdout: "" }),
      expectedThumbprint: ""
    }), /windows_host_publisher_policy_unavailable/);
    assert.equal(verifyAuthenticodeHelper(helperPath, {
      spawnImpl: (name, args) => {
        command = { name, args };
        return { status: 0, stdout: "" };
      },
      expectedThumbprint
    }), true);
    assert.equal(command.name, "powershell.exe");
    assert.ok(command.args.at(-1).includes(expectedThumbprint));
  } finally {
    if (previous === undefined) delete process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
    else process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});


test("Windows host startup ignores an environment publisher pin and fails before opening SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-publisher-policy-"));
  const appDataPath = join(directory, "OfficeKit");
  const helperPath = join(directory, "OfficeKit.CngHost.exe");
  const previous = process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
  let databaseOpened = false;
  writeFileSync(helperPath, "test helper");
  try {
    process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT = "A".repeat(40);
    assert.throws(() => createWindowsHost({
      platform: "win32",
      appDataPath,
      helperPath,
      resolveUserSid: () => "S-1-5-21-100",
      applyAcl: () => {},
      spawnImpl: () => {
        throw new Error("PowerShell must not run without authenticated publisher policy");
      },
      databaseFactory: () => {
        databaseOpened = true;
        throw new Error("database_must_not_open");
      }
    }), /windows_host_publisher_policy_unavailable/);
    assert.equal(databaseOpened, false);
  } finally {
    if (previous === undefined) delete process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
    else process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});


test("host startup reconciliation completes before identity mutations are exposed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-ready-"));
  const events = [];
  const runtimeFactory = () => ({
    capabilities: Object.freeze({ providerId: "startup-test", persistent: true, hardwareBacked: false }),
    manager: {
      async reconcile() { events.push("reconcile"); return { status: "empty" }; },
      async create(input) {
        events.push("create");
        return { organizationId: input.organizationId, nodeId: input.nodeId, generation: 1 };
      },
      async rotate() { events.push("rotate"); },
      async revoke() { events.push("revoke"); },
      async getPublicIdentity() { return null; }
    }
  });
  let host;
  try {
    host = setup(directory, { runtimeFactory });
    await host.manager.create({ organizationId: "office-kit-test", nodeId: "startup-node" });
    assert.deepEqual(events, ["reconcile", "create"]);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("host fails closed when startup reconciliation cannot recover persisted identity state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-reconcile-fail-"));
  let mutationCalled = false;
  const runtimeFactory = () => ({
    capabilities: Object.freeze({ providerId: "startup-failure-test", persistent: true, hardwareBacked: false }),
    manager: {
      async reconcile() { throw new Error("startup_reconcile_failed"); },
      async create() { mutationCalled = true; },
      async rotate() {},
      async revoke() {},
      async getPublicIdentity() { return null; }
    }
  });
  let host;
  try {
    host = setup(directory, { runtimeFactory });
    await assert.rejects(host.manager.create({
      organizationId: "office-kit-test",
      nodeId: "blocked-node"
    }), /startup_reconcile_failed/);
    assert.equal(mutationCalled, false);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("host blocks mutations and hides identity while reconciliation remains pending", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-pending-"));
  let mutationCalled = false;
  const runtimeFactory = () => ({
    capabilities: Object.freeze({ providerId: "startup-pending-test", persistent: true, hardwareBacked: false }),
    manager: {
      async reconcile() { return { status: "cleanup_pending" }; },
      async create() { mutationCalled = true; },
      async rotate() {},
      async revoke() {},
      async getPublicIdentity() {
        return {
          organizationId: "stale-org",
          nodeId: "stale-node",
          generation: 1,
          algorithm: "ECDSA-P256-SHA256",
          identityFingerprint: "stale-fingerprint"
        };
      }
    }
  });
  let host;
  try {
    host = setup(directory, { runtimeFactory });
    await assert.rejects(host.manager.create({
      organizationId: "office-kit-test",
      nodeId: "pending-node"
    }), /windows_host_startup_reconciliation_incomplete/);
    const health = await host.health();
    assert.equal(health.status, "degraded");
    assert.equal(health.identityStatus, "cleanup_pending");
    assert.equal(health.identity, null);
    assert.equal(mutationCalled, false);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host exposes installation-scoped persistent incident diagnostics across restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-incidents-"));
  const anchor = createTestMonotonicAnchorFactory();
  let host;
  let reopened;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    const diagnostics = host.createDiagnostics({
      probes: [{
        id: "office-runtime-check",
        layer: "office_runtime",
        run: async () => ({ ok: false, code: "renderer_invariant", evidence: "renderer heartbeat failed" })
      }]
    });
    const report = await diagnostics.diagnose({ edition: "universal", adapterId: "local" });
    assert.equal(report.origin, "office_runtime");
    const [incident] = await host.incidentStore.list();
    assert.equal(incident.origin, "office_runtime");
    assert.equal(incident.installationId, host.installationId);
    await host.close();
    host = null;

    reopened = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await reopened.ready;
    assert.equal((await reopened.incidentStore.get(incident.id)).status, "degraded");
    assert.equal((await reopened.incidentStore.list()).length, 1);
    await reopened.close();
    reopened = null;
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host refuses to replace a missing journal key when authenticated history exists", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-journal-key-loss-"));
  const anchor = createTestMonotonicAnchorFactory();
  let host;
  let reopened;
  let installationId;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    installationId = host.installationId;
    await host.incidentStore.append({
      id: "incident-key-loss-001",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    await host.close();
    host = null;
    testSecrets.delete([installationId, "incident.journal", "journal-mac-v1"].join("\\0"));

    reopened = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await assert.rejects(reopened.ready, /incident_integrity_key_missing_recovery_required/);
    assert.equal(testSecrets.has([installationId, "incident.journal", "journal-mac-v1"].join("\\0")), false);
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host detects hardware and exposes adaptive policy with safe manual overrides", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-hardware-"));
  const weakFacts = {
    os: "Windows 10", architecture: "x64", cpuModel: "Test CPU",
    cpuCores: 2, memoryTotalMB: 3072, memoryAvailableMB: 1024,
    gpuName: "Integrated GPU", gpuVramMB: 512,
    storageFreeMB: 20_000, displayWidth: 1920, displayHeight: 1080
  };
  let probes = 0;
  let host;
  try {
    host = setup(directory, { hardwareProbe: () => { probes += 1; return weakFacts; } });
    const initial = await host.health();
    assert.equal(initial.hardware.cpuCores, 2);
    assert.equal(initial.resourcePolicy.profile, "economy");
    assert.equal(initial.resourcePolicy.socialActivitySemantics, "full");
    const manual = host.setResourceOverrides({ profile: "cinematic", renderer: "three_d" });
    assert.equal(manual.selectedBy, "user");
    assert.equal(manual.profile, "cinematic");
    assert.equal(host.getResourcePolicy().rendererTier, "three_d");
    assert.throws(() => host.setResourceOverrides({ profile: "invalid" }), /invalid_quality_profile/);
    assert.equal(host.getResourcePolicy().profile, "cinematic");
    const refreshed = host.refreshResourcePolicy({ measurements: { frameTimeMs: 14 } });
    assert.equal(refreshed.profile, "cinematic");
    assert.ok(probes >= 2);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("health snapshots cannot mutate the host's active resource policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-policy-copy-"));
  let host;
  try {
    host = setup(directory, {
      hardwareProbe: () => ({ os: "Windows", cpuCores: 8, memoryTotalMB: 16_384, memoryAvailableMB: 8_000, gpuVramMB: 4_096 })
    });
    const health = await host.health();
    const originalFps = host.getResourcePolicy().rendererBudget.targetFps;
    health.resourcePolicy.rendererBudget.targetFps = 999;
    health.hardware.cpuCores = 999;
    assert.equal(host.getResourcePolicy().rendererBudget.targetFps, originalFps);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("managed adapter gateway persists outage and verified recovery through the Windows host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-supervisor-"));
  const anchor = createTestMonotonicAnchorFactory();
  let host;
  let managed;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    const probes = ["office_runtime", "adapter", "transport", "backend"].map(layer => ({
      id: "probe-" + layer,
      layer,
      run: async () => ({ ok: true, code: "ok", evidence: "read-only probe passed" })
    }));
    managed = host.createManagedAdapterGateway({
      probes,
      edition: "universal",
      officeKitVersion: "test"
    });
    const adapter = new GenericDemoAdapter();
    const connected = await managed.connect(adapter);
    assert.equal(connected.verified, true);
    assert.equal(connected.state.connectionState, "live");
    assert.equal(managed.getSupervisorState().wasLive, true);
    assert.equal((await host.incidentStore.list()).length, 0);

    adapter.failTransport();
    await new Promise(resolve => setImmediate(resolve));
    const [outage] = await host.incidentStore.list();
    assert.ok(outage);
    assert.equal(outage.origin, "transport");
    assert.equal(outage.adapterId, "office-kit.demo");
    assert.equal(outage.installationId, host.installationId);
    assert.equal(outage.outcome, "unresolved");

    const reconnected = await managed.connect(adapter);
    assert.equal(reconnected.verified, true);
    assert.equal(reconnected.supervision.outageOpen, false);
    const incidents = await host.incidentStore.list();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].outcome, "recovered");
    assert.ok(incidents[0].resolvedAt);
  } finally {
    await managed?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("managed adapter gateway requires explicit diagnostic probes and closes with host", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-supervisor-close-"));
  let host;
  try {
    host = setup(directory);
    assert.throws(() => host.createManagedAdapterGateway(), /managed_gateway_requires_read_only_diagnostic_probes/);
    const probes = [{ id: "runtime", layer: "office_runtime", run: async () => ({ ok: true }) }];
    const managed = host.createManagedAdapterGateway({ probes });
    await host.close();
    assert.throws(() => managed.getState(), /windows_host_stopped|managed_gateway_closed/);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test("host-bound lifecycle controller persists operation state in the host SQLite database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-lifecycle-"));
  const events = [];
  const driver = Object.fromEntries([
    "stage", "install", "start", "stop", "activate", "backupCurrent",
    "restorePrevious", "removeRuntime", "removeData"
  ].map(name => [name, async input => { events.push([name, input]); }]));
  driver.health = async () => ({ status: "ready" });
  let host;
  let reopened;
  try {
    host = setup(directory);
    const lifecycle = host.createInstallationLifecycleRuntime({ driver });
    assert.equal((await lifecycle.initialize()).state, "absent");
    assert.throws(
      () => lifecycle.install({
        installationId: "officekit-another-installation",
        version: "0.1.0",
        packagePath: join(directory, "package")
      }),
      /windows_host_installation_id_mismatch/
    );
    assert.equal(events.length, 0);
    const installed = await lifecycle.install({
      installationId: host.installationId,
      version: "0.1.0",
      packagePath: join(directory, "package")
    });
    assert.equal(installed.state, "installed");
    await lifecycle.start();
    assert.equal(lifecycle.status().state, "running");
    assert.ok(events.some(([name]) => name === "install"));
    await host.close();
    host = null;

    reopened = setup(directory);
    const restoredLifecycle = reopened.createInstallationLifecycleRuntime({ driver });
    const restored = await restoredLifecycle.initialize();
    assert.equal(restored.state, "running");
    assert.equal(restored.version, "0.1.0");
    assert.equal(restored.recoveryRequired, false);
    await reopened.close();
    reopened = null;
  } finally {
    await reopened?.close();
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


// These regressions use real SQLite/WAL with the explicitly test-only in-memory anchor above.
// They validate host recovery decisions, not TPM hardware or physical power-loss behavior.
test("Windows host rejects an older valid SQLite backup after the monotonic anchor advances", {
  skip: !DatabaseSync
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-old-backup-"));
  const anchor = createTestMonotonicAnchorFactory();
  const backupPath = join(directory, "journal-sequence-one.sqlite");
  let host;
  let databasePath;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    await host.incidentStore.append({
      id: "incident-backup-prefix-001",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    databasePath = host.databasePath;
    await host.close();
    host = null;

    const checkpointDatabase = new DatabaseSync(databasePath);
    try {
      checkpointDatabase.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      checkpointDatabase.close();
    }
    copyFileSync(databasePath, backupPath);

    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    await host.incidentStore.append({
      id: "incident-backup-prefix-002",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    assert.equal((await host.getIncidentProtectionState()).checkpoint.sequence, 2);
    await host.close();
    host = null;

    rmSync(databasePath + "-wal", { force: true });
    rmSync(databasePath + "-shm", { force: true });
    copyFileSync(backupPath, databasePath);

    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await assert.rejects(host.ready, /monotonic_anchor_mismatch/);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows host rejects a locally valid truncated incident prefix against the protected checkpoint", {
  skip: !DatabaseSync
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-prefix-truncation-"));
  const anchor = createTestMonotonicAnchorFactory();
  let host;
  let databasePath;
  let installationId;
  try {
    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await host.ready;
    await host.incidentStore.append({
      id: "incident-prefix-truncation-001",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    await host.incidentStore.append({
      id: "incident-prefix-truncation-002",
      occurredAt: new Date().toISOString(),
      status: "degraded",
      origin: "transport"
    });
    assert.equal((await host.getIncidentProtectionState()).checkpoint.sequence, 2);
    databasePath = host.databasePath;
    installationId = host.installationId;
    await host.close();
    host = null;

    const database = new DatabaseSync(databasePath);
    try {
      database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      // Model a database-level attacker who can remove immutability triggers.
      const triggers = database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
      for (const trigger of triggers) {
        assert.match(trigger.name, /^[A-Za-z0-9_]+$/);
        database.exec(`DROP TRIGGER "${trigger.name}"`);
      }
      assert.equal(Number(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger'").get().count), 0);
      const first = database.prepare(
        "SELECT event_hash FROM office_kit_incident_events WHERE installation_id = ? AND sequence = 1"
      ).get(installationId);
      assert.ok(first?.event_hash);
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(
          "DELETE FROM office_kit_incident_events WHERE installation_id = ? AND sequence = 2"
        ).run(installationId);
        database.prepare(
          "DELETE FROM office_kit_incident_event_macs WHERE installation_id = ? AND sequence = 2"
        ).run(installationId);
        database.prepare(
          "DELETE FROM office_kit_incidents WHERE installation_id = ? AND incident_id = ?"
        ).run(installationId, "incident-prefix-truncation-002");
        const moved = database.prepare(
          "UPDATE office_kit_incident_chain_heads SET sequence = 1, head_hash = ? WHERE installation_id = ?"
        ).run(first.event_hash, installationId);
        assert.equal(Number(moved.changes), 1);
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    } finally {
      database.close();
    }

    host = setup(directory, { monotonicAnchorProviderFactory: anchor.factory });
    await assert.rejects(host.ready, /windows_host_incident_checkpoint_store_mismatch/);
  } finally {
    await host?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


const publisherPolicyTestKeyPair = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicExponent: 65537
});
const publisherPolicyTestPublicSpki = publisherPolicyTestKeyPair.publicKey.export({ type: "spki", format: "der" });
const publisherPolicyTestInstallationId = `officekit-${"a".repeat(32)}`;
const publisherPolicyTestBase = Object.freeze({
  edition: "universal",
  installationId: publisherPolicyTestInstallationId,
  policyVersion: 1,
  createdAt: "2026-11-23T16:30:00.000Z",
  publisherSpkiSha256: "ab".repeat(32)
});

function signedPublisherPolicy(overrides = {}) {
  const payload = createPublisherPolicyPayload({ ...publisherPolicyTestBase, ...overrides });
  const signature = signData("sha256", payload, {
    key: publisherPolicyTestKeyPair.privateKey,
    padding: constants.RSA_PKCS1_PADDING
  });
  return createPublisherPolicyEnvelope({ payload, signature });
}

test("publisher policy v1 signs canonical installation-scoped payloads with RSA-3072 SHA-256", () => {
  const envelope = signedPublisherPolicy();
  const policy = verifyPublisherPolicyEnvelope({
    envelope,
    publicKeySpki: publisherPolicyTestPublicSpki,
    expectedInstallationId: publisherPolicyTestInstallationId,
    expectedEdition: "universal"
  });
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.productId, "office-kit");
  assert.equal(policy.keyName, `okp-${createHash("sha256").update(publisherPolicyTestInstallationId).digest("hex").slice(0, 32)}`);
  assert.equal(policy.signatureIndex, 0);
  assert.deepEqual(policy.revocationPolicy, {
    installUpdate: "online-chain-exclude-root-fail-closed",
    runtimeStartup: "cache-only-chain-exclude-root-fail-closed"
  });
});

test("publisher policy rejects payload tampering and signatures from a different machine key", () => {
  const envelope = signedPublisherPolicy();
  const outer = JSON.parse(envelope.toString("utf8"));
  const payload = JSON.parse(Buffer.from(outer.payload, "base64").toString("utf8"));
  payload.publisherSpkiSha256 = "cd".repeat(32);
  outer.payload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const tamperedEnvelope = Buffer.from(JSON.stringify(outer), "utf8");
  assert.throws(() => verifyPublisherPolicyEnvelope({
    envelope: tamperedEnvelope,
    publicKeySpki: publisherPolicyTestPublicSpki,
    expectedInstallationId: publisherPolicyTestInstallationId,
    expectedEdition: "universal"
  }), /publisher_policy_signature_invalid/);

  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 65537 });
  assert.throws(() => verifyPublisherPolicyEnvelope({
    envelope,
    publicKeySpki: wrongKey.publicKey.export({ type: "spki", format: "der" }),
    expectedInstallationId: publisherPolicyTestInstallationId,
    expectedEdition: "universal"
  }), /publisher_policy_signature_invalid/);
});

test("publisher policy cannot be replayed across installation IDs or editions", () => {
  const envelope = signedPublisherPolicy();
  assert.throws(() => verifyPublisherPolicyEnvelope({
    envelope,
    publicKeySpki: publisherPolicyTestPublicSpki,
    expectedInstallationId: `officekit-${"b".repeat(32)}`,
    expectedEdition: "universal"
  }), /publisher_policy_installation_mismatch/);
  assert.throws(() => verifyPublisherPolicyEnvelope({
    envelope,
    publicKeySpki: publisherPolicyTestPublicSpki,
    expectedInstallationId: publisherPolicyTestInstallationId,
    expectedEdition: "vst"
  }), /publisher_policy_edition_mismatch/);
});

test("publisher policy rejects unsupported signatures, revocation modes and malformed canonical JSON", () => {
  assert.throws(() => createPublisherPolicyPayload({
    ...publisherPolicyTestBase,
    signatureIndex: 1
  }), /publisher_policy_input_schema_invalid/);
  assert.throws(() => createPublisherPolicyPayload({
    ...publisherPolicyTestBase,
    publisherSpkiSha256: "not-a-digest"
  }), /publisher_policy_publisher_spki_invalid/);
  assert.throws(() => createPublisherPolicyPayload({
    ...publisherPolicyTestBase,
    createdAt: "2026-11-23"
  }), /publisher_policy_created_at_invalid/);

  const envelope = signedPublisherPolicy();
  const outer = JSON.parse(envelope.toString("utf8"));
  const payload = JSON.parse(Buffer.from(outer.payload, "base64").toString("utf8"));
  payload.revocationPolicy.runtimeStartup = "soft-fail";
  const invalidPayload = Buffer.from(JSON.stringify(payload), "utf8");
  const invalidSignature = signData("sha256", invalidPayload, {
    key: publisherPolicyTestKeyPair.privateKey,
    padding: constants.RSA_PKCS1_PADDING
  });
  assert.throws(() => createPublisherPolicyEnvelope({
    payload: invalidPayload,
    signature: invalidSignature
  }), /publisher_policy_revocation_policy_invalid/);

  const duplicateKeyEnvelope = Buffer.from(
    `{"format":"officekit-publisher-policy-envelope-v1","format":"officekit-publisher-policy-envelope-v1","keyName":"${outer.keyName}","payload":"${outer.payload}","signature":"${outer.signature}"}`,
    "utf8"
  );
  assert.throws(() => verifyPublisherPolicyEnvelope({
    envelope: duplicateKeyEnvelope,
    publicKeySpki: publisherPolicyTestPublicSpki,
    expectedInstallationId: publisherPolicyTestInstallationId,
    expectedEdition: "universal"
  }), /publisher_policy_envelope_noncanonical/);
});


test("publisher policy public-key reader validates machine CNG metadata and derives the RSA SPKI", () => {
  const jwk = publisherPolicyTestKeyPair.publicKey.export({ format: "jwk" });
  const installationId = publisherPolicyTestInstallationId;
  const expectedKeyName = `okp-${createHash("sha256").update(installationId).digest("hex").slice(0, 32)}`;
  const expectedSddl = "O:BAG:SYD:P(A;;0xd01f01ff;;;SY)(A;;0xd01f01ff;;;BA)(A;;0x80120089;;;BU)";
  const record = {
    keyName: expectedKeyName,
    keySize: 3072,
    machineScope: true,
    algorithmGroup: "RSA",
    exportPolicy: 0,
    keyUsage: 2,
    securityDescriptorSddl: expectedSddl,
    modulus: Buffer.from(jwk.n, "base64url").toString("base64"),
    exponent: Buffer.from(jwk.e, "base64url").toString("base64")
  };
  let invocation;
  const keyInfo = readPublisherPolicyPublicKey(installationId, {
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: JSON.stringify(record), stderr: "" };
    }
  });
  assert.equal(keyInfo.keyName, expectedKeyName);
  assert.equal(keyInfo.keySize, 3072);
  assert.equal(keyInfo.machineScope, true);
  assert.equal(keyInfo.privateKeyExportable, false);
  assert.deepEqual(keyInfo.publicKeySpki, publisherPolicyTestPublicSpki);
  assert.equal(invocation.command, "powershell.exe");
  assert.equal(invocation.options.timeout, 15000);
  assert.ok(invocation.args.includes("-NoProfile"));
  assert.ok(invocation.args.includes("-NonInteractive"));
  assert.ok(invocation.args.at(-1).includes("CngKey]::Open"));
  assert.ok(invocation.args.at(-1).includes("Security Descr"));
});

test("publisher policy public-key reader rejects wrong machine scope, export policy and ACL", () => {
  const jwk = publisherPolicyTestKeyPair.publicKey.export({ format: "jwk" });
  const installationId = publisherPolicyTestInstallationId;
  const keyName = `okp-${createHash("sha256").update(installationId).digest("hex").slice(0, 32)}`;
  const base = {
    keyName,
    keySize: 3072,
    machineScope: true,
    algorithmGroup: "RSA",
    exportPolicy: 0,
    keyUsage: 2,
    securityDescriptorSddl: "O:BAG:SYD:P(A;;0xd01f01ff;;;SY)(A;;0xd01f01ff;;;BA)(A;;0x80120089;;;BU)",
    modulus: Buffer.from(jwk.n, "base64url").toString("base64"),
    exponent: Buffer.from(jwk.e, "base64url").toString("base64")
  };
  for (const [patch, pattern] of [
    [{ machineScope: false }, /publisher_policy_key_metadata_invalid/],
    [{ exportPolicy: 1 }, /publisher_policy_key_metadata_invalid/],
    [{ keyUsage: 3 }, /publisher_policy_key_metadata_invalid/],
    [{ securityDescriptorSddl: "O:SYD:(A;;GA;;;WD)" }, /publisher_policy_key_acl_invalid/],
    [{ keyName: "another-key" }, /publisher_policy_key_metadata_invalid/]
  ]) {
    assert.throws(() => readPublisherPolicyPublicKey(installationId, {
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify({ ...base, ...patch }), stderr: "" })
    }), pattern);
  }
});

test("loadPublisherPolicy authenticates a canonical manifest using the machine-key public material", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-publisher-policy-"));
  const installationId = publisherPolicyTestInstallationId;
  const policyPath = join(directory, "publisher-policy.json");
  const payload = createPublisherPolicyPayload(publisherPolicyTestBase);
  const signature = signData("sha256", payload, {
    key: publisherPolicyTestKeyPair.privateKey,
    padding: constants.RSA_PKCS1_PADDING
  });
  const envelope = createPublisherPolicyEnvelope({ payload, signature });
  writeFileSync(policyPath, envelope);
  const jwk = publisherPolicyTestKeyPair.publicKey.export({ format: "jwk" });
  const keyName = `okp-${createHash("sha256").update(installationId).digest("hex").slice(0, 32)}`;
  const record = {
    keyName,
    keySize: 3072,
    machineScope: true,
    algorithmGroup: "RSA",
    exportPolicy: 0,
    keyUsage: 2,
    securityDescriptorSddl: "O:BAG:SYD:P(A;;0xd01f01ff;;;SY)(A;;0xd01f01ff;;;BA)(A;;0x80120089;;;BU)",
    modulus: Buffer.from(jwk.n, "base64url").toString("base64"),
    exponent: Buffer.from(jwk.e, "base64url").toString("base64")
  };
  try {
    const policy = loadPublisherPolicy({
      policyPath,
      installationId,
      edition: "universal",
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify(record), stderr: "" })
    });
    assert.equal(policy.installationId, installationId);
    assert.equal(policy.publisherSpkiSha256, publisherPolicyTestBase.publisherSpkiSha256);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
