const ADAPTER_API_VERSION = 1;
const EVENT_TYPES = new Set([
  "connection",
  "snapshot",
  "heartbeat",
  "agent",
  "task",
  "diagnostic"
]);
const CAPABILITIES = new Set(["read_state", "read_agents", "read_tasks", "send_commands"]);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

/**
 * Validates the public, backend-neutral adapter surface.
 * Validation does not establish trust; the host must authenticate the adapter
 * and enforce permissions before invoking it.
 */
export function validateAdapter(adapter) {
  const errors = [];
  if (!isRecord(adapter)) {
    return { valid: false, errors: ["adapter must be an object."] };
  }
  if (adapter.apiVersion !== ADAPTER_API_VERSION) errors.push("apiVersion must be 1.");
  if (!isRecord(adapter.metadata)) errors.push("metadata must be an object.");
  else {
    if (!nonEmpty(adapter.metadata.id)) errors.push("metadata.id is required.");
    if (!nonEmpty(adapter.metadata.name)) errors.push("metadata.name is required.");
    if (!nonEmpty(adapter.metadata.version)) errors.push("metadata.version is required.");
  }
  if (!Array.isArray(adapter.capabilities)) errors.push("capabilities must be an array.");
  else {
    const seen = new Set();
    adapter.capabilities.forEach(capability => {
      if (!CAPABILITIES.has(capability)) errors.push(`unknown capability: ${String(capability)}.`);
      if (seen.has(capability)) errors.push(`duplicate capability: ${capability}.`);
      seen.add(capability);
    });
    if (adapter.capabilities.includes("send_commands") && !adapter.capabilities.includes("read_state")) {
      errors.push("send_commands requires read_state.");
    }
  }
  for (const method of ["connect", "disconnect", "getSnapshot", "subscribe"]) {
    if (typeof adapter[method] !== "function") errors.push(`${method}() must be a function.`);
  }
  return { valid: errors.length === 0, errors, apiVersion: ADAPTER_API_VERSION };
}

/**
 * Normalizes a versioned adapter event envelope and rejects replay/out-of-order
 * events. Sequence state is maintained per source/session by the caller.
 */
export function normalizeAdapterEvent(event, { lastSequence = 0, now = Date.now(), maxAgeMs = 30_000 } = {}) {
  const errors = [];
  if (!isRecord(event)) errors.push("event must be an object.");
  if (!Number.isSafeInteger(lastSequence) || lastSequence < 0) errors.push("lastSequence must be a non-negative safe integer.");
  if (!Number.isFinite(now)) errors.push("now must be a finite timestamp.");
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) errors.push("maxAgeMs must be positive and finite.");
  if (errors.length) return { valid: false, accepted: false, errors };

  if (event.schemaVersion !== 1) errors.push("schemaVersion must be 1.");
  if (!nonEmpty(event.sourceId)) errors.push("sourceId is required.");
  if (!nonEmpty(event.sessionId)) errors.push("sessionId is required.");
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0) errors.push("sequence must be a positive safe integer.");
  if (!EVENT_TYPES.has(event.type)) errors.push("event type is invalid.");
  const timestamp = typeof event.timestamp === "number"
    ? event.timestamp
    : typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
  if (!Number.isFinite(timestamp)) errors.push("timestamp must be valid.");
  if (!("payload" in event) || event.payload === undefined) errors.push("payload is required.");

  if (errors.length) return { valid: false, accepted: false, errors };
  if (event.sequence <= lastSequence) {
    return { valid: true, accepted: false, reason: "duplicate_or_out_of_order", errors: [] };
  }
  const ageMs = now - timestamp;
  if (ageMs < 0 || ageMs > maxAgeMs) {
    return { valid: true, accepted: false, reason: "stale_or_future_event", errors: [], ageMs };
  }
  return {
    valid: true,
    accepted: true,
    errors: [],
    event: {
      schemaVersion: 1,
      sourceId: event.sourceId,
      sessionId: event.sessionId,
      sequence: event.sequence,
      type: event.type,
      timestamp: new Date(timestamp).toISOString(),
      payload: event.payload
    },
    ageMs
  };
}

export const adapterContract = Object.freeze({
  apiVersion: ADAPTER_API_VERSION,
  eventSchemaVersion: 1,
  requiredMethods: Object.freeze(["connect", "disconnect", "getSnapshot", "subscribe"]),
  eventTypes: Object.freeze([...EVENT_TYPES]),
  capabilities: Object.freeze([...CAPABILITIES]),
  defaultCapabilities: Object.freeze(["read_state"])
});
