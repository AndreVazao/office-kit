export const CONTRACT_VERSION = 1;
export const CONNECTION_STATES = Object.freeze(["connected", "degraded", "disconnected", "not-configured"]);
export const OPERATIONAL_STATES = Object.freeze(["working", "idle", "blocked", "attention-required", "unknown"]);
export const SOCIAL_ACTIVITIES = Object.freeze(["at-desk", "walking", "coffee-break", "looking-at-clock", "chatting", "balcony-break", "resting"]);

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function validateOfficeConfig(config) {
  const errors = [];
  if (!isObject(config)) return { valid: false, errors: ["Configuration must be an object."] };
  if (config.contractVersion !== CONTRACT_VERSION) errors.push("contractVersion must be " + CONTRACT_VERSION + ".");
  if (!nonEmpty(config.id)) errors.push("id must be a non-empty string.");
  if (!nonEmpty(config.name)) errors.push("name must be a non-empty string.");
  if (!isObject(config.scene)) errors.push("scene must be an object.");
  else {
    if (!["diorama", "floorplan", "dashboard"].includes(config.scene.layout)) errors.push("scene.layout must be diorama, floorplan, or dashboard.");
    if (!["auto", "portrait", "landscape"].includes(config.scene.orientation)) errors.push("scene.orientation must be auto, portrait, or landscape.");
  }
  if (!Array.isArray(config.departments) || config.departments.length === 0) errors.push("departments must be a non-empty array.");
  else {
    const ids = new Set();
    for (const [index, dept] of config.departments.entries()) {
      if (!isObject(dept)) { errors.push("departments[" + index + "] must be an object."); continue; }
      if (!nonEmpty(dept.id)) errors.push("departments[" + index + "].id is required.");
      else if (ids.has(dept.id)) errors.push('department id "' + dept.id + '" is duplicated.');
      else ids.add(dept.id);
      if (!nonEmpty(dept.name)) errors.push("departments[" + index + "].name is required.");
      if (dept.agents !== undefined && !Array.isArray(dept.agents)) errors.push("departments[" + index + "].agents must be an array.");
      for (const [agentIndex, agent] of (Array.isArray(dept.agents) ? dept.agents : []).entries()) {
        if (!isObject(agent) || !nonEmpty(agent.id) || !nonEmpty(agent.name)) errors.push("departments[" + index + "].agents[" + agentIndex + "] requires id and name.");
      }
    }
  }
  if (config.backend !== undefined && !isObject(config.backend)) errors.push("backend must be an object.");
  return { valid: errors.length === 0, errors };
}

export function normalizeOfficeConfig(config) {
  const result = validateOfficeConfig(config);
  if (!result.valid) {
    const error = new Error("Invalid Office Kit configuration.");
    error.validationErrors = result.errors;
    throw error;
  }
  return structuredClone(config);
}

/** Social animation is local presentation, never evidence of real work. */
export function deriveAgentPresentation({ backendConfigured = false, connection = "not-configured", operationalState = "unknown", lastSeenAt = null, now = Date.now(), staleAfterMs = 30000 } = {}) {
  if (!backendConfigured) return { source: "local-simulation", label: "Simulação local", operationalState: "unknown", stale: false, diagnosis: null };
  const validConnection = CONNECTION_STATES.includes(connection) ? connection : "degraded";
  const seen = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? lastSeenAt : null;
  const stale = seen === null || now - seen > staleAfterMs;
  if (validConnection !== "connected" || stale) return {
    source: "backend-unverified", label: "Sem confirmação do backend", operationalState: "unknown",
    stale, diagnosis: "unknown", connection: validConnection
  };
  const state = OPERATIONAL_STATES.includes(operationalState) ? operationalState : "unknown";
  const labels = { working: "A trabalhar (confirmado)", "attention-required": "Requer atenção", blocked: "Bloqueado", idle: "Disponível", unknown: "Estado desconhecido" };
  return { source: "backend", label: labels[state], operationalState: state, stale: false, diagnosis: null, connection: validConnection };
}

export function chooseSocialActivity(seed, agentId, tick = 0) {
  const input = String(seed) + ":" + String(agentId) + ":" + Math.floor(tick);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return SOCIAL_ACTIVITIES[(hash >>> 0) % SOCIAL_ACTIVITIES.length];
}

export function deriveDepartmentHealth({ backendConfigured = false, connection = "not-configured", lastSeenAt = null, now = Date.now(), staleAfterMs = 30000 } = {}) {
  if (!backendConfigured) return { zone: "normal", status: "simulation-only", message: "Backend não configurado; sem diagnóstico operacional." };
  const seen = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? lastSeenAt : null;
  if (connection !== "connected" || seen === null || now - seen > staleAfterMs) {
    return { zone: "infirmary", status: "unverified", message: "Ligação ou heartbeat em falta; investigar, sem diagnóstico confirmado." };
  }
  return { zone: "normal", status: "online", message: "Comunicação recente confirmada." };
}
