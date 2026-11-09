import { cpus, freemem, platform, release, totalmem, arch } from "node:os";
import { statfsSync } from "node:fs";

const mb = bytes => Math.floor(bytes / (1024 * 1024));
const validDimension = value => Number.isInteger(value) && value > 0 && value <= 32_768;

/**
 * Reads safe, non-identifying host capability facts. GPU/display details are
 * optional providers because the OS APIs differ and adapter memory is not
 * reliably equivalent to dedicated VRAM.
 */
export function detectHostHardwareCapabilities({
  osPlatform = platform,
  osRelease = release,
  osArchitecture = arch,
  cpuProbe = cpus,
  totalMemoryProbe = totalmem,
  availableMemoryProbe = freemem,
  storagePath = process.cwd(),
  storageProbe = statfsSync,
  graphicsProbe,
  displayProbe,
  clock = Date.now
} = {}) {
  const warnings = [];
  let cpuList = [];
  try { cpuList = cpuProbe(); } catch { warnings.push("cpu_probe_failed"); }
  let memoryTotal = null;
  let memoryAvailable = null;
  try { memoryTotal = mb(totalMemoryProbe()); } catch { warnings.push("total_memory_probe_failed"); }
  try { memoryAvailable = mb(availableMemoryProbe()); } catch { warnings.push("available_memory_probe_failed"); }

  let storageFreeMB = null;
  try {
    const storage = storageProbe(storagePath);
    if (Number.isFinite(storage?.bavail) && Number.isFinite(storage?.bsize)) {
      storageFreeMB = mb(storage.bavail * storage.bsize);
    } else warnings.push("storage_probe_invalid");
  } catch { warnings.push("storage_probe_failed"); }

  let graphics = null;
  if (typeof graphicsProbe === "function") {
    try { graphics = graphicsProbe() ?? null; }
    catch { warnings.push("graphics_probe_failed"); }
  } else warnings.push("graphics_probe_not_configured");

  let display = null;
  if (typeof displayProbe === "function") {
    try { display = displayProbe() ?? null; }
    catch { warnings.push("display_probe_failed"); }
  } else warnings.push("display_probe_not_configured");

  const gpuVramMB = Number.isInteger(graphics?.dedicatedVramMB) && graphics.dedicatedVramMB > 0
    ? graphics.dedicatedVramMB : null;
  const displayWidth = validDimension(display?.width) ? display.width : null;
  const displayHeight = validDimension(display?.height) ? display.height : null;

  return Object.freeze({
    os: [osPlatform, osRelease].filter(Boolean).join(" "),
    architecture: osArchitecture,
    cpuModel: typeof cpuList[0]?.model === "string" ? cpuList[0].model : null,
    cpuThreads: cpuList.length || null,
    memoryTotalMB: Number.isInteger(memoryTotal) && memoryTotal > 0 ? memoryTotal : null,
    memoryAvailableMB: Number.isInteger(memoryAvailable) && memoryAvailable > 0 ? memoryAvailable : null,
    gpuName: typeof graphics?.name === "string" ? graphics.name : null,
    gpuVramMB,
    graphicsApi: typeof graphics?.api === "string" ? graphics.api : null,
    storageFreeMB,
    displayWidth,
    displayHeight,
    detectedAt: new Date(clock()).toISOString(),
    detectionWarnings: warnings
  });
}
