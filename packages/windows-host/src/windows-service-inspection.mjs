import { spawnSync } from "node:child_process";
import { win32 } from "node:path";

const STATES = new Set(["stopped", "start pending", "stop pending", "running", "continue pending", "pause pending", "paused"]);
const START_MODES = new Set(["boot", "system", "auto", "demand", "disabled"]);

function fail(code) { throw new Error(code); }

function normalizeWindowsPath(value) {
  return win32.normalize(value).replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

function executableFromCommandLine(commandLine) {
  if (typeof commandLine !== "string" || commandLine.length > 32_768) fail("windows_service_path_invalid");
  const match = commandLine.trim().match(/^"([^"]+?\.exe)"(?:\s|$)|^(.+?\.exe)(?:\s|$)/i);
  const executable = match?.[1] ?? match?.[2];
  if (!executable || !win32.isAbsolute(executable)) fail("windows_service_executable_path_ambiguous");
  return win32.normalize(executable);
}

function runPowerShell(serviceName, spawnImpl, timeoutMs) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$filter = \"Name = '$env:OFFICE_KIT_SERVICE_NAME'\"",
    "$items = @(Get-CimInstance -ClassName Win32_Service -Filter $filter)",
    "if ($items.Count -ne 1) { [Console]::Error.WriteLine('service_identity_not_unique'); exit 21 }",
    "$s = $items[0]",
    "[pscustomobject]@{ Name=$s.Name; State=$s.State; StartMode=$s.StartMode; PathName=$s.PathName; ProcessId=$s.ProcessId; StartName=$s.StartName } | ConvertTo-Json -Compress"
  ].join("; ");
  const result = spawnImpl("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "AllSigned", "-Command", script
  ], {
    encoding: "utf8", windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer: 64 * 1024,
    env: { ...process.env, OFFICE_KIT_SERVICE_NAME: serviceName }
  });
  if (result?.error || result?.status !== 0) fail("windows_service_inspection_failed");
  return String(result.stdout ?? "");
}

/** Read-only inspection of one explicitly configured Windows service. */
export function inspectWindowsService({
  serviceName, expectedExecutablePath, platform = process.platform, spawnImpl = spawnSync, timeoutMs = 5_000
} = {}) {
  if (platform !== "win32") fail("windows_service_inspection_requires_windows");
  if (typeof serviceName !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/.test(serviceName)) fail("windows_service_name_invalid");
  if (typeof expectedExecutablePath !== "string" || !win32.isAbsolute(expectedExecutablePath)) fail("windows_service_expected_path_must_be_absolute");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15_000) fail("windows_service_timeout_invalid");
  if (typeof spawnImpl !== "function") fail("windows_service_process_runner_required");

  const output = runPowerShell(serviceName, spawnImpl, timeoutMs);
  let record;
  try { record = JSON.parse(output); } catch { fail("windows_service_response_invalid"); }
  if (!record || record.Name !== serviceName) fail("windows_service_identity_mismatch");
  if (!STATES.has(String(record.State ?? "").toLowerCase())) fail("windows_service_state_invalid");
  if (!START_MODES.has(String(record.StartMode ?? "").toLowerCase())) fail("windows_service_start_mode_invalid");

  const executablePath = executableFromCommandLine(record.PathName);
  if (normalizeWindowsPath(executablePath) !== normalizeWindowsPath(expectedExecutablePath)) fail("windows_service_executable_mismatch");
  if (!Number.isSafeInteger(record.ProcessId) || record.ProcessId < 0) fail("windows_service_pid_invalid");
  if (typeof record.StartName !== "string" || record.StartName.length > 512) fail("windows_service_account_invalid");

  return Object.freeze({
    serviceName: record.Name, state: String(record.State).toLowerCase(), startMode: String(record.StartMode).toLowerCase(),
    executablePath, processId: record.ProcessId, startName: record.StartName,
    inspectedAt: new Date().toISOString(), source: "windows_cim_read_only"
  });
}
