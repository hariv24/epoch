"""Sketchfab search (free, no token, no download credits): shortlist room furniture by thumbnail + metadata.

    python3 -I scripts/room/sf_search.py <out_dir> <slot> "<query>" ["<query>" ...]

Keeps only downloadable CC0 / CC-BY models that ship a GLB archive and are under MAX_FACES.
Writes <out_dir>/<slot>.json (metadata) and <out_dir>/<slot>/NN.jpg (thumbnails), plus a labelled
contact sheet <out_dir>/<slot>.png via ImageMagick, so candidates are compared without spending
download credits.
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

API = "https://api.sketchfab.com/v3/search"
LICENSES = {"by": "CC-BY", "cc0": "CC0"}
MAX_FACES = 120_000
PER_QUERY = 24


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "epoch-room-build/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def thumb_url(m, want=448):
    imgs = (m.get("thumbnails") or {}).get("images") or []
    imgs = sorted(imgs, key=lambda i: abs((i.get("width") or 0) - want))
    return imgs[0]["url"] if imgs else None


def main():
    out, slot, queries = sys.argv[1], sys.argv[2], sys.argv[3:]
    os.makedirs(os.path.join(out, slot), exist_ok=True)
    seen, rows = set(), []
    for q in queries:
        for lic, lic_name in LICENSES.items():
            params = {"type": "models", "downloadable": "true", "q": q, "license": lic,
                      "count": PER_QUERY, "max_face_count": MAX_FACES}
            try:
                d = get(API + "?" + urllib.parse.urlencode(params))
            except Exception as e:  # report and continue; never loop-retry
                print(f"[search] {q!r} {lic}: {e}", file=sys.stderr)
                continue
            for m in d.get("results", []):
                glb = (m.get("archives") or {}).get("glb")
                if m["uid"] in seen or not glb or (m.get("faceCount") or 0) > MAX_FACES:
                    continue
                seen.add(m["uid"])
                rows.append({
                    "uid": m["uid"], "name": m["name"], "author": m["user"]["displayName"],
                    "username": m["user"]["username"], "license": lic_name,
                    "license_label": (m.get("license") or {}).get("label"),
                    "faces": m.get("faceCount"), "glb_mb": round((glb.get("size") or 0) / 1e6, 1),
                    "tex_n": glb.get("textureCount"), "tex_max": glb.get("textureMaxResolution"),
                    "likes": m.get("likeCount"), "anim": m.get("animationCount"),
                    "url": m.get("viewerUrl"), "thumb": thumb_url(m), "query": q,
                })
    for i, r in enumerate(rows):
        r["idx"] = i
        if r["thumb"]:
            dst = os.path.join(out, slot, f"{i:02d}.jpg")
            try:
                urllib.request.urlretrieve(r["thumb"], dst)
            except Exception as e:
                print(f"[thumb] {i}: {e}", file=sys.stderr)
    with open(os.path.join(out, f"{slot}.json"), "w") as f:
        json.dump(rows, f, indent=1)
    # labelled contact sheet
    args = ["magick", "montage"]
    for r in rows:
        p = os.path.join(out, slot, f"{r['idx']:02d}.jpg")
        if os.path.exists(p):
            lab = f"{r['idx']} {r['name'][:28]}\\n{r['license']} {r['faces']//1000}k f {r['glb_mb']}MB t{r['tex_max']}"
            args += ["-label", lab, p]
    if len(args) > 2:
        args += ["-tile", "6x", "-geometry", "260x146+3+3", "-pointsize", "11", "-background", "#e8e8e8",
                 os.path.join(out, f"{slot}.png")]
        subprocess.run(args, check=False)
    for r in rows:
        print(f"{r['idx']:2d} {r['license']:5} {r['faces']:>7} {r['glb_mb']:>6}MB t{r['tex_n']}@{r['tex_max']} "
              f"likes{r['likes']:>5} | {r['name'][:50]} | {r['author']}")


if __name__ == "__main__":
    main()
