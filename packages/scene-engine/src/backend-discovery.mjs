const SOURCE_TYPES = new Set([
  "manual_endpoint",
  "selected_documentation",
  "adapter_catalog",
  "connected_plugin",
  "opt_in_local_discovery"
]);
const AUTH_MODES = new Set(["none", "bearer", "oauth2", "mtls", "host_session", "unknown"]);
const CAPABILITIES = new Set([
  "read_state",
  "read_agents",
  "read_tasks",
  "stream_events",
  "health_check",
  "diagnostics",
  "send_commands"
]);
const EVIDENCE_CODES = new Set([
  "owner_supplied_endpoint",
  "selected_documentation",
  "versioned_catalog_entry",
  "explicitly_connected_plugin",
  "opt_in_local_discovery"
]);
const CANDIDATE_STATUSES = new Set([
  "discovered",
  "reachable",
  "unreachable",
  "authentication_required",
  "incompatible",
  "timed_out",
  "validated"
]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isRecord = value => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const safeIdentifier = value => typeof value === "string" && IDENTIFIER_PATTERN.test(value);
const uniqueStrings = values => [...new Set(values)];

function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every(part => /^\d{1,3}$/.test(part))) return false;
  const numbers = octets.map(Number);
  return numbers.every(part => part >= 0 && part <= 255) && numbers[0] === 127;
}

function safeHttpUrl(value, field, errors, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  if (!nonEmpty(value) || value.length > 2048) {
    errors.push(`${field} must be a non-empty URL of at most 2048 characters.`);
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) errors.push(`${field} must use HTTP or HTTPS.`);
    if (parsed.username || parsed.password) errors.push(`${field} must not contain embedded credentials.`);
    if (parsed.search || parsed.hash) errors.push(`${field} must not contain query strings or fragments.`);
    if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
      errors.push(`${field} must use HTTPS unless the target is loopback.`);
    }
    return parsed.toString();
  } catch {
    errors.push(`${field} must be a valid absolute URL.`);
    return null;
  }
}

const CANDIDATE_FIELDS = new Set([
  "id", "name", "backendType", "sourceType", "sourceReference", "endpoint",
  "auth", "capabilities", "evidence", "observedAt"
]);

/**
 * Normalizes a backend candidate found only through a source explicitly
 * selected or enabled by the owner. This function performs no I/O.
 */
export function normalizeBackendCandidate(candidate) {
  const errors = [];
  if (!isRecord(candidate)) return { valid: false, errors: ["candidate must be a plain object."] };
  for (const field of Object.keys(candidate)) {
    if (!CANDIDATE_FIELDS.has(field)) errors.push(`candidate.${field} is not an accepted field.`);
  }
  if (!safeIdentifier(candidate.id)) errors.push("id must be a bounded opaque identifier.");
  if (!SOURCE_TYPES.has(candidate.sourceType)) errors.push("sourceType is not permitted.");
  if (!safeIdentifier(candidate.sourceReference)) errors.push("sourceReference must be a bounded opaque identifier.");

  const endpoint = candidate.endpoint === undefined
    ? null
    : safeHttpUrl(candidate.endpoint, "endpoint", errors);
  if (candidate.sourceType === "manual_endpoint" && !endpoint) errors.push("manual_endpoint requires endpoint.");

  if (candidate.auth !== undefined && !isRecord(candidate.auth)) {
    errors.push("auth must be a plain object containing only mode.");
  }
  const auth = isRecord(candidate.auth) ? candidate.auth : {};
  for (const field of Object.keys(auth)) {
    if (field !== "mode") errors.push(`auth.${field} is not accepted; credentials must be supplied through a separate secure session.`);
  }
  const authMode = auth.mode ?? "unknown";
  if (!AUTH_MODES.has(authMode)) errors.push("auth.mode is not supported.");

  const capabilities = candidate.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > 16) errors.push("capabilities must be an array of at most 16 entries.");
  else {
    for (const capability of capabilities) {
      if (!CAPABILITIES.has(capability)) errors.push(`unknown capability: ${String(capability)}.`);
    }
    if (new Set(capabilities).size !== capabilities.length) errors.push("capabilities must not contain duplicates.");
  }

  const evidence = candidate.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.length > 16 || evidence.some(item => !EVIDENCE_CODES.has(item))) {
    errors.push("evidence must contain only approved non-secret evidence codes.");
  }
  const observedAt = candidate.observedAt ?? null;
  if (observedAt !== null && (!nonEmpty(observedAt) || observedAt.length > 64 || !Number.isFinite(Date.parse(observedAt)))) {
    errors.push("observedAt must be a valid bounded timestamp.");
  }
  const name = candidate.name ?? candidate.id;
  if (!nonEmpty(name) || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    errors.push("name must be a printable label of at most 120 characters.");
  }
  const backendType = candidate.backendType ?? "unknown";
  if (!safeIdentifier(backendType)) errors.push("backendType must be a bounded opaque identifier.");

  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    candidate: Object.freeze({
      id: candidate.id,
      name: name.trim(),
      backendType,
      sourceType: candidate.sourceType,
      sourceReference: candidate.sourceReference,
      endpoint,
      auth: Object.freeze({ mode: authMode }),
      capabilities: Object.freeze(uniqueStrings(capabilities)),
      evidence: Object.freeze([...evidence]),
      observedAt: observedAt ? new Date(observedAt).toISOString() : null,
      status: "discovered"
    })
  };
}

/**
 * Combines explicit, non-secret validation evidence. A public health response
 * can establish reachability only; it never establishes authentication.
 */
export function assessBackendCandidate(candidate, checks = {}) {
  const normalized = normalizeBackendCandidate(candidate);
  if (!normalized.valid) return { valid: false, errors: normalized.errors };
  if (!isRecord(checks)) return { valid: false, errors: ["checks must be a plain object."] };

  const fields = ["reachability", "authentication", "adapterCompatibility", "snapshot"];
  const allowed = new Set(["not_run", "passed", "failed", "timed_out", "not_applicable"]);
  const errors = [];
  for (const field of Object.keys(checks)) {
    if (!fields.includes(field)) errors.push(`checks.${field} is not a recognized validation result.`);
  }
  for (const field of fields) {
    const result = Object.hasOwn(checks, field) ? checks[field] : "not_run";
    if (!allowed.has(result)) errors.push(`checks.${field} has an invalid value.`);
  }
  if (errors.length) return { valid: false, errors };

  const value = field => Object.hasOwn(checks, field) ? checks[field] : "not_run";
  let status = "discovered";
  if (fields.some(field => value(field) === "timed_out")) status = "timed_out";
  else if (value("reachability") === "failed") status = "unreachable";
  else if (value("authentication") === "failed") status = "authentication_required";
  else if (value("adapterCompatibility") === "failed" || value("snapshot") === "failed") status = "incompatible";
  else if (fields.every(field => value(field) === "passed")) status = "validated";
  else if (value("reachability") === "passed") status = "reachable";

  return {
    valid: true,
    status,
    candidate: Object.freeze({ ...normalized.candidate, status }),
    evidence: Object.freeze(fields.map(field => Object.freeze({
      check: field,
      result: value(field)
    })))
  };
}

export const backendDiscoveryContract = Object.freeze({
  version: 1,
  sourceTypes: Object.freeze([...SOURCE_TYPES]),
  authModes: Object.freeze([...AUTH_MODES]),
  capabilities: Object.freeze([...CAPABILITIES]),
  statuses: Object.freeze([...CANDIDATE_STATUSES]),
  activationRequiresExplicitOwnerSelection: true,
  discoveryExecutesCommands: false,
  discoveryGrantsCapabilities: false,
  capabilitiesAreUntrustedClaims: true,
  initialAdapterMode: "read-only",
  storesCredentials: false,
  networkScanningByDefault: false
});
