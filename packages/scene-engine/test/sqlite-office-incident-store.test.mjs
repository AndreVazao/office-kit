import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync }, fn);
import { SqliteOfficeIncidentStore } from "../src/sqlite-office-incident-store.mjs";

function adapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
      try { const result = callback(); database.exec("COMMIT"); return result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    };
    const wrapped = () => run("");
    wrapped.immediate = () => run("IMMEDIATE");
    return wrapped;
  };
  return { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction };
}

const incident = (id, overrides = {}) => ({
  schemaVersion: 1, id, occurredAt: "2026-11-09T12:00:00.000Z",
  edition: "universal", status: "degraded", origin: "transport",
  confidence: "probable", diagnostics: [{ probeId: "http", ok: false, evidence: "timeout" }],
  recoveryAttempts: [], outcome: "unresolved", ...overrides
});

sqliteTest("persists incidents and recovery updates across database reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-incidents-"));
  const filename = join(directory, "incidents.sqlite");
  let db;
  try {
    db = new DatabaseSync(filename);
    const store = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-office-01" });
    await store.append(incident("incident-001"));
    await store.update("incident-001", { outcome: "recovered", recoveryAttempts: [{ actionId: "reconnect", ok: true }] });
    assert.equal((await store.get("incident-001")).outcome, "recovered");
    db.close();
    db = new DatabaseSync(filename);
    const reopened = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-office-01" });
    assert.equal((await reopened.list())[0].recoveryAttempts[0].actionId, "reconnect");
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

sqliteTest("isolates incident history by installation and rejects cross-installation writes", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const one = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-one" });
    const two = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-two" });
    await one.append(incident("incident-002"));
    assert.equal(await two.get("incident-002"), null);
    await assert.rejects(one.append(incident("incident-003", { installationId: "install-two" })), /incident_installation_scope_mismatch/);
  } finally { db.close(); }
});

sqliteTest("redacts secret-shaped fields and token values before persistence/export", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-office-01" });
    await store.append(incident("incident-004", {
      diagnostics: [{ evidence: "Bearer abc.def.ghi api_key=shhh" }],
      context: { accessToken: "sensitive-value", note: "password=hunter2" }
    }));
    const saved = await store.get("incident-004");
    assert.equal(saved.context.accessToken, "[REDACTED]");
    assert.doesNotMatch(JSON.stringify(saved), /abc\.def\.ghi|shhh|sensitive-value|hunter2/);
    assert.doesNotMatch(await store.export(), /sensitive-value/);
  } finally { db.close(); }
});

sqliteTest("rejects duplicate IDs, corrupt rows and invalid list limits", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new SqliteOfficeIncidentStore({ database: adapter(db), installationId: "install-office-01" });
    await store.append(incident("incident-005"));
    await assert.rejects(store.append(incident("incident-005")), /duplicate_incident_id/);
    await assert.rejects(store.list({ limit: 0 }), /incident_list_limit_out_of_range/);
    db.prepare("UPDATE office_kit_incidents SET incident_json = ? WHERE incident_id = ?").run("{bad", "incident-005");
    await assert.rejects(store.get("incident-005"), /incident_corrupt_state/);
  } finally { db.close(); }
});
