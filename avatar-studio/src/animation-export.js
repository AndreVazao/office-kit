import * as THREE from "three";

const CLIPS = [
  { mode: "idle", duration: 3.2, name: "Idle" },
  { mode: "walk", duration: Math.PI / 3, name: "Walk" },
  { mode: "sit", duration: 1.4, name: "Sit" },
  { mode: "talk", duration: 3.5, name: "Talk" },
  { mode: "work", duration: 2.8, name: "Work" }
];

/**
 * Samples the procedural preview rig into portable glTF animation clips.
 * The preview is restored to its selected pose after sampling.
 */
export function createAvatarAnimationClips(rig, selectedMode = "idle", sampleRate = 30) {
  if (!rig?.bones || typeof rig.setMode !== "function" || typeof rig.update !== "function") {
    throw new TypeError("A valid Avatar Studio rig is required to export animation clips.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 10 || sampleRate > 60) {
    throw new RangeError("Animation sample rate must be between 10 and 60 FPS.");
  }

  const bones = Object.values(rig.bones);
  const clips = [];

  try {
    for (const definition of CLIPS) {
      rig.setMode(definition.mode);
      const frameCount = Math.ceil(definition.duration * sampleRate);
      const times = [];
      const rotations = new Map(bones.map((bone) => [bone.name, []]));
      const scales = new Map(bones.map((bone) => [bone.name, []]));

      for (let frame = 0; frame <= frameCount; frame += 1) {
        const time = Math.min(frame / sampleRate, definition.duration);
        rig.update(time);
        times.push(time);
        for (const bone of bones) {
          const rotation = bone.quaternion;
          rotations.get(bone.name).push(rotation.x, rotation.y, rotation.z, rotation.w);
          const scale = bone.scale;
          scales.get(bone.name).push(scale.x, scale.y, scale.z);
        }
      }

      const tracks = [];
      for (const bone of bones) {
        tracks.push(new THREE.QuaternionKeyframeTrack(
          bone.name + ".quaternion",
          times,
          rotations.get(bone.name)
        ));
        tracks.push(new THREE.VectorKeyframeTrack(
          bone.name + ".scale",
          times,
          scales.get(bone.name)
        ));
      }
      clips.push(new THREE.AnimationClip(definition.name, definition.duration, tracks));
    }
  } finally {
    rig.setMode(selectedMode);
    rig.update(0);
  }

  return clips;
}
