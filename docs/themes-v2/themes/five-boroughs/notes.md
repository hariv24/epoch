---
name: Five Boroughs
vibe: one city, every colour. A summer-night block party where every borough brings a colour.
palette:
  bg: "#160C1E"          # plum night
  s1: "#22142C"          # cards
  s2: "#2D1B3A"          # wells, inputs, XP track
  ink: "#FFF4E6"         # warm white
  muted: "#C9B9D8"
  amber: "#FFC93C"       # Manhattan taxi yellow: THE reward
  violet: "#FF6FB1"      # Bronx pink: secondary buttons, links
  mint: "#2FE0BE"        # Queens teal: done
  flame: "#FF8A2A"       # Staten Island ferry orange
  sky: "#6FA0FF"         # Brooklyn blue
  focus: "#8CF0DC"
---
# Five Boroughs

**Vibe:** a summer-night block party where every borough brings a colour. The page is a plum night, and the
colour lives in the clay buttons, a patchwork quilt in the gutters and bunting along the top. Loud at the edges,
calm where you read.

## The five colours

| Borough | Colour | Hex (dark) | Role |
|---|---|---|---|
| Manhattan | taxi yellow | #FFC93C | `--amber`: reward, XP, primary button, focus dial |
| The Bronx | hot pink (birthplace of hip-hop, graffiti) | #FF6FB1 | `--violet`: secondary buttons, links, checked chips |
| Queens | teal (the most diverse county in the US) | #2FE0BE | `--mint`: done, floor reached, break |
| Brooklyn | blue | #6FA0FF | `--sky`, Python |
| Staten Island | ferry orange | #FF8A2A | `--flame`: run streak |

## Palette (dark first; light = a cream poster in daylight)

| Role | Token | Dark | Light |
|---|---|---|---|
| Page | `--bg` | #160C1E | #FFF6EA |
| Card | `--s1` | #22142C | #FFFFFF |
| Well / input / XP track | `--s2` | #2D1B3A | #FFEEDB |
| Border + clay ledge | `--line` | #472B57 | #F0D9C2 |
| Input border | `--line-strong` | #8068B0 | #8A6FA8 |
| Text | `--ink` | #FFF4E6 | #24132F |
| Muted | `--muted` | #C9B9D8 | #5C4A6A |
| Reward | `--amber` / `--on-amber` | #FFC93C / #1F1300 | #B87A00 / #1F1300 |
| Secondary | `--violet` / `--on-violet` | #FF6FB1 / #2A0618 | #C2186B / #FFFFFF |
| Done | `--mint` / `--on-mint` | #2FE0BE / #03201A | #067A66 / #FFFFFF |
| Focus ring | `--focus` | #8CF0DC | #C2186B |
| Categories | `--c-*` | Python #6FA8FF, Math #B49CFF, ML #3EE6A0, Papers #FF9A5C, Writing #FF8AD8, Drift #AC9AC2 | |

### Measured contrast, dark (from `shots/five-boroughs-report.json`)

| Pair | Colours | Ratio | Min | |
|---|---|---|---|---|
| body text on page | `--ink` #FFF4E6 on `--bg` #160C1E | 17.49:1 | 4.5 | pass |
| body text on card | `--ink` #FFF4E6 on `--s1` #22142C | 16.05:1 | 4.5 | pass |
| text on well / ghost button | `--ink` #FFF4E6 on `--s2` #2D1B3A | 14.54:1 | 4.5 | pass |
| muted text on card | `--muted` #C9B9D8 on `--s1` #22142C | 9.48:1 | 4.5 | pass |
| muted text on page | `--muted` #C9B9D8 on `--bg` #160C1E | 10.33:1 | 4.5 | pass |
| placeholder in input | `--muted` #C9B9D8 on `--s2` #2D1B3A | 8.59:1 | 4.5 | pass |
| faint icons on card | `--faint` #AC9AC2 on `--s1` #22142C | 6.77:1 | 3 | pass |
| amber button label | `--on-amber` #1F1300 on `--amber` #FFC93C | 11.87:1 | 4.5 | pass |
| violet button label | `--on-violet` #2A0618 on `--violet` #FF6FB1 | 7.17:1 | 4.5 | pass |
| mint button label | `--on-mint` #03201A on `--mint` #2FE0BE | 10.22:1 | 4.5 | pass |
| active nav tab | `--amber-ink` #FFC93C on `--amber-soft` #3A2614 | 9.32:1 | 4.5 | pass |
| links on card | `--violet` #FF6FB1 on `--s1` #22142C | 6.78:1 | 4.5 | pass |
| soft pill / callout | `--violet` #FF6FB1 on `--violet-soft` #3D1840 | 5.82:1 | 4.5 | pass |
| ok pill | `--mint` #2FE0BE on `--mint-soft` #0E3833 | 7.67:1 | 4.5 | pass |
| amber callout text | `--ink` #FFF4E6 on `--amber-soft` #3A2614 | 13.18:1 | 4.5 | pass |
| violet callout text | `--ink` #FFF4E6 on `--violet-soft` #3D1840 | 13.78:1 | 4.5 | pass |
| toast (inverted) | `--bg` #160C1E on `--ink` #FFF4E6 | 17.49:1 | 4.5 | pass |
| focus ring on page | `--focus` #8CF0DC on `--bg` #160C1E | 14.12:1 | 3 | pass |
| focus ring on card | `--focus` #8CF0DC on `--s1` #22142C | 12.96:1 | 3 | pass |
| input border | `--line-strong` #8068B0 on `--s2` #2D1B3A | 3.4:1 | 3 | pass |
| Python glyph | `--c-python` #6FA8FF on `--s1` #22142C | 7.24:1 | 3 | pass |
| Math glyph | `--c-math` #B49CFF on `--s1` #22142C | 7.59:1 | 3 | pass |
| ML/DL glyph | `--c-ml` #3EE6A0 on `--s1` #22142C | 10.82:1 | 3 | pass |
| Papers glyph | `--c-papers` #FF9A5C on `--s1` #22142C | 8.33:1 | 3 | pass |
| Writing glyph | `--c-writing` #FF8AD8 on `--s1` #22142C | 8.2:1 | 3 | pass |
| Rest glyph | `--rest` #B9A8FF on `--s1` #22142C | 8.39:1 | 3 | pass |
| Drift glyph | `--c-drift` #AC9AC2 on `--s1` #22142C | 6.77:1 | 3 | pass |
| run flame | `--flame` #FF8A2A on `--s1` #22142C | 7.41:1 | 3 | pass |
| XP bar fill vs track | `--amber` #FFC93C on `--s2` #2D1B3A | 10.28:1 | 3 | pass |

Light mode: 29/29 pass. Tightest light pairs: ok pill 4.56:1, soft pill / callout 4.72:1, XP bar fill vs track 3.18:1. Dark: 29/29 pass. External requests: 0, console errors: 0, broken icon refs: 0.

In light mode the taxi yellow darkens to marigold #B87A00, so the XP fill still clears 3:1 on the cream track
(3.18:1 against Night Clay's 1.91:1).

## Background (two layers, all local SVG)

1. `body::after`: **a patchwork quilt** (`bg-quilt.svg`, a 300 px tile with a 5×5 grid of patches and dashed seams).
   Each patch is a motif many New Yorkers carry with them: rangoli dots and an 8-petal flower (a nod from Chennai to
   Jackson Heights), woven chevrons and diamonds, a brownstone arch, harbour waves for the ferry, a taxi checker,
   a rising quarter-sun and cross-stitches, in the five borough colours. It is at 12 % opacity, and a horizontal
   mask keeps full strength only in the outer gutters (the content column gets a fifth of it). On phones it drops
   to a flat 9 %. The worst patch against the page is about 1.3:1, so muted text on the page stays above 6:1.
2. `.app::after`: **block-party bunting**. Pennants on a sagging string along the top edge (`bg.svg`). Every tip
   stops at 19 px (14 px on phones), above the header text.
   `body::before` keeps the two glows, recoloured to pink (top right) and Brooklyn blue (bottom left).

Nothing animates.

## Icon: "Block Party"

A **die-cut sticker of a boombox**, tilted mid-bounce, with sound sparks flying off. Hip-hop was born at a Bronx
block party, and NYC is one long mixtape. The single big speaker is **five concentric rings, one per borough**, on a
Bronx-pink body. The tape deck shows a yellow and orange label, and the **EQ bars climb left to right: levels going
up**. It is surprising because nobody expects a study app's icon to be a boombox, and it carries the theme's whole
idea (many colours, one sound). It has no face: one speaker, not two, so it doesn't read as eyes. 32 px keeps the
handle, the ringed speaker and the EQ bars. 16 px is the pink body, a two-ring speaker, the handle and one orange
block. `brand.svg` uses a deep-pink handle so it shows on both the dark and light headers, and it gets a neutral
clay ledge (TWEAK).

Rejected concepts (sketches in `sketches/`):
- **Bodega 24/7**: a five-stripe awning over a shopfront with a neon "24/7" (fully polished). Dropped because the
  separate **Bodega** theme owns the corner store and awning, and every theme needs its own icon. The awning
  valance in the background went with it and became bunting.
- **Pinwheel Star**: a five-point star, one borough per point, folded-paper shading. Clean at 16 px, but the least
  surprising option.
- **Open Hydrant**: a hydrant spraying a five-colour arc (NYC summer). Cute at 180 px, an orange blob at 16 px.
- **Wonder Wheel**: a Ferris wheel with five coloured cars ("everyone gets a turn at the top"). Lovely, but the
  thin lines lose their punch below 64 px.
- **Symmetric boombox**: two speakers plus a centred deck read a little like a face, so it became asymmetric.
- The first quilt had a "stitches in a circle" patch that looked like a face with X eyes. It was replaced with plain cross-stitches.

## Tweaks (4)
Plum glass chips over the city, taxi-yellow dial glow, taxi-yellow +XP float, neutral brand ledge.

## Least sure about
Pink secondary next to a yellow primary is joyful, but on the Today screen both "Make it" and "I shipped something"
are pink while the main CTA is a ghost button (that is the app's markup), so pink can feel like the main colour.
The quilt is the busiest decoration in the set; at 1440+ the gutters are wide and full of pattern.
