import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function runChild(nodePath, entrypoint, args, env, inputLines = null) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodePath, [entrypoint, ...args], {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      rejectPromise(new Error("edition_bundle_child_timeout"));
    }, 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ code, signal, stdout, stderr });
    });

    if (Array.isArray(inputLines)) child.stdin.end(inputLines.join("\n") + "\n");
    else child.stdin.end();
  });
}

function parseJsonLines(output, label) {
  const lines = output.split(/\r?\n/).filter(line => line.length > 0);
  assert.ok(lines.length > 0, label + "_empty_output");
  return lines.map(line => JSON.parse(line));
}

async function main() {
  const [bundleArgument, edition] = process.argv.slice(2);
  assert.ok(bundleArgument && ["DGM-MAT", "VST"].includes(edition), "usage: node edition-host-bundle-test-runner.mjs <bundle-directory> <DGM-MAT|VST>");

  const bundleRoot = resolve(bundleArgument);
  const manifest = JSON.parse(await readFile(join(bundleRoot, "bundle-manifest.json"), "utf8"));
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
  const entrypoint = join(bundleRoot, ...expectedEntrypoint.split("/"));
  const localAppData = await mkdtemp(join(tmpdir(), "OfficeKit-EditionBundle-"));
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    OFFICE_KIT_CNG_HOST_PATH: helperPath
  };
  const signerThumbprint = env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT;
  assert.match(signerThumbprint ?? "", /^[A-Fa-f0-9]{40}$/, "bundle_signer_thumbprint_required");

  try {
    const healthRun = await runChild(nodePath, entrypoint, ["health"], env);
    assert.equal(healthRun.code, 0, "edition_health_exit_code: " + healthRun.stderr);
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
    const serveRun = await runChild(
      nodePath,
      entrypoint,
      ["serve"],
      env,
      commands.map(command => JSON.stringify(command))
    );
    assert.equal(serveRun.code, 0, "edition_serve_exit_code: " + serveRun.stderr);
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
    const invalidArgs = await runChild(
      nodePath,
      entrypoint,
      ["serve", "--token=" + secretSentinel],
      env
    );
    assert.equal(invalidArgs.code, 2, "credential_argument_was_accepted");
    assert.ok(!invalidArgs.stdout.includes(secretSentinel), "credential_argument_was_echoed");
    assert.ok(!invalidArgs.stderr.includes(secretSentinel), "credential_argument_was_logged");

    const dataDirectory = join(localAppData, "OfficeKit", edition);
    await stat(dataDirectory);
    process.stdout.write(JSON.stringify({
      status: "passed",
      edition,
      disconnectedByDefault: true,
      credentialAbsent: true,
      connectRequiresCredential: true,
      snapshotRequiresConnection: true,
      dataDirectoryIsEditionScoped: true,
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
