#!/bin/bash
# Build Epoch.app: a double-click launcher that starts the Epoch server if it isn't running,
# then opens the app (the installed Chrome app window if there is one, else your default browser).
# Usage: ./scripts/make_launcher.sh            -> builds dist/Epoch.app
#        ./scripts/make_launcher.sh --desktop  -> also copies it to your Desktop
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$PROJECT/dist"
APP="$OUT/Epoch.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

cat > "$WORK/Epoch.applescript" <<APPLESCRIPT
-- Epoch launcher: starts the Epoch server if it is not running, then opens the app.
property projectDir : "$PROJECT"
property appURL : "http://127.0.0.1:8765"

on isRunning()
	try
		do shell script "curl -s --max-time 2 " & appURL & "/health | grep -q ok"
		return true
	on error
		return false
	end try
end isRunning

if not isRunning() then
	do shell script "cd " & quoted form of projectDir & " && nohup .venv/bin/python -m epoch >> data/epoch.log 2>&1 &"
	set ready to false
	repeat 40 times
		delay 0.5
		if isRunning() then
			set ready to true
			exit repeat
		end if
	end repeat
	if not ready then
		display dialog "Epoch didn't start. Look at data/epoch.log in the project folder." buttons {"OK"} default button 1 with icon caution
		return
	end if
end if

-- Prefer the Chrome app window if you installed Epoch from Chrome, otherwise the default browser.
set chromeApp to (POSIX path of (path to home folder)) & "Applications/Chrome Apps.localized/Epoch.app"
try
	do shell script "test -d " & quoted form of chromeApp
	do shell script "open " & quoted form of chromeApp
on error
	open location appURL
end try
APPLESCRIPT

rm -rf "$APP"
osacompile -o "$APP" "$WORK/Epoch.applescript"

# App icon: the Morning Side artwork. Render a crisp 1024 master with Chrome if available, else scale the 512 PNG.
SVG="$PROJECT/epoch/web/static/app/brand/icon.svg"
PNG512="$PROJECT/epoch/web/static/app/brand/icon-512.png"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MASTER="$WORK/icon-1024.png"
if [ -x "$CHROME" ]; then
  printf '<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:1024px;height:1024px}</style></head><body><img src="file://%s"></body></html>' "$SVG" > "$WORK/icon.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size=1024,1024 --screenshot="$MASTER" "file://$WORK/icon.html" >/dev/null 2>&1 || true
fi
[ -s "$MASTER" ] || sips -z 1024 1024 "$PNG512" --out "$MASTER" >/dev/null

ICONSET="$WORK/Epoch.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$MASTER" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$MASTER" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
# Recent macOS takes an applet's icon from its asset catalog (CFBundleIconName + Assets.car),
# which wins over applet.icns. Drop both so the bundle uses our icon file.
rm -f "$APP/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$APP/Contents/Info.plist"
# Swapping the icon invalidates osacompile's ad-hoc signature, so sign the bundle again.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
touch "$APP"

echo "Built $APP"
if [ "${1:-}" = "--desktop" ]; then
  rm -rf "$HOME/Desktop/Epoch.app"
  cp -R "$APP" "$HOME/Desktop/Epoch.app"
  echo "Copied to $HOME/Desktop/Epoch.app"
fi
