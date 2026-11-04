// city/world/landmarks.js · slice 3 step 2 (docs/WORLD.md 14.2 (3)-(4), 14.3 detail kit): the 125th St look and the hand-detailed landmarks. PURE JS, no `three`
// (it runs inside the street worker through kit.js). Everything here draws through kit.js's Out mesher (O.quad / O.box / O.ibox) in the FACE frame of a facade
// (x along the facade, z out of it by front.n, y up), exactly like the other facade builders; kit.js passes its helpers in (makeLandmarks(K)).
//   shopRow     125th St storefronts: uneven widths per lot, recessed glazing with a shop interior (the window shader, kind 5 open / 6 gated at night), box signs in
//               varied colours with generic words, some awnings, a rolled-gate housing over every opening
//   commercial  the 125th St buildings above the shops: 1-storey taxpayers with parapets, brick walk-ups, stone lofts, painted stucco, post-war panel fronts
//   apollo      the Apollo Theater (LP-1299, 253 W 125th): terra-cotta front, fluted pilasters, modillioned cornice + balustrade, the marquee with bulbs and neon, the APOLLO blade
//   theresa     Hotel Theresa (2082-2096 ACP Blvd): white terra-cotta and brick, piers, arched top floor, crested parapet, HOTEL THERESA lettering on the 125th St side
//   sob         the Adam Clayton Powell Jr. State Office Building (1973): a tan concrete slab, close piers and dark glass, a recessed glass base, its 125th St plaza
//   park        Marcus Garvey Park's west edge: kerb, wall + fence, grass, the Acropolis hill, the Harlem Fire Watchtower (cast iron, octagonal, 1856) and a wooded canopy
//   subway      the 125 St (2 / 3) entrance on Lenox: a real stairwell down into a lit passage, NYC railings, green globes, the name board with the 2 and 3 bullets
// Sign cells (SIGN_CELLS) are drawn by street.js into one atlas; text is generic for shops and named only for LPC landmarks + subway wayfinding.
const PI = Math.PI;

/* ------------------------------------------------------------------ the sign atlas cells (street.js draws them; aPar.x = the cell, aPar.y = the used width 0..1) */
export const SHOP_WORDS = ['DELI', 'PHARMACY', 'BARBER', 'NAILS', 'GROCERY', 'CHICKEN', 'PIZZA', 'LAUNDROMAT', 'BEAUTY SUPPLY', 'SHOES', 'CELL PHONES', 'FASHION', 'BAKERY', 'CAFE',
  'HARDWARE', 'FISH MARKET', 'SALON', 'BOOKS', 'DISCOUNT', 'ELECTRONICS', 'SNEAKERS', 'CHECK CASHING', 'FRUIT', 'SOUL FOOD', 'JEWELRY', 'OPTICAL', 'WIRELESS', 'RESTAURANT'];
// [background, letters] pairs: the shop-sign palette of 125th St (red, yellow, royal blue, green, white, black, orange, purple, teal)
export const SIGN_STYLES = [['#c8141b', '#ffffff'], ['#f6c813', '#151515'], ['#1d4fb0', '#ffffff'], ['#13753f', '#ffffff'], ['#f4f2ec', '#c8141b'], ['#141416', '#f6c813'],
  ['#ea6a12', '#ffffff'], ['#5a2a7a', '#ffffff'], ['#0f7f86', '#ffffff'], ['#f4f2ec', '#1d3f8f'], ['#141416', '#ffffff'], ['#8a1220', '#f6e7c0']];
export const SIGN_CELLS = [];
SHOP_WORDS.forEach((w, i) => { for (let v = 0; v < 3; v++) SIGN_CELLS.push({ kind: 'shop', w, st: (i * 5 + v * 4 + v) % SIGN_STYLES.length }); });
export const CELL = {};
for (const k of ['apollo', 'blade', 'board', 'sub', 'walk', 'hand', 'theresa', 'legacy125', 'legacyApollo']) { CELL[k] = SIGN_CELLS.length; SIGN_CELLS.push({ kind: k }); }
export const shopCell = (word, variant) => (word % SHOP_WORDS.length) * 3 + (variant % 3);

export function makeLandmarks(K) {
  const { PAL, hex, mul, mix, clamp, rng, wallHoles, aoProfile, IRON, FRAME, context } = K;

  // a rotated box (Ry * Rx), emitted as quads: the meshes of the mid tier cannot use instanced parts (their materials dither out beyond the near band)
  function rbox(O, mat, cx, cy, cz, sx, sy, sz, col, ry = 0, rx = 0) {
    const cy_ = Math.cos(ry), sy_ = Math.sin(ry), cx_ = Math.cos(rx), sx_ = Math.sin(rx);
    const R = (x, y, z) => { const y1 = y * cx_ - z * sx_, z1 = y * sx_ + z * cx_; return [x * cy_ + z1 * sy_, y1, -x * sy_ + z1 * cy_]; };
    const P = (x, y, z) => { const r = R(x * sx / 2, y * sy / 2, z * sz / 2); return [cx + r[0], cy + r[1], cz + r[2]]; };
    const F = [[[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]], [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]], [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
    for (const [n, q] of F) O.quad(mat, P(...q[0]), P(...q[1]), P(...q[2]), P(...q[3]), R(...n), col);
  }

  // a jittered icosahedron (a tree crown or a boulder at mid distance): 20 flat triangles
  const ICO_V = (() => { const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]; return v.map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); }); })();
  const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // slice 3 step 3: subdivided once (80 faces) with a position-hashed (so continuous) jitter of +-9 %: boulders and crowns read rounded, not like dice
  const ICO_S = (() => { const V = ICO_V.map((p) => p.slice()), mid = new Map(), F = [];
    const m = (i, j) => { const k = i < j ? i + '_' + j : j + '_' + i; if (!mid.has(k)) { const q = [(V[i][0] + V[j][0]) / 2, (V[i][1] + V[j][1]) / 2, (V[i][2] + V[j][2]) / 2], l = Math.hypot(...q); V.push(q.map((c) => c / l)); mid.set(k, V.length - 1); } return mid.get(k); };
    for (const [a, b, c] of ICO_F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    return { V, F }; })();
  function ico(O, mat, cx, cy, cz, sx, sy, sz, col, R) {
    const seed = Math.floor(R() * 1e9), hsh = (p) => { let h = (Math.imul(Math.round(p[0] * 997) + 31, 73856093) ^ Math.imul(Math.round(p[1] * 997) + 17, 19349663) ^ Math.imul(Math.round(p[2] * 997) + 5, 83492791) ^ seed) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return (h % 10007) / 10007; };
    const P = ICO_S.V.map((p) => { const j = 0.91 + hsh(p) * 0.18; return [cx + p[0] * sx * j, cy + p[1] * sy * j, cz + p[2] * sz * j]; });
    for (const [a, b, c] of ICO_S.F) { const A = P[a], B = P[b], C = P[c], n = [(A[0] + B[0] + C[0]) / 3 - cx, (A[1] + B[1] + C[1]) / 3 - cy, (A[2] + B[2] + C[2]) / 3 - cz]; O.tri(mat, A, B, C, n, mul(col, 0.92 + 0.16 * Math.max(0, n[1] / (Math.hypot(...n) || 1))), [0, 0], [1, 0], [0, 1]); }
  }

  /* ---------------------------------------------------------------- 125th St storefronts */
  const AWN = [[0.55, 0.08, 0.08], [0.08, 0.3, 0.16], [0.1, 0.18, 0.42], [0.4, 0.1, 0.18], [0.62, 0.45, 0.1], [0.12, 0.12, 0.14], [0.72, 0.7, 0.62], [0.85, 0.42, 0.08]];
  function shopRow(O, rec, B, Hs, o = {}) {
    const { n, x0, len, R, fz, bodyCol, baseCol } = B, ry = n > 0 ? 0 : PI;
    const ns = o.one ? 1 : Math.max(1, Math.round(len / (4.6 + R() * 3.8)));
    const wts = Array.from({ length: ns }, () => 0.62 + R() * 0.76), wsum = wts.reduce((a, b) => a + b, 0);
    const frameK = R(), frameM = frameK < 0.45 ? 'brick' : frameK < 0.75 ? 'paint' : 'stone';
    const frameC = frameK < 0.45 ? mul(bodyCol, 0.92) : frameK < 0.75 ? (R() < 0.6 ? [0.13, 0.13, 0.14] : mul(AWN[Math.floor(R() * AWN.length)], 0.9)) : mul(baseCol, 0.95);
    const holes = [], glaze = [];
    let a = x0;
    for (let i = 0; i < ns; i++) {
      const sw = (len * wts[i]) / wsum, b = a + sw, pl = i === 0 ? 0.42 : 0.2, pr = i === ns - 1 ? 0.42 : 0.2, oa = a + pl, ob = b - pr, ow = ob - oa;
      if (ow < 1.2) { a = b; continue; }
      const gated = o.open ? 0 : R() < 0.58 ? 1 : 0, seed = R(), kind = gated ? 6 : 5, lit = R() < 0.9 ? 1 : 0;
      const bh = 0.35 + R() * 0.3, top = Hs - 1.4, dw = ow > 2.6 ? 1.0 : 0, dl = R() < 0.5;      // bulkhead, the opening's head (gate housing + sign band above), a door
      const dx0 = dl ? oa : ob - dw, dx1 = dl ? oa + dw : ob, wx0 = dw ? (dl ? dx1 + 0.12 : oa) : oa, wx1 = dw ? (dl ? ob : dx0 - 0.12) : ob;
      if (dw) { holes.push({ x0: dx0, x1: dx1, y0: 0, y1: top, rv: 0.45, noBack: true }); glaze.push([(dx0 + dx1) / 2, top / 2, dx1 - dx0, top, 0.45, kind, lit, seed]); }
      holes.push({ x0: wx0, x1: wx1, y0: bh, y1: top, rv: 0.14, noBack: true }); glaze.push([(wx0 + wx1) / 2, (bh + top) / 2, wx1 - wx0, top - bh, 0.14, kind, lit, seed + 0.31]);
      // the rolled-gate housing over the opening, the bulkhead face, a door pull
      O.ibox('box_metal', (oa + ob) / 2, top + 0.17, fz(0.14), ow + 0.1, 0.32, 0.28, [0.42, 0.43, 0.45]);
      O.ibox('box_stone', (wx0 + wx1) / 2, bh / 2, fz(0.02), wx1 - wx0, bh, 0.05, R() < 0.5 ? [0.2, 0.2, 0.22] : mul(baseCol, 0.75));
      // the sign: a box sign on the band (most shops), or an awning carrying the word on its valance; a few have both
      const word = o.word ?? Math.floor(R() * SHOP_WORDS.length), cell = o.cell ?? shopCell(word, Math.floor(R() * 3)), sh = 0.8 + R() * 0.3, sy = top + 0.36 + sh / 2;
      const kindSign = o.cell != null ? 0 : R();
      if (kindSign < 0.72) {
        O.ibox('box_paint', (a + b) / 2, sy, fz(0.11), sw - 0.15, sh + 0.1, 0.2, [0.1, 0.1, 0.11]);
        O.ibox('sign', (a + b) / 2, sy, fz(0.215), sw - 0.3, sh, 1, [1, 1, 1], 0, ry, 0, [cell, 1, 0, 0]);
      }
      if (kindSign > 0.55 || (kindSign < 0.72 && R() < 0.25)) {                     // a sloped awning (canvas or ribbed metal) under the band
        const ad = 0.9 + R() * 0.5, ay = top + 0.3, aw = AWN[Math.floor(R() * AWN.length)], slope = 0.36;
        O.ibox('box_paint', (oa + ob) / 2, ay - Math.sin(slope) * ad / 2, fz(Math.cos(slope) * ad / 2 + 0.05), ow + 0.25, 0.05, ad, aw, (n > 0 ? 1 : -1) * slope);
        const vy = ay - Math.sin(slope) * ad - 0.18;
        O.ibox('box_paint', (oa + ob) / 2, vy, fz(Math.cos(slope) * ad + 0.07), ow + 0.25, 0.36, 0.03, aw);
        if (kindSign >= 0.72) O.ibox('sign', (oa + ob) / 2, vy, fz(Math.cos(slope) * ad + 0.09), Math.min(ow, 4.6), 0.3, 1, [1, 1, 1], 0, ry, 0, [cell, 1, 0, 0]);
      }
      a = b;
    }
    O.breaks = [0.9];
    wallHoles(O, frameM, frameC, fz(0), n, x0, x0 + len, 0, Hs, holes);
    O.breaks = null;
    for (const [xc, yc, w, h, d, kind, lit, seed] of glaze) O.ibox('win', xc, yc, fz(-d), w, h, 1, [0.55, 0.56, 0.58], 0, ry, 0, [seed, lit, 0, kind]);
  }

  /* ---------------------------------------------------------------- 125th St commercial buildings (above the shops) */
  const STUCCO = ['#e8dcc0', '#d9d4c4', '#c9d3c0', '#e2c9b8', '#cfd6dc', '#f0e6cf'].map(hex), LIME = ['#e3d8bf', '#d8ccb0', '#ece2cc'].map(hex);
  function commercial(O, rec, B, o = {}) {
    const { n, zf, x0, x1, len, H, R, fz, bx, bodyCol, win, cornice } = B;
    const f = Math.max(1, rec.floors), v = (rec.seed >>> 3) % 10, Hs0 = Math.min(4.5, H - 1.1);
    if (H < 8.6 || f <= 1) {                                                         // a one-storey "taxpayer": shops + a tall parapet with a coping
      shopRow(O, rec, B, Hs0, o);
      const pc = v < 4 ? bodyCol : v < 7 ? STUCCO[v % STUCCO.length] : LIME[v % 3], pm = v < 4 ? 'brick' : 'stone';
      O.ao = aoProfile(H - 0.3, zf, n); wallHoles(O, pm, pc, fz(0), n, x0, x1, Hs0, H, []); O.ao = null;
      bx('stone', x0 - 0.02, H - 0.25, 0, x1 + 0.02, H, 0.16, mul(pc, 0.85));
      if (len > 9 && v % 2) bx('stone', x0 + len * 0.3, H - 0.05, 0, x1 - len * 0.3, H + 0.6, 0.1, mul(pc, 0.9));            // a raised name panel (blank)
      return;
    }
    const modern = rec.year >= 1955, loft = !modern && v >= 6, stucco = !modern && !loft && v >= 4;
    const Hc = modern ? 0.4 : loft ? 0.9 : clamp(0.05 * H, 0.8, 1.2), top = H - Hc, Hs = (top - Hs0) / Math.max(1, f - 1);
    const nb = loft ? Math.max(2, Math.round(len / 4.3)) : modern ? Math.max(2, Math.round(len / 3.2)) : Math.max(2, rec.bays), colW = len / nb, cx = (i) => x0 + (i + 0.5) * colW;
    const col = loft ? LIME[v % 3] : stucco ? STUCCO[(rec.seed >>> 7) % STUCCO.length] : modern ? mix(bodyCol, [0.62, 0.6, 0.58], 0.6) : bodyCol;
    const mat = loft || stucco ? 'stone' : modern ? 'panel' : 'brick';
    const holes = [], wins = [];
    for (let k = 1; k < f; k++) for (let i = 0; i < nb; i++) {
      const y0 = Hs0 + (k - 1) * Hs, xc = cx(i);
      if (loft) { const w = colW - 0.9, sill = y0 + Hs * 0.18, h = Hs * 0.64; holes.push({ x0: xc - w / 2, x1: xc + w / 2, y0: sill, y1: sill + h, rv: 0.25 }); for (const s of [-1, 0, 1]) wins.push({ xc: xc + s * w / 3, yc: sill + h / 2, w: w / 3 - 0.06, h, k, kind: 1, bare: true }); }
      else if (stucco && colW > 2.6) { const w = 0.8, sill = y0 + Hs * 0.27, h = Hs * 0.55; for (const s of [-1, 1]) { holes.push({ x0: xc + s * 0.5 - w / 2, x1: xc + s * 0.5 + w / 2, y0: sill, y1: sill + h }); wins.push({ xc: xc + s * 0.5, yc: sill + h / 2, w, h, k }); } }
      else { const w = modern ? colW * 0.8 : clamp(colW * 0.5, 0.8, 1.15), sill = y0 + Hs * (modern ? 0.22 : 0.27), h = Hs * (modern ? 0.6 : 0.55); holes.push({ x0: xc - w / 2, x1: xc + w / 2, y0: sill, y1: sill + h, rv: 0.22 }); wins.push({ xc, yc: sill + h / 2, w, h, k, kind: modern ? 2 : undefined, bare: modern }); }
    }
    shopRow(O, rec, B, Hs0, o);
    O.breaks = [top - 0.8]; O.ao = aoProfile(top, zf, n);
    wallHoles(O, mat, col, fz(0), n, x0, x1, Hs0, top, holes);
    O.ao = null; O.breaks = null;
    for (const w of wins) win(w.xc, w.yc, w.w, w.h, { k: w.k, kind: w.kind, bare: w.bare, noLintel: loft || modern, sash: modern || loft ? FRAME : undefined, trim: stucco ? mul(col, 0.88) : undefined });
    if (loft) {                                                                      // stone piers between the loft bays, a simple stone cornice and a parapet cap
      for (let i = 0; i <= nb; i++) { const xp = x0 + i * colW; bx('stone', Math.max(x0, xp - 0.3), Hs0, 0, Math.min(x1, xp + 0.3), top, 0.14, mul(col, 0.95)); }
      for (let k = 2; k < f; k++) O.ibox('box_stone', (x0 + x1) / 2, Hs0 + (k - 1) * Hs - 0.1, fz(0.06), len, 0.2, 0.12, mul(col, 0.9));
      bx('stone', x0, top, 0, x1, top + 0.35, 0.45, mul(col, 0.92), 'in'); bx('stone', x0, top + 0.35, 0, x1, H, 0.12, col); bx('stone', x0 - 0.02, H - 0.12, 0, x1 + 0.02, H, 0.2, mul(col, 0.85));
    } else if (modern) { bx('panel', x0, top, 0, x1, H, 0.1, mul(col, 0.8)); for (let k = 2; k < f; k++) O.ibox('box_stone', (x0 + x1) / 2, Hs0 + (k - 1) * Hs, fz(0.04), len, 0.1, 0.08, mul(col, 1.15)); }
    else if (stucco) { bx('stone', x0, top, 0, x1, top + Hc * 0.55, 0.2, mul(col, 0.92), 'in'); bx('stone', x0 - 0.02, top + Hc * 0.55, 0, x1 + 0.02, H, 0.35, mul(col, 0.85), 'in'); }
    else cornice(top, Hc, mul(bodyCol, 0.55), { proj: 0.55, dentils: true });
    if (rec.fireEscape && !modern && !loft) {
      const fc = Math.max(0, Math.min(nb - 2, Math.round(nb / 2 - 1 + (R() < 0.5 ? -1 : 0)))), fx0 = cx(fc) - colW * 0.55, fx1 = cx(fc + 1) + colW * 0.55, fxm = (fx0 + fx1) / 2, fl = fx1 - fx0;
      for (let k = 1; k < f; k++) {
        const y = Hs0 + (k - 1) * Hs + Hs * 0.2, dd = 1.0;
        O.ibox('box_iron', fxm, y, fz(dd / 2), fl, 0.05, dd, IRON); O.ibox('box_iron', fxm, y + 0.95, fz(dd), fl, 0.04, 0.04, IRON);
        for (const sx of [fx0, fx1]) O.ibox('box_iron', sx, y + 0.5, fz(dd / 2), 0.04, 1.0, dd, IRON);
        for (let x = fx0 + 0.15; x < fx1; x += 0.3) O.ibox('box_iron', x, y + 0.5, fz(dd), 0.02, 0.95, 0.02, IRON);
        if (k > 1) O.ibox('box_iron', fx1 - 0.35, y - Hs / 2, fz(dd / 2), 0.5, 0.04, Math.hypot(Hs, dd) * 0.97, IRON, Math.atan2(Hs, dd) * n * -1);
      }
    }
  }

  /* ---------------------------------------------------------------- the Apollo Theater (LP-1299): photos build/ref/harlem/apollo_*.jpg, proportions in SOURCES.md */
  function apollo(O, rec, B) {
    const { n, zf, x0, x1, len, H, fz, bx } = B, ry = n > 0 ? 0 : PI, xm = (x0 + x1) / 2;
    const TC = hex('#dccb9f'), TCd = mul(TC, 0.86), BLK = [0.05, 0.05, 0.06], CREAM = hex('#f1d98c'), NEON_B = [0.25, 0.6, 1.0], NEON_R = [1.0, 0.16, 0.1];
    const yG = 4.7, yM0 = 4.75, yM1 = 6.6, yU = 6.9, yE = 0.73 * H, yC = 0.81 * H, yB = 0.86 * H, yP = 0.93 * H;          // ground, marquee, upper facade, entablature, cornice, balustrade
    // ground floor: black granite frame, four lit lobby doors under a glazed transom, a poster case each side
    const holes = [], glz = [], dW = 1.35, dG = 0.25, dTot = 4 * dW + 3 * dG;
    for (let i = 0; i < 4; i++) { const a = xm - dTot / 2 + i * (dW + dG); holes.push({ x0: a, x1: a + dW, y0: 0, y1: 2.75, rv: 0.4, noBack: true }); glz.push([a + dW / 2, 1.375, dW, 2.75, 0.4]); }
    holes.push({ x0: xm - dTot / 2, x1: xm + dTot / 2, y0: 2.95, y1: yG - 0.35, rv: 0.3, noBack: true }); glz.push([xm, (2.95 + yG - 0.35) / 2, dTot, yG - 0.35 - 2.95, 0.3]);
    for (const s of [-1, 1]) { const c = xm + s * (dTot / 2 + 1.6); holes.push({ x0: c - 0.8, x1: c + 0.8, y0: 0.7, y1: 2.9, rv: 0.12, noBack: true }); glz.push([c, 1.8, 1.6, 2.2, 0.12]); }
    O.breaks = [0.9]; wallHoles(O, 'stone', [0.12, 0.11, 0.11], fz(0), n, x0, x1, 0, yG, holes); O.breaks = null;
    glz.forEach(([xc, yc, w, h, d], i) => O.ibox('win', xc, yc, fz(-d), w, h, 1, [0.7, 0.62, 0.4], 0, ry, 0, [0.37 + i * 0.13, 1, 0, 5]));
    bx('stone', x0, yG - 0.05, 0, x1, yU, 0.06, mul(TC, 0.9));
    // the marquee: a black box over the sidewalk with letter boards (abstract), blue neon top + bottom, a grid of bulbs underneath, the APOLLO crown on top
    const mx0 = x0 + 0.25, mx1 = x1 - 0.25, mw = mx1 - mx0, md = 3.1;
    bx('paint', mx0, yM0, 0.05, mx1, yM1, md, BLK);
    O.ibox('sign', xm, (yM0 + yM1) / 2, fz(md + 0.02), mw - 0.5, 1.35, 1, [1, 1, 1], 0, ry, 0, [CELL.board, 1, 0, 0]);
    for (const [ex, sgn] of [[mx0, -1], [mx1, 1]]) O.ibox('sign', ex + sgn * 0.02, (yM0 + yM1) / 2, fz(md / 2 + 0.05), md - 0.4, 1.35, 1, [1, 1, 1], 0, ry + sgn * PI / 2, 0, [CELL.board, 0.25, 0, 0]);
    for (const y of [yM1 - 0.08, yM1 - 0.2, yM0 + 0.1]) {
      O.ibox('lensb', xm, y, fz(md + 0.06), mw + 0.08, 0.05, 0.05, NEON_B);
      for (const ex of [mx0 - 0.04, mx1 + 0.04]) O.ibox('lensb', ex, y, fz(md / 2 + 0.05), 0.05, 0.05, md, NEON_B);
    }
    for (let d = 0.45; d < md - 0.1; d += 0.52) for (let x = mx0 + 0.3; x < mx1 - 0.2; x += 0.5) O.ibox('lamp', x, yM0 - 0.04, fz(d), 0.11, 0.08, 0.11, [1, 0.95, 0.8]);
    const cw = 5.4, ch = 1.25;                                                       // the crown: a cream box sign, red APOLLO, red neon outline
    O.ibox('box_paint', xm, yM1 + ch / 2, fz(md - 0.35), cw, ch, 0.35, CREAM);
    O.ibox('sign', xm, yM1 + ch / 2, fz(md - 0.17), cw - 0.15, ch - 0.12, 1, [1, 1, 1], 0, ry, 0, [CELL.apollo, 0.58, 0, 0]);
    for (const y of [yM1 + 0.04, yM1 + ch - 0.04]) O.ibox('lensb', xm, y, fz(md - 0.16), cw, 0.05, 0.04, NEON_R);
    for (const s of [-1, 1]) O.ibox('lensb', xm + s * cw / 2, yM1 + ch / 2, fz(md - 0.16), 0.05, ch, 0.04, NEON_R);
    // the upper facade: four bays of paired windows between five fluted pilasters with capitals; a spandrel panel between the two window tiers
    const nb = 4, colW = len / nb, pw = 0.62, wins = [];
    const uh = [];
    for (let i = 0; i < nb; i++) {
      const xc = x0 + (i + 0.5) * colW, w = colW - pw - 0.55, ya = yU + 0.45, yb = ya + (yE - yU) * 0.38, ys = yb + (yE - yU) * 0.14, yt = yE - 0.45;
      uh.push({ x0: xc - w / 2, x1: xc + w / 2, y0: ya, y1: yb, rv: 0.25 }, { x0: xc - w / 2, x1: xc + w / 2, y0: ys, y1: yt, rv: 0.25 });
      wins.push([xc, (ya + yb) / 2, w, yb - ya], [xc, (ys + yt) / 2, w, yt - ys]);
      O.ibox('box_stone', xc, (yb + ys) / 2, fz(0.03), w - 0.1, ys - yb - 0.2, 0.08, mul(TC, 0.93));                 // the spandrel's sunk panel + its medallion
      O.ibox('box_stone', xc, (yb + ys) / 2, fz(0.08), 0.5, 0.45, 0.1, mul(TC, 0.97));
    }
    O.breaks = [yE - 0.1]; O.ao = aoProfile(yC, zf, n); wallHoles(O, 'stone', TC, fz(0), n, x0, x1, yU, yE, uh); O.ao = null; O.breaks = null;
    for (const [xc, yc, w, h] of wins) { for (const s of [-1, 1]) O.ibox('win', xc + s * w / 4, yc, fz(-0.2), w / 2 - 0.05, h, 1, FRAME, 0, ry, 0, [xc * 0.37 + yc + s, (xc + yc) % 2 > 1 ? 1 : 0, 0, 2]); O.ibox('box_stone', xc, yc - h / 2 - 0.07, fz(0.06), w + 0.2, 0.12, 0.2, TCd); }
    for (let i = 0; i <= nb; i++) {
      const xp = clamp(x0 + i * colW, x0 + pw / 2, x1 - pw / 2);
      bx('stone', xp - pw / 2, yU, 0, xp + pw / 2, yE, 0.2, TC);
      for (const s of [-0.18, 0, 0.18]) O.ibox('box_stone', xp + s, (yU + yE) / 2 + 0.2, fz(0.205), 0.07, yE - yU - 1.0, 0.02, mul(TC, 0.78));       // flutes
      bx('stone', xp - pw / 2 - 0.08, yE - 0.55, 0, xp + pw / 2 + 0.08, yE - 0.05, 0.3, mul(TC, 1.02));                                                // capital
      O.ibox('box_stone', xp, yE - 0.62, fz(0.29), pw + 0.26, 0.16, 0.12, mul(TC, 0.95));
    }
    // the entablature: architrave, frieze, a deep modillioned cornice, the balustrade
    bx('stone', x0, yE, 0, x1, yE + 0.45, 0.32, mul(TC, 0.96)); bx('stone', x0, yE + 0.45, 0, x1, yC, 0.14, TC);
    for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.62) O.ibox('box_stone', x, yC + 0.05, fz(0.45), 0.18, 0.2, 0.7, TCd);
    bx('stone', x0 - 0.05, yC + 0.15, 0, x1 + 0.05, yB, 0.95, mul(TC, 0.98), 'in'); bx('stone', x0 - 0.05, yC - 0.05, 0, x1 + 0.05, yC + 0.15, 0.55, mul(TC, 0.8), 'in');
    bx('stone', x0, yB, 0, x1, yB + 0.2, 0.3, TCd);
    for (let i = 0; i <= nb; i++) { const xp = clamp(x0 + i * colW, x0 + 0.3, x1 - 0.3); bx('stone', xp - 0.3, yB, 0, xp + 0.3, yP, 0.3, TC); }
    for (let x = x0 + 0.35; x < x1 - 0.3; x += 0.3) if (Math.abs(((x - x0) % colW) - 0) > 0.4 && Math.abs(((x - x0) % colW) - colW) > 0.4) O.ibox('box_stone', x, (yB + 0.2 + yP - 0.18) / 2, fz(0.15), 0.13, yP - yB - 0.38, 0.13, mul(TC, 0.95));
    bx('stone', x0, yP - 0.18, 0, x1, yP, 0.32, TCd);
    // the attic behind the balustrade (closes the front up to the roof line)
    bx('brick', x0, yP - 0.2, -1.4, x1, H, -1.2, mul(PAL.brick[3], 0.7));
    O.quad('roof', [x0, yP - 0.2, fz(0)], [x1, yP - 0.2, fz(0)], [x1, yP - 0.2, fz(-1.3)], [x0, yP - 0.2, fz(-1.3)], [0, 1, 0], [0.24, 0.24, 0.26]);
    // the APOLLO blade: a tall cream sign perpendicular to the front on the second pilaster, red neon letters on both faces, red neon edges, two iron arms
    const bxp = x0 + colW, b0 = H * 0.42, b1 = H + 4.6, bd0 = 0.55, bd1 = 2.05, bt = 0.42, bh = b1 - b0;
    bx('paint', bxp - bt / 2, b0, bd0, bxp + bt / 2, b1, bd1, CREAM);
    for (const s of [-1, 1]) {
      O.ibox('sign', bxp + s * (bt / 2 + 0.01), (b0 + b1) / 2, fz((bd0 + bd1) / 2), bh - 0.3, bd1 - bd0 - 0.18, 1, [1, 1, 1], 0, ry + s * PI / 2, PI / 2, [CELL.blade, 1, 0, 0]);
      for (const d of [bd0 + 0.03, bd1 - 0.03]) O.ibox('lensb', bxp + s * (bt / 2 + 0.02), (b0 + b1) / 2, fz(d), 0.04, bh, 0.05, NEON_R);
      for (const y of [b0 + 0.03, b1 - 0.03]) O.ibox('lensb', bxp + s * (bt / 2 + 0.02), y, fz((bd0 + bd1) / 2), 0.04, 0.05, bd1 - bd0, NEON_R);
    }
    for (const y of [b0 + 1.2, b0 + bh * 0.55]) O.ibox('box_iron', bxp, y, fz(bd0 / 2 + 0.1), 0.12, 0.12, bd0 + 0.2, IRON);
    // the steel lattice frame on the roof behind the blade
    const fx0 = bxp - 1.6, fx1 = bxp + 1.6, fd0 = -2.2, fd1 = -5.4, f0 = H, f1 = H + 7.2, fs = (f1 - f0) / 3;
    for (const x of [fx0, fx1]) for (const d of [fd0, fd1]) O.ibox('box_iron', x, (f0 + f1) / 2, fz(d), 0.14, f1 - f0, 0.14, IRON);
    for (let k = 0; k <= 3; k++) { const y = f0 + k * fs; for (const d of [fd0, fd1]) O.ibox('box_iron', bxp, y, fz(d), fx1 - fx0, 0.1, 0.1, IRON); for (const x of [fx0, fx1]) O.ibox('box_iron', x, y, fz((fd0 + fd1) / 2), 0.1, 0.1, Math.abs(fd1 - fd0), IRON); }
    for (let k = 0; k < 3; k++) { const yc = f0 + (k + 0.5) * fs, Lx = Math.hypot(fx1 - fx0, fs), Ld = Math.hypot(fd1 - fd0, fs), ax = Math.atan2(fs, fx1 - fx0), ad = Math.atan2(fs, Math.abs(fd1 - fd0));
      for (const d of [fd0, fd1]) for (const s of [-1, 1]) O.ibox('box_iron', bxp, yc, fz(d), Lx, 0.07, 0.07, IRON, 0, ry, s * ax);
      for (const x of [fx0, fx1]) for (const s of [-1, 1]) O.ibox('box_iron', x, yc, fz((fd0 + fd1) / 2), 0.07, 0.07, Ld, IRON, s * ad); }
    // night glow: the facade washed warm, the blade's red halo, the sidewalk under the marquee (additive pools; street.js turns them on at night)
    O.ibox('pool', xm, (yU + yP) / 2, fz(0.33), len * 1.15, (yP - yU) * 1.2, 1, [1.0, 0.72, 0.45], 0, ry);
    for (const s of [-1, 1]) O.ibox('pool', bxp + s * 0.3, (b0 + b1) / 2, fz((bd0 + bd1) / 2), 5.5, bh * 1.15, 1, [1.0, 0.25, 0.15], 0, ry + s * PI / 2);
    O.ibox('pool', xm, 0.015, fz(md * 0.6), mw * 1.2, md * 3.2, 1, [1.0, 0.85, 0.6], -PI / 2);
  }

  /* ---------------------------------------------------------------- Hotel Theresa (1913, George & Edward Blum): photos build/ref/harlem/theresa*.jpg */
  function theresa(O, rec, B, o = {}) {
    const { n, zf, x0, x1, len, H, fz, bx, R } = B, ry = n > 0 ? 0 : PI;
    const W = hex('#f1ede2'), Wd = mul(W, 0.86), BR = hex('#efe9da'), f = 13;
    const yS = 5.0, y2 = 8.6, yT = H - 3.4, Hs = (yT - y2) / (f - 2), yA = yT - 2 * Hs;               // shops, the 2nd floor, the typical floors, the arched top two floors
    shopRow(O, rec, B, yS - 0.4, {});
    bx('stone', x0, yS - 0.45, 0, x1, yS, 0.25, Wd);
    const nb = Math.max(2, Math.round(len / 3.4)), colW = len / nb, holes = [], wins = [], pw = 0.5;
    for (let i = 0; i < nb; i++) {
      const xc = x0 + (i + 0.5) * colW;
      holes.push({ x0: xc - colW * 0.36, x1: xc + colW * 0.36, y0: yS + 0.5, y1: y2 - 0.6, rv: 0.25 }); for (const s of [-1, 1]) wins.push([xc + s * colW * 0.18, (yS + y2 - 0.1) / 2, colW * 0.34, y2 - 0.6 - yS - 0.5, 1, 1]);
      for (let k = 2; k < f; k++) {
        const y0 = y2 + (k - 2) * Hs, top = k >= f - 2, sill = y0 + Hs * 0.22, h = Hs * (top ? 0.68 : 0.56);
        for (const s of [-1, 1]) { const wx = xc + s * colW * 0.2, w = colW * 0.27; holes.push({ x0: wx - w / 2, x1: wx + w / 2, y0: sill, y1: sill + h, rv: 0.2 }); wins.push([wx, sill + h / 2, w, h, k, top ? 2 : 3]); }
      }
    }
    O.breaks = [y2, yA]; O.ao = aoProfile(yT, zf, n);
    wallHoles(O, 'stone', W, fz(0), n, x0, x1, yS, y2, holes.filter((h) => h.y1 <= y2));
    wallHoles(O, 'whitebrick', BR, fz(0), n, x0, x1, y2, yT, holes.filter((h) => h.y1 > y2));
    O.ao = null; O.breaks = null;
    for (const [xc, yc, w, h, k, kind] of wins) {
      O.ibox('win', xc, yc, fz(-0.17), w, h, 1, FRAME, 0, ry, 0, [R(), R() < 0.55 ? 1 : 0, R(), kind]);
      if (k >= 2 && k < f - 2) O.ibox('box_stone', xc, yc - h / 2 - 0.06, fz(0.06), w + 0.16, 0.1, 0.18, Wd);
      if (k >= f - 2) for (let j = 0; j < 3; j++) O.ibox('box_stone', xc, yc + h / 2 + 0.08 + j * 0.12, fz(0.05), w * (1 - j * 0.28) + 0.1, 0.12, 0.14, W);       // stepped arch heads
    }
    for (let i = 0; i <= nb; i++) { const xp = clamp(x0 + i * colW, x0 + pw / 2, x1 - pw / 2); bx('stone', xp - pw / 2, y2, 0, xp + pw / 2, yT, 0.18, W); bx('stone', xp - pw / 2 - 0.06, yA - 0.3, 0, xp + pw / 2 + 0.06, yA, 0.28, Wd); }
    for (const y of [y2, yA]) bx('stone', x0, y - 0.15, 0, x1, y + 0.2, 0.32, Wd);
    for (let k = 3; k < f - 2; k += 3) O.ibox('box_stone', (x0 + x1) / 2, y2 + (k - 2) * Hs - 0.05, fz(0.08), len, 0.14, 0.14, Wd);
    // the cornice, the parapet and its crests (a pointed pediment with a finial over every other pier)
    bx('stone', x0 - 0.05, yT, 0, x1 + 0.05, yT + 0.5, 0.62, Wd, 'in'); for (let x = x0 + 0.2; x < x1; x += 0.55) O.ibox('box_stone', x, yT - 0.12, fz(0.3), 0.14, 0.24, 0.5, Wd);
    bx('stone', x0, yT + 0.5, 0, x1, H, 0.22, W); bx('stone', x0 - 0.03, H - 0.15, 0, x1 + 0.03, H + 0.05, 0.3, Wd);
    for (let i = 0; i <= nb; i += 2) {
      const xp = clamp(x0 + i * colW, x0 + 1.3, x1 - 1.3), base = H + 0.05, hh = 1.9, w = 2.5;
      for (const d of [0.02, 0.28]) O.tri('stone', [xp - w / 2, base, fz(d)], [xp + w / 2, base, fz(d)], [xp, base + hh, fz(d)], [0, 0, d > 0.1 ? n : -n], W, [xp - w / 2, base], [xp + w / 2, base], [xp, base + hh]);
      for (const s of [-1, 1]) O.quad('stone', [xp + s * w / 2, base, fz(0.02)], [xp, base + hh, fz(0.02)], [xp, base + hh, fz(0.28)], [xp + s * w / 2, base, fz(0.28)], [s * hh, w / 2, 0], Wd);
      O.ibox('box_stone', xp, base + hh + 0.3, fz(0.15), 0.3, 0.6, 0.3, W); O.ibox('box_stone', xp, base + 0.75, fz(0.32), 0.7, 0.7, 0.1, mul(W, 0.93));
    }
    if (o.sign) O.ibox('sign', (x0 + x1) / 2, yT + 1.5, fz(0.235), Math.min(len - 3, 9.5), 1.0, 1, [1, 1, 1], 0, ry, 0, [CELL.theresa, 1, 0, 0]);
  }

  /* ---------------------------------------------------------------- the State Office Building (1973, Ifill Johnson Hanchard): photos build/ref/harlem/sob*.jpg */
  // the slab is drawn whole (four faces + the roof); `faces` turns O.T for each face: [x0, x1, zf, rotation]
  function sob(O, rec, unitT, plaza) {
    const poly = rec.poly, us = poly.map((p) => p[0]), vs = poly.map((p) => p[1]), u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs), H = rec.h;
    const C = hex('#bfae92'), Cd = mul(C, 0.8), th = unitT ? Math.atan2(unitT.s, unitT.c) : 0, T0 = O.T;
    const yB = 9.6, yT0 = 11.4, yCr = H - 6.6, nf = 17, Hs = (yCr - yT0) / nf, R = rng(rec.seed + 5);
    // face list in their own frames (x along, the face at z = zf, normal +z): front (v1, +v), back (v0, -v), east end (u1, +u), west end (u0, -u)
    const FACES = [[u0, u1, v1, 0, true], [-u1, -u0, -v0, PI, true], [-v1, -v0, u1, PI / 2, false], [v0, v1, -u0, -PI / 2, false]];
    for (const [a, b, zf, rot, long] of FACES) {
      O.T = { c: Math.cos(th + rot), s: Math.sin(th + rot), tx: 0, tz: 0 };
      const L = b - a, fz = (d) => zf + d, box = (mat, xa, ya, d0, xb, yb, d1, col) => O.box(mat, xa, ya, fz(d0), xb, yb, fz(d1), col);
      // the recessed glass base with its columns, the transfer band
      const rec0 = 3.2; box('stone', a, 0, -rec0 - 0.4, b, yB, -rec0, Cd);
      O.ibox('win', (a + b) / 2, yB / 2 - 0.3, fz(-rec0 + 0.02), L - 0.4, yB - 1.6, 1, FRAME, 0, 0, 0, [R(), 1, 0, 5]);
      O.quad('paint', [a, yB, fz(0)], [b, yB, fz(0)], [b, yB, fz(-rec0)], [a, yB, fz(-rec0)], [0, -1, 0], [0.32, 0.3, 0.27]);          // the soffit
      for (let x = a + 1.0; x < b - 0.5; x += 3.0) O.ibox('box_stone', x, yB - 0.25, fz(-rec0 / 2), 0.25, 0.5, rec0, mul(Cd, 0.8));      // coffer ribs
      const nc = long ? 5 : 2; for (let i = 0; i < nc; i++) { const x = a + 0.9 + (i * (L - 1.8)) / (nc - 1); box('stone', x - 0.85, 0, -1.7, x + 0.85, yB, 0, C); }
      box('stone', a, yB, -0.2, b, yT0, 0.35, C);
      // the shaft: solid end zones (the stair cores) and, between them, close piers with dark glass and spandrels (long faces); a central glazed strip (ends)
      const ez = long ? 5.2 : (L - 7.2) / 2, ga = a + ez, gb = b - ez;
      box('stone', a, yT0, -0.1, ga, yCr, 0.3, C); box('stone', gb, yT0, -0.1, b, yCr, 0.3, C);
      for (const x of [ga, gb]) O.ibox('box_stone', x, (yT0 + yCr) / 2, fz(0.32), 0.1, yCr - yT0, 0.06, Cd);
      const nbay = Math.max(2, Math.round((gb - ga) / 1.62)), bw = (gb - ga) / nbay;
      box('paint', ga, yT0, -0.6, gb, yCr, -0.55, [0.14, 0.15, 0.17]);
      for (let k = 0; k < nf; k++) {
        const y0 = yT0 + k * Hs;
        O.ibox('box_stone', (ga + gb) / 2, y0 + 0.35, fz(-0.3), gb - ga, 0.7, 0.5, [0.24, 0.24, 0.25]);                                   // the spandrel band (dark: the piers read)
        for (let i = 0; i < nbay; i++) O.ibox('win', ga + (i + 0.5) * bw, y0 + 0.9 + (Hs - 0.9) / 2, fz(-0.5), bw - 0.42, Hs - 0.95, 1, FRAME, 0, 0, 0, [R(), R() < 0.45 ? 1 : 0, R(), 2]);
      }
      for (let i = 0; i <= nbay; i++) { const x = ga + i * bw; O.ibox('box_stone', x, (yT0 + yCr) / 2, fz(-0.05), 0.42, yCr - yT0, 0.95, C); }
      // the crown: a solid band with vertical grooves, a thin coping
      box('stone', a, yCr, -0.1, b, H, 0.3, C);
      for (let x = a + 0.6; x < b - 0.3; x += 0.9) O.ibox('box_stone', x, (yCr + H) / 2 - 0.3, fz(0.31), 0.18, H - yCr - 1.6, 0.04, Cd);
      box('stone', a - 0.05, H - 0.3, -0.1, b + 0.05, H, 0.4, mul(C, 1.05));
    }
    O.T = T0;
    const cap = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; O.quad('roof', [u0, H, v0], [u1, H, v0], [u1, H, v1], [u0, H, v1], [0, 1, 0], [0.3, 0.3, 0.3]); void cap;
    O.box('panel', u0 + 8, H, v0 + 6, u1 - 8, H + 3.2, v1 - 6, [0.52, 0.5, 0.48]);                                                         // the rooftop plant
    // the plaza: granite paving from the lot line to the slab, a row of bollards on the sidewalk edge, planters with honey locusts
    if (plaza) {
      const { a, b, z0, z1, line } = plaza, PZ = hex('#c9c3b6');
      O.quad('sidewalk', [a, 0.012, z0], [b, 0.012, z0], [b, 0.012, z1], [a, 0.012, z1], [0, 1, 0], PZ);
      for (let x = a + 0.8; x < b - 0.5; x += 1.7) O.ibox('cyl', x, 0.45, line - 0.4, 0.28, 0.9, 0.28, [0.3, 0.3, 0.31]);
      const pts = [];
      for (const [px, pz] of [[a + 18, (z0 + z1) / 2], [a + 34, (z0 + z1) / 2 + 3], [b - 14, (z0 + z1) / 2]]) {
        if (px > b - 2) continue;
        O.box('stone', px - 1.6, 0, pz - 1.6, px + 1.6, 0.55, pz + 1.6, mul(PZ, 0.85)); O.quad('paint', [px - 1.4, 0.56, pz - 1.4], [px + 1.4, 0.56, pz - 1.4], [px + 1.4, 0.56, pz + 1.4], [px - 1.4, 0.56, pz + 1.4], [0, 1, 0], [0.16, 0.11, 0.07]);
        pts.push([px, pz, 4]);
      }
      return pts;
    }
    return [];
  }

  /* ---------------------------------------------------------------- the 125 St (2 / 3) entrance on Lenox: a stairwell down to a lit passage */
  function subway(O, col, sub) {
    const [x0, z0, x1, z1] = sub.rect, GRN = hex('#2f5d46'), CON = [0.46, 0.45, 0.43], TILE = hex('#e9e4d4'), N = 20, rise = 0.18, tread = 0.28, depth = N * rise;
    const zs = z0 + 0.35, ze = zs + N * tread, zl = z1 - 0.12, iw0 = x0 + 0.18, iw1 = x1 - 0.18;                       // first nosing, last riser, the landing's end wall
    // the coping round the well (granite), the walls of the well (concrete, then cream tile below the sidewalk level), the steps, the landing
    O.box('granite', x0, -0.02, z0, x1, 0.06, z0 + 0.18, [0.7, 0.7, 0.68]); O.box('granite', x0, -0.02, z1 - 0.18, x1, 0.06, z1, [0.7, 0.7, 0.68]);
    for (const xa of [x0, iw1]) O.box('granite', xa, -0.02, z0, xa + 0.18, 0.06, z1, [0.7, 0.7, 0.68]);
    // slice 3 step 3: the walls are NYC off-white glazed tile (a grout grid) with a dark-green tile band that runs parallel to the stair, then along the landing; concrete collar above
    const slope = rise / tread, uAt = (z) => -rise - slope * (z - zs) + 1.62, TILEW = [0.9, 0.88, 0.8], GROUT = [0.62, 0.6, 0.55], BAND = hex('#2a5f49'), BANDL = hex('#d8d0b0');
    const zA = zs + (1.62 - rise + 0.05) / slope;                       // the band's upper edge enters the ground at zA (clipped just below 0)
    for (const [xw, nx] of [[iw0, 1], [iw1, -1]]) {
      O.quad('granite', [xw, -0.5, z0], [xw, -0.5, z1], [xw, 0.0, z1], [xw, 0.0, z0], [nx, 0, 0], mul(CON, 0.85));                          // the collar
      O.quad('paint', [xw, -depth - 0.2, z0], [xw, -depth - 0.2, z1], [xw, -0.5, z1], [xw, -0.5, z0], [nx, 0, 0], TILEW);
      const xg = xw + nx * 0.006;
      for (let z = z0 + 0.45; z < z1 - 0.1; z += 0.45) O.quad('paint', [xg, -depth - 0.2, z], [xg, -depth - 0.2, z + 0.012], [xg, -0.5, z + 0.012], [xg, -0.5, z], [nx, 0, 0], GROUT);   // the vertical grout lines
      for (let y = -0.7; y > -depth - 0.2; y -= 0.3) O.quad('paint', [xg, y, z0], [xg, y, z1], [xg, y + 0.012, z1], [xg, y + 0.012, z0], [nx, 0, 0], GROUT);                           // the courses
      const xb = xw + nx * 0.012;
      O.quad('paint', [xb, uAt(zA) - 0.32, zA], [xb, uAt(ze) - 0.32, ze], [xb, uAt(ze), ze], [xb, uAt(zA), zA], [nx, 0, 0], BAND);                // the green band on the rake
      O.quad('paint', [xb, -depth + 1.3, ze], [xb, -depth + 1.3, zl], [xb, -depth + 1.62, zl], [xb, -depth + 1.62, ze], [nx, 0, 0], BAND);        // ... and along the landing
      for (const dy of [0.0, -0.32]) { const a1 = uAt(zA) + dy, a2 = uAt(ze) + dy; O.quad('paint', [xb + nx * 0.004, a1 - 0.025, zA], [xb + nx * 0.004, a2 - 0.025, ze], [xb + nx * 0.004, a2, ze], [xb + nx * 0.004, a1, zA], [nx, 0, 0], BANDL); }
    }
    O.quad('granite', [iw0, -0.5, z0 + 0.18], [iw1, -0.5, z0 + 0.18], [iw1, 0, z0 + 0.18], [iw0, 0, z0 + 0.18], [0, 0, 1], mul(CON, 0.8));
    // the treads are DARK with a pale nosing, the risers mid grey: the flight reads as steps from the head of the stair, and the light falls away going down
    for (let k = 0; k < N; k++) {
      const y = -(k + 1) * rise, za = zs + k * tread, zb = za + tread, g = 0.30 - k * 0.0065, sh = [g, g, g * 1.04];
      O.quad('granite', [iw0, y, za], [iw1, y, za], [iw1, y, zb], [iw0, y, zb], [0, 1, 0], sh);
      O.quad('granite', [iw0, y, za], [iw1, y, za], [iw1, y + rise, za], [iw0, y + rise, za], [0, 0, -1], [0.56 - k * 0.012, 0.55 - k * 0.012, 0.52 - k * 0.012]);
      O.ibox('box_paint', (iw0 + iw1) / 2, y + 0.01, za + 0.05, iw1 - iw0, 0.03, 0.1, [0.86, 0.85, 0.8]);                                    // the pale nosing
    }
    O.quad('granite', [iw0, -depth, ze], [iw1, -depth, ze], [iw1, -depth, zl], [iw0, -depth, zl], [0, 1, 0], [0.62, 0.6, 0.55]);   // the landing floor: lighter, lit from the passage
    // the passage: a doorway in the end wall, lit inside (fluorescent strip, tile glow), and a ceiling over the landing
    const dh = 2.3, dw = iw1 - iw0 - 0.3;
    O.quad('paint', [iw0, -depth, zl], [iw1, -depth, zl], [iw1, 0, zl], [iw0, 0, zl], [0, 0, -1], TILE);
    O.ibox('lensb', (iw0 + iw1) / 2, -depth + dh / 2, zl - 0.02, dw, dh, 0.02, [1.0, 0.93, 0.74]);                                       // the lit passage (unlit material: reads lit by day too)
    O.ibox('lensb', (iw0 + iw1) / 2, -depth + dh + 0.02, zl - 0.5, dw, 0.04, 0.9, [1.0, 0.98, 0.9]);
    O.ibox('lamp', (iw0 + iw1) / 2, -depth + dh + 0.2, zl - 0.25, iw1 - iw0 - 0.3, 0.06, 0.12, [1, 1, 0.95]);
    O.ibox('pool', (iw0 + iw1) / 2, -depth + 0.02, ze + 0.3, 2.2, 2.6, 1, [1, 0.97, 0.88], -PI / 2);
    O.quad('paint', [iw0, -depth + 2.6, ze - 0.4], [iw1, -depth + 2.6, ze - 0.4], [iw1, -depth + 2.6, zl], [iw0, -depth + 2.6, zl], [0, -1, 0], [0.55, 0.54, 0.5]);
    // NYC railings: square-section green posts, a top + a bottom rail, close balusters; a solid panel on the closed end; handrails down both walls
    const rail = (ax, az, bx2, bz) => {
      const L = Math.hypot(bx2 - ax, bz - az), along = Math.abs(bx2 - ax) > Math.abs(bz - az), H = 1.07;
      for (let t = 0; t <= L + 1e-6; t += L / Math.max(1, Math.round(L / 1.2))) O.ibox('box_iron', ax + (bx2 - ax) * t / L, H / 2, az + (bz - az) * t / L, 0.06, H, 0.06, GRN);
      for (const y of [H, 0.12]) O.ibox('box_iron', (ax + bx2) / 2, y, (az + bz) / 2, along ? L + 0.06 : 0.07, 0.06, along ? 0.07 : L + 0.06, GRN);
      for (let t = 0.15; t < L; t += 0.2) O.ibox('box_iron', ax + (bx2 - ax) * t / L, 0.6, az + (bz - az) * t / L, 0.018, 0.9, 0.018, GRN);
    };
    const rx0 = x0 + 0.09, rx1 = x1 - 0.09, rz0 = z0 + 0.09, rz1 = z1 - 0.09;
    rail(rx0, rz0, rx0, rz1); rail(rx1, rz0, rx1, rz1); rail(rx0, rz1, rx1, rz1);
    O.ibox('box_paint', (rx0 + rx1) / 2, 0.62, rz1 + 0.02, rx1 - rx0, 0.95, 0.03, GRN);
    for (const xw of [iw0 + 0.07, iw1 - 0.07]) O.ibox('box_metal', xw, -depth / 2 + 0.9, (zs + ze) / 2, 0.05, 0.05, Math.hypot(ze - zs, depth) + 0.4, [0.6, 0.62, 0.6], Math.atan2(depth, ze - zs));
    // two lamp posts with green globes at the head (open around the clock), the name boards: across the closed end (south) and on the west railing (the sidewalk)
    for (const x of [rx0, rx1]) { O.ibox('cyl', x, 1.35, rz0, 0.11, 2.7, 0.11, GRN); O.ibox('cyl', x, 2.72, rz0, 0.2, 0.1, 0.2, GRN); O.ibox('sph', x, 3.0, rz0, 0.44, 0.44, 0.44, [0.25, 1.0, 0.45]); }
    const bw = rx1 - rx0 - 0.1, bh = 0.5, by = 1.42;
    for (const s of [-1, 1]) O.ibox('box_iron', (rx0 + rx1) / 2 + s * (bw / 2 - 0.08), (1.07 + by + bh / 2) / 2, rz1, 0.05, by + bh / 2 - 1.07, 0.05, GRN);
    O.ibox('box_paint', (rx0 + rx1) / 2, by, rz1, bw, bh + 0.06, 0.06, [0.06, 0.06, 0.07]);
    O.ibox('sign', (rx0 + rx1) / 2, by, rz1 + 0.035, bw - 0.06, bh - 0.04, 1, [1, 1, 1], 0, 0, 0, [CELL.sub, 0.55, 0, 0]);
    const wb = 1.9, wz = rz0 + 1.2 + wb / 2;
    for (const s of [-1, 1]) O.ibox('box_iron', rx0, (1.07 + by + bh / 2) / 2, wz + s * (wb / 2 - 0.08), 0.05, by + bh / 2 - 1.07, 0.05, GRN);
    O.ibox('box_paint', rx0, by, wz, 0.06, bh + 0.06, wb, [0.06, 0.06, 0.07]);
    O.ibox('sign', rx0 - 0.035, by, wz, wb - 0.06, bh - 0.04, 1, [1, 1, 1], 0, -PI / 2, 0, [CELL.sub, 0.55, 0, 0]);
    col.boxes.push({ x0: x0 - 0.05, z0: z0 - 0.05, x1: x1 + 0.05, z1: z1 + 0.05, y0: 0, y1: 1.1 }); col.subway = { x: (x0 + x1) / 2, z: z0 };
    for (const x of [rx0, rx1]) col.circles.push([x, rz0, 0.12]);
  }

  /* ---------------------------------------------------------------- Marcus Garvey Park: the west edge, the Acropolis hill, the Fire Watchtower, a wooded canopy */
  function park(O, M, u, col) {
    const { x0, x1, z0, z1, kerb, wt, hill } = u, R = rng(1856), GR = hex('#5d7a3c'), LEAF = hex('#7a6a3a'), ROCK = hex('#7d7a72');
    const hAt = (x, z) => { const dx = (x - wt[0]) / (hill.r * 1.15), dz = (z - wt[1]) / hill.r, d = Math.hypot(dx, dz); if (d >= 1) return 0; const t = 1 - d; return hill.h * (t * t * (3 - 2 * t)) * (0.92 + 0.08 * Math.sin(x * 0.21) * Math.cos(z * 0.17)); };
    // the near tier: the MMPW east sidewalk + kerb, a low stone wall with an iron fence, the grass strip along the edge
    O.quad('sidewalk', [kerb, 0, z0], [x0, 0, z0], [x0, 0, z1], [kerb, 0, z1], [0, 1, 0], [0.86, 0.85, 0.82]);
    O.box('granite', kerb, -0.16, z0, kerb + 0.2, 0.005, z1, [0.72, 0.72, 0.7]);
    O.box('stone', x0, 0, z0, x0 + 0.45, 0.55, z1, hex('#8a8478'));
    for (let z = z0 + 0.2; z < z1; z += 2.4) O.ibox('box_iron', x0 + 0.22, 1.05, z, 0.05, 1.0, 0.05, IRON);
    for (const y of [0.7, 1.5]) O.ibox('box_iron', x0 + 0.22, y, (z0 + z1) / 2, 0.04, 0.04, z1 - z0, IRON);
    for (let z = z0 + 0.3; z < z1; z += 0.24) O.ibox('box_iron', x0 + 0.22, 1.05, z, 0.015, 0.95, 0.015, IRON);
    O.quad('grass', [x0 + 0.45, 0.02, z0], [x0 + 60, 0.02, z0], [x0 + 60, 0.02, z1], [x0 + 0.45, 0.02, z1], [0, 1, 0], GR);
    col.fence.push([x0, z0, x0, z1]);
    // the ground of the whole park as a height field (near: the first 60 m drawn above, then this grid on both tiers; the mid tier everything)
    const NX = 36, NZ = 40, gx0 = x0 + 0.45, gz0 = z0, dx = (x1 - gx0) / NX, dz = (z1 - gz0) / NZ;
    const P = (i, j) => { const x = gx0 + i * dx, z = gz0 + j * dz; return [x, hAt(x, z) + 0.03, z]; };
    const cAt = (p, q) => { const s = Math.abs(p[1] - q[1]) / Math.hypot(dx, dz); const g = mix(GR, LEAF, 0.35 + 0.3 * Math.sin(p[0] * 0.13 + p[2] * 0.07)); return s > 0.35 ? [mix(g, ROCK, clamp((s - 0.35) * 2.2, 0, 1)), 'rock'] : [g, 'grass']; };
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1), nrm = [-(b[1] - a[1]) / dx, 1, -(d[1] - a[1]) / dz], [cc, cm] = cAt(a, c);
      const hilly = a[1] > 0.1 || c[1] > 0.1 || b[1] > 0.1 || d[1] > 0.1;
      M.quad('midsolid', a, b, c, d, nrm, mul(cc, 0.95));
      if (hilly && a[0] < x0 + 110) O.quad(cm, a, b, c, d, nrm, cc);
      else if (a[0] >= x0 + 60 && a[0] < x0 + 110) O.quad('grass', a, b, c, d, nrm, cc);
    }
    // rock outcrops of Manhattan schist on the hill's west face
    for (let k = 0; k < 14; k++) { const ang = PI * (0.55 + R() * 0.9), r = hill.r * (0.35 + R() * 0.45), x = wt[0] + Math.cos(ang) * r * 1.1, z = wt[1] + Math.sin(ang) * r, y = hAt(x, z); const s = 2 + R() * 4;
      const rc = mul(ROCK, 0.9 + R() * 0.2), seed = R() * 1e6; ico(M, 'midsolid', x, y + s * 0.15, z, s * 0.9, s * 0.4, s * 0.7, rc, rng(seed)); if (x < x0 + 110) ico(O, 'rock', x, y + s * 0.15, z, s * 0.9, s * 0.4, s * 0.7, rc, rng(seed)); }
    // the watchtower on the summit (Julius Kroehl 1856, cast iron): an octagonal tower of tapering double posts, four decks with railings (the lowest a deep stone-and-iron base), X-bracing and
    // horizontal struts in every bay, a spiral stair round a newel, and the bell hung in an open cupola under an octagonal conical roof with a finial. Mid tier only: ~4k triangles, no extra draw call.
    const yb = hAt(wt[0], wt[1]), TW = hex('#4a4e4d'), TWd = hex('#363a3a'), TWl = hex('#6d6f68'), BRZ = hex('#6e5a32'), ROOFC = hex('#3b5a4c'), rr = 3.3, Ht = 14.0, topR = rr * 0.82;
    const tower = (Q, mat, th) => {
      const SOL = mat === 'midsolid' ? 'midsolid' : 'stone';
      const ring = (r, y, off = 0) => Array.from({ length: 8 }, (_, k) => [wt[0] + Math.cos((k + 0.5 + off) * PI / 4) * r, y, wt[1] + Math.sin((k + 0.5 + off) * PI / 4) * r]);
      const prism = (r0, r1, y0, y1, c, m = SOL) => { const A = ring(r0, y0), B = ring(r1, y1); for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8, mx = (A[k][0] + A[k2][0]) / 2 - wt[0], mz = (A[k][2] + A[k2][2]) / 2 - wt[1]; Q.quad(m, A[k], A[k2], B[k2], B[k], [mx, 0.2, mz], c); } Q.fan(m, B.slice().reverse(), [0, 1, 0], mul(c, 1.08)); };
      const strut = (a, b, t, c) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], h = Math.hypot(dx, dz), L = Math.hypot(h, dy); if (L < 0.01) return;
        rbox(Q, mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, t, L, t, c, Math.atan2(dx, dz), Math.atan2(h, dy)); };
      const hOf = (y) => rr - (y / Ht) * (rr - topR);
      prism(4.6, 4.2, yb - 0.5, yb + 0.5, hex('#8b8579')); prism(4.0, 3.7, yb + 0.5, yb + 0.95, hex('#7d776c'));                         // the stone base: two courses
      const dk = [0.35, 5.2, 9.3, 12.6];                                                                                                     // deck heights above the base course
      const Y0 = yb + 0.95;
      // the tapering posts: each corner a pair (inner + outer), 0.36 m square
      for (let k = 0; k < 8; k++) for (const dr of [-0.2, 0.2]) { const A = ring(hOf(0) + dr, Y0)[k], T = ring(hOf(Ht - 1.4) + dr, Y0 + Ht - 1.4)[k]; strut(A, T, 0.36, TW); }
      for (let l = 0; l < 4; l++) {
        const y = dk[l], r = hOf(y), P = ring(r, Y0 + y), Pb = ring(r + 0.55, Y0 + y);
        for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; strut(P[k], P[k2], 0.34, TWd); }                                                // the ring beams
        prism(r + 0.62, r + 0.5, Y0 + y - 0.2, Y0 + y + 0.04, TWd, 'midsolid');                                                            // the deck (a thin octagonal slab, balcony overhang)
        if (l > 0) {
          const rails = ring(r + 0.55, Y0 + y + 1.08);
          for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; strut(rails[k], rails[k2], 0.1, TW);                                          // the top rail + a mid rail + balusters
            const mA = Pb[k], mB = Pb[k2]; strut([mA[0], mA[1] + 0.55, mA[2]], [mB[0], mB[1] + 0.55, mB[2]], 0.06, TW);
            for (const f of [0, 0.25, 0.5, 0.75]) { const px = mA[0] + (mB[0] - mA[0]) * f, pz = mA[2] + (mB[2] - mA[2]) * f; rbox(Q, mat, px, Y0 + y + 0.55, pz, 0.08, 1.08, 0.08, TW); } }
        }
      }
      // bracing: an X in every bay of the three open stages, plus a mid-height strut ring
      for (let s = 0; s < 3; s++) { const ya = dk[s], yb2 = dk[s + 1] - 0.2, A = ring(hOf(ya), Y0 + ya), Bp = ring(hOf(yb2), Y0 + yb2), M2 = ring(hOf((ya + yb2) / 2), Y0 + (ya + yb2) / 2);
        for (let k = 0; k < 8; k++) { const k2 = (k + 1) % 8; strut(A[k], Bp[k2], 0.2, TWd); strut(A[k2], Bp[k], 0.2, TWd); strut(M2[k], M2[k2], 0.22, TW); } }
      // the spiral stair round the newel, rising from the base to the top deck
      strut([wt[0], Y0, wt[1]], [wt[0], Y0 + dk[3], wt[1]], 0.42, TWd);
      for (let k = 0; k < 30; k++) { const ang = k * 0.62, y = Y0 + 0.2 + k * (dk[3] - 0.4) / 30; rbox(Q, mat, wt[0] + Math.cos(ang) * 0.95, y, wt[1] + Math.sin(ang) * 0.95, 1.5, 0.1, 0.55, TWl, -ang); }
      // the cupola: the top deck's eight slim posts, a louvre band, the bell, an octagonal conical roof, a finial
      const yc = Y0 + dk[3], rc = hOf(dk[3]) - 0.2;
      for (let k = 0; k < 8; k++) strut(ring(rc, yc)[k], ring(rc, yc + 2.5)[k], 0.3, TW);
      strut(ring(rc, yc + 2.5)[0], ring(rc, yc + 2.5)[1], 0.3, TW); for (let k = 0; k < 8; k++) strut(ring(rc, yc + 2.5)[k], ring(rc, yc + 2.5)[(k + 1) % 8], 0.3, TWd);
      prism(rc, rc, yc + 0.0, yc + 0.9, mul(TWd, 0.8), 'midsolid');                                                                         // the louvred / panelled lower cupola wall
      prism(0.7, 0.35, yc + 1.15, yc + 2.1, BRZ, 'midsolid');                                                                                // the bell
      const eave = ring(rc + 0.85, yc + 2.55), apex = [wt[0], yc + 4.6, wt[1]];
      for (let k = 0; k < 8; k++) { const a = eave[k], b = eave[(k + 1) % 8]; Q.tri('midsolid', a, b, apex, [(a[0] + b[0]) / 2 - wt[0], 1.1, (a[2] + b[2]) / 2 - wt[1]], ROOFC, [0, 0], [1, 0], [0.5, 1]); }
      Q.fan('midsolid', eave.slice().reverse(), [0, -1, 0], mul(ROOFC, 0.5));
      strut(apex, [apex[0], apex[1] + 1.1, apex[2]], 0.12, TW);
      Y0;
    };
    tower(M, 'midsolid', 0.3);
    // the canopy: autumn crowns over the park (beyond the edge row of real trees), thinner on the summit so the tower shows above
    const AUT = ['#4f6d2c', '#5a7830', '#486527', '#657f36', '#42602a', '#557331', '#4c6a2b', '#5d7a33', '#c9a02c', '#d08a2a', '#b8651e', '#c8b23c'].map(hex);   // step 3: late October, 4 in 12 crowns yellow / orange, the rest green
    for (let k = 0; k < 150; k++) {
      const x = x0 + 30 + R() * (x1 - x0 - 40), z = z0 + 6 + R() * (z1 - z0 - 12), dTw = Math.hypot(x - wt[0], z - wt[1]);
      if (dTw < 34 || (dTw < 55 && R() < 0.6) || (x < wt[0] && Math.abs(z - wt[1]) < 26 + (wt[0] - x) * 0.25)) continue;     // a clear sight line from MMPW to the tower
      const y = hAt(x, z), h = (10 + R() * 6) * (1 - 0.35 * y / hill.h), rw = 3.5 + R() * 2.8, c = AUT[Math.floor(R() * AUT.length)];
      rbox(M, 'midsolid', x, y + h * 0.35, z, 0.5, h * 0.7, 0.5, hex('#3a2c22'));
      ico(M, 'midsolid', x, y + h * 0.7, z, rw, rw * 0.85, rw, c, R);
    }
    // the park's own structures (the recreation centre, the pool deck): plain brick / stone extrusions, a band of windows on the tall ones
    for (const b of u.blds || []) {
      const P = b.poly, H = b.h, tall = H > 5, cB = tall ? hex('#8a5444') : hex('#a39d90');
      for (let i = 0; i < P.length; i++) {
        const a = P[i], c = P[(i + 1) % P.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l < 0.3) continue; const nrm = [c[1] - a[1], 0, -(c[0] - a[0])];
        for (const [Q, mat] of [[O, tall ? 'brick' : 'stone'], [M, 'midsolid']]) Q.quad(mat, [a[0], 0, a[1]], [c[0], 0, c[1]], [c[0], H, c[1]], [a[0], H, a[1]], nrm, cB);
        if (tall && l > 3) { const nn = Math.hypot(nrm[0], nrm[2]), ox = nrm[0] / nn * 0.04, oz = nrm[2] / nn * 0.04; for (const y of [1.2, 5.4]) for (let t = 1; t < l - 1.5; t += 2.4) { const f0 = t / l, f1 = (t + 1.4) / l, p0 = [a[0] + (c[0] - a[0]) * f0 + ox, a[1] + (c[1] - a[1]) * f0 + oz], p1 = [a[0] + (c[0] - a[0]) * f1 + ox, a[1] + (c[1] - a[1]) * f1 + oz];
          O.quad('paint', [p0[0], y, p0[1]], [p1[0], y, p1[1]], [p1[0], y + 2.2, p1[1]], [p0[0], y + 2.2, p0[1]], nrm, [0.09, 0.1, 0.12]); } }
      }
      const cap = P.map((p) => [p[0], p[1]]); for (let i = 1; i < cap.length - 1; i++) for (const [Q, mat] of [[O, 'roof'], [M, 'midsolid']]) Q.tri(mat, [cap[0][0], H, cap[0][1]], [cap[i][0], H, cap[i][1]], [cap[i + 1][0], H, cap[i + 1][1]], [0, 1, 0], [0.4, 0.4, 0.42], [0, 0], [1, 0], [1, 1]);
      col.walls.push({ pts: P, h: H, bin: 0 });
    }
  }

  /* ---------------------------------------------------------------- mid tier (beyond ~75 m): the landmarks as simple solids that still read (the generic mid
     building is a brick-red window atlas, wrong for terra-cotta, white tile and tan concrete). M.T is the face transform; each facade is drawn in its own frame. */
  function frames(rec) {                                                            // [front, extra rotation] for the main front and the street sides (rec.sides)
    const out = [[rec.front, 0]], fn = rec.front.n;
    for (const sd of rec.sides || []) {
      const hi = sd.end === 'hi', bk = sd.end === 'back';
      out.push(bk ? [fn > 0 ? { x0: -sd.u1, x1: -sd.u0, z: -sd.v, n: 1, len: sd.len } : { x0: sd.u0, x1: sd.u1, z: sd.v, n: 1, len: sd.len }, fn > 0 ? PI : 0]
        : [hi ? { x0: -sd.v1, x1: -sd.v0, z: sd.u, n: 1, len: sd.len } : { x0: sd.v0, x1: sd.v1, z: -sd.u, n: 1, len: sd.len }, hi ? PI / 2 : -PI / 2]);
    }
    return out;
  }
  function extrude(M, poly, H, col, y0 = 0) {
    for (let i = 0; i < poly.length; i++) { const a = poly[i], c = poly[(i + 1) % poly.length]; if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.3) continue; M.quad('midsolid', [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], H, c[1]], [a[0], H, a[1]], [c[1] - a[1], 0, -(c[0] - a[0])], col); }
    for (let i = 1; i < poly.length - 1; i++) M.tri('midsolid', [poly[0][0], H, poly[0][1]], [poly[i][0], H, poly[i][1]], [poly[i + 1][0], H, poly[i + 1][1]], [0, 1, 0], mul(col, 0.7), [0, 0], [1, 0], [1, 1]);
  }
  function midLandmark(M, rec) {
    if (!rec.lm || !rec.front) return false;
    const T0 = M.T, th = T0 ? Math.atan2(T0.s, T0.c) : 0, inFrame = (rot, fn) => { M.T = { c: Math.cos(th + rot), s: Math.sin(th + rot), tx: 0, tz: 0 }; fn(); M.T = T0; };
    const pane = (x0, x1, y0, y1, z, col) => M.quad('midsolid', [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], col);
    const DK = [0.08, 0.09, 0.11];
    if (rec.lm === 'sob') {
      const us = rec.poly.map((p) => p[0]), vs = rec.poly.map((p) => p[1]), u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs), H = rec.h, C = hex('#bfae92');
      extrude(M, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], H, C);
      for (const [a, b, zf, rot, long] of [[u0, u1, v1, 0, 1], [-u1, -u0, -v0, PI, 1], [-v1, -v0, u1, PI / 2, 0], [v0, v1, -u0, -PI / 2, 0]]) inFrame(rot, () => {
        pane(a, b, 0.3, 9.4, zf + 0.06, [0.2, 0.2, 0.22]);
        const ez = long ? 5.2 : (b - a - 7.2) / 2, ga = a + ez, gb = b - ez, nb = Math.max(2, Math.round((gb - ga) / 1.62)), bw = (gb - ga) / nb;
        for (let i = 0; i < nb; i++) pane(ga + i * bw + 0.24, ga + (i + 1) * bw - 0.24, 11.6, H - 6.8, zf + 0.06, DK);
      });
      return true;
    }
    const W = rec.lm === 'theresa' ? hex('#f1ede2') : hex('#dccb9f');
    extrude(M, rec.poly, rec.h, W);
    if (rec.lm === 'theresa') for (const [F, rot] of frames(rec)) inFrame(rot, () => {
      const nb = Math.max(2, Math.round(F.len / 3.4)), colW = F.len / nb, Hs = (rec.h - 3.4 - 8.6) / 11, z = F.z + 0.06;
      pane(F.x0, F.x1, 0.3, 4.2, z, [0.16, 0.16, 0.18]);
      for (let k = 0; k < 12; k++) for (let i = 0; i < nb; i++) for (const sgn of [-1, 1]) { const xc = F.x0 + (i + 0.5) * colW + sgn * colW * 0.2, y = 5.4 + k * (k ? Hs : 3.2) + (k ? 3.2 - Hs : 0); pane(xc - colW * 0.13, xc + colW * 0.13, y + 0.6, y + 0.6 + Math.min(1.9, Hs * 0.6), z, DK); }
    });
    if (rec.lm === 'apollo') inFrame(0, () => {
      const F = rec.front, H = rec.h, z = F.z, bxp = F.x0 + F.len / 4;
      pane(F.x0 + 0.3, F.x1 - 0.3, 0.3, 4.6, z + 0.06, [0.12, 0.1, 0.08]);
      M.box('midsolid', F.x0 + 0.25, 4.75, z, F.x1 - 0.25, 6.6, z + 3.1, [0.06, 0.06, 0.07]);
      M.box('midsolid', (F.x0 + F.x1) / 2 - 2.7, 6.6, z + 2.6, (F.x0 + F.x1) / 2 + 2.7, 7.85, z + 2.95, [0.95, 0.35, 0.25]);
      M.box('midsolid', bxp - 0.21, H * 0.42, z + 0.55, bxp + 0.21, H + 4.6, z + 2.05, hex('#f1d98c'));
      for (const sgn of [-1, 1]) M.quad('midsolid', [bxp + sgn * 0.22, H * 0.42 + 0.4, z + 0.8], [bxp + sgn * 0.22, H * 0.42 + 0.4, z + 1.8], [bxp + sgn * 0.22, H + 4.2, z + 1.8], [bxp + sgn * 0.22, H + 4.2, z + 0.8], [sgn, 0, 0], [0.9, 0.15, 0.1]);
      for (let i = 0; i < 4; i++) { const xc = F.x0 + (i + 0.5) * F.len / 4, w = F.len / 4 - 1.2; pane(xc - w / 2, xc + w / 2, 7.4, 0.71 * H, z + 0.06, DK); }
    });
    return true;
  }

  /* ---------------------------------------------------------------- the pedestrian signal (housing + the lit symbol: the white walking person or the orange hand) */
  function pedSignal(O, px, py, pz, face, walk, SIG) {
    const al = Math.abs(face[0]) > 0.5, ry = al ? (face[0] > 0 ? PI / 2 : -PI / 2) : (face[1] > 0 ? 0 : PI);
    O.ibox('box_paint', px, py, pz, al ? 0.25 : 0.46, 0.46, al ? 0.46 : 0.25, SIG);
    O.ibox('box_paint', px + face[0] * 0.16, py + 0.2, pz + face[1] * 0.16, al ? 0.12 : 0.46, 0.04, al ? 0.46 : 0.12, SIG);                // the visor
    O.ibox('sign', px + face[0] * 0.128, py, pz + face[1] * 0.128, 0.38, 0.38, 1, [1, 1, 1], 0, ry, 0, [walk ? CELL.walk : CELL.hand, 0.125, 0, 0]);
  }

  return { rbox, shopRow, commercial, apollo, theresa, sob, subway, park, pedSignal, midLandmark };
}
