import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testSecrets = new Map();
function fakeSecretVault({ installationId, namespace }) {
  if (typeof namespace !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(namespace)) {
    throw new TypeError("windows_cng_secret_namespace_invalid");
  }
  const scoped = name => [installationId, namespace, name].join("\\0");
  return Object.freeze({
    async getSecret(name) { return testSecrets.get(scoped(name)) ?? null; },
    async setSecret(name, value) { testSecrets.set(scoped(name), value); return { stored: true, name }; },
    getCapabilities() { return Object.freeze({ providerId: "windows-integration-test-vault", protectionLevel: "test-only", hardwareBacked: false }); }
  });
}
import {
  createWindowsHost,
  resolveWindowsUserSid,
  verifyAuthenticodeHelper
} from "../src/index.mjs";

const skipReason = process.platform === "win32"
  ? false
  : "Windows ACL integration requires a Windows runner.";

function fakeRuntime() {
  return {
    capabilities: Object.freeze({
      providerId: "windows-host-acl-test",
      persistent: true,
      hardwareBacked: false
    }),
    manager: {
      async getPublicIdentity() { return null; },
      async reconcile() { return { status: "empty" }; }
    }
  };
}

function readAclText(path) {
  const result = spawnSync("icacls.exe", [path], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test("Windows host applies real user and SYSTEM ACLs to installation data", {
  skip: skipReason
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-acl-"));
  const appDataPath = join(directory, "OfficeKit");
  const helperPath = join(directory, "unsigned-test-helper.exe");
  writeFileSync(helperPath, "test-only helper; signature verifier is injected");

  let host;
  try {
    const userSid = resolveWindowsUserSid();
    assert.match(userSid, /^S-1-/);

    host = createWindowsHost({
      platform: "win32",
      appDataPath,
      helperPath,
      verifyHelper: () => true,
      runtimeFactory: fakeRuntime,
      secretVaultFactory: fakeSecretVault
    });
    assert.equal((await host.health()).identityStatus, "empty");

    const whoami = spawnSync("whoami.exe", [], { encoding: "utf8", windowsHide: true });
    assert.equal(whoami.status, 0, whoami.stderr || whoami.stdout);
    const account = whoami.stdout.trim();
    for (const path of [appDataPath, join(appDataPath, "data"), join(appDataPath, "installation.json"), host.databasePath]) {
      const acl = readAclText(path);
      assert.ok(acl.includes(userSid) || acl.toLowerCase().includes(account.toLowerCase()), "current user ACL missing from " + path + ": " + acl);
      assert.ok(/NT AUTHORITY\\SYSTEM|S-1-5-18/i.test(acl), "SYSTEM ACL missing from " + path + ": " + acl);
      const verification = spawnSync("icacls.exe", [path, "/verify"], {
        encoding: "utf8",
        windowsHide: true
      });
      assert.equal(verification.status, 0, verification.stderr || verification.stdout);
    }
  } finally {
    await host?.close();
    if (existsSync(appDataPath)) {
      const reset = spawnSync("icacls.exe", [appDataPath, "/reset", "/T", "/C"], {
        encoding: "utf8",
        windowsHide: true
      });
      assert.equal(reset.status, 0, reset.stderr || reset.stdout);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Windows Authenticode verifier rejects an unsigned helper", {
  skip: skipReason
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-host-unsigned-"));
  const helperPath = join(directory, "unsigned.exe");
  writeFileSync(helperPath, "not a PE executable");
  try {
    assert.throws(() => verifyAuthenticodeHelper(helperPath, {
      expectedThumbprint: "A".repeat(40)
    }), /windows_host_command_failed_powershell/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
