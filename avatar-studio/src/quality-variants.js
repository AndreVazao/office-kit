import * as THREE from "three";
import { AVATAR_QUALITY_PROFILES } from "./quality-profiles.js";

const POSITION_EPSILON = 1e-7;

function geometryTriangles(geometry) {
  const index = geometry.getIndex();
  if (geometry.groups?.length) return geometry.groups.reduce((sum, group) => sum + Math.floor(group.count / 3), 0);
  return Math.floor((index ? index.count : geometry.getAttribute("position")?.count || 0) / 3);
}

function attributeValue(attribute, index, component) {
  return attribute.getComponent(index, component);
}

function makeClusteredGeometry(source, cellSize) {
  const position = source.getAttribute("position");
  if (!position) return source.clone();
  const sourceIndex = source.getIndex();
  const vertexCount = position.count;
  const attributes = Object.entries(source.attributes);
  const uv = source.getAttribute("uv");
  const skinIndex = source.getAttribute("skinIndex");
  const skinWeight = source.getAttribute("skinWeight");
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
    const uvKey = uv ? Math.round(uv.getX(sourceVertex) * 10000) + ":" + Math.round(uv.getY(sourceVertex) * 10000) : "";
    const key = [
      materialIndex,
      Math.round(x / cellSize),
      Math.round(y / cellSize),
      Math.round(z / cellSize),
      uvKey
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
    const influences = new Map();
    if (skinIndex && skinWeight) {
      for (let component = 0; component < skinIndex.itemSize; component += 1) {
        const bone = Math.round(skinIndex.getComponent(sourceVertex, component));
        const weight = skinWeight.getComponent(sourceVertex, component);
        if (weight > 0) influences.set(bone, (influences.get(bone) || 0) + weight);
      }
    }
    vertices.push({ values, influences, count: 1 });
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
    const ArrayType = attribute.array.constructor;
    const output = new ArrayType(vertices.length * attribute.itemSize);
    vertices.forEach((record, vertex) => {
      const values = record.values[name];
      for (let component = 0; component < attribute.itemSize; component += 1) {
        let value = values[component] / record.count;
        if (name === "normal") value = value;
        output[vertex * attribute.itemSize + component] = value;
      }
    });
    result.setAttribute(name, new THREE.BufferAttribute(output, attribute.itemSize, attribute.normalized));
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

  for (const mesh of meshes) {
    const original = mesh.geometry;
    const meshTriangles = geometryTriangles(original);
    const meshTarget = Math.max(1, Math.floor(meshTriangles * ratio));
    const optimized = profileId === "ultra" ? original.clone() : simplifyToBudget(original, meshTarget);
    originals.push({ mesh, geometry: original });
    mesh.geometry = optimized;
    optimizedTriangles += geometryTriangles(optimized);
    optimizedVertices += optimized.getAttribute("position")?.count || 0;
    if (mesh.isSkinnedMesh) optimized.normalizeSkinWeights();
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
