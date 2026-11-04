#!/bin/bash
# Stop Epoch and remove its launchd agent. Your data in data/ is left untouched.
set -euo pipefail

LABEL="com.epoch.tracker"
OLD_LABELS=("com.underdog.tracker" "com.witness.tracker")
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
for OLD_LABEL in "${OLD_LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$OLD_LABEL" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/$OLD_LABEL.plist"
done

echo "Epoch removed from launchd. Your data was not touched."
