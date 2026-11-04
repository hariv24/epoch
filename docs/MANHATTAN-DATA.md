# Manhattan data (real map for the 3-D city)

The City view is built from **official NYC open data only**: every Manhattan building at real scale (about 45,000 footprints with real heights, ground elevation, roof setbacks), the real shoreline, parks, streets, neighbourhoods and terrain. Nothing is invented, and nothing is downloaded at runtime: the generated files live in `epoch/web/static/app/city/manhattan/` and the app loads them offline.

Rebuild (about 8 s once the raw downloads are cached):

```
node scripts/build_manhattan.mjs            # cached raw data in build/manhattan-raw/ (git-ignored)
node scripts/build_manhattan.mjs --refresh  # re-download the Socrata tables first
node scripts/manhattan/extract3d.mjs build/manhattan-raw --refresh   # only if the 3-D model must be re-extracted
```

Needs node >= 20 (global `fetch`), plus `curl` and `unzip` for the one-off 916 MB 3-D model download. The build never touches `data/` (the user's database).

## Sources, licences, attribution

All are published by the City of New York on **NYC Open Data** (Socrata, `data.cityofnewyork.us`). Use is governed by the NYC Open Data Terms of Use (https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje/): free to use, data is provided "as is" for informational purposes, no warranty. There is no per-dataset licence beyond that; attribution to the publishing agency is good practice and is shown in the app.

| Layer | Dataset (id) | Publisher | Fields used | Fetched |
|---|---|---|---|---|
| Buildings | Building Footprints (`5zhs-2jue`) | Office of Technology and Innovation (OTI) | multipolygon geometry, `bin`, `base_bbl`, `height_roof` (ft), `ground_elevation` (ft), `construction_year`, `feature_code`, `last_status_type`; Manhattan = BIN 1000000-1999999 | 45,182 rows (35 MB) |
| Roof tiers / setbacks | 3-D Building Model, CityGML (`tnru-abg2`, file `DA_WISE_GML.zip`, 916 MB, 2014 vintage) | OTI | roof polygons + ground level of the 8 delivery areas that touch Manhattan (DA9, 10, 12, 13, 14, 15, 19, 20) | 45,516 Manhattan BINs, 42 MB `tiers3d.json` |
| Land / shoreline | Borough Boundaries (`gthc-hcne`), `borocode = 1` (water-clipped) | Department of City Planning (DCP) | Manhattan polygons (includes Roosevelt, Randalls/Wards, Governors, Liberty and Ellis islands and Marble Hill) | 1 row |
| Faint far shore | same dataset, other boroughs | DCP | outlines of the four other boroughs, cropped to 18 km and simplified to 25 m. Context only; New Jersey is not in NYC data and is not included | 4 rows |
| Neighbourhoods | 2020 Neighborhood Tabulation Areas (`9nt8-h7nd`), Manhattan | DCP | `nta2020`, `ntaname`, `ntaabbrev`, geometry | 38 NTAs |
| Parks | Parks Properties (`enfh-gkve`), borough M | Department of Parks and Recreation | name, `typecategory`, `acres`, geometry (clipped to the land polygon) | 396 properties |
| Streets | Centerline (`inkn-q76z`) | OTI | `full_street_name`, `rw_type` (1 street, 2 highway, 3 bridge, 6 path), `streetwidth`, `status = 2` (built), borough code 1 | 14,107 Manhattan segments |
| Land use / classes | PLUTO (`64uk-42ks`), `borough = MN` | DCP | `bbl`, `landuse`, `bldgclass`, `numfloors`, `yearbuilt`, `address`, `landmark`, `histdist` (styling, lot picking) | 42,504 lots |
| Landmarks | Individual Landmark and Historic District Building Database (`gpmc-yuvp`) | Landmarks Preservation Commission | `bin`, `lm_orig` (landmark flag) | 14,610 rows |

Attribution line used in the app (also `manifest.attributionShort`): **Map data: NYC Open Data (OTI, DCP, Parks, LPC)**. The full text is in `manifest.attribution`.

Not used: OpenStreetMap (so no ODbL obligations).

Vendored build-time code: `scripts/manhattan/vendor/polygon-clipping.umd.min.cjs` (polygon-clipping 0.15.7, MIT, licence beside it) clips parks to the land polygon. three.js (already vendored for the app, MIT) supplies `ShapeUtils`/earcut for roof triangulation in the build script.

## Coordinate frame

Local metres, three.js friendly: **X = east, Y = up, Z = south** (north is -Z). Origin = Times Square (lon -73.98513, lat 40.7589). The projection is an exact WGS84 meridian-arc one (`x = (lon-lon0) * mPerDegLon(lat)`, `z = -(arc(lat) - arc(lat0))`), accurate to about 0.3 m over the island. At the origin: 84,441 m per degree of longitude, 111,049 m per degree of latitude (`manifest.frame`).

Y is metres above NAVD88 mean sea level (the footprint dataset's ground elevation converted from feet; heights use the international foot 0.3048). The island spans X -5,291 to 6,615 and Z -13,341 (Marble Hill) to 8,438 (Governors Island) m; the 3-D bounds are in `manifest.frame.bounds3d`. Terrain runs from -2.7 m to 77.5 m.

**Street grid rotation.** Manhattan's grid is ~29 degrees east of true north (`manifest.frame.gridRotationDeg`). The data stays true-north aligned. To show the grid axis-aligned (avenues running along -Z), rotate the whole city group by `rotation.y = +29 * PI / 180`. `places.mjs` exports `gridV(x, z)` / `gridU(x, z)` (along / across the avenues) for build-time work.

## Output files (`epoch/web/static/app/city/manhattan/`)

| File | Size | Contents |
|---|---|---|
| `manifest.json` | 29 KB | frame, tile format constants, LOD descriptions, tile list with per-LOD file / bytes / vertex / triangle / building counts and bounds, totals, file list, NTA list, attribution |
| `lod0/<tx>_<tz>.bin` | 47 files, 23.6 MB | full detail (see below) |
| `lod1/<tx>_<tz>.bin` | 47 files, 10.3 MB | simplified |
| `lod2/<tx>_<tz>.bin` | 42 files, 1.6 MB | massing |
| `home/home_buildings.bin` | 157 KB | the real buildings of the 365 year-of-lots slots (cleared from the world tiles; the renderer keeps them hidden), same tile format, LOD0 detail |
| `terrain.bin` | 865 KB | ground heightfield |
| `land.json`, `parks.json`, `streets.json`, `nta.json`, `farshore.json` | 39 / 156 / 340 / 73 / 48 KB | vector layers |
| `notables.json`, `home.json` | 5 / 173 KB | named buildings and sites; the year of lots (home.json v2) |

Total 36 MB on disk (LOD0 14 MB if the server gzips; the app's static route does not, and the renderer should only fetch tiles near the camera). LOD0: 1,885,804 triangles, 1,745,124 vertices, 44,990 buildings. LOD1: 785,039 triangles, 26,527 buildings/masses. LOD2: 118,137 triangles, 5,765 towers and block masses. Reference JS decoding of every LOD0 tile takes about 35 ms in node; the largest tile is 1.6 MB.

### Tiles (`MNTL` v2, little-endian)

Tile size is 1,500 m: `tileX = floor(x / 1500)`, `tileZ = floor(z / 1500)` of the building centroid, so a tall building may overhang its tile by up to 100 m (`pad`); use `tiles[i].lods[n].bounds = [minX, minY, minZ, maxX, maxY, maxZ]` for frustum culling. The manifest lists 48 tiles: 47 have LOD0 and LOD1, 42 have LOD2, and one (-3,4: Statue of Liberty / Ellis Island) has only LOD2. Always test `tile.lods[n]` and fall back to a coarser one.

```
header 64 bytes
   0 char[4] 'MNTL'    4 u16 version=2   6 u16 lod
   8 i32 tileX        12 i32 tileZ
  16 f32 originX      20 f32 originZ         (tileX*1500, tileZ*1500)
  24 f32 posScale=0.05  28 f32 pad=100  32 f32 yScale=0.05  36 f32 yOffset=-10
  40 u32 nVerts  44 u32 nIndices  48 u32 nBuildings  52 u32 nChunks
  56 u32 chunkTableOffset   60 u32 buildingTableOffset
positions  u16 x3 per vertex (6 B), padded to 4:
     x = originX - pad + q*posScale     y = yOffset + q*yScale     z = originZ - pad + q*posScale
indices    u16 per index, padded to 4: triangle list, counter-clockwise = front face,
           RELATIVE TO THE FIRST VERTEX OF THEIR CHUNK
chunks     16 B each: u32 vFirst, u32 vCount, u32 iFirst, u32 iCount   (offsets are tile-global; vCount <= 65,000)
buildings  40 B each:
     0 u32 bin (0 = merged mass)  4 f32 baseY (ground, m)   8 f32 height (m above baseY to the highest point)
    12 u32 iFirst  16 u32 iCount   20 u32 vFirst  24 u32 vCount        (tile-global ranges)
    28 i16 cx  30 i16 cz    centroid, 0.1 m units relative to the tile origin
    32 u16 year (0 = unknown)  34 u8 style  35 u8 flags  36 u8 floors  37 u8 seed (hash of BIN)  38 u16 chunk index
```

There are **no normals and no per-vertex building id** on purpose (vertices are shared between roof and walls, which halves the size). Shade flat: `MeshStandardMaterial({ flatShading: true })`, or derivative normals in the custom shader (`normalize(cross(dFdx(vPos), dFdy(vPos)))`), or `geometry.computeVertexNormals()` (vertices are only shared within coplanar faces except where a roof meets a wall; flat shading is the right look for this low-poly style anyway). Per-building attributes (height, year, style, window seed, highlight) are derived at load: for each building, fill its `vFirst..vFirst+vCount` vertex range of a per-vertex attribute from the table. One draw call per chunk (a dense Midtown tile has 2-3 chunks).

Minimal three.js loader (the build script's `unpackTile` in `scripts/manhattan/pack.mjs` is the reference decoder):

```js
const dv = new DataView(buf);
const nv = dv.getUint32(40, true), nc = dv.getUint32(52, true), chunkOff = dv.getUint32(56, true);
const ox = dv.getFloat32(16, true) - dv.getFloat32(28, true), oz = dv.getFloat32(20, true) - dv.getFloat32(28, true);
const ps = dv.getFloat32(24, true), ys = dv.getFloat32(32, true), yo = dv.getFloat32(36, true);
const pos = new Float32Array(nv * 3);
for (let i = 0; i < nv; i++) {
  pos[3*i]   = ox + dv.getUint16(64 + 6*i, true) * ps;
  pos[3*i+1] = yo + dv.getUint16(64 + 6*i + 2, true) * ys;
  pos[3*i+2] = oz + dv.getUint16(64 + 6*i + 4, true) * ps;
}
const idxOff = 64 + ((nv * 6 + 3) & ~3);
for (let c = 0; c < nc; c++) {
  const p = chunkOff + 16 * c;
  const [vF, vC, iF, iC] = [0, 4, 8, 12].map((o) => dv.getUint32(p + o, true));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(vF * 3, (vF + vC) * 3), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, idxOff + 2 * iF, iC), 1)); // 2-byte aligned view, no copy
}
```

Style classes (`manifest.styles`, byte 34): generic, walkup, rowhouse, prewar_tower, artdeco, modern_tower, postwar_midrise, loft, institution, commercial_low, landmark, garage, utility, supertall_glass. Flags (byte 35): 1 landmark, 2 historic district, 4 notable, 8 tiered (real setbacks from the 3-D model), 16 merged mass, 32 height missing (default 3 m), 64 home lot.

### LODs

| LOD | Intended distance | What it is |
|---|---|---|
| 0 | camera within ~1.5 km | real footprints simplified with 0.35 m Douglas-Peucker; roof tiers from the 3-D model (42,664 buildings, including Empire State with its spire, Chrysler crown, One WTC, wedding-cake setbacks, Low Library dome); walls hidden by taller neighbours are not emitted; minor structures (sheds, under 6 m2 / 8 m) dropped |
| 1 | 1.5-5 km | footprints at 1.6 m; buildings under 32 m that touch on one tax block and are within 5 m of height merge into one hull prism when the hull stays within 1.3x of their combined area; tiers only for buildings of 45 m or more; tiny buildings dropped |
| 2 | beyond ~5 km | towers of 58 m or more individually (tiers only from 150 m); everything else merged per tax block into hull masses (split at 20 m height) |

Tiers are used only when a 3-D-model roof polygon matches the footprint's current roof height (otherwise the building changed after 2014: 946 buildings get a plain extrusion). The 3-D model is from 2014 and the footprints are current (updated Oct 2026); buildings built later (Hudson Yards ...) are therefore plain extrusions with their correct height. The exception is **Billionaires' Row**: the five supertalls of the final level are given hand-built tier stacks (`scripts/manhattan/supertalls.mjs`, see below).

### Terrain (`terrain.bin`, `MTRN` v1)

```
0 'MTRN'  4 u16 version=1  8 f32 cell=25 (m)  12 f32 originX  16 f32 originZ (corner of cell [0,0])
20 u32 nx=489  24 u32 nz=884  28 f32 unit=0.1 (m per step)  32 i16[nx*nz], row-major (z rows), -32768 = water / off the island
```

Heights are interpolated from the buildings' ground elevations over the land polygon (parks and piers are filled from neighbours, then lightly blurred). Buildings carry their own `baseY` and walls reach 1 m below it, so when you mesh the terrain from this grid, sit it about 1-2 m below the grid values (or clamp it under building footprints) to avoid it poking through facades on slopes such as the Morningside escarpment. Water is the plane y = 0.

### Vector layers (JSON, flat coordinate arrays `[x0, z0, x1, z1, ...]`, metres, 0.1 m precision, rings open)

- `land.json`: `{ polys: [[outerRing, hole...], ...], bounds: [minX, minZ, maxX, maxZ] }`, 36 polygons (Manhattan plus its islands), 1.2 m tolerance.
- `parks.json`: `{ types: [..], parks: [{ n: name, t: typeIndex, a: acres, c: [cx, cz], p: [ring, hole...] }] }`, 690 pieces, already clipped to land (Riverside Park no longer reaches into the Hudson), 0.8 m tolerance, pieces under 120 m2 dropped.
- `streets.json`: `{ classes: ['street','avenue','highway','bridge','path'], names: [..], lines: [{ c: class, n: nameIndex, w: widthMetres, p: [...] }] }`. 2,328 polylines merged end-to-end per street name (1,126 streets, 239 avenues/boulevards, 78 highways/parkways, 234 bridge pieces (Manhattan's share of each bridge), 651 park paths). Avenue = AVE / Broadway / Bowery / Blvd / Park Row, plus the major crosstown streets (14, 23, 34, 42, 57, 59, 72, 79, 86, 96, 110, 116, 125, Houston, Canal, Delancey, Grand). Highways: FDR Drive, Henry Hudson Pkwy, Harlem River Drive, West/South Street and any `rw_type 2`. Draw them on the terrain; bridges leave the island (the dataset splits them at the borough line).
- `nta.json`: `{ neighborhoods: [{ code, name, abbrev, type, cd, centroid, bbox, areaKm2, polys: [[ring, hole...], ...] }] }`, 38 NTAs (`type` 0 = residential neighbourhood, 6 = United Nations, 9 = park/island: Central Park, Randall's Island, The Battery-Governors-Ellis-Liberty, Highbridge and Inwood Hill Parks). Code groups that suggest level districts, south to north: MN01 Financial District / Battery, MN02 SoHo-Greenwich-West Village, MN03 Chinatown-LES-East Village, MN04 Chelsea-Hell's Kitchen, MN05 Midtown, MN06 Gramercy-Murray Hill-East Midtown, MN07 Upper West Side, MN08 Upper East Side, **MN0901 Morningside Heights**, MN0902 Manhattanville, MN0903 Hamilton Heights, MN10-11 Harlem, MN12 Washington Heights-Inwood.
- `farshore.json`: `{ polys: [{ b: boroughName, p: ring }] }`, 25 m tolerance, for a faint silhouette at most.

### Notable buildings (`notables.json`)

29 entries `{ id, name, kind: 'building'|'site'|'bridge'|'park', x, z, nta, bin, bbl, baseY, heightM, year, tiered }` (buildings resolved from real coordinates to the footprint's BIN, with a sanity check on height; sites/bridges/parks carry `baseY` from the terrain). Buildings: Empire State (BIN 1015862, 377.6 m), Chrysler (1036156), One World Trade (1088469, 429 m), Flatiron, One Times Square, Bank of America Tower, 30 Rockefeller Plaza, Woolworth, Grand Central, UN Secretariat, Madison Square Garden/Penn, NYU Bobst, Cooper Union Foundation Building, 432 Park Avenue, and in Morningside Heights: Low Library, Butler Library, Pupin Hall, Cathedral of St. John the Divine, Riverside Church, Grant's Tomb. Sites: Times Square, Columbia Broadway gate (116th St), Washington Square Arch, Hudson Yards Vessel, Statue of Liberty. Bridge markers: Brooklyn Bridge and Manhattan Bridge approaches, George Washington Bridge tower. Parks: Great Lawn (Central Park), The Battery. `heightM` is the footprint roof height; the rendered top is higher where the 3-D model adds a spire or antenna (Empire State reaches 444 m with its antenna, One World Trade 538 m, Chrysler 307 m).

### The year of lots (`home.json` v2)

The user studies for a year, so every day gets its own **permanent real tax lot**: `weeks[row].slots[]`, 365 lots in 53 week rows. A study day fills its lot with that day's tower for good; a day without study leaves the lot empty (gravel, a low hoarding and a survey stake, no shame); days to come are quiet pads with survey stakes; this week's row is outlined. Nothing recycles and nothing disappears.

```
{ version: 2, description, anchor: 'low-library', dayOne: '2026-10-18', firstMonday: '2026-10-12', slotCount: 365, rows: 53,
  neighborhoods: [{ code: 'MN0901', name, firstRow, rows }, { code: 'MN0703', ... }],
  file: { file: 'home/home_buildings.bin', bytes, tileX, tileZ, buildings: 365, tris },
  weeks: [{ row, monday, nta, slots: [slot, ...] }, ...] }
slot = { n, date, wd, bbl, bin, address, x, z, baseY, front: [fx, fz], realHeightM, areaM2, year, bldgClass, style, nta, footprint, holes }
```

- **Rows.** A row is one Monday-to-Sunday week, matching the Today week strip: `wd` 0 = Monday .. 6 = Sunday. Day 1 (Sun 2026-10-18) opens **row 0, which holds Day 1 alone** (the days before Day 1 are not slots); rows 1..52 are full weeks, through Sun 2027-10-17 (Day 365), about the user's planned NYC trip (Sept-Nov 2027). Slot `n` is days since Day 1 and the n-th slot of the weeks flattened; `date` is `dayOne + n`. The game maps a day to `(week, wd, n)` with `epoch/game.py year_slot` (`/api/world` sends it as each day's `slot`); days after Day 365 get `slot.lot = false` and have no place on the map, nothing breaks.
- **Real lots, a row of 7 touching lots per week.** Each week's 7 lots are neighbours (footprints at most 14 m apart) in a chain that runs straight (the whole row drifts at most 16 m, 22 m in Morningside Heights, from the line between its two ends); the chain may turn a block corner. Slots within a week go in walking order (Monday first); weeks go in walking order too: the first week is the residential row nearest Low Library, the walk then sweeps Morningside Heights (16 of the 53 rows, including Day 1's) and ends where the second neighbourhood begins (a 2-opt order, so there are no long jumps back).
- **Selection rules** (deterministic, `scripts/manhattan/places.mjs`, `pickYearLots`, `YEAR_RULES`): residential, mixed-use or small commercial lots (PLUTO land use 1-5, building class A/B/C/D/K/O/R/S); a footprint of 70-1,600 m2 and 4-80 m tall that fills at least 40% of its grid-aligned bounding box, at most 4 buildings on the tax lot (the largest is replaced); not an individual landmark and not a notable. **Land use 8 (institutions: Columbia and Barnard, churches and synagogues, schools, hospitals) never qualifies**, and a box around Columbia's main campus (W 114th to W 120th, Broadway to Amsterdam) is excluded too, so campus, landmarks and houses of worship stay. 921 lots qualify; 365 are used.
- **Why Morningside Heights and the northern Upper West Side, and not Manhattanville.** Morningside Heights is mostly Columbia and institutions and Manhattanville-West Harlem is small: together they hold only about 30 straight weekly rows of touching lots (15 in Morningside Heights, 18 in Manhattanville at the loosest setting), well short of the 52 a year needs. Manhattan Valley (NTA MN0703, W 100th-110th) has 60+ rows of brownstones and walk-ups, runs straight on south of Morningside Heights along the same avenues, and is one NTA away from the user's first block. It lights with the Upper West Side (levels 5-6); a locked neighbourhood only fades, the pads and towers stay.
- **Front.** `front` is the unit vector (x, z) from the lot toward its street, snapped to a grid axis (a ray from the footprint's edge in each of the four grid directions to the nearest street or avenue centreline). The renderer turns each tower to face it.
- **Cleared lots.** The real buildings of all 365 slots are **not in `lod0/1/2`**; they are in `home/home_buildings.bin` (same tile format; the file's tile is in `home.json: file`) with their BINs, marked by `FLAGS.HOME_LOT` (64). The renderer keeps those meshes hidden; the lot is a pad. `heights.bin` leaves them out (a cleared lot has no roof to collide with) but `trees.bin` still keeps trees off them.

Pipeline after changing any of this: `node scripts/build_manhattan.mjs`, then `brow.mjs`, `props.mjs`, `map_svg.mjs` (see Build).

## Checks

`tests/test_manhattan_data.py` verifies the manifest, tile headers and index ranges, the LOD0 25 MB budget, the year of lots (365 slots in 53 Monday-to-Sunday rows, dates, weekdays, `game.year_slot` agreeing, rows of touching lots, real buildings only in the home file), the notables, and the vector layers. The build script runs the same style of self-test on every run and exits non-zero on failure.

## Known limits

- The 3-D model is from 2014; newer buildings have no setbacks. Roof shapes are tiers and flat or planar roofs, no domes beyond what the model's polygons give.
- Footprint heights are roof heights; antennas only come from the 3-D model.
- Hairline seams between some walls can show the back side; use `side: FrontSide` with a dark fill behind, or a slight emissive fog colour.
- No New Jersey shoreline (not NYC data), no subway, no building names beyond the notables.
- PLUTO attributes may be missing for new lots; styling falls back to the footprint's height and construction year.

## Renderer extras and the City view (`city/manhattan.js`)

Two more build steps, run after `build_manhattan.mjs` (both re-runnable, both offline once `build/manhattan-raw/` is cached):

```
node scripts/manhattan/props.mjs      # hydro.json, heights.bin, trees.bin (downloads 2 more Socrata tables once)
node scripts/manhattan/map_svg.mjs    # map.svg, the no-WebGL fallback
```

| File | Size | Source / contents |
|---|---|---|
| `hydro.json` | 23 KB | NYC Planimetric Database: Hydrography (`pjs3-c3z5`, OTI): the 13 inland water bodies on the land polygon (Reservoir, The Lake, Harlem Meer, Turtle Pond ...), `{lakes: [{n, a (m2), p: [ring, hole...]}]}` |
| `heights.bin` | 1.3 MB | `MHGT` v1: highest roof per 20 m cell from the LOD0 + home tiles (camera collision). `0 'MHGT' 4 u16 version 8 f32 cell 12 f32 originX 16 f32 originZ 20 u32 nx 24 u32 nz 28 f32 unit(0.1) 32 i16[nx*nz]`, -32768 = none |
| `trees.bin` | 0.4 MB | `MTRE` v1: about 22,500 street trees, a fixed 4-in-10 pick of the 2015 Street Tree Census (`uvpi-gqnh`, NYC Parks), each pushed 1.5 m behind the kerb of any road it landed on (0.6 m on narrow sidewalks; dropped if there is no room), crown from trunk diameter (max 4 m) + ~26,000 park trees scattered over Parks Properties, kept off buildings, roads, paths and water and thinned on the big Central Park lawns. `8 u32 count 12 u32 streetCount`, records of 8 B: `i16 x, i16 z (0.5 m), i16 ground y (0.1 m), u8 crown radius (0.1 m), u8 kind (0 park, 1 street, 2 woods)` |
| `map.svg` | 104 KB | land, parks, lakes, avenues, neighbourhood outlines and the 365 lots of the year, north to the right |

Attribution shown in the City view: *Map data: NYC Open Data (OTI, DCP, Parks, LPC), 2015 Street Tree Census, Planimetric Hydrography*. The far-shore pier outlines that the borough boundary carries along the Brooklyn shore (small pieces > 200 m from the island) are dropped at load, so only Manhattan is land.

Renderer modules (no build step; ES modules beside `city.js`): `city/manhattan.js` (scene, camera, controls, fly-to, API), `mh_tiles.js` (tile decode with u16 positions kept on the GPU, the building shader, LOD streaming), `mh_ground.js` (terrain mesh, a painted ground texture in the street-grid frame, bulkhead edge, river shader with shore foam, faint far shore, district mask), `mh_props.js` (instanced trees per tile, 33k lamp points, rooftop water towers and mechanical boxes per LOD0 tile), `mh_bridges.js` (Brooklyn, Manhattan, Williamsburg, Queensboro, George Washington and the Harlem River decks), `mh_home.js` (the user's towers on the real lots). `createCity(host, {mode: 'city'})` returns `createManhattan(...)`; the Today hero and the focus screen keep the framed diorama.

Streaming: every tile's LOD2 (1.6 MB in all) loads first, then LOD0 within ~1.35 km x bias and LOD1 within ~4.6 km x bias, nearest and visible first, four at a time; the visible tile triangles stay under the budget by coarsening the farthest tiles; unshown fine LODs are evicted past the memory budget. Profiles: laptop 2.5 M tile triangles, bias 1, DPR <= 2, 4x MSAA, ground texture ~3 m/px (2124 x 8192), 25 m terrain, trees within 2.1 km, 70 MB of tile data; tablet (coarse pointer, deviceMemory <= 4 or max texture < 8192; `?city-profile=tablet|laptop` forces one) 0.8 M, bias 0.62, DPR <= 1.5, 2x MSAA, ~6 m/px, 50 m terrain, trees within 1.1 km, 26 MB.

API additions over `createCity`: `flyTo(id, {instant})` with ids `home, columbia, centralpark, midtown, timessquare, downtown, island`; `places()`; `setUnlockedDistricts(ids)` (NTA codes or prefixes such as `'MN09'`, or `'all'`; locked neighbourhoods fade to a desaturated, dimmed, fogged look over 1.3 s, instant under reduced motion); `districts()`. `?city-districts=demo` shows a demo mask. Ladder progress (`setLandmarks`) lights the real landmarks: Python the Brooklyn Bridge necklace, Math the Empire State crown, ML/DL the Chrysler crown, Papers the floodlit Flatiron, Writing/X the Times Square screens, each in its ladder colour. Each day goes to its own lot of the year (`slot.n` from `/api/world`, else the date minus `home.json: dayOne`): a study day is the tower, a rest day a pocket park, a day without study an empty lot (gravel, hoarding, survey stake), today the lot with its site and ring, days to come quiet pads. Pads, hoardings and stakes are one merged mesh rebuilt only when a lot changes state; each tower is its own mesh, culled by the frustum and hidden beyond 9 km. World mode numbers the slots by the index in the days array it was given (the whole year), the framed stages by weekday (0 = Monday) of this week's row. `places.home` ('My block') is this week's row: its middle, a distance that fits it and the street side it faces.


## Billionaires' Row silhouettes (`scripts/manhattan/supertalls.mjs`)

The final level is the supertall corridor on W 57th Street / Central Park South, and it has to read beautifully from afar. Four of its towers post-date the 3-D model (and the footprint layer gives them whole-lot footprints), so `prepBuildings` replaces their tiers with a stack of flat roof polygons built from the published drawings and photographs, in the street-grid frame, on the real footprints and heights:

| Tower (BIN) | Height | Silhouette | Style (shader) |
|---|---|---|---|
| Central Park Tower, 217 W 57th (1090180) | 472 m | lot-wide podium (70 m), then a shaft that overhangs the Art Students League to the east and steps in on every side to a slim flat crown | 13 supertall glass |
| 111 W 57th, the Steinway Tower (1023728) | 435 m | the Steinway Hall base (44 m), then a 60 ft wide blade: the park (north) face is a sheer wall, the south face feathers down in eleven small setbacks, a pinnacle at the tip | 14 terracotta and bronze ribs (tall slim windows) |
| One57 (1088565) | 306 m | its own tiers from the 2014 3-D model (it was topped out in 2013) | 13 |
| 220 Central Park South (1090184) | 290 m | an L-shaped limestone mass stepping in four times, then the arm alone rising to a narrow crown | 16 limestone |
| 432 Park Avenue (1088817) | 425 m | a low base on the whole site and a pure 28.5 m square tube on its north-west corner (the thin strip record 1035787 is flattened into the base) | 15 pale concrete, a grid of 3 m square windows |

The tiers are ordinary `tiers` records, so every LOD, the packer and `brow.mjs` see them like any other building. Styles 14 to 16 are the only additions to the style table (`STYLES` in `buildings.mjs`, `STYLE_N` and the shader in `city/mh_tiles.js`). `brow.mjs` (run after `build_manhattan.mjs`) cuts each tower just under its roof for the penthouse band and the Home camera pose, so changing the dream home needs no rebuild.

## The framed stages and the live layers

`city/manhattan.js` serves three stages (`createCity(host, {mode})`; `mode: 'week'` plus the `.stage--cam` class gives the focus screen):

| Stage | Shows | Camera |
|---|---|---|
| World > City | the whole island, the year of towers (every day since Day 1 on its own lot), districts, the dream home | free 360 camera, pan, zoom, fly-to chips |
| Today hero (`week`) | this week's seven lots on the user's block | framed on those lots from the side most of them face; it may sway about 35 degrees and nothing else (no pan, no zoom; touch can still scroll the page) |
| Focus screen (`cam`) | today's lot close up, with the construction crane (`construction.js`: crane, scaffold, topping out) standing in the lot's own frame | the same rules, about 15 degrees of sway |

The two framed stages stream only the tiles around the block (small triangle budget, shorter tree distance, a coarser ground texture); the focus screen is lighter still because it runs for hours. A date keeps its lot for good (see the year of lots): the framed stages show this week's row of 7 lots (built, today, blanks) with the neighbouring weeks around it.

Live layers (all optional, all cheap): `setWeather` drives rain and snow particles and the lightning flash (`weather.js` scaled to metres, `unit` and `bare` options) and bends the light; `setFlow` stands eight brass streetlights along the avenue nearest the block (`mh_flow.js`, `lampSites`), one lit per hour of flow; `setSeasonal` (`mh_seasonal.js`) puts pumpkins, diyas, flags, blossom trees and garlands on each lot's stoop in the lot's own frame, the plaza props (rangoli, the big tree, the parade balloon, the finish arch, the rainbow crossing) on Columbia's Low Plaza, the New Year ball on the real One Times Square, and fireworks over the river beside the block; `setConstruction`, `toppingOut`, `focusConstruction`, `setLive` are the construction cam. Under reduced motion nothing moves and the fireworks stay hidden; the tablet profile lowers every particle count.

## Final review notes (renderer)

- **Facade precision.** The building shader takes its flat normal and window grid from small-magnitude varyings: `vRel` (fragment minus
  camera) for the screen derivatives and `vLoc` (position relative to the tile mesh origin) for the window column. Using raw world
  coordinates broke the window grid into per-pixel noise far from the origin (Morningside is 5.5 km from Times Square, Inwood 13 km).
- **Cutaway toward the user's tower.** Morningside's real buildings are as tall as a 16-storey day tower, so on the Today hero and the
  Focus Screen (and for a picked lot on the City stage) real buildings and their rooftop props inside a cone from the camera to the
  tower are dropped with a screen-door pattern (`uCut`, `uCutR`, `cutAway()` in `COMMON_GLSL`; set each frame in `viewUniforms()`).
- **Hero framing.** The Today hero frames the days of the week that have happened (future lots stay off-frame), weights the centre
  toward today's and built towers, prefers headings that see a tower's street side, and may tilt down (polar 0.95 to 0.56).
- **Home pose.** The Dream home view looks between Morningside and the middle of Central Park from 32 m outside the penthouse band,
  so the 20 m roof grid does not lift the camera onto the roof. Phones show only the caption headline.
- **Far shore** fades at grazing angles (camera height / distance below about 0.07) so it does not sit as a dark slab on the haze.
- **Rooftop props** take the district veil, so locked rooftops do not float dark in the mist.
