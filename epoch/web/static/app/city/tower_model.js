// city/tower_model.js · the day tower, "Morningside" model: one pre-war Upper Manhattan apartment tower per day.
//   limestone base (1 storey, 2 from 6 floors up) with an arched entrance: the door, fanlight, sconces and lobby glow when the
//   30-minute floor is met (shader uDoor) · honey "Roman brick" shaft in clear window bays between brick piers, one storey per
//   15 deep minutes (the windows come from shader.js, one row per FLOOR_H) · a limestone belt course every 4 floors, so every band
//   between two belts is one hour of deep work · setbacks near the top on tall days (9+ floors one, 13+ floors two) · a bracketed
//   cornice and parapet · a Columbia-blue glazed lantern with a copper-patina dome that lights at the target (KIND.crown, like the
//   crown band at the target floor) · a wooden water tank · 3 quest stars on the front parapet (lit when earned) · beacon slots
//   along the back of the roof.
// Contract: the same as towers.js buildBuilding() ({geo, top, roof, aviation, crownY, height, tiers, slots, doorX}) plus
//   roofY (the roof the construction cam builds on), w, d (footprint) and look (the shader parameters for the window grid).
// Only fills a Geo (merged geometry): about 2k triangles at 16 floors.
import { Geo, rng, rgb, shade, jitter, pick, KIND } from './util.js';
import { FLOOR_H } from './shader.js';
import { waterTank, LOT_D } from './towers.js';
import { MS } from './palette.js';

export const TOWER_W = 1.44, TOWER_D = 1.6;
const FRONT = LOT_D / 2 - 0.02;              // the street wall is flush with every other lot's
const C = rgb;
const BRICK = ['#d2ad86', '#cba27c', '#d8b893', '#c69d7a'];         // buff and honey Roman brick (lighter than the real red-brick neighbours)
const LIME = '#e6dfcf', TRIM = '#f0eadf', PATINA = '#7db3b4', GLASS = '#22365a', DOOR = '#3c6a9a', STAR = '#ffd98f';
const GOLD = '#d9a93a', GOLD_LIT = '#ffcf5a', BRASS = '#c9a14a';
// tower upgrades from the shop (economy_catalog.UPGRADES), shown on every study tower: spec.upgrades = ['string_lights', ...]
export const UPGRADE_IDS = ['string_lights', 'painted_tank', 'awning_doorman', 'neon_sign', 'rooftop_garden', 'brass_doors'];
const TANK_PAINT = ['#4f8fcb', '#c9524b', '#3f9570', '#e0b04a'];
// window grid for shader.js: two windows in a side bay, three in the wide centre bay
export const LOOK = { pitch: 0.21, fill: [0.5, 0.6], glass: 0.12, litP: 0.76 };
const PW = 0.07, E = 0.018;                  // pier width, how far piers stand proud of the wall

// split [a, b] into bays by weight with piers of width PW between them: [[a0, b0], ...] and the pier centres
function bays(a, b, weights) {
  const n = weights.length, sum = weights.reduce((s, w) => s + w, 0), unit = (b - a - PW * (n - 1)) / sum, out = [], piers = [];
  let x = a;
  weights.forEach((w, i) => { const e = x + w * unit; out.push([x, e]); if (i < n - 1) piers.push(e + PW / 2); x = e + PW; });
  return { out, piers };
}
const frontW = (w) => (w > 1.1 ? [1, 1.38, 1] : w > 0.7 ? [1, 1] : [1]);
const sideW = (d) => (d > 1.1 ? [1, 1, 1] : d > 0.7 ? [1, 1] : [1]);

// one block of the tower: windowed bays on the front and sides, a plain windowed back, corner piers and bay piers
function block(g, t, col, pierCol, pierKind) {
  const { x0, x1, z0, z1, y0, y1 } = t;
  const fr = bays(x0 + PW, x1 - PW, frontW(x1 - x0)), sd = bays(z0, z1 - PW, sideW(z1 - z0));
  for (const [a, b] of fr.out) g.quad([a, y0, z1], [b, y0, z1], [b, y1, z1], [a, y1, z1], col, 0, b - a, KIND.win);
  g.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, 0, x1 - x0, KIND.win);
  for (const [a, b] of sd.out) {
    g.quad([x1, y0, b], [x1, y0, a], [x1, y1, a], [x1, y1, b], col, 0, b - a, KIND.win);
    g.quad([x0, y0, a], [x0, y0, b], [x0, y1, b], [x0, y1, a], col, 0, b - a, KIND.win);
  }
  g.box(x0 - E, y0, z1 - PW, x0 + PW, y1, z1 + E, pierCol, { kind: pierKind, top: false });            // corner piers
  g.box(x1 - PW, y0, z1 - PW, x1 + E, y1, z1 + E, pierCol, { kind: pierKind, top: false });
  for (const px of fr.piers) g.box(px - PW / 2, y0, z1, px + PW / 2, y1, z1 + E, pierCol, { kind: pierKind, top: false, sides: 13 });
  for (const pz of sd.piers) {
    g.box(x1, y0, pz - PW / 2, x1 + E, y1, pz + PW / 2, pierCol, { kind: pierKind, top: false, sides: 7 });
    g.box(x0 - E, y0, pz - PW / 2, x0, y1, pz + PW / 2, pierCol, { kind: pierKind, top: false, sides: 11 });
  }
  return fr;
}
// a projecting band round a block (belt course, string course, cornice, crown band)
function band(g, t, y0, y1, ov, col, o = {}) { g.box(t.x0 - ov, y0, t.z0 - ov, t.x1 + ov, y1, t.z1 + ov, col, { ctop: o.ctop || shade(col, 0.62), kind: o.kind, bottom: !!o.bottom }); }
function brackets(g, t, y, ov, col) {
  const n = Math.max(3, Math.round((t.x1 - t.x0) / 0.15));
  for (let k = 0; k < n; k++) { const x = t.x0 + ((k + 0.5) / n) * (t.x1 - t.x0); g.box(x - 0.017, y - 0.045, t.z1 + E, x + 0.017, y, t.z1 + ov * 0.85, col, { top: false, sides: 13 }); }
}
function parapet(g, t, y, col, h = 0.05, th = 0.035) {
  const { x0, x1, z0, z1 } = t;
  g.box(x0, y, z1 - th, x1, y + h, z1, col, { sides: 3 }); g.box(x0, y, z0, x1, y + h, z0 + th, col, { sides: 3 });
  g.box(x0, y, z0 + th, x0 + th, y + h, z1 - th, col, { sides: 12 }); g.box(x1 - th, y, z0 + th, x1, y + h, z1 - th, col, { sides: 12 });
}
// the arched entrance in the middle of the front, on the ground floor
function entrance(g, cx, z, lime, brass = false) {
  const ri = 0.082, ro = 0.118, hd = 0.19, seg = 6, zf = z + 0.022, door = C(DOOR);
  g.box(cx - 0.15, 0, z, cx + 0.15, 0.022, z + 0.07, shade(lime, 0.92));                                     // step
  if (brass) {
    // upgrade "Brass doors": two polished brass leaves with a dark seam, kick plates and push bars (a gentle glow of their own); the
    // fanlight above still lights when the 30-minute floor is met
    const b = C(BRASS);
    g.quad([cx - ri, 0.022, z + 0.004], [cx + ri, 0.022, z + 0.004], [cx + ri, hd, z + 0.004], [cx - ri, hd, z + 0.004], b, 0, 2 * ri, KIND.inlay);
    g.box(cx - 0.004, 0.022, z + 0.004, cx + 0.004, hd, z + 0.01, shade(b, 0.45), { top: false, sides: 1 });
    for (const s of [-1, 1]) { g.box(cx + s * 0.012, 0.03, z + 0.006, cx + s * (ri - 0.008), 0.06, z + 0.012, shade(b, 1.15), { kind: KIND.inlay, sides: 1 }); g.bar([cx + s * 0.03, 0.1, z + 0.016], [cx + s * 0.03, 0.15, z + 0.016], 0.008, shade(b, 1.25), { kind: KIND.inlay }); }
  } else g.quad([cx - ri, 0.022, z + 0.004], [cx + ri, 0.022, z + 0.004], [cx + ri, hd, z + 0.004], [cx - ri, hd, z + 0.004], door, 0, 2 * ri, KIND.door);
  for (let k = 0; k < seg; k++) {                                                                           // fanlight and arch
    const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg), c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    g.tri([cx, hd, z + 0.004], [cx + c0 * ri, hd + s0 * ri, z + 0.004], [cx + c1 * ri, hd + s1 * ri, z + 0.004], door, KIND.door);
    g.quad([cx + c1 * ri, hd + s1 * ri, zf], [cx + c0 * ri, hd + s0 * ri, zf], [cx + c0 * ro, hd + s0 * ro, zf], [cx + c1 * ro, hd + s1 * ro, zf], lime, 0, 1, KIND.plain);
    g.quad([cx + c1 * ro, hd + s1 * ro, zf], [cx + c0 * ro, hd + s0 * ro, zf], [cx + c0 * ro, hd + s0 * ro, z], [cx + c1 * ro, hd + s1 * ro, z], shade(lime, 0.9), 0, 1, KIND.plain);
  }
  for (const s of [-1, 1]) g.box(cx + s * ri - (s > 0 ? 0 : ro - ri), 0.022, z, cx + s * ri + (s > 0 ? ro - ri : 0), hd, zf, lime, { top: false, sides: 13 });   // jambs
  g.box(cx - 0.022, hd + ri - 0.005, z, cx + 0.022, hd + ro + 0.022, zf + 0.008, C(TRIM), { sides: 13 });       // keystone
  for (const s of [-1, 1]) g.box(cx + s * 0.175 - 0.016, 0.17, z, cx + s * 0.175 + 0.016, 0.225, z + 0.03, C(MS.windowWarm), { kind: KIND.door });  // sconces
}
function lantern(g, cx, cz, y, s, lime, gold = false) {
  const pat = gold ? C(GOLD) : C(PATINA);
  g.cyl(cx, cz, y, y + 0.05 * s, 0.21 * s, 0.21 * s, 8, lime, { rot: Math.PI / 8 });                           // plinth
  g.cyl(cx, cz, y + 0.05 * s, y + 0.22 * s, 0.165 * s, 0.165 * s, 8, C(GLASS), { kind: KIND.crown, top: false, rot: Math.PI / 8 });   // glazing
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k / 8) * Math.PI * 2; g.bar([cx + Math.cos(a) * 0.17 * s, y + 0.05 * s, cz + Math.sin(a) * 0.17 * s], [cx + Math.cos(a) * 0.17 * s, y + 0.22 * s, cz + Math.sin(a) * 0.17 * s], 0.022 * s, lime); }
  g.cyl(cx, cz, y + 0.22 * s, y + 0.255 * s, 0.2 * s, 0.2 * s, 8, C(TRIM), { rot: Math.PI / 8, top: false });     // lantern cornice
  g.cyl(cx, cz, y + 0.255 * s, y + 0.36 * s, 0.185 * s, 0.13 * s, 8, pat, { rot: Math.PI / 8, top: false });     // copper dome
  g.cyl(cx, cz, y + 0.36 * s, y + 0.46 * s, 0.13 * s, 0.0, 8, shade(pat, 1.08), { rot: Math.PI / 8 });
  g.bar([cx, y + 0.46 * s, cz], [cx, y + 0.6 * s, cz], 0.016 * s + 0.004, gold ? C(GOLD) : C(TRIM));          // finial
  if (gold) {
    // a three-star day: the dome turns gold and a coronet of eight points rings it, lit steadily after dark (KIND.glow, no shimmer)
    const gl = C(GOLD_LIT), yb = y + 0.25 * s;
    g.cyl(cx, cz, yb - 0.012 * s, yb + 0.018 * s, 0.205 * s, 0.205 * s, 8, gl, { kind: KIND.glow, rot: Math.PI / 8 });
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2, a0 = a - 0.2, a1 = a + 0.2, r = 0.2 * s;
      const p0 = [cx + Math.cos(a0) * r, yb + 0.018 * s, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, yb + 0.018 * s, cz + Math.sin(a1) * r], tip = [cx + Math.cos(a) * r * 1.02, yb + 0.1 * s, cz + Math.sin(a) * r * 1.02];
      g.tri(p0, p1, tip, gl, KIND.glow); g.tri(p1, p0, tip, gl, KIND.glow);
    }
    g.sphere(cx, y + 0.62 * s, cz, 0.03 * s + 0.006, 6, 4, gl, { kind: KIND.glow });
    return y + 0.66 * s;
  }
  return y + 0.6 * s;
}
function star(g, cx, y, z, R, col, kind) {
  const P = [];
  for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? R * 0.42 : R; P.push([cx + Math.cos(a) * r, y + Math.sin(a) * r, z]); }
  const c = [cx, y, z];
  for (let k = 0; k < 10; k++) { const a = P[k], b = P[(k + 1) % 10]; g.tri(c, a, b, col, kind); g.tri(c, [b[0], b[1], b[2] - 0.006], [a[0], a[1], a[2] - 0.006], col, kind); }
}
function scaffolding(g, x0, x1, front, F) {
  const hs = Math.min(F, 5) * FLOOR_H + 0.12, col = C('#a8bcd6'), wood = C('#b49a7a');
  for (let x = x0; x <= x1 + 0.001; x += (x1 - x0) / 4) g.bar([x, 0, front + 0.11], [x, hs, front + 0.11], 0.016, col);
  for (let y = 0.2; y <= hs + 0.01; y += FLOOR_H) { g.bar([x0, y, front + 0.11], [x1, y, front + 0.11], 0.014, col); g.box(x0, y, front + 0.03, x1, y + 0.012, front + 0.12, wood); }
  g.bar([x0, 0.0, front + 0.11], [x0 + (x1 - x0) / 2, hs * 0.9, front + 0.11], 0.012, col);
  g.bar([x1, 0.0, front + 0.11], [x0 + (x1 - x0) / 2, hs * 0.9, front + 0.11], 0.012, col);
}

/* ---- tower upgrades (all in the tower's local units: FLOOR_H = one storey, the street wall at z1) ---- */
function paintedTank(g, cx, y, cz, s, paint) {
  const legs = C(MS.dark), body = C(paint), hoop = C('#f3efe6'), roof = shade(body, 0.62);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.bar([cx + sx * 0.08 * s, y, cz + sz * 0.08 * s], [cx + sx * 0.08 * s, y + 0.15 * s, cz + sz * 0.08 * s], 0.016 * s, legs);
  g.box(cx - 0.1 * s, y + 0.15 * s, cz - 0.1 * s, cx + 0.1 * s, y + 0.165 * s, cz + 0.1 * s, legs);
  g.cyl(cx, cz, y + 0.165 * s, y + 0.37 * s, 0.105 * s, 0.1 * s, 9, body, { ctop: body });
  for (const hy of [0.21, 0.3]) g.cyl(cx, cz, y + hy * s, y + (hy + 0.016) * s, 0.112 * s, 0.11 * s, 9, hoop, { top: false });
  g.cyl(cx, cz, y + 0.37 * s, y + 0.47 * s, 0.115 * s, 0.0, 9, roof);
}
// a strand of warm bulbs from a to b, sagging a little in the middle
function strand(g, a, b, n, sag) {
  const wire = C('#2a2f3a'), warm = [C('#ffd27a'), C('#ffb46b'), C('#fff0c2')];
  let prev = a;
  for (let k = 1; k <= n; k++) {
    const t = k / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag, a[2] + (b[2] - a[2]) * t];
    g.bar(prev, p, 0.006, wire); prev = p;
    if (k < n) g.box(p[0] - 0.011, p[1] - 0.026, p[2] - 0.011, p[0] + 0.011, p[1] - 0.004, p[2] + 0.011, warm[k % 3], { kind: KIND.glow });
  }
}
function tinyFigure(g, x, z, coat) {
  // the doorman: a small faceless figure in a long coat and a cap
  g.box(x - 0.012, 0, z - 0.01, x - 0.002, 0.06, z + 0.01, C('#1a1d24')); g.box(x + 0.002, 0, z - 0.01, x + 0.012, 0.06, z + 0.01, C('#1a1d24'));
  g.box(x - 0.022, 0.05, z - 0.016, x + 0.022, 0.16, z + 0.016, C(coat));
  g.box(x - 0.012, 0.16, z - 0.01, x + 0.012, 0.172, z + 0.01, C('#8d5a3b'));
  g.blob(x, 0.186, z, 0.016, C('#8d5a3b'), {}, 1.1);
  g.cyl(x, z, 0.196, 0.212, 0.019, 0.017, 7, C('#1a1d24'));
  g.box(x - 0.006, 0.196, z + 0.012, x + 0.006, 0.2, z + 0.03, C('#1a1d24'));
}
function upgrades(g, up, o) {
  const { main, T, roofY, z1, F, H } = o;
  if (up.has('string_lights')) {
    // along the front of the roof and two strands from the lantern to the front corners (and the main cornice under a setback)
    const y = roofY + 0.06, fz = T.z1 + 0.03, bz = T.z0 - 0.01;
    strand(g, [T.x0 - 0.02, y, fz], [T.x1 + 0.02, y, fz], 9, 0.03);
    void bz;
    const ly = roofY + 0.2 * o.ls; strand(g, [0, ly, o.lz], [T.x0 + 0.02, y, fz - 0.02], 5, 0.02); strand(g, [0, ly, o.lz], [T.x1 - 0.02, y, fz - 0.02], 5, 0.02);
    if (main !== T) strand(g, [main.x0 - 0.04, o.mainTop + 0.04, main.z1 + 0.05], [main.x1 + 0.04, o.mainTop + 0.04, main.z1 + 0.05], 11, 0.035);
  }
  if (up.has('rooftop_garden')) {
    // green planters along both sides of the roof and a tiny tree at the front corner
    const wood = C('#8a5a3a'), leaf = [C('#3f9570'), C('#4fa86f'), C('#5cb878')], y = roofY;
    for (const [x0, x1, za, zb] of [[T.x0 + 0.04, T.x0 + 0.13, (T.z0 + T.z1) / 2 - 0.05, T.z1 - 0.06], [T.x1 - 0.13, T.x1 - 0.04, T.z0 + 0.22, T.z1 - 0.2]]) {
      g.box(x0, y, za, x1, y + 0.05, zb, wood);
      const n = Math.max(2, Math.round((zb - za) / 0.1));
      for (let k = 0; k < n; k++) g.blob((x0 + x1) / 2, y + 0.07, za + (k + 0.5) * (zb - za) / n, 0.05, leaf[k % 3], {}, 0.8);
    }
    const tx = T.x1 - 0.1, tz = T.z1 - 0.1;
    g.box(tx - 0.045, y, tz - 0.045, tx + 0.045, y + 0.05, tz + 0.045, wood);
    g.bar([tx, y + 0.05, tz], [tx, y + 0.17, tz], 0.014, C('#6b4a32'));
    g.blob(tx, y + 0.21, tz, 0.075, leaf[1], {}, 1.0); g.blob(tx + 0.03, y + 0.26, tz - 0.02, 0.05, leaf[2], {}, 1.0);
  }
  if (up.has('neon_sign')) {
    // a blade sign on the right corner of the street wall: pink tube light in a cyan border, readable from the street and from far off
    const hgt = Math.max(0.18, Math.min(0.8, (F * FLOOR_H - 0.45) * 0.55)), y0 = Math.max(0.24, Math.min(H - hgt - 0.06, FLOOR_H * 1.3)), y1 = y0 + hgt;
    const x0 = main.x1 + 0.02, x1 = main.x1 + 0.15, zc = z1 - 0.07, th = 0.014, pink = C('#ff4fa0'), cyan = C('#56e0ff'), dark = C('#1b1f2a');
    g.box(main.x1, y0 + hgt * 0.15, zc - 0.008, x0, y0 + hgt * 0.22, zc + 0.008, dark); g.box(main.x1, y1 - hgt * 0.22, zc - 0.008, x0, y1 - hgt * 0.15, zc + 0.008, dark);   // brackets
    g.box(x0, y0, zc - th, x1, y1, zc + th, dark);
    g.box(x0 + 0.018, y0 + 0.02, zc - th - 0.003, x1 - 0.018, y1 - 0.02, zc + th + 0.003, pink, { kind: KIND.glow, top: false });
    for (const yy of [y0 + 0.006, y1 - 0.012]) g.box(x0 + 0.004, yy, zc - th - 0.005, x1 - 0.004, yy + 0.006, zc + th + 0.005, cyan, { kind: KIND.glow });
    for (const xx of [x0 + 0.004, x1 - 0.01]) g.box(xx, y0 + 0.006, zc - th - 0.005, xx + 0.006, y1 - 0.006, zc + th + 0.005, cyan, { kind: KIND.glow });
  }
  if (up.has('awning_doorman')) {
    // a striped canvas awning over the door on two thin poles, and a doorman beside it
    const ya = 0.335, yb = 0.27, zb = z1 + 0.26, hw = 0.17, n = 6, green = C('#1f5e4a'), cream = C('#efe6cf');
    for (let k = 0; k < n; k++) {
      const xa = -hw + (2 * hw * k) / n, xb = -hw + (2 * hw * (k + 1)) / n, col = k % 2 ? cream : green;
      g.quad([xa, yb, zb], [xb, yb, zb], [xb, ya, z1 + 0.02], [xa, ya, z1 + 0.02], col);
      g.quad([xb, yb, zb], [xa, yb, zb], [xa, ya, z1 + 0.02], [xb, ya, z1 + 0.02], shade(col, 0.7));
      g.quad([xa, yb - 0.035, zb], [xb, yb - 0.035, zb], [xb, yb, zb], [xa, yb, zb], col);                   // valance
    }
    for (const s of [-1, 1]) g.bar([s * hw, 0.022, zb], [s * hw, yb, zb], 0.008, C('#c9a14a'));
    tinyFigure(g, 0.23, z1 + 0.09, '#1d2b4a');
  }
}

// spec: {F, seed, target, scaffold, stars, w?, d?, upgrades?: [ids], gold?: bool (a three-star day)}
export function buildDayTower(spec) {
  const F = Math.max(1, Math.min(32, spec.F | 0)), r = rng(((spec.seed | 0) * 7919 + 101) >>> 0), g = new Geo();
  const w = spec.w || TOWER_W, d = spec.d || TOWER_D, z1 = FRONT, z0 = FRONT - d, H = F * FLOOR_H, tf = spec.target || 6;
  const brick = jitter(C(pick(BRICK, r())), r(), 0.04), lime = jitter(C(LIME), r(), 0.025), trim = C(TRIM);
  const pier = shade(brick, 1.1), limePier = shade(lime, 0.97);
  // storeys of each block: [f0, f1, width share, depth share]; setbacks step back from the street more than from the rear
  const plan = F <= 8 ? [[0, F, 1, 1]] : F <= 12 ? [[0, F - 2, 1, 1], [F - 2, F, 0.8, 0.76]] : [[0, F - 4, 1, 1], [F - 4, F - 1, 0.82, 0.8], [F - 1, F, 0.62, 0.6]];
  const tiers = [], blocks = [];
  for (const [f0, f1, sw, sd] of plan) {
    const tw = w * sw, td = d * sd, tz1 = z1 - (d - td) * 0.62, tz0 = tz1 - td;
    const t = { x0: -tw / 2, x1: tw / 2, z0: tz0, z1: tz1, f0, f1 };
    blocks.push(t); tiers.push({ f0, f1, cx: 0, cz: (tz0 + tz1) / 2, w: tw, d: td });
  }
  const baseF = Math.min(F, F >= 6 ? 2 : 1), main = blocks[0];
  // limestone base, brick shaft
  block(g, { ...main, y0: 0, y1: baseF * FLOOR_H }, lime, limePier, KIND.stone);
  if (main.f1 > baseF) block(g, { ...main, y0: baseF * FLOOR_H, y1: main.f1 * FLOOR_H }, brick, pier, KIND.plain);
  for (let i = 1; i < blocks.length; i++) { const t = blocks[i]; block(g, { ...t, y0: t.f0 * FLOOR_H + 0.05, y1: t.f1 * FLOOR_H }, shade(brick, 1 + i * 0.03), shade(pier, 1 + i * 0.03), KIND.plain); }
  g.box(main.x0 - 0.03, -0.02, main.z0 - 0.03, main.x1 + 0.03, 0.03, main.z1 + 0.03, shade(lime, 0.8), { top: false });   // water table
  // string course over the base, then a belt course every 4 floors (one hour of deep work between two belts)
  if (baseF < main.f1) band(g, main, baseF * FLOOR_H - 0.02, baseF * FLOOR_H + 0.03, 0.03, trim);
  const crownT = tf <= F ? blocks.findIndex((t) => t.f0 < tf && tf <= t.f1) : -1;
  for (const t of blocks) for (let f = 4; f < t.f1; f += 4) {
    if (f <= t.f0 || f === baseF || (f === tf && crownT >= 0)) continue;
    band(g, t, f * FLOOR_H - 0.016, f * FLOOR_H + 0.02, 0.028, lime);
  }
  // crown band at the target floor: limestone until the target is met, then Columbia blue (shader)
  let crownY = null;
  if (crownT >= 0) { const t = blocks[crownT], y = tf * FLOOR_H; band(g, t, y - 0.052, y - 0.004, 0.034, C('#cfc7b6'), { kind: KIND.crown }); crownY = y; }
  // cornices: the main one bracketed, a lighter one on each setback; a parapet round every roof
  blocks.forEach((t, i) => {
    const y = t.f1 * FLOOR_H, top = i === blocks.length - 1, big = i === 0;
    const ov = big ? 0.06 : 0.045, h = big ? 0.065 : 0.05;
    band(g, t, y, y + h, ov, trim, { bottom: true, ctop: shade(trim, 0.55) });
    if (big || top) brackets(g, t, y, ov, shade(trim, 0.92));
    parapet(g, { x0: t.x0 - ov + 0.01, x1: t.x1 + ov - 0.01, z0: t.z0 - ov + 0.01, z1: t.z1 + ov - 0.01 }, y + h, shade(lime, 0.96));
  });
  const T = blocks[blocks.length - 1], roofY = T.f1 * FLOOR_H + (blocks.length === 1 ? 0.065 : 0.05), tcx = 0, tcz = (T.z0 + T.z1) / 2, thw = (T.x1 - T.x0) / 2, thd = (T.z1 - T.z0) / 2;
  const up = new Set(Array.isArray(spec.upgrades) ? spec.upgrades : []);
  entrance(g, 0, z1 + E, lime, up.has('brass_doors'));
  // roof: the lantern a little toward the street, the water tank at the back on the left
  const ls = F <= 3 ? 0.72 : F <= 8 ? 1 : 1.35;
  const lz = tcz + thd * 0.12;
  const lanternTop = lantern(g, tcx, lz, roofY, ls, lime, !!spec.gold);
  const tankS = F <= 3 ? 0.55 : 0.72, tx = T.x0 + 0.12 + 0.09 * tankS, tz = T.z0 + 0.1 + 0.09 * tankS;
  if (F >= 2) { if (up.has('painted_tank')) paintedTank(g, tx, roofY, tz, tankS, TANK_PAINT[(spec.seed | 0) % TANK_PAINT.length]); else waterTank(g, tx, roofY, tz, tankS); }
  if (up.size) upgrades(g, up, { main, T, roofY, z1, F, H, lz, ls, tx, tz, tankS, mainTop: main.f1 * FLOOR_H + 0.065 });
  // three quest stars on the front parapet: gold and lit once earned, slate until then
  const nStars = Math.max(0, Math.min(3, spec.stars | 0)), sy = roofY + 0.05, sR = 0.048;
  for (let k = 0; k < 3; k++) {
    const on = k < nStars, x = (k - 1) * 0.13;
    star(g, x, sy + sR, T.z1 + 0.012, sR, on ? C(STAR) : C(MS.slate), on ? KIND.glow : KIND.plain);
  }
  // beacon slots: along the back of the roof, right of the tank, centre first
  const ax = tx + 0.1 * tankS + 0.08, bx = T.x1 - 0.07, slots = [];
  const n1 = 4, xs = Array.from({ length: n1 }, (_, k) => ax + (bx - ax) * (n1 === 1 ? 0.5 : k / (n1 - 1)));
  const order = [1, 2, 0, 3];
  for (const k of order) slots.push({ x: xs[k], y: roofY, z: T.z0 + 0.08 });
  slots.push({ x: T.x1 - 0.08, y: roofY, z: tcz }, { x: T.x0 + 0.08, y: roofY, z: tcz + thd * 0.6 });
  if (spec.scaffold) scaffolding(g, main.x0 + 0.06, main.x1 - 0.06, z1, F);
  const aviation = F >= 13 ? { x: tcx, y: lanternTop + 0.03, z: lz } : null;
  return {
    geo: g, top: lanternTop, roofY, height: H, tiers, slots, aviation, crownY, doorX: 0, w, d, lantern: { x: tcx, y: lanternTop, z: lz },
    roof: { cx: tcx, cz: tcz, hw: thw, hd: thd },
    look: { ...LOOK, litP: LOOK.litP * (0.94 + 0.1 * r()) },
  };
}

// the guarded entry point for callers: null when the model throws, so the caller keeps the classic builder
export function tryDayTower(spec) {
  try { const b = buildDayTower(spec); return b && b.geo && b.geo.n > 0 ? b : null; } catch (e) { console.warn('tower_model', e); return null; }
}
