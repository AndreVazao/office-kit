import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceMonotonicAnchor,
  inspectMonotonicAnchor,
  monotonicAnchorContract,
  validateMonotonicAnchorProvider
} from "../src/monotonic-anchor.mjs";

const installationId = "officekit-anchor-test-001";
const hash = value => value.repeat(64);

function checkpoint(generation, sequence, marker) {
  return {
    installationId,
    generation,
    sequence,
    eventHash: sequence === 0 ? null : hash(marker),
    eventMac: sequence === 0 ? null : hash(marker.toUpperCase()),
    protocolVersion: 1
  };
}

function providerFixture({ capabilities, initial = checkpoint(0, 0, "a") } = {}) {
  let state = {
    status: "protected",
    installationId,
    anchorId: "test-anchor-001",
    checkpoint: initial
  };
  const provider = {
    capabilities: async () => capabilities ?? {
      hardwareBacked: true,
      rollbackResistant: true,
      atomicCompareAndAdvance: true,
      durableAcrossRestart: true,
      scope: "test-only-fake"
    },
    read: async () => structuredClone(state),
    advance: async (expected, next) => {
      if (state.checkpoint.generation !== expected.generation
        || state.checkpoint.eventHash !== expected.eventHash) {
        throw new Error("compare_failed");
      }
      state = { ...state, checkpoint: structuredClone(next) };
      return { status: "protected", installationId };
    }
  };
  return { provider, read: () => structuredClone(state) };
}

test("declares the explicit anchor state machine and required guarantees", () => {
  assert.deepEqual(monotonicAnchorContract.statuses.sort(), [
    "mismatch", "protected", "recovery_required", "unavailable",
    "unprovisioned", "unsupported"
  ]);
  assert.equal(monotonicAnchorContract.schemaVersion, 1);
});

test("rejects incomplete provider contracts", () => {
  assert.throws(() => validateMonotonicAnchorProvider({ read() {} }), /provider_invalid/);
});

test("does not accept a software-only provider as rollback protection", async () => {
  const fixture = providerFixture({
    capabilities: {
      hardwareBacked: false,
      rollbackResistant: false,
      atomicCompareAndAdvance: true,
      durableAcrossRestart: true,
      scope: "local-software"
    }
  });
  await assert.rejects(
    inspectMonotonicAnchor(fixture.provider, installationId),
    /protection_claim_invalid/
  );
});

test("reports unsupported without promoting local storage to protected", async () => {
  const fixture = providerFixture();
  fixture.provider.read = async () => ({ status: "unsupported" });
  const result = await inspectMonotonicAnchor(fixture.provider, installationId);
  assert.equal(result.status, "unsupported");
  assert.equal(result.rollbackProtection, "unsupported");
});

test("requires the installation identity and a valid checkpoint", async () => {
  const fixture = providerFixture();
  await assert.rejects(
    inspectMonotonicAnchor(fixture.provider, "other-installation-001"),
    /protection_claim_invalid/
  );
});

test("advances exactly one generation and verifies the persisted checkpoint", async () => {
  const fixture = providerFixture();
  const next = checkpoint(1, 1, "b");
  const result = await advanceMonotonicAnchor(fixture.provider, {
    installationId,
    expected: checkpoint(0, 0, "a"),
    next
  });
  assert.equal(result.status, "protected");
  assert.deepEqual(result.checkpoint, next);
  assert.deepEqual(fixture.read().checkpoint, next);
});

test("rejects generation skips and sequence rollback", async () => {
  const fixture = providerFixture();
  await assert.rejects(
    advanceMonotonicAnchor(fixture.provider, {
      installationId,
      expected: checkpoint(0, 0, "a"),
      next: checkpoint(2, 1, "b")
    }),
    /generation_must_advance_once/
  );
  await assert.rejects(
    advanceMonotonicAnchor(fixture.provider, {
      installationId,
      expected: checkpoint(0, 0, "a"),
      next: checkpoint(1, 0, "a")
    }),
    /checkpoint_invalid/
  );
});

test("rejects compare-and-advance from a stale checkpoint", async () => {
  const fixture = providerFixture({ initial: checkpoint(3, 7, "d") });
  await assert.rejects(
    advanceMonotonicAnchor(fixture.provider, {
      installationId,
      expected: checkpoint(2, 6, "c"),
      next: checkpoint(3, 7, "d")
    }),
    /compare_failed/
  );
});

test("rejects an advance that the provider does not persist", async () => {
  const fixture = providerFixture();
  fixture.provider.advance = async () => ({ status: "protected", installationId });
  await assert.rejects(
    advanceMonotonicAnchor(fixture.provider, {
      installationId,
      expected: checkpoint(0, 0, "a"),
      next: checkpoint(1, 1, "b")
    }),
    /advance_mismatch/
  );
});
