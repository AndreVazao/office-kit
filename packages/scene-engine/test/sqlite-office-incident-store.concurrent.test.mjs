import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

import { SqliteOfficeIncidentStore } from "../src/sqlite-office-incident-store.mjs";

const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync, timeout: 20_000 }, fn);

const cryptoProvider = Object.freeze({
  sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
  randomUUID
});

function adapter(database) {
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

const incident = id => ({
  schemaVersion: 1,
  id,
  occurredAt: "2026-11-11T12:00:00.000Z",
  edition: "universal",
  status: "degraded",
  origin: "transport",
  confidence: "probable",
  diagnostics: [{ probeId: "transport", ok: false, evidence: "timeout" }],
  recoveryAttempts: [],
  outcome: "unresolved"
});

const moduleUrl = new URL("../src/sqlite-office-incident-store.mjs", import.meta.url).href;
const childSource = [
  'import { DatabaseSync } from "node:sqlite";',
  'import { createHash, randomUUID } from "node:crypto";',
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { setTimeout as delay } from "node:timers/promises";',
  'import { SqliteOfficeIncidentStore } from ' + JSON.stringify(moduleUrl) + ';',
  'const [filename, installationId, incidentId, readyPath, startPath, marker] = process.argv.slice(1);',
  'const cryptoProvider = { sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"), randomUUID };',
  'const database = new DatabaseSync(filename);',
  'database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");',
  'const transaction = callback => {',
  '  const run = mode => { database.exec("BEGIN " + mode); try { const result = callback(); database.exec("COMMIT"); return result; } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; } };',
  '  const wrapped = () => run(""); wrapped.immediate = () => run("IMMEDIATE"); return wrapped;',
  '};',
  'const store = new SqliteOfficeIncidentStore({ database: { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction }, installationId, cryptoProvider });',
  'writeFileSync(readyPath, "ready");',
  'while (!existsSync(startPath)) await delay(10);',
  'await store.update(incidentId, { [marker]: true });',
  'database.close();'
].join("\n");

async function waitForFile(path, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("incident update child exited before ready: " + child.exitCode + "/" + child.signalCode);
    }
    await delay(10);
  }
  throw new Error("incident update child did not become ready");
}

sqliteTest("serializes concurrent journal updates across independent SQLite processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-incident-concurrency-"));
  const filename = join(directory, "incidents.sqlite");
  const startPath = join(directory, "children.start");
  const installationId = "install-office-01";
  const incidentId = "incident-concurrent-01";
  const readyA = join(directory, "child-a.ready");
  const readyB = join(directory, "child-b.ready");
  let database;
  let childA;
  let childB;
  let lockHeld = false;
  let stderrA = "";
  let stderrB = "";

  try {
    database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), installationId, cryptoProvider });
    await store.append(incident(incidentId));

    const args = (readyPath, marker) => [
      "--input-type=module", "-e", childSource,
      filename, installationId, incidentId, readyPath, startPath, marker
    ];
    childA = spawn(process.execPath, args(readyA, "childMarkerA"), { stdio: ["ignore", "ignore", "pipe"] });
    childB = spawn(process.execPath, args(readyB, "childMarkerB"), { stdio: ["ignore", "ignore", "pipe"] });
    childA.stderr.setEncoding("utf8");
    childB.stderr.setEncoding("utf8");
    childA.stderr.on("data", chunk => { stderrA += chunk; });
    childB.stderr.on("data", chunk => { stderrB += chunk; });
    const exitA = once(childA, "exit");
    const exitB = once(childB, "exit");
    await waitForFile(readyA, childA);
    await waitForFile(readyB, childB);

    database.exec("BEGIN IMMEDIATE");
    lockHeld = true;
    writeFileSync(startPath, "go");
    await delay(250);
    database.exec("COMMIT");
    lockHeld = false;

    const [[codeA, signalA], [codeB, signalB]] = await Promise.all([exitA, exitB]);
    assert.equal(codeA, 0, stderrA || "child A incident update failed");
    assert.equal(codeB, 0, stderrB || "child B incident update failed");
    assert.equal(signalA, null);
    assert.equal(signalB, null);

    const final = await store.get(incidentId);
    assert.equal(final.childMarkerA, true);
    assert.equal(final.childMarkerB, true);
    assert.equal(final.revision, 3);
    assert.equal(store.verifyIntegrity().eventCount, 3);
  } finally {
    if (lockHeld) {
      try { database?.exec("ROLLBACK"); } catch {}
    }
    for (const child of [childA, childB]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
