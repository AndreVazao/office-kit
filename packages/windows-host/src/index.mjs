import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createWindowsNodeIdentityRuntime } from "../../scene-engine/src/windows.mjs";

const INSTALLATION_ID_PATTERN = /^officekit-[a-f0-9]{32}$/;
const LOCK_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function assertWindows(platform) {
  if (platform !== "win32") throw new Error("windows_host_requires_windows");
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
        try { database.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
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

function runChecked(command, args, spawnImpl) {
  const result = spawnImpl(command, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error("windows_host_command_failed_" + command.toLowerCase());
  }
  return String(result.stdout ?? "").trim();
}

export function resolveWindowsUserSid({ spawnImpl = spawnSync } = {}) {
  const output = runChecked("whoami.exe", ["/user", "/fo", "csv", "/nh"], spawnImpl);
  const sid = output.match(/S-1-(?:\d+-){1,14}\d+/)?.[0];
  if (!sid) throw new Error("windows_host_user_sid_unavailable");
  return sid;
}

export function applyWindowsPrivateAcl(path, {
  userSid,
  spawnImpl = spawnSync
} = {}) {
  if (typeof userSid !== "string" || !/^S-1-(?:\d+-){1,14}\d+$/.test(userSid)) {
    throw new TypeError("windows_host_user_sid_invalid");
  }
  runChecked("icacls.exe", [
    path,
    "/inheritance:r",
    "/grant:r",
    `*${userSid}:(OI)(CI)F`,
    "*S-1-5-18:(OI)(CI)F"
  ], spawnImpl);
}

export function verifyAuthenticodeHelper(helperPath, { spawnImpl = spawnSync } = {}) {
  if (typeof helperPath !== "string" || !isAbsolute(helperPath) || !existsSync(helperPath)) {
    throw new Error("windows_host_cng_helper_missing");
  }
  const escaped = helperPath.replace(/'/g, "''");
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($s.Status -ne 'Valid') { exit 3 }`;
  runChecked("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "AllSigned",
    "-Command",
    script
  ], spawnImpl);
  return true;
}

function ensureRealDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = statSync(path);
  if (!info.isDirectory()) throw new Error("windows_host_data_path_not_directory");
  const real = realpathSync(path);
  if (resolve(real) !== resolve(path)) throw new Error("windows_host_data_path_redirected");
  return real;
}

function readOrCreateInstallationId(path, makeId = randomUUID) {
  if (existsSync(path)) {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!INSTALLATION_ID_PATTERN.test(value?.installationId ?? "")) {
      throw new Error("windows_host_installation_id_corrupt");
    }
    return value.installationId;
  }
  const installationId = "officekit-" + makeId().replaceAll("-", "").toLowerCase();
  if (!INSTALLATION_ID_PATTERN.test(installationId)) throw new Error("windows_host_installation_id_invalid");
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({ installationId }) + "\n");
  } finally {
    closeSync(descriptor);
  }
  return installationId;
}

function acquireProcessLock(path, now = Date.now, pid = process.pid) {
  const content = JSON.stringify({ pid, createdAt: now() }) + "\n";
  try {
    const descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, content);
    closeSync(descriptor);
    return () => {
      try {
        const current = JSON.parse(readFileSync(path, "utf8"));
        if (current.pid === pid) rmSync(path, { force: true });
      } catch { /* A removed or corrupted lock must not block shutdown. */ }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let current;
    try { current = JSON.parse(readFileSync(path, "utf8")); } catch { current = null; }
    if (!Number.isSafeInteger(current?.pid) || current.pid <= 0) {
      throw new Error("windows_host_lock_unreadable");
    }
    try {
      process.kill(current.pid, 0);
      throw new Error("windows_host_already_running");
    } catch (probeError) {
      if (probeError?.message === "windows_host_already_running") throw probeError;
      if (probeError?.code !== "ESRCH") throw new Error("windows_host_lock_owner_unknown");
    }
    if (Number.isSafeInteger(current.createdAt) && now() - current.createdAt < LOCK_STALE_AFTER_MS) {
      throw new Error("windows_host_lock_recent_stale");
    }
    rmSync(path, { force: true });
    return acquireProcessLock(path, now, pid);
  }
}

/**
 * Windows-only local host composition root.
 * No network listener, backend discovery, telemetry or automatic enrollment is started.
 * The helper must have a valid Authenticode signature before the database is opened.
 */
export function createWindowsHost({
  platform = process.platform,
  appDataPath = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "OfficeKit") : "",
  helperPath = process.env.OFFICE_KIT_CNG_HOST_PATH ?? "",
  spawnImpl = spawnSync,
  resolveUserSid = () => resolveWindowsUserSid({ spawnImpl }),
  applyAcl = (path, userSid) => applyWindowsPrivateAcl(path, { userSid, spawnImpl }),
  verifyHelper = path => verifyAuthenticodeHelper(path, { spawnImpl }),
  databaseFactory = path => new DatabaseSync(path),
  runtimeFactory = createWindowsNodeIdentityRuntime,
  now = Date.now,
  makeId = randomUUID
} = {}) {
  assertWindows(platform);
  if (typeof appDataPath !== "string" || !isAbsolute(appDataPath)) {
    throw new TypeError("windows_host_app_data_path_must_be_absolute");
  }
  if (typeof helperPath !== "string" || !isAbsolute(helperPath)) {
    throw new TypeError("windows_host_cng_helper_path_must_be_absolute");
  }
  if (typeof runtimeFactory !== "function" || typeof databaseFactory !== "function") {
    throw new TypeError("windows_host_factories_required");
  }

  const root = resolve(appDataPath);
  const dataDirectory = join(root, "data");
  const identityPath = join(root, "installation.json");
  const databasePath = join(dataDirectory, "office-kit.sqlite");
  const lockPath = join(root, "host.lock");
  let database;
  let runtime;
  let releaseLock;
  let closed = false;

  try {
    ensureRealDirectory(root);
    const userSid = resolveUserSid();
    applyAcl(root, userSid);
    ensureRealDirectory(dataDirectory);
    applyAcl(dataDirectory, userSid);
    if (!existsSync(helperPath)) throw new Error("windows_host_cng_helper_missing");
    if (verifyHelper(helperPath) !== true) throw new Error("windows_host_cng_helper_untrusted");

    const installationId = readOrCreateInstallationId(identityPath, makeId);
    applyAcl(identityPath, userSid);
    releaseLock = acquireProcessLock(lockPath, now);
    applyAcl(lockPath, userSid);

    database = databaseFactory(databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    runtime = runtimeFactory({
      database: sqliteAdapter(database),
      installationId,
      hostExecutable: helperPath
    });
  } catch (error) {
    try { database?.close(); } catch { /* Preserve initialization error. */ }
    try { releaseLock?.(); } catch { /* Preserve initialization error. */ }
    throw error;
  }

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", identityStatus: "unknown" });
    const identity = await runtime.manager.getPublicIdentity();
    const reconciliation = await runtime.manager.reconcile();
    const identityStatus = reconciliation.status;
    const healthy = identityStatus === "empty" || identityStatus === "active" || identityStatus === "revoked";
    return Object.freeze({
      status: healthy ? "ready" : "degraded",
      identityStatus,
      installationId,
      identity: identity ? Object.freeze({
        organizationId: identity.organizationId,
        nodeId: identity.nodeId,
        generation: identity.generation,
        algorithm: identity.algorithm,
        identityFingerprint: identity.identityFingerprint
      }) : null,
      capabilities: runtime.capabilities
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    try { database.close(); }
    finally {
      releaseLock?.();
      releaseLock = null;
    }
  }

  return Object.freeze({
    installationId,
    databasePath,
    helperPath,
    manager: runtime.manager,
    health,
    close
  });
}
