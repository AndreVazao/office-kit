import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWindowsHostProcessLock } from "../src/process-lock.mjs";

const moduleUrl = new URL("../src/process-lock.mjs", import.meta.url).href;
const childSource = [
  "import { acquireWindowsHostProcessLock } from " + JSON.stringify(moduleUrl) + ";",
  "const release = acquireWindowsHostProcessLock(process.argv[1]);",
  "process.stdout.write('LOCKED\\n');",
  "process.stdin.once('data', () => { release(); process.stdout.write('RELEASED\\n'); process.exit(0); });"
].join("\n");

function unavailableProcess() {
  const error = new Error("process_not_found");
  error.code = "ESRCH";
  throw error;
}

function staleLock(pid = 987654) {
  return JSON.stringify({ pid, createdAt: 1, token: "stale-owner-token-0001" }) + "\n";
}

test("serializes the Windows host singleton lock across independent Node processes", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-process-lock-"));
  const lockPath = join(directory, "host.lock");
  let child;
  let stderr = "";
  try {
    child = spawn(process.execPath, ["--input-type=module", "-e", childSource, lockPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    const acquired = new Promise((resolve, reject) => {
      child.stdout.on("data", chunk => {
        stdout += chunk.toString();
        if (stdout.includes("LOCKED")) resolve();
      });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("exit", code => {
        if (!stdout.includes("LOCKED")) reject(new Error("lock child exited before acquisition: " + code + " " + stderr));
      });
    });
    await acquired;
    assert.throws(() => acquireWindowsHostProcessLock(lockPath), /windows_host_already_running/);
    child.stdin.write("release\\n");
    const [code] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    const release = acquireWindowsHostProcessLock(lockPath);
    assert.equal(release(), true);
    assert.equal(release(), false);
  } finally {
    if (child && child.exitCode === null) child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reclaims a stale host lock under an exclusive recovery gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-stale-lock-"));
  const lockPath = join(directory, "host.lock");
  try {
    writeFileSync(lockPath, staleLock());
    const release = acquireWindowsHostProcessLock(lockPath, {
      pid: 12345, now: () => 2, makeId: () => "fresh-owner-token-0001", probeProcess: unavailableProcess
    });
    const current = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(current.pid, 12345);
    assert.equal(current.token, "fresh-owner-token-0001");
    assert.equal(existsSync(lockPath + ".recovery"), false);
    assert.equal(release(), true);
    assert.equal(existsSync(lockPath), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("fails closed when another stale-lock recovery gate already exists", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-recovery-gate-"));
  const lockPath = join(directory, "host.lock");
  const originalLock = staleLock();
  const originalGate = JSON.stringify({ pid: 24680, createdAt: 1, token: "recovery-owner-token-0001" }) + "\n";
  try {
    writeFileSync(lockPath, originalLock);
    writeFileSync(lockPath + ".recovery", originalGate);
    assert.throws(() => acquireWindowsHostProcessLock(lockPath, {
      pid: 12345, makeId: () => "fresh-owner-token-0001", probeProcess: unavailableProcess
    }), /windows_host_lock_recovery_in_progress/);
    assert.equal(readFileSync(lockPath, "utf8"), originalLock);
    assert.equal(readFileSync(lockPath + ".recovery", "utf8"), originalGate);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rechecks a stale owner after acquiring the recovery gate", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-owner-recheck-"));
  const lockPath = join(directory, "host.lock");
  const originalLock = staleLock();
  let probes = 0;
  try {
    writeFileSync(lockPath, originalLock);
    assert.throws(() => acquireWindowsHostProcessLock(lockPath, {
      pid: 12345, makeId: () => "fresh-owner-token-0001",
      probeProcess: () => { probes += 1; if (probes === 1) unavailableProcess(); }
    }), /windows_host_already_running/);
    assert.equal(probes, 2);
    assert.equal(readFileSync(lockPath, "utf8"), originalLock);
    assert.equal(existsSync(lockPath + ".recovery"), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an old release closure cannot remove a replacement lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-lock-owner-"));
  const lockPath = join(directory, "host.lock");
  const replacement = JSON.stringify({ pid: 54321, createdAt: 3, token: "replacement-owner-token-0001" }) + "\n";
  try {
    const release = acquireWindowsHostProcessLock(lockPath, {
      pid: 12345, makeId: () => "original-owner-token-0001"
    });
    writeFileSync(lockPath, replacement);
    assert.equal(release(), false);
    assert.equal(readFileSync(lockPath, "utf8"), replacement);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
