# The street: W 123rd St at street level (spec, 10-30)

> **10-31: absorbed into `docs/WORLD.md`** (slices 1–2). The look rules and checks below still apply, but the block is produced by the generic facade grammar, not hand-built.

## 1. The user's words
"the plan was to overall improve the surroundings and be like able to walk around NYC… arrow keys" (10-23).
"walking out to NYC street level" (the order: room → street → people).
"sure get started on both" (10-30, after the inside view shipped).

## 2. Done means (the user checks these)
- From the brownstone I click or walk into the front door, and after a short fade I am **on my stoop at 124 W 123rd St**, behind Hariv. The camera and controls are the same as inside.
- I can walk down the stoop and along **both sidewalks of my block** (Malcolm X Blvd ↔ Adam Clayton Powell Jr Blvd), cross the street, and walk back up my stoop and inside.
- It looks like a real Harlem row-house block: stoops, cornices, iron railings, trees, lamp posts, warm windows at night. It is not boxes with window textures.

## 3. Place and data (all already in the repo, NYC Open Data)
- **The block:**
  - **W 123rd St between Malcolm X Blvd (Lenox Ave, east end) and Adam Clayton Powell Jr Blvd (7th Ave, west end)**, both block faces, plus the four corners.
  - 124 is on the **south side** (even numbers), about a quarter of the way from Lenox. The building is BIN 1057741.
- **Buildings:**
  - real footprints and heights from the city tiles (`city/manhattan/lod0/*.bin`, and `home/home_buildings.bin` for the cleared "year" lots; decode with `mh_tiles.js`)
  - the ground height from `heights.bin` / `terrain.bin`
- **Street:** the centreline and `streetwidth` from `streets.json`. Kerbs and sidewalks are derived from the width; NYC sidewalks here are ≈ 4.5–5 m.
- **Trees:** the real street-tree positions on this block. Use `trees.bin` (a 4-in-10 pick), or fetch the full 2015 census rows for the block once at build time.
- **Frame:** the street grid is shown axis-aligned (`manifest.frame.gridRotationDeg`, ≈ 29°). The street runs along x.

## 4. Look (concrete)
**Style:** match the room: realistic PBR materials, no flat cartoon colours.

**Row houses (most of the block, 3–5 storeys):**
- **Facade per building, chosen from its footprint and height:**
  - brownstone (#6B4A3A–#7A5646, Poly Haven sandstone/brown stone texture) or red/orange brick (#8E4A35–#A55A3E, Poly Haven brick)
  - a limestone trim colour
- **Floors:** 3.4 m parlour / 3.0 m upper.
- **Windows:** 2 or 3 bays per house, tall sash windows (1.0 × 2.0 m) with stone lintels and sills. Glass is dark and reflective by day and warm-lit at night (40–60% lit, seeded).
- **Stoops:**
  - **a stoop on every brownstone**: 8–10 steps rising to the parlour floor (≈ 1.7 m), 1.6 m wide, with brownstone cheek walls or black iron railings
  - a garden-level door under the stoop
  - wrought-iron areaway fences at the sidewalk edge
- **Cornice:** a projecting bracketed cornice at the roofline (0.5–0.7 m deep), in dark painted metal or stone.
- **Front doors:** double wooden doors with a transom.

**Larger buildings (corners and avenues, > 5 storeys):** plain brick walls, a regular window grid and a simple cornice. Ground-floor shopfronts on the avenue corners use a generic awning only; no real business names.

**Street:**
- asphalt (Poly Haven), yellow-free (a residential street), with a faint centre line and crosswalks at both corners
- granite kerb 15 cm
- concrete sidewalk with 1.5 m slab joints
- tree pits with low iron guards

**Props (procedural is fine for these: geometric):**
- NYC lamp posts (dark grey octagonal pole, cobra-head LED) every ≈ 30 m each side, with warm pools of light at night
- fire hydrants
- litter baskets at the corners
- a few garbage cans by the areaways
- street signs at the corners: "W 123 St", "Malcolm X Blvd", "Adam Clayton Powell Jr Blvd"

**Trees (real positions):** CC0 tree models (Poly Haven or Quaternius) scaled 8–14 m, a mix of London plane and honey locust shapes, and seasonal: late October, partly yellow. **No low-poly pyramid trees.**

**Beyond the block:** the avenues and cross streets show the existing city buildings (lod tiles) with distance fog, so there are no hard edges. You can't walk past the corners: invisible walls at the far kerb of each avenue.

**Light:** the same NYC hour as the room (`hourFn`); day sun with shadows on the block only. At night: lamp pools, lit windows and a dark-blue sky.

**Your house:** 124 gets the stoop Hariv uses, its door matches the room's front-door story, and a small brass "124" number by the door.

## 5. Walking and camera
- Reuse `room2_cam.js` (behind the shoulder, drag to look). Outdoors the arm is **3.0 m by default (1.5–5 m)** with no ceiling clamp, and collision against facades, stoops, railings, trees and lamp posts.
- Reuse `room2_walk.js`-style walking, collision and A* on a grid over the sidewalks + roadway. Hariv walks on stoop steps (the ground height follows the step tops; at minimum a ramp-like step-up with feet on treads).
- **Transitions:**
  - **In → out:** the front-door click → 0.4 s fade → Hariv on his stoop landing, facing the street.
  - **Out → in:** walking into his own door, or clicking it → the fade → back inside at the front door.
  - Reduced motion: instant cut.
- **Other doors:** not enterable (a small "Not your place" toast at most).
- **The Today page:** the street is a mode of the same stage. Leaving the Today page or reloading returns you inside.

## 6. Performance
- ≤ 400k triangles, ≤ 220 draw calls; facade windows **instanced**.
- Walking **≥ 55 fps, p95 ≤ 20 ms** at 1512×900 @2x on the user's M1 Pro. **No main-thread task > 100 ms** after the street is shown (build heavy geometry in chunks or cache it).
- The data the street loads: ≤ 15 MB extra, all local, no CDN.

## 7. Quality checks (log + screenshot each)
1. **In → out → in:** the door fade lands on the stoop; walking back in lands inside the front door. Logged and screenshotted.
2. **Walk the block:** both sidewalks end to end plus one crossing. The camera never inside a facade, stoop, tree or lamp (min distance ≥ 0.1 m); Hariv always visible; never outside the walkable area.
3. **The stoop:** walking down and up the 124 stoop, the feet stay on the treads (max float/sink ≤ 5 cm, measured on the rendered skeleton).
4. **Look:** 6 eye-level shots by day (looking east, west, at 124, across the street, the corner at Lenox, the corner at ACP Blvd) + the same 6 by night.
5. **No pyramid trees and no plain boxes** within the block; the beyond-block buildings fade into fog.
6. **Performance** (§6) measured with rAF deltas while walking (W held), plus the longtask count.
7. pytest stays green; `node --check` on all touched JS.

## 8. Non-goals (this build)
- People, pedestrians, cars that move (people in scenes is the next build).
- **Parked cars:** none in the proof. Decide after the proof: CC0 low-poly cars (style mismatch) vs Sketchfab (credits).
- Entering other buildings; the stair hall interior (a fade covers it); other blocks; the subway; weather.
- Real business names or logos.

## 9. Plan (proof first)
1. **Proof (small, 1 Opus agent: it's mostly look):**
   - 124's stoop, the 6 houses around it on the south side, the sidewalk, kerb and road strip, 2 real trees, 1 lamp post
   - the door transition both ways and walking on the stoop
   - checks 1, 3, 4 (3 day + 3 night shots), 6
   - **Stop and show the user.**
2. **The full block (medium: Sonnet for data, collision and A*; Opus for the facade pass):** both sides, the corners, the props, the beyond-block fog, and all §7 checks.
3. **An Opus review**, then report.
