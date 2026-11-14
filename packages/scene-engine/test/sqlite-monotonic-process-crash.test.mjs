import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
const sqliteTest = (name, fn) => test(name, { skip: !DatabaseSync, timeout: 30_000 }, fn);

import { createInProcessExclusiveLockProvider } from "../src/exclusive-operation-lock.mjs";
import { SqliteOfficeIncidentStore } from "../src/sqlite-office-incident-store.mjs";
import { SqliteMonotonicCheckpointJournal } from "../src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../src/sqlite-monotonic-checkpoint.mjs";
import { MonotonicIncidentWriter } from "../src/monotonic-incident-writer.mjs";

const installationId = "officekit-process-crash-01";
const macKey = Buffer.alloc(32, 0x41);
const cryptoProvider = Object.freeze({
  sha256Hex: value => createHash("sha256").update(value, "utf8").digest("hex"),
  randomUUID
});
const macProvider = Object.freeze({
  keyId: "test-process-crash-mac-v1",
  hmacSha256Hex: value => createHmac("sha256", macKey).update(value, "utf8").digest("hex")
});

function sqliteAdapter(database) {
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

function openDatabase(filename) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  return { database, adapter: sqliteAdapter(database) };
}

function createStore(database, lock) {
  const store = new SqliteOfficeIncidentStore({
    database,
    installationId,
    cryptoProvider,
    requireMac: true,
    writeLockProvider: lock
  });
  store.configureMacProvider(macProvider);
  return store;
}

function createJournal(database, lock, store) {
  return new SqliteMonotonicCheckpointJournal({
    database,
    installationId,
    lockProvider: lock,
    makeId: randomUUID,
    applyPreparedPayload: (payload, checkpoint) => (
      store.applyPreparedMonotonicPayload(payload, checkpoint)
    )
  });
}

function incident(id) {
  return {
    schemaVersion: 1,
    id,
    occurredAt: "2026-11-14T00:00:00.000Z",
    edition: "universal",
    status: "degraded",
    origin: "transport",
    confidence: "probable",
    diagnostics: [{ probeId: "process-crash-test", ok: false, evidence: "forced-process-termination" }],
    recoveryAttempts: [],
    outcome: "unresolved"
  };
}

function point(generation, sequence, eventHash = null, eventMac = null) {
  return {
    installationId,
    generation,
    sequence,
    eventHash,
    eventMac,
    protocolVersion: 1
  };
}

function samePoint(left, right) {
  return left?.installationId === right?.installationId
    && left?.generation === right?.generation
    && left?.sequence === right?.sequence
    && left?.eventHash === right?.eventHash
    && left?.eventMac === right?.eventMac
    && left?.protocolVersion === right?.protocolVersion;
}

function fileAnchorProvider(anchorPath) {
  return Object.freeze({
    async capabilities() {
      return {
        hardwareBacked: true,
        rollbackResistant: true,
        atomicCompareAndAdvance: true,
        durableAcrossRestart: true,
        scope: "test-only-file-backed-fake"
      };
    },
    async read() {
      return JSON.parse(readFileSync(anchorPath, "utf8"));
    },
    async advance() {
      throw new Error("parent_recovery_provider_must_not_advance");
    }
  });
}

function childProgram(lockUrl, storeUrl, journalUrl, coordinatorUrl, writerUrl) {
  return [
    'import { DatabaseSync } from "node:sqlite";',
    'import { createHash, createHmac, randomUUID } from "node:crypto";',
    'import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";',
    "import { createInProcessExclusiveLockProvider } from " + JSON.stringify(lockUrl) + ";",
    "import { SqliteOfficeIncidentStore } from " + JSON.stringify(storeUrl) + ";",
    "import { SqliteMonotonicCheckpointJournal } from " + JSON.stringify(journalUrl) + ";",
    "import { SqliteMonotonicCheckpointCoordinator } from " + JSON.stringify(coordinatorUrl) + ";",
    "import { MonotonicIncidentWriter } from " + JSON.stringify(writerUrl) + ";",
    "const [databasePath, anchorPath, phase] = process.argv.slice(1, 4);",
    'const installationId = "officekit-process-crash-01";',
    "const macKey = Buffer.alloc(32, 0x41);",
    "const cryptoProvider = { sha256Hex: value => createHash(\"sha256\").update(value, \"utf8\").digest(\"hex\"), randomUUID };",
    "const macProvider = { keyId: \"test-process-crash-mac-v1\", hmacSha256Hex: value => createHmac(\"sha256\", macKey).update(value, \"utf8\").digest(\"hex\") };",
    "const database = new DatabaseSync(databasePath);",
    'database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");',
    "const db = { exec: sql => database.exec(sql), prepare: sql => database.prepare(sql), transaction: callback => {",
    "  const run = mode => { database.exec(\"BEGIN \" + mode); try { const result = callback(); database.exec(\"COMMIT\"); return result; } catch (error) { try { database.exec(\"ROLLBACK\"); } catch {} throw error; } };",
    "  const wrapped = () => run(\"\"); wrapped.immediate = () => run(\"IMMEDIATE\"); return wrapped;",
    "}};",
    "const lock = createInProcessExclusiveLockProvider();",
    "const store = new SqliteOfficeIncidentStore({ database: db, installationId, cryptoProvider, requireMac: true, writeLockProvider: lock });",
    "store.configureMacProvider(macProvider);",
    "const journal = new SqliteMonotonicCheckpointJournal({ database: db, installationId, lockProvider: lock, makeId: randomUUID, applyPreparedPayload: (payload, checkpoint) => store.applyPreparedMonotonicPayload(payload, checkpoint) });",
    "const anchor = {",
    "  async capabilities() { return { hardwareBacked: true, rollbackResistant: true, atomicCompareAndAdvance: true, durableAcrossRestart: true, scope: \"test-only-file-backed-fake\" }; },",
    "  async read() { return JSON.parse(readFileSync(anchorPath, \"utf8\")); },",
    "  async advance(expected, next) {",
    "    const current = JSON.parse(readFileSync(anchorPath, \"utf8\"));",
    "    const actual = current.checkpoint;",
    "    if (actual.installationId !== expected.installationId || actual.generation !== expected.generation || actual.sequence !== expected.sequence || actual.eventHash !== expected.eventHash || actual.eventMac !== expected.eventMac) throw new Error(\"fake_anchor_compare_failed\");",
    "    if (phase === \"before-anchor\") { process.stdout.write(\"ANCHOR_ADVANCE_ENTERED\\\\n\"); await new Promise(() => {}); }",
    "    const nextState = { status: \"protected\", installationId, anchorId: \"test-only-file-anchor\", checkpoint: next };",
    "    const temporaryPath = anchorPath + \".\" + process.pid + \".tmp\";",
    "    const descriptor = openSync(temporaryPath, \"wx\", 0o600);",
    "    try { writeFileSync(descriptor, JSON.stringify(nextState)); fsyncSync(descriptor); } finally { closeSync(descriptor); }",
    "    renameSync(temporaryPath, anchorPath);",
    "    process.stdout.write(\"ANCHOR_ADVANCED\\\\n\");",
    "    await new Promise(() => {});",
    "  }",
    "};",
    "const coordinator = new SqliteMonotonicCheckpointCoordinator({ provider: anchor, journal, installationId });",
    "const writer = new MonotonicIncidentWriter({ incidentStore: store, coordinator });",
    "await writer.append({ schemaVersion: 1, id: \"incident-process-crash-\" + phase, occurredAt: \"2026-11-14T00:00:00.000Z\", edition: \"universal\", status: \"degraded\", origin: \"transport\", confidence: \"probable\", diagnostics: [{ probeId: \"process-crash-test\", ok: false, evidence: \"forced-process-termination\" }], recoveryAttempts: [], outcome: \"unresolved\" });",
    "process.stdout.write(\"WRITE_COMPLETED\\\\n\");"
  ].join("\n");
}

async function terminateAtMarker({ databasePath, anchorPath, phase, marker }) {
  const urls = {
    lock: new URL("../src/exclusive-operation-lock.mjs", import.meta.url).href,
    store: new URL("../src/sqlite-office-incident-store.mjs", import.meta.url).href,
    journal: new URL("../src/sqlite-monotonic-checkpoint-journal.mjs", import.meta.url).href,
    coordinator: new URL("../src/sqlite-monotonic-checkpoint.mjs", import.meta.url).href,
    writer: new URL("../src/monotonic-incident-writer.mjs", import.meta.url).href
  };
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    childProgram(urls.lock, urls.store, urls.journal, urls.coordinator, urls.writer),
    databasePath,
    anchorPath,
    phase
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("child_marker_timeout:" + marker + ":" + stderr)), 15_000);
      child.stdout.on("data", chunk => {
        stdout += chunk.toString();
        if (stdout.includes(marker)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (!stdout.includes(marker)) {
          clearTimeout(timer);
          reject(new Error("child_exited_before_marker:" + code + ":" + signal + ":" + stderr));
        }
      });
    });

    assert.equal(child.kill("SIGKILL"), true, "child process must be terminated at the injected crash boundary");
    await once(child, "exit");
    assert.ok(child.exitCode !== 0 || child.signalCode !== null, "terminated child must not report a successful exit");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      try { await once(child, "exit"); } catch {}
    }
  }
}

async function recoverFromDisk(filename, anchorPath) {
  const opened = openDatabase(filename);
  const lock = createInProcessExclusiveLockProvider();
  try {
    const store = createStore(opened.adapter, lock);
    const journal = createJournal(opened.adapter, lock, store);
    const coordinator = new SqliteMonotonicCheckpointCoordinator({
      provider: fileAnchorProvider(anchorPath),
      journal,
      installationId
    });
    const result = await coordinator.recover();
    return {
      result,
      store,
      journal,
      close: async () => {
        await lock.close();
        opened.database.close();
      }
    };
  } catch (error) {
    await lock.close();
    opened.database.close();
    throw error;
  }
}

async function runCrashScenario(phase) {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-monotonic-process-crash-"));
  const filename = join(directory, "journal.sqlite");
  const anchorPath = join(directory, "anchor.json");
  const initialAnchor = {
    status: "protected",
    installationId,
    anchorId: "test-only-file-anchor",
    checkpoint: point(0, 0)
  };
  writeFileSync(anchorPath, JSON.stringify(initialAnchor) + "\n", { mode: 0o600 });

  try {
    await terminateAtMarker({
      databasePath: filename,
      anchorPath,
      phase,
      marker: phase === "before-anchor" ? "ANCHOR_ADVANCE_ENTERED" : "ANCHOR_ADVANCED"
    });
    const recovered = await recoverFromDisk(filename, anchorPath);
    try {
      const id = "incident-process-crash-" + phase;
      if (phase === "before-anchor") {
        assert.equal(recovered.result.recovered, "discarded_uncommitted_prepare");
        assert.equal(await recovered.store.get(id), null);
        assert.equal(recovered.store.verifyIntegrity().eventCount, 0);
        assert.equal((await recovered.journal.readCheckpoint()).sequence, 0);
      } else {
        assert.equal(recovered.result.recovered, "finalized");
        assert.equal((await recovered.store.get(id)).revision, 1);
        assert.equal(recovered.store.verifyIntegrity().eventCount, 1);
        assert.equal((await recovered.journal.readCheckpoint()).sequence, 1);
      }
      assert.equal(await recovered.journal.readPreparedCheckpoint(), null);
    } finally {
      await recovered.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

sqliteTest("recovers by discarding the durable prepare after a real child-process termination before anchor advancement", async () => {
  await runCrashScenario("before-anchor");
});

sqliteTest("recovers by finalizing the durable incident after a real child-process termination following anchor advancement", async () => {
  await runCrashScenario("after-anchor");
});
