import { spawnSync } from "node:child_process";
import { createWindowsHost } from "./packages/windows-host/src/index.mjs";

function verifyTestOnlyAuthenticode(helperPath) {
  const thumbprint = process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
  if (typeof thumbprint !== "string" || !/^[A-Fa-f0-9]{40}$/.test(thumbprint)) {
    throw new Error("portable_host_test_signer_thumbprint_missing");
  }
  const escapedPath = helperPath.replace(/'/g, "''");
  const expected = thumbprint.toUpperCase();
  const script = String.raw`$moduleRoot = Join-Path $env:WINDIR 'System32\\WindowsPowerShell\\v1.0\\Modules'; $env:PSModulePath = $moduleRoot + ';' + $env:PSModulePath; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'; [pscustomobject]@{ status = [string]$signature.Status; thumbprint = [string]$signature.SignerCertificate.Thumbprint; message = [string]$signature.StatusMessage } | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("portable_host_test_signature_probe_failed");
  }
  let signature;
  try { signature = JSON.parse(result.stdout.trim()); }
  catch { throw new Error("portable_host_test_signature_result_invalid"); }
  const thumbprintMatches = signature.thumbprint?.toUpperCase() === expected;
  const untrustedRoot = /root certificate.*not trusted by the trust provider/i.test(signature.message ?? "");
  const acceptableTrustState = signature.status === "NotTrusted" ||
    (signature.status === "UnknownError" && untrustedRoot);
  if (!thumbprintMatches || !acceptableTrustState) {
    throw new Error("portable_host_test_signature_invalid:" + signature.status);
  }
  return signature;
}

async function main() {
  const command = process.argv[2] ?? "health";
  if (command === "verify-signature") {
    const signature = verifyTestOnlyAuthenticode(process.env.OFFICE_KIT_CNG_HOST_PATH ?? "");
    process.stdout.write(JSON.stringify({
      status: "signature_verified",
      trustStatus: signature.status,
      trustBoundary: "test_only_pinned_signature_integrity"
    }) + "\n");
    return;
  }

  let host;
  try {
    host = createWindowsHost({ verifyHelper: verifyTestOnlyAuthenticode });
    await host.ready;
    if (command === "health") {
      process.stdout.write(JSON.stringify(await host.health()) + "\n");
      return;
    }
    if (command === "create-identity") {
      const identity = await host.manager.create({
        organizationId: "office-kit-ci",
        nodeId: "windows-portable-host-ci"
      });
      process.stdout.write(JSON.stringify({
        status: "created",
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }) + "\n");
      return;
    }
    if (command === "rotate-identity") {
      const identity = await host.manager.rotate();
      process.stdout.write(JSON.stringify({
        status: "rotated",
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }) + "\n");
      return;
    }
    if (command === "revoke-identity") {
      const revoked = await host.manager.revoke();
      process.stdout.write(JSON.stringify({ status: revoked ? "revoked" : "unchanged" }) + "\n");
      return;
    }
    throw new Error("portable_host_test_command_unsupported");
  } finally {
    await host?.close();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    status: "error",
    code: error instanceof Error ? error.message : "portable_host_test_failed"
  }) + "\n");
  process.exitCode = 1;
});
