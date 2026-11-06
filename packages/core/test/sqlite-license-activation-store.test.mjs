import test from "node:test";
import assert from "node:assert/strict";
import { SqliteLicenseActivationStore } from "../src/sqlite-license-activation-store.mjs";

class FakeSqlite {
  rows = new Map();
  writes = 0;
  exec(sql) { assert.match(sql, /CREATE TABLE IF NOT EXISTS office_kit_license_activations/); }
  prepare(sql) {
    if (sql.trimStart().startsWith("SELECT")) return { get: id => this.rows.has(id) ? { state_json: this.rows.get(id) } : undefined };
    if (sql.trimStart().startsWith("INSERT")) return { run: (id, json) => { this.writes += 1; this.rows.set(id, json); } };
    throw new Error("unexpected_sql");
  }
  transaction(callback) {
    const wrapped = () => {
      const before = new Map(this.rows);
      try { return callback(); }
      catch (error) { this.rows = before; throw error; }
    };
    wrapped.immediate = wrapped;
    return wrapped;
  }
}

const key = "office-kit/license-activations/license-a";
const state = { schemaVersion: 1, licenseId: "license-a", activations: {}, updatedAt: "2026-11-05T00:00:00.000Z" };

test("persists and reads activation state through SQLite transaction boundary", async () => {
  const store = new SqliteLicenseActivationStore({ database: new FakeSqlite() });
  const result = await store.transact(key, current => ({ state, result: { created: current === null } }));
  assert.deepEqual(result, { created: true });
  assert.deepEqual(await store.read(key), state);
});

test("does not persist when updater returns the existing state", async () => {
  const database = new FakeSqlite();
  const store = new SqliteLicenseActivationStore({ database });
  await store.transact(key, () => ({ state, result: "saved" }));
  const before = database.rows.get("license-a");
  const writesBefore = database.writes;
  const result = await store.transact(key, current => ({ state: current, result: "unchanged" }));
  assert.equal(result, "unchanged");
  assert.equal(database.rows.get("license-a"), before);
  assert.equal(database.writes, writesBefore, "unchanged state must not issue an UPSERT");
});

test("persists updater mutations made in place", async () => {
  const database = new FakeSqlite();
  const store = new SqliteLicenseActivationStore({ database });
  await store.transact(key, () => ({ state, result: "created" }));
  const writesBefore = database.writes;
  await store.transact(key, current => {
    current.activations.installation = { status: "active" };
    return { state: current, result: "mutated" };
  });
  assert.equal(database.writes, writesBefore + 1);
  assert.deepEqual((await store.read(key)).activations.installation, { status: "active" });
});

test("rolls back invalid updater output and rejects malformed keys", async () => {
  const database = new FakeSqlite();
  const store = new SqliteLicenseActivationStore({ database });
  await assert.rejects(() => store.transact(key, () => ({ state: { schemaVersion: 2 }, result: null })), /next_state_invalid/);
  assert.equal(database.rows.size, 0);
  await assert.rejects(() => store.read("other/key"), /key_invalid/);
});

test("requires immediate transactions for cross-process seat serialization", () => {
  const database = new FakeSqlite();
  database.transaction = callback => callback;
  const store = new SqliteLicenseActivationStore({ database });
  return assert.rejects(() => store.transact(key, () => ({ state, result: true })), /immediate_transactions_required/);
});
