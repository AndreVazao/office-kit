const ORG_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NODE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const SHA256_FINGERPRINT = /^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/i;
const TRANSPORT_KINDS = new Set(["lan", "tailscale", "https-rendezvous", "relay"]);
const DISCOVERY_SOURCES = new Set(["lan-mdns", "tailscale", "organization-directory"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isoTime(value, label) {
  if (!nonEmptyString(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid ISO timestamp.`);
  }
  return new Date(value).toISOString();
}

/**
 * Validate the public, renderer-neutral identity advertised by one Office Kit node.
 * A node name or organization slug is never an authentication credential.
 */
export function validateNodeDescriptor(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("node_descriptor_must_be_an_object");
  }
  if (!ORG_ID.test(input.organizationId ?? "")) throw new TypeError("invalid_organization_id");
  if (!NODE_ID.test(input.nodeId ?? "")) throw new TypeError("invalid_node_id");
  if (!SHA256_FINGERPRINT.test(input.identityFingerprint ?? "")) {
    throw new TypeError("invalid_identity_fingerprint");
  }
  if (!Number.isSafeInteger(input.protocolVersion) || input.protocolVersion < 1) {
    throw new TypeError("invalid_protocol_version");
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.some(value => !nonEmptyString(value))) {
    throw new TypeError("invalid_node_capabilities");
  }
  if (new Set(input.capabilities).size !== input.capabilities.length) {
    throw new TypeError("duplicate_node_capability");
  }
  return Object.freeze({
    organizationId: input.organizationId,
    nodeId: input.nodeId,
    identityFingerprint: input.identityFingerprint.toLowerCase(),
    protocolVersion: input.protocolVersion,
    capabilities: Object.freeze([...input.capabilities].sort())
  });
}

/** Validate a transport hint. Hints aid connection attempts but never grant trust. */
export function validateTransportHint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("transport_hint_must_be_an_object");
  }
  if (!TRANSPORT_KINDS.has(input.kind)) throw new TypeError("unsupported_transport_kind");
  if (!nonEmptyString(input.address)) throw new TypeError("transport_address_required");
  if (input.kind === "https-rendezvous" || input.kind === "relay") {
    let parsed;
    try { parsed = new URL(input.address); } catch { throw new TypeError("transport_address_invalid"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new TypeError("secure_https_transport_required");
    }
  }
  if (input.kind === "tailscale" && !/^[a-z0-9.-]+$/i.test(input.address)) {
    throw new TypeError("invalid_tailscale_device_name");
  }
  if (input.kind === "lan" && /[\s/@]/.test(input.address)) {
    throw new TypeError("invalid_lan_service_name");
  }
  return Object.freeze({ kind: input.kind, address: input.address });
}

/**
 * A discovery lease is short-lived metadata, not a session or authorization grant.
 * Callers must verify the node's cryptographic proof and obtain owner approval.
 */
export function validateDiscoveryLease(input, { now = Date.now(), maxLeaseMs = 120_000 } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("discovery_lease_must_be_an_object");
  }
  if (!DISCOVERY_SOURCES.has(input.source)) throw new TypeError("invalid_discovery_source");
  const node = validateNodeDescriptor(input.node);
  const observedAt = isoTime(input.observedAt, "observedAt");
  const expiresAt = isoTime(input.expiresAt, "expiresAt");
  const observed = Date.parse(observedAt);
  const expires = Date.parse(expiresAt);
  if (expires <= observed || expires - observed > maxLeaseMs) {
    throw new TypeError("invalid_discovery_lease_duration");
  }
  if (expires <= now) throw new TypeError("discovery_lease_expired");
  if (!Array.isArray(input.transports) || input.transports.length === 0) {
    throw new TypeError("discovery_lease_requires_transport_hints");
  }
  const transports = input.transports.map(validateTransportHint);
  const unique = new Set(transports.map(item => `${item.kind}:${item.address}`));
  if (unique.size !== transports.length) throw new TypeError("duplicate_transport_hint");
  return Object.freeze({
    source: input.source,
    node,
    observedAt,
    expiresAt,
    transports: Object.freeze(transports)
  });
}

export function isDiscoveryLeaseFresh(lease, now = Date.now()) {
  if (!lease || typeof lease.expiresAt !== "string") return false;
  const expiry = Date.parse(lease.expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

/** Versioned organization event envelope; sequence is scoped to one node session. */
export function validateFederationEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("federation_envelope_must_be_an_object");
  }
  if (input.schemaVersion !== 1) throw new TypeError("unsupported_federation_schema");
  const node = validateNodeDescriptor(input.node);
  if (!nonEmptyString(input.sessionId)) throw new TypeError("session_id_required");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new TypeError("invalid_event_sequence");
  }
  if (!nonEmptyString(input.eventType)) throw new TypeError("event_type_required");
  const timestamp = isoTime(input.timestamp, "timestamp");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new TypeError("event_payload_must_be_an_object");
  }
  return Object.freeze({
    schemaVersion: 1,
    node,
    sessionId: input.sessionId,
    sequence: input.sequence,
    eventType: input.eventType,
    timestamp,
    payload: Object.freeze({ ...input.payload })
  });
}

/**
 * Provider contracts are intentionally abstract. Concrete providers own their
 * I/O and credentials; the Office Kit core never performs implicit network I/O.
 */
export class DiscoveryProvider {
  async discover() { throw new Error("discovery_provider_not_implemented"); }
  async close() {}
}

export class PrivateTransportProvider {
  async connect(_hint, _options = {}) { throw new Error("transport_provider_not_implemented"); }
  async disconnect(_connection) { throw new Error("transport_provider_not_implemented"); }
}

export class OrganizationDirectoryProvider {
  async publishPresence(_descriptor, _options = {}) { throw new Error("directory_provider_not_implemented"); }
  async discoverOrganization(_organizationId, _options = {}) {
    throw new Error("directory_provider_not_implemented");
  }
  async withdrawPresence(_leaseId) { throw new Error("directory_provider_not_implemented"); }
}
