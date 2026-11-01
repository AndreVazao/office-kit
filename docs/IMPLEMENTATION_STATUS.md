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
- Renderer-neutral graphics quality profile contract: economy, balanced, detailed, cinematic and automatic profile resolution from conservative device hints.
- Documented roadmap and safe future backend-discovery requirement.
- Core, scene-engine layout, and graphics profile tests using Node's built-in test runner.
- GitHub Actions CI workflow.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters.
- Applying quality profiles to a real rendering pipeline; current profiles are policy data, not active GPU/texture controls.
- Runtime performance measurement and automatic quality adjustment based on measured frame time.
- Visible UI selector for graphics quality.
- Real backend transport/adapters or authentication.
- Backend discovery/search assistant; requirements only are documented in docs/BACKEND_DISCOVERY.md.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Automated browser screenshots, device-orientation tests, or a verified visual regression suite.
- Benchmarks on physical phones, tablets, and desktop hardware.
- Scene engine is not yet integrated into the preview's actual layout calculations.

## Verification
GitHub Actions run #38, ID 41291021736, completed successfully on commit f57330eefbedc4ae53de9083dfca3a401ad4681a. The job core-tests passed syntax checks, all core/scene-engine tests (including the new graphics profile tests), and example JSON parsing. This does not validate visual rendering or physical-device performance.

## Design rules
- The core is authoritative for configuration and state interpretation; renderers consume its outputs.
- Local social activity must never become a claim that an agent is doing real work.
- Quality profiles may reduce detail and effects, but must not alter operational state, remove essential information, or compromise readable layout.
