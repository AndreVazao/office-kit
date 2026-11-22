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
- A THREE.Bone / THREE.Skeleton rig with linear-blend skinning on the upper arms, forearms, separate thigh/shin segments, pelvis, and torso shells. The visible limb cylinders are replaced by SkinnedMesh objects weighted between their corresponding joint bones. Thigh and shin are separate meshes with a dedicated knee bone and ankle/foot bone; upper-thigh weights transition from the pelvis into the thigh and knee.
- Outfit attachment: shirt, lapels, tie, buttons, and pocket square follow the chest bone; shoulder shells blend between the chest and upper-arm bones. Robot manipulators and shoulder, elbow, and wrist details follow their corresponding arm/hand bones.
- Procedural idle, walk, sit, talk, and work poses deform the skinned limb segments and body shells. The walk cycle alternates left/right stride and knee recovery, adds ankle/foot roll, counter-rotation through the torso, and subtle wrist swing; sitting, talking, working, and idle poses also include controlled hand, wrist, and torso motion. Human hands now use three-bone chains for each finger and thumb; each phalanx is independently weighted and pose modes drive progressive joint flexion. The optional skeleton helper is a visual inspection overlay.
- GLB export samples the five procedural modes into skeletal animation clips (30 FPS by default), including bone rotation and facial eyelid scale tracks. The editor restores the selected preview mode after sampling. These are reusable basic clips, not motion-capture or production animation.
- All character parameters are local to this app; no backend calls or credential access.

## Multi-device graphics quality contract

Avatar Studio defines four delivery profiles in `src/quality-profiles.js`: Ultra, High, Medium, and Low. Each profile declares target hardware, triangle/material/texture budgets, facial/hair/hand detail, shadow level, animation support, and a suggested preview pixel ratio. The selected profile is deliberately **not** chosen by Avatar Studio: the Office Kit runtime must inspect the actual device/session and select the best supported profile, with a safe fallback.

The GLB root carries this contract in standard glTF `extras` metadata (`officeKitAvatar`), including schema version, profile definitions, and the `runtime-owned` selection policy. This lets a future reviewed adapter read the available tiers without coupling the standalone editor to runtime packages.

**Current implementation:** the GLB export selector generates one profile-specific file at a time. Ultra retains source geometry; High, Medium, and Low run a deterministic vertex-clustering pass per mesh. The pass preserves UV seams and material-group boundaries, averages retained vertex attributes, and aggregates the four strongest bone influences before normalizing skin weights. The exporter records source/optimized triangle counts, vertex count, selected profile, and whether the triangle budget was reached in `officeKitAvatar.exportedVariant`. The original editor geometry is restored after export.

**Validation boundary:** this is a first geometry-reduction pass, not a certified production LOD pipeline. Texture resolution/material variants, automated visual-equivalence checks, deformation stress tests across every animation, and external GLB playback acceptance are still pending. Clustering can alter silhouette or surface detail, and a mesh can remain above budget if its topology cannot be reduced safely enough. Inspect every exported profile before distribution. The Office Kit engines remain untouched and own device capability detection, runtime selection, and fallback.

## Multi-device graphics quality contract and source audit

Four target profiles (Ultra, High, Medium, Low) are defined in `src/quality-profiles.js`. The editor now measures the actual visible post-rig avatar geometry: triangle count, vertex count, visible mesh count, skinned mesh count, and unique material count. It displays whether the current source model fits each profile's triangle and material budgets. The measured source metrics and profile-fit results are embedded in the exported GLB root extras.

The Studio does not detect the user's device and does not select a runtime profile. The Office Kit runtime remains the sole authority for capability detection, profile selection, and fallback.

**Current limitation:** the editor audit reports source-model fit, while each explicit GLB export applies the selected geometry profile. A profile export is not proof of device performance or visual equivalence. The runtime still makes the device-specific selection; Avatar Studio only authors and exports variants.

## CEO identity-reference workflow

The right-hand identity panel accepts a local JPEG, PNG, or WebP reference image (maximum 15 MB). The image is decoded and drawn in the browser only; it is not uploaded, committed, persisted, or transmitted by this module. The user can mark ten facial reference points on the image to create a manual landmark guide. Only the current browser session holds the selected image and points.

The isolated editor also exposes manual facial proportion controls for face width, jaw width, nose volume, eye spacing, and hair length. These controls are procedural modeling parameters and do not infer measurements from the photo. These landmarks are a modeling aid, not an automatic face-recognition or 3D reconstruction system. A single frontal photo cannot reveal the true side, rear, skull depth, or hidden geometry. A faithful likeness requires additional user-supplied views (front, both profiles, and 3/4), consistent lighting where possible, and iterative manual sculpting. Do not claim a likeness is complete until it has been compared against the user's reference views.

## Deliberate limitations

This is a first procedural blockout, not a photogrammetric reconstruction or production-ready anatomical mesh. Upper arms, forearms, leg segments, pelvis, and torso shells are converted to SkinnedMesh objects with two-bone linear-blend weights. The walk/sit/talk/work poses deform the limbs and central body shells. Head assemblies and palms are converted into rigidly weighted SkinnedMesh parts; each finger and thumb uses a three-bone chain with independently weighted proximal, middle, and distal geometry, allowing progressive digit articulation. Feet are rigidly weighted to their ankle/foot bones. Major suit details and selected robot joint components are now rigidly weighted to the chest, upper-arm, forearm, or hand bones. This is attachment, not full cloth deformation: jacket surfaces, trousers, hip and garment seams, and casual/tactical garment details still need further continuous skin weights and seam refinement; the pelvis now blends across Hips, Spine, and both upper-leg bones at the lateral hip seams; the torso shell blends progressively from Hips through Spine to Chest with normalized three-bone weights. The shirt follows the same waist-to-chest gradient, the neck now uses continuous vertical weights between Chest and Neck, the jaw rotates around a dedicated hinge behind the mouth, and shoulder shells blend into the chest. Facial blendshapes, fine tendon/skin deformation, cloth simulation, full-body skinning, and production animation remain future work. The five exported clips are procedural baseline animations and still require validation in external glTF viewers and engines. GLB export includes the visible skinned limb segments and the assembled static parts; the debug helper is hidden by default. Do not describe the model as a complete production-ready character.

## Isolation contract

Do not add imports from Office Kit runtime packages and do not change root package scripts, dependencies, CI workflows, adapters, transport, persistence, or scene-engine files as part of Avatar Studio work. Future integration must happen through a separately reviewed adapter boundary after this module is independently validated.
