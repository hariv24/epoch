#!/bin/bash
# EEVEE contact sheet of the built people (verification): the user in every outfit, all NPCs, the user's face,
# and frames from several clips.   scripts/people/render_sheet.sh [out.png]   (needs ImageMagick: brew install imagemagick)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
S="$ROOT/scripts/people"
G="$ROOT/build/people-work/glb"
OUT="${1:-/tmp/underdog-shots/people-contact-sheet.png}"
T="$(mktemp -d)"
mkdir -p "$(dirname "$OUT")"
cd "$G"
"$B" -b -P "$S/render_views.py" -- --out "$T/a" --size 360 --angle 15 user/*.close.glb npc/*.close.glb >/dev/null 2>&1
"$B" -b -P "$S/render_views.py" -- --out "$T/f" --size 360 --close --angle 20 user/everyday.close.glb >/dev/null 2>&1
for ct in sit_type:0.3:60 walk:0.25:70 wave:0.4:20 sit_read:0.25:50 sit_sip:0.47:60 idle_look:0.25:20 point:0.5:70 sleep:0.3:55 kneel:0.6:60; do
  IFS=: read c t a <<< "$ct"
  "$B" -b -P "$S/render_views.py" -- --out "$T/c" --size 360 --angle "$a" --clips clips.glb --clip "$c" --t "$t" user/everyday.close.glb >/dev/null 2>&1
done
cd "$T"
magick montage f/*.png a/everyday.close.png a/columbia_hoodie.close.png a/nyu_hoodie.close.png a/plain_jersey.close.png \
  a/running_gear.close.png a/library_cardigan.close.png a/winter_coat.close.png a/navy_suit.close.png a/camel_overcoat.close.png \
  a/yellow_raincoat.close.png a/varsity_jacket.close.png a/npc_*.png c/*.png \
  -set label '%t' -tile 8x -geometry 220x308+2+2 -pointsize 11 -background '#1d2027' -fill '#dddddd' "$OUT"
echo "[render_sheet] $OUT"
