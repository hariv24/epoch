"""Fetch Poly Haven (CC0) assets into build/polyhaven-raw/<id>/ (one folder per asset, no login).

    python3 -I scripts/room/ph_fetch.py model <id> [res=1k]     # glTF + bin + textures
    python3 -I scripts/room/ph_fetch.py texture <id> [res=1k]   # diff / nor_gl / rough / ao / arm jpgs

Also writes meta.json (name, authors, licence CC0, source url) for LICENSES.md.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "build", "polyhaven-raw")
UA = {"User-Agent": "epoch-room-build/1.0"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def fetch(url, dst):
    if os.path.exists(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(dst, "wb") as f:
        f.write(r.read())


def main():
    kind, aid = sys.argv[1], sys.argv[2]
    res = sys.argv[3] if len(sys.argv) > 3 else "1k"
    out = os.path.join(RAW, aid)
    os.makedirs(out, exist_ok=True)
    files = get_json(f"https://api.polyhaven.com/files/{aid}")
    info = get_json(f"https://api.polyhaven.com/info/{aid}")
    if kind == "model":
        g = files["gltf"][res]["gltf"]
        fetch(g["url"], os.path.join(out, os.path.basename(g["url"])))
        for rel, f in g["include"].items():
            fetch(f["url"], os.path.join(out, rel))
    else:
        for key in ("Diffuse", "nor_gl", "Rough", "AO", "arm"):
            if key in files and res in files[key]:
                u = files[key][res]["jpg"]["url"]
                fetch(u, os.path.join(out, os.path.basename(u)))
    meta = {"id": aid, "name": info.get("name"), "authors": list((info.get("authors") or {}).keys()),
            "license": "CC0", "url": f"https://polyhaven.com/a/{aid}", "dimensions_mm": info.get("dimensions")}
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"[ph_fetch] {kind} {aid} ({res}) -> {out}: {sorted(os.listdir(out))}")


if __name__ == "__main__":
    main()
