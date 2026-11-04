"""The Harlem brownstone's own room shape (docs/ROOM-V2.md 16.1: the real 124 W 123rd St parlour floor): the per-home override, validation in it, the one-time move of the saved
layout (the desk to the study spot), and that every other home is unchanged. A scratch copy of the real database is read-only sourced."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from epoch import db, economy, layout as lay
from epoch import economy_catalog as cat

HOME = "harlem-floorthrough"
REAL_DB = Path(__file__).resolve().parent.parent / "data" / "witness.db"
REAL_SHAPED = {"v": 1, "homes": {"morningside-studio": {"items": [{"id": "desk_setup", "surface": "floor", "x": 1.75, "z": -1.25, "ry": 0}]},
                                 HOME: {"items": [{"id": "desk_setup", "surface": "floor", "x": 1.75, "z": -1.25, "ry": 0}]}}}


def floor(i, x, z, ry=0.0):
    return {"id": i, "surface": "floor", "x": x, "z": z, "ry": ry}


def test_override_shape_and_room_for():
    rm = lay.room(HOME)
    assert (rm["W"], rm["D"], rm["H"]) == (4.6, 13.8, 3.45) and rm["rev"] == 2
    assert lay.room_for(HOME, "1-bed") == HOME
    for hid in ("uws-prewar", "cpw-parkview", "morningside-studio"):
        h = cat.HOME_BY_ID[hid]
        assert lay.room_for(hid, h["size"]) == h["size"]
    wins = rm["windows"]
    assert sorted((w["wall"], round((w["x0"] + w["x1"]) / 2, 3)) for w in wins) == [("n", -1.45), ("n", 0.25), ("s", -1.1), ("s", 1.1)]
    assert all(abs(w["x1"] - w["x0"] - 1.0) < 1e-9 and (w["y0"], w["y1"]) == (0.5, 2.95) for w in wins)
    d1, d2 = rm["dividers"]
    assert d1["z"] == -1.4 and (d1["x0"], d1["x1"]) == (-2.3, 1.1) and d1["opening"][1] - d1["opening"][0] == pytest.approx(1.8)
    assert d2["z"] == 1.9 and d2["opening"][1] - d2["opening"][0] == pytest.approx(0.92)
    hl = rm["hall"]
    assert hl["x"] == 1.1 and hl["z1"] == 1.0 and hl["door"] == [-0.75, 0.15]            # the entrance door at z = -0.3, 0.9 wide
    assert {k["id"] for k in rm["keepouts"]} >= {"stair_hall", "kitchen", "fireplace", "front_door", "bath", "bedzone", "closet"}
    d = lay.describe(HOME)
    assert d["size"] == "1-bed" and d["W"] == 4.6 and d["kitchen"] and {"walls", "obstacles", "windows", "stand", "grid"} <= set(d)
    assert set(d["walls"]) == {"n", "w", "s", "e", "h", "d1", "d2"}


def test_unchanged_rooms():
    assert set(lay.ROOMS) == {"studio", "1-bed", "loft", "penthouse"}
    assert lay.room("1-bed")["W"] == 7.0 and "dividers" not in lay.room("1-bed")
    assert set(lay.describe("1-bed")["walls"]) == {"n", "w", "p"} and set(lay.describe("studio")["walls"]) == {"n", "w"}
    assert lay.describe("1-bed")["size"] == "1-bed"


def ok(item, x, z, ry=0.0, others=()):
    lay.check(lay.room(HOME), lay.normalize(floor(item, x, z, ry)), list(others))


def refused(item, x, z, ry=0.0, code=None):
    with pytest.raises(lay.LayoutError) as ex:
        ok(item, x, z, ry)
    if code:
        assert ex.value.code == code


def test_validation_bounds_keepouts_dividers():
    ok("desk_setup", -1.45, -6.3)                       # the study spot, at the left street window
    ok("bookshelf", -0.3, -2.5)
    refused("desk_setup", 2.4, -5.0, code="out_of_bounds")
    refused("desk_setup", 0.0, 6.9, code="out_of_bounds")
    refused("bookshelf", -1.5, 0.0, code="taken")       # kitchen run
    refused("bookshelf", -1.5, -4.2, code="taken")      # fireplace and hearth
    refused("bookshelf", 0.45, 3.0, code="taken")       # bed zone
    refused("bookshelf", 0.6, -0.3, code="taken")       # front door swing
    refused("bookshelf", 0.6, 1.2, code="taken")        # bathroom
    refused("bookshelf", -1.5, 4.5, code="taken")      # closet doors
    refused("bookshelf", 1.7, -3.0, code="divider")       # the stair hall is not part of the apartment
    refused("woven_rug", 0.5, -3.0, code="divider")     # a rug may not run into the hall wall either
    refused("bookshelf", -0.6, -1.4, code="divider")    # across d1, even through the cased opening
    refused("woven_rug", -1.0, 1.9, code="divider")     # rugs too
    ok("bookshelf", -0.3, -2.4)
    lay.validate(HOME, [floor("desk_setup", -1.45, -6.3)], budget=12, owned={"desk_setup"})
    with pytest.raises(lay.LayoutError) as ex:
        lay.validate(HOME, [floor("desk_setup", -1.45, -6.3), floor("bookshelf", 0, -3)] * 7, budget=12, owned={"desk_setup", "bookshelf"})
    assert ex.value.code == "over_budget"


def test_wall_items_on_exterior_walls_and_dividers():
    pic = next(i["id"] for i in cat.FURNITURE if lay.geo(i["id"]) and lay.geo(i["id"])["surface"] == "wall")
    rm = lay.room(HOME)

    def wall(wid, u, y=1.3):
        return lay.normalize({"id": pic, "surface": "wall", "wall": wid, "u": u, "y": y})

    lay.check(rm, wall("s", 0.5), [])
    lay.check(rm, wall("e", 0.9), [])           # the bedroom stretch of the east party wall (z > 1.0)
    lay.check(rm, wall("d2", 0.7), [])
    lay.check(rm, wall("w", 0.1), [])           # the west wall in the front corner, north of the fireplace
    lay.check(rm, wall("h", 0.2), [])           # the apartment side of the stair-hall wall
    with pytest.raises(lay.LayoutError):
        lay.check(rm, wall("e", 0.2), [])       # the east wall behind the stair hall is not ours
    with pytest.raises(lay.LayoutError):
        lay.check(rm, wall("d1", (-0.6 + 2.3) / 3.4), [])   # in the cased opening
    with pytest.raises(lay.LayoutError):
        lay.check(rm, wall("n", (-1.45 + 2.3) / 4.6), [])   # on a street window


def test_migration_of_the_real_shaped_layout_is_idempotent():
    items, left, changed = lay.fit_home(HOME, REAL_SHAPED["homes"][HOME]["items"], first=True)
    assert changed and not left
    assert items == [lay.study_entry(HOME)]
    assert -6.4 < items[0]["z"] < -6.2 and items[0]["x"] == -1.45
    again, left2, changed2 = lay.fit_home(HOME, items, first=False)
    assert again == items and not left2 and not changed2
    twice, _l, c3 = lay.fit_home(HOME, items, first=True)        # even re-running the first-time pass lands on the same spot
    assert twice == items and not c3


def test_misfits_are_nudged_never_lost():
    raw = [floor("desk_setup", 1.75, -1.25), floor("bookshelf", -2.2, -4.2), floor("woven_rug", -1.0, 1.9), {"id": "ghost", "x": "no"}]
    out, left, changed = lay.fit_home(HOME, raw, first=True)
    assert changed and len(out) + len(left) == len(raw)
    again, _l, c = lay.fit_home(HOME, out, first=False)
    assert not c and again == out
    placed = [lay.normalize(o) for o in out if o.get("id") != "ghost"]
    taken: list = []
    for e in placed:
        lay.check(lay.room(HOME), e, taken)
        taken.append(e)
    assert {"id": "ghost", "x": "no"} in out                       # untouched, not dropped


def _seed(conn, doc):
    conn.execute("INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES ('2026-10-06T00:00:00Z', 'purchase', 'purchase:desk_setup', 0, '2026-10-05', ?)",
                 (json.dumps({"item": "desk_setup", "name": "Desk setup", "kind": "furniture"}),))
    conn.execute("INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES ('2026-10-07T00:00:00Z', 'move', 'move:1', 0, '2026-10-05', ?)",
                 (json.dumps({"to": HOME}),))
    conn.execute("INSERT OR REPLACE INTO econ_choice(key, value, updated_utc) VALUES ('layout', ?, ?)", (json.dumps(doc), db.utc_now_iso()))
    conn.commit()


def test_economy_reads_migrates_once_and_saves(tmp_path):
    p = tmp_path / "t.db"
    db.init_db(p)
    with db.get_conn(p) as conn:
        _seed(conn, json.loads(json.dumps(REAL_SHAPED)))
        assert economy._E(conn).home_at()["id"] == HOME
        st = economy.layout_state(conn)
        assert st["room"]["W"] == 4.6 and st["home"]["size"] == "1-bed" and st["home"]["budget"] == 12
        desk = next(i for i in st["items"] if i["id"] == "desk_setup")
        assert desk["x"] == -1.45 and desk["ry"] == 0
        stored = json.loads(conn.execute("SELECT value FROM econ_choice WHERE key='layout'").fetchone()[0])
        assert stored["homes"]["morningside-studio"] == REAL_SHAPED["homes"]["morningside-studio"]      # the studio is untouched
        assert stored["homes"][HOME]["room"] == lay.room_marker(HOME)
        raw1 = tuple(conn.execute("SELECT value, updated_utc FROM econ_choice WHERE key='layout'").fetchone())
        economy.layout_state(conn)
        assert tuple(conn.execute("SELECT value, updated_utc FROM econ_choice WHERE key='layout'").fetchone()) == raw1   # idempotent
        saved = economy.save_layout(conn, [floor("desk_setup", -0.6, -4.0)])
        assert saved["saved"] and saved["items"][0]["x"] == -0.6                                           # a later free move sticks
        assert economy.layout_state(conn)["items"][0]["x"] == -0.6
        with pytest.raises(economy.EconomyError):
            economy.save_layout(conn, [floor("desk_setup", -1.9, 0.0)])


@pytest.mark.skipif(not REAL_DB.exists(), reason="no real database on this machine")
def test_scratch_copy_of_the_real_database(tmp_path):
    src = sqlite3.connect(f"file:{REAL_DB}?mode=ro", uri=True)
    copy = tmp_path / "scratch.db"
    dst = sqlite3.connect(str(copy))
    src.backup(dst)
    dst.close()
    src.close()
    db.init_db(copy)
    with db.get_conn(copy) as conn:
        home = economy._E(conn).home_at()
        st = economy.layout_state(conn)
        ids = [i["id"] for i in st["items"]]
        assert len(ids) == len(set(ids)) <= home["budget"]
        if home["id"] == HOME:
            assert st["room"]["W"] == 4.6
            taken: list = []
            for i in st["items"]:
                if i["surface"] == "floor":
                    e = lay.normalize(i)
                    lay.check(lay.room(HOME), e, taken)
                    taken.append(e)
            desk = [i for i in st["items"] if i["id"] == "desk_setup"]
            assert not desk or abs(desk[0]["x"] + 1.45) < 0.01 or desk[0]["x"] != 1.75
        before = conn.execute("SELECT value FROM econ_choice WHERE key='layout'").fetchone()[0]
        economy.layout_state(conn)
        assert conn.execute("SELECT value FROM econ_choice WHERE key='layout'").fetchone()[0] == before
