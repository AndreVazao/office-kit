import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync, timeout: 30_000 }, fn);

import { createInProcessExclusiveLockProvider } from "../../scene-engine/src/exclusive-operation-lock.mjs";
import { SqliteOfficeIncidentStore } from "../../scene-engine/src/sqlite-office-incident-store.mjs";
import { SqliteMonotonicCheckpointJournal } from "../../scene-engine/src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../../scene-engine/src/sqlite-monotonic-checkpoint.mjs";
import { MonotonicIncidentWriter } from "../../scene-engine/src/monotonic-incident-writer.mjs";

const installationId = "officekit-monotonic-host-lock-01";
const incidentId = "incident-monotonic-host-lock-001";
const macKey = Buffer.alloc(32, 0x41);
const cryptoProvider = Object.freeze({
  sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
  randomUUID
});
const macProvider = Object.freeze({
  keyId: "test-monotonic-host-lock-mac-v1",
  hmacSha256Hex: value => createHmac("sha256", macKey).update(value, "utf8").digest("hex")
});

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
  return {
    exec: sql => database.exec(sql),
    prepare: sql => database.prepare(sql),
    transaction
  };
}

function openDatabase(filename) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  return { database, adapter: sqliteAdapter(database) };
}

function createStore(database, lock) {
  const store = new SqliteOfficeIncidentStore({
    database,
    installationId,
    cryptoProvider,
    requireMac: true,
    writeLockProvider: lock
  });
  store.configureMacProvider(macProvider);
  return store;
}

function createJournal(database, lock, store) {
  return new SqliteMonotonicCheckpointJournal({
    database,
    installationId,
    lockProvider: lock,
    makeId: randomUUID,
    applyPreparedPayload: (payload, checkpoint) => (
      store.applyPreparedMonotonicPayload(payload, checkpoint)
    )
  });
}

function incident() {
  return {
    schemaVersion: 1,
    id: incidentId,
    occurredAt: "2026-11-14T00:00:00.000Z",
    edition: "universal",
    status: "degraded",
    origin: "transport",
    confidence: "probable",
    diagnostics: [{ probeId: "host-contention-test", ok: false, evidence: "second-host-blocked" }],
    recoveryAttempts: [],
    outcome: "unresolved"
  };
}

function childProgram(lockUrl, lockProviderUrl, storeUrl, journalUrl, coordinatorUrl, writerUrl) {
  return [
    'import { DatabaseSync } from "node:sqlite";',
    'import { createHash, createHmac, randomUUID } from "node:crypto";',
    'import { writeFileSync } from "node:fs";',
    "import { acquireWindowsHostProcessLock } from " + JSON.stringify(lockUrl) + ";",
    "import { createInProcessExclusiveLockProvider } from " + JSON.stringify(lockProviderUrl) + ";",
    "import { SqliteOfficeIncidentStore } from " + JSON.stringify(storeUrl) + ";",
    "import { SqliteMonotonicCheckpointJournal } from " + JSON.stringify(journalUrl) + ";",
    "import { SqliteMonotonicCheckpointCoordinator } from " + JSON.stringify(coordinatorUrl) + ";",
    "import { MonotonicIncidentWriter } from " + JSON.stringify(writerUrl) + ";",
    "const [databasePath, hostLockPath, markerPath] = process.argv.slice(1, 4);",
    'const installationId = "officekit-monotonic-host-lock-01";',
    'const incidentId = "incident-monotonic-host-lock-001";',
    "const releaseHostLock = acquireWindowsHostProcessLock(hostLockPath);",
    "const database = new DatabaseSync(databasePath);",
    'database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");',
    "const transaction = callback => {",
    '  const run = mode => { database.exec("BEGIN " + mode); try { const result = callback(); database.exec("COMMIT"); return result; } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; } };',
    '  const wrapped = () => run(""); wrapped.immediate = () => run("IMMEDIATE"); return wrapped;',
    "};",
    "const db = { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };",
    "const lock = createInProcessExclusiveLockProvider();",
    "const macKey = Buffer.alloc(32, 0x41);",
    "const cryptoProvider = { sha256Hex: value => createHash(\"sha256\").update(value, \"utf8\").digest(\"hex\"), randomUUID };",
    'const macProvider = { keyId: "test-monotonic-host-lock-mac-v1", hmacSha256Hex: value => createHmac("sha256", macKey).update(value, "utf8").digest("hex") };',
    "const store = new SqliteOfficeIncidentStore({ database: db, installationId, cryptoProvider, requireMac: true, writeLockProvider: lock });",
    "store.configureMacProvider(macProvider);",
    "const journal = new SqliteMonotonicCheckpointJournal({ database: db, installationId, lockProvider: lock, makeId: randomUUID, applyPreparedPayload: (payload, checkpoint) => store.applyPreparedMonotonicPayload(payload, checkpoint) });",
    "let checkpoint = { installationId, generation: 0, sequence: 0, eventHash: null, eventMac: null, protocolVersion: 1 };",
    "const anchor = {",
    '  async capabilities() { return { hardwareBacked: true, rollbackResistant: true, atomicCompareAndAdvance: true, durableAcrossRestart: true, scope: "test-only-in-memory-anchor" }; },',
    '  async read() { return { status: "protected", installationId, anchorId: "test-only-host-contention-anchor", checkpoint: structuredClone(checkpoint) }; },',
    "  async advance(expected, next) {",
    "    if (JSON.stringify(checkpoint) !== JSON.stringify(expected)) throw new Error(\"test_anchor_compare_failed\");",
    "    checkpoint = structuredClone(next);",
    '    return { status: "protected", installationId };',
    "  }",
    "};",
    "const coordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor, journal, installationId });",
    "const writer = new MonotonicIncidentWriter({ incidentStore: store, coordinator });",
    'await writer.append({ schemaVersion: 1, id: incidentId, occurredAt: "2026-11-14T00:00:00.000Z", edition: "universal", status: "degraded", origin: "transport", confidence: "probable", diagnostics: [{ probeId: "host-contention-test", ok: false, evidence: "second-host-blocked" }], recoveryAttempts: [], outcome: "unresolved" });',
    'writeFileSync(markerPath, "writer-completed\\n");',
    'process.stdout.write("WRITE_COMPLETED\\n");',
    "process.stdin.once(\"data\", async () => {",
    "  try { await lock.close(); database.close(); releaseHostLock(); process.stdout.write(\"RELEASED\\n\"); }",
    '  catch (error) { process.stderr.write(String(error?.stack ?? error)); process.exitCode = 1; }',
    "});",
    "process.stdin.resume();"
  ].join("\n");
}

function waitForMarker(child, marker, readStderr, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("child_marker_timeout:" + marker + ":" + readStderr())), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes(marker)) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (!stdout.includes(marker)) {
        clearTimeout(timer);
        reject(new Error("child_exited_before_marker:" + marker + ":" + code + ":" + signal + ":" + readStderr()));
      }
    });
  });
}

sqliteTest("blocks a second process from entering the monotonic writer boundary while the first host owns the singleton lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-monotonic-host-contention-"));
  const databasePath = join(directory, "incidents.sqlite");
  const hostLockPath = join(directory, "host.lock");
  const writerMarkerPath = join(directory, "writer.completed");
  const moduleUrls = {
    lock: new URL("../../windows-host/src/process-lock.mjs", import.meta.url).href,
    lockProvider: new URL("../src/exclusive-operation-lock.mjs", import.meta.url).href,
    store: new URL("../src/sqlite-office-incident-store.mjs", import.meta.url).href,
    journal: new URL("../src/sqlite-monotonic-checkpoint-journal.mjs", import.meta.url).href,
    coordinator: new URL("../src/sqlite-monotonic-checkpoint.mjs", import.meta.url).href,
    writer: new URL("../src/monotonic-incident-writer.mjs", import.meta.url).href
  };
  const source = childProgram(
    moduleUrls.lock, moduleUrls.lockProvider, moduleUrls.store,
    moduleUrls.journal, moduleUrls.coordinator, moduleUrls.writer
  );
  let first;
  let second;
  let firstStderr = "";
  let secondStderr = "";
  let verificationLock;
  let verificationDatabase;
  try {
    first = spawn(process.execPath, [
      "--input-type=module", "-e", source,
      databasePath, hostLockPath, writerMarkerPath
    ], { stdio: ["pipe", "pipe", "pipe"] });
    first.stderr.setEncoding("utf8");
    first.stderr.on("data", chunk => { firstStderr += chunk; });
    const firstExit = once(first, "exit");
    await waitForMarker(first, "WRITE_COMPLETED", () => firstStderr);

    const secondSource = [
      "import { acquireWindowsHostProcessLock } from " + JSON.stringify(moduleUrls.lock) + ";",
      "try {",
      "  const release = acquireWindowsHostProcessLock(process.argv[1]);",
      "  release();",
      '  process.stdout.write("UNEXPECTEDLY_ACQUIRED\\n");',
      "  process.exitCode = 3;",
      "} catch (error) {",
      '  if (error?.message !== "windows_host_already_running") throw error;',
      '  process.stdout.write("BLOCKED_BY_ACTIVE_HOST\\n");',
      "}"
    ].join("\n");
    second = spawn(process.execPath, [
      "--input-type=module", "-e", secondSource, hostLockPath
    ], { stdio: ["ignore", "pipe", "pipe"] });
    second.stderr.setEncoding("utf8");
    second.stderr.on("data", chunk => { secondStderr += chunk; });
    const secondExit = once(second, "exit");
    const secondOutput = await waitForMarker(second, "BLOCKED_BY_ACTIVE_HOST", () => secondStderr);
    const [secondCode, secondSignal] = await secondExit;
    assert.equal(secondCode, 0, secondStderr || secondOutput);
    assert.equal(secondSignal, null);
    assert.equal(secondOutput.includes("UNEXPECTEDLY_ACQUIRED"), false);

    first.stdin.end("release\\n");
    const [firstCode, firstSignal] = await firstExit;
    assert.equal(firstCode, 0, firstStderr);
    assert.equal(firstSignal, null);

    const opened = new DatabaseSync(databasePath);
    verificationDatabase = opened;
    opened.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    const transaction = callback => {
      const run = mode => {
        opened.exec("BEGIN " + mode);
        try { const result = callback(); opened.exec("COMMIT"); return result; }
        catch (error) { try { opened.exec("ROLLBACK"); } catch {} throw error; }
      };
      const wrapped = () => run("");
      wrapped.immediate = () => run("IMMEDIATE");
      return wrapped;
    };
    const db = { exec: sql => opened.exec(sql), prepare: sql => opened.prepare(sql), transaction };
    verificationLock = createInProcessExclusiveLockProvider();
    const store = createStore(db, verificationLock);
    const journal = createJournal(db, verificationLock, store);

    assert.equal((await store.get(incidentId)).status, "degraded");
    assert.equal(store.verifyIntegrity().eventCount, 1);
    assert.equal((await journal.readCheckpoint()).sequence, 1);
    assert.equal(await journal.readPreparedCheckpoint(), null);
    assert.equal((await journal.readCheckpoint()).eventHash, store.verifyIntegrity().headHash);
    assert.equal((await journal.readCheckpoint()).eventMac, store.verifyIntegrity().headMac);
  } finally {
    if (second && second.exitCode === null && second.signalCode === null) {
      second.kill();
      try { await once(second, "exit"); } catch {}
    }
    if (first && first.exitCode === null && first.signalCode === null) {
      first.kill();
      try { await once(first, "exit"); } catch {}
    }
    await verificationLock?.close();
    verificationDatabase?.close();
    rmSync(directory, { recursive: true, force: true });
    macKey.fill(0);
  }
});
