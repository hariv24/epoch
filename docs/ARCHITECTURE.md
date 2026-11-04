# Epoch: architecture and module contract

Epoch is a **local, web-app-first** accountability tracker. It runs as one Python
process on the user's Mac, costs ₹0, and is used from the browser about 95% of the time.
Telegram covers nudges and logging from the phone. The product rules come from
`docs/plan.md` §5 (concept "Underdog", the app's earlier name). This file is the contract every module codes against.

## Hard constraints

- **₹0.** No paid services. The only LLM is OpenRouter **free** models (`:free` or `openrouter/free`),
  enforced in `config.is_free_model`. The app works fully with no LLM and no Telegram configured.
- **Local.** Bind to `127.0.0.1` only. SQLite file in `data/`. No cloud.
- **Privacy.** Never send window titles, URLs, app names or raw ActivityWatch data to the LLM.
  Only the user's own typed text, plan items, and computed numbers.
- **Python 3.10** (the user's venv). Use `from __future__ import annotations`. Dependencies are in
  `requirements.txt`. Do not add new ones; prefer the standard library.
- **No guilt copy.** Never write "you failed", "wasted", "streak lost", "your future self",
  or "lazy". After a miss: short, kind, and forward-looking.

## Runtime

```
python -m epoch  →  main.run()
  ├── db.init_db()
  ├── uvicorn serving web.app.create_app() on 127.0.0.1:<port> (default 8765)
  ├── lifespan task: scheduler.ticker(state)        every 60 s
  └── lifespan task: telegram_bot (long polling)     only if configured
```

`main.AppState` (a dataclass shared by the web app, ticker and bot) holds `config: Config`,
`db_path: Path`, `telegram_app` (or None), `aw: AWClient`, and `llm: OpenRouterClient | None`.
It's stored on `app.state.witness`.

## Shared modules (written already; edit only to fix a real bug)

- `config.py`: `load_config()` returns `Config` (paths, port, Telegram token and user id, OpenRouter key and models, ActivityWatch URL).
- `db.py`: `connect`, `get_conn(db_path)` (a context manager, one connection per unit of work), `transaction(conn)`,
  `get_setting`, `set_setting`, `all_settings`, `start_date`, `tracker_build_until`, `first_contract_monday`,
  `init_db(db_path, today=None)`, `DEFAULT_SETTINGS`, `utc_now_iso()`.
- `schema.sql`: all tables. Times in `*_utc` columns are `'YYYY-MM-DDTHH:MM:SSZ'`; `local_date` is `'YYYY-MM-DD'`.
- `timeutil.py`:
  - conversion: `now_utc`, `to_iso`, `from_iso`, `parse_hhmm`
  - day logic: `local_date_of(dt, tz, day_start_hour)`, `day_bounds_utc(d, tz, h)`, `at_local(d, "HH:MM", tz, h)`
  - week logic: `week_monday`, `week_days`
  - durations: `overlap_minutes`, `minutes_between`

  A local day runs **04:00 → 04:00**.
- `categories.py`: `LADDER`, `OTHER`, `ALL`, `COLORS`, `CODES`/`FROM_CODE`, `KEYWORDS`, `DEFAULT_AW_RULES`,
  `is_ladder`, `counts_toward_floor(cat, local_date, tracker_build_until)`.
- `tests/conftest.py`: the `db_path` and `conn` fixtures, a fresh DB with `start_date = 2026-10-05` (a Monday).
  The contract starts Monday 2026-10-12 (2 outputs, 5 floor days). Week of 10-05 is the baseline.

## Epoch rules (implemented once, in `rules.py`)

- **Deep minutes for a day:**
  - Count minutes of non-deleted entries with `deep=1` whose category `counts_toward_floor`, clipped to the local day.
  - Exclude minutes after `sleep_cutoff` (e.g. 00:30 → until 04:00).
  - Overlapping entries are counted once: take the union of intervals.
- **Floor met:** deep minutes ≥ `floor_minutes` (30) **or** ≥1 non-deleted output that day.
- **Target:**
  - The target is `target_weekday_minutes` on job days and `target_weekend_minutes` otherwise.
  - `target_met` = min(deep, `deep_cap_minutes`) ≥ target.
  - Deep minutes above the cap are shown but never count.
- **Day mark:** `day_marks.kind` is `skip` or `rest`. Both use one of the week's `skips_per_week` (default 2).
  A rest day can be declared in advance.
- **Day status**, first match wins:
  1. `before_start`: date < start_date
  2. `future`: date > today
  3. `floor`: floor met
  4. `rest` / `skip`: has a day mark
  5. `open`: date == today
  6. `repaired`: missed, but the floor was met on **both** of the next two days, and the user chose repair
     in the lapse flow (`lapses.choice='repair'`) or no lapse row exists. Only one repair window can be open at a time.
  7. `missed`: otherwise

  Baseline days (before the first contract) get the same statuses; only the week verdict differs.
- **Comeback day:** a `floor` day whose most recent non-`open` previous day is `missed` or `repaired`.
- **Week (ISO Monday–Sunday):**
  - `outputs_count` = outputs in the week.
  - `floor_days` = days with status `floor` or `repaired`.
  - `skips_used` = day_marks in the week.
  - Status:
    - `baseline`: no contract in force.
    - `kept`: outputs ≥ contract outputs **and** floor_days ≥ contract floor days. Can become kept before Sunday.
    - `not_kept`: the week is over and not kept.
    - `in_progress`: otherwise.
- **Run:** the number of consecutive days, going back from yesterday (and including today if its status
  is `floor`), whose status is `floor`, `skip`, `rest` or `repaired`. `open` today never breaks it.
  It's computed on read and never stored.
- **Contract changes:**
  - Raising takes effect from the current week's Monday.
  - Lowering takes effect from **next** Monday (the "akrasia horizon").
  - Each change inserts a `contracts` row.

## Module APIs (each owned by one build agent)

### `rules.py` (pure logic over the DB; no I/O beyond SQLite)

```python
@dataclass
class DaySummary:
    local_date: date; status: str; is_job_day: bool
    deep_minutes: int                 # union, clipped, sleep-cutoff applied, uncapped
    deep_by_category: dict[str, int]
    logged_minutes: int               # all non-deleted entries in the day (union)
    outputs_count: int
    floor_minutes: int; floor_met: bool
    target_minutes: int; target_met: bool
    mark: str | None                  # 'skip' | 'rest' | None
    is_comeback: bool

@dataclass
class WeekSummary:
    monday: date; sunday: date; status: str     # baseline | kept | not_kept | in_progress
    outputs_required: int | None; floor_days_required: int | None
    outputs: list[sqlite3.Row]; outputs_count: int
    floor_days: int; skips_used: int; skips_left: int
    deep_minutes: int; deep_by_category: dict[str, int]
    days: list[DaySummary]
    planned_minutes: int; planned_done_minutes: int   # plan vs actual, from plan_blocks
    top_lapse_reasons: list[tuple[str, int]]

def today_local(conn) -> date
def is_job_day(conn, d: date) -> bool
def day_summary(conn, d: date, today: date | None = None) -> DaySummary
def week_summary(conn, d: date, today: date | None = None) -> WeekSummary
def current_run(conn, today: date | None = None) -> int
def lifetime_totals(conn) -> dict   # deep_minutes, outputs, weeks_kept, comebacks, days_tracked
def consistency(conn, today=None) -> dict  # weeks_kept_last_12, floor_days_last_30
def contract_for(conn, d: date) -> sqlite3.Row | None
def change_contract(conn, outputs: int, floor_days: int, today=None) -> date   # returns effective Monday
def pending_lapse(conn, today=None) -> date | None   # yesterday if 'missed' and no lapses row yet
def open_repair_window(conn, today=None) -> date | None
def use_skip(conn, d: date, kind: str = "skip", reason: str | None = None) -> bool  # False if none left
def record_lapse(conn, missed: date, reason: str | None, choice: str, if_then: str | None) -> None
def overrun_ratio(conn, category: str | None = None, weeks: int = 4) -> float | None  # actual/planned
def gaps(conn, d: date, start_hhmm: str | None = None, end_utc=None) -> list[tuple[datetime, datetime]]
    # Unlogged stretches of the waking day (from morning_time to min(now, bedtime)), excluding
    # job hours on job days. Each gap is ≥ 10 min. These are what the evening close walks through.
```

Write helpers (also in `rules.py`, so the web app, bot and scheduler share them):

```python
def add_entry(conn, start_utc, end_utc, category, deep, source, note=None, plan_block_id=None) -> int
def add_output(conn, d: date, stage: str, what: str, url: str | None = None) -> int
def add_plan_block(conn, d: date, category, minutes, cue_time, task=None) -> int  # renders if_then
def render_if_then(cue_time, category, task) -> str   # "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-10."
def close_job_block(conn, d: date, choice: str) -> None  # 'usual' | 'left_early' | 'stayed_late' | 'leave'
```

### `parser.py` and `llm.py`

```python
# parser.py
@dataclass
class ParsedLog: category: str; minutes: int; note: str; deep: bool; start_utc: datetime | None
def parse_log(text: str, settings: dict, now: datetime) -> ParsedLog | None
    # Regex first: "45m numpy ex 1-12", "1h30 math LA 2.1", "2h python", "90 min papers attention",
    # "yt 40m" ... Category comes from categories.KEYWORDS, else None (which the caller treats as unparsed).
    # The entry ends at `now` and starts `minutes` earlier unless the text names a time ("at 18:30").
def parse_log_smart(conn, llm, text, settings, now) -> ParsedLog | None
    # regex → else llm.complete_json(...) (if available) → else None. Validates 1..600 min and a known category.

# llm.py
class OpenRouterClient:
    def __init__(self, api_key: str, models: Sequence[str], db_path: Path, daily_cap: int = 100, timeout: float = 30)
    def calls_today(self) -> int
    def complete_json(self, purpose: str, system: str, user: str, schema: dict) -> dict | None
    def complete_text(self, purpose: str, system: str, user: str, max_tokens: int = 400) -> str | None
    # Try models in order. Record every attempt in llm_calls. Respect daily_cap and ~20/min.
    # Return None on any failure; never raise. Never call a non-free model.
def weekly_narration(llm, facts: dict) -> str | None
    # ≤120 words: 1 win, 1 gap, 1 pattern, 1 if-then. Validator: every number in the text must
    # appear in facts. Otherwise return None (the caller shows only the plain numbers).
```

### `activitywatch.py`

```python
@dataclass
class AWEvent: start_utc: datetime; end_utc: datetime; app: str; title: str; url: str | None
@dataclass
class Suggestion: start_utc: datetime; end_utc: datetime; category: str; deep: bool; minutes: int; apps: list[str]
class AWClient:
    def __init__(self, base_url: str = "http://localhost:5600", timeout: float = 3)
    def available(self) -> bool
    def events(self, start_utc, end_utc) -> list[AWEvent]
        # Non-AFK window events. Where a browser was active and a web-watcher bucket exists, attach url/title.
        # Use the REST API (/api/0/buckets, /api/0/query). Return [] on any error.
def load_rules(conn) -> list[sqlite3.Row]
def categorize(event: AWEvent, rules) -> tuple[str, bool]   # first matching rule by priority, else ('Unknown', False)
def suggest(conn, aw: AWClient, start_utc, end_utc, slot_minutes: int = 15) -> list[Suggestion]
    # Bucket active time into slots and take the dominant category per slot, then merge adjacent equal slots.
    # Job hours on job days → 'Day job'. Suggestions are never saved automatically; the user confirms them.
```

### `notify.py` and `telegram_bot.py`

```python
# notify.py
def notify(title: str, message: str, url: str | None = None) -> bool
    # macOS notification. If `terminal-notifier` is on PATH, use it with -open url; otherwise osascript.
    # Escape quotes safely and never raise. Return False off macOS.

# telegram_bot.py
def build_application(state) -> telegram.ext.Application | None   # None if not configured
async def send_card(state, slot_row, text: str, buttons: list[list[tuple[str, str]]]) -> int | None
    # Returns message_id. buttons are (label, callback_data); callback_data ≤ 64 bytes.
```

- Only `config.telegram_user_id` may use the bot. Ignore everyone else silently, except one referee chat
  that started the bot with `/start ref-<token>` (v1; for now, `/referee` lets the owner set
  `referee_chat_id` manually).
- Commands:
  - `/start`, `/help`
  - `/log <text>`; plain text → `parser.parse_log_smart`
  - `/shipped <url> <what>`
  - `/focus <min> <label>`
  - `/skip <reason>`
  - `/today`, `/week`
- Callback data schemes:
  - `ci:<slot_id>:<code>` logs a category for a block-end card.
  - `dp:<entry_id>:<d|s>` marks deep or shallow.
  - `jc:<date>:<u|e|l|v>` closes the job block.
  - `lp:<date>:<reason>` records a lapse.
  - `lc:<date>:<skip|repair|letgo>` picks the lapse choice.
- After a tap, **edit the message into a receipt**, e.g. `Logged · Python · 60 min · deep`, and remove the buttons.

### `scheduler.py` and `main.py`

- Slot kinds (at most `msg_cap` proactive messages per local day; extras are dropped in this priority order, last first):
  1. `lapse`: morning after a `missed` day with no lapse row. Replaces `morning`.
  2. `morning`: at `morning_time_*`. "Pick tonight's blocks" with a link to `/plan`.
  3. `block_end`: at a plan block's cue_time + minutes, at most 2 a day. "What did 19:30–20:30 go to?"
  4. `evening_close`: at bedtime − 30 min. "Close the day" with a link to `/close`.
  5. `sunday`: Sunday 18:00. Weekly review link plus the referee report text.
  6. `silence`: 48 h with no user activity (entries, outputs, answered slots). Once per quiet spell.
- `ensure_slots(conn, d)` is idempotent (relies on the UNIQUE constraint).
  `due_slots(conn, now)`.
  `render(conn, slot) -> (title, body, buttons, url)`.
  `async ticker(state)`:
  - Every 60 s: ensure slots exist for today, then send due `pending` slots (macOS notification always,
    and Telegram if enabled) and mark them `sent`.
  - Slots more than 3 h overdue (e.g. the laptop was asleep) become `expired`, except the most recent one per kind,
    which is sent as a single catch-up.
  - A **block_end** slot is never sent while a focus session is running.
  - Ignored slots are never re-sent.
  - Nightly backup at 03:30 local when `config.backup_dir` is set: `sqlite3` backup API → `witness-YYYY-MM-DD.db`, keeping the last 14.
- `main.run()` starts everything. `python -m epoch` works via `epoch/__main__.py`; the old names `python -m underdog` and `python -m witness` are tiny shims (`underdog/__main__.py`, `witness/__main__.py`) that print a one-line note and call the same `run()`.
- `scripts/install_launchd.sh` installs `~/Library/LaunchAgents/com.epoch.tracker.plist` (RunAtLoad and KeepAlive,
  logs to `data/epoch.log`) and removes the older `com.underdog.tracker` and `com.witness.tracker` agents if present. `scripts/uninstall_launchd.sh` removes all three.

### `web/` (FastAPI + Jinja2 + HTMX; vendored `static/htmx.min.js`; no JS build, no CDN)

`web/app.py: create_app(state=None) -> FastAPI`. With `state=None` it builds one from `load_config()`. Pages
(all server-rendered; forms POST and redirect back, or return HTMX partials):

| Route | Purpose |
|---|---|
| `GET /` | **Today**: floor/target bars, week contract progress (outputs x/N, floor days x/M, skips left), run, open repair window or pending lapse banner, today's plan blocks with if-then, today's entries timeline, quick log (category buttons + minutes + deep toggle + note), a typed-log box, a Shipped form, and Focus start/stop. |
| `GET/POST /plan` | Plan today or tomorrow: up to `max_blocks_per_day` blocks (category, minutes, cue time, task). Shows if-then sentences. From week 3, warns when planned minutes exceed the user's usual completion (overrun ratio). |
| `GET/POST /close` | **Evening close**: the job block in one click (usual / left early / stayed late / leave), then each gap with ActivityWatch suggestions as one-click labels plus a "Don't remember" option (→ `Unknown`), then the day summary. |
| `GET /grid?week=YYYY-MM-DD` | 168-hour grid: 7 columns × 24 rows coloured by category from entries; ActivityWatch suggestions shown faded where nothing is logged; weekly totals per category. |
| `GET/POST /week?week=…` | Weekly review: status, outputs with links, floor days, deep hours by category, plan vs actual, top lapse reasons, contract keep/raise/lower, referee report text (copy button; "Send to referee" if Telegram and referee are set). |
| `GET/POST /lapse` | After a missed day: optional reason → mark as rest / repair / let it go → an optional "tonight's minimum plan" block for today. |
| `GET /outputs` | Outputs ledger (stage, what, link, date, public toggle, delete). |
| `GET/POST /settings` | All `DEFAULT_SETTINGS`, plus status: Telegram configured?, OpenRouter configured, calls today / cap, ActivityWatch reachable?, and the AW rules editor. |
| `POST /api/entries`, `DELETE /api/entries/{id}` | Used by the HTMX forms. |
| `GET /health` | `{"ok": true}` |

Design:
- Clean and calm: system font, light background, one accent colour.
- Responsive enough for a phone browser.
- Each category shows its `COLORS` swatch.
- No guilt copy. The headline is "weeks kept"; the run is in small type.

## Tests

- `pytest` from the project root with `.venv/bin/python -m pytest`.
- Every module has tests in `tests/test_<module>.py`.
- Use the `conn` and `db_path` fixtures.
- Never hit the network: mock `httpx` with `httpx.MockTransport`, and mock Telegram/osascript.
- The web app is tested with FastAPI `TestClient`.

## Day counter

`timeutil.day_number(start_date, local_day) = max(1, (local_day - start_date).days + 1)`, so the start date is Day 1 and a day
runs 04:00 to 04:00 local (the same boundary as every other "today"). `timeutil.day_number_label(n)` is "Day n" and
`timeutil.day_number_range_label(a, b)` is "Days a-b". `game.today_state` returns `day_number`, `day_one` (the ISO start date) and
`day_line` ("Day 12 · Sun 18 Oct"); `game.day_recap` and `game.world_state` carry `day_number` / `day_one`. The Close page,
the seal message ("Day N sealed."), the skyline caption ("Epoch · Day N · ..."), the Telegram `/today` and `/week` replies, and the postcards (drawn in
`postcard.js` from `day_one`) all use it. Internal names that data or devices depend on keep the old name: `data/witness.db`,
the `witness_device` cookie, `witness.app.*` localStorage keys, the `witness:events` HX-Trigger event and the `settings` keys.
