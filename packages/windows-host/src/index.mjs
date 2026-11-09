import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  lstatSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createWindowsNodeIdentityRuntime } from "../../scene-engine/src/windows.mjs";
import { detectHostHardwareCapabilities } from "./hardware-capabilities.mjs";
import { resolveAdaptiveResourcePolicy } from "../../scene-engine/src/resource-policy.mjs";
import { SqliteOfficeIncidentStore } from "../../scene-engine/src/sqlite-office-incident-store.mjs";
import { OfficeHealthRecoveryEngine } from "../../scene-engine/src/office-health.mjs";

const INSTALLATION_ID_PATTERN = /^officekit-[a-f0-9]{32}$/;

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
  const inheritance = statSync(path).isDirectory() ? "(OI)(CI)F" : "F";
  runChecked("icacls.exe", [
    path,
    "/inheritance:r",
    "/grant:r",
    `*${userSid}:${inheritance}`,
    `*S-1-5-18:${inheritance}`
  ], spawnImpl);
}

export function verifyAuthenticodeHelper(helperPath, {
  spawnImpl = spawnSync,
  expectedThumbprint = process.env.OFFICE_KIT_CNG_SIGNER_THUMBPRINT
} = {}) {
  if (typeof helperPath !== "string" || !isAbsolute(helperPath) || !existsSync(helperPath)) {
    throw new Error("windows_host_cng_helper_missing");
  }
  if (typeof expectedThumbprint !== "string" || !/^[A-Fa-f0-9]{40}$/.test(expectedThumbprint)) {
    throw new Error("windows_host_cng_signer_thumbprint_required");
  }
  const escaped = helperPath.replace(/'/g, "''");
  const thumbprint = expectedThumbprint.toUpperCase();
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${thumbprint}') { exit 3 }`;
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
  const linkInfo = lstatSync(path);
  if (linkInfo.isSymbolicLink()) throw new Error("windows_host_data_path_redirected");
  const info = statSync(path);
  if (!info.isDirectory()) throw new Error("windows_host_data_path_not_directory");
  return resolve(path);
}

function rejectRedirectedFile(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("windows_host_data_file_redirected");
  }
}

function readOrCreateInstallationId(path, makeId = randomUUID) {
  rejectRedirectedFile(path);
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
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return installationId;
}

function acquireProcessLock(path, now = Date.now, pid = process.pid) {
  const content = JSON.stringify({ pid, createdAt: now() }) + "\n";
  try {
    const descriptor = openSync(path, "wx", 0o600);
    try {
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
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
  hardwareProbe = detectHostHardwareCapabilities,
  hardwareOptions = {},
  requestedProfile = "auto",
  requestedRenderer = "auto",
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
  if (typeof runtimeFactory !== "function" || typeof databaseFactory !== "function" || typeof hardwareProbe !== "function") {
    throw new TypeError("windows_host_factories_required");
  }

  const root = resolve(appDataPath);
  const dataDirectory = join(root, "data");
  const identityPath = join(root, "installation.json");
  const databasePath = join(dataDirectory, "office-kit.sqlite");
  const lockPath = join(root, "host.lock");
  let database;
  let runtime;
  let installationId;
  let releaseLock;
  let hardwareCapabilities;
  let resourcePolicy;
  let profileOverride = requestedProfile;
  let rendererOverride = requestedRenderer;
  let closed = false;

  try {
    ensureRealDirectory(root);
    const userSid = resolveUserSid();
    applyAcl(root, userSid);
    releaseLock = acquireProcessLock(lockPath, now);
    applyAcl(lockPath, userSid);
    ensureRealDirectory(dataDirectory);
    applyAcl(dataDirectory, userSid);
    hardwareCapabilities = hardwareProbe({ ...hardwareOptions, storagePath: dataDirectory });
    resourcePolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      requestedProfile: profileOverride,
      requestedRenderer: rendererOverride
    });
    if (!existsSync(helperPath)) throw new Error("windows_host_cng_helper_missing");
    if (verifyHelper(helperPath) !== true) throw new Error("windows_host_cng_helper_untrusted");

    installationId = readOrCreateInstallationId(identityPath, makeId);
    applyAcl(identityPath, userSid);

    rejectRedirectedFile(databasePath);
    database = databaseFactory(databasePath);
    applyAcl(databasePath, userSid);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    runtime = runtimeFactory({
      database: sqliteAdapter(database),
      installationId,
      hostExecutable: helperPath
    });
    var incidentStore = new SqliteOfficeIncidentStore({
      database: sqliteAdapter(database),
      installationId
    });
  } catch (error) {
    try { database?.close(); } catch { /* Preserve initialization error. */ }
    try { releaseLock?.(); } catch { /* Preserve initialization error. */ }
    throw error;
  }

  const ready = Promise.resolve().then(() => runtime.manager.reconcile());
  async function ensureReady() {
    const result = await ready;
    if (!["empty", "active", "revoked"].includes(result?.status)) {
      throw new Error("windows_host_startup_reconciliation_incomplete");
    }
    return result;
  }
  const manager = Object.freeze({
    create: async input => {
      await ensureReady();
      return runtime.manager.create(input);
    },
    rotate: async () => {
      await ensureReady();
      return runtime.manager.rotate();
    },
    revoke: async () => {
      await ensureReady();
      return runtime.manager.revoke();
    },
    getPublicIdentity: async () => {
      await ensureReady();
      return runtime.manager.getPublicIdentity();
    },
    reconcile: async () => {
      await ensureReady();
      return runtime.manager.reconcile();
    }
  });

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", identityStatus: "unknown" });
    await ready;
    const reconciliation = await runtime.manager.reconcile();
    const identityStatus = reconciliation.status;
    const healthy = identityStatus === "empty" || identityStatus === "active" || identityStatus === "revoked";
    const identity = healthy ? await runtime.manager.getPublicIdentity() : null;
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
      capabilities: runtime.capabilities,
      hardware: hardwareCapabilities,
      resourcePolicy
    });
  }

  function refreshResourcePolicy({ measurements = {} } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    hardwareCapabilities = hardwareProbe({ ...hardwareOptions, storagePath: dataDirectory });
    resourcePolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      measurements,
      previousPolicy: resourcePolicy,
      requestedProfile: profileOverride,
      requestedRenderer: rendererOverride
    });
    return structuredClone(resourcePolicy);
  }

  function setResourceOverrides({ profile = "auto", renderer = "auto" } = {}) {
    if (closed) throw new Error("windows_host_stopped");
    const nextPolicy = resolveAdaptiveResourcePolicy({
      capabilities: hardwareCapabilities,
      previousPolicy: resourcePolicy,
      requestedProfile: profile,
      requestedRenderer: renderer
    });
    profileOverride = profile;
    rendererOverride = renderer;
    resourcePolicy = nextPolicy;
    return structuredClone(resourcePolicy);
  }

  function getResourcePolicy() {
    return structuredClone(resourcePolicy);
  }

  async function close() {
    if (closed) return;
    closed = true;
    try { await ready; } catch { /* Initialization failure must not leak the database or lock. */ }
    try { database.close(); }
    finally {
      releaseLock?.();
      releaseLock = null;
    }
  }

  function createDiagnostics({ probes, recoveryActions = [], clock } = {}) {
    return new OfficeHealthRecoveryEngine({
      probes,
      incidentStore,
      recoveryActions,
      ...(typeof clock === "function" ? { clock } : {})
    });
  }

  return Object.freeze({
    installationId,
    incidentStore,
    createDiagnostics,
    getResourcePolicy,
    refreshResourcePolicy,
    setResourceOverrides,
    databasePath,
    helperPath,
    ready,
    manager,
    health,
    close
  });
}
