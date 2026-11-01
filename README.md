# Office Kit

**A configurable digital office for visualizing teams and agents across projects.**

Office Kit is a lightweight, intuitive presentation layer. It is not the backend brain and must never become a dependency for a project's execution, recovery, learning, or decision-making.

## Canonical direction

The canonical product contract lives in [docs/PRODUCT_CONTRACT.md](docs/PRODUCT_CONTRACT.md). Read it before changing product scope.

- [Canonical documentation index](docs/README.md)
- [Product contract](docs/PRODUCT_CONTRACT.md)
- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [Roadmap and acceptance gates](docs/ROADMAP.md)
- [Diorama reference and adaptation plan](docs/DIORAMA_ADAPTATION.md)

## Core principles

- Backend-independent and non-authoritative visual state.
- Configurable buildings, floors, departments, rooms, agents, avatars, furniture, themes and positions.
- Local social animation when there is no confirmed backend work, clearly distinguished from real operational state.
- Reusable backend adapters rather than project-specific dependencies in the renderer.
- Responsive, legible and resource-aware UI for phone, tablet and desktop.
- Configurable triage/infirmary representation for prolonged communication loss; real diagnostics/actions require explicit backend capability and authorization.
- Pixel diorama inspired by [sloemo01/diorama](https://github.com/sloemo01/diorama), adapted into a generic and configurable scene system rather than a fixed VST scene.

## Current implementation status

The repository is establishing its canonical contract and architecture first. Documentation is not evidence that the renderer, editor, social simulation, adapters or mobile layout are already implemented. The roadmap defines the evidence required to consider each phase complete.
