const input = document.getElementById("identity-photo");
const canvas = document.getElementById("identity-canvas");
const context = canvas.getContext("2d", { alpha: false });
const drop = document.getElementById("identity-drop");
const empty = document.getElementById("identity-empty");
const state = document.getElementById("identity-state");
const progress = document.getElementById("identity-progress");
const resetButton = document.getElementById("identity-reset");
const removeButton = document.getElementById("identity-remove");
const applyButton = document.getElementById("identity-apply");

const landmarks = [
  "Linha do cabelo",
  "Sobrancelha esquerda",
  "Sobrancelha direita",
  "Olho esquerdo",
  "Olho direito",
  "Ponta do nariz",
  "Maçã do rosto esquerda",
  "Maçã do rosto direita",
  "Centro da boca",
  "Ponta do queixo",
  "Mandíbula esquerda",
  "Mandíbula direita",
  "Aba nasal esquerda",
  "Aba nasal direita"
];

let image = null;
let imageUrl = null;
let points = [];

function updateProgress() {
  progress.textContent = points.length + "/" + landmarks.length + " referências faciais assinaladas";
  state.textContent = image ? "Fotografia carregada localmente" : "Sem fotografia";
  applyButton.disabled = !image || points.length !== landmarks.length;
}

function draw() {
  if (!image) return;
  const max = 640;
  const ratio = Math.min(max / image.naturalWidth, max / image.naturalHeight, 1);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    context.beginPath();
    context.arc(x, y, Math.max(5, width * 0.009), 0, Math.PI * 2);
    context.fillStyle = "#ffbd4a";
    context.fill();
    context.lineWidth = Math.max(1.5, width * 0.003);
    context.strokeStyle = "#172235";
    context.stroke();
    context.font = "bold " + Math.max(10, width * 0.025) + "px sans-serif";
    context.lineWidth = 3;
    context.strokeStyle = "#172235";
    context.strokeText(String(index + 1), x + 8, y - 7);
    context.fillStyle = "#ffffff";
    context.fillText(String(index + 1), x + 8, y - 7);
  });
  updateProgress();
}

function loadFile(file) {
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    state.textContent = "Formato não suportado";
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    state.textContent = "Imagem demasiado grande (máximo 15 MB)";
    return;
  }

  const nextUrl = URL.createObjectURL(file);
  const nextImage = new Image();
  nextImage.onload = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = nextUrl;
    image = nextImage;
    points = [];
    canvas.style.display = "block";
    empty.hidden = true;
    draw();
  };
  nextImage.onerror = () => {
    URL.revokeObjectURL(nextUrl);
    state.textContent = "Não foi possível abrir a imagem";
  };
  nextImage.src = nextUrl;
}

input.addEventListener("change", () => loadFile(input.files?.[0]));

canvas.addEventListener("click", (event) => {
  if (!image || points.length >= landmarks.length) return;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  points.push({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), label: landmarks[points.length] });
  draw();
  if (points.length < landmarks.length) {
    state.textContent = "Marcar: " + landmarks[points.length];
  } else {
    state.textContent = "14 referências marcadas";
  }
});

resetButton.addEventListener("click", () => {
  points = [];
  draw();
  if (image) state.textContent = "Marque: " + landmarks[0];
});

applyButton.addEventListener("click", () => {
  if (!image || points.length !== landmarks.length) return;
  if (document.getElementById("preset")?.value === "robot") {
    state.textContent = "Seleciona primeiro um avatar humano.";
    return;
  }

  const faceHeight = Math.abs(points[8].y - points[0].y);
  const cheekWidth = Math.abs(points[7].x - points[6].x);
  const eyeDistance = Math.abs(points[4].x - points[3].x);
  const jawWidth = Math.abs(points[11].x - points[10].x);
  const noseWidth = Math.abs(points[13].x - points[12].x);
  if (faceHeight < 0.08 || cheekWidth < 0.04 || eyeDistance < 0.02 || jawWidth < 0.025 || noseWidth < 0.008) {
    state.textContent = "Referências demasiado próximas ou incompletas; volta a marcar os pontos.";
    return;
  }

  const leftRightPairs = [
    [points[6], points[7], "maçãs do rosto"],
    [points[10], points[11], "maxilar"],
    [points[12], points[13], "abas do nariz"],
    [points[3], points[4], "olhos"],
    [points[1], points[2], "sobrancelhas"]
  ];
  const reversedPair = leftRightPairs.find(([left, right]) => left.x >= right.x);
  if (reversedPair) {
    state.textContent = "Corrige a ordem dos pontos: marca o lado esquerdo da fotografia antes do direito (" + reversedPair[2] + ").";
    return;
  }
  const verticalOrderValid =
    points[0].y < Math.min(points[1].y, points[2].y) &&
    Math.max(points[1].y, points[2].y) < Math.min(points[3].y, points[4].y) &&
    Math.max(points[3].y, points[4].y) < points[5].y &&
    points[5].y < Math.min(points[8].y, points[12].y, points[13].y) &&
    points[8].y < points[9].y;
  if (!verticalOrderValid) {
    state.textContent = "A ordem vertical dos pontos não corresponde ao rosto. Limpa os pontos e volta a marcá-los pela sequência indicada.";
    return;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const measurements = {
    faceWidth: clamp((cheekWidth / faceHeight) / 0.95, 0.86, 1.18),
    jawWidth: clamp((jawWidth / cheekWidth) / 0.78, 0.82, 1.22),
    noseSize: clamp((noseWidth / eyeDistance) / 0.54, 0.78, 1.28),
    eyeSpacing: clamp((eyeDistance / cheekWidth) / 0.40, 0.82, 1.18)
  };

  // Sample a small skin patch from each cheek on a private scratch canvas.
  // The visible canvas contains numbered markers, so never sample from it.
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = canvas.width;
  sampleCanvas.height = canvas.height;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const samples = [];
  for (const cheek of [points[6], points[7]]) {
    const centerX = Math.round((cheek.x + (cheek.x < 0.5 ? 0.025 : -0.025)) * sampleCanvas.width);
    const centerY = Math.round((cheek.y - 0.015) * sampleCanvas.height);
    const radius = Math.max(2, Math.round(sampleCanvas.width * 0.009));
    const patch = sampleContext.getImageData(
      Math.max(0, centerX - radius),
      Math.max(0, centerY - radius),
      Math.min(radius * 2 + 1, sampleCanvas.width - Math.max(0, centerX - radius)),
      Math.min(radius * 2 + 1, sampleCanvas.height - Math.max(0, centerY - radius))
    ).data;
    for (let index = 0; index < patch.length; index += 4) {
      const red = patch[index], green = patch[index + 1], blue = patch[index + 2];
      if (red > 65 && red < 245 && red >= green * 0.92 && green > blue * 0.78) samples.push([red, green, blue]);
    }
  }
  const medianColor = (values) => {
    const median = (channel) => {
      const channelValues = values.map((sample) => sample[channel]).sort((a, b) => a - b);
      return channelValues[Math.floor(channelValues.length / 2)];
    };
    return "#" + [0, 1, 2].map((channel) => Math.round(median(channel)).toString(16).padStart(2, "0")).join("");
  };
  if (samples.length >= 8) measurements.skinColor = medianColor(samples);

  // The chin landmark is inside the visible beard. Sample a smaller patch there
  // to match the avatar beard's grey/white tone without sampling the drawn marker.
  const beardPoint = points[9];
  const beardX = Math.round(beardPoint.x * sampleCanvas.width);
  const beardY = Math.round((beardPoint.y - 0.012) * sampleCanvas.height);
  const beardRadius = Math.max(2, Math.round(sampleCanvas.width * 0.006));
  const beardPatch = sampleContext.getImageData(
    Math.max(0, beardX - beardRadius),
    Math.max(0, beardY - beardRadius),
    Math.min(beardRadius * 2 + 1, sampleCanvas.width - Math.max(0, beardX - beardRadius)),
    Math.min(beardRadius * 2 + 1, sampleCanvas.height - Math.max(0, beardY - beardRadius))
  ).data;
  const beardSamples = [];
  for (let index = 0; index < beardPatch.length; index += 4) {
    const red = beardPatch[index], green = beardPatch[index + 1], blue = beardPatch[index + 2];
    if (red > 45 && red < 245 && Math.abs(red - green) < 48 && Math.abs(green - blue) < 58) {
      beardSamples.push([red, green, blue]);
    }
  }
  if (beardSamples.length >= 5) measurements.beardColor = medianColor(beardSamples);
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;
  window.dispatchEvent(new CustomEvent("avatar:identity-measurements", { detail: measurements }));
  state.textContent = "Proporções iniciais aplicadas ao avatar. Afina os controlos manualmente.";
});

function removeImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  image = null;
  points = [];
  input.value = "";
  canvas.style.display = "none";
  context.clearRect(0, 0, canvas.width, canvas.height);
  empty.hidden = false;
  updateProgress();
}

removeButton.addEventListener("click", removeImage);
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("dragover");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragover");
  loadFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener("beforeunload", () => {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
});
updateProgress();
