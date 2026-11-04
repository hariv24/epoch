// city/towers.js · the architecture. Every function here only fills a Geo (merged geometry); no scene objects.
//   buildBuilding(spec)  one day's tower: bodega, brownstone, walk-up, pre-war, modern or deco, chosen from its floor count + a per-day hash
//   buildSite(spec)      the lot when there is no tower: plain plot, building site (fence), park
//   fillerBuilding(...)  cheap background buildings for the rest of Manhattan
// Floors map 1:1 to deep minutes (FLOOR_H per floor). Windows come from the shader (see shader.js), not from geometry.
import { Geo, rng, rgb, shade, tint, mixc, jitter, pick, KIND, TAU } from './util.js';
import { FLOOR_H } from './shader.js';

export const LOT_W = 1.5, LOT_D = 1.8;
const FRONT = LOT_D / 2 - 0.02;               // every building's street wall is flush on the same line

const P = {
  brown: ['#8d5c4b', '#80574a', '#9a6a56', '#845549'],
  brick: ['#b4684f', '#a65f4b', '#bf745a', '#9d5c50', '#b86d56'],
  lime: ['#e2dacb', '#d6cdbc', '#e9e2d3', '#cfc5b3'],                 // Morningside limestone
  glass: ['#5a7088', '#62788c', '#66748e', '#5c7a80', '#6c7a92'],
  deco: ['#d4c6ad', '#c9c0b0', '#ddd0b8', '#b5bfcd'],
  trim: '#ece5d6', dark: '#1b2b47', roof: '#3a4660', tank: '#9a6a46', steel: '#8fa6c6',
};
const C = (h) => rgb(h);

export function pickStyle(F, h) {
  if (F <= 1) return 'bodega';
  if (F <= 4) return h < 0.7 ? 'brownstone' : 'walkup';
  if (F <= 8) return h < 0.58 ? 'prewar' : (h < 0.86 ? 'modern' : 'walkup');
  return h < 0.56 ? 'deco' : 'modern';
}
// shader parameters per style
export const STYLE = {
  bodega: { pitch: 0.5, fill: [0.5, 0.5], glass: 0, litP: 0.8 },
  brownstone: { pitch: 0.49, fill: [0.46, 0.7], glass: 0, litP: 0.74 },
  walkup: { pitch: 0.37, fill: [0.5, 0.64], glass: 0, litP: 0.72 },
  prewar: { pitch: 0.29, fill: [0.5, 0.64], glass: 0.1, litP: 0.74 },
  modern: { pitch: 0.2, fill: [0.9, 0.58], glass: 1, litP: 0.66 },
  deco: { pitch: 0.26, fill: [0.44, 0.68], glass: 0.2, litP: 0.76 },
};

function cornice(g, x0, x1, z0, z1, y, col, o = {}) {
  const h = o.h ?? 0.06, ov = o.ov ?? 0.045;
  g.box(x0 - ov, y, z0 - ov, x1 + ov, y + h, z1 + ov, col, { ctop: shade(col, 0.55) });
  if (o.brackets) {     // little brackets under the front cornice
    const n = Math.max(3, Math.round((x1 - x0) / 0.17));
    for (let k = 0; k < n; k++) { const x = x0 + ((k + 0.5) / n) * (x1 - x0); g.box(x - 0.025, y - 0.05, z1 + 0.0, x + 0.025, y, z1 + ov * 0.9, shade(col, 0.88), { top: false }); }
  }
}
let LAST_DOOR = 0;
function door(g, cx, front, w = 0.2, h = 0.31) {
  LAST_DOOR = cx;
  g.box(cx - w / 2 - 0.035, 0, front, cx + w / 2 + 0.035, h + 0.035, front + 0.012, C(P.trim), { kind: KIND.plain });
  g.box(cx - w / 2, 0, front, cx + w / 2, h, front + 0.022, C('#2a3550'), { kind: KIND.door, top: false });
}
function awning(g, x0, x1, y, front, col, depth = 0.13, stripes = 0) {
  const n = stripes || 1, dx = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const a = x0 + k * dx, b = a + dx, cc = stripes && k % 2 ? C('#f2e8dc') : col;
    g.quad([a, y - 0.07, front + depth], [b, y - 0.07, front + depth], [b, y, front + 0.005], [a, y, front + 0.005], cc, 0, 1, KIND.plain);
  }
}
export function waterTank(g, cx, y, cz, s = 1) {
  const legs = C(P.dark), wood = C(P.tank), roof = shade(C(P.tank), 0.72);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.bar([cx + sx * 0.08 * s, y, cz + sz * 0.08 * s], [cx + sx * 0.08 * s, y + 0.15 * s, cz + sz * 0.08 * s], 0.016 * s, legs);
  g.box(cx - 0.1 * s, y + 0.15 * s, cz - 0.1 * s, cx + 0.1 * s, y + 0.165 * s, cz + 0.1 * s, legs);
  g.cyl(cx, cz, y + 0.165 * s, y + 0.37 * s, 0.105 * s, 0.1 * s, 9, wood, { ctop: wood });
  g.cyl(cx, cz, y + 0.37 * s, y + 0.47 * s, 0.115 * s, 0.0, 9, roof);
  g.cyl(cx, cz, y + 0.2 * s, y + 0.215 * s, 0.112 * s, 0.112 * s, 9, shade(C(P.steel), 0.7), { top: false });
}
export function acBox(g, x, y, z, s = 1, col = C(P.steel)) { g.box(x - 0.09 * s, y, z - 0.07 * s, x + 0.09 * s, y + 0.07 * s, z + 0.07 * s, col, { ctop: shade(col, 1.15) }); g.box(x - 0.06 * s, y + 0.07 * s, z - 0.045 * s, x + 0.06 * s, y + 0.09 * s, z + 0.045 * s, shade(col, 0.8)); }
function antenna(g, x, y, z, hgt, th = 0.016) { g.bar([x, y, z], [x, y + hgt, z], th, C('#b9cce3')); g.bar([x - 0.05, y + hgt * 0.45, z], [x + 0.05, y + hgt * 0.45, z], th * 0.7, C('#b9cce3')); }
function fireEscape(g, cx, F, front, w = 0.4) {
  const col = C(P.dark);
  for (let k = 2; k < F; k++) {
    const y = k * FLOOR_H - 0.01;
    g.box(cx - w / 2, y, front, cx + w / 2, y + 0.014, front + 0.1, col);
    g.bar([cx - w / 2, y + 0.07, front + 0.1], [cx + w / 2, y + 0.07, front + 0.1], 0.01, col);
    g.bar([cx + w / 2 - 0.05, y, front + 0.1], [cx - w / 2 + 0.05, y - FLOOR_H + 0.015, front + 0.1], 0.012, col);
  }
}
function scaffolding(g, x0, x1, front, F) {
  const hs = Math.min(F, 5) * FLOOR_H + 0.12, col = C('#a8bcd6'), wood = C('#b49a7a');
  for (let x = x0; x <= x1 + 0.001; x += (x1 - x0) / 4) g.bar([x, 0, front + 0.11], [x, hs, front + 0.11], 0.016, col);
  for (let y = 0.2; y <= hs + 0.01; y += FLOOR_H) {
    g.bar([x0, y, front + 0.11], [x1, y, front + 0.11], 0.014, col);
    g.box(x0, y, front + 0.02, x1, y + 0.012, front + 0.12, wood);
  }
  g.bar([x0, 0.0, front + 0.11], [x0 + (x1 - x0) / 2, hs * 0.9, front + 0.11], 0.012, col);
  g.bar([x1, 0.0, front + 0.11], [x0 + (x1 - x0) / 2, hs * 0.9, front + 0.11], 0.012, col);
}
function crownBelt(g, tiers, tf, col) {
  const y = tf * FLOOR_H;
  const t = tiers.find((q) => q.f0 < tf && tf <= q.f1);
  if (!t) return null;
  const e = 0.02;
  g.box(t.cx - t.w / 2 - e, y - 0.055, t.cz - t.d / 2 - e, t.cx + t.w / 2 + e, y - 0.005, t.cz + t.d / 2 + e, col, { kind: KIND.crown });
  return y;
}

// spec: {F, w, d, style, seed, target, crown, scaffold}
export function buildBuilding(spec) {
  const F = Math.max(1, spec.F | 0), style = spec.style, r = rng(spec.seed * 7919 + 13), g = new Geo();
  const w = spec.w, d = spec.d, cx = 0, cz = FRONT - d / 2, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = FRONT;
  const H = F * FLOOR_H;
  const tiers = [];                                   // {f0,f1,cx,cz,w,d}
  let top = H, roof = { cx, cz, hw: w / 2, hd: d / 2 }, aviation = null, tf = spec.target || 6;
  const trim = C(P.trim);
  const doorX = (r() < 0.5 ? -1 : 1) * (style === 'brownstone' ? 0.3 : 0.22) * (r() < 0.3 ? 0 : 1);

  if (style === 'bodega') {
    const c = jitter(C(pick(['#e4cdb4', '#d9b8b0', '#c9d3c8', '#e6d6a8'], r())), r(), 0.04);
    g.box(x0, 0, z0, x1, H, z1, c, { win: true });
    tiers.push({ f0: 0, f1: 1, cx, cz, w, d });
    const sign = C(pick(['#ff7aa8', '#5ad6c2', '#ffb458', '#8cc4ee'], r()));
    g.box(x0 + 0.1, H - 0.1, z1, x1 - 0.1, H - 0.03, z1 + 0.025, sign, { kind: KIND.glow });
    awning(g, x0 + 0.08, x1 - 0.08, 0.27, z1, C(pick(['#3c9a7a', '#c0506e', '#4a64c0'], r())), 0.16, 6);
    door(g, doorX * 0.8, z1, 0.18, 0.24);
    cornice(g, x0, x1, z0, z1, H, shade(c, 0.85), { h: 0.05, ov: 0.03 });
    top = H + 0.05; acBox(g, x0 + 0.3, top, cz - 0.1, 0.9); roof = { cx, cz, hw: w / 2 - 0.2, hd: d / 2 - 0.2 };
  } else if (style === 'brownstone' || style === 'walkup') {
    const base = style === 'brownstone' ? pick(P.brown, r()) : pick(P.brick, r());
    const c = jitter(C(base), r(), 0.05);
    g.box(x0, 0, z0, x1, H, z1, c, { win: true });
    tiers.push({ f0: 0, f1: F, cx, cz, w, d });
    if (style === 'brownstone') {
      // stoop and a bay window
      const sx = doorX;
      for (let k = 0; k < 4; k++) g.box(sx - 0.15, 0, z1, sx + 0.15, 0.035 * (4 - k) , z1 + 0.05 * (k + 1), shade(c, 1.12), { top: true });
      g.bar([sx - 0.15, 0.0, z1 + 0.2], [sx - 0.15, 0.14, z1 + 0.2], 0.012, C(P.dark)); g.bar([sx + 0.15, 0.0, z1 + 0.2], [sx + 0.15, 0.14, z1 + 0.2], 0.012, C(P.dark));
      if (F >= 3 && r() < 0.7) g.box(-sx * 0.8 - 0.25, FLOOR_H, z1, -sx * 0.8 + 0.25, (F - 1) * FLOOR_H + 0.02, z1 + 0.09, shade(c, 1.06), { win: true });
      cornice(g, x0, x1, z0, z1, H, shade(c, 1.28), { h: 0.075, ov: 0.05, brackets: true });
      top = H + 0.075; door(g, sx, z1);
    } else {
      cornice(g, x0, x1, z0, z1, H, shade(c, 1.2), { h: 0.05, ov: 0.03 });
      top = H + 0.05; door(g, doorX, z1, 0.2, 0.3);
      awning(g, doorX - 0.16, doorX + 0.16, 0.38, z1, C('#3f5a7a'), 0.1);
      if (F >= 3) fireEscape(g, -doorX * 0.9, F, z1, 0.4);
    }
    if (F >= 3 && r() < 0.5) waterTank(g, x0 + 0.3, top, cz - 0.1, 0.75);
    acBox(g, x1 - 0.3, top, cz, 0.8);
    roof = { cx, cz: cz - 0.2, hw: w / 2 - 0.25, hd: d / 2 - 0.35 };
  } else if (style === 'prewar') {
    const brick = jitter(C(pick(P.brick, r())), r(), 0.05), lime = C(pick(P.lime, r()));
    const bf = 2;
    g.box(x0 - 0.01, 0, z0, x1 + 0.01, bf * FLOOR_H, z1 + 0.012, lime, { win: true });
    g.box(x0, bf * FLOOR_H, z0, x1, H, z1, brick, { win: true });
    tiers.push({ f0: 0, f1: F, cx, cz, w, d });
    g.box(x0 - 0.02, bf * FLOOR_H, z1, x1 + 0.02, bf * FLOOR_H + 0.03, z1 + 0.022, trim, { top: true });   // string course
    // corner quoins
    for (const sx of [x0 - 0.0, x1 - 0.06]) for (let k = bf; k < F; k++) if (k % 2 === 0) g.box(sx, k * FLOOR_H + 0.01, z1, sx + 0.06, (k + 1) * FLOOR_H - 0.01, z1 + 0.012, lime, { top: false });
    cornice(g, x0, x1, z0, z1, H, trim, { h: 0.07, ov: 0.055, brackets: true });
    top = H + 0.07;
    door(g, doorX * 0.6, z1, 0.22, 0.33); awning(g, doorX * 0.6 - 0.2, doorX * 0.6 + 0.2, 0.42, z1, C('#2f6a58'), 0.14);
    if (F >= 4 && r() < 0.55) fireEscape(g, -doorX * 0.9 + 0.1, F, z1 + 0.012, 0.42);
    if (r() < 0.8) waterTank(g, x0 + 0.34, top, cz - 0.12, 0.9);
    acBox(g, x1 - 0.32, top, cz + 0.05, 0.85); g.box(cx - 0.12, top, cz - 0.38, cx + 0.12, top + 0.13, cz - 0.16, shade(brick, 0.9));
    roof = { cx, cz: cz + 0.2, hw: w / 2 - 0.3, hd: 0.2 };
  } else if (style === 'modern') {
    const glass = jitter(C(pick(P.glass, r())), r(), 0.06), stone = C('#a3b0c6');
    const split = F > 8 ? Math.round(F * 0.78) : F, narrow = F > 8;
    g.box(x0, 0, z0, x1, split * FLOOR_H, z1, glass, { win: true });
    tiers.push({ f0: 0, f1: split, cx, cz, w, d });
    g.box(x0 - 0.012, 0, z1, x1 + 0.012, FLOOR_H * 0.98, z1 + 0.015, shade(stone, 0.75), { top: false });
    for (let k = 3; k < split; k += 3) g.box(x0 - 0.012, k * FLOOR_H - 0.03, z0 - 0.012, x1 + 0.012, k * FLOOR_H + 0.015, z1 + 0.012, stone, { top: false });
    if (narrow) {
      const w2 = w * 0.7, d2 = d * 0.7, cz2 = cz - 0.1;
      g.box(cx - w2 / 2, split * FLOOR_H, cz2 - d2 / 2, cx + w2 / 2, H, cz2 + d2 / 2, shade(glass, 1.08), { win: true });
      tiers.push({ f0: split, f1: F, cx, cz: cz2, w: w2, d: d2 });
      g.box(x0 - 0.02, split * FLOOR_H, z0 - 0.02, x1 + 0.02, split * FLOOR_H + 0.035, z1 + 0.02, stone, { ctop: shade(stone, 0.6) });
      roof = { cx, cz: cz2, hw: w2 / 2 - 0.1, hd: d2 / 2 - 0.1 };
      g.frustum(cx, cz2, H, H + 0.2, w2, d2, w2 * 0.55, d2 * 0.55, shade(glass, 1.25));
      top = H + 0.2; if (F >= 11) { antenna(g, cx, top, cz2, 0.5 + (F - 11) * 0.06); aviation = { x: cx, y: top + 0.5 + (F - 11) * 0.06, z: cz2 }; top += 0.2; }
    } else {
      g.box(x0 - 0.02, H, z0 - 0.02, x1 + 0.02, H + 0.05, z1 + 0.02, stone, { ctop: shade(stone, 0.55) });
      top = H + 0.05; g.box(cx - 0.25, top, cz - 0.2, cx + 0.3, top + 0.12, cz + 0.1, shade(glass, 0.8)); acBox(g, cx - 0.4, top, cz + 0.25, 0.8);
      roof = { cx, cz: cz + 0.4, hw: w / 2 - 0.2, hd: 0.15 };
    }
    door(g, 0, z1, 0.26, 0.3);
  } else {            // deco: wedding-cake setbacks, crowned by a lantern and spire
    const stone = jitter(C(pick(P.deco, r())), r(), 0.05), gold = C('#e2bf74');
    const f1 = Math.max(3, Math.round(F * 0.5)), f2 = Math.max(f1 + 1, Math.round(F * 0.74)), f3 = Math.max(f2 + 1, Math.round(F * 0.89)), f4 = F;
    const T = [[0, f1, 1, 1], [f1, f2, 0.8, 0.8], [f2, f3, 0.6, 0.6], [f3, f4, 0.4, 0.42]];
    let prevTop = 0;
    T.forEach(([a, b, sw, sd], ti) => {
      if (b <= a) return;
      const tw = w * sw, td = d * sd, tcz = cz - ti * 0.05;
      const col = shade(stone, 1 + a * 0.012);
      g.box(cx - tw / 2, a * FLOOR_H, tcz - td / 2, cx + tw / 2, b * FLOOR_H, tcz + td / 2, col, { win: true });
      tiers.push({ f0: a, f1: b, cx, cz: tcz, w: tw, d: td });
      // vertical piers give deco its stripes
      if (tw > 0.7) for (const px of [-1, 1]) g.box(cx + px * (tw / 2 - 0.05) - 0.025, a * FLOOR_H, tcz + td / 2, cx + px * (tw / 2 - 0.05) + 0.025, b * FLOOR_H, tcz + td / 2 + 0.014, shade(col, 1.12), { top: false });
      g.box(cx - tw / 2 - 0.03, b * FLOOR_H, tcz - td / 2 - 0.03, cx + tw / 2 + 0.03, b * FLOOR_H + 0.045, tcz + td / 2 + 0.03, shade(col, 1.18), { ctop: shade(col, 0.6) });
      prevTop = b * FLOOR_H + 0.045; roof = { cx, cz: tcz, hw: tw / 2 - 0.06, hd: td / 2 - 0.06 };
    });
    const last = tiers[tiers.length - 1];
    top = prevTop;
    // crown: stepped pyramid, then spire
    g.frustum(last.cx, last.cz, top, top + 0.22, last.w * 0.78, last.d * 0.78, last.w * 0.3, last.d * 0.3, gold);
    g.frustum(last.cx, last.cz, top + 0.22, top + 0.44, last.w * 0.3, last.d * 0.3, 0.0, 0.0, shade(gold, 1.1));
    top += 0.44;
    if (F >= 10) { antenna(g, last.cx, top, last.cz, 0.5 + (F - 10) * 0.05); aviation = { x: last.cx, y: top + 0.5 + (F - 10) * 0.05, z: last.cz }; top += 0.2; }
    door(g, 0, z1, 0.26, 0.34); awning(g, -0.22, 0.22, 0.44, z1, C('#1e3358'), 0.12);
    roof = { cx, cz: last.cz, hw: 0.1, hd: 0.1 };
  }

  const crownY = crownBelt(g, tiers, tf, C('#c9c0ae'));          // limestone until the crown is met, then Columbia blue (shader)
  if (spec.scaffold) scaffolding(g, x0 + 0.06, x1 - 0.06, z1, F);
  // where rooftop beacons stand: along the back of the roof, or on the strip beside a deco crown
  const slots = [];
  if (style === 'deco' && tiers.length >= 3) {
    const t3 = tiers[tiers.length - 2], y3 = t3.f1 * FLOOR_H + 0.045;
    for (let k = 0; k < 6; k++) slots.push({ x: -0.3 + k * 0.12, y: y3, z: t3.cz + t3.d / 2 - 0.07 });
  } else {
    const hw = Math.max(0.2, roof.hw);
    for (let k = 0; k < 6; k++) slots.push({ x: roof.cx + (k - 2.5) * Math.min(0.2, (hw * 2) / 6), y: top, z: roof.cz - roof.hd * 0.2 });
  }
  return { geo: g, top, roof, aviation, crownY, height: H, tiers, slots, doorX: LAST_DOOR };
}

/* ------------------------------------------------------------------ lots without a tower */
function pad(g, col, y0 = -0.07) { g.box(-LOT_W / 2, y0, -LOT_D / 2, LOT_W / 2, 0, LOT_D / 2, col, { bottom: false }); }

export function tree(g, x, z, r, s = 1, autumn = false) {
  const trunk = C('#6b4d3d');
  g.box(x - 0.022 * s, 0, z - 0.022 * s, x + 0.022 * s, 0.14 * s, z + 0.022 * s, trunk, { top: false });
  const greens = autumn ? ['#d98f45', '#cc7a3a', '#e0a24e'] : ['#4ea77c', '#3f9570', '#5ab487', '#459d78'];
  const c = jitter(C(pick(greens, r())), r(), 0.07);
  g.blob(x, 0.26 * s, z, 0.15 * s, c, {}, 1.15);
  g.blob(x + 0.025 * s, 0.38 * s, z - 0.02 * s, 0.1 * s, shade(c, 1.12), {}, 1.1);
}

// spec: {kind: 'future'|'open'|'missed'|'rest', seed}
const STONE = '#566580', STONE_TOP = '#65748f', CURB = '#a3adc0';
function scaffoldFrame(g, x0, x1, z0, z1, h, levels = 2, bays = 2) {
  const steel = C('#c3c7da'), plank = C('#a98660'), net = C('#4f9a7a');
  const dx = (x1 - x0) / bays;
  for (let b = 0; b <= bays; b++) for (const z of [z0, z1]) g.bar([x0 + b * dx, 0, z], [x0 + b * dx, h, z], 0.022, steel);
  for (let l = 1; l <= levels; l++) {
    const y = (h / levels) * l - 0.02;
    for (const z of [z0, z1]) g.bar([x0, y, z], [x1, y, z], 0.018, steel);
    for (let b = 0; b <= bays; b++) g.bar([x0 + b * dx, y, z0], [x0 + b * dx, y, z1], 0.018, steel);
    g.box(x0, y - 0.012, z0, x1, y + 0.004, z1, plank, {});
    g.bar([x0, y + 0.1, z1], [x1, y + 0.1, z1], 0.012, steel);                 // guard rail
  }
  for (let b = 0; b < bays; b++) { g.bar([x0 + b * dx, 0, z1], [x0 + (b + 1) * dx, h * 0.5, z1], 0.012, steel); g.bar([x0 + (b + 1) * dx, 0, z1], [x0 + b * dx, h * 0.5, z1], 0.012, steel); }
  g.box(x0 + 0.02, h * 0.5 + 0.02, z1 + 0.004, x1 - 0.02, h - 0.03, z1 + 0.012, net, { top: false, sides: 1 });   // safety netting on the upper bay
}
export function buildSite(spec) {
  const g = new Geo(), r = rng(spec.seed * 104729 + 5), k = spec.kind;
  const stoneC = C(STONE), curb = C(CURB);
  const frame = () => { g.box(-LOT_W / 2, -0.07, -LOT_D / 2, LOT_W / 2, 0.012, LOT_D / 2, stoneC, { bottom: false, ctop: C(STONE_TOP) }); };
  if (k === 'rest') {
    g.box(-LOT_W / 2, -0.07, -LOT_D / 2, LOT_W / 2, 0.012, LOT_D / 2, C('#3b7f62'), { bottom: false, ctop: C('#47946f') });
    g.box(-LOT_W / 2, 0.0, -LOT_D / 2, LOT_W / 2, 0.026, -LOT_D / 2 + 0.05, curb, { top: true }); g.box(-LOT_W / 2, 0.0, LOT_D / 2 - 0.05, LOT_W / 2, 0.026, LOT_D / 2, curb, { top: true });
    g.box(-LOT_W / 2, 0.0, -LOT_D / 2, -LOT_W / 2 + 0.05, 0.026, LOT_D / 2, curb, { top: true }); g.box(LOT_W / 2 - 0.05, 0.0, -LOT_D / 2, LOT_W / 2, 0.026, LOT_D / 2, curb, { top: true });
    const pc = C('#d1c2a6'), py = 0.02;
    g.quad([-0.7, py, -0.62], [-0.5, py, -0.82], [0.7, py, 0.62], [0.5, py, 0.82], pc, 0, 1, KIND.plain);
    g.quad([-0.7, py, -0.62], [0.5, py, 0.82], [0.7, py, 0.62], [-0.5, py, -0.82], pc, 0, 1, KIND.plain);
    const px = (r() < 0.5 ? -1 : 1) * 0.32, pz = -0.15 - r() * 0.2;
    g.cyl(px, pz, 0.01, 0.04, 0.27, 0.27, 11, C('#a6adbd'));
    g.cyl(px, pz, 0.038, 0.044, 0.23, 0.23, 11, C('#4d86c8'), { ctop: C('#66a0e0') });
    const spots = [[-0.5, -0.64], [0.48, -0.62], [-0.52, 0.3], [0.52, 0.42], [0.05, -0.18], [-0.1, 0.64]];
    spots.forEach(([x, z], i) => { if (Math.hypot(x - px, z - pz) > 0.4) tree(g, x + (r() - 0.5) * 0.1, z + (r() - 0.5) * 0.1, r, 0.95 + r() * 0.5, i === 4 && r() < 0.6); });
    g.box(0.18, 0.02, 0.14, 0.42, 0.07, 0.22, C('#7a5a46'), {}); g.box(0.18, 0.07, 0.13, 0.42, 0.13, 0.15, C('#7a5a46'));
    g.bar([-0.3, 0.02, 0.62], [-0.3, 0.38, 0.62], 0.02, C(P.dark)); g.sphere(-0.3, 0.42, 0.62, 0.05, 8, 6, C('#ffd9a0'), { kind: KIND.glow });
    return { geo: g, lamps: [[-0.3, 0.42, 0.62]] };
  }
  if (k === 'missed') {
    // a tidy building site: fenced, a scaffold frame, a cabin and a pile of materials
    g.box(-LOT_W / 2, -0.07, -LOT_D / 2, LOT_W / 2, 0.012, LOT_D / 2, C('#7a6c62'), { bottom: false, ctop: C('#85766b') });
    g.box(-0.68, 0.012, -0.84, 0.68, 0.026, 0.84, C('#6a5a52'), { ctop: C('#76655b') });
    const fh = 0.27, fc = C('#b5c3d8'), post = C('#5f7396');
    const panel = (ax, az, bx, bz) => {
      const Lp = Math.hypot(bx - ax, bz - az);
      g.quad([ax, 0, az], [bx, 0, bz], [bx, fh, bz], [ax, fh, az], fc, 0, Lp, KIND.fence);
      g.quad([bx, 0, bz], [ax, 0, az], [ax, fh, az], [bx, fh, bz], fc, 0, Lp, KIND.fence);
      g.bar([ax, fh, az], [bx, fh, bz], 0.014, post);
    };
    const xL = -0.7, xR = 0.7, zF = 0.84, zB = -0.84, gate = 0.14;
    panel(xL, zF, -gate - 0.12, zF); panel(gate + 0.12, zF, xR, zF);
    panel(xL, zF, xL, zB); panel(xR, zF, xR, zB); panel(xL, zB, xR, zB);
    for (const [px, pz] of [[xL, zF], [xL, 0], [xL, zB], [0, zB], [xR, zB], [xR, 0], [xR, zF], [-gate - 0.12, zF], [gate + 0.12, zF]]) g.bar([px, 0, pz], [px, fh + 0.02, pz], 0.022, post);
    for (let i = 0; i < 6; i++) g.box(-0.12 + i * 0.04, 0.0, zF - 0.03, -0.08 + i * 0.04, 0.07, zF + 0.01, i % 2 ? C('#e9e4da') : C('#e0803c'));
    scaffoldFrame(g, -0.52, 0.5, -0.62, -0.28, 0.82, 2, 3);          // steel scaffold at the back
    g.cyl(-0.38, 0.3, 0.02, 0.14, 0.22, 0.0, 7, C('#a69f94')); g.cyl(0.4, 0.15, 0.02, 0.1, 0.16, 0.0, 6, C('#b3ab9e'));
    g.box(0.2, 0.026, -0.08, 0.5, 0.1, 0.12, C('#a89478')); g.box(0.22, 0.1, -0.06, 0.48, 0.16, 0.1, C('#b8a488'));
    g.box(-0.6, 0.026, 0.12, -0.28, 0.22, 0.42, C('#e6e0d4'), { win: true }); g.box(-0.63, 0.22, 0.09, -0.25, 0.245, 0.45, C('#5e7194'));
    for (const [cx, cz] of [[-0.22, 0.64], [0.22, 0.64], [0.0, 0.52]]) g.cyl(cx, cz, 0.02, 0.1, 0.036, 0.016, 6, C('#ff9a4a'));
    g.bar([0.56, 0.02, 0.5], [0.56, 0.45, 0.5], 0.018, C(P.dark)); g.box(0.5, 0.45, 0.46, 0.62, 0.5, 0.54, C('#fff0c0'), { kind: KIND.glow });
    return { geo: g, lamps: [[0.56, 0.48, 0.5]] };
  }
  // future / open: a calm plot, paved like the rest of the block
  frame();
  const peg = C('#d7c9b2');
  g.box(-LOT_W / 2 + 0.07, 0.012, -LOT_D / 2 + 0.07, LOT_W / 2 - 0.07, 0.02, -LOT_D / 2 + 0.1, curb, { sides: 0 }); g.box(-LOT_W / 2 + 0.07, 0.012, LOT_D / 2 - 0.1, LOT_W / 2 - 0.07, 0.02, LOT_D / 2 - 0.07, curb, { sides: 0 });
  g.box(-LOT_W / 2 + 0.07, 0.012, -LOT_D / 2 + 0.1, -LOT_W / 2 + 0.1, 0.02, LOT_D / 2 - 0.1, curb, { sides: 0 }); g.box(LOT_W / 2 - 0.1, 0.012, -LOT_D / 2 + 0.1, LOT_W / 2 - 0.07, 0.02, LOT_D / 2 - 0.1, curb, { sides: 0 });
  for (const [x, z] of [[-0.62, -0.78], [0.62, -0.78], [-0.62, 0.78], [0.62, 0.78]]) { g.bar([x, 0.012, z], [x, 0.1, z], 0.02, peg); g.box(x - 0.018, 0.1, z - 0.018, x + 0.018, 0.125, z + 0.018, C('#ff9a4a'), {}); }
  if (k === 'future' && r() < 0.4) tree(g, (r() < 0.5 ? -1 : 1) * 0.42, (r() < 0.5 ? -1 : 1) * 0.55, r, 0.8 + r() * 0.3, r() < 0.15);
  if (k === 'open') {
    // ground-breaking: a foundation slab inside survey string, and a lit sign
    g.box(-0.5, 0.012, -0.6, 0.5, 0.05, 0.6, C('#a89c90'), { ctop: C('#b6aaa0') });
    const str = C('#f2e6c8');
    g.bar([-0.62, 0.1, -0.78], [0.62, 0.1, -0.78], 0.006, str); g.bar([0.62, 0.1, -0.78], [0.62, 0.1, 0.78], 0.006, str); g.bar([0.62, 0.1, 0.78], [-0.62, 0.1, 0.78], 0.006, str); g.bar([-0.62, 0.1, 0.78], [-0.62, 0.1, -0.78], 0.006, str);
    g.bar([0.0, 0.05, 0.0], [0.0, 0.5, 0.0], 0.018, C('#e6dcc0'));
    g.box(0.0, 0.38, -0.012, 0.22, 0.5, 0.012, C('#ffbf45'), { kind: KIND.glow });
    g.box(-0.42, 0.05, 0.18, -0.16, 0.12, 0.42, C('#b4764f'), {}); g.box(-0.4, 0.12, 0.2, -0.18, 0.17, 0.4, C('#c4866a'), {});
  }
  return { geo: g, lamps: [] };
}

export function buildPad(col = P.lime[0]) { const g = new Geo(); g.box(-LOT_W / 2, -0.07, -LOT_D / 2, LOT_W / 2, 0.012, LOT_D / 2, rgb(STONE), { bottom: false, ctop: rgb(STONE_TOP) }); void col; return g; }

/* ------------------------------------------------------------------ filler buildings (static background) */
// Calmer, lower contrast than the hero blocks: weathered brick, limestone, brown, dark glass. `o.dim` darkens with distance
// from the hero block, `o.id` gives every building its own window grid and lit pattern (the shader reads it from the sec slot).
const FILL = {
  brick: ['#94645a', '#8a5f56', '#9e6c5e', '#82584f', '#906358'],
  stone: ['#a29a92', '#98908a', '#aaa296', '#8f8a88'],
  brown: ['#7a5a4e', '#6e5248', '#82614f'],
  tan: ['#b09c86', '#a49280', '#b8a68e'],
  glass: ['#4d6890', '#566f8c', '#5a6c98', '#4a6a7e'],
  dark: ['#4e5a70', '#47526a', '#556178'],
};
const MIX = ['brick', 'brick', 'stone', 'tan', 'brown', 'dark', 'stone', 'brick'];
function fill(g, x0, y0, z0, x1, y1, z1, c, id, ctop) { g.box(x0, y0, z0, x1, y1, z1, c, { win: true, sec: id, ctop: ctop || shade(c, 0.5) }); }
function band(g, x0, x1, z0, z1, y, c, h = 0.05, ov = 0.03) { g.box(x0 - ov, y, z0 - ov, x1 + ov, y + h, z1 + ov, c, { ctop: shade(c, 0.55) }); }
// a light parapet round a flat roof: from straight above (World > City's top view) every building reads as its own block
function rim(g, x0, x1, z0, z1, y, c, t = 0.045, h = 0.035) {
  g.box(x0, y, z0, x1, y + h, z0 + t, c, { sides: 3 }); g.box(x0, y, z1 - t, x1, y + h, z1, c, { sides: 3 });
  g.box(x0, y, z0 + t, x0 + t, y + h, z1 - t, c, { sides: 12 }); g.box(x1 - t, y, z0 + t, x1, y + h, z1 - t, c, { sides: 12 });
}
export function fillerBuilding(g, x, zFront, w, d, F, r, o = {}) {
  const dim = o.dim ?? 1, id = (o.id ?? Math.floor(r() * 60)) % 64;
  const H = F * FLOOR_H, cz = zFront - d / 2, x0 = x - w / 2, x1 = x + w / 2, z0 = cz - d / 2;
  const fam = F >= 12 && r() < 0.3 ? 'glass' : pick(MIX, r());
  const c = shade(tint(jitter(C(pick(FILL[fam], r())), r(), 0.07), '#3e5682', 0.2), dim), trimC = shade(tint(c, '#e3dacb', 0.45), 1);
  const roofC = shade(c, 0.42);
  const rooftop = (yy, cxx, czz, spanX, spanZ) => {
    const k = r();
    if (k < 0.34) g.box(cxx - spanX * 0.25, yy, czz - spanZ * 0.2, cxx + spanX * 0.2, yy + 0.1 + r() * 0.06, czz + spanZ * 0.2, shade(c, 0.78));
    else if (k < 0.62 && F >= 4) waterTank(g, cxx - spanX * 0.18, yy, czz, 0.7);
    else if (k < 0.8) acBox(g, cxx + spanX * 0.15, yy, czz, 0.8, shade(C(P.steel), dim));
  };
  const rimC = shade(tint(c, '#c9cfdc', 0.55), dim * 0.95);
  if (F <= 3) {                                     // row house: cornice, flat roof
    fill(g, x0, 0, z0, x1, H, zFront, c, id, roofC);
    band(g, x0, x1, z0, zFront, H, shade(trimC, dim), 0.05, 0.03);
    if (o.rim) rim(g, x0 - 0.03, x1 + 0.03, z0 - 0.03, zFront + 0.03, H + 0.05, rimC);
    if (r() < 0.5) g.box(x0 + w * 0.3, 0, zFront, x0 + w * 0.3 + 0.2, 0.03, zFront + 0.12, shade(c, 1.15), {});
    rooftop(H + 0.05, x, cz, w, d);
  } else if (F <= 8) {                              // pre-war mid-rise: lighter base, cornice, maybe one setback
    const bf = Math.min(2, F - 1), step = F >= 7 && r() < 0.55, f1 = step ? F - 2 : F;
    fill(g, x0, 0, z0, x1, bf * FLOOR_H, zFront, shade(tint(c, '#e3dacb', 0.35), 1), id, roofC);
    fill(g, x0, bf * FLOOR_H, z0, x1, f1 * FLOOR_H, zFront, c, id, roofC);
    band(g, x0, x1, z0, zFront, bf * FLOOR_H, shade(trimC, dim), 0.035, 0.02);
    band(g, x0, x1, z0, zFront, f1 * FLOOR_H, shade(trimC, dim), 0.06, 0.04);
    if (step) { fill(g, x0 + w * 0.17, f1 * FLOOR_H + 0.06, z0 + d * 0.1, x1 - w * 0.17, H + 0.06, zFront - d * 0.2, shade(c, 1.06), id, roofC); band(g, x0 + w * 0.17, x1 - w * 0.17, z0 + d * 0.1, zFront - d * 0.2, H + 0.06, shade(trimC, dim), 0.045, 0.025); rooftop(H + 0.105, x, cz - d * 0.05, w * 0.5, d * 0.5); if (o.rim) rim(g, x0 + w * 0.17 - 0.025, x1 - w * 0.17 + 0.025, z0 + d * 0.1 - 0.025, zFront - d * 0.2 + 0.025, H + 0.105, rimC); }
    else { rooftop(H + 0.06, x, cz, w, d); if (o.rim) rim(g, x0 - 0.04, x1 + 0.04, z0 - 0.04, zFront + 0.04, f1 * FLOOR_H + 0.1, rimC); }
  } else {                                          // tower: 2 or 3 setbacks and a crown
    const tiers = F >= 16 ? 3 : 2;
    let yb = 0, ww = w, dd = d, ccz = cz;
    for (let t = 0; t < tiers; t++) {
      const last = t === tiers - 1, fe = last ? F : Math.round(F * (t === 0 ? 0.58 : 0.84)), top = fe * FLOOR_H;
      const cc = shade(c, 1 + t * 0.04);
      fill(g, x - ww / 2, yb, ccz - dd / 2, x + ww / 2, top, ccz + dd / 2, cc, id, roofC);
      if (!last) { band(g, x - ww / 2, x + ww / 2, ccz - dd / 2, ccz + dd / 2, top, shade(trimC, dim), 0.045, 0.03); yb = top + 0.045; ww *= 0.74; dd *= 0.78; ccz -= d * 0.05; }
      else {
        band(g, x - ww / 2, x + ww / 2, ccz - dd / 2, ccz + dd / 2, top, shade(trimC, dim), 0.05, 0.025);
        const kk = r(), ty = top + 0.05;
        if (fam === 'glass') g.frustum(x, ccz, ty, ty + 0.34, ww, dd, ww * 0.35, dd * 0.35, shade(cc, 1.2));
        else if (kk < 0.4) { g.frustum(x, ccz, ty, ty + 0.5, ww * 0.9, dd * 0.9, ww * 0.1, dd * 0.1, shade(C('#6a8f86'), dim)); }
        else if (kk < 0.75) { g.box(x - ww * 0.25, ty, ccz - dd * 0.2, x + ww * 0.25, ty + 0.14, ccz + dd * 0.2, shade(cc, 0.8)); }
        if (F >= 14) { const hh = 0.35 + r() * 0.3; g.bar([x, ty, ccz], [x, ty + hh + 0.3, ccz], 0.018, C('#b9cce3')); g.sphere(x, ty + hh + 0.32, ccz, 0.032, 6, 4, C('#ff5a50'), { kind: KIND.glow }); }
      }
    }
  }
  return H;
}
