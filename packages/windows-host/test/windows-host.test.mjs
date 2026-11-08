import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWindowsHost, verifyAuthenticodeHelper } from "../src/index.mjs";

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

test("Windows host refuses redirected or invalid installation metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-metadata-"));
  const appDataPath = join(directory, "OfficeKit");
  try {
    const host = setup(directory);
    host.close();
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
