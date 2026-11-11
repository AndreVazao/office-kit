import { createWindowsHost } from "../../windows-host/src/index.mjs";
import { DgmMatLocalSessionProvider } from "./dgmat-local-session-provider.mjs";
import { DgmMatReadOnlyAdapter } from "./dgmat-readonly-adapter.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8181";

function isExactLoopbackBase(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      && url.port === "8181"
      && url.pathname === "/"
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * DGM-MAT-only Windows composition. Universal never imports this module.
 * Bootstrap credentials are provisioned only by an explicit owner action.
 * Connecting is always explicit and the adapter remains read-only.
 */
export function createWindowsDgmMatHost({
  hostFactory = createWindowsHost,
  hostOptions = {},
  sessionProviderOptions = {},
  adapterOptions = {}
} = {}) {
  if (typeof hostFactory !== "function") throw new TypeError("dgmat_windows_host_factory_required");

  const requestedSessionUrl = sessionProviderOptions.baseUrl;
  const requestedAdapterUrl = adapterOptions.baseUrl;
  if (requestedSessionUrl && requestedAdapterUrl && requestedSessionUrl !== requestedAdapterUrl) {
    throw new Error("dgmat_windows_host_endpoint_mismatch");
  }
  const baseUrl = requestedSessionUrl ?? requestedAdapterUrl ?? DEFAULT_BASE_URL;
  if (!isExactLoopbackBase(baseUrl)) {
    throw new Error("dgmat_windows_host_exact_loopback_endpoint_required");
  }

  let bootstrapVault = null;
  const sessionProvider = new DgmMatLocalSessionProvider({
    ...sessionProviderOptions,
    baseUrl,
    getBootstrapCredential: ({ signal } = {}) => {
      if (!bootstrapVault) throw new Error("dgmat_bootstrap_vault_unavailable");
      return bootstrapVault.getSecret("bootstrap", { signal });
    }
  });
  const adapter = new DgmMatReadOnlyAdapter({
    ...adapterOptions,
    baseUrl,
    getAccessToken: ({ signal } = {}) => sessionProvider.getAccessToken({ signal }),
    invalidateAccessToken: () => sessionProvider.invalidate()
  });

  const host = hostFactory(hostOptions);
  if (!host || typeof host.createSecretStore !== "function"
    || typeof host.close !== "function" || !host.ready) {
    try { void Promise.resolve(host?.close?.()).catch(() => {}); } catch {}
    throw new TypeError("dgmat_windows_host_secret_store_unavailable");
  }
  try {
    bootstrapVault = host.createSecretStore("dgmat.bootstrap");
  } catch (error) {
    try { void Promise.resolve(host.close()).catch(() => {}); } catch {}
    throw error;
  }

  let closed = false;

  async function ensureOpen() {
    if (closed) throw new Error("dgmat_windows_host_closed");
    await host.ready;
  }

  async function provisionBootstrapCredential({ secret, ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("dgmat_bootstrap_owner_consent_required");
    if (typeof secret !== "string" || secret.length < 60 || secret.length > 8_192
      || secret.trim() !== secret || /\\s/.test(secret)) {
      throw new Error("dgm_mat_bootstrap_credential_invalid");
    }
    await ensureOpen();
    await bootstrapVault.setSecret("bootstrap", secret);
    return Object.freeze({
      stored: true,
      provider: "windows-cng-software-ksp-secret-vault",
      protectionLevel: "os-protected",
      hardwareBacked: false,
      backupRestoreRequiresSameUserProfile: true,
      bootstrapCredentialRetainedInMemory: false
    });
  }

  async function removeBootstrapCredential({ ownerConsent } = {}) {
    if (ownerConsent !== true) throw new Error("dgmat_bootstrap_owner_consent_required");
    await ensureOpen();
    await disconnect();
    return bootstrapVault.destroy();
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
    if (closed) throw new Error("dgmat_windows_host_closed");
    return adapter.subscribe(listener);
  }

  async function disconnect() {
    if (closed) return { disconnected: true };
    try {
      await adapter.disconnect();
    } finally {
      await sessionProvider.disconnect();
    }
    return { disconnected: true };
  }

  async function health() {
    if (closed) return Object.freeze({ status: "stopped", edition: "dgmat" });
    const hostHealth = await host.health();
    return Object.freeze({
      ...hostHealth,
      edition: "dgmat",
      adapterConnected: adapter.connected === true,
      backendSession: sessionProvider.getState(),
      backendOperationalState: "unverified"
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    try {
      await adapter.disconnect();
    } finally {
      try {
        await sessionProvider.disconnect();
      } finally {
        await host.close();
      }
    }
  }

  return Object.freeze({
    edition: "dgmat",
    installationId: host.installationId,
    ready: host.ready,
    provisionBootstrapCredential,
    removeBootstrapCredential,
    connect,
    getSnapshot,
    subscribe,
    disconnect,
    health,
    getSessionState: () => sessionProvider.getState(),
    close
  });
}
