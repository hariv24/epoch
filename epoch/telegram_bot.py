"""Telegram bot (secondary surface): quick logging from the phone and one-tap check-in cards.

The browser is the main surface. This module only talks to one person (the owner,
`config.telegram_user_id`); every other sender is ignored silently. Long polling only.

Layout, top to bottom:
  1. small text helpers
  2. `EpochBot`: command handlers, the plain-text log handler, and callback handlers
  3. `build_application`, `send_card`, `send_text`, `start_bot`, `stop_bot`

Callback data schemes (each at most 64 bytes):
  ci:<slot_id>:<code>      category for a block-end card
  dp:<entry_id>:<d|s>      deep or shallow
  jc:<date>:<u|e|l|v>      close the day-job block (usual / left early / stayed late / leave)
  lp:<date>:<reason>       reason for a missed day
  lc:<date>:<skip|repair|letgo>   what to do about a missed day
"""
from __future__ import annotations

import asyncio
import functools
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Awaitable, Callable

from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, MessageHandler, filters

from . import categories, db, economy, game, parser, pomodoro, rules, timeutil

log = logging.getLogger("witness.telegram")

Buttons = list[list[tuple[str, str]]]  # rows of (label, callback_data)

MAX_CALLBACK_BYTES = 64
DEFAULT_FOCUS_MINUTES = 25
MAX_FOCUS_MINUTES = 240
MAX_MESSAGE_CHARS = 4000     # Telegram refuses messages over 4096 characters
MINIMUM_PLAN_MINUTES = 25   # the optional "tonight's minimum plan" offered after a lapse choice

LOG_EXAMPLE = "45m numpy ex 1-12"
UNREAD_TEXT = (
    "I couldn't read that one. Try a time and a topic, like:\n"
    f"{LOG_EXAMPLE}\n1h30 math LA 2.1\nyt 40m"
)

HELP_TEXT = (
    "Send a quick log any time, for example: 45m numpy ex 1-12\n\n"
    "/log <text>  log time (plain text works too)\n"
    "/shipped <link> <what it shows>  record an output\n"
    "/focus <min> <label>  start a focus session (/focus stop, /focus cancel)\n"
    "/skip <reason>  use one of this week's skips for today\n"
    "/today  today at a glance\n"
    "/week  this week at a glance\n"
    "/referee <chat id> [name]  set who gets the Sunday report (/referee off to clear)\n"
    "/help  this list"
)

LAPSE_REASONS = {
    "work_late": "Work ran late",
    "tired": "Tired",
    "phone": "Phone/X",
    "unclear_step": "Unclear next step",
    "too_big": "Task too big",
    "other": "Other",
}

JOB_CODES = {"u": "usual", "e": "left_early", "l": "stayed_late", "v": "leave"}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

@dataclass
class Reply:
    """What to show: some text, and optionally a keyboard (empty means no buttons)."""

    text: str
    buttons: Buttons = field(default_factory=list)


def to_markup(buttons: Buttons | None) -> InlineKeyboardMarkup | None:
    """Convert (label, callback_data) rows to a Telegram keyboard, or None when empty."""
    if not buttons:
        return None
    rows = []
    for row in buttons:
        for _, data in row:
            if len(data.encode("utf-8")) > MAX_CALLBACK_BYTES:
                raise ValueError(f"callback data too long: {data!r}")
        rows.append([InlineKeyboardButton(label, callback_data=data) for label, data in row])
    return InlineKeyboardMarkup(rows)


def clip_message(text: str) -> str:
    """Cut a message to Telegram's size limit so a very long one is shortened instead of refused."""
    return text if len(text) <= MAX_MESSAGE_CHARS else text[: MAX_MESSAGE_CHARS - 1] + "…"


def fmt_hm(minutes: int) -> str:
    """45 -> '45 min', 100 -> '1h40', 120 -> '2h'."""
    if minutes < 60:
        return f"{minutes} min"
    hours, rest = divmod(minutes, 60)
    return f"{hours}h{rest:02d}" if rest else f"{hours}h"


def local_hhmm(dt: datetime, tzname: str) -> str:
    return dt.astimezone(timeutil.zone(tzname)).strftime("%H:%M")


def pretty_date(d: date) -> str:
    return f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"


def looks_like_url(token: str) -> bool:
    """True for 'https://...' and for bare 'github.com/me/repo' style links."""
    lowered = token.lower()
    if lowered.startswith(("http://", "https://")):
        return True
    return "." in token and "/" in token and " " not in token


def split_shipped_args(args: list[str]) -> tuple[str | None, str]:
    """('/shipped <url> <what>') -> (url or None, what). The link may be left out."""
    if args and looks_like_url(args[0]):
        return args[0], " ".join(args[1:]).strip()
    return None, " ".join(args).strip()


def _shift_hhmm(hhmm: str, hours: int) -> str:
    parsed = timeutil.parse_hhmm(hhmm)
    base = datetime(2000, 1, 1, parsed.hour, parsed.minute) + timedelta(hours=hours)
    return base.strftime("%H:%M")


GAME_LINE_KINDS = {"floor", "target", "output", "comeback", "repair", "week_kept", "node", "district", "level"}


def game_before(conn: sqlite3.Connection):
    """Snapshot before a write, so a milestone can be named afterwards. Never raises."""
    try:
        return game.snapshot(conn)
    except Exception:
        log.exception("game snapshot failed")
        return None


def game_lines(conn: sqlite3.Connection, before, entry: dict | None = None, output: dict | None = None) -> list[str]:
    """Fact lines for the milestones a write just reached (floor, target, output, ...). Never raises."""
    if before is None:
        return []
    try:
        events = game.finish_write(conn, before, entry=entry, output=output)
    except Exception:
        log.exception("game step failed")
        return []
    return [e["title"] for e in events if e.get("kind") in GAME_LINE_KINDS][:3]


def entry_receipt(row: sqlite3.Row) -> str:
    """'Logged · Python · 60 min · deep' for a saved entry row."""
    minutes = timeutil.minutes_between(timeutil.from_iso(row["start_utc"]), timeutil.from_iso(row["end_utc"]))
    if row["category"] == "Distracted":
        return "Logged."
    parts = ["Logged", row["category"], f"{minutes} min"]
    if parser.default_deep(row["category"]):
        parts.append("deep" if row["deep"] else "shallow")
    return " · ".join(parts)


def today_line(summary: rules.DaySummary) -> str:
    """One compact line about the floor, e.g. 'Today: deep 1h10 · floor met ✓'."""
    if summary.floor_met:
        floor = "floor met ✓"
    elif summary.mark:
        floor = f"{summary.mark} day"
    else:
        floor = f"{max(0, summary.floor_minutes - summary.deep_minutes)} min to the floor"
    return f"Today: deep {fmt_hm(summary.deep_minutes)} · {floor}"


# ---------------------------------------------------------------------------
# The bot
# ---------------------------------------------------------------------------

def _owner_only(method: Callable[..., Awaitable[None]]) -> Callable[..., Awaitable[None]]:
    """Run a handler only for the owner; anyone else is ignored without a reply."""

    @functools.wraps(method)
    async def wrapper(self: "EpochBot", update: Any, context: Any) -> None:
        if not self.is_owner(update):
            return
        try:
            await method(self, update, context)
        except Exception:  # a bug must never kill the polling loop
            log.exception("handler %s failed", method.__name__)
            message = getattr(update, "message", None)
            if message is not None:
                try:
                    await message.reply_text("Something went wrong on my side, and that wasn't saved. Try again in a moment.")
                except Exception:
                    log.exception("could not send the error reply")

    return wrapper


class EpochBot:
    """Holds the app state and exposes one async method per Telegram handler."""

    def __init__(self, state: Any) -> None:
        self.state = state
        self._callbacks: dict[str, Callable[[sqlite3.Connection, str], Reply]] = {
            "ci": self._cb_category,
            "dp": self._cb_deep,
            "jc": self._cb_job,
            "lp": self._cb_lapse_reason,
            "lc": self._cb_lapse_choice,
        }

    # --- plumbing ---------------------------------------------------------

    @property
    def owner_id(self) -> int | None:
        return self.state.config.telegram_user_id

    def is_owner(self, update: Any) -> bool:
        user = getattr(update, "effective_user", None)
        return user is not None and self.owner_id is not None and user.id == self.owner_id

    def _open(self):
        return db.get_conn(self.state.db_path)

    # --- commands ---------------------------------------------------------

    @_owner_only
    async def cmd_start(self, update: Any, context: Any) -> None:
        await update.message.reply_text(
            "Hi, this is Epoch. The browser is home base; this chat is for quick logs and check-ins.\n\n" + HELP_TEXT
        )

    @_owner_only
    async def cmd_help(self, update: Any, context: Any) -> None:
        await update.message.reply_text(HELP_TEXT)

    @_owner_only
    async def cmd_log(self, update: Any, context: Any) -> None:
        text = " ".join(context.args or []).strip()
        if not text:
            await update.message.reply_text(f"Send what you did and for how long, like:\n{LOG_EXAMPLE}")
            return
        await update.message.reply_text(await self.log_text(text))

    @_owner_only
    async def on_text(self, update: Any, context: Any) -> None:
        text = (update.message.text or "").strip()
        if text:
            await update.message.reply_text(await self.log_text(text))

    @_owner_only
    async def cmd_shipped(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.shipped(list(context.args or [])))

    @_owner_only
    async def cmd_focus(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.focus(list(context.args or [])))

    @_owner_only
    async def cmd_skip(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.skip(" ".join(context.args or []).strip()))

    @_owner_only
    async def cmd_today(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.today_text())

    @_owner_only
    async def cmd_week(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.week_text())

    @_owner_only
    async def cmd_referee(self, update: Any, context: Any) -> None:
        await update.message.reply_text(self.referee(list(context.args or [])))

    # --- logic behind the commands (plain functions, easy to test) -------

    async def log_text(self, text: str) -> str:
        """Parse a typed log, save it, and return the reply text."""
        now = timeutil.now_utc()
        parsed = await asyncio.to_thread(self._parse_sync, text, now)
        if parsed is None:
            return UNREAD_TEXT
        start = parsed.start_utc or now - timedelta(minutes=parsed.minutes)
        end = start + timedelta(minutes=parsed.minutes)
        with self._open() as conn:
            today = rules.today_local(conn)
            before = rules.day_summary(conn, today)
            game_snap = game_before(conn)
            try:
                rules.add_entry(conn, start, end, parsed.category, parsed.deep, "telegram", note=parsed.note or None)
            except ValueError:
                return UNREAD_TEXT
            after = rules.day_summary(conn, today)
            extra = game_lines(conn, game_snap, entry={"category": parsed.category, "minutes": parsed.minutes, "deep": bool(parsed.deep)})
        lines = [
            " · ".join(
                ["Logged", parsed.category, f"{parsed.minutes} min"]
                + (["deep" if parsed.deep else "shallow"] if parser.default_deep(parsed.category) else [])
            )
        ]
        if parsed.note:
            lines.append(f"“{parsed.note}”")
        if parser.default_deep(parsed.category):
            lines.append(today_line(after))
            if after.floor_met and not before.floor_met and after.is_comeback:
                lines.append("Comeback day. That's the one that counts most.")
        lines.extend(extra)
        return "\n".join(lines)

    def _parse_sync(self, text: str, now: datetime):
        """Runs in a worker thread, because the free-LLM fallback can take a few seconds."""
        with self._open() as conn:
            settings = db.all_settings(conn)
            return parser.parse_log_smart(conn, getattr(self.state, "llm", None), text, settings, now)

    def shipped(self, args: list[str]) -> str:
        url, what = split_shipped_args(args)
        if not what:
            return (
                "Add one line on what it shows, after the link. For example:\n"
                "/shipped https://github.com/me/notebooks 12 broadcasting exercises"
            )
        with self._open() as conn:
            today = rules.today_local(conn)
            stage = self._stage_for(conn, what)
            game_snap = game_before(conn)
            rules.add_output(conn, today, stage, what, url)
            extra = game_lines(conn, game_snap, output={"stage": stage})
            week = rules.week_summary(conn, today)
        lines = [f"Shipped · {stage} · “{what}”"]
        if week.outputs_required is None:
            lines.append(f"This week: {week.outputs_count} output{'s' if week.outputs_count != 1 else ''} so far (baseline week).")
        else:
            done = " ✓" if week.outputs_count >= week.outputs_required else ""
            lines.append(f"This week: outputs {week.outputs_count} of {week.outputs_required}{done}")
        lines.extend(t for t in extra if not t.startswith("Output"))
        return "\n".join(lines)

    @staticmethod
    def _stage_for(conn: sqlite3.Connection, what: str) -> str:
        """The ladder stage named in the text, else the current phase from settings."""
        named = parser.detect_category(what)
        if named and categories.is_ladder(named):
            return named
        phase = db.get_setting(conn, "phase")
        return phase if categories.is_ladder(phase or "") else "Python"

    def focus(self, args: list[str]) -> str:
        if args and args[0].lower() in ("stop", "end"):
            return self._focus_stop(cancel=False)
        if args and args[0].lower() == "cancel":
            return self._focus_stop(cancel=True)

        minutes = DEFAULT_FOCUS_MINUTES
        words = list(args)
        if words and words[0].isdigit():
            minutes = int(words.pop(0))
        if not 1 <= minutes <= MAX_FOCUS_MINUTES:
            return f"Pick a focus length between 1 and {MAX_FOCUS_MINUTES} minutes, like: /focus 50 numpy broadcasting"
        label = " ".join(words).strip()

        now = timeutil.now_utc()
        with self._open() as conn:
            running = self._running_focus(conn, now)
            tz = db.get_setting(conn, "timezone")
            if running is not None:
                until = timeutil.from_iso(running["start_utc"]) + timedelta(minutes=running["planned_minutes"])
                return (
                    f"A focus session is already running ({running['label'] or running['category']}), "
                    f"until {local_hhmm(until, tz)}. /focus stop ends it and logs the time."
                )
            if conn.execute("SELECT 1 FROM focus_sessions WHERE end_utc IS NULL").fetchone():
                return (
                    "Your last focus session is still open. /focus stop logs it, "
                    "/focus cancel drops it, then start the new one."
                )
            if pomodoro.is_active(conn):
                return "A Pomodoro run is going on your screen. Stop it there (or /focus stop) before starting another."
            category = parser.detect_category(label) if label else None
            category = category or self._stage_for(conn, label)
            conn.execute(
                "INSERT INTO focus_sessions(start_utc, planned_minutes, label, category) VALUES (?, ?, ?, ?)",
                (timeutil.to_iso(now), minutes, label or None, category),
            )
        until = now + timedelta(minutes=minutes)
        named = f"“{label}”, " if label else ""
        return f"Focus: {named}{minutes} min, until {local_hhmm(until, tz)}. Quiet till then. (/focus stop to end early)"

    @staticmethod
    def _running_focus(conn: sqlite3.Connection, now: datetime) -> sqlite3.Row | None:
        """An open session that has not passed its planned end yet."""
        row = conn.execute(
            "SELECT * FROM focus_sessions WHERE end_utc IS NULL AND outcome IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        planned_end = timeutil.from_iso(row["start_utc"]) + timedelta(minutes=row["planned_minutes"])
        return row if now < planned_end else None

    def _focus_stop(self, cancel: bool) -> str:
        now = timeutil.now_utc()
        with self._open() as conn:
            row = conn.execute(
                "SELECT * FROM focus_sessions WHERE end_utc IS NULL AND outcome IS NULL ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is None and pomodoro.is_active(conn):  # a Pomodoro run is what is going
                message, _kind, _entry, _events = pomodoro.stop_and_rate(conn, "cancelled" if cancel else "full", now)
                return message
            if row is None:
                return "No focus session is running. Start one with /focus 50 numpy broadcasting"
            start = timeutil.from_iso(row["start_utc"])
            elapsed = timeutil.minutes_between(start, now)
            if cancel or elapsed < 1:
                conn.execute(
                    "UPDATE focus_sessions SET end_utc = ?, outcome = 'cancelled' WHERE id = ?",
                    (timeutil.to_iso(now), row["id"]),
                )
                return "Focus session cancelled. Nothing was logged."
            deep = parser.default_deep(row["category"])
            end = start + timedelta(minutes=min(elapsed, row["planned_minutes"]))
            game_snap = game_before(conn)
            entry_id = rules.add_entry(conn, start, end, row["category"], deep, "focus", note=row["label"])
            outcome = "full" if elapsed >= row["planned_minutes"] else "mostly"
            conn.execute(
                "UPDATE focus_sessions SET end_utc = ?, outcome = ?, entry_id = ? WHERE id = ?",
                (timeutil.to_iso(now), outcome, entry_id, row["id"]),
            )
            minutes = timeutil.minutes_between(start, end)
            extra = game_lines(conn, game_snap, entry={"category": row["category"], "minutes": minutes, "deep": bool(deep)})
        label = " · deep" if deep else ""
        return "\n".join([f"Focus ended · {row['category']} · {minutes} min{label}", "Logged.", *extra])

    def skip(self, reason: str) -> str:
        with self._open() as conn:
            today = rules.today_local(conn)
            already = conn.execute("SELECT 1 FROM day_marks WHERE local_date = ?", (today.isoformat(),)).fetchone()
            if already:
                return "Today is already marked as a skip day."
            game_snap = game_before(conn)
            if rules.use_skip(conn, today, "skip", reason or None):
                left = rules.week_summary(conn, today).skips_left
                extra = game_lines(conn, game_snap)
                return "\n".join([f"Skip used for today. {left} left this week. Back at it tomorrow.", *extra])
            allowed = db.get_setting(conn, "skips_per_week")
        return (
            f"All {allowed} skips for this week are used. "
            f"No catch-up needed: even {db.DEFAULT_SETTINGS['floor_minutes']} minutes today still counts."
        )

    def today_text(self) -> str:
        with self._open() as conn:
            today = rules.today_local(conn)
            day = rules.day_summary(conn, today)
            week = rules.week_summary(conn, today)
            run = rules.current_run(conn, today)
            day_text = timeutil.day_number_label(timeutil.day_number(db.start_date(conn), today))
        lines = [f"Today · {day_text} · {pretty_date(today)}", today_line(day).replace("Today: ", "")]
        if day.target_minutes:
            to_go = max(0, day.target_minutes - day.deep_minutes)
            lines.append(f"Target {fmt_hm(day.target_minutes)}" + (" ✓" if day.target_met else f" · {fmt_hm(to_go)} to go"))
        if day.outputs_count:
            lines.append(f"Outputs today: {day.outputs_count}")
        lines.append(self._contract_line(week))
        if run:
            lines.append(f"Run: {run} day{'s' if run != 1 else ''}")
        return "\n".join(lines)

    def week_text(self) -> str:
        with self._open() as conn:
            today = rules.today_local(conn)
            week = rules.week_summary(conn, today)
            start = db.start_date(conn)
            days_text = timeutil.day_number_range_label(
                timeutil.day_number(start, week.monday), timeutil.day_number(start, week.monday + timedelta(days=6)))
            money = self._money_line(conn, today)
        headline = {
            "baseline": "baseline week (log only)",
            "kept": "kept ✓",
            "in_progress": "in progress",
            "not_kept": f"{week.outputs_count} of {week.outputs_required} outputs. Not this week.",
        }[week.status]
        lines = [f"Week of {pretty_date(week.monday)} · {days_text} · {headline}", self._contract_line(week)]
        for output in week.outputs:
            link = f" ({output['url']})" if output["url"] else ""
            lines.append(f"• {output['what']}{link}")
        deep = f"Deep {fmt_hm(week.deep_minutes)}"
        if week.deep_by_category:
            parts = ", ".join(f"{cat} {fmt_hm(mins)}" for cat, mins in sorted(week.deep_by_category.items(), key=lambda kv: -kv[1]))
            deep += f" ({parts})"
        lines.append(deep)
        if week.planned_minutes:
            lines.append(f"Planned {fmt_hm(week.planned_minutes)} → did {fmt_hm(week.planned_done_minutes)}")
        if week.top_lapse_reasons:
            reason, count = week.top_lapse_reasons[0]
            lines.append(f"Top snag: {LAPSE_REASONS.get(reason, reason)} ×{count}")
        if money:
            lines.append(money)
        return "\n".join(lines)

    @staticmethod
    def _money_line(conn: Any, today: Any) -> str | None:
        """One calm money/rent line (epoch/economy.py); never blocks the summary, and quiet mode hides it."""
        try:
            return economy.week_line(conn, today)
        except Exception:
            log.exception("money line failed")
            return None

    @staticmethod
    def _contract_line(week: rules.WeekSummary) -> str:
        if week.outputs_required is None:
            return f"Baseline week: just logging, no targets yet · floor days {week.floor_days}"
        return (
            f"Week: outputs {week.outputs_count}/{week.outputs_required} · "
            f"floor days {week.floor_days}/{week.floor_days_required} · skips left {week.skips_left}"
        )

    def referee(self, args: list[str]) -> str:
        with self._open() as conn:
            if not args:
                current = db.get_setting(conn, "referee_chat_id")
                if current is None:
                    return "No referee set. Use /referee <chat id> [name]."
                name = db.get_setting(conn, "referee_name")
                return f"Referee chat: {current}" + (f" ({name})" if name else "")
            if args[0].lower() in ("off", "clear", "none"):
                db.set_setting(conn, "referee_chat_id", None)
                db.set_setting(conn, "referee_name", None)
                return "Referee cleared."
            try:
                chat_id = int(args[0])
            except ValueError:
                return "The chat id is a number, like /referee 123456789 Sam"
            name = " ".join(args[1:]).strip() or None
            db.set_setting(conn, "referee_chat_id", chat_id)
            db.set_setting(conn, "referee_name", name)
        return f"Referee set to chat {chat_id}" + (f" ({name})" if name else "") + ". Sunday reports will go there when you send them."

    # --- callbacks --------------------------------------------------------

    async def on_callback(self, update: Any, context: Any) -> None:
        """Answer the tap first, apply the change, then turn the message into a receipt."""
        if not self.is_owner(update):
            return
        query = update.callback_query
        try:
            await query.answer()
        except Exception:
            log.exception("could not answer the callback query")
        try:
            reply = self.handle_callback_data(query.data or "")
        except Exception:
            log.exception("callback %r failed", query.data)
            reply = Reply("Something went wrong on my side, and nothing was changed.")
        try:
            await query.edit_message_text(text=reply.text, reply_markup=to_markup(reply.buttons))
        except Exception:  # e.g. "message is not modified"; the change itself is already saved
            log.warning("could not edit the card", exc_info=True)

    def handle_callback_data(self, data: str) -> Reply:
        scheme, _, rest = data.partition(":")
        handler = self._callbacks.get(scheme)
        if handler is None:
            return Reply("That button is out of date.")
        with self._open() as conn:
            return handler(conn, rest)

    def _cb_category(self, conn: sqlite3.Connection, arg: str) -> Reply:
        """ci:<slot_id>:<code>. Log a category for a block-end card."""
        slot_text, _, code = arg.partition(":")
        category = categories.FROM_CODE.get(code)
        if not slot_text.isdigit() or category is None:
            return Reply("I couldn't read that tap.")
        slot = conn.execute("SELECT * FROM slots WHERE id = ?", (int(slot_text),)).fetchone()
        if slot is None:
            return Reply("That card is no longer available.")
        if slot["status"] == "answered":
            return Reply(self._answered_receipt(conn, slot))

        start, end, block = self._slot_interval(conn, slot)
        deep = parser.default_deep(category)
        link = block["id"] if block is not None and block["category"] == category else None
        game_snap = game_before(conn)
        entry_id = rules.add_entry(conn, start, end, category, deep, "telegram", plan_block_id=link)
        entry = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
        conn.execute(
            "UPDATE slots SET status = 'answered', answered_utc = ? WHERE id = ?", (entry["created_at"], slot["id"])
        )
        if block is not None:
            conn.execute("UPDATE plan_blocks SET status = ? WHERE id = ?", ("done" if link else "skipped", block["id"]))
        buttons: Buttons = []
        if deep:
            buttons = [[("Deep", f"dp:{entry_id}:d"), ("Shallow", f"dp:{entry_id}:s")]]
        minutes = timeutil.minutes_between(start, end)
        extra = game_lines(conn, game_snap, entry={"category": category, "minutes": minutes, "deep": bool(deep)})
        return Reply("\n".join([entry_receipt(entry), *extra]), buttons)

    @staticmethod
    def _slot_interval(conn: sqlite3.Connection, slot: sqlite3.Row) -> tuple[datetime, datetime, sqlite3.Row | None]:
        """The time a block-end card is about: the plan block's window, else the 30 min before it was due."""
        now = timeutil.now_utc()
        block = None
        if slot["kind"] == "block_end" and slot["ref_id"]:
            block = conn.execute("SELECT * FROM plan_blocks WHERE id = ?", (slot["ref_id"],)).fetchone()
        due = timeutil.from_iso(slot["due_utc"])
        if block is not None and block["cue_time"]:
            tz, dsh = db.get_setting(conn, "timezone"), db.get_setting(conn, "day_start_hour")
            start = timeutil.at_local(date.fromisoformat(block["local_date"]), block["cue_time"], tz, dsh)
            end = start + timedelta(minutes=block["minutes"])
        else:
            length = block["minutes"] if block is not None else 30
            end = due
            start = end - timedelta(minutes=length)
        if end > now:  # never log time that has not happened yet
            length = end - start
            end = now
            start = end - length
        return start, end, block

    @staticmethod
    def _answered_receipt(conn: sqlite3.Connection, slot: sqlite3.Row) -> str:
        """The receipt for a slot that was already answered (a second tap changes nothing)."""
        entry = None
        if slot["answered_utc"]:
            entry = conn.execute(
                "SELECT * FROM entries WHERE source = 'telegram' AND created_at = ? ORDER BY id DESC LIMIT 1",
                (slot["answered_utc"],),
            ).fetchone()
        return entry_receipt(entry) if entry is not None else "Already answered."

    def _cb_deep(self, conn: sqlite3.Connection, arg: str) -> Reply:
        """dp:<entry_id>:<d|s>. Mark an entry deep or shallow."""
        entry_text, _, flag = arg.partition(":")
        if not entry_text.isdigit() or flag not in ("d", "s"):
            return Reply("I couldn't read that tap.")
        entry = conn.execute("SELECT * FROM entries WHERE id = ?", (int(entry_text),)).fetchone()
        if entry is None or entry["deleted"]:
            return Reply("That entry is no longer there.")
        game_snap = game_before(conn)
        conn.execute("UPDATE entries SET deep = ? WHERE id = ?", (1 if flag == "d" else 0, entry["id"]))
        entry = conn.execute("SELECT * FROM entries WHERE id = ?", (entry["id"],)).fetchone()
        extra = game_lines(conn, game_snap)
        return Reply("\n".join([entry_receipt(entry), *extra]))

    def _cb_job(self, conn: sqlite3.Connection, arg: str) -> Reply:
        """jc:<date>:<u|e|l|v>. Close the day-job block."""
        date_text, _, code = arg.partition(":")
        choice = JOB_CODES.get(code)
        d = self._parse_date(date_text)
        if d is None or choice is None:
            return Reply("I couldn't read that tap.")
        game_snap = game_before(conn)
        rules.close_job_block(conn, d, choice)
        extra = game_lines(conn, game_snap)
        start, end = db.get_setting(conn, "job_start"), db.get_setting(conn, "job_end")
        label = {
            "usual": f"Day job · {start}–{end}, as usual",
            "left_early": f"Day job · {start}–{_shift_hhmm(end, -2)}, left early",
            "stayed_late": f"Day job · {start}–{_shift_hhmm(end, 2)}, stayed late",
            "leave": "Day job · left out of the log for this day",
        }[choice]
        link = f"http://127.0.0.1:{self.state.config.port}/close"
        return Reply("\n".join([f"{label}\nThe rest of the evening close is at {link}", *extra]))

    def _cb_lapse_reason(self, conn: sqlite3.Connection, arg: str) -> Reply:
        """lp:<date>:<reason>. Save why the day was missed, then offer the three options."""
        date_text, _, reason = arg.partition(":")
        d = self._parse_date(date_text)
        if d is None or reason not in LAPSE_REASONS:
            return Reply("I couldn't read that tap.")
        row = self._lapse_row(conn, d)
        if row is not None and row["choice"]:
            return Reply(self._lapse_receipt(row))
        conn.execute(
            "INSERT INTO lapses(local_date, reason, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(local_date) DO UPDATE SET reason = excluded.reason",
            (d.isoformat(), reason, db.utc_now_iso()),
        )
        left = rules.week_summary(conn, d).skips_left  # skips are spent from the missed day's week
        day = d.isoformat()
        return Reply(
            f"Got it: {LAPSE_REASONS[reason]}. {pretty_date(d)} didn't reach the floor. What would you like to do with it?",
            [
                [(f"Mark it as rest ({left} left)", f"lc:{day}:skip")],
                [("Repair it: reach the floor today and tomorrow", f"lc:{day}:repair")],
                [("Let it go", f"lc:{day}:letgo")],
            ],
        )

    def _cb_lapse_choice(self, conn: sqlite3.Connection, arg: str) -> Reply:
        """lc:<date>:<skip|repair|letgo>. Apply the choice and suggest an optional minimum plan for tonight."""
        date_text, _, choice = arg.partition(":")
        d = self._parse_date(date_text)
        if d is None or choice not in ("skip", "repair", "letgo"):
            return Reply("I couldn't read that tap.")
        row = self._lapse_row(conn, d)
        if row is not None and row["choice"]:
            return Reply(self._lapse_receipt(row))

        reason = row["reason"] if row is not None else None
        today = rules.today_local(conn)
        if_then = self._minimum_plan(conn, today)
        game_snap = game_before(conn)
        rules.record_lapse(conn, d, reason, choice, if_then)
        extra = game_lines(conn, game_snap)
        saved = self._lapse_row(conn, d)
        conn.execute(
            "UPDATE slots SET status = 'answered', answered_utc = ? "
            "WHERE kind = 'lapse' AND status IN ('pending', 'sent') AND local_date >= ?",
            (db.utc_now_iso(), d.isoformat()),
        )
        text = self._lapse_receipt(saved)
        if choice == "skip" and saved["choice"] != "skip":
            text = "No rest days were left this week, so I've let that day go.\nTonight's minimum plan (optional): " + if_then
        return Reply("\n".join([text, *extra]))

    @staticmethod
    def _lapse_row(conn: sqlite3.Connection, d: date) -> sqlite3.Row | None:
        return conn.execute("SELECT * FROM lapses WHERE local_date = ?", (d.isoformat(),)).fetchone()

    @staticmethod
    def _lapse_receipt(row: sqlite3.Row) -> str:
        day = pretty_date(date.fromisoformat(row["local_date"]))
        head = {
            "skip": f"{day} is marked as rest.",
            "repair": f"Repair window open for {day}: reach the floor today and tomorrow and it shows as repaired.",
            "let_go": f"Let it go. {day} stays as it is, and that's fine.",
        }.get(row["choice"], f"Noted for {day}.")
        return f"{head}\nTonight's minimum plan (optional): {row['if_then']}" if row["if_then"] else head

    @staticmethod
    def _minimum_plan(conn: sqlite3.Connection, today: date) -> str:
        """The least worth doing tonight, in plain words: '25 min of Python at 19:30'."""
        key = "study_start_weekday" if rules.is_job_day(conn, today) else "study_start_weekend"
        cue = db.get_setting(conn, key)
        phase = db.get_setting(conn, "phase") or "Python"
        return f"{MINIMUM_PLAN_MINUTES} min of {phase} at {cue}"

    @staticmethod
    def _parse_date(text: str) -> date | None:
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_application(state: Any) -> Application | None:
    """The Telegram application for this state, or None when Telegram isn't configured."""
    config = state.config
    if not config.telegram_enabled:
        return None
    bot = EpochBot(state)
    app = Application.builder().token(config.telegram_bot_token).job_queue(None).build()
    only_owner = filters.User(user_id=config.telegram_user_id)

    commands = {
        "start": bot.cmd_start, "help": bot.cmd_help, "log": bot.cmd_log, "shipped": bot.cmd_shipped,
        "focus": bot.cmd_focus, "skip": bot.cmd_skip, "today": bot.cmd_today, "week": bot.cmd_week,
        "referee": bot.cmd_referee,
    }
    for name, callback in commands.items():
        app.add_handler(CommandHandler(name, callback, filters=only_owner))
    app.add_handler(MessageHandler(only_owner & filters.TEXT & ~filters.COMMAND, bot.on_text))
    app.add_handler(CallbackQueryHandler(bot.on_callback, pattern=r"^(ci|dp|jc|lp|lc):"))
    app.add_error_handler(_log_error)
    app.bot_data["witness_bot"] = bot
    return app


async def _log_error(update: object, context: Any) -> None:
    log.error("telegram error: %s", context.error)


async def send_text(state: Any, chat_id: int, text: str) -> int | None:
    """Send plain text to a chat. Returns the message id, or None on any error (never raises)."""
    app = getattr(state, "telegram_app", None)
    if app is None:
        return None
    try:
        message = await app.bot.send_message(chat_id=chat_id, text=clip_message(text))
        return message.message_id
    except Exception:
        log.warning("send_text failed", exc_info=True)
        return None


async def send_card(state: Any, slot_row: Any, text: str, buttons: Buttons) -> int | None:
    """Send a check-in card with inline buttons to the owner. Returns the message id, or None on error."""
    app = getattr(state, "telegram_app", None)
    owner = state.config.telegram_user_id
    if app is None or owner is None:
        return None
    try:
        message = await app.bot.send_message(chat_id=owner, text=clip_message(text), reply_markup=to_markup(buttons))
        return message.message_id
    except Exception:
        log.warning("send_card failed (slot %s)", _slot_id(slot_row), exc_info=True)
        return None


async def send_photo(state: Any, photo: bytes, caption: str = "", chat_id: int | None = None) -> int | None:
    """Send a PNG (raw bytes) to the owner. Returns the message id, or None on any problem (never raises)."""
    app = getattr(state, "telegram_app", None)
    target = chat_id if chat_id is not None else getattr(state.config, "telegram_user_id", None)
    if app is None or target is None or not photo:
        return None
    try:
        message = await app.bot.send_photo(chat_id=target, photo=photo, caption=clip_message(caption)[:1000] or None)
        return message.message_id
    except Exception:
        log.warning("send_photo failed", exc_info=True)
        return None


def _slot_id(slot_row: Any) -> Any:
    """The slot's id for log messages, whatever shape the row has."""
    try:
        return slot_row["id"]
    except (TypeError, KeyError, IndexError):
        return "?"


async def start_bot(app: Application) -> bool:
    """Start long polling inside the running event loop. Returns False if Telegram can't be reached."""
    try:
        await app.initialize()
        await app.start()
        await app.updater.start_polling(allowed_updates=["message", "callback_query"])
    except Exception:
        log.warning("could not start the Telegram bot", exc_info=True)
        return False
    try:
        from telegram import BotCommand

        await app.bot.set_my_commands(
            [BotCommand("today", "Today at a glance"), BotCommand("week", "This week"),
             BotCommand("focus", "Start a focus session"), BotCommand("shipped", "Record an output"),
             BotCommand("skip", "Use a skip today"), BotCommand("help", "What I can do")]
        )
    except Exception:
        log.info("could not set the command menu", exc_info=True)
    return True


async def stop_bot(app: Application) -> None:
    """Stop polling and shut the application down. Safe to call even if start_bot failed."""
    for step in (app.updater.stop, app.stop, app.shutdown):
        try:
            await step()
        except Exception:
            log.debug("shutdown step failed", exc_info=True)
