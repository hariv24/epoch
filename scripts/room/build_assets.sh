#!/bin/bash
# Room v2 assets: raw downloads -> epoch/web/static/app/room/assets/*.glb (+ tex/*.webp).
#   scripts/room/build_assets.sh
# Needs the raw files already in build/sketchfab-raw/ and build/polyhaven-raw/ (scripts/room/sf_download.py,
# scripts/room/ph_fetch.py), Blender 5.2, ImageMagick, and build/people-tools (gltf-transform 4 + sharp).
# Every GLB: metres, origin at the floor centre of the footprint, front = +Z, textures webp (<= 1k, 512 for small
# props), geometry EXT_meshopt_compression (decoder: vendor/three/addons/libs/meshopt_decoder.module.js).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
GT="$ROOT/build/people-tools/node_modules/.bin/gltf-transform"
S="$ROOT/scripts/room"
SF="$ROOT/build/sketchfab-raw"
PH="$ROOT/build/polyhaven-raw"
W="$ROOT/build/room-work/final"
OUT="$ROOT/epoch/web/static/app/room/assets"
mkdir -p "$W" "$OUT/tex"

prep() { "$B" -b -P "$S/prep_asset.py" -- "$@" 2>&1 | grep -E "^\[prep\]|Error|Traceback" || true; }

# --- Blender: orient, real scale, origin at the floor centre ---------------------------------------------------
# bed_grey: Ngngan "Modern Bed" is a queen frame (1.79 m); narrowed in X to a full (1.58 m, 1.37 m mattress)
prep "$SF/bed-c713701eecbd479ea5ae7918de5de2f2/model.glb" "$W/bed_grey.glb" --scale 0.88,1,1
# bed (the user's pick, 10-30): Ren Viro Store "Dark Modern Bed" (mm), 2.14 x 1.99 x 0.86 m -> queen: 0.77x in width only (1.645 m)
prep "$SF/bed-d3aeb724e09c44af96ef09cd20885220/model.glb" "$W/bed.glb" --scale 0.00077,0.001,0.001
# desk + chair: Ren Viro Store "Desk Set" (mm). Desk 1.50 x 0.60 x 0.816 -> 1.20 x 0.60 x 0.75; chair turned to face front
DS="$SF/deskset-f26030d09d73422f8ff270425c7c63e0/model.glb"
prep "$DS" "$W/desk.glb" --include '^Desk' --scale 0.0008,0.001,0.000919
prep "$DS" "$W/chair.glb" --include 'Office-Chair' --rot-z 125.8 --scale 0.001
# sofa: modelled ~1.28x oversize (seat 0.55, back 1.12 m) -> 0.78 = real loveseat (seat 0.43, back 0.87 m)
prep "$SF/sofa-672ec00056c842eea6d72602e81907d0/model.glb" "$W/sofa.glb" --scale 0.78
# rug: 1.94 x 3.09 m -> uniform 0.7878 = a standard 5 x 8 ft rug (1.52 x 2.44 m); pile 9 mm; wool roughness
prep "$SF/rug-4592468c03784f0d895876ec670de1cd/model.glb" "$W/rug.glb" --scale 0.7878,0.7878,1.25 --roughness 0.95
# lamp: Poly Haven clamp anglepoise, head turned to the front, clamp swapped for a weighted disc base
prep "$PH/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf" "$W/lamp_clamp.glb" --rot-z 180
"$B" -b -P "$S/lamp_base.py" -- "$W/lamp_clamp.glb" "$W/lamp.glb" 2>&1 | grep -E "^\[lamp_base\]|Error|Traceback" || true

# --- gltf-transform: dedup, prune, resize, webp, meshopt --------------------------------------------------------
pack() {  # pack <slot> <max texture px>
  local i="$W/$1.glb" t; t="$(mktemp -d)"
  "$GT" dedup "$i" "$t/a.glb" >/dev/null
  "$GT" prune "$t/a.glb" "$t/b.glb" >/dev/null
  "$GT" resize "$t/b.glb" "$t/c.glb" --width "$2" --height "$2" >/dev/null
  "$GT" webp "$t/c.glb" "$t/d.glb" --quality 85 >/dev/null
  "$GT" meshopt "$t/d.glb" "$OUT/$1.glb" --level high >/dev/null
  rm -rf "$t"
}
for s in bed bed_grey desk chair sofa rug; do pack "$s" 1024; done
pack lamp 512

# --- shell textures (Poly Haven, 2 m x 2 m tiles): diffuse (sRGB), normal (OpenGL), arm = AO/rough/metal ---------
F="$PH/old_wooden_floor_01/old_wooden_floor_01"
magick "$F"_diff_1k.jpg -quality 85 "$OUT/tex/oak_floor_diff.webp"
magick "$F"_nor_gl_1k.jpg -quality 90 "$OUT/tex/oak_floor_nor.webp"
magick "$F"_arm_1k.jpg -quality 90 "$OUT/tex/oak_floor_arm.webp"
P="$PH/white_stucco/white_stucco"
# tint so the mean colour is the spec's warm off-white #EDE6DA (stucco mean is 215,210,207)
magick "$P"_diff_1k.jpg -channel R -evaluate multiply 1.102 -channel G -evaluate multiply 1.095 \
  -channel B -evaluate multiply 1.053 +channel -quality 85 "$OUT/tex/plaster_wall_diff.webp"
magick "$P"_nor_gl_1k.jpg -quality 90 "$OUT/tex/plaster_wall_nor.webp"
magick "$P"_arm_1k.jpg -quality 90 "$OUT/tex/plaster_wall_arm.webp"

echo "[build_assets] done: $(du -sh "$OUT" | cut -f1) in $OUT"
ls -la "$OUT" "$OUT/tex"
