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
  let diagnosticsEngine = null;
  let lastDiagnosticReport = null;
  let lastProbeSnapshot = null;
  let lastProbeError = null;
  let lastConfirmedAt = null;

  function classifyConnectionFailure(error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "vst_auth_rejected") return "authentication_rejected";
    if (code === "vst_http_403") return "authorization_denied";
    if (code === "vst_request_timeout" || code === "vst_transport_error" || code === "vst_http_0") {
      return "connectivity_unavailable";
    }
    if (/^vst_http_5[0-9]{2}$/.test(code)) return "backend_unavailable";
    if (code === "vst_http_404") return "backend_contract_mismatch";
    return "connection_failed";
  }

  function getDiagnosticsEngine() {
    if (diagnosticsEngine) return diagnosticsEngine;
    if (typeof host.createDiagnostics !== "function") throw new Error("vst_diagnostics_unavailable");
    diagnosticsEngine = host.createDiagnostics({
      probes: [
        {
          id: "vst-host-runtime",
          layer: "office_runtime",
          run: async () => {
            try {
              await host.ready;
              return { ok: !closed, code: closed ? "host_closed" : "ok", evidence: closed ? "VST host is closed." : "VST host runtime is available." };
            } catch {
              return { ok: false, code: "probe_error", evidence: "VST host readiness could not be verified." };
            }
          }
        },
        {
          id: "vst-adapter-session",
          layer: "adapter",
          run: () => {
            const ok = !closed && sessionToken !== null && adapter.connected === true;
            return {
              ok,
              code: ok ? "ok" : "session_unavailable",
              evidence: ok ? "VST adapter has an owner-approved active session." : "VST adapter session is not connected."
            };
          }
        },
        {
          id: "vst-authenticated-transport",
          layer: "transport",
          run: async () => {
            lastProbeSnapshot = null;
            lastProbeError = null;
            if (!sessionToken && lastConnectionFailure === "authentication_rejected") {
              lastProbeError = "vst_auth_rejected";
              return { ok: true, code: "reachable", evidence: "A prior HTTP 401 response confirms the VST endpoint was reachable; authentication was rejected." };
            }
            if (!sessionToken) {
              lastProbeError = "vst_session_token_unavailable";
              return { ok: false, code: "probe_error", evidence: "No owner-approved session token is available for an authenticated transport probe." };
            }
            try {
              lastProbeSnapshot = await adapter.probeConnectivity();
              return { ok: true, code: "ok", evidence: "Authenticated VST observer endpoint returned a valid response." };
            } catch (error) {
              lastProbeError = error instanceof Error ? error.message : "vst_transport_error";
              if (lastProbeError === "vst_auth_rejected" || /^vst_http_/.test(lastProbeError)) {
                return { ok: true, code: "reachable", evidence: "VST returned an HTTP response; the transport reached the backend." };
              }
              return {
                ok: false,
                code: lastProbeError === "vst_request_timeout" ? "timeout" : "probe_error",
                evidence: lastProbeError === "vst_request_timeout"
                  ? "Authenticated observer request exceeded its deadline."
                  : "Authenticated observer transport did not return a verifiable response."
              };
            }
          }
        },
        {
          id: "vst-authoritative-observer",
          layer: "backend",
          run: () => {
            if (lastProbeError === "vst_auth_rejected") {
              return { ok: false, code: "authentication_rejected", evidence: "VST rejected the owner session token with HTTP 401." };
            }
            if (lastProbeError === "vst_http_403") {
              return { ok: false, code: "authorization_denied", evidence: "VST rejected the requested private-state scope with HTTP 403." };
            }
            if (/^vst_http_5/.test(lastProbeError ?? "")) {
              return { ok: false, code: "backend_unavailable", evidence: "VST returned a server-side HTTP error." };
            }
            if (lastProbeError === "vst_http_404") {
              return { ok: false, code: "contract_mismatch", evidence: "VST did not expose the expected observer route." };
            }
            if (!lastProbeSnapshot) {
              return { ok: false, code: "probe_error", evidence: "No authoritative observer snapshot was obtained." };
            }
            if (lastProbeSnapshot.backend?.observerResponseAccepted !== true) {
              return { ok: false, code: "observer_rejected", evidence: "VST observer response was not accepted by the adapter contract." };
            }
            if (lastProbeSnapshot.synchronized !== true
              || lastProbeSnapshot.backend?.sourceSnapshotFreshness !== "fresh") {
              return { ok: false, code: "snapshot_stale", evidence: "VST observer snapshot is not fresh and synchronized." };
            }
            return { ok: true, code: "ok", evidence: "VST observer snapshot is fresh, accepted and synchronized." };
          }
        }
      ],
      recoveryActions: [{
        id: "vst-local-adapter-reconnect",
        scope: "local_adapter",
        run: async () => {
          if (!sessionToken) return { ok: false, code: "session_unavailable", evidence: "Owner authentication is required before reconnecting." };
          if (adapter.authenticationRejected || lastProbeError === "vst_auth_rejected"
            || lastProbeError === "vst_http_403" || /^vst_http_5/.test(lastProbeError ?? "")
            || lastProbeError === "vst_http_404") {
            return { ok: false, code: "owner_action_required", evidence: "Authentication, authorization or backend contract must be resolved by the owner; automatic reconnect was not attempted." };
          }
          if (adapter.connected && !["vst_request_timeout", "vst_transport_error"].includes(lastProbeError ?? "")) {
            return { ok: false, code: "recovery_not_applicable", evidence: "No local adapter reconnect condition was established." };
          }
          try {
            await adapter.disconnect();
            await adapter.connect();
            lastConnectionFailure = null;
            lastAuthorizationFailure = null;
            lastProbeError = null;
            return { ok: true, code: "reconnected", evidence: "Local adapter reconnected; authoritative snapshot verification follows as a separate bounded step." };
          } catch (error) {
            lastConnectionFailure = classifyConnectionFailure(error);
            if (error?.message === "vst_auth_rejected") {
              sessionToken = null;
              await adapter.disconnect();
            }
            return { ok: false, code: "reconnect_failed", evidence: "Local adapter reconnect did not complete; no backend process was restarted." };
          }
        }
      }]
    });
    return diagnosticsEngine;
  }

  async function diagnose() {
    await ensureOpen();
    if (!sessionToken && lastConnectionFailure !== "authentication_rejected") {
      return Object.freeze({ state: "not_configured", diagnostics: null, incidentId: null });
    }
    if (sessionToken && !adapter.connected && !lastConnectionFailure) {
      return Object.freeze({ state: "not_connected", diagnostics: null, incidentId: null });
    }
    const engine = getDiagnosticsEngine();
    const report = await engine.diagnose({
      edition: "vst",
      officeKitVersion: String((await host.health())?.version ?? "unknown"),
      adapterId: "vazao-sovereign-trader",
      backendId: "vst-local-api",
      lastConfirmedAt,
      connectionState: adapter.connected && lastProbeSnapshot?.synchronized === true ? "live"
        : adapter.connected ? "synchronizing" : "disconnected",
      authoritativeStateVerified: lastProbeSnapshot?.synchronized === true,
      snapshotFresh: lastProbeSnapshot?.backend?.sourceSnapshotFreshness === "fresh"
    });
    lastDiagnosticReport = report;
    if (lastProbeSnapshot?.synchronized === true) lastConfirmedAt = lastProbeSnapshot.generatedAt;
    return Object.freeze({
      state: report.status,
      diagnostics: report,
      incidentId: report.incidentId ?? null,
      lastConfirmedAt
    });
  }

  async function attemptRecovery() {
    const diagnosis = await diagnose();
    if (diagnosis.state === "not_configured") {
      return Object.freeze({ recovered: false, blocked: true, reason: "session_not_configured", diagnosis });
    }
    if (diagnosis.state === "not_connected") {
      return Object.freeze({ recovered: false, blocked: true, reason: "connection_not_attempted", diagnosis });
    }
    if (diagnosis.state === "healthy") {
      return Object.freeze({ recovered: false, blocked: true, reason: "recovery_not_required", diagnosis });
    }
    if (!sessionToken) {
      return Object.freeze({ recovered: false, blocked: true, reason: "owner_reauthentication_required", diagnosis });
    }
    if (["vst_auth_rejected", "vst_http_403", "vst_http_404"].includes(lastProbeError)
      || /^vst_http_5/.test(lastProbeError ?? "")) {
      return Object.freeze({ recovered: false, blocked: true, reason: "owner_or_backend_action_required", diagnosis });
    }
    const recoverableTransportFailure = ["vst_request_timeout", "vst_transport_error"].includes(lastProbeError ?? "");
    if (adapter.connected && !recoverableTransportFailure) {
      return Object.freeze({ recovered: false, blocked: true, reason: "recovery_scope_not_established", diagnosis });
    }
    if (!adapter.connected && lastProbeError && !recoverableTransportFailure) {
      return Object.freeze({ recovered: false, blocked: true, reason: "recovery_scope_not_established", diagnosis });
    }
    const engine = getDiagnosticsEngine();
    const outcome = await engine.attemptRecovery({
      edition: "vst",
      adapterId: "vazao-sovereign-trader",
      verifyFreshSnapshot: async () => {
        try {
          const snapshot = await adapter.getSnapshot();
          lastProbeSnapshot = snapshot;
          const fresh = snapshot.backend?.sourceSnapshotFreshness === "fresh";
          const consistent = snapshot.backend?.observerResponseAccepted === true
            && snapshot.backend?.mode !== "UNKNOWN";
          if (fresh && consistent && snapshot.synchronized === true) {
            lastConfirmedAt = snapshot.generatedAt;
            return { ok: true, fresh: true, consistent: true, code: "fresh_snapshot_verified" };
          }
          return { ok: false, fresh, consistent, code: "snapshot_not_fresh_or_consistent" };
        } catch {
          return { ok: false, fresh: false, consistent: false, code: "snapshot_verification_failed" };
        }
      }
    });
    if (outcome.recovered) {
      lastConnectionFailure = null;
      lastAuthorizationFailure = null;
      lastProbeError = null;
    }
    lastDiagnosticReport = diagnosis.diagnostics;
    return Object.freeze({ ...outcome, diagnosis });
  }

  async function ensureOpen() {
    if (closed) throw new Error("vst_windows_host_closed");
    await host.ready;
  }

  async function clearRejectedSession(error) {
    if (error?.message === "vst_auth_rejected") {
      lastConnectionFailure = "authentication_rejected";
      lastAuthorizationFailure = null;
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
      const snapshot = await adapter.getSnapshot();
      if (snapshot.synchronized === true) lastConfirmedAt = snapshot.generatedAt;
      return snapshot;
    } catch (error) {
      lastConnectionFailure = classifyConnectionFailure(error);
      if (lastConnectionFailure === "authorization_denied") lastAuthorizationFailure = "read_private_state";
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
        lastProbeError = "vst_http_403";
      }
      return snapshot;
    } catch (error) {
      lastConnectionFailure = classifyConnectionFailure(error);
      if (lastConnectionFailure === "authorization_denied") lastAuthorizationFailure = "read_private_state";
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
      } else if (result.reconciliation === "permission_denied") {
        lastAuthorizationFailure = result.reconciliationRequiredScope ?? "read_private_state";
      }
      if (result.intent === "PERMISSION_DENIED") lastProbeError = "vst_http_403";
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
      lastConnectionFailure = null;
      lastAuthorizationFailure = null;
      lastProbeError = null;
      lastProbeSnapshot = null;
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
      authorizationState: lastConnectionFailure === "authorization_denied"
        ? "denied" : lastAuthorizationFailure ? "scope_denied"
          : adapter.connected ? "read_private_state_granted" : "not_checked",
      connectivityState: adapter.connected
        ? "connected" : lastConnectionFailure === "connectivity_unavailable" ? "unavailable"
          : ["authentication_rejected", "authorization_denied", "backend_unavailable", "backend_contract_mismatch"].includes(lastConnectionFailure)
            ? "reachable" : "disconnected",
      lastConnectionFailure,
      lastAuthorizationFailure,
      diagnosticsState: lastDiagnosticReport?.status ?? "not_run",
      lastIncidentId: lastDiagnosticReport?.incidentId ?? null,
      lastConfirmedAt,
      backendOperationalState: "unverified",
      backendReadOnly: false,
      backendWriteScope: "assistant_message_only",
      financialActionsAllowed: false,
      paperControlsEnabled: false,
      executionAuthorized: false,
      riskBearingActionsAllowed: false
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
    diagnose,
    attemptRecovery,
    subscribe,
    disconnect,
    health,
    getCredentialState,
    close
  });
}
