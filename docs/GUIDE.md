# Epoch user guide

The long version of the [README](../README.md): launchers, backups, daily routine, tablet mode, the XP table, settings and privacy. Written for the earlier four-tab layout in places; the newer Money tab and cozy room are described in [ECONOMY.md](ECONOMY.md) and [COZY.md](COZY.md).

## One-click launcher (Mac)

```bash
./scripts/make_launcher.sh --desktop
```

This builds `Epoch.app` (with the Epoch icon) and puts it on your Desktop. Double-click it: if the server isn't running it starts it, then opens Epoch (in the Chrome app window if you installed one, otherwise your browser). The first time, macOS asks whether Epoch may access your Desktop folder; choose Allow. Drag it to the Dock if you like.


## Start automatically at login

```bash
./scripts/install_launchd.sh      # install and start
./scripts/uninstall_launchd.sh    # remove it again
```

The app restarts itself if it stops, and writes its log to `data/epoch.log`.


## Backups

Set `EPOCH_BACKUP_DIR` in `.env` to a folder inside iCloud Drive or Google Drive, for example `~/Library/Mobile Documents/com~apple~CloudDocs/epoch-backups`. At 03:30 every night, while the app is running, it copies the database to `witness-YYYY-MM-DD.db` in that folder and keeps the last 14 copies. Your data is the single file `data/witness.db` (the file keeps its old name so nothing has to move), so you can also copy that by hand.


## The four tabs

On a phone the tabs are a bar at the bottom. On a computer (900 px wide or more) they are a rail on the left.

- **Today.** The log is the main thing: type a line such as `45m numpy ex 1-12` and press Enter, or tap a length and a kind of hour. Last-used logs show as one-tap repeat buttons. Below it are the ring (the floor and the target), the week's skyline, "Today's three" small quests, a facts-only wins feed and today's log. Focus timer, "I shipped something" and Plan live here too. If you missed yesterday, a banner opens the lapse sheet.
- **Close.** In the evening a small dot appears on this tab. Record your day job in one click, label each unlogged stretch (ActivityWatch suggests labels if it runs; "Don't remember" is a fine answer), then **Seal the day** to get the recap.
- **World.** Three views: **City** (your year as towers: every day since Day 1 has its own permanent real lot in Morningside Heights and the northern Upper West Side, a row of 7 per week; a day without study stays an empty lot; with fly-to buttons and the districts you have unlocked), **Week** (this week's card, you against your last week, the referee report, keep/raise/lower the contract, the 168-hour hour map) and **Shelf** (achievements, five ladders with landmarks, every output you shipped with link, public toggle and delete, postcards and street decor).
- **Settings.** Game toggles (below), your schedule, floor and targets, and the status of Telegram, the free LLM and ActivityWatch.

Old addresses such as `/week`, `/grid` and `/outputs` still work and take you to the matching World view. `/plan`, `/focus` and `/lapse` are plain pages that work without JavaScript.


## Daily use

- **Morning.** Optional. On Today press **Plan** and pick tonight's blocks (a few at most, each with a category, minutes and a start time). Epoch writes each one as an if-then sentence such as "IF it's 19:30 and I'm home, THEN I open chapter 6." "Floor only" plans just the minimum.
- **During the day.** Log on Today. Use Focus to time a session; it also keeps block-end nudges quiet while it runs.
- **Ship something.** When you finish something others could see (a repo, a post, a notebook), press "I shipped something". One output counts as the day's floor.
- **Evening.** Open **Close**, settle the gaps and seal the day.
- **After a missed day.** The lapse sheet asks what got in the way, lets you use a skip, repair within two days, or let it go, and sets the smallest version of today.
- **Sunday.** Open World > Week to see whether the week was kept. Keep, raise or lower the weekly contract there. Raising applies now; lowering starts next Monday.


## What is new in version 2

- **Focus Screen** (`/pomodoro`, the **Focus** tab). A full-screen timer for a second screen: a huge dial, 50/10, 25/5 and 90/15 rhythms, pause, resume, skip the break and stop. A calm break screen, and a rating sheet when a block ends (Full focus, Mostly, Pulled away) that logs the block and plays the usual celebration. Several screens follow the same timer live.
- **Construction cam.** While a block runs, a crane builds the new floors on today's tower in the 3D city. Rate the block and the crew tops it out.
- **A living city.** Live New York weather (Open-Meteo, free, no key) with clouds, rain, snow, fog and storms; seasonal decorations (Halloween, Diwali, Thanksgiving, holiday lights, New Year, Holi, cherry blossoms and more); and a flow meter of streetlights that light up while you stay in flow.
- **Soundscapes.** Soft chimes at phase changes, plus rain, cafe, brown noise and subway sounds made in the browser (off by default, with a volume slider).
- **Subway lines.** World > Lines shows each ladder as a subway line, with your train at its station.
- **Postcards and nightly skyline.** World > Week makes a weekly airmail postcard from your 3D city (saved in `data/postcards/`). Sealing the day saves a night render of your skyline in `data/skylines/` and sends it to Telegram if that is set up.
- **Your tablet.** An opt-in tablet mode with one-time pairing (below).


## Use it on your tablet

Epoch works well as a second screen: the Focus Screen on a tablet next to your laptop, following the same timer.

1. On the computer open **Settings > Use on your tablet** and turn **Tablet mode** on. (Or put `EPOCH_LAN=1` in `.env`.)
2. **Restart Epoch.** The server only starts listening on your Wi-Fi at start-up.
3. The first time, macOS asks whether `python` may accept incoming connections. Choose **Allow**. If you missed the prompt, allow it in System Settings > Network > Firewall.
4. On the tablet (same Wi-Fi), open `http://<name>.local:8765`, for example `http://my-mac.local:8765`. Settings shows the exact addresses. Some Android browsers cannot resolve `.local` names; if so, use the number address shown first, such as `http://192.168.0.101:8765`.
5. **Pair it.** On the computer press **Pair a device** in Settings. On the tablet scan the QR code, or type the six-digit code on the page the tablet shows. The code works once and lasts 10 minutes. The tablet gets a long-lived cookie and opens the Focus Screen.
6. **Add to Home screen.** In Android Chrome open the menu and choose **Add to Home screen** (or **Install app** where Chrome offers it). Epoch then opens full screen on the Focus Screen.
7. **Keep the screen on.** Set the tablet's screen timeout to its longest value (Settings > Display), and tap the full-screen button on the Focus Screen. While a run is going the page also asks the tablet to stay awake, which Chrome only allows on secure (https or localhost) pages, so the timeout setting is the reliable part. On the Mac, Epoch keeps the computer awake while a run is going.

Good to know:

- Only paired devices get in. An unpaired device on your network sees the pairing page and nothing else. Paired devices cannot change settings, pair others or list devices. Revoke any device in Settings and its open screens are cut off within about 15 seconds.
- Nothing outside your home network can reach it: the server refuses addresses that are not private, and ignores forwarding headers.
- It is plain `http` on your home network. Do not turn tablet mode on for a shared or public Wi-Fi.
- Never expose this port through a tunnel or reverse proxy (ngrok, cloudflared, nginx, Tailscale funnel). Those arrive as the local computer, so they would bypass pairing. Epoch refuses requests that carry proxy headers, but that is a safety net, not a feature.
- Paired devices also cannot change the Settings form, the Sunday report buttons or the activity rules, and a device that goes 90 days unused has to be paired again.
- Turn tablet mode off in Settings (and restart) to go back to `127.0.0.1` only.


## What earns XP

XP is a progress readout toward the next district of Manhattan (the walk starts at Morningside Heights, your own block and Columbia, and lights up Harlem, the Upper West Side, Central Park and on down the island; the last level is Billionaires' Row, with a home that has Central Park in the window). It is not a currency: nothing is spendable, and displayed XP never goes down, even if you delete an entry. All numbers are first estimates and can be tuned in `epoch/game.py`.

| Source | XP |
|---|---|
| Deep minutes (study categories) | 1 per 4 minutes, up to the daily cap (240 minutes, so at most 60 XP a day) |
| A floor day | +10 |
| A target day | +15 |
| A shipped output | +100 (+25 more with a link), for the first 3 outputs of a day |
| A comeback day (a floor day after a missed or repaired day) | +30 |
| Sealing the day (any content counts, even an all-"Don't remember" day) | +10 |
| A kept week | +100 |
| A ladder node (a landmark section) | +50 |

Deliberately **no XP** for plain logging, rest hours, "Don't remember", and Distracted ("20m youtube"). They are recorded honestly and show up as a lamp or a park in your city, never as a penalty. Achievements and quests give recognition, not XP. Hours past the daily cap are shown but not counted.


## Game settings

On **Settings** (all of them also work without JavaScript through a Save button):

- **Game layer.** Off gives a plain tracker with no levels, quests or celebrations.
- **Quiet mode.** Hides XP, levels, quests, the run pill and the confetti. The city, the ring and your log stay.
- **Sound.** **Off by default.** When on, tiny synthesized blips are played (no sound files). The speaker button in the header toggles it too.
- **Motion.** Auto follows your system's reduced-motion setting; Off snaps every animation and stops confetti.
- **3D city.** Off shows a flat skyline instead of WebGL. It also falls back on its own if WebGL is not available.
- **Sky clock.** Evening sky by your time or by New York time.
- **Weather** and **Seasonal decorations** (on by default), the **soundscape** and its volume.
- **Tablet mode** (off by default, see above).
- **Hide achievements**, and **Appearance** (Auto, Light, Dark, saved in your browser).

Big celebrations are kept rare on purpose: a daily confetti cap applies, and the hourly log only gets a small receipt. The wording of every message is checked by the tests against a list of banned words (no "failed", "wasted", "lazy" and so on).

Everything works with JavaScript turned off: every page renders and every form (log, ship, focus, plan, close, seal, settings) is a normal form post.


## Upgrading from the earlier versions (Underdog, Witness)

Nothing to do. On start the app adds a few tables (`unlocks`, a record of what has been celebrated, and the version 2 tables for devices, Pomodoro runs, the weather cache, postcards and skylines) and keeps all your entries, outputs, plans and settings. Nothing is renamed or removed, so you can still go back. History you earned before the upgrade is recorded silently, so it does not fire a pile of celebrations or show as "just now" in the wins feed.


## Privacy

- Everything stays on your Mac: the web app, the SQLite database and the schedule. There is no cloud account. The one other thing the app fetches is the New York weather from Open-Meteo (a fixed New York position, no key, nothing about you); turn it off with the Weather switch in Settings.
- Tablet mode is off until you turn it on, and then only devices you paired can open Epoch.
- ActivityWatch data is read locally. Window titles, website addresses and app names are never sent to any LLM. The LLM only ever sees text you typed yourself, your plan items and summary numbers.
- Free OpenRouter models may log or train on what they receive. If that bothers you, leave `OPENROUTER_API_KEY` empty and the app runs on plain rules.
- Telegram messages pass through Telegram's servers like any other bot. Skip Telegram if you do not want that.
- `.env` and `data/` are listed in `.gitignore`. Keep your token out of anything you share.


