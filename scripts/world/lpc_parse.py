#!/usr/bin/env python3
"""LPC designation report (pdftotext) -> per-address records (docs/WORLD.md 12.1). No guessing: regular "Key: value" fields plus keyword flags.

  python3 scripts/world/lpc_parse.py [report.txt] [out.json]
Default in : build/ref/street/lpc/report.txt     Default out: build/world-raw/lpc_2571.json  (keyed by BBL)
"""
import json, re, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IN = ROOT / "build" / "ref" / "street" / "lpc" / "report.txt"
DEFAULT_OUT = ROOT / "build" / "world-raw" / "lpc_2571.json"

HEADER = re.compile(r"^(\d+[A-Z]?(?:-\d+[A-Z]?)?)\s+([A-Z0-9][A-Z0-9 .'&-]*?)(?:\s*\(aka\s+(.*))?$")
TAXMAP = re.compile(r"Tax Map Block\s+(\d+),\s*Lot\s+(\d+)", re.I)
FIELD = re.compile(r"^([A-Z][A-Za-z/()' -]{1,40}?):\s*(.*)$")
PAGENUM = re.compile(r"^\s*\d{1,3}\s*$")
KEYS = {
    "Date": "date", "Architect/Builder": "architect", "Type": "type", "Style": "style", "Stories": "stories_text",
    "Material(s)": "materials_text", "Special Windows": "special_windows", "Decorative Metal Work": "metalwork",
    "Significant Architectural Features": "features", "Alterations": "alterations", "Stoop": "stoop", "Door(s)": "door",
    "Cornice": "cornice", "Roof": "roof", "Notable Roof Features": "roof_features", "Areaway Wall/Fence Materials": "areaway",
    "Building Name": "name", "Site Features": "site_features",
}
FACADE = re.compile(r"^(North|South|East|West) Facade$")


def _flags(text):
    t = text.lower()
    has = lambda *w: any(x in t for x in w)
    return {
        "mansard": has("mansard"),
        "dormers": has("dormer"),
        "angled_bay": has("angled bay", "angled projecting bay", "slightly projecting bay"),
        "oriel": has("oriel"),
        "bracketed_cornice": has("bracketed cornice", "bracketed, denticulated cornice", "denticulated bracketed cornice"),
        "denticulated": has("denticulated", "dentil"),
        "rusticated_base": has("rusticated"),
        "fire_escape": has("fire escape"),
        "storefront": has("storefront", "shopfront"),
        "stoop": has("stoop"),
    }


def _stories(txt):
    m = re.match(r"\s*(\d+)", txt or "")
    return (int(m.group(1)) if m else 0), "basement" in (txt or "").lower()


def parse(text):
    """-> list of records (dicts). A record starts at 'NNN STREET NAME' followed by a 'Tax Map Block B, Lot L' line."""
    lines = [l.rstrip() for l in text.splitlines()]
    starts = []
    for i in range(len(lines) - 1):
        m = HEADER.match(lines[i].strip())
        if m and TAXMAP.search(lines[i + 1] or "") and not lines[i].startswith(" "):
            starts.append((i, m))
    recs = []
    for k, (i, m) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        tm = TAXMAP.search(lines[i + 1])
        rec = {"address": m.group(1) + " " + m.group(2).strip(), "number": m.group(1), "block": int(tm.group(1)), "lot": int(tm.group(2))}
        if m.group(3):
            rec["aka"] = m.group(3).strip(" )")
        cur, vals, order, facade = None, {}, [], None
        for ln in lines[i + 2:end]:
            if not ln.strip() or PAGENUM.match(ln):
                continue
            if re.match(r"^[A-Z0-9 ,.()'-]{12,}$", ln.strip()) and ", " in ln and "SIDE" in ln:      # a "WEST 123RD STREET, SOUTH SIDE (EVEN NUMBERS)" heading
                break
            f = FIELD.match(ln.strip())
            if f and not ln.startswith("    ") and (f.group(1) in KEYS or FACADE.match(f.group(1))):
                key = f.group(1)
                if FACADE.match(key):
                    facade = facade or key          # the first (street) facade
                    cur = None
                    continue
                cur = KEYS[key]
                if cur in vals:                     # the facade-level "Stoop:", "Door(s):", "Cornice:", "Roof:" repeat names: first text wins
                    cur = None
                    continue
                vals[cur] = f.group(2).strip()
                order.append(cur)
            elif f and not ln.startswith("    ") and f.group(1) not in KEYS:
                cur = None                          # Windows:, Security Grilles:, Sidewalk Material(s): ... end the running field
            elif cur:
                vals[cur] += " " + ln.strip()
        for k2 in order:
            rec[k2] = re.sub(r"\s+", " ", vals[k2]).strip()
        rec["stories"], rec["basement"] = _stories(rec.get("stories_text"))
        rec["materials"] = [x.strip().lower() for x in re.split(r"[;,]", rec.get("materials_text", "")) if x.strip()]
        rec["facade"] = facade
        cm = re.findall(r"[^;]*cornice[^;]*", rec.get("features", ""), re.I)
        rec["cornice_desc"] = cm[-1].strip() if cm else ""
        blob = " ".join(rec.get(x, "") for x in ("features", "roof", "roof_features", "special_windows", "type", "style", "stoop", "site_features"))
        rec["flags"] = _flags(blob)
        recs.append(rec)
    return recs


def parse_file(path=DEFAULT_IN):
    return parse(Path(path).read_text(errors="replace"))


def by_bbl(recs):
    return {"1%05d%04d" % (r["block"], r["lot"]): r for r in recs}


# ---------------------------------------------------------------------------------------------------------------------------------------------
# Slice 3 (docs/WORLD.md 14.2): the older report formats. LP-0452 (1971, Mount Morris Park HD) is a 7-page NARRATIVE (no per-building entries) and the
# individual landmark reports (Apollo LP-1299, Hotel Theresa, Fire Watchtower) are prose with one landmark site each. Both are parsed with keyword rules
# (no guessing: a style/material is recorded only when the text names it beside the address); anything else falls back to the grammar (blocks: district.mjs),
# and the coverage is logged.  Sources (build time only, build/world-raw/lpc/):  python3 scripts/world/lpc_parse.py --district
SOURCES = {
    "LP-0452": {"pdf": "https://s-media.nyc.gov/agencies/lpc/lp/0452.pdf", "kind": "narrative", "name": "Mount Morris Park Historic District (1971)"},
    "LP-1299": {"pdf": "https://s-media.nyc.gov/agencies/lpc/lp/1299.pdf", "kind": "landmark", "name": "Apollo Theater", "hint": {"number": "253", "street": "W 125 ST", "bbl": "1019310003"}},
    "LP-THERESA": {"pdf": "https://web.archive.org/web/2022id_/http://www.neighborhoodpreservationcenter.org/db/bb_files/Hotel-Theresa--now-Theresa-Towers-.pdf", "kind": "landmark", "name": "Hotel Theresa", "hint": {"number": "2090", "street": "ADAM C POWELL BLVD"}},
    "LP-WATCHTOWER": {"pdf": "https://web.archive.org/web/2022id_/http://www.neighborhoodpreservationcenter.org/db/bb_files/WATCH-TOWER.pdf", "kind": "landmark", "name": "Harlem Fire Watchtower", "hint": {"street": "MARCUS GARVEY PARK"}},
}
STYLES = ["second empire", "neo-grec", "italianate", "queen anne", "romanesque revival", "renaissance revival", "neo-classical", "neo-classic", "beaux-arts", "gothic revival", "french renaissance", "georgian", "classical revival", "colonial revival", "flemish"]
STREETS = r"(Mount Morris Park West|West \d+(?:st|nd|rd|th) Street|East \d+(?:st|nd|rd|th) Street|Lenox Avenue|Fifth Avenue|Seventh Avenue|Eighth Avenue|Adam Clayton Powell(?:, Jr\.)? Boulevard|Malcolm X Boulevard)"
STREET_ANY = re.compile(r"(?:on|at|along|facing)\s+(?:the\s+)?" + STREETS, re.I)
ADDR = re.compile(r"(?:Nos?\.\s*)?(\d+(?:\s*(?:-|to|through)\s*\d+)?)\s+" + STREETS, re.I)


def _norm_street(st):
    t = st.upper().replace("MOUNT MORRIS PARK WEST", "MT MORRIS PARK W").replace("WEST ", "W ").replace("EAST ", "E ")
    t = re.sub(r"(\d+)(ST|ND|RD|TH)\b", r"\1", t).replace(" STREET", " ST").replace(" AVENUE", " AVE").replace(" BOULEVARD", " BLVD")
    return re.sub(r"[ ,.]+", " ", t).strip()


def parse_narrative(text, src="LP-0452"):
    """Narrative report -> [{address, number, street, style, source, flags}] for each address named in a sentence that also names a style."""
    t = re.sub(r"-\s*\n\s*", "", text)           # soft hyphen line breaks
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\b(St|Mt|Dr|Jr)\.\s", r"\1 ", t)
    out = {}
    for sent in re.split(r"(?<=[.;])\s+(?=[A-Z])", t):
        sty = [x for x in STYLES if x in sent.lower()]
        if not sty or len(sent) > 1500:
            continue
        for m in ADDR.finditer(sent):
            num = re.split(r"\s*(?:-|to|through)\s*", m.group(1))[0]
            key = "%s %s" % (num, _norm_street(m.group(2)))
            out.setdefault(key, {"address": key, "number": num, "street": _norm_street(m.group(2)), "style": sty[0].title(), "source": src, "flags": _flags(sent), "span": m.group(1)})
    # "In the Romanesque Revival style are the Bethel Gospel Pentecostal Church ... both on Lenox Avenue": a style hint for the named buildings on a street (no number)
    for m in re.finditer(r"In the ([A-Z][A-Za-z -]{3,40}?) (?:style|tradition)s?,? (?:are|is|were|was)(.{20,420}?)\.", t):
        sty = m.group(1).strip().lower()
        stm = STREET_ANY.search(m.group(2))
        key = "hint:%s:%s" % (sty, len(out))
        out[key] = {"address": "", "street": _norm_street(stm.group(1)) if stm else "", "style": m.group(1).strip(), "names": m.group(2).strip()[:240], "source": src, "flags": _flags(m.group(2)), "hint": 1}
    return list(out.values())


def parse_landmark(text, src):
    """Individual landmark report -> one record: address, tax block/lot, style words counted over the whole text, material words, flags."""
    t = re.sub(r"\s+", " ", re.sub(r"-\s*\n\s*", "", text))
    head = t[:2500]
    tm = re.search(r"Tax Map Block\s+(\d+)\s*,?\s*Lot\s+(\d+)", t, re.I)
    am = ADDR.search(head)
    low = t.lower()
    cnt = {s: low.count(s) for s in STYLES}
    style = max(cnt, key=cnt.get) if any(cnt.values()) else ""
    mats = [m for m in ("brick", "limestone", "terra cotta", "terra-cotta", "granite", "cast iron", "cast-iron", "marble", "sandstone", "brownstone") if m in low]
    rec = {"source": src, "style": style.title(), "materials": mats, "flags": _flags(t), "name": SOURCES.get(src, {}).get("name", ""), "chars": len(t)}
    if am:
        rec["address"] = "%s %s" % (am.group(1).split()[0], _norm_street(am.group(2))); rec["number"] = am.group(1).split()[0]; rec["street"] = _norm_street(am.group(2))
    if tm:
        rec["block"], rec["lot"] = int(tm.group(1)), int(tm.group(2)); rec["bbl"] = "1%05d%04d" % (rec["block"], rec["lot"])
    return rec


def _text_of(pdf, ocr_pages=8):
    """pdftotext; if the PDF has no text layer (scanned) and tesseract exists, OCR the first pages."""
    import subprocess, shutil, tempfile
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, errors="replace").stdout
    if len(txt.strip()) > 400 or not shutil.which("tesseract") or not shutil.which("pdftoppm"):
        return txt, "text"
    out = []
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-r", "150", "-l", str(ocr_pages), "-png", str(pdf), d + "/p"], capture_output=True)
        for png in sorted(Path(d).glob("p*.png")):
            out.append(subprocess.run(["tesseract", str(png), "-", "-l", "eng"], capture_output=True, text=True, errors="replace").stdout)
    return "\n".join(out), "ocr"


def district(fetch=True):
    """Fetch (build time) + parse every slice-3 source -> build/world-raw/lpc_district.json {sources, coverage, records:[...]}; also merges lpc_2571 (by BBL)."""
    import urllib.request
    raw = ROOT / "build" / "world-raw" / "lpc"
    raw.mkdir(parents=True, exist_ok=True)
    recs, cov = [], {}
    for src, meta in SOURCES.items():
        pdf = raw / (src.lower() + ".pdf")
        time.sleep(0.2)
        if fetch and not (pdf.exists() and pdf.stat().st_size > 2000):
            try:
                req = urllib.request.Request(meta["pdf"], headers={"User-Agent": "Mozilla/5.0"})
                pdf.write_bytes(urllib.request.urlopen(req, timeout=120).read())
            except Exception as e:  # noqa: BLE001
                cov[src] = {"status": "fetch failed: %s" % e, "records": 0}; continue
        if not pdf.exists() or pdf.read_bytes()[:4] != b"%PDF":
            cov[src] = {"status": "no PDF (not a PDF response)", "records": 0}; continue
        txt, how = _text_of(pdf)
        (raw / (src.lower() + ".txt")).write_text(txt)
        rs = parse_narrative(txt, src) if meta["kind"] == "narrative" else [parse_landmark(txt, src)]
        if meta["kind"] == "landmark":
            for r in rs:
                for k, v in (meta.get("hint") or {}).items():
                    r.setdefault(k, v)
            rs = [dict(r, address=r.get("address") or (("%s %s" % (r.get("number", ""), r.get("street", ""))).strip())) for r in rs]
        rs = [r for r in rs if r.get("address") or r.get("bbl") or r.get("hint")]
        recs += rs
        cov[src] = {"status": "parsed (%s)" % how, "chars": len(txt), "records": len(rs), "with_style": sum(1 for r in rs if r.get("style"))}
    dst = ROOT / "build" / "world-raw" / "lpc_district.json"
    dst.write_text(json.dumps({"coverage": cov, "records": recs}, separators=(",", ":")))
    for k, v in cov.items():
        print("lpc %-14s %s" % (k, v))
    print("lpc district: %d records -> %s" % (len(recs), dst))
    return recs


if __name__ == "__main__" and "--district" in sys.argv:
    district()
    sys.exit(0)

if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    recs = parse_file(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(by_bbl(recs), separators=(",", ":")))
    print("lpc: %d records -> %s" % (len(recs), dst))
