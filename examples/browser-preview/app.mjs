import { chooseSocialActivity, validateOfficeConfig } from "../../packages/core/src/index.mjs";
const config = {
  contractVersion: 1, id: "minimal-office", name: "Escritório de Demonstração",
  scene: { layout: "diorama", orientation: "auto" },
  departments: [
    { id: "executive", name: "Direção", floor: 3, color: "#8eb7e8", agents: [{ id: "director", name: "Direção", role: "coordinator" }] },
    { id: "research", name: "Investigação", floor: 2, color: "#91c8ad", agents: [{ id: "researcher-a", name: "Investigador A" }, { id: "researcher-b", name: "Investigador B" }] },
    { id: "operations", name: "Operações", floor: 1, color: "#e5bd78", agents: [{ id: "operator", name: "Operador" }] }
  ]
};
const result = validateOfficeConfig(config);
if (!result.valid) throw new Error(result.errors.join("\n"));
const floors = document.querySelector("#floors"), buttons = document.querySelector("#department-buttons"), building = document.querySelector("#building");
const names = { "at-desk":"Na secretária", walking:"A caminhar", "coffee-break":"Pausa para café", "looking-at-clock":"A consultar o relógio", chatting:"A conversar", "balcony-break":"Pausa na varanda", resting:"Em pausa" };
let tick = 0, paused = false;
document.querySelector("#office-name").textContent = config.name;
document.querySelector("#agent-count").textContent = config.departments.reduce((n,d) => n+d.agents.length,0) + " personagens";
function render() {
  floors.replaceChildren(); buttons.replaceChildren();
  for (const dept of [...config.departments].sort((a,b) => b.floor-a.floor)) {
    const floor = document.createElement("article"); floor.className = "floor"; floor.id = "floor-" + dept.id; floor.style.setProperty("--floor-color",dept.color);
    const label = document.createElement("div"); label.className = "floor-label"; label.textContent = dept.name;
    const small = document.createElement("small"); small.textContent = "Piso " + dept.floor; label.append(small);
    const room = document.createElement("div"); room.className = "floor-room";
    for (const agent of dept.agents) {
      const activity = chooseSocialActivity("office-kit-preview",agent.id,tick);
      const figure = document.createElement("div"); figure.className = "agent"; figure.dataset.activity = activity;
      const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.style.setProperty("--agent-color",dept.color);
      avatar.innerHTML = '<i class="hair"></i><i class="head"></i><i class="body"></i><i class="legs"></i>';
      const name = document.createElement("span"); name.className = "agent-name"; name.textContent = agent.name;
      const status = document.createElement("span"); status.className = "agent-activity"; status.textContent = names[activity];
      figure.append(avatar,name,status); room.append(figure);
    }
    floor.append(label,room); floors.append(floor);
    const button = document.createElement("button"); button.className = "department-button"; button.type = "button"; button.setAttribute("aria-pressed","false");
    const swatch = document.createElement("span"); swatch.className = "swatch"; swatch.style.background = dept.color;
    const content = document.createElement("span"); content.textContent = dept.name;
    const meta = document.createElement("span"); meta.className = "dept-meta"; meta.textContent = dept.agents.length + " personagem(ns)"; content.append(meta);
    button.append(swatch,content);
    button.addEventListener("click",() => {
      document.querySelectorAll(".floor").forEach(item => item.classList.remove("highlight"));
      document.querySelectorAll(".department-button").forEach(item => item.setAttribute("aria-pressed","false"));
      floor.classList.add("highlight"); button.setAttribute("aria-pressed","true");
      floor.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"nearest"});
    });
    buttons.append(button);
  }
}
render();
document.querySelector("#zoom").addEventListener("input",event => { const zoom=Number(event.target.value); building.style.setProperty("--zoom",zoom/100); document.querySelector("#zoom-label").textContent=zoom+"%"; });
document.querySelector("#activity-toggle").addEventListener("click",event => {
  paused=!paused; document.body.classList.toggle("paused",paused); event.currentTarget.textContent=paused?"Retomar animações":"Pausar animações"; event.currentTarget.setAttribute("aria-pressed",String(paused));
});
const updateOrientation=()=>{document.querySelector("#orientation-label").textContent=matchMedia("(orientation: landscape)").matches?"Horizontal":"Vertical";};
window.addEventListener("resize",updateOrientation); updateOrientation();
setInterval(()=>{if(!paused){tick++;render();}},6500);
