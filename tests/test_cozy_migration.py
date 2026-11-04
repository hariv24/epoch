"""The cozy engine on the user's real database (a scratch copy only): the additive migration keeps every old row, and the new surfaces
(layout, missions, chest, spots, the Pomodoro `spot` column) work on top of it. The real file is opened read-only and never written."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from epoch import cozy, db, economy, game, layout, pomodoro
from epoch import economy_catalog as cat

REAL_DB = Path(__file__).resolve().parent.parent / "data" / "witness.db"
pytestmark = pytest.mark.skipif(not REAL_DB.exists(), reason="no real database on this machine")


def scratch_copy(tmp_path) -> Path:
    src = sqlite3.connect(f"file:{REAL_DB}?mode=ro", uri=True)
    copy = tmp_path / "scratch-copy.db"
    dst = sqlite3.connect(str(copy))
    src.backup(dst)
    dst.close()
    src.close()
    return copy


def counts(path) -> dict[str, int]:
    c = sqlite3.connect(str(path))
    try:
        names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        return {n: c.execute(f"SELECT COUNT(*) FROM {n}").fetchone()[0] for n in names}
    finally:
        c.close()


def test_the_upgrade_keeps_every_old_row_and_adds_only_what_the_cozy_build_needs(tmp_path):
    copy = scratch_copy(tmp_path)
    before = counts(copy)
    cols_before = {r[1] for r in sqlite3.connect(str(copy)).execute("PRAGMA table_info(pomodoro_runs)")}
    db.init_db(copy)
    after = counts(copy)
    for table, n in before.items():
        assert after[table] == n, table                                       # nothing lost, nothing duplicated
    assert set(after) - set(before) <= {"econ_missions"}
    c = sqlite3.connect(str(copy))
    cols = {r[1] for r in c.execute("PRAGMA table_info(pomodoro_runs)")}
    assert "spot" in cols and cols - cols_before <= {"spot"}                    # the live DB may already be upgraded
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    if "spot" not in cols_before:
        assert c.execute("SELECT COUNT(*) FROM pomodoro_runs WHERE spot IS NOT NULL").fetchone()[0] == 0  # old runs simply have no spot
    c.close()
    db.init_db(copy)                                                          # and running it again changes nothing
    assert counts(copy) == after


def test_every_new_surface_works_on_a_copy_of_the_real_database(tmp_path):
    copy = scratch_copy(tmp_path)
    old_ledger = counts(copy)["econ_ledger"]
    old_missions = counts(copy).get("econ_missions", 0)                      # the live DB may already hold earlier days
    c = sqlite3.connect(str(copy))
    row = c.execute("SELECT value FROM econ_choice WHERE key = 'placed'").fetchone()
    had_layout = c.execute("SELECT 1 FROM econ_choice WHERE key = 'layout'").fetchone() is not None
    c.close()
    old_placed = {x for x in json.loads(row[0]) if x} if row else set()      # the user's real slots on the day the copy is taken
    db.init_db(copy)
    with db.get_conn(copy) as conn:
        eco = economy.economy_state(conn)
        home = cat.HOME_BY_ID[eco["home"]["id"]]                              # whatever home the user lives in now
        budget = cat.BUDGETS[home["size"]]
        assert eco["ok"] and eco["home"]["budget"] == budget
        assert eco["missions"]["enabled"] and eco["missions"]["total"] == 3 and eco["chest"]["max"] == 7 and eco["spot"]["id"] in cat.SPOT_BY_ID
        assert not game.has_banned_words(json.dumps(eco["missions"]) + json.dumps(eco["spot"]))
        lay = economy.layout_state(conn)
        ids = [x["id"] for x in lay["items"]]
        assert lay["ok"] and lay["room"]["W"] == layout.room(layout.room_for(home["id"], home["size"]))["W"] and lay["home"]["used"] == len(ids) <= budget and len(set(ids)) == len(ids)
        if not had_layout:                                                    # every piece that sat on an old slot is still in the room
            assert set(ids) >= old_placed
        assert cozy.missions_state(conn)["total"] == 3 and cozy.spots_state(conn)["ok"]
        assert pomodoro.get_state(conn)["spot"]["id"] in cat.SPOT_BY_ID
        world = game.world_state(conn)
        assert world["economy"]["layout"]["budget"] == budget and world["economy"]["spot"]["id"] in cat.SPOT_BY_ID
        # no money moved: reading the cozy screens only ever writes the day's missions
        assert conn.execute("SELECT COUNT(*) FROM econ_ledger").fetchone()[0] == old_ledger
        assert old_missions <= conn.execute("SELECT COUNT(*) FROM econ_missions").fetchone()[0] <= old_missions + 1   # at most today's row added
        # a run started now carries a spot and the rest of the old runs are untouched
        if pomodoro.active_run(conn) is not None:          # the user's real session may be running when the copy is taken
            pomodoro.stop(conn, discard=True)
        runs = conn.execute("SELECT COUNT(*) FROM pomodoro_runs").fetchone()[0]
        state = pomodoro.start(conn, category="Python", preset="25-5-4")
        assert state["run"]["spot"] in cat.SPOT_BY_ID and conn.execute("SELECT COUNT(*) FROM pomodoro_runs").fetchone()[0] == runs + 1
        pomodoro.stop(conn, discard=True)
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_slot_placements_on_a_copy_become_layout_positions_once(tmp_path):
    copy = scratch_copy(tmp_path)
    db.init_db(copy)
    with db.get_conn(copy) as conn:
        for n, item in enumerate(("bookshelf", "reading_lamp", "skyline_print")):
            conn.execute("INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES ('2026-10-21T10:0%d:00Z', 'purchase', ?, 0, "
                         "'2026-10-19', ?)" % n, (f"purchase:{item}", json.dumps({"item": item, "name": item, "kind": "furniture", "price_cents": 0})))
        conn.execute("INSERT OR REPLACE INTO econ_choice(key, value, updated_utc) VALUES ('placed', ?, '2026-10-21T10:30:00Z')",
                     (json.dumps(["bookshelf", "skyline_print", "reading_lamp", None]),))
        first = economy.economy_state(conn)
        items = {x["id"]: x for x in first["home"]["layout"]["items"]}
        conn.execute("DELETE FROM econ_choice WHERE key = 'layout'")           # replay the one-time migration from the old slot list
        first = economy.economy_state(conn)
        items = {x["id"]: x for x in first["home"]["layout"]["items"]}
        owned_furniture = set(first["owned"]["furniture"])
        assert set(items) == {"bookshelf", "skyline_print", "reading_lamp"}
        assert {s["item"] for s in first["storage"]} == owned_furniture - set(items)   # the user's other owned pieces wait in storage, none lost
        assert items["skyline_print"]["surface"] == "wall" and items["bookshelf"]["surface"] == "floor"
        stored = conn.execute("SELECT value FROM econ_choice WHERE key = 'layout'").fetchone()["value"]
        assert economy.economy_state(conn)["home"]["layout"]["items"] == first["home"]["layout"]["items"]
        assert conn.execute("SELECT value FROM econ_choice WHERE key = 'layout'").fetchone()["value"] == stored
        assert json.loads(conn.execute("SELECT value FROM econ_choice WHERE key = 'placed'").fetchone()["value"]) == ["bookshelf", "skyline_print", "reading_lamp", None]
        saved = economy.save_layout(conn, [{k: v for k, v in x.items() if k in ("id", "surface", "x", "z", "ry", "wall", "u", "y")} for x in items.values()])
        assert saved["saved"] and saved["home"]["used"] == 3                      # what the migration made is accepted back as it is
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert {c for c in cat.ITEM_BY_ID} >= {"bookshelf", "reading_lamp", "skyline_print"}
