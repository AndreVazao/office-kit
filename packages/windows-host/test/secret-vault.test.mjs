import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  constants,
  generateKeyPairSync,
  privateDecrypt
} from "node:crypto";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
import { WindowsCngSecretVault } from "../src/secret-vault.mjs";

const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync }, fn);

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

function decode(value) {
  return Buffer.from(value, "base64url");
}

function fakeCngSpawn() {
  const keys = new Map();
  return (_executable, _args, options) => {
    assert.equal(options.shell, undefined);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = "";
    child.stdin.setEncoding("utf8");
    child.stdin.on("data", chunk => { input += chunk; });
    child.stdin.on("end", () => {
      let response;
      let exitCode = 0;
      try {
        const request = JSON.parse(input);
        const id = request.installationId + "\0" + request.namespace;
        if (request.command === "secret-public-key") {
          let pair = keys.get(id);
          if (!pair) {
            pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
            keys.set(id, pair);
          }
          response = {
            ok: true,
            publicKey: Buffer.from(pair.publicKey.export({ type: "spki", format: "der" })).toString("base64url"),
            keySize: 2048,
            privateKeyNonExportable: true,
            protectionLevel: "os-protected",
            hardwareBacked: false
          };
        } else if (request.command === "secret-decrypt-key") {
          const pair = keys.get(id);
          if (!pair) throw new Error("secret_key_missing");
          const key = privateDecrypt({
            key: pair.privateKey,
            oaepHash: "sha256",
            padding: constants.RSA_PKCS1_OAEP_PADDING
          }, decode(request.wrappedKey));
          response = { ok: true, key: key.toString("base64url") };
        } else if (request.command === "secret-check-export") {
          response = { ok: true, exists: keys.has(id), exportable: false };
        } else if (request.command === "secret-delete-key") {
          response = { ok: true, deleted: keys.delete(id) };
        } else {
          throw new Error("unsupported_command");
        }
      } catch {
        response = { ok: false, error: "fake_cng_operation_failed" };
        exitCode = 1;
      }
      child.stderr.end();
      child.stdout.end(JSON.stringify(response), () => child.emit("close", exitCode));
    });
    child.kill = () => true;
    return child;
  };
}

function makeVault(database, installationId = "officekit-test-install-001", namespace = "dgmat.bootstrap", spawnImpl = fakeCngSpawn()) {
  return new WindowsCngSecretVault({
    database: sqliteAdapter(database),
    installationId,
    namespace,
    hostExecutable: "/tmp/OfficeKit.CngHost.exe",
    spawnImpl,
    platform: "win32"
  });
}

sqliteTest("stores only authenticated ciphertext and recovers a DGM bootstrap secret through a fake CNG helper", async () => {
  const database = new DatabaseSync(":memory:");
  const spawnImpl = fakeCngSpawn();
  try {
    const first = makeVault(database, "officekit-test-install-001", "dgmat.bootstrap", spawnImpl);
    const secret = "bootstrap-credential-" + "x".repeat(180);
    const stored = await first.setSecret("bootstrap", secret);
    assert.equal(stored.stored, true);
    assert.equal(first.getCapabilities().hardwareBacked, false);
    assert.equal(first.getCapabilities().backupRestoreRequiresSameUserProfile, true);
    assert.equal(first.hasSecret("bootstrap"), true);
    assert.equal(await first.checkNonExportable(), true);

    const row = database.prepare(
      "SELECT envelope_json FROM office_kit_protected_secrets WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).get("officekit-test-install-001", "dgmat.bootstrap", "bootstrap");
    assert.ok(row);
    assert.doesNotMatch(row.envelope_json, new RegExp(secret));
    assert.equal(JSON.parse(row.envelope_json).algorithm, "AES-256-GCM+RSA-OAEP-SHA256");

    const second = makeVault(database, "officekit-test-install-001", "dgmat.bootstrap", spawnImpl);
    assert.equal(await second.getSecret("bootstrap"), secret);
  } finally {
    database.close();
  }
});

sqliteTest("rejects authenticated-envelope tampering and ciphertext substitution between secret names", async () => {
  const database = new DatabaseSync(":memory:");
  const spawnImpl = fakeCngSpawn();
  try {
    const vault = makeVault(database, "officekit-test-install-004", "dgmat.bootstrap", spawnImpl);
    await vault.setSecret("bootstrap", "credential-value-0123456789");
    const row = database.prepare(
      "SELECT envelope_json FROM office_kit_protected_secrets WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).get("officekit-test-install-004", "dgmat.bootstrap", "bootstrap");
    const original = JSON.parse(row.envelope_json);
    const tampered = { ...original, ciphertext: (original.ciphertext[0] === "A" ? "B" : "A") + original.ciphertext.slice(1) };
    database.prepare(
      "UPDATE office_kit_protected_secrets SET envelope_json = ? WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).run(JSON.stringify(tampered), "officekit-test-install-004", "dgmat.bootstrap", "bootstrap");
    await assert.rejects(vault.getSecret("bootstrap"), /decryption_failed/);

    database.prepare(
      "UPDATE office_kit_protected_secrets SET envelope_json = ?, secret_name = ? WHERE installation_id = ? AND namespace = ? AND secret_name = ?"
    ).run(JSON.stringify(original), "renamed", "officekit-test-install-004", "dgmat.bootstrap", "bootstrap");
    await assert.rejects(vault.getSecret("renamed"), /decryption_failed/);
    await vault.destroy();
  } finally {
    database.close();
  }
});

sqliteTest("isolates protected secrets by installation and namespace and deletes key material on destroy", async () => {
  const database = new DatabaseSync(":memory:");
  const spawnImpl = fakeCngSpawn();
  try {
    const first = makeVault(database, "officekit-test-install-001", "dgmat.bootstrap", spawnImpl);
    await first.setSecret("bootstrap", "credential-value-0123456789");
    const otherInstallation = makeVault(database, "officekit-test-install-002", "dgmat.bootstrap", spawnImpl);
    const otherNamespace = makeVault(database, "officekit-test-install-001", "universal.generic", spawnImpl);
    await otherInstallation.setSecret("bootstrap", "other-installation-credential-012345");
    await otherNamespace.setSecret("bootstrap", "other-namespace-credential-012345");
    assert.equal(await first.getSecret("bootstrap"), "credential-value-0123456789");
    assert.equal(await otherInstallation.getSecret("bootstrap"), "other-installation-credential-012345");
    assert.equal(await otherNamespace.getSecret("bootstrap"), "other-namespace-credential-012345");

    const destroyed = await first.destroy();
    assert.equal(destroyed.deletedCount, 1);
    assert.equal(destroyed.keyDeleted, true);
    assert.equal(first.hasSecret("bootstrap"), false);
    assert.equal(await first.getSecret("bootstrap"), null);
    assert.equal((await otherInstallation.destroy()).keyDeleted, true);
    assert.equal((await otherNamespace.destroy()).keyDeleted, true);
  } finally {
    database.close();
  }
});

sqliteTest("aborts a pending CNG unwrap when the session deadline cancels the keystore read", async () => {
  const database = new DatabaseSync(":memory:");
  const initialSpawn = fakeCngSpawn();
  let killed = false;
  try {
    const first = makeVault(database, "officekit-test-install-003", "dgmat.bootstrap", initialSpawn);
    await first.setSecret("bootstrap", "credential-value-0123456789");

    const slowSpawn = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {
        killed = true;
        child.emit("close", 1);
        return true;
      };
      return child;
    };
    const slow = makeVault(database, "officekit-test-install-003", "dgmat.bootstrap", slowSpawn);
    const controller = new AbortController();
    const pending = slow.getSecret("bootstrap", { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, /windows_cng_secret_cancelled/);
    assert.equal(killed, true);
  } finally {
    database.close();
  }
});

test("rejects unsupported platforms, malformed scopes and invalid secret sizes", async () => {
  const database = { exec() {}, prepare() { return { get() {}, run() {} }; }, transaction() { const fn = () => {}; fn.immediate = () => {}; return fn; } };
  assert.throws(() => new WindowsCngSecretVault({
    database, installationId: "officekit-test-install-001", namespace: "dgmat.bootstrap",
    hostExecutable: "/tmp/OfficeKit.CngHost.exe", platform: "linux"
  }), /requires_windows/);
  assert.throws(() => new WindowsCngSecretVault({
    database, installationId: "officekit-test-install-001", namespace: "../dgmat",
    hostExecutable: "/tmp/OfficeKit.CngHost.exe", platform: "win32"
  }), /namespace_invalid/);
  const vault = new WindowsCngSecretVault({
    database, installationId: "officekit-test-install-001", namespace: "dgmat.bootstrap",
    hostExecutable: "/tmp/OfficeKit.CngHost.exe", platform: "win32",
    spawnImpl: fakeCngSpawn()
  });
  await assert.rejects(vault.setSecret("bootstrap", ""), /value_invalid/);
  await assert.rejects(vault.setSecret("bootstrap", "x".repeat(8_193)), /value_invalid/);
});
