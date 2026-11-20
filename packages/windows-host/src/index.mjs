import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
import { SqliteInstallationLifecycleStore } from "./sqlite-installation-lifecycle-store.mjs";
import { createInstallationLifecycle as createInstallationLifecycleController } from "./installation-lifecycle.mjs";
import { resolveAdaptiveResourcePolicy } from "../../scene-engine/src/resource-policy.mjs";
import { SqliteOfficeIncidentStore } from "../../scene-engine/src/sqlite-office-incident-store.mjs";
import { AdapterGateway } from "../../scene-engine/src/adapter-gateway.mjs";
import { OfficeConnectionSupervisor, OfficeHealthRecoveryEngine } from "../../scene-engine/src/office-health.mjs";
import { WindowsCngSecretVault } from "./secret-vault.mjs";
import { acquireWindowsHostProcessLock } from "./process-lock.mjs";
import { createInProcessExclusiveLockProvider } from "../../scene-engine/src/exclusive-operation-lock.mjs";
import { SqliteMonotonicCheckpointJournal } from "../../scene-engine/src/sqlite-monotonic-checkpoint-journal.mjs";
import { SqliteMonotonicCheckpointCoordinator } from "../../scene-engine/src/sqlite-monotonic-checkpoint.mjs";
import { MonotonicIncidentWriter } from "../../scene-engine/src/monotonic-incident-writer.mjs";

const INSTALLATION_ID_PATTERN = /^officekit-[a-f0-9]{32}$/;

function createUnsupportedMonotonicAnchorProvider() {
  return Object.freeze({
    async capabilities() {
      return Object.freeze({
        hardwareBacked: false,
        rollbackResistant: false,
        atomicCompareAndAdvance: false,
        durableAcrossRestart: false,
        scope: "windows-host-no-tpm-provider"
      });
    },
    async read() {
      return Object.freeze({ status: "unsupported" });
    },
    async advance() {
      throw new Error("monotonic_anchor_provider_unsupported");
    }
  });
}

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
  // WinVerifyTrust validates the Authenticode signature and publisher chain
  // without online revocation/AIA retrieval. The exact publisher remains pinned.
  const script = String.raw`$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
public static class OfficeKitAuthenticode {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WINTRUST_FILE_INFO { public UInt32 cbStruct; public IntPtr pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct WINTRUST_DATA { public UInt32 cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public UInt32 dwUIChoice; public UInt32 fdwRevocationChecks; public UInt32 dwUnionChoice; public IntPtr pFile; public UInt32 dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference; public UInt32 dwProvFlags; public UInt32 dwUIContext; public IntPtr pSignatureSettings; }
  [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
  private static extern Int32 WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
  public static Int32 Verify(String path, String expectedThumbprint) {
    using (X509Certificate2 cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(path))) {
      if (!String.Equals(cert.Thumbprint, expectedThumbprint, StringComparison.OrdinalIgnoreCase)) return unchecked((Int32)0x800B0109);
    }
    IntPtr pathPtr = Marshal.StringToCoTaskMemUni(path); IntPtr filePtr = IntPtr.Zero;
    try {
      WINTRUST_FILE_INFO file = new WINTRUST_FILE_INFO(); file.cbStruct = (UInt32)Marshal.SizeOf(typeof(WINTRUST_FILE_INFO)); file.pcwszFilePath = pathPtr;
      filePtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WINTRUST_FILE_INFO))); Marshal.StructureToPtr(file, filePtr, false);
      WINTRUST_DATA data = new WINTRUST_DATA(); data.cbStruct = (UInt32)Marshal.SizeOf(typeof(WINTRUST_DATA)); data.dwUIChoice = 2; data.fdwRevocationChecks = 0; data.dwUnionChoice = 1; data.pFile = filePtr; data.dwStateAction = 1; data.dwProvFlags = 0x1010;
      Guid action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE"); Int32 result = WinVerifyTrust(IntPtr.Zero, ref action, ref data);
      data.dwStateAction = 2; WinVerifyTrust(IntPtr.Zero, ref action, ref data); return result;
    } finally { if (filePtr != IntPtr.Zero) Marshal.FreeHGlobal(filePtr); Marshal.FreeCoTaskMem(pathPtr); }
  }
}
'@
Add-Type -TypeDefinition $source -ErrorAction Stop
$result = [OfficeKitAuthenticode]::Verify('${escaped}', '${thumbprint}')
if ($result -ne 0) { exit 3 }`;
  runChecked("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "AllSigned", "-Command", script], spawnImpl);
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
