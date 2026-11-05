const LICENSE_SCHEMA_VERSION = 1;
const LICENSE_PRODUCT_ID = "office-kit";
const EDITIONS = Object.freeze(["universal", "dgmat", "vst"]);
const PLANS = Object.freeze(["solo", "team", "office", "enterprise"]);
const FEATURES = Object.freeze(["office-basic", "custom-layouts", "avatar-studio", "advanced-renderers", "backend-adapters", "private-federation", "priority-support"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = value => typeof value === "string" && value.trim().length > 0;
const parseTime = value => {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "0"] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return NaN;
  const millis = Number(fraction.padEnd(3, "0"));
  const parsed = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (!Number.isFinite(parsed)) return NaN;
  const normalized = new Date(parsed).toISOString();
  const expected = yearText + "-" + monthText + "-" + dayText + "T" + hourText + ":" + minuteText + ":" + secondText + "." + String(millis).padStart(3, "0") + "Z";
  return normalized === expected ? parsed : NaN;
};

export function canonicalizeLicensePayload(value) {
  const visit = (item, depth) => {
    if (depth > 12) throw new TypeError("license_payload_too_deep");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(entry => visit(entry, depth + 1));
    if (!isRecord(item)) throw new TypeError("license_payload_contains_unsupported_value");
    const output = {};
    for (const key of Object.keys(item).sort()) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new TypeError("license_payload_has_forbidden_key");
      output[key] = visit(item[key], depth + 1);
    }
    return output;
  };
  return JSON.stringify(visit(value, 0));
}

export function validateLicenseEntitlement(entitlement, { now = Date.now() } = {}) {
  const errors = [];
  if (!isRecord(entitlement)) return { valid: false, errors: ["license_must_be_an_object"] };
  if (entitlement.schemaVersion !== LICENSE_SCHEMA_VERSION) errors.push("unsupported_license_schema");
  if (entitlement.productId !== LICENSE_PRODUCT_ID) errors.push("license_product_mismatch");
  if (!isText(entitlement.licenseId) || entitlement.licenseId.length > 128) errors.push("license_id_invalid");
  if (!EDITIONS.includes(entitlement.edition)) errors.push("license_edition_invalid");
  if (!PLANS.includes(entitlement.plan)) errors.push("license_plan_invalid");
  if (!Number.isSafeInteger(entitlement.maxInstallations) || entitlement.maxInstallations < 1 || entitlement.maxInstallations > 100000) errors.push("license_installation_limit_invalid");
  if (!Array.isArray(entitlement.features) || entitlement.features.length > FEATURES.length || entitlement.features.some(feature => !FEATURES.includes(feature)) || new Set(entitlement.features).size !== entitlement.features.length) errors.push("license_features_invalid");
  const issuedAt = parseTime(entitlement.issuedAt);
  const notBefore = parseTime(entitlement.notBefore);
  if (!Number.isFinite(issuedAt)) errors.push("license_issued_at_invalid");
  if (!Number.isFinite(notBefore)) errors.push("license_not_before_invalid");
  if (Number.isFinite(issuedAt) && Number.isFinite(notBefore) && notBefore < issuedAt) errors.push("license_validity_order_invalid");
  let expiresAt = null;
  if (entitlement.expiresAt !== null) {
    expiresAt = parseTime(entitlement.expiresAt);
    if (!Number.isFinite(expiresAt)) errors.push("license_expiry_invalid");
    if (Number.isFinite(notBefore) && Number.isFinite(expiresAt) && expiresAt <= notBefore) errors.push("license_validity_order_invalid");
  }
  if (entitlement.customerReference !== undefined && (!isText(entitlement.customerReference) || entitlement.customerReference.length > 160)) errors.push("license_customer_reference_invalid");
  if (!isRecord(entitlement.signature) || entitlement.signature.algorithm !== "Ed25519" || !isText(entitlement.signature.keyId) || entitlement.signature.keyId.length > 80 || !isText(entitlement.signature.value) || entitlement.signature.value.length > 512) errors.push("license_signature_metadata_invalid");
  const current = Number.isFinite(now) ? now : Date.now();
  let status = "valid";
  if (errors.length === 0) {
    if (current < notBefore) status = "not-yet-valid";
    else if (expiresAt !== null && current >= expiresAt) status = "expired";
  }
  return { valid: errors.length === 0, errors, status, perpetual: entitlement.expiresAt === null };
}

export async function verifyLicenseEntitlement(envelope, { verifySignature, now = Date.now(), expectedEdition, expectedProductId = LICENSE_PRODUCT_ID } = {}) {
  if (typeof verifySignature !== "function") throw new TypeError("trusted_signature_verifier_required");
  if (!isRecord(envelope) || !isRecord(envelope.entitlement) || !isRecord(envelope.signature)) return { valid: false, status: "invalid", errors: ["license_envelope_invalid"] };
  const entitlement = envelope.entitlement;
  const signature = envelope.signature;
  const validation = validateLicenseEntitlement({ ...entitlement, signature }, { now });
  const errors = [...validation.errors];
  if (expectedProductId !== LICENSE_PRODUCT_ID || entitlement.productId !== expectedProductId) errors.push("license_product_mismatch");
  if (expectedEdition && entitlement.edition !== expectedEdition) errors.push("license_edition_mismatch");
  if (errors.length) return { valid: false, status: "invalid", errors, entitlement: null };
  let payload;
  try { payload = canonicalizeLicensePayload(entitlement); }
  catch { return { valid: false, status: "invalid", errors: ["license_payload_invalid"], entitlement: null }; }
  let verified = false;
  try { verified = await verifySignature({ algorithm: "Ed25519", keyId: signature.keyId, signature: signature.value, payload }) === true; }
  catch { verified = false; }
  if (!verified) return { valid: false, status: "untrusted-signature", errors: ["license_signature_verification_failed"], entitlement: null };
  if (validation.status !== "valid") return { valid: false, status: validation.status, errors: ["license_" + validation.status.replaceAll("-", "_")], entitlement: null };
  return { valid: true, status: "valid", perpetual: validation.perpetual, entitlement: Object.freeze(structuredClone(entitlement)) };
}

/** activeInstallationCount must come from a trusted, durable, atomic host registry. */
export function evaluateLicenseSeatCapacity({ entitlement, activeInstallationCount }) {
  if (!isRecord(entitlement) || !Number.isSafeInteger(entitlement.maxInstallations) || entitlement.maxInstallations < 1 || !Number.isSafeInteger(activeInstallationCount) || activeInstallationCount < 0) return { allowed: false, reason: "seat_count_untrusted_or_invalid", remaining: 0 };
  const remaining = Math.max(0, entitlement.maxInstallations - activeInstallationCount);
  return { allowed: remaining > 0, reason: remaining > 0 ? "seat_available" : "installation_limit_reached", remaining };
}

export const commercialLicenseContract = Object.freeze({
  schemaVersion: LICENSE_SCHEMA_VERSION, productId: LICENSE_PRODUCT_ID, editions: EDITIONS, plans: PLANS, features: FEATURES,
  signatureAlgorithm: "Ed25519", offlineVerification: true, perpetualExpiry: null,
  seatRegistry: "trusted-atomic-host-provider-required", billingProvider: null
});
