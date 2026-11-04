# Room assets: credits and licences

Rebuilt by `scripts/room/build_assets.sh` from the raw downloads in `build/sketchfab-raw/` and
`build/polyhaven-raw/`. Every model is converted to metres, with its origin at the floor centre of its
footprint and its front facing +Z. Textures are webp; geometry uses `EXT_meshopt_compression`.

## Models

| File | Title | Author | Source | Licence | Changes |
|---|---|---|---|---|---|
| `bed.glb` | Dark Modern Bed | [Ren Viro Store](https://sketchfab.com/renviros) | [Sketchfab](https://sketchfab.com/3d-models/dark-modern-bed-d3aeb724e09c44af96ef09cd20885220) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | mm to m; narrowed 0.77x in width, king-ish 2.14 m -> queen 1.645 m (depth 1.99 m, height 0.86 m kept); textures 1k webp, meshopt |
| `bed_grey.glb` | Modern Bed | [Ngngan](https://sketchfab.com/nguyenngocngan130219) | [Sketchfab](https://sketchfab.com/3d-models/modern-bed-c713701eecbd479ea5ae7918de5de2f2) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | previous bed, kept as a fallback (`?bed=grey` in the room v2 proof); narrowed 0.88× in width, queen → full (1.58 m); webp, meshopt |
| `desk.glb` | Desk Set (desk + drawer fronts) | [Ren Viro Store](https://sketchfab.com/renviros) | [Sketchfab](https://sketchfab.com/3d-models/desk-set-f26030d09d73422f8ff270425c7c63e0) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | split from the set; scaled to 1.20 × 0.60 × 0.75 m; webp, meshopt |
| `chair.glb` | Desk Set (office chair) | [Ren Viro Store](https://sketchfab.com/renviros) | [Sketchfab](https://sketchfab.com/3d-models/desk-set-f26030d09d73422f8ff270425c7c63e0) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | split from the set; turned to face front; webp, meshopt |
| `sofa.glb` | Modern Sofa | [Siba Santosh Das](https://sketchfab.com/shivadas) | [Sketchfab](https://sketchfab.com/3d-models/modern-sofa-672ec00056c842eea6d72602e81907d0) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | scaled 0.78× to real loveseat size; webp, meshopt |
| `rug.glb` | Persian carpet | [ChoboiAssets](https://sketchfab.com/alsoliman905) | [Sketchfab](https://sketchfab.com/3d-models/persian-carpet-4592468c03784f0d895876ec670de1cd) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) | scaled to 5 × 8 ft (1.52 × 2.44 m); roughness 0.95; webp, meshopt |
| `lamp.glb` | Desk Lamp Arm 01 | Yann Kervran, Kuutti Siitonen | [Poly Haven](https://polyhaven.com/a/desk_lamp_arm_01) | CC0 (credit as courtesy) | clamp replaced with an 18 cm weighted disc base; head turned to the front; 512 px textures |

## Textures (`tex/`, each tile covers 2 m × 2 m; `_arm` = AO / roughness / metalness in R / G / B)

| Files | Title | Author | Source | Licence | Changes |
|---|---|---|---|---|---|
| `oak_floor_diff/nor/arm.webp` | Old Wooden Floor 01 | Charlotte Baglioni, Dario Barresi | [Poly Haven](https://polyhaven.com/a/old_wooden_floor_01) | CC0 (credit as courtesy) | 1k, webp; normal map is OpenGL (+Y) |
| `plaster_wall_diff/nor/arm.webp` | White Stucco | Amal Kumar | [Poly Haven](https://polyhaven.com/a/white_stucco) | CC0 (credit as courtesy) | diffuse tinted to a mean of #EDE6DA; 1k, webp; normal map is OpenGL (+Y) |

CC BY 4.0 requires the credit above (title, author, link, licence, and a note of the changes). Keep this
file next to the assets and show the CC-BY lines on any in-app credits screen.

## Brownstone dressing (`bs/`, docs/ROOM-V2.md §13.1)

Rebuilt by `scripts/room/build_brownstone.sh` (Blender `prep_asset.py`, then gltf-transform with `simplify` for the dense props). All Poly Haven, CC0; credited as a courtesy.

| File | Title | Author | Source | Licence | Changes |
|---|---|---|---|---|---|
| `bs/plant_big.glb` | Potted Plant 02 | Rico Cilliers | [Poly Haven](https://polyhaven.com/a/potted_plant_02) | CC0 | meshopt simplify ~10%; textures webp ≤1k, meshopt |
| `bs/plant_small.glb` | Potted Plant 04 | James Ray Cock | [Poly Haven](https://polyhaven.com/a/potted_plant_04) | CC0 | simplify 30%; textures webp ≤1k, meshopt |
| `bs/books.glb` | Book Encyclopedia Set 01 | John Malcolm | [Poly Haven](https://polyhaven.com/a/book_encyclopedia_set_01) | CC0 | simplify ~5%; textures webp ≤1k, meshopt |
| `bs/frame3.glb` | Fancy Picture Frame 01 | Rob Tuytel, Rico Cilliers | [Poly Haven](https://polyhaven.com/a/fancy_picture_frame_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/mirror.glb` | Ornate Mirror 01 | James Ray Cock | [Poly Haven](https://polyhaven.com/a/ornate_mirror_01) | CC0 | simplify 20%; shown at 2.15x (over-mantel mirror); textures webp ≤1k, meshopt |
| `bs/kettle.glb` | Vintage Electric Kettle | SV Garip | [Poly Haven](https://polyhaven.com/a/vintage_electric_kettle) | CC0 | simplify 15%; textures webp ≤1k, meshopt |
| `bs/bowl.glb` | Wooden Bowl 01 | Oliver Harries | [Poly Haven](https://polyhaven.com/a/wooden_bowl_01) | CC0 | simplify 20%; textures webp ≤1k, meshopt |
| `bs/apple.glb` | Food Apple 01 | Oliver Harries | [Poly Haven](https://polyhaven.com/a/food_apple_01) | CC0 | simplify 6%; textures webp ≤1k, meshopt |
| `bs/lemon.glb` | Lemon | Kuutti Siitonen | [Poly Haven](https://polyhaven.com/a/lemon) | CC0 | simplify 15%; textures webp ≤1k, meshopt |
| `bs/wallclock.glb` | Wall Clock | PierreB3D | [Poly Haven](https://polyhaven.com/a/wall_clock) | CC0 | glass transmission flattened to alpha at load; textures webp ≤1k, meshopt |
| `bs/alarm.glb` | Alarm Clock 01 | Yann Kervran, James Ray Cock | [Poly Haven](https://polyhaven.com/a/alarm_clock_01) | CC0 | simplify 12%; textures webp ≤1k, meshopt |
| `bs/nightstand.glb` | Classic Nightstand 01 | Kirill Sannikov | [Poly Haven](https://polyhaven.com/a/ClassicNightstand_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/armchair.glb` | Arm Chair 01 | Kirill Sannikov | [Poly Haven](https://polyhaven.com/a/ArmChair_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/cafechair.glb` | Painted Wooden Chair 01 | Kuutti Siitonen | [Poly Haven](https://polyhaven.com/a/painted_wooden_chair_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/shelf.glb` | Shelf 01 | Gabriel Radić | [Poly Haven](https://polyhaven.com/a/Shelf_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/basket.glb` | Wicker Basket 02 | Kuutti Siitonen | [Poly Haven](https://polyhaven.com/a/wicker_basket_02) | CC0 | scaled 1.45x (laundry basket); simplify 30%; textures webp ≤1k, meshopt |
| `bs/laptop.glb` | Classic Laptop | Arrangemonk | [Poly Haven](https://polyhaven.com/a/classic_laptop) | CC0 | scaled 0.52x (33 cm); simplify 20%; textures webp ≤1k, meshopt |
| `bs/vase.glb` | Ceramic Vase 01 | James Ray Cock | [Poly Haven](https://polyhaven.com/a/ceramic_vase_01) | CC0 | simplify 20%; textures webp ≤1k, meshopt |
| `bs/candle.glb` | Wooden Candlestick | Josh Dean | [Poly Haven](https://polyhaven.com/a/wooden_candlestick) | CC0 | simplify ~0.6%; textures webp ≤1k, meshopt |
| `bs/board.glb` | Wooden Cutting Board | Kuutti Siitonen | [Poly Haven](https://polyhaven.com/a/wooden_cutting_board) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/coffeetable.glb` | Modern Coffee Table 01 | Amin | [Poly Haven](https://polyhaven.com/a/modern_coffee_table_01) | CC0 | as downloaded; textures webp ≤1k, meshopt |
| `bs/desklamp.glb`, `bs/officechair.glb` | light LODs of `lamp.glb` / `chair.glb` | (as above) | (as above) | (as above) | meshopt simplify 25% / 30%, for the brownstone budget |
| `tex/herringbone_parquet_*.webp` | Herringbone Parquet (texture) | Jenelle van Heerden, Sergej Majboroda | [Poly Haven](https://polyhaven.com/a/herringbone_parquet) | CC0 | 1k diffuse / normal (GL) / ARM, webp |
| `tex/marble_01_*.webp` | Marble 01 (texture) | Rob Tuytel | [Poly Haven](https://polyhaven.com/a/marble_01) | CC0 | 1k diffuse / normal (GL) / ARM, webp |
