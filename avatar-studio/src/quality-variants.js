import * as THREE from "three";
import { AVATAR_QUALITY_PROFILES } from "./quality-profiles.js";

const POSITION_EPSILON = 1e-7;

function geometryTriangles(geometry) {
  const index = geometry.getIndex();
  if (geometry.groups?.length) return geometry.groups.reduce((sum, group) => sum + Math.floor(group.count / 3), 0);
  return Math.floor((index ? index.count : geometry.getAttribute("position")?.count || 0) / 3);
}

function attributeValue(attribute, index, component) {
  // Three.js BufferAttribute.getComponent() already denormalizes normalized
  // integer storage; do not apply a second conversion here.
  return attribute.getComponent(index, component);
}

function normalizedAttributeValue(attribute, index, component) {
  return attribute.getComponent(index, component);
}

function makeClusteredGeometry(source, cellSize) {
  const position = source.getAttribute("position");
  if (!position) return source.clone();
  const sourceIndex = source.getIndex();
  const vertexCount = position.count;
  const attributes = Object.entries(source.attributes);
  const morphEntries = Object.entries(source.morphAttributes || {});
  for (const [name, morphs] of morphEntries) {
    for (const morph of morphs) {
      if (morph.count !== vertexCount) throw new Error("Morph target " + name + " does not match source vertex count.");
    }
  }
  const uv = source.getAttribute("uv");
  const uv2 = source.getAttribute("uv2");
  const color = source.getAttribute("color");
  const normal = source.getAttribute("normal");
  const tangent = source.getAttribute("tangent");
  const skinIndex = source.getAttribute("skinIndex");
  const skinWeight = source.getAttribute("skinWeight");
  const bounds = new THREE.Box3().setFromBufferAttribute(position);
  const dimensions = new THREE.Vector3();
  bounds.getSize(dimensions);
  const diagonal = Math.max(dimensions.length(), POSITION_EPSILON);
  const uvCellSize = Math.max(cellSize / diagonal, 1e-4);
  const groups = source.groups?.length
    ? source.groups.map((group) => ({ start: group.start, count: group.count, materialIndex: group.materialIndex || 0 }))
    : [{ start: 0, count: sourceIndex ? sourceIndex.count : vertexCount, materialIndex: 0 }];
  const readIndex = (offset) => sourceIndex ? sourceIndex.getX(offset) : offset;
  const buckets = new Map();
  const vertices = [];
  const indicesByMaterial = new Map();

  const resolveVertex = (sourceVertex, materialIndex) => {
    const x = position.getX(sourceVertex);
    const y = position.getY(sourceVertex);
    const z = position.getZ(sourceVertex);
    // Quantize UVs at the same relative LOD scale: nearby points inside a UV
    // island can merge, while the 0/1 seam remains in a different bucket.
    const uvKey = uv ? Math.round(normalizedAttributeValue(uv, sourceVertex, 0) / uvCellSize) + ":" + Math.round(normalizedAttributeValue(uv, sourceVertex, 1) / uvCellSize) : "";
    const uv2Key = uv2 ? Math.round(normalizedAttributeValue(uv2, sourceVertex, 0) / uvCellSize) + ":" + Math.round(normalizedAttributeValue(uv2, sourceVertex, 1) / uvCellSize) : "";
    const normalKey = normal ? [Math.round(normal.getX(sourceVertex) * 20), Math.round(normal.getY(sourceVertex) * 20), Math.round(normal.getZ(sourceVertex) * 20)].join(":") : "";
    const tangentKey = tangent
      ? [Math.round(tangent.getX(sourceVertex) * 20), Math.round(tangent.getY(sourceVertex) * 20), Math.round(tangent.getZ(sourceVertex) * 20), tangent.itemSize > 3 && tangent.getW(sourceVertex) < 0 ? -1 : 1].join(":")
      : "";
    const colorKey = color
      ? Array.from({ length: color.itemSize }, (_, component) => Math.round(normalizedAttributeValue(color, sourceVertex, component) * 255)).join(":")
      : "";
    const key = [
      materialIndex,
      Math.round(x / cellSize),
      Math.round(y / cellSize),
      Math.round(z / cellSize),
      uvKey,
      uv2Key,
      normalKey,
      tangentKey,
      colorKey
    ].join("|");
    let target = buckets.get(key);
    if (target !== undefined) {
      const record = vertices[target];
      record.count += 1;
      for (const [name, attribute] of attributes) {
        if (name === "skinIndex" || name === "skinWeight") continue;
        const values = record.values[name];
        for (let component = 0; component < attribute.itemSize; component += 1) {
          values[component] += attributeValue(attribute, sourceVertex, component);
        }
      }
      for (const [name, morphs] of morphEntries) {
        morphs.forEach((attribute, morphIndex) => {
          const values = record.morphValues[name][morphIndex];
          for (let component = 0; component < attribute.itemSize; component += 1) {
            values[component] += attributeValue(attribute, sourceVertex, component);
          }
        });
      }
      if (skinIndex && skinWeight) {
        for (let component = 0; component < skinIndex.itemSize; component += 1) {
          const bone = Math.round(skinIndex.getComponent(sourceVertex, component));
          const weight = skinWeight.getComponent(sourceVertex, component);
          if (weight > 0) record.influences.set(bone, (record.influences.get(bone) || 0) + weight);
        }
      }
      return target;
    }

    target = vertices.length;
    const values = {};
    for (const [name, attribute] of attributes) {
      if (name === "skinIndex" || name === "skinWeight") continue;
      const components = [];
      for (let component = 0; component < attribute.itemSize; component += 1) {
        components.push(attributeValue(attribute, sourceVertex, component));
      }
      values[name] = components;
    }
    const morphValues = {};
    for (const [name, morphs] of morphEntries) {
      morphValues[name] = morphs.map((attribute) => {
        const values = [];
        for (let component = 0; component < attribute.itemSize; component += 1) {
          values.push(attributeValue(attribute, sourceVertex, component));
        }
        return values;
      });
    }
    const influences = new Map();
    if (skinIndex && skinWeight) {
      for (let component = 0; component < skinIndex.itemSize; component += 1) {
        const bone = Math.round(skinIndex.getComponent(sourceVertex, component));
        const weight = skinWeight.getComponent(sourceVertex, component);
        if (weight > 0) influences.set(bone, (influences.get(bone) || 0) + weight);
      }
    }
    vertices.push({ values, morphValues, influences, count: 1 });
    buckets.set(key, target);
    return target;
  };

  for (const group of groups) {
    const materialIndices = indicesByMaterial.get(group.materialIndex) || [];
    const end = Math.min(group.start + group.count, sourceIndex ? sourceIndex.count : vertexCount);
    for (let offset = group.start; offset + 2 < end; offset += 3) {
      const a = resolveVertex(readIndex(offset), group.materialIndex);
      const b = resolveVertex(readIndex(offset + 1), group.materialIndex);
      const c = resolveVertex(readIndex(offset + 2), group.materialIndex);
      if (a === b || b === c || a === c) continue;
      materialIndices.push(a, b, c);
    }
    indicesByMaterial.set(group.materialIndex, materialIndices);
  }

  const result = new THREE.BufferGeometry();
  for (const [name, attribute] of attributes) {
    if (name === "skinIndex" || name === "skinWeight") continue;
    // Store decoded semantic values as float attributes. This avoids writing
    // normalized values into integer arrays as raw integers (which would
    // corrupt normals, tangents, colors and normalized UV channels).
    const output = new Float32Array(vertices.length * attribute.itemSize);
    vertices.forEach((record, vertex) => {
      const values = record.values[name];
      for (let component = 0; component < attribute.itemSize; component += 1) {
        let value = values[component] / record.count;
        if (name === "normal") value = value;
        output[vertex * attribute.itemSize + component] = value;
      }
    });
    result.setAttribute(name, new THREE.BufferAttribute(output, attribute.itemSize, false));
  }

  for (const [name, morphs] of morphEntries) {
    result.morphAttributes[name] = morphs.map((attribute, morphIndex) => {
      const output = new Float32Array(vertices.length * attribute.itemSize);
      vertices.forEach((record, vertex) => {
        const values = record.morphValues[name][morphIndex];
        for (let component = 0; component < attribute.itemSize; component += 1) {
          output[vertex * attribute.itemSize + component] = values[component] / record.count;
        }
      });
      return new THREE.BufferAttribute(output, attribute.itemSize, false);
    });
  }

  if (skinIndex && skinWeight) {
    const indices = new Uint16Array(vertices.length * 4);
    const weights = new Float32Array(vertices.length * 4);
    vertices.forEach((record, vertex) => {
      const strongest = [...record.influences.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = strongest.reduce((sum, entry) => sum + entry[1], 0) || 1;
      strongest.forEach(([bone, weight], slot) => {
        indices[vertex * 4 + slot] = bone;
        weights[vertex * 4 + slot] = weight / total;
      });
    });
    result.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    result.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  }

  let groupStart = 0;
  for (const [materialIndex, materialIndices] of [...indicesByMaterial.entries()].sort((a, b) => a[0] - b[0])) {
    if (!materialIndices.length) continue;
    const groupCount = materialIndices.length;
    result.addGroup(groupStart, groupCount, materialIndex);
    groupStart += groupCount;
  }
  const flattened = [...indicesByMaterial.entries()].sort((a, b) => a[0] - b[0]).flatMap((entry) => entry[1]);
  if (flattened.length) {
    const IndexType = vertices.length > 65535 ? Uint32Array : Uint16Array;
    result.setIndex(new THREE.BufferAttribute(new IndexType(flattened), 1));
  }
  result.morphAttributes = source.morphAttributes;
  result.morphTargetsRelative = source.morphTargetsRelative;
  result.computeBoundingBox();
  result.computeBoundingSphere();
  if (result.getAttribute("tangent")) {
    const tangents = result.getAttribute("tangent");
    for (let i = 0; i < tangents.count; i += 1) {
      const length = Math.hypot(tangents.getX(i), tangents.getY(i), tangents.getZ(i)) || 1;
      tangents.setXYZ(i, tangents.getX(i) / length, tangents.getY(i) / length, tangents.getZ(i) / length);
      if (tangents.itemSize > 3) tangents.setW(i, tangents.getW(i) < 0 ? -1 : 1);
    }
  }
  if (result.getAttribute("normal")) {
    // Preserve averaged source normals; normalize them after clustering.
    const normals = result.getAttribute("normal");
    for (let i = 0; i < normals.count; i += 1) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) || 1;
      normals.setXYZ(i, normals.getX(i) / length, normals.getY(i) / length, normals.getZ(i) / length);
    }
  } else {
    result.computeVertexNormals();
  }
  return result;
}

function simplifyToBudget(source, targetTriangles) {
  const sourceTriangles = geometryTriangles(source);
  if (sourceTriangles <= targetTriangles || targetTriangles < 4) return source.clone();
  const position = source.getAttribute("position");
  const bounds = new THREE.Box3().setFromBufferAttribute(position, 0);
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const diagonal = Math.max(size.length(), POSITION_EPSILON);
  let low = diagonal / 10000;
  let high = diagonal / 3;
  let best = source.clone();

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const cellSize = (low + high) / 2;
    const candidate = makeClusteredGeometry(source, cellSize);
    const triangles = geometryTriangles(candidate);
    if (triangles > 0 && triangles <= targetTriangles) {
      best.dispose();
      best = candidate;
      high = cellSize;
    } else {
      candidate.dispose();
      low = cellSize;
    }
  }
  return best;
}

/**
 * Validates the structural invariants required by GLB export and skeletal playback.
 * Throws with the mesh name when a generated variant is unsafe to export.
 */
export function validateAvatarQualityVariant(root) {
  const report = { meshes: 0, skinnedMeshes: 0, triangles: 0, vertices: 0, warnings: [] };
  const failures = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    report.meshes += 1;
    report.triangles += geometryTriangles(geometry);
    report.vertices += position.count;
    const index = geometry.getIndex();
    if (position.count === 0 || geometryTriangles(geometry) === 0) {
      failures.push(mesh.name + ": geometria sem triângulos exportáveis.");
    }
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      if (attribute.count !== position.count) failures.push(mesh.name + ": atributo " + name + " incompatível com a geometria.");
    }
    for (const [name, morphs] of Object.entries(geometry.morphAttributes || {})) {
      for (const morph of morphs) {
        if (morph.count !== position.count) failures.push(mesh.name + ": morph target " + name + " incompatível.");
      }
    }
    if (index) {
      if (index.count % 3 !== 0) failures.push(mesh.name + ": índice com contagem incompatível com triângulos.");
      for (let i = 0; i < index.count; i += 1) {
        const vertex = index.getX(i);
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) {
          failures.push(mesh.name + ": índice de vértice fora dos limites.");
          break;
        }
      }
    } else if (position.count % 3 !== 0) {
      failures.push(mesh.name + ": vértices não indexados sem contagem de triângulos válida.");
    }
    const limit = index ? index.count : position.count;
    const ranges = [...(geometry.groups || [])].sort((a, b) => a.start - b.start);
    let previousEnd = 0;
    for (const group of ranges) {
      if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || !Number.isInteger(group.materialIndex) ||
          group.start < 0 || group.count < 0 || group.start + group.count > limit || group.count % 3 !== 0) {
        failures.push(mesh.name + ": grupo de material inválido.");
        break;
      }
      if (group.start < previousEnd) {
        failures.push(mesh.name + ": grupos de material sobrepostos.");
        break;
      }
      previousEnd = group.start + group.count;
      const materialCount = Array.isArray(mesh.material) ? mesh.material.length : 1;
      if (group.materialIndex < 0 || group.materialIndex >= materialCount) {
        failures.push(mesh.name + ": índice de material inexistente.");
        break;
      }
    }
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      for (let vertex = 0; vertex < attribute.count; vertex += 1) {
        for (let component = 0; component < attribute.itemSize; component += 1) {
          if (!Number.isFinite(attribute.getComponent(vertex, component))) {
            failures.push(mesh.name + ": atributo " + name + " contém valor não finito.");
            vertex = attribute.count;
            break;
          }
        }
      }
    }
    for (const [name, morphs] of Object.entries(geometry.morphAttributes || {})) {
      for (const morph of morphs) {
        for (let vertex = 0; vertex < morph.count; vertex += 1) {
          for (let component = 0; component < morph.itemSize; component += 1) {
            if (!Number.isFinite(morph.getComponent(vertex, component))) {
              failures.push(mesh.name + ": morph target " + name + " contém valor não finito.");
              vertex = morph.count;
              break;
            }
          }
        }
      }
    }
    if (mesh.isSkinnedMesh) {
      report.skinnedMeshes += 1;
      const skinIndex = geometry.getAttribute("skinIndex");
      const skinWeight = geometry.getAttribute("skinWeight");
      if (!skinIndex || !skinWeight || skinIndex.count !== position.count || skinWeight.count !== position.count || skinIndex.itemSize !== 4 || skinWeight.itemSize !== 4) {
        failures.push(mesh.name + ": atributos de skinning ausentes ou incompatíveis.");
        return;
      }
      const boneCount = mesh.skeleton?.bones?.length || 0;
      if (!boneCount) failures.push(mesh.name + ": esqueleto sem ossos.");
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        let totalWeight = 0;
        for (let component = 0; component < skinWeight.itemSize; component += 1) {
          const weight = skinWeight.getComponent(vertex, component);
          const rawBone = skinIndex.getComponent(vertex, component);
          const bone = Math.round(rawBone);
          if (!Number.isFinite(rawBone) || Math.abs(rawBone - bone) > 1e-6) {
            failures.push(mesh.name + ": índice ósseo não inteiro.");
            break;
          }
          if (!Number.isFinite(weight) || weight < -1e-6) {
            failures.push(mesh.name + ": peso ósseo inválido.");
            break;
          }
          if (weight > 1e-6 && (bone < 0 || bone >= boneCount)) {
            failures.push(mesh.name + ": referência a osso inexistente.");
            break;
          }
          totalWeight += weight;
        }
        if (Math.abs(totalWeight - 1) > 1e-3) {
          failures.push(mesh.name + ": pesos ósseos não normalizados.");
          break;
        }
      }
    }
  });
  if (failures.length) throw new Error("Validação da variante falhou: " + [...new Set(failures)].join(" "));
  return report;
}

/**
 * Temporarily replaces avatar mesh geometry with a profile-specific,
 * skinning-aware vertex-clustered variant. Call restore() after GLB export.
 */
export function applyAvatarQualityVariant(root, profileId) {
  const profile = AVATAR_QUALITY_PROFILES[profileId];
  if (!profile) throw new RangeError("Unknown avatar quality profile: " + profileId);
  const originals = [];
  const meshes = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh || !object.visible || !object.geometry?.getAttribute("position")) return;
    meshes.push(object);
  });
  const sourceTriangles = meshes.reduce((sum, mesh) => sum + geometryTriangles(mesh.geometry), 0);
  const targetTriangles = Math.min(sourceTriangles, profile.triangleBudget);
  const ratio = sourceTriangles > 0 ? targetTriangles / sourceTriangles : 1;
  let optimizedTriangles = 0;
  let optimizedVertices = 0;
  let validation = null;

  try {
    for (const mesh of meshes) {
      const original = mesh.geometry;
      const meshTriangles = geometryTriangles(original);
      const meshTarget = Math.max(1, Math.floor(meshTriangles * ratio));
      const optimized = profileId === "ultra" ? original.clone() : simplifyToBudget(original, meshTarget);
      if (mesh.isSkinnedMesh && (!optimized.getAttribute("skinIndex") || !optimized.getAttribute("skinWeight"))) {
        optimized.dispose();
        throw new Error("LOD generation removed required skinning attributes from " + mesh.name);
      }
      originals.push({ mesh, geometry: original });
      mesh.geometry = optimized;
      optimizedTriangles += geometryTriangles(optimized);
      optimizedVertices += optimized.getAttribute("position")?.count || 0;
      if (mesh.isSkinnedMesh) optimized.normalizeSkinWeights();
    }
    validation = validateAvatarQualityVariant(root);
  } catch (error) {
    for (const { mesh, geometry } of originals) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
    throw error;
  }

  let restored = false;
  return {
    profileId,
    sourceTriangles,
    optimizedTriangles,
    optimizedVertices,
    triangleBudget: profile.triangleBudget,
    withinTriangleBudget: optimizedTriangles <= profile.triangleBudget,
    meshCount: meshes.length,
    validation,
    restore() {
      if (restored) return;
      restored = true;
      for (const { mesh, geometry } of originals) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      }
    }
  };
}


const AVATAR_TEXTURE_SLOTS = [
  "map", "alphaMap", "aoMap", "bumpMap", "displacementMap", "emissiveMap",
  "envMap", "lightMap", "metalnessMap", "normalMap", "roughnessMap",
  "specularMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap"
];

function materialTextureAudit(material, maxSize) {
  const overBudget = [];
  let textureCount = 0;
  for (const slot of AVATAR_TEXTURE_SLOTS) {
    const texture = material?.[slot];
    if (!texture?.isTexture) continue;
    textureCount += 1;
    const image = texture.image;
    const width = image?.naturalWidth || image?.videoWidth || image?.width || 0;
    const height = image?.naturalHeight || image?.videoHeight || image?.height || 0;
    if (!width || !height || Math.max(width, height) > maxSize) {
      overBudget.push({ slot, width, height, maxSize });
    }
  }
  return { textureCount, overBudget };
}

function materialClassKey(material, precision) {
  const quantize = (value) => Number((Math.round(value / precision) * precision).toFixed(3));
  return JSON.stringify({
    type: material.type,
    roughness: Number.isFinite(material.roughness) ? quantize(material.roughness) : null,
    metalness: Number.isFinite(material.metalness) ? quantize(material.metalness) : null,
    emissive: material.emissive?.getHexString?.() || "",
    emissiveIntensity: material.emissiveIntensity ?? 1,
    side: material.side,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    flatShading: material.flatShading,
    wireframe: material.wireframe,
    blending: material.blending,
    toneMapped: material.toneMapped
  });
}

/**
 * Consolidates untextured single-material meshes into a small set of
 * vertex-colour materials. The original material references are restored
 * after GLB export; source textures are never mutated.
 */
export function applyAvatarMaterialVariant(root, profileId) {
  const profile = AVATAR_QUALITY_PROFILES[profileId];
  if (!profile) throw new RangeError("Unknown avatar quality profile: " + profileId);

  const meshes = [];
  const originalMaterials = [];
  const sourceMaterials = new Set();
  const auditedMaterials = new Set();
  const nonConvertibleMaterials = new Set();
  const textureIssues = [];
  let textureCount = 0;

  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || !mesh.material) return;
    meshes.push(mesh);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material) continue;
      sourceMaterials.add(material);
      let audit = { textureCount: 0, overBudget: [] };
      if (!auditedMaterials.has(material)) {
        audit = materialTextureAudit(material, profile.textureMaxSize);
        auditedMaterials.add(material);
        textureCount += audit.textureCount;
        for (const issue of audit.overBudget) textureIssues.push({ material: material.name || material.type, ...issue });
      } else {
        audit.textureCount = materialTextureAudit(material, profile.textureMaxSize).textureCount;
      }
      if (Array.isArray(mesh.material) || !material.isMeshStandardMaterial || !material.color || audit.textureCount > 0) {
        nonConvertibleMaterials.add(material);
      }
    }
  });

  const originalMaterialCount = sourceMaterials.size;
  const textureOverBudgetCount = textureIssues.length;
  const stepByProfile = { ultra: 0, high: 0.1, medium: 0.2, low: 0.35 };
  let precision = stepByProfile[profileId];
  const eligibleMaterials = new Set();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material)) continue;
    const material = mesh.material;
    if (material?.isMeshStandardMaterial && material.color && materialTextureAudit(material, profile.textureMaxSize).textureCount === 0) {
      eligibleMaterials.add(material);
    }
  }

  const fixedMaterialCount = nonConvertibleMaterials.size;
  if (precision > 0 && eligibleMaterials.size > 0) {
    while (precision < 1) {
      const classCount = new Set([...eligibleMaterials].map((material) => materialClassKey(material, precision))).size;
      if (fixedMaterialCount + classCount <= profile.materialBudget) break;
      precision = Math.min(1, Number((precision + 0.05).toFixed(2)));
    }
  }

  const classMaterials = new Map();
  const variantMaterials = new Set();
  try {
    for (const mesh of meshes) {
      if (Array.isArray(mesh.material)) continue;
      const original = mesh.material;
      if (!eligibleMaterials.has(original) || precision === 0) continue;

      const position = mesh.geometry?.getAttribute("position");
      if (!position) continue;
      const existingColor = mesh.geometry.getAttribute("color");
      const colors = new Float32Array(position.count * 3);
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        const baseR = original.color.r;
        const baseG = original.color.g;
        const baseB = original.color.b;
        if (existingColor && original.vertexColors) {
          colors[vertex * 3] = existingColor.getX(vertex) * baseR;
          colors[vertex * 3 + 1] = existingColor.getY(vertex) * baseG;
          colors[vertex * 3 + 2] = existingColor.getZ(vertex) * baseB;
        } else {
          colors[vertex * 3] = baseR;
          colors[vertex * 3 + 1] = baseG;
          colors[vertex * 3 + 2] = baseB;
        }
      }
      mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      const key = materialClassKey(original, precision);
      let variantMaterial = classMaterials.get(key);
      if (!variantMaterial) {
        variantMaterial = original.clone();
        variantMaterial.color.setRGB(1, 1, 1);
        variantMaterial.vertexColors = true;
        if (Number.isFinite(original.roughness)) variantMaterial.roughness = Number((Math.round(original.roughness / precision) * precision).toFixed(3));
        if (Number.isFinite(original.metalness)) variantMaterial.metalness = Number((Math.round(original.metalness / precision) * precision).toFixed(3));
        variantMaterial.needsUpdate = true;
        classMaterials.set(key, variantMaterial);
        variantMaterials.add(variantMaterial);
      }
      originalMaterials.push({ mesh, material: original });
      mesh.material = variantMaterial;
    }
  } catch (error) {
    for (const { mesh, material } of originalMaterials) mesh.material = material;
    for (const material of variantMaterials) material.dispose();
    throw error;
  }

  const finalMaterials = new Set();
  for (const mesh of meshes) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) finalMaterials.add(material);
    }
  }
  const materialCount = finalMaterials.size;
  let restored = false;
  return {
    profileId,
    sourceMaterialCount: originalMaterialCount,
    materialCount,
    materialBudget: profile.materialBudget,
    textureCount,
    textureMaxSize: profile.textureMaxSize,
    textureIssues,
    withinMaterialBudget: materialCount <= profile.materialBudget,
    withinTextureBudget: textureOverBudgetCount === 0,
    precision,
    convertedMeshCount: originalMaterials.length,
    restore() {
      if (restored) return;
      restored = true;
      for (const { mesh, material } of originalMaterials) mesh.material = material;
      for (const material of variantMaterials) material.dispose();
    }
  };
}
