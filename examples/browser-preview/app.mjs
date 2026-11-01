import { chooseSocialActivity, validateOfficeConfig } from "../../packages/core/src/index.mjs";
import { calculateSceneLayout } from "../../packages/scene-engine/src/index.mjs";
import { calculateDioramaGeometry } from "../../packages/scene-engine/src/diorama.mjs";
import { resolveQualityProfile } from "../../packages/scene-engine/src/quality.mjs";

const response = await fetch("../minimal-office.json");
if (!response.ok) throw new Error("Não foi possível carregar a configuração de demonstração.");
const config = await response.json();
const validation = validateOfficeConfig(config);
if (!validation.valid) throw new Error(validation.errors.join("\n"));

const floors = document.querySelector("#floors");
const buttons = document.querySelector("#department-buttons");
const building = document.querySelector("#building");
const viewport = document.querySelector(".scene-viewport");
const dioramaShell = document.createElementNS("http://www.w3.org/2000/svg", "svg");
dioramaShell.classList.add("diorama-shell");
dioramaShell.setAttribute("aria-hidden", "true");
viewport.prepend(dioramaShell);
const zoomControl = document.querySelector("#zoom");
const qualityControl = document.querySelector("#quality");
const qualityLabel = document.querySelector("#quality-label");
const departmentDetail = document.querySelector("#department-detail");
const agentConsole = document.querySelector("#agent-console");
const chatLog = document.querySelector("#chat-log");
let activeAgent = null;
let chatReturnFocus = null;
const qualityLabels = { auto: "Automático", economy: "Económico", balanced: "Equilibrado", detailed: "Detalhado", cinematic: "Cinemático" };
let selectedQuality = qualityControl.value;
const qualityHints = {
  deviceMemory: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  viewportWidth: window.innerWidth,
  saveData: navigator.connection?.saveData === true,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
};
function updateQuality() {
  const profile = resolveQualityProfile(selectedQuality, { ...qualityHints, viewportWidth: window.innerWidth });
  document.body.dataset.quality = profile.id;
  document.body.dataset.qualitySource = profile.selectedBy;
  qualityLabel.textContent = qualityLabels[selectedQuality] + (selectedQuality === "auto" ? " · " + profile.label.toLowerCase() : "");
  document.querySelector("#quality-note").textContent = selectedQuality === "auto"
    ? "Perfil escolhido por pistas do dispositivo; ainda sem medição real de FPS."
    : "Perfil selecionado manualmente; afeta apenas efeitos da pré-visualização CSS nesta fase.";
}
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
let focusedDepartmentId = null;
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
  const geometry = calculateDioramaGeometry(layout, { depth: 105, lift: 36, frontCut: true });
  const svgNS = "http://www.w3.org/2000/svg";
  const points = polygon => polygon.map(point => point.x + "," + point.y).join(" ");
  dioramaShell.replaceChildren();
  dioramaShell.setAttribute("viewBox", "0 0 " + geometry.logicalBounds.width + " " + geometry.logicalBounds.height);
  dioramaShell.setAttribute("width", String(geometry.logicalBounds.width));
  dioramaShell.setAttribute("height", String(geometry.logicalBounds.height));
  const addPolygon = (polygon, className) => {
    const shape = document.createElementNS(svgNS, "polygon");
    shape.setAttribute("points", points(polygon));
    shape.setAttribute("class", className);
    dioramaShell.append(shape);
  };
  addPolygon(geometry.rightSide, "diorama-side");
  for (const band of geometry.floorBands) addPolygon(band.side, "diorama-floor-side");
  addPolygon(geometry.roof, "diorama-roof");
  addPolygon(geometry.front, "diorama-front");
  dioramaShell.style.width = geometry.logicalBounds.width + "px";
  dioramaShell.style.height = geometry.logicalBounds.height + "px";
  dioramaShell.style.left = "50%";
  building.style.width = layout.logicalBounds.width + "px";
  building.style.minWidth = "0";
  building.style.maxWidth = "none";
  building.style.transformOrigin = "center center";
  // Give a selected department a useful close-up while preserving the same camera offset
  // for the SVG shell and interactive room layer.
  const focusScale = focusedDepartmentId ? 2.1 : 1;
  const focusedFloor = focusedDepartmentId ? document.querySelector("#floor-" + CSS.escape(focusedDepartmentId)) : null;
  const verticalOffset = focusedFloor ? -(focusedFloor.offsetTop + focusedFloor.offsetHeight / 2 - building.offsetHeight / 2) * layout.transform.scale * focusScale : 0;
  dioramaShell.style.top = "calc(50% + " + verticalOffset + "px)";
  dioramaShell.style.transform = "translate(-50%, -50%) scale(" + layout.transform.scale * focusScale + ")";
  building.style.left = "50%";
  building.style.top = "calc(50% + " + verticalOffset + "px)";
  building.style.transform = "translate(-50%, -50%) scale(" + layout.transform.scale * focusScale + ")";
  building.dataset.orientation = layout.orientation;
  document.querySelector("#orientation-label").textContent = layout.orientation === "landscape" ? "Horizontal" : "Vertical";
  document.querySelector("#view-overview").hidden = !focusedDepartmentId;
}

function render() {
  floors.replaceChildren();
  buttons.replaceChildren();
  for (const dept of [...config.departments].sort((a, b) => (b.floor || 0) - (a.floor || 0))) {
    const floor = document.createElement("article");
    floor.className = "floor";
    floor.id = "floor-" + dept.id;
    floor.tabIndex = 0;
    floor.setAttribute("role", "button");
    floor.setAttribute("aria-label", "Focar departamento " + dept.name);
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
      figure.tabIndex = 0;
      figure.setAttribute("role", "button");
      figure.setAttribute("aria-label", "Conversar com " + agent.name);
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
      const openChat = () => openAgentChat(agent, dept);
      figure.addEventListener("click", event => { event.stopPropagation(); openChat(); });
      figure.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openChat(); } });
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
    const selectDepartment = () => {
      focusedDepartmentId = dept.id;
      departmentDetail.classList.add("is-visible");
      document.querySelector("#detail-name").textContent = dept.name;
      document.querySelector("#detail-description").textContent = (dept.description || "Departamento configurado no escritório.") + " · Piso " + (dept.floor ?? "—");
      document.querySelector("#detail-agents").textContent = "Agentes: " + ((dept.agents || []).map(agent => agent.name).join(", ") || "Nenhum agente configurado");
      document.querySelectorAll(".floor").forEach(item => item.classList.toggle("highlight", item === floor));
      document.querySelectorAll(".department-button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      updateSceneLayout();
    };
    button.addEventListener("click", selectDepartment);
    floor.addEventListener("click", selectDepartment);
    floor.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDepartment(); }
    });
    buttons.append(button);
  }
  updateSceneLayout();
}


function openAgentChat(agent, dept) {
  chatReturnFocus = document.activeElement;
  activeAgent = { ...agent, departmentName: dept.name };
  document.querySelector("#chat-agent-name").textContent = agent.name;
  document.querySelector("#chat-agent-role").textContent = (agent.role || "Agente") + " · " + dept.name + " · modo local";
  chatLog.replaceChildren();
  const notice = document.createElement("p");
  notice.className = "chat-system";
  notice.textContent = "Demonstração local: as mensagens não são enviadas a nenhum backend.";
  chatLog.append(notice);
  agentConsole.hidden = false;
  document.querySelector("#chat-input").focus();
}
function closeAgentChat() {
  if (agentConsole.hidden) return;
  agentConsole.hidden = true;
  activeAgent = null;
  const target = chatReturnFocus;
  chatReturnFocus = null;
  if (target?.isConnected && typeof target.focus === "function") target.focus();
}
document.querySelector("#chat-close").addEventListener("click", closeAgentChat);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !agentConsole.hidden) {
    event.preventDefault();
    closeAgentChat();
  }
});
document.querySelector("#chat-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const value = input.value.trim();
  if (!value || !activeAgent) return;
  const userLine = document.createElement("p");
  userLine.className = "chat-user";
  userLine.textContent = value;
  chatLog.append(userLine);
  const reply = document.createElement("p");
  reply.className = "chat-system";
  reply.textContent = "Mensagem registada apenas nesta demonstração. Liga um adaptador de backend autorizado para obter uma resposta real.";
  chatLog.append(reply);
  input.value = "";
  chatLog.scrollTop = chatLog.scrollHeight;
});

render();
document.querySelector("#view-overview").addEventListener("click", () => {
  focusedDepartmentId = null;
  departmentDetail.classList.remove("is-visible");
  document.querySelectorAll(".floor").forEach(item => item.classList.remove("highlight"));
  document.querySelectorAll(".department-button").forEach(item => item.setAttribute("aria-pressed", "false"));
  updateSceneLayout();
});

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
qualityControl.addEventListener("change", event => { selectedQuality = event.target.value; updateQuality(); });
window.addEventListener("resize", () => { updateSceneLayout(); updateQuality(); });
updateQuality();
if ("ResizeObserver" in window) new ResizeObserver(updateSceneLayout).observe(viewport);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
setInterval(() => { if (!paused && !reducedMotion) { tick++; render(); } }, 6500);
