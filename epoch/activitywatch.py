"""ActivityWatch client and activity -> category suggestions.

ActivityWatch (https://activitywatch.net) records which window you had in the
foreground on this Mac. We only ever *read* from its local REST API, and we
only suggest categories: nothing is saved until the user confirms it.
"""
from __future__ import annotations

import json
import re
import sqlite3
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from . import db
from .timeutil import UTC, at_local, local_date_of, minutes_between

BROWSER_APPS = frozenset(
    {"Chrome", "Google Chrome", "Safari", "Firefox", "Arc", "Brave Browser", "Microsoft Edge"}
)
MIN_ACTIVE_SECONDS = 180  # a slot needs at least 3 active minutes to be suggested
MAX_APPS = 3


@dataclass
class AWEvent:
    start_utc: datetime
    end_utc: datetime
    app: str
    title: str
    url: str | None = None


@dataclass
class Suggestion:
    start_utc: datetime
    end_utc: datetime
    category: str
    deep: bool
    minutes: int  # length of the suggested block, end - start
    apps: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Parsing helpers
# --------------------------------------------------------------------------

_FRACTION = re.compile(r"\.(\d+)")


def parse_aw_time(value: str) -> datetime:
    """Parse an ActivityWatch timestamp into an aware UTC datetime.

    ActivityWatch may send 'Z' or '+00:00' and up to 9 fractional digits, which
    Python 3.10's fromisoformat cannot read directly, so we normalise first.
    """
    text = value.strip().replace("Z", "+00:00")
    text = _FRACTION.sub(lambda m: "." + m.group(1)[:6].ljust(6, "0"), text, count=1)
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _raw_to_event(raw: dict[str, Any]) -> AWEvent | None:
    """Convert one raw ActivityWatch event dict; None if it is unusable."""
    try:
        start = parse_aw_time(raw["timestamp"])
        end = start + timedelta(seconds=float(raw.get("duration", 0)))
        data = raw.get("data") or {}
        return AWEvent(
            start_utc=start,
            end_utc=end,
            app=str(data.get("app") or ""),
            title=str(data.get("title") or ""),
            url=data.get("url") or None,
        )
    except (KeyError, TypeError, ValueError):
        return None


def _flatten_query_result(payload: Any) -> list[dict[str, Any]]:
    """A query returns one list of events per time period; we always send one period."""
    if not isinstance(payload, list):
        return []
    if payload and isinstance(payload[0], list):
        payload = payload[0]
    return [item for item in payload if isinstance(item, dict)]


def _period(start_utc: datetime, end_utc: datetime) -> str:
    return f"{start_utc.astimezone(UTC).isoformat()}/{end_utc.astimezone(UTC).isoformat()}"


def _quote(text: str) -> str:
    """A string literal for the ActivityWatch query language."""
    return json.dumps(text)


# --------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------


class AWClient:
    """Small, forgiving client for the ActivityWatch REST API. Never raises."""

    def __init__(
        self,
        base_url: str = "http://localhost:5600",
        timeout: float = 3,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport

    # -- low-level HTTP ----------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> Any | None:
        """Return the decoded JSON body, or None on any problem."""
        try:
            with httpx.Client(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as http:
                response = http.request(method, path, **kwargs)
                response.raise_for_status()
                return response.json()
        except Exception:
            return None

    def _buckets(self) -> dict[str, dict[str, Any]]:
        data = self._request("GET", "/api/0/buckets/")
        return data if isinstance(data, dict) else {}

    def _query(self, lines: list[str], start_utc: datetime, end_utc: datetime) -> list[dict[str, Any]]:
        body = {"timeperiods": [_period(start_utc, end_utc)], "query": lines}
        return _flatten_query_result(self._request("POST", "/api/0/query/", json=body))

    # -- public API --------------------------------------------------------

    def available(self) -> bool:
        """True if the ActivityWatch server answers."""
        return self._request("GET", "/api/0/info") is not None

    def events(self, start_utc: datetime, end_utc: datetime) -> list[AWEvent]:
        """Non-AFK window events between start and end, with browser url/title attached."""
        try:
            return self._events(start_utc, end_utc)
        except Exception:
            return []

    # -- internals ---------------------------------------------------------

    def _events(self, start_utc: datetime, end_utc: datetime) -> list[AWEvent]:
        buckets = self._buckets()
        window_id = _pick_bucket(buckets, "currentwindow")
        if window_id is None:
            return []
        afk_id = _pick_bucket(buckets, "afkstatus", prefer_host=_host_of(buckets[window_id]))

        lines = [f"window = query_bucket({_quote(window_id)});"]
        if afk_id is not None:
            lines += [
                f"afk = query_bucket({_quote(afk_id)});",
                'afk = filter_keyvals(afk, "status", ["not-afk"]);',
                "window = filter_period_intersect(window, afk);",
            ]
        lines.append("RETURN = sort_by_timestamp(window);")
        events = _clip(
            [e for e in map(_raw_to_event, self._query(lines, start_utc, end_utc)) if e],
            start_utc,
            end_utc,
        )

        web_events = self._web_events(buckets, afk_id, start_utc, end_utc)
        if web_events:
            _attach_web(events, web_events)
        return events

    def _web_events(
        self,
        buckets: dict[str, dict[str, Any]],
        afk_id: str | None,
        start_utc: datetime,
        end_utc: datetime,
    ) -> list[AWEvent]:
        """Events from the browser extension buckets (one per browser), or []."""
        web_ids = [bid for bid, info in buckets.items() if info.get("type") == "web.tab.current"]
        if not web_ids:
            return []
        lines = [f"web = query_bucket({_quote(web_ids[0])});"]
        for index, bucket_id in enumerate(web_ids[1:], start=1):
            lines.append(f"web{index} = query_bucket({_quote(bucket_id)});")
            lines.append(f"web = concat(web, web{index});")
        if afk_id is not None:
            lines += [
                f"afk = query_bucket({_quote(afk_id)});",
                'afk = filter_keyvals(afk, "status", ["not-afk"]);',
                "web = filter_period_intersect(web, afk);",
            ]
        lines.append("RETURN = sort_by_timestamp(web);")
        raw = self._query(lines, start_utc, end_utc)
        return _clip([e for e in map(_raw_to_event, raw) if e], start_utc, end_utc)


def _host_of(bucket: dict[str, Any]) -> str | None:
    return bucket.get("hostname")


def _pick_bucket(
    buckets: dict[str, dict[str, Any]], bucket_type: str, prefer_host: str | None = None
) -> str | None:
    """First bucket of this type, preferring one recorded on the given host."""
    matches = sorted(bid for bid, info in buckets.items() if info.get("type") == bucket_type)
    if not matches:
        return None
    if prefer_host:
        for bucket_id in matches:
            if _host_of(buckets[bucket_id]) == prefer_host:
                return bucket_id
    return matches[0]


def _clip(events: list[AWEvent], start_utc: datetime, end_utc: datetime) -> list[AWEvent]:
    """Cut events to [start, end], drop empty ones, sort by start."""
    clipped: list[AWEvent] = []
    for event in events:
        start, end = max(event.start_utc, start_utc), min(event.end_utc, end_utc)
        if end > start:
            clipped.append(AWEvent(start, end, event.app, event.title, event.url))
    clipped.sort(key=lambda e: e.start_utc)
    return clipped


def _attach_web(events: list[AWEvent], web_events: list[AWEvent]) -> None:
    """For browser window events, copy url/title from the tab that was open at their midpoint."""
    starts = [w.start_utc for w in web_events]
    for event in events:
        if event.app not in BROWSER_APPS:
            continue
        midpoint = event.start_utc + (event.end_utc - event.start_utc) / 2
        index = bisect_right(starts, midpoint) - 1
        # Tabs can overlap slightly, so look at a couple of candidates going backwards.
        for candidate in web_events[max(index - 2, 0) : index + 1][::-1]:
            if candidate.start_utc <= midpoint <= candidate.end_utc:
                event.url = candidate.url
                if candidate.title:
                    event.title = candidate.title
                break


# --------------------------------------------------------------------------
# Categorising
# --------------------------------------------------------------------------


def load_rules(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """All aw_rules, lowest priority number first."""
    return conn.execute("SELECT * FROM aw_rules ORDER BY priority, id").fetchall()


def categorize(event: AWEvent, rules: Any) -> tuple[str, bool]:
    """(category, deep) from the first matching rule, else ('Unknown', False)."""
    fields = {"app": event.app, "title": event.title, "url": event.url}
    for rule in sorted(rules, key=lambda r: (r["priority"], r["id"] if "id" in r.keys() else 0)):
        value = fields.get(rule["field"])
        if not value:
            continue
        try:
            matched = re.search(rule["pattern"], value, re.IGNORECASE)
        except re.error:
            continue  # a bad pattern in the settings must not break the page
        if matched:
            return rule["category"], bool(rule["deep"])
    return "Unknown", False


# --------------------------------------------------------------------------
# Suggestions
# --------------------------------------------------------------------------


@dataclass
class _Slot:
    """Active seconds collected inside one time slot."""

    start: datetime
    end: datetime
    seconds_by_category: dict[str, float] = field(default_factory=dict)
    deep_seconds_by_category: dict[str, float] = field(default_factory=dict)
    seconds_by_app: dict[str, float] = field(default_factory=dict)

    @property
    def active_seconds(self) -> float:
        return sum(self.seconds_by_category.values())

    def add(self, category: str, deep: bool, app: str, seconds: float) -> None:
        self.seconds_by_category[category] = self.seconds_by_category.get(category, 0) + seconds
        if deep:
            self.deep_seconds_by_category[category] = (
                self.deep_seconds_by_category.get(category, 0) + seconds
            )
        if app:
            self.seconds_by_app[app] = self.seconds_by_app.get(app, 0) + seconds


def _job_windows(
    settings: dict[str, Any], start: datetime, end: datetime, leave_days: set[date] | None = None
) -> list[tuple[datetime, datetime]]:
    """Job-hour windows (UTC) on job days that touch [start, end]. Leave days have no job window."""
    tz = settings["timezone"]
    day_start_hour = int(settings["day_start_hour"])
    job_days = set(settings.get("job_days") or [])
    windows: list[tuple[datetime, datetime]] = []
    first = local_date_of(start, tz, day_start_hour) - timedelta(days=1)
    last = local_date_of(end, tz, day_start_hour) + timedelta(days=1)
    current: date = first
    while current <= last:
        if current.weekday() in job_days and current not in (leave_days or ()):
            windows.append(
                (
                    at_local(current, settings["job_start"], tz, day_start_hour),
                    at_local(current, settings["job_end"], tz, day_start_hour),
                )
            )
        current += timedelta(days=1)
    return windows


def _split_by_job(
    start: datetime, end: datetime, windows: list[tuple[datetime, datetime]]
) -> list[tuple[datetime, datetime, bool]]:
    """Cut [start, end] into pieces, each flagged True if it lies inside a job window."""
    cuts = {start, end}
    for w_start, w_end in windows:
        for point in (w_start, w_end):
            if start < point < end:
                cuts.add(point)
    ordered = sorted(cuts)
    pieces = []
    for left, right in zip(ordered, ordered[1:]):
        middle = left + (right - left) / 2
        inside = any(w_start <= middle < w_end for w_start, w_end in windows)
        pieces.append((left, right, inside))
    return pieces


def _fill_slots(
    events: list[AWEvent],
    rules: Any,
    windows: list[tuple[datetime, datetime]],
    start_utc: datetime,
    end_utc: datetime,
    slot_minutes: int,
) -> dict[int, _Slot]:
    """Distribute every event's active seconds over the slots it touches."""
    slot_length = timedelta(minutes=slot_minutes)
    slots: dict[int, _Slot] = {}
    for event in events:
        category, deep = categorize(event, rules)
        for piece_start, piece_end, in_job in _split_by_job(event.start_utc, event.end_utc, windows):
            piece_category, piece_deep = ("Day job", False) if in_job else (category, deep)
            index = int((piece_start - start_utc) / slot_length)
            while True:
                slot_start = start_utc + index * slot_length
                if slot_start >= piece_end or slot_start >= end_utc:
                    break
                slot = slots.setdefault(
                    index, _Slot(slot_start, min(slot_start + slot_length, end_utc))
                )
                left, right = max(piece_start, slot_start), min(piece_end, slot_start + slot_length)
                if right > left:
                    slot.add(piece_category, piece_deep, event.app, (right - left).total_seconds())
                index += 1
    return slots


def _dominant(slot: _Slot) -> tuple[str, bool]:
    """The category with the most active seconds; deep if most of its time was deep."""
    category = max(slot.seconds_by_category, key=lambda c: (slot.seconds_by_category[c], c))
    deep_share = slot.deep_seconds_by_category.get(category, 0)
    return category, deep_share * 2 > slot.seconds_by_category[category]


def _top_apps(seconds_by_app: dict[str, float]) -> list[str]:
    ranked = sorted(seconds_by_app, key=lambda a: (-seconds_by_app[a], a))
    return ranked[:MAX_APPS]


def suggest(
    conn: sqlite3.Connection,
    aw: AWClient,
    start_utc: datetime,
    end_utc: datetime,
    slot_minutes: int = 15,
) -> list[Suggestion]:
    """Suggested blocks for [start, end], one dominant category per slot, merged when adjacent.

    Slots start at start_utc. A slot with under 3 active minutes is dropped.
    `minutes` is the block length (end - start). Nothing is saved here.
    """
    if end_utc <= start_utc or slot_minutes <= 0:
        return []
    events = aw.events(start_utc, end_utc)
    if not events:
        return []

    rules = load_rules(conn)
    leave_days = {date.fromisoformat(r[0]) for r in conn.execute("SELECT local_date FROM job_leaves")}
    windows = _job_windows(db.all_settings(conn), start_utc, end_utc, leave_days)
    slots = _fill_slots(events, rules, windows, start_utc, end_utc, slot_minutes)

    merged: list[tuple[Suggestion, dict[str, float]]] = []
    for index in sorted(slots):
        slot = slots[index]
        if slot.active_seconds < MIN_ACTIVE_SECONDS:
            continue
        category, deep = _dominant(slot)
        if merged:
            last, app_seconds = merged[-1]
            if last.end_utc == slot.start and last.category == category and last.deep == deep:
                last.end_utc = slot.end
                for app, seconds in slot.seconds_by_app.items():
                    app_seconds[app] = app_seconds.get(app, 0) + seconds
                continue
        merged.append(
            (Suggestion(slot.start, slot.end, category, deep, 0), dict(slot.seconds_by_app))
        )

    suggestions = []
    for suggestion, app_seconds in merged:
        suggestion.minutes = minutes_between(suggestion.start_utc, suggestion.end_utc)
        suggestion.apps = _top_apps(app_seconds)
        suggestions.append(suggestion)
    return suggestions
