import test from "node:test";
import assert from "node:assert/strict";
import { createWindowsVstHost } from "../src/vst-windows-host.mjs";

const fixedNow = Date.parse("2026-11-22T12:00:00.000Z");
const ownerToken = "vst-session-token-" + "0123456789".repeat(4);

function makeHost() {
  let closed = false;
  return {
    ready: Promise.resolve({ status: "ready" }),
    async health() { return { status: "ready" }; },
    async close() { closed = true; },
    get closed() { return closed; }
  };
}

function response(path) {
  const data = path === "/observer/summary"
    ? {
      ok: true, status: "OFF", mode: "PAPER", open_positions_count: 0,
      opportunities_count: 0, updated_at_ms: fixedNow, health_state: "unknown",
      allow_new_tasks: false, allow_risk_bearing_actions: false, health_checked_at_ms: 0
    }
    : path === "/assistant/message"
      ? {
        ok: true,
        result: {
          intent: "RESEARCH",
          status: "QUEUED",
          reply: "Pedido aceite e colocado na fila.",
          request: { request_id: "session-bridge-123", status: "PENDING" },
          paper_only: true,
          execution_authorized: false
        }
      }
      : path === "/research"
        ? {
          pending: 1,
          active: 0,
          completed: 0,
          discarded: 0,
          failed: 0,
          requests: [{
            request_id: "research-live-task-001",
            message: "Investiga a frescura dos dados de mercado",
            status: "PENDING",
            created_at: 1_795_370_000,
            updated_at: 1_795_370_000
          }]
        }
        : { ok: true, path };
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => data
  };
}

test("VST session token stays ephemeral across cockpit GETs and restricted assistant POST", async () => {
  const host = makeHost();
  const requests = [];
  const composed = createWindowsVstHost({
    hostFactory: () => host,
    adapterOptions: {
      now: () => fixedNow,
      timeoutMs: 1_000,
      pollIntervalMs: 60_000,
      fetchImpl: async (url, init) => {
        requests.push({ url, method: init.method, token: init.headers?.["X-Token"] ?? null, body: init.body ?? null });
        return response(new URL(url).pathname);
      }
    }
  });

  try {
    await composed.ready;
    const configured = await composed.setSessionToken({ token: ownerToken, ownerConsent: true });
    assert.deepEqual(configured, {
      configured: true,
      storage: "memory-session",
      persistent: false,
      tokenExposed: false
    });
    assert.equal(requests.length, 0, "session setup must not connect or persist");
    assert.equal(composed.getCredentialState().configured, true);
    assert.equal(composed.getCredentialState().persistent, false);

    await composed.connect();
    const snapshot = await composed.getCockpitSnapshot();
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.sections.status.state, "available");
    assert.equal(snapshot.taskFeed.state, "available");
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0].id, "research-live-task-001");
    assert.equal(snapshot.tasks[0].department, "research");
    assert.equal(snapshot.tasks[0].status, "PENDING");
    assert.equal(snapshot.tasks[0].progress, undefined);
    assert.deepEqual(snapshot.agents, []);
    assert.equal(snapshot.agentState, "not_exposed_by_backend");
    assert.ok(requests.length >= 13);
    assert.ok(requests.filter(item => item.method === "GET").length >= 13);
    assert.ok(requests.every(item => item.token === ownerToken));
    assert.equal(JSON.stringify(snapshot).includes(ownerToken), false);

    const assistant = await composed.sendAssistantMessage({
      message: "Investiga a frescura dos dados de mercado",
      department: "research"
    });
    assert.equal(assistant.status, "QUEUED");
    assert.equal(assistant.requestId, "session-bridge-123");
    assert.equal(assistant.executionAuthorized, false);
    const post = requests.find(item => item.method === "POST");
    assert.ok(post);
    assert.equal(new URL(post.url).pathname, "/assistant/message");
    assert.deepEqual(JSON.parse(post.body), {
      message: "Investiga a frescura dos dados de mercado",
      department: "research"
    });
    assert.equal(JSON.stringify(assistant).includes(ownerToken), false);

    await composed.disconnect();
    assert.equal(composed.getCredentialState().configured, false);
    assert.equal(composed.getCredentialState().storage, "memory-session");
    await assert.rejects(composed.connect(), /session_token_unavailable/);
  } finally {
    await composed.close();
  }

  assert.equal(host.closed, true);
  assert.equal(composed.getCredentialState().storage, "closed");
});
