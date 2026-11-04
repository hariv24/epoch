// scripts/world/blocks.mjs · per-block-face descriptors for the walkable street (docs/WORLD.md 12.1). Build time only.
//
//   python3 scripts/world/pluto.py && python3 scripts/world/lpc_parse.py && node scripts/world/blocks.mjs
//
// Reads  build/manhattan-raw/{footprints,centerline}.json (the Manhattan build's cache), build/world-raw/{pluto_mn,lpc_2571}.json,
//        epoch/web/static/app/city/manhattan/trees.bin   and (best effort) NYC Open Data hydrants (fetched here, build time only).
// Writes epoch/web/static/app/city/world/data/w123_{south,north,street}.json + index.json (each face <= 40 KB).
//
// STREET FRAME (all descriptors): metres, x = along the street toward the EAST end (Lenox / Malcolm X Blvd), y = up, z = SOUTH-ish across the street
// (z < 0 the north side, z > 0 the south side). origin = the street's midpoint in the city frame (docs/MANHATTAN-DATA.md); rot = the three.js
// rotation.y that turns the street frame into the city frame:  city = origin + R_y(rot) * local.  Ground is flat (y = 0); `elev` is the real ground (m).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToXZ } from '../manhattan/geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'epoch/web/static/app/city/world/data');
const FT = 0.3048;
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const r2 = (v) => Math.round(v * 100) / 100, r1 = (v) => Math.round(v * 10) / 10;

/* ------------------------------------------------------------------ the street axis */
const cl = J('build/manhattan-raw/centerline.json').filter((s) => s.boroughcode === '1');
const xz = (c) => lonLatToXZ(c[0], c[1]);
const segs = (re) => cl.filter((s) => re.test(s.full_street_name)).map((s) => ({ ...s, pts: s.the_geom.coordinates[0].map(xz) }));
const w123 = segs(/^W\s+123 ST$/);
// the two short connector segments at the avenues (width 40 / 44) mark the intersections; the block segment between them is 30 ft wide
const near = (p, lon, lat) => { const q = lonLatToXZ(lon, lat); return Math.hypot(p[0] - q[0], p[1] - q[1]) < 3; };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const segLenox = w123.find((s) => near(s.pts[0], -73.946357, 40.806442)), segAcp = w123.find((s) => near(s.pts[0], -73.949191, 40.807639));
const E = mid(segLenox.pts[0], segLenox.pts.at(-1)), W = mid(segAcp.pts[0], segAcp.pts.at(-1));        // avenue centres on the street axis
const len = Math.hypot(E[0] - W[0], E[1] - W[1]), d = [(E[0] - W[0]) / len, (E[1] - W[1]) / len];
const O = mid(E, W), rot = Math.atan2(-d[1], d[0]);
const toLocal = (p) => { const dx = p[0] - O[0], dz = p[1] - O[1]; return [dx * d[0] + dz * d[1], -dx * d[1] + dz * d[0]]; };
const toCity = (x, z) => [O[0] + x * d[0] - z * d[1], O[1] + x * d[1] + z * d[0]];
const roadbed = +(w123.find((s) => s !== segLenox && s !== segAcp && s.pts.length === 2 && Math.hypot(s.pts[0][0] - O[0], s.pts[0][1] - O[1]) < len).streetwidth) * FT;      // curb to curb
const ROW = 60 * FT;                                          // right-of-way of a Manhattan side street: building line to building line
const AVE_HALF = 22.8;                                        // ACP / Lenox half right-of-way, MEASURED (slice 3 step 3): the building lines either side are ~45.5 m apart (the old 100 ft guess, 15.24, put the centre 7.7 m off)
let xE = len / 2, xW = -len / 2;   // reset below to the avenue centres once the corner buildings are known
console.log(`[blocks] street ${len.toFixed(1)} m, rot ${(rot * 180 / Math.PI).toFixed(2)} deg, roadbed ${roadbed.toFixed(2)} m, sidewalk ${((ROW - roadbed) / 2).toFixed(2)} m`);

/* ------------------------------------------------------------------ footprints */
const pluto = J('build/world-raw/pluto_mn.json'), lpc = J('build/world-raw/lpc_2571.json');
const fps = J('build/manhattan-raw/footprints.json');
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const cands = [];
for (const f of fps) {
  const blk = String(f.base_bbl || '').slice(1, 6);
  if (blk !== '01907' && blk !== '01908') continue;
  let best = null;
  for (const poly of f.the_geom.coordinates) { const ring = poly[0].map(xz).map(toLocal); ring.pop(); const a = Math.abs(ringArea(ring)); if (!best || a > best.a) best = { ring, a }; }
  if (!best) continue;
  let ring = best.ring; if (ringArea(ring) < 0) ring.reverse();         // counter-clockwise in (x, z)
  cands.push({ f, ring, side: blk === '01907' ? 1 : -1 });
}
const dpSimplify = (ring, tol) => {                                        // keep the vertices of corners, drop collinear points (closed ring)
  const out = []; const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n];
    const cr = Math.abs((c[0] - p[0]) * (q[1] - p[1]) - (c[1] - p[1]) * (q[0] - p[0])) / (Math.hypot(q[0] - p[0], q[1] - p[1]) || 1);
    if (cr > tol) out.push(c);
  }
  return out.length >= 3 ? out : ring;
};
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
const nearOther = (p, self) => cands.some((o) => o !== self && o.ring.some((q, i) => segDist(p, q, o.ring[(i + 1) % o.ring.length]) < 0.6));

const lineE = Math.max(...cands.flatMap((c) => c.ring.map((p) => p[0]))), lineW = Math.min(...cands.flatMap((c) => c.ring.map((p) => p[0])));
xE = lineE + AVE_HALF; xW = lineW - AVE_HALF;  // avenue centres: the corner buildings sit on the avenue's building line, half the measured right-of-way away (fitted centrelines: ACP -137.7, Lenox 137.4)
const AVE_SW = 6.0;                            // avenue sidewalk width
/* ------------------------------------------------------------------ style + facts */
const hash = (s) => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
// condo buildings carry a 75xx billing BBL in PLUTO but the lot BBL in the footprints; matched by position between numbered neighbours
const BILLING = { '1019080018': '1019087505' };         // 129 W 123rd (2008, 8 floors)
const EAST_STOOP = new Set(['124', '126', '128']);          // the LPC photo (fig. 2): the three twins have their stoops on the east side
function classify(pl, lp, year, floors) {
  const cls = (pl && pl.bldgclass) || '';
  if (lp) {
    const t = (lp.type || '').toLowerCase(), st = (lp.style || '').toLowerCase();
    if (/church|religious/.test(t)) return 'church';
    if (st === 'second empire') return 'second_empire';
    if (t === 'row house' && /(neo-grec|italianate|queen anne|romanesque|renaissance|anglo)/.test(st)) return lp.flags.mansard && lp.materials.includes('brick') ? 'second_empire' : 'brownstone';
    if (/apartment|flats|tenement/.test(t)) return 'prewar';
    if (t === 'row house' && (year >= 1990 || st === 'none')) return 'condo';
    if (t === 'row house') return lp.flags.mansard ? 'second_empire' : 'brownstone';
  }
  if (/^M/.test(cls)) return 'church';
  if (year >= 1990) return 'condo';
  if (floors >= 5 || /^D/.test(cls)) return 'prewar';
  if (year && year < 1910 && floors <= 5) return 'brownstone';
  return floors >= 4 ? 'prewar' : 'brownstone';
}
function baysFor(style, front) {
  if (style === 'brownstone' || style === 'second_empire') return front >= 4.2 && front <= 6.4 ? 3 : Math.max(2, Math.round(front / 1.85));
  if (style === 'prewar') return Math.max(2, Math.round(front / 2.35));
  if (style === 'condo') return Math.max(2, Math.round(front / 2.7));
  return Math.max(3, Math.round(front / 3.2));
}

const buildings = [];
for (const c of cands) {
  const { f, ring, side } = c;
  const bin = +f.bin, bbl = String(f.base_bbl).padStart(10, '0'), pbbl = BILLING[bbl] || bbl, pl = pluto[pbbl] || null, lp = lpc[bbl] || lpc[pbbl] || null;
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  // the street-facing wall plane: the length-weighted mode of the axis-aligned street-facing edges (angled bays, stoops and light wells do not move it)
  const fe0 = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l > 1 && Math.abs(dz / l) < 0.12 && (-dx / l) * side < 0) fe0.push({ z: (a[1] + b[1]) / 2, l });      // outward normal (dz, -dx)/l faces the street
  }
  const zbin = new Map(); for (const e of fe0) { const k = Math.round(e.z * 5) / 5; zbin.set(k, (zbin.get(k) || 0) + e.l); }
  let frontZ = side > 0 ? Math.min(...zs) : Math.max(...zs), bw = 0; for (const [k, w] of zbin) if (w > bw) { bw = w; frontZ = k; }
  const isFront = Math.abs(Math.min(...zs.map(Math.abs))) < 14;
  const h = +f.height_roof * FT, year = +f.construction_year || (pl && pl.year) || 0;
  const rec = { bin, bbl, h: r2(h), year, elev: r1((+f.ground_elevation || 0) * FT) };
  rec.poly = dpSimplify(ring, isFront ? 0.02 : 0.25).map((p) => [r2(p[0]), r2(p[1])]);
  rec.side = side;
  if (!isFront) { rec.rear = 1; buildings.push({ rec, c }); continue; }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 3) continue;
    if (Math.abs(dz / l) > 0.9) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!nearOther(m, c)) (rec.sides ||= []).push([r2(a[0]), r2(a[1]), r2(b[0]), r2(b[1])]); }
  }
  const fx0 = x0, fx1 = x1;
  const front = fx1 - fx0;
  rec.front = { x0: r2(fx0), x1: r2(fx1), z: r2(frontZ), n: -side, len: r2(front) };
  // party walls: a neighbour touches the west / east end of the front
  rec.party = [nearOther([fx0 - 0.15, frontZ + side * 3], c) ? 1 : 0, nearOther([fx1 + 0.15, frontZ + side * 3], c) ? 1 : 0];
  const numStr = pl ? pl.address.split(' ')[0] : '';
  rec.num = numStr;
  const floors = (lp && lp.stories) || (pl && pl.floors) || Math.max(1, Math.round(h / 3.3));
  let style = classify(pl, lp, year, floors);
  rec.style = style; rec.floors = floors; rec.bays = baysFor(style, front);
  rec.lpc = lp ? 1 : 0;
  const flags = lp ? lp.flags : {};
  if (style === 'brownstone' || style === 'second_empire') {
    rec.basement = lp ? (lp.basement ? 1 : 0) : 1;
    const eastSide = EAST_STOOP.has(numStr) || (lp && /entrance on east/.test(lp.features || '')) ? 1 : (hash(bin) & 1);
    rec.stoop = (!lp || flags.stoop) ? { side: eastSide ? 'e' : 'w' } : null;
    rec.cornice = flags.denticulated && !flags.bracketed_cornice ? 'denticulated' : style === 'second_empire' || flags.bracketed_cornice || !lp ? 'bracketed' : 'plain';
    if (flags.denticulated && flags.bracketed_cornice) rec.cornice = 'bracketed';
    rec.angledBay = flags.angled_bay ? 1 : 0;
    rec.rusticated = flags.rusticated_base ? 1 : (style === 'brownstone' ? 1 : 0);
    if (style === 'second_empire') rec.roof = { type: 'mansard', dormers: rec.bays >= 3 ? 2 : 1 };
    else rec.roof = { type: 'flat' };
  } else if (style === 'prewar') {
    rec.cornice = 'cornice'; rec.roof = { type: 'flat' };
    rec.fireEscape = (pl && /^D1|^C[0-9]$/.test(pl.bldgclass) && year >= 1900 && year <= 1925 && !(lp && /apartment/i.test(lp.type))) ? 1 : 0;
    rec.cornice = flags.denticulated ? 'denticulated' : 'bracketed';
  } else if (style === 'condo') { rec.cornice = 'none'; rec.roof = { type: 'flat' }; }
  else if (style === 'church') { rec.cornice = 'none'; rec.roof = { type: 'gable' }; }
  const mats = lp ? lp.materials : [];
  rec.mat = {
    body: mats.some((m) => /white/.test(m)) ? 'whitebrick' : style === 'condo' ? 'panel' : style === 'church' ? 'stone' : style === 'second_empire' ? 'brick' : (mats[0] === 'brick' || (!lp && style === 'prewar')) ? 'brick' : mats.includes('brownstone') || style === 'brownstone' ? 'brownstone' : 'brick',
    base: style === 'second_empire' || (mats.includes('brick') && mats.includes('brownstone')) ? 'brownstone' : style === 'prewar' ? (mats.some((m) => /white/.test(m)) ? 'limestone' : 'limestone') : 'same',
    tint: hash(bin) % 7, door: (hash(bin) >>> 5) % 8,
  };
  rec.seed = hash(bin) & 0xffffff;
  if (lp) rec.lpcText = { style: lp.style, date: lp.date, arch: lp.architect };
  buildings.push({ rec, c });
}

/* ------------------------------------------------------------------ street, props */
const curbN = -roadbed / 2, curbS = roadbed / 2, lotN = -ROW / 2, lotS = ROW / 2;
const street = {
  half: ROW / 2, roadbed: r2(roadbed), sidewalk: r2((ROW - roadbed) / 2), xW: r2(xW), xE: r2(xE), aveHalf: AVE_HALF,
  // ground plates the runtime lays out: sidewalks run between the avenue building lines; the asphalt continues through the intersections
  sidewalk0: { x0: r2(lineW), x1: r2(lineE), aveSidewalk: AVE_SW, lineW: r2(lineW), lineE: r2(lineE), zN: [r2(lotN), r2(curbN)], zS: [r2(curbS), r2(lotS)] },
  crosswalks: [lineW - AVE_SW - 1.9, lineE + AVE_SW + 1.9].map((x) => ({ x: r2(x), w: r2(roadbed), depth: 3.0 })),
};
// street trees (trees.bin kind 1) inside the block's rectangle
const tb = fs.readFileSync(path.join(ROOT, 'epoch/web/static/app/city/manhattan/trees.bin')); const tdv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
const nTrees = tdv.getUint32(8, true), trees = [];
for (let i = 0; i < nTrees; i++) {
  const o = 16 + 8 * i, kind = tb[o + 7]; if (kind !== 1) continue;
  const p = toLocal([tdv.getInt16(o, true) * 0.5, tdv.getInt16(o + 2, true) * 0.5]);
  if (p[0] > lineW - 8 && p[0] < lineE + 8 && Math.abs(p[1]) < ROW / 2 + 1) trees.push([r2(p[0]), r2(p[1]), r1(tb[o + 6] * 0.1)]);
}
// lamps: ~30 m apart, staggered between the two kerbs; signs at the four corners
// offset so no lamp stands in front of the three LPC photographer spots (x 14, 31 on the north kerb; x 55 on the south)
const lamps = []; for (let x = lineW + 15, k = 0; x < lineE - 5; x += 30, k++) lamps.push([r2(x), r2(k % 2 ? curbS + 0.45 : curbN - 0.45), k % 2 ? 1 : -1]);
const signs = [[lineW - 0.6, curbN - 0.4], [lineW - 0.6, curbS + 0.4], [lineE + 0.6, curbN - 0.4], [lineE + 0.6, curbS + 0.4]].map((p) => [r2(p[0]), r2(p[1])]);
// hydrants: NYC Open Data (DEP) if reachable, else the rule: one per ~75 m per side, away from corners
let hydrants = [], hydSrc = 'rule';
try {
  const [lonW, latW] = [-73.9495, 40.8060], [lonE, latE] = [-73.9460, 40.8080];
  for (const url of ['https://data.cityofnewyork.us/resource/5bgh-vtsn.json?$limit=500&$where=' + encodeURIComponent(`within_box(the_geom, ${latW}, ${lonW}, ${latE}, ${lonE})`),
    'https://data.cityofnewyork.us/resource/5bgh-vtsn.json?$limit=500&$where=' + encodeURIComponent(`latitude > ${latW} and latitude < ${latE} and longitude > ${lonW} and longitude < ${lonE}`)]) {
    const res = await fetch(url); if (!res.ok) continue;
    const rows = await res.json();
    const pts = rows.map((r) => (r.the_geom ? r.the_geom.coordinates : [+r.longitude, +r.latitude])).filter((c) => c && isFinite(c[0])).map((c) => toLocal(xz(c))).filter((p) => p[0] > lineW && p[0] < lineE && Math.abs(p[1]) < ROW / 2 + 0.5);
    if (rows.length) { hydrants = pts.map((p) => [r2(p[0]), r2(p[1] < 0 ? curbN - 0.35 : curbS + 0.35)]); hydSrc = 'nyc-open-data'; break; }
  }
} catch (e) { console.log('[blocks] hydrant fetch failed:', e.message); }
if (!hydrants.length) { hydSrc = 'rule'; for (const sd of [-1, 1]) for (let x = lineW + 22 + (sd > 0 ? 18 : 0); x < lineE - 15; x += 75) hydrants.push([r2(x), r2(sd < 0 ? curbN - 0.35 : curbS + 0.35)]); }
console.log(`[blocks] ${trees.length} trees, ${lamps.length} lamps, ${hydrants.length} hydrants (${hydSrc})`);

/* ------------------------------------------------------------------ write */
fs.mkdirSync(OUT, { recursive: true });
const sorted = (s) => buildings.filter((b) => b.c.side === s).map((b) => b.rec).sort((a, b) => (a.front ? a.front.x0 : a.poly[0][0]) - (b.front ? b.front.x0 : b.poly[0][0]));
const frame = { origin: [r2(O[0]), r2(O[1])], rot: +rot.toFixed(5), elev: r1(buildings.reduce((s, b) => s + b.rec.elev, 0) / buildings.length) };
const faceName = { 1: 'w123_south', '-1': 'w123_north' };
const sizes = {};
for (const s of [1, -1]) {
  const doc = { version: 1, id: faceName[s], street: 'W 123 St', side: s > 0 ? 'south' : 'north', facing: s > 0 ? 'north' : 'south', frame, buildings: sorted(s) };
  const txt = JSON.stringify(doc); fs.writeFileSync(path.join(OUT, faceName[s] + '.json'), txt); sizes[faceName[s]] = txt.length;
}
const sdoc = { version: 1, id: 'w123_street', frame, street, trees, lamps, signs, hydrants, hydrantSource: hydSrc, credits: 'NYC Open Data (Building Footprints, PLUTO, Centerline, Street Tree Census); NYC LPC designation report LP-2571' };
fs.writeFileSync(path.join(OUT, 'w123_street.json'), JSON.stringify(sdoc)); sizes.w123_street = JSON.stringify(sdoc).length;
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ version: 1, files: Object.keys(sizes).map((k) => k + '.json'), frame, xW: street.xW, xE: street.xE }));
for (const [k, v] of Object.entries(sizes)) console.log(`[blocks] ${k}.json ${(v / 1024).toFixed(1)} KB${v > 40960 ? '  OVER 40 KB' : ''}`);
const named = buildings.filter((b) => b.rec.num).map((b) => `${b.rec.num}:${b.rec.style}/${b.rec.bays}b/${b.rec.floors}f`).join(' ');
console.log('[blocks] ' + buildings.filter((b) => !b.rec.rear).length + ' facade buildings, ' + buildings.filter((b) => b.rec.rear).length + ' rear\n' + named);
