"""The cozy life sim's engine (docs/COZY.md 4.5 and 4.6): study spots, the three daily missions and the daily chest.

Built on `economy.py` (the same honest counters and the same append-only ledger). Nothing here draws anything.

Study spots   unlocked through the ordinary buy flow (`economy.buy(item = spot id)`, ledger kind `spot_unlock`), one is selected for the
              next focus run, the last one used is remembered (`econ_choice` key `spot`). `GET /api/spots`, `POST /api/spots/select`.
Missions      three a day (one easy, one medium, one stretch) picked once from data up to yesterday by a date-seeded RNG and frozen in
              `econ_missions`. Progress is recomputed on every read from the day summaries, entries, outputs and focus blocks; a mission
              seen done stays done (a ratchet in the same row), so deleting a log later never takes a chest away.
Chest         a day whose three missions are all done earns one chest. It never expires; up to 7 wait on the shelf (more wait behind them
              and appear as the shelf empties). Opening one is idempotent per day: a `chest:<date>` ledger row pays the money, a
              `chest_item:<id>` row records each find. Rewards come from an RNG seeded by the chest's date, so they never change.
"""
from __future__ import annotations

import hashlib
import json
import logging
import random
import sqlite3
import statistics
from datetime import date, datetime, timedelta
from typing import Any

from . import categories, db, economy, game, timeutil
from . import economy_catalog as cat
from .economy import EconomyError, _E, _d, _iso, _money

log = logging.getLogger("epoch.cozy")

FULL_FOCUS = "full"
BLOCK_STATUSES = ("unrated", "rating", "rated")      # a finished block that was not dropped or logged as plain time
DONE_LOOKBACK_DAYS = 7                                 # a day can still be completed (by a late log) for this long


# --------------------------------------------------------------------------
# Study spots
# --------------------------------------------------------------------------

def _spot_view(e: _E, sp: dict, selected: str, balance: int) -> dict:
    first = next((f for f, _l, n, _i in game.DISTRICTS if n == sp["district"]), None) if sp["district"] else None
    is_open = e.spot_open(sp)
    home = cat.HOME_BY_ID.get(sp["home"]) if sp.get("home") else None
    price_cents = sp["price"] * 100
    level_ok = e.district_unlocked(sp["district"])
    if is_open:
        state, why, gate = "open", None, None
    elif sp.get("home"):
        state = "locked"
        gate = f"Unlocks when you live in {home['name']}"
        why = f"{sp['gate_name']} opens once you live in {home['name']}."
    elif not level_ok:
        state = "locked"
        gate = f"Unlocks with {sp['district']}, Level {first}"
        why = f"{sp['gate_name']} opens with {sp['district']}, Level {first}."
    else:
        state, gate = "available", None
        why = None if balance >= price_cents else f"{_money(price_cents - balance)} more savings to go."
    affordable = balance >= price_cents
    return {
        "id": sp["id"], "name": sp["name"], "short": sp["short"], "pin": sp["pin"], "blurb": sp["blurb"], "outdoor": sp["outdoor"],
        "price": sp["price"], "district": sp["district"], "unlocks_at_level": first, "home": sp.get("home"),
        "home_name": home["name"] if home else None, "unlocked": is_open, "state": state, "affordable": affordable,
        "short_by": 0 if affordable else _d(price_cents - balance), "can_buy": state == "available" and affordable,
        "gate": gate, "why_not": why, "selected": sp["id"] == selected,
        "token": economy._token(e, "buy", sp["id"], price_cents) if state == "available" else None,
    }


def spots_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> dict:
    """GET /api/spots: every study spot with its unlock state, price and plain-words gate, and which one the next run will use."""
    e = _E(conn, today, now)
    economy._sync(e)
    selected = economy.selected_spot(conn)
    balance = e.savings()
    spots = [_spot_view(e, sp, selected, balance) for sp in cat.STUDY_SPOTS]
    nxt = next((s for s in spots if s["state"] == "available"), None) or next((s for s in spots if not s["unlocked"]), None)
    return {
        "ok": True, "quiet": bool(game.setting(conn, "quiet_mode")), "as_of": _iso(e.now), "selected": selected,
        "last_used": selected, "balance": _d(balance), "balance_cents": balance, "spots": spots,
        "next": None if nxt is None else {k: nxt[k] for k in ("id", "name", "price", "state", "gate", "why_not", "can_buy")},
        "message": f"{sum(1 for s in spots if s['unlocked'])} of {len(spots)} study spots open.",
    }


def _not_open_hint(view: dict) -> str:
    """Why a spot cannot be used yet, in a calm sentence: its gate, or what it costs and what is still missing."""
    if view["why_not"] and view["state"] == "locked":
        return view["why_not"]
    cost = f"{view['short']} is not open yet. It opens for {_money(view['price'] * 100)}."
    return cost + (f" {view['why_not']}" if view["why_not"] else "")


def select_spot(conn: sqlite3.Connection, spot_id: Any, today: date | None = None, now: datetime | None = None) -> dict:
    """POST /api/spots/select {spot}: choose where the next focus run happens (also remembered as the last one used)."""
    e = _E(conn, today, now)
    sp = cat.SPOT_BY_ID.get(str(spot_id or ""))
    if sp is None:
        raise EconomyError("unknown_spot", "That study spot is not on the list.")
    if not e.spot_open(sp):
        view = _spot_view(e, sp, economy.selected_spot(conn), e.savings())
        raise EconomyError("spot_locked", _not_open_hint(view), spot=sp["id"])
    e.set_choice("spot", sp["id"])
    return {"ok": True, "selected": sp["id"], "spot": economy.spot_stub(sp["id"]), "message": f"{sp['short']} it is."}


def use_spot(conn: sqlite3.Connection, requested: Any = None) -> str:
    """The spot for a new focus run: the one asked for (it must be open), else the remembered one. Remembers it as the last used."""
    if requested in (None, ""):
        return economy.selected_spot(conn)
    sp = cat.SPOT_BY_ID.get(str(requested))
    e = _E(conn)
    if sp is None:
        raise EconomyError("unknown_spot", "That study spot is not on the list.")
    if not e.spot_open(sp):
        view = _spot_view(e, sp, economy.selected_spot(conn), e.savings())
        raise EconomyError("spot_locked", _not_open_hint(view), spot=sp["id"])
    e.set_choice("spot", sp["id"])
    return sp["id"]


# --------------------------------------------------------------------------
# Missions: facts, progress, picking
# --------------------------------------------------------------------------

def _round_to(x: float, step: int = cat.DEEP_ROUND) -> int:
    return int(x / step + 0.5) * step


def adaptive_amounts(median_deep: float | None) -> tuple[int, int]:
    """(medium, stretch) minutes of deep focus: 0.8x and 1.2x the median of the last 14 active days, rounded to 15 and clamped;
    60 and 120 before there is any history."""
    if median_deep is None:
        return cat.DEEP_DEFAULTS
    f1, lo1, hi1 = cat.DEEP_MEDIUM
    f2, lo2, hi2 = cat.DEEP_STRETCH
    return (max(lo1, min(hi1, _round_to(f1 * median_deep))), max(lo2, min(hi2, _round_to(f2 * median_deep))))


def duration_words(minutes: int) -> str:
    m = int(minutes)
    if m < 60:
        return f"{m} minutes"
    h, rest = divmod(m, 60)
    base = f"{h} hour" + ("" if h == 1 else "s")
    return base if not rest else f"{base} {rest} minutes"


def _blocks(e: _E) -> list[dict]:
    """Every kept focus block, oldest first: when, how long, the focus rating and the study spot of its run."""
    cached = getattr(e, "_cz_blocks", None)
    if cached is not None:
        return cached
    try:
        rows = e.conn.execute(
            "SELECT b.id, b.started_utc, b.ended_utc, b.worked_s, b.status, b.focus, r.spot FROM pomodoro_blocks b "
            "JOIN pomodoro_runs r ON r.id = b.run_id WHERE b.status IN ('unrated', 'rating', 'rated') ORDER BY b.started_utc, b.id").fetchall()
    except sqlite3.Error:
        rows = []
    out = []
    for r in rows:
        start = timeutil.from_iso(r["started_utc"])
        out.append({"id": r["id"], "start": start, "worked_s": int(r["worked_s"]), "focus": r["focus"],
                    "spot": r["spot"] if r["spot"] in cat.SPOT_BY_ID else cat.DEFAULT_SPOT,
                    "day": timeutil.local_date_of(start, e.g.tz, e.g.dsh)})
    e._cz_blocks = out
    return out


def _day_blocks(e: _E, d: date) -> list[dict]:
    return [b for b in _blocks(e) if b["day"] == d]


def _last_spot_before(e: _E, d: date) -> str:
    prev = [b for b in _blocks(e) if b["day"] < d]
    return prev[-1]["spot"] if prev else cat.DEFAULT_SPOT


def _local_hour(e: _E, dt: datetime) -> float:
    local = dt.astimezone(timeutil.zone(e.g.tz))
    return local.hour + local.minute / 60


def progress(e: _E, mission: dict, d: date) -> dict:
    """Live progress of one mission on day `d`, from the honest counters: {value, target, unit, done}."""
    g, mid, params = e.g, mission["id"], mission.get("params") or {}
    s = g.summary(d)
    blocks = _day_blocks(e, d)
    real = [b for b in blocks if b["worked_s"] >= cat.BLOCK_MIN_SECONDS]
    if mid == "early_bird":
        starts = [x.start for x in g.entries_by_day.get(d, []) if x.category not in ("Sleep", "Unknown") and not x.is_job_block]
        v = 1 if starts and _local_hour(e, min(starts)) < cat.EARLY_BIRD_HOUR else 0
        return {"value": v, "target": 1, "unit": "bool", "done": bool(v)}
    if mid == "one_block":
        return _count(len(real), 1, "blocks")
    if mid == "two_blocks":
        return _count(len(real), 2, "blocks")
    if mid == "full_focus":
        return _count(sum(1 for b in blocks if b["focus"] == FULL_FOCUS), 1, "blocks")
    if mid == "doors_by_noon":
        t = game._first_floor_time(g, d) if s.floor_met else None
        v = 1 if t is not None and _local_hour(e, t) < cat.DOORS_HOUR and timeutil.local_date_of(t, g.tz, g.dsh) == d else 0
        return {"value": v, "target": 1, "unit": "bool", "done": bool(v)}
    if mid in ("deep_n", "deep_stretch"):
        n = int(params.get("n") or 0)
        return {"value": min(s.deep_minutes, n), "target": n, "unit": "min", "done": n > 0 and s.deep_minutes >= n}
    if mid == "two_subjects":
        got = sum(1 for c, m in s.deep_by_category.items() if categories.is_ladder(c) and m >= cat.SUBJECT_MIN_MINUTES)
        return _count(got, 2, "subjects")
    if mid == "new_spot":
        ref = params.get("ref_spot") or cat.DEFAULT_SPOT
        return {"value": 1 if any(b["spot"] != ref for b in real) else 0, "target": 1, "unit": "bool",
                "done": any(b["spot"] != ref for b in real)}
    if mid == "math_hour":
        c = params.get("category") or "Math"
        m = s.deep_by_category.get(c, 0)
        return {"value": min(m, cat.MATH_HOUR_MINUTES), "target": cat.MATH_HOUR_MINUTES, "unit": "min", "done": m >= cat.MATH_HOUR_MINUTES}
    if mid == "crown":
        return {"value": 1 if s.target_met else 0, "target": 1, "unit": "bool", "done": bool(s.target_met)}
    if mid == "long_block":
        best = max((b["worked_s"] for b in blocks), default=0) // 60
        need = cat.LONG_BLOCK_SECONDS // 60
        return {"value": min(best, need), "target": need, "unit": "min", "done": best >= need}
    if mid == "ship_it":
        n = len(g.outputs_by_day.get(d, []))
        return _count(n, 1, "outputs")
    return {"value": 0, "target": 1, "unit": "bool", "done": False}


def _count(value: int, target: int, unit: str) -> dict:
    return {"value": min(value, target), "target": target, "unit": unit, "done": value >= target}


def progress_text(p: dict) -> str:
    if p["unit"] == "bool":
        return "Done" if p["done"] else "Not yet"
    word = {"min": "min", "blocks": "block" if p["target"] == 1 else "blocks", "subjects": "subjects",
            "outputs": "output" if p["target"] == 1 else "outputs"}[p["unit"]]
    return f"{p['value']} of {p['target']} {word}"


def mission_text(m: dict) -> tuple[str, str]:
    """(text, 'done' phrase) of a mission with its numbers filled in."""
    base = cat.MISSION_BY_ID[m["id"]]
    params = m.get("params") or {}
    fill = {"n": duration_words(params.get("n", 0)), "category": params.get("category", "")}
    return base["text"].format(**fill), base["done_text"].format(**fill)


def _history(e: _E, day: date) -> dict:
    """Everything the pick may look at: data up to yesterday, plus the schedule and the unlocked spots."""
    g = e.g
    active = [g.summary(x).deep_minutes for x in g.days() if x < day and g.summary(x).deep_minutes > 0]
    median = statistics.median(active[-cat.HISTORY_ACTIVE_DAYS:]) if active else None
    totals = {c: 0 for c in categories.LADDER}
    for k in range(1, 8):
        x = day - timedelta(days=k)
        if x >= g.start:
            for c, m in g.summary(x).deep_by_category.items():
                if c in totals:
                    totals[c] += m
    prev = e.conn.execute("SELECT missions FROM econ_missions WHERE local_date = ?", ((day - timedelta(days=1)).isoformat(),)).fetchone()
    monday = timeutil.week_monday(day)
    ship_days = 0
    for r in e.conn.execute("SELECT missions FROM econ_missions WHERE local_date >= ? AND local_date < ?", (monday.isoformat(), day.isoformat())):
        if any(m["id"] == "ship_it" for m in json.loads(r["missions"])):
            ship_days += 1
    s = g.summary(day)
    weekend = day.weekday() >= 5
    morning = timeutil.parse_hhmm(str(g.s.get("morning_time_weekend" if weekend else "morning_time_weekday") or "07:30"))
    start_h = morning.hour + morning.minute / 60
    job_start = timeutil.parse_hhmm(str(g.s.get("job_start") or "10:00"))
    first_block_h = (job_start.hour + job_start.minute / 60) if s.is_job_day else 12.0
    return {
        "median_deep": median, "categories_7d": totals, "spots_open": len(e.open_spots()),
        "yesterday_ids": {m["id"] for m in json.loads(prev["missions"])} if prev else None,
        "ship_it_days_this_week": ship_days, "mark": s.mark, "last_spot": _last_spot_before(e, day),
        "early_ok": start_h < cat.EARLY_BIRD_HOUR - 0.5,
        "noon_ok": min(12.0, first_block_h) - start_h >= 0.75,
    }


def _seed(day: date, salt: str) -> int:
    return int(hashlib.sha256(f"epoch-{salt}:{day.isoformat()}".encode()).hexdigest()[:16], 16)


def feasible(mission_id: str, h: dict) -> bool:
    """Can this mission be done today for this person? Never offer an impossible one (see COZY.md 4.6)."""
    if mission_id == "early_bird":
        return bool(h["early_ok"]) and not h.get("late_early")
    if mission_id == "doors_by_noon":
        return bool(h["noon_ok"]) and not h.get("late_doors")
    if mission_id == "new_spot":
        return h["spots_open"] >= 2
    if mission_id == "ship_it":
        return h["ship_it_days_this_week"] < cat.SHIP_IT_PER_WEEK
    if mission_id == "crown":
        return h["mark"] not in ("rest", "skip")
    return True


def pick_missions(day: date, h: dict) -> list[dict]:
    """The day's three missions [{id, tier, params}], easy then medium then stretch. Deterministic: the same date and the same history
    always give the same three. One of each tier, never the exact set of yesterday, never two that overlap, never an impossible one."""
    medium_n, stretch_n = adaptive_amounts(h["median_deep"])
    rng = random.Random(_seed(day, "missions"))
    pools: dict[str, list[str]] = {}
    for tier in cat.MISSION_TIERS:
        ids = [m["id"] for m in cat.MISSIONS if m["tier"] == tier and feasible(m["id"], h)]
        rng.shuffle(ids)
        pools[tier] = ids
    yesterday = h.get("yesterday_ids")

    def conflicts(ids: set[str]) -> bool:
        return any(c <= ids for c in cat.MISSION_CONFLICTS)

    chosen: list[str] | None = None
    fallback: list[str] | None = None
    for _ in range(300):
        pick = [rng.choice(pools[t]) for t in cat.MISSION_TIERS]
        if conflicts(set(pick)):
            continue
        if fallback is None:
            fallback = pick
        if set(pick) != yesterday:
            chosen = pick
            break
    chosen = chosen or fallback or [pools[t][0] for t in cat.MISSION_TIERS]
    out = []
    for mid in chosen:
        m = cat.MISSION_BY_ID[mid]
        params: dict[str, Any] = {}
        if mid == "deep_n":
            params["n"] = medium_n
        elif mid == "deep_stretch":
            params["n"] = stretch_n
        elif mid == "math_hour":
            totals = h["categories_7d"]
            params["category"] = min(categories.LADDER, key=lambda c: (totals.get(c, 0), categories.LADDER.index(c)))
        elif mid == "new_spot":
            params["ref_spot"] = h["last_spot"]
        out.append({"id": mid, "tier": m["tier"], "params": params})
    return out


# --------------------------------------------------------------------------
# Missions: the stored day, the done ratchet, the chest shelf
# --------------------------------------------------------------------------

def enabled(conn: sqlite3.Connection) -> bool:
    value = db.get_setting(conn, "daily_missions")
    return True if value is None else bool(value)


def _row(e: _E, d: date) -> dict | None:
    r = e.conn.execute("SELECT local_date, missions, done, created_utc FROM econ_missions WHERE local_date = ?", (d.isoformat(),)).fetchone()
    if r is None:
        return None
    return {"date": r["local_date"], "missions": json.loads(r["missions"]), "done": json.loads(r["done"] or "{}"), "created": r["created_utc"]}


def _ensure_day(e: _E, d: date) -> dict | None:
    """Today's stored missions, picked on first use. Missions off, or a day before the tracker started: nothing."""
    row = _row(e, d)
    if row is not None or not enabled(e.conn) or d < e.g.start:
        return row
    h = _history(e, d)
    if d == e.g.today:          # opened late: skip the two time-boxed missions that can no longer be done
        hour = _local_hour(e, e.now)
        if hour >= cat.EARLY_BIRD_HOUR and not progress(e, {"id": "early_bird"}, d)["done"]:
            h["late_early"] = True
        if hour >= cat.DOORS_HOUR - 0.75 and not progress(e, {"id": "doors_by_noon"}, d)["done"]:
            h["late_doors"] = True
    picked = pick_missions(d, h)
    with game._atomic(e.conn):
        e.conn.execute("INSERT OR IGNORE INTO econ_missions(local_date, missions, done, created_utc) VALUES (?, ?, '{}', ?)",
                       (d.isoformat(), json.dumps(picked), db.utc_now_iso()))
    return _row(e, d)


def sync(e: _E) -> list[tuple[str, str]]:
    """Make sure today's missions exist and record every mission seen done (today and the last few days). Returns the new
    (date, mission id) pairs. Cheap and idempotent."""
    out: list[tuple[str, str]] = []
    today = e.g.today
    _ensure_day(e, today)
    for k in range(DONE_LOOKBACK_DAYS + 1):
        d = today - timedelta(days=k)
        row = _row(e, d)
        if row is None or len(row["done"]) >= len(row["missions"]):
            continue
        fresh = {m["id"]: _iso(e.now) for m in row["missions"] if m["id"] not in row["done"] and progress(e, m, d)["done"]}
        if fresh:
            merged = {**row["done"], **fresh}
            with game._atomic(e.conn):
                e.conn.execute("UPDATE econ_missions SET done = ? WHERE local_date = ?", (json.dumps(merged), d.isoformat()))
            out += [(d.isoformat(), mid) for mid in fresh]
    return out


def chest_days(e: _E) -> list[str]:
    """Every day whose three missions were all seen done, oldest first (one chest each)."""
    days = []
    for r in e.conn.execute("SELECT local_date, missions, done FROM econ_missions ORDER BY local_date"):
        ids = [m["id"] for m in json.loads(r["missions"])]
        done = json.loads(r["done"] or "{}")
        if ids and all(i in done for i in ids):
            days.append(r["local_date"])
    return days


def _opened(e: _E) -> dict[str, dict]:
    return {r["ref"][len("chest:"):]: r for r in e.ledger if r["kind"] == "chest"}


def _run_ending(days: list[str], day: str) -> int:
    have = set(days)
    n, d = 0, date.fromisoformat(day)
    while d.isoformat() in have:
        n += 1
        d -= timedelta(days=1)
    return n


def chest_plan(days: list[str]) -> dict[str, dict]:
    """The deterministic roll of every chest day, in order: {date: {base, streak, rare, postcard, misses, money, rare_item,
    postcard_item}}. The pity counter runs through the whole list (a chest with a rare item resets it), and prizes are handed out in
    date order from each day's own seeded shuffle (an item already given to an earlier chest is skipped), so the same days always give
    the same plan, whatever order the chests are opened in."""
    plan: dict[str, dict] = {}
    misses = 0
    given: set[str] = set()
    for day in days:
        rng = random.Random(_seed(date.fromisoformat(day), "chest"))
        base = rng.randrange(cat.CHEST_MONEY_MIN, cat.CHEST_MONEY_MAX + 1, cat.CHEST_MONEY_STEP)
        rare_roll, post_roll = rng.random(), rng.random()
        guaranteed = misses >= cat.CHEST_PITY_AFTER
        rare = guaranteed or rare_roll < cat.CHEST_RARE_CHANCE
        streak = _run_ending(days, day)
        postcard = post_roll < cat.CHEST_POSTCARD_CHANCE
        rare_item = _find(day, cat.CHEST_RARE, given, "rare") if rare else None
        if rare_item:
            given.add(rare_item["id"])
        card = _find(day, cat.CHEST_POSTCARDS, given, "postcard") if postcard else None
        if card:
            given.add(card["id"])
        plan[day] = {"base": base, "streak": streak, "rare": rare, "postcard": postcard,
                     "misses": misses, "guaranteed": guaranteed and rare_roll >= cat.CHEST_RARE_CHANCE,
                     "money": min(cat.CHEST_MONEY_CAP, base + cat.CHEST_STREAK_BONUS * streak),
                     "rare_item": rare_item["id"] if rare_item else None, "postcard_item": card["id"] if card else None}
        misses = 0 if rare else misses + 1
    return plan


def _find(day: str, pool: list[dict], owned: set[str], salt: str) -> dict | None:
    """The first item of a seeded shuffle of the pool that the user does not own yet."""
    rng = random.Random(_seed(date.fromisoformat(day), salt))
    order = list(pool)
    rng.shuffle(order)
    return next((it for it in order if it["id"] not in owned), None)


PHRASE = {
    "subway_map_print": "a vintage subway map print", "brass_desk_clock": "a brass desk clock", "typewriter": "a typewriter",
    "record_crate": "a crate of records", "velvet_armchair": "a Columbia-blue velvet armchair", "flatiron_globe": "a Flatiron snow globe",
    "yellow_raincoat": "a yellow raincoat and boots", "varsity_jacket": "a varsity-style jacket",
    "postcard_high_line_sunrise": "a postcard of sunrise on the High Line", "postcard_met_midnight": "a postcard of midnight on the Met steps",
    "postcard_bridge_fog": "a postcard of fog over the Brooklyn Bridge",
}


def reward_message(dollars: int, item_ids: list[str]) -> str:
    bits = [_money(dollars * 100)] + [PHRASE.get(i, cat.ITEM_BY_ID[i]["name"]) for i in item_ids]
    if len(bits) == 1:
        return bits[0] + "."
    return ", ".join(bits[:-1]) + " and " + bits[-1] + "."


def _item_reward(it: dict, rare: bool) -> dict:
    return {"item": it["id"], "name": it["name"], "kind": it["kind"], "category": it["category"], "rare": rare,
            "phrase": PHRASE.get(it["id"], it["name"])}


def _reward_from_ledger(e: _E, day: str, row: dict) -> dict:
    items = [_item_reward(cat.ITEM_BY_ID[r["meta"]["item"]], bool(r["meta"].get("rare"))) for r in e.grants()
             if r["meta"].get("date") == day and r["meta"].get("item") in cat.ITEM_BY_ID]
    dollars = row["cents"] // 100
    return {"date": day, "money": dollars, "money_cents": row["cents"], "bonus": row["meta"].get("bonus", 0),
            "streak": row["meta"].get("streak", 0), "fallback": bool(row["meta"].get("fallback")), "items": items,
            "message": reward_message(dollars, [i["item"] for i in items]), "opened_at": row["at_iso"]}


def chest_state(e: _E) -> dict:
    days = chest_days(e)
    opened = _opened(e)
    waiting_all = [d for d in days if d not in opened]
    ready = waiting_all[:cat.CHEST_MAX]
    last = None
    if opened:
        day = max(opened)
        last = _reward_from_ledger(e, day, opened[day])
    have = set(days)
    d = date.fromisoformat(max(days)) if days else None
    run = 0
    if d is not None and d >= e.g.today - timedelta(days=1):
        while d.isoformat() in have:
            run += 1
            d -= timedelta(days=1)
    best, cur, prev = 0, 0, None
    for x in days:
        dd = date.fromisoformat(x)
        cur = cur + 1 if prev is not None and (dd - prev).days == 1 else 1
        best, prev = max(best, cur), dd
    return {
        "ready": len(ready), "waiting": len(waiting_all) - len(ready), "max": cat.CHEST_MAX,
        "label": f"x{len(ready)}" if len(ready) > 1 else "", "next_date": ready[0] if ready else None, "dates": ready,
        "earned_today": e.g.today.isoformat() in have, "opened_total": len(opened), "last_opened": last,
        "streak": run, "best_streak": best,
    }


def open_chest(conn: sqlite3.Connection, day: Any = None, today: date | None = None, now: datetime | None = None) -> dict:
    """POST /api/chest/open {date?}: open one chest. Without a date, the oldest waiting chest; with one, exactly that day's. Opening the
    same chest again changes nothing and returns the same reward with `already_opened: true`. Raises EconomyError when there is none."""
    e = _E(conn, today, now)
    economy._sync(e)
    days = chest_days(e)
    opened = _opened(e)
    want = None
    if day not in (None, ""):
        try:
            want = date.fromisoformat(str(day)).isoformat()
        except ValueError:
            raise EconomyError("bad_date", "That is not a date I know.")
        if want in opened:
            return {"ok": True, "quiet": bool(game.setting(conn, "quiet_mode")), "opened": False, "already_opened": True,
                    **_reward_from_ledger(e, want, opened[want]),
                    "chest": chest_state(e), "balance": _d(e.savings()), "balance_cents": e.savings()}
        if want not in days:
            raise EconomyError("no_chest", "That chest is not ready.")
    waiting = [d for d in days if d not in opened]
    if not waiting:
        raise EconomyError("no_chest", "No chest is waiting. Three missions fill one.")
    shelf = waiting[:cat.CHEST_MAX]
    target = want or shelf[0]
    if target not in shelf:
        raise EconomyError("shelf_full", "Open the chests on the shelf first.")
    plan = chest_plan(days)[target]
    owned = e.owned_ids()
    prizes: list[tuple[dict, bool]] = []
    fallback = False
    if plan["rare"]:
        it = cat.ITEM_BY_ID.get(plan["rare_item"] or "")
        if it is not None and it["id"] in owned:      # only if a date was added before an opened one: give the next unowned prize
            it = _find(target, cat.CHEST_RARE, owned, "rare")
        if it is None:
            fallback = True
        else:
            prizes.append((it, True))
    if plan["postcard"]:
        it = cat.ITEM_BY_ID.get(plan["postcard_item"] or "")
        if it is not None and it["id"] in owned:
            it = _find(target, cat.CHEST_POSTCARDS, owned, "postcard")
        if it is not None:
            prizes.append((it, False))
    dollars = plan["money"] + (cat.CHEST_FALLBACK_DOLLARS if fallback else 0)
    week = timeutil.week_monday(date.fromisoformat(target)).isoformat()
    with db.transaction(conn):
        cur = conn.execute(
            "INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES (?, 'chest', ?, ?, ?, ?)",
            (_iso(e.now), f"chest:{target}", dollars * 100, week,
             json.dumps({"date": target, "base": plan["base"], "streak": plan["streak"], "bonus": plan["money"] - plan["base"],
                         "rare": plan["rare"], "guaranteed": plan["guaranteed"], "fallback": fallback})))
        if cur.rowcount:
            for it, rare in prizes:
                conn.execute(
                    "INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES (?, 'chest_item', ?, 0, ?, ?)",
                    (_iso(e.now), f"chest_item:{it['id']}", week,
                     json.dumps({"item": it["id"], "name": it["name"], "kind": it["kind"], "date": target, "rare": rare})))
        e.reload()
    row = _opened(e)[target]
    result = _reward_from_ledger(e, target, row)
    return {"ok": True, "quiet": bool(game.setting(conn, "quiet_mode")), "opened": bool(cur.rowcount), "already_opened": not cur.rowcount, **result,
            "pity": {"misses_before": plan["misses"], "guaranteed": plan["guaranteed"]},
            "toast": result["message"], "chest": chest_state(e), "balance": _d(e.savings()), "balance_cents": e.savings()}


# --------------------------------------------------------------------------
# The views
# --------------------------------------------------------------------------

def _mission_view(e: _E, m: dict, d: date, done_at: str | None) -> dict:
    p = progress(e, m, d)
    text, done_text = mission_text(m)
    done = p["done"] or done_at is not None            # seen done stays done
    return {
        "id": m["id"], "tier": m["tier"], "text": text, "done_text": done_text, "done": done, "done_at": done_at,
        "value": p["target"] if done else p["value"], "target": p["target"], "unit": p["unit"],
        "fraction": 1.0 if done else round(min(1.0, p["value"] / p["target"]) if p["target"] else 0.0, 3),
        "progress_text": "Done" if done and p["unit"] == "bool" else progress_text({**p, "value": p["target"] if done else p["value"], "done": done}),
        "params": m.get("params") or {},
    }


_WORDS = {1: "One", 2: "Two", 3: "Three"}


def _missions_message(done: int, total: int, ready: int) -> str:
    if total == 0:
        return ""
    if done >= total:
        return "All three done. Your chest is ready." if ready else "All three done."
    return f"Missions: {done} of {total}. {_WORDS.get(total - done, total - done)} to go for the chest."


def _done_toast(done_text: str, done: int, total: int) -> str:
    """The fact toast when a mission is seen done: "Mission done: two focus blocks. One to go for the chest."."""
    if done >= total:
        return f"Mission done: {done_text}. Your chest is ready."
    return f"Mission done: {done_text}. {_WORDS.get(total - done, total - done)} to go for the chest."


def missions_state(conn: sqlite3.Connection, today: date | None = None, now: datetime | None = None) -> dict:
    """GET /api/missions: today's three missions with live progress, the chest shelf and the streak."""
    e = _E(conn, today, now)
    economy._sync(e)
    return _missions_payload(e)


def _missions_payload(e: _E) -> dict:
    on = enabled(e.conn)
    row = _row(e, e.g.today) if on else None
    views = []
    if row is not None:
        views = [_mission_view(e, m, e.g.today, row["done"].get(m["id"])) for m in row["missions"]]
    chest = chest_state(e)
    done = sum(1 for v in views if v["done"])
    for v in views:      # the toast to show when this mission is (or was just) done: counts it among the finished ones
        v["toast"] = _done_toast(v["done_text"], done if v["done"] else done + 1, len(views))
    return {
        "ok": True, "enabled": on, "quiet": bool(game.setting(e.conn, "quiet_mode")), "as_of": _iso(e.now), "date": e.g.today.isoformat(),
        "missions": views, "done_count": done, "total": len(views), "all_done": bool(views) and done == len(views),
        "chest": chest, "message": _missions_message(done, len(views), chest["ready"]),
        "streak": {"chest_days": chest["streak"], "best": chest["best_streak"], "today_counts": chest["earned_today"]},
        "rules": {"chest_max": cat.CHEST_MAX, "money_min": cat.CHEST_MONEY_MIN, "money_max": cat.CHEST_MONEY_MAX,
                  "streak_bonus": cat.CHEST_STREAK_BONUS, "money_cap": cat.CHEST_MONEY_CAP},
    }


def economy_block(e: _E, quiet: bool) -> dict:
    """The `missions`, `chest` and `spot` keys of GET /api/economy."""
    full = _missions_payload(e)
    spot_id = economy.selected_spot(e.conn)
    open_ids = e.open_spots()
    nxt = next((sp for sp in cat.STUDY_SPOTS if sp["id"] not in open_ids), None)
    return {
        "missions": {"enabled": full["enabled"], "date": full["date"], "done": full["done_count"], "total": full["total"],
                     "all_done": full["all_done"], "message": full["message"],
                     "items": [{k: v[k] for k in ("id", "tier", "text", "done", "fraction", "progress_text")} for v in full["missions"]]},
        "chest": {k: full["chest"][k] for k in ("ready", "waiting", "max", "label", "next_date", "earned_today", "streak", "best_streak")},
        "spot": {**economy.spot_stub(spot_id), "unlocked": open_ids,
                 "next": None if nxt is None else {"id": nxt["id"], "name": nxt["name"], "price": nxt["price"], "district": nxt["district"]}},
    }
