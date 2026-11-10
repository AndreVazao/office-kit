const LAYERS = Object.freeze(["office_runtime", "adapter", "transport", "backend"]);
const SAFE_RECOVERY_SCOPES = new Set(["local_adapter", "local_session", "local_configuration"]);
const SECRET_PATTERNS = [
  /bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi
];

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const CODE_PATTERN = /^[a-z][a-z0-9]{0,31}(?:[._:-][a-z0-9]{1,32}){0,5}$/i;
const SECRET_CODE_PATTERNS = [
  /^(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[_-]/i,
  /(?:token|password|secret|api[_-]?key|authorization|cookie|private[_-]?key)/i,
  /^[a-f0-9]{32,}$/i,
  /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/
];
const safeCode = (value, fallback) => {
  if (typeof value !== "string" || value.length > 80 || !CODE_PATTERN.test(value)) return fallback;
  return SECRET_CODE_PATTERNS.some(pattern => pattern.test(value)) ? fallback : value;
};
const safeText = value => {
  if (typeof value !== "string") return "";
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value).slice(0, 2_000);
};
const iso = value => new Date(value).toISOString();

async function runBounded(run, timeoutMs, context) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });
  const operation = Promise.resolve()
    .then(() => run({ ...context, signal: controller.signal }))
    .then(value => ({ value }), error => ({ error }));
  const result = await Promise.race([operation, timeout]);
  clearTimeout(timer);
  if (result.timedOut) return { timedOut: true };
  if (result.error) throw result.error;
  return { value: result.value };
}

function normalizeProbeResult(probe, result, checkedAt) {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    return { probeId: probe.id, layer: probe.layer, ok: false, code: "invalid_probe_result", evidence: "Probe returned an invalid result.", checkedAt };
  }
  return {
    probeId: probe.id,
    layer: probe.layer,
    ok: result.ok,
    code: safeCode(result.code, result.ok ? "ok" : "probe_failed"),
    evidence: safeText(result.evidence),
    checkedAt
  };
}

function classify(results) {
  const failed = results.filter(result => !result.ok);
  if (!failed.length) return { origin: "none", confidence: "confirmed", status: "healthy" };
  const firstLayer = LAYERS.find(layer => failed.some(result => result.layer === layer));
  const layerFailures = failed.filter(result => result.layer === firstLayer);
  if (firstLayer && layerFailures.every(result => result.code !== "timeout" && result.code !== "probe_error" && result.code !== "invalid_probe_result")) {
    return { origin: firstLayer, confidence: "probable", status: "degraded" };
  }
  return { origin: "indeterminate", confidence: "indeterminate", status: "degraded" };
}

/**
 * Host-injected diagnostic and recovery coordinator. Probes must be explicitly
 * authorized by the host and should be read-only. Recovery actions are limited
 * to local adapter/session/configuration scopes.
 */
export class OfficeHealthRecoveryEngine {
  #probes;
  #store;
  #clock;
  #sequence = 0;
  #lastIncidentId = null;
  #recoveryHistory = [];
  #diagnosticHistory = [];
  #recoveryActions;
  #maxRecoveryActions;
  #probeTimeoutMs;
  #recoveryTimeoutMs;

  constructor(options = {}) {
    if (!Array.isArray(options.probes) || !options.probes.every(probe =>
      isRecord(probe) && nonEmpty(probe.id) && LAYERS.includes(probe.layer) && typeof probe.run === "function")) {
      throw new TypeError("probes must contain id, recognized layer and run function.");
    }
    const ids = options.probes.map(probe => probe.id);
    if (new Set(ids).size !== ids.length) throw new TypeError("probe ids must be unique.");
    if (!options.incidentStore || typeof options.incidentStore.append !== "function" || typeof options.incidentStore.update !== "function") {
      throw new TypeError("incidentStore.append and incidentStore.update are required.");
    }
    this.#probes = [...options.probes];
    this.#store = options.incidentStore;
    this.#clock = typeof options.clock === "function" ? options.clock : Date.now;
    this.#recoveryActions = Array.isArray(options.recoveryActions) ? options.recoveryActions : [];
    this.#maxRecoveryActions = options.maxRecoveryActions ?? 3;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
    this.#recoveryTimeoutMs = options.recoveryTimeoutMs ?? 5_000;
    if (!Number.isInteger(this.#probeTimeoutMs) || this.#probeTimeoutMs < 10 || this.#probeTimeoutMs > 60_000) throw new RangeError("probe_timeout_out_of_range");
    if (!Number.isInteger(this.#recoveryTimeoutMs) || this.#recoveryTimeoutMs < 10 || this.#recoveryTimeoutMs > 60_000) throw new RangeError("recovery_timeout_out_of_range");
    if (!Number.isInteger(this.#maxRecoveryActions) || this.#maxRecoveryActions < 0 || this.#maxRecoveryActions > 10) {
      throw new RangeError("maxRecoveryActions must be an integer between 0 and 10.");
    }
    for (const action of this.#recoveryActions) {
      if (!isRecord(action) || !nonEmpty(action.id) || !SAFE_RECOVERY_SCOPES.has(action.scope) || typeof action.run !== "function") {
        throw new TypeError("recovery actions must be local, scoped and executable.");
      }
    }
  }

  async diagnose(context = {}) {
    const results = [];
    for (const probe of this.#probes) {
      const checkedAt = iso(this.#clock());
      try {
        const execution = await runBounded(probe.run, this.#probeTimeoutMs, { ...context, readOnly: true });
        if (execution.timedOut) {
          results.push({
            probeId: probe.id,
            layer: probe.layer,
            ok: false,
            code: "timeout",
            evidence: "Diagnostic probe exceeded its execution deadline.",
            checkedAt
          });
        } else {
          results.push(normalizeProbeResult(probe, execution.value, checkedAt));
        }
      } catch (error) {
        results.push({
          probeId: probe.id,
          layer: probe.layer,
          ok: false,
          code: "probe_error",
          evidence: safeText(error?.message ?? "Probe failed."),
          checkedAt
        });
      }
    }
    if (nonEmpty(context.sessionReason) && context.connectionState !== "live") {
      results.push({
        probeId: "runtime-session-transition",
        layer: "transport",
        ok: false,
        code: safeCode(context.sessionReason, "connection_lost"),
        evidence: "The previously verified backend session is no longer live.",
        checkedAt: iso(this.#clock())
      });
    }
    const classification = classify(results);
    const report = {
      schemaVersion: 1,
      status: classification.status,
      origin: classification.origin,
      confidence: classification.confidence,
      checkedAt: iso(this.#clock()),
      results
    };
    if (report.status !== "healthy") {
      const incident = await this.#recordIncident(report, context);
      report.incidentId = incident.id;
    } else if (this.#lastIncidentId && context.authoritativeStateVerified === true &&
      context.snapshotFresh === true && context.connectionState === "live") {
      const resolvedAt = iso(this.#clock());
      await this.#store.update(this.#lastIncidentId, {
        status: "healthy",
        outcome: "recovered",
        resolvedAt,
        resolution: "fresh_authoritative_snapshot_and_all_diagnostic_probes_passed",
        finalDiagnostics: report.results
      });
      report.incidentId = this.#lastIncidentId;
      this.#lastIncidentId = null;
      this.#recoveryHistory = [];
      this.#diagnosticHistory = [];
    } else if (this.#lastIncidentId) {
      report.incidentId = this.#lastIncidentId;
    }
    return report;
  }

  async #recordIncident(report, context) {
    const observedAt = iso(this.#clock());
    const diagnosticHistory = [
      ...this.#diagnosticHistory,
      {
        observedAt,
        status: report.status,
        origin: report.origin,
        confidence: report.confidence,
        diagnostics: report.results
      }
    ].slice(-100);
    if (this.#lastIncidentId) {
      await this.#store.update(this.#lastIncidentId, {
        lastObservedAt: observedAt,
        status: report.status,
        origin: report.origin,
        confidence: report.confidence,
        diagnostics: report.results,
        diagnosticHistory
      });
      this.#diagnosticHistory = diagnosticHistory;
      return { id: this.#lastIncidentId };
    }
    this.#sequence += 1;
    const incident = {
      schemaVersion: 1,
      id: `office-incident-${this.#clock()}-${this.#sequence}`,
      occurredAt: observedAt,
      edition: safeText(context.edition ?? ""),
      officeKitVersion: safeText(context.officeKitVersion ?? ""),
      adapterId: safeText(context.adapterId ?? ""),
      backendId: safeText(context.backendId ?? ""),
      lastConfirmedAt: context.lastConfirmedAt ? safeText(String(context.lastConfirmedAt)) : null,
      status: report.status,
      origin: report.origin,
      confidence: report.confidence,
      diagnostics: report.results,
      diagnosticHistory,
      recoveryAttempts: [],
      outcome: "unresolved"
    };
    await this.#store.append(incident);
    this.#lastIncidentId = incident.id;
    this.#diagnosticHistory = diagnosticHistory;
    this.#recoveryHistory = [];
    return incident;
  }

  async attemptRecovery(context = {}) {
    const attempts = [];
    for (const action of this.#recoveryActions.slice(0, this.#maxRecoveryActions)) {
      const attemptedAt = iso(this.#clock());
      try {
        const execution = await runBounded(action.run, this.#recoveryTimeoutMs, { ...context, scope: action.scope });
        const result = execution.value;
        attempts.push({
          actionId: action.id,
          scope: action.scope,
          attemptedAt,
          ok: !execution.timedOut && isRecord(result) && result.ok === true,
          code: execution.timedOut ? "timeout" : safeCode(isRecord(result) ? result.code : null, "completed"),
          evidence: execution.timedOut ? "Local recovery action exceeded its execution deadline." : safeText(isRecord(result) ? result.evidence : "")
        });
      } catch (error) {
        attempts.push({
          actionId: action.id,
          scope: action.scope,
          attemptedAt,
          ok: false,
          code: "recovery_error",
          evidence: safeText(error?.message ?? "Recovery action failed.")
        });
      }
    }
    const verificationExecution = typeof context.verifyFreshSnapshot === "function"
      ? await runBounded(context.verifyFreshSnapshot, this.#recoveryTimeoutMs, {})
      : { value: { ok: false, code: "fresh_snapshot_verifier_missing" } };
    const verification = verificationExecution.timedOut
      ? { ok: false, code: "fresh_snapshot_verification_timeout" }
      : verificationExecution.value;
    const recovered = isRecord(verification) && verification.ok === true && verification.fresh === true && verification.consistent === true;
    const outcome = {
      status: recovered ? "recovered" : "unresolved",
      recovered,
      attempts,
      verification: {
        ok: recovered,
        code: isRecord(verification) && nonEmpty(verification.code) ? verification.code : recovered ? "fresh_snapshot_verified" : "snapshot_not_verified"
      },
      completedAt: iso(this.#clock())
    };
    if (this.#lastIncidentId) {
      this.#recoveryHistory.push(...attempts);
      await this.#store.update(this.#lastIncidentId, {
        recoveryAttempts: this.#recoveryHistory,
        outcome: outcome.status,
        recoveryVerification: outcome.verification,
        recoveredAt: recovered ? outcome.completedAt : null
      });
    }
    return outcome;
  }
}

/**
 * Event-driven connection supervisor. The host feeds authoritative session
 * transitions; this class does not create timers, sockets, or backend traffic.
 * It diagnoses only a confirmed live-to-unhealthy transition and verifies
 * recovery with a fresh authoritative snapshot before closing the incident.
 */
export class OfficeConnectionSupervisor {
  #health;
  #wasLive = false;
  #lastConfirmedAt = null;
  #outageOpen = false;
  #pending = Promise.resolve();

  constructor(options = {}) {
    if (!options.healthEngine || typeof options.healthEngine.diagnose !== "function") {
      throw new TypeError("healthEngine.diagnose is required.");
    }
    this.#health = options.healthEngine;
  }

  observe(sessionState, context = {}) {
    const operation = this.#pending.then(
      () => this.#observe(sessionState, context),
      () => this.#observe(sessionState, context)
    );
    this.#pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #observe(sessionState, context = {}) {
    if (!isRecord(sessionState) || typeof sessionState.connectionState !== "string") {
      throw new TypeError("sessionState.connectionState is required.");
    }
    const verifiedLive = sessionState.connectionState === "live" &&
      sessionState.authoritativeStateVerified === true;
    if (verifiedLive) {
      this.#wasLive = true;
      this.#lastConfirmedAt = sessionState.lastHeartbeatAt ?? context.lastConfirmedAt ?? iso(Date.now());
      if (!this.#outageOpen) {
        return { transition: "healthy", diagnostics: null, lastConfirmedAt: this.#lastConfirmedAt };
      }
      const diagnostics = await this.#health.diagnose({
        ...context,
        connectionState: "live",
        authoritativeStateVerified: true,
        snapshotFresh: true,
        lastConfirmedAt: this.#lastConfirmedAt
      });
      if (diagnostics.status === "healthy") this.#outageOpen = false;
      return {
        transition: diagnostics.status === "healthy" ? "recovered" : "recovery_unverified",
        diagnostics,
        lastConfirmedAt: this.#lastConfirmedAt
      };
    }

    if (!this.#wasLive || !["disconnected", "stale", "error", "connecting", "synchronizing"].includes(sessionState.connectionState)) {
      return { transition: "not_yet_established", diagnostics: null, lastConfirmedAt: this.#lastConfirmedAt };
    }
    if (this.#outageOpen) {
      return { transition: "outage_ongoing", diagnostics: null, lastConfirmedAt: this.#lastConfirmedAt };
    }
    this.#outageOpen = true;
    const diagnostics = await this.#health.diagnose({
      ...context,
      connectionState: sessionState.connectionState,
      authoritativeStateVerified: false,
      snapshotFresh: false,
      lastConfirmedAt: this.#lastConfirmedAt,
      sessionReason: safeCode(sessionState.reason, "connection_lost")
    });
    return {
      transition: "connection_lost",
      diagnostics,
      lastConfirmedAt: this.#lastConfirmedAt
    };
  }

  getState() {
    return {
      wasLive: this.#wasLive,
      outageOpen: this.#outageOpen,
      lastConfirmedAt: this.#lastConfirmedAt
    };
  }
}

export class InMemoryIncidentStore {
  #incidents = [];

  async append(incident) {
    if (!isRecord(incident) || !nonEmpty(incident.id)) throw new TypeError("incident.id is required.");
    if (this.#incidents.some(item => item.id === incident.id)) throw new Error("duplicate_incident_id");
    this.#incidents.push(structuredClone(incident));
    return incident.id;
  }

  async update(id, patch) {
    const index = this.#incidents.findIndex(incident => incident.id === id);
    if (index < 0) throw new Error("incident_not_found");
    this.#incidents[index] = { ...this.#incidents[index], ...structuredClone(patch) };
    return id;
  }

  async list() {
    return this.#incidents.map(incident => structuredClone(incident));
  }

  async export() {
    return JSON.stringify({ schemaVersion: 1, incidents: await this.list() }, null, 2);
  }
}

export const officeHealthContract = Object.freeze({
  schemaVersion: 1,
  layers: Object.freeze([...LAYERS]),
  classifications: Object.freeze(["office_runtime", "adapter", "transport", "backend", "indeterminate", "none"]),
  confidence: Object.freeze(["confirmed", "probable", "indeterminate"]),
  recoveryScopes: Object.freeze([...SAFE_RECOVERY_SCOPES])
});
