import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { isAbsolute } from "node:path";

function readLock(path) {
  let info;
  try { info = lstatSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("windows_host_lock_redirected");
  }
  let raw;
  let value;
  try {
    raw = readFileSync(path, "utf8");
    value = JSON.parse(raw);
  } catch {
    throw new Error("windows_host_lock_unreadable");
  }
  return { raw, value };
}

/**
 * Atomic single-host process lock for one private Office Kit data directory.
 * The host holds this lock for its entire lifetime. It is not a general-purpose
 * lock for arbitrary processes that bypass the host and open the SQLite file.
 */
export function acquireWindowsHostProcessLock(path, {
  now = Date.now,
  pid = process.pid,
  makeId = randomUUID,
  probeProcess = (targetPid, signal) => process.kill(targetPid, signal)
} = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new TypeError("windows_host_lock_path_must_be_absolute");
  }
  if (typeof now !== "function" || typeof makeId !== "function"
    || typeof probeProcess !== "function"
    || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new TypeError("windows_host_lock_options_invalid");
  }
  const token = makeId();
  if (typeof token !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(token)) {
    throw new TypeError("windows_host_lock_token_invalid");
  }
  const content = JSON.stringify({ pid, createdAt: now(), token }) + "\n";

  try {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      try {
        const current = readLock(path);
        if (current?.value?.pid !== pid || current?.value?.token !== token) return false;
        rmSync(path);
        return true;
      } catch {
        return false;
      }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = readLock(path);
    if (!current) return acquireWindowsHostProcessLock(path, { now, pid, makeId, probeProcess });
    if (!Number.isSafeInteger(current.value?.pid) || current.value.pid <= 0) {
      throw new Error("windows_host_lock_unreadable");
    }
    try {
      probeProcess(current.value.pid, 0);
      throw new Error("windows_host_already_running");
    } catch (probeError) {
      if (probeError?.message === "windows_host_already_running") throw probeError;
      if (probeError?.code !== "ESRCH") throw new Error("windows_host_lock_owner_unknown");
    }
    const latest = readLock(path);
    if (!latest) return acquireWindowsHostProcessLock(path, { now, pid, makeId, probeProcess });
    if (latest.raw !== current.raw) {
      return acquireWindowsHostProcessLock(path, { now, pid, makeId, probeProcess });
    }
    rmSync(path, { force: true });
    return acquireWindowsHostProcessLock(path, { now, pid, makeId, probeProcess });
  }
}
