#!/bin/bash
# Brownstone dressing (docs/ROOM-V2.md §13.1): Poly Haven (CC0) raw downloads -> epoch/web/static/app/room/assets/bs/*.glb (+ tex/).
#   python3 -I scripts/room/ph_fetch.py model <id> 1k   (each id below; textures: herringbone_parquet, marble_01)
#   scripts/room/build_brownstone.sh
# Same pipeline as build_assets.sh (Blender prep_asset.py -> gltf-transform), plus `simplify` (meshoptimizer) for the dense props.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
GT="$ROOT/build/people-tools/node_modules/.bin/gltf-transform"
S="$ROOT/scripts/room"
PH="$ROOT/build/polyhaven-raw"
W="$ROOT/build/room-work/bs"
OUT="$ROOT/epoch/web/static/app/room/assets/bs"
mkdir -p "$W" "$OUT" "$ROOT/epoch/web/static/app/room/assets/tex"
prep() { "$B" -b -P "$S/prep_asset.py" -- "$@" 2>&1 | grep -E "^\[prep\]|Error|Traceback" || true; }
pack() {  # pack <slot> <max texture px> <simplify ratio[:error] or 1>
  local i="$W/$1.glb" t; t="$(mktemp -d)"
  "$GT" dedup "$i" "$t/a.glb" >/dev/null
  if [ "$3" != "1" ]; then "$GT" weld "$t/a.glb" "$t/w.glb" >/dev/null; "$GT" simplify "$t/w.glb" "$t/a.glb" --ratio "${3%%:*}" --error "$( [[ "$3" == *:* ]] && echo "${3##*:}" || echo 0.002 )" >/dev/null; fi
  "$GT" prune "$t/a.glb" "$t/b.glb" >/dev/null
  "$GT" resize "$t/b.glb" "$t/c.glb" --width "$2" --height "$2" >/dev/null
  "$GT" webp "$t/c.glb" "$t/d.glb" --quality 85 >/dev/null
  "$GT" meshopt "$t/d.glb" "$OUT/$1.glb" --level high >/dev/null
  rm -rf "$t"
}
one() {  # one <slot> <ph id> <tex px> <simplify> [prep args...]
  local slot=$1 id=$2 px=$3 r=$4; shift 4
  prep "$PH/$id/${id}_1k.gltf" "$W/$slot.glb" "$@"; pack "$slot" "$px" "$r"
}
if [ "${1:-}" != "tex" ]; then
one plant_big   potted_plant_02          1024 0.1:0.03
one plant_small potted_plant_04          512  0.3:0.02
one books       book_encyclopedia_set_01 512  0.04:0.02
one frame1      hanging_picture_frame_01 512  1
one frame2      hanging_picture_frame_02 512  1
one frame3      fancy_picture_frame_01   512  1
one mirror      ornate_mirror_01         1024 0.2:0.01
one kettle      vintage_electric_kettle  512  0.15:0.02
one bowl        wooden_bowl_01           512  0.2
one apple       food_apple_01            256  0.06:0.05
one lemon       lemon                    256  0.15:0.05
one wallclock   wall_clock               512  1
one alarm       alarm_clock_01           256  0.12:0.02
one nightstand  ClassicNightstand_01     1024 1
one armchair    ArmChair_01              1024 1
one cafechair   painted_wooden_chair_01  512  1
one shelf       Shelf_01                 1024 1
one basket      wicker_basket_02         512  0.3 --scale 1.45
one laptop      classic_laptop           512  0.2:0.01 --scale 0.52
one vase        ceramic_vase_01          512  0.2:0.01
one candle      wooden_candlestick       256  0.006:0.02
one board       wooden_cutting_board     512  1
one coffeetable modern_coffee_table_01   1024 1
fi
# light LODs of two shared room assets for the brownstone's budget (the studio keeps the full ones)
lod() { local t; t="$(mktemp -d)"; "$GT" weld "$ROOT/epoch/web/static/app/room/assets/$1.glb" "$t/w.glb" >/dev/null; "$GT" simplify "$t/w.glb" "$t/s.glb" --ratio "$3" --error 0.01 >/dev/null; "$GT" meshopt "$t/s.glb" "$OUT/$2.glb" --level high >/dev/null; rm -rf "$t"; }
if [ "${1:-}" != "tex" ]; then lod lamp desklamp 0.25; lod chair officechair 0.3; fi
# shell textures: herringbone parquet (3.4 m tile) and white veined marble (1.5 m tile)
T="$ROOT/epoch/web/static/app/room/assets/tex"
for n in herringbone_parquet marble_01; do
  magick "$PH/$n/${n}_diff_1k.jpg" -quality 85 "$T/${n}_diff.webp"
  magick "$PH/$n/${n}_nor_gl_1k.jpg" -quality 90 "$T/${n}_nor.webp"
  magick "$PH/$n/${n}_arm_1k.jpg" -quality 90 "$T/${n}_arm.webp"
done
ls -la "$OUT" "$T"
