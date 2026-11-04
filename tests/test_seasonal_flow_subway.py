"""Seasonal decorations, the flow meter and the subway map (game.py v2 additions)."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from epoch import db, game, rules, timeutil

TODAY = date(2026, 10, 14)


def keys(d: date) -> set[str]:
    return {w["key"] for w in game.seasonal(d)}


# --------------------------------------------------------------------------
# Seasonal
# --------------------------------------------------------------------------

@pytest.mark.parametrize("d,expected,absent", [
    (date(2026, 10, 31), {"halloween"}, set()),
    (date(2026, 10, 24), {"halloween"}, set()),
    (date(2026, 10, 23), set(), {"halloween"}),
    (date(2026, 11, 1), {"nyc_marathon"}, {"halloween"}),
    (date(2026, 11, 2), set(), {"nyc_marathon"}),
    (date(2026, 12, 31), {"nye_ball_drop"}, {"holiday_lights"}),
    (date(2026, 12, 25), {"holiday_lights"}, set()),
    (date(2027, 1, 1), {"new_year"}, set()),
    (date(2027, 1, 3), {"new_year"}, set()),
    (date(2027, 1, 4), set(), {"new_year"}),
    (date(2026, 7, 4), {"july_4th"}, set()),
    (date(2026, 7, 6), set(), {"july_4th"}),
    (date(2026, 8, 15), {"india_independence_day"}, set()),
    (date(2026, 8, 16), set(), {"india_independence_day"}),
    (date(2026, 6, 1), {"pride"}, set()),
    (date(2026, 6, 30), {"pride"}, set()),
    (date(2026, 7, 1), set(), {"pride"}),
    (date(2026, 4, 3), {"cherry_blossoms"}, set()),
    (date(2026, 4, 21), set(), {"cherry_blossoms"}),
    (date(2026, 5, 15), set(), {"cherry_blossoms", "pride", "halloween"}),
])
def test_fixed_date_seasons(d, expected, absent):
    assert expected <= keys(d) and not (absent & keys(d))


def test_thanksgiving_week_is_monday_to_sunday_around_the_fourth_thursday():
    # 2026: Thursday 26 Nov
    assert "thanksgiving_week" not in keys(date(2026, 11, 22))
    for day in range(23, 30):
        assert "thanksgiving_week" in keys(date(2026, 11, day))
    assert "thanksgiving_week" not in keys(date(2026, 11, 30))
    # 2027: Thursday 25 Nov; 2028: 23 Nov
    assert "thanksgiving_week" in keys(date(2027, 11, 22)) and "thanksgiving_week" not in keys(date(2027, 11, 21))
    assert "thanksgiving_week" in keys(date(2028, 11, 20)) and "thanksgiving_week" in keys(date(2028, 11, 26))


def test_marathon_is_the_first_sunday_of_november():
    expected = {2026: date(2026, 11, 1), 2027: date(2027, 11, 7), 2028: date(2028, 11, 5), 2029: date(2029, 11, 4)}
    for year, day in expected.items():
        assert day.weekday() == 6
        assert "nyc_marathon" in keys(day) and "nyc_marathon" not in keys(day + timedelta(days=1))


def test_diwali_and_holi_follow_the_looked_up_dates():
    diwali = {2026: date(2026, 11, 8), 2027: date(2027, 10, 29), 2028: date(2028, 10, 17), 2029: date(2029, 11, 5)}
    holi = {2026: date(2026, 3, 4), 2027: date(2027, 3, 22), 2028: date(2028, 3, 11), 2029: date(2029, 3, 1)}
    assert game.DIWALI_DATES == diwali and game.HOLI_DATES == holi
    for year, day in diwali.items():
        for offset in range(-2, 3):
            assert "diwali" in keys(day + timedelta(days=offset))
        assert "diwali" not in keys(day + timedelta(days=3)) and "diwali" not in keys(day - timedelta(days=3))
    for year, day in holi.items():
        for offset in (-1, 0, 1):
            assert "holi" in keys(day + timedelta(days=offset))
        assert "holi" not in keys(day + timedelta(days=2)) and "holi" not in keys(day - timedelta(days=2))


def test_unknown_years_just_have_the_fixed_seasons():
    assert "diwali" not in keys(date(2031, 11, 1)) and "holi" not in keys(date(2031, 3, 15))
    assert "halloween" in keys(date(2031, 10, 31))


def test_seasons_can_overlap_and_carry_names_and_dates():
    found = {w["key"]: w for w in game.seasonal(date(2029, 11, 4))}      # marathon day inside Diwali week (Nov 3-7)
    assert {"nyc_marathon", "diwali"} <= set(found)
    assert found["diwali"] == {"key": "diwali", "name": "Diwali", "start": "2029-11-03", "end": "2029-11-07",
                               "note": found["diwali"]["note"]}
    assert found["nyc_marathon"]["name"] == "NYC Marathon day"
    names = {w["name"] for year in (2026, 2027) for w in game.seasonal_windows(year)}
    assert {"Halloween", "Diwali", "Thanksgiving week", "NYC Marathon day", "New Year's Eve ball drop", "New Year", "Holi",
            "Cherry blossoms", "India Independence Day", "July 4th", "Pride month", "Holiday lights"} <= names


def test_copy_has_no_banned_words():
    for year in (2026, 2027, 2028, 2029):
        for w in game.seasonal_windows(year):
            assert not game.has_banned_words(w["name"] + " " + w["note"])


def test_every_window_is_well_formed():
    for year in range(2026, 2031):
        for w in game.seasonal_windows(year):
            assert date.fromisoformat(w["start"]) <= date.fromisoformat(w["end"]) and w["key"] and w["name"]


def test_exposed_in_today_world_and_the_preview_endpoint(owner, v2_clock):
    # the frozen day (2026-10-14) has no season; move the clock to Halloween
    v2_clock.now = datetime(2026, 10, 31, 15, 0, tzinfo=v2_clock.now.tzinfo)
    assert [w["key"] for w in owner.get("/api/today").json()["seasonal"]] == ["halloween"]
    assert [w["key"] for w in owner.get("/api/world").json()["seasonal"]] == ["halloween"]
    preview = owner.get("/api/seasonal?date=2026-11-08").json()
    assert preview["ok"] and preview["date"] == "2026-11-08" and [w["key"] for w in preview["seasonal"]] == ["diwali"]
    assert owner.get("/api/seasonal?date=garbage").json()["date"] == "2026-10-31"       # falls back to today
    assert owner.get("/api/seasonal").json()["seasonal"][0]["key"] == "halloween"


def test_the_toggle_turns_decorations_off(owner, v2_clock):
    v2_clock.now = datetime(2026, 10, 31, 15, 0, tzinfo=v2_clock.now.tzinfo)
    owner.post("/api/settings/game", json={"seasonal_enabled": False})
    assert owner.get("/api/today").json()["seasonal"] == [] and owner.get("/api/world").json()["seasonal"] == []
    assert owner.get("/api/seasonal?date=2026-11-08").json()["seasonal"] == []


def add(conn, start_hhmm: str, minutes: int, category="Python", deep=True, day=TODAY):
    start = timeutil.at_local(day, start_hhmm, "Asia/Kolkata", 4)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), category, deep, "live")


def test_shelf_lists_earned_decor_by_showing_up_that_week(conn, v2_clock):
    # tracker started Mon 2026-10-05; Halloween window is Oct 24-31, which lies after "today" (Oct 14)
    assert [d for d in game.shelf_state(conn)["seasonal_decor"] if d["key"] == "halloween"] == []
    v2_clock.now = datetime(2026, 10, 28, 15, 0, tzinfo=v2_clock.now.tzinfo)
    halloween = next(d for d in game.shelf_state(conn)["seasonal_decor"] if d["key"] == "halloween")
    assert halloween["earned"] is False and halloween["active"] is True and halloween["start"] == "2026-10-24"
    add(conn, "19:30", 30, day=date(2026, 10, 27))
    halloween = next(d for d in game.shelf_state(conn)["seasonal_decor"] if d["key"] == "halloween")
    assert halloween["earned"] is True


def test_a_day_with_only_a_job_block_does_not_earn_decor(conn, v2_clock):
    v2_clock.now = datetime(2026, 10, 28, 15, 0, tzinfo=v2_clock.now.tzinfo)
    halloween = next(d for d in game.shelf_state(conn)["seasonal_decor"] if d["key"] == "halloween")
    assert halloween["earned"] is False
    add(conn, "19:30", 10, category="Rest", deep=False, day=date(2026, 10, 26))      # any honest log counts as showing up
    assert next(d for d in game.shelf_state(conn)["seasonal_decor"] if d["key"] == "halloween")["earned"] is True


def test_shelf_decor_stays_listed_after_the_season(conn, v2_clock):
    v2_clock.now = datetime(2026, 12, 20, 15, 0, tzinfo=v2_clock.now.tzinfo)
    add(conn, "19:30", 30, day=date(2026, 10, 29))
    decor = {d["key"]: d for d in game.shelf_state(conn)["seasonal_decor"]}
    assert decor["halloween"]["earned"] is True and decor["halloween"]["active"] is False
    assert "diwali" in decor and decor["diwali"]["earned"] is False and decor["holiday_lights"]["active"] is True
    assert "nye_ball_drop" not in decor                                    # starts after today


# --------------------------------------------------------------------------
# Flow
# --------------------------------------------------------------------------

def test_flow_with_nothing_logged(conn, v2_clock):
    result = game.flow(conn)
    assert result["minutes"] == 0 and result["hours_lit"] == 0 and result["best_today"] == 0 and result["active"] is False
    assert result["last_end"] is None and result["gap_limit_min"] == 20 and result["to_next_hour_min"] == 60


def test_flow_chains_ladder_deep_time_with_gaps_up_to_twenty_minutes(conn, v2_clock):
    # now is 20:30 IST. 19:00-19:50, gap 10, 20:00-20:25 (still going)
    add(conn, "19:00", 50)
    add(conn, "20:00", 25)
    result = game.flow(conn)
    assert result["minutes"] == 75 and result["hours_lit"] == 1 and result["best_today"] == 75 and result["best_hours"] == 1
    assert result["active"] is True and result["span_minutes"] == 85 and result["to_next_hour_min"] == 45
    assert result["last_end"] == "2026-10-14T14:55:00Z"


def test_a_gap_of_exactly_twenty_minutes_joins_and_twenty_one_does_not(conn, v2_clock):
    add(conn, "19:00", 30)
    add(conn, "19:50", 30)             # gap 20
    assert game.flow(conn)["minutes"] == 60
    add(conn, "20:41", 5)              # gap 21 after 20:20
    result = game.flow(conn)
    assert result["minutes"] == 5 and result["best_today"] == 60


def test_overlapping_entries_count_once(conn, v2_clock):
    add(conn, "19:00", 60)
    add(conn, "19:30", 60)
    assert game.flow(conn)["minutes"] == 90


def test_only_ladder_deep_time_counts(conn, v2_clock):
    add(conn, "19:00", 40, category="Rest", deep=False)
    add(conn, "19:40", 30, category="Python", deep=False)          # pulled away
    add(conn, "20:10", 20, category="Admin", deep=True)
    assert game.flow(conn)["minutes"] == 0
    add(conn, "20:00", 10, category="Math", deep=True)
    assert game.flow(conn)["minutes"] == 10


def test_flow_cools_down_but_keeps_the_best_of_the_day(conn, v2_clock):
    add(conn, "17:00", 75)                                           # ended 18:15; now 20:30
    result = game.flow(conn)
    assert result["active"] is False and result["minutes"] == 0 and result["hours_lit"] == 0
    assert result["best_today"] == 75 and result["best_hours"] == 1 and result["last_end"] == "2026-10-14T12:45:00Z"
    v2_clock.now = datetime(2026, 10, 14, 12, 55, tzinfo=v2_clock.now.tzinfo)       # 10 minutes after it ended
    assert game.flow(conn)["active"] is True and game.flow(conn)["minutes"] == 75


def test_yesterdays_flow_is_not_todays(conn, v2_clock):
    add(conn, "19:00", 120, day=TODAY - timedelta(days=1))
    assert game.flow(conn)["best_today"] == 0


def test_flow_in_api_today_and_its_own_endpoint(owner, v2_state):
    with db.get_conn(v2_state.db_path) as conn:
        add(conn, "19:30", 60)
    today = owner.get("/api/today").json()["flow"]
    assert today["minutes"] == 60 and today["hours_lit"] == 1
    assert owner.get("/api/flow").json() == {"ok": True, **today}


def test_a_flow_event_when_an_hour_lights(owner, v2_clock):
    first = owner.post("/api/log", json={"category": "Python", "minutes": 45, "deep": True}).json()
    assert not [e for e in first["events"] if e["kind"] == "flow"]
    v2_clock.advance(minutes=30)
    second = owner.post("/api/log", json={"category": "Python", "minutes": 30, "deep": True}).json()
    flow_events = [e for e in second["events"] if e["kind"] == "flow"]
    assert len(flow_events) == 1 and flow_events[0]["title"] == "An hour of flow" and flow_events[0]["fx"]["hours"] == 1
    assert flow_events[0]["size"] == "tick" and not game.has_banned_words(flow_events[0]["title"] + flow_events[0]["detail"])
    v2_clock.advance(minutes=15)
    third = owner.post("/api/log", json={"category": "Python", "minutes": 15, "deep": True}).json()
    assert not [e for e in third["events"] if e["kind"] == "flow"]


def test_no_flow_event_for_non_flow_logs(owner):
    body = owner.post("/api/log", json={"category": "Rest", "minutes": 90}).json()
    assert not [e for e in body["events"] if e["kind"] == "flow"]
    assert game.toast_text(body["events"]) == "" or "flow" not in game.toast_text(body["events"])


def test_flow_gives_no_xp(conn, v2_clock):
    before = game.xp_total(conn)
    add(conn, "19:00", 5, category="Admin", deep=False)
    game.flow(conn)
    assert game.xp_total(conn) == before


# --------------------------------------------------------------------------
# Subway
# --------------------------------------------------------------------------

def test_subway_has_a_line_per_ladder_with_five_stations(conn, v2_clock):
    data = game.subway(conn)
    assert [l["ladder"] for l in data["lines"]] == ["Python", "Math", "ML/DL", "Papers", "Writing/X"]
    python = data["lines"][0]
    assert python["name"] == "Python line" and python["color"].startswith("#") and python["bullet"] == "P"
    assert [s["name"] for s in python["stations"]] == ["Hello Loop", "Data Wrangler", "NumPy Native", "Library Builder", "Ship It"]
    assert [s["status"] for s in python["stations"]] == ["next", "ahead", "ahead", "ahead", "ahead"]
    assert python["train"] == {"position": 0.0, "at": 0, "progress": 0.0, "next_station": "Hello Loop"}
    assert python["complete"] is False and python["next_text"].startswith("Next node:")
    first = python["stations"][0]
    assert {"n", "name", "unlocked", "needs_outputs", "needs_deep_min", "needs_link"} <= set(first)


def test_train_moves_with_outputs_and_deep_minutes(conn, v2_clock):
    rules.add_output(conn, TODAY, "Python", "hello loop script")
    data = game.subway(conn)["lines"][0]
    assert data["stations"][0]["status"] == "passed" and data["stations"][1]["status"] == "next"
    assert data["train"]["at"] == 1 and data["train"]["next_station"] == "Data Wrangler"
    # node 2 needs 3 outputs and 5 deep hours: 1 output of 3 and 0 of 300 minutes -> progress 0
    assert data["train"]["position"] == 1.0
    for hour in range(5):
        add(conn, f"{8 + hour}:00", 60, day=TODAY - timedelta(days=1 + hour // 4))
    rules.add_output(conn, TODAY, "Python", "second")
    data = game.subway(conn)["lines"][0]
    assert data["train"]["at"] == 1 and 1.0 < data["train"]["position"] < 2.0
    assert data["train"]["progress"] == 0.67 and data["train"]["position"] == 1.67


def test_other_lines_stay_put(conn, v2_clock):
    rules.add_output(conn, TODAY, "Math", "notes")
    lines = {l["ladder"]: l for l in game.subway(conn)["lines"]}
    assert lines["Math"]["train"]["at"] == 1 and lines["Python"]["train"]["at"] == 0


def test_a_finished_line(conn, v2_clock):
    with db.transaction(conn):
        db.set_setting(conn, "start_date", "2026-08-01")
    for i in range(15):
        rules.add_output(conn, TODAY, "Papers", f"paper {i}", url=f"https://example.com/{i}")
    for day in range(1, 26):
        for hour in range(4):
            add(conn, f"{6 + hour}:00", 60, category="Papers", day=TODAY - timedelta(days=day))
    line = next(l for l in game.subway(conn)["lines"] if l["ladder"] == "Papers")
    assert line["complete"] is True and line["train"]["at"] == 5 and line["train"]["position"] == 5.0
    assert line["train"]["next_station"] is None and [s["status"] for s in line["stations"]] == ["passed"] * 5


def test_subway_endpoint_and_shelf(owner):
    body = owner.get("/api/subway").json()
    assert body["ok"] and len(body["lines"]) == 5
    shelf = owner.get("/api/shelf").json()
    assert shelf["subway"]["lines"] == body["lines"] and "seasonal_decor" in shelf


def test_subway_copy_has_no_banned_words(conn, v2_clock):
    for line in game.subway(conn)["lines"]:
        assert not game.has_banned_words(line["next_text"] + " ".join(s["name"] for s in line["stations"]))
