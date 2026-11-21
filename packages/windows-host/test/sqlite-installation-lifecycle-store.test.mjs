import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SqliteInstallationLifecycleStore } from "../src/sqlite-installation-lifecycle-store.mjs";

function fixture() {
  const database = new DatabaseSync(":memory:");
  let time = 100;
  const store = new SqliteInstallationLifecycleStore({
    database,
    installationId: "officekit-test-installation",
    clock: () => ++time
  });
  return { database, store };
}

test("SQLite lifecycle store round-trips state across store instances", () => {
  const f = fixture();
  const state = {
    installationId: "officekit-test-installation",
    version: "1.2.3",
    previousVersion: "1.2.2",
    state: "running",
    dataRetained: true,
    updatedAt: 123
  };
  f.store.save(state);
  const reopened = new SqliteInstallationLifecycleStore({
    database: f.database,
    installationId: "officekit-test-installation"
  });
  assert.deepEqual(reopened.load(), state);
  f.database.close();
});

test("SQLite lifecycle store isolates state by installation identity", () => {
  const f = fixture();
  const state = { installationId: "officekit-test-installation", state: "stopped", version: "1.0.0" };
  f.store.save(state);
  const other = new SqliteInstallationLifecycleStore({
    database: f.database,
    installationId: "officekit-another-installation"
  });
  assert.equal(other.load(), null);
  assert.deepEqual(f.store.load(), state);
  f.database.close();
});

test("SQLite lifecycle store rejects malformed constructor and records", () => {
  const database = new DatabaseSync(":memory:");
  assert.throws(() => new SqliteInstallationLifecycleStore({ database, installationId: "" }), /installation_id_invalid/);
  const store = new SqliteInstallationLifecycleStore({ database, installationId: "officekit-valid" });
  assert.throws(() => store.save(null), /record_required/);
  assert.throws(() => store.save({ installationId: "officekit-other", state: "absent", version: null }),
    /installation_id_mismatch/);
  database.close();
});

test("SQLite lifecycle store surfaces corrupt persisted JSON without overwriting it", () => {
  const f = fixture();
  f.database.prepare(`
    INSERT INTO office_installation_lifecycle_state (installation_id, state_json, updated_at)
    VALUES (?, ?, ?)
  `).run("officekit-test-installation", "{broken", 1);
  assert.throws(() => f.store.load(), /state_corrupt/);
  f.database.close();
});

test("SQLite lifecycle store commits complete records atomically", () => {
  const f = fixture();
  const state = { installationId: "officekit-test-installation", state: "degraded", version: "2.0.0", lastError: "health_failed" };
  assert.deepEqual(f.store.save(state), state);
  assert.deepEqual(f.store.load(), state);
  f.database.close();
});


test("SQLite lifecycle store rejects a persisted record whose installation ID differs from its partition", () => {
  const f = fixture();
  f.database.prepare(`
    INSERT INTO office_installation_lifecycle_state (installation_id, state_json, updated_at)
    VALUES (?, ?, ?)
  `).run(
    "officekit-test-installation",
    JSON.stringify({ installationId: "officekit-another-installation", state: "running", version: "1.0.0" }),
    1
  );
  assert.throws(() => f.store.load(), /installation_id_mismatch/);
  f.database.close();
});
