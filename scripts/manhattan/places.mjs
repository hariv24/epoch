// Notable places (resolved to real footprints / BINs) and the Morningside Heights "home block" lots.
import { lonLatToXZ, pointInPoly, ringArea, bboxOf, ringCentroid, round } from './geo.mjs';
import { FLAGS } from './buildings.mjs';
import { ntaOf } from './vector.mjs';

// kind: 'building' snaps to the footprint containing the point (or the tallest one within `r` m when pick='tallest');
//       'site' / 'bridge' / 'park' are map markers with no building.
export const NOTABLES = [
  { id: 'empire-state', name: 'Empire State Building', kind: 'building', lon: -73.98566, lat: 40.74844, pick: 'tallest', r: 40, hmin: 350 },
  { id: 'chrysler', name: 'Chrysler Building', kind: 'building', lon: -73.97534, lat: 40.75166, pick: 'tallest', r: 40, hmin: 260 },
  { id: 'one-wtc', name: 'One World Trade Center', kind: 'building', lon: -74.01339, lat: 40.71301, pick: 'tallest', r: 60, hmin: 380 },
  { id: 'flatiron', name: 'Flatiron Building', kind: 'building', lon: -73.98971, lat: 40.74106, pick: 'contain', r: 25 },
  { id: 'one-times-square', name: 'One Times Square', kind: 'building', lon: -73.98586, lat: 40.75576, pick: 'contain', r: 25 },
  { id: 'times-square', name: 'Times Square', kind: 'site', lon: -73.98513, lat: 40.7589 },
  { id: 'low-library', name: 'Low Memorial Library (Columbia)', kind: 'building', lon: -73.96243, lat: 40.80843, pick: 'contain', r: 30 },
  { id: 'butler-library', name: 'Butler Library (Columbia)', kind: 'building', lon: -73.96300, lat: 40.80650, pick: 'contain', r: 30 },
  { id: 'columbia-gate', name: 'Columbia University - Broadway gate (116th St)', kind: 'site', lon: -73.96156, lat: 40.80783 },
  { id: 'pupin', name: 'Pupin Hall (Columbia)', kind: 'building', lon: -73.96200, lat: 40.80997, pick: 'contain', r: 30 },
  { id: 'st-john-divine', name: 'Cathedral of St. John the Divine', kind: 'building', lon: -73.96155, lat: 40.80372, pick: 'tallest', r: 40 },
  { id: 'riverside-church', name: 'Riverside Church', kind: 'building', lon: -73.96302, lat: 40.81199, pick: 'tallest', r: 40 },
  { id: 'grants-tomb', name: "General Grant National Memorial", kind: 'building', lon: -73.96288, lat: 40.81342, pick: 'contain', r: 25 },
  { id: 'grand-central', name: 'Grand Central Terminal', kind: 'building', lon: -73.97723, lat: 40.75273, pick: 'contain', r: 40 },
  { id: 'rockefeller', name: '30 Rockefeller Plaza', kind: 'building', lon: -73.97866, lat: 40.75874, pick: 'tallest', r: 120, hmin: 230 },
  { id: 'woolworth', name: 'Woolworth Building', kind: 'building', lon: -74.00834, lat: 40.71236, pick: 'tallest', r: 40 },
  { id: 'bank-of-america', name: 'Bank of America Tower', kind: 'building', lon: -73.98454, lat: 40.75554, pick: 'tallest', r: 40 },
  { id: 'un-secretariat', name: 'United Nations Secretariat', kind: 'building', lon: -73.96800, lat: 40.74935, pick: 'tallest', r: 60 },
  { id: 'msg', name: 'Madison Square Garden / Penn Station', kind: 'building', lon: -73.99345, lat: 40.75051, pick: 'contain', r: 60 },
  { id: 'nyu-bobst', name: 'NYU Bobst Library', kind: 'building', lon: -73.99716, lat: 40.72951, pick: 'tallest', r: 40 },
  { id: 'cooper-union', name: 'Cooper Union Foundation Building', kind: 'building', lon: -73.99055, lat: 40.72924, pick: 'contain', r: 25 },
  { id: '432-park', name: '432 Park Avenue', kind: 'building', lon: -73.97176, lat: 40.76163, pick: 'tallest', r: 40 },
  { id: 'central-park-st-n', name: 'Central Park - Great Lawn', kind: 'park', lon: -73.96520, lat: 40.78130 },
  { id: 'washington-square-arch', name: 'Washington Square Arch', kind: 'site', lon: -73.99705, lat: 40.73123 },
  { id: 'brooklyn-bridge-manhattan', name: 'Brooklyn Bridge - Manhattan approach', kind: 'bridge', lon: -73.99940, lat: 40.71140 },
  { id: 'manhattan-bridge', name: 'Manhattan Bridge - Manhattan approach', kind: 'bridge', lon: -73.99090, lat: 40.71350 },
  { id: 'gwb', name: 'George Washington Bridge - Manhattan tower', kind: 'bridge', lon: -73.94620, lat: 40.85130 },
  { id: 'battery', name: 'The Battery', kind: 'park', lon: -74.01590, lat: 40.70300 },
  { id: 'statue-of-liberty', name: 'Statue of Liberty (Liberty Island)', kind: 'site', lon: -74.04450, lat: 40.68925 },
  { id: 'hudson-yards-vessel', name: 'Hudson Yards - Vessel', kind: 'site', lon: -74.00200, lat: 40.75380 },
];

function buildGrid(buildings, cell = 64) {
  const g = new Map();
  buildings.forEach((b, i) => {
    const r = bboxOf(b.parts[0][0]);
    for (let cx = Math.floor(r[0] / cell); cx <= Math.floor(r[2] / cell); cx++)
      for (let cz = Math.floor(r[1] / cell); cz <= Math.floor(r[3] / cell); cz++) {
        const k = cx * 100003 + cz; let a = g.get(k); if (!a) g.set(k, (a = [])); a.push(i);
      }
  });
  return { cell, g, near(x, z, r) {
    const out = new Set();
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++)
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) for (const i of g.get(cx * 100003 + cz) || []) out.add(i);
    return out;
  } };
}
export const gridOf = buildGrid;

const contains = (b, x, z) => b.parts.some((p) => pointInPoly(x, z, p));

export function resolveNotables(buildings, ntas, terrain, grid) {
  const out = [];
  for (const n of NOTABLES) {
    const [x, z] = lonLatToXZ(n.lon, n.lat);
    const rec = { id: n.id, name: n.name, kind: n.kind, x: round(x, 1), z: round(z, 1), nta: ntaOf(ntas, x, z) };
    if (n.kind === 'building') {
      const cand = [...grid.near(x, z, n.r)].map((i) => buildings[i]);
      let hit = null;
      if (n.pick === 'tallest') {
        let best = -1;
        for (const b of cand) { const d = Math.hypot(b.cx - x, b.cz - z); if (d <= n.r && b.hm > best && b.area > 80) { best = b.hm; hit = b; } }
      }
      if (!hit) hit = cand.find((b) => contains(b, x, z)) || null;
      if (!hit) { let bd = n.r; for (const b of cand) { const d = Math.hypot(b.cx - x, b.cz - z); if (d < bd) { bd = d; hit = b; } } }
      if (hit) {
        if (n.hmin && hit.hm < n.hmin) console.warn(`[warn] notable ${n.id} resolved to a ${hit.hm.toFixed(0)} m building (expected >= ${n.hmin} m): check its coordinates`);
        hit.flags |= FLAGS.NOTABLE;
        Object.assign(rec, { bin: hit.bin, bbl: hit.bbl, x: round(hit.cx, 1), z: round(hit.cz, 1), baseY: round(hit.gm, 1), heightM: round(hit.hm, 1), year: hit.year || 0, tiered: !!hit.tiers });
      } else rec.unresolved = true;
    } else {
      rec.baseY = round(terrain.sample(x, z), 1);
    }
    out.push(rec);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ home block
function distPtSeg(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - a[0]) * dx + (pz - a[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}

export const GRID_DEG = 29; // Manhattan street grid is rotated ~29 degrees east of true north
const GA = (GRID_DEG * Math.PI) / 180;
/** coordinate along the avenues (metres, grows to the north) for a local point */
export const gridV = (x, z) => x * Math.sin(GA) - z * Math.cos(GA);
export const gridU = (x, z) => x * Math.cos(GA) + z * Math.sin(GA);

// ------------------------------------------------------------------------------------------ the year of lots
/** the two neighbourhoods of the year, in order: Morningside Heights, then the northern Upper West Side (Manhattan Valley) */
export const YEAR_NTAS = ['MN0901', 'MN0703'];
/**
 * Selection rules.  Morningside Heights is mostly Columbia and institutions (land use 8, never touched) and Manhattanville is small:
 * together they hold only about 30 weekly rows of touching lots, so the second neighbourhood is Manhattan Valley (W 100-110th), whose
 * brownstone and walk-up rows continue straight south of Morningside Heights.
 */
export const YEAR_RULES = {
  areaMin: 70, areaMax: 1600, hMin: 4, hMax: 80, fill: 0.4, maxBldgs: 4,          // building-sized, compact footprints
  luse: [1, 2, 3, 4, 5], cls: 'ABCDKORS',                                          // residential, mixed use, small commercial: no institutions
  adj: 14,                                                                          // neighbours: footprints at most 14 m apart (a party wall or an alley)
  maxDev: 16, devByNta: { 0: 22 },                                                  // how far a week may drift sideways from a straight line (m)
};

const CA_ = Math.cos(GA), SA_ = Math.sin(GA);
/** unit vector (x, z) of the grid axis +u (across the avenues, east) and +v (along them, north) */
const AX_U = [CA_, SA_], AX_V = [SA_, -CA_];

/**
 * The street side of a lot: from the footprint's edge in each of the four grid directions, how far a ray runs before it meets a street or
 * avenue centreline; the nearest one is the front (a corner lot gets the shorter of its two).  Returns { axis: 'u'|'v', sign, dist }.
 */
export function frontOf(ring, streets) {
  let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
  const segs = [];
  for (const l of streets.lines) {
    if (l.c > 1) continue;
    const p = l.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.min(p[i], p[i + 2]) > cx + 120 || Math.max(p[i], p[i + 2]) < cx - 120 || Math.min(p[i + 1], p[i + 3]) > cz + 120 || Math.max(p[i + 1], p[i + 3]) < cz - 120) continue;
      segs.push(p[i], p[i + 1], p[i + 2], p[i + 3]);
    }
  }
  let best = { axis: 'u', sign: 1, dist: 1e9 };
  for (const [axis, sign, d] of [['u', 1, AX_U], ['u', -1, AX_U], ['v', 1, AX_V], ['v', -1, AX_V]]) {
    const dx = d[0] * sign, dz = d[1] * sign;
    // the footprint's extreme edge in this direction
    let m = -1e9; for (const [x, z] of ring) m = Math.max(m, x * dx + z * dz);
    let ex = 0, ez = 0, n = 0; for (const [x, z] of ring) if (x * dx + z * dz > m - 1.2) { ex += x; ez += z; n++; } ex /= n; ez /= n;
    let t = 1e9;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i], az = segs[i + 1], bx = segs[i + 2] - ax, bz = segs[i + 3] - az;
      const den = dx * bz - dz * bx; if (Math.abs(den) < 1e-9) continue;
      const tt = ((ax - ex) * bz - (az - ez) * bx) / den, ss = ((ax - ex) * dz - (az - ez) * dx) / den;
      if (tt > 0 && ss >= 0 && ss <= 1 && tt < t) t = tt;
    }
    if (t < best.dist - 1e-6) best = { axis, sign, dist: t };
  }
  return best;
}

/** smallest distance between two footprint rings (vertices against edges, both ways) */
function ringGap(r1, r2) {
  let m = Infinity;
  for (const [A, B] of [[r1, r2], [r2, r1]]) for (const [x, z] of A) for (let i = 0, n = B.length, j = n - 1; i < n; j = i++) m = Math.min(m, distPtSeg(x, z, B[j], B[i]));
  return m;
}

/**
 * Pick the year's lots: one real tax lot per study day, grouped so that each Monday-to-Sunday week is a row of 7 touching lots (a block
 * face, or a face that turns a corner), and the rows are ordered as a walk from the anchor (Low Library) through the first neighbourhood and
 * on into the second.  Deterministic.
 *  - candidate = a residential or mixed-use lot (PLUTO land use 1-4, building class A/B/C/D/R/S) that is not an individual landmark, in
 *    one of `ntaOrder`, building-sized and compact, outside Columbia's campus box.  Land use 8 (institutions: houses of worship, schools,
 *    hospitals, the universities) never qualifies, so campus, churches and landmarks stay;
 *  - two lots are neighbours when their footprints are within `opt.adj` m;
 *  - a week = a chain of 7 neighbours that runs straight (small sideways drift from the line between its ends, little wandering);
 *  - rows are chosen greedily: from the end of the last row, the nearest start whose best chain is straight enough.
 * Returns { cand, rows: [{ nta, lots: [cand x7], hop }], first: cand (day 1's lot) }.
 */
export function pickYearLots({ buildings, pluto, streets, ntas, anchor, weeks = 52, campus = null, ntaOrder = YEAR_NTAS, log = () => {}, opt = {} }) {
  opt = { ...YEAR_RULES, ...opt };
  const plBy = new Map(pluto.map((p) => [String(Math.round(+p.bbl)), p]));
  const perBbl = new Map();
  for (const b of buildings) { let a = perBbl.get(b.bbl); if (!a) perBbl.set(b.bbl, (a = [])); a.push(b); }
  const ntaSel = ntaOrder.map((c) => ntas.find((n) => n.code === c));
  const cand = [];
  for (const b of buildings) {
    const list = perBbl.get(b.bbl);
    if (list.length > opt.maxBldgs || list.some((o) => o !== b && o.area > b.area)) continue;
    if (b.flags & (FLAGS.LANDMARK | FLAGS.NOTABLE)) continue;
    const p = plBy.get(b.bbl); if (!p) continue;
    const luse = +p.landuse, cls = p.bldgclass || '';
    if (!opt.luse.includes(luse) || !opt.cls.includes(cls[0] || '-')) continue;
    if (b.area < opt.areaMin || b.area > opt.areaMax || b.hm < opt.hMin || b.hm > opt.hMax) continue;
    const nta = ntaSel.findIndex((n) => ntaOf([n], b.cx, b.cz) === n.code);
    if (nta < 0) continue;
    if (campus && campus(b.cx, b.cz)) continue;
    // compact footprint: the lot fills most of its grid-aligned bounding box (no courtyards or long wings)
    const ring = b.parts[0][0];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) { const u = gridU(x, z), v = gridV(x, z); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const fill = Math.abs(ringArea(ring)) / Math.max(1, (u1 - u0) * (v1 - v0));
    if (fill < opt.fill || b.parts[0].slice(1).some((h) => Math.abs(ringArea(h)) > 12)) continue;
    cand.push({ i: cand.length, b, p, ring, nta, area: b.area, x: b.cx, z: b.cz, dist: Math.hypot(b.cx - anchor[0], b.cz - anchor[1]) });
  }
  // neighbours
  const cell = 100, grid = new Map();
  for (const c of cand) { const k = Math.floor(c.x / cell) * 100003 + Math.floor(c.z / cell); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(c); }
  for (const c of cand) c.nb = [];
  for (const c of cand) {
    const cx = Math.floor(c.x / cell), cz = Math.floor(c.z / cell);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b2 = cz - 1; b2 <= cz + 1; b2++) for (const o of grid.get(a * 100003 + b2) || []) {
      if (o.i <= c.i || Math.hypot(o.x - c.x, o.z - c.z) > 110) continue;
      if (ringGap(c.ring, o.ring) <= opt.adj) { c.nb.push(o); o.nb.push(c); }
    }
  }
  const pathCost = (path) => {
    const a = path[0], e = path[path.length - 1], dx = e.x - a.x, dz = e.z - a.z, ch = Math.hypot(dx, dz) || 1;
    let dev = 0, len = 0;
    path.forEach((c, i) => { dev = Math.max(dev, Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) / ch); if (i) len += Math.hypot(c.x - path[i - 1].x, c.z - path[i - 1].z); });
    return dev > ((opt.devByNta && opt.devByNta[path[0].nta]) || opt.maxDev) ? Infinity : dev * 0.6 + (len / ch - 1) * 25;
  };
  const bestPath = (start, used) => {
    let best = null; const path = [start];
    const rec = () => {
      if (path.length === 7) { const c = pathCost(path); if (c < Infinity && (!best || c < best.cost)) best = { cost: c, path: path.slice() }; return; }
      const last = path[path.length - 1], prev = path[path.length - 2];
      const opts = last.nb.filter((o) => !used.has(o) && !path.includes(o));
      // continue straight first
      const dir = prev ? [last.x - prev.x, last.z - prev.z] : null;
      if (dir) opts.sort((p, q) => { const sc = (o) => { const dx = o.x - last.x, dz = o.z - last.z; return -(dx * dir[0] + dz * dir[1]) / (Math.hypot(dx, dz) || 1); }; return sc(p) - sc(q); });
      for (const o of opts.slice(0, 4)) { path.push(o); rec(); path.pop(); }
    };
    rec();
    return best;
  };
  // the walk: pick the rows of each neighbourhood nearest-first, then (all but the last neighbourhood) re-order them with 2-opt so the walk
  // starts at the anchor and ends where the next neighbourhood begins
  const used = new Set(), rows = [];
  let px = anchor[0], pz = anchor[1];
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  for (let g = 0; g < ntaOrder.length && rows.length < weeks; g++) {
    const pool = cand.filter((c) => c.nta === g);
    const dead = new Set(), got = [];
    let qx = px, qz = pz;
    while (rows.length + got.length < weeks) {
      const starts = pool.filter((c) => !used.has(c) && !dead.has(c)).sort((p, q) => d2(p.x, p.z, qx, qz) - d2(q.x, q.z, qx, qz));
      let pick = null;
      for (const st of starts.slice(0, 30)) {
        const bp = bestPath(st, used);
        if (!bp) { dead.add(st); continue; }
        const hop = d2(st.x, st.z, qx, qz), score = hop + bp.cost * 2.5;
        if (!pick || score < pick.score) pick = { score, hop, ...bp };
      }
      if (!pick) break;
      for (const c of pick.path) used.add(c);
      got.push({ nta: g, lots: pick.path, cost: pick.cost });
      const e = pick.path[6]; qx = e.x; qz = e.z;
    }
    if (g < ntaOrder.length - 1 && got.length > 2) {
      // the first row of the walk is the one nearest the start; the rest are re-ordered (2-opt) so the walk ends where the next neighbourhood begins
      const nxt = cand.filter((c) => c.nta === g + 1).sort((p, q) => p.dist - q.dist)[0];
      const T = nxt ? [nxt.x, nxt.z] : [px, pz];
      let fi = 0, fd = Infinity, fflip = false;
      got.forEach((r, i) => { for (const flip of [false, true]) { const e = flip ? r.lots[6] : r.lots[0], dd = d2(px, pz, e.x, e.z); if (dd < fd) { fd = dd; fi = i; fflip = flip; } } });
      const first = { r: got[fi], flip: fflip }, rest = got.filter((_, i) => i !== fi).map((r) => ({ r, flip: false }));
      const inn = (o) => (o.flip ? o.r.lots[6] : o.r.lots[0]), out = (o) => (o.flip ? o.r.lots[0] : o.r.lots[6]);
      const cost = (a) => { let c = 0, pe = out(first); for (const o of a) { c += d2(pe.x, pe.z, inn(o).x, inn(o).z); pe = out(o); } return c + 2 * d2(pe.x, pe.z, T[0], T[1]); };
      let cur = rest, cc = cost(cur), improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < cur.length; i++) for (let j = i; j < cur.length; j++) {
          const t = cur.slice(0, i).concat(cur.slice(i, j + 1).reverse().map((o) => ({ r: o.r, flip: !o.flip })), cur.slice(j + 1));
          const c = cost(t); if (c < cc - 1e-6) { cur = t; cc = c; improved = true; }
        }
        for (let i = 0; i < cur.length; i++) { const t = cur.slice(); t[i] = { r: cur[i].r, flip: !cur[i].flip }; const c = cost(t); if (c < cc - 1e-6) { cur = t; cc = c; improved = true; } }
        // or-opt: take one row out and put it back anywhere, either way round
        for (let i = 0; i < cur.length; i++) for (let j = 0; j < cur.length; j++) for (const flip of [false, true]) {
          if (i === j && !flip) continue;
          const rest2 = cur.filter((_, q) => q !== i), t = rest2.slice(0, j).concat([{ r: cur[i].r, flip: flip ? !cur[i].flip : cur[i].flip }], rest2.slice(j));
          const c = cost(t); if (c < cc - 1e-6) { cur = t; cc = c; improved = true; }
        }
      }
      const seq = [first, ...cur];
      got.length = 0; for (const o of seq) got.push({ nta: g, lots: o.flip ? o.r.lots.slice().reverse() : o.r.lots, cost: o.r.cost });
    }
    let hx = px, hz = pz;
    for (const r of got) { r.hop = d2(r.lots[0].x, r.lots[0].z, hx, hz); hx = r.lots[6].x; hz = r.lots[6].z; rows.push(r); }
    px = hx; pz = hz;
  }
  // day 1's lot (the Sunday of the week that holds Day 1): the unused neighbour of the first row's first lot, else the nearest unused lot
  let first = null;
  if (rows.length) {
    const r0 = rows[0].lots[0];
    first = r0.nb.filter((o) => !used.has(o) && o.nta === rows[0].nta).sort((p, q) => p.dist - q.dist)[0]
      || cand.filter((o) => !used.has(o) && o.nta === rows[0].nta).sort((p, q) => Math.hypot(p.x - r0.x, p.z - r0.z) - Math.hypot(q.x - r0.x, q.z - r0.z))[0] || null;
  }
  for (const r of rows) for (const c of r.lots) c.front = frontOf(c.ring, streets);
  if (first) first.front = frontOf(first.ring, streets);
  log(`[year] ${cand.length} candidate lots, ${rows.length} week rows (${rows.filter((r) => r.nta === 0).length} in ${ntaOrder[0]}, ${rows.filter((r) => r.nta === 1).length} in ${ntaOrder[1] || '-'}), first lot ${first ? first.p.address : 'none'}`);
  return { cand, rows, first };
}

/** Columbia's main campus (W 114th to W 120th, Broadway to Amsterdam Avenue) as a test on a point, from the 116th Street gate. */
export function campusTest(gate) {
  const u0 = gridU(gate[0], gate[1]) - 20, v0 = gridV(gate[0], gate[1]);
  return (x, z) => { const u = gridU(x, z), v = gridV(x, z); return u > u0 && u < u0 + 340 && v > v0 - 130 && v < v0 + 250; };
}

const dateAdd = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekdayOf = (iso) => (new Date(Date.parse(iso + 'T00:00:00Z')).getUTCDay() + 6) % 7;   // 0 = Monday

/**
 * home.json v2 `weeks`: week row 0 holds Day 1 alone (the days before Day 1 are not slots), rows 1.. are the picked rows.
 * Slot n (0-based day index since Day 1) sits in row floor((n + wd0) / 7) at weekday (n + wd0) % 7 (wd0 = weekday of Day 1, Monday = 0).
 */
export function yearWeeks({ picked, dayOne, ntaNames, ntaOrder = YEAR_NTAS, orient, flatten, homeFlag }) {
  const wd0 = weekdayOf(dayOne), monday0 = dateAdd(dayOne, -wd0);
  const flat = [{ nta: picked.rows[0].nta, lot: picked.first }];
  for (const r of picked.rows) for (const c of r.lots) flat.push({ nta: r.nta, lot: c });
  const weeks = [];
  const slotOf = ({ nta, lot: c }, n) => {
    const b = c.b; b.flags |= homeFlag;
    const f = c.front;
    const fv = f.axis === 'u' ? [AX_U[0] * f.sign, AX_U[1] * f.sign] : [AX_V[0] * f.sign, AX_V[1] * f.sign];
    return {
      n, date: dateAdd(dayOne, n), wd: (n + wd0) % 7, bbl: b.bbl, bin: b.bin, address: (c.p.address || '').replace(/\s+/g, ' ').trim(),
      x: round(b.cx, 2), z: round(b.cz, 2), baseY: round(b.gm, 2), front: [round(fv[0], 4), round(fv[1], 4)],
      realHeightM: round(b.hm, 1), areaM2: round(b.area, 1), year: b.year || 0, bldgClass: c.p.bldgclass || '', style: b.style, nta: ntaOrder[nta],
      footprint: flatten(orient(b.parts[0][0], true)), holes: b.parts[0].slice(1).map((h) => flatten(orient(h, false))),
    };
  };
  flat.forEach((e, n) => {
    const row = Math.floor((n + wd0) / 7);
    let w = weeks[row];
    if (!w) { w = { row, monday: dateAdd(monday0, 7 * row), nta: ntaOrder[e.nta], slots: [] }; weeks[row] = w; }
    w.slots.push(slotOf(e, n));
  });
  return { weeks, monday0, wd0, slotCount: flat.length, neighborhoods: ntaOrder.map((code, i) => ({ code, name: ntaNames[code] || code, firstRow: weeks.findIndex((w) => w.nta === code), rows: weeks.filter((w) => w.nta === code).length })) };
}
