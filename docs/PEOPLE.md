# People: realistic characters for Epoch

The code-built figures (`city/character.js`, `spots/kit.js`) top out at mannequins. These are real human models:
**MakeHuman** bodies generated with the **MPFB2** Blender add-on, dressed in MakeHuman community clothes, and animated
with the **Quaternius Universal Animation Library 1 + 2**, retargeted onto the MakeHuman rig. Everything is free, offline
at runtime, and licensed CC0 or CC BY (see `epoch/web/static/app/people/LICENSES.md`).

The code-built figure stays the automatic fallback: if a GLB fails to load, WebGL is missing, or the device is too weak,
callers keep using `buildFigure()`.

## What ships (`epoch/web/static/app/people/`, about 23 MB)

| File | What |
|---|---|
| `manifest.json` | characters, outfits, LOD files and triangle counts, clips (duration, loop), skeleton bone names, notes |
| `LICENSES.md` | every source asset with author, licence and link (the CC BY attribution) |
| `user/<outfit>.{close,mid,far}.glb` | the user's character in every outfit of `economy_catalog.OUTFITS` + `CHEST_OUTFITS`, named by catalog id |
| `npc/<npc_id>.{close,mid,far}.glb` | 12 other people (students / customers) |
| `clips.glb` | every animation, armature only, shared by all characters |

**The user's character:** a young South Indian man, early-mid 20s, 1.72 m, average build, warm brown skin (texture mean
moved to #8a5a3c), black short hair, brown eyes, clean-shaven, no logos or text on any clothing. Default outfit
`everyday` = plain white tee, blue jeans, white sneakers.

**NPCs** (seeded names, ages 21-30, mixed genders, ethnicities and builds): Maya (glasses), Jamal (headphones),
Lena (backpack), Kenji (glasses), Sofia, Marcus (knit cap), Aisha (backpack), Daniel (headphones), Priya, Leo (flat cap),
Hana (backpack), Omar (beard). The specs live in `scripts/people/specs.py`.

### Conventions

- 1 unit = 1 m, +Y up, the character faces **+Z**, feet at y = 0, origin between the feet.
- Every GLB uses the same MPFB2 `game_engine` skeleton (53 bones, Unreal-style names: `Root`, `pelvis`, `spine_01..03`,
  `neck_01`, `head`, `clavicle_l`, `upperarm_l`, `lowerarm_l`, `hand_l`, fingers `index_01_l`.., `thigh_l`, `calf_l`,
  `foot_l`, `ball_l`, and `_r`).
- LODs: `close` ≤ 15k triangles for the user (≤ 10k for NPCs), 1024 px textures; `mid` ≤ 5k, 512 px;
  `far` ≤ 1.5k, 128 px (no eyes/brows/lashes). Hint: close < 4 m, mid 4-15 m, far for crowds.
- Materials are plain glTF PBR (MeshStandardMaterial in three.js): albedo (+ normal map on close), roughness; hair is
  alpha-tested, brows/lashes alpha-blended, glasses lenses cut out. Body skin under clothing is deleted (no poke-through,
  fewer triangles).
- Compression: `EXT_meshopt_compression` + `KHR_mesh_quantization`, textures `EXT_texture_webp`. The decoder is vendored
  from three@0.186.1: `vendor/three/addons/libs/meshopt_decoder.module.js` (also vendored: `loaders/GLTFLoader.js`,
  `utils/BufferGeometryUtils.js`, `utils/SkeletonUtils.js`, unchanged upstream files).

### Clips (`clips.glb`, 24 fps)

| Clip | Loop | Source |
|---|---|---|
| idle, walk (0.81 m/s in place), sit_idle, dance | loop | UAL1 Idle_Loop, Walk_Loop, Sitting_Idle_Loop, Dance_Loop |
| kneel (open a chest) | once | UAL2 Chest_Open |
| water (watering a plant) | loop | UAL2 Farm_Watering |
| sit_type, sit_read (page turn ~3.5 s), sit_sip, play_piano | loop | authored on top of sit_idle |
| idle_look (looks left, then right, slightly up) | loop | authored on top of idle |
| stand_stretch, yawn, wave, point, cheer | once (start and end in idle) | authored on top of idle |
| sleep (on the back, breathing) | loop | authored from the rest pose |

Tracks are **quaternion rotations for every bone + `pelvis.position`** only, so one clip fits every body. The pelvis
position was authored for the reference skeleton (`manifest.clips.ref_hip_height_m`, the user's): for another character
multiply the `pelvis.position` values by `character.hip_height_m / ref_hip_height_m` (clone the clip per character once).
Sitting clips assume a seat whose surface is ≈ 0.45 m high (pelvis at `clips.items.sit_idle.pelvis_height_m`); typing /
piano hands rest ≈ 0.74 m (desk height) about 0.45 m in front of the hips. `sleep` lies on the back on a surface at the
character's y = 0, head toward −Z (`manifest.clips.sleep`). Reduced motion: hold a single frame (e.g. `mixer.setTime`
on `idle` / `sit_idle`) instead of playing.

### Loading in three.js (for the integrator)

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const base = new URL('../people/', import.meta.url);      // relative to the importing module (fingerprinted /static/v/…)
const man = await (await fetch(new URL('manifest.json', base))).json();
const clips = (await loader.loadAsync(new URL('clips.glb', base).href)).animations;
const g = await loader.loadAsync(new URL(man.characters[0].outfits.everyday.lods.close.file, base).href);
const person = cloneSkinned(g.scene);                       // one load, many instances (crowds)
const mixer = new THREE.AnimationMixer(person);
mixer.clipAction(THREE.AnimationClip.findByName(clips, 'sit_type')).play();
```

Keep JS imports relative or via the import map (never `/static/app/…`). Render-on-demand: call `mixer.update(dt)` only
while something is animating; pause when hidden.

## Verification (2026-10-23)

- three.js (headless Chrome, GPU): all 69 GLBs + `clips.glb` parse with the vendored loader + decoder, every mesh is
  skinned to the 53 manifest bones, feet at y = 0; clips play through `AnimationMixer`.
  Shots: `/tmp/underdog-shots/people-threejs-lineup.png`, `/tmp/underdog-shots/people-threejs-clips.png`.
- Blender EEVEE contact sheet (user in default + outfits, all NPCs, frames of sit_type / walk / wave):
  `/tmp/underdog-shots/people-contact-sheet.png`.
- `tests/test_people_assets.py`: catalog coverage, budgets, skeleton, clip tracks, total size, licences.

## Rebuild

Everything is reproducible from scripts (Blender 5.2.3 LTS, MPFB2 2.0.18):

```sh
scripts/people/fetch_assets.sh    # Blender check, MPFB2 install, MakeHuman packs (sha256-checked) into MPFB's data dir,
                                  # UAL zips (manual free download, see the script), build-time npm tools
scripts/people/build_all.sh       # ~4 min on an M1 Pro: all characters, clips, meshopt, manifest + LICENSES
```

Pieces: `specs.py` (who wears what: pure data), `build_lib.py` (MPFB human, materials/tinting, accessories, decimation,
export), `build_character.py` (one character/outfit → 3 LOD GLBs), `build_clips.py` (retarget + authored clips),
`strip_clip_tracks.py`, `write_manifest.py` (manifest + LICENSES, fails on an unknown or non-redistributable licence),
`render_views.py` (EEVEE renders for checks). Raw downloads live in `build/people-raw/` (gitignored, ~3.6 GB) and
intermediates in `build/people-work/`.

To add an outfit: add its catalog id to `specs.OUTFITS` with MakeHuman clothes (+ tints), run `build_all.sh chars`
(or one: `blender -b -P scripts/people/build_character.py -- --id user --outfit <id>`), then the meshopt + manifest
steps at the end of `build_all.sh`. Check new clothing textures for logos/text first (we avoid all of them; e.g. the
punkduck sneakers with printed soles were swapped out).

### How the retargeting works

UAL clips are sampled on their own (T-pose) skeleton. For each bone, the clip's world rotation relative to the source
T-pose is applied to the MakeHuman rest pose after a per-bone swing that lines the MakeHuman rest bone directions up with
the source's (the A-pose vs T-pose difference), and the pelvis moves by the source pelvis offset scaled by hip height.
Authored clips are layers over those poses: analytic 2-bone arm IK to points relative to the shoulders/head (keyboard,
book, cup to the mouth, keys, waving, pointing), hand orientation (palm direction, twist shared with the forearm),
finger curls, head/spine turns, all with smooth envelopes. Deterministic: same inputs, same file.

### Known limits

- Faces don't animate (no blend shapes); eyes don't blink. Hair is a static mesh (no physics).
- Clothes are skinned copies of the body weights: extreme poses (sleep, kneel) can show small clipping.
- `far` LODs are rough up close by design.
- The varsity jacket is a recoloured zip jacket (navy body, cream sleeves); the raincoat is a glossy yellow zip jacket
  with yellow boots.

## Proof wiring (2026-10-23): `?people=1` in the Today room only

- `city/people.js` (load, clone, mixer, skin/eye/hair materials, key + rim + PMREM lights, contact shadow, head look-at, book prop) is used by
  `room.js` only when the page URL has `?people=1` (default off; the code-built figure stays, and returns by itself if loading fails).
- Debug params: `&pose=sit_read|sit_type|idle_look`, `&tod=day|night|morning|golden|blue|13.5`, `&cam=close|face|sit-side|sit-front|sit-back|side`,
  `&at=open` (stand in the open facing the camera), `&t=<s>` (freeze a clip frame), `&peoplefail=1` (force the fallback).
- Sit clips keep the pelvis 0.278 m behind the root (the origin is between the feet), so the root is placed that far ahead of the seat point.
- Rebuilt for the proof: `user/everyday.close.glb` only (male V-shape targets, crew-neck tee, jeans label/button text painted out, iris recoloured,
  `eyebrow002`, short-sleeve arm skin removed); `clips.glb` (sit_type reaches 0.1 m further, the idle stance is narrowed from 0.39 m to 0.22 m).
  The everyday mid/far LODs and every other outfit/NPC are unchanged and still use the old tee.

## Fit system: nothing passes through anything (2026-10-23 late, docs/PEOPLE-SPEC.md 10.2)

`city/people_fit.js` is generic (the Today room uses it; Butler, café, rooftop and park reuse it). Furniture boxes come from `Geo.vols` (every `box()` and
`cyl()` records its axis-aligned volume) plus the item pose; the shell's boxes are the walls, sill and radiator; the floor is one big box.

- **Clearance check:** `sampleCloud(P, clip)` skins ~6k vertices over 24 frames (`SkinnedMesh.getVertexPosition`, root-local, so it does not depend on the placement).
  `evaluate(cloud, place, vols)` prints, per object, the max penetration, the min clearance and the designed contact. Designed contacts (within 1.5 cm): pelvis and
  thighs on a seat, feet on the floor or a footrest, fingertips on the keyboard, forearms on the desk top. Soft cushions (`seat_soft`) may compress 3 cm. Everything
  else: penetration <= 1 cm (hard gate) and clearance >= 2 cm (>= 15 cm for a standing spot). `window.__peopleFit.report()` prints the report of every state shown.
- **Placement solver:** `solve()` searches +-20 cm x/z, +-15 deg yaw and +-3 cm height around the activity anchor (coarse 2 cm grid on a thinned cloud, then a hill climb on the
  full cloud). The result is cached per furniture type + clip + character (offsets in the furniture's frame, so decorate mode can move the furniture) and is re-solved if the
  cached offset no longer passes. When nothing passed, the furniture changed (never a bone): desk top 0.734, chair seat 0.475 with a 6.5 cm footrest (Mixamo's typist sits
  thighs 41 cm / fingers 67 cm above its floor), sofa cushion 0.385 and a recessed apron (same footprint), the laptop 8 cm nearer the chair.
- **Reading:** `Sitting Idle`; the open book lies on the thighs, found from the thigh vertices. The hands on the knees leave about 14 cm of lap, so the book is a 12.5 x 18 cm
  paperback (15 x 22 only passes the gate with 1.5 cm clearance).
- **Standing:** `findStandSpot()` looks for a floor spot >= 15 cm from furniture over the whole clip, facing the target.
- **Props:** `makeMug()` (8 cm x 9.5 cm, bevelled, handle) and `makeBook()`. `fitGrip()` fits a prop to the hand over a whole clip (6 DOF search, finger penetration <= 0.5 cm,
  upright prior); `attachToHand()` parents it to the hand bone.
- **Debug URL:** `?people=1&pose=desk|sofa|read|window&tod=day|night&t=<s>&cam=close|keys|mug|back|thighs|legs|book|stand|sit-side|...` (`&bare=1` hides the room).
- **LODs:** Egunoff's "LOD man" GLBs hold 3 LODs of every part; `pickLods()` shows the closest and keeps the others hidden in the graph (`P.hiddenLods`).
