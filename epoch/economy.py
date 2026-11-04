"""Epoch economy: "live the NYC life" (docs/ECONOMY.md).

Study money pays for a growing life in Manhattan. Everything here is a read model on top of the same honest counters as XP
(`rules.py` day summaries, entries, outputs, the `unlocks` ledger), plus four additive, append-only tables (schema.sql):

    econ_earned   money earned per day and source, a RATCHET: a row can only go up, so deleting or editing an old entry never
                  shrinks savings (the same idea as the XP high-water mark). Sources: deep | output | star | kept.
    econ_ledger   append-only cash events: interest, rent, unpaid, deposit, deposit_back, move, purchase, spot_unlock, chest,
                  chest_item (unique `ref` = idempotent).
    econ_weeks    one frozen row per closed Monday-to-Sunday week: the rent-day recap and a point on the net-worth graph.
    econ_choice   what is switched on: outfit, tower upgrades, the home layout (free placement; the old `placed` slots are migrated into
                  it once and then left alone), items a move sent to storage, the last study spot.
    econ_missions one row per day the daily missions were picked: the three missions and which are done (a ratchet), see cozy.py.

Why week-close rows are MATERIALISED instead of re-simulated on every read: rent, interest, an unpaid week and an automatic move are
decisions about the past. If they were recomputed, a late backfill or a settings change could silently flip last month from "unpaid"
to "paid" and rewrite the home you lived in. Materialised rows are written once, in order, inside one transaction, and never change
(`INSERT OR IGNORE` on a unique ref + triggers that refuse UPDATE/DELETE). They are still deterministic and recomputable: a week's
rows depend only on the banked earnings up to its Sunday and the ledger before its close, and `close_weeks` replays any missing
week in order, so an empty `econ_weeks` table rebuilds the same history from the banked rows.

Savings (the balance) = sum of econ_earned + sum of econ_ledger.cents. It never goes below $0: a purchase needs the funds, rent is
only taken when savings cover it in full, and a week that cannot be covered is simply "unpaid" (nothing is taken).

Public entry points (all take a sqlite connection; `today` and `now` default to the real clock like the game layer):
    sync, economy_state, shop_state, buy, move_home, equip, world_block, week_line, gold_days, star_stats, character,
    events_status, ensure_schema, EconomyError
"""
from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from . import categories, db, game, layout as lay, rules, timeutil, weather as weather_mod
from . import economy_catalog as cat

log = logging.getLogger("epoch.economy")

SOURCES = ("deep", "output", "star", "kept")
START_HOME = cat.HOMES[0]["id"]
CHARACTER_WALK_MINUTES = 12      # after a focus block ends the character walks home for this long


class EconomyError(Exception):
    """A business-rule refusal (not enough savings, a locked district, a stale price...). `hint` is calm, user-facing copy."""

    def __init__(self, code: str, hint: str, **extra: Any) -> None:
        super().__init__(hint)
        self.code, self.hint, self.extra = code, hint, extra


def _d(cents: int) -> int:
    """Whole dollars, truncated toward zero (balances are never negative, so this is a floor for them)."""
    return cents // 100 if cents >= 0 else -((-cents) // 100)


def _money(cents: int) -> str:
    return f"${_d(cents):,}"


def _iso(dt: datetime) -> str:
    return timeutil.to_iso(dt)


# --------------------------------------------------------------------------
# Schema (additive; init_db creates it, this covers an old database that has not been re-initialised yet)
# --------------------------------------------------------------------------

_SCHEMA_OK: set[str] = set()


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the money/cozy tables on a database that was not re-initialised yet (every statement is IF NOT EXISTS)."""
    try:
        path = conn.execute("PRAGMA database_list").fetchone()["file"] or ""
    except (sqlite3.Error, TypeError, IndexError):
        path = ""
    if path and path in _SCHEMA_OK:
        return
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if not {"econ_choice", "econ_missions"} <= have:
        conn.executescript(db.SCHEMA_PATH.read_text())
    db.ensure_columns(conn)
    if path:
        _SCHEMA_OK.add(path)


# --------------------------------------------------------------------------
# The context: one game context plus the economy's own caches
# --------------------------------------------------------------------------

class _E:
    def __init__(self, conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None,
                 ctx: "game._Ctx | None" = None) -> None:
        ensure_schema(conn)
        self.conn = conn
        self.g = ctx or game._Ctx(conn, today, now)
        self.now = self.g.now
        self.today = self.g.today
        self._banked: dict[tuple[str, str], int] | None = None
        self._ledger: list[dict] | None = None
        self._timeline: list[tuple[datetime, int]] | None = None
        self._layout: dict | None = None

    # --- cache control ----------------------------------------------------

    def reload(self) -> None:
        self._banked = None
        self._ledger = None
        self._layout = None

    @property
    def banked(self) -> dict[tuple[str, str], int]:
        if self._banked is None:
            self._banked = {(r["local_date"], r["source"]): r["cents"]
                            for r in self.conn.execute("SELECT local_date, source, cents FROM econ_earned")}
        return self._banked

    @property
    def ledger(self) -> list[dict]:
        if self._ledger is None:
            rows = self.conn.execute("SELECT id, at_utc, kind, ref, cents, week, meta FROM econ_ledger ORDER BY id").fetchall()
            self._ledger = [{
                "id": r["id"], "at": timeutil.from_iso(r["at_utc"]), "at_iso": r["at_utc"], "kind": r["kind"], "ref": r["ref"],
                "cents": r["cents"], "week": r["week"], "meta": json.loads(r["meta"]) if r["meta"] else {},
            } for r in rows]
        return self._ledger

    # --- the pay rate: titles by skill-ladder node count ---------------------

    def node_times(self) -> list[str]:
        """When each unlocked skill-ladder node was unlocked, sorted. A node that counts as unlocked but is not in the ledger yet
        (the write that earned it has not been synced) counts from now."""
        times = sorted(row["unlocked_at"] for key, row in self.g.ledger.items() if key.startswith("node:") and row["kind"] == "node")
        total = sum(lad.nodes_unlocked for lad in self.g.ladders())
        times += [_iso(self.now)] * max(0, total - len(times))
        return times

    def nodes(self) -> int:
        return len(self.node_times())

    def timeline(self) -> list[tuple[datetime, int]]:
        """[(effective from, title index)] for the titles reached so far. A title starts at the moment of the unlock that reached it."""
        if self._timeline is None:
            times = self.node_times()
            line: list[tuple[datetime, int]] = [(datetime.min.replace(tzinfo=timeutil.UTC), 0)]
            for i, (need, _title, _rate) in enumerate(cat.TITLES):
                if i and len(times) >= need:
                    line.append((timeutil.from_iso(times[need - 1]), i))
            self._timeline = line
        return self._timeline

    def rate_at(self, t: datetime) -> int:
        """Dollars per deep hour in force at an instant. Never lowered: the node count only goes up."""
        idx = 0
        for eff, i in self.timeline():
            if eff <= t:
                idx = max(idx, i)
        return cat.TITLES[idx][2]

    def _deep_intervals(self, d: date) -> list[tuple[datetime, datetime]]:
        """The merged deep-work intervals of a day the rules engine counts (clipped to the day, sleep cutoff applied)."""
        calc = self.g.calc
        lo, hi = timeutil.day_bounds_utc(d, self.g.tz, self.g.dsh)
        cutoff = calc.sleep_cutoff_at(d)
        deep_hi = hi if cutoff is None else max(lo, min(hi, cutoff))
        pairs = []
        for e in self.g.entries:
            if e.deep and categories.counts_toward_floor(e.category, d, calc.build_until) and e.start < hi and e.end > lo:
                pairs.append((max(e.start, lo), min(e.end, deep_hi)))
        return rules._merge(pairs)

    def deep_cents(self, d: date, minutes: int) -> int:
        """Pay for a day's deep minutes (uncapped, sleep cutoff already applied) at the rate in force when they were worked.
        If a raise lands inside the day, the minutes after it are paid at the new rate."""
        if minutes <= 0:
            return 0
        lo, hi = timeutil.day_bounds_utc(d, self.g.tz, self.g.dsh)
        cuts = sorted(eff for eff, i in self.timeline() if i > 0 and lo < eff < hi)
        if not cuts:
            return minutes * self.rate_at(lo) * 100 // 60
        edges = [lo] + cuts + [hi]
        ivs = self._deep_intervals(d)
        secs = [sum(max(0.0, (min(y, b) - max(x, a)).total_seconds()) for x, y in ivs) for a, b in zip(edges, edges[1:])]
        total = sum(secs)
        if total <= 0:
            return minutes * self.rate_at(lo) * 100 // 60
        left, cents = minutes, 0
        for k, (a, _b) in enumerate(zip(edges, edges[1:])):
            part = left if k == len(secs) - 1 else min(left, int(minutes * secs[k] / total))
            cents += part * self.rate_at(a) * 100 // 60
            left -= part
        return cents

    # --- banking (the ratchet) -----------------------------------------------

    def bank(self) -> int:
        """Compute what each day and kept week has earned and raise the banked rows to it (never lower). Returns rows raised."""
        g, have = self.g, self.banked
        wanted: dict[tuple[str, str], int] = {}
        for d in g.days():
            s = g.summary(d)
            key = d.isoformat()
            deep = self.deep_cents(d, s.deep_minutes)
            if deep > 0:
                wanted[(key, "deep")] = deep
            n = min(len(g.outputs_by_day.get(d, [])), cat.OUTPUT_DAILY_CAP)
            if n:
                wanted[(key, "output")] = n * cat.OUTPUT_DOLLARS * 100
            if g.stars(d) >= 3:
                wanted[(key, "star")] = cat.STAR_DOLLARS * 100
        for monday in g.mondays():
            if g.week(monday).status == "kept":
                wanted[(monday.isoformat(), "kept")] = cat.KEPT_WEEK_DOLLARS * 100
        writes = [(k, v) for k, v in wanted.items() if v > have.get(k, 0)]
        if writes:
            stamp = db.utc_now_iso()
            with game._atomic(self.conn):
                self.conn.executemany(
                    "INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(local_date, source) DO UPDATE SET cents = excluded.cents, updated_utc = excluded.updated_utc "
                    "WHERE excluded.cents > econ_earned.cents",
                    [(k[0], k[1], v, stamp) for k, v in writes],
                )
            self._banked = None
        return len(writes)

    def earn_by_source(self, first: date | None = None, last: date | None = None) -> dict[str, int]:
        lo = first.isoformat() if first else ""
        hi = last.isoformat() if last else "9999-12-31"
        out = {s: 0 for s in SOURCES}
        for (day, source), cents in self.banked.items():
            if lo <= day <= hi and source in out:
                out[source] += cents
        return out

    def savings(self, until: datetime | None = None, last_day: date | None = None) -> int:
        """Savings in cents: banked earnings (through `last_day`) plus ledger events (before `until`)."""
        hi = last_day.isoformat() if last_day else "9999-12-31"
        earned = sum(c for (day, _s), c in self.banked.items() if day <= hi)
        led = sum(r["cents"] for r in self.ledger if until is None or r["at"] < until)
        return earned + led

    # --- homes ----------------------------------------------------------------

    def moves(self) -> list[dict]:
        return [r for r in self.ledger if r["kind"] == "move"]

    def home_at(self, t: datetime | None = None) -> dict:
        hid = START_HOME
        for r in self.moves():
            if t is None or r["at"] <= t:
                hid = r["meta"].get("to", hid)
        return cat.HOME_BY_ID.get(hid, cat.HOMES[0])

    def deposit_held(self, until: datetime | None = None) -> int:
        held = 0
        for r in self.ledger:
            if until is not None and r["at"] > until:
                continue
            if r["kind"] == "deposit":
                held -= r["cents"]
            elif r["kind"] == "deposit_back":
                held -= r["cents"]
        return max(0, held)

    def level_number(self) -> int:
        return self.g.level().number

    def district_unlocked(self, district: str | None) -> bool:
        if not district:
            return True
        first = next((f for f, _l, n, _i in game.DISTRICTS if n == district), None)
        return first is None or self.level_number() >= first

    # --- purchases and choices ------------------------------------------------

    def purchases(self) -> list[dict]:
        return [r for r in self.ledger if r["kind"] == "purchase"]

    def grants(self) -> list[dict]:
        """Chest-only things the user has been given (docs/COZY.md 4.6)."""
        return [r for r in self.ledger if r["kind"] == "chest_item"]

    def spot_unlocks(self) -> list[dict]:
        return [r for r in self.ledger if r["kind"] == "spot_unlock"]

    def owned_ids(self) -> set[str]:
        """Permanent things the user owns: bought items, chest finds and unlocked study spots (event tickets are separate: they are
        keyed by item and period)."""
        out = {cat.DEFAULT_OUTFIT, cat.DEFAULT_SPOT}
        for r in self.purchases():
            if not r["meta"].get("event"):
                out.add(r["meta"].get("item", ""))
        for r in self.grants() + self.spot_unlocks():
            out.add(r["meta"].get("item", ""))
        return out

    def owned_furniture(self) -> list[str]:
        """Furniture ids in the order they were bought or found."""
        out = []
        for r in self.ledger:
            if r["kind"] in ("purchase", "chest_item") and not r["meta"].get("event"):
                item = r["meta"].get("item", "")
                if cat.ITEM_BY_ID.get(item, {}).get("kind") == "furniture" and item not in out:
                    out.append(item)
        return out

    def lived_in(self, home_id: str) -> bool:
        """Has the user lived in this home (the current one counts)?"""
        return self.home_at()["id"] == home_id or any(r["meta"].get("to") == home_id for r in self.moves())

    def spot_open(self, spot: dict) -> bool:
        """Is a study spot usable now: Butler always, a bought one, or a home-gated one once you have lived in that home."""
        if spot["id"] == cat.DEFAULT_SPOT:
            return True
        if any(r["meta"].get("item") == spot["id"] for r in self.spot_unlocks()):
            return True
        return bool(spot.get("home") and self.lived_in(spot["home"]))

    def open_spots(self) -> list[str]:
        return [sp["id"] for sp in cat.STUDY_SPOTS if self.spot_open(sp)]

    def items_value_cents(self, until: datetime | None = None) -> int:
        """What owned things are worth: furniture, outfits and upgrades at what was paid; experiences are memories (0)."""
        total = 0
        for r in self.purchases():
            if until is not None and r["at"] >= until:
                continue
            if r["meta"].get("kind") in ("furniture", "outfit", "upgrade"):
                total += int(r["meta"].get("price_cents", 0))
        return total

    def choice(self, key: str, default: Any) -> Any:
        row = self.conn.execute("SELECT value FROM econ_choice WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["value"])
        except ValueError:
            return default

    def set_choice(self, key: str, value: Any) -> None:
        self.conn.execute(
            "INSERT INTO econ_choice(key, value, updated_utc) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_utc = excluded.updated_utc",
            (key, json.dumps(value), db.utc_now_iso()),
        )

    # --- the home layout (free placement; docs/COZY.md 4.2) ---------------------

    def layout_doc(self) -> dict:
        """The stored layout document {"v": 1, "homes": {home id: {"items": [...]}}}. The first read of a database that still has the
        old fixed slots migrates them into positions once (the old `placed` choice is then left alone)."""
        if self._layout is None:
            raw = self.choice("layout", None)
            if not (isinstance(raw, dict) and raw.get("v") == 1 and isinstance(raw.get("homes"), dict)):
                raw = self._migrate_layout()
            self._layout = raw
            self._fit_homes(raw)
        return self._layout

    def _fit_homes(self, doc: dict) -> None:
        """Homes with their own room shape (layout.ROOMS_BY_HOME): once per room revision, and whenever something no longer fits, move the
        saved pieces into the shape (the desk to the study spot). Idempotent; nothing is dropped (a piece with no room goes to storage)."""
        for hid, key in ((h, lay.room_for(h, "")) for h in lay.ROOMS_BY_HOME):
            entry = doc["homes"].get(hid)
            if not isinstance(entry, dict) or not isinstance(entry.get("items"), list):
                continue
            marker = lay.room_marker(key)
            items, left, changed = lay.fit_home(key, entry["items"], first=entry.get("room") != marker)
            if not changed and entry.get("room") == marker:
                continue
            doc["homes"][hid] = {**entry, "items": items, "room": marker}
            self.set_choice("layout", doc)
            if left:
                self.set_choice("displaced", left + [i for i in self.choice("displaced", []) if i not in left])

    def _migrate_layout(self) -> dict:
        home = self.home_at()
        owned = set(self.owned_furniture())
        old = self.choice("placed", [])
        placed: list[str | None] = []
        for item in (old if isinstance(old, list) else [])[:home["slots"]]:
            placed.append(item if item in owned and item not in placed else None)
        items, left = lay.migrate_slots(lay.room_for(home["id"], home["size"]), placed)
        doc = {"v": 1, "homes": {home["id"]: {"items": items}}}
        if left:      # no room found for them (cannot happen for the starter rooms): they wait in storage, never lost
            self.set_choice("displaced", left + [i for i in self.choice("displaced", []) if i not in left])
        self.conn.execute(
            "INSERT INTO econ_choice(key, value, updated_utc) VALUES ('layout', ?, ?) ON CONFLICT(key) DO NOTHING",
            (json.dumps(doc), db.utc_now_iso()))
        row = self.conn.execute("SELECT value FROM econ_choice WHERE key = 'layout'").fetchone()
        try:
            return json.loads(row["value"])
        except (TypeError, ValueError):
            return doc

    def layout_items(self, home: dict | None = None) -> list[dict]:
        """What is in a home's room: clean entries, only things that are owned, each once, at most the home's budget."""
        home = home or self.home_at()
        raw = self.layout_doc()["homes"].get(home["id"], {}).get("items", [])
        owned = set(self.owned_furniture())
        out: list[dict] = []
        for r in raw if isinstance(raw, list) else []:
            try:
                e = lay.normalize(r)
            except lay.LayoutError:
                continue
            if e["id"] in owned and all(o["id"] != e["id"] for o in out) and len(out) < home["budget"]:
                out.append(e)
        return out

    def set_layout_items(self, home_id: str, items: list[dict]) -> None:
        doc = json.loads(json.dumps(self.layout_doc()))
        entry: dict = {"items": items}
        if home_id in lay.ROOMS_BY_HOME:
            entry["room"] = lay.room_marker(home_id)
        doc.setdefault("homes", {})[home_id] = entry
        self.set_choice("layout", doc)
        self._layout = doc

    def placed_slots(self, home: dict | None = None) -> list[str | None]:
        """The old fixed-slot view of the room: the furniture id on each slot, None where nothing sits exactly on that slot."""
        home = home or self.home_at()
        out: list[str | None] = [None] * home["slots"]
        for e in self.layout_items(home):
            idx = lay.slot_of(lay.room_for(home["id"], home["size"]), e)
            if idx is not None and idx < len(out):
                out[idx] = e["id"]
        return out

    def storage(self, home: dict | None = None) -> list[str]:
        placed = {e["id"] for e in self.layout_items(home)}
        return [i for i in self.owned_furniture() if i not in placed]

    def outfit(self) -> str:
        item = self.choice("outfit", cat.DEFAULT_OUTFIT)
        return item if item in self.owned_ids() and cat.ITEM_BY_ID.get(item, {}).get("kind") == "outfit" else cat.DEFAULT_OUTFIT

    def upgrades(self) -> list[str]:
        owned = self.owned_ids()
        raw = self.choice("upgrades", [])
        return [i for i in (raw if isinstance(raw, list) else []) if i in owned and cat.ITEM_BY_ID.get(i, {}).get("kind") == "upgrade"]


# --------------------------------------------------------------------------
# Week close: rent, interest, unpaid weeks and automatic moves (materialised once, in order)
# --------------------------------------------------------------------------

def _frozen(conn: sqlite3.Connection) -> dict[str, dict]:
    return {r["monday"]: json.loads(r["summary"]) for r in conn.execute("SELECT monday, summary FROM econ_weeks ORDER BY monday")}


def _put(e: _E, at: datetime, kind: str, ref: str, cents: int, week: str | None, meta: dict | None = None) -> None:
    e.conn.execute(
        "INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES (?, ?, ?, ?, ?, ?)",
        (_iso(at), kind, ref, cents, week, json.dumps(meta) if meta else None),
    )
    e.reload()


def _relayout(e: _E, old_home: dict, new_home: dict) -> list[str]:
    """Carry the furniture into a new home. Every piece keeps its remembered place in that home, or the same place when it fits, or
    goes to the nearest free spot; whatever the new home has no budget or room for goes to storage (remembered in `displaced`, never
    lost). A bigger home takes the displaced things back first. Returns the ids sent to storage by this move."""
    size, budget = lay.room_for(new_home["id"], new_home["size"]), new_home["budget"]
    carried = e.layout_items(old_home)
    carried_ids = {c["id"] for c in carried}
    owned = set(e.owned_furniture())
    displaced = [i for i in e.choice("displaced", []) if i in owned and i not in carried_ids]
    memory = {x.get("id"): x for x in e.layout_doc()["homes"].get(new_home["id"], {}).get("items", []) if isinstance(x, dict)}
    rm = lay.room(size)
    placed: list[dict] = []

    def take(item: str, same: dict | None) -> bool:
        if len(placed) >= budget:
            return False
        for cand in (memory.get(item), same):
            if cand:
                try:
                    c = lay.normalize(cand)
                    lay.check(rm, c, placed)
                    placed.append(c)
                    return True
                except lay.LayoutError:
                    pass
        found = lay.auto_place(size, placed, item)
        if found is None:
            return False
        placed.append(found)
        return True

    sent = [c["id"] for c in carried if not take(c["id"], c)]
    for item in list(displaced):
        if take(item, None):
            displaced.remove(item)
    e.set_layout_items(new_home["id"], placed)
    e.set_choice("displaced", sent + [i for i in displaced if i not in sent])
    return sent


def _stored_message(n: int) -> str:
    return "Your things are safe in storage." if n else "Nothing had to go to storage."


def close_weeks(e: _E) -> list[str]:
    """Close every finished Monday-to-Sunday week that has not been closed yet, oldest first. Returns the Mondays closed."""
    g = e.g
    frozen = _frozen(e.conn)
    todo = []
    monday = timeutil.week_monday(g.start)
    while monday + timedelta(days=6) < g.today:
        if monday.isoformat() not in frozen:
            todo.append(monday)
        monday += timedelta(days=7)
    for m in todo:
        with game._atomic(e.conn):
            if e.conn.execute("SELECT 1 FROM econ_weeks WHERE monday = ?", (m.isoformat(),)).fetchone():
                continue                                    # another request closed it first
            e.reload()
            summary = _close_one(e, m, frozen)
            frozen[m.isoformat()] = summary
    if todo:
        e.reload()
    return [m.isoformat() for m in todo]


def _close_one(e: _E, monday: date, frozen: dict[str, dict]) -> dict:
    g = e.g
    sunday = monday + timedelta(days=6)
    open_utc = timeutil.day_bounds_utc(monday, g.tz, g.dsh)[0]
    close_utc = timeutil.day_bounds_utc(sunday, g.tz, g.dsh)[1]
    week = g.week(monday)
    has_contract = week.status != "baseline"
    earned = e.earn_by_source(monday, sunday)
    earned_cents = sum(earned.values())
    savings = e.savings(until=close_utc, last_day=sunday)

    interest = 0
    if week.status == "kept" and savings > 0:
        interest = min(cat.INTEREST_CAP_DOLLARS * 100, int(savings * cat.INTEREST_RATE))
    if interest:
        _put(e, close_utc, "interest", f"interest:{monday.isoformat()}", interest, monday.isoformat(), {"on_cents": savings})
        savings += interest

    start_home = e.home_at(open_utc)
    lived = {start_home["id"]} | {r["meta"].get("to") for r in e.moves() if open_utc < r["at"] <= close_utc}
    rent = max(cat.HOME_BY_ID[h]["rent"] for h in lived if h in cat.HOME_BY_ID)
    # the home the week's rent is for: the dearest one lived in (the start home when it ties), so the recap names the right place
    rent_home = start_home if start_home["rent"] >= rent else next(cat.HOME_BY_ID[h] for h in lived if h in cat.HOME_BY_ID and cat.HOME_BY_ID[h]["rent"] == rent)
    prev = [frozen[k] for k in sorted(frozen) if k < monday.isoformat()]
    streak = prev[-1]["unpaid_streak"] if prev else 0

    rent_status = "free"
    if has_contract:
        if savings >= rent * 100:
            _put(e, close_utc, "rent", f"rent:{monday.isoformat()}", -rent * 100, monday.isoformat(),
                 {"home": rent_home["id"], "dollars": rent})
            savings -= rent * 100
            rent_status, streak = "paid", 0
        else:
            _put(e, close_utc, "unpaid", f"unpaid:{monday.isoformat()}", 0, monday.isoformat(),
                 {"home": rent_home["id"], "dollars": rent, "savings_cents": savings})
            rent_status, streak = "unpaid", streak + 1

    moved = None
    home_now = e.home_at(close_utc)
    idx = cat.HOMES.index(home_now)
    if rent_status == "unpaid" and streak >= cat.UNPAID_WEEKS_TO_MOVE and idx > 0:
        target = cat.HOMES[idx - 1]
        held = e.deposit_held()
        n = sum(1 for r in e.moves()) + 1
        if held:
            _put(e, close_utc, "deposit_back", f"deposit_back:{n}", held, monday.isoformat(), {"home": home_now["id"]})
            savings += held
        new_dep = min(target["deposit"] * 100, max(0, savings))
        if new_dep:
            _put(e, close_utc, "deposit", f"deposit:{n}", -new_dep, monday.isoformat(), {"home": target["id"]})
            savings -= new_dep
        sent = _relayout(e, home_now, target)
        _put(e, close_utc, "move", f"move:{n}", 0, monday.isoformat(),
             {"from": home_now["id"], "to": target["id"], "reason": "quiet_weeks", "stored": sent})
        moved = {"from": home_now["id"], "to": target["id"], "reason": "quiet_weeks", "stored": len(sent),
                 "message": f"Two quiet weeks, so you moved to a smaller place for now. {_stored_message(len(sent))}"}
        streak = 0

    bought = [{"item": r["meta"].get("item"), "name": r["meta"].get("name"), "dollars": -r["cents"] // 100}
              for r in e.purchases() if open_utc <= r["at"] < close_utc]
    deposit = e.deposit_held(close_utc)
    items = e.items_value_cents(close_utc)
    net = savings + items + deposit
    summary = {
        "monday": monday.isoformat(), "sunday": sunday.isoformat(), "status": week.status, "kept": week.status == "kept",
        "earned": {**{s: _d(c) for s, c in earned.items()}, "total": _d(earned_cents)}, "earned_cents": earned_cents,
        "interest": _d(interest), "interest_cents": interest,
        "rent": {"due": rent if has_contract else 0, "status": rent_status, "home": rent_home["id"], "home_name": rent_home["name"]},
        "unpaid_streak": streak, "moved": moved,
        "purchases": bought, "purchases_total": sum(b["dollars"] for b in bought),
        "savings_end": _d(savings), "savings_end_cents": savings,
        "deposit_cents": deposit, "items_value_cents": items, "net_worth_cents": net, "net_worth": _d(net),
    }
    summary["message"] = _week_message(summary)
    e.conn.execute("INSERT OR IGNORE INTO econ_weeks(monday, closed_utc, summary) VALUES (?, ?, ?)",
                   (monday.isoformat(), _iso(close_utc), json.dumps(summary)))
    return summary


def _week_message(s: dict) -> str:
    """A calm one-line recap of a closed week (no guilt, no scolding)."""
    rent = s["rent"]
    bits = [f"Earned {_money(s['earned_cents'])}."]
    if s["interest_cents"]:
        bits.append(f"{_money(s['interest_cents'])} interest on your savings.")
    if rent["status"] == "free":
        bits.append("A rent-free week.")
    elif rent["status"] == "paid":
        bits.append(f"Rent of {_money(rent['due'] * 100)} paid.")
    else:
        bits.append(f"Rent of {_money(rent['due'] * 100)} was not covered this week, so nothing was taken.")
    if s["moved"]:
        bits.append(s["moved"]["message"])
    bits.append(f"Savings {_money(s['savings_end_cents'])}.")
    return " ".join(bits)


def sync(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None,
         ctx: "game._Ctx | None" = None) -> dict:
    """Bank what has been earned (the ratchet) and close any finished weeks. Idempotent, cheap when nothing changed."""
    e = _E(conn, today, now, ctx)
    return _sync(e)


def _sync(e: _E) -> dict:
    raised = e.bank()
    closed = close_weeks(e)
    missions: list = []
    try:                                  # the daily missions never get in the way of the money (late import: cozy builds on this module)
        from . import cozy
        missions = cozy.sync(e)
    except Exception:
        log.exception("cozy.sync failed")
    out = {"banked": raised, "weeks_closed": closed}
    if missions:
        out["missions_done"] = missions
    return out


# --------------------------------------------------------------------------
# Events calendar
# --------------------------------------------------------------------------

def _ny_date(now: datetime) -> date:
    return weather_mod.ny_time(now).date()


def events_status(now: datetime, wx: dict | None = None, unlocked: Any = None) -> list[dict]:
    """Every event with whether it is on right now. Dates are New York dates; the snow day uses the live NYC weather (`wx` is the
    answer of weather.get_weather, or None when offline). `unlocked(district) -> bool` says whether the user has reached the
    event's district."""
    today = _ny_date(now)
    out = []
    for ev in cat.EVENTS:
        item = {
            "id": ev["id"], "name": ev["name"], "price": ev["price"], "blurb": ev["blurb"], "season": ev["season"],
            "district": ev["district"], "reason": "weather" if ev.get("weather") else "dates",
            "on": False, "start": None, "end": None, "days_left": None, "starts_in": None, "period": None,
            "unlocked": unlocked(ev["district"]) if unlocked else True,
        }
        if ev.get("weather"):
            snowing = bool(wx and wx.get("available") and wx.get("condition") == ev["weather"] and today.month in ev["months"])
            item["on"] = snowing
            item["period"] = today.isoformat() if snowing else None
            item["weather"] = ev["weather"]
        else:
            found = None
            upcoming = None
            for year in (today.year - 1, today.year, today.year + 1):
                lo, hi = cat.event_window(ev, year)
                if lo <= today <= hi:
                    found = (lo, hi)
                elif lo > today and (upcoming is None or lo < upcoming[0]):
                    upcoming = (lo, hi)
            win = found or upcoming
            if win:
                item["start"], item["end"] = win[0].isoformat(), win[1].isoformat()
            if found:
                item["on"] = True
                item["period"] = str(found[0].year)
                item["days_left"] = (found[1] - today).days
            elif upcoming:
                item["starts_in"] = (upcoming[0] - today).days
        out.append(item)
    return out


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------

def _home_view(e: _E, home: dict, current_id: str, held: int, savings: int) -> dict:
    unlocked = e.district_unlocked(home["district"])
    net = home["deposit"] * 100 - held
    is_current = home["id"] == current_id
    why = None
    if is_current:
        why = "You live here."
    elif not unlocked:
        first = next(f for f, _l, n, _i in game.DISTRICTS if n == home["district"])
        why = f"Opens at Level {first}, {home['district']}."
    elif net > savings:
        why = f"A deposit of {_money(home['deposit'] * 100)} (less the {_money(held)} you get back) needs {_money(net - savings)} more savings."
    first = next(f for f, _l, n, _i in game.DISTRICTS if n == home["district"])
    return {
        **home, "district_id": game.district_id(home["district"]), "unlocks_at_level": first, "unlocked": unlocked,
        "current": is_current, "deposit_net": _d(net), "deposit_net_cents": net,
        "can_move": bool(unlocked and not is_current and net <= savings), "why_not": why,
        "token": _token(e, "move", home["id"], net),
    }


def _token(e: _E, kind: str, ident: str, cents: int) -> str:
    """The confirm token of a price: it changes when the price or any money event changes, so a stale confirm is refused."""
    row = e.conn.execute("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM econ_ledger").fetchone()
    return hashlib.sha256(f"v1|{kind}|{ident}|{cents}|{row['n']}|{row['m']}".encode()).hexdigest()[:12]


def _placed_view(e: _E, home: dict | None = None) -> list[dict]:
    """The OLD slot view of the room (what the first room view and the Home page list): only pieces that sit exactly on a fixed slot.
    The full picture is `_layout_view`."""
    home = home or e.home_at()
    out = []
    for slot, item in enumerate(e.placed_slots(home)):
        if item:
            it = cat.ITEM_BY_ID[item]
            out.append({"slot": slot, "item": item, "name": it["name"], "category": it["category"], "tier": it["tier"]})
    return out


def _entry_view(entry: dict) -> dict:
    """A layout entry with what a client needs to draw it: name, size, anchor, layer and activity."""
    it = cat.ITEM_BY_ID[entry["id"]]
    out = {**entry, "name": it["name"], "category": it["category"], "tier": it["tier"], "size": it["size"], "anchor": it["anchor"],
           "layer": it["layer"], "activity": it["activity"], "chest_only": bool(it.get("chest_only"))}
    if entry["surface"] == "floor":      # the footprint's bounding box [x0, x1, z0, z1] that collisions use
        out["box"] = [round(v, 3) for v in lay.floor_box(entry)]
    return out


def _layout_view(e: _E, home: dict | None = None) -> dict:
    """The room as placed: `items` (positions), `storage`, the budget and how much of it is used, in plain words."""
    home = home or e.home_at()
    items = e.layout_items(home)
    used = len(items)
    word = lay.SIZE_WORD.get(home["size"], "home")
    return {
        "v": 1, "home": home["id"], "size": home["size"], "budget": home["budget"], "used": used, "free": max(0, home["budget"] - used),
        "message": f"{used} of {home['budget']} places used",
        "capacity_text": f"Your {word} fits {home['budget']} things. {used} {'is' if used == 1 else 'are'} out.",
        "items": [_entry_view(x) for x in items],
        "storage": [{**_item_stub(i), "size": cat.ITEM_BY_ID[i]["size"], "surface": cat.ITEM_BY_ID[i]["surface"],
                     "layer": cat.ITEM_BY_ID[i]["layer"], "activity": cat.ITEM_BY_ID[i]["activity"]} for i in e.storage(home)],
    }


def _item_stub(item_id: str) -> dict:
    it = cat.ITEM_BY_ID[item_id]
    return {"item": item_id, "name": it["name"], "category": it["category"], "tier": it["tier"]}


def _rent_block(e: _E, frozen: dict[str, dict]) -> dict:
    g = e.g
    monday = timeutil.week_monday(g.today)
    sunday = monday + timedelta(days=6)
    week = g.week(monday)
    open_utc = timeutil.day_bounds_utc(monday, g.tz, g.dsh)[0]
    close_utc = timeutil.day_bounds_utc(sunday, g.tz, g.dsh)[1]
    home = e.home_at()
    lived = {e.home_at(open_utc)["id"], home["id"]}
    rent = max(cat.HOME_BY_ID[h]["rent"] for h in lived)
    savings = e.savings()
    streak = (frozen[max(frozen)]["unpaid_streak"] if frozen else 0)
    first_row = e.conn.execute("SELECT MIN(effective_from) AS m FROM contracts").fetchone()["m"]
    free = week.status == "baseline"
    covered = savings >= rent * 100
    if free:
        status = "free"
        msg = "This week is rent-free." + (f" Rent starts with the week of {date.fromisoformat(first_row).strftime('%a %-d %b')}." if first_row else "")
    elif covered:
        status = "covered"
        msg = f"Rent of {_money(rent * 100)} comes due Sunday night, and your savings cover it."
    else:
        status = "short"
        msg = (f"Rent of {_money(rent * 100)} comes due Sunday night. Savings are {_money(rent * 100 - savings)} short right now, "
               "and nothing is taken if they cannot cover it.")
    if streak and not free:
        msg += " One quiet week so far." if streak == 1 else ""
    return {
        "amount": 0 if free else rent, "weekly_rent": rent, "free": free, "status": status, "covered": covered if not free else True,
        "short_by": 0 if free or covered else _d(rent * 100 - savings), "due_date": sunday.isoformat(),
        "closes_at": _iso(close_utc), "unpaid_streak": streak, "weeks_to_move": max(0, cat.UNPAID_WEEKS_TO_MOVE - streak),
        "can_step_down": e.home_at() is not cat.HOMES[0], "message": msg,
        "first_rent_week": first_row,
    }


def _week_live(e: _E, frozen: dict[str, dict]) -> dict:
    g = e.g
    monday = timeutil.week_monday(g.today)
    sunday = monday + timedelta(days=6)
    by = e.earn_by_source(monday, sunday)
    total = sum(by.values())
    closed_total = sum(s["earned_cents"] for s in frozen.values())
    all_banked = sum(e.banked.values())
    late = max(0, all_banked - closed_total - total)
    week = g.week(monday)
    s = g.summary(g.today)
    return {
        "monday": monday.isoformat(), "sunday": sunday.isoformat(), "status": week.status,
        "earned": {**{k: _d(v) for k, v in by.items()}, "late": _d(late), "total": _d(total + late)},
        "deep_minutes": week.deep_minutes, "outputs": week.outputs_count,
        "today": {"date": g.today.isoformat(), "deep_minutes": s.deep_minutes,
                  "earned": _d(sum(c for (day, _s), c in e.banked.items() if day == g.today.isoformat()))},
    }


def _rate_block(e: _E) -> dict:
    times = e.node_times()
    n = len(times)
    idx, title, per_hour = cat.title_for(n)
    nxt = None
    if idx + 1 < len(cat.TITLES):
        need, t2, r2 = cat.TITLES[idx + 1]
        nxt = {"title": t2, "per_hour": r2, "nodes_needed": need, "nodes_to_go": need - n, "raise": r2 - per_hour}
    raises = []
    for eff, i in e.timeline():
        if i > 0:
            raises.append({"title": cat.TITLES[i][1], "per_hour": cat.TITLES[i][2], "at": _iso(eff)})
    return {
        "per_hour": per_hour, "per_minute": round(per_hour / 60, 4), "title": title, "level": idx, "nodes": n, "nodes_total": 25,
        "next": nxt, "raises": raises,
        "ladder": [{"title": t, "per_hour": r, "nodes_needed": need, "reached": n >= need} for need, t, r in cat.TITLES],
    }


def gold_days(e: _E) -> list[str]:
    """Days with three stars: the banked star rows (permanent) plus any day that has three stars now."""
    days = {day for (day, source), c in e.banked.items() if source == "star" and c > 0}
    days |= {d.isoformat() for d in e.g.days() if e.g.stars(d) >= 3}
    return sorted(days)


def star_stats(e: _E, days: list[str] | None = None) -> dict:
    days = days if days is not None else gold_days(e)
    have = {date.fromisoformat(x) for x in days}
    best = run = 0
    prev = None
    for d in sorted(have):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        best = max(best, run)
        prev = d
    cur = 0
    d = e.g.today if e.g.today in have else e.g.today - timedelta(days=1)
    while d in have:
        cur += 1
        d -= timedelta(days=1)
    monday = timeutil.week_monday(e.g.today)
    return {
        "days": len(have), "this_week": sum(1 for x in have if monday <= x <= monday + timedelta(days=6)),
        "run": cur, "best_run": best, "bonus": cat.STAR_DOLLARS,
        "goal_minutes": e.g.deep_star,
    }


def selected_spot(conn: sqlite3.Connection) -> str:
    """The study spot a new focus run will use: the last one used, if it is still open, else Butler. Light (a few rows), so the
    Pomodoro state can call it on every tick. Level gates are only checked when a spot is bought; an open spot stays open."""
    try:
        row = conn.execute("SELECT value FROM econ_choice WHERE key = 'spot'").fetchone()
        wanted = json.loads(row["value"]) if row else cat.DEFAULT_SPOT
    except (sqlite3.Error, ValueError, TypeError):
        wanted = cat.DEFAULT_SPOT
    sp = cat.SPOT_BY_ID.get(wanted) if isinstance(wanted, str) else None
    if sp is None or sp["id"] == cat.DEFAULT_SPOT:
        return cat.DEFAULT_SPOT
    try:
        if conn.execute("SELECT 1 FROM econ_ledger WHERE kind = 'spot_unlock' AND ref = ?", (f"spot:{sp['id']}",)).fetchone():
            return sp["id"]
        if sp.get("home"):
            for r in conn.execute("SELECT meta FROM econ_ledger WHERE kind = 'move'"):
                if json.loads(r["meta"] or "{}").get("to") == sp["home"]:
                    return sp["id"]
    except (sqlite3.Error, ValueError):
        pass
    return cat.DEFAULT_SPOT


def spot_stub(spot_id: str) -> dict:
    sp = cat.SPOT_BY_ID.get(spot_id) or cat.SPOT_BY_ID[cat.DEFAULT_SPOT]
    return {"id": sp["id"], "name": sp["name"], "short": sp["short"], "pin": sp["pin"], "outdoor": sp["outdoor"]}


def _focus(e: _E) -> dict:
    row = e.conn.execute("SELECT start_utc, category, label FROM focus_sessions WHERE end_utc IS NULL ORDER BY id DESC LIMIT 1").fetchone()
    if row is not None:
        return {"running": True, "kind": "focus", "category": row["category"], "since": row["start_utc"], "spot": selected_spot(e.conn)}
    run = e.conn.execute(
        "SELECT category, phase_start_utc, phase_idx, spot FROM pomodoro_runs WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if run is not None and run["phase_idx"] % 2 == 0:
        spot = run["spot"] if run["spot"] in cat.SPOT_BY_ID else selected_spot(e.conn)
        return {"running": True, "kind": "pomodoro", "category": run["category"], "since": run["phase_start_utc"], "spot": spot}
    return {"running": False}


def _last_block_end(e: _E) -> datetime | None:
    stamps = []
    for sql in ("SELECT MAX(end_utc) AS t FROM focus_sessions WHERE end_utc IS NOT NULL AND COALESCE(outcome, '') != 'cancelled'",
                "SELECT MAX(ended_utc) AS t FROM pomodoro_blocks WHERE status != 'discarded'"):
        try:
            t = e.conn.execute(sql).fetchone()["t"]
        except sqlite3.Error:
            t = None
        if t:
            stamps.append(timeutil.from_iso(t))
    return max(stamps) if stamps else None


def character(e: _E, focus: dict | None = None) -> dict:
    """What the faceless figure is doing: studying at the run's study spot (Butler Library by default) during a focus block, walking
    home for a few minutes after it, asleep at home past the sleep cutoff (a gentle nudge), otherwise at home. `location` is the
    spot id while studying, and the World view shows the figure INSIDE that building (nobody stands outside)."""
    focus = focus or _focus(e)
    if focus["running"]:
        spot = focus.get("spot") or cat.DEFAULT_SPOT
        return {"state": "studying", "location": spot, "since": focus["since"], "spot": spot, "pin": spot_stub(spot)["pin"]}
    end = _last_block_end(e)
    if end is not None and timedelta(0) <= e.now - end < timedelta(minutes=CHARACTER_WALK_MINUTES):
        return {"state": "walking_home", "location": "street", "since": _iso(end)}
    cutoff = e.g.calc.sleep_cutoff_at(e.g.today)
    if cutoff is not None:
        day_hi = timeutil.day_bounds_utc(e.g.today, e.g.tz, e.g.dsh)[1]
        if cutoff <= e.now < day_hi:
            return {"state": "asleep", "location": "home", "since": _iso(cutoff)}
    return {"state": "home", "location": "home", "since": None}


def activity_hint(e: _E, macro: str) -> dict:
    """What the character can do at home, from what is owned AND placed (docs/COZY.md 4.4): the macro state, the activity ids, and for
    each one the pieces that unlock it. `look_outside` and `sleep` are always there (the window, the bed), `make_tea` is free in a home
    with a kitchen. Night-only ones are flagged; the client knows the hour."""
    home = e.home_at()
    by: dict[str, list[str]] = {"look_outside": [], "sleep": []}
    if lay.describe(lay.room_for(home["id"], home["size"]))["kitchen"]:
        by["make_tea"] = ["kitchen"]
    for entry in e.layout_items(home):
        act = cat.ITEM_BY_ID[entry["id"]].get("activity")
        if act:
            by.setdefault(act, []).append(entry["id"])
    order = list(cat.ACTIVITIES)
    ids = sorted(by, key=order.index)
    return {
        "macro": macro, "activities": ids,
        "detail": [{"id": a, "name": cat.ACTIVITIES[a]["name"], "night_only": bool(cat.ACTIVITIES[a].get("night_only")),
                    "free": not by[a] or "kitchen" in by[a], "from": [x for x in by[a] if x != "kitchen"]} for a in ids],
        "sleep_cutoff": e.g.s.get("sleep_cutoff"),
    }


def _recap_block(e: _E, frozen: dict[str, dict], live_net: int, live_savings: int) -> dict:
    weeks = [frozen[k] for k in sorted(frozen)]
    series = [{"monday": w["monday"], "net_worth": w["net_worth"], "savings": _d(w["savings_end_cents"]),
               "earned": w["earned"]["total"], "live": False} for w in weeks]
    series.append({"monday": timeutil.week_monday(e.g.today).isoformat(), "net_worth": _d(live_net), "savings": _d(live_savings),
                   "earned": None, "live": True})
    return {"latest": weeks[-1] if weeks else None, "weeks": weeks[-12:][::-1], "series": series}


def economy_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None,
                  wx: dict | None = None, ctx: "game._Ctx | None" = None) -> dict:
    """GET /api/economy: everything the money screens need, after banking and closing finished weeks."""
    e = _E(conn, today, now, ctx)
    _sync(e)
    frozen = _frozen(conn)
    savings = e.savings()
    held = e.deposit_held()
    items_value = e.items_value_cents()
    net = savings + items_value + held
    home = e.home_at()
    owned = e.owned_ids()
    by_kind = {k: [i["id"] for i in cat.ITEMS + cat.CHEST_ITEMS if i["kind"] == k and i["id"] in owned]
               for k in ("furniture", "outfit", "upgrade", "experience", "postcard")}
    by_kind["spot"] = e.open_spots()
    gold = gold_days(e)
    passport = []
    for r in e.purchases():
        meta = r["meta"]
        if meta.get("kind") == "experience":
            passport.append({"item": meta["item"], "name": meta.get("name"), "bought_at": r["at_iso"], "price": meta.get("price_cents", 0) // 100,
                             "event": bool(meta.get("event")), "period": meta.get("period")})
    for r in e.grants():          # chest postcards sit in the passport too (free, one of a kind)
        if r["meta"].get("kind") == "postcard":
            passport.append({"item": r["meta"]["item"], "name": r["meta"].get("name"), "bought_at": r["at_iso"], "price": 0,
                             "event": False, "period": None, "chest": True})
    passport.sort(key=lambda p_: p_["bought_at"])
    events = events_status(e.now, wx, e.district_unlocked)
    quiet = bool(game.setting(conn, "quiet_mode"))
    focus = _focus(e)
    total_earned = sum(e.banked.values()) + sum(r["cents"] for r in e.ledger if r["kind"] == "interest")
    from . import cozy      # late import: cozy builds on this module
    char = character(e, focus)
    char["activity_hint"] = activity_hint(e, char["state"])
    extra = cozy.economy_block(e, quiet)
    return {
        "ok": True, "quiet": quiet, "as_of": _iso(e.now), "today": e.g.today.isoformat(),
        "balance": _d(savings), "balance_cents": savings, "net_worth": _d(net), "net_worth_cents": net,
        "earned_total": _d(total_earned), "deposit_held": _d(held), "items_value": _d(items_value),
        "rate": _rate_block(e), "week": _week_live(e, frozen), "rent": _rent_block(e, frozen),
        "level": e.g.level().as_dict(),
        "home": {**home, "district_id": game.district_id(home["district"]), "deposit_held": _d(held), "placed": _placed_view(e),
                 "layout": _layout_view(e), "used": len(e.layout_items(home))},
        "homes": [_home_view(e, h, home["id"], held, savings) for h in cat.HOMES],
        "storage": [_item_stub(i) for i in e.storage()],
        "owned": by_kind, "equipped": {"outfit": e.outfit(), "upgrades": e.upgrades()},
        "passport": passport, "events": [ev for ev in events if ev["on"]],
        "stars": star_stats(e, gold), "gold_days": gold,
        "recap": _recap_block(e, frozen, net, savings),
        "focus": focus, "character": char, **extra,
        "constants": {
            "output_dollars": cat.OUTPUT_DOLLARS, "output_daily_cap": cat.OUTPUT_DAILY_CAP, "star_dollars": cat.STAR_DOLLARS,
            "kept_week_dollars": cat.KEPT_WEEK_DOLLARS, "interest_rate": cat.INTEREST_RATE, "interest_cap": cat.INTEREST_CAP_DOLLARS,
            "deposit_weeks": cat.DEPOSIT_WEEKS, "unpaid_weeks_to_move": cat.UNPAID_WEEKS_TO_MOVE,
            "size_slots": cat.SIZES, "size_budget": cat.BUDGETS, "deep_hours_uncapped": True,
            "chest_max": cat.CHEST_MAX,
        },
    }


# --------------------------------------------------------------------------
# The shop
# --------------------------------------------------------------------------

def _item_view(e: _E, it: dict, owned: set[str], balance: int, in_room: dict[str, int], wx_events: dict[str, dict]) -> dict:
    ev = wx_events.get(it["id"])
    price_cents = it["price"] * 100
    unlocked = e.district_unlocked(it["district"])
    is_owned = it["id"] in owned
    if ev is not None:
        period = ev["period"]
        is_owned = bool(period and any(r["meta"].get("item") == it["id"] and r["meta"].get("period") == period for r in e.purchases()))
        state = "owned" if is_owned else "locked" if not unlocked else "off" if not ev["on"] else "available"
    else:
        state = "owned" if is_owned else "locked" if not unlocked else "available"
    first = next((f for f, _l, n, _i in game.DISTRICTS if n == it["district"]), None) if it["district"] else None
    affordable = balance >= price_cents
    view = {
        "id": it["id"], "aisle": it["kind"], "name": it["name"], "blurb": it["blurb"], "category": it["category"], "tier": it["tier"],
        "price": it["price"], "district": it["district"], "unlocks_at_level": first, "owned": is_owned, "state": state,
        "affordable": affordable, "short_by": 0 if affordable else _d(price_cents - balance),
        "can_buy": state == "available" and affordable, "token": _token(e, "buy", it["id"], price_cents),
        "equipped": False, "slot": None,
    }
    if it["kind"] == "furniture":
        # slot: the old fixed slot it sits on, -1 when it stands elsewhere in the room, None when it is not in the room
        view["slot"] = in_room.get(it["id"])
        view["in_room"] = it["id"] in in_room
        view["in_storage"] = is_owned and it["id"] not in in_room
        act = it.get("activity")
        view.update(size=it["size"], anchor=it["anchor"], surface=it["surface"], layer=it["layer"], activity=act,
                    activity_line=cat.ACTIVITIES[act]["line"] if act else "", chest_only=bool(it.get("chest_only")))
    elif it["kind"] == "outfit":
        view["equipped"] = it["id"] == e.outfit()
    elif it["kind"] == "upgrade":
        view["equipped"] = it["id"] in e.upgrades()
    if state == "locked":
        view["why_not"] = f"Opens at Level {first}, {it['district']}."
    elif state == "off":
        view["why_not"] = "Not on right now."
    elif is_owned:
        view["why_not"] = "Already yours."
    elif not affordable:
        view["why_not"] = f"{_money(price_cents - balance)} more savings to go."
    else:
        view["why_not"] = None
    if ev is not None:
        view["event"] = {k: ev[k] for k in ("on", "start", "end", "days_left", "starts_in", "period", "reason", "season")}
    return view


def _in_room(e: _E) -> dict[str, int]:
    """{furniture id: its old fixed slot, or -1 when it stands elsewhere} for the current home."""
    home = e.home_at()
    out = {}
    for entry in e.layout_items(home):
        slot = lay.slot_of(lay.room_for(home["id"], home["size"]), entry)
        out[entry["id"]] = -1 if slot is None else slot
    return out


def shop_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None,
               wx: dict | None = None, ctx: "game._Ctx | None" = None) -> dict:
    """GET /api/shop: every aisle with prices, what is owned, what is locked and why, and a confirm token per item."""
    e = _E(conn, today, now, ctx)
    _sync(e)
    balance = e.savings()
    owned = e.owned_ids()
    placed = _in_room(e)
    evs = {ev["id"]: ev for ev in events_status(e.now, wx, e.district_unlocked)}
    aisles = []
    for a in cat.AISLES:
        items = [_item_view(e, it, owned, balance, placed, evs) for it in cat.ITEMS if it["kind"] == a["id"] and it["id"] != cat.DEFAULT_OUTFIT]
        if a["id"] == "outfit":
            default = cat.ITEM_BY_ID[cat.DEFAULT_OUTFIT]
            items.insert(0, {**_item_view(e, default, owned, balance, placed, evs), "owned": True, "state": "owned", "can_buy": False})
        aisles.append({**a, "items": items})
    events = []
    for ev in cat.EVENTS:
        it = {"id": ev["id"], "kind": "experience", "name": ev["name"], "price": ev["price"], "blurb": ev["blurb"], "category": "event",
              "tier": "basic", "district": ev["district"]}
        events.append(_item_view(e, it, owned, balance, placed, evs))
    return {
        "ok": True, "quiet": bool(game.setting(conn, "quiet_mode")), "as_of": _iso(e.now), "balance": _d(balance), "balance_cents": balance,
        "level": e.g.level().as_dict(), "aisles": aisles, "events": events,
        "home": {"id": e.home_at()["id"], "slots": e.home_at()["slots"], "size": e.home_at()["size"],
                 "budget": e.home_at()["budget"], "used": len(e.layout_items())},
    }


def _find_item(e: _E, item_id: str, wx: dict | None) -> tuple[dict, dict | None]:
    it = cat.ITEM_BY_ID.get(item_id)
    if it is not None:
        if it.get("chest_only"):
            raise EconomyError("chest_only", f"{it['name']} is not sold. It can turn up in a daily chest.")
        return it, None
    sp = cat.SPOT_BY_ID.get(item_id)
    if sp is not None:
        return spot_item(sp), None
    ev = cat.EVENT_BY_ID.get(item_id)
    if ev is None:
        raise EconomyError("unknown_item", "That item is not in the shop.")
    item = {"id": ev["id"], "kind": "experience", "name": ev["name"], "price": ev["price"], "blurb": ev["blurb"], "category": "event",
            "tier": "basic", "district": ev["district"]}
    status = next(s for s in events_status(e.now, wx, e.district_unlocked) if s["id"] == item_id)
    return item, status


def spot_item(sp: dict) -> dict:
    """A study spot as a buyable thing (the existing buy flow unlocks it with `item = spot id`)."""
    return {"id": sp["id"], "kind": "spot", "name": sp["name"], "price": sp["price"], "blurb": sp["blurb"], "category": "spot",
            "tier": "basic", "district": sp["district"], "gate_name": sp["gate_name"], "home": sp.get("home")}


def _gate_text(it: dict, first: int) -> str:
    if it["kind"] == "spot":
        return f"{it['gate_name']} opens with {it['district']}, Level {first}."
    return f"{it['name']} opens at Level {first}, {it['district']}."


def buy(conn: sqlite3.Connection, item_id: str, price: int | None = None, token: str | None = None, today: date | None = None,
        now: datetime | None = None, wx: dict | None = None) -> dict:
    """The safe two-step buy. Step 1 (no token): returns a quote {price, balance_after, token}. Step 2: send the price and the
    token from the quote; they must still match, there must be enough savings, the district must be open and an event must be on.
    Everything is checked again inside one transaction. Raises EconomyError for every refusal."""
    e = _E(conn, today, now)
    _sync(e)
    it, event = _find_item(e, str(item_id), wx)
    price_cents = it["price"] * 100
    if it["id"] == cat.DEFAULT_OUTFIT:
        raise EconomyError("already_owned", "Those clothes are always yours.")
    if it["kind"] == "spot" and it.get("home") and it["id"] not in e.owned_ids():
        home_name = cat.HOME_BY_ID[it["home"]]["name"]
        raise EconomyError("home_gated", f"{it['gate_name']} opens once you live in {home_name}.")
    if not e.district_unlocked(it["district"]):
        first = next(f for f, _l, n, _i in game.DISTRICTS if n == it["district"])
        raise EconomyError("locked", _gate_text(it, first), level=first)
    period = None
    if event is not None:
        if not event["on"]:
            raise EconomyError("off_season", f"{it['name']} is not on right now.")
        period = event["period"]
    if event is None and it["id"] in e.owned_ids():
        raise EconomyError("already_owned", f"You already have {it['name']}.")
    if event is not None and any(r["meta"].get("item") == it["id"] and r["meta"].get("period") == period for r in e.purchases()):
        raise EconomyError("already_owned", f"You already have this {it['name']} postcard.")
    balance = e.savings()
    quote = {"item": it["id"], "name": it["name"], "price": it["price"], "balance": _d(balance), "balance_after": _d(balance - price_cents),
             "affordable": balance >= price_cents, "token": _token(e, "buy", it["id"], price_cents)}
    if token is None or price is None:
        if not quote["affordable"]:
            raise EconomyError("insufficient_funds", _short_copy(it["name"], price_cents - balance), quote=quote,
                               short_by=_d(price_cents - balance))
        return {"ok": True, "confirm_needed": True, "quote": quote}
    if int(price) != it["price"]:
        raise EconomyError("price_changed", f"The price changed to {_money(price_cents)}. Have another look.", quote=quote)
    if token != quote["token"]:
        raise EconomyError("stale", "Something changed since you looked, so nothing was bought. Have another look.", quote=quote)
    if balance < price_cents:
        raise EconomyError("insufficient_funds", _short_copy(it["name"], price_cents - balance), quote=quote,
                           short_by=_d(price_cents - balance))
    is_spot = it["kind"] == "spot"
    ref = f"spot:{it['id']}" if is_spot else f"purchase:{it['id']}" + (f":{period}" if event is not None else "")
    with db.transaction(conn):
        e.reload()
        if e.savings() < price_cents:      # a second request got there first
            raise EconomyError("insufficient_funds", _short_copy(it["name"], price_cents - e.savings()), quote=quote)
        meta = {"item": it["id"], "name": it["name"], "kind": it["kind"], "price_cents": price_cents}
        if event is not None:
            meta.update(event=True, period=period)
        cur = conn.execute("INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES (?, ?, ?, ?, ?, ?)",
                           (_iso(e.now), "spot_unlock" if is_spot else "purchase", ref, -price_cents,
                            timeutil.week_monday(e.g.today).isoformat(), json.dumps(meta)))
        if not cur.rowcount:
            raise EconomyError("already_owned", f"You already have {it['name']}.")
        e.reload()
        result = _after_purchase(e, it)
    balance_after = e.savings()
    return {"ok": True, "bought": True, "item": it["id"], "name": it["name"], "price": it["price"], "balance": _d(balance_after),
            "balance_cents": balance_after, **result,
            "toast": (f"{spot_stub(it['id'])['short']} is open. {_money(balance_after)} in savings." if is_spot
                      else f"{it['name']} is yours. {_money(balance_after)} in savings.")}


def _short_copy(name: str, short_cents: int) -> str:
    return f"{name} is {_money(short_cents)} more than your savings right now. It will be here when you are ready."


def _after_purchase(e: _E, it: dict) -> dict:
    """A new thing goes straight into use: furniture into a free place in the room (or storage when the home is full), an outfit on,
    an upgrade on, a study spot selected for the next focus run."""
    kind = it["kind"]
    if kind == "furniture":
        home = e.home_at()
        items = e.layout_items(home)
        entry = lay.auto_place(lay.room_for(home["id"], home["size"]), items, it["id"]) if len(items) < home["budget"] else None
        if entry is not None:
            e.set_layout_items(home["id"], items + [entry])
            slot = lay.slot_of(lay.room_for(home["id"], home["size"]), entry)
            return {"placed": {"slot": -1 if slot is None else slot}, "stored": False, "entry": _entry_view(entry)}
        return {"placed": None, "stored": True}
    if kind == "outfit":
        e.set_choice("outfit", it["id"])
        return {"equipped": True}
    if kind == "upgrade":
        e.set_choice("upgrades", sorted(set(e.upgrades()) | {it["id"]}))
        return {"equipped": True}
    if kind == "spot":
        e.set_choice("spot", it["id"])
        return {"spot": spot_stub(it["id"]), "selected": True}
    return {"passport": True}


# --------------------------------------------------------------------------
# Moving and equipping
# --------------------------------------------------------------------------

def move_home(conn: sqlite3.Connection, home_id: str, token: str | None = None, today: date | None = None,
              now: datetime | None = None) -> dict:
    """Move to another home you have unlocked. Two steps like the shop: without a token it returns the quote (deposit, what you
    get back, the rent for the week); with the token from the quote it moves."""
    e = _E(conn, today, now)
    _sync(e)
    target = cat.HOME_BY_ID.get(str(home_id))
    if target is None:
        raise EconomyError("unknown_home", "That home is not on the list.")
    current = e.home_at()
    if target["id"] == current["id"]:
        raise EconomyError("same_home", "You already live there.")
    if not e.district_unlocked(target["district"]):
        first = next(f for f, _l, n, _i in game.DISTRICTS if n == target["district"])
        raise EconomyError("locked", f"{target['name']} opens at Level {first}, {target['district']}.", level=first)
    held = e.deposit_held()
    net = target["deposit"] * 100 - held
    savings = e.savings()
    quote = {
        "home": target["id"], "name": target["name"], "deposit": target["deposit"], "deposit_back": _d(held), "net": _d(net),
        "net_cents": net, "rent": target["rent"], "balance": _d(savings), "balance_after": _d(savings - net),
        "affordable": savings >= net, "token": _token(e, "move", target["id"], net),
        "note": (f"This Sunday's rent is {_money(target['rent'] * 100)}, the new place's rent." if target["rent"] >= current["rent"] else
                 f"You lived in both places this week, so this Sunday's rent is still {_money(current['rent'] * 100)}. "
                 f"From next week it is {_money(target['rent'] * 100)}."),
    }
    if net > savings:
        raise EconomyError("insufficient_funds",
                           f"The deposit for {target['name']} needs {_money(net - savings)} more savings. It will be here when you are ready.",
                           quote=quote)
    if token is None:
        return {"ok": True, "confirm_needed": True, "quote": quote}
    if token != quote["token"]:
        raise EconomyError("stale", "Something changed since you looked, so nothing moved. Have another look.", quote=quote)
    with db.transaction(conn):
        e.reload()
        n = len(e.moves()) + 1
        monday = timeutil.week_monday(e.g.today).isoformat()
        if held:
            _put(e, e.now, "deposit_back", f"deposit_back:{n}", held, monday, {"home": current["id"]})
        _put(e, e.now, "deposit", f"deposit:{n}", -target["deposit"] * 100, monday, {"home": target["id"]})
        sent = _relayout(e, current, target)
        _put(e, e.now, "move", f"move:{n}", 0, monday,
             {"from": current["id"], "to": target["id"], "reason": "chosen", "stored": sent})
    savings_after = e.savings()
    return {"ok": True, "moved": True, "home": target["id"], "name": target["name"], "from": current["id"], "stored": len(sent),
            "balance": _d(savings_after), "balance_cents": savings_after,
            "toast": f"Moved to {target['name']}." + (f" {len(sent)} piece{'s' if len(sent) != 1 else ''} went to storage." if sent else "")}


def _fits(size: str, entry: dict, taken: list[dict]) -> bool:
    try:
        lay.check(lay.room(size), entry, taken)
        return True
    except lay.LayoutError:
        return False


def equip(conn: sqlite3.Connection, kind: str, item: str, on: bool = True, slot: int | None = None,
          today: date | None = None, now: datetime | None = None) -> dict:
    """Switch things on and off. outfit: wear it (on=false goes back to everyday clothes). upgrade: show it on the towers.
    furniture: put it in the room (on=true; `slot` optional: an old fixed slot's place, else the first good free spot) or take it to
    storage (on=false). Free placement itself is `save_layout`."""
    e = _E(conn, today, now)
    it = cat.ITEM_BY_ID.get(str(item))
    kind = str(kind)
    if it is None or it["kind"] != kind:
        raise EconomyError("unknown_item", "That item is not in the shop.")
    if str(item) not in e.owned_ids():
        raise EconomyError("not_owned", f"You do not have {it['name']} yet.")
    with db.transaction(conn):
        if kind == "outfit":
            e.set_choice("outfit", it["id"] if on else cat.DEFAULT_OUTFIT)
        elif kind == "upgrade":
            current = set(e.upgrades())
            current = current | {it["id"]} if on else current - {it["id"]}
            e.set_choice("upgrades", sorted(current))
        elif kind == "furniture":
            home = e.home_at()
            items = [x for x in e.layout_items(home) if x["id"] != it["id"]]
            if on:
                size, word = lay.room_for(home["id"], home["size"]), lay.SIZE_WORD.get(home["size"], "home")
                if slot is not None and (not isinstance(slot, int) or isinstance(slot, bool) or not 0 <= slot < home["slots"]):
                    raise EconomyError("bad_slot", f"This home has spots 0 to {home['slots'] - 1}.")
                if slot is not None:       # the old fixed-slot call: a piece already on that slot goes to storage
                    items = [x for x in items if lay.slot_of(size, x) != slot]
                if len(items) >= home["budget"]:
                    raise EconomyError("no_free_slot", f"Your {word} fits {home['budget']} things, and {len(items)} {'is' if len(items) == 1 else 'are'} out. "
                                       "Send something to storage first.")
                entry = lay.slot_entry(size, slot, it["id"]) if slot is not None else None
                if entry is None or not _fits(size, entry, items):
                    sl = lay.room(size)["slots"][slot] if slot is not None else None
                    entry = (lay.place_near(size, items, it["id"], near=(sl["x"], sl["z"]), ry_first=sl["ry"]) if sl
                             else lay.auto_place(size, items, it["id"]))
                if entry is None:
                    raise EconomyError("no_room", "There is no free spot for that in this room. Move something first.")
                items.append(entry)
            e.set_layout_items(home["id"], items)
        else:
            raise EconomyError("not_equippable", "That one lives in your Passport; there is nothing to switch on.")
    return {"ok": True, "kind": kind, "item": it["id"], "on": bool(on), "outfit": e.outfit(), "upgrades": e.upgrades(),
            "placed": _placed_view(e), "storage": [_item_stub(i) for i in e.storage()], "layout": _layout_view(e)}


# --------------------------------------------------------------------------
# The home layout: free placement (docs/COZY.md 4.2)
# --------------------------------------------------------------------------

def _layout_payload(e: _E, saved: bool | None = None) -> dict:
    home = e.home_at()
    view = _layout_view(e, home)
    owned = e.owned_furniture()
    out = {
        "ok": True, "quiet": bool(game.setting(e.conn, "quiet_mode")), "v": 1,
        "home": {"id": home["id"], "name": home["name"], "size": home["size"], "address": home["address"],
                 "budget": home["budget"], "used": view["used"], "free": view["free"]},
        "message": view["message"], "capacity_text": view["capacity_text"],
        "room": lay.describe(lay.room_for(home["id"], home["size"])), "items": view["items"], "storage": view["storage"],
        "catalog": {i: {k: cat.ITEM_BY_ID[i][k] for k in ("name", "category", "tier", "size", "anchor", "surface", "layer", "activity", "wall_y", "chest_only")}
                    | {"activity_line": cat.ACTIVITIES[cat.ITEM_BY_ID[i]["activity"]]["line"] if cat.ITEM_BY_ID[i]["activity"] else ""}
                    for i in owned},
    }
    if saved is not None:
        out["saved"] = saved
    return out


def layout_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> dict:
    """GET /api/home/layout: the current home's room (walls, windows, fixed furniture), what is placed and where, what waits in
    storage, the budget, and the size/anchor/activity of every piece the user owns."""
    e = _E(conn, today, now)
    return _layout_payload(e)


def save_layout(conn: sqlite3.Connection, items: Any, today: date | None = None, now: datetime | None = None) -> dict:
    """POST /api/home/layout {items: [...]}: replace the current home's layout. Everything is checked (owned, once each, within the
    budget, inside the room, on solid wall, not on top of anything) and nothing is saved unless all of it passes. Raises
    EconomyError with the layout code, a calm `hint` and the `index` of the entry that was refused."""
    e = _E(conn, today, now)
    home = e.home_at()
    try:
        clean = lay.validate(lay.room_for(home["id"], home["size"]), items, budget=home["budget"], owned=set(e.owned_furniture()),
                             home_word=lay.SIZE_WORD.get(home["size"]))
    except lay.LayoutError as exc:
        raise EconomyError(exc.code, exc.hint, **{k: v for k, v in exc.as_dict().items() if k not in ("code", "hint")}) from exc
    with db.transaction(conn):
        e.reload()
        e.set_layout_items(home["id"], clean)
    return _layout_payload(e, saved=True)


# --------------------------------------------------------------------------
# What the 3D world and the Telegram summary need
# --------------------------------------------------------------------------

def world_block(conn: sqlite3.Connection, ctx: "game._Ctx") -> dict:
    """The `economy` block of GET /api/world: the home, what is in it, the outfit, the tower upgrades, the gold days and whether a
    focus block is running."""
    e = _E(conn, ctx=ctx)
    _sync(e)
    home = e.home_at()
    focus = _focus(e)
    gold = gold_days(e)
    idx, title, per_hour = cat.title_for(e.nodes())
    return {
        "quiet": bool(game.setting(conn, "quiet_mode")),
        "home": {"id": home["id"], "bin": home["bin"], "name": home["name"], "address": home["address"], "size": home["size"],
                 "slots": home["slots"], "budget": home["budget"], "floor": home["floor"], "district": home["district"], "x": home["x"], "z": home["z"],
                 "base_y": home["base_y"], "height_m": home["height_m"]},
        "placed": _placed_view(e, home), "outfit": e.outfit(), "upgrades": e.upgrades(),
        "gold_days": gold, "three_star_days": len(gold), "title": title, "rate_per_hour": per_hour,
        "focus": focus, "character": character(e, focus),
        "layout": _layout_view(e, home), "spot": spot_stub(selected_spot(conn)),
    }


def week_line(conn: sqlite3.Connection, today: date | None = None) -> str | None:
    """One calm money/rent line for the Telegram weekly summary, or None in quiet mode."""
    if game.setting(conn, "quiet_mode"):
        return None
    e = _E(conn, today)
    _sync(e)
    frozen = _frozen(conn)
    live = _week_live(e, frozen)
    rent = _rent_block(e, frozen)
    savings = e.savings()
    if rent["free"]:
        tail = "rent-free week"
    elif rent["covered"]:
        tail = f"rent {_money(rent['amount'] * 100)} covered"
    else:
        tail = f"rent {_money(rent['amount'] * 100)} not covered yet, nothing is taken if it cannot be"
    return f"Money: earned {_money(live['earned']['total'] * 100)} this week, {tail}, savings {_money(savings)}."
