import test from "node:test";
import assert from "node:assert/strict";
import { OfficeHealthRecoveryEngine, InMemoryIncidentStore, officeHealthContract } from "../src/office-health.mjs";

function fixture(overrides = {}) {
  const store = new InMemoryIncidentStore();
  let now = Date.parse("2026-11-09T10:00:00.000Z");
  const engine = new OfficeHealthRecoveryEngine({
    incidentStore: store,
    clock: () => now++,
    probes: [
      { id: "runtime", layer: "office_runtime", run: async () => ({ ok: true }) },
      { id: "adapter", layer: "adapter", run: async () => ({ ok: true }) },
      { id: "transport", layer: "transport", run: async () => ({ ok: true }) },
      { id: "backend", layer: "backend", run: async () => ({ ok: true }) }
    ],
    ...overrides
  });
  return { engine, store };
}

test("healthy diagnosis does not create an incident", async () => {
  const { engine, store } = fixture();
  const report = await engine.diagnose({ edition: "Universal" });
  assert.equal(report.status, "healthy");
  assert.equal(report.origin, "none");
  assert.equal((await store.list()).length, 0);
});

test("attributes a deterministic Office Kit runtime failure with evidence", async () => {
  const { engine, store } = fixture({
    probes: [
      { id: "runtime", layer: "office_runtime", run: async () => ({ ok: false, code: "internal_invariant", evidence: "runtime invariant failed" }) },
      { id: "backend", layer: "backend", run: async () => ({ ok: true }) }
    ]
  });
  const report = await engine.diagnose({ edition: "Universal", adapterId: "demo" });
  assert.equal(report.origin, "office_runtime");
  assert.equal(report.confidence, "probable");
  const [incident] = await store.list();
  assert.equal(incident.adapterId, "demo");
  assert.equal(incident.outcome, "unresolved");
});

test("timeout and thrown probe errors remain indeterminate rather than assigning blame", async () => {
  const { engine } = fixture({
    probes: [{ id: "transport", layer: "transport", run: async () => ({ ok: false, code: "timeout", evidence: "request timed out" }) }]
  });
  const report = await engine.diagnose();
  assert.equal(report.origin, "indeterminate");
  assert.equal(report.confidence, "indeterminate");
});

test("secret-like evidence is redacted before persistence or export", async () => {
  const { engine, store } = fixture({
    probes: [{ id: "backend", layer: "backend", run: async () => ({ ok: false, code: "backend_error", evidence: "Bearer abc.def token=secret-value" }) }]
  });
  await engine.diagnose();
  const exported = await store.export();
  assert.equal(exported.includes("abc.def"), false);
  assert.equal(exported.includes("secret-value"), false);
  assert.match(exported, /REDACTED/);
});

test("recovery is limited to local scopes and requires a fresh consistent snapshot", async () => {
  const calls = [];
  const { engine, store } = fixture({
    probes: [{ id: "backend", layer: "backend", run: async () => ({ ok: false, code: "backend_unavailable", evidence: "backend unavailable" }) }],
    recoveryActions: [
      { id: "restart-adapter", scope: "local_adapter", run: async () => { calls.push("adapter"); return { ok: true }; } },
      { id: "renew-session", scope: "local_session", run: async () => { calls.push("session"); return { ok: true }; } }
    ]
  });
  await engine.diagnose({ edition: "Universal", adapterId: "demo" });
  const failed = await engine.attemptRecovery({ verifyFreshSnapshot: async () => ({ ok: true, fresh: false, consistent: true }) });
  assert.equal(failed.recovered, false);
  assert.deepEqual(calls, ["adapter", "session"]);
  const passed = await engine.attemptRecovery({ verifyFreshSnapshot: async () => ({ ok: true, fresh: true, consistent: true }) });
  assert.equal(passed.status, "recovered");
  const incidents = await store.list();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].recoveryAttempts.length, 2);
  assert.equal(incidents[0].outcome, "recovered");
});

test("rejects external backend write or service restart recovery scopes", () => {
  assert.throws(() => fixture({
    recoveryActions: [{ id: "write-backend", scope: "backend_write", run: async () => ({ ok: true }) }]
  }), /local, scoped/);
});

test("incident store returns isolated copies and supports portable JSON export", async () => {
  const store = new InMemoryIncidentStore();
  await store.append({ id: "i-1", nested: { status: "open" } });
  const copy = await store.list();
  copy[0].nested.status = "tampered";
  assert.equal((await store.list())[0].nested.status, "open");
  assert.equal(JSON.parse(await store.export()).incidents.length, 1);
  assert.ok(officeHealthContract.layers.includes("backend"));
});
