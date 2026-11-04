"""The server-side Pomodoro: the state machine (frozen clocks), rating, keep-awake, the API and the stream."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import timedelta

import pytest

from epoch import db, game, live, pomodoro, rules, timeutil
from epoch.pomodoro import PomodoroError

T0 = timeutil.from_iso("2026-10-14T15:00:00Z")


def at(**delta):
    return T0 + timedelta(**delta)


def run_of(state):
    return state["run"]


def entries(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM entries WHERE deleted = 0 ORDER BY id")]


# --------------------------------------------------------------------------
# The state machine
# --------------------------------------------------------------------------

def test_default_preset_starts_a_50_minute_work_block(conn):
    state = pomodoro.start(conn, category="Python", label="numpy", now=T0)
    run = run_of(state)
    assert state["active"] and run["preset"] == "50-10-3" and run["phase"] == "work" and run["cycle"] == 1
    assert (run["work_min"], run["break_min"], run["cycles"]) == (50, 10, 3)
    assert run["phase_seconds"] == 3000 and run["remaining_seconds"] == 3000 and run["elapsed_seconds"] == 0
    assert run["phase_ends_at"] == "2026-10-14T15:50:00Z" and run["paused"] is False
    assert run["next"] == {"phase": "break", "seconds": 600} and run["phase_count"] == 5
    assert state["awaiting_rating"] is False and state["server_now"] == "2026-10-14T15:00:00Z"
    assert state["server_epoch_ms"] == int(T0.timestamp() * 1000)


def test_countdown_is_derived_from_the_clock(conn):
    pomodoro.start(conn, category="Python", now=T0)
    for minutes, remaining in ((1, 2940), (25, 1500), (49, 60)):
        state = pomodoro.get_state(conn, at(minutes=minutes))
        assert run_of(state)["remaining_seconds"] == remaining and run_of(state)["phase"] == "work"
    # two readers at the same instant agree exactly
    assert pomodoro.get_state(conn, at(minutes=7)) == pomodoro.get_state(conn, at(minutes=7))


def look(conn, minutes):
    run = run_of(pomodoro.get_state(conn, at(minutes=minutes)))
    return (minutes, run["phase"], run["cycle"], run["status"])


def test_the_whole_run_walks_work_hold_break_work_hold_break_work_hold_done(conn):
    pomodoro.start(conn, category="Math", now=T0)
    assert look(conn, 0) == (0, "work", 1, "running") and look(conn, 49) == (49, "work", 1, "running")
    # the work block ends at 50 and the run HOLDS: no break starts by itself, however long nobody answers
    assert look(conn, 50) == (50, "waiting", 1, "waiting") and look(conn, 55) == (55, "waiting", 1, "waiting")
    assert look(conn, 120) == (120, "waiting", 1, "waiting")
    pomodoro.start_next(conn, at(minutes=125))                                  # "Start break" at 125: the break runs 125-135
    assert look(conn, 125) == (125, "break", 1, "running") and look(conn, 134) == (134, "break", 1, "running")
    assert look(conn, 135) == (135, "work", 2, "running")                       # a finished break starts the next block by itself
    assert look(conn, 184) == (184, "work", 2, "running") and look(conn, 185) == (185, "waiting", 2, "waiting")
    pomodoro.start_next(conn, at(minutes=190))
    assert look(conn, 199) == (199, "break", 2, "running") and look(conn, 200) == (200, "work", 3, "running")
    assert look(conn, 250) == (250, "waiting", 3, "waiting")                     # the last block holds too
    pomodoro.start_next(conn, at(minutes=251))
    assert look(conn, 251) == (251, "done", 3, "finished") and look(conn, 300) == (300, "done", 3, "finished")
    blocks = conn.execute("SELECT * FROM pomodoro_blocks ORDER BY id").fetchall()
    assert [(b["cycle"], b["started_utc"], b["ended_utc"], b["worked_s"]) for b in blocks] == [
        (1, "2026-10-14T15:00:00Z", "2026-10-14T15:50:00Z", 3000),
        (2, "2026-10-14T17:15:00Z", "2026-10-14T18:05:00Z", 3000),
        (3, "2026-10-14T18:20:00Z", "2026-10-14T19:10:00Z", 3000),
    ]


def test_settling_late_gives_the_same_block_as_settling_on_time(db_path):
    results = []
    for step in (5, 400):      # polled every 5 minutes, or only once at the very end
        path = db_path.parent / f"w{step}.db"
        db.init_db(path, today=timeutil.local_date_of(T0, "Asia/Kolkata"))
        with db.get_conn(path) as c:
            pomodoro.start(c, category="Python", now=T0)
            for m in range(0, 400, step):
                pomodoro.settle(c, at(minutes=m))
            pomodoro.settle(c, at(minutes=400))
            results.append([tuple(r)[2:6] for r in c.execute("SELECT * FROM pomodoro_blocks ORDER BY id")])
            assert run_of(pomodoro.get_state(c, at(minutes=401)))["status"] == "waiting"
    assert results[0] == results[1] and len(results[0]) == 1 and results[0][0][2] == "2026-10-14T15:50:00Z"


def test_a_finished_work_block_holds_the_run_until_the_person_moves_on(conn):
    pomodoro.start(conn, category="Python", label="numpy", now=T0)
    state = pomodoro.get_state(conn, at(minutes=51))
    run = run_of(state)
    assert state["active"] is True and state["awaiting_rating"] is True
    assert run["phase"] == "waiting" and run["status"] == "waiting" and run["remaining_seconds"] == 0 and run["phase_ends_at"] is None
    pending = state["pending_ratings"]
    assert len(pending) == 1 and pending[0]["minutes"] == 50 and pending[0]["category"] == "Python"
    assert pending[0]["label"] == "numpy" and pending[0]["partial"] is False and pending[0]["cycle"] == 1
    assert run["waiting"] == {"block_id": pending[0]["block_id"], "since": "2026-10-14T15:50:00Z", "unrated": True, "minutes": 50}
    assert run["next"] == {"phase": "break", "seconds": 600} and run["last"] is False


def test_the_break_does_not_start_while_the_card_is_open_and_is_whole_when_you_come_back(conn):
    """The 90-15 bug: the user came back 14 minutes after the block ended and the 15 minute break had 1 minute left."""
    pomodoro.start(conn, category="Python", preset="90-15-2", now=T0)
    for minutes in (91, 100, 105, 200):
        run = run_of(pomodoro.get_state(conn, at(minutes=minutes)))
        assert run["phase"] == "waiting" and run["remaining_seconds"] == 0
    pomodoro.rate(conn, focus="full", now=at(minutes=105))             # rated 15 minutes after the block ended
    run = run_of(pomodoro.get_state(conn, at(minutes=105)))
    assert run["phase"] == "break" and run["remaining_seconds"] == 15 * 60 and run["phase_ends_at"] == "2026-10-14T17:00:00Z"
    assert run_of(pomodoro.get_state(conn, at(minutes=119)))["phase"] == "break"
    assert run_of(pomodoro.get_state(conn, at(minutes=120)))["phase"] == "work"


def test_pause_and_resume_do_not_lose_or_invent_time(conn):
    pomodoro.start(conn, category="Python", now=T0)
    paused = pomodoro.pause(conn, at(minutes=10))
    assert run_of(paused)["paused"] and run_of(paused)["status"] == "paused" and run_of(paused)["remaining_seconds"] == 2400
    assert run_of(paused)["phase_ends_at"] is None and paused["active"]
    later = pomodoro.get_state(conn, at(minutes=40))          # 30 minutes of pause: nothing moves
    assert run_of(later)["remaining_seconds"] == 2400 and run_of(later)["phase"] == "work"
    resumed = pomodoro.resume(conn, at(minutes=40))
    assert run_of(resumed)["remaining_seconds"] == 2400 and run_of(resumed)["phase_ends_at"] == "2026-10-14T16:20:00Z"
    after = pomodoro.get_state(conn, at(minutes=80))
    assert run_of(after)["phase"] == "waiting"
    block = conn.execute("SELECT * FROM pomodoro_blocks").fetchone()
    assert block["worked_s"] == 3000 and block["ended_utc"] == "2026-10-14T16:20:00Z"
    assert block["started_utc"] == "2026-10-14T15:30:00Z"        # worked time, ending when the block ended


def test_pause_during_a_break_and_resume(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.start_next(conn, at(minutes=50))                     # the break starts at 15:50
    pomodoro.pause(conn, at(minutes=54))                          # 4 minutes into the break
    state = pomodoro.get_state(conn, at(minutes=90))
    assert run_of(state)["phase"] == "break" and run_of(state)["remaining_seconds"] == 360
    pomodoro.resume(conn, at(minutes=90))
    assert run_of(pomodoro.get_state(conn, at(minutes=96)))["phase"] == "work"


def test_pause_and_resume_errors(conn):
    with pytest.raises(PomodoroError) as exc:
        pomodoro.pause(conn, T0)
    assert exc.value.code == "not_running"
    pomodoro.start(conn, category="Python", now=T0)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.resume(conn, T0)
    assert exc.value.code == "not_paused"
    pomodoro.pause(conn, at(minutes=1))
    with pytest.raises(PomodoroError):
        pomodoro.pause(conn, at(minutes=2))


def test_skip_break_starts_the_next_work_block_now(conn):
    pomodoro.start(conn, category="Python", now=T0)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.skip_break(conn, at(minutes=5))
    assert exc.value.code == "not_on_break"
    with pytest.raises(PomodoroError) as exc:                     # the end-of-block hold is not a break
        pomodoro.skip_break(conn, at(minutes=51))
    assert exc.value.code == "not_on_break"
    pomodoro.start_next(conn, at(minutes=50))
    state = pomodoro.skip_break(conn, at(minutes=53))             # 3 minutes into the break
    run = run_of(state)
    assert run["phase"] == "work" and run["cycle"] == 2 and run["remaining_seconds"] == 3000
    assert run["phase_ends_at"] == "2026-10-14T16:43:00Z"
    assert state["awaiting_rating"] is True                       # block 1 is still waiting for its rating


def test_skip_break_while_paused_keeps_it_paused(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.start_next(conn, at(minutes=50))
    pomodoro.pause(conn, at(minutes=52))
    state = pomodoro.skip_break(conn, at(minutes=60))
    assert run_of(state)["phase"] == "work" and run_of(state)["paused"] and run_of(state)["remaining_seconds"] == 3000


def test_the_last_block_ends_the_run_when_you_move_on_and_it_stays_visible_for_two_hours(conn):
    pomodoro.start(conn, category="Python", preset="90-15-2", now=T0)
    pomodoro.start_next(conn, at(minutes=90))                     # break 90-105, block 2 105-195
    assert run_of(pomodoro.get_state(conn, at(minutes=194)))["phase"] == "work"
    holding = pomodoro.get_state(conn, at(hours=4))
    assert holding["active"] is True and run_of(holding)["status"] == "waiting" and run_of(holding)["last"] is True
    assert run_of(holding)["next"] is None
    state = pomodoro.start_next(conn, at(hours=4, minutes=2))      # "Finish run"
    run = run_of(state)
    assert state["active"] is False and run["status"] == "finished" and run["phase"] == "done" and run["remaining_seconds"] == 0
    assert state["awaiting_rating"] and len(state["pending_ratings"]) == 2
    assert run_of(pomodoro.get_state(conn, at(hours=6, minutes=1))) is not None
    assert pomodoro.get_state(conn, at(hours=7))["run"] is None


def test_no_break_after_the_last_work_block_and_zero_length_breaks(conn):
    assert pomodoro.phase_list(1500, 300, 2) == [("work", 1500, 1), ("break", 300, 1), ("work", 1500, 2)]
    assert pomodoro.phase_list(1500, 0, 3) == [("work", 1500, 1), ("work", 1500, 2), ("work", 1500, 3)]
    state = pomodoro.start(conn, category="Python", preset="custom", work_min=25, break_min=0, cycles=2, now=T0)
    assert run_of(state)["phase_count"] == 2 and run_of(state)["next"] == {"phase": "work", "seconds": 1500}


def test_other_presets_and_custom_validation(conn):
    assert run_of(pomodoro.start(conn, category="Math", preset="25-5-4", now=T0))["cycles"] == 4
    pomodoro.stop(conn, discard=True, now=at(seconds=5))
    for bad in (dict(preset="nope"), dict(preset="custom", work_min=0, break_min=5, cycles=2),
                dict(preset="custom", work_min=25, break_min=61, cycles=2), dict(preset="custom", work_min=25, break_min=5, cycles=9),
                dict(preset="custom", work_min="x", break_min=5, cycles=2)):
        with pytest.raises(PomodoroError):
            pomodoro.start(conn, category="Math", now=T0, **bad)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.start(conn, category="Nonsense", now=T0)
    assert exc.value.code == "bad_category"
    state = pomodoro.start(conn, category="Math", preset="custom", work_min=7, break_min=2, cycles=1, now=at(minutes=1))
    assert run_of(state)["work_min"] == 7 and state["default_preset"] == "custom"


def test_only_one_run_at_a_time_and_not_alongside_the_old_focus_timer(conn):
    pomodoro.start(conn, category="Python", now=T0)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.start(conn, category="Math", now=at(minutes=1))
    assert exc.value.code == "already_running"
    pomodoro.stop(conn, discard=True, now=at(minutes=2))
    conn.execute("INSERT INTO focus_sessions(start_utc, planned_minutes, category) VALUES (?, 25, 'Python')", (timeutil.to_iso(T0),))
    with pytest.raises(PomodoroError) as exc:
        pomodoro.start(conn, category="Math", now=at(minutes=3))
    assert exc.value.code == "legacy_running" and "Telegram" in exc.value.hint


def test_a_finished_run_does_not_block_the_next_one(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=5, break_min=1, cycles=1, now=T0)
    with pytest.raises(PomodoroError) as exc:                      # the finished block is still waiting on you
        pomodoro.start(conn, category="Math", now=at(minutes=6))
    assert exc.value.code == "already_running"
    pomodoro.start_next(conn, at(minutes=6))
    assert pomodoro.start(conn, category="Math", now=at(minutes=7))["active"]


# --------------------------------------------------------------------------
# Stopping
# --------------------------------------------------------------------------

def test_stop_mid_work_keeps_the_time_as_a_partial_block(conn):
    pomodoro.start(conn, category="Python", label="x", now=T0)
    state = pomodoro.stop(conn, now=at(minutes=20, seconds=40))
    assert state["active"] is False and run_of(state)["status"] == "stopped" and run_of(state)["phase"] == "done"
    (pending,) = state["pending_ratings"]
    assert pending["partial"] is True and pending["minutes"] == 21
    block = conn.execute("SELECT * FROM pomodoro_blocks").fetchone()
    assert block["worked_s"] == 1240 and block["started_utc"] == "2026-10-14T15:00:00Z" and block["ended_utc"] == "2026-10-14T15:20:40Z"


def test_stop_with_less_than_a_minute_or_discard_or_on_a_break_logs_nothing_new(conn):
    pomodoro.start(conn, category="Python", now=T0)
    assert pomodoro.stop(conn, now=at(seconds=59))["pending_ratings"] == []
    pomodoro.start(conn, category="Python", now=at(minutes=1))
    assert pomodoro.stop(conn, discard=True, now=at(minutes=30))["pending_ratings"] == []
    pomodoro.start(conn, category="Python", now=at(minutes=31))
    state = pomodoro.stop(conn, now=at(minutes=31 + 55))          # on the break: the finished block is there, no partial
    assert len(state["pending_ratings"]) == 1 and state["pending_ratings"][0]["partial"] is False
    with pytest.raises(PomodoroError):
        pomodoro.stop(conn, now=at(hours=3))


def test_stop_while_paused_counts_the_paused_elapsed(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.pause(conn, at(minutes=12))
    state = pomodoro.stop(conn, now=at(minutes=90))
    assert state["pending_ratings"][0]["minutes"] == 12


# --------------------------------------------------------------------------
# Rating
# --------------------------------------------------------------------------

def finished_block(conn, category="Python", label="numpy", **preset):
    pomodoro.start(conn, category=category, label=label, now=T0, **preset)
    pomodoro.settle(conn, at(minutes=51))
    return conn.execute("SELECT id FROM pomodoro_blocks").fetchone()["id"]


def test_rating_full_creates_a_deep_entry_linked_to_the_run_and_plays_the_game(conn, v2_clock):
    block_id = finished_block(conn)
    v2_clock.now = at(minutes=52)
    result = pomodoro.rate(conn, focus="full", note="broadcasting rules", now=at(minutes=52))
    entry = result["entry"]
    assert entry["category"] == "Python" and entry["minutes"] == 50 and entry["deep"] is True
    assert entry["note"] == "numpy: broadcasting rules"
    (row,) = entries(conn)
    assert (row["category"], row["deep"], row["source"], row["note"]) == ("Python", 1, "focus", "numpy: broadcasting rules")
    assert row["start_utc"] == "2026-10-14T15:00:00Z" and row["end_utc"] == "2026-10-14T15:50:00Z"
    block = conn.execute("SELECT * FROM pomodoro_blocks WHERE id = ?", (block_id,)).fetchone()
    assert block["status"] == "rated" and block["entry_id"] == row["id"] and block["focus"] == "full" and block["rated_utc"]
    kinds = [e["kind"] for e in result["events"]]
    assert "floor" in kinds                                       # 50 deep minutes reaches the 30 minute floor
    assert result["pomodoro"]["awaiting_rating"] is False and result["block_id"] == block_id


def test_rating_mostly_is_deep_and_pulled_away_is_not(conn):
    finished_block(conn)
    pomodoro.rate(conn, focus="mostly", now=at(minutes=52))
    assert entries(conn)[0]["deep"] == 1
    conn.execute("DELETE FROM pomodoro_blocks")
    conn.execute("UPDATE pomodoro_runs SET status = 'stopped'")
    finished_block(conn)
    conn.execute("UPDATE pomodoro_blocks SET status = 'unrated'")
    pomodoro.rate(conn, focus="pulled_away", now=at(minutes=53))
    assert [r["deep"] for r in entries(conn)] == [1, 0]


def test_non_ladder_categories_are_never_deep(conn):
    finished_block(conn, category="Admin")
    pomodoro.rate(conn, focus="full", now=at(minutes=52))
    assert entries(conn)[0]["deep"] == 0 and entries(conn)[0]["category"] == "Admin"


def test_rating_can_change_the_category(conn):
    finished_block(conn, category="Python")
    pomodoro.rate(conn, focus="full", category="Math", now=at(minutes=52))
    assert entries(conn)[0]["category"] == "Math"
    finished = conn.execute("SELECT category FROM pomodoro_blocks").fetchone()
    assert finished["category"] == "Math"


def test_a_block_is_rated_once(conn):
    block_id = finished_block(conn)
    pomodoro.rate(conn, focus="full", block_id=block_id, now=at(minutes=52))
    with pytest.raises(PomodoroError) as exc:
        pomodoro.rate(conn, focus="full", block_id=block_id, now=at(minutes=53))
    assert exc.value.code == "nothing_to_rate" and len(entries(conn)) == 1


@pytest.mark.parametrize("kwargs,code", [
    (dict(focus="great"), "bad_focus"), (dict(focus=""), "bad_focus"),
    (dict(focus="full", block_id=9999), "nothing_to_rate"), (dict(focus="full", block_id="abc"), "nothing_to_rate"),
    (dict(focus="full", category="Nope"), "bad_category"),
])
def test_rating_errors(conn, kwargs, code):
    finished_block(conn)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.rate(conn, now=at(minutes=52), **kwargs)
    assert exc.value.code == code and entries(conn) == []
    assert conn.execute("SELECT status FROM pomodoro_blocks").fetchone()["status"] == "unrated"


def test_oldest_pending_block_is_rated_first_and_a_later_one_can_be_picked(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.start_next(conn, at(minutes=55))                      # block 1 left for later: break 55-65, block 2 65-115
    pomodoro.settle(conn, at(minutes=115))
    ids = [r["id"] for r in conn.execute("SELECT id FROM pomodoro_blocks ORDER BY id")]
    assert len(ids) == 2
    first = pomodoro.rate(conn, focus="full", block_id=ids[1], now=at(minutes=116))
    assert first["block_id"] == ids[1]
    second = pomodoro.rate(conn, focus="mostly", now=at(minutes=117))
    assert second["block_id"] == ids[0]


def test_rating_a_partial_block_logs_only_what_was_done(conn):
    pomodoro.start(conn, category="Papers", now=T0)
    pomodoro.stop(conn, now=at(minutes=17))
    result = pomodoro.rate(conn, focus="mostly", now=at(minutes=18))
    assert result["entry"]["minutes"] == 17 and result["entry"]["deep"] is True


def test_rating_a_game_failure_still_logs_the_entry(conn, monkeypatch):
    finished_block(conn)
    monkeypatch.setattr(game, "finish_write", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    result = pomodoro.rate(conn, focus="full", now=at(minutes=52))
    assert result["events"] == [] and len(entries(conn)) == 1


def test_rating_broadcasts_game_events(conn, v2_clock):
    finished_block(conn)
    v2_clock.now = at(minutes=52)

    async def run():
        sub = live.hub.subscribe()
        try:
            pomodoro.rate(conn, focus="full", now=at(minutes=52))
            await asyncio.sleep(0.05)                    # publishing hops onto the event loop
            got = []
            while not sub.queue.empty():
                got.append(sub.queue.get_nowait())
            return got
        finally:
            live.hub.unsubscribe(sub)

    messages = asyncio.run(run())
    names = [m[0] for m in messages]
    assert "game" in names and "pomodoro" in names
    game_message = next(m[1] for m in messages if m[0] == "game")
    assert game_message["events"] and "seq" in game_message and game_message["origin"] is None


# --------------------------------------------------------------------------
# Old focus buttons on the new engine
# --------------------------------------------------------------------------

def test_stop_and_rate_maps_the_old_outcomes(conn, v2_clock):
    assert pomodoro.stop_and_rate(conn, "full", T0)[:2] == ("No focus session is running.", "info")
    pomodoro.start(conn, category="Python", label="numpy", now=T0)
    v2_clock.now = at(minutes=30)
    message, kind, entry, events = pomodoro.stop_and_rate(conn, "full", at(minutes=30))
    assert kind == "ok" and entry["minutes"] == 30 and entry["deep"] and message.startswith("Logged Python, 30m, deep")
    assert pomodoro.get_state(conn, at(minutes=31))["active"] is False
    pomodoro.start(conn, category="Python", now=at(minutes=32))
    assert pomodoro.stop_and_rate(conn, "cancelled", at(minutes=33))[:2] == ("Focus session cancelled. Nothing was logged.", "info")
    pomodoro.start(conn, category="Python", now=at(minutes=34))
    assert pomodoro.stop_and_rate(conn, "weird", at(minutes=40))[1] == "warn"
    assert pomodoro.stop_and_rate(conn, "full", at(minutes=34, seconds=20))[0].startswith("Run stopped. Less than a minute")


# --------------------------------------------------------------------------
# Keep the Mac awake
# --------------------------------------------------------------------------

class FakeProc:
    def __init__(self, args):
        self.args, self.alive = args, True
        self.terminated = False

    def poll(self):
        return None if self.alive else 0

    def terminate(self):
        self.alive, self.terminated = False, True


def fake_keepawake(platform="darwin"):
    spawned = []

    def popen(args):
        proc = FakeProc(args)
        spawned.append(proc)
        return proc

    return pomodoro.KeepAwake(popen=popen, platform=platform), spawned


def test_keepawake_follows_the_run(conn, monkeypatch):
    keeper, spawned = fake_keepawake()
    monkeypatch.setattr(pomodoro, "keepawake", keeper)
    pomodoro.start(conn, category="Python", now=T0)
    assert len(spawned) == 1 and spawned[0].args[:2] == ["caffeinate", "-i"] and "-w" in spawned[0].args and keeper.held
    assert pomodoro.get_state(conn, at(minutes=1))["keep_awake"] is True and len(spawned) == 1   # not spawned twice
    pomodoro.pause(conn, at(minutes=2))
    assert spawned[0].terminated and not keeper.held
    pomodoro.resume(conn, at(minutes=3))
    assert len(spawned) == 2 and keeper.held
    pomodoro.stop(conn, discard=True, now=at(minutes=4))
    assert spawned[1].terminated and not keeper.held


def test_keepawake_released_when_the_run_finishes_by_itself(conn, monkeypatch):
    keeper, spawned = fake_keepawake()
    monkeypatch.setattr(pomodoro, "keepawake", keeper)
    pomodoro.start(conn, category="Python", preset="custom", work_min=5, break_min=1, cycles=1, now=T0)
    assert keeper.held
    pomodoro.get_state(conn, at(minutes=6))
    assert not keeper.held and spawned[0].terminated


def test_keepawake_is_a_no_op_off_macos_and_when_disabled(conn, monkeypatch):
    keeper, spawned = fake_keepawake(platform="linux")
    monkeypatch.setattr(pomodoro, "keepawake", keeper)
    pomodoro.start(conn, category="Python", now=T0)
    assert spawned == [] and not keeper.held
    keeper2, spawned2 = fake_keepawake()
    keeper2.enabled = False
    assert keeper2.hold() is False and spawned2 == []


def test_keepawake_survives_a_missing_caffeinate(monkeypatch):
    def boom(args):
        raise FileNotFoundError("caffeinate")

    keeper = pomodoro.KeepAwake(popen=boom, platform="darwin")
    assert keeper.hold() is False and not keeper.held
    keeper.release()


def test_server_restart_picks_the_wake_lock_up_again(conn, monkeypatch):
    pomodoro.start(conn, category="Python", now=T0)               # started under the autouse (disabled) keeper
    keeper, spawned = fake_keepawake()
    monkeypatch.setattr(pomodoro, "keepawake", keeper)
    pomodoro.housekeeping(conn, at(minutes=1))                    # what the first scheduler tick does
    assert len(spawned) == 1 and keeper.held


# --------------------------------------------------------------------------
# Housekeeping
# --------------------------------------------------------------------------

def test_housekeeping_stops_a_run_left_paused_for_hours(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.pause(conn, at(minutes=20))
    assert pomodoro.housekeeping(conn, at(minutes=20 + 119)) is False
    assert pomodoro.is_active(conn)
    assert pomodoro.housekeeping(conn, at(minutes=20 + 121)) is True
    state = pomodoro.get_state(conn, at(minutes=20 + 122))
    assert state["active"] is False and state["pending_ratings"][0]["minutes"] == 20


def test_housekeeping_logs_stale_unrated_blocks_as_plain_time_after_twelve_hours(conn):
    finished_block(conn, preset="custom", work_min=50, break_min=10, cycles=1)
    assert pomodoro.housekeeping(conn, at(hours=2)) is False
    assert pomodoro.housekeeping(conn, at(hours=11)) is True        # a run nobody answered for 3 hours is closed...
    assert not pomodoro.is_active(conn)
    assert pomodoro.pending_ratings(conn)                           # ...but the block is still there to rate
    assert pomodoro.housekeeping(conn, at(hours=13)) is True
    assert pomodoro.pending_ratings(conn) == []
    rows = entries(conn)
    assert len(rows) == 1 and rows[0]["source"] == "focus" and rows[0]["deep"] == 0 and rows[0]["category"] == "Python"
    assert conn.execute("SELECT status FROM pomodoro_blocks").fetchone()["status"] == "rated"


def test_a_block_that_did_not_happen_can_be_discarded(conn):
    finished_block(conn, preset="custom", work_min=50, break_min=10, cycles=1)
    block = pomodoro.pending_ratings(conn)[0]["block_id"]
    state = pomodoro.discard_block(conn, block, now=at(minutes=51))
    assert state["pending_ratings"] == [] and entries(conn) == []
    assert conn.execute("SELECT status FROM pomodoro_blocks").fetchone()["status"] == "discarded"
    with pytest.raises(PomodoroError):
        pomodoro.discard_block(conn, block, now=at(minutes=52))


def test_housekeeping_settles_phase_changes(conn):
    pomodoro.start(conn, category="Python", now=T0)
    assert pomodoro.housekeeping(conn, at(minutes=51)) is True
    assert pomodoro.housekeeping(conn, at(minutes=52)) is False


def test_scheduler_treats_a_run_as_focus(conn):
    from epoch import scheduler
    assert scheduler.focus_is_active(conn, T0) is False
    pomodoro.start(conn, category="Python", now=T0)
    assert scheduler.focus_is_active(conn, at(minutes=1)) is True
    pomodoro.stop(conn, discard=True, now=at(minutes=2))
    assert scheduler.focus_is_active(conn, at(minutes=3)) is False


# --------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------

def post(client, action, **body):
    return client.post(f"/api/pomodoro/{action}", json=body).json()


def test_api_full_flow(owner, v2_clock, v2_state):
    idle = owner.get("/api/pomodoro").json()
    assert idle["ok"] and idle["run"] is None and idle["active"] is False and idle["presets"][0]["id"] == "50-10-3"
    started = post(owner, "start", category="Python", label="numpy")
    assert started["ok"] and started["pomodoro"]["run"]["remaining_seconds"] == 3000
    assert post(owner, "start", category="Math")["code"] == "already_running"
    v2_clock.advance(minutes=10)
    paused = post(owner, "pause")
    assert paused["pomodoro"]["run"]["paused"] and paused["pomodoro"]["run"]["remaining_seconds"] == 2400
    assert post(owner, "pause")["code"] == "not_running"
    v2_clock.advance(minutes=30)
    assert post(owner, "resume")["pomodoro"]["run"]["remaining_seconds"] == 2400
    assert post(owner, "skip-break")["code"] == "not_on_break"
    v2_clock.advance(minutes=41)
    state = owner.get("/api/pomodoro").json()
    assert state["run"]["phase"] == "waiting" and state["awaiting_rating"] and state["active"]
    rated = post(owner, "rate", focus="full", note="done")
    assert rated["ok"] and rated["entry"]["minutes"] == 50 and rated["today"]["deep_minutes"] == 50 and rated["level"]["number"] >= 1
    assert rated["events"] and rated["toast"] and rated["pomodoro"]["awaiting_rating"] is False
    assert rated["pomodoro"]["run"]["phase"] == "break" and rated["pomodoro"]["run"]["remaining_seconds"] == 600     # rating starts the break
    assert post(owner, "rate", focus="full")["code"] == "nothing_to_rate"
    assert post(owner, "skip-break")["pomodoro"]["run"]["cycle"] == 2
    stopped = post(owner, "stop", discard=True)
    assert stopped["ok"] and stopped["pomodoro"]["active"] is False
    assert post(owner, "stop")["code"] == "not_running"


def test_api_start_validation(owner):
    assert post(owner, "start", category="Nope")["code"] == "bad_category"
    assert post(owner, "start")["code"] == "bad_category"
    assert post(owner, "start", category="Math", preset="custom", work_min=500, break_min=5, cycles=2)["code"] == "bad_custom"
    assert post(owner, "start", category="Math", preset="zzz")["code"] == "bad_preset"
    assert post(owner, "rate", focus="x")["code"] == "bad_focus"


def test_api_custom_run(owner):
    state = post(owner, "start", category="Math", preset="custom", work_min=20, break_min=4, cycles=2)["pomodoro"]
    assert state["run"]["preset"] == "custom" and state["run"]["phase_seconds"] == 1200


def test_old_focus_start_is_refused_during_a_run_and_old_stop_still_works(owner, v2_clock, db_path):
    post(owner, "start", category="Python", label="numpy")
    again = owner.post("/focus/start", data={"minutes": "25", "category": "Math"}, headers={"HX-Request": "true"})
    assert "already running" in again.text
    assert owner.get("/", follow_redirects=False).headers["location"] == "/pomodoro"   # Today is the room: a run sends you to your spot
    page = owner.get("/?home=1").text
    assert 'data-js="today-run"' in page and "numpy" in page and "hidden>" not in page.split('data-js="today-run"')[1].split(">")[0]   # Today's run card shows the run
    v2_clock.advance(minutes=20)
    stop = owner.post("/focus/stop", data={"outcome": "full"}, headers={"HX-Request": "true"})
    assert stop.status_code == 200
    with db.get_conn(db_path) as c:
        (entry,) = entries(c)
    assert entry["category"] == "Python" and entry["deep"] == 1 and entry["source"] == "focus" and entry["note"] == "numpy"
    assert owner.get("/api/pomodoro").json()["active"] is False


def test_old_api_focus_stop_rates_a_run(owner, v2_clock):
    post(owner, "start", category="Python")
    v2_clock.advance(minutes=30)
    body = owner.post("/api/focus/stop", json={"outcome": "full"}).json()
    assert body["ok"] and body["entry"]["minutes"] == 30


def test_today_context_has_the_state_and_the_pending_rating_shows_as_an_old_pill(owner, v2_clock):
    post(owner, "start", category="Python", label="numpy")
    v2_clock.advance(minutes=51)
    page = owner.get("/?home=1").text
    assert 'data-js="today-run"' in page and "1 to rate" in page


def test_form_fallback_flow(owner, v2_clock):
    page = owner.get("/pomodoro")
    assert page.status_code == 200 and 'data-js="pomodoro-state"' in page.text and 'action="/pomodoro/start"' in page.text
    r = owner.post("/pomodoro/start", data={"category": "Python", "label": "x", "preset": "25-5-4"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/pomodoro?msg=Started")
    assert "Pause" in owner.get("/pomodoro").text
    bad = owner.post("/pomodoro/start", data={"category": "Math"}, follow_redirects=False)
    assert "already+running" in bad.headers["location"] or "already%20running" in bad.headers["location"]
    owner.post("/pomodoro/pause")
    assert "Resume" in owner.get("/pomodoro").text
    owner.post("/pomodoro/resume")
    v2_clock.advance(minutes=26)
    html = owner.get("/pomodoro").text
    assert "How did the block go?" in html and 'name="focus"' in html
    rated = owner.post("/pomodoro/rate", data={"focus": "full"}, follow_redirects=False)
    assert rated.status_code == 303 and "logged" in rated.headers["location"].lower()
    owner.post("/pomodoro/stop", data={"discard": "1"})
    assert owner.get("/api/pomodoro").json()["active"] is False


def test_api_rate_is_idempotent_under_a_double_click(owner, v2_clock):
    post(owner, "start", category="Python")
    v2_clock.advance(minutes=51)
    first, second = post(owner, "rate", focus="full"), post(owner, "rate", focus="full")
    assert first["ok"] and second["ok"] is False
    assert owner.get("/api/today").json()["today"]["deep_minutes"] == 50


# --------------------------------------------------------------------------
# The stream
# --------------------------------------------------------------------------

def parse_sse(text):
    messages = []
    for chunk in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in chunk.splitlines() if ": " in line)
        if "event" in fields:
            messages.append((fields["event"], json.loads(fields["data"])))
    return messages


def test_stream_sends_the_state_first(owner, v2_clock):
    post(owner, "start", category="Python", label="numpy")
    with owner.stream("GET", "/api/stream?limit=1") as response:
        assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"].startswith("no-cache")
        body = "".join(response.iter_text())
    ((name, data),) = parse_sse(body)
    assert name == "pomodoro" and data["run"]["label"] == "numpy" and data["active"] and data["rev"]
    assert body.startswith("retry: 3000")


def test_stream_pushes_game_events_and_phase_changes(v2_state, v2_clock, monkeypatch):
    from epoch.web import app as webapp
    with db.get_conn(v2_state.db_path) as conn:
        pomodoro.start(conn, category="Python", preset="custom", work_min=5, break_min=1, cycles=2, now=v2_clock.now)

    async def scenario():
        gen = webapp._event_stream(v2_state, limit=0)
        out = [await gen.__anext__(), await gen.__anext__()]       # retry, first state
        live.publish_game_events([{"kind": "floor", "title": "Doors open"}], "2026-10-14T15:00:00Z")
        out.append(await asyncio.wait_for(gen.__anext__(), 5))
        monkeypatch.setattr(webapp.pomodoro, "next_change_in", lambda state: 0.0)
        v2_clock.advance(minutes=5, seconds=30)                      # the work block ends, the break has begun
        out.append(await asyncio.wait_for(gen.__anext__(), 5))
        await gen.aclose()
        return out

    out = asyncio.run(scenario())
    assert out[0].startswith("retry")
    assert parse_sse(out[1])[0][1]["run"]["phase"] == "work"
    game_name, game_data = parse_sse(out[2])[0]
    assert game_name == "game" and game_data["events"][0]["title"] == "Doors open" and game_data["origin"] is None
    name, data = parse_sse(out[3])[0]
    assert name == "pomodoro" and data["run"]["phase"] == "waiting" and data["awaiting_rating"]      # the block ended: the run holds
    assert live.hub.subscribers == 0                                 # unsubscribed when the stream closed


def test_stream_pings_when_idle(v2_state, monkeypatch):
    from epoch.web import app as webapp
    monkeypatch.setattr(webapp, "STREAM_PING_SECONDS", 0.05)

    async def scenario():
        gen = webapp._event_stream(v2_state, limit=3)
        return [chunk async for chunk in gen]

    out = asyncio.run(scenario())
    names = [parse_sse(c)[0][0] for c in out if "event:" in c]
    assert names[0] == "pomodoro" and "ping" in names


def test_game_events_from_normal_writes_reach_the_stream(owner, v2_state):
    from epoch.web import app as webapp

    async def scenario():
        gen = webapp._event_stream(v2_state, limit=0)
        await gen.__anext__(); await gen.__anext__()
        await asyncio.to_thread(owner.post, "/api/log", json={"text": "60m numpy"}, headers={"X-Witness-Client": "tab-1"})
        got = await asyncio.wait_for(gen.__anext__(), 5)
        await gen.aclose()
        return got

    name, data = parse_sse(asyncio.run(scenario()))[0]
    assert name == "game" and data["origin"] == "tab-1" and any(e["kind"] == "floor" for e in data["events"])


# --------------------------------------------------------------------------
# Races, sleep, gaps
# --------------------------------------------------------------------------

def test_two_screens_starting_together_make_one_run(db_path):
    import threading

    results = []
    gate = threading.Barrier(2)

    def go():
        with db.get_conn(db_path) as c:
            gate.wait()
            try:
                pomodoro.start(c, category="Python", now=T0)
                results.append("ok")
            except PomodoroError as exc:
                results.append(exc.code)

    for _ in range(15):
        with db.get_conn(db_path) as c:
            c.execute("UPDATE pomodoro_runs SET status = 'stopped'")
        results.clear()
        threads = [threading.Thread(target=go) for _ in range(2)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert sorted(results) == ["already_running", "ok"], results
    with db.get_conn(db_path) as c:
        assert c.execute("SELECT COUNT(*) FROM pomodoro_runs WHERE status IN ('running','paused')").fetchone()[0] == 1


def test_keepawake_never_spawns_two_processes_from_two_threads():
    import threading

    spawned = []

    def slow_popen(args):
        time.sleep(0.05)
        proc = FakeProc(args)
        spawned.append(proc)
        return proc

    keeper = pomodoro.KeepAwake(popen=slow_popen, platform="darwin")
    threads = [threading.Thread(target=keeper.hold) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    keeper.release()
    assert len(spawned) == 1 and spawned[0].terminated and not keeper.held


def test_a_sleeping_mac_pauses_the_run_instead_of_counting_the_sleep(conn, monkeypatch):
    clock = {"wall": 1_000_000.0}
    monkeypatch.setattr(pomodoro.time, "time", lambda: clock["wall"])
    pomodoro.start(conn, category="Python", now=T0)
    clock["wall"] += 60
    pomodoro.settle(conn, at(minutes=10))                  # last seen running at minute 10
    clock["wall"] += 3 * 3600                              # the lid closes for three hours
    state = pomodoro.get_state(conn, at(minutes=10, hours=3))
    run = state["run"]
    assert state["active"] and run["paused"] and run["away"] is True
    assert run["remaining_seconds"] == 3000 - 10 * 60 and state["pending_ratings"] == []
    resumed = pomodoro.resume(conn, at(minutes=10, hours=3, seconds=30))
    assert resumed["run"]["paused"] is False and resumed["run"]["away"] is False
    assert pomodoro.get_state(conn, at(minutes=10, hours=3, seconds=40))["run"]["paused"] is False


def _open_gaps(conn, end):
    tz, dsh = db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour")
    day = timeutil.local_date_of(T0, tz, dsh)
    start = T0.astimezone(timeutil.zone(tz)).strftime("%H:%M")
    return rules.gaps(conn, day, start_hhmm=start, end_utc=end)


def test_breaks_and_pauses_are_not_unlogged_gaps(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.pause(conn, at(minutes=20))
    pomodoro.resume(conn, at(minutes=35))                   # a 15 minute pause inside block 1
    pomodoro.settle(conn, at(minutes=65))                   # block 1 ends at 65 and the run holds
    pomodoro.rate(conn, focus="full", now=at(minutes=66))   # rated at 66: the break runs 66-76, block 2 76-126
    pomodoro.settle(conn, at(minutes=127))
    pomodoro.rate(conn, focus="full", now=at(minutes=128))
    assert len(entries(conn)) == 2
    assert _open_gaps(conn, at(minutes=126)) == []
    # the same entries without the run behind them would show the pause and the break as gaps
    conn.execute("DELETE FROM pomodoro_blocks")
    assert len(_open_gaps(conn, at(minutes=126))) == 2


def test_a_discarded_block_is_still_open_time(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=30, break_min=10, cycles=2, now=T0)
    pomodoro.settle(conn, at(minutes=31))                  # block 1 ends at 30 and the run holds
    pomodoro.rate(conn, focus="full", now=at(minutes=32))  # rated at 32: break 32-42, block 2 42-72
    pomodoro.settle(conn, at(minutes=75))
    first, second = [r["id"] for r in conn.execute("SELECT id FROM pomodoro_blocks ORDER BY id")]
    pomodoro.discard_block(conn, second, now=at(minutes=76))
    found = _open_gaps(conn, at(minutes=72))
    assert [(a, b) for a, b in found] == [(at(minutes=42), at(minutes=72))]       # the break is rest; the dropped block is open


def test_a_rated_focus_block_unlocks_in_the_zone(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=25, break_min=5, cycles=1, now=T0)
    pomodoro.settle(conn, at(minutes=26))
    result = pomodoro.rate(conn, focus="full", now=at(minutes=27))
    names = [e.get("name") or e.get("title") or str(e) for e in result["events"]]
    assert any("In the Zone" in n for n in names), result["events"]
    assert conn.execute("SELECT 1 FROM unlocks WHERE key = 'ach:first_focus'").fetchone() is not None


def test_api_discard_and_form_discard_and_honest_summary(owner, v2_clock):
    post(owner, "start", category="Python", preset="custom", work_min=5, break_min=1, cycles=2)
    v2_clock.advance(minutes=6)
    state = owner.get("/api/pomodoro").json()
    assert len(state["pending_ratings"]) == 1
    dropped = post(owner, "discard", block_id=state["pending_ratings"][0]["block_id"])
    assert dropped["ok"] and dropped["pomodoro"]["pending_ratings"] == []
    assert post(owner, "discard")["code"] == "nothing_to_rate"
    stop = post(owner, "stop", discard=True)["pomodoro"]
    assert stop["run"]["status"] == "stopped" and stop["run"]["blocks_kept"] == 0
    page = owner.get("/pomodoro").text
    assert "Nothing was logged from this run." in page and "The time you did is kept." not in page
    assert 'formaction="/pomodoro/discard"' in page


def test_the_focus_screen_says_so_when_a_telegram_session_is_running(owner, db_path):
    page = owner.get("/pomodoro").text
    assert 'data-js="legacy-note" hidden' in page
    with db.get_conn(db_path) as c:
        c.execute("INSERT INTO focus_sessions(start_utc, planned_minutes, category) VALUES (?, 25, 'Python')", (timeutil.to_iso(T0),))
    page = owner.get("/pomodoro").text
    assert 'data-js="legacy-note" hidden' not in page and "(started on the Focus page or in Telegram) is still running" in page
    assert post(owner, "start", category="Math")["code"] == "legacy_running"
