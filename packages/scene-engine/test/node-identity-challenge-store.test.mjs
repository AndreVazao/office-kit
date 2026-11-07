import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryNodeIdentityChallengeStore, SqliteNodeIdentityChallengeStore } from "../src/node-identity-challenge-store.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  if (error?.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

function sqliteAdapter(database) {
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
    transaction
  };
}

test("in-memory challenge store consumes a nonce once and expires old entries", async () => {
  const store = new InMemoryNodeIdentityChallengeStore();
  const record = { nonce: "A".repeat(43), expiresAt: 20_000, now: 10_000 };
  assert.equal(await store.consume(record), true);
  assert.equal(await store.consume(record), false);
  assert.equal(await store.consume({ ...record, nonce: "B".repeat(43), now: 20_000 }), false);
  assert.equal(await store.consume({ ...record, nonce: "B".repeat(43), now: 20_001 }), false);
  assert.equal(store.persistent, false);
});

test("SQLite challenge replay protection survives separate connections and database reopen", {
  skip: !DatabaseSync && "node:sqlite requires Node.js 22.5 or newer"
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-challenge-replay-"));
  const filename = join(directory, "replay.sqlite");
  let firstDb;
  let secondDb;
  try {
    firstDb = new DatabaseSync(filename);
    secondDb = new DatabaseSync(filename);
    const first = new SqliteNodeIdentityChallengeStore({ database: sqliteAdapter(firstDb) });
    const second = new SqliteNodeIdentityChallengeStore({ database: sqliteAdapter(secondDb) });
    const record = { nonce: "C".repeat(43), expiresAt: 30_000, now: 10_000 };
    assert.equal(await first.consume(record), true);
    assert.equal(await second.consume(record), false);
    firstDb.close();
    firstDb = null;
    secondDb.close();
    secondDb = null;

    firstDb = new DatabaseSync(filename);
    const reopened = new SqliteNodeIdentityChallengeStore({ database: sqliteAdapter(firstDb) });
    assert.equal(await reopened.consume(record), false);
    assert.equal(await reopened.consume({ ...record, nonce: "D".repeat(43), now: 30_000 }), false);
    assert.equal(reopened.persistent, true);
  } finally {
    firstDb?.close();
    secondDb?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
