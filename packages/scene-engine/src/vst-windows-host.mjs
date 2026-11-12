import { createWindowsHost } from "../../windows-host/src/index.mjs";
import { VstReadOnlyAdapter } from "./vst-readonly-adapter.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8765";
const SECRET_NAME = "owner-token";
const NAMESPACE = "vst.local-api";

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

/**
 * VST-only Windows composition. Universal and DGM-MAT never import this module.
 * The owner token is stored in a VST-specific CNG namespace; connection is
 * explicit and the adapter exposes only authenticated read-only state.
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

  let tokenVault = null;
  const adapter = new VstReadOnlyAdapter({
    ...adapterOptions,
    baseUrl,
    getAccessToken: async ({ signal } = {}) => {
      if (!tokenVault) throw new Error("vst_local_token_vault_unavailable");
      const token = await tokenVault.getSecret(SECRET_NAME, { signal });
      if (typeof token !== "string" || token.length < 16) {
        throw new Error("vst_local_token_unavailable");
      }
      return token;
    }
  });

  const host = hostFactory(hostOptions);
  if (!host || typeof host.createSecretStore !== "function"
    || typeof host.close !== "function" || !host.ready) {
    try { void Promise.resolve(host?.close?.()).catch(() => {}); } catch {}
    throw new TypeError("vst_windows_host_secret_store_unavailable");
  }
  try {
    tokenVault = host.createSecretStore(NAMESPACE);
  } catch (error) {
    try { void Promise.resolve(host.close()).catch(() => {}); } catch {}
    throw error;
  }

  let closed = false;

  async function ensureOpen() {
    if (closed) throw new Error("vst_windows_host_closed");
    await host.ready;
  }

  async function provisionLocalApiToken({ token, ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("vst_local_token_owner_consent_required");
    if (typeof token !== "string" || token.length < 16 || token.length > 8_192
      || token.trim() !== token || /\s/.test(token)) {
      throw new Error("vst_local_token_invalid");
    }
    await ensureOpen();
    await adapter.disconnect();
    await tokenVault.setSecret(SECRET_NAME, token);
    return Object.freeze({
      stored: true,
      provider: "windows-cng-software-ksp-secret-vault",
      namespace: NAMESPACE,
      protectionLevel: "os-protected",
      hardwareBacked: false,
      backupRestoreRequiresSameUserProfile: true,
      tokenRetainedInMemory: false
    });
  }

  async function removeLocalApiToken({ ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("vst_local_token_owner_consent_required");
    await ensureOpen();
    await adapter.disconnect();
    return tokenVault.destroy();
  }

  async function connect() {
    await ensureOpen();
    return adapter.connect();
  }

  async function getSnapshot() {
    await ensureOpen();
    return adapter.getSnapshot();
  }

  function subscribe(listener) {
    if (closed) throw new Error("vst_windows_host_closed");
    return adapter.subscribe(listener);
  }

  async function disconnect() {
    if (closed) return { disconnected: true };
    return adapter.disconnect();
  }

  function getCredentialState() {
    if (closed) return Object.freeze({ configured: false, storage: "closed" });
    return Object.freeze({
      configured: tokenVault.hasSecret(SECRET_NAME),
      provider: "windows-cng-software-ksp-secret-vault",
      namespace: NAMESPACE,
      secretName: SECRET_NAME,
      tokenReadable: false
    });
  }

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", edition: "vst" });
    const hostHealth = await host.health();
    return Object.freeze({
      ...hostHealth,
      edition: "vst",
      adapterConnected: adapter.connected === true,
      credentialsConfigured: tokenVault.hasSecret(SECRET_NAME),
      backendOperationalState: "unverified",
      backendReadOnly: true
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
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
    provisionLocalApiToken,
    removeLocalApiToken,
    connect,
    getSnapshot,
    subscribe,
    disconnect,
    health,
    getCredentialState,
    close
  });
}
