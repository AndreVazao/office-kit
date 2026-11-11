import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
import { WindowsCngSecretVault } from "../src/secret-vault.mjs";

const hostExecutable = process.env.OFFICE_KIT_CNG_HOST_PATH;
const skipReason = process.platform !== "win32"
  ? "Windows CNG integration requires a Windows runner."
  : !hostExecutable
    ? "OFFICE_KIT_CNG_HOST_PATH must point to the published native helper."
    : !DatabaseSync
      ? "node:sqlite is unavailable in this Node runtime."
      : false;

function sqliteAdapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec("BEGIN " + mode);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}

test("Windows CNG protects DGM bootstrap secrets across helper processes and isolates namespaces", {
  skip: skipReason,
  timeout: 30_000
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-cng-secret-"));
  const filename = join(directory, "secrets.sqlite");
  const installationId = "officekit-ci-" + randomUUID().replaceAll("-", "");
  const otherInstallationId = "officekit-ci-" + randomUUID().replaceAll("-", "");
  const secret = "dgm-bootstrap-" + "credential-".repeat(30);
  let database;
  let first;
  let reopened;
  let otherInstallation;
  let otherNamespace;

  try {
    database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    const options = {
      database: sqliteAdapter(database),
      installationId,
      namespace: "dgmat.bootstrap",
      hostExecutable
    };
    first = new WindowsCngSecretVault(options);
    await first.setSecret("bootstrap", secret);
    assert.equal(first.getCapabilities().hardwareBacked, false);
    assert.equal(first.getCapabilities().privateKeyNonExportable, true);
    assert.equal(await first.checkNonExportable(), true);

    const stored = database.prepare(
      "SELECT envelope_json FROM office_kit_protected_secrets WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).get(installationId, "dgmat.bootstrap", "bootstrap");
    assert.ok(stored);
    assert.doesNotMatch(stored.envelope_json, new RegExp(secret));

    database.close();
    database = new DatabaseSync(filename);
    const reopenedOptions = { ...options, database: sqliteAdapter(database) };
    reopened = new WindowsCngSecretVault(reopenedOptions);
    assert.equal(await reopened.getSecret("bootstrap"), secret);

    otherInstallation = new WindowsCngSecretVault({
      ...reopenedOptions,
      installationId: otherInstallationId
    });
    otherNamespace = new WindowsCngSecretVault({
      ...reopenedOptions,
      namespace: "universal.generic"
    });
    await otherInstallation.setSecret("bootstrap", "other-installation-credential-012345");
    await otherNamespace.setSecret("bootstrap", "other-namespace-credential-012345");
    assert.equal(await reopened.getSecret("bootstrap"), secret);
    assert.equal(await otherInstallation.getSecret("bootstrap"), "other-installation-credential-012345");
    assert.equal(await otherNamespace.getSecret("bootstrap"), "other-namespace-credential-012345");

    const destroyed = await reopened.destroy();
    assert.equal(destroyed.deletedCount, 1);
    assert.equal(destroyed.keyDeleted, true);
    assert.equal(await reopened.getSecret("bootstrap"), null);
  } finally {
    try { database?.close(); } catch {}
    try {
      const cleanupDatabase = new DatabaseSync(filename);
      try {
        const cleanup = new WindowsCngSecretVault({
          database: sqliteAdapter(cleanupDatabase),
          installationId,
          namespace: "dgmat.bootstrap",
          hostExecutable
        });
        await cleanup.destroy();
        const otherInstallCleanup = new WindowsCngSecretVault({
          database: sqliteAdapter(cleanupDatabase),
          installationId: otherInstallationId,
          namespace: "dgmat.bootstrap",
          hostExecutable
        });
        await otherInstallCleanup.destroy();
        const otherNamespaceCleanup = new WindowsCngSecretVault({
          database: sqliteAdapter(cleanupDatabase),
          installationId,
          namespace: "universal.generic",
          hostExecutable
        });
        await otherNamespaceCleanup.destroy();
      } finally {
        cleanupDatabase.close();
      }
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
