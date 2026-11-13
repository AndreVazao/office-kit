import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

function readLock(path) {
  let info;
  try { info = lstatSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("windows_host_lock_redirected");
  let raw;
  let value;
  try { raw = readFileSync(path, "utf8"); value = JSON.parse(raw); }
  catch { throw new Error("windows_host_lock_unreadable"); }
  return { raw, value };
}

function createExclusiveFile(path, content) {
  let descriptor;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
  try { writeFileSync(descriptor, content); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  return true;
}

function releaseOwnedFile(path, pid, token) {
  try {
    const current = readLock(path);
    if (current?.value?.pid !== pid || current?.value?.token !== token) return false;
    rmSync(path);
    return true;
  } catch { return false; }
}

function assertProcessUnavailable(pid, probeProcess) {
  try { probeProcess(pid, 0); }
  catch (error) {
    if (error?.code === "ESRCH") return;
    throw new Error("windows_host_lock_owner_unknown");
  }
  throw new Error("windows_host_already_running");
}

function createOwnedLock(path, content, pid, token) {
  if (!createExclusiveFile(path, content)) return null;
  return () => releaseOwnedFile(path, pid, token);
}

function createRecoveryGate(path, { pid, token, now }) {
  const recoveryPath = path + ".recovery";
  const recoveryToken = token + ":recovery";
  const content = JSON.stringify({ pid, createdAt: now(), token: recoveryToken }) + "\n";
  if (!createExclusiveFile(recoveryPath, content)) {
    throw new Error("windows_host_lock_recovery_in_progress");
  }
  return () => releaseOwnedFile(recoveryPath, pid, recoveryToken);
}

/**
 * Atomic single-host process lock for one private Office Kit data directory.
 * The host holds this lock for its entire lifetime. It is not a general-purpose
 * lock for arbitrary processes that bypass the host and open the SQLite file.
 *
 * Stale-lock reclamation is serialized by a second exclusive recovery file.
 * If a process crashes while holding that recovery file, startup fails closed
 * with windows_host_lock_recovery_in_progress until an operator verifies that
 * no host/recovery process is active and removes the stale recovery file.
 */
export function acquireWindowsHostProcessLock(path, {
  now = Date.now,
  pid = process.pid,
  makeId = randomUUID,
  probeProcess = (targetPid, signal) => process.kill(targetPid, signal)
} = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError("windows_host_lock_path_must_be_absolute");
  if (typeof now !== "function" || typeof makeId !== "function" || typeof probeProcess !== "function"
    || !Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("windows_host_lock_options_invalid");
  const token = makeId();
  if (typeof token !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(token)) throw new TypeError("windows_host_lock_token_invalid");
  const content = JSON.stringify({ pid, createdAt: now(), token }) + "\n";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const acquired = createOwnedLock(path, content, pid, token);
    if (acquired) return acquired;

    const current = readLock(path);
    if (!current) continue;
    if (!Number.isSafeInteger(current.value?.pid) || current.value.pid <= 0) throw new Error("windows_host_lock_unreadable");
    assertProcessUnavailable(current.value.pid, probeProcess);

    const releaseRecoveryGate = createRecoveryGate(path, { pid, token, now });
    try {
      const latest = readLock(path);
      if (!latest || latest.raw !== current.raw) continue;
      if (!Number.isSafeInteger(latest.value?.pid) || latest.value.pid <= 0) throw new Error("windows_host_lock_unreadable");
      assertProcessUnavailable(latest.value.pid, probeProcess);

      try { rmSync(path); }
      catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }

      const reclaimed = createOwnedLock(path, content, pid, token);
      if (reclaimed) return reclaimed;
    } finally {
      releaseRecoveryGate();
    }
  }

  throw new Error("windows_host_lock_contention");
}
