"""Download ONE Sketchfab model's GLB (spends one of the user's download credits).

    set -a; . ./.env; set +a
    python3 -I scripts/room/sf_download.py <slot> <uid>

- Token comes only from the SKETCHFAB_API_TOKEN environment variable; it is never printed or written.
- Refuses anything that isn't CC0 or CC-BY (checked on /v3/models/<uid> first).
- 401 / 403 / 429 -> stop with exit 2, no retry.
- Writes build/sketchfab-raw/<slot>-<uid>/model.glb + meta.json, and appends a line to
  build/sketchfab-raw/DOWNLOADS.tsv (the credit ledger). Refuses to re-download a uid already in the ledger.
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "build", "sketchfab-raw")
LEDGER = os.path.join(RAW, "DOWNLOADS.tsv")
OK_LICENSES = {"cc0", "by"}
UA = {"User-Agent": "epoch-room-build/1.0"}


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    slot, uid = sys.argv[1], sys.argv[2]
    token = os.environ.get("SKETCHFAB_API_TOKEN")
    if not token:
        sys.exit("SKETCHFAB_API_TOKEN not set (load .env first)")
    os.makedirs(RAW, exist_ok=True)
    if os.path.exists(LEDGER) and any(l.split("\t")[1] == uid for l in open(LEDGER) if "\t" in l):
        sys.exit(f"{uid} already downloaded (see {LEDGER})")
    meta = get_json(f"https://api.sketchfab.com/v3/models/{uid}")
    lic = (meta.get("license") or {}).get("slug")
    if lic not in OK_LICENSES:
        sys.exit(f"licence {lic!r} not allowed")
    try:
        dl = get_json(f"https://api.sketchfab.com/v3/models/{uid}/download",
                      {"Authorization": f"Token {token}"})
    except urllib.error.HTTPError as e:
        print(f"[sf_download] HTTP {e.code} from download endpoint; stopping (no retry)", file=sys.stderr)
        sys.exit(2)
    glb = dl.get("glb") or {}
    if not glb.get("url"):
        sys.exit(f"no glb in download response (keys: {sorted(dl)})")
    out = os.path.join(RAW, f"{slot}-{uid}")
    os.makedirs(out, exist_ok=True)
    dst = os.path.join(out, "model.glb")
    # the GLB url is a pre-signed storage URL: no auth header goes to it
    with urllib.request.urlopen(urllib.request.Request(glb["url"], headers=UA), timeout=600) as r, open(dst, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    keep = {k: meta.get(k) for k in ("uid", "name", "viewerUrl", "faceCount", "vertexCount", "publishedAt")}
    keep["author"] = meta["user"]["displayName"]
    keep["author_url"] = meta["user"].get("profileUrl")
    keep["license"] = meta["license"]
    with open(os.path.join(out, "meta.json"), "w") as f:
        json.dump(keep, f, indent=1)
    with open(LEDGER, "a") as f:
        f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')}\t{uid}\t{slot}\t{meta['name']}\n")
    n = sum(1 for l in open(LEDGER) if "\t" in l)
    print(f"[sf_download] {slot}: {meta['name']} by {keep['author']} ({lic}) -> {dst} "
          f"({os.path.getsize(dst) / 1e6:.1f} MB). Ledger total: {n} download(s).")


if __name__ == "__main__":
    main()
