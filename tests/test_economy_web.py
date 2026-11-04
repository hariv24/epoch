"""The money API (GET /api/economy, /api/shop, POST /api/shop/buy, /api/home/move, /api/equip), the /api/world additions, the guard
rules, the Settings choice for the third star, and the additive migration on a scratch copy of a real database.

The frozen clock is Wed 2026-10-14 20:30 IST (conftest.V2_NOW); the tracker started Mon 2026-10-05.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from epoch import db, economy, game
from epoch import economy_catalog as cat


def fund(db_path, dollars):
    with db.get_conn(db_path) as conn:
        conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES ('2026-10-06', 'output', ?, '2026-10-06T00:00:00Z') "
                     "ON CONFLICT(local_date, source) DO UPDATE SET cents = cents + excluded.cents", (dollars * 100,))


def level_up(db_path):
    with db.get_conn(db_path) as conn:
        conn.execute("INSERT OR REPLACE INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', '2026-10-05T00:00:00Z', '{\"xp\": 100000}')")


# --------------------------------------------------------------------------
# The shapes
# --------------------------------------------------------------------------

def test_api_economy_has_the_agreed_shape(owner):
    body = owner.get("/api/economy").json()
    assert body["ok"] is True
    for key in ("quiet", "as_of", "today", "balance", "balance_cents", "net_worth", "earned_total", "rate", "week", "rent", "level",
                "home", "homes", "storage", "owned", "equipped", "passport", "events", "stars", "gold_days", "recap", "focus",
                "character", "constants"):
        assert key in body, key
    assert body["rate"]["title"] == "Barista" and body["rate"]["per_hour"] == 25
    assert body["home"]["bin"] == 1059500 and body["home"]["slots"] == 4 and body["home"]["placed"] == []
    assert len(body["homes"]) == 15 and body["homes"][0]["current"] is True and body["homes"][-1]["bin"] == game.DREAM_HOME_BIN
    assert body["homes"][1]["unlocked"] is False and "Level 3" in body["homes"][1]["why_not"]
    assert set(body["owned"]) == {"furniture", "outfit", "upgrade", "experience", "postcard", "spot"}
    assert body["constants"]["deep_hours_uncapped"] is True and body["constants"]["size_slots"]["penthouse"] == 12
    assert body["rent"]["status"] in ("covered", "short", "free")


def test_api_shop_lists_four_aisles_with_prices_tokens_and_reasons(owner):
    body = owner.get("/api/shop").json()
    assert [a["id"] for a in body["aisles"]] == ["furniture", "outfit", "experience", "upgrade"]
    desk = next(i for a in body["aisles"] for i in a["items"] if i["id"] == "desk_setup")
    assert desk["price"] == 150 and desk["state"] == "available" and desk["can_buy"] is False and desk["short_by"] == 150
    assert len(desk["token"]) == 12 and desk["why_not"]
    broadway = next(i for a in body["aisles"] for i in a["items"] if i["id"] == "broadway_show")
    assert broadway["state"] == "locked" and broadway["district"] == "Midtown & Times Square"
    assert {e["id"] for e in body["events"]} >= {"ball_drop", "hot_chocolate_snow", "smorgasburg", "shakespeare_park"}


def test_buying_over_the_api_is_two_steps_and_changes_the_balance(owner, v2_state):
    fund(v2_state.db_path, 300)
    before = owner.get("/api/economy").json()["balance"]
    step1 = owner.post("/api/shop/buy", json={"item": "bookshelf"}).json()
    assert step1["ok"] and step1["confirm_needed"] and step1["quote"]["price"] == 200
    bad = owner.post("/api/shop/buy", json={"item": "bookshelf", "price": 200, "token": "wrong"}).json()
    assert bad["ok"] is False and bad["code"] == "stale" and bad["hint"]
    done = owner.post("/api/shop/buy", json={"item": "bookshelf", "price": 200, "token": step1["quote"]["token"]}).json()
    assert done["ok"] and done["bought"] and done["balance"] == before - 200 and done["placed"] == {"slot": 0}
    state = owner.get("/api/economy").json()
    assert state["owned"]["furniture"] == ["bookshelf"] and state["home"]["placed"][0]["item"] == "bookshelf"


def test_the_api_refuses_with_a_hint_not_an_error_page(owner):
    r = owner.post("/api/shop/buy", json={"item": "grand_piano"})
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["code"] == "insufficient_funds"
    assert owner.post("/api/shop/buy", json={"item": "no_such_thing"}).json()["code"] == "unknown_item"
    assert owner.post("/api/shop/buy", json={}).json()["code"] == "unknown_item"
    assert owner.post("/api/home/move", json={"home": "brow-penthouse"}).json()["code"] == "locked"
    assert owner.post("/api/equip", json={"kind": "outfit", "item": "navy_suit"}).json()["code"] == "not_owned"
    assert owner.post("/api/shop/buy", content="not json").json()["code"] == "unknown_item"


def test_moving_and_equipping_over_the_api(owner, v2_state):
    fund(v2_state.db_path, 1500)
    level_up(v2_state.db_path)
    quote = owner.post("/api/home/move", json={"home": "harlem-floorthrough"}).json()
    assert quote["confirm_needed"] and quote["quote"]["deposit"] == 400 and quote["quote"]["rent"] == 200
    moved = owner.post("/api/home/move", json={"home": "harlem-floorthrough", "token": quote["quote"]["token"]}).json()
    assert moved["ok"] and moved["moved"] and moved["name"] == "Brownstone floor-through"
    for item in ("desk_setup", "nyu_hoodie", "string_lights"):
        q = owner.post("/api/shop/buy", json={"item": item}).json()["quote"]
        assert owner.post("/api/shop/buy", json={"item": item, "price": q["price"], "token": q["token"]}).json()["bought"]
    eq = owner.post("/api/equip", json={"kind": "outfit", "item": "nyu_hoodie", "on": False}).json()
    assert eq["ok"] and eq["outfit"] == "everyday"
    eq = owner.post("/api/equip", json={"kind": "furniture", "item": "desk_setup", "on": True, "slot": 4}).json()
    assert eq["placed"] == [{"slot": 4, "item": "desk_setup", "name": "Desk setup", "category": "desk", "tier": "basic"}]
    eq = owner.post("/api/equip", json={"kind": "upgrade", "item": "string_lights", "on": "false"}).json()
    assert eq["upgrades"] == []
    state = owner.get("/api/economy").json()
    assert state["home"]["id"] == "harlem-floorthrough" and state["home"]["slots"] == 6 and state["deposit_held"] == 400


def test_api_world_carries_the_home_the_outfit_the_upgrades_and_the_gold_days(owner, v2_state):
    fund(v2_state.db_path, 500)
    for item in ("columbia_hoodie", "rooftop_garden"):
        q = owner.post("/api/shop/buy", json={"item": item}).json()
        if not q.get("ok"):                                   # the garden costs more than the funds: that is fine
            continue
        owner.post("/api/shop/buy", json={"item": item, "price": q["quote"]["price"], "token": q["quote"]["token"]})
    world = owner.get("/api/world").json()
    eco = world["economy"]
    assert eco["home"]["bin"] == 1059500 and eco["home"]["size"] == "studio"
    assert eco["outfit"] == "columbia_hoodie" and "gold_days" in eco and eco["focus"] == {"running": False}
    assert all("gold" in d for d in world["days"])
    assert set(eco["home"]) >= {"id", "bin", "name", "address", "size", "slots", "floor", "district", "x", "z", "base_y", "height_m"}


def test_quiet_mode_is_reported_so_the_ui_can_hide_money(owner, v2_state):
    assert owner.get("/api/economy").json()["quiet"] is False
    owner.post("/api/settings/game", json={"quiet_mode": True})
    assert owner.get("/api/economy").json()["quiet"] is True
    assert owner.get("/api/shop").json()["quiet"] is True
    assert owner.get("/api/world").json()["economy"]["quiet"] is True


# --------------------------------------------------------------------------
# The guards the other POST routes have
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path,body", [
    ("/api/shop/buy", {"item": "desk_setup"}), ("/api/home/move", {"home": "harlem-floorthrough"}),
    ("/api/equip", {"kind": "outfit", "item": "columbia_hoodie"}),
])
def test_a_cross_site_post_is_refused(owner, path, body):
    r = owner.post(path, json=body, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.json()["code"] == "cross_site"


def test_a_paired_tablet_can_shop_but_a_stranger_cannot(v2_app, v2_state, from_addr):
    stranger = from_addr("192.168.1.50")
    r = stranger.get("/api/economy")
    assert r.status_code in (400, 401, 403)
    assert stranger.post("/api/shop/buy", json={"item": "desk_setup"}).status_code in (400, 401, 403)


# --------------------------------------------------------------------------
# The Settings choice for the third star
# --------------------------------------------------------------------------

def test_the_third_star_goal_is_a_settings_choice_of_3_to_6_hours(owner, v2_state):
    page = owner.get("/settings").text
    assert "Third star: deep focus per day" in page
    for hours in ("3 hours", "4 hours", "5 hours", "6 hours"):
        assert hours in page
    assert game.deep_star_minutes(db.DEFAULT_SETTINGS) == 240 == game.STAR_DEEP_MINUTES
    with db.get_conn(v2_state.db_path) as conn:
        db.set_setting(conn, "deep_star_minutes", 360)
        assert economy.economy_state(conn)["stars"]["goal_minutes"] == 360


# --------------------------------------------------------------------------
# The migration: additive, safe on an existing database
# --------------------------------------------------------------------------

OLD_TABLES = ("settings", "contracts", "plan_blocks", "entries", "outputs", "day_marks", "lapses", "job_leaves", "focus_sessions",
              "slots", "llm_calls", "aw_rules", "unlocks", "devices", "pairings", "pomodoro_runs", "pomodoro_blocks",
              "weather_cache", "postcards", "skylines")
ECON_TABLES = ("econ_earned", "econ_ledger", "econ_weeks", "econ_choice", "econ_missions")


def counts(path):
    c = sqlite3.connect(str(path))
    try:
        return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in OLD_TABLES}
    finally:
        c.close()


def test_migration_on_a_database_made_before_the_money_tables(tmp_path):
    """An old database: the schema as it was before this change, with rows in it. init_db adds the money tables and touches nothing else."""
    schema = db.SCHEMA_PATH.read_text()
    old_schema = schema[:schema.index("-- Money system")]
    path = tmp_path / "old.db"
    c = sqlite3.connect(str(path))
    c.executescript(old_schema)
    c.execute("INSERT INTO settings(key, value) VALUES ('start_date', '\"2026-10-18\"')")
    c.execute("INSERT INTO entries(start_utc, end_utc, category, deep, source, created_at) VALUES "
              "('2026-10-19T10:00:00Z', '2026-10-19T12:00:00Z', 'Python', 1, 'live', '2026-10-19T12:00:00Z')")
    c.execute("INSERT INTO unlocks(key, kind, unlocked_at) VALUES ('ach:first_light', 'achievement', '2026-10-19T12:00:00Z')")
    c.commit()
    c.close()
    before = counts(path)
    before.pop("aw_rules")                               # init_db has always seeded the default ActivityWatch rules into an empty table
    assert not sqlite3.connect(str(path)).execute("SELECT 1 FROM sqlite_master WHERE name = 'econ_ledger'").fetchone()
    db.init_db(path)
    db.init_db(path)                                     # safe to run on every start
    after = counts(path)
    after.pop("aw_rules")
    assert after == before
    c = sqlite3.connect(str(path))
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert set(ECON_TABLES) <= names
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    c.close()
    with db.get_conn(path) as conn:
        state = economy.economy_state(conn)
        assert state["ok"] and state["home"]["id"] == "morningside-studio"


def test_economy_creates_its_own_tables_on_a_database_that_was_not_reinitialised(tmp_path):
    schema = db.SCHEMA_PATH.read_text()
    path = tmp_path / "older.db"
    c = sqlite3.connect(str(path))
    c.executescript(schema[:schema.index("-- Money system")])
    c.execute("INSERT INTO settings(key, value) VALUES ('start_date', '\"2026-10-18\"')")
    c.commit()
    c.close()
    with db.get_conn(path) as conn:
        assert economy.shop_state(conn)["ok"]
        assert conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'econ_%' AND type = 'table'").fetchone()[0] == 5


REAL_DB = Path(__file__).resolve().parent.parent / "data" / "witness.db"


@pytest.mark.skipif(not REAL_DB.exists(), reason="no real database on this machine")
def test_migration_on_a_scratch_copy_of_the_real_database(tmp_path):
    """Copy the user's real database with sqlite's backup API (the original is opened read-only and never changed), then upgrade the copy."""
    src = sqlite3.connect(f"file:{REAL_DB}?mode=ro", uri=True)
    copy = tmp_path / "scratch-copy.db"
    dst = sqlite3.connect(str(copy))
    src.backup(dst)
    dst.close()
    src.close()
    existing = {t for t in OLD_TABLES if sqlite3.connect(str(copy)).execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (t,)).fetchone()}
    old = {t: sqlite3.connect(str(copy)).execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in existing}
    db.init_db(copy)
    with db.get_conn(copy) as conn:
        for table, n in old.items():
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == n, table
        state = economy.economy_state(conn)
        world = game.world_state(conn)
        again = economy.economy_state(conn)
        assert state["ok"] and world["economy"]["home"]["bin"] == cat.HOME_BY_ID[state["home"]["id"]]["bin"]   # the user may have moved
        assert again["balance_cents"] >= state["balance_cents"] >= 0
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'econ_%'")} == set(ECON_TABLES)
