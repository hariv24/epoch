#!/bin/bash
# Install Epoch as a macOS login item (launchd user agent). Safe to run again.
set -euo pipefail

LABEL="com.epoch.tracker"
OLD_LABELS=("com.underdog.tracker" "com.witness.tracker")   # the names before the renames; removed if still installed
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$PROJECT/.venv/bin/python"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$PROJECT/data/epoch.log"
DOMAIN="gui/$(id -u)"

if [ ! -x "$PYTHON" ]; then
  echo "Python not found at $PYTHON. Create the virtualenv first." >&2
  exit 1
fi

mkdir -p "$PROJECT/data" "$HOME/Library/LaunchAgents"
# The log can mention private details, so only you may read it.
touch "$LOG"
chmod 600 "$LOG"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>-m</string>
    <string>epoch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null

# Remove the agents from before the renames, so two copies never fight over the port.
for OLD_LABEL in "${OLD_LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$OLD_LABEL" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
done

# Replace any copy that is already loaded, so running this twice just restarts it.
launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true

if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
  launchctl load "$PLIST"
fi

echo "Epoch installed and started. Open http://127.0.0.1:8765"
echo "Logs: $LOG"
