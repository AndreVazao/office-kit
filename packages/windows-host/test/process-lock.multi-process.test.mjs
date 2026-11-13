import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
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

test("serializes the Windows host singleton lock across independent Node processes", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-kit-process-lock-"));
  const lockPath = join(directory, "host.lock");
  let child;
  let stderr = "";
  try {
    child = spawn(process.execPath, ["--input-type=module", "-e", childSource, lockPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });
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
