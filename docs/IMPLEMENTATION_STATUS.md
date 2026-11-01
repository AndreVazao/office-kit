# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the current vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social simulation and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, provisional selected-department focus zoom and overview reset, social idle animation, pause control, portrait/landscape responsive CSS, and a selectable per-agent local conversation panel with an explicit no-backend disclaimer.
- Preview loads the generic JSON configuration instead of maintaining a separate hard-coded scene.
- Renderer-neutral scene engine with deterministic floor ordering, logical agent positions, viewport validation, fit scaling and zoom.
- Preview now imports the scene engine and applies its calculated fit scale on initial render, zoom changes and viewport resize via ResizeObserver/resize events.
- Preview geometry dimensions are aligned with the scene engine's logical roof/floor/foundation dimensions.
- Corrected scene anchoring: the scaled building is positioned at the viewport center and clipped within the viewport, preventing the unscaled 1200px layout box from shifting the visible building off-screen on narrow displays.
- Added source-level regression tests for centered scaling, overflow clipping, resize observer, and portrait/landscape responsive rules.
- Angular-diorama geometry now feeds a lightweight SVG shell in the browser preview: roof, right side, per-floor side bands and front-cutaway face are generated from renderer-neutral polygons. Screenshot artifacts from visual regression runs #61/#62 confirm the shell is rendered in portrait, landscape and desktop captures after fixing viewport initialization. The selected-department focus now applies a stronger 2.1x zoom and shares the same vertical camera offset between the SVG shell and interactive room layer; this latest alignment change is committed and awaiting its own visual regression result. This remains an initial perspective layer, not a finished isometric renderer; phone overview labels remain small and need a better focused-room/readability pass. Geometry unit tests cover determinism, floor coverage, optional front cutaway and invalid dimensions.
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
GitHub Actions run #122, ID 41308561429, completed successfully for the core checks. Visual regression run #42, ID 41308561426, completed successfully on commit 5467eb4822f7f31436645d1355073e0233bbe3a9 and produced artifact 13084118255; the portrait chat screenshot was manually inspected and confirms the corrected capture timing. After the corrected-import commit, CI run #134 passed and visual run #54 passed. The SVG shell integration is in commits 287901f and 2e622cd. Visual regression runs #61 and #62 (commit 86e0f6356d97de413ba1188c75e377b3a4b8b4f2) completed successfully and produced artifact 13086102640; manual inspection confirms the SVG shell renders in portrait, landscape and desktop. The renderer focus-offset alignment improvement is in commit cc293c1737e34224f49438bfd13b4b20ca0729fa and is awaiting fresh CI/visual validation. Earlier run #120 and visual run #40 remain historical evidence for the prior state. Earlier historical run records are retained below.
GitHub Actions run #50, ID 41291148536, completed successfully on commit 5a96970246aebc3abcb2d8203a64b8a1c2983afc. Syntax checks, all core/scene-engine/profile tests, and example JSON parsing passed after the preview integration.\nGitHub Actions run #62, ID 41291442920, completed successfully for the preview quality-selector changes (commit 55031c9456533a579de459cdc7ead87a92b5edd3). GitHub Actions run #70, ID 41292191794, completed successfully for the centered-layout fix and source-level regression tests on commit f13f8233348134fc741e032ae5d170349d3d28ba. Visual regression run #2, ID 41293249440, succeeded and produced screenshot artifact ID 13077921682; all three viewport screenshots were inspected. This verifies the current preview layout only, not the final angular cutaway design or physical devices. The later focus-zoom/reset test additions still await CI.

## Design rules
- The core is authoritative for configuration and state interpretation; renderers consume its outputs.
- Local social activity must never become a claim that an agent is doing real work.
- Quality profiles may reduce detail and effects, but must not alter operational state, remove essential information, or compromise readable layout.
