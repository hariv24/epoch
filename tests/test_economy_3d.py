"""The economy in 3D (docs/ECONOMY.md): the faceless figure and its outfits (city/character.js), the cutaway room with a model for every
furniture item (city/room.js), the tower upgrades and the gold three-star crowns (city/tower_model.js, city/mh_home.js), and the app hooks."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from epoch import economy_catalog as cat

APP = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static" / "app"
CITY = APP / "city"
VENDOR = APP.parent / "vendor" / "three"


def _node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    return node


def test_modules_parse():
    node = _node()
    for name in ("character", "room", "tower_model", "mh_home", "manhattan", "construction"):
        out = subprocess.run([node, "--check", str(CITY / f"{name}.js")], capture_output=True, text=True)
        assert out.returncode == 0, (name, out.stderr[:300])


def test_every_catalog_item_has_a_look():
    character = (CITY / "character.js").read_text()
    room = (CITY / "room.js").read_text()
    tower = (CITY / "tower_model.js").read_text()
    for item in cat.OUTFITS:
        assert f"{item['id']}:" in character, item["id"]               # each outfit is drawn differently
    for item in cat.FURNITURE:
        assert f"{item['id']}:" in room, item["id"]                    # a model for every furniture and decor item
    for item in cat.UPGRADES:
        assert f"'{item['id']}'" in tower, item["id"]                  # every tower upgrade is built on the towers
    for size in cat.SIZE_SLOTS if hasattr(cat, "SIZE_SLOTS") else ("studio", "1-bed", "loft", "penthouse"):
        assert (f"{size}:" in room) or (f"'{size}':" in room), size


def test_room_slots_match_the_size_tiers():
    room = (CITY / "room.js").read_text()
    slots = {h["size"]: h["slots"] for h in cat.HOMES}
    assert slots == {"studio": 4, "1-bed": 6, "loft": 8, "penthouse": 12}
    # the layouts carry exactly that many slots (counted from the source)
    for size, n in slots.items():
        key = f"'{size}': {{" if "-" in size else f"{size}: {{"
        start = room.index(key)
        block = room[start:room.index("stand:", start)]
        found = block.count("wall: true") + block.count("wall: false")
        assert found == n, (size, found)


def test_figure_is_human_and_no_mascot():
    """docs/COZY.md 3b: people look human (a subtle face, hair, hands), never a mascot or an animal."""
    src = ((CITY / "character.js").read_text() + (CITY / "human.js").read_text()).lower()
    for word in ("tail", "paw", "snout", "whisker", "muzzle", "smile"):
        assert f"{word}(" not in src and f"'{word}'" not in src
    assert "buildperson" in src and "subtle" in src and "no cartoon" in src
    human = (CITY / "human.js").read_text()
    for style in ("short", "curly", "wavy", "bun", "long", "cap", "beanie"):
        assert f"{style}: {{" in human, style                          # the hair styles of the spec


def test_app_hooks():
    app = (APP / "app.js").read_text()
    assert "'setEconomy', ST.world.economy" in app                     # the scenes get the economy block of /api/world
    assert "openRoom: openRoom" in app and "city/room.js" in app       # window.Witness.openRoom()
    assert "/static/app/" not in app.split("openRoom()")[1][:1200]     # relative imports only
    man = (CITY / "manhattan.js").read_text()
    for hook in ("setEconomy", "openRoom", "viewFrom", "homeView", "homeHit("):
        assert hook in man
    assert "capturing" in man                                          # the window render pauses the main loop
    home = (CITY / "mh_home.js").read_text()
    assert "setUpgrades" in home and "setGold" in home and "goldDays" in home
    assert "uTime" not in home[home.index("const beamMat"):home.index("const beamGeo")]   # the beam is steady: no time term
    css = (APP / "style.css").read_text()
    assert "/* ==== economy 3D: the cutaway room" in css and ".room-ov{" in css and "/* ==== end economy 3D ==== */" in css


def test_room_fallback_without_webgl():
    room = (CITY / "room.js").read_text()
    assert "getContext('webgl2')" in room and "room-ov--flat" in room  # a plain list when WebGL is missing
    assert "forceContextLoss" in room                                  # the room's renderer is released on close
    assert "Escape" in room and "aria-modal" in room


@pytest.mark.skipif(not VENDOR.exists(), reason="three is not vendored")
def test_models_build_in_node(tmp_path):
    """Build the figure in every outfit, every furniture model, every room layout and the towers with all upgrades and a gold crown."""
    node = _node()
    hooks = tmp_path / "hooks.mjs"
    hooks.write_text(
        "const V = %s;\n"
        "export async function resolve(spec, ctx, next) {\n"
        "  if (spec === 'three') return { url: V + 'three.module.js', shortCircuit: true };\n"
        "  if (spec.startsWith('three/addons/')) return { url: V + 'addons/' + spec.slice(13), shortCircuit: true };\n"
        "  return next(spec, ctx);\n}\n" % json.dumps(VENDOR.as_uri() + "/")
    )
    reg = tmp_path / "reg.mjs"
    reg.write_text("import { register } from 'node:module';\nregister('./hooks.mjs', import.meta.url);\n")
    furniture = [i["id"] for i in cat.FURNITURE]
    outfits = [i["id"] for i in cat.OUTFITS]
    upgrades = [i["id"] for i in cat.UPGRADES]
    script = tmp_path / "run.mjs"
    script.write_text(f"""
globalThis.document = {{ createElement: () => ({{ getContext: () => null }}) }};
const ch = await import({json.dumps((CITY / 'character.js').as_uri())});
const room = await import({json.dumps((CITY / 'room.js').as_uri())});
const tm = await import({json.dumps((CITY / 'tower_model.js').as_uri())});
const {{ Geo }} = await import({json.dumps((CITY / 'util.js').as_uri())});
const out = {{ outfits: {{}}, items: {{}}, towers: [] }};
const nan = (arr) => arr.some((v) => !Number.isFinite(v));
const sigs = new Set();
for (const id of {json.dumps(outfits)}) {{
  const f = ch.buildFigure(id); let tris = 0, sig = '';
  for (const pose of ['stand', 'sit', 'walk', 'sleep']) f.setPose(pose, 1.0);
  let real = 0;
  f.root.traverse((o) => {{ if (o.isMesh) {{ const p = o.geometry.attributes.position; tris += p.count / 3; real += o.geometry.index ? o.geometry.index.count / 3 : p.count / 3; if (nan(Array.from(p.array))) throw new Error('NaN in ' + id); sig += Array.from(o.geometry.attributes.color.array.slice(0, 30)).map((v) => v.toFixed(2)).join(','); }} }});
  sigs.add(sig + tris); out.outfits[id] = tris; out.real = Math.max(out.real || 0, real);
}}
out.distinctOutfits = sigs.size;
for (const id of {json.dumps(furniture)}) {{
  const m = room.ITEM_MODELS[id]; const g = new Geo(), gl = new Geo(); let r = 0.3; const rnd = () => (r = (r * 9301 + 49297) % 233280 / 233280);
  m.build(g, gl, rnd, m.mount === 'wall' ? 1.3 : 3.0);
  if (nan(g.pos) || nan(gl.pos)) throw new Error('NaN in ' + id);
  out.items[id] = {{ tris: g.idx.length / 3 + gl.idx.length / 3, mount: m.mount }};
}}
out.layouts = Object.fromEntries(Object.entries(room.LAYOUTS).map(([k, L]) => [k, L.slots.length]));
for (const F of [1, 4, 9, 16]) {{
  const plain = tm.buildDayTower({{ F, seed: 3, target: 6, stars: 3 }});
  const rich = tm.buildDayTower({{ F, seed: 3, target: 6, stars: 3, gold: true, upgrades: {json.dumps(upgrades)} }});
  if (nan(rich.geo.pos)) throw new Error('NaN in tower ' + F);
  out.towers.push({{ F, plain: plain.geo.idx.length / 3, rich: rich.geo.idx.length / 3, lantern: rich.lantern }});
}}
console.log(JSON.stringify(out));
""")
    res = subprocess.run([node, "--import", str(reg), str(script)], capture_output=True, text=True, cwd=tmp_path, timeout=120)
    assert res.returncode == 0, res.stderr[-1500:]
    data = json.loads(res.stdout.strip().splitlines()[-1])
    assert data["distinctOutfits"] == len(outfits)                     # every outfit looks different
    assert all(t > 50 for t in data["outfits"].values())
    assert data["real"] <= 3000                                         # the user's character close up: <= 3k triangles (COZY 3b)
    for fid in furniture:
        assert data["items"][fid]["tris"] >= 12, fid                    # a real model, not an empty box
        assert data["items"][fid]["tris"] < 6000, fid                   # and a cheap one
    assert data["layouts"] == {"studio": 4, "1-bed": 6, "loft": 8, "penthouse": 12, "harlem-floorthrough": 6}
    for t in data["towers"]:
        assert t["rich"] > t["plain"]                                   # the upgrades and the crown add geometry
        assert t["rich"] - t["plain"] < 2500                            # within the per-tower budget
        assert t["lantern"]["y"] > 0
