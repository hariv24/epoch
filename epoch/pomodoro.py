"""The server-side Pomodoro, shared by every screen (laptop and tablet).

A *run* is `work, break, work, break, ..., work` (no break after the last work block). Its state is
derived from stored timestamps, never from a ticking process, so any client computes the same
countdown:

    phase_idx             which phase of the run we are in (0 = work 1, 1 = break 1, ...)
    phase_elapsed_s       seconds of that phase already used before `resumed_utc`
    resumed_utc           when the clock last started running (NULL while paused)

    elapsed = phase_elapsed_s + (now - resumed_utc)        remaining = phase_seconds - elapsed

`settle()` moves the stored checkpoint forward when phases have ended in the meantime; it is
idempotent and every entry point calls it first, so the result does not depend on who asks or when.

A finished work block becomes a `pomodoro_blocks` row waiting for a rating, and the run HOLDS in the
`waiting` status ("block done"): the break does not start until the person is done with that block, that is
until they rate it, drop it, press "Start break" (also "rate it later"), or press "Keep going +5/+10/+15".
So a break can never be eaten while the end-of-block card is open, and a person who walked away finds
the break still whole. Rating creates the time entry and runs the game step (`snapshot -> write ->
finish_write`). A break that ends starts the next work block by itself.

"+5 min" adds to the CURRENT phase (`extra_s`): during work, during a break, or from the end-of-block hold
(the unrated block is folded back into the longer block, so the extra minutes count in one entry).

While a run is `running`, the Mac is kept awake with `caffeinate -i` (macOS only, no-op elsewhere).
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import subprocess
import sys
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Callable, Iterator

from . import categories, db, game, live, rules, timeutil

log = logging.getLogger(__name__)

PRESETS: list[dict[str, Any]] = [
    {"id": "50-10-3", "work_min": 50, "break_min": 10, "cycles": 3, "default": True},
    {"id": "25-5-4", "work_min": 25, "break_min": 5, "cycles": 4, "default": False},
    {"id": "90-15-2", "work_min": 90, "break_min": 15, "cycles": 2, "default": False},
]
DEFAULT_PRESET = "50-10-3"
PRESET_BY_ID = {p["id"]: p for p in PRESETS}
CUSTOM_LIMITS = {"work_min": (1, 240), "break_min": (0, 60), "cycles": (1, 8)}
CUSTOM_FIELDS = (("work_min", "Work minutes"), ("break_min", "Break minutes"), ("cycles", "Blocks"))
DEFAULT_CUSTOM = {"work_min": 50, "break_min": 10, "cycles": 3}     # what the Custom card starts with, until the person's own numbers are remembered
EXTEND_CHOICES = (5, 10, 15)                           # the "+N min" buttons
MAX_PHASE_MINUTES = {"work": 480, "break": 120}        # a phase (with its additions) can not grow past this
FOCUS_VALUES = ("full", "mostly", "pulled_away")
# Categories whose time can be "deep" (same rule as the old focus timer).
DEEP_CATEGORIES = frozenset(categories.LADDER) | {"Tracker build"}

MIN_PARTIAL_SECONDS = 60           # stopping mid-block keeps the work only if at least a minute was done
RECENT_RUN_WINDOW = timedelta(hours=2)   # a finished run stays visible (for its summary) this long
MAX_PAUSE = timedelta(hours=2)     # a run paused longer than this is stopped by the housekeeping
MAX_WAIT = timedelta(hours=3)      # a finished block nobody answered for this long: the run is closed (the block stays to rate)
UNRATED_EXPIRY = timedelta(hours=12)     # an unrated block older than this is logged on its own, as plain (not deep) time
SLEEP_GAP_SECONDS = 180            # the server saw no clock tick for this long mid-run: the Mac was asleep, so the run is paused


_alive: dict[str, Any] = {"at": None, "away_run": None}
_alive_lock = threading.Lock()


def _beat() -> float:
    """Note that the clock is being looked at now. Returns how long ago the previous look was (0 if recent or never)."""
    wall = time.time()
    with _alive_lock:
        last, _alive["at"] = _alive["at"], wall
    gap = wall - last if last is not None else 0.0
    return gap if gap > SLEEP_GAP_SECONDS else 0.0


class PomodoroError(Exception):
    """A correctable problem: `code` is machine-readable, `hint` is a calm sentence for the person."""

    def __init__(self, code: str, hint: str) -> None:
        super().__init__(hint)
        self.code, self.hint = code, hint


@contextmanager
def _atomic(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    if conn.in_transaction:
        yield conn
    else:
        with db.transaction(conn):
            yield conn


def _secs(delta: timedelta) -> int:
    return max(0, int(delta.total_seconds()))


# --------------------------------------------------------------------------
# Keep the Mac awake
# --------------------------------------------------------------------------

class KeepAwake:
    """`caffeinate -i -w <our pid>`: no idle sleep while a run is running; it also ends if we die."""

    def __init__(self, popen: Callable[..., Any] | None = None, platform: str | None = None) -> None:
        self._popen = popen or (lambda args: subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        self.platform = platform
        self.enabled = True
        self.proc: Any = None
        self._lock = threading.Lock()     # hold() and release() are called from several threads (streams, ticker, requests)

    @property
    def held(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def hold(self) -> bool:
        if not self.enabled or (self.platform or sys.platform) != "darwin":
            return False
        with self._lock:
            if self.held:
                return True
            try:
                self.proc = self._popen(["caffeinate", "-i", "-w", str(os.getpid())])
            except Exception:  # no caffeinate on this machine; the timer works without it
                log.warning("could not start caffeinate", exc_info=True)
                self.proc = None
                return False
            return True

    def release(self) -> None:
        with self._lock:
            proc, self.proc = self.proc, None
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.terminate()
            if hasattr(proc, "wait"):
                try:
                    proc.wait(timeout=1)          # reap the child so it does not linger as a zombie
                except Exception:
                    pass
        except Exception:
            log.debug("could not stop caffeinate", exc_info=True)


keepawake = KeepAwake()


def sync_keepawake(conn: sqlite3.Connection) -> bool:
    """Hold the wake lock exactly while a run is running."""
    row = active_run(conn)
    if row is not None and row["status"] == "running":
        return keepawake.hold()
    keepawake.release()
    return False


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def phase_list(work_s: int, break_s: int, cycles: int) -> list[tuple[str, int, int]]:
    """[(kind, seconds, cycle)] for a run: work 1, break 1, work 2, ..., work N."""
    phases: list[tuple[str, int, int]] = []
    for cycle in range(1, cycles + 1):
        phases.append(("work", work_s, cycle))
        if cycle < cycles and break_s > 0:
            phases.append(("break", break_s, cycle))
    return phases


def _phases(row: sqlite3.Row) -> list[tuple[str, int, int]]:
    return phase_list(row["work_s"], row["break_s"], row["cycles"])


def _phase_len(row: sqlite3.Row, phases: list[tuple[str, int, int]] | None = None) -> int:
    """Seconds of the CURRENT phase, with whatever the person added to it."""
    phases = phases or _phases(row)
    return phases[min(row["phase_idx"], len(phases) - 1)][1] + row["extra_s"]


_SCHEMA_OK: set[str] = set()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Add `extra_s` (and `spot`) to a database made before they existed (new databases get them from schema.sql)."""
    try:
        path = conn.execute("PRAGMA database_list").fetchone()["file"] or ""
        if path and path in _SCHEMA_OK:
            return
        if not any(r["name"] == "extra_s" for r in conn.execute("PRAGMA table_info(pomodoro_runs)")):
            try:
                conn.execute("ALTER TABLE pomodoro_runs ADD COLUMN extra_s INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:     # another screen added it a moment ago
                pass
        db.ensure_columns(conn)                  # `spot` (the study spot of a run) and any later additive column
        if path:
            _SCHEMA_OK.add(path)
    except sqlite3.Error:
        log.debug("could not check the pomodoro schema", exc_info=True)


def active_run(conn: sqlite3.Connection) -> sqlite3.Row | None:
    _ensure_schema(conn)
    return conn.execute(
        "SELECT * FROM pomodoro_runs WHERE status IN ('running', 'paused', 'waiting') ORDER BY id DESC LIMIT 1"
    ).fetchone()


def is_active(conn: sqlite3.Connection) -> bool:
    """True while a run is running, paused or holding for the person after a block (the scheduler holds its check-in cards back)."""
    return active_run(conn) is not None


def _elapsed(row: sqlite3.Row, now: datetime) -> int:
    running = row["resumed_utc"]
    extra = _secs(now - timeutil.from_iso(running)) if (row["status"] == "running" and running) else 0
    return row["phase_elapsed_s"] + extra


def _row_spot(row: sqlite3.Row) -> str | None:
    """The study spot id a run was started at (None for a run from before study spots existed)."""
    try:
        return row["spot"] or None
    except (IndexError, KeyError):
        return None


def _run_view(row: sqlite3.Row, now: datetime) -> dict[str, Any]:
    phases = _phases(row)
    over = row["status"] in ("finished", "stopped")
    waiting = row["status"] == "waiting"
    idx = min(row["phase_idx"], len(phases) - 1)
    kind, base_seconds, cycle = phases[idx]
    seconds = base_seconds + row["extra_s"]
    elapsed = seconds if (row["status"] == "finished" or waiting) else (0 if over else _elapsed(row, now))
    if row["status"] == "stopped":
        elapsed = row["phase_elapsed_s"]
    remaining = max(0, seconds - elapsed)
    paused = row["status"] == "paused"
    ends_at = None
    if row["status"] == "running":
        ends_at = timeutil.to_iso(now + timedelta(seconds=remaining))
    nxt = phases[idx + 1] if idx + 1 < len(phases) else None
    return {
        "id": row["id"], "preset": row["preset"], "work_min": row["work_s"] // 60, "break_min": row["break_s"] // 60,
        "cycles": row["cycles"], "category": row["category"], "label": row["label"] or "", "status": row["status"],
        "phase": "done" if over else ("waiting" if waiting else kind), "cycle": cycle, "phase_index": idx, "phase_count": len(phases),
        "phase_seconds": seconds, "elapsed_seconds": elapsed, "remaining_seconds": 0 if (over or waiting) else remaining,
        "base_seconds": base_seconds, "extra_seconds": row["extra_s"], "last": idx == len(phases) - 1,
        "paused": paused, "phase_ends_at": ends_at, "started_utc": row["started_utc"],
        "away": bool(paused and _alive["away_run"] == row["id"]),
        "spot": _row_spot(row),
        "next": {"phase": nxt[0], "seconds": nxt[1]} if (nxt and not over) else None,
        "waiting": None,
    }


def pending_ratings(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT b.*, r.label AS run_label, r.category AS run_category FROM pomodoro_blocks b "
        "JOIN pomodoro_runs r ON r.id = b.run_id WHERE b.status = 'unrated' ORDER BY b.id"
    ).fetchall()
    return [{
        "block_id": r["id"], "run_id": r["run_id"], "cycle": r["cycle"], "category": r["category"] or r["run_category"],
        "label": r["run_label"] or "", "minutes": max(1, timeutil.minutes_between(timeutil.from_iso(r["started_utc"]), timeutil.from_iso(r["ended_utc"]))), "partial": bool(r["partial"]),
        "ended_utc": r["ended_utc"],
    } for r in rows]


def get_state(conn: sqlite3.Connection, now: datetime | None = None, settle_first: bool = True) -> dict[str, Any]:
    """The whole Pomodoro state (GET /api/pomodoro, and the stream's `pomodoro` event)."""
    live_ms = int(time.time() * 1000) if now is None else None      # exact to the millisecond on a live read
    now = now or timeutil.now_utc()
    if settle_first:
        settle(conn, now)
    row = active_run(conn)
    if row is None:
        recent = conn.execute("SELECT * FROM pomodoro_runs ORDER BY id DESC LIMIT 1").fetchone()
        if recent is not None and recent["ended_utc"] and now - timeutil.from_iso(recent["ended_utc"]) <= RECENT_RUN_WINDOW:
            row = recent
    run = _run_view(row, now) if row is not None else None
    if run is not None:
        run["blocks_kept"] = conn.execute(
            "SELECT COUNT(*) FROM pomodoro_blocks WHERE run_id = ? AND status IN ('unrated', 'rating', 'rated')", (run["id"],)
        ).fetchone()[0]
        if row["status"] == "waiting":
            block = _waiting_block(conn, row)
            run["waiting"] = {
                "block_id": block["id"] if block else None, "since": block["ended_utc"] if block else None,
                "unrated": bool(block and block["status"] == "unrated"),
                "minutes": max(1, block["worked_s"] // 60) if block else 0,
            }
    pending = pending_ratings(conn)
    keep = sync_keepawake(conn) if settle_first else keepawake.held
    from . import economy                                  # late import: economy builds on game, which this module also uses
    chosen = (run or {}).get("spot") or economy.selected_spot(conn)
    state = {
        "ok": True, "server_now": timeutil.to_iso(now), "spot": economy.spot_stub(chosen),
        "selected_spot": economy.selected_spot(conn), "server_epoch_ms": live_ms if live_ms is not None else int(now.timestamp() * 1000),
        "active": bool(run and run["status"] in ("running", "paused", "waiting")), "run": run,
        "awaiting_rating": bool(pending), "pending_ratings": pending,
        "presets": PRESETS, "default_preset": db.get_setting(conn, "pomodoro_preset") or DEFAULT_PRESET,
        "custom": custom_defaults(conn), "limits": {k: list(v) for k, v in CUSTOM_LIMITS.items()},
        "extend_choices": list(EXTEND_CHOICES),
        "keep_awake": keep, "legacy_focus": legacy_focus_open(conn),
    }
    state["rev"] = _rev(state)
    return state


def _rev(state: dict[str, Any]) -> int:
    """A number that changes when the shape of the state changes (not every second)."""
    run = state["run"]
    key = [run and (run["id"], run["status"], run["phase_index"], run["paused"], run["extra_seconds"]),
           [p["block_id"] for p in state["pending_ratings"]]]
    return zlib.crc32(json.dumps(key).encode())


def next_change_in(state: dict[str, Any]) -> float | None:
    """Seconds until the running phase ends (so the stream can wake up then), or None."""
    run = state.get("run")
    if run and run["status"] == "running":
        return float(run["remaining_seconds"])
    return None


# --------------------------------------------------------------------------
# Moving the clock forward
# --------------------------------------------------------------------------

def _add_block(conn: sqlite3.Connection, run: sqlite3.Row, cycle: int, ended: datetime, worked_s: int, partial: bool) -> None:
    started = ended - timedelta(seconds=worked_s)
    conn.execute(
        "INSERT INTO pomodoro_blocks(run_id, cycle, started_utc, ended_utc, worked_s, partial, status, category) "
        "VALUES (?, ?, ?, ?, ?, ?, 'unrated', ?)",
        (run["id"], cycle, timeutil.to_iso(started), timeutil.to_iso(ended), worked_s, 1 if partial else 0, run["category"]),
    )


def settle(conn: sqlite3.Connection, now: datetime | None = None) -> bool:
    """Apply every phase boundary that has passed. Returns True if anything changed. Idempotent.

    A finished break starts the next work block by itself. A finished WORK block does not start anything:
    it becomes a block to rate and the run holds (`waiting`) until the person moves on (see `start_next`).
    """
    now = now or timeutil.now_utc()
    slept = _beat()
    row = active_run(conn)
    if row is None or row["status"] != "running":
        return False
    if slept and _pause_after_sleep(conn, row, now, slept):
        return True
    phases = _phases(row)
    if _elapsed(row, now) < _phase_len(row, phases):
        return False
    changed = False
    with _atomic(conn):
        row = active_run(conn)
        if row is None or row["status"] != "running":
            return False
        idx, phase_start, extra = row["phase_idx"], row["phase_start_utc"], row["extra_s"]
        elapsed_before, resumed = row["phase_elapsed_s"], timeutil.from_iso(row["resumed_utc"])
        status = "running"
        while True:
            kind, base, cycle = phases[idx]
            seconds = base + extra
            if elapsed_before + _secs(now - resumed) < seconds:
                break
            t_end = resumed + timedelta(seconds=seconds - elapsed_before)
            changed = True
            if kind == "work":
                _add_block(conn, row, cycle, t_end, seconds, partial=False)
                status, elapsed_before, resumed = "waiting", seconds, None      # hold here: the person decides what comes next
                break
            idx += 1                                                           # a break is over: the next work block starts now
            phase_start, elapsed_before, resumed, extra = timeutil.to_iso(t_end), 0, t_end, 0
        if changed:
            conn.execute(
                "UPDATE pomodoro_runs SET status = ?, phase_idx = ?, phase_start_utc = ?, phase_elapsed_s = ?, extra_s = ?, "
                "resumed_utc = ? WHERE id = ?",
                (status, idx, phase_start, elapsed_before, extra, timeutil.to_iso(resumed) if resumed else None, row["id"]),
            )
    if changed:
        sync_keepawake(conn)
    return changed


def _pause_after_sleep(conn: sqlite3.Connection, row: sqlite3.Row, now: datetime, slept: float) -> bool:
    """The Mac was asleep (nobody looked at the clock for `slept` seconds): stop the clock where it was last seen.

    Wall time passes while the lid is closed, but nobody worked. The run is paused at the last moment we saw it
    running, so waking up shows a paused run to resume, not a pile of blocks nobody did.
    """
    last_seen = now - timedelta(seconds=slept)
    resumed = timeutil.from_iso(row["resumed_utc"])
    if resumed >= last_seen:            # it only started running after the gap began
        return False
    elapsed = row["phase_elapsed_s"] + _secs(last_seen - resumed)
    if elapsed >= _phase_len(row):
        return False                    # the phase ended before the gap: the normal path settles it
    with _atomic(conn):
        done = conn.execute(
            "UPDATE pomodoro_runs SET status = 'paused', phase_elapsed_s = ?, resumed_utc = NULL, paused_utc = ? "
            "WHERE id = ? AND status = 'running' AND resumed_utc = ?",
            (elapsed, timeutil.to_iso(now), row["id"], row["resumed_utc"]),
        ).rowcount
    if done:
        _alive["away_run"] = row["id"]
        log.info("paused the focus run: no clock tick for %d s (the computer was probably asleep)", slept)
        sync_keepawake(conn)
    return bool(done)


def _publish(conn: sqlite3.Connection, now: datetime) -> dict[str, Any]:
    state = get_state(conn, now)
    live.hub.publish("pomodoro", state)
    return state


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _resolve_preset(preset: Any, work_min: Any, break_min: Any, cycles: Any) -> tuple[str, int, int, int]:
    preset = str(preset or "").strip() or DEFAULT_PRESET
    if preset in PRESET_BY_ID:
        p = PRESET_BY_ID[preset]
        return preset, p["work_min"], p["break_min"], p["cycles"]
    if preset != "custom":
        raise PomodoroError("bad_preset", "Pick one of the presets, or custom.")
    values = []
    labels = dict(CUSTOM_FIELDS)
    for name, raw in (("work_min", work_min), ("break_min", break_min), ("cycles", cycles)):
        low, high = CUSTOM_LIMITS[name]
        try:
            number = int(str(raw).strip())
        except (TypeError, ValueError):
            number = None
        if number is None or not low <= number <= high:
            raise PomodoroError("bad_custom", f"{labels[name]}: use {low} to {high}.")
        values.append(number)
    return "custom", values[0], values[1], values[2]


def custom_defaults(conn: sqlite3.Connection) -> dict[str, int]:
    """The numbers the Custom card opens with: the ones the person used last (remembered); before the first custom
    run, the numbers of the preset they used last, so "edit the 90 / 15 / 2" starts from what they know."""
    out = dict(DEFAULT_CUSTOM)
    last = PRESET_BY_ID.get(db.get_setting(conn, "pomodoro_preset") or DEFAULT_PRESET)
    if last is not None:
        out = {"work_min": last["work_min"], "break_min": last["break_min"], "cycles": last["cycles"]}
    saved = db.get_setting(conn, "pomodoro_custom")
    if isinstance(saved, dict):
        for name, (low, high) in CUSTOM_LIMITS.items():
            try:
                value = int(saved.get(name))
            except (TypeError, ValueError):
                continue
            if low <= value <= high:
                out[name] = value
    return out


def legacy_focus_open(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM focus_sessions WHERE end_utc IS NULL").fetchone() is not None


def start(
    conn: sqlite3.Connection, *, category: str, label: str = "", preset: Any = None, work_min: Any = None,
    break_min: Any = None, cycles: Any = None, now: datetime | None = None, spot: str | None = None,
) -> dict[str, Any]:
    now = now or timeutil.now_utc()
    settle(conn, now)
    if category not in categories.ALL:
        raise PomodoroError("bad_category", "Pick a category for the run.")
    preset_id, w, b, c = _resolve_preset(preset, work_min, break_min, cycles)
    if spot is None:
        from . import economy
        spot = economy.selected_spot(conn)            # the last spot used (Butler until another is unlocked)
    stamp = timeutil.to_iso(now)
    with db.transaction(conn):
        # checked inside the write lock, so two screens tapping Start together cannot both get in
        if active_run(conn) is not None:
            raise PomodoroError("already_running", "A focus session is already running.")
        if legacy_focus_open(conn):
            raise PomodoroError(
                "legacy_running", "A single focus session (started on the Focus page or in Telegram) is still running. Finish or cancel it on the Focus page first."
            )
        conn.execute(
            "INSERT INTO pomodoro_runs(preset, work_s, break_s, cycles, category, label, started_utc, status, "
            "phase_idx, phase_start_utc, phase_elapsed_s, resumed_utc, spot) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 0, ?, 0, ?, ?)",
            (preset_id, w * 60, b * 60, c, category, (label or "").strip()[:120] or None, stamp, stamp, stamp, spot),
        )
        db.set_setting(conn, "pomodoro_preset", preset_id)
        if preset_id == "custom":
            db.set_setting(conn, "pomodoro_custom", {"work_min": w, "break_min": b, "cycles": c})
    return _publish(conn, now)


def pause(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any]:
    now = now or timeutil.now_utc()
    settle(conn, now)
    with db.transaction(conn):
        row = active_run(conn)
        if row is None or row["status"] != "running":
            raise PomodoroError("not_running", "Nothing is running to pause.")
        conn.execute(
            "UPDATE pomodoro_runs SET status = 'paused', phase_elapsed_s = ?, resumed_utc = NULL, paused_utc = ? WHERE id = ?",
            (_elapsed(row, now), timeutil.to_iso(now), row["id"]),
        )
    _alive["away_run"] = None
    return _publish(conn, now)


def resume(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any]:
    now = now or timeutil.now_utc()
    _beat()                       # so a long sleep before this tap is not mistaken for time the run was running
    with db.transaction(conn):
        row = active_run(conn)
        if row is None or row["status"] != "paused":
            raise PomodoroError("not_paused", "Nothing is paused.")
        conn.execute(
            "UPDATE pomodoro_runs SET status = 'running', resumed_utc = ?, paused_utc = NULL WHERE id = ?",
            (timeutil.to_iso(now), row["id"]),
        )
    _alive["away_run"] = None
    return _publish(conn, now)


def skip_break(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any]:
    now = now or timeutil.now_utc()
    settle(conn, now)
    with db.transaction(conn):
        row = active_run(conn)
        if row is None:
            raise PomodoroError("not_running", "No run is active.")
        if row["status"] == "waiting" or _phases(row)[row["phase_idx"]][0] != "break":
            raise PomodoroError("not_on_break", "There is no break to end right now.")
        stamp = timeutil.to_iso(now)
        conn.execute(
            "UPDATE pomodoro_runs SET phase_idx = phase_idx + 1, phase_start_utc = ?, phase_elapsed_s = 0, extra_s = 0, "
            "resumed_utc = ? WHERE id = ?",
            (stamp, stamp if row["status"] == "running" else None, row["id"]),
        )
    return _publish(conn, now)


def _waiting_block(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The finished work block a `waiting` run is holding for (the newest whole block of the current cycle)."""
    cycle = _phases(row)[min(row["phase_idx"], len(_phases(row)) - 1)][2]
    return conn.execute(
        "SELECT * FROM pomodoro_blocks WHERE run_id = ? AND cycle = ? AND partial = 0 ORDER BY id DESC LIMIT 1", (row["id"], cycle)
    ).fetchone()


def _leave_waiting(conn: sqlite3.Connection, row: sqlite3.Row, now: datetime) -> bool:
    """The person is done with the finished block: start what comes next (the break, the next block), or finish the run."""
    phases = _phases(row)
    stamp = timeutil.to_iso(now)
    if row["phase_idx"] >= len(phases) - 1:
        done = conn.execute(
            "UPDATE pomodoro_runs SET status = 'finished', resumed_utc = NULL, ended_utc = ? WHERE id = ? AND status = 'waiting'",
            (stamp, row["id"]),
        ).rowcount
    else:
        done = conn.execute(
            "UPDATE pomodoro_runs SET status = 'running', phase_idx = phase_idx + 1, phase_start_utc = ?, phase_elapsed_s = 0, "
            "extra_s = 0, resumed_utc = ? WHERE id = ? AND status = 'waiting'",
            (stamp, stamp, row["id"]),
        ).rowcount
    if done:
        sync_keepawake(conn)
    return bool(done)


def _after_block_answered(conn: sqlite3.Connection, block: sqlite3.Row, now: datetime) -> None:
    """A block was rated or dropped: if it is the one the run is holding for, the break (or the next block) starts now."""
    row = active_run(conn)
    if row is None or row["status"] != "waiting" or row["id"] != block["run_id"] or block["partial"]:
        return
    if block["cycle"] != _phases(row)[row["phase_idx"]][2]:
        return                              # an older block that was left for later: the run is not waiting for it
    _leave_waiting(conn, row, now)


def start_next(conn: sqlite3.Connection, now: datetime | None = None) -> dict[str, Any]:
    """"Start break" (or "Next block", or "Finish run" after the last block): move on without rating the block.

    The block stays waiting to be rated, so "rate it later" loses nothing.
    """
    now = now or timeutil.now_utc()
    settle(conn, now)
    with db.transaction(conn):
        row = active_run(conn)
        if row is None:
            raise PomodoroError("not_running", "No run is active.")
        if row["status"] != "waiting":
            raise PomodoroError("not_waiting", "There is no finished block waiting for you.")
        _leave_waiting(conn, row, now)
    return _publish(conn, now)


def extend(conn: sqlite3.Connection, minutes: Any, now: datetime | None = None) -> dict[str, Any]:
    """"+5 min": add minutes to the current work block, to the current break, or (after a block ends) keep going.

    Keeping going from the end-of-block card folds the still-unrated block back into a longer one, so the extra
    minutes are logged and rated together with the rest of the block.
    """
    now = now or timeutil.now_utc()
    try:
        extra = int(str(minutes).strip())
    except (TypeError, ValueError):
        extra = 0
    if not 1 <= extra <= 60:
        raise PomodoroError("bad_minutes", "Add between 1 and 60 minutes.")
    settle(conn, now)
    with db.transaction(conn):
        row = active_run(conn)
        if row is None:
            raise PomodoroError("not_running", "No run is active.")
        phases = _phases(row)
        kind = phases[row["phase_idx"]][0]
        new_extra = row["extra_s"] + extra * 60
        if (phases[row["phase_idx"]][1] + new_extra) > MAX_PHASE_MINUTES[kind] * 60:
            raise PomodoroError("too_long", f"That would make it longer than {MAX_PHASE_MINUTES[kind] // 60} hours.")
        if row["status"] == "waiting":
            block = _waiting_block(conn, row)
            if block is None or block["status"] != "unrated":
                raise PomodoroError("already_logged", "That block is already logged. Start another run to keep going.")
            conn.execute("DELETE FROM pomodoro_blocks WHERE id = ? AND status = 'unrated'", (block["id"],))
            conn.execute(
                "UPDATE pomodoro_runs SET status = 'running', extra_s = ?, resumed_utc = ? WHERE id = ?",
                (new_extra, timeutil.to_iso(now), row["id"]),
            )
        else:
            conn.execute("UPDATE pomodoro_runs SET extra_s = ? WHERE id = ?", (new_extra, row["id"]))
    sync_keepawake(conn)
    return _publish(conn, now)


def stop(conn: sqlite3.Connection, discard: bool = False, now: datetime | None = None) -> dict[str, Any]:
    """End the run. Work done in the current block (at least a minute) is kept as a block to rate, unless `discard`."""
    now = now or timeutil.now_utc()
    settle(conn, now)
    with db.transaction(conn):
        row = active_run(conn)             # read inside the write lock: two stops cannot both add a partial block
        if row is None:
            raise PomodoroError("not_running", "No run is active.")
        kind, _seconds, cycle = _phases(row)[row["phase_idx"]]
        elapsed = _elapsed(row, now)
        # a run holding after a finished block already has that block: stopping adds nothing
        if kind == "work" and row["status"] != "waiting" and not discard and elapsed >= MIN_PARTIAL_SECONDS:
            _add_block(conn, row, cycle, now, elapsed, partial=True)
        conn.execute(
            "UPDATE pomodoro_runs SET status = 'stopped', phase_elapsed_s = ?, resumed_utc = NULL, ended_utc = ? WHERE id = ?",
            (elapsed, timeutil.to_iso(now), row["id"]),
        )
    return _publish(conn, now)


def rate(
    conn: sqlite3.Connection, *, focus: str, block_id: Any = None, category: str | None = None, note: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Rate a finished work block: creates the entry and runs the game step. Returns {entry, events, pomodoro}."""
    now = now or timeutil.now_utc()
    if focus not in FOCUS_VALUES:
        raise PomodoroError("bad_focus", "Pick how the block went: full, mostly, or got pulled away.")
    settle(conn, now)
    if block_id in (None, ""):
        row = conn.execute("SELECT * FROM pomodoro_blocks WHERE status = 'unrated' ORDER BY id LIMIT 1").fetchone()
    else:
        try:
            row = conn.execute("SELECT * FROM pomodoro_blocks WHERE id = ?", (int(block_id),)).fetchone()
        except (TypeError, ValueError):
            row = None
    if row is None or row["status"] != "unrated":
        raise PomodoroError("nothing_to_rate", "There is no finished block waiting for a rating.")
    run = conn.execute("SELECT * FROM pomodoro_runs WHERE id = ?", (row["run_id"],)).fetchone()
    chosen = category or row["category"] or run["category"]
    if chosen not in categories.ALL:
        raise PomodoroError("bad_category", "Pick a category for the block.")
    claimed = conn.execute(
        "UPDATE pomodoro_blocks SET status = 'rating' WHERE id = ? AND status = 'unrated'", (row["id"],)
    ).rowcount
    if not claimed:
        raise PomodoroError("nothing_to_rate", "That block was just rated.")
    note = " ".join((note or "").split())[:150]
    label = run["label"] or ""
    entry_note = f"{label}: {note}" if (label and note) else (note or label)
    deep = focus != "pulled_away" and chosen in DEEP_CATEGORIES
    try:
        before = _snapshot(conn)
        start_utc, end_utc = timeutil.from_iso(row["started_utc"]), timeutil.from_iso(row["ended_utc"])
        entry_id = rules.add_entry(conn, start_utc, end_utc, chosen, deep, "focus", note=entry_note or None)
        conn.execute(
            "UPDATE pomodoro_blocks SET status = 'rated', focus = ?, category = ?, note = ?, entry_id = ?, rated_utc = ? WHERE id = ?",
            (focus, chosen, note or None, entry_id, timeutil.to_iso(now), row["id"]),
        )
    except Exception:
        conn.execute("UPDATE pomodoro_blocks SET status = 'unrated' WHERE id = ? AND status = 'rating'", (row["id"],))
        raise
    _after_block_answered(conn, row, now)
    minutes = timeutil.minutes_between(start_utc, end_utc)
    entry = {"id": entry_id, "category": chosen, "minutes": minutes, "deep": deep, "note": entry_note or ""}
    events = _finish(conn, before, entry)
    return {"entry": entry, "events": events, "pomodoro": _publish(conn, now), "block_id": row["id"]}


def discard_block(conn: sqlite3.Connection, block_id: Any = None, now: datetime | None = None) -> dict[str, Any]:
    """"This didn't happen": drop a finished block that is waiting for a rating. Nothing is logged."""
    now = now or timeutil.now_utc()
    settle(conn, now)
    if block_id in (None, ""):
        row = conn.execute("SELECT id FROM pomodoro_blocks WHERE status = 'unrated' ORDER BY id LIMIT 1").fetchone()
        block_id = row["id"] if row else None
    try:
        block_id = int(block_id)
    except (TypeError, ValueError):
        raise PomodoroError("nothing_to_rate", "There is no finished block waiting.") from None
    done = conn.execute(
        "UPDATE pomodoro_blocks SET status = 'discarded', rated_utc = ? WHERE id = ? AND status = 'unrated'",
        (timeutil.to_iso(now), block_id),
    ).rowcount
    if not done:
        raise PomodoroError("nothing_to_rate", "That block is not waiting for a rating any more.")
    _after_block_answered(conn, conn.execute("SELECT * FROM pomodoro_blocks WHERE id = ?", (block_id,)).fetchone(), now)
    return _publish(conn, now)


def _snapshot(conn: sqlite3.Connection) -> game.Snapshot | None:
    try:
        return game.snapshot(conn)
    except Exception:
        log.exception("game.snapshot failed")
        return None


def _finish(conn: sqlite3.Connection, before: game.Snapshot | None, entry: dict) -> list[dict]:
    if before is None:
        return []
    try:
        events = game.finish_write(conn, before, entry=entry)
    except Exception:
        log.exception("game.finish_write failed")
        return []
    live.publish_game_events(events, db.utc_now_iso())
    return events


def stop_and_rate(conn: sqlite3.Connection, outcome: str, now: datetime | None = None) -> tuple[str, str, dict | None, list[dict]]:
    """The old /focus/stop contract on top of the engine: (message, kind, entry or None, events)."""
    now = now or timeutil.now_utc()
    settle(conn, now)
    if active_run(conn) is None and not pending_ratings(conn):
        return "No focus session is running.", "info", None, []
    if outcome == "cancelled":
        if active_run(conn) is not None:
            stop(conn, discard=True, now=now)
        return "Focus session cancelled. Nothing was logged.", "info", None, []
    if outcome not in FOCUS_VALUES:
        return "Pick how the session went.", "warn", None, []
    if active_run(conn) is not None:
        stop(conn, discard=False, now=now)
    if not pending_ratings(conn):
        return "Run stopped. Less than a minute was done, so nothing was logged.", "info", None, []
    result = rate(conn, focus=outcome, now=now)
    entry = result["entry"]
    deep_word = ", deep" if entry["deep"] else ""
    return f"Logged {entry['category']}, {game.fmt_min(entry['minutes'])}{deep_word}.", "ok", entry, result["events"]


# --------------------------------------------------------------------------
# Housekeeping (called by the scheduler every minute and by the stream)
# --------------------------------------------------------------------------

def housekeeping(conn: sqlite3.Connection, now: datetime | None = None) -> bool:
    """Settle the clock, stop a run that was left paused for hours, log stale unrated blocks, fix the wake lock."""
    now = now or timeutil.now_utc()
    changed = settle(conn, now)
    row = active_run(conn)
    if row is not None and row["status"] == "paused" and row["paused_utc"] and now - timeutil.from_iso(row["paused_utc"]) > MAX_PAUSE:
        stop(conn, discard=False, now=now)
        changed = True
    if row is not None and row["status"] == "waiting":
        block = _waiting_block(conn, row)
        since = timeutil.from_iso(block["ended_utc"]) if block else None
        if since is not None and now - since > MAX_WAIT:
            # nobody answered for hours: close the run (after the last block it counts as finished); the block stays to be rated
            last = row["phase_idx"] >= len(_phases(row)) - 1
            conn.execute(
                "UPDATE pomodoro_runs SET status = ?, resumed_utc = NULL, ended_utc = ? WHERE id = ? AND status = 'waiting'",
                ("finished" if last else "stopped", timeutil.to_iso(now), row["id"]),
            )
            changed = True
    cutoff = timeutil.to_iso(now - UNRATED_EXPIRY)
    stale = conn.execute(
        "SELECT id FROM pomodoro_blocks WHERE status = 'unrated' AND ended_utc < ? ORDER BY id", (cutoff,)
    ).fetchall()
    for block in stale:
        # the time was done, so it is kept: logged as plain (not deep) time in the run's category, never dropped
        try:
            rate(conn, focus="pulled_away", block_id=block["id"], note="never rated", now=now)
        except Exception:
            log.exception("could not log the stale block %s; marking it expired", block["id"])
            conn.execute("UPDATE pomodoro_blocks SET status = 'expired' WHERE id = ? AND status IN ('unrated', 'rating')", (block["id"],))
        changed = True
    sync_keepawake(conn)
    if changed:
        live.hub.publish("pomodoro", get_state(conn, now, settle_first=False))
    return changed
