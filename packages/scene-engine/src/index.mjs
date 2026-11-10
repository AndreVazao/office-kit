const finitePositive = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function validateViewport(viewport) {
  const errors = [];
  if (!viewport || !finitePositive(viewport.width)) errors.push("viewport.width must be a positive finite number.");
  if (!viewport || !finitePositive(viewport.height)) errors.push("viewport.height must be a positive finite number.");
  return { valid: errors.length === 0, errors };
}

/** Produces deterministic renderer-neutral geometry in logical scene units. */
export function calculateSceneLayout(config, viewport, options = {}) {
  const viewportResult = validateViewport(viewport);
  if (!viewportResult.valid) {
    const error = new Error("Invalid viewport.");
    error.validationErrors = viewportResult.errors;
    throw error;
  }
  if (!config || !Array.isArray(config.departments) || config.departments.length === 0) {
    throw new TypeError("config.departments must be a non-empty array.");
  }
  const logicalWidth = finitePositive(options.logicalWidth) ? options.logicalWidth : 1200;
  const floorHeight = finitePositive(options.floorHeight) ? options.floorHeight : 180;
  const roofHeight = finitePositive(options.roofHeight) ? options.roofHeight : 56;
  const baseHeight = finitePositive(options.baseHeight) ? options.baseHeight : 48;
  const padding = finitePositive(options.padding) ? options.padding : 24;
  const zoom = finitePositive(options.zoom) ? clamp(options.zoom, 0.5, 2) : 1;
  const sorted = [...config.departments].sort((a, b) => (b.floor ?? 0) - (a.floor ?? 0) || String(a.id).localeCompare(String(b.id)));
  const logicalHeight = roofHeight + baseHeight + floorHeight * sorted.length;
  const scale = Math.min((viewport.width - padding * 2) / logicalWidth, (viewport.height - padding * 2) / logicalHeight);
  const safeScale = Math.max(0.05, scale) * zoom;
  const xOffset = (viewport.width - logicalWidth * safeScale) / 2;
  const yOffset = (viewport.height - logicalHeight * safeScale) / 2;
  const floors = sorted.map((department, index) => {
    const y = roofHeight + index * floorHeight;
    const agents = (Array.isArray(department.agents) ? department.agents : []).map((agent, agentIndex, all) => ({
      id: agent.id,
      x: logicalWidth * 0.18 + ((logicalWidth * 0.78) * (agentIndex + 1) / (all.length + 1)),
      y: y + floorHeight * 0.58,
      departmentId: department.id
    }));
    return { id: department.id, label: department.name, floor: department.floor ?? null, x: 0, y, width: logicalWidth, height: floorHeight, agents };
  });
  return {
    viewport: { width: viewport.width, height: viewport.height },
    logicalBounds: { x: 0, y: 0, width: logicalWidth, height: logicalHeight },
    transform: { scale: safeScale, x: xOffset, y: yOffset },
    roof: { x: 0, y: 0, width: logicalWidth, height: roofHeight },
    floors,
    foundation: { x: 0, y: logicalHeight - baseHeight, width: logicalWidth, height: baseHeight },
    orientation: viewport.width >= viewport.height ? "landscape" : "portrait"
  };
}


export { SqliteNodeIdentityMetadataStore } from "./sqlite-node-identity-metadata-store.mjs";

export { InMemoryNodeIdentityChallengeStore, SqliteNodeIdentityChallengeStore } from "./node-identity-challenge-store.mjs";

export { NodeKeyStoreProvider, NodeIdentityMetadataStore, NodeIdentityManager, EphemeralEd25519KeyStore, EphemeralP256KeyStore } from "./node-identity.mjs";

export { SocialSimulationEngine, socialSimulationContract } from "./social-simulation.mjs";

export { OfficeHealthRecoveryEngine, OfficeConnectionSupervisor, InMemoryIncidentStore, officeHealthContract } from "./office-health.mjs";

export { resolveOfficeActivityState, officeActivityStateContract } from "./office-state-manager.mjs";

export { normalizeHardwareCapabilities, resolveAdaptiveResourcePolicy, adaptiveResourceContract } from "./resource-policy.mjs";
export { SqliteOfficeIncidentStore } from "./sqlite-office-incident-store.mjs";
