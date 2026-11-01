# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the current vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social simulation and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, social idle animation, pause control, and portrait/landscape responsive CSS.
- Preview loads the generic JSON configuration instead of maintaining a separate hard-coded scene.
- Renderer-neutral scene engine with deterministic floor ordering, logical agent positions, viewport validation, fit scaling and zoom.
- Preview now imports the scene engine and applies its calculated fit scale on initial render, zoom changes and viewport resize via ResizeObserver/resize events.
- Preview geometry dimensions are aligned with the scene engine's logical roof/floor/foundation dimensions.
- Corrected scene anchoring: the scaled building is positioned at the viewport center and clipped within the viewport, preventing the unscaled 1200px layout box from shifting the visible building off-screen on narrow displays.
- Added source-level regression tests for centered scaling, overflow clipping, resize observer, and portrait/landscape responsive rules.
- Renderer-neutral graphics quality profile contract: economy, balanced, detailed, cinematic and automatic profile resolution from conservative device hints.
- Browser preview now exposes a quality selector (automatic/economy/balanced/detailed/cinematic) and applies lightweight CSS-level animation/effect differences; automatic mode uses available device hints and updates on resize.
- Documented roadmap and safe future backend-discovery requirement.
- Core, scene-engine layout, and graphics profile tests using Node's built-in test runner.
- GitHub Actions CI workflow.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters.
- Whole-building angular top-perspective/front-cutaway opening view, clickable department focus/zoom, and per-avatar conversation/command interactions (including a configurable CEO avatar representing the user) are canonical requirements but not implemented/verified yet.
- Applying quality profiles to a real rendering pipeline; current profiles are policy data, not active GPU/texture controls.
- Runtime performance measurement and automatic quality adjustment based on measured frame time.
- Full renderer/GPU integration for graphics quality profiles; the current selector changes preview CSS effects only, not texture resolution, DPR, GPU workload or actual FPS target.
- Real backend transport/adapters or authentication; therefore real orders/messages cannot yet be delivered or confirmed.
- Backend discovery/search assistant; requirements only are documented in docs/BACKEND_DISCOVERY.md.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Automated browser screenshots, browser-rendered visual regression tests, or physical-device orientation tests. Source-level layout regression tests exist, but cannot prove actual browser rendering.
- Benchmarks on physical phones, tablets, and desktop hardware.

## Verification
GitHub Actions run #38, ID 41291021736, completed successfully on commit f57330eefbedc4ae53de9083dfca3a401ad4681a. That run covered the core, scene engine, graphics profile tests and example JSON parsing before the latest preview integration changes.
GitHub Actions run #50, ID 41291148536, completed successfully on commit 5a96970246aebc3abcb2d8203a64b8a1c2983afc. Syntax checks, all core/scene-engine/profile tests, and example JSON parsing passed after the preview integration.\nGitHub Actions run #62, ID 41291442920, completed successfully for the preview quality-selector changes (commit 55031c9456533a579de459cdc7ead87a92b5edd3). The latest centered-layout fix and source-level regression tests were added after run #62 and still require CI confirmation. CI checks do not prove visual correctness.

## Design rules
- The core is authoritative for configuration and state interpretation; renderers consume its outputs.
- Local social activity must never become a claim that an agent is doing real work.
- Quality profiles may reduce detail and effects, but must not alter operational state, remove essential information, or compromise readable layout.
