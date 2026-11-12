const HASH = /^[a-f0-9]{64}$/;
const INSTALLATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ANCHOR_STATUSES = new Set([
  "protected", "unsupported", "unprovisioned", "unavailable",
  "mismatch", "recovery_required"
]);

function validateCheckpoint(value, installationId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.installationId !== installationId
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || typeof value.protocolVersion !== "number" || value.protocolVersion !== 1
    || (value.sequence === 0
      ? value.eventHash !== null || value.eventMac !== null
      : !HASH.test(value.eventHash ?? "") || !HASH.test(value.eventMac ?? ""))) {
    throw new Error("monotonic_anchor_checkpoint_invalid");
  }
  return Object.freeze({
    installationId,
    generation: value.generation,
    sequence: value.sequence,
    eventHash: value.eventHash,
    eventMac: value.eventMac,
    protocolVersion: 1
  });
}

function validateCapabilities(value) {
  if (!value || typeof value !== "object"
    || typeof value.hardwareBacked !== "boolean"
    || typeof value.rollbackResistant !== "boolean"
    || typeof value.atomicCompareAndAdvance !== "boolean"
    || typeof value.durableAcrossRestart !== "boolean"
    || typeof value.scope !== "string" || !value.scope.trim()) {
    throw new Error("monotonic_anchor_capabilities_invalid");
  }
  return Object.freeze({
    hardwareBacked: value.hardwareBacked,
    rollbackResistant: value.rollbackResistant,
    atomicCompareAndAdvance: value.atomicCompareAndAdvance,
    durableAcrossRestart: value.durableAcrossRestart,
    scope: value.scope
  });
}

/**
 * Validates a platform anchor provider without upgrading its security claims.
 * A provider is protected only when every required hardware guarantee is explicit.
 */
export function validateMonotonicAnchorProvider(provider) {
  if (!provider || typeof provider !== "object"
    || typeof provider.read !== "function"
    || typeof provider.advance !== "function"
    || typeof provider.capabilities !== "function") {
    throw new TypeError("monotonic_anchor_provider_invalid");
  }
  return Object.freeze({
    read: provider.read.bind(provider),
    advance: provider.advance.bind(provider),
    capabilities: provider.capabilities.bind(provider)
  });
}

export async function inspectMonotonicAnchor(provider, installationId) {
  if (typeof installationId !== "string" || !INSTALLATION_ID.test(installationId)) {
    throw new TypeError("monotonic_anchor_installation_id_invalid");
  }
  const anchor = validateMonotonicAnchorProvider(provider);
  const [rawCapabilities, rawState] = await Promise.all([
    anchor.capabilities(),
    anchor.read()
  ]);
  const capabilities = validateCapabilities(rawCapabilities);
  if (!rawState || typeof rawState !== "object"
    || !ANCHOR_STATUSES.has(rawState.status)) {
    throw new Error("monotonic_anchor_state_invalid");
  }
  if (rawState.status !== "protected") {
    return Object.freeze({
      status: rawState.status,
      rollbackProtection: rawState.status,
      capabilities
    });
  }
  if (!capabilities.hardwareBacked || !capabilities.rollbackResistant
    || !capabilities.atomicCompareAndAdvance || !capabilities.durableAcrossRestart
    || rawState.installationId !== installationId
    || typeof rawState.anchorId !== "string" || !rawState.anchorId
    || rawState.anchorId.length > 256) {
    throw new Error("monotonic_anchor_protection_claim_invalid");
  }
  const checkpoint = validateCheckpoint(rawState.checkpoint, installationId);
  return Object.freeze({
    status: "protected",
    rollbackProtection: "protected",
    anchorId: rawState.anchorId,
    checkpoint,
    capabilities
  });
}

/**
 * Compare-and-advance is deliberately strict: exactly one generation may be
 * committed and the returned state must prove the requested checkpoint.
 */
export async function advanceMonotonicAnchor(provider, {
  installationId,
  expected,
  next
} = {}) {
  if (typeof installationId !== "string" || !INSTALLATION_ID.test(installationId)) {
    throw new TypeError("monotonic_anchor_installation_id_invalid");
  }
  const anchor = validateMonotonicAnchorProvider(provider);
  const before = validateCheckpoint(expected, installationId);
  const target = validateCheckpoint(next, installationId);
  if (target.generation !== before.generation + 1) {
    throw new Error("monotonic_anchor_generation_must_advance_once");
  }
  if (target.sequence < before.sequence) {
    throw new Error("monotonic_anchor_sequence_rollback");
  }
  const current = await inspectMonotonicAnchor(provider, installationId);
  if (current.status !== "protected") {
    throw new Error("monotonic_anchor_not_protected");
  }
  if (current.checkpoint.generation !== before.generation
    || current.checkpoint.sequence !== before.sequence
    || current.checkpoint.eventHash !== before.eventHash
    || current.checkpoint.eventMac !== before.eventMac) {
    throw new Error("monotonic_anchor_compare_failed");
  }
  const result = await anchor.advance(before, target);
  if (!result || result.status !== "protected"
    || result.installationId !== installationId) {
    throw new Error("monotonic_anchor_advance_unconfirmed");
  }
  const confirmed = await inspectMonotonicAnchor(provider, installationId);
  if (confirmed.status !== "protected"
    || confirmed.checkpoint.generation !== target.generation
    || confirmed.checkpoint.sequence !== target.sequence
    || confirmed.checkpoint.eventHash !== target.eventHash
    || confirmed.checkpoint.eventMac !== target.eventMac) {
    throw new Error("monotonic_anchor_advance_mismatch");
  }
  return confirmed;
}

export const monotonicAnchorContract = Object.freeze({
  schemaVersion: 1,
  statuses: Object.freeze([...ANCHOR_STATUSES]),
  requiredCapabilities: Object.freeze([
    "hardwareBacked",
    "rollbackResistant",
    "atomicCompareAndAdvance",
    "durableAcrossRestart"
  ])
});
