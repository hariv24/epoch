"""New York weather for the city's sky: Open-Meteo (free, no API key), cached, and it never raises.

    get_weather(conn)  ->  dict for GET /api/weather (condition: clear|clouds|rain|snow|fog|storm)

The network is only touched when the cache (memory first, then the `weather_cache` table) is older
than 20 minutes. If the fetch fails, a reading up to 6 hours old is served with `stale: true`; with
nothing usable the weather fields are null and `available` is false. `local_time_ny` is computed
locally and is always present.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

import httpx

from . import db, timeutil

log = logging.getLogger(__name__)

NYC = (40.7128, -74.0060)
URL = "https://api.open-meteo.com/v1/forecast"
CURRENT_FIELDS = "temperature_2m,weather_code,is_day,cloud_cover,precipitation,wind_speed_10m"
CACHE_TTL = timedelta(minutes=20)
STALE_LIMIT = timedelta(hours=6)
TIMEOUT_SECONDS = 4.0
NY_TZ = ZoneInfo("America/New_York")

# WMO weather interpretation codes -> (condition, description)
_CODES: dict[int, tuple[str, str]] = {
    0: ("clear", "Clear sky"), 1: ("clear", "Mainly clear"), 2: ("clouds", "Partly cloudy"), 3: ("clouds", "Overcast"),
    45: ("fog", "Fog"), 48: ("fog", "Rime fog"),
    51: ("rain", "Light drizzle"), 53: ("rain", "Drizzle"), 55: ("rain", "Dense drizzle"),
    56: ("rain", "Freezing drizzle"), 57: ("rain", "Freezing drizzle"),
    61: ("rain", "Light rain"), 63: ("rain", "Rain"), 65: ("rain", "Heavy rain"),
    66: ("rain", "Freezing rain"), 67: ("rain", "Freezing rain"),
    71: ("snow", "Light snow"), 73: ("snow", "Snow"), 75: ("snow", "Heavy snow"), 77: ("snow", "Snow grains"),
    80: ("rain", "Rain showers"), 81: ("rain", "Rain showers"), 82: ("rain", "Violent rain showers"),
    85: ("snow", "Snow showers"), 86: ("snow", "Heavy snow showers"),
    95: ("storm", "Thunderstorm"), 96: ("storm", "Thunderstorm with hail"), 99: ("storm", "Thunderstorm with hail"),
}

# Replaced in tests; raises on any network problem.
Fetcher = Callable[[], dict]

RETRY_AFTER = timedelta(seconds=60)      # after a failed fetch, do not try the network again for this long
_memory: dict[str, Any] = {"at": None, "reading": None, "failed_at": None}
_lock = threading.Lock()


def condition_for(code: int | None) -> tuple[str | None, str | None]:
    if code is None:
        return None, None
    return _CODES.get(int(code), (None, None))


def ny_time(now: datetime | None = None) -> datetime:
    return (now or timeutil.now_utc()).astimezone(NY_TZ)


def parse(payload: dict) -> dict[str, Any]:
    """Normalise an Open-Meteo `forecast` answer. Raises ValueError when it has no usable `current` block."""
    current = payload.get("current") if isinstance(payload, dict) else None
    if not isinstance(current, dict) or current.get("weather_code") is None or current.get("temperature_2m") is None:
        raise ValueError("no current weather in the answer")
    condition, description = condition_for(current["weather_code"])
    if condition is None:  # an unknown code: fall back on cloud cover
        cover = current.get("cloud_cover") or 0
        condition, description = ("clouds", "Cloudy") if cover >= 50 else ("clear", "Clear")
    temp_c = round(float(current["temperature_2m"]), 1)
    return {
        "condition": condition, "description": description, "weather_code": int(current["weather_code"]),
        "temp_c": temp_c, "temp_f": round(temp_c * 9 / 5 + 32, 1), "is_day": bool(current.get("is_day", 1)),
        "cloud_cover": _int_or_none(current.get("cloud_cover")),
        "precipitation_mm": _float_or_none(current.get("precipitation")),
        "wind_kmh": _float_or_none(current.get("wind_speed_10m")),
    }


def _int_or_none(value: Any) -> int | None:
    try:
        return None if value is None else int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _float_or_none(value: Any) -> float | None:
    try:
        return None if value is None else round(float(value), 1)
    except (TypeError, ValueError):
        return None


def fetch_raw() -> dict:
    """One call to Open-Meteo. Raises on any problem (the caller turns that into 'unavailable')."""
    response = httpx.get(
        URL,
        params={"latitude": NYC[0], "longitude": NYC[1], "current": CURRENT_FIELDS, "timezone": "America/New_York"},
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def clear_memory() -> None:
    with _lock:
        _memory.update(at=None, reading=None, failed_at=None)


def _load_row(conn: sqlite3.Connection) -> tuple[datetime, dict] | None:
    try:
        row = conn.execute("SELECT fetched_utc, payload FROM weather_cache WHERE id = 1").fetchone()
    except sqlite3.Error:
        return None
    if row is None:
        return None
    try:
        return timeutil.from_iso(row["fetched_utc"]), json.loads(row["payload"])
    except (ValueError, TypeError):
        return None


def _save_row(conn: sqlite3.Connection, at: datetime, reading: dict) -> None:
    try:
        conn.execute(
            "INSERT INTO weather_cache(id, fetched_utc, payload) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET fetched_utc = excluded.fetched_utc, payload = excluded.payload",
            (timeutil.to_iso(at), json.dumps(reading)),
        )
    except sqlite3.Error:
        log.debug("could not store the weather cache", exc_info=True)


def _reading(conn: sqlite3.Connection, now: datetime, fetch: Callable[[], dict]) -> tuple[dict | None, datetime | None, bool]:
    """(reading, fetched_at, stale) using memory, then the table, then the network."""
    with _lock:
        at, reading = _memory["at"], _memory["reading"]
    if reading is not None and at is not None and now - at < CACHE_TTL:
        return reading, at, False
    stored = _load_row(conn)
    if stored is not None and now - stored[0] < CACHE_TTL:
        with _lock:
            _memory.update(at=stored[0], reading=stored[1])
        return stored[1], stored[0], False
    with _lock:
        failed_at = _memory["failed_at"]
    try:
        if failed_at is not None and now - failed_at < RETRY_AFTER:
            raise RuntimeError("retrying later")
        fresh = parse(fetch())
    except Exception as exc:  # offline, slow, bad JSON, bad shape: all the same to the caller
        log.info("weather unavailable (%s)", exc.__class__.__name__)
        with _lock:
            if failed_at is None or now - failed_at >= RETRY_AFTER:
                _memory["failed_at"] = now
        candidates = [c for c in ((at, reading), stored) if c and c[0] and c[1] is not None]
        if candidates:
            best = max(candidates, key=lambda c: c[0])
            if now - best[0] <= STALE_LIMIT:
                return best[1], best[0], True
        return None, None, False
    with _lock:
        _memory.update(at=now, reading=fresh, failed_at=None)
    _save_row(conn, now, fresh)
    return fresh, now, False


NULL_FIELDS = {
    "condition": None, "description": None, "weather_code": None, "temp_c": None, "temp_f": None, "is_day": None,
    "cloud_cover": None, "precipitation_mm": None, "wind_kmh": None,
}


def get_weather(conn: sqlite3.Connection, now: datetime | None = None, fetch: Callable[[], dict] | None = None) -> dict[str, Any]:
    """The GET /api/weather body. Never raises."""
    now = now or timeutil.now_utc()
    local = ny_time(now)
    base = {
        "ok": True, "enabled": True, "available": False, "stale": False, "source": "open-meteo", "fetched_at": None,
        "local_time_ny": local.isoformat(timespec="seconds"), "local_hm_ny": local.strftime("%H:%M"),
        **NULL_FIELDS,
    }
    try:
        if not db.get_setting(conn, "weather_enabled"):
            return {**base, "enabled": False}
        reading, fetched, stale = _reading(conn, now, fetch or fetch_raw)
    except Exception:
        log.exception("weather lookup failed")
        return base
    if reading is None:
        return base
    return {**base, **reading, "available": True, "stale": stale, "fetched_at": timeutil.to_iso(fetched) if fetched else None}
