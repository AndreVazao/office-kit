import { createInterface } from "node:readline";
import { isAbsolute, join } from "node:path";

const EDITION_DATA_DIRECTORIES = Object.freeze({
  dgmat: "DGM-MAT",
  vst: "VST"
});
const MAX_REQUEST_BYTES = 4_096;
const CLI_COMMANDS = new Set(["health", "serve"]);
const REQUEST_COMMANDS = new Set([
  "health", "credential-status", "authenticate", "connect", "snapshot", "cockpit-snapshot", "assistant-message", "disconnect", "shutdown"
]);

function writeJson(output, value) {
  output.write(JSON.stringify(value) + "\n");
}

export function resolveEditionHostOptions(edition, env = process.env) {
  const directory = EDITION_DATA_DIRECTORIES[edition];
  if (!directory) throw new Error("edition_cli_unsupported_edition");
  const localAppData = env?.LOCALAPPDATA;
  if (typeof localAppData !== "string" || !isAbsolute(localAppData)) {
    throw new Error("edition_cli_local_app_data_required");
  }
  return Object.freeze({ appDataPath: join(localAppData, "OfficeKit", directory) });
}

function parseRequest(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) return { error: "request_too_large" };
  let value;
  try { value = JSON.parse(line); }
  catch { return { error: "invalid_json" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.command !== "string" || !REQUEST_COMMANDS.has(value.command)) {
    return { error: "invalid_request" };
  }
  const keys = Object.keys(value).sort();
  if (value.command === "authenticate") {
    if (keys.join(",") !== "command,ownerConsent,token"
      || typeof value.token !== "string" || value.ownerConsent !== true) {
      return { error: "invalid_request" };
    }
    return { command: value.command, token: value.token, ownerConsent: true };
  }
  if (value.command === "assistant-message") {
    if (keys.join(",") !== "command,department,message"
      || typeof value.message !== "string" || typeof value.department !== "string") {
      return { error: "invalid_request" };
    }
    return { command: value.command, message: value.message, department: value.department };
  }
  if (keys.length !== 1 || keys[0] !== "command") return { error: "invalid_request" };
  return { command: value.command };
}

async function executeRequest(host, request) {
  const { command } = request;
  if (command === "health") {
    return { ok: true, command, health: await host.health() };
  }
  if (command === "credential-status") {
    if (typeof host.getCredentialState !== "function") {
      return { ok: false, command, error: "credential_status_unavailable" };
    }
    return { ok: true, command, credentials: host.getCredentialState() };
  }
  if (command === "authenticate") {
    if (typeof host.setSessionToken !== "function") {
      return { ok: false, command, error: "session_authentication_unavailable" };
    }
    await host.setSessionToken({ token: request.token, ownerConsent: request.ownerConsent });
    return {
      ok: true,
      command,
      sessionConfigured: true,
      storage: "memory-session",
      tokenExposed: false
    };
  }
  if (command === "connect") {
    await host.connect();
    return { ok: true, command, connected: true, readOnly: true, backendOperationalState: "unverified" };
  }
  if (command === "snapshot") {
    const health = await host.health();
    if (health?.adapterConnected !== true) return { ok: false, command, error: "not_connected" };
    return { ok: true, command, snapshot: await host.getSnapshot() };
  }
  if (command === "cockpit-snapshot") {
    const health = await host.health();
    if (health?.adapterConnected !== true) return { ok: false, command, error: "not_connected" };
    if (typeof host.getCockpitSnapshot !== "function") {
      return { ok: false, command, error: "cockpit_snapshot_unavailable" };
    }
    return { ok: true, command, readOnly: true, cockpit: await host.getCockpitSnapshot() };
  }
  if (command === "assistant-message") {
    const health = await host.health();
    if (health?.adapterConnected !== true) return { ok: false, command, error: "not_connected" };
    if (typeof host.sendAssistantMessage !== "function") {
      return { ok: false, command, error: "assistant_message_unavailable" };
    }
    return {
      ok: true,
      command,
      response: await host.sendAssistantMessage({
        message: request.message,
        department: request.department
      })
    };
  }
  if (command === "disconnect") {
    const result = await host.disconnect();
    return {
      ok: true,
      command,
      connected: false,
      tokenCleared: result?.tokenCleared === true
    };
  }
  return { ok: true, command, shutdown: true };
}

async function runServe(host, { input, output, edition }) {
  const reader = createInterface({ input, crlfDelay: Infinity, terminal: false });
  try {
    for await (const line of reader) {
      const request = parseRequest(line);
      if (request.error) {
        writeJson(output, { ok: false, error: request.error });
        continue;
      }
      if ((request.command === "cockpit-snapshot" || request.command === "authenticate" || request.command === "assistant-message") && edition !== "vst") {
        writeJson(output, { ok: false, error: "invalid_request" });
        continue;
      }
      try {
        const result = await executeRequest(host, request);
        writeJson(output, result);
        if (request.command === "shutdown") break;
      } catch (caught) {
        const code = caught instanceof Error ? caught.message : "";
        const error = code === "vst_auth_rejected" ? "authentication_failed"
          : code === "vst_http_403" ? "authorization_denied"
            : code === "vst_request_timeout" || code === "vst_transport_error"
              || /^vst_http_(?:0|5[0-9]{2})$/.test(code) ? "connectivity_unavailable"
                : code === "vst_adapter_not_connected" ? "not_connected"
                  : request.command === "connect" ? "connection_failed"
                    : request.command === "snapshot" ? "snapshot_failed"
                      : request.command === "cockpit-snapshot" ? "cockpit_snapshot_failed"
                        : request.command === "authenticate" ? "authentication_failed"
                          : request.command === "assistant-message" ? "assistant_message_failed"
                            : request.command === "disconnect" ? "disconnect_failed"
                              : request.command === "credential-status" ? "credential_status_failed"
                                : "health_failed";
        writeJson(output, { ok: false, command: request.command, error });
      }
    }
  } finally {
    reader.close();
    if (typeof input.pause === "function") input.pause();
  }
}

export async function runEditionCli({
  edition,
  createHost,
  hostOptions,
  argv = process.argv.slice(2),
  input = process.stdin,
  output = process.stdout
} = {}) {
  if (!EDITION_DATA_DIRECTORIES[edition] || typeof createHost !== "function") {
    throw new TypeError("edition_cli_configuration_invalid");
  }
  if (!Array.isArray(argv) || argv.length !== 1 || !CLI_COMMANDS.has(argv[0])) {
    writeJson(output, { ok: false, error: "invalid_arguments", usage: "health | serve" });
    return 2;
  }

  let host;
  try {
    host = createHost({ hostOptions });
    if (!host || !host.ready || typeof host.close !== "function") throw new Error("edition_cli_host_invalid");
    await host.ready;
  } catch {
    try { await host?.close?.(); } catch { /* Preserve the sanitized startup result. */ }
    writeJson(output, { ok: false, error: "host_start_failed" });
    return 1;
  }

  try {
    if (argv[0] === "health") {
      try {
        writeJson(output, { ok: true, command: "health", health: await host.health() });
        return 0;
      } catch {
        writeJson(output, { ok: false, command: "health", error: "health_failed" });
        return 1;
      }
    }
    await runServe(host, { input, output, edition });
    return 0;
  } finally {
    await host.close();
  }
}
