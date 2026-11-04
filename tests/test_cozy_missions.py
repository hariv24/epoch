"""Daily missions (docs/COZY.md 4.6): the pool, the date-seeded pick (one per tier, never yesterday's set, never an impossible one),
adaptive amounts, live progress from the honest counters, the day frozen at first use, and a mission seen done staying done."""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from epoch import categories, cozy, db, economy, game, rules, timeutil
from epoch import economy_catalog as cat

TZ = "Asia/Kolkata"
D = lambda n: date(2026, 10, 5) + timedelta(days=n)        # noqa: E731 - D(0) = Mon Oct 5, D(10) = Thu Oct 15
AT = lambda d, hhmm: timeutil.at_local(d, hhmm, TZ, 4)     # noqa: E731
TIERS = {m["id"]: m["tier"] for m in cat.MISSIONS}


def add(conn, d, minutes, hhmm="08:00", category="Python", deep=True):
    start = AT(d, hhmm)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), category, deep, "live", "work")


def add_block(conn, d, hhmm, minutes, focus="full", status="rated", spot="butler"):
    start = AT(d, hhmm)
    end = start + timedelta(minutes=minutes)
    stamp, e = timeutil.to_iso(start), timeutil.to_iso(end)
    cur = conn.execute(
        "INSERT INTO pomodoro_runs(preset, work_s, break_s, cycles, category, label, started_utc, status, phase_idx, phase_start_utc, "
        "phase_elapsed_s, resumed_utc, ended_utc, spot) VALUES ('custom', ?, 300, 1, 'Python', NULL, ?, 'finished', 0, ?, 0, NULL, ?, ?)",
        (minutes * 60, stamp, stamp, e, spot))
    conn.execute("INSERT INTO pomodoro_blocks(run_id, cycle, started_utc, ended_utc, worked_s, partial, status, focus, category) "
                 "VALUES (?, 1, ?, ?, ?, 0, ?, ?, 'Python')", (cur.lastrowid, stamp, e, minutes * 60, status, focus))


def ev(conn, mission_id, day, params=None, now=None):
    e = economy._E(conn, today=day, now=now or AT(day, "21:00"))
    return cozy.progress(e, {"id": mission_id, "params": params or {}}, day)


def hist(**over):
    base = {"median_deep": None, "categories_7d": {c: 0 for c in categories.LADDER}, "spots_open": 3, "yesterday_ids": None,
            "ship_it_days_this_week": 0, "mark": None, "last_spot": "butler", "early_ok": True, "noon_ok": True}
    base.update(over)
    return base


# --------------------------------------------------------------------------
# The pool and the numbers
# --------------------------------------------------------------------------

def test_the_pool_has_thirteen_missions_in_three_tiers():
    assert len(cat.MISSIONS) == 13 and len({m["id"] for m in cat.MISSIONS}) == 13
    assert [sum(1 for m in cat.MISSIONS if m["tier"] == t) for t in cat.MISSION_TIERS] == [4, 5, 4]
    assert {m["id"] for m in cat.MISSIONS if m["tier"] == "easy"} == {"early_bird", "one_block", "full_focus", "doors_by_noon"}
    assert {m["id"] for m in cat.MISSIONS if m["tier"] == "stretch"} == {"crown", "long_block", "deep_stretch", "ship_it"}
    for m in cat.MISSIONS:
        assert not game.has_banned_words(m["text"] + " " + m["done_text"])


@pytest.mark.parametrize("median, expected", [
    (None, (60, 120)),          # no history yet
    (100, (75, 120)),           # 0.8 x 100 = 80 -> 75, 1.2 x 100 = 120
    (30, (45, 90)),             # both clamp up
    (400, (180, 300)),          # both clamp down
    (62, (45, 90)),             # 49.6 -> 45; 74.4 -> 75 -> clamp 90
    (150, (120, 180)),
    (105, (90, 120)),           # 84 -> 90, 126 -> 120 (nearest multiple of 15)
])
def test_adaptive_amounts_round_to_fifteen_and_clamp(median, expected):
    assert cozy.adaptive_amounts(median) == expected


def test_duration_words_are_plain():
    assert [cozy.duration_words(m) for m in (45, 60, 90, 120, 150)] == ["45 minutes", "1 hour", "1 hour 30 minutes", "2 hours", "2 hours 30 minutes"]


# --------------------------------------------------------------------------
# The pick
# --------------------------------------------------------------------------

def test_the_pick_is_deterministic_has_one_per_tier_and_never_repeats_yesterdays_set():
    yesterday = None
    seen = set()
    for n in range(120):
        d = D(n)
        a = cozy.pick_missions(d, hist(yesterday_ids=yesterday))
        b = cozy.pick_missions(d, hist(yesterday_ids=yesterday))
        assert a == b                                                  # the same date and history give the same three
        ids = [m["id"] for m in a]
        assert [TIERS[i] for i in ids] == ["easy", "medium", "stretch"] and len(set(ids)) == 3
        assert set(ids) != yesterday
        assert not any(c <= set(ids) for c in cat.MISSION_CONFLICTS)   # never two that overlap
        yesterday = set(ids)
        seen |= set(ids)
    assert seen == {m["id"] for m in cat.MISSIONS}                       # over a few months every mission turns up


def test_different_dates_give_different_picks():
    picks = {tuple(m["id"] for m in cozy.pick_missions(D(n), hist())) for n in range(40)}
    assert len(picks) > 10


def test_amounts_in_the_pick_come_from_the_history():
    for n in range(200):
        for m in cozy.pick_missions(D(n), hist(median_deep=100)):
            if m["id"] == "deep_n":
                assert m["params"] == {"n": 75}
            if m["id"] == "deep_stretch":
                assert m["params"] == {"n": 120}
    ids = {m["id"]: m for n in range(200) for m in cozy.pick_missions(D(n), hist())}
    assert ids["deep_n"]["params"]["n"] == 60 and ids["deep_stretch"]["params"]["n"] == 120      # before any history


def test_math_hour_names_the_least_studied_ladder_of_the_last_week():
    totals = {"Python": 300, "Math": 40, "ML/DL": 200, "Papers": 0, "Writing/X": 90}
    found = [m for n in range(200) for m in cozy.pick_missions(D(n), hist(categories_7d=totals)) if m["id"] == "math_hour"]
    assert found and all(m["params"]["category"] == "Papers" for m in found)
    assert cozy.mission_text(found[0])[0] == "An hour of Papers"


def test_an_impossible_mission_is_never_offered():
    cases = [
        ("early_bird", hist(early_ok=False)), ("early_bird", hist(late_early=True)),
        ("doors_by_noon", hist(noon_ok=False)), ("doors_by_noon", hist(late_doors=True)),
        ("new_spot", hist(spots_open=1)), ("ship_it", hist(ship_it_days_this_week=2)),
        ("crown", hist(mark="rest")), ("crown", hist(mark="skip")),
    ]
    for banned, h in cases:
        for n in range(300):
            assert banned not in [m["id"] for m in cozy.pick_missions(D(n), h)], (banned, n)
    # and each is on offer when it is possible
    for wanted, h in [("early_bird", hist()), ("doors_by_noon", hist()), ("new_spot", hist(spots_open=2)), ("ship_it", hist(ship_it_days_this_week=1)),
                      ("crown", hist())]:
        assert any(wanted in [m["id"] for m in cozy.pick_missions(D(n), h)] for n in range(300)), wanted


def test_new_spot_remembers_the_spot_it_must_differ_from():
    got = [m for n in range(300) for m in cozy.pick_missions(D(n), hist(last_spot="cafe_amsterdam")) if m["id"] == "new_spot"]
    assert got and all(m["params"] == {"ref_spot": "cafe_amsterdam"} for m in got)


# --------------------------------------------------------------------------
# Progress from the honest counters
# --------------------------------------------------------------------------

def test_early_bird_needs_the_first_logged_hour_to_start_before_eleven(conn):
    d = D(10)
    assert ev(conn, "early_bird", d)["done"] is False
    add(conn, d, 60, "11:30")
    assert ev(conn, "early_bird", d)["done"] is False
    add(conn, d, 60, "07:00", category="Food", deep=False)
    assert ev(conn, "early_bird", d)["done"] is True
    d2 = D(11)
    add(conn, d2, 60, "05:00", category="Sleep", deep=False)             # sleep is not a first hour
    assert ev(conn, "early_bird", d2)["done"] is False


def test_focus_block_missions_count_only_kept_blocks_of_real_length(conn):
    d = D(10)
    add_block(conn, d, "09:00", 24, focus="mostly")
    assert not ev(conn, "one_block", d)["done"]
    add_block(conn, d, "10:00", 25, focus="mostly")
    assert ev(conn, "one_block", d)["done"] and not ev(conn, "two_blocks", d)["done"] and not ev(conn, "full_focus", d)["done"]
    add_block(conn, d, "11:00", 50, focus="full", status="discarded")
    add_block(conn, d, "12:00", 50, focus="full", status="expired")
    assert not ev(conn, "two_blocks", d)["done"] and not ev(conn, "full_focus", d)["done"]      # dropped blocks do not count
    add_block(conn, d, "13:00", 30, focus="full")
    p = ev(conn, "two_blocks", d)
    assert p["done"] and (p["value"], p["target"]) == (2, 2) and ev(conn, "full_focus", d)["done"]


def test_doors_by_noon_means_the_floor_was_met_before_twelve(conn):
    morning, afternoon = D(10), D(11)
    add(conn, morning, 40, "09:00")
    add(conn, afternoon, 40, "13:00")
    assert ev(conn, "doors_by_noon", morning)["done"] and not ev(conn, "doors_by_noon", afternoon)["done"]


def test_deep_focus_missions_use_uncapped_deep_minutes(conn):
    d = D(10)
    add(conn, d, 59)
    assert not ev(conn, "deep_n", d, {"n": 60})["done"]
    add(conn, d, 10, "10:00")
    p = ev(conn, "deep_stretch", d, {"n": 69})
    assert p["done"] and ev(conn, "deep_n", d, {"n": 60})["done"] and not ev(conn, "deep_stretch", d, {"n": 120})["done"]
    add(conn, D(11), 400)                                                 # far past the 4 h XP cap: still counted
    assert ev(conn, "deep_stretch", D(11), {"n": 300})["done"]


def test_two_subjects_needs_fifteen_deep_minutes_in_each_of_two_ladders(conn):
    d = D(10)
    add(conn, d, 60, "08:00", "Python")
    assert (ev(conn, "two_subjects", d)["value"], ev(conn, "two_subjects", d)["done"]) == (1, False)
    add(conn, d, 10, "10:00", "Math")
    assert not ev(conn, "two_subjects", d)["done"]
    add(conn, d, 10, "11:00", "Math")
    assert ev(conn, "two_subjects", d)["done"]


def test_new_spot_needs_a_real_block_somewhere_else(conn):
    d = D(10)
    add_block(conn, d, "09:00", 40, spot="butler")
    assert not ev(conn, "new_spot", d, {"ref_spot": "butler"})["done"]
    add_block(conn, d, "10:00", 10, spot="rooftop")
    assert not ev(conn, "new_spot", d, {"ref_spot": "butler"})["done"]     # too short to count
    add_block(conn, d, "11:00", 30, spot="rooftop")
    assert ev(conn, "new_spot", d, {"ref_spot": "butler"})["done"]


def test_math_hour_crown_long_block_and_ship_it(conn):
    d = D(10)
    add(conn, d, 59, "08:00", "Math")
    assert not ev(conn, "math_hour", d, {"category": "Math"})["done"]
    add(conn, d, 1, "09:30", "Math")
    assert ev(conn, "math_hour", d, {"category": "Math"})["done"] and not ev(conn, "math_hour", d, {"category": "Python"})["done"]
    # the daily target on a weekday is 90 deep minutes
    assert not ev(conn, "crown", d)["done"]
    add(conn, d, 40, "11:00", "Python")
    assert ev(conn, "crown", d)["done"]
    add_block(conn, d, "14:00", 74)
    p = ev(conn, "long_block", d)
    assert not p["done"] and (p["value"], p["target"]) == (74, 75)
    add_block(conn, d, "16:00", 75)
    assert ev(conn, "long_block", d)["done"]
    assert not ev(conn, "ship_it", d)["done"]
    rules.add_output(conn, d, "Python", "a small thing")
    assert ev(conn, "ship_it", d)["done"]


# --------------------------------------------------------------------------
# The day, frozen
# --------------------------------------------------------------------------

def test_today_gets_three_missions_picked_from_yesterday_back_and_frozen(conn):
    d = D(10)
    first = cozy.missions_state(conn, today=d, now=AT(d, "06:00"))
    assert first["enabled"] and first["total"] == 3 and [m["tier"] for m in first["missions"]] == ["easy", "medium", "stretch"]
    assert first["done_count"] == 0 and first["chest"]["ready"] == 0 and first["message"] == "Missions: 0 of 3. Three to go for the chest."
    for m in first["missions"]:
        assert set(m) >= {"id", "tier", "text", "done_text", "done", "value", "target", "unit", "fraction", "progress_text", "toast", "params"}
        assert not game.has_banned_words(m["text"] + m["progress_text"] + m["toast"])
    # new history for the past days afterwards (a late backfill) does not change today's three
    add(conn, D(9), 200, "08:00")
    add(conn, D(8), 200, "08:00")
    again = cozy.missions_state(conn, today=d, now=AT(d, "20:00"))
    assert [(m["id"], m["params"]) for m in again["missions"]] == [(m["id"], m["params"]) for m in first["missions"]]
    assert conn.execute("SELECT COUNT(*) FROM econ_missions WHERE local_date = ?", (d.isoformat(),)).fetchone()[0] == 1


def test_a_day_opened_late_does_not_get_the_time_boxed_missions(conn):
    for n in range(8, 40):
        d = D(n)
        state = cozy.missions_state(conn, today=d, now=AT(d, "15:00"))
        assert not ({"early_bird", "doors_by_noon"} & {m["id"] for m in state["missions"]}), n
    rows = [{m["id"] for m in json.loads(r["missions"])} for r in conn.execute("SELECT missions FROM econ_missions ORDER BY local_date")]
    assert all(a != b for a, b in zip(rows, rows[1:]))                    # no exact repeat of the day before, in the stored days


def test_ship_it_is_offered_on_at_most_two_days_of_a_week(conn):
    for n in range(8, 80):
        cozy.missions_state(conn, today=D(n), now=AT(D(n), "05:00"))
    per_week: dict[date, int] = {}
    for r in conn.execute("SELECT local_date, missions FROM econ_missions"):
        if any(m["id"] == "ship_it" for m in json.loads(r["missions"])):
            monday = timeutil.week_monday(date.fromisoformat(r["local_date"]))
            per_week[monday] = per_week.get(monday, 0) + 1
    assert per_week and max(per_week.values()) <= 2


def test_a_mission_seen_done_stays_done_even_if_the_log_is_deleted_later(conn):
    d = D(10)
    state = cozy.missions_state(conn, today=d, now=AT(d, "06:00"))
    # make today's missions known and easy to finish
    conn.execute("UPDATE econ_missions SET missions = ?", (json.dumps([
        {"id": "one_block", "tier": "easy", "params": {}}, {"id": "deep_n", "tier": "medium", "params": {"n": 60}},
        {"id": "ship_it", "tier": "stretch", "params": {}}]),))
    entry = add(conn, d, 70, "08:00")
    s = cozy.missions_state(conn, today=d, now=AT(d, "09:30"))
    assert [m["done"] for m in s["missions"]] == [False, True, False] and s["message"] == "Missions: 1 of 3. Two to go for the chest."
    assert s["missions"][1]["toast"] == "Mission done: 1 hour of deep focus. Two to go for the chest."
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry,))
    s2 = cozy.missions_state(conn, today=d, now=AT(d, "10:30"))
    assert s2["missions"][1]["done"] is True and s2["missions"][1]["fraction"] == 1.0           # it stays done
    done = json.loads(conn.execute("SELECT done FROM econ_missions").fetchone()["done"])
    assert list(done) == ["deep_n"]


def test_missions_can_be_switched_off_and_quiet_mode_is_a_flag(conn):
    db.set_setting(conn, "daily_missions", False)
    s = cozy.missions_state(conn, today=D(10), now=AT(D(10), "09:00"))
    assert s["enabled"] is False and s["missions"] == [] and s["total"] == 0
    assert conn.execute("SELECT COUNT(*) FROM econ_missions").fetchone()[0] == 0
    db.set_setting(conn, "daily_missions", True)
    db.set_setting(conn, "quiet_mode", True)
    q = cozy.missions_state(conn, today=D(10), now=AT(D(10), "09:00"))
    assert q["quiet"] is True and q["total"] == 3


def test_the_economy_state_carries_a_missions_summary_the_chest_and_the_spot(conn):
    s = economy.economy_state(conn, today=D(10), now=AT(D(10), "09:00"))
    assert s["missions"]["enabled"] and s["missions"]["total"] == 3 and len(s["missions"]["items"]) == 3
    assert set(s["missions"]["items"][0]) == {"id", "tier", "text", "done", "fraction", "progress_text"}
    assert s["chest"] == {"ready": 0, "waiting": 0, "max": 7, "label": "", "next_date": None, "earned_today": False, "streak": 0, "best_streak": 0}
    assert s["spot"]["id"] == "butler" and s["spot"]["unlocked"] == ["butler"] and s["spot"]["next"]["id"] == "cafe_amsterdam"
    hint = s["character"]["activity_hint"]
    assert hint["macro"] == "home" and "look_outside" in hint["activities"] and "sleep" in hint["activities"] and "make_tea" in hint["activities"]
    assert not game.has_banned_words(json.dumps(s["missions"]))


def test_the_api_serves_missions(owner):
    body = owner.get("/api/missions").json()
    assert body["ok"] and body["enabled"] and body["total"] == 3 and body["chest"]["max"] == 7
    assert owner.get("/api/economy").json()["missions"]["total"] == 3
    assert owner.post("/api/settings/game", json={"daily_missions": False}).json()["settings"]["daily_missions"] is False
    assert owner.get("/api/missions").json()["enabled"] is False
