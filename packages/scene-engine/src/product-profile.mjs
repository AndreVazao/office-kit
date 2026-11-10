const EDITIONS = new Set(["universal", "dgmat", "vst"]);
const ADAPTER_IDS = Object.freeze({
  universal: Object.freeze([]),
  dgmat: Object.freeze(["dgm-mat"]),
  vst: Object.freeze([])
});
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

/**
 * Resolves an installation edition without importing or connecting a backend.
 * Every installation receives a unique storage namespace; two personal editions
 * can share the same runtime while remaining isolated from one another.
 */
export function createProductProfile({ edition, installationId, displayName, branding = {}, adapterIds, backend = {} } = {}) {
  const errors = [];
  if (!EDITIONS.has(edition)) errors.push("edition must be universal, dgmat, or vst.");
  if (!nonEmpty(installationId) || installationId.length > 128) errors.push("installationId must be a non-empty string up to 128 characters.");
  if (!nonEmpty(displayName) || displayName.length > 80) errors.push("displayName must be a non-empty string up to 80 characters.");
  if (!isRecord(branding)) errors.push("branding must be an object.");
  if (!isRecord(backend)) errors.push("backend must be an object.");
  const allowed = EDITIONS.has(edition) ? ADAPTER_IDS[edition] : [];
  const selected = adapterIds === undefined ? allowed : adapterIds;
  if (!Array.isArray(selected) || selected.some(id => !nonEmpty(id))) errors.push("adapterIds must be an array of non-empty strings.");
  else {
    if (new Set(selected).size !== selected.length) errors.push("adapterIds must not contain duplicates.");
    if (edition !== "universal") for (const id of selected) if (!allowed.includes(id)) errors.push(`adapter ${id} is not permitted in edition ${edition}.`);
  }
  if (backend.autoConnect === true) errors.push("automatic backend connection is disabled; require explicit owner consent.");
  if (errors.length) {
    const error = new TypeError("invalid_product_profile");
    error.validationErrors = errors;
    throw error;
  }
  const normalizedId = installationId.trim();
  const namespace = `office-kit/${edition}/${encodeURIComponent(normalizedId)}`;
  return Object.freeze({
    schemaVersion: 1,
    edition,
    channel: edition === "universal" ? "public" : "personal",
    installationId: normalizedId,
    storageNamespace: namespace,
    displayName: displayName.trim(),
    branding: Object.freeze({ ...branding }),
    adapterAllowlist: Object.freeze([...selected]),
    backend: Object.freeze({ configured: backend.configured === true, autoConnect: false, defaultMode: "read-only" }),
    privacy: Object.freeze({ telemetry: false, crossInstallationSync: false, shareDataByDefault: false })
  });
}

export function assertProfileIsolation(profiles) {
  if (!Array.isArray(profiles)) throw new TypeError("profiles_must_be_an_array");
  const namespaces = new Set();
  for (const profile of profiles) {
    if (!profile || typeof profile.storageNamespace !== "string") throw new TypeError("profile_storage_namespace_required");
    if (namespaces.has(profile.storageNamespace)) throw new Error("duplicate_installation_storage_namespace");
    namespaces.add(profile.storageNamespace);
  }
  return true;
}

export const productEditionCatalog = Object.freeze({
  universal: Object.freeze({ edition: "universal", channel: "public", backendIndependent: true }),
  dgmat: Object.freeze({ edition: "dgmat", channel: "personal", backendIndependent: true, adapterId: "dgm-mat" }),
  vst: Object.freeze({ edition: "vst", channel: "personal", backendIndependent: true, adapterStatus: "not_implemented" })
});
