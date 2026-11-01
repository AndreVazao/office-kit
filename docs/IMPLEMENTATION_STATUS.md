# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the initial vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social activity and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, social idle animation, pause control, and portrait/landscape responsive CSS.
- Preview loads the generic JSON configuration instead of maintaining a separate hard-coded scene.
- Renderer-neutral scene engine with deterministic floor ordering, logical agent positions, viewport validation, fit scaling and zoom.
- Core and scene-engine tests using Node's built-in test runner.
- GitHub Actions CI workflow.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters.
- Real backend transport/adapters or authentication.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Automated browser screenshots, device-orientation tests, or a verified visual regression suite.

## Verification
GitHub Actions run #11 passed for the core and example configuration. The scene-engine additions are in a newer commit and their CI result is pending; do not treat them as verified until that run finishes. The check script syntax-checks core, scene engine and browser preview, then executes both test suites.

## Design rule
The core is authoritative for configuration and state interpretation; renderers consume its outputs. Local social activity must never become a claim that an agent is doing real work.
