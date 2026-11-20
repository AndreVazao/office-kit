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
- Human presets for André (CEO), three masculine body types, three feminine body types, and a humanoid robot.
- Height, body build, head size, shoulder width, face width, jaw width, nose volume, eye spacing, and hair length controls.
- Hair colour and four procedural hairstyles (short, classic, long, tied), beard variants, suit, casual, and tactical clothing variants.
- Rounded visual joint caps at limb endpoints, suit detailing, orbit camera, six preset camera angles (front, 3/4, both profiles, back, top), neutral studio lighting, and GLB export.
- A THREE.Bone / THREE.Skeleton rig with linear-blend skinning on the upper arms, forearms, leg segments, pelvis, and torso shells. The visible limb cylinders are replaced by SkinnedMesh objects weighted between their corresponding joint bones.
- Procedural idle, walk, sit, talk, and work poses deform those skinned limb segments. The optional skeleton helper is a visual inspection overlay.
- All character parameters are local to this app; no backend calls or credential access.

## CEO identity-reference workflow

The right-hand identity panel accepts a local JPEG, PNG, or WebP reference image (maximum 15 MB). The image is decoded and drawn in the browser only; it is not uploaded, committed, persisted, or transmitted by this module. The user can mark ten facial reference points on the image to create a manual landmark guide. Only the current browser session holds the selected image and points.

The isolated editor also exposes manual facial proportion controls for face width, jaw width, nose volume, eye spacing, and hair length. These controls are procedural modeling parameters and do not infer measurements from the photo. These landmarks are a modeling aid, not an automatic face-recognition or 3D reconstruction system. A single frontal photo cannot reveal the true side, rear, skull depth, or hidden geometry. A faithful likeness requires additional user-supplied views (front, both profiles, and 3/4), consistent lighting where possible, and iterative manual sculpting. Do not claim a likeness is complete until it has been compared against the user's reference views.

## Deliberate limitations

This is a first procedural blockout, not a photogrammetric reconstruction or production-ready anatomical mesh. Upper arms, forearms, leg segments, pelvis, and torso shells are converted to SkinnedMesh objects with two-bone linear-blend weights. The walk/sit/talk/work poses deform the limbs and central body shells. Head and hand assemblies are converted into rigidly weighted SkinnedMesh parts, preserving their nested transforms and facial/finger geometry. Feet are now rigidly weighted to their ankle/foot bones. Facial expressions and clothing still need further rig integration. Shoulder/hip transitions therefore still need refinement. Facial blendshapes, cloth simulation, full-body skinning, animation clips, and production animation remain future work. GLB export includes the visible skinned limb segments and the assembled static parts; the debug helper is hidden by default. Do not describe the model as a complete production-ready character.

## Isolation contract

Do not add imports from Office Kit runtime packages and do not change root package scripts, dependencies, CI workflows, adapters, transport, persistence, or scene-engine files as part of Avatar Studio work. Future integration must happen through a separately reviewed adapter boundary after this module is independently validated.
