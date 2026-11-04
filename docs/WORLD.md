# The world: walkable Manhattan, built once as a system (plan, 10-31)

## 1. The user's words
- "overall improve the surroundings and be like able to walk around NYC … arrow keys" (10-23)
- "clearly think about how to build the world in the most optimised and rewarding way and structurally accurate/correct" (10-31)

`docs/STREET.md` (one block, hand-built) is **absorbed**: its look rules stay, but the block is now produced by the generic system below. It is slice 2.

## 2. The core decision: build a generator, not places
Hand-building blocks one at a time (STREET.md's approach) costs a full agent run per block and never scales past a few streets. Manhattan already exists in our data:
- **45,182 real buildings**: exact footprints, roof heights and 3-D roof tiers
- per building (tile byte layout, MANHATTAN-DATA.md): **year built, floors, style class** (generic, walkup, rowhouse, prewar_tower, artdeco, modern_tower, postwar_midrise, loft, institution, commercial_low, landmark, garage, utility, supertall_glass), **landmark / historic-district flags**, and a seed
- real **street centrelines with widths**, **street trees**, **ground elevation**, parks, and the 38 neighbourhoods with their level unlocks (`game.DISTRICTS`)

So the world = **true geometry from data** + **appearance from a facade grammar driven by that data**:
- Every block in Manhattan becomes walkable as *data*, not as art.
- Art effort goes into about 8 reusable building styles + a prop kit + a few hand-detailed landmarks.

## 3. Structurally accurate: what is real vs what is by rule
| Thing | Source | Accuracy |
|---|---|---|
| Building footprints, heights, setbacks, floor count, year, style, landmark flag | NYC Open Data (already in the tiles) | **Exact** |
| Ground height, street centrelines and widths, parks | NYC Open Data (already) | **Exact** |
| Sidewalk and kerb edges | derived from street width; upgrade to the NYC **Planimetric** sidewalk/curb layers if the fetch works (build-time only) | exact or ±0.5 m |
| Street trees | 2015 Street Tree Census (positions, species, trunk size) | **Exact positions** |
| Hydrants, subway entrances | NYC DEP hydrants; MTA station entrances (open data, build-time) | Exact |
| Lamp posts, litter baskets, signs | NYC DOT standards by rule (lamps every ≈ 30 m, staggered; signs at every corner) | Typical |
| Facades | **The grammar** (§4), from style + year + floors + frontage | **Typical for that exact building type**, not a photo of it |
| Your building (124 W 123rd), Butler / Low Library, a few landmarks | hand-detailed against reference photos | Recognisable |

**Interior ↔ exterior consistency:**
- Your brownstone's facade has its parlour windows exactly where the room's windows are (x ±1.3 m, sill 0.55 m above the parlour floor, parlour floor at stoop-top height ≈ 1.7 m).
- The building's real footprint width is checked against the room's 5.6 m interior.
- Butler's exterior windows match the reading room's 9 windows.

**What we can't do honestly:** per-building photo-real facades. Google 3D Tiles and Street View are not free, offline or redistributable. The grammar gives "a real Harlem row house of that width, height and age", not "that exact house". Hand-detailing is reserved for places that matter to the user.

## 4. The facade grammar (the heart of it)
**Input per building:** footprint edges, which edges face a street (the existing `front` logic), frontage length, floors, height, year, style, landmark flag, seed.

**The 8 styles** (covering about 90% of Harlem, Morningside and the UWS first):
1. **Brownstone / row house** (rowhouse, pre-1910, 3–5 floors):
   - a stoop to the parlour floor, 2–3 bays
   - stone lintels and sills, a bracketed cornice, an areaway fence
2. **Tenement walk-up** (walkup, 1880–1930, 5–6 floors):
   - brick, **front fire escapes**, 4–6 bays
   - a simple cornice; storefronts on avenues
3. **Pre-war elevator apartment** (prewar_tower, 1900–1945, 6–16 floors):
   - a limestone base, brick body, ornate cornice or parapet, an entrance canopy
4. **Art deco** (artdeco): setbacks (from the real roof tiers), vertical piers, spandrels.
5. **Post-war mid/high-rise / NYCHA** (postwar_midrise/modern_tower, 1945–1980): plain brick, strip windows, no cornice.
6. **Modern glass** (modern_tower, 1980+): a curtain wall with mullion grids.
7. **Institution** (institution): limestone or red brick with a pilaster order (Columbia's McKim, Mead & White look).
8. **Commercial low / loft / garage:** shopfronts with awnings (no real names), roll-down gates, cast-iron lofts.

**Grammar rules:**
- floor heights by style
- bays = frontage ÷ bay width
- the ground floor is a shopfront when PLUTO land use is mixed or commercial on an avenue
- material palette by style + seed (a few PBR textures, tinted per building)
- corners get both facades
- party walls (shared) get none

### 4.1 Detail: the user wants it detailed ("i wanna walk in nyc afterall at the end of the day")
The generator's **near tier (< 60 m) is fully detailed**. Detail comes from **instanced kit parts + shaders**, not unique geometry, so it stays fast.

**Facade depth:**
- window reveals 15–25 cm, 3-D sills and lintels
- string courses, rusticated bases, quoins
- cornices with brackets and dentils, parapets

**Windows:**
- **interior-mapped rooms**: a shader that fakes a room behind each window, with curtains, blinds, a lamp or a bookshelf, lit at night by seed
- **AC units in about 20% of windows**
- security bars on ground floors, the occasional flower box

**Row houses and walk-ups:**
- 3-D stoops with newel posts and railings, areaway fences with trash cans
- doors with transoms and varied colours, building numbers
- **3-D fire escapes** from modules: platforms, ladders, drop ladders

**Storefronts** (avenues and corners):
- glass, frames, awnings with **generic words only** ("DELI GROCERY", "LAUNDROMAT", "PIZZA"; never real names or logos)
- roll-down gates closed at night, blade signs, lit interiors

**Street furniture:**
- lamp posts, **traffic signals** at intersections, street-name and one-way signs
- hydrants, a blue mailbox (no logo), litter baskets, bike hoops, bus shelters on avenues
- **subway entrances** with green globes
- parking meters, manholes, **orange-and-white steam stacks** (rare)
- **sidewalk sheds/scaffolding** on about 5% of buildings
- garbage bags at the kerb at night

**Ground:**
- sidewalk slab joints, granite kerbs
- **corner ramps with yellow tactile pads**, zebra crosswalks
- lane markings, asphalt patches

**Trees:** species-correct shapes from the tree census (London plane, honey locust, pin oak, Callery pear) with the real season's colour.

**Light:** the real sun position for NYC's latitude and date, sky and haze, lamp pools, window and shopfront light spill at night.

**Variation per building seed:** 5–8 brick tints, stone tints, door colours, cornice types, window pane patterns, curtain colours.

**Parked cars** make NYC read as NYC, but free CC0 cars are mostly stylised. This is decided at slice 3: CC0 vs the 4 Sketchfab credits.

## 5. Optimised: how it runs smoothly
- **One engine:** the brownstone and Butler each carry their own copy of the renderer, camera, walker and people code. Refactor them once into `city/world/`:
  - render preset
  - camera rig (`room2_cam`)
  - character controller (the OBB-slide controller from ROOM-V2 §15)
  - people (cast, clips, fit)
  - asset cache
  - perf guard

  Rooms, spots and streets become *scenes* on that engine, so fixing a bug fixes it everywhere and every future place costs less.
- **Build time** (Node, `scripts/world/`, like `scripts/manhattan/`): turn the existing tiles plus the extra layers into **per-block descriptors** (≈ 10–40 KB per block): facades, sidewalks, kerbs, crosswalks and props. All Manhattan ≈ 2,000 blocks ≈ 40 MB in total, but only nearby blocks load.
- **Runtime:**
  - **Streaming:** blocks load in a ring around Hariv (the current block + neighbours, about 250 m).
  - **Geometry is built in a Web Worker** from the descriptors, so there are no main-thread freezes.
  - Built blocks are **cached in IndexedDB**, so a second visit is instant.
- **Instancing everywhere:** windows, sills, lintels, cornice brackets, stoop steps, railings, fire escapes, trees and lamps are InstancedMesh per type. About 10 shared PBR materials plus per-instance tint.
- **Three LOD tiers:**
  - **near (< 80 m):** full 3-D facades
  - **mid (80–300 m):** flat facades with the existing city shader's window grid
  - **far:** the existing city tiles + fog
- **Budgets:** ≤ 1M triangles and ≤ 250 draw calls on screen; ≥ 55 fps, p95 ≤ 20 ms on the M1 Pro; no task > 100 ms; ≤ 60 MB of memory for streamed blocks.

## 6. Rewarding: why walking is worth it (and not a distraction trap)
1. **Territory = progress.**
   - Walkable streets follow the existing district unlocks: Morningside (L1–2) and Harlem (L3–4) first, then the UWS, Central Park and so on.
   - A locked district's streets stay in soft fog with a gentle edge: "Unlocks at Level 5".
   - Levelling up means *new streets to walk*.
2. **Your towers, at street level.** The "year of lots" already builds one tower per honest focus day on real Morningside lots, 7 touching lots per week. Walking down the street of *your* weeks and looking up at what your hours built is the most personal reward in the app.
3. **Places with purpose.**
   - Study spots are real doors: walk into Butler and the focus scene opens there; the café on Amsterdam, the rooftop and so on as they unlock.
   - Home is a real door.
   - **The subway** is fast travel: walk into an entrance, fade, and come out at another unlocked station. It's real NYC and saves walking 2 km.
4. **Discoveries:** landmarks (LPC flags) show a small card the first time you pass them (the Apollo, the Marcus Garvey Park watchtower, the Columbia gates, Grant's Tomb). It's a collection, not XP, so there's no grinding.
5. **Life reflects you:** street life (pedestrians, lit windows, buskers later) grows with your streak; the real weather and NYC time apply.
6. **Honest by design** (the user is distractible):
   - Walking earns nothing. Studying earns everything.
   - Optionally, the world opens only during breaks and after a block (§9 decision).

## 7. Build order (proof first; each slice stops and shows the user)
| # | Slice | Size, models | Shows |
|---|---|---|---|
| 0 | **Engine refactor** into `city/world/` (room2 + butler2 on the shared core, no visible change) + the OBB controller | small–medium, Sonnet | the same screens, all checks green |
| 1 | **Data pipeline + the grammar for styles 1–3**, previewed on **your block from a fixed camera** | medium, Sonnet (pipeline) + Opus (facades) | your block from the street, day and night |
| 2 | **Walk out of your door** onto that block (STREET.md's look rules and checks) | small, Sonnet | the stoop, both sidewalks, back inside |
| 3 | **Streaming + LOD + Harlem:** walk the blocks around home to 125th St; the subway entrance at 125th & Lenox | medium, Sonnet + Opus review | a walk from home to 125th |
| 4 | **Columbia:** styles 7–8, Butler + Low Library hand-detailed, the Butler door → focus scene | medium, Opus | College Walk, Butler's door |
| 5 | **Subway fast travel** between unlocked stations | small, Sonnet | 125th → 116th–Columbia |
| 6 | **Pedestrians** from the cast, sidewalk lanes, density by hour and streak | medium, Sonnet + Opus | a lively 125th St |
| 7+ | **Every other district = data**, plus style 4–6 polish and hand-detailed landmarks over time | small each | — |

## 8. Quality checks (applied to every slice)
- **Structural:**
  - Footprints match the data within 0.1 m.
  - Heights within one floor.
  - Every sidewalk is walkable, and kerbs are continuous at crosswalks.
  - No facade on party walls.
  - Your building's windows line up with the room's.
- **Look:** side-by-side with reference photos for the anchor places (the user's Street View screenshots of their block, Butler and Columbia).
- **Feel:**
  - keyboard-only walks with 0 stuck, 0 jitter and 0 inside-solid frames (ROOM-V2 §15 metrics)
  - door transitions both ways
- **Perf:** §5 budgets measured on the **real page the user opens** (rAF deltas plus long tasks), never only a debug URL.

## 9. Decisions (the user, 10-31)
1. **The generator, and detailed** ("can we make the generator to be detailed, i wanna walk in nyc afterall"); see §4.1.
2. **Subway fast travel: yes.**
3. **The distraction guard:** the streets are walkable **during breaks and after a finished block**. Home and Butler are always open. Outside those times the front door shows a gentle "The street opens on your next break" card.
4. Still wanted: **Street View screenshots** of your block (both sides), 125th St at Lenox, and College Walk / Butler's front (reference only; save them to `build/ref/street/`).

## 9a. The original questions
1. Approve the generator approach (§2).
2. **Subway fast travel:** yes or no.
3. **Distraction guard:** the world is always open, or open only during breaks and after a block.
4. **Reference screenshots** (Google Street View) of: your block (both sides), 125th St at Lenox, and College Walk / Butler's front. These are used only to check the grammar, never shipped.

## 10. Slice 0 spec: the shared engine (no visible change)
**Why:** `room2.js` / `room2_walk.js` / `room2_cam.js` and `spots/butler2.js` each carry their own renderer setup, frame loop, texture loading, camera wiring, people loading and fit-plan caching. Every street slice would add a third copy.

**New folder `epoch/web/static/app/city/world/`:**
- **`render.js`:**
  - WebGL2 renderer creation (tone mapping, exposure, shadows, PMREM RoomEnvironment), resize
  - **the frame loop**, with the never-queue-two-rAF guard (ROOM-V2 perf fix), the visibility pause and `kick()`
  - under `?debug=1`, the perf probe: rAF-delta stats (fps, p50, p95, max) and a longtask observer
- **`textures.js`:** a shared Poly Haven PBR loader and cache (sRGB and repeat handling as `room2.js` does today).
- **`cam.js`:** the spring-arm rig (today's `room2_cam.js`). `room2_cam.js` stays as a one-line re-export so nothing else breaks.
- **`controller.js`:** the character controller from `room2_walk.js`, made generic over a collision world.
  - `{ obbs: [{x, z, hw, hd, ry}], circles: [{x, z, r}], bounds, walls }`
  - camera-relative WASD/arrows, sliding, ±35° steering, depenetration, honest clip speed
  - the streets will feed it per-block colliders later
- **`people.js`:** one place to load the cast, clips and the fit-plan cache. **The fit solve runs in a Web Worker:** the cloud sampling stays on the main thread; the solve is pure array math transferred as Float32Arrays. This removes the 1–2.8 s cold-load freezes in the room and in Butler.

`room2*.js` and `butler2*.js` are rebuilt on these modules; their duplicate code is deleted.

**Acceptance (no visible change):**
1. **Pixel diff:** 4 fixed views (room Overview, room Inside, Butler day on `/pomodoro`, Butler night) before vs after: `magick compare -metric RMSE` ≤ 2% (people's animation phase frozen with the same `tod` and look).
2. **Walking** (ROOM-V2 §15.3): the same tours with 0 stuck, 0 jitter and 0 inside-solid frames; the wall-hug and wedge tests pass.
3. **Butler** (BUTLER-V2 §8): the same fit results (10/11), the sweep has 0 bad poses, a break works, and the World pin shows.
4. **Smoothness:** **no main-thread task > 100 ms on a cold first load** (empty localStorage) of Today and of `/pomodoro`; walking ≥ 55 fps, p95 ≤ 20 ms.
5. **Code:** report lines before/after for the touched files (expect a net reduction); `node --check` clean; pytest 1406 passed.
6. Every check is run on the **real pages** (`/` Today and `/pomodoro`), not only debug URLs.

## 11. Research 10-31: the accuracy sources (the user: "make sure the streets … are as accurate as possible like I am walking in New York")
All files are in `build/ref/street/` with `SOURCES.md`. They are **reference only**.

### 11.1 What we found
- **The user's block is in an official historic district.** W 123rd St is in the *Mount Morris Park Historic District Extension* (LPC designation report LP-2571, 2015, 247 pages).
  - It has a **structured entry for every building**: date, architect, type, style, stories, materials, special windows, ironwork, stoop, door, windows, cornice, roof, areaway, alterations.
  - The south side (102–168) is covered entirely; on the north side, 107–111.
  - It also has 2015 photos (figures 1–17), including **124–128 W 123rd St: the user's house**.
- **The user's house, 124 W 123rd St** (Block 1907, Lot 46, BIN 1057741):
  - c.1870, Abraham Slater, **Second Empire row house**, 3 stories + basement
  - **red brick facade over a brownstone base**, a brownstone stoop with **cast-iron newels and railings**, a wood-and-glass double door with a molded brownstone lintel
  - an incised spandrel under the parlour windows, a **bracketed cornice**, then a **slate mansard roof with arched dormers and angled pediments**, a wood cornice and a brick chimney
  - faces **north**; a cast-iron areaway fence
  - It is **brick, not brownstone**. The 3 twins are 124–128.
- **PLUTO** gives real dimensions per lot (Socrata API, free, no key; build-time): `lotfront`, `bldgfront`, `bldgdepth`, floors, year, class.
  - 124: **lot 16.67 ft (5.08 m); building 17 × 48 ft (5.18 × 14.6 m)**.
  - **South side:** 1870–1890 row houses, 14–20 ft wide, 3–4 floors, with 118–122 a 9-floor white 1914 apartment house.
  - **North side:** 107–111 1889 Neo-Grec brownstones; 1910 6–7-floor apartment houses (D1/D4) at 137, 139, 151 and 157; 2006–2012 condos (8 floors) at 117 and 129; and **a 75-ft 1898 church at 147** (class M1).

### 11.2 What it changes
1. **A per-building truth layer** (build-time, deterministic): for every building in an LPC historic district on a walkable street, **parse the designation report** into attributes:
   - style, stories, material, stoop, bays (from frontage), cornice, roof (mansard, dormers), bays/oriels, door type, ironwork
   - The format is regular ("Style:", "Stories:", "Material(s):", "Stoop:", "Cornice:", "Roof:", "Notable Roof Features:" …), so a parser script (`scripts/world/lpc_parse.py`) can do it. No AI guessing.
   - Harlem and Morningside have several districts: Mount Morris Park + Extension, St. Nicholas (Strivers' Row), Central Harlem W 130–132 Sts, Hamilton Heights / Sugar Hill, **Morningside Heights (around Columbia, where the user's tower lots are)**.
   - **These attributes override the grammar's guesses.**
2. **Outside districts:** the grammar uses PLUTO class + year + floors + real frontage. Add **style 9: church** (M classes; Harlem has many), Romanesque/Gothic by year.
3. **Bays come from real frontage:** a 16–17 ft row house = **3 bays** (door + 2 windows on the parlour floor, 3 windows above), matching the photo.
4. **Photos** (LPC figures, Wikimedia Commons) are for the **look check** of anchor places: the user's block, 125th & Lenox, College Walk / Butler / Low.

### 11.3 A conflict to decide: the brownstone room is wider than the real house
- Our room is **5.6 m wide × 11.2 m deep**.
- The real building is **5.18 m wide outside**. Minus party walls, that's ≈ 4.6 m inside. In a parlour floor-through, the stair hall takes one bay (≈ 1.2 m) along the front, so the real **front parlour is ≈ 3.4 m wide with 2 windows**, and the floor is ≈ 14 m deep.
- **Option A, accurate:** rebuild the room to the real plan, ≈ 3.4–4.6 m wide × 14 m deep, with the 2 parlour windows matching the facade.
  - Realistic NYC tightness.
  - The furniture and walk routes must be re-fitted (ROOM-V2 §15 rules still apply).
- **Option B, keep it "bigger on the inside":** a game convention. The door fade hides it, but the facade's 2 windows won't match the room's proportions.

## 12. Slice 1 spec: the pipeline + the facade kit, previewed on the user's block (W 123rd St, Lenox ↔ ACP, both faces)
### 12.1 Build time (`scripts/world/`, deterministic; raw downloads cached under `build/world-raw/`, never shipped)
- **`pluto.py`:** fetch the PLUTO columns `bbl, address, lotfront, lotdepth, bldgfront, bldgdepth, numfloors, yearbuilt, bldgclass, landuse, histdist` for Manhattan. Use the Socrata API (`data.cityofnewyork.us/resource/64uk-42ks.json`), paged, no key. Output: compact JSON keyed by BBL.
- **`lpc_parse.py`:** pdftotext an LPC designation report into per-address records with these fields:
  - `type, style, stories, materials, stoop, door, cornice, roof, roof_features, special_windows, metalwork, areaway`
  - keyword flags: `mansard, dormers, angled_bay, oriel, bracketed_cornice, denticulated, rusticated_base, fire_escape, storefront`
  - Start with LP-2571 (`build/ref/street/lpc/report.txt`). Match each address to its BBL through PLUTO.
  - **Unit-test it on 124, 107 and 102 W 123rd.** For example, 124 must give Second Empire, brick + brownstone, stoop, bracketed cornice, slate mansard and arched dormers.
- **`blocks.mjs`:** for the slice-1 area, emit **one descriptor file per block face** to `epoch/web/static/app/city/world/data/<blockface>.json` (≤ 40 KB).
  - **Per building:** BIN, BBL, footprint (from the city tiles, including `home/home_buildings.bin`), street-facing edges, frontage (m), floors, height (data), year, `style` (the LPC override, else from PLUTO class/year/floors), `bays` (from frontage: a 14–20 ft row house = 3), `stoop`, `cornice`, `roof` (flat / mansard + dormer count), material palette and seed.
  - **Street:** the centreline and width, kerb and sidewalk polygons (width from data, ≈ 4.6 m on W 123rd), crosswalks at both avenues.
  - **Props:** trees (census positions and species), hydrants (NYC Open Data hydrant layer if found, else 1 per ≈ 75 m by rule), lamps (NYC rule: ≈ 30 m, staggered), corner signs.

### 12.2 Runtime (`epoch/web/static/app/city/world/street.js` on the slice-0 engine; geometry built in a Web Worker)
**Styles for slice 1** (the ones on this block):
- (a) **Neo-Grec / Italianate brownstone row house:** angled bays, a rusticated base, a stoop with newels, bracketed hoods, a denticulated cornice
- (b) **Second Empire brick row house:** a brownstone base, a stoop with cast-iron railings, a bracketed cornice, a **slate mansard with arched dormers** (124–128)
- (c) **Pre-war apartment house**, 6–9 floors: a limestone or white-brick base, a regular window grid, a cornice; a fire escape on 1910 walk-ups (D1)
- (d) **2000s condo:** brick + metal panels, large windows, no cornice
- (e) **Church** (147): a Romanesque/Gothic front, a rose window or arched openings, a gable or tower by frontage

**Detail kit (§4.1), near tier:**
- window reveals, sills and lintels as instances, **interior-mapped windows**, AC units
- stoops, railings, areaway fences, doors with transoms, fire escapes, trees, lamps, hydrants
- kerb, sidewalk joints, asphalt, crosswalks

### 12.3 Preview (no walking yet; that is slice 2)
`?street=preview` on the Today page renders the block from **fixed photographer cameras** on the opposite sidewalk, matching the LPC photos:
- Figure 2 (**124–128**)
- Figure 1 (107–111)
- Figure 14 (118–122)
- plus looking east to Lenox and west to ACP

Each at day and night.

### 12.4 Checks
1. **The parser** unit tests pass (124, 107, 102).
2. **Geometry:** each building's footprint matches the tiles within 0.1 m; height within one floor; party walls have no facade.
3. **Side-by-side with the LPC photos:**
   - 124–128 show **3 bays each, a stoop on the east side, a bracketed cornice, a slate mansard with 2 arched dormers each, red brick over a brownstone base**
   - 107–111 show brownstone, angled bays and stoops
   - 118–122 shows a 9-floor white apartment house
4. **The church** at 147 and **the condos** at 117 and 129 read as their types.
5. **Perf:** the block builds in a Worker with **no main-thread task > 100 ms**; ≤ 1M triangles, ≤ 250 draw calls, ≥ 55 fps on the preview cameras.
6. pytest green, plus new Python tests for the parser and PLUTO join; `node --check`.

### 12.5 Run plan (medium; after slice 0)
1. **Sonnet:** §12.1 + the worker + collision-ready geometry + the kit framework.
2. **Opus:** the facade look of styles (a)–(e) and the photo side-by-sides.

It can run in parallel with ROOM-V2 §16 (different files).

## 13. Slice 2 spec: walk out of your door onto W 123rd St (the user said "yes", 10-31)
**Look rules:** `docs/STREET.md` §4, plus slice 1's kit. **Rules:** ROOM-V2 §14 (camera) and §15 (walking feel). **Engine:** `city/world/*`.

### 13.1 The transition (true to the real house)
- **In → out:**
  1. Clicking the apartment's entrance door (middle room, east wall), or walking into it, opens it (0.4 s).
  2. A **0.4 s fade**: the stair-hall interior is a non-goal.
  3. Hariv appears **on 124's stoop landing**, outside the building's front door (the east door bay), facing the street (north). The camera is behind him.
- **Out → in:** walking into 124's front door, or clicking it → fade → inside at the apartment door, facing into the middle room.
- **Other doors:** they don't open; a small toast "Not your place".
- Reduced motion: cuts. A reload always starts inside.

### 13.2 The street mode (the slice-1 generator, now walkable)
- **Walkable area:**
  - both sidewalks of W 123rd from the Malcolm X Blvd kerb to the Adam Clayton Powell Jr Blvd kerb
  - the roadway (no traffic yet)
  - both corner crosswalks
  - the four corner sidewalks out to the avenue kerbs
  - **Invisible walls** at the far side of each avenue's roadway and along building fronts.
- **Ground height** `groundAt(x, z)`: roadway 0, sidewalk +0.15 (the kerb is a step up or down, eased over 0.25 m), **stoop treads** (from the stoop geometry; feet on treads within 5 cm), areaways not walkable.
- **Colliders** (from the descriptors, fed to `world/controller.js`):
  - building fronts and corners
  - areaway fences, stoop cheek walls and railings
  - tree trunks and guards
  - lamp posts, hydrants, sign posts
  - the parked-car slots (empty for now)
- **Camera:** the room's spring arm, outdoors. The arm defaults to 3.0 m (1.5–5.0), pitch −30…+35°, colliding with facades, trees and lamps. Drag to look; W walks where you look; Shift runs.
- **What you see past the block** (no hard edges):
  - the facing facades on both avenues and the corner buildings' avenue facades at the **mid tier** (flat facades with the window shader, real heights and footprints)
  - the existing city tiles + fog beyond
- **Light and time:** the same NYC clock and sun as slice 1; lamps and lit windows at night.

### 13.3 The focus guard (the user's choice: breaks + after a finished block)
- The street is open when **a run is in its break phase**, or **within 30 minutes after a block finishes** (until the next block starts).
- Otherwise the apartment door shows a card: **"The street opens on your next break."** with a small "Start studying" link.
- Home and Butler are always open.
- Read the run state the way the Today page already does (`/api/pomodoro` / the app state). **No server change.** `?street=open` overrides it for testing (debug only).

### 13.4 Checks (log + screenshot; on the real Today page)
1. **In → out → in** with the guard open; the guard-closed card when no break.
2. **Keyboard-only walk:** both sidewalks end to end, one crossing, up and down the 124 stoop:
   - 0 stuck, 0 jitter and 0 inside-solid frames (ROOM-V2 §15 metrics)
   - the camera never inside a facade, tree or lamp (min 0.1 m)
   - Hariv always visible
3. **The stoop:** feet stay on the treads within 5 cm (live skeleton).
4. **Look:** 6 eye-level shots by day (east, west, at 124, across, both corners) + 2 by night.
5. **Perf:** walking ≥ 55 fps and p95 ≤ 20 ms (with the adaptive DPR), no main-thread task > 100 ms during the transition (pre-build the street while the fade runs, or during the guard check).
6. The room, Butler and the slice-1 preview are unchanged; pytest green; `node --check`.

### 13.5 Run plan (medium)
1. **Sonnet:** §13.1–13.3 and the checks.
2. **Opus:** an eye-level look and walk-feel review with fixes.

## 14. Slice 3 spec: Harlem around home, walkable, streaming (the user: "YESSSS HARLEM THEN COLUMBIA", 11-01)
### 14.1 The area (one connected walkable piece)
**W 120th → W 126th St, from Fifth Ave / Marcus Garvey Park (east) to Frederick Douglass Blvd (west).** That's about 6 streets × 3 avenue blocks, including:
- **the user's block** (slices 1–2), unchanged
- **125th St**, Harlem's main street, from Fifth Ave to Frederick Douglass Blvd:
  - **the Apollo Theater** (253 W 125th)
  - **Hotel Theresa** (ACP & 125th, white terracotta)
  - **the Adam Clayton Powell Jr. State Office Building** (125th & ACP)
  - storefronts all along
- **the subway entrance at 125th & Lenox** (the 2/3), with green globes and stairs. Decorative now; it becomes fast travel in slice 5.
- **Marcus Garvey Park's west edge** (Mount Morris Park West) with the **Harlem Fire Watchtower** visible on the hill: the park is the boundary; its paths are walkable to the watchtower if cheap.
- **Lenox Ave / Malcolm X Blvd** and **ACP Blvd** become near-tier: real facades, not boxes.
- Past the area: the mid tier, then city tiles + fog. Edge streets end at a soft barrier ("Unlocks with more of Harlem").

### 14.2 Accuracy (the same layered truth as §11)
1. Footprints, heights, floors and year from the tiles + PLUTO (all lots in the area).
2. **LPC reports:**
   - the Mount Morris Park HD (1971, LP-0452) + Extension (2015, LP-2571, already parsed)
   - individual landmark reports for **the Apollo, Hotel Theresa, the Harlem Fire Watchtower** and any others in the area (fetch the PDFs from `s-media.nyc.gov/agencies/lpc/lp/<n>.pdf`)
   - Extend `lpc_parse.py` for the 1971 report's older format; **fall back to the grammar** where it can't parse, and log coverage.
3. **New grammar styles:**
   - **125th St commercial:** shopfront ground floors with awnings, generic words only, roll-down gates at night; upper floors as walk-up or loft
   - **avenue tenements** with fire escapes
   - **NYCHA / post-war towers** where PLUTO says so
4. **Hand-detailed landmarks**, from reference photos (Wikimedia Commons / LPC, reference only):
   - **the Apollo:** the marquee and the vertical sign. **Landmark signage is allowed for LPC-designated landmarks only**; chains and other shops stay generic.
   - Hotel Theresa
   - the State Office Building
   - the Fire Watchtower

### 14.3 Engine (WORLD §5, now for real)
- **Streaming by block face** in a ring about 250 m around Hariv; descriptors per block face; geometry in the worker; **built blocks cached in IndexedDB**.
- **Near / mid / far tiers** with no pop: crossfade or dither, about 1 s.
- **The walk controller** works across block faces: ground heights (kerbs, the slight hill toward the park), colliders per block face, the camera rig.
- **Parked cars** (the slice-2 kit) on every street per the NYC rules (hydrants, crosswalks, bus stops on avenues).
- **Detail kit:**
  - avenue bus stops (shelter, no ads)
  - subway entrance
  - traffic and pedestrian signals at every intersection
  - more street-tree species from the census
  - scaffolding sheds on about 5% of buildings

### 14.4 Checks (on the real Today page, `?street=open`)
1. **Keyboard-only walks:**
   - home → 125th & Lenox → west along 125th to the Apollo → back via ACP → home
   - home → Mount Morris Park West
   - **0 stuck, 0 jitter, 0 inside-solid**; camera clearance ≥ 0.1 m
2. **Streaming:**
   - no main-thread task > 100 ms while walking at running speed through the whole area
   - **no visible pop-in** within 60 m (log the tier changes vs distance)
   - IndexedDB caching works: a second visit is instant
3. **Structural:**
   - footprints match the tiles
   - floors match PLUTO
   - LPC overrides applied (coverage %)
   - landmarks present and correct
4. **Look:** side-by-sides with reference photos for 125th & Lenox, the Apollo, Hotel Theresa and the user's block (unchanged).
5. **Perf:** walking ≥ 55 fps, p95 ≤ 20 ms (adaptive DPR allowed); ≤ 1.5M triangles, ≤ 300 draw calls in view; memory for streamed blocks ≤ 150 MB.
6. The room, Butler and slice 2 unchanged; pytest green.

### 14.5 Run plan (medium–large; proof first)
1. **Sonnet:** the pipeline for the whole area + streaming + caching + the new styles (structural) + the 125th & Lenox subway entrance. Proof stop: **walk home → 125th & Lenox**, with shots.
2. **Opus:** the 125th St look + the landmark details (Apollo, Theresa, State Office Building, Watchtower) + the side-by-sides.
3. **Sonnet:** the rest of the area + all §14.4 checks.

## 15. Slice 4 outline: Columbia (detailed spec written before the run)
- **Area:** College Walk (W 116th, Broadway ↔ Amsterdam), the South Lawn, **Low Library** (steps, dome), **Butler Library's** front (columns, names frieze), the campus lawns and walks between them, the Broadway and Amsterdam gates, and **the 116 St–Columbia University station** entrance (the 1 train).
- **Accuracy sources:**
  - the Morningside Heights HD report (LPC 2017) and the Low Library individual landmark report
  - PLUTO + tiles (campus buildings)
  - Commons photos (already in `build/ref/street/commons/`: Butler front, the South Lawn)
- **The rewarding link:** **during a Butler focus run's break, walk out of Butler's front door onto the South Lawn**, and walk back in to resume. **Home ↔ campus** arrives with slice 5 (the subway: 125 St ↔ 116 St–Columbia).
- **Butler's interior stays as it is** (v2); its exterior door is the hand-off.

## 16. Slice 4 spec: Columbia's Morningside campus, walkable (the user: "I'D LOVE TO WALK AROUND MY CAMPUS", 11-01)

### 16.1 Done means (the user checks these)
- **Any time I'm not mid focus block** (idle, a break, a paused block) on the Focus page, I click Butler's reading-room doorway (`butler2_hall.js` `DOOR`). After a 0.4 s fade I am **outside, at the top of Butler's front steps, under the 14-column colonnade, looking north across South Field to Low Library's dome.** The camera and controls are the same as at home.
- I can walk:
  - down the steps and up the central walk of South Field
  - across College Walk, past the sundial pedestal
  - up Low's steps, past Alma Mater (§16.6), onto the upper terrace
  - around Low, out through the Broadway and Amsterdam gates to the sidewalk
- **Walking back into Butler's door** puts me back in my reading-room seat.
- **At break end:**
  - 60 s before the end, a toast: "Break ends in 1 min — head back to Butler".
  - At zero: the fade back inside, and the block starts normally.
  - The timer is never delayed by being outside.
- It looks like Columbia: red brick in Flemish bond, limestone trim, green copper roofs, Low's grey dome, Butler's names frieze, the lawns, and the College Walk trees.

### 16.2 Area (one connected walkable piece)
- **The campus superblock:** W 114th (south) → W 120th (north), Broadway (west) → Amsterdam Ave (east).
- **Walkable:**
  - College Walk (the old W 116th, pedestrian since 1953) from gate to gate
  - South Field: lawns and paths, with grass walkable
  - Low Plaza and Low's steps, and the upper terrace around Low
  - the paths between the upper-campus buildings
  - the Broadway sidewalk from 114th to 120th, including the **116 St–Columbia University (1)** subway entrances, which are decorative until slice 5
- **Not enterable:** every building except Butler. A small toast "Closed — your seat is in Butler" at most.
- **Beyond:** a mid tier for the surrounding blocks (Barnard across Broadway, the Amsterdam side), then tiles and fog. The soft barrier at the area's edge says "Unlocks with more of Morningside".

### 16.3 Layout (from the Low Library and Butler articles + the McKim plan; verify every position against tiles/footprints and reference photos)
**Levels:**
- **College Walk** = the old 116th St grade = 0.
- **The upper terrace** (Low's base) is about **+5.2 m**: Low's dome top is 135 ft above the terrace and 152 ft above old-116th grade.
- **South Field** is about level with College Walk; Butler's steps rise to its colonnade.
- Use real elevations from `heights.bin` / `terrain.bin` where they resolve it.

**Low Memorial Library** (McKim, Mead & White, 1895–97):
- Plan: a Greek cross with bevelled corners, 59 m maximum across, aligned to the street grid.
- Height: walls 30 m above the terrace; the arms' roofs about 21 m.
- **The dome:** radius 16 m, top 41 m above the terrace, limestone-clad, grey.
- Materials: a 3.7 m granite base, limestone above.
- **Portico:** 10 Ionic columns, 10.7 m tall and 1.2 m in diameter. The frieze reads "LIBRARY OF COLUMBIA UNIVERSITY", with the long dedication inscription in the attic above.
- Windows: half-round thermal windows on the arms, about 13–15 m wide and 6.7 m tall.

**Low steps:**
- The lower flight runs from the South Court (the plaza north of College Walk) to an intermediate landing, about 99 m wide.
- The upper flight runs from the landing to the terrace, about 26 m wide at the portico.
- **Alma Mater** sits on the landing of the narrower flight, centred.
- 22–26 steps in all; use 0.15 m risers and 0.40 m treads.

**Butler Library** (James Gamble Rogers, 1931–34):
- At the south end of South Field, facing Low across College Walk.
- **A limestone front with a 3-storey colonnade of 14 Ionic columns.**
- **The frieze above the colonnade:** the names of European writers and thinkers. Read the exact list and order off the reference photos (expected: HOMER · HERODOTUS · SOPHOCLES · PLATO · ARISTOTLE · DEMOSTHENES · CICERO · VERGIL).
- **Panels lower on the front:** American writers and statesmen.
- **Side wings:** brick in Flemish bond with limestone trim.
- Copper lanterns and cast-iron marquees at the doors.
- The building reads as about 6 storeys from the front, with the stack core behind; use the tile height.

**Around Low Plaza and the upper campus:**
- **East:** St. Paul's Chapel (brick, with a Guastavino tile dome), Philosophy Hall (with The Thinker in front; the statue is a §16.6 decision), Kent Hall (by the Amsterdam gate), Avery Hall, Fayerweather, Schermerhorn.
- **West:** Dodge Hall (by the Broadway gate), Lewisohn Hall, Earl Hall (small, domed), Havemeyer, Mathematics, Pupin (NW).
- **North:** Uris Hall (post-war; plain).

**Around South Field:**
- **East:** Hamilton Hall (on College Walk at Amsterdam), Hartley, Wallach, John Jay (SE corner).
- **West:** Pulitzer Hall / Journalism (on College Walk at Broadway), Furnald, and Lerner Hall at the SW corner (glass and steel ramps; modern).

**On College Walk:**
- the gates at Broadway and Amsterdam (brick and limestone piers with lanterns)
- **the sundial**: a granite pedestal only, on the walk's centreline opposite Low's steps
- rows of trees along both sides, and lamp posts in the campus style (a black post with a lantern head)

### 16.4 Accuracy layers (as §11 and §14.2)
1. **Footprints and heights from the city tiles.** The campus is one huge PLUTO lot, so per-building truth comes from the footprints, not PLUTO.
2. **A building table** `scripts/world/campus.json`, written by hand from the references and the plan. One row per building:
   - name and footprint id
   - style: `mckim` (brick + limestone + copper hip roof), `classical` (all limestone: Low, Butler), `chapel`, `postwar` or `modern`
   - storeys, roof type, notes
   - every row cites its source
3. **The LPC reports:** Low Library (an individual landmark, exterior and interior) and St. Paul's Chapel, fetched to `build/world-raw/lpc/`. The 2017 Morningside Heights HD mostly excludes the campus; use it for the Broadway frontage only.
4. **Reference photos** in `build/ref/columbia/` + `SOURCES.md`, from Wikimedia Commons only. Butler and South Lawn photos already exist in `build/ref/street/commons/`. They are reference only and are never shipped.

### 16.5 Look (concrete)
**The `mckim` grammar** (most buildings):
- red-brown brick #7E3B2A–#93503A in **Flemish bond** (a Poly Haven brick, re-tinted)
- a rusticated limestone ground floor (#CFC6B4)
- limestone window surrounds, quoins and string courses
- a modillioned limestone cornice
- a **green copper hipped roof** (#5E8C7A–#6E9E8B, with a slight verdigris variation) with dormers
- windows: tall 6-over-6 sash in a regular grid; 3.6 m ground floor and 3.2 m upper floors

**`classical`** (Low, Butler): all limestone, the orders as specified in §16.3, entablatures, and lettering cut into the frieze (a dark recessed-groove texture, not floating text).

**Ground:**
- South Field lawns in two big grass panels, with **brick-paved** walks in a herringbone pattern and granite kerbs
- College Walk paved in brick, with a granite centre band
- Low Plaza in a brick/granite pattern

**Trees:**
- Use EZ-Tree (already vendored), as **London plane** (College Walk) and **elm/oak** (South Field edges).
- Late-autumn colour, matching Harlem.

**Night:**
- warm lantern pools, lit windows (Butler's reading rooms bright)
- a soft floodlight on Low's dome and portico; Butler's frieze lit from below

**Signage:** the frieze inscriptions are architecture, so they are allowed. No logos and no modern banners.

### 16.6 Organic pieces: decisions for the user before the run
- **Alma Mater** (a seated bronze woman) and **The Thinker**: organic, so by project rule they are never built from primitives. The options:
  - (a) a scanned CC0 or CC-BY model if one exists on Commons/Sketchfab as a free download. Check the licence; Sketchfab credits only if needed (**2 left**).
  - (b) the bronze statue's **pedestal and chair base only**, with a "statue away for conservation" plaque. ₹0, honest.
  - (c) skip The Thinker; Alma Mater per (a) or (b).
  - **The recommendation: (a) if a free licensed scan exists, otherwise (b).**
- **No people** (slice 6). The Butler students stay inside.

### 16.7 Engine (reuse; nothing new unless needed)
- **`district.js` streaming** with a second dataset `world/data/c/` (campus units by quad: South Field, College Walk, Low Plaza and the terrace, the upper-campus quads, the Broadway sidewalk), with the same tiers, crossfade, IndexedDB cache and controller.
- **Steps:** Low's two flights and Butler's steps use stepped ground height with the stoop IK from slice 2 (feet on the treads).
- **The hand-off** goes in a new `world/campus_door.js`, mirroring `outside.js`:
  - Butler v2's `DOOR` click → guard → fade → campus. The return works the same way.
  - The campus is built in idle time **only when the guard is open** (never during a running block), so a focus block never pays for it.
- **The guard (the user, 11-01: "available anytime except when I am studying aka focus timer running"):** it reuses `evalGuard` from `outside.js`. The campus is closed only while `run.phase === 'work' && run.status === 'running'`; the door then says "You are mid focus block. Campus opens when it ends." If a break ends (or a block starts) while you are outside: a toast 60 s before, then the automatic return, per §16.1.
- **The Focus page** keeps its construction PiP running. The campus pauses the Butler interior render while outside.

### 16.8 Checks (on the real Focus page `/pomodoro`, during a real break state from a scratch DB)
1. **The hand-off:**
   - door → campus → door: lands at the Butler steps, then back in the seat
   - a break ending while outside returns you automatically
   - while the focus timer is running, the door is refused; idle or paused it opens
2. **Keyboard-only walks:**
   - (a) Butler steps → South Field → College Walk → Low steps → Alma Mater → the terrace around Low → back
   - (b) College Walk gate to gate → the Broadway sidewalk to the 116 St entrance
   - Requirements:
     - 0 stuck, 0 inside-solid; camera clearance ≥ 0.1 m
     - camera jumps counted outside scripted turns (steer ≤ 6°/frame)
     - feet on Low's treads ≤ 5 cm float/sink
3. **Structural:**
   - footprints vs tiles: max offset
   - Low: 10 columns, dome radius 16 m ± 1, top +41 m ± 2 above the terrace
   - Butler: 14 columns
   - terrace level +5.2 m ± 0.5
   - the building table cited
4. **Look:** side-by-sides with the reference photos for:
   - Low from College Walk
   - Low's steps with Alma Mater
   - Butler from South Field
   - College Walk at the Broadway gate
   - a `mckim` building (Hamilton or Philosophy)
   - Low at night
5. **Perf:**
   - walking ≥ 55 fps, p95 ≤ 20 ms
   - no task over 100 ms while walking
   - ≤ 1.5M triangles, ≤ 300 draw calls; the Focus page's PiP is included in the frame
6. **Nothing else changed:**
   - the Butler interior, the room, and Harlem
   - pytest green

### 16.9 Non-goals
- building interiors other than Butler's existing room
- Barnard detail
- people or students outside (slice 6)
- the subway ride (slice 5)
- Commencement or event dressing
- weather

### 16.10 Run plan (medium–large, the same shape as Harlem)
1. **Sonnet:**
   - the building table + `world/data/c/`
   - the `mckim` and `classical` grammars (structural)
   - terrain levels and steps, the hand-off, the guard
   - **Proof stop:** a break → Butler door → walk to Low's steps → back, with shots.
2. **Opus:**
   - Low (the dome, the portico, the frieze lettering, the steps)
   - Butler's front (14 columns, the names frieze)
   - St. Paul's Chapel, the gates, the sundial, College Walk trees and lanterns
   - Alma Mater per §16.6
   - the side-by-sides
3. **Sonnet:** the rest of the campus + the Broadway sidewalk + all §16.8 checks.
