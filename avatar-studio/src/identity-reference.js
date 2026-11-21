const input = document.getElementById("identity-photo");
const canvas = document.getElementById("identity-canvas");
const context = canvas.getContext("2d", { alpha: false });
const drop = document.getElementById("identity-drop");
const empty = document.getElementById("identity-empty");
const state = document.getElementById("identity-state");
const progress = document.getElementById("identity-progress");
const resetButton = document.getElementById("identity-reset");
const removeButton = document.getElementById("identity-remove");

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
  "Ponta do queixo"
];

let image = null;
let imageUrl = null;
let points = [];

function updateProgress() {
  progress.textContent = points.length + "/" + landmarks.length + " referências faciais assinaladas";
  state.textContent = image ? "Fotografia carregada localmente" : "Sem fotografia";
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
    state.textContent = "10 referências marcadas";
  }
});

resetButton.addEventListener("click", () => {
  points = [];
  draw();
  if (image) state.textContent = "Marque: " + landmarks[0];
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
