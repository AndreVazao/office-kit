const STATES = new Set(["absent", "installed", "running", "stopped", "degraded", "uninstalling"]);
const REQUIRED_DRIVER_METHODS = [
  "stage", "install", "start", "stop", "health", "activate", "backupCurrent",
  "restorePrevious", "removeRuntime", "removeData"
];

function assertDriver(driver) {
  if (!driver || REQUIRED_DRIVER_METHODS.some(name => typeof driver[name] !== "function")) {
    throw new TypeError("installation_lifecycle_driver_incomplete");
  }
}

function clone(value) {
  return structuredClone(value);
}

function validateRecord(record) {
  if (!record || !STATES.has(record.state) || typeof record.installationId !== "string" ||
      !record.installationId || typeof record.version !== "string" || !record.version) {
    throw new Error("installation_lifecycle_record_invalid");
  }
  return record;
}

/**
 * Serializes installation mutations around an injected OS/package driver.
 * The driver owns platform operations; this controller never invokes a shell,
 * changes services, or deletes persistent data on its own.
 */
export function createInstallationLifecycle({ driver, store, clock = Date.now } = {}) {
  assertDriver(driver);
  if (!store || typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("installation_lifecycle_store_required");
  }
  if (typeof clock !== "function") throw new TypeError("installation_lifecycle_clock_required");

  let queue = Promise.resolve();
  let record = null;
  let initialized = false;

  const persist = async next => {
    validateRecord(next);
    await store.save(clone(next));
    record = clone(next);
    return snapshot();
  };
  const snapshot = () => record ? Object.freeze(clone(record)) : Object.freeze({
    state: "absent", installationId: null, version: null, previousVersion: null,
    dataRetained: true, updatedAt: null, lastError: null
  });
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const requireRecord = (...states) => {
    if (!initialized || !record) throw new Error("installation_lifecycle_not_installed");
    if (states.length && !states.includes(record.state)) {
      throw new Error("installation_lifecycle_invalid_state_" + record.state);
    }
  };
  const update = (patch) => persist({ ...record, ...patch, updatedAt: clock(), lastError: null });

  async function initialize() {
    return serialize(async () => {
      if (initialized) return snapshot();
      const saved = await store.load();
      record = saved == null ? null : clone(validateRecord(saved));
      initialized = true;
      return snapshot();
    });
  }

  async function install({ installationId, version, packagePath } = {}) {
    return serialize(async () => {
      if (!initialized) throw new Error("installation_lifecycle_not_initialized");
      if (record && record.state !== "absent") throw new Error("installation_lifecycle_already_installed");
      if (typeof installationId !== "string" || !installationId.trim() ||
          typeof version !== "string" || !version.trim() ||
          typeof packagePath !== "string" || !packagePath.trim()) {
        throw new TypeError("installation_lifecycle_install_arguments_invalid");
      }
      await driver.stage({ version, packagePath });
      await driver.install({ installationId, version, packagePath });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await driver.removeRuntime({ installationId, preserveData: true });
        throw new Error("installation_lifecycle_install_health_failed");
      }
      return persist({
        installationId, version, previousVersion: null, state: "installed",
        dataRetained: true, updatedAt: clock(), lastError: null
      });
    });
  }

  async function start() {
    return serialize(async () => {
      requireRecord("installed", "stopped", "degraded");
      await driver.start({ installationId: record.installationId });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "start_health_failed" });
        throw new Error("installation_lifecycle_start_health_failed");
      }
      return update({ state: "running" });
    });
  }

  async function stop() {
    return serialize(async () => {
      requireRecord("running", "degraded");
      await driver.stop({ installationId: record.installationId });
      return update({ state: "stopped" });
    });
  }

  async function restart() {
    return serialize(async () => {
      requireRecord("running", "stopped", "degraded");
      if (record.state === "running" || record.state === "degraded") {
        await driver.stop({ installationId: record.installationId });
      }
      await driver.start({ installationId: record.installationId });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "restart_health_failed" });
        throw new Error("installation_lifecycle_restart_health_failed");
      }
      return update({ state: "running" });
    });
  }

  async function upgrade({ version, packagePath } = {}) {
    return serialize(async () => {
      requireRecord("installed", "running", "stopped", "degraded");
      if (typeof version !== "string" || !version.trim() || version === record.version ||
          typeof packagePath !== "string" || !packagePath.trim()) {
        throw new TypeError("installation_lifecycle_upgrade_arguments_invalid");
      }
      const wasRunning = record.state === "running" || record.state === "degraded";
      const oldVersion = record.version;
      await driver.stage({ version, packagePath });
      if (wasRunning) await driver.stop({ installationId: record.installationId });
      await driver.backupCurrent({ installationId: record.installationId, version: oldVersion });
      try {
        await driver.activate({ installationId: record.installationId, version, packagePath });
        if (wasRunning) await driver.start({ installationId: record.installationId });
        const health = await driver.health();
        if (health?.status !== "ready") throw new Error("upgrade_health_failed");
        return update({ version, previousVersion: oldVersion, state: wasRunning ? "running" : "stopped" });
      } catch (error) {
        await driver.restorePrevious({ installationId: record.installationId, version: oldVersion });
        if (wasRunning) await driver.start({ installationId: record.installationId });
        const rollbackHealth = await driver.health();
        if (rollbackHealth?.status !== "ready") {
          await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "upgrade_and_rollback_health_failed" });
          throw new Error("installation_lifecycle_rollback_health_failed");
        }
        await persist({ ...record, state: wasRunning ? "running" : "stopped", updatedAt: clock(), lastError: "upgrade_rolled_back" });
        throw error;
      }
    });
  }

  async function rollback() {
    return serialize(async () => {
      requireRecord("installed", "running", "stopped", "degraded");
      if (!record.previousVersion) throw new Error("installation_lifecycle_no_previous_version");
      const wasRunning = record.state === "running" || record.state === "degraded";
      const currentVersion = record.version;
      if (wasRunning) await driver.stop({ installationId: record.installationId });
      await driver.restorePrevious({ installationId: record.installationId, version: record.previousVersion });
      if (wasRunning) await driver.start({ installationId: record.installationId });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "manual_rollback_health_failed" });
        throw new Error("installation_lifecycle_rollback_health_failed");
      }
      return update({ version: record.previousVersion, previousVersion: currentVersion, state: wasRunning ? "running" : "stopped" });
    });
  }

  async function uninstall({ retainData = true } = {}) {
    return serialize(async () => {
      requireRecord("installed", "running", "stopped", "degraded");
      if (typeof retainData !== "boolean") throw new TypeError("installation_lifecycle_retain_data_boolean_required");
      const prior = record.state;
      await persist({ ...record, state: "uninstalling", updatedAt: clock(), lastError: null });
      try {
        if (prior === "running" || prior === "degraded") await driver.stop({ installationId: record.installationId });
        await driver.removeRuntime({ installationId: record.installationId, preserveData: retainData });
        if (!retainData) await driver.removeData({ installationId: record.installationId });
        return persist({
          ...record, state: "absent", version: null, previousVersion: null,
          dataRetained: retainData, updatedAt: clock(), lastError: null
        });
      } catch (error) {
        await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "uninstall_failed" });
        throw error;
      }
    });
  }

  return Object.freeze({
    initialize, install, start, stop, restart, upgrade, rollback, uninstall,
    status: () => snapshot()
  });
}
