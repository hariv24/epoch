# Epoch v2 features: contract for the front-end (wave 2)

Backend written in wave 1; wave 2 styles the placeholder pages and builds the widgets that use
these endpoints. Everything here is **additive**. Nothing in the existing JSON shapes was
renamed or removed.

Conventions (unchanged): JSON bodies, `ok: true|false`. A correctable problem is HTTP 200 with
`{ok:false, hint:"..."}` (add `code` where a client may branch). Auth failures are 401/403 and
upload validation failures are 400/413, all with `{ok:false, hint, code}`.
Every state-changing request from a browser must carry a same-origin `Origin` (browsers do this
by themselves). Add the header `X-Witness-Client: <random id per tab>` to writes so the live
stream can tell you which events are your own (see the stream).

## 0. Files

| Area | Backend module | New templates (placeholders, restyle them) |
|---|---|---|
| LAN, pairing, devices | `epoch/lan.py`, `epoch/qr.py` | `pair.html`, `lan.html`, `_lan_panel.html` |
| Pomodoro | `epoch/pomodoro.py`, `epoch/live.py` | `pomodoro.html` |
| Weather | `epoch/weather.py` | none |
| Seasonal, flow, subway | `epoch/game.py` | none |
| Postcards, skyline | `epoch/web/app.py` | `postcards.html` |

`pair.html` is standalone (it does not extend `base.html`, because an unpaired device must not
see any app chrome or data). Everything else extends `base.html`.

## 1. Settings keys (all in the `settings` table, JSON values)

| key | default | notes |
|---|---|---|
| `lan_enabled` | `false` | bind `0.0.0.0` on next start. `.env` `EPOCH_LAN=1` forces it on |
| `weather_enabled` | `true` | `/api/weather` returns `enabled:false` when off |
| `seasonal_enabled` | `true` | when off `seasonal` lists are `[]` (the shelf still lists earned decor) |
| `soundscape` | `"off"` | `off \| rain \| cafe \| brown \| subway` (the client synthesises it) |
| `soundscape_volume` | `40` | integer 0..100 |
| `pomodoro_preset` | `"50-10-3"` | last preset id used |

`weather_enabled`, `seasonal_enabled`, `soundscape`, `soundscape_volume` are **game settings**: they
are read and written by the existing `POST /api/settings/game` (JSON) and `POST /settings/game`
(form), and returned in its `settings` object and in `settings_context.game_values`.
`lan_enabled` is separate and owner-only (section 2).

## 2. LAN / tablet mode (opt-in, off by default)

Who is who:

* **Owner**: a request from loopback (127.0.0.1, ::1) or from one of this Mac's own addresses.
  No cookie needed. This is the laptop.
* **Device**: a request from a private address (10/8, 172.16/12, 192.168/16, fe80::/10, fd00::/8)
  with a valid `witness_device` cookie, while LAN mode is on.
* Everyone else gets 403 (public address, LAN mode off) or is sent to `/pair` (unpaired private
  address). An unpaired device never receives any app data.

Binding: `main.py` binds `0.0.0.0` when `lan_enabled` is true or `EPOCH_LAN=1`, else
`127.0.0.1`. Changing the toggle needs a restart (`restart_needed: true` until then).
The Host header allowlist always accepts `localhost`, `127.0.0.1`, `::1`, `epoch` and `epoch.local` (any port; the last
two are for a hosts entry on the Mac, and `underdog` / `underdog.local` keep working too). It grows (only while LAN mode is on) to: any private IP literal, this Mac's
`<LocalHostName>.local`, and its bare host name.

Owner-only endpoints (a device gets 403 `owner_only`): everything under `/api/pair/new`,
`/api/lan`, `/api/devices*`, `/api/settings/lan`, `/settings/lan*`.

### 2.1 Endpoints

`GET /api/session` (everyone) ->
```json
{"ok": true, "role": "owner|device", "device": null | {"id": 3, "name": "Android tablet"},
 "lan": {"enabled": true, "active": true, "restart_needed": false}}
```

`GET /api/lan` (owner) ->
```json
{"ok": true, "enabled": true, "active": false, "restart_needed": true, "forced_by_env": false,
 "port": 8765, "hostname": "My-Mac.local",
 "urls": [{"kind": "ip", "url": "http://192.168.1.23:8765"},
          {"kind": "hostname", "url": "http://My-Mac.local:8765"}],
 "devices": [ ...device rows, see below... ],
 "pairing": null | {"expires_at": "2026-10-18T10:10:00Z", "seconds_left": 540}}
```
Android Chrome often cannot resolve `.local` names: `urls` lists the IP URL(s) first (the QR uses `urls[0]`); show the hostname as a second option. The hostname is lower-cased by the OS in practice.

`POST /api/settings/lan` `{"enabled": true}` (owner) -> same shape as `GET /api/lan`.
Form fallback: `POST /settings/lan` with `enabled=1|0` -> 303 `/settings/lan`.

`POST /api/pair/new` (owner) -> creates a one-time pairing, valid 10 minutes, replaces any
earlier unused one:
```json
{"ok": true, "code": "482913", "token": "R2f...22chars", "expires_at": "...Z", "ttl_seconds": 600,
 "url": "http://192.168.1.23:8765/pair?t=R2f...", "pair_page": "http://192.168.1.23:8765/pair",
 "urls": [ ...as above... ],
 "qr": {"svg": "<svg ...>...</svg>", "size": 33, "modules": ["0101...", "..."]}}
```
`qr.svg` is a self-contained `<svg viewBox>` using `fill="currentColor"` on dark modules and no
background (put it on a light tile; the 4-module quiet zone is included). `modules` is the
square matrix as strings of `0`/`1` rows if you would rather draw it yourself.
Form fallback: `POST /settings/lan/pair` re-renders `lan.html` with `pairing` in the context.

`GET /pair` (anyone allowed to reach the app) -> the pairing page (form with a 6-digit `code`).
`GET /pair?t=<token>` -> redeems the token: sets the cookie and 303s to `/`.
`POST /pair` (form: `code` or `t`, optional `name`) and `POST /api/pair/redeem` (JSON, same fields)
-> on success `Set-Cookie: witness_device=<256-bit token>; HttpOnly; SameSite=Strict; Path=/;
Max-Age=31536000` and 303 `/` (JSON: `{"ok": true, "device": {...}}`). Failure: the page again with
a plain message (400), or 429 after too many wrong codes. After 5 wrong tries a pairing is burned.

`GET /api/devices` (owner) -> `{"ok": true, "devices": [{"id": 3, "name": "Android tablet",
"user_agent": "...", "created_utc": "...Z", "last_seen_utc": "...Z", "last_ip": "192.168.1.40"}]}`
(only devices that are not revoked). `POST /api/devices/{id}/revoke` (owner) -> `{"ok": true}`; the
very next request from that device is sent to `/pair`. Form fallback:
`POST /settings/lan/devices/{id}/revoke` -> 303 `/settings/lan`.

Page `GET /settings/lan` (owner): renders `lan.html`; context key `lan` has the same data as
`GET /api/lan`. `settings_context` also carries `lan` and `_lan_panel.html` is the part to include
in the Settings page: `settings.html` already includes it at the end (restyle `_lan_panel.html` in place).

## 3. Pomodoro (server-side, shared by laptop and tablet)

Presets: `50-10-3` (default), `25-5-4`, `90-15-2`, `custom` (send `work_min` 1..240,
`break_min` 0..60, `cycles` 1..8). A run is `work, break, work, break, ..., work`: no break after
the last work block. One active run at a time (status `running`, `paused` or `waiting`).
The Custom numbers are remembered (setting `pomodoro_custom`; the state's `custom` is what the Custom card opens with).

State is derived from timestamps. Clients should compute the countdown from
`phase_ends_at - now` where `now = Date.now() + clock_offset` and `clock_offset =
server_epoch_ms - Date.now()` measured when the state arrived. While `paused` use
`remaining_seconds` as is.

`GET /api/pomodoro` (polling fallback; the stream carries the same object) ->
```json
{"ok": true, "server_now": "2026-10-18T08:00:03Z", "server_epoch_ms": 1792310403000, "rev": 17,
 "active": true,
 "run": null | {
   "id": 4, "preset": "50-10-3", "work_min": 50, "break_min": 10, "cycles": 3,
   "category": "Python", "label": "numpy broadcasting",
   "status": "running|paused|waiting|finished|stopped",
   "phase": "work|break|waiting|done", "cycle": 2, "phase_index": 2, "phase_count": 5,
   "phase_seconds": 3000, "elapsed_seconds": 840, "remaining_seconds": 2160,
   "base_seconds": 3000, "extra_seconds": 0, "last": false,
   "waiting": null | {"block_id": 9, "since": "...Z", "unrated": true, "minutes": 50},
   "paused": false, "phase_ends_at": "2026-10-18T08:36:03Z",
   "started_utc": "...Z", "next": {"phase": "break", "seconds": 600}},
 "awaiting_rating": true,
 "pending_ratings": [{"block_id": 9, "run_id": 4, "cycle": 1, "category": "Python", "label": "numpy",
                      "minutes": 50, "partial": false, "ended_utc": "...Z"}],
 "presets": [{"id": "50-10-3", "work_min": 50, "break_min": 10, "cycles": 3, "default": true}, ...],
 "default_preset": "50-10-3", "keep_awake": true}
```
`run` is the active run, or the most recent run if it finished/stopped within the last 2 hours
(`status` tells you), or `null`. `active` is true for `running|paused|waiting`.
`awaiting_rating` is true while any finished work block has not been rated.

**The hold.** When a work block ends the run does NOT go on by itself: it enters `status: "waiting"`
(`phase: "waiting"`, `phase_ends_at: null`, `remaining_seconds: 0`, `waiting` filled in) and nothing counts
down. The break (or the next block) starts when the person is done with that block: they rate it, drop it
("this didn't happen"), press `next` ("Start break", also "rate later"), or `extend` ("keep going"). So the
end-of-block card can stay open for any time without eating the break. After the last block the same hold
ends the run (`finished`) when answered. A hold nobody answers for 3 hours is closed by the housekeeping
(the finished block stays to be rated). A finished break starts the next work block by itself.

**More time.** `extend` adds minutes to the CURRENT phase (`extra_seconds`; reset when the phase changes):
during work, during a break, or from the hold (the still-unrated block is folded back into one longer block,
so the extra minutes are logged and rated with the rest). A phase can grow to 8 h (work) / 2 h (break).

After `stop` (or a run that finished) the state's `run` stays visible with `status: "stopped"|"finished"`,
`phase: "done"`, `phase_ends_at: null`, `next: null`, and `active: false` for two hours.

Writes (all JSON POST, all return `{"ok": true, "pomodoro": <state above>, ...}` or a hint):

| endpoint | body | notes |
|---|---|---|
| `POST /api/pomodoro/start` | `{preset?, work_min?, break_min?, cycles?, category, label?}` | hint `code: "already_running"` if a run or a legacy focus session is active |
| `POST /api/pomodoro/pause` | `{}` | `code: "not_running"` if nothing to pause |
| `POST /api/pomodoro/resume` | `{}` | |
| `POST /api/pomodoro/skip-break` | `{}` | only during a break ("End break early"); the next work block starts now |
| `POST /api/pomodoro/next` | `{}` | only while `waiting`: start the break / next block, or finish the run after the last block. The block stays to be rated. `code: "not_waiting"` otherwise |
| `POST /api/pomodoro/extend` | `{minutes: 1..60}` | "+5 min" (the UI offers 5, 10, 15; 5, 10 on a break). `bad_minutes`, `too_long`, `already_logged` |
| `POST /api/pomodoro/stop` | `{discard?: false}` | mid-work with >= 1 minute done: that partial block becomes a pending rating unless `discard` |
| `POST /api/pomodoro/rate` | `{block_id?, focus: "full\|mostly\|pulled_away", category?, note?}` | `block_id` defaults to the oldest pending. Creates the entry and returns the game step |

`rate` response adds: `entry` (`{id, category, minutes, deep, note}`), `events` (the usual game
events from `finish_write`), `today`, `level`, `toast` (exactly like `POST /api/log`). The entry is
`deep` unless `focus == "pulled_away"` (and the category is a ladder category or Tracker build),
source `focus`, and is linked to the run through `pomodoro_blocks.entry_id`.

No-JS fallback: `GET /pomodoro` renders `pomodoro.html` (context `pomodoro` = the state object,
`categories`, `presets`) with plain forms posting to `POST /pomodoro/{start|pause|resume|skip-break|stop|rate|discard|next|extend}`
(form fields as above, `discard=1` for stop) that 303 back to `/pomodoro?msg=...`.

Legacy focus: `/focus/start`, `/focus/stop`, `/api/focus/stop`, `/focus` and the Telegram `/focus`
still use the old `focus_sessions` table and keep working. They and the Pomodoro refuse to run at
the same time. `/focus/stop` and `/api/focus/stop` also stop/rate a Pomodoro run if that is what
is active. `today_context` gains `pomodoro` (the state object) and the old `focus` dict falls back
to the running Pomodoro work block, so the existing Today focus pill still shows it.

Keep-awake: the server spawns `caffeinate -i -w <server pid>` while a run is `running`
(start/resume), and kills it on pause/stop/finish. No-op off macOS. `keep_awake` in the state says
whether it is held.

## 4. Live stream

`GET /api/stream` is Server-Sent Events (`text/event-stream`). Works for owner and paired devices
(cookie). Query `?limit=N` closes after N messages (for curl/tests). Browsers reconnect by
themselves (`retry: 3000`). Messages:

```
event: pomodoro   data: <the /api/pomodoro object>        (on connect, on every change, and every <= 30 s)
event: game       data: {"seq": 12, "events": [...game events...], "origin": "<X-Witness-Client or null>", "at": "...Z"}
event: ping       data: {"t": "...Z"}                      (every 15 s so proxies keep the pipe open)
```
For a paired device the server re-checks the cookie about every 15 s: if the device was revoked (or LAN
mode was switched off) the stream ends, and the browser's automatic reconnect is then answered with 401/403.
Skip a `game` message when `origin` equals your own client id (you already played the events from
your write's response). A `game` message is published for every write that produced events (log,
output, rate, seal...). When a message arrives, refresh `/api/today` if you show it.
Polling fallback: `GET /api/pomodoro` every 5 s and `GET /api/today` on focus.

## 5. Weather: `GET /api/weather`

Open-Meteo (free, no key), New York (40.7128, -74.0060), cached ~20 minutes in memory and in the
`weather_cache` table, never raises.
```json
{"ok": true, "enabled": true, "available": true, "stale": false,
 "condition": "clear|clouds|rain|snow|fog|storm", "description": "Light rain",
 "temp_c": 11.2, "temp_f": 52.2, "is_day": true, "cloud_cover": 90, "precipitation_mm": 0.4,
 "wind_kmh": 14.4, "weather_code": 61,
 "local_time_ny": "2026-10-18T03:41:00-04:00", "local_hm_ny": "03:41",
 "fetched_at": "...Z", "source": "open-meteo"}
```
Offline with no usable cache: `available:false` and `condition, temp_c, temp_f, is_day, ... = null`
(`local_time_ny` is always present: it is computed locally). A cache up to 6 hours old is served
with `stale:true` when the network fails. With `weather_enabled` off: `{"ok":true,"enabled":false,
"available":false,"condition":null,...}` and no network call is made.

## 6. Seasonal decorations (cosmetic only)

`game.seasonal(date)` returns the active list; each item:
`{"key": "halloween", "name": "Halloween", "start": "2026-10-24", "end": "2026-10-31", "note": "..."}`.
Exposed as `seasonal` in `GET /api/today` and `GET /api/world`, and `GET /api/seasonal?date=YYYY-MM-DD`
(optional preview date, for trying a decoration) -> `{"ok": true, "date": "2026-10-28", "seasonal": [ ...items... ]}`. Keys:
`new_year` (Jan 1-3), `cherry_blossoms` (Mar 25 - Apr 20), `holi` (Holi day +/- 1 day),
`july_4th` (Jul 3-5), `india_independence_day` (Aug 14-15), `pride` (all of June),
`halloween` (Oct 24-31), `diwali` (Diwali day -2 .. +2), `nyc_marathon` (the first Sunday of
November), `thanksgiving_week` (Mon-Sun of the week with the 4th Thursday of November),
`holiday_lights` (Dec 1-26), `nye_ball_drop` (Dec 31). Holi and Diwali dates for 2026-2029 are
hard-coded in `game.py` with their sources.
`GET /api/shelf` gains `seasonal_decor`: `[{key, name, start, end, earned, active}]` for every
decoration window since the tracker started; `earned` is true when you logged something on any
day of the Monday-Sunday weeks the window touches ("earned by showing up").

## 7. Flow meter (no XP)

`game.flow(conn)` -> `{"minutes": 85, "hours_lit": 1, "best_today": 85, "best_hours": 1,
"active": true, "last_end": "...Z", "gap_limit_min": 20, "to_next_hour_min": 35, "span_minutes": 110}`.
The current chain is the latest run of ladder + deep entries today whose gaps are <= 20 minutes
(`minutes` counts only the productive time in the chain). `active` is false once the last entry
ended more than 20 minutes ago (then `minutes`/`hours_lit` are 0 and `best_today` keeps the
day's best). In `GET /api/today` as `flow`, and `GET /api/flow`. A game event
`{"kind":"flow","size":"tick","title":"An hour of flow","detail":"2 hours lit today.","fx":{"hours":2}}`
is produced by a write that makes `best_hours` grow.

## 8. Subway: `GET /api/subway` (and `subway` inside `GET /api/shelf`)

```json
{"lines": [{"ladder": "Python", "name": "Python line", "bullet": "P", "color": "#3b82f6",
            "landmark": "Bridge", "stations": [{"n": 1, "name": "Hello Loop", "unlocked": true,
            "needs_outputs": 1, "needs_deep_min": 0, "needs_link": 0, "status": "passed|next|ahead"}, ...],
            "train": {"position": 2.4, "at": 2, "progress": 0.4, "next_station": "NumPy Native"},
            "next_text": "Next node: 2 more outputs and 5h of Python.", "complete": false}, ...]}
```
`train.position` is in station units (0 = before station 1, 5 = at the last station).

## 9. Postcards (images made on the client canvas)

`POST /api/postcards` JSON `{"kind": "weekly|day", "period": "2026-10-12", "png_base64": "<base64 or data:image/png;base64,...>"}`
or multipart (`file` = PNG, `kind`, `period` fields). Max 4 MB decoded; must start with the PNG
signature and have a sane IHDR (16..4096 px per side). `period` is a date; for `weekly` it is
normalised to that week's Monday. One postcard per kind+period (a re-upload replaces it).
-> `{"ok": true, "postcard": {"id": "weekly-2026-10-12", "kind": "weekly", "period": "2026-10-12",
"created_utc": "...", "bytes": 123456, "width": 1200, "height": 800, "url": "/postcards/weekly-2026-10-12.png"}}`.
`GET /api/postcards` -> `{"ok": true, "postcards": [ ...newest first... ]}`.
`GET /postcards/{id}.png` -> the file (`Content-Disposition: attachment`, so it downloads; `?inline=1`
shows it). Page `GET /postcards` renders `postcards.html` (the list, download links, the "make one" nudge).
Sunday nudge: a scheduler slot `postcard` at 18:10 local on Sundays when the week has any activity
and no weekly postcard exists yet: "Your week's postcard is ready to make." (counts toward `msg_cap`).

## 10. Nightly skyline

`POST /api/skyline` JSON `{"png_base64": "...", "day": "YYYY-MM-DD"?}` (or multipart `file`, `day`),
sent by the client when the day is sealed. Saved to `skylines/YYYY-MM-DD.png` (`day` defaults to
today). If Telegram is configured the PNG is sent to the owner once per day with a caption from the
day recap ("Sat 17 Oct: 6 floors, 1h 30m deep, 1 output."). -> `{"ok": true, "skyline": {"day":
"2026-10-17", "url": "/skylines/2026-10-17.png", "bytes": 1234, "telegram": "sent|skipped|not_sent|not_configured"}}` (`skipped` = already sent for that day).
`GET /api/skylines` -> `{"ok": true, "skylines": [{"day","url","bytes"}]}`; `GET /skylines/{day}.png`.

## 11. DOM / page routes added

`/pair` (standalone), `/settings/lan`, `/pomodoro`, `/postcards`; no existing route changed.
Placeholder templates carry `data-js` hooks wave 2 can keep or replace:
`data-js="pomodoro-state"`, `data-js="pairing-qr"`, `data-js="device-list"`, `data-js="postcard-list"`.
