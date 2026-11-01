# Office Kit

**A configurable digital office for visualizing teams and agents across projects.**

Office Kit is a lightweight, intuitive presentation layer. It is not the backend brain and must never become a dependency for a project's execution, recovery, learning, or decision-making.

## Canonical direction

The canonical product contract lives in [docs/PRODUCT_CONTRACT.md](docs/PRODUCT_CONTRACT.md). Read it before changing product scope.

- [Canonical documentation index](docs/README.md)
- [Product contract](docs/PRODUCT_CONTRACT.md)
- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [Roadmap and acceptance gates](docs/ROADMAP.md)
- [Adaptive graphics quality profiles](docs/QUALITY_PROFILES.md)
- [Diorama reference and adaptation plan](docs/DIORAMA_ADAPTATION.md)
- [Implementation status and verification boundary](docs/IMPLEMENTATION_STATUS.md)

## First implementation slice

- [Browser preview](examples/browser-preview/index.html): responsive office mockup with zoom, department focus, and clearly labelled local social animation.
- [Generic configuration preset](examples/minimal-office.json): example of project-neutral departments and agents.
- [Core module](packages/core/src/index.mjs): configuration validation and safe interpretation of backend/social states.
- [Scene engine](packages/scene-engine/src/index.mjs): renderer-neutral layout calculations.
- [Graphics quality profiles](packages/scene-engine/src/quality.mjs): economy, balanced, detailed, cinematic, and automatic selection from conservative device hints.
- Run `npm run check` with Node.js 20+ to execute syntax checks and the dependency-free tests.

The browser preview is an early CSS prototype, not the final Diorama-quality renderer. Quality profiles are currently policy data and are not yet wired to a production rendering pipeline. The project is not yet packaged as an Android or desktop application.

## Core principles

- Backend-independent and non-authoritative visual state.
- Configurable buildings, floors, departments, rooms, agents, avatars, furniture, themes and positions.
- Local social animation when there is no confirmed backend work, clearly distinguished from real operational state.
- Reusable backend adapters rather than project-specific dependencies in the renderer.
- Responsive, legible and resource-aware UI for phone, tablet and desktop.
- User-selectable quality with conservative automatic defaults and no sacrifice of essential information.
- Configurable triage/infirmary representation for prolonged communication loss; real diagnostics/actions require explicit backend capability and authorization.
- Pixel diorama inspired by [sloemo01/diorama](https://github.com/sloemo01/diorama), adapted into a generic and configurable scene system rather than a fixed VST scene.
