# Underdog theme tokens

Paste-ready CSS custom properties for each direction. They use `light-dark()` with `color-scheme: light dark` and a `[data-theme]` override, the same mechanism as the current stylesheet (docs/game-design.md section 8.1). The board that shows them: `docs/themes/index.html`.

## How these map to the current stylesheet

Names are semantic so a theme swap is a values-only change. If you want to keep the existing names, map them like this:

| Here | Current stylesheet |
|---|---|
| `--primary`, `--on-primary` | `--violet`, `--on-violet` (the CTA and links) |
| `--reward` | `--amber` (XP bar, windows, ring) |
| `--success` | `--mint` |
| `--focus` | `--focus` |
| `--edge` | `--violet-edge` / `--amber-edge` (the clay lip under buttons) |
| `--c-python` ... `--c-drift` | same names |
| `--city-*` | new: feed the 3D scene's sky, towers, windows and lights |

Role summary: bg = page, s1 = card, s2 = inset and chip, line = borders, ink = text, muted = secondary text, primary = main button, reward = XP and lit windows, success = verified, focus = 3px ring, track = the XP bar's empty track.

## Current (Night Clay)

Midnight purple, amber reward, chunky clay. What you have now.

Contrast (computed, WCAG 2.x). Light: body 14.9:1, muted 5.9:1, button text 6.0:1, focus ring 5.7:1. Dark: body 13.5:1, muted 7.0:1, button text 6.8:1, focus ring 10.3:1. Note: the light-mode amber XP bar is only 1.9:1 against its track (needs 3:1).

Fonts: heading "Fredoka", body "Nunito". Heading weight 600.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#FFF7E8, #0D1020);
  --s1: light-dark(#FFFFFF, #161A33);
  --s2: light-dark(#FFF0D6, #1F2447);
  --line: light-dark(#E9D9BC, #343A73);
  --ink: light-dark(#1C1A3A, #F4F2FF);
  --muted: light-dark(#555A86, #A8AEDC);
  --primary: light-dark(#5B4BDB, #9A8CFF);
  --on-primary: light-dark(#FFFFFF, #0D0A33);
  --reward: light-dark(#F59E0B, #FFB224);
  --success: light-dark(#067A50, #46E0A0);
  --focus: light-dark(#5B4BDB, #C9C2FF);
  --edge: light-dark(#3B2FA8, #5B4BDB);
  --track: light-dark(#FFF0D6, #1F2447);
  --c-python: light-dark(#2F6FED, #6CB4FF);
  --c-math: light-dark(#6D4FE0, #A99BFF);
  --c-ml: light-dark(#067A50, #46E0A0);
  --c-papers: light-dark(#D4492B, #FF8A6B);
  --c-writing: light-dark(#B8239B, #F58AE0);
  --c-drift: light-dark(#6B6F96, #9AA1D2);
  --city-sky1: light-dark(#E7E3FF, #0D1020);
  --city-sky2: light-dark(#FFE3B0, #2A2466);
  --city-far: light-dark(#B9B2E6, #25306B);
  --city-near: light-dark(#7C72C4, #131735);
  --city-win: light-dark(#FFFFFF, #FFB224);
  --city-acc: light-dark(#F59E0B, #FFB224);
  --lift: light-dark(rgb(60 40 110 / .22), rgb(0 0 0 / .55));
  --font-head: "Fredoka", system-ui, sans-serif;
  --font-body: "Nunito", system-ui, sans-serif;
  --radius-card: 16px;
  --radius-chip: 999px;
  --radius-btn: 16px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

## Night Shift

Asphalt navy and sodium-vapour orange. 2 a.m. study under a streetlight. No purple.

Contrast (computed, WCAG 2.x). Light: body 13.6:1, muted 5.9:1, button text 5.7:1, focus ring 5.7:1. Dark: body 13.9:1, muted 7.1:1, button text 8.1:1, focus ring 10.8:1.

Fonts: heading "Fredoka", body "Nunito". Heading weight 600.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#F1EEE8, #0A0E15);
  --s1: light-dark(#FFFFFF, #121923);
  --s2: light-dark(#E7E3DA, #1A2331);
  --line: light-dark(#CFC9BC, #2B3648);
  --ink: light-dark(#121A26, #F4F0E6);
  --muted: light-dark(#4A5565, #A5AFBF);
  --primary: light-dark(#E8650A, #FF8A1F);
  --on-primary: light-dark(#1A0D00, #1A0D00);
  --reward: light-dark(#A86600, #FFD36A);
  --success: light-dark(#0B7A55, #3FD8A4);
  --focus: light-dark(#0B5FA5, #8CD3FF);
  --edge: light-dark(#A64400, #B85A00);
  --track: light-dark(#E7E3DA, #1A2331);
  --c-python: light-dark(#1D6FD6, #5AB0FF);
  --c-math: light-dark(#0B8277, #2FD0C0);
  --c-ml: light-dark(#3F7F12, #86DB5E);
  --c-papers: light-dark(#D4392B, #FF6B5E);
  --c-writing: light-dark(#3C4656, #E8ECF1);
  --c-drift: light-dark(#6B7587, #8B96A8);
  --city-sky1: light-dark(#A9CBE6, #070B12);
  --city-sky2: light-dark(#F6E3C2, #22344F);
  --city-far: light-dark(#A9B6C6, #1D2B42);
  --city-near: light-dark(#6C7A8C, #101826);
  --city-win: light-dark(#FFFFFF, #FFD36A);
  --city-acc: light-dark(#E8650A, #FF8A1F);
  --lift: light-dark(rgb(30 25 15 / .22), rgb(0 0 0 / .55));
  --font-head: "Fredoka", system-ui, sans-serif;
  --font-body: "Nunito", system-ui, sans-serif;
  --radius-card: 16px;
  --radius-chip: 999px;
  --radius-btn: 16px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

## Taxi

NYC cab yellow on graphite. Loud, fast, impossible to miss. Checker used once, not everywhere.

Contrast (computed, WCAG 2.x). Light: body 14.5:1, muted 5.6:1, button text 12.3:1, focus ring 16.1:1. Dark: body 13.6:1, muted 7.2:1, button text 12.3:1, focus ring 16.9:1.

Fonts: heading "Barlow Condensed", body "Barlow". Heading weight 700, uppercase.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#F3F0E6, #121315);
  --s1: light-dark(#FFFFFF, #1B1D20);
  --s2: light-dark(#E8E4D6, #262A2E);
  --line: light-dark(#CFC9B4, #3C4147);
  --ink: light-dark(#141416, #FAF8F0);
  --muted: light-dark(#55585F, #B2B7BE);
  --primary: light-dark(#FFC82C, #FFC82C);
  --on-primary: light-dark(#141000, #141000);
  --reward: light-dark(#B07800, #FFE27A);
  --success: light-dark(#0F7A4E, #3ED598);
  --focus: light-dark(#141416, #FFFFFF);
  --edge: light-dark(#141416, #A87C00);
  --track: light-dark(#141416, #262A2E);
  --c-python: light-dark(#1F62D1, #5DA8FF);
  --c-math: light-dark(#C2500E, #FF8A4C);
  --c-ml: light-dark(#0F7B49, #41D98C);
  --c-papers: light-dark(#C7284F, #FF5C85);
  --c-writing: light-dark(#2A2C30, #EDEDED);
  --c-drift: light-dark(#6C727A, #8E949C);
  --city-sky1: light-dark(#CFCBBE, #0C0D0F);
  --city-sky2: light-dark(#F3E7B8, #2A2C31);
  --city-far: light-dark(#A9A596, #23262B);
  --city-near: light-dark(#4A4C52, #15171A);
  --city-win: light-dark(#FFC82C, #FFC82C);
  --city-acc: light-dark(#FFC82C, #FFC82C);
  --lift: light-dark(rgb(20 20 22 / .25), rgb(0 0 0 / .55));
  --font-head: "Barlow Condensed", system-ui, sans-serif;
  --font-body: "Barlow", system-ui, sans-serif;
  --radius-card: 12px;
  --radius-chip: 8px;
  --radius-btn: 10px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

## Subway

MTA signage: black and white, bold grotesk, every subject is a train line. Clear, civic, New York.

Contrast (computed, WCAG 2.x). Light: body 16.1:1, muted 6.6:1, button text 7.1:1, focus ring 8.9:1. Dark: body 15.9:1, muted 7.9:1, button text 7.1:1, focus ring 18.3:1.

Fonts: heading "Helvetica Neue", Helvetica, Arial, "Liberation Sans", Arimo, sans-serif, body "Helvetica Neue", Helvetica, Arial, "Liberation Sans", Arimo, sans-serif. Heading weight 700.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#F4F4F2, #0A0A0A);
  --s1: light-dark(#FFFFFF, #151515);
  --s2: light-dark(#E8E8E5, #222222);
  --line: light-dark(#C9C9C5, #3D3D3D);
  --ink: light-dark(#0A0A0A, #FFFFFF);
  --muted: light-dark(#4D5055, #B5B7BA);
  --primary: light-dark(#FF6319, #FF6319);
  --on-primary: light-dark(#000000, #000000);
  --reward: light-dark(#FCCC0A, #FCCC0A);
  --success: light-dark(#00933C, #27B862);
  --focus: light-dark(#0039A6, #FFFFFF);
  --edge: light-dark(#B8430B, #B8430B);
  --track: light-dark(#0A0A0A, #222222);
  --c-python: light-dark(#0039A6, #0039A6);
  --c-math: light-dark(#EE352E, #EE352E);
  --c-ml: light-dark(#00933C, #00933C);
  --c-papers: light-dark(#FCCC0A, #FCCC0A);
  --c-writing: light-dark(#B933AD, #B933AD);
  --c-drift: light-dark(#A7A9AC, #A7A9AC);
  --city-sky1: light-dark(#9DB8D6, #04060A);
  --city-sky2: light-dark(#E8EEF5, #0E2347);
  --city-far: light-dark(#9AA7B8, #18263E);
  --city-near: light-dark(#3B4452, #0B1018);
  --city-win: light-dark(#FFFFFF, #FFF2C2);
  --city-acc: light-dark(#FF6319, #FF6319);
  --lift: light-dark(rgb(0 0 0 / .18), rgb(0 0 0 / .6));
  --font-head: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", Arimo, sans-serif, system-ui, sans-serif;
  --font-body: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", Arimo, sans-serif, system-ui, sans-serif;
  --radius-card: 8px;
  --radius-chip: 8px;
  --radius-btn: 8px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

Subway category colours are the classic MTA signage hexes (NYC Subway nomenclature, MTA GTFS colors.csv: A/C/E #0039A6, 1/2/3 #EE352E, 4/5/6 #00933C, N/Q/R/W #FCCC0A, 7 #B933AD, L #A7A9AC; primary orange is B/D/F/M #FF6319). The MTA brand-colour PDF (https://www.mta.info/document/168976) lists slightly different print values (A #0062CF, N #F6BC26, 1 #D82233, 4 #009952, 7 #9A38A1) if you prefer those. Use them as filled "bullets" with a dark or white glyph, never as thin text: blue and purple fail as text on black, yellow fails on white. Glyph colours that pass (>= 4.5:1): Python white, Math black, ML/DL black, Papers black, Writing/X white. Add a 1.5px ring (`rgb(255 255 255 / .55)` in dark, `rgb(0 0 0 / .4)` in light) so the bullets separate from the surface.

## Brownstone

Brick, cream paper, ivy and brass. A cozy stoop-and-library feel. Light first, with an evening mode.

Contrast (computed, WCAG 2.x). Light: body 12.8:1, muted 5.3:1, button text 5.9:1, focus ring 7.1:1. Dark: body 12.6:1, muted 6.7:1, button text 6.1:1, focus ring 10.6:1.

Fonts: heading "Fraunces", body "Nunito". Heading weight 600.

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#F6EEDF, #1B1311);
  --s1: light-dark(#FFFBF3, #261B18);
  --s2: light-dark(#EDE0C8, #33251F);
  --line: light-dark(#D8C4A0, #4D392F);
  --ink: light-dark(#2A1A12, #F7ECDA);
  --muted: light-dark(#6B5646, #C0AB96);
  --primary: light-dark(#A53F2A, #E27158);
  --on-primary: light-dark(#FFF6E8, #1F0A05);
  --reward: light-dark(#9A6A10, #E6B450);
  --success: light-dark(#3A6B35, #8EC386);
  --focus: light-dark(#1F4F8F, #F2C86B);
  --edge: light-dark(#6E2616, #A5412C);
  --track: light-dark(#EDE0C8, #33251F);
  --c-python: light-dark(#2F5E8F, #86B1E4);
  --c-math: light-dark(#1F7A72, #5CC2B6);
  --c-ml: light-dark(#3A6B35, #98CC8A);
  --c-papers: light-dark(#7E3F66, #D79BC0);
  --c-writing: light-dark(#8A4F1B, #D9B99B);
  --c-drift: light-dark(#7A6A5C, #A8978A);
  --city-sky1: light-dark(#CFE0E6, #120D12);
  --city-sky2: light-dark(#F8E4C4, #6A3426);
  --city-far: light-dark(#C9B497, #3A2623);
  --city-near: light-dark(#8A4B3A, #1B1214);
  --city-win: light-dark(#FFF6E0, #E6B450);
  --city-acc: light-dark(#A53F2A, #E27158);
  --lift: light-dark(rgb(80 40 20 / .2), rgb(0 0 0 / .5));
  --font-head: "Fraunces", system-ui, sans-serif;
  --font-body: "Nunito", system-ui, sans-serif;
  --radius-card: 18px;
  --radius-chip: 999px;
  --radius-btn: 14px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

## Mixing

Tokens are independent. Example: Subway category colours on Night Shift surfaces. Take the `--c-*` lines from Subway and every other line from Night Shift. Keep the bullet ring from the Subway note above, because the real blue and purple are dark against Night Shift surfaces.
