"""Epoch rules: day status, week verdicts, runs, contracts, skips, lapses and write helpers.

Everything here is computed from the database when you look at it. Nothing like a
"streak counter" is ever stored, so fixing an entry or changing the time zone
recomputes correctly.

The public functions at the top level are the API used by the web app, the Telegram
bot and the scheduler. Internally a small helper class (`_Calc`) loads the settings
once and caches per-day facts, so a week or a whole history is cheap to compute.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Iterator

from . import categories, db, timeutil

# Statuses that keep the run going (see current_run).
RUN_STATUSES = ("floor", "skip", "rest", "repaired")
MIN_GAP_MINUTES = 10
JOB_BLOCK_NOTE = "job block"
VALID_MARK_KINDS = ("skip", "rest")
VALID_LAPSE_CHOICES = ("skip", "repair", "let_go")
JOB_CHOICES = ("usual", "left_early", "stayed_late", "leave")
MAX_WHAT_CHARS = 200     # "what it shows" is one line
MAX_NOTE_CHARS = 200


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------

@dataclass
class DaySummary:
    local_date: date
    status: str                      # before_start | future | floor | rest | skip | open | repaired | missed
    is_job_day: bool
    deep_minutes: int                # union of intervals, clipped to the day, sleep cutoff applied, uncapped
    deep_by_category: dict[str, int]
    logged_minutes: int              # every non-deleted entry in the day (union)
    outputs_count: int
    floor_minutes: int
    floor_met: bool
    target_minutes: int
    target_met: bool
    mark: str | None                 # 'skip' | 'rest' | None
    is_comeback: bool


@dataclass
class WeekSummary:
    monday: date
    sunday: date
    status: str                      # baseline | kept | not_kept | in_progress
    outputs_required: int | None
    floor_days_required: int | None
    outputs: list[sqlite3.Row]
    outputs_count: int
    floor_days: int                  # days with status floor or repaired
    skips_used: int
    skips_left: int
    deep_minutes: int                # uncapped sum of the days' deep minutes
    deep_by_category: dict[str, int]
    days: list[DaySummary]
    planned_minutes: int
    planned_done_minutes: int
    top_lapse_reasons: list[tuple[str, int]]


@dataclass
class _Facts:
    """Raw numbers for one local day, before any status is decided."""
    deep: int
    by_category: dict[str, int]
    logged: int
    outputs: int
    floor_met: bool
    late_deep: int = 0               # deep minutes after the sleep cutoff: shown, never counted


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

@contextmanager
def _atomic(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Run several writes as one unit, unless the caller already opened a transaction."""
    if conn.in_transaction:
        yield conn
    else:
        with db.transaction(conn):
            yield conn


def _sweep(intervals: list[tuple[datetime, datetime, str]]) -> tuple[float, dict[str, float]]:
    """Union of (start, end, key) intervals.

    Every moment is counted once and credited to the earliest-starting interval that
    covers it. Returns (total seconds, seconds per key); the per-key numbers add up to
    the total.
    """
    total = 0.0
    per_key: dict[str, float] = {}
    cursor: datetime | None = None
    for start, end, key in sorted(intervals, key=lambda item: (item[0], item[1])):
        if cursor is not None and start < cursor:
            start = cursor
        if end <= start:
            continue
        seconds = (end - start).total_seconds()
        total += seconds
        per_key[key] = per_key.get(key, 0.0) + seconds
        cursor = end if cursor is None or end > cursor else cursor
    return total, per_key


def valid_sleep_cutoff(value: Any, day_start_hour: int) -> bool:
    """True when `value` is a usable 'HH:MM' cutoff for a day that starts at `day_start_hour`.

    It has to fall in the second half of the day (12 h or more after the day starts), so with the day
    starting at 04:00 anything from 16:00 to 03:59 works. "off", empty or None means no cutoff (False).
    """
    if not value or str(value).strip().lower() in ("off", "none"):
        return False
    try:
        t = timeutil.parse_hhmm(str(value))
    except (ValueError, TypeError):
        return False
    return (t.hour * 60 + t.minute - int(day_start_hour) * 60) % 1440 >= 12 * 60


def _merge(pairs: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    """Merge overlapping (start, end) pairs into a sorted list of disjoint ones."""
    merged: list[tuple[datetime, datetime]] = []
    for start, end in sorted(pairs):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _minutes(seconds: float) -> int:
    return int(round(seconds / 60))


# --------------------------------------------------------------------------
# The calculator: settings + caches for one computation
# --------------------------------------------------------------------------

class _Calc:
    """Loads settings once and caches per-day facts and statuses."""

    def __init__(self, conn: sqlite3.Connection, today: date | None = None) -> None:
        self.conn = conn
        self.s = db.all_settings(conn)
        self.tz: str = self.s["timezone"]
        self.day_start_hour: int = self.s["day_start_hour"]
        self.today: date = today or timeutil.local_date_of(timeutil.now_utc(), self.tz, self.day_start_hour)
        self.start: date = date.fromisoformat(self.s["start_date"])
        self.build_until: date = self.start + timedelta(days=13)
        self._facts: dict[date, _Facts] = {}
        self._status: dict[date, str] = {}
        self._summaries: dict[date, DaySummary] = {}

    # --- raw facts --------------------------------------------------------

    def is_job_day(self, d: date) -> bool:
        return d.weekday() in self.s["job_days"]

    def facts(self, d: date) -> _Facts:
        if d not in self._facts:
            self._facts[d] = self._compute_facts(d)
        return self._facts[d]

    def sleep_cutoff_at(self, d: date) -> datetime | None:
        """The instant after which deep minutes of day `d` stop counting, or None when the cutoff is off/unusable."""
        raw = self.s.get("sleep_cutoff")
        if not valid_sleep_cutoff(raw, self.day_start_hour):
            return None
        return timeutil.at_local(d, str(raw).strip(), self.tz, self.day_start_hour)

    def _compute_facts(self, d: date) -> _Facts:
        day_lo, day_hi = timeutil.day_bounds_utc(d, self.tz, self.day_start_hour)
        cutoff = self.sleep_cutoff_at(d)
        deep_hi = day_hi if cutoff is None else max(day_lo, min(day_hi, cutoff))

        rows = self.conn.execute(
            "SELECT start_utc, end_utc, category, deep FROM entries "
            "WHERE deleted = 0 AND start_utc < ? AND end_utc > ?",
            (timeutil.to_iso(day_hi), timeutil.to_iso(day_lo)),
        ).fetchall()

        logged: list[tuple[datetime, datetime, str]] = []
        deep: list[tuple[datetime, datetime, str]] = []
        late: list[tuple[datetime, datetime, str]] = []
        for row in rows:
            start = max(timeutil.from_iso(row["start_utc"]), day_lo)
            end = min(timeutil.from_iso(row["end_utc"]), day_hi)
            logged.append((start, end, row["category"]))
            if row["deep"] and categories.counts_toward_floor(row["category"], d, self.build_until):
                deep.append((start, min(end, deep_hi), row["category"]))
                late.append((max(start, deep_hi), end, row["category"]))

        logged_seconds, _ = _sweep(logged)
        deep_seconds, deep_by_seconds = _sweep(deep)
        deep_minutes = _minutes(deep_seconds)
        late_deep = _minutes(_sweep(late)[0])
        outputs = self.conn.execute(
            "SELECT COUNT(*) FROM outputs WHERE deleted = 0 AND local_date = ?", (d.isoformat(),)
        ).fetchone()[0]
        return _Facts(
            deep=deep_minutes,
            by_category={cat: _minutes(sec) for cat, sec in deep_by_seconds.items() if _minutes(sec) > 0},
            logged=_minutes(logged_seconds),
            outputs=outputs,
            floor_met=deep_minutes >= self.s["floor_minutes"] or outputs >= 1,
            late_deep=late_deep,
        )

    # --- marks and lapses -------------------------------------------------

    def mark(self, d: date) -> str | None:
        row = self.conn.execute("SELECT kind FROM day_marks WHERE local_date = ?", (d.isoformat(),)).fetchone()
        return row["kind"] if row else None

    def lapse(self, d: date) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM lapses WHERE local_date = ?", (d.isoformat(),)).fetchone()

    # --- status -----------------------------------------------------------

    def status(self, d: date) -> str:
        if d not in self._status:
            self._status[d] = self._compute_status(d)
        return self._status[d]

    def _compute_status(self, d: date) -> str:
        if d < self.start:
            return "before_start"
        if d > self.today:
            return "future"
        if self.facts(d).floor_met:
            return "floor"
        mark = self.mark(d)
        if mark:
            return mark
        if d == self.today:
            return "open"
        if self._is_repaired(d):
            return "repaired"
        return "missed"

    def _is_repaired(self, missed: date) -> bool:
        """A missed day is repaired when the floor was met on both of the next two days.

        The user must not have chosen another way out in the lapse flow
        (a missing lapse row counts as 'repair').
        """
        if missed + timedelta(days=2) > self.today:
            return False
        lapse = self.lapse(missed)
        if lapse is not None and lapse["choice"] not in (None, "repair"):
            return False
        return self.facts(missed + timedelta(days=1)).floor_met and self.facts(missed + timedelta(days=2)).floor_met

    def is_comeback(self, d: date) -> bool:
        """A floor day whose most recent non-open previous day was missed or repaired."""
        if self.status(d) != "floor":
            return False
        previous = d - timedelta(days=1)
        while previous >= self.start and self.status(previous) == "open":
            previous -= timedelta(days=1)
        if previous < self.start:
            return False
        return self.status(previous) in ("missed", "repaired")

    # --- summaries --------------------------------------------------------

    def summary(self, d: date) -> DaySummary:
        if d not in self._summaries:
            facts = self.facts(d)
            job_day = self.is_job_day(d)
            target = self.s["target_weekday_minutes"] if job_day else self.s["target_weekend_minutes"]
            self._summaries[d] = DaySummary(
                local_date=d,
                status=self.status(d),
                is_job_day=job_day,
                deep_minutes=facts.deep,
                deep_by_category=dict(facts.by_category),
                logged_minutes=facts.logged,
                outputs_count=facts.outputs,
                floor_minutes=self.s["floor_minutes"],
                floor_met=facts.floor_met,
                target_minutes=target,
                target_met=min(facts.deep, self.s["deep_cap_minutes"]) >= target,
                mark=self.mark(d),
                is_comeback=self.is_comeback(d),
            )
        return self._summaries[d]

    def week(self, d: date) -> WeekSummary:
        monday = timeutil.week_monday(d)
        sunday = monday + timedelta(days=6)
        days = [self.summary(monday + timedelta(days=i)) for i in range(7)]

        outputs = self.conn.execute(
            "SELECT * FROM outputs WHERE deleted = 0 AND local_date BETWEEN ? AND ? ORDER BY local_date, id",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchall()
        floor_days = sum(1 for day in days if day.status in ("floor", "repaired"))
        skips_used = self.conn.execute(
            "SELECT COUNT(*) FROM day_marks WHERE local_date BETWEEN ? AND ?",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchone()[0]

        contract = contract_for(self.conn, monday)
        outputs_required = contract["outputs_per_week"] if contract else None
        floor_days_required = contract["floor_days_per_week"] if contract else None
        if contract is None:
            status = "baseline"
        elif len(outputs) >= outputs_required and floor_days >= floor_days_required:
            status = "kept"
        elif self.today > sunday:
            status = "not_kept"
        else:
            status = "in_progress"

        by_category: dict[str, int] = {}
        for day in days:
            for cat, minutes in day.deep_by_category.items():
                by_category[cat] = by_category.get(cat, 0) + minutes

        planned, done = self._plan_vs_actual(monday, sunday)
        reasons = self.conn.execute(
            "SELECT reason, COUNT(*) AS n FROM lapses WHERE local_date BETWEEN ? AND ? "
            "AND reason IS NOT NULL AND reason != '' GROUP BY reason ORDER BY n DESC, reason LIMIT 3",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchall()

        return WeekSummary(
            monday=monday, sunday=sunday, status=status,
            outputs_required=outputs_required, floor_days_required=floor_days_required,
            outputs=outputs, outputs_count=len(outputs),
            floor_days=floor_days, skips_used=skips_used,
            skips_left=max(0, self.s["skips_per_week"] - skips_used),
            deep_minutes=sum(day.deep_minutes for day in days),
            deep_by_category=by_category, days=days,
            planned_minutes=planned, planned_done_minutes=done,
            top_lapse_reasons=[(row["reason"], row["n"]) for row in reasons],
        )

    # --- plan vs actual ---------------------------------------------------

    def block_done_minutes(self, block: sqlite3.Row) -> int:
        """Minutes actually done for one plan block, never more than were planned.

        1. Entries linked to the block count.
        2. Otherwise, if the block was marked 'done', the planned minutes count.
        3. Otherwise, same-category entries that overlap the block's time window count
           (so a focus session or typed log for the block is credited without extra clicks).
        """
        rows = self.conn.execute(
            "SELECT start_utc, end_utc FROM entries WHERE deleted = 0 AND plan_block_id = ?", (block["id"],)
        ).fetchall()
        if rows:
            seconds = sum(
                max(0.0, (timeutil.from_iso(r["end_utc"]) - timeutil.from_iso(r["start_utc"])).total_seconds())
                for r in rows
            )
            return min(block["minutes"], _minutes(seconds))
        if block["status"] == "done":
            return block["minutes"]
        return min(block["minutes"], self._overlap_minutes(block))

    def _overlap_minutes(self, block: sqlite3.Row) -> int:
        """Minutes of same-category entries inside the block's planned window (0 without a cue time)."""
        if not block["cue_time"]:
            return 0
        try:
            start = timeutil.at_local(date.fromisoformat(block["local_date"]), block["cue_time"], self.tz, self.day_start_hour)
        except ValueError:
            return 0
        end = start + timedelta(minutes=block["minutes"])
        rows = self.conn.execute(
            "SELECT start_utc, end_utc FROM entries WHERE deleted = 0 AND category = ? AND start_utc < ? AND end_utc > ?",
            (block["category"], timeutil.to_iso(end), timeutil.to_iso(start)),
        ).fetchall()
        pairs = [
            (max(start, timeutil.from_iso(r["start_utc"])), min(end, timeutil.from_iso(r["end_utc"]))) for r in rows
        ]
        return _minutes(sum((b - a).total_seconds() for a, b in _merge(pairs)))

    def _plan_vs_actual(self, first: date, last: date, category: str | None = None) -> tuple[int, int]:
        sql = "SELECT * FROM plan_blocks WHERE local_date BETWEEN ? AND ?"
        params: list = [first.isoformat(), last.isoformat()]
        if category is not None:
            sql += " AND category = ?"
            params.append(category)
        blocks = self.conn.execute(sql, params).fetchall()
        return sum(b["minutes"] for b in blocks), sum(self.block_done_minutes(b) for b in blocks)


# --------------------------------------------------------------------------
# Public read API
# --------------------------------------------------------------------------

def today_local(conn: sqlite3.Connection) -> date:
    """Today's local date (a day runs from day_start_hour to the same hour tomorrow)."""
    return timeutil.local_date_of(
        timeutil.now_utc(), db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour")
    )


def late_deep_minutes(conn: sqlite3.Connection, d: date, today: date | None = None) -> int:
    """Deep minutes of day `d` that fall after the sleep cutoff: shown on the log, never counted."""
    return _Calc(conn, today).facts(d).late_deep


def is_job_day(conn: sqlite3.Connection, d: date) -> bool:
    return d.weekday() in db.get_setting(conn, "job_days")


def block_done_minutes(conn: sqlite3.Connection, block: sqlite3.Row) -> int:
    """Minutes done for a plan block (see `_Calc.block_done_minutes`)."""
    return _Calc(conn).block_done_minutes(block)


def day_summary(conn: sqlite3.Connection, d: date, today: date | None = None) -> DaySummary:
    return _Calc(conn, today).summary(d)


def week_summary(conn: sqlite3.Connection, d: date, today: date | None = None) -> WeekSummary:
    """Summary of the ISO week (Monday to Sunday) that contains `d`."""
    return _Calc(conn, today).week(d)


def current_run(conn: sqlite3.Connection, today: date | None = None) -> int:
    """Consecutive good days going back from yesterday, plus today if it is already a floor day.

    A day is good when its status is floor, skip, rest or repaired. An 'open' today
    never breaks the run.
    """
    calc = _Calc(conn, today)
    run = 1 if calc.status(calc.today) == "floor" else 0
    day = calc.today - timedelta(days=1)
    while day >= calc.start and calc.status(day) in RUN_STATUSES:
        run += 1
        day -= timedelta(days=1)
    return run


def lifetime_totals(conn: sqlite3.Connection) -> dict:
    """Totals that never reset: deep_minutes, outputs, weeks_kept, comebacks, days_tracked."""
    calc = _Calc(conn)
    deep_minutes = comebacks = days_tracked = 0
    day = calc.start
    while day <= calc.today:
        summary = calc.summary(day)
        deep_minutes += summary.deep_minutes
        comebacks += 1 if summary.is_comeback else 0
        days_tracked += 1 if (summary.logged_minutes > 0 or summary.outputs_count > 0) else 0
        day += timedelta(days=1)

    weeks_kept = 0
    monday = timeutil.week_monday(calc.start)
    while monday <= timeutil.week_monday(calc.today):
        weeks_kept += 1 if calc.week(monday).status == "kept" else 0
        monday += timedelta(days=7)

    outputs = conn.execute("SELECT COUNT(*) FROM outputs WHERE deleted = 0").fetchone()[0]
    return {
        "deep_minutes": deep_minutes,
        "outputs": outputs,
        "weeks_kept": weeks_kept,
        "comebacks": comebacks,
        "days_tracked": days_tracked,
    }


def consistency(conn: sqlite3.Connection, today: date | None = None) -> dict:
    """Headline numbers: weeks kept in the last 12 (and 26) and floor days in the last 30.

    `weeks_with_contract_last_12` says how many of those 12 weeks had a contract, so the
    page can show "3 of 5" early on instead of "3 of 12".
    """
    calc = _Calc(conn, today)
    this_monday = timeutil.week_monday(calc.today)

    def weeks_kept(count: int) -> tuple[int, int]:
        kept = with_contract = 0
        for i in range(count):
            monday = this_monday - timedelta(days=7 * i)
            if monday + timedelta(days=6) < calc.start:
                break
            week = calc.week(monday)
            with_contract += 0 if week.status == "baseline" else 1
            kept += 1 if week.status == "kept" else 0
        return kept, with_contract

    kept_12, contract_12 = weeks_kept(12)
    kept_26, _ = weeks_kept(26)
    floor_days = sum(
        1 for i in range(30) if calc.status(calc.today - timedelta(days=i)) in ("floor", "repaired")
    )
    return {
        "weeks_kept_last_12": kept_12,
        "weeks_with_contract_last_12": contract_12,
        "weeks_kept_last_26": kept_26,
        "floor_days_last_30": floor_days,
    }


# --------------------------------------------------------------------------
# Contracts
# --------------------------------------------------------------------------

def contract_for(conn: sqlite3.Connection, d: date) -> sqlite3.Row | None:
    """The contract in force for the week containing `d` (None during the baseline)."""
    return conn.execute(
        "SELECT * FROM contracts WHERE effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1",
        (timeutil.week_monday(d).isoformat(),),
    ).fetchone()


def _insert_contract(conn: sqlite3.Connection, effective: date, outputs: int, floor_days: int) -> None:
    conn.execute(
        "INSERT INTO contracts(effective_from, outputs_per_week, floor_days_per_week, created_at) VALUES (?, ?, ?, ?)",
        (effective.isoformat(), outputs, floor_days, db.utc_now_iso()),
    )


def change_contract(conn: sqlite3.Connection, outputs: int, floor_days: int, today: date | None = None) -> date:
    """Change the weekly contract. Returns the Monday the new numbers take effect.

    Raising applies from this week's Monday. Lowering applies from next Monday (the
    "akrasia horizon"). If one number goes up and the other down, the raise applies now
    and the whole new contract applies next Monday. Changes still waiting for a future
    Monday are replaced by this one.
    """
    if outputs < 0 or not 0 <= floor_days <= 7:
        raise ValueError("outputs must be >= 0 and floor_days between 0 and 7")
    today = today or today_local(conn)
    this_monday = timeutil.week_monday(today)
    next_monday = this_monday + timedelta(days=7)

    with _atomic(conn):
        current = contract_for(conn, this_monday)
        pending = conn.execute(
            "SELECT effective_from FROM contracts WHERE effective_from > ? ORDER BY effective_from LIMIT 1",
            (this_monday.isoformat(),),
        ).fetchone()
        conn.execute("DELETE FROM contracts WHERE effective_from > ?", (this_monday.isoformat(),))

        if current is None:  # baseline weeks: the first contract has not started yet
            effective = date.fromisoformat(pending["effective_from"]) if pending else next_monday
            _insert_contract(conn, effective, outputs, floor_days)
            return effective

        cur_outputs, cur_days = current["outputs_per_week"], current["floor_days_per_week"]
        if (outputs, floor_days) == (cur_outputs, cur_days):
            return this_monday
        if outputs >= cur_outputs and floor_days >= cur_days:
            _insert_contract(conn, this_monday, outputs, floor_days)
            return this_monday
        if outputs <= cur_outputs and floor_days <= cur_days:
            _insert_contract(conn, next_monday, outputs, floor_days)
            return next_monday
        _insert_contract(conn, this_monday, max(outputs, cur_outputs), max(floor_days, cur_days))
        _insert_contract(conn, next_monday, outputs, floor_days)
        return next_monday


# --------------------------------------------------------------------------
# Lapses, repairs, skips
# --------------------------------------------------------------------------

def pending_lapse(conn: sqlite3.Connection, today: date | None = None) -> date | None:
    """Yesterday, if it was missed and the user has not finished the lapse flow yet.

    A reason alone (tapped on the phone) is not an answer: the day stays pending until
    a choice (skip, repair or let go) has been made.
    """
    calc = _Calc(conn, today)
    yesterday = calc.today - timedelta(days=1)
    if yesterday < calc.start or calc.status(yesterday) != "missed":
        return None
    lapse = calc.lapse(yesterday)
    return None if lapse is not None and lapse["choice"] else yesterday


def open_repair_window(conn: sqlite3.Connection, today: date | None = None) -> date | None:
    """The missed day whose 48-hour repair window is open right now, or None.

    A window is open when the user chose 'repair' for a missed day, the two days after
    it are not both over yet, and no day in between has been missed (which would end
    the attempt). Because a miss ends any earlier attempt, at most one window is open.
    """
    calc = _Calc(conn, today)
    for offset in (1, 2):  # most recent candidate first
        missed = calc.today - timedelta(days=offset)
        if missed < calc.start or calc.facts(missed).floor_met or calc.mark(missed):
            continue
        lapse = calc.lapse(missed)
        if lapse is None or lapse["choice"] != "repair":
            continue
        next_day = missed + timedelta(days=1)
        if next_day < calc.today and not calc.facts(next_day).floor_met:
            continue  # the attempt already ended
        if calc.status(missed) == "repaired":
            continue
        return missed
    return None


def use_skip(conn: sqlite3.Connection, d: date, kind: str = "skip", reason: str | None = None) -> bool:
    """Mark `d` as a skip or rest day. Returns False when the week has no skips left.

    Marking a day that is already marked is allowed and costs nothing extra.
    """
    if kind not in VALID_MARK_KINDS:
        raise ValueError(f"kind must be one of {VALID_MARK_KINDS}")
    monday = timeutil.week_monday(d)
    sunday = monday + timedelta(days=6)
    with _atomic(conn):
        if conn.execute("SELECT 1 FROM day_marks WHERE local_date = ?", (d.isoformat(),)).fetchone():
            conn.execute(
                "UPDATE day_marks SET kind = ?, reason = ? WHERE local_date = ?", (kind, reason, d.isoformat())
            )
            return True
        used = conn.execute(
            "SELECT COUNT(*) FROM day_marks WHERE local_date BETWEEN ? AND ?",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchone()[0]
        if used >= db.get_setting(conn, "skips_per_week"):
            return False
        conn.execute(
            "INSERT INTO day_marks(local_date, kind, reason, created_at) VALUES (?, ?, ?, ?)",
            (d.isoformat(), kind, reason, db.utc_now_iso()),
        )
        return True


def record_lapse(conn: sqlite3.Connection, missed: date, reason: str | None, choice: str, if_then: str | None) -> None:
    """Save the answers from the lapse flow for a missed day.

    `choice` is 'skip', 'repair' or 'let_go' ('letgo' is accepted too). Choosing 'skip'
    marks the day as a skip; if the week has no skips left it is saved as 'let_go'.
    """
    choice = "let_go" if choice == "letgo" else choice
    if choice not in VALID_LAPSE_CHOICES:
        raise ValueError(f"choice must be one of {VALID_LAPSE_CHOICES}")
    with _atomic(conn):
        if choice == "skip" and not use_skip(conn, missed, "skip", reason):
            choice = "let_go"
        conn.execute(
            "INSERT INTO lapses(local_date, reason, choice, if_then, created_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(local_date) DO UPDATE SET reason = excluded.reason, choice = excluded.choice, "
            "if_then = excluded.if_then",
            (missed.isoformat(), reason, choice, if_then, db.utc_now_iso()),
        )
        # The lapse card (if one is waiting or was sent) has been answered, wherever the answer came from.
        conn.execute(
            "UPDATE slots SET status = 'answered', answered_utc = ? "
            "WHERE kind = 'lapse' AND status IN ('pending', 'sent') AND local_date = ?",
            (db.utc_now_iso(), (missed + timedelta(days=1)).isoformat()),
        )


# --------------------------------------------------------------------------
# Plan vs actual, gaps
# --------------------------------------------------------------------------

def overrun_ratio(conn: sqlite3.Connection, category: str | None = None, weeks: int = 4) -> float | None:
    """How much of what you plan you usually finish (actual / planned), or None without history.

    Looks at plan blocks from the last `weeks` weeks up to yesterday (today's blocks are
    still in progress). Each block's actual is capped at its planned minutes.
    """
    calc = _Calc(conn)
    last = calc.today - timedelta(days=1)
    first = calc.today - timedelta(days=7 * weeks)
    planned, done = calc._plan_vs_actual(first, last, category)
    return done / planned if planned > 0 else None


def _pomodoro_rest_spans(conn: sqlite3.Connection, lo: datetime, hi: datetime) -> list[tuple[datetime, datetime]]:
    """Time inside a Pomodoro run that no block covers: its breaks and any pauses.

    A rated block becomes an entry that ends when the block ended and starts `worked_s` earlier, so the
    break after it (and a pause before it) would otherwise show up as an "unlogged" stretch. They are
    rest the person chose, not missing time, so they are not gaps. A block that never happened (discarded)
    is not covered: its own stretch stays open.
    """
    try:
        blocks = conn.execute(
            "SELECT b.run_id, b.started_utc, b.ended_utc, r.started_utc AS run_started FROM pomodoro_blocks b "
            "JOIN pomodoro_runs r ON r.id = b.run_id WHERE r.started_utc < ? AND b.ended_utc > ? "
            "ORDER BY b.run_id, b.started_utc",
            (timeutil.to_iso(hi), timeutil.to_iso(lo - timedelta(hours=6))),
        ).fetchall()
    except sqlite3.OperationalError:       # an old database without the Pomodoro tables
        return []
    spans: list[tuple[datetime, datetime]] = []
    previous_run, previous_end = None, None
    for row in blocks:
        began = timeutil.from_iso(row["started_utc"])
        if row["run_id"] != previous_run:
            spans.append((timeutil.from_iso(row["run_started"]), began))          # a pause before the first block
        elif previous_end is not None and began > previous_end:
            spans.append((previous_end, began))                                   # the break (and any pause) between blocks
        previous_run, previous_end = row["run_id"], timeutil.from_iso(row["ended_utc"])
    return [(a, b) for a, b in spans if b > a]


def gaps(
    conn: sqlite3.Connection, d: date, start_hhmm: str | None = None, end_utc: datetime | None = None
) -> list[tuple[datetime, datetime]]:
    """Unlogged stretches of the waking day, each at least 10 minutes.

    The day runs from `start_hhmm` (default: the morning time for that kind of day) to
    `end_utc` (default: the earlier of now and bedtime). On job days the job window is
    left out, unless a 'Day job' entry exists for the day, in which case the entry
    itself is what covers it (so a "left early" day leaves the last two hours open),
    or the day was closed as a leave day, in which case the whole day is open.
    """
    calc = _Calc(conn)
    s, tz, dsh = calc.s, calc.tz, calc.day_start_hour
    day_lo, day_hi = timeutil.day_bounds_utc(d, tz, dsh)

    morning_key = "morning_time_weekday" if d.weekday() < 5 else "morning_time_weekend"
    start = max(day_lo, timeutil.at_local(d, start_hhmm or s[morning_key], tz, dsh))
    if end_utc is None:
        end_utc = min(timeutil.now_utc(), timeutil.at_local(d, s["bedtime"], tz, dsh))
    end = min(day_hi, end_utc)
    if end <= start:
        return []

    rows = conn.execute(
        "SELECT start_utc, end_utc, category FROM entries WHERE deleted = 0 AND start_utc < ? AND end_utc > ?",
        (timeutil.to_iso(end), timeutil.to_iso(start)),
    ).fetchall()
    busy = [(timeutil.from_iso(r["start_utc"]), timeutil.from_iso(r["end_utc"])) for r in rows]
    busy.extend(_pomodoro_rest_spans(conn, start, end))
    has_job_entry = any(r["category"] == "Day job" for r in rows)
    if calc.is_job_day(d) and not has_job_entry and not is_leave_day(conn, d):
        busy.append((
            timeutil.at_local(d, s["job_start"], tz, dsh),
            timeutil.at_local(d, s["job_end"], tz, dsh),
        ))

    result: list[tuple[datetime, datetime]] = []
    cursor = start
    for busy_start, busy_end in _merge(busy):
        if busy_start > cursor:
            result.append((cursor, min(busy_start, end)))
        cursor = max(cursor, busy_end)
        if cursor >= end:
            break
    if cursor < end:
        result.append((cursor, end))
    minimum = timedelta(minutes=MIN_GAP_MINUTES)
    return [(a, b) for a, b in result if b - a >= minimum]


# --------------------------------------------------------------------------
# Write helpers
# --------------------------------------------------------------------------

def add_entry(
    conn: sqlite3.Connection,
    start_utc: datetime,
    end_utc: datetime,
    category: str,
    deep: bool,
    source: str,
    note: str | None = None,
    plan_block_id: int | None = None,
) -> int:
    """Insert a time entry and return its id. Overlaps are allowed (they are counted once).

    Notes are cut to 200 characters.
    """
    if category not in categories.ALL:
        raise ValueError(f"unknown category: {category!r}")
    if start_utc.tzinfo is None or end_utc.tzinfo is None:
        raise ValueError("start and end must be timezone-aware")
    if end_utc <= start_utc:
        raise ValueError("end must be after start")
    note = (note or "").strip()[:MAX_NOTE_CHARS] or None
    cursor = conn.execute(
        "INSERT INTO entries(start_utc, end_utc, category, deep, source, note, plan_block_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            timeutil.to_iso(start_utc), timeutil.to_iso(end_utc), category, 1 if deep else 0,
            source, note, plan_block_id, db.utc_now_iso(),
        ),
    )
    return int(cursor.lastrowid)


def add_output(conn: sqlite3.Connection, d: date, stage: str, what: str, url: str | None = None) -> int:
    """Record something shipped (a link plus one line on what it shows) and return its id."""
    if stage not in categories.ALL:
        raise ValueError(f"unknown stage: {stage!r}")
    what = (what or "").strip()[:MAX_WHAT_CHARS]
    if not what:
        raise ValueError("say in one line what it shows")
    url = (url or "").strip() or None
    cursor = conn.execute(
        "INSERT INTO outputs(local_date, stage, url, what, created_at) VALUES (?, ?, ?, ?, ?)",
        (d.isoformat(), stage, url, what, db.utc_now_iso()),
    )
    return int(cursor.lastrowid)


def render_if_then(cue_time: str | None, category: str, task: str | None) -> str:
    """Turn a plan block into an if-then sentence.

    Example: "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-10."
    """
    if cue_time:
        parsed = timeutil.parse_hhmm(cue_time)
        cue = f"it's {parsed.hour:02d}:{parsed.minute:02d} and I'm home"
    else:
        cue = "I sit down at my desk"
    task = (task or "").strip()
    action = f"I open {task}" if task else f"I start my {category} block"
    return f"IF {cue}, THEN {action}."


def add_plan_block(
    conn: sqlite3.Connection, d: date, category: str, minutes: int, cue_time: str | None, task: str | None = None
) -> int:
    """Add a planned block for a day (with its rendered if-then sentence) and return its id."""
    if category not in categories.ALL:
        raise ValueError(f"unknown category: {category!r}")
    if minutes <= 0:
        raise ValueError("minutes must be positive")
    if cue_time:
        parsed = timeutil.parse_hhmm(cue_time)
        cue_time = f"{parsed.hour:02d}:{parsed.minute:02d}"
    task = (task or "").strip() or None
    cursor = conn.execute(
        "INSERT INTO plan_blocks(local_date, category, minutes, cue_time, task, if_then, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (d.isoformat(), category, minutes, cue_time or None, task,
         render_if_then(cue_time, category, task), db.utc_now_iso()),
    )
    return int(cursor.lastrowid)


def is_leave_day(conn: sqlite3.Connection, d: date) -> bool:
    """True if the day was closed as a leave day (no day job that day)."""
    return conn.execute("SELECT 1 FROM job_leaves WHERE local_date = ?", (d.isoformat(),)).fetchone() is not None


def job_block_closed(conn: sqlite3.Connection, d: date) -> bool:
    """True once the job block of day `d` has been answered (a job entry exists, or it is a leave day)."""
    if is_leave_day(conn, d):
        return True
    tz, dsh = db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour")
    low, high = timeutil.day_bounds_utc(d, tz, dsh)
    return conn.execute(
        "SELECT 1 FROM entries WHERE deleted = 0 AND category = 'Day job' AND note = ? "
        "AND start_utc >= ? AND start_utc < ?",
        (JOB_BLOCK_NOTE, timeutil.to_iso(low), timeutil.to_iso(high)),
    ).fetchone() is not None


def close_job_block(conn: sqlite3.Connection, d: date, choice: str) -> None:
    """Close the day-job block in one click.

    usual = job_start..job_end; left_early = job_end minus 2 h; stayed_late = job_end
    plus 2 h; leave = no entry at all, but the day is remembered as a leave day (the job
    window then counts as open time). Closing again replaces the earlier answer.
    """
    if choice not in JOB_CHOICES:
        raise ValueError(f"choice must be one of {JOB_CHOICES}")
    tz, dsh = db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour")
    day_lo, day_hi = timeutil.day_bounds_utc(d, tz, dsh)
    start = timeutil.at_local(d, db.get_setting(conn, "job_start"), tz, dsh)
    end = timeutil.at_local(d, db.get_setting(conn, "job_end"), tz, dsh)
    end += {"usual": timedelta(0), "left_early": timedelta(hours=-2), "stayed_late": timedelta(hours=2)}.get(
        choice, timedelta(0)
    )

    with _atomic(conn):
        conn.execute(
            "UPDATE entries SET deleted = 1 WHERE deleted = 0 AND category = 'Day job' AND note = ? "
            "AND start_utc >= ? AND start_utc < ?",
            (JOB_BLOCK_NOTE, timeutil.to_iso(day_lo), timeutil.to_iso(day_hi)),
        )
        if choice == "leave":
            conn.execute("INSERT OR IGNORE INTO job_leaves(local_date) VALUES (?)", (d.isoformat(),))
        else:
            conn.execute("DELETE FROM job_leaves WHERE local_date = ?", (d.isoformat(),))
        if choice != "leave" and end > start:
            add_entry(conn, start, end, "Day job", False, "live", note=JOB_BLOCK_NOTE)
