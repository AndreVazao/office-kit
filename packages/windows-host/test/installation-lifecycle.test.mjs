import test from "node:test";
import assert from "node:assert/strict";
import { createInstallationLifecycle } from "../src/installation-lifecycle.mjs";

function fixture({ health = () => ({ status: "ready" }) } = {}) {
  const events = [];
  const driver = Object.fromEntries([
    "stage", "install", "start", "stop", "activate", "backupCurrent",
    "restorePrevious", "removeRuntime", "removeData"
  ].map(name => [name, async args => { events.push([name, args]); }]));
  driver.health = async () => health();
  let saved = null;
  const store = {
    async load() { return saved; },
    async save(value) { saved = structuredClone(value); }
  };
  let time = 100;
  const lifecycle = createInstallationLifecycle({ driver, store, clock: () => ++time });
  return { lifecycle, events, store, driver };
}

test("requires initialization before installation and serializes persistent lifecycle state", async () => {
  const f = fixture();
  await assert.rejects(f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/pkg" }), /not_initialized/);
  assert.equal((await f.lifecycle.initialize()).state, "absent");
  const installed = await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/pkg" });
  assert.equal(installed.state, "installed");
  assert.equal(installed.dataRetained, true);
});

test("start, stop and restart require successful health confirmation", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/pkg" });
  assert.equal((await f.lifecycle.start()).state, "running");
  assert.equal((await f.lifecycle.stop()).state, "stopped");
  assert.equal((await f.lifecycle.restart()).state, "running");
  assert.deepEqual(f.events.filter(([name]) => ["start", "stop"].includes(name)).map(([name]) => name),
    ["start", "stop", "start"]);
});

test("failed start records degraded state instead of claiming running", async () => {
  let healthy = true;
  const f = fixture({ health: () => ({ status: healthy ? "ready" : "degraded" }) });
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/pkg" });
  healthy = false;
  await assert.rejects(f.lifecycle.start(), /start_health_failed/);
  assert.equal(f.lifecycle.status().state, "degraded");
});

test("upgrade backs up, activates and records prior version for rollback", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  await f.lifecycle.start();
  const upgraded = await f.lifecycle.upgrade({ version: "2.0.0", packagePath: "/v2" });
  assert.equal(upgraded.version, "2.0.0");
  assert.equal(upgraded.previousVersion, "1.0.0");
  assert.equal(upgraded.state, "running");
  assert.ok(f.events.some(([name]) => name === "backupCurrent"));
});

test("failed upgrade restores prior version and resumes previous runtime", async () => {
  let calls = 0;
  const f = fixture({ health: () => ({ status: ++calls === 3 ? "degraded" : "ready" }) });
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  await f.lifecycle.start();
  await assert.rejects(f.lifecycle.upgrade({ version: "2.0.0", packagePath: "/v2" }), /upgrade_health_failed/);
  assert.ok(f.events.some(([name, args]) => name === "restorePrevious" && args.version === "1.0.0"));
  assert.equal(f.lifecycle.status().version, "1.0.0");
  assert.equal(f.lifecycle.status().state, "running");
});

test("manual rollback swaps current and previous version after health validation", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  await f.lifecycle.upgrade({ version: "2.0.0", packagePath: "/v2" });
  const result = await f.lifecycle.rollback();
  assert.equal(result.version, "1.0.0");
  assert.equal(result.previousVersion, "2.0.0");
});

test("uninstall retains data by default and only removes it with explicit opt-out", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  const removed = await f.lifecycle.uninstall();
  assert.equal(removed.state, "absent");
  assert.equal(removed.dataRetained, true);
  assert.equal(f.events.some(([name]) => name === "removeData"), false);
});

test("explicit destructive uninstall removes data only after runtime removal", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  await f.lifecycle.uninstall({ retainData: false });
  const names = f.events.map(([name]) => name);
  assert.ok(names.indexOf("removeRuntime") < names.indexOf("removeData"));
  assert.equal(f.lifecycle.status().dataRetained, false);
});

test("rejects duplicate install and invalid transitions", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  await assert.rejects(f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" }), /already_installed/);
  await assert.rejects(f.lifecycle.stop(), /invalid_state/);
});

test("loads previously persisted installation record after controller recreation", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  const second = createInstallationLifecycle({ driver: f.driver, store: f.store });
  assert.equal((await second.initialize()).installationId, "office-1");
  assert.equal(second.status().version, "1.0.0");
});

test("rejects incomplete driver and malformed persisted state", async () => {
  assert.throws(() => createInstallationLifecycle({ driver: {}, store: { load() {}, save() {} } }), /driver_incomplete/);
  const f = fixture();
  f.store.load = async () => ({ state: "running" });
  await assert.rejects(f.lifecycle.initialize(), /record_invalid/);
});

test("concurrent lifecycle requests execute in order", async () => {
  const f = fixture();
  await f.lifecycle.initialize();
  await f.lifecycle.install({ installationId: "office-1", version: "1.0.0", packagePath: "/v1" });
  const results = await Promise.all([f.lifecycle.start(), f.lifecycle.stop(), f.lifecycle.start()]);
  assert.deepEqual(results.map(value => value.state), ["running", "stopped", "running"]);
});
