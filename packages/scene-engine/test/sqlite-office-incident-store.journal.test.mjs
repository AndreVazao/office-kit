import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}

const incident = (id, overrides = {}) => ({
  schemaVersion: 1,
  id,
  occurredAt: "2026-11-11T12:00:00.000Z",
  edition: "universal",
  status: "degraded",
  origin: "transport",
  confidence: "probable",
  diagnostics: [{ probeId: "transport", ok: false, evidence: "timeout" }],
  recoveryAttempts: [],
  outcome: "unresolved",
  ...overrides
});

sqliteTest("records immutable incident events and reports the unkeyed integrity boundary", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    await store.append(incident("incident-journal-01", {
      context: { apiKey: "do-not-store", note: "Bearer abc.def.ghi" }
    }));
    await store.update("incident-journal-01", { outcome: "recovered" });

    const integrity = store.verifyIntegrity();
    const events = store.listEvents();
    assert.equal(integrity.status, "unkeyed_hash_chain");
    assert.equal(integrity.verification, "sha256_chain_only");
    assert.equal(integrity.eventCount, 2);
    assert.equal(integrity.externalAnchor, false);
    assert.equal(integrity.tamperEvidence, false);
    assert.equal(integrity.tamperResistance, false);
    assert.equal(events[0].eventType, "incident.created");
    assert.equal(events[1].eventType, "incident.updated");
    assert.equal(events[0].revision, 1);
    assert.equal(events[1].revision, 2);
    assert.equal(events[1].previousHash, database.prepare(
      "SELECT event_hash FROM office_kit_incident_events WHERE installation_id = ? AND sequence = 1"
    ).get("install-office-01").event_hash);
    assert.doesNotMatch(JSON.stringify(events), /do-not-store|abc\.def\.ghi/);

    assert.throws(() => database.prepare(
      "UPDATE office_kit_incident_events SET event_type = ? WHERE installation_id = ? AND sequence = 1"
    ).run("incident.updated", "install-office-01"), /incident_event_immutable/);
    assert.throws(() => database.prepare(
      "DELETE FROM office_kit_incident_events WHERE installation_id = ? AND sequence = 1"
    ).run("install-office-01"), /incident_event_immutable/);

    await assert.rejects(store.export(), /incident_export_consent_required/);
    const exported = JSON.parse(await store.export({ ownerConsent: true }));
    assert.equal(exported.ownerConsent, true);
    assert.equal(exported.events.length, 2);
    assert.equal(exported.integrity.eventCount, 2);
    assert.doesNotMatch(JSON.stringify(exported), /do-not-store|abc\.def\.ghi/);
  } finally {
    database.close();
  }
});

sqliteTest("fails closed when a validly encoded current snapshot diverges from its event history", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    await store.append(incident("incident-journal-02"));
    const row = database.prepare(
      "SELECT incident_json FROM office_kit_incidents WHERE installation_id = ? AND incident_id = ?"
    ).get("install-office-01", "incident-journal-02");
    const changed = JSON.parse(row.incident_json);
    changed.status = "healthy";
    database.prepare(
      "UPDATE office_kit_incidents SET status = ?, incident_json = ? WHERE installation_id = ? AND incident_id = ?"
    ).run("healthy", JSON.stringify(changed), "install-office-01", "incident-journal-02");

    await assert.rejects(store.get("incident-journal-02"), /incident_event_snapshot_mismatch/);
    await assert.rejects(store.list(), /incident_event_snapshot_mismatch/);
    await assert.rejects(store.export({ ownerConsent: true }), /incident_event_snapshot_mismatch/);
  } finally {
    database.close();
  }
});

sqliteTest("detects event-row tampering after database-level triggers are deliberately removed", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    await store.append(incident("incident-journal-03"));
    database.exec("DROP TRIGGER office_kit_incident_events_immutable_update");
    const row = database.prepare(
      "SELECT event_json FROM office_kit_incident_events WHERE installation_id = ? AND sequence = 1"
    ).get("install-office-01");
    const tampered = row.event_json.replace('"status":"degraded"', '"status":"healthy"');
    database.prepare(
      "UPDATE office_kit_incident_events SET event_json = ? WHERE installation_id = ? AND sequence = 1"
    ).run(tampered, "install-office-01");
    assert.throws(() => store.verifyIntegrity(), /incident_event_chain_corrupt/);
    assert.throws(() => store.listEvents(), /incident_event_chain_corrupt/);
  } finally {
    database.close();
  }
});

sqliteTest("migrates legacy snapshots into the event journal exactly once", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec([
      "CREATE TABLE office_kit_incidents (",
      "  installation_id TEXT NOT NULL,",
      "  incident_id TEXT NOT NULL,",
      "  occurred_at TEXT NOT NULL,",
      "  status TEXT NOT NULL,",
      "  origin TEXT NOT NULL,",
      "  incident_json TEXT NOT NULL,",
      "  PRIMARY KEY (installation_id, incident_id)",
      ");"
    ].join("\n"));
    const legacy = incident("incident-journal-legacy");
    database.prepare([
      "INSERT INTO office_kit_incidents",
      "(installation_id, incident_id, occurred_at, status, origin, incident_json)",
      "VALUES (?, ?, ?, ?, ?, ?)"
    ].join(" ")).run(
      "install-office-01", legacy.id, legacy.occurredAt, legacy.status, legacy.origin, JSON.stringify(legacy)
    );

    const first = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    assert.equal(first.verifyIntegrity().eventCount, 1);
    assert.equal(first.listEvents()[0].eventType, "incident.imported_snapshot");
    const second = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    assert.equal(second.verifyIntegrity().eventCount, 1);
    assert.equal((await second.get(legacy.id)).revision, 1);
  } finally {
    database.close();
  }
});

sqliteTest("rolls back a snapshot when its matching event cannot be appended", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
    database.exec("CREATE TRIGGER reject_incident_event BEFORE INSERT ON office_kit_incident_events BEGIN SELECT RAISE(ABORT, 'test_event_insert_abort'); END;");
    await assert.rejects(store.append(incident("incident-journal-atomic")), /test_event_insert_abort/);
    database.exec("DROP TRIGGER reject_incident_event");
    assert.equal(await store.get("incident-journal-atomic"), null);
    assert.equal(store.verifyIntegrity().eventCount, 0);
  } finally {
    database.close();
  }
});

const moduleUrl = new URL("../src/sqlite-office-incident-store.mjs", import.meta.url).href;
const crashChildSource = [
  'import { DatabaseSync } from "node:sqlite";',
  'import { createHash, randomUUID } from "node:crypto";',
  'import { SqliteOfficeIncidentStore } from ' + JSON.stringify(moduleUrl) + ';',
  'const [filename, installationId, mode] = process.argv.slice(1);',
  'const cryptoProvider = { sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"), randomUUID };',
  'const database = new DatabaseSync(filename);',
  'database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");',
  'const transaction = callback => {',
  '  const run = kind => { database.exec("BEGIN " + kind); try { const value = callback(); database.exec("COMMIT"); return value; } catch (error) { try { database.exec("ROLLBACK"); } catch {} throw error; } };',
  '  const wrapped = () => run(""); wrapped.immediate = () => run("IMMEDIATE"); return wrapped;',
  '};',
  'const store = new SqliteOfficeIncidentStore({ database: { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction }, installationId, cryptoProvider });',
  'const value = { schemaVersion: 1, id: "incident-child-commit", occurredAt: "2026-11-11T12:00:00.000Z", edition: "universal", status: "degraded", origin: "transport", confidence: "probable", diagnostics: [], recoveryAttempts: [], outcome: "unresolved" };',
  'if (mode === "commit") { await store.append(value); database.close(); process.exit(0); }',
  'database.exec("BEGIN IMMEDIATE");',
  'database.prepare("INSERT INTO office_kit_incidents (installation_id, incident_id, occurred_at, status, origin, revision, incident_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(installationId, "incident-uncommitted", value.occurredAt, value.status, value.origin, 1, JSON.stringify({ ...value, installationId, revision: 1 }));',
  'process.exit(17);'
].join("\n");

sqliteTest("reopens committed journal events after process exit and rolls back an interrupted SQLite transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-incident-crash-"));
  const committedFile = join(directory, "committed.sqlite");
  const interruptedFile = join(directory, "interrupted.sqlite");

  async function runChild(filename, mode, expectedCode) {
    const child = spawn(process.execPath, [
      "--input-type=module", "-e", crashChildSource, filename, "install-office-01", mode
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null);
    assert.equal(code, expectedCode, stderr || "incident crash fixture returned unexpected status");
  }

  try {
    await runChild(committedFile, "commit", 0);
    let database = new DatabaseSync(committedFile);
    try {
      const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
      assert.equal((await store.get("incident-child-commit")).revision, 1);
      assert.equal(store.verifyIntegrity().eventCount, 1);
    } finally { database.close(); }

    await runChild(interruptedFile, "rollback", 17);
    database = new DatabaseSync(interruptedFile);
    try {
      const store = new SqliteOfficeIncidentStore({ database: adapter(database), cryptoProvider, installationId: "install-office-01" });
      assert.equal(await store.get("incident-uncommitted"), null);
      assert.equal(store.verifyIntegrity().eventCount, 0);
    } finally { database.close(); }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
