# Implementation status

This page records implemented and verified work. It does not imply later roadmap phases exist.

## Implemented in the initial vertical slice
- Dependency-free JavaScript core for configuration validation and normalization.
- Separation between local social activity and backend-confirmed operational state.
- Missing/stale heartbeat handling that marks state unverified.
- Diagnostics routing for lost communication without inventing a diagnosis.
- Generic JSON preset with configurable departments and agents.
- Core tests using Node's built-in test runner.

## Not implemented yet
- Production renderer or a 3D/pixel-art asset pipeline.
- Real backend transport/adapters or authentication.
- Visual editor and import/export UI.
- Production infirmary scene; only state-routing policy exists in the core.
- Native Android/desktop packaging.
- Automated browser screenshots or device-orientation tests.

## Verification
Run npm test with Node.js 20 or newer to execute the core tests. Run npm run check to syntax-check the core and execute tests. The browser preview is planned as the next implementation slice.

## Design rule
The core is authoritative for configuration and state interpretation; renderers consume its outputs. Local social activity must never become a claim that an agent is doing real work.
