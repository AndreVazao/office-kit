import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeLicensePayload, validateLicenseEntitlement, verifyLicenseEntitlement, evaluateLicenseSeatCapacity } from "../src/licensing.mjs";

const grant = (overrides = {}) => ({
  schemaVersion: 1, productId: "office-kit", licenseId: "ok-license-2026-001",
  edition: "universal", plan: "team", issuedAt: "2026-11-04T00:00:00.000Z",
  notBefore: "2026-11-04T00:00:00.000Z", expiresAt: null, maxInstallations: 10,
  features: ["office-basic", "custom-layouts", "advanced-renderers"],
  customerReference: "customer-ref-opaque", ...overrides
});
const sig = { algorithm: "Ed25519", keyId: "office-kit-prod-2026", value: "base64url-signature-material" };
const envelope = (entitlement = grant(), signature = sig) => ({ entitlement, signature });

test("canonical payload sorts object keys recursively and preserves array order", () => {
  assert.equal(canonicalizeLicensePayload({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] }), '{"a":{"b":3,"y":2},"list":[2,1],"z":1}');
  assert.throws(() => canonicalizeLicensePayload({ value: undefined }), /unsupported_value/);
  assert.throws(() => canonicalizeLicensePayload({ constructor: "blocked" }), /forbidden_key/);
});
test("accepts a perpetual entitlement with a bounded installation count", () => {
  const result = validateLicenseEntitlement({ ...grant(), signature: sig }, { now: Date.parse("2027-01-01T00:00:00Z") });
  assert.equal(result.valid, true); assert.equal(result.status, "valid"); assert.equal(result.perpetual, true);
});
test("rejects invalid plans, duplicate features, invalid dates and unlimited seats", () => {
  const result = validateLicenseEntitlement({ ...grant({ plan: "lifetime-unlimited", maxInstallations: 0, features: ["office-basic", "office-basic"], expiresAt: "never" }), signature: sig });
  assert.equal(result.valid, false);
  for (const code of ["license_plan_invalid", "license_installation_limit_invalid", "license_features_invalid", "license_expiry_invalid"]) assert.ok(result.errors.includes(code));
});
test("verifies an offline signed entitlement through a trusted injected verifier", async () => {
  const calls = [];
  const result = await verifyLicenseEntitlement(envelope(), {
    now: Date.parse("2026-11-04T01:00:00Z"), expectedEdition: "universal",
    verifySignature: async input => { calls.push(input); return input.keyId === sig.keyId && input.payload.includes('"licenseId"'); }
  });
  assert.equal(result.valid, true); assert.equal(result.perpetual, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].algorithm, "Ed25519"); assert.equal(result.entitlement.licenseId, "ok-license-2026-001");
});
test("fails closed for wrong edition, untrusted signature, expired and future licenses", async () => {
  const verifier = async () => true;
  const wrong = await verifyLicenseEntitlement(envelope(), { expectedEdition: "vst", verifySignature: verifier });
  assert.equal(wrong.status, "invalid"); assert.ok(wrong.errors.includes("license_edition_mismatch"));
  const bad = await verifyLicenseEntitlement(envelope(), { verifySignature: async () => false });
  assert.equal(bad.status, "untrusted-signature");
  const expired = await verifyLicenseEntitlement(envelope(grant({ expiresAt: "2026-11-04T00:30:00.000Z" })), { now: Date.parse("2026-11-04T01:00:00Z"), verifySignature: verifier });
  assert.equal(expired.status, "expired");
  const future = await verifyLicenseEntitlement(envelope(grant({ notBefore: "2026-11-05T00:00:00.000Z" })), { now: Date.parse("2026-11-04T01:00:00Z"), verifySignature: verifier });
  assert.equal(future.status, "not-yet-valid");
});
test("requires trusted verifier and rejects tampered entitlement", async () => {
  await assert.rejects(verifyLicenseEntitlement(envelope()), /trusted_signature_verifier_required/);
  const result = await verifyLicenseEntitlement(envelope(grant({ maxInstallations: 50 })), { verifySignature: async ({ payload }) => payload.includes('"maxInstallations":10') });
  assert.equal(result.status, "untrusted-signature");
});
test("seat capacity is explicit and refuses untrusted counters", () => {
  assert.deepEqual(evaluateLicenseSeatCapacity({ entitlement: grant(), activeInstallationCount: 8 }), { allowed: true, reason: "seat_available", remaining: 2 });
  assert.deepEqual(evaluateLicenseSeatCapacity({ entitlement: grant(), activeInstallationCount: 10 }), { allowed: false, reason: "installation_limit_reached", remaining: 0 });
  assert.equal(evaluateLicenseSeatCapacity({ entitlement: grant(), activeInstallationCount: "8" }).allowed, false);
});
