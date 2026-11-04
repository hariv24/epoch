"""View helpers for the money pages (Money, NYC Store, Passport, Home): formatting, plain-language gating copy, a net-worth
sparkline, small inline-SVG glyphs for shop items and the illustrated Passport postcards.

Everything here is pure (no database, no network) except `wallet_cents`. The art is original, geometric and has no faces,
animals, logos or lettering; the facts on the postcards are true, short and checked by hand.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime
from typing import Any

from markupsafe import Markup, escape

# ---------------------------------------------------------------- formatting

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def usd(value: Any) -> str:
    """12345.6 -> '$12,345' (whole dollars; the engine already truncates)."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return "$0"
    return f"-${abs(n):,}" if n < 0 else f"${n:,}"


def usd_cents(cents: Any) -> str:
    try:
        n = int(cents)
    except (TypeError, ValueError):
        return "$0"
    return usd(n // 100) if n >= 0 else usd(-((-n) // 100))


def short_date(text: Any) -> str:
    """'2026-11-15' -> 'Nov 15'."""
    try:
        d = date.fromisoformat(str(text)[:10])
    except ValueError:
        return str(text or "")
    return f"{MONTHS[d.month - 1]} {d.day}"


def long_date(text: Any) -> str:
    """'2026-10-25' -> 'Sun 25 Oct'."""
    try:
        d = date.fromisoformat(str(text)[:10])
    except ValueError:
        return str(text or "")
    return f"{d.strftime('%a')} {d.day} {MONTHS[d.month - 1]}"


def week_range(monday: Any, sunday: Any) -> str:
    return f"{short_date(monday)} to {short_date(sunday)}"


def wallet_cents(conn: sqlite3.Connection) -> int | None:
    """Savings in cents straight from the banked rows (cheap; the header pill uses it). None when the money tables are missing."""
    try:
        a = conn.execute("SELECT COALESCE(SUM(cents), 0) FROM econ_earned").fetchone()[0]
        b = conn.execute("SELECT COALESCE(SUM(cents), 0) FROM econ_ledger").fetchone()[0]
    except sqlite3.Error:
        return None
    return int(a) + int(b)


def days_text(n: int | None) -> str:
    if n is None:
        return ""
    return "today" if n <= 0 else ("1 day" if n == 1 else f"{n} days")


# ---------------------------------------------------------------- plain-language state of a shop item

def gate_text(item: dict) -> str:
    """'Unlocks with Midtown & Times Square, Level 13.' for a locked item (empty when it is open)."""
    if item.get("state") != "locked":
        return ""
    district, level = item.get("district"), item.get("unlocks_at_level")
    if district and level:
        return f"Unlocks with {district}, Level {level}."
    return item.get("why_not") or "Not open yet."


def event_text(item: dict) -> str:
    """When a limited-time event ends (or starts)."""
    ev = item.get("event") or {}
    if not ev:
        return ""
    if ev.get("on"):
        left = ev.get("days_left")
        tail = "last day" if left == 0 else (f"{days_text(left)} left" if left is not None else "")
        end = f"Ends {short_date(ev.get('end'))}" if ev.get("end") else "On now"
        return f"{end}, {tail}" if tail else end
    if ev.get("starts_in") is not None:
        return f"Starts {short_date(ev.get('start'))}, in {days_text(ev['starts_in'])}"
    if item.get("event", {}).get("reason") == "weather":
        return "Appears on a snow day"
    return "Not on right now"


def next_event(events: list[dict]) -> dict | None:
    """The soonest event that has not started yet (for the 'Next up' line under the On-now strip)."""
    coming = [e for e in events if not (e.get("event") or {}).get("on") and (e.get("event") or {}).get("starts_in") is not None]
    return min(coming, key=lambda e: e["event"]["starts_in"]) if coming else None


def rate_line(rate: dict) -> str:
    nxt = rate.get("next")
    if not nxt:
        return "Top of the ladder. Every deep minute pays at the Founder rate."
    n = int(nxt.get("nodes_to_go") or 0)
    nodes = "1 more skill node" if n == 1 else f"{n} more skill nodes"
    return f"{nodes} to {nxt['title']} · {usd(nxt['per_hour'])}/h"


def source_rows(earned: dict) -> list[tuple[str, int]]:
    """Earned by source for a week, in a fixed order, zero rows kept so the card keeps its shape."""
    labels = (("deep", "Deep focus"), ("output", "Shipped outputs"), ("star", "Three-star days"), ("kept", "Kept week"), ("late", "Earlier days, added later"))
    return [(label, int(earned.get(key) or 0)) for key, label in labels if key != "late" or earned.get(key)]


# ---------------------------------------------------------------- net-worth sparkline

def networth_svg(series: list[dict], **_: Any) -> Markup:
    """A calm area chart of net worth at each week close (the last point may be live, 'now'). The drawing is a stretchy SVG with
    non-scaling strokes; the dots and the labels are plain HTML placed by percentage, so text and dots keep their size at any width."""
    pts = [(str(p.get("monday")), float(p.get("net_worth") or 0), bool(p.get("live"))) for p in series if p.get("monday")]
    if not pts:
        return Markup("")
    lo = min(0.0, min(v for _, v, _ in pts))
    hi = max(v for _, v, _ in pts)
    span = (hi - lo) or 1.0
    n = len(pts)
    left, right, top, bottom = 3.0, 3.0, 14.0, 4.0     # percent of the box

    def x(i: int) -> float:
        return left + (100 - left - right) * (i / (n - 1)) if n > 1 else 50.0

    def y(v: float) -> float:
        return top + (100 - top - bottom) * (1 - (v - lo) / span)

    xy = [(x(i), y(v)) for i, (_, v, _) in enumerate(pts)]
    base = 100 - bottom
    line = " ".join(f"{'M' if i == 0 else 'L'}{px:.2f} {py:.2f}" for i, (px, py) in enumerate(xy))
    area = f"{line} L{xy[-1][0]:.2f} {base:.2f} L{xy[0][0]:.2f} {base:.2f} Z"
    first, last = pts[0], pts[-1]
    desc = f"Net worth from {usd(first[1])} to {usd(last[1])} over {n} week{'s' if n != 1 else ''}."
    dots = "".join(
        f'<i class="nw__dot{" is-live" if live else ""}{" is-last" if i == n - 1 else ""}" style="left:{px:.2f}%;top:{py:.2f}%" title="{escape(short_date(m))}: {usd(v)}{" (now)" if live else ""}"></i>'
        for i, ((m, v, live), (px, py)) in enumerate(zip(pts, xy))
    )
    lx, ly = xy[-1]
    value = f'<span class="nw__val" style="left:{lx:.2f}%;top:{ly:.2f}%">{escape(usd(last[1]))}</span>'
    step = max(1, (n - 1) // 4) if n > 1 else 1
    idx = sorted({0, n - 1, *range(0, n, step)}) if n > 1 else [0]
    # keep the last tick from crowding the one before it
    if len(idx) > 2 and idx[-1] - idx[-2] < step * 0.6:
        idx.pop(-2)
    ticks = "".join(
        f'<span class="nw__tick" style="left:{xy[i][0]:.2f}%">{escape("now" if (i == n - 1 and pts[i][2]) else short_date(pts[i][0]))}</span>' for i in idx
    )
    return Markup(
        f'<figure class="nw" role="img" aria-label="{escape(desc)}">'
        f'<div class="nw__plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
        f'<defs><linearGradient id="nwfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".36"/><stop offset="1" stop-color="currentColor" stop-opacity=".03"/></linearGradient></defs>'
        f'<line class="nw__base" x1="0" y1="{base:.2f}" x2="100" y2="{base:.2f}"/>'
        f'<path class="nw__area" d="{area}" fill="url(#nwfill)"/><path class="nw__line" d="{line}" fill="none"/></svg>'
        f'{dots}{value}</div><div class="nw__ticks" aria-hidden="true">{ticks}</div>'
        f'<figcaption class="sr-only">{escape(desc)}</figcaption></figure>'
    )


# ---------------------------------------------------------------- shop glyphs (48 x 48, drawn with currentColor)

_GLYPH = {
    "desk": '<path d="M6 22h36M10 22v16M38 22v16"/><rect x="15" y="8" width="18" height="11" rx="2"/><path d="M24 19v3"/>',
    "art": '<rect x="9" y="9" width="30" height="30" rx="3"/><path d="M13 33l8-9 6 6 4-4 7 7"/><circle cx="31" cy="17" r="2.6"/>',
    "shelf": '<rect x="9" y="8" width="30" height="32" rx="2"/><path d="M9 19h30M9 29h30M15 11v5M20 11v5M26 22v4M31 22v4M15 32v5"/>',
    "plant": '<path d="M17 31h14l-2 10H19z"/><path d="M24 31V17"/><path d="M24 23c-8 0-10-6-10-10 8 0 10 4 10 10zM24 19c6 0 9-4 9-8-6 0-9 3-9 8z"/>',
    "lamp": '<path d="M16 9h16l4 14H12z"/><path d="M24 23v15M17 40h14"/>',
    "rug": '<rect x="6" y="15" width="36" height="18" rx="3"/><rect x="11" y="20" width="26" height="8" rx="1.5"/><path d="M10 37v3M18 37v3M26 37v3M34 37v3"/>',
    "sofa": '<path d="M10 22a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v5"/><path d="M5 28a3 3 0 0 1 6 0v3h26v-3a3 3 0 0 1 6 0v9H5z"/><path d="M11 37v3M37 37v3"/>',
    "armchair": '<path d="M13 22a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v6"/><path d="M8 28a3 3 0 0 1 6 0v3h20v-3a3 3 0 0 1 6 0v9H8z"/><path d="M13 37v3M35 37v3"/>',
    "kitchen": '<rect x="11" y="9" width="26" height="24" rx="3"/><path d="M16 15h16M24 22v5M17 33h14l-1 7H18z"/>',
    "piano": '<path d="M7 20l4-8h26l4 8"/><rect x="7" y="20" width="34" height="17" rx="2"/><path d="M14 37v-8M20 37v-8M26 37v-8M32 37v-8"/>',
    "wall": '<rect x="8" y="8" width="32" height="32" rx="2"/><path d="M8 19h32M8 29h32M24 8v32"/>',
    "audio": '<rect x="8" y="14" width="32" height="22" rx="3"/><circle cx="21" cy="25" r="7"/><circle cx="21" cy="25" r="1.4"/><path d="M33 18l-5 8"/>',
    "telescope": '<path d="M9 28l25-14 3 6L12 34z"/><path d="M23 29l-6 13M26 28l7 14"/>',
    "casual": '<path d="M17 8L8 14l4 7 5-3v22h14V18l5 3 4-7-9-6c-1 3-3 5-7 5s-6-2-7-5z"/>',
    "hoodie": '<path d="M17 9L8 15l4 7 5-3v21h14V19l5 3 4-7-9-6"/><path d="M17 9c1 5 3 8 7 8s6-3 7-8"/><path d="M18 32h12"/>',
    "jersey": '<path d="M16 7l-2 8c0 4 2 6 4 7v18h12V22c2-1 4-3 4-7l-2-8"/><path d="M18 7c1 4 3 6 6 6s5-2 6-6"/>',
    "sport": '<path d="M7 30l7-13 8 6 14 2c4 1 4 7 0 7H9c-2 0-3-1-2-2z"/><path d="M7 35h30"/>',
    "coat": '<path d="M16 8l-6 7 2 27h24l2-27-6-7"/><path d="M24 12v30M16 8l8 9 8-9M27 24h.01M27 31h.01"/>',
    "suit": '<path d="M16 8l-6 8 4 26h20l4-26-6-8"/><path d="M16 8l8 15 8-15"/><path d="M24 23l-2 7 2 6 2-6z"/>',
    "lights": '<path d="M5 13c6 9 13 9 19 0s13-9 19 0"/><circle cx="11" cy="20" r="3"/><circle cx="24" cy="14" r="3"/><circle cx="37" cy="20" r="3"/><path d="M11 27v3M24 21v3M37 27v3"/>',
    "roof": '<path d="M13 19h22v18H13zM11 19l13-9 13 9"/><path d="M16 37v6M32 37v6M13 27h22"/>',
    "entrance": '<path d="M7 13h34l-3 9H10z"/><path d="M15 13l-2 9M24 13v9M33 13l2 9"/><rect x="15" y="22" width="18" height="19" rx="2"/><path d="M24 22v19"/>',
    "sign": '<rect x="7" y="11" width="34" height="19" rx="5"/><path d="M14 20h20M24 30v11M18 41h12"/>',
    "default": '<rect x="10" y="10" width="28" height="28" rx="6"/><path d="M18 24h12"/>',
}


def glyph(category: str, cls: str = "glyph") -> Markup:
    body = _GLYPH.get(category) or _GLYPH["default"]
    return Markup(f'<svg class="{cls}" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')


# ---------------------------------------------------------------- Passport postcards (240 x 150, fixed palette: it is a picture)

FACTS: dict[str, str] = {
    "columbia_lecture": "Low Library, finished in 1897, was built as Columbia's library and now holds the president's office.",
    "evensong": "St. John the Divine was begun in 1892 and is still unfinished, so New Yorkers call it St. John the Unfinished.",
    "apollo_night": "Amateur Night at the Apollo has run since 1934, and the crowd decides who wins.",
    "lincoln_ballet": "New York City Ballet was founded in 1948 and dances at Lincoln Center's David H. Koch Theater.",
    "park_rowboat": "Central Park's lake is man-made, shaped when the park was built in the 1850s.",
    "met_morning": "The Met opened in 1870 and moved into its Fifth Avenue building in 1880.",
    "ninth_dumplings": "Ninth Avenue in Hell's Kitchen holds an international food festival every May.",
    "broadway_show": "There are 41 Broadway theatres, and most sit on the side streets around Times Square.",
    "top_of_rock": "The deck at 30 Rockefeller Plaza is about 850 feet up, with Central Park on one side and the harbour on the other.",
    "high_line_evening": "The High Line carried freight trains from 1934 to 1980 and opened as a park in 2009.",
    "knicks_msg": "The Garden on Seventh Avenue is the fourth Madison Square Garden and has stood there since 1968.",
    "village_jazz": "The Village Vanguard opened in 1935, and its basement room is one of jazz's best-known.",
    "soho_gallery_hop": "SoHo's cast-iron buildings were factories in the 1800s, and artists moved into the empty lofts in the 1960s.",
    "katz_deli": "Katz's has stood on Houston Street since 1888 and still hands you a paper ticket at the door.",
    "ferry_sunset": "The Staten Island Ferry crosses New York Harbor for free, and has done since 1997.",
    "cloisters_autumn": "The Cloisters in Fort Tryon Park is built from pieces of medieval monasteries and opened in 1938.",
    "brow_dinner": "Central Park Tower on 57th Street is 472 metres tall, the tallest residential building in the world.",
    # limited-time events
    "leaves_riverside": "Frederick Law Olmsted designed Riverside Park, which runs beside the Hudson for about four miles.",
    "halloween_parade": "The Village Halloween Parade began in 1974 as a small puppet walk through the neighbourhood.",
    "marathon_cheer": "The NYC Marathon crosses all five boroughs and finishes in Central Park.",
    "thanksgiving_balloons": "The night before Thanksgiving, the giant parade balloons are filled on the streets beside the Museum of Natural History.",
    "holiday_windows": "New York department stores have staged Christmas windows since the 1870s.",
    "rockefeller_tree": "The first Rockefeller Center tree was put up by construction workers in 1931.",
    "ball_drop": "The Times Square ball has dropped on New Year's Eve since 1907, with a pause in 1942 and 1943.",
    "hot_chocolate_snow": "Central Park's deepest snowfall on record is 27.5 inches, in January 2016.",
    "cherry_blossoms": "Cherry trees ring the Reservoir in Central Park and bloom in April.",
    "smorgasburg": "Smorgasburg began in Brooklyn in 2011 as an open-air food market for weekends.",
    "shakespeare_park": "Shakespeare in the Park has been free at the Delacorte Theater in Central Park since 1962.",
    "july_fireworks": "The fireworks are fired from barges on the water, so both shores can watch.",
}

# colour tokens used by the scenes
_NAVY, _INK, _CREAM = "#12305a", "#0b1f3a", "#fbf4e4"
_STONE, _STONE2, _LAMP = "#d9cdb4", "#b9ab8e", "#ffce7a"


def _sky(top: str, bottom: str, uid: str) -> str:
    return (f'<defs><linearGradient id="sk{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>'
            f'<rect width="240" height="150" fill="url(#sk{uid})"/>')


def _skyline(color: str, base: int = 118, x0: int = 0, seed: int = 3, lit: str | None = None) -> str:
    heights = (34, 52, 28, 64, 40, 22, 58, 36, 70, 30, 46, 26, 54, 38, 24)
    out, x, i = [], x0, seed
    while x < 240:
        hgt = heights[i % len(heights)]
        wid = 14 + (i * 5) % 11
        out.append(f'<rect x="{x}" y="{base - hgt}" width="{wid}" height="{hgt + 40}" fill="{color}"/>')
        if lit:
            for r in range(3):
                for c in range(2):
                    if (r * 3 + c + i) % 3:
                        out.append(f'<rect x="{x + 3 + c * 6}" y="{base - hgt + 5 + r * 8}" width="3" height="4" fill="{lit}"/>')
        x += wid + 1
        i += 1
    return "".join(out)


def _columns(x: int, y: int, n: int, spacing: int, hgt: int, color: str) -> str:
    return "".join(f'<rect x="{x + i * spacing}" y="{y}" width="5" height="{hgt}" fill="{color}"/>' for i in range(n))


def _trees(color: str, xs: tuple[int, ...], base: int = 124, r: int = 12) -> str:
    return "".join(f'<rect x="{x - 1.5}" y="{base - 6}" width="3" height="12" fill="#6b4a2f"/><circle cx="{x}" cy="{base - r}" r="{r}" fill="{color}"/>' for x in xs)


def _stars(pts: tuple[tuple[int, int], ...], color: str = "#fff6d6") -> str:
    return "".join(f'<circle cx="{x}" cy="{y}" r="1.2" fill="{color}"/>' for x, y in pts)


def _scene(sid: str) -> str:  # noqa: C901 - a flat table of small drawings
    u = sid
    if sid == "columbia_lecture":
        return (_sky("#9cc7ee", "#eaf3fb", u) + '<circle cx="196" cy="30" r="12" fill="#fff4c8"/>'
                + f'<rect x="40" y="82" width="160" height="40" fill="{_STONE}"/>'
                + f'<path d="M92 82a28 28 0 0 1 56 0z" fill="#7aa0c4"/><rect x="117" y="46" width="6" height="12" fill="#7aa0c4"/>'
                + f'<path d="M70 82h100l-8-10H78z" fill="{_STONE2}"/>' + _columns(78, 82, 7, 14, 32, _CREAM)
                + f'<rect x="60" y="114" width="120" height="8" fill="{_STONE2}"/><rect x="0" y="122" width="240" height="28" fill="#8fbf8a"/>'
                + _trees("#5b9a62", (22, 218)))
    if sid == "evensong":
        return (_sky("#2a2f6b", "#e8a56f", u) + _stars(((30, 20), (70, 34), (190, 18), (214, 44), (150, 12)))
                + f'<rect x="60" y="56" width="120" height="68" fill="{_STONE2}"/><rect x="48" y="40" width="30" height="84" fill="{_STONE}"/><rect x="162" y="40" width="30" height="84" fill="{_STONE}"/>'
                + f'<path d="M48 40l15-22 15 22zM162 40l15-22 15 22z" fill="#6f7f95"/><circle cx="120" cy="76" r="14" fill="{_LAMP}"/><circle cx="120" cy="76" r="14" fill="none" stroke="#8a6a2a" stroke-width="2"/>'
                + f'<path d="M104 124v-22a16 16 0 0 1 32 0v22z" fill="#3c2a1f"/><path d="M112 124v-14a8 8 0 0 1 16 0v14z" fill="{_LAMP}"/>'
                + '<rect x="0" y="124" width="240" height="26" fill="#2b3b57"/>')
    if sid in ("apollo_night", "lincoln_ballet", "broadway_show"):
        accent = {"apollo_night": "#c0504d", "lincoln_ballet": "#7d5fb5", "broadway_show": "#c9302c"}[sid]
        marq = "".join(f'<circle cx="{26 + i * 14}" cy="22" r="2.6" fill="{_LAMP}"/>' for i in range(14))
        return (f'<rect width="240" height="150" fill="#1b1230"/><rect x="14" y="12" width="212" height="20" rx="4" fill="#2c2050"/>' + marq
                + f'<path d="M14 36h40c-8 30-6 64-2 96H14z" fill="{accent}"/><path d="M226 36h-40c8 30 6 64 2 96h38z" fill="{accent}"/>'
                + '<path d="M96 36h48l30 96H66z" fill="#fff6d6" opacity=".28"/><rect x="14" y="128" width="212" height="12" fill="#3a2a1c"/>'
                + f'<ellipse cx="120" cy="128" rx="38" ry="6" fill="{_LAMP}" opacity=".5"/>')
    if sid == "park_rowboat":
        return (_sky("#a9d4f2", "#f4f0dc", u) + _skyline("#9fb3c8", 70, 0, 5) + '<rect x="0" y="66" width="240" height="14" fill="#7ea67c"/>'
                + '<rect x="0" y="80" width="240" height="70" fill="#5d9fc9"/>'
                + '<path d="M0 100q30-6 60 0t60 0 60 0 60 0" fill="none" stroke="#9fd0ee" stroke-width="2"/><path d="M0 128q30-6 60 0t60 0 60 0 60 0" fill="none" stroke="#9fd0ee" stroke-width="2"/>'
                + f'<path d="M80 108h80l-10 16H92z" fill="#b5651d"/><path d="M80 108h80" stroke="{_CREAM}" stroke-width="3"/><path d="M104 108l-26 14M140 108l26 14" stroke="#6b4a2f" stroke-width="3" stroke-linecap="round"/>'
                + _trees("#5b9a62", (22, 214), 86, 13))
    if sid == "met_morning":
        return (_sky("#cfe4f6", "#fdf3d8", u) + f'<path d="M40 70h160L120 40z" fill="{_STONE2}"/><rect x="40" y="70" width="160" height="6" fill="{_STONE}"/>'
                + _columns(52, 76, 8, 20, 40, _CREAM) + f'<rect x="36" y="116" width="168" height="6" fill="{_STONE}"/><rect x="28" y="122" width="184" height="6" fill="{_STONE2}"/><rect x="0" y="128" width="240" height="22" fill="#c9b99a"/>'
                + '<path d="M70 18c30-10 70-10 100 0" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/>')
    if sid == "ninth_dumplings":
        return ('<rect width="240" height="150" fill="#e8c9a0"/><ellipse cx="120" cy="104" rx="84" ry="26" fill="#a86c3a"/><ellipse cx="120" cy="98" rx="76" ry="22" fill="#d79a5b"/>'
                + "".join(f'<path d="M{x} 96q12-22 28 0z" fill="#fbf1de" stroke="#d6c3a1" stroke-width="1.5"/>' for x in (66, 106, 146))
                + "".join(f'<path d="M{x} {y}q-6-10 0-18t0-16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>' for x, y in ((90, 70), (122, 66), (154, 70))))
    if sid == "top_of_rock":
        return (_sky("#14204a", "#e08f62", u) + _stars(((24, 14), (60, 30), (176, 12), (208, 36), (130, 20), (96, 10)))
                + '<circle cx="196" cy="34" r="11" fill="#fff4c8"/>' + _skyline("#1c2a52", 112, 0, 8, _LAMP)
                + '<rect x="0" y="118" width="240" height="32" fill="#0d1733"/><rect x="0" y="116" width="240" height="4" fill="#5a6fa0"/>'
                + '<path d="M0 116h240" stroke="#9fb6e4" stroke-width="1.5"/>' + "".join(f'<path d="M{x} 116v-14" stroke="#9fb6e4" stroke-width="1.5"/>' for x in range(8, 240, 24)))
    if sid == "high_line_evening":
        return (_sky("#f2a65a", "#fbe1b0", u) + '<circle cx="52" cy="70" r="20" fill="#fff0c0"/>' + _skyline("#8a6f8e", 96, 0, 2)
                + '<rect x="0" y="100" width="240" height="50" fill="#5d8f5a"/><path d="M0 128l240-14" stroke="#4b3d33" stroke-width="3"/><path d="M0 142l240-14" stroke="#4b3d33" stroke-width="3"/>'
                + "".join(f'<path d="M{x} {136 - x * .06}l-6 14" stroke="#6b4a2f" stroke-width="4"/>' for x in range(16, 240, 26))
                + "".join(f'<circle cx="{x}" cy="{108 + (x % 7)}" r="4" fill="{c}"/>' for x, c in ((30, "#e9c46a"), (80, "#d96c8a"), (150, "#e9c46a"), (200, "#d96c8a"))))
    if sid == "knicks_msg":
        return ('<rect width="240" height="150" fill="#1d2a4d"/><ellipse cx="120" cy="86" rx="100" ry="44" fill="#2e4577"/><ellipse cx="120" cy="86" rx="100" ry="44" fill="none" stroke="#6f87c0" stroke-width="3"/>'
                + f'<ellipse cx="120" cy="92" rx="70" ry="26" fill="#c98a4b"/><path d="M50 92h140M120 66v52" stroke="{_CREAM}" stroke-width="2"/><ellipse cx="120" cy="92" rx="14" ry="8" fill="none" stroke="{_CREAM}" stroke-width="2"/>'
                + '<circle cx="120" cy="32" r="14" fill="#e0782c"/><path d="M106 32h28M120 18v28M110 22c6 6 6 14 0 20M130 22c-6 6-6 14 0 20" stroke="#6b3200" stroke-width="1.6" fill="none"/>'
                + "".join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="{_LAMP}"/>' for x, y in ((40, 56), (62, 44), (178, 44), (200, 56))))
    if sid == "village_jazz":
        return (_sky("#241a45", "#4a2f66", u) + _skyline("#190f32", 100, 0, 6, "#ffb34a")
                + '<rect x="0" y="104" width="240" height="46" fill="#2a1a3a"/>'
                + "".join(f'<rect x="{12 + i * 20}" y="112" width="17" height="30" rx="2" fill="{_CREAM}"/>' for i in range(11))
                + "".join(f'<rect x="{20 + i * 20}" y="112" width="10" height="18" rx="2" fill="{_INK}"/>' for i in (0, 1, 3, 4, 5, 7, 8))
                + '<path d="M168 36a8 8 0 1 0 8 8V20l16 4v10" fill="none" stroke="#ffb34a" stroke-width="3.5" stroke-linecap="round"/><circle cx="168" cy="44" r="7" fill="#ffb34a"/>')
    if sid == "soho_gallery_hop":
        return ('<rect width="240" height="150" fill="#e9e2d2"/><rect y="118" width="240" height="32" fill="#c8bda4"/>'
                + '<rect x="22" y="30" width="56" height="64" fill="#fff"/><rect x="28" y="36" width="44" height="52" fill="#3d6fb6"/><circle cx="50" cy="62" r="14" fill="#f2c14e"/>'
                + '<rect x="96" y="22" width="52" height="40" fill="#fff"/><rect x="102" y="28" width="40" height="28" fill="#d9534f"/><path d="M102 56l14-16 10 10 6-6 10 12z" fill="#7a2320"/>'
                + '<rect x="96" y="72" width="52" height="30" fill="#fff"/><rect x="102" y="78" width="40" height="18" fill="#2f8f6b"/>'
                + '<rect x="166" y="34" width="52" height="60" fill="#fff"/><path d="M172 40h40v48h-40z" fill="#f6e7b4"/><path d="M178 80l12-30 8 18 8-12 6 24z" fill="#a34a8a"/>')
    if sid == "katz_deli":
        return ('<rect width="240" height="150" fill="#f1dcb8"/><ellipse cx="120" cy="118" rx="92" ry="14" fill="#c9a36d"/>'
                + '<path d="M50 96q70-34 140 0v8H50z" fill="#d9a35b"/><rect x="48" y="86" width="144" height="12" rx="5" fill="#8fb35a"/><rect x="46" y="76" width="148" height="14" rx="6" fill="#c0504d"/><rect x="50" y="66" width="140" height="12" rx="5" fill="#a63a38"/>'
                + '<path d="M50 56q70-34 140 0v10H50z" fill="#d9a35b"/>' + "".join(f'<circle cx="{x}" cy="{y}" r="1.4" fill="#fff0c8"/>' for x, y in ((90, 48), (118, 42), (146, 48), (170, 54), (70, 54)))
                + '<rect x="190" y="104" width="20" height="26" rx="2" fill="#fff"/><path d="M194 112h12M194 118h12" stroke="#c0504d" stroke-width="2"/>')
    if sid == "ferry_sunset":
        return (_sky("#f08a4b", "#fbd9a3", u) + '<circle cx="170" cy="78" r="24" fill="#ffe8a8"/>' + _skyline("#7b6d88", 86, 0, 11)
                + '<rect x="0" y="84" width="240" height="66" fill="#4a86b4"/><path d="M146 92h48M152 100h36M158 108h24" stroke="#ffd98e" stroke-width="3" stroke-linecap="round" opacity=".7"/>'
                + '<path d="M40 112h96l-12 16H52z" fill="#e8742a"/><rect x="56" y="94" width="60" height="18" fill="#fbf4e4"/><rect x="66" y="82" width="38" height="12" fill="#fbf4e4"/>'
                + "".join(f'<rect x="{x}" y="99" width="7" height="7" fill="#3d6a99"/>' for x in (62, 76, 90, 104)) + '<rect x="80" y="70" width="8" height="12" fill="#c0504d"/>')
    if sid == "cloisters_autumn":
        return (_sky("#c8def2", "#fbeccb", u) + f'<rect x="72" y="46" width="50" height="76" fill="{_STONE2}"/><path d="M72 46l25-22 25 22z" fill="#7d8aa0"/>'
                + f'<rect x="122" y="82" width="86" height="40" fill="{_STONE}"/>'
                + "".join(f'<path d="M{130 + i * 24} 122v-20a8 8 0 0 1 16 0v20z" fill="#5b4b3a"/>' for i in range(3))
                + f'<path d="M91 70v-8a6 6 0 0 1 12 0v8z" fill="#5b4b3a"/><rect x="0" y="122" width="240" height="28" fill="#c2894b"/>'
                + _trees("#e07b2c", (28, 54, 224), 124, 15) + _trees("#d9a21b", (40, 212), 122, 12))
    if sid == "brow_dinner":
        return (_sky("#0d1a3d", "#f09860", u) + _stars(((30, 14), (80, 28), (180, 10), (214, 30))) + _skyline("#1b2a55", 110, 0, 1, _LAMP)
                + '<rect x="96" y="14" width="26" height="112" fill="#27407a"/><path d="M104 14l5-10 5 10z" fill="#27407a"/>' + "".join(f'<rect x="{100 + c * 8}" y="{22 + r * 8}" width="3" height="4" fill="{_LAMP}"/>' for r in range(12) for c in range(3) if (r + c) % 2)
                + f'<rect x="0" y="120" width="240" height="30" fill="#2a1d24"/><rect x="34" y="112" width="172" height="6" rx="3" fill="{_CREAM}"/>'
                + f'<rect x="60" y="100" width="3" height="12" fill="{_CREAM}"/><circle cx="61.5" cy="96" r="3" fill="{_LAMP}"/><rect x="176" y="100" width="3" height="12" fill="{_CREAM}"/><circle cx="177.5" cy="96" r="3" fill="{_LAMP}"/>')
    # ---- events
    if sid == "leaves_riverside":
        leaves = "".join(f'<path d="M{x} {y}c6-8 14-8 18 0-6 8-14 8-18 0z" fill="{c}" transform="rotate({r} {x} {y})"/>' for x, y, c, r in ((30, 40, "#e07b2c", 20), (80, 70, "#c0504d", -30), (130, 36, "#d9a21b", 45), (176, 84, "#e07b2c", 10), (210, 46, "#c0504d", -50), (60, 104, "#d9a21b", 80), (150, 112, "#e07b2c", -10)))
        return _sky("#f6d9a4", "#fbf1d9", u) + '<rect x="0" y="116" width="240" height="34" fill="#b9873e"/>' + _trees("#e07b2c", (34, 90, 160, 210), 118, 20) + leaves
    if sid == "halloween_parade":
        pk = "".join(f'<ellipse cx="{x}" cy="104" rx="22" ry="19" fill="#ee8a2a"/><path d="M{x} 86v-8" stroke="#4b6b2f" stroke-width="4" stroke-linecap="round"/><path d="M{x - 8} 98l5 6h6l5-6z" fill="{_INK}"/>' for x in (56, 120, 184))
        return _sky("#1b1238", "#4a2a63", u) + '<circle cx="190" cy="28" r="14" fill="#fff0b8"/>' + _skyline("#120a28", 98, 0, 4) + pk + _stars(((24, 18), (80, 26), (140, 14)))
    if sid == "marathon_cheer":
        return (_sky("#bfe0f5", "#f6f3e2", u) + _trees("#e07b2c", (24, 60, 200, 222), 100, 17) + '<rect x="0" y="100" width="240" height="50" fill="#8fbf8a"/><path d="M0 124h240" stroke="#c9b99a" stroke-width="26"/>'
                + f'<rect x="30" y="30" width="6" height="94" fill="{_INK}"/><rect x="204" y="30" width="6" height="94" fill="{_INK}"/><rect x="30" y="30" width="180" height="22" fill="#2f6fb5"/>'
                + "".join(f'<rect x="{36 + i * 15}" y="{30 + (i % 2) * 11}" width="15" height="11" fill="{_CREAM}"/>' for i in range(12))
                + "".join(f'<path d="M{x} 100q8-26 16 0" fill="none" stroke="{c}" stroke-width="3"/>' for x, c in ((70, "#d9534f"), (110, "#f2c14e"), (150, "#4aa3df"))))
    if sid == "thanksgiving_balloons":
        b = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/><path d="M{x} {y + r}Q{x + 6} {y + r + 30} {x - 4} 138" stroke="#6a7a90" stroke-width="1.4" fill="none"/>' for x, y, r, c in ((52, 54, 26, "#d9534f"), (116, 42, 30, "#f2c14e"), (178, 60, 24, "#3d8bd9"), (210, 100, 14, "#58b27a")))
        return _sky("#a6d0f0", "#f4efd9", u) + b + '<rect x="0" y="136" width="240" height="14" fill="#8a8f98"/>'
    if sid == "holiday_windows":
        win = "".join(f'<rect x="{x}" y="38" width="64" height="72" rx="3" fill="#2a1114" stroke="{_LAMP}" stroke-width="3"/><path d="M{x + 32} 56l4 8h9l-7 6 3 9-9-5-9 5 3-9-7-6h9z" fill="{_LAMP}"/><rect x="{x + 6}" y="92" width="52" height="12" fill="#c0504d"/>' for x in (14, 88, 162))
        return '<rect width="240" height="150" fill="#3a1418"/>' + win + '<rect x="0" y="116" width="240" height="34" fill="#22181a"/>' + "".join(f'<circle cx="{x}" cy="26" r="2.4" fill="{_LAMP}"/>' for x in range(14, 240, 14))
    if sid == "rockefeller_tree":
        t = "".join(f'<path d="M{120 - w} {y + 26}L120 {y}l{w} 26z" fill="#2f7d4f"/>' for w, y in ((20, 40), (30, 58), (42, 80), (54, 104)))
        lights = "".join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="{c}"/>' for x, y, c in ((112, 60, "#f2c14e"), (128, 76, "#d9534f"), (104, 92, "#4aa3df"), (136, 100, "#f2c14e"), (96, 118, "#d9534f"), (146, 122, "#4aa3df"), (120, 108, "#f2c14e")))
        return _sky("#0f1c3c", "#2c4a7a", u) + _stars(((30, 20), (60, 44), (190, 18), (214, 50))) + _skyline("#16254a", 110, 0, 9, _LAMP) + t + '<path d="M120 28l3 8h9l-7 5 3 8-8-5-8 5 3-8-7-5h9z" fill="#ffd45a"/>' + lights + '<rect x="114" y="128" width="12" height="14" fill="#5b3a22"/><rect x="0" y="140" width="240" height="10" fill="#e8f0fa"/>'
    if sid == "ball_drop":
        return (_sky("#0e1030", "#3a2a6a", u) + _skyline("#161040", 112, 0, 12, "#ffb34a") + '<rect x="118" y="30" width="4" height="86" fill="#aab4cc"/><circle cx="120" cy="30" r="20" fill="#dfe8ff"/><circle cx="120" cy="30" r="20" fill="none" stroke="#9fb6e4" stroke-width="2"/><path d="M104 22l16 8 16-8M104 38l16-8 16 8M120 10v40" stroke="#9fb6e4" stroke-width="1.5" fill="none"/>'
                + "".join(f'<rect x="{x}" y="{y}" width="5" height="5" fill="{c}" transform="rotate({x} {x} {y})"/>' for x, y, c in ((24, 40, "#f2c14e"), (60, 70, "#d9534f"), (190, 50, "#4aa3df"), (212, 84, "#f2c14e"), (160, 24, "#d9534f"), (40, 96, "#4aa3df"))))
    if sid == "hot_chocolate_snow":
        snow = "".join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="#fff"/>' for x, y in ((20, 20), (54, 44), (90, 16), (150, 30), (200, 20), (220, 60), (30, 80), (190, 100), (70, 120)))
        return ('<rect width="240" height="150" fill="#b9cfe6"/>' + snow + '<path d="M82 62h76l-8 56a8 8 0 0 1-8 7H98a8 8 0 0 1-8-7z" fill="#c0504d"/><path d="M158 74h10a12 12 0 0 1 0 24h-12" fill="none" stroke="#c0504d" stroke-width="6"/>'
                + '<ellipse cx="120" cy="62" rx="38" ry="6" fill="#5b3420"/>' + "".join(f'<path d="M{x} 50q-7-9 0-16t0-14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>' for x in (104, 120, 136)) + '<rect x="0" y="132" width="240" height="18" fill="#f2f6fb"/>')
    if sid == "cherry_blossoms":
        bl = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>' for x, y, r, c in ((64, 60, 22, "#f6b8cf"), (96, 44, 24, "#f9c9dc"), (136, 56, 26, "#f6b8cf"), (176, 42, 22, "#f9c9dc"), (116, 74, 20, "#fbd7e4"), (200, 70, 16, "#f6b8cf"), (34, 78, 16, "#f9c9dc")))
        return _sky("#cfe8f8", "#f6f1e4", u) + '<path d="M110 130c0-30 6-50-14-72M110 100c18-14 30-24 38-44M120 130c0-20-4-30 6-44" stroke="#5b3d2a" stroke-width="7" fill="none" stroke-linecap="round"/>' + bl + '<rect x="0" y="122" width="240" height="28" fill="#9ccf94"/>' + "".join(f'<circle cx="{x}" cy="{y}" r="2.2" fill="#f9c9dc"/>' for x, y in ((40, 130), (82, 138), (150, 134), (200, 140)))
    if sid == "smorgasburg":
        aw = "".join(f'<path d="M{x} 54h64l4 22H{x - 4}z" fill="{c}"/>' + "".join(f'<rect x="{x + i * 16 - 2}" y="54" width="8" height="22" fill="{_CREAM}"/>' for i in range(4)) + f'<rect x="{x}" y="76" width="4" height="46" fill="#6b4a2f"/><rect x="{x + 60}" y="76" width="4" height="46" fill="#6b4a2f"/><rect x="{x - 2}" y="104" width="68" height="8" fill="#9a6b3a"/>' for x, c in ((10, "#d9534f"), (88, "#3d8bd9"), (166, "#f2c14e")))
        return _sky("#bfe0f5", "#fbf1d9", u) + _skyline("#9fb3c8", 56, 0, 7) + aw + '<rect x="0" y="122" width="240" height="28" fill="#c9b99a"/>'
    if sid == "shakespeare_park":
        return (_sky("#1f2f63", "#e9a06a", u) + _trees("#2f6a47", (18, 46, 200, 226), 112, 22) + '<path d="M92 120l-24-100h104l-24 100z" fill="#fff6d6" opacity=".22"/>'
                + f'<rect x="64" y="96" width="112" height="30" fill="#6b4a2f"/><rect x="64" y="92" width="112" height="6" fill="#8a6038"/>' + "".join(f'<circle cx="{x}" cy="{70 + abs(x - 120) // 12}" r="2.4" fill="{_LAMP}"/>' for x in range(64, 180, 12))
                + '<path d="M64 70Q120 90 176 70" fill="none" stroke="#c9b99a" stroke-width="1.4"/><rect x="0" y="126" width="240" height="24" fill="#2b4a36"/>')
    if sid == "july_fireworks":
        def burst(cx: int, cy: int, col: str, rr: int = 26) -> str:
            import math
            return "".join(f'<path d="M{cx} {cy}L{cx + rr * math.cos(a * math.pi / 6):.1f} {cy + rr * math.sin(a * math.pi / 6):.1f}" stroke="{col}" stroke-width="2.6" stroke-linecap="round"/>' for a in range(12)) + f'<circle cx="{cx}" cy="{cy}" r="3" fill="{col}"/>'
        return (_sky("#0b1230", "#2b2f66", u) + burst(70, 50, "#ffd45a") + burst(160, 36, "#ff7a8a", 22) + burst(190, 72, "#7ad0ff", 18)
                + _skyline("#10163a", 118, 0, 10, _LAMP) + '<rect x="0" y="118" width="240" height="32" fill="#1b2c5c"/><path d="M0 130q30-6 60 0t60 0 60 0 60 0" fill="none" stroke="#6f8fd6" stroke-width="2"/>')
    return _sky("#9cc7ee", "#eaf3fb", u) + _skyline("#7f9ab8", 118, 0, 2) + '<rect x="0" y="118" width="240" height="32" fill="#8fbf8a"/>'


def postcard_svg(item_id: str, cls: str = "pc__art") -> Markup:
    """The picture on a postcard or an experience card (a fixed palette on purpose: it is a painting, not UI)."""
    uid = "".join(ch for ch in item_id if ch.isalnum())[:24] or "x"
    return Markup(f'<svg class="{cls}" viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">{_scene(item_id)}</svg>')


def fact_for(item_id: str) -> str:
    return FACTS.get(item_id, "")


def collected_when(text: Any) -> str:
    """'2026-10-21T13:20:00Z' -> '21 Oct 2026'."""
    try:
        d = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return ""
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"
