# DOM contract for `static/app/` (style.css, app.js, city.js, icons.svg)

The server renders every page. `app.js` upgrades what is there. Everything JS touches is found through
`data-js="name"` attributes (never ids or class names), so templates can restyle freely. Working reference markup
that this contract was tested against is in `docs/archive/markup-reference/*.html` (base head/foot, Today, Close, World). Copy from it.

## 1. Page shell (base.html)

```html
<html lang="en">
<head>
  <link rel="stylesheet" href="/static/app/style.css">
  <script>   /* before first paint: theme + the "js" class (no layout jump) */
    document.documentElement.classList.add('js');
    try { var t = localStorage.getItem('witness.app.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
  </script>
  <script src="/static/htmx.min.js" defer></script>      <!-- optional, only if templates still use hx-* -->
  <script src="/static/app/app.js" defer></script>      <!-- classic script, NOT type=module. One tag is all that is needed -->
</head>
<body data-page="today|close|world|settings|..." data-today="2026-10-17"
      data-game="1" data-quiet="0" data-sound="0" data-motion="auto" data-three-d="auto"
      data-sky-tz="local" data-hide-achievements="0" data-confetti-cap="3">
```

* `app.js` adds `class="js"` to `<html>`, loads three.js and confetti **by itself** on demand (it injects the import map
  if the page has none, and loads `vendor/confetti` when the first burst is needed). The templates do not need an importmap or a confetti tag.
* All asset URLs inside JS/CSS are relative to `/static/app/`, so the mount point does not matter.
* The real templates write `{{ asset_base }}/app/...` (not `/static/app/...`) for scripts, the stylesheet and font preloads.
  `asset_base` is `/static/v/<fingerprint>`, and the fingerprint changes whenever any static file changes (`asset_version` in
  web/app.py). Every module is imported relative to `app.js`, so after an update the whole module graph gets new URLs and a
  browser can never run an old cached module next to a new one. Keep imports relative and never hard-code `/static/app/` in JS.
* `<body data-*>` values come from the settings table: `data-game` = `game_enabled`, `data-quiet` = `quiet_mode`, `data-sound` = `sound`,
  `data-motion` = `motion` (`auto|on|off`), `data-three-d` = `three_d` (`auto|off`), `data-sky-tz` = `sky_tz` (`local` or anything else = New York),
  `data-hide-achievements`, `data-confetti-cap` = `confetti_daily_cap`, `data-today` = server local date. Booleans accept `1/0/true/false`.
  If an attribute is missing, a localStorage value or the safe default is used (sound off, quiet off, motion auto, 3D auto).
* Skeleton: `.app > nav.nav + .shell > (header.top, main.main#main, footer.foot)`. Nav links are real URLs; mark the current one
  `aria-current="page"` and give each `data-nav="today|close|world|settings"` (the `/` and `g t/c/w/s` shortcuts use it).
  Close dot: `<i class="dot" data-js="close-dot" hidden></i>` inside the Close link (JS shows it when `/api/today` returns `close_dot: true`).
* Global hooks (all optional; JS creates the toast box and lights-out layer itself if absent):
  `toasts` (`<div class="toasts" role="status" aria-live="polite">`), `lights-out`, `nyc-time` (text span), `clock-line` (text span),
  `run-pill`, `run-num`, `run-label`, `sound-toggle` (button with an `<svg><use>` inside), `theme-toggle` (same).
* Icons: `<svg class="ic" aria-hidden="true"><use href="/static/app/icons.svg#i-NAME"/></svg>`. Available names include
  pen-line, moon, building-2, settings, plane, flame, volume-x, volume-2, sun, plus, rotate-ccw, timer, trophy, tent-tree, check, target, star, x, camera, send, sparkles,
  terminal, sigma, brain, book-open, smartphone, cloud-fog, circle-help, layers, calendar-check, shield-check, landmark, map-pin, zap, lock, link, copy, clock, eye, info, trash-2,
  external-link, chevron-left, chevron-right, layout-grid, download, play, pause, house, coffee, flask-conical, party-popper, arrow-right (grep `icons.svg` for the full list).
* Hide-able parts: add `data-quiet-hide` to anything Quiet mode must remove (XP card, quests, run pill, XP numbers); add `data-game-only`
  to anything that disappears when `game_enabled` is off; wrap the achievements section in `data-ach` (hidden by "hide achievements").
* Progressive enhancement helpers: `.js-only` (shown only with JS), `.no-js-only` (hidden when JS runs).

## 2. Forms (all must work as plain POSTs without JS)

JS intercepts `submit` on `form[data-enhance=KIND]` and `form[data-js="log-form"]`. It builds JSON from the form fields
(plus the submit button's `name`/`value`), POSTs it, and on a network failure keeps the form untouched. On an HTTP error
or a missing endpoint it falls back to a native submit of the same form, so nothing is lost.

| Form | Endpoint | Fields (names used for the JSON body) |
|---|---|---|
| `data-js="log-form"` (action `/log`) | `POST /api/log` | `text` input = `data-js="log-text"`. |
| `data-enhance="output"` | `POST /api/outputs` | `stage` (radio/select), `what`, `url`. |
| `data-enhance="focus-stop"` | `POST /api/focus/stop` | `outcome` (hidden or radios; `cancelled` = nothing logged). |
| `data-enhance="day-mark"` | `POST /api/day-mark` | `day`, `kind` (`rest`/`skip`), `reason`. |
| `data-enhance="close-label"` | `POST /api/close/label` | `day`, `start`, `end`, `source`, `deep` (checkbox or hidden `1`), submit button `name=category value=...` (`Don't remember` = Unknown). One form per gap, inside `.gap`. |
| `data-enhance="close-seal"` | `POST /api/close/seal` | `day`. |

`data-api="/api/..."` overrides the endpoint. Coercion: `deep`, `rest`, `public` become booleans, `minutes`, `id`, `entry_id`, `plan_block_id`, `outputs`, `floor_days` become numbers.

Log form details:

* `data-js="log-text"` input, `data-js="log-preview"` (tags + hint, not a live region) with a sibling `data-js="log-status"` sr-only status that announces parse hints once, `data-js="log-btn"` submit button with `data-js="log-btn-text"` inside, `aria-disabled` is set by the script only (no attribute in server HTML).
* `data-js="dur-chips"`: `label.chip.chip--time > input[type=radio][name=minutes][value=45] + span` (value = minutes).
* `data-js="cat-chips"`: `label.chip.chip--c-python|c-math|c-ml|c-papers|c-writing|c-rest|c-drift > input[type=radio][name=category][value="Python"][data-deep="1|0"][data-rest="1"?] + span`.
  Rest has `data-rest="1"` and `data-deep="0"`; Distracted has `data-deep="0"`.
* `data-js="repeat-chips"` holds `button.chipbtn[type=button][data-category][data-minutes][data-note][data-deep][data-rest]` (clicking one logs it at once).
  Markup: `<button class="chipbtn" ...>ICON<span>45m numpy ex 1-12</span><small>Python</small></button>`.
* With typed text and no chip tapped, JS sends `{text}` (the server parser decides). With a chip tapped it sends
  `{category, minutes, deep, rest, note}`; repeat chips send the same keys from their `data-*`.
  An `{ok:false, hint}` answer is shown in the preview line, the text stays in the box.
* Enter in the field submits. The "Reading…" spinner appears only if the answer takes longer than 350 ms.

Dialogs (Shipped sheet, Plan drawer, Lapse sheet): `<a href="/outputs" data-open-dialog="#shipDlg">` opens `<dialog class="sheet" id="shipDlg">`
(`.sheet__panel` inside; a real `href` is the no-JS route). `[data-close-dialog]` closes it. Optional `data-preselect="Python"` checks the radio with that value.

Copy button: `<button data-js="copy-btn" data-copy-target="#report" type="button">Copy</button>` (works on a textarea or any element).

Focus clock: `<span data-js="focus-clock" data-started="2026-10-17T14:02:00Z">00:00</span>` is ticked every second (elapsed mm:ss). Wrap the running-focus block in `data-js="focus-slot"`.

## 3. Today

| `data-js` | Element |
|---|---|
| `level-card`, `level-badge`, `dist-icon` (svg with `<use>`), `level-name`, `xp-num`, `xp-to`, `xp-bar` (role=progressbar), `xp-fill` (`style="--p:.34"`) | Level strip |
| `ring-wrap` containing svg circles `arc-target` (outer) and `arc-floor` (inner), both `pathLength="100"` + `style="--p:NN"`; `ghost-g` (a `<g>` with the ghost tick line); `deep-num`; | Ring |
| `ring-lead`, `floor-min`, `target-min`, `floor-ok`, `target-ok` (hidden until met), `ghost-text`, `cap-note` (hidden until over cap), `floors-pill`, `floors-num`, `floors-label` | Ring text |
| `quests` (`ul`), `stars`, `quests-card` | Quests |
| `wins` (`ul`) | Wins feed |
| `stage` + `data-stage="week"` (see 5), `day-btns` | Week tower + day buttons |

Server-rendered markup that JS re-renders must use the same structure so there is no jump:

```html
<li class="quest is-done"><span class="quest__box">ICON-check</span><span class="quest__t">First light<small>Log one hour of anything</small></span></li>
<li class="win"><svg class="ic" style="--cc:var(--c-python)">…</svg><span>45m numpy ex 1-12<small>Python · 1h ago</small></span></li>
<button class="daybtn is-today" type="button" data-k="0" data-st="floor" aria-pressed="false"><span>Mon</span>ICON<span class="num">45m</span></button>
<div class="total"><b class="num">12h</b><span>Deep hours</span></div>
<div class="achi on" data-key="first_light">ICON<span class="tier">Easy</span><b>First Light</b><small>First entry ever.</small></div>
<div class="ladder lc-python"><span class="ladder__ic">ICON</span><div><b>Python · Bridge</b><div class="nodes"><i class="on"></i><i></i><i></i><i></i><i></i></div><small>1 of 5 · Next: …</small></div></div>
```

## 4. Close and World

Close: `gaps` (container of `.gap` blocks; each `.gap` has `.gap__t > b` (the time span) and the label form), `fog-count`, `fog-label`, `fog-minutes`,
`seal-card` (wrapper, may be the seal form), `seal-btn` (`aria-disabled`, optional `data-job-open="1"` while the day-job question is unanswered,
`data-sealed="1"` once sealed), `seal-hint` (status line), `recap` (hidden section JS fills after sealing; contains `recap-save` button when rendered by JS).
A `stage[data-stage=week]` on the Close page shows the tower preview.

World: `world-tabs` (a `.seg.seg--js` wrapper with `input[type=radio][value=city|week|shelf]`; add `data-default="week"` to start elsewhere),
panels `world-panel` with `data-panel="city|week|shelf"`. Without JS all three panels show stacked and `.seg--js` is hidden.
Hash `#city|#week|#shelf` is honoured.
* City: `stage` + `data-stage="city"`, `snapshot` button (`data-stage-target="city"`), `totals`.
* Week: `out-slots`, `floor-pips`, `rest-pips` (JS fills them), numbers `out-count`, `floor-day-count`, `rest-count`, optional `out-req`, `floor-req`, `rest-req`,
  `stamp-note`, `ghost-chart` (`role=img`), `ghost-days`.
* Shelf: `ach-grid`, `ach-count`, `ach-total`, `ladders` (filled from `GET /api/shelf`; if absent JS does nothing there).

## 5. 3D stage (week on Today/Close, city on World)

```html
<div class="stage [stage--tall]" data-js="stage" data-stage="week|city">
  <div class="fallback" data-js="fallback" role="img" aria-label="…">SERVER-RENDERED INLINE SVG</div>
  <div class="stage__hint">Drag to look around. Tap a tower for its day.</div>
  <div class="daycard" data-js="day-card" hidden></div>
</div>
```

* The SVG fallback is visible until the canvas is created (`.is-3d` on `.stage` hides it). It stays when WebGL2 is missing (`.no-webgl`),
  when the context is lost, when Settings turns 3D off (`.use-svg`) and for no-JS visitors.
* JS re-renders the fallback from `/api/world` after every write using these SVG class names, so the server uses the same:
  `viewBox="0 0 420 220"` (week: 7 towers) or `0 0 420 300` (city: 4 rows x 7, Monday first), `rect.gr` ground, `rect.b` tower (+ `.f` doors open, `.t` crown, `.today`),
  `rect.win.lit` windows, `circle.park` rest day, `ellipse.fog`, `circle.lamp`, `circle.beacon`.
* Tower index: the framed stage (week, cam) numbers its slots by weekday of this week's row (0 = Monday); the free city numbers them by the index in the days array it was given. Both scenes are given **the whole year** (every day from the Monday of Day 1's week to this Sunday, each with `n`, its place in the year of lots, `-1` for a day with no lot) and keep every built day on its own permanent lot (home.json v2, docs/MANHATTAN-DATA.md). `app.js` builds that list with `slotsFor('year')`.

### 3D city module API (city.js, wave 2)

**The scene is real Manhattan** (`city/manhattan.js`, data in `city/manhattan/`, see `docs/MANHATTAN-DATA.md`): World > City is the free 360 camera over the
island; the Today hero (`mode: 'week'`) and the Focus Screen (`.stage--cam`) are framed on the user's own block in Morningside Heights (this week's seven
lots, today's lot) and keep the framed-camera rules below. Everything in the tables below works on all three. Extra methods on the City stage only:
`flyTo(id, {instant})` (`home, columbia, centralpark, midtown, timessquare, downtown, island, dream`), `places()`, `view('top'|'rotate'|'reset'|<id>)`,
`setUnlockedDistricts(ids)` (NTA codes, prefixes such as `'MN09'`, `'BROW'`, or `'all'`; locked districts sit in soft fog), `districts()` and
`setDreamHome({bin, lit, name, copy})` (the penthouse on Billionaires' Row; `epoch/game.py DREAM_HOME_BIN`). `/api/world` carries `districts` (what to
light), `dream_home` and `landmarks[].bin` (the real building each ladder lights).

`createCity(host, {mode, hour, motion, onPick})` returns `null` without WebGL2 (the SVG fallback stays), otherwise this object. Every method is
optional for the host: calling one the module lacks, or one with `null`, must be a no-op. Calls are idempotent (the host re-sends the same state
after every refresh) and cheap; the scene stays render-on-demand, pauses when hidden or off screen and keeps reduced motion honest.

| method | in | what the scene does |
|---|---|---|
| `setDays(days, {animate})`, `setLandmarks(list, {animate})`, `setTime(h)`, `setHourFn(fn)`, `pulse(i)`, `focusDay(i, ms)`, `nudgeLandmark(name)`, `craneAt(i)`, `pick(i)`, `setMotion(on)`, `setView(v)`, `pause(p)`, `invalidate()`, `renderNow()`, `dispose()` | unchanged | unchanged |
| `setConstruction(c)` | `{active, phase, progress, paused?, floors? \| minutes?, remaining?, duration?}` | the construction cam, below |
| `toppingOut()` | none | run the topping-out ceremony now (also runs by itself, see below) |
| `focusConstruction(on = true, {distance?, polar?, azimuth?, lookY?})` | | close-up of today's lot with the crane; `false` goes back. Returns false if today's lot is unknown yet (it retries when `setDays` arrives) |
| `setLive(on)` | bool | keep the scene gently alive (about 20 fps) without interaction. Automatic while a construction run is shown |
| `setWeather(w)` | the `/api/weather` object (`condition`, `cloud_cover`, `precipitation_mm`, `wind_kmh`, `is_day`, `available`, `enabled`) | clouds, rain, snow, fog, a covered sun or moon, dimmer light |
| `setSeasonal(keys)` | `[{key}]` as in `/api/today.seasonal` (or plain strings) | seasonal props, see below |
| `setFlow(f)` | `{hours_lit, minutes?, to_next_hour_min?, active?}` as in `/api/flow` | flow streetlights |
| `snapshot()` | none | legacy: PNG data URL of the live canvas (synchronous) |
| `snapshot({width, height, hour?, view?, type?, quality?})` | size 64..4096 | `Promise<Blob>` (PNG by default) of a clean render at exactly that size: no today ring, no pick ring, no blueprint outline. `view: 'hero'` (default) frames the hero block for that aspect whatever the user's camera is doing, `'current'` uses the live camera. `hour` renders at another time of day (the nightly skyline passes `22`). The on-screen view is restored before the promise settles |

**Construction cam** (`setConstruction`). Phases: `work` (a block is running), `break`, `topout`, anything else with `active:false` removes the site.
The crew is on site while `active` is true, while `paused` is true (crane parked, building holds), during `break` and during `topout`.
* `progress` 0..1 is the share of the current work block done. The new floors rise with it (smoothed). For smooth real-time rising without
  sending updates every second also pass `remaining` and `duration` in seconds: the module extrapolates from the moment the call arrives.
* `floors` (1..8, default 3) or `minutes` (floors = minutes / 15, the game's floors-per-minute) set how many floors the block builds. A 50 minute block is 3 floors.
* During `break` the finished block stays complete (the `progress` sent is ignored), the crane is parked and steam rises from the site cabin. Do not
  send the break's own progress as the building's progress.
* A new `work` call after a break or a completed block starts a fresh stack on top of whatever stands on today's lot.
* **Topping out**: when a rated block adds floors to today's tower (the next `setDays`) the scene runs the ceremony by itself: the crane lifts a last beam
  with a little evergreen tree and a flag, sparks fly, the windows light up, the scaffolding comes down and the site is cleared a few seconds later. The
  host may also send `phase:'topout'` or call `toppingOut()` to run it explicitly (for example straight after `POST /api/pomodoro/rate`).
* Where: today's lot (`isToday` in `setDays`), crane on the back sidewalk, rising block on the roof of what already stands (or on the plot).
  The target-crown blueprint outline is hidden while the site is shown.
* A host with class `stage--cam` is framed on today's lot automatically (and ignores `focusDay`).

**Weather.** `clear` thin cloud shadows and a few puffs, `clouds` more clouds, flatter light, windows glow a little more, `rain` and `storm` streaks
(about 2000 at most, instanced in the vertex shader), wet-street glow, the odd soft lightning flash in a storm, `snow` flakes and white roofs and
pavements, `fog` low mist and a shorter fog distance. `available:false`, `enabled:false` or no condition clears everything. Values ease in about 3 s.
Reduced motion: values snap, nothing falls or drifts.

**Seasonal keys** (all cosmetic, built on first use): `halloween` pumpkins on the stoops and a few bats at dusk, `diwali` diya lamps, a rangoli and fireworks at
night, `thanksgiving_week` a parade balloon over the east avenue and falling leaves, `holiday_lights` bulb garlands, a lit tree in the plaza and a light
flurry (not while it rains), `nye_ball_drop` the ball on the Times Square tower (it drops in the last minute before midnight) with fireworks, `new_year` the
ball and fireworks, `cherry_blossoms` pink trees and drifting petals, `holi` colour splashes and puffs, `july_4th`, `india_independence_day` and `pride` flags
(pride also paints a rainbow crosswalk), `nyc_marathon` a finish arch and runners. Unknown keys are ignored. Fireworks only show at night and not under reduced motion.

**Flow.** Eight brass streetlights stand along the front street of the current block. `hours_lit` lights that many, left to right, one at a time with a
little flicker; the next one glows faintly and grows with `minutes` / `to_next_hour_min`. Lamps never go out as a penalty: they simply stop growing.

Debug: open any page with `?city-debug=1` and use `window.__city.week` / `window.__city.city` (the API plus `debugState()` and a `dbg` bag with the
modules). `dbg.seasonal.forceFireworks(true)` shows fireworks in daylight.

## 6. Settings

`input[data-js="game-setting"][name=KEY]` changes call `POST /api/settings/game` with `{KEY: value}` and apply instantly on this screen:

| name | control | value sent |
|---|---|---|
| `quiet_mode`, `sound`, `hide_achievements`, `game_enabled` | checkbox | boolean |
| `motion` | radios `auto|on|off` (or a checkbox with `data-on-value`/`data-off-value`) | the radio value |
| `three_d` | radios `auto|off` (or checkbox with `data-on-value="auto" data-off-value="off"`) | the value |
| `sky_tz` | radios `local|ny` | the value (`local` = local time, anything else = New York) |

Theme (this browser only): `input[data-js="theme-choice"][value=auto|light|dark]` radios. Wrap each in a normal `.switch` or `.seg`.
The existing Rules/Connections forms are untouched plain forms.

## 7. HTMX events

`HX-Trigger: {"witness:events": [...]}` is handled (htmx 2 puts the array in `event.detail.value`): receipt toast, celebrations, then a refresh. Redirected form posts drop HX headers, so those paths show the flash message instead (`.flash`, `.callout`, `.banner` are styled).

## 8. JSON the client reads (assumptions marked A)

* `GET /api/world?days=N` and `POST /api/log` exactly as docs/game-design.md 9.4 (the pages ask `days=all`: every week since Day 1, each day with `slot: {n, week, wd, lot}`, plus a `year` block `{slots, rows, day_one, first_monday, today_slot, built, full}`; `days=N` still returns the last N days as whole Monday-to-Sunday rows). Per day it also reads `floor_met` / `target_met` if present (A), otherwise derives them (`status` floor/repaired, any output, `deep_minutes >= config.floor_min`; crown = `floors >= target_floor`). `status` values from rules.py: floor, repaired, rest, skip, open, missed, future, before_start. `lamps: [{category, n}]`, `fog_minutes`, `outputs: [{stage, ...}]`.
* A: `GET /api/today` -> `{ok, date, today:{deep_minutes, floors, floor_met, target_met, target_minutes, floor_minutes?, ring:{floor_p, target_p}, over_cap_min}, level:{number, district, into, needed, progress, xp?}, run, quests:[{key,label,sub?,done}], wins:[{text, kind?, category?, detail?, at|when}], repeat:[{category, minutes, note, deep, rest?}], close_dot?}`. Top-level keys instead of `today:{}` and `repeat_chips` instead of `repeat` are also accepted. Missing pieces are simply left as the server rendered them.
* A: write responses carry `ok, toast, today, level, events[]` (`entry` for log/focus). Events: `{kind, size, title, detail, fx:{confetti?, sound?, floors_added?, ladder?|stage?, key?, icon?}}`. Known kinds: log, floor, target (or crown), output, node, comeback, repair, week (or week_kept), level, district, achievement, seal, rest (or skip/day_mark), fog, postcard. Unknown kinds fall back to a toast plus `fx.confetti`/`fx.sound`. The toast text is `title` + `. ` + `detail`. Optional `ladder` (or `stage`) in `fx` picks the landmark and confetti colour (Python, Math, ML/DL, Papers, Writing/X).
* A: `POST /api/log` body for chips is `{category, minutes, deep, rest, note}`, for text `{text}`. `rest` is true only for the Rest chip.
* A: `POST /api/close/label` -> `{ok, remaining_gaps, fog_minutes, events[]}`; `POST /api/close/seal` -> `{ok, recap:{floors, deep_minutes, outputs (count or list), logged_count?}, level?, events[]}` or `{ok:false, hint}`; `POST /api/day-mark`, `/api/outputs`, `/api/focus/stop` -> the write shape above; `POST /api/settings/game` -> `{ok}`.
* A: `GET /api/shelf` -> `{achievements:[{key,name,tier,desc,unlocked,unlocked_at?}], ladders:[{category, landmark, outputs, deep_minutes, linked, nodes:[{n,name,unlocked}], next_node:{n,name,needs_outputs,needs_deep_min,needs_link}|null}], postcards, outputs}`.
* `ok:false` always means "kind message in `hint` (or `message`), show it, change nothing". HTTP 200 is expected for it.

## 9. Behaviour summary (for QA)

Celebrations follow docs/game-design.md 5 (tick/small/medium/big/grand); at most `confetti_daily_cap` (3) ordinary bursts a day (counted in localStorage), comeback, week kept and district always play;
sound is off until toggled; reduced motion (OS or Motion = Off) snaps every tween, hides confetti and builds the 3D scene without springs or orbit; Quiet mode hides XP, levels, quests, floaties and level/achievement toasts;
the page never animates an unconfirmed log; keyboard: `/` focuses the log field (or jumps to Today), `g` then `t`/`c`/`w`/`s` navigates, `Esc` closes the celebration card.
Public handle for debugging: `window.Witness` (`refresh()`, `playEvents(events)`, `toast(o)`, `state`, `prefs`, `scenes`).

## 10. v2 front-end modules (Focus Screen, pairing, soundscape, lines, postcards)

Scripts (all classic, deferred, no build step; base.html loads `app.js`, `audio.js`, `focus.js`, `postcard.js` in that order; `lan.js` only on Settings and `/settings/lan`,
`subway.js` only on World). They share `window.Witness` (app.js) which now also exposes `api`, `clientId`, `applyWriteResult`, `sfx`, `reduced`, `store`, `ico`, `esc`, `fmtMin`,
`ensureScene(s)`, `pushAtmosphere`, `setConstruction`, `catOf`, `dowOf`, `mondayOf`, `labelDate`, `burst`. Every write carries `X-Witness-Client: <id per tab>` so the live
stream can skip a screen's own events.

* **Focus Screen** (`/pomodoro`, template `pomodoro.html`, `kiosk` page: no nav, header or footer). One DOM for every state. `[data-js="focus"]` carries `data-state="idle|work|break|between|done"` (`between` = a work block ended and the run holds until the person answers it: Start break / rate / Keep going),
  `data-paused="true|false"`, `data-pending` (ratings waiting). Hooks: `dial` (`--p` 0..100, `--deg`), `dial-arc`, `dial-time`, `dial-sub`, `phase-pill`, `phase-label`, `cycle-text`, `task-cat`, `task-label`,
  `next-text`, `tips`, `summary`, `start-form` (inputs `preset` incl. `custom`, `work_min`, `break_min`, `cycles`, `category`, `label`; `custom-panel` with `.stepper`s), `between`, `phase-total`, `extend` (form `[data-act="extend"]`, buttons `name=minutes`), `controls` (forms `[data-js="act"][data-act="pause|resume|skip-break|next|stop|stop-discard"]`), `stopbox`,
  `rate` (overlay) with `rate-form` (`block_id`, `category`, `note`, submit buttons `focus=full|mostly|pulled_away`), `rate-keep` (Keep going buttons, `form="keepForm"`), `rate-next` ("Start my break, rate later"), `rate-later`, `rate-bar`, `fullscreen`, `sounds-open`, `sync-state` (`data-mode=live|poll|off`),
  `cam-text`, `cam-dot`, and the 3D `stage[data-stage="week"].stage--cam`. Every control is a real form, so it works without JS. `?new=1` shows the start screen even if a finished run is visible.
* **Run card + start sheet on Today**: `today-run` (hidden unless a run is active or a block waits for a rating; children `run-title`, `run-sub`, `run-clock`), `focus-start` (link; goes to the screen when a run exists),
  `dialog#focusDlg > form[data-js="run-form"]` (posts to `/pomodoro/start` without JS). `focus-dot` (nav) shows while a run is active. `window.Witness.pomodoro` = `{state, remaining(run), onState(fn), fetch(), post(action, body)}`.
* **Flow meter** (Today ring card): `flow-meter` > `flow-lights` (6 `.avlight[style="--f:0..1"]`), `flow-text`, `flow-hours`. **Weather chip** (header): `weather-chip` > `weather-text`. **Seasonal pill**: `seasonal-pill` > `seasonal-text`.
* **Soundscape** (`_soundscape.html`, picker shared by Today and the Focus Screen): `soundscape`, `ss-choice` (radios `off|rain|cafe|brown|subway`), `ss-volume` (range 0..100), `ss-breaks`, `ss-hint`; `WitnessAudio` in audio.js
  (`chime(kind)`, `play(name)`, `stop()`, `setVolume(v)`, `playing()`, `blocked()`, `on(fn)`; set `managed = true` to decide playback yourself). The choice and the level are saved per device in localStorage (`witness.app.ss.sel`, `witness.app.ss.vol`), so one screen never starts sound on another; the server's `soundscape_volume` is only the first-run level and `soundscape` is never used to start sound.
* **Tablet panel** (`_lan_panel.html`): `lan-panel`, `lan-toggle`, `lan-restart`, `lan-urls`, `copy-url`, `pair-form`/`pair-btn`, `pairing-qr` (`pair-qr-svg`, `pair-code`, `pair-count`, `pair-bar`, `pair-result`), `device-list` (`li.device[data-id]`, `revoke-form`).
  `/pair` (`pair.html`) is standalone (own inline script, no app.js): `pair-form`, `pair-code`, `pair-name`.
* **Lines** (World tab `lines`, panel `#lines`): `subway` (cards `.sline` rendered by subway.js from `GET /api/subway`; the server renders a plain station list first). World tabs now fire `witness:worldtab` (`detail.name`).
* **Postcards**: `postcard-open` (button/link), `postcard-gallery` (thumbnails), `postcard-more`, `postcard-nudge` (Sunday banner on Today), `postcard-list` (`/postcards`). postcard.js builds a `dialog.sheet--postcard`.
  After a seal the app dispatches `witness:sealed` (`detail: {day, res}`); postcard.js then POSTs `/api/skyline` and adds `[data-js="skyline-status"]` ("Sent to your phone" or "Saved") to the recap.
* **Layout**: `.nav` is a full-height grid column from 900px up (`.nav__in` is sticky inside it), and a fixed bottom bar below. Today's bento is two flex columns (`.b-colL`, `.b-colR`) that dissolve into one stack on narrow screens (`.o-1` .. `.o-9` set the order).

## Cozy HUD, missions, chest, coins (cozy.js, docs/COZY.md phase B3)
`app.js` loads `cozy.js` (relative to itself) after it starts. On Today it mounts into the home scene:
- `[data-js="home-scene"]` the apartment scene host (the scene code's). Without one, cozy.js adds `<section class="card cozy-home" data-js="home-scene" data-cozy-fallback>` with an illustrated 2D apartment (`[data-js="home-flat"]`, also shown when the host has class `no-webgl` / `use-svg` or 3D is off; a host child `[data-js="home-fallback"]` replaces it).
- `[data-js="home-hud"]` inside the host (built when missing): `hud-money` (`hud-money-num` counts up), `hud-job`, `hud-missions` (ring `hud-ring`, `hud-missions-n`), `hud-chest` (`hud-chest-n`, class `is-ready` glows), `hud-stars`, `hud-decorate`, `hud-outside`. Money, missions, chest and stars carry `data-quiet-hide data-game-only`.
- `form[data-js="home-dock"]` the docked log bar (`dock-text`, `dock-btn`, `dock-status`), first in the host so Tab reaches a log input first; posts through `Witness.sendLog`.
- `_cozy_drawer.html` (included by today.html): `dialog#missionsDlg[data-js="missions-dlg"]` (`missions-list`, `missions-msg`, `missions-chest`, `mchest-open`) and `template[data-js="chest-tpl"]` (the chest layer: crate, rays, `chest-card`, `chest-items`, `chest-collect`).
Events: `witness:write` {res, entry, source, before, today} (app.js, every write), `witness:money` {delta_cents, balance_cents, prev_cents, economy, source} (money.js, every savings change), `witness:setting` {name, value} (app.js, every game setting).
Scene hooks it calls when present (all optional): `Witness.cozy.react(kind, detail)` with kind `wave | ack | log | deep | doors | crown | output | floor | mission | chest_ready | chest_open | chest_done | three_stars`; `Witness.cozy.decorate({item, select})`; `Witness.cozy.unbox(item)`; `Witness.cozy.setChest(chest)`; `Witness.cozy.setMissions(missions)`; `Witness.cozy.refresh()`.
It offers `Witness.cozyUI = { coins(from, cents, {balance}), refresh(), openMissions(), openChest(), decorate({item}), unbox(item), setSource(el), summary() }` (a 3D chest in the room calls `openChest()`; a block-done card calls `setSource(card)` before its write).
Store cards (`_item_card.html`) carry `data-category` and `data-name`; furniture and outfit cards get a 3D picture from `city/thumbs.js` (one shared offscreen renderer) in `.item__art.has-3d` (`img.item__3d`, `canvas.item__spin` for the slow turn on hover/focus) and an `.item__act-line`.
