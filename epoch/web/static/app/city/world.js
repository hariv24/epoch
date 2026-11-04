// city/world.js · everything that is not a day: the street grid, sidewalks, waterfront, the island's slab, Hudson piers,
// Brooklyn and New Jersey shores, background blocks, the far skyline and the water.
// All static; built once. Streets are long avenues (north-south) and cross streets (east-west), a week per block row.
// The hero block (the user's four weeks) is paved in warm stone with a thin gold inlay so it reads as "mine"; the rest of
// Manhattan is cooler, darker and calmer so it frames the hero without competing.
import * as THREE from 'three';
import { Geo, rng, rgb, shade, mixc, jitter, pick, KIND, TAU, clamp, smooth } from './util.js';
import { LOT_W, LOT_D, fillerBuilding, tree, waterTank } from './towers.js';
import { buildIcon } from './skyline.js';

export function makeLayout(mode) {
  const rows = mode === 'city' ? 4 : 1;
  const L = { mode, rows, PZ: 3.3, SW: 0.25, ST: 1.0, AV: 1.5, HW: mode === 'city' ? 12.4 : 9.6, waterW: mode === 'city' ? 5.4 : 4.6, shoreW: 2.6, backRows: 3, blockHW: 3.5 * LOT_W };
  L.rowZ = Array.from({ length: rows }, (_, r) => (r - (rows - 1) / 2) * L.PZ);
  L.b0 = L.rowZ[0] - L.PZ / 2;                               // cross street behind the oldest week
  L.bN = L.rowZ[rows - 1] + L.PZ / 2;                        // cross street in front of this week
  L.zBack = L.b0 - L.backRows * L.PZ;
  L.zFront = L.bN + L.ST / 2 + L.SW + 3.2;
  L.X0 = L.HW + L.waterW + L.shoreW;
  L.zEnd = L.zBack - 80;                                     // the world carries on behind, hazy and dark
  L.tipZ = L.zFront + 3.2;                                   // city: the Battery, Manhattan's rounded southern tip (surround.js)
  L.lotX = (c) => (c - 3) * LOT_W;
  L.lotZ = (r) => L.rowZ[r];
  const s = mode === 'city' ? 1 : 0.74;
  const rc = L.HW + L.waterW / 2;                            // middle of the East River
  L.plots = mode === 'city' ? [
    { name: 'ML/DL', x: 9.4, z: L.rowZ[1], scale: 1.12, rot: -0.12 },
    { name: 'Writing/X', x: 9.4, z: L.rowZ[2], scale: 1.0, rot: -0.2 },
    { name: 'Math', x: -9.4, z: L.rowZ[1], scale: 1.0, rot: 0.1 },
    { name: 'Papers', x: -9.4, z: L.rowZ[2], scale: 1.0, rot: 0.15 },
    { name: 'Python', x: rc, z: L.b0 - 0.1, scale: 1.18, rot: 0, bridge: true },
  ] : [
    { name: 'Papers', x: -6.0, z: L.rowZ[0] - L.PZ, scale: s, rot: 0.1 },
    { name: 'Math', x: -3.0, z: L.rowZ[0] - L.PZ, scale: s, rot: 0.05 },
    { name: 'ML/DL', x: 0.1, z: L.rowZ[0] - L.PZ, scale: s * 1.12, rot: 0 },
    { name: 'Writing/X', x: 3.2, z: L.rowZ[0] - L.PZ, scale: s, rot: -0.05 },
    { name: 'Python', x: rc, z: L.b0 - 0.1, scale: 0.92, rot: 0, bridge: true },
  ];
  // skyline icons (always there, not tied to progress): name, x, front z, scale. Reserved lots are kept clear of fillers.
  L.icons = mode === 'city' ? [
    { name: 'chrysler', x: -8.9, z: L.rowZ[0] - 0.9 + 0.9, s: 1.0 },
    { name: 'flatiron', x: -5.9, z: L.b0 + 0.28, s: 1.0, wedge: true },
    { name: 'wtc', x: 8.9, z: L.rowZ[0] + 0.9, s: 1.0 },
    { name: 'pencil', x: -3.5, z: L.b0 - L.PZ + 0.9, s: 1.0 },
    { name: 'bofa', x: 3.4, z: L.b0 - L.PZ + 0.9, s: 1.0 },
  ] : [
    { name: 'chrysler', x: -8.3, z: L.rowZ[0] - 1.2, s: 0.8 },
    { name: 'wtc', x: 8.2, z: L.rowZ[0] - 1.6, s: 0.8 },
  ];
  return L;
}

// Morningside: blue-slate asphalt and sidewalks, a limestone hero block with a Columbia-blue inlay (the path to today)
const COL = {
  road: '#1d2a42', lane: '#d8c9a6', white: '#c3cfe0', coolSide: '#3a5078', coolTop: '#46608a', flankSide: '#34496f', flankTop: '#40577f',
  heroSide: '#8f877a', heroTop: '#b3a996', gold: '#8CC4EE', grass: '#2f7a66', shore: '#3c5680',
};

// box whose four side faces fade from cTop to cBot
function boxGrad(g, x0, x1, y0, y1, z0, z1, cTop, cBot, cTopFace, sides = 15) {
  const t = rgb(cTop), b = rgb(cBot);
  if (sides & 1) g.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [b, b, t, t]);
  if (sides & 2) g.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [b, b, t, t]);
  if (sides & 4) g.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [b, b, t, t]);
  if (sides & 8) g.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [b, b, t, t]);
  if (cTopFace) g.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], rgb(cTopFace));
}

function lamp(g, pools, x, z, face = 0, warm = '#ffdda6', k = 1) {
  const dark = rgb('#1b2a44');
  g.bar([x, 0, z], [x, 0.5, z], 0.022, dark);
  if (face) g.bar([x, 0.5, z], [x + face * 0.09, 0.53, z], 0.016, dark);
  g.sphere(x + face * 0.09, 0.56, z, 0.045, 8, 6, rgb(warm), { kind: KIND.glow });
  pools.push([x + face * 0.09, z, 0.8, k]);
}

function crosswalk(g, x0, x1, z0, z1, alongX) {
  const c = rgb(COL.white), y = -0.046;
  if (alongX) { for (let x = x0 + 0.06; x < x1 - 0.04; x += 0.16) g.box(x, -0.05, z0, x + 0.08, y + 0.003, z1, c, { sides: 0 }); }
  else { for (let z = z0 + 0.06; z < z1 - 0.04; z += 0.16) g.box(x0, -0.05, z, x1, y + 0.003, z + 0.08, c, { sides: 0 }); }
}

/** The static ground: roads, raised sidewalk blocks, markings, lamps, trees, promenade, plaza park, piers. */
export function buildGround(L) {
  const g = new Geo(), pools = [], r = rng(2024);
  const roadC = rgb(COL.road), HW = L.HW, bw = L.blockHW + L.SW;
  const zF = L.zFront, zB = L.zBack;
  // road level slab under everything
  g.box(-HW, -0.5, zB, HW, -0.05, zF, roadC, { ctop: roadC, sides: 0 });
  const rowsAll = [];
  for (let k = -L.backRows; k < L.rows; k++) rowsAll.push({ k, z: (k - (L.rows - 1) / 2) * L.PZ, hero: k >= 0 });
  const avE = 5.5 + L.AV, flankX0 = avE;                     // flank blocks start after the avenue
  for (const row of rowsAll) {
    const z = row.z, za = z - 0.9 - L.SW, zb = z + 0.9 + L.SW;
    if (row.hero) {
      // the hero block: warm stone, a light curb and a thin gold inlay line
      g.box(-bw, -0.05, za, bw, 0, zb, rgb(COL.heroSide), { ctop: rgb(COL.heroTop) });
      const gold = rgb(COL.gold), i0 = 0.1, w = 0.035;
      g.box(-bw + i0, 0, za + i0, bw - i0, 0.006, za + i0 + w, gold, { kind: KIND.inlay, sides: 0 });
      g.box(-bw + i0, 0, zb - i0 - w, bw - i0, 0.006, zb - i0, gold, { kind: KIND.inlay, sides: 0 });
      g.box(-bw + i0, 0, za + i0, -bw + i0 + w, 0.006, zb - i0, gold, { kind: KIND.inlay, sides: 0 });
      g.box(bw - i0 - w, 0, za + i0, bw - i0, 0.006, zb - i0, gold, { kind: KIND.inlay, sides: 0 });
    } else g.box(-bw, -0.05, za, bw, 0, zb, rgb(COL.coolSide), { ctop: rgb(COL.coolTop) });
    for (const sx of [-1, 1]) {
      const xa = sx > 0 ? flankX0 : -HW, xb = sx > 0 ? HW : -flankX0;
      g.box(xa, -0.05, za, xb, 0, zb, rgb(COL.flankSide), { ctop: rgb(COL.flankTop) });
    }
  }
  // lane markings on the avenues and cross streets
  const yellow = rgb(COL.lane), white = rgb(COL.white), yl = -0.046;
  for (const sx of [-1, 1]) {
    const ax = sx * (5.5 + L.AV / 2);
    for (let z = zB + 0.3; z < zF - 0.4; z += 0.42) g.box(ax - 0.012, -0.05, z, ax + 0.012, yl, z + 0.22, yellow, { sides: 0 });
  }
  const streets = []; for (let k = 0; k <= L.rows + L.backRows; k++) streets.push(L.b0 - L.backRows * L.PZ + k * L.PZ);
  for (const sz of streets) {
    for (let x = -HW + 0.3; x < HW - 0.4; x += 0.42) {
      if (Math.abs(Math.abs(x) - (5.5 + L.AV / 2)) < 0.8) continue;
      g.box(x, -0.05, sz - 0.012, x + 0.22, yl, sz + 0.012, white, { sides: 0 });
    }
    for (const sx of [-1, 1]) {
      const a0 = sx > 0 ? 5.5 : -5.5 - L.AV, a1 = a0 + L.AV;
      crosswalk(g, a0 + 0.04, a1 - 0.04, sz - L.ST / 2 + 0.02, sz - L.ST / 2 + 0.16, true);
      crosswalk(g, a0 + 0.04, a1 - 0.04, sz + L.ST / 2 - 0.16, sz + L.ST / 2 - 0.02, true);
    }
  }
  // street lamps along the avenues and the promenade (the hero side is a little warmer)
  for (const sx of [-1, 1]) {
    for (let z = zB + 1.0; z < L.bN + 0.5; z += 1.65) { lamp(g, pools, sx * 5.38, z, sx > 0 ? 1 : -1, z > L.b0 ? '#ffd8a0' : '#ffe3ae', z > L.b0 ? 1 : 0.7); lamp(g, pools, sx * (5.5 + L.AV + 0.1), z + 0.8, sx > 0 ? -1 : 1, '#ffe3ae', 0.7); }
    for (let z = zB + 1.2; z < zF - 3.2; z += 2.4) lamp(g, pools, sx * (HW - 0.18), z, sx > 0 ? -1 : 1, '#ffe3ae', 0.7);
    // railing along the waterfront
    g.bar([sx * HW - sx * 0.04, 0.12, zB + 0.2], [sx * HW - sx * 0.04, 0.12, zF - 3.4], 0.012, rgb('#1b2a44'));
    for (let z = zB + 0.2; z < zF - 3.3; z += 0.7) g.bar([sx * HW - sx * 0.04, 0, z], [sx * HW - sx * 0.04, 0.13, z], 0.014, rgb('#1b2a44'));
    // trees on the waterfront promenade
    for (let z = zB + 1.6; z < zF - 3.6; z += 1.7) tree(g, sx * (HW - 0.45), z + (r() - 0.5) * 0.3, r, 0.8 + r() * 0.3, r() < 0.12);
  }
  // cross-street corner lamps
  for (const sz of streets.slice(0, L.rows + L.backRows + 1)) for (const sx of [-1, 1]) { lamp(g, pools, sx * 5.38, sz + 0.62, sx > 0 ? 1 : -1, '#ffe3ae', 0.8); }
  // subway entrance with green globes (a New York signature)
  const sbx = 5.3, sbz = L.bN - 0.4;
  g.box(sbx - 0.2, 0, sbz - 0.12, sbx + 0.12, 0.09, sbz + 0.12, rgb('#2e4266'));
  for (const dz of [-0.14, 0.14]) { g.bar([sbx - 0.2, 0, sbz + dz], [sbx - 0.2, 0.3, sbz + dz], 0.018, rgb('#1b2a44')); g.sphere(sbx - 0.2, 0.33, sbz + dz, 0.04, 8, 6, rgb('#5ee0a0'), { kind: KIND.glow }); }

  // front plaza: park with lawns, paths and a fountain
  const pz0 = L.bN + L.ST / 2 + L.SW, pz1 = zF;
  g.box(-HW, -0.05, L.bN + L.ST / 2, HW, 0, pz1, rgb(COL.heroSide), { ctop: rgb(COL.heroTop) });
  g.box(-HW + 0.5, 0, pz0 + 0.18, HW - 0.5, 0.02, pz1 - 0.4, rgb(COL.grass), { ctop: rgb('#348270') });
  const pc = rgb('#d6ccb8');
  g.box(-HW + 0.5, 0.02, (pz0 + pz1) / 2 - 0.2, HW - 0.5, 0.026, (pz0 + pz1) / 2 + 0.2, pc, { sides: 0 });
  for (const x of [-7.5, -3, 3, 7.5]) if (Math.abs(x) < HW - 0.8) g.box(x - 0.2, 0.02, pz0 + 0.18, x + 0.2, 0.026, pz1 - 0.4, pc, { sides: 0 });
  const fx = 0, fz = (pz0 + pz1) / 2;
  g.cyl(fx, fz, 0.02, 0.1, 0.62, 0.62, 14, rgb('#c9c0ae')); g.cyl(fx, fz, 0.09, 0.115, 0.52, 0.52, 14, rgb('#4f8fcb'), { ctop: rgb('#8CC4EE') });
  g.cyl(fx, fz, 0.1, 0.34, 0.07, 0.07, 8, rgb('#d9d0be')); g.cyl(fx, fz, 0.34, 0.4, 0.2, 0.14, 10, rgb('#d9d0be'));
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    const x = fx + sx * (1.5 + k * 1.9), z = pz0 + 0.5 + (k % 2) * 1.4;
    if (Math.abs(x) < HW - 0.8) { tree(g, x, z, r, 1.05 + r() * 0.4, r() < 0.2); tree(g, x + sx * 0.9, pz1 - 0.9 - (k % 2) * 0.5, r, 0.9 + r() * 0.3); }
  }
  for (const sx of [-1, 1]) {
    g.box(sx * 1.4 - 0.2, 0.02, fz + 0.65, sx * 1.4 + 0.2, 0.07, fz + 0.76, rgb('#7a5a46')); g.box(sx * 1.4 - 0.2, 0.07, fz + 0.76, sx * 1.4 + 0.2, 0.14, fz + 0.79, rgb('#7a5a46'));
    lamp(g, pools, sx * 2.3, fz - 0.55, 0); lamp(g, pools, sx * 5.2, fz + 0.55, 0);
  }
  // Hudson piers on the west edge (west = left)
  const wood = rgb('#5e6070'), pile = rgb('#22304a');
  for (const pzz of (L.mode === 'city' ? [-5.2, -0.3, 4.6] : [-1.6, 3.2])) {
    g.box(-HW - 2.7, -0.2, pzz - 0.42, -HW, -0.07, pzz + 0.42, wood, { ctop: shade(wood, 1.2) });
    for (let x = -HW - 2.6; x < -HW; x += 0.55) for (const dz of [-0.4, 0.4]) g.bar([x, -0.95, pzz + dz], [x, -0.2, pzz + dz], 0.045, pile);
    lamp(g, pools, -HW - 2.55, pzz - 0.3, 0, '#ffe3ae', 0.6); lamp(g, pools, -HW - 0.3, pzz + 0.3, 0, '#ffe3ae', 0.6);
  }
  g.box(-HW - 1.8, -0.07, (L.mode === 'city' ? -0.3 : 3.2) - 0.3, -HW - 0.9, 0.18, (L.mode === 'city' ? -0.3 : 3.2) + 0.3, rgb('#a9b3c6'), { win: true }); // pier shed
  return { geo: g, pools };
}

/** Island body (rock and seawall), water body walls, east and west shores, far land. */
export function buildSlab(L) {
  const g = new Geo(), HW = L.HW, X0 = L.X0, zB = L.zEnd, zF = L.zFront, wx = L.HW + L.waterW;
  const y0 = -3.4;
  boxGrad(g, -HW, HW, y0, -0.05, zB, zF, '#6a7fa6', '#0a1a38', null, 15);
  if (L.mode === 'city') {                                   // the 360 city: shores, the harbour and the far land come from surround.js
    g.quad([-HW, -0.05, L.zBack - 0.01], [HW, -0.05, L.zBack - 0.01], [HW, -0.05, zB], [-HW, -0.05, zB], rgb(COL.road));
    return g;
  }
  for (const sx of [-1, 1]) {
    const a = sx > 0 ? HW : -wx, b = sx > 0 ? wx : -HW;
    boxGrad(g, a, b, y0, -0.5, zB, zF, '#2f639b', '#06142e', null, 3);
    const s0 = sx > 0 ? wx : -X0, s1 = sx > 0 ? X0 : -wx;
    boxGrad(g, s0, s1, y0, 0, zB, zF, '#6a7fa6', '#0a1a38', COL.shore, 15);
  }
  g.box(-X0 - 0.15, y0 - 0.25, zB - 0.15, X0 + 0.15, y0, zF + 0.15, rgb('#081a33'), { top: false });
  g.quad([-HW, -0.05, L.zBack - 0.01], [HW, -0.05, L.zBack - 0.01], [HW, -0.05, zB], [-HW, -0.05, zB], rgb('#17284a'));
  // the island's far end and the land beyond both shores: a plain dark plate, the hazy "rest of the city"
  const lw = 140;
  for (const sx of [-1, 1]) { g.box(sx > 0 ? X0 : -X0 - lw, -3.4, zB, sx > 0 ? X0 + lw : -X0, 0, zF, rgb('#17284a'), { ctop: rgb('#1d3157'), sides: 0 }); }
  return g;
}

// reserved rectangles: landmark plots and skyline icons keep the filler blocks away
function reserved(L) {
  const R = [];
  for (const p of L.plots) if (!p.bridge) R.push({ x0: p.x - 1.7, x1: p.x + 1.7, z0: p.z - 1.1, z1: p.z + 1.1 });
  // (the 360 city keeps only the icons' real footprint clear, so the blocks behind them are built up when seen from above)
  for (const ic of L.icons) { const w = ic.wedge ? 1.7 : 1.9; R.push({ x0: ic.x - w / 2, x1: ic.x + w / 2, z0: ic.z - (L.mode === 'city' ? 1.55 : 2.0), z1: ic.z + (L.mode === 'city' ? -0.12 : 0.1) }); }
  // the bridge approach follows the cross street behind the oldest week
  R.push({ x0: L.HW - 4.6, x1: L.X0 + 1, z0: L.b0 - 1.6, z1: L.b0 + 1.6 });
  return R;
}

/** Shore blocks (Brooklyn east, New Jersey west), and the rest of Manhattan behind and beside the lots. Returns shadow rectangles too. */
export function buildFillers(L) {
  const g = new Geo(), r = rng(77), shadows = [];
  const R = reserved(L);
  const rowsAll = []; for (let k = -L.backRows; k < L.rows; k++) rowsAll.push({ k, z: (k - (L.rows - 1) / 2) * L.PZ });
  const hit = (x0, x1, z0, z1) => R.some((q) => x1 > q.x0 && x0 < q.x1 && z1 > q.z0 && z0 < q.z1);
  const dimAt = (x, z) => 1.0 - 0.32 * smooth(clamp(Math.hypot(x / 15, (z + 1) / 13) - 0.35, 0, 1));
  let bid = 1;
  const put = (x, front, w, d, F) => { const cz = front - d / 2; if (hit(x - w / 2, x + w / 2, cz - d / 2, front)) return; fillerBuilding(g, x, front, w, d, F, r, { dim: dimAt(x, cz), id: bid++, rim: L.mode === 'city' }); shadows.push({ x, z: cz, w, d, h: F * 0.4 }); };
  const run = (xa, xb, row, hf, maxW = 1.7) => {
    let x = xa;
    while (x < xb - 0.6) {
      let w = 1.0 + r() * (maxW - 1.0); if (xb - (x + w) < 0.9) w = xb - x;
      const x0 = x, x1 = x + w, d = 1.35 + r() * 0.35, F = Math.max(2, Math.round(hf(x + w / 2, row.z, r)));
      x += w;
      put((x0 + x1) / 2, row.z + LOT_D / 2 - 0.02, w - 0.04, d, F);
    }
  };
  const avE = 5.5 + L.AV;
  for (const row of rowsAll) {
    const back = row.k < 0, depth = Math.max(0, L.b0 - row.z);
    const hc = (x, z) => (back ? 2.6 + depth * 0.36 + r() * (2 + depth * 0.25) * Math.exp(-Math.abs(x) / 9) + r() * 1.2 : 2.5 + r() * 2.2);
    if (back) run(-L.blockHW, L.blockHW, row, hc);
    run(avE + 0.05, L.HW - 0.75, row, (x, z) => (back ? 2.6 + depth * 0.3 + r() * 3 : 2 + r() * 2.6), 1.5);
    run(-L.HW + 0.75, -avE - 0.05, row, (x, z) => (back ? 2.6 + depth * 0.3 + r() * 3 : 2 + r() * 2.6), 1.5);
  }
  // shores: Brooklyn (low brick warehouses) east, New Jersey (taller towers) west (the 360 city builds its own, surround.js)
  for (const sx of (L.mode === 'city' ? [] : [-1, 1])) {
    const xa = sx > 0 ? L.HW + L.waterW + 0.2 : -L.X0 + 0.2, xb = sx > 0 ? L.X0 - 0.2 : -(L.HW + L.waterW) - 0.2;
    for (let z = L.zBack + 1.0; z < L.zFront - 3.0; z += 1.9) {
      if (hit(Math.min(xa, xb), Math.max(xa, xb), z - 0.2, z + 1.2)) continue;
      const F = 2 + Math.floor(r() * (sx > 0 ? 3 : 6) + (r() < 0.12 ? 5 : 0));
      const w = Math.abs(xb - xa) * (0.6 + r() * 0.3), cx = sx > 0 ? xa + w / 2 + r() * 0.3 : xb - w / 2 - r() * 0.3;
      fillerBuilding(g, cx, z + 0.6, w, 1.2, F, r, { dim: 0.78, id: bid++ });
      shadows.push({ x: cx, z: z + 0.6 - 0.6, w, d: 1.2, h: F * 0.4 });
    }
    for (let z = L.zBack + 2; z < L.zFront - 3; z += 2.7) tree(g, sx > 0 ? L.X0 - 0.35 : -L.X0 + 0.35, z, r, 0.9);
  }
  // skyline icons
  for (const ic of L.icons) buildIcon(g, ic.name, ic.x, ic.z, ic.s);
  return { geo: g, shadows };
}

/** The far city: a denser, taller, hazy Midtown behind the back rows and plain blocks past both shores. */
export function buildFar(L) {
  const g = new Geo(), r = rng(31);
  if (L.mode === 'city') return g;                           // the 360 city: see surround.js
  let bid = 1;
  // north: a loose grid of towers on the far land. Taller towards the centre.
  for (let zi = 0; zi < 22; zi++) {
    const z = L.zBack - 2.4 - zi * 3.4;
    for (let x = -L.HW + 0.8; x < L.HW - 0.8; x += 2.4 + r() * 1.0) {
      if (r() < 0.14) continue;
      const w = 1.4 + r() * 1.5, d = 1.4 + r() * 1.5, mid = Math.exp(-Math.abs(x) / 11), F = Math.round(6 + r() * 9 + mid * r() * 14 + zi * 0.1);
      fillerBuilding(g, x + (r() - 0.5) * 0.4, z, w, d, F, r, { dim: 0.72, id: bid++ });
    }
  }
  // beyond the rivers: both shores carry on
  for (const sx of [-1, 1]) for (let zi = 0; zi < 24; zi++) {
    const z = L.zFront - 6 - zi * 3.6;
    for (let k = 0; k < 3; k++) {
      const x = sx * (L.X0 + 3 + k * 4.2 + r() * 2.0), w = 1.6 + r() * 2, d = 1.6 + r() * 2;
      fillerBuilding(g, x, z, w, d, 3 + Math.floor(r() * (sx < 0 ? 9 : 5)), r, { dim: 0.66, id: bid++ });
    }
  }
  return g;
}

/* ---------------------------------------------------------------- water */
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
uniform float uTime, uGlow, uHW, uWX, uDayAmt;
#include <fog_pars_fragment>
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec2 p = vW.xz; float t = uTime;
  vec2 g = vec2(cos(p.x * 1.9 + t * 0.8) * 0.05 + cos(p.x * 5.3 - t * 1.3 + p.y * 2.0) * 0.05, cos(p.y * 2.3 - t * 0.9) * 0.05 + cos(p.y * 6.1 + t * 1.5 + p.x) * 0.045);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 sky = mix(uHor, uTop, 0.35);
  vec3 col = mix(uDeep, sky, 0.14 + 0.5 * fres);
  vec3 R = reflect(-V, n);
  float spec = pow(max(dot(R, uDisc), 0.0), 320.0) * 0.4 + pow(max(dot(R, uDisc), 0.0), 18.0) * 0.03 * (1.0 - uDayAmt);
  col += uDiscCol * spec * (1.0 - uDayAmt * 0.5);
  // fine ripple lines catching a little light
  float rip = smoothstep(0.82, 1.0, sin(p.y * 9.0 + sin(p.x * 3.0 + t * 0.5) * 1.6 + t * 0.9) * 0.5 + 0.5) * 0.5 + smoothstep(0.88, 1.0, sin((p.y + p.x * 0.4) * 17.0 - t * 1.4) * 0.5 + 0.5) * 0.35;
  col += mix(uHor, vec3(1.0), 0.3) * rip * (0.03 + 0.03 * (1.0 - uGlow * 0.5));
  // warm reflections of the lit banks, streaked across the water
  float dEdge = min(abs(abs(p.x) - uHW), abs(abs(p.x) - uWX));
  float stream = 0.5 + 0.5 * sin(p.y * 8.0 + t * 0.7 + p.x * 3.0);
  col += uWarm * exp(-dEdge * 1.5) * (0.05 + 0.09 * stream) * uGlow;
  // foam against the seawalls
  float foam = smoothstep(0.1, 0.0, dEdge + (stream - 0.5) * 0.03);
  col += vec3(0.8, 0.88, 1.0) * foam * 0.22;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

export function createWater(L) {
  const g = new THREE.BufferGeometry(), y = -0.5, zB = L.zEnd, zF = L.zFront, HW = L.HW, wx = L.HW + L.waterW;
  const pos = [];
  for (const [a, b] of [[HW, wx], [-wx, -HW]]) pos.push(a, y, zF, b, y, zF, b, y, zB, a, y, zF, b, y, zB, a, y, zB);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    vertexShader: W_VERT, fragmentShader: W_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uHor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uDeep: { value: new THREE.Color(0x0b2550) }, uDisc: { value: new THREE.Vector3(0, 0.5, -1) },
      uDiscCol: { value: new THREE.Color() }, uWarm: { value: new THREE.Color(1.0, 0.74, 0.42) }, uTime: { value: 0 }, uGlow: { value: 1 }, uHW: { value: HW }, uWX: { value: wx }, uDayAmt: { value: 0 },
    }]),
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'water';
  return mesh;
}
