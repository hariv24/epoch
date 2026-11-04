// scripts/world/district.mjs · slice 3 (docs/WORLD.md 14.1, 14.2): block-face descriptors for the whole Harlem area (W 120th-W 126th, Frederick Douglass Blvd to
// Fifth Ave / Marcus Garvey Park), one file per UNIT (a block face, or an intersection). Build time only.
//
//   python3 scripts/world/pluto.py && python3 scripts/world/lpc_parse.py && python3 scripts/world/lpc_parse.py --district && node scripts/world/district.mjs
//
// Reads  build/manhattan-raw/{footprints,centerline}.json, build/world-raw/{pluto_mn,lpc_2571,lpc_district}.json, city/manhattan/trees.bin, world/data/{w123_*.json}
// Writes epoch/web/static/app/city/world/data/h/<unit>.json + h/index.json (the unit list, grid, coverage). The W 123rd St files of slice 1-2 are NOT touched.
//
// FRAME: the same street frame as W 123rd (index.json): x east along the streets, z south across them, y up; origin + rot from the city frame. Every street is a
// line z = const and every avenue a line x = const (Manhattan's grid is rectilinear), so one frame holds the whole district.
// FACE FRAME (buildings): a street face (block side N / S) uses (u, v) = (x, z); an avenue face (E / W) uses (u, v) = (-z, x) (a +90 degree turn about y), so the kit
// always draws a facade along u with its outward normal n = +-1 along v. `T.th` is the three.js rotation.y that turns the face frame into the street frame.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lonLatToXZ } from '../manhattan/geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WD = path.join(ROOT, 'epoch/web/static/app/city/world/data'), OUT = path.join(WD, 'h');
const FT = 0.3048, J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const r2 = (v) => Math.round(v * 100) / 100, r1 = (v) => Math.round(v * 10) / 10;
const hash = (s) => { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

/* ------------------------------------------------------------------ the frame (identical to blocks.mjs) */
const cl = J('build/manhattan-raw/centerline.json').filter((s) => s.boroughcode === '1');
const nm = (s) => s.full_street_name.replace(/\s+/g, ' ');
const xz = (c) => lonLatToXZ(c[0], c[1]);
const near = (p, lon, lat) => { const q = lonLatToXZ(lon, lat); return Math.hypot(p[0] - q[0], p[1] - q[1]) < 3; };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const w123 = cl.filter((s) => nm(s) === 'W 123 ST').map((s) => ({ ...s, pts: s.the_geom.coordinates[0].map(xz) }));
const segLenox = w123.find((s) => near(s.pts[0], -73.946357, 40.806442)), segAcp = w123.find((s) => near(s.pts[0], -73.949191, 40.807639));
const E = mid(segLenox.pts[0], segLenox.pts.at(-1)), W = mid(segAcp.pts[0], segAcp.pts.at(-1));
const len = Math.hypot(E[0] - W[0], E[1] - W[1]), d = [(E[0] - W[0]) / len, (E[1] - W[1]) / len], O = mid(E, W), rot = Math.atan2(-d[1], d[0]);
const toLocal = (p) => { const dx = p[0] - O[0], dz = p[1] - O[1]; return [dx * d[0] + dz * d[1], -dx * d[1] + dz * d[0]]; };
const idx0 = J('epoch/web/static/app/city/world/data/index.json');
const frame = idx0.frame;

/* ------------------------------------------------------------------ the grid: street z-lines, avenue x-lines */
const lines = (re) => cl.filter((s) => re.test(nm(s))).map((s) => ({ w: +s.streetwidth, pts: s.the_geom.coordinates[0].map(xz).map(toLocal) }));
const fit = (segs, axis) => {                        // axis 'z': z at x = 0 by a line fit;  axis 'x': x at z = 0
  const P = segs.flatMap((s) => s.pts).filter((p) => Math.abs(axis === 'z' ? p[0] : p[1]) < 500), n = P.length;
  if (n < 2) return null;
  const a = P.map((p) => (axis === 'z' ? p[0] : p[1])), b = P.map((p) => (axis === 'z' ? p[1] : p[0])), ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (a[i] - ma) * (b[i] - mb); sxx += (a[i] - ma) ** 2; }
  const k = sxx > 1e-6 ? sxy / sxx : 0; return { c: mb - k * ma, k };
};
const streets = [];
for (let n = 118; n <= 128; n++) {
  const segs = lines(new RegExp(`^W ${n} ST$`)), f = fit(segs, 'z'); if (!f) continue;
  const w = segs.length ? Math.max(...segs.map((s) => s.w)) : 30;      // the block segment: the widest (the avenue connectors are 40-44 and are not it, so take the mode below)
  const ws = segs.map((s) => s.w).sort((a, b) => a - b), mode = ws.sort((a, b) => ws.filter((v) => v === b).length - ws.filter((v) => v === a).length)[0];
  const roadbed = (n === 125 ? Math.max(mode, 70) : mode || 30) * FT;
  streets.push({ n, name: `W ${n} St`, z: r2(f.c), k: +f.k.toFixed(5), roadbed: r2(roadbed), hw: r2(roadbed / 2 + 15 * FT), wFt: mode, w });
}
streets.sort((a, b) => a.z - b.z);                    // north (low z) -> south
const AVE = [['FREDERICK DOUGLASS BLVD', 'Frederick Douglass Blvd'], ['ADAM CLAYTON POWELL JR BLVD', 'Adam Clayton Powell Jr Blvd'], ['LENOX AVE', 'Malcolm X Blvd'], ['5 AVE', 'Fifth Ave'], ['MOUNT MORRIS PARK W', 'Mount Morris Park West']];
const aves = [];
for (const [key, name] of AVE) {
  const segs = lines(new RegExp(`^${key}$`)).filter((s) => s.pts.some((p) => Math.abs(p[1]) < 480)), f = fit(segs.map((s) => ({ ...s, pts: s.pts.filter((p) => Math.abs(p[1]) < 480) })), 'x');
  if (f) aves.push({ key, name, x: r2(f.c), k: +f.k.toFixed(5) });
}
// W 123rd's own avenues are authoritative (slice 1-2): ACP xW, Lenox xE from index.json
const setAve = (key, x) => { const a = aves.find((q) => q.key === key); if (a) a.x = x; };
setAve('ADAM CLAYTON POWELL JR BLVD', idx0.xW); setAve('LENOX AVE', idx0.xE);
aves.sort((a, b) => a.x - b.x);
// slice 3 step 3: half rights-of-way are MEASURED (centreline fit vs the footprints' building lines on both sides): FDB 15.0 and Fifth 15.0 (100 ft), but ACP and Lenox 22.8 (the
// building lines are ~45.5 m apart, not 30.5 m; the old 15.24 m guess put the centre 7.7 m off and gave the Theresa a 21 m sidewalk), Mount Morris Park West 11.6.
// Sidewalks 6.0 m (MMPW 5.0 m); the roadway is the rest. ACP / Lenox centres come from the same measurement (data/index.json, blocks.mjs).
const AVE_HALF = J('epoch/web/static/app/city/world/data/w123_street.json').street.aveHalf;      // measured by blocks.mjs
const AH_OF = { 'ADAM CLAYTON POWELL JR BLVD': AVE_HALF, 'LENOX AVE': AVE_HALF, 'MOUNT MORRIS PARK W': 11.6 };
for (const a of aves) { a.AH = AH_OF[a.key] || 15.24; a.asw = a.key === 'MOUNT MORRIS PARK W' ? 5.0 : 6.0; a.rd = r2(a.AH - a.asw); }
console.log('[district] streets', streets.map((s) => `${s.n}:z${s.z}/rd${s.roadbed}`).join(' '));
console.log('[district] avenues', aves.map((a) => `${a.name}:x${a.x}`).join(' '));
const stN = (n) => streets.find((s) => s.n === n), aveOf = (key) => aves.find((a) => a.key === key);
const zAt = (s, x) => s.z + s.k * x;

/* ------------------------------------------------------------------ the area + footprints + lots */
const pluto = J('build/world-raw/pluto_mn.json'), lpc = J('build/world-raw/lpc_2571.json');
const lpcD = fs.existsSync(path.join(ROOT, 'build/world-raw/lpc_district.json')) ? J('build/world-raw/lpc_district.json') : { records: [], coverage: {} };
const fps = J('build/manhattan-raw/footprints.json');
const zIn = [stN(126).z, stN(120).z], zOut = [stN(127).z - 12, stN(119).z + 12];
const xFDB = aveOf('FREDERICK DOUGLASS BLVD').x, xMMP = aveOf('MOUNT MORRIS PARK W').x, x5 = aveOf('5 AVE').x;
const xIn = [xFDB - 25, Math.max(x5, xMMP) + 10], xOut = [xFDB - 90, Math.max(x5, xMMP) + 90];
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const dpSimplify = (ring, tol) => { const out = [], n = ring.length; for (let i = 0; i < n; i++) { const p = ring[(i + n - 1) % n], c = ring[i], q = ring[(i + 1) % n]; const cr = Math.abs((c[0] - p[0]) * (q[1] - p[1]) - (c[1] - p[1]) * (q[0] - p[0])) / (Math.hypot(q[0] - p[0], q[1] - p[1]) || 1); if (cr > tol) out.push(c); } return out.length >= 3 ? out : ring; };
const blocks = new Map();                             // tax block -> { bs: [building], bbox }
let nFp = 0;
for (const f of fps) {
  const bbl = String(f.base_bbl || '').padStart(10, '0'); if (!bbl.startsWith('1')) continue;
  let best = null;
  for (const poly of f.the_geom.coordinates) { const ring = poly[0].map(xz).map(toLocal); ring.pop(); const a = Math.abs(ringArea(ring)); if (!best || a > best.a) best = { ring, a }; }
  if (!best) continue;
  let ring = best.ring; if (ringArea(ring) < 0) ring.reverse();
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  if (cx < xOut[0] || cx > xOut[1] || cz < zOut[0] || cz > zOut[1]) continue;
  const blk = +bbl.slice(1, 6);
  if (!blocks.has(blk)) blocks.set(blk, { blk, bs: [] });
  blocks.get(blk).bs.push({ f, ring, bbl, cx, cz, blk }); nFp++;
}
console.log(`[district] ${nFp} footprints in ${blocks.size} tax blocks`);

/* ------------------------------------------------------------------ each block's four sides on the grid */
const hwOf = (s) => s.hw;
for (const B of blocks.values()) {
  const xs = B.bs.flatMap((b) => b.ring.map((p) => p[0])), zs = B.bs.flatMap((b) => b.ring.map((p) => p[1]));
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs), cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
  const sN = [...streets].reverse().find((s) => zAt(s, cx) < cz - 4), sS = streets.find((s) => zAt(s, cx) > cz + 4);
  const aW = [...aves].reverse().find((a) => a.x < cx - 4), aE = aves.find((a) => a.x > cx + 4);
  const snap = (v, line, tol = 7) => (line != null && Math.abs(v - line) < tol ? line : v);
  B.sN = sN; B.sS = sS; B.aW = aW; B.aE = aE;
  B.zt = snap(bz0, sN ? zAt(sN, cx) + hwOf(sN) : null); B.zb = snap(bz1, sS ? zAt(sS, cx) - hwOf(sS) : null);
  B.xl = snap(bx0, aW ? aW.x + aW.AH : null); B.xr = snap(bx1, aE ? aE.x - aE.AH : null);
  B.cx = cx; B.cz = cz;
  B.inner = cx > xIn[0] && cx < xIn[1] && cz > zIn[0] && cz < zIn[1];
}

/* ------------------------------------------------------------------ style grammar (slice 1 + the slice 3 styles) */
const BILLING = { '1019080018': '1019087505' };
const classify = (pl, lp, year, floors, face, o) => {
  const cls = (pl && pl.bldgclass) || '', land = (pl && pl.landuse) || '';
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
  if (o.commercial125 && floors <= 8 && !/^(D|C[0-9]|R)/.test(cls) || (o.commercial125 && /^(K|O|S|H|J)/.test(cls) && floors <= 10)) return 'commercial';
  if (year >= 1945 && floors >= 8 && /^(D|R|C7|H|I|O|W)/.test(cls)) return 'tower';
  if (year >= 1945 && floors >= 7) return 'tower';
  if (year >= 1990) return 'condo';
  if (/^(K|O|S|J|L)/.test(cls) && floors <= 6 && face.avenue) return 'commercial';
  if (/^(C|S)/.test(cls) && year < 1940 && floors >= 3 && floors <= 6 && (face.avenue || /^C/.test(cls))) return 'tenement';
  if (floors >= 5 || /^D/.test(cls)) return face.avenue && floors <= 6 ? 'tenement' : 'prewar';
  if (year && year < 1910 && floors <= 5) return 'brownstone';
  return floors >= 4 ? (face.avenue ? 'tenement' : 'prewar') : 'brownstone';
};
const baysFor = (style, front) => {
  if (style === 'brownstone' || style === 'second_empire') return front >= 4.2 && front <= 6.4 ? 3 : Math.max(2, Math.round(front / 1.85));
  if (style === 'prewar') return Math.max(2, Math.round(front / 2.35));
  if (style === 'condo' || style === 'tower') return Math.max(2, Math.round(front / 2.9));
  if (style === 'tenement' || style === 'commercial') return Math.max(2, Math.round(front / 2.3));
  return Math.max(3, Math.round(front / 3.2));
};
// narrative hints (LP-0452): a style for a named kind of building on a street. Applied only to churches on that street (the report names churches)
const hintRec = (lpcD.records || []).filter((r) => r.hint && r.style);
// the landmarks (LP-1299 Apollo, Hotel Theresa): matched by BBL, else by house number + street keyword
const landmarks = (lpcD.records || []).filter((r) => !r.hint || r.number);
const stripAddr = (a) => String(a || '').toUpperCase().replace(/\s+/g, ' ');
const lmFor = (bbl, pl) => landmarks.find((r) => r.bbl === bbl) || (pl && landmarks.find((r) => r.number && stripAddr(pl.address).startsWith(r.number + ' ') && stripAddr(pl.address).includes((r.street || '').split(' ')[0] === 'W' ? (r.street.split(' ')[1] || 'ZZ') : (r.street || 'ZZ').split(' ')[0])));

/* ------------------------------------------------------------------ the base street's buildings (W 123rd, slice 2): near-geometry comes from the base path */
const baseBins = new Set();
for (const f of ['w123_south.json', 'w123_north.json']) for (const r of J('epoch/web/static/app/city/world/data/' + f).buildings) if (r.front) baseBins.add(r.bin);

/* ------------------------------------------------------------------ assign buildings to faces, build records */
// slice 3 step 2: hand overrides for the landmarks the footprint geometry misreads. The State Office Building (BIN 1081602) is a tower set back behind its plaza on
// 125th St: its nearest lot line is 126th St, but its address and plaza face 125th.
const FACE_OVERRIDE = { 1081602: 'S' };
const LM_BIN = { 1081602: 'sob' };
const faceOfBuilding = (B, b) => {
  if (FACE_OVERRIDE[+b.f.bin]) return { side: FACE_OVERRIDE[+b.f.bin], gap: {} };
  const xs = b.ring.map((p) => p[0]), zs = b.ring.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const gap = { W: x0 - B.xl, E: B.xr - x1, N: z0 - B.zt, S: B.zb - z1 };
  // a front within 3.2 m of its lot line; on 125th St (slice 3 step 2) also a set-back front up to 6 m (1971's 215 W 125th stood as a bare "rear" wall)
  const on125 = (k) => (k === 'S' && B.sS && B.sS.n === 125) || (k === 'N' && B.sN && B.sN.n === 125);
  const cand = Object.keys(gap).filter((k) => gap[k] < 3.2 || (gap[k] < 6 && on125(k)));
  const pl = pluto[BILLING[b.bbl] || b.bbl], addr = pl ? stripAddr(pl.address) : '';
  const avenueAddr = /(AVENUE|BOULEVARD| BLVD|MORRIS PARK|PLACE)/.test(addr) && !/ STREET$/.test(addr);
  if (cand.length === 0) return { side: gap.N + 1 < gap.S ? (Math.min(...Object.values(gap)) === gap.N ? 'N' : 'S') : 'S', rear: true, gap };
  if (cand.length === 1) return { side: cand[0], gap };
  const av = cand.filter((k) => k === 'E' || k === 'W'), st = cand.filter((k) => k === 'N' || k === 'S');
  const pick = (avenueAddr ? av : st); const list = pick.length ? pick : cand;
  return { side: list.sort((a, c) => gap[a] - gap[c])[0], gap };
};
const units = new Map();                              // id -> unit
const cov = { lots: 0, histdist: 0, lpcMatched: 0, lpcByHist: 0, landmark: 0, hint: 0, grammar: 0, fronts: 0, rear: 0, styles: {} };
const mkUnit = (B, side) => {
  const id = `f${B.blk}${side}`; if (units.has(id)) return units.get(id);
  const av = side === 'E' || side === 'W';
  const sNm = side === 'N' ? B.sN : side === 'S' ? B.sS : null, aNm = side === 'W' ? B.aW : side === 'E' ? B.aE : null;
  const u = { id, kind: 'F', block: B.blk, side, avenue: av, inner: B.inner, T: { th: av ? Math.PI / 2 : 0 }, buildings: [] };
  u.street = av ? (aNm ? aNm.name : '') : (sNm ? sNm.name : '');
  u.c125 = !av && sNm && sNm.n === 125;
  units.set(id, u); return u;
};
for (const B of blocks.values()) {
  for (const b of B.bs) {
    const { f, ring } = b, bbl = b.bbl, pbbl = BILLING[bbl] || bbl, pl = pluto[pbbl] || null;
    const lp = lpc[bbl] || lpc[pbbl] || null, lm = lmFor(pbbl, pl) || lmFor(bbl, pl);
    const fc = faceOfBuilding(B, b), side = fc.side, av = side === 'E' || side === 'W', u = mkUnit(B, side);
    cov.lots++;
    if (pl && /MOUNT MORRIS|MT MORRIS/i.test(pl.histdist || '')) { cov.histdist++; if (lp) cov.lpcByHist++; }
    const toF = av ? (p) => [-p[1], p[0]] : (p) => [p[0], p[1]];
    const fring = ring.map(toF); // counter-clockwise preserved (a rotation)
    const nOut = side === 'N' ? -1 : side === 'W' ? -1 : 1;            // outward normal along v: N faces -z; S faces +z; the avenue faces: W looks to -x (v = x), E looks to +x
    const us = fring.map((p) => p[0]), vs = fring.map((p) => p[1]);
    const h = +f.height_roof * FT, year = +f.construction_year || (pl && pl.year) || 0, bin = +f.bin;
    const rec = { bin, bbl, h: r2(h), year, elev: r1((+f.ground_elevation || 0) * FT), side: nOut === 1 ? 1 : -1 };
    rec.poly = dpSimplify(fring, fc.rear ? 0.3 : 0.05).map((p) => [r2(p[0]), r2(p[1])]);
    const base = baseBins.has(bin);
    if (base) rec.nb = 1;
    if (fc.rear) { rec.rear = 1; u.buildings.push(rec); cov.rear++; continue; }
    // the street-facing wall plane: the length-weighted mode of edges parallel to u whose outward normal faces the street
    const fe = [];
    for (let i = 0; i < fring.length; i++) {
      const a = fring[i], c = fring[(i + 1) % fring.length], du = c[0] - a[0], dv = c[1] - a[1], l = Math.hypot(du, dv);
      if (l > 1 && Math.abs(dv / l) < 0.12 && (-du / l) * nOut > 0) fe.push({ v: (a[1] + c[1]) / 2, l }); // outward normal (dv, -du)/l has sign -du/l along v... (ccw)
    }
    const zbin = new Map(); for (const e of fe) { const k = Math.round(e.v * 5) / 5; zbin.set(k, (zbin.get(k) || 0) + e.l); }
    let frontV = nOut > 0 ? Math.min(...vs) : Math.max(...vs), bw = 0; for (const [k, w] of zbin) if (w > bw) { bw = w; frontV = k; }
    const u0 = Math.min(...us), u1 = Math.max(...us), front = u1 - u0;
    rec.front = { x0: r2(u0), x1: r2(u1), z: r2(frontV), n: nOut, len: r2(front) };
    const o = { commercial125: u.c125 };
    const numStr = pl ? pl.address.split(' ')[0] : '';
    rec.num = numStr;
    const floors = (lp && lp.stories) || (pl && pl.floors) || Math.max(1, Math.round(h / 3.3));
    let style = classify(pl, lp, year, floors, { avenue: av }, o);
    let src = lp ? 'lpc2571' : 'grammar';
    if (lm) { src = 'landmark'; cov.landmark++; if (/beaux|renaissance|classic/i.test(lm.style || '') && floors >= 8) style = 'prewar'; else if (/classic/i.test(lm.style || '')) style = 'commercial'; rec.landmark = lm.name || lm.source; }
    if (style === 'church' && !lp) { const hr = hintRec.find((r) => /romanesque|gothic/i.test(r.style)); if (hr && pl && /MOUNT MORRIS/i.test(pl.histdist || '')) { rec.lpcText = { style: hr.style, src: hr.source }; src = 'lpc0452-hint'; cov.hint++; } }
    if (lp) cov.lpcMatched++; else if (src === 'grammar') cov.grammar++;
    cov.styles[style] = (cov.styles[style] || 0) + 1; cov.fronts++;
    rec.style = style; rec.floors = floors; rec.bays = baysFor(style, front); rec.lpc = lp ? 1 : 0; rec.src = src;
    const flags = lp ? lp.flags : {}, mats = lp ? lp.materials : (lm && lm.materials) || [];
    const hs = hash(bin);
    if (style === 'brownstone' || style === 'second_empire') {
      rec.basement = lp ? (lp.basement ? 1 : 0) : 1;
      rec.stoop = (!lp || flags.stoop) ? { side: (hs & 1) ? 'e' : 'w' } : null;
      rec.cornice = flags.denticulated && !flags.bracketed_cornice ? 'denticulated' : style === 'second_empire' || flags.bracketed_cornice || !lp ? 'bracketed' : 'plain';
      rec.angledBay = flags.angled_bay ? 1 : 0; rec.rusticated = flags.rusticated_base ? 1 : (style === 'brownstone' ? 1 : 0);
      rec.roof = style === 'second_empire' ? { type: 'mansard', dormers: rec.bays >= 3 ? 2 : 1 } : { type: 'flat' };
    } else if (style === 'prewar') {
      rec.cornice = flags.denticulated ? 'denticulated' : 'bracketed'; rec.roof = { type: 'flat' };
      rec.fireEscape = (pl && /^D1|^C[0-9]$/.test(pl.bldgclass) && year >= 1900 && year <= 1925) ? 1 : 0;
    } else if (style === 'tenement') { rec.cornice = 'bracketed'; rec.roof = { type: 'flat' }; rec.fireEscape = 1; rec.shop = av ? 1 : 0; }
    else if (style === 'commercial') { rec.cornice = 'bracketed'; rec.roof = { type: 'flat' }; rec.shop = 1; rec.fireEscape = year > 0 && year < 1935 && floors >= 3 ? 1 : 0; rec.theatre = lm && /apollo/i.test(lm.name || '') ? 1 : 0; }
    else if (style === 'tower') { rec.cornice = 'none'; rec.roof = { type: 'flat' }; }
    else if (style === 'condo') { rec.cornice = 'none'; rec.roof = { type: 'flat' }; }
    else if (style === 'church') { rec.cornice = 'none'; rec.roof = { type: 'gable' }; }
    const white = mats.some((m) => /white|terra|marble|limestone/.test(m)) && (style === 'prewar' || style === 'commercial');
    rec.mat = {
      body: white ? 'whitebrick' : style === 'condo' ? 'panel' : style === 'tower' ? (hs % 3 === 0 ? 'panel' : 'brick') : style === 'church' ? 'stone' : style === 'second_empire' ? 'brick' : (mats[0] === 'brick' || style === 'prewar' || style === 'tenement' || style === 'commercial') ? 'brick' : 'brownstone',
      base: style === 'second_empire' || (mats.includes('brick') && mats.includes('brownstone')) ? 'brownstone' : style === 'prewar' ? 'limestone' : 'same',
      tint: hs % 7, door: (hs >>> 5) % 8,
    };
    rec.seed = hs & 0xffffff;
    // party walls + side faces
    const partyAt = (uu) => B.bs.some((o2) => o2 !== b && o2.ring.some((q, i) => { const c2 = o2.ring[(i + 1) % o2.ring.length], p2 = toF(q), c3 = toF(c2); const t = Math.max(0, Math.min(1, ((uu - p2[0]) * (c3[0] - p2[0]) + (frontV + nOut * -3 - p2[1]) * (c3[1] - p2[1])) / (((c3[0] - p2[0]) ** 2 + (c3[1] - p2[1]) ** 2) || 1))); return Math.hypot(uu - (p2[0] + t * (c3[0] - p2[0])), frontV - nOut * 3 - (p2[1] + t * (c3[1] - p2[1]))) < 0.6; }));
    rec.party = [partyAt(u0 - 0.15) ? 1 : 0, partyAt(u1 + 0.15) ? 1 : 0];
    // slice 3 step 2: the hand-detailed landmarks (kit.js landmark builders). The Apollo's lobby front is narrower than its auditorium: its facade is the street-most edge.
    const lmName = (rec.landmark || '').toLowerCase();
    rec.lm = LM_BIN[bin] || (/apollo/.test(lmName) ? 'apollo' : /theresa/.test(lmName) ? 'theresa' : '') || undefined;
    if (rec.lm === 'apollo' && fe.length) {
      const best = fe.reduce((a, e) => ((nOut > 0 ? e.v > a.v : e.v < a.v) ? e : a));
      const ed = []; for (let i = 0; i < fring.length; i++) { const a = fring[i], c = fring[(i + 1) % fring.length]; if (Math.abs((a[1] + c[1]) / 2 - best.v) < 0.3 && Math.abs(c[1] - a[1]) < 0.5) ed.push(a[0], c[0]); }
      const fx0 = Math.min(...ed), fx1 = Math.max(...ed); rec.front = { x0: r2(fx0), x1: r2(fx1), z: r2(best.v), n: nOut, len: r2(fx1 - fx0) };
    }
    if (rec.lm === 'sob') { rec.front = { x0: r2(u0), x1: r2(u1), z: r2(nOut > 0 ? Math.max(...vs) : Math.min(...vs)), n: nOut, len: r2(front) }; rec.party = [0, 0]; }
    if (rec.lm) { rec.style = rec.lm; rec.src = 'landmark'; }
    // slice 3 step 2: a CORNER building's second street wall (the avenue side of a street-face lot, the street side of an avenue-face lot) gets a facade, not a bare wall.
    // Face frame: a street face's avenue lines are u = xl / xr; an avenue face's street lines are u = -zb (south) / -zt (north).
    rec.sides = [];
    // slice 3 step 2: a building's OTHER street walls get facades, not bare brick: the ends of a corner lot (on the avenue line of a street face, on a street line of an
    // avenue face: 'lo' / 'hi' along u) and the back of a through lot (on the block's opposite line: 'back'). Face frame: a street face's avenue lines are u = xl / xr and its
    // opposite street line v = zb / zt; an avenue face's street lines are u = -zb (south) / -zt (north) and its opposite avenue line v = xr / xl.
    if (rec.lm !== 'sob') {
      const lo = av ? { line: -B.zb, ok: !!B.sS } : { line: B.xl, ok: !!B.aW }, hi = av ? { line: -B.zt, ok: !!B.sN } : { line: B.xr, ok: !!B.aE };
      const back = av ? (side === 'W' ? { line: B.xr, ok: !!B.aE } : { line: B.xl, ok: !!B.aW }) : (side === 'N' ? { line: B.zb, ok: !!B.sS } : { line: B.zt, ok: !!B.sN });
      const runsOf = (list) => { list.sort((p, q) => p[0] - q[0]); const out = []; for (const [a, c, at, l] of list) { const r = out.at(-1); if (r && a <= r.b + 1.0) { r.b = Math.max(r.b, c); r.at += at * l; r.w += l; } else out.push({ a, b: c, at: at * l, w: l }); } return out.filter((r) => r.b - r.a >= 3); };
      for (const [end, L, sg] of [['lo', lo, -1], ['hi', hi, 1], ['back', back, -nOut]]) {
        if (!L.ok) continue;
        const list = [];
        for (let i = 0; i < fring.length; i++) {
          const a = fring[i], c = fring[(i + 1) % fring.length], du = c[0] - a[0], dv = c[1] - a[1], l = Math.hypot(du, dv);
          if (l < 1) continue;
          if (end !== 'back') { if (Math.abs(du / l) > 0.12 || Math.sign(dv) !== sg || Math.abs((a[0] + c[0]) / 2 - L.line) > 1.6) continue; list.push([Math.min(a[1], c[1]), Math.max(a[1], c[1]), (a[0] + c[0]) / 2, l]); }      // outward normal (dv, -du)/l along sg * u
          else { if (Math.abs(dv / l) > 0.12 || Math.sign(-du) !== sg || Math.abs((a[1] + c[1]) / 2 - L.line) > 1.6) continue; list.push([Math.min(a[0], c[0]), Math.max(a[0], c[0]), (a[1] + c[1]) / 2, l]); }
        }
        for (const r of runsOf(list)) rec.sides.push(end === 'back' ? { end, v: r2(r.at / r.w), u0: r2(r.a), u1: r2(r.b), len: r2(r.b - r.a) } : { end, u: r2(r.at / r.w), v0: r2(r.a), v1: r2(r.b), len: r2(r.b - r.a) });
      }
    }
    if (!rec.sides.length) delete rec.sides;
    u.buildings.push(rec);
  }
}

/* ------------------------------------------------------------------ props per unit: ground rectangles (street frame), trees, lamps, hydrants, bus shelters */
const tb = fs.readFileSync(path.join(ROOT, 'epoch/web/static/app/city/manhattan/trees.bin')); const tdv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
const nTrees = tdv.getUint32(8, true), allTrees = [];
for (let i = 0; i < nTrees; i++) { const o = 16 + 8 * i, kind = tb[o + 7]; if (kind !== 1) continue; const p = toLocal([tdv.getInt16(o, true) * 0.5, tdv.getInt16(o + 2, true) * 0.5]); if (p[0] > xOut[0] && p[0] < xOut[1] && p[1] > zOut[0] && p[1] < zOut[1]) allTrees.push([r2(p[0]), r2(p[1]), r1(tb[o + 6] * 0.1)]); }
const inRect = (p, r, pad = 0) => p[0] >= r[0] - pad && p[0] <= r[2] + pad && p[1] >= r[1] - pad && p[1] <= r[3] + pad;
const BUS = [];                                       // bus shelters: one per avenue face, ~38 % along, on the avenue sidewalk
for (const B of blocks.values()) {
  for (const side of ['N', 'S', 'E', 'W']) {
    const u = units.get(`f${B.blk}${side}`) || mkUnit(B, side), av = side === 'E' || side === 'W';
    const sN = B.sN, sS = B.sS;
    const zt = B.zt, zb = B.zb, xl = B.xl, xr = B.xr;
    const rdN = sN ? sN.roadbed / 2 : 4.6, rdS = sS ? sS.roadbed / 2 : 4.6;
    const kN = (sN ? zAt(sN, B.cx) + rdN : zt - 4.57), kS = (sS ? zAt(sS, B.cx) - rdS : zb + 4.57);   // kerb z of the north / south sides of this block
    const kW = B.aW ? B.aW.x + B.aW.rd : xl - 6.0, kE = B.aE ? B.aE.x - B.aE.rd : xr + 6.0;
    // the face extent along its street/avenue: corner to corner of the sidewalks (the intersection unit owns the corner squares)
    const asw = av ? 0 : 0;
    let walk, kerb, a, b, cz0, cx0;
    if (side === 'N') { walk = [kW + (B.aW ? B.aW.asw : 6) + 0.0, kN, kE - (B.aE ? B.aE.asw : 6) - 0.0, zt]; walk[0] = (B.aW ? B.aW.x + B.aW.AH : xl); walk[2] = (B.aE ? B.aE.x - B.aE.AH : xr); walk[1] = zt - (zt - kN); kerb = { axis: 'z', c: kN, a: walk[0], b: walk[2], inward: 1 }; }
    else if (side === 'S') { walk = [(B.aW ? B.aW.x + B.aW.AH : xl), zb, (B.aE ? B.aE.x - B.aE.AH : xr), kS]; kerb = { axis: 'z', c: kS, a: walk[0], b: walk[2], inward: -1 }; }
    else if (side === 'W') { walk = [(B.aW ? B.aW.x + B.aW.rd : xl - 6), kN, xl, kS]; kerb = { axis: 'x', c: kW, a: kN, b: kS, inward: 1 }; }
    else { walk = [xr, kN, (B.aE ? B.aE.x - B.aE.rd : xr + 6), kS]; kerb = { axis: 'x', c: kE, a: kN, b: kS, inward: -1 }; }
    // street faces run between the avenues' lot lines; their ground is the sidewalk + the corner overlap is trimmed by the intersection unit (it owns the corners)
    if (side === 'N') walk = [walk[0] + (B.aW ? B.aW.asw : 0) * 0, walk[1], walk[2], walk[3]];
    // trim the avenue-face ground to between the street sidewalks (the corners belong to the intersections)
    if (av) { walk[1] = (sN ? zAt(sN, B.cx) + hwOf(sN) : zt); walk[3] = (sS ? zAt(sS, B.cx) - hwOf(sS) : zb); kerb.a = walk[1]; kerb.b = walk[3]; }
    // street faces: run between the avenue sidewalks' inner edges (the corner squares are the intersection's)
    if (!av) { walk[0] = (B.aW ? B.aW.x + B.aW.AH : xl); walk[2] = (B.aE ? B.aE.x - B.aE.AH : xr); kerb.a = walk[0]; kerb.b = walk[2]; }
    u.walk = walk.map(r2); u.kerb = { axis: kerb.axis, c: r2(kerb.c), a: r2(kerb.a), b: r2(kerb.b), inward: kerb.inward };
    u.line = { c: r2(av ? (side === 'W' ? xl : xr) : (side === 'N' ? zt : zb)), a: r2(av ? walk[1] : walk[0]), b: r2(av ? walk[3] : walk[2]) };
    u.yard = av ? [r2(side === 'W' ? xl : xr - 14), r2(walk[1]), r2(side === 'W' ? xl + 14 : xr), r2(walk[3])] : [r2(walk[0]), r2(side === 'N' ? zt : zb - 14), r2(walk[2]), r2(side === 'N' ? zt + 14 : zb)];
    // trees: census positions inside the sidewalk rectangle (kerb side)
    u.trees = allTrees.filter((t) => inRect(t, u.walk, 0.4));
    // lamps: ~30 m apart on the kerb (side streets stagger between the two kerbs; the avenue faces carry a cobra arm over the roadway)
    const L = Math.hypot(kerb.b - kerb.a, 0), lamps = [], off = (hash(u.id) % 7);
    for (let t = 14 + off; t < L - 10; t += 30) { const along = kerb.a + t; lamps.push(kerb.axis === 'z' ? [r2(along), r2(kerb.c + kerb.inward * 0.45), kerb.inward] : [r2(kerb.c + kerb.inward * 0.45), r2(along), kerb.inward]); }
    u.lamps = lamps.filter((l) => !u.trees.some((t) => Math.hypot(t[0] - l[0], t[1] - l[1]) < 1.6));
    // hydrants: one per ~75 m by rule, away from corners and lamps
    const hy = []; for (let t = 24 + (hash(u.id + 'h') % 12); t < L - 20; t += 75) { const along = kerb.a + t; hy.push(kerb.axis === 'z' ? [r2(along), r2(kerb.c + kerb.inward * 0.38)] : [r2(kerb.c + kerb.inward * 0.38), r2(along)]); }
    u.hydrants = hy;
    // bus shelters on the avenue faces (one per face, no ads), 38 % along
    u.shelters = [];
    if (av && L > 60 && u.inner) { const along = kerb.a + L * (0.34 + (hash(u.id) % 9) * 0.01); u.shelters.push({ x: r2(kerb.c + kerb.inward * 1.25), z: r2(along), ry: side === 'W' ? 0 : 0, face: kerb.inward }); }
    u.skipNear = (B.blk === 1907 && side === 'N') || (B.blk === 1908 && side === 'S');          // W 123rd: the base path (slice 2) builds that sidewalk + the fronts
    u.bbox = [r2(Math.min(walk[0], u.yard[0]) - (av ? 0 : 0)), r2(Math.min(walk[1], u.yard[1])), r2(Math.max(walk[2], u.yard[2])), r2(Math.max(walk[3], u.yard[3]))];
    // widen the bbox by the road half (the kerb side) so the unit's ground distance is honest
    u.bbox = [Math.min(u.bbox[0], kerb.axis === 'x' ? kerb.c - 0 : u.bbox[0]), u.bbox[1], Math.max(u.bbox[2], kerb.axis === 'x' ? kerb.c : u.bbox[2]), u.bbox[3]];
    u.hmax = Math.max(8, ...u.buildings.map((q) => q.h));
    u.cars = { axis: kerb.axis, c: r2(kerb.c), a: r2(kerb.a), b: r2(kerb.b), inward: kerb.inward, ave: av ? 1 : 0, par: (av ? (B.aW && B.aW.key === 'LENOX AVE' ? 1 : 0) : ((sN || sS) ? (sN ? sN.n : sS.n) % 2 : 0)) };
    u.cars.nopark = (u.c125 ? 1 : 0); u.cars.two = (!av && ((sN && sN.n === 125 && side === 'N') || (sS && sS.n === 125 && side === 'S'))) ? 1 : 0; u.cars.rd = r2(av ? (side === 'W' ? (B.aW ? B.aW.rd : 9.24) : (B.aE ? B.aE.rd : 9.24)) : (side === 'N' ? rdN : rdS));
  }
}

/* ------------------------------------------------------------------ chunks: a face longer than ~110 m is cut into <= 100 m chunks along its street (streaming unit = a block-face chunk) */
for (const u of [...units.values()]) {
  if (u.kind !== 'F' || !u.walk) continue;
  const av = u.avenue, A = u.line.a, Bz = u.line.b, L = Bz - A; if (L <= 110) { u.chunk = 0; continue; }
  const n = Math.ceil(L / 100), seg = L / n; units.delete(u.id);
  const alongOf = (b) => { const us = b.poly.map((p) => p[0]); const c = (Math.min(...us) + Math.max(...us)) / 2; return av ? -c : c; };    // face u -> street-frame along-coordinate
  for (let i = 0; i < n; i++) {
    const a = A + i * seg, b = a + seg, last = i === n - 1, inr = (v, pad = 0) => v >= a - pad && v < b + (last ? 1e9 : 0) && v >= a - (i ? 0 : 1e9) - pad;
    const c = { ...u, id: `${u.id}_${i}`, chunk: i, nChunks: n };
    c.buildings = u.buildings.filter((q) => { const v = alongOf(q); return v >= (i ? a : -1e9) && v < (last ? 1e9 : b); });
    const clip = (r) => (av ? [r[0], Math.max(r[1], a), r[2], Math.min(r[3], b)] : [Math.max(r[0], a), r[1], Math.min(r[2], b), r[3]]);
    c.walk = clip(u.walk).map(r2); c.yard = clip(u.yard).map(r2);
    c.line = { ...u.line, a: r2(a), b: r2(b) }; c.kerb = { ...u.kerb, a: r2(a), b: r2(b) }; c.cars = { ...u.cars, a: r2(a), b: r2(b) };
    const al = (p) => (av ? p[1] : p[0]), keep = (p) => al(p) >= a && (last || al(p) < b);
    c.trees = u.trees.filter(keep); c.lamps = u.lamps.filter(keep); c.hydrants = u.hydrants.filter(keep); c.shelters = (u.shelters || []).filter((q) => (av ? q.z : q.x) >= a && (last || (av ? q.z : q.x) < b));
    c.bbox = [Math.min(c.walk[0], c.yard[0]), Math.min(c.walk[1], c.yard[1]), Math.max(c.walk[2], c.yard[2]), Math.max(c.walk[3], c.yard[3])].map(r2);
    c.bbox = av ? [Math.min(c.bbox[0], u.kerb.c), c.bbox[1], Math.max(c.bbox[2], u.kerb.c), c.bbox[3]] : [c.bbox[0], Math.min(c.bbox[1], u.kerb.c), c.bbox[2], Math.max(c.bbox[3], u.kerb.c)];
    c.hmax = Math.max(8, ...c.buildings.map((q) => q.h));
    units.set(c.id, c);
  }
}

/* ------------------------------------------------------------------ intersections */
const ints = [], HOLES = [];
for (const s of streets) for (const a of aves) {
  if (a.key === 'MOUNT MORRIS PARK W') continue;
  const z = zAt(s, a.x), rd = s.roadbed / 2;
  if (z < zOut[0] - 5 || z > zOut[1] + 5 || a.x < xOut[0] || a.x > xOut[1]) continue;
  const inner = a.x > xIn[0] && a.x < xIn[1] && z >= zIn[0] - 1 && z <= zIn[1] + 1;
  const id = `i${s.n}_${a.key.split(' ')[0].toLowerCase()}`;
  const u = { id, kind: 'I', inner, xa: a.x, zs: r2(z), rdS: s.roadbed / 2, hwS: s.hw, rdA: a.rd, AH: a.AH, asw: a.asw, st: s.name, ave: a.name, nS: s.n,
    base: s.n === 123, bbox: [r2(a.x - a.AH), r2(z - s.hw), r2(a.x + a.AH), r2(z + s.hw)] };
  if (s.n === 125 && a.key === 'LENOX AVE') {
    const kx = a.x - a.rd, z0 = z + s.hw + 0.35;                        // the west kerb of Lenox; the stair head starts just south of the corner square
    u.subway = { corner: 'SW', name: '125 St', lines: '2 3', rect: [r2(kx - 3.3), r2(z0), r2(kx - 1.0), r2(z0 + 7.0)] };
    HOLES.push(u.subway.rect);
  }
  ints.push(u); units.set(id, u);
}

/* ------------------------------------------------------------------ slice 3 step 2: holes in the ground (the subway stairwell) for the faces whose sidewalk covers them */
for (const u of units.values()) if (u.kind === 'F' && u.walk) { const w = u.walk, hs = HOLES.filter((h) => h[0] < w[2] && h[2] > w[0] && h[1] < w[3] && h[3] > w[1]); if (hs.length) u.holes = hs; }
/* ------------------------------------------------------------------ slice 3 step 2: Marcus Garvey Park (west half): grass, the Acropolis hill and the Harlem Fire Watchtower (LPC 1967, Julius Kroehl 1856).
   Positions from the centreline (Mount Morris Park W, E 124th / E 120th) and the watchtower's coordinates (40.80472 N, 73.94389 W). Not walkable (the walk bounds end at MMPW). */
{
  const a = aveOf('MOUNT MORRIS PARK W'), mad = lines(/^MADISON AVE$/).flatMap((q) => q.pts).filter((p) => p[1] > -120 && p[1] < 260);
  const xMad = mad.length ? mad.reduce((t, p) => t + p[0], 0) / mad.length : a.x + 300;
  const z0 = zAt(stN(124), a.x) + stN(124).hw, z1 = zAt(stN(120), a.x) - stN(120).hw, x0 = a.x + a.AH, x1 = xMad - 15.24, kerb = a.x + a.rd;
  const wt = toLocal(lonLatToXZ(-73.94389, 40.80472));
  const R = (() => { let q = 77; return () => ((q = (Math.imul(q, 1103515245) + 12345) >>> 0) / 4294967296); })();
  const trees = []; for (let z = z0 + 4; z < z1 - 3; z += 7 + R() * 4) trees.push([r2(x0 + 3 + R() * 3), r2(z), r1(3 + R() * 4)]);       // the park's edge row (EZ-Tree, district.js)
  for (let z = z0 + 8; z < z1 - 6; z += 11 + R() * 6) trees.push([r2(x0 + 12 + R() * 10), r2(z), r1(4 + R() * 4)]);
  // the park's own tax block (its faces are not streets): its few structures (the recreation centre, the pool deck) go into the park unit as plain extrusions
  const PB = [...blocks.values()].find((B) => B.cx > a.x && B.cx < xMad && B.cz > z0 && B.cz < z1);
  const blds = PB ? PB.bs.map((b) => ({ h: r1(+b.f.height_roof * FT), poly: dpSimplify(b.ring, 0.3).map((p) => [r2(p[0]), r2(p[1])]) })).filter((b) => b.h > 1) : [];
  if (PB) for (const [id, uu] of [...units]) if (uu.kind === 'F' && uu.block === PB.blk) units.delete(id);
  const u = { id: 'p_mmp', kind: 'P', inner: true, blds, x0: r2(x0), x1: r2(x1), z0: r2(z0), z1: r2(z1), kerb: r2(kerb), wt: [r2(wt[0]), r2(wt[1])], hill: { r: 78, h: 21 }, trees,
    bbox: [r2(kerb), r2(z0), r2(x1), r2(z1)], hmax: 36 };
  units.set(u.id, u);
  console.log(`[district] park (tax block ${PB && PB.blk}): x ${u.x0}..${u.x1}, z ${u.z0}..${u.z1}, watchtower at ${u.wt}, ${trees.length} edge trees, ${blds.length} park structures`);
}

/* ------------------------------------------------------------------ write */
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const index = { version: 2, holes: HOLES, frame: { ...frame, rot: frame.rot }, streets: streets.map(({ n, name, z, k, roadbed, hw }) => ({ n, name, z, k, roadbed, hw })), avenues: aves.map(({ key, name, x, AH, asw, rd }) => ({ key, name, x, AH, asw, rd })), area: { xIn, zIn, xOut, zOut }, units: [] };
let big = 0, tot = 0;
for (const u of units.values()) {
  if (u.kind === 'F' && !u.buildings.length && !(u.walk)) continue;
  const txt = JSON.stringify(u); fs.writeFileSync(path.join(OUT, u.id + '.json'), txt); tot += txt.length; if (txt.length > 40960) { big++; console.log(`[district] ${u.id} ${(txt.length / 1024).toFixed(1)} KB OVER 40 KB`); }
  index.units.push({ id: u.id, kind: u.kind, inner: u.inner ? 1 : 0, bbox: u.bbox, bytes: txt.length, n: u.buildings ? u.buildings.length : 0, skipNear: u.skipNear ? 1 : 0, hmax: u.hmax || 20, base: u.base ? 1 : 0 });
}
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
index.coverage = { ...cov, lpc_district: lpcD.coverage, lpcByHistPct: pct(cov.lpcByHist, cov.histdist), lpcMatchedPct: pct(cov.lpcMatched, cov.fronts), grammarPct: pct(cov.grammar, cov.fronts) };
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`[district] ${index.units.length} units (${index.units.filter((u) => u.kind === 'F').length} faces, ${ints.length} intersections), ${(tot / 1024).toFixed(0)} KB total, ${big} over 40 KB`);
console.log('[district] coverage', JSON.stringify(index.coverage));
