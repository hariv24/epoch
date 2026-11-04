# Underdog themes v2: the contract

Themes keep the **Night Clay form language**: clay buttons with double shadows, 16 to 30 px radii, Fredoka headings,
Nunito body, the layout and the playfulness. A theme changes three things:

1. **Colour**, by overriding the custom properties listed below.
2. **A decorated background**, through one subtle layer behind the cards.
3. **A fun, distinct app icon** that belongs to that theme only.

Every theme is previewed on a real snapshot of the app (`base/today.html`, `base/focus.html`, captured from a
seeded temp server) and compared with the reference theme `themes/night-clay/`, which is the current app unchanged.

```
node docs/themes-v2/build.mjs                 # all themes
node docs/themes-v2/build.mjs my-slug         # only yours (the gallery still lists every folder)
node docs/themes-v2/build.mjs my-slug --light # also shoot and measure light mode
node docs/themes-v2/build.mjs --no-shots      # previews + gallery only, no Chrome
open docs/themes-v2/index.html                # the review board
```

The builder runs on Node 22 or newer with Google Chrome, and needs no npm installs. It writes:

- `previews/<slug>-today.html` and `previews/<slug>-focus.html`. Both open straight from file://. A small bar in the corner links back to the gallery and switches light and dark.
- `shots/<slug>-today-1280.png` (full page), `shots/<slug>-focus-1280.png` (1280×800) and `shots/<slug>-today-390.png` (full page).
- `shots/<slug>-report.json`. It holds the **measured contrast** of 29 token pairs, the fonts that loaded, any broken icon references, external requests and console errors.
- `index.html`, the gallery.

The build exits 1 when a theme breaks a hard rule (a missing file, a remote URL, an animation without a reduced-motion guard, or a bad `city.json`).

---

## 1. The theme folder: `themes/<slug>/`

| File | Required | What it holds |
|---|---|---|
| `theme.css` | yes | Token overrides on `:root`. Optional background layer. At most a few documented component tweaks (see section 4). |
| `bg.svg` | optional | The decoration asset that `theme.css` uses (`url("bg.svg")`, relative to the theme folder). You can add more local files the same way. |
| `icon.svg` | yes | The app icon. Must use `viewBox="0 0 512 512"`, be full bleed (no transparent corners) and work as a **maskable** Android icon: everything that matters sits inside the central circle of radius 205 (80 %). |
| `icon-32.svg` | yes | A simplified cut for the favicon at 32 px and the header brand slot (34 px). Use any viewBox. |
| `icon-16.svg` | yes | The 16 px favicon cut: two or three shapes at most. |
| `brand.svg` | optional | A separate header mark (34 px, beside the word "Underdog"). Without it the header uses `icon-32.svg`. It is inlined, so the existing `.brand svg{filter:drop-shadow(0 3px 0 var(--amber-edge))}` applies; override it in a TWEAK if you don't want it. |
| `city.json` | yes | Colours for the 3D scene (section 5). |
| `notes.md` | yes | Name, a one-line vibe, the palette with roles, hex values and measured contrast, the background idea and the icon idea. Start with the front matter below, which the gallery reads. |

`notes.md` front matter (exact shape):

```markdown
---
name: Theme Name
vibe: one line, in the user's voice if it fits
palette:
  bg: "#0D1020"        # role note (optional)
  s1: "#161A33"
  ink: "#F4F2FF"
  amber: "#FFB224"     # reward colour
---
# Theme Name
...free text: palette table with measured contrast (copy the numbers from shots/<slug>-report.json),
background idea, icon idea and why it's surprising, any kanji with its meaning...
```

Start by copying `themes/night-clay/`.

---

## 2. The custom properties a theme sets (exact names)

All of them live on `:root` in `underdog/web/static/app/style.css`, and every component reads only these.
Write each one as `light-dark(<light>, <dark>)`, because the app has a light/dark switch. A theme that is
dark-first may keep the Night Clay light values for the light half, but must still give a pair.
The previews and screenshots are **dark**; `--light` measures and shoots light mode as well.

### Surfaces and text (the core: every theme sets these)
| Property | Night Clay (light, dark) | Used for |
|---|---|---|
| `--bg` | `#FFF7E8`, `#0D1020` | page background (`body`), toast text |
| `--s1` | `#FFFFFF`, `#161A33` | cards, pills, icon buttons, nav, chips |
| `--s2` | `#FFF0D6`, `#1F2447` | wells, inputs, ghost buttons, ring and XP tracks |
| `--line` | `#E9D9BC`, `#343A73` | card borders **and the clay "ledge"** under cards and pills (`0 2px 0 var(--line)`) |
| `--line-strong` | `#857CB0`, `#6870B5` | input borders, ghost button ledge, dashed notes |
| `--ink` | `#1C1A3A`, `#F4F2FF` | body text, toast background |
| `--muted` | `#555A86`, `#A8AEDC` | secondary text, placeholders, nav labels |
| `--faint` | `#6B6F96`, `#9AA1D2` | input icons, quiet glyphs |

### Reward and action colours (the clay buttons)
| Property | Night Clay | Used for |
|---|---|---|
| `--amber` | `#F59E0B`, `#FFB224` | THE reward colour: primary `.btn`, XP fill, level badge, outer ring arc, focus dial |
| `--amber-edge` | `#A15C00`, `#C47F00` | the clay ledge under amber buttons and the badge, the brand drop-shadow |
| `--on-amber` | `#1A1000` | label on amber buttons |
| `--amber-ink` | `#8F4F00`, `#FFB224` | amber used as text (active nav tab) |
| `--amber-soft` | `#FFE2A8`, `#3A2A0C` | active nav tab, amber callouts, pressed icon buttons |
| `--violet` | `#5B4BDB`, `#9A8CFF` | secondary buttons, links, checked chips, inner ring arc |
| `--violet-edge` | `#3B2FA8`, `#5B4BDB` | ledge under violet buttons |
| `--on-violet` | `#FFFFFF`, `#0D0A33` | label on violet buttons |
| `--violet-soft` | `#E7E3FF`, `#2A2860` | soft pills, callouts, nudges |
| `--mint` | `#067A50`, `#46E0A0` | done / floor reached, break phase |
| `--mint-edge` | `#04543A`, `#1FA872` | ledge under mint buttons |
| `--on-mint` | `#FFFFFF`, `#04130C` | label on mint buttons |
| `--mint-soft` | `#D9F6E8`, `#10382B` | completed quest rows, ok pills |
| `--flame` | `#C2410C`, `#FF8040` | run-streak flame icon |
| `--sky` | `#0369A1`, `#5CC8FF` | weather and sky accents |
| `--rest` | `#6B5FB5`, `#B5AAFF` | rest hours |
| `--error` | `#B42318`, `#FF8F8F` | form validation only (never for missed days) |
| `--focus` | `#5B4BDB`, `#C9C2FF` | the 3 px focus ring |

### Category colours (the ladder; chips, wins feed, log dots)
`--c-python` (`#2F6FED`, `#6CB4FF`), `--c-math` (`#6D4FE0`, `#A99BFF`), `--c-ml` (`#067A50`, `#46E0A0`),
`--c-papers` (`#D4492B`, `#FF8A6B`), `--c-writing` (`#B8239B`, `#F58AE0`), `--c-drift` (`#6B6F96`, `#9AA1D2`).
Keep the five ladder colours **distinct from each other**, recognisable (blue-ish Python, violet-ish Math,
green-ish ML, warm Papers, pink-ish Writing), and at least 3:1 on `--s1`. Never make Drift red.

### Depth, clay shadows and glows
| Property | Night Clay | Used for |
|---|---|---|
| `--lift` | `rgb(60 40 110 / .22)`, `rgb(0 0 0 / .55)` | the soft drop shadow of every clay element |
| `--gloss` | `rgb(255 255 255 / .75)`, `rgb(255 255 255 / .10)` | the inset top highlight (the "clay sheen") |
| `--scrim` | `rgb(28 26 58 / .45)`, `rgb(5 6 18 / .72)` | dialog backdrop |
| `--glow-a` | `#FFE3B0`, `#2A2466` | top-right radial glow in `body::before` |
| `--glow-b` | `#E7E3FF`, `#14305E` | bottom-left radial glow in `body::before` |

**Clay shadow tokens.** These are composites of the colours above. A theme normally leaves them alone and gets the right ledge colour from `--line`, `--gloss` and `--lift`:
`--e-1` (cards), `--e-2` (hero cards), `--e-3` (toasts, sheets), each built as
`inset 0 Npx 0 var(--gloss), 0 Npx 0 var(--line), 0 Mpx Kpx -Jpx var(--lift)`.
Buttons build their shadow from `--bg-c`, `--edge` and `--fg` (set per variant from the amber, violet or mint tokens) with
`inset 0 2px 0 rgb(255 255 255/.45), inset 0 -4px 8px rgb(0 0 0/.10), 0 5px 0 var(--edge), 0 14px 22px -8px var(--lift)`.

**Do not change:** `--font-*`, `--fs-*`, `--space-*`/`--sp-*`, `--r-*`, `--card-pad`, `--section-gap`,
`--item-gap`, `--tap`, `--dur-*`, `--ease-*` and `--z-*`. Those make up the form language the user likes.

### Colours that are hard-coded in style.css (no token, so only a TWEAK can change them)
| Where | Value | Note |
|---|---|---|
| `.stage` (3D container before WebGL paints) | `linear-gradient(#171a40,#3b2a6b)` | Use `city.json` → `stageBg` instead; the builder applies it. |
| `.stage__badge .pill`, `.stage__tools .icon-btn`, `.camtag` (glass chips over the city) | `rgb(13 16 32/.7)`, white text | Allowed TWEAK. |
| `.focus` dial glow | `--arc-glow: rgb(255 178 36/.28)` (amber), break `rgb(70 224 160/.22)` | Set `.focus{--arc-glow:…}` if your `--amber` changes (allowed TWEAK). |
| `.floaty` (+XP float) | `text-shadow … rgb(255 178 36/.55)` | Allowed TWEAK. |
| `.lightsout` | `#05061a` | Leave it. |
| `.btn` gloss, `.xp__fill::after` shine | white alpha | Leave it (this is the clay). |
| `.dial__dot`, `.train__bullet` | `#fff` | Leave it. |
| `.fallback …` (SVG city when WebGL is off) | various | Out of scope. |

---

## 3. Background decoration

Today the page is a flat `--bg` with two glows (`body::before`). A theme adds a real decoration:

- Use **`body::after`** (free) and/or replace **`body::before`** (the glows). Both must be
  `position:fixed; inset:0; z-index:-1; pointer-events:none`. A `.bg…` layer is also allowed, but there is no
  element for it in the app, so prefer the pseudo-elements. On the Focus Screen, `.focus::before` is the
  dial glow: keep it or restyle it.
- Point assets at local files only: `url("bg.svg")` or an inline `data:image/svg+xml,…`. No CDN, no
  `@import`, no remote fonts.
- **Readability first.** Cards (`--s1`) are opaque, so the decoration only shows between and around them. Keep it
  low-contrast (roughly ≤ 1.3:1 against `--bg`, or opacity ≤ .35), and fade it towards the content column.
  For example, mask it with `mask-image: radial-gradient(...)` or `linear-gradient(to bottom, #000, transparent)`.
  Body text on `--bg` must stay ≥ 4.5:1 *at every point of the decoration*.
- Motion is optional. If the layer animates, wrap it in `@media (prefers-reduced-motion: no-preference)` and
  also stop it under `:root[data-motion="off"]`. Animate only transform and opacity. The builder errors on
  `@keyframes` or `animation` without a `prefers-reduced-motion` guard.
- It must work at 390 px wide, with no horizontal scroll.

## 4. Component tweaks (keep them few)

Anything in `theme.css` that is not a `:root` token block or a background layer is a *component tweak*. Each one
must sit directly under a comment that starts with `TWEAK`:

```css
/* TWEAK: glass chips over the city match the new night */
.stage__badge .pill, .camtag{ background: rgb(20 8 30 / .72) }
```

The builder warns about tweaks without that comment and about more than 12 of them. Never change layout, spacing,
radii, fonts or component structure. The allowed decoration selectors (no comment needed) are `:root…`, `html`,
`body`, `body::before/::after`, `.app::before/::after`, `.shell::before/::after`, `.bg…`,
`.focus::before/::after`, `.stage::before/::after` and `.stage > .snap-city`.

Snapshot-only hooks: in the previews the 3D canvas is a still image `img.snap-city` inside `.stage`, and
`.stage::after` is a tint layer driven by `city.json` → `previewTint`. In the real app the scene is recoloured
from `city.json` itself, so use `previewTint` only to approximate that and don't rely on `.snap-city` for anything else.

## 5. `city.json` (the 3D scene)

```json
{
  "skyTop": "#050A1E",      "skyMid": "#0B1A40",   "skyBottom": "#183062",
  "fog": "#202050",
  "windowWarm": "#FFCC6B",  "windowCool": "#B8DBFF",
  "accent": "#FFB224",      "beacon": "#FFB224",
  "stageBg": ["#171A40", "#3B2A6B"],
  "previewTint": { "css": "linear-gradient(var(--city-sky-top), var(--city-sky-bottom))", "blend": "color", "opacity": 0.35 }
}
```

| Key | Required | Maps to in the app |
|---|---|---|
| `skyTop`, `skyMid`, `skyBottom` | top and bottom required | night key of `city/sky.js` KEYS (top, mid, horizon) |
| `fog` | yes | `scene.fog` colour in `city.js` |
| `windowWarm`, `windowCool` | yes | lit-window colours in `city/shader.js` (warm majority, about 6 % cool) |
| `accent` | yes | blueprint, crane and today highlight |
| `beacon` | yes | rooftop beacon for a shipped output |
| `stageBg` | optional | `.stage` gradient shown before WebGL paints (also applied in the previews) |
| `previewTint` | optional, `null` for none | preview only: a blend layer over the city still (`css` defaults to the sky gradient; `blend` is any `mix-blend-mode`; `opacity` 0 to 1) |

All colours are `"#RRGGBB"`. The builder also exposes them as `--city-sky-top`, `--city-sky-mid`,
`--city-sky-bottom`, `--city-fog`, `--city-window-warm`, `--city-window-cool`, `--city-accent` and `--city-beacon`
in the previews, so `theme.css` can use them.

## 6. Icons: the brief

Every theme gets its own **distinct, surprising** icon that captures its vibe. No shared mark is required.

- **No dogs, no animals, no mascots, no faces.** The user said the dog "looks stupid". The fun comes from clever
  concepts and bold sticker, clay, neon or print treatments of places, objects, light and signage. An
  "underdog rising / building your NYC" undertone is welcome where it fits.
- Flat, bold, high contrast, characterful. Check it at 180, 64, 32 and 16 px: the gallery shows all four, Android
  circle and squircle masks, the maskable safe zone, a light home screen and a browser tab.
- Must be maskable: a full-bleed background, and the key shapes inside the central 80 % circle.
- **Do not reproduce trademarks**: no university logos, crests, wordmarks, the NYU torch or the Columbia crown.
  Evoke them through colour, architectural line art and motifs.
- Japanese text must be correct and simple, with its meaning in an SVG comment and in notes.md. Prefer
  turning lettering into paths (the builder warns on `<text>` in icons, because fonts differ by device).
- Inline SVG only: no `<image href="http…">`, no scripts, no external fonts.

## 7. Accessibility gates (measured by build.mjs, reported in the gallery)

| Pair | Minimum |
|---|---|
| `--ink` on `--bg` / `--s1` / `--s2` / `--amber-soft` / `--violet-soft` | 4.5:1 |
| `--muted` on `--s1` / `--bg` / `--s2` | 4.5:1 |
| `--on-amber` on `--amber`, `--on-violet` on `--violet`, `--on-mint` on `--mint` (button labels) | 4.5:1 |
| `--amber-ink` on `--amber-soft`, `--violet` on `--s1` and on `--violet-soft`, `--mint` on `--mint-soft`, `--bg` on `--ink` (toast) | 4.5:1 |
| `--focus` on `--bg` / `--s1` | 3:1 |
| `--line-strong` on `--s2` (input border), `--faint` on `--s1` | 3:1 |
| `--c-*`, `--rest`, `--flame` on `--s1`; `--amber` on `--s2` (XP bar) | 3:1 |

Night Clay passes 29/29 in dark mode. In light mode it passes 28/29: amber XP fill on the cream track is 1.91:1,
an existing weakness, so don't copy it. Measured values land in `shots/<slug>-report.json`; copy them into notes.md.

## 8. Rebuilding the snapshot (only if the app's markup changes)

```bash
D=$(mktemp -d)
UNDERDOG_DATA_DIR=$D .venv/bin/python docs/themes-v2/tools/seed.py          # ~10 days of realistic study data
UNDERDOG_DATA_DIR=$D UNDERDOG_PORT=8752 TELEGRAM_BOT_TOKEN= OPENROUTER_API_KEY= .venv/bin/python -m underdog &
node docs/themes-v2/tools/capture.mjs http://127.0.0.1:8752 today            # base/today.html + assets + city.png
UNDERDOG_DATA_DIR=$D .venv/bin/python docs/themes-v2/tools/seed.py --focus-run  # a run that began 18 min ago
node docs/themes-v2/tools/capture.mjs http://127.0.0.1:8752 focus            # base/focus.html + city-cam.png
```

Use ports 8750 to 8759 only, never 8765 (the live app), and kill only your temp server afterwards. `capture.mjs`
copies `style.css`, the vendored fonts and the icon sprite into `base/assets/`, inlines the sprite (file:// blocks
external `<use>`), strips every script, makes links inert and puts a 2× still of the real 3D city
(`base/assets/city.png`, `city-cam.png`) where the canvas was.
