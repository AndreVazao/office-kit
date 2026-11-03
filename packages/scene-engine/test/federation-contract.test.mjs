import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscoveryProvider,
  OrganizationDirectoryProvider,
  PrivateTransportProvider,
  isDiscoveryLeaseFresh,
  validateDiscoveryLease,
  validateFederationEnvelope,
  validateNodeDescriptor,
  validateTransportHint
} from "../src/federation-contract.mjs";

const node = {
  organizationId: "andre-office",
  nodeId: "node:desktop-001",
  identityFingerprint: Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join(":"),
  protocolVersion: 1,
  capabilities: ["read_office_state", "read_departments"]
};
const now = Date.parse("2026-11-03T12:00:00.000Z");

test("node descriptor validates and normalizes public identity metadata", () => {
  const result = validateNodeDescriptor({ ...node, capabilities: [...node.capabilities].reverse() });
  assert.equal(result.organizationId, "andre-office");
  assert.deepEqual(result.capabilities, ["read_departments", "read_office_state"]);
  assert.equal(Object.isFrozen(result), true);
});

test("node descriptor rejects malformed identity and duplicate capabilities", () => {
  assert.throws(() => validateNodeDescriptor({ ...node, organizationId: "../other" }), /invalid_organization_id/);
  assert.throws(() => validateNodeDescriptor({ ...node, identityFingerprint: "not-a-key" }), /invalid_identity_fingerprint/);
  assert.throws(() => validateNodeDescriptor({ ...node, capabilities: ["read", "read"] }), /duplicate_node_capability/);
});

test("transport hints enforce secure remote URLs and provider-specific addresses", () => {
  assert.throws(() => validateTransportHint({ kind: "relay", address: "http://relay.example" }), /secure_https_transport_required/);
  assert.throws(() => validateTransportHint({ kind: "tailscale", address: "not a device" }), /invalid_tailscale_device_name/);
  assert.equal(validateTransportHint({ kind: "lan", address: "_officekit._tcp.local" }).kind, "lan");
});

test("discovery lease is bounded, fresh and never treated as authorization", () => {
  const lease = validateDiscoveryLease({
    source: "lan-mdns",
    node,
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    transports: [{ kind: "lan", address: "officekit-node.local" }]
  }, { now });
  assert.equal(isDiscoveryLeaseFresh(lease, now + 29_999), true);
  assert.equal(isDiscoveryLeaseFresh(lease, now + 30_000), false);
  assert.equal("authorized" in lease, false);
});

test("discovery rejects expired, overlong and duplicate leases", () => {
  const base = {
    source: "organization-directory",
    node,
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    transports: [{ kind: "tailscale", address: "desktop.example.ts.net" }]
  };
  assert.throws(() => validateDiscoveryLease({ ...base, expiresAt: new Date(now - 1).toISOString() }, { now }), /invalid_discovery_lease_duration|discovery_lease_expired/);
  assert.throws(() => validateDiscoveryLease({ ...base, expiresAt: new Date(now + 121_000).toISOString() }, { now }), /invalid_discovery_lease_duration/);
  assert.throws(() => validateDiscoveryLease({ ...base, transports: [...base.transports, ...base.transports] }, { now }), /duplicate_transport_hint/);
});

test("federation envelope validates schema, identity and monotonic sequence shape", () => {
  const envelope = validateFederationEnvelope({
    schemaVersion: 1,
    node,
    sessionId: "session-001",
    sequence: 1,
    eventType: "office.snapshot",
    timestamp: new Date(now).toISOString(),
    payload: { departments: [] }
  });
  assert.equal(envelope.sequence, 1);
  assert.throws(() => validateFederationEnvelope({ ...envelope, sequence: 0 }), /invalid_event_sequence/);
  assert.throws(() => validateFederationEnvelope({ ...envelope, schemaVersion: 2 }), /unsupported_federation_schema/);
});

test("provider base contracts fail explicitly until concrete providers exist", async () => {
  assert.rejects(() => new DiscoveryProvider().discover(), /discovery_provider_not_implemented/);
  assert.rejects(() => new PrivateTransportProvider().connect({}), /transport_provider_not_implemented/);
  assert.rejects(() => new OrganizationDirectoryProvider().publishPresence(node), /directory_provider_not_implemented/);
});
