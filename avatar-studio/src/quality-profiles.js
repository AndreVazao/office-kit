/**
 * Device-independent avatar delivery profiles and source-geometry audit.
 *
 * The Office Kit runtime alone selects a profile for a device/session.
 * This module measures the source model; it does not claim to decimate it.
 */
export const AVATAR_QUALITY_PROFILES = Object.freeze({
  ultra: Object.freeze({ id:"ultra", label:"Ultra", target:"Desktop potente / ecrã de alta resolução", triangleBudget:120000, materialBudget:16, textureMaxSize:4096, shadowQuality:"high", facialDetail:"full", fingerDetail:"full", hairDetail:"full", animation:"full", recommendedPixelRatio:2 }),
  high: Object.freeze({ id:"high", label:"Alta", target:"Desktop e telemóvel recente", triangleBudget:65000, materialBudget:12, textureMaxSize:2048, shadowQuality:"medium", facialDetail:"full", fingerDetail:"full", hairDetail:"reduced", animation:"full", recommendedPixelRatio:1.5 }),
  medium: Object.freeze({ id:"medium", label:"Média", target:"Telemóvel intermédio / portátil modesto", triangleBudget:28000, materialBudget:8, textureMaxSize:1024, shadowQuality:"low", facialDetail:"reduced", fingerDetail:"simplified", hairDetail:"simplified", animation:"full", recommendedPixelRatio:1 }),
  low: Object.freeze({ id:"low", label:"Baixa", target:"Telemóvel básico / hardware limitado", triangleBudget:10000, materialBudget:5, textureMaxSize:512, shadowQuality:"off", facialDetail:"essential", fingerDetail:"rigid-hand", hairDetail:"minimal", animation:"full", recommendedPixelRatio:0.75 })
});

export const AVATAR_QUALITY_ORDER = Object.freeze(["low", "medium", "high", "ultra"]);

export function measureAvatarGeometry(root) {
  if (!root || typeof root.traverse !== "function") throw new TypeError("A valid avatar root is required.");
  let triangles = 0;
  let visibleMeshes = 0;
  let skinnedMeshes = 0;
  let vertices = 0;
  const materials = new Set();
  const meshBreakdown = [];
  root.traverse((object) => {
    if (!object.isMesh || !object.visible || !object.geometry) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    let meshTriangles = 0;
    if (geometry.groups?.length) {
      for (const group of geometry.groups) {
        const count = group.count;
        meshTriangles += Math.floor(count / 3);
      }
    } else {
      meshTriangles = Math.floor((index ? index.count : position.count) / 3);
    }
    triangles += meshTriangles;
    vertices += position.count;
    visibleMeshes += 1;
    if (object.isSkinnedMesh) skinnedMeshes += 1;
    for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      if (mat) materials.add(mat.uuid || mat);
    }
    meshBreakdown.push({ name: object.name || "unnamed", triangles: meshTriangles, vertices: position.count, skinned: Boolean(object.isSkinnedMesh) });
  });
  return { triangles, vertices, visibleMeshes, skinnedMeshes, materialCount: materials.size, meshBreakdown };
}

export function evaluateAvatarQuality(metrics) {
  return AVATAR_QUALITY_ORDER.map((id) => {
    const profile = AVATAR_QUALITY_PROFILES[id];
    const triangleRatio = metrics.triangles / profile.triangleBudget;
    const materialRatio = metrics.materialCount / profile.materialBudget;
    const fits = triangleRatio <= 1 && materialRatio <= 1;
    return {
      id,
      label: profile.label,
      fits,
      triangleRatio: Number(triangleRatio.toFixed(3)),
      materialRatio: Number(materialRatio.toFixed(3)),
      triangleHeadroom: profile.triangleBudget - metrics.triangles,
      materialHeadroom: profile.materialBudget - metrics.materialCount
    };
  });
}

export function attachAvatarQualityMetadata(root, sourceId = "avatar-studio") {
  const metrics = measureAvatarGeometry(root);
  root.userData = root.userData || {};
  root.userData.officeKitAvatar = {
    schemaVersion: 1,
    source: sourceId,
    sourceGeometry: {
      triangles: metrics.triangles,
      vertices: metrics.vertices,
      visibleMeshes: metrics.visibleMeshes,
      skinnedMeshes: metrics.skinnedMeshes,
      materialCount: metrics.materialCount
    },
    qualityProfiles: AVATAR_QUALITY_ORDER.map((id) => {
      const { id: profileId, label, target, ...budget } = AVATAR_QUALITY_PROFILES[id];
      return { id: profileId, label, target, ...budget };
    }),
    measuredProfileFit: evaluateAvatarQuality(metrics),
    selectionPolicy: "runtime-owned",
    tierAssetStatus: "generated-on-demand; selected-profile-geometry-export"
  };
  return metrics;
}
