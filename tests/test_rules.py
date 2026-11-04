"""Tests for epoch.rules.

Calendar used throughout (Asia/Kolkata, a local day runs 04:00 -> 04:00):
  2026-10-05 Mon  tracker start (baseline week)
  2026-10-12 Mon  first contract week (2 outputs, 5 floor days)
  2026-10-10 Sat / 2026-10-11 Sun are weekend days (target 180)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from epoch import db, rules, timeutil

TZ = "Asia/Kolkata"
MON1 = date(2026, 10, 5)     # baseline week
MON2 = date(2026, 10, 12)    # first contract week


def at(d: date, hhmm: str) -> datetime:
    """UTC instant for a local 'HH:MM' on local day d (after-midnight times belong to d)."""
    return timeutil.at_local(d, hhmm, TZ, 4)


def log(conn, d: date, start: str, minutes: int, category: str = "Python", deep: bool = True, **kw) -> int:
    begin = at(d, start)
    return rules.add_entry(conn, begin, begin + timedelta(minutes=minutes), category, deep, "live", **kw)


def floor_day(conn, d: date) -> None:
    """Make d a floor day with a 30 minute deep Python entry."""
    log(conn, d, "19:30", 30)


def days_from(start: date, count: int) -> list[date]:
    return [start + timedelta(days=i) for i in range(count)]


# --------------------------------------------------------------------------
# Deep minutes, floor, target
# --------------------------------------------------------------------------

def test_floor_met_via_minutes(conn):
    d = date(2026, 10, 6)
    log(conn, d, "19:30", 29)
    assert rules.day_summary(conn, d, today=date(2026, 10, 7)).floor_met is False
    log(conn, d, "21:00", 1)
    summary = rules.day_summary(conn, d, today=date(2026, 10, 7))
    assert summary.deep_minutes == 30
    assert summary.floor_met is True
    assert summary.status == "floor"


def test_floor_met_via_output_only(conn):
    d = date(2026, 10, 6)
    rules.add_output(conn, d, "Python", "numpy broadcasting notebook", "https://example.com/nb")
    summary = rules.day_summary(conn, d, today=date(2026, 10, 7))
    assert summary.deep_minutes == 0
    assert summary.outputs_count == 1
    assert summary.floor_met is True
    assert summary.status == "floor"


def test_deleted_entries_and_outputs_do_not_count(conn):
    d = date(2026, 10, 6)
    entry_id = log(conn, d, "19:30", 60)
    out_id = rules.add_output(conn, d, "Python", "something")
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry_id,))
    conn.execute("UPDATE outputs SET deleted = 1 WHERE id = ?", (out_id,))
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 0 and summary.logged_minutes == 0 and summary.outputs_count == 0
    assert summary.status == "missed"


def test_only_deep_ladder_entries_count(conn):
    d = date(2026, 10, 6)
    log(conn, d, "18:00", 60, category="Python", deep=False)      # shallow: logged but not deep
    log(conn, d, "19:30", 60, category="Distracted", deep=True)   # not a ladder category
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 0
    assert summary.logged_minutes == 120
    assert summary.floor_met is False


def test_tracker_build_counts_only_in_first_14_days(conn):
    early, late = date(2026, 10, 18), date(2026, 10, 19)   # start + 13 days, start + 14 days
    log(conn, early, "19:30", 45, category="Tracker build")
    log(conn, late, "19:30", 45, category="Tracker build")
    today = date(2026, 10, 25)
    assert rules.day_summary(conn, early, today).deep_minutes == 45
    assert rules.day_summary(conn, late, today).deep_minutes == 0


def test_overlapping_entries_are_counted_once(conn):
    d = date(2026, 10, 6)
    log(conn, d, "19:30", 60, category="Python")
    log(conn, d, "20:00", 60, category="Math")        # overlaps 30 min with the first
    log(conn, d, "20:15", 10, category="Python")      # fully inside the second
    log(conn, d, "19:30", 60, category="Python")      # exact duplicate
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 90
    assert sum(summary.deep_by_category.values()) == 90
    assert summary.deep_by_category == {"Python": 60, "Math": 30}


def test_logged_minutes_includes_non_deep_union(conn):
    d = date(2026, 10, 6)
    log(conn, d, "10:00", 540, category="Day job", deep=False)
    log(conn, d, "19:30", 60)
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.logged_minutes == 600
    assert summary.deep_minutes == 60


def test_sleep_cutoff_excludes_late_minutes(conn):
    d = date(2026, 10, 6)
    log(conn, d, "23:45", 90)      # 23:45 -> 01:15, only 45 min are before 00:30
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 45
    assert summary.logged_minutes == 90
    assert summary.floor_met is True


def test_everything_after_cutoff_is_recorded_but_not_deep(conn):
    d = date(2026, 10, 6)
    log(conn, d, "01:00", 120)     # 01:00 -> 03:00 on the next calendar day, still local day d
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 0
    assert summary.logged_minutes == 120
    assert summary.status == "missed"


def test_sleep_cutoff_is_a_setting(conn):
    d = date(2026, 10, 6)
    log(conn, d, "02:00", 120)     # 02:00 -> 04:00
    db.set_setting(conn, "sleep_cutoff", "03:00")
    assert rules.day_summary(conn, d, today=date(2026, 10, 8)).deep_minutes == 60


def test_sleep_cutoff_can_be_switched_off(conn):
    d = date(2026, 10, 6)
    log(conn, d, "01:00", 120)     # all after the default 00:30 cutoff
    db.set_setting(conn, "sleep_cutoff", "off")
    summary = rules.day_summary(conn, d, today=date(2026, 10, 8))
    assert summary.deep_minutes == 120 and rules.late_deep_minutes(conn, d, date(2026, 10, 8)) == 0


def test_late_deep_minutes_are_reported_but_not_counted(conn):
    d = date(2026, 10, 6)
    log(conn, d, "23:45", 90)      # 45 minutes count, 45 are past 00:30
    assert rules.day_summary(conn, d, today=date(2026, 10, 8)).deep_minutes == 45
    assert rules.late_deep_minutes(conn, d, date(2026, 10, 8)) == 45


@pytest.mark.parametrize("value,dsh,ok", [
    ("00:30", 4, True), ("23:00", 4, True), ("03:00", 4, True), ("16:00", 4, True), ("15:59", 4, False),
    ("04:00", 4, False), ("08:00", 4, False), ("00:30", 0, False), ("23:30", 0, True), ("03:00", 6, True),
    ("off", 4, False), ("", 4, False), (None, 4, False), ("junk", 4, False),
])
def test_valid_sleep_cutoff(value, dsh, ok):
    assert rules.valid_sleep_cutoff(value, dsh) is ok


def test_entry_across_the_0400_boundary_is_split_between_days(conn):
    d = date(2026, 10, 6)
    next_day = date(2026, 10, 7)
    log(conn, d, "03:30", 60)      # 03:30 -> 04:30 on the calendar day after d
    today = date(2026, 10, 9)
    first = rules.day_summary(conn, d, today)
    second = rules.day_summary(conn, next_day, today)
    assert first.logged_minutes == 30 and first.deep_minutes == 0   # before 04:00 but after the cutoff
    assert second.logged_minutes == 30 and second.deep_minutes == 30
    assert second.floor_met is True


def test_early_morning_entry_belongs_to_the_next_local_day(conn):
    # 05:00-06:00 local on calendar day 10-07 is part of local day 10-07, not 10-06.
    start = datetime(2026, 10, 7, 5, 0, tzinfo=timeutil.zone(TZ)).astimezone(timeutil.UTC)
    rules.add_entry(conn, start, start + timedelta(minutes=60), "Python", True, "live")
    assert rules.day_summary(conn, date(2026, 10, 6), date(2026, 10, 9)).deep_minutes == 0
    assert rules.day_summary(conn, date(2026, 10, 7), date(2026, 10, 9)).deep_minutes == 60


def test_targets_job_day_vs_weekend(conn):
    wed, sat = date(2026, 10, 7), date(2026, 10, 10)
    today = date(2026, 10, 12)
    assert rules.day_summary(conn, wed, today).target_minutes == 90
    assert rules.day_summary(conn, wed, today).is_job_day is True
    assert rules.day_summary(conn, sat, today).target_minutes == 180
    assert rules.day_summary(conn, sat, today).is_job_day is False

    log(conn, wed, "19:30", 89)
    assert rules.day_summary(conn, wed, today).target_met is False
    log(conn, wed, "21:00", 1)
    assert rules.day_summary(conn, wed, today).target_met is True

    log(conn, sat, "10:00", 179)
    assert rules.day_summary(conn, sat, today).target_met is False
    log(conn, sat, "14:00", 1)
    assert rules.day_summary(conn, sat, today).target_met is True


def test_deep_above_cap_is_shown_but_never_counts(conn):
    wed = date(2026, 10, 7)
    log(conn, wed, "09:00", 300)   # 5 h of deep work
    summary = rules.day_summary(conn, wed, date(2026, 10, 9))
    assert summary.deep_minutes == 300           # shown uncapped
    assert summary.target_met is True

    # Make the target higher than the cap: even 300 minutes can never meet it.
    db.set_setting(conn, "target_weekday_minutes", 300)
    summary = rules.day_summary(conn, wed, date(2026, 10, 9))
    assert summary.deep_minutes == 300
    assert summary.target_met is False


def test_is_job_day_uses_the_setting(conn):
    assert rules.is_job_day(conn, date(2026, 10, 9)) is True      # Friday
    assert rules.is_job_day(conn, date(2026, 10, 10)) is False    # Saturday
    db.set_setting(conn, "job_days", [0, 1, 2, 3, 4, 5])
    assert rules.is_job_day(conn, date(2026, 10, 10)) is True


def test_today_local_uses_the_0400_day_start(conn, monkeypatch):
    # 2026-10-07 21:00 UTC = 02:30 IST on 10-08, which is still local day 10-07.
    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 7, 21, 0, tzinfo=timeutil.UTC))
    assert rules.today_local(conn) == date(2026, 10, 7)
    # 23:00 UTC = 04:30 IST on 10-08.
    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 7, 23, 0, tzinfo=timeutil.UTC))
    assert rules.today_local(conn) == date(2026, 10, 8)


# --------------------------------------------------------------------------
# Day status
# --------------------------------------------------------------------------

def test_before_start_and_future(conn):
    today = date(2026, 10, 7)
    assert rules.day_summary(conn, date(2026, 10, 4), today).status == "before_start"
    assert rules.day_summary(conn, date(2026, 10, 8), today).status == "future"


def test_open_today_then_missed_later(conn):
    d = date(2026, 10, 7)
    assert rules.day_summary(conn, d, today=d).status == "open"
    assert rules.day_summary(conn, d, today=date(2026, 10, 8)).status == "missed"


def test_floor_beats_open_and_marks(conn):
    d = date(2026, 10, 7)
    rules.use_skip(conn, d)
    floor_day(conn, d)
    summary = rules.day_summary(conn, d, today=d)
    assert summary.status == "floor"
    assert summary.mark == "skip"


def test_skip_and_rest_status(conn):
    skip_day, rest_day = date(2026, 10, 6), date(2026, 10, 7)
    assert rules.use_skip(conn, skip_day, "skip", "tired") is True
    assert rules.use_skip(conn, rest_day, "rest") is True
    today = date(2026, 10, 9)
    assert rules.day_summary(conn, skip_day, today).status == "skip"
    assert rules.day_summary(conn, rest_day, today).status == "rest"


def test_skip_on_today_beats_open(conn):
    d = date(2026, 10, 7)
    rules.use_skip(conn, d)
    assert rules.day_summary(conn, d, today=d).status == "skip"


def test_rest_day_declared_in_advance_is_future_until_it_arrives(conn):
    tomorrow = date(2026, 10, 8)
    assert rules.use_skip(conn, tomorrow, "rest", "planned rest") is True
    assert rules.day_summary(conn, tomorrow, today=date(2026, 10, 7)).status == "future"
    assert rules.day_summary(conn, tomorrow, today=date(2026, 10, 7)).mark == "rest"
    assert rules.day_summary(conn, tomorrow, today=date(2026, 10, 8)).status == "rest"


def test_skips_limit_per_week(conn):
    assert rules.use_skip(conn, date(2026, 10, 6)) is True
    assert rules.use_skip(conn, date(2026, 10, 7), "rest") is True      # a rest day uses a skip too
    assert rules.use_skip(conn, date(2026, 10, 8)) is False             # third in the same week
    assert rules.use_skip(conn, date(2026, 10, 12)) is True             # new week, fresh allowance
    week = rules.week_summary(conn, date(2026, 10, 7), today=date(2026, 10, 9))
    assert week.skips_used == 2 and week.skips_left == 0


def test_skip_limit_follows_the_setting_and_is_idempotent_per_day(conn):
    db.set_setting(conn, "skips_per_week", 1)
    assert rules.use_skip(conn, date(2026, 10, 6)) is True
    assert rules.use_skip(conn, date(2026, 10, 6), "rest") is True      # same day: re-mark, no extra cost
    assert rules.use_skip(conn, date(2026, 10, 7)) is False
    assert conn.execute("SELECT kind FROM day_marks WHERE local_date = '2026-10-06'").fetchone()["kind"] == "rest"


def test_use_skip_rejects_unknown_kind(conn):
    with pytest.raises(ValueError):
        rules.use_skip(conn, date(2026, 10, 6), "holiday")


def test_missed_without_floors_after(conn):
    missed = date(2026, 10, 6)
    floor_day(conn, date(2026, 10, 7))           # only one of the next two days
    assert rules.day_summary(conn, missed, today=date(2026, 10, 9)).status == "missed"


def test_repaired_when_next_two_days_hit_the_floor(conn):
    missed = date(2026, 10, 6)
    floor_day(conn, date(2026, 10, 7))
    floor_day(conn, date(2026, 10, 8))
    assert rules.day_summary(conn, missed, today=date(2026, 10, 8)).status == "repaired"
    assert rules.day_summary(conn, missed, today=date(2026, 10, 10)).status == "repaired"
    # Window still running as of 10-07: not repaired yet.
    assert rules.day_summary(conn, missed, today=date(2026, 10, 7)).status == "missed"


def test_repair_needs_both_days_not_just_two_floors_somewhere(conn):
    missed = date(2026, 10, 6)
    floor_day(conn, date(2026, 10, 7))
    floor_day(conn, date(2026, 10, 9))           # 10-08 not met
    assert rules.day_summary(conn, missed, today=date(2026, 10, 10)).status == "missed"


def test_lapse_choice_let_go_blocks_repair(conn):
    missed = date(2026, 10, 6)
    floor_day(conn, date(2026, 10, 7))
    floor_day(conn, date(2026, 10, 8))
    rules.record_lapse(conn, missed, "tired", "let_go", None)
    assert rules.day_summary(conn, missed, today=date(2026, 10, 9)).status == "missed"


def test_lapse_choice_repair_allows_repair(conn):
    missed = date(2026, 10, 6)
    floor_day(conn, date(2026, 10, 7))
    floor_day(conn, date(2026, 10, 8))
    rules.record_lapse(conn, missed, "phone", "repair", "IF 19:30, THEN 25 min on ch.6")
    assert rules.day_summary(conn, missed, today=date(2026, 10, 9)).status == "repaired"


def test_comeback_day(conn):
    missed, back = date(2026, 10, 6), date(2026, 10, 7)
    floor_day(conn, back)
    today = date(2026, 10, 8)
    assert rules.day_summary(conn, back, today).is_comeback is True
    assert rules.day_summary(conn, missed, today).is_comeback is False


def test_comeback_after_repaired_day_and_only_the_first(conn):
    d1, d2, d3 = date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9)
    for d in (d1, d2, d3):
        floor_day(conn, d)
    today = date(2026, 10, 10)
    assert rules.day_summary(conn, date(2026, 10, 6), today).status == "repaired"
    assert rules.day_summary(conn, d1, today).is_comeback is True
    assert rules.day_summary(conn, d2, today).is_comeback is False
    assert rules.day_summary(conn, d3, today).is_comeback is False


def test_no_comeback_after_a_skip(conn):
    rules.use_skip(conn, date(2026, 10, 6))
    floor_day(conn, date(2026, 10, 7))
    assert rules.day_summary(conn, date(2026, 10, 7), date(2026, 10, 8)).is_comeback is False


def test_comeback_on_today_when_yesterday_was_missed(conn):
    floor_day(conn, date(2026, 10, 7))   # today; 10-06 (yesterday) had nothing
    assert rules.day_summary(conn, date(2026, 10, 7), today=date(2026, 10, 7)).is_comeback is True


# --------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------

def test_run_counts_back_from_yesterday_with_open_today(conn):
    for d in days_from(date(2026, 10, 5), 3):         # Mon-Wed
        floor_day(conn, d)
    assert rules.current_run(conn, today=date(2026, 10, 8)) == 3   # Thursday still open
    floor_day(conn, date(2026, 10, 8))
    assert rules.current_run(conn, today=date(2026, 10, 8)) == 4   # today joins once it is a floor day


def test_run_stops_at_missed_day_and_at_start(conn):
    floor_day(conn, date(2026, 10, 5))
    floor_day(conn, date(2026, 10, 7))                # 10-06 missed
    assert rules.current_run(conn, today=date(2026, 10, 8)) == 1


def test_run_is_zero_when_yesterday_missed(conn):
    floor_day(conn, date(2026, 10, 5))
    assert rules.current_run(conn, today=date(2026, 10, 8)) == 0   # 10-06, 10-07 missed


def test_run_includes_skip_rest_and_repaired_days(conn):
    floor_day(conn, date(2026, 10, 5))
    rules.use_skip(conn, date(2026, 10, 6), "skip")
    rules.use_skip(conn, date(2026, 10, 7), "rest")
    floor_day(conn, date(2026, 10, 9))                 # 10-08 missed
    floor_day(conn, date(2026, 10, 10))
    assert rules.day_summary(conn, date(2026, 10, 8), date(2026, 10, 11)).status == "repaired"
    assert rules.current_run(conn, today=date(2026, 10, 11)) == 6   # Mon..Sat; Sunday still open


def test_run_does_not_reach_before_start(conn):
    floor_day(conn, date(2026, 10, 5))
    assert rules.current_run(conn, today=date(2026, 10, 6)) == 1


# --------------------------------------------------------------------------
# Weeks
# --------------------------------------------------------------------------

def test_baseline_week_has_no_targets(conn):
    for d in days_from(MON1, 3):
        floor_day(conn, d)
    week = rules.week_summary(conn, date(2026, 10, 7), today=date(2026, 10, 9))
    assert week.status == "baseline"
    assert week.outputs_required is None and week.floor_days_required is None
    assert week.monday == MON1 and week.sunday == date(2026, 10, 11)
    assert week.floor_days == 3
    assert len(week.days) == 7
    # even after the week is over, a baseline week is never "not_kept"
    assert rules.week_summary(conn, MON1, today=date(2026, 10, 20)).status == "baseline"


def test_week_in_progress_then_kept_early(conn):
    for d in days_from(MON2, 5):                        # Mon-Fri floor days
        floor_day(conn, d)
    rules.add_output(conn, date(2026, 10, 13), "Python", "first notebook", "https://example.com/1")
    today = date(2026, 10, 16)
    week = rules.week_summary(conn, today, today=today)
    assert week.status == "in_progress"                 # 5 floor days, only 1 output
    assert (week.outputs_required, week.floor_days_required) == (2, 5)

    rules.add_output(conn, date(2026, 10, 15), "Python", "second notebook")
    week = rules.week_summary(conn, today, today=today)
    assert week.status == "kept"                        # kept on Friday, before Sunday
    assert week.outputs_count == 2 and week.floor_days == 5
    assert [o["what"] for o in week.outputs] == ["first notebook", "second notebook"]


def test_week_not_kept_only_after_it_ends(conn):
    for d in days_from(MON2, 4):
        floor_day(conn, d)
    rules.add_output(conn, MON2, "Python", "one")
    rules.add_output(conn, MON2, "Python", "two")
    assert rules.week_summary(conn, MON2, today=date(2026, 10, 18)).status == "in_progress"   # Sunday
    assert rules.week_summary(conn, MON2, today=date(2026, 10, 19)).status == "not_kept"


def test_repaired_day_counts_as_a_floor_day_in_the_week(conn):
    # Mon missed, Tue + Wed floor => Mon repaired. Thu, Fri floor too.
    for d in days_from(date(2026, 10, 13), 4):
        floor_day(conn, d)
    week = rules.week_summary(conn, MON2, today=date(2026, 10, 17))
    assert week.days[0].status == "repaired"
    assert week.floor_days == 5


def test_week_summary_deep_by_category_and_skips(conn):
    log(conn, date(2026, 10, 13), "19:30", 60, category="Python")
    log(conn, date(2026, 10, 14), "19:30", 45, category="Math")
    log(conn, date(2026, 10, 14), "21:00", 30, category="Python")
    rules.use_skip(conn, date(2026, 10, 15))
    week = rules.week_summary(conn, date(2026, 10, 13), today=date(2026, 10, 15))
    assert week.deep_minutes == 135
    assert week.deep_by_category == {"Python": 90, "Math": 45}
    assert week.skips_used == 1 and week.skips_left == 1


def test_week_plan_vs_actual_and_top_lapse_reasons(conn):
    tue = date(2026, 10, 13)
    block = rules.add_plan_block(conn, tue, "Python", 60, "19:30", "ch.6")
    log(conn, tue, "19:30", 45, plan_block_id=block)
    rules.add_plan_block(conn, tue, "Math", 45, "21:00")                  # nothing done
    done_block = rules.add_plan_block(conn, date(2026, 10, 14), "Papers", 30, "20:00")
    conn.execute("UPDATE plan_blocks SET status = 'done' WHERE id = ?", (done_block,))
    rules.record_lapse(conn, date(2026, 10, 12), "work_late", "let_go", None)
    rules.record_lapse(conn, date(2026, 10, 13), "work_late", "let_go", None)
    rules.record_lapse(conn, date(2026, 10, 14), "tired", "let_go", None)
    week = rules.week_summary(conn, tue, today=date(2026, 10, 16))
    assert week.planned_minutes == 135
    assert week.planned_done_minutes == 75          # 45 linked + 30 marked done
    assert week.top_lapse_reasons == [("work_late", 2), ("tired", 1)]


def test_planned_done_is_capped_at_planned(conn):
    tue = date(2026, 10, 13)
    block = rules.add_plan_block(conn, tue, "Python", 30, "19:30")
    log(conn, tue, "19:30", 90, plan_block_id=block)
    week = rules.week_summary(conn, tue, today=date(2026, 10, 16))
    assert week.planned_done_minutes == 30


# --------------------------------------------------------------------------
# Contracts
# --------------------------------------------------------------------------

def contract_numbers(conn, d):
    row = rules.contract_for(conn, d)
    return None if row is None else (row["outputs_per_week"], row["floor_days_per_week"])


def test_contract_for_baseline_and_seeded_contract(conn):
    assert rules.contract_for(conn, date(2026, 10, 11)) is None
    assert contract_numbers(conn, MON2) == (2, 5)
    assert contract_numbers(conn, date(2026, 10, 18)) == (2, 5)


def test_raising_the_contract_applies_this_monday(conn):
    effective = rules.change_contract(conn, 3, 6, today=date(2026, 10, 14))
    assert effective == MON2
    assert contract_numbers(conn, date(2026, 10, 14)) == (3, 6)
    assert contract_numbers(conn, date(2026, 10, 19)) == (3, 6)


def test_lowering_the_contract_applies_next_monday(conn):
    effective = rules.change_contract(conn, 1, 4, today=date(2026, 10, 14))
    assert effective == date(2026, 10, 19)
    assert contract_numbers(conn, date(2026, 10, 14)) == (2, 5)        # this week unchanged
    assert contract_numbers(conn, date(2026, 10, 19)) == (1, 4)


def test_mixed_change_raises_now_and_lowers_next_monday(conn):
    effective = rules.change_contract(conn, 3, 4, today=date(2026, 10, 14))
    assert effective == date(2026, 10, 19)
    assert contract_numbers(conn, date(2026, 10, 14)) == (3, 5)
    assert contract_numbers(conn, date(2026, 10, 19)) == (3, 4)


def test_new_change_replaces_a_pending_one_and_same_values_cancel_it(conn):
    rules.change_contract(conn, 1, 4, today=date(2026, 10, 14))
    rules.change_contract(conn, 2, 3, today=date(2026, 10, 15))
    assert contract_numbers(conn, date(2026, 10, 19)) == (2, 3)
    assert rules.change_contract(conn, 2, 5, today=date(2026, 10, 16)) == MON2   # same as now: keep
    assert contract_numbers(conn, date(2026, 10, 19)) == (2, 5)


def test_changing_the_contract_during_the_baseline_week(conn):
    effective = rules.change_contract(conn, 3, 4, today=date(2026, 10, 7))
    assert effective == MON2
    assert contract_numbers(conn, date(2026, 10, 9)) is None
    assert contract_numbers(conn, MON2) == (3, 4)


def test_contract_change_is_used_by_week_verdicts(conn):
    for d in days_from(MON2, 5):
        floor_day(conn, d)
    rules.add_output(conn, MON2, "Python", "one")
    rules.add_output(conn, MON2, "Python", "two")
    assert rules.week_summary(conn, MON2, today=date(2026, 10, 17)).status == "kept"
    rules.change_contract(conn, 3, 5, today=date(2026, 10, 17))        # raise now
    assert rules.week_summary(conn, MON2, today=date(2026, 10, 17)).status == "in_progress"


def test_change_contract_validates_input(conn):
    with pytest.raises(ValueError):
        rules.change_contract(conn, 2, 9, today=MON2)


# --------------------------------------------------------------------------
# Lapses and repair windows
# --------------------------------------------------------------------------

def test_pending_lapse_is_yesterday_when_missed_and_unanswered(conn):
    today = date(2026, 10, 8)
    assert rules.pending_lapse(conn, today) == date(2026, 10, 7)
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "repair", None)
    assert rules.pending_lapse(conn, today) is None


def test_pending_lapse_none_when_yesterday_was_fine(conn):
    floor_day(conn, date(2026, 10, 7))
    assert rules.pending_lapse(conn, date(2026, 10, 8)) is None
    rules.use_skip(conn, date(2026, 10, 9))
    assert rules.pending_lapse(conn, date(2026, 10, 10)) is None


def test_pending_lapse_none_before_tracker_start(conn):
    assert rules.pending_lapse(conn, date(2026, 10, 5)) is None     # yesterday is before start


def test_record_lapse_skip_marks_the_day(conn):
    missed = date(2026, 10, 7)
    rules.record_lapse(conn, missed, "tired", "skip", "IF 19:30, THEN 15 min")
    assert rules.day_summary(conn, missed, date(2026, 10, 8)).status == "skip"
    row = conn.execute("SELECT * FROM lapses WHERE local_date = '2026-10-07'").fetchone()
    assert (row["reason"], row["choice"], row["if_then"]) == ("tired", "skip", "IF 19:30, THEN 15 min")


def test_record_lapse_skip_without_skips_left_becomes_let_go(conn):
    rules.use_skip(conn, date(2026, 10, 5))
    rules.use_skip(conn, date(2026, 10, 6))
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "skip", None)
    assert conn.execute("SELECT choice FROM lapses WHERE local_date = '2026-10-07'").fetchone()[0] == "let_go"
    assert rules.day_summary(conn, date(2026, 10, 7), date(2026, 10, 8)).status == "missed"


def test_record_lapse_accepts_letgo_and_rejects_unknown_choice(conn):
    rules.record_lapse(conn, date(2026, 10, 7), None, "letgo", None)
    assert conn.execute("SELECT choice FROM lapses").fetchone()[0] == "let_go"
    with pytest.raises(ValueError):
        rules.record_lapse(conn, date(2026, 10, 7), None, "ignore", None)


def test_record_lapse_updates_existing_row(conn):
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "let_go", None)
    rules.record_lapse(conn, date(2026, 10, 7), "phone", "repair", "IF ..., THEN ...")
    rows = conn.execute("SELECT * FROM lapses").fetchall()
    assert len(rows) == 1 and rows[0]["reason"] == "phone" and rows[0]["choice"] == "repair"


def test_open_repair_window_lifecycle(conn):
    missed = date(2026, 10, 7)
    rules.record_lapse(conn, missed, "phone", "repair", None)
    assert rules.open_repair_window(conn, date(2026, 10, 8)) == missed   # day 1 of 2, still open
    floor_day(conn, date(2026, 10, 8))
    assert rules.open_repair_window(conn, date(2026, 10, 9)) == missed   # day 2 of 2
    floor_day(conn, date(2026, 10, 9))
    assert rules.open_repair_window(conn, date(2026, 10, 9)) is None     # repaired: closed
    assert rules.open_repair_window(conn, date(2026, 10, 10)) is None


def test_open_repair_window_requires_repair_choice(conn):
    missed = date(2026, 10, 7)
    assert rules.open_repair_window(conn, date(2026, 10, 8)) is None          # no lapse row yet
    rules.record_lapse(conn, missed, "tired", "let_go", None)
    assert rules.open_repair_window(conn, date(2026, 10, 8)) is None


def test_open_repair_window_closes_when_the_attempt_fails(conn):
    missed = date(2026, 10, 7)
    rules.record_lapse(conn, missed, "tired", "repair", None)
    # 10-08 gets no floor, so on 10-09 the attempt is over.
    assert rules.open_repair_window(conn, date(2026, 10, 9)) is None
    assert rules.open_repair_window(conn, date(2026, 10, 10)) is None


def test_only_one_repair_window_open_at_a_time(conn):
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "repair", None)
    rules.record_lapse(conn, date(2026, 10, 8), "tired", "repair", None)
    # 10-07 attempt ended because 10-08 was also missed; only 10-08's window is open.
    assert rules.open_repair_window(conn, date(2026, 10, 9)) == date(2026, 10, 8)


# --------------------------------------------------------------------------
# Lifetime and consistency
# --------------------------------------------------------------------------

def test_lifetime_totals_with_fixed_clock(conn, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 17, 10, 0, tzinfo=timeutil.UTC))  # Sat 15:30 IST
    for d in days_from(MON1, 5):
        log(conn, d, "19:30", 60)
    for d in days_from(MON2, 5):
        floor_day(conn, d)
    rules.add_output(conn, MON2, "Python", "a")
    rules.add_output(conn, MON2, "Python", "b")
    log(conn, date(2026, 10, 17), "10:00", 20, category="Rest", deep=False)
    totals = rules.lifetime_totals(conn)
    assert totals["deep_minutes"] == 5 * 60 + 5 * 30
    assert totals["outputs"] == 2
    assert totals["weeks_kept"] == 1                    # contract week 10-12 kept (5 floor days, 2 outputs)
    assert totals["comebacks"] == 1                     # Monday 10-12 follows two missed weekend days
    assert totals["days_tracked"] == 11                 # 5 baseline + 5 contract + the Saturday


def test_lifetime_totals_counts_comebacks(conn, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 9, 10, 0, tzinfo=timeutil.UTC))
    floor_day(conn, date(2026, 10, 5))
    floor_day(conn, date(2026, 10, 7))                  # comeback after Tuesday
    floor_day(conn, date(2026, 10, 9))                  # comeback after Thursday
    assert rules.lifetime_totals(conn)["comebacks"] == 2


def test_consistency(conn):
    for d in days_from(MON2, 5):
        floor_day(conn, d)
    rules.add_output(conn, MON2, "Python", "a")
    rules.add_output(conn, MON2, "Python", "b")
    result = rules.consistency(conn, today=date(2026, 10, 19))      # Monday of the next week
    assert result["weeks_kept_last_12"] == 1
    assert result["weeks_with_contract_last_12"] == 2               # the weeks of 10-12 and 10-19
    assert result["floor_days_last_30"] == 6                         # 5 floor days + Sunday 10-11, repaired by Mon and Tue


def test_consistency_counts_contract_weeks(conn):
    result = rules.consistency(conn, today=date(2026, 10, 21))
    assert result["weeks_kept_last_12"] == 0
    assert result["weeks_with_contract_last_12"] == 2                # weeks of 10-12 and 10-19
    assert result["floor_days_last_30"] == 0


# --------------------------------------------------------------------------
# Plan, if-then, write helpers
# --------------------------------------------------------------------------

def test_render_if_then():
    assert rules.render_if_then("19:30", "Python", "ch.6 ex 1-10") == "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-10."
    assert rules.render_if_then("7:05", "Math", None) == "IF it's 07:05 and I'm home, THEN I start my Math block."
    assert rules.render_if_then(None, "Papers", "attention paper").startswith("IF I sit down")


def test_add_plan_block_renders_if_then(conn):
    block_id = rules.add_plan_block(conn, date(2026, 10, 7), "Python", 60, "19:30", "ch.6 ex 1-10")
    row = conn.execute("SELECT * FROM plan_blocks WHERE id = ?", (block_id,)).fetchone()
    assert row["if_then"] == "IF it's 19:30 and I'm home, THEN I open ch.6 ex 1-10."
    assert (row["local_date"], row["category"], row["minutes"], row["status"]) == ("2026-10-07", "Python", 60, "planned")
    with pytest.raises(ValueError):
        rules.add_plan_block(conn, date(2026, 10, 7), "Python", 0, "19:30")
    with pytest.raises(ValueError):
        rules.add_plan_block(conn, date(2026, 10, 7), "Nonsense", 30, "19:30")


def test_add_entry_validation_and_fields(conn):
    start = at(date(2026, 10, 7), "19:30")
    entry_id = rules.add_entry(conn, start, start + timedelta(minutes=30), "Python", True, "parsed", note="ex 1-12")
    row = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    assert (row["category"], row["deep"], row["source"], row["note"], row["deleted"]) == ("Python", 1, "parsed", "ex 1-12", 0)
    assert row["start_utc"] == timeutil.to_iso(start)
    with pytest.raises(ValueError):
        rules.add_entry(conn, start, start, "Python", True, "live")
    with pytest.raises(ValueError):
        rules.add_entry(conn, start, start + timedelta(minutes=5), "Cooking", True, "live")
    with pytest.raises(ValueError):
        rules.add_entry(conn, datetime(2026, 10, 7, 19, 30), start + timedelta(minutes=5), "Python", True, "live")


def test_add_output_validation(conn):
    out_id = rules.add_output(conn, date(2026, 10, 7), "ML/DL", "  micrograd works  ", "  ")
    row = conn.execute("SELECT * FROM outputs WHERE id = ?", (out_id,)).fetchone()
    assert (row["what"], row["url"], row["stage"], row["verified_by"]) == ("micrograd works", None, "ML/DL", "self")
    with pytest.raises(ValueError):
        rules.add_output(conn, date(2026, 10, 7), "Python", "   ")
    with pytest.raises(ValueError):
        rules.add_output(conn, date(2026, 10, 7), "Cooking", "stew")


# --------------------------------------------------------------------------
# close_job_block
# --------------------------------------------------------------------------

def job_entries(conn):
    return conn.execute("SELECT * FROM entries WHERE category = 'Day job' AND deleted = 0").fetchall()


@pytest.mark.parametrize("choice,start,end", [
    ("usual", "10:00", "19:00"),
    ("left_early", "10:00", "17:00"),
    ("stayed_late", "10:00", "21:00"),
])
def test_close_job_block_choices(conn, choice, start, end):
    d = date(2026, 10, 7)
    rules.close_job_block(conn, d, choice)
    rows = job_entries(conn)
    assert len(rows) == 1
    assert rows[0]["start_utc"] == timeutil.to_iso(at(d, start))
    assert rows[0]["end_utc"] == timeutil.to_iso(at(d, end))
    assert rows[0]["deep"] == 0


def test_close_job_block_leave_writes_nothing_and_marks_nothing(conn):
    rules.close_job_block(conn, date(2026, 10, 7), "leave")
    assert job_entries(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM day_marks").fetchone()[0] == 0


def test_close_job_block_twice_replaces_the_first_answer(conn):
    d = date(2026, 10, 7)
    rules.close_job_block(conn, d, "usual")
    rules.close_job_block(conn, d, "left_early")
    rows = job_entries(conn)
    assert len(rows) == 1 and rows[0]["end_utc"] == timeutil.to_iso(at(d, "17:00"))
    rules.close_job_block(conn, d, "leave")
    assert job_entries(conn) == []


def test_close_job_block_does_not_touch_other_days_or_user_entries(conn):
    rules.close_job_block(conn, date(2026, 10, 6), "usual")
    log(conn, date(2026, 10, 7), "10:00", 60, category="Day job", deep=False, note="meeting")
    rules.close_job_block(conn, date(2026, 10, 7), "usual")
    rules.close_job_block(conn, date(2026, 10, 7), "leave")
    assert len(job_entries(conn)) == 2        # the other day's block and the hand-made entry


def test_close_job_block_rejects_unknown_choice(conn):
    with pytest.raises(ValueError):
        rules.close_job_block(conn, date(2026, 10, 7), "slept")


def test_day_job_never_counts_toward_the_floor(conn):
    d = date(2026, 10, 7)
    rules.close_job_block(conn, d, "usual")
    summary = rules.day_summary(conn, d, date(2026, 10, 8))
    assert summary.logged_minutes == 540
    assert summary.deep_minutes == 0 and summary.floor_met is False


# --------------------------------------------------------------------------
# gaps
# --------------------------------------------------------------------------

def span(d, a, b):
    return (at(d, a), at(d, b))


def test_gaps_on_a_job_day_exclude_job_hours(conn):
    wed = date(2026, 10, 7)
    result = rules.gaps(conn, wed, end_utc=at(wed, "23:30"))
    assert result == [span(wed, "07:30", "10:00"), span(wed, "19:00", "23:30")]


def test_gaps_subtract_logged_entries_and_keep_order(conn):
    wed = date(2026, 10, 7)
    log(conn, wed, "19:30", 60, category="Python")               # 19:30-20:30
    log(conn, wed, "20:00", 60, category="Math")                 # overlaps, to 21:00
    log(conn, wed, "07:30", 30, category="Food", deep=False)     # 07:30-08:00
    result = rules.gaps(conn, wed, end_utc=at(wed, "23:30"))
    assert result == [span(wed, "08:00", "10:00"), span(wed, "19:00", "19:30"), span(wed, "21:00", "23:30")]


def test_gaps_drop_stretches_under_ten_minutes(conn):
    wed = date(2026, 10, 7)
    log(conn, wed, "19:00", 55, category="Food", deep=False)     # 19:00-19:55
    log(conn, wed, "20:04", 200, category="Python")              # 20:04 -> 23:24; gap before it is 9 min
    result = rules.gaps(conn, wed, end_utc=at(wed, "23:30"))
    assert result == [span(wed, "07:30", "10:00")]               # evening gaps are 9 and 6 minutes


def test_gaps_weekend_uses_weekend_morning_and_no_job_window(conn):
    sat = date(2026, 10, 10)
    result = rules.gaps(conn, sat, end_utc=at(sat, "12:00"))
    assert result == [span(sat, "08:30", "12:00")]


def test_gaps_custom_start(conn):
    wed = date(2026, 10, 7)
    result = rules.gaps(conn, wed, start_hhmm="19:00", end_utc=at(wed, "22:00"))
    assert result == [span(wed, "19:00", "22:00")]


def test_gaps_end_defaults_to_bedtime_for_past_days_and_now_for_today(conn, monkeypatch):
    wed = date(2026, 10, 7)
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(date(2026, 10, 8), "12:00"))
    assert rules.gaps(conn, wed)[-1] == span(wed, "19:00", "23:30")          # past day: ends at bedtime
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(wed, "20:15"))
    assert rules.gaps(conn, wed)[-1] == span(wed, "19:00", "20:15")          # today: ends now
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(wed, "07:00"))
    assert rules.gaps(conn, wed) == []                                       # before morning time


def test_gaps_leave_the_end_of_a_left_early_day_open(conn):
    wed = date(2026, 10, 7)
    rules.close_job_block(conn, wed, "left_early")               # job logged 10:00-17:00
    result = rules.gaps(conn, wed, end_utc=at(wed, "23:30"))
    assert span(wed, "17:00", "23:30") in result
    assert span(wed, "07:30", "10:00") in result


def test_gaps_ignore_deleted_entries(conn):
    wed = date(2026, 10, 7)
    entry_id = log(conn, wed, "20:00", 60)
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry_id,))
    assert rules.gaps(conn, wed, end_utc=at(wed, "23:30"))[-1] == span(wed, "19:00", "23:30")


# --------------------------------------------------------------------------
# overrun_ratio
# --------------------------------------------------------------------------

def test_overrun_ratio_none_without_history(conn, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(date(2026, 10, 20), "12:00"))
    assert rules.overrun_ratio(conn) is None


def test_overrun_ratio_overall_and_by_category(conn, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(date(2026, 10, 20), "12:00"))
    day1, day2 = date(2026, 10, 14), date(2026, 10, 15)
    py = rules.add_plan_block(conn, day1, "Python", 60, "19:30")
    log(conn, day1, "19:30", 30, plan_block_id=py)                            # 30 of 60
    math = rules.add_plan_block(conn, day2, "Math", 40, "19:30")
    log(conn, day2, "19:30", 40, category="Math", plan_block_id=math)         # 40 of 40
    rules.add_plan_block(conn, day2, "Python", 100, "21:00")                  # nothing done
    assert rules.overrun_ratio(conn) == pytest.approx(70 / 200)
    assert rules.overrun_ratio(conn, "Math") == pytest.approx(1.0)
    assert rules.overrun_ratio(conn, "Python") == pytest.approx(30 / 160)
    assert rules.overrun_ratio(conn, "Papers") is None


def test_overrun_ratio_ignores_today_and_old_weeks(conn, monkeypatch):
    today = date(2026, 10, 20)
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(today, "12:00"))
    rules.add_plan_block(conn, today, "Python", 60, "19:30")                  # today: still in progress
    rules.add_plan_block(conn, today - timedelta(days=40), "Python", 60, "19:30")   # older than 4 weeks
    assert rules.overrun_ratio(conn) is None
    assert rules.overrun_ratio(conn, weeks=8) == 0.0                          # 40 days old is inside 8 weeks


def test_overrun_ratio_caps_each_block_at_its_plan(conn, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: at(date(2026, 10, 20), "12:00"))
    d = date(2026, 10, 15)
    block = rules.add_plan_block(conn, d, "Python", 30, "19:30")
    log(conn, d, "19:30", 120, plan_block_id=block)
    assert rules.overrun_ratio(conn) == pytest.approx(1.0)


# --------------------------------------------------------------------------
# Fix pass: regression tests
# --------------------------------------------------------------------------

def test_a_reason_without_a_choice_keeps_the_lapse_pending(conn):
    """Tapping a reason on the phone must not hide the web banner before skip/repair/let go is chosen."""
    missed, today = date(2026, 10, 7), date(2026, 10, 8)
    conn.execute(
        "INSERT INTO lapses(local_date, reason, created_at) VALUES (?, 'tired', ?)", (missed.isoformat(), db.utc_now_iso())
    )
    assert rules.pending_lapse(conn, today) == missed
    rules.record_lapse(conn, missed, "tired", "repair", None)
    assert rules.pending_lapse(conn, today) is None
    assert rules.open_repair_window(conn, today) == missed


def test_record_lapse_answers_the_lapse_card(conn):
    wed = date(2026, 10, 8)
    conn.execute(
        "INSERT INTO slots(kind, local_date, ref_id, due_utc, status) VALUES ('lapse', ?, 0, '2026-10-08T02:00:00Z', 'pending')",
        (wed.isoformat(),),
    )
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "let_go", None)
    assert conn.execute("SELECT status FROM slots WHERE kind = 'lapse'").fetchone()[0] == "answered"


def test_gaps_open_the_job_hours_on_a_leave_day(conn):
    wed = date(2026, 10, 7)
    assert rules.job_block_closed(conn, wed) is False
    rules.close_job_block(conn, wed, "leave")
    assert rules.is_leave_day(conn, wed) and rules.job_block_closed(conn, wed)
    result = rules.gaps(conn, wed, end_utc=at(wed, "23:30"))
    assert result == [span(wed, "07:30", "23:30")]
    # changing your mind restores the job window
    rules.close_job_block(conn, wed, "usual")
    assert not rules.is_leave_day(conn, wed)
    assert rules.gaps(conn, wed, end_utc=at(wed, "23:30")) == [span(wed, "07:30", "10:00"), span(wed, "19:00", "23:30")]


def test_block_done_counts_overlapping_same_category_entries(conn):
    """A focus session or typed log that was never linked to the block still counts as the block's time."""
    tue = date(2026, 10, 13)
    rules.add_plan_block(conn, tue, "Python", 60, "19:30")
    log(conn, tue, "19:30", 60)                               # unlinked, same window
    rules.add_plan_block(conn, tue, "Math", 60, "21:00")
    log(conn, tue, "21:00", 30, category="Python")            # wrong category: not credited to Math
    week = rules.week_summary(conn, tue, today=date(2026, 10, 16))
    assert week.planned_minutes == 120
    assert week.planned_done_minutes == 60


def test_block_done_overlap_is_clipped_to_the_window_and_merged(conn):
    tue = date(2026, 10, 13)
    block = rules.add_plan_block(conn, tue, "Python", 60, "19:30")
    log(conn, tue, "19:00", 45)        # 19:00-19:45: only 15 minutes are inside the window
    log(conn, tue, "19:40", 20)        # 19:40-20:00: overlaps the first one; union inside = 19:30-20:00
    row = conn.execute("SELECT * FROM plan_blocks WHERE id = ?", (block,)).fetchone()
    assert rules.block_done_minutes(conn, row) == 30


def test_add_output_and_entry_text_is_cut_to_one_line_lengths(conn):
    tue = date(2026, 10, 13)
    output_id = rules.add_output(conn, tue, "Python", "x" * 5000)
    assert len(conn.execute("SELECT what FROM outputs WHERE id = ?", (output_id,)).fetchone()[0]) == rules.MAX_WHAT_CHARS
    entry_id = log(conn, tue, "19:30", 30, note="n" * 5000)
    assert len(conn.execute("SELECT note FROM entries WHERE id = ?", (entry_id,)).fetchone()[0]) == rules.MAX_NOTE_CHARS
