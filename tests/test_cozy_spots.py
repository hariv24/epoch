"""Study spots (docs/COZY.md 4.5): the catalog, unlocking through the ordinary buy flow (ledger kind `spot_unlock`), plain-words gates,
selecting a spot, the last one used being remembered, and the spot riding on Pomodoro runs, the Pomodoro API and the SSE stream."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

import pytest

from epoch import cozy, db, economy, game, pomodoro, timeutil
from epoch import economy_catalog as cat

TZ = "Asia/Kolkata"
D = lambda n: date(2026, 10, 5) + timedelta(days=n)        # noqa: E731
NOON = lambda d: timeutil.at_local(d, "12:00", TZ, 4)      # noqa: E731


def fund(conn, dollars):
    conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES ('2026-10-05', 'output', ?, '2026-10-05T00:00:00Z') "
                 "ON CONFLICT(local_date, source) DO UPDATE SET cents = cents + excluded.cents", (dollars * 100,))


def set_level(conn, xp=100_000):
    conn.execute("INSERT OR REPLACE INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', '2026-10-05T00:00:00Z', ?)",
                 (json.dumps({"xp": xp}),))


def unlock(conn, spot, day=D(7)):
    q = economy.buy(conn, spot, today=day, now=NOON(day))["quote"]
    return economy.buy(conn, spot, q["price"], q["token"], today=day, now=NOON(day))


def spots(conn, day=D(7)):
    return {s["id"]: s for s in cozy.spots_state(conn, today=day, now=NOON(day))["spots"]}


# --------------------------------------------------------------------------
# The catalog and the gates
# --------------------------------------------------------------------------

def test_the_seven_spots_and_their_prices():
    by = cat.SPOT_BY_ID
    assert [s["id"] for s in cat.STUDY_SPOTS] == ["butler", "cafe_amsterdam", "low_steps", "rooftop", "park_bench", "nypl_rose", "penthouse_desk"]
    assert (by["butler"]["price"], by["cafe_amsterdam"]["price"], by["low_steps"]["price"], by["rooftop"]["price"]) == (0, 300, 450, 700)
    assert (by["nypl_rose"]["price"], by["park_bench"]["price"]) == (1200, 900)
    assert by["nypl_rose"]["district"] == "Midtown & Times Square" and by["park_bench"]["district"] == "Central Park"
    assert by["penthouse_desk"]["home"] == "brow-penthouse" and by["penthouse_desk"]["price"] == 0
    assert {s["id"] for s in cat.STUDY_SPOTS if s["outdoor"]} == {"low_steps", "rooftop", "park_bench"}
    districts = {n for _f, _l, n, _i in game.DISTRICTS}
    assert all(s["district"] in districts for s in cat.STUDY_SPOTS if s["district"])
    assert all(not game.has_banned_words(s["name"] + s["blurb"]) for s in cat.STUDY_SPOTS)


def test_gates_are_said_in_plain_words(conn):
    s = spots(conn)
    assert s["butler"]["state"] == "open" and s["butler"]["unlocked"] and s["butler"]["selected"]
    assert s["cafe_amsterdam"]["state"] == "available" and s["cafe_amsterdam"]["can_buy"] is False and s["cafe_amsterdam"]["why_not"] == "$300 more savings to go."
    assert s["nypl_rose"]["state"] == "locked" and s["nypl_rose"]["gate"] == "Unlocks with Midtown & Times Square, Level 13"
    assert s["nypl_rose"]["why_not"] == "The Fifth Ave reading room opens with Midtown & Times Square, Level 13."
    assert s["park_bench"]["gate"] == "Unlocks with Central Park, Level 7" and s["park_bench"]["unlocks_at_level"] == 7
    assert s["penthouse_desk"]["state"] == "locked" and "live in" in s["penthouse_desk"]["gate"]
    assert all(not game.has_banned_words(json.dumps(v)) for v in s.values())
    fund(conn, 400)
    again = spots(conn)
    assert again["cafe_amsterdam"]["can_buy"] is True and again["cafe_amsterdam"]["why_not"] is None and len(again["cafe_amsterdam"]["token"]) == 12
    assert again["low_steps"]["can_buy"] is False and again["low_steps"]["short_by"] == 50


def test_the_level_opens_a_gate_and_living_in_the_penthouse_opens_its_desk(conn):
    set_level(conn)
    fund(conn, 5000)
    assert spots(conn)["nypl_rose"]["state"] == "available" and spots(conn)["park_bench"]["state"] == "available"
    assert spots(conn)["penthouse_desk"]["state"] == "locked"
    conn.execute("INSERT INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES ('2026-10-12T00:00:00Z', 'move', 'move:1', 0, '2026-10-12', "
                 "'{\"from\": \"morningside-studio\", \"to\": \"brow-penthouse\"}')")
    pent = spots(conn)["penthouse_desk"]
    assert pent["state"] == "open" and pent["unlocked"] and pent["price"] == 0
    assert economy.economy_state(conn, today=D(7), now=NOON(D(7)))["spot"]["unlocked"] == ["butler", "penthouse_desk"]


# --------------------------------------------------------------------------
# Unlocking through the buy flow
# --------------------------------------------------------------------------

def test_unlocking_is_the_ordinary_two_step_buy_and_writes_a_spot_unlock_row(conn):
    fund(conn, 1000)
    day, now = D(7), NOON(D(7))
    quote = economy.buy(conn, "cafe_amsterdam", today=day, now=now)
    assert quote["confirm_needed"] and quote["quote"]["price"] == 300 and quote["quote"]["balance_after"] == 700
    done = economy.buy(conn, "cafe_amsterdam", 300, quote["quote"]["token"], today=day, now=now)
    assert done["bought"] and done["balance"] == 700 and done["selected"] is True and done["spot"]["id"] == "cafe_amsterdam"
    assert done["toast"] == "Amsterdam Ave café is open. $700 in savings." and not game.has_banned_words(done["toast"])
    row = conn.execute("SELECT kind, ref, cents, meta FROM econ_ledger WHERE kind = 'spot_unlock'").fetchone()
    assert (row["ref"], row["cents"]) == ("spot:cafe_amsterdam", -30000) and json.loads(row["meta"])["kind"] == "spot"
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger WHERE kind = 'purchase'").fetchone()[0] == 0
    eco = economy.economy_state(conn, today=day, now=now)
    assert eco["owned"]["spot"] == ["butler", "cafe_amsterdam"] and eco["spot"]["id"] == "cafe_amsterdam"      # unlocking selects it
    assert eco["items_value"] == 0 and eco["net_worth"] == eco["balance"]                                        # a place, not a thing
    assert spots(conn, day)["cafe_amsterdam"]["state"] == "open"
    with pytest.raises(economy.EconomyError) as again:
        economy.buy(conn, "cafe_amsterdam", today=day, now=now)
    assert again.value.code == "already_owned"


def test_refusals_are_calm_and_specific(conn):
    fund(conn, 100)
    day, now = D(7), NOON(D(7))
    with pytest.raises(economy.EconomyError) as short:
        economy.buy(conn, "rooftop", today=day, now=now)
    assert short.value.code == "insufficient_funds" and short.value.extra["short_by"] == 600
    with pytest.raises(economy.EconomyError) as locked:
        economy.buy(conn, "nypl_rose", today=day, now=now)
    assert locked.value.code == "locked" and locked.value.hint == "The Fifth Ave reading room opens with Midtown & Times Square, Level 13."
    with pytest.raises(economy.EconomyError) as home:
        economy.buy(conn, "penthouse_desk", today=day, now=now)
    assert home.value.code == "home_gated"
    with pytest.raises(economy.EconomyError) as free:
        economy.buy(conn, "butler", today=day, now=now)
    assert free.value.code == "already_owned"


def test_a_stale_token_never_unlocks(conn):
    fund(conn, 1000)
    day, now = D(7), NOON(D(7))
    with pytest.raises(economy.EconomyError) as stale:
        economy.buy(conn, "rooftop", 700, "000000000000", today=day, now=now)
    assert stale.value.code == "stale"
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger WHERE kind = 'spot_unlock'").fetchone()[0] == 0


# --------------------------------------------------------------------------
# Selecting, remembering, and the run
# --------------------------------------------------------------------------

def test_selecting_a_spot_needs_it_open_and_is_remembered(conn):
    fund(conn, 1000)
    assert cozy.select_spot(conn, "butler")["selected"] == "butler"
    with pytest.raises(economy.EconomyError) as locked:
        cozy.select_spot(conn, "rooftop")
    assert locked.value.code == "spot_locked" and locked.value.hint == "Morningside rooftop is not open yet. It opens for $700."
    with pytest.raises(economy.EconomyError) as unknown:
        cozy.select_spot(conn, "the_moon")
    assert unknown.value.code == "unknown_spot"
    unlock(conn, "cafe_amsterdam")
    unlock(conn, "rooftop")
    assert economy.selected_spot(conn) == "rooftop"                       # the latest unlock is selected
    cozy.select_spot(conn, "cafe_amsterdam")
    assert economy.selected_spot(conn) == "cafe_amsterdam" and spots(conn)["cafe_amsterdam"]["selected"]
    assert cozy.spots_state(conn, today=D(7), now=NOON(D(7)))["last_used"] == "cafe_amsterdam"


def test_a_spot_that_is_not_open_is_never_selected_even_if_the_choice_says_so(conn):
    conn.execute("INSERT INTO econ_choice(key, value, updated_utc) VALUES ('spot', '\"nypl_rose\"', '2026-10-06T00:00:00Z')")
    assert economy.selected_spot(conn) == "butler"
    conn.execute("UPDATE econ_choice SET value = '\"not-a-spot\"' WHERE key = 'spot'")
    assert economy.selected_spot(conn) == "butler"


def post(owner, action, **body):
    return owner.post(f"/api/pomodoro/{action}", json=body).json()


def fund_path(path, dollars):
    with db.get_conn(path) as conn:
        fund(conn, dollars)


def test_a_run_carries_its_spot_through_the_api_and_the_stream(owner, v2_state, v2_clock):
    fund_path(v2_state.db_path, 800)
    idle = owner.get("/api/pomodoro").json()
    assert idle["spot"]["id"] == "butler" and idle["selected_spot"] == "butler" and idle["run"] is None
    # an unopened spot is refused with its gate in plain words, and nothing starts
    refused = post(owner, "start", category="Python", spot="rooftop")
    assert refused["ok"] is False and refused["code"] == "spot_locked" and "$700" in refused["hint"] and "$" in refused["hint"]
    assert owner.get("/api/pomodoro").json()["active"] is False
    q = owner.post("/api/shop/buy", json={"item": "cafe_amsterdam"}).json()["quote"]
    assert owner.post("/api/shop/buy", json={"item": "cafe_amsterdam", "price": q["price"], "token": q["token"]}).json()["bought"]
    started = post(owner, "start", category="Python", label="numpy", spot="cafe_amsterdam")
    run = started["pomodoro"]["run"]
    assert started["ok"] and run["spot"] == "cafe_amsterdam" and started["pomodoro"]["spot"]["id"] == "cafe_amsterdam"
    assert started["pomodoro"]["spot"]["pin"] == "Studying at the café"
    live = owner.get("/api/pomodoro").json()
    assert live["run"]["spot"] == "cafe_amsterdam" and live["spot"]["name"] == "A café on Amsterdam Ave"
    with owner.stream("GET", "/api/stream?limit=1") as response:
        body = "".join(response.iter_text())
    data = json.loads([line for line in body.splitlines() if line.startswith("data: ")][0][6:])
    assert data["run"]["spot"] == "cafe_amsterdam" and data["spot"]["id"] == "cafe_amsterdam"
    # while studying, the character is at that spot, and the money screens say so
    eco = owner.get("/api/economy").json()
    assert eco["character"]["state"] == "studying" and eco["character"]["location"] == "cafe_amsterdam"
    assert eco["character"]["pin"] == "Studying at the café" and eco["focus"]["spot"] == "cafe_amsterdam"
    assert owner.get("/api/world").json()["economy"]["character"]["location"] == "cafe_amsterdam"
    post(owner, "stop", discard=True)


def test_the_last_spot_used_is_the_next_runs_default(owner, v2_state, v2_clock):
    fund_path(v2_state.db_path, 1200)
    for item in ("cafe_amsterdam", "rooftop"):
        q = owner.post("/api/shop/buy", json={"item": item}).json()["quote"]
        owner.post("/api/shop/buy", json={"item": item, "price": q["price"], "token": q["token"]})
    first = post(owner, "start", category="Python", spot="cafe_amsterdam")
    assert first["pomodoro"]["run"]["spot"] == "cafe_amsterdam"
    post(owner, "stop", discard=True)
    second = post(owner, "start", category="Python")                       # no spot sent: the last one used
    assert second["pomodoro"]["run"]["spot"] == "cafe_amsterdam"
    post(owner, "stop", discard=True)
    assert owner.post("/api/spots/select", json={"spot": "rooftop"}).json()["selected"] == "rooftop"
    third = post(owner, "start", category="Python")
    assert third["pomodoro"]["run"]["spot"] == "rooftop"
    post(owner, "stop", discard=True)
    assert owner.get("/api/spots").json()["last_used"] == "rooftop"


def test_the_spots_api(owner, v2_state):
    body = owner.get("/api/spots").json()
    assert body["ok"] and body["selected"] == "butler" and len(body["spots"]) == 7 and body["next"]["id"] == "cafe_amsterdam"
    assert set(body["spots"][0]) >= {"id", "name", "short", "pin", "blurb", "outdoor", "price", "district", "unlocks_at_level", "unlocked", "state",
                                      "affordable", "short_by", "can_buy", "gate", "why_not", "selected", "token"}
    bad = owner.post("/api/spots/select", json={"spot": "nypl_rose"}).json()
    assert bad["ok"] is False and bad["code"] == "spot_locked" and "Level 13" in bad["hint"]
    assert owner.post("/api/spots/select", json={"spot": "butler"}).json() == {
        "ok": True, "selected": "butler", "spot": {"id": "butler", "name": "Butler Library reading room", "short": "Butler Library",
                                                   "pin": "Studying at Butler", "outdoor": False}, "message": "Butler Library it is."}


# --------------------------------------------------------------------------
# Old databases
# --------------------------------------------------------------------------

def test_a_database_from_before_study_spots_gets_the_column_when_it_is_used(tmp_path):
    path = tmp_path / "old.db"
    schema = db.SCHEMA_PATH.read_text().replace(",\n  spot            TEXT                      -- the study spot (economy_catalog.STUDY_SPOTS id); added later, see db.ensure_columns", "")
    assert "spot            TEXT" not in schema
    c = sqlite3.connect(str(path))
    c.executescript(schema)
    c.execute("INSERT INTO settings(key, value) VALUES ('start_date', '\"2026-10-05\"')")
    c.commit()
    assert "spot" not in {r[1] for r in c.execute("PRAGMA table_info(pomodoro_runs)")}
    c.close()
    with db.get_conn(path) as conn:
        state = pomodoro.start(conn, category="Python", preset="25-5-4")
        assert state["run"]["spot"] == "butler"
        assert "spot" in {r[1] for r in conn.execute("PRAGMA table_info(pomodoro_runs)")}
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    db.init_db(path)                                                    # and re-initialising is harmless
    with db.get_conn(path) as conn:
        assert conn.execute("SELECT spot FROM pomodoro_runs").fetchone()[0] == "butler"
