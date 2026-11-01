# Diorama reference audit — initial findings

Date: 2026-11-01
Reference: sloemo01/diorama, branch main
Scope: initial inspection of SKILL.md, templates/DESIGN.md, templates/SOURCES.md, templates/CREDITS.md, templates/qa/README.md, root directory listing and LICENSE. This is a partial audit, not a full source-code or asset audit.

## Findings relevant to Office Kit

- The reference provides a deliberate visual-production process, not merely a scene: design sheet, cast sheet, life/service sheet, system and beat sheets, contact choreography, ambient loops, surface/motion audit, source log, credits and QA.
- Its QA guidance emphasizes deterministic/frozen-time screenshots, real browser checks at multiple viewport sizes, graph/geometry checks, per-entity frame sampling, movement continuity, palette probes and nonzero exit codes on failures.
- The suggested debug surface exposes the scene, camera, renderer and a synchronous freeze(time) operation. Office Kit should define a renderer-neutral capture contract and a deterministic simulation clock before adopting comparable tools.
- Asset provenance is explicit: record source URL, author, license, date, and edits. CC-BY requires visible attribution; assets with unclear rights or NC/ND restrictions are not to be used without permission.
- The template design assumes a specific three-quarter camera and carefully staged scene. These are useful as a Pixel Diorama preset, but must not become requirements for all Office Kit renderers or projects.
- The reference QA scripts use Playwright Core and require a compatible Chromium setup plus a scene debug handle. They should not be copied into the core runtime as dependencies without a separate evaluation.

## Adaptation decisions

1. Keep the domain model and configuration format independent of Three.js, DOM, browser, or a specific backend.
2. Treat building geometry, rooms, agent rigs, props, camera/palette and choreography as configurable scene/assets or renderer adapters.
3. Build a deterministic scene clock and capture hook into the renderer contract; use that for screenshot regression tests.
4. Keep social choreography local and non-authoritative. It may animate an idle character but cannot manufacture operational progress.
5. Maintain a first-party asset register with source/license/attribution fields before importing any third-party asset.
6. Start with viewport and overlap checks, then add continuity, collision, scene graph and asset-specific QA as the renderer matures.

## License/provenance

The inspected reference LICENSE is MIT and names Nehal Kanak / Sloemo01, copyright 2026. Any copied code must retain the applicable copyright/license notice. This finding applies to the inspected repository revision only; each future code or asset import still needs its own source/license check.

## Remaining audit work

- Inspect root README, package/dependency definitions and the full set of template modules that could be candidates for adaptation.
- Inspect each candidate module's exports, dependencies, assumptions and license headers.
- Confirm the intended upstream commit SHA and record it in the source/credits register before importing code.
- Test the reference's actual build and QA scripts in a clean environment before deciding whether to reuse, wrap, or independently reimplement them.
