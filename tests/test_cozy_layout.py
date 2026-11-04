"""Free placement in the home (docs/COZY.md 4.2): the room numbers match room.js, server-side validation with calm refusals, the one-time
migration of the old fixed slots, budgets and downsizing, and GET/POST /api/home/layout."""
from __future__ import annotations

import json
import math
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from epoch import db, economy, game, layout as lay, timeutil
from epoch import economy_catalog as cat

TZ = "Asia/Kolkata"
D = lambda n: date(2026, 10, 5) + timedelta(days=n)        # noqa: E731
NOON = lambda d: timeutil.at_local(d, "12:00", TZ, 4)      # noqa: E731
APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
CITY = APP / "city"
VENDOR = APP.parent / "vendor" / "three"
SIZES = ("studio", "1-bed", "loft", "penthouse")
FURNITURE = [i["id"] for i in cat.FURNITURE + cat.CHEST_FURNITURE]


def own(conn, *items, kind="purchase"):
    """Give the user things without going through the shop (ledger rows, like a purchase or a chest find)."""
    for n, item in enumerate(items):
        conn.execute("INSERT OR IGNORE INTO econ_ledger(at_utc, kind, ref, cents, week, meta) VALUES (?, ?, ?, 0, '2026-10-05', ?)",
                     (f"2026-10-06T00:{n:02d}:00Z", kind, f"{kind}:{item}", json.dumps({"item": item, "name": item, "kind": cat.ITEM_BY_ID[item]["kind"]})))


def fund(conn, dollars, day="2026-10-05"):
    conn.execute("INSERT INTO econ_earned(local_date, source, cents, updated_utc) VALUES (?, 'output', ?, '2026-10-05T00:00:00Z') "
                 "ON CONFLICT(local_date, source) DO UPDATE SET cents = cents + excluded.cents", (day, dollars * 100))


def set_level(conn, xp=100_000):
    conn.execute("INSERT OR REPLACE INTO unlocks(key, kind, unlocked_at, meta) VALUES ('xp_hw', 'ratchet', '2026-10-05T00:00:00Z', ?)",
                 (json.dumps({"xp": xp}),))


def floor(item, x, z, ry=0.0):
    return {"id": item, "surface": "floor", "x": x, "z": z, "ry": ry}


def wall(item, w, u, y):
    return {"id": item, "surface": "wall", "wall": w, "u": u, "y": y}


# --------------------------------------------------------------------------
# The numbers cannot drift from room.js
# --------------------------------------------------------------------------

@pytest.mark.skipif(not VENDOR.exists(), reason="three is not vendored")
def test_python_room_numbers_match_room_js(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    (tmp_path / "hooks.mjs").write_text(
        "const V = %s;\n"
        "export async function resolve(spec, ctx, next) {\n"
        "  if (spec === 'three') return { url: V + 'three.module.js', shortCircuit: true };\n"
        "  if (spec.startsWith('three/addons/')) return { url: V + 'addons/' + spec.slice(13), shortCircuit: true };\n"
        "  return next(spec, ctx);\n}\n" % json.dumps(VENDOR.as_uri() + "/"))
    (tmp_path / "reg.mjs").write_text("import { register } from 'node:module';\nregister('./hooks.mjs', import.meta.url);\n")
    script = tmp_path / "run.mjs"
    script.write_text(f"globalThis.document = {{ createElement: () => ({{ getContext: () => null }}) }};\n"
                      f"const room = await import({json.dumps((CITY / 'room.js').as_uri())});\n"
                      "console.log(JSON.stringify(room.LAYOUTS));\n")
    res = subprocess.run([node, "--import", str(tmp_path / "reg.mjs"), str(script)], capture_output=True, text=True, cwd=tmp_path, timeout=120)
    assert res.returncode == 0, res.stderr[-1500:]
    js = json.loads(res.stdout.strip().splitlines()[-1])
    assert set(js) == set(SIZES) | set(lay.ROOMS_BY_HOME)

    def same(mine_v, js_v, path):
        if isinstance(mine_v, dict):
            for k, v in mine_v.items():
                assert k in js_v, (path, k)
                same(v, js_v[k], f"{path}.{k}")
        elif isinstance(mine_v, list):
            assert len(mine_v) == len(js_v), path
            for i, (x, y) in enumerate(zip(mine_v, js_v)):
                same(x, y, f"{path}[{i}]")
        else:
            assert mine_v == pytest.approx(js_v), (path, mine_v, js_v)

    for size in SIZES:
        mine, theirs = lay.ROOMS[size], js[size]
        for key in ("W", "D", "H", "bed", "kitchen", "island", "partition", "columns", "stand", "windows"):
            assert (key in mine) == (key in theirs), (size, key)
            if key in mine:
                same(mine[key], theirs[key], f"{size}.{key}")
        if "slots" in theirs:             # the old fixed slots (the migration needs them exactly)
            assert len(mine["slots"]) == len(theirs["slots"]) == cat.SIZES[size]
            for a, b in zip(mine["slots"], theirs["slots"]):
                assert (a["x"], a["z"], a["wall"]) == (b["x"], b["z"], b["wall"])
                assert a["ry"] == pytest.approx(b["ry"])
    assert {h["size"]: h["budget"] for h in cat.HOMES} == {"studio": 8, "1-bed": 12, "loft": 16, "penthouse": 24}


# --------------------------------------------------------------------------
# The catalog
# --------------------------------------------------------------------------

def test_every_furniture_item_has_geometry_and_the_chest_only_ones_are_not_sold():
    for it in cat.FURNITURE + cat.CHEST_FURNITURE:
        w, d, h = it["size"]
        assert w > 0 and d > 0 and h > 0 and len(it["anchor"]) == 2, it["id"]
        assert it["surface"] in ("floor", "wall") and it["layer"] in (None, "under", "over"), it["id"]
        assert it["activity"] is None or it["activity"] in cat.ACTIVITIES, it["id"]
    assert {i["id"] for i in cat.FURNITURE if i["surface"] == "wall"} == {"postcard_board", "skyline_print", "oil_painting"}
    assert {i["id"] for i in cat.FURNITURE if i["layer"] == "under"} == {"woven_rug", "silk_rug"}
    assert all(i["chest_only"] and i["price"] == 0 for i in cat.CHEST_ITEMS)
    assert not ({i["id"] for i in cat.CHEST_ITEMS} & {i["id"] for i in cat.ITEMS})        # never in the store
    assert len(cat.CHEST_FURNITURE) == 6 and len(cat.CHEST_OUTFITS) == 2 and len(cat.CHEST_POSTCARDS) == 3
    assert cat.ACTIVITIES["play_records"]["line"] == "Your character will play records here."


def test_every_piece_fits_alone_in_a_room_where_it_is_allowed_and_a_spot_can_always_be_found():
    for size in SIZES:
        rm = lay.room(size)
        for item in FURNITURE:
            e = lay.place_near(size, [], item, near=(0.0, 0.0))
            assert e is not None, (size, item)
            lay.check(rm, e, [])


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def test_validate_accepts_a_good_layout_and_refuses_each_kind_of_mistake_calmly():
    owned = {"bookshelf", "two_seat_sofa", "woven_rug", "skyline_print", "desk_setup", "crystal_chandelier"}

    def v(items, size="studio", budget=8):
        return lay.validate(size, items, budget=budget, owned=owned)

    ok = v([floor("bookshelf", -0.45, -1.8), floor("two_seat_sofa", 1.2, 0.6), floor("woven_rug", 1.2, 0.9),
            wall("skyline_print", "n", 0.15, 1.3)])
    assert [e["id"] for e in ok] == ["bookshelf", "two_seat_sofa", "woven_rug", "skyline_print"]       # the rug lies under the sofa
    assert v([]) == []

    def refuse(items, code, size="studio", budget=8):
        with pytest.raises(lay.LayoutError) as err:
            v(items, size, budget)
        assert err.value.code == code, (err.value.code, err.value.hint)
        assert not game.has_banned_words(err.value.hint)
        return err.value

    assert refuse([floor("bookshelf", 0, 0), floor("bookshelf", 1.5, 0)], "duplicate").index == 1
    assert refuse([floor("typewriter", 0, 0)], "not_owned").hint == "You do not have Typewriter yet."
    assert refuse([floor("ghost", 0, 0)], "unknown_item").index == 0
    assert refuse([floor("bookshelf", 0, 0), floor("two_seat_sofa", 0.3, 0.1)], "taken").hint == "That spot's taken."
    assert refuse([floor("bookshelf", 4.9, 0)], "out_of_bounds").index == 0                       # out through the right edge
    assert refuse([floor("bookshelf", 0, -2.4)], "out_of_bounds")                                  # through the window wall
    assert refuse([floor("bookshelf", -2.0, 1.2)], "taken")                                        # on the kitchenette
    assert refuse([floor("bookshelf", -1.7, -0.9)], "taken")                                       # on the bed
    assert refuse([wall("skyline_print", "n", 0.5, 1.3)], "window")                                # on the window
    assert refuse([wall("skyline_print", "n", 0.05, 1.3)], "out_of_bounds")                        # half off the wall
    assert refuse([wall("skyline_print", "n", 0.15, 2.6)], "out_of_bounds")                        # through the ceiling
    assert refuse([wall("skyline_print", "s", 0.5, 1.3)], "bad_wall")                              # the front wall is cut away
    assert refuse([wall("skyline_print", "n", 0.15, 1.3), wall("desk_setup", "n", 0.2, 1.3)], "wrong_surface").index == 1
    assert refuse([{"id": "skyline_print", "surface": "floor", "x": 0, "z": 0, "ry": 0}], "wrong_surface")
    assert refuse([floor("bookshelf", float("nan"), 0)], "bad_position")
    assert refuse("nope", "bad_layout")
    over = refuse([floor("bookshelf", -0.45, -1.8)] * 2, "over_budget", budget=1)
    assert over.hint == "Your studio fits 1 things." or "fits 1" in over.hint
    two = refuse([wall("skyline_print", "n", 0.15, 1.3), wall("skyline_print", "n", 0.2, 1.3)], "duplicate")
    assert two.index == 1
    # two different pictures on the same stretch of wall collide, a tall piece against the wall hides a low picture
    owned.update({"postcard_board", "library_wall"})
    refuse([wall("skyline_print", "n", 0.15, 1.3), wall("postcard_board", "n", 0.2, 1.4)], "taken")
    refuse([floor("bookshelf", -1.0, -1.82), wall("skyline_print", "n", 0.28, 1.3)], "taken", size="studio")


def test_rugs_and_hanging_lights_only_collide_with_their_own_kind():
    owned = {"woven_rug", "silk_rug", "crystal_chandelier", "two_seat_sofa", "bookshelf"}
    lay.validate("loft", [floor("woven_rug", 0, -1), floor("crystal_chandelier", 0, -1), floor("two_seat_sofa", 0, -1)], budget=16, owned=owned)
    with pytest.raises(lay.LayoutError) as err:
        lay.validate("loft", [floor("woven_rug", 0, -1), floor("silk_rug", 0.5, -0.8)], budget=16, owned=owned)
    assert err.value.code == "taken"
    # a turn changes the footprint: a sofa turned a quarter swaps its width and depth
    lay.validate("loft", [floor("two_seat_sofa", 0, -1, 0), floor("bookshelf", 1.6, -1, 0)], budget=16, owned=owned)
    with pytest.raises(lay.LayoutError):
        lay.validate("loft", [floor("two_seat_sofa", 0, -1, math.pi / 2), floor("bookshelf", 0.6, -1, 0)], budget=16, owned=owned)


def test_wall_pieces_use_the_one_bedroom_partition_and_the_left_wall_but_not_a_kitchen():
    owned = {"skyline_print", "oil_painting", "postcard_board"}
    lay.validate("1-bed", [wall("skyline_print", "p", 0.2, 1.3), wall("oil_painting", "w", 0.3, 1.15)], budget=12, owned=owned)
    with pytest.raises(lay.LayoutError) as err:       # the door in the partition
        lay.validate("1-bed", [wall("skyline_print", "p", 0.7, 1.3)], budget=12, owned=owned)
    assert err.value.code == "window"
    with pytest.raises(lay.LayoutError) as err:       # the studio's left wall is the kitchenette
        lay.validate("studio", [wall("skyline_print", "w", 0.8, 1.3)], budget=8, owned=owned)
    assert err.value.code == "window"
    with pytest.raises(lay.LayoutError):              # the 1-bed has no wall "p" in a studio
        lay.validate("studio", [wall("skyline_print", "p", 0.5, 1.3)], budget=8, owned=owned)
    with pytest.raises(lay.LayoutError):              # the penthouse's back wall is glass
        lay.validate("penthouse", [wall("skyline_print", "n", 0.5, 1.3)], budget=24, owned=owned)


# --------------------------------------------------------------------------
# The one-time move from the old fixed slots
# --------------------------------------------------------------------------

def test_the_old_slots_become_layout_positions_once_and_the_old_choice_is_left_alone(conn):
    own(conn, "bookshelf", "skyline_print", "woven_rug", "record_player")
    conn.execute("INSERT INTO econ_choice(key, value, updated_utc) VALUES ('placed', ?, '2026-10-06T00:00:00Z')",
                 (json.dumps(["bookshelf", "skyline_print", None, "woven_rug"]),))        # slot 0 bookshelf, 1 print, 3 rug (studio)
    s = economy.economy_state(conn, today=D(7), now=NOON(D(7)))
    items = {x["id"]: x for x in s["home"]["layout"]["items"]}
    assert set(items) == {"bookshelf", "skyline_print", "woven_rug"} and [x["item"] for x in s["storage"]] == ["record_player"]
    # slot 1 is a wall slot at the back wall (x = -0.45 of 5 m): the print hangs there; the rug lies in front of slot 3 (0.35, 0.35)
    assert items["skyline_print"]["wall"] == "n" and items["skyline_print"]["u"] == pytest.approx((-0.45 + 2.5) / 5, abs=1e-3)
    assert items["woven_rug"]["x"] == pytest.approx(0.35) and items["woven_rug"]["z"] == pytest.approx(0.55)
    assert lay.slot_of("studio", lay.normalize(items["woven_rug"])) == 3
    # the bookshelf (0.95 wide) fits slot 0 only roughly at the corner; whatever happened it is now a valid place
    lay.validate("studio", [{k: v for k, v in x.items() if k in ("id", "surface", "x", "z", "ry", "wall", "u", "y")} for x in items.values()],
                 budget=8, owned={"bookshelf", "skyline_print", "woven_rug", "record_player"})
    before = json.loads(conn.execute("SELECT value FROM econ_choice WHERE key = 'layout'").fetchone()["value"])
    again = economy.economy_state(conn, today=D(7), now=NOON(D(7)))
    assert json.loads(conn.execute("SELECT value FROM econ_choice WHERE key = 'layout'").fetchone()["value"]) == before     # once only
    assert again["home"]["layout"]["items"] == s["home"]["layout"]["items"]
    assert json.loads(conn.execute("SELECT value FROM econ_choice WHERE key = 'placed'").fetchone()["value"]) == ["bookshelf", "skyline_print", None, "woven_rug"]


def test_every_old_slot_arrangement_migrates_to_a_valid_layout_without_losing_anything():
    """All furniture in all slots of every size: whatever does not fit its slot is moved to the nearest free spot, none disappears."""
    pool = [i["id"] for i in cat.FURNITURE]
    for size in SIZES:
        n = lay.room(size)["slots"].__len__()
        for offset in range(0, len(pool), 3):
            placed = [pool[(offset + k) % len(pool)] for k in range(n)]
            items, left = lay.migrate_slots(size, placed)
            assert len(items) + len(left) == len(set(placed)), (size, offset)
            assert not left, (size, offset, left)
            lay.validate(size, items, budget=cat.BUDGETS[size], owned=set(placed))


def test_a_piece_that_fits_its_slot_keeps_the_exact_old_place():
    items, left = lay.migrate_slots("studio", [None, None, None, "reading_lamp"])
    e = items[0]
    sl = lay.ROOMS["studio"]["slots"][3]
    assert not left and lay.slot_of("studio", e) == 3
    # the lamp's own origin (its anchor) is where the old room view drew it
    assert (e["x"] - 0.21 * math.cos(sl["ry"]) - 0.35 * math.sin(sl["ry"]), e["z"] + 0.21 * math.sin(sl["ry"]) - 0.35 * math.cos(sl["ry"])) == pytest.approx((sl["x"], sl["z"]), abs=0.01)


# --------------------------------------------------------------------------
# Buying, equipping, budgets and downsizing
# --------------------------------------------------------------------------

def test_new_furniture_lands_in_a_valid_free_place_until_the_budget_is_full(conn):
    fund(conn, 20000)
    day, now = D(7), NOON(D(7))
    got = []
    for item in ("desk_setup", "bookshelf", "two_seat_sofa", "woven_rug", "skyline_print", "reading_lamp", "trailing_plant", "record_player",
                 "upright_piano"):
        q = economy.buy(conn, item, today=day, now=now)["quote"]
        got.append(economy.buy(conn, item, q["price"], q["token"], today=day, now=now))
    assert [g["stored"] for g in got] == [False] * 8 + [True]                           # the studio holds 8 things
    s = economy.economy_state(conn, today=day, now=now)
    placed = s["home"]["layout"]["items"]
    assert len(placed) == 8 == s["home"]["used"] and s["home"]["layout"]["message"] == "8 of 8 places used"
    assert [x["item"] for x in s["storage"]] == ["upright_piano"]
    lay.validate("studio", [{k: v for k, v in x.items() if k in ("id", "surface", "x", "z", "ry", "wall", "u", "y")} for x in placed],
                 budget=8, owned=set(s["owned"]["furniture"]))


def test_downsizing_keeps_what_fits_and_stores_the_rest_and_a_bigger_home_brings_it_back(conn):
    set_level(conn)
    fund(conn, 6000)
    day, now = D(7), NOON(D(7))
    quote = economy.move_home(conn, "chelsea-corner", today=day, now=now)["quote"]
    economy.move_home(conn, "chelsea-corner", quote["token"], today=day, now=now)
    ids = ["desk_setup", "bookshelf", "two_seat_sofa", "woven_rug", "skyline_print", "reading_lamp", "trailing_plant", "record_player",
           "reading_armchair", "fiddle_fig", "postcard_board", "espresso_corner"]
    for item in ids:
        qq = economy.buy(conn, item, today=day, now=now)["quote"]
        economy.buy(conn, item, qq["price"], qq["token"], today=day, now=now)
    s = economy.economy_state(conn, today=day, now=now)
    assert s["home"]["id"] == "chelsea-corner" and s["home"]["used"] == 12 and s["home"]["budget"] == 16
    q2 = economy.move_home(conn, "morningside-studio", today=day, now=now)["quote"]
    moved = economy.move_home(conn, "morningside-studio", q2["token"], today=day, now=now)
    assert moved["stored"] == 4                                                         # 12 pieces, the studio holds 8
    down = economy.economy_state(conn, today=day, now=now)
    assert down["home"]["used"] == 8 and len(down["storage"]) == 4
    assert set(down["owned"]["furniture"]) == set(ids)                                   # nothing is lost
    lay.validate("studio", [{k: v for k, v in x.items() if k in ("id", "surface", "x", "z", "ry", "wall", "u", "y")} for x in down["home"]["layout"]["items"]],
                 budget=8, owned=set(ids))
    q3 = economy.move_home(conn, "chelsea-corner", today=day, now=now)["quote"]
    back = economy.move_home(conn, "chelsea-corner", q3["token"], today=day, now=now)
    assert back["stored"] == 0
    up = economy.economy_state(conn, today=day, now=now)
    assert up["home"]["used"] == 12 and up["storage"] == []


# --------------------------------------------------------------------------
# GET / POST /api/home/layout
# --------------------------------------------------------------------------

def fund_path(path, dollars):
    with db.get_conn(path) as conn:
        fund(conn, dollars)


def test_layout_api_get_shape_and_a_saved_layout_survives_a_reload(owner, v2_state):
    fund_path(v2_state.db_path, 3000)
    for item in ("bookshelf", "two_seat_sofa", "skyline_print"):
        q = owner.post("/api/shop/buy", json={"item": item}).json()["quote"]
        assert owner.post("/api/shop/buy", json={"item": item, "price": q["price"], "token": q["token"]}).json()["bought"]
    body = owner.get("/api/home/layout").json()
    assert body["ok"] and body["v"] == 1 and body["home"]["budget"] == 8 and body["home"]["used"] == 3
    assert body["room"]["W"] == 5 and body["room"]["grid"] == 0.25 and set(body["room"]["walls"]) == {"n", "w"}
    assert body["message"] == "3 of 8 places used" and body["capacity_text"] == "Your studio fits 8 things. 3 are out."
    assert set(body["catalog"]) == {"bookshelf", "two_seat_sofa", "skyline_print"}
    assert body["catalog"]["two_seat_sofa"]["size"] == [1.7, 0.9, 0.88] and body["catalog"]["two_seat_sofa"]["activity"] == "read"
    new = [{"id": "bookshelf", "surface": "floor", "x": -0.5, "z": -1.8, "ry": 0}, {"id": "two_seat_sofa", "x": 1.0, "z": 0.75, "ry": 0.0},
           {"id": "skyline_print", "surface": "wall", "wall": "n", "u": 0.15, "y": 1.3}]
    saved = owner.post("/api/home/layout", json={"items": new}).json()
    assert saved["ok"] and saved["saved"] is True and saved["home"]["used"] == 3 and saved["storage"] == []
    again = owner.get("/api/home/layout").json()
    assert {x["id"]: (x.get("x"), x.get("z")) for x in again["items"]} == {"bookshelf": (-0.5, -1.8), "two_seat_sofa": (1.0, 0.75), "skyline_print": (None, None)}
    # leaving a piece out sends it to storage, and the Money API sees the same room
    owner.post("/api/home/layout", json={"items": new[:1]})
    eco = owner.get("/api/economy").json()
    assert eco["home"]["used"] == 1 and {x["item"] for x in eco["storage"]} == {"two_seat_sofa", "skyline_print"}


def test_layout_api_refuses_calmly_and_changes_nothing(owner, v2_state):
    fund_path(v2_state.db_path, 3000)
    for item in ("bookshelf", "two_seat_sofa"):
        q = owner.post("/api/shop/buy", json={"item": item}).json()["quote"]
        owner.post("/api/shop/buy", json={"item": item, "price": q["price"], "token": q["token"]})
    good = [{"id": "bookshelf", "x": -0.5, "z": -1.8, "ry": 0}]
    assert owner.post("/api/home/layout", json={"items": good}).json()["ok"]
    bad = owner.post("/api/home/layout", json={"items": [{"id": "bookshelf", "x": -0.5, "z": -1.8, "ry": 0}, {"id": "two_seat_sofa", "x": -0.4, "z": -1.3, "ry": 0}]}).json()
    assert bad == {"ok": False, "code": "taken", "hint": "That spot's taken.", "index": 1, "item": "two_seat_sofa"}
    assert owner.post("/api/home/layout", json={"items": [{"id": "bookshelf", "x": 40, "z": 0, "ry": 0}]}).json()["code"] == "out_of_bounds"
    assert owner.post("/api/home/layout", json={"items": [{"id": "typewriter", "x": 0, "z": 0}]}).json()["code"] == "not_owned"
    assert owner.post("/api/home/layout", json={"items": "nope"}).json()["code"] == "bad_layout"
    assert owner.post("/api/home/layout", json={}).json()["code"] == "bad_layout"
    assert [x["id"] for x in owner.get("/api/home/layout").json()["items"]] == ["bookshelf"]        # the good layout stands


def test_layout_state_creates_no_money_and_quiet_mode_is_a_flag(conn):
    before = conn.execute("SELECT COUNT(*) FROM econ_ledger").fetchone()[0]
    out = economy.layout_state(conn, today=D(7), now=NOON(D(7)))
    assert out["quiet"] is False and out["items"] == [] and out["storage"] == []
    assert conn.execute("SELECT COUNT(*) FROM econ_ledger").fetchone()[0] == before


# --------------------------------------------------------------------------
# What a piece unlocks for the character
# --------------------------------------------------------------------------

def test_an_owned_and_placed_piece_unlocks_its_activity_and_storing_it_takes_it_away(conn):
    fund(conn, 9000)
    day, now = D(7), NOON(D(7))

    def hint():
        return economy.economy_state(conn, today=day, now=now)["character"]["activity_hint"]

    base = hint()
    assert base["macro"] == "home" and base["activities"] == ["look_outside", "make_tea", "sleep"]          # the studio kitchenette is free
    assert [d["id"] for d in base["detail"] if d["night_only"]] == ["sleep"]
    for item in ("record_player", "brass_telescope", "two_seat_sofa"):
        q = economy.buy(conn, item, today=day, now=now)["quote"]
        economy.buy(conn, item, q["price"], q["token"], today=day, now=now)
    got = hint()
    assert {"play_records", "stargaze", "read"} <= set(got["activities"])
    by = {d["id"]: d for d in got["detail"]}
    assert by["play_records"]["from"] == ["record_player"] and by["stargaze"]["night_only"] is True and by["play_records"]["free"] is False
    assert cat.ACTIVITIES["stargaze"]["line"].endswith("after dark.")
    economy.equip(conn, "furniture", "record_player", False)                                   # in storage: owned, not placed
    assert "play_records" not in hint()["activities"]
    # the store card says what a piece will let the character do
    shop = economy.shop_state(conn, today=day, now=now)
    card = next(i for a in shop["aisles"] for i in a["items"] if i["id"] == "upright_piano")
    assert card["activity"] == "play_piano" and card["activity_line"] == "Your character will play the piano here."
    assert card["size"] == [1.5, 1.4, 1.3] and card["surface"] == "floor" and card["slot"] is None and card["in_room"] is False
    rec = next(i for a in shop["aisles"] for i in a["items"] if i["id"] == "record_player")
    assert rec["in_room"] is False and rec["in_storage"] is True and rec["activity_line"] == "Your character will play records here."


def test_a_placed_floor_piece_reports_its_footprint_box(conn):
    own(conn, "bookshelf")
    economy.equip(conn, "furniture", "bookshelf", True)
    item = economy.layout_state(conn, today=D(7), now=NOON(D(7)))["items"][0]
    x0, x1, z0, z1 = item["box"]
    assert x1 - x0 == pytest.approx(0.95, abs=0.01) and z1 - z0 == pytest.approx(0.34, abs=0.01)
    assert (x0 + x1) / 2 == pytest.approx(item["x"], abs=0.01)
