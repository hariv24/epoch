"""World > City renders real Manhattan: the renderer-side data (scripts/manhattan/props.mjs, map_svg.mjs) and the City markup."""
from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from tests.test_web import client, clock, state  # noqa: F401  (the web app fixtures)

APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
DATA = APP / "city" / "manhattan"
pytestmark = pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="Manhattan data not built")


def test_inland_water_has_the_reservoir():
    lakes = json.loads((DATA / "hydro.json").read_text())["lakes"]
    names = {lake["n"] for lake in lakes}
    assert {"Reservoir", "The Lake", "Harlem Meer"} <= names
    reservoir = next(lake for lake in lakes if lake["n"] == "Reservoir")
    assert 300_000 < reservoir["a"] < 500_000  # about 106 acres
    assert all(len(lake["p"][0]) >= 6 for lake in lakes)


def test_roof_heights_grid():
    raw = (DATA / "heights.bin").read_bytes()
    magic, version = struct.unpack_from("<4sH", raw, 0)
    cell, ox, oz, nx, nz, unit = struct.unpack_from("<fffIIf", raw, 8)
    assert magic == b"MHGT" and version == 1 and cell == 20 and unit == pytest.approx(0.1)
    assert len(raw) == 32 + 2 * nx * nz
    heights = struct.unpack_from(f"<{nx * nz}h", raw, 32)
    assert max(heights) * 0.1 > 400  # One World Trade with its spire
    assert sum(1 for h in heights if h != -32768) > 50_000


def test_trees():
    raw = (DATA / "trees.bin").read_bytes()
    magic, version = struct.unpack_from("<4sH", raw, 0)
    count, street = struct.unpack_from("<II", raw, 8)
    assert magic == b"MTRE" and version == 1 and len(raw) == 16 + 8 * count
    # real street trees, thinned to about 4 in 10 so the streets read like Manhattan (scripts/manhattan/props.mjs), plus park trees
    assert 15_000 < street < 35_000 and count - street > 10_000


def test_fallback_map_svg():
    svg = (DATA / "map.svg").read_text()
    assert svg.startswith("<svg") and "Morningside Heights" in svg and "Central Park" in svg
    assert 'class="l" fill-rule="evenodd" d="M' in svg  # the land polygon is drawn


def test_city_view_routes_to_manhattan():
    city = (APP / "city.js").read_text()
    assert "createManhattan" in city and "'city'" in city
    js = (APP / "city" / "manhattan.js").read_text()
    for name in ("setUnlockedDistricts", "flyTo", "snapshot", "setDays", "prefers-reduced-motion"):
        assert name in js, name


def test_world_city_markup(client):
    html = client.get("/world").text
    for place in ("home", "columbia", "centralpark", "midtown", "timessquare", "downtown", "island"):
        assert f'data-city-fly="{place}"' in html, place
    assert "/static/app/city/manhattan/map.svg" in html
    assert "Map data: NYC Open Data" in html
    for view in ("top", "rotate", "reset"):
        assert f'data-city-view="{view}"' in html


def test_every_stage_is_real_manhattan():
    """The Today hero and the Focus Screen show the user's own Morningside block from the same data; only `legacy` keeps the old diorama."""
    city = (APP / "city.js").read_text()
    assert "createManhattan(host, { ...opts, mode: opts.mode === 'city' ? 'city' : 'week' })" in city and "opts.legacy" in city
    js = (APP / "city" / "manhattan.js").read_text()
    for name in ("const kind = opts.mode === 'week'", "weekFrame", "camFrame", "createConstruction", "createWeather", "createFlow",
                 "createSeasonal", "function focusConstruction", "function setConstruction", "function setSeasonal", "function setFlow", "function setLive"):
        assert name in js, name
    for stub in ("setSeasonal: () => []", "setFlow: () => {}", "setConstruction: () => {}", "focusConstruction: () => false"):
        assert stub not in js, stub                    # the live layers are wired, not no-ops


def test_framed_stages_keep_their_camera_rules():
    js = (APP / "city" / "manhattan.js").read_text()
    assert "controls.enablePan = false; controls.enableZoom = false" in js        # no free camera on the hero and the focus screen
    assert "touchAction = 'pan-y'" in js                                          # the page still scrolls under a finger
    assert "azHalf" in js and "clampAz" in js                                      # a gentle sway, never a full turn
    assert "tiles.preloadCoarse()" in js and "kind === 'cam' ? 450000 : 650000" in js   # only the tiles around the block, lightest on the focus screen
    for guard in ("prefers-reduced-motion", "document.hidden", "IntersectionObserver", "requestAnimationFrame"):
        assert guard in js, guard


def test_live_layer_modules_exist():
    flow = (APP / "city" / "mh_flow.js").read_text()
    assert "export function createFlow" in flow and "export function lampSites" in flow and "FLOW_LAMPS = 8" in flow
    seasonal = (APP / "city" / "mh_seasonal.js").read_text()
    for key in ("halloween", "diwali", "thanksgiving_week", "holiday_lights", "nye_ball_drop", "cherry_blossoms", "holi", "july_4th",
                "india_independence_day", "pride", "nyc_marathon"):
        assert f"B.{key}" in seasonal or f"{key}:" in seasonal or f"B.{key} " in seasonal, key
    assert "1085682" in (APP / "city" / "manhattan.js").read_text()               # the ball sits on the real One Times Square
    weather = (APP / "city" / "weather.js").read_text()
    assert "unit = 1" in weather and "bare" in weather and "setBase" in weather   # rain and snow scaled to metres
    construction = (APP / "city" / "construction.js").read_text()
    assert "place = null" in construction                                         # the crane stands in the real lot's own frame


def test_year_of_lots_front_end():
    home = (APP / "city" / "mh_home.js").read_text()
    assert "home.weeks" in home and "lots[n]" in home                             # slot n of the year is the n-th lot of home.json v2
    assert "(dn + 3) % SLOTS" not in home                                         # no more 28 recycled lots
    for state in ("future", "empty", "tower", "rest"):
        assert f"{state}:" in home                                                # a pad colour per state
    assert "addHoarding" in home and "stakeAt" in home                            # an empty lot: low hoarding and a survey stake
    app = (APP / "app.js").read_text()
    assert "slotsFor('year')" in app and "'all'" in app and "year-badge" in app   # the 3D scenes get the whole year; the badge says "Your year"
    assert "</svg>Last 28 days</span>" not in (APP.parent.parent / "templates" / "world.html").read_text()   # the city badge is "Your year · N towers"


def test_front_end_modules_parse():
    import shutil
    import subprocess

    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    for name in ("manhattan", "mh_tiles", "mh_home", "mh_dream", "mh_flow", "mh_seasonal", "weather", "particles", "construction", "mh_ground", "tower_model"):
        out = subprocess.run([node, "--check", str(APP / "city" / f"{name}.js")], capture_output=True, text=True)
        assert out.returncode == 0, (name, out.stderr[:300])
    out = subprocess.run([node, "--check", str(APP / "city.js")], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr[:300]
