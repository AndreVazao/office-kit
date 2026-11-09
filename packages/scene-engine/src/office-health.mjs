const LAYERS = Object.freeze(["office_runtime", "adapter", "transport", "backend"]);
const SAFE_RECOVERY_SCOPES = new Set(["local_adapter", "local_session", "local_configuration"]);
const SECRET_PATTERNS = [
  /bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /(token|password|secret|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi
];

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const safeCode = (value, fallback) => typeof value === "string" && /^[a-z0-9_.:-]{1,120}$/i.test(value) ? value : fallback;
const safeText = value => {
  if (typeof value !== "string") return "";
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value).slice(0, 2_000);
};
const iso = value => new Date(value).toISOString();

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
  #recoveryActions;
  #maxRecoveryActions;

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
        results.push(normalizeProbeResult(probe, await probe.run({ ...context, readOnly: true }), checkedAt));
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
    const classification = classify(results);
    const report = {
      schemaVersion: 1,
      status: classification.status,
      origin: classification.origin,
      confidence: classification.confidence,
      checkedAt: iso(this.#clock()),
      results
    };
    if (report.status !== "healthy") await this.#recordIncident(report, context);
    return report;
  }

  async #recordIncident(report, context) {
    this.#sequence += 1;
    const occurredAt = this.#clock();
    const incident = {
      schemaVersion: 1,
      id: `office-incident-${occurredAt}-${this.#sequence}`,
      occurredAt: iso(occurredAt),
      edition: safeText(context.edition ?? ""),
      officeKitVersion: safeText(context.officeKitVersion ?? ""),
      adapterId: safeText(context.adapterId ?? ""),
      backendId: safeText(context.backendId ?? ""),
      lastConfirmedAt: context.lastConfirmedAt ? safeText(String(context.lastConfirmedAt)) : null,
      status: report.status,
      origin: report.origin,
      confidence: report.confidence,
      diagnostics: report.results,
      recoveryAttempts: [],
      outcome: "unresolved"
    };
    this.#lastIncidentId = incident.id;
    this.#recoveryHistory = [];
    await this.#store.append(incident);
    return incident;
  }

  async attemptRecovery(context = {}) {
    const attempts = [];
    for (const action of this.#recoveryActions.slice(0, this.#maxRecoveryActions)) {
      const attemptedAt = iso(this.#clock());
      try {
        const result = await action.run({ ...context, scope: action.scope });
        attempts.push({
          actionId: action.id,
          scope: action.scope,
          attemptedAt,
          ok: isRecord(result) && result.ok === true,
          code: safeCode(isRecord(result) ? result.code : null, "completed"),
          evidence: safeText(isRecord(result) ? result.evidence : "")
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
    const verification = typeof context.verifyFreshSnapshot === "function"
      ? await context.verifyFreshSnapshot()
      : { ok: false, code: "fresh_snapshot_verifier_missing" };
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
