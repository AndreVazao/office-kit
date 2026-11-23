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
  sourceReference: "user-entered endpoint",
  endpoint: "http://127.0.0.1:8080",
  auth: { mode: "host_session" },
  capabilities: ["read_state", "read_agents"],
  evidence: ["Endpoint supplied by owner"],
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

test("rejects URLs containing credentials, query strings or fragments", () => {
  for (const endpoint of [
    "https://user:secret@example.test",
    "https://example.test/api?token=secret",
    "https://example.test/api#private"
  ]) assert.equal(normalizeBackendCandidate(candidate({ endpoint })).valid, false);
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

test("authentication failure and timeout remain distinct", () => {
  const auth = assessBackendCandidate(candidate(), { reachability: "passed", authentication: "failed" });
  const timeout = assessBackendCandidate(candidate(), { reachability: "timed_out" });
  assert.equal(auth.status, "authentication_required");
  assert.equal(timeout.status, "timed_out");
});

test("discovery contract never authorizes implicit activation, commands or credential storage", () => {
  assert.equal(backendDiscoveryContract.activationRequiresExplicitOwnerSelection, true);
  assert.equal(backendDiscoveryContract.discoveryExecutesCommands, false);
  assert.equal(backendDiscoveryContract.storesCredentials, false);
  assert.equal(backendDiscoveryContract.networkScanningByDefault, false);
});
