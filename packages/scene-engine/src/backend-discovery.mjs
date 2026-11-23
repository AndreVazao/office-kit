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
const CANDIDATE_STATUSES = new Set([
  "discovered",
  "reachable",
  "authentication_required",
  "incompatible",
  "timed_out",
  "validated"
]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const uniqueStrings = values => [...new Set(values)];

function safeHttpUrl(value, field, errors, { optional = false } = {}) {
  if (value === undefined && optional) return null;
  if (!nonEmpty(value)) {
    errors.push(`${field} must be a non-empty URL.`);
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) errors.push(`${field} uses an unsupported protocol.`);
    if (parsed.username || parsed.password) errors.push(`${field} must not contain embedded credentials.`);
    if (parsed.search || parsed.hash) errors.push(`${field} must not contain query strings or fragments.`);
    return parsed.toString();
  } catch {
    errors.push(`${field} must be a valid absolute URL.`);
    return null;
  }
}

/**
 * Normalizes a backend candidate found only through a source explicitly
 * selected or enabled by the owner. This function performs no I/O.
 */
export function normalizeBackendCandidate(candidate) {
  const errors = [];
  if (!isRecord(candidate)) return { valid: false, errors: ["candidate must be an object."] };
  if (!nonEmpty(candidate.id)) errors.push("id is required.");
  if (!SOURCE_TYPES.has(candidate.sourceType)) errors.push("sourceType is not permitted.");
  if (!nonEmpty(candidate.sourceReference)) errors.push("sourceReference is required.");
  const endpoint = candidate.endpoint === undefined
    ? null
    : safeHttpUrl(candidate.endpoint, "endpoint", errors);
  if (candidate.sourceType === "manual_endpoint" && !endpoint) errors.push("manual_endpoint requires endpoint.");
  const authMode = candidate.auth?.mode ?? "unknown";
  if (!AUTH_MODES.has(authMode)) errors.push("auth.mode is not supported.");
  const capabilities = candidate.capabilities ?? [];
  if (!Array.isArray(capabilities)) errors.push("capabilities must be an array.");
  else {
    for (const capability of capabilities) {
      if (!CAPABILITIES.has(capability)) errors.push(`unknown capability: ${String(capability)}.`);
    }
    if (new Set(capabilities).size !== capabilities.length) errors.push("capabilities must not contain duplicates.");
  }
  const evidence = candidate.evidence ?? [];
  if (!Array.isArray(evidence) || evidence.some(item => !nonEmpty(item))) errors.push("evidence must be an array of non-empty strings.");
  const observedAt = candidate.observedAt ?? null;
  if (observedAt !== null && (!nonEmpty(observedAt) || !Number.isFinite(Date.parse(observedAt)))) {
    errors.push("observedAt must be a valid timestamp.");
  }
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    errors: [],
    candidate: Object.freeze({
      id: candidate.id.trim(),
      name: nonEmpty(candidate.name) ? candidate.name.trim() : candidate.id.trim(),
      backendType: nonEmpty(candidate.backendType) ? candidate.backendType.trim() : "unknown",
      sourceType: candidate.sourceType,
      sourceReference: candidate.sourceReference.trim(),
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
  const allowed = new Set(["not_run", "passed", "failed", "timed_out", "not_applicable"]);
  const fields = ["reachability", "authentication", "adapterCompatibility", "snapshot"];
  const errors = [];
  for (const field of fields) {
    const value = checks[field] ?? "not_run";
    if (!allowed.has(value)) errors.push(`checks.${field} has an invalid value.`);
  }
  if (errors.length) return { valid: false, errors };
  const value = field => checks[field] ?? "not_run";
  let status = "discovered";
  if (value("reachability") === "timed_out") status = "timed_out";
  else if (value("reachability") === "failed" || value("adapterCompatibility") === "failed") status = "incompatible";
  else if (value("authentication") === "failed") status = "authentication_required";
  else if (value("reachability") === "passed") status = "reachable";
  if (
    value("reachability") === "passed" &&
    value("authentication") === "passed" &&
    value("adapterCompatibility") === "passed" &&
    value("snapshot") === "passed"
  ) status = "validated";
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
  storesCredentials: false,
  networkScanningByDefault: false
});
