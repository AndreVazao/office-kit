import { chooseSocialActivity, validateOfficeConfig } from "../../packages/core/src/index.mjs";
import { calculateSceneLayout } from "../../packages/scene-engine/src/index.mjs";

const response = await fetch("../minimal-office.json");
if (!response.ok) throw new Error("Não foi possível carregar a configuração de demonstração.");
const config = await response.json();
const validation = validateOfficeConfig(config);
if (!validation.valid) throw new Error(validation.errors.join("\n"));

const floors = document.querySelector("#floors");
const buttons = document.querySelector("#department-buttons");
const building = document.querySelector("#building");
const viewport = document.querySelector(".scene-viewport");
const zoomControl = document.querySelector("#zoom");
const names = {
  "at-desk": "Na secretária",
  walking: "A caminhar",
  "coffee-break": "Pausa para café",
  "looking-at-clock": "A consultar o relógio",
  chatting: "A conversar",
  "balcony-break": "Pausa na varanda",
  resting: "Em pausa"
};
let tick = 0;
let paused = false;
let selectedZoom = Number(zoomControl.value) / 100;
document.querySelector("#office-name").textContent = config.name;
document.querySelector("#agent-count").textContent = config.departments.reduce((n, d) => n + (d.agents || []).length, 0) + " personagens";
document.querySelector(".status span:last-child").textContent = config.backend && config.backend.enabled ? "Backend configurado" : "Simulação local";

function updateSceneLayout() {
  const rect = viewport.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const layout = calculateSceneLayout(config, { width: rect.width, height: rect.height }, {
    logicalWidth: 1200,
    floorHeight: 180,
    roofHeight: 56,
    baseHeight: 48,
    padding: 16,
    zoom: selectedZoom
  });
  building.style.width = layout.logicalBounds.width + "px";
  building.style.minWidth = "0";
  building.style.maxWidth = "none";
  building.style.transformOrigin = "center center";
  building.style.transform = "scale(" + layout.transform.scale + ")";
  building.dataset.orientation = layout.orientation;
  document.querySelector("#orientation-label").textContent = layout.orientation === "landscape" ? "Horizontal" : "Vertical";
}

function render() {
  floors.replaceChildren();
  buttons.replaceChildren();
  for (const dept of [...config.departments].sort((a, b) => (b.floor || 0) - (a.floor || 0))) {
    const floor = document.createElement("article");
    floor.className = "floor";
    floor.id = "floor-" + dept.id;
    floor.style.setProperty("--floor-color", dept.color || "#8eb7e8");

    const label = document.createElement("div");
    label.className = "floor-label";
    label.textContent = dept.name;
    const small = document.createElement("small");
    small.textContent = "Piso " + (dept.floor ?? "—");
    label.append(small);

    const room = document.createElement("div");
    room.className = "floor-room";
    for (const agent of dept.agents || []) {
      const activity = chooseSocialActivity(config.id, agent.id, tick);
      const figure = document.createElement("div");
      figure.className = "agent";
      figure.dataset.activity = activity;
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.style.setProperty("--agent-color", dept.color || "#6b98d0");
      avatar.innerHTML = '<i class="hair"></i><i class="head"></i><i class="body"></i><i class="legs"></i>';
      const name = document.createElement("span");
      name.className = "agent-name";
      name.textContent = agent.name;
      const status = document.createElement("span");
      status.className = "agent-activity";
      status.textContent = names[activity];
      figure.append(avatar, name, status);
      room.append(figure);
    }
    floor.append(label, room);
    floors.append(floor);

    const button = document.createElement("button");
    button.className = "department-button";
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = dept.color || "#8eb7e8";
    const content = document.createElement("span");
    content.textContent = dept.name;
    const meta = document.createElement("span");
    meta.className = "dept-meta";
    meta.textContent = (dept.agents || []).length + " personagem(ns)";
    content.append(meta);
    button.append(swatch, content);
    button.addEventListener("click", () => {
      document.querySelectorAll(".floor").forEach(item => item.classList.remove("highlight"));
      document.querySelectorAll(".department-button").forEach(item => item.setAttribute("aria-pressed", "false"));
      floor.classList.add("highlight");
      button.setAttribute("aria-pressed", "true");
      floor.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    });
    buttons.append(button);
  }
  updateSceneLayout();
}

render();
zoomControl.addEventListener("input", event => {
  selectedZoom = Number(event.target.value) / 100;
  document.querySelector("#zoom-label").textContent = event.target.value + "%";
  updateSceneLayout();
});
document.querySelector("#activity-toggle").addEventListener("click", event => {
  paused = !paused;
  document.body.classList.toggle("paused", paused);
  event.currentTarget.textContent = paused ? "Retomar animações" : "Pausar animações";
  event.currentTarget.setAttribute("aria-pressed", String(paused));
});
window.addEventListener("resize", updateSceneLayout);
if ("ResizeObserver" in window) new ResizeObserver(updateSceneLayout).observe(viewport);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
setInterval(() => { if (!paused && !reducedMotion) { tick++; render(); } }, 6500);
