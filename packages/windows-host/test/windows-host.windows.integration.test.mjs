import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function readAclSids(path) {
  const escaped = path.replace(/'/g, "''");
  const script = `(Get-Acl -LiteralPath '${escaped}').Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }`;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return new Set(result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean));
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
      runtimeFactory: fakeRuntime
    });
    assert.equal((await host.health()).identityStatus, "empty");

    const paths = [
      appDataPath,
      join(appDataPath, "data"),
      join(appDataPath, "installation.json"),
      host.databasePath
    ];
    for (const path of paths) {
      const sids = readAclSids(path);
      assert.ok(sids.has(userSid), "current user ACL missing from " + path);
      assert.ok(sids.has("S-1-5-18"), "SYSTEM ACL missing from " + path);
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
