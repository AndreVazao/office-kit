import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { resolveEditionHostOptions, runEditionCli } from "../src/edition-cli.mjs";
import { runDgmMatCli } from "../src/dgmat-cli.mjs";
import { runVstCli } from "../src/vst-cli.mjs";

function makeHost(edition) {
  let connected = false;
  let sessionToken = null;
  const calls = [];
  return {
    calls,
    ready: Promise.resolve(),
    async health() {
      calls.push("health");
      return { status: "ready", edition, adapterConnected: connected, backendOperationalState: "unverified", backendReadOnly: true };
    },
    getCredentialState() {
      calls.push("credential-status");
      return { configured: sessionToken !== null, storage: "memory-session", persistent: false, tokenExposed: false };
    },
    async setSessionToken({ token, ownerConsent }) {
      calls.push("authenticate");
      if (ownerConsent !== true) throw new Error("owner_consent_required");
      sessionToken = token;
      return { configured: true, storage: "memory-session", persistent: false, tokenExposed: false };
    },
    async connect() { calls.push("connect"); connected = true; return { connected: true }; },
    async getSnapshot() {
      calls.push("snapshot");
      if (!connected) throw new Error("not_connected");
      return { connectionState: "synchronizing", synchronized: false, agents: [], tasks: [] };
    },
    async getCockpitSnapshot() {
      calls.push("cockpit-snapshot");
      if (!connected) throw new Error("not_connected");
      return { readOnly: true, authority: { executionAuthorized: false } };
    },
    async sendAssistantMessage({ message, department }) {
      calls.push("assistant-message");
      if (!connected) throw new Error("not_connected");
      return {
        ok: true, accepted: true, completed: false, intent: "RESEARCH",
        status: "QUEUED", requestId: "cli-research-123",
        department, receivedMessage: message, executionAuthorized: false
      };
    },
    async disconnect() { calls.push("disconnect"); connected = false; sessionToken = null; return { disconnected: true, tokenCleared: true }; },
    async close() { calls.push("close"); connected = false; }
  };
}

async function runWithStreams(options, lines) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = "";
  output.setEncoding("utf8");
  output.on("data", chunk => { text += chunk; });
  input.end(lines.join("\n") + "\n");
  const code = await runEditionCli({ ...options, input, output });
  return { code, responses: text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), text };
}

test("edition CLI starts disconnected and accepts only explicit read-only session commands", async () => {
  const host = makeHost("dgmat");
  const result = await runWithStreams({
    edition: "dgmat", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    '{"command":"health"}',
    '{"command":"credential-status"}',
    '{"command":"snapshot"}',
    '{"command":"connect"}',
    '{"command":"snapshot"}',
    '{"command":"disconnect"}',
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.responses[0].health.adapterConnected, false);
  assert.equal(result.responses[1].credentials.configured, false);
  assert.equal(result.responses[2].error, "not_connected");
  assert.equal(result.responses[3].connected, true);
  assert.equal(result.responses[3].readOnlySnapshot, true);
  assert.equal(result.responses[3].assistantMessageEnabled, true);
  assert.equal(result.responses[3].financialActionsAllowed, false);
  assert.equal(result.responses[3].paperControlsEnabled, false);
  assert.equal(result.responses[3].executionAuthorized, false);
  assert.equal(result.responses[3].riskBearingActionsAllowed, false);
  assert.equal(result.responses[4].snapshot.synchronized, false);
  assert.equal(result.responses[5].connected, false);
  assert.equal(result.responses[6].shutdown, true);
  assert.equal(host.calls.filter(call => call === "connect").length, 1);
  assert.equal(host.calls.filter(call => call === "disconnect").length, 1);
  assert.equal(host.calls.at(-1), "close");
});

test("VST CLI accepts a session token only through an explicit memory-only authentication request", async () => {
  const host = makeHost("vst");
  const token = "TOP_SECRET_SESSION_TOKEN_0123456789";
  const result = await runWithStreams({
    edition: "vst", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    '{"command":"cockpit-snapshot"}',
    JSON.stringify({ command: "authenticate", token, ownerConsent: true }),
    '{"command":"credential-status"}',
    '{"command":"connect"}',
    '{"command":"cockpit-snapshot"}',
    '{"command":"disconnect"}',
    '{"command":"credential-status"}',
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.responses[0].error, "not_connected");
  assert.equal(result.responses[1].sessionConfigured, true);
  assert.equal(result.responses[1].storage, "memory-session");
  assert.equal(result.responses[1].tokenExposed, false);
  assert.equal(result.responses[2].credentials.configured, true);
  assert.equal(result.responses[2].credentials.persistent, false);
  assert.equal(result.responses[3].connected, true);
  assert.equal(result.responses[4].readOnly, true);
  assert.equal(result.responses[4].cockpit.authority.executionAuthorized, false);
  assert.equal(result.responses[5].tokenCleared, true);
  assert.equal(result.responses[6].credentials.configured, false);
  assert.equal(result.responses[7].shutdown, true);
  assert.equal(result.text.includes(token), false);
  assert.equal(host.calls.filter(call => call === "authenticate").length, 1);
  assert.equal(host.calls.filter(call => call === "cockpit-snapshot").length, 1);
  assert.equal(host.calls.at(-1), "close");
});

test("DGM-MAT CLI rejects VST-only authentication and cockpit commands", async () => {
  const host = makeHost("dgmat");
  const token = "TOP_SECRET_SESSION_TOKEN_0123456789";
  const result = await runWithStreams({
    edition: "dgmat", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    JSON.stringify({ command: "authenticate", token, ownerConsent: true }),
    '{"command":"cockpit-snapshot"}',
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.responses[0].error, "invalid_request");
  assert.equal(result.responses[1].error, "invalid_request");
  assert.equal(result.text.includes(token), false);
  assert.equal(host.calls.includes("authenticate"), false);
});

test("VST CLI forwards only the fixed assistant-message request and preserves backend acceptance", async () => {
  const host = makeHost("vst");
  const message = "Investiga a frescura dos dados de mercado";
  const result = await runWithStreams({
    edition: "vst", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    JSON.stringify({ command: "assistant-message", message, department: "research" }),
    '{"command":"connect"}',
    JSON.stringify({ command: "assistant-message", message, department: "research" }),
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.responses[0].error, "not_connected");
  assert.equal(result.responses[1].connected, true);
  assert.equal(result.responses[2].response.intent, "RESEARCH");
  assert.equal(result.responses[2].response.status, "QUEUED");
  assert.equal(result.responses[2].response.requestId, "cli-research-123");
  assert.equal(result.responses[2].response.executionAuthorized, false);
  assert.equal(host.calls.filter(call => call === "assistant-message").length, 1);
  assert.equal(host.calls.at(-1), "close");
});

test("DGM-MAT CLI rejects the VST assistant-message command", async () => {
  const host = makeHost("dgmat");
  const result = await runWithStreams({
    edition: "dgmat", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    JSON.stringify({ command: "assistant-message", message: "Investiga isto", department: "research" }),
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.responses[0].error, "invalid_request");
  assert.equal(host.calls.includes("assistant-message"), false);
});

test("VST CLI rejects arbitrary assistant-message payload fields", async () => {
  const host = makeHost("vst");
  const result = await runWithStreams({
    edition: "vst", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    JSON.stringify({
      command: "assistant-message",
      message: "Investiga isto",
      department: "research",
      endpoint: "/arbitrary",
      method: "DELETE"
    }),
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.responses[0].error, "invalid_request");
  assert.equal(host.calls.includes("assistant-message"), false);
});

test("edition CLI rejects credential fields and never echoes request contents", async () => {
  const host = makeHost("vst");
  const result = await runWithStreams({
    edition: "vst", createHost: () => host, hostOptions: {}, argv: ["serve"]
  }, [
    '{"command":"connect","token":"TOP_SECRET_TEST_VALUE"}',
    '{"command":"shutdown"}'
  ]);
  assert.equal(result.responses[0].error, "invalid_request");
  assert.equal(result.responses[1].shutdown, true);
  assert.equal(result.text.includes("TOP_SECRET_TEST_VALUE"), false);
  assert.equal(host.calls.includes("connect"), false);
});

test("edition CLI rejects command-line credential arguments before host creation", async () => {
  let created = false;
  const output = new PassThrough();
  let text = "";
  output.setEncoding("utf8");
  output.on("data", chunk => { text += chunk; });
  const code = await runEditionCli({
    edition: "dgmat",
    createHost: () => { created = true; throw new Error("must_not_run"); },
    hostOptions: {},
    argv: ["serve", "--token=TOP_SECRET_TEST_VALUE"],
    output
  });
  assert.equal(code, 2);
  assert.equal(created, false);
  assert.equal(text.includes("TOP_SECRET_TEST_VALUE"), false);
});

test("DGM-MAT and VST launchers use distinct persistent data roots", async () => {
  const dgmatHost = makeHost("dgmat");
  const vstHost = makeHost("vst");
  let dgmatPath;
  let vstPath;
  const env = { LOCALAPPDATA: "/profiles/user" };
  const dgmatOutput = new PassThrough();
  const vstOutput = new PassThrough();
  await runDgmMatCli({
    argv: ["health"], env, output: dgmatOutput,
    createHost: configuration => { dgmatPath = configuration.hostOptions.appDataPath; return dgmatHost; }
  });
  await runVstCli({
    argv: ["health"], env, output: vstOutput,
    createHost: configuration => { vstPath = configuration.hostOptions.appDataPath; return vstHost; }
  });
  assert.equal(dgmatPath, join(env.LOCALAPPDATA, "OfficeKit", "DGM-MAT"));
  assert.equal(vstPath, join(env.LOCALAPPDATA, "OfficeKit", "VST"));
  assert.notEqual(dgmatPath, vstPath);
});

test("edition host data roots reject missing or relative LOCALAPPDATA", () => {
  assert.throws(() => resolveEditionHostOptions("dgmat", {}), /local_app_data_required/);
  assert.throws(() => resolveEditionHostOptions("vst", { LOCALAPPDATA: "relative" }), /local_app_data_required/);
  assert.throws(() => resolveEditionHostOptions("universal", { LOCALAPPDATA: "/profiles/user" }), /unsupported_edition/);
});
