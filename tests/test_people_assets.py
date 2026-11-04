"""The realistic people (docs/PEOPLE.md): generated MakeHuman/MPFB2 characters + the shared Quaternius-based clips in
epoch/web/static/app/people/. These tests check the shipped files against the manifest, the outfit catalog, the budgets
and the licence record; they do not need Blender."""
from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from epoch import economy_catalog as cat

STATIC = Path(__file__).resolve().parent.parent / "epoch" / "web" / "static"
PEOPLE = STATIC / "app" / "people"
VENDOR = STATIC / "vendor" / "three" / "addons"
CLIPS = {"idle", "idle_look", "walk", "sit_idle", "sit_type", "sit_read", "sit_sip", "stand_stretch", "wave", "cheer",
         "yawn", "sleep", "point", "dance", "kneel", "water", "play_piano"}
ALLOWED_EXT = {"EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"}

pytestmark = pytest.mark.skipif(not (PEOPLE / "manifest.json").exists(), reason="people assets not built")


def _manifest():
    return json.loads((PEOPLE / "manifest.json").read_text())


def _glb_json(path: Path) -> dict:
    b = path.read_bytes()
    magic, version, length = struct.unpack("<III", b[:12])
    assert magic == 0x46546C67 and version == 2 and length == len(b), path
    jlen, jtype = struct.unpack("<II", b[12:20])
    assert jtype == 0x4E4F534A, path
    return json.loads(b[20:20 + jlen])


def _lod_files(m):
    for c in m["characters"]:
        sets = c["outfits"].values() if c["role"] == "user" else [c]
        for s in sets:
            for lod, v in s["lods"].items():
                yield c, lod, v


def test_every_catalog_outfit_has_a_user_model():
    m = _manifest()
    user = next(c for c in m["characters"] if c["role"] == "user")
    ids = {o["id"] for o in cat.OUTFITS} | {o["id"] for o in cat.CHEST_OUTFITS}
    assert ids <= set(user["outfits"]), ids - set(user["outfits"])
    assert user["default_outfit"] == "everyday"
    for oid in ids:
        assert set(user["outfits"][oid]["lods"]) == {"close", "mid", "far"}


def test_npcs_are_varied():
    m = _manifest()
    npcs = [c for c in m["characters"] if c["role"] == "npc"]
    assert 10 <= len(npcs) <= 12
    assert len({c["name"] for c in npcs}) == len(npcs)
    assert {c["gender"] for c in npcs} == {"female", "male"}
    assert all(18 <= c["age_years"] <= 35 for c in npcs)
    acc = {a for c in npcs for a in c["accessories"]}
    assert {"glasses", "headphones", "cap", "backpack"} <= acc


def test_lod_files_exist_and_fit_budgets():
    m = _manifest()
    budget = {"close": 15000, "mid": 5000, "far": 1500}
    for c, lod, v in _lod_files(m):
        f = PEOPLE / v["file"]
        assert f.exists(), f
        assert v["tris"] <= budget[lod] * 1.02, (v["file"], v["tris"])
        assert v["bytes"] == f.stat().st_size
        assert v["texture_px"] <= 1024


def test_glbs_are_valid_and_share_the_skeleton():
    m = _manifest()
    bones = set(m["skeleton"]["bones"])
    for c, lod, v in _lod_files(m):
        j = _glb_json(PEOPLE / v["file"])
        assert set(j.get("extensionsRequired", [])) <= ALLOWED_EXT, v["file"]
        assert len(j["skins"]) >= 1, v["file"]
        names = {j["nodes"][i].get("name") for s in j["skins"] for i in s["joints"]}
        assert names == bones, (v["file"], bones ^ names)
        assert not j.get("animations"), v["file"]          # motion lives in clips.glb only


def test_clips_glb_has_every_clip_and_only_rotation_tracks():
    m = _manifest()
    assert CLIPS <= set(m["clips"]["items"]), CLIPS - set(m["clips"]["items"])
    j = _glb_json(PEOPLE / m["clips"]["file"])
    assert not j.get("meshes")
    names = {a["name"] for a in j["animations"]}
    assert CLIPS <= names, CLIPS - names
    for a in j["animations"]:
        for ch in a["channels"]:
            t = ch["target"]
            node = j["nodes"][t["node"]].get("name")
            assert t["path"] == "rotation" or (t["path"] == "translation" and node == "pelvis"), (a["name"], node, t)
    for name, info in m["clips"]["items"].items():
        assert 0.5 < info["duration"] < 8.0, name
        assert isinstance(info["loop"], bool)


def test_total_size_and_decoder():
    m = _manifest()
    total = sum(f.stat().st_size for f in PEOPLE.rglob("*.glb") if "mixamo" not in f.parts)   # mixamo/ is gitignored and separate
    assert total <= 30 * 1024 * 1024, total
    assert m["total_bytes"] == total
    assert (VENDOR / "libs" / "meshopt_decoder.module.js").exists()
    assert (VENDOR / "loaders" / "GLTFLoader.js").exists()
    assert (VENDOR / "utils" / "SkeletonUtils.js").exists()


def test_licences_recorded():
    text = (PEOPLE / "LICENSES.md").read_text()
    assert "CC0" in text and "Quaternius" in text and "Universal Animation Library 2" in text
    assert "CC-BY" in text                                  # attribution table for the CC BY assets
    for line in text.splitlines():
        if line.startswith("| ") and not line.startswith(("| Asset", "| Source", "|---")):
            assert ("CC0" in line) or ("CC-BY" in line), line
