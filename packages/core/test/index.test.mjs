import test from "node:test";
import assert from "node:assert/strict";
import { validateOfficeConfig, normalizeOfficeConfig, deriveAgentPresentation, deriveDepartmentHealth, chooseSocialActivity, SOCIAL_ACTIVITIES } from "../src/index.mjs";

const config = { contractVersion: 1, id: "demo-office", name: "Demo Office", scene: { layout: "diorama", orientation: "auto" }, departments: [{ id: "research", name: "Research", agents: [{ id: "agent-1", name: "Agent One" }] }] };

test("accepts a minimal valid project-neutral configuration", () => {
  assert.deepEqual(validateOfficeConfig(config), { valid: true, errors: [] });
  assert.deepEqual(normalizeOfficeConfig(config), config);
});
test("reports duplicate department IDs and unsupported layout", () => {
  const invalid = structuredClone(config); invalid.scene.layout = "fixed-office"; invalid.departments.push({ id: "research", name: "Duplicate" });
  const result = validateOfficeConfig(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("scene.layout")));
  assert.ok(result.errors.some(error => error.includes("duplicated")));
});
test("local social simulation is never labelled as real work", () => {
  const result = deriveAgentPresentation({ backendConfigured: false, operationalState: "working" });
  assert.equal(result.source, "local-simulation"); assert.equal(result.operationalState, "unknown"); assert.equal(result.label, "Simulação local");
});
test("stale heartbeat makes operational status unverified", () => {
  const result = deriveAgentPresentation({ backendConfigured: true, connection: "connected", operationalState: "working", lastSeenAt: 1000, now: 40000, staleAfterMs: 30000 });
  assert.equal(result.source, "backend-unverified"); assert.equal(result.operationalState, "unknown"); assert.equal(result.stale, true);
});
test("recent heartbeat can confirm backend state", () => {
  const result = deriveAgentPresentation({ backendConfigured: true, connection: "connected", operationalState: "working", lastSeenAt: 9000, now: 10000 });
  assert.equal(result.source, "backend"); assert.equal(result.label, "A trabalhar (confirmado)");
});
test("disconnected department routes to diagnostics without fabricated diagnosis", () => {
  const result = deriveDepartmentHealth({ backendConfigured: true, connection: "disconnected", lastSeenAt: null });
  assert.equal(result.zone, "infirmary"); assert.equal(result.status, "unverified"); assert.match(result.message, /sem diagnóstico confirmado/);
});
test("social activity selection is stable and valid", () => {
  const first = chooseSocialActivity("demo", "agent-1", 12);
  assert.equal(first, chooseSocialActivity("demo", "agent-1", 12)); assert.ok(SOCIAL_ACTIVITIES.includes(first));
});
