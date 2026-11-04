"""The Epoch web app: FastAPI + Jinja2 + a little JavaScript, served on 127.0.0.1 only
(or also on the home network for paired devices when LAN mode is on, see `epoch/lan.py`).

Every page is rendered on the server and every form works as a plain POST that redirects back (303).
With `static/app/app.js` loaded, the same forms call the JSON endpoints (`/api/...`) instead, so a log
lands in well under a second and the page plays its celebrations without reloading.

Four tabs: Today, Close, World (City / Week / Shelf) and Settings. The old URLs (/plan, /week, /grid,
/outputs, /lapse, /focus) keep working: some render inside the new layout, some redirect to the right tab.

All the rules (floor, target, run, lapses, contracts) come from `epoch.rules`. The game layer
(`epoch.game`) is a read model on top of them. Every write path follows one pattern:

    before = game.snapshot(conn)  ->  write  ->  events = game.finish_write(conn, before, ...)

so a celebration is the difference between two snapshots. JSON routes return the events; HTMX routes send
them as `HX-Trigger: {"witness:events": [...]}`; plain redirects fold the first lines into the flash message.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import sqlite3
import struct
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, FastAPI, Form, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markupsafe import Markup

from .. import (
    activitywatch, categories, cozy, db, economy, game, lan, live, llm as llm_module, parser, pomodoro, qr, rules, timeutil, weather,
)
from ..config import load_config
from . import money_ui

log = logging.getLogger("epoch.web")

WEB_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(WEB_DIR / "templates"))
router = APIRouter()


class RevalidatedStaticFiles(StaticFiles):
    """Static files the browser must re-check (ETag / Last-Modified) on every use.

    Without a Cache-Control header, browsers cache JS modules heuristically and can keep running an old copy of
    one module next to a new copy of another after an update, which leaves the 3D city blank. "no-cache" still
    lets them keep the bytes; unchanged files come back as a tiny 304 from this local server."""

    def file_response(self, *args: Any, **kwargs: Any) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def asset_version(root: Path) -> str:
    """A short fingerprint of every file under `root` (path, size, mtime): it changes whenever a file does.

    Pages load their code from /static/v/<fingerprint>/..., and every JS module is imported relative to the script
    that loaded it, so after an update the whole module graph gets new URLs and no browser cache (laptop or tablet)
    can mix an old module with a new one."""
    digest = hashlib.sha1()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            path = Path(dirpath) / name
            try:
                st = path.stat()
            except OSError:
                continue
            digest.update(f"{path.relative_to(root).as_posix()}\0{st.st_size}\0{st.st_mtime_ns}\n".encode())
    return digest.hexdigest()[:10]


templates.env.globals["asset_base"] = "/static"  # create_app() swaps in the versioned prefix


# Hosts the app always answers to. It normally listens on 127.0.0.1 only, but a web page elsewhere could
# still try to reach it through a look-alike host name (DNS rebinding), so we check (lan.LanGuard).
# With LAN mode on, private IP literals and this Mac's .local name are accepted as well.
ALLOWED_HOSTS = set(lan.STATIC_HOSTS)

# Category buttons on the quick log: the ladder first, then the common non-ladder ones.
QUICK_OTHERS = ("Tracker build", "Rest", "Distracted", "Commute", "Food", "Exercise", "Social", "Admin", "Other")
QUICK_CATEGORIES = tuple(categories.LADDER) + QUICK_OTHERS
# Buttons when labelling a gap in the evening close.
GAP_CATEGORIES = tuple(categories.LADDER) + ("Commute", "Food", "Rest", "Distracted", "Social", "Admin", "Other")
# Only these categories can be "deep" in a way the rules count.
DEEP_CATEGORIES = frozenset(categories.LADDER) | {"Tracker build"}

LAPSE_REASONS = (
    ("work_late", "Work ran late"),
    ("tired", "Tired"),
    ("phone", "Phone or X"),
    ("unclear_step", "Unclear next step"),
    ("too_big", "Task too big"),
    ("other", "Other"),
)
FOCUS_OUTCOMES = (("full", "Full, deep"), ("mostly", "Mostly"), ("pulled_away", "Got pulled away"))
JOB_CHOICE_LABELS = (
    ("usual", "As usual"), ("left_early", "Left early"), ("stayed_late", "Stayed late"), ("leave", "Leave day"),
)
OUTPUT_STAGES = tuple(categories.LADDER)
CYCLE_WEEKS = 6
TYPED_LOG_EXAMPLE = "45m numpy ex 1-12"
UNREAD_HINT = f"I couldn't read that. Try \"{TYPED_LOG_EXAMPLE}\" (time first or last, then what it was)."
DURATION_CHIPS = ((15, "15m"), (30, "30m"), (45, "45m"), (60, "1h"), (90, "1h 30m"))
# (value, label, icon, css chip class, deep, rest). The log card's "what was it" chips.
LOG_CHIPS = (
    ("Python", "Python", "terminal", "c-python", True, False),
    ("Math", "Math", "sigma", "c-math", True, False),
    ("ML/DL", "ML/DL", "brain", "c-ml", True, False),
    ("Papers", "Papers", "book-open", "c-papers", True, False),
    ("Writing/X", "Writing/X", "pen-line", "c-writing", True, False),
    ("Rest", "Rest hour", "tent-tree", "c-rest", False, True),
    ("Distracted", "Drift", "smartphone", "c-drift", False, False),
)

# Game settings that live in the settings table (defaults come from game.GAME_DEFAULTS).
GAME_BOOL_KEYS = ("game_enabled", "quiet_mode", "sound", "hide_achievements")
# v2 toggles: a plain (no-JS) form that does not mention them must not switch them off, so they are
# not part of the "unticked box means off" rule in POST /settings/game.
GAME_BOOL_KEYS_V2 = ("weather_enabled", "seasonal_enabled", "daily_missions")
SOUNDSCAPES = ("off", "rain", "cafe", "brown", "subway")
GAME_CHOICES = {
    "motion": ("auto", "on", "off"), "three_d": ("auto", "off"), "sky_tz": ("local", "ny"), "soundscape": SOUNDSCAPES,
}
GAME_KEYS = GAME_BOOL_KEYS + GAME_BOOL_KEYS_V2 + tuple(GAME_CHOICES) + ("confetti_daily_cap", "soundscape_volume")


# --------------------------------------------------------------------------
# Template helpers
# --------------------------------------------------------------------------

def hm(minutes: float | int | None) -> str:
    """90 -> '1h 30m', 120 -> '2h', 45 -> '45m'."""
    total = int(round(minutes or 0))
    hours, rest = divmod(total, 60)
    if hours and rest:
        return f"{hours}h {rest:02d}m"
    return f"{hours}h" if hours else f"{rest}m"


def compact_min(minutes: float | int | None) -> str:
    """90 -> '1h30m' (for the small day buttons)."""
    return game.fmt_min(minutes or 0).replace(" ", "")


def day_label(value: date) -> str:
    return value.strftime("%a %d %b")


def pct(part: float, whole: float) -> int:
    """Percentage for a progress bar, clamped to 0-100."""
    if whole <= 0:
        return 100 if part > 0 else 0
    return max(0, min(100, int(round(100 * part / whole))))


def group_digits(value: int | float) -> str:
    return f"{int(value):,}"


def _safe_link(url: str | None) -> str | None:
    """Only http(s) links are ever rendered as links."""
    if url and url.lower().startswith(("http://", "https://")):
        return url
    return None


# Colour variable and icon for a line in the wins feed (mirrors app.js so the server page and the live page agree).
WIN_STYLE = {
    "floor": ("check", "--mint"), "target": ("target", "--reward-ink"), "crown": ("target", "--reward-ink"),
    "output": ("trophy", "--reward-ink"), "comeback": ("building-2", "--reward-ink"),
    "week": ("calendar-check", "--mint"), "week_kept": ("calendar-check", "--mint"),
    "node": ("landmark", "--accent"), "level": ("star", "--accent"), "district": ("building-2", "--accent"),
    "achievement": ("sparkles", "--accent"), "seal": ("moon", "--accent"), "close": ("moon", "--accent"),
    "rest": ("tent-tree", "--rest"), "honest": ("shield-check", "--rest"), "record": ("sparkles", "--accent"),
}
CATEGORY_VAR = {
    "Python": "--c-python", "Math": "--c-math", "ML/DL": "--c-ml", "Papers": "--c-papers",
    "Writing/X": "--c-writing", "Rest": "--rest", "Distracted": "--c-drift", "Unknown": "--faint",
}
STATUS_ICON = {
    "target": "target", "floor": "check", "repaired": "check", "rest": "tent-tree", "skip": "tent-tree",
    "missed": "layers", "started": "sparkles", "open": "pen-line", "future": "calendar-check",
    "before_start": "calendar-check",
}
ACH_ICON = {
    "first_light": "sparkles", "honest_hour": "shield-check", "first_floor": "check", "first_ship": "trophy",
    "first_close": "moon", "first_focus": "timer", "honest_week": "shield-check", "fog_lifter": "cloud-fog",
    "crown_x3": "target", "week_kept": "calendar-check", "five_ships": "layers", "linked_ship": "send",
    "all_five": "landmark", "clear_skies": "sun", "gold_week": "sun", "seven_clear": "sun", "early_floor": "zap", "first_comeback": "building-2",
    "comeback_3": "building-2", "four_kept": "calendar-check", "node_first": "landmark", "landmark": "landmark",
    "ten_close": "moon", "fifty_hours": "timer", "hundred_hours": "timer", "thirty_ships": "trophy",
}
LADDER_CLASS = {"Python": "lc-python", "Math": "lc-math", "ML/DL": "lc-ml", "Papers": "lc-papers", "Writing/X": "lc-writing"}
LADDER_CHIP = {"Python": "c-python", "Math": "c-math", "ML/DL": "c-ml", "Papers": "c-papers", "Writing/X": "c-writing"}
DISTRICT_ICON = {name: icon for _first, _last, name, icon in game.DISTRICTS}


def when_text(at: str | None) -> str:
    """'3m ago', '2h ago', 'yesterday' for an ISO timestamp (the same words app.js uses)."""
    if not at:
        return ""
    try:
        moment = timeutil.from_iso(at)
    except (ValueError, TypeError):
        return ""
    minutes = int((timeutil.now_utc() - moment).total_seconds() // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes}m ago"
    hours = round(minutes / 60)
    if hours < 20:
        return f"{hours}h ago"
    days = round(minutes / 1440)
    return "yesterday" if days <= 1 else f"{days} days ago"


def win_view(win: dict[str, Any]) -> dict[str, Any]:
    """A wins-feed line ready for the template: icon, colour variable, text and the small second line."""
    kind = str(win.get("kind", "")).lower()
    icon, color = WIN_STYLE.get(kind, (None, None))
    if icon is None:
        icon = win.get("icon") or "terminal"
        color = CATEGORY_VAR.get(win.get("category", ""), "--muted")
    extra = " · ".join(part for part in (win.get("detail"), when_text(win.get("at"))) if part)
    return {"icon": icon, "color": color, "text": win.get("text", ""), "extra": extra}


def _slot(day: dict[str, Any]) -> dict[str, Any]:
    """One tower for the flat skyline, from a world_state day or a today_state week day."""
    status = day.get("status", "open")
    future = status in ("future", "before_start")
    return {
        "future": future, "status": status, "is_today": bool(day.get("is_today")),
        "floors": 0 if future else int(day.get("floors") or 0),
        "doors": (not future) and bool(day.get("doors")), "crown": (not future) and bool(day.get("crown")),
        "lamps": day.get("lamps") or [], "fog": int(day.get("fog_minutes") or 0),
        "outputs": day.get("outputs") or [], "deep": int(day.get("deep_minutes") or 0),
    }


def _visual_status(slot: dict[str, Any]) -> str:
    if slot["future"]:
        return "future"
    if slot["status"] in ("rest", "skip"):
        return "floor" if slot["doors"] else "rest"
    if slot["crown"]:
        return "target"
    if slot["doors"]:
        return "floor"
    if slot["status"] == "missed":
        return "missed"
    return "started" if (slot["deep"] > 0 or slot["floors"] > 0) else "open"


def skyline_svg(days: list[dict[str, Any]], rows: int = 1) -> Markup:
    """The flat skyline (the no-JS and no-WebGL fallback). Same class names as app.js uses to redraw it."""
    slots = [_slot(d) for d in days]
    parts: list[str] = []
    if rows == 1:
        parts.append('<rect class="gr" x="0" y="196" width="420" height="24"/>')
        for k, slot in enumerate(slots[:7]):
            x = 22 + k * 57
            floors = 0 if slot["future"] else slot["floors"]
            height = max(6, floors * 10)
            y = 196 - height
            vs = _visual_status(slot)
            cls = "b" + (" t" if vs == "target" else " f" if vs == "floor" else "") + (" today" if slot["is_today"] else "")
            parts.append(f'<rect class="{cls}" x="{x}" y="{y}" width="42" height="{height}" rx="4"/>')
            for f in range(floors):
                wy = 196 - f * 10 - 8
                parts.append(f'<rect class="win lit" x="{x + 8}" y="{wy}" width="8" height="5" rx="1.5"/>')
                parts.append(f'<rect class="win lit" x="{x + 26}" y="{wy}" width="8" height="5" rx="1.5"/>')
            if vs == "rest":
                parts.append(f'<circle class="park" cx="{x + 21}" cy="186" r="7"/>')
            if slot["fog"]:
                parts.append(f'<ellipse class="fog" cx="{x + 21}" cy="188" rx="24" ry="8"/>')
            lamp_count = min(4, sum(int(lamp.get("n", 1)) for lamp in slot["lamps"]))
            for i in range(lamp_count):
                parts.append(f'<circle class="lamp" cx="{x + 8 + i * 9}" cy="206" r="3"/>')
            if slot["outputs"]:
                stage = slot["outputs"][0].get("stage", "")
                color = f"var({CATEGORY_VAR[stage]})" if stage in CATEGORY_VAR else categories.COLORS.get(stage, "#8CC4EE")
                parts.append(f'<circle class="beacon" cx="{x + 21}" cy="{y - 8}" r="5" style="fill:{color}"/>')
        box = "0 0 420 220"
    else:
        for r in range(rows):
            y0 = 84 + r * 66
            parts.append(f'<rect class="gr" x="0" y="{y0}" width="420" height="5" opacity="{0.4 + r * 0.2:.2f}"/>')
            for c in range(7):
                index = r * 7 + c
                if index >= len(slots):
                    continue
                slot = slots[index]
                x = 22 + c * 57
                floors = 0 if slot["future"] else slot["floors"]
                height = max(4, floors * 3.8)
                vs = _visual_status(slot)
                cls = "b" + (" t" if vs == "target" else " f" if vs == "floor" else "") + (" today" if slot["is_today"] else "")
                parts.append(
                    f'<rect class="{cls}" x="{x}" y="{y0 - height:.1f}" width="40" height="{height:.1f}" rx="3" '
                    f'opacity="{0.55 + r * 0.15:.2f}"/>'
                )
        box = "0 0 420 300"
    return Markup(f'<svg viewBox="{box}" preserveAspectRatio="xMidYMax meet" focusable="false">{"".join(parts)}</svg>')


def postcard_art(card_id: str) -> Markup:
    """A small, plainly fictional illustration for a postcard (deterministic from its id)."""
    h = int(hashlib.md5(card_id.encode()).hexdigest(), 16)
    # Morningside blue-hour skies: navy into Columbia blue, limestone dusk, lamplight.
    skies = (("#05122A", "#2F639B"), ("#081A33", "#8CC4EE"), ("#0E2B57", "#F3C9A0"), ("#0B1F3A", "#5E8FC4"), ("#05122A", "#E7D9BE"))
    top, glow = skies[h % len(skies)]
    parts = [
        f'<defs><linearGradient id="pc{h % 10**6}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="{top}"/>'
        f'<stop offset="1" stop-color="{glow}"/></linearGradient></defs>',
        f'<rect width="200" height="120" fill="url(#pc{h % 10**6})"/>',
    ]
    x, k = 6, 0
    while x < 190:
        w = 18 + (h >> (k * 3)) % 14
        height = 30 + ((h >> (k * 2 + 1)) % 48)
        parts.append(f'<rect x="{x}" y="{120 - height}" width="{w}" height="{height}" rx="2" fill="#0B1F3A"/>')
        for wy in range(120 - height + 6, 112, 11):
            if (h >> ((x + wy) % 31)) & 1:
                parts.append(f'<rect x="{x + 4}" y="{wy}" width="4" height="5" rx="1" fill="#FFE3AE"/>')
        x += w + 4
        k += 1
    if "crane" in card_id:
        parts.append('<path d="M150 20 V90 M120 24 H176 M176 24 V44" stroke="#8CC4EE" stroke-width="2.5" fill="none"/>')
    elif "water" in card_id:
        parts.append('<rect x="92" y="42" width="22" height="18" rx="3" fill="#3D5677"/><rect x="96" y="60" width="2.5" height="14" fill="#3D5677"/><rect x="108" y="60" width="2.5" height="14" fill="#3D5677"/>')
    elif "cab" in card_id:
        parts.append('<rect x="60" y="100" width="34" height="10" rx="4" fill="#F4C977"/><rect x="104" y="100" width="34" height="10" rx="4" fill="#F4C977"/>')
    else:
        parts.append(f'<circle cx="{150 + h % 30}" cy="26" r="9" fill="#F3EFE6" opacity=".9"/>')
    return Markup(f'<svg viewBox="0 0 200 120" role="img" aria-label="Illustration" focusable="false">{"".join(parts)}</svg>')


templates.env.filters["hm"] = hm
templates.env.filters["day_label"] = day_label


def iso_day_label(value: Any) -> str:
    """'2026-10-12' -> 'Oct 12'; anything that is not an ISO date comes back unchanged."""
    try:
        d = date.fromisoformat(str(value)[:10])
    except ValueError:
        return str(value)
    return f"{d.strftime('%b')} {d.day}"


templates.env.filters["iso_day"] = iso_day_label
templates.env.filters["safe_link"] = _safe_link
templates.env.filters["compact_min"] = compact_min
templates.env.filters["digits"] = group_digits
templates.env.filters["usd"] = money_ui.usd
templates.env.filters["short_date"] = money_ui.short_date
templates.env.filters["long_date"] = money_ui.long_date
templates.env.globals.update(
    usd=money_ui.usd, usd_cents=money_ui.usd_cents, week_range=money_ui.week_range, gate_text=money_ui.gate_text,
    event_text=money_ui.event_text, rate_line=money_ui.rate_line, source_rows=money_ui.source_rows, glyph=money_ui.glyph,
    postcard_svg=money_ui.postcard_svg, fact_for=money_ui.fact_for, networth_svg=money_ui.networth_svg,
    collected_when=money_ui.collected_when,
)
templates.env.globals.update(
    colors=categories.COLORS, hm=hm, pct=pct, day_label=day_label, fmt_min=game.fmt_min, skyline_svg=skyline_svg,
    postcard_art=postcard_art, win_view=win_view, status_icon=STATUS_ICON, ach_icon=ACH_ICON,
    ladder_class=LADDER_CLASS, district_icon=DISTRICT_ICON, duration_chips=DURATION_CHIPS, log_chips=LOG_CHIPS,
    ladder_chip=LADDER_CHIP, cat_icon=game.CATEGORY_ICON,
    visual_status=lambda day: _visual_status(_slot(day)),
)


# --------------------------------------------------------------------------
# State, connections, redirects
# --------------------------------------------------------------------------

def _state(request: Request) -> Any:
    return request.app.state.witness


@contextmanager
def _conn(request: Request) -> Iterator[sqlite3.Connection]:
    """One short-lived connection per request (created in the same thread that uses it)."""
    with db.get_conn(_state(request).db_path) as connection:
        yield connection


def _is_htmx(request: Request) -> bool:
    return request.headers.get("hx-request", "").lower() == "true"


def _redirect(path: str, msg: str | None = None, kind: str = "ok", anchor: str | None = None, **params: Any) -> RedirectResponse:
    """303 back to a page, optionally with a one-line message shown on arrival."""
    query = {key: str(value) for key, value in params.items() if value not in (None, "")}
    if msg:
        query["msg"] = msg
        query["kind"] = kind
    url = path + ("?" + urlencode(query) if query else "") + (f"#{anchor}" if anchor else "")
    return RedirectResponse(url, status_code=303)


def _page_base(request: Request) -> dict[str, Any]:
    """What every page needs: the game settings for <body data-*>, today's date, and whether Close has a dot."""
    base: dict[str, Any] = {
        "gm": {"game_enabled": True, "quiet_mode": False, "sound": False, "motion": "auto", "three_d": "auto",
               "sky_tz": "local", "hide_achievements": False, "confetti_daily_cap": 3, "today": date.today().isoformat()},
        "close_dot": False, "run_days": 0, "day_number_today": 1, "wallet": {"cents": 0, "text": "$0"},
    }
    try:
        with _conn(request) as conn:
            for key in GAME_KEYS:
                base["gm"][key] = game.setting(conn, key)
            base["gm"]["sky_tz"] = "local" if base["gm"]["sky_tz"] in (None, "local") else "ny"
            today = rules.today_local(conn)
            base["gm"]["today"] = today.isoformat()
            base["day_number_today"] = timeutil.day_number(db.start_date(conn), today)
            base["close_dot"] = _close_dot(conn, today)
            base["run_days"] = rules.current_run(conn, today)
            cents = money_ui.wallet_cents(conn)
            if cents is not None:
                base["wallet"] = {"cents": cents, "text": money_ui.usd_cents(cents)}
    except Exception:  # a broken game setting must never take a page down
        log.exception("could not read the page base context")
    return base


def _render(request: Request, name: str, context: dict[str, Any], status_code: int = 200) -> Response:
    context.setdefault("msg", None)
    context.setdefault("kind", "ok")
    if not name.startswith("_"):  # partials swapped in by HTMX do not need the page chrome
        for key, value in _page_base(request).items():
            context.setdefault(key, value)
    return templates.TemplateResponse(request, name, context, status_code=status_code)


def _clean_flash(msg: str, kind: str) -> tuple[str | None, str]:
    msg = (msg or "").strip()[:300]
    return (msg or None), (kind if kind in ("ok", "info", "warn") else "ok")


def _parse_int(text: Any, low: int, high: int) -> int | None:
    if isinstance(text, bool):
        return None
    try:
        value = int(str(text).strip())
    except (TypeError, ValueError):
        return None
    return value if low <= value <= high else None


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in ("1", "true", "on", "yes", "y")


# Dates outside this window are treated as "not given": week and day arithmetic overflows at the extremes.
EARLIEST_DAY = date(2000, 1, 1)
LATEST_DAY = date(2100, 12, 31)


def _parse_day(text: str | None, default: date) -> date:
    """A date from a query or form field, or `default` if it is missing, malformed or absurdly far away."""
    try:
        parsed = date.fromisoformat((text or "").strip())
    except (ValueError, AttributeError):
        return default
    return parsed if EARLIEST_DAY <= parsed <= LATEST_DAY else default


def _valid_hhmm(text: str) -> str | None:
    """Return 'HH:MM' if the text is a clock time, else None."""
    match = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", text or "")
    if not match:
        return None
    hours, minutes = int(match.group(1)), int(match.group(2))
    if hours > 23 or minutes > 59:
        return None
    return f"{hours:02d}:{minutes:02d}"


def _local_time(dt: datetime, tz: str) -> str:
    return dt.astimezone(ZoneInfo(tz)).strftime("%H:%M")


def _span(start: datetime, end: datetime, tz: str) -> str:
    return f"{_local_time(start, tz)} to {_local_time(end, tz)}"


def _now() -> datetime:
    return timeutil.now_utc()


def _deep_applies(category: str, deep: bool) -> bool:
    """Deep only means something for ladder work (and the early tracker-build phase)."""
    return bool(deep) and category in DEEP_CATEGORIES


def _weeks_since_start(conn: sqlite3.Connection, today: date) -> int:
    """1 for the first week of use."""
    start = db.start_date(conn)
    return (timeutil.week_monday(today) - timeutil.week_monday(start)).days // 7 + 1


def _first_contract_monday(conn: sqlite3.Connection) -> date | None:
    row = conn.execute("SELECT MIN(effective_from) FROM contracts").fetchone()
    return date.fromisoformat(row[0]) if row and row[0] else None


# --------------------------------------------------------------------------
# The game step shared by every write path
# --------------------------------------------------------------------------

def _g_before(conn: sqlite3.Connection) -> game.Snapshot | None:
    """Snapshot before a write. A problem in the game layer must never block the write itself."""
    try:
        return game.snapshot(conn)
    except Exception:
        log.exception("game.snapshot failed")
        return None


def _g_after(
    conn: sqlite3.Connection, before: game.Snapshot | None, *, entry: dict | None = None, output: dict | None = None
) -> list[dict]:
    """Sync the ledger and diff the snapshots: the celebrations for the write that just happened."""
    if before is None:
        return []
    try:
        events = game.finish_write(conn, before, entry=entry, output=output)
    except Exception:
        log.exception("game.finish_write failed")
        return []
    live.publish_game_events(events, db.utc_now_iso())
    return events


def _g_sync(conn: sqlite3.Connection) -> None:
    """Move the ledger and the XP ratchet up to now (silently), e.g. before something is deleted."""
    try:
        game.sync_unlocks(conn)
    except Exception:
        log.exception("game.sync_unlocks failed")


def _hx_headers(events: list[dict]) -> dict[str, str]:
    """HX-Trigger carrying the events (ASCII-only JSON, so it is always a valid header)."""
    return {"HX-Trigger": json.dumps({"witness:events": events})} if events else {}


MILESTONE_KINDS = {"floor", "target", "output", "comeback", "repair", "week_kept", "node", "district", "level", "rest", "seal"}


def _flash_text(msg: str, events: list[dict]) -> str:
    """The flash line for a redirect: the receipt, then up to two milestones (HTTP redirects drop HX headers)."""
    if not events:
        return msg
    text = game.toast_text(events)
    extra = [e["title"] for e in events[1:] if e.get("kind") in MILESTONE_KINDS][:2]
    if extra:
        text = text.rstrip(".") + ". " + ". ".join(extra) + "."
    return text


def _is_sealed(conn: sqlite3.Connection, d: date) -> bool:
    try:
        row = conn.execute("SELECT 1 FROM unlocks WHERE key = ?", (f"seal:{d.isoformat()}",)).fetchone()
    except sqlite3.OperationalError:
        return False
    return row is not None


def _close_dot(conn: sqlite3.Connection, today: date) -> bool:
    """The small dot on the Close tab: it is evening and today is not sealed yet."""
    try:
        settings = db.all_settings(conn)
        bedtime = timeutil.at_local(today, settings["bedtime"], settings["timezone"], settings["day_start_hour"])
        return _now() >= bedtime - timedelta(minutes=60) and not _is_sealed(conn, today)
    except Exception:
        return False


# --------------------------------------------------------------------------
# Today
# --------------------------------------------------------------------------

def _entry_rows(conn: sqlite3.Connection, d: date, tz: str, day_start_hour: int) -> list[dict[str, Any]]:
    """The day's entries as dicts ready for the timeline."""
    low, high = timeutil.day_bounds_utc(d, tz, day_start_hour)
    rows = conn.execute(
        "SELECT * FROM entries WHERE deleted = 0 AND start_utc < ? AND end_utc > ? ORDER BY start_utc, id",
        (timeutil.to_iso(high), timeutil.to_iso(low)),
    ).fetchall()
    result = []
    for row in rows:
        start, end = timeutil.from_iso(row["start_utc"]), timeutil.from_iso(row["end_utc"])
        result.append({
            "id": row["id"], "category": row["category"], "deep": bool(row["deep"]),
            "note": row["note"] or "", "source": row["source"],
            "minutes": timeutil.minutes_between(start, end),
            "span": _span(start, end, tz),
        })
    return result


def _running_focus(conn: sqlite3.Connection, tz: str) -> dict[str, Any] | None:
    """The focus session that has not been ended yet, if any."""
    row = conn.execute(
        "SELECT * FROM focus_sessions WHERE end_utc IS NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return _pomodoro_focus(conn, tz)
    start = timeutil.from_iso(row["start_utc"])
    until = start + timedelta(minutes=row["planned_minutes"])
    elapsed = timeutil.minutes_between(start, _now())
    return {
        "id": row["id"], "label": row["label"] or "", "category": row["category"],
        "planned": row["planned_minutes"], "until": _local_time(until, tz), "started": row["start_utc"],
        "elapsed": max(0, elapsed), "time_is_up": _now() >= until,
    }


def _pomodoro_focus(conn: sqlite3.Connection, tz: str) -> dict[str, Any] | None:
    """The Pomodoro work block (or the block waiting for its rating) in the shape of the old focus pill."""
    state = pomodoro.get_state(conn)
    run = state["run"]
    now = _now()
    if run and run["status"] in ("running", "paused") and run["phase"] == "work":
        elapsed = run["elapsed_seconds"]
        return {
            "id": run["id"], "label": run["label"], "category": run["category"], "planned": run["phase_seconds"] // 60,
            "until": _local_time(now + timedelta(seconds=run["remaining_seconds"]), tz),
            "started": timeutil.to_iso(now - timedelta(seconds=elapsed)), "elapsed": elapsed, "time_is_up": False,
            "pomodoro": True,
        }
    if state["pending_ratings"]:
        block = state["pending_ratings"][0]
        ended = timeutil.from_iso(block["ended_utc"])
        return {
            "id": block["run_id"], "label": block["label"], "category": block["category"], "planned": block["minutes"],
            "until": _local_time(ended, tz),
            "started": timeutil.to_iso(ended - timedelta(minutes=block["minutes"])), "elapsed": block["minutes"] * 60,
            "time_is_up": True, "pomodoro": True,
        }
    return None


def _plan_blocks(conn: sqlite3.Connection, d: date) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM plan_blocks WHERE local_date = ? ORDER BY COALESCE(cue_time, '99:99'), id",
        (d.isoformat(),),
    ).fetchall()


def today_context(
    state: Any, conn: sqlite3.Connection, msg: str | None = None, kind: str = "ok", form_text: str = "",
    full: bool = True,
) -> dict[str, Any]:
    """Everything the Today page needs, computed from the database. `full` adds the dialogs' data."""
    settings = db.all_settings(conn)
    tz, day_start_hour = settings["timezone"], settings["day_start_hour"]
    today = rules.today_local(conn)
    day = rules.day_summary(conn, today, today)
    week = rules.week_summary(conn, today, today)
    consistency = rules.consistency(conn, today)
    totals = rules.lifetime_totals(conn)
    contract_start = _first_contract_monday(conn)
    pending = rules.pending_lapse(conn, today)
    repair = rules.open_repair_window(conn, today)
    blocks = _plan_blocks(conn, today)
    phase = settings.get("phase")
    gs = game.today_state(conn, today)
    tower_days = []
    for item in gs["week"]["days"]:  # the week's seven towers; today's carries its lamps, fog and beacons
        merged = dict(item)
        if item["is_today"]:
            merged.update(lamps=gs["tower"]["lamps"], fog_minutes=gs["tower"]["fog_minutes"], outputs=gs["tower"]["outputs"])
        tower_days.append(merged)
    deep_by_day = {d.local_date.isoformat(): d.deep_minutes for d in week.days}
    for item in tower_days:
        item["deep_minutes"] = deep_by_day.get(item["date"], 0)
    ghost_minutes = gs["ghost"]["last_week_same_dow"]
    target = gs["today"]["target_minutes"] or 90
    context: dict[str, Any] = {
        "active": "today", "page": "today", "msg": msg, "kind": kind, "form_text": form_text,
        "today": today, "day": day, "week": week, "consistency": consistency, "totals": totals,
        "run": gs["run"]["current"], "gs": gs,
        "has_contract": week.status != "baseline",
        "contract_start": contract_start,
        "pending_lapse": pending, "repair_day": repair,
        "repair_until": (repair + timedelta(days=2)) if repair else None,
        "blocks": blocks,
        "entries": _entry_rows(conn, today, tz, day_start_hour),
        "outputs_today": conn.execute(
            "SELECT * FROM outputs WHERE deleted = 0 AND local_date = ? ORDER BY id", (today.isoformat(),)
        ).fetchall(),
        "focus": _running_focus(conn, tz),
        "pomodoro": pomodoro.get_state(conn),
        "quick_categories": QUICK_CATEGORIES,
        "default_category": phase if phase in categories.LADDER else categories.LADDER[0],
        "output_stages": OUTPUT_STAGES,
        "focus_outcomes": FOCUS_OUTCOMES,
        "deep_cap": settings["deep_cap_minutes"],
        "skips_left": week.skips_left,
        "tower_days": tower_days,
        "week_svg": skyline_svg(tower_days, 1),
        "ghost_minutes": ghost_minutes,
        "ghost_angle": round(min(1.0, ghost_minutes / target) * 360 - 270, 1),
        "weeks_kept": consistency["weeks_kept_last_12"],
        "weeks_with_contract": consistency["weeks_with_contract_last_12"],
    }
    if full:
        context["plan"] = plan_context(conn, "today")
        if pending:
            context["lapse"] = lapse_context(conn)
    return context


def _notice(msg: str, kind: str = "ok") -> dict:
    """A plain message as an event, so the page shows a toast and then refreshes itself."""
    return {"kind": "notice", "size": "tick", "title": msg.rstrip("."), "detail": "", "fx": {}, "tone": kind}


def _today_response(
    request: Request, conn: sqlite3.Connection, msg: str, kind: str = "ok", form_text: str = "",
    events: list[dict] | None = None, refresh: bool = False,
) -> Response:
    """HTMX gets a small flash fragment plus HX-Trigger with the events; a plain form post is redirected to the page."""
    events = events or []
    if _is_htmx(request):
        shown = msg if (kind != "ok" or (not events and not refresh)) else None
        response = _render(request, "_flash.html", {"msg": shown, "kind": kind})
        sent = events or ([_notice(msg, kind)] if refresh else [])
        for name, value in _hx_headers(sent).items():
            response.headers[name] = value
        return response
    # without JavaScript the typed line travels with the redirect, so a line that could not be read is not lost
    return _redirect("/", _flash_text(msg, events), kind, text=form_text[:300])


def _entries_fragment(request: Request, conn: sqlite3.Connection, events: list[dict] | None = None, msg: str = "") -> Response:
    """The Today log list as an HTML fragment (HTMX swaps it in; the event, if any, refreshes the rest)."""
    settings = db.all_settings(conn)
    today = rules.today_local(conn)
    context = {
        "entries": _entry_rows(conn, today, settings["timezone"], settings["day_start_hour"]),
        "outputs_today": conn.execute(
            "SELECT * FROM outputs WHERE deleted = 0 AND local_date = ? ORDER BY id", (today.isoformat(),)
        ).fetchall(),
    }
    response = _render(request, "_entries.html", context)
    sent = events or ([_notice(msg)] if msg else [])
    for name, value in _hx_headers(sent).items():
        response.headers[name] = value
    return response


@router.get("/")
def today_page(request: Request, msg: str = "", kind: str = "ok", text: str = "", home: str = "") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        # Today is the room (docs/COZY.md 3a): while a focus run is active (running, paused, on a break or holding after a
        # block) you are at your study spot, so Today opens the Focus Screen. /?home=1 stays home; so do the "Place it now"
        # and decorate links, and a typed line that could not be read (no JavaScript) is never dropped by a redirect.
        params = request.query_params
        if not (_truthy(home) or text or "place" in params or "decorate" in params or _is_htmx(request)):
            try:
                if pomodoro.get_state(conn).get("active"):
                    return _redirect("/pomodoro", flash, flash_kind) if flash else RedirectResponse("/pomodoro", status_code=303)
            except Exception:  # the room must always open, whatever the focus state says
                log.exception("could not read the focus state for the Today redirect")
        _g_sync(conn)  # first visit: a silent backfill of history; later: keeps the ledger and XP mark current
        return _render(request, "today.html", today_context(
            _state(request), conn, flash, flash_kind, form_text=" ".join(text.split())[:300]))


@router.get("/today/entries")
def today_entries(request: Request) -> Response:
    with _conn(request) as conn:
        return _entries_fragment(request, conn)


@router.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


# --- logging --------------------------------------------------------------

def _new_live_entry(
    conn: sqlite3.Connection, category: str, minutes_value: Any, deep: bool, note: str, plan_block_value: Any = ""
) -> tuple[dict[str, Any] | None, str | None]:
    """Create a 'live' entry that ends now. Returns (entry, error)."""
    if category not in categories.ALL:
        return None, "Pick a category first."
    minutes = _parse_int(minutes_value, 1, 600)
    if minutes is None:
        return None, "Minutes: use a whole number from 1 to 600."
    block_id = _parse_int(plan_block_value, 1, 10**9)
    if block_id is not None and conn.execute("SELECT 1 FROM plan_blocks WHERE id = ?", (block_id,)).fetchone() is None:
        block_id = None
    end = _now()
    deep = _deep_applies(category, deep)
    clean_note = (note or "").strip()[:200]
    entry_id = rules.add_entry(
        conn, end - timedelta(minutes=minutes), end, category, deep, "live",
        note=clean_note or None, plan_block_id=block_id,
    )
    return {"id": entry_id, "category": category, "minutes": minutes, "deep": deep, "note": clean_note}, None


def _new_typed_entry(
    conn: sqlite3.Connection, state: Any, text: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Create an entry from a typed line such as '45m numpy ex 1-12' (regex first, then the free LLM if set up)."""
    text = (text or "").strip()
    parsed = parser.parse_log_smart(conn, getattr(state, "llm", None), text, db.all_settings(conn), _now()) if text else None
    if parsed is None:
        return None, UNREAD_HINT
    start = parsed.start_utc or (_now() - timedelta(minutes=parsed.minutes))
    end = start + timedelta(minutes=parsed.minutes)
    try:
        entry_id = rules.add_entry(conn, start, end, parsed.category, parsed.deep, "parsed", note=parsed.note or None)
    except ValueError:
        return None, "Couldn't save that entry. Try again with a time."
    return {
        "id": entry_id, "category": parsed.category, "minutes": parsed.minutes, "deep": bool(parsed.deep),
        "note": parsed.note or "",
    }, None


def _entry_message(entry: dict[str, Any]) -> str:
    mins = hm(entry["minutes"])
    return f"Logged {entry['category']}, {mins}{', deep' if entry['deep'] else ''}" + (f": {entry['note']}." if entry["note"] else ".")


@router.post("/api/entries")
def create_entry(
    request: Request,
    category: str = Form(""),
    minutes: str = Form(""),
    deep: str = Form(""),
    note: str = Form(""),
    plan_block_id: str = Form(""),
) -> Response:
    with _conn(request) as conn:
        before = _g_before(conn)
        entry, error = _new_live_entry(conn, category, minutes, _truthy(deep), note, plan_block_id)
        if entry is None:
            return _today_response(request, conn, error or "That didn't save.", "warn")
        events = _g_after(conn, before, entry=entry)
        return _today_response(request, conn, _entry_message(entry), "ok", events=events)


def _delete_entry(conn: sqlite3.Connection, entry_id: int) -> bool:
    """Soft delete: history is never destroyed. The XP mark is brought up to date first, so it never drops."""
    _g_sync(conn)
    cursor = conn.execute("UPDATE entries SET deleted = 1 WHERE id = ? AND deleted = 0", (entry_id,))
    return cursor.rowcount > 0


@router.delete("/api/entries/{entry_id}")
def delete_entry_api(request: Request, entry_id: int) -> Response:
    with _conn(request) as conn:
        removed = _delete_entry(conn, entry_id)
        if _is_htmx(request):
            return _entries_fragment(request, conn, msg="Entry removed." if removed else "That entry was already gone.")
    return JSONResponse({"ok": removed}, status_code=200 if removed else 404)


@router.post("/entries/{entry_id}/delete")
def delete_entry_form(request: Request, entry_id: int) -> Response:
    """Plain-form fallback for the delete button."""
    with _conn(request) as conn:
        removed = _delete_entry(conn, entry_id)
        if _is_htmx(request):
            return _entries_fragment(request, conn, msg="Entry removed." if removed else "That entry was already gone.")
    return _redirect("/", "Entry removed." if removed else "That entry was already gone.")


@router.post("/log")
def typed_log(
    request: Request, text: str = Form(""), category: str = Form(""), minutes: str = Form(""), note: str = Form("")
) -> Response:
    """Typed log such as '45m numpy ex 1-12': regex first, then the free LLM if it is set up.
    Without JavaScript the chips of the log card arrive here too (category + minutes, no text)."""
    state = _state(request)
    with _conn(request) as conn:
        before = _g_before(conn)
        if not text.strip() and (category or minutes):
            entry, error = _new_live_entry(conn, category, minutes, True, note)
        else:
            entry, error = _new_typed_entry(conn, state, text)
        if entry is None:
            return _today_response(request, conn, error or UNREAD_HINT, "info", form_text=text.strip())
        events = _g_after(conn, before, entry=entry)
        return _today_response(request, conn, _entry_message(entry), "ok", events=events)


# --- shipped ----------------------------------------------------------------

def _normalise_url(url: str) -> tuple[str | None, str | None]:
    """(url, error). A bare 'github.com/me/repo' gets https://; odd schemes are refused."""
    url = (url or "").strip()
    if not url:
        return None, None
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", url) and not re.match(r"^https?://", url, re.IGNORECASE):
        return None, "Links start with http:// or https://."
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    if " " in url:
        return None, "Links can't contain spaces."
    return url, None


def _new_output(conn: sqlite3.Connection, stage: str, what: str, url: str) -> tuple[dict[str, Any] | None, str | None, str]:
    """Record a shipped output. Returns (output, error, error_kind)."""
    link, error = _normalise_url(url)
    if error:
        return None, error, "warn"
    if stage not in OUTPUT_STAGES:
        return None, "Pick the stage this output belongs to.", "warn"
    try:
        output_id = rules.add_output(conn, rules.today_local(conn), stage, what, link)
    except ValueError:
        return None, "Say in one line what it shows.", "warn"
    return {"id": output_id, "stage": stage, "what": what.strip()[:rules.MAX_WHAT_CHARS], "url": link}, None, "ok"


@router.post("/outputs")
def create_output(
    request: Request, stage: str = Form(""), what: str = Form(""), url: str = Form("")
) -> Response:
    with _conn(request) as conn:
        before = _g_before(conn)
        output, error, error_kind = _new_output(conn, stage, what, url)
        if output is None:
            return _today_response(request, conn, error or "That didn't save.", error_kind)
        events = _g_after(conn, before, output={"stage": stage})
        return _today_response(request, conn, f"Shipped: {output['what']}. That counts as today's floor.", "ok", events=events)


# --- focus ------------------------------------------------------------------

@router.post("/focus/start")
def focus_start(
    request: Request, minutes: str = Form("25"), label: str = Form(""), category: str = Form("")
) -> Response:
    with _conn(request) as conn:
        if conn.execute("SELECT 1 FROM focus_sessions WHERE end_utc IS NULL").fetchone() or pomodoro.is_active(conn):
            return _today_response(request, conn, "A focus session is already running.", "info")
        planned = _parse_int(minutes, 1, 240)
        if planned is None:
            return _today_response(request, conn, "Focus minutes: use 1 to 240.", "warn")
        if category not in categories.ALL:
            return _today_response(request, conn, "Pick a category for the session.", "warn")
        conn.execute(
            "INSERT INTO focus_sessions(start_utc, planned_minutes, label, category) VALUES (?, ?, ?, ?)",
            (timeutil.to_iso(_now()), planned, label.strip()[:120] or None, category),
        )
        return _today_response(request, conn, f"Focus started: {planned} min of {category}. Quiet till then.", "ok")


def _stop_focus(conn: sqlite3.Connection, outcome: str) -> tuple[str, str, dict[str, Any] | None, list[dict]]:
    """End the running session. Returns (message, kind, entry or None, events)."""
    session = conn.execute("SELECT * FROM focus_sessions WHERE end_utc IS NULL ORDER BY id DESC LIMIT 1").fetchone()
    if session is None:  # the running thing may be a Pomodoro run: the old buttons still work on it
        return pomodoro.stop_and_rate(conn, outcome)
    if outcome not in ("full", "mostly", "pulled_away", "cancelled"):
        return "Pick how the session went.", "warn", None, []

    now = _now()
    start = timeutil.from_iso(session["start_utc"])
    if outcome == "cancelled":
        conn.execute(
            "UPDATE focus_sessions SET end_utc = ?, outcome = 'cancelled' WHERE id = ?", (timeutil.to_iso(now), session["id"])
        )
        return "Focus session cancelled. Nothing was logged.", "info", None, []

    before = _g_before(conn)
    # Never log more than was planned: a forgotten session shouldn't invent hours.
    minutes = max(1, min(session["planned_minutes"], timeutil.minutes_between(start, now)))
    deep = _deep_applies(session["category"], outcome != "pulled_away")
    entry_id = rules.add_entry(
        conn, start, start + timedelta(minutes=minutes), session["category"], deep, "focus", note=session["label"],
    )
    conn.execute(
        "UPDATE focus_sessions SET end_utc = ?, outcome = ?, entry_id = ? WHERE id = ?",
        (timeutil.to_iso(now), outcome, entry_id, session["id"]),
    )
    entry = {"id": entry_id, "category": session["category"], "minutes": minutes, "deep": deep, "note": session["label"] or ""}
    events = _g_after(conn, before, entry=entry)
    return f"Logged {session['category']}, {hm(minutes)}{', deep' if deep else ''}.", "ok", entry, events


@router.post("/focus/stop")
def focus_stop(request: Request, outcome: str = Form("full")) -> Response:
    """End the session. 'cancelled' saves nothing; the other outcomes create one entry."""
    with _conn(request) as conn:
        message, kind, _entry, events = _stop_focus(conn, outcome)
        return _today_response(request, conn, message, kind, events=events)


@router.get("/focus")
def focus_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    """No-JS route for starting or stopping a focus session."""
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        context = today_context(_state(request), conn, flash, flash_kind, full=False)
        return _render(request, "focus.html", context)


# --- plan block status and skips -----------------------------------------------

@router.post("/plan/{block_id}/status")
def plan_block_status(request: Request, block_id: int, status: str = Form("done")) -> Response:
    if status not in ("planned", "done", "partial", "skipped"):
        status = "done"
    with _conn(request) as conn:
        conn.execute("UPDATE plan_blocks SET status = ? WHERE id = ?", (status, block_id))
        if _is_htmx(request):
            response = _render(request, "_flash.html", {"msg": None, "kind": "ok"})
            response.headers["HX-Refresh"] = "true"
            return response
    return _redirect("/", "Block updated.", "ok")


def _mark_day(conn: sqlite3.Connection, target: date, kind: str, reason: str) -> tuple[str, str, list[dict]]:
    """Spend one of the week's skips (or declare a rest day). Returns (message, kind, events)."""
    kind = kind if kind in rules.VALID_MARK_KINDS else "skip"
    before = _g_before(conn)
    if rules.use_skip(conn, target, kind, reason.strip()[:120] or None):
        word = "rest day" if kind == "rest" else "skip"
        events = _g_after(conn, before)
        return f"{day_label(target)} is marked as a {word}. The week's other days carry on as usual.", "ok", events
    return "No skips left this week. The floor is only 30 minutes, though.", "info", []


@router.post("/skip")
def declare_skip(
    request: Request, day: str = Form(""), kind: str = Form("skip"), reason: str = Form(""), back: str = Form("/")
) -> Response:
    """Spend one of the week's skips (or declare a rest day) for a day."""
    back = back if back in ("/", "/plan") else "/"
    with _conn(request) as conn:
        target = _parse_day(day, rules.today_local(conn))
        msg, level, events = _mark_day(conn, target, kind, reason)
    return _redirect(back, _flash_text(msg, events), level)


# --------------------------------------------------------------------------
# Plan (a drawer on Today; /plan stays as the no-JS page)
# --------------------------------------------------------------------------

def _plan_target_day(conn: sqlite3.Connection, which: str) -> tuple[str, date]:
    today = rules.today_local(conn)
    if which == "tomorrow":
        return "tomorrow", today + timedelta(days=1)
    return "today", today


def _overrun_warning(conn: sqlite3.Connection, d: date) -> str | None:
    """From week 3, warn when the plan is bigger than what you usually finish."""
    if _weeks_since_start(conn, rules.today_local(conn)) < 3:
        return None
    ratio = rules.overrun_ratio(conn)
    planned = sum(row["minutes"] for row in _plan_blocks(conn, d))
    if ratio is None or planned <= 0 or ratio >= 0.9:
        return None
    return (
        f"That's {hm(planned)}. You usually finish about {int(round(ratio * 100))}% of what you plan, "
        f"which is about {hm(planned * ratio)}. Trim a block?"
    )


def plan_context(conn: sqlite3.Connection, which: str, msg: str | None = None, kind: str = "ok") -> dict[str, Any]:
    settings = db.all_settings(conn)
    which, target = _plan_target_day(conn, which)
    blocks = _plan_blocks(conn, target)
    window_key = "study_start_weekday" if target.weekday() < 5 else "study_start_weekend"
    phase = settings.get("phase")
    free_slots = max(0, settings["max_blocks_per_day"] - len(blocks))
    return {
        "active": "today", "page": "today", "msg": msg, "kind": kind,
        "which": which, "target": target, "blocks": blocks,
        "free_slots": free_slots, "slot_numbers": list(range(free_slots)),
        "max_blocks": settings["max_blocks_per_day"],
        "default_cue": settings[window_key],
        "default_category": phase if phase in categories.LADDER else categories.LADDER[0],
        "plan_categories": tuple(categories.LADDER) + tuple(c for c in categories.OTHER if c not in ("Unknown", "Sleep", "Day job")),
        "overrun_warning": _overrun_warning(conn, target),
        "floor_minutes": settings["floor_minutes"],
        "week": rules.week_summary(conn, target),
        "day_mark": conn.execute("SELECT kind FROM day_marks WHERE local_date = ?", (target.isoformat(),)).fetchone(),
    }


@router.get("/plan")
def plan_page(request: Request, day: str = "today", msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        data = plan_context(conn, day, flash, flash_kind)
        return _render(request, "plan.html", {**data, "plan_data": data})


@router.post("/plan")
async def plan_save(request: Request) -> Response:
    """Add up to max_blocks_per_day blocks, each rendered as an if-then sentence."""
    form = await request.form()
    with _conn(request) as conn:
        which, target = _plan_target_day(conn, str(form.get("day", "today")))
        back_home = str(form.get("back", "")) == "/"
        settings = db.all_settings(conn)
        existing = len(_plan_blocks(conn, target))
        room = settings["max_blocks_per_day"] - existing

        rows: list[tuple[str, str, str, str]] = []
        if form.get("preset") == "floor":
            phase = settings.get("phase")
            window_key = "study_start_weekday" if target.weekday() < 5 else "study_start_weekend"
            rows.append((phase if phase in categories.LADDER else categories.LADDER[0],
                         str(settings["floor_minutes"]), settings[window_key], ""))
        else:
            for cat, mins, cue, task in zip(
                form.getlist("category"), form.getlist("minutes"), form.getlist("cue_time"), form.getlist("task")
            ):
                if str(mins).strip():
                    rows.append((str(cat), str(mins), str(cue), str(task)))

        errors: list[str] = []
        if not rows:
            errors.append("Add a block with some minutes, or use \"Floor only\".")
        if len(rows) > room:
            errors.append(f"A day holds up to {settings['max_blocks_per_day']} blocks, so {max(room, 0)} more fit today.")
        prepared = []
        for cat, mins, cue, task in rows:
            minutes = _parse_int(mins, 1, 600)
            cue_time = _valid_hhmm(cue) if cue.strip() else None
            if cat not in categories.ALL or minutes is None or (cue.strip() and cue_time is None):
                errors.append("Each block needs a category, minutes (1 to 600) and a cue time like 19:30.")
                break
            prepared.append((cat, minutes, cue_time, task.strip()[:120]))
        if errors:
            data = plan_context(conn, which, " ".join(errors), "warn")
            return _render(request, "plan.html", {**data, "plan_data": data}, status_code=400)

        for cat, minutes, cue_time, task in prepared:
            rules.add_plan_block(conn, target, cat, minutes, cue_time, task or None)
        count = len(prepared)
    message = f"Planned {count} block{'s' if count != 1 else ''}."
    if back_home:
        return _redirect("/", message, "ok")
    return _redirect("/plan", message, "ok", day=which)


@router.post("/plan/{block_id}/delete")
def plan_block_delete(request: Request, block_id: int, day: str = Form("today"), back: str = Form("")) -> Response:
    with _conn(request) as conn:
        conn.execute("DELETE FROM plan_blocks WHERE id = ?", (block_id,))
    if back == "/":
        return _redirect("/", "Block removed.", "ok")
    return _redirect("/plan", "Block removed.", "ok", day=day)


# --------------------------------------------------------------------------
# Evening close
# --------------------------------------------------------------------------

def _job_block_state(conn: sqlite3.Connection, d: date, tz: str, day_start_hour: int) -> str | None:
    """A short description of the job block already recorded for the day."""
    if rules.is_leave_day(conn, d):
        return "day off from the job"
    low, high = timeutil.day_bounds_utc(d, tz, day_start_hour)
    row = conn.execute(
        "SELECT start_utc, end_utc FROM entries WHERE deleted = 0 AND category = 'Day job' AND note = ? "
        "AND start_utc >= ? AND start_utc < ? ORDER BY id DESC LIMIT 1",
        (rules.JOB_BLOCK_NOTE, timeutil.to_iso(low), timeutil.to_iso(high)),
    ).fetchone()
    if row is None:
        return None
    return _span(timeutil.from_iso(row["start_utc"]), timeutil.from_iso(row["end_utc"]), tz)


def _gap_rows(state: Any, conn: sqlite3.Connection, d: date, tz: str, aw_ok: bool) -> list[dict[str, Any]]:
    rows = []
    for gap_start, gap_end in rules.gaps(conn, d):
        full: dict[str, Any] | None = None
        partial: list[dict[str, Any]] = []
        if aw_ok:
            for sug in activitywatch.suggest(conn, state.aw, gap_start, gap_end):
                start, end = max(sug.start_utc, gap_start), min(sug.end_utc, gap_end)
                if (end - start) < timedelta(minutes=1):
                    continue
                item = {
                    "start": timeutil.to_iso(start), "end": timeutil.to_iso(end),
                    "span": _span(start, end, tz), "category": sug.category, "deep": sug.deep,
                    "minutes": timeutil.minutes_between(start, end), "apps": ", ".join(sug.apps),
                }
                # A guess that covers the whole stretch becomes one tap on the stretch itself.
                if full is None and start <= gap_start and end >= gap_end:
                    full = item
                else:
                    partial.append(item)
        rows.append({
            "start": timeutil.to_iso(gap_start), "end": timeutil.to_iso(gap_end),
            "span": _span(gap_start, gap_end, tz),
            "minutes": timeutil.minutes_between(gap_start, gap_end), "guess": full, "suggestions": partial,
        })
    return rows


def close_context(
    state: Any, conn: sqlite3.Connection, d: date | None = None, msg: str | None = None, kind: str = "ok"
) -> dict[str, Any]:
    settings = db.all_settings(conn)
    tz, day_start_hour = settings["timezone"], settings["day_start_hour"]
    today = rules.today_local(conn)
    d = d or today
    aw_ok = bool(state.aw.available())

    gap_rows = _gap_rows(state, conn, d, tz, aw_ok)
    day = rules.day_summary(conn, d, today)
    week = rules.week_summary(conn, d, today)
    planned = sum(b["minutes"] for b in _plan_blocks(conn, d))
    gs = game.today_state(conn, today)
    tower_days = []
    for item in gs["week"]["days"]:
        merged = dict(item)
        if item["is_today"]:
            merged.update(lamps=gs["tower"]["lamps"], fog_minutes=gs["tower"]["fog_minutes"], outputs=gs["tower"]["outputs"])
        tower_days.append(merged)
    job_open = day.is_job_day and not rules.job_block_closed(conn, d)
    sealed = _is_sealed(conn, d)
    closed = game.day_closed(conn, d, today)
    unknown_minutes = 0
    gap_minutes = sum(g["minutes"] for g in gap_rows)
    fog_minutes = gap_minutes + unknown_minutes
    return {
        "active": "close", "page": "close", "msg": msg, "kind": kind,
        "day_date": d, "is_today": d == today, "prev_day": d - timedelta(days=1), "next_day": d + timedelta(days=1),
        "is_job_day": day.is_job_day, "job_state": _job_block_state(conn, d, tz, day_start_hour),
        "job_choices": JOB_CHOICE_LABELS, "job_open": job_open,
        "gaps": gap_rows, "gap_categories": GAP_CATEGORIES, "aw_ok": aw_ok,
        "day": day, "week": week, "planned_minutes": planned,
        "target_gap": max(0, day.target_minutes - day.deep_minutes),
        "gs": gs, "week_svg": skyline_svg(tower_days, 1),
        "day_number": timeutil.day_number(db.start_date(conn), d),
        "closed": closed, "sealed": sealed, "fog_minutes": fog_minutes,
        "recap": game.day_recap(conn, d, today) if sealed else None,
        "gap_icons": game.CATEGORY_ICON,
    }


@router.get("/close")
def close_page(request: Request, day: str = "", msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        d = _parse_day(day, rules.today_local(conn))
        context = close_context(_state(request), conn, d, flash, flash_kind)
        if context["is_today"] and d.weekday() == 6:  # Sunday is rent day: the week so far, money only
            try:
                context["econ"] = economy.economy_state(conn, wx=_econ_weather(conn))
            except Exception:
                log.exception("could not read the money state for the Sunday card")
        return _render(request, "close.html", context)


@router.post("/close")
def close_job(request: Request, day: str = Form(""), choice: str = Form("")) -> Response:
    """Record the day-job block in one click."""
    with _conn(request) as conn:
        d = _parse_day(day, rules.today_local(conn))
        if choice not in rules.JOB_CHOICES:
            return _redirect("/close", "Pick one of the job options.", "warn", day=d.isoformat())
        before = _g_before(conn)
        rules.close_job_block(conn, d, choice)
        events = _g_after(conn, before)
    msg = "Day job recorded." if choice != "leave" else "Marked as a day off from the job."
    return _redirect("/close", _flash_text(msg, [e for e in events if e.get("kind") != "log"]) if events else msg, "ok", day=d.isoformat())


def _label_gap(
    conn: sqlite3.Connection, d: date, start: str, end: str, category: str, deep: bool, source: str
) -> tuple[dict[str, Any] | None, str | None]:
    """Label one unlogged stretch (or an ActivityWatch suggestion for it). Returns (entry, error)."""
    if category == "Don't remember":
        category, deep = "Unknown", False
    try:
        start_dt, end_dt = timeutil.from_iso(start), timeutil.from_iso(end)
        if category not in categories.ALL:
            raise ValueError("category")
        applied_deep = _deep_applies(category, deep)
        entry_id = rules.add_entry(
            conn, start_dt, end_dt, category, applied_deep, "aw" if source == "aw" else "backfill",
        )
    except (ValueError, TypeError):
        return None, "Couldn't label that stretch. Try again."
    return {
        "id": entry_id, "category": category, "minutes": timeutil.minutes_between(start_dt, end_dt),
        "deep": applied_deep, "note": "",
    }, None


@router.post("/close/label")
def close_label(
    request: Request,
    day: str = Form(""),
    start: str = Form(""),
    end: str = Form(""),
    category: str = Form(""),
    deep: str = Form(""),
    source: str = Form("backfill"),
) -> Response:
    """Label one unlogged stretch (or an ActivityWatch suggestion for it)."""
    with _conn(request) as conn:
        d = _parse_day(day, rules.today_local(conn))
        before = _g_before(conn)
        entry, error = _label_gap(conn, d, start, end, category, _truthy(deep), source)
        if entry is None:
            return _redirect("/close", error, "warn", day=d.isoformat())
        events = _g_after(conn, before, entry=entry)
    shown = "Left as unknown. That is allowed." if entry["category"] == "Unknown" else f"Labelled as {entry['category']}."
    extra = [e for e in events if e.get("kind") not in ("log",)]
    return _redirect("/close", _flash_text(shown, extra) if extra else shown, "ok", day=d.isoformat())


def _seal_hint(conn: sqlite3.Connection, d: date) -> str:
    if rules.gaps(conn, d):
        return "A few stretches are still open. Settle them, then seal."
    if rules.is_job_day(conn, d) and not rules.job_block_closed(conn, d):
        return "Answer the day-job question first, then seal."
    return "Log one honest hour first (rest and drift count), then seal."


def _day_of(conn: sqlite3.Connection, d: date) -> str:
    """'Day 12' for a local day."""
    return timeutil.day_number_label(timeutil.day_number(db.start_date(conn), d))


def _seal(conn: sqlite3.Connection, d: date) -> tuple[dict[str, Any] | None, list[dict]]:
    """Seal a closed day. Returns (result from game.seal_day or None, all events)."""
    before = _g_before(conn)
    result = game.seal_day(conn, d)
    if result is None:
        return None, []
    live.publish_game_events(list(result["events"]), db.utc_now_iso())
    events = list(result["events"]) + [e for e in _g_after(conn, before) if e.get("kind") != "seal"]
    return result, events


@router.post("/close/seal")
def close_seal(request: Request, day: str = Form("")) -> Response:
    """Plain-form route for 'Seal the day' (the page calls /api/close/seal when JavaScript is on)."""
    with _conn(request) as conn:
        d = _parse_day(day, rules.today_local(conn))
        result, events = _seal(conn, d)
        label = _day_of(conn, d)
    if result is None:
        with _conn(request) as conn:
            hint = _seal_hint(conn, d)
        return _redirect("/close", hint, "info", day=d.isoformat())
    return _redirect("/close", _flash_text(f"{label} sealed.", events), "ok", day=d.isoformat())


# --------------------------------------------------------------------------
# Hour map (the 168-hour grid; shown inside World > Week)
# --------------------------------------------------------------------------

def _aw_blocks_by_day(
    state: Any, conn: sqlite3.Connection, bounds: list[tuple[datetime, datetime]]
) -> list[list[activitywatch.Suggestion]]:
    """ActivityWatch suggestions for each day of the week (empty lists when AW is off)."""
    empty: list[list[activitywatch.Suggestion]] = [[] for _ in bounds]
    if not state.aw.available():
        return empty
    now = _now()
    for index, (low, high) in enumerate(bounds):
        if low < now:
            empty[index] = activitywatch.suggest(conn, state.aw, low, min(high, now), slot_minutes=60)
    return empty


def grid_context(state: Any, conn: sqlite3.Connection, monday: date) -> dict[str, Any]:
    """A 24 x 7 grid: one cell per local hour, coloured by the category with the most logged minutes."""
    settings = db.all_settings(conn)
    tz, day_start_hour = settings["timezone"], settings["day_start_hour"]
    days = [monday + timedelta(days=i) for i in range(7)]
    bounds = [timeutil.day_bounds_utc(d, tz, day_start_hour) for d in days]

    rows = conn.execute(
        "SELECT start_utc, end_utc, category FROM entries WHERE deleted = 0 AND start_utc < ? AND end_utc > ?",
        (timeutil.to_iso(bounds[-1][1]), timeutil.to_iso(bounds[0][0])),
    ).fetchall()
    entries = [(timeutil.from_iso(r["start_utc"]), timeutil.from_iso(r["end_utc"]), r["category"]) for r in rows]
    aw_blocks = _aw_blocks_by_day(state, conn, bounds)

    totals: dict[str, float] = {}
    grid: list[dict[str, Any]] = []
    for hour in range(24):
        cells = []
        for day_index in range(7):
            cell_start = bounds[day_index][0] + timedelta(hours=hour)
            cell_end = cell_start + timedelta(hours=1)
            per_category: dict[str, float] = {}
            for start, end, category in entries:
                minutes = timeutil.overlap_minutes(start, end, cell_start, cell_end)
                if minutes > 0:
                    per_category[category] = per_category.get(category, 0.0) + minutes
            cells.append(_grid_cell(per_category, aw_blocks[day_index], cell_start, cell_end, totals))
        grid.append({"label": f"{(day_start_hour + hour) % 24:02d}", "cells": cells})

    ordered = sorted(totals.items(), key=lambda item: -item[1])
    today = rules.today_local(conn)
    return {
        "monday": monday, "days": days, "today": today, "grid": grid,
        "totals": [(cat, int(round(mins))) for cat, mins in ordered if mins >= 0.5],
        "prev_week": monday - timedelta(days=7), "next_week": monday + timedelta(days=7),
        "aw_ok": any(aw_blocks), "legend": categories.ALL,
    }


def _grid_cell(
    per_category: dict[str, float],
    aw_blocks: list[activitywatch.Suggestion],
    cell_start: datetime,
    cell_end: datetime,
    totals: dict[str, float],
) -> dict[str, Any]:
    """One grid cell: logged time wins; otherwise a faded ActivityWatch suggestion; otherwise empty."""
    logged = sum(per_category.values())
    if logged >= 1:
        scale = 60 / logged if logged > 60 else 1  # overlapping entries never exceed the hour
        for category, minutes in per_category.items():
            totals[category] = totals.get(category, 0.0) + minutes * scale
        top = max(per_category, key=lambda c: per_category[c])
        detail = ", ".join(f"{c} {int(round(m))}m" for c, m in sorted(per_category.items(), key=lambda i: -i[1]))
        return {"kind": "logged", "category": top, "alpha": round(max(0.35, min(1.0, logged / 60)), 2), "title": detail}

    best, best_minutes = None, 0.0
    for block in aw_blocks:
        minutes = timeutil.overlap_minutes(block.start_utc, block.end_utc, cell_start, cell_end)
        if minutes > best_minutes:
            best, best_minutes = block, minutes
    if best is not None and best_minutes >= 10:
        return {"kind": "aw", "category": best.category, "alpha": 1,
                "title": f"Suggested from ActivityWatch (not saved): {best.category}, about {int(best_minutes)}m"}
    return {"kind": "empty", "category": None, "alpha": 1, "title": "Nothing logged"}


# --------------------------------------------------------------------------
# Week review (World > Week)
# --------------------------------------------------------------------------

def build_referee_report(conn: sqlite3.Connection, week: rules.WeekSummary) -> str:
    """The plain-text message the referee gets: facts only, no verdict language."""
    first = _first_contract_monday(conn)
    next_contract = rules.contract_for(conn, week.monday + timedelta(days=7))
    deep_hours = round(week.deep_minutes / 60, 1)
    bullets = [f"• {o['what']}" + (f" ({o['url']})" if _safe_link(o["url"]) else "") for o in week.outputs]

    if week.status == "baseline" or first is None or week.monday < first:
        header = f"Baseline week: {week.outputs_count} outputs logged, no targets yet."
    else:
        number = (week.monday - first).days // 7 + 1
        cycle_week = (number - 1) % CYCLE_WEEKS + 1
        if week.status == "kept":
            header = f"Week {cycle_week} of {CYCLE_WEEKS}: shipped {week.outputs_count} of {week.outputs_required} promised outputs"
        elif week.status == "not_kept":
            header = f"Week {cycle_week}: {week.outputs_count} of {week.outputs_required} outputs. Not this week."
        else:
            header = f"Week {cycle_week} so far: {week.outputs_count} of {week.outputs_required} outputs"
    footer = f"Floor {week.floor_days} of 7 days · {deep_hours} deep hours"
    if next_contract is not None:
        footer += f" · next week: {next_contract['outputs_per_week']} outputs + {next_contract['floor_days_per_week']} floor days"
    return "\n".join([header, *bullets, footer])


def narration_facts(week: rules.WeekSummary) -> dict[str, Any]:
    """Numbers only. No titles, links or free text ever go to the language model."""
    return {
        "outputs_done": week.outputs_count,
        "outputs_required": week.outputs_required,
        "floor_days": week.floor_days,
        "floor_days_required": week.floor_days_required,
        "skips_used": week.skips_used,
        "deep_minutes": week.deep_minutes,
        "deep_minutes_by_category": week.deep_by_category,
        "planned_minutes": week.planned_minutes,
        "planned_done_minutes": week.planned_done_minutes,
        "top_snags": [{"reason": reason, "times": count} for reason, count in week.top_lapse_reasons],
    }


def _referee_ready(state: Any, conn: sqlite3.Connection) -> bool:
    return bool(
        getattr(state, "telegram_app", None) is not None
        and state.config.telegram_enabled
        and db.get_setting(conn, "referee_chat_id")
    )


def week_context(
    state: Any, conn: sqlite3.Connection, monday: date, msg: str | None = None, kind: str = "ok",
    narration: str | None = None, narration_note: str | None = None,
) -> dict[str, Any]:
    today = rules.today_local(conn)
    week = rules.week_summary(conn, monday, today)
    this_monday = timeutil.week_monday(today)
    contract = rules.contract_for(conn, monday)
    return {
        "msg": msg, "kind": kind,
        "monday": monday, "week": week, "today": today,
        "is_current": monday == this_monday, "is_future": monday > this_monday,
        "prev_week": monday - timedelta(days=7), "next_week": monday + timedelta(days=7),
        "contract": contract,
        "next_contract": rules.contract_for(conn, monday + timedelta(days=7)),
        "contract_outputs": contract["outputs_per_week"] if contract else 2,
        "contract_days": contract["floor_days_per_week"] if contract else 5,
        "report": build_referee_report(conn, week),
        "can_send": _referee_ready(state, conn),
        "referee_name": db.get_setting(conn, "referee_name"),
        "llm_ready": getattr(state, "llm", None) is not None,
        "narration": narration, "narration_note": narration_note,
        "reason_labels": dict(LAPSE_REASONS),
        "completion": pct(week.planned_done_minutes, week.planned_minutes) if week.planned_minutes else None,
        "first_contract": _first_contract_monday(conn),
    }


def world_context(
    state: Any, conn: sqlite3.Connection, monday: date | None = None, msg: str | None = None, kind: str = "ok",
    narration: str | None = None, narration_note: str | None = None, view: str = "city", grid_open: bool = False,
) -> dict[str, Any]:
    """World = City (28 days in 3D), Week (card, review, hour map) and Shelf (achievements, ladders, outputs)."""
    today = rules.today_local(conn)
    monday = monday or timeutil.week_monday(today)
    ws = game.world_state(conn, today, days=28)
    shelf = game.shelf_state(conn, today)
    context = week_context(state, conn, monday, msg, kind, narration, narration_note)
    context.update(grid_context(state, conn, monday))
    context["grid_totals"] = context.pop("totals")
    context["today"] = today
    context.update({
        "active": "world", "page": "world", "view": view if view in ("city", "week", "shelf") else "city",
        "grid_open": grid_open, "ws": ws, "shelf": shelf, "city_svg": skyline_svg(ws["days"], 4),
        "totals_view": ws["totals"], "output_stages": OUTPUT_STAGES,
        "default_category": db.get_setting(conn, "phase") if db.get_setting(conn, "phase") in categories.LADDER else categories.LADDER[0],
        "week_view_days": [d for d in ws["days"] if d["date"] >= timeutil.week_monday(today).isoformat()],
        "this_week": ws["weeks"][-1],
        "ghost_last": ws["ghost"]["last_week_deep_by_dow"],
        "unlocked_postcards": shelf["postcards"],
    })
    return context


@router.get("/world")
def world_page(request: Request, week: str = "", view: str = "", grid: str = "", msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        today = rules.today_local(conn)
        monday = timeutil.week_monday(_parse_day(week, today))
        _g_sync(conn)
        context = world_context(_state(request), conn, monday, flash, flash_kind, view=view or "city", grid_open=bool(grid))
        return _render(request, "world.html", context)


@router.get("/week")
def week_page(request: Request, week: str = "", msg: str = "", kind: str = "ok") -> Response:
    """The old Week page lives in World > Week now."""
    with _conn(request) as conn:
        monday = timeutil.week_monday(_parse_day(week, rules.today_local(conn)))
    return _redirect("/world", msg, kind, anchor="week", week=monday.isoformat() if week else "")


@router.get("/grid")
def grid_page(request: Request, week: str = "") -> Response:
    """The old Grid page is the Hour map inside World > Week."""
    with _conn(request) as conn:
        monday = timeutil.week_monday(_parse_day(week, rules.today_local(conn)))
    return _redirect("/world", None, "ok", anchor="week", week=monday.isoformat() if week else "", grid="1")


@router.post("/week")
def week_contract(
    request: Request, action: str = Form("keep"), outputs: str = Form(""), floor_days: str = Form("")
) -> Response:
    """Keep, raise or lower the weekly contract. Lowering waits for next Monday."""
    with _conn(request) as conn:
        today = rules.today_local(conn)
        if action == "keep":
            return _redirect("/world", "Contract stays as it is.", "ok", anchor="week")
        new_outputs, new_days = _parse_int(outputs, 0, 14), _parse_int(floor_days, 0, 7)
        if new_outputs is None or new_days is None:
            return _redirect("/world", "Outputs can be 0 to 14 and floor days 0 to 7.", "warn", anchor="week")
        current = rules.contract_for(conn, today)
        effective = rules.change_contract(conn, new_outputs, new_days, today)
        if current is not None and (new_outputs, new_days) == (current["outputs_per_week"], current["floor_days_per_week"]):
            msg = "Contract stays as it is."
        elif effective == timeutil.week_monday(today):
            msg = f"Contract is now {new_outputs} outputs + {new_days} floor days, from this Monday."
        else:
            msg = f"Saved. {new_outputs} outputs + {new_days} floor days starts Monday {effective.strftime('%d %b')}."
        return _redirect("/world", msg, "ok", anchor="week")


@router.post("/week/narrate")
def week_narrate(request: Request, week: str = Form("")) -> Response:
    """Ask the free model for a short summary of the numbers (optional, uses one call)."""
    state = _state(request)
    with _conn(request) as conn:
        monday = timeutil.week_monday(_parse_day(week, rules.today_local(conn)))
        summary = rules.week_summary(conn, monday, rules.today_local(conn))
        text = llm_module.weekly_narration(state.llm, narration_facts(summary)) if state.llm else None
        note = None if text else "No summary this time. The numbers above are the full report."
        context = world_context(state, conn, monday, narration=text, narration_note=note, view="week")
        return _render(request, "world.html", context)


@router.post("/week/send")
async def week_send(request: Request, week: str = Form("")) -> Response:
    """Send the report text to the referee's Telegram chat (only when it is set up)."""
    state = _state(request)
    with _conn(request) as conn:
        monday = timeutil.week_monday(_parse_day(week, rules.today_local(conn)))
        if not _referee_ready(state, conn):
            return _redirect("/world", "Telegram and a referee chat need to be set up first.", "info", anchor="week", week=monday.isoformat())
        report = build_referee_report(conn, rules.week_summary(conn, monday, rules.today_local(conn)))
        chat_id = int(db.get_setting(conn, "referee_chat_id"))
    try:
        await state.telegram_app.bot.send_message(chat_id=chat_id, text=report)
    except Exception:
        return _redirect("/world", "Couldn't reach Telegram just now. Copy the text instead.", "warn", anchor="week", week=monday.isoformat())
    return _redirect("/world", "Sent to your referee.", "ok", anchor="week", week=monday.isoformat())


# --------------------------------------------------------------------------
# Lapse (a sheet on Today; /lapse stays as the no-JS page)
# --------------------------------------------------------------------------

def lapse_context(conn: sqlite3.Connection, msg: str | None = None, kind: str = "ok") -> dict[str, Any]:
    settings = db.all_settings(conn)
    today = rules.today_local(conn)
    missed = rules.pending_lapse(conn, today)
    window_key = "study_start_weekday" if today.weekday() < 5 else "study_start_weekend"
    phase = settings.get("phase")
    return {
        "active": "today", "page": "today", "msg": msg, "kind": kind,
        "missed": missed, "reasons": LAPSE_REASONS,
        "skips_left": rules.week_summary(conn, missed, today).skips_left if missed else 0,
        "default_cue": settings[window_key],
        "floor_minutes": settings["floor_minutes"],
        "category": phase if phase in categories.LADDER else categories.LADDER[0],
    }


@router.get("/lapse")
def lapse_page(request: Request) -> Response:
    with _conn(request) as conn:
        data = lapse_context(conn)
        return _render(request, "lapse.html", {**data, "lapse_data": data})


@router.post("/lapse")
def lapse_save(
    request: Request,
    reason: str = Form(""),
    choice: str = Form(""),
    minutes: str = Form("25"),
    cue_time: str = Form(""),
    task: str = Form(""),
) -> Response:
    """Reason (optional), then rest / repair / let it go, then an optional minimum plan block for tonight."""
    with _conn(request) as conn:
        today = rules.today_local(conn)
        missed = rules.pending_lapse(conn, today)
        if missed is None:
            return _redirect("/", "Nothing to look back on right now. Today is a fresh page.", "info")

        small_minutes = _parse_int(minutes, 0, 120)
        cue = _valid_hhmm(cue_time) if cue_time.strip() else None
        if choice not in ("skip", "repair", "let_go") or small_minutes is None or (cue_time.strip() and cue is None):
            data = lapse_context(conn, "Pick one of the three options (rest, repair or let it go), and use a start time like 19:30.", "warn")
            return _render(request, "lapse.html", {**data, "lapse_data": data}, status_code=400)

        phase = db.get_setting(conn, "phase")
        category = phase if phase in categories.LADDER else categories.LADDER[0]
        if_then = None
        if small_minutes > 0:
            if_then = rules.render_if_then(cue, category, task.strip()[:120] or None)
        reason_value = reason if reason in dict(LAPSE_REASONS) else None
        before = _g_before(conn)
        rules.record_lapse(conn, missed, reason_value, choice, if_then)

        if if_then and len(_plan_blocks(conn, today)) < db.get_setting(conn, "max_blocks_per_day"):
            rules.add_plan_block(conn, today, category, small_minutes, cue, task.strip()[:120] or None)

        saved = conn.execute("SELECT choice FROM lapses WHERE local_date = ?", (missed.isoformat(),)).fetchone()
        outcome = saved["choice"] if saved else choice
        events = _g_after(conn, before)
    if choice == "skip" and outcome == "let_go":
        msg = "No rest days were left this week, so this one is let go. Fresh start today."
    elif outcome == "skip":
        msg = "Marked as a rest day. Fresh start today."
    elif outcome == "repair":
        msg = "Repair window is open: reach the floor today and tomorrow and the day shows as repaired."
    else:
        msg = "Let go. Fresh start today."
    return _redirect("/", _flash_text(msg, events) if events and outcome == "skip" else msg, "ok")


# --------------------------------------------------------------------------
# Outputs ledger (World > Shelf)
# --------------------------------------------------------------------------

@router.get("/outputs")
def outputs_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    """The old Outputs page is the ledger on World > Shelf."""
    return _redirect("/world", msg, kind, anchor="shelf")


@router.post("/outputs/{output_id}/public")
def output_toggle_public(request: Request, output_id: int) -> Response:
    with _conn(request) as conn:
        conn.execute("UPDATE outputs SET is_public = 1 - is_public WHERE id = ?", (output_id,))
    return _redirect("/world", "Visibility updated.", "ok", anchor="shelf")


@router.post("/outputs/{output_id}/delete")
def output_delete(request: Request, output_id: int) -> Response:
    with _conn(request) as conn:
        _g_sync(conn)  # the XP mark keeps what was earned, even if an output is removed later
        conn.execute("UPDATE outputs SET deleted = 1 WHERE id = ?", (output_id,))
    return _redirect("/world", "Output removed.", "ok", anchor="shelf")


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------

class SettingField:
    """How one setting is shown and checked. `kind` picks the input and the validation."""

    def __init__(self, key: str, label: str, kind: str, low: int = 0, high: int = 0, help: str = "",
                 options: tuple[tuple[Any, str], ...] = ()) -> None:
        self.key, self.label, self.kind = key, label, kind
        self.low, self.high, self.help = low, high, help
        self.options = options  # (value, label) pairs for the "choice" and "cutoff" kinds


# The third star's goal (Settings > Floor, target and plans).
DEEP_STAR_CHOICES: tuple[tuple[int, str], ...] = ((180, "3 hours"), (240, "4 hours"), (300, "5 hours"), (360, "6 hours"))
# Sleep cutoff choices; "off" counts every minute. A saved custom time is added to the list when it is shown.
SLEEP_CUTOFF_CHOICES: tuple[tuple[str, str], ...] = (
    ("off", "Off (count every minute)"), ("23:00", "11:00 PM"), ("23:30", "11:30 PM"), ("00:00", "12:00 AM (midnight)"),
    ("00:30", "12:30 AM"), ("01:00", "1:00 AM"), ("01:30", "1:30 AM"), ("02:00", "2:00 AM"), ("02:30", "2:30 AM"),
    ("03:00", "3:00 AM"),
)


SETTING_GROUPS: list[tuple[str, list[SettingField]]] = [
    ("Your day", [
        SettingField("timezone", "Time zone", "tz", help="A name like Asia/Kolkata or America/New_York."),
        SettingField("day_start_hour", "A new day starts at (hour, 0 to 6)", "int", 0, 6,
                     "At the default 4, study at 1:30 AM Tuesday still counts for Monday, and Tuesday begins at 4:00 AM. "
                     "Use 0 for a plain midnight rollover."),
        SettingField("job_days", "Job days", "days"),
        SettingField("job_start", "Job starts", "time"),
        SettingField("job_end", "Job ends", "time"),
        SettingField("morning_time_weekday", "Morning card, weekdays", "time"),
        SettingField("morning_time_weekend", "Morning card, weekends", "time"),
        SettingField("study_start_weekday", "Study from, weekdays", "time"),
        SettingField("study_end_weekday", "Study until, weekdays", "time"),
        SettingField("study_start_weekend", "Study from, weekends", "time"),
        SettingField("study_end_weekend", "Study until, weekends", "time"),
        SettingField("bedtime", "Bedtime", "time"),
        SettingField("sleep_cutoff", "Sleep cutoff", "cutoff", options=SLEEP_CUTOFF_CHOICES,
                     help="Deep minutes after this time are still logged and shown, but don't count toward floors, the crown or XP. "
                          "Pick Off to count every minute."),
    ]),
    ("Floor, target and plans", [
        SettingField("floor_minutes", "Floor (deep minutes)", "int", 1, 600),
        SettingField("target_weekday_minutes", "Target on job days (minutes)", "int", 1, 1440),
        SettingField("target_weekend_minutes", "Target on other days (minutes)", "int", 1, 1440),
        SettingField("deep_cap_minutes", "Deep minutes counted per day, at most", "int", 30, 1440,
                     "Floors and XP stop at this (240 min = 16 floors)."),
        SettingField("deep_star_minutes", "Third star: deep focus per day", "choice", options=DEEP_STAR_CHOICES,
                     help="Today's three, third star: this much deep focus in one day. It is not limited by the cap above and gives no XP."),
        SettingField("skips_per_week", "Skips per week", "int", 0, 7),
        SettingField("max_blocks_per_day", "Plan blocks per day, at most", "int", 1, 8),
        SettingField("phase", "Current stage", "phase"),
    ]),
    ("Messages and helpers", [
        SettingField("msg_cap", "Proactive messages per day, at most", "int", 0, 10),
        SettingField("llm_daily_cap", "Free-model calls per day, at most", "int", 0, 1000),
        SettingField("referee_name", "Referee's name", "opttext"),
        SettingField("referee_chat_id", "Referee's Telegram chat id", "optint"),
        SettingField("silence_alert_ok", "Referee may get one note after 72 hours of silence", "bool"),
    ]),
]
SETTING_FIELDS = {field.key: field for _, fields in SETTING_GROUPS for field in fields}
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _form_values(settings: dict[str, Any]) -> dict[str, Any]:
    """Current settings as the strings/lists the template shows."""
    values: dict[str, Any] = {}
    for key, field in SETTING_FIELDS.items():
        value = settings.get(key)
        if field.kind == "days":
            values[key] = [int(v) for v in value or []]
        elif field.kind == "bool":
            values[key] = bool(value)
        else:
            values[key] = "" if value is None else str(value)
    return values


def _check_setting(field: SettingField, form: Any, current: Any) -> tuple[Any, str | None]:
    """Parse and validate one submitted setting. Returns (value, error)."""
    key, raw = field.key, form.get(field.key)
    text = str(raw).strip() if raw is not None else None
    if field.kind == "days":
        days = sorted({d for d in (_parse_int(v, 0, 6) for v in form.getlist(key)) if d is not None})
        return days, None
    if field.kind == "bool":
        return text in ("1", "on", "true", "yes"), None
    if text is None:  # field missing from the post: keep what is stored
        return current, None
    if field.kind == "tz":
        try:
            ZoneInfo(text)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            return current, f"{field.label}: '{text}' isn't a known time zone (try Asia/Kolkata)."
        return text, None
    if field.kind == "int":
        number = _parse_int(text, field.low, field.high)
        if number is None:
            return current, f"{field.label}: use a whole number from {field.low} to {field.high}."
        return number, None
    if field.kind == "time":
        clock = _valid_hhmm(text)
        return (clock, None) if clock else (current, f"{field.label}: use a time like 19:30.")
    if field.kind == "cutoff":
        if text.lower() in ("off", ""):
            return "off", None
        clock = _valid_hhmm(text)
        return (clock, None) if clock else (current, f"{field.label}: pick a time like 00:30, or Off.")
    if field.kind == "choice":
        number = _parse_int(text, 1, 100000)
        if number is None or number not in {value for value, _ in field.options}:
            return current, f"{field.label}: pick one of {', '.join(label for _, label in field.options)}."
        return number, None
    if field.kind == "phase":
        return (text, None) if text in categories.LADDER else (current, f"{field.label}: pick one of the stages.")
    if field.kind == "optint":
        if not text:
            return None, None
        try:
            return int(text), None
        except ValueError:
            return current, f"{field.label}: use the numeric chat id, or leave it empty."
    if field.kind == "opttext":
        return (text[:80] or None), None
    return current, None


def _game_values(conn: sqlite3.Connection) -> dict[str, Any]:
    values = {key: game.setting(conn, key) for key in GAME_KEYS}
    values["sky_tz"] = "local" if values["sky_tz"] in (None, "local") else "ny"
    return values


def _clean_game_settings(raw: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Validate game toggles. Returns (clean values, error hint)."""
    clean: dict[str, Any] = {}
    for key, value in raw.items():
        if key in GAME_BOOL_KEYS or key in GAME_BOOL_KEYS_V2:
            if isinstance(value, bool):
                clean[key] = value
            elif str(value).strip().lower() in ("1", "true", "on", "yes"):
                clean[key] = True
            elif str(value).strip().lower() in ("0", "false", "off", "no", ""):
                clean[key] = False
            else:
                return {}, f"{key}: use on or off."
        elif key in GAME_CHOICES:
            text = str(value).strip().lower()
            if key == "sky_tz" and text in ("newyork", "new_york", "nyc"):
                text = "ny"
            if text not in GAME_CHOICES[key]:
                return {}, f"{key}: pick one of {', '.join(GAME_CHOICES[key])}."
            clean[key] = text
        elif key == "confetti_daily_cap":
            number = _parse_int(value, 0, 20)
            if number is None:
                return {}, "confetti_daily_cap: use a number from 0 to 20."
            clean[key] = number
        elif key == "soundscape_volume":
            number = _parse_int(value, 0, 100)
            if number is None:
                return {}, "soundscape_volume: use a number from 0 to 100."
            clean[key] = number
        else:
            return {}, f"Unknown setting: {key}."
    return clean, None


def _save_game_settings(conn: sqlite3.Connection, clean: dict[str, Any]) -> None:
    with db.transaction(conn):
        for key, value in clean.items():
            db.set_setting(conn, key, value)


def settings_context(
    state: Any, conn: sqlite3.Connection, values: dict[str, Any] | None = None,
    msg: str | None = None, kind: str = "ok", errors: list[str] | None = None,
    rule_form: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = db.all_settings(conn)
    llm = getattr(state, "llm", None)
    config = state.config
    return {
        "active": "settings", "page": "settings", "msg": msg, "kind": kind, "errors": errors or [],
        "groups": SETTING_GROUPS, "values": values or _form_values(settings),
        "weekday_names": WEEKDAY_NAMES, "stages": categories.LADDER,
        "start_date": settings.get("start_date"),
        "game_values": _game_values(conn),
        "star_choices": DEEP_STAR_CHOICES,
        "helping": game.helping_report(conn),
        "status": {
            "telegram": config.telegram_enabled,
            "openrouter": config.llm_enabled and llm is not None,
            "models": list(config.openrouter_models),
            "calls_today": llm.calls_today() if llm is not None else 0,
            "calls_cap": settings["llm_daily_cap"],
            "aw": bool(state.aw.available()),
            "aw_url": config.activitywatch_url,
        },
        "aw_rules": activitywatch.load_rules(conn),
        "rule_fields": ("app", "title", "url"),
        "all_categories": categories.ALL,
        "rule_form": rule_form or {"field": "app", "pattern": "", "category": "Python", "deep": True, "priority": 100},
    }


@router.get("/settings")
def settings_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        context = settings_context(_state(request), conn, msg=flash, kind=flash_kind)
        context["lan"] = _lan_context(request, conn)
        context["soundscapes"] = SOUNDSCAPES
        return _render(request, "settings.html", context)


def _tower_how(request: Request) -> dict[str, Any]:
    """Numbers for the "How your tower grows" popover (templates/_tower_how.html), from the saved settings."""
    with _conn(request) as conn:
        return game.tower_howto(conn)


templates.env.globals["tower_how"] = _tower_how


def _rederive_output_days(conn: sqlite3.Connection, old: dict[str, Any], new: dict[str, Any]) -> None:
    """After the day boundary moves, keep shipped outputs on the day they were made.

    Entries are stored in UTC, so every day is re-cut from them on read. An output carries a stored local
    date; one that sat on the day its own timestamp fell on under the old boundary moves with the new one.
    An output that was deliberately dated otherwise is left alone.
    """
    for row in conn.execute("SELECT id, local_date, created_at FROM outputs").fetchall():
        try:
            made = timeutil.from_iso(row["created_at"])
        except (ValueError, TypeError):
            continue
        before = timeutil.local_date_of(made, old["timezone"], old["day_start_hour"]).isoformat()
        if row["local_date"] != before:
            continue
        after = timeutil.local_date_of(made, new["timezone"], new["day_start_hour"]).isoformat()
        if after != before:
            conn.execute("UPDATE outputs SET local_date = ? WHERE id = ?", (after, row["id"]))


@router.post("/settings")
async def settings_save(request: Request) -> Response:
    """Validate every field first; save nothing unless all of them are fine."""
    form = await request.form()
    state = _state(request)
    with _conn(request) as conn:
        current = db.all_settings(conn)
        new_values: dict[str, Any] = {}
        errors: list[str] = []
        for key, field in SETTING_FIELDS.items():
            value, error = _check_setting(field, form, current.get(key))
            new_values[key] = value
            if error:
                errors.append(error)
        cutoff = str(new_values.get("sleep_cutoff") or "off")
        if cutoff != "off" and not rules.valid_sleep_cutoff(cutoff, new_values.get("day_start_hour", 4)):
            errors.append(
                f"{SETTING_FIELDS['sleep_cutoff'].label}: {cutoff} doesn't fit a day that starts at "
                f"{int(new_values.get('day_start_hour', 4)):02d}:00. Pick a time in the late evening or after midnight, or Off.")
        if errors:
            shown = _form_values({**current, **new_values})
            for key, field in SETTING_FIELDS.items():  # show what was typed, so it can be fixed
                if form.get(key) is not None and field.kind not in ("days", "bool"):
                    shown[key] = str(form.get(key))
            context = settings_context(state, conn, shown, "Nothing was saved yet. Please fix the points below.", "warn", errors)
            return _render(request, "settings.html", context, status_code=400)

        with db.transaction(conn):
            for key, value in new_values.items():
                if value != current.get(key):
                    db.set_setting(conn, key, value)
            if new_values["day_start_hour"] != current.get("day_start_hour") or new_values["timezone"] != current.get("timezone"):
                _rederive_output_days(conn, current, new_values)
        if any(new_values[key] != current.get(key) for key in ("day_start_hour", "sleep_cutoff", "deep_star_minutes")):
            _g_sync(conn)  # days are recomputed on read; this just moves the XP ratchet and ledger up, never down
        llm = getattr(state, "llm", None)
        if llm is not None:
            llm.daily_cap = new_values["llm_daily_cap"]
    return _redirect("/settings", "Settings saved.", "ok")


@router.post("/settings/game")
async def settings_game_form(request: Request) -> Response:
    """No-JS route for the game toggles (with JavaScript each toggle saves itself through /api/settings/game)."""
    form = await request.form()
    raw: dict[str, Any] = {key: False for key in GAME_BOOL_KEYS}  # an unticked box is not sent
    for key in GAME_KEYS:
        if form.get(key) is not None:
            raw[key] = form.get(key)
    clean, error = _clean_game_settings(raw)
    if error:
        return _redirect("/settings", error, "warn", anchor="game")
    with _conn(request) as conn:
        _save_game_settings(conn, clean)
    return _redirect("/settings", "Game settings saved.", "ok", anchor="game")


@router.post("/settings/aw-rules")
def aw_rule_add(
    request: Request,
    field: str = Form(""),
    pattern: str = Form(""),
    category: str = Form(""),
    deep: str = Form(""),
    priority: str = Form("100"),
) -> Response:
    state = _state(request)
    with _conn(request) as conn:
        error = None
        rank = _parse_int(priority, 0, 1000)
        if field not in ("app", "title", "url"):
            error = "A rule looks at the app, the title or the url."
        elif not pattern.strip():
            error = "The pattern can't be empty."
        elif category not in categories.ALL:
            error = "Pick a category for the rule."
        elif rank is None:
            error = "Priority is a number from 0 to 1000 (lower runs first)."
        else:
            try:
                re.compile(pattern.strip())
            except re.error:
                error = "That pattern isn't a valid regular expression."
        if error:
            form = {"field": field or "app", "pattern": pattern, "category": category or "Python",
                    "deep": bool(deep), "priority": priority}
            context = settings_context(state, conn, msg=error, kind="warn", rule_form=form)
            return _render(request, "settings.html", context, status_code=400)
        conn.execute(
            "INSERT INTO aw_rules(field, pattern, category, deep, priority) VALUES (?, ?, ?, ?, ?)",
            (field, pattern.strip(), category, 1 if deep else 0, rank),
        )
    return _redirect("/settings", "Rule added.", "ok")


@router.post("/settings/aw-rules/{rule_id}/delete")
def aw_rule_delete(request: Request, rule_id: int) -> Response:
    with _conn(request) as conn:
        conn.execute("DELETE FROM aw_rules WHERE id = ?", (rule_id,))
    return _redirect("/settings", "Rule removed.", "ok")


# --------------------------------------------------------------------------
# JSON API (docs/game-design.md section 9.4)
# --------------------------------------------------------------------------

async def _json_body(request: Request) -> dict[str, Any]:
    """The request body as a dict ({} when it is missing or not JSON)."""
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _hint(text: str) -> JSONResponse:
    """A kind message instead of an error: HTTP 200 with ok:false, the text stays in the field."""
    return JSONResponse({"ok": False, "hint": text})


def _api_ok(conn: sqlite3.Connection, events: list[dict], toast: str | None = None, **extra: Any) -> JSONResponse:
    """The write response: {ok, toast, today, level, events[], ...}."""
    state = game.today_state(conn)
    body: dict[str, Any] = {
        "ok": True, "toast": toast if toast is not None else game.toast_text(events),
        "today": state["today"], "level": state["level"], "events": events,
    }
    body.update(extra)
    return JSONResponse(body)


@router.get("/api/today")
def api_today(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        data = game.today_state(conn)
        data["ok"] = True
        data["close_dot"] = bool(data["close"]["evening"] and not data["close"]["sealed"])
        return JSONResponse(data)


@router.get("/api/world")
def api_world(request: Request, days: str = "28") -> JSONResponse:
    """`days=N`: the last N days as whole Monday-to-Sunday rows (default 28, at most 84); `days=all`: every week since Day 1 (the year of lots)."""
    if days.strip().lower() in ("all", "year", "0"):
        n = 0
    else:
        try:
            n = max(1, min(84, int(days)))
        except ValueError:
            n = 28
    with _conn(request) as conn:
        return JSONResponse(game.world_state(conn, days=n))


@router.get("/api/shelf")
def api_shelf(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(game.shelf_state(conn))


def _api_log(state: Any, body: dict[str, Any]) -> JSONResponse:
    text = str(body.get("text") or "").strip()
    with db.get_conn(state.db_path) as conn:
        before = _g_before(conn)
        if text:
            entry, error = _new_typed_entry(conn, state, text)
        else:
            category = str(body.get("category") or "")
            if not category and _truthy(body.get("rest")):
                category = "Rest"
            entry, error = _new_live_entry(
                conn, category, body.get("minutes"), _truthy(body.get("deep")), str(body.get("note") or ""),
                body.get("plan_block_id") or "",
            )
        if entry is None:
            return _hint(error or UNREAD_HINT)
        events = _g_after(conn, before, entry=entry)
        return _api_ok(conn, events, entry=entry)


@router.post("/api/log")
async def api_log(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_log, _state(request), body)


def _api_outputs(state: Any, body: dict[str, Any]) -> JSONResponse:
    stage = str(body.get("stage") or "")
    with db.get_conn(state.db_path) as conn:
        before = _g_before(conn)
        output, error, _kind = _new_output(conn, stage, str(body.get("what") or ""), str(body.get("url") or ""))
        if output is None:
            return _hint(error or "That didn't save.")
        events = _g_after(conn, before, output={"stage": stage})
        return _api_ok(conn, events, output=output)


@router.post("/api/outputs")
async def api_outputs(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_outputs, _state(request), body)


def _api_focus_stop(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        message, kind, entry, events = _stop_focus(conn, str(body.get("outcome") or "full"))
        if kind != "ok" and entry is None and not message.startswith("Focus session cancelled"):
            return _hint(message)
        extra = {"entry": entry} if entry else {}
        return _api_ok(conn, events, toast=None if events else message, **extra)


@router.post("/api/focus/stop")
async def api_focus_stop(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_focus_stop, _state(request), body)


def _fog_for(conn: sqlite3.Connection, d: date) -> tuple[int, int]:
    """(remaining gaps, fog minutes) for a day: the unlogged stretches plus the minutes marked Unknown."""
    remaining = rules.gaps(conn, d)
    minutes = sum(timeutil.minutes_between(a, b) for a, b in remaining)
    try:
        for item in game.world_state(conn, days=7)["days"]:
            if item["date"] == d.isoformat():
                return len(remaining), int(item["fog_minutes"])
    except Exception:
        log.exception("fog minutes from world_state failed")
    return len(remaining), minutes


def _api_close_label(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        d = _parse_day(str(body.get("day") or ""), rules.today_local(conn))
        before = _g_before(conn)
        entry, error = _label_gap(
            conn, d, str(body.get("start") or ""), str(body.get("end") or ""), str(body.get("category") or ""),
            _truthy(body.get("deep")), str(body.get("source") or "backfill"),
        )
        if entry is None:
            return _hint(error or "Couldn't label that stretch. Try again.")
        events = _g_after(conn, before, entry=entry)
        remaining, fog = _fog_for(conn, d)
        return _api_ok(conn, events, remaining_gaps=remaining, fog_minutes=fog, entry=entry)


@router.post("/api/close/label")
async def api_close_label(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_close_label, _state(request), body)


def _api_close_seal(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        d = _parse_day(str(body.get("day") or ""), rules.today_local(conn))
        result, events = _seal(conn, d)
        if result is None:
            return _hint(_seal_hint(conn, d))
        return _api_ok(conn, events, toast=f"{_day_of(conn, d)} sealed.", recap=result["recap"], newly_sealed=result["newly_sealed"])


@router.post("/api/close/seal")
async def api_close_seal(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_close_seal, _state(request), body)


def _api_day_mark(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        target = _parse_day(str(body.get("day") or ""), rules.today_local(conn))
        message, kind, events = _mark_day(conn, target, str(body.get("kind") or "rest"), str(body.get("reason") or ""))
        if kind != "ok":
            return _hint(message)
        return _api_ok(conn, events, toast=game.toast_text(events) if events else message)


@router.post("/api/day-mark")
async def api_day_mark(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_day_mark, _state(request), body)


def _api_settings_game(state: Any, body: dict[str, Any]) -> JSONResponse:
    clean, error = _clean_game_settings(body)
    if error or not clean:
        return _hint(error or "Nothing to change.")
    with db.get_conn(state.db_path) as conn:
        _save_game_settings(conn, clean)
        return JSONResponse({"ok": True, "settings": _game_values(conn)})


@router.post("/api/settings/game")
async def api_settings_game(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_settings_game, _state(request), body)


# --------------------------------------------------------------------------
# v2: LAN / tablet mode, pairing and devices (docs/FEATURES-V2.md section 2)
# --------------------------------------------------------------------------

def _role(request: Request) -> str:
    return request.scope.get("witness.role", "owner")


def _owner_only(request: Request) -> JSONResponse | None:
    """A 403 for anything but the owner's computer (the guard already does this; this is the second lock)."""
    if _role(request) == "owner":
        return None
    return JSONResponse({"ok": False, "hint": "Only the computer running Epoch can do that.", "code": "owner_only"}, status_code=403)


def _owner_page_only(request: Request) -> Response | None:
    if _role(request) == "owner":
        return None
    return PlainTextResponse("Only the computer running Epoch can do that.", status_code=403)


def _lan_info(request: Request, conn: sqlite3.Connection) -> dict[str, Any]:
    state = _state(request)
    return lan.lan_info(state, conn, state.config.port)


def _lan_context(request: Request, conn: sqlite3.Connection) -> dict[str, Any] | None:
    """The LAN panel's data, or None for a device (it must not see other devices or pairing details)."""
    if _role(request) != "owner":
        return None
    return _lan_info(request, conn)


def _qr_payload(url: str) -> dict[str, Any]:
    matrix = qr.encode(url)
    return {"svg": qr.to_svg(matrix), "size": len(matrix), "modules": qr.to_rows(matrix)}


def _new_pairing(request: Request, conn: sqlite3.Connection) -> tuple[dict[str, Any] | None, str]:
    """Create a one-time pairing. Returns (payload, "") or (None, hint)."""
    state = _state(request)
    if not lan.lan_requested(state.config, conn):
        return None, "Turn on tablet mode first, then restart Epoch so it can be reached from the tablet."
    pairing = lan.create_pairing(conn)
    info = lan.lan_info(state, conn, state.config.port)
    base = lan.pair_base_url(state.config.port, request.headers.get("host"))
    url = f"{base}/pair?t={pairing['token']}"
    payload = {
        **pairing, "url": url, "pair_page": f"{base}/pair", "urls": info["urls"], "qr": _qr_payload(url),
        "restart_needed": info["restart_needed"],
    }
    return payload, ""


@router.get("/api/session")
def api_session(request: Request) -> JSONResponse:
    role = _role(request)
    device_id = request.scope.get("witness.device_id")
    with _conn(request) as conn:
        status = lan.lan_status(_state(request), conn)
        device = lan.device_row(conn, device_id) if device_id else None
    return JSONResponse({
        "ok": True, "role": role if role in ("owner", "device") else "guest",
        "device": {"id": device["id"], "name": device["name"]} if device else None,
        "lan": {k: status[k] for k in ("enabled", "active", "restart_needed")},
    })


@router.get("/api/lan")
def api_lan(request: Request) -> JSONResponse:
    denied = _owner_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        return JSONResponse({"ok": True, **_lan_info(request, conn)})


def _set_lan_enabled(conn: sqlite3.Connection, enabled: bool) -> None:
    with db.transaction(conn):
        db.set_setting(conn, "lan_enabled", enabled)


@router.post("/api/settings/lan")
async def api_settings_lan(request: Request) -> JSONResponse:
    denied = _owner_only(request)
    if denied:
        return denied
    body = await _json_body(request)
    if "enabled" not in body:
        return _hint("Tablet mode needs an on or off value.")
    with _conn(request) as conn:
        _set_lan_enabled(conn, _truthy(body["enabled"]))
        return JSONResponse({"ok": True, **_lan_info(request, conn)})


@router.post("/api/pair/new")
def api_pair_new(request: Request) -> JSONResponse:
    denied = _owner_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        payload, hint = _new_pairing(request, conn)
    if payload is None:
        return JSONResponse({"ok": False, "hint": hint, "code": "lan_off"})
    return JSONResponse({"ok": True, **payload})


PAIR_MESSAGES = {
    "rate_limited": "Too many wrong tries. Wait ten minutes, then ask for a new code on the computer.",
    "wrong_code": "That code didn't match. Check the six digits on the computer.",
    "invalid": "That pairing link has expired or was already used. Ask the computer for a new one.",
}


def _pair_page(request: Request, message: str | None = None, kind: str = "info", status_code: int = 200, token: str = "") -> Response:
    """The pairing page. It never touches the database: an unpaired device must see no data."""
    context = {"message": message, "kind": kind, "role": _role(request), "token": token}
    return templates.TemplateResponse(request, "pair.html", context, status_code=status_code)


def _redeem_pairing(request: Request, code: str | None, token: str | None, name: str | None) -> tuple[dict[str, Any] | None, str]:
    client = request.client.host if request.client else "?"
    with _conn(request) as conn:
        return lan.redeem(
            conn, code=code, token=token, user_agent=request.headers.get("user-agent", ""), ip=client, name=name,
        )


def _paired_redirect(result: dict[str, Any]) -> Response:
    response = RedirectResponse("/", status_code=303)
    response.headers.append("set-cookie", lan.cookie_header_value(result["cookie_token"]))
    return response


@router.get("/pair")
def pair_get(request: Request, t: str = "") -> Response:
    role = _role(request)
    if role == "device":
        return RedirectResponse("/", status_code=303)
    if role == "owner":
        return _pair_page(request, "This is the computer running Epoch. Open this page on the tablet.", "info", token=t)
    if t.strip():
        result, reason = _redeem_pairing(request, None, t.strip(), None)
        if result is None:
            return _pair_page(request, PAIR_MESSAGES.get(reason, PAIR_MESSAGES["invalid"]), "warn",
                              429 if reason == "rate_limited" else 400)
        return _paired_redirect(result)
    return _pair_page(request)


@router.post("/pair")
def pair_post(request: Request, code: str = Form(""), t: str = Form(""), name: str = Form("")) -> Response:
    role = _role(request)
    if role == "device":
        return RedirectResponse("/", status_code=303)
    if role == "owner":
        return _pair_page(request, "This is the computer running Epoch. Open this page on the tablet.", "info")
    result, reason = _redeem_pairing(request, code or None, t.strip() or None, name)
    if result is None:
        return _pair_page(request, PAIR_MESSAGES.get(reason, PAIR_MESSAGES["wrong_code"]), "warn",
                          429 if reason == "rate_limited" else 400, token=t)
    return _paired_redirect(result)


@router.post("/api/pair/redeem")
async def api_pair_redeem(request: Request) -> JSONResponse:
    if _role(request) == "owner":
        return _hint("This is the computer running Epoch. Pair from the tablet.")
    body = await _json_body(request)
    result, reason = await run_in_threadpool(
        _redeem_pairing, request, str(body.get("code") or "") or None, str(body.get("t") or body.get("token") or "") or None,
        str(body.get("name") or ""),
    )
    if result is None:
        return JSONResponse(
            {"ok": False, "hint": PAIR_MESSAGES.get(reason, PAIR_MESSAGES["wrong_code"]), "code": reason},
            status_code=429 if reason == "rate_limited" else 400,
        )
    response = JSONResponse({"ok": True, "device": result["device"]})
    response.headers.append("set-cookie", lan.cookie_header_value(result["cookie_token"]))
    return response


@router.get("/api/devices")
def api_devices(request: Request) -> JSONResponse:
    denied = _owner_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        return JSONResponse({"ok": True, "devices": lan.list_devices(conn)})


@router.post("/api/devices/{device_id}/revoke")
def api_device_revoke(request: Request, device_id: int) -> JSONResponse:
    denied = _owner_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        if not lan.revoke_device(conn, device_id):
            return _hint("That device is not paired (any more).")
    return JSONResponse({"ok": True})


@router.get("/settings/lan")
def lan_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    denied = _owner_page_only(request)
    if denied:
        return denied
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        return _render(request, "lan.html", {
            "active": "settings", "page": "settings", "msg": flash, "kind": flash_kind,
            "lan": _lan_info(request, conn), "pairing": None,
        })


@router.post("/settings/lan")
def lan_toggle(request: Request, enabled: str = Form("")) -> Response:
    denied = _owner_page_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        _set_lan_enabled(conn, _truthy(enabled))
    return _redirect("/settings/lan", "Saved. Restart Epoch to apply it.", "ok")


@router.post("/settings/lan/pair")
def lan_pair_form(request: Request) -> Response:
    denied = _owner_page_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        pairing, hint = _new_pairing(request, conn)
        return _render(request, "lan.html", {
            "active": "settings", "page": "settings", "msg": hint or None, "kind": "warn" if hint else "ok",
            "lan": _lan_info(request, conn), "pairing": pairing,
        })


@router.post("/settings/lan/devices/{device_id}/revoke")
def lan_revoke_form(request: Request, device_id: int) -> Response:
    denied = _owner_page_only(request)
    if denied:
        return denied
    with _conn(request) as conn:
        done = lan.revoke_device(conn, device_id)
    return _redirect("/settings/lan", "Device removed." if done else "That device is not paired any more.", "ok" if done else "info")


# --------------------------------------------------------------------------
# v2: Pomodoro (docs/FEATURES-V2.md section 3) and the live stream (section 4)
# --------------------------------------------------------------------------

POMODORO_ACTIONS = ("start", "pause", "resume", "skip-break", "stop", "rate", "discard", "next", "extend")


def _pomodoro_do(state: Any, action: str, body: dict[str, Any]) -> tuple[dict[str, Any] | None, pomodoro.PomodoroError | None]:
    """Run one Pomodoro command. Returns (result, None) or (None, error). `result` has `pomodoro` and, for rate, entry/events."""
    with db.get_conn(state.db_path) as conn:
        try:
            if action == "start":
                try:       # the study spot: the one asked for (it must be open), else the last one used
                    spot = cozy.use_spot(conn, body.get("spot"))
                except economy.EconomyError as exc:
                    return None, pomodoro.PomodoroError(exc.code, exc.hint)
                st = pomodoro.start(
                    conn, category=str(body.get("category") or ""), label=str(body.get("label") or ""),
                    preset=body.get("preset"), work_min=body.get("work_min"), break_min=body.get("break_min"),
                    cycles=body.get("cycles"), spot=spot,
                )
                return {"pomodoro": st}, None
            if action == "pause":
                return {"pomodoro": pomodoro.pause(conn)}, None
            if action == "resume":
                return {"pomodoro": pomodoro.resume(conn)}, None
            if action == "skip-break":
                return {"pomodoro": pomodoro.skip_break(conn)}, None
            if action == "stop":
                return {"pomodoro": pomodoro.stop(conn, discard=_truthy(body.get("discard")))}, None
            if action == "discard":
                return {"pomodoro": pomodoro.discard_block(conn, body.get("block_id"))}, None
            if action == "next":
                return {"pomodoro": pomodoro.start_next(conn)}, None
            if action == "extend":
                return {"pomodoro": pomodoro.extend(conn, body.get("minutes"))}, None
            result = pomodoro.rate(
                conn, focus=str(body.get("focus") or ""), block_id=body.get("block_id"),
                category=str(body.get("category") or "") or None, note=str(body.get("note") or ""),
            )
            game_state = game.today_state(conn)
            result.update(today=game_state["today"], level=game_state["level"])
            return result, None
        except pomodoro.PomodoroError as exc:
            return None, exc


def _pomodoro_json(state: Any, action: str, body: dict[str, Any]) -> JSONResponse:
    result, error = _pomodoro_do(state, action, body)
    if error is not None:
        return JSONResponse({"ok": False, "hint": error.hint, "code": error.code})
    payload: dict[str, Any] = {"ok": True, **result}
    if action == "rate":
        payload["toast"] = game.toast_text(result["events"]) or f"Logged {result['entry']['category']}."
    return JSONResponse(payload)


def _make_pomodoro_api(action: str):
    async def handler(request: Request) -> JSONResponse:
        body = await _json_body(request)
        return await run_in_threadpool(_pomodoro_json, _state(request), action, body)
    handler.__name__ = "api_pomodoro_" + action.replace("-", "_")
    return handler


for _action in POMODORO_ACTIONS:
    router.add_api_route(f"/api/pomodoro/{_action}", _make_pomodoro_api(_action), methods=["POST"])


@router.get("/api/pomodoro")
def api_pomodoro(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(pomodoro.get_state(conn))


@router.get("/pomodoro")
def pomodoro_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        context = {
            "active": "today", "page": "pomodoro", "msg": flash, "kind": flash_kind,
            "pomodoro": pomodoro.get_state(conn), "quick_categories": QUICK_CATEGORIES, "presets": pomodoro.PRESETS,
            "custom_limits": pomodoro.CUSTOM_LIMITS, "extend_choices": pomodoro.EXTEND_CHOICES,
            "focus_outcomes": FOCUS_OUTCOMES,
            "default_category": db.get_setting(conn, "phase") if db.get_setting(conn, "phase") in categories.LADDER else categories.LADDER[0],
        }
        return _render(request, "pomodoro.html", context)


def _make_pomodoro_form(action: str):
    def handler(
        request: Request, category: str = Form(""), label: str = Form(""), preset: str = Form(""), work_min: str = Form(""),
        break_min: str = Form(""), cycles: str = Form(""), discard: str = Form(""), focus: str = Form(""),
        block_id: str = Form(""), note: str = Form(""), minutes: str = Form(""),
    ) -> Response:
        body = {
            "category": category, "label": label, "preset": preset, "work_min": work_min, "break_min": break_min,
            "cycles": cycles, "discard": discard, "focus": focus, "block_id": block_id, "note": note, "minutes": minutes,
        }
        result, error = _pomodoro_do(_state(request), action, body)
        if error is not None:
            return _redirect("/pomodoro", error.hint, "warn")
        if action == "rate":
            return _redirect("/pomodoro", _flash_text(f"Logged {result['entry']['category']}.", result["events"]), "ok")
        return _redirect("/pomodoro", {"start": "Started.", "pause": "Paused.", "resume": "Back to it.",
                                       "skip-break": "Break ended. Back to work.", "stop": "Stopped.",
                                       "discard": "Dropped. Nothing was logged.", "next": "On we go.",
                                       "extend": f"Added {minutes or 'a few'} min."}[action], "ok")
    handler.__name__ = "pomodoro_form_" + action.replace("-", "_")
    return handler


for _action in POMODORO_ACTIONS:
    router.add_api_route(f"/pomodoro/{_action}", _make_pomodoro_form(_action), methods=["POST"])


STREAM_PING_SECONDS = 15.0
STREAM_STATE_SECONDS = 30.0


def _pomodoro_state_for(state: Any) -> dict[str, Any]:
    with db.get_conn(state.db_path) as conn:
        return pomodoro.get_state(conn)


def _stream_still_allowed(state: Any, request: Request) -> bool:
    """Re-run the LAN guard for a long-lived stream, so a revoked device (or LAN mode switched off) is cut off."""
    if request.scope.get("witness.role") != "device":
        return True
    decision = lan.decide(
        state, method="GET", path=request.url.path, host=request.headers.get("host", ""), origin=None,
        cookie=request.headers.get("cookie", ""), client=request.client.host if request.client else None, wants_html=False,
    )
    return decision.action == "allow" and decision.role == "device"


async def _event_stream(state: Any, limit: int, request: Request | None = None):
    """The Server-Sent-Events body: pomodoro state on connect and on change, game events, pings."""
    sub = live.hub.subscribe()
    last_auth = time.monotonic()
    count = 0
    try:
        yield "retry: 3000\n\n"
        current = await run_in_threadpool(_pomodoro_state_for, state)
        yield live.sse("pomodoro", current)
        count += 1
        last_rev, last_state_at, last_out = current["rev"], time.monotonic(), time.monotonic()
        while not limit or count < limit:
            wait = STREAM_PING_SECONDS
            due = pomodoro.next_change_in(current)
            if due is not None:
                wait = min(wait, max(0.2, due + 0.3))
            try:
                event, data = await asyncio.wait_for(sub.queue.get(), timeout=wait)
            except asyncio.TimeoutError:
                event, data = None, None
            if request is not None and time.monotonic() - last_auth >= STREAM_PING_SECONDS:
                last_auth = time.monotonic()
                if not await run_in_threadpool(_stream_still_allowed, state, request):
                    break
            if event == "game":
                yield live.sse("game", data, data.get("seq"))
                count += 1
                last_out = time.monotonic()
            current = await run_in_threadpool(_pomodoro_state_for, state)
            now = time.monotonic()
            if event == "pomodoro" or current["rev"] != last_rev or now - last_state_at >= STREAM_STATE_SECONDS:
                yield live.sse("pomodoro", current)
                count += 1
                last_rev, last_state_at, last_out = current["rev"], now, now
            elif now - last_out >= STREAM_PING_SECONDS:
                yield live.sse("ping", {"t": db.utc_now_iso()})
                count += 1
                last_out = now
    finally:
        live.hub.unsubscribe(sub)


@router.get("/api/stream")
async def api_stream(request: Request, limit: int = 0) -> StreamingResponse:
    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    return StreamingResponse(
        _event_stream(_state(request), max(0, min(1000, limit)), request), media_type="text/event-stream", headers=headers
    )


# --------------------------------------------------------------------------
# v2: weather, seasonal decorations, flow, subway (sections 5-8)
# --------------------------------------------------------------------------

@router.get("/api/weather")
def api_weather(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(weather.get_weather(conn))


@router.get("/api/seasonal")
def api_seasonal(request: Request, date: str = "") -> JSONResponse:
    with _conn(request) as conn:
        today = rules.today_local(conn)
        day = _parse_day(date, today)
        return JSONResponse({"ok": True, "date": day.isoformat(), "seasonal": game.seasonal_for(conn, day)})


@router.get("/api/flow")
def api_flow(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse({"ok": True, **game.flow(conn)})


@router.get("/api/subway")
def api_subway(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse({"ok": True, **game.subway(conn)})


# --------------------------------------------------------------------------
# v2: postcards and the nightly skyline (sections 9-10): PNGs made on the client's canvas
# --------------------------------------------------------------------------

MAX_PNG_BYTES = 4 * 1024 * 1024
MAX_UPLOAD_BODY = 6 * 1024 * 1024        # base64 in JSON is about 4/3 of the PNG, plus a little
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_END = b"IEND\xaeB`\x82"
PNG_SIDE = (16, 4096)
POSTCARD_KINDS = ("weekly", "day")
POSTCARD_ID = re.compile(r"^(weekly|day)-\d{4}-\d{2}-\d{2}$")
SKYLINE_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class UploadError(Exception):
    def __init__(self, status: int, code: str, hint: str) -> None:
        super().__init__(hint)
        self.status, self.code, self.hint = status, code, hint


def png_size(data: bytes) -> tuple[int, int]:
    """(width, height) of a PNG, or UploadError. Checks the signature, the IHDR chunk, the size and the IEND tail."""
    if len(data) > MAX_PNG_BYTES:
        raise UploadError(413, "too_large", "That image is bigger than 4 MB.")
    if len(data) < 45 or not data.startswith(PNG_MAGIC):
        raise UploadError(400, "not_png", "That file is not a PNG image.")
    length, kind = struct.unpack(">I4s", data[8:16])
    if length != 13 or kind != b"IHDR":
        raise UploadError(400, "not_png", "That file is not a PNG image.")
    width, height = struct.unpack(">II", data[16:24])
    if not (PNG_SIDE[0] <= width <= PNG_SIDE[1] and PNG_SIDE[0] <= height <= PNG_SIDE[1]):
        raise UploadError(400, "bad_size", f"The image must be between {PNG_SIDE[0]} and {PNG_SIDE[1]} pixels on each side.")
    if not data.endswith(PNG_END):
        raise UploadError(400, "not_png", "That PNG looks cut off.")
    return width, height


async def _limited_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise UploadError(413, "too_large", "That upload is too big.")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise UploadError(413, "too_large", "That upload is too big.")
        chunks.append(chunk)
    return b"".join(chunks)


async def _read_png_upload(request: Request) -> tuple[bytes, dict[str, str]]:
    """The PNG bytes and the other fields, from JSON {png_base64, ...} or multipart (file + fields)."""
    ctype = request.headers.get("content-type", "").lower()
    if ctype.startswith("multipart/form-data"):
        declared = request.headers.get("content-length", "")
        if not declared.isdigit() or int(declared) > MAX_UPLOAD_BODY:
            raise UploadError(413, "too_large", "That upload is too big.")
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise UploadError(400, "no_file", "Add the PNG as the \"file\" field.")
        data = await upload.read(MAX_PNG_BYTES + 1)
        fields = {k: str(v) for k, v in form.items() if isinstance(v, str)}
        return data, fields
    raw = await _limited_body(request, MAX_UPLOAD_BODY)
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise UploadError(400, "bad_json", "Send JSON with a png_base64 field, or a multipart form.") from None
    if not isinstance(body, dict):
        raise UploadError(400, "bad_json", "Send JSON with a png_base64 field, or a multipart form.")
    text = str(body.get("png_base64") or "").strip()
    if text.startswith("data:"):
        text = text.partition(",")[2]
    if not text:
        raise UploadError(400, "no_file", "Add the image as png_base64.")
    if len(text) > MAX_PNG_BYTES * 4 // 3 + 16:
        raise UploadError(413, "too_large", "That image is bigger than 4 MB.")
    try:
        data = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise UploadError(400, "bad_base64", "That image data is not valid base64.") from None
    return data, {k: str(v) for k, v in body.items() if k != "png_base64"}


def _upload_error(exc: UploadError) -> JSONResponse:
    return JSONResponse({"ok": False, "hint": exc.hint, "code": exc.code}, status_code=exc.status)


def _write_png(folder: Path, filename: str, data: bytes) -> Path:
    """Write atomically inside `folder`. `filename` is built by us from validated parts, never from the request."""
    folder.mkdir(parents=True, exist_ok=True)
    target = (folder / filename)
    if target.resolve().parent != folder.resolve() or not re.fullmatch(r"[A-Za-z0-9._-]+\.png", filename):
        raise UploadError(400, "bad_name", "That name is not allowed.")
    temp = folder / f".{filename}.{os.getpid()}.tmp"
    temp.write_bytes(data)
    os.replace(temp, target)
    return target


def _period_date(text: str) -> date | None:
    """YYYY-MM-DD or an ISO week like 2026-W42 (its Monday)."""
    text = (text or "").strip()
    match = re.fullmatch(r"(\d{4})-W(\d{2})", text)
    try:
        if match:
            return date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
        parsed = date.fromisoformat(text)
    except ValueError:
        return None
    return parsed if EARLIEST_DAY <= parsed <= LATEST_DAY else None


def _postcard_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "kind": row["kind"], "period": row["period"], "created_utc": row["created_utc"],
        "bytes": row["bytes"], "width": row["width"], "height": row["height"], "url": f"/postcards/{row['id']}.png",
    }


def _list_postcards(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return [_postcard_dict(r) for r in conn.execute("SELECT * FROM postcards ORDER BY period DESC, created_utc DESC")]


DEVICE_UPLOAD_WINDOW_DAYS = 14      # a paired device may only (re)make cards and skylines for the last two weeks


def _device_may_date(state: Any, period: date) -> bool:
    """A paired tablet can only write recent files, so a lost one cannot fill the disk with date-keyed PNGs."""
    with db.get_conn(state.db_path) as conn:
        today = rules.today_local(conn)
    return today - timedelta(days=DEVICE_UPLOAD_WINDOW_DAYS) <= period <= today + timedelta(days=1)


def _save_postcard(state: Any, data: bytes, fields: dict[str, str], role: str = "owner") -> JSONResponse:
    kind = fields.get("kind", "")
    if kind not in POSTCARD_KINDS:
        raise UploadError(400, "bad_kind", "Kind must be weekly or day.")
    period = _period_date(fields.get("period", ""))
    if period is None:
        raise UploadError(400, "bad_period", "Period must be a date like 2026-10-12.")
    if kind == "weekly":
        period = timeutil.week_monday(period)
    if role == "device" and not _device_may_date(state, period if kind == "day" else period + timedelta(days=6)):
        raise UploadError(403, "too_old", "A paired device can only make recent postcards.")
    width, height = png_size(data)
    card_id = f"{kind}-{period.isoformat()}"
    _write_png(state.config.data_dir / "postcards", f"{card_id}.png", data)
    with db.get_conn(state.db_path) as conn:
        conn.execute(
            "INSERT INTO postcards(id, kind, period, created_utc, bytes, width, height) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET created_utc = excluded.created_utc, bytes = excluded.bytes, "
            "width = excluded.width, height = excluded.height",
            (card_id, kind, period.isoformat(), db.utc_now_iso(), len(data), width, height),
        )
        row = conn.execute("SELECT * FROM postcards WHERE id = ?", (card_id,)).fetchone()
    return JSONResponse({"ok": True, "postcard": _postcard_dict(row)})


@router.post("/api/postcards")
async def api_postcards_upload(request: Request) -> JSONResponse:
    try:
        data, fields = await _read_png_upload(request)
        return await run_in_threadpool(_save_postcard, _state(request), data, fields, request.scope.get("witness.role", "owner"))
    except UploadError as exc:
        return _upload_error(exc)


@router.get("/api/postcards")
def api_postcards(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse({"ok": True, "postcards": _list_postcards(conn)})


@router.get("/postcards/{card_id}.png")
def postcard_file(request: Request, card_id: str, inline: int = 0) -> Response:
    if not POSTCARD_ID.fullmatch(card_id):
        return PlainTextResponse("Not found.", status_code=404)
    with _conn(request) as conn:
        known = conn.execute("SELECT 1 FROM postcards WHERE id = ?", (card_id,)).fetchone()
    path = _state(request).config.data_dir / "postcards" / f"{card_id}.png"
    if not known or not path.is_file():
        return PlainTextResponse("Not found.", status_code=404)
    headers = {} if inline else {"Content-Disposition": f'attachment; filename="epoch-{card_id}.png"'}
    return FileResponse(path, media_type="image/png", headers=headers)


@router.get("/postcards")
def postcards_page(request: Request, msg: str = "", kind: str = "ok") -> Response:
    flash, flash_kind = _clean_flash(msg, kind)
    with _conn(request) as conn:
        today = rules.today_local(conn)
        monday = timeutil.week_monday(today).isoformat()
        cards = _list_postcards(conn)
        return _render(request, "postcards.html", {
            "active": "world", "page": "postcards", "msg": flash, "kind": flash_kind, "postcards": cards,
            "week_monday": monday, "week_done": any(c["kind"] == "weekly" and c["period"] == monday for c in cards),
        })


def _skyline_dict(day: str, size: int) -> dict[str, Any]:
    return {"day": day, "url": f"/skylines/{day}.png", "bytes": size}


def _save_skyline(
    state: Any, data: bytes, fields: dict[str, str], role: str = "owner"
) -> tuple[dict[str, Any], str | None, bool]:
    """Store the PNG. Returns (skyline dict, Telegram caption when it should be sent, already_sent)."""
    with db.get_conn(state.db_path) as conn:
        today = rules.today_local(conn)
        day = _parse_day(fields.get("day"), today)
        if fields.get("day") and _period_date(fields.get("day", "")) is None:
            raise UploadError(400, "bad_day", "Day must be a date like 2026-10-17.")
        if role == "device" and not _device_may_date(state, day):
            raise UploadError(403, "too_old", "A paired device can only make recent skylines.")
        png_size(data)
        _write_png(state.config.data_dir / "skylines", f"{day.isoformat()}.png", data)
        conn.execute(
            "INSERT INTO skylines(local_date, created_utc, bytes) VALUES (?, ?, ?) "
            "ON CONFLICT(local_date) DO UPDATE SET created_utc = excluded.created_utc, bytes = excluded.bytes",
            (day.isoformat(), db.utc_now_iso(), len(data)),
        )
        row = conn.execute("SELECT sent_utc FROM skylines WHERE local_date = ?", (day.isoformat(),)).fetchone()
        caption = None
        if not row["sent_utc"]:
            try:
                recap = game.day_recap(conn, day)
                caption = f"Epoch · {_day_of(conn, day)} · {timeutil.short_day(day)} · {recap['headline']}"
            except Exception:
                log.exception("could not build the skyline caption")
                caption = f"Epoch · {timeutil.short_day(day)}"
    return _skyline_dict(day.isoformat(), len(data)), caption, bool(row["sent_utc"])


async def _send_skyline(state: Any, day: str, data: bytes, caption: str) -> str:
    """Send to Telegram once per day. Returns sent | not_sent | not_configured. Never raises."""
    if getattr(state, "telegram_app", None) is None or not getattr(state.config, "telegram_user_id", None):
        return "not_configured"
    try:
        from .. import telegram_bot

        message_id = await telegram_bot.send_photo(state, data, caption)
    except Exception:
        log.exception("sending the skyline failed")
        return "not_sent"
    if message_id is None:
        return "not_sent"
    with db.get_conn(state.db_path) as conn:
        conn.execute("UPDATE skylines SET sent_utc = ? WHERE local_date = ?", (db.utc_now_iso(), day))
    return "sent"


@router.post("/api/skyline")
async def api_skyline(request: Request) -> JSONResponse:
    state = _state(request)
    try:
        data, fields = await _read_png_upload(request)
        skyline, caption, already_sent = await run_in_threadpool(
            _save_skyline, state, data, fields, request.scope.get("witness.role", "owner"))
    except UploadError as exc:
        return _upload_error(exc)
    if already_sent:
        status = "skipped"
    else:
        status = await _send_skyline(state, skyline["day"], data, caption or "")
    return JSONResponse({"ok": True, "skyline": {**skyline, "telegram": status}})


@router.get("/api/skylines")
def api_skylines(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        rows = conn.execute("SELECT local_date, bytes FROM skylines ORDER BY local_date DESC").fetchall()
    return JSONResponse({"ok": True, "skylines": [_skyline_dict(r["local_date"], r["bytes"]) for r in rows]})


@router.get("/skylines/{day}.png")
def skyline_file(request: Request, day: str, inline: int = 0) -> Response:
    if not SKYLINE_DAY.fullmatch(day):
        return PlainTextResponse("Not found.", status_code=404)
    with _conn(request) as conn:
        known = conn.execute("SELECT 1 FROM skylines WHERE local_date = ?", (day,)).fetchone()
    path = _state(request).config.data_dir / "skylines" / f"{day}.png"
    if not known or not path.is_file():
        return PlainTextResponse("Not found.", status_code=404)
    headers = {} if inline else {"Content-Disposition": f'attachment; filename="epoch-skyline-{day}.png"'}
    return FileResponse(path, media_type="image/png", headers=headers)


# --------------------------------------------------------------------------
# Money: earnings, rent, homes, the shop (docs/ECONOMY.md). Business refusals answer 200 {ok: false, hint, code} like the other
# JSON routes, so the page can show the calm sentence as it is.
# --------------------------------------------------------------------------

def _econ_weather(conn: sqlite3.Connection) -> dict[str, Any] | None:
    """The cached NYC weather for the snow-day event (never raises; None when offline or switched off)."""
    try:
        reading = weather.get_weather(conn)
    except Exception:
        return None
    return reading if reading.get("available") else None


def _econ_error(exc: economy.EconomyError) -> JSONResponse:
    return JSONResponse({"ok": False, "hint": exc.hint, "code": exc.code, **exc.extra})


@router.get("/api/economy")
def api_economy(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(economy.economy_state(conn, wx=_econ_weather(conn)))


@router.get("/api/shop")
def api_shop(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(economy.shop_state(conn, wx=_econ_weather(conn)))


def _api_shop_buy(state: Any, body: dict[str, Any]) -> JSONResponse:
    price = _parse_int(body.get("price"), 0, 10_000_000) if body.get("price") not in (None, "") else None
    token = str(body.get("token") or "").strip() or None
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(economy.buy(conn, str(body.get("item") or ""), price, token, wx=_econ_weather(conn)))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/shop/buy")
async def api_shop_buy(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_shop_buy, _state(request), body)


def _api_home_move(state: Any, body: dict[str, Any]) -> JSONResponse:
    token = str(body.get("token") or "").strip() or None
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(economy.move_home(conn, str(body.get("home") or ""), token))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/home/move")
async def api_home_move(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_home_move, _state(request), body)


def _api_equip(state: Any, body: dict[str, Any]) -> JSONResponse:
    slot = body.get("slot")
    if slot is not None and (isinstance(slot, bool) or not isinstance(slot, int)):
        slot = _parse_int(slot, 0, 99)
    on = body.get("on", True)
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(economy.equip(conn, str(body.get("kind") or ""), str(body.get("item") or ""), _truthy(on), slot))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/equip")
async def api_equip(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_equip, _state(request), body)


# --------------------------------------------------------------------------
# The cozy life sim (docs/COZY.md): free placement in the home, study spots, daily missions and the chest. Same rules as the money
# routes above: same-origin POSTs, and a business refusal answers 200 {ok: false, hint, code, ...}.
# --------------------------------------------------------------------------

@router.get("/api/home/layout")
def api_home_layout(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(economy.layout_state(conn))


def _api_home_layout_save(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(economy.save_layout(conn, body.get("items")))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/home/layout")
async def api_home_layout_save(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_home_layout_save, _state(request), body)


@router.get("/api/missions")
def api_missions(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(cozy.missions_state(conn))


def _api_chest_open(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(cozy.open_chest(conn, body.get("date")))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/chest/open")
async def api_chest_open(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_chest_open, _state(request), body)


@router.get("/api/spots")
def api_spots(request: Request) -> JSONResponse:
    with _conn(request) as conn:
        return JSONResponse(cozy.spots_state(conn))


def _api_spots_select(state: Any, body: dict[str, Any]) -> JSONResponse:
    with db.get_conn(state.db_path) as conn:
        try:
            return JSONResponse(cozy.select_spot(conn, body.get("spot")))
        except economy.EconomyError as exc:
            return _econ_error(exc)


@router.post("/api/spots/select")
async def api_spots_select(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_spots_select, _state(request), body)


# --------------------------------------------------------------------------
# Money pages: Money (wallet + rent-day recap), NYC Store, Passport, Home. Server-rendered from economy.economy_state / shop_state;
# static/app/money.js does the two-step buying, equipping and moving over the JSON routes above. Quiet mode shows a calm note instead.
# --------------------------------------------------------------------------

MONEY_TABS = (("money", "/money", "Money"), ("store", "/store", "NYC Store"), ("passport", "/passport", "Passport"), ("home", "/home", "Home"))


def _money_page(request: Request, template: str, page: str, shop: bool = False, **extra: Any) -> Response:
    with _conn(request) as conn:
        wx = _econ_weather(conn)
        eco = economy.economy_state(conn, wx=wx)
        context: dict[str, Any] = {"active": "money", "page": page, "eco": eco, "quiet": bool(eco.get("quiet")), "money_tabs": MONEY_TABS}
        if shop and not context["quiet"]:
            context["shop"] = economy.shop_state(conn, wx=wx)
        context.update(extra)
        return _render(request, template, context)


@router.get("/money")
def money_page(request: Request) -> Response:
    return _money_page(request, "money.html", "money")


@router.get("/store")
def store_page(request: Request) -> Response:
    return _money_page(request, "store.html", "store", shop=True)


@router.get("/passport")
def passport_page(request: Request) -> Response:
    return _money_page(request, "passport.html", "passport", shop=True)


@router.get("/home")
def home_page(request: Request) -> Response:
    return _money_page(request, "home.html", "home")


def _api_settings_star(state: Any, body: dict[str, Any]) -> JSONResponse:
    minutes = _parse_int(body.get("minutes", body.get("deep_star_minutes")), 1, 1440)
    if minutes not in dict(DEEP_STAR_CHOICES):
        return _hint("Pick 3, 4, 5 or 6 hours for the third star.")
    with db.get_conn(state.db_path) as conn:
        with db.transaction(conn):
            db.set_setting(conn, "deep_star_minutes", minutes)
        _g_sync(conn)  # days are recomputed on read; this only moves the banked rows and the XP ratchet up, never down
        return JSONResponse({"ok": True, "deep_star_minutes": minutes, "hours": minutes // 60})


@router.post("/api/settings/star")
async def api_settings_star(request: Request) -> JSONResponse:
    body = await _json_body(request)
    return await run_in_threadpool(_api_settings_star, _state(request), body)


# --------------------------------------------------------------------------
# App factory
# --------------------------------------------------------------------------

def _default_state() -> Any:
    """Build the shared state from the environment (used when create_app gets no state)."""
    config = load_config()
    db.init_db(config.db_path)
    aw = activitywatch.AWClient(config.activitywatch_url)
    llm = None
    if config.llm_enabled:
        with db.get_conn(config.db_path) as conn:
            cap = db.get_setting(conn, "llm_daily_cap")
        llm = llm_module.OpenRouterClient(
            config.openrouter_api_key, config.openrouter_models, config.db_path, daily_cap=cap
        )
    try:
        from ..main import AppState  # written by another module; fall back if it isn't there
        return AppState(config=config, db_path=config.db_path, telegram_app=None, aw=aw, llm=llm)
    except Exception:
        return SimpleNamespace(config=config, db_path=config.db_path, telegram_app=None, aw=aw, llm=llm)


def create_app(state: Any = None) -> FastAPI:
    """Build the FastAPI app. `state` carries config, db_path, telegram_app, aw and llm."""
    app = FastAPI(title="Epoch", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.witness = state if state is not None else _default_state()
    static_dir = WEB_DIR / "static"
    version = asset_version(static_dir)
    # Versioned first: Mount("/static") would otherwise swallow /static/v/... paths.
    app.mount(f"/static/v/{version}", RevalidatedStaticFiles(directory=str(static_dir)), name="static-versioned")
    app.mount("/static", RevalidatedStaticFiles(directory=str(static_dir)), name="static")
    templates.env.globals["asset_base"] = f"/static/v/{version}"
    app.state.hub = live.hub

    # Host allowlist, cross-site check and the owner / paired-device rule (pure ASGI: streams pass untouched).
    app.add_middleware(lan.LanGuard, get_state=lambda: app.state.witness)

    app.include_router(router)
    return app
