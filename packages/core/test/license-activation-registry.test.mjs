import test from "node:test";
import assert from "node:assert/strict";
import { LicenseActivationRegistry } from "../src/license-activation-registry.mjs";

class AtomicMemoryStore {
  data = new Map();
  queues = new Map();
  async read(key) { return structuredClone(this.data.get(key) ?? null); }
  async transact(key, updater) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    this.queues.set(key, previous.then(() => gate));
    await previous;
    try {
      const current = structuredClone(this.data.get(key) ?? null);
      const update = updater(current);
      if (update.state !== current) this.data.set(key, structuredClone(update.state));
      return structuredClone(update.result);
    } finally {
      release();
      if (this.queues.get(key) === gate) this.queues.delete(key);
    }
  }
}
const fingerprint = n => String(n).padStart(64, "0");
const license = (maxInstallations = 2) => ({
  valid: true, status: "valid",
  entitlement: { licenseId: "license-team-01", maxInstallations }
});
const setup = (max = 2) => {
  const store = new AtomicMemoryStore();
  let sequence = 0;
  const registry = new LicenseActivationRegistry({
    store, clock: () => Date.parse("2026-11-05T06:00:00.000Z"),
    createActivationId: () => "activation-" + (++sequence),
    verifyLicenseEnvelope: async envelope => envelope?.signature?.trusted === true ? license(max) : { valid: false, status: "untrusted-signature" }
  });
  return { store, registry, licenseEnvelope: { signature: { trusted: true } } };
};

test("activation is idempotent for same installation and machine", async () => {
  const { registry, verifiedLicense } = setup();
  const first = await registry.activate({ licenseEnvelope, installationId: "pc-home", machineFingerprint: fingerprint(1) });
  const second = await registry.activate({ verifiedLicense, installationId: "pc-home", machineFingerprint: fingerprint(1) });
  assert.equal(first.activated, true);
  assert.equal(second.activated, true);
  assert.equal(second.alreadyActive, true);
  assert.equal(second.activationId, first.activationId);
});

test("enforces seat limits atomically and permits a new seat after deactivation", async () => {
  const { registry, verifiedLicense } = setup(1);
  const first = await registry.activate({ verifiedLicense, installationId: "pc-1", machineFingerprint: fingerprint(1) });
  const blocked = await registry.activate({ verifiedLicense, installationId: "pc-2", machineFingerprint: fingerprint(2) });
  assert.equal(first.activated, true);
  assert.equal(blocked.reason, "installation_limit_reached");
  const released = await registry.deactivate({ licenseId: "license-team-01", activationId: first.activationId, installationId: "pc-1" });
  assert.equal(released.deactivated, true);
  const next = await registry.activate({ verifiedLicense, installationId: "pc-2", machineFingerprint: fingerprint(2) });
  assert.equal(next.activated, true);
});

test("concurrent activation attempts cannot exceed licensed seats", async () => {
  const { registry, verifiedLicense } = setup(2);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => registry.activate({
    verifiedLicense, installationId: "pc-" + index, machineFingerprint: fingerprint(index + 1)
  })));
  assert.equal(results.filter(item => item.activated).length, 2);
  assert.equal(results.filter(item => item.reason === "installation_limit_reached").length, 6);
});

test("refuses unverified licenses, invalid installation IDs and raw machine identifiers", async () => {
  const { registry, verifiedLicense } = setup();
  assert.equal((await registry.activate({ licenseEnvelope: { signature: { trusted: false } }, installationId: "pc", machineFingerprint: fingerprint(1) })).reason, "verified_license_required");
  assert.equal((await registry.activate({ verifiedLicense, installationId: "", machineFingerprint: fingerprint(1) })).reason, "installation_id_invalid");
  assert.equal((await registry.activate({ verifiedLicense, installationId: "pc", machineFingerprint: "SERIAL-123" })).reason, "machine_fingerprint_invalid");
});

test("deactivation is idempotent and cannot target another installation", async () => {
  const { registry, verifiedLicense } = setup();
  const activation = await registry.activate({ verifiedLicense, installationId: "pc-1", machineFingerprint: fingerprint(1) });
  const denied = await registry.deactivate({ licenseId: "license-team-01", activationId: activation.activationId, installationId: "pc-2" });
  assert.equal(denied.reason, "activation_not_found");
  const first = await registry.deactivate({ licenseId: "license-team-01", activationId: activation.activationId, installationId: "pc-1" });
  const second = await registry.deactivate({ licenseId: "license-team-01", activationId: activation.activationId, installationId: "pc-1" });
  assert.equal(first.deactivated, true);
  assert.equal(second.alreadyInactive, true);
});

test("list omits machine fingerprints and reports active count", async () => {
  const { registry, verifiedLicense } = setup();
  await registry.activate({ verifiedLicense, installationId: "pc-1", machineFingerprint: fingerprint(1) });
  const result = await registry.list({ licenseId: "license-team-01" });
  assert.equal(result.activeInstallations, 1);
  assert.equal("machineFingerprint" in result.activations[0], false);
});
