"""Epoch game layer: "Your New York" (docs/game-design.md).

Every function here is a pure read model over the database, built on `rules.py`. XP, levels,
quests, towers, ladders and achievement *state* are computed on read from entries, outputs and
day status. The only things stored are:

* the append-only `unlocks` ledger (what has been celebrated, so it fires once), and
* the XP high-water mark (`unlocks.key = 'xp_hw'`), a ratchet so displayed XP never drops.

The game is a mirror, not a paycheck: nothing is spendable, nothing shrinks, and every string
shown to the user states a fact about the work (no instructions, no guilt copy; see BANNED_WORDS
and the tests).

Public entry points (section 9.3 of the design):
    day_xp, week_xp_bonus, xp_total, xp_banked, level_for, day_closed, best_run, floors_for,
    ladders, quests, achievements, wins, snapshot, diff_events, sync_unlocks,
    today_state, world_state, shelf_state, postcard_for, helping_report
Extras: seal_day, day_recap, toast_text, repeat_chips, finish_write, setting, GAME_DEFAULTS.

Writers (HTTP routes, Telegram, the scheduler) follow one pattern:

    before = game.snapshot(conn)
    ... write inside the existing transaction ...
    events = game.finish_write(conn, before, entry=..., output=...)   # sync_unlocks + diff_events

so a celebration is a diff between two snapshots and never replays on reload.
"""
from __future__ import annotations

import json
import logging
import math
import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable, Iterator

from . import categories, db, rules, timeutil

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Settings (game keys live next to db.DEFAULT_SETTINGS, with their own defaults)
# --------------------------------------------------------------------------

GAME_DEFAULTS: dict[str, Any] = {
    "game_enabled": True,
    "quiet_mode": False,
    "sound": False,
    "motion": "auto",          # auto | on | off
    "three_d": "auto",         # auto | off
    "sky_tz": "local",         # local | newyork
    "hide_achievements": False,
    "game_on_since": None,     # local date the game layer was first used (set by sync_unlocks)
    "minutes_per_floor": 15,
    "confetti_daily_cap": 3,
}


def setting(conn: sqlite3.Connection, key: str) -> Any:
    """A setting, falling back to GAME_DEFAULTS for the game keys."""
    value = db.get_setting(conn, key)
    if value is None and key in GAME_DEFAULTS:
        return GAME_DEFAULTS[key]
    return value


# --------------------------------------------------------------------------
# Constants: XP, districts, ladders, achievements, copy
# --------------------------------------------------------------------------

DEEP_MINUTES_PER_XP = 4
FLOOR_XP = 10
TARGET_XP = 15
OUTPUT_XP = 100
LINK_XP = 25
OUTPUT_XP_DAILY_CAP = 3
COMEBACK_XP = 30
CLOSED_XP = 10
WEEK_KEPT_XP = 100
NODE_XP = 50
STAR_DEEP_MINUTES = 240         # default goal of the third star (setting deep_star_minutes: 3, 4, 5 or 6 hours)

# (first level, last level, name, icon)
# The level ladder is a walk out from home across real Manhattan, and nothing outside it. Level 1 is Morningside Heights (the user's
# block and Columbia, lit from day one); each pair of levels lights the next neighbourhoods; the last level, the crown, is
# Billionaires' Row, the supertall corridor along 57th Street, which sits in soft mist from the first day so the goal is always in sight.
# XP maths are untouched (see level_for): only the names and the places they light up change.
DISTRICTS: list[tuple[int, int, str, str]] = [
    (1, 2, "Morningside Heights", "book-open"),
    (3, 4, "Harlem", "headphones"),
    (5, 6, "Upper West Side", "coffee"),
    (7, 8, "Central Park", "tent-tree"),
    (9, 10, "Upper East Side", "landmark"),
    (11, 12, "Hell's Kitchen", "flame"),
    (13, 14, "Midtown & Times Square", "sparkles"),
    (15, 16, "Chelsea", "image"),
    (17, 18, "Flatiron & Gramercy", "building-2"),
    (19, 20, "Greenwich Village", "landmark"),
    (21, 22, "SoHo & Tribeca", "layers"),
    (23, 24, "Lower East Side", "map-pin"),
    (25, 26, "Financial District", "train-front"),
    (27, 28, "Upper Manhattan", "sun"),
    (29, 10**6, "Billionaires' Row", "house"),
]

# Where each district lives on the map: ids are stable slugs, `ntas` are the NYC Neighborhood Tabulation Area codes the 3D city
# lights (city/manhattan/nta.json; all 38 Manhattan NTAs are covered exactly once). Billionaires' Row is not an NTA: it is a small
# corridor of its own (city/manhattan/brow.json) that the renderer keeps in mist until its level.
BROW_REGION = "BROW"
DISTRICT_META: dict[str, dict[str, Any]] = {
    "Morningside Heights": {"id": "morningside-heights", "ntas": ["MN0901"],
                            "arrival": "Home. Your block and Columbia are lit."},
    "Harlem": {"id": "harlem", "ntas": ["MN0902", "MN0903", "MN1001", "MN1002"],
               "arrival": "Manhattanville, Harlem and Hamilton Heights come on, just down the hill from home."},
    "Upper West Side": {"id": "upper-west-side", "ntas": ["MN0701", "MN0702", "MN0703"],
                        "arrival": "Brownstones and the long, leafy avenues down to Lincoln Square."},
    "Central Park": {"id": "central-park", "ntas": ["MN6491"],
                     "arrival": "The park is lit, end to end. Look for the Reservoir."},
    "Upper East Side": {"id": "upper-east-side", "ntas": ["MN0801", "MN0802", "MN0803", "MN1101", "MN1102"],
                        "arrival": "Museum Mile and the quiet streets across the park, up to East Harlem."},
    "Hell's Kitchen": {"id": "hells-kitchen", "ntas": ["MN0402"],
                       "arrival": "Low brick, loud restaurants, and the river at the end of every street."},
    "Midtown & Times Square": {"id": "midtown", "ntas": ["MN0502", "MN0604", "MN0661"],
                               "arrival": "The big lights: Times Square, Rockefeller Center, Grand Central. One corridor on 57th Street is still in the clouds."},
    "Chelsea": {"id": "chelsea", "ntas": ["MN0401"],
                "arrival": "The High Line, the galleries and the new towers at Hudson Yards."},
    "Flatiron & Gramercy": {"id": "flatiron-gramercy", "ntas": ["MN0501", "MN0601", "MN0602", "MN0603"],
                            "arrival": "The Flatiron, Union Square and Gramercy's gated park."},
    "Greenwich Village": {"id": "greenwich-village", "ntas": ["MN0202", "MN0203", "MN0303"],
                          "arrival": "Washington Square, the Arch and the crooked streets of the Village."},
    "SoHo & Tribeca": {"id": "soho-tribeca", "ntas": ["MN0201", "MN0102"],
                       "arrival": "Cast-iron lofts and cobblestones."},
    "Lower East Side": {"id": "lower-east-side", "ntas": ["MN0302", "MN0301"],
                        "arrival": "Chinatown and the Lower East Side, down to the bridges."},
    "Financial District": {"id": "financial-district", "ntas": ["MN0101", "MN0191"],
                           "arrival": "The tip of the island: Wall Street, One World Trade and the Battery."},
    "Upper Manhattan": {"id": "upper-manhattan", "ntas": ["MN1201", "MN1202", "MN1203", "MN1291", "MN1292", "MN1191"],
                        "arrival": "Washington Heights and Inwood. The whole island is lit, except one corridor still in the clouds on 57th Street."},
    "Billionaires' Row": {"id": "billionaires-row", "ntas": [], "region": BROW_REGION,
                          "arrival": "The penthouse light is on, and the park is in the window."},
}
FINAL_DISTRICT = DISTRICTS[-1][2]

# The dream: a home with Central Park in the window. One constant so it is easy to change later. The BIN is the NYC Department of
# Buildings Building Identification Number as it appears in the footprint data the 3D city is built from (see docs/MANHATTAN-DATA.md);
# any building listed in city/manhattan/brow.json works (111 W 57th is 1023728, 432 Park Avenue is 1088817).
DREAM_HOME_BIN = 1090180
DREAM_HOME: dict[str, Any] = {
    "bin": DREAM_HOME_BIN, "name": "Central Park Tower", "address": "217 W 57th St",
    "locked": "Your home, still in the clouds.",
    "locked_sub": "Billionaires' Row stays in mist until the last level. One window up there is waiting for you.",
    "unlocked": "Home, with the park in the window.",
    "unlocked_sub": "From up here the whole park lies north, and Morningside Heights is at the far end of it, where you started.",
}

# Node gates per ladder: (outputs, deep hours, outputs with a link). Estimates to tune.
NODE_GATES: list[tuple[int, int, int]] = [(1, 0, 0), (3, 5, 0), (6, 15, 0), (10, 40, 1), (15, 80, 3)]

LADDER_INFO: dict[str, dict[str, Any]] = {
    "Python": {"landmark": "Brooklyn Bridge", "kind": "bridge",
               "nodes": ["Hello Loop", "Data Wrangler", "NumPy Native", "Library Builder", "Ship It"]},
    "Math": {"landmark": "Empire State Building", "kind": "tower",
             "nodes": ["Vector Basics", "Matrix Moves", "Calculus Core", "Probability Pulse", "Proof Sketcher"]},
    "ML/DL": {"landmark": "Chrysler Building", "kind": "spire",
              "nodes": ["First Model", "Training Loop", "Backprop by Hand", "Architecture Tinkerer", "Reproduced Result"]},
    "Papers": {"landmark": "Butler Library", "kind": "dome",
               "nodes": ["First Read", "Summary Post", "Annotated Paper", "Reproduction", "Original Idea"]},
    "Writing/X": {"landmark": "One Times Square", "kind": "billboard",
                  "nodes": ["First Post", "Small Series", "Steady Voice", "Long-form", "Public Portfolio"]},
}

# Each ladder lights one real building (or, for Python, a real bridge) in the 3D city, section by section. `bin` is the building's NYC BIN
# in the footprint data (city/manhattan/notables.json lists them); the bridge has no BIN, `site` names it in the renderer.
# Papers stands at Butler Library, Columbia's main library: the one landmark of the five that is a walk from the user's own block.
LADDER_LANDMARKS: dict[str, dict[str, Any]] = {
    "Python": {"place": "Brooklyn Bridge", "bin": None, "site": "brooklyn-bridge", "light": "necklace lights on the cables"},
    "Math": {"place": "Empire State Building", "bin": 1015862, "site": None, "light": "the lit crown and the mast"},
    "ML/DL": {"place": "Chrysler Building", "bin": 1036156, "site": None, "light": "the terraced crown and the needle"},
    "Papers": {"place": "Butler Library", "bin": 1082165, "site": None, "light": "the colonnade and the roofline"},
    "Writing/X": {"place": "One Times Square", "bin": 1085682, "site": None, "light": "the screens around the tower"},
}

# Tiers and what a tier looks like when it fires.
TIER_SIZE = {"Easy": "small", "Mid": "small", "Rare": "medium", "Epic": "big"}
TIER_CONFETTI = {"small": 12, "medium": 40, "big": 60}

# Words that may never appear in user-facing copy (checked by tests, matched as whole words/phrases).
BANNED_WORDS = ("failed", "wasted", "lazy", "streak lost", "future self", "should", "last chance")
_BANNED_RX = re.compile(r"\b(" + "|".join(re.escape(w) for w in BANNED_WORDS) + r")\b", re.IGNORECASE)


def has_banned_words(text: str) -> bool:
    return bool(_BANNED_RX.search(text or ""))


# Plainly fictional illustrations (labelled as such in the UI). Nothing here is a real-world claim.
POSTCARDS: list[dict[str, str]] = [
    {"id": "coffee_cart", "title": "Coffee cart, early", "caption": "A coffee cart on a corner before the street wakes up."},
    {"id": "fire_escape", "title": "Fire escape with a plant", "caption": "One plant on a fire escape, third floor, catching the sun."},
    {"id": "bodega_dusk", "title": "Corner shop at dusk", "caption": "A corner shop with its sign just switched on."},
    {"id": "water_tower", "title": "Rooftop water tower", "caption": "A wooden water tower above a row of lit windows."},
    {"id": "rain_crossing", "title": "Crosswalk in the rain", "caption": "Umbrellas at a crossing, taxi lights on the wet road."},
    {"id": "subway_steam", "title": "Stairs and steam", "caption": "Steam rising from a grate beside the stairs down."},
    {"id": "park_bench", "title": "Park bench, leaves", "caption": "A bench with a few leaves on it. Nobody is sitting."},
    {"id": "cab_stand", "title": "Cab stand at night", "caption": "A row of cabs waiting under one streetlight."},
]
COMEBACK_CARD = {"id": "crane_morning", "title": "Crane at first light", "caption": "A crane against a pale sky, one beam already in the air."}
DISTRICT_CARDS: dict[str, dict[str, str]] = {
    "Harlem": {"id": "harlem_stoops", "title": "Stoops on a Harlem block", "caption": "Brownstone steps, a record playing somewhere above."},
    "Upper West Side": {"id": "uws_avenue", "title": "Avenue of trees", "caption": "A wide avenue with a row of lit lobbies and a dog-walker's long shadow."},
    "Central Park": {"id": "park_lamps", "title": "Lamps along the Mall", "caption": "Old lamps along a path of bare trees at blue hour."},
    "Upper East Side": {"id": "museum_steps", "title": "Museum steps", "caption": "Wide steps, tall doors and one banner lit from below."},
    "Hell's Kitchen": {"id": "kitchen_row", "title": "Restaurant row", "caption": "Awnings, string lights and the river at the end of the street."},
    "Midtown & Times Square": {"id": "avenue_lights", "title": "Avenue of lights", "caption": "A long avenue with every window on."},
    "Chelsea": {"id": "high_line", "title": "The High Line at dusk", "caption": "A path of grass on an old rail line, with towers rising behind it."},
    "Flatiron & Gramercy": {"id": "flatiron_corner", "title": "A wedge of stone", "caption": "A narrow stone building at the corner of two avenues."},
    "Greenwich Village": {"id": "arch_fountain", "title": "Arch and fountain", "caption": "A white arch at the end of a path of trees."},
    "SoHo & Tribeca": {"id": "cast_iron", "title": "Cast-iron street", "caption": "Tall iron windows and cobblestones, one lamp lit."},
    "Lower East Side": {"id": "bridge_view", "title": "Under the bridges", "caption": "The arches of two old bridges and the East River between them."},
    "Financial District": {"id": "harbor_tip", "title": "The tip of the island", "caption": "Narrow streets ending in water and a long, low ferry."},
    "Upper Manhattan": {"id": "bridge_towers", "title": "The grey bridge", "caption": "A great bridge across the river, its two towers lit at dusk."},
    "Billionaires' Row": {"id": "park_window", "title": "The park in the window", "caption": "A warm window high above the trees, and a long dark park running north toward home."},
}

# Decor unlocked by kept weeks, in a fixed order (never random).
DECOR = ["Cab stand", "Hot dog cart", "Rooftop water tower", "Newsstand", "Bike rack", "Flower stall", "Park bench", "Striped awning"]

# icons for categories in the wins feed (names from the Lucide sprite)
CATEGORY_ICON = {
    "Python": "terminal", "Math": "sigma", "ML/DL": "brain", "Papers": "book-open", "Writing/X": "pen-line",
    "Rest": "tent-tree", "Distracted": "smartphone", "Unknown": "circle-help",
}

HONEST_CATEGORIES = ("Rest", "Distracted", "Unknown")
NO_LAMP_CATEGORIES = ("Unknown", "Sleep", "Day job")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Achievements: key, name, tier, plain-words rule. `ledger` is the unlocks key.
_ACH_ROWS: list[tuple[str, str, str, str]] = [
    ("first_light", "First Light", "Easy", "First entry ever."),
    ("honest_hour", "Honest Hour", "Easy", "First entry in Distracted, Rest or Unknown."),
    ("first_floor", "Doors Open", "Easy", "First floor day."),
    ("first_ship", "First Ship", "Easy", "First output."),
    ("first_close", "Lights Out", "Easy", "First closed day."),
    ("first_focus", "In the Zone", "Easy", "First focus session finished."),
    ("honest_week", "Honest Week", "Mid", "7 days in a row, each with a rest, drift or Unknown log."),
    ("fog_lifter", "Fog Lifter", "Mid", "10 foggy stretches labelled at Close."),
    ("crown_x3", "Three Crowns", "Mid", "3 target days in one week."),
    ("week_kept", "Card Complete", "Mid", "First kept week."),
    ("five_ships", "Portfolio Started", "Mid", "5 outputs in total."),
    ("linked_ship", "Receipts", "Mid", "First output with a link."),
    ("all_five", "Five Ladders", "Mid", "At least one output in each of the 5 ladders."),
    ("clear_skies", "Clear Skies", "Mid", "3 quest stars in one day."),
    ("gold_week", "Golden Week", "Rare", "3 three-star days in one week."),
    ("seven_clear", "Seven Clear Days", "Epic", "7 three-star days in a row."),
    ("early_floor", "Early Doors", "Mid", "A floor day whose floor was met before 12:00."),
    ("first_comeback", "Crane Day", "Rare", "First comeback day."),
    ("comeback_3", "Rebuilder", "Rare", "3 comeback days."),
    ("four_kept", "A Full Block", "Rare", "4 kept weeks."),
    ("node_first", "Landmark Begun", "Rare", "First ladder node."),
    ("landmark", "Skyline Piece", "Rare", "Any ladder reaches node 5."),
    ("ten_close", "Ten Nights Sealed", "Rare", "10 closed days."),
    ("fifty_hours", "50 Deep Hours", "Rare", "50 deep hours in total (within the daily cap)."),
    ("hundred_hours", "100 Deep Hours", "Rare", "100 deep hours in total (within the daily cap)."),
    ("thirty_ships", "A Body of Work", "Rare", "30 outputs in total."),
]
for _first, _last, _name, _icon in DISTRICTS[1:]:
    _ACH_ROWS.append((
        "district_" + re.sub(r"[^a-z]+", "_", _name.lower()).strip("_"),
        f"Arrival: {_name}", "Epic", f"Reach Level {_first}, {_name}.",
    ))


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def fmt_min(minutes: int | float) -> str:
    m = max(0, int(round(minutes)))
    if m >= 60:
        return f"{m // 60}h {m % 60}m" if m % 60 else f"{m // 60}h"
    return f"{m}m"


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:]


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


@contextmanager
def _atomic(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    if conn.in_transaction:
        yield conn
    else:
        with db.transaction(conn):
            yield conn


_UNLOCKS_DDL = (
    "CREATE TABLE IF NOT EXISTS unlocks (key TEXT PRIMARY KEY, kind TEXT NOT NULL, "
    "unlocked_at TEXT NOT NULL, meta TEXT)"
)


def _day_str(d: date) -> str:
    return d.isoformat()


def _cum_xp(level: int) -> int:
    """XP needed to reach `level` (level 1 = 0)."""
    return 150 * (level - 1) + 25 * level * (level - 1)


def district_for(level: int) -> str:
    for first, last, name, _icon in DISTRICTS:
        if first <= level <= last:
            return name
    return DISTRICTS[-1][2]


def district_icon(name: str) -> str:
    for _first, _last, n, icon in DISTRICTS:
        if n == name:
            return icon
    return "building-2"


def district_id(name: str) -> str:
    return DISTRICT_META.get(name, {}).get("id") or re.sub(r"[^a-z]+", "-", name.lower()).strip("-")


def unlocked_districts(level: int) -> list[dict]:
    """Every district up to and including the one `level` is in, in ladder order."""
    return [{"id": district_id(n), "name": n, "first": f, "last": None if l >= 10**6 else l, "icon": i}
            for f, l, n, i in DISTRICTS if f <= level]


def lit_regions(level: int) -> list[str]:
    """What the 3D city lights at `level`: NTA codes of every unlocked district, plus 'BROW' once Billionaires' Row is reached.
    Billionaires' Row is never lit by the NTA codes around it, so it stays in mist while Midtown is open."""
    out: list[str] = []
    for first, _last, name, _icon in DISTRICTS:
        if first <= level:
            meta = DISTRICT_META[name]
            out += meta["ntas"]
            if meta.get("region"):
                out.append(meta["region"])
    return out


def districts_block(level: "Level | int") -> dict:
    """The district ladder as the 3D city and the World page need it (part of GET /api/world)."""
    lv = level if isinstance(level, Level) else level_for(_cum_xp(int(level)))
    n = lv.number
    items = []
    for first, last, name, icon in DISTRICTS:
        meta = DISTRICT_META[name]
        items.append({
            "id": meta["id"], "name": name, "icon": icon, "first": first, "last": None if last >= 10**6 else last,
            "unlocked": n >= first, "current": first <= n <= last, "ntas": list(meta["ntas"]), "region": meta.get("region"),
            "arrival": meta["arrival"],
        })
    cur = next(i for i in items if i["current"])
    nxt = next((i for i in items if not i["unlocked"]), None)
    home_on = n >= DISTRICTS[-1][0]
    return {
        "list": items, "current": cur["id"], "next": ({"id": nxt["id"], "name": nxt["name"], "level": nxt["first"]} if nxt else None),
        "unlocked": lit_regions(n), "all_lit": home_on, "final": {"id": district_id(FINAL_DISTRICT), "name": FINAL_DISTRICT, "level": DISTRICTS[-1][0]},
        "dream_home": {**DREAM_HOME, "lit": home_on},
    }


# --------------------------------------------------------------------------
# Levels
# --------------------------------------------------------------------------

@dataclass
class Level:
    number: int
    district: str
    xp: int
    into: int       # XP into this level
    needed: int     # XP from this level to the next (150 + 50 * level)
    progress: float

    @property
    def to_next(self) -> int:
        return max(0, self.needed - self.into)

    def as_dict(self) -> dict:
        return {
            "number": self.number, "district": self.district, "xp": self.xp, "into": self.into,
            "needed": self.needed, "progress": round(self.progress, 4), "to_next": self.to_next,
        }


def level_for(xp: int) -> Level:
    """Level maths: cost(L -> L+1) = 150 + 50 L, cumulative(L) = 25 L^2 + 125 L - 150."""
    xp = max(0, int(xp))
    level = max(1, int((-125 + math.sqrt(125 * 125 + 100 * (xp + 150))) // 50))
    while _cum_xp(level + 1) <= xp:
        level += 1
    while level > 1 and _cum_xp(level) > xp:
        level -= 1
    into = xp - _cum_xp(level)
    needed = 150 + 50 * level
    return Level(level, district_for(level), xp, into, needed, into / needed)


def floors_for(deep_minutes: int, minutes_per_floor: int = 15, cap: int = 240) -> int:
    """Storeys for a day: 1 per `minutes_per_floor` deep minutes, none past the cap (16 floors at defaults)."""
    return max(0, min(int(deep_minutes), int(cap))) // max(1, int(minutes_per_floor))


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------

@dataclass
class XPBreakdown:
    d: date
    deep: int
    floor: int
    target: int
    outputs: int
    comeback: int
    closed: int
    total: int


@dataclass
class Node:
    n: int
    name: str
    unlocked: bool
    needs_outputs: int
    needs_deep_min: int
    needs_link: int

    def as_dict(self) -> dict:
        return {
            "n": self.n, "name": self.name, "unlocked": self.unlocked, "needs_outputs": self.needs_outputs,
            "needs_deep_min": self.needs_deep_min, "needs_link": self.needs_link,
        }


@dataclass
class LadderState:
    category: str
    landmark: str
    outputs: int
    deep_minutes: int
    linked: int
    nodes: list[Node]
    next_node: Node | None
    kind: str = ""

    @property
    def nodes_unlocked(self) -> int:
        return sum(1 for node in self.nodes if node.unlocked)

    def next_text(self) -> str:
        """Informational only: what the next node needs, never pressure."""
        node = self.next_node
        if node is None:
            return "Landmark complete."
        bits = []
        more_out = max(0, node.needs_outputs - self.outputs)
        more_min = max(0, node.needs_deep_min - self.deep_minutes)
        more_link = max(0, node.needs_link - self.linked)
        if more_out:
            bits.append(_plural(more_out, "more output"))
        if more_link:
            bits.append(_plural(more_link, "linked output"))
        if more_min:
            bits.append(f"{fmt_min(more_min)} of {self.category}")
        return "Next node: " + (" and ".join(bits) if bits else node.name) + "."

    def as_dict(self) -> dict:
        return {
            "category": self.category, "landmark": self.landmark, "kind": self.kind, "outputs": self.outputs,
            "deep_minutes": self.deep_minutes, "linked": self.linked, "nodes_unlocked": self.nodes_unlocked,
            "nodes": [node.as_dict() for node in self.nodes],
            "next_node": self.next_node.as_dict() if self.next_node else None, "next_text": self.next_text(),
        }


@dataclass
class Quest:
    key: str
    label: str
    done: bool
    detail: str = ""      # a plain progress line under the label, e.g. "2h 10m of 4h"

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "done": self.done, "detail": self.detail}


@dataclass
class AchState:
    key: str
    name: str
    tier: str
    desc: str
    unlocked: bool
    unlocked_at: str | None

    def as_dict(self) -> dict:
        return {
            "key": self.key, "name": self.name, "tier": self.tier, "desc": self.desc,
            "unlocked": self.unlocked, "unlocked_at": self.unlocked_at,
        }


@dataclass(frozen=True)
class Snapshot:
    floors_today: int
    floor_met: bool
    target_met: bool
    outputs_today: int
    outputs_week: int
    week_status: str
    is_comeback_today: bool
    repaired: tuple
    xp: int
    level: int
    district: str
    nodes: frozenset
    achievements: frozenset
    closed_today: bool
    lamps_today: int
    # extras the event copy needs
    deep_minutes_today: int = 0
    target_minutes: int = 0
    entries_today: int = 0
    mark_today: str | None = None
    skips_left: int = 0
    outputs_required: int | None = None
    floor_days: int = 0
    floor_days_required: int | None = None
    comeback_since: str | None = None
    flow_best_hours: int = 0        # whole hours of the day's best flow chain (v2)
    stars_today: int = 0            # quest stars on today's roof; 3 turns the crown gold (economy: the $50 three-star bonus)


# --------------------------------------------------------------------------
# The context: one `rules._Calc` plus game-level caches for a single computation
# --------------------------------------------------------------------------

@dataclass
class _Entry:
    id: int
    start: datetime
    end: datetime
    category: str
    deep: bool
    source: str
    note: str | None
    day: date
    minutes: int

    @property
    def is_job_block(self) -> bool:
        return self.category == "Day job" and self.note == rules.JOB_BLOCK_NOTE


@dataclass
class _Output:
    id: int
    day: date
    stage: str
    url: str | None
    what: str
    created_at: str
    verified_by: str
    is_public: bool


class _Ctx:
    """Settings, the shared rules calculator and lazy caches for one computation."""

    def __init__(self, conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> None:
        self.conn = conn
        self.calc = rules._Calc(conn, today)  # the single source of day status; see rules.py
        self.s = self.calc.s
        self.today = self.calc.today
        self.start = self.calc.start
        self.tz = self.calc.tz
        self.dsh = self.calc.day_start_hour
        self.now = now or timeutil.now_utc()
        self.cap = int(self.s["deep_cap_minutes"])
        self.mpf = max(1, int(setting(conn, "minutes_per_floor") or 15))
        self.max_floors = max(1, self.cap // self.mpf)
        self.deep_star = deep_star_minutes(self.s)
        self._c: dict[Any, Any] = {}

    def day_number(self, d: date | None = None) -> int:
        """The day number of a local day (the start date is Day 1)."""
        return timeutil.day_number(self.start, d or self.today)

    def _memo(self, key: Any, fn: Callable[[], Any]) -> Any:
        if key not in self._c:
            self._c[key] = fn()
        return self._c[key]

    # --- raw rows ------------------------------------------------------

    @property
    def entries(self) -> list[_Entry]:
        def load() -> list[_Entry]:
            rows = self.conn.execute(
                "SELECT id, start_utc, end_utc, category, deep, source, note FROM entries "
                "WHERE deleted = 0 ORDER BY start_utc, id"
            ).fetchall()
            out = []
            for r in rows:
                start, end = timeutil.from_iso(r["start_utc"]), timeutil.from_iso(r["end_utc"])
                out.append(_Entry(
                    r["id"], start, end, r["category"], bool(r["deep"]), r["source"], r["note"],
                    timeutil.local_date_of(start, self.tz, self.dsh),
                    max(0, int(round((end - start).total_seconds() / 60))),
                ))
            return out
        return self._memo("entries", load)

    @property
    def entries_by_day(self) -> dict[date, list[_Entry]]:
        def build() -> dict[date, list[_Entry]]:
            grouped: dict[date, list[_Entry]] = {}
            for e in self.entries:
                grouped.setdefault(e.day, []).append(e)
            return grouped
        return self._memo("ebd", build)

    @property
    def outputs(self) -> list[_Output]:
        def load() -> list[_Output]:
            rows = self.conn.execute(
                "SELECT id, local_date, stage, url, what, created_at, verified_by, is_public FROM outputs "
                "WHERE deleted = 0 ORDER BY local_date, id"
            ).fetchall()
            return [
                _Output(r["id"], date.fromisoformat(r["local_date"]), r["stage"], (r["url"] or "").strip() or None,
                        r["what"], r["created_at"], r["verified_by"], bool(r["is_public"]))
                for r in rows
            ]
        return self._memo("outputs", load)

    @property
    def outputs_by_day(self) -> dict[date, list[_Output]]:
        def build() -> dict[date, list[_Output]]:
            grouped: dict[date, list[_Output]] = {}
            for o in self.outputs:
                grouped.setdefault(o.day, []).append(o)
            return grouped
        return self._memo("obd", build)

    @property
    def ledger(self) -> dict[str, dict]:
        def load() -> dict[str, dict]:
            try:
                rows = self.conn.execute("SELECT key, kind, unlocked_at, meta FROM unlocks").fetchall()
            except sqlite3.OperationalError:  # an old database that has not been re-initialised yet
                return {}
            return {r["key"]: {"kind": r["kind"], "unlocked_at": r["unlocked_at"], "meta": r["meta"]} for r in rows}
        return self._memo("ledger", load)

    # --- days and weeks --------------------------------------------------

    def days(self) -> list[date]:
        def build() -> list[date]:
            out, d = [], self.start
            while d <= self.today:
                out.append(d)
                d += timedelta(days=1)
            return out
        return self._memo("days", build)

    def summary(self, d: date) -> rules.DaySummary:
        return self.calc.summary(d)

    def week(self, d: date) -> rules.WeekSummary:
        monday = timeutil.week_monday(d)
        return self._memo(("week", monday), lambda: self.calc.week(monday))

    def mondays(self) -> list[date]:
        def build() -> list[date]:
            out, m = [], timeutil.week_monday(self.start)
            while m <= timeutil.week_monday(self.today):
                out.append(m)
                m += timedelta(days=7)
            return out
        return self._memo("mondays", build)

    def kept_mondays(self) -> list[date]:
        return self._memo("kept", lambda: [m for m in self.mondays() if self.week(m).status == "kept"])

    def card_mondays(self) -> list[date]:
        """Kept weeks plus weeks whose postcard is already in the ledger, so cards and decor never vanish."""
        def build() -> list[date]:
            found = set(self.kept_mondays())
            for key in self.ledger:
                if key.startswith("postcard:week_kept:"):
                    try:
                        found.add(date.fromisoformat(key.split(":", 2)[2]))
                    except ValueError:
                        pass
            return sorted(found)
        return self._memo("card_mondays", build)

    def comeback_days(self) -> list[date]:
        return self._memo("comebacks", lambda: [d for d in self.days() if self.summary(d).is_comeback])

    def repair_window(self) -> date | None:
        return self._memo("repair", lambda: rules.open_repair_window(self.conn, self.today))

    # --- closing a day --------------------------------------------------------

    def closed(self, d: date) -> bool:
        """Derived: no gaps left, the job block answered (job days), and the day has some content."""
        def compute() -> bool:
            if d < self.start or d > self.today:
                return False
            s = self.summary(d)
            if s.logged_minutes <= 0 and s.outputs_count <= 0:
                return False
            if d == self.today:
                # Today's gap window only runs up to `now`, so an early "no gaps" is not a closed day:
                # before the evening threshold it needs the whole day up to bedtime to be covered.
                bed = timeutil.at_local(d, self.s["bedtime"], self.tz, self.dsh)
                if self.now < bed - timedelta(minutes=60) and rules.gaps(self.conn, d, end_utc=bed):
                    return False
            return not self.gap_list(d) and (not self.calc.is_job_day(d) or rules.job_block_closed(self.conn, d))
        return self._memo(("closed", d), compute)

    def gap_list(self, d: date) -> list[tuple[datetime, datetime]]:
        def compute() -> list[tuple[datetime, datetime]]:
            end = timeutil.at_local(d, self.s["bedtime"], self.tz, self.dsh)
            if d == self.today:
                end = min(end, self.now)
            return rules.gaps(self.conn, d, end_utc=end)
        return self._memo(("gaps", d), compute)

    def closed_days(self) -> list[date]:
        return self._memo("closed_days", lambda: [d for d in self.days() if self.closed(d)])

    # --- XP ---------------------------------------------------------------------

    def day_xp(self, d: date) -> XPBreakdown:
        def compute() -> XPBreakdown:
            if d < self.start or d > self.today:
                return XPBreakdown(d, 0, 0, 0, 0, 0, 0, 0)
            s = self.summary(d)
            deep = min(s.deep_minutes, self.cap) // DEEP_MINUTES_PER_XP
            floor = FLOOR_XP if s.status in ("floor", "repaired") else 0
            target = TARGET_XP if s.target_met else 0
            outs = self.outputs_by_day.get(d, [])[:OUTPUT_XP_DAILY_CAP]
            outputs = sum(OUTPUT_XP + (LINK_XP if o.url else 0) for o in outs)
            comeback = COMEBACK_XP if s.is_comeback else 0
            closed = CLOSED_XP if self.closed(d) else 0
            return XPBreakdown(d, deep, floor, target, outputs, comeback, closed,
                               deep + floor + target + outputs + comeback + closed)
        return self._memo(("dayxp", d), compute)

    def xp_total(self) -> int:
        def compute() -> int:
            total = sum(self.day_xp(d).total for d in self.days())
            total += sum(WEEK_KEPT_XP for _ in self.kept_mondays())
            total += NODE_XP * sum(lad.nodes_unlocked for lad in self.ladders())
            return total
        return self._memo("xp_total", compute)

    def xp_hw(self) -> int:
        row = self.ledger.get("xp_hw")
        if not row or not row["meta"]:
            return 0
        try:
            return int(json.loads(row["meta"]).get("xp", 0))
        except (ValueError, TypeError, AttributeError):
            return 0

    def xp_banked(self) -> int:
        return max(self.xp_total(), self.xp_hw())

    def level(self) -> Level:
        return level_for(self.xp_banked())

    # --- ladders ----------------------------------------------------------------

    def capped_by_category(self, s: rules.DaySummary) -> dict[str, int]:
        """Deep minutes per category for one day, scaled down together when the day is over the cap."""
        total = sum(s.deep_by_category.values())
        if total <= self.cap or total == 0:
            return dict(s.deep_by_category)
        return {cat: minutes * self.cap // total for cat, minutes in s.deep_by_category.items()}

    def ladders(self) -> list[LadderState]:
        def compute() -> list[LadderState]:
            deep: dict[str, int] = {cat: 0 for cat in categories.LADDER}
            for d in self.days():
                for cat, minutes in self.capped_by_category(self.summary(d)).items():
                    if cat in deep:
                        deep[cat] += minutes
            outs = {cat: 0 for cat in categories.LADDER}
            linked = {cat: 0 for cat in categories.LADDER}
            for o in self.outputs:
                if o.stage in outs:
                    outs[o.stage] += 1
                    linked[o.stage] += 1 if o.url else 0
            result = []
            for cat in categories.LADDER:
                info = LADDER_INFO[cat]
                nodes, prefix_ok = [], True
                for i, (need_out, need_hours, need_link) in enumerate(NODE_GATES):
                    ok = prefix_ok and outs[cat] >= need_out and deep[cat] >= need_hours * 60 and linked[cat] >= need_link
                    ok = ok or f"node:{cat}:{i + 1}" in self.ledger     # once unlocked, a node stays unlocked
                    prefix_ok = ok
                    nodes.append(Node(i + 1, info["nodes"][i], ok, need_out, need_hours * 60, need_link))
                nxt = next((n for n in nodes if not n.unlocked), None)
                result.append(LadderState(cat, info["landmark"], outs[cat], deep[cat], linked[cat], nodes, nxt, info["kind"]))
            return result
        return self._memo("ladders", compute)

    def node_keys(self) -> frozenset:
        return frozenset(f"{lad.category}:{n.n}" for lad in self.ladders() for n in lad.nodes if n.unlocked)

    # --- towers -----------------------------------------------------------------

    def lamp_entries(self, d: date) -> list[_Entry]:
        out = []
        for e in self.entries_by_day.get(d, []):
            if e.is_job_block or e.category in NO_LAMP_CATEGORIES:
                continue
            if e.deep and categories.counts_toward_floor(e.category, d, self.calc.build_until):
                continue
            out.append(e)
        return out

    def real_entries(self, d: date) -> list[_Entry]:
        """Non-job entries that touch the day. rules.py clips intervals to the day, so an entry that
        starts before the day start and runs past it counts here as well."""
        def build() -> list[_Entry]:
            lo, hi = timeutil.day_bounds_utc(d, self.tz, self.dsh)
            pool = self.entries_by_day.get(d, []) + self.entries_by_day.get(d - timedelta(days=1), [])
            return sorted((e for e in pool if not e.is_job_block and (e.day == d or (e.start < hi and e.end > lo))),
                          key=lambda e: (e.start, e.id))
        return self._memo(("real", d), build)

    def fog(self, d: date) -> tuple[int, int]:
        """(unknown_minutes, unlogged_minutes) for a day. Empty past days have no fog: they are just empty lots."""
        if d < self.start or d > self.today:
            return 0, 0
        s = self.summary(d)
        unknown = sum(e.minutes for e in self.entries_by_day.get(d, []) if e.category == "Unknown")
        if d != self.today and s.logged_minutes <= 0 and s.outputs_count <= 0:
            return unknown, 0
        unlogged = sum(int(round((b - a).total_seconds() / 60)) for a, b in self.gap_list(d))
        return unknown, unlogged

    def stars(self, d: date) -> int:
        """Stars on a day's roof: first light, doors open, and the day's deep-focus goal (4 h by default)."""
        def compute() -> int:
            if d < self.start or d > self.today:
                return 0
            s = self.summary(d)
            real = self.real_entries(d)
            first = bool(real) or s.outputs_count > 0
            doors = s.floor_met
            # Deep minutes as the rules engine counts them (sleep cutoff applied) but NOT capped at the 240-min
            # XP/floor cap, so a 5 or 6 hour goal works. Same rule for today and past days. No XP is attached.
            third = s.deep_minutes >= self.deep_star
            return int(first) + int(doors) + int(third)
        return self._memo(("stars", d), compute)

    # --- tower dicts ----------------------------------------------------------------

    def tower(self, d: date) -> dict:
        def compute() -> dict:
            s = self.summary(d)
            live = self.start <= d <= self.today
            floors = floors_for(s.deep_minutes, self.mpf, self.cap) if live else 0
            target_floor = min(self.max_floors, max(1, math.ceil(s.target_minutes / self.mpf)))
            lamp_counts: dict[str, int] = {}
            for e in self.lamp_entries(d) if live else []:
                lamp_counts[e.category] = lamp_counts.get(e.category, 0) + 1
            unknown, unlogged = self.fog(d)
            outs = self.outputs_by_day.get(d, []) if live else []
            doors = bool(live and s.floor_met)
            crown = bool(live and s.target_met)
            scaffold = s.status == "missed" or (self.repair_window() == d)
            if not live:
                state = "future"
            elif crown:
                state = "crown"
            elif doors:
                state = "doors"
            elif s.deep_minutes > 0:
                state = "building"
            elif s.mark:
                state = "park"
            elif s.status == "missed":
                state = "scaffold"
            else:
                state = "lot"
            if s.status == "repaired":
                state = "repaired"
            return {
                "date": d.isoformat(), "dow": d.weekday(), "status": s.status, "is_today": d == self.today,
                "deep_minutes": s.deep_minutes if live else 0, "floors": floors, "target_floor": target_floor,
                "over_cap_min": max(0, s.deep_minutes - self.cap) if live else 0,
                "doors": doors, "crown": crown, "state": state,
                "max_floors": self.max_floors, "minutes_per_floor": self.mpf,
                "door_floor": min(self.max_floors, max(1, math.ceil(s.floor_minutes / self.mpf))),
                "next_floor_min": (self.mpf - min(s.deep_minutes, self.cap) % self.mpf)
                if live and floors < self.max_floors else None,
                "lamps": [{"category": c, "n": n} for c, n in lamp_counts.items()],
                "lamp_count": sum(lamp_counts.values()),
                "fog_minutes": unknown + unlogged, "unknown_minutes": unknown, "unlogged_minutes": unlogged,
                "outputs": [{"id": o.id, "stage": o.stage, "what": o.what, "url": o.url} for o in outs],
                "beacons": [o.stage for o in outs],
                "mark": s.mark if live else None, "park": bool(live and s.mark),
                "scaffold": bool(live and scaffold), "repair_open": bool(live and self.repair_window() == d),
                "crane": bool(live and s.is_comeback), "is_comeback": bool(live and s.is_comeback),
                "closed": self.closed(d) if live else False,
                "stars": self.stars(d) if live else 0,
            }
        return self._memo(("tower", d), compute)


# --------------------------------------------------------------------------
# XP, levels, runs (public)
# --------------------------------------------------------------------------

def day_xp(conn: sqlite3.Connection, d: date, today: date | None = None) -> XPBreakdown:
    """XP for one day with every cap applied (section 4.1)."""
    return _Ctx(conn, today).day_xp(d)


def week_xp_bonus(conn: sqlite3.Connection, monday: date, today: date | None = None) -> int:
    """+100 when the ISO week starting at `monday` is kept."""
    ctx = _Ctx(conn, today)
    return WEEK_KEPT_XP if ctx.week(monday).status == "kept" else 0


def xp_total(conn: sqlite3.Connection, today: date | None = None) -> int:
    """Computed XP: days + kept weeks + ladder nodes. May fall when an entry is deleted; see xp_banked."""
    return _Ctx(conn, today).xp_total()


def xp_banked(conn: sqlite3.Connection, today: date | None = None) -> int:
    """Displayed XP: max(computed, the stored high-water mark). The mark moves up in sync_unlocks."""
    return _Ctx(conn, today).xp_banked()


def day_closed(conn: sqlite3.Connection, d: date, today: date | None = None) -> bool:
    """Gaps empty and (on job days) the job block answered, for a day that has some content."""
    return _Ctx(conn, today).closed(d)


def best_run(conn: sqlite3.Connection, today: date | None = None) -> int:
    """Longest run of floor/skip/rest/repaired days in history. An open today never breaks a run."""
    ctx = _Ctx(conn, today)
    best = run = 0
    for d in ctx.days():
        status = ctx.calc.status(d)
        if status in rules.RUN_STATUSES:
            run += 1
            best = max(best, run)
        elif d == ctx.today and status == "open":
            continue
        else:
            run = 0
    return best


def ladders(conn: sqlite3.Connection, today: date | None = None) -> list[LadderState]:
    return _Ctx(conn, today).ladders()


# --------------------------------------------------------------------------
# Quests
# --------------------------------------------------------------------------

def _quests(ctx: _Ctx) -> list[Quest]:
    def compute() -> list[Quest]:
        d = ctx.today
        s = ctx.summary(d)
        real = ctx.real_entries(d)
        out: list[Quest] = []
        # 1. First light: any honest entry counts.
        out.append(Quest("first_light", "Log one hour of anything, rest and drift count", bool(real) or s.outputs_count > 0))
        # 2. Doors, then crown.
        if not s.floor_met:
            out.append(Quest("doors", f"{s.floor_minutes} min or one output opens the doors", False))
        elif not s.target_met:
            left = max(0, s.target_minutes - min(s.deep_minutes, ctx.cap))
            out.append(Quest("crown", f"{fmt_min(left)} to the crown", False))
        else:
            out.append(Quest("crown", "Crown lit", True))
        # 3. Deep focus for the day's goal (4 h by default; Settings: 3, 4, 5 or 6 h).
        out.append(_deep_quest(ctx, s))
        return out[:3]
    return ctx._memo("quests", compute)


def deep_star_minutes(settings: dict) -> int:
    """The third star's goal in minutes: the deep_star_minutes setting, kept to a sane 1 to 12 hours."""
    try:
        value = int(settings.get("deep_star_minutes") or STAR_DEEP_MINUTES)
    except (TypeError, ValueError):
        value = STAR_DEEP_MINUTES
    return min(720, max(60, value))


def _deep_quest(ctx: _Ctx, s: rules.DaySummary) -> Quest:
    """"Deep focus 4h today": the day's deep minutes (after the sleep cutoff, not capped at 240) against the goal."""
    goal = ctx.deep_star
    done = s.deep_minutes >= goal
    detail = f"{fmt_min(s.deep_minutes)} of {fmt_min(goal)}" + (", star earned" if done else "")
    return Quest("deep_focus", f"Deep focus {fmt_min(goal)} today", done, detail)


def quests(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> list[Quest]:
    """Three plain goals for today (first log, doors open, deep focus), deterministic, no XP, no guilt copy."""
    return list(_quests(_Ctx(conn, today, now)))


# --------------------------------------------------------------------------
# Achievements
# --------------------------------------------------------------------------

def _first_floor_time(ctx: _Ctx, d: date) -> datetime | None:
    """When the floor was met on a day: the earlier of the 30th deep minute and the first output."""
    s = ctx.summary(d)
    cands: list[datetime] = []
    for o in ctx.outputs_by_day.get(d, []):
        try:
            cands.append(timeutil.from_iso(o.created_at))
        except ValueError:
            pass
    deep = sorted(
        (e for e in ctx.entries_by_day.get(d, [])
         if e.deep and categories.counts_toward_floor(e.category, d, ctx.calc.build_until)),
        key=lambda e: e.end,
    )
    ivs: list[tuple[datetime, datetime]] = []
    for e in deep:
        ivs.append((e.start, e.end))
        total = sum((b - a).total_seconds() for a, b in rules._merge(ivs)) / 60
        if total >= s.floor_minutes:
            cands.append(e.end - timedelta(minutes=total - s.floor_minutes))
            break
    return min(cands) if cands else None


def _rules_for(ctx: _Ctx) -> dict[str, Callable[[], bool]]:
    entries, outs = ctx.entries, ctx.outputs
    days = ctx.days()

    def any_summary(pred: Callable[[rules.DaySummary], bool]) -> bool:
        return any(pred(ctx.summary(d)) for d in days)

    def honest_week() -> bool:
        honest = {e.day for e in entries if e.category in HONEST_CATEGORIES}
        run = 0
        for d in days:
            run = run + 1 if d in honest else 0
            if run >= 7:
                return True
        return False

    def fog_lifter() -> bool:
        return sum(1 for e in entries if e.source in ("backfill", "aw") and e.category not in ("Unknown", "Day job")) >= 10

    def crown_x3() -> bool:
        return any(sum(1 for day in ctx.week(m).days if day.target_met) >= 3 for m in ctx.mondays())

    def early_floor() -> bool:
        for d in days:
            if ctx.summary(d).floor_met:
                at = _first_floor_time(ctx, d)
                if at is not None:
                    local = at.astimezone(timeutil.zone(ctx.tz))
                    if local.hour < 12 and timeutil.local_date_of(at, ctx.tz, ctx.dsh) == d and local.hour >= ctx.dsh:
                        return True
        return False

    def clear_skies() -> bool:
        return any(ctx.stars(d) >= 3 for d in days)

    def gold_week() -> bool:
        return any(sum(1 for i in range(7) if m + timedelta(days=i) <= ctx.today and ctx.stars(m + timedelta(days=i)) >= 3) >= 3
                   for m in ctx.mondays())

    def seven_clear() -> bool:
        run = 0
        for d in days:
            run = run + 1 if ctx.stars(d) >= 3 else 0
            if run >= 7:
                return True
        return False

    def first_focus() -> bool:
        # the old timer's sessions, or any deep block rated on the Focus Screen (those are entries with source 'focus')
        return ctx.conn.execute(
            "SELECT 1 FROM focus_sessions WHERE outcome IN ('full', 'mostly') "
            "UNION ALL SELECT 1 FROM entries WHERE source = 'focus' AND deep = 1 AND deleted = 0 LIMIT 1"
        ).fetchone() is not None

    def counted_hours() -> int:
        return sum(min(ctx.summary(d).deep_minutes, ctx.cap) for d in days)

    ladder_states = ctx.ladders
    result: dict[str, Callable[[], bool]] = {
        "first_light": lambda: any(not e.is_job_block for e in entries),
        "honest_hour": lambda: any(e.category in HONEST_CATEGORIES for e in entries),
        "first_floor": lambda: any_summary(lambda s: s.floor_met),
        "first_ship": lambda: bool(outs),
        "first_close": lambda: bool(ctx.closed_days()),
        "first_focus": first_focus,
        "honest_week": honest_week,
        "fog_lifter": fog_lifter,
        "crown_x3": crown_x3,
        "week_kept": lambda: bool(ctx.kept_mondays()),
        "five_ships": lambda: len(outs) >= 5,
        "linked_ship": lambda: any(o.url for o in outs),
        "all_five": lambda: all(any(o.stage == c for o in outs) for c in categories.LADDER),
        "clear_skies": clear_skies,
        "gold_week": gold_week,
        "seven_clear": seven_clear,
        "early_floor": early_floor,
        "first_comeback": lambda: len(ctx.comeback_days()) >= 1,
        "comeback_3": lambda: len(ctx.comeback_days()) >= 3,
        "four_kept": lambda: len(ctx.kept_mondays()) >= 4,
        "node_first": lambda: any(lad.nodes_unlocked for lad in ladder_states()),
        "landmark": lambda: any(lad.nodes_unlocked >= 5 for lad in ladder_states()),
        "ten_close": lambda: len(ctx.closed_days()) >= 10,
        "fifty_hours": lambda: counted_hours() >= 50 * 60,
        "hundred_hours": lambda: counted_hours() >= 100 * 60,
        "thirty_ships": lambda: len(outs) >= 30,
    }
    for first, _last, name, _icon in DISTRICTS[1:]:
        key = "district_" + re.sub(r"[^a-z]+", "_", name.lower()).strip("_")
        result[key] = (lambda f=first: ctx.level().number >= f)
    return result


def _ach_ledger_key(key: str) -> str:
    if key.startswith("district_"):
        for _first, _last, name, _icon in DISTRICTS[1:]:
            if "district_" + re.sub(r"[^a-z]+", "_", name.lower()).strip("_") == key:
                return f"district:{name}"
    return f"ach:{key}"


def _achievements(ctx: _Ctx) -> list[AchState]:
    def compute() -> list[AchState]:
        rule_fns = _rules_for(ctx)
        out = []
        for key, name, tier, desc in _ACH_ROWS:
            row = ctx.ledger.get(_ach_ledger_key(key))
            unlocked = row is not None or bool(rule_fns[key]())
            out.append(AchState(key, name, tier, desc, unlocked, row["unlocked_at"] if row else None))
        return out
    return ctx._memo("achievements", compute)


def achievements(conn: sqlite3.Connection, today: date | None = None) -> list[AchState]:
    """Every achievement; unlocked = the rule holds now OR the ledger says it was unlocked once."""
    return list(_achievements(_Ctx(conn, today)))


def _ach_by_key(key: str) -> tuple[str, str, str]:
    for k, name, tier, desc in _ACH_ROWS:
        if k == key:
            return name, tier, desc
    return key, "Easy", ""


# --------------------------------------------------------------------------
# Wins feed, repeat chips
# --------------------------------------------------------------------------

def _entry_text(e: _Entry) -> str:
    label = (e.note or "").strip()
    return f"{fmt_min(e.minutes)} {label}" if label else f"{fmt_min(e.minutes)} {e.category}"


def repeat_chips(conn: sqlite3.Connection, today: date | None = None, limit: int = 3) -> list[dict]:
    return _repeat_chips(_Ctx(conn, today), limit)


def _repeat_chips(ctx: _Ctx, limit: int = 3) -> list[dict]:
    chips, seen = [], set()
    for e in reversed(ctx.entries):
        if e.is_job_block or e.category in ("Unknown", "Day job", "Sleep") or e.source in ("aw", "backfill") or e.minutes <= 0:
            continue
        sig = (e.category, e.minutes, (e.note or "").strip().lower())
        if sig in seen:
            continue
        seen.add(sig)
        chips.append({
            "category": e.category, "minutes": e.minutes, "note": (e.note or "").strip(), "deep": e.deep,
            "label": _entry_text(e),
        })
        if len(chips) >= limit:
            break
    return chips


def _iso(dt: datetime) -> str:
    return timeutil.to_iso(dt)


def _wins(ctx: _Ctx, limit: int = 20) -> list[dict]:
    items: list[dict] = []
    recent_cut = ctx.today - timedelta(days=20)

    # entries: deep work and rest are wins; drift and Unknown are honest logs, not a "losses list"
    for e in ctx.entries[-60:]:
        if e.is_job_block or e.day < recent_cut:
            continue
        if e.category in ("Day job", "Sleep", "Commute", "Other", "Admin"):
            continue
        # Distracted and Unknown are honest logs and weigh the same as a deep one; only bulk fill-ins stay out
        if e.source == "aw" or (e.category == "Unknown" and e.source == "backfill"):
            continue
        items.append({
            "kind": "log", "icon": CATEGORY_ICON.get(e.category, "check"), "category": e.category,
            "text": _entry_text(e), "at": _iso(e.end),
        })

    # outputs, with their place in the week's contract
    for o in ctx.outputs:
        if o.day < recent_cut:
            continue
        week = ctx.week(o.day)
        rank = 1 + sum(1 for x in week.outputs if x["id"] < o.id)
        req = week.outputs_required
        text = f"Output {min(rank, req)} of {req} this week" if req else f"Output {rank} this week"
        if req and rank > req:
            text += f" ({rank} shipped)"
        items.append({"kind": "output", "icon": "trophy", "category": o.stage, "text": text, "detail": o.what,
                      "at": _iso(_day_end(ctx, o.day, o.created_at))})

    # day-level facts
    for d in ctx.days():
        if d < recent_cut:
            continue
        s = ctx.summary(d)
        at = _iso(_last_activity(ctx, d))
        if s.target_met:
            items.append({"kind": "crown", "icon": "target", "text": f"Crown lit on a {WEEKDAYS[d.weekday()]}", "at": at})
        if s.is_comeback:
            items.append({"kind": "comeback", "icon": "building-2", "text": _comeback_line(ctx, d), "at": at})
        if s.status == "repaired":
            items.append({"kind": "repair", "icon": "layers", "text": f"{WEEKDAYS[d.weekday()]}'s lot is built", "at": at})

    # longest session so far (a record against your own past only)
    best, record = 0, None
    for e in ctx.entries:
        if e.deep and categories.counts_toward_floor(e.category, e.day, ctx.calc.build_until):
            if e.minutes > best:
                best, record = e.minutes, e
    if record is not None and record.day >= recent_cut and len([e for e in ctx.entries if e.deep]) >= 5:
        items.append({"kind": "record", "icon": "sparkles", "text": f"Longest session since you started: {fmt_min(best)}",
                      "at": _iso(record.end)})

    # kept weeks
    for m in ctx.kept_mondays():
        if m + timedelta(days=6) < recent_cut:
            continue
        w = ctx.week(m)
        end_day = min(w.sunday, ctx.today)
        items.append({
            "kind": "week_kept", "icon": "calendar-check",
            "text": f"Card complete: {w.outputs_count} of {w.outputs_required} outputs, {w.floor_days} of {w.floor_days_required} floor days",
            "at": _iso(_last_activity(ctx, end_day)),
        })

    # ledger unlocks (achievements, nodes) with their own timestamps
    for key, row in ctx.ledger.items():
        if '"backfill"' in (row["meta"] or ""):
            continue                      # earned before the game layer existed; not a fresh win
        if key.startswith("ach:"):
            k = key[4:]
            name, _tier, desc = _ach_by_key(k)
            items.append({"kind": "achievement", "icon": "shield-check", "text": f"{name}: {_lower_first(desc.rstrip('.'))}",
                          "at": row["unlocked_at"]})
        elif key.startswith("node:"):
            _, ladder, n = key.split(":")
            info = LADDER_INFO.get(ladder)
            if info:
                items.append({"kind": "node", "icon": "landmark", "category": ladder,
                              "text": f"{ladder}: {info['nodes'][int(n) - 1]} reached", "at": row["unlocked_at"]})

    items.sort(key=lambda w: (w["at"], w["kind"], w["text"]), reverse=True)
    out, seen = [], set()
    for w in items:
        sig = (w["kind"], w["text"], w["at"])
        if sig in seen:
            continue
        seen.add(sig)
        out.append(w)
        if len(out) >= limit:
            break
    return out


def wins(conn: sqlite3.Connection, limit: int = 20, today: date | None = None) -> list[dict]:
    """Derived, factual one-liners, newest first: {kind, icon, text, at, ...}. There is no losses list."""
    return _wins(_Ctx(conn, today), limit)


def _day_end(ctx: _Ctx, d: date, created_at: str) -> datetime:
    try:
        return timeutil.from_iso(created_at)
    except ValueError:
        return timeutil.day_bounds_utc(d, ctx.tz, ctx.dsh)[0]


def _last_activity(ctx: _Ctx, d: date) -> datetime:
    lo, hi = timeutil.day_bounds_utc(d, ctx.tz, ctx.dsh)
    ends = [e.end for e in ctx.entries_by_day.get(d, []) if not e.is_job_block]
    return min(max(ends), hi) if ends else lo


def _last_floor_day_before(ctx: _Ctx, d: date) -> date | None:
    probe = d - timedelta(days=1)
    for _ in range(90):
        if probe < ctx.start:
            return None
        if ctx.calc.status(probe) == "floor":
            return probe
        probe -= timedelta(days=1)
    return None


def _comeback_line(ctx: _Ctx, d: date) -> str:
    last = _last_floor_day_before(ctx, d)
    return f"Back on. First floor day since {WEEKDAYS[last.weekday()]}" if last else "Back on. First floor day after a quiet stretch"


# --------------------------------------------------------------------------
# Snapshots and events
# --------------------------------------------------------------------------

def _snapshot(ctx: _Ctx) -> Snapshot:
    d = ctx.today
    s = ctx.summary(d)
    week = ctx.week(d)
    level = ctx.level()
    tower = ctx.tower(d)
    comeback_since = None
    if s.is_comeback:
        last = _last_floor_day_before(ctx, d)
        comeback_since = WEEKDAYS[last.weekday()] if last else None
    return Snapshot(
        floors_today=tower["floors"], floor_met=s.floor_met, target_met=s.target_met,
        outputs_today=s.outputs_count, outputs_week=week.outputs_count, week_status=week.status,
        is_comeback_today=s.is_comeback,
        repaired=tuple(x for x in ctx.days() if ctx.calc.status(x) == "repaired"),
        xp=level.xp, level=level.number, district=level.district,
        nodes=ctx.node_keys(),
        achievements=frozenset(a.key for a in _achievements(ctx) if a.unlocked),
        closed_today=ctx.closed(d), lamps_today=tower["lamp_count"],
        deep_minutes_today=s.deep_minutes, target_minutes=s.target_minutes,
        entries_today=len(ctx.real_entries(d)), mark_today=s.mark, skips_left=week.skips_left,
        outputs_required=week.outputs_required, floor_days=week.floor_days,
        floor_days_required=week.floor_days_required,
        comeback_since=comeback_since,
        flow_best_hours=_flow(ctx, d)["best_hours"],
        stars_today=tower["stars"],
    )


def snapshot(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> Snapshot:
    """The facts that celebrations are diffed from. Cheap enough to take before and after every write."""
    return _snapshot(_Ctx(conn, today, now))


def _ev(kind: str, size: str, title: str, detail: str = "", **fx: Any) -> dict:
    return {"kind": kind, "size": size, "title": title, "detail": detail, "fx": fx}


def diff_events(
    before: Snapshot,
    after: Snapshot,
    *,
    entry: dict | None = None,
    output: dict | None = None,
) -> list[dict]:
    """Celebrations are the difference between two snapshots (pure; same inputs, same events).

    `entry` ({category, minutes, deep}) and `output` ({stage, ...}) are the write that happened,
    used only for wording. Each event is {kind, size, title, detail, fx}.
    """
    events: list[dict] = []

    # 1. the log itself (tick)
    if after.entries_today > before.entries_today:
        cat = (entry or {}).get("category")
        minutes = (entry or {}).get("minutes")
        deep = bool((entry or {}).get("deep"))
        lamp = after.lamps_today > before.lamps_today
        base = {"floors_added": max(0, after.floors_today - before.floors_today), "lamp": lamp, "sound": "tick"}
        if cat is None:
            events.append(_ev("log", "tick", "Hour logged", f"{fmt_min(after.deep_minutes_today)} deep today.", **base))
        elif cat == "Unknown":
            events.append(_ev("log", "tick", "Unknown logged", "You can fill it in at Close.", fog=True, **base))
        elif cat == "Rest":
            events.append(_ev("log", "tick", "Rest hour logged", "Rest is part of the map.", **base))
        elif cat == "Distracted":
            events.append(_ev("log", "tick", f"{fmt_min(minutes or 0)} Distracted logged", "The map is accurate.", **base))
        elif deep and cat in categories.LADDER:
            events.append(_ev("log", "tick", f"{fmt_min(minutes or 0)} {cat} logged",
                              f"{fmt_min(after.deep_minutes_today)} deep today.", **base))
        else:
            events.append(_ev("log", "tick", f"{fmt_min(minutes or 0)} {cat} logged", "The map is accurate.", **base))

    # 2. doors and crown (daily)
    if after.floor_met and not before.floor_met:
        detail = (f"{fmt_min(after.deep_minutes_today)} deep today." if after.deep_minutes_today > 0
                  else "An output opens the doors.")
        events.append(_ev("floor", "small", "Doors open", detail, confetti=12, sound="ping"))
    if after.target_met and not before.target_met:
        events.append(_ev("target", "medium", "Crown lit", f"{fmt_min(after.deep_minutes_today)} deep.",
                          confetti=40, sound="ping", next_goal=True))

    # 3. outputs
    if after.outputs_today > before.outputs_today:
        n, req = after.outputs_week, after.outputs_required
        if req:
            title = f"Output {min(n, req)} of {req} this week"
            if n > req:
                title += f" ({n} shipped)"
            detail = "Contract outputs met." if (n >= req > before.outputs_week) else "Beacon lit on today's tower."
        else:
            title, detail = f"Output {n} this week", "Beacon lit on today's tower."
        events.append(_ev("output", "big", title, detail, confetti=60, sound="levelUp", beacon=True,
                          ladder=(output or {}).get("stage")))

    # 4. comeback (the loudest one) and repairs
    if after.is_comeback_today and not before.is_comeback_today:
        detail = (f"First floor day since {after.comeback_since}." if after.comeback_since
                  else "First floor day after a quiet stretch.")
        events.append(_ev("comeback", "grand", "Back on", detail, confetti=90, sound="levelUp", crane=True,
                          banner="You're back."))
    for d in sorted(set(after.repaired) - set(before.repaired)):
        events.append(_ev("repair", "big", f"{WEEKDAYS[d.weekday()]}'s lot is built", "The scaffolding is down.",
                          confetti=40, sound="levelUp", scaffold_down=True, date=d.isoformat()))

    # 5. a kept week
    if after.week_status == "kept" and before.week_status != "kept":
        events.append(_ev(
            "week_kept", "big", "Card complete",
            f"{after.outputs_week} of {after.outputs_required} outputs, {after.floor_days} of {after.floor_days_required} floor days.",
            confetti=60, sound="levelUp", row_lights=True,
        ))

    # 6. ladder nodes
    for key in sorted(after.nodes - before.nodes):
        ladder, n = key.rsplit(":", 1)
        info = LADDER_INFO.get(ladder)
        if info:
            events.append(_ev("node", "big", f"{ladder}: {info['nodes'][int(n) - 1]} reached",
                              f"{info['landmark']} lit up a new section.", confetti=40, sound="levelUp", ladder=ladder, node=int(n)))

    # 7. achievements (district arrivals have their own event)
    order = {k: i for i, (k, *_rest) in enumerate(_ACH_ROWS)}
    for key in sorted(after.achievements - before.achievements, key=lambda k: order.get(k, 999)):
        if key.startswith("district_"):
            continue
        name, tier, desc = _ach_by_key(key)
        size = TIER_SIZE.get(tier, "small")
        events.append(_ev("achievement", size, name, desc, confetti=TIER_CONFETTI.get(size, 12) if size != "small" else 0,
                          sound="ping", key=key, tier=tier))

    # 7b. three stars: the crown turns gold
    if after.stars_today >= 3 > before.stars_today:
        events.append(_ev("three_stars", "big", "Three stars", "The crown turns gold.", confetti=40, sound="levelUp", gold=True))

    # 8. level and district
    if after.district != before.district:
        lv = level_for(after.xp)
        meta = DISTRICT_META.get(after.district)
        if after.district == FINAL_DISTRICT:
            title, detail = DREAM_HOME["unlocked"], f"Level {lv.number}, {after.district}. {DREAM_HOME['unlocked_sub']}"
        else:
            title, detail = after.district, f"Level {lv.number}. {meta['arrival']}" if meta else f"Level {lv.number}."
        events.append(_ev("district", "grand", title, detail, confetti=120, sound="levelUp",
                          icon=district_icon(after.district), level=lv.number, district=after.district,
                          district_id=district_id(after.district), regions=lit_regions(lv.number)))
    elif after.level > before.level:
        lv = level_for(after.xp)
        events.append(_ev("level", "small", f"Level {lv.number}", f"{lv.district}, {lv.to_next} XP to Level {lv.number + 1}.",
                          sound="ping", level=lv.number))

    # 9. a rest day
    if after.flow_best_hours > before.flow_best_hours:
        hours = after.flow_best_hours
        title = "An hour of flow" if hours == 1 else f"{hours} hours of flow"
        events.append(_ev("flow", "tick", title, "Study with gaps under 20 minutes.", hours=hours, sound="tick"))
    if after.mark_today and not before.mark_today:
        label = "Rest day logged" if after.mark_today == "rest" else "Skip logged"
        events.append(_ev("rest", "small", label, f"{_plural(after.skips_left, 'token')} left this week.", park=True))

    return events


def toast_text(events: list[dict]) -> str:
    """The one-line toast for a list of events: the first event's title plus its detail."""
    if not events:
        return ""
    first = events[0]
    title, detail = first.get("title", ""), first.get("detail", "")
    return f"{title}. {detail}" if detail else f"{title}."


def sync_unlocks(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> list[str]:
    """Record what is newly unlocked in the append-only ledger and move the XP ratchet up.

    Returns the new ledger keys ('ach:first_ship', 'node:Math:2', 'district:Harlem', 'postcard:...').
    A second call right after returns []. The first-ever call is a silent backfill of history: it
    sets `game_on_since` and records everything already earned.
    """
    return _sync(_Ctx(conn, today, now))


def _sync(ctx: _Ctx) -> list[str]:
    conn = ctx.conn
    new: list[str] = []
    stamp = db.utc_now_iso()
    with _atomic(conn):
        conn.execute(_UNLOCKS_DDL)
        ctx._c.pop("ledger", None)
        ctx._c.pop("achievements", None)
        first_sync = setting(conn, "game_on_since") is None
        if first_sync:
            db.set_setting(conn, "game_on_since", ctx.today.isoformat())
        # An upgrade from the pre-game app: history already exists, so what is recorded now was earned earlier.
        # Those ledger rows are flagged so the wins feed does not show them as "just now".
        backfill = first_sync and any(e.day < ctx.today for e in ctx.entries)

        def put(key: str, kind: str, meta: dict | None = None) -> None:
            if backfill:
                meta = {**(meta or {}), "backfill": True}
            cur = conn.execute(
                "INSERT OR IGNORE INTO unlocks(key, kind, unlocked_at, meta) VALUES (?, ?, ?, ?)",
                (key, kind, stamp, json.dumps(meta) if meta is not None else None),
            )
            if cur.rowcount:
                new.append(key)

        for a in _achievements(ctx):
            if a.unlocked and not a.key.startswith("district_"):
                put(f"ach:{a.key}", "achievement")
        for key in sorted(ctx.node_keys(), key=lambda k: (categories.LADDER.index(k.split(":")[0]), int(k.split(":")[1]))):
            put(f"node:{key}", "node")
        level = ctx.level()
        for first, _last, name, _icon in DISTRICTS[1:]:
            if level.number >= first:
                put(f"district:{name}", "district", {"level": first})
                put(f"postcard:district:{name}", "postcard", {"card": DISTRICT_CARDS[name]["id"]})
        for i, monday in enumerate(ctx.kept_mondays()):
            put(f"postcard:week_kept:{monday.isoformat()}", "postcard", {"card": POSTCARDS[i % len(POSTCARDS)]["id"], "n": i})
        comebacks = ctx.comeback_days()
        if comebacks:
            put(f"postcard:comeback:{comebacks[0].isoformat()}", "postcard", {"card": COMEBACK_CARD["id"]})

        # the XP ratchet: only ever moves up
        computed = ctx.xp_total()
        if computed > ctx.xp_hw():
            conn.execute(
                "INSERT INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET meta = excluded.meta, unlocked_at = excluded.unlocked_at",
                (stamp, json.dumps({"xp": computed})),
            )
    ctx._c.pop("ledger", None)
    ctx._c.pop("achievements", None)
    _economy_sync(ctx)
    return new


def _economy_sync(ctx: _Ctx) -> None:
    """Bank the money earned so far and close finished weeks (epoch/economy.py). The game never depends on it."""
    try:
        from . import economy
        economy.sync(ctx.conn, ctx=ctx)
    except Exception:
        log.exception("economy.sync failed")


def finish_write(
    conn: sqlite3.Connection,
    before: Snapshot,
    *,
    entry: dict | None = None,
    output: dict | None = None,
    today: date | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """After a write: sync the ledger, take the second snapshot, and return the events (with postcards attached)."""
    ctx = _Ctx(conn, today, now)       # one context: days are computed once for the sync and the snapshot
    new_keys = _sync(ctx)
    after = _snapshot(ctx)
    events = _once_per_day(ctx, diff_events(before, after, entry=entry, output=output))
    for ev in events:
        card = None
        if ev["kind"] == "week_kept":
            card = _postcard(ctx, "week_kept", timeutil.week_monday(ctx.today).isoformat())
        elif ev["kind"] == "district":
            card = _postcard(ctx, "district", after.district)
        elif ev["kind"] == "comeback":
            card = _postcard(ctx, "comeback", ctx.today.isoformat())
        if card:
            ev["postcard"] = card
    return events


def _fx_key(ev: dict, ctx: _Ctx) -> str | None:
    """The ledger key that makes a daily/weekly celebration play once, or None for events that may repeat."""
    kind = ev.get("kind")
    if kind in ("floor", "target", "three_stars"):
        return f"fx:{kind}:{ctx.today.isoformat()}"
    if kind == "comeback":
        return f"fx:comeback:{ctx.today.isoformat()}"
    if kind == "week_kept":
        return f"fx:week_kept:{timeutil.week_monday(ctx.today).isoformat()}"
    if kind == "repair" and ev.get("fx", {}).get("date"):
        return f"fx:repair:{ev['fx']['date']}"
    return None


def _once_per_day(ctx: _Ctx, events: list[dict]) -> list[dict]:
    """Drop a floor/crown/comeback/repair/kept-week celebration that already played for that day or week.

    Deleting evidence and adding it back can make the snapshots differ again; the ledger row keeps the
    moment from replaying (design section 5: once per day)."""
    keyed = [(ev, _fx_key(ev, ctx)) for ev in events]
    if not any(key for _ev_, key in keyed):
        return events
    kept: list[dict] = []
    with _atomic(ctx.conn):
        ctx.conn.execute(_UNLOCKS_DDL)
        for ev, key in keyed:
            if key is None:
                kept.append(ev)
                continue
            cur = ctx.conn.execute(
                "INSERT OR IGNORE INTO unlocks(key, kind, unlocked_at, meta) VALUES (?, 'fx', ?, NULL)",
                (key, db.utc_now_iso()),
            )
            if cur.rowcount:
                kept.append(ev)
    ctx._c.pop("ledger", None)
    return kept


# --------------------------------------------------------------------------
# Postcards
# --------------------------------------------------------------------------

def postcard_for(conn: sqlite3.Connection, event_kind: str, ref: str, today: date | None = None) -> dict | None:
    """The postcard for an event, deterministic from the list (never random).

    kinds: 'week_kept' (ref = the week's Monday, ISO), 'district' (ref = district name),
    'comeback' (ref = the first comeback day, ISO). Returns None when the event has not happened.
    """
    return _postcard(_Ctx(conn, today), event_kind, ref)


def _postcard(ctx: _Ctx, event_kind: str, ref: str) -> dict | None:
    card: dict | None = None
    if event_kind == "week_kept":
        kept = [m.isoformat() for m in ctx.card_mondays()]
        if ref in kept:
            card = POSTCARDS[kept.index(ref) % len(POSTCARDS)]
    elif event_kind == "district":
        first = next((f for f, _l, n, _i in DISTRICTS[1:] if n == ref), None)
        if first is not None and ctx.level().number >= first:
            card = DISTRICT_CARDS[ref]
    elif event_kind == "comeback":
        days = ctx.comeback_days()
        if days and days[0].isoformat() == ref:
            card = COMEBACK_CARD
    if card is None:
        return None
    return {**card, "kind": event_kind, "ref": ref, "illustration": True}


# --------------------------------------------------------------------------
# Day recap and sealing
# --------------------------------------------------------------------------

def _local_day(ctx: _Ctx, stamp: str) -> date | None:
    try:
        return timeutil.local_date_of(timeutil.from_iso(stamp), ctx.tz, ctx.dsh)
    except (ValueError, TypeError):
        return None


def _recap(ctx: _Ctx, d: date) -> dict:
    t = ctx.tower(d)
    return {
        "date": d.isoformat(), "day_number": ctx.day_number(d), "floors": t["floors"], "deep_minutes": t["deep_minutes"],
        "doors": t["doors"], "crown": t["crown"], "outputs": t["outputs"], "lamps": t["lamps"],
        "fog_minutes": t["fog_minutes"], "xp_today": ctx.day_xp(d).total, "stars": t["stars"],
        "level": ctx.level().as_dict(), "wins": [w for w in _wins(ctx, 40) if _local_day(ctx, w["at"]) == d][:5],
        "closed": ctx.closed(d), "sealed": f"seal:{d.isoformat()}" in ctx.ledger,
        "headline": (f"{t['floors']} floors, {fmt_min(t['deep_minutes'])} deep"
                     + (f", {_plural(len(t['outputs']), 'output')}" if t["outputs"] else "") + "."),
    }


def day_recap(conn: sqlite3.Connection, d: date | None = None, today: date | None = None) -> dict:
    ctx = _Ctx(conn, today)
    return _recap(ctx, d or ctx.today)


def seal_day(conn: sqlite3.Connection, d: date | None = None, today: date | None = None) -> dict | None:
    """Seal a closed day: records the ledger row once and returns {recap, events, newly_sealed}.

    Returns None when the day is not closed yet (gaps remain or the job block is unanswered).
    """
    ctx = _Ctx(conn, today)
    d = d or ctx.today
    if not ctx.closed(d):
        return None
    with _atomic(conn):
        conn.execute(_UNLOCKS_DDL)
        cur = conn.execute(
            "INSERT OR IGNORE INTO unlocks(key, kind, unlocked_at, meta) VALUES (?, 'seal', ?, NULL)",
            (f"seal:{d.isoformat()}", db.utc_now_iso()),
        )
    ctx._c.pop("ledger", None)
    events = [_ev("seal", "medium", f"{timeutil.day_number_label(ctx.day_number(d))} sealed", "", confetti=0, sound="thunk", fog_lifts=True)] if cur.rowcount else []
    return {"recap": _recap(ctx, d), "events": events, "newly_sealed": bool(cur.rowcount)}


# --------------------------------------------------------------------------
# v2: seasonal decorations (cosmetic only)
# --------------------------------------------------------------------------

# Diwali (the main day, Lakshmi Puja) and Holi (the colour day, Rangwali Holi / Dhulandi). These follow
# the lunar calendar, so they are looked up rather than computed. Checked on 2026-10-18 against:
#   Diwali: https://www.timeanddate.com/holidays/india/diwali and https://www.farmersalmanac.com/when-is-diwali
#           2026 Sun 8 Nov, 2027 Fri 29 Oct, 2028 Tue 17 Oct, 2029 Mon 5 Nov (five-day festival: main day +/- 2).
#   Holi:   https://www.timeanddate.com/holidays/india/holi and https://www.drikpanchang.com/festivals/holi/festivals-holi-rangwali.html
#           2026 Wed 4 Mar (Holika Dahan 3 Mar), 2027 Mon 22 Mar (Holika Dahan 21 Mar),
#           2028 Sat 11 Mar, 2029 Thu 1 Mar. (Some sites list 23 Mar for 2027; drikpanchang, which is
#           computed from the panchang, says 22 Mar.)
DIWALI_DATES: dict[int, date] = {
    2026: date(2026, 11, 8), 2027: date(2027, 10, 29), 2028: date(2028, 10, 17), 2029: date(2029, 11, 5),
}
HOLI_DATES: dict[int, date] = {
    2026: date(2026, 3, 4), 2027: date(2027, 3, 22), 2028: date(2028, 3, 11), 2029: date(2029, 3, 1),
}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The n-th (1-based) given weekday of a month, e.g. the 4th Thursday of November."""
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def seasonal_windows(year: int) -> list[dict]:
    """Every decoration window that starts in `year`: {key, name, start, end, note} with ISO dates."""
    def win(key: str, name: str, start: date, end: date, note: str) -> dict:
        return {"key": key, "name": name, "start": start.isoformat(), "end": end.isoformat(), "note": note}

    out = [
        win("new_year", "New Year", date(year, 1, 1), date(year, 1, 3), "Confetti left on the avenue."),
        win("cherry_blossoms", "Cherry blossoms", date(year, 3, 25), date(year, 4, 20), "Pink blossoms along the park paths."),
        win("pride", "Pride month", date(year, 6, 1), date(year, 6, 30), "Rainbow flags on the corners."),
        win("july_4th", "July 4th", date(year, 7, 3), date(year, 7, 5), "Flags and fireworks over the river."),
        win("india_independence_day", "India Independence Day", date(year, 8, 14), date(year, 8, 15), "Saffron, white and green bunting."),
        win("halloween", "Halloween", date(year, 10, 24), date(year, 10, 31), "Pumpkins on the stoops."),
    ]
    marathon = _nth_weekday(year, 11, 6, 1)
    out.append(win("nyc_marathon", "NYC Marathon day", marathon, marathon, "Runners and cheering crowds along the avenues."))
    thanksgiving = _nth_weekday(year, 11, 3, 4)
    monday = thanksgiving - timedelta(days=3)
    out.append(win("thanksgiving_week", "Thanksgiving week", monday, monday + timedelta(days=6), "Warm windows and a parade balloon or two."))
    out.append(win("holiday_lights", "Holiday lights", date(year, 12, 1), date(year, 12, 26), "String lights and a big tree downtown."))
    out.append(win("nye_ball_drop", "New Year's Eve ball drop", date(year, 12, 31), date(year, 12, 31), "A glowing ball above Times Square."))
    if year in HOLI_DATES:
        day = HOLI_DATES[year]
        out.append(win("holi", "Holi", day - timedelta(days=1), day + timedelta(days=1), "Coloured powder in the air."))
    if year in DIWALI_DATES:
        day = DIWALI_DATES[year]
        out.append(win("diwali", "Diwali", day - timedelta(days=2), day + timedelta(days=2), "Diyas in every window."))
    return sorted(out, key=lambda w: (w["start"], w["key"]))


def seasonal(d: date) -> list[dict]:
    """The decorations active on a date (cosmetic only; no XP, no rules)."""
    return [w for w in seasonal_windows(d.year) if w["start"] <= d.isoformat() <= w["end"]]


def seasonal_for(conn: sqlite3.Connection, d: date | None = None) -> list[dict]:
    """`seasonal(d)` unless the person turned decorations off. `d` defaults to today."""
    if not setting(conn, "seasonal_enabled"):
        return []
    return seasonal(d or rules.today_local(conn))


def _seasonal_decor(ctx: _Ctx) -> list[dict]:
    """Every window since the tracker started, with whether it was 'earned' by showing up that week."""
    def showed_up(d: date) -> bool:
        if d < ctx.start or d > ctx.today:
            return False
        s = ctx.summary(d)
        return s.logged_minutes > 0 or s.outputs_count > 0

    out = []
    first = ctx.start - timedelta(days=7)
    for year in range(ctx.start.year, ctx.today.year + 1):
        for w in seasonal_windows(year):
            start, end = date.fromisoformat(w["start"]), date.fromisoformat(w["end"])
            if start > ctx.today or end < first:
                continue
            monday = timeutil.week_monday(start)
            span = (timeutil.week_monday(end) - monday).days + 7
            earned = any(showed_up(monday + timedelta(days=i)) for i in range(span))
            out.append({**w, "earned": earned, "active": start <= ctx.today <= end})
    return out


# --------------------------------------------------------------------------
# v2: flow meter (no XP)
# --------------------------------------------------------------------------

FLOW_GAP_MIN = 20


def _flow(ctx: _Ctx, d: date) -> dict:
    """The day's chains of consecutive ladder + deep time (gaps of 20 minutes or less join them)."""
    def compute() -> dict:
        ivs = sorted(
            ((e.start, e.end) for e in ctx.real_entries(d) if e.deep and e.category in categories.LADDER and e.end > e.start),
        )
        merged: list[list[datetime]] = []
        for start, end in ivs:
            if merged and start <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        chains: list[dict] = []
        gap = timedelta(minutes=FLOW_GAP_MIN)
        for start, end in merged:
            if chains and start - chains[-1]["end"] <= gap:
                chains[-1]["end"] = end
                chains[-1]["seconds"] += (end - start).total_seconds()
            else:
                chains.append({"start": start, "end": end, "seconds": (end - start).total_seconds()})
        for c in chains:
            c["minutes"] = int(c["seconds"] // 60)
            c["span"] = int((c["end"] - c["start"]).total_seconds() // 60)
        best = max((c["minutes"] for c in chains), default=0)
        last = chains[-1] if chains else None
        active = bool(last and d == ctx.today and ctx.now - last["end"] <= gap)
        minutes = last["minutes"] if (last and active) else 0
        return {
            "minutes": minutes, "hours_lit": minutes // 60, "best_today": best, "best_hours": best // 60,
            "active": active, "last_end": _iso(last["end"]) if last else None, "gap_limit_min": FLOW_GAP_MIN,
            "to_next_hour_min": 60 - (minutes % 60), "span_minutes": last["span"] if (last and active) else 0,
        }
    return ctx._memo(("flow", d), compute)


def flow(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> dict:
    """The flow meter for today: {minutes, hours_lit, best_today, best_hours, active, ...}."""
    ctx = _Ctx(conn, today, now)
    return _flow(ctx, ctx.today)


# --------------------------------------------------------------------------
# v2: the subway map (one line per ladder)
# --------------------------------------------------------------------------

SUBWAY_BULLET = {"Python": "P", "Math": "M", "ML/DL": "D", "Papers": "R", "Writing/X": "W"}


def _subway(ctx: _Ctx) -> dict:
    lines = []
    for lad in ctx.ladders():
        nxt = lad.next_node
        stations = []
        for node in lad.nodes:
            status = "passed" if node.unlocked else ("next" if nxt is not None and node.n == nxt.n else "ahead")
            stations.append({**node.as_dict(), "status": status})
        progress = 0.0
        if nxt is not None:
            parts = [min(1.0, have / need) for have, need in (
                (lad.outputs, nxt.needs_outputs), (lad.deep_minutes, nxt.needs_deep_min), (lad.linked, nxt.needs_link)) if need > 0]
            progress = min(0.99, min(parts)) if parts else 0.0
        at = lad.nodes_unlocked
        lines.append({
            "ladder": lad.category, "name": f"{lad.category} line", "bullet": SUBWAY_BULLET.get(lad.category, lad.category[:1]),
            "color": categories.COLORS.get(lad.category, "#94a3b8"), "landmark": lad.landmark,
            "stations": stations, "next_text": lad.next_text(), "complete": nxt is None,
            "train": {"position": round(at + progress, 2), "at": at, "progress": round(progress, 2),
                      "next_station": nxt.name if nxt else None},
        })
    return {"lines": lines}


def subway(conn: sqlite3.Connection, today: date | None = None) -> dict:
    """Lines (one per ladder), stations (skill nodes), the train's position and the next station."""
    return _subway(_Ctx(conn, today))


# --------------------------------------------------------------------------
# Read models for the UI
# --------------------------------------------------------------------------

def _subline(ctx: _Ctx, s: rules.DaySummary, tower: dict) -> str:
    if s.mark and not s.floor_met:
        return "Rest day. Doors stay open if you want them." if s.mark == "rest" else "Skip day. Doors stay open if you want them."
    if not s.floor_met:
        if s.deep_minutes <= 0:
            return "Empty lot, waiting for the first floor."
        return f"{fmt_min(max(0, s.floor_minutes - s.deep_minutes))} to the doors."
    if not s.target_met:
        return f"Doors open. Crown in {fmt_min(max(0, s.target_minutes - min(s.deep_minutes, ctx.cap)))}."
    return "Crown lit. Anything extra is shown but not counted."


def tower_line(s: rules.DaySummary, tower: dict) -> str:
    """Live status under the hero: "Floor 7 of 16 · next floor in 6 min · crown at floor 6 ✓"."""
    floors, top = tower["floors"], tower["max_floors"]
    if floors >= top:
        parts = [f"Topped out at {top} floors"]
    else:
        parts = [f"Floor {floors} of {top}" if floors else "Empty lot"]
        if tower["next_floor_min"] is not None:
            parts.append(f"{'next' if floors else 'first'} floor in {tower['next_floor_min']} min")
    if not s.floor_met:
        parts.append(f"doors at floor {tower['door_floor']}")
    parts.append(f"crown at floor {tower['target_floor']}" + (" ✓" if s.target_met else ""))
    return " · ".join(parts)


def _today_block(ctx: _Ctx, d: date) -> dict:
    s = ctx.summary(d)
    tower = ctx.tower(d)
    capped = min(s.deep_minutes, ctx.cap)
    floor_p = 100 if s.floor_met else min(100, int(round(100 * s.deep_minutes / max(1, s.floor_minutes))))
    target_p = 100 if s.target_met else min(100, int(round(100 * capped / max(1, s.target_minutes))))
    return {
        "deep_minutes": s.deep_minutes, "floors": tower["floors"], "floor_met": s.floor_met, "target_met": s.target_met,
        "target_minutes": s.target_minutes, "floor_minutes": s.floor_minutes,
        "ring": {"floor_p": floor_p, "target_p": target_p},
        "over_cap_min": tower["over_cap_min"],
        "over_cap_note": f"+{fmt_min(tower['over_cap_min'])}, past the cap" if tower["over_cap_min"] else "",
        "logged_minutes": s.logged_minutes, "outputs": s.outputs_count, "status": s.status, "mark": s.mark,
        "is_comeback": s.is_comeback, "is_job_day": s.is_job_day,
        "subline": _subline(ctx, s, tower),
        "tower_line": tower_line(s, tower),
    }


def _week_block(ctx: _Ctx, d: date) -> dict:
    w = ctx.week(d)
    return {
        "monday": w.monday.isoformat(), "status": w.status, "outputs": w.outputs_count,
        "outputs_required": w.outputs_required, "floor_days": w.floor_days, "floor_days_required": w.floor_days_required,
        "skips_used": w.skips_used, "skips_left": w.skips_left,
        "outputs_list": [{"id": o["id"], "stage": o["stage"], "what": o["what"], "url": o["url"]} for o in w.outputs],
        "days": [
            {"date": day.local_date.isoformat(), "dow": day.local_date.weekday(), "status": day.status,
             "floors": floors_for(day.deep_minutes, ctx.mpf, ctx.cap) if day.local_date <= ctx.today else 0,
             "doors": day.floor_met and day.local_date <= ctx.today,
             "crown": day.target_met and day.local_date <= ctx.today, "mark": day.mark,
             "is_today": day.local_date == ctx.today}
            for day in w.days
        ],
    }


def _ghost_today(ctx: _Ctx) -> dict:
    last_monday = timeutil.week_monday(ctx.today) - timedelta(days=7)
    values = []
    for i in range(7):
        day = last_monday + timedelta(days=i)
        values.append(ctx.summary(day).deep_minutes if ctx.start <= day <= ctx.today else 0)
    return {"last_week_same_dow": values[ctx.today.weekday()], "last_week_best": max(values), "last_week_deep_by_dow": values}


def today_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> dict:
    """Everything the Today screen needs (GET /api/today). The `today` and `level` blocks are
    exactly what POST /api/log returns under those names."""
    ctx = _Ctx(conn, today, now)
    d = ctx.today
    qs = _quests(ctx)
    lapse = rules.pending_lapse(conn, d)
    repair = ctx.repair_window()
    bedtime = timeutil.at_local(d, ctx.s["bedtime"], ctx.tz, ctx.dsh)
    closed = ctx.closed(d)
    return {
        "as_of": _iso(ctx.now), "date": d.isoformat(), "weekday": WEEKDAYS[d.weekday()], "tz": ctx.tz,
        "day_number": ctx.day_number(d), "day_one": ctx.start.isoformat(),
        "day_line": f"{timeutil.day_number_label(ctx.day_number(d))} · {timeutil.short_day(d)}",
        "quiet": bool(setting(conn, "quiet_mode")), "sound": bool(setting(conn, "sound")),
        "today": _today_block(ctx, d),
        "level": ctx.level().as_dict(),
        "tower": ctx.tower(d),
        "quests": [q.as_dict() for q in qs],
        "stars": ctx.stars(d),
        "wins": _wins(ctx, 5),
        "repeat_chips": _repeat_chips(ctx, 3),
        "week": _week_block(ctx, d),
        "run": {"current": rules.current_run(conn, d), "best": best_run(conn, d)},
        "lapse": lapse.isoformat() if lapse else None,
        "repair": repair.isoformat() if repair else None,
        "close": {
            "evening": ctx.now >= bedtime - timedelta(minutes=60), "closed": closed,
            "can_seal": closed, "sealed": f"seal:{d.isoformat()}" in ctx.ledger,
        },
        "ghost": _ghost_today(ctx),
        "config": _config(ctx),
        "flow": _flow(ctx, d),
        "seasonal": seasonal(d) if setting(conn, "seasonal_enabled") else [],
        "rollover": rollover_note(ctx, d),
    }


def tower_howto(conn: sqlite3.Connection) -> dict:
    """The numbers behind the "How your tower grows" explainer, from the user's own settings."""
    ctx = _Ctx(conn)
    mpf = ctx.mpf

    def floor_of(minutes: int) -> int:
        return min(ctx.max_floors, max(1, math.ceil(minutes / mpf)))

    wk, we, door = int(ctx.s["target_weekday_minutes"]), int(ctx.s["target_weekend_minutes"]), int(ctx.s["floor_minutes"])
    cutoff = ctx.s.get("sleep_cutoff")
    return {
        "mpf": mpf, "max_floors": ctx.max_floors, "cap": ctx.cap, "cap_text": fmt_min(ctx.cap),
        "door_min": door, "door_floor": floor_of(door),
        "weekday_min": wk, "weekday_text": fmt_min(wk), "weekday_floor": floor_of(wk),
        "weekend_min": we, "weekend_text": fmt_min(we), "weekend_floor": floor_of(we),
        "star_text": fmt_min(ctx.deep_star),
        "cutoff_label": _clock12(str(cutoff).strip()) if rules.valid_sleep_cutoff(cutoff, ctx.dsh) else None,
        "day_starts": _clock12(f"{ctx.dsh:02d}:00"),
    }


def _clock12(hhmm: str) -> str:
    """'00:30' -> '12:30 AM', '04:00' -> '4:00 AM'."""
    t = timeutil.parse_hhmm(hhmm)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def rollover_note(ctx: _Ctx, d: date) -> dict:
    """Plain words about which day it is, and about deep minutes past the sleep cutoff.

    `late_window`: it is past midnight but before the day rolls over (day_start_hour), so the day is still `d`.
    `day_text`: "Still Monday's day until 4:00 AM. Late-night study counts for Monday." (empty outside that window)
    `cutoff_text`: said once deep minutes are past the cutoff: shown on the log, never counted (may be empty).
    """
    local = ctx.now.astimezone(timeutil.zone(ctx.tz))
    late_window = ctx.dsh > 0 and local.hour < ctx.dsh
    weekday = WEEKDAYS[d.weekday()]
    until = _clock12(f"{ctx.dsh:02d}:00")
    day_text = (f"Still {weekday}'s day until {until}. Late-night study counts for {weekday}."
                if late_window else "")
    cutoff_at = ctx.calc.sleep_cutoff_at(d)
    cutoff_label = _clock12(str(ctx.s["sleep_cutoff"]).strip()) if cutoff_at is not None else None
    late_min = ctx.calc.facts(d).late_deep
    cutoff_text = ""
    if cutoff_label and late_min > 0:
        cutoff_text = (f"{fmt_min(late_min)} of deep focus came after your {cutoff_label} sleep cutoff. "
                       "It is shown, but it does not count toward the floor, crown or XP. You can change the cutoff in Settings.")
    elif cutoff_label and ctx.now >= cutoff_at:
        cutoff_text = (f"It is past your {cutoff_label} sleep cutoff, so deep minutes logged now are shown but do not count. "
                       "You can change the cutoff in Settings.")
    return {"late_window": late_window, "weekday": weekday, "until": until, "day_text": day_text,
            "cutoff_label": cutoff_label, "late_minutes": late_min, "cutoff_text": cutoff_text}


def _config(ctx: _Ctx) -> dict:
    return {
        "floor_min": ctx.s["floor_minutes"], "target_weekday": ctx.s["target_weekday_minutes"],
        "target_weekend": ctx.s["target_weekend_minutes"], "cap": ctx.cap,
        "minutes_per_floor": ctx.mpf, "max_floors": ctx.max_floors, "deep_star_minutes": ctx.deep_star,
    }


# --------------------------------------------------------------------------
# The year of permanent lots (city/manhattan/home.json v2): one real tax lot per day since Day 1, a row of 7 per Monday-to-Sunday week
# --------------------------------------------------------------------------

YEAR_SLOTS = 365      # lots in home.json (slotCount): Day 1 .. Day 365. tests/test_manhattan_data.py checks it against the file.


def year_slot(day_one: date, d: date, slots: int = YEAR_SLOTS) -> dict | None:
    """Where a day lives in the year of lots, or None for a day before Day 1 (those are not slots).

    `n`     0-based day index since Day 1 (the n-th lot of the walk, `weeks` of home.json flattened)
    `week`  the week row, 0 = the Monday-to-Sunday week that holds Day 1 (which has only Day 1 in it)
    `wd`    the weekday column in that row, Monday = 0 .. Sunday = 6 (the Today week strip)
    `lot`   False once the days run past the last lot: they have no place on the map (the year is full), nothing breaks
    """
    n = (d - day_one).days
    if n < 0:
        return None
    pos = n + day_one.weekday()
    return {"n": n, "week": pos // 7, "wd": pos % 7, "lot": n < slots}


def year_rows(slots: int = YEAR_SLOTS, day_one_weekday: int = 6) -> int:
    """How many week rows the year of lots has (53 when Day 1 is a Sunday: the Day 1 row plus 52 full weeks)."""
    return (slots - 1 + day_one_weekday) // 7 + 1


def world_state(conn: sqlite3.Connection, today: date | None = None, days: int = 28, now: datetime | None = None) -> dict:
    """Everything the 3D city needs (GET /api/world). Rows are whole Monday-to-Sunday weeks ending with
    the current week, so `days=28` gives 4 rows of 7 (future days in the current week are 'future').
    `days=0` (the API's `days=all`) is the whole year so far: every week since the one that holds Day 1.
    Each day carries its `slot` (week row, weekday, lot index) in the year of lots; see year_slot."""
    ctx = _Ctx(conn, today, now)
    economy_block = _economy_world(conn, ctx)
    gold = set(economy_block["gold_days"]) if economy_block else {d.isoformat() for d in ctx.days() if ctx.stars(d) >= 3}
    this_monday = timeutil.week_monday(ctx.today)
    if days <= 0:
        first_monday = timeutil.week_monday(min(ctx.start, ctx.today))
        rows = (this_monday - first_monday).days // 7 + 1
    else:
        rows = max(1, min(60, math.ceil(max(1, days) / 7)))
        first_monday = this_monday - timedelta(days=7 * (rows - 1))
    window = [first_monday + timedelta(days=i) for i in range(7 * rows)]
    day_items = []
    for d in window:
        t = dict(ctx.tower(d))
        t["week"] = (d - first_monday).days // 7
        t["slot"] = year_slot(ctx.start, d)
        t["gold"] = t["date"] in gold          # three stars once: a permanent gold crown (banked, so it never fades)
        day_items.append(t)

    weeks = []
    for r in range(rows):
        w = ctx.week(first_monday + timedelta(days=7 * r))
        weeks.append({
            "monday": w.monday.isoformat(), "status": w.status, "outputs": w.outputs_count,
            "outputs_required": w.outputs_required, "floor_days": w.floor_days,
            "floor_days_required": w.floor_days_required, "skips_used": w.skips_used, "skips_left": w.skips_left,
            "deep_minutes": w.deep_minutes,
        })

    lads = ctx.ladders()
    landmarks = [{
        "ladder": lad.category, "kind": lad.kind, "landmark": lad.landmark, "outputs": lad.outputs,
        "bin": LADDER_LANDMARKS[lad.category]["bin"], "site": LADDER_LANDMARKS[lad.category]["site"],
        "light": LADDER_LANDMARKS[lad.category]["light"],
        "deep_minutes": lad.deep_minutes, "nodes_unlocked": lad.nodes_unlocked, "sections": lad.nodes_unlocked,
        "next": ({"name": lad.next_node.name, "needs_outputs": lad.next_node.needs_outputs,
                  "needs_deep_min": lad.next_node.needs_deep_min, "needs_link": lad.next_node.needs_link}
                 if lad.next_node else None),
        "next_text": lad.next_text(),
    } for lad in lads]

    all_days = ctx.days()
    deep_total = sum(ctx.summary(d).deep_minutes for d in all_days)
    counted = sum(min(ctx.summary(d).deep_minutes, ctx.cap) for d in all_days)
    shown_up = sum(1 for d in all_days if ctx.summary(d).logged_minutes > 0 or ctx.summary(d).outputs_count > 0)
    level = ctx.level()
    last_monday = timeutil.week_monday(ctx.today) - timedelta(days=7)
    ghost = [ctx.summary(last_monday + timedelta(days=i)).deep_minutes if ctx.start <= last_monday + timedelta(days=i) <= ctx.today else 0
             for i in range(7)]
    return {
        "as_of": _iso(ctx.now), "today": ctx.today.isoformat(), "tz": ctx.tz,
        "config": _config(ctx),
        "level": level.as_dict(),
        "districts": districts_block(level),
        "totals": {
            "deep_minutes": deep_total, "deep_minutes_counted": counted, "days_shown_up": shown_up,
            "outputs": len(ctx.outputs), "weeks_kept": len(ctx.kept_mondays()),
            "comebacks": len(ctx.comeback_days()), "best_run": best_run(conn, ctx.today),
            "run": rules.current_run(conn, ctx.today),
        },
        "days": day_items, "weeks": weeks, "landmarks": landmarks,
        "year": _year_block(ctx),
        "ghost": {"last_week_deep_by_dow": ghost},
        "sky": {"mode": setting(conn, "sky_tz") or "local"},
        "phase": ctx.s.get("phase"),
        "day_number": ctx.day_number(), "day_one": ctx.start.isoformat(),
        "seasonal": seasonal(ctx.today) if setting(conn, "seasonal_enabled") else [],
        "economy": economy_block,
    }


def _economy_world(conn: sqlite3.Connection, ctx: _Ctx) -> dict | None:
    """The money system's part of the world (home, furniture, outfit, tower upgrades, gold days). A problem there never breaks the city."""
    try:
        from . import economy
        return economy.world_block(conn, ctx)
    except Exception:
        log.exception("economy.world_block failed")
        return None


def _year_block(ctx: _Ctx) -> dict:
    """The year of lots at a glance: size, where today sits, how many lots hold a tower."""
    slot = year_slot(ctx.start, ctx.today)
    first_row_monday = timeutil.week_monday(ctx.start)
    return {
        "slots": YEAR_SLOTS, "rows": year_rows(YEAR_SLOTS, ctx.start.weekday()),
        "day_one": ctx.start.isoformat(), "first_monday": first_row_monday.isoformat(),
        "today_slot": slot, "built": sum(1 for d in ctx.days() if (d - ctx.start).days < YEAR_SLOTS
                                         and floors_for(ctx.summary(d).deep_minutes, ctx.mpf, ctx.cap) > 0),
        "full": bool(slot and not slot["lot"]),
    }


def shelf_state(conn: sqlite3.Connection, today: date | None = None) -> dict:
    """Achievements, ladders, postcards, decor and the outputs ledger (GET /api/shelf)."""
    ctx = _Ctx(conn, today)
    achs = _achievements(ctx)
    postcards = []
    for key, row in sorted(ctx.ledger.items(), key=lambda kv: kv[1]["unlocked_at"]):
        if not key.startswith("postcard:"):
            continue
        _p, kind, ref = key.split(":", 2)
        card = _postcard(ctx, kind, ref)
        if card:
            postcards.append({**card, "unlocked_at": row["unlocked_at"]})
    kept = ctx.card_mondays()
    decor = [{"name": name, "unlocked": i < len(kept), "week": kept[i].isoformat() if i < len(kept) else None}
             for i, name in enumerate(DECOR)]
    phase = ctx.s.get("phase")
    lads = []
    for lad in ctx.ladders():
        item = lad.as_dict()
        item["is_phase"] = lad.category == phase
        lads.append(item)
    outputs = [{
        "id": o.id, "date": o.day.isoformat(), "stage": o.stage, "what": o.what, "url": o.url,
        "is_public": o.is_public, "verified_by": o.verified_by,
    } for o in sorted(ctx.outputs, key=lambda o: (o.day, o.id), reverse=True)]
    return {
        "level": ctx.level().as_dict(),
        "hide_achievements": bool(setting(conn, "hide_achievements")),
        "achievements": [a.as_dict() for a in achs],
        "counts": {"unlocked": sum(1 for a in achs if a.unlocked), "total": len(achs)},
        "ladders": lads, "postcards": postcards, "decor": decor, "outputs": outputs,
        "seasonal_decor": _seasonal_decor(ctx), "subway": _subway(ctx),
    }


# --------------------------------------------------------------------------
# "Is the game layer helping?" (section 9.5)
# --------------------------------------------------------------------------

def _window_stats(ctx: _Ctx, first: date, last: date) -> dict | None:
    days = [d for d in ctx.days() if first <= d <= last]
    if not days:
        return None
    coverage, floor_days, closed_days, entry_count = 0.0, 0, 0, 0
    for d in days:
        s = ctx.summary(d)
        key = "morning_time_weekday" if d.weekday() < 5 else "morning_time_weekend"
        wake = timeutil.at_local(d, ctx.s[key], ctx.tz, ctx.dsh)
        bed = timeutil.at_local(d, ctx.s["bedtime"], ctx.tz, ctx.dsh)
        waking = max(1.0, (bed - wake).total_seconds() / 60)
        coverage += min(1.0, s.logged_minutes / waking)
        floor_days += 1 if s.status in ("floor", "repaired") else 0
        closed_days += 1 if ctx.closed(d) else 0
        entry_count += len(ctx.real_entries(d))
    n = len(days)
    return {
        "days": n, "coverage": round(coverage / n, 3), "floor_rate": round(floor_days / n, 3),
        "close_rate": round(closed_days / n, 3), "entries_per_day": round(entry_count / n, 2),
    }


def helping_report(conn: sqlite3.Connection, today: date | None = None) -> dict | None:
    """Before/after numbers around `game_on_since` (14 days each side). None until 14 days of play."""
    ctx = _Ctx(conn, today)
    since_raw = setting(conn, "game_on_since")
    if not since_raw:
        return None
    since = date.fromisoformat(since_raw)
    if ctx.today < since + timedelta(days=14):
        return None
    before = _window_stats(ctx, max(ctx.start, since - timedelta(days=14)), since - timedelta(days=1))
    after = _window_stats(ctx, since, since + timedelta(days=13))
    better = None
    if before and after:
        better = after["coverage"] >= before["coverage"] and after["floor_rate"] >= before["floor_rate"]
    if before is None:
        note = "There is no earlier window to compare with yet."
    elif better:
        note = "Logged coverage and floor days are at least as high since the game layer went on."
    else:
        note = "Some numbers are lower since the game layer went on. Quiet mode is an option in Settings."
    return {
        "since": since.isoformat(), "before": before, "after": after, "better": better,
        "caveat": "One person, no control group.", "note": note,
    }
