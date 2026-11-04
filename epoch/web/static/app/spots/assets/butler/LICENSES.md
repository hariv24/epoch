# Butler Library v2 assets (docs/BUTLER-V2.md)

Poly Haven, CC0 1.0 (public domain); credited as a courtesy. Fetched with `scripts/room/ph_fetch.py texture <id> 1k`, converted to webp (quality 82) with sharp.
`_arm` = AO / roughness / metalness in R / G / B; normal maps are OpenGL (+Y).

| File | Asset | Author | Source | Licence | Notes |
|---|---|---|---|---|---|
| `fine_grained_wood_diff/nor/arm.webp` | Fine Grained Wood (texture) | Rob Tuytel | [Poly Haven](https://polyhaven.com/a/fine_grained_wood) | CC0 | table bases and banding, the bookcase band (tinted), Windsor chairs, the end doorcase |
| `brown_leather_diff/nor/arm.webp` | Brown Leather (texture) | Rob Tuytel | [Poly Haven](https://polyhaven.com/a/brown_leather) | CC0 | Hariv's 3 desk books; its normal map gives the ~9k shelf books their grain |

Also used from `room/assets/` (see that LICENSES.md): `tex/plaster_wall_nor` (the limestone's normal map), `bs/cafechair.glb` (Painted Wooden Chair 01:
loaded only for its fit box; the visible chair is a procedural Windsor built inside that box).

Everything else in the hall (`city/spots/butler2_hall.js`) is procedural, made in code at load time, no files: the ashlar, coffer, floor, grille,
bronze-grille, portrait and clock textures are drawn on canvases; windows, pilasters, cornice, coffers, chandeliers, bookcases, doors and lamps are
merged or instanced geometry. The user's photos in `build/ref/butler/` are reference only and are not shipped.
