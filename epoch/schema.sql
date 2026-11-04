-- Epoch schema. All *_utc columns are ISO 8601 UTC strings: 'YYYY-MM-DDTHH:MM:SSZ'.
-- All local_date columns are 'YYYY-MM-DD' in the user's time zone, where a day
-- runs from day_start_hour (default 04:00) to 04:00 the next calendar day.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                       -- JSON-encoded
);

-- Weekly contract. The contract in force for a date is the row with the latest
-- effective_from <= that date's ISO-week Monday. No row => baseline week (no targets).
CREATE TABLE IF NOT EXISTS contracts (
  id                  INTEGER PRIMARY KEY,
  effective_from      TEXT NOT NULL,        -- a Monday (local date)
  outputs_per_week    INTEGER NOT NULL,
  floor_days_per_week INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_blocks (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL,
  category   TEXT NOT NULL,
  minutes    INTEGER NOT NULL,
  cue_time   TEXT,                          -- 'HH:MM' local; may be after midnight (belongs to local_date)
  task       TEXT,                          -- e.g. 'ch.6 ex 1-10'
  if_then    TEXT,                          -- rendered 'IF ..., THEN ...' sentence
  status     TEXT NOT NULL DEFAULT 'planned',  -- planned | done | partial | skipped
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_date ON plan_blocks(local_date);

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  start_utc     TEXT NOT NULL,
  end_utc       TEXT NOT NULL,
  category      TEXT NOT NULL,
  deep          INTEGER NOT NULL DEFAULT 0, -- 1 = focused work
  source        TEXT NOT NULL,              -- live | backfill | focus | aw | telegram | parsed
  note          TEXT,
  plan_block_id INTEGER REFERENCES plan_blocks(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0  -- soft delete; history is never destroyed
);
CREATE INDEX IF NOT EXISTS idx_entries_start ON entries(start_utc);

CREATE TABLE IF NOT EXISTS outputs (
  id          INTEGER PRIMARY KEY,
  local_date  TEXT NOT NULL,
  stage       TEXT NOT NULL,                -- a ladder category: Python | Math | ML/DL | Papers | Writing/X
  url         TEXT,
  what        TEXT NOT NULL,                -- one line: what it shows
  verified_by TEXT NOT NULL DEFAULT 'self', -- self | github | x | referee
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outputs_date ON outputs(local_date);

-- Skips and planned rest days (a rest day also uses one of the week's skips).
CREATE TABLE IF NOT EXISTS day_marks (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,                 -- skip | rest
  reason     TEXT,
  created_at TEXT NOT NULL
);

-- One row per missed day the user responded to (lapse flow).
CREATE TABLE IF NOT EXISTS lapses (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,          -- the missed day
  reason     TEXT,                          -- work_late | tired | phone | unclear_step | too_big | other
  choice     TEXT,                          -- skip | repair | let_go
  if_then    TEXT,
  created_at TEXT NOT NULL
);

-- Days the user took leave from the day job ("Leave day" in the evening close): the job
-- window is then open time, not busy time.
CREATE TABLE IF NOT EXISTS job_leaves (
  local_date TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id              INTEGER PRIMARY KEY,
  start_utc       TEXT NOT NULL,
  planned_minutes INTEGER NOT NULL,
  label           TEXT,
  category        TEXT NOT NULL,
  end_utc         TEXT,
  outcome         TEXT,                     -- full | mostly | pulled_away | cancelled
  entry_id        INTEGER REFERENCES entries(id)
);

-- Proactive messages (check-in cards). ref_id is 0 when not tied to a row.
CREATE TABLE IF NOT EXISTS slots (
  id                  INTEGER PRIMARY KEY,
  kind                TEXT NOT NULL,        -- morning | block_end | evening_close | lapse | silence | sunday
  local_date          TEXT NOT NULL,
  ref_id              INTEGER NOT NULL DEFAULT 0,
  due_utc             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | answered | skipped | expired
  sent_utc            TEXT,
  answered_utc        TEXT,
  telegram_message_id INTEGER,
  UNIQUE(kind, local_date, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_slots_due ON slots(status, due_utc);

CREATE TABLE IF NOT EXISTS llm_calls (
  id         INTEGER PRIMARY KEY,
  ts_utc     TEXT NOT NULL,
  local_date TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  model      TEXT,
  ok         INTEGER NOT NULL,
  error      TEXT
);

-- ActivityWatch categorisation rules: case-insensitive regex on one field, lowest priority first.
CREATE TABLE IF NOT EXISTS aw_rules (
  id       INTEGER PRIMARY KEY,
  field    TEXT NOT NULL,                   -- app | title | url
  pattern  TEXT NOT NULL,
  category TEXT NOT NULL,
  deep     INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100
);

-- Game layer ("Your New York"). Append-only ledger of what has been celebrated, plus the
-- XP high-water mark (key 'xp_hw'), so nothing is ever taken away. Everything else in the
-- game (XP, levels, quests, towers) is computed from entries, outputs and day status.
CREATE TABLE IF NOT EXISTS unlocks (
  key         TEXT PRIMARY KEY,             -- 'ach:honest_hour', 'node:Math:3', 'district:Brooklyn', 'postcard:week_kept:2026-10-12', 'seal:2026-10-17', 'xp_hw'
  kind        TEXT NOT NULL,                -- achievement | node | district | postcard | seal | ratchet
  unlocked_at TEXT NOT NULL,                -- 'YYYY-MM-DDTHH:MM:SSZ'
  meta        TEXT                          -- JSON (for 'xp_hw': {"xp": 1530})
);

-- ---------------------------------------------------------------------------
-- v2 additions (docs/FEATURES-V2.md). All additive.
-- ---------------------------------------------------------------------------

-- Tablet / LAN mode. Only SHA-256 hashes of the device token are stored.
CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  user_agent    TEXT,
  token_hash    TEXT NOT NULL UNIQUE,
  created_utc   TEXT NOT NULL,
  last_seen_utc TEXT,
  last_ip       TEXT,
  revoked_utc   TEXT                        -- soft delete: set when the owner revokes the device
);

-- One-time pairing codes (6 digits + a long token), valid ~10 minutes. Hashes only.
CREATE TABLE IF NOT EXISTS pairings (
  id          INTEGER PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_utc TEXT NOT NULL,
  expires_utc TEXT NOT NULL,
  used_utc    TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,   -- wrong 6-digit guesses; the pairing is burned at 5
  device_id   INTEGER REFERENCES devices(id)
);

-- The server-side Pomodoro. State is derived from these timestamps (see epoch/pomodoro.py).
CREATE TABLE IF NOT EXISTS pomodoro_runs (
  id              INTEGER PRIMARY KEY,
  preset          TEXT NOT NULL,            -- '50-10-3' | '25-5-4' | '90-15-2' | 'custom'
  work_s          INTEGER NOT NULL,
  break_s         INTEGER NOT NULL,
  cycles          INTEGER NOT NULL,
  category        TEXT NOT NULL,
  label           TEXT,
  started_utc     TEXT NOT NULL,
  status          TEXT NOT NULL,            -- running | paused | waiting (a work block is done, the run holds for the person) | finished | stopped
  extra_s         INTEGER NOT NULL DEFAULT 0,   -- seconds added to the CURRENT phase with "+5 min" (reset when the phase changes)
  phase_idx       INTEGER NOT NULL DEFAULT 0,   -- 0 = work 1, 1 = break 1, 2 = work 2, ...
  phase_start_utc TEXT NOT NULL,            -- when the current phase began
  phase_elapsed_s INTEGER NOT NULL DEFAULT 0,   -- seconds of this phase accrued before resumed_utc
  resumed_utc     TEXT,                     -- NULL while paused
  paused_utc      TEXT,                     -- when it was paused (NULL while running)
  ended_utc       TEXT,
  spot            TEXT                      -- the study spot (economy_catalog.STUDY_SPOTS id); added later, see db.ensure_columns
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_runs_status ON pomodoro_runs(status);

-- One row per finished (or partially finished) work block; rating it creates the entry.
CREATE TABLE IF NOT EXISTS pomodoro_blocks (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES pomodoro_runs(id),
  cycle       INTEGER NOT NULL,
  started_utc TEXT NOT NULL,
  ended_utc   TEXT NOT NULL,
  worked_s    INTEGER NOT NULL,
  partial     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'unrated',  -- unrated | rating | rated | expired | discarded
  focus       TEXT,                         -- full | mostly | pulled_away
  category    TEXT,
  note        TEXT,
  entry_id    INTEGER REFERENCES entries(id),
  rated_utc   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_blocks_status ON pomodoro_blocks(status);

-- Last Open-Meteo answer (single row).
CREATE TABLE IF NOT EXISTS weather_cache (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_utc TEXT NOT NULL,
  payload     TEXT NOT NULL                 -- JSON of the normalised reading
);

-- Postcards and nightly skylines (PNG files live in the data folder; ids are generated, never user paths).
CREATE TABLE IF NOT EXISTS postcards (
  id          TEXT PRIMARY KEY,             -- '<kind>-<YYYY-MM-DD>'
  kind        TEXT NOT NULL,                -- weekly | day
  period      TEXT NOT NULL,
  created_utc TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skylines (
  local_date  TEXT PRIMARY KEY,
  created_utc TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  sent_utc    TEXT                          -- when it went to Telegram (once per day)
);

-- ---------------------------------------------------------------------------
-- Money system (docs/ECONOMY.md). All additive: new tables and triggers only, safe on an existing database.
-- ---------------------------------------------------------------------------

-- Money earned from the honest counters, banked per day and source. Computed on read from entries/outputs, then ratcheted here:
-- a row can only go UP (the trigger below ignores a lower value), so editing or deleting an old entry never shrinks the balance.
CREATE TABLE IF NOT EXISTS econ_earned (
  local_date  TEXT NOT NULL,                -- the day; for source 'kept' the Monday of the kept week
  source      TEXT NOT NULL,                -- deep | output | star | kept
  cents       INTEGER NOT NULL,
  updated_utc TEXT NOT NULL,
  PRIMARY KEY (local_date, source)
);
CREATE TRIGGER IF NOT EXISTS econ_earned_ratchet BEFORE UPDATE ON econ_earned
  WHEN NEW.cents < OLD.cents
  BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS econ_earned_keep BEFORE DELETE ON econ_earned
  BEGIN SELECT RAISE(ABORT, 'econ_earned is a ratchet'); END;

-- The append-only money ledger: interest, rent, unpaid weeks, deposits, moves and purchases. `cents` is the change to savings
-- (positive in, negative out; 0 for notes such as an unpaid week or a move). `ref` is unique, which makes every writer idempotent.
CREATE TABLE IF NOT EXISTS econ_ledger (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at_utc TEXT NOT NULL,
  kind   TEXT NOT NULL,                     -- interest | rent | unpaid | deposit | deposit_back | move | purchase | spot_unlock | chest | chest_item
  ref    TEXT NOT NULL UNIQUE,              -- 'rent:2026-10-26', 'purchase:desk_setup', 'move:3', 'spot:rooftop', 'chest:2026-10-23', 'chest_item:typewriter'
  cents  INTEGER NOT NULL DEFAULT 0,
  week   TEXT,                              -- the Monday of the week the row belongs to
  meta   TEXT                               -- JSON
);
CREATE INDEX IF NOT EXISTS idx_econ_ledger_kind ON econ_ledger(kind, at_utc);
CREATE TRIGGER IF NOT EXISTS econ_ledger_no_update BEFORE UPDATE ON econ_ledger
  BEGIN SELECT RAISE(ABORT, 'econ_ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS econ_ledger_no_delete BEFORE DELETE ON econ_ledger
  BEGIN SELECT RAISE(ABORT, 'econ_ledger is append-only'); END;

-- One frozen row per closed Monday-to-Sunday week: the rent-day recap and a point on the net-worth graph. Written once.
CREATE TABLE IF NOT EXISTS econ_weeks (
  monday     TEXT PRIMARY KEY,
  closed_utc TEXT NOT NULL,
  summary    TEXT NOT NULL                  -- JSON, see economy.close_weeks
);
CREATE TRIGGER IF NOT EXISTS econ_weeks_no_update BEFORE UPDATE ON econ_weeks
  BEGIN SELECT RAISE(ABORT, 'econ_weeks rows are written once'); END;
CREATE TRIGGER IF NOT EXISTS econ_weeks_no_delete BEFORE DELETE ON econ_weeks
  BEGIN SELECT RAISE(ABORT, 'econ_weeks rows are written once'); END;

-- What is switched on: the outfit, the tower upgrades, the furniture in each slot, items sent to storage by a move.
CREATE TABLE IF NOT EXISTS econ_choice (
  key         TEXT PRIMARY KEY,             -- 'outfit' | 'upgrades' | 'placed' (old slots) | 'displaced' | 'layout' | 'spot' | 'missions_seen'
  value       TEXT NOT NULL,                -- JSON
  updated_utc TEXT NOT NULL
);

-- Cozy life sim (docs/COZY.md 4.6): the day's three missions, picked once (from data up to yesterday) and frozen, plus which of
-- them have been seen done. `done` only ever gains ids (a ratchet like econ_earned), so a chest earned stays earned. Rows are
-- never deleted. A chest is "earned" for a day when all three ids are in `done`; opening one is a `chest` row in econ_ledger.
CREATE TABLE IF NOT EXISTS econ_missions (
  local_date  TEXT PRIMARY KEY,
  missions    TEXT NOT NULL,                -- JSON [{id, tier, params}]
  done        TEXT NOT NULL DEFAULT '{}',   -- JSON {mission id: utc it was first seen done}
  created_utc TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS econ_missions_keep BEFORE DELETE ON econ_missions
  BEGIN SELECT RAISE(ABORT, 'econ_missions rows are kept'); END;
