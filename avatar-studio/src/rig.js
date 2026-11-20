import * as THREE from "three";

/**
 * Runtime avatar rig. Limb cylinders tagged by main.js are converted into
 * SkinnedMesh segments with linear-blend weights. Head and hand assemblies
 * are converted as rigid skinned groups; facial parts and fingers retain shape.
 */
export function createAvatarRig(parent) {
  const segments = [];
  const skinnedMeshes = [];
  parent.traverse((object) => {
    if (object.isMesh && object.userData.rigSegment) segments.push(object);
  });

  const bones = {};
  const worldPositions = {};
  const makeBone = (name, worldPosition, parentBone) => {
    const bone = new THREE.Bone();
    bone.name = name;
    const p = new THREE.Vector3(...worldPosition);
    const parentPosition = parentBone ? worldPositions[parentBone.name] : [0, 0, 0];
    bone.position.copy(p.sub(new THREE.Vector3(...parentPosition)));
    (parentBone || parent).add(bone);
    bones[name] = bone;
    worldPositions[name] = worldPosition.slice();
    return bone;
  };

  const hips = makeBone("Hips", [0, 0.99, 0]);
  const spine = makeBone("Spine", [0, 1.34, 0], hips);
  const chest = makeBone("Chest", [0, 1.56, 0], spine);
  const neck = makeBone("Neck", [0, 1.72, 0], chest);
  makeBone("Head", [0, 1.94, 0], neck);

  const byName = new Map(segments.map((mesh) => [mesh.userData.rigSegment.name, mesh.userData.rigSegment]));
  for (const side of ["L", "R"]) {
    const upperArmData = byName.get("UpperArm_" + side);
    const forearmData = byName.get("Forearm_" + side);
    const legData = byName.get("Leg_" + side);
    const shoulderPosition = upperArmData?.start || [side === "L" ? -0.34 : 0.34, 1.56, 0];
    const elbowPosition = upperArmData?.end || [side === "L" ? -0.43 : 0.43, 1.18, 0];
    const wristPosition = forearmData?.end || [side === "L" ? -0.47 : 0.47, 0.88, 0.05];
    const hipPosition = legData?.start || [side === "L" ? -0.115 : 0.115, 0.91, 0];
    const anklePosition = legData?.end || [side === "L" ? -0.12 : 0.12, 0.16, 0];

    const upperArm = makeBone("UpperArm_" + side, shoulderPosition, chest);
    const forearm = makeBone("Forearm_" + side, elbowPosition, upperArm);
    const handBone = makeBone("Hand_" + side, wristPosition, forearm);
    for (let finger = 1; finger <= 4; finger += 1) {
      const x = (finger - 2.5) * 0.027;
      makeBone("Finger_" + finger + "_" + side, [wristPosition[0] + x, wristPosition[1] - 0.035, wristPosition[2] + 0.005], handBone);
    }
    makeBone("Thumb_" + side, [wristPosition[0] + (side === "L" ? 0.045 : -0.045), wristPosition[1] + 0.005, wristPosition[2] + 0.005], handBone);
    const upperLeg = makeBone("UpperLeg_" + side, hipPosition, hips);
    const lowerLeg = makeBone("LowerLeg_" + side, anklePosition, upperLeg);
    makeBone("Foot_" + side, [anklePosition[0], 0.10, anklePosition[2] + 0.10], lowerLeg);
  }

  const orderedBones = Object.values(bones);
  const boneIndex = new Map(orderedBones.map((bone, index) => [bone.name, index]));
  const skeleton = new THREE.Skeleton(orderedBones);

  const segmentBones = (name) => {
    const side = name.endsWith("_L") ? "L" : "R";
    if (name.startsWith("UpperArm_")) return ["UpperArm_" + side, "Forearm_" + side];
    if (name.startsWith("Forearm_")) return ["Forearm_" + side, "Hand_" + side];
    if (name.startsWith("Leg_")) return ["UpperLeg_" + side, "LowerLeg_" + side];
    return null;
  };

  // Convert head and hand assemblies to rigidly weighted skinned meshes.
  // Geometry is moved into avatar-root space before binding so nested group
  // transforms (head scale, hand offsets) are preserved without double transforms.
  parent.updateMatrixWorld(true);
  const inverseRootWorld = parent.matrixWorld.clone().invert();
  const assemblies = [];
  const rigidMeshes = [];
  parent.traverse((object) => {
    if (object.isGroup && (object.userData.rigHeadGroup || object.userData.rigFingerName)) {
      assemblies.push(object);
    } else if (object.isMesh && object.userData.rigBoneName) {
      rigidMeshes.push(object);
    }
  });
  for (const assembly of assemblies) {
    const side = assembly.userData.rigHandSide;
    const boneName = assembly.userData.rigHeadGroup
      ? "Head"
      : assembly.userData.rigFingerName === "Thumb"
        ? "Thumb_" + side
        : assembly.userData.rigFingerName + "_" + side;
    const boneId = boneIndex.get(boneName);
    if (boneId === undefined) continue;
    const sourceMeshes = [];
    assembly.traverse((object) => {
      if (object.isMesh && !object.isSkinnedMesh) sourceMeshes.push(object);
    });
    for (const sourceMesh of sourceMeshes) {
      sourceMesh.updateWorldMatrix(true, false);
      const transform = inverseRootWorld.clone().multiply(sourceMesh.matrixWorld);
      const geometry = sourceMesh.geometry.clone();
      geometry.applyMatrix4(transform);
      const positions = geometry.getAttribute("position");
      const indices = new Uint16Array(positions.count * 4);
      const weights = new Float32Array(positions.count * 4);
      for (let i = 0; i < positions.count; i += 1) {
        indices[i * 4] = boneId;
        weights[i * 4] = 1;
      }
      geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
      const skinned = new THREE.SkinnedMesh(geometry, sourceMesh.material);
      skinned.name = sourceMesh.name + "_Skinned";
      skinned.castShadow = true;
      skinned.receiveShadow = true;
      skinned.frustumCulled = false;
      parent.add(skinned);
      skinnedMeshes.push(skinned);
      sourceMesh.visible = false;
      sourceMesh.userData.skinnedReplacement = skinned.name;
      skinned.normalizeSkinWeights();
    }
  }
  for (const sourceMesh of rigidMeshes) {
    const boneId = boneIndex.get(sourceMesh.userData.rigBoneName);
    if (boneId === undefined) continue;
    sourceMesh.updateWorldMatrix(true, false);
    const transform = inverseRootWorld.clone().multiply(sourceMesh.matrixWorld);
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(transform);
    const positions = geometry.getAttribute("position");
    const indices = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i += 1) {
      indices[i * 4] = boneId;
      weights[i * 4] = 1;
    }
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
    const skinned = new THREE.SkinnedMesh(geometry, sourceMesh.material);
    skinned.name = sourceMesh.name + "_Skinned";
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.frustumCulled = false;
    parent.add(skinned);
    skinnedMeshes.push(skinned);
    sourceMesh.visible = false;
    sourceMesh.userData.skinnedReplacement = skinned.name;
    skinned.normalizeSkinWeights();
  }

  // Bind the pelvis and torso shells to the central spine chain. Weights
  // are distributed vertically between adjacent bones for smooth bending.
  const bodyMeshes = [];
  parent.traverse((object) => {
    if (object.isMesh && object.userData.rigBodySegment) bodyMeshes.push(object);
  });
  for (const sourceMesh of bodyMeshes) {
    const segment = sourceMesh.userData.rigBodySegment;
    const pair = segment === "pelvis" ? ["Hips", "Spine"] : ["Spine", "Chest"];
    sourceMesh.updateMatrix();
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrix);
    const positions = geometry.getAttribute("position");
    const indices = [];
    const weights = [];
    const lower = segment === "pelvis" ? 0.78 : 1.05;
    const upper = segment === "pelvis" ? 1.20 : 1.66;
    for (let i = 0; i < positions.count; i += 1) {
      const y = positions.getY(i);
      const t = THREE.MathUtils.clamp((y - lower) / (upper - lower), 0, 1);
      indices.push(boneIndex.get(pair[0]), boneIndex.get(pair[1]), 0, 0);
      weights.push(1 - t, t, 0, 0);
    }
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
    const skinned = new THREE.SkinnedMesh(geometry, sourceMesh.material);
    skinned.name = sourceMesh.name + "_Skinned";
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.frustumCulled = false;
    parent.add(skinned);
    skinnedMeshes.push(skinned);
    sourceMesh.visible = false;
    sourceMesh.userData.skinnedReplacement = skinned.name;
    skinned.normalizeSkinWeights();
  }

  for (const sourceMesh of segments) {
    const info = sourceMesh.userData.rigSegment;
    const names = segmentBones(info.name);
    if (!names || !bones[names[0]] || !bones[names[1]]) continue;

    sourceMesh.updateMatrix();
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrix);
    const positions = geometry.getAttribute("position");
    const indices = [];
    const weights = [];
    const start = new THREE.Vector3(...info.start);
    const end = new THREE.Vector3(...info.end);
    const axis = new THREE.Vector3().subVectors(end, start);
    const lengthSquared = Math.max(axis.lengthSq(), 1e-8);

    for (let i = 0; i < positions.count; i += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i);
      const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(point, start).dot(axis) / lengthSquared, 0, 1);
      indices.push(boneIndex.get(names[0]), boneIndex.get(names[1]), 0, 0);
      weights.push(1 - t, t, 0, 0);
    }
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

    const skinned = new THREE.SkinnedMesh(geometry, sourceMesh.material);
    skinned.name = info.name + "_Skinned";
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    skinned.frustumCulled = false;
    parent.add(skinned);
    skinnedMeshes.push(skinned);
    sourceMesh.visible = false;
    sourceMesh.userData.skinnedReplacement = skinned.name;
    skinned.normalizeSkinWeights();
  }

  parent.traverse((object) => {
    if (object.isMesh && object.userData.rigJointSegment) object.visible = false;
  });

  parent.updateMatrixWorld(true);
  skeleton.calculateInverses();
  parent.traverse((object) => {
    if (object.isSkinnedMesh) object.bind(skeleton);
  });

  const helper = new THREE.SkeletonHelper(parent);
  helper.name = "Avatar_Rig_Debug";
  helper.material = new THREE.LineBasicMaterial({ color: 0x65c7ff, depthTest: true });
  helper.visible = false;
  parent.add(helper);

  const rest = {};
  for (const [name, bone] of Object.entries(bones)) rest[name] = bone.rotation.clone();
  let mode = "idle";
  const reset = () => {
    for (const [name, bone] of Object.entries(bones)) bone.rotation.copy(rest[name]);
  };

  function update(timeSeconds) {
    reset();
    const t = timeSeconds;
    const wave = Math.sin(t * 5.2);
    const slow = Math.sin(t * 2.1);

    if (mode === "walk") {
      for (const side of ["L", "R"]) {
        const sign = side === "L" ? 1 : -1;
        bones["UpperLeg_" + side].rotation.x = Math.sin(t * 6) * 0.42 * sign;
        bones["LowerLeg_" + side].rotation.x = Math.max(0, -Math.sin(t * 6) * 0.58);
        bones["UpperArm_" + side].rotation.x = -Math.sin(t * 6) * 0.28 * sign;
        bones["Forearm_" + side].rotation.x = -0.12;
      }
      bones.Spine.rotation.z = Math.sin(t * 6) * 0.035;
    } else if (mode === "sit") {
      bones.Spine.rotation.x = -0.08;
      for (const side of ["L", "R"]) {
        bones["UpperLeg_" + side].rotation.x = -1.05;
        bones["LowerLeg_" + side].rotation.x = 1.18;
        bones["UpperArm_" + side].rotation.x = -0.20;
        bones["Forearm_" + side].rotation.x = -0.55;
      }
    } else if (mode === "talk") {
      bones.Chest.rotation.x = Math.sin(t * 2.5) * 0.035;
      bones.Neck.rotation.y = Math.sin(t * 1.8) * 0.12;
      bones.Head.rotation.y = Math.sin(t * 1.8 + 0.8) * 0.10;
      bones.UpperArm_L.rotation.x = -0.45 - Math.max(0, wave) * 0.55;
      bones.Forearm_L.rotation.x = -0.35 - Math.max(0, wave) * 0.45;
      bones.UpperArm_R.rotation.x = -0.28 - Math.max(0, -wave) * 0.35;
      bones.Forearm_R.rotation.x = -0.30;
    } else if (mode === "work") {
      bones.Spine.rotation.x = 0.12;
      bones.Neck.rotation.x = 0.18;
      bones.Head.rotation.x = -0.12;
      for (const side of ["L", "R"]) {
        bones["UpperArm_" + side].rotation.x = -0.72 + slow * 0.035;
        bones["Forearm_" + side].rotation.x = -0.82 + Math.sin(t * 7 + (side === "L" ? 0 : 1)) * 0.08;
      }
    } else {
      bones.Chest.rotation.z = Math.sin(t * 1.4) * 0.012;
      bones.Head.rotation.y = Math.sin(t * 0.7) * 0.025;
    }

    // Finger articulation: subtle relaxed curl in idle, stronger curl while
    // working/talking, with a small alternating motion during walk.
    for (const side of ["L", "R"]) {
      const phase = side === "L" ? 0 : 0.35;
      const curl = mode === "work" ? 0.34 : mode === "talk" ? 0.20 : mode === "walk" ? 0.12 + Math.sin(t * 6 + phase) * 0.08 : mode === "sit" ? 0.16 : 0.10;
      for (let finger = 1; finger <= 4; finger += 1) {
        const bone = bones["Finger_" + finger + "_" + side];
        if (bone) bone.rotation.x = curl * (finger === 1 || finger === 4 ? 0.82 : 1);
      }
      const thumb = bones["Thumb_" + side];
      if (thumb) {
        thumb.rotation.x = curl * 0.55;
        thumb.rotation.z = (side === "L" ? -1 : 1) * (0.16 + curl * 0.25);
      }
    }

    parent.updateMatrixWorld(true);
    skeleton.update();
    helper.update();
  }

  return {
    bones,
    skeleton,
    helper,
    skinnedSegmentCount: skinnedMeshes.length,
    setMode(nextMode) {
      if (["idle", "walk", "sit", "talk", "work"].includes(nextMode)) mode = nextMode;
      reset();
      update(0);
    },
    setVisible(visible) { helper.visible = Boolean(visible); },
    update
  };
}
