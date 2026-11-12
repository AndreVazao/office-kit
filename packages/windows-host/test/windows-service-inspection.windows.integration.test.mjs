import test from "node:test";
import assert from "node:assert/strict";
import { win32 } from "node:path";
import { inspectWindowsService } from "../src/windows-service-inspection.mjs";

test("native Windows CIM inspection verifies the built-in RPC service without changing it", {
  skip: process.platform !== "win32"
}, () => {
  const expectedExecutablePath = win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "svchost.exe");
  const snapshot = inspectWindowsService({
    serviceName: "RpcSs",
    expectedExecutablePath,
    timeoutMs: 30_000
  });
  assert.equal(snapshot.serviceName, "RpcSs");
  assert.equal(snapshot.state, "running");
  assert.ok(snapshot.processId > 0);
  assert.equal(snapshot.source, "windows_cim_read_only");
});
