import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createAvatarRig } from "./rig.js";
import { createAvatarAnimationClips } from "./animation-export.js";
import { attachAvatarQualityMetadata, evaluateAvatarQuality } from "./quality-profiles.js";
import { applyAvatarMaterialVariant, applyAvatarQualityVariant } from "./quality-variants.js";

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
  andre: { title: "André · CEO", description: "Perfil de identidade baseado na fotografia: cabelo grisalho curto e cheio, laterais aparadas, barba longa grisalha e rosto largo.", type: "Humano", skin: "#bd8d78", hair: "silver", beard: "full", outfit: "suit", build: 1.08, shoulders: 1.06, height: 1, head: 1.02, faceWidth: 1.08, jawWidth: 1.08, noseSize: 1.12, eyeSpacing: 1, hairLength: 0.9, hairStyle: "short", gender: "male" },
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

function makePhotoShapedHead(parent, skinMaterial, faceWidth = 1, jawWidth = 1) {
  const geometry = new THREE.SphereGeometry(1, 56, 40);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const lowerFace = THREE.MathUtils.smoothstep(-y, 0.02, 0.92);
    const jawProfile = THREE.MathUtils.lerp(1, jawWidth, lowerFace);
    const cheekBulge = 0.035 * Math.exp(-Math.pow((y + 0.12) / 0.22, 2));
    const templeTaper = THREE.MathUtils.lerp(1, 0.93, THREE.MathUtils.smoothstep(y, 0.48, 0.96));
    const widthProfile = jawProfile * templeTaper;
    // The front plane gains cheek projection while the rear cranium retains volume.
    const frontness = Math.max(0, z);
    const cheekDepth = cheekBulge * Math.exp(-Math.pow((Math.abs(x) - 0.58) / 0.32, 2));
    const depthProfile = 1 + 0.075 * Math.exp(-Math.pow((y + 0.10) / 0.38, 2)) + cheekDepth;
    const sculptedZ = z * 0.194 * depthProfile + frontness * cheekDepth * 0.22;
    position.setXYZ(
      index,
      x * (0.205 * faceWidth + cheekBulge) * widthProfile,
      y * 0.267,
      sculptedZ
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, skinMaterial);
  mesh.name = "Photo_Profile_Head";
  mesh.userData.identityFeature = "sculpted-head-silhouette";
  parent.add(mesh);
  return mesh;
}

function makePhotoEar(parent, skinMaterial, innerMaterial, side, faceWidth) {
  const suffix = side < 0 ? "L" : "R";
  const centerX = side * 0.205 * faceWidth;
  const outer = ellipsoid(
    parent, skinMaterial, [centerX, -0.005, 0],
    [0.043, 0.073, 0.038], "Ear_" + suffix
  );
  outer.userData.identityFeature = "outer-ear-volume";

  const concha = ellipsoid(
    parent, innerMaterial, [centerX + side * 0.006, -0.006, 0.033],
    [0.016, 0.039, 0.009], "Ear_Concha_" + suffix
  );
  concha.userData.identityFeature = "ear-concha";

  const makeFold = (name, points, radius, material) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(side * x + centerX, y, z))
    );
    const fold = addMesh(
      parent, new THREE.TubeGeometry(curve, 24, radius, 7, false),
      material, [0, 0, 0], [1, 1, 1], name + "_" + suffix
    );
    fold.userData.identityFeature = name.toLowerCase().replaceAll("_", "-");
    return fold;
  };

  // Outer helix and inner antihelix provide readable ear structure in profile.
  makeFold("Ear_Helix", [
    [0.004, 0.052, 0.037], [0.025, 0.043, 0.041],
    [0.031, 0.012, 0.044], [0.025, -0.036, 0.041],
    [0.008, -0.055, 0.037], [-0.006, -0.035, 0.04]
  ], 0.006, skinMaterial);
  makeFold("Ear_Antihelix", [
    [-0.006, 0.032, 0.045], [0.012, 0.021, 0.047],
    [0.014, -0.004, 0.048], [0.004, -0.027, 0.046]
  ], 0.0045, skinMaterial);

  const tragus = ellipsoid(
    parent, skinMaterial, [centerX - side * 0.012, -0.023, 0.043],
    [0.012, 0.018, 0.012], "Ear_Tragus_" + suffix
  );
  tragus.userData.identityFeature = "ear-tragus";
}

function makeShortGreyHairCap(parent, hairMaterial, length = 1) {
  // A compact, full crown matching the short grey haircut in the identity reference.
  // The swept surface follows the skull instead of using a round helmet-like cap.
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const crownLift = Math.max(0, y);
    position.setXYZ(
      index,
      x * 0.205 * (1 - 0.035 * crownLift),
      y * 0.066 * length,
      z * 0.166 + crownLift * 0.014
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const cap = addMesh(
    parent, geometry, hairMaterial,
    [0, 0.218, -0.008], [1, 1, 1], "Short_Grey_Hair_Crown"
  );
  cap.userData.identityFeature = "short-grey-hair-crown";

  // Fine swept ridges add restrained texture without turning the haircut into spikes.
  for (let index = 0; index < 7; index += 1) {
    const startX = -0.126 + index * 0.042;
    const drift = index < 3 ? 0.012 : index > 4 ? -0.012 : 0.004;
    const points = [
      [startX, 0.226, 0.105 - Math.abs(startX) * 0.12],
      [startX + drift * 0.45, 0.267, 0.045],
      [startX + drift, 0.278, -0.035],
      [startX + drift * 1.25, 0.251, -0.112]
    ];
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
    );
    const strand = addMesh(
      parent, new THREE.TubeGeometry(curve, 18, 0.0032, 5, false),
      hairMaterial, [0, 0, 0], [1, 1, 1],
      "Short_Grey_Crown_Strand_" + index
    );
    strand.userData.identityFeature = "short-grey-crown-strand";
  }
  return cap;
}

function makeShortGreySideHair(parent, hairMaterial, side) {
  // Low-profile side growth follows the temple toward the rear skull.
  // Crown coverage is supplied separately by the short-hair cap geometry.
  const paths = [
    [[side * 0.184, 0.135, 0.035], [side * 0.196, 0.095, -0.015], [side * 0.197, 0.035, -0.075], [side * 0.188, -0.045, -0.125], [side * 0.16, -0.115, -0.12]],
    [[side * 0.19, 0.12, 0.055], [side * 0.201, 0.075, 0.005], [side * 0.201, 0.015, -0.055], [side * 0.191, -0.065, -0.105], [side * 0.165, -0.13, -0.105]],
    [[side * 0.18, 0.105, 0.075], [side * 0.193, 0.06, 0.025], [side * 0.194, 0.0, -0.035], [side * 0.184, -0.075, -0.085], [side * 0.155, -0.14, -0.085]]
  ];
  paths.forEach((points, index) => {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
    const strand = addMesh(
      parent,
      new THREE.TubeGeometry(curve, 20, index === 1 ? 0.009 : 0.007,
        6, false),
      hairMaterial,
      [0, 0, 0],
      [1, 1, 1],
      side < 0 ? "Grey_Side_Hair_L_" + index : "Grey_Side_Hair_R_" + index
    );
    strand.userData.identityFeature = "short-grey-side-hair";
  });
}

function makePhotoBrow(parent, hairMaterial, side, eyeX) {
  // A shallow, asymmetric arch follows the orbital rim instead of reading as a flat oval.
  const points = [
    [eyeX - side * 0.046, 0.083, 0.169],
    [eyeX - side * 0.021, 0.094, 0.177],
    [eyeX + side * 0.012, 0.096, 0.176],
    [eyeX + side * 0.043, 0.082, 0.165]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(points);
  const brow = addMesh(
    parent,
    new THREE.TubeGeometry(curve, 20, 0.0065, 7, false),
    hairMaterial,
    [0, 0, 0],
    [1, 1, 1],
    side < 0 ? "Eyebrow_L" : "Eyebrow_R"
  );
  brow.userData.rigBoneName = "Brow_" + (side < 0 ? "L" : "R");
  brow.userData.identityFeature = "arched-eyebrow";
  return brow;
}

function makePhotoUpperEyelid(parent, skinMaterial, side, eyeX) {
  const points = [
    [eyeX - side * 0.034, 0.035, 0.184],
    [eyeX - side * 0.017, 0.050, 0.194],
    [eyeX + side * 0.012, 0.052, 0.194],
    [eyeX + side * 0.034, 0.035, 0.184]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(points);
  const lid = addMesh(
    parent,
    new THREE.TubeGeometry(curve, 18, 0.0042, 6, false),
    skinMaterial,
    [0, 0, 0],
    [1, 1, 1],
    side < 0 ? "Upper_Eyelid_L" : "Upper_Eyelid_R"
  );
  lid.userData.rigBoneName = "Eyelid_" + (side < 0 ? "L" : "R");
  lid.userData.identityFeature = "upper-eyelid-contour";
  return lid;
}

function makePhotoLowerEyelid(parent, skinMaterial, side, eyeX) {
  const points = [
    [eyeX - side * 0.031, 0.027, 0.184],
    [eyeX - side * 0.012, 0.018, 0.193],
    [eyeX + side * 0.012, 0.018, 0.193],
    [eyeX + side * 0.031, 0.027, 0.184]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(points);
  const lid = addMesh(
    parent,
    new THREE.TubeGeometry(curve, 16, 0.0032, 6, false),
    skinMaterial,
    [0, 0, 0],
    [1, 1, 1],
    side < 0 ? "Lower_Eyelid_L" : "Lower_Eyelid_R"
  );
  lid.userData.rigBoneName = "Eyelid_" + (side < 0 ? "L" : "R");
  lid.userData.identityFeature = "lower-eyelid-contour";
  return lid;
}

function makePhotoNose(parent, skinMaterial, size = 1) {
  // A tapered bridge with a broader, forward-projecting tip; the separate alar forms
  // preserve a readable silhouette in front and three-quarter views.
  const bridgeGeometry = new THREE.SphereGeometry(1, 32, 24);
  const bridgePositions = bridgeGeometry.getAttribute("position");
  for (let i = 0; i < bridgePositions.count; i += 1) {
    const x = bridgePositions.getX(i);
    const y = bridgePositions.getY(i);
    const z = bridgePositions.getZ(i);
    const taper = THREE.MathUtils.lerp(0.68, 1.0, THREE.MathUtils.smoothstep(y, -0.65, 0.8));
    bridgePositions.setXYZ(i, x * 0.027 * size * taper, y * 0.067 * size, z * 0.032 * size);
  }
  bridgePositions.needsUpdate = true;
  bridgeGeometry.computeVertexNormals();
  const bridge = addMesh(parent, bridgeGeometry, skinMaterial, [0, -0.018, 0.184], [1, 1, 1], "Nose_Bridge_Sculpted");
  bridge.userData.identityFeature = "tapered-nasal-bridge";

  const tipGeometry = new THREE.SphereGeometry(1, 32, 24);
  const tipPositions = tipGeometry.getAttribute("position");
  for (let i = 0; i < tipPositions.count; i += 1) {
    const x = tipPositions.getX(i);
    const y = tipPositions.getY(i);
    const z = tipPositions.getZ(i);
    const lowerFullness = 1 + 0.12 * Math.max(0, -y);
    tipPositions.setXYZ(i, x * 0.044 * size * lowerFullness, y * 0.034 * size, z * 0.041 * size);
  }
  tipPositions.needsUpdate = true;
  tipGeometry.computeVertexNormals();
  const tip = addMesh(parent, tipGeometry, skinMaterial, [0, -0.073 * size, 0.204], [1, 1, 1], "Nose_Tip_Sculpted");
  tip.userData.identityFeature = "rounded-nasal-tip";

  const wingMaterial = skinMaterial;
  for (const side of [-1, 1]) {
    const wing = ellipsoid(parent, wingMaterial, [side * 0.031 * size, -0.086 * size, 0.188], [0.019 * size, 0.014 * size, 0.022 * size], "Nasal_Wing");
    wing.userData.identityFeature = "nasal-alar-wing";
  }
  return { bridge, tip };
}

function makePhotoBeard(parent, beardMaterial, length = 1, width = 1) {
  // Sculpted volume sits under the silhouette so the beard reads in profile,
  // not as a thin extruded card. The lower contour narrows into a soft chin point.
  const makeMass = (name, center, scale, side = 0) => {
    const geometry = new THREE.SphereGeometry(1, 40, 32);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const lowerTaper = THREE.MathUtils.smoothstep(-y, 0.12, 0.96);
      const cheekFullness = 1 + 0.13 * Math.exp(-Math.pow((y + 0.08) / 0.42, 2));
      const taper = THREE.MathUtils.lerp(1, 0.48, lowerTaper);
      const sideSweep = side === 0 ? 1 : 1 - 0.12 * Math.max(0, -y);
      positions.setXYZ(
        i,
        x * scale[0] * cheekFullness * taper * sideSweep,
        y * scale[1],
        z * scale[2] * (1 + 0.16 * Math.max(0, z))
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const mesh = addMesh(parent, geometry, beardMaterial, center, [1, 1, 1], name);
    mesh.userData.identityFeature = "volumetric-beard-mass";
    return mesh;
  };

  // Two cheek/jaw lobes merge into a deeper central chin mass; all overlap
  // deliberately to avoid visible seams at front and three-quarter angles.
  // Keep the central upper-lip opening clear; the chin mass starts below it.
  makeMass("Beard_Volume_Central", [0, -0.335 * length, 0.105], [0.16 * width, 0.15 * length, 0.072], 0);
  for (const side of [-1, 1]) {
    makeMass(
      side < 0 ? "Beard_Volume_Cheek_L" : "Beard_Volume_Cheek_R",
      [side * 0.105 * width, -0.165 * length, 0.105],
      [0.085 * width, 0.12 * length, 0.068],
      side
    );
    makeMass(
      side < 0 ? "Beard_Volume_Jaw_L" : "Beard_Volume_Jaw_R",
      [side * 0.083 * width, -0.305 * length, 0.095],
      [0.09 * width, 0.13 * length, 0.072],
      side
    );
  }

  const shape = new THREE.Shape();
  shape.moveTo(-0.174 * width, -0.055);
  shape.bezierCurveTo(-0.205 * width, -0.105, -0.198 * width, -0.235 * length, -0.145 * width, -0.315 * length);
  shape.bezierCurveTo(-0.105 * width, -0.385 * length, -0.052 * width, -0.435 * length, 0, -0.448 * length);
  shape.bezierCurveTo(0.052 * width, -0.435 * length, 0.105 * width, -0.385 * length, 0.145 * width, -0.315 * length);
  shape.bezierCurveTo(0.198 * width, -0.235 * length, 0.205 * width, -0.105, 0.174 * width, -0.055);
  shape.bezierCurveTo(0.12 * width, -0.095, 0.075 * width, -0.16, 0, -0.185);
  shape.bezierCurveTo(-0.075 * width, -0.16, -0.12 * width, -0.095, -0.174 * width, -0.055);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.048, bevelEnabled: true, bevelSegments: 4,
    steps: 1, bevelSize: 0.016, bevelThickness: 0.022, curveSegments: 24
  });
  const beardMesh = addMesh(parent, geometry, beardMaterial, [0, 0, 0.145], [1, 1, 1], "Photo_Profile_Beard");
  beardMesh.userData.identityFeature = "long-tapered-grey-beard-silhouette";
  return beardMesh;
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
  const beard = material(config.beardColor || (config.hair === "silver" ? "#92999e" : "#4a403a"));
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
  makePhotoShapedHead(head, skin, faceWidth, jawWidth);
  const earInner = material(female ? "#a96f61" : "#9b6657");
  const iris = material("#59483d", 0.38);
  const pupil = material("#151b24", 0.28);
  const lip = material("#754c4c");
  for (const side of [-1, 1]) {
    makePhotoEar(head, skin, earInner, side, faceWidth);
    const eyeX = side * 0.083 * eyeSpacing;
    ellipsoid(head, skin, [eyeX, 0.035, 0.171], [0.039, 0.021, 0.018], "Eye_Socket");
    ellipsoid(head, eye, [eyeX, 0.035, 0.188], [0.027, 0.0135, 0.012], "Eye");
    ellipsoid(head, iris, [eyeX, 0.035, 0.199], [0.0105, 0.0095, 0.006], "Iris");
    ellipsoid(head, pupil, [eyeX, 0.035, 0.204], [0.0055, 0.007, 0.003], "Pupil");
    makePhotoUpperEyelid(head, skin, side, eyeX);
    makePhotoBrow(head, hair, side, eyeX);
    makePhotoLowerEyelid(head, skin, side, eyeX);
    ellipsoid(head, skin, [side * 0.118, -0.075, 0.145], [0.064, 0.055, 0.045], "Cheek");
  }
  // Sculpted nose components preserve a tapered bridge and rounded tip in profile.
  makePhotoNose(head, skin, noseSize);
  // The mouth sits in the beard's central opening instead of being buried behind it.
  const mouth = ellipsoid(head, lip, [0, -0.157, 0.205], [0.047, 0.008, 0.009], "Mouth");
  mouth.userData.rigBoneName = "Jaw";
  const lowerLip = ellipsoid(head, skin, [0, -0.174, 0.193], [0.036, 0.009, 0.012], "Lower_Lip");
  lowerLip.userData.rigBoneName = "Jaw";
  const chin = ellipsoid(head, skin, [0, -0.205, 0.151], [0.065 * jawWidth, 0.033, 0.045], "Chin");
  chin.userData.rigBoneName = "Jaw";

  // Short full grey haircut from the reference, with a compact crown and close sides.
  if (config.hair !== "none") {
    if (config.hairStyle === "short") {
      makeShortGreyHairCap(head, hair, hairLength);
    } else if (config.hairStyle !== "bald") {
      ellipsoid(head, hair, [0, 0.19 + (hairLength - 1) * 0.045, -0.005], [0.207, 0.09 + (hairLength - 1) * 0.07, 0.19], "Hair_Cap");
    }
    const sideLength = config.hairStyle === "long" ? 1.85 : config.hairStyle === "bun" ? 1.15 : config.hairStyle === "short" ? 0.62 : config.hairStyle === "bald" ? 0.48 : 1;
    for (const side of [-1, 1]) {
      const closeCrop = config.hairStyle === "bald" || config.hairStyle === "short";
      const templeScale = closeCrop
        ? [0.026, config.hairStyle === "bald" ? 0.066 : 0.082, 0.105]
        : [0.045, 0.12 * hairLength * sideLength, 0.17];
      const templePosition = closeCrop
        ? [side * 0.18, 0.072, -0.008]
        : [side * 0.175, 0.075 - (sideLength - 1) * 0.035, -0.005];
      const temple = ellipsoid(
        head, hair, templePosition, templeScale,
        config.hairStyle === "bald" ? "Short_Side_Hair" : "Hair_Side"
      );
      if (closeCrop) {
        temple.userData.identityFeature = "short-grey-temple-hair";
        makeShortGreySideHair(head, hair, side);
      }
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
    if (config.beard === "full" && config.preset === "andre") {
      makePhotoBeard(head, beard, 1.12, 1.08);
      ellipsoid(head, beard, [-0.128, -0.145, 0.105], [0.067, 0.105, 0.075], "Beard_Cheek_L");
      ellipsoid(head, beard, [0.128, -0.145, 0.105], [0.067, 0.105, 0.075], "Beard_Cheek_R");
      const mustacheLeft = ellipsoid(head, beard, [-0.047, -0.108, 0.192], [0.078, 0.024, 0.026], "Mustache_L");
      const mustacheRight = ellipsoid(head, beard, [0.047, -0.108, 0.192], [0.078, 0.024, 0.026], "Mustache_R");
      mustacheLeft.rotation.z = -0.10;
      mustacheRight.rotation.z = 0.10;
      mustacheLeft.userData.identityFeature = "upper-lip-beard-lobe";
      mustacheRight.userData.identityFeature = "upper-lip-beard-lobe";
    } else {
      const beardScale = config.beard === "full" ? [0.17, 0.15, 0.095] : [0.145, 0.085, 0.075];
      ellipsoid(head, beard, [0, -0.205, 0.09], beardScale, "Beard");
      ellipsoid(head, beard, [-0.105, -0.155, 0.095], [0.075, 0.09, 0.075], "Beard_Cheek_L");
      ellipsoid(head, beard, [0.105, -0.155, 0.095], [0.075, 0.09, 0.075], "Beard_Cheek_R");
      ellipsoid(head, beard, [0, -0.105, 0.155], [0.15, 0.055, 0.055], "Mustache");
    }
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
    beardColor: $("preset").value === "andre" ? $("beard-color").value : ($("hair").value === "silver" ? "#92999e" : "#4a403a"),
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
    const status = profile.fits ? "Fonte compatível" : "Requer otimização";
    const ratio = Math.max(profile.triangleRatio, profile.materialRatio);
    const details = [
      profile.triangleRatio > 1 ? "geometria" : "",
      profile.materialRatio > 1 ? "materiais" : ""
    ].filter(Boolean).join(" + ") || "limites da fonte";
    return `<div class="quality-profile ${profile.fits ? "fits" : "exceeds"}"><span>${profile.label}</span><strong>${status}</strong><small>${Math.round(ratio * 100)}% do limite mais restritivo · ${details}</small></div>`;
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

window.addEventListener("avatar:identity-measurements", (event) => {
  if (currentPreset === "robot") return;
  const measurements = event.detail || {};
  const controls = {
    "face-width": measurements.faceWidth,
    "jaw-width": measurements.jawWidth,
    "nose-size": measurements.noseSize,
    "eye-spacing": measurements.eyeSpacing
  };
  for (const [id, value] of Object.entries(controls)) {
    const input = $(id);
    if (!input || !Number.isFinite(value)) continue;
    input.value = String(THREE.MathUtils.clamp(value, Number(input.min), Number(input.max)));
  }
  if (currentPreset === "andre") {
    if (typeof measurements.skinColor === "string" && /^#[0-9a-f]{6}$/i.test(measurements.skinColor)) {
      const skin = $("skin");
      let option = [...skin.options].find((item) => item.value.toLowerCase() === measurements.skinColor.toLowerCase());
      if (!option) {
        option = new Option("Tom da fotografia", measurements.skinColor);
        skin.add(option);
      }
      skin.value = measurements.skinColor;
    }
    if (typeof measurements.beardColor === "string" && /^#[0-9a-f]{6}$/i.test(measurements.beardColor)) {
      $("beard-color").value = measurements.beardColor;
    }
  }
  renderCharacter();
});

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
  let materialVariant = null;
  try {
    const exportCharacter = character;
    const exportPreset = currentPreset;
    const exportRig = avatarRig;
    const exportPose = poseMode?.value || "idle";
    const selectedQuality = $("export-quality")?.value || "high";
    qualityVariant = applyAvatarQualityVariant(exportCharacter, selectedQuality);
    materialVariant = applyAvatarMaterialVariant(exportCharacter, selectedQuality);
    if (!qualityVariant.withinTriangleBudget) {
      throw new Error("O perfil " + selectedQuality + " não atingiu o orçamento de " + qualityVariant.triangleBudget + " triângulos (resultado: " + qualityVariant.optimizedTriangles + "). Exportação bloqueada.");
    }
    if (!materialVariant.withinMaterialBudget) {
      throw new Error("O perfil " + selectedQuality + " excede o orçamento de materiais: " + materialVariant.materialCount + "/" + materialVariant.materialBudget + ". Exportação bloqueada.");
    }
    if (!materialVariant.withinTextureBudget) {
      const issue = materialVariant.textureIssues[0];
      const detail = issue
        ? issue.width && issue.height
          ? issue.slot + " (" + issue.width + "×" + issue.height + " px)"
          : issue.slot + " (dimensões não verificáveis)"
        : "textura não identificada";
      throw new Error("A textura " + detail + " excede o limite de " + materialVariant.textureMaxSize + " px do perfil " + selectedQuality + ". Exportação bloqueada.");
    }
    exportCharacter.userData.officeKitAvatar = exportCharacter.userData.officeKitAvatar || {};
    exportCharacter.userData.officeKitAvatar.exportedVariant = {
      id: qualityVariant.profileId,
      sourceTriangles: qualityVariant.sourceTriangles,
      optimizedTriangles: qualityVariant.optimizedTriangles,
      optimizedVertices: qualityVariant.optimizedVertices,
      triangleBudget: qualityVariant.triangleBudget,
      withinTriangleBudget: qualityVariant.withinTriangleBudget,
      meshTriangleReports: qualityVariant.meshReports,
      materialCount: materialVariant.materialCount,
      sourceMaterialCount: materialVariant.sourceMaterialCount,
      materialBudget: materialVariant.materialBudget,
      withinMaterialBudget: materialVariant.withinMaterialBudget,
      textureCount: materialVariant.textureCount,
      resizedTextureCount: materialVariant.resizedTextureCount,
      textureMaxSize: materialVariant.textureMaxSize,
      withinTextureBudget: materialVariant.withinTextureBudget,
      materialPrecision: materialVariant.precision,
      convertedMeshCount: materialVariant.convertedMeshCount,
      validation: qualityVariant.validation,
      simplification: "skinning-aware-spatial-uv-local-vertex-clustering"
    };
    const exporter = new GLTFExporter();
    const animations = createAvatarAnimationClips(exportRig, exportPose);
    button.textContent = "A otimizar e exportar…";
    exporter.parse(exportCharacter, (result) => {
      try {
        materialVariant?.restore();
        materialVariant = null;
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
      } catch (error) {
        console.error("GLB download preparation failed", error);
        alert("O modelo foi gerado, mas não foi possível preparar a transferência do ficheiro.");
      } finally {
        materialVariant?.restore();
        materialVariant = null;
        qualityVariant?.restore();
        qualityVariant = null;
        restoreButton();
      }
    }, (error) => {
      console.error("GLB export failed", error);
      materialVariant?.restore();
      materialVariant = null;
      qualityVariant?.restore();
      qualityVariant = null;
      restoreButton();
      alert("Não foi possível exportar o modelo GLB. Consulte a consola do navegador.");
    }, { binary: true, onlyVisible: true, animations });
  } catch (error) {
    console.error("GLB export setup failed", error);
    materialVariant?.restore();
    materialVariant = null;
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
