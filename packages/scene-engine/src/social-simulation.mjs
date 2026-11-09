const ACTIVITIES = Object.freeze([
  { id: "work_at_desk", weight: 30, locations: ["desk"], minMs: 45_000, maxMs: 240_000 },
  { id: "use_whiteboard", weight: 8, locations: ["whiteboard"], minMs: 30_000, maxMs: 120_000 },
  { id: "coffee_break", weight: 12, locations: ["kitchen", "coffee_area"], minMs: 20_000, maxMs: 100_000 },
  { id: "smoke_break", weight: 5, locations: ["balcony"], minMs: 30_000, maxMs: 120_000 },
  { id: "walk", weight: 12, locations: ["corridor", "lounge", "office"], minMs: 15_000, maxMs: 75_000 },
  { id: "conversation", weight: 13, locations: ["lounge", "corridor", "coffee_area"], minMs: 25_000, maxMs: 110_000 },
  { id: "greet_colleague", weight: 8, locations: ["office", "corridor"], minMs: 8_000, maxMs: 30_000 },
  { id: "rest", weight: 12, locations: ["lounge", "desk"], minMs: 20_000, maxMs: 90_000 }
]);

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(random, items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let point = random() * total;
  for (const item of items) {
    point -= item.weight;
    if (point < 0) return item;
  }
  return items.at(-1);
}

function chooseDuration(random, activity) {
  return Math.round(activity.minMs + random() * (activity.maxMs - activity.minMs));
}

function chooseLocation(random, activity, previous) {
  const candidates = activity.locations.filter(location => location !== previous);
  const choices = candidates.length ? candidates : activity.locations;
  return choices[Math.floor(random() * choices.length)];
}

function normalizeAgent(agent, index) {
  if (!isRecord(agent) || typeof agent.id !== "string" || !agent.id.trim()) {
    throw new TypeError(`agents[${index}].id must be a non-empty string.`);
  }
  return {
    id: agent.id,
    name: typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : agent.id,
    departmentId: typeof agent.departmentId === "string" ? agent.departmentId : null,
    enabled: agent.enabled !== false
  };
}

/**
 * Local-only social behavior model. It never creates backend tasks or claims
 * operational progress. The host owns the clock and calls advance(now).
 */
export class SocialSimulationEngine {
  #random;
  #agents;
  #states = new Map();
  #lastNow = null;
  #minDecisionMs;
  #maxDecisionMs;

  constructor(options = {}) {
    if (!Array.isArray(options.agents)) throw new TypeError("agents must be an array.");
    const ids = new Set();
    this.#agents = options.agents.map(normalizeAgent);
    for (const agent of this.#agents) {
      if (ids.has(agent.id)) throw new TypeError("agent ids must be unique.");
      ids.add(agent.id);
    }
    const seed = options.seed ?? Date.now();
    if (!finite(seed)) throw new TypeError("seed must be a finite number.");
    this.#random = seededRandom(seed);
    this.#minDecisionMs = options.minDecisionMs ?? 5_000;
    this.#maxDecisionMs = options.maxDecisionMs ?? 45_000;
    if (!finite(this.#minDecisionMs) || !finite(this.#maxDecisionMs) ||
      this.#minDecisionMs <= 0 || this.#maxDecisionMs < this.#minDecisionMs) {
      throw new RangeError("decision interval must be positive and maxDecisionMs >= minDecisionMs.");
    }
    const initialNow = options.now ?? Date.now();
    if (!finite(initialNow)) throw new TypeError("now must be a finite timestamp.");
    this.#lastNow = initialNow;
    for (const agent of this.#agents) {
      if (agent.enabled) this.#states.set(agent.id, this.#startActivity(agent, initialNow));
    }
  }

  #startActivity(agent, now, previous = null) {
    const activity = choose(this.#random, ACTIVITIES);
    const location = chooseLocation(this.#random, activity, previous?.location);
    const durationMs = chooseDuration(this.#random, activity);
    let partnerId = null;
    if (activity.id === "conversation" || activity.id === "greet_colleague") {
      const peers = this.#agents.filter(candidate => candidate.enabled && candidate.id !== agent.id);
      if (peers.length) partnerId = peers[Math.floor(this.#random() * peers.length)].id;
    }
    return {
      agentId: agent.id,
      activity: activity.id,
      location,
      partnerId,
      startedAt: now,
      endsAt: now + clamp(durationMs, this.#minDecisionMs, Math.max(this.#maxDecisionMs, durationMs)),
      simulated: true,
      authority: "local_social_simulation"
    };
  }

  advance(now = Date.now()) {
    if (!finite(now)) throw new TypeError("now must be a finite timestamp.");
    if (now < this.#lastNow) throw new RangeError("simulation time cannot move backwards.");
    for (const agent of this.#agents) {
      if (!agent.enabled) continue;
      const current = this.#states.get(agent.id);
      if (!current || now >= current.endsAt) {
        const nextStart = now;
        this.#states.set(agent.id, this.#startActivity(agent, nextStart, current));
      }
    }
    this.#lastNow = now;
    return this.snapshot();
  }

  setAgentEnabled(agentId, enabled, now = this.#lastNow) {
    if (typeof agentId !== "string" || typeof enabled !== "boolean" || !finite(now)) {
      throw new TypeError("agentId, enabled and timestamp are required.");
    }
    const agent = this.#agents.find(item => item.id === agentId);
    if (!agent) throw new RangeError("unknown_agent");
    agent.enabled = enabled;
    if (enabled) this.#states.set(agentId, this.#startActivity(agent, now));
    else this.#states.delete(agentId);
    return this.snapshot();
  }

  snapshot() {
    return {
      mode: "offline_social_simulation",
      simulated: true,
      backendConnected: false,
      generatedAt: new Date(this.#lastNow).toISOString(),
      agents: this.#agents.filter(agent => agent.enabled).map(agent => {
        const state = this.#states.get(agent.id);
        return { ...agent, ...state, status: "social", simulated: true };
      })
    };
  }
}

export const socialSimulationContract = Object.freeze({
  mode: "offline_social_simulation",
  simulated: true,
  backendConnected: false,
  activities: Object.freeze(ACTIVITIES.map(({ id }) => id))
});
