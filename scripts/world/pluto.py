#!/usr/bin/env python3
"""PLUTO fetch + normalise (docs/WORLD.md 12.1). Build time only; the raw download is cached under build/world-raw/ and never shipped.

  python3 scripts/world/pluto.py                 # fetch Manhattan (Socrata 64uk-42ks, paged, no key) -> build/world-raw/pluto_mn.json
  python3 scripts/world/pluto.py --from-ref      # no network: normalise build/ref/street/pluto_1907_1908.json instead
Output: {"1019070046": {"address": "124 WEST 123 STREET", "lotfront_ft": 16.67, ...}, ...} keyed by the 10-digit BBL.
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "build" / "world-raw"
REF = ROOT / "build" / "ref" / "street" / "pluto_1907_1908.json"
URL = "https://data.cityofnewyork.us/resource/64uk-42ks.json"
COLS = "bbl,address,lotfront,lotdepth,bldgfront,bldgdepth,numfloors,yearbuilt,bldgclass,landuse,histdist"
FT = 0.3048


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def bbl10(v):
    """'1019070046.00000000' -> '1019070046'"""
    return str(v).split(".")[0].zfill(10)


def normalize_row(r):
    """One Socrata row -> compact record (feet kept as in PLUTO; *_m convenience in metres)."""
    lotfront, bldgfront = _num(r.get("lotfront")), _num(r.get("bldgfront"))
    rec = {
        "address": (r.get("address") or "").strip(),
        "lotfront_ft": lotfront, "lotdepth_ft": _num(r.get("lotdepth")),
        "bldgfront_ft": bldgfront, "bldgdepth_ft": _num(r.get("bldgdepth")),
        "floors": int(_num(r.get("numfloors"))), "year": int(_num(r.get("yearbuilt"))),
        "bldgclass": r.get("bldgclass") or "", "landuse": r.get("landuse") or "", "histdist": r.get("histdist") or "",
    }
    # frontage used by the grammar: the building front when PLUTO has one, else the lot front
    rec["front_m"] = round((bldgfront or lotfront) * FT, 3)
    return rec


def normalize(rows):
    return {bbl10(r["bbl"]): normalize_row(r) for r in rows if r.get("bbl")}


def fetch(page=50000):
    rows, off = [], 0
    while True:
        q = urllib.parse.urlencode({"$select": COLS, "$where": "borough='MN'", "$order": "bbl", "$limit": page, "$offset": off})
        with urllib.request.urlopen(URL + "?" + q, timeout=120) as f:
            chunk = json.load(f)
        rows += chunk
        if len(chunk) < page:
            return rows
        off += page


def load(path=None):
    p = Path(path) if path else RAW / "pluto_mn.json"
    return json.loads(p.read_text())


def lpc_bbl(block, lot):
    """Tax Map Block 1907, Lot 46 -> '1019070046' (Manhattan = 1)."""
    return "1%05d%04d" % (int(block), int(lot))


def join_lpc(lpc_records, pluto):
    """Attach the PLUTO record to each LPC record via its BBL. Returns {bbl: {"lpc": rec, "pluto": rec|None}}."""
    out = {}
    for rec in lpc_records:
        b = lpc_bbl(rec["block"], rec["lot"])
        out[b] = {"lpc": rec, "pluto": pluto.get(b)}
    return out


def main(argv):
    RAW.mkdir(parents=True, exist_ok=True)
    if "--from-ref" in argv:
        rows, src = json.loads(REF.read_text()), "reference"
    else:
        try:
            rows, src = fetch(), "socrata"
        except Exception as e:  # offline: fall back to the reference slice, clearly said
            print("fetch failed (%s); using the reference blocks 1907/1908 only" % e, file=sys.stderr)
            rows, src = json.loads(REF.read_text()), "reference"
    data = normalize(rows)
    out = RAW / ("pluto_mn.json" if src == "socrata" else "pluto_ref.json")
    out.write_text(json.dumps(data, separators=(",", ":")))
    print("pluto: %d lots from %s -> %s (%d KB)" % (len(data), src, out.relative_to(ROOT), out.stat().st_size // 1024))


if __name__ == "__main__":
    main(sys.argv[1:])
