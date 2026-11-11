import test from "node:test";
import assert from "node:assert/strict";
import { inspectWindowsService } from "../src/windows-service-inspection.mjs";

const expected = "C:\\Program Files\\Office Kit\\OfficeKit.Host.exe";
const service = {
  Name: "OfficeKitHost",
  State: "Running",
  StartMode: "Auto",
  PathName: '"C:\\Program Files\\Office Kit\\OfficeKit.Host.exe" --service',
  ProcessId: 4321,
  StartName: "LocalSystem"
};

function runner(record = service, status = 0) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return { status, stdout: JSON.stringify(record), stderr: "" };
  };
  return { calls, spawnImpl };
}

test("inspects one explicitly named service and returns a normalized read-only snapshot", () => {
  const { calls, spawnImpl } = runner();
  const result = inspectWindowsService({
    serviceName: "OfficeKitHost",
    expectedExecutablePath: expected,
    platform: "win32",
    spawnImpl
  });
  assert.equal(result.serviceName, "OfficeKitHost");
  assert.equal(result.state, "running");
  assert.equal(result.startMode, "auto");
  assert.equal(result.processId, 4321);
  assert.equal(result.source, "windows_cim_read_only");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 5000);
  assert.equal(calls[0].options.env.OFFICE_KIT_SERVICE_NAME, "OfficeKitHost");
  assert.ok(!calls[0].args.some(value => value.includes("OfficeKitHost")));
});

test("rejects a service whose executable path differs from the configured binary", () => {
  const { spawnImpl } = runner({ ...service, PathName: '"C:\\Windows\\System32\\svchost.exe" -k netsvcs' });
  assert.throws(() => inspectWindowsService({
    serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "win32", spawnImpl
  }), /windows_service_executable_mismatch/);
});

test("rejects service identity mismatch and malformed or ambiguous records", () => {
  for (const record of [
    { ...service, Name: "OtherService" },
    { ...service, PathName: "OfficeKitHost.exe" },
    { ...service, State: "Unknown" },
    { ...service, StartMode: "Manual-ish" },
    { ...service, ProcessId: -1 },
    { ...service, StartName: 42 }
  ]) {
    const { spawnImpl } = runner(record);
    assert.throws(() => inspectWindowsService({
      serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "win32", spawnImpl
    }));
  }
});

test("fails closed on process errors, invalid JSON and nonzero exit status", () => {
  assert.throws(() => inspectWindowsService({
    serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "win32",
    spawnImpl: () => ({ status: 1, stdout: "", stderr: "private details" })
  }), /windows_service_inspection_failed/);
  assert.throws(() => inspectWindowsService({
    serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "win32",
    spawnImpl: () => ({ status: 0, stdout: "not-json" })
  }), /windows_service_response_invalid/);
});

test("validates platform, service name, expected path and bounded timeout before spawning", () => {
  const { calls, spawnImpl } = runner();
  assert.throws(() => inspectWindowsService({ serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "linux", spawnImpl }), /requires_windows/);
  assert.throws(() => inspectWindowsService({ serviceName: "bad name", expectedExecutablePath: expected, platform: "win32", spawnImpl }), /service_name_invalid/);
  assert.throws(() => inspectWindowsService({ serviceName: "OfficeKitHost", expectedExecutablePath: "relative.exe", platform: "win32", spawnImpl }), /expected_path_must_be_absolute/);
  assert.throws(() => inspectWindowsService({ serviceName: "OfficeKitHost", expectedExecutablePath: expected, platform: "win32", timeoutMs: 60_000, spawnImpl }), /timeout_invalid/);
  assert.equal(calls.length, 0);
});
