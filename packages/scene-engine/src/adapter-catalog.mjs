import { validateAdapter } from "./adapter-contract.mjs";

/**
 * In-memory registry for adapters explicitly supplied by the host.
 * It never scans the filesystem/network, imports code, or connects adapters.
 */
export class AdapterCatalog {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    const validation = validateAdapter(adapter);
    if (!validation.valid) {
      return { registered: false, validation };
    }
    const id = adapter.metadata.id;
    if (this.adapters.has(id)) {
      return { registered: false, reason: "duplicate_adapter_id", id };
    }
    const metadata = Object.freeze({
      id,
      name: adapter.metadata.name,
      version: adapter.metadata.version
    });
    const capabilities = Object.freeze([...adapter.capabilities]);
    this.adapters.set(id, Object.freeze({ adapter, metadata, capabilities }));
    return { registered: true, metadata, capabilities };
  }

  unregister(id) {
    return this.adapters.delete(id);
  }

  list({ capability } = {}) {
    return [...this.adapters.values()]
      .filter(entry => !capability || entry.capabilities.includes(capability))
      .map(({ metadata, capabilities }) => Object.freeze({
        ...metadata,
        capabilities: [...capabilities]
      }));
  }

  describe(id) {
    const entry = this.adapters.get(id);
    if (!entry) return null;
    return Object.freeze({
      ...entry.metadata,
      capabilities: [...entry.capabilities]
    });
  }

  select(id, { requiredCapabilities = ["read_state"] } = {}) {
    const entry = this.adapters.get(id);
    if (!entry) return { selected: false, reason: "adapter_not_found" };
    if (!Array.isArray(requiredCapabilities) ||
        requiredCapabilities.some(capability => typeof capability !== "string")) {
      return { selected: false, reason: "invalid_required_capabilities" };
    }
    const missing = requiredCapabilities.filter(
      capability => !entry.capabilities.includes(capability)
    );
    if (missing.length) {
      return { selected: false, reason: "capability_not_available", missing };
    }
    // Selection returns the exact registered object. It does not call connect().
    return { selected: true, adapter: entry.adapter, metadata: entry.metadata };
  }

  get size() {
    return this.adapters.size;
  }
}
