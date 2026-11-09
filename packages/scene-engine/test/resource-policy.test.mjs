import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHardwareCapabilities, resolveAdaptiveResourcePolicy, adaptiveResourceContract } from "../src/resource-policy.mjs";

const weakPc = {
  os: "Windows 10", architecture: "x64", cpuCores: 2,
  memoryTotalMB: 3072, memoryAvailableMB: 1200,
  gpuName: "integrated", gpuVramMB: 512, storageFreeMB: 20_000,
  displayWidth: 1920, displayHeight: 1080
};

test("normalizes host-provided hardware capabilities without assuming missing values", () => {
  const result = normalizeHardwareCapabilities({ cpuCores: 2, memoryTotalMB: 3072, os: "Windows" });
  assert.equal(result.cpuCores, 2);
  assert.equal(result.memoryTotalMB, 3072);
  assert.equal(result.gpuVramMB, null);
  assert.equal(result.os, "Windows");
});

test("weak hardware selects a lightweight renderer but preserves every social activity", () => {
  const policy = resolveAdaptiveResourcePolicy({ capabilities: weakPc });
  assert.equal(policy.profile, "economy");
  assert.equal(policy.rendererTier, "minimal");
  assert.equal(policy.socialSimulationEnabled, true);
  assert.equal(policy.socialActivitySemantics, "full");
  assert.equal(policy.backendExecutionPolicy, "independent_protected");
  assert.ok(policy.rendererBudget.cpuPercentTarget < 20);
});

test("powerful hardware unlocks detailed or cinematic rendering without changing product features", () => {
  const policy = resolveAdaptiveResourcePolicy({
    capabilities: { cpuCores: 16, memoryTotalMB: 65_536, memoryAvailableMB: 48_000, gpuVramMB: 16_384 },
    measurements: { frameTimeMs: 12 }
  });
  assert.equal(policy.profile, "cinematic");
  assert.equal(policy.rendererTier, "three_d");
  assert.equal(policy.socialActivitySemantics, "full");
});

test("manual overrides are respected and reported", () => {
  const policy = resolveAdaptiveResourcePolicy({
    capabilities: weakPc, requestedProfile: "cinematic", requestedRenderer: "three_d"
  });
  assert.equal(policy.profile, "cinematic");
  assert.equal(policy.rendererTier, "three_d");
  assert.equal(policy.selectedBy, "user");
  assert.equal(policy.transition, "manual_override");
});

test("degradation and recovery use hysteresis to avoid profile oscillation", () => {
  const strong = { cpuCores: 8, memoryTotalMB: 16_384, memoryAvailableMB: 8_000, gpuVramMB: 4_096 };
  const current = { profile: "detailed", rendererTier: "three_d", degradationStreak: 0, recoveryStreak: 0 };
  const firstPoor = resolveAdaptiveResourcePolicy({ capabilities: weakPc, previousPolicy: current });
  assert.equal(firstPoor.transition, "holding_before_degradation");
  assert.equal(firstPoor.profile, "detailed");
  const secondPoor = resolveAdaptiveResourcePolicy({
    capabilities: weakPc, previousPolicy: { ...current, degradationStreak: 1 }
  });
  assert.equal(secondPoor.transition, "degraded");
  assert.equal(secondPoor.profile, "economy");
  const firstGood = resolveAdaptiveResourcePolicy({ capabilities: strong, previousPolicy: { ...current, recoveryStreak: 0 } });
  assert.equal(firstGood.transition, "holding_before_recovery");
  const recovered = resolveAdaptiveResourcePolicy({
    capabilities: strong, previousPolicy: { ...current, recoveryStreak: 3 }
  });
  assert.equal(recovered.transition, "recovered");
  assert.equal(recovered.profile, "detailed");
});

test("rejects malformed hardware facts and unsupported overrides", () => {
  assert.throws(() => normalizeHardwareCapabilities({ cpuCores: 0 }), /positive integer/);
  assert.throws(() => resolveAdaptiveResourcePolicy({ capabilities: weakPc, requestedProfile: "unlimited" }), /invalid_quality_profile/);
  assert.throws(() => resolveAdaptiveResourcePolicy({ capabilities: weakPc, requestedRenderer: "vr" }), /invalid_renderer_tier/);
});

test("resource contract exposes renderer tiers without feature ceilings", () => {
  assert.deepEqual(adaptiveResourceContract.rendererTiers, ["minimal", "pixel", "low_poly", "three_d"]);
  assert.equal(adaptiveResourceContract.socialActivitySemantics, "full");
});
