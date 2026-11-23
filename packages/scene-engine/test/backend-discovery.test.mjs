import test from "node:test";
import assert from "node:assert/strict";
import {
  assessBackendCandidate,
  backendDiscoveryContract,
  normalizeBackendCandidate
} from "../src/backend-discovery.mjs";

const candidate = (overrides = {}) => ({
  id: "local.example",
  name: "Example backend",
  backendType: "unknown",
  sourceType: "manual_endpoint",
  sourceReference: "manual-entry-1",
  endpoint: "http://127.0.0.1:8080",
  auth: { mode: "host_session" },
  capabilities: ["read_state", "read_agents"],
  evidence: ["owner_supplied_endpoint"],
  observedAt: "2026-11-23T09:00:00.000Z",
  ...overrides
});

test("normalizes a backend candidate from an explicitly supplied endpoint", () => {
  const result = normalizeBackendCandidate(candidate());
  assert.equal(result.valid, true);
  assert.equal(result.candidate.status, "discovered");
  assert.equal(result.candidate.auth.mode, "host_session");
});

test("rejects unapproved discovery sources and malformed capabilities", () => {
  assert.equal(normalizeBackendCandidate(candidate({ sourceType: "network_scan" })).valid, false);
  assert.equal(normalizeBackendCandidate(candidate({ capabilities: ["execute_anything"] })).valid, false);
});

test("rejects URLs containing credentials, query strings, fragments and unsupported schemes", () => {
  for (const endpoint of [
    "https://user:secret@example.test",
    "https://example.test/api?token=secret",
    "https://example.test/api#private",
    "ws://127.0.0.1:8080",
    "wss://example.test/socket",
    "http://example.test/api"
  ]) assert.equal(normalizeBackendCandidate(candidate({ endpoint })).valid, false);
});

test("allows local loopback HTTP and remote HTTPS only", () => {
  for (const endpoint of [
    "http://127.0.0.1:8080",
    "http://127.20.30.40:8080",
    "http://localhost:8080",
    "http://[::1]:8080",
    "https://backend.example/api"
  ]) assert.equal(normalizeBackendCandidate(candidate({ endpoint })).valid, true);
});

test("rejects credential-bearing and unbounded candidate fields", () => {
  assert.equal(normalizeBackendCandidate(candidate({ token: "secret" })).valid, false);
  assert.equal(normalizeBackendCandidate(candidate({ auth: { mode: "bearer", token: "secret" } })).valid, false);
  assert.equal(normalizeBackendCandidate(candidate({ sourceReference: "https://host/path?token=secret" })).valid, false);
  assert.equal(normalizeBackendCandidate(candidate({ evidence: ["Authorization: Bearer secret"] })).valid, false);
});

test("public reachability does not establish authentication or compatibility", () => {
  const result = assessBackendCandidate(candidate(), {
    reachability: "passed",
    authentication: "not_run",
    adapterCompatibility: "not_run",
    snapshot: "not_run"
  });
  assert.equal(result.status, "reachable");
  assert.notEqual(result.status, "validated");
});

test("candidate is validated only after all independent checks pass", () => {
  const result = assessBackendCandidate(candidate(), {
    reachability: "passed",
    authentication: "passed",
    adapterCompatibility: "passed",
    snapshot: "passed"
  });
  assert.equal(result.status, "validated");
});

test("authentication failure, incompatibility and timeout remain distinct", () => {
  const auth = assessBackendCandidate(candidate(), { reachability: "passed", authentication: "failed" });
  const snapshot = assessBackendCandidate(candidate(), { reachability: "passed", snapshot: "failed" });
  const timeout = assessBackendCandidate(candidate(), { reachability: "passed", authentication: "timed_out" });
  const unreachable = assessBackendCandidate(candidate(), { reachability: "failed" });
  assert.equal(auth.status, "authentication_required");
  assert.equal(snapshot.status, "incompatible");
  assert.equal(timeout.status, "timed_out");
  assert.equal(unreachable.status, "unreachable");
});

test("invalid and unknown check inputs are rejected without throwing", () => {
  assert.equal(assessBackendCandidate(candidate(), null).valid, false);
  assert.equal(assessBackendCandidate(candidate(), []).valid, false);
  assert.equal(assessBackendCandidate(candidate(), { reachabilty: "passed" }).valid, false);
});

test("discovery contract never grants commands, credentials or implicit activation", () => {
  assert.equal(backendDiscoveryContract.activationRequiresExplicitOwnerSelection, true);
  assert.equal(backendDiscoveryContract.discoveryExecutesCommands, false);
  assert.equal(backendDiscoveryContract.discoveryGrantsCapabilities, false);
  assert.equal(backendDiscoveryContract.capabilitiesAreUntrustedClaims, true);
  assert.equal(backendDiscoveryContract.initialAdapterMode, "read-only");
  assert.equal(backendDiscoveryContract.storesCredentials, false);
  assert.equal(backendDiscoveryContract.networkScanningByDefault, false);
  assert.ok(backendDiscoveryContract.capabilities.includes("send_commands"));
});
