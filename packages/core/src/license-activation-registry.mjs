const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = value => typeof value === "string" && value.trim().length > 0;
const HEX_256 = /^[a-f0-9]{64}$/;
const MAX_ACTIVATIONS = 100000;
const MAX_INSTALLATION_ID = 128;
const MAX_ACTIVATION_ID = 128;

/**
 * The store MUST provide a durable, atomic, serializable transaction for one
 * license key across all processes that share the registry. A process-local
 * mutex or an in-memory Map is not sufficient for enforcing multi-PC seats.
 *
 * transact(key, updater) -> Promise<{ state, result }>
 * updater(currentState) -> { state, result }
 */
export class LicenseActivationRegistry {
  #store;
  #clock;
  #createActivationId;

  constructor({ store, clock = () => Date.now(), createActivationId } = {}) {
    if (!store || typeof store.transact !== "function") throw new TypeError("durable_atomic_license_store_required");
    if (typeof clock !== "function") throw new TypeError("license_registry_clock_required");
    if (typeof createActivationId !== "function") throw new TypeError("activation_id_factory_required");
    this.#store = store;
    this.#clock = clock;
    this.#createActivationId = createActivationId;
  }

  async activate({ verifiedLicense, installationId, machineFingerprint }) {
    const entitlement = verifiedLicense?.entitlement;
    if (verifiedLicense?.valid !== true || verifiedLicense?.status !== "valid" || !isRecord(entitlement)) {
      return { activated: false, reason: "verified_license_required" };
    }
    if (!isText(entitlement.licenseId) || entitlement.licenseId.length > 128
      || !Number.isSafeInteger(entitlement.maxInstallations) || entitlement.maxInstallations < 1) {
      return { activated: false, reason: "license_entitlement_invalid" };
    }
    if (!isText(installationId) || installationId.length > MAX_INSTALLATION_ID) {
      return { activated: false, reason: "installation_id_invalid" };
    }
    if (typeof machineFingerprint !== "string" || !HEX_256.test(machineFingerprint)) {
      return { activated: false, reason: "machine_fingerprint_invalid" };
    }
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("license_registry_clock_invalid");
    const activationId = this.#createActivationId();
    if (!isText(activationId) || activationId.length > MAX_ACTIVATION_ID) throw new TypeError("activation_id_factory_invalid");
    const key = "office-kit/license-activations/" + entitlement.licenseId;
    return this.#store.transact(key, current => {
      const state = isRecord(current) ? current : { schemaVersion: 1, licenseId: entitlement.licenseId, activations: {} };
      if (state.schemaVersion !== 1 || state.licenseId !== entitlement.licenseId || !isRecord(state.activations)) {
        return { state: current, result: { activated: false, reason: "activation_registry_state_invalid" } };
      }
      const existing = Object.values(state.activations).find(item =>
        item?.installationId === installationId && item?.machineFingerprint === machineFingerprint && item?.status === "active");
      if (existing) return { state, result: { activated: true, alreadyActive: true, activationId: existing.activationId, activeInstallations: Object.values(state.activations).filter(item => item?.status === "active").length } };
      const active = Object.values(state.activations).filter(item => item?.status === "active");
      if (active.length >= entitlement.maxInstallations) {
        return { state, result: { activated: false, reason: "installation_limit_reached", activeInstallations: active.length, maxInstallations: entitlement.maxInstallations } };
      }
      if (Object.prototype.hasOwnProperty.call(state.activations, activationId)) {
        return { state, result: { activated: false, reason: "activation_id_collision" } };
      }
      const activation = Object.freeze({
        activationId, installationId, machineFingerprint, status: "active",
        activatedAt: new Date(now).toISOString(), deactivatedAt: null
      });
      const next = { ...state, activations: { ...state.activations, [activationId]: activation }, updatedAt: new Date(now).toISOString() };
      return { state: next, result: { activated: true, alreadyActive: false, activationId, activeInstallations: active.length + 1 } };
    });
  }

  async deactivate({ licenseId, activationId, installationId }) {
    if (!isText(licenseId) || licenseId.length > 128 || !isText(activationId) || activationId.length > MAX_ACTIVATION_ID
      || !isText(installationId) || installationId.length > MAX_INSTALLATION_ID) {
      return { deactivated: false, reason: "deactivation_request_invalid" };
    }
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("license_registry_clock_invalid");
    const key = "office-kit/license-activations/" + licenseId;
    return this.#store.transact(key, current => {
      if (!isRecord(current) || current.schemaVersion !== 1 || current.licenseId !== licenseId || !isRecord(current.activations)) {
        return { state: current, result: { deactivated: false, reason: "activation_not_found" } };
      }
      const item = current.activations[activationId];
      if (!item || item.installationId !== installationId) return { state: current, result: { deactivated: false, reason: "activation_not_found" } };
      if (item.status === "inactive") return { state: current, result: { deactivated: true, alreadyInactive: true, activationId } };
      const updated = { ...item, status: "inactive", deactivatedAt: new Date(now).toISOString() };
      const next = { ...current, activations: { ...current.activations, [activationId]: updated }, updatedAt: new Date(now).toISOString() };
      return { state: next, result: { deactivated: true, alreadyInactive: false, activationId } };
    });
  }

  async list({ licenseId }) {
    if (!isText(licenseId) || licenseId.length > 128) throw new TypeError("license_id_invalid");
    const state = await this.#store.read("office-kit/license-activations/" + licenseId);
    if (!isRecord(state) || state.schemaVersion !== 1 || state.licenseId !== licenseId || !isRecord(state.activations)) {
      return { activeInstallations: 0, activations: [] };
    }
    const activations = Object.values(state.activations).filter(item => isRecord(item)).map(item => ({
      activationId: item.activationId,
      installationId: item.installationId,
      status: item.status,
      activatedAt: item.activatedAt,
      deactivatedAt: item.deactivatedAt
    }));
    return { activeInstallations: activations.filter(item => item.status === "active").length, activations };
  }
}

export const licenseActivationStoreContract = Object.freeze({
  schemaVersion: 1,
  transaction: "durable-atomic-serializable-per-license",
  keyPattern: "office-kit/license-activations/<licenseId>",
  machineIdentity: "sha256-fingerprint-only-no-raw-hardware-identifiers",
  processLocalMutexSufficient: false,
  offlineMultiMachineSeatEnforcement: false
});
