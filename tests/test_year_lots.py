"""The year of permanent lots: the day -> slot mapping (Monday-to-Sunday rows, Day 1 on a Sunday), /api/world's whole-year form and the
"Your year" badge. The data side (home.json v2) is checked in test_manhattan_data.py."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytest

from epoch import db, game, rules, timeutil

TZ = "Asia/Kolkata"
SUN = date(2026, 10, 18)          # the user's Day 1: a Sunday


def add(conn, d, minutes, cat="Python"):
    start = timeutil.at_local(d, "19:45", TZ, 4)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), cat, True, "live", "numpy")


# --------------------------------------------------------------------------
# The mapping
# --------------------------------------------------------------------------

def test_a_sunday_day_one_sits_alone_in_row_zero():
    s = game.year_slot(SUN, SUN)
    assert s == {"n": 0, "week": 0, "wd": 6, "lot": True}
    monday = game.year_slot(SUN, SUN + timedelta(days=1))
    assert monday == {"n": 1, "week": 1, "wd": 0, "lot": True}                  # the next Monday starts row 1, weekday column 0
    assert game.year_slot(SUN, SUN + timedelta(days=7)) == {"n": 7, "week": 1, "wd": 6, "lot": True}
    assert game.year_slot(SUN, SUN + timedelta(days=8))["week"] == 2


def test_days_before_day_one_are_not_slots():
    assert game.year_slot(SUN, SUN - timedelta(days=1)) is None
    assert game.year_slot(SUN, date(2026, 10, 12)) is None                        # the Monday of Day 1's own week


@pytest.mark.parametrize("weekday", range(7))
def test_rows_are_monday_to_sunday_whatever_day_one_is(weekday):
    day_one = date(2026, 10, 5) + timedelta(days=weekday)                         # a Monday plus 0..6
    seen = set()
    for n in range(0, 60):
        d = day_one + timedelta(days=n)
        s = game.year_slot(day_one, d)
        assert s["wd"] == d.weekday() and s["n"] == n
        assert s["week"] == (timeutil.week_monday(d) - timeutil.week_monday(day_one)).days // 7
        assert (s["week"], s["wd"]) not in seen
        seen.add((s["week"], s["wd"]))


def test_year_boundary_and_the_days_after_the_last_lot():
    last = SUN + timedelta(days=game.YEAR_SLOTS - 1)                              # Day 365: Sunday 17 Oct 2027
    s = game.year_slot(SUN, last)
    assert last.weekday() == 6 and s["n"] == 364 and s["lot"] is True and s["week"] == 52 and s["wd"] == 6
    assert game.year_rows(game.YEAR_SLOTS, SUN.weekday()) == 53                   # rows 0..52
    after = game.year_slot(SUN, last + timedelta(days=1))                          # Day 366: no lot left, nothing breaks
    assert after["lot"] is False and after["n"] == 365 and after["week"] == 53 and after["wd"] == 0
    assert game.year_slot(SUN, last + timedelta(days=400))["lot"] is False


# --------------------------------------------------------------------------
# /api/world
# --------------------------------------------------------------------------

@pytest.fixture
def lived(tmp_path):
    path = tmp_path / "witness.db"
    db.init_db(path, today=SUN)
    with db.get_conn(path) as c:
        for i, mins in enumerate([120, 0, 95, 240, 50]):                             # Day 1..5 (Sun 18 .. Thu 22 Oct)
            if mins:
                add(c, SUN + timedelta(days=i), mins)
        c.commit()
    return path


def test_world_all_returns_every_day_since_day_one_with_its_slot(lived):
    today = SUN + timedelta(days=4)
    with db.get_conn(lived) as c:
        w = game.world_state(c, today=today, days=0)
    days = w["days"]
    assert days[0]["date"] == "2026-10-12" and days[-1]["date"] == "2026-10-25"       # the Monday of Day 1's week .. this Sunday
    assert len(days) == 14 and len(w["weeks"]) == 2
    assert all(d["week"] == i // 7 for i, d in enumerate(days))
    assert [d["slot"] for d in days[:6]] == [None] * 6                                  # before Day 1
    assert days[6]["slot"] == {"n": 0, "week": 0, "wd": 6, "lot": True}
    assert [d["slot"]["n"] for d in days[6:]] == list(range(8))
    assert [d["floors"] > 0 for d in days[6:11]] == [True, False, True, True, True]    # Day 2 had no study: an empty lot
    assert days[10]["is_today"] and days[11]["status"] == "future"
    assert w["year"] == {"slots": 365, "rows": 53, "day_one": "2026-10-18", "first_monday": "2026-10-12",
                         "today_slot": {"n": 4, "week": 1, "wd": 3, "lot": True}, "built": 4, "full": False}
    json.dumps(w)


def test_world_default_window_is_unchanged_but_carries_slots(lived):
    today = SUN + timedelta(days=4)
    with db.get_conn(lived) as c:
        w = game.world_state(c, today=today)
        w7 = game.world_state(c, today=today, days=7)
    assert len(w["days"]) == 28 and len(w["weeks"]) == 4
    assert w["days"][-4]["slot"]["n"] == 4 and w["days"][0]["slot"] is None
    assert len(w7["days"]) == 7 and w7["year"]["built"] == w["year"]["built"] == 4          # built counts the whole year, not the window


def test_a_full_year_and_beyond(tmp_path):
    path = tmp_path / "witness.db"
    db.init_db(path, today=SUN)
    today = SUN + timedelta(days=game.YEAR_SLOTS + 10)                                 # 11 days past the last lot
    with db.get_conn(path) as c:
        add(c, SUN + timedelta(days=364), 60)                                          # Day 365 (the last lot)
        add(c, SUN + timedelta(days=370), 60)                                          # Day 371: no lot
        c.commit()
        w = game.world_state(c, today=today, days=0)
    assert len(w["days"]) == 7 * 55 and w["days"][-1]["date"] == "2027-10-31"
    by_n = {d["slot"]["n"]: d for d in w["days"] if d["slot"]}
    assert by_n[364]["slot"]["lot"] is True and by_n[364]["floors"] > 0
    assert by_n[370]["slot"]["lot"] is False and by_n[370]["floors"] > 0
    assert w["year"]["built"] == 1 and w["year"]["full"] is True and w["year"]["today_slot"]["lot"] is False


def test_api_world_days_all_and_the_year_badge(lived, tmp_path, monkeypatch):
    from types import SimpleNamespace

    from fastapi.testclient import TestClient

    from epoch.config import Config
    from epoch.web.app import create_app

    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc))
    cfg = Config(data_dir=tmp_path, db_path=lived, backup_dir=None, port=8765, telegram_bot_token=None, telegram_user_id=None,
                 openrouter_api_key=None, openrouter_models=(), activitywatch_url="http://localhost:5600")
    client = TestClient(create_app(SimpleNamespace(config=cfg, db_path=lived, telegram_app=None, aw=type('AW', (), {'available': lambda self: False, 'events': lambda self, a, b: []})(), llm=None)))
    body = client.get("/api/world?days=all").json()
    assert body["year"]["slots"] == 365 and body["days"][6]["slot"]["n"] == 0 and body["year"]["built"] == 4
    assert len(client.get("/api/world?days=7").json()["days"]) == 7
    assert len(client.get("/api/world").json()["days"]) == 28
    assert len(client.get("/api/world?days=nonsense").json()["days"]) == 28
    assert len(client.get("/api/world?days=0").json()["days"]) == len(body["days"])
    page = client.get("/world").text
    assert 'data-js="year-badge">Your year' in page and "4 towers" in page and "Last 28 days</span>" not in page
