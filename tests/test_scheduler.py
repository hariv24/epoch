"""Tests for the scheduler (slots, expiry, rendering, ticker, backup) and app start-up helpers."""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

from epoch import db, main, notify, rules, scheduler, timeutil
from epoch.config import Config

TUESDAY = date(2026, 10, 13)      # a job day, inside the first contract week
SUNDAY = date(2026, 10, 18)
GUILT_WORDS = ("failed", "wasted", "streak lost", "lazy", "future self")


def utc(d: date, hhmm: str, conn) -> datetime:
    """UTC instant for a local 'HH:MM' on `d`."""
    return timeutil.at_local(d, hhmm, db.get_setting(conn, "timezone"), 4)


def kinds(conn, d: date, status: str | None = None) -> list[str]:
    sql = "SELECT kind FROM slots WHERE local_date = ?"
    args: list = [d.isoformat()]
    if status:
        sql += " AND status = ?"
        args.append(status)
    return sorted(r["kind"] for r in conn.execute(sql, args))


def slot(conn, kind: str, d: date = TUESDAY):
    return conn.execute("SELECT * FROM slots WHERE kind = ? AND local_date = ?", (kind, d.isoformat())).fetchone()


def log_floor(conn, d: date) -> None:
    """Give day `d` a floor day (45 deep minutes of Python)."""
    start = utc(d, "20:00", conn)
    rules.add_entry(conn, start, start + timedelta(minutes=45), "Python", True, "live")


def floor_before(conn, d: date) -> None:
    """Make the day before `d` a floor day, so that `d` starts with a normal morning card, not a lapse card."""
    log_floor(conn, d - timedelta(days=1))


# --------------------------------------------------------------------------
# Slot creation
# --------------------------------------------------------------------------

def test_ensure_slots_creates_morning_and_evening_close(conn):
    floor_before(conn, TUESDAY)
    now = utc(TUESDAY, "06:00", conn)
    scheduler.ensure_slots(conn, TUESDAY, now)
    assert kinds(conn, TUESDAY) == ["evening_close", "morning"]
    assert slot(conn, "morning")["due_utc"] == timeutil.to_iso(utc(TUESDAY, "07:30", conn))
    # bedtime 23:30 minus 30 minutes
    assert slot(conn, "evening_close")["due_utc"] == timeutil.to_iso(utc(TUESDAY, "23:00", conn))


def test_weekend_morning_uses_weekend_time(conn):
    floor_before(conn, date(2026, 10, 17))
    saturday = date(2026, 10, 17)
    scheduler.ensure_slots(conn, saturday, utc(saturday, "06:00", conn))
    assert slot(conn, "morning", saturday)["due_utc"] == timeutil.to_iso(utc(saturday, "08:30", conn))


def test_ensure_slots_is_idempotent(conn):
    now = utc(TUESDAY, "06:00", conn)
    first = scheduler.ensure_slots(conn, TUESDAY, now)
    second = scheduler.ensure_slots(conn, TUESDAY, now)
    assert first == 2 and second == 0
    assert conn.execute("SELECT COUNT(*) FROM slots").fetchone()[0] == 2


def test_rest_day_has_no_morning_card(conn):
    floor_before(conn, TUESDAY)
    rules.use_skip(conn, TUESDAY, "rest")
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:00", conn))
    assert kinds(conn, TUESDAY) == ["evening_close"]


def test_sunday_slot_only_on_sundays(conn):
    floor_before(conn, SUNDAY)
    floor_before(conn, TUESDAY)
    scheduler.ensure_slots(conn, SUNDAY, utc(SUNDAY, "06:00", conn))
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:00", conn))
    assert "sunday" in kinds(conn, SUNDAY)
    assert "sunday" not in kinds(conn, TUESDAY)
    assert slot(conn, "sunday", SUNDAY)["due_utc"] == timeutil.to_iso(utc(SUNDAY, "18:00", conn))


def test_block_end_due_is_cue_plus_minutes_and_added_later(conn):
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:00", conn))
    assert "block_end" not in kinds(conn, TUESDAY)
    block_id = rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", "ch6")
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:05", conn))
    row = slot(conn, "block_end")
    assert row["ref_id"] == block_id
    assert row["due_utc"] == timeutil.to_iso(utc(TUESDAY, "20:30", conn))


def test_at_most_two_block_end_slots(conn):
    for cue in ("18:00", "19:30", "21:00"):
        rules.add_plan_block(conn, TUESDAY, "Math", 30, cue, None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:00", conn))
    assert kinds(conn, TUESDAY).count("block_end") == 2
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:01", conn))
    assert kinds(conn, TUESDAY).count("block_end") == 2


def test_block_planned_long_after_its_end_gets_no_card(conn):
    rules.add_plan_block(conn, TUESDAY, "Python", 30, "10:00", None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "22:00", conn))
    assert "block_end" not in kinds(conn, TUESDAY)


def test_block_card_skipped_when_block_marked_done(conn):
    block_id = rules.add_plan_block(conn, TUESDAY, "Python", 30, "19:00", None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:00", conn))
    conn.execute("UPDATE plan_blocks SET status = 'done' WHERE id = ?", (block_id,))
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:01", conn))
    assert slot(conn, "block_end")["status"] == "skipped"


# --------------------------------------------------------------------------
# Lapse, cap, silence
# --------------------------------------------------------------------------

def test_lapse_replaces_morning(conn):
    d = date(2026, 10, 8)  # the day before (10-07) has nothing logged, so it is missed
    scheduler.ensure_slots(conn, d, utc(d, "06:00", conn))
    assert "lapse" in kinds(conn, d)
    assert "morning" not in kinds(conn, d)


def test_lapse_pushes_out_an_unsent_morning(conn):
    d = date(2026, 10, 8)
    conn.execute(
        "INSERT INTO slots(kind, local_date, ref_id, due_utc) VALUES ('morning', ?, 0, ?)",
        (d.isoformat(), timeutil.to_iso(utc(d, "07:30", conn))),
    )
    scheduler.ensure_slots(conn, d, utc(d, "06:00", conn))
    assert slot(conn, "morning", d)["status"] == "skipped"
    assert slot(conn, "lapse", d)["status"] == "pending"


def test_no_lapse_after_it_was_answered(conn):
    d = date(2026, 10, 8)
    scheduler.ensure_slots(conn, d, utc(d, "06:00", conn))
    rules.record_lapse(conn, date(2026, 10, 7), "tired", "let_go", None)
    scheduler.ensure_slots(conn, d, utc(d, "06:05", conn))
    assert kinds(conn, d).count("lapse") == 1
    assert "morning" not in kinds(conn, d)


def test_no_lapse_when_yesterday_was_a_floor_day(conn):
    log_floor(conn, date(2026, 10, 7))
    d = date(2026, 10, 8)
    scheduler.ensure_slots(conn, d, utc(d, "06:00", conn))
    assert "morning" in kinds(conn, d) and "lapse" not in kinds(conn, d)


def test_msg_cap_is_never_exceeded(conn):
    floor_before(conn, TUESDAY)
    db.set_setting(conn, "msg_cap", 3)
    for cue in ("18:00", "19:30"):
        rules.add_plan_block(conn, TUESDAY, "Math", 30, cue, None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "08:00", conn))
    # morning + 2 block cards fill the cap; the evening close is the one dropped
    assert kinds(conn, TUESDAY) == ["block_end", "block_end", "morning"]


def test_cap_never_drops_the_sunday_review(conn):
    floor_before(conn, SUNDAY)
    db.set_setting(conn, "msg_cap", 2)
    scheduler.ensure_slots(conn, SUNDAY, utc(SUNDAY, "06:00", conn))
    # the weekly review is exempt from the cap ("Always"), so all three exist
    assert kinds(conn, SUNDAY) == ["evening_close", "morning", "sunday"]


def test_planning_two_blocks_on_sunday_keeps_the_weekly_review(conn):
    floor_before(conn, SUNDAY)
    scheduler.ensure_slots(conn, SUNDAY, utc(SUNDAY, "06:00", conn))
    rules.add_plan_block(conn, SUNDAY, "Python", 60, "19:30", None)
    rules.add_plan_block(conn, SUNDAY, "Math", 30, "21:00", None)
    scheduler.ensure_slots(conn, SUNDAY, utc(SUNDAY, "09:00", conn))
    assert slot(conn, "sunday", SUNDAY)["status"] == "pending"
    assert kinds(conn, SUNDAY, "pending").count("block_end") == 2


def test_important_new_slot_pushes_out_a_pending_lower_one(conn):
    floor_before(conn, TUESDAY)
    db.set_setting(conn, "msg_cap", 2)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:00", conn))
    rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:01", conn))
    assert kinds(conn, TUESDAY, "pending") == ["block_end", "morning"]
    assert slot(conn, "evening_close")["status"] == "skipped"
    # a second block cannot push out anything more important, so it is dropped
    rules.add_plan_block(conn, TUESDAY, "Math", 30, "21:00", None)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:02", conn))
    assert kinds(conn, TUESDAY, "pending") == ["block_end", "morning"]


def test_silence_after_48_hours_once_per_quiet_spell(conn):
    log_floor(conn, TUESDAY)
    day = date(2026, 10, 15)  # Thursday
    # pretend the last activity happened on Tuesday at 21:00 local
    conn.execute("UPDATE entries SET created_at = ?", (timeutil.to_iso(utc(TUESDAY, "21:00", conn)),))
    scheduler.ensure_slots(conn, day, utc(day, "20:00", conn))  # 47 hours later: not yet
    assert "silence" not in kinds(conn, day)
    scheduler.ensure_slots(conn, day, utc(day, "21:30", conn))
    assert "silence" in kinds(conn, day)
    # next day, still quiet: the same spell is not announced again
    next_day = day + timedelta(days=1)
    scheduler.ensure_slots(conn, next_day, utc(next_day, "10:00", conn))
    assert "silence" not in kinds(conn, next_day)


def test_silence_not_created_while_user_is_active(conn):
    now = utc(TUESDAY, "12:00", conn)
    conn.execute(
        "INSERT INTO outputs(local_date, stage, what, created_at) VALUES (?, 'Python', 'x', ?)",
        (TUESDAY.isoformat(), timeutil.to_iso(now - timedelta(hours=5))),
    )
    scheduler.ensure_slots(conn, TUESDAY, now)
    assert "silence" not in kinds(conn, TUESDAY)


# --------------------------------------------------------------------------
# Due slots, expiry, focus
# --------------------------------------------------------------------------

def add_slot(conn, kind, d, due, ref_id=0, status="pending"):
    cur = conn.execute(
        "INSERT INTO slots(kind, local_date, ref_id, due_utc, status) VALUES (?, ?, ?, ?, ?)",
        (kind, d.isoformat(), ref_id, timeutil.to_iso(due), status),
    )
    return cur.lastrowid


def test_due_slots_returns_only_pending_and_due(conn):
    now = utc(TUESDAY, "12:00", conn)
    add_slot(conn, "morning", TUESDAY, now - timedelta(minutes=5))
    add_slot(conn, "evening_close", TUESDAY, now + timedelta(hours=1))
    add_slot(conn, "block_end", TUESDAY, now - timedelta(minutes=5), ref_id=1, status="sent")
    assert [r["kind"] for r in scheduler.due_slots(conn, now)] == ["morning"]


def test_expiry_keeps_latest_per_kind_as_catch_up(conn):
    now = utc(TUESDAY, "22:00", conn)
    old = add_slot(conn, "block_end", TUESDAY, now - timedelta(hours=6), ref_id=1)
    older_latest = add_slot(conn, "block_end", TUESDAY, now - timedelta(hours=4), ref_id=2)
    recent = add_slot(conn, "morning", TUESDAY, now - timedelta(hours=1))
    scheduler.expire_overdue(conn, now)
    status = lambda i: conn.execute("SELECT status FROM slots WHERE id = ?", (i,)).fetchone()[0]
    assert status(old) == "expired"
    assert status(older_latest) == "pending"   # latest of its kind: sent as a single catch-up
    assert status(recent) == "pending"         # less than 3 h overdue


def test_overdue_slots_from_an_earlier_day_expire(conn):
    now = utc(TUESDAY, "09:00", conn)
    yesterday = TUESDAY - timedelta(days=1)
    close = add_slot(conn, "evening_close", yesterday, utc(yesterday, "23:00", conn))
    scheduler.expire_overdue(conn, now)
    assert conn.execute("SELECT status FROM slots WHERE id = ?", (close,)).fetchone()[0] == "expired"


def test_sunday_report_is_caught_up_the_next_morning(conn):
    now = utc(SUNDAY + timedelta(days=1), "09:00", conn)
    sunday = add_slot(conn, "sunday", SUNDAY, utc(SUNDAY, "18:00", conn))
    scheduler.expire_overdue(conn, now)
    assert conn.execute("SELECT status FROM slots WHERE id = ?", (sunday,)).fetchone()[0] == "pending"


def test_focus_session_defers_block_end_until_it_ends(db_path):
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "20:35", conn)
        block_id = rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", None)
        add_slot(conn, "block_end", TUESDAY, utc(TUESDAY, "20:30", conn), ref_id=block_id)
        conn.execute(
            "INSERT INTO focus_sessions(start_utc, planned_minutes, label, category) VALUES (?, 50, 'numpy', 'Python')",
            (timeutil.to_iso(now - timedelta(minutes=10)),),
        )
    cards = scheduler.collect_due_cards(db_path, 8765, now)
    assert "block_end" not in [c.slot["kind"] for c in cards]
    with db.get_conn(db_path) as conn:
        assert slot(conn, "block_end")["status"] == "pending"  # deferred, not dropped
        conn.execute("UPDATE focus_sessions SET end_utc = ?, outcome = 'cancelled'", (timeutil.to_iso(now),))
    later = now + timedelta(minutes=5)
    cards = scheduler.collect_due_cards(db_path, 8765, later)
    assert "block_end" in [c.slot["kind"] for c in cards]


def test_block_end_card_is_dropped_when_a_focus_entry_already_covers_the_block(db_path):
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "20:35", conn)
        block_id = rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", None)
        add_slot(conn, "block_end", TUESDAY, utc(TUESDAY, "20:30", conn), ref_id=block_id)
        rules.add_entry(conn, utc(TUESDAY, "19:30", conn), utc(TUESDAY, "20:30", conn), "Python", True, "focus")
    cards = scheduler.collect_due_cards(db_path, 8765, now)
    assert "block_end" not in [c.slot["kind"] for c in cards]


def test_block_end_is_sent_when_no_focus_is_running(db_path):
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "20:35", conn)
        block_id = rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", None)
    cards = scheduler.collect_due_cards(db_path, 8765, now)
    assert "block_end" in [c.slot["kind"] for c in cards]
    assert [c for c in cards if c.slot["kind"] == "block_end"][0].slot["ref_id"] == block_id


def test_auto_close_focus_logs_nothing(conn):
    start = utc(TUESDAY, "19:30", conn)
    conn.execute(
        "INSERT INTO focus_sessions(start_utc, planned_minutes, label, category) VALUES (?, 50, 'numpy', 'Python')",
        (timeutil.to_iso(start),),
    )
    assert scheduler.auto_close_focus(conn, start + timedelta(minutes=79)) == 0   # still inside the grace time
    assert scheduler.focus_is_active(conn, start + timedelta(minutes=79))
    assert scheduler.auto_close_focus(conn, start + timedelta(minutes=81)) == 1
    session = conn.execute("SELECT * FROM focus_sessions").fetchone()
    assert session["outcome"] == "cancelled"
    assert session["end_utc"] == timeutil.to_iso(start + timedelta(minutes=50))
    assert session["entry_id"] is None
    # a forgotten session never invents hours: nothing was logged, so the floor is not met
    assert conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 0
    assert not rules.day_summary(conn, TUESDAY, TUESDAY).floor_met
    assert not scheduler.focus_is_active(conn, start + timedelta(minutes=90))


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def make_all_slots(conn) -> list[sqlite3.Row]:
    block_id = rules.add_plan_block(conn, SUNDAY, "Python", 60, "19:30", "ch6 ex 1-10")
    when = utc(SUNDAY, "12:00", conn)
    for kind, ref in (("morning", 0), ("lapse", 0), ("block_end", block_id), ("evening_close", 0),
                      ("sunday", 0), ("silence", 123)):
        add_slot(conn, kind, SUNDAY, when, ref_id=ref)
    return conn.execute("SELECT * FROM slots ORDER BY id").fetchall()


def test_render_copy_has_no_guilt_words_and_links_to_port(conn):
    for row in make_all_slots(conn):
        title, body, buttons, url = scheduler.render(conn, row, 9999)
        text = f"{title} {body} {' '.join(label for r in buttons for label, _ in r)}".lower()
        assert not any(word in text for word in GUILT_WORDS), row["kind"]
        assert url.startswith("http://127.0.0.1:9999/")
        for r in buttons:
            for _, data in r:
                assert len(data.encode()) <= 64


def test_render_pages(conn):
    pages = {r["kind"]: scheduler.render(conn, r, 8765)[3] for r in make_all_slots(conn)}
    assert pages["morning"].endswith("/plan")
    assert pages["evening_close"].endswith("/close")
    assert pages["sunday"].endswith("/week")
    assert pages["lapse"].endswith("/lapse")


def test_render_block_end_buttons(conn):
    block_id = rules.add_plan_block(conn, TUESDAY, "Python", 60, "19:30", "ch6")
    slot_id = add_slot(conn, "block_end", TUESDAY, utc(TUESDAY, "20:30", conn), ref_id=block_id)
    row = conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
    title, body, buttons, _ = scheduler.render(conn, row)
    assert "19:30–20:30" in body and "ch6" in body
    flat = {label: data for r in buttons for label, data in r}
    assert flat["Python ✓"] == f"ci:{slot_id}:py"
    assert flat["Distracted"] == f"ci:{slot_id}:di"
    assert flat["Rest"] == f"ci:{slot_id}:re"
    assert flat["Same as planned"] == f"ci:{slot_id}:py"


def test_render_lapse_buttons_carry_the_missed_date(conn):
    d = date(2026, 10, 8)
    slot_id = add_slot(conn, "lapse", d, utc(d, "07:30", conn))
    row = conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
    _, body, buttons, _ = scheduler.render(conn, row)
    datas = [data for r in buttons for _, data in r]
    assert "lp:2026-10-07:tired" in datas
    assert "One day is one day" in body


def test_sunday_text_with_no_data_is_still_calm(conn):
    text = scheduler.sunday_text(conn, SUNDAY)
    assert "No data this week" in text


# --------------------------------------------------------------------------
# Backup
# --------------------------------------------------------------------------

def test_backup_copies_database_and_keeps_last_14(db_path, tmp_path):
    backup_dir = tmp_path / "backups"
    first = date(2026, 10, 1)
    for i in range(16):
        scheduler.backup_now(db_path, backup_dir, first + timedelta(days=i))
    names = sorted(p.name for p in backup_dir.iterdir())
    assert len(names) == 14
    assert names[0] == "witness-2026-10-03.db" and names[-1] == "witness-2026-10-16.db"
    copy = sqlite3.connect(str(backup_dir / names[-1]))
    assert copy.execute("SELECT COUNT(*) FROM settings").fetchone()[0] > 0
    copy.close()


def test_prune_leaves_unrelated_files_alone(tmp_path):
    (tmp_path / "notes.txt").write_text("keep me")
    for day in (1, 2, 3):
        (tmp_path / f"witness-2026-10-0{day}.db").write_text("x")
    scheduler.prune_backups(tmp_path, keep=1)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["notes.txt", "witness-2026-10-03.db"]


def test_maybe_backup_runs_once_after_0330_local(db_path, tmp_path):
    backup_dir = tmp_path / "b"
    with db.get_conn(db_path) as conn:
        before = utc(TUESDAY, "03:00", conn) + timedelta(days=1)   # 03:00 next calendar day
    after = before + timedelta(minutes=45)
    assert scheduler.maybe_backup(db_path, backup_dir, before) is None
    made = scheduler.maybe_backup(db_path, backup_dir, after)
    assert made is not None and made.exists()
    assert scheduler.maybe_backup(db_path, backup_dir, after + timedelta(minutes=5)) is None


def test_maybe_backup_without_backup_dir_does_nothing(db_path):
    assert scheduler.maybe_backup(db_path, None) is None


# --------------------------------------------------------------------------
# The ticker
# --------------------------------------------------------------------------

def make_state(db_path, tmp_path, telegram_app=None):
    config = SimpleNamespace(port=8123, backup_dir=None)
    return SimpleNamespace(config=config, db_path=db_path, telegram_app=telegram_app)


def test_tick_sends_due_cards_and_marks_them_sent(db_path, tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "notify", lambda title, body, url=None: sent.append((title, url)) or True)
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "08:00", conn)
        floor_before(conn, TUESDAY)
    state = make_state(db_path, tmp_path)
    assert asyncio.run(scheduler.tick(state, now)) == 1
    assert sent == [("Good morning", "http://127.0.0.1:8123/plan")]
    with db.get_conn(db_path) as conn:
        row = slot(conn, "morning")
        assert row["status"] == "sent" and row["sent_utc"] == timeutil.to_iso(now)
    # a second tick sends nothing: sent cards are never re-sent
    assert asyncio.run(scheduler.tick(state, now + timedelta(minutes=1))) == 0
    assert len(sent) == 1


def test_tick_also_sends_to_telegram_when_enabled(db_path, tmp_path, monkeypatch):
    monkeypatch.setattr(notify, "notify", lambda *a, **k: True)
    calls = []

    async def fake_send_card(state, slot_row, text, buttons):
        calls.append((slot_row["kind"], text, buttons))
        return 77

    import sys
    import types
    fake_module = types.ModuleType("epoch.telegram_bot")
    fake_module.send_card = fake_send_card
    monkeypatch.setitem(sys.modules, "epoch.telegram_bot", fake_module)
    monkeypatch.setattr("epoch.telegram_bot", fake_module, raising=False)

    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "08:00", conn)
        floor_before(conn, TUESDAY)
    state = make_state(db_path, tmp_path, telegram_app=object())
    asyncio.run(scheduler.tick(state, now))
    assert calls and calls[0][0] == "morning" and "http://127.0.0.1:8123/plan" in calls[0][1]
    with db.get_conn(db_path) as conn:
        assert slot(conn, "morning")["telegram_message_id"] == 77


def test_a_failing_notification_does_not_stop_the_tick(db_path, tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("no display")

    monkeypatch.setattr(notify, "notify", boom)
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "08:00", conn)
        floor_before(conn, TUESDAY)
    assert asyncio.run(scheduler.tick(make_state(db_path, tmp_path), now)) == 1
    with db.get_conn(db_path) as conn:
        assert slot(conn, "morning")["status"] == "sent"


def test_stale_silence_card_is_skipped(db_path):
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "12:00", conn)
        old_spell = int((now - timedelta(days=3)).timestamp())
        add_slot(conn, "silence", TUESDAY, now - timedelta(minutes=1), ref_id=old_spell)
        conn.execute(
            "INSERT INTO outputs(local_date, stage, what, created_at) VALUES (?, 'Python', 'x', ?)",
            (TUESDAY.isoformat(), timeutil.to_iso(now - timedelta(hours=1))),
        )
    cards = scheduler.collect_due_cards(db_path, 8765, now)
    assert "silence" not in [c.slot["kind"] for c in cards]


# --------------------------------------------------------------------------
# main.py
# --------------------------------------------------------------------------

def make_config(tmp_path, **overrides) -> Config:
    values = dict(
        data_dir=tmp_path, db_path=tmp_path / "witness.db", backup_dir=None, port=8999,
        telegram_bot_token=None, telegram_user_id=None, openrouter_api_key=None,
        openrouter_models=(), activitywatch_url="http://localhost:5600",
    )
    values.update(overrides)
    return Config(**values)


def test_build_state_without_optional_services(tmp_path):
    state = main.build_state(make_config(tmp_path))
    assert state.llm is None and state.telegram_app is None
    assert state.db_path.exists()
    assert state.aw.base_url == "http://localhost:5600"


def test_build_state_creates_llm_client_when_configured(tmp_path):
    config = make_config(tmp_path, openrouter_api_key="k", openrouter_models=("x/y:free",))
    state = main.build_state(config)
    assert state.llm is not None and state.llm.models == ("x/y:free",)


class FakeUpdater:
    def __init__(self, log):
        self.log = log

    async def start_polling(self):
        self.log.append("polling")

    async def stop(self):
        self.log.append("updater.stop")


class FakeTelegramApp:
    def __init__(self):
        self.log: list[str] = []
        self.updater = FakeUpdater(self.log)

    async def initialize(self):
        self.log.append("initialize")

    async def start(self):
        self.log.append("start")

    async def stop(self):
        self.log.append("stop")

    async def shutdown(self):
        self.log.append("shutdown")


def test_background_services_start_and_stop_telegram_and_ticker(tmp_path, monkeypatch):
    ticks = []

    async def fake_ticker(state):
        ticks.append("started")
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "ticker", fake_ticker)
    telegram = FakeTelegramApp()
    state = main.AppState(config=make_config(tmp_path), db_path=tmp_path / "x.db", aw=None, telegram_app=telegram)

    async def scenario():
        async with main.background_services(state):
            await asyncio.sleep(0)
            assert telegram.log == ["initialize", "start", "polling"]
        return telegram.log

    log = asyncio.run(scenario())
    assert ticks == ["started"]
    assert log[-3:] == ["updater.stop", "stop", "shutdown"]


def test_telegram_failure_does_not_break_start_up(tmp_path, monkeypatch):
    async def fake_ticker(state):
        await asyncio.sleep(3600)

    monkeypatch.setattr(scheduler, "ticker", fake_ticker)
    telegram = FakeTelegramApp()

    async def bad_initialize():
        raise RuntimeError("bad token")

    telegram.initialize = bad_initialize
    state = main.AppState(config=make_config(tmp_path), db_path=tmp_path / "x.db", aw=None, telegram_app=telegram)

    async def scenario():
        async with main.background_services(state):
            pass

    asyncio.run(scenario())  # must not raise


def test_attach_background_services_wraps_the_app_lifespan(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    started = []

    async def fake_ticker(state):
        started.append("up")
        try:
            await asyncio.sleep(3600)
        finally:
            started.append("down")

    monkeypatch.setattr(scheduler, "ticker", fake_ticker)
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    state = main.AppState(config=make_config(tmp_path), db_path=tmp_path / "x.db", aw=None)
    main.attach_background_services(app, state)
    with TestClient(app) as client:
        assert client.get("/health").json() == {"ok": True}
    assert started == ["up", "down"]


# --------------------------------------------------------------------------
# Fix pass: regression tests
# --------------------------------------------------------------------------

WEDNESDAY = date(2026, 10, 14)    # Tuesday 10-13 has no floor unless a test logs one


def test_lapse_card_is_not_sent_once_the_web_flow_answered_it(db_path):
    with db.get_conn(db_path) as conn:
        floor_before(conn, TUESDAY)                       # Monday is fine; Tuesday is missed
        scheduler.ensure_slots(conn, WEDNESDAY, utc(WEDNESDAY, "04:30", conn))
        assert kinds(conn, WEDNESDAY) == ["evening_close", "lapse"]
        rules.record_lapse(conn, TUESDAY, "tired", "repair", None)    # what POST /lapse does
        assert slot(conn, "lapse", WEDNESDAY)["status"] == "answered"
        now = utc(WEDNESDAY, "07:45", conn)
    assert "lapse" not in [c.slot["kind"] for c in scheduler.collect_due_cards(db_path, 8765, now)]


def test_lapse_card_is_dropped_and_morning_returns_when_the_day_is_backfilled(db_path):
    with db.get_conn(db_path) as conn:
        floor_before(conn, TUESDAY)
        scheduler.ensure_slots(conn, WEDNESDAY, utc(WEDNESDAY, "04:30", conn))
        log_floor(conn, TUESDAY)                          # yesterday was labelled afterwards
        now = utc(WEDNESDAY, "07:45", conn)
    sent = [c.slot["kind"] for c in scheduler.collect_due_cards(db_path, 8765, now)]
    assert sent == ["morning"]
    with db.get_conn(db_path) as conn:
        assert slot(conn, "lapse", WEDNESDAY)["status"] == "skipped"


def test_a_reason_alone_keeps_the_lapse_card_pending(db_path):
    with db.get_conn(db_path) as conn:
        floor_before(conn, TUESDAY)
        scheduler.ensure_slots(conn, WEDNESDAY, utc(WEDNESDAY, "04:30", conn))
        conn.execute("INSERT INTO lapses(local_date, reason, created_at) VALUES (?, 'tired', ?)",
                     (TUESDAY.isoformat(), db.utc_now_iso()))
        now = utc(WEDNESDAY, "07:45", conn)
    assert "lapse" in [c.slot["kind"] for c in scheduler.collect_due_cards(db_path, 8765, now)]


def test_morning_card_is_not_caught_up_once_the_evening_has_begun(db_path):
    with db.get_conn(db_path) as conn:
        floor_before(conn, TUESDAY)
        scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:00", conn))
        evening = utc(TUESDAY, "21:00", conn)
        afternoon = utc(TUESDAY, "15:00", conn)
    assert [c.slot["kind"] for c in scheduler.collect_due_cards(db_path, 8765, afternoon)] == ["morning"]
    with db.get_conn(db_path) as conn:
        conn.execute("UPDATE slots SET status = 'pending'")
    assert "morning" not in [c.slot["kind"] for c in scheduler.collect_due_cards(db_path, 8765, evening)]
    with db.get_conn(db_path) as conn:
        assert slot(conn, "morning")["status"] == "expired"


def test_one_unrenderable_slot_does_not_stop_the_other_cards(db_path):
    with db.get_conn(db_path) as conn:
        floor_before(conn, TUESDAY)
        now = utc(TUESDAY, "08:00", conn)
        conn.execute(
            "INSERT INTO plan_blocks(local_date, category, minutes, cue_time, created_at) "
            "VALUES (?, 'Python', 60, 'bad', ?)", (TUESDAY.isoformat(), db.utc_now_iso()),
        )
        bad_block = conn.execute("SELECT id FROM plan_blocks").fetchone()[0]
        add_slot(conn, "block_end", TUESDAY, now - timedelta(minutes=5), ref_id=bad_block)
    for _ in range(2):  # the second tick proves the bad slot no longer fails every minute
        cards = scheduler.collect_due_cards(db_path, 8765, now)
        assert [c.slot["kind"] for c in cards] in (["morning"], [])
    with db.get_conn(db_path) as conn:
        assert slot(conn, "block_end")["status"] == "skipped"
        assert slot(conn, "morning") is not None


def test_a_failed_mark_sent_never_leads_to_a_duplicate_send(db_path, tmp_path, monkeypatch):
    sent = []
    monkeypatch.setattr(notify, "notify", lambda title, body, url=None: sent.append(title) or True)

    def locked(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(scheduler, "mark_sent", locked)
    with db.get_conn(db_path) as conn:
        now = utc(TUESDAY, "08:00", conn)
        floor_before(conn, TUESDAY)
    assert asyncio.run(scheduler.tick(make_state(db_path, tmp_path), now)) == 0
    assert sent == []   # nothing went out that could not be recorded


def test_evening_close_card_offers_the_job_block_buttons_on_job_days(conn):
    floor_before(conn, TUESDAY)
    scheduler.ensure_slots(conn, TUESDAY, utc(TUESDAY, "06:00", conn))
    _, _, buttons, _ = scheduler.render(conn, slot(conn, "evening_close"))
    data = [d for row in buttons for _, d in row]
    assert data == [f"jc:{TUESDAY.isoformat()}:{code}" for code in "uelv"]
    assert all(len(d.encode()) <= 64 for d in data)
    rules.close_job_block(conn, TUESDAY, "usual")                  # already answered: no buttons
    assert scheduler.render(conn, slot(conn, "evening_close"))[2] == []


def test_evening_close_card_has_no_job_buttons_on_a_free_day(conn):
    saturday = date(2026, 10, 17)
    floor_before(conn, saturday)
    scheduler.ensure_slots(conn, saturday, utc(saturday, "06:00", conn))
    assert scheduler.render(conn, slot(conn, "evening_close", saturday))[2] == []


def test_card_text_is_cut_to_telegram_limits():
    row = {"id": 1, "kind": "sunday"}
    card = scheduler.DueCard(row, "Weekly review", "x" * 9000, [], "http://127.0.0.1:8765/week")
    assert len(card.text) <= 4096 and card.text.endswith("http://127.0.0.1:8765/week")


def test_build_state_keeps_telegram_off_until_it_has_started(tmp_path, monkeypatch):
    first, second = FakeTelegramApp(), FakeTelegramApp()

    async def fake_ticker(state):
        await asyncio.sleep(3600)

    async def bad_initialize():
        raise RuntimeError("no network yet")

    first.initialize = bad_initialize
    monkeypatch.setattr(scheduler, "ticker", fake_ticker)
    monkeypatch.setattr(main, "TELEGRAM_RETRY_SECONDS", (0,))
    monkeypatch.setattr(main, "_build_telegram", lambda state: second)
    state = main.AppState(config=make_config(tmp_path), db_path=tmp_path / "x.db", aw=None, telegram_app=first)

    async def scenario():
        async with main.background_services(state):
            assert state.telegram_app is None          # failed start: nothing pretends Telegram works
            for _ in range(20):
                await asyncio.sleep(0)
            assert state.telegram_app is second        # the retry brought it up
        return second.log

    log = asyncio.run(scenario())
    assert log[:3] == ["initialize", "start", "polling"] and log[-3:] == ["updater.stop", "stop", "shutdown"]


def test_logging_never_writes_the_telegram_token(capsys):
    root = logging.getLogger()
    saved = (root.handlers[:], root.level)
    root.handlers.clear()
    try:
        main.configure_logging()
        logging.getLogger("httpx").info("HTTP Request: POST https://api.telegram.org/bot123456:SECRET-tok/getUpdates")
        logging.getLogger("witness.x").warning("sending to https://api.telegram.org/bot123456:SECRET-tok/sendMessage")
        err = capsys.readouterr().err
    finally:
        root.handlers[:] = saved[0]
        root.setLevel(saved[1])
    assert "SECRET-tok" not in err and "bot<hidden>" in err
