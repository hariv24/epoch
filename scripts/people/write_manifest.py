"""Write epoch/web/static/app/people/manifest.json and LICENSES.md from the build records (plain Python, no Blender).

  .venv/bin/python -I scripts/people/write_manifest.py
Fails loudly when an asset used by any character has no known licence, or a licence that does not allow redistribution.
"""
import json, os, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import specs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "epoch", "web", "static", "app", "people")
WORK = os.path.join(ROOT, "build", "people-work")
RAW = os.path.join(ROOT, "build", "people-raw")
PACK_URL = "https://files2.makehumancommunity.org/asset_packs/{pack}/{zip}"
PACK_PAGE = "https://static.makehumancommunity.org/assets/assetpacks/{pack}.html"
OK_LICENSES = {"CC0": "CC0 1.0 (public domain)", "CC-BY": "CC BY (attribution required; see below)"}

# ---------------------------------------------------------------- asset metadata from the official pack indexes
meta = {}
for js in sorted(glob.glob(os.path.join(RAW, "packs", "x", "*", "packs", "*.json"))):
    zipname = os.path.basename(os.path.dirname(os.path.dirname(js))) + ".zip"
    pack = os.path.splitext(os.path.basename(js))[0]
    for name, m in json.load(open(js, encoding="utf-8")).items():
        meta.setdefault(name, dict(m, pack=pack, zip=zipname))
sysjs = os.path.join(RAW, "mh_system", "extracted", "packs", "makehuman_system_assets.json")
for name, m in json.load(open(sysjs, encoding="utf-8")).items():
    meta.setdefault(name, dict(m, pack="makehuman_system_assets", zip="makehuman_system_assets_cc0.zip"))


def asset_list(spec, items):
    out = [("skin", spec["skin"]["source"]), ("eyebrows", spec.get("eyebrows", "eyebrow001")),
           ("eyelashes", spec.get("eyelashes", "eyelashes01")), ("hair", spec["hair"][0]), ("eyes", "low-poly"),
           ("eyes material", spec.get("eyes", "brown"))]
    for it in items:
        if isinstance(it, tuple):
            out.append(("clothes", it[0]))
            if it[1].get("material"):
                out.append(("clothes material", it[1]["material"]))
        else:
            kind, *rest = it.split(":")
            if kind in ("glasses", "cap", "beard"):
                out.append((kind, rest[0]))
            else:
                out.append((kind, "generated in Blender (build_lib.make_%s)" % kind))
    return out


used = {}      # asset -> set of character ids
chars = [("user", specs.USER, items, o) for o, items in specs.OUTFITS.items()] + \
        [(n["id"], n, list(n["clothes"]) + list(n.get("acc", [])), None) for n in specs.NPCS]
for cid, spec, items, outfit in chars:
    for kind, name in asset_list(spec, items):
        if name.startswith("generated"):
            continue
        used.setdefault(name, set()).add(cid if outfit is None else f"user/{outfit}")

missing, bad = [], []
for name in used:
    m = meta.get(name)
    if m is None:
        # eye materials / alternative clothes materials / low-poly eyes ship with the system assets (CC0)
        sysdir = os.path.join(RAW, "mh_system", "extracted")
        if glob.glob(os.path.join(sysdir, "**", name + "*"), recursive=True):
            meta[name] = {"author": "makehuman_system", "license": "CC0", "source": "http://www.makehumancommunity.org",
                          "pack": "makehuman_system_assets", "zip": "makehuman_system_assets_cc0.zip"}
            continue
        for js in glob.glob(os.path.join(RAW, "packs", "x", "*")):
            if glob.glob(os.path.join(js, "**", name + "*"), recursive=True):
                z = os.path.basename(js)
                lic = "CC0" if z.endswith("_cc0") else "CC-BY"
                meta[name] = {"author": "see pack page", "license": lic, "pack": z.rsplit("_", 1)[0], "zip": z + ".zip",
                              "source": PACK_PAGE.format(pack=z.rsplit("_", 1)[0])}
                break
        else:
            missing.append(name)
            continue
    lic = meta[name]["license"]
    if lic not in OK_LICENSES:
        bad.append((name, lic))
if missing or bad:
    raise SystemExit(f"licence check failed: missing={missing} bad={bad}")

# ---------------------------------------------------------------- manifest
def rec(tag):
    return json.load(open(os.path.join(WORK, "records", tag + ".json")))


def lods(r):
    out = {}
    for lod, v in r["lods"].items():
        f = os.path.join(OUT, v["file"])
        out[lod] = {"file": v["file"], "tris": v["tris"], "bytes": os.path.getsize(f), "texture_px": v["texture_px"]}
    return out


clips = rec("clips")
characters = []
u = {"id": "user", "name": specs.USER["name"], "role": "user", "outfits": {}, "default_outfit": "everyday"}
for o in specs.OUTFITS:
    r = rec(f"user_{o}")
    u["outfits"][o] = {"lods": lods(r)}
    u.setdefault("height_m", r["height_m"])
    u.setdefault("hip_height_m", r["hip_height_m"])
characters.append(u)
for n in specs.NPCS:
    r = rec(n["id"])
    characters.append({"id": n["id"], "name": n["name"], "role": "npc", "height_m": r["height_m"],
                       "hip_height_m": r["hip_height_m"],
                       "gender": "female" if n["phenotype"]["gender"] < 0.5 else "male",
                       "age_years": round(11 + n["phenotype"]["age"] * 28),
                       "accessories": [a.split(":")[0] for a in n.get("acc", [])],
                       "lods": lods(r)})

total = 0
for f in glob.glob(os.path.join(OUT, "**", "*.glb"), recursive=True):
    total += os.path.getsize(f)
manifest = {
    "version": 1,
    "generator": "scripts/people/build_all.sh (MakeHuman/MPFB2 in Blender + Quaternius UAL clips)",
    "space": {"units": "meters", "up": "+y", "forward": "+z", "feet_at_y": 0, "origin": "between the feet"},
    "compression": {"meshopt": True,
                    "extensionsRequired": ["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"],
                    "decoder": "vendor/three/addons/libs/meshopt_decoder.module.js (three@0.186.1)",
                    "usage": "gltfLoader.setMeshoptDecoder(MeshoptDecoder)"},
    "skeleton": {"rig": "MPFB2 'game_engine' (Unreal-style bone names)", "root": "Root", "bones": clips["bones"],
                 "shared": "every character and clips.glb use these exact bone names"},
    "clips": {"file": "clips.glb", "fps": clips["fps"], "ref_character": "user",
              "ref_hip_height_m": clips["hip_height_m"],
              "tracks": "quaternion rotation for every bone + pelvis.position (no scale / other translations)",
              "pelvis_scaling": "multiply pelvis.position values by character.hip_height_m / ref_hip_height_m",
              "sleep": clips["sleep"],
              "items": clips["clips"]},
    "lod_hint": {"close": "the user's own character / anything within ~4 m", "mid": "~4-15 m", "far": "crowds, > 15 m"},
    "characters": characters,
    "total_bytes": total,
    "licenses": "LICENSES.md",
}
with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)

# ---------------------------------------------------------------- LICENSES.md
L = ["# Epoch people: sources and licences", "",
     "Every file in this folder is generated by `scripts/people/build_all.sh` (see `docs/PEOPLE.md`).",
     "All inputs allow use **and** redistribution: CC0 (public domain) or CC BY (attribution, given below).",
     "Nothing here was bought, and nothing needs an account to rebuild.", "",
     "## Generated output", "",
     "- Character meshes, textures and rigs: generated with **MPFB2** v2.0.18 (MakeHuman plugin for Blender,",
     "  https://github.com/makehumancommunity/mpfb2 / extensions.blender.org) from the MakeHuman base mesh, targets",
     "  and system assets, which are **CC0 1.0** (`makehuman_system_assets` pack index). MPFB2 itself (GPL-3.0) runs at",
     "  build time only; none of its code ships with the app.",
     "- Accessories marked *generated* (scarf, backpack, headphones) are modelled by our build script: CC0.",
     "- Authored animation layers in `clips.glb` (typing, reading, sipping, piano, waving, cheering, pointing, yawning,",
     "  stretching, looking around, sleeping) are produced by `scripts/people/build_clips.py`: CC0.", "",
     "## Animation", "",
     "| Source | Author | Licence | Where | Used for |", "|---|---|---|---|---|",
     "| Universal Animation Library (Standard) | Quaternius | CC0 1.0 | https://quaternius.itch.io/universal-animation-library (also https://quaternius.com/packs/universalanimationlibrary.html) | idle, walk, sit_idle (+ bases of the authored sit_* / idle_* clips), dance |",
     "| Universal Animation Library 2 (Standard) | Quaternius | CC0 1.0 | https://quaternius.itch.io/universal-animation-library-2 (also https://quaternius.com/packs/universalanimationlibrary2.html) | kneel (Chest_Open), water (Farm_Watering) |",
     "", "Both downloads include a `License.txt` stating CC0 1.0 Universal.", "",
     "## Runtime code", "",
     "- `vendor/three/addons/libs/meshopt_decoder.module.js` (three@0.186.1, from meshoptimizer by Arseny Kapoulkine): MIT.",
     "", "## MakeHuman assets used", "",
     "Downloaded from the official MakeHuman asset packs (https://static.makehumancommunity.org/assets/assetpacks.html).",
     "Licences as stated in each pack's index (`packs/<pack>.json`) and the asset-pack FAQ",
     "(https://static.makehumancommunity.org/assets/assetpacks/faq.html): CC0 = public domain dedication",
     "(https://creativecommons.org/publicdomain/zero/1.0/); CC-BY = Creative Commons Attribution",
     "(https://creativecommons.org/licenses/by/2.5/se/deed.en). **Attribution for the CC-BY assets: the author named",
     "in each row, with the asset's page linked.** The assets were recoloured, decimated and baked into the GLBs.", "",
     "| Asset | Author | Licence | Source | Pack | Used by |", "|---|---|---|---|---|---|"]
for name in sorted(used):
    m = meta[name]
    L.append(f"| {name} | {m.get('author') or '-'} | {m['license']} | {m.get('source') or '-'} | "
             f"[{m['pack']}]({PACK_URL.format(pack=m['pack'], zip=m['zip']) if m['pack'] != 'makehuman_system_assets' else 'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html'}) | "
             f"{', '.join(sorted(used[name]))} |")
MIXAMO_SECTION = '\n## Mixamo people (v3, `people/mixamo/`, gitignored: never redistributed)\n\n- **Characters** (Sketchfab, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Credit is required wherever the app or a store page shows them:\n  - "Dylan - LOD man character" by Egunoff (https://sketchfab.com/egunoff), https://sketchfab.com/3d-models/dylan-lod-man-character-c6481e21743644ba805a6fc9e7270131, used as "Hariv", the user\'s character in the Today room (`people/mixamo/hariv.glb`).\n  - Hariv\'s Columbia sweatshirt is the "Tops" mesh of "Arthur - LOD man character" by Egunoff (https://sketchfab.com/egunoff, CC BY 4.0), retargeted to Dylan\'s skeleton and recoloured by `scripts/people/mixamo/dress_hariv.py`.\n  - NPCs (same licence, in `people/mixamo/`, not used in a scene yet): "Antony - LOD Man character", "Duke - LOD Man character", "Mr Froggle - LOD Man character" (Egunoff); "Middle-aged guy in a suit", "TBG - Leather jacket wearing alpha male" (ustoopia); "Mapontes - Animated worker (rigged character)" (Marcelo-Apontes); "Free animated male character in Blender" (gbarzu). Authors and links are in each GLB\'s `asset.extras`.\n- **Motion:** Adobe Mixamo animations (free to use inside the app; the raw FBX and the converted `clips.glb` must never be redistributed).\n'
with open(os.path.join(OUT, "LICENSES.md"), "w") as f:
    f.write("\n".join(L) + "\n" + MIXAMO_SECTION)
print(f"[manifest] {len(characters)} characters, {len(clips['clips'])} clips, {len(used)} assets, {total / 1e6:.1f} MB")
