# Epoch as a cozy life sim: build spec

**Status:** agreed with the user 2026-10-22, not yet built. It builds on docs/ECONOMY.md (money, rent, homes, store, passport), docs/game-design.md (towers, levels, stars) and docs/MANHATTAN-DATA.md (the real-Manhattan city and the year of lots). Nothing in those documents changes unless this spec says so.

**Audience:** the agents who build it. It covers what to make, why, how it should feel, where it goes in the code, and how we'll know it's done.

---

## 0. Why this exists

The user's verdict on the first money build: *"It's been built, but it just doesn't feel like an indulgent experience, like a real game… the immersive experience is not there. It just feels kind of boring to be accessing this."* And: *"When I turn on focus mode it is just me standing near the library."*

**Diagnosis (what went wrong):**
- The money system is **pages and lists**: Money, Store, Passport and Home are forms.
- Buying an item changes a number, and nothing happens in the world.
- The room is a **viewer**: it opens in a modal, shows fixed slots, then closes. The character doesn't *do* anything there.
- Earning is **silent**: a small toast.
- In focus mode the character stands **outside** Butler Library in the city view. There is no interior, so studying doesn't feel like anything.

**The user's direction**, chosen in a multiple-choice brainstorm:
- **Vibe: a cozy life sim**, like Animal Crossing or The Sims. The apartment is the home screen, you decorate freely, and your character lives there and reacts.
- **Focus mode: unlockable study spots.** You start inside Butler Library's reading room and unlock more places.
- **Hooks:** daily missions with a reward chest, and a character that reacts live.

**What success looks like.** The user opens Epoch every hour because:
1. They **want to see their place and their character**.
2. Studying **looks and feels like studying somewhere beautiful in New York**.
3. Every log or block **visibly does something**.
4. There's always **a next thing to want**: a mission, the chest, a piece of furniture, a new study spot, the next home.

## 1. Experience pillars (use these to decide anything this spec doesn't cover)

1. **Presence.** Epoch is a *place* you return to, not a dashboard. The default view is your apartment, lit for the real time of day, with your character in it.
2. **Every action gets a reaction.** Anything you do must produce:
   - visible feedback within **150 ms** (a press state, a sound if sound is on)
   - a world reaction within **1 s** (the character reacts, coins fly, a floor rises)
3. **Ownership.** What you buy *lives somewhere*. You place it, it stays where you put it, and your character uses it.
4. **Anticipation.** The next reward is always visible: today's missions, how close the chest is, the next study spot or home, the next raise.
5. **Cozy, never guilty.** Warm light, soft sounds, slow idle life. There are no failure screens; a quiet day is just a quiet day (the existing no-guilt rules and banned-words check still apply).
6. **Honest rewards.** Everything is computed from the same honest counters as XP and money (ECONOMY.md). Nothing can be bought with real money, and nothing rewards fake activity.
7. **Fast where it matters.** The hourly log stays one tap and under a second. The scene renders after the log card is usable and never blocks it.

## 2. The loops

| Loop | Frequency | What happens | What the user sees |
|---|---|---|---|
| **Moment** | every log | Log an hour, finish a block, ship an output | The character reacts (cheer, beam), coins fly into the wallet, a floor rises on today's tower |
| **Session** | 25–90 min | A focus block at a study spot | The character studies inside the spot, the light changes, a PiP of today's tower rises, breaks show stretching or coffee, and the block-done card appears over the scene |
| **Day** | daily | 3 daily missions, then the chest; the 3 stars | Mission progress in the HUD; when all three are done, a chest appears in the apartment and opens with an animation |
| **Week** | Sunday | Rent day (ECONOMY.md) | The rent-day recap as a moment in the apartment: the character at the desk with the bills, then the recap card |
| **Long** | weeks to months | Homes, study spots, job title, districts, Billionaires' Row | New places, new furniture, a camera flight on level-up, a moving-day sequence |

## 3. Where things live (scenes and navigation)

| Page | Main visual | Changes |
|---|---|---|
| **Today** `/` | **Home scene**: the apartment in 3D at the top of the page, with the HUD over it | The log card stays the first interactive element. The "Your week in New York" tower card stays below. |
| **Focus** `/pomodoro` | **Study-spot scene**, full-size | The timer becomes a HUD over the scene. Today's construction cam becomes a **picture-in-picture** in a corner; tap to swap the two. |
| **World** `/world` | The real-Manhattan city, unchanged | While studying, the character is *inside* the spot's building: its window glows warm, and no figure stands outside. At home, the home building's window is lit. |
| **Money** `/money`, `/store`, `/passport`, `/home` | As built | The store gains 3D previews and "Place it now". The Home page's "Open my room" goes to Today's home scene in decorate mode. |

**The day towers stay** (the user asked explicitly):
- World > City shows the year of towers.
- Today keeps the week card.
- The Focus Screen keeps the construction cam as a PiP.
- Where the home's position allows (the Morningside studio, 421 W 118th St, is a few blocks from the lots), the apartment window faces the user's block and today's tower.

## 3a. Change, 2026-10-23: Today is the room, with no hourly log card

**The user's words:** *"Why don't you just remove the part where it says 'What did you do this hour?' I literally never use that. Let's remove that part completely and make the whole screen focus on the room. If I'm studying, I'm gonna be in the focus thing. If not, I'm gonna be in the room chilling."* (Their hours are logged automatically by focus blocks.)

This replaces the "docked log bar" and "log card below the scene" parts of §3 and §4.1:
- **Removed from Today:** the "What did you do this hour?" log card and the docked log bar.
- **The room fills the screen:** it fills the viewport below the app header on desktop, tablet and phone.
- **The HUD over the room:**
  - level and XP
  - money and job title
  - today's deep time with crown progress (from the old ring card)
  - missions, the chest, the stars
  - a prominent **"Start studying"** button: opens the Focus Screen with the spot picker
  - **Decorate** and **Look outside** (World > My block)
- **While a focus run is active** (running, paused, on a break, or the block-done hold), `GET /` goes to the Focus Screen. `/?home=1` bypasses that, and the Focus Screen gets a small "Go home" link.
- **A "Today" drawer** (a bottom sheet on phone, a side drawer on desktop and tablet), opened from the HUD, holds everything else:
  - Today's three, with the star rules
  - the wins feed
  - today's plan
  - **today's log** (to delete or fix entries)
  - a small **"+ Add time"** for the rare session logged without the timer (opens the existing log form in a sheet)
  - **"Ship an output"**

  The logging and output endpoints, the Telegram logging and the Close page don't change.
- **The day towers:** the "Your week in New York" card leaves Today. Towers stay visible in World, through "Look outside", in the Focus Screen PiP, and through the apartment window where the home faces the block.
- **No-WebGL:** the 2D apartment card fills the screen, with the same HUD and drawer.

**Status: built (2026-10-23).** Where it lives:
- `_today_main.html`: the scene section, the HUD (rendered with the page, so it works before the 3D and `cozy.js` load; `cozy.js` fills it and never rebuilds it), and the Today drawer (`dialog#todayDlg`). The scene host carries `data-no-dock`, so `cozy.js` adds no log bar.
- `_log_sheet.html`: "+ Add time", the old log form (same hooks, same `/log` and `/api/log`) in `dialog#logDlg`. `/#log` and the `/` shortcut open it. A line the server could not read (no JavaScript) reopens it with the text kept.
- `GET /` (`web/app.py today_page`): a 303 to `/pomodoro` while a run is active. `?home=1`, `?place=`, `?decorate=`, a returned typed line and htmx requests stay home. A flash message travels with the redirect. The Focus Screen's top-left link is now "Go home" (`/?home=1`).
- "Start studying" goes to `/pomodoro?new=1`: the Focus Screen's setup, with the spot and its "Change" picker.
- The week card left Today. An offscreen city stage (`[data-js=stage][data-source-only]`) stays only to render the apartment's real window view; it never draws on its own.
- `app.js`: `renderHudDeep` (the deep-time chip), `initRoomDay` (the room's height below the header, dropping `?home=1` from the address, closing the sheet after a log). The CSS is the "COZY TODAY ROOM" block at the end of `style.css`. Tests: `tests/test_cozy_today.py`.

## 3b. Change, 2026-10-23: people that look human

**The user's words:** *"Can we make these human-like things look more real than they are currently? These don't look human at all. It shouldn't be too difficult to make them look somewhat human."*

This replaces the blocky "faceless low-poly figure" look everywhere people appear:
- the user's character (character.js `buildFigure`: room, Today, city, Focus, store turntables and thumbnails)
- the other students in study spots
- customers and passers-by

**Target:** stylised-realistic, like a well-made indie 3D game. Clearly human at a glance, but not uncanny and not cartoonish. Keep it in the same family as the diorama.

**Body:**
- About 7 heads tall.
- A neck. Shoulders, chest and waist with real taper, varied per person.
- Arms in two segments with elbows, and **hands** (a palm, a thumb and a finger block).
- Legs in two segments with knees, and **shoes**.
- Build the body from smooth low-poly primitives (capsule, lathe, extruded profiles, 8–12 radial segments) and merge them per body part.

**Head and face:**
- An egg-shaped head with ears.
- **Real hair meshes** in several styles: short, curly, wavy, a bun, long, a cap, a beanie.
- **Subtle facial features** so they read as people: eyes (small dark irises on a light sclera, with lids for blinking), eyebrows, a nose bump and a soft mouth line. **No big cartoon eyes, no mascot faces.**
- The user's character keeps its warm brown skin (`#8d5a3b`) and black hair as defaults.

**Clothes:** each outfit (`OUTFIT_LOOK`) is visibly modelled:
- a hoodie with a hood and drawstrings
- a sweater with a collar
- a long coat with lapels and a scarf
- a suit jacket with a tie
- running gear
- a jersey with no logos
- jeans or trousers, and sneakers or shoes

Optional accessories: glasses, headphones while studying, a backpack in the city.

**Animation rig:** pivots at the neck, shoulders, elbows, hips and knees, plus:
- breathing and blinking
- head turns
- typing hands and page turns
- a natural sitting pose with bent knees
- a walk cycle with arm swing

Under reduced motion, poses are static.

**Other people:** varied body types, skin tones, hair and clothes, chosen by a deterministic seed per person.

**Budgets:**
- the user's character close up: ≤ 3k triangles
- other people: ≤ 800, with a cheaper LOD far away
- shared geometry and materials; the existing scene budgets in §7 still hold

**Compatibility:** keep the figure API backward compatible. That covers `buildFigure(outfit)` and the pose and animation hooks used by home_today.js, room.js, spots, construction.js and thumbs.js, so every caller keeps working.

## 4. Feature specs

### 4.1 Home scene: the apartment is home

**What:** the existing cutaway room (`city/room.js`: `LAYOUTS`, `ITEM_MODELS`, `openRoom`, real window view) gets an **embedded stage mode**, a persistent scene at the top of Today, alongside the existing modal mode.

**Layout:**
- **Desktop (≥ 1100 px):** the scene is about 56% of the viewport height, full content width. The HUD overlays the scene. The log card sits directly below, so the scene must not push it below the fold on a 1280×800 laptop: if needed, the log card's compact input docks inside the scene's bottom edge (see "Docked log bar").
- **Tablet (1333×800):** same as desktop.
- **Phone (390 px):** the scene is about 42 vh, the HUD is reduced to the money pill and the mission chip, and the log card follows directly.

**Camera:**
- A 3/4 cutaway view with the window wall at the back, as today.
- Gentle orbit of ±30° yaw and 10–35° pitch, limited zoom, and double-tap or double-click to frame an item.
- The view slowly drifts back to the default after 20 s idle; under reduced motion it doesn't drift.

**Lighting by hour** (NYC or local hour, following the existing `ny` preference):
- **Morning:** a cool fill with sun patches on the floor.
- **Day:** bright and neutral.
- **Golden hour:** warm, with long patches.
- **Blue hour:** lamps on.
- **Night:** lamps and a warm practical light, with the city lights in the window.

Lamps the user owns emit light at night.

**The window view:** reuse room.js's real-city render, from the home building's real position and floor height. Re-render only when the hour bucket or the weather changes, never per frame. Rain or snow shows as streaks or flakes on the glass (from `/api/weather`).

**Docked log bar (desktop/tablet):**
- A slim input pinned to the bottom edge of the scene ("What did you do this hour?") that posts through the same endpoint as the log card.
- On submit, the character reacts (§4.4) and coins fly to the wallet pill (§4.7).
- The full log card below is unchanged, and the docked bar is optional when JS is off.

**The HUD (glassy chips over the scene; Fredoka numerals):**
- **Top left:** the money pill (count-up animation on change) and the job-title chip ("Barista · $25/h").
- **Top right:** the missions chip ("Missions 1/3", with a mini progress ring), the chest icon (glows when ready), and the stars.
- **Bottom right:** a "Decorate" button and a "Look outside" button (flies to World > My block).
- In quiet mode the money, mission and star chips are hidden; the room and the character stay.

**Rendering:**
- Render on demand.
- While the character is animating, tick at 30 fps. When idle, render nothing until the next animation event or input.
- Pause when the tab is hidden.
- The scene initialises after first paint (requestIdleCallback), as the Today hero does now.

### 4.2 Decorating mode: free placement

**What:** replace the fixed `slots` with **free placement on a grid**, Sims/Animal Crossing style.

**Entering and leaving:** enter with the "Decorate" button, from the store's "Place it now", or by pressing **E** on the scene. A storage drawer slides up showing owned unplaced items as 3D thumbnails. Exit with **Done** or **Esc**.

**Rules:**
- **Floor items** snap to a 0.25 m grid on the floor. **Wall items** (art, prints, shelves marked `surface: 'wall'`) snap to a 0.25 m grid on the solid walls, not on windows.
- **Rotation:** 90° steps with **R** or the rotate button; hold Shift (or long-press) for 15° steps.
- **Collisions:** items can't overlap (AABB footprints from the catalog's `size: [w, d, h]`) and can't leave the room. Rugs (`layer: 'under'`) may sit under other items.
- **Capacity:** each home size gets an item budget (studio 8, 1-bed 12, loft 16, penthouse 24), replacing the slot count. The Home page shows "6 of 8 places used". Rent and storage rules stay the same, so a downsize sends the items that no longer fit to storage.
- **Undo:** the last 10 moves (**Ctrl/Cmd+Z**).
- **Input:**
  - **Mouse:** drag.
  - **Touch:** tap an item to select it, then drag; two-finger rotate is optional.
  - **Keyboard:** Tab cycles through items, arrow keys move by one cell, **R** rotates, **Delete** sends the selected item to storage.
- **Feedback:**
  - The selected item is outlined in Columbia blue.
  - The footprint ghost turns red where placement is invalid.
  - Items drop into place with a small squash-and-settle (120 ms), or snap instantly under reduced motion.
- **Saving:** save on drop, debounced to 400 ms, to the server (`POST /api/home/layout`).
- **Validation:** the server checks ownership, bounds, overlap and capacity, and rejects calmly ("That spot's taken.").
- **Migration:** existing `placed` slot assignments convert once into layout positions using each slot's x/z/ry, so nothing the user owns moves unexpectedly.

### 4.3 The store, in 3D

**Thumbnails:**
- Each store card shows a **3D thumbnail** of the item, rendered once per item with a single shared offscreen renderer (one WebGL context, not one per card).
- Thumbnails are cached as object URLs in memory and in localStorage where size allows.
- Hovering or focusing a card slowly turns the item.

**Buying:**
- **"Place it now"** after a purchase: a box drops into the apartment, opens, the item pops out (300 ms), and decorate mode starts with that item selected.
- Under reduced motion, the item simply appears, selected.
- The existing two-step buy and token stay (ECONOMY.md).

**Outfits:** outfit cards show the character wearing the outfit on a turntable, with a "Wear it" toggle.

### 4.4 The character lives there and reacts

Build on `city/character.js`: `buildFigure(outfit)` and `OUTFIT_LOOK` stay, and the routine (`studying / walking_home / home / asleep`) becomes the *macro* state. Add a small **activity system** for life at home and in study spots, plus a **reaction queue** for live events.

**Animation approach:**
- Procedural keyframe tweens on the existing low-poly parts: head, torso, upper and lower arms, legs. Add simple hinge pivots if the figure lacks them.
- No skeletal assets, no external files.
- Each activity is a loop (2–6 s) with entry and exit poses (0.4 s).
- Walking between spots in the room moves along a straight floor path that avoids item footprints.
- Under reduced motion, show static poses, with no walking or looping.

**Activities at home:** pick one with a weighted random choice, seeded by the day and minute so repeat visits feel alive but stable. Hold each for 30–90 s, then choose again. An activity only appears if the item is owned and placed:

| Activity | Needs | Notes |
|---|---|---|
| read on the sofa or armchair | sofa or armchair | book in hand, page turn every 6 s |
| water a plant | any plant | tilt the watering can; leaves sway |
| look out of the window | — | stand at the window; at night the city lights reflect on the figure |
| make tea | espresso or kitchen corner (studio kitchenette counts) | steam particles from the cup |
| play the piano | piano | arms alternate; notes as tiny glints, and soft notes if sound is on |
| play records | record player | records spin; gentle sway |
| stargaze | telescope, night only | eye to the eyepiece |
| work at the desk | desk | typing; the lamp on at night |
| sleep | bed (always present), past the sleep cutoff | lights low, the figure in bed, a slow breathing bob |

Buying a piece of furniture **unlocks a new activity**. This is the cozy hook: the item card says so ("Your character will play records here").

**Reactions:** event-driven one-shots that interrupt the activity, play, then resume it:

| Event (source) | Reaction | Duration |
|---|---|---|
| App opened or Today focused (first time in 30 min) | waves at the camera | 1.2 s |
| Hour logged (any) | small fist-pump or nod; coins fly | 1.0 s |
| Deep hour logged | cheer (arms up), a burst of 6 sparkles | 1.4 s |
| A floor completes on today's tower | turns to the window and points; the window flashes the tower | 1.6 s |
| Doors open or crown lit | celebrates; the crown shows in the window | 2.0 s |
| Output shipped | holds a "paper" up proudly | 1.6 s |
| Mission complete | a thumbs-up; the HUD chip pulses | 1.0 s |
| Chest ready | runs to the chest and kneels | 1.5 s |
| A 3-star day | a little dance | 2.5 s |
| After 23:00 local | yawns every 10 min while idle | 1.2 s |

Reactions come from the existing `witness:events` diff events (game.finish_write) and the pomodoro SSE stream. No new polling.

### 4.5 Study spots: focus mode takes you somewhere

**What:**
- A **study spot** is a small, self-contained 3D interior (or exterior nook) built procedurally, like room.js, and shown full-size on the Focus Screen while a block runs.
- The character studies there.
- Other faceless students make it feel inhabited.
- The block timer is a HUD over the scene.

**The Focus Screen:**
- **The scene fills `focus__cam`.** The timer, controls and +5/+10 buttons (already built) sit as a HUD panel over the scene (bottom left on desktop and tablet, below the scene on phone).
- **Construction-cam PiP:** a rounded 22% inset in the bottom right that renders today's tower rising (`city/construction.js`). Tap it to swap the main view. Prefer one renderer with scissored viewports; a second WebGL context is acceptable only if the tablet profile stays within budget.
- **The block-done card** (already built, with "Keep going +5/+10/+15") overlays the scene. During the hold, the character stops and looks up.
- **Breaks:** the character leaves the desk, stretches or fetches a coffee (cup steam), then sits back down when the break ends.
- **Choosing a spot:** a spot chip in the HUD ("📍 Butler Library") opens the spot picker. The Today "Start a focus run" sheet gains a spot row. The last spot used is remembered.
- **Before a block starts:** the spot is shown in its idle state (the empty seat waiting, other students working) with a "Start a focus run" button over it.

**Catalog** (in `economy_catalog.py`, as purchasable unlocks; the price is the unlock cost; level gates use game.DISTRICTS):

| id | Spot | Unlock | Scene recipe (summary) |
|---|---|---|---|
| `butler` | **Butler Library reading room**, Columbia | free, the start | See the full recipe below |
| `cafe_amsterdam` | A café on Amsterdam Ave | $300 | A narrow café: a pressed-tin ceiling, a pastry case, a window seat facing the avenue (real street outside), 2–3 other customers, an espresso machine with steam |
| `low_steps` | Low Library steps / South Lawn bench | $450 · open air | The Alma Mater–style steps without the statue (no faces), lawn, trees, students walking; follows the weather (rain → umbrella, snow) |
| `rooftop` | A rooftop in Morningside | $700 | A tar roof with a water tank, string lights, a folding table, the skyline south toward Midtown (from the real city render) |
| `nypl_rose` | The grand reading room on Fifth Ave | $1,200 + Midtown unlocked | A very long hall, a painted-sky ceiling with gilded frames, long oak tables with brass lamps, chandeliers, arched windows, many students |
| `park_bench` | Central Park bench, the Mall | $900 + Central Park unlocked | An elm canopy over the Mall, benches, lamp posts, passers-by; follows the season and weather |
| `penthouse_desk` | Your penthouse desk | owning the Billionaires' Row home | The penthouse room with the Central Park window; the character at the marble desk |

**Butler Library reading room: the reference recipe.** It's the first impression, so it must be beautiful.
- **Space:** a long rectangular hall of about 30 × 12 m, ceiling about 9 m. The scene shows one end bay at a 3/4 cutaway angle, about 12 × 12 m.
- **Architecture:**
  - Tall arched windows on one long wall: three visible, with mullions and warm wood reveals.
  - Light limestone walls.
  - A coffered ceiling in deep blue-grey with gold rosettes (cheap: an emissive dot grid).
  - Dark oak bookcases along the opposite wall, with procedural book spines (reuse room.js `books()`).
- **Furniture:**
  - Two rows of long oak tables with chairs.
  - **Green banker's lamps**, one per two seats, with a warm glow cone.
  - The character's seat at the near table: open laptop or notebook, a stack of books, a coffee cup.
- **Other students:** 6–10 faceless figures in muted outfits (reuse `buildFigure` with neutral looks). Each runs a slow loop: typing, page turning, writing, the occasional stretch, now and then one gets up and walks out.
- **Light by hour:**
  - **Morning:** cool daylight through the windows, long light shafts.
  - **Day:** bright.
  - **Late afternoon:** golden shafts.
  - **Night:** the windows deep blue, the banker's lamps carrying the scene.
  - Rain or snow from live weather shows on the glass.
- **Ambient detail:**
  - Dust motes drift in the window light (cheap points; off under reduced motion).
  - A wall clock shows the real NYC time.
- **The view out of the windows:** a soft render of the real campus/Morningside view from Butler's position (reuse the city render-to-texture). If that's too costly, use a painted sky with the Low Library dome silhouette.
- **Budgets:** ≤ 180k triangles and ≤ 60 draw calls (merge static geometry; instance chairs, lamps and books).

**In the city view (World):**
- While studying, hide the character outside.
- The spot's building gets a warm lit window and a small pin ("Studying at Butler").
- **Fix the current bug:** no figure standing outside Butler during a block.

### 4.6 Daily missions and the chest

**What:**
- Every day, three small missions, separate from the 3 daily stars (which don't change).
- Finishing all three makes a **chest** appear in the apartment.
- Opening it gives a reward.

**The mission pool.** Each mission is computed on read from honest counters (rules day summaries, entries, outputs, pomodoro_blocks, study-spot usage). The `{n}` values adapt to the user (below).

| id | Tier | Text | Done when |
|---|---|---|---|
| `early_bird` | easy | Log your first hour before 11 AM | First entry of the day starts before 11:00 local |
| `one_block` | easy | Finish one focus block | ≥ 1 pomodoro block with worked_s ≥ 25 min |
| `full_focus` | easy | Rate a block "Full focus" | A rated block with focus = full |
| `doors_by_noon` | easy | Open the doors before noon | The 30-min floor met before 12:00 |
| `two_blocks` | medium | Finish two focus blocks | ≥ 2 blocks ≥ 25 min |
| `deep_n` | medium | {n} of deep focus today | deep minutes ≥ n (n adaptive) |
| `two_subjects` | medium | Study two different subjects | Deep minutes in ≥ 2 ladder categories |
| `new_spot` | medium | Study at a different spot | A block at a spot other than yesterday's (only offered if ≥ 2 spots are unlocked) |
| `math_hour` | medium | An hour of {category} | ≥ 60 deep min in the day's suggested category (the least-studied ladder in the last 7 days) |
| `crown` | stretch | Light the crown | Daily target met |
| `long_block` | stretch | One block of 75 min or more | A single block with worked_s ≥ 75 min |
| `deep_stretch` | stretch | {n} of deep focus today | deep minutes ≥ stretch n |
| `ship_it` | stretch | Ship an output | ≥ 1 verified output today (offered at most twice a week) |

**Picking the day's missions:**
- One easy, one medium and one stretch, chosen with a deterministic RNG seeded by the date.
- Don't repeat yesterday's exact set.
- Don't offer a mission that can't be done that day; for example, `early_bird` isn't offered on a day that starts after 11:00. Missions are fixed at the start of the day, using data up to yesterday.

**Adaptive amounts:**
- **Medium:** `deep_n` = round to 15 min of 0.8 × the median deep minutes over the last 14 active days, clamped to [45, 180].
- **Stretch:** `deep_stretch` = round to 15 min of 1.2 × that median, clamped to [90, 300].
- **No history yet:** 60 and 120.

**Completion:** completing a mission:
- pulses its HUD chip
- plays a soft chime (if sound is on)
- triggers the character's thumbs-up
- shows a fact toast ("Mission done: two focus blocks")

**The chest:**
- **Ready:** when all 3 missions are done, a chest (a wooden crate with a Columbia-blue ribbon) appears in the apartment, and the HUD chest icon glows.
- **Never expires:** an unopened chest waits until it's opened. Up to 7 can stack, shown as "×3".
- **Opening:** tap the chest or the HUD icon. The character kneels, the lid pops, and light beams out (1.6 s). The reward card then flies to the wallet or the storage drawer. Under reduced motion, the reward card simply shows.
- **Rewards:** a deterministic roll seeded by the chest's date, so recomputation gives the same result:
  - **Money:** always; $40–$100, plus $10 per chest in the current consecutive-chest-day streak, capped at $150.
  - **A chest-only rare item:** 20% chance.
  - **A chest-only postcard:** 15% chance.
  - **Pity rule:** if 5 chests in a row had no rare item, the 6th has one.
- **The chest-only pool** (never sold in the store; added to the catalog with `chest_only: true`):
  - **Furniture:** a vintage subway map print, a brass desk clock, a typewriter, a crate of records, a Columbia-blue velvet armchair, a Flatiron snow globe
  - **Outfits:** a yellow raincoat with boots, a varsity-style jacket (no logos)
  - **Postcards:** sunrise on the High Line, midnight on the Met steps, fog over the Brooklyn Bridge
- **Ledger:** rewards are banked in `econ_ledger` with unique refs (`chest:2026-10-23`, `chest_item:...`), so writes are idempotent.

**Settings:** a toggle for "Daily missions" (on by default). Quiet mode hides missions.

### 4.7 Juice (the small things that make it feel like a game)

These make the core loop feel rewarding. Keep them light, and turn all motion off under reduced motion:
- **Coins:** on any money gain, 6–12 small coin sprites arc from the source (the docked log bar, the chest, the block-done card) into the HUD money pill, which counts up. Use the existing confetti/particles code.
- **Sound:** only when sound is on (the existing `audio.js` Web Audio synth; off by default):
  - a coin chime
  - a page turn
  - a chest-open swell
  - a soft click for item placement
  - a quiet room tone per study spot (library hush, café murmur)
  - all at a quiet volume
- **Level-up:** a camera flight from the apartment window out over the newly lit district and back (4 s, skippable).
- **Moving day:** after a move, a 3-second sequence: boxes in the old room, the new room's door opens, the boxes unpack. Then decorate mode with the auto-placed items.

## 5. Data and API changes

**Tables:** additive only, so they must migrate safely on the user's real DB. Test on a scratch copy made with `sqlite3 backup` from the read-only file.
- `econ_choice` gains these keys:
  - `layout`: `{"v":1,"homes":{"<home_id>":{"items":[{"id":"bookshelf","surface":"floor","x":1.25,"z":-1.75,"ry":0}, {"id":"skyline_print","surface":"wall","wall":"n","u":0.5,"y":1.6}]}}}`
  - `spot`: the last-used study spot id
  - `missions_seen`: for "new" badges only
- `econ_ledger` gains new `kind` values: `chest` (money), `chest_item`, `spot_unlock`. The ledger stays append-only with unique refs.
- No new table is strictly required. If missions need history, compute them on read. If a stored snapshot is unavoidable, add `econ_missions(local_date PRIMARY KEY, missions JSON, created_utc)`, written once per day (like `econ_weeks`).

**Catalog** (`economy_catalog.py`):
- Every furniture item gains `size: [w, d, h]` (metres), `surface: 'floor'|'wall'`, an optional `layer: 'under'`, and an optional `activity` (the home activity it unlocks).
- Add `STUDY_SPOTS`, `MISSIONS` and the `chest_only` items.
- Home sizes gain an item `budget`.

**API:** document the exact JSON in ECONOMY.md. Same-origin and LAN guard rules as the existing POST routes.
- **`GET /api/home/layout`** returns the current home's layout, budget, footprints and storage.
- **`POST /api/home/layout`** saves the layout with `{items:[...]}` and validates ownership, bounds, overlap and budget.
- **`GET /api/missions`** returns today's 3 missions with progress, the chest state (ready count, last opened) and the streak.
- **`POST /api/chest/open`** returns the reward. It's idempotent per chest.
- **`GET /api/spots`** returns the spots with unlock state, price and gate. **`POST /api/spots/select`** selects one; unlocking goes through the existing buy flow with `item_id = spot id`.
- **`/api/pomodoro` and the SSE stream** include the run's `spot`.
- **`/api/economy`** gains:
  - `character.activity_hint`: the macro state plus the owned-activity list
  - `missions` (summary)
  - `chest`
  - `spot`

## 6. Visual and audio direction

- **Style:** the existing low-poly diorama style. The Morningside palette from `city/palette.js` is the base. Interiors lean warm (oak, brass, green glass, limestone), with Columbia blue as the accent for UI and selection.
- **Materials:** flat or lightly shaded with vertex colour. Add soft contact shadows under furniture (a cheap blob decal) and a gentle rim light on the character.
- **Faces:** none. No animals, no mascots, no logos or brand names. Real places are fine; private businesses stay generic.
- **UI over 3D:** glassy chips (backdrop blur, 1 px light border, 14–18 px radius), Fredoka for numbers, Nunito for text, contrast ≥ 4.5:1, and every chip reachable by keyboard.
- **Motion:** easeOutCubic for UI, overshoot springs (small) for item drops and the chest, and nothing longer than 2.5 s except the opt-in level-up flight.

## 7. Performance budgets (laptop M1 Pro / Android tablet profile)

| Scene | Triangles | Draw calls | Target fps (animating) |
|---|---|---|---|
| Home scene (studio → penthouse) | ≤ 120k / ≤ 80k on tablet | ≤ 60 | 60 / 30 tablet |
| Study spot (incl. students) | ≤ 180k / ≤ 120k | ≤ 70 | 60 / 30 |
| PiP construction cam | ≤ 150k | ≤ 40 | throttled to 15 fps |

**Other limits:**
- **WebGL contexts:** at most 2 per page. Prefer one renderer with scissored viewports for the Focus Screen PiP.
- **Store thumbnails:** one offscreen renderer.
- **Rendering:**
  - Render on demand.
  - Idle with reduced motion means **0 frames**.
  - Pause when the tab is hidden.
- **Lazy loading:** load the scene after first paint, and keep the log card usable throughout.

## 8. Accessibility, settings and fallbacks

- **Reduced motion:** no walking, looping, dust, drift or flights; instant placement; static reaction poses.
- **Quiet mode:** hides money, missions, the chest and stars. The room, the character and the study spots stay.
- **Keyboard:** full decorating (§4.2), chests, missions and the spot picker. Visible focus rings.
- **Screen readers:**
  - The scene has an `aria-label` summary ("Your studio. You're reading on the sofa. Missions 1 of 3.").
  - Reactions are announced politely through the existing toast region.
- **No WebGL:**
  - Today shows an illustrated 2D apartment card (inline SVG, items listed).
  - Focus shows the timer with a static 2D illustration of the spot.
  - Decorating falls back to a list with storage toggles.

## 9. Build plan and file ownership

Reuse first: `city/room.js` (`LAYOUTS`, `ITEM_MODELS`, `books()`, the window render), `city/character.js` (`buildFigure`, `OUTFIT_LOOK`, routine), `city/construction.js` (cam), `epoch/economy.py` / `economy_catalog.py`, `money.js`, the pomodoro SSE stream, and the `witness:events` diff events.

| Phase | Owner (suggested model) | Files | Delivers |
|---|---|---|---|
| A. Engine | Sonnet | `epoch/economy.py`, `economy_catalog.py`, `schema.sql`/`db.py` (additive), the new API route functions in `web/app.py`, `tests/test_cozy_*.py`, the API section of ECONOMY.md | layout model + validation + migration from slots; missions + adaptive amounts + chest + rewards + pity; spots catalog + unlocks + selection; the `/api/economy` and `/api/pomodoro` additions; tests (incl. a migration on a scratch copy of the real DB) |
| B1. Home + decorating + life (after A) | Opus | `city/room.js` (stage mode), new `city/decorate.js`, `city/character.js` (activities + reactions), Today hero markup in `_today_main.html` (scene + HUD containers only) | §4.1, §4.2, §4.4 |
| B2. Study spots + Focus (after A, parallel with B1) | Opus | new `city/spots/*.js` (butler first, then the others), `pomodoro.html` scene/HUD/PiP layout, `focus.js` spot wiring, the PiP via `construction.js`, the World "studying inside" marker in `city/character.js` (coordinate with B1: B2 owns only the `studying` state's placement) | §4.5 |
| B3. UI shell and game feel (after A, parallel) | Opus (the user chose Opus for every experience-facing part) | `app.js` (HUD, coins, mission chip, chest flow, docked log bar wiring), `money.js` (store previews, "Place it now"), new `city/thumbs.js` (offscreen thumbnails), `style.css` (one commented block at the end), templates for the missions drawer and chest card, the settings toggle | §4.3, §4.6 UI, §4.7, quiet mode, fallbacks |
| C. Review | Opus | everything | the acceptance checklist below, on a scratch copy of the user's real DB and a seeded DB; fixes; screenshots |

**Coordination rules:**
- B1, B2 and B3 edit different files. Where they must touch the same file (app.js, character.js), make targeted edits only and re-read before editing.
- Append CSS only as a commented block at the end of style.css.
- **Never** modify `data/`, never bind or kill port 8765, use only your assigned ports, no git, no CDN, no real money.
- Keep JS imports relative: pages load from `/static/v/<fingerprint>/`.

## 10. Acceptance checklist (definition of done)

Each item is verified in a real GPU browser (headless Chrome with Metal) at 1280×800, 1333×800 (tablet, touch) and 390×844 (phone), with zero console errors:

- [ ] Opening Today shows the apartment within 1 s of first paint. The character is doing an activity, and the window shows the real city at the current hour.
- [ ] Logging an hour from the docked bar makes the character react within 300 ms and coins fly into the money pill, which counts up.
- [ ] Buying a piece of furniture, then "Place it now", shows the box drop and unpack, and decorate mode opens with the item selected. Dragging, rotating, collisions, wall items, undo, Esc and the budget all work, and the layout survives a reload.
- [ ] An owned item unlocks its activity, and the character is later seen doing it (the record player → records spin, sway).
- [ ] Starting a focus block shows the character **inside** the Butler reading room at a lamp-lit table, typing, with other students around. The timer HUD works. The PiP shows today's tower rising and swaps when tapped.
- [ ] A break shows the character stretching or fetching coffee. The block-done card overlays the scene, and Keep going +5/+10/+15 still works.
- [ ] World during a block shows **no figure outside Butler**, just a lit window and a "Studying at Butler" pin.
- [ ] At least Butler and two other spots are complete and selectable. The locked spots show their gate in plain words ("Unlocks with Midtown & Times Square, Level 13").
- [ ] Today shows 3 missions (easy, medium, stretch) with live progress and adaptive amounts. Completing all three makes the chest appear. Opening it plays the animation once, banks the reward (and repeating the request never double-pays), and the pity rule holds.
- [ ] Quiet mode, reduced motion, the no-WebGL fallbacks and keyboard decorating all work.
- [ ] Performance stays within §7, with idle frames at 0 under reduced motion.
- [ ] The full test suite is green, plus new tests for: layout validation, slot migration, mission selection (determinism, no impossible missions, adaptive amounts), chest idempotency and pity, spot gating, and the migration on a scratch copy of the real DB.
- [ ] Screenshots are saved to `/tmp/underdog-shots/cozy-*.png`, and the report lists what the user must do: restart the app once, then a normal reload.

## 11. Copy guide

Warm, short and factual, in plain words. No hype, no guilt, no exclamation-mark spam. Examples:
- **Mission done:** "Mission done: two focus blocks. One to go for the chest."
- **Chest:** "Your chest is ready." → "$85 and a brass desk clock."
- **Spot gate:** "The Fifth Ave reading room opens with Midtown, Level 13."
- **Decorating:** "That spot's taken." / "Your studio fits 8 things. 6 are out."
- **Activity unlock** (store card): "Your character will play records here."
- **Late night:** no nagging. The character just yawns, and past the cutoff goes to bed.

## 12. Not in this build (park for later)

- Walking the character around the city in third person (the "Explore NYC" vibe, which wasn't chosen).
- Multiple rooms per home, or a second floor.
- Friends visiting or shared spaces.
- Rough nearby boroughs, and the shareable read-only demo page (still queued in docs/IDEAS-LATER.md).
