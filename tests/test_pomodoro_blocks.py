"""The Pomodoro hold after a block, "+5 min" on work and break, and the Custom rhythm.

The bug these guard: the break used to start the moment a work block ended, while the end-of-block card was still
open, so a person who took 14 minutes to answer it found a 15 minute break with 1 minute left.
"""
from __future__ import annotations

import sqlite3
from datetime import timedelta

import pytest

from epoch import db, game, pomodoro, timeutil
from epoch.pomodoro import PomodoroError

T0 = timeutil.from_iso("2026-10-14T15:00:00Z")


def at(**delta):
    return T0 + timedelta(**delta)


def run_of(state):
    return state["run"]


def entries(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM entries WHERE deleted = 0 ORDER BY id")]


def blocks(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM pomodoro_blocks ORDER BY id")]


def post(client, action, **body):
    return client.post(f"/api/pomodoro/{action}", json=body).json()


def start_90(conn, now=T0, cycles=2):
    return pomodoro.start(conn, category="Math", label="linear algebra", preset="custom", work_min=90, break_min=15, cycles=cycles, now=now)


# --------------------------------------------------------------------------
# 1. The break starts only when the person is done with the block
# --------------------------------------------------------------------------

def test_the_real_bug_a_break_with_1_minute_left_can_not_happen(conn):
    """Run 3 of the real data: block ended 14:41:50, rated 14:55:35. The break used to run 14:41:50-14:56:50."""
    start_90(conn)
    ended = at(minutes=90)
    state = pomodoro.get_state(conn, ended + timedelta(seconds=1))
    assert run_of(state)["phase"] == "waiting" and run_of(state)["remaining_seconds"] == 0
    rated_at = ended + timedelta(minutes=13, seconds=45)
    result = pomodoro.rate(conn, focus="full", now=rated_at)
    run = run_of(result["pomodoro"])
    assert run["phase"] == "break" and run["remaining_seconds"] == 15 * 60          # the whole break, from the moment of the rating
    assert run["phase_ends_at"] == timeutil.to_iso(rated_at + timedelta(minutes=15))


def test_nothing_ticks_while_the_card_is_open_however_long(conn):
    start_90(conn)
    for minutes in (91, 120, 300, 24 * 60):
        run = run_of(pomodoro.get_state(conn, at(minutes=minutes)))
        assert (run["status"], run["phase"], run["remaining_seconds"], run["cycle"]) == ("waiting", "waiting", 0, 1)
    assert len(blocks(conn)) == 1                                                  # one block, however often it is looked at


def test_rating_starts_the_break_at_the_moment_of_the_rating(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    pomodoro.rate(conn, focus="mostly", now=at(minutes=100))
    run = run_of(pomodoro.get_state(conn, at(minutes=100)))
    assert run["phase"] == "break" and run["phase_ends_at"] == "2026-10-14T16:55:00Z"
    assert run_of(pomodoro.get_state(conn, at(minutes=114)))["phase"] == "break"
    assert run_of(pomodoro.get_state(conn, at(minutes=115)))["phase"] == "work"     # a finished break starts the next block by itself
    assert run_of(pomodoro.get_state(conn, at(minutes=115)))["cycle"] == 2


def test_dropping_the_block_starts_the_break_too(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    state = pomodoro.discard_block(conn, now=at(minutes=92))
    assert run_of(state)["phase"] == "break" and run_of(state)["remaining_seconds"] == 15 * 60
    assert state["pending_ratings"] == [] and entries(conn) == []


def test_start_break_without_rating_keeps_the_block_to_rate_later(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    state = pomodoro.start_next(conn, at(minutes=95))
    assert run_of(state)["phase"] == "break" and run_of(state)["remaining_seconds"] == 15 * 60
    assert len(state["pending_ratings"]) == 1 and run_of(state)["waiting"] is None
    # rating it later does not move the run (it is on its break)
    after = pomodoro.rate(conn, focus="full", now=at(minutes=100))["pomodoro"]
    assert run_of(after)["phase"] == "break" and run_of(after)["phase_ends_at"] == "2026-10-14T16:50:00Z"
    assert entries(conn)[0]["end_utc"] == "2026-10-14T16:30:00Z"


def test_rating_an_older_left_over_block_does_not_end_the_hold_of_the_new_one(conn):
    start_90(conn, cycles=3)
    pomodoro.start_next(conn, at(minutes=90))              # block 1 left for later; break 90-105, block 2 105-195
    pomodoro.settle(conn, at(minutes=200))
    first, second = [b["id"] for b in blocks(conn)]
    state = pomodoro.rate(conn, focus="full", block_id=first, now=at(minutes=201))["pomodoro"]
    assert run_of(state)["phase"] == "waiting" and run_of(state)["waiting"]["block_id"] == second
    state = pomodoro.rate(conn, focus="full", block_id=second, now=at(minutes=202))["pomodoro"]
    assert run_of(state)["phase"] == "break"


def test_start_next_errors(conn):
    with pytest.raises(PomodoroError) as exc:
        pomodoro.start_next(conn, T0)
    assert exc.value.code == "not_running"
    start_90(conn)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.start_next(conn, at(minutes=10))          # still working
    assert exc.value.code == "not_waiting"


def test_a_zero_minute_break_still_waits_for_you_then_starts_the_next_block(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=25, break_min=0, cycles=2, now=T0)
    run = run_of(pomodoro.get_state(conn, at(minutes=26)))
    assert run["phase"] == "waiting" and run["next"] == {"phase": "work", "seconds": 1500}
    state = pomodoro.start_next(conn, at(minutes=30))
    assert run_of(state)["phase"] == "work" and run_of(state)["cycle"] == 2 and run_of(state)["phase_ends_at"] == "2026-10-14T15:55:00Z"


def test_the_last_block_rated_finishes_the_run(conn):
    start_90(conn, cycles=1)
    pomodoro.settle(conn, at(minutes=95))
    assert run_of(pomodoro.get_state(conn, at(minutes=96)))["last"] is True
    state = pomodoro.rate(conn, focus="full", now=at(minutes=97))["pomodoro"]
    run = run_of(state)
    assert state["active"] is False and run["status"] == "finished" and run["phase"] == "done"


def test_stopping_while_holding_adds_no_second_block(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=91))
    state = pomodoro.stop(conn, now=at(minutes=100))
    assert state["active"] is False and len(blocks(conn)) == 1 and blocks(conn)[0]["partial"] == 0
    assert state["pending_ratings"][0]["minutes"] == 90


def test_pause_and_resume_do_nothing_while_holding(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=91))
    with pytest.raises(PomodoroError) as exc:
        pomodoro.pause(conn, at(minutes=92))
    assert exc.value.code == "not_running"
    with pytest.raises(PomodoroError) as exc:
        pomodoro.resume(conn, at(minutes=92))
    assert exc.value.code == "not_paused"


def test_housekeeping_closes_a_run_nobody_answered_for_three_hours_but_keeps_the_block(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=91))
    assert pomodoro.housekeeping(conn, at(minutes=90 + 170)) is False and pomodoro.is_active(conn)
    assert pomodoro.housekeeping(conn, at(minutes=90 + 190)) is True
    state = pomodoro.get_state(conn, at(minutes=90 + 191))
    assert state["active"] is False and run_of(state)["status"] == "stopped" and len(state["pending_ratings"]) == 1


def test_housekeeping_after_the_last_block_counts_the_run_as_finished(conn):
    start_90(conn, cycles=1)
    pomodoro.settle(conn, at(minutes=91))
    pomodoro.housekeeping(conn, at(minutes=90 + 190))
    assert run_of(pomodoro.get_state(conn, at(minutes=90 + 191)))["status"] == "finished"


def test_keepawake_is_released_while_holding_and_taken_again_on_start_break(conn, monkeypatch):
    from test_pomodoro import fake_keepawake
    keeper, spawned = fake_keepawake()
    monkeypatch.setattr(pomodoro, "keepawake", keeper)
    start_90(conn)
    assert keeper.held
    pomodoro.get_state(conn, at(minutes=91))
    assert not keeper.held
    pomodoro.start_next(conn, at(minutes=92))
    assert keeper.held


# --------------------------------------------------------------------------
# 2. "+5 min" on a work block
# --------------------------------------------------------------------------

def test_extend_work_adds_minutes_and_moves_the_end(conn):
    pomodoro.start(conn, category="Python", now=T0)
    state = pomodoro.extend(conn, 5, at(minutes=10))
    run = run_of(state)
    assert run["phase_seconds"] == 3300 and run["extra_seconds"] == 300 and run["base_seconds"] == 3000
    assert run["remaining_seconds"] == 2700 and run["phase_ends_at"] == "2026-10-14T15:55:00Z" and run["status"] == "running"
    state = pomodoro.extend(conn, 10, at(minutes=20))
    assert run_of(state)["phase_seconds"] == 3900 and run_of(state)["phase_ends_at"] == "2026-10-14T16:05:00Z"
    assert run_of(pomodoro.get_state(conn, at(minutes=64)))["phase"] == "work"
    assert run_of(pomodoro.get_state(conn, at(minutes=65)))["phase"] == "waiting"


def test_extended_minutes_count_fully_in_the_block_and_the_entry(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=30, break_min=5, cycles=2, now=T0)
    pomodoro.extend(conn, 10, at(minutes=29))
    pomodoro.settle(conn, at(minutes=41))
    (block,) = blocks(conn)
    assert block["worked_s"] == 2400 and block["started_utc"] == "2026-10-14T15:00:00Z" and block["ended_utc"] == "2026-10-14T15:40:00Z"
    result = pomodoro.rate(conn, focus="full", now=at(minutes=42))
    assert result["entry"]["minutes"] == 40
    (row,) = entries(conn)
    assert row["start_utc"] == "2026-10-14T15:00:00Z" and row["end_utc"] == "2026-10-14T15:40:00Z" and row["deep"] == 1
    assert result["pomodoro"]["pending_ratings"] == []


def test_extend_while_paused_keeps_it_paused(conn):
    pomodoro.start(conn, category="Python", now=T0)
    pomodoro.pause(conn, at(minutes=10))
    state = pomodoro.extend(conn, 5, at(minutes=20))
    run = run_of(state)
    assert run["paused"] and run["remaining_seconds"] == 2400 + 300 and run["phase_ends_at"] is None


def test_extend_resets_for_the_next_phase(conn):
    pomodoro.start(conn, category="Python", preset="custom", work_min=30, break_min=5, cycles=2, now=T0)
    pomodoro.extend(conn, 5, at(minutes=1))                   # block 1 is 35 min
    pomodoro.settle(conn, at(minutes=36))
    pomodoro.rate(conn, focus="full", now=at(minutes=36))
    run = run_of(pomodoro.get_state(conn, at(minutes=36)))
    assert run["phase"] == "break" and run["phase_seconds"] == 300 and run["extra_seconds"] == 0
    run = run_of(pomodoro.get_state(conn, at(minutes=41)))
    assert run["phase"] == "work" and run["phase_seconds"] == 1800 and run["extra_seconds"] == 0


@pytest.mark.parametrize("minutes", [0, -5, 61, "abc", None, ""])
def test_extend_rejects_silly_amounts(conn, minutes):
    pomodoro.start(conn, category="Python", now=T0)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.extend(conn, minutes, at(minutes=1))
    assert exc.value.code == "bad_minutes"


def test_extend_has_a_ceiling_and_needs_a_run(conn):
    with pytest.raises(PomodoroError) as exc:
        pomodoro.extend(conn, 5, T0)
    assert exc.value.code == "not_running"
    pomodoro.start(conn, category="Python", preset="custom", work_min=240, break_min=0, cycles=1, now=T0)
    for _ in range(4):
        pomodoro.extend(conn, 60, at(minutes=1))              # 240 + 240 = 8 hours is the most a block can be
    with pytest.raises(PomodoroError) as exc:
        pomodoro.extend(conn, 5, at(minutes=1))
    assert exc.value.code == "too_long"
    assert run_of(pomodoro.get_state(conn, at(minutes=2)))["phase_seconds"] == 480 * 60


# --------------------------------------------------------------------------
# 3. "Keep going" from the end-of-block card
# --------------------------------------------------------------------------

def test_keep_going_folds_the_unrated_block_back_into_a_longer_one(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    assert len(blocks(conn)) == 1
    state = pomodoro.extend(conn, 10, at(minutes=91))         # tapped "+10" on the card a minute after the block ended
    run = run_of(state)
    assert run["phase"] == "work" and run["status"] == "running" and run["cycle"] == 1
    assert run["remaining_seconds"] == 600 and run["phase_ends_at"] == "2026-10-14T16:41:00Z" and run["phase_seconds"] == 6000
    assert state["pending_ratings"] == [] and blocks(conn) == []             # no duplicate block: it comes back as one
    pomodoro.settle(conn, at(minutes=102))
    (block,) = blocks(conn)
    assert block["worked_s"] == 6000 and block["started_utc"] == "2026-10-14T15:01:00Z"
    result = pomodoro.rate(conn, focus="full", now=at(minutes=103))
    assert result["entry"]["minutes"] == 100 and result["pomodoro"]["run"]["phase"] == "break"     # 90 + 10 minutes, one entry


def test_keep_going_can_be_used_more_than_once(conn):
    start_90(conn, cycles=1)
    pomodoro.settle(conn, at(minutes=90))
    pomodoro.extend(conn, 5, at(minutes=90))
    pomodoro.settle(conn, at(minutes=95))
    pomodoro.extend(conn, 15, at(minutes=96))
    pomodoro.settle(conn, at(minutes=111))
    (block,) = blocks(conn)
    assert block["worked_s"] == (90 + 5 + 15) * 60
    assert pomodoro.rate(conn, focus="full", now=at(minutes=112))["entry"]["minutes"] == 110


def test_keep_going_on_a_block_that_is_already_logged_is_refused(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    conn.execute("UPDATE pomodoro_blocks SET status = 'rated'")              # (rating normally moves the run on at once)
    with pytest.raises(PomodoroError) as exc:
        pomodoro.extend(conn, 5, at(minutes=91))
    assert exc.value.code == "already_logged"


# --------------------------------------------------------------------------
# 4. A longer break
# --------------------------------------------------------------------------

def test_extend_break_adds_to_the_break_and_shows_the_total(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    pomodoro.rate(conn, focus="full", now=at(minutes=91))                     # break 91-106
    state = pomodoro.extend(conn, 5, at(minutes=100))
    run = run_of(state)
    assert run["phase"] == "break" and run["phase_seconds"] == 20 * 60 and run["base_seconds"] == 15 * 60 and run["extra_seconds"] == 300
    assert run["remaining_seconds"] == 11 * 60 and run["phase_ends_at"] == "2026-10-14T16:51:00Z"
    state = pomodoro.extend(conn, 10, at(minutes=101))
    assert run_of(state)["phase_seconds"] == 30 * 60 and run_of(state)["phase_ends_at"] == "2026-10-14T17:01:00Z"
    assert run_of(pomodoro.get_state(conn, at(minutes=120)))["phase"] == "break"
    assert run_of(pomodoro.get_state(conn, at(minutes=121)))["phase"] == "work"                 # 91 + 30 minutes of rest


def test_a_break_has_its_own_ceiling_and_can_be_ended_early(conn):
    start_90(conn)
    pomodoro.settle(conn, at(minutes=90))
    pomodoro.rate(conn, focus="full", now=at(minutes=91))
    pomodoro.extend(conn, 60, at(minutes=92))
    with pytest.raises(PomodoroError) as exc:
        pomodoro.extend(conn, 60, at(minutes=93))                              # 15 + 60 + 60 > 2 hours
    assert exc.value.code == "too_long"
    state = pomodoro.skip_break(conn, at(minutes=100))                         # "End break early"
    run = run_of(state)
    assert run["phase"] == "work" and run["cycle"] == 2 and run["extra_seconds"] == 0 and run["phase_seconds"] == 5400


# --------------------------------------------------------------------------
# 5. Custom blocks, remembered
# --------------------------------------------------------------------------

def test_custom_numbers_are_used_and_remembered_for_next_time(conn):
    first = pomodoro.get_state(conn, T0)
    assert first["custom"] == {"work_min": 50, "break_min": 10, "cycles": 3}     # nothing remembered: the default preset's numbers
    state = pomodoro.start(conn, category="Math", preset="custom", work_min=45, break_min=7, cycles=4, now=T0)
    run = run_of(state)
    assert (run["work_min"], run["break_min"], run["cycles"], run["preset"]) == (45, 7, 4, "custom")
    assert run["phase_seconds"] == 2700 and state["custom"] == {"work_min": 45, "break_min": 7, "cycles": 4}
    assert state["default_preset"] == "custom"
    pomodoro.stop(conn, discard=True, now=at(seconds=30))
    # a preset run in between does not forget the custom numbers
    pomodoro.start(conn, category="Math", preset="25-5-4", now=at(minutes=1))
    state = pomodoro.stop(conn, discard=True, now=at(minutes=2))
    assert pomodoro.get_state(conn, at(minutes=3))["custom"] == {"work_min": 45, "break_min": 7, "cycles": 4}
    assert pomodoro.get_state(conn, at(minutes=3))["default_preset"] == "25-5-4"


def test_custom_starts_from_the_last_preset_used_until_there_are_own_numbers(conn):
    pomodoro.start(conn, category="Math", preset="90-15-2", now=T0)
    pomodoro.stop(conn, discard=True, now=at(seconds=30))
    assert pomodoro.get_state(conn, at(minutes=1))["custom"] == {"work_min": 90, "break_min": 15, "cycles": 2}


def test_custom_limits_are_exact(conn):
    ok = [(1, 0, 1), (240, 60, 8), (90, 15, 2)]
    for work, brk, cycles in ok:
        pomodoro.start(conn, category="Math", preset="custom", work_min=work, break_min=brk, cycles=cycles, now=T0)
        pomodoro.stop(conn, discard=True, now=at(seconds=1))
    assert pomodoro.CUSTOM_LIMITS == {"work_min": (1, 240), "break_min": (0, 60), "cycles": (1, 8)}
    bad = [(0, 5, 2, "Work minutes"), (241, 5, 2, "Work minutes"), (25, -1, 2, "Break minutes"), (25, 61, 2, "Break minutes"),
           (25, 5, 0, "Blocks"), (25, 5, 9, "Blocks"), ("x", 5, 2, "Work minutes"), (25, "", 2, "Break minutes"), (25.5, 5, 2, "Work minutes")]
    for work, brk, cycles, label in bad:
        with pytest.raises(PomodoroError) as exc:
            pomodoro.start(conn, category="Math", preset="custom", work_min=work, break_min=brk, cycles=cycles, now=T0)
        assert exc.value.code == "bad_custom" and exc.value.hint.startswith(label)
    assert pomodoro.get_state(conn, T0)["custom"] == {"work_min": 90, "break_min": 15, "cycles": 2}      # a refused start remembers nothing


def test_bad_custom_numbers_in_settings_fall_back(conn):
    db.set_setting(conn, "pomodoro_custom", {"work_min": 9999, "break_min": "abc", "cycles": 3})
    assert pomodoro.custom_defaults(conn) == {"work_min": 50, "break_min": 10, "cycles": 3}
    db.set_setting(conn, "pomodoro_custom", "nonsense")
    assert pomodoro.custom_defaults(conn) == {"work_min": 50, "break_min": 10, "cycles": 3}


def test_the_state_tells_the_screen_the_limits_and_the_extend_choices(conn):
    state = pomodoro.get_state(conn, T0)
    assert state["limits"] == {"work_min": [1, 240], "break_min": [0, 60], "cycles": [1, 8]} and state["extend_choices"] == [5, 10, 15]


# --------------------------------------------------------------------------
# An older database (made before "+5 min") gets its column
# --------------------------------------------------------------------------

def test_an_old_database_without_extra_s_is_upgraded_in_place(tmp_path):
    path = tmp_path / "old.db"
    db.init_db(path, today=timeutil.local_date_of(T0, "Asia/Kolkata"))
    with db.get_conn(path) as c:
        c.execute("ALTER TABLE pomodoro_runs DROP COLUMN extra_s")
        assert "extra_s" not in [r["name"] for r in c.execute("PRAGMA table_info(pomodoro_runs)")]
        pomodoro._SCHEMA_OK.discard(str(path.resolve()))
        pomodoro._SCHEMA_OK.discard(str(path))
        state = pomodoro.start(c, category="Python", now=T0)
        assert run_of(state)["extra_seconds"] == 0
        assert "extra_s" in [r["name"] for r in c.execute("PRAGMA table_info(pomodoro_runs)")]


def test_a_run_that_was_running_before_the_upgrade_holds_after_it(tmp_path):
    """The live app is restarted mid-block: the finished block now holds instead of silently starting the break."""
    path = tmp_path / "mid.db"
    db.init_db(path, today=timeutil.local_date_of(T0, "Asia/Kolkata"))
    with db.get_conn(path) as c:
        pomodoro.start(c, category="Python", now=T0)
        assert run_of(pomodoro.get_state(c, at(minutes=60)))["phase"] == "waiting"


# --------------------------------------------------------------------------
# HTTP: API and plain forms
# --------------------------------------------------------------------------

def test_api_break_waits_for_the_rating_then_extends(owner, v2_clock):
    post(owner, "start", category="Math", preset="custom", work_min=30, break_min=10, cycles=2)
    v2_clock.advance(minutes=31)
    state = owner.get("/api/pomodoro").json()
    assert state["run"]["phase"] == "waiting" and state["run"]["waiting"]["unrated"] is True and state["active"]
    v2_clock.advance(minutes=20)                                                  # the card sat open for 20 minutes
    assert owner.get("/api/pomodoro").json()["run"]["phase"] == "waiting"
    rated = post(owner, "rate", focus="full")
    assert rated["pomodoro"]["run"]["phase"] == "break" and rated["pomodoro"]["run"]["remaining_seconds"] == 600
    more = post(owner, "extend", minutes=5)
    assert more["ok"] and more["pomodoro"]["run"]["remaining_seconds"] == 900 and more["pomodoro"]["run"]["extra_seconds"] == 300
    assert post(owner, "extend", minutes=0)["code"] == "bad_minutes"
    assert post(owner, "next")["code"] == "not_waiting"


def test_api_keep_going_and_start_break_without_rating(owner, v2_clock):
    post(owner, "start", category="Math", preset="custom", work_min=30, break_min=10, cycles=2)
    v2_clock.advance(minutes=31)
    kept = post(owner, "extend", minutes=15)
    assert kept["ok"] and kept["pomodoro"]["run"]["phase"] == "work" and kept["pomodoro"]["run"]["remaining_seconds"] == 15 * 60
    v2_clock.advance(minutes=16)
    assert owner.get("/api/pomodoro").json()["pending_ratings"][0]["minutes"] == 45
    started = post(owner, "next")
    assert started["ok"] and started["pomodoro"]["run"]["phase"] == "break" and len(started["pomodoro"]["pending_ratings"]) == 1


def test_api_custom_values_persist_and_come_back_on_the_page(owner):
    assert post(owner, "start", category="Math", preset="custom", work_min=90, break_min=15, cycles=2)["ok"]
    post(owner, "stop", discard=True)
    state = owner.get("/api/pomodoro").json()
    assert state["custom"] == {"work_min": 90, "break_min": 15, "cycles": 2} and state["default_preset"] == "custom"
    html = owner.get("/pomodoro?new=1").text
    assert 'name="work_min"' in html and 'value="90"' in html and 'name="break_min"' in html and 'name="cycles"' in html
    assert 'value="custom" checked' in html or 'value="custom"' in html and "checked" in html.split('value="custom"')[1].split(">")[0]
    assert 'min="1" max="240"' in html and 'min="0" max="60"' in html and 'min="1" max="8"' in html
    assert "Custom" in html and "set your own" in html


def test_api_custom_limits(owner):
    assert post(owner, "start", category="Math", preset="custom", work_min=241, break_min=5, cycles=2)["code"] == "bad_custom"
    assert post(owner, "start", category="Math", preset="custom", work_min=25, break_min=61, cycles=2)["code"] == "bad_custom"
    assert post(owner, "start", category="Math", preset="custom", work_min=25, break_min=5, cycles=9)["code"] == "bad_custom"
    assert post(owner, "start", category="Math", preset="custom", work_min=25, break_min=5)["code"] == "bad_custom"


def test_forms_work_without_javascript(owner, v2_clock):
    r = owner.post("/pomodoro/start", data={"category": "Math", "preset": "custom", "work_min": "30", "break_min": "5", "cycles": "2"}, follow_redirects=False)
    assert r.status_code == 303 and "Started" in r.headers["location"]
    r = owner.post("/pomodoro/extend", data={"minutes": "10"}, follow_redirects=False)
    assert r.status_code == 303 and "Added" in r.headers["location"] and "10" in r.headers["location"]
    assert owner.get("/api/pomodoro").json()["run"]["phase_seconds"] == 2400
    v2_clock.advance(minutes=41)
    html = owner.get("/pomodoro").text
    assert 'data-state="between"' in html and 'action="/pomodoro/next"' in html and "Start 5 min break" in html
    assert "Block done" in html and 'formaction="/pomodoro/next"' in html
    bad = owner.post("/pomodoro/next", follow_redirects=False)
    assert bad.status_code == 303
    r = owner.post("/pomodoro/next", follow_redirects=False)                      # second tap: already on the break
    assert r.status_code == 303 and "warn" in r.headers["location"]
    assert owner.get("/api/pomodoro").json()["run"]["phase"] == "break"


def test_the_card_offers_keep_going_for_the_block_the_run_holds_and_the_break_row_has_two_choices(owner, v2_clock):
    post(owner, "start", category="Math", preset="custom", work_min=30, break_min=10, cycles=2)
    v2_clock.advance(minutes=31)
    html = owner.get("/pomodoro").text
    keep = html.split('data-js="rate-keep"')[1].split("</div>\n      <div")[0]
    assert 'hidden' not in html.split('data-js="rate-keep"')[1].split(">")[0]
    for m in (5, 10, 15):
        assert f'form="keepForm" name="minutes" value="{m}"' in keep
    assert 'id="keepForm"' in html and "Start my break, rate later" in html


def test_pages_copy_has_no_banned_words(owner, v2_clock):
    post(owner, "start", category="Math", preset="custom", work_min=30, break_min=10, cycles=2)
    pages = [owner.get("/pomodoro").text]
    v2_clock.advance(minutes=31)
    pages.append(owner.get("/pomodoro").text)
    for page in pages:
        text = page.split("<body", 1)[1]
        assert not game.has_banned_words(text.replace("data-", " "))


def test_stream_pushes_a_state_when_the_break_is_extended(v2_state, v2_clock):
    import asyncio
    import json
    from epoch.web import app as webapp
    with db.get_conn(v2_state.db_path) as conn:
        pomodoro.start(conn, category="Math", preset="custom", work_min=30, break_min=10, cycles=2, now=v2_clock.now)

    def parse(text):
        fields = dict(line.split(": ", 1) for line in text.strip().splitlines() if ": " in line)
        return fields["event"], json.loads(fields["data"])

    async def scenario():
        gen = webapp._event_stream(v2_state, limit=0)
        out = [await gen.__anext__(), await gen.__anext__()]
        with db.get_conn(v2_state.db_path) as conn:
            pomodoro.extend(conn, 5, v2_clock.now)
        out.append(await asyncio.wait_for(gen.__anext__(), 5))
        await gen.aclose()
        return out

    out = asyncio.run(scenario())
    name, data = parse(out[2])
    assert name == "pomodoro" and data["run"]["extra_seconds"] == 300 and data["run"]["phase_seconds"] == 2100
