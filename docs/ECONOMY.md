# Epoch economy: "live the NYC life" (spec of 2026-10-22, built the same day)

The user's choices from the brainstorm are the source of truth. The engine is `epoch/economy.py`, the catalog is `epoch/economy_catalog.py`, the tables are at the end of `epoch/schema.sql`, the API is in `epoch/web/app.py` ("Money" section), and the tests are `tests/test_economy.py` and `tests/test_economy_web.py`. Numbers below are the final ones in the code (they were "proposed" in the first draft); every one lives in one constant in `economy_catalog.py` and can be tuned there.

## The fantasy
Study money pays for a growing life in Manhattan. You start in a Morningside Heights studio and work up to the Billionaires' Row penthouse with a Central Park view. You furnish each home, dress a low-poly character of yourself, and collect NYC experiences. The money exists only in the game; it has no real-world value. Nothing in the economy mentions a trip to New York.

## Earning (computed on read from the same honest counters as XP)
| Source | Amount | Cap |
|---|---|---|
| Deep focus | hourly rate by job title (below), paid **per minute** | **No cap** (user's decision, 2026-10-22). Every honest deep minute pays. The sleep cutoff still applies: minutes after it don't count. XP keeps its own 240-min cap. |
| Shipped output | $50 each | 3 per day (same as XP) |
| 3-star day | $50 | once per day |
| Kept week (weekly contract) | $100 | once per week; paid as soon as the week is kept |
| Savings interest | 2% of savings at week close, **kept weeks only** | $200 per week |

### Raises from skills (job title and hourly rate)
The rate follows the number of unlocked skill-ladder nodes (5 ladders x 5 nodes = 25). The node gates need about 75 outputs and 400 deep hours in all, so the last titles take most of a year.

| Title | Nodes needed | Per deep hour |
|---|---|---|
| Barista | 0 | $25 |
| Intern | 2 | $30 |
| Columbia TA | 5 | $35 |
| Research Assistant | 10 | $45 |
| ML Engineer | 16 | $60 |
| Founder | 22 | $80 |

- A raise applies **from the moment the node unlocks** (the timestamp of that node's row in the `unlocks` ledger). If it lands in the middle of a work session, the minutes after it are paid at the new rate; earlier days keep the old rate.
- A node that is unlocked by the counters but not yet written to the ledger counts from "now".
- The node count never goes down (a node, once unlocked, stays unlocked), so the rate is never lowered.

### The ratchet: total earnings never decrease
Money earned is banked per day and source in `econ_earned`, and a row can only go **up** (a SQL trigger ignores a lower value, another refuses deletes). Deleting or editing an old entry therefore cannot shrink savings or make a past purchase unaffordable. Like the XP high-water mark, a day's banked amount is the most it has ever been; new work on a different day always adds. (If you delete work on a day and then add less than before on the same day, that day stays at its old high until you pass it.) Two consequences worth knowing: the 3-star bonus follows the Settings choice for the goal *at the time it is first computed*, and once banked it stays, so raising the goal later never un-golds a day.

A typical good week (13.5 h deep at $25, 2 outputs, 2 three-star days, kept) earns about $640. A strong year at 5 h/day earns roughly $55-60k before raises; a target-hitting year (90 min weekdays, 3 h weekends) about $36k, plus interest.

## Rent (the user chose "weekly rent")
- Rent is due once a week at **week close** (Monday 04:00, the end of the Sunday day). Rent exists only for weeks that have a weekly contract, so it starts with the week of **Mon 26 Oct 2026**, together with the targets. The baseline weeks (Day 1 to Sun 25 Oct) are rent-free.
- Rent is paid from savings, **in full or not at all**. If savings cannot cover it, that week is **unpaid**: nothing is taken, savings never go below $0, and the week is just recorded as quiet.
- The rent for a week is that of the dearest home you lived in during the week, so moving to a cheaper place on Sunday does not skip it.
- **After 2 unpaid weeks in a row you move one step down the ladder** (automatically, at that week's close). The old deposit comes back and the new one is paid. Furniture that doesn't fit the smaller home goes into **storage**; nothing is ever lost. The studio is the floor: from there, unpaid weeks simply pile up quietly.
- **Moving back up is your choice**, any time you can afford the deposit difference. Things sent to storage by a move return first (into the free slots of the bigger home).
- A move costs a deposit of 2 weeks' rent, held while you live there and returned when you move out (it counts toward net worth). The starter studio's deposit is covered, nothing is paid for it.
- Calm copy, no guilt: *"Two quiet weeks, so you moved to a smaller place for now. Your things are safe in storage."*

### Why week-close rows are materialised (not re-simulated on every read)
Rent, interest, an unpaid week and an automatic move are decisions about the past. If the engine re-simulated them on every request, a late backfill or a Settings change could silently flip last month from "unpaid" to "paid" and rewrite the home you lived in. So each week is closed **once**, in order, inside one transaction: ledger rows go in with `INSERT OR IGNORE` on a unique `ref`, one frozen `econ_weeks` row records the recap, and triggers refuse UPDATE and DELETE on both. It is still deterministic and recomputable: a week's rows depend only on the banked earnings up to its Sunday and the ledger before its close, `close_weeks` replays any missing week in order, and `sync` is idempotent (running it twice writes nothing). The balance is always `sum(econ_earned) + sum(econ_ledger.cents)`.

`sync` runs after every game write (inside `game._sync`, so `finish_write` and `sync_unlocks` both do it), on every `GET /api/economy`, `/api/shop` and `/api/world`, and before every buy or move. Weeks that finish while the laptop is off are closed on the next read, oldest first.

## Homes (tied to levels: you can only rent in districts you've unlocked)
Each home is a real Manhattan residential building (BIN from the NYC footprint data in the 3D city; address from PLUTO). `x`, `z`, `base_y`, `height_m` come from the building's LOD0 tile (local metres, X east, Z south), so the room's window can look out from that spot. `floor` is the storey of the home (for the camera height: `base_y + floor * 3.2`; the penthouse uses 100). None is one of the 365 year-of-lots buildings.

| # | Level | District | Home | Address | BIN | Size | Slots | Rent/wk | Deposit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | Morningside Heights | Pre-war walk-up studio | 421 W 118th St | 1059500 | studio | 4 | $150 | $300 |
| 2 | 3 | Harlem | Brownstone floor-through | 124 W 123rd St | 1057741 | 1-bed | 6 | $200 | $400 |
| 3 | 5 | Upper West Side | Pre-war one-bedroom | 575 West End Ave | 1033975 | 1-bed | 6 | $260 | $520 |
| 4 | 7 | Central Park | Central Park West one-bedroom | 55 Central Park West | 1028166 | 1-bed | 6 | $320 | $640 |
| 5 | 9 | Upper East Side | Park Avenue one-bedroom | 620 Park Ave | 1041136 | 1-bed | 6 | $370 | $740 |
| 6 | 11 | Hell's Kitchen | Ninth Avenue walk-up | 404 W 48th St | 1026572 | 1-bed | 6 | $410 | $820 |
| 7 | 13 | Midtown & Times Square | Midtown high-rise one-bedroom | 1752 Broadway | 1024894 | 1-bed | 6 | $440 | $880 |
| 8 | 15 | Chelsea | Chelsea corner loft | 363 W 20th St | 1013243 | loft | 8 | $460 | $920 |
| 9 | 17 | Flatiron & Gramercy | Gramercy Park pre-war | 34 Gramercy Park E | 1017953 | loft | 8 | $480 | $960 |
| 10 | 19 | Greenwich Village | Village walk-up with a fire escape | 19 W 8th St | 1009438 | 1-bed | 6 | $500 | $1000 |
| 11 | 21 | SoHo & Tribeca | Cast-iron loft | 15 Greene St | 1002979 | loft | 8 | $600 | $1200 |
| 12 | 23 | Lower East Side | Mulberry Street corner loft | 30 Mulberry St | 1001805 | loft | 8 | $625 | $1250 |
| 13 | 25 | Financial District | Glass-tower one-bedroom with a harbour view | 10 Liberty St | 1086256 | 1-bed | 6 | $650 | $1300 |
| 14 | 27 | Upper Manhattan | Riverside Drive loft with a river view | 790 Riverside Dr | 1063252 | loft | 8 | $750 | $1500 |
| 15 | 29 | **Billionaires' Row** | **The Central Park Tower penthouse** (`game.DREAM_HOME_BIN`) | 217 W 57th St | 1090180 | penthouse | 12 | $900 | $1800 |

Size tiers and furniture slots: studio 4, 1-bed 6, loft 8, penthouse 12. The one-line descriptions are game flavour ("a floor-through" is the kind of home, not a claim about that unit); BIN, address and geometry are real. `tests/test_economy.py` checks that every BIN is in the city tiles and matches `base_y` and `height_m`.

## Seeing your home: 3D cutaway room (built by the 3D agent from `/api/world`)
Tap your home in the city to open a small low-poly 3D cutaway room in the same style. The room layout depends on the home's `size`. Furniture, art and decor you placed appear in `placed` (slot index -> position in that size's layout). The window shows the **real city from that building's real spot** (`x`, `z`, `base_y`, `floor`), so the penthouse window shows Central Park. Whatever doesn't fit is in `storage`.

## Character
A simple faceless low-poly figure that represents you, not a mascot. `economy.character` (in `/api/economy` and `/api/world`) says what it is doing:
- `studying` while a focus block or Pomodoro work phase runs (`location: "butler"`: at a desk in Butler Library, or the UI shows it at today's lot on the construction cam);
- `walking_home` for 12 minutes after a block ends (`location: "street"`);
- `asleep` at home between the sleep cutoff and the next day start (a gentle nudge, `location: "home"`);
- otherwise `home`.
It wears `outfit`.

## Shop (four aisles, 43,100 dollars in all)
Prices are whole dollars. Items go straight into use when bought (furniture into the first free slot or to storage if the home is full, an outfit is worn, an upgrade is switched on); `POST /api/equip` toggles them later.

1. **Furniture and decor** (1 slot each; tiers basic / nice / penthouse): Desk setup $150, Bookshelf $200, Trailing plant $35, Reading lamp $55, Woven rug $110, Cork board of postcards $45, Framed skyline print $90, Record player $140, Two-seat sofa $380, Reading armchair $320, Fiddle-leaf fig $120, Standing desk $520, Brass telescope $420, Oil painting $650, Espresso corner $280, Upright piano $2,400, Marble-top desk $2,600, Velvet sectional $3,800, Leather lounge chair $1,600, Crystal chandelier $2,200, Silk Persian rug $1,900, Bronze sculpture $3,200, Library wall $4,200, Glass wine wall $2,800, Grand piano $7,500. The penthouse tier (all $1,600 and up) is what takes months.
2. **Outfits** (one worn at a time; Everyday clothes are free and always yours): Columbia-blue hoodie $80, NYU-violet hoodie $80, Plain jersey (no logos) $90, Running gear $120, Library cardigan $140, Winter coat and scarf $220, Navy suit $450, Camel overcoat $1,400.
3. **NYC experiences** (Passport postcards; some district-gated; the gate is the district whose area the place is in): A Columbia lecture $40 and Evensong at St. John the Divine $50 (Morningside Heights), Amateur Night at the Apollo $75 (Harlem), Ballet at Lincoln Center $180 (Upper West Side), A rowboat on the Central Park lake $70 (Central Park), A morning at the Met $60 (Upper East Side), Dumplings on Ninth Avenue $45 (Hell's Kitchen), A Broadway show $260 and Top of the Rock $140 (Midtown), An evening on the High Line $30 (Chelsea), Knicks at Madison Square Garden $320 (Flatiron & Gramercy, where the Garden sits on the map), A jazz club in the Village $90, Gallery hop in SoHo $40, Pastrami at Katz's Deli $35 (Lower East Side), The Staten Island Ferry $25 (Financial District), The Cloisters $45 (Upper Manhattan), Dinner in the clouds on 57th Street $600 (Billionaires' Row).
4. **Tower upgrades** (shown on all your study towers): String lights $150, Painted water tank $350, Awning and doorman $400, Neon sign $500, Rooftop garden $600, Brass doors $700.

Net worth counts furniture, outfits and upgrades at what you paid (no depreciation); experiences are memories (0).

### Events calendar (limited-time experiences)
Real **New York** dates, plus the live NYC weather from `epoch/weather.py` for the snow day. An event can only be bought while it is on; each year is a new postcard (`period` = the year the window opened; the snow day is one per New York date). Rolling windows include both ends.

| Event | Price | Window | Gate |
|---|---|---|---|
| Fall leaves in Riverside Park | $15 | Oct 15 - Nov 15 | Morningside Heights |
| The Village Halloween Parade | $35 | Oct 29 - Oct 31 | none |
| Cheering at the NYC Marathon | $20 | Thu before - Mon after the first Sunday of November | Central Park |
| Balloons on Central Park West | $30 | Wed - Thu of Thanksgiving | Upper West Side |
| The Fifth Avenue holiday windows | $45 | Nov 20 - Jan 5 | Midtown |
| The Rockefeller Center tree | $60 | Dec 1 - Jan 10 | Midtown |
| The Times Square ball drop | $120 | Dec 30 - Jan 1 | Midtown |
| Hot chocolate on a snow day | $18 | live weather is snow, Nov - Apr | none |
| Cherry blossoms in the park | $20 | Apr 5 - Apr 25 | Central Park |
| Smorgasburg on a Saturday | $45 | Apr 4 - Jun 14 | none |
| Shakespeare in the Park | $50 | Jun 1 - Aug 31 | Central Park |
| Fireworks over the East River | $60 | Jul 1 - Jul 4 | none |

## 3-star days
Each 3-star day (first light + doors + the deep-focus goal, `deep_star_minutes`) gives:
- the $50 bonus, once per day;
- a permanent **gold** crown flag for that day (`days[].gold` in `/api/world`, banked, so it never fades) for the 3D crown with a soft light beam;
- a 3-star counter (`stars` in `/api/economy`: `days`, `this_week`, `run`, `best_run`);
- a `three_stars` event (once per day) in the write response, `fx.gold = true`;
- milestone achievements in the existing system: **Clear Skies** (the first 3-star day, already existed), **Golden Week** (3 three-star days in one Monday-to-Sunday week, Rare) and **Seven Clear Days** (7 in a row, Epic).

The deep-focus star threshold is a Settings choice of 3, 4, 5 or 6 h (default 4 h): Settings > "Floor, target and plans" > "Third star: deep focus per day" (`deep_star_minutes`, `db.DEFAULT_SETTINGS`, validated in `SETTING_GROUPS`; `game.deep_star_minutes` reads it, `game.STAR_DEEP_MINUTES = 240` is only the default).

## Rules
- XP maths stay untouched (the ratchet, caps and levels are as before).
- Money comes from the same honest counters as XP. Deep-focus money is uncapped; outputs and bonuses are capped as listed.
- Purchases, rent, moves and storage live in append-only ledger tables, and the balance is recomputable.
- **Quiet mode hides money**: every money response carries `quiet`; the UI must not show amounts when it is true. The Telegram line is left out.
- The Telegram weekly summary (`/week`, and the Sunday card) gets one money/rent line: *"Money: earned $640 this week, rent $150 covered, savings $1,420."*
- Copy is calm and checked against `game.BANNED_WORDS` by the tests. An unpaid week says "was not covered this week, so nothing was taken".

## Data model (additive; `CREATE TABLE IF NOT EXISTS`, safe on the user's existing database)
```sql
econ_earned(local_date, source, cents, updated_utc, PRIMARY KEY (local_date, source))
   -- source: deep | output | star | kept (kept is keyed by the week's Monday). Trigger: an UPDATE to a lower value is ignored, DELETE aborts.
econ_ledger(id, at_utc, kind, ref UNIQUE, cents, week, meta)
   -- kind: interest | rent | unpaid | deposit | deposit_back | move | purchase | spot_unlock | chest | chest_item. cents = change to savings. Triggers: no UPDATE, no DELETE.
   -- refs: interest:<monday>, rent:<monday>, unpaid:<monday>, deposit:<n>, deposit_back:<n>, move:<n>, purchase:<item>[:<period>],
   --       spot:<spot id>, chest:<YYYY-MM-DD>, chest_item:<item id>
econ_weeks(monday PRIMARY KEY, closed_utc, summary JSON)       -- frozen recap of a closed week; written once (triggers)
econ_choice(key PRIMARY KEY, value JSON, updated_utc)          -- outfit | upgrades | layout | spot | displaced (storage after a move) | placed (the OLD slot list: migrated once, then left alone)
econ_missions(local_date PRIMARY KEY, missions JSON, done JSON, created_utc)   -- the day's three missions, picked once; `done` {mission id: utc} only gains ids (a ratchet); rows are never deleted
```
Savings = `sum(econ_earned.cents) + sum(econ_ledger.cents)`. Current home = the `to` of the last `move` row (else the starter studio). Storage = owned furniture not in the current home's layout. The cozy build (docs/COZY.md) also adds a nullable `pomodoro_runs.spot` column (`db.ensure_columns` adds it to an older database; `pomodoro._ensure_schema` does too). `economy.ensure_schema` creates the tables on a database that was not re-initialised yet. The migration was tested on a scratch copy (sqlite backup) of the real database: old tables keep their row counts and `integrity_check` is ok.

## API contract
All money routes are same-origin like the other POST routes (the `LanGuard` refuses cross-site and foreign-host requests; paired tablets may shop). Business refusals answer **HTTP 200** `{"ok": false, "hint": "<calm sentence>", "code": "<code>", ...}`; show `hint` as is. Dollar fields are whole dollars (truncated); `*_cents` fields are exact. All amounts are hidden by the UI when `quiet` is true.

### `GET /api/economy`
```jsonc
{
  "ok": true, "quiet": false, "as_of": "2026-10-22T10:00:00Z", "today": "2026-10-22",
  "balance": 247, "balance_cents": 24791,            // savings
  "net_worth": 247, "net_worth_cents": 24791,        // savings + items_value + deposit_held
  "earned_total": 247, "deposit_held": 0, "items_value": 0,
  "rate": { "per_hour": 25, "per_minute": 0.4167, "title": "Barista", "level": 0, "nodes": 0, "nodes_total": 25,
            "next": { "title": "Intern", "per_hour": 30, "nodes_needed": 2, "nodes_to_go": 2, "raise": 5 },   // null at Founder
            "raises": [ { "title": "Intern", "per_hour": 30, "at": "<utc>" } ],
            "ladder": [ { "title": "Barista", "per_hour": 25, "nodes_needed": 0, "reached": true }, ... ] },
  "week": { "monday": "2026-10-19", "sunday": "2026-10-25", "status": "baseline|in_progress|kept|not_kept",
            "earned": { "deep": 197, "output": 0, "star": 50, "kept": 0, "late": 0, "total": 247 },   // late = earlier days added after their week closed
            "deep_minutes": 475, "outputs": 0, "today": { "date": "2026-10-22", "deep_minutes": 0, "earned": 0 } },
  "rent": { "amount": 150, "weekly_rent": 150, "free": false, "status": "free|covered|short", "covered": true, "short_by": 0,
            "due_date": "2026-10-25", "closes_at": "<utc of Monday 04:00>", "unpaid_streak": 0, "weeks_to_move": 2,
            "can_step_down": false, "first_rent_week": "2026-10-26", "message": "..." },
  "level": { "number": 1, "district": "Morningside Heights", ... },
  "home": { "id": "morningside-studio", "district": "...", "district_id": "...", "name": "...", "blurb": "...", "bin": 1059500,
            "address": "421 W 118th St", "size": "studio", "slots": 4, "rent": 150, "deposit": 300, "floor": 6,
            "x": 2169.2, "z": -5460.6, "base_y": 37.1, "height_m": 24.2, "deposit_held": 0,
            "placed": [ { "slot": 0, "item": "desk_setup", "name": "Desk setup", "category": "desk", "tier": "basic" } ] },
  "homes": [ { ...home fields..., "unlocks_at_level": 3, "unlocked": false, "current": false, "deposit_net": 400, "deposit_net_cents": 40000,
               "can_move": false, "why_not": "Opens at Level 3, Harlem.", "token": "960204a16870" } ],       // all 15, ladder order
  "storage": [ { "item": "woven_rug", "name": "Woven rug", "category": "rug", "tier": "basic" } ],
  "owned": { "furniture": ["..."], "outfit": ["everyday", "..."], "upgrade": ["..."], "experience": ["..."] },
  "equipped": { "outfit": "everyday", "upgrades": ["string_lights"] },
  "passport": [ { "item": "columbia_lecture", "name": "...", "bought_at": "<utc>", "price": 40, "event": false, "period": null } ],
  "events": [ { "id": "leaves_riverside", "name": "...", "price": 15, "season": "autumn", "district": "Morningside Heights", "reason": "dates|weather",
                "on": true, "start": "2026-10-15", "end": "2026-11-15", "days_left": 24, "starts_in": null, "period": "2026", "unlocked": true } ],  // only those ON now
  "stars": { "days": 3, "this_week": 1, "run": 1, "best_run": 2, "bonus": 50, "goal_minutes": 240 },
  "gold_days": ["2026-10-19"],
  "recap": { "latest": { /* the last closed week, see below */ }, "weeks": [ /* newest first, up to 12 */ ],
             "series": [ { "monday": "2026-10-05", "net_worth": 0, "savings": 0, "earned": 0, "live": false }, ..., { "monday": "2026-10-19", "net_worth": 247, "savings": 247, "earned": null, "live": true } ] },
  "focus": { "running": false },                      // or { "running": true, "kind": "focus|pomodoro", "category": "Python", "since": "<utc>" }
  "character": { "state": "studying|walking_home|asleep|home", "location": "butler|street|home", "since": "<utc>|null" },
  "constants": { "output_dollars": 50, "output_daily_cap": 3, "star_dollars": 50, "kept_week_dollars": 100, "interest_rate": 0.02,
                 "interest_cap": 200, "deposit_weeks": 2, "unpaid_weeks_to_move": 2, "size_slots": {"studio": 4, "1-bed": 6, "loft": 8, "penthouse": 12}, "deep_hours_uncapped": true }
}
```
A closed-week recap object (the rent-day card; also `recap.latest`):
```jsonc
{ "monday": "2026-10-26", "sunday": "2026-11-01", "status": "kept", "kept": true,
  "earned": { "deep": 540, "output": 100, "star": 100, "kept": 100, "total": 840 }, "earned_cents": 84000,
  "interest": 24, "interest_cents": 2400,
  "rent": { "due": 150, "status": "free|paid|unpaid", "home": "morningside-studio", "home_name": "..." },
  "unpaid_streak": 0, "moved": null,       // or { "from": "...", "to": "...", "reason": "quiet_weeks", "stored": 1, "message": "Two quiet weeks, so you moved to a smaller place for now. Your things are safe in storage." }
  "purchases": [ { "item": "bookshelf", "name": "Bookshelf", "dollars": 200 } ], "purchases_total": 200,
  "savings_end": 1420, "savings_end_cents": 142000, "deposit_cents": 0, "items_value_cents": 20000,
  "net_worth_cents": 162000, "net_worth": 1620, "message": "Earned $840. $24 interest on your savings. Rent of $150 paid. Savings $1,420." }
```

### `GET /api/shop`
```jsonc
{ "ok": true, "quiet": false, "as_of": "...", "balance": 247, "balance_cents": 24791, "level": {...},
  "home": { "id": "...", "slots": 4, "size": "studio" },
  "aisles": [ { "id": "furniture|outfit|experience|upgrade", "name": "Furniture and decor", "items": [ ITEM, ... ] } ],
  "events": [ ITEM with "event" ] }             // all 12 events, on or not
// ITEM
{ "id": "desk_setup", "aisle": "furniture", "name": "...", "blurb": "...", "category": "desk", "tier": "basic|nice|penthouse",
  "price": 150, "district": null, "unlocks_at_level": null, "owned": false,
  "state": "available|owned|locked|off",          // locked = district not open yet; off = an event that is not on
  "affordable": false, "short_by": 150, "can_buy": false, "why_not": "$150 more savings to go.",
  "token": "4da4e836bef2",                         // confirm token for this price right now
  "equipped": false,                               // outfit worn / upgrade switched on
  "slot": null, "in_storage": false,               // furniture only
  "event": { "on": true, "start": "2026-10-15", "end": "2026-11-15", "days_left": 24, "starts_in": null, "period": "2026", "reason": "dates", "season": "autumn" } }   // events only
```

### `POST /api/shop/buy`  `{ "item": "<id>", "price": 150, "token": "<token>" }`
The safe two-step buy. **Step 1**: send only `{ "item" }` -> `{ "ok": true, "confirm_needed": true, "quote": { "item", "name", "price", "balance", "balance_after", "affordable", "token" } }` (or the `insufficient_funds` refusal). **Step 2**: send `item`, the `price` you showed and the `token` from the quote. The price must match, the token must match (it changes after any money event, so a stale confirm never buys), the district must be open, an event must be on, and there must be enough savings; all of it is checked again inside one transaction.
Success: `{ "ok": true, "bought": true, "item", "name", "price", "balance", "balance_cents", "toast", "placed": {"slot": 0} | null, "stored": bool, "equipped": bool, "passport": bool }`.
Codes: `unknown_item`, `already_owned`, `locked` (with `level`), `off_season`, `insufficient_funds` (with `short_by`, `quote`), `price_changed`, `stale` (both with the fresh `quote`).

### `POST /api/home/move`  `{ "home": "<id>", "token": "<token>" }`
Same two steps. Without a token: `{ "ok": true, "confirm_needed": true, "quote": { "home", "name", "deposit", "deposit_back", "net", "net_cents", "rent", "balance", "balance_after", "affordable", "token", "note" } }`. With it: `{ "ok": true, "moved": true, "home", "name", "from", "stored": <pieces sent to storage>, "balance", "toast" }`. Codes: `unknown_home`, `same_home`, `locked`, `insufficient_funds`, `stale`.

### `POST /api/equip`  `{ "kind": "outfit|upgrade|furniture", "item": "<id>", "on": true, "slot": 2 }`
`outfit` on = wear it, off = back to everyday clothes. `upgrade` on/off shows it on the towers. `furniture` on puts it in the room (in an old fixed slot's place when `slot` is given, else the first good free spot; a piece already on that slot goes to storage), off takes it to storage. Success: `{ "ok": true, "kind", "item", "on", "outfit", "upgrades", "placed": [...], "storage": [...], "layout": {...} }`. Codes: `unknown_item`, `not_owned`, `bad_slot`, `no_free_slot` (the home is at its budget), `no_room`, `not_equippable`. Free placement uses `POST /api/home/layout` below.
`placed` (here, in `/api/economy` `home.placed` and in `/api/world`) is now the OLD slot view: only pieces that sit exactly on one of the old fixed slots. The whole room is `layout`.

### `GET /api/world` additions
- `days[].gold` (bool): the day has three stars (permanent) -> gold crown and a light beam.
- `economy`:
```jsonc
{ "quiet": false,
  "home": { "id", "bin", "name", "address", "size": "studio|1-bed|loft|penthouse", "slots", "floor", "district", "x", "z", "base_y", "height_m" },
  "placed": [ { "slot": 0, "item": "desk_setup", "name": "...", "category": "desk", "tier": "basic" } ],
  "outfit": "everyday", "upgrades": ["string_lights"],
  "gold_days": ["2026-10-19"], "three_star_days": 1,
  "title": "Barista", "rate_per_hour": 25,
  "focus": { "running": false },
  "character": { "state": "home", "location": "home", "since": null } }
```
- A write response's `events` can contain `{ "kind": "three_stars", "size": "big", "title": "Three stars", "detail": "The crown turns gold.", "fx": { "gold": true, ... } }` (once per day). A new gold week or run arrives as the usual `achievement` event.


## Cozy engine (docs/COZY.md phase A, built 2026-10-22)

Code: `epoch/layout.py` (room geometry, placement rules, the slot migration; pure), `epoch/cozy.py` (study spots, missions, chest), plus additions to `economy.py`, `economy_catalog.py`, `pomodoro.py`, `db.py`, `schema.sql` and the routes at the end of the money block of `web/app.py`. Tests: `tests/test_cozy_*.py`. Same rules as above: same-origin POSTs, refusals answer **HTTP 200** `{ "ok": false, "hint", "code", ... }`, every payload carries `quiet` (the UI hides money, missions, chests and stars when true; the room, the character and the spots stay).

### Free placement: the model
- `econ_choice` key `layout` = `{ "v": 1, "homes": { "<home id>": { "items": [ENTRY, ...] } } }`. Only the CURRENT home's list is the room; the other homes' lists are remembered positions for a later move back. The first read of a database that has the old `placed` slot list converts it once (`layout.migrate_slots`): a piece that still fits its slot keeps the exact old place, one that does not goes to the nearest free spot, none is lost. The old `placed` choice is left untouched.
- ENTRY, floor: `{ "id": "bookshelf", "surface": "floor", "x": 1.25, "z": -1.75, "ry": 0 }`. `x, z` = the CENTRE of the footprint in room metres (x east, z toward the viewer, the back/window wall is z = -D/2, the floor is y = 0); `ry` = turn in radians about y (0 = facing +z, the room; the same convention as three.js `rotation.y`). The client snaps to a 0.25 m grid and 90-degree / 15-degree steps; the server only rounds (x, z to 1 cm, ry to 1 mrad).
- ENTRY, wall: `{ "id": "skyline_print", "surface": "wall", "wall": "n", "u": 0.5, "y": 1.6 }`. `wall` is one of the SOLID walls: `n` (back/window wall, along x), `w` (left wall, along z) and, in the one-bedroom, `p` (the partition's east face, along z). The front and right walls are cut away, so nothing hangs there. `u` = 0..1 along the wall (`GET .../layout` `room.walls[wall]` gives `lo`, `hi`, `plane`, `ry`: the centre sits at `a = lo + u * (hi - lo)`, i.e. `(x = a, z = plane)` for `n`, `(x = plane, z = a)` for `w` and `p`, facing `ry`). `y` = height of the picture's bottom edge in metres. `room.js` builds wall pieces with their back at z = 0, centred on x = 0, so the group goes at `(a, plane)` with `rotation.y = ry`.
- Where a floor piece's model goes: the group position is `centre - R(ry) * anchor`, where `anchor = [ax, az]` is the footprint centre in the model's own frame and `R(ry)(ax, az) = (ax cos ry + az sin ry, -ax sin ry + az cos ry)`; `group.rotation.y = ry`. Rugs and the chandelier have anchor `[0, 0]`.
- Rules (`layout.check`, same order as the refusals): wall piece needs a wall, inside the wall, `y >= 0.3` and `y + h <= H - 0.1`, not on a window, door, kitchenette, nor against another wall piece, and not behind a floor piece taller than its bottom edge that stands within 12 cm of the wall; floor piece inside the room (3 cm tolerance), not on the bed / kitchenette / island / partition / column, and not overlapping another floor piece (axis-aligned bounding box of the turned footprint; boxes that only touch are fine, overlap under 1 cm is ignored). `layer: "under"` (rugs) only collides with other rugs; `layer: "over"` (the chandelier) only with other hanging lights. Every piece at most once, only owned pieces, at most `budget` pieces.
- Budgets (`economy_catalog.BUDGETS`, `home.budget`): studio 8, 1-bed 12, loft 16, penthouse 24. `home.slots` (4/6/8/12) stays for the old room view only.
- Moving or stepping down: pieces keep a remembered position in the new home, or the same coordinates if they fit, or the nearest free spot; whatever exceeds the budget or has no room goes to storage (`displaced`) and a bigger home takes it back first.
- Catalog fields on every furniture item (shop items and `layout.catalog`): `size [w, d, h]` metres, `anchor [ax, az]`, `surface "floor"|"wall"`, `layer null|"under"|"over"`, `activity` (id or null), `wall_y` (default bottom edge of a wall piece). Shop items also carry `activity_line` ("Your character will play records here."), `in_room`, `slot` (`null` = not in the room, `-1` = in the room off the old slots, `0..n` = on that old slot) and `chest_only`.
- The room numbers in `layout.ROOMS` mirror `LAYOUTS` in `room.js` (W, D, H, windows, bed, kitchen, island, partition, columns, stand and the old slots); `tests/test_cozy_layout.py` compares them with the JavaScript, so change both together.

### `GET /api/home/layout`
```jsonc
{ "ok": true, "quiet": false, "v": 1,
  "home": { "id": "morningside-studio", "name": "...", "size": "studio", "address": "421 W 118th St", "budget": 8, "used": 3, "free": 5 },
  "message": "3 of 8 places used", "capacity_text": "Your studio fits 8 things. 3 are out.",
  "room": { "size": "studio", "label": "Studio", "W": 5, "D": 4, "H": 2.9, "grid": 0.25, "glass_wall": false,
            "windows": [ { "x0": 0.1, "x1": 1.6, "y0": 0.85, "y1": 2.45 } ],
            "walls": { "n": { "axis": "x", "lo": -2.5, "hi": 2.5, "plane": -2, "ry": 0, "blocked": [ { "a0": 0.1, "a1": 1.6, "y0": 0.85, "y1": 2.45 } ] },
                       "w": { "axis": "z", "lo": -2, "hi": 2, "plane": -2.5, "ry": 1.5708, "blocked": [ /* the kitchenette */ ] } },   // + "p" in the 1-bed
            "obstacles": [ { "kind": "bed|kitchen|island|partition|column", "x0": -2.43, "x1": -1.08, "z0": -2, "z1": 0 } ],
            "stand": { "x": 0.85, "z": -1.35 }, "kitchen": true },
  "items": [ ENTRY + { "name", "category", "tier", "size": [w, d, h], "anchor": [ax, az], "layer", "activity", "chest_only",
                       "box": [x0, x1, z0, z1] } ],      // box = the turned footprint's bounding box (floor pieces), what collisions use
  "storage": [ { "item", "name", "category", "tier", "size", "surface", "layer", "activity" } ],
  "catalog": { "<owned furniture id>": { "name", "category", "tier", "size", "anchor", "surface", "layer", "activity", "activity_line", "wall_y", "chest_only" } } }
```
### `POST /api/home/layout`  `{ "items": [ENTRY, ...] }`
Replaces the current home's whole layout (send everything; a piece left out goes to storage). Debounce on the client (400 ms). Nothing is saved unless all of it passes. Success: the same body as GET plus `"saved": true`. Refusal: `{ "ok": false, "code", "hint", "index": <position in the list>, "item": "<id>" }`, codes and copy: `bad_layout` ("The layout needs to be a list of items."), `unknown_item`, `not_owned` ("You do not have Typewriter yet."), `duplicate` ("Bookshelf is already in the room."), `over_budget` ("Your studio fits 8 things.", with `budget`, `count`), `wrong_surface` ("Framed skyline print hangs on a wall."), `bad_position`, `bad_wall` ("Pick a spot on a solid wall for that."), `out_of_bounds` ("Bookshelf does not fit there." / "That does not fit on the wall."), `window` ("There is a window or a door there."), `taken` ("That spot's taken.").

### `GET /api/spots`, `POST /api/spots/select`
```jsonc
{ "ok": true, "quiet": false, "as_of": "...", "selected": "butler", "last_used": "butler", "balance": 250, "balance_cents": 25000,
  "message": "1 of 7 study spots open.",
  "next": { "id": "cafe_amsterdam", "name": "...", "price": 300, "state": "available", "gate": null, "why_not": "$50 more savings to go.", "can_buy": false },
  "spots": [ { "id": "nypl_rose", "name": "The grand reading room on Fifth Ave", "short": "Fifth Ave reading room", "pin": "Studying on Fifth Ave",
               "blurb": "...", "outdoor": false, "price": 1200, "district": "Midtown & Times Square", "unlocks_at_level": 13, "home": null, "home_name": null,
               "unlocked": false, "state": "open|available|locked", "affordable": false, "short_by": 1200, "can_buy": false,
               "gate": "Unlocks with Midtown & Times Square, Level 13",                      // null unless state = locked
               "why_not": "The Fifth Ave reading room opens with Midtown & Times Square, Level 13.",
               "selected": false, "token": null } ] }                                      // token only while state = available
```
Spots (order = `STUDY_SPOTS`): `butler` free; `cafe_amsterdam` $300; `low_steps` $450 (open air); `rooftop` $700 (open air); `park_bench` $900 + Central Park (Level 7), open air; `nypl_rose` $1,200 + Midtown & Times Square (Level 13); `penthouse_desk` free, opens once you have lived in `brow-penthouse`. **Unlocking is the ordinary buy flow**: `POST /api/shop/buy {item: "<spot id>"}` (step 1 quote, step 2 price + token); the ledger row is kind `spot_unlock`, ref `spot:<id>`; the result adds `spot` and `selected: true` (a new spot is selected for the next run). Extra buy refusals: `home_gated` (the penthouse desk), `locked` carries the spot copy above.
`POST /api/spots/select {spot}` -> `{ "ok": true, "selected", "spot": {id, name, short, pin, outdoor}, "message": "Butler Library it is." }` or `unknown_spot` / `spot_locked` (the hint says what is missing). The selected spot is also "the last one used": it is remembered in `econ_choice` key `spot` and used by the next run that does not name a spot.

### Focus runs carry a spot
- `POST /api/pomodoro/start` accepts `"spot": "<id>"` (optional; it must be open, else `{ok:false, code:"spot_locked", hint}` and nothing starts; omitted = the last one used). The run keeps it in `pomodoro_runs.spot`.
- `GET /api/pomodoro` and the SSE `pomodoro` event: `run.spot` (the id, or null for a run from before spots existed) and top-level `spot` = `{ id, name, short, pin, outdoor }` (the run's spot while one is active, else the selected one) and `selected_spot` (an id). `rev` is unchanged.
- `/api/economy`, `/api/world` `economy`: `focus.spot` and `character.location` = the spot id while studying (`"butler"` as before), plus `character.spot` and `character.pin` ("Studying at Butler"). The World view should show the figure INSIDE that building with the pin, never outside.

### `GET /api/missions`
```jsonc
{ "ok": true, "enabled": true, "quiet": false, "as_of": "...", "date": "2026-10-22",
  "missions": [ { "id": "deep_n", "tier": "easy|medium|stretch", "text": "1 hour 30 minutes of deep focus today", "done_text": "1 hour 30 minutes of deep focus",
                  "done": false, "done_at": null, "value": 35, "target": 90, "unit": "min|blocks|subjects|outputs|bool", "fraction": 0.389,
                  "progress_text": "35 of 90 min", "toast": "Mission done: 1 hour 30 minutes of deep focus. Two to go for the chest.",
                  "params": { "n": 90 } } ],                                  // always 3: one easy, one medium, one stretch; [] when disabled
  "done_count": 1, "total": 3, "all_done": false, "message": "Missions: 1 of 3. Two to go for the chest.",
  "chest": CHEST, "streak": { "chest_days": 2, "best": 4, "today_counts": true },
  "rules": { "chest_max": 7, "money_min": 40, "money_max": 100, "streak_bonus": 10, "money_cap": 150 } }
// CHEST
{ "ready": 3, "waiting": 0, "max": 7, "label": "x3", "next_date": "2026-10-20", "dates": ["2026-10-20", "2026-10-21", "2026-10-22"],
  "earned_today": true, "opened_total": 5, "streak": 3, "best_streak": 4,
  "last_opened": { "date", "money", "money_cents", "bonus", "streak", "fallback", "items": [ITEM], "message", "opened_at" } | null }
```
The pool (ids): easy `early_bird`, `one_block`, `full_focus`, `doors_by_noon`; medium `two_blocks`, `deep_n`, `two_subjects`, `new_spot`, `math_hour`; stretch `crown`, `long_block`, `deep_stretch`, `ship_it`. Counters (all from the honest data): `early_bird` = the first logged hour (not Sleep/Unknown/the auto job block) starts before 11:00 local; `one_block`/`two_blocks`/`new_spot`/`long_block` use kept focus blocks (`pomodoro_blocks` status unrated/rating/rated) with worked time >= 25 min (75 for `long_block`); `full_focus` = a kept block rated "Full focus" of any length; `doors_by_noon` = the 30-minute floor (or an output) met before 12:00; `deep_n`/`deep_stretch`/`math_hour`/`two_subjects` use the day's uncapped deep minutes (>= 15 min in each of two ladders for `two_subjects`; `math_hour` = 60 min in `params.category`, the ladder studied least over the last 7 days); `new_spot` = a real block at a spot other than `params.ref_spot` (the spot of the last block before today); `crown` = the daily target met; `ship_it` = an output today.
- Pick: seeded by the date, from data up to yesterday, written once to `econ_missions` and frozen (late backfills do not change the day). One per tier; never the exact set of yesterday; `one_block`+`two_blocks` and `deep_n`+`deep_stretch` are never offered together; never an impossible one: `early_bird` / `doors_by_noon` need a morning that allows them (settings `morning_time_*`, `job_start`) and are skipped when the day is first opened after 11:00 / 11:15 and not already done; `new_spot` needs two open spots; `ship_it` at most twice per Monday-to-Sunday week; `crown` not on a rest/skip day.
- Adaptive amounts: `deep_n` = 0.8 x the median deep minutes of the last 14 active days, rounded to 15, clamped to [45, 180]; `deep_stretch` = 1.2 x, [90, 300]; 60 and 120 with no history.
- A mission seen done stays done (the row's `done` only gains ids), so deleting a log later never takes a chest back. A day still counts for 7 days after (a late log can finish it). Switching `daily_missions` off (`POST /api/settings/game {daily_missions: false}`, default true) stops new days being picked; chests already earned stay.

### `POST /api/chest/open`  `{ "date": "2026-10-21" }`
`date` is optional: without it the oldest waiting chest opens (pass the date from `chest.next_date` so a double tap cannot open two). **Idempotent per chest**: the same date again changes nothing and returns the same reward with `already_opened: true`.
```jsonc
{ "ok": true, "quiet": false, "opened": true, "already_opened": false, "date": "2026-10-21",
  "money": 85, "money_cents": 8500, "bonus": 20, "streak": 2, "fallback": false,
  "items": [ { "item": "brass_desk_clock", "name": "Brass desk clock", "kind": "furniture|outfit|postcard", "category": "decor", "rare": true, "phrase": "a brass desk clock" } ],
  "message": "$85 and a brass desk clock.", "toast": "$85 and a brass desk clock.", "opened_at": "<utc>",
  "pity": { "misses_before": 5, "guaranteed": true },
  "chest": CHEST, "balance": 332, "balance_cents": 33241 }
```
Refusals: `no_chest` ("No chest is waiting. Three missions fill one." / "That chest is not ready."), `shelf_full` (a chest behind the 7 on the shelf: "Open the chests on the shelf first."), `bad_date`.
Reward rules (`cozy.chest_plan`, deterministic from the chest dates alone, whatever order they are opened in): money = a seeded multiple of $5 from $40 to $100, plus $10 per chest day in the current run of consecutive chest days (this one included), at most $150; 20% a rare chest-only furniture/outfit; 15% a chest-only postcard; **pity**: after 5 chests in a row without a rare item the 6th has one (the counter runs over all chest days in date order). Prizes come from each day's own seeded shuffle, skipping what an earlier chest gave; a rare roll with nothing left pays `fallback` $50 more instead. Ledger: `chest:<date>` (money, meta has base/streak/bonus/rare/guaranteed/fallback) and one `chest_item:<id>` per find (cents 0); unique refs make it idempotent. Chest furniture waits in storage (never auto-placed); a postcard goes into the Passport (`passport[].chest = true`, price 0).
Chest-only catalog (`CHEST_ITEMS`, `chest_only: true`, `tier: "chest"`, price 0, `buy` refuses with `chest_only`, never in `/api/shop`): furniture `subway_map_print` (wall), `brass_desk_clock`, `typewriter` (activity `type`), `record_crate` (`browse_records`), `velvet_armchair` (`read`), `flatiron_globe`; outfits `yellow_raincoat`, `varsity_jacket`; postcards `postcard_high_line_sunrise`, `postcard_met_midnight`, `postcard_bridge_fog`. room.js / character.js need a model or look for each (until then the category fallback is used).

### `/api/economy` additions
- `home`: `budget`, `used`, `layout` (the `items`/`storage`/`message` view above); `placed` is the old slot view. `constants`: `size_budget`, `chest_max`. `owned` gains `postcard` and `spot`.
- `character.activity_hint`: `{ "macro": "home|studying|walking_home|asleep", "activities": ["look_outside", "sleep", "make_tea", "read", ...], "detail": [ { "id", "name", "night_only", "free", "from": ["<item ids that unlock it>"] } ], "sleep_cutoff": "00:30" }`. Only owned AND placed pieces unlock an activity; `look_outside` and `sleep` are always there and `make_tea` is free in a home with a kitchen (studio, penthouse). Activity ids: `read`, `water_plants`, `look_outside`, `make_tea`, `play_piano`, `play_records`, `browse_records`, `stargaze` (night only), `work_desk`, `type`, `sleep` (night only).
- `missions`: `{ enabled, date, done, total, all_done, message, items: [ { id, tier, text, done, fraction, progress_text } ] }`; `chest`: `{ ready, waiting, max, label, next_date, earned_today, streak, best_streak }`; `spot`: `{ id, name, short, pin, outdoor, unlocked: [ids], next: { id, name, price, district } | null }`.
- `/api/world` `economy`: also `layout` and `spot`; `home.budget`.

## Tuning notes
- A simulated year (steady, no raises, living in the studio): target-hitter (90 min weekdays, 3 h weekends, 2 outputs/week) earns about $36k plus about $8k interest; light about $30k; strong (3 h / 5 h) about $58k; very strong about $87k. Rent over the year at the studio rate is $7.6k; at the penthouse it is $46k a year, which is why the final home is a late goal.
- Interest at 2% a week is generous for idle savings (the $200 cap bites above $10,000). If it feels too rich, lower `INTEREST_RATE` or `INTEREST_CAP_DOLLARS` in `economy_catalog.py`; past weeks do not change because they are frozen.
- Thresholds, rates, prices, rents and the event windows are all plain data in `economy_catalog.py`.

## The money UI (built 2026-10-22)
- Pages (server-rendered from `economy_state` / `shop_state`, helpers in `epoch/web/money_ui.py`, behaviour in `static/app/money.js`): `/money` (savings, job and next raise, this week by source, rent, the rent-day recap and the net-worth chart), `/store` (On now strip, four aisles, two-step buy sheet, equip/place/toggle), `/passport` (postcards with inline-SVG art and a true one-line fact each, `money_ui.FACTS`), `/home` (address, size, slots, rent status, what happens after 2 unpaid weeks, the room slots, storage, the move ladder, "Open my room" via `Witness.openRoom()`).
- The header wallet pill (`data-js="wallet-pill"`) links to `/money`; after any log, output or focus block `app.js` calls `WitnessMoney.after()`, which reads `/api/economy` and toasts "+$X earned" and any raise or new title.
- Close on Sunday shows a "Rent day" card (the week so far). Settings has a "Stars and money" card: a quick 3/4/5/6 h choice (`POST /api/settings/star {minutes}`), the same value as the select under "Floor, target and plans".
- Quiet mode: the nav tab and the pill carry `data-quiet-hide`; the four pages render "Money is tucked away" with no amounts.
- Pages refresh in place after a buy, equip or move by re-fetching their own HTML and swapping `[data-js="money-root"]`.
