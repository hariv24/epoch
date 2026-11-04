// Building records (footprints + PLUTO + LPC + 3-D tiers) and the per-LOD surface generators.
import { lonLatToXZ, sp2263ToLonLat, FT, FT_US, ringArea, ringCentroid, cleanRing, simplifyRing, bboxOf, convexHull } from './geo.mjs';
import { makeSurface, flat, fitPlane } from './mesh.mjs';
import { applySupertalls } from './supertalls.mjs';

export const STYLES = [
  'generic', 'walkup', 'rowhouse', 'prewar_tower', 'artdeco', 'modern_tower', 'postwar_midrise',
  'loft', 'institution', 'commercial_low', 'landmark', 'garage', 'utility', 'supertall_glass',
  'steinway_terracotta', 'park_grid', 'cps_limestone',        // the Billionaires' Row towers with a look of their own (supertalls.mjs)
];
export const FLAGS = { LANDMARK: 1, HISTORIC_DISTRICT: 2, NOTABLE: 4, TIERED: 8, MERGED: 16, SIMPLE_HEIGHT: 32, HOME_LOT: 64 };

// 2100 building, 5100/5110 garage and shed; 1006 is the code the footprint layer uses for towers added since the 2014 3-D model
// (Central Park Tower, 111 W 57th ...), kept only when constructed and taller than a house.
const KEEP_FEATURE = new Set(['2100', '5100', '5110', '1006']);

function projRing(coords) {
  const r = coords.map((c) => lonLatToXZ(c[0], c[1]));
  // drop closing point
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  return cleanRing(r, 0.03);
}

export function styleOf(h, year, pl, fc, isLandmark) {
  const luse = pl ? +pl.landuse : 0;
  const cls = pl && pl.bldgclass ? pl.bldgclass : '';
  const floors = pl && pl.numfloors ? +pl.numfloors : h / 3.4;
  if (isLandmark) return 10;
  if (fc === '5110' || luse === 10 || cls[0] === 'G') return 11;
  if (luse === 7 || cls[0] === 'U') return 12;
  if (luse === 8 || 'IJMNPWYZ'.includes(cls[0] || '-')) return 8;
  if (year >= 2005 && h >= 90) return 13;
  if (h >= 100 && year >= 1915 && year <= 1950) return 4;
  if (h >= 45 && year >= 1946) return 5;
  if (h >= 24 && year < 1946 && year > 0) return 3;
  if ((luse === 1 || luse === 2 || 'ABS'.includes(cls[0] || '-')) && h < 20 && floors <= 5) return 2;
  if (luse === 6 || 'EF'.includes(cls[0] || '-') || (year > 0 && year < 1935 && h >= 14 && h < 45 && (luse === 5 || cls[0] === 'O' || cls[0] === 'L'))) return 7;
  if (luse === 3 || luse === 4 || 'CD'.includes(cls[0] || '-')) {
    if (year > 0 && year < 1946 && floors <= 8) return 1;
    return h >= 24 ? (year >= 1946 ? 5 : 3) : 6;
  }
  if (luse === 5 || 'KORH'.includes(cls[0] || '-')) return h < 15 ? 9 : (year >= 1946 ? 5 : 3);
  return 0;
}

export function prepBuildings({ footprints, pluto, landmarks, tiers3d, log = console.log }) {
  const plutoBy = new Map();
  for (const p of pluto) plutoBy.set(String(Math.round(+p.bbl)), p);
  const lpcBy = new Map();
  for (const l of landmarks) lpcBy.set(String(l.bin), l);
  const binCount = new Map();
  for (const f of footprints) binCount.set(f.bin, (binCount.get(f.bin) || 0) + 1);

  const out = [];
  const stats = { in: footprints.length, skippedFeature: 0, skippedGeom: 0, tiered: 0, tierRejected: 0, noTier: 0, lowH: 0 };
  for (const f of footprints) {
    if (!KEEP_FEATURE.has(f.feature_code)) { stats.skippedFeature++; continue; }
    if ((f.feature_code === '5100' || f.feature_code === '1006') && f.last_status_type && f.last_status_type !== 'Constructed') { stats.skippedFeature++; continue; }
    if (f.feature_code === '1006' && !((+f.height_roof || 0) * FT >= 12)) { stats.skippedFeature++; continue; }
    if (!f.the_geom) { stats.skippedGeom++; continue; }
    const parts = [];
    for (const poly of f.the_geom.coordinates) {
      const rings = poly.map(projRing);
      if (!rings[0]) continue;
      const holes = rings.slice(1).filter(Boolean);
      parts.push([rings[0], ...holes]);
    }
    if (!parts.length) { stats.skippedGeom++; continue; }
    let area = 0, big = parts[0], ba = 0;
    for (const p of parts) {
      let a = Math.abs(ringArea(p[0])); for (let i = 1; i < p.length; i++) a -= Math.abs(ringArea(p[i]));
      area += a; if (a > ba) { ba = a; big = p; }
    }
    const [cx, cz] = ringCentroid(big[0]);
    let hm = (+f.height_roof || 0) * FT;
    const gm = (+f.ground_elevation || 0) * FT;
    let simpleH = 0;
    if (!(hm >= 1.5)) { hm = hm > 0 ? Math.max(hm, 2.5) : 3.0; stats.lowH++; simpleH = 1; }
    const year = +f.construction_year || 0;
    const bbl = String(f.base_bbl || '');
    const pl = plutoBy.get(bbl) || null;
    const lpc = lpcBy.get(String(f.bin)) || null;
    const isLm = !!(pl && pl.landmark && /INDIVIDUAL/.test(pl.landmark)) && !!lpc && lpc.lm_orig && lpc.lm_orig !== '0';
    let flags = 0;
    if (isLm) flags |= FLAGS.LANDMARK;
    if (pl && pl.histdist) flags |= FLAGS.HISTORIC_DISTRICT;
    if (simpleH) flags |= FLAGS.SIMPLE_HEIGHT;
    const b = {
      bin: +f.bin, bbl, fc: f.feature_code, parts, area, cx, cz, hm, gm, year,
      style: styleOf(hm, year || (pl ? +pl.yearbuilt : 0), pl, f.feature_code, isLm),
      flags, floors: pl && +pl.numfloors ? Math.min(255, Math.round(+pl.numfloors)) : Math.max(1, Math.round(hm / 3.4)),
      tiers: null, name: null,
    };
    // ---- 3-D model tiers (setbacks, stepped roofs)
    const t = tiers3d && binCount.get(f.bin) === 1 ? tiers3d[f.bin] : null;
    if (t) {
      const tg = projectTiers(t, gm);
      if (tg) {
        // The building is "unchanged since 2014" when some roof polygon of the 3-D model sits at the footprint's recorded roof
        // height (antennas and spires, which only the 3-D model includes, then simply stand on top) and nothing in the model
        // is absurdly taller than that.
        const tol = Math.max(3.5, 0.08 * hm);
        const top = Math.max(...tg.polys.map((p) => p.zmax)) - tg.g;
        const tall = tg.polys.some((p) => Math.abs(p.zmean - tg.g - hm) <= tol) && top <= hm * 1.7 + 15 ? hm : -1e9;
        if (Math.abs(tall - hm) <= tol && tg.polys.length) { b.tiers = tg; b.gm = tg.g; flags |= FLAGS.TIERED; b.flags = flags; stats.tiered++; }
        else stats.tierRejected++;
      }
    } else stats.noTier++;
    // A supertall newer than the 3-D model that sits on a whole-lot footprint (Central Park Tower: a 3,900 m2 lot, 472 m tall) would
    // extrude into a giant slab. Give it a podium on the lot and a slimmer shaft above: a stand-in massing, not the real setbacks.
    if (!b.tiers && hm >= 180 && area >= 2000) {
      const ring = big[0], podH = Math.min(60, hm * 0.14), k = Math.sqrt(Math.min(0.5, 1100 / area));
      const shaft = ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
      const mk = (r, zTop) => ({ rings3: [r.map(([x, z]) => [x, z, gm + zTop])], area: Math.abs(ringArea(r)), zmean: gm + zTop, zmax: gm + zTop, plane: flat(gm + zTop) });
      b.tiers = { g: gm, polys: [mk(shaft, hm), mk(ring, podH)] }; b.gm = gm; b.flags |= FLAGS.TIERED; b.synthetic = true; stats.synthetic = (stats.synthetic || 0) + 1;
    }
    out.push(b);
  }
  applySupertalls(out, log);
  log(`[prep] ${out.length} buildings (skipped ${stats.skippedFeature} minor structures, ${stats.skippedGeom} bad geometry); synthetic massing: ${stats.synthetic || 0}; tiers: ${stats.tiered} used, ${stats.tierRejected} rejected (height changed since 2014), ${stats.noTier} none`);
  return out;
}

/** Convert one building's 3-D-model roof polygons to local metres, dedupe, drop slivers. */
function projectTiers(t, gFootM) {
  const g = t.g != null ? t.g * FT_US : gFootM;
  const seen = new Set();
  const polys = [];
  for (const r of t.r) {
    const rings = r.slice(2);
    if (!rings.length) continue;
    const rings3 = [];
    for (const ring of rings) {
      const pts = [];
      for (let i = 0; i + 2 < ring.length; i += 3) {
        const [lon, lat] = sp2263ToLonLat(ring[i], ring[i + 1]);
        const [x, z] = lonLatToXZ(lon, lat);
        pts.push([x, z, ring[i + 2] * FT_US]);
      }
      if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02) pts.pop();
      }
      // clean (keep z along)
      const clean = [];
      for (const p of pts) { const q = clean[clean.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 0.03 || Math.abs(q[1] - p[1]) > 0.03) clean.push(p); }
      if (clean.length >= 3) rings3.push(clean);
    }
    if (!rings3.length) continue;
    const outer = rings3[0];
    const area = Math.abs(ringArea(outer));
    if (area < MINTIER0) continue;
    let zmax = -Infinity, zsum = 0;
    for (const p of outer) { if (p[2] > zmax) zmax = p[2]; zsum += p[2]; }
    const zmean = zsum / outer.length;
    if (zmean - g < 1.5) continue;
    const key = Math.round(zmean * 5) + ':' + outer.length + ':' + Math.round(outer[0][0] * 4) + ',' + Math.round(outer[0][1] * 4) + ':' + Math.round(area);
    if (seen.has(key)) continue;
    seen.add(key);
    polys.push({ rings3, area, zmean, zmax, plane: fitPlane(outer) });
  }
  if (!polys.length) return null;
  // roof clutter: bulkheads, tanks and penthouses (small, only a few metres above the main roof) are dropped;
  // small but tall elements (spires, crowns) are kept.
  let main = polys[0];
  for (const p of polys) if (p.area > main.area) main = p;
  const kept = polys.filter((p) => p === main || p.area >= CLUTTER_AREA || p.zmean - main.zmean >= CLUTTER_RISE);
  return { g, polys: kept };
}

// ----------------------------------------------------------------------------------- LOD surfaces
const tolFor = [+(process.env.TOL0 || 0.35), 1.6, 3.0];
const CLUTTER_AREA = +(process.env.CLUTTER_AREA || 24);
const CLUTTER_RISE = +(process.env.CLUTTER_RISE || 7);
const MINTIER0 = +(process.env.MINTIER0 || 0.4);

function simplifyParts(parts, tol, minRing = 3) {
  const res = [];
  for (const p of parts) {
    const o = tol > 0 ? simplifyRing(p[0], tol) : p[0];
    if (!o || o.length < minRing) continue;
    const oc = cleanRing(o, 0.03);
    if (!oc) continue;
    const holes = [];
    for (let i = 1; i < p.length; i++) {
      const h = tol > 0 ? simplifyRing(p[i], tol) : p[i];
      if (h && h.length >= 3 && Math.abs(ringArea(h)) > 4) holes.push(h);
    }
    res.push([oc, ...holes]);
  }
  return res;
}

/** LOD0 / LOD1 surfaces of a building (array of surface records). Returns [] if the building is dropped at this LOD. */
export function surfacesFor(b, lod) {
  const tol = tolFor[lod];
  const g = b.gm;
  const out = [];
  if (b.tiers && (lod === 0 || (lod === 1 && b.hm >= 45) || (lod === 2 && b.hm >= 150))) {
    let polys = b.tiers.polys;
    if (lod >= 1) {
      // level clustering: polygons within 2.5 m of each other's height share one flat level
      polys = polys.slice().sort((p, q) => q.zmean - p.zmean);
      const levels = [];
      for (const p of polys) {
        let L = levels.find((l) => Math.abs(l.z - p.zmean) < 2.5);
        if (!L) { L = { z: p.zmean, items: [] }; levels.push(L); }
        L.items.push(p);
      }
      const keep = levels.filter((l, i) => i === 0 || l.items.reduce((s, p) => s + p.area, 0) > 25);
      polys = [];
      for (const L of keep) for (const p of L.items) polys.push({ ...p, plane: flat(L.z), rings3: p.rings3 });
    }
    for (const p of polys) {
      const rings2 = p.rings3.map((r) => r.map((q) => [q[0], q[1]]));
      const parts = simplifyParts([rings2], tol);
      for (const part of parts) {
        if (lod >= 1 && Math.abs(ringArea(part[0])) < 12) continue;
        out.push(makeSurface(part, p.plane.flat !== undefined || p.plane.a === 0 ? p.plane : p.plane, -1, { g, tier: true }));
      }
    }
    if (out.length) return out;
  }
  // plain prism
  if (lod >= 1) {
    if (b.area < 40 && b.hm < 15) return [];
    if (b.hm < 3.6 && b.area < 150) return [];
  } else if (b.area < 6 && b.hm < 8) return [];
  const parts = simplifyParts(b.parts, tol);
  for (const part of parts) {
    if (Math.abs(ringArea(part[0])) < (lod ? 10 : 3)) continue;
    out.push(makeSurface(part, flat(g + b.hm), -1, { g }));
  }
  return out;
}

/** LOD2: skyline massing — towers individually, everything else merged per tax block into one hull mass. */
export function lod2Masses(buildings) {
  const blocks = new Map();
  const masses = [];
  for (const b of buildings) {
    if (b.hm >= 58 && b.area >= 220) {
      // tall: keep individual, use LOD1-ish tier clusters if very tall, else a simplified prism
      masses.push({ src: b, kind: 'tower' });
    } else if (b.area >= 25) {
      const k = b.bbl.slice(0, 6);
      let a = blocks.get(k); if (!a) blocks.set(k, (a = []));
      a.push(b);
    }
  }
  const merged = [];
  for (const [k, list] of blocks) {
    // area-weighted height; hull of all the footprints; split into two groups by height if they differ a lot
    const groups = [list.filter((b) => b.hm < 20), list.filter((b) => b.hm >= 20)];
    for (const gl of groups) {
      if (!gl.length) continue;
      const pts = [];
      let aw = 0, hs = 0, gs = 0, ys = 0, ar = 0;
      for (const b of gl) for (const part of b.parts) { for (const p of part[0]) pts.push(p); }
      for (const b of gl) { aw += b.area; hs += b.hm * b.area; gs += b.gm * b.area; ys += b.year * b.area; }
      if (pts.length < 3 || aw < 120) continue;
      let hull = convexHull(pts);
      if (hull.length < 3) continue;
      hull = simplifyRing(hull, 4) || hull;
      hull = cleanRing(hull, 0.05) || hull;
      // convex hull overshoots L-shaped blocks; keep it honest by scaling the hull toward its centroid so
      // the hull area ~ 1.15x the true building area (never more than 12% shrink)
      const hullA = Math.abs(ringArea(hull));
      let sc = 1;
      if (hullA > aw * 1.25) sc = Math.max(0.88, Math.sqrt((aw * 1.25) / hullA));
      const [cx, cz] = ringCentroid(hull);
      if (sc < 1) hull = hull.map((p) => [cx + (p[0] - cx) * sc, cz + (p[1] - cz) * sc]);
      const first = gl[0];
      merged.push({
        bin: 0, bbl: first.bbl, cx, cz, parts: [[hull]], area: hullA * sc * sc, hm: Math.max(5, hs / aw), gm: gs / aw,
        year: Math.round(ys / aw), style: first.style, flags: FLAGS.MERGED, floors: Math.max(1, Math.round(hs / aw / 3.4)), tiers: null, merged: gl.length,
      });
    }
  }
  return { towers: masses.map((m) => m.src), merged };
}

// ------------------------------------------------------------------------------ LOD1 clustering
function distPtSeg(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 < 1e-9 ? 0 : ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}
function ringsTouch(A, B, d) {
  for (const p of A) for (let i = 0, n = B.length, j = n - 1; i < n; j = i++) if (distPtSeg(p[0], p[1], B[j], B[i]) < d) return true;
  for (const p of B) for (let i = 0, n = A.length, j = n - 1; i < n; j = i++) if (distPtSeg(p[0], p[1], A[j], A[i]) < d) return true;
  return false;
}

/**
 * LOD1: low buildings (<32 m) that share party walls, sit on the same tax block and are of similar height are merged
 * into one prism over their convex hull (only when the hull stays close to the true footprint area).  Returns
 * { kept: buildings drawn individually, merged: mass records }.
 */
export function lod1Masses(buildings) {
  const MAXH = 32, DH = 5, CAP = 16;
  const elig = [];
  const rest = [];
  for (const b of buildings) {
    if (b.hm < MAXH && b.area >= 12 && !(b.flags & FLAGS.LANDMARK) && !(b.flags & FLAGS.NOTABLE)) elig.push(b); else rest.push(b);
  }
  const bb = elig.map((b) => { const r = bboxOf(b.parts[0][0]); return [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1]; });
  const CELLS = 48;
  const grid = new Map();
  elig.forEach((b, i) => {
    for (let cx = Math.floor(bb[i][0] / CELLS); cx <= Math.floor(bb[i][2] / CELLS); cx++)
      for (let cz = Math.floor(bb[i][1] / CELLS); cz <= Math.floor(bb[i][3] / CELLS); cz++) {
        const k = cx * 100003 + cz; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
      }
  });
  const parent = elig.map((_, i) => i), size = elig.map(() => 1);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  elig.forEach((b, i) => {
    const seen = new Set();
    for (let cx = Math.floor(bb[i][0] / CELLS); cx <= Math.floor(bb[i][2] / CELLS); cx++)
      for (let cz = Math.floor(bb[i][1] / CELLS); cz <= Math.floor(bb[i][3] / CELLS); cz++) {
        for (const j of grid.get(cx * 100003 + cz) || []) {
          if (j <= i || seen.has(j)) continue; seen.add(j);
          const c = elig[j];
          if (c.bbl.slice(0, 6) !== b.bbl.slice(0, 6) || Math.abs(c.hm - b.hm) > DH) continue;
          if (bb[i][0] > bb[j][2] || bb[j][0] > bb[i][2] || bb[i][1] > bb[j][3] || bb[j][1] > bb[i][3]) continue;
          const ri = find(i), rj = find(j);
          if (ri === rj || size[ri] + size[rj] > CAP) continue;
          if (!ringsTouch(b.parts[0][0], c.parts[0][0], 1.0)) continue;
          parent[rj] = ri; size[ri] += size[rj];
        }
      }
  });
  const groups = new Map();
  elig.forEach((b, i) => { const r = find(i); let a = groups.get(r); if (!a) groups.set(r, (a = [])); a.push(b); });
  const kept = rest.slice();
  const merged = [];
  for (const gl of groups.values()) {
    if (gl.length < 2) { kept.push(gl[0]); continue; }
    const pts = [];
    let aw = 0, hs = 0, gs = 0, ys = 0, big = gl[0];
    for (const b of gl) {
      for (const part of b.parts) for (const p of part[0]) pts.push(p);
      aw += b.area; hs += b.hm * b.area; gs += b.gm * b.area; ys += b.year * b.area;
      if (b.area > big.area) big = b;
    }
    let hull = pts.length >= 3 ? convexHull(pts) : [];
    const hullA = hull.length >= 3 ? Math.abs(ringArea(hull)) : Infinity;
    if (hullA > aw * 1.3) { for (const b of gl) kept.push(b); continue; }
    hull = simplifyRing(hull, 0.9) || hull;
    hull = cleanRing(hull, 0.05) || hull;
    const [cx, cz] = ringCentroid(hull);
    merged.push({
      bin: 0, bbl: big.bbl, cx, cz, parts: [[hull]], area: Math.abs(ringArea(hull)), hm: hs / aw, gm: gs / aw,
      year: Math.round(ys / aw), style: big.style, flags: FLAGS.MERGED, floors: big.floors, tiers: null, merged: gl.length,
    });
  }
  return { kept, merged };
}
