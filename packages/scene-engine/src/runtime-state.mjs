const AGENT_STATUSES = new Set(["idle", "active", "blocked", "unavailable", "unknown"]);
const TASK_STATUSES = new Set(["proposed", "awaiting_approval", "running", "completed", "blocked", "failed"]);
const CONNECTION_STATES = new Set(["disconnected", "connecting", "connected", "synchronizing", "live", "stale", "error"]);

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;
const parseTime = value => typeof value === "string" || typeof value === "number" ? Date.parse(value) : NaN;

/**
 * Validates a backend-provided snapshot and derives a safe display state.
 * This module does not authenticate a source: adapters must verify identity and
 * authorization before passing snapshots here.
 */
export function normalizeRuntimeSnapshot(snapshot, options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 30_000;
  const errors = [];

  if (!Number.isFinite(now)) errors.push("now must be a finite timestamp.");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) errors.push("ttlMs must be a positive finite number.");
  if (!isRecord(snapshot)) errors.push("snapshot must be an object.");
  if (errors.length) return { valid: false, errors, connectionState: "disconnected", agents: [], tasks: [] };

  if (snapshot.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!nonEmpty(snapshot.sourceId)) errors.push("sourceId is required.");
  if (!nonEmpty(snapshot.snapshotId)) errors.push("snapshotId is required.");
  const generatedAt = parseTime(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) errors.push("generatedAt must be a valid timestamp.");
  if (!Array.isArray(snapshot.agents)) errors.push("agents must be an array.");
  if (!Array.isArray(snapshot.tasks)) errors.push("tasks must be an array.");
  if (!CONNECTION_STATES.has(snapshot.connectionState)) errors.push("connectionState is invalid.");
  if (typeof snapshot.synchronized !== "boolean") errors.push("synchronized must be a boolean.");

  const agents = [];
  if (Array.isArray(snapshot.agents)) {
    snapshot.agents.forEach((agent, index) => {
      if (!isRecord(agent) || !nonEmpty(agent.id) || !AGENT_STATUSES.has(agent.status)) {
        errors.push(`agents[${index}] must have a non-empty id and a recognized status.`);
        return;
      }
      agents.push({ id: agent.id, status: agent.status });
    });
  }

  const tasks = [];
  if (Array.isArray(snapshot.tasks)) {
    snapshot.tasks.forEach((task, index) => {
      if (!isRecord(task) || !nonEmpty(task.id) || !TASK_STATUSES.has(task.status)) {
        errors.push(`tasks[${index}] must have a non-empty id and a recognized status.`);
        return;
      }
      tasks.push({ id: task.id, status: task.status });
    });
  }

  if (errors.length) return { valid: false, errors, connectionState: "disconnected", agents: [], tasks: [] };

  const ageMs = now - generatedAt;
  const fresh = ageMs >= 0 && ageMs <= ttlMs;
  let connectionState;
  if (snapshot.connectionState === "error") connectionState = "error";
  else if (snapshot.connectionState === "disconnected" || snapshot.connectionState === "connecting") {
    connectionState = snapshot.connectionState;
  } else if (!fresh) connectionState = "stale";
  else if (!snapshot.synchronized || snapshot.connectionState === "synchronizing") connectionState = "synchronizing";
  else connectionState = "live";

  return {
    valid: true,
    errors: [],
    sourceId: snapshot.sourceId,
    snapshotId: snapshot.snapshotId,
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    ageMs,
    connectionState,
    authoritativeStateVerified: connectionState === "live",
    agents: agents.map(agent => ({
      ...agent,
      status: connectionState === "live" ? agent.status : "unknown",
      sourceStatus: agent.status
    })),
    tasks: tasks.map(task => ({
      ...task,
      status: connectionState === "live" ? task.status : "unknown",
      sourceStatus: task.status
    }))
  };
}

export const runtimeStateContract = Object.freeze({
  schemaVersion: 1,
  agentStatuses: Object.freeze([...AGENT_STATUSES]),
  taskStatuses: Object.freeze([...TASK_STATUSES]),
  connectionStates: Object.freeze([...CONNECTION_STATES])
});
