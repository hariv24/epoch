"""Telegram bot tests. Handlers are called directly with tiny fake Update/Context objects.

Nothing here touches the network.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from epoch import db, rules, telegram_bot, timeutil
from epoch.config import Config
from epoch.telegram_bot import EpochBot

OWNER = 4242
STRANGER = 999
# Saturday 21:00 IST. The test DB starts on Monday 2026-10-05; the contract begins 2026-10-12.
NOW = datetime(2026, 10, 17, 15, 30, tzinfo=timezone.utc)
TODAY = date(2026, 10, 17)
GUILT_WORDS = ("failed", "wasted", "streak lost", "lazy", "future self")


# ---------------------------------------------------------------------------
# Fakes and fixtures
# ---------------------------------------------------------------------------

class FakeMessage:
    def __init__(self, text: str = "") -> None:
        self.text = text
        self.replies: list[str] = []

    async def reply_text(self, text: str, **kwargs) -> None:
        self.replies.append(text)


class FakeQuery:
    def __init__(self, data: str, events: list[str]) -> None:
        self.data = data
        self.events = events
        self.edits: list[tuple[str, object]] = []

    async def answer(self, *args, **kwargs) -> None:
        self.events.append("answer")

    async def edit_message_text(self, text: str, reply_markup=None, **kwargs) -> None:
        self.events.append("edit")
        self.edits.append((text, reply_markup))


def make_update(user_id: int, text: str = "", query: FakeQuery | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        effective_user=SimpleNamespace(id=user_id),
        message=None if query else FakeMessage(text),
        callback_query=query,
    )


def make_context(*args: str) -> SimpleNamespace:
    return SimpleNamespace(args=list(args))


def make_state(db_path, enabled: bool = True) -> SimpleNamespace:
    config = Config(
        data_dir=db_path.parent, db_path=db_path, backup_dir=None, port=8765,
        telegram_bot_token="123:fake-token" if enabled else None,
        telegram_user_id=OWNER if enabled else None,
        openrouter_api_key=None, openrouter_models=(), activitywatch_url="http://localhost:5600",
    )
    return SimpleNamespace(config=config, db_path=db_path, telegram_app=None, aw=None, llm=None)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: NOW)


@pytest.fixture
def state(db_path):
    return make_state(db_path)


@pytest.fixture
def bot(state):
    return EpochBot(state)


def run_text(bot: EpochBot, text: str, user_id: int = OWNER) -> FakeMessage:
    update = make_update(user_id, text)
    asyncio.run(bot.on_text(update, make_context()))
    return update.message


def run_command(handler, *args: str, user_id: int = OWNER) -> FakeMessage:
    update = make_update(user_id)
    asyncio.run(handler(update, make_context(*args)))
    return update.message


def tap(bot: EpochBot, data: str, user_id: int = OWNER) -> FakeQuery:
    query = FakeQuery(data, [])
    asyncio.run(bot.on_callback(make_update(user_id, query=query), make_context()))
    return query


def entries(db_path) -> list:
    with db.get_conn(db_path) as conn:
        return conn.execute("SELECT * FROM entries WHERE deleted = 0 ORDER BY id").fetchall()


def add_slot(db_path, kind="block_end", ref_id=0, status="sent", due="2026-10-17T15:00:00Z") -> int:
    with db.get_conn(db_path) as conn:
        cursor = conn.execute(
            "INSERT INTO slots(kind, local_date, ref_id, due_utc, status) VALUES (?, ?, ?, ?, ?)",
            (kind, TODAY.isoformat(), ref_id, due, status),
        )
        return int(cursor.lastrowid)


def assert_kind(text: str) -> None:
    lowered = text.lower()
    for word in GUILT_WORDS:
        assert word not in lowered


# ---------------------------------------------------------------------------
# build_application and sending
# ---------------------------------------------------------------------------

def test_build_application_none_when_not_configured(db_path):
    assert telegram_bot.build_application(make_state(db_path, enabled=False)) is None


def test_build_application_registers_handlers(state):
    app = telegram_bot.build_application(state)
    assert app is not None
    assert app.persistence is None
    handler_names = {type(h).__name__ for h in app.handlers[0]}
    assert {"CommandHandler", "MessageHandler", "CallbackQueryHandler"} <= handler_names
    commands = {c for h in app.handlers[0] if type(h).__name__ == "CommandHandler" for c in h.commands}
    assert {"start", "help", "log", "shipped", "focus", "skip", "today", "week", "referee"} <= commands


class FakeTelegramBot:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[dict] = []

    async def send_message(self, **kwargs):
        if self.fail:
            raise RuntimeError("network down")
        self.sent.append(kwargs)
        return SimpleNamespace(message_id=77)


def test_send_card_returns_message_id(state):
    state.telegram_app = SimpleNamespace(bot=FakeTelegramBot())
    result = asyncio.run(telegram_bot.send_card(state, {"id": 1}, "What did it go to?", [[("Python", "ci:1:py")]]))
    assert result == 77
    sent = state.telegram_app.bot.sent[0]
    assert sent["chat_id"] == OWNER
    assert sent["reply_markup"].inline_keyboard[0][0].callback_data == "ci:1:py"


def test_send_card_never_raises(state):
    state.telegram_app = SimpleNamespace(bot=FakeTelegramBot(fail=True))
    assert asyncio.run(telegram_bot.send_card(state, {"id": 1}, "hi", [])) is None
    assert asyncio.run(telegram_bot.send_text(state, 5, "hi")) is None
    state.telegram_app = None
    assert asyncio.run(telegram_bot.send_card(state, None, "hi", [])) is None


def test_send_card_rejects_long_callback_data_without_raising(state):
    state.telegram_app = SimpleNamespace(bot=FakeTelegramBot())
    too_long = [[("x", "ci:" + "9" * 70)]]
    assert asyncio.run(telegram_bot.send_card(state, {"id": 1}, "hi", too_long)) is None


def test_send_text(state):
    state.telegram_app = SimpleNamespace(bot=FakeTelegramBot())
    assert asyncio.run(telegram_bot.send_text(state, 555, "Week 3 report")) == 77
    assert state.telegram_app.bot.sent[0]["chat_id"] == 555


# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------

def test_stranger_is_ignored_everywhere(bot, db_path):
    assert run_text(bot, "45m python", user_id=STRANGER).replies == []
    for handler in (bot.cmd_start, bot.cmd_help, bot.cmd_today, bot.cmd_week):
        assert run_command(handler, user_id=STRANGER).replies == []
    assert run_command(bot.cmd_skip, "tired", user_id=STRANGER).replies == []
    assert run_command(bot.cmd_referee, "123", user_id=STRANGER).replies == []
    assert entries(db_path) == []
    with db.get_conn(db_path) as conn:
        assert db.get_setting(conn, "referee_chat_id") is None
        assert conn.execute("SELECT COUNT(*) FROM day_marks").fetchone()[0] == 0


def test_stranger_callback_is_ignored_silently(bot, db_path):
    slot_id = add_slot(db_path)
    query = tap(bot, f"ci:{slot_id}:py", user_id=STRANGER)
    assert query.events == []  # not even answered
    assert entries(db_path) == []


def test_no_owner_configured_ignores_everyone(db_path):
    state = make_state(db_path, enabled=False)
    bot = EpochBot(state)
    assert run_text(bot, "45m python", user_id=OWNER).replies == []


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def test_plain_text_is_parsed_and_saved(bot, db_path):
    message = run_text(bot, "45m numpy ex 1-12")
    assert message.replies[0].startswith("Logged · Python · 45 min · deep")
    assert "floor" in message.replies[0]
    saved = entries(db_path)
    assert len(saved) == 1
    assert saved[0]["category"] == "Python"
    assert saved[0]["deep"] == 1
    assert saved[0]["source"] == "telegram"
    assert saved[0]["end_utc"] == "2026-10-17T15:30:00Z"
    assert saved[0]["start_utc"] == "2026-10-17T14:45:00Z"


def test_hours_and_minutes_text(bot, db_path):
    message = run_text(bot, "1h30 math LA 2.1")
    assert "Math · 90 min" in message.replies[0]
    assert entries(db_path)[0]["category"] == "Math"


def test_log_command_uses_same_path(bot, db_path):
    message = run_command(bot.cmd_log, "30m", "papers", "attention")
    assert message.replies[0].startswith("Logged · Papers · 30 min")
    assert len(entries(db_path)) == 1


def test_log_command_without_text_shows_example(bot, db_path):
    message = run_command(bot.cmd_log)
    assert "45m numpy ex 1-12" in message.replies[0]
    assert entries(db_path) == []


def test_unreadable_text_gets_friendly_reply_with_example(bot, db_path):
    message = run_text(bot, "hello there")
    assert "couldn't read" in message.replies[0]
    assert "45m numpy ex 1-12" in message.replies[0]
    assert entries(db_path) == []
    assert_kind(message.replies[0])


def test_comeback_line_after_a_missed_day(bot, db_path):
    # Friday 16 Oct has nothing logged, so it is missed and today's first floor is a comeback.
    message = run_text(bot, "40m python")
    assert "Comeback day" in message.replies[0]
    again = run_text(bot, "10m python")
    assert "Comeback day" not in again.replies[0]


def test_distracted_text_is_logged_without_lecture(bot, db_path):
    message = run_text(bot, "yt 40m")
    assert message.replies[0].startswith("Logged · Distracted · 40 min")
    assert "floor" not in message.replies[0]


# ---------------------------------------------------------------------------
# /shipped
# ---------------------------------------------------------------------------

def test_shipped_defaults_to_settings_phase(bot, db_path):
    with db.get_conn(db_path) as conn:
        db.set_setting(conn, "phase", "Math")
    message = run_command(bot.cmd_shipped, "https://github.com/me/nb", "12", "broadcasting", "exercises")
    reply = message.replies[0]
    assert "Shipped · Math" in reply and "12 broadcasting exercises" in reply
    assert "outputs 1 of 2" in reply
    with db.get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM outputs").fetchone()
    assert row["url"] == "https://github.com/me/nb"
    assert row["stage"] == "Math"
    assert row["local_date"] == "2026-10-17"


def test_shipped_stage_named_in_text(bot, db_path):
    message = run_command(bot.cmd_shipped, "https://example.com/post", "explainer", "thread", "on", "attention")
    assert "Writing/X" in message.replies[0]


def test_shipped_without_description_asks_for_one(bot, db_path):
    message = run_command(bot.cmd_shipped, "https://example.com/x")
    assert "one line" in message.replies[0]
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM outputs").fetchone()[0] == 0


def test_shipped_without_link_still_saves(bot, db_path):
    message = run_command(bot.cmd_shipped, "finished", "chapter", "6", "exercises")
    assert message.replies[0].startswith("Shipped · Python")
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT url FROM outputs").fetchone()["url"] is None


def test_shipped_marks_second_output_as_done(bot, db_path):
    run_command(bot.cmd_shipped, "first", "thing")
    message = run_command(bot.cmd_shipped, "second", "thing")
    assert "outputs 2 of 2 ✓" in message.replies[0]


# ---------------------------------------------------------------------------
# /focus
# ---------------------------------------------------------------------------

def test_focus_start_reports_end_time(bot, db_path):
    message = run_command(bot.cmd_focus, "50", "numpy", "broadcasting")
    # 21:00 IST + 50 min
    assert message.replies[0].startswith("Focus: “numpy broadcasting”, 50 min, until 21:50")
    with db.get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM focus_sessions").fetchone()
    assert row["planned_minutes"] == 50
    assert row["category"] == "Python"
    assert row["end_utc"] is None


def test_focus_second_start_is_refused_while_running(bot, db_path):
    run_command(bot.cmd_focus, "50", "numpy")
    message = run_command(bot.cmd_focus, "25", "math")
    assert "already running" in message.replies[0]
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM focus_sessions").fetchone()[0] == 1


def test_focus_rejects_silly_length(bot, db_path):
    message = run_command(bot.cmd_focus, "0", "x")
    assert "between 1 and" in message.replies[0]
    message = run_command(bot.cmd_focus, "9000", "x")
    assert "between 1 and" in message.replies[0]


def test_focus_stop_logs_elapsed_time(bot, db_path, monkeypatch):
    run_command(bot.cmd_focus, "50", "math", "LA")
    later = datetime(2026, 10, 17, 16, 0, tzinfo=timezone.utc)  # 30 minutes in
    monkeypatch.setattr(timeutil, "now_utc", lambda: later)
    message = run_command(bot.cmd_focus, "stop")
    assert "Focus ended · Math · 30 min" in message.replies[0]
    saved = entries(db_path)
    assert saved[0]["source"] == "focus" and saved[0]["category"] == "Math"
    with db.get_conn(db_path) as conn:
        session = conn.execute("SELECT * FROM focus_sessions").fetchone()
    assert session["outcome"] == "mostly" and session["entry_id"] == saved[0]["id"]


def test_focus_cancel_logs_nothing(bot, db_path):
    run_command(bot.cmd_focus, "50", "math")
    message = run_command(bot.cmd_focus, "cancel")
    assert "cancelled" in message.replies[0]
    assert entries(db_path) == []
    assert "No focus session" in run_command(bot.cmd_focus, "stop").replies[0]


# ---------------------------------------------------------------------------
# /skip
# ---------------------------------------------------------------------------

def test_skip_uses_a_skip(bot, db_path):
    message = run_command(bot.cmd_skip, "tired", "after", "travel")
    assert "Skip used for today" in message.replies[0]
    assert "1 left" in message.replies[0]
    with db.get_conn(db_path) as conn:
        row = conn.execute("SELECT * FROM day_marks").fetchone()
    assert row["local_date"] == "2026-10-17" and row["reason"] == "tired after travel"


def test_skip_limit_message_is_kind(bot, db_path):
    with db.get_conn(db_path) as conn:
        rules.use_skip(conn, date(2026, 10, 12))
        rules.use_skip(conn, date(2026, 10, 13))
    message = run_command(bot.cmd_skip, "busy")
    reply = message.replies[0]
    assert "All 2 skips" in reply and "30 minutes" in reply
    assert_kind(reply)
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM day_marks").fetchone()[0] == 2


def test_skip_twice_on_same_day_costs_one(bot, db_path):
    run_command(bot.cmd_skip, "tired")
    message = run_command(bot.cmd_skip, "tired")
    assert "already marked" in message.replies[0]


# ---------------------------------------------------------------------------
# /today, /week, /referee, /help
# ---------------------------------------------------------------------------

def test_today_and_week_are_compact(bot, db_path):
    run_text(bot, "1h python")
    run_command(bot.cmd_shipped, "a", "notebook")
    today = run_command(bot.cmd_today).replies[0]
    assert "Today · Day 13 · Sat 17 Oct" in today
    assert "floor met ✓" in today
    assert "outputs 1/2" in today
    week = run_command(bot.cmd_week).replies[0]
    assert "Week of Mon 12 Oct · Days 8-14" in week
    assert "• a notebook" in week
    assert "Python 1h" in week
    for text in (today, week):
        assert_kind(text)
        assert len(text) < 800


def test_week_baseline_wording(bot, db_path, monkeypatch):
    monkeypatch.setattr(timeutil, "now_utc", lambda: datetime(2026, 10, 8, 15, 0, tzinfo=timezone.utc))
    week = run_command(bot.cmd_week).replies[0]
    assert "baseline" in week
    today = run_command(bot.cmd_today).replies[0]
    assert "no targets" in today


def test_referee_set_show_and_clear(bot, db_path):
    assert "No referee" in run_command(bot.cmd_referee).replies[0]
    assert "chat -100123" in run_command(bot.cmd_referee, "-100123", "Sam").replies[0]
    with db.get_conn(db_path) as conn:
        assert db.get_setting(conn, "referee_chat_id") == -100123
        assert db.get_setting(conn, "referee_name") == "Sam"
    assert "Sam" in run_command(bot.cmd_referee).replies[0]
    assert "not a number" in run_command(bot.cmd_referee, "abc").replies[0] or "number" in run_command(bot.cmd_referee, "abc").replies[0]
    run_command(bot.cmd_referee, "off")
    with db.get_conn(db_path) as conn:
        assert db.get_setting(conn, "referee_chat_id") is None


def test_start_and_help_list_commands(bot):
    assert "/shipped" in run_command(bot.cmd_help).replies[0]
    assert "/focus" in run_command(bot.cmd_start).replies[0]


# ---------------------------------------------------------------------------
# Callbacks: ci / dp
# ---------------------------------------------------------------------------

def test_category_tap_answers_first_then_edits_into_receipt(bot, db_path):
    with db.get_conn(db_path) as conn:
        block = rules.add_plan_block(conn, TODAY, "Python", 60, "19:30", "ch.6")
    slot_id = add_slot(db_path, ref_id=block)
    query = tap(bot, f"ci:{slot_id}:py")
    assert query.events == ["answer", "edit"]
    text, markup = query.edits[0]
    assert text.splitlines()[0] == "Logged · Python · 60 min · deep"
    assert text.splitlines()[1:] == ["Doors open", "Back on"]       # the milestones this tap reached
    # The only remaining buttons are the deep/shallow pair from the contract.
    assert [b.callback_data for b in markup.inline_keyboard[0]] == [
        f"dp:{entries(db_path)[0]['id']}:d", f"dp:{entries(db_path)[0]['id']}:s",
    ]
    saved = entries(db_path)[0]
    assert saved["start_utc"] == "2026-10-17T14:00:00Z" and saved["end_utc"] == "2026-10-17T15:00:00Z"
    assert saved["plan_block_id"] == block and saved["source"] == "telegram"
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT status FROM slots WHERE id = ?", (slot_id,)).fetchone()["status"] == "answered"
        assert conn.execute("SELECT status FROM plan_blocks WHERE id = ?", (block,)).fetchone()["status"] == "done"


def test_category_tap_is_idempotent(bot, db_path):
    slot_id = add_slot(db_path)
    first = tap(bot, f"ci:{slot_id}:py")
    second = tap(bot, f"ci:{slot_id}:ma")  # a stale tap on another button
    assert len(entries(db_path)) == 1
    assert second.edits[0][0] == first.edits[0][0].splitlines()[0] == "Logged · Python · 30 min · deep"
    assert first.edits[0][0].splitlines()[1:] == ["Doors open", "Back on"]
    assert second.edits[0][1] is None  # buttons removed


def test_non_deep_category_receipt_has_no_buttons(bot, db_path):
    slot_id = add_slot(db_path)
    query = tap(bot, f"ci:{slot_id}:re")
    assert query.edits[0] == ("Logged · Rest · 30 min", None)


def test_distracted_tap_just_says_logged(bot, db_path):
    slot_id = add_slot(db_path)
    query = tap(bot, f"ci:{slot_id}:di")
    assert query.edits[0] == ("Logged.", None)
    assert entries(db_path)[0]["category"] == "Distracted"


def test_different_category_than_planned_does_not_link_block(bot, db_path):
    with db.get_conn(db_path) as conn:
        block = rules.add_plan_block(conn, TODAY, "Python", 60, "19:30")
    slot_id = add_slot(db_path, ref_id=block)
    tap(bot, f"ci:{slot_id}:ma")
    assert entries(db_path)[0]["plan_block_id"] is None
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT status FROM plan_blocks").fetchone()["status"] == "skipped"


def test_unknown_slot_and_bad_data(bot, db_path):
    assert "no longer available" in tap(bot, "ci:9999:py").edits[0][0]
    assert "couldn't read" in tap(bot, "ci:abc:py").edits[0][0]
    assert "out of date" in tap(bot, "zz:1:2").edits[0][0]
    assert entries(db_path) == []


def test_deep_shallow_tap_is_idempotent(bot, db_path):
    slot_id = add_slot(db_path)
    tap(bot, f"ci:{slot_id}:py")
    entry_id = entries(db_path)[0]["id"]
    first = tap(bot, f"dp:{entry_id}:s")
    again = tap(bot, f"dp:{entry_id}:s")
    assert first.edits[0] == ("Logged · Python · 30 min · shallow", None)
    assert again.edits[0] == first.edits[0]
    assert entries(db_path)[0]["deep"] == 0
    back = tap(bot, f"dp:{entry_id}:d")
    assert back.edits[0][0].endswith("· deep")


def test_deep_tap_on_removed_entry(bot, db_path):
    assert "no longer there" in tap(bot, "dp:12345:d").edits[0][0]


# ---------------------------------------------------------------------------
# Callbacks: jc
# ---------------------------------------------------------------------------

def test_job_close_taps(bot, db_path):
    friday = "2026-10-16"
    query = tap(bot, f"jc:{friday}:e")
    assert query.events == ["answer", "edit"]
    text, markup = query.edits[0]
    assert "Day job · 10:00–17:00, left early" in text
    assert "http://127.0.0.1:8765/close" in text
    assert markup is None
    job = entries(db_path)[0]
    assert job["category"] == "Day job" and job["end_utc"] == "2026-10-16T11:30:00Z"  # 17:00 IST

    tap(bot, f"jc:{friday}:e")  # same tap again changes nothing
    assert len(entries(db_path)) == 1
    tap(bot, f"jc:{friday}:v")  # leave day: entry removed
    assert entries(db_path) == []
    assert "as usual" in tap(bot, f"jc:{friday}:u").edits[0][0]
    assert "stayed late" in tap(bot, f"jc:{friday}:l").edits[0][0]


def test_job_close_bad_date(bot):
    assert "couldn't read" in tap(bot, "jc:not-a-date:u").edits[0][0]


# ---------------------------------------------------------------------------
# Callbacks: lp / lc
# ---------------------------------------------------------------------------

def test_lapse_reason_then_choice_flow(bot, db_path):
    assert rules.pending_lapse(db_conn(db_path), TODAY) == date(2026, 10, 16)
    reason_tap = tap(bot, "lp:2026-10-16:tired")
    text, markup = reason_tap.edits[0]
    assert "Tired" in text
    callbacks = [b.callback_data for row in markup.inline_keyboard for b in row]
    assert callbacks == ["lc:2026-10-16:skip", "lc:2026-10-16:repair", "lc:2026-10-16:letgo"]
    assert_kind(text)

    choice_tap = tap(bot, "lc:2026-10-16:repair")
    text, markup = choice_tap.edits[0]
    assert "Repair window open" in text and "minimum plan" in text and "smallest" not in text
    assert markup is None
    assert "25 min of Python at 10:00" in text  # Saturday uses the weekend start

    with db.get_conn(db_path) as conn:
        lapse = conn.execute("SELECT * FROM lapses").fetchone()
    assert (lapse["reason"], lapse["choice"]) == ("tired", "repair")


def db_conn(db_path):
    return db.connect(db_path)


def test_lapse_choice_is_idempotent(bot, db_path):
    tap(bot, "lp:2026-10-16:phone")
    first = tap(bot, "lc:2026-10-16:letgo")
    second = tap(bot, "lc:2026-10-16:skip")  # a stale button must not change the answer
    assert second.edits[0] == first.edits[0]
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT choice FROM lapses").fetchone()["choice"] == "let_go"
        assert conn.execute("SELECT COUNT(*) FROM day_marks").fetchone()[0] == 0
    stale_reason = tap(bot, "lp:2026-10-16:tired")
    assert stale_reason.edits[0][1] is None


def test_lapse_skip_uses_a_skip(bot, db_path):
    tap(bot, "lp:2026-10-16:work_late")
    text = tap(bot, "lc:2026-10-16:skip").edits[0][0]
    assert "Fri 16 Oct is marked as rest" in text
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT local_date FROM day_marks").fetchone()["local_date"] == "2026-10-16"


def test_lapse_skip_with_no_skips_left_is_let_go(bot, db_path):
    with db.get_conn(db_path) as conn:
        rules.use_skip(conn, date(2026, 10, 12))
        rules.use_skip(conn, date(2026, 10, 13))
    tap(bot, "lp:2026-10-16:too_big")
    text = tap(bot, "lc:2026-10-16:skip").edits[0][0]
    assert "No rest days were left this week" in text
    assert_kind(text)
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT choice FROM lapses").fetchone()["choice"] == "let_go"


def test_lapse_choice_closes_the_lapse_slot(bot, db_path):
    slot_id = add_slot(db_path, kind="lapse", status="sent")
    tap(bot, "lc:2026-10-16:letgo")
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT status FROM slots WHERE id = ?", (slot_id,)).fetchone()["status"] == "answered"


def test_every_button_we_build_fits_telegram_limit(bot, db_path):
    slot_id = add_slot(db_path)
    reason = tap(bot, "lp:2026-10-16:unclear_step").edits[0][1]
    first = tap(bot, f"ci:{slot_id}:py").edits[0][1]
    for markup in (reason, first):
        for row in markup.inline_keyboard:
            for button in row:
                assert len(button.callback_data.encode()) <= 64


def test_callback_survives_a_failing_edit(bot, db_path):
    """If Telegram refuses the edit, the change is still saved and nothing raises."""
    class BrokenQuery(FakeQuery):
        async def edit_message_text(self, *args, **kwargs):
            raise RuntimeError("message is not modified")

    slot_id = add_slot(db_path)
    query = BrokenQuery(f"ci:{slot_id}:py", [])
    asyncio.run(bot.on_callback(make_update(OWNER, query=query), make_context()))
    assert len(entries(db_path)) == 1


# ---------------------------------------------------------------------------
# Fix pass: regression tests
# ---------------------------------------------------------------------------

def test_lapse_skip_label_counts_the_missed_days_week(bot, db_path, monkeypatch):
    """On Monday, Sunday's miss spends LAST week's skips, and the label must say so."""
    monday_evening = datetime(2026, 10, 19, 15, 30, tzinfo=timezone.utc)
    monkeypatch.setattr(timeutil, "now_utc", lambda: monday_evening)
    with db.get_conn(db_path) as conn:
        rules.use_skip(conn, date(2026, 10, 12))
        rules.use_skip(conn, date(2026, 10, 13))      # last week's two skips are gone
    markup = tap(bot, "lp:2026-10-18:tired").edits[0][1]
    labels = [b.text for row in markup.inline_keyboard for b in row]
    assert labels[0] == "Mark it as rest (0 left)"


def test_a_reason_tap_leaves_the_lapse_pending_for_the_web(bot, db_path):
    tap(bot, "lp:2026-10-16:tired")
    assert rules.pending_lapse(db_conn(db_path), TODAY) == date(2026, 10, 16)


def test_focus_refuses_a_second_session_while_an_old_one_is_still_open(bot, db_path, monkeypatch):
    run_command(bot.cmd_focus, "25", "numpy")
    later = datetime(2026, 10, 17, 16, 10, tzinfo=timezone.utc)      # 40 min on: past the planned end
    monkeypatch.setattr(timeutil, "now_utc", lambda: later)
    message = run_command(bot.cmd_focus, "25", "math")
    assert "still open" in message.replies[0]
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM focus_sessions").fetchone()[0] == 1


def test_long_messages_are_cut_to_the_telegram_limit():
    assert len(telegram_bot.clip_message("x" * 9000)) <= 4096
    assert telegram_bot.clip_message("short") == "short"


def test_typed_log_receipt_names_the_milestone_it_reached(bot):
    message = run_text(bot, "45m numpy ex 1-12")
    assert "Doors open" in message.replies[0]
    assert_kind(message.replies[0])
    again = run_text(bot, "5m numpy")
    assert "Doors open" not in again.replies[0]  # a milestone is named once


def test_deep_toggle_and_job_tap_run_the_game_step(bot, db_path):
    """Writes from Telegram callbacks other than the category tap also sync the ledger and name milestones."""
    with db.get_conn(db_path) as conn:
        entry_id = rules.add_entry(conn, NOW - timedelta(minutes=70), NOW - timedelta(minutes=10), "Python", False, "telegram")
        assert not rules.day_summary(conn, TODAY).floor_met
    query = tap(bot, f"dp:{entry_id}:d")
    text = query.edits[0][0]
    assert text.splitlines()[0].startswith("Logged · Python") and "Doors open" in text.splitlines()
    with db.get_conn(db_path) as conn:
        assert conn.execute("SELECT 1 FROM unlocks WHERE key = 'ach:first_floor'").fetchone() is not None
