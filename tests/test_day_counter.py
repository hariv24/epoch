"""The day counter. The start date is Day 1, a day runs 04:00 to 04:00 local, and it never drops below 1."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from epoch import db, game, timeutil

from conftest import START   # Mon 2026-10-05; the v2 clock reads Wed 2026-10-14 20:30 IST, which is Day 10


def at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=timezone.utc)


def test_day_number_maths():
    assert timeutil.day_number(START, START) == 1
    assert timeutil.day_number(START, date(2026, 10, 6)) == 2
    assert timeutil.day_number(START, date(2026, 10, 18)) == 14
    assert timeutil.day_number(START, date(2026, 10, 1)) == 1          # before the start: never below 1
    assert timeutil.day_number_label(12) == "Day 12"
    assert timeutil.day_number_range_label(8, 14) == "Days 8-14"
    assert timeutil.day_number_range_label(3, 3) == "Day 3"
    assert timeutil.short_day(date(2026, 10, 18)) == "Sun 18 Oct"


def test_today_state_has_the_day_number(conn, v2_clock):
    state = game.today_state(conn)
    assert state["day_number"] == 10 and state["day_one"] == "2026-10-05"
    assert state["day_line"] == "Day 10 · Wed 14 Oct"


def test_start_day_is_day_one(conn):
    state = game.today_state(conn, START)
    assert state["day_number"] == 1 and state["day_line"] == "Day 1 · Mon 5 Oct"
    assert game.today_state(conn, date(2026, 10, 1))["day_number"] == 1


def test_day_boundary_is_four_in_the_morning_local(owner, v2_clock):
    # 03:59 IST on Thursday 15 Oct is still Wednesday's Day 10; 04:00 is Day 11
    v2_clock.now = at(14, 22, 29)
    body = owner.get("/api/today").json()
    assert body["date"] == "2026-10-14" and body["day_number"] == 10
    v2_clock.now = at(14, 22, 30)
    body = owner.get("/api/today").json()
    assert body["date"] == "2026-10-15" and body["day_number"] == 11
    assert "Day 11 · Thu 15 Oct" in owner.get("/").text


def test_today_header_and_focus_screen_show_the_day_number(owner):
    page = owner.get("/").text
    assert "Day 10 · Wed 14 Oct" in page
    assert "Day 10" in owner.get("/pomodoro").text
    assert owner.get("/api/world").json()["day_number"] == 10


def test_past_day_close_pages_show_that_days_number(owner):
    assert "Day 1 · Mon 05 Oct" in owner.get("/close?day=2026-10-05").text
    assert "Day 5 · Fri 09 Oct" in owner.get("/close?day=2026-10-09").text
    assert "Day 10 · Wed 14 Oct" in owner.get("/close").text


def test_recap_carries_the_day_number(conn):
    assert game.day_recap(conn, date(2026, 10, 8))["day_number"] == 4     # the seal message ("Day 3 sealed.") is tested in test_game / test_web


def test_week_text_in_telegram_names_the_days(conn):
    start = db.start_date(conn)
    assert timeutil.day_number_range_label(
        timeutil.day_number(start, date(2026, 10, 12)), timeutil.day_number(start, date(2026, 10, 18))) == "Days 8-14"
