import test from "node:test";
import assert from "node:assert/strict";
import { adapterContract, normalizeAdapterEvent, validateAdapter } from "../src/adapter-contract.mjs";

const now = Date.parse("2026-11-02T12:00:00.000Z");
const validAdapter = {
  apiVersion: 1,
  metadata: { id: "example.adapter", name: "Example Adapter", version: "1.0.0" },
  capabilities: ["read_state"],
  connect() {},
  disconnect() {},
  getSnapshot() { return null; },
  subscribe() { return () => {}; }
};
const makeEvent = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: "adapter-instance",
  sessionId: "session-1",
  sequence: 1,
  type: "snapshot",
  timestamp: new Date(now).toISOString(),
  payload: { snapshotId: "s-1" },
  ...overrides
});

test("public adapter contract accepts a minimal read-only adapter", () => {
  const result = validateAdapter(validAdapter);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(adapterContract.defaultCapabilities, ["read_state"]);
});

test("adapter contract rejects missing methods, unknown capabilities and unsafe command declaration", () => {
  const result = validateAdapter({
    ...validAdapter,
    capabilities: ["send_commands", "unlisted"],
    subscribe: undefined
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("subscribe()")));
  assert.ok(result.errors.some(error => error.includes("unknown capability")));
  assert.ok(result.errors.some(error => error.includes("requires read_state")));
});

test("event envelope accepts a fresh event with the next sequence", () => {
  const result = normalizeAdapterEvent(makeEvent(), { lastSequence: 0, now });
  assert.equal(result.valid, true);
  assert.equal(result.accepted, true);
  assert.equal(result.event.sequence, 1);
  assert.equal(result.event.timestamp, new Date(now).toISOString());
});

test("duplicate and out-of-order events are rejected without treating them as malformed", () => {
  for (const sequence of [4, 3]) {
    const result = normalizeAdapterEvent(makeEvent({ sequence }), { lastSequence: 4, now });
    assert.equal(result.valid, true);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "duplicate_or_out_of_order");
  }
});

test("stale and future-dated events are rejected", () => {
  const stale = normalizeAdapterEvent(makeEvent({ timestamp: new Date(now - 31_000).toISOString() }), { now });
  const future = normalizeAdapterEvent(makeEvent({ timestamp: new Date(now + 1_000).toISOString() }), { now });
  assert.equal(stale.reason, "stale_or_future_event");
  assert.equal(future.reason, "stale_or_future_event");
});

test("malformed event envelopes fail closed", () => {
  const result = normalizeAdapterEvent(makeEvent({ sourceId: "", sequence: 0, type: "command" }), { now });
  assert.equal(result.valid, false);
  assert.equal(result.accepted, false);
  assert.ok(result.errors.length >= 3);
});

test("numeric timestamps are treated as epoch milliseconds", () => {
  const result = normalizeAdapterEvent(makeEvent({ timestamp: now }), { now });
  assert.equal(result.accepted, true);
  assert.equal(result.event.timestamp, new Date(now).toISOString());
});
