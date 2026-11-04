"""SQLite access. One short-lived connection per unit of work (safe across threads)."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterator

from . import timeutil
from .categories import DEFAULT_AW_RULES

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# User-editable preferences (edited on /settings). Times are 'HH:MM' local.
DEFAULT_SETTINGS: dict[str, Any] = {
    "timezone": "Asia/Kolkata",
    "day_start_hour": 4,
    "start_date": None,               # set on first run: local date the tracker started
    "job_days": [0, 1, 2, 3, 4],      # Monday=0
    "job_start": "10:00",
    "job_end": "19:00",
    "study_start_weekday": "19:30",
    "study_end_weekday": "23:00",
    "study_start_weekend": "10:00",
    "study_end_weekend": "22:00",
    "morning_time_weekday": "07:30",
    "morning_time_weekend": "08:30",
    "bedtime": "23:30",
    "sleep_cutoff": "00:30",          # deep minutes after this don't count toward floor/target; "off" counts every minute
    "floor_minutes": 30,
    "target_weekday_minutes": 90,
    "target_weekend_minutes": 180,
    "deep_cap_minutes": 240,          # deep minutes above this per day don't count toward the target
    "deep_star_minutes": 240,         # the third of Today's three stars: this much deep focus in a day (uncapped; 3/4/5/6 h)
    "msg_cap": 4,                     # max proactive messages per local day
    "skips_per_week": 2,
    "max_blocks_per_day": 3,
    "llm_daily_cap": 100,             # self-imposed cap, well under OpenRouter's 1,000/day
    "referee_chat_id": None,          # Telegram chat id of the referee (optional)
    "referee_name": None,
    "silence_alert_ok": False,        # may the bot nudge the referee after 72h of silence?
    "phase": "Python",                # current ladder stage
    # v2 (docs/FEATURES-V2.md)
    "lan_enabled": False,             # bind 0.0.0.0 on the next start (tablet mode)
    "weather_enabled": True,          # NYC weather from Open-Meteo (free, no key)
    "seasonal_enabled": True,         # seasonal city decorations (cosmetic)
    "soundscape": "off",              # off | rain | cafe | brown | subway (the client synthesises it)
    "soundscape_volume": 40,          # 0..100
    "pomodoro_preset": "50-10-3",     # last preset used
    # cozy life sim (docs/COZY.md)
    "daily_missions": True,           # three small missions a day and the chest they fill (quiet mode hides them either way)
}


def utc_now_iso() -> str:
    return timeutil.to_iso(timeutil.now_utc())


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=10, isolation_level=None)  # autocommit
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def get_conn(db_path: Path | str) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Group several writes atomically (connections are autocommit otherwise)."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def get_setting(conn: sqlite3.Connection, key: str) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return DEFAULT_SETTINGS.get(key)
    return json.loads(row["value"])


def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, json.dumps(value)),
    )


def all_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    merged = dict(DEFAULT_SETTINGS)
    for row in conn.execute("SELECT key, value FROM settings"):
        merged[row["key"]] = json.loads(row["value"])
    return merged


def start_date(conn: sqlite3.Connection) -> date:
    return date.fromisoformat(get_setting(conn, "start_date"))


def tracker_build_until(conn: sqlite3.Connection) -> date:
    """"Tracker build" counts toward the floor for the first 14 days only."""
    return start_date(conn) + timedelta(days=13)


def first_contract_monday(start: date) -> date:
    """Week 1 is a baseline of at least 7 days: the contract starts on the first Monday >= start + 7."""
    candidate = start + timedelta(days=7)
    return candidate + timedelta(days=(7 - candidate.weekday()) % 7)


# Columns added after a table first shipped: (table, column, definition). Additive only; `CREATE TABLE IF NOT EXISTS` in schema.sql
# already has them for a new database, this adds them to an older one.
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("pomodoro_runs", "spot", "TEXT"),          # the study spot a focus run happens at (docs/COZY.md 4.5)
)


def ensure_columns(conn: sqlite3.Connection) -> None:
    """Add any column in ADDED_COLUMNS the database does not have yet. Safe to call any number of times."""
    for table, column, definition in ADDED_COLUMNS:
        try:
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            if have and column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        except sqlite3.OperationalError:       # another process added it a moment ago
            pass


def init_db(db_path: Path | str, today: date | None = None) -> None:
    """Create tables and seed defaults on first run. Safe to call on every start."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with get_conn(db_path) as conn:
        conn.executescript(SCHEMA_PATH.read_text())
        ensure_columns(conn)
        with transaction(conn):
            if conn.execute("SELECT 1 FROM settings WHERE key = 'start_date'").fetchone() is None:
                tz = get_setting(conn, "timezone")
                start = today or timeutil.local_date_of(timeutil.now_utc(), tz, get_setting(conn, "day_start_hour"))
                set_setting(conn, "start_date", start.isoformat())
                conn.execute(
                    "INSERT INTO contracts(effective_from, outputs_per_week, floor_days_per_week, created_at) "
                    "VALUES (?, 2, 5, ?)",
                    (first_contract_monday(start).isoformat(), utc_now_iso()),
                )
            if conn.execute("SELECT COUNT(*) FROM aw_rules").fetchone()[0] == 0:
                conn.executemany(
                    "INSERT INTO aw_rules(field, pattern, category, deep, priority) VALUES (?, ?, ?, ?, ?)",
                    DEFAULT_AW_RULES,
                )
