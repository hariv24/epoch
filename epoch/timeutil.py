"""Time helpers. Store UTC; compute days in the user's local zone.

A "local day" runs from `day_start_hour` (default 04:00) to the same hour the next
calendar day, so 01:30 on Friday morning still belongs to Thursday.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"


def now_utc() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def to_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        raise ValueError("naive datetime")
    return dt.astimezone(UTC).strftime(ISO_FMT)


def from_iso(value: str) -> datetime:
    return datetime.strptime(value, ISO_FMT).replace(tzinfo=UTC)


def zone(tzname: str) -> ZoneInfo:
    return ZoneInfo(tzname)


def parse_hhmm(value: str) -> time:
    hours, minutes = value.strip().split(":")
    return time(int(hours), int(minutes))


def local_date_of(dt: datetime, tzname: str, day_start_hour: int = 4) -> date:
    """The local day an instant belongs to."""
    local = dt.astimezone(zone(tzname))
    if local.hour < day_start_hour:
        return local.date() - timedelta(days=1)
    return local.date()


def day_bounds_utc(local_date: date, tzname: str, day_start_hour: int = 4) -> tuple[datetime, datetime]:
    """[start, end) of a local day, as UTC datetimes (handles DST)."""
    tz = zone(tzname)
    start = datetime.combine(local_date, time(day_start_hour), tz)
    end = datetime.combine(local_date + timedelta(days=1), time(day_start_hour), tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def at_local(local_date: date, hhmm: str, tzname: str, day_start_hour: int = 4) -> datetime:
    """UTC instant for 'HH:MM' on a local day. Times before day_start_hour fall after midnight."""
    t = parse_hhmm(hhmm)
    calendar_date = local_date + timedelta(days=1) if t.hour < day_start_hour else local_date
    return datetime.combine(calendar_date, t, zone(tzname)).astimezone(UTC)


def week_monday(local_date: date) -> date:
    return local_date - timedelta(days=local_date.weekday())


def week_days(local_date: date) -> list[date]:
    monday = week_monday(local_date)
    return [monday + timedelta(days=i) for i in range(7)]


def overlap_minutes(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    start, end = max(a_start, b_start), min(a_end, b_end)
    return max(0.0, (end - start).total_seconds() / 60)


def minutes_between(start: datetime, end: datetime) -> int:
    return int(round((end - start).total_seconds() / 60))


# --- Day counter. Day one of the tracker (its start_date) is "Day 1". ---------------------------

def day_number(start: date, day: date) -> int:
    """Which day of the tracker a local day is: (day - start) + 1, and never below 1."""
    return max(1, (day - start).days + 1)


def day_number_label(number: int) -> str:
    return f"Day {number}"


def day_number_range_label(first: int, last: int) -> str:
    """'Days 8-14', or 'Day 8' when the range is one day."""
    return day_number_label(first) if first == last else f"Days {first}-{last}"


def short_day(day: date) -> str:
    """'Sun 18 Oct' (no leading zero on the day, no locale)."""
    return f"{day:%a} {day.day} {day:%b}"
