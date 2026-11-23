import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, X509Certificate } from "node:crypto";
import { verifyAuthenticodeHelper } from "../src/index.mjs";

const skipReason = process.platform !== "win32" || !process.env.WINDIR
  ? "Native WinTrust integration requires Windows."
  : false;

function getSystemPowerShellSignerCertificate(filePath) {
  const escapedPath = filePath.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$signature = Get-AuthenticodeSignature -LiteralPath '" + escapedPath + "'",
    "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { exit 3 }",
    "[Console]::Out.Write([Convert]::ToBase64String($signature.SignerCertificate.RawData))"
  ].join("; ");
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("test_system_signer_certificate_unavailable:" + (result.error?.code ?? result.status ?? "unknown") + ":" + String(result.stderr ?? "").replace(/[\\r\\n\\t]+/g, " ").slice(0, 240));
  }
  return Buffer.from(String(result.stdout ?? "").trim(), "base64");
}

test("native WinTrust verifies the primary Microsoft-signed PowerShell binary and rejects tampering", {
  skip: skipReason
}, () => {
  const systemPowerShell = join(
    process.env.WINDIR,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const signerCertificate = new X509Certificate(getSystemPowerShellSignerCertificate(systemPowerShell));
  const expectedSpkiSha256 = createHash("sha256")
    .update(signerCertificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");

  assert.equal(verifyAuthenticodeHelper(systemPowerShell, {
    expectedSpkiSha256,
    signatureIndex: 0,
    revocationMode: "online-chain-exclude-root-fail-closed"
  }), true);

  // The online check above warms the Windows revocation cache; startup mode
  // must then verify using cache-only retrieval without silently going online.
  assert.equal(verifyAuthenticodeHelper(systemPowerShell, {
    expectedSpkiSha256,
    signatureIndex: 0,
    revocationMode: "cache-only-chain-exclude-root-fail-closed"
  }), true);

  const directory = mkdtempSync(join(tmpdir(), "office-kit-wintrust-tamper-"));
  try {
    const tamperedPath = join(directory, "tampered-powershell.exe");
    copyFileSync(systemPowerShell, tamperedPath);
    const bytes = readFileSync(tamperedPath);
    bytes[0] = bytes[0] ^ 0x01;
    writeFileSync(tamperedPath, bytes);
    assert.throws(() => verifyAuthenticodeHelper(tamperedPath, {
      expectedSpkiSha256,
      signatureIndex: 0,
      revocationMode: "cache-only-chain-exclude-root-fail-closed"
    }), /windows_host_authenticode_verification_failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
