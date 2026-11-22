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

  async function ensureOpen() {
    if (closed) throw new Error("vst_windows_host_closed");
    await host.ready;
  }

  async function clearRejectedSession(error) {
    if (error?.message === "vst_auth_rejected") {
      await adapter.disconnect();
      sessionToken = null;
    }
    throw error;
  }

  async function setSessionToken({ token, ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("vst_session_token_owner_consent_required");
    if (!isValidSessionToken(token)) throw new Error("vst_session_token_invalid");
    await ensureOpen();
    await adapter.disconnect();
    sessionToken = token;
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
    await adapter.disconnect();
    sessionToken = null;
    return Object.freeze({ cleared: true, storage: "memory-session" });
  }

  async function connect() {
    await ensureOpen();
    if (!sessionToken) throw new Error("vst_session_token_unavailable");
    try {
      return await adapter.connect();
    } catch (error) {
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
      return await adapter.getCockpitSnapshot();
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
    await adapter.disconnect();
    sessionToken = null;
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
    subscribe,
    disconnect,
    health,
    getCredentialState,
    close
  });
}
