// city/surround.js · the rest of New York around the World > City diorama, so it reads as a real place from every side
// and from straight above (city mode only; the Today hero keeps its own compact world from world.js):
//   Manhattan carries on north (more Midtown, Billionaires' Row, Central Park with the Reservoir, the Upper West and
//   East Sides, Harlem) and ends south in a rounded Battery tip with a promenade, Castle Clinton and the ferry terminal;
//   the East River and the Hudson open into the Upper Bay; Brooklyn and Queens (east) and New Jersey (west) are low-poly
//   street grids with their own small skylines (Downtown Brooklyn, Long Island City, Jersey City), waterfront promenades
//   and piers; Governors Island, Liberty Island and Roosevelt Island sit in the water; Staten Island far to the south.
// All static and merged: one ground Geo, one near-building Geo, one far-building Geo, plus street-light pools,
// rectangles for the camera's height clamp and the shorelines (rounded boxes) that the water shader uses for foam.
import * as THREE from 'three';
import { Geo, rng, rgb, shade, KIND, clamp, smooth, TAU } from './util.js';
import { fillerBuilding, tree, waterTank } from './towers.js';

const C = (h) => rgb(h);
const COL = {
  road: '#1d2a42', farRoad: '#1a2640', side: '#34496f', top: '#40577f', farTop: '#34496c', farSide: '#2c3f62',
  prom: '#8f877a', promTop: '#a79e8c', grass: '#2b6f5d', grassTop: '#2f7a66', lawn: '#3a8a70', path: '#9c9584', wall: '#6d7486',
  rail: '#1b2a44', wallTop: '#6a7fa6', wallBot: '#0a1a38', pier: '#5e6070', pile: '#22304a',
};

/** Shorelines as rounded boxes {x0,z0,x1,z1,r}. The water shader draws foam where its signed distance is about zero. */
export function landMasses(L) {
  const HW = L.HW, wx = L.HW + L.waterW, F = 300;
  return [
    { id: 'manhattan', x0: -HW, z0: L.zEnd, x1: HW, z1: L.tipZ, r: 3.0 },
    { id: 'brooklyn', x0: wx, z0: -F, x1: F, z1: 30, r: 5 },
    { id: 'redhook', x0: wx + 8.8, z0: 18, x1: F, z1: F, r: 4 },
    { id: 'bronx', x0: -HW, z0: -F, x1: F, z1: L.zEnd - 3.2, r: 3 },
    { id: 'jersey', x0: -F, z0: -F, x1: -wx, z1: 24, r: 5 },
    { id: 'bayonne', x0: -F, z0: 16, x1: -wx - 8.4, z1: F, r: 4 },
    { id: 'governors', x0: 4.6, z0: 23.4, x1: 10.6, z1: 28.6, r: 2.2 },
    { id: 'liberty', x0: -14.0, z0: 31.6, x1: -11.2, z1: 34.4, r: 1.1 },
    { id: 'roosevelt', x0: 14.25, z0: -70, x1: 15.95, z1: -38, r: 0.8 },
    { id: 'staten', x0: -70, z0: 118, x1: 20, z1: 170, r: 12 },
  ];
}
const sdBox = (x, z, m) => { const cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2, hx = (m.x1 - m.x0) / 2 - m.r, hz = (m.z1 - m.z0) / 2 - m.r; const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - m.r; };
export const onLand = (lands, x, z, margin = 0) => lands.some((m) => sdBox(x, z, m) < -margin);

// rounded rectangle outline (x, z pairs) going round once
function rrect(x0, z0, x1, z1, r, seg = 6) {
  const pts = [], c = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI], [x1 - r, z0 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of c) for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}
// convex polygon prism: a flat top (fan from the centroid) and gradient walls. `skip` = edge indices without a wall.
function polyPrism(g, pts, y0, y1, ctop, cwTop, cwBot, o = {}) {
  let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
  const n = pts.length, t = cwTop, b = cwBot;
  for (let i = 0; i < n; i++) {
    if (o.skip && o.skip.includes(i)) continue;
    let a = pts[i], c = pts[(i + 1) % n];
    const ex = c[0] - a[0], ez = c[1] - a[1], mx = (a[0] + c[0]) / 2 - cx, mz = (a[1] + c[1]) / 2 - cz;
    if (-ez * mx + ex * mz < 0) { const q = a; a = c; c = q; }            // outward: (edge x up) must point away from the centroid
    if (o.walls !== false) g.quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], [b, b, t, t], 0, 1, o.kind ?? KIND.plain);
  }
  if (o.top === false) return;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    const p0 = [cx, y1, cz], p1 = [a[0], y1, a[1]], p2 = [c[0], y1, c[1]];
    const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    if (ny > 0) g.tri(p0, p1, p2, ctop, o.kindTop ?? KIND.plain); else g.tri(p0, p2, p1, ctop, o.kindTop ?? KIND.plain);
  }
}
const ellipse = (cx, cz, rx, rz, n = 18, rot = 0) => Array.from({ length: n }, (_, k) => { const a = (k / n) * TAU; const x = Math.cos(a) * rx, z = Math.sin(a) * rz; return [cx + x * Math.cos(rot) - z * Math.sin(rot), cz + x * Math.sin(rot) + z * Math.cos(rot)]; });

/**
 * Builds everything around the hero island. Returns {ground, near, far, pools, rects, water} where `water` holds extra
 * flat water polygons (the Reservoir, ponds) for the water mesh.
 */
export function buildSurround(L) {
  const ground = new Geo(), near = new Geo(), far = new Geo(), pools = [], rects = [], waterPolys = [];
  const r = rng(1931), HW = L.HW, wx = L.HW + L.waterW, lands = landMasses(L);
  const roadC = C(COL.road), sideC = C(COL.side), topC = C(COL.top);
  const fade = (x, z) => clamp(1.25 - Math.hypot(x, z + 4) / 62, 0, 1);
  const dimAt = (x, z) => 0.92 - 0.3 * smooth(clamp((Math.hypot(x, z + 2) - 18) / 50, 0, 1));
  let bid = 300;
  const pool = (x, z, rad, k) => { const f = fade(x, z) * k; if (f > 0.03) pools.push([x, z, rad, f]); };
  const bldg = (g, x, zFront, w, d, F, o = {}) => {
    const h = fillerBuilding(g, x, zFront, w, d, F, r, { dim: o.dim ?? dimAt(x, zFront - d / 2), id: bid++, rim: Math.hypot(x, zFront + 4) < 44 });
    rects.push({ x, z: zFront - d / 2, w: w + 0.1, d: d + 0.1, h: h + (F >= 14 ? 0.9 : 0.3) });
    if (o.roof !== false) roofDetail(g, x, zFront - d / 2, w, d, h, F);
    return h;
  };
  // rooftop life for the top view: a parapet rim, mechanical boxes, sometimes a water tower or a green roof terrace
  function roofDetail(g, x, cz, w, d, h, F) {
    if (F > 13 || w < 0.7) return;
    const k = r(), y = h + 0.05, x0 = x - w / 2 + 0.06, x1 = x + w / 2 - 0.06, z0 = cz - d / 2 + 0.06, z1 = cz + d / 2 - 0.06;
    if (k < 0.16) { g.box(x0 + 0.06, y, z0 + 0.06, x1 - 0.06, y + 0.02, z1 - 0.06, C('#3f7f62'), { ctop: C('#4a9070') }); if (w > 1) tree(g, x0 + 0.25, z1 - 0.25, r, 0.55); }
    else if (k < 0.32 && F >= 4) waterTank(g, x1 - 0.22, y, z0 + 0.25, 0.7);
    else if (k < 0.62) g.box(x - w * 0.18, y, cz - d * 0.15, x + w * 0.12, y + 0.08, cz + d * 0.12, C('#5a6680'), { ctop: C('#7d89a3') });
  }
  const lampDot = (x, z, k = 1) => { ground.bar([x, 0, z], [x, 0.42, z], 0.02, C(COL.rail)); ground.sphere(x, 0.46, z, 0.04, 6, 4, C('#ffe3ae'), { kind: KIND.glow }); pool(x, z, 0.7, 0.75 * k); };

  /* ---------------------------------------------------------------- land: rounded plates, sea walls down to the water */
  for (const m of lands) {
    if (m.id === 'manhattan') continue;                                   // Manhattan's body is world.js's slab; its tip is below
    const top = m.id === 'staten' ? C('#1b2b47') : m.id === 'governors' || m.id === 'liberty' ? C(COL.prom) : C(COL.farRoad);
    polyPrism(ground, rrect(m.x0, m.z0, m.x1, m.z1, m.r, m.r > 3 ? 7 : 5), -3.4, -0.05, top, C(COL.wallTop), C(COL.wallBot));
  }
  // the Battery: Manhattan's rounded southern tip (no wall where it meets the plaza)
  {
    const tip = L.tipZ, rr = 3.0, pts = [[-HW, L.zFront]];
    for (let k = 0; k <= 6; k++) { const a = Math.PI + (k / 6) * (Math.PI / 2); pts.push([-HW + rr + Math.cos(a) * rr, tip - rr - Math.sin(a) * rr]); }
    for (let k = 0; k <= 6; k++) { const a = Math.PI * 1.5 + (k / 6) * (Math.PI / 2); pts.push([HW - rr + Math.cos(a) * rr, tip - rr - Math.sin(a) * rr]); }
    pts.push([HW, L.zFront]);
    polyPrism(ground, pts, -3.4, 0, C(COL.promTop), C(COL.wallTop), C(COL.wallBot), { skip: [pts.length - 1] });
    // lawn inside the promenade ring, a path, trees, Castle Clinton, the ferry terminal and its slips, lamps on the rail
    const inner = pts.map(([x, z]) => [x * 0.93, L.zFront + (z - L.zFront) * 0.72 + 0.12]);
    polyPrism(ground, inner, 0, 0.02, C(COL.grassTop), C(COL.grass), C(COL.grass), { skip: [inner.length - 1] });
    for (let x = -HW + 0.6; x < HW - 0.5; x += 0.95) {
      const zz = Math.min(tip - 0.25, tip - rr + Math.sqrt(Math.max(0, rr * rr - Math.max(0, Math.abs(x) - (HW - rr)) ** 2)) - 0.25);
      if (Math.abs(x) < HW - 0.6) ground.bar([x, 0, zz], [x, 0.13, zz], 0.014, C(COL.rail));
    }
    ground.bar([-HW + rr, 0.12, tip - 0.22], [HW - rr, 0.12, tip - 0.22], 0.012, C(COL.rail));
    for (let x = -HW + 1.6; x < HW - 1.2; x += 2.3) lampDot(x, tip - 0.4, 0.8);
    for (let k = 0; k < 22; k++) { const x = (r() - 0.5) * 2 * (HW - 2.6), z = L.zFront + 0.6 + r() * (tip - L.zFront - 1.6); if (Math.abs(x + 6) < 1.2 && z > L.zFront + 0.8) continue; tree(ground, x, z, r, 1.0 + r() * 0.4, r() < 0.15); }
    // Castle Clinton: a low round sandstone fort
    const ccx = -6, ccz = L.zFront + 1.6;
    ground.cyl(ccx, ccz, 0, 0.32, 0.9, 0.9, 18, C('#b49a7c'), { ctop: C('#8a7660') }); ground.cyl(ccx, ccz, 0.0, 0.33, 0.68, 0.68, 18, C('#5f6e55'), { top: true, ctop: C('#4d7a5c') });
    rects.push({ x: ccx, z: ccz, w: 1.9, d: 1.9, h: 0.4 });
    // Staten Island ferry terminal with two slips
    const fx = 6.4, fz = tip - 1.3;
    ground.box(fx - 1.5, 0, fz - 0.6, fx + 1.5, 0.42, fz + 0.85, C('#7e8aa2'), { win: true, ctop: C('#56627c') });
    ground.box(fx - 1.62, 0.42, fz - 0.72, fx + 1.62, 0.47, fz + 0.98, C('#c9c2b2'), { ctop: C('#8d95a8') });
    ground.box(fx - 0.7, 0.3, fz + 0.85, fx + 0.7, 0.38, fz + 0.88, C('#ffd9a0'), { kind: KIND.glow });
    for (const sx of [-0.9, 0.9]) { ground.box(fx + sx - 0.35, -0.12, fz + 1.0, fx + sx + 0.35, -0.04, fz + 2.6, C(COL.pier), { ctop: shade(C(COL.pier), 1.2) }); for (let z = fz + 1.2; z < fz + 2.6; z += 0.45) ground.bar([fx + sx - 0.33, -0.9, z], [fx + sx - 0.33, -0.1, z], 0.04, C(COL.pile)); }
    rects.push({ x: fx, z: fz, w: 3.5, d: 2, h: 0.6 });
    pool(fx, fz + 1.3, 1.0, 0.6);
    // Pier A on the west side: a little brick shed with a clock tower
    ground.box(-HW + 0.9, 0, tip - 3.4, -HW + 2.0, 0.38, tip - 2.6, C('#a0644f'), { win: true }); ground.box(-HW + 1.75, 0.38, tip - 3.0, -HW + 1.95, 0.75, tip - 2.8, C('#c8b79e')); ground.cyl(-HW + 1.85, tip - 2.9, 0.75, 0.9, 0.14, 0.0, 4, C('#3f6a5c'), { rot: Math.PI / 4 });
  }

  /* ---------------------------------------------------------------- Manhattan north of the hero rows */
  const avX0 = 5.5, avX1 = 5.5 + L.AV, PZ = L.PZ;
  const rowsN = [];                                                       // [k, z centre] for rows north of the back rows
  for (let k = -L.backRows - 1; ; k--) { const z = (k - (L.rows - 1) / 2) * PZ; if (z - 1.15 < L.zEnd + 1.5) break; rowsN.push(z); }
  const cpS = rowsN[4] - 1.15 - 0.5, cpN = cpS - 32;                      // Central Park: from Central Park South, 32 units long
  L.centralPark = { x0: -avX0, x1: avX0, z0: cpN, z1: cpS };
  // avenue lane lines carried north
  for (const sx of [-1, 1]) { const ax = sx * (avX0 + L.AV / 2); for (let z = L.zBack - 0.2; z > L.zEnd + 2; z -= 0.84) ground.box(ax - 0.012, -0.05, z - 0.22, ax + 0.012, -0.046, z, C('#d8c9a6'), { sides: 0 }); }
  for (const z of rowsN) {
    const za = z - 1.15, zb = z + 1.15, inPark = z - 1.15 < cpS + 0.1 && z + 1.15 > cpN - 0.1;
    // sidewalks (flank blocks always; the middle block unless it is park)
    for (const [a, b] of [[-HW, -avX1], [avX1, HW]].concat(inPark ? [] : [[-avX0, avX0]])) ground.box(a, -0.05, za, b, 0, zb, sideC, { ctop: topC });
    // street lights on the corners
    for (const sx of [-1, 1]) { pool(sx * 5.38, zb + 0.5, 0.75, 0.75); pool(sx * (avX1 + 0.1), za - 0.3, 0.75, 0.6); }
    const depth = L.zBack - z, mid = (x) => Math.exp(-Math.abs(x) / 7);
    const run = (xa, xb, hf, g, maxW = 1.6, front = zb - 0.05, d = 2.2) => {
      let x = xa;
      while (x < xb - 0.6) { let w = 0.95 + r() * (maxW - 0.95); if (xb - (x + w) < 0.8) w = xb - x; const cx = x + w / 2; bldg(g, cx, front, w - 0.05, d - r() * 0.3, Math.max(2, Math.round(hf(cx)))); x += w; }
    };
    if (z > cpS) {
      // Midtown: taller toward Central Park; the last row is Billionaires' Row (very slim, very tall)
      const bil = z - 1.15 < cpS + 3.5;
      if (bil) {
        for (let x = -avX0 + 0.5; x < avX0 - 0.4; x += 1.25 + r() * 0.5) {
          if (r() < 0.25) continue;
          const F = 18 + Math.round(r() * 10), w = 0.5 + r() * 0.22;
          const h = fillerBuilding(near, x, zb - 0.1 - r() * 0.6, w, w * 1.1, F, r, { dim: 0.9, id: bid++ });
          rects.push({ x, z: z, w: w + 0.2, d: 2.4, h: h + 1 });
        }
        run(-avX0 + 0.2, avX0 - 0.2, () => 4 + r() * 4, near, 1.4, za + 1.0, 0.95);
      } else run(-avX0 + 0.25, avX0 - 0.25, (x) => 5 + depth * 0.32 + r() * (4 + depth * 0.45) * mid(x) + r() * 2, near);
      for (const sx of [-1, 1]) run(sx > 0 ? avX1 + 0.1 : -HW + 0.45, sx > 0 ? HW - 0.45 : -avX1 - 0.1, () => 4 + depth * 0.25 + r() * 7, near, 1.5);
    } else if (z > cpN) {
      // the Upper West and Upper East Sides: tall co-ops facing the park, lower rows behind
      for (const sx of [-1, 1]) {
        const xa = sx > 0 ? avX1 + 0.1 : -HW + 0.45, xb = sx > 0 ? HW - 0.45 : -avX1 - 0.1;
        let x = xa;
        while (x < xb - 0.5) {
          let w = 0.9 + r() * 0.8; if (xb - (x + w) < 0.8) w = xb - x;
          const cx = x + w / 2, faceP = Math.abs(cx) < avX1 + 1.8, F = faceP ? 8 + Math.round(r() * 8) : 3 + Math.round(r() * 5);
          bldg(far, cx, zb - 0.05, w - 0.06, 2.1, F); x += w;
        }
      }
    } else {
      // Harlem: lower, calmer, a little sparser
      for (const [xa, xb] of [[-avX0 + 0.25, avX0 - 0.25], [avX1 + 0.1, HW - 0.45], [-HW + 0.45, -avX1 - 0.1]]) {
        let x = xa;
        while (x < xb - 0.6) { let w = 1.0 + r() * 0.9; if (xb - (x + w) < 0.8) w = xb - x; if (r() > 0.15) bldg(far, x + w / 2, zb - 0.05, w - 0.06, 1.6 + r() * 0.5, 3 + Math.round(r() * 4 + (r() < 0.1 ? 6 : 0))); x += w; }
      }
    }
  }
  // waterfront promenades, rails and trees on both sides of the island, all the way north
  for (const sx of [-1, 1]) {
    for (let z = L.zBack - 0.6; z > L.zEnd + 2; z -= 2.6) { tree(ground, sx * (HW - 0.3), z, r, 0.85 + r() * 0.3); if (z > -70) pool(sx * (HW - 0.2), z - 1.3, 0.7, 0.55); }
    ground.bar([sx * (HW - 0.04), 0.12, L.zBack], [sx * (HW - 0.04), 0.12, L.zEnd + 1], 0.012, C(COL.rail));
  }

  /* ---------------------------------------------------------------- Central Park */
  {
    const { x0, x1, z0, z1 } = L.centralPark, cxp = 0;
    ground.box(x0 - 0.05, -0.05, z0, x1 + 0.05, 0.02, z1, C(COL.grass), { ctop: C('#245e4f') });
    for (const [a, b, c, d] of [[x0 - 0.05, z0 - 0.05, x1 + 0.05, z0 + 0.05], [x0 - 0.05, z1 - 0.05, x1 + 0.05, z1 + 0.05], [x0 - 0.05, z0, x0 + 0.05, z1], [x1 - 0.05, z0, x1 + 0.05, z1]]) ground.box(a, 0, b, c, 0.07, d, C(COL.wall));
    // lawns
    polyPrism(ground, ellipse(cxp, z1 - 5.5, 3.4, 1.9, 16), 0.02, 0.03, C(COL.lawn), C(COL.lawn), C(COL.lawn), { walls: false });   // Sheep Meadow
    polyPrism(ground, ellipse(cxp + 0.3, z1 - 23.5, 2.7, 2.4, 16), 0.02, 0.03, C(COL.lawn), C(COL.lawn), C(COL.lawn), { walls: false }); // Great Lawn
    // the loop drive and the transverse roads
    const pathC = C(COL.path), dr = (ax, az, bx, bz) => ground.bar([ax, 0.026, az], [bx, 0.026, bz], 0.13, pathC);
    const loop = rrect(x0 + 0.7, z0 + 0.8, x1 - 0.7, z1 - 0.7, 2.2, 4);
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; dr(a[0], a[1], b[0], b[1]); }
    for (const tz of [z1 - 8.5, z1 - 14.5, z1 - 26.5]) ground.box(x0, -0.02, tz - 0.22, x1, 0.035, tz + 0.22, C(COL.road), { sides: 0 });
    for (let k = 0; k < 7; k++) { const za = z1 - 1.5 - k * 4.3; dr(x0 + 0.7 + r() * 1.5, za, x1 - 0.7 - r() * 1.5, za - 1.2 - r() * 1.5); }
    // the Reservoir, the Lake and the Pond (water mesh), with a gravel running track round the Reservoir
    const res = ellipse(cxp, z1 - 18.2, 3.6, 3.0, 22), lake = ellipse(cxp - 1.6, z1 - 11.2, 2.0, 1.1, 14, 0.4), pond = ellipse(cxp + 3.2, z1 - 1.6, 1.0, 0.6, 12, -0.3);
    waterPolys.push(res, lake, pond);
    polyPrism(ground, ellipse(cxp, z1 - 18.2, 3.85, 3.25, 22), 0.02, 0.035, C('#a69c88'), C('#a69c88'), C('#a69c88'), { walls: false });
    // trees in loose clumps, kept off the water and the lawns
    const inside = (p, x, z) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const keepOff = [ellipse(cxp, z1 - 18.2, 4.1, 3.5, 22), ellipse(cxp - 1.6, z1 - 11.2, 2.3, 1.4, 14, 0.4), pond, ellipse(cxp, z1 - 5.5, 3.5, 2.0, 16), ellipse(cxp + 0.3, z1 - 23.5, 2.9, 2.6, 16)];
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < 260; tries++) {
      const x = x0 + 0.35 + r() * (x1 - x0 - 0.7), z = z0 + 0.35 + r() * (z1 - z0 - 0.7);
      if (keepOff.some((p) => inside(p, x, z))) continue;
      tree(ground, x, z, r, 1.25 + r() * 0.6, r() < 0.12); placed++;
    }
    for (let k = 0; k < 18; k++) { const p = loop[(k * 5) % loop.length]; pool(p[0], p[1], 0.6, 0.55); }
    // Bethesda Terrace: a small lit fountain by the Lake
    ground.cyl(cxp - 1.2, z1 - 9.7, 0.02, 0.08, 0.35, 0.35, 12, C('#c9c0ae')); ground.cyl(cxp - 1.2, z1 - 9.7, 0.08, 0.3, 0.05, 0.05, 6, C('#d9d0be'));
    pool(cxp - 1.2, z1 - 9.7, 0.9, 0.7);
  }

  /* ---------------------------------------------------------------- the boroughs: street grids with their own skylines */
  const reserve = [
    { x0: wx - 1, x1: wx + 6.4, z0: L.b0 - 1.9, z1: L.b0 + 1.7 },        // the Brooklyn Bridge landing
    { x0: -wx - 9, x1: -wx + 1, z0: 16, z1: 42 },                         // Liberty State Park
  ];
  const reserved = (x0, z0, x1, z1) => reserve.some((q) => x1 > q.x0 && x0 < q.x1 && z1 > q.z0 && z0 < q.z1);
  function grid(x0, x1, z0, z1, hf, o = {}) {
    const bw = o.bw ?? 2.6, bd = o.bd ?? 2.3, sw = o.sw ?? 0.9;
    for (let x = x0; x + bw <= x1 + 0.01; x += bw + sw) for (let z = z0; z + bd <= z1 + 0.01; z += bd + sw) {
      const cx = x + bw / 2, cz = z + bd / 2, dist = Math.hypot(cx, cz + 4);
      if (!onLand(lands, x - 0.2, z - 0.2, 0.3) || !onLand(lands, x + bw + 0.2, z + bd + 0.2, 0.3) || !onLand(lands, x - 0.2, z + bd + 0.2, 0.3) || !onLand(lands, x + bw + 0.2, z - 0.2, 0.3)) continue;
      if (reserved(x, z, x + bw, z + bd)) continue;
      if (dist > (o.maxD ?? 95)) continue;
      const farB = dist > 52;
      ground.box(x, -0.05, z, x + bw, 0, z + bd, C(farB ? COL.farSide : COL.side), { ctop: C(farB ? COL.farTop : COL.top), sides: farB ? 0 : 15 });
      if (dist < 70) pool(x - sw / 2, z - sw / 2, 0.6, 0.7);
      if (dist < 34 && r() < 0.5) { ground.bar([x - 0.12, 0, z - 0.12], [x - 0.12, 0.4, z - 0.12], 0.018, C(COL.rail)); ground.box(x - 0.15, 0.4, z - 0.15, x - 0.09, 0.44, z - 0.09, C('#ffe3ae'), { kind: KIND.glow }); }
      const g = dist < 34 ? near : far;
      if (o.park && o.park(cx, cz)) { ground.box(x + 0.1, 0, z + 0.1, x + bw - 0.1, 0.02, z + bd - 0.1, C(COL.grass), { ctop: C(COL.grassTop) }); for (let k = 0; k < 4; k++) tree(ground, x + 0.35 + r() * (bw - 0.7), z + 0.35 + r() * (bd - 0.7), r, 1.1); continue; }
      const nB = farB ? 1 : (o.nB ?? 2) + (r() < 0.4 ? 1 : 0);
      let xx = x + 0.08;
      for (let k = 0; k < nB; k++) {
        const w = k === nB - 1 ? x + bw - 0.08 - xx : (bw - 0.16) / nB * (0.8 + r() * 0.4);
        const F = Math.max(2, Math.round(hf(xx + w / 2, cz, dist)));
        if (farB && r() < 0.35) { xx += w; continue; }
        bldg(g, xx + w / 2, z + bd - 0.08, w - 0.06, farB ? bd - 0.2 : bd * (0.55 + r() * 0.35), F, { roof: !farB });
        xx += w;
      }
    }
  }
  const tallIn = (x, z, ax0, ax1, az0, az1) => x > ax0 && x < ax1 && z > az0 && z < az1;
  // Brooklyn and Queens (east). Downtown Brooklyn and Long Island City get towers; DUMBO brick warehouses by the bridge.
  grid(wx + 1.2, 64, -64, 58, (x, z) => {
    if (tallIn(x, z, 24, 35, -3, 10)) return 9 + r() * 12;                   // Downtown Brooklyn
    if (tallIn(x, z, wx, 28, -44, -24)) return 10 + r() * 9;                 // Long Island City
    if (tallIn(x, z, wx, 24.5, -13, -2)) return 4 + r() * 3;                // DUMBO
    return 2 + r() * 3 + (r() < 0.07 ? 5 : 0);
  }, { park: (x, z) => (x > 34 && x < 40 && z > 12 && z < 22) || (x > 30 && x < 34 && z > -30 && z < -24) });
  // New Jersey (west): Hoboken rows, the Jersey City waterfront towers, Bayonne beyond Liberty State Park
  grid(-64, -wx - 1.2, -64, 58, (x, z) => {
    if (tallIn(x, z, -29, -wx, -15, 13)) return 11 + r() * 14;              // Jersey City
    if (tallIn(x, z, -26, -wx, -44, -16)) return 3 + r() * 4;               // Hoboken
    return 2 + r() * 3 + (r() < 0.06 ? 5 : 0);
  }, { park: (x, z) => (x > -40 && x < -34 && z > -6 && z < 2) });
  // the waterfronts: promenade strip with lamps and trees, Brooklyn Bridge Park piers, a few Hudson piers on the Jersey side
  for (const sx of [-1, 1]) {
    const xe = sx * wx, zTo = sx > 0 ? 28 : 22;
    ground.box(sx > 0 ? xe : xe - 0.9, -0.05, -64, sx > 0 ? xe + 0.9 : xe, 0.0, zTo - 2, C(COL.prom), { ctop: C(COL.promTop) });
    ground.bar([xe + sx * 0.05, 0.12, -64], [xe + sx * 0.05, 0.12, zTo - 2], 0.012, C(COL.rail));
    for (let z = -60; z < zTo - 3; z += 2.2) { if (sx > 0 && Math.abs(z - L.b0) < 1.6) continue; tree(ground, xe + sx * 0.6, z + r() * 0.4, r, 0.9 + r() * 0.3); }
    for (let z = -58; z < zTo - 3; z += 3.3) lampDot(xe + sx * 0.25, z, 0.9);
  }
  for (const pz of [-1.2, 2.6, 6.4, 10.2, 14.0]) {                         // Brooklyn Bridge Park piers: green tops, lit edges
    ground.box(wx - 1.7, -0.14, pz - 0.55, wx, -0.03, pz + 0.55, C(COL.pier), { ctop: C('#3a7a62') });
    for (let x = wx - 1.6; x < wx; x += 0.5) ground.bar([x, -0.9, pz + 0.53], [x, -0.12, pz + 0.53], 0.04, C(COL.pile));
    pool(wx - 0.85, pz, 0.8, 0.6);
  }
  for (const pz of [-30, -22.5, -15]) {                                     // Hoboken piers
    ground.box(-wx, -0.14, pz - 0.45, -wx + 1.9, -0.03, pz + 0.45, C(COL.pier), { ctop: shade(C(COL.pier), 1.2) });
    pool(-wx + 1, pz, 0.7, 0.5);
  }
  // Liberty State Park lawn and its trees
  polyPrism(ground, rrect(-wx - 8.0, 26.5, -wx - 0.6, 40, 2.5, 4), -0.05, -0.02, C(COL.grassTop), C(COL.grass), C(COL.grass), { walls: false });
  for (let k = 0; k < 40; k++) tree(ground, -wx - 7.5 + r() * 6.5, 27 + r() * 12.5, r, 1.1 + r() * 0.4, r() < 0.15);
  // Red Hook: low warehouses and a container quay along the bay
  for (let z = 30; z < 56; z += 3.1) for (let x = wx + 10; x < 44; x += 3.6) { if (!onLand(lands, x, z, 1)) continue; bldg(far, x + 1.3, z + 1.1, 2.4, 1.8, 2 + Math.round(r() * 2), { roof: true }); }

  /* ---------------------------------------------------------------- the islands in the water */
  {
    // Governors Island: lawns, Fort Jay (a low star fort), a few brick barracks, lamps on the promenade
    const gx = 7.6, gz = 26;
    polyPrism(ground, rrect(4.9, 23.7, 10.3, 28.3, 1.9, 4), 0, 0.02, C(COL.grassTop), C(COL.grass), C(COL.grass), { walls: false });
    for (const rot of [0, Math.PI / 4]) polyPrism(ground, ellipse(gx + 0.6, gz - 0.4, 1.0, 1.0, 4, rot), 0.02, 0.2, C('#8a7660'), C('#a68e72'), C('#8a7660'));
    for (const [bx, bz] of [[5.8, 24.6], [6.6, 27.4], [9.4, 27.3]]) { ground.box(bx - 0.5, 0, bz - 0.22, bx + 0.5, 0.3, bz + 0.22, C('#9a5e4c'), { win: true, ctop: C('#4a4f60') }); rects.push({ x: bx, z: bz, w: 1.1, d: 0.5, h: 0.35 }); }
    for (let k = 0; k < 26; k++) { const x = 5.2 + r() * 4.8, z = 24 + r() * 4; if (Math.hypot(x - gx - 0.6, z - gz + 0.4) < 1.3) continue; tree(ground, x, z, r, 0.9 + r() * 0.3, r() < 0.2); }
    for (const [x, z] of rrect(5.2, 24.0, 10.0, 28.0, 1.6, 2)) pool(x, z, 0.6, 0.5);
    // Liberty Island: the star fort, the granite pedestal and the copper-green figure with its torch (a silhouette, no face)
    const lx = -12.6, lz = 33;
    for (const rot of [0, Math.PI / 4]) polyPrism(ground, ellipse(lx, lz, 0.85, 0.85, 4, rot), 0, 0.14, C('#9d9282'), C('#b0a594'), C('#9d9282'));
    ground.box(lx - 0.24, 0.14, lz - 0.24, lx + 0.24, 0.78, lz + 0.24, C('#c4b8a6'), { ctop: C('#a89c8a') });
    ground.box(lx - 0.28, 0.72, lz - 0.28, lx + 0.28, 0.8, lz + 0.28, C('#d2c6b2'));
    ground.cyl(lx, lz, 0.8, 1.42, 0.13, 0.07, 7, C('#5fa38d'));
    ground.cyl(lx, lz, 1.42, 1.56, 0.075, 0.03, 7, C('#6db39a'));
    ground.bar([lx + 0.04, 1.3, lz], [lx + 0.14, 1.72, lz], 0.04, C('#5fa38d'));
    ground.sphere(lx + 0.15, 1.77, lz, 0.05, 8, 6, C('#ffcf7a'), { kind: KIND.glow });
    pool(lx, lz, 1.1, 0.8);
    rects.push({ x: lx, z: lz, w: 0.9, d: 0.9, h: 1.85 });
    // Roosevelt Island: a narrow strip of mid-rises in the East River
    for (let z = -68; z < -40; z += 2.2) bldg(far, 15.1, z + 0.8, 1.2, 1.4, 3 + Math.round(r() * 7));
    // Staten Island: a long low hill far to the south
    ground.frustum(-25, 145, -0.05, 2.2, 70, 40, 30, 14, C('#18294a'));
  }

  /* ---------------------------------------------------------------- far silhouettes beyond the grids (hazy, cheap) */
  for (let k = 0; k < 90; k++) {
    const a = r() * TAU, d = 78 + r() * 70, x = Math.cos(a) * d, z = Math.sin(a) * d - 10;
    if (!onLand(lands, x, z, 2) || (Math.abs(x) < HW + 2 && z > -100)) continue;
    const w = 1.6 + r() * 2.4, F = 4 + Math.round(r() * (z < -40 ? 16 : 8));
    fillerBuilding(far, x, z, w, w * (0.8 + r() * 0.4), F, r, { dim: 0.6, id: bid++ });
  }
  return { ground, near, far, pools, rects, waterPolys, lands };
}

/* ---------------------------------------------------------------- one big harbour: the water everywhere, foam on every shore */
const W_VERT = /* glsl */`
varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const W_FRAG = /* glsl */`
varying vec3 vW;
uniform vec3 uHor, uTop, uDeep, uDisc, uDiscCol, uWarm;
uniform float uTime, uGlow, uDayAmt;
uniform vec4 uLand[10];
uniform float uLandR[10];
#include <fog_pars_fragment>
float sdRB(vec2 p, vec4 b, float r) { vec2 c = (b.xy + b.zw) * 0.5, h = (b.zw - b.xy) * 0.5 - r; vec2 q = abs(p - c) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec2 p = vW.xz; float t = uTime;
  vec2 g = vec2(cos(p.x * 1.9 + t * 0.8) * 0.05 + cos(p.x * 5.3 - t * 1.3 + p.y * 2.0) * 0.05, cos(p.y * 2.3 - t * 0.9) * 0.05 + cos(p.y * 6.1 + t * 1.5 + p.x) * 0.045);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 sky = mix(uHor, uTop, 0.35);
  vec3 col = mix(uDeep, sky, 0.14 + 0.5 * fres);
  vec3 R = reflect(-V, n);
  // a soft moon / sun path on the water (the sharp glints are kept small: from some angles they cover a lot of river)
  float sd = max(dot(R, uDisc), 0.0);
  float spec = pow(sd, 320.0) * 0.12 + pow(sd, 60.0) * 0.03 + pow(sd, 18.0) * 0.022 * (1.0 - uDayAmt);
  col += uDiscCol * spec * (1.0 - uDayAmt * 0.5);
  float rip = smoothstep(0.82, 1.0, sin(p.y * 9.0 + sin(p.x * 3.0 + t * 0.5) * 1.6 + t * 0.9) * 0.5 + 0.5) * 0.5 + smoothstep(0.88, 1.0, sin((p.y + p.x * 0.4) * 17.0 - t * 1.4) * 0.5 + 0.5) * 0.35;
  col += mix(uHor, vec3(1.0), 0.3) * rip * (0.03 + 0.03 * (1.0 - uGlow * 0.5));
  float dEdge = 1e3;
  for (int i = 0; i < 10; i++) dEdge = min(dEdge, sdRB(p, uLand[i], uLandR[i]));
  dEdge = dEdge < -0.2 ? 40.0 : max(dEdge, 0.0);              // inland water (the Reservoir, ponds): no sea foam, no bank glow
  float stream = 0.5 + 0.5 * sin(p.y * 8.0 + t * 0.7 + p.x * 3.0);
  float streamX = 0.5 + 0.5 * sin(p.x * 8.0 - t * 0.6 + p.y * 3.0);
  col += uWarm * exp(-dEdge * 1.4) * (0.05 + 0.09 * mix(stream, streamX, 0.5)) * uGlow;
  float foam = smoothstep(0.1, 0.0, dEdge + (stream - 0.5) * 0.03);
  col += vec3(0.8, 0.88, 1.0) * foam * 0.22;
  // the open harbour is a little deeper and calmer than the rivers
  col *= 1.0 - 0.12 * smoothstep(6.0, 30.0, dEdge);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function createHarbour(lands, extra = []) {
  const pos = [], y = -0.5, S = 320;
  pos.push(-S, y, S, S, y, S, S, y, -S, -S, y, S, S, y, -S, -S, y, -S);
  // inland water (the Reservoir, ponds) sits just above the park lawn
  for (const p of extra) {
    let cx = 0, cz = 0; for (const q of p) { cx += q[0]; cz += q[1]; } cx /= p.length; cz /= p.length;
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; pos.push(cx, 0.042, cz, b[0], 0.042, b[1], a[0], 0.042, a[1]); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const land = Array.from({ length: 10 }, (_, i) => { const m = lands[i]; return m ? new THREE.Vector4(m.x0, m.z0, m.x1, m.z1) : new THREE.Vector4(1e4, 1e4, 1e4 + 1, 1e4 + 1); });
  const landR = Array.from({ length: 10 }, (_, i) => (lands[i] ? lands[i].r : 0.1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: W_VERT, fragmentShader: W_FRAG, fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uHor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uDeep: { value: new THREE.Color(0x0b2550) }, uDisc: { value: new THREE.Vector3(0, 0.5, -1) },
      uDiscCol: { value: new THREE.Color() }, uWarm: { value: new THREE.Color(1.0, 0.74, 0.42) }, uTime: { value: 0 }, uGlow: { value: 1 }, uDayAmt: { value: 0 },
      uLand: { value: land }, uLandR: { value: landR },
    }]),
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'water';
  return mesh;
}
