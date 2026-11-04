// Vector layers for the Manhattan build: land, parks, streets, neighbourhoods, far shore.
// All outputs use the local frame of geo.mjs (metres, X east, Z south) and flat coordinate arrays
// [x0, z0, x1, z1, …] rounded to 0.1 m so they are compact in JSON and trivial to turn into typed arrays.
import { createRequire } from 'node:module';
import { lonLatToXZ, ringArea, ringCentroid, simplifyRing, cleanRing, bboxOf, pointInPoly, round } from './geo.mjs';

const pc = createRequire(import.meta.url)('./vendor/polygon-clipping.umd.min.cjs'); // MIT, see vendor/polygon-clipping.LICENSE.md
const r1 = (v) => Math.round(v * 10) / 10;
const flat = (ring) => { const o = new Array(ring.length * 2); ring.forEach((p, i) => { o[2 * i] = r1(p[0]); o[2 * i + 1] = r1(p[1]); }); return o; };

function projGeom(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map((poly) => poly.map((ring) => {
    const r = ring.map((c) => lonLatToXZ(c[0], c[1]));
    if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    return r;
  }));
}
function simplifyPoly(poly, tol, minArea) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    let r = tol > 0 ? simplifyRing(poly[i], tol) : poly[i];
    r = r && cleanRing(r, 0.05);
    if (!r || r.length < 3) { if (i === 0) return null; continue; }
    if (Math.abs(ringArea(r)) < (i === 0 ? minArea : minArea * 2)) { if (i === 0) return null; continue; }
    out.push(r);
  }
  return out;
}

/** Land = NYC Borough Boundaries (water-clipped) for borocode 1.  Returns { polys: [[ring,…holes]…] } in flat arrays + raw for later use. */
export function buildLand(borough) {
  const polys = [];
  const raw = [];
  for (const row of borough) for (const poly of projGeom(row.the_geom)) {
    const s = simplifyPoly(poly, 1.2, 40);
    if (!s) continue;
    raw.push(s);
    polys.push(s.map(flat));
  }
  return { land: { polys }, rawLand: raw };
}

/** Intersect one polygon (rings of [x,z]) with the land multipolygon; returns an array of polygons (rings of [x,z], open). */
function clipToLand(poly, rawLand) {
  const b = bboxOf(poly[0]);
  const near = rawLand.filter((lp) => { const lb = bboxOf(lp[0]); return !(lb[0] > b[2] || lb[2] < b[0] || lb[1] > b[3] || lb[3] < b[1]); });
  if (!near.length) return [];
  let res = [];
  const sub = poly.map((r) => r.map((p) => [p[0], p[1]]));
  try { for (const lp of near) res.push(...pc.intersection(sub, lp.map((r) => r.map((p) => [p[0], p[1]])))); } catch (e) { return [poly]; }
  return res.map((mp) => mp.map((r) => r.slice(0, -1).map((p) => [p[0], p[1]])));
}

export function buildParks(rows, rawLand) {
  const out = [];
  const TYPES = [];
  for (const row of rows) {
    if (row.retired === true || row.retired === 'true') continue;
    const mg = row.multipolygon; if (!mg) continue;
    const name = (row.signname || row.name311 || '').trim();
    const tc = row.typecategory || 'Park';
    let ti = TYPES.indexOf(tc); if (ti < 0) { TYPES.push(tc); ti = TYPES.length - 1; }
    for (const poly0 of projGeom(mg)) {
      for (const poly of clipToLand(poly0, rawLand)) {
        const s = simplifyPoly(poly, 0.8, 120);
        if (!s) continue;
        const [cx, cz] = ringCentroid(s[0]);
        out.push({ n: name, t: ti, a: Math.round(+row.acres * 100) / 100 || 0, c: [r1(cx), r1(cz)], p: s.map(flat) });
      }
    }
  }
  return { types: TYPES, parks: out };
}

export function buildNta(rows) {
  const out = [];
  for (const row of rows) {
    const polys = projGeom(row.the_geom).map((p) => simplifyPoly(p, 2.0, 200)).filter(Boolean);
    if (!polys.length) continue;
    let big = polys[0];
    for (const p of polys) if (Math.abs(ringArea(p[0])) > Math.abs(ringArea(big[0]))) big = p;
    const [cx, cz] = ringCentroid(big[0]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of polys) { const b = bboxOf(p[0]); x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[1]); x1 = Math.max(x1, b[2]); z1 = Math.max(z1, b[3]); }
    out.push({
      code: row.nta2020, name: row.ntaname, abbrev: row.ntaabbrev || '', type: +row.ntatype || 0, cd: row.cdta2020 || '',
      centroid: [r1(cx), r1(cz)], bbox: [r1(x0), r1(z0), r1(x1), r1(z1)], areaKm2: round(polys.reduce((s, p) => s + Math.abs(ringArea(p[0])), 0) / 1e6, 3),
      polys: polys.map((p) => p.map(flat)),
    });
  }
  out.sort((a, b) => (a.code < b.code ? -1 : 1));
  return out;
}

/** Faint context outline of the other boroughs (cropped to 18 km around the island centre, 25 m tolerance). */
export function buildFarShore(rows) {
  const polys = [];
  for (const row of rows) for (const poly of projGeom(row.the_geom)) {
    const ring = poly[0];
    if (!ring.some((p) => Math.hypot(p[0], p[1] + 2500) < 18000)) continue;
    const s = simplifyRing(ring, 25);
    if (!s || Math.abs(ringArea(s)) < 2e5) continue;
    polys.push({ b: row.boroname, p: flat(s) });
  }
  return { polys };
}

// ------------------------------------------------------------------------------------------ streets
export const STREET_CLASS = ['street', 'avenue', 'highway', 'bridge', 'path'];
const HIGHWAY_NAMES = /^(FRANKLIN D ROOSEVELT DR|HENRY HUDSON PKWY|HARLEM RIVER DR|CROSS BRONX EXPY|MAJOR DEEGAN EXPY|HARLEM RIVER DY|BRONX SHORE RD|WEST ST|SOUTH ST|ROBERT MOSES|FDR)/;
const AVE_RE = /(\bAVE\b|\bAVENUE\b|\bBROADWAY\b|\bBWAY\b|\bBOWERY\b|\bBLVD\b|\bPARK ROW\b|\bCENTRAL PARK W\b|\bPARK AVE\b|\bAVE OF THE AMERICAS\b)/;
const MAJOR_CROSS = /^(E |W )? ?(14|23|34|42|57|59|72|79|86|96|110|116|125) ST$|HOUSTON ST|CANAL ST|DELANCEY ST|GRAND ST/;

function cleanName(n) {
  return n.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Ave|St|Brg|Blvd|Expy|Dr|Pkwy|Rd|Pl|Hwy)\b/g, (m) => m).replace(/\b(Ne|Nw|Se|Sw|Fdr)\b/g, (m) => m.toUpperCase());
}

export function buildStreets(rows) {
  const keep = [];
  for (const r of rows) {
    if (r.boroughcode !== '1') continue;
    if (r.status !== '2') continue;
    const rw = r.rw_type;
    let cls;
    const name = (r.full_street_name || '').replace(/\s+/g, ' ').trim();
    if (rw === '1') cls = HIGHWAY_NAMES.test(name) ? 2 : (AVE_RE.test(name) || MAJOR_CROSS.test(name) ? 1 : 0);
    else if (rw === '2') cls = 2;
    else if (rw === '3') cls = 3;
    else if (rw === '6') cls = 4;
    else continue;
    if (cls === 4 && !r.full_street_name) continue;
    const gj = r.the_geom; if (!gj) continue;
    const lines = gj.type === 'LineString' ? [gj.coordinates] : gj.coordinates;
    for (const ln of lines) {
      const p = ln.map((c) => lonLatToXZ(c[0], c[1]));
      if (p.length < 2) continue;
      keep.push({ cls, name, w: Math.max(0, +r.streetwidth || 0) * 0.3048, p });
    }
  }
  // chain segments with the same (class, name) end to end
  const groups = new Map();
  for (const s of keep) { const k = s.cls + '|' + s.name; let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(s); }
  const nameTable = [], nameIdx = new Map();
  const lines = [];
  const key = (pt) => Math.round(pt[0] / 0.6) + ',' + Math.round(pt[1] / 0.6);
  for (const [, segs] of groups) {
    const byEnd = new Map();
    const add = (k, s) => { let a = byEnd.get(k); if (!a) byEnd.set(k, (a = [])); a.push(s); };
    for (const s of segs) { s.used = false; add(key(s.p[0]), s); add(key(s.p[s.p.length - 1]), s); }
    for (const s of segs) {
      if (s.used) continue;
      s.used = true;
      let pts = s.p.slice();
      let wsum = s.w, wn = 1;
      for (const dir of [1, 0]) {
        for (;;) {
          const end = dir ? pts[pts.length - 1] : pts[0];
          const nxt = (byEnd.get(key(end)) || []).find((t) => !t.used);
          if (!nxt) break;
          nxt.used = true; wsum += nxt.w; wn++;
          let q = nxt.p;
          if (dir) {
            if (key(q[0]) !== key(end)) q = q.slice().reverse();
            pts = pts.concat(q.slice(1));
          } else {
            if (key(q[q.length - 1]) !== key(end)) q = q.slice().reverse();
            pts = q.slice(0, -1).concat(pts);
          }
        }
      }
      lines.push({ cls: s.cls, name: s.name, w: wsum / wn, pts });
    }
  }
  const out = [];
  for (const l of lines) {
    // Douglas-Peucker open polyline, 0.6 m
    const pts = dpLine(l.pts, 0.6);
    if (pts.length < 2) continue;
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < 8) continue;
    const nm = cleanName(l.name);
    let ni = nameIdx.get(nm);
    if (ni === undefined) { ni = nameTable.length; nameTable.push(nm); nameIdx.set(nm, ni); }
    out.push({ c: l.cls, n: ni, w: round(l.w, 1), p: flat(pts) });
  }
  return { classes: STREET_CLASS, names: nameTable, lines: out };
}

function dpLine(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let md = 0, mi = -1;
    const a = pts[lo], b = pts[hi], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1e-9;
    for (let i = lo + 1; i < hi; i++) { const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / l; if (d > md) { md = d; mi = i; } }
    if (mi >= 0 && md > tol) { keep[mi] = 1; stack.push([lo, mi], [mi, hi]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function ntaOf(ntas, x, z) {
  for (const n of ntas) {
    if (x < n.bbox[0] || x > n.bbox[2] || z < n.bbox[1] || z > n.bbox[3]) continue;
    if (!n._rings) n._rings = n.polys.map((poly) => poly.map((f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; }));
    for (const rings of n._rings) if (pointInPoly(x, z, rings)) return n.code;
  }
  return null;
}
