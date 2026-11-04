"""Comparison sheets for the room-asset picks.

    python3 -I scripts/room/make_sheets.py <out_dir> <sketchfab_search_dir>

candidates.png: one row per slot. Cell 1 = the pick (rendered at true scale next to a 1.75 m human, the same
orthographic scale in every rendered cell). The other cells are either Poly Haven alternates rendered the same
way, or Sketchfab runners-up shown as their search thumbnails (not downloaded: the account has few download
credits). picks.png: every pick together on the oak floor in front of the plaster wall, with the human.
Run after scripts/room/build_assets.sh and scripts/room/sf_search.py.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
B = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
A = os.path.join(ROOT, "epoch", "web", "static", "app", "room", "assets")
C = os.path.join(ROOT, "build", "room-work", "cand")
FLOOR = os.path.join(ROOT, "build", "room-work", "floor_tex")
CELL = (600, 420)
ORTHO = 5.2

# (kind, source, caption) ; kind: pick | ph (render) | sf (thumbnail: slot/index)
ROWS = [
    ("bed", [
        ("pick", f"{A}/bed.glb", "PICK  Modern Bed - Ngngan (Sketchfab, CC-BY)\n4.8k tris, upholstered, narrowed to a full 1.58 m"),
        ("sf", "bed/02", "Dark Modern Bed - Ren Viro Store (CC-BY)\n21.5k tris; designer wrap-around frame, king-ish"),
        ("sf", "bed/12", "Poliform Bed - Alexis Ramos (CC-BY)\n5.3k tris; floor-level futon look"),
        ("sf", "bed/04", "Bed 01 - 5th Dimension (CC-BY)\n39.5k tris; hotel headboard with built-in lamps"),
    ]),
    ("desk", [
        ("pick", f"{A}/desk.glb", "PICK  Desk Set: desk - Ren Viro Store (CC-BY)\n1.3k tris, oak drawers on black steel, 1.20 x 0.60 m"),
        ("sf", "desk/24", "Modern Desk - AK (CC-BY)\n0.7k tris; nice mid-century, but +1 credit"),
        ("ph", f"{C}/metal_office_desk.glb", "metal_office_desk (Poly Haven, CC0)\n6.9k tris; 2.0 x 0.95 m industrial, too big"),
        ("sf", "desk/101", "Modern Office Desk - FatWasHere (CC-BY)\n0.7k tris; flat 2k texture, long"),
    ]),
    ("chair", [
        ("pick", f"{A}/chair.glb", "PICK  Desk Set: chair - Ren Viro Store (CC-BY)\n16k tris, shell swivel chair (same download as desk)"),
        ("sf", "chair/04", "Office Chair - Tytan (CC-BY)\n2.8k tris; mesh task chair, +1 credit"),
        ("ph", f"{C}/painted_wooden_chair_01.glb", "painted_wooden_chair_01 (Poly Haven, CC0)\n0.7k tris; rustic country chair"),
        ("sf", "chair/03", "Office Chair - Red Fox (CC-BY)\n9.5k tris; grey fabric, +1 credit"),
    ]),
    ("sofa", [
        ("pick", f"{A}/sofa.glb", "PICK  Modern Sofa - Siba Santosh Das (Sketchfab, CC-BY)\n12.7k tris, navy fabric loveseat, 1.73 m"),
        ("sf", "sofa/02", "Mid Century Modern Sofa - Tom Seddon (CC-BY)\n5.4k tris; grey tweed, worn"),
        ("sf", "sofa/94", "Jules 3 Seater - MADE.COM (CC-BY)\n16.4k tris; rust, real product"),
        ("ph", f"{C}/sofa_02.glb", "sofa_02 (Poly Haven, CC0)\n2.7k tris; leather chesterfield, not modern"),
    ]),
    ("rug", [
        ("pick", f"{A}/rug.glb", "PICK  Persian carpet - ChoboiAssets (Sketchfab, CC-BY)\nHeriz-style, 5 x 8 ft (1.52 x 2.44 m)"),
        ("ph", f"{C}/rug_jute.glb", "Procedural + Poly Haven hessian/herringbone (CC0)\nreads as a flat beige sheet at room distance"),
        ("sf", "rug/03", "Persian Rug - Nicholas Record (CC-BY)\ndarker brown/teal"),
        ("sf", "rug/12", "Boho Rug - DeezVertz (CC-BY)\nmodern arches; less pre-war"),
    ]),
    ("lamp", [
        ("pick", f"{A}/lamp.glb", "PICK  desk_lamp_arm_01 (Poly Haven, CC0)\n23k tris; clamp swapped for an 18 cm weighted base"),
        ("ph", f"{C}/lamp_clamp.glb", "desk_lamp_arm_01 as shipped (clamp)\nno clampable edge: drawer box under the whole top"),
        ("ph", f"{C}/lamp_deskset.glb", "Desk Set: table lamp - Ren Viro Store (CC-BY)\n2.6k tris; plain bent rod, low detail"),
        ("ph", f"{C}/industrial_pipe_lamp.glb", "industrial_pipe_lamp (Poly Haven, CC0)\n8.6k tris; steampunk, off-brief"),
    ]),
]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit(f"failed: {cmd[:4]}")


def render(glb, out):
    run([B, "-b", "-P", os.path.join(ROOT, "scripts", "room", "render_lineup.py"), "--",
         "--out", out, "--size", f"{CELL[0]}x{CELL[1]}", "--gap", "0.3", "--ortho", str(ORTHO), glb])


def caption(img, text, out, pick=False):
    lines = text.split("\n")
    run(["magick", img, "-resize", f"{CELL[0]}x{CELL[1]}", "-background", "#e8e8e8", "-gravity", "center",
         "-extent", f"{CELL[0]}x{CELL[1]}",
         "-gravity", "south", "-background", "#c9e6c9" if pick else "#f4f4f4", "-splice", "0x58",
         "-font", "Helvetica-Bold" if pick else "Helvetica", "-pointsize", "16", "-fill", "#111",
         "-annotate", "+0+32", lines[0],
         "-font", "Helvetica", "-pointsize", "14", "-fill", "#333", "-annotate", "+0+10", lines[1] if len(lines) > 1 else "",
         "-bordercolor", "#bbb", "-border", "1", out])


def main():
    out_dir, sf_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    t = tempfile.mkdtemp()
    rows = []
    for slot, cells in ROWS:
        imgs = []
        for i, (kind, src, cap) in enumerate(cells):
            raw = os.path.join(t, f"{slot}_{i}_raw.png")
            if kind == "sf":
                s, idx = src.split("/")
                raw = os.path.join(sf_dir, s, f"{int(idx):02d}.jpg")
            else:
                render(src, raw)
            dst = os.path.join(t, f"{slot}_{i}.png")
            caption(raw, cap, dst, pick=(kind == "pick"))
            imgs.append(dst)
        row = os.path.join(t, f"row_{slot}.png")
        run(["magick", *imgs, "+append", "-gravity", "west", "-background", "#2b2f36", "-splice", "90x0",
             "-font", "Helvetica-Bold", "-pointsize", "22", "-fill", "#fff", "-annotate", "+12+0", slot.upper(), row])
        rows.append(row)
    head = os.path.join(t, "head.png")
    run(["magick", "-size", f"{90 + 4 * (CELL[0] + 2)}x60", "xc:#2b2f36", "-font", "Helvetica-Bold", "-pointsize", "22",
         "-fill", "#fff", "-gravity", "west", "-annotate", "+12-8",
         "Room v2 furniture: candidates (rendered cells share one scale, 1.75 m person; Sketchfab runners-up = search thumbnails)",
         "-font", "Helvetica", "-pointsize", "15", "-annotate", "+12+16",
         "Green = pick. Sketchfab downloads used: 4 (bed, desk set = desk + chair, sofa, rug). Poly Haven: lamp, floor, wall.",
         head])
    run(["magick", head, *rows, "-background", "#2b2f36", "-gravity", "west", "-append", os.path.join(out_dir, "candidates.png")])

    # picks together
    raw = os.path.join(t, "picks_raw.png")
    run([B, "-b", "-P", os.path.join(ROOT, "scripts", "room", "render_lineup.py"), "--", "--out", raw,
         "--size", "2400x1000", "--gap", "0.3", "--ortho", "12.6", "--floor", FLOOR,
         "--wall", f"{A}/tex/plaster_wall_diff.webp,{A}/tex/plaster_wall_nor.webp",
         *[f"{A}/{s}.glb" for s in ("bed", "sofa", "desk", "chair", "lamp", "rug")]])
    run(["magick", raw, "-gravity", "south", "-background", "#2b2f36", "-splice", "0x70",
         "-font", "Helvetica-Bold", "-pointsize", "24", "-fill", "#fff", "-annotate", "+0+38",
         "Picks at true scale with a 1.75 m person:  bed 1.58 x 2.15  |  loveseat 1.73 x 0.76  |  desk 1.20 x 0.61 x 0.75"
         "  |  chair 0.65 x 0.63 x 0.93  |  lamp 0.83 m  |  rug 1.52 x 2.44",
         "-font", "Helvetica", "-pointsize", "18", "-annotate", "+0+10",
         "Floor: Poly Haven old_wooden_floor_01 (oak strip, 2 m tile).  Wall: Poly Haven white_stucco tinted to #EDE6DA.",
         os.path.join(out_dir, "picks.png")])
    print(f"[sheets] {out_dir}/candidates.png, {out_dir}/picks.png")


if __name__ == "__main__":
    main()
