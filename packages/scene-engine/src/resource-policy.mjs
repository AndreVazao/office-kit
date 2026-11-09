const PROFILE_RANK = Object.freeze({ economy: 0, balanced: 1, detailed: 2, cinematic: 3 });
const RENDERER_RANK = Object.freeze({ minimal: 0, pixel: 1, low_poly: 2, three_d: 3 });
const VALID_PROFILES = new Set(Object.keys(PROFILE_RANK));
const VALID_RENDERERS = new Set(Object.keys(RENDERER_RANK));
const positive = value => Number.isFinite(value) && value > 0;
const optionalPositive = value => value == null || positive(value);

export function normalizeHardwareCapabilities(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("hardware capabilities must be an object.");
  }
  const integerFields = ["cpuCores", "memoryTotalMB", "memoryAvailableMB", "gpuVramMB", "storageFreeMB", "displayWidth", "displayHeight"];
  for (const field of integerFields) {
    if (input[field] != null && (!Number.isInteger(input[field]) || input[field] <= 0)) {
      throw new RangeError(`${field} must be a positive integer when supplied.`);
    }
  }
  return Object.freeze({
    os: typeof input.os === "string" ? input.os : "unknown",
    architecture: typeof input.architecture === "string" ? input.architecture : "unknown",
    cpuModel: typeof input.cpuModel === "string" ? input.cpuModel : null,
    cpuCores: input.cpuCores ?? null,
    memoryTotalMB: input.memoryTotalMB ?? null,
    memoryAvailableMB: input.memoryAvailableMB ?? null,
    gpuName: typeof input.gpuName === "string" ? input.gpuName : null,
    gpuVramMB: input.gpuVramMB ?? null,
    graphicsApi: typeof input.graphicsApi === "string" ? input.graphicsApi : null,
    storageFreeMB: input.storageFreeMB ?? null,
    displayWidth: input.displayWidth ?? null,
    displayHeight: input.displayHeight ?? null
  });
}

function candidateFrom(capabilities, measurements = {}) {
  const cores = capabilities.cpuCores;
  const memory = capabilities.memoryAvailableMB ?? capabilities.memoryTotalMB;
  const vram = capabilities.gpuVramMB;
  const frameTime = measurements.frameTimeMs;
  const memoryPressure = measurements.memoryPressure === true ||
    (positive(memory) && memory <= 1_024);
  const slowFrame = positive(frameTime) && frameTime >= 45;
  const lowCpu = cores !== null && cores <= 2;
  const lowMemory = capabilities.memoryTotalMB !== null && capabilities.memoryTotalMB <= 4_096;
  const weakGpu = vram !== null && vram <= 1_024;

  let profile = "balanced";
  if (lowCpu || lowMemory || memoryPressure || slowFrame || weakGpu) profile = "economy";
  else if (cores !== null && cores >= 12 &&
    capabilities.memoryTotalMB !== null && capabilities.memoryTotalMB >= 32_768 &&
    vram !== null && vram >= 8_192 && (!positive(frameTime) || frameTime < 16)) profile = "cinematic";
  else if (cores !== null && cores >= 8 &&
    capabilities.memoryTotalMB !== null && capabilities.memoryTotalMB >= 16_384 &&
    vram !== null && vram >= 4_096 && (!positive(frameTime) || frameTime < 22)) profile = "detailed";

  let rendererTier = "pixel";
  if (lowCpu || memoryPressure || (vram !== null && vram < 512)) rendererTier = "minimal";
  else if (profile === "detailed" || profile === "cinematic") rendererTier = "three_d";
  else if (profile === "balanced" && cores !== null && cores >= 4 && vram !== null && vram >= 2_048) rendererTier = "low_poly";

  return { profile, rendererTier };
}

/**
 * Resolves a hardware-aware resource policy. Profile changes alter rendering
 * fidelity only; social behavior and operational capabilities remain intact.
 */
export function resolveAdaptiveResourcePolicy(input = {}) {
  const capabilities = normalizeHardwareCapabilities(input.capabilities ?? {});
  const requestedProfile = input.requestedProfile ?? "auto";
  const requestedRenderer = input.requestedRenderer ?? "auto";
  if (requestedProfile !== "auto" && !VALID_PROFILES.has(requestedProfile)) throw new RangeError("invalid_quality_profile");
  if (requestedRenderer !== "auto" && !VALID_RENDERERS.has(requestedRenderer)) throw new RangeError("invalid_renderer_tier");

  const candidate = candidateFrom(capabilities, input.measurements ?? {});
  const previous = input.previousPolicy ?? null;
  const manual = requestedProfile !== "auto" || requestedRenderer !== "auto";
  let profile = requestedProfile === "auto" ? candidate.profile : requestedProfile;
  let rendererTier = requestedRenderer === "auto" ? candidate.rendererTier : requestedRenderer;
  let degradationStreak = 0;
  let recoveryStreak = 0;
  let transition = "initial";

  if (manual) {
    transition = "manual_override";
  } else if (previous && VALID_PROFILES.has(previous.profile) && VALID_RENDERERS.has(previous.rendererTier)) {
    const oldRank = Math.min(PROFILE_RANK[previous.profile], RENDERER_RANK[previous.rendererTier]);
    const newRank = Math.min(PROFILE_RANK[candidate.profile], RENDERER_RANK[candidate.rendererTier]);
    if (newRank < oldRank) {
      degradationStreak = (previous.degradationStreak ?? 0) + 1;
      if (degradationStreak < (input.degradeAfterSamples ?? 2)) {
        profile = previous.profile;
        rendererTier = previous.rendererTier;
        transition = "holding_before_degradation";
      } else transition = "degraded";
    } else if (newRank > oldRank) {
      recoveryStreak = (previous.recoveryStreak ?? 0) + 1;
      if (recoveryStreak < (input.recoverAfterSamples ?? 4)) {
        profile = previous.profile;
        rendererTier = previous.rendererTier;
        transition = "holding_before_recovery";
      } else transition = "recovered";
    } else {
      transition = "stable";
    }
  }

  const weak = profile === "economy" || rendererTier === "minimal" || rendererTier === "pixel";
  const memoryAvailable = capabilities.memoryAvailableMB ?? capabilities.memoryTotalMB;
  const rendererMemoryBudgetMB = memoryAvailable === null
    ? (weak ? 128 : 384)
    : Math.max(64, Math.min(weak ? 256 : 1_024, Math.floor(memoryAvailable * (weak ? 0.08 : 0.18))));
  const rendererCpuBudgetPercent = profile === "economy" ? 10 : profile === "balanced" ? 18 : profile === "detailed" ? 26 : 32;

  return {
    schemaVersion: 1,
    selectedBy: manual ? "user" : "automatic",
    profile,
    rendererTier,
    transition,
    degradationStreak,
    recoveryStreak,
    socialSimulationEnabled: true,
    socialActivitySemantics: "full",
    animationDetail: rendererTier,
    backendExecutionPolicy: "independent_protected",
    rendererBudget: {
      cpuPercentTarget: rendererCpuBudgetPercent,
      memoryMB: rendererMemoryBudgetMB,
      targetFps: profile === "economy" ? 24 : profile === "balanced" ? 30 : 60,
      shadows: profile === "detailed" || profile === "cinematic",
      advancedLighting: profile === "cinematic",
      textureScale: profile === "economy" ? 0.35 : profile === "balanced" ? 0.65 : profile === "detailed" ? 1 : 1.25
    },
    capabilities
  };
}

export const adaptiveResourceContract = Object.freeze({
  profiles: Object.freeze(Object.keys(PROFILE_RANK)),
  rendererTiers: Object.freeze(Object.keys(RENDERER_RANK)),
  socialActivitySemantics: "full",
  backendExecutionPolicy: "independent_protected"
});
