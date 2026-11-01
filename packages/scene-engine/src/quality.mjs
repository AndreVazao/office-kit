export const QUALITY_PROFILES = Object.freeze({
  economy: Object.freeze({
    id: "economy",
    label: "Económico",
    maxDevicePixelRatio: 1,
    targetFps: 30,
    shadows: false,
    ambientEffects: false,
    animationLevel: "reduced",
    textureScale: 0.5,
    maxVisibleAgents: 40
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "Equilibrado",
    maxDevicePixelRatio: 1.5,
    targetFps: 45,
    shadows: false,
    ambientEffects: true,
    animationLevel: "standard",
    textureScale: 0.75,
    maxVisibleAgents: 100
  }),
  detailed: Object.freeze({
    id: "detailed",
    label: "Detalhado",
    maxDevicePixelRatio: 2,
    targetFps: 60,
    shadows: true,
    ambientEffects: true,
    animationLevel: "full",
    textureScale: 1,
    maxVisibleAgents: 250
  }),
  cinematic: Object.freeze({
    id: "cinematic",
    label: "Cinemático",
    maxDevicePixelRatio: 2.5,
    targetFps: 60,
    shadows: true,
    ambientEffects: true,
    animationLevel: "full",
    textureScale: 1.25,
    maxVisibleAgents: 500
  })
});

const VALID_IDS = new Set(Object.keys(QUALITY_PROFILES));

/**
 * Resolve a requested graphics profile without touching rendering APIs.
 * Automatic mode uses conservative device hints; measured performance can
 * later refine this choice without changing the public profile contract.
 */
export function resolveQualityProfile(requested = "auto", hints = {}) {
  if (requested !== "auto") {
    if (!VALID_IDS.has(requested)) {
      throw new RangeError(`Unknown quality profile: ${requested}`);
    }
    return { ...QUALITY_PROFILES[requested], selectedBy: "user" };
  }

  const memory = Number.isFinite(hints.deviceMemory) ? hints.deviceMemory : null;
  const cores = Number.isFinite(hints.hardwareConcurrency) ? hints.hardwareConcurrency : null;
  const narrowViewport = Number.isFinite(hints.viewportWidth) && hints.viewportWidth < 480;
  const saveData = hints.saveData === true;
  const reducedMotion = hints.reducedMotion === true;

  let id = "balanced";
  if (saveData || reducedMotion || (memory !== null && memory <= 2) || (cores !== null && cores <= 4)) {
    id = "economy";
  } else if ((memory !== null && memory >= 8) && (cores === null || cores >= 8) && !narrowViewport) {
    id = "detailed";
  }

  return {
    ...QUALITY_PROFILES[id],
    selectedBy: "auto",
    reasons: [
      ...(saveData ? ["save-data"] : []),
      ...(reducedMotion ? ["reduced-motion"] : []),
      ...(memory !== null ? [`device-memory:${memory}GB`] : []),
      ...(cores !== null ? [`cpu-cores:${cores}`] : []),
      ...(narrowViewport ? ["narrow-viewport"] : [])
    ]
  };
}
