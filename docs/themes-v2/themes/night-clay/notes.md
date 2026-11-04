---
name: Night Clay
vibe: The app as it ships. Midnight surfaces, one amber reward colour, chunky clay buttons.
palette:
  bg: "#0D1020"          # page
  s1: "#161A33"          # cards
  s2: "#1F2447"          # wells, inputs, ghost buttons
  ink: "#F4F2FF"         # body text
  muted: "#A8AEDC"       # secondary text
  amber: "#FFB224"       # the ONE reward colour (XP, primary button, lit windows)
  violet: "#9A8CFF"      # secondary action, links
  mint: "#46E0A0"        # done / floor reached
  focus: "#C9C2FF"       # focus ring
---

# Night Clay (reference)

**Vibe:** the current production look, the one the user likes most. Every new theme is judged next to it,
so this folder overrides nothing (`theme.css` is empty) and ships the current icon.

## Palette (dark), measured by `build.mjs` (see `shots/night-clay-report.json`)

| Role | Token | Hex | Pair | Contrast |
|---|---|---|---|---|
| Page | `--bg` | #0D1020 | ink on bg | 17.08:1 |
| Card | `--s1` | #161A33 | ink on s1 | 15.44:1 |
| Well / input | `--s2` | #1F2447 | ink on s2 | 13.55:1 |
| Body text | `--ink` | #F4F2FF | | |
| Secondary text | `--muted` | #A8AEDC | muted on s1 / bg / s2 | 7.93 / 8.77 / 6.96:1 |
| Reward | `--amber` | #FFB224 | on-amber #1A1000 on amber | 10.42:1 |
| Secondary action | `--violet` | #9A8CFF | on-violet #0D0A33 on violet | 6.83:1 |
| Done | `--mint` | #46E0A0 | on-mint #04130C on mint | 11.26:1 |
| Focus ring | `--focus` | #C9C2FF | on bg / on s1 | 11.37 / 10.28:1 |
| Input border | `--line-strong` | #6870B5 | on s2 | 3.26:1 |
| Categories | `--c-python` #6CB4FF, `--c-math` #A99BFF, `--c-ml` #46E0A0, `--c-papers` #FF8A6B, `--c-writing` #F58AE0 | | on s1 | 7.17 to 10.11:1 |

All 29 checked pairs pass.

## Background

Flat `--bg` plus two soft radial glows in `body::before` (`--glow-a` violet top right, `--glow-b` blue bottom left).
This flat look is what the new themes should improve on with a real decoration.

## Icon

Amber clay tower with a violet annex and cream lit windows, on a midnight tile (`icon.svg`, the current
`underdog/web/static/app/icon.svg`). `icon-32.svg` / `brand.svg` are the header mark; `icon-16.svg` is the current favicon.
