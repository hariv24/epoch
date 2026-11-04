#!/usr/bin/env node
// Build the offline Manhattan dataset used by the 3-D city.
//
//   node scripts/build_manhattan.mjs            # use cached downloads in build/manhattan-raw/, rebuild the output
//   node scripts/build_manhattan.mjs --refresh  # re-download the Socrata tables (the 916 MB 3-D model is never re-downloaded
//                                               # unless build/manhattan-raw/3dmodel/DA_WISE_GML.zip is missing; add --refresh-3d)
//
// Output: epoch/web/static/app/city/manhattan/  (see docs/MANHATTAN-DATA.md)
// Needs: node >= 20 (global fetch), `curl` and `unzip` (only for the one-off 3-D model extraction).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached, SOURCES } from './manhattan/fetch.mjs';
import { extractTiers } from './manhattan/extract3d.mjs';
import { ORIGIN, lonLatToXZ, bboxOf, round, ringArea } from './manhattan/geo.mjs';
import { prepBuildings, FLAGS, STYLES } from './manhattan/buildings.mjs';
import { meshLod } from './manhattan/tiles.mjs';
import { packTile, unpackTile, TILE, POS_SCALE, PAD, Y_SCALE, Y_OFFSET, MAX_CHUNK_VERTS, BUILDING_REC } from './manhattan/pack.mjs';
import { buildLand, buildParks, buildNta, buildFarShore, buildStreets, ntaOf } from './manhattan/vector.mjs';
import { buildTerrain } from './manhattan/terrain.mjs';
import { NOTABLES, resolveNotables, pickYearLots, yearWeeks, campusTest, YEAR_NTAS, gridOf, GRID_DEG } from './manhattan/places.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const RAW = path.resolve(arg('--raw', path.join(ROOT, 'build', 'manhattan-raw')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'epoch', 'web', 'static', 'app', 'city', 'manhattan')));
const REFRESH = process.argv.includes('--refresh');
const t0 = Date.now();
const lap = (m) => console.log(`[build] ${m} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const writeJson = (name, obj) => {
  const f = path.join(OUT, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const txt = JSON.stringify(obj);
  fs.writeFileSync(f, txt);
  return Buffer.byteLength(txt);
};

// ---------------------------------------------------------------------------------------------- 1. data
fs.mkdirSync(RAW, { recursive: true });
const data = {};
for (const spec of SOURCES) data[spec.id] = await cached(RAW, spec, REFRESH);
data.tiers3d = await extractTiers(RAW, { refresh: process.argv.includes('--refresh-3d') });
lap(`loaded ${data.footprints.length} footprints, ${data.pluto.length} PLUTO lots, ${Object.keys(data.tiers3d).length} 3-D tier records`);

// ---------------------------------------------------------------------------------------------- 2. process
const buildings = prepBuildings({ footprints: data.footprints, pluto: data.pluto, landmarks: data.landmarks, tiers3d: data.tiers3d });
lap('buildings prepared');

const { land, rawLand } = buildLand(data.borough);
const { types: parkTypes, parks } = buildParks(data.parks, rawLand);
const ntas = buildNta(data.nta);
const streets = buildStreets(data.centerline);
const farshore = buildFarShore(data.boroughs_all);
let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
for (const poly of rawLand) { const b = bboxOf(poly[0]); X0 = Math.min(X0, b[0]); Z0 = Math.min(Z0, b[1]); X1 = Math.max(X1, b[2]); Z1 = Math.max(Z1, b[3]); }
const landBounds = [round(X0, 1), round(Z0, 1), round(X1, 1), round(Z1, 1)];
lap(`vectors: ${land.polys.length} land polygons, ${parks.length} parks, ${ntas.length} NTAs, ${streets.lines.length} street polylines`);

const terrain = buildTerrain(rawLand, buildings, landBounds);
lap(`terrain ${terrain.info.nx}x${terrain.info.nz} cells, ${terrain.info.minY}..${terrain.info.maxY} m`);

const grid = gridOf(buildings);
const notables = resolveNotables(buildings, ntas, terrain, grid);
const unresolved = notables.filter((n) => n.unresolved);
if (unresolved.length) console.warn('[warn] unresolved notables: ' + unresolved.map((n) => n.id).join(', '));

// ---- home block: a year of permanent lots (one real tax lot per study day, a row of 7 per Monday-to-Sunday week), see places.mjs
const DAY_ONE = arg('--day-one', '2026-10-18');                       // the user's Day 1 (a Sunday): the week row of Day 1 holds only that day
const low = notables.find((n) => n.id === 'low-library');
const gate = notables.find((n) => n.id === 'columbia-gate');
const picked = pickYearLots({ buildings, pluto: data.pluto, streets, ntas, anchor: [low.x, low.z], weeks: 52, campus: campusTest([gate.x, gate.z]), log: (m) => console.log('[build] ' + m) });
if (picked.rows.length < 52 || !picked.first) throw new Error('fewer than 52 week rows of lots found: ' + picked.rows.length);
// outer ring counter-clockwise (ringArea > 0 in the x-z plane), holes clockwise
const orient = (r, wantPositive) => ((ringArea(r) > 0) === wantPositive ? r : r.slice().reverse());
const flatten = (r) => { const o = []; for (const p of r) o.push(round(p[0], 2), round(p[1], 2)); return o; };
const ntaNames = Object.fromEntries(ntas.map((n) => [n.code, n.name]));
const year = yearWeeks({ picked, dayOne: DAY_ONE, ntaNames, orient, flatten, homeFlag: FLAGS.HOME_LOT });
const homeSlots = year.weeks.flatMap((w) => w.slots);
lap(`home block: ${homeSlots.length} lots in ${year.weeks.length} week rows (${year.neighborhoods.map((n) => `${n.rows} in ${n.name}`).join(', ')}), ${picked.cand.length} eligible`);
const homeBuildings = buildings.filter((b) => b.flags & FLAGS.HOME_LOT);
const worldBuildings = buildings.filter((b) => !(b.flags & FLAGS.HOME_LOT));

// ---------------------------------------------------------------------------------------------- 3. mesh + pack
for (const d of ['lod0', 'lod1', 'lod2', 'home']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
const tileMap = new Map(); // "tx,tz" -> { tx, tz, lods: {} }
const totals = { lod: {} };
const quiet = () => {};
for (const lod of [0, 1, 2]) {
  const tiles = meshLod(worldBuildings, lod);
  let bytes = 0, tris = 0, verts = 0, nb = 0;
  for (const t of tiles.values()) {
    const p = packTile({ lod, tx: t.tx, tz: t.tz, mesh: t.mesh, table: t.table });
    const rel = `lod${lod}/${t.tx}_${t.tz}.bin`;
    fs.mkdirSync(path.join(OUT, `lod${lod}`), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), p.buf);
    const key = t.tx + ',' + t.tz;
    let rec = tileMap.get(key); if (!rec) tileMap.set(key, (rec = { x: t.tx, z: t.tz, lods: {} }));
    rec.lods[lod] = { file: rel, bytes: p.buf.length, verts: p.nv, tris: p.ni / 3, buildings: p.nb, chunks: p.nChunks, bounds: p.bounds.map((v) => round(v, 1)) };
    bytes += p.buf.length; tris += p.ni / 3; verts += p.nv; nb += p.nb;
  }
  totals.lod[lod] = { files: tiles.size, bytes, verts, tris, buildings: nb };
  lap(`LOD${lod}: ${tiles.size} tiles, ${(bytes / 1e6).toFixed(2)} MB, ${tris} tris`);
}

// home buildings: full-detail real geometry, one MNTL file, so the renderer can show the real building until/unless a tower replaces it
let homeFile = null;
{
  const hx = Math.floor(low.x / TILE), hz = Math.floor(low.z / TILE);
  const tiles = meshLod(homeBuildings, 0, quiet, { fixedTile: [hx, hz] });
  const t = [...tiles.values()][0];
  const p = packTile({ lod: 0, tx: t.tx, tz: t.tz, mesh: t.mesh, table: t.table });
  fs.mkdirSync(path.join(OUT, 'home'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'home', 'home_buildings.bin'), p.buf);
  homeFile = { file: 'home/home_buildings.bin', bytes: p.buf.length, tileX: t.tx, tileZ: t.tz, buildings: p.nb, tris: p.ni / 3 };
}

// ---------------------------------------------------------------------------------------------- 4. side files
const sizes = {};
sizes['land.json'] = writeJson('land.json', { ...land, bounds: landBounds });
sizes['parks.json'] = writeJson('parks.json', { types: parkTypes, parks });
sizes['streets.json'] = writeJson('streets.json', streets);
sizes['nta.json'] = writeJson('nta.json', { neighborhoods: ntas.map(({ polys, ...rest }) => ({ ...rest, polys })) });
sizes['farshore.json'] = writeJson('farshore.json', farshore);
fs.writeFileSync(path.join(OUT, 'terrain.bin'), terrain.buf); sizes['terrain.bin'] = terrain.buf.length;
sizes['notables.json'] = writeJson('notables.json', { notables });
sizes[homeFile.file] = homeFile.bytes;
sizes['home.json'] = writeJson('home.json', {
  version: 2,
  description: 'A year of permanent real tax lots for the day towers: weeks[row].slots[], one lot per study day since Day 1, a row of 7 touching lots per Monday-to-Sunday week, in walking order from Low Library through Morningside Heights and on into the northern Upper West Side. Day n (0-based since Day 1) uses the n-th slot in order (weeks flattened).',
  anchor: 'low-library', dayOne: DAY_ONE, firstMonday: year.monday0, slotCount: year.slotCount, rows: year.weeks.length,
  neighborhoods: year.neighborhoods, file: homeFile, weeks: year.weeks,
});

// ---------------------------------------------------------------------------------------------- 5. manifest
const tileList = [...tileMap.values()].sort((a, b) => a.x - b.x || a.z - b.z);
const allB = tileList.flatMap((t) => Object.values(t.lods).map((l) => l.bounds));
const bounds3 = [Math.min(...allB.map((b) => b[0])), Math.min(...allB.map((b) => b[1])), Math.min(...allB.map((b) => b[2])),
  Math.max(...allB.map((b) => b[3])), Math.max(...allB.map((b) => b[4])), Math.max(...allB.map((b) => b[5]))];
const [mLon0] = [ORIGIN.lon];
const mPerLat = (() => { const a = lonLatToXZ(ORIGIN.lon, ORIGIN.lat), b = lonLatToXZ(ORIGIN.lon, ORIGIN.lat + 0.001); return round(-(b[1] - a[1]) * 1000, 2); })();
const mPerLon = (() => { const a = lonLatToXZ(ORIGIN.lon, ORIGIN.lat), b = lonLatToXZ(ORIGIN.lon + 0.001, ORIGIN.lat); return round((b[0] - a[0]) * 1000, 2); })();
const manifest = {
  name: 'Manhattan', version: 2, generated: new Date().toISOString().slice(0, 10), builder: 'scripts/build_manhattan.mjs',
  frame: {
    units: 'metres', axes: 'X = east, Y = up (metres above NAVD88 mean sea level), Z = south (north is -Z)',
    origin: { lon: ORIGIN.lon, lat: ORIGIN.lat, name: 'Times Square (Broadway & W 45th St area)' },
    metresPerDegreeAtOrigin: { lon: mPerLon, lat: mPerLat },
    project: 'x = (lon - lon0) * mPerDegLon(lat); z = -(meridianArc(lat) - meridianArc(lat0)); exact WGS84 meridian arc, error < 0.3 m over the island',
    gridRotationDeg: GRID_DEG,
    gridNote: 'Manhattan\'s street grid is ~29 degrees east of true north. Data stays true-north aligned; to draw the grid axis-aligned rotate the whole scene by +29 degrees about +Y (three.js rotation.y = +29deg*PI/180 turns the avenues to run along -Z).',
    landBounds, bounds3d: bounds3.map((v) => round(v, 1)),
  },
  tile: { size: TILE, pad: PAD, posScale: POS_SCALE, yScale: Y_SCALE, yOffset: Y_OFFSET, maxChunkVerts: MAX_CHUNK_VERTS, buildingRecordBytes: BUILDING_REC, magic: 'MNTL', version: 2, tileOf: 'tileX = floor(x / size), tileZ = floor(z / size) of the building centroid' },
  lods: [
    { lod: 0, name: 'full', use: 'camera within ~1.5 km', note: 'real footprints (0.35 m tolerance) plus roof tiers/setbacks from the 3-D model' },
    { lod: 1, name: 'simplified', use: '1.5-5 km', note: 'footprints simplified to 1.6 m, buildings < 32 m on the same block merged into hull prisms, tiers only for buildings >= 45 m, small outbuildings dropped' },
    { lod: 2, name: 'massing', use: '> 5 km', note: 'towers >= 58 m individually, everything else merged per tax block into hull masses' },
  ],
  styles: STYLES, flags: FLAGS,
  tiles: tileList,
  totals: {
    buildingsInSource: buildings.length, buildingsInWorldTiles: worldBuildings.length, homeLotBuildings: homeBuildings.length,
    tiersUsed: buildings.filter((b) => b.flags & FLAGS.TIERED).length,
    lod: totals.lod,
  },
  files: {
    land: 'land.json', parks: 'parks.json', streets: 'streets.json', neighborhoods: 'nta.json', farShore: 'farshore.json',
    terrain: 'terrain.bin', notables: 'notables.json', home: 'home.json', homeBuildings: homeFile.file,
  },
  fileBytes: sizes,  // (manifest.json itself excluded)
  terrain: terrain.info,
  vectors: {
    landPolygons: land.polys.length, parks: parks.length, parkTypes, neighborhoods: ntas.map((n) => ({ code: n.code, name: n.name, abbrev: n.abbrev, type: n.type, centroid: n.centroid, areaKm2: n.areaKm2 })),
    streetPolylines: streets.lines.length, streetClasses: streets.classes, notables: notables.length, homeLots: homeSlots.length,
  },
  attribution: [
    'Building footprints, street centerlines, 3-D Building Model: City of New York, Office of Technology and Innovation (OTI), via NYC Open Data',
    'Borough boundaries, Neighborhood Tabulation Areas, PLUTO: NYC Department of City Planning (DCP), via NYC Open Data',
    'Parks Properties: NYC Department of Parks and Recreation, via NYC Open Data',
    'Individual Landmark and Historic District Building Database: NYC Landmarks Preservation Commission, via NYC Open Data',
  ],
  attributionShort: 'Map data: NYC Open Data (OTI, DCP, Parks, LPC)',
};
sizes['manifest.json'] = writeJson('manifest.json', manifest);
lap('manifest written');

// ---------------------------------------------------------------------------------------------- 6. self-test
let bad = 0;
const fail = (m) => { bad++; console.error('[FAIL] ' + m); };
for (const t of tileList) for (const [lod, l] of Object.entries(t.lods)) {
  const buf = fs.readFileSync(path.join(OUT, l.file));
  if (buf.length !== l.bytes) fail(l.file + ' size mismatch');
  const u = unpackTile(buf);
  if (u.h.tx !== t.x || u.h.tz !== t.z || u.h.lod !== +lod) fail(l.file + ' header mismatch');
  for (const c of u.chunks) {
    if (c.vCount > 65535) fail(l.file + ' chunk too big');
    for (let i = c.iFirst; i < c.iFirst + c.iCount; i++) if (u.idx[i] >= c.vCount) { fail(l.file + ' index out of chunk'); break; }
  }
  let tri = 0;
  for (const b of u.table) { tri += b.count / 3; if (b.vFirst + b.vCount > u.h.nv) fail(l.file + ' building vertex range'); if (!(b.h > 0)) fail(l.file + ' building with no height (bin ' + b.bin + ')'); }
  if (tri !== l.tris) fail(l.file + ' triangle sum');
}
const l0 = totals.lod[0];
if (l0.bytes > 25e6) fail(`LOD0 is ${(l0.bytes / 1e6).toFixed(1)} MB (> 25 MB budget)`);
console.log(bad ? `[build] ${bad} self-test failures` : '[build] self-test OK');
console.log(`[build] done: ${tileList.length} tiles; LOD0 ${(l0.bytes / 1e6).toFixed(1)} MB, LOD1 ${(totals.lod[1].bytes / 1e6).toFixed(1)} MB, LOD2 ${(totals.lod[2].bytes / 1e6).toFixed(1)} MB; side files ${(Object.values(sizes).reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} MB`);
if (bad) process.exit(1);
