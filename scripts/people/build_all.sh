#!/bin/bash
# Rebuild every Epoch person + the shared clips, compress, write manifest/LICENSES, render the contact sheets.
#   scripts/people/build_all.sh            # everything
#   scripts/people/build_all.sh chars      # characters only (no clips / renders)
# Needs: Blender 5.2 (/Applications/Blender.app), the MPFB2 extension + asset packs installed (scripts/people/fetch_assets.sh),
#        node + build/people-tools (npm i @gltf-transform/cli@4 three@0.186.1, build-time only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PY="$ROOT/.venv/bin/python"
GT="$ROOT/build/people-tools/node_modules/.bin/gltf-transform"
S="$ROOT/scripts/people"
OUT="$ROOT/epoch/web/static/app/people"
RAW="$ROOT/build/people-work/glb"
what="${1:-all}"
ids() { "$PY" -I -c "import sys; sys.path.insert(0, '$S'); import specs; print(' '.join($1))"; }

if [[ "$what" == all || "$what" == chars ]]; then
  for o in $(ids "specs.OUTFITS"); do
    "$B" -b -P "$S/build_character.py" -- --id user --outfit "$o" 2>&1 | grep -E "^\[build\]|Error|Traceback" || true
  done
  for n in $(ids "x['id'] for x in specs.NPCS"); do
    "$B" -b -P "$S/build_character.py" -- --id "$n" 2>&1 | grep -E "^\[build\]|Error|Traceback" || true
  done
fi
if [[ "$what" == all || "$what" == clips ]]; then
  "$B" -b -P "$S/build_clips.py" 2>&1 | grep -E "^\[clips\]|Error|Traceback" || true
  "$PY" -I "$S/strip_clip_tracks.py" "$RAW/clips.glb"
fi
# meshopt (EXT_meshopt_compression + KHR_mesh_quantization); decoder: vendor/three/addons/libs/meshopt_decoder.module.js
mkdir -p "$OUT/user" "$OUT/npc"
(cd "$RAW" && for f in user/*.glb npc/*.glb clips.glb; do
  [[ -f "$f" ]] || continue
  "$GT" meshopt "$f" "$OUT/$f" --level high >/dev/null
done)
"$PY" -I "$S/write_manifest.py"
echo "[build_all] done: $(du -sh "$OUT" | cut -f1) in $OUT"
