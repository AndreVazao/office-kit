import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

function verifyTestOnlyAuthenticode(helperPath, expectedThumbprint) {
  if (typeof expectedThumbprint !== "string" || !/^[A-Fa-f0-9]{40}$/.test(expectedThumbprint)) {
    throw new Error("edition_bundle_test_signer_thumbprint_missing");
  }
  const escapedPath = helperPath.replace(/'/g, "''");
  const expected = expectedThumbprint.toUpperCase();
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
    throw new Error("edition_bundle_test_signature_probe_failed");
  }
  let signature;
  try { signature = JSON.parse(result.stdout.trim()); }
  catch { throw new Error("edition_bundle_test_signature_result_invalid"); }
  const thumbprintMatches = signature.thumbprint?.toUpperCase() === expected;
  const untrustedRoot = /root certificate.*not trusted by the trust provider/i.test(signature.message ?? "");
  const acceptableTrustState = signature.status === "NotTrusted" ||
    (signature.status === "UnknownError" && untrustedRoot);
  if (!thumbprintMatches || !acceptableTrustState) {
    throw new Error("edition_bundle_test_signature_invalid:" + signature.status);
  }
  return Object.freeze({
    signatureIntegrity: true,
    signerThumbprintMatches: true,
    chainTrust: "intentionally-not-established-in-test"
  });
}

function createOutput() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  return { stream, read: () => Buffer.concat(chunks).toString("utf8") };
}

async function invokeEditionCli({ runEditionCli, edition, createHost, argv, inputLines = [] }) {
  const input = new PassThrough();
  const output = createOutput();
  const invocation = runEditionCli({
    edition,
    createHost,
    argv,
    input,
    output: output.stream
  });
  input.end(inputLines.length ? inputLines.join("\n") + "\n" : "");
  const exitCode = await invocation;
  output.stream.end();
  return { exitCode, stdout: output.read() };
}

function parseJsonLines(output, label) {
  const lines = output.split(/\\r?\\n/).filter(line => line.length > 0);
  assert.ok(lines.length > 0, label + "_empty_output");
  return lines.map(line => JSON.parse(line));
}

async function main() {
  const [bundleArgument, edition] = process.argv.slice(2);
  assert.ok(bundleArgument && ["DGM-MAT", "VST"].includes(edition),
    "usage: node edition-host-bundle-test-runner.mjs <bundle-directory> <DGM-MAT|VST>");

  const bundleRoot = resolve(bundleArgument);
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(join(bundleRoot, "bundle-manifest.json"), "utf8"));
  const expectedKey = edition === "DGM-MAT" ? "dgmat" : "vst";
  const expectedEntrypoint = edition === "DGM-MAT"
    ? "packages/windows-host/src/dgmat-cli.mjs"
    : "packages/windows-host/src/vst-cli.mjs";
  assert.equal(manifest.edition, edition, "bundle_edition_mismatch");
  assert.equal(manifest.editionKey, expectedKey, "bundle_edition_key_mismatch");
  assert.equal(manifest.entrypoint, expectedEntrypoint, "bundle_entrypoint_mismatch");
  assert.equal(manifest.backendAutoConnect, false, "bundle_must_not_auto_connect");
  assert.equal(manifest.backendMode, "read-only", "bundle_must_be_read_only");

  const nodePath = join(bundleRoot, "node.exe");
  const helperPath = join(bundleRoot, "OfficeKit.CngHost.exe");
  const hostIndexPath = join(bundleRoot, "packages", "windows-host", "src", "index.mjs");
  const editionCliPath = join(bundleRoot, "packages", "windows-host", "src", "edition-cli.mjs");
  const localAppData = await mkdtemp(join(tmpdir(), "OfficeKit-EditionBundle-"));
  const signerThumbprint = process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
  assert.match(signerThumbprint ?? "", /^[A-Fa-f0-9]{40}$/, "bundle_signer_thumbprint_required");

  try {
    const [{ createWindowsHost }, { runEditionCli, resolveEditionHostOptions }] = await Promise.all([
      import(pathToFileURL(hostIndexPath).href),
      import(pathToFileURL(editionCliPath).href)
    ]);
    const hostOptions = resolveEditionHostOptions(expectedKey, {
      LOCALAPPDATA: localAppData
    });
    const createHost = () => createWindowsHost({
      ...hostOptions,
      helperPath,
      verifyHelper: path => {
        verifyTestOnlyAuthenticode(path, signerThumbprint);
        return true;
      }
    });

    const healthRun = await invokeEditionCli({
      runEditionCli,
      edition: expectedKey,
      createHost,
      argv: ["health"]
    });
    assert.equal(healthRun.exitCode, 0, "edition_health_exit_code");
    const healthLines = parseJsonLines(healthRun.stdout, "edition_health");
    assert.equal(healthLines.length, 1, "edition_health_response_count");
    const health = healthLines[0];
    assert.equal(health.ok, true, "edition_health_not_ok");
    assert.equal(health.health?.edition, expectedKey, "edition_health_identity_mismatch");
    assert.equal(health.health?.adapterConnected, false, "edition_started_connected");
    assert.equal(health.health?.backendOperationalState, "unverified", "backend_must_remain_unverified");

    const commands = [
      { command: "health" },
      { command: "credential-status" },
      { command: "connect" },
      { command: "snapshot" },
      { command: "shutdown" }
    ];
    const serveRun = await invokeEditionCli({
      runEditionCli,
      edition: expectedKey,
      createHost,
      argv: ["serve"],
      inputLines: commands.map(command => JSON.stringify(command))
    });
    assert.equal(serveRun.exitCode, 0, "edition_serve_exit_code");
    const responses = parseJsonLines(serveRun.stdout, "edition_serve");
    assert.equal(responses.length, commands.length, "edition_serve_response_count");
    assert.equal(responses[0].health?.adapterConnected, false, "serve_auto_connected");
    assert.equal(responses[1].credentials?.configured, false, "unexpected_persisted_credential");
    assert.equal(responses[2].ok, false, "connect_without_owner_credential_succeeded");
    assert.equal(responses[2].error, "connection_failed", "connect_error_not_sanitized");
    assert.equal(responses[3].ok, false, "snapshot_without_connection_succeeded");
    assert.equal(responses[3].error, "not_connected", "snapshot_error_mismatch");
    assert.equal(responses[4].shutdown, true, "serve_shutdown_not_acknowledged");

    const secretSentinel = "OFFICE_KIT_CI_SECRET_MUST_NOT_BE_ECHOED";
    const invalidArgsOutput = createOutput();
    const invalidArgsCode = await runEditionCli({
      edition: expectedKey,
      createHost: () => { throw new Error("invalid_arguments_must_not_start_host"); },
      argv: ["serve", "--token=" + secretSentinel],
      input: new PassThrough(),
      output: invalidArgsOutput.stream
    });
    invalidArgsOutput.stream.end();
    assert.equal(invalidArgsCode, 2, "credential_argument_was_accepted");
    assert.ok(!invalidArgsOutput.read().includes(secretSentinel), "credential_argument_was_echoed");

    await stat(hostOptions.appDataPath);
    process.stdout.write(JSON.stringify({
      status: "passed",
      edition,
      disconnectedByDefault: true,
      credentialAbsent: true,
      connectRequiresCredential: true,
      snapshotRequiresConnection: true,
      dataDirectoryIsEditionScoped: true,
      helperSignatureIntegrity: true,
      helperPublisherThumbprintPinned: true,
      certificateChainTrust: "not-established-by-this-test",
      productionAuthenticodePolicyExercised: false,
      liveBackendContact: false,
      physicalInstallation: false
    }) + "\n");
  } finally {
    await rm(localAppData, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({
    status: "failed",
    code: error instanceof Error ? error.message : "edition_bundle_test_failed"
  }) + "\n");
  process.exitCode = 1;
});
