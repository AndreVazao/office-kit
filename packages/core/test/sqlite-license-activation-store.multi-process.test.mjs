import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SqliteLicenseActivationStore } from "../src/sqlite-license-activation-store.mjs";

const key = "office-kit/license-activations/cross-process-license";
const moduleUrl = pathToFileURL(new URL("../src/sqlite-license-activation-store.mjs", import.meta.url).pathname).href;
const childSource = "import { DatabaseSync } from \"node:sqlite\";\nimport { SqliteLicenseActivationStore } from \"MODULE_URL\";\nconst filename = process.argv[1];\nconst mode = process.argv[2];\nconst db = new DatabaseSync(filename);\ndb.exec(\"PRAGMA busy_timeout = 0\");\nconst transaction = callback => {\n  const run = sql => { db.exec(sql); try { const result = callback(); db.exec(\"COMMIT\"); return result; } catch (error) { db.exec(\"ROLLBACK\"); throw error; } };\n  const wrapped = () => run(\"BEGIN\"); wrapped.immediate = () => run(\"BEGIN IMMEDIATE\"); return wrapped;\n};\nconst store = new SqliteLicenseActivationStore({ database: { exec: sql => db.exec(sql), prepare: sql => db.prepare(sql), transaction } });\ntry {\n  await store.transact(\"office-kit/license-activations/cross-process-license\", current => ({ state: { ...current, updatedAt: \"2026-11-07T14:00:00.000Z\" }, result: \"child-committed\" }));\n  db.close(); process.exit(0);\n} catch (error) {\n  db.close();\n  if (mode === \"expect-lock\" && /busy|locked/i.test(String(error?.message))) process.exit(23);\n  console.error(error); process.exit(1);\n}".replace("MODULE_URL", moduleUrl);

function runChild(filename, mode) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", childSource, filename, mode], {
    encoding: "utf8",
    timeout: 10_000
  });
}

test("serializes SQLite activation writes across separate Node.js processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-sqlite-process-"));
  const filename = join(directory, "activations.sqlite");
  const db = new DatabaseSync(filename);
  try {
    const transaction = callback => {
      const run = sql => {
        db.exec(sql);
        try { const result = callback(); db.exec("COMMIT"); return result; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      };
      const wrapped = () => run("BEGIN");
      wrapped.immediate = () => run("BEGIN IMMEDIATE");
      return wrapped;
    };
    const store = new SqliteLicenseActivationStore({
      database: { exec: sql => db.exec(sql), prepare: sql => db.prepare(sql), transaction }
    });
    await store.transact(key, () => ({
      state: {
        schemaVersion: 1,
        licenseId: "cross-process-license",
        activations: {},
        updatedAt: "2026-11-07T13:00:00.000Z"
      },
      result: "created"
    }));

    db.exec("BEGIN IMMEDIATE");
    const blocked = runChild(filename, "expect-lock");
    assert.equal(blocked.error, undefined, blocked.error?.message);
    assert.equal(blocked.status, 23, blocked.stderr || "child process did not observe SQLITE_BUSY/LOCKED");
    db.exec("ROLLBACK");

    const committed = runChild(filename, "commit");
    assert.equal(committed.error, undefined, committed.error?.message);
    assert.equal(committed.status, 0, committed.stderr || "child process failed to commit");
    assert.equal((await store.read(key)).updatedAt, "2026-11-07T14:00:00.000Z");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
