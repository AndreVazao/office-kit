import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

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
controls.maxPolarAngle = Math.PI * 0.49;

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

const presets = {
  andre: { title: "André · CEO", description: "Base masculina, cabelo grisalho curto, barba completa e fato azul.", type: "Humano", skin: "#c98f70", hair: "silver", beard: "full", outfit: "suit", build: 1.08, shoulders: 1.06 },
  man: { title: "Personagem masculino", description: "Base humana masculina configurável.", type: "Humano", skin: "#c98f70", hair: "dark", beard: "short", outfit: "casual", build: 1, shoulders: 1.08 },
  woman: { title: "Personagem feminino", description: "Base humana feminina configurável.", type: "Humano", skin: "#d7a783", hair: "dark", beard: "none", outfit: "casual", build: 0.94, shoulders: 0.9 },
  robot: { title: "Robô humanoide", description: "Base robótica modular com placas e articulações metálicas.", type: "Robô", skin: "#9aa9bc", hair: "none", beard: "none", outfit: "tactical", build: 1.02, shoulders: 1.08 }
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
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
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
  const female = currentPreset === "woman";
  const torsoWidth = (female ? 0.31 : 0.35) * build;
  const shoulderWidth = 0.43 * shoulder * build;

  // Legs and footwear
  for (const side of [-1, 1]) {
    const x = side * 0.115 * build;
    makeLimb(root, trousers, [x, 0.91, 0], [x * 1.08, 0.16, 0], 0.105 * build, side < 0 ? "Leg_L" : "Leg_R");
    ellipsoid(root, shoes, [x * 1.08, 0.105, 0.075], [0.12 * build, 0.075, 0.22], "Shoe");
  }

  // Torso, waist, neck
  ellipsoid(root, trousers, [0, 0.99, 0], [0.245 * build, 0.19, 0.15], "Pelvis");
  ellipsoid(root, jacket, [0, 1.34, 0], [torsoWidth, 0.38, 0.17], "Jacket_Torso");
  ellipsoid(root, shirt, [0, 1.39, 0.145], [0.13, 0.30, 0.045], "Shirt");
  cylinder(root, skin, [0, 1.72, 0], 0.09, 0.10, 0.16, "Neck");

  // Arms
  for (const side of [-1, 1]) {
    const shoulderX = side * shoulderWidth * 0.78;
    const elbowX = side * (shoulderWidth * 0.98);
    const handX = side * (shoulderWidth * 1.05);
    ellipsoid(root, jacket, [shoulderX, 1.56, 0], [0.14 * shoulder, 0.15, 0.14], "Shoulder");
    makeLimb(root, jacket, [shoulderX, 1.53, 0], [elbowX, 1.18, 0.015], 0.105, "UpperArm");
    makeLimb(root, jacket, [elbowX, 1.18, 0.015], [handX, 0.88, 0.05], 0.078, "Forearm");
    ellipsoid(root, skin, [handX, 0.84, 0.055], [0.075, 0.105, 0.06], "Hand");
  }

  // Head, ears and facial features
  const head = new THREE.Group();
  head.position.set(0, 1.94, 0);
  head.scale.setScalar(headScale);
  root.add(head);
  ellipsoid(head, skin, [0, 0, 0], [0.205 * faceWidth, 0.265, 0.19], "Head");
  ellipsoid(head, skin, [0, -0.155, 0.035], [0.155 * jawWidth, 0.105, 0.145], "Jaw");
  for (const side of [-1, 1]) {
    ellipsoid(head, skin, [side * 0.205 * faceWidth, -0.005, 0], [0.045, 0.075, 0.045], "Ear");
    ellipsoid(head, eye, [side * 0.083 * eyeSpacing, 0.035, 0.171], [0.025, 0.018, 0.012], "Eye");
    ellipsoid(head, hair, [side * 0.083 * eyeSpacing, 0.075, 0.17], [0.045, 0.012, 0.012], "Eyebrow");
  }
  ellipsoid(head, skin, [0, -0.055, 0.183], [0.045 * noseSize, 0.075 * noseSize, 0.045 * noseSize], "Nose");
  ellipsoid(head, material("#754c4c"), [0, -0.145, 0.17], [0.055, 0.012, 0.012], "Mouth");

  // Short hair cap and side sections
  if (config.hair !== "none") {
    ellipsoid(head, hair, [0, 0.19 + (hairLength - 1) * 0.045, -0.005], [0.207, 0.09 + (hairLength - 1) * 0.07, 0.19], "Hair_Cap");
    for (const side of [-1, 1]) {
      ellipsoid(head, hair, [side * 0.175, 0.075, -0.005], [0.045, 0.12 * hairLength, 0.17], "Hair_Side");
    }
  }

  if (config.beard !== "none") {
    const beardScale = config.beard === "full" ? [0.17, 0.15, 0.095] : [0.145, 0.085, 0.075];
    ellipsoid(head, beard, [0, -0.205, 0.09], beardScale, "Beard");
    ellipsoid(head, beard, [0, -0.105, 0.155], [0.15, 0.055, 0.055], "Mustache");
  }

  // Simple lapels and tie for the CEO suit
  if (config.outfit === "suit") {
    const lapel = material("#355f97");
    const left = addMesh(root, new THREE.BoxGeometry(0.09, 0.29, 0.025), lapel, [-0.075, 1.48, 0.178], [1, 1, 1], "Lapel_L");
    const right = addMesh(root, new THREE.BoxGeometry(0.09, 0.29, 0.025), lapel, [0.075, 1.48, 0.178], [1, 1, 1], "Lapel_R");
    left.rotation.z = -0.22;
    right.rotation.z = 0.22;
    cylinder(root, material("#9a3038"), [0, 1.38, 0.19], 0.018, 0.012, 0.27, "Tie");
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
    makeLimb(root, dark, [x, 0.95, 0], [x, 0.18, 0], 0.105 * build, "Servo_Leg");
    ellipsoid(root, alloy, [x, 0.1, 0.05], [0.13, 0.075, 0.21], "Metal_Foot");
    const sx = side * 0.39 * shoulder * build;
    makeLimb(root, alloy, [sx * 0.82, 1.55, 0], [sx, 1.17, 0], 0.105, "Arm_Upper");
    makeLimb(root, dark, [sx, 1.17, 0], [sx * 1.1, 0.88, 0.04], 0.075, "Arm_Lower");
    ellipsoid(root, alloy, [sx * 1.1, 0.84, 0.04], [0.09, 0.1, 0.08], "Manipulator");
    ellipsoid(root, accent, [sx * 0.82, 1.55, 0], [0.14, 0.14, 0.14], "Shoulder_Joint");
  }
  ellipsoid(root, dark, [0, 1.0, 0], [0.25 * build, 0.19, 0.16], "Hip_Core");
  ellipsoid(root, alloy, [0, 1.35, 0], [0.34 * build, 0.36, 0.19], "Chest_Armor");
  ellipsoid(root, accent, [0, 1.38, 0.195], [0.09, 0.09, 0.025], "Power_Core");
  cylinder(root, dark, [0, 1.74, 0], 0.1, 0.1, 0.14, "Neck_Joint");
  const head = new THREE.Group();
  head.position.y = 1.96;
  head.scale.setScalar(headScale);
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
    hairLength: $("hair-length").value
  };
}

function renderCharacter() {
  const config = readConfig();
  currentPreset = config.preset;
  scene.remove(character);
  character.traverse((item) => {
    if (item.geometry) item.geometry.dispose();
  });
  character = config.preset === "robot" ? buildRobot(config) : buildHuman(config);
  scene.add(character);

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
  $("skin").value = preset.skin;
  $("hair").value = preset.hair;
  $("beard").value = preset.beard;
  $("outfit").value = preset.outfit;
  $("build").value = preset.build;
  $("shoulders").value = preset.shoulders;
  renderCharacter();
}

$("preset").addEventListener("change", applyPreset);
for (const id of ["outfit", "height", "build", "head", "shoulders", "skin", "hair", "beard", "face-width", "jaw-width", "nose-size", "eye-spacing", "hair-length"]) {
  $(id).addEventListener("input", renderCharacter);
  $(id).addEventListener("change", renderCharacter);
}

$("export-glb").addEventListener("click", () => {
  const exporter = new GLTFExporter();
  exporter.parse(character, (result) => {
    const blob = new Blob([result], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "office-kit-avatar-" + currentPreset + ".glb";
    link.click();
    URL.revokeObjectURL(url);
  }, (error) => {
    console.error("GLB export failed", error);
    alert("Não foi possível exportar o modelo GLB. Consulte a consola do navegador.");
  }, { binary: true, onlyVisible: true });
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
  renderer.render(scene, camera);
}
animate();
