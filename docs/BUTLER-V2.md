# Butler Library v2: the focus spot at the brownstone's level (spec, 10-30)

## 1. The user's words
"what about the library being 3d?" … "yea lets do butler first" (10-30, before the street).
Standing rules:
- people must look like "a normal human being. Normal chest, normal legs, normal hands"
- use all the characters, "especially those females"
- no agent-authored poses, only mocap clips
- no hand-held props

## 2. Done means (the user checks these)
- When I start a focus block, I see **Hariv in his Columbia sweatshirt at a long oak table in Butler's reading room, typing**, with real students around him reading, writing and typing. It looks as good as my brownstone.
- I can **drag to look around the hall** while the timer runs, and it stays smooth.
- Day, golden hour and night look different and beautiful: shafts of window light by day, green banker's lamps carrying the room at night.

## 3. What exists today (replace, keep as fallback)
- `epoch/web/static/app/city/spots/butler.js` + `kit.js`: a code-built hall, code-built faceless students (`human.js`, the mannequin look the user rejected), and a fixed camera.
- The look recipe in `docs/COZY.md` §4.5 "Butler Library reading room: the reference recipe" **stays the target look**:
  - space and architecture
  - light by hour
  - motes
  - the NYC wall clock
  - the Low Library view
- What changes is **how** it's built: real textures and models, the real character cast, and the inside camera.
- **Fallback:** the new spot is `spots/butler2.js`; `?butler2=0` (or any load error) shows the old one.

## 4. Look (concrete)
- **Hall:** about 30 × 12 m, ceiling 9 m. We build one end bay (about 14 m of the hall) fully; the rest fades into warm dusk fog.
- **Walls:** Poly Haven limestone/plaster (CC0), warm #E9E1D0. Three tall **arched windows** on the left long wall (2.3 m wide, sill 2.3 m, top 6.4 m) with oak reveals and mullions.
- **Ceiling:** coffered, deep blue-grey #3A4656, with gold rosettes.
- **Bookcases:** dark oak floor-to-cornice bookcases on the right and end walls, filled with real-looking books.
  - Prefer a Poly Haven book or bookshelf model, instanced. Else procedural spines with a Poly Haven leather/cloth texture.
  - A rolling ladder.
- **Tables:** 2 rows × 2 long oak tables (4.8 × 1.2 m, top 0.76 m) with 8 chairs each; Poly Haven wood. Chairs: a Poly Haven wooden chair model, instanced, **seat top 0.46 m**. Scale the model to that height; the fit gate may adjust it by ±3 cm.
- **The same render pipeline as the brownstone** (`room2.js`): the same tone mapping, exposure, RoomEnvironment PMREM, shadow setup and Poly Haven PBR texture handling. "As good as the brownstone" means a **side-by-side shot** (Butler day | brownstone parlour day) in the proof sheet, where the materials and lighting quality visibly match.
- **Banker's lamps** (procedural is OK, geometric): a brass base and a green glass shade (#1F5A3A, emissive inside), one per two seats, with a warm pool on the table.
- **Hariv's seat:** the near table, window side. On the table: an open laptop, a closed notebook, a stack of 3 books, and a paper coffee cup. **Nothing in his hands.**
- **The view out:** the real campus render from Butler's position (reuse the room2 window view / `manhattan.js viewFrom`, noTrees), or a painted South Lawn + Low Library dome if that costs too much.
- **Light by hour** (the same `hourFn` as the room):
  - **Morning:** cool, long shafts.
  - **Day:** bright.
  - **Golden:** warm shafts across the tables.
  - **Night:** windows deep blue; the lamps and a low ceiling glow carry the room.
- Dust motes in the shafts (off under reduced motion). Rain or snow on the glass as today.

## 5. People
- **Hariv:** `people/mixamo/hariv.glb` (the Columbia sweatshirt), clip **Typing**. During breaks: **Sit To Stand → Arm Stretching / Neck Stretching / Yawn → Stand To Sit**. The "block done" hold: **Sitting Idle**, looking up.
- **Students: 8 in the bay, at least 4 women**, chosen from the downloaded cast (`maxiamo/characters/*.glb`, rigged ones only).
  - Student-appropriate everyday clothes: **exclude** the swimsuit, the police uniform and the workwear.
  - At most one suit, as a "professor". No two identical in view.
  - Each student's GLB is prepped to **≤ 3 MB**: textures ≤ 1024 px, keeping LOD0 + one lower LOD. Add each one's CC-BY credit to `people/LICENSES.md`.
- **Choosing the students:**
  1. Render a **lineup sheet** of every rigged candidate (front, full body, same light).
  2. Pick by the rules above.
  3. Include the sheet in the proof report so the user can veto anyone.
- **Their loops** (mocap only, from `maxiamo/*.fbx` via `scripts/people/mixamo/build_clips.py`):
  - **Check each clip's posture first.** While seated, use **only seated clips**: Typing, Writing, Sitting Idle, Sitting Drinking. Yawn, Arm Stretching and Neck Stretching are probably standing clips, so they are used only after Sit To Stand (breaks, leaving).
  - **No "reading" with Sitting Idle:** it looks straight ahead, not down. Students study with **Typing** (a laptop in front) or **Writing** (a notebook flat on the table); some have an open book lying beside it.
  - Sitting Drinking only if the cup can stay on the table; otherwise skip it.
  - Every 3–6 min one student stands (Sit To Stand), walks down the aisle (Walking / Walking female) and out of view, and a while later one walks in and sits (Stand To Sit).
- **The fit gate** (`people_fit.js`) for every seat: seat contact within ±1.5 cm, forearms/hands on the tabletop within ±2 cm, nothing else penetrating; standing spots ≥ 15 cm from furniture. Solve once and **cache** (localStorage, as room2 does).

## 6. Camera and controls (reuse `room2_cam.js`)
- **Default:** behind Hariv's right shoulder, seated framing (like the room's desk framing), looking down the hall toward the windows.
- **Drag** to look (yaw ±150°, pitch −30…+35°, so you can look up at the ceiling). Scroll or pinch zooms the arm 1.0–4.0 m. The camera collides with the tables, shelves and walls and never leaves the hall.
- No walking during a block; Hariv is studying. A tap on the scene does nothing new. The existing timer HUD, the PiP, the spot chip and the block-done card stay as they are.

## 7. Performance (the Focus page also renders the construction PiP)
- ≤ 450k triangles including people; students beyond 5 m use their lower LOD. ≤ 150 draw calls.
- **≥ 55 fps, p95 ≤ 20 ms** at 1512×900 @2x with the PiP on, measured with rAF deltas over 5 s while dragging the camera.
- **No main-thread task > 150 ms** after the scene is first shown: load students one per idle slot; solve fits from cache.
- Extra download ≤ 30 MB, all local.

## 8. Quality checks (log + screenshot each)
1. **Fit gate:** a PASS line for Hariv's seat and every student seat, plus the walk-out path (min clearance ≥ 0).
2. **Hariv:** typing at his seat, in the sweatshirt, from the default camera (day + night).
3. **Students:** a close-up of 2 women and 2 men at work; hands and arms on the table look natural, nothing clips.
4. **Light:** the same view at morning, day, golden and night.
5. **Camera:** a 360° drag sweep (as far as the clamps allow) logs 0 frames outside the hall or inside furniture; one shot looking up at the ceiling.
6. **A break:** Hariv stands, stretches and sits back down (3 frames).
7. **Performance** (§7), with the PiP on.
8. **World view during a block:** no figure outside Butler (the old bug), and the "Studying at Butler" pin is shown.
9. pytest stays green; `node --check` on touched JS.
10. **Verify on the render, not the report:**
    - Every PASS is backed by a screenshot or a number measured from the live scene (bone world positions after `mixer.update`; fps from rAF deltas).
    - The main agent opens the shots before telling the user. Last time an agent reported a floating bed pose as PASS.

## 9. Non-goals
- The other spots (café, rooftop, NYPL, …); they come after Butler v2.
- Audio.
- Walking around the library.
- Hand-held props.
- Changing the timer, HUD or PiP logic.
- Sketchfab credits (4 left): ask first.

## 10. Plan (proof first)
1. **Proof (small, 1 Opus agent):**
   - one corner of the bay: 1 window, 1 bookcase, 1 long table, 2 banker's lamps
   - Hariv typing + **4 students (2 women)** with their loops
   - the camera drag
   - checks 1–4 (day + night only), 5 and 7
   - **Stop and show the user.**
2. **The full bay (medium):** Sonnet for the student prep, fit and perf; Opus for the hall and light. All §8 checks.
3. **An Opus review**, then report.

## 11. Proof verdict (10-30) and the full-hall changes
The user: "looks good except the library looked empty in 120 deg pic, rest is good". They agreed to all the fixes below. The 4 proof students stay: Sara, Veronica, Dude, Andrew. Proof shots: `build/shots/butler-proof/`.

**These override the earlier sections where they differ:**
1. **Never empty.** Every camera direction the clamps allow shows an inhabited library: tables, students, lamps and books all the way down the hall into the fog.
   - **3 table pairs** (2 rows × 3 tables, about 16 m). The far pair sits in the dusk fog with low-LOD students.
   - **Bookcases along the whole right wall and the end wall**, between pilasters.
   - **3 arched windows** on the left wall.
   - **3–4 brass chandeliers** down the hall's centre line (procedural is fine), warm and emissive, lit at night and dim by day. Real Butler 301 is known for "soaring ceilings and chandeliers".
   - A wall clock (NYC time) over the end door.
2. **Students: 10** (5 women + 5 men), including the 4 above. Pick the others from the proof lineup by §5's rules (everyday clothes; no swimsuit, uniform, gym wear or cartoonish models). Near students use LOD0 (≤ 5 m); farther ones use lower LODs.
3. **Modern laptops:** thin aluminium, about 31 × 22 cm, a 1.5 cm base, the screen at about 110° with a soft glow. No beige retro laptops, no CRT monitors.
4. **Uniform furniture:** every chair seat 0.45 m, tables 0.74 m.
   - **The Butler fit gate tolerance is ±2.5 cm** for seat and forearm/hand contacts. 1–2 cm is invisible at these camera distances, and uneven chairs look wrong.
   - Other penetration stays ≤ 1 cm.
5. **The floor is matte:** oak roughness ≥ 0.6, so no wet-plastic glare.
6. **The window view:** the campus toward the Low Library dome (city render from Butler's position, `noTrees`), or a painted dome + South Lawn if the render can't place it. Never a flat sky.
7. **No face-down writer:** check each writing student's head height above the table (eyes ≥ 30 cm above the top). Swap the clip or the student if it fails.
8. **Soft golden shafts** (feathered edges); **breaks and walk-outs animated** (Hariv's break per §5; one student leaves and one arrives every 3–6 min).
9. **Budget:** ≤ 600k triangles including people, ≤ 160 draw calls. The fps gate (§7: ≥ 55 fps, p95 ≤ 20 ms with the PiP on) decides.

**Run plan (medium):**
1. **Sonnet (engineering):** 2, 3, 4, 7, 8 (animation), 9, plus the furniture layout for 1, the perf gate and all §8 checks.
2. **Opus (look + review):** 1 (chandeliers, bookcases, windows, fill), 5, 6, 8 (shafts), and side-by-side with the brownstone. It re-runs §8.

## 12. The real room: reference photos (the user, 10-30). These override §4 and §11 where they differ.
**Files:** 5 photos of the real Butler 301 in `build/ref/butler/`, plus a contact sheet `sheet.png`. **Reference only: never ship them or copy them into `epoch/web/static`.**
- **Proportions:** a very long, narrow, tall hall.
  - Build about **14 m wide × 13 m high**, with **24 m of length** fully built; the rest recedes into warm haze.
  - The end wall shows when looking down the hall.
- **Window wall (one long side):** about **10 tall rectangular windows**, evenly spaced.
  - Each about 2.4 m wide, from about 3.2 m up to about 11.5 m, with **dark steel multi-pane mullions** (a grid of about 4 × 10 panes).
  - **Limestone pilasters** sit between the windows. **No arches.**
- **The opposite long wall:** smooth **limestone ashlar** (#E8E0CF) with pilasters, and **2–3 gilt-framed oil portraits** hung high.
  - Small square decorative bronze grilles.
  - A **central doorway with a classical surround and a round-arched pediment**.
- **Lower walls, all around:** a continuous band of **dark oak bookcases about 2.6 m high**, packed with books (many red, green and blue spines), topped by a wood cornice.
  - The **end wall** has a small **pedimented wooden doorcase** centred, with bookcases on both sides.
- **Ceiling:** an ornate **coffered ceiling in warm gold, ochre and brown** (#B8862E / #8A5A24, gilded mouldings), with a grid of **small recessed downlights** in the coffers.
  - **Not blue-grey; no gold-dot rosettes.**
  - A deep cornice band where it meets the walls.
- **Chandeliers:** **4–5 brass chandeliers down the centre line**.
  - Each is **3 stacked rings** of candle bulbs: diameters about 1.6 / 1.2 / 0.8 m, hung on a long chain, bottoms at about 4.5 m.
  - Warm, emissive, bright at night.
- **Floor:**
  - A **central aisle about 3 m wide** of **cream terrazzo/stone with black diamond inlays** (about 45 cm diamonds in a regular grid).
  - The same cream stone under the tables. Semi-matte: soft reflections only, roughness about 0.45.
- **Tables:** long **dark wood tables running ACROSS the hall** (perpendicular to the aisle), from the aisle toward each long wall, on **both sides of the aisle**.
  - About 4.2 × 1.2 m, top 0.74 m.
  - Some have a **low wooden book-divider** along the middle (a carrel shelf about 0.45 m high).
- **Chairs:** **dark wooden Windsor-style chairs** with spindle backs and curved arms, seat 0.45 m.
- **Lamps:** **table lamps with cream/ivory fabric shades** on brass bases, 2 per table, glowing warm. **These replace the green banker's lamps.**
- **Details:** a few **blue and green recycling bins** at the aisle ends; students with **thin silver laptops**.
- **Light:**
  - **Day:** bright, cool daylight pouring through the tall windows, cream walls glowing.
  - **Night:** the windows near-black, the gold ceiling lit by the downlights, the chandeliers and the cream lamps; a warm amber overall.
- **Hariv's seat:** the **window-side** table nearest the camera's start, at the seat next to the aisle.
  - The default camera looks over his right shoulder, **down the hall along the aisle**, so the chandeliers, the tall windows and the receding tables are all in frame (like photos 2 and 5).
- **Students' walk-outs** use the central aisle.
- **From photo 6** (`build/ref/butler/6.jpeg`, the best single reference; the sheet now has 6):
  - **Table tops:** **pale grey-beige** (#C9C2B2, matte linoleum look) with **dark wood edge banding and dark wood bases**.
  - **Lamps:** **pleated cone shades**, cream/ivory, glowing warm; brass bases; about 1 lamp per 2 seats, down the table's centre.
  - **Chairs:** black/very dark Windsor chairs with spindle backs and a curved arm rail.
  - **Windows:** the lowest panes of each tall window carry an **ornamental metal grille** (art-deco lattice). The pilasters have simple capitals at the top.
  - **Floor:** cream stone with **black squares** in a regular grid (they read as diamonds in perspective).

## 13. Fixes after the look pass (the user, 10-31: "fix all that")
1. **Seated fit:**
   - **≥ 10 of 11 seats PASS** the Butler gate (±2.5 cm seat and forearm/hand contacts, other penetration ≤ 1 cm, feet on the floor within ±2 cm).
   - **Thighs into the chair's front edge ≤ 1.5 cm** (today up to 4 cm after the 8° thigh drop).
   - **Allowed tools, in this order:**
     1. per-seat chair height **0.43–0.48 m** (invisible variation)
     2. a per-student root height offset ±3 cm
     3. choosing that student's seated clip (Typing / Writing / Sitting Idle) or seat
     4. replacing the student with another lineup candidate (keep 5 women + 5 men)
   - **No authored poses** beyond the existing ≤ 8° thigh-swing tool (prefer less).
2. **Daytime too white:** day shots must not clip.
   - Limestone walls should render as warm cream like photo 6, with mean wall-region luminance **0.62–0.78** and **≤ 1% pixels at full white**.
   - The gold ceiling stays visibly gold.
   - Adjust exposure, sun and sky fill, not the materials' colours.
3. **The window view:** the **Low Library dome** must be visible in at least one window from the default camera by day. Use the city render from Butler's real position, looking north across South Lawn. If the render can't place it, paint the dome + South Lawn into the window texture. Verify with a crop shot.
4. **Close-up check** (§8.3): 2 women + 2 men at work, in one shot or two.
5. **Re-run all §8 checks on the real `/pomodoro` page** (HUD and PiP visible), plus §12's look against `build/ref/butler/6.jpeg` side by side.
