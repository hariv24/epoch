// city/landmarks.js · the five ladder landmarks as stylised silhouettes (no logos), each in 5 sections, one per ladder node.
//   Python  -> Brooklyn-Bridge-like suspension bridge (granite towers with two pointed arches, cables, the web of stays)
//   Math    -> brick institute tower with limestone quoins, a crenellated belfry and a copper pyramid roof (Courant-like)
//   ML/DL   -> Empire-State-like setback spire with a mast
//   Papers  -> domed library with a columned portico (Columbia-like)
//   Writing -> Times-Square-like tower wrapped in billboards, a lit ball on top
// Each build returns {sections: [Geo x5] (section index = sec), height, aviation, size}. The city adds all sections to one mesh
// (unlocked ones show, locked ones are hidden by the shader) and draws the locked ones again as faint solid massing.
import * as THREE from 'three';
import { Geo, rgb, shade, tint, mixc, KIND, TAU } from './util.js';

const hexStr = (h) => '#' + new THREE.Color(h).getHexString();
const SEG = (n) => Array.from({ length: n }, () => new Geo());

function pediment(g, x0, x1, y, zf, zb, rise, col) {
  const xm = (x0 + x1) / 2;
  g.tri([x0, y, zf], [x1, y, zf], [xm, y + rise, zf], col);
  g.tri([x1, y, zb], [x0, y, zb], [xm, y + rise, zb], col);
  g.quad([x0, y, zf], [xm, y + rise, zf], [xm, y + rise, zb], [x0, y, zb], shade(col, 0.8));
  g.quad([xm, y + rise, zf], [x1, y, zf], [x1, y, zb], [xm, y + rise, zb], shade(col, 0.7));
  g.quad([x0, y, zb], [x1, y, zb], [x1, y, zf], [x0, y, zf], shade(col, 0.6));
}
// pointed gothic arch hole (path), springing at ys, apex at ya, bottom at y0
function archHole(c, hw, y0, ys, ya) {
  const h = new THREE.Path();
  h.moveTo(c - hw, y0); h.lineTo(c + hw, y0); h.lineTo(c + hw, ys);
  h.quadraticCurveTo(c + hw, ys + (ya - ys) * 0.66, c, ya); h.quadraticCurveTo(c - hw, ys + (ya - ys) * 0.66, c - hw, ys); h.closePath();
  return h;
}
// extrude an x-y shape along z (centred), add it to g
function extrudeXY(g, shape, depth, col, o = {}, dx = 0) {
  const ex = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.addGeometry(ex, col, o, new THREE.Matrix4().makeTranslation(dx, 0, -depth / 2)); ex.dispose();
}
// sloped slab between two x stations (deck, rails). top at ya/yb, thickness th, half width hw
function slab(g, xa, xb, ya, yb, hw, th, c, ctop) {
  g.quad([xa, ya, hw], [xb, yb, hw], [xb, yb, -hw], [xa, ya, -hw], ctop || c);
  g.quad([xa, ya - th, -hw], [xb, yb - th, -hw], [xb, yb - th, hw], [xa, ya - th, hw], shade(c, 0.6));
  g.quad([xa, ya - th, hw], [xb, yb - th, hw], [xb, yb, hw], [xa, ya, hw], shade(c, 0.85));
  g.quad([xb, yb - th, -hw], [xa, ya - th, -hw], [xa, ya, -hw], [xb, yb, -hw], shade(c, 0.85));
}

/* ------------------------------------------------------------------ Brooklyn-Bridge-like */
function bridge(hex) {
  const stone = tint(rgb('#bba892'), hex, 0.05), asphalt = rgb('#3a4660'), steel = rgb('#d9d3c8'), acc = rgb(hexStr(hex)), warm = rgb('#ffe0a0'), S = SEG(5);
  const TX = 1.9, TH = 2.95, DY = 1.05, DW = 0.62, CZ = 0.27, AX = 4.45, TH_DECK = 0.075;
  const deckY = (x) => { const a = Math.abs(x); if (a <= TX + 0.12) return DY; const t = Math.min(1, (a - TX - 0.12) / (AX - 0.25 - TX - 0.12)); return DY + (0.3 - DY) * t; };
  const sgn = [-1, 1];

  // ---- s0: Manhattan anchorage, arcade and approach deck
  {
    const g = S[0];
    // anchorage: massive stone block with a pointed portal
    g.box(-AX - 0.2, -0.3, -0.62, -AX + 0.72, 0.72, 0.62, stone, { kind: KIND.stone });
    g.box(-AX - 0.26, 0.72, -0.68, -AX + 0.78, 0.8, 0.68, shade(stone, 1.15), { kind: KIND.stone });
    g.box(-AX + 0.2, 0.0, 0.62, -AX + 0.52, 0.5, 0.64, rgb('#22304a'), { top: false });
    // arcade of pointed arches carrying the climbing approach
    const x0 = -AX + 0.72, x1 = -TX - 0.42, n = 4, pw = (x1 - x0) / n;
    for (let k = 0; k < n; k++) {
      const a = x0 + k * pw, b = a + pw, xm = (a + b) / 2, yTop = deckY(xm) - TH_DECK - 0.01;
      const sh = new THREE.Shape(); sh.moveTo(a, -0.3); sh.lineTo(b, -0.3); sh.lineTo(b, yTop); sh.lineTo(a, yTop); sh.closePath();
      sh.holes.push(archHole(xm, pw * 0.34, -0.3, Math.max(0.05, yTop - 0.42), Math.max(0.2, yTop - 0.07)));
      extrudeXY(g, sh, 0.5, stone, { kind: KIND.stone });
    }
    slab(g, -AX + 0.72, -TX - 0.3, deckY(-AX + 0.72), deckY(-TX - 0.3), DW / 2, TH_DECK, asphalt, rgb('#4e5a73'));
    slab(g, -TX - 0.3, -TX, DY, DY, DW / 2, TH_DECK, asphalt, rgb('#4e5a73'));
  }
  // ---- towers: two granite shafts, each with a pair of pointed arches (seen from the side), a cornice and finials
  const tower = (g, cx) => {
    const bw = 1.04, tw = 0.82, hw = 0.11;
    const sh = new THREE.Shape(); sh.moveTo(-bw / 2, -0.65); sh.lineTo(bw / 2, -0.65); sh.lineTo(tw / 2, TH); sh.lineTo(-tw / 2, TH); sh.closePath();
    for (const c of [-0.2, 0.2]) sh.holes.push(archHole(c, hw, 1.38, 1.95, 2.62));
    extrudeXY(g, sh, 0.84, stone, { kind: KIND.stone }, cx);
    // heavier lower block, belt courses, cornice, saddles
    g.box(cx - 0.62, -0.65, -0.56, cx + 0.62, 0.55, 0.56, shade(stone, 0.86), { kind: KIND.stone });
    g.box(cx - 0.66, 0.55, -0.6, cx + 0.66, 0.62, 0.6, shade(stone, 1.12), { kind: KIND.stone });
    g.box(cx - 0.5, 1.24, -0.44, cx + 0.5, 1.3, 0.44, shade(stone, 1.1), { kind: KIND.stone });
    g.box(cx - 0.52, TH, -0.5, cx + 0.52, TH + 0.08, 0.5, shade(stone, 1.2), { kind: KIND.stone });
    for (const sz of sgn) { g.box(cx - 0.18, TH + 0.08, sz * CZ - 0.07, cx + 0.18, TH + 0.15, sz * CZ + 0.07, shade(stone, 0.9), { kind: KIND.stone }); g.sphere(cx, TH + 0.2, sz * CZ, 0.035, 6, 4, acc, { kind: KIND.glow }); }
    // the road passes through: dark portal on both faces
    for (const sx of sgn) g.box(cx + sx * 0.5 - 0.01, DY - 0.06, -DW / 2 - 0.02, cx + sx * 0.5 + 0.01, DY + 0.34, DW / 2 + 0.02, rgb('#1b2a44'), { top: false });
  };
  tower(S[1], -TX);
  tower(S[2], TX);
  // ---- s2 also carries the Brooklyn anchorage and approach
  {
    const g = S[2];
    g.box(AX - 0.72, -0.3, -0.62, AX + 0.2, 0.62, 0.62, stone, { kind: KIND.stone });
    g.box(AX - 0.78, 0.62, -0.68, AX + 0.26, 0.7, 0.68, shade(stone, 1.15), { kind: KIND.stone });
    const x0 = TX + 0.42, x1 = AX - 0.72, n = 4, pw = (x1 - x0) / n;
    for (let k = 0; k < n; k++) {
      const a = x0 + k * pw, b = a + pw, xm = (a + b) / 2, yTop = deckY(xm) - TH_DECK - 0.01;
      const sh = new THREE.Shape(); sh.moveTo(a, -0.3); sh.lineTo(b, -0.3); sh.lineTo(b, yTop); sh.lineTo(a, yTop); sh.closePath();
      sh.holes.push(archHole(xm, pw * 0.34, -0.3, Math.max(0.05, yTop - 0.42), Math.max(0.2, yTop - 0.07)));
      extrudeXY(g, sh, 0.5, stone, { kind: KIND.stone });
    }
    slab(g, TX, TX + 0.3, DY, DY, DW / 2, TH_DECK, asphalt, rgb('#4e5a73'));
    slab(g, TX + 0.3, AX - 0.72, deckY(TX + 0.3), deckY(AX - 0.72), DW / 2, TH_DECK, asphalt, rgb('#4e5a73'));
  }
  // ---- s3: main span deck, rails, stiffening truss, lamps
  {
    const g = S[3], xa = -TX, xb = TX;
    slab(g, xa, xb, DY, DY, DW / 2, TH_DECK, asphalt, rgb('#4e5a73'));
    g.box(xa, DY + 0.004, -0.06, xb, DY + 0.012, 0.06, rgb('#8d96a8'), { sides: 0, kind: KIND.plain });         // promenade
    for (const sz of sgn) {
      g.box(xa, DY - 0.2, sz * (DW / 2) - 0.012, xb, DY - TH_DECK, sz * (DW / 2) + 0.012, rgb('#5f6f8a'), {});   // truss fascia
      for (let x = xa + 0.1; x < xb - 0.05; x += 0.2) { g.bar([x, DY - 0.2, sz * DW / 2], [x + 0.1, DY - TH_DECK, sz * DW / 2], 0.012, shade(steel, 0.8)); g.bar([x + 0.1, DY - 0.2, sz * DW / 2], [x + 0.2, DY - TH_DECK, sz * DW / 2], 0.012, shade(steel, 0.8)); }
      g.bar([xa, DY + 0.1, sz * DW / 2], [xb, DY + 0.1, sz * DW / 2], 0.014, shade(steel, 0.9));
      for (let x = xa; x <= xb + 0.01; x += 0.3) g.box(x - 0.015, DY + 0.1, sz * DW / 2 - 0.015, x + 0.015, DY + 0.15, sz * DW / 2 + 0.015, warm, { kind: KIND.glow });
    }
    // railings and lamps on the two approaches too
    for (const sx of sgn) for (const sz of sgn) {
      const xs = sx * (TX + 0.12), xe = sx * (AX - 0.8), ya = DY, yb = deckY(xe);
      g.bar([xs, ya + 0.1, sz * DW / 2], [xe, yb + 0.1, sz * DW / 2], 0.014, shade(steel, 0.9));
      for (let t = 0; t <= 1.001; t += 0.14) { const x = xs + (xe - xs) * t, y = ya + (yb - ya) * t; g.box(x - 0.015, y + 0.1, sz * DW / 2 - 0.015, x + 0.015, y + 0.15, sz * DW / 2 + 0.015, warm, { kind: KIND.glow }); }
    }
  }
  // ---- s4: cables, suspenders, the web of diagonal stays, and the string of lights
  {
    const g = S[4];
    const catY = (x) => 1.3 + (TH - 0.14 - 1.3) * Math.pow(x / TX, 2);
    const cab = (a, b, th, c = steel) => g.bar(a, b, th, c, { kind: KIND.inlay });
    for (const sz of sgn) {
      const z = sz * CZ;
      let prev = null;
      for (let k = 0; k <= 26; k++) { const x = -TX + (2 * TX * k) / 26, p = [x, catY(x), z]; if (prev) cab(prev, p, 0.034); prev = p; }
      for (let k = 1; k < 20; k++) { const x = -TX + (2 * TX * k) / 20; if (Math.abs(x) > TX - 0.12) continue; cab([x, catY(x), z], [x, DY + 0.06, sz * DW / 2], 0.012, shade(steel, 0.92)); }
      for (const sx of sgn) {
        const tx = sx * TX, ty = TH - 0.16;
        // backstay down to the anchorage
        const bx = sx * (AX - 0.9), by = deckY(bx) + 0.12;
        let p0 = [tx, ty, z];
        for (let k = 1; k <= 10; k++) { const t = k / 10, p = [tx + (bx - tx) * t, ty + (by - ty) * t - Math.sin(t * Math.PI) * 0.1, z]; cab(p0, p, 0.032); p0 = p; }
        // fan of stays on both sides of the tower
        for (let k = 1; k <= 8; k++) { const x = tx - sx * (0.2 + k * 0.19); cab([tx, ty - 0.02 - k * 0.012, z], [x, DY + 0.07, sz * DW / 2], 0.011, shade(steel, 0.85)); }
        for (let k = 1; k <= 9; k++) { const x = tx + sx * (0.28 + k * 0.2); cab([tx, ty - 0.02 - k * 0.012, z], [x, deckY(x) + 0.07, sz * DW / 2], 0.011, shade(steel, 0.85)); }
      }
      for (let k = 1; k < 13; k++) { const x = -TX + (2 * TX * k) / 13; g.box(x - 0.018, catY(x) + 0.03, z - 0.018, x + 0.018, catY(x) + 0.075, z + 0.018, warm, { kind: KIND.glow }); }
    }
  }
  return { sections: S, height: TH + 0.4, aviation: null, size: [9, 2.8] };
}

/* ------------------------------------------------------------------ Empire-State-like spire */
function spire(hex) {
  const st = tint(rgb('#d4cdc2'), hex, 0.06), acc = rgb(hexStr(hex)), S = SEG(5), pier = shade(st, 1.18);
  // [w, d, y0, y1, section]
  const T = [[1.45, 1.1, 0.95, 3.15, 1], [1.12, 0.88, 3.15, 3.7, 2], [0.86, 0.68, 3.7, 4.2, 2], [0.62, 0.5, 4.2, 4.62, 2], [0.44, 0.36, 4.62, 5.0, 3]];
  const ribs = (g, w, d, y0, y1, c) => {
    const n = Math.max(3, Math.round(w / 0.22));
    for (let k = 0; k <= n; k++) { const x = -w / 2 + (k / n) * w; g.box(x - 0.014, y0, d / 2, x + 0.014, y1, d / 2 + 0.016, c, { top: false }); }
  };
  // podium with side wings
  S[0].box(-0.98, 0, -0.78, 0.98, 0.95, 0.78, shade(st, 0.96), { win: true });
  S[0].box(-1.02, 0.95, -0.82, 1.02, 1.0, 0.82, shade(st, 1.2), { ctop: shade(st, 0.6) });
  for (const sx of [-1, 1]) { S[0].box(sx * 1.0 - (sx < 0 ? 0.46 : 0), 0, -0.5, sx * 1.0 + (sx > 0 ? 0.46 : 0), 0.52, 0.5, shade(st, 0.92), { win: true }); S[0].box(sx * 1.0 - (sx < 0 ? 0.5 : 0), 0.52, -0.54, sx * 1.0 + (sx > 0 ? 0.5 : 0), 0.57, 0.54, shade(st, 1.2), {}); }
  S[0].box(-0.3, 0, 0.78, 0.3, 0.4, 0.82, rgb('#22304a'), { kind: KIND.door, top: false });
  for (const [w, d, y0, y1, s] of T) {
    const g = S[s], c = shade(st, 1 - s * 0.015);
    g.box(-w / 2, y0, -d / 2, w / 2, y1, d / 2, c, { win: true });
    g.box(-w / 2 - 0.03, y1, -d / 2 - 0.03, w / 2 + 0.03, y1 + 0.045, d / 2 + 0.03, shade(c, 1.2), { ctop: shade(c, 0.6) });
    if (w > 0.5) ribs(g, w, d, y0 + 0.02, y1, pier);
  }
  // crown: lantern band lit in the ladder colour, mast, beacon
  S[3].box(-0.17, 5.0, -0.15, 0.17, 5.28, 0.15, acc, { kind: KIND.glow });
  S[3].frustum(0, 0, 5.28, 5.52, 0.3, 0.26, 0.1, 0.1, shade(st, 1.1));
  S[4].bar([0, 5.5, 0], [0, 7.05, 0], 0.045, rgb('#d8e4f0'), { kind: KIND.inlay }); S[4].bar([-0.12, 6.3, 0], [0.12, 6.3, 0], 0.02, rgb('#d8e4f0'), { kind: KIND.inlay });
  S[4].sphere(0, 7.1, 0, 0.06, 8, 6, acc, { kind: KIND.glow });
  S[4].box(-0.24, 4.97, -0.2, 0.24, 5.02, 0.2, acc, { kind: KIND.glow });
  return { sections: S, height: 7.2, aviation: { x: 0, y: 7.2, z: 0 }, size: [2.4, 1.7] };
}

/* ------------------------------------------------------------------ brick institute tower */
function tower(hex) {
  const brick = tint(rgb('#a8604f'), hex, 0.12), acc = rgb(hexStr(hex)), trim = rgb('#e0d4c2'), copper = tint(rgb('#5fa592'), hex, 0.2), S = SEG(5);
  const quoins = (g, w, d, y0, y1, c) => {
    for (const sx of [-1, 1]) for (let y = y0; y < y1 - 0.1; y += 0.2) {
      const x = sx * (w / 2) - (sx > 0 ? 0.1 : 0);
      g.box(x, y + 0.01, d / 2, x + 0.1, y + 0.1, d / 2 + 0.014, c, { top: false });
      g.box(sx * (w / 2) - (sx > 0 ? 0.02 : 0), y + 0.11, d / 2 - 0.1, sx * (w / 2) + (sx > 0 ? 0.0 : 0.02) - 0.0, y + 0.2, d / 2, c, { top: false, sides: 0 });
    }
  };
  // s0: wide base wing with an arched doorway and steps
  S[0].box(-1.05, 0, -0.7, 1.05, 0.8, 0.7, brick, { win: true });
  S[0].box(-1.1, 0.8, -0.75, 1.1, 0.87, 0.75, trim, { ctop: shade(trim, 0.6) });
  S[0].box(-0.2, 0.0, 0.7, 0.2, 0.46, 0.73, rgb('#22304a'), { kind: KIND.door, top: false });
  for (let k = 0; k < 3; k++) S[0].box(-0.3, 0, 0.7, 0.3, 0.04 * (3 - k), 0.7 + 0.08 * (k + 1), shade(trim, 1.0 - k * 0.04));
  // s1: shaft with quoins; s2: upper shaft with arched belt and clock
  S[1].box(-0.68, 0.87, -0.5, 0.68, 2.55, 0.5, shade(brick, 1.03), { win: true });
  quoins(S[1], 1.36, 1.0, 0.87, 2.55, trim);
  S[1].box(-0.72, 2.55, -0.54, 0.72, 2.62, 0.54, trim, { ctop: shade(trim, 0.6) });
  S[2].box(-0.64, 2.62, -0.46, 0.64, 3.42, 0.46, shade(brick, 1.06), { win: true });
  S[2].box(-0.2, 2.82, 0.46, 0.2, 3.22, 0.475, trim, { top: false }); S[2].box(-0.14, 2.88, 0.47, 0.14, 3.16, 0.485, rgb('#fff1c6'), { kind: KIND.glow, top: false });
  S[2].box(-0.68, 3.42, -0.5, 0.68, 3.5, 0.5, trim, { ctop: shade(trim, 0.6) });
  // s3: crenellated belfry with four corner turrets
  S[3].box(-0.55, 3.5, -0.4, 0.55, 3.95, 0.4, shade(brick, 1.1), { win: true });
  S[3].box(-0.6, 3.95, -0.45, 0.6, 4.02, 0.45, trim, { ctop: shade(trim, 0.6) });
  for (let k = 0; k < 6; k++) { const x = -0.5 + (k + 0.5) * (1.0 / 6); S[3].box(x - 0.05, 4.02, 0.36, x + 0.05, 4.14, 0.45, trim); S[3].box(x - 0.05, 4.02, -0.45, x + 0.05, 4.14, -0.36, trim); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { S[3].cyl(sx * 0.58, sz * 0.43, 3.5, 4.1, 0.07, 0.07, 8, shade(brick, 1.12)); S[3].cyl(sx * 0.58, sz * 0.43, 4.1, 4.3, 0.085, 0.0, 8, copper); }
  // s4: copper pyramid roof, lantern, flag
  S[4].frustum(0, 0, 4.02, 4.95, 1.0, 0.76, 0.0, 0.0, copper);
  S[4].box(-0.1, 4.82, -0.1, 0.1, 5.05, 0.1, acc, { kind: KIND.glow });
  S[4].bar([0, 5.0, 0], [0, 5.5, 0], 0.025, rgb('#d8e4f0'), { kind: KIND.inlay }); S[4].box(0.0, 5.3, -0.01, 0.24, 5.46, 0.01, acc, { kind: KIND.glow });
  return { sections: S, height: 5.5, aviation: null, size: [2.2, 1.5] };
}

/* ------------------------------------------------------------------ domed library */
function dome(hex) {
  const stone = tint(rgb('#ddd2c2'), hex, 0.05), copper = tint(rgb('#6fb3a0'), hex, 0.25), acc = rgb(hexStr(hex)), S = SEG(5);
  // s0: broad plinth and monumental steps
  [[3.0, 2.1, 0, 0.07], [2.78, 1.94, 0.07, 0.14], [2.56, 1.8, 0.14, 0.21]].forEach(([w, d, y0, y1]) => S[0].box(-w / 2, y0, -d / 2, w / 2, y1, d / 2, shade(stone, 0.94), { ctop: shade(stone, 1.08) }));
  for (let k = 0; k < 6; k++) S[0].box(-0.7, 0, 0.9, 0.7, 0.03 * (6 - k), 0.9 + 0.09 * (k + 1), shade(stone, 1.05 - k * 0.02));
  // s1: main hall, columned portico and pediment
  S[1].box(-1.1, 0.21, -0.7, 1.1, 1.08, 0.7, stone, { win: true });
  for (let k = 0; k < 6; k++) { const x = -0.9 + k * 0.36; S[1].cyl(x, 0.86, 0.21, 1.03, 0.058, 0.052, 8, shade(stone, 1.12)); S[1].box(x - 0.07, 1.03, 0.79, x + 0.07, 1.06, 0.93, shade(stone, 1.2)); }
  S[1].box(-1.06, 1.03, 0.64, 1.06, 1.1, 0.95, shade(stone, 1.06), {});
  pediment(S[1], -1.08, 1.08, 1.1, 0.97, 0.62, 0.26, shade(stone, 1.0));
  // s2: drum with tall windows and a cornice
  S[2].cyl(0, -0.1, 1.08, 1.7, 0.76, 0.76, 16, stone, { win: true });
  S[2].cyl(0, -0.1, 1.7, 1.76, 0.82, 0.82, 16, shade(stone, 1.15));
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + 0.2; S[2].box(Math.cos(a) * 0.775 - 0.025, 1.14, -0.1 + Math.sin(a) * 0.775 - 0.025, Math.cos(a) * 0.775 + 0.025, 1.66, -0.1 + Math.sin(a) * 0.775 + 0.025, shade(stone, 1.15), { top: false }); }
  // s3: dome with ribs and an oculus ring that glows in the ladder colour
  S[3].sphere(0, 1.76, -0.1, 0.78, 20, 9, copper, { half: true }, 0.94);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; S[3].bar([Math.cos(a) * 0.78 * 0.995, 1.78, -0.1 + Math.sin(a) * 0.78 * 0.995], [Math.cos(a) * 0.1, 2.48, -0.1 + Math.sin(a) * 0.1], 0.014, shade(copper, 1.4)); }
  S[3].cyl(0, -0.1, 2.0, 2.003, 0.64, 0.64, 20, acc, { kind: KIND.inlay, top: false });
  // s4: lantern, spire and beacon
  S[4].cyl(0, -0.1, 2.46, 2.8, 0.14, 0.13, 8, stone, { win: true }); S[4].cyl(0, -0.1, 2.8, 2.98, 0.16, 0.0, 8, copper);
  S[4].sphere(0, 2.6, -0.1, 0.05, 8, 6, acc, { kind: KIND.glow }); S[4].bar([0, 2.98, -0.1], [0, 3.25, -0.1], 0.016, rgb('#d8e4f0'), { kind: KIND.inlay }); S[4].sphere(0, 3.28, -0.1, 0.045, 8, 6, acc, { kind: KIND.glow });
  return { sections: S, height: 3.3, aviation: null, size: [3.0, 2.1] };
}

/* ------------------------------------------------------------------ billboard tower */
function billboard(hex) {
  const c0 = tint(rgb('#8794a8'), hex, 0.1), acc = rgb(hexStr(hex)), S = SEG(5), red = rgb('#e8433f');
  const bb = (g, x0, y0, x1, y1, z, face, col) => {      // billboard panel on a face ('z+' or 'x+' or 'x-')
    const k = KIND.bill;
    if (face === 'z+') g.box(x0, y0, z, x1, y1, z + 0.035, col, { kind: k, top: false, sides: 1 });
    else if (face === 'x+') g.box(z, y0, x0, z + 0.035, y1, x1, col, { kind: k, top: false, sides: 4 });
    else g.box(z - 0.035, y0, x0, z, y1, x1, col, { kind: k, top: false, sides: 8 });
    const e = 0.025, fr = rgb('#1b2a44');
    if (face === 'z+') { g.box(x0 - e, y1, z, x1 + e, y1 + e, z + 0.04, fr, {}); g.box(x0 - e, y0 - e, z, x1 + e, y0, z + 0.04, fr, {}); }
  };
  // s0: podium with a glowing band and a red glass stair (TKTS-like) at the front
  S[0].box(-1.05, 0, -0.68, 1.05, 0.9, 0.68, c0, { win: true }); S[0].box(-1.09, 0.9, -0.72, 1.09, 0.97, 0.72, shade(c0, 1.2), {});
  S[0].box(-0.95, 0.5, 0.68, 0.95, 0.62, 0.72, acc, { kind: KIND.glow });
  for (let k = 0; k < 7; k++) S[0].box(-0.4, 0, 0.68, 0.4, 0.03 + 0.045 * (7 - k) * 0.5, 0.68 + 0.09 * (k + 1), red, { kind: KIND.inlay, sides: 15 });
  // s1: first billboard tier on three faces and a blade sign
  S[1].box(-0.64, 0.97, -0.5, 0.64, 2.4, 0.5, shade(c0, 0.95), { win: true });
  bb(S[1], -0.58, 1.14, 0.58, 2.2, 0.5, 'z+', acc); bb(S[1], -0.42, 1.14, 0.42, 2.2, 0.64, 'x+', shade(acc, 1.1)); bb(S[1], -0.42, 1.32, 0.42, 2.1, -0.64, 'x-', shade(acc, 0.9));
  S[1].box(0.92, 0.97, 0.62, 1.0, 2.15, 0.7, acc, { kind: KIND.bill });
  // s2: second tier
  S[2].box(-0.48, 2.4, -0.4, 0.48, 3.55, 0.4, shade(c0, 1.05), { win: true }); S[2].box(-0.52, 3.55, -0.44, 0.52, 3.61, 0.44, shade(c0, 1.25), {});
  bb(S[2], -0.44, 2.6, 0.44, 3.35, 0.4, 'z+', mixc(acc, rgb('#ffffff'), 0.25)); bb(S[2], -0.32, 2.6, 0.32, 3.35, 0.48, 'x+', acc);
  // s3: crown block with a lit cap
  S[3].box(-0.34, 3.61, -0.3, 0.34, 4.25, 0.3, shade(c0, 1.1), { win: true }); S[3].box(-0.38, 4.25, -0.34, 0.38, 4.31, 0.34, acc, { kind: KIND.glow });
  // s4: pole and the lit ball
  S[4].bar([0, 4.31, 0], [0, 5.1, 0], 0.03, rgb('#d8e4f0'), { kind: KIND.inlay }); S[4].sphere(0, 5.3, 0, 0.17, 12, 8, mixc(acc, rgb('#ffffff'), 0.4), { kind: KIND.glow });
  S[4].box(-0.5, 4.31, -0.4, 0.5, 4.35, 0.4, shade(c0, 1.3), {});
  return { sections: S, height: 5.5, aviation: null, size: [2.2, 1.4] };
}

export const LANDMARKS = { 'Python': bridge, 'Math': tower, 'ML/DL': spire, 'Papers': dome, 'Writing/X': billboard };
export function buildLandmark(name, hex) {
  const b = LANDMARKS[name](hex), geo = new Geo();
  b.sections.forEach((s, i) => geo.append(s, 0, 0, 0, 0, 1, i));
  return { geo, sections: b.sections, height: b.height, aviation: b.aviation, size: b.size };
}
