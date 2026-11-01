# Implementation status

This page records implemented work separately from planned or independently verified behavior.

## Implemented in the initial vertical slice
- Dependency-free JavaScript core for configuration validation and defensive normalization.
- Separation between local social activity and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks operational state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Responsive browser preview with department selection, zoom control, social idle animation, pause control, and portrait/landscape responsive CSS.
- Core tests using Node's built-in test runner.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline; the preview uses CSS-built placeholder characters.
- Real backend transport/adapters or authentication.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Automated browser screenshots, device-orientation tests, or a verified visual regression suite.

## Verification
Use Node.js 20 or newer. Run npm test to execute the core tests, and npm run check to syntax-check the core and execute tests. Serve examples/browser-preview/ using a local static web server; browser module loading may be blocked when opening index.html directly via file://.

The code has been committed to the feature branch, but no test run is claimed by this document. CI should provide the first repository-hosted execution evidence.

## Design rule
The core is authoritative for configuration and state interpretation; renderers consume its outputs. Local social activity must never become a claim that an agent is doing real work.
