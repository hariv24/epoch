#!/bin/bash
# Fetch + install everything the people build needs (build time only; the app never downloads anything).
#   scripts/people/fetch_assets.sh
# Downloads go to build/people-raw/ (gitignored, untrusted data: only extracted, never executed — except the MPFB2
# add-on, which is installed into Blender from its official source). Re-running skips what is already there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$ROOT/build/people-raw"
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
MH="https://files2.makehumancommunity.org/asset_packs"
mkdir -p "$RAW"/{mpfb,mh_system,packs/x,ual1,ual2}

# 1. Blender (free): brew install --cask blender   (built with 5.2.3 LTS)
[[ -x "$B" ]] || { echo "Blender missing: brew install --cask blender"; exit 1; }

# 2. MPFB2 (MakeHuman plugin for Blender, GPL-3) from the official Blender extensions platform
if ! "$B" -b --python-expr "import bl_ext.user_default.mpfb" >/dev/null 2>&1; then
  zip=$(ls "$RAW"/mpfb/add-on-mpfb-v*.zip 2>/dev/null | head -1 || true)
  if [[ -n "$zip" ]]; then
    "$B" -c extension install-file -r user_default -e "$zip"
  else
    "$B" -c extension install --sync -e mpfb     # https://extensions.blender.org/add-ons/mpfb/
  fi
fi

# 3. MakeHuman system assets (CC0) + the asset packs we use (CC0 / CC-BY), from the official asset-pack mirror
get() { if [[ ! -f "$2" ]]; then curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; fi; }
get "$MH/makehuman_system_assets/makehuman_system_assets_cc0.zip" "$RAW/mh_system/makehuman_system_assets_cc0.zip"
PACKS="bodyparts05_cc0 eyebrows01_cc0 eyelashes01_cc0 glasses01_cc0 hair01_cc0 hair02_ccby hair03_ccby hats01_cc0
hats03_cc-by pants01_cc0 pants02_ccby pants03_ccby shirts01_cc0 shirts02_ccby shirts03_ccby shoes01_cc0 shoes02_ccby
shoes03_ccby skins01_cc0 skins02_cc0 skirts01_cc0 suits01_cc0 system_clothes_materials01_cc0"
for p in $PACKS; do
  name="${p%_*}"
  get "$MH/$name/$p.zip" "$RAW/packs/$p.zip"
done
(cd "$RAW/packs" && shasum -a 256 -c SHA256SUMS)

# 4. Install the assets into MPFB's user data dir (plain file copies from the extracted zips)
DATA=$("$B" -b --python-expr "from bl_ext.user_default.mpfb.services.locationservice import LocationService as L; print('DATA=' + L.get_user_data())" 2>/dev/null | sed -n 's/^DATA=//p')
[[ -n "$DATA" ]] || { echo "could not locate the MPFB user data dir"; exit 1; }
[[ -d "$RAW/mh_system/extracted/clothes" ]] || unzip -q -o "$RAW/mh_system/makehuman_system_assets_cc0.zip" -d "$RAW/mh_system/extracted"
for p in $PACKS; do
  [[ -d "$RAW/packs/x/$p" ]] || unzip -q -o "$RAW/packs/$p.zip" -d "$RAW/packs/x/$p"
done
mkdir -p "$DATA"
for src in "$RAW/mh_system/extracted" "$RAW"/packs/x/*; do
  for d in clothes eyebrows eyelashes eyes hair packs proxymeshes skins teeth tongue; do
    [[ -d "$src/$d" ]] && rsync -a "$src/$d/" "$DATA/$d/"
  done
done

# 5. Quaternius Universal Animation Library 1 + 2 (CC0). The free downloads are behind a click on
#    https://quaternius.itch.io/universal-animation-library and https://quaternius.itch.io/universal-animation-library-2
#    (also quaternius.com/packs/universalanimationlibrary{,2}.html). Put the "Standard" zips in build/people-raw/ual1|ual2.
U1="$RAW/ual1/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"
U2="$RAW/ual2/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb"
for z in "$RAW"/ual1/*.zip; do [[ -f "$U1" || ! -f "$z" ]] || unzip -q -o "$z" -d "$RAW/ual1"; done
for z in "$RAW"/ual2/*.zip; do [[ -f "$U2" || ! -f "$z" ]] || unzip -q -o "$z" -d "$RAW/ual2"; done
[[ -f "$U1" && -f "$U2" ]] || { echo "Download UAL1 + UAL2 (Standard) zips into $RAW/ual1 and $RAW/ual2 (see comment)"; exit 1; }

# 6. Build-time node tools (glTF compression), never used at runtime
[[ -x "$ROOT/build/people-tools/node_modules/.bin/gltf-transform" ]] || \
  (mkdir -p "$ROOT/build/people-tools" && cd "$ROOT/build/people-tools" && npm init -y >/dev/null && \
   npm install --no-audit --no-fund @gltf-transform/cli@4 three@0.186.1)
echo "[fetch_assets] ok"
