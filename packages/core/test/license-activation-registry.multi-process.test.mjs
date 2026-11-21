import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LicenseActivationRegistry } from "../src/license-activation-registry.mjs";
import { SqliteLicenseActivationStore } from "../src/sqlite-license-activation-store.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // The real multi-process SQLite test runs on the Node 22/26 CI matrix.
}

const licenseId = "multiprocess-seat-license";
const storeKey = "office-kit/license-activations/" + licenseId;
const storeModuleUrl = new URL("../src/sqlite-license-activation-store.mjs", import.meta.url).href;
const registryModuleUrl = new URL("../src/license-activation-registry.mjs", import.meta.url).href;

const childSource = [
  'import { DatabaseSync } from "node:sqlite";',
  'import { LicenseActivationRegistry } from ' + JSON.stringify(registryModuleUrl) + ';',
  'import { SqliteLicenseActivationStore } from ' + JSON.stringify(storeModuleUrl) + ';',
  'const [filename, installationId, machineFingerprint, activationId] = process.argv.slice(1);',
  'const database = new DatabaseSync(filename);',
  'database.exec("PRAGMA journal_mode = WAL");',
  'database.exec("PRAGMA synchronous = FULL");',
  'database.exec("PRAGMA busy_timeout = 10000");',
  'const transaction = callback => {',
  '  const run = mode => {',
  '    database.exec("BEGIN " + mode);',
  '    try { const result = callback(); database.exec("COMMIT"); return result; }',
  '    catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; }',
  '  };',
  '  const wrapped = () => run("");',
  '  wrapped.immediate = () => run("IMMEDIATE");',
  '  return wrapped;',
  '};',
  'const store = new SqliteLicenseActivationStore({ database: {',
  '  exec: sql => database.exec(sql),',
  '  prepare: sql => database.prepare(sql),',
  '  transaction',
  '} });',
  'const observedStore = {',
  '  read: key => store.read(key),',
  '  transact: (key, updater) => { process.stdout.write("ATTEMPTING\\n"); return store.transact(key, updater); }',
  '};',
  'const registry = new LicenseActivationRegistry({',
  '  store: observedStore,',
  '  clock: () => 1795272000000,',
  '  createActivationId: () => activationId,',
  '  verifyLicenseEnvelope: async envelope => envelope?.testOnly === true',
  '    ? { valid: true, status: "valid", entitlement: { licenseId: ' + JSON.stringify(licenseId) + ', maxInstallations: 1 } }',
  '    : { valid: false, status: "invalid" }',
  '});',
  'process.stdout.write("READY\\n");',
  'await new Promise(resolve => process.stdin.once("data", resolve));',
  'try {',
  '  const result = await registry.activate({',
  '    licenseEnvelope: { testOnly: true }, installationId, machineFingerprint',
  '  });',
  '  process.stdout.write("RESULT " + JSON.stringify(result) + "\\n");',
  '} catch (error) {',
  '  process.stderr.write(String(error?.message ?? error) + "\\n");',
  '  process.exitCode = 1;',
  '} finally {',
  '  database.close();',
  '}'
].join("\n");

function createDatabaseAdapter(database) {
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
  return {
    exec: sql => database.exec(sql),
    prepare: sql => database.prepare(sql),
    transaction
  };
}

function startWorker(filename, installationId, machineFingerprint, activationId) {
  const child = spawn(process.execPath, [
    "--input-type=module", "-e", childSource,
    filename, installationId, machineFingerprint, activationId
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const waiters = [];
  const reader = createInterface({ input: child.stdout });
  let outputClosed = false;
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  reader.on("line", line => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  reader.on("close", () => {
    outputClosed = true;
    while (waiters.length) waiters.shift()(null);
  });
  const nextLine = () => {
    if (lines.length) return Promise.resolve(lines.shift());
    if (outputClosed) return Promise.resolve(null);
    return new Promise(resolve => waiters.push(resolve));
  };
  const closed = new Promise(resolve => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    nextLine,
    closed,
    get stderr() { return stderr; }
  };
}

test("enforces a one-installation license seat across two concurrent Node.js processes using real SQLite", {
  skip: !DatabaseSync,
  timeout: 20_000
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-license-seats-"));
  const filename = join(directory, "activations.sqlite");
  const workers = [];
  let lockDatabase;
  try {
    const initialDatabase = new DatabaseSync(filename);
    initialDatabase.exec("PRAGMA journal_mode = WAL");
    initialDatabase.exec("PRAGMA synchronous = FULL");
    const initialStore = new SqliteLicenseActivationStore({
      database: createDatabaseAdapter(initialDatabase)
    });
    assert.equal(await initialStore.read(storeKey), null);
    initialDatabase.close();

    workers.push(
      startWorker(filename, "installation-alpha", "a".repeat(64), "activation-alpha"),
      startWorker(filename, "installation-beta", "b".repeat(64), "activation-beta")
    );
    for (const worker of workers) {
      assert.equal(await worker.nextLine(), "READY", worker.stderr || "worker did not initialize");
    }

    // Hold SQLite's real write reservation until both independent processes
    // have reached the registry's transaction boundary.
    lockDatabase = new DatabaseSync(filename);
    lockDatabase.exec("PRAGMA busy_timeout = 1000");
    lockDatabase.exec("BEGIN IMMEDIATE");
    for (const worker of workers) worker.child.stdin.write("GO");
    for (const worker of workers) {
      assert.equal(await worker.nextLine(), "ATTEMPTING", worker.stderr || "worker did not attempt activation");
    }
    lockDatabase.exec("ROLLBACK");
    lockDatabase.close();
    lockDatabase = null;

    const resultLines = await Promise.all(workers.map(worker => worker.nextLine()));
    const exits = await Promise.all(workers.map(worker => worker.closed));
    for (let index = 0; index < workers.length; index += 1) {
      assert.equal(exits[index].code, 0, workers[index].stderr || "activation worker failed");
      assert.ok(resultLines[index]?.startsWith("RESULT "), workers[index].stderr || "activation result missing");
    }

    const results = resultLines.map(line => JSON.parse(line.slice("RESULT ".length)));
    assert.equal(results.filter(result => result.activated === true).length, 1);
    assert.equal(results.filter(result => result.reason === "installation_limit_reached").length, 1);

    const verificationDatabase = new DatabaseSync(filename);
    try {
      const verificationStore = new SqliteLicenseActivationStore({
        database: createDatabaseAdapter(verificationDatabase)
      });
      const state = await verificationStore.read(storeKey);
      const active = Object.values(state.activations).filter(item => item.status === "active");
      assert.equal(active.length, 1);
      assert.ok(["installation-alpha", "installation-beta"].includes(active[0].installationId));
      assert.ok(["a".repeat(64), "b".repeat(64)].includes(active[0].machineFingerprint));
    } finally {
      verificationDatabase.close();
    }
  } finally {
    try { lockDatabase?.exec("ROLLBACK"); } catch {}
    try { lockDatabase?.close(); } catch {}
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill();
    }
    await Promise.all(workers.map(worker => worker.closed));
    rmSync(directory, { recursive: true, force: true });
  }
});
