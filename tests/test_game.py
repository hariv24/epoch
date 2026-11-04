"""Tests for the game layer (epoch/game.py): XP, levels, towers, quests, ledger, payload shapes, guardrails."""
from __future__ import annotations

import json
import random
import sqlite3
from datetime import date, datetime, timedelta

import pytest

from epoch import categories, db, game, rules, timeutil

TZ = "Asia/Kolkata"
MON = date(2026, 10, 5)      # start_date (a Monday); the contract starts on 2026-10-12
D = lambda day: date(2026, 10, 1) + timedelta(days=day - 1)  # noqa: E731 - tiny date helper for readable scenarios

# Late enough in the day that "close the day" style branches are deterministic when passed as `now`.
EVENING = timeutil.at_local(D(14), "22:30", TZ, 4)
MORNING = timeutil.at_local(D(14), "09:00", TZ, 4)


def add(conn, d, hhmm, minutes, cat="Python", deep=True, source="live", note=None):
    start = timeutil.at_local(d, hhmm, TZ, 4)
    return rules.add_entry(conn, start, start + timedelta(minutes=minutes), cat, deep, source, note)


def ship(conn, d, stage="Python", what="a notebook", url=None):
    return rules.add_output(conn, d, stage, what, url)


def kill_entry(conn, entry_id):
    conn.execute("UPDATE entries SET deleted = 1 WHERE id = ?", (entry_id,))


def kill_output(conn, output_id):
    conn.execute("UPDATE outputs SET deleted = 1 WHERE id = ?", (output_id,))


def strings(obj):
    """Every string value in a nested payload."""
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for value in obj.values():
            yield from strings(value)
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            yield from strings(value)


def assert_clean(obj):
    for text in strings(obj):
        assert not game.has_banned_words(text), f"banned word in {text!r}"


def settle(conn, upto, first=5):
    """A floor day (40 min) on every day from `first` up to the day before `upto`, so nothing is missed."""
    for day in range(first, upto):
        add(conn, D(day), "19:45", 40)


def good_week(conn, monday=D(12), outputs=2, days=5):
    """A kept week: `days` floor days of 100 minutes plus `outputs` outputs."""
    for i in range(days):
        add(conn, monday + timedelta(days=i), "19:45", 100, note="numpy")
    for i in range(outputs):
        ship(conn, monday + timedelta(days=i), "Python", f"thing {i}")


# --------------------------------------------------------------------------
# Levels and floors
# --------------------------------------------------------------------------

class TestLevels:
    def test_cumulative_formula_matches_design(self):
        assert game._cum_xp(1) == 0
        assert game._cum_xp(2) == 200
        assert game._cum_xp(5) == 1100
        assert game._cum_xp(10) == 3600
        assert game._cum_xp(20) == 12350
        assert game._cum_xp(30) == 26100

    def test_level_boundaries(self):
        for level in range(1, 60):
            lo = game._cum_xp(level)
            at = game.level_for(lo)
            assert (at.number, at.into) == (level, 0)
            if level > 1:
                assert game.level_for(lo - 1).number == level - 1
            assert game.level_for(lo + 149 + 50 * level).number == level
            assert game.level_for(game._cum_xp(level + 1)).number == level + 1

    def test_level_is_monotonic_and_progress_in_range(self):
        previous = 0
        for xp in range(0, 30000, 37):
            lv = game.level_for(xp)
            assert lv.number >= previous
            previous = lv.number
            assert 0 <= lv.progress < 1
            assert lv.into + lv.to_next == lv.needed == 150 + 50 * lv.number

    def test_negative_xp_is_level_one(self):
        assert game.level_for(-50).number == 1

    def test_district_names(self):
        expected = {1: "Morningside Heights", 2: "Morningside Heights", 3: "Harlem", 4: "Harlem", 7: "Central Park", 8: "Central Park",
                    13: "Midtown & Times Square", 14: "Midtown & Times Square", 27: "Upper Manhattan", 28: "Upper Manhattan",
                    29: "Billionaires' Row", 80: "Billionaires' Row"}
        for level, name in expected.items():
            assert game.district_for(level) == name

    def test_design_example_level_seven(self):
        lv = game.level_for(game._cum_xp(7) + 330)
        assert (lv.number, lv.district, lv.into, lv.needed) == (7, "Central Park", 330, 500)

    def test_floors_for(self):
        assert game.floors_for(0) == 0
        assert game.floors_for(14) == 0
        assert game.floors_for(15) == 1
        assert game.floors_for(30) == 2
        assert game.floors_for(90) == 6
        assert game.floors_for(240) == 16
        assert game.floors_for(600) == 16          # zoning limit
        assert game.floors_for(60, minutes_per_floor=20) == 3


# --------------------------------------------------------------------------
# XP
# --------------------------------------------------------------------------

class TestXP:
    def test_empty_day_is_zero(self, conn):
        x = game.day_xp(conn, D(7), today=D(8))
        assert x.total == 0

    def test_future_and_before_start_are_zero(self, conn):
        assert game.day_xp(conn, D(30), today=D(8)).total == 0
        assert game.day_xp(conn, date(2026, 9, 1), today=D(8)).total == 0

    def test_deep_minutes_pay_one_xp_per_four_minutes(self, conn):
        add(conn, D(7), "19:45", 20)
        x = game.day_xp(conn, D(7), today=D(8))
        assert x.deep == 5 and x.floor == 0 and x.target == 0

    def test_floor_and_target_bonuses(self, conn):
        add(conn, D(7), "19:45", 100)
        x = game.day_xp(conn, D(7), today=D(8))
        assert (x.deep, x.floor, x.target) == (25, 10, 15)
        assert x.total == 25 + 10 + 15 + x.comeback

    def test_hours_past_the_cap_add_nothing(self, conn):
        add(conn, D(10), "10:00", 240)            # a Saturday, exactly the cap
        at_cap = game.day_xp(conn, D(10), today=D(12))
        add(conn, D(10), "14:00", 300)            # five more hours the same day
        over = game.day_xp(conn, D(10), today=D(12))
        assert at_cap.deep == 60
        assert over.deep == 60 and over.total == at_cap.total
        assert rules.day_summary(conn, D(10), today=D(12)).deep_minutes == 540   # shown, never counted

    def test_output_xp_and_link_bonus(self, conn):
        ship(conn, D(7), "Python", "no link")
        ship(conn, D(7), "Math", "with link", "https://example.com/x")
        x = game.day_xp(conn, D(7), today=D(8))
        assert x.outputs == 100 + (100 + 25)
        assert x.floor == 10                      # an output also satisfies the floor

    def test_only_three_outputs_per_day_earn_xp(self, conn):
        for i in range(3):
            ship(conn, D(7), "Python", f"o{i}", "https://example.com/" + str(i))
        three = game.day_xp(conn, D(7), today=D(8)).outputs
        ship(conn, D(7), "Python", "fourth", "https://example.com/4")
        ship(conn, D(7), "Math", "fifth")
        four = game.day_xp(conn, D(7), today=D(8)).outputs
        assert three == 3 * 125 and four == three

    def test_comeback_xp(self, conn):
        add(conn, D(5), "19:45", 40)              # floor
        # 10-06 missed, 10-07 floor => comeback
        add(conn, D(7), "19:45", 40)
        x = game.day_xp(conn, D(7), today=D(8))
        assert x.comeback == 30
        assert game.day_xp(conn, D(5), today=D(8)).comeback == 0

    def test_week_bonus_only_when_kept(self, conn):
        good_week(conn)
        assert game.week_xp_bonus(conn, D(12), today=D(18)) == 100
        assert game.week_xp_bonus(conn, D(5), today=D(18)) == 0     # baseline week

    def test_total_includes_days_week_and_nodes(self, conn):
        good_week(conn)
        today = D(18)
        days = sum(game.day_xp(conn, MON + timedelta(days=i), today=today).total for i in range(14))
        node_xp = 50 * sum(lad.nodes_unlocked for lad in game.ladders(conn, today=today))
        assert game.xp_total(conn, today=today) == days + 100 + node_xp

    def test_closed_day_pays_even_when_everything_is_unknown(self, conn):
        # a leave day: no job, the whole waking day labelled "Don't remember"
        rules.close_job_block(conn, D(7), "leave")
        wake = timeutil.at_local(D(7), "07:30", TZ, 4)
        bed = timeutil.at_local(D(7), "23:30", TZ, 4)
        rules.add_entry(conn, wake, bed, "Unknown", False, "backfill")
        assert game.day_closed(conn, D(7), today=D(8))
        assert game.day_xp(conn, D(7), today=D(8)).closed == 10

    @pytest.mark.parametrize("seed", [1, 2, 3, 4, 5, 6])
    def test_displayed_xp_never_decreases_under_random_add_and_delete(self, conn, seed):
        rng = random.Random(seed)
        today = D(18)
        entries, outs = [], []
        last = game.xp_banked(conn, today=today)
        for _ in range(60):
            op = rng.choice(["entry", "entry", "output", "kill_entry", "kill_output", "rest", "entry"])
            day = D(rng.randint(5, 18))
            if op == "entry":
                cat = rng.choice(list(categories.LADDER) + ["Rest", "Distracted"])
                entries.append(add(conn, day, rng.choice(["08:00", "12:00", "19:30"]), rng.choice([15, 30, 45, 90, 240, 400]),
                                   cat=cat, deep=cat in categories.LADDER))
            elif op == "output":
                outs.append(ship(conn, day, rng.choice(list(categories.LADDER)), "x", rng.choice([None, "https://e.com"])))
            elif op == "kill_entry" and entries:
                kill_entry(conn, entries.pop(rng.randrange(len(entries))))
            elif op == "kill_output" and outs:
                kill_output(conn, outs.pop(rng.randrange(len(outs))))
            elif op == "rest":
                rules.use_skip(conn, day, "rest")
            game.sync_unlocks(conn, today=today)
            now = game.xp_banked(conn, today=today)
            assert now >= last, f"XP fell from {last} to {now} after {op}"
            last = now

    def test_computed_xp_can_fall_but_banked_does_not(self, conn):
        today = D(8)
        entry = add(conn, D(7), "19:45", 100)
        oid = ship(conn, D(7), "Python", "x", "https://e.com")
        game.sync_unlocks(conn, today=today)
        banked = game.xp_banked(conn, today=today)
        kill_entry(conn, entry)
        kill_output(conn, oid)
        assert game.xp_total(conn, today=today) < banked
        assert game.xp_banked(conn, today=today) == banked
        game.sync_unlocks(conn, today=today)
        assert game.xp_banked(conn, today=today) == banked

    def test_ratchet_row_is_the_only_xp_state(self, conn):
        add(conn, D(7), "19:45", 100)
        game.sync_unlocks(conn, today=D(8))
        row = conn.execute("SELECT kind, meta FROM unlocks WHERE key = 'xp_hw'").fetchone()
        assert row["kind"] == "ratchet"
        assert json.loads(row["meta"])["xp"] == game.xp_total(conn, today=D(8))


# --------------------------------------------------------------------------
# Runs, closing
# --------------------------------------------------------------------------

class TestRunsAndClosing:
    def test_best_run_replays_history(self, conn):
        for day in (5, 6, 7, 9):                   # 3 floor days, a missed day, one more floor day
            add(conn, D(day), "19:45", 40)
        # 10-08 stays missed (10-10 is missed too), 10-10 and 10-11 are missed
        assert game.best_run(conn, today=D(12)) == 3
        assert rules.current_run(conn, today=D(12)) == 0

    def test_repaired_days_keep_the_run(self, conn):
        for day in (5, 7, 8):                      # 10-06 is repaired by the two floor days after it
            add(conn, D(day), "19:45", 40)
        assert game.best_run(conn, today=D(9)) == 4

    def test_open_today_does_not_break_best_run(self, conn):
        for day in (5, 6, 7):
            add(conn, D(day), "19:45", 40)
        assert game.best_run(conn, today=D(8)) == 3

    def test_rest_days_extend_the_run(self, conn):
        add(conn, D(5), "19:45", 40)
        rules.use_skip(conn, D(6), "rest")
        add(conn, D(7), "19:45", 40)
        assert game.best_run(conn, today=D(8)) == 3

    def test_day_closed_needs_labelled_gaps_and_job_block(self, conn):
        d = D(13)                                  # Tuesday: a job day
        assert not game.day_closed(conn, d, today=D(14))      # empty day
        add(conn, d, "19:45", 60)
        assert not game.day_closed(conn, d, today=D(14))      # gaps remain
        rules.close_job_block(conn, d, "usual")
        assert not game.day_closed(conn, d, today=D(14))      # still gaps (morning, evening)
        for g_start, g_end in rules.gaps(conn, d, end_utc=timeutil.at_local(d, "23:30", TZ, 4)):
            rules.add_entry(conn, g_start, g_end, "Rest", False, "backfill")
        assert game.day_closed(conn, d, today=D(14))

    def test_job_day_open_job_block_is_not_closed(self, conn):
        d = D(13)
        wake, bed = timeutil.at_local(d, "07:30", TZ, 4), timeutil.at_local(d, "23:30", TZ, 4)
        rules.add_entry(conn, wake, bed, "Rest", False, "backfill")     # covers everything but has no job block
        assert not game.day_closed(conn, d, today=D(14))
        rules.close_job_block(conn, d, "leave")
        assert game.day_closed(conn, d, today=D(14))


# --------------------------------------------------------------------------
# Ladders
# --------------------------------------------------------------------------

class TestLadders:
    def by_cat(self, conn, today):
        return {lad.category: lad for lad in game.ladders(conn, today=today)}

    def test_empty_ladders(self, conn):
        lads = game.ladders(conn, today=D(8))
        assert [lad.category for lad in lads] == list(categories.LADDER)
        assert all(lad.nodes_unlocked == 0 and lad.next_node.n == 1 for lad in lads)
        assert [lad.landmark for lad in lads] == ["Brooklyn Bridge", "Empire State Building", "Chrysler Building", "Butler Library", "One Times Square"]

    def test_first_node_needs_one_output_only(self, conn):
        ship(conn, D(7), "Math", "matrices")
        lad = self.by_cat(conn, D(8))["Math"]
        assert lad.nodes_unlocked == 1 and lad.nodes[0].name == "Vector Basics"
        assert lad.next_node.n == 2 and lad.next_node.needs_outputs == 3 and lad.next_node.needs_deep_min == 300

    def test_second_node_needs_hours_as_well(self, conn):
        for i in range(3):
            ship(conn, D(5 + i), "Python", f"o{i}")
        assert self.by_cat(conn, D(8))["Python"].nodes_unlocked == 1     # outputs alone are not enough
        for i in range(3):
            add(conn, D(5 + i), "10:00", 100, cat="Python")                # 300 deep minutes
        assert self.by_cat(conn, D(8))["Python"].nodes_unlocked == 2

    def test_node_four_needs_a_link(self, conn):
        today = D(30)
        for i in range(10):
            ship(conn, D(5) + timedelta(days=i), "Papers", f"p{i}")
            add(conn, D(5) + timedelta(days=i), "10:00", 240, cat="Papers")   # 40 h
        assert self.by_cat(conn, today)["Papers"].nodes_unlocked == 3
        ship(conn, D(5), "Papers", "linked", "https://example.com/p")
        assert self.by_cat(conn, today)["Papers"].nodes_unlocked == 4

    def test_deep_hours_in_a_ladder_respect_the_daily_cap(self, conn):
        add(conn, D(10), "06:00", 600, cat="Math")                         # ten hours in one day
        assert self.by_cat(conn, D(12))["Math"].deep_minutes == 240

    def test_next_text_is_informational(self, conn):
        ship(conn, D(7), "Math", "m")
        text = self.by_cat(conn, D(8))["Math"].next_text()
        assert text == "Next node: 2 more outputs and 5h of Math."
        assert not game.has_banned_words(text)

    def test_node_unlock_adds_xp(self, conn):
        settle(conn, 7)
        before = game.xp_total(conn, today=D(8))
        ship(conn, D(7), "Math", "m")
        gained = game.xp_total(conn, today=D(8)) - before
        assert gained == 100 + 10 + 50            # output + floor day + node


# --------------------------------------------------------------------------
# Towers
# --------------------------------------------------------------------------

class TestTowers:
    def tower(self, conn, d, today):
        return game.world_state(conn, today=today)["days"][[x["date"] for x in game.world_state(conn, today=today)["days"]].index(d.isoformat())]

    def test_open_empty_day_is_a_lot(self, conn):
        t = self.tower(conn, D(8), D(8))
        assert t["state"] == "lot" and t["floors"] == 0 and not t["doors"] and not t["crown"]
        assert t["is_today"] and t["status"] == "open"

    def test_building_below_the_floor(self, conn):
        add(conn, D(8), "19:45", 20)
        t = self.tower(conn, D(8), D(8))
        assert t["state"] == "building" and t["floors"] == 1 and not t["doors"]

    def test_doors_open_at_two_floors(self, conn):
        add(conn, D(8), "19:45", 30)
        t = self.tower(conn, D(8), D(8))
        assert t["floors"] == 2 and t["doors"] and not t["crown"] and t["state"] == "doors"

    def test_doors_open_on_an_output_alone(self, conn):
        ship(conn, D(8), "Python", "x")
        t = self.tower(conn, D(8), D(8))
        assert t["doors"] and t["floors"] == 0 and t["beacons"] == ["Python"]
        assert t["outputs"][0]["what"] == "x"

    def test_crown_at_target_with_floor_six_on_a_weekday(self, conn):
        add(conn, D(8), "19:45", 90)
        t = self.tower(conn, D(8), D(8))
        assert t["crown"] and t["state"] == "crown" and t["floors"] == 6 and t["target_floor"] == 6

    def test_weekend_target_floor_is_twelve(self, conn):
        t = self.tower(conn, D(10), D(10))                 # Saturday
        assert t["target_floor"] == 12

    def test_floors_stop_at_sixteen_and_show_the_overflow(self, conn):
        add(conn, D(10), "06:00", 300)                     # Saturday, five hours
        t = self.tower(conn, D(10), D(10))
        assert t["floors"] == 16 and t["over_cap_min"] == 60 and t["crown"]

    def test_lamps_for_honest_logs_never_for_study(self, conn):
        add(conn, D(8), "19:00", 20, cat="Distracted", deep=False)
        add(conn, D(8), "19:30", 30, cat="Rest", deep=False)
        add(conn, D(8), "20:00", 30, cat="Python")
        add(conn, D(8), "21:00", 20, cat="Distracted", deep=False)
        t = self.tower(conn, D(8), D(8))
        assert {"category": "Distracted", "n": 2} in t["lamps"] and {"category": "Rest", "n": 1} in t["lamps"]
        assert t["lamp_count"] == 3

    def test_job_block_makes_no_lamp(self, conn):
        rules.close_job_block(conn, D(8), "usual")
        assert self.tower(conn, D(8), D(8))["lamp_count"] == 0

    def test_unknown_makes_fog_not_a_lamp(self, conn):
        add(conn, D(8), "19:00", 45, cat="Unknown", deep=False)
        t = self.tower(conn, D(8), D(8))
        assert t["lamp_count"] == 0 and t["unknown_minutes"] == 45 and t["fog_minutes"] >= 45

    def test_unlogged_hours_are_fog_on_a_day_with_content(self, conn):
        add(conn, D(7), "19:45", 60)
        t = self.tower(conn, D(7), D(8))
        assert t["unlogged_minutes"] > 0 and t["fog_minutes"] == t["unknown_minutes"] + t["unlogged_minutes"]

    def test_empty_past_day_has_no_fog(self, conn):
        t = self.tower(conn, D(7), D(8))
        assert t["fog_minutes"] == 0 and t["state"] == "scaffold" and t["scaffold"] and t["status"] == "missed"

    def test_rest_day_is_a_park(self, conn):
        rules.use_skip(conn, D(7), "rest")
        t = self.tower(conn, D(7), D(8))
        assert t["state"] == "park" and t["park"] and t["mark"] == "rest" and not t["scaffold"]

    def test_future_day(self, conn):
        t = self.tower(conn, D(11), D(8))
        assert t["state"] == "future" and t["floors"] == 0 and t["status"] == "future"

    def test_repaired_day_is_finished(self, conn):
        # 10-06 missed, floor on 10-07 and 10-08, today is 10-09
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        add(conn, D(8), "19:45", 40)
        t = self.tower(conn, D(6), D(9))
        assert t["status"] == "repaired" and t["state"] == "repaired" and not t["scaffold"]

    def test_open_repair_window_keeps_scaffolding(self, conn):
        add(conn, D(5), "19:45", 40)
        rules.record_lapse(conn, D(6), "tired", "repair", None)
        add(conn, D(7), "19:45", 40)
        t = self.tower(conn, D(6), D(7))
        assert t["scaffold"] and t["repair_open"]

    def test_comeback_day_has_a_crane(self, conn):
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        t = self.tower(conn, D(7), D(7))
        assert t["crane"] and t["is_comeback"]
        assert not self.tower(conn, D(5), D(7))["crane"]

    def test_closed_flag_and_stars(self, conn):
        add(conn, D(7), "19:45", 40)
        assert self.tower(conn, D(7), D(8))["stars"] == 2          # entry + doors (40 min: no third)
        ship(conn, D(7), "Python", "x")
        assert self.tower(conn, D(7), D(8))["stars"] == 2          # shipping alone is not the third star
        add(conn, D(7), "20:30", 200)                               # 40 + 200 = 4 hours of deep focus
        assert self.tower(conn, D(7), D(8))["stars"] == 3


# --------------------------------------------------------------------------
# Quests
# --------------------------------------------------------------------------

class TestQuests:
    def test_empty_day_shows_three_open_quests(self, conn):
        settle(conn, 14)
        qs = game.quests(conn, today=D(14), now=MORNING)
        assert [q.key for q in qs] == ["first_light", "doors", "deep_focus"]
        assert qs[2].label == "Deep focus 4h today" and qs[2].detail == "0m of 4h"
        assert not any(q.done for q in qs)

    def test_never_more_than_three_and_always_at_least_one(self, conn):
        settle(conn, 14)
        scenarios = [
            lambda: None,
            lambda: add(conn, D(14), "09:00", 20),
            lambda: add(conn, D(14), "10:00", 100),
            lambda: ship(conn, D(14), "Python", "x"),
            lambda: rules.add_plan_block(conn, D(14), "Python", 60, "20:00", "ch.6"),
        ]
        for step in scenarios:
            step()
            for now in (MORNING, EVENING):
                qs = game.quests(conn, today=D(14), now=now)
                assert 1 <= len(qs) <= 3
        assert_clean([q.as_dict() for q in qs])

    def test_first_light_is_any_honest_log(self, conn):
        settle(conn, 14)
        add(conn, D(14), "09:00", 20, cat="Distracted", deep=False)
        assert game.quests(conn, today=D(14), now=MORNING)[0].done

    def test_doors_become_crown_then_done(self, conn):
        settle(conn, 14)
        add(conn, D(14), "09:00", 40)
        q2 = game.quests(conn, today=D(14), now=MORNING)[1]
        assert q2.key == "crown" and q2.label == "50m to the crown" and not q2.done
        add(conn, D(14), "10:00", 60)
        q2 = game.quests(conn, today=D(14), now=MORNING)[1]
        assert q2.key == "crown" and q2.done

    def test_third_quest_is_deep_focus_with_plain_progress(self, conn):
        settle(conn, 14)
        add(conn, D(14), "09:00", 130)
        q3 = game.quests(conn, today=D(14), now=MORNING)[2]
        assert q3.key == "deep_focus" and q3.label == "Deep focus 4h today" and not q3.done
        assert q3.detail == "2h 10m of 4h"
        ship(conn, D(14), "Python", "x")                           # an output does not count toward it
        assert not game.quests(conn, today=D(14), now=MORNING)[2].done
        add(conn, D(14), "11:30", 110)
        q3 = game.quests(conn, today=D(14), now=MORNING)[2]
        assert q3.done and q3.label == "Deep focus 4h today" and q3.detail == "4h of 4h, star earned"

    def test_third_quest_ignores_shallow_time(self, conn):
        settle(conn, 14)
        add(conn, D(14), "09:00", 300, cat="Distracted", deep=False)
        assert not game.quests(conn, today=D(14), now=MORNING)[2].done

    def test_third_quest_no_longer_mentions_a_smallest_version(self, conn):
        # 10-06 missed, today 10-07: a pending lapse no longer takes the third slot
        add(conn, D(5), "19:45", 40)
        q3 = game.quests(conn, today=D(7), now=MORNING)[2]
        assert q3.key == "deep_focus" and "smallest" not in q3.label

    def test_goal_is_a_setting_and_minutes_are_not_capped_at_240(self, conn):
        settle(conn, 14)
        db.set_setting(conn, "deep_star_minutes", 300)              # 5 hours
        add(conn, D(14), "08:00", 270)                              # 4h30m: past the 240 cap, short of 5 h
        q3 = game.quests(conn, today=D(14), now=MORNING)[2]
        assert q3.label == "Deep focus 5h today" and q3.detail == "4h 30m of 5h" and not q3.done
        assert game.today_state(conn, today=D(14), now=MORNING)["tower"]["floors"] == 16          # the tower stays topped out at 16
        add(conn, D(14), "13:00", 30)
        q3 = game.quests(conn, today=D(14), now=MORNING)[2]
        assert q3.done and game.today_state(conn, today=D(14), now=MORNING)["stars"] == 3

    @pytest.mark.parametrize("hours,minutes_logged,earned", [(3, 179, False), (3, 180, True), (4, 239, False), (4, 240, True),
                                                                (5, 299, False), (5, 300, True), (6, 359, False), (6, 360, True)])
    def test_star_thresholds_for_each_choice(self, conn, hours, minutes_logged, earned):
        settle(conn, 14)
        db.set_setting(conn, "deep_star_minutes", hours * 60)
        add(conn, D(14), "06:00", minutes_logged)
        assert (game.today_state(conn, today=D(14), now=MORNING)["stars"] == 3) is earned
        assert game.quests(conn, today=D(14), now=MORNING)[2].done is earned

    def test_garbage_setting_falls_back_to_four_hours(self, conn):
        db.set_setting(conn, "deep_star_minutes", "lots")
        assert game.deep_star_minutes(db.all_settings(conn)) == 240
        db.set_setting(conn, "deep_star_minutes", 5)
        assert game.deep_star_minutes(db.all_settings(conn)) == 60

    def test_the_goal_never_changes_xp_or_the_banked_total(self, conn):
        settle(conn, 14)
        add(conn, D(14), "06:00", 300)
        xp4 = (game.day_xp(conn, D(14), today=D(14)).total, game.xp_total(conn, today=D(14)))
        db.set_setting(conn, "deep_star_minutes", 360)
        assert (game.day_xp(conn, D(14), today=D(14)).total, game.xp_total(conn, today=D(14))) == xp4

    def test_minutes_after_the_sleep_cutoff_do_not_count_toward_the_star(self, conn):
        settle(conn, 14)
        add(conn, D(14), "22:00", 150)                              # 22:00 to 00:30 counts (150 min)
        add(conn, D(14), "00:30", 120)                              # 00:30 to 02:30 on the next calendar day: past the cutoff
        add(conn, D(14), "20:00", 30)
        q3 = game.quests(conn, today=D(14), now=MORNING)[2]
        assert q3.detail == "3h of 4h" and not q3.done

    def test_quests_carry_no_xp_field(self, conn):
        assert all(set(q.as_dict()) == {"key", "label", "done", "detail"} for q in game.quests(conn, today=D(14), now=MORNING))

    def test_all_quest_copy_is_clean(self):
        for text in ("Log one hour of anything, rest and drift count", "Deep focus 4h today", "2h 10m of 4h",
                     "4h of 4h, star earned"):
            assert not game.has_banned_words(text)


# --------------------------------------------------------------------------
# Tower status line, day rollover and sleep cutoff (plain words)
# --------------------------------------------------------------------------

class TestTowerLineAndRollover:
    def state(self, conn, now=MORNING):
        return game.today_state(conn, today=D(14), now=now)

    def test_tower_line_reads_like_a_sentence(self, conn):
        settle(conn, 14)
        assert self.state(conn)["today"]["tower_line"] == "Empty lot · first floor in 15 min · doors at floor 2 · crown at floor 6"
        add(conn, D(14), "09:00", 111)                             # 7 floors, 6 minutes into the next
        line = self.state(conn)["today"]["tower_line"]
        assert line == "Floor 7 of 16 · next floor in 9 min · crown at floor 6 ✓"

    def test_tower_line_when_topped_out(self, conn):
        settle(conn, 14)
        add(conn, D(14), "08:00", 330)
        t = self.state(conn)
        assert t["today"]["tower_line"] == "Topped out at 16 floors · crown at floor 6 ✓"
        assert t["tower"]["next_floor_min"] is None and t["tower"]["max_floors"] == 16

    def test_note_inside_the_late_night_window(self, conn):
        night = timeutil.at_local(D(14), "02:30", TZ, 4)           # 2:30 AM Thursday: still Wednesday's day
        note = self.state(conn, night)["rollover"]
        assert note["late_window"] and note["until"] == "4:00 AM"
        assert note["day_text"] == "Still Wednesday's day until 4:00 AM. Late-night study counts for Wednesday."

    def test_no_note_in_the_daytime(self, conn):
        note = self.state(conn)["rollover"]
        assert not note["late_window"] and note["day_text"] == "" and note["cutoff_text"] == ""

    def test_note_follows_day_start_hour(self, conn):
        db.set_setting(conn, "day_start_hour", 0)
        assert self.state(conn, timeutil.at_local(D(14), "02:30", TZ, 0))["rollover"]["day_text"] == ""
        db.set_setting(conn, "day_start_hour", 6)
        text = self.state(conn, timeutil.at_local(D(14), "05:30", TZ, 6))["rollover"]["day_text"]
        assert "until 6:00 AM" in text

    def test_past_the_cutoff_says_minutes_are_shown_but_do_not_count(self, conn):
        night = timeutil.at_local(D(14), "01:30", TZ, 4)
        note = self.state(conn, night)["rollover"]
        assert "12:30 AM sleep cutoff" in note["cutoff_text"] and "do not count" in note["cutoff_text"]
        assert "Settings" in note["cutoff_text"]

    def test_logged_late_minutes_are_reported(self, conn):
        add(conn, D(14), "00:30", 45)                              # 00:30 to 01:15, all after the cutoff
        add(conn, D(14), "09:00", 20)
        note = self.state(conn, timeutil.at_local(D(14), "10:00", TZ, 4))["rollover"]
        assert note["late_minutes"] == 45 and note["cutoff_label"] == "12:30 AM"
        assert "45m of deep focus came after your 12:30 AM sleep cutoff" in note["cutoff_text"]
        assert "does not count" in note["cutoff_text"]

    def test_cutoff_off_counts_every_minute(self, conn):
        add(conn, D(14), "00:30", 45)
        db.set_setting(conn, "sleep_cutoff", "off")
        assert rules.day_summary(conn, D(14), D(14)).deep_minutes == 45
        note = self.state(conn)["rollover"]
        assert note["cutoff_label"] is None and note["cutoff_text"] == "" and note["late_minutes"] == 0

    def test_a_cutoff_that_cannot_fit_the_day_is_ignored_not_destructive(self, conn):
        db.set_setting(conn, "day_start_hour", 0)                  # a midnight day cannot have a 00:30 cutoff
        start = timeutil.at_local(D(14), "10:00", TZ, 0)
        rules.add_entry(conn, start, start + timedelta(minutes=60), "Python", True, "live", None)
        assert rules.day_summary(conn, D(14), D(14)).deep_minutes == 60

    def test_changing_day_start_recuts_days_without_touching_entries(self, conn):
        db.set_setting(conn, "sleep_cutoff", "off")                # so 2 AM counts either way
        add(conn, D(13), "23:00", 30)
        add(conn, D(14), "02:00", 60)                              # 2 AM Thursday: Wednesday's day at 4, Thursday's at 0
        before = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        assert rules.day_summary(conn, D(14), D(15)).deep_minutes == 60
        db.set_setting(conn, "day_start_hour", 0)
        assert rules.day_summary(conn, D(14), D(15)).deep_minutes == 0
        assert rules.day_summary(conn, D(15), D(15)).deep_minutes == 60
        db.set_setting(conn, "day_start_hour", 4)
        assert rules.day_summary(conn, D(14), D(15)).deep_minutes == 60
        assert conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == before

    def test_howto_numbers_follow_the_settings(self, conn):
        h = game.tower_howto(conn)
        assert (h["mpf"], h["max_floors"], h["door_min"], h["door_floor"]) == (15, 16, 30, 2)
        assert (h["weekday_text"], h["weekday_floor"], h["weekend_text"], h["weekend_floor"]) == ("1h 30m", 6, "3h", 12)
        assert h["star_text"] == "4h" and h["cutoff_label"] == "12:30 AM" and h["day_starts"] == "4:00 AM"
        db.set_setting(conn, "deep_star_minutes", 300)
        db.set_setting(conn, "sleep_cutoff", "off")
        h = game.tower_howto(conn)
        assert h["star_text"] == "5h" and h["cutoff_label"] is None

    def test_all_new_copy_is_clean(self, conn):
        add(conn, D(14), "00:30", 45)
        note = self.state(conn, timeutil.at_local(D(14), "02:00", TZ, 4))["rollover"]
        assert_clean(note)
        assert_clean(self.state(conn)["today"]["tower_line"])


# --------------------------------------------------------------------------
# Achievements, ledger, sync
# --------------------------------------------------------------------------

class TestAchievementsAndLedger:
    def by_key(self, conn, today):
        return {a.key: a for a in game.achievements(conn, today=today)}

    def test_all_defined_with_tiers(self, conn):
        achs = game.achievements(conn, today=D(8))
        assert len(achs) == len({a.key for a in achs}) >= 29
        assert {a.tier for a in achs} == {"Easy", "Mid", "Rare", "Epic"}
        assert not any(a.unlocked for a in achs)

    def test_first_entry_unlocks_first_light_and_honest_hour(self, conn):
        add(conn, D(8), "19:45", 30, cat="Python")
        a = self.by_key(conn, D(8))
        assert a["first_light"].unlocked and not a["honest_hour"].unlocked
        add(conn, D(8), "21:00", 20, cat="Distracted", deep=False)
        assert self.by_key(conn, D(8))["honest_hour"].unlocked

    def test_ship_achievements(self, conn):
        ship(conn, D(7), "Python", "a", "https://e.com")
        a = self.by_key(conn, D(8))
        assert a["first_ship"].unlocked and a["linked_ship"].unlocked and a["first_floor"].unlocked
        assert not a["five_ships"].unlocked

    def test_all_five_ladders(self, conn):
        for cat in categories.LADDER:
            ship(conn, D(7), cat, "x")
        a = self.by_key(conn, D(8))
        assert a["all_five"].unlocked and a["five_ships"].unlocked and a["node_first"].unlocked

    def test_crown_x3_and_kept_week(self, conn):
        good_week(conn)
        a = self.by_key(conn, D(18))
        assert a["crown_x3"].unlocked and a["week_kept"].unlocked and not a["four_kept"].unlocked

    def test_comebacks(self, conn):
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        a = self.by_key(conn, D(8))
        assert a["first_comeback"].unlocked and not a["comeback_3"].unlocked

    def test_fog_lifter_counts_labelled_backfill(self, conn):
        for i in range(9):
            add(conn, D(7), f"{8 + i:02d}:00", 30, cat="Rest", deep=False, source="backfill")
        assert not self.by_key(conn, D(8))["fog_lifter"].unlocked
        add(conn, D(7), "20:00", 30, cat="Food", deep=False, source="aw")
        assert self.by_key(conn, D(8))["fog_lifter"].unlocked

    def test_unknown_backfill_does_not_count_as_lifting_fog(self, conn):
        for i in range(10):
            add(conn, D(7), f"{8 + i:02d}:00", 30, cat="Unknown", deep=False, source="backfill")
        assert not self.by_key(conn, D(8))["fog_lifter"].unlocked

    def test_early_floor(self, conn):
        add(conn, D(7), "09:00", 40)                      # floor reached by ~09:30
        assert self.by_key(conn, D(8))["early_floor"].unlocked

    def test_evening_floor_is_not_early(self, conn):
        add(conn, D(7), "19:45", 40)
        assert not self.by_key(conn, D(8))["early_floor"].unlocked

    def test_first_focus_needs_a_real_session(self, conn):
        conn.execute(
            "INSERT INTO focus_sessions(start_utc, planned_minutes, category, outcome) VALUES (?, 25, 'Python', 'cancelled')",
            (timeutil.to_iso(timeutil.at_local(D(7), "10:00", TZ, 4)),))
        assert not self.by_key(conn, D(8))["first_focus"].unlocked
        conn.execute(
            "INSERT INTO focus_sessions(start_utc, planned_minutes, category, outcome) VALUES (?, 25, 'Python', 'mostly')",
            (timeutil.to_iso(timeutil.at_local(D(7), "11:00", TZ, 4)),))
        assert self.by_key(conn, D(8))["first_focus"].unlocked

    def test_honest_week_needs_seven_days_in_a_row(self, conn):
        for day in range(5, 11):
            add(conn, D(day), "21:00", 20, cat="Rest", deep=False)
        assert not self.by_key(conn, D(11))["honest_week"].unlocked
        add(conn, D(11), "21:00", 20, cat="Distracted", deep=False)
        assert self.by_key(conn, D(11))["honest_week"].unlocked

    def test_hour_milestones_use_the_cap(self, conn):
        # 12 Saturdays-worth of 5h days would need many weeks; use a long window instead
        today = D(5) + timedelta(days=60)
        for i in range(13):
            add(conn, D(5) + timedelta(days=i), "06:00", 400)       # counted as 240 each => 52 h
        assert self.by_key(conn, today)["fifty_hours"].unlocked
        assert not self.by_key(conn, today)["hundred_hours"].unlocked

    def test_sync_unlocks_second_call_is_empty(self, conn):
        good_week(conn)
        first = game.sync_unlocks(conn, today=D(18))
        assert "ach:first_light" in first and "ach:week_kept" in first
        assert any(k.startswith("node:Python:") for k in first)
        assert game.sync_unlocks(conn, today=D(18)) == []
        assert game.sync_unlocks(conn, today=D(18)) == []

    def test_upgrade_backfill_is_not_a_fresh_win(self, conn):
        """History earned before the game layer existed is recorded silently, not shown as 'just now'."""
        good_week(conn)
        game.sync_unlocks(conn, today=D(18))
        assert not [w for w in game.wins(conn, today=D(18)) if w["kind"] in ("achievement", "node")]

    def test_first_day_achievements_are_wins(self, conn):
        """A brand-new user's first sync (entries only from today) is not a backfill."""
        add(conn, D(8), "19:45", 40)
        game.sync_unlocks(conn, today=D(8))
        assert [w for w in game.wins(conn, today=D(8)) if w["kind"] == "achievement"]

    def test_sync_sets_game_on_since_once(self, conn):
        game.sync_unlocks(conn, today=D(8))
        assert db.get_setting(conn, "game_on_since") == "2026-10-08"
        game.sync_unlocks(conn, today=D(20))
        assert db.get_setting(conn, "game_on_since") == "2026-10-08"

    def test_unlocks_survive_deleting_the_evidence(self, conn):
        entry = add(conn, D(7), "19:45", 40)
        oid = ship(conn, D(7), "Python", "x")
        game.sync_unlocks(conn, today=D(8))
        kill_entry(conn, entry)
        kill_output(conn, oid)
        a = self.by_key(conn, D(8))
        assert a["first_ship"].unlocked and a["first_light"].unlocked
        assert a["first_ship"].unlocked_at and a["first_ship"].unlocked_at.endswith("Z")
        assert game.sync_unlocks(conn, today=D(8)) == []

    def test_ledger_is_append_only_insert_or_ignore(self, conn):
        add(conn, D(7), "19:45", 40)
        game.sync_unlocks(conn, today=D(8))
        before = dict(conn.execute("SELECT key, unlocked_at FROM unlocks").fetchall())
        game.sync_unlocks(conn, today=D(8))
        after = dict(conn.execute("SELECT key, unlocked_at FROM unlocks").fetchall())
        assert before.keys() <= after.keys()
        assert all(before[k] == after[k] for k in before if k != "xp_hw")

    def test_node_and_district_keys(self, conn):
        ship(conn, D(7), "Math", "m")
        keys = game.sync_unlocks(conn, today=D(8))
        assert "node:Math:1" in keys

    def test_district_unlock_follows_level(self, conn):
        # enough XP for level 3 (Harlem, 450 XP) in a week: outputs are worth the most
        for i, day in enumerate(range(5, 12)):
            for j in range(3):
                ship(conn, D(day), categories.LADDER[(i + j) % 5], f"o{i}{j}", "https://e.com")
        keys = game.sync_unlocks(conn, today=D(12))
        assert game.level_for(game.xp_banked(conn, today=D(12))).number >= 3
        assert "district:Harlem" in keys
        assert self.by_key(conn, D(12))["district_harlem"].unlocked
        assert any(k.startswith("postcard:district:Harlem") for k in keys)

    def test_postcards_are_deterministic_and_conditional(self, conn):
        good_week(conn)
        assert game.postcard_for(conn, "week_kept", "2026-10-12", today=D(18))["id"] == game.POSTCARDS[0]["id"]
        assert game.postcard_for(conn, "week_kept", "2026-10-05", today=D(18)) is None
        assert game.postcard_for(conn, "district", "Queens", today=D(18)) is None
        card = game.postcard_for(conn, "week_kept", "2026-10-12", today=D(18))
        assert card["illustration"] is True and not game.has_banned_words(card["caption"])
        assert game.postcard_for(conn, "nope", "x") is None

    def test_comeback_postcard(self, conn):
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        assert game.postcard_for(conn, "comeback", "2026-10-07", today=D(8))["id"] == game.COMEBACK_CARD["id"]
        assert game.postcard_for(conn, "comeback", "2026-10-09", today=D(8)) is None

    def test_old_database_without_the_table_still_reads(self, db_path):
        with db.get_conn(db_path) as c:
            c.execute("DROP TABLE unlocks")
            assert game.achievements(c, today=D(8))             # reads fall back to an empty ledger
            game.sync_unlocks(c, today=D(8))                    # writes recreate it
            assert c.execute("SELECT COUNT(*) FROM unlocks").fetchone()[0] >= 0


# --------------------------------------------------------------------------
# Snapshots and events
# --------------------------------------------------------------------------

class TestEvents:
    def run_write(self, conn, today, write, **kw):
        before = game.snapshot(conn, today=today)
        write()
        events = game.finish_write(conn, before, today=today, **kw)
        return before, events

    def kinds(self, events):
        return [e["kind"] for e in events]

    def test_diff_of_identical_snapshots_is_empty(self, conn):
        add(conn, D(14), "19:45", 60)
        snap = game.snapshot(conn, today=D(14))
        assert game.diff_events(snap, snap) == []

    def test_diff_is_idempotent(self, conn):
        before = game.snapshot(conn, today=D(14))
        add(conn, D(14), "19:45", 100)
        after = game.snapshot(conn, today=D(14))
        entry = {"category": "Python", "minutes": 100, "deep": True}
        one = game.diff_events(before, after, entry=entry)
        two = game.diff_events(before, after, entry=entry)
        assert one == two and one

    def test_snapshot_is_deterministic(self, conn):
        add(conn, D(14), "19:45", 60)
        assert game.snapshot(conn, today=D(14)) == game.snapshot(conn, today=D(14))

    def test_finish_write_does_not_replay(self, conn):
        before, first = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:45", 45), entry={"category": "Python", "minutes": 45, "deep": True})
        assert first
        again = game.snapshot(conn, today=D(14))
        assert game.finish_write(conn, again, today=D(14)) == []

    def test_deep_log_event_copy(self, conn):
        _, events = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:45", 45, note="numpy"),
                                   entry={"category": "Python", "minutes": 45, "deep": True})
        log = events[0]
        assert log["kind"] == "log" and log["size"] == "tick"
        assert log["title"] == "45m Python logged" and log["detail"] == "45m deep today."
        assert log["fx"]["floors_added"] == 3 and log["fx"]["sound"] == "tick"
        assert game.toast_text(events) == "45m Python logged. 45m deep today."

    def test_floor_event_when_doors_open(self, conn):
        _, events = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:45", 34),
                                   entry={"category": "Python", "minutes": 34, "deep": True})
        floor = next(e for e in events if e["kind"] == "floor")
        assert floor["size"] == "small" and floor["title"] == "Doors open" and floor["detail"] == "34m deep today."
        assert floor["fx"]["confetti"] == 12 and "target" not in self.kinds(events)

    def test_target_event_and_next_log_does_not_repeat_it(self, conn):
        add(conn, D(14), "10:00", 80)
        _, events = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:45", 20),
                                   entry={"category": "Python", "minutes": 20, "deep": True})
        crown = next(e for e in events if e["kind"] == "target")
        assert crown["size"] == "medium" and crown["title"] == "Crown lit" and crown["fx"]["confetti"] == 40
        _, more = self.run_write(conn, D(14), lambda: add(conn, D(14), "21:00", 20),
                                 entry={"category": "Python", "minutes": 20, "deep": True})
        assert "target" not in self.kinds(more) and "floor" not in self.kinds(more)

    def test_honest_log_events_have_lamps_and_calm_copy(self, conn):
        _, events = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:00", 40, cat="Distracted", deep=False),
                                   entry={"category": "Distracted", "minutes": 40, "deep": False})
        log = events[0]
        assert log["title"] == "40m Distracted logged" and log["detail"] == "The map is accurate."
        assert log["fx"]["lamp"] is True and log["fx"]["floors_added"] == 0
        assert "floor" not in self.kinds(events)

    def test_rest_and_unknown_copy(self, conn):
        _, ev = self.run_write(conn, D(14), lambda: add(conn, D(14), "19:00", 30, cat="Rest", deep=False),
                               entry={"category": "Rest", "minutes": 30, "deep": False})
        assert ev[0]["title"] == "Rest hour logged"
        _, ev = self.run_write(conn, D(14), lambda: add(conn, D(14), "20:00", 30, cat="Unknown", deep=False),
                               entry={"category": "Unknown", "minutes": 30, "deep": False})
        assert ev[0]["title"] == "Unknown logged" and ev[0]["detail"] == "You can fill it in at Close."

    def test_output_events(self, conn):
        _, events = self.run_write(conn, D(14), lambda: ship(conn, D(14), "Math", "notes"), output={"stage": "Math"})
        out = next(e for e in events if e["kind"] == "output")
        assert out["size"] == "big" and out["title"] == "Output 1 of 2 this week"
        assert out["detail"] == "Beacon lit on today's tower." and out["fx"]["ladder"] == "Math"
        assert "floor" in self.kinds(events) and "node" in self.kinds(events)
        _, events = self.run_write(conn, D(14), lambda: ship(conn, D(14), "Math", "more"), output={"stage": "Math"})
        out = next(e for e in events if e["kind"] == "output")
        assert out["title"] == "Output 2 of 2 this week" and out["detail"] == "Contract outputs met."

    def test_node_event_names_the_section(self, conn):
        _, events = self.run_write(conn, D(14), lambda: ship(conn, D(14), "ML/DL", "perceptron"), output={"stage": "ML/DL"})
        node = next(e for e in events if e["kind"] == "node")
        assert node["title"] == "ML/DL: First Model reached" and node["detail"] == "Chrysler Building lit up a new section."

    def test_comeback_is_the_grandest_event(self, conn):
        add(conn, D(5), "19:45", 40)                                  # Monday floor, then Tuesday missed
        _, events = self.run_write(conn, D(7), lambda: add(conn, D(7), "19:45", 40),
                                   entry={"category": "Python", "minutes": 40, "deep": True})
        back = next(e for e in events if e["kind"] == "comeback")
        assert back["size"] == "grand" and back["title"] == "Back on"
        assert back["detail"] == "First floor day since Monday." and back["fx"]["confetti"] == 90
        assert back["fx"]["banner"] == "You're back." and back["fx"]["crane"] is True
        assert back["postcard"]["id"] == game.COMEBACK_CARD["id"]

    def test_repair_event(self, conn):
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        _, events = self.run_write(conn, D(8), lambda: add(conn, D(8), "19:45", 40),
                                   entry={"category": "Python", "minutes": 40, "deep": True})
        # the second floor day after the missed Tuesday completes the repair
        repaired = next(e for e in events if e["kind"] == "repair")
        assert repaired["title"] == "Tuesday's lot is built" and repaired["size"] == "big"
        assert repaired["fx"]["scaffold_down"] is True

    def test_week_kept_event_with_postcard(self, conn):
        good_week(conn, outputs=1)
        # Friday is today: five floor days are in, the second output closes the contract
        _, events = self.run_write(conn, D(16), lambda: ship(conn, D(16), "Python", "second"), output={"stage": "Python"})
        kept = next(e for e in events if e["kind"] == "week_kept")
        assert kept["size"] == "big" and kept["title"] == "Card complete"
        assert kept["detail"] == "2 of 2 outputs, 5 of 5 floor days."
        assert kept["postcard"]["id"] == game.POSTCARDS[0]["id"]

    def test_level_and_district_events(self):
        base = dict(floors_today=0, floor_met=False, target_met=False, outputs_today=0, outputs_week=0, week_status="in_progress",
                    is_comeback_today=False, repaired=(), nodes=frozenset(), achievements=frozenset(), closed_today=False,
                    lamps_today=0)
        a = game.Snapshot(xp=190, level=1, district="Morningside Heights", **base)
        b = game.Snapshot(xp=210, level=2, district="Morningside Heights", **base)
        ev = game.diff_events(a, b)
        assert [e["kind"] for e in ev] == ["level"] and ev[0]["title"] == "Level 2" and ev[0]["size"] == "small"
        c = game.Snapshot(xp=game._cum_xp(3), level=3, district="Harlem", **base)
        d = game.diff_events(b, c)
        assert [e["kind"] for e in d] == ["district"]
        assert d[0]["size"] == "grand" and d[0]["title"] == "Harlem" and d[0]["fx"]["confetti"] == 120

    def test_achievement_event_sizes_follow_tier(self):
        base = dict(floors_today=0, floor_met=False, target_met=False, outputs_today=0, outputs_week=0, week_status="in_progress",
                    is_comeback_today=False, repaired=(), xp=0, level=1, district="Morningside Heights", nodes=frozenset(),
                    closed_today=False, lamps_today=0)
        a = game.Snapshot(achievements=frozenset(), **base)
        b = game.Snapshot(achievements=frozenset({"linked_ship", "first_comeback", "district_harlem"}), **base)
        ev = game.diff_events(a, b)
        assert [e["title"] for e in ev] == ["Receipts", "Crane Day"]          # district arrivals have their own event
        assert [e["size"] for e in ev] == ["small", "medium"]
        assert ev[0]["detail"] == "First output with a link."

    def test_rest_day_event(self, conn):
        _, events = self.run_write(conn, D(14), lambda: rules.use_skip(conn, D(14), "rest"))
        rest = next(e for e in events if e["kind"] == "rest")
        assert rest["title"] == "Rest day logged" and rest["detail"] == "1 token left this week."

    def test_events_have_the_documented_shape_and_clean_copy(self, conn):
        scenarios = [
            lambda: add(conn, D(14), "09:00", 45),
            lambda: add(conn, D(14), "10:00", 60),
            lambda: ship(conn, D(14), "Papers", "summary", "https://e.com"),
            lambda: add(conn, D(14), "13:00", 30, cat="Distracted", deep=False),
            lambda: rules.use_skip(conn, D(15), "rest"),
        ]
        seen = []
        for step in scenarios:
            _, events = self.run_write(conn, D(14), step, entry={"category": "Python", "minutes": 45, "deep": True})
            for ev in events:
                assert set(ev) >= {"kind", "size", "title", "detail", "fx"}
                assert ev["size"] in {"tick", "small", "medium", "big", "grand"}
                assert isinstance(ev["fx"], dict)
            seen += events
        assert seen
        assert_clean(seen)
        json.dumps(seen)

    def test_seal_day(self, conn):
        d = D(7)
        assert game.seal_day(conn, d, today=D(8)) is None
        rules.close_job_block(conn, d, "leave")
        wake, bed = timeutil.at_local(d, "07:30", TZ, 4), timeutil.at_local(d, "23:30", TZ, 4)
        rules.add_entry(conn, wake, bed, "Unknown", False, "backfill")
        sealed = game.seal_day(conn, d, today=D(8))
        assert sealed["newly_sealed"] and sealed["events"][0]["title"] == "Day 3 sealed"
        assert game.toast_text(sealed["events"]) == "Day 3 sealed."
        assert sealed["recap"]["day_number"] == 3
        assert sealed["recap"]["sealed"] and sealed["recap"]["closed"]
        again = game.seal_day(conn, d, today=D(8))
        assert not again["newly_sealed"] and again["events"] == []
        assert conn.execute("SELECT kind FROM unlocks WHERE key = 'seal:2026-10-07'").fetchone()["kind"] == "seal"


# --------------------------------------------------------------------------
# Wins, chips
# --------------------------------------------------------------------------

class TestWinsAndChips:
    def test_wins_are_factual_and_newest_first(self, conn):
        add(conn, D(13), "19:45", 100, note="numpy ex 1-12")
        ship(conn, D(13), "Python", "notebook")
        add(conn, D(14), "19:45", 20, cat="Distracted", deep=False)
        game.sync_unlocks(conn, today=D(14))
        ws = game.wins(conn, today=D(14))
        texts = [w["text"] for w in ws]
        assert "1h 40m numpy ex 1-12" in texts
        assert "Output 1 of 2 this week" in texts
        assert "Crown lit on a Tuesday" in texts
        assert any("Distracted" in w["text"] for w in ws if w["kind"] == "log")   # honest logs weigh the same
        assert [w["at"] for w in ws] == sorted([w["at"] for w in ws], reverse=True)
        assert all({"kind", "icon", "text", "at"} <= set(w) for w in ws)
        assert_clean(ws)

    def test_missed_days_appear_nowhere(self, conn):
        add(conn, D(5), "19:45", 40)
        ws = game.wins(conn, today=D(8))
        assert not any("Tuesday" in w["text"] or "Wednesday" in w["text"] for w in ws if w["kind"] != "log")

    def test_comeback_win_line(self, conn):
        add(conn, D(5), "19:45", 40)
        add(conn, D(7), "19:45", 40)
        assert "Back on. First floor day since Monday" in [w["text"] for w in game.wins(conn, today=D(8))]

    def test_wins_limit(self, conn):
        for i in range(8):
            add(conn, D(7), f"{8 + i:02d}:00", 30)
        assert len(game.wins(conn, limit=5, today=D(8))) == 5

    def test_repeat_chips_last_three_distinct(self, conn):
        add(conn, D(14), "08:00", 45, note="numpy ex 1-12")
        add(conn, D(14), "09:00", 60, cat="Math", note="LA 2.1")
        add(conn, D(14), "10:00", 45, note="numpy ex 1-12")              # repeat of the first
        add(conn, D(14), "11:00", 25, note="broadcasting")
        add(conn, D(14), "12:00", 30, cat="Unknown", deep=False)
        add(conn, D(14), "13:00", 30, cat="Python", source="backfill", note="from close")
        chips = game.repeat_chips(conn, today=D(14))
        assert [c["label"] for c in chips] == ["25m broadcasting", "45m numpy ex 1-12", "1h LA 2.1"]
        assert chips[0]["category"] == "Python" and chips[0]["deep"] is True


# --------------------------------------------------------------------------
# Payload shapes
# --------------------------------------------------------------------------

DAY_KEYS = {"date", "dow", "week", "status", "is_today", "deep_minutes", "floors", "target_floor", "over_cap_min",
            "lamps", "fog_minutes", "outputs", "mark", "is_comeback", "closed", "stars"}


class TestPayloads:
    def populate(self, conn):
        good_week(conn)
        add(conn, D(14), "20:00", 20, cat="Distracted", deep=False)
        ship(conn, D(14), "Math", "linked", "https://e.com/m")
        game.sync_unlocks(conn, today=D(14))

    def test_today_state_shape(self, conn):
        self.populate(conn)
        st = game.today_state(conn, today=D(14), now=EVENING)
        assert {"as_of", "date", "weekday", "today", "level", "tower", "quests", "wins", "repeat_chips", "week",
                "run", "close", "ghost", "config", "quiet"} <= set(st)
        t = st["today"]
        assert {"deep_minutes", "floors", "floor_met", "target_met", "target_minutes", "ring", "over_cap_min"} <= set(t)
        assert set(t["ring"]) == {"floor_p", "target_p"}
        assert t["deep_minutes"] == 100 and t["floors"] == 6 and t["floor_met"] and t["target_met"]
        assert t["ring"] == {"floor_p": 100, "target_p": 100}
        assert t["subline"] == "Crown lit. Anything extra is shown but not counted."
        assert set(st["level"]) == {"number", "district", "xp", "into", "needed", "progress", "to_next"}
        assert DAY_KEYS - {"week"} <= set(st["tower"])
        assert len(st["quests"]) <= 3 and all(set(q) == {"key", "label", "done", "detail"} for q in st["quests"])
        assert len(st["wins"]) <= 5 and len(st["repeat_chips"]) <= 3
        assert st["week"]["outputs"] == 3 and st["week"]["outputs_required"] == 2 and len(st["week"]["days"]) == 7
        assert st["run"]["current"] >= 3 and st["run"]["best"] >= st["run"]["current"]
        assert st["date"] == "2026-10-14" and st["weekday"] == "Wednesday"
        assert st["ghost"]["last_week_deep_by_dow"] == [0] * 7
        json.dumps(st)

    def test_today_state_on_an_empty_day(self, conn):
        st = game.today_state(conn, today=D(5), now=timeutil.at_local(D(5), "09:00", TZ, 4))
        assert st["today"]["ring"] == {"floor_p": 0, "target_p": 0}
        assert st["today"]["subline"] == "Empty lot, waiting for the first floor."
        assert st["level"]["number"] == 1 and st["level"]["district"] == "Morningside Heights"
        assert st["tower"]["state"] == "lot" and st["wins"] == [] and st["repeat_chips"] == []
        assert st["lapse"] is None and st["repair"] is None

    def test_ring_numbers_and_sublines(self, conn):
        add(conn, D(14), "09:00", 15)
        st = game.today_state(conn, today=D(14), now=MORNING)
        assert st["today"]["ring"] == {"floor_p": 50, "target_p": 17}
        assert st["today"]["subline"] == "15m to the doors."
        add(conn, D(14), "10:00", 25)
        st = game.today_state(conn, today=D(14), now=MORNING)
        assert st["today"]["subline"] == "Doors open. Crown in 50m."
        assert st["today"]["ring"]["floor_p"] == 100

    def test_past_the_cap_note(self, conn):
        add(conn, D(10), "06:00", 275)
        st = game.today_state(conn, today=D(10), now=timeutil.at_local(D(10), "20:00", TZ, 4))
        assert st["today"]["over_cap_min"] == 35 and st["today"]["over_cap_note"] == "+35m, past the cap"
        assert st["today"]["floors"] == 16

    def test_rest_day_subline(self, conn):
        rules.use_skip(conn, D(14), "rest")
        st = game.today_state(conn, today=D(14), now=MORNING)
        assert st["today"]["subline"] == "Rest day. Doors stay open if you want them."

    def test_today_state_flags_pending_lapse_and_repair_window(self, conn):
        add(conn, D(5), "19:45", 40)
        st = game.today_state(conn, today=D(7), now=timeutil.at_local(D(7), "09:00", TZ, 4))
        assert st["lapse"] == "2026-10-06"
        rules.record_lapse(conn, D(6), "tired", "repair", None)
        st = game.today_state(conn, today=D(7), now=timeutil.at_local(D(7), "09:00", TZ, 4))
        assert st["lapse"] is None and st["repair"] == "2026-10-06"

    def test_world_state_shape(self, conn):
        self.populate(conn)
        w = game.world_state(conn, today=D(14))
        assert {"as_of", "today", "tz", "config", "level", "totals", "days", "weeks", "landmarks", "ghost", "sky"} <= set(w)
        assert w["today"] == "2026-10-14" and w["tz"] == TZ
        assert w["config"] == {"floor_min": 30, "target_weekday": 90, "target_weekend": 180, "cap": 240,
                               "minutes_per_floor": 15, "max_floors": 16, "deep_star_minutes": 240}
        assert {"number", "district", "xp", "into", "needed", "progress"} <= set(w["level"])
        assert {"deep_minutes", "days_shown_up", "outputs", "weeks_kept", "comebacks", "best_run", "run"} <= set(w["totals"])
        assert len(w["days"]) == 28 and len(w["weeks"]) == 4
        assert [d["date"] for d in w["days"]] == sorted(d["date"] for d in w["days"])
        assert w["days"][0]["date"] == "2026-09-21" and w["days"][0]["dow"] == 0
        assert w["days"][-1]["date"] == "2026-10-18" and w["days"][-1]["dow"] == 6
        for d in w["days"]:
            assert DAY_KEYS <= set(d), DAY_KEYS - set(d)
            assert d["week"] == (date.fromisoformat(d["date"]) - date(2026, 9, 21)).days // 7
        today = next(d for d in w["days"] if d["is_today"])
        assert today["date"] == "2026-10-14" and today["week"] == 3 and today["floors"] == 6
        assert today["lamps"] == [{"category": "Distracted", "n": 1}]
        assert today["outputs"][0]["stage"] == "Math"
        assert all(d["status"] == "future" for d in w["days"] if d["date"] > "2026-10-14")
        wk = w["weeks"][-1]
        assert {"monday", "status", "outputs", "outputs_required", "floor_days", "floor_days_required", "skips_used", "skips_left"} <= set(wk)
        assert wk["monday"] == "2026-10-12" and wk["outputs_required"] == 2
        assert [lm["ladder"] for lm in w["landmarks"]] == list(categories.LADDER)
        assert [lm["kind"] for lm in w["landmarks"]] == ["bridge", "tower", "spire", "dome", "billboard"]
        for lm in w["landmarks"]:
            assert {"ladder", "kind", "outputs", "deep_minutes", "nodes_unlocked", "next"} <= set(lm)
        assert len(w["ghost"]["last_week_deep_by_dow"]) == 7
        assert w["sky"] == {"mode": "local"}
        json.dumps(w)

    def test_world_state_seven_days_is_one_row(self, conn):
        w = game.world_state(conn, today=D(14), days=7)
        assert len(w["days"]) == 7 and len(w["weeks"]) == 1
        assert w["days"][0]["date"] == "2026-10-12"

    def test_world_ghost_is_last_weeks_pace(self, conn):
        add(conn, D(5), "19:45", 60)
        add(conn, D(7), "19:45", 45)
        w = game.world_state(conn, today=D(14))
        assert w["ghost"]["last_week_deep_by_dow"] == [60, 0, 45, 0, 0, 0, 0]

    def test_world_totals_never_reset(self, conn):
        good_week(conn)
        w = game.world_state(conn, today=D(18))
        assert w["totals"]["weeks_kept"] == 1 and w["totals"]["outputs"] == 2
        later = game.world_state(conn, today=D(40))          # many empty weeks later
        assert later["totals"]["weeks_kept"] == 1 and later["totals"]["deep_minutes"] == w["totals"]["deep_minutes"]
        assert later["totals"]["best_run"] == w["totals"]["best_run"]

    def test_sky_setting_is_passed_through(self, conn):
        db.set_setting(conn, "sky_tz", "newyork")
        assert game.world_state(conn, today=D(14))["sky"] == {"mode": "newyork"}

    def test_shelf_state_shape(self, conn):
        self.populate(conn)
        game.sync_unlocks(conn, today=D(18))
        sh = game.shelf_state(conn, today=D(18))
        assert {"achievements", "ladders", "postcards", "decor", "outputs", "counts", "level", "hide_achievements"} <= set(sh)
        assert sh["counts"]["total"] == len(sh["achievements"]) and sh["counts"]["unlocked"] >= 5
        assert all({"key", "name", "tier", "desc", "unlocked", "unlocked_at"} <= set(a) for a in sh["achievements"])
        assert len(sh["ladders"]) == 5 and all(len(lad["nodes"]) == 5 for lad in sh["ladders"])
        python = next(lad for lad in sh["ladders"] if lad["category"] == "Python")
        assert python["is_phase"] is True and python["next_text"].startswith("Next node:")
        assert "week_kept" in {c["kind"] for c in sh["postcards"]}
        assert sh["decor"][0] == {"name": "Cab stand", "unlocked": True, "week": "2026-10-12"}
        assert sh["decor"][1]["unlocked"] is False
        assert sh["outputs"][0] == {"id": sh["outputs"][0]["id"], "date": "2026-10-14", "stage": "Math", "what": "linked",
                                    "url": "https://e.com/m", "is_public": False, "verified_by": "self"}
        json.dumps(sh)

    def test_hide_achievements_flag(self, conn):
        db.set_setting(conn, "hide_achievements", True)
        assert game.shelf_state(conn, today=D(14))["hide_achievements"] is True

    def test_every_payload_string_is_clean(self, conn):
        self.populate(conn)
        add(conn, D(5), "19:45", 40)
        rules.add_plan_block(conn, D(14), "Python", 60, "20:00", "ch.6 ex 1-10")
        for payload in (
            game.today_state(conn, today=D(14), now=EVENING),
            game.today_state(conn, today=D(14), now=MORNING),
            game.world_state(conn, today=D(14)),
            game.shelf_state(conn, today=D(14)),
            game.day_recap(conn, D(14), today=D(14)),
        ):
            assert_clean(payload)


# --------------------------------------------------------------------------
# Guardrails (section 11)
# --------------------------------------------------------------------------

class TestGuardrails:
    def test_banned_word_matcher(self):
        for bad in ("You failed", "wasted hours", "so lazy", "Streak lost", "your future self", "You should log", "Last chance!"):
            assert game.has_banned_words(bad), bad
        for fine in ("Doors open", "Back on. First floor day since Monday", "Crown lit.", "shoulder"):
            assert not game.has_banned_words(fine), fine

    def test_static_copy_tables_are_clean(self):
        texts = []
        for _key, name, _tier, desc in game._ACH_ROWS:
            texts += [name, desc]
        for info in game.LADDER_INFO.values():
            texts += [info["landmark"], *info["nodes"]]
        for card in game.POSTCARDS + [game.COMEBACK_CARD, *game.DISTRICT_CARDS.values()]:
            texts += [card["title"], card["caption"]]
        texts += game.DECOR + [d[2] for d in game.DISTRICTS]
        for meta in game.DISTRICT_META.values():
            texts.append(meta["arrival"])
        texts += [v for k, v in game.DREAM_HOME.items() if isinstance(v, str)]
        texts += [info["light"] for info in game.LADDER_LANDMARKS.values()]
        assert texts
        for text in texts:
            assert not game.has_banned_words(text), text

    def test_nothing_is_spendable_and_nothing_shrinks(self, conn):
        # No currency fields anywhere in the payloads.
        text = json.dumps([game.today_state(conn, today=D(14), now=MORNING), game.world_state(conn, today=D(14)),
                           game.shelf_state(conn, today=D(14))]).lower()
        for word in ("coin", "gem", "shop", "spend", "health", "hp", "leaderboard", "rank"):
            assert f'"{word}' not in text

    def test_missed_day_is_scaffolding_not_red(self, conn):
        for name in ("Distracted", "Unknown", "Rest"):
            color = categories.COLORS[name].lstrip("#")
            r, g, b = (int(color[i:i + 2], 16) for i in (0, 2, 4))
            assert not (r > 200 and g < 110 and b < 110), f"{name} reads as red"

    def test_palette_changes_from_the_design(self):
        assert categories.COLORS["Distracted"] != "#ef4444"
        assert categories.COLORS["Papers"] != "#f59e0b"
        assert all(c.startswith("#") and len(c) == 7 for c in categories.COLORS.values())
        assert set(categories.COLORS) == set(categories.ALL)

    def test_the_target_never_breaks_the_run(self, conn):
        # only the floor feeds the run: floor-only days chain together
        for day in (5, 6, 7):
            add(conn, D(day), "19:45", 35)
        assert game.best_run(conn, today=D(8)) == 3

    def test_game_defaults_are_the_safe_side(self):
        d = game.GAME_DEFAULTS
        assert d["sound"] is False and d["quiet_mode"] is False and d["motion"] == "auto"
        assert d["minutes_per_floor"] == 15 and d["confetti_daily_cap"] == 3 and d["game_enabled"] is True

    def test_setting_falls_back_to_game_defaults(self, conn):
        assert game.setting(conn, "minutes_per_floor") == 15
        db.set_setting(conn, "minutes_per_floor", 20)
        assert game.setting(conn, "minutes_per_floor") == 20
        add(conn, D(14), "09:00", 60)
        assert game.today_state(conn, today=D(14), now=MORNING)["today"]["floors"] == 3

    def test_floor_size_setting_changes_the_tower(self, conn):
        db.set_setting(conn, "minutes_per_floor", 30)
        add(conn, D(14), "09:00", 90)
        t = game.today_state(conn, today=D(14), now=MORNING)["tower"]
        assert t["floors"] == 3 and t["target_floor"] == 3

    def test_game_layer_does_not_change_the_rules(self, conn):
        # writing game state must not change any rules.py result
        good_week(conn)
        before = (rules.week_summary(conn, D(14), today=D(18)).status, rules.current_run(conn, today=D(18)))
        game.sync_unlocks(conn, today=D(18))
        game.seal_day(conn, D(12), today=D(18))
        assert before == (rules.week_summary(conn, D(14), today=D(18)).status, rules.current_run(conn, today=D(18)))


# --------------------------------------------------------------------------
# "Is the game layer helping?"
# --------------------------------------------------------------------------

class TestHelpingReport:
    def test_none_without_game_on_since(self, conn):
        assert game.helping_report(conn, today=D(30)) is None

    def test_none_before_fourteen_days_of_play(self, conn):
        db.set_setting(conn, "game_on_since", "2026-10-12")
        assert game.helping_report(conn, today=D(25)) is None

    def test_report_compares_two_windows(self, conn):
        db.set_setting(conn, "game_on_since", "2026-10-12")
        add(conn, D(7), "19:45", 60)                                 # before
        for day in range(12, 26):
            add(conn, D(day), "19:45", 60)                           # after
        rep = game.helping_report(conn, today=date(2026, 10, 26))
        assert rep["since"] == "2026-10-12"
        assert rep["after"]["days"] == 14 and rep["before"]["days"] == 7
        assert rep["after"]["floor_rate"] == 1.0
        assert rep["after"]["entries_per_day"] == 1.0
        assert rep["before"]["floor_rate"] < rep["after"]["floor_rate"]
        assert rep["caveat"] == "One person, no control group."
        assert rep["better"] is True and not game.has_banned_words(rep["note"])
        json.dumps(rep)

    def test_worse_numbers_suggest_quiet_mode_as_an_option(self, conn):
        db.set_setting(conn, "game_on_since", "2026-10-12")
        for day in (5, 6, 7, 8, 9, 10, 11):
            add(conn, D(day), "10:00", 600, cat="Python")           # lots of coverage before
        rep = game.helping_report(conn, today=date(2026, 10, 26))
        assert rep["better"] is False
        assert "Quiet mode is an option" in rep["note"]
        assert_clean(rep)


# --------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------

class TestSchema:
    def test_unlocks_table_exists_with_documented_columns(self, conn):
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(unlocks)")}
        assert list(cols) == ["key", "kind", "unlocked_at", "meta"]
        assert cols["key"]["pk"] == 1 and cols["kind"]["notnull"] == 1 and cols["unlocked_at"]["notnull"] == 1

    def test_init_db_is_safe_to_rerun_and_upgrades_old_databases(self, db_path):
        with db.get_conn(db_path) as c:
            c.execute("INSERT INTO unlocks(key, kind, unlocked_at) VALUES ('ach:x', 'achievement', '2026-10-05T00:00:00Z')")
            c.execute("DROP TABLE unlocks")
        db.init_db(db_path, today=date(2026, 10, 5))                 # an existing DB without the table
        db.init_db(db_path, today=date(2026, 10, 5))
        with db.get_conn(db_path) as c:
            assert c.execute("SELECT COUNT(*) FROM unlocks").fetchone()[0] == 0

    def test_duplicate_keys_are_rejected(self, conn):
        conn.execute("INSERT INTO unlocks(key, kind, unlocked_at) VALUES ('k', 'achievement', 'x')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO unlocks(key, kind, unlocked_at) VALUES ('k', 'achievement', 'y')")


# --------------------------------------------------------------------------
# Fix pass: ledger-protected nodes, early closes, stars, once-only moments, day boundaries
# --------------------------------------------------------------------------

class TestFixPass:
    def at(self, d, hhmm):
        return timeutil.at_local(d, hhmm, TZ, 4)

    def test_nodes_stay_unlocked_and_never_replay(self, conn):
        oid = ship(conn, D(13), "Math", "m1")
        game.sync_unlocks(conn, today=D(14))
        xp = game.xp_total(conn, today=D(14))
        assert xp >= game.NODE_XP
        kill_output(conn, oid)
        lad = {l.category: l for l in game.ladders(conn, today=D(14))}
        assert lad["Math"].nodes_unlocked == 1                      # the ledger row keeps the node
        assert game.xp_total(conn, today=D(14)) == game.NODE_XP     # the node's XP is kept as well
        assert any(m["ladder"] == "Math" and m["nodes_unlocked"] == 1 for m in game.world_state(conn, today=D(14))["landmarks"])
        before = game.snapshot(conn, today=D(14))
        ship(conn, D(14), "Math", "m2")
        events = game.finish_write(conn, before, output={"stage": "Math"}, today=D(14))
        assert "node" not in [e["kind"] for e in events]

    def test_week_cards_and_decor_do_not_vanish(self, conn):
        good_week(conn)
        game.sync_unlocks(conn, today=D(19))
        assert [d["unlocked"] for d in game.shelf_state(conn, today=D(19))["decor"]][:1] == [True]
        assert len(game.shelf_state(conn, today=D(19))["postcards"]) >= 1
        conn.execute("UPDATE outputs SET deleted = 1")
        shelf = game.shelf_state(conn, today=D(19))
        assert shelf["decor"][0]["unlocked"] and any(p["kind"] == "week_kept" for p in shelf["postcards"])

    def test_today_is_not_closed_early_in_the_day(self, conn):
        sat = D(17)                                                  # Saturday, morning card at 08:30
        add(conn, sat, "08:25", 20, cat="Rest", deep=False)
        morning = game._Ctx(conn, sat, self.at(sat, "10:00"))
        assert not morning.closed(sat)
        assert not game.today_state(conn, today=sat, now=self.at(sat, "10:00"))["close"]["can_seal"]
        game.sync_unlocks(conn, today=sat, now=self.at(sat, "10:00"))
        assert "ach:first_close" not in {r["key"] for r in conn.execute("SELECT key FROM unlocks")}
        # in the evening, with the day covered, it can close
        late = self.at(sat, "22:45")
        for g_start, g_end in rules.gaps(conn, sat, end_utc=late):
            rules.add_entry(conn, g_start, g_end, "Rest", False, "backfill")
        assert game._Ctx(conn, sat, late).closed(sat)

    def test_stars_do_not_shrink_through_the_evening(self, conn):
        sat = D(17)
        add(conn, sat, "10:00", 240)
        add(conn, sat, "14:30", 30, cat="Rest", deep=False)
        seen = {game._Ctx(conn, sat, self.at(sat, t)).stars(sat) for t in ("20:00", "22:00", "23:00")}
        assert seen == {3}
        assert game._Ctx(conn, D(18), self.at(D(18), "09:00")).stars(sat) == 3

    def test_first_light_ignores_the_day_job_block(self, conn):
        rules.close_job_block(conn, D(13), "usual")
        a = {x.key: x for x in game.achievements(conn, today=D(14))}
        assert not a["first_light"].unlocked
        add(conn, D(14), "19:45", 20, cat="Rest", deep=False)
        assert {x.key: x for x in game.achievements(conn, today=D(14))}["first_light"].unlocked

    def test_doors_open_plays_once_per_day(self, conn):
        _, first = TestEvents().run_write(conn, D(14), lambda: add(conn, D(14), "19:45", 60), entry={"category": "Python", "minutes": 60, "deep": True})
        assert "floor" in [e["kind"] for e in first]
        conn.execute("UPDATE entries SET deleted = 1")
        before = game.snapshot(conn, today=D(14))
        assert not before.floor_met
        add(conn, D(14), "20:45", 60)
        again = game.finish_write(conn, before, entry={"category": "Python", "minutes": 60, "deep": True}, today=D(14))
        kinds = [e["kind"] for e in again]
        assert "log" in kinds and "floor" not in kinds

    def test_entry_crossing_the_day_start_still_ticks(self, conn):
        lo = timeutil.day_bounds_utc(D(14), TZ, 4)[0]
        before = game.snapshot(conn, today=D(14))
        rules.add_entry(conn, lo - timedelta(minutes=15), lo + timedelta(minutes=15), "Math", True, "live")
        events = game.finish_write(conn, before, entry={"category": "Math", "minutes": 30, "deep": True}, today=D(14))
        assert "log" in [e["kind"] for e in events]
        assert game.toast_text(events)

    def test_recap_wins_use_the_local_day(self, conn):
        # 04:10-04:40 IST ends on the previous UTC date
        rules.add_entry(conn, self.at(D(14), "04:10"), self.at(D(14), "04:40"), "Python", True, "live")
        recap = game.day_recap(conn, D(14), today=D(15))
        assert any("30m" in w["text"] for w in recap["wins"])
        add(conn, D(15), "10:00", 40)
        assert not any("40m" in w["text"] for w in game.day_recap(conn, D(14), today=D(15))["wins"])
