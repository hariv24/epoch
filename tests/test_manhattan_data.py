"""Shape checks for the generated Manhattan dataset (scripts/build_manhattan.mjs -> static/app/city/manhattan/).

These read the committed output only; they never touch the network or the raw build/ downloads.
"""
from __future__ import annotations

import json
import struct
from array import array
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app" / "city" / "manhattan"
pytestmark = pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="Manhattan data not built")

HEADER = struct.Struct("<4sHHiiffffffIIIIII")  # 64 bytes, see scripts/manhattan/pack.mjs


@pytest.fixture(scope="module")
def manifest():
    return json.loads((DATA / "manifest.json").read_text())


def read_tile(rel):
    raw = (DATA / rel).read_bytes()
    h = HEADER.unpack_from(raw, 0)
    keys = ("magic version lod tx tz ox oz ps pad ys yo nv ni nb nc chunk_off b_off").split()
    return raw, dict(zip(keys, h))


def test_manifest_shape(manifest):
    assert manifest["name"] == "Manhattan" and manifest["version"] == 2
    f = manifest["frame"]
    assert f["origin"]["lat"] == pytest.approx(40.7589, abs=1e-3)
    assert f["gridRotationDeg"] == 29
    assert manifest["tile"]["magic"] == "MNTL" and manifest["tile"]["size"] == 1500
    assert [x["lod"] for x in manifest["lods"]] == [0, 1, 2]
    assert manifest["attribution"] and "NYC Open Data" in manifest["attributionShort"]
    for key in ("land", "parks", "streets", "neighborhoods", "terrain", "notables", "home", "homeBuildings"):
        assert (DATA / manifest["files"][key]).exists(), key


def test_budget_and_counts(manifest):
    lod = manifest["totals"]["lod"]
    assert lod["0"]["bytes"] <= 25_000_000, "LOD0 must stay within the 25 MB budget"
    assert lod["1"]["bytes"] < lod["0"]["bytes"] / 2 and lod["2"]["bytes"] < lod["1"]["bytes"] / 3
    t = manifest["totals"]
    assert t["buildingsInWorldTiles"] + t["homeLotBuildings"] == t["buildingsInSource"]
    assert lod["0"]["buildings"] > 40_000  # essentially every Manhattan building
    assert lod["0"]["tris"] > 1_000_000


def test_tiles_match_manifest_and_decode(manifest):
    seen = 0
    for tile in manifest["tiles"]:
        for lod, entry in tile["lods"].items():
            raw, h = read_tile(entry["file"])
            assert len(raw) == entry["bytes"]
            assert h["magic"] == b"MNTL" and h["version"] == 2 and h["lod"] == int(lod)
            assert (h["tx"], h["tz"]) == (tile["x"], tile["z"])
            assert (h["nv"], h["ni"] // 3, h["nb"]) == (entry["verts"], entry["tris"], entry["buildings"])
            # chunks: u16 indices relative to the chunk, every index inside it, ranges contiguous
            chunks = [struct.unpack_from("<IIII", raw, h["chunk_off"] + 16 * c) for c in range(h["nc"])]
            assert sum(c[3] for c in chunks) == h["ni"] and sum(c[1] for c in chunks) == h["nv"]
            idx_off = 64 + ((h["nv"] * 6 + 3) & ~3)
            idx = array("H")
            idx.frombytes(raw[idx_off : idx_off + h["ni"] * 2])
            for v_first, v_count, i_first, i_count in chunks:
                assert v_count <= 65535
                assert max(idx[i_first : i_first + i_count]) < v_count
            seen += 1
    assert seen >= 100


def test_building_table_of_one_tile(manifest):
    entry = next(t for t in manifest["tiles"] if t["x"] == 0 and t["z"] == 0)["lods"]["0"]  # Times Square / Midtown
    raw, h = read_tile(entry["file"])
    rows = [struct.unpack_from("<IffIIIIhhHBBBBH", raw, h["b_off"] + 40 * i) for i in range(h["nb"])]
    assert h["nb"] > 500
    heights = [r[2] for r in rows]
    assert max(heights) > 150 and min(heights) > 0
    assert all(1850 <= r[9] <= 2030 or r[9] == 0 for r in rows)  # construction years


def _slots(home):
    return [s for w in home["weeks"] for s in w["slots"]]


def test_home_block_year_of_lots(manifest):
    """home.json v2: a year of permanent lots, one per day since Day 1, a row of 7 touching lots per Monday-to-Sunday week."""
    from datetime import date, timedelta

    from epoch import game

    home = json.loads((DATA / "home.json").read_text())
    assert home["version"] == 2 and home["dayOne"] == "2026-10-18" and home["firstMonday"] == "2026-10-12"
    slots = _slots(home)
    assert home["slotCount"] == len(slots) == game.YEAR_SLOTS == 365
    assert len(home["weeks"]) == home["rows"] == game.year_rows(365, date(2026, 10, 18).weekday()) == 53
    # slot n is the n-th lot, its date is Day 1 + n, and its row/weekday are the Today week strip's (Monday = 0)
    assert [s["n"] for s in slots] == list(range(365))
    day_one = date.fromisoformat(home["dayOne"])
    for w in home["weeks"]:
        assert date.fromisoformat(w["monday"]).weekday() == 0
        for s in w["slots"]:
            d = day_one + timedelta(days=s["n"])
            assert s["date"] == d.isoformat() and s["wd"] == d.weekday()
            assert game.year_slot(day_one, d) == {"n": s["n"], "week": w["row"], "wd": s["wd"], "lot": True}
    # Day 1 is a Sunday, so its row holds that day alone; every other row is a full Monday-to-Sunday week
    assert [s["wd"] for s in home["weeks"][0]["slots"]] == [6]
    assert all([s["wd"] for s in w["slots"]] == list(range(7)) for w in home["weeks"][1:])
    # real tax lots, never repeated, in two adjacent neighbourhoods (Morningside Heights, then the northern Upper West Side)
    assert len({s["bbl"] for s in slots}) == len({s["bin"] for s in slots}) == 365
    assert [n["code"] for n in home["neighborhoods"]] == ["MN0901", "MN0703"]
    assert {s["nta"] for s in slots} == {"MN0901", "MN0703"}
    assert [w["nta"] for w in home["weeks"]] == sorted((w["nta"] for w in home["weeks"]), key=["MN0901", "MN0703"].index)   # Morningside first
    for s in slots:
        assert len(s["footprint"]) >= 6 and s["areaM2"] > 60 and len(s["front"]) == 2
        assert abs(s["front"][0] ** 2 + s["front"][1] ** 2 - 1) < 1e-3                      # a unit vector toward the street
        assert set(s) >= {"n", "date", "wd", "bbl", "bin", "address", "x", "z", "baseY", "front", "footprint", "holes", "nta"}
    # each week's lots sit together: a row of 7 (consecutive lots no more than 60 m apart, the whole row within 350 m)
    for w in home["weeks"][1:]:
        sl = w["slots"]
        assert max(((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5 for a, b in zip(sl, sl[1:])) < 60
        assert max(((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5 for a in sl for b in sl) < 350
    # the walk starts near Low Library (the nearest residential lot) and goes through Morningside Heights first
    low = next(n for n in json.loads((DATA / "notables.json").read_text())["notables"] if n["id"] == "low-library")
    first = home["weeks"][0]["slots"][0]
    assert ((first["x"] - low["x"]) ** 2 + (first["z"] - low["z"]) ** 2) ** 0.5 < 400
    # Columbia, landmarks and houses of worship stay: no lot is an institution (campus box) and none is a landmark building
    notables = {n.get("bin") for n in json.loads((DATA / "notables.json").read_text())["notables"]}
    assert not ({s["bin"] for s in slots} & notables)
    # the real buildings of those lots are absent from the world tiles and present in the home file
    bins = {s["bin"] for s in slots}
    raw, h = read_tile(manifest["files"]["homeBuildings"])
    assert h["nb"] == len(slots)
    got = {struct.unpack_from("<I", raw, h["b_off"] + 40 * i)[0] for i in range(h["nb"])}
    assert got == bins
    for rel in (t["lods"][lod]["file"] for t in manifest["tiles"] for lod in t["lods"]):
        r2, h2 = read_tile(rel)
        have = {struct.unpack_from("<I", r2, h2["b_off"] + 40 * i)[0] for i in range(h2["nb"])}
        assert not (have & bins), rel


def test_notables(manifest):
    notables = {n["id"]: n for n in json.loads((DATA / "notables.json").read_text())["notables"]}
    for key in ("empire-state", "chrysler", "one-wtc", "flatiron", "times-square", "low-library", "butler-library",
                "brooklyn-bridge-manhattan", "washington-square-arch"):
        assert key in notables, key
    assert notables["empire-state"]["bin"] == 1015862 and notables["empire-state"]["heightM"] > 350
    assert notables["one-wtc"]["heightM"] > 400
    assert all(not n.get("unresolved") for n in notables.values())


def test_vector_layers(manifest):
    land = json.loads((DATA / "land.json").read_text())
    assert len(land["polys"]) >= 10 and len(land["polys"][0][0]) >= 6
    nta = json.loads((DATA / "nta.json").read_text())["neighborhoods"]
    assert len(nta) == 38 and any(n["code"] == "MN0901" and n["name"] == "Morningside Heights" for n in nta)
    streets = json.loads((DATA / "streets.json").read_text())
    assert streets["classes"] == ["street", "avenue", "highway", "bridge", "path"]
    assert len(streets["lines"]) > 1500 and "Broadway" in streets["names"]
    parks = json.loads((DATA / "parks.json").read_text())["parks"]
    assert any(p["n"] == "Central Park" for p in parks)
    raw = (DATA / manifest["files"]["terrain"]).read_bytes()
    assert raw[:4] == b"MTRN"
    nx, nz = struct.unpack_from("<II", raw, 20)
    assert len(raw) == 32 + nx * nz * 2
