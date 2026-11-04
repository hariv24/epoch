---
name: Wall Street
vibe: green marble, gold money, up only. The Financial District after the closing bell.
palette:
  bg: "#07120D"          # page: verde-antico marble at night
  s1: "#0F1E17"          # cards
  s2: "#16291F"          # wells, inputs, XP track
  line: "#34361F"        # brass trim (card borders + clay ledges)
  ink: "#F4EFDF"         # ivory marble text
  muted: "#AEBDAC"
  amber: "#F5C542"       # gold: THE reward
  violet: "#E9DFC7"      # ivory marble clay: secondary buttons, links
  mint: "#3BE08E"        # uptick green: done
  focus: "#FFE59A"
---
# Wall Street

**Vibe:** the Financial District after the closing bell. Green marble lobby, brass rails, gold on the
reward, an uptick-green "done", and a ticker crawling down the side of the screen. Up only.

## Palette (dark first; light = white marble at noon)

| Role | Token | Dark | Light |
|---|---|---|---|
| Page | `--bg` | #07120D | #F3EFE4 |
| Card | `--s1` | #0F1E17 | #FFFFFF |
| Well / input / XP track | `--s2` | #16291F | #ECE5D2 |
| Brass trim (borders, card ledges) | `--line` | #34361F | #DCD1B6 |
| Brass rail (inputs, ghost ledges) | `--line-strong` | #857A45 | #7A6A3A |
| Text | `--ink` | #F4EFDF | #102519 |
| Muted | `--muted` | #AEBDAC | #4A5A4F |
| Reward (gold) | `--amber` / `--on-amber` | #F5C542 / #1A1200 | #A87A00 / #1A1200 |
| Secondary clay (ivory marble; ink-green in light) | `--violet` / `--on-violet` | #E9DFC7 / #10241A | #16402B / #FFFFFF |
| Done (uptick green) | `--mint` / `--on-mint` | #3BE08E / #03140B | #067A50 / #FFFFFF |
| Focus ring | `--focus` | #FFE59A | #16402B |
| Categories | `--c-*` | Python #6CB4FF, Math #B3A4FF, ML #3BE08E, Papers #FF8C6B, Writing #F58AE0, Drift #93A79A | |

### Measured contrast, dark (from `shots/wall-street-report.json`)

| Pair | Colours | Ratio | Min | |
|---|---|---|---|---|
| body text on page | `--ink` #F4EFDF on `--bg` #07120D | 16.58:1 | 4.5 | pass |
| body text on card | `--ink` #F4EFDF on `--s1` #0F1E17 | 14.99:1 | 4.5 | pass |
| text on well / ghost button | `--ink` #F4EFDF on `--s2` #16291F | 13.32:1 | 4.5 | pass |
| muted text on card | `--muted` #AEBDAC on `--s1` #0F1E17 | 8.76:1 | 4.5 | pass |
| muted text on page | `--muted` #AEBDAC on `--bg` #07120D | 9.69:1 | 4.5 | pass |
| placeholder in input | `--muted` #AEBDAC on `--s2` #16291F | 7.79:1 | 4.5 | pass |
| faint icons on card | `--faint` #8DA394 on `--s1` #0F1E17 | 6.4:1 | 3 | pass |
| amber button label | `--on-amber` #1A1200 on `--amber` #F5C542 | 11.45:1 | 4.5 | pass |
| violet button label | `--on-violet` #10241A on `--violet` #E9DFC7 | 12.29:1 | 4.5 | pass |
| mint button label | `--on-mint` #03140B on `--mint` #3BE08E | 11.04:1 | 4.5 | pass |
| active nav tab | `--amber-ink` #F5C542 on `--amber-soft` #2E2609 | 9.27:1 | 4.5 | pass |
| links on card | `--violet` #E9DFC7 on `--s1` #0F1E17 | 13:1 | 4.5 | pass |
| soft pill / callout | `--violet` #E9DFC7 on `--violet-soft` #24302A | 10.35:1 | 4.5 | pass |
| ok pill | `--mint` #3BE08E on `--mint-soft` #0F3622 | 7.79:1 | 4.5 | pass |
| amber callout text | `--ink` #F4EFDF on `--amber-soft` #2E2609 | 13.07:1 | 4.5 | pass |
| violet callout text | `--ink` #F4EFDF on `--violet-soft` #24302A | 11.92:1 | 4.5 | pass |
| toast (inverted) | `--bg` #07120D on `--ink` #F4EFDF | 16.58:1 | 4.5 | pass |
| focus ring on page | `--focus` #FFE59A on `--bg` #07120D | 15.37:1 | 3 | pass |
| focus ring on card | `--focus` #FFE59A on `--s1` #0F1E17 | 13.89:1 | 3 | pass |
| input border | `--line-strong` #857A45 on `--s2` #16291F | 3.55:1 | 3 | pass |
| Python glyph | `--c-python` #6CB4FF on `--s1` #0F1E17 | 7.89:1 | 3 | pass |
| Math glyph | `--c-math` #B3A4FF on `--s1` #0F1E17 | 7.94:1 | 3 | pass |
| ML/DL glyph | `--c-ml` #3BE08E on `--s1` #0F1E17 | 10.05:1 | 3 | pass |
| Papers glyph | `--c-papers` #FF8C6B on `--s1` #0F1E17 | 7.56:1 | 3 | pass |
| Writing glyph | `--c-writing` #F58AE0 on `--s1` #0F1E17 | 7.87:1 | 3 | pass |
| Rest glyph | `--rest` #B9AEFF on `--s1` #0F1E17 | 8.67:1 | 3 | pass |
| Drift glyph | `--c-drift` #93A79A on `--s1` #0F1E17 | 6.76:1 | 3 | pass |
| run flame | `--flame` #FF8A4C on `--s1` #0F1E17 | 7.38:1 | 3 | pass |
| XP bar fill vs track | `--amber` #F5C542 on `--s2` #16291F | 9.44:1 | 3 | pass |

Light mode: 29/29 pass. Tightest light pairs: ok pill 4.55:1, XP bar fill vs track 3.07:1, amber button label 4.82:1. Dark: 29/29 pass. External requests: 0, console errors: 0, broken icon refs: 0.

The light half fixes Night Clay's weak spot: the gold XP fill on the marble track is 3.07:1 (Night Clay light: 1.91:1).

## Background (three layers, all local SVG)

1. `body::before`: **verde-antico marble**. Hand-drawn veins (`bg-marble.svg`, about 1.1:1 against the page) plus a
   gold lamp glow top right and a green glow bottom left.
2. `body::after`: **the chart and the bank**. `bg.svg` is a price line that dips early (the ₹20k start) and then
   grinds to an all-time high marked by a gold dot, with a faint area fill and a Greek-revival colonnade in gold
   line art (generic, not a real building). It is anchored to the bottom and masked out towards the top, so it
   sits behind the lower cards, the footer and the Focus dial.
3. `.app::before`: **a ticker tape**, a vertical LED crawl down the right edge (`bg-ticker.svg`). It shows only at
   1240 px and wider, where nothing sits on top of it: `UDOG ▲ +12.4%  GRIND ▲ ATH  PY ▲ +45m  MATH ▲ +25m  COPE ▼ -100%
   NYU ◆ BUY  COLUMBIA ◆ BUY  PRINCETON ▲ LONG  DRIFT ▼ -3.1%  SLEEP ▼ -0.4h  WAGMI ▲ +∞`. It crawls (transform only)
   when motion is allowed, and is static under `prefers-reduced-motion` and `data-motion="off"`. The ticker
   uses system monospace inside the SVG; no web font is loaded.

## Icon: "Candle City"

A candlestick chart whose candles are towers. A short **red** candle (the dip, where you started), a taller **green**
candle with windows, then a **gold Art Deco tower** with two setbacks, a spire and a lit beacon, joined by a dotted
trend line. The chart is the skyline you are building. It is surprising because a finance chart turns into a
skyline when you look twice, and it tells the underdog story in three shapes. 32 px: same three candles plus the
beacon. 16 px: three rising bars, red, green, gold. `brand.svg` is the tile-less header mark; it gets a neutral
clay drop shadow (TWEAK) because the amber ledge looked wrong under red and green.

Rejected concepts (sketches in `sketches/`):
- **Closing Bell**: a gold bell with a ▲ cut-out and sound arcs. Bold, but at 32 px it reads as a notification icon.
- **Grind Note**: a tilted greenback with a tower in the portrait oval. Fun, but the note is a wide shape, so it gets
  small in a square and turns into a green smudge at 16 px.
- **Gold Bar**: an ingot stamped with a skyline under a green arrow. Reads as generic finance clip-art.
- The first Candle City had two windows on the red candle, which looked like eyes. It was redrawn with no windows there.

No bull (no animals), no NYSE or bank logos.

## Tweaks (4)
Glass chips over the city in green-black, gold dial glow on Focus, gold +XP float, neutral brand ledge. The tape's
motion rule is also marked TWEAK because the builder counts it as a component rule.

## Least sure about
The ivory marble secondary button is classy, but it is close to `--ink`, so links read as underlined ivory rather
than as a colour. The ticker is the loudest decoration; on very wide screens it might feel busy.
