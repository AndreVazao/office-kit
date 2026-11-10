import test from "node:test";
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
  occurredAt: "2026-11-10T12:00:00.000Z",
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
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { setTimeout as delay } from "node:timers/promises";',
  'import { SqliteOfficeIncidentStore } from ' + JSON.stringify(moduleUrl) + ';',
  'const [filename, installationId, incidentId, readyPath, startPath] = process.argv.slice(1);',
  'const database = new DatabaseSync(filename);',
  'database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");',
  'const transaction = callback => {',
  '  const run = mode => { database.exec("BEGIN " + mode); try { const result = callback(); database.exec("COMMIT"); return result; } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; } };',
  '  const wrapped = () => run(""); wrapped.immediate = () => run("IMMEDIATE"); return wrapped;',
  '};',
  'const store = new SqliteOfficeIncidentStore({ database: { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction }, installationId });',
  'writeFileSync(readyPath, "ready");',
  'while (!existsSync(startPath)) await delay(10);',
  'await store.update(incidentId, { childMarker: true });',
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

sqliteTest("serializes concurrent incident updates across independent SQLite processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-incident-concurrency-"));
  const filename = join(directory, "incidents.sqlite");
  const readyPath = join(directory, "child.ready");
  const startPath = join(directory, "child.start");
  const installationId = "install-office-01";
  const incidentId = "incident-concurrent-01";
  let database;
  let child;
  let lockHeld = false;
  let stderr = "";

  try {
    database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), installationId });
    await store.append(incident(incidentId));

    child = spawn(process.execPath, [
      "--input-type=module", "-e", childSource,
      filename, installationId, incidentId, readyPath, startPath
    ], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    const childExit = once(child, "exit");
    await waitForFile(readyPath, child);

    database.exec("BEGIN IMMEDIATE");
    lockHeld = true;
    const row = database.prepare(
      "SELECT incident_json, revision FROM office_kit_incidents WHERE installation_id = ? AND incident_id = ?"
    ).get(installationId, incidentId);
    const current = JSON.parse(row.incident_json);
    const parentRevision = Number(row.revision) + 1;
    const parentState = { ...current, parentMarker: true, revision: parentRevision };
    database.prepare(
      "UPDATE office_kit_incidents SET revision = ?, incident_json = ? WHERE installation_id = ? AND incident_id = ? AND revision = ?"
    ).run(parentRevision, JSON.stringify(parentState), installationId, incidentId, row.revision);

    writeFileSync(startPath, "go");
    await delay(200);
    database.exec("COMMIT");
    lockHeld = false;

    const [code, signal] = await childExit;
    assert.equal(code, 0, stderr || "child incident update failed");
    assert.equal(signal, null);

    const final = await store.get(incidentId);
    assert.equal(final.parentMarker, true);
    assert.equal(final.childMarker, true);
    assert.equal(final.revision, 3);
  } finally {
    if (lockHeld) {
      try { database?.exec("ROLLBACK"); } catch {}
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
