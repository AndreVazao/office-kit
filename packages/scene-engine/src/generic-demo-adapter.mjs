const AGENT_STATUSES = new Set(["idle", "active", "blocked", "unavailable", "unknown"]);
const TASK_STATUSES = new Set(["proposed", "awaiting_approval", "running", "completed", "blocked", "failed"]);

/**
 * Deterministic in-memory reference adapter for host integration and tests.
 * It performs no network I/O, credential handling, dynamic imports or commands.
 * The host must authorize this instance before registering/passing it to the gateway.
 */
export class GenericDemoAdapter {
  constructor({
    now = () => Date.now(),
    sourceId = "office-kit.demo",
    sessionId = "demo-session-1",
    ttlMs = 30_000,
    agents = [{ id: "demo-agent-1", status: "active" }],
    tasks = [{ id: "demo-task-1", status: "running" }]
  } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    if (typeof sourceId !== "string" || !sourceId.trim()) throw new TypeError("sourceId is required.");
    if (typeof sessionId !== "string" || !sessionId.trim()) throw new TypeError("sessionId is required.");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("ttlMs must be positive and finite.");
    this.now = now;
    this.ttlMs = ttlMs;
    this.apiVersion = 1;
    this.metadata = Object.freeze({ id: sourceId, name: "Generic demonstration adapter", version: "1.0.0" });
    this.capabilities = Object.freeze(["read_state", "read_agents", "read_tasks"]);
    this.sessionId = sessionId;
    this.sequence = 0;
    this.connected = false;
    this.listeners = new Set();
    this.agents = this.#copyRecords(agents, AGENT_STATUSES, "agents");
    this.tasks = this.#copyRecords(tasks, TASK_STATUSES, "tasks");
    this.snapshotSequence = 0;
    this.connectCount = 0;
    this.disconnectCount = 0;
  }

  #copyRecords(records, statuses, label) {
    if (!Array.isArray(records)) throw new TypeError(`${label} must be an array.`);
    return records.map((record, index) => {
      if (!record || typeof record.id !== "string" || !record.id.trim() || !statuses.has(record.status)) {
        throw new TypeError(`${label}[${index}] is invalid.`);
      }
      return { id: record.id, status: record.status };
    });
  }

  #snapshot() {
    return {
      schemaVersion: 1,
      sourceId: this.metadata.id,
      snapshotId: `demo-snapshot-${++this.snapshotSequence}`,
      generatedAt: new Date(this.now()).toISOString(),
      connectionState: "connected",
      synchronized: true,
      agents: this.agents.map(agent => ({ ...agent })),
      tasks: this.tasks.map(task => ({ ...task }))
    };
  }

  #emit(type, payload, overrides = {}) {
    const event = {
      schemaVersion: 1,
      sourceId: this.metadata.id,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      type,
      timestamp: new Date(this.now()).toISOString(),
      payload,
      ...overrides
    };
    for (const listener of [...this.listeners]) listener(Object.freeze(event));
    return event;
  }

  async connect() {
    this.connected = true;
    this.sequence = 0;
    this.connectCount += 1;
    return { connected: true, sourceId: this.metadata.id, sessionId: this.sessionId };
  }

  async disconnect() {
    this.connected = false;
    this.disconnectCount += 1;
    this.listeners.clear();
    return { disconnected: true };
  }

  async getSnapshot() {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    return this.#snapshot();
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function.");
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setAgentStatus(id, status) {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    if (!AGENT_STATUSES.has(status)) throw new TypeError("invalid_agent_status");
    const agent = this.agents.find(item => item.id === id);
    if (!agent) throw new Error("demo_agent_not_found");
    agent.status = status;
    return this.#emit("snapshot", this.#snapshot());
  }

  setTaskStatus(id, status) {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    if (!TASK_STATUSES.has(status)) throw new TypeError("invalid_task_status");
    const task = this.tasks.find(item => item.id === id);
    if (!task) throw new Error("demo_task_not_found");
    task.status = status;
    return this.#emit("snapshot", this.#snapshot());
  }

  heartbeat() {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    return this.#emit("heartbeat", {});
  }

  failTransport(reason = "demo_transport_failure") {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    this.connected = false;
    return this.#emit("connection", { state: "error", reason });
  }

  /** Deterministic fault-injection hook for duplicate/order/source regression tests. */
  emitEvent(type, payload, overrides = {}) {
    if (!this.connected) throw new Error("demo_adapter_not_connected");
    return this.#emit(type, payload, overrides);
  }
}
