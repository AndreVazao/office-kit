# Office Kit — Avatar Studio (isolated prototype)

This directory is a standalone character-authoring prototype. It does **not** import, modify, register with, or depend on `packages/scene-engine`, `packages/core`, or `packages/windows-host`. It is intentionally excluded from the root test/build scripts until the module has its own acceptance criteria.

## Run

Serve this directory with any static HTTP server (ES modules and WebGL require HTTP):

```bash
cd avatar-studio
python -m http.server 8000
```

Open `http://localhost:8000`.

Three.js and its GLTF exporter are loaded from the pinned jsDelivr CDN import map. A network connection is required on first load.

## Current prototype

- Procedural, editable human and robot base meshes.
- Human presets for André (CEO), masculine, feminine, and robot.
- Height, body build, head size, and shoulder width controls.
- Hair/beard, suit, and casual clothing variants.
- Orbit camera, neutral studio lighting, and GLB export.
- All character parameters are local to this app; no backend calls or credential access.

## Deliberate limitations

This is a first procedural blockout, not a photogrammetric reconstruction or production-ready anatomical mesh. The current body is assembled from separate primitive meshes and does not yet have a deformable skeleton, skin weights, facial blendshapes, cloth simulation, or animation rig. GLB export exports the visible assembled geometry. Those capabilities must be implemented and tested in this isolated module before claiming production readiness.

## Isolation contract

Do not add imports from Office Kit runtime packages and do not change root package scripts, dependencies, CI workflows, adapters, transport, persistence, or scene-engine files as part of Avatar Studio work. Future integration must happen through a separately reviewed adapter boundary after this module is independently validated.
