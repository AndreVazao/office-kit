const CONNECTION_STATES = new Set(["disconnected", "connecting", "connected", "synchronizing", "live", "stale", "error"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validProgress = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

function socialAgents(agents) {
  if (!Array.isArray(agents)) return [];
  return agents.filter(isRecord).map(agent => ({
    id: agent.id,
    name: agent.name ?? agent.id,
    departmentId: agent.departmentId ?? null,
    status: "social",
    activity: agent.activity ?? "walk",
    location: agent.location ?? "office",
    simulated: true,
    activitySource: "local_social_simulation",
    progress: null,
    healthStatus: "unknown"
  }));
}

/**
 * Resolves the visible activity authority for the office. Simulated activity
 * never inherits backend task IDs or progress.
 */
export function resolveOfficeActivityState(input = {}) {
  if (typeof input.backendConfigured !== "boolean") {
    throw new TypeError("backendConfigured must be a boolean.");
  }
  const backendState = input.connectionState ?? "disconnected";
  if (!CONNECTION_STATES.has(backendState)) throw new RangeError("invalid_connection_state");
  const connectedBefore = input.everConnected === true;
  const verifiedLive = input.backendConfigured &&
    backendState === "live" &&
    input.synchronized === true &&
    input.authoritativeStateVerified === true;

  if (!input.backendConfigured) {
    return {
      mode: "offline_social_simulation",
      connection: "not_configured",
      banner: "OFFLINE — Movimento social simulado. Nenhuma atividade real de backend está a ser executada.",
      simulated: true,
      operationalStateVerified: false,
      agents: socialAgents(input.socialAgents),
      tasks: [],
      showProgressBars: false,
      infirmary: null
    };
  }

  if (verifiedLive) {
    const tasks = Array.isArray(input.tasks) ? input.tasks.filter(isRecord) : [];
    const tasksById = new Map(tasks.filter(task => typeof task.id === "string").map(task => [task.id, task]));
    const agents = (Array.isArray(input.agents) ? input.agents : []).filter(isRecord).map(agent => {
      const task = typeof agent.taskId === "string" ? tasksById.get(agent.taskId) : null;
      const progress = task && validProgress(task.progress) ? task.progress : null;
      return {
        ...agent,
        simulated: false,
        activitySource: "backend",
        progress,
        showProgressBar: Boolean(task && task.status === "running" && progress !== null),
        healthStatus: "healthy"
      };
    });
    return {
      mode: "live",
      connection: "verified",
      banner: null,
      simulated: false,
      operationalStateVerified: true,
      agents,
      tasks,
      showProgressBars: agents.some(agent => agent.showProgressBar),
      infirmary: null
    };
  }

  const failed = ["disconnected", "stale", "error"].includes(backendState);
  const infirmary = connectedBefore && failed;
  return {
    mode: infirmary ? "infirmary" : "synchronizing",
    connection: backendState,
    banner: infirmary
      ? "BACKEND SEM COMUNICAÇÃO — Diagnóstico em curso. Movimento apresentado é simulado."
      : "A LIGAR AO BACKEND — Estado operacional ainda não confirmado.",
    simulated: true,
    operationalStateVerified: false,
    agents: socialAgents(input.socialAgents).map(agent => ({
      ...agent,
      healthStatus: infirmary ? "infirmary" : "pending"
    })),
    tasks: [],
    showProgressBars: false,
    infirmary: infirmary ? {
      affected: "backend_or_connection",
      cause: input.failureOrigin ?? "indeterminate",
      confidence: input.failureConfidence ?? "indeterminate",
      incidentId: input.incidentId ?? null
    } : null
  };
}

export const officeActivityStateContract = Object.freeze({
  modes: Object.freeze(["offline_social_simulation", "synchronizing", "infirmary", "live"]),
  activitySources: Object.freeze(["local_social_simulation", "backend"]),
  progressRange: Object.freeze([0, 100])
});
