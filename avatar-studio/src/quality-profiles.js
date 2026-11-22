/**
 * Device-independent avatar delivery profiles.
 *
 * Avatar Studio authors the source model and declares the available quality
 * tiers. The Office Kit runtime remains the sole authority that selects a
 * tier for a device/session. This module deliberately does not inspect device
 * capabilities, change runtime settings, or import any Office Kit package.
 *
 * Geometry budgets are authoring targets for future tier-specific mesh
 * generation, not claims that the current prototype has already been
 * decimated to those budgets.
 */
export const AVATAR_QUALITY_PROFILES = Object.freeze({
  ultra: Object.freeze({
    id: "ultra",
    label: "Ultra",
    target: "Desktop potente / ecrã de alta resolução",
    triangleBudget: 120000,
    materialBudget: 16,
    textureMaxSize: 4096,
    shadowQuality: "high",
    facialDetail: "full",
    fingerDetail: "full",
    hairDetail: "full",
    animation: "full",
    recommendedPixelRatio: 2
  }),
  high: Object.freeze({
    id: "high",
    label: "Alta",
    target: "Desktop e telemóvel recente",
    triangleBudget: 65000,
    materialBudget: 12,
    textureMaxSize: 2048,
    shadowQuality: "medium",
    facialDetail: "full",
    fingerDetail: "full",
    hairDetail: "reduced",
    animation: "full",
    recommendedPixelRatio: 1.5
  }),
  medium: Object.freeze({
    id: "medium",
    label: "Média",
    target: "Telemóvel intermédio / portátil modesto",
    triangleBudget: 28000,
    materialBudget: 8,
    textureMaxSize: 1024,
    shadowQuality: "low",
    facialDetail: "reduced",
    fingerDetail: "simplified",
    hairDetail: "simplified",
    animation: "full",
    recommendedPixelRatio: 1
  }),
  low: Object.freeze({
    id: "low",
    label: "Baixa",
    target: "Telemóvel básico / hardware limitado",
    triangleBudget: 10000,
    materialBudget: 5,
    textureMaxSize: 512,
    shadowQuality: "off",
    facialDetail: "essential",
    fingerDetail: "rigid-hand",
    hairDetail: "minimal",
    animation: "full",
    recommendedPixelRatio: 0.75
  })
});

export const AVATAR_QUALITY_ORDER = Object.freeze([
  "low",
  "medium",
  "high",
  "ultra"
]);

/**
 * Attach the quality contract to the exported glTF root as standard extras.
 * Selection and fallback remain the responsibility of the consuming runtime.
 */
export function attachAvatarQualityMetadata(root, sourceId = "avatar-studio") {
  root.userData = root.userData || {};
  root.userData.officeKitAvatar = {
    schemaVersion: 1,
    source: sourceId,
    qualityProfiles: AVATAR_QUALITY_ORDER.map((id) => {
      const { id: profileId, label, target, ...budget } = AVATAR_QUALITY_PROFILES[id];
      return { id: profileId, label, target, ...budget };
    }),
    selectionPolicy: "runtime-owned",
    currentPrototypeStatus: "source-model-only; tier-specific mesh generation pending"
  };
  return root;
}
