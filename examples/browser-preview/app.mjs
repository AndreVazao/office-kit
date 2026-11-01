import { chooseSocialActivity, validateOfficeConfig } from "../../packages/core/src/index.mjs";

const response = await fetch("../minimal-office.json");
if (!response.ok) throw new Error("Não foi possível carregar a configuração de demonstração.");
const config = await response.json();
const validation = validateOfficeConfig(config);
if (!validation.valid) throw new Error(validation.errors.join("\n"));

const floors = document.querySelector("#floors");
const buttons = document.querySelector("#department-buttons");
const building = document.querySelector("#building");
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
document.querySelector("#office-name").textContent = config.name;
document.querySelector("#agent-count").textContent = config.departments.reduce((n, d) => n + (d.agents || []).length, 0) + " personagens";
document.querySelector(".status span:last-child").textContent = config.backend && config.backend.enabled ? "Backend configurado" : "Simulação local";

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
}
render();
document.querySelector("#zoom").addEventListener("input", event => {
  const zoom = Number(event.target.value);
  building.style.setProperty("--zoom", zoom / 100);
  document.querySelector("#zoom-label").textContent = zoom + "%";
});
document.querySelector("#activity-toggle").addEventListener("click", event => {
  paused = !paused;
  document.body.classList.toggle("paused", paused);
  event.currentTarget.textContent = paused ? "Retomar animações" : "Pausar animações";
  event.currentTarget.setAttribute("aria-pressed", String(paused));
});
const updateOrientation = () => {
  document.querySelector("#orientation-label").textContent = matchMedia("(orientation: landscape)").matches ? "Horizontal" : "Vertical";
};
window.addEventListener("resize", updateOrientation);
updateOrientation();
setInterval(() => { if (!paused) { tick++; render(); } }, 6500);
