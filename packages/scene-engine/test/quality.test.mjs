import test from "node:test";
import assert from "node:assert/strict";
import { QUALITY_PROFILES, resolveQualityProfile } from "../src/quality.mjs";

test("exposes four ordered resource profiles with consistent fields", () => {
  assert.deepEqual(Object.keys(QUALITY_PROFILES), ["economy", "balanced", "detailed", "cinematic"]);
  for (const profile of Object.values(QUALITY_PROFILES)) {
    assert.ok(profile.maxDevicePixelRatio > 0);
    assert.ok(profile.targetFps > 0);
    assert.ok(profile.maxVisibleAgents > 0);
  }
});

test("allows a user to select a fixed profile", () => {
  const selected = resolveQualityProfile("cinematic");
  assert.equal(selected.id, "cinematic");
  assert.equal(selected.selectedBy, "user");
  assert.equal(selected.maxDevicePixelRatio, 2.5);
});

test("rejects unknown profile names", () => {
  assert.throws(() => resolveQualityProfile("ultra-mega"), /Unknown quality profile/);
});

test("auto mode chooses economy for data saver, reduced motion or weak device hints", () => {
  assert.equal(resolveQualityProfile("auto", { saveData: true }).id, "economy");
  assert.equal(resolveQualityProfile("auto", { reducedMotion: true }).id, "economy");
  assert.equal(resolveQualityProfile("auto", { deviceMemory: 2 }).id, "economy");
  assert.equal(resolveQualityProfile("auto", { hardwareConcurrency: 4 }).id, "economy");
});

test("auto mode chooses detailed only for a capable wide device", () => {
  assert.equal(resolveQualityProfile("auto", { deviceMemory: 8, hardwareConcurrency: 8, viewportWidth: 1280 }).id, "detailed");
  assert.equal(resolveQualityProfile("auto", { deviceMemory: 8, hardwareConcurrency: 8, viewportWidth: 390 }).id, "balanced");
});

test("auto mode remains conservative when device information is unavailable", () => {
  assert.equal(resolveQualityProfile("auto").id, "balanced");
});
