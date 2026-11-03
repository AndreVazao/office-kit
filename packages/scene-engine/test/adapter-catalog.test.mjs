import test from "node:test";
import assert from "node:assert/strict";
import { AdapterCatalog } from "../src/adapter-catalog.mjs";

function adapter(id, capabilities = ["read_state"]) {
  return {
    apiVersion: 1,
    metadata: { id, name: `Adapter ${id}`, version: "1.0.0" },
    capabilities,
    async connect() { throw new Error("connect_must_not_be_called_by_catalog"); },
    async disconnect() {},
    async getSnapshot() { return null; },
    subscribe() { return () => {}; }
  };
}

test("catalog registers valid adapters without connecting them", () => {
  const catalog = new AdapterCatalog();
  const candidate = adapter("demo.adapter");
  const result = catalog.register(candidate);
  assert.equal(result.registered, true);
  assert.equal(catalog.size, 1);
  assert.equal(catalog.select("demo.adapter").adapter, candidate);
});

test("catalog rejects invalid and duplicate adapter identities", () => {
  const catalog = new AdapterCatalog();
  assert.equal(catalog.register({}).registered, false);
  catalog.register(adapter("same.adapter"));
  const duplicate = catalog.register(adapter("same.adapter"));
  assert.equal(duplicate.registered, false);
  assert.equal(duplicate.reason, "duplicate_adapter_id");
  assert.equal(catalog.size, 1);
});

test("catalog lists and filters declared capabilities", () => {
  const catalog = new AdapterCatalog();
  catalog.register(adapter("read.adapter"));
  catalog.register(adapter("command.adapter", ["read_state", "send_commands"]));
  assert.equal(catalog.list().length, 2);
  assert.deepEqual(catalog.list({ capability: "send_commands" }).map(item => item.id), ["command.adapter"]);
});

test("selection is explicit and enforces required capabilities", () => {
  const catalog = new AdapterCatalog();
  const candidate = adapter("read.only");
  catalog.register(candidate);
  assert.equal(catalog.select("missing").reason, "adapter_not_found");
  const denied = catalog.select("read.only", { requiredCapabilities: ["send_commands"] });
  assert.equal(denied.reason, "capability_not_available");
  assert.deepEqual(denied.missing, ["send_commands"]);
  assert.equal(catalog.select("read.only").adapter, candidate);
});

test("catalog returns defensive metadata and supports unregister", () => {
  const catalog = new AdapterCatalog();
  catalog.register(adapter("defensive"));
  const listed = catalog.list();
  listed[0].capabilities.push("send_commands");
  assert.deepEqual(catalog.describe("defensive").capabilities, ["read_state"]);
  assert.equal(catalog.unregister("defensive"), true);
  assert.equal(catalog.select("defensive").selected, false);
});
