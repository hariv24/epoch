# Vendored: EZ-Tree

| What | Source | Licence |
|---|---|---|
| `tree.js`, `branch.js`, `enums.js`, `options.js`, `rng.js`, `trellis.js` | EZ-Tree 1.1.0 by Daniel Greenheck, npm `@dgreenheck/ez-tree` (https://github.com/dgreenheck/ez-tree), `src/lib` | MIT (see `LICENSE`) |
| `textures.js` | rewritten for Epoch (no bundler: `new URL(..., import.meta.url)`), same API | MIT |
| `assets/oak_{color,normal,ao}.webp` | EZ-Tree's oak bark = Poly Haven *bark_brown_02* (https://polyhaven.com/a/bark_brown_02), re-encoded to webp | CC0 |
| `assets/ash_color.png`, `assets/oak_color.png` | EZ-Tree leaf cards (from the package's `src/lib/assets/leaves`) | MIT (package licence) |

Local edits: import paths gained `.js`; the presets import was replaced by a stub (`loadPreset` throws; Epoch passes options directly). Nothing is fetched at runtime from a CDN.
