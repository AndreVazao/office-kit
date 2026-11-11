import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWindowsHost, verifyAuthenticodeHelper } from "../src/index.mjs";
import { GenericDemoAdapter } from "../../scene-engine/src/generic-demo-adapter.mjs";

const testSecrets = new Map();
function fakeSecretVault({ installationId, namespace }) {
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

test("Windows host exposes an installation-scoped generic CNG secret vault", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-secret-vault-"));
  let host;
  try {
    host = setup(directory);
    await host.ready;
    const vault = host.createSecretStore("dgmat.bootstrap");
    assert.equal(vault.getCapabilities().providerId, "windows-cng-software-ksp-secret-vault");
    assert.equal(vault.getCapabilities().protectionLevel, "os-protected");
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


test("Authenticode validation requires and pins the configured publisher thumbprint", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-signer-"));
  const helperPath = join(directory, "helper.exe");
  writeFileSync(helperPath, "test helper");
  const expectedThumbprint = "A".repeat(40);
  let command;
  try {
    assert.throws(() => verifyAuthenticodeHelper(helperPath, {
      spawnImpl: () => ({ status: 0, stdout: "" }),
      expectedThumbprint: ""
    }), /windows_host_cng_signer_thumbprint_required/);
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
  let host;
  let reopened;
  try {
    host = setup(directory);
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

    reopened = setup(directory);
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
  let host;
  let reopened;
  let installationId;
  try {
    host = setup(directory);
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

    reopened = setup(directory);
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
  let host;
  let managed;
  try {
    host = setup(directory);
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
