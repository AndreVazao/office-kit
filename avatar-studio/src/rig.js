import * as THREE from "three";

/**
 * Bone hierarchy and preview poses for the Avatar Studio.
 * This is a real THREE.Bone hierarchy and THREE.Skeleton, but the current
 * primitive body meshes are not yet SkinnedMesh-bound to it.
 */
export function createAvatarRig(parent) {
  const bones = {};
  const makeBone = (name, position, parentBone) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...position);
    (parentBone || parent).add(bone);
    bones[name] = bone;
    return bone;
  };

  const hips = makeBone("Hips", [0, 0.96, 0]);
  const spine = makeBone("Spine", [0, 0.12, 0], hips);
  const chest = makeBone("Chest", [0, 0.32, 0], spine);
  const neck = makeBone("Neck", [0, 0.34, 0], chest);
  makeBone("Head", [0, 0.16, 0], neck);

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "L" : "R";
    const shoulder = makeBone("Shoulder_" + suffix, [side * 0.34, 0.27, 0], chest);
    const upperArm = makeBone("UpperArm_" + suffix, [side * 0.12, -0.04, 0], shoulder);
    const forearm = makeBone("Forearm_" + suffix, [side * 0.30, -0.34, 0.015], upperArm);
    makeBone("Hand_" + suffix, [side * 0.25, -0.28, 0.02], forearm);

    const upperLeg = makeBone("UpperLeg_" + suffix, [side * 0.12, -0.12, 0], hips);
    const lowerLeg = makeBone("LowerLeg_" + suffix, [0, -0.40, 0], upperLeg);
    makeBone("Foot_" + suffix, [0, -0.38, 0.10], lowerLeg);
  }

  const orderedBones = Object.values(bones);
  const skeleton = new THREE.Skeleton(orderedBones);
  const helper = new THREE.SkeletonHelper(parent);
  helper.name = "Avatar_Rig_Debug";
  helper.material = new THREE.LineBasicMaterial({ color: 0x65c7ff, depthTest: true });
  helper.visible = false;
  parent.add(helper);

  const rest = {};
  for (const [name, bone] of Object.entries(bones)) {
    rest[name] = bone.rotation.clone();
  }

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
      for (const side of [-1, 1]) {
        const sign = side < 0 ? 1 : -1;
        bones["UpperLeg_" + (side < 0 ? "L" : "R")].rotation.x = Math.sin(t * 6) * 0.42 * sign;
        bones["LowerLeg_" + (side < 0 ? "L" : "R")].rotation.x = Math.max(0, -Math.sin(t * 6) * 0.58);
        bones["UpperArm_" + (side < 0 ? "L" : "R")].rotation.x = -Math.sin(t * 6) * 0.28 * sign;
        bones["Forearm_" + (side < 0 ? "L" : "R")].rotation.x = -0.12;
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

    skeleton.update();
    helper.update();
  }

  return {
    bones,
    skeleton,
    helper,
    setMode(nextMode) {
      if (["idle", "walk", "sit", "talk", "work"].includes(nextMode)) mode = nextMode;
      reset();
      update(0);
    },
    setVisible(visible) { helper.visible = Boolean(visible); },
    update
  };
}
