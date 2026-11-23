import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createAvatarRig } from "./rig.js";
import { createAvatarAnimationClips } from "./animation-export.js";
import { attachAvatarQualityMetadata, evaluateAvatarQuality } from "./quality-profiles.js";
import { applyAvatarQualityVariant } from "./quality-variants.js";

const $ = (id) => document.getElementById(id);
const viewport = $("viewport");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#111a2a");
scene.fog = new THREE.Fog("#111a2a", 8, 18);

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(3.4, 2.45, 6.2);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);
controls.enableDamping = true;
controls.minDistance = 2.7;
controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * 0.995; // Permit the explicit top-down inspection view.

scene.add(new THREE.HemisphereLight(0xdce9ff, 0x293347, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
keyLight.position.set(4, 7, 5);
keyLight.castShadow = true;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x8eb8ff, 1.25);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.8, 80),
  new THREE.MeshStandardMaterial({ color: "#202d42", roughness: 0.92 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.035;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(9, 36, 0x536782, 0x2e4059);
grid.position.y = -0.025;
scene.add(grid);

let character = new THREE.Group();
scene.add(character);
let currentPreset = "andre";
let avatarRig = null;
let rigStartTime = 0;

const presets = {
  andre: { title: "André · CEO", description: "Referência CEO: cabelo grisalho, barba completa e fato azul.", type: "Humano", skin: "#c98f70", hair: "silver", beard: "full", outfit: "suit", build: 1.08, shoulders: 1.06, height: 1, head: 1, faceWidth: 1.04, jawWidth: 1.05, noseSize: 1, eyeSpacing: 1, hairLength: 1.45, hairStyle: "classic", gender: "male" },
  man: { title: "Homem · médio", description: "Personagem masculino de proporções médias.", type: "Humano", skin: "#c98f70", hair: "dark", beard: "short", outfit: "casual", build: 1, shoulders: 1.08, height: 1, head: 1, faceWidth: 1, jawWidth: 1, noseSize: 1, eyeSpacing: 1, hairLength: 1, hairStyle: "short", gender: "male" },
  manSlim: { title: "Homem · magro e alto", description: "Silhueta masculina alta e esguia.", type: "Humano", skin: "#d7a783", hair: "dark", beard: "none", outfit: "casual", build: 0.78, shoulders: 0.88, height: 1.14, head: 0.98, faceWidth: 0.94, jawWidth: 0.92, noseSize: 0.95, eyeSpacing: 1, hairLength: 1.2, hairStyle: "classic", gender: "male" },
  manStocky: { title: "Homem · robusto", description: "Silhueta masculina baixa e robusta.", type: "Humano", skin: "#986348", hair: "black", beard: "full", outfit: "casual", build: 1.3, shoulders: 1.2, height: 0.9, head: 1.05, faceWidth: 1.12, jawWidth: 1.15, noseSize: 1.08, eyeSpacing: 1, hairLength: 0.9, hairStyle: "short", gender: "male" },
  woman: { title: "Mulher · média", description: "Personagem feminina de proporções médias.", type: "Humano", skin: "#d7a783", hair: "dark", beard: "none", outfit: "casual", build: 0.94, shoulders: 0.9, height: 1, head: 1, faceWidth: 0.98, jawWidth: 0.94, noseSize: 0.95, eyeSpacing: 1, hairLength: 1.8, hairStyle: "long", gender: "female" },
  womanTall: { title: "Mulher · alta", description: "Silhueta feminina alta e esguia.", type: "Humano", skin: "#f0c7a7", hair: "blond", beard: "none", outfit: "suit", build: 0.9, shoulders: 0.92, height: 1.15, head: 1, faceWidth: 0.96, jawWidth: 0.92, noseSize: 0.92, eyeSpacing: 1.02, hairLength: 2.2, hairStyle: "long", gender: "female" },
  womanCurvy: { title: "Mulher · robusta", description: "Silhueta feminina de constituição robusta.", type: "Humano", skin: "#986348", hair: "black", beard: "none", outfit: "casual", build: 1.25, shoulders: 1, height: 0.94, head: 1.03, faceWidth: 1.08, jawWidth: 1.04, noseSize: 1.05, eyeSpacing: 1, hairLength: 1.7, hairStyle: "bun", gender: "female" },
  robot: { title: "Robô humanoide", description: "Base robótica modular com placas e articulações metálicas.", type: "Robô", skin: "#9aa9bc", hair: "none", beard: "none", outfit: "tactical", build: 1.02, shoulders: 1.08, height: 1, head: 1, faceWidth: 1, jawWidth: 1, noseSize: 1, eyeSpacing: 1, hairLength: 1, hairStyle: "short", gender: "robot" }
};

const material = (color, roughness = 0.72, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function addMesh(parent, geometry, mat, position, scale = [1, 1, 1], name = "part") {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function ellipsoid(parent, mat, position, scale, name) {
  return addMesh(parent, new THREE.SphereGeometry(1, 24, 18), mat, position, scale, name);
}

function cylinder(parent, mat, position, radiusTop, radiusBottom, height, name) {
  return addMesh(parent, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20), mat, position, [1, 1, 1], name);
}

function makeLimb(parent, mat, start, end, radius, name) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = addMesh(parent, new THREE.CylinderGeometry(radius * 0.82, radius, direction.length(), 16), mat, a.clone().add(b).multiplyScalar(0.5).toArray(), [1, 1, 1], name);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.userData.rigSegment = { name, start: a.toArray(), end: b.toArray(), radius };
  // Rounded joint caps soften the primitive blockout at elbows, wrists and knees.
  const jointGeometry = new THREE.SphereGeometry(radius * 0.94, 16, 12);
  const jointStart = new THREE.Mesh(jointGeometry, mat);
  jointStart.position.copy(a);
  jointStart.castShadow = true;
  jointStart.name = name + "_Joint_A";
  jointStart.userData.rigJointSegment = name;
  parent.add(jointStart);
  const jointEnd = new THREE.Mesh(jointGeometry, mat);
  jointEnd.position.copy(b);
  jointEnd.castShadow = true;
  jointEnd.name = name + "_Joint_B";
  jointEnd.userData.rigJointSegment = name;
  parent.add(jointEnd);
  return mesh;
}

function buildHuman(config) {
  const root = new THREE.Group();
  root.name = "Avatar_Human";
  const skin = material(config.skin);
  const shirt = material(config.outfit === "suit" ? "#dce4ee" : config.outfit === "tactical" ? "#4a5c4d" : "#627f9f");
  const jacketColor = config.outfit === "suit" ? "#244b83" : config.outfit === "tactical" ? "#303e37" : "#35465d";
  const jacket = material(jacketColor);
  const trousers = material(config.outfit === "suit" ? "#202b3b" : config.outfit === "tactical" ? "#27352f" : "#303c4d");
  const shoes = material("#171d27");
  const hairColors = { silver: "#aeb5bd", dark: "#382c27", black: "#171719", blond: "#c5a46d" };
  const hair = material(hairColors[config.hair] || "#aeb5bd");
  const beard = material(config.hair === "silver" ? "#92999e" : "#4a403a");
  const eye = material("#222a35", 0.35);
  const build = Number(config.build);
  const shoulder = Number(config.shoulders);
  const headScale = Number(config.head);
  const faceWidth = Number(config.faceWidth || 1);
  const jawWidth = Number(config.jawWidth || 1);
  const noseSize = Number(config.noseSize || 1);
  const eyeSpacing = Number(config.eyeSpacing || 1);
  const hairLength = Number(config.hairLength || 1);
  const female = config.gender === "female" || currentPreset.startsWith("woman");
  const torsoWidth = (female ? 0.31 : 0.35) * build;
  const shoulderWidth = 0.43 * shoulder * build;

  // Legs and footwear
  for (const side of [-1, 1]) {
    const x = side * 0.115 * build;
    const kneeX = x * 1.04;
    makeLimb(root, trousers, [x, 0.91, 0], [kneeX, 0.53, 0.005], 0.105 * build, side < 0 ? "UpperLeg_L" : "UpperLeg_R");
    makeLimb(root, trousers, [kneeX, 0.53, 0.005], [x * 1.08, 0.16, 0], 0.082 * build, side < 0 ? "LowerLeg_L" : "LowerLeg_R");
    const shoe = ellipsoid(root, shoes, [x * 1.08, 0.105, 0.075], [0.12 * build, 0.075, 0.22], "Shoe");
    shoe.userData.rigBoneName = side < 0 ? "Foot_L" : "Foot_R";
  }

  // Torso, waist, neck
  const pelvis = ellipsoid(root, trousers, [0, 0.99, 0], [0.245 * build, 0.19, 0.15], "Pelvis");
  pelvis.userData.rigBodySegment = "pelvis";
  const torso = ellipsoid(root, jacket, [0, 1.34, 0], [torsoWidth, 0.38, 0.17], "Jacket_Torso");
  torso.userData.rigBodySegment = "torso";
  const shirtMesh = ellipsoid(root, shirt, [0, 1.39, 0.145], [0.13, 0.30, 0.045], "Shirt");
  // Let the shirt shell follow the spine-to-chest bend instead of rotating as one rigid piece.
  shirtMesh.userData.rigBodySegment = "torso";
  const neckMesh = cylinder(root, skin, [0, 1.72, 0], 0.09, 0.10, 0.16, "Neck");
  // Distribute the neck transition along its length instead of using fixed weights.
  neckMesh.userData.rigBodySegment = "neck";

  // Arms
  for (const side of [-1, 1]) {
    const shoulderX = side * shoulderWidth * 0.78;
    const elbowX = side * (shoulderWidth * 0.98);
    const handX = side * (shoulderWidth * 1.05);
    const shoulderMesh = ellipsoid(root, jacket, [shoulderX, 1.56, 0], [0.14 * shoulder, 0.15, 0.14], "Shoulder");
    shoulderMesh.userData.rigBlendBones = ["Chest", "UpperArm_" + (side < 0 ? "L" : "R")];
    makeLimb(root, jacket, [shoulderX, 1.53, 0], [elbowX, 1.18, 0.015], 0.105, "UpperArm_" + (side < 0 ? "L" : "R"));
    makeLimb(root, jacket, [elbowX, 1.18, 0.015], [handX, 0.88, 0.05], 0.078, "Forearm_" + (side < 0 ? "L" : "R"));
    const hand = new THREE.Group();
    hand.position.set(handX, 0.84, 0.055);
    root.add(hand);
    const palm = ellipsoid(hand, skin, [0, 0, 0], [0.064, 0.075, 0.045], "Palm");
    palm.userData.rigBoneName = "Hand_" + (side < 0 ? "L" : "R");
    const handSide = side < 0 ? "L" : "R";
    for (let finger = 0; finger < 4; finger += 1) {
      const fingerNumber = finger + 1;
      const offset = (finger - 1.5) * 0.027;
      const length = 0.075 - Math.abs(finger - 1.5) * 0.008;
      const fingerGroup = new THREE.Group();
      fingerGroup.position.set(offset, -0.035, 0.005);
      fingerGroup.userData.rigFingerName = "Finger_" + fingerNumber;
      fingerGroup.userData.rigHandSide = handSide;
      hand.add(fingerGroup);
      const middleY = -length * 0.42;
      const tipY = -length * 0.76;
      const proximal = makeLimb(fingerGroup, skin, [0, 0, 0], [0, middleY, 0.003], 0.012, "Finger_" + fingerNumber + "_Proximal");
      proximal.userData.rigBoneName = "Finger_" + fingerNumber + "_" + handSide;
      const middle = makeLimb(fingerGroup, skin, [0, middleY, 0.003], [0, tipY, 0.006], 0.0105, "Finger_" + fingerNumber + "_Middle");
      middle.userData.rigBoneName = "Finger_" + fingerNumber + "_Mid_" + handSide;
      const distal = makeLimb(fingerGroup, skin, [0, tipY, 0.006], [0, -length, 0.007], 0.009, "Finger_" + fingerNumber + "_Distal");
      distal.userData.rigBoneName = "Finger_" + fingerNumber + "_Tip_" + handSide;
      const fingertip = ellipsoid(fingerGroup, skin, [0, -length, 0.007], [0.012, 0.014, 0.012], "Fingertip");
      fingertip.userData.rigBoneName = "Finger_" + fingerNumber + "_Tip_" + handSide;
    }
    const thumbGroup = new THREE.Group();
    thumbGroup.position.set(side * -0.045, 0.005, 0.005);
    thumbGroup.userData.rigFingerName = "Thumb";
    thumbGroup.userData.rigHandSide = handSide;
    hand.add(thumbGroup);
    const thumbMiddle = [side * -0.018, -0.025, 0.01];
    const thumbTip = [side * -0.033, -0.047, 0.017];
    const thumbEnd = [side * -0.04, -0.06, 0.02];
    const thumbProximal = makeLimb(thumbGroup, skin, [0, 0, 0], thumbMiddle, 0.016, "Thumb_Proximal");
    thumbProximal.userData.rigBoneName = "Thumb_" + handSide;
    const thumbIntermediate = makeLimb(thumbGroup, skin, thumbMiddle, thumbTip, 0.013, "Thumb_Middle");
    thumbIntermediate.userData.rigBoneName = "Thumb_Mid_" + handSide;
    const thumbDistal = makeLimb(thumbGroup, skin, thumbTip, thumbEnd, 0.011, "Thumb_Distal");
    thumbDistal.userData.rigBoneName = "Thumb_Tip_" + handSide;
  }

  // Head, ears and facial features
  const head = new THREE.Group();
  head.position.set(0, 1.94, 0);
  head.scale.setScalar(headScale);
  head.userData.rigHeadGroup = true;
  root.add(head);
  ellipsoid(head, skin, [0, 0, 0], [0.205 * faceWidth, 0.265, 0.19], "Head");
  const jawMesh = ellipsoid(head, skin, [0, -0.155, 0.035], [0.155 * jawWidth, 0.105, 0.145], "Jaw");
  jawMesh.userData.rigBoneName = "Jaw";
  const earInner = material(female ? "#a96f61" : "#9b6657");
  const iris = material("#657b86", 0.38);
  const pupil = material("#151b24", 0.28);
  const lip = material("#754c4c");
  for (const side of [-1, 1]) {
    ellipsoid(head, skin, [side * 0.205 * faceWidth, -0.005, 0], [0.045, 0.075, 0.045], "Ear");
    ellipsoid(head, earInner, [side * 0.211 * faceWidth, -0.005, 0.034], [0.018, 0.042, 0.012], "Ear_Inner");
    const eyeX = side * 0.083 * eyeSpacing;
    ellipsoid(head, skin, [eyeX, 0.035, 0.171], [0.038, 0.026, 0.018], "Eye_Socket");
    ellipsoid(head, eye, [eyeX, 0.035, 0.188], [0.026, 0.017, 0.012], "Eye");
    ellipsoid(head, iris, [eyeX, 0.035, 0.199], [0.010, 0.011, 0.006], "Iris");
    ellipsoid(head, pupil, [eyeX, 0.035, 0.204], [0.0055, 0.007, 0.003], "Pupil");
    const eyelid = ellipsoid(head, skin, [eyeX, 0.057, 0.185], [0.036, 0.009, 0.012], "Upper_Eyelid");
    eyelid.userData.rigBoneName = "Eyelid_" + (side < 0 ? "L" : "R");
    const eyebrow = ellipsoid(head, hair, [eyeX, 0.081, 0.17], [0.046, 0.012, 0.012], "Eyebrow");
    eyebrow.userData.rigBoneName = "Brow_" + (side < 0 ? "L" : "R");
    ellipsoid(head, skin, [side * 0.118, -0.075, 0.145], [0.064, 0.055, 0.045], "Cheek");
  }
  // Nose bridge, tip and nostril wings are separate sculptable forms.
  ellipsoid(head, skin, [0, -0.018, 0.177], [0.025 * noseSize, 0.064 * noseSize, 0.027 * noseSize], "Nose_Bridge");
  ellipsoid(head, skin, [0, -0.073 * noseSize, 0.198], [0.039 * noseSize, 0.034 * noseSize, 0.035 * noseSize], "Nose_Tip");
  for (const side of [-1, 1]) {
    ellipsoid(head, skin, [side * 0.029 * noseSize, -0.087 * noseSize, 0.185], [0.018 * noseSize, 0.014 * noseSize, 0.019 * noseSize], "Nostril_Wing");
  }
  const mouth = ellipsoid(head, lip, [0, -0.145, 0.174], [0.055, 0.012, 0.014], "Mouth");
  mouth.userData.rigBoneName = "Jaw";
  const chin = ellipsoid(head, skin, [0, -0.177, 0.151], [0.065 * jawWidth, 0.033, 0.045], "Chin");
  chin.userData.rigBoneName = "Jaw";

  // Short hair cap and side sections
  if (config.hair !== "none") {
    ellipsoid(head, hair, [0, 0.19 + (hairLength - 1) * 0.045, -0.005], [0.207, 0.09 + (hairLength - 1) * 0.07, 0.19], "Hair_Cap");
    const sideLength = config.hairStyle === "long" ? 1.85 : config.hairStyle === "bun" ? 1.15 : config.hairStyle === "short" ? 0.62 : 1;
    for (const side of [-1, 1]) {
      ellipsoid(head, hair, [side * 0.175, 0.075 - (sideLength - 1) * 0.035, -0.005], [0.045, 0.12 * hairLength * sideLength, 0.17], "Hair_Side");
    }
    if (config.hairStyle === "long") {
      ellipsoid(head, hair, [0, -0.13, -0.12], [0.19, 0.23 * hairLength, 0.075], "Hair_Back");
    }
    if (config.hairStyle === "bun") {
      ellipsoid(head, hair, [0, 0.18, -0.19], [0.095, 0.105, 0.09], "Hair_Bun");
      ellipsoid(head, hair, [0, -0.005, 0.17], [0.14, 0.065, 0.045], "Hair_Front");
    }
    if (config.hairStyle === "classic") {
      ellipsoid(head, hair, [0, 0.105, 0.165], [0.13, 0.055, 0.045], "Hairline_Front");
    }
  }

  if (config.beard !== "none") {
    const beardScale = config.beard === "full" ? [0.17, 0.15, 0.095] : [0.145, 0.085, 0.075];
    ellipsoid(head, beard, [0, -0.205, 0.09], beardScale, "Beard");
    ellipsoid(head, beard, [-0.105, -0.155, 0.095], [0.075, 0.09, 0.075], "Beard_Cheek_L");
    ellipsoid(head, beard, [0.105, -0.155, 0.095], [0.075, 0.09, 0.075], "Beard_Cheek_R");
    ellipsoid(head, beard, [0, -0.105, 0.155], [0.15, 0.055, 0.055], "Mustache");
  }

  // Simple lapels and tie for the CEO suit
  if (config.outfit === "suit") {
    const lapel = material("#355f97");
    const left = addMesh(root, new THREE.BoxGeometry(0.09, 0.29, 0.025), lapel, [-0.075, 1.48, 0.178], [1, 1, 1], "Lapel_L");
    const right = addMesh(root, new THREE.BoxGeometry(0.09, 0.29, 0.025), lapel, [0.075, 1.48, 0.178], [1, 1, 1], "Lapel_R");
    left.rotation.z = -0.22;
    right.rotation.z = 0.22;
    left.userData.rigBoneName = "Chest";
    right.userData.rigBoneName = "Chest";
    const tie = cylinder(root, material("#9a3038"), [0, 1.38, 0.19], 0.018, 0.012, 0.27, "Tie");
    tie.userData.rigBoneName = "Chest";
    const buttonMetal = material("#b7c3d3", 0.35, 0.55);
    for (const y of [1.31, 1.19]) {
      const button = ellipsoid(root, buttonMetal, [0.105, y, 0.176], [0.012, 0.012, 0.008], "Jacket_Button");
      button.userData.rigBoneName = "Chest";
    }
    const pocket = material("#dce4ee");
    const pocketSquare = addMesh(root, new THREE.BoxGeometry(0.075, 0.012, 0.012), pocket, [0.225, 1.48, 0.145], [1, 1, 1], "Pocket_Square");
    pocketSquare.userData.rigBoneName = "Chest";
  }

  root.scale.y = Number(config.height);
  return root;
}

function buildRobot(config) {
  const root = new THREE.Group();
  root.name = "Avatar_Robot";
  const alloy = material("#9caec2", 0.32, 0.78);
  const dark = material("#29384a", 0.4, 0.7);
  const accent = material("#3678d8", 0.3, 0.55);
  const build = Number(config.build);
  const shoulder = Number(config.shoulders);
  const headScale = Number(config.head);

  for (const side of [-1, 1]) {
    const x = side * 0.13 * build;
    makeLimb(root, dark, [x, 0.95, 0], [x, 0.55, 0.005], 0.105 * build, side < 0 ? "UpperLeg_L" : "UpperLeg_R");
    makeLimb(root, dark, [x, 0.55, 0.005], [x, 0.18, 0], 0.082 * build, side < 0 ? "LowerLeg_L" : "LowerLeg_R");
    const metalFoot = ellipsoid(root, alloy, [x, 0.1, 0.05], [0.13, 0.075, 0.21], "Metal_Foot");
    metalFoot.userData.rigBoneName = side < 0 ? "Foot_L" : "Foot_R";
    const sx = side * 0.39 * shoulder * build;
    makeLimb(root, alloy, [sx * 0.82, 1.55, 0], [sx, 1.17, 0], 0.105, "UpperArm_" + (side < 0 ? "L" : "R"));
    makeLimb(root, dark, [sx, 1.17, 0], [sx * 1.1, 0.88, 0.04], 0.075, "Forearm_" + (side < 0 ? "L" : "R"));
    const manipulator = ellipsoid(root, alloy, [sx * 1.1, 0.84, 0.04], [0.09, 0.1, 0.08], "Manipulator");
    manipulator.userData.rigBoneName = "Hand_" + (side < 0 ? "L" : "R");
    const shoulderJoint = ellipsoid(root, accent, [sx * 0.82, 1.55, 0], [0.14, 0.14, 0.14], "Shoulder_Joint");
    shoulderJoint.userData.rigBlendBones = ["Chest", "UpperArm_" + (side < 0 ? "L" : "R")];
    const elbowJoint = ellipsoid(root, accent, [sx, 1.17, 0.015], [0.09, 0.09, 0.09], "Elbow_Joint");
    elbowJoint.userData.rigBoneName = "Forearm_" + (side < 0 ? "L" : "R");
    const wristJoint = ellipsoid(root, dark, [sx * 1.1, 0.88, 0.04], [0.055, 0.055, 0.055], "Wrist_Joint");
    wristJoint.userData.rigBoneName = "Hand_" + (side < 0 ? "L" : "R");
  }
  const hipCore = ellipsoid(root, dark, [0, 1.0, 0], [0.25 * build, 0.19, 0.16], "Hip_Core");
  hipCore.userData.rigBodySegment = "pelvis";
  const chestArmor = ellipsoid(root, alloy, [0, 1.35, 0], [0.34 * build, 0.36, 0.19], "Chest_Armor");
  chestArmor.userData.rigBodySegment = "torso";
  ellipsoid(root, accent, [0, 1.38, 0.195], [0.09, 0.09, 0.025], "Power_Core");
  cylinder(root, dark, [0, 1.74, 0], 0.1, 0.1, 0.14, "Neck_Joint");
  const head = new THREE.Group();
  head.position.y = 1.96;
  head.scale.setScalar(headScale);
  head.userData.rigHeadGroup = true;
  root.add(head);
  ellipsoid(head, alloy, [0, 0, 0], [0.22, 0.25, 0.19], "Robot_Head");
  ellipsoid(head, dark, [0, 0.005, 0.18], [0.17, 0.075, 0.045], "Face_Plate");
  for (const side of [-1, 1]) {
    ellipsoid(head, accent, [side * 0.075, 0.01, 0.22], [0.035, 0.018, 0.012], "Optic");
    ellipsoid(head, dark, [side * 0.22, 0, 0], [0.05, 0.09, 0.06], "Audio_Module");
  }
  root.scale.y = Number(config.height);
  return root;
}

function readConfig() {
  return {
    preset: $("preset").value,
    outfit: $("outfit").value,
    height: $("height").value,
    build: $("build").value,
    head: $("head").value,
    shoulders: $("shoulders").value,
    skin: $("skin").value,
    hair: $("hair").value,
    beard: $("beard").value,
    faceWidth: $("face-width").value,
    jawWidth: $("jaw-width").value,
    noseSize: $("nose-size").value,
    eyeSpacing: $("eye-spacing").value,
    hairLength: $("hair-length").value,
    hairStyle: $("hair-style").value,
    gender: presets[$("preset").value].gender
  };
}

function renderCharacter() {
  const config = readConfig();
  currentPreset = config.preset;
  scene.remove(character);
  const geometries = new Set();
  const materials = new Set();
  character.traverse((item) => {
    if (item.geometry) geometries.add(item.geometry);
    if (item.material) {
      for (const mat of Array.isArray(item.material) ? item.material : [item.material]) {
        materials.add(mat);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((mat) => mat.dispose());
  character = config.preset === "robot" ? buildRobot(config) : buildHuman(config);
  scene.add(character);
  avatarRig = createAvatarRig(character);
  const qualityMetrics = attachAvatarQualityMetadata(character, "avatar-studio");
  const qualityFits = evaluateAvatarQuality(qualityMetrics);
  $("quality-triangles").textContent = qualityMetrics.triangles.toLocaleString("pt-PT");
  $("quality-materials").textContent = qualityMetrics.materialCount.toLocaleString("pt-PT");
  $("quality-meshes").textContent = qualityMetrics.visibleMeshes.toLocaleString("pt-PT");
  $("quality-profiles").innerHTML = qualityFits.map((profile) => {
    const status = profile.fits ? "Dentro do orçamento" : "Excede orçamento";
    const ratio = Math.max(profile.triangleRatio, profile.materialRatio);
    return `<div class="quality-profile ${profile.fits ? "fits" : "exceeds"}"><span>${profile.label}</span><strong>${status}</strong><small>${Math.round(ratio * 100)}% do limite mais restritivo</small></div>`;
  }).join("");
  avatarRig.setMode($("pose-mode")?.value || "idle");
  avatarRig.setVisible(Boolean($("show-rig")?.checked));

  const preset = presets[config.preset];
  $("model-title").textContent = preset.title;
  $("model-description").textContent = preset.description;
  $("stat-type").textContent = preset.type;
  $("stat-height").textContent = Number(config.height).toFixed(2) + "×";
  $("character-name").textContent = config.preset === "andre" ? "ANDRÉ / CEO MASTER" : preset.title.toUpperCase();
  for (const key of ["height", "build", "head", "shoulders", "face-width", "jaw-width", "nose-size", "eye-spacing", "hair-length"]) {
    $(key + "-value").textContent = Number(config[key]).toFixed(2).replace(".", ",");
  }
}

function applyPreset() {
  const preset = presets[$("preset").value];
  for (const key of ["skin", "hair", "hair-style", "beard", "outfit", "build", "shoulders", "height", "head", "face-width", "jaw-width", "nose-size", "eye-spacing", "hair-length"]) {
    const configKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (preset[configKey] !== undefined) $(key).value = preset[configKey];
  }
  renderCharacter();
}

$("preset").addEventListener("change", applyPreset);

const cameraViews = {
  front: { position: [0, 2.1, 6.4], target: [0, 1.05, 0] },
  threeQuarter: { position: [3.4, 2.45, 6.2], target: [0, 1.05, 0] },
  left: { position: [-6.2, 2.1, 0], target: [0, 1.05, 0] },
  right: { position: [6.2, 2.1, 0], target: [0, 1.05, 0] },
  back: { position: [0, 2.1, -6.4], target: [0, 1.05, 0] },
  top: { position: [0, 7.5, 0.01], target: [0, 1.05, 0] }
};
const poseMode = $("pose-mode");
if (poseMode) poseMode.addEventListener("change", () => {
  rigStartTime = performance.now() / 1000;
  avatarRig?.setMode(poseMode.value);
});
const showRig = $("show-rig");
if (showRig) showRig.addEventListener("change", () => avatarRig?.setVisible(showRig.checked));

for (const [id, view] of Object.entries(cameraViews)) {
  const button = $("view-" + id);
  if (!button) continue;
  button.addEventListener("click", () => {
    camera.up.set(0, 1, 0);
    if (id === "top") camera.up.set(0, 0, -1);
    camera.position.set(...view.position);
    controls.target.set(...view.target);
    controls.update();
  });
}
for (const id of ["outfit", "height", "build", "head", "shoulders", "skin", "hair", "hair-style", "beard", "face-width", "jaw-width", "nose-size", "eye-spacing", "hair-length"]) {
  $(id).addEventListener("input", renderCharacter);
  $(id).addEventListener("change", renderCharacter);
}

$("export-glb").addEventListener("click", () => {
  const button = $("export-glb");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "A preparar…";

  const restoreButton = () => {
    button.disabled = false;
    button.textContent = originalLabel;
  };

  let qualityVariant = null;
  try {
    const exportCharacter = character;
    const exportPreset = currentPreset;
    const exportRig = avatarRig;
    const exportPose = poseMode?.value || "idle";
    const selectedQuality = $("export-quality")?.value || "high";
    qualityVariant = applyAvatarQualityVariant(exportCharacter, selectedQuality);
    if (!qualityVariant.withinTriangleBudget) {
      throw new Error("O perfil " + selectedQuality + " não atingiu o orçamento de " + qualityVariant.triangleBudget + " triângulos (resultado: " + qualityVariant.optimizedTriangles + "). Exportação bloqueada para evitar um ficheiro fora das especificações.");
    }
    exportCharacter.userData.officeKitAvatar = exportCharacter.userData.officeKitAvatar || {};
    exportCharacter.userData.officeKitAvatar.exportedVariant = {
      id: qualityVariant.profileId,
      sourceTriangles: qualityVariant.sourceTriangles,
      optimizedTriangles: qualityVariant.optimizedTriangles,
      optimizedVertices: qualityVariant.optimizedVertices,
      triangleBudget: qualityVariant.triangleBudget,
      withinTriangleBudget: qualityVariant.withinTriangleBudget,
      validation: qualityVariant.validation,
      simplification: "skinning-aware-vertex-clustering"
    };
    const exporter = new GLTFExporter();
    const animations = createAvatarAnimationClips(exportRig, exportPose);
    button.textContent = "A otimizar e exportar…";
    exporter.parse(exportCharacter, (result) => {
      try {
        qualityVariant?.restore();
        qualityVariant = null;
        const blob = new Blob([result], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "office-kit-avatar-" + exportPreset + "-" + selectedQuality + ".glb";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1500);
        const withinBudget = result && exportCharacter.userData.officeKitAvatar.exportedVariant.withinTriangleBudget;
        if (!withinBudget) {
          alert("O GLB foi exportado, mas a geometria ainda excede o orçamento de triângulos deste perfil. Consulte a auditoria antes de o distribuir.");
        }
      } catch (error) {
        console.error("GLB download preparation failed", error);
        alert("O modelo foi gerado, mas não foi possível preparar a transferência do ficheiro.");
      } finally {
        qualityVariant?.restore();
        qualityVariant = null;
        restoreButton();
      }
    }, (error) => {
      console.error("GLB export failed", error);
      qualityVariant?.restore();
      qualityVariant = null;
      restoreButton();
      alert("Não foi possível exportar o modelo GLB. Consulte a consola do navegador.");
    }, { binary: true, onlyVisible: true, animations });
  } catch (error) {
    console.error("GLB export setup failed", error);
    qualityVariant?.restore();
    qualityVariant = null;
    restoreButton();
    alert(error instanceof Error ? error.message : "Não foi possível preparar a exportação GLB. Consulte a consola do navegador.");
  }
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(viewport);
resize();
applyPreset();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  avatarRig?.update(performance.now() / 1000 - rigStartTime);
  renderer.render(scene, camera);
}
animate();
