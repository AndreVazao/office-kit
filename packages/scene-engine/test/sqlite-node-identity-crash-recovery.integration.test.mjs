import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  // Node 20 remains supported; real SQLite crash-recovery integration runs on Node 22+.
}

import { SqliteNodeIdentityMetadataStore } from "../src/sqlite-node-identity-metadata-store.mjs";

const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync, timeout: 20_000 }, fn);
const moduleUrl = new URL("../src/sqlite-node-identity-metadata-store.mjs", import.meta.url).href;
const childSource = `
import { DatabaseSync } from "node:sqlite";
import { SqliteNodeIdentityMetadataStore } from ${JSON.stringify(moduleUrl)};

const filename = process.argv[1];
const database = new DatabaseSync(filename);
const transaction = callback => {
  const wrapped = () => {
    database.exec("BEGIN");
    try {
      const result = callback();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  wrapped.immediate = async () => {
    database.exec("BEGIN IMMEDIATE");
    const result = callback();
    // The UPDATE has executed, but COMMIT has deliberately not happened.
    process.stdout.write("READY\\n");
    await new Promise(() => {});
    return result;
  };
  return wrapped;
};

const store = new SqliteNodeIdentityMetadataStore({
  database: {
    exec: sql => database.exec(sql),
    prepare: sql => database.prepare(sql),
    transaction
  },
  installationId: "crash-recovery-01"
});

await store.compareAndSet(1, {
  installationId: "crash-recovery-01",
  revision: 2,
  marker: "uncommitted"
});
process.exitCode = 2;
`;

function adapter(database) {
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

sqliteTest("SQLite WAL recovers the last committed identity metadata after process termination before COMMIT", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-sqlite-crash-"));
  const filename = join(directory, "identity.sqlite");
  let database;
  let child;
  let stderr = "";

  try {
    database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode = WAL");
    const store = new SqliteNodeIdentityMetadataStore({
      database: adapter(database),
      installationId: "crash-recovery-01"
    });
    assert.equal(await store.compareAndSet(null, {
      installationId: "crash-recovery-01",
      revision: 1,
      marker: "committed"
    }), true);
    database.close();
    database = null;

    child = spawn(process.execPath, ["--input-type=module", "-e", childSource, filename], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });

    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        error ? reject(error) : resolve();
      };
      const onExit = (code, signal) => finish(new Error(
        `SQLite child exited before opening the crash window (code=${code}, signal=${signal}): ${stderr}`
      ));
      const onError = error => finish(error);
      const timer = setTimeout(() => finish(new Error("SQLite child did not reach the uncommitted transaction window.")), 10_000);

      child.once("exit", onExit);
      child.once("error", onError);
      child.stdout.on("data", chunk => {
        if (chunk.includes("READY")) finish();
      });
    });

    const exited = once(child, "exit");
    assert.equal(child.kill(), true, "child must still be blocked before COMMIT");
    await exited;
    assert.ok(child.signalCode || child.exitCode !== null, "child process termination must be observed");

    database = new DatabaseSync(filename);
    const recoveredStore = new SqliteNodeIdentityMetadataStore({
      database: adapter(database),
      installationId: "crash-recovery-01"
    });
    const recovered = await recoveredStore.get();

    assert.equal(recovered.revision, 1);
    assert.equal(recovered.marker, "committed");
    assert.equal(Object.values(database.prepare("PRAGMA integrity_check").get())[0], "ok");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
