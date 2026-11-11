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
      !record.installationId ||
      (record.state === "absent" ? record.version !== null : (typeof record.version !== "string" || !record.version))) {
    throw new Error("installation_lifecycle_record_invalid");
  }
  if (record.operation !== undefined && record.operation !== null &&
      (typeof record.operation !== "object" || typeof record.operation.type !== "string" ||
       typeof record.operation.phase !== "string")) {
    throw new Error("installation_lifecycle_operation_invalid");
  }
  return record;
}

/**
 * Serializes installation mutations around an injected OS/package driver.
 * Durable operation checkpoints make interrupted work visible after restart.
 * Recovery is explicit; uninstall and ambiguous backup phases fail closed.
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
  const snapshot = () => record ? Object.freeze({
    ...clone(record),
    recoveryRequired: Boolean(record.operation)
  }) : Object.freeze({
    state: "absent", installationId: null, version: null, previousVersion: null,
    dataRetained: true, updatedAt: null, lastError: null, operation: null,
    recoveryRequired: false
  });
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const requireRecord = (...states) => {
    if (!initialized || !record) throw new Error("installation_lifecycle_not_installed");
    if (record.operation) throw new Error("installation_lifecycle_recovery_required");
    if (states.length && !states.includes(record.state)) {
      throw new Error("installation_lifecycle_invalid_state_" + record.state);
    }
  };
  const update = patch => persist({
    ...record, ...patch, operation: null, updatedAt: clock(), lastError: null
  });
  const checkpoint = (type, phase, fields = {}) => persist({
    ...(record ?? {
      installationId: fields.installationId,
      version: null,
      previousVersion: null,
      state: "absent",
      dataRetained: true
    }),
    ...fields,
    operation: {
      type,
      phase,
      startedAt: record?.operation?.startedAt ?? clock(),
      updatedAt: clock()
    },
    updatedAt: clock(),
    lastError: null
  });

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
      await checkpoint("install", "stage_started", { installationId, version: null, targetVersion: version, previousVersion: null, state: "absent" });
      await driver.stage({ version, packagePath });
      await checkpoint("install", "stage_complete");
      await checkpoint("install", "install_started");
      await driver.install({ installationId, version, packagePath });
      await checkpoint("install", "install_complete");
      const health = await driver.health();
      if (health?.status !== "ready") throw new Error("installation_lifecycle_install_health_failed");
      return update({
        installationId, version, previousVersion: null, state: "installed",
        dataRetained: true
      });
    });
  }

  async function start() {
    return serialize(async () => {
      requireRecord("installed", "stopped", "degraded");
      await checkpoint("start", "start_started", { priorState: record.state });
      await driver.start({ installationId: record.installationId });
      await checkpoint("start", "health_check_started");
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", operation: null, updatedAt: clock(), lastError: "start_health_failed" });
        throw new Error("installation_lifecycle_start_health_failed");
      }
      return update({ state: "running" });
    });
  }

  async function stop() {
    return serialize(async () => {
      requireRecord("running", "degraded");
      await checkpoint("stop", "stop_started", { priorState: record.state });
      await driver.stop({ installationId: record.installationId });
      return update({ state: "stopped" });
    });
  }

  async function restart() {
    return serialize(async () => {
      requireRecord("running", "stopped", "degraded");
      const priorState = record.state;
      await checkpoint("restart", "restart_started", { priorState });
      if (priorState === "running" || priorState === "degraded") {
        await driver.stop({ installationId: record.installationId });
      }
      await checkpoint("restart", "start_started", { priorState });
      await driver.start({ installationId: record.installationId });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", operation: null, updatedAt: clock(), lastError: "restart_health_failed" });
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
      const priorState = record.state;
      const wasRunning = priorState === "running" || priorState === "degraded";
      const oldVersion = record.version;
      await checkpoint("upgrade", "stage_started", { priorState, oldVersion, targetVersion: version });
      await driver.stage({ version, packagePath });
      await checkpoint("upgrade", "stage_complete");
      if (wasRunning) {
        await checkpoint("upgrade", "stop_started");
        await driver.stop({ installationId: record.installationId });
        await checkpoint("upgrade", "stopped");
      }
      await checkpoint("upgrade", "backup_started");
      await driver.backupCurrent({ installationId: record.installationId, version: oldVersion });
      await checkpoint("upgrade", "backup_complete");
      try {
        await checkpoint("upgrade", "activation_started");
        await driver.activate({ installationId: record.installationId, version, packagePath });
        await checkpoint("upgrade", "activation_complete");
        if (wasRunning) {
          await checkpoint("upgrade", "start_new_started");
          await driver.start({ installationId: record.installationId });
        }
        const health = await driver.health();
        if (health?.status !== "ready") throw new Error("upgrade_health_failed");
        return update({ version, previousVersion: oldVersion, state: wasRunning ? "running" : "stopped" });
      } catch (error) {
        await driver.restorePrevious({ installationId: record.installationId, version: oldVersion });
        if (wasRunning) await driver.start({ installationId: record.installationId });
        const rollbackHealth = await driver.health();
        if (rollbackHealth?.status !== "ready") {
          await persist({ ...record, state: "degraded", operation: null, updatedAt: clock(), lastError: "upgrade_and_rollback_health_failed" });
          throw new Error("installation_lifecycle_rollback_health_failed");
        }
        await persist({
          ...record, state: wasRunning ? "running" : "stopped", operation: null,
          updatedAt: clock(), lastError: "upgrade_rolled_back"
        });
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
      await checkpoint("rollback", "restore_started", {
        priorState: record.state, oldVersion: currentVersion, targetVersion: record.previousVersion
      });
      if (wasRunning) await driver.stop({ installationId: record.installationId });
      await driver.restorePrevious({ installationId: record.installationId, version: record.previousVersion });
      if (wasRunning) await driver.start({ installationId: record.installationId });
      const health = await driver.health();
      if (health?.status !== "ready") {
        await persist({ ...record, state: "degraded", operation: null, updatedAt: clock(), lastError: "manual_rollback_health_failed" });
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
      await checkpoint("uninstall", "uninstall_started", { priorState: prior, retainData, state: "uninstalling" });
      if (prior === "running" || prior === "degraded") {
        await checkpoint("uninstall", "stop_started", { priorState: prior, retainData });
        await driver.stop({ installationId: record.installationId });
      }
      await checkpoint("uninstall", "remove_runtime_started", { priorState: prior, retainData });
      await driver.removeRuntime({ installationId: record.installationId, preserveData: retainData });
      if (!retainData) {
        await checkpoint("uninstall", "remove_data_started", { priorState: prior, retainData });
        await driver.removeData({ installationId: record.installationId });
      }
      return update({
        state: "absent", version: null, previousVersion: null,
        dataRetained: retainData
      });
    });
  }

  async function recover() {
    return serialize(async () => {
      if (!initialized || !record) throw new Error("installation_lifecycle_not_initialized");
      const operation = record.operation;
      if (!operation) return snapshot();
      const { type, phase } = operation;
      const installationId = record.installationId;

      if (type === "uninstall") {
        await persist({
          ...record, state: "degraded", updatedAt: clock(),
          lastError: "uninstall_interrupted_manual_recovery_required"
        });
        throw new Error("installation_lifecycle_uninstall_recovery_requires_operator");
      }

      if (type === "install") {
        await driver.removeRuntime({ installationId, preserveData: true });
        return persist({
          ...record, state: "absent", version: null, previousVersion: null,
          operation: null, dataRetained: true, updatedAt: clock(), lastError: "interrupted_install_cleaned"
        });
      }

      if (type === "upgrade") {
        const priorState = operation.priorState;
        const oldVersion = operation.oldVersion;
        if (phase === "backup_started") {
          await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "upgrade_backup_outcome_ambiguous_manual_recovery_required" });
          throw new Error("installation_lifecycle_upgrade_backup_ambiguous");
        }
        if (["activation_started", "activation_complete", "start_new_started"].includes(phase)) {
          await driver.restorePrevious({ installationId, version: oldVersion });
        }
        if (priorState === "running" || priorState === "degraded") {
          await driver.start({ installationId });
        }
        const health = await driver.health();
        if (health?.status !== "ready") {
          await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "upgrade_recovery_health_failed" });
          throw new Error("installation_lifecycle_upgrade_recovery_health_failed");
        }
        return persist({
          ...record, version: oldVersion, state: priorState === "running" || priorState === "degraded" ? "running" : "stopped",
          operation: null, updatedAt: clock(), lastError: "interrupted_upgrade_rolled_back"
        });
      }

      if (type === "start" || type === "restart" || type === "stop") {
        await persist({
          ...record, state: "degraded", updatedAt: clock(),
          lastError: "service_transition_interrupted_manual_recovery_required"
        });
        throw new Error("installation_lifecycle_service_transition_recovery_requires_operator");
      }

      if (type === "rollback") {
        await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "rollback_interrupted_manual_recovery_required" });
        throw new Error("installation_lifecycle_rollback_recovery_requires_operator");
      }

      await persist({ ...record, state: "degraded", updatedAt: clock(), lastError: "unknown_operation_manual_recovery_required" });
      throw new Error("installation_lifecycle_unknown_operation");
    });
  }

  return Object.freeze({
    initialize, install, start, stop, restart, upgrade, rollback, uninstall, recover,
    status: () => snapshot()
  });
}
