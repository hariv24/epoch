"""The scheduler: decides which check-in cards exist, when they are due, and sends them.

The pieces, from the bottom up:

* `ensure_slots` creates today's rows in the `slots` table. It is cheap and safe to call
  every minute, because the table has a UNIQUE(kind, local_date, ref_id) constraint.
* `due_slots` lists the pending slots whose time has come.
* `render` turns a slot into the card text, buttons and link.
* `ticker` is the async loop that runs once a minute: it sends cards through a macOS
  notification (always) and Telegram (if configured), closes forgotten focus sessions
  and makes the nightly backup.

All SQLite work is plain synchronous code. The async parts only hand it to
`asyncio.to_thread`, so a slow disk never blocks the web server.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from . import categories, db, economy, notify, pomodoro, rules, timeutil

log = logging.getLogger(__name__)

DEFAULT_PORT = 8765
TICK_SECONDS = 60
OVERDUE_EXPIRY = timedelta(hours=3)          # older than this => expired (unless it is the catch-up)
FOCUS_GRACE = timedelta(minutes=30)          # a focus session is auto-closed this long after its end
SILENCE_AFTER = timedelta(hours=48)
MAX_BLOCK_CARDS_PER_DAY = 2
MAX_CARD_CHARS = 3900                        # Telegram refuses messages over 4096 characters
BACKUP_TIME = time(3, 30)
BACKUP_KEEP = 14
SUNDAY_TIME = "18:00"
POSTCARD_TIME = "18:10"                       # the weekly postcard nudge, after the Sunday review
# Slots of an earlier day expire, except these, which may still be sent as a catch-up
# for this many hours (the weekly report goes out "the next time the laptop is awake").
CROSS_DAY_CATCH_UP = {"sunday": timedelta(hours=30)}
# Cards about planning tonight: they are not caught up once the study window has started.
PLANNING_KINDS = ("morning", "lapse")

# Lower number = more important. When the daily cap is full, higher numbers are dropped first.
PRIORITY = {"lapse": 0, "morning": 0, "block_end": 1, "evening_close": 2, "sunday": 3, "postcard": 4, "silence": 5}
ACTIVE_STATUSES = ("pending", "sent", "answered")
# Kinds that do not count toward msg_cap and are never pushed out by it ("Always" in the plan).
CAP_EXEMPT = ("sunday",)

# Buttons for the lapse card: (label, reason code used in "lp:<date>:<reason>").
LAPSE_REASONS = (
    ("Work ran late", "work_late"), ("Tired", "tired"), ("Phone/X", "phone"),
    ("Unclear next step", "unclear_step"), ("Task too big", "too_big"), ("Other", "other"),
)

Buttons = list[list[tuple[str, str]]]


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _tz(settings: dict[str, Any]) -> tuple[str, int]:
    return settings["timezone"], int(settings["day_start_hour"])


def _at(d: date, hhmm: str, settings: dict[str, Any]) -> datetime:
    tz, dsh = _tz(settings)
    return timeutil.at_local(d, hhmm, tz, dsh)


def _local_today(conn: sqlite3.Connection, now: datetime) -> date:
    return timeutil.local_date_of(now, db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour"))


def _hm(minutes: int) -> str:
    """90 -> '1h30', 40 -> '40m'."""
    hours, rest = divmod(int(minutes), 60)
    if hours == 0:
        return f"{rest}m"
    return f"{hours}h{rest:02d}" if rest else f"{hours}h"


def _local_hhmm(moment: datetime, settings: dict[str, Any]) -> str:
    return moment.astimezone(timeutil.zone(settings["timezone"])).strftime("%H:%M")


def _slot_rows(conn: sqlite3.Connection, d: date) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM slots WHERE local_date = ?", (d.isoformat(),)).fetchall()


def _set_status(conn: sqlite3.Connection, slot_id: int, status: str) -> None:
    conn.execute("UPDATE slots SET status = ? WHERE id = ?", (status, slot_id))


# --------------------------------------------------------------------------
# Quiet-spell detection (for the silence slot)
# --------------------------------------------------------------------------

def last_activity(conn: sqlite3.Connection) -> datetime | None:
    """The latest sign the user did something: an entry, output, mark, lapse answer or answered card."""
    queries = (
        "SELECT MAX(created_at) FROM entries WHERE deleted = 0 AND source != 'aw'",
        "SELECT MAX(created_at) FROM outputs WHERE deleted = 0",
        "SELECT MAX(created_at) FROM day_marks",
        "SELECT MAX(created_at) FROM lapses",
        "SELECT MAX(answered_utc) FROM slots",
        "SELECT MAX(start_utc) FROM focus_sessions",
    )
    stamps = [conn.execute(q).fetchone()[0] for q in queries]
    parsed = [timeutil.from_iso(s) for s in stamps if s]
    return max(parsed) if parsed else None


# --------------------------------------------------------------------------
# Creating slots
# --------------------------------------------------------------------------

def _morning_time_key(d: date) -> str:
    return "morning_time_weekday" if d.weekday() < 5 else "morning_time_weekend"


def _cleanup_stale_block_slots(conn: sqlite3.Connection, d: date) -> None:
    """Skip pending block cards whose plan block was deleted, marked done/skipped, or already fully logged."""
    for slot in conn.execute(
        "SELECT * FROM slots WHERE kind = 'block_end' AND local_date = ? AND status = 'pending'",
        (d.isoformat(),),
    ).fetchall():
        block = conn.execute("SELECT * FROM plan_blocks WHERE id = ?", (slot["ref_id"],)).fetchone()
        if block is None or block["status"] != "planned" or rules.block_done_minutes(conn, block) >= block["minutes"]:
            _set_status(conn, slot["id"], "skipped")


def _wanted_block_slots(
    conn: sqlite3.Connection, d: date, now: datetime, settings: dict[str, Any], existing: list[sqlite3.Row]
) -> list[tuple[str, int, datetime]]:
    """New block_end slots for plan blocks that do not have one yet (at most 2 a day in total)."""
    have = {r["ref_id"] for r in existing if r["kind"] == "block_end"}
    room = MAX_BLOCK_CARDS_PER_DAY - len(have)
    if room <= 0:
        return []
    candidates = []
    for block in conn.execute(
        "SELECT * FROM plan_blocks WHERE local_date = ? AND status = 'planned' AND cue_time IS NOT NULL",
        (d.isoformat(),),
    ):
        if block["id"] in have:
            continue
        try:
            due = _at(d, block["cue_time"], settings) + timedelta(minutes=block["minutes"])
        except (ValueError, TypeError):
            log.warning("plan block %s has an unreadable cue time; no check-in for it", block["id"])
            continue
        if now - due > OVERDUE_EXPIRY:
            continue  # planned after the fact; asking "what did it go to?" hours later is just noise
        candidates.append(("block_end", int(block["id"]), due))
    candidates.sort(key=lambda item: item[2])
    return candidates[:room]


def _wanted_morning_or_lapse(
    conn: sqlite3.Connection, d: date, settings: dict[str, Any], existing: list[sqlite3.Row]
) -> list[tuple[str, int, datetime]]:
    """Either the lapse card (after a missed day) or the plain morning card."""
    due = _at(d, settings[_morning_time_key(d)], settings)
    kinds = {r["kind"]: r for r in existing}
    morning_sent = "morning" in kinds and kinds["morning"]["status"] in ("sent", "answered")
    lapse = kinds.get("lapse")
    if lapse is None:
        if rules.pending_lapse(conn, today=d) is not None and not morning_sent:
            return [("lapse", 0, due)]
    elif not (lapse["status"] == "skipped" and "morning" not in kinds):
        return []  # a lapse card was made; only a dropped one (no longer needed) lets the morning card back
    if "morning" in kinds:
        return []
    is_rest_day = conn.execute(
        "SELECT 1 FROM day_marks WHERE local_date = ? AND kind = 'rest'", (d.isoformat(),)
    ).fetchone()
    return [] if is_rest_day else [("morning", 0, due)]


def _wanted_silence(
    conn: sqlite3.Connection, d: date, now: datetime, settings: dict[str, Any]
) -> list[tuple[str, int, datetime]]:
    """One silence card per quiet spell. The spell is identified by the time of the last activity."""
    if d != _local_today(conn, now):
        return []
    last = last_activity(conn)
    if last is None:
        tz, dsh = _tz(settings)
        last = timeutil.day_bounds_utc(db.start_date(conn), tz, dsh)[0]
    threshold = last + SILENCE_AFTER
    due = max(threshold, _at(d, settings[_morning_time_key(d)], settings))
    if now < due or now >= _at(d, settings["bedtime"], settings):
        return []  # not quiet long enough yet, or it is the sleeping part of the day
    spell = int(last.timestamp())
    if conn.execute("SELECT 1 FROM slots WHERE kind = 'silence' AND ref_id = ?", (spell,)).fetchone():
        return []
    return [("silence", spell, due)]


def _cleanup_postcard_slots(conn: sqlite3.Connection, d: date) -> None:
    """Skip a pending postcard nudge once the week's postcard exists."""
    if d.weekday() != 6:
        return
    for slot in conn.execute(
        "SELECT * FROM slots WHERE kind = 'postcard' AND local_date = ? AND status = 'pending'", (d.isoformat(),)
    ).fetchall():
        if conn.execute(
            "SELECT 1 FROM postcards WHERE kind = 'weekly' AND period = ?", (timeutil.week_monday(d).isoformat(),)
        ).fetchone():
            _set_status(conn, slot["id"], "skipped")


def _postcard_wanted(conn: sqlite3.Connection, d: date) -> bool:
    """A weekly-postcard nudge on a Sunday with some activity in the week and no weekly postcard made yet."""
    try:
        week = rules.week_summary(conn, d, today=d)
        if week.deep_minutes <= 0 and week.outputs_count <= 0 and week.floor_days <= 0:
            return False
        monday = timeutil.week_monday(d).isoformat()
        return conn.execute("SELECT 1 FROM postcards WHERE kind = 'weekly' AND period = ?", (monday,)).fetchone() is None
    except Exception:
        log.exception("could not decide on the postcard nudge")
        return False


def _wanted_slots(
    conn: sqlite3.Connection, d: date, now: datetime, settings: dict[str, Any], existing: list[sqlite3.Row]
) -> list[tuple[str, int, datetime]]:
    """Everything that should exist for `d` but does not yet, most important first."""
    wanted = _wanted_morning_or_lapse(conn, d, settings, existing)
    wanted += _wanted_block_slots(conn, d, now, settings, existing)
    wanted.append(("evening_close", 0, _at(d, settings["bedtime"], settings) - timedelta(minutes=30)))
    if d.weekday() == 6:
        wanted.append(("sunday", 0, _at(d, SUNDAY_TIME, settings)))
        if _postcard_wanted(conn, d):
            wanted.append(("postcard", 0, _at(d, POSTCARD_TIME, settings)))
    wanted += _wanted_silence(conn, d, now, settings)
    have = {(r["kind"], r["ref_id"]) for r in existing}
    wanted = [w for w in wanted if (w[0], w[1]) not in have]
    wanted.sort(key=lambda w: PRIORITY[w[0]])  # stable: keeps due-time order inside a kind
    return wanted


def _make_room(conn: sqlite3.Connection, d: date, kind: str) -> bool:
    """Drop one pending, less important slot of the day. Returns True if one was dropped.

    The Sunday review is never a victim: it is exempt from the daily cap.
    """
    victims = [
        r for r in _slot_rows(conn, d)
        if r["status"] == "pending" and r["kind"] not in CAP_EXEMPT and PRIORITY[r["kind"]] > PRIORITY[kind]
    ]
    if not victims:
        return False
    victim = max(victims, key=lambda r: (PRIORITY[r["kind"]], r["due_utc"]))
    _set_status(conn, victim["id"], "skipped")
    return True


def ensure_slots(conn: sqlite3.Connection, d: date, now: datetime | None = None) -> int:
    """Create any missing slots for local day `d`; returns how many were added.

    Safe to call every minute. Never lets the day exceed `msg_cap` proactive messages:
    when it is full, a more important new slot pushes out a pending less important one,
    and otherwise the new slot is simply not created (silence goes first). The Sunday
    review is exempt: it is always created and never counted.
    """
    now = now or timeutil.now_utc()
    settings = db.all_settings(conn)
    cap = int(settings["msg_cap"])
    added = 0
    with db.transaction(conn):
        _cleanup_stale_block_slots(conn, d)
        _cleanup_postcard_slots(conn, d)
        existing = _slot_rows(conn, d)
        # A lapse card replaces a morning card that has not been sent yet.
        wanted = _wanted_slots(conn, d, now, settings, existing)
        if any(w[0] == "lapse" for w in wanted):
            for r in existing:
                if r["kind"] == "morning" and r["status"] == "pending":
                    _set_status(conn, r["id"], "skipped")
        for kind, ref_id, due in wanted:
            active = sum(
                1 for r in _slot_rows(conn, d) if r["status"] in ACTIVE_STATUSES and r["kind"] not in CAP_EXEMPT
            )
            if kind not in CAP_EXEMPT and active >= cap and not _make_room(conn, d, kind):
                continue
            conn.execute(
                "INSERT OR IGNORE INTO slots(kind, local_date, ref_id, due_utc, status) "
                "VALUES (?, ?, ?, ?, 'pending')",
                (kind, d.isoformat(), ref_id, timeutil.to_iso(due)),
            )
            added += 1
    return added


def due_slots(conn: sqlite3.Connection, now: datetime | None = None) -> list[sqlite3.Row]:
    """Pending slots whose time has come, oldest first."""
    now = now or timeutil.now_utc()
    return conn.execute(
        "SELECT * FROM slots WHERE status = 'pending' AND due_utc <= ? ORDER BY due_utc, id",
        (timeutil.to_iso(now),),
    ).fetchall()


# --------------------------------------------------------------------------
# Expiry, focus sessions
# --------------------------------------------------------------------------

def expire_overdue(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Expire pending slots that are more than 3 hours overdue, keeping one catch-up per kind.

    The latest due slot of each kind may still be sent as a single catch-up, but only if it
    belongs to today (or is a Sunday report, which is allowed a day or so more). Returns
    the number of slots expired.
    """
    now = now or timeutil.now_utc()
    today = _local_today(conn, now)
    expired = 0
    by_kind: dict[str, list[sqlite3.Row]] = {}
    for slot in due_slots(conn, now):
        by_kind.setdefault(slot["kind"], []).append(slot)
    for kind, slots in by_kind.items():
        latest = slots[-1]
        for slot in slots:
            overdue = now - timeutil.from_iso(slot["due_utc"])
            if overdue <= OVERDUE_EXPIRY:
                continue
            if slot is latest and _may_catch_up(conn, kind, slot, today, overdue, now):
                continue
            _set_status(conn, slot["id"], "expired")
            expired += 1
    return expired


def _planning_window_over(conn: sqlite3.Connection, slot: sqlite3.Row, now: datetime) -> bool:
    """True once the study window of the slot's day has started (too late to 'pick tonight's blocks')."""
    d = date.fromisoformat(slot["local_date"])
    key = "study_start_weekday" if rules.is_job_day(conn, d) else "study_start_weekend"
    return now >= _at(d, db.get_setting(conn, key), db.all_settings(conn))


def _may_catch_up(
    conn: sqlite3.Connection, kind: str, slot: sqlite3.Row, today: date, overdue: timedelta, now: datetime
) -> bool:
    if slot["local_date"] == today.isoformat():
        # A morning or lapse card is about planning the evening: useless once the evening has begun.
        return not (kind in PLANNING_KINDS and _planning_window_over(conn, slot, now))
    return kind in CROSS_DAY_CATCH_UP and overdue <= CROSS_DAY_CATCH_UP[kind]


def focus_is_active(conn: sqlite3.Connection, now: datetime | None = None) -> bool:
    """True while a focus session or a Pomodoro run is going (started, not yet ended)."""
    now = now or timeutil.now_utc()
    row = conn.execute(
        "SELECT 1 FROM focus_sessions WHERE end_utc IS NULL AND start_utc <= ? LIMIT 1",
        (timeutil.to_iso(now),),
    ).fetchone()
    return row is not None or pomodoro.is_active(conn)


def auto_close_focus(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Close focus sessions that were never ended, 30 minutes after their planned end.

    Nothing is logged for them: nobody confirmed the time was really spent, and a
    forgotten session must not invent hours (or satisfy the floor). They are closed as
    'cancelled' at their planned end, and the stretch shows up in the evening close,
    where the user can label it. Returns the number of sessions closed.
    """
    now = now or timeutil.now_utc()
    closed = 0
    for session in conn.execute("SELECT * FROM focus_sessions WHERE end_utc IS NULL").fetchall():
        start = timeutil.from_iso(session["start_utc"])
        planned_end = start + timedelta(minutes=session["planned_minutes"])
        if now < planned_end + FOCUS_GRACE:
            continue
        conn.execute(
            "UPDATE focus_sessions SET end_utc = ?, outcome = 'cancelled' WHERE id = ?",
            (timeutil.to_iso(planned_end), session["id"]),
        )
        closed += 1
    return closed


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def _url(port: int, page: str) -> str:
    return f"http://127.0.0.1:{port}/{page}"


def _week_number(conn: sqlite3.Connection, d: date) -> int:
    first_monday = timeutil.week_monday(db.start_date(conn))
    return (timeutil.week_monday(d) - first_monday).days // 7 + 1


def _progress_line(week: rules.WeekSummary) -> str:
    """'Outputs 1 of 2 · floor days 3 of 5', or just the counts during the baseline week."""
    if week.outputs_required is None:
        return f"Outputs {week.outputs_count} · floor days {week.floor_days}"
    return (
        f"Outputs {week.outputs_count} of {week.outputs_required} · "
        f"floor days {week.floor_days} of {week.floor_days_required}"
    )


def sunday_text(conn: sqlite3.Connection, d: date) -> str:
    """The short weekly report shown on the Sunday card (and usable as the referee text)."""
    week = rules.week_summary(conn, d, today=d)
    verdict = {
        "kept": "kept", "not_kept": "not this week", "in_progress": "in progress", "baseline": "baseline week",
    }[week.status]
    lines = [f"Week {_week_number(conn, d)} · {verdict}"]
    if week.outputs_count == 0 and week.deep_minutes == 0 and week.floor_days == 0:
        lines.append("No data this week. A fresh week starts tomorrow.")
        return "\n".join(lines)
    skips = f" ({week.skips_used} skip{'s' if week.skips_used != 1 else ''})" if week.skips_used else ""
    lines.append(f"{_progress_line(week)}{skips} · deep {_hm(week.deep_minutes)}")
    if week.outputs:
        lines.append("Shipped: " + "; ".join(str(o["what"]) for o in week.outputs[:3]))
    if week.top_lapse_reasons:
        reason, count = week.top_lapse_reasons[0]
        lines.append(f"Most common snag: {reason.replace('_', ' ')} (x{count})")
    try:
        money = economy.week_line(conn, d)
    except Exception:
        log.exception("money line failed")
        money = None
    if money:
        lines.append(money)
    return "\n".join(lines)


def _render_morning(conn: sqlite3.Connection, slot: sqlite3.Row, port: int):
    d = date.fromisoformat(slot["local_date"])
    week = rules.week_summary(conn, d, today=d)
    body = f"Pick tonight's blocks, or just the floor. {_progress_line(week)}."
    return "Good morning", body, [], _url(port, "plan")


def _render_lapse(slot: sqlite3.Row, port: int):
    missed = date.fromisoformat(slot["local_date"]) - timedelta(days=1)
    body = "Yesterday didn't hit the floor. One day is one day. What got in the way?"
    labels = [(label, f"lp:{missed.isoformat()}:{reason}") for label, reason in LAPSE_REASONS]
    buttons = [labels[i:i + 2] for i in range(0, len(labels), 2)]
    return "A fresh start", body, buttons, _url(port, "lapse")


def _block_end_buttons(slot_id: int, planned: str | None) -> Buttons:
    ladder = [
        (f"{name} ✓" if name == planned else name, f"ci:{slot_id}:{categories.CODES[name]}")
        for name in categories.LADDER
    ]
    row_ladder = [ladder[i:i + 3] for i in range(0, len(ladder), 3)]
    other = [
        ("Tracker build", f"ci:{slot_id}:{categories.CODES['Tracker build']}"),
        ("Rest", f"ci:{slot_id}:{categories.CODES['Rest']}"),
        ("Distracted", f"ci:{slot_id}:{categories.CODES['Distracted']}"),
    ]
    buttons = row_ladder + [other]
    if planned in categories.CODES:
        buttons.append([("Same as planned", f"ci:{slot_id}:{categories.CODES[planned]}")])
    return buttons


def _render_block_end(conn: sqlite3.Connection, slot: sqlite3.Row, port: int):
    block = conn.execute("SELECT * FROM plan_blocks WHERE id = ?", (slot["ref_id"],)).fetchone()
    if block is None:
        return "Block check-in", "What did that block go to?", _block_end_buttons(slot["id"], None), _url(port, "")
    settings = db.all_settings(conn)
    d = date.fromisoformat(block["local_date"])
    start = _at(d, block["cue_time"], settings)
    end = start + timedelta(minutes=block["minutes"])
    task = f" {block['task']}" if block["task"] else ""
    head = f"{_local_hhmm(start, settings)}–{_local_hhmm(end, settings)} · planned: {block['category']}{task}"
    body = f"{head}\nWhat did it go to?"
    title = f"{block['category']} block is up"
    return title, body, _block_end_buttons(slot["id"], block["category"]), _url(port, "")


def _job_block_buttons(conn: sqlite3.Connection, slot: sqlite3.Row) -> Buttons:
    """'Day job as usual?' buttons (jc:<date>:<u|e|l|v>) on job days whose job block is still open."""
    d = date.fromisoformat(slot["local_date"])
    if not rules.is_job_day(conn, d) or rules.job_block_closed(conn, d):
        return []
    day = d.isoformat()
    return [
        [("Day job as usual", f"jc:{day}:u"), ("Left early", f"jc:{day}:e")],
        [("Stayed late", f"jc:{day}:l"), ("Day off", f"jc:{day}:v")],
    ]


def render(
    conn: sqlite3.Connection, slot: sqlite3.Row, port: int = DEFAULT_PORT
) -> tuple[str, str, Buttons, str]:
    """Card content for a slot: (title, body, buttons, url). Calm wording, always a link to the web app."""
    kind = slot["kind"]
    if kind == "morning":
        return _render_morning(conn, slot, port)
    if kind == "lapse":
        return _render_lapse(slot, port)
    if kind == "block_end":
        return _render_block_end(conn, slot, port)
    if kind == "evening_close":
        body = "Close the day: label today's hours in a couple of minutes. Anything left open can wait until tomorrow."
        return "Time to close the day", body, _job_block_buttons(conn, slot), _url(port, "close")
    if kind == "sunday":
        d = date.fromisoformat(slot["local_date"])
        return "Weekly review", sunday_text(conn, d), [], _url(port, "week")
    if kind == "postcard":
        d = date.fromisoformat(slot["local_date"])
        week = rules.week_summary(conn, d, today=d)
        body = f"Your week's postcard is ready to make. {_progress_line(week)} · deep {_hm(week.deep_minutes)}."
        return "Your week's postcard", body, [], _url(port, "postcards")
    if kind == "silence":
        body = "Haven't heard from you in 2 days. No catch-up needed. A short log whenever you're ready is plenty."
        return "Checking in", body, [], _url(port, "")
    raise ValueError(f"unknown slot kind: {kind!r}")


# --------------------------------------------------------------------------
# One tick
# --------------------------------------------------------------------------

@dataclass
class DueCard:
    """A slot that is ready to send, with its rendered content."""

    slot: sqlite3.Row
    title: str
    body: str
    buttons: Buttons
    url: str

    @property
    def text(self) -> str:
        """Plain-text version for Telegram: title, body and the link."""
        room = max(0, MAX_CARD_CHARS - len(self.title) - len(self.url) - 2)
        body = self.body if len(self.body) <= room else self.body[: max(0, room - 1)] + "…"
        return f"{self.title}\n{body}\n{self.url}"


def _silence_is_stale(conn: sqlite3.Connection, slot: sqlite3.Row) -> bool:
    """A silence card is pointless if the user did something after the quiet spell began."""
    last = last_activity(conn)
    return last is not None and int(last.timestamp()) > slot["ref_id"]


def _guarded(stage: str, step, *args) -> None:
    """Run one stage of a tick; a failure is logged and never stops the stages after it."""
    try:
        step(*args)
    except Exception:
        log.exception("scheduler stage %r failed", stage)


def drop_resolved_lapse_slots(conn: sqlite3.Connection) -> int:
    """Skip pending lapse cards whose missed day no longer needs the question.

    That happens when the day was answered on the web or labelled afterwards and now
    reaches the floor. The morning card the lapse card had replaced is brought back.
    Returns how many were dropped.
    """
    dropped = 0
    for slot in conn.execute("SELECT * FROM slots WHERE kind = 'lapse' AND status = 'pending'").fetchall():
        d = date.fromisoformat(slot["local_date"])
        if rules.pending_lapse(conn, today=d) is None:
            _set_status(conn, slot["id"], "skipped")
            conn.execute(
                "UPDATE slots SET status = 'pending' WHERE kind = 'morning' AND local_date = ? AND status = 'skipped'",
                (d.isoformat(),),
            )
            dropped += 1
    return dropped


def _card_for(conn: sqlite3.Connection, slot: sqlite3.Row, port: int, focus_running: bool) -> DueCard | None:
    """The card to send for a due slot, or None if it should wait or be dropped."""
    if slot["kind"] == "block_end" and focus_running:
        return None  # stays pending: it is sent once the focus session ends (or expires after 3 h)
    if slot["kind"] == "silence" and _silence_is_stale(conn, slot):
        _set_status(conn, slot["id"], "skipped")
        return None
    title, body, buttons, url = render(conn, slot, port)
    return DueCard(slot, title, body, buttons, url)


def collect_due_cards(db_path: Path | str, port: int = DEFAULT_PORT, now: datetime | None = None) -> list[DueCard]:
    """Do all the database work of one tick and return the cards that should be sent now.

    Every step is isolated: one bad row (or one failing stage) cannot stop the other cards.
    """
    now = now or timeutil.now_utc()
    cards: list[DueCard] = []
    with db.get_conn(db_path) as conn:
        _guarded("pomodoro housekeeping", pomodoro.housekeeping, conn, now)
        _guarded("auto-close focus", auto_close_focus, conn, now)
        _guarded("drop resolved lapse cards", drop_resolved_lapse_slots, conn)
        _guarded("ensure slots", ensure_slots, conn, _local_today(conn, now), now)
        _guarded("expire overdue", expire_overdue, conn, now)
        focus_running = focus_is_active(conn, now)
        for slot in due_slots(conn, now):
            try:
                card = _card_for(conn, slot, port, focus_running)
            except Exception:
                # Skipped for good, so a slot that cannot be rendered does not fail again every minute.
                log.exception("could not build the %s card (slot %s); skipping it", slot["kind"], slot["id"])
                _set_status(conn, slot["id"], "skipped")
                continue
            if card is not None:
                cards.append(card)
    return cards


def mark_sent(db_path: Path | str, slot_id: int, message_id: int | None, now: datetime | None = None) -> None:
    now = now or timeutil.now_utc()
    with db.get_conn(db_path) as conn:
        conn.execute(
            "UPDATE slots SET status = 'sent', sent_utc = ?, telegram_message_id = ? WHERE id = ?",
            (timeutil.to_iso(now), message_id, slot_id),
        )


def record_message_id(db_path: Path | str, slot_id: int, message_id: int) -> None:
    """Remember which Telegram message a card became (best effort, after it was sent)."""
    with db.get_conn(db_path) as conn:
        conn.execute("UPDATE slots SET telegram_message_id = ? WHERE id = ?", (message_id, slot_id))


async def _deliver(state, card: DueCard) -> int | None:
    """Send one card by notification and (if enabled) Telegram. Returns the Telegram message id."""
    try:
        await asyncio.to_thread(notify.notify, card.title, card.body, card.url)
    except Exception:
        log.exception("desktop notification failed")
    if getattr(state, "telegram_app", None) is None:
        return None
    try:
        from . import telegram_bot  # imported here so the scheduler works without Telegram

        return await telegram_bot.send_card(state, card.slot, card.text, card.buttons)
    except Exception:
        log.exception("telegram send failed")
        return None


async def tick(state, now: datetime | None = None) -> int:
    """Run one pass: prepare, send what is due, mark it sent, and back up if it is time. Returns cards sent."""
    now = now or timeutil.now_utc()
    cards = await asyncio.to_thread(collect_due_cards, state.db_path, state.config.port, now)
    sent = 0
    for card in cards:
        # Marked sent BEFORE delivering: a card is never sent twice, even if the database
        # hiccups afterwards. Failed or ignored cards are never re-sent either.
        try:
            await asyncio.to_thread(mark_sent, state.db_path, card.slot["id"], None, now)
        except Exception:
            log.exception("could not mark slot %s as sent; leaving it for the next tick", card.slot["id"])
            continue
        message_id = await _deliver(state, card)
        sent += 1
        if message_id is not None:
            try:
                await asyncio.to_thread(record_message_id, state.db_path, card.slot["id"], message_id)
            except Exception:
                log.warning("could not store the Telegram message id for slot %s", card.slot["id"], exc_info=True)
    await asyncio.to_thread(maybe_backup, state.db_path, state.config.backup_dir, now)
    return sent


async def ticker(state, interval: float = TICK_SECONDS) -> None:
    """Run `tick` forever, once per `interval` seconds. A failing tick is logged, never fatal."""
    while True:
        try:
            await tick(state)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("scheduler tick failed")
        await asyncio.sleep(interval)


# --------------------------------------------------------------------------
# Backup
# --------------------------------------------------------------------------

_BACKUP_NAME = re.compile(r"^witness-\d{4}-\d{2}-\d{2}\.db$")


def prune_backups(backup_dir: Path, keep: int = BACKUP_KEEP) -> list[Path]:
    """Delete all but the newest `keep` dated backups. Returns the deleted files."""
    files = sorted(p for p in Path(backup_dir).iterdir() if _BACKUP_NAME.match(p.name))
    old = files[:-keep] if keep > 0 else files
    for path in old:
        path.unlink(missing_ok=True)
    return old


def backup_now(
    db_path: Path | str, backup_dir: Path | str, on: date | None = None, keep: int = BACKUP_KEEP
) -> Path:
    """Copy the database to `<backup_dir>/witness-YYYY-MM-DD.db` using SQLite's backup API.

    The backup API gives a consistent copy even while the app is writing. The copy is
    written to a temporary name first, so a crash never leaves a half-written backup.
    """
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"witness-{(on or date.today()).isoformat()}.db"
    temp = target.with_name(target.name + ".tmp")
    source = sqlite3.connect(str(db_path))
    copy = sqlite3.connect(str(temp))
    try:
        source.backup(copy)
    finally:
        copy.close()
        source.close()
    os.replace(temp, target)
    prune_backups(backup_dir, keep)
    return target


def maybe_backup(db_path: Path | str, backup_dir: Path | str | None, now: datetime | None = None) -> Path | None:
    """Make today's backup the first time a tick runs after 03:30 local. No-op without a backup dir."""
    if not backup_dir:
        return None
    now = now or timeutil.now_utc()
    try:
        with db.get_conn(db_path) as conn:
            tz = db.get_setting(conn, "timezone")
        local = now.astimezone(timeutil.zone(tz))
        if local.time() < BACKUP_TIME:
            return None
        if (Path(backup_dir) / f"witness-{local.date().isoformat()}.db").exists():
            return None
        return backup_now(db_path, backup_dir, local.date())
    except Exception:
        log.exception("backup failed")
        return None
