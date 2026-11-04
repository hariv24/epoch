"""Turn a typed log line such as "1h30 math LA 2.1" into a ParsedLog.

Two steps:
1. `parse_log` uses plain regular expressions (free, instant, no network).
2. `parse_log_smart` falls back to a free LLM only when the regex cannot parse the line.

Only the text the user typed is ever sent to the LLM.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any

from . import categories, timeutil

MIN_MINUTES = 1
MAX_MINUTES = 600
MAX_LLM_INPUT_CHARS = 300
DEFAULT_TIMEZONE = "Asia/Kolkata"


@dataclass
class ParsedLog:
    """One logged stretch of time. The entry runs from `start_utc` for `minutes`."""

    category: str
    minutes: int
    note: str
    deep: bool
    start_utc: datetime | None  # always set by the parsers below; None means "ends now"


# ---------------------------------------------------------------------------
# Category and deep/shallow
# ---------------------------------------------------------------------------

def _keyword_regex(keyword: str) -> re.Pattern[str]:
    """Word-boundary regex for a keyword. Long keywords also match a plural ("papers")."""
    plural = "(?:s|es)?" if len(keyword) >= 4 else ""
    return re.compile(r"(?<![a-z0-9])" + re.escape(keyword) + plural + r"(?![a-z0-9])")


_KEYWORD_REGEXES = [(_keyword_regex(word), cat) for word, cat in categories.KEYWORDS]
_SHALLOW_RE = re.compile(r"(?<![a-z0-9])(?:shallow|distracted)(?![a-z0-9])", re.IGNORECASE)


def detect_category(text: str) -> str | None:
    """The category implied by the first matching keyword in `categories.KEYWORDS`, or None."""
    lowered = text.lower()
    for regex, category in _KEYWORD_REGEXES:
        if regex.search(lowered):
            return category
    return None


def default_deep(category: str) -> bool:
    """Ladder work (and the early "Tracker build" phase) is deep unless the user says otherwise."""
    return categories.is_ladder(category) or category == "Tracker build"


# ---------------------------------------------------------------------------
# Clock times: "at 18:30", "18:30-19:15", "at 6pm"
# ---------------------------------------------------------------------------

_PREFIX = r"(?:\b(?:at|from)\s+|@\s*)"
_CLOCK = r"(\d{1,2}):(\d{2})\s*(am|pm)?"
_RANGE_RE = re.compile(
    _PREFIX + "?" + _CLOCK + r"\s*(?:-|–|—|to|until)\s*" + _CLOCK + r"(?![a-z0-9])",
    re.IGNORECASE,
)
_AT_RE = re.compile(_PREFIX + r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![a-z0-9])", re.IGNORECASE)


def _to_clock(hour: str, minute: str | None, ampm: str | None) -> time | None:
    """Build a time of day, or None if the numbers are not a valid clock time."""
    h, m = int(hour), int(minute or 0)
    if not 0 <= m <= 59:
        return None
    if ampm:
        if not 1 <= h <= 12:
            return None
        h = h % 12 + (12 if ampm.lower() == "pm" else 0)
    elif not 0 <= h <= 23:
        return None
    return time(h, m)


def _minutes_of_day(clock: time) -> int:
    return clock.hour * 60 + clock.minute


def _cut(text: str, match: re.Match[str]) -> str:
    """The text with the matched span replaced by a space."""
    return text[: match.start()] + " " + text[match.end():]


@dataclass
class _ClockHint:
    """A time the user typed: a start time, and the length too if they typed a range."""

    start: time | None = None
    range_minutes: int | None = None


def _extract_clock(text: str) -> tuple[str, _ClockHint]:
    """Pull a range ("18:30-19:15") or a start ("at 18:30") out of the text."""
    for match in _RANGE_RE.finditer(text):
        first = _to_clock(match.group(1), match.group(2), match.group(3))
        second = _to_clock(match.group(4), match.group(5), match.group(6))
        if first is None or second is None:
            continue
        length = (_minutes_of_day(second) - _minutes_of_day(first)) % (24 * 60)
        if length == 0:
            continue
        return _cut(text, match), _ClockHint(start=first, range_minutes=length)

    for match in _AT_RE.finditer(text):
        if match.group(2) is None and match.group(3) is None:
            continue  # "at 7" alone is too ambiguous
        clock = _to_clock(match.group(1), match.group(2), match.group(3))
        if clock is not None:
            return _cut(text, match), _ClockHint(start=clock)

    return text, _ClockHint()


def _resolve_start(clock: time, now: datetime, tzname: str) -> datetime:
    """The latest moment at local time `clock` that is not after `now`, in UTC."""
    tz = timeutil.zone(tzname)
    local_now = now.astimezone(tz)
    candidate = datetime.combine(local_now.date(), clock, tz)
    if candidate > local_now:
        candidate -= timedelta(days=1)
    return candidate.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Durations: 45m, 45 min, 1h, 1h30, 1h 30m, 1.5h, 90 minutes, "half an hour"
# ---------------------------------------------------------------------------

_LEAD = r"(?:\b(?:for|about|around)\s+|~\s*)?"
_NUMBER = r"(?<![\w.:])(\d+(?:\.\d+)?)"
_MIN_UNIT = r"(?:m|mins?|minutes?)(?![a-z])"
_HOUR_UNIT = r"(?:h|hrs?|hours?)(?![a-z])"

# "1h", "1.5h", "1h30", "1h30m", "1h 30m". Bare digits count as minutes only when glued to the h.
_HOURS_RE = re.compile(
    _LEAD + _NUMBER + r"\s*" + _HOUR_UNIT
    + r"(?:\s*(\d{1,2})\s*" + _MIN_UNIT + r"|(\d{1,2})(?![\d:.a-z]))?",
    re.IGNORECASE,
)
_MINUTES_RE = re.compile(_LEAD + _NUMBER + r"\s*" + _MIN_UNIT, re.IGNORECASE)
_HALF_HOUR_RE = re.compile(r"\bhalf(?:\s+an?)?\s+hour\b", re.IGNORECASE)
_ONE_HOUR_RE = re.compile(r"\b(?:an|one)\s+hour\b", re.IGNORECASE)


def _extract_duration(text: str) -> tuple[str, int | None]:
    """Pull the first duration out of the text. Returns (remaining text, minutes or None)."""
    match = _HOURS_RE.search(text)
    if match:
        extra = match.group(2) or match.group(3) or "0"
        minutes = float(match.group(1)) * 60 + int(extra)
        return _cut(text, match), int(round(minutes))

    match = _MINUTES_RE.search(text)
    if match:
        return _cut(text, match), int(round(float(match.group(1))))

    match = _HALF_HOUR_RE.search(text)
    if match:
        return _cut(text, match), 30

    match = _ONE_HOUR_RE.search(text)
    if match:
        return _cut(text, match), 60

    return text, None


# ---------------------------------------------------------------------------
# Note cleanup
# ---------------------------------------------------------------------------

_LEADING_FILLER_RE = re.compile(
    r"^(?:(?:i\s+)?(?:did|spent|worked\s+on|studied)|on|for|of|at|from|and|,|;|:|-)\s+",
    re.IGNORECASE,
)
_TRAILING_FILLER_RE = re.compile(r"\s+(?:on|for|of|at|from|and)$", re.IGNORECASE)


def _clean_note(text: str) -> str:
    """Tidy what is left after the time words are removed."""
    note = re.sub(r"\s+", " ", text).strip(" \t,;:-–—~")
    previous = None
    while previous != note:  # strip leftover connector words from both ends
        previous = note
        note = _LEADING_FILLER_RE.sub("", note).strip(" \t,;:-–—~")
        note = _TRAILING_FILLER_RE.sub("", note).strip(" \t,;:-–—~")
    return note


# ---------------------------------------------------------------------------
# Public parsers
# ---------------------------------------------------------------------------

def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _timezone_name(settings: dict[str, Any]) -> str:
    return settings.get("timezone") or DEFAULT_TIMEZONE


def _valid_minutes(minutes: int | None) -> bool:
    return minutes is not None and MIN_MINUTES <= minutes <= MAX_MINUTES


def _start_for(hint: _ClockHint, minutes: int, settings: dict[str, Any], now: datetime) -> datetime:
    """Named start time if the user typed one, else `minutes` before `now`."""
    if hint.start is not None:
        return _resolve_start(hint.start, now, _timezone_name(settings))
    return now - timedelta(minutes=minutes)


def parse_log(text: str, settings: dict, now: datetime) -> ParsedLog | None:
    """Regex-only parse of a typed log. Returns None if there is no category or no duration.

    Examples: "45m numpy ex 1-12", "1h30 math LA 2.1", "2h python", "yt 40m",
    "90 min papers attention", "python 45 min at 18:30", "math 18:30-19:15".
    """
    if not text or not text.strip():
        return None
    now = _aware(now)

    rest, hint = _extract_clock(text)
    rest, minutes = _extract_duration(rest)
    if hint.range_minutes is not None:
        minutes = hint.range_minutes
    if not _valid_minutes(minutes):
        return None

    category = detect_category(rest)
    if category is None:
        return None

    deep = default_deep(category) and not _SHALLOW_RE.search(rest)
    return ParsedLog(
        category=category,
        minutes=int(minutes),
        note=_clean_note(rest),
        deep=deep,
        start_utc=_start_for(hint, int(minutes), settings, now),
    )


_LLM_SYSTEM = (
    "You turn one short time-log line, typed by the user about their own study or day, into "
    "structured data. Pick the single best category from the list. Use category 'Unknown' and "
    "minutes 0 if the text gives no clear duration or you cannot tell what it was. "
    "'deep' is true for focused work and false for distracted or shallow time. "
    "'note' is a short description (max 12 words) taken from the text. "
    "Categories: Python, Math, ML/DL, Papers, Writing/X (study ladder); Tracker build, Day job, "
    "Commute, Food, Exercise, Rest, Social, Admin, Sleep, Distracted, Other."
)

_LLM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": list(categories.ALL)},
        "minutes": {"type": "integer"},
        "deep": {"type": "boolean"},
        "note": {"type": "string"},
    },
    "required": ["category", "minutes", "deep", "note"],
    "additionalProperties": False,
}


def _from_llm_result(
    result: dict[str, Any], text: str, settings: dict[str, Any], now: datetime
) -> ParsedLog | None:
    """Validate the LLM's answer: known category, minutes in range."""
    category = result.get("category")
    minutes = result.get("minutes")
    if category not in categories.ALL or category == "Unknown":
        return None
    if isinstance(minutes, bool) or not isinstance(minutes, (int, float)):
        return None
    minutes = int(round(minutes))
    if not _valid_minutes(minutes):
        return None

    _, hint = _extract_clock(text)  # honour an "at 18:30" the user typed
    deep = result.get("deep")
    if not isinstance(deep, bool):
        deep = default_deep(category)
    if _SHALLOW_RE.search(text):
        deep = False
    note = result.get("note")
    return ParsedLog(
        category=category,
        minutes=minutes,
        note=note.strip()[:200] if isinstance(note, str) and note.strip() else _clean_note(text),
        deep=deep,
        start_utc=_start_for(hint, minutes, settings, now),
    )


def parse_log_smart(conn, llm, text: str, settings: dict, now: datetime) -> ParsedLog | None:
    """Regex first, then the free LLM (if there is one), else None.

    `conn` is kept for the shared signature; the LLM client records its own calls.
    """
    parsed = parse_log(text, settings, now)
    if parsed is not None:
        return parsed
    if llm is None or not text or not text.strip():
        return None

    clipped = text.strip()[:MAX_LLM_INPUT_CHARS]
    try:
        result = llm.complete_json("parse_log", _LLM_SYSTEM, clipped, _LLM_SCHEMA)
    except Exception:  # the client never raises, but a parse must never crash the caller
        return None
    if not isinstance(result, dict):
        return None
    return _from_llm_result(result, clipped, settings, _aware(now))
