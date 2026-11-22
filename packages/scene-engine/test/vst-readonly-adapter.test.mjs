import test from "node:test";
import assert from "node:assert/strict";
import { VstReadOnlyAdapter, vstAdapterContract } from "../src/vst-readonly-adapter.mjs";
import { RuntimeSession } from "../src/runtime-session.mjs";

const fixedNow = Date.parse("2026-11-12T12:00:00.000Z");
const firstSessionId = "11111111-1111-4111-8111-111111111111";
const secondSessionId = "22222222-2222-4222-8222-222222222222";
const response = (data, status = 200, contentType = "application/json") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: name => name.toLowerCase() === "content-type" ? contentType : null },
  json: async () => data
});
const state = (overrides = {}) => ({
  ok: true,
  status: "OFF",
  mode: "PAPER",
  open_positions_count: 0,
  opportunities_count: 0,
  updated_at_ms: fixedNow,
  health_state: "unknown",
  allow_new_tasks: false,
  allow_risk_bearing_actions: false,
  health_checked_at_ms: 0,
  agents: [{ id: "must-not-copy", status: "active", token: "must-not-copy" }],
  tasks: [{ id: "must-not-copy", status: "running", secret: "must-not-copy" }],
  ...overrides
});
const createAdapter = overrides => new VstReadOnlyAdapter({
  now: () => fixedNow,
  createSessionId: () => firstSessionId,
  getAccessToken: async () => "vst-local-token-0123456789",
  fetchImpl: async () => response(state()),
  ...overrides
});

function waitFor(promise, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test_wait_timeout")), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

test("requires an exact loopback VST endpoint and an injected secure token provider", () => {
  const tokenProvider = async () => "vst-local-token-0123456789";
  for (const baseUrl of [
    "http://192.168.1.20:8765",
    "http://127.0.0.1:8766",
    "http://127.0.0.1:8765/untrusted-path",
    "http://127.0.0.1:8765/?target=other",
    "http://user:pass@127.0.0.1:8765"
  ]) {
    assert.throws(() => new VstReadOnlyAdapter({ getAccessToken: tokenProvider, baseUrl }), /loopback/);
  }
  assert.throws(() => new VstReadOnlyAdapter({
    getAccessToken: tokenProvider,
    baseUrl: "https://127.0.0.1:8765"
  }), /loopback/);
  assert.throws(() => new VstReadOnlyAdapter(), /secure_token_provider/);
});

test("uses only authenticated loopback GET /observer/summary with X-Token", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(state());
    }
  });
  const connected = await adapter.connect();
  assert.equal(connected.connected, true);
  assert.equal(connected.sessionId, firstSessionId);
  assert.deepEqual(adapter.capabilities, ["read_state", "assistant_message"]);
  assert.equal(calls[0].url, "http://127.0.0.1:8765/observer/summary");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["X-Token"], "vst-local-token-0123456789");
  assert.equal(Object.hasOwn(calls[0].init.headers, "Authorization"), false);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  await adapter.disconnect();
});

test("cockpit snapshot reads only the authenticated read-only VST route allowlist", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/research") return response({
        pending: 1,
        active: 1,
        failed: 1,
        requests: [
          {
            request_id: "research-market-123",
            message: "[Departamento solicitado: Market Radar] Investiga https://user:URL_PASSWORD@example.com/market?session=URL_SECRET#private",
            urls: ["https://user:URL_PASSWORD@example.com/market?session=URL_SECRET#private"],
            status: "IN_PROGRESS",
            created_at: 1_795_370_000,
            updated_at: 1_795_370_010,
            attempt_count: 1,
            lease_owner: "PRIVATE_WORKER_OWNER"
          },
          {
            request_id: "research-failed-456",
            message: "Investiga a divergência de preços",
            status: "FAILED",
            created_at: 1_795_369_000,
            updated_at: 1_795_369_030,
            result: "Fonte de dados indisponível",
            progress: 25
          },
          {
            request_id: "invalid-status-789",
            message: "Não deve ser tratado como tarefa",
            status: "RUNNING"
          }
        ]
      });
      return response({ ok: true, source_path: path });
    }
  });
  await adapter.connect();
  const snapshot = await adapter.getCockpitSnapshot();
  const expectedPaths = [
    "/health",
    "/status",
    "/learning-memory/health",
    "/learning-memory/runtime",
    "/diagnostics",
    "/market-data-health",
    "/venue-health",
    "/evidence-scorecard",
    "/evidence-ledger/audit",
    "/paper-collector/resources",
    "/research",
    "/human-interaction/pending"
  ];
  assert.deepEqual(
    calls.slice(1).map(call => new URL(call.url).pathname).sort(),
    [...expectedPaths].sort()
  );
  for (const call of calls.slice(1)) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.headers["X-Token"], "vst-local-token-0123456789");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.redirect, "error");
  }
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.authority.executionAuthorized, false);
  assert.equal(snapshot.authority.ordersSubmitted, false);
  assert.equal(snapshot.authority.riskBearingActionsAllowed, false);
  assert.equal(snapshot.sections.status.state, "available");
  assert.equal(snapshot.sections.status.data.ok, true);
  assert.equal(snapshot.sections.research.state, "available");
  assert.equal(snapshot.sections.humanInteractionPending.state, "available");
  assert.equal(snapshot.taskFeed.state, "available");
  assert.equal(snapshot.taskFeed.count, 2);
  assert.deepEqual(snapshot.agents, []);
  assert.equal(snapshot.agentState, "not_exposed_by_backend");
  const departments = Object.fromEntries(snapshot.departmentEvidence.map(item => [item.department, item]));
  assert.equal(departments.brain.evidenceState, "available");
  assert.equal(departments.markets.evidenceState, "available");
  assert.equal(departments.research.evidenceState, "available");
  assert.equal(departments.central_memory.evidenceState, "available");
  assert.equal(departments.markets.agentState, "not_exposed_by_backend");
  assert.deepEqual(snapshot.tasks.map(task => task.id), ["research-market-123", "research-failed-456"]);
  assert.equal(snapshot.tasks[0].department, "research");
  assert.equal(snapshot.tasks[0].requestedDepartment, "radar");
  assert.equal(snapshot.tasks[0].status, "IN_PROGRESS");
  assert.equal(snapshot.tasks[0].progress, undefined, "progress is not invented");
  assert.equal(snapshot.tasks[0].updatedAt, new Date(1_795_370_010 * 1_000).toISOString());
  assert.deepEqual(snapshot.tasks[0].sources, ["https://example.com/market"]);
  assert.equal(snapshot.tasks[0].description.includes("URL_PASSWORD"), false);
  assert.equal(snapshot.tasks[0].description.includes("URL_SECRET"), false);
  assert.equal(JSON.stringify(snapshot).includes("URL_PASSWORD"), false);
  assert.equal(JSON.stringify(snapshot).includes("URL_SECRET"), false);
  assert.equal(snapshot.tasks[1].status, "FAILED");
  assert.equal(snapshot.tasks[1].blocker, "Fonte de dados indisponível");
  assert.equal(snapshot.tasks[1].progress, 25);
  assert.equal(JSON.stringify(snapshot).includes("PRIVATE_WORKER_OWNER"), false);
  assert.deepEqual(adapter.capabilities, ["read_state", "assistant_message"]);
  assert.deepEqual(vstAdapterContract.cockpitReadPaths, expectedPaths);
  await adapter.disconnect();
});

test("cockpit snapshot preserves partial endpoint failures without fabricating data", async () => {
  const adapter = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/diagnostics") return response({ error: "internal detail must not be copied" }, 503);
      if (path === "/research") return response({ error: "private storage path" }, 503);
      return response({ ok: true, source_path: path });
    }
  });
  await adapter.connect();
  const snapshot = await adapter.getCockpitSnapshot();
  assert.equal(snapshot.sections.diagnostics.state, "unavailable");
  assert.equal(snapshot.sections.diagnostics.error, "vst_http_503");
  assert.equal(snapshot.sections.status.state, "available");
  assert.equal(snapshot.taskFeed.state, "unavailable");
  assert.equal(snapshot.taskFeed.error, "vst_http_503");
  assert.deepEqual(snapshot.tasks, []);
  const departments = Object.fromEntries(snapshot.departmentEvidence.map(item => [item.department, item]));
  assert.equal(departments.recovery.evidenceState, "unavailable");
  assert.equal(departments.research.evidenceState, "unavailable");
  assert.equal(JSON.stringify(snapshot).includes("internal detail must not be copied"), false);
  await adapter.disconnect();
});

test("cockpit payloads redact secrets, private identifiers, local paths and URL query strings", async () => {
  const adapter = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/human-interaction/pending") {
        return response({
          ok: true,
          requests: [{
            request_id: "request-123",
            status: "PENDING",
            title: "Owner confirmation",
            message: 'token=INLINE_SECRET api_key=INLINE_KEY {"apiKey":"INLINE_JSON_KEY"} Bearer INLINE_BEARER_SECRET_0123456789',
            fields: [{ name: "password", label: "Password", value: "FORM_SECRET", default_value: "FORM_DEFAULT" }],
            claim_token: "CLAIM_SECRET_VALUE",
            claim_token_hash: "CLAIM_HASH_VALUE",
            screenshot_path: "C:\\private\\screenshot.png",
            owner_id: "PRIVATE_OWNER_ID",
            private_namespace: "owners/PRIVATE_OWNER_ID",
            url: "https://example.com/review?access_token=URL_SECRET#private"
          }]
        });
      }
      if (path === "/status") {
        return response({
          ok: true,
          owner: { owner_id: "PRIVATE_OWNER_ID", private_namespace: "owners/PRIVATE_OWNER_ID" },
          api_key: "STATUS_API_KEY",
          database_path: "C:\\private\\vst.sqlite"
        });
      }
      return response({ ok: true });
    }
  });
  await adapter.connect();
  const snapshot = await adapter.getCockpitSnapshot();
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    "INLINE_SECRET", "INLINE_KEY", "INLINE_JSON_KEY", "INLINE_BEARER_SECRET_0123456789", "FORM_SECRET", "FORM_DEFAULT", "CLAIM_SECRET_VALUE", "CLAIM_HASH_VALUE",
    "PRIVATE_OWNER_ID", "URL_SECRET", "STATUS_API_KEY", "vst.sqlite", "screenshot.png"
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  const pending = snapshot.sections.humanInteractionPending.data.requests[0];
  assert.equal(pending.request_id, "request-123");
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.title, "Owner confirmation");
  assert.equal(pending.url, "https://example.com/review");
  assert.equal(pending.claim_token, undefined);
  assert.equal(pending.fields[0].value, undefined);
  assert.equal(pending.fields[0].default_value, undefined);
  assert.equal(pending.screenshot_path, undefined);
  assert.equal(pending.message.includes("INLINE_JSON_KEY"), false);
  assert.equal(pending.message.includes("INLINE_BEARER_SECRET"), false);
  assert.equal(pending.message.startsWith("token=[redacted] api_key=[redacted]"), true);
  assert.equal(snapshot.sections.status.data.owner.owner_id, undefined);
  await adapter.disconnect();
});

test("cockpit snapshot stops on authentication rejection and never reports a successful partial session", async () => {
  const adapter = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/status") return response({ ok: false }, 401);
      return response({ ok: true });
    }
  });
  await adapter.connect();
  await assert.rejects(adapter.getCockpitSnapshot(), /vst_auth_rejected/);
  assert.equal(adapter.authenticationRejected, true);
  await adapter.disconnect();
});

test("assistant message uses only the fixed authenticated POST route and preserves backend request identity", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/observer/summary") return response(state());
      return response({
        ok: true,
        result: {
          intent: "RESEARCH",
          status: "QUEUED",
          reply: "Pedido aceite e colocado na fila.",
          request: { request_id: "research-req-123", status: "PENDING", message: "Investiga mercado" },
          paper_only: true,
          execution_authorized: false
        }
      });
    }
  });
  await adapter.connect();
  const result = await adapter.sendAssistantMessage({
    message: "Investiga a frescura dos dados de mercado",
    department: "research"
  });
  const call = calls.find(item => new URL(item.url).pathname === "/assistant/message");
  assert.ok(call);
  assert.equal(call.url, "http://127.0.0.1:8765/assistant/message");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["X-Token"], "vst-local-token-0123456789");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.redirect, "error");
  assert.deepEqual(JSON.parse(call.init.body), {
    message: "Investiga a frescura dos dados de mercado",
    department: "research"
  });
  assert.equal(result.accepted, true);
  assert.equal(result.completed, false);
  assert.equal(result.intent, "RESEARCH");
  assert.equal(result.status, "QUEUED");
  assert.equal(result.requestId, "research-req-123");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.retryAllowed, false);
  assert.equal(JSON.stringify(result).includes("vst-local-token-0123456789"), false);
  await adapter.disconnect();
});

test("assistant message blocks PAPER control phrases before any POST", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return new URL(url).pathname === "/observer/summary" ? response(state()) : response({ ok: true });
    }
  });
  await adapter.connect();
  const commands = ["iniciar", "inicia", "ligar", "começar", "comecar", "start",
    "pausar", "pausa", "pause", "retomar", "retoma", "resume", "parar", "para", "stop"];
  for (const message of commands) {
    const result = await adapter.sendAssistantMessage({ message, department: "paper" });
    assert.equal(result.status, "BLOCKED", message);
    assert.equal(result.sent, false, message);
  }
  assert.equal(calls.filter(call => new URL(call.url).pathname === "/assistant/message").length, 0);
  await adapter.disconnect();
});

test("assistant message blocks credential assignments and unconnected UI-only departments locally", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return new URL(url).pathname === "/observer/summary" ? response(state()) : response({ ok: true });
    }
  });
  await adapter.connect();
  const secretMessages = [
    "Investiga isto api_key=SHOULD_NOT_LEAVE_OFFICE_KIT",
    '{"apiKey":"SHOULD_NOT_LEAVE_OFFICE_KIT","secret":"DO_NOT_SEND"}',
    "Authorization: Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  ];
  for (const message of secretMessages) {
    const secret = await adapter.sendAssistantMessage({ message, department: "research" });
    assert.equal(secret.intent, "SECRET_INPUT_BLOCKED");
    assert.equal(secret.sent, false);
  }
  for (const department of ["central_memory", "central-memory"]) {
    const result = await adapter.sendAssistantMessage({ message: "Consulta a memória", department });
    assert.equal(result.intent, "DEPARTMENT_NOT_CONNECTED");
    assert.equal(result.status, "NOT_CONNECTED");
    assert.equal(result.sent, false);
  }
  assert.equal(calls.filter(call => new URL(call.url).pathname === "/assistant/message").length, 0);
  await adapter.disconnect();
});

test("Analysis panel routes as a tagged research request without inventing an Analysis backend", async () => {
  let postBody = null;
  const adapter = createAdapter({
    fetchImpl: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/assistant/message") {
        postBody = JSON.parse(init.body);
        return response({
          ok: true,
          result: {
            intent: "RESEARCH",
            status: "QUEUED",
            reply: "Pedido aceite na fila de investigação.",
            request: { request_id: "analysis-routed-789", status: "PENDING" }
          }
        });
      }
      return response({ ok: true });
    }
  });
  await adapter.connect();
  const result = await adapter.sendAssistantMessage({
    message: "Avalia a robustez desta hipótese",
    department: "analysis"
  });
  assert.equal(postBody.department, "research");
  assert.equal(postBody.message, "[Área do cockpit: Análise] Analisa: Avalia a robustez desta hipótese");
  assert.equal(result.selectedDepartment, "analysis");
  assert.equal(result.backendDepartment, "research");
  assert.equal(result.department, "research");
  assert.equal(result.intent, "RESEARCH");
  assert.equal(result.status, "QUEUED");
  assert.equal(result.requestId, "analysis-routed-789");
  await adapter.disconnect();
});

test("assistant message distinguishes missing research scope from invalid authentication", async () => {
  const calls = [];
  const adapter = createAdapter({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (new URL(url).pathname === "/observer/summary") return response(state());
      return response({ error: "scope_required:submit_research" }, 403);
    }
  });
  await adapter.connect();
  const result = await adapter.sendAssistantMessage({ message: "Investiga esta hipótese", department: "research" });
  assert.equal(result.intent, "PERMISSION_DENIED");
  assert.equal(result.status, "REJECTED");
  assert.equal(result.requiredScope, "submit_research");
  assert.equal(adapter.authenticationRejected, false);
  assert.equal(adapter.connected, true);
  assert.equal(calls.filter(call => new URL(call.url).pathname === "/assistant/message").length, 1);
  await adapter.disconnect();
});

test("assistant message preserves REAL refusal from VST and never retries unknown outcomes", async () => {
  let postCount = 0;
  const blocked = createAdapter({
    fetchImpl: async url => {
      if (new URL(url).pathname === "/observer/summary") return response(state());
      postCount += 1;
      return response({
        ok: false,
        result: { intent: "REAL_BLOCKED", status: "BLOCKED", reply: "Pedido REAL recusado.", paper_only: true }
      }, 409);
    }
  });
  await blocked.connect();
  const refused = await blocked.sendAssistantMessage({ message: "Quero executar em REAL", department: "brain" });
  assert.equal(refused.intent, "REAL_BLOCKED");
  assert.equal(refused.status, "BLOCKED");
  assert.equal(refused.accepted, false);
  await blocked.disconnect();

  let postAttempts = 0;
  let reconciliationReads = 0;
  const unknown = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/research") {
        reconciliationReads += 1;
        return response({ requests: [] });
      }
      postAttempts += 1;
      throw new Error("network lost after request dispatch");
    }
  });
  await unknown.connect();
  const outcome = await unknown.sendAssistantMessage({ message: "Investiga esta hipótese", department: "research" });
  assert.equal(outcome.intent, "OUTCOME_UNKNOWN");
  assert.equal(outcome.status, "UNKNOWN");
  assert.equal(outcome.reconciliation, "not_found");
  assert.equal(outcome.retryAllowed, true);
  assert.equal(outcome.retryRequiresOwnerConfirmation, true);
  assert.equal(postAttempts, 1);
  assert.equal(reconciliationReads, 1);
  await unknown.disconnect();
});

test("assistant timeout reconciles the backend research queue before any retry can be allowed", async () => {
  let postAttempts = 0;
  let researchReads = 0;
  const adapter = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/assistant/message") {
        postAttempts += 1;
        throw new Error("connection dropped after server dispatch");
      }
      if (path === "/research") {
        researchReads += 1;
        return response({
          requests: [{
            request_id: "reconciled-research-456",
            message: "[Departamento solicitado: Investigação] Investiga esta hipótese",
            status: "IN_PROGRESS",
            created_at: Date.now() / 1_000,
            updated_at: Date.now() / 1_000,
            lease_owner: "private-worker-id",
            attempt_count: 1
          }]
        });
      }
      return response({ ok: true });
    }
  });
  await adapter.connect();
  const result = await adapter.sendAssistantMessage({
    message: "Investiga esta hipótese",
    department: "research"
  });
  assert.equal(postAttempts, 1);
  assert.equal(researchReads, 1);
  assert.equal(result.intent, "RESEARCH_RECONCILED");
  assert.equal(result.status, "IN_PROGRESS");
  assert.equal(result.accepted, true);
  assert.equal(result.completed, false);
  assert.equal(result.requestId, "reconciled-research-456");
  assert.equal(result.reconciliation, "matched");
  assert.equal(result.outcome, "reconciled");
  assert.equal(result.error, null);
  assert.equal(result.retryAllowed, false);
  assert.equal(result.request.lease_owner, undefined);
  assert.equal(JSON.stringify(result).includes("private-worker-id"), false);
  await adapter.disconnect();
});

test("unknown assistant outcome remains blocked when backend reconciliation is not authorized", async () => {
  const adapter = createAdapter({
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === "/observer/summary") return response(state());
      if (path === "/assistant/message") throw new Error("response lost after dispatch");
      if (path === "/research") return response({ error: "scope_required:read_private_state" }, 403);
      return response({ ok: true });
    }
  });
  await adapter.connect();
  const result = await adapter.sendAssistantMessage({
    message: "Investiga esta hipótese",
    department: "research"
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reconciliation, "permission_denied");
  assert.equal(result.reconciliationRequiredScope, "read_private_state");
  assert.equal(result.retryAllowed, false);
  assert.equal(adapter.authenticationRejected, false);
  await adapter.disconnect();
});

test("assistant message 401 invalidates authentication while 403 remains an authorization refusal", async () => {
  const unauthenticated = createAdapter({
    fetchImpl: async url => {
      if (new URL(url).pathname === "/observer/summary") return response(state());
      return response({ error: "unauthorized" }, 401);
    }
  });
  await unauthenticated.connect();
  await assert.rejects(
    unauthenticated.sendAssistantMessage({ message: "Investiga esta hipótese", department: "research" }),
    /vst_auth_rejected/
  );
  assert.equal(unauthenticated.authenticationRejected, true);
  await unauthenticated.disconnect();
});

test("maps only the bounded observer fields and never invents agents, tasks or authority", async () => {
  const adapter = createAdapter();
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.sourceId, "vazao-sovereign-trader");
  assert.equal(snapshot.connectionState, "connected");
  assert.equal(snapshot.synchronized, true);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.tasks, []);
  assert.equal(snapshot.backend.transportReachable, true);
  assert.equal(snapshot.backend.engineStatus, "OFF");
  assert.equal(snapshot.backend.engineRunning, false);
  assert.equal(snapshot.backend.mode, "PAPER");
  assert.equal(snapshot.backend.paperOnly, true);
  assert.equal(snapshot.backend.openPositionsCount, 0);
  assert.equal(snapshot.backend.opportunitiesCount, 0);
  assert.equal(snapshot.backend.healthState, "unknown");
  assert.equal(snapshot.backend.healthFreshness, "unavailable");
  assert.equal(snapshot.backend.allowNewTasks, false);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.runtimeReadiness, "unverified");
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "fresh");
  assert.equal(snapshot.backend.sourceTimestampSemantics, "last_observer_publish_time_not_engine_readiness");
  assert.equal(JSON.stringify(snapshot).includes("must-not-copy"), false);
  await adapter.disconnect();
});

test("fresh observer publication becomes a verified read-only snapshot, not engine readiness", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({
      status: "RUNNING",
      mode: "PAPER",
      open_positions_count: 3,
      opportunities_count: 5,
      updated_at_ms: fixedNow - 2_000,
      health_state: "healthy",
      allow_new_tasks: true,
      allow_risk_bearing_actions: true,
      health_checked_at_ms: fixedNow - 1_000
    }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.synchronized, true);
  assert.equal(snapshot.backend.engineRunning, true);
  assert.equal(snapshot.backend.healthFreshness, "fresh");
  assert.equal(snapshot.backend.allowNewTasks, true);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.runtimeReadiness, "unverified");
  await adapter.disconnect();
});

test("an unsuccessful observer envelope cannot publish fresh-looking runtime state", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({
      ok: false,
      status: "RUNNING",
      mode: "REAL",
      open_positions_count: 7,
      opportunities_count: 9,
      updated_at_ms: fixedNow,
      health_state: "healthy",
      allow_new_tasks: true,
      health_checked_at_ms: fixedNow
    }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.connectionState, "synchronizing");
  assert.equal(snapshot.synchronized, false);
  assert.equal(snapshot.backend.observerResponseAccepted, false);
  assert.equal(snapshot.backend.engineStatus, "UNKNOWN");
  assert.equal(snapshot.backend.mode, "UNKNOWN");
  assert.equal(snapshot.backend.openPositionsCount, null);
  assert.equal(snapshot.backend.opportunitiesCount, null);
  assert.equal(snapshot.backend.healthState, "unknown");
  assert.equal(snapshot.backend.allowNewTasks, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  await adapter.disconnect();
});

test("stale observer publication is rejected by RuntimeSession freshness validation", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({ updated_at_ms: fixedNow - 60_000 }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.backend.sourceSnapshotFreshness, "stale");
  const session = new RuntimeSession({ now: () => fixedNow, ttlMs: 30_000 });
  session.connect();
  session.transportConnected();
  const result = session.receiveSnapshot(snapshot);
  assert.equal(result.connectionState, "stale");
  assert.equal(result.authoritativeStateVerified, false);
  assert.deepEqual(result.agents, []);
  assert.deepEqual(result.tasks, []);
  await adapter.disconnect();
});

test("future or missing source timestamps remain synchronizing and never become authoritative", async () => {
  for (const override of [
    { updated_at_ms: fixedNow + 5_000 },
    { updated_at_ms: undefined }
  ]) {
    const adapter = createAdapter({ fetchImpl: async () => response(state(override)) });
    await adapter.connect();
    const snapshot = await adapter.getSnapshot();
    assert.equal(snapshot.synchronized, false);
    assert.ok(["future_or_clock_skew", "unavailable"].includes(snapshot.backend.sourceSnapshotFreshness));
    const session = new RuntimeSession({ now: () => fixedNow, ttlMs: 30_000 });
    session.connect();
    session.transportConnected();
    const result = session.receiveSnapshot(snapshot);
    assert.equal(result.connectionState, "synchronizing");
    assert.equal(result.authoritativeStateVerified, false);
    await adapter.disconnect();
  }
});

test("REAL mode is reported as configuration only and never grants execution authority", async () => {
  const adapter = createAdapter({
    fetchImpl: async () => response(state({ status: "RUNNING", mode: "REAL" }))
  });
  await adapter.connect();
  const snapshot = await adapter.getSnapshot();
  assert.equal(snapshot.backend.mode, "REAL");
  assert.equal(snapshot.backend.paperOnly, false);
  assert.equal(snapshot.backend.executionAuthorized, false);
  assert.equal(snapshot.backend.allowRiskBearingActions, false);
  assert.deepEqual(adapter.capabilities, ["read_state", "assistant_message"]);
  await adapter.disconnect();
});

test("rejects malformed tokens and never includes provider errors or secrets in events", async () => {
  const missing = createAdapter({ getAccessToken: async () => "short" });
  await assert.rejects(missing.connect(), /vst_local_token_unavailable/);

  const providerFailure = createAdapter({
    getAccessToken: async () => { throw new Error("X-Token private-owner-secret"); }
  });
  await assert.rejects(providerFailure.connect(), /vst_token_provider_failed/);

  const transportFailure = createAdapter({
    fetchImpl: async () => { throw new Error("Authorization: X-Token private-owner-secret"); }
  });
  await assert.rejects(transportFailure.connect(), /vst_transport_error/);
  assert.equal(JSON.stringify(transportFailure).includes("private-owner-secret"), false);
});

test("distinguishes invalid authentication from denied authorization and never follows redirects", async () => {
  const invalidToken = createAdapter({
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return response({ error: "private detail" }, 401);
    }
  });
  await assert.rejects(invalidToken.connect(), /vst_auth_rejected/);
  assert.equal(invalidToken.authenticationRejected, true);
  await invalidToken.disconnect();

  const missingScope = createAdapter({
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      return response({ error: "scope_required:read_private_state" }, 403);
    }
  });
  await assert.rejects(missingScope.connect(), /vst_http_403/);
  assert.equal(missingScope.authenticationRejected, false);
  await missingScope.disconnect();
});

test("rejects non-JSON and malformed observer responses", async () => {
  const contentType = createAdapter({
    fetchImpl: async () => response({}, 200, "text/html")
  });
  await assert.rejects(contentType.connect(), /vst_invalid_content_type/);

  const invalid = createAdapter({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => []
    })
  });
  await assert.rejects(invalid.connect(), /vst_invalid_response/);
});

test("bounds the complete token-provider and HTTP operation with one deadline", async () => {
  const adapter = createAdapter({
    timeoutMs: 250,
    getAccessToken: async () => new Promise(() => {})
  });
  await assert.rejects(adapter.connect(), /vst_request_timeout/);
});

test("a newer connect attempt aborts the previous pending connection", async () => {
  let firstSignalStarted;
  const firstStarted = new Promise(resolve => { firstSignalStarted = resolve; });
  let calls = 0;
  const adapter = createAdapter({
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        firstSignalStarted(init.signal);
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("first_connection_aborted")), { once: true });
        });
      }
      return response(state());
    }
  });

  const first = adapter.connect();
  const firstSignal = await waitFor(firstStarted);
  const second = await adapter.connect();
  assert.equal(firstSignal.aborted, true);
  assert.equal(second.connected, true);
  await assert.rejects(first, /vst_connection_superseded/);
  await adapter.disconnect();
});

test("disconnect aborts an in-flight token-provider request and supersedes connect", async () => {
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const adapter = createAdapter({
    getAccessToken: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("provider_cancelled")), { once: true });
      signalStarted(signal);
    })
  });

  const connecting = adapter.connect();
  const signal = await waitFor(started);
  await adapter.disconnect();
  assert.equal(signal.aborted, true);
  await assert.rejects(connecting, /vst_connection_superseded/);
});

test("disconnect aborts an in-flight polling fetch and suppresses its late result", async () => {
  let calls = 0;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return response(state());
      signalStarted(init.signal);
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("fetch_aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  });

  await adapter.connect();
  const signal = await waitFor(started);
  await adapter.disconnect();
  assert.equal(signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 2);
});

test("initial authentication rejection blocks reconnect until explicit disconnect", async () => {
  let calls = 0;
  const adapter = createAdapter({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ error: "unauthorized" }, 401);
      return response(state());
    }
  });

  await assert.rejects(adapter.connect(), /vst_auth_rejected/);
  await assert.rejects(adapter.connect(), /vst_auth_rejected/);
  assert.equal(calls, 1);
  await adapter.disconnect();
  await adapter.connect();
  assert.equal(calls, 2);
  await adapter.disconnect();
});

test("authentication rejection during polling stops further requests until explicit disconnect", async () => {
  let calls = 0;
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? response(state()) : response({}, 401);
    }
  });
  await adapter.connect();
  const eventPromise = new Promise(resolve => {
    const unsubscribe = adapter.subscribe(event => {
      if (event.type === "connection") {
        unsubscribe();
        resolve(event);
      }
    });
  });
  const event = await waitFor(eventPromise);
  assert.equal(event.payload.reason, "vst_auth_rejected");
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal(calls, 2);
  await adapter.disconnect();
});

test("each reconnect receives a new UUID and a late prior poll cannot emit into the new session", async () => {
  let fetchCalls = 0;
  let signalOldPoll;
  const oldPollStarted = new Promise(resolve => { signalOldPoll = resolve; });
  let releaseOldPoll;
  const oldPoll = new Promise(resolve => { releaseOldPoll = resolve; });
  const sessionIds = [firstSessionId, secondSessionId];
  const adapter = createAdapter({
    pollIntervalMs: 1_000,
    createSessionId: () => sessionIds.shift(),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 2) {
        signalOldPoll();
        return oldPoll;
      }
      return response(state());
    }
  });

  const first = await adapter.connect();
  assert.equal(first.sessionId, firstSessionId);
  await waitFor(oldPollStarted);
  await adapter.disconnect();

  const second = await adapter.connect();
  assert.equal(second.sessionId, secondSessionId);
  assert.notEqual(first.sessionId, second.sessionId);
  const events = [];
  const unsubscribe = adapter.subscribe(event => events.push(event));
  const newEvent = await waitFor(new Promise(resolve => {
    const off = adapter.subscribe(event => {
      if (event.type === "snapshot") {
        off();
        resolve(event);
      }
    });
  }));
  assert.equal(newEvent.sessionId, secondSessionId);

  releaseOldPoll(response(state()));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(events.filter(event => event.sessionId === firstSessionId).length, 0);
  assert.equal(events.filter(event => event.sessionId === secondSessionId).length, 1);
  unsubscribe();
  await adapter.disconnect();
});

test("publishes the exact VST read-only route and timestamp contract", () => {
  assert.equal(vstAdapterContract.id, "vazao-sovereign-trader");
  assert.deepEqual(vstAdapterContract.allowedMethods, ["GET"]);
  assert.deepEqual(vstAdapterContract.allowedPaths, [
    "/observer/summary",
    "/health",
    "/status",
    "/learning-memory/health",
    "/learning-memory/runtime",
    "/diagnostics",
    "/market-data-health",
    "/venue-health",
    "/evidence-scorecard",
    "/evidence-ledger/audit",
    "/paper-collector/resources",
    "/research",
    "/human-interaction/pending"
  ]);
  assert.deepEqual(vstAdapterContract.cockpitReadPaths, [
    "/health",
    "/status",
    "/learning-memory/health",
    "/learning-memory/runtime",
    "/diagnostics",
    "/market-data-health",
    "/venue-health",
    "/evidence-scorecard",
    "/evidence-ledger/audit",
    "/paper-collector/resources",
    "/research",
    "/human-interaction/pending"
  ]);
  assert.equal(vstAdapterContract.authenticationHeader, "X-Token");
  assert.equal(vstAdapterContract.responseSuccessField, "ok");
  assert.equal(vstAdapterContract.requiresSuccessfulObserverEnvelope, true);
  assert.equal(vstAdapterContract.requiredScope, "read_private_state");
  assert.equal(vstAdapterContract.sourceTimestampField, "updated_at_ms");
  assert.equal(vstAdapterContract.sourceTimestampSemantics, "last_observer_publish_time_not_engine_readiness");
  assert.equal(vstAdapterContract.remoteConnectionSupported, false);
  assert.deepEqual(vstAdapterContract.capabilities, ["read_state", "assistant_message"]);
  assert.equal(vstAdapterContract.assistantMessagePath, "/assistant/message");
  assert.equal(vstAdapterContract.assistantMessageMethod, "POST");
  assert.deepEqual(vstAdapterContract.assistantMessageRequiredScopes, ["read_private_state", "submit_research"]);
  assert.equal(vstAdapterContract.assistantMessagePaperControlsBlocked, true);
  assert.equal(vstAdapterContract.assistantMessageAutomaticRetry, false);
  assert.ok(vstAdapterContract.assistantMessageDepartments.includes("research"));
  assert.ok(vstAdapterContract.assistantMessageUiOnlyDepartments.includes("central_memory"));
  assert.equal(vstAdapterContract.assistantMessageDepartmentRouting.analysis, "research");
});
