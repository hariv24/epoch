# Epoch game design: "Your New York"

Status: design only. No code under `epoch/` has been changed. Date: 2026-10-17.
Author role: game designer. Inputs: four research reports (gamification evidence, fun-app teardowns, 3D/web tech, design system), `docs/ARCHITECTURE.md`, and the current `epoch/schema.sql` and `epoch/web/app.py`.

**Sourcing note.** I did not re-open the papers or pages myself. Every URL below was opened by one of the four research agents, and I keep their labels: **[opened]** = read in full or in part, **[excerpt]** = abstract or snippet only, **[secondary]** = blog or summary. Numbers marked **[estimate]** are mine and are starting values to tune after two weeks of real use. Nothing here is a measured result for this app.

---

## 0. The design in one page

- **Core fantasy:** every honest hour and every shipped output builds *your own New York*. One day = one tower. Deep minutes are floors, the target is a lit crown, a shipped output is a rooftop beacon, and five ladders (Python, Math, ML/DL, Papers, Writing/X) each grow a landmark. The city is real Manhattan, rising from Morningside Heights, where you start; levels light up its neighbourhoods one by one, out to the supertall corridor on 57th Street, where the dream home is (§4.2). Nothing is outside Manhattan.
- **Why this one, not the subway line or a pet:** it is the only option that is a *persistent record of real work* (the shared trait of Forest, Habitopolis and the GitHub graph), it maps one-to-one onto the existing day, week and 168-hour model, it carries the user's real emotional anchor (New York), and it is shareable on X as an image, which serves the daily-posting goal. The subway line is linear and has little to tend each day. A pet is a mood, not a record, and its novelty decays (Finch, Focus Friend) [opened, fun-app teardowns]. A pet may be revisited in v2.
- **The one rule that keeps it from backfiring:** the game is a **mirror, not a paycheck**. The city shows what you did. It never pays you per hour, never punishes, never takes anything away, and every message is a fact about your work, not an instruction.
- **The hourly hook:** open, type one line or tap one chip, and in under a second a tower floor springs up, a window lights, and the ring moves. Rare things (floor met, target met, output, comeback, level, kept week) get bigger celebrations in proportion to how rare they are.
- **UI:** four tabs only: **Today, Close, World, Settings**. Plan, Week, Grid and Outputs fold into these.

---

## 1. Resolving the tension: fun that doesn't backfire

### 1.1 What the evidence says (cited from the research reports)

| Finding | Source and label | What it means for us |
|---|---|---|
| Engagement-, completion- and performance-contingent rewards undermined free-choice intrinsic motivation (d = -0.40, -0.36, -0.28). Positive informational feedback raised it (d = +0.33 free choice, +0.31 interest). "Should"-worded feedback undermined it. | Deci, Koestner & Ryan 1999, https://depts.washington.edu/techdocs/papers/deciExtrinsicRewardsAndIntrinsicMotivation99.pdf [opened] | Reward lines state facts about the work. No "keep it up", no "you should". No spendable currency for showing up. |
| Unexpected rewards did not undermine (d = 0.12, cited summary). Contested by Cameron and colleagues. | same PDF [opened]; Cameron [excerpt] | Surprise is allowed in *content*, never as a chance-based drop tied to effort. |
| Points, levels and leaderboards did not change intrinsic motivation but raised the quantity of work done. | Mekler et al. 2017 [excerpt only] | Points can serve the user's goal here (quantity plus consistency), but they act as extrinsic incentives. So they stay a readout and can be hidden. |
| Habitica-style loss mechanics: all 45 studied users reported some counterproductive effect; harm tracked with finding the reward system inappropriate. | Diefenbach & Müssig, https://epub.ub.uni-muenchen.de/77668 [opened] (n = 45, small) | No health, no death, no lost gold. The user can tune or turn off the system. |
| Mandatory badges plus a leaderboard lowered motivation and exam scores over 16 weeks. | Hanus & Fox [secondary] | No leaderboard. No mandatory badges. Compete only with your own past. |
| Duolingo: separating the streak from the daily goal raised day-14 retention +3.3% (relative); two streak freezes instead of one raised daily actives +0.38%. | https://blog.duolingo.com/improving-the-streak/ and https://blog.duolingo.com/how-duolingo-streak-builds-habit/ [opened] | The "run" depends only on the 30-minute floor. The target never breaks it. Rest tokens look like a feature. |
| Streak-extension animation plus a bigger one on milestones: +1.7% 7-day retention for new learners (relative). | https://blog.duolingo.com/how-duolingo-streak-builds-habit/ [opened] | The only quantified juice result found. Scale celebration by rarity. |
| Progress monitoring is itself effective (d+ = 0.40 on goal attainment, larger when recorded or reported). | Harkin et al. 2016, https://eprints.whiterose.ac.uk/id/eprint/91437/ [excerpt] | The log is the product. Make logging the best-feeling moment in the app. |
| Goal gradient: people speed up near a reward; post-reward slump follows. Endowed progress: 12-stamp card with 2 free stamps finished about 20% faster (12.7 vs 15.6 days). | Kivetz, Urminsky & Zheng 2006, https://www.columbia.edu/~rk566/Session4/Goal-Gradient_Illusionary_Goal_Progress.pdf [opened] | Nested rings that accelerate near the end. Next goal appears immediately after one closes. Only *honest* head starts. |
| A mechanic copied without its reason is "a boring, tacked-on nuisance" (Duolingo moves counter: neutral result). | https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth [opened] | Every mechanic below has a one-line "works because" justification. |
| YPT's hour-ranking leaderboard bred cheating and unhealthy rivalry. GitHub's graph produced guilt; one commenter's streak drifted from the real goal. | https://rafflespress.com/2025/02/13/yawns-pains-and-tears-on-ypt/ [opened via search]; https://www.hanselman.com/blog/github-activity-guilt-and-the-coders-fitbit [opened] | No rankings. Guard against Goodhart: the skyline must not reward quantity over outputs. |
| No controlled evidence that 3D or heavy animation raises repeat use of a self-tracking app. | gamification-evidence report [no study found] | 3D is justified only because it doubles as progress visualisation. |

### 1.2 The seven design rules that follow

1. **Mirror, not paycheck.** Rewards inform ("Output 2 of 2 this week"). Nothing is spendable. No shop, no coins, no gems.
2. **Reward the behaviours, cap the hours.** The big payouts are verified outputs, kept weeks, comebacks and honest logging. Deep minutes earn a small, capped amount; beyond 4 deep hours in a day they earn nothing (see §4.1).
3. **Honesty is never the worse path.** A drift hour, a rest hour and an Unknown hour are logged with one tap, appear in the city with the same dignity as a deep hour, and are never red. If admitting a lapse looked worse than hiding it, users would hide it (the YPT lesson).
4. **No loss, ever.** Nothing shrinks, burns or resets. A missed day is an empty lot under scaffolding. Levels, achievements and totals only go up.
5. **Celebrate in inverse proportion to frequency.** The hourly log gets a quick, quiet reward. The comeback day gets the loudest animation in the app.
6. **Surprise in content, not in chance.** No loot boxes, no random drops tied to effort. Postcards (§6.4) arrive on events that already happen, with content you did not choose.
7. **User control.** One "Quiet mode" switch hides all points, levels and quests and keeps only the city. (Todoist ships the same off switch [opened: https://www.todoist.com/help/articles/introduction-to-karma].) Sound is off by default. Reduced motion is honoured.

### 1.3 Risks we knowingly accept

- XP and levels act as extrinsic incentives (Mekler [excerpt]). We accept that because the user asked for gamification and the goal is consistent quantity. Mitigation: XP is an unspendable readout, the majority of XP in a normal week comes from outputs and kept weeks rather than raw time **[estimate: hours are about a quarter of weekly XP, see §4.1]**, and Quiet mode exists.
- Novelty decay is the long-term risk (Finch's "can become a chore" [opened: https://habitbox.app/blog/finch-app-review]). Mitigation: sky and seasons change, landmarks unlock over months, and the world view always has something new to look at (§6.5).
- Self-report cannot be policed. We cap rather than police, and we do not make any reward large enough to be worth faking.
- **Self-check built in:** at week 4, Settings shows "Is the game layer helping?" comparing logged coverage per day, floor-day rate and Close rate in the weeks before and after the game layer was switched on (§9.5). It is n = 1 and confounded, and it says so.

---

## 2. Core fantasy and how the existing rules map onto it

**Fantasy: you are building your own Manhattan, one honest day at a time.** You open the app and see your city at the hour it really is. Each day is a tower on your street; each week is a row of seven; each 28 days is a block. Five landmarks (one per ladder) rise behind the street as you ship real work. The camera is yours: drag to look around, tap a tower to see its day.

### 2.1 Mapping table (every rule in `ARCHITECTURE.md` has a visual)

| Existing rule | In the city | Feedback when it changes |
|---|---|---|
| **Deep minutes** (union of intervals, clipped to the day, after sleep cutoff excluded) | **Floors.** 1 floor per 15 deep minutes **[estimate]**. Max 16 floors (= 240 min = `deep_cap_minutes`). | New floor springs up with a "thunk"; window lights in staggered order (max 8 animate per log). |
| **Deep minutes above the cap** (shown, never counted) | "Zoning limit". The tower stops at 16 floors. The extra shows as small text "+35m, past the cap". It earns no XP. | Quiet text, no animation. |
| **30-minute floor** (or 1 output) | **Doors open.** At 2 floors the ground-level door lights and the inner ring closes. The tower is "occupied". | Inner ring snaps mint, small pop, small burst (12 particles). Once per day. |
| **Daily target** (90 min weekday / 180 min weekend; capped at 240) | **Crown.** A glowing band at the target floor (floor 6 weekday, floor 12 weekend). Reaching it lights the crown. | Outer ring closes, band flares amber, medium burst (40 particles). Once per day. |
| **Verified output** | **Rooftop beacon** in the ladder's colour, plus a new section on that ladder's landmark. Also satisfies the floor. | Beacon rises, landmark section lifts into place, big burst. |
| **Honest log of a non-study hour** (Distracted, Rest, Food, Social, Day job...) | **Street lamps** at the base of that day's tower, one per logged hour, category-tinted. Distracted uses a warm grey, never red. | Lamp fades in. Toast states the fact: "40m Distracted logged. The map is accurate." |
| **Unknown** (honest "I don't remember") | **Fog patch** on that day's lot. Allowed forever. Resolving it at Close lifts the fog. Leaving it is fine. | Close: fog lifts with a soft wipe. |
| **Weekly contract** (2 outputs + floor on 5 of 7 days) | **Stamp card:** 2 output slots + 5 floor pips on the week's card; the row of 7 towers sits under it. Kept = the row gets its roof lights and a postcard (§6.4). | Each stamp lands with a press animation. Kept: row lights up left to right. |
| **Skips / rest day** (2 per week) | **Park tiles** (Central Park squares) on the day's lot, calm lilac with a moon. Shown as "2 rest tokens this week". | Tile slides in. Toast: "Rest day logged. 1 token left this week." No penalty visual. |
| **Missed day** | **Empty lot with scaffolding.** Neutral grey-lilac. Never red. | Nothing happens on the day itself. The next morning offers the existing lapse flow. |
| **Repair window (48 h)** | **Scaffolding stays up** on the lot for 2 days. If the floor is met on both next days, the foundation is poured and the tower finishes (status `repaired`). | "Scaffolding comes down" animation when repaired. |
| **Comeback day** (a floor day after a missed or repaired day) | **Crane day.** A crane lifts the first floor into place, with the warmest, biggest celebration. | See §5.4 (the grandest non-level effect). |
| **Closing the day** | **Lights-out ritual.** The day's tower is "sealed": fog lifted, lamps glow, a short night-lights wipe, then tomorrow's empty lot appears. | See §5.6. |
| **Run** (consecutive floor, skip, rest, repaired days) | Small flame pill, small type. Never the headline. | Extends quietly. The headline stays "weeks kept" (existing rule). |
| **Lifetime totals** | **Never-resetting counters:** deep hours, days shown up, outputs shipped, weeks kept, comebacks, best run. | Only ever go up. |
| **168-hour grid** | Becomes "Hour map", a lit-windows view of one week (Week tab). | n/a |
| **Telegram log and focus** | Same events, same one-line fact in the receipt. | Receipt text only. |

Notes:
- **Best run** needs a new pure function (`best_run`), because `current_run` only looks back from today.
- The fantasy is deliberately about *work done*, so a day with no activity has nothing to "lose": its lot just waits.

### 2.2 Why not endowed progress on the contract card

Endowed progress works with a stated reason (Kivetz [opened]). The contract rule is "5 of 7 days" and I will not show a pip as filled when it is not. So the head start is **real carry-over only**: (a) XP above a level threshold carries into the next bar, shown as "already 12% into Central Park", and (b) a rest day declared in advance fills a rest token pip. No fake stamps.

---

## 3. The loops

### 3.1 Hourly loop (the one that decides whether this app lives)

```
 open (laptop tab, or pinned) 
   -> the city is at the right sky for the hour; today's tower is visible; the log field is focused
   -> ONE of:  tap a "repeat" chip (last 3 distinct logs)  |  type one line + Enter  |  tap a duration chip + Log
   -> response in < 1 s (regex path; JSON, no page reload)
   -> floor springs up, window lights, ring moves, one-line fact toast
   -> see the world change (and nothing else to do: close the tab)
```

Time budget **[estimate, to be measured]**:

| t (ms) | What happens |
|---|---|
| 0 | Button sinks 4 px (CSS, 80 ms). Input keeps its text until the server confirms. |
| 30 to 150 | `POST /api/log` returns JSON (regex parse is synchronous SQLite and takes milliseconds). |
| +0 after response | Ring arc tweens 600 ms ease-out; the minutes number counts up (CSS `@property` or `tickTo`, 700 ms). |
| +60 | Tower floors spring up (k=60, c=9, about 9% overshoot, settles about 1.4 s) with 40 ms stagger, max 8 floors animate. Windows light. |
| +120 | Toast: one fact line, auto-dismiss 4 s, `role="status"`. |
| +180 | Wins feed prepends the new line with `@starting-style` entrance. |

- The **LLM fallback** (`parse_log_smart` with a free OpenRouter model) can take seconds. In that case the log button shows "Reading..." (a spinner, the only infinite animation) and **no reward animation plays until the server confirms**. We never animate an unconfirmed log. This is the one exception to the 1-second target and is stated in the UI.
- An unparseable line returns `ok: false` with a kind message and keeps the text in the field. No red, no shake.
- **No reward for opening the app, orbiting the city or toggling the 3D.** Nothing is farmable by engagement alone.

What makes it fun every hour (design intent, not a measured effect): the sky really is different each hour; the glow at night; the floor-landing thunk; the ring accelerating (goal-gradient) as it nears the floor and target; the toast's small fact; the wins feed, which is never the same twice; and the fact that an honest drift hour still *adds something to the city*.

### 3.2 Daily loop

1. **First open of the day:** the new lot is empty with a survey stake. Three tiny quests are shown (§4.4). If yesterday is missed and has no lapse row, the existing lapse banner appears as a calm card ("Sunday didn't reach the 30-minute floor. Mark it as rest, repair it, or let it go. No penalty either way."). If the repair window is open, scaffolding is shown with "2 days to finish it".
2. **Through the day:** hourly loop. Floor (30 min or 1 output) closes the inner ring. The target opens straight away, already partly filled by the same minutes (post-reward slump mitigation [Kivetz, opened]).
3. **Evening:** the Close tab shows a quiet dot from `bedtime - 60 min`. Close walks the existing flow (job block, gaps with ActivityWatch guesses, "Don't remember" = Unknown), then **Seal the day**. Sealing plays the lights-out ritual and shows a **day recap card** with a "Save as image" button (§5.6).
4. A day is *closed* when `rules.gaps(conn, d)` is empty and (if a job day) `job_block_closed` is true. This is **derived**, with no new stored counter. The Seal button only appears when that holds.

### 3.3 Weekly loop

- **Monday ceremony** (the existing "fresh start" landmark, Dai, Milkman & Riis 2014 [excerpt: https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf]): a fresh week row slides in, a new contract card shows with the carry-over level progress, and the existing keep/raise/lower contract choice is one tap. A faint **ghost line** shows last week's pace (compete only with your past).
- **Through the week:** stamps land on the card. The week can become *kept* before Sunday.
- **Sunday 18:00 slot (existing):** the "week unveiled" screen. Kept: the row of towers lights up left to right, a postcard arrives, a landmark section may lift. Not kept: the row stays exactly as built, the copy is neutral and forward-looking ("3 of 5 floor days, 1 of 2 outputs. Monday starts a fresh card."), and the same fresh-start ceremony follows. No red, no "failed".
- **Monthly:** the 28-day city is a "block". On the first of the month World offers "Save this block as an image".

---

## 4. Progression

Everything below is **computed from existing data** (entries, outputs, day marks, lapses, contracts, focus sessions). The only stored game state is an **append-only ledger** (§4.6) that records *what has been celebrated* and a *ratchet* so nothing is ever taken away.

### 4.1 XP: sources and caps **[all numbers are estimates to tune after 2 weeks]**

XP is a readout of progress ("distance to the next district"), not currency.

| Source | XP | Cap and notes |
|---|---|---|
| Deep minute (ladder categories that pass `counts_toward_floor`) | 1 XP per 4 minutes | **Capped by `deep_cap_minutes` (240)**: max 60 XP per day. Hours past the cap give 0. Uses the existing union-of-intervals deep minutes. |
| Floor day (floor met, or `repaired`) | +10 | Once per day. |
| Target day (`target_met`) | +15 | Once per day. |
| Verified output | +100 | First 3 outputs per day earn XP; later ones are recorded but give 0. |
| Output with a link (`url` present) | +25 more | Per output, same 3-per-day cap. |
| Comeback day (`DaySummary.is_comeback`) | +30 | Once per comeback. |
| Closed day (§3.2) | +10 | Once per day. Any content counts, including an all-Unknown day, so honesty never loses. |
| Week kept | +100 | Once per week. |
| Ladder node unlocked (§4.3) | +50 | Once per node (25 nodes lifetime). |
| Honest log, rest hour, Unknown, Distracted | 0 | **Deliberately no XP.** They are rewarded in the city (a lamp, a park, a fog patch lifting) and by achievements. Paying XP per log would be an engagement-contingent reward (d = -0.40) and would invite log-spamming. |
| Achievements | 0 | Recognition only. No double-dipping. |

**Sanity check, typical good week [estimate]:** deep work about 810 min (5 weekdays at 90 min plus 2 weekend days at 180 min) = about 200 XP; 6 floor days = 60; 5 target days = 75; 2 outputs with links = 250; 6 closed days = 60; week kept = 100; one node = 50. Total about 800 XP, so deep minutes are about a quarter. Outputs plus kept week plus nodes are about half. Raw time cannot dominate, and a 14-hour day earns exactly what a 4-hour day does from time.

### 4.2 Levels are districts

Cost to go from level L to L+1: `150 + 50 * L` XP. Cumulative XP to reach level L: `150(L-1) + 25 L (L-1)`.

| Level | Cumulative XP | At about 800 XP per good week [estimate] |
|---|---|---|
| 2 | 200 | day 2 |
| 5 | 1,100 | about week 2 |
| 10 | 3,600 | about week 5 |
| 20 | 12,350 | about week 15 |
| 30 | 26,100 | about week 33 |

Districts (a journey metaphor, **not a promise of admission**). The ladder is a walk out from home across **real Manhattan, and nothing outside it**: Level 1 is Morningside Heights (the user's block and Columbia, lit from the first day); every two levels light the next neighbourhoods of the real map (the 3D city, `docs/MANHATTAN-DATA.md`); the island is lit by Level 28, and the last level, the crown, is Billionaires' Row. The XP curve and the ratchet are untouched: only names and what lights up changed, so existing users keep their XP and simply find themselves in a new district.

| Levels | District | Lights up (NYC neighbourhood tabulation areas) |
|---|---|---|
| 1 to 2 | Morningside Heights | MN0901. Home: the block and Columbia |
| 3 to 4 | Harlem | Manhattanville, Central, East and Hamilton Heights (MN0902, MN0903, MN1001, MN1002) |
| 5 to 6 | Upper West Side | MN0701 to MN0703 |
| 7 to 8 | Central Park | MN6491 |
| 9 to 10 | Upper East Side | MN0801 to MN0803, East Harlem (MN1101, MN1102) |
| 11 to 12 | Hell's Kitchen | MN0402 |
| 13 to 14 | Midtown & Times Square | MN0502, MN0604, MN0661 |
| 15 to 16 | Chelsea | MN0401 |
| 17 to 18 | Flatiron & Gramercy | MN0501, MN0601 to MN0603 |
| 19 to 20 | Greenwich Village | MN0202, MN0203, MN0303 (Washington Square) |
| 21 to 22 | SoHo & Tribeca | MN0201, MN0102 |
| 23 to 24 | Lower East Side | MN0302, MN0301 |
| 25 to 26 | Financial District | MN0101, MN0191 (down to the Battery) |
| 27 to 28 | Upper Manhattan | Washington Heights and Inwood: the whole island is lit |
| 29+ | **Billionaires' Row** | the 57th Street corridor, `BROW`: the crown |

Every district is a group of real Manhattan NTAs (all 38 are covered exactly once; `game.DISTRICT_META`). Locked neighbourhoods are not hidden: they sit desaturated in soft fog (`setUnlockedDistricts` in the 3D city), so the map you are filling in is always visible.

**Billionaires' Row, the final boss.** The supertall corridor along W 57th Street and Central Park South (about 8th Avenue to Park Avenue: Central Park Tower, 111 W 57th (the Steinway Tower), One57, 220 Central Park South, and 432 Park Avenue) is carved out as a district of its own. It is **not** lit by the neighbourhoods around it: it stays in soft mist even after Midtown, and in fact the whole island, is lit, so those towers rise out of the fog on the skyline from every district for the whole game. The goal is always in sight.

- *Home.* The dream is one penthouse with Central Park in the window. Its building is **one constant**, `game.DREAM_HOME_BIN` (the NYC Building Identification Number, default `1090180`, Central Park Tower at 217 W 57th). Any tower listed in `city/manhattan/brow.json` works (111 W 57th is `1023728`, 432 Park Avenue `1088817`): change the number and nothing else.
- *Locked.* A pale light at the top of the home tower, cloud banks around the corridor. The Home view reads "Your home, still in the clouds."
- *At the last level.* The clouds clear; a warm band of penthouse windows lights up near the top of the home tower with a soft beacon, and the Home view's camera moves to a point just outside the penthouse facade (it never goes inside a building) looking **north across Central Park toward Morningside Heights**: the journey starts at the top of the park and ends looking back at it from the bottom.
- *Copy.* The final level-up is "Home, with the park in the window." Warm and plain, no hype, no guilt.
- Nothing in the ladder is outside Manhattan. (The user's real-life plans in `docs/plan.md` are separate and untouched.)

- A level-up is a **district-change moment** only when the district changes; within a district it is a small bar-fill. This keeps the grand effect rare.
- The XP bar shows "Level 7, Central Park" and "330 to Level 8" and always starts with the real carry-over (honest endowed progress).
- The XP bar is the *only* number on Today besides minutes; Quiet mode removes it.

### 4.3 Ladder skill trees (advance on verified outputs)

One tree per `categories.LADDER`: Python, Math, ML/DL, Papers, Writing/X. Each has 5 nodes. A node unlocks when **both** gates hold, computed from `outputs` (stage = category, `deleted = 0`) and deep minutes in that category:

| Node | Outputs in this stage | Deep hours in this stage | Extra |
|---|---|---|---|
| 1 | 1 | 0 | |
| 2 | 3 | 5 | |
| 3 | 6 | 15 | |
| 4 | 10 | 40 | at least 1 output with a link |
| 5 | 15 | 80 | at least 3 outputs with links |

(Values are **estimates**. The hour gate stops one-line outputs from racing the tree. It is a gate, not a payout.)

Each ladder lights **one real building** in the 3D city (or, for Python, a real bridge), section by section, in the ladder's colour, instead of a separate stylised model. The mapping is `game.LADDER_LANDMARKS` (sent in `/api/world` as `landmarks[].bin`):

| Ladder | Real landmark (NYC BIN) | What lights up | Node names |
|---|---|---|---|
| Python | Brooklyn Bridge (no BIN: a bridge) | necklace lights on the cables | Hello Loop, Data Wrangler, NumPy Native, Library Builder, Ship It |
| Math | Empire State Building (1015862) | the lit crown and the mast | Vector Basics, Matrix Moves, Calculus Core, Probability Pulse, Proof Sketcher |
| ML/DL | Chrysler Building (1036156) | the terraced crown and the needle | First Model, Training Loop, Backprop by Hand, Architecture Tinkerer, Reproduced Result |
| Papers | Butler Library, Columbia (1082165) | the colonnade and the roofline, one bay per node | First Read, Summary Post, Annotated Paper, Reproduction, Original Idea |
| Writing/X | One Times Square (1085682) | the screens around the tower | First Post, Small Series, Steady Voice, Long-form, Public Portfolio |

- Each node adds one beacon above the real building's roof (a beacon per section) and brightens its accent light; node 5 completes it. The real building is the same in every view, so a landmark you have only half lit is visible from across the island.
- The ladder view also shows "next node: 2 more outputs and 3h 20m of Math" as an informational line, never as pressure.
- Current phase (`settings.phase`) is just a highlight: the active ladder's landmark pulses when a node is earned.
- **Decision for the user to confirm:** outputs are "self" verified by default (`verified_by = 'self'`). I count them all but require links for nodes 4 and 5. If later a GitHub or X check marks `verified_by` as `github` or `x`, those can replace "has a link".

### 4.4 Daily quests (max 3, tiny, derived)

Quests are three plain goals for today, generated by a pure function of today's state, always in this order. They give **no XP** (to avoid an engagement-contingent reward). Completing one puts a small star on the tower's roof; three stars is the achievement "Clear Skies".

| Slot | Quest | Done when |
|---|---|---|
| 1 "First light" | Log one hour of anything, including rest or drift | Any non-deleted entry today. Honesty, not study. |
| 2 "Doors" then "Crown" | "30 min or one output opens the doors"; once met it becomes "N min to the crown" | Floor met; then target met. |
| 3 "Deep focus" | "Deep focus 4h today", with a progress line under it ("2h 10m of 4h", then "4h of 4h, star earned") | `deep_star_minutes` of deep focus today: 4 h by default, a Settings choice of 3, 4, 5 or 6 h. It counts deep minutes exactly as the rules engine does (minutes after `sleep_cutoff` don't count) but is **not** capped at the 240-minute floor/XP cap, so 5 and 6 h goals work. Outputs and shallow time don't count toward it. It changes no XP and not the ratchet. The old third quest ("Pick today's smallest version") is gone; a pending lapse has its own banner. |

Stars are recomputed from the data on every read, for today and past days alike; changing the goal in Settings re-cuts the stars shown, never XP, levels or already-unlocked achievements.

### 4.4a How a tower grows (the explainer)

A small info button next to "Your week in New York" (Today) and on the Focus Screen's construction cam opens a native popover (`_tower_how.html`, filled from the user's own settings): one tower a day on the Morningside block; 1 floor = 15 min of deep focus; doors open at the 30-minute floor (floor 2); the crown lights at the daily target (90 min on job days = floor 6, 3 h otherwise = floor 12); the tower tops out at 16 floors = 4 h and extra time is shown but not counted; each shipped output adds a rooftop beacon; the three stars; and the late-night rule. Under the hero a live line reads, for example, "Floor 7 of 16 · next floor in 9 min · crown at floor 6 ✓" (`today.tower_line`, also refreshed by `/api/today`).

### 4.4b Which day it is (rollover) and the sleep cutoff

A local day runs from `day_start_hour` (default 4, Settings 0 to 6) to the same hour the next morning. Between midnight and that hour Today shows a calm note: "Still Monday's day until 4:00 AM. Late-night study counts for Monday." (`rollover` in `/api/today`).

`sleep_cutoff` (default 00:30, or `off`) is the time after which deep minutes are still logged and shown but don't count toward the floor, crown, floors or XP. It must fall in the second half of the day (12 h or more after the day starts); Settings refuses a cutoff that doesn't fit the chosen day start, and a saved one that cannot fit is ignored rather than wiping the day. When deep minutes fall after the cutoff Today says so ("50m of deep focus came after your 12:30 AM sleep cutoff. It is shown, but it does not count... You can change the cutoff in Settings."), and once the cutoff has passed it warns before anything is logged.

Changing either setting recomputes every day on read from the UTC entries, so nothing is rewritten. The only stored per-day value that follows is a shipped output's own `local_date`: if it matched the day its timestamp fell on under the old boundary it moves with the new one; a deliberately dated output stays put. XP only ever moves up (the stored high-water mark).

### Lapse flow (wording)

The banner, the lapse sheet and the Telegram card use plain words: "Sunday didn't reach the 30-minute floor", then three choices: **Mark it as rest** (uses one of the week's rest days), **Repair it** (reach the floor today and tomorrow), **Let it go**. The optional last step is "Tonight's minimum plan (optional)": minutes, a start time and a first task, which add one block to today's plan; "No plan" skips it.

Copy rules: always forward-looking and short. Never "you still haven't". Hidden entirely in Quiet mode.

### 4.5 Achievements and collectibles

Tiered easy to rare (Duolingo pattern [opened: https://trophy.so/blog/duolingo-gamification-case-study, vendor source]). No achievement is mandatory, none grants XP, all are computed by a pure rule, and unlocking is recorded once in the ledger. Honest logging, comebacks, closing and shipping are weighted over raw time.

| Tier | Key | Name | Rule (derived) |
|---|---|---|---|
| Easy | `first_light` | First Light | First entry ever. |
| Easy | `honest_hour` | Honest Hour | First entry in Distracted, Rest or Unknown. |
| Easy | `first_floor` | Doors Open | First floor day. |
| Easy | `first_ship` | First Ship | First output. |
| Easy | `first_close` | Lights Out | First closed day. |
| Easy | `first_focus` | In the Zone | First focus session with outcome `full` or `mostly`. |
| Mid | `honest_week` | Honest Week | 7 days in a row each with at least one honest non-deep log (rest, drift or Unknown). |
| Mid | `fog_lifter` | Fog Lifter | Resolve 10 Unknown gaps at Close (count of labelled gaps; derived from entries with `source = 'backfill'` and a category change). |
| Mid | `crown_x3` | Three Crowns | 3 target days in one week. |
| Mid | `week_kept` | Card Complete | First kept week. |
| Mid | `five_ships` | Portfolio Started | 5 outputs total. |
| Mid | `linked_ship` | Receipts | First output with a link. |
| Mid | `all_five` | Five Ladders | At least one output in each of the 5 ladders. |
| Mid | `clear_skies` | Clear Skies | 3 quest stars in one day. |
| Mid | `early_floor` | Early Doors | A floor day whose floor was met before 12:00 local (a fact, not praise for sleeping less). |
| Rare | `first_comeback` | Crane Day | First comeback day. |
| Rare | `comeback_3` | Rebuilder | 3 comebacks (rewarding the recovery habit). |
| Rare | `four_kept` | A Full Block | 4 kept weeks (not necessarily consecutive). |
| Rare | `node_first` | Landmark Begun | First ladder node. |
| Rare | `landmark` | Skyline Piece | Any ladder reaches node 5. |
| Rare | `ten_close` | Ten Nights Sealed | 10 closed days. |
| Rare | `fifty_hours` / `hundred_hours` | 50 Deep Hours / 100 Deep Hours | Lifetime deep hours (counted with the cap). |
| Rare | `thirty_ships` | A Body of Work | 30 outputs. |
| Epic | `district_*` | District arrival | Each district change. |

Collectibles: **postcards** (§6.4) and **city decor** (a cab stand, a hot dog cart, a rooftop water tower) unlocked by a deterministic list on kept weeks (week 1 gets item 1, and so on), never random.

Display: a shelf under World, locked achievements shown as silhouettes with the rule in plain words. A "hide achievements" toggle exists.

### 4.6 Never drifts, never taken away

- **Computed on read:** XP, level, quests, ladder progress, achievement *state*, run, best run, totals. These come from `game.py` over the DB, with no counters.
- **Stored (the only new state):** table `unlocks(key TEXT PRIMARY KEY, kind TEXT NOT NULL, unlocked_at TEXT NOT NULL, meta TEXT)`, append-only, `INSERT OR IGNORE`. It records (a) achievements and ladder nodes and districts when first seen, so they stay unlocked and a celebration fires once, and (b) a ratchet row `xp_hw` holding the highest XP total ever computed.
- **Never taken away:** displayed XP is `max(computed, xp_hw)`. If the user deletes or edits an entry to correct it, XP does not drop. Correcting an honest mistake must not be punished. A test asserts that displayed XP is non-decreasing across any sequence of operations.
- **Celebrations are diffs, not flags:** the events for a write are computed as `diff(snapshot_before, snapshot_after)` inside the same request (§8.4). Reloading the page never replays them.
- **If settings change** (cap, targets), the computed values change going forward and are recomputed for history. The ratchet keeps the displayed total from falling.

---

## 5. Celebration and feedback spec (exact animations per action)

Scale: **tick** (every log) < **small** (about daily) < **medium** < **big** < **grand** (rarest). Tokens come from §7.

| Event | Frequency | Size | Visual | Sound (only if enabled) | Toast copy (facts only) |
|---|---|---|---|---|---|
| **Log a deep hour** | hourly | tick | Ring tween 600 ms. Number count-up 700 ms. Floors spring up (stagger 40 ms, max 8). Windows light. | `tick` | "45m Python logged. 1h 20m deep today." |
| **Log a non-deep hour** (rest, drift, Unknown, other) | hourly | tick | Lamp fades in at the base of the tower (360 ms spring). No ring change. Same weight as a deep log. | `tick` | "40m Distracted logged. The map is accurate." / "Rest hour logged." / "Unknown logged. You can fill it in at Close." |
| **Floor met** | daily | small | Inner ring snaps mint (pop 360 ms). Doors light. 12-particle burst. | `ping` | "Doors open. 34m deep today." |
| **Target met** | daily | medium | Outer ring closes. Crown band flares amber 1.4 s. 40-particle burst. Next goal (bonus: ghost of last week's best day) appears at once. | `ping` | "Crown lit. 1h 32m deep." |
| **Output shipped** | few per week | big | Beacon rises on the tower (spring 600 ms). The ladder's landmark section lifts into place. Camera nudges to the landmark (3D). Confetti 60 particles in ladder colour plus amber. | `levelUp` | "Output 2 of 2 this week." (when contract complete add "Contract outputs met.") |
| **Ladder node** | monthly | big | Landmark pulse, node card slides in, label names the new section. | `levelUp` | "Math: Matrix Moves reached." |
| **Comeback day** | rare | grand (the loudest effect in the app) | Crane swings in, lifts the first floor into place; scaffolding falls away; warm amber and cream confetti, 90 particles, 1.8 s; banner card "You're back." | `levelUp` | "Back on. First floor day since Tuesday." |
| **Repair completed** | rare | big | Scaffolding drops, foundation pours, tower rises in 1.2 s. | `levelUp` | "Thursday's lot is built." |
| **Week kept** | weekly | big | Row of 7 lights up left to right (100 ms each), roof lights, postcard slides in. | `levelUp` | "Card complete. 2 of 2 outputs, 5 of 5 floor days." |
| **Level up (same district)** | about weekly | small | XP bar fills, number pops. | `ping` | "Level 8." |
| **District change** | monthly | grand | The district lights up on the map and the camera flies there, ticker-tape confetti (canvas-confetti, 120 particles), district card. The last one is a quiet warm window instead of a fanfare. | `levelUp` | "Central Park." |
| **Achievement** | irregular | small to medium by tier | Shelf icon pops with a badge card (small); rare tiers use medium burst. | `ping` | "Receipts: first output with a link." |
| **Seal the day** | daily | medium | Lights-out wipe (700 ms): fog lifts, lamps and windows glow, sky dims one step, then tomorrow's lot slides in. | `thunk` | "Day sealed." |
| **Rest day / skip** | up to 2 per week | small and calm | Park tile slides in. No confetti. | none | "Rest day logged. 1 token left this week." |
| **Unparsed line** | rare | none | Field keeps the text. A kind hint appears. No shake, no red. | none | "I couldn't read that. Try \"45m numpy ex 1-12\"." |

**Cap on confetti:** at most 3 bursts per day in total (design judgement, from the design-system report); beyond that, effects fall back to the toast. Comebacks, district changes and kept weeks always play.

**Reduced motion and quiet:** with `prefers-reduced-motion: reduce` (or the in-app Motion = Off) all tweens snap to the end value, confetti is off, the 3D city shows one still frame with no orbit, and toasts still appear and are announced. Sound is **off by default** and needs an explicit tap (also required by browser autoplay rules).

**Voice rules** (these extend "No guilt copy" in `ARCHITECTURE.md`):
- State a fact about the work, in the user's own numbers. Never an instruction or praise-for-effort ("keep it up", "you should", "great job", "don't break your streak").
- Never: failed, wasted, lazy, "streak lost", "your future self", "last chance", countdowns.
- After a miss: short, plain and kind ("Sunday didn't reach the 30-minute floor. Mark it as rest, repair it, or let it go.").
- Compare only against the user's own past ("longest session since you started"), never against norms.

---

## 6. Content systems

### 6.1 The wins feed

A list under the log field of derived, factual one-liners, newest first: "45m numpy ex 1-12", "Output 1 of 2 this week", "Longest session since you started", "Crown lit on a Tuesday", "Back on. First floor day since Tuesday". It has no losses list. Missed days appear nowhere in it. It is built from entries, outputs, day statuses and `unlocks` timestamps, so it is not stored.

### 6.2 Ghost line (competing with your past)

On the ring card and the Week tab, a faint line shows last week's pace for the same weekday. There is no leaderboard and no peer comparison anywhere.

### 6.3 Sky and time

The sky follows **local time** by default (the user studies at night, so windows glow). A setting switches the sky to **New York time** (using `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`, as in the 3D report). A small "NYC 10:42" chip sits in the Today header. India is 9.5 or 10.5 hours ahead of New York depending on daylight saving, so with the NY sky setting the user's evening study sits under a New York morning; that is an optional fun contrast, not the default.

### 6.4 Postcards (surprise in content, not chance)

A postcard is shown on **events that already happen**: a kept week, a district change and a first comeback. The content is not known in advance, but whether one arrives is not random, so it cannot be farmed. v1 ships a small set of plainly fictional vignettes drawn in SVG ("a coffee cart on a corner, early", "a fire escape with a plant"), labelled as illustrations. The user can add their own images and lines in Settings (an admissions page screenshot, a photo of a campus). I ship no real-world facts I have not verified. Postcards are collected in the Shelf.

### 6.5 Fighting novelty decay

- The sky and weather change by real month; seasons tint the street (a deterministic function of the date).
- Decor items unlock on kept weeks from a fixed list.
- Landmarks complete over months, not days.
- Idle city life (instanced cabs along the avenue, moving slowly) is added in the polish phase.
- A "season" refresh of the palette and decor each quarter is a v2 item.

### 6.6 Share as image (serves the "post daily on X" goal)

"Save as image" on the day recap, the week row and the 28-day block renders the skyline (and chosen numbers) to PNG **locally** via `canvas.toBlob` (render once, then capture in the same task; the 3D renderer needs `preserveDrawingBuffer: true` for this, or capture right after `render()`). Nothing is uploaded. The user posts it manually. Which numbers appear is the user's choice (default: floors, level, no output text).

---

## 7. Simplified UI: four tabs

### 7.1 What moves or merges

| Old | New home |
|---|---|
| Today | **Today** (log dominant). Focus timer, Shipped form, plan blocks, lapse banner, repair window all live here. |
| Plan | A **drawer on Today** ("Plan an hour", optional, opened by a small button; `/plan` stays for no-JS). It's optional because the user abandoned a rigid timetable. |
| Close | **Close** (same flow plus Seal the day). |
| Week | **World > Week** (contract stamp card, outputs this week, ghost line, keep/raise/lower contract, referee report text). |
| Grid | **World > Week**, under the card, as the "Hour map" disclosure. |
| Outputs | **World > Shelf** (ledger with link, public toggle, delete). |
| Lapse | A **sheet over Today** (same reasons, same three choices). `/lapse` stays for no-JS. |
| Settings | **Settings** tab (gear on desktop rail, last item on phone bar). |

Navigation: bottom bar of 4 on phones, left rail on desktop (>= 900 px). Icons from one Lucide set with text labels and `aria-current="page"`. Close shows a small dot when it is the evening.

### 7.2 Today (the screen opened 8 to 12 times a day)

**Principle:** logging is the dominant action. Above the fold on a 390 px phone, in order: the log card, the ring, the tower. Nothing else competes.

Layout, mobile (390 px), top to bottom:
1. **Header strip:** wordmark, NYC clock chip, run flame pill (small), gear for theme.
2. **Log card (hero, Clay, raised):** one text field (focused on load, `inputmode` text, placeholder "45m numpy ex 1-12"); a row of **repeat chips** (your last 3 distinct logs, one tap to log again with the current time); duration chips `15m 30m 45m 1h`; category chips (5 ladder + "Rest hour" + "Drift"); a big amber **Log this hour** button (68 px). Pressing Enter in the field also logs.
3. **Ring card:** nested rings (outer = target, inner = floor), centre number "1h 32m", subline as text ("Doors open. Crown in 58m."), with the ghost line for last week.
4. **Tower card (3D hero, 220 px tall on phone):** today's tower in the context of this week's seven towers. Tap a tower to see its day. SVG skyline underneath as the no-JS and no-WebGL fallback.
5. **Quests (max 3):** a thin row of three chips with a check each.
6. **Wins feed** (latest 5, "more" opens World > Shelf).
7. **Action strip:** Shipped (opens a sheet: stage chips, one line, optional link), Focus (start/stop), Plan (drawer), Rest day.

Desktop (>= 900 px) uses a 6-column bento: log card spans 4, ring spans 2; tower spans 4, quests and wins span 2.

**States:**
| State | What shows |
|---|---|
| Day 1 (empty) | Log card, an empty lot with a survey stake, a single quest "First light", XP bar "Level 1, Morningside Heights". No empty-state guilt. |
| Normal | As above. |
| Floor met | Inner ring mint; quest 2 flips to "Crown in N min"; tower shows lit doors. |
| Target met | Crown lit; subline "Crown lit. Anything extra is shown but not counted." (cap note, calm). |
| Past the cap | Text "+35m, past the cap". No extra floors. |
| Pending lapse | Calm card above the log card: "Sunday didn't reach the 30-minute floor. Mark it as rest, repair it, or let it go." (opens the lapse sheet). |
| Repair window open | Scaffolding on the lot plus "2 days to finish Thursday". |
| Focus running | The log card shows a running timer ring; the tower grows live **only on stop** (the entry is created then), so no per-minute animation. |
| Rest day declared | Park tile on today's lot; ring shows "Rest day. Doors stay open if you want them." |
| Quiet mode | No XP bar, no quests, no confetti; city and log remain. |
| Parse failed | Hint under the field, text preserved. |
| LLM reading | Button shows "Reading..." until the server answers. |
| Offline / server down | Toast "Can't reach Epoch on this computer" with the command to start it; text preserved in the field. |
| No JS | The old `POST /log` form flow (redirect with flash) still works. |
| No WebGL or reduced motion | SVG tower (snaps to final state, no animation). |

### 7.3 Close (evening ritual)

Layout: a vertical stepper on one card at a time. Steps: (1) **Day job** (4 one-tap choices, existing); (2) **Gaps** (each shows the unlogged stretch with ActivityWatch's guess as a pre-selected chip plus 5 ladder chips, "Rest", "Drift", "Don't remember" = Unknown); (3) **Recap + Seal**.

- The tower preview sits at the top and updates as each gap resolves: fog lifts, lamps appear.
- Resolving a gap is one tap. Unknown is always an allowed final answer.
- **Seal the day** appears when `gaps` is empty and the job block is closed. Sealing plays §5 "Seal the day" and opens the recap card: floors, deep minutes, outputs, level progress, wins list, and "Save as image".
- The Close tab has no streak language and no "unfinished" counters. If the user skips it, tomorrow it still works for yesterday (`/close?day=`).

### 7.4 World (the "come look at what you built" screen)

Segmented control: **City | Week | Shelf**.

- **City:** 3D (or SVG) view of your year: every day since Day 1 has its own permanent real lot (53 rows of 7, a row per week, Monday to Sunday, in Morningside Heights then the northern Upper West Side); a day with study is its tower for good, a day without stays an empty lot (gravel, low hoarding, a survey stake), days to come are quiet pads; the five landmarks behind. The no-WebGL fallback and the text list show the last 28 days. Drag to orbit, tap a tower for a card with date, deep minutes, outputs, status. Totals strip at the bottom: deep hours, days shown up, outputs, weeks kept, comebacks, best run. All only go up.
- **Week:** the contract stamp card (2 output slots + 5 floor pips + rest tokens), this week's row of 7 towers, outputs list with links, ghost line, Hour map disclosure (the 168-hour grid), contract keep/raise/lower (existing semantics: raising applies this Monday; lowering applies next Monday), referee report text and Telegram send button (existing).
- **Shelf:** achievements (locked ones as silhouettes with plain rule text), ladder trees (5 rows of 5 nodes with "next node" line), postcards, the outputs ledger (stage, what, link, date, public toggle, delete).

### 7.5 Settings

Sections: **Game** (Quiet mode, sound, motion Auto/On/Off, 3D Auto/Off, NY-time sky, hide achievements, postcards upload), **Appearance** (Auto/Light/Dark), **Rules** (all existing `DEFAULT_SETTINGS`), **Connections** (Telegram, OpenRouter, ActivityWatch, AW rules editor; existing), **Is the game layer helping?** (§9.5). The game section ships with every toggle on its safe side: sound off, confetti on at capped size, Quiet mode off.

---

## 8. Visual system: "Night Clay"

Taken from the design-system report (which ran the ui-ux-pro-max skill; its first pick was Claymorphism, #D97706 / #F59E0B / #059669 / #FFFBEB, Fredoka + Nunito). We keep the skill's *physical material* (chunky pressable clay), take Bento for layout and Night-city only as a colour mood, and **reject** Neumorphism (skill rates its accessibility risk high) and neon/cyberpunk (Retro-futurism rated high risk; poor for an app opened hourly). Stock Claymorphism is pastel and reads as a children's app, so the palette is replaced with a dark-first midnight scheme where **amber is the one reward colour** (a lit window). Checklist items from the skill apply: SVG icons not emoji, 4.5:1 text contrast, visible focus, `prefers-reduced-motion`, responsive 375 to 1440 px.

### 8.1 Tokens (light | dark via `light-dark()`)

`color-scheme: light dark` on `:root`, with `data-theme="light|dark"` override. MDN lists `light-dark()` as Baseline 2024 [opened: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark]. Contrast ratios were computed in the design-system report for these exact values (text 4.5:1 or better, non-text 3:1 or better, checked separately per theme).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FFF7E8 | #0D1020 | Page (never pure black) |
| `--s1` / `--s2` | #FFFFFF / #FFF0D6 | #161A33 / #1F2447 | Card / inset |
| `--ink` | #1C1A3A | #F4F2FF | Text |
| `--muted` | #555A86 | #A8AEDC | Secondary text |
| `--amber` | #F59E0B | #FFB224 | Reward, windows, CTA (text on it: #1A1000) |
| `--amber-ink` | #8F4F00 | #FFB224 | Amber used as text |
| `--violet` | #5B4BDB | #9A8CFF | Info, links, focus accent |
| `--mint` | #067A50 | #46E0A0 | Verified, floor met |
| `--flame` | #C2410C | #FF8040 | Run pill only |
| `--sky` | #0369A1 | #5CC8FF | Neutral info |
| `--rest` | #6B5FB5 | #B5AAFF | Rest, skipped, missed: calm lilac, **never red** |
| `--error` | #B42318 | #FF8F8F | Form validation **only** |
| `--focus` | #5B4BDB | #C9C2FF | 3 px focus ring |

Other tokens (radius 10/16/22/30/999; spacing 4pt scale; clay elevation = top gloss + hard lip + soft drop) are in the prototype `tokens.css` and `components.css` (see §10.6).

**Category colours need a change in implementation:** `categories.COLORS` has Distracted as red `#ef4444` (conflicts with "no red for lapses") and Papers as amber `#f59e0b` (conflicts with the amber reward colour). Proposal: Distracted becomes a warm slate-lilac; Papers becomes coral. Windows are always amber regardless of category; the category shows as the facade band tint. Contrast of the new pairs must be re-checked.

### 8.2 Type

Fredoka (headings, level name, the Log button label, weight 600) plus Nunito (everything else, all numerals). Both SIL OFL 1.1. **All ticking numbers use Nunito 800 to 900**, because Nunito's digits are tabular (identical 600-unit width, measured in the design-system report) while Fredoka's are proportional and would jitter. Scale: 13/15/16/20/26/36 px, hero clamp 2.75 to 4.5 rem, body 16 px at 1.55. The rupee sign and arrows are not in the Latin subset; use SVG icons instead of arrow or check glyphs.

### 8.3 Motion tokens

| Token | Value |
|---|---|
| `--dur-instant` / `fast` / `base` / `slow` | 80 / 140 / 220 / 360 ms |
| `--dur-ring` / `--dur-celebrate` | 900 / 1400 ms |
| `--ease-out` | cubic-bezier(.22,1,.36,1) |
| `--ease-in` | cubic-bezier(.5,0,.9,.45) |
| `--ease-spring` | cubic-bezier(.34,1.56,.64,1) (single overshoot, reward moments only) |
| CSS spring | `linear(0,0.243,0.688,1.04,1.194,1.185,1.101,1.016,0.968,0.958,0.972,0.99,1.004,1.009,1.007,1.003,1,0.998,0.998,0.999,1)` (supported Chrome 113, Firefox 112, Safari 17.2) |
| `--stagger` | 40 ms, max 8 items |

Rules: only `transform` and `opacity` animate. Exit about 65% of enter. The only infinite animation is the loader spinner. Under reduced motion all durations collapse to 1 ms and confetti is hidden.

### 8.4 Components

Reuse the design-system recipes: clay `.btn` (sinks 4 px on press), `.card` / `.card--hero` / `.card--well`, `.chip` built from real radio and checkbox inputs (44 px tall, selected state = dot plus border, not colour alone), `.field`, `.ring` (SVG, `pathLength=100`, `--p` 0 to 100, arc turns mint when done), `.xp` bar (transform-only fill), `.pill`, `.skyline` SVG, `.toast` (`role="status"`, 4 s), `.confetti` fallback, 4-item `.nav`. Icons: one Lucide sprite, stroke 2.25, rounded caps: `house`, `pen-line`, `timer`, `moon`, `flame`, `trophy`, `sparkles`, `check`, `plane`, `settings`, `play`, `pause`, `calendar-check`, `target`, `shield-check`, `chart-no-axes-column`, `rotate-ccw`, `sun`, `mountain`, plus `building-2` and `landmark` (all verified present in lucide-static 1.59.0).

Tilt on non-form cards only (max 6 to 8 degrees, mouse pointers only, never under reduced motion).

---

## 9. Technical plan

### 9.1 Vendored libraries (no CDN at runtime, no build step)

| Library | Pinned version | License | Source | Size (gzip) |
|---|---|---|---|---|
| three.js | **0.186.1** (released 2026-09-24; 0.185.1 is the fallback if you want a longer-settled release) | MIT | https://cdn.jsdelivr.net/npm/three@0.186.1 | about 212 KB for core plus the addons below |
| three addons: OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, Pass, ShaderPass, MaskPass, CopyShader, LuminosityHighPassShader, OutputShader | same version | MIT | `.../examples/jsm/...` | included above |
| canvas-confetti | **1.9.4** | ISC | https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js | 4.5 KB |
| Fredoka variable (latin) | @fontsource-variable/fredoka **5.3.0** | OFL 1.1 | https://cdn.jsdelivr.net/npm/@fontsource-variable/fredoka@5.3.0/files/fredoka-latin-wght-normal.woff2 | 29.7 KB |
| Nunito variable (latin) | @fontsource-variable/nunito **5.3.0** | OFL 1.1 | https://cdn.jsdelivr.net/npm/@fontsource-variable/nunito@5.3.0/files/nunito-latin-wght-normal.woff2 | 39.1 KB |
| Lucide icons | lucide-static **1.59.0** | ISC | https://cdn.jsdelivr.net/npm/lucide-static@1.59.0/icons/NAME.svg (19 icons built into one 4.2 KB sprite) | 4.2 KB |
| htmx | existing vendored **2.0.4** | existing | `static/htmx.min.js` | unchanged |

**Not used:** GSAP. It is free for commercial use including its plugins (licence page https://gsap.com/standard-license [opened]) but it is not open source and adds a licence dependency we don't need; CSS, the Web Animations API and the scene code cover every motion here. Zdog, Babylon, PlayCanvas, A-Frame, WebGPU and OffscreenCanvas were considered and skipped (3D report, §7).

**Vendoring gotchas** found by the 3D researcher (they will otherwise bite the builder):
1. In the jsDelivr minified build, `three.module.min.js` imports `./three.core.js`. Save `three.core.min.js` as `three.core.js`.
2. Delete the trailing `//# sourceMappingURL=...` line from both files.
3. Addons import the bare specifier `three` and relative siblings. Mirror the package folder structure and map both `three` and `three/addons/` in the importmap.
4. `OrbitControls` hijacks trackpad scroll over the canvas. Set `enableZoom = false` (or require Ctrl for wheel zoom).
5. Module scripts need a JavaScript MIME type; Starlette `StaticFiles` serves `.js` and `.mjs` correctly on Python 3.10 (checked in `.venv`).

Vendoring commands (run in `epoch/web/static/`):

```bash
V=vendor/three; J=https://cdn.jsdelivr.net/npm/three@0.186.1
mkdir -p $V/addons/{controls,postprocessing,shaders} vendor/confetti js fonts
curl -sL $J/build/three.module.min.js -o $V/three.module.js
curl -sL $J/build/three.core.min.js   -o $V/three.core.js
sed -i '' '/sourceMappingURL/d' $V/three.module.js $V/three.core.js    # macOS sed
curl -sL $J/LICENSE -o $V/LICENSE
for f in controls/OrbitControls postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass,Pass,ShaderPass,MaskPass} shaders/{CopyShader,LuminosityHighPassShader,OutputShader}; do
  curl -sL $J/examples/jsm/$f.js -o $V/addons/$f.js; done
curl -sL https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.4/dist/confetti.browser.min.js -o vendor/confetti/confetti.browser.min.js
B=https://cdn.jsdelivr.net/npm/@fontsource-variable
cd fonts
curl -fLO $B/fredoka@5.3.0/files/fredoka-latin-wght-normal.woff2
curl -fLO $B/nunito@5.3.0/files/nunito-latin-wght-normal.woff2
curl -fL $B/fredoka@5.3.0/LICENSE -o LICENSE-fredoka.txt
curl -fL $B/nunito@5.3.0/LICENSE  -o LICENSE-nunito.txt
```

### 9.2 Where 3D is used, and how it degrades

The two research reports disagreed: the design-system report said "no WebGL on Today" (it must paint instantly and run cool), while the 3D report and the brief want a 3D hero on Today. **Resolution:** Today gets a *small* 3D hero (this week's seven towers, about 220 px tall) that is **lazy-loaded after first paint** (`requestIdleCallback`), never blocks the log field, and uses **render-on-demand** (zero frames scheduled when idle). Because logging is a JSON call with no page reload, the scene is built **once per page load**, not once per hour. World > City gets the full 28-day city with landmarks and orbit. Both use one `city.js` with `mode: 'week' | 'city'`.

Scene design (from the 3D report's tested prototype; copies of `city.js` and `juice.mjs` live in the research scratchpad, see §9.6):
- One `InstancedMesh` for towers, one for windows, one for lamps, plus ground and stars, giving about 4 draw calls (18 with bloom). Measured: 28 buildings, about 1,100 windows, 2,912 triangles, in headless Chrome with a software renderer. **Real-GPU frame rate and battery were not measured**; treat "fine on Apple Silicon" as an estimate.
- Springs (k=60, c=9; measured 9.3% overshoot, settles in 1.43 s) animate floor heights.
- Sky keyframes by hour; bloom (`strength .55, radius .6, threshold .85`) makes lit windows glow; `OutputPass` is required after the composer.
- Pixel ratio capped (`min(devicePixelRatio, area > 1.4 M px ? 1.5 : 2)`, **estimate**, untuned) and bloom switchable.
- Frames are scheduled only when something moves, the tab is visible and the canvas is on screen (`IntersectionObserver` plus Page Visibility). The idle orbit runs 20 s after load or event and then freezes.
- Zero-day = a low foundation slab, never ruins. Missed = scaffolding. Rest = park tile. Fog = a cheap translucent plane.
- Pick: raycast on tap to show the day card.

Fallback ladder (tested in the prototype):

| Condition | Behaviour |
|---|---|
| No JS or module fails | Server-rendered inline SVG skyline stays (the same data, `_city_svg.html`). |
| No WebGL2 | `createCity` returns `null`; SVG stays (tested with `--disable-3d-apis`). |
| WebGL context lost | `.no-webgl` class hides the canvas and shows the SVG. |
| `prefers-reduced-motion` or Motion = Off | One still frame (or SVG), no orbit, no springs, no confetti. |
| 3D = Off in Settings | SVG only. |
| Page hidden or canvas off-screen | No frames scheduled. |

The 3D shows information only. The SVG and plain numbers always carry the same facts. Wiring (importmap in `base.html`; module loaded lazily; city host outside swapped regions so HTMX never destroys the canvas) follows the 3D report §3.

### 9.3 New module `epoch/game.py` (pure functions over the DB)

No I/O beyond SQLite. Uses `rules.day_summary`, `week_summary`, `current_run`, `lifetime_totals`, `consistency`, `gaps`, `categories.LADDER`, `db.get_setting`. Types are dataclasses; Python 3.10; `from __future__ import annotations`.

```python
# --- XP and levels ---
@dataclass
class XPBreakdown: d: date; deep: int; floor: int; target: int; outputs: int; comeback: int; closed: int; total: int
def day_xp(conn, d: date, today: date | None = None) -> XPBreakdown          # one day, applies the caps in section 4.1
def week_xp_bonus(conn, monday: date, today=None) -> int                      # +100 if week status is 'kept'
def xp_total(conn, today=None) -> int                                         # computed sum over history + ladder node XP
def xp_banked(conn, today=None) -> int                                        # max(xp_total, xp_hw ratchet row)
@dataclass
class Level: number: int; district: str; xp: int; into: int; needed: int; progress: float
def level_for(xp: int) -> Level                                               # pure maths: cost(L) = 150 + 50*L

# --- Day / run helpers ---
def day_closed(conn, d: date, today=None) -> bool                             # gaps(d) empty and job block closed on job days
def best_run(conn, today=None) -> int                                         # replay of day statuses
def floors_for(deep_minutes: int, minutes_per_floor: int = 15, cap: int = 240) -> int

# --- Ladders ---
@dataclass
class Node: n: int; name: str; unlocked: bool; needs_outputs: int; needs_deep_min: int; needs_link: int
@dataclass
class LadderState: category: str; landmark: str; outputs: int; deep_minutes: int; linked: int; nodes: list[Node]; next_node: Node | None
def ladders(conn, today=None) -> list[LadderState]

# --- Quests, achievements, wins ---
@dataclass
class Quest: key: str; label: str; done: bool
def quests(conn, today=None) -> list[Quest]                                   # max 3, deterministic
@dataclass
class AchState: key: str; name: str; tier: str; desc: str; unlocked: bool; unlocked_at: str | None
def achievements(conn, today=None) -> list[AchState]                          # state = rule OR ledger row
def wins(conn, limit: int = 20, today=None) -> list[dict]                     # derived factual one-liners

# --- Snapshots, events, ledger ---
@dataclass
class Snapshot: floors_today: int; floor_met: bool; target_met: bool; outputs_today: int; outputs_week: int; week_status: str
    is_comeback_today: bool; repaired: list[date]; xp: int; level: int; district: str; nodes: frozenset[str]
    achievements: frozenset[str]; closed_today: bool; lamps_today: int
def snapshot(conn, today=None) -> Snapshot
def diff_events(before: Snapshot, after: Snapshot) -> list[dict]              # events with kind, size, title, detail, fx
def sync_unlocks(conn, today=None) -> list[str]                               # INSERT OR IGNORE new keys + ratchet; returns new keys

# --- Read models for the UI ---
def today_state(conn, today=None) -> dict                                     # ring, tower, quests, level, wins (for GET /api/today)
def world_state(conn, today=None, days: int = 28) -> dict                     # for GET /api/world
def postcard_for(conn, event_kind: str, ref: str) -> dict | None              # deterministic from the postcard list
def helping_report(conn, today=None) -> dict | None                           # section 9.5
```

Schema addition (additive, safe `CREATE TABLE IF NOT EXISTS`, one new table):

```sql
CREATE TABLE IF NOT EXISTS unlocks (
  key         TEXT PRIMARY KEY,         -- 'ach:honest_hour', 'node:Math:3', 'district:Harlem', 'xp_hw'
  kind        TEXT NOT NULL,            -- achievement | node | district | ratchet | postcard
  unlocked_at TEXT NOT NULL,
  meta        TEXT                      -- JSON (for 'xp_hw': {"xp": 1530})
);
```

New settings keys (in `DEFAULT_SETTINGS`): `game_enabled` (true), `quiet_mode` (false), `sound` (false), `motion` ("auto"), `three_d` ("auto"), `sky_tz` ("local"), `hide_achievements` (false), `game_on_since` (date or null), `minutes_per_floor` (15), `confetti_daily_cap` (3).

Tests required (`tests/test_game.py`): XP non-decreasing under any operation sequence (property-style with random add/delete); hours past the cap add 0 XP; third output per day cap; level maths monotonic and boundary-correct; `diff_events` is idempotent (same snapshots give same events; calling `sync_unlocks` twice returns nothing the second time); quests never exceed 3 and never contain guilt words; copy strings pass a banned-words check (failed, wasted, lazy, "streak lost", "future self", "should", "last chance").

### 9.4 Endpoints

Existing HTML routes stay (so the app works without JS). JSON endpoints are added for the juicy client path. All are local, no auth change.

| Endpoint | Purpose |
|---|---|
| `GET /api/today` | `game.today_state`: ring numbers, today's tower (floors, lamps, fog, outputs), level bar, quests, last 5 wins, repeat chips. |
| `GET /api/world?days=28` / `?days=all` | `game.world_state`: everything the 3D scene needs (schema below). `days=N` is the last N days as whole Monday-to-Sunday rows; `days=all` is every week since Day 1 (the year of lots: each day also carries `slot {n, week, wd, lot}`, and a `year` block has `slots`, `rows`, `built`, `today_slot`). About 0.5 KB a day. |
| `POST /api/log` | Body `{text}` or `{category, minutes, deep, rest}`. Wraps the same logic as `POST /log`. Returns `{ok, entry, today, events[], toast}`. On parse failure `{ok:false, hint}` (HTTP 200, so no red paths in the client). |
| `POST /api/outputs` | `{stage, what, url}` → same response shape. |
| `POST /api/focus/stop` | Same shape (the entry is created on stop). |
| `POST /api/close/label` | Labels a gap → returns `{ok, remaining_gaps, fog_minutes, events[]}`. |
| `POST /api/close/seal` | Seals the day if `day_closed`; returns the recap and events. |
| `POST /api/day-mark` | Rest or skip → same shape. |
| `GET /api/shelf` | Achievements, ladders, postcards, outputs ledger. |
| `POST /api/settings/game` | The toggles in §7.5. |

Each write endpoint does: `before = game.snapshot(conn)` → perform the write inside the existing transaction → `after = game.snapshot(conn)` → `new = game.sync_unlocks(conn)` → `events = game.diff_events(before, after)` (plus ledger-derived events for `new`). The same call is made for the HTML routes, which send the result as an `HX-Trigger: {"witness:events": [...]}` header (unifying the earlier reports' `witness:logged` and `witness:reward` into one event name). Telegram handlers call the same functions and use the first event's title as the receipt line. **HTTP redirects drop HX headers**, so the HTML form fallbacks show the toast via the flash message instead.

`POST /api/log` response:

```json
{
  "ok": true,
  "entry": {"id": 412, "category": "Python", "minutes": 45, "deep": true, "note": "numpy ex 1-12"},
  "toast": "45m Python logged. 1h 20m deep today.",
  "today": {"deep_minutes": 80, "floors": 5, "floor_met": true, "target_met": false, "target_minutes": 90,
            "ring": {"floor_p": 100, "target_p": 89}, "over_cap_min": 0},
  "level": {"number": 7, "district": "Central Park", "into": 330, "needed": 500, "progress": 0.66},
  "events": [
    {"kind": "log", "size": "tick", "title": "45m Python logged", "detail": "1h 20m deep today.", "fx": {"floors_added": 3, "sound": "tick"}},
    {"kind": "floor", "size": "small", "title": "Doors open", "detail": "34m deep today.", "fx": {"confetti": 12, "sound": "ping"}}
  ]
}
```

`GET /api/world` response shape:

```json
{
  "as_of": "2026-10-17T14:02:00Z", "today": "2026-10-17", "tz": "Asia/Kolkata",
  "config": {"floor_min": 30, "target_weekday": 90, "target_weekend": 180, "cap": 240, "minutes_per_floor": 15, "max_floors": 16},
  "level": {"number": 7, "district": "Central Park", "xp": 1530, "into": 330, "needed": 500, "progress": 0.66},
  "totals": {"deep_minutes": 5400, "days_shown_up": 31, "outputs": 12, "weeks_kept": 3, "comebacks": 2, "best_run": 11, "run": 4},
  "days": [
    {"date": "2026-10-17", "dow": 5, "week": 3, "status": "open", "is_today": true,
     "slot": {"n": 29, "week": 5, "wd": 5, "lot": true},            // its place in the year of lots; null before Day 1, lot=false after Day 365
     "deep_minutes": 80, "floors": 5, "target_floor": 6, "over_cap_min": 0,
     "lamps": [{"category": "Distracted", "n": 1}, {"category": "Rest", "n": 1}], "fog_minutes": 0,
     "outputs": [{"id": 9, "stage": "Python", "what": "numpy notebook", "url": "https://..."}],
     "mark": null, "is_comeback": false, "closed": false, "stars": 1}
  ],
  "weeks": [{"monday": "2026-10-12", "status": "in_progress", "outputs": 1, "outputs_required": 2,
             "floor_days": 3, "floor_days_required": 5, "skips_used": 0, "skips_left": 2}],
  "landmarks": [{"ladder": "Math", "kind": "tower", "landmark": "Empire State Building", "bin": 1015862, "outputs": 4,
                 "deep_minutes": 620, "nodes_unlocked": 2, "next": {"name": "Matrix Moves", "needs_outputs": 6, "needs_deep_min": 900}}],
  "districts": {"list": [{"id": "central-park", "name": "Central Park", "first": 7, "last": 8, "unlocked": true, "current": true,
                          "ntas": ["MN6491"], "region": null, "arrival": "The park is lit, end to end. Look for the Reservoir."}],
                "current": "central-park", "next": {"id": "upper-east-side", "name": "Upper East Side", "level": 9},
                "unlocked": ["MN0901", "MN0902", "...", "MN6491"],           // what city.setUnlockedDistricts() takes; 'BROW' only at the last level
                "all_lit": false, "final": {"id": "billionaires-row", "name": "Billionaires' Row", "level": 29},
                "dream_home": {"bin": 1090180, "name": "Central Park Tower", "lit": false, "locked": "Your home, still in the clouds.", "unlocked": "Home, with the park in the window."}},
  "year": {"slots": 365, "rows": 53, "day_one": "2026-10-18", "first_monday": "2026-10-12", "built": 24, "full": false,
           "today_slot": {"n": 29, "week": 5, "wd": 5, "lot": true}},
  "ghost": {"last_week_deep_by_dow": [60, 90, 0, 120, 45, 200, 180]},
  "sky": {"mode": "local"}
}
```

(Fields are sized for 28 days; the pages ask `?days=all`, about 220 KB at the end of the year.)

### 9.5 "Is the game layer helping?" report

`helping_report` compares, for the 14 days before and the 14 days after `game_on_since`: mean logged coverage per waking day (minutes logged ÷ waking minutes), floor-day rate, Close rate (`day_closed`), and entries per day. It displays numbers only, with the caveat "one person, no control group". It appears after 14 days of play. If the numbers are not better, the copy suggests Quiet mode as an option, not a verdict.

### 9.6 Reference material from the research phase

These are scratch files and may be cleaned up, so the implementation phase should copy what it needs: `.../scratchpad/proto/static/tokens.css`, `components.css`, `proto/icons.svg`, `proto/static/fonts/*.woff2`, `proto/index.html`, `proto/shot-{dark,light}-{390,1280}.png` (design); `.../scratchpad/verified/` and `proto/static/js/city.js`, `juice.mjs` (3D and juice, with the bug fixes noted in the 3D report: matrices written after snap, `renderer.info.autoReset = false`, clamped tick progress). Known gaps in those prototypes: no rooftop beacons, no tap picking or tooltips, ground edge visible, stars faint, `_city_svg.html` not written, 3D untested on real GPUs, Safari and Firefox (support from MDN compat data only), and sound unheard. Treat them as starting points.

---

## 10. Build order (so the hook ships first)

1. **Phase 1, the hourly hook (do this first):** tokens, fonts, icon sprite, 4-tab nav, new Today screen (log card, repeat chips, ring, SVG tower, toast), `POST /api/log` with events (floor, target, output, comeback), CSS juice and confetti, reduced motion. No 3D yet. This alone should change how the app feels.
2. **Phase 2, game logic:** `game.py` (XP, levels, quests, wins, snapshot/diff), `unlocks` table, Close with Seal the day and recap, World > Week.
3. **Phase 3, 3D:** vendored three.js, `city.js` week mode on Today, city mode on World, SVG fallbacks, tap-to-inspect, share as image.
4. **Phase 4, depth:** ladders and landmarks, achievements shelf, postcards, decor, NY sky setting, Telegram receipts with the same fact lines, the helping report.
5. **Polish:** idle cabs, seasons, rooftop beacons, sound review by ear.

Acceptance checks: log feedback visible within 1 s on the regex path (measure, don't assume); Today paints and the field is focusable before any 3D loads; app fully usable with JS blocked, WebGL off and reduced motion on; keyboard-only walkthrough and a real screen-reader pass (not yet done anywhere); both themes checked at 375, 768, 1024 and 1440 px.

---

## 11. Guardrails checklist (what must never ship)

1. No punishment visual or mechanic: no hit points, no ruins, no red for missed hours, no "streak lost", no resetting any visible counter to 0.
2. No XP for raw hours past `deep_cap_minutes`; XP never paid per log; nothing spendable; no shop.
3. No leaderboards, no rankings, no peer comparison. Ghost line against your own last week only.
4. No guilt copy and no instructions: facts only (banned words are enforced by a test).
5. No chance-based rewards tied to effort; no countdowns, no fake scarcity, no "last chance".
6. No fake progress; head starts only where real (XP carry-over, declared rest days).
7. Honest logging (Distracted, Rest, Unknown) is never visually or in effort worse than deep logging.
8. Run depends only on the floor. The target never breaks anything.
9. Achievements and levels are never removed; displayed XP is a ratchet.
10. Reduced motion respected by default; sound off by default; one-tap Quiet mode hides every number.
11. Notifications unchanged: existing `msg_cap` per day applies; the game adds none ("protect the channel", Duolingo [opened: Lenny post]).
12. Nothing leaves the machine: share images are made locally; no window titles or app names reach the LLM (existing privacy rule).
13. Landmarks are stylised silhouettes, not copyrighted logos.

---

## 12. Open decisions for the user

1. **Cap on XP-eligible outputs per day (3):** fine, or should one-liner outputs count less than linked ones? (Default: linked +25.)
2. **The dream home:** Central Park Tower by default; one constant (`game.DREAM_HOME_BIN`) to change it to any tower on Billionaires' Row. (Decided: the ladder stays inside Manhattan and ends there.)
3. **Sky default:** local time (glowing night windows) or New York time? (Default: local.)
4. **Companion:** none in v1. Revisit after 4 weeks of data.
5. **Do you want the "Is the game layer helping?" check visible at all?** (Default: yes, in Settings.)
6. All numbers marked **[estimate]** (floor size, XP rates, level curve, node gates, pixel-ratio cap) are first guesses.
