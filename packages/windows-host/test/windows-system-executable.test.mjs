import test from "node:test";
import assert from "node:assert/strict";
import {
  createWindowsSystemProcessOptions,
  resolveWindowsSystemDirectory,
  resolveWindowsSystemExecutable,
  resolveWindowsSystemRoot
} from "../src/windows-system-executable.mjs";

const env = Object.freeze({
  SystemRoot: "C:\\Windows",
  WINDIR: "c:\\windows",
  PATH: "C:\\Untrusted\\bin",
  PSModulePath: "C:\\Users\\test\\Documents\\PowerShell\\Modules",
  TEMP: "C:\\Temp"
});

test("resolves only allowlisted Windows system executables to absolute system paths", () => {
  assert.equal(
    resolveWindowsSystemExecutable("powershell.exe", { env, platform: "win32" }),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  );
  assert.equal(
    resolveWindowsSystemExecutable("whoami.exe", { env, platform: "win32" }),
    "C:\\Windows\\System32\\whoami.exe"
  );
  assert.equal(
    resolveWindowsSystemExecutable("icacls.exe", { env, platform: "win32" }),
    "C:\\Windows\\System32\\icacls.exe"
  );
  assert.throws(
    () => resolveWindowsSystemExecutable("cmd.exe", { env, platform: "win32" }),
    /windows_system_executable_not_allowed/
  );
});

test("rejects missing, relative, UNC and conflicting Windows system roots", () => {
  assert.throws(
    () => resolveWindowsSystemRoot({ env: {}, platform: "win32" }),
    /windows_system_root_unavailable/
  );
  assert.throws(
    () => resolveWindowsSystemRoot({ env: { SystemRoot: "Windows" }, platform: "win32" }),
    /windows_system_root_unavailable/
  );
  assert.throws(
    () => resolveWindowsSystemRoot({ env: { SystemRoot: "C:\\\\", WINDIR: "C:\\\\" }, platform: "win32" }),
    /windows_system_root_invalid/
  );
  assert.throws(
    () => resolveWindowsSystemRoot({ env: { SystemRoot: "\\\\server\\share\\Windows" }, platform: "win32" }),
    /windows_system_root_unavailable/
  );
  assert.throws(
    () => resolveWindowsSystemRoot({
      env: { SystemRoot: "C:\\Windows", WINDIR: "D:\\Windows" },
      platform: "win32"
    }),
    /windows_system_root_mismatch/
  );
});

test("uses an absolute System32 working directory and strips inherited executable/module search paths", () => {
  const options = createWindowsSystemProcessOptions({
    env,
    platform: "win32",
    extraEnv: { OFFICE_KIT_SERVICE_NAME: "OfficeKitHost" }
  });
  assert.equal(options.cwd, "C:\\Windows\\System32");
  assert.equal(options.env.SystemRoot, "C:\\Windows");
  assert.equal(options.env.WINDIR, "C:\\Windows");
  assert.equal(options.env.PATH, "C:\\Windows\\System32");
  assert.equal(options.env.PSModulePath, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules");
  assert.equal(options.env.TEMP, "C:\\Temp");
  assert.equal(options.env.OFFICE_KIT_SERVICE_NAME, "OfficeKitHost");
  assert.ok(!options.env.PATH.includes("Untrusted"));
  assert.ok(!options.env.PSModulePath.includes("Users"));
});

test("provides a deterministic Windows root only for non-Windows test harnesses", () => {
  assert.equal(resolveWindowsSystemRoot(), "C:\\Windows");
  assert.equal(resolveWindowsSystemDirectory(), "C:\\Windows\\System32");
});
