import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteLicenseActivationStore } from "../src/sqlite-license-activation-store.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // Node 20 remains supported by the core; this integration suite runs on Node 22+.
}

function createImmediateTransactionAdapter(database) {
  const transaction = callback => {
    const run = mode => {
      database.exec(`BEGIN ${mode}`);
      try {
        const result = callback();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
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
    transaction,
    close: () => database.close()
  };
}

const key = "office-kit/license-activations/real-sqlite-license";
const initialState = () => ({
  schemaVersion: 1,
  licenseId: "real-sqlite-license",
  activations: {},
  updatedAt: "2026-11-07T10:00:00.000Z"
});

test("persists activation state in a real SQLite file across connections", {
  skip: !DatabaseSync
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-sqlite-"));
  const filename = join(directory, "activations.sqlite");
  let first;
  let second;
  try {
    first = createImmediateTransactionAdapter(new DatabaseSync(filename));
    const store = new SqliteLicenseActivationStore({ database: first });
    await store.transact(key, () => ({ state: initialState(), result: "created" }));
    await store.transact(key, current => {
      current.activations.installationA = { status: "active" };
      return { state: current, result: "mutated" };
    });
    const persisted = await store.read(key);
    assert.deepEqual(persisted.activations.installationA, { status: "active" });
    first.close();
    first = undefined;

    second = createImmediateTransactionAdapter(new DatabaseSync(filename));
    const reopenedStore = new SqliteLicenseActivationStore({ database: second });
    assert.deepEqual(await reopenedStore.read(key), persisted);
  } finally {
    second?.close();
    first?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rolls back a failed updater against the real SQLite transaction", {
  skip: !DatabaseSync
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-sqlite-"));
  const filename = join(directory, "activations.sqlite");
  let database;
  try {
    database = createImmediateTransactionAdapter(new DatabaseSync(filename));
    const store = new SqliteLicenseActivationStore({ database });
    await assert.rejects(
      () => store.transact(key, () => ({
        state: { schemaVersion: 2, licenseId: "real-sqlite-license" },
        result: "must-rollback"
      })),
      /license_activation_next_state_invalid/
    );
    assert.equal(await store.read(key), null);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
