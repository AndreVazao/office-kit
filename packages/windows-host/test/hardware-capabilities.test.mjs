import test from "node:test";
import assert from "node:assert/strict";
import { detectHostHardwareCapabilities } from "../src/hardware-capabilities.mjs";

test("detects CPU, memory, storage, GPU and display without confusing adapter RAM with dedicated VRAM", () => {
  const facts = detectHostHardwareCapabilities({
    osPlatform: "win32", osRelease: "10.0", osArchitecture: "x64",
    cpuProbe: () => [{ model: "Test CPU" }, { model: "Test CPU" }],
    totalMemoryProbe: () => 3_221_225_472,
    availableMemoryProbe: () => 1_073_741_824,
    storagePath: "C:\\OfficeKit",
    storageProbe: () => ({ bavail: 10_000, bsize: 4096 }),
    graphicsProbe: () => ({ name: "Test GPU", dedicatedVramMB: 512, api: "Direct3D 12" }),
    displayProbe: () => ({ width: 1920, height: 1080 }),
    clock: () => Date.parse("2026-11-09T12:00:00.000Z")
  });
  assert.equal(facts.os, "win32 10.0");
  assert.equal(facts.cpuThreads, 2);
  assert.equal(facts.memoryTotalMB, 3072);
  assert.equal(facts.memoryAvailableMB, 1024);
  assert.equal(facts.gpuName, "Test GPU");
  assert.equal(facts.gpuVramMB, 512);
  assert.equal(facts.storageFreeMB, 39);
  assert.equal(facts.displayWidth, 1920);
  assert.equal(facts.displayHeight, 1080);
  assert.equal(facts.detectionWarnings.length, 0);
});

test("keeps unavailable GPU and display capabilities unknown instead of inventing values", () => {
  const facts = detectHostHardwareCapabilities({
    cpuProbe: () => [{ model: "CPU" }],
    totalMemoryProbe: () => 8_589_934_592,
    availableMemoryProbe: () => 4_294_967_296,
    storageProbe: () => { throw new Error("denied"); },
    clock: () => 0
  });
  assert.equal(facts.gpuName, null);
  assert.equal(facts.gpuVramMB, null);
  assert.equal(facts.displayWidth, null);
  assert.equal(facts.displayHeight, null);
  assert.equal(facts.storageFreeMB, null);
  assert.ok(facts.detectionWarnings.includes("storage_probe_failed"));
  assert.ok(facts.detectionWarnings.includes("graphics_probe_not_configured"));
});

test("reports failed CPU and memory probes without preventing startup", () => {
  const facts = detectHostHardwareCapabilities({
    cpuProbe: () => { throw new Error("cpu denied"); },
    totalMemoryProbe: () => { throw new Error("memory denied"); },
    availableMemoryProbe: () => { throw new Error("memory denied"); },
    storageProbe: () => ({ bavail: 1, bsize: 1024 }),
    clock: () => 0
  });
  assert.equal(facts.cpuThreads, null);
  assert.equal(facts.memoryTotalMB, null);
  assert.equal(facts.memoryAvailableMB, null);
  assert.ok(facts.detectionWarnings.includes("cpu_probe_failed"));
  assert.ok(facts.detectionWarnings.includes("total_memory_probe_failed"));
});
