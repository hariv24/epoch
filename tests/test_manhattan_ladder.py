"""The level ladder is a walk out from Morningside Heights across real Manhattan, ending at Billionaires' Row.

Covers the district ladder (names, order, unlock rules), what the 3D city is told to light (`districts` in /api/world),
the dream-home constant, the real-building landmarks, the copy (no Princeton, nothing outside Manhattan), and the hand-built
silhouettes of the Billionaires' Row towers in the Manhattan tile data.
"""
from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import pytest

from epoch import categories, game

APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
DATA = APP / "city" / "manhattan"
built = pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="Manhattan data not built")

LADDER = ["Morningside Heights", "Harlem", "Upper West Side", "Central Park", "Upper East Side", "Hell's Kitchen",
          "Midtown & Times Square", "Chelsea", "Flatiron & Gramercy", "Greenwich Village", "SoHo & Tribeca", "Lower East Side",
          "Financial District", "Upper Manhattan", "Billionaires' Row"]
OUTSIDE = re.compile(r"princeton|jfk|queens|brooklyn\b(?! bridge)|bronx|staten|new jersey|hoboken|courant|nyu", re.IGNORECASE)


def level_at(xp: int) -> int:
    return game.level_for(xp).number


class TestLadder:
    def test_order_and_names(self):
        assert [d[2] for d in game.DISTRICTS] == LADDER
        assert game.DISTRICTS[0][:2] == (1, 2)                       # home is Level 1: lit from the first day
        firsts = [d[0] for d in game.DISTRICTS]
        assert firsts == sorted(firsts) and len(set(firsts)) == len(firsts)
        for (_, last, _, _), (nxt, _, _, _) in zip(game.DISTRICTS, game.DISTRICTS[1:]):
            assert nxt == last + 1                                   # no gap and no overlap between districts

    def test_last_level_is_billionaires_row_the_crown(self):
        first, last, name, _ = game.DISTRICTS[-1]
        assert name == "Billionaires' Row" == game.FINAL_DISTRICT
        assert last >= 10 ** 6                                       # open ended: the highest XP threshold of all
        assert first == max(d[0] for d in game.DISTRICTS)
        assert game.district_for(first) == game.district_for(first + 50) == name
        assert game.district_for(first - 1) == "Upper Manhattan"

    def test_nothing_outside_manhattan_and_no_princeton(self):
        texts = [d[2] for d in game.DISTRICTS]
        for meta in game.DISTRICT_META.values():
            texts.append(meta["arrival"])
        for card in game.DISTRICT_CARDS.values():
            texts += [card["title"], card["caption"]]
        texts += [v for v in game.DREAM_HOME.values() if isinstance(v, str)]
        bad = [t for t in texts if OUTSIDE.search(t)]
        assert not bad, bad

    def test_xp_curve_and_existing_xp_are_untouched(self):
        assert [game._cum_xp(n) for n in (1, 2, 5, 10, 20, 30)] == [0, 200, 1100, 3600, 12350, 26100]
        # a user who had this much XP before keeps it: only the name of the district changes
        assert game.level_for(6668).number == 14 and game.level_for(6668).district == "Midtown & Times Square"
        assert game.level_for(game._cum_xp(29)).district == "Billionaires' Row"
        assert game.level_for(game._cum_xp(29) - 1).district == "Upper Manhattan"

    def test_every_district_has_arrival_copy_and_a_postcard_but_home(self):
        for _, _, name, _ in game.DISTRICTS:
            assert game.DISTRICT_META[name]["arrival"]
            assert game.district_id(name) == game.DISTRICT_META[name]["id"]
        for _, _, name, _ in game.DISTRICTS[1:]:
            assert name in game.DISTRICT_CARDS


class TestWhatTheCityLights:
    def test_billionaires_row_stays_locked_below_the_last_level(self):
        crown = game.DISTRICTS[-1][0]
        for lvl in (1, 14, 20, crown - 1):                           # Midtown and then the whole island are open, the row is not
            block = game.districts_block(lvl)
            assert game.BROW_REGION not in block["unlocked"], lvl
            assert block["all_lit"] is False and block["dream_home"]["lit"] is False
            row = next(d for d in block["list"] if d["id"] == "billionaires-row")
            assert row["unlocked"] is False
        block = game.districts_block(crown)
        assert game.BROW_REGION in block["unlocked"] and block["all_lit"] is True and block["dream_home"]["lit"] is True

    def test_midtown_open_still_leaves_the_corridor_in_mist(self):
        midtown = next(d[0] for d in game.DISTRICTS if d[2] == "Midtown & Times Square")
        lit = game.districts_block(midtown)["unlocked"]
        assert {"MN0502", "MN0604", "MN0661"} <= set(lit) and game.BROW_REGION not in lit

    def test_unlock_order_grows_outward_from_home(self):
        previous: list[str] = []
        for lvl in range(1, 32):
            lit = game.districts_block(lvl)["unlocked"]
            assert lit[:len(previous)] == previous                   # only ever adds: nothing locks again
            previous = lit
        assert game.districts_block(1)["unlocked"] == ["MN0901"]     # Morningside Heights: the block and Columbia
        assert game.districts_block(1)["current"] == "morningside-heights"
        assert game.districts_block(1)["next"] == {"id": "harlem", "name": "Harlem", "level": 3}

    @built
    def test_districts_cover_every_manhattan_neighbourhood_exactly_once(self):
        codes = [n["code"] for n in json.loads((DATA / "nta.json").read_text())["neighborhoods"]]
        mapped = [c for meta in game.DISTRICT_META.values() for c in meta["ntas"]]
        assert sorted(mapped) == sorted(codes) and len(codes) == 38
        # the island is lit by the second to last district; the row is lit by nothing but its own level
        assert set(game.districts_block(28)["unlocked"]) == set(codes)

    def test_world_payload_carries_the_districts_and_the_dream_home(self, conn):
        w = game.world_state(conn)
        d = w["districts"]
        assert d["current"] == "morningside-heights" and d["unlocked"] == ["MN0901"]
        assert d["final"] == {"id": "billionaires-row", "name": "Billionaires' Row", "level": game.DISTRICTS[-1][0]}
        assert d["dream_home"]["bin"] == game.DREAM_HOME_BIN and d["dream_home"]["lit"] is False
        assert w["level"]["district"] == "Morningside Heights"


class TestDreamHome:
    def test_one_constant_names_the_home(self):
        assert game.DREAM_HOME["bin"] == game.DREAM_HOME_BIN == 1090180
        assert "Central Park Tower" in game.DREAM_HOME["name"]
        assert len(re.findall(r"DREAM_HOME_BIN\s*=", Path(game.__file__).read_text())) == 1

    def test_copy_is_warm_and_clean(self):
        for key in ("locked", "locked_sub", "unlocked", "unlocked_sub"):
            text = game.DREAM_HOME[key]
            assert text and not game.has_banned_words(text) and not OUTSIDE.search(text)
        assert "clouds" in game.DREAM_HOME["locked"].lower()
        assert "park" in game.DREAM_HOME["unlocked"].lower()

    @built
    def test_the_home_is_a_tower_the_renderer_can_light(self):
        brow = json.loads((DATA / "brow.json").read_text())
        tower = next((t for t in brow["towers"] if t["bin"] == game.DREAM_HOME_BIN), None)
        assert tower and tower["heightM"] > 450 and tower["band"] and tower["band"]["seg"]      # a penthouse band to light
        assert {t["bin"] for t in brow["towers"]} >= {1090180, 1023728, 1088565, 1088817}      # the other candidates for a later change
        # the corridor is a small district of its own: W 57th St / Central Park South, about 8th Avenue to Park Avenue
        poly = brow["region"]["poly"]
        assert brow["region"]["id"] == game.BROW_REGION and len(poly) == 8
        w, h = brow["region"]["u"][1] - brow["region"]["u"][0], brow["region"]["v"][1] - brow["region"]["v"][0]
        assert 1000 < w < 1500 and 200 < h < 400

    def test_the_client_has_a_home_view_and_a_pose_outside_the_facade(self):
        js = (APP / "city" / "mh_dream.js").read_text()
        assert "function pose()" in js and "looking north" in js.lower() or "toward morningside" in js.lower()
        city = (APP / "city" / "manhattan.js").read_text()
        assert "flyTo(name" in city and "setDreamHome" in city and "'dream'" in city
        assert "dream" in (APP.parent.parent / "templates" / "world.html").read_text()


class TestLandmarks:
    def test_every_ladder_lights_a_real_building(self):
        assert set(game.LADDER_LANDMARKS) == set(categories.LADDER) == set(game.LADDER_INFO)
        assert game.LADDER_LANDMARKS["Python"]["bin"] is None and game.LADDER_LANDMARKS["Python"]["site"] == "brooklyn-bridge"
        bins = [v["bin"] for k, v in game.LADDER_LANDMARKS.items() if k != "Python"]
        assert len(set(bins)) == 4 and all(isinstance(b, int) for b in bins)
        assert game.LADDER_LANDMARKS["Math"]["bin"] == 1015862 and game.LADDER_LANDMARKS["ML/DL"]["bin"] == 1036156
        assert game.LADDER_LANDMARKS["Papers"]["bin"] == 1082165                 # Butler Library, Columbia's own

    @built
    def test_the_landmark_buildings_exist_in_the_data(self):
        notables = {n["bin"]: n for n in json.loads((DATA / "notables.json").read_text())["notables"] if n.get("bin")}
        for ladder, info in game.LADDER_LANDMARKS.items():
            if info["bin"]:
                assert info["bin"] in notables, ladder
        assert notables[1082165]["nta"] == "MN0901"                              # Butler Library stands in the home district

    def test_world_payload_names_the_building_for_every_ladder(self, conn):
        marks = {m["ladder"]: m for m in game.world_state(conn)["landmarks"]}
        assert set(marks) == set(categories.LADDER)
        for ladder, m in marks.items():
            assert m["bin"] == game.LADDER_LANDMARKS[ladder]["bin"] and m["sections"] == 0 and m["light"]


def _tile_records():
    """(bin, height, style, flags, triangles) of every building in every LOD0 tile ('MNTL' v2)."""
    man = json.loads((DATA / "manifest.json").read_text())
    for t in man["tiles"]:
        e = (t.get("lods") or {}).get("0")
        if not e:
            continue
        raw = (DATA / e["file"]).read_bytes()
        nb, boff = struct.unpack_from("<II", raw, 48)[0], struct.unpack_from("<I", raw, 60)[0]
        for i in range(nb):
            p = boff + 40 * i
            bin_, _base, h, _iF, iC = struct.unpack_from("<IffII", raw, p)
            style, flags = struct.unpack_from("<BB", raw, p + 34)
            yield bin_, h, style, flags, iC // 3


@pytest.fixture(scope="module")
def towers():
    want = {1090180, 1023728, 1088565, 1090184, 1088817, 1035787}
    return {r[0]: r for r in _tile_records() if r[0] in want}


@built
class TestBillionairesRowSilhouettes:

    def test_the_five_towers_are_there_at_their_real_heights(self, towers):
        assert 465 < towers[1090180][1] < 480            # Central Park Tower, 472 m
        assert 430 < towers[1023728][1] < 440            # 111 W 57th, 435 m
        assert 300 < towers[1088565][1] < 315            # One57
        assert 285 < towers[1090184][1] < 295            # 220 Central Park South
        assert 420 < towers[1088817][1] < 430            # 432 Park Avenue

    def test_they_are_stacks_of_setbacks_not_plain_slabs(self, towers):
        for bin_ in (1090180, 1023728, 1090184, 1088565):
            assert towers[bin_][3] & 8, bin_                                       # flagged TIERED
            assert towers[bin_][4] > 60, (bin_, towers[bin_][4])                  # far more than a prism's dozen triangles
        assert towers[1023728][4] >= towers[1090180][4] > 60                      # the Steinway Tower feathers down in the most steps

    def test_each_has_the_look_of_its_own(self, towers):
        assert towers[1090180][2] == 13 and towers[1088565][2] == 13              # glass
        assert towers[1023728][2] == 14                                           # terracotta and bronze ribs
        assert towers[1090184][2] == 16                                           # limestone
        assert towers[1088817][2] == 15                                           # the pale square grid
        shader = (APP / "city" / "mh_tiles.js").read_text()
        assert "steinway_terracotta: 14, park_grid: 15, cps_limestone: 16" in shader

    def test_432_park_is_one_tower_not_two(self, towers):
        assert towers[1035787][1] < 30                   # the thin strip record is flattened into the base
        assert sum(1 for r in _tile_records() if 1000 < r[0] and r[1] > 400 and r[0] in (1035787, 1088817)) == 1
