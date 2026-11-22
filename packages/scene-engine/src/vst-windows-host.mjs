import { createWindowsHost } from "../../windows-host/src/index.mjs";
import { VstReadOnlyAdapter } from "./vst-readonly-adapter.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";

function isExactLoopbackBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      && url.port === "8765"
      && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isValidSessionToken(token) {
  return typeof token === "string"
    && token.length >= 16
    && token.length <= 8_192
    && token.trim() === token
    && !/\s/.test(token);
}

/**
 * VST-only Windows composition.
 *
 * The control token is deliberately memory-only: it is supplied for one
 * explicit owner-approved session, never written to the CNG vault, and its
 * reference is cleared on disconnect, authentication rejection, or close.
 */
export function createWindowsVstHost({
  hostFactory = createWindowsHost,
  hostOptions = {},
  adapterOptions = {}
} = {}) {
  if (typeof hostFactory !== "function") throw new TypeError("vst_windows_host_factory_required");
  const baseUrl = adapterOptions.baseUrl ?? DEFAULT_BASE_URL;
  if (!isExactLoopbackBase(baseUrl)) {
    throw new Error("vst_windows_host_exact_loopback_endpoint_required");
  }

  let sessionToken = null;
  const getAccessToken = async () => {
    if (!sessionToken) throw new Error("vst_session_token_unavailable");
    return sessionToken;
  };
  const adapter = new VstReadOnlyAdapter({
    ...adapterOptions,
    baseUrl,
    getAccessToken
  });

  const host = hostFactory(hostOptions);
  if (!host || typeof host.close !== "function" || typeof host.health !== "function" || !host.ready) {
    try { void Promise.resolve(host?.close?.()).catch(() => {}); } catch {}
    throw new TypeError("vst_windows_host_lifecycle_unavailable");
  }

  let closed = false;
  let lastConnectionFailure = null;
  let lastAuthorizationFailure = null;

  function classifyConnectionFailure(error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "vst_auth_rejected") return "authentication_rejected";
    if (code === "vst_http_403") return "authorization_denied";
    if (code === "vst_request_timeout" || code === "vst_transport_error"
      || /^vst_http_(?:0|5[0-9]{2})$/.test(code)) return "connectivity_unavailable";
    return "connection_failed";
  }

  async function ensureOpen() {
    if (closed) throw new Error("vst_windows_host_closed");
    await host.ready;
  }

  async function clearRejectedSession(error) {
    if (error?.message === "vst_auth_rejected") {
      sessionToken = null;
      await adapter.disconnect();
    }
    throw error;
  }

  async function setSessionToken({ token, ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("vst_session_token_owner_consent_required");
    if (!isValidSessionToken(token)) throw new Error("vst_session_token_invalid");
    await ensureOpen();
    sessionToken = null;
    await adapter.disconnect();
    sessionToken = token;
    lastConnectionFailure = null;
    lastAuthorizationFailure = null;
    return Object.freeze({
      configured: true,
      storage: "memory-session",
      persistent: false,
      tokenExposed: false
    });
  }

  async function clearSessionToken({ ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("vst_session_token_owner_consent_required");
    await ensureOpen();
    sessionToken = null;
    await adapter.disconnect();
    lastConnectionFailure = null;
    lastAuthorizationFailure = null;
    return Object.freeze({ cleared: true, storage: "memory-session" });
  }

  async function connect() {
    await ensureOpen();
    if (!sessionToken) throw new Error("vst_session_token_unavailable");
    try {
      const result = await adapter.connect();
      lastConnectionFailure = null;
      lastAuthorizationFailure = null;
      return result;
    } catch (error) {
      lastConnectionFailure = classifyConnectionFailure(error);
      if (lastConnectionFailure === "authorization_denied") {
        lastAuthorizationFailure = "read_private_state";
      }
      return clearRejectedSession(error);
    }
  }

  async function getSnapshot() {
    await ensureOpen();
    try {
      return await adapter.getSnapshot();
    } catch (error) {
      return clearRejectedSession(error);
    }
  }

  async function getCockpitSnapshot() {
    await ensureOpen();
    if (!adapter.connected) throw new Error("vst_adapter_not_connected");
    try {
      const snapshot = await adapter.getCockpitSnapshot();
      if (Object.values(snapshot.sections).some(section => section?.error === "vst_http_403")) {
        lastAuthorizationFailure = "read_private_state";
      }
      return snapshot;
    } catch (error) {
      return clearRejectedSession(error);
    }
  }

  async function sendAssistantMessage(input) {
    await ensureOpen();
    if (!adapter.connected) throw new Error("vst_adapter_not_connected");
    try {
      const result = await adapter.sendAssistantMessage(input);
      if (result.intent === "PERMISSION_DENIED") {
        lastAuthorizationFailure = result.requiredScope ?? "assistant_message";
      }
      return result;
    } catch (error) {
      return clearRejectedSession(error);
    }
  }

  function subscribe(listener) {
    if (closed) throw new Error("vst_windows_host_closed");
    return adapter.subscribe(listener);
  }

  async function disconnect() {
    if (closed) return { disconnected: true, tokenCleared: true };
    try {
      await adapter.disconnect();
    } finally {
      sessionToken = null;
    }
    return { disconnected: true, tokenCleared: true };
  }

  function getCredentialState() {
    return Object.freeze({
      configured: !closed && sessionToken !== null,
      storage: closed ? "closed" : "memory-session",
      persistent: false,
      tokenExposed: false
    });
  }

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", edition: "vst" });
    const hostHealth = await host.health();
    return Object.freeze({
      ...hostHealth,
      edition: "vst",
      adapterConnected: adapter.connected === true,
      credentialsConfigured: sessionToken !== null,
      credentialStorage: "memory-session",
      authenticationState: sessionToken !== null
        ? "configured" : lastConnectionFailure === "authentication_rejected" ? "rejected" : "not_configured",
      authorizationState: lastAuthorizationFailure
        ? "denied" : adapter.connected ? "read_private_state_granted" : "not_checked",
      connectivityState: adapter.connected
        ? "connected" : lastConnectionFailure === "connectivity_unavailable" ? "unavailable" : "disconnected",
      lastConnectionFailure,
      lastAuthorizationFailure,
      backendOperationalState: "unverified",
      backendReadOnly: true
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    sessionToken = null;
    try {
      await adapter.disconnect();
    } finally {
      await host.close();
    }
  }

  return Object.freeze({
    edition: "vst",
    installationId: host.installationId,
    ready: host.ready,
    setSessionToken,
    clearSessionToken,
    connect,
    getSnapshot,
    getCockpitSnapshot,
    sendAssistantMessage,
    subscribe,
    disconnect,
    health,
    getCredentialState,
    close
  });
}
