# Room v2: a full, lived-in studio you can walk around (spec, 2026-10-23, waiting on the user's OK)

## 1. The user's words
- "First we need to do is the complete room, we need to have a fuller room than what it currently is. Because it currently is just like not good, I can't even rotate fully."
- "Overall improve the surroundings and be able to walk around NYC… go outside my room, walk around NYC whenever I feel like it… using the arrow keys." (The street comes after the room; see §11.)
- About the people build: "the items created by you just seem to pass through." So nothing in this room may intersect.
- The user's choices (10-23):
  - **realistic furniture** (CC0, matches the realistic people)
  - **a lived-in base for free + store extras on top**
  - **full 360° orbit + walking with arrows/WASD + auto-life when idle + the front door as an exit**

## 2. Done means (the user checks these)
1. The Today screen shows a **full, believable NYC pre-war studio** that looks like a real place: real furniture, wood floor, plaster walls, clutter of daily life. No blocks, no empty floor.
2. **Drag rotates all the way around** (360°), with the near walls dropping away like The Sims. **Arrow keys or WASD walk Hariv** around without walking through anything. **Clicking furniture** sends him to use it.
3. Nothing intersects (people-fit gate, PEOPLE-SPEC §10.2). It runs at 60 fps on the MacBook and ≥ 30 fps on the tablet. Tests stay green.

## 3. The apartment (the studio at 421 W 118th St, the user's current home)
- **Size:** **6.4 m × 5.2 m, ceiling 2.9 m** (about 33 m², a real Morningside studio; today it's 5.0 × 4.0).
  - `layout.py` ROOMS and `room.js` LAYOUTS change together.
  - Saved layouts migrate: items keep their position from the room's back-left corner, and anything that would overlap a built-in is nudged to the nearest free spot. Write a migration test.
- **Shell:**
  - **Floor:** oak strip hardwood (a Poly Haven wood-floor texture, 1k, with a roughness map), boards about 7 cm wide, running along the long side.
  - **Walls:** warm off-white plaster #EDE6DA (subtle noise normal), with a 12 cm painted baseboard #F4F0E8 and 8 cm crown moulding.
  - **Ceiling:** white, hidden in cutaway.
  - **Windows:** **2 tall pre-war windows** on the street wall, each 1.0 m wide × 1.8 m tall, sill at 0.75 m, a 4-pane sash with deep 15 cm reveals and a painted cast-iron radiator under each. Linen curtains on a rod, tied back. The real city view stays in the glass (`viewFrom`, same clock as the room).
  - **Doors:** the front door (painted, 0.9 × 2.1 m, brass knob, a peephole) on the entry wall; a bathroom door (closed; it opens to a dark "bathroom" stub, it's not a room); and closet double doors (1.2 m).
  - **Kitchenette** along the entry wall:
    - base cabinets 0.9 m tall × 0.6 m deep, about 2.4 m run, with a butcher-block or light stone counter
    - a sink with a faucet, a 2-burner stove, and an under-counter fridge (or an 0.85 m fridge)
    - upper cabinets at 1.45 m
    - a kettle, a dish rack and 2 mugs
- **Lived-in base (free, built in; doesn't count against the decor budget, can't be sold):**
  - an area rug
  - a coat + tote bag on wall hooks by the door, and a shoe rack with 2 pairs
  - a laundry basket
  - 2 potted plants
  - 2 framed prints
  - a wall clock showing the real local time
  - a ceiling light, a floor lamp, and a desk lamp
  - a stack of books + a small bookshelf with books
  - a trash can
  - a power strip with a charger cable by the desk
  - a backpack by the desk chair
  - a water bottle on the desk
  - The **bed, desk + chair and sofa** are base furniture too, so the room is never empty. Store items add on top; the store's own copies of these upgrade them.
- **Composition rules:** the desk faces a window (that's the study spot). The sofa faces the room, not the wall. There are clear 0.8 m walking paths from the door to the bed, desk, sofa, kitchenette and windows, and nothing blocks a door swing.

## 4. Assets (₹0, offline at runtime)
- **The user's rule (10-23):** "use external resources for accuracy rather than creating our own… download the models." **Downloaded models are the default for every object.** Procedural geometry is only for the architecture: floor, walls, mouldings, window reveals, and anything that has to fit the room's exact size, such as counters cut to the wall run.
- **Sources, in order:**
  1. **Poly Haven** (CC0) models and textures. No login, so agents download directly into `build/polyhaven-raw/` (gitignored). The API is `https://api.polyhaven.com/assets?type=models`, then `/files/<id>`.
  2. **Sketchfab** (realistic, huge library), through the user's API token in `.env` as `SKETCHFAB_API_TOKEN`. Never print or log it.
     - Search: `GET https://api.sketchfab.com/v3/search?type=models&downloadable=true&q=<term>`, keeping **only CC0 or CC-BY** (no NC, no ND, no Standard/Editorial).
     - Download: `GET /v3/models/<uid>/download` with header `Authorization: Token <token>`, taking the GLB.
     - Raw files go in `build/sketchfab-raw/`. Credit every CC-BY model (title, author, link) in `room/assets/LICENSES.md`.
     - Prefer models with < 30k triangles, real-world scale, PBR textures, and a clean, modern look (no game rips, no stylized or cartoon looks).
  3. If neither has it, the procedural fallback below.
- **Convert:** with Blender + gltf-transform, to `epoch/web/static/app/room/assets/*.glb`, using `EXT_meshopt_compression`, webp textures, **1k max** (512 for small props), and real-world scale (1 unit = 1 m). Credit each one in a `room/assets/LICENSES.md` (Poly Haven = CC0, credit as courtesy).
- **Candidates found:**

| Item | Poly Haven models |
|---|---|
| Sofa | `Sofa_01`, `chinese_sofa` |
| Armchairs | `ArmChair_01`, `GreenChair_01` |
| Coffee tables | `CoffeeTable_01`, `coffee_table_round_01`, `industrial_coffee_table` |
| Chairs | `WoodenChair_01`, `dining_chair_02` |
| Tables / desks | `WoodenTable_02`, `metal_office_desk`, `SchoolDesk_01` |
| Shelves | `Shelf_01`, `drawer_cabinet`, `ClassicNightstand_01` |
| Lamps | `desk_lamp_arm_01`, plus the lamps under the lighting category |
| Wall art | `hanging_picture_frame_01..03`, `fancy_picture_frame_01/02` |
| Books | `book_encyclopedia_set_01`, `decorative_book_set_01` |
| Electronics | `classic_laptop`, `cassette_player`, `boombox`, `Television_01` |
| Kitchen | `electric_stove` |
| Ceiling and clock | `ceiling_fan`, `alarm_clock_01` |
| Plants and vases | `potted plants` category, `ceramic_vase_01..04` |
| Ottoman | `Ottoman_01` |

  Poly Haven has only 3 beds and they're ornate (`GothicBed_01`); pick the plainest.
- **Where nothing fits** (the bed, kitchen cabinets, fridge, doors, radiator, curtains, rug, laundry basket): build it procedurally **with real proportions, bevels (≥ 1 cm) and Poly Haven PBR textures** (wood, fabric, painted metal), never flat-colour blocks. A plain modern platform bed with a duvet, pillows and a folded throw is fine procedurally if it's bevelled and textured.
- **Every store furniture/decor item** (`economy_catalog`) gets the same treatment, so store items match the room: a Poly Haven model where one fits, otherwise the procedural rule above. Store thumbnails (`thumbs.js`) are re-rendered from the new models.

## 5. Camera: full 360°
- **Orbit:** drag (mouse or one finger) orbits **a full 360° in yaw**, pitch 18°–65°, scroll or pinch zooms 3–10 m from the room centre. Damped (0.12).
  - Double-click or double-tap re-centres.
  - **Q/E** rotate 45° steps (keyboard users).
  - Default view: a 3/4 angle from the corner opposite the desk, pitch 35°.
- **Cutaway (Sims "walls down"):** any wall whose outward normal faces the camera (dot > 0.2) drops to a **0.45 m stub** with a painted cap. Its windows and doors drop with it; sills stay. Transition 0.25 s. The ceiling is hidden from above.
  - Wall-mounted items on a dropped wall hide, then fade back in. Walls facing away stay full height.
- **Outside the room:** only the city backdrop beyond the windows (the existing blurred backdrop for the exterior sides). No void.

## 6. Walking and interaction
- **Arrows/WASD** move Hariv **relative to the camera**: `Walking` at 1.4 m/s; Shift = `running` at 3.0 m/s. He turns toward the input direction at 540°/s, with 0.3 s crossfades to idle.
  - He collides with furniture footprints and walls (capsule r = 0.25 m vs OBBs; slide along edges, never through).
  - Keys are ignored while an input or drawer has focus.
- **Click or tap on furniture** → he walks there by the shortest path (A* on a 0.1 m grid around the footprints) → the activity starts (sit and type, sofa tea or read, window, kettle tea, bed sleep, plant watering, record dance, piano…), using the PEOPLE-SPEC §10.2 placement solver and grip rules.
  - **Click on the floor** → he walks there.
- **Auto-life:** after **25 s** with no input, the existing routine resumes (activities by owned furniture and time of day). Any input takes control back at once.
- **Closet = wardrobe:** clicking the closet makes Hariv change clothes (a short fade).
  - **How:** the Egunoff LOD characters are modular, sharing the same base body and the same 68-bone skeleton: separate `Body`, `Tops`, `Bottoms`, `Shoes` and `Hair` meshes. So Dylan/Hariv can wear the tops, bottoms and shoes of Antony, Duke, Andrew, Serj, Dude, Gordon and Mr Froggle, plus material recolours.
  - **Fit check:** each garment is rebound to Hariv's skeleton and must pass the people-fit gate (no body poking through, ≤ 0.5 cm, over every clip); hide body faces under clothing where needed. A garment that can't pass is left out.
  - **Store:** store outfits (`economy_catalog` OUTFITS + CHEST_OUTFITS) map to these combos.
  - **When:** after the room proof, in the room build.
  - **Hariv's default outfit = the Columbia sweatshirt (the user, 10-23).** Arthur's crew-neck raglan sweatshirt (`maxiamo/characters/arthur_-_lod_man_character.glb`, Egunoff, CC-BY; downloaded, 1 credit) on Hariv's body, recoloured Columbia blue #B9D9EB with the contrast piping in white, plus white serif **COLUMBIA** letters arched across the chest (a decal in the texture, about 26 cm wide). It has no hood, because none of the artist's 31 characters wears a hoodie. This overrides PEOPLE-SPEC §3's "no text on clothing" for this one item. It must pass the fit gate on every clip.
- **Bed:** the user prefers the runner-up **"Dark Modern Bed" (Ren Viro Store, CC-BY, 21.5k tris)**. Download it (1 credit). It's king-ish: fit it as a queen (≤ 1.65 m wide) if the frame doesn't distort visibly; otherwise keep it king if the §3 walking paths still pass. If neither works, keep "Modern Bed" (Ngngan).
- **Sketchfab credit log:** `build/sketchfab-raw/DOWNLOADS.tsv`. The user had 10 credits: 5 spent (bed, desk set, sofa, rug, Arthur), the Dark Modern Bed makes 6, so **4 are left. Spend them only on big pieces Poly Haven can't cover, and ask before each.**
- **Front door:** walking into it or clicking it opens it (0.6 s swing). That shows a **"The hallway and your street are coming next"** card with a Back button. It's the hook for the street step (§11).
- **Reduced motion:** no camera damping, instant cutaway, and he teleports to the target spot.

## 7. Light and look
- **Light:** day/night from the room's clock (the same one as the window view).
  - **Day:** a sun directional light through the windows with soft shadows (PCF, a 2048 map on the laptop, 1024 on the tablet), visible light patches on the floor, plus a cool sky fill.
  - **Night:** warm lamps (#FFE3AE) as real point/spot lights: the desk lamp, floor lamp and ceiling light, max 3 shadowless + 1 shadowed. The window glass shows the night city.
- **Environment:** RoomEnvironment PMREM at a low intensity. ACES tone mapping, exposure tuned so the wood floor and Hariv's skin keep detail by day and night.
- **Contact:** contact shadows (or a baked AO patch) under every furniture item and person. Nothing floats.
- **Palette:** natural materials (oak, linen, painted wood, brass), Morningside accents in textiles (navy #081A33, Columbia blue #8CC4EE). No neon, no flat colours.

## 8. Performance
- **Budget:** the room ≤ **250k triangles** including Hariv (use his mid LOD if his close LOD exceeds 60k), ≤ 150 draw calls (merge static built-ins), ≤ 48 MB textures.
- **Speed:** 60 fps on the M1 Pro, ≥ 30 fps on the Realme tablet (tablet profile: 1k shadow map, no contact-shadow pass if it's slow). Render on demand when idle (0 frames while nothing moves, under reduced motion).
- **First load:** the room is visible within 3 s on a laptop on localhost (the shell first, props streaming in).

## 9. Quality checks (verifiable, screenshot each)
1. **Orbit:** 8 screenshots at 45° steps. None show a void, a missing wall face, z-fighting or a floating item.
2. **People-fit:** the report (PEOPLE-SPEC §10.2) passes for every activity spot in the room.
3. **Walking:** a scripted walk around the room perimeter with arrow keys never enters a footprint (logged min clearance ≥ 0).
4. **Clicks:** clicking each furniture item reaches it and starts its activity.
5. **Light:** day and night shots from the same 3 angles. The floor's sun patches line up with the windows.
6. **Migration:** the user's real saved layout (read-only copy) loads in the new room with no overlaps (migration test).
7. **Decorate mode** still works: place, rotate, collide, undo, budget.
8. **Tablet:** a 1333×800 screenshot, plus an fps log from a throttled run.
9. Tests green, `node --check` clean, the live app on 8765 untouched.

## 10. Non-goals (this build)
- The hallway, the stairs and the street (next step, §11).
- People other than Hariv in the room.
- The 1-bed, loft and penthouse rooms get the new camera, walking and models, but not a full hand-dressed layout (later, when the user moves).
- First-person view. Physics and items you can push around. Cloth or curtain simulation.

## 11. After this (for context, not this build)
1. **The street:** the front door → the hallway/stairs → **W 118th St at street level**, one block done well (sidewalks, stoops, shopfronts, trees, parked cars, street lamps), walking with the same controls.
2. **Then people:** pedestrians on that block, students in Butler, customers in the café, using the cast and people-fit already built.

## 12. Process
1. **Proof first (small, 1 Opus agent: the look is taste work):**
   - the new shell (floor, walls, windows, radiators, doors, kitchenette)
   - 5 pieces: bed, desk + chair, sofa, rug, one lamp
   - the 360° orbit with walls down
   - day and night light
   - Hariv standing in it
   - Screenshots from 4 angles × day and night, then **stop and show the user**.
2. **After the user's OK, the build (medium):**
   - **Sonnet** for the asset pipeline, the full lived-in dressing, walking + click-to-use + A* + door, store items + thumbnails, and the migration + tests
   - **1 Opus review** at the end against §9

## 13. Update 10-30: the user lives in the Harlem brownstone, so the full build targets it
The user: "yes now i am living in harlem". The home is `harlem-floorthrough`: "Brownstone floor-through", 124 W 123rd St (BIN 1057741), size tier `1-bed`, decor budget 12.
- The saved layout holds only `desk_setup`; the outfit is `columbia_hoodie`, owned.
- The studio proof (`city/room2.js`) stays as the studio shell. **`room2.js` becomes data-driven:** `SHELLS['morningside-studio']` and `SHELLS['harlem-floorthrough']`, with the same furniture, camera, light and people-fit code.
- **The other 1-bed homes** (UWS, CPW) keep the generic 1-bed for now (non-goal).

### 13.1 The brownstone parlour floor (concrete)
- **Coordinates:** interior **5.6 m wide (x −2.8…+2.8) × 11.2 m deep (z −5.6 street … +5.6 garden)**, ceiling **3.4 m**. Walls #EDE6DA plaster, an 18 cm baseboard, 15 cm crown moulding, and a plaster ceiling medallion in the front parlour.
- **Floor:** Poly Haven herringbone parquet if available (else the oak strip), with a darker 12 cm border band.
- **Front parlour (z −5.6…−0.6):**
  - **2 tall street windows** on the z = −5.6 wall at x = ±1.3: each 1.05 × 2.5 m, sill 0.55 m, 20 cm reveals, sash bars, painted interior shutters folded back + linen curtains, a radiator under each.
  - **Marble fireplace** centred on the left wall (x = −2.8, z = −3.1): a 1.5 × 1.2 m mantel in white/grey veined marble (Poly Haven marble texture), a black cast-iron insert, a 1.6 × 0.45 m hearth slab, and a gilt-framed mirror above.
  - **Study spot:** the desk at the left street window, facing out (this is where `desk_setup` migrates to).
  - The sofa faces the fireplace with the rug between; a floor lamp sits by the sofa; a bookshelf stands beside the fireplace.
- **Divider at z = −0.6:** a 15 cm wall with a **cased archway 2.4 m wide × 2.7 m tall**, centred, with mouldings and pocket doors half pulled out.
- **Middle (z −0.6…+2.4):**
  - **Kitchen** along the right wall (x = +2.8) from z −0.4 to +2.2: base cabinets 0.9 m × 0.62 m, a counter, sink, stove, a full-height fridge (0.7 × 1.8 m, bevelled, procedural allowed) and upper cabinets.
  - A small café table + 2 chairs.
  - **The front door to the stair hall** on the left wall at z ≈ +0.3, and **the bathroom door** on the left wall at z ≈ +1.6.
- **Divider at z = +2.4:** a wall with a 0.9 m doorway on the left side.
- **Back bedroom (z +2.4…+5.6):**
  - **2 garden windows** on the z = +5.6 wall (same size). Through them: backyard gardens and tree tops, using the city backdrop from the back side.
  - The **Dark Modern Bed**, headboard against the divider, facing the garden windows.
  - A nightstand + lamp + alarm clock, closet double doors on the right wall, and a laundry basket.
- **Lived-in base (free, built in):** §3's list, spread over the zones:
  - books on the mantel and shelf, plants by the windows, 2–3 framed prints
  - coat hooks + shoe rack by the front door
  - kettle, mugs, dish rack and fruit bowl in the kitchen; a wall clock in the kitchen
  - a throw on the sofa, the backpack + water bottle by the desk, a trash can
- **Camera:** the target is the room centre. Zoom 4–14 m. Default view: a high 3/4 from the street-right corner showing the front parlour + archway. Double-click a zone (parlour, kitchen, bedroom) to centre on it.
- **Walls down:** applies to the exterior walls *and* both dividers. Any wall whose plane lies between the camera and the target drops to a 0.45 m stub.
- **Budget:** ≤ 300k triangles, ≤ 180 draw calls, 60 fps laptop, ≥ 30 fps tablet.
- **Server and decorate:**
  - `layout.py` gets a **per-home room override** for `harlem-floorthrough`: dims, windows, dividers and doorways, plus kitchen, bed and fireplace keep-out rectangles. Decorate validation must match the new shape. `room.js` LAYOUTS mirrors it for the old fallback view.
  - Migrate the saved layout: `desk_setup` goes to the study spot.
  - Write tests: the migration, validation in the new shape, and that the UWS/CPW homes are unchanged.

### 13.2 Build plan (medium; the user said yes)
1. **In parallel:**
   - **(a) Opus: the brownstone look.** `SHELLS['harlem-floorthrough']` + all dressing + light. Poly Haven freely; **0 Sketchfab credits** (report gaps instead). Screenshots: an 8-step orbit + 3 zones × day and night.
   - **(b) Sonnet: the server per-home room + migration + tests.** `layout.py`, the `room.js` LAYOUTS mirror, tests.
2. **Sonnet: interaction + make it the default.** Walking (arrows/WASD, Shift runs), click-to-use with A*, people-fit activities (desk typing, sofa reading with the book on the lap, window, bed sleep, kettle with the mug on the counter, **no hand-held props**), auto-life after 25 s, the front door → "coming next" card, tablet tap-to-walk, reduced motion. Then `room2` becomes the default Today room for the user's home (`?room2=0` = old room).
3. **Opus review** against §9 adapted to the brownstone, then report to the user.
- **Next, a separate small run:** the Columbia sweatshirt (Arthur's top on Hariv) for the owned `columbia_hoodie` outfit.

## 14. Update 10-30: the inside view (a third-person game camera)
The user: "it is still like I am outside the room looking at a box … something like I am inside the room and like making him move like a real game". Their choices: **behind the shoulder**, **drag to look**.

### 14.1 Done means (the user checks these)
- I open Today and I'm **inside** the brownstone, behind Hariv. Dragging looks around, and W walks where I'm looking.
- I can walk from the parlour, through the archway and the kitchen, into the bedroom, and the camera **never goes through a wall** or out of the apartment.
- Clicking furniture still works, and the camera frames him at it. One button brings back the dollhouse view.

### 14.2 Modes
- **Inside** (new; the default on Today) and **Overview** (today's 360° dollhouse, unchanged).
- Toggle with a small HUD button ("Overview" / "Inside") and the key `O`. Remember the last mode per browser (try/catch localStorage). Decorate forces Overview.
- In Inside mode, **every wall and both dividers stay full height**. The ceiling and its medallion are visible; there is no walls-down.

### 14.3 The camera rig (a "spring arm")
- **Pivot:** Hariv's root + (0, 1.55 m, 0), shifted **0.35 m to his right** (over the shoulder: he sits left of centre, like Uncharted or The Last of Us). The pivot eases toward him with a 0.12 s lag.
- **Arm:** 2.2 m by default. Scroll or pinch changes it from 1.2 to 3.5 m.
- **Pitch:** −35°…+25° (positive = looking up), default −12°.
- **FOV:** 60° vertical in Inside mode (Overview keeps 38°). Near plane 0.05.
- **Collision:**
  - Sphere-cast (r 0.2 m) from the pivot to the wanted camera spot against walls, dividers, the ceiling (camera y ≤ 3.25), the floor (y ≥ 0.3), and **tall** furniture (fridge, bookshelf, closet, upper cabinets, anything with top ≥ 1.4 m).
  - The camera sits 0.1 m before the hit. It **pulls in at once** and eases back out over 0.3 s.
  - Low furniture (sofa, bed, tables, chairs) doesn't block, but the camera may never end up inside any furniture box: push it up or out.
  - It must pass through the 2.4 m archway and the **0.9 m bedroom doorway** by shortening the arm.
- **Fade:** when the arm is < 0.6 m, Hariv fades to about 25% opacity (or his head and hair hide), so the screen is never just his hair.
- **Reduced motion:** no easing; cuts only.

### 14.4 Controls
- **Drag** (mouse, trackpad, one finger) turns yaw and pitch at 0.25°/px. Moving > 6 px makes it a look, not a click (click-to-use already ignores > 8 px).
- **W/↑** walks where the camera faces. **S/↓** turns him round to walk toward the camera (GTA style). **A/D/←/→** walk left/right relative to the camera. **Shift** runs. He faces his walking direction (existing 540°/s turn).
- **Gentle recentre:** while he walks forward and there has been no drag for 1 s, the camera yaw drifts behind him at ≤ 45°/s. There is none while strafing or standing.
- **Click or tap** on floor or furniture works as today (walk + use). Pinch zooms the arm on touch.

### 14.5 Activity framing
When he arrives at an activity, the camera eases (0.8 s) to a framed shot. Any key or drag returns to the follow camera. All shots go through the same collision.
- **desk:** behind his right shoulder, showing the laptop and the street window.
- **sofa:** a front 3/4 from the fireplace side, showing the book on his lap.
- **bed:** a high shot from the foot-side corner.
- **kettle:** his side, showing the counter.
- **window:** from behind him, looking out at the street through the window.

Auto-life (after 25 s idle) uses the same framings.

### 14.6 Look at eye level
- **Garden windows show the painted garden** (`paintedGarden`, which already exists), not the city. Remove the low-poly tree that reads as a green pyramid from the views.
- **The ceiling is never black:** at night, its mean screen luminance is ≥ 0.08 (the hemi or ambient fill reaches it).
- Floor and wall textures may go to Poly Haven **2K** (CC0) if they look soft up close. Keep the budget: ≤ 300k triangles, ≤ 180 draw calls, **≥ 50 fps** at 1280×800 on this laptop.
- No shadow acne or peter-panning visible at eye level.

### 14.7 Quality checks (log + screenshot each)
1. **Walk tour:** 8 shots along parlour → archway → kitchen → bedroom doorway → bedroom (day). For each: the camera is inside the interior bounds, its distance to every wall/divider is ≥ 0.1 m, it's not inside any furniture box, and Hariv is visible. Log the numbers.
2. **The doorway squeeze:** walk through the 0.9 m bedroom doorway, logging the camera every frame: 0 frames outside the room or inside the divider.
3. **The corner spin:** with Hariv by the fireplace, drag 360°: the camera never leaves the room.
4. **The 5 activity framings** (§14.5).
5. **Eye-level day + night** in each zone; the ceiling check (§14.6).
6. **The windows:** the street window shows the city; the garden window shows gardens.
7. **Overview ↔ Inside** toggles both ways, and Decorate forces Overview.
8. **Performance:** fps and draw calls in the parlour.
9. pytest stays green; `node --check` on touched JS.
10. **Smoothness (the user: "it still move like shit"):**
    - Walking holds **≥ 55 fps with p95 frame ≤ 20 ms** at 1512×900 @2x. Measure it with rAF deltas over 3 s of held W, *after* load.
    - **No main-thread task > 100 ms** during the first 20 s after load either. Today the activity pre-plans (`room2_walk.js` → `people_fit.solve`) block 0.2–2.8 s each. Cache the plan results (localStorage, keyed by shell + layout + asset fingerprint, re-applying the chair/desk tweaks) or move the solve off the main thread.
    - Fixed 10-30 by the main agent: the frame loop double-queued rAF (≈20 renders per shown frame while walking; now 60 fps). The pre-plans now wait for 1.5 s of idle and use a 4 cm coarse step (half the time, same fit results).
    - Known: both armchairs FAIL the fit gate (5.4 / 4.7 cm), so auto-life may sit him clipping into them. Fix them or keep auto-life off the armchairs.

### 14.8 Non-goals
First person; mouse lock; jumping or crouching; going out of the front door (the street is the next build); new furniture; the Columbia sweatshirt (its own small run).

### 14.9 Plan (small)
1. **Sonnet:** the camera rig, controls, modes, activity framings, garden windows, and §14.7 checks 1–9.
2. **Opus review** (the planned step 3, now at eye level): §9 adapted to the brownstone + §14.7. It fixes taste issues only, then reports to the user.

## 15. Update 10-31: walking must feel like a game (the user's report)
The user: "walking is close to impossible with all the furnitures on the way blocking it so that needs to be spaced up more … i can bypass them by forcing my way but that makes the character glitch out".

**Causes found in code** (`city/room2_walk.js`):
- `solids` are **world AABBs** of the fit volumes, so a rotated sofa or armchair blocks a far bigger rectangle than itself.
- `moveBy` only slides along x or z, so he stops dead on anything diagonal.
- Once he's inside a solid, every move is blocked, but the walk clip keeps playing: the "glitch".
- Several gaps are narrower than his 0.5 m body (`R_CAP` 0.25).

### 15.1 Done means (the user checks these)
- Holding W/A/S/D, I can walk **everywhere a person could walk in a real apartment**: between all three rooms, to the desk, to the sofa, to the bedside and to the kitchen counter. I never need to steer around invisible boxes.
- Bumping into furniture **slides him along it smoothly**. He never sticks, jitters, teleports or moonwalks.

### 15.2 Rules
- **Circulation** (real-world 36″ standard):
  - **≥ 0.90 m clear** along the main routes: front door ↔ archway ↔ parlour window/desk ↔ sofa; front door ↔ kitchen counter ↔ bedroom doorway; bedroom doorway ↔ both bed sides ↔ closet.
  - **≥ 0.60 m** to reach any usable piece.
  - Move, rotate or shrink the **built-in dressing** to get there: coffee table, plants, floor lamps, armchairs, café table, laundry basket, trash can, shoe rack. Plants and lamps go into corners or against walls.
  - **Do not move user-placed layout items** (from the economy layout, e.g. `desk_setup`). If one blocks a route, report it.
- **Collision:**
  - **Oriented boxes** (each fit volume's own rotation), not world AABBs.
  - Pieces whose top is < 0.12 m (rugs) or whose footprint is < 0.15 m (thin lamp poles: use a 0.12 m circle) don't block as boxes.
  - Body radius **0.22 m**.
- **Response:**
  - Circle-vs-OBB with **continuous sliding**: remove the velocity component into the contact normal and keep the tangent, at any angle. Take up to 3 iterations per frame for corners.
  - **Gentle corner steering:** if the wanted direction is blocked but a direction within ±35° is free, steer that way.
- **Never stuck:** if he is ever inside a solid (after an activity, a teleport or a layout change), push him out along the shortest vector over ≤ 0.25 s. No snapping, no jitter.
- **Animation honesty:** the walk/run clip speed follows his **actual** ground speed. Below 0.15 m/s with a key held → the idle clip (a turn in place is fine). No running on the spot.
- **Camera:** the inside-view spring arm must not jitter while he slides along walls. Ease the arm with the existing smoothing; there's no pop larger than 0.15 m per frame.

### 15.3 Checks (log + screenshot)
1. **The walkable map** (`walk.map()`) before and after, with the narrowest width along each main route (target ≥ 0.90 m).
2. **Keyboard-only tours**, scripted like a player: hold W and turn the camera toward the next waypoint, never using click-to-walk. Routes:
   - (a) window/desk → sofa → archway → kitchen counter → bedroom doorway → bed side → closet, and back
   - (b) front door → parlour window
   - Log the time and **stuck events** (speed < 0.2 m/s for > 0.3 s with W held) = **0**; **jitter events** (position reversing > 3 times in 0.5 s) = **0**; **inside-solid frames** = **0**.
3. **The wall-hug test:** hold W diagonally into 5 pieces of furniture and 3 walls for 2 s each. He slides; the walk clip matches his speed (log both).
4. **The forced-wedge test:** teleport him into the sofa, coffee table and bed (debug `tp`). He eases out within 0.25 s with no jitter.
5. All activities still reach and PASS as before (desk 2 cm is known). The pre-plan cache is invalidated by the layout change.
6. Performance unchanged (≥ 55 fps walking); pytest green; `node --check`.

## 16. Update 10-31: the room becomes the REAL 124 W 123rd St parlour floor (the user chose "Accurate")
**Sources:** WORLD.md §11; LPC LP-2571 (124 W 123rd entry + Figure 2 photo `build/ref/street/124-128_W123_LPC2015.jpg`); PLUTO (building **17 × 48 ft = 5.18 × 14.63 m**, 3 floors + basement, 1870, Second Empire, brick).

### 16.1 The real plan (this replaces §13.1's 5.6 × 11.2 m shell)
- **Interior of the parlour floor:** **4.60 m wide** (0.29 m party walls) × **13.80 m deep** (0.42 m front and rear walls). Ceiling **3.45 m**.
- The facade faces **north (the street, −z)**. Looking at the street from inside, west is on the left (−x) and east is on the right (+x).
- **The stair hall (not part of the apartment):** a 1.20 m strip along the **east (+x) party wall** from the front wall back to z ≈ +1.0 (the stair rises there).
  - So the **front parlour and middle room are 3.40 m wide** (x −2.30…+1.10).
  - The **rear bedroom spans the full 4.60 m** (x −2.30…+2.30), behind the stair.
- **The apartment's entrance door** opens from the stair hall into the middle room on its east wall at z ≈ −0.3 (0.9 m door, swings in).
- **Front parlour** (z −6.90 … −1.40, about 5.5 m deep):
  - **2 street windows** on the front wall, matching the facade's two parlour-floor window bays: centres at x −1.45 and +0.25, each **1.00 m wide × 2.45 m tall, sill 0.50 m**, deep 0.42 m reveals, folding interior shutters, a radiator under each.
  - The **marble fireplace on the west party wall** (x −2.30, z ≈ −4.2).
  - A **cased opening** (pocket doors) to the middle room at z −1.40, 1.8 m wide.
- **Middle room** (z −1.40 … +1.90):
  - **the galley kitchen along the west party wall** (counter 0.62 m deep, fridge, sink, stove, uppers)
  - a **bathroom** in the north-east corner next to the hall (door from the middle room)
  - a 0.9 m doorway to the bedroom at z +1.90
- **Rear bedroom** (z +1.90 … +6.90, the full 4.60 m width): **2 garden windows** on the rear wall (same size, centred at x −1.1 and +1.1), the bed against the east wall or the middle-room wall, the closet, a nightstand.
- **Lived-in dressing** is re-fitted to the tighter plan. Use fewer, smaller pieces:
  - a **loveseat** (≤ 1.6 m) instead of the long sofa
  - one armchair (the parlour corner by the fireplace)
  - the coffee table ≤ 0.9 × 0.5 m
  - the desk stays at the left street window
  - the café table becomes a small 2-seat bistro table in the middle room if routes allow; otherwise drop it
  - prints, plants and rugs as before
- **§15's walk rules still apply:** routes ≥ 0.90 m (the parlour cross-route may be 0.80 m if 0.90 is impossible; report it), every usable piece reachable with ≥ 0.60 m, all §15.3 checks.
- **The look stays** (§13, §15 plus the Opus look pass): herringbone, plaster, picture rail, prints, lamp-lit nights. Garden windows: the painted garden.

### 16.2 Server
- `layout.ROOMS_BY_HOME['harlem-floorthrough']`: the new dims, windows, doorways and keep-outs (kitchen, fireplace, bed, bathroom, the stair-hall strip).
- `room.js` LAYOUTS mirror.
- Migrate the saved layout (`desk_setup` → the left street window).
- **Tests:** update `tests/test_brownstone_room.py` (the shape, validation, migration; the UWS/CPW homes are unchanged).

### 16.3 Checks
- **The plan matches §16.1 within 2 cm:** log every wall, window, door and fireplace position.
- **Exterior consistency:** a debug top-down overlay of the room on the real footprint (BIN 1057741 from the city tiles) shows the room inside the footprint with the walls' thickness. The 2 street windows line up with the facade's parlour-floor bays (3 bays per WORLD.md §11.2: door bay on the east, 2 window bays).
- All §15.3 walking checks, all activities, the inside view checks (§14.7) and Overview.
- pytest green; `node --check`; ≥ 55 fps.

### 16.4 Run plan (medium; after World slice 0 finishes, since it touches the same files)
1. **Sonnet:** §16.2 server + tests, and the shell geometry and collision in `room2.js`.
2. **Opus:** re-dress and re-light the tighter plan, plus the full §16.3 checks.
