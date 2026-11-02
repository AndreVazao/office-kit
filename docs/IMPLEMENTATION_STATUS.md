# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the current vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social simulation and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, selected-department focus zoom and overview reset, social idle animation, pause control, portrait/landscape responsive CSS, and a selectable per-agent local conversation panel with an explicit no-backend disclaimer. A mobile legibility pass now adds a readable selected-department detail card (description, floor and agent names) without forcing the whole-building overview to zoom in; landscape-small-height controls and spacing are compacted.
- Preview loads the generic JSON configuration instead of maintaining a separate hard-coded scene.
- Renderer-neutral scene engine with deterministic floor ordering, logical agent positions, viewport validation, fit scaling and zoom.
- Preview now imports the scene engine and applies its calculated fit scale on initial render, zoom changes and viewport resize via ResizeObserver/resize events.
- Preview geometry dimensions are aligned with the scene engine's logical roof/floor/foundation dimensions.
- Corrected scene anchoring: the scaled building is positioned at the viewport center and clipped within the viewport, preventing the unscaled 1200px layout box from shifting the visible building off-screen on narrow displays.
- Added source-level regression tests for centered scaling, overflow clipping, resize observer, and portrait/landscape responsive rules.
- Angular-diorama geometry now feeds a lightweight SVG shell in the browser preview: roof, right side, per-floor side bands and front-cutaway face are generated from renderer-neutral polygons. Screenshot artifacts from visual regression runs #61/#62 confirm the shell is rendered in portrait, landscape and desktop captures after fixing viewport initialization. The selected-department focus now applies a stronger 2.1x zoom and shares the same vertical camera offset between the SVG shell and interactive room layer. The selected-department detail card reports description, floor and agent names; the browser regression now explicitly checks that the card appears on selection and clears on overview reset. This remains an initial perspective layer, not a finished isometric renderer; phone overview labels remain small and need a better focused-room/readability pass. Geometry unit tests cover determinism, floor coverage, optional front cutaway and invalid dimensions.
- Renderer-neutral graphics quality profile contract: economy, balanced, detailed, cinematic and automatic profile resolution from conservative device hints.
- Browser preview now exposes a quality selector (automatic/economy/balanced/detailed/cinematic) and applies lightweight CSS-level animation/effect differences; automatic mode uses available device hints and updates on resize.
- Documented roadmap and safe future backend-discovery requirement.
- Core, scene-engine layout, and graphics profile tests using Node's built-in test runner.
- GitHub Actions CI workflow.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters. The SVG shell is an initial lightweight perspective treatment; it does not yet render room interiors as perspective polygons or provide true 3D assets.
- Full whole-building angular top-perspective/front-cutaway renderer and real per-avatar command delivery (including a configurable CEO avatar representing the user) are not complete; the preview now has an initial SVG shell only. The CSS preview now has a local-only per-avatar conversation demonstration, department focus zoom and overview reset. Visual regression run #42 confirms the chat panel is captured open, including the submitted test message; this remains a local-only demo, not production renderer or backend integration.
- Applying quality profiles to a real rendering pipeline; current profiles are policy data, not active GPU/texture controls.
- Runtime performance measurement and automatic quality adjustment based on measured frame time.
- Full renderer/GPU integration for graphics quality profiles; the current selector changes preview CSS effects only, not texture resolution, DPR, GPU workload or actual FPS target.
- Real backend transport/adapters or authentication; therefore real orders/messages cannot yet be delivered or confirmed.
- Backend discovery/search assistant; requirements only are documented in docs/BACKEND_DISCOVERY.md.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Physical-device orientation tests remain pending. Visual regression run #42 (ID 41308561426) passed on Chromium and produced screenshot artifact ID 13084118255 for 390×844 portrait, 844×390 landscape and 1366×768 desktop, including open-chat captures. Manual inspection of `visual-portrait-390x844-chat.png` confirms the panel remains open and shows the test message and explicit local-only disclaimer. The building remains too small for comfortable reading at portrait overview scale; the desktop placeholder is still a flat CSS building, not the required angular cutaway.
- Benchmarks on physical phones, tablets, and desktop hardware.

## Verification
GitHub Actions run #122, ID 41308561429, completed successfully for the core checks. Visual regression run #42, ID 41308561426, completed successfully on commit 5467eb4822f7f31436645d1355073e0233bbe3a9 and produced artifact 13084118255; the portrait chat screenshot was manually inspected and confirms the corrected capture timing. After the corrected-import commit, CI run #134 passed and visual run #54 passed. The SVG shell integration is in commits 287901f and 2e622cd. Visual regression runs #61 and #62 (commit 86e0f6356d97de413ba1188c75e377b3a4b8b4f2) completed successfully and produced artifact 13086102640; manual inspection confirms the SVG shell renders in portrait, landscape and desktop. The renderer focus-offset alignment improvement is in commit cc293c1737e34224f49438bfd13b4b20ca0729fa. PR #2 merged after CI and visual regression both passed on latest commit 436e79e5fa5044811e8065e66fa2ec6a73ea1c0f. The follow-up branch adds explicit visual assertions for selected-department details and overview reset; its fresh CI/visual checks are pending. Earlier run #120 and visual run #40 remain historical evidence for the prior state. Earlier historical run records are retained below.
GitHub Actions run #50, ID 41291148536, completed successfully on commit 5a96970246aebc3abcb2d8203a64b8a1c2983afc. Syntax checks, all core/scene-engine/profile tests, and example JSON parsing passed after the preview integration.\nGitHub Actions run #62, ID 41291442920, completed successfully for the preview quality-selector changes (commit 55031c9456533a579de459cdc7ead87a92b5edd3). GitHub Actions run #70, ID 41292191794, completed successfully for the centered-layout fix and source-level regression tests on commit f13f8233348134fc741e032ae5d170349d3d28ba. Visual regression run #2, ID 41293249440, succeeded and produced screenshot artifact ID 13077921682; all three viewport screenshots were inspected. This verifies the current preview layout only, not the final angular cutaway design or physical devices. The later focus-zoom/reset test additions still await CI.

## Design rules
- The core is authoritative for configuration and state interpretation; renderers consume its outputs.
- Local social activity must never become a claim that an agent is doing real work.
- Quality profiles may reduce detail and effects, but must not alter operational state, remove essential information, or compromise readable layout.


## Estado de proveniência visual (implementação inicial)
- A pré-visualização marca a atividade de cada personagem como “Simulado” e “não verificado”; o cabeçalho distingue simulação local de backend apenas declarado.
- Esta etiqueta não é um adaptador de backend nem prova de execução. O Office Kit ainda não recebe estados operacionais reais.
- Foi registada a revisão documental inicial do Deskforce em `docs/REFERENCE_DESKFORCE.md`. Não foi copiado código nem asset desse projeto nesta fase.
- Verificação automatizada desta alteração: pendente de CI e regressão visual do PR.


## Contrato neutro de estados — fase em curso
- Implementado em branch `feat/backend-state-contract`: módulo puro `runtime-state.mjs`, versão de schema 1, vocabulários explícitos para agente/tarefa, validação de proveniência estrutural e timestamp, TTL configurável e derivação de `live`, `stale`, `synchronizing`, `disconnected`, `connecting` e `error`.
- Dados de agente/tarefa só são expostos como estados confirmados quando o snapshot está fresco e sincronizado; nos restantes estados, o campo visual passa a `unknown`.
- Testes adicionados para snapshots válidos/inválidos, timestamp expirado/futuro, reconexão e estados desconectado/erro.
- Limitação importante: validação estrutural não autentica a origem. Ainda não há adaptador de backend, ligação real, heartbeat nem comandos.
- CI e regressão visual desta branch: ainda não verificados nesta atualização.


## Ciclo de vida de sessão runtime — incremento em revisão
- Adicionado `packages/scene-engine/src/runtime-session.mjs`: controlador determinístico sem sockets, dependências de rede ou execução de comandos.
- Estados implementados no controlador: `connecting`, `synchronizing`, `live`, `stale`, `disconnected` e `error`. Uma sessão só passa a `live` depois de receber snapshot válido, fresco e sincronizado; heartbeat isolado nunca promove uma sessão por sincronizar.
- Timeout de heartbeat, desconexão, falha de transporte e snapshot inválido retiram a confirmação dos estados operacionais e convertem agentes/tarefas para `unknown`.
- Reconexão exige novo snapshot; não se reutiliza o estado anterior como prova de atividade atual.
- Testes adicionados para arranque, heartbeat expirado, reconexão, snapshot inválido, heartbeat antes da sincronização e falha/desconexão.
- Limite: este é um controlador puro para adaptadores e testes. Não implementa transporte nem heartbeat de rede real e não autentica a origem. CI e regressão visual do PR ainda por executar.


## Simulador genérico de runtime — incremento em revisão
- Adicionado `packages/scene-engine/src/runtime-simulator.mjs`, um simulador determinístico e independente de backend sobre `RuntimeSession`, sem transporte de rede, credenciais, dependências específicas ou execução de comandos.
- Regista eventos sequenciados e emite snapshots neutros v1. IDs duplicados são ignorados; snapshots antigos permanecem sem confirmação; reconexão exige novo snapshot sincronizado.
- Adicionados testes em `packages/scene-engine/test/runtime-simulator.test.mjs` para arranque, sincronização, snapshots duplicados/antigos, heartbeat, reconexão, histórico e dados inválidos.
- O simulador foi incluído nas verificações de sintaxe do pacote.
- CI e regressão visual deste PR e pós-merge ainda têm de passar. Os testes foram escritos, mas não executados localmente neste ambiente.
- Office Kit continua genérico: não existe ligação automática ou fixa a VST, DGM-MAT ou qualquer backend. Descoberta, seleção e instalação de adaptadores são fases futuras.


## Contrato público de adaptadores — incremento em revisão
- Adicionado `adapter-contract.mjs` com API versionada, métodos mínimos, metadados e capacidades conhecidas.
- Modo seguro por omissão: somente leitura. Comandos são capacidade explícita, não fazem parte da interface mínima e exigem autorização externa.
- Adicionado normalizador de envelope de eventos com sequência monotónica, timestamp e rejeição de eventos repetidos, fora de ordem, expirados ou com timestamp futuro.
- Testes adicionados para contrato mínimo, capacidades inválidas, envelope, sequência, validade temporal e timestamps numéricos.
- CI e regressão visual deste PR ainda pendentes; a validação estrutural não autentica adaptadores.


## Gateway de adaptadores — incremento em revisão
- Adicionado `AdapterGateway` para ligar um adaptador explicitamente escolhido à `RuntimeSession`.
- Valida a interface, obtém snapshot inicial antes de considerar estado confirmado e processa envelopes de evento com sequência e idade.
- Falhas de ligação falham em segurança; desligar limpa subscrições. Não existe descoberta automática, autenticação integrada, transporte próprio ou execução de comandos.
- Testes adicionados para adaptador válido/inválido, falha de ligação, duplicados, ordem, expiração, heartbeat e limpeza de subscrição.
- CI e regressão visual ainda pendentes; identidade/autorização continuam responsabilidade do anfitrião.
