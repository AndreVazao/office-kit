import test from "node:test";
import assert from "node:assert/strict";
import { OfficeHealthRecoveryEngine, OfficeConnectionSupervisor, InMemoryIncidentStore, officeHealthContract } from "../src/office-health.mjs";

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

test("secret-like diagnostic codes are normalized before incident persistence", async () => {
  const { engine, store } = fixture({
    probes: [{ id: "backend", layer: "backend", run: async () => ({
      ok: false,
      code: "api_key=secret-value",
      evidence: "backend unavailable"
    }) }]
  });
  await engine.diagnose();
  const exported = await store.export();
  assert.equal(exported.includes("secret-value"), false);
  assert.equal(exported.includes("api_key="), false);
  assert.match(exported, /probe_failed/);
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
  assert.equal(incidents[0].recoveryAttempts.length, 4);
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

test("diagnostic probes and local recovery actions are bounded by deadlines", async () => {
  const store = new InMemoryIncidentStore();
  const engine = new OfficeHealthRecoveryEngine({
    incidentStore: store,
    probeTimeoutMs: 10,
    recoveryTimeoutMs: 10,
    probes: [{
      id: "transport-hangs",
      layer: "transport",
      run: async () => new Promise(() => {})
    }],
    recoveryActions: [{
      id: "local-reconnect-hangs",
      scope: "local_session",
      run: async () => new Promise(() => {})
    }]
  });
  const report = await engine.diagnose();
  assert.equal(report.status, "degraded");
  assert.equal(report.origin, "indeterminate");
  assert.equal(report.results[0].code, "timeout");
  const recovery = await engine.attemptRecovery({
    verifyFreshSnapshot: async () => new Promise(() => {})
  });
  assert.equal(recovery.recovered, false);
  assert.equal(recovery.attempts[0].code, "timeout");
  assert.equal(recovery.verification.code, "fresh_snapshot_verification_timeout");
});

test("rejects unsafe diagnostic and recovery timeout configuration", () => {
  const store = new InMemoryIncidentStore();
  const probes = [{ id: "runtime", layer: "office_runtime", run: async () => ({ ok: true }) }];
  assert.throws(() => new OfficeHealthRecoveryEngine({ incidentStore: store, probes, probeTimeoutMs: 0 }), /probe_timeout_out_of_range/);
  assert.throws(() => new OfficeHealthRecoveryEngine({ incidentStore: store, probes, recoveryTimeoutMs: 90_000 }), /recovery_timeout_out_of_range/);
});


test("connection supervisor records one outage from a previously live session and closes only after verified recovery", async () => {
  const { engine, store } = fixture();
  const supervisor = new OfficeConnectionSupervisor({ healthEngine: engine });
  const live = {
    connectionState: "live",
    authoritativeStateVerified: true,
    lastHeartbeatAt: "2026-11-10T10:00:00.000Z"
  };
  const initial = await supervisor.observe(live, { edition: "Universal", adapterId: "demo" });
  assert.equal(initial.transition, "healthy");
  assert.equal((await store.list()).length, 0);

  const lost = await supervisor.observe({
    connectionState: "stale",
    authoritativeStateVerified: false,
    reason: "heartbeat_timeout"
  }, { edition: "Universal", adapterId: "demo" });
  assert.equal(lost.transition, "connection_lost");
  assert.equal(lost.diagnostics.origin, "transport");
  assert.equal(lost.diagnostics.confidence, "probable");
  assert.ok(lost.diagnostics.incidentId);

  const repeated = await supervisor.observe({
    connectionState: "error",
    authoritativeStateVerified: false,
    reason: "transport_error"
  });
  assert.equal(repeated.transition, "outage_ongoing");
  assert.equal((await store.list()).length, 1);

  const recovered = await supervisor.observe({
    connectionState: "live",
    authoritativeStateVerified: true,
    lastHeartbeatAt: "2026-11-10T10:01:00.000Z"
  }, { edition: "Universal", adapterId: "demo" });
  assert.equal(recovered.transition, "recovered");
  const [incident] = await store.list();
  assert.equal(incident.outcome, "recovered");
  assert.equal(incident.resolution, "fresh_authoritative_snapshot_and_all_diagnostic_probes_passed");
  assert.ok(incident.resolvedAt);
  assert.equal(supervisor.getState().outageOpen, false);
});

test("connection supervisor does not attribute initial startup failures to a backend outage", async () => {
  const { engine, store } = fixture();
  const supervisor = new OfficeConnectionSupervisor({ healthEngine: engine });
  const result = await supervisor.observe({
    connectionState: "connecting",
    authoritativeStateVerified: false,
    reason: "connection_attempt"
  });
  assert.equal(result.transition, "not_yet_established");
  assert.equal((await store.list()).length, 0);
});


test("opaque secret-like diagnostic codes are rejected in probe and session evidence", async () => {
  const secretLikeCodes = [
    ["sk", "live", "x".repeat(28)].join("_"),
    "a".repeat(32),
    ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "signaturepayloadlong"].join(".")
  ];
  for (const code of secretLikeCodes) {
    const { engine, store } = fixture({
      probes: [{ id: "backend", layer: "backend", run: async () => ({
        ok: false, code, evidence: "backend unavailable"
      }) }]
    });
    await engine.diagnose();
    const [incident] = await store.list();
    assert.equal(incident.diagnostics[0].code, "probe_failed");
    assert.equal((await store.export()).includes(code), false);

    const sessionFixture = fixture();
    await sessionFixture.engine.diagnose({ connectionState: "stale", sessionReason: code });
    const [sessionIncident] = await sessionFixture.store.list();
    const transition = sessionIncident.diagnostics.find(item => item.probeId === "runtime-session-transition");
    assert.equal(transition.code, "connection_lost");
    assert.equal((await sessionFixture.store.export()).includes(code), false);
  }
});

test("failed incident append does not poison the next diagnosis attempt", async () => {
  const memory = new InMemoryIncidentStore();
  let rejectFirstAppend = true;
  const incidentStore = {
    append: async incident => {
      if (rejectFirstAppend) {
        rejectFirstAppend = false;
        throw new Error("incident_store_unavailable");
      }
      return memory.append(incident);
    },
    update: (...args) => memory.update(...args)
  };
  const engine = new OfficeHealthRecoveryEngine({
    incidentStore,
    probes: [{ id: "backend", layer: "backend", run: async () => ({
      ok: false, code: "backend_unavailable", evidence: "backend unavailable"
    }) }]
  });
  await assert.rejects(engine.diagnose(), /incident_store_unavailable/);
  const retry = await engine.diagnose();
  assert.ok(retry.incidentId);
  assert.equal((await memory.list()).length, 1);
});

test("connection supervisor serializes rapid outage and recovery observations", async () => {
  let firstProbe = true;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let releaseProbe;
  const gate = new Promise(resolve => { releaseProbe = resolve; });
  const { engine, store } = fixture({
    probes: [
      { id: "runtime", layer: "office_runtime", run: async () => {
        if (firstProbe) {
          firstProbe = false;
          signalStarted();
          await gate;
        }
        return { ok: true };
      } },
      { id: "adapter", layer: "adapter", run: async () => ({ ok: true }) },
      { id: "transport", layer: "transport", run: async () => ({ ok: true }) },
      { id: "backend", layer: "backend", run: async () => ({ ok: true }) }
    ]
  });
  const supervisor = new OfficeConnectionSupervisor({ healthEngine: engine });
  const live = {
    connectionState: "live",
    authoritativeStateVerified: true,
    lastHeartbeatAt: "2026-11-10T10:00:00.000Z"
  };
  await supervisor.observe(live);
  const outage = supervisor.observe({
    connectionState: "stale",
    authoritativeStateVerified: false,
    reason: "heartbeat_timeout"
  });
  await started;
  const recovery = supervisor.observe({
    connectionState: "live",
    authoritativeStateVerified: true,
    lastHeartbeatAt: "2026-11-10T10:01:00.000Z"
  });
  releaseProbe();
  const [lost, recovered] = await Promise.all([outage, recovery]);
  assert.equal(lost.transition, "connection_lost");
  assert.equal(recovered.transition, "recovered");
  const incidents = await store.list();
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].outcome, "recovered");
});
