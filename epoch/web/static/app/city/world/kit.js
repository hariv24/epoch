// city/world/kit.js · the facade kit (docs/WORLD.md 4, 4.1, 12.2). PURE JS, no `three`: it runs inside the Web Worker (module workers cannot use the import map)
// and emits typed arrays only; street.js builds the BufferGeometry / InstancedMesh from them on the main thread, in small slices.
//
//   buildAll({ faces: [south, north], street, opt }, emit) -> stats
//     emit({ t: 'mesh', mat, pos, nrm, uv, col, idx })               merged static geometry, one message per <= 50k vertices per material
//     emit({ t: 'inst', part, mats: Float32Array(16n), cols: Float32Array(3n), par: Float32Array(4n) })      instanced parts (box_*, cyl, crown, win, ...)
//     emit({ t: 'collide', polys, circles })                         collision-ready 2-D shapes for the walking slice
//
// Frame (the descriptors'): x along the street toward the east end, y up, z across (north side z < 0). A facade has an outward normal n = front.n (+-1) along z;
// `d` below is the depth measured outward from the front wall plane (negative = into the building).
// Styles (a) brownstone, (b) second_empire, (c) prewar, (d) condo, (e) church. Seeds make every building different (bay jitter, tints, doors, lit windows).
// Look pass (10-31): textured materials (street_tex.py), the mansard = the top story (storyPlan), windows in 22 cm reveals, deep bracketed cornices,
// Neo-Grec angled bays + stone stoops, the white Beaux-Arts house, the Gothic church at 147, baked contact darkening (Out.ao), EZ-Tree trees (street.js).
import { makeLandmarks, SIGN_CELLS, CELL, SHOP_WORDS } from './landmarks.js';
export { SIGN_CELLS, CELL, SHOP_WORDS };
const PI = Math.PI;
export const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const lin = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
const mul = (c, k) => c.map((v) => Math.min(1, v * k));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Tints multiply textured maps (brick_diff ~0.76 mean, stone_diff ~0.86, slate ~0.85; street.js), so the textured palettes are "map x tint = the real colour":
// red brick (124-128 photo ~#9a4a3a), chocolate brownstone (#5B3B2E), limestone, white glazed brick, grey rock-faced church stone.
const PAL = {
  brick: ['#c8705a', '#cf7a5e', '#bb6450', '#c98264', '#b25e4c', '#d4866a', '#c06a56'].map(hex),
  brownstone: ['#5e3c2f', '#644033', '#5a392c', '#684536', '#553629'].map(hex),
  limestone: ['#ece4d2', '#e3dac6', '#f1eadc'].map(hex),
  whitebrick: ['#f6f4ee', '#efece4'].map(hex),
  panel: ['#8b8e90', '#a39d94', '#6f7478', '#9a8f80'].map(hex),
  stone: ['#b4b2aa', '#a8a59c', '#bdb6a6'].map(hex),
  door: ['#4a2616', '#1f3a2a', '#6a1c1c', '#26354f', '#232323', '#5b3c22', '#3b2a4a', '#6e5524'].map(hex),
  dormer: ['#3f7d6b', '#6e2a2c'].map(hex),                       // the photo: green and maroon
  sash: ['#151716', '#1d2b22', '#e8e4da', '#3a2418', '#202a33'].map(hex),
  slate: ['#80838c', '#7a7d84', '#858892', '#7c8080'].map(hex),
};
const IRON = hex('#1c1d1e'), FRAME = hex('#2b2f2e'), CORNICE = hex('#2b2522'), GUARD = hex('#1f2a22');
// Observed paint (LPC 2015 photos, Figure 2): the truth layer for what the report text does not say. Keyed by house number on this block face.
const OBSERVED = { '124': { dormer: 0 }, '126': { dormer: 0 }, '128': { dormer: 1 } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const isMansard = (rec) => !!(rec.roof && rec.roof.type === 'mansard');
// The grammar's floor split (docs/WORLD.md 4): PLUTO counts the stories above the basement; when the roof is a mansard, the TOP story lives in the mansard
// (its windows are the dormers), so only floors - 1 stories are walls. LPC "3 stories and basement" + mansard = basement, parlour, 2nd, mansard 3rd.
export function storyPlan(rec) {
  const H = rec.h, mans = isMansard(rec), f = Math.max(1, rec.floors), wf = mans ? Math.max(1, f - 1) : f;
  const Hb = rec.basement !== 0 ? clamp(0.12 * H, 1.4, 1.9) : 0.45, Hc = mans ? 0.7 : clamp(0.065 * H, 0.8, 1.05), Hm = mans ? clamp(0.24 * H, 2.5, 3.1) : 0;
  const Hf = H - Hb - Hc - Hm, wts = Array.from({ length: wf }, (_, i) => (i === 0 ? 1.15 : 1.0 - (i - 1) * 0.05)), ws = wts.reduce((a, b) => a + b, 0);
  const fh = wts.map((w) => (Hf * w) / ws), fy = [Hb]; for (let i = 0; i < wf; i++) fy.push(fy[i] + fh[i]);
  return { mans, f, wf, Hb, Hc, Hm, fh, fy, yTop: fy[wf] };
}
/* ------------------------------------------------------------------ the mesher + the instance lists */
const SOLID_UV = [-9999, -9999];
class Out {
  constructor(emit, tier) { this.emit = emit; this.m = new Map(); this.i = new Map(); this.tris = 0; this.inst = 0; this.ao = null; this.T = null; this.tier = tier || null; }
  mesh(mat) { let s = this.m.get(mat); if (!s) { s = { pos: [], nrm: [], uv: [], col: [], idx: [] }; this.m.set(mat, s); } return s; }
  flushMesh(mat, s) {
    if (!s.idx.length) return;
    const pos = new Float32Array(s.pos), nrm = new Float32Array(s.nrm), uv = new Float32Array(s.uv), col = new Float32Array(s.col), idx = new Uint32Array(s.idx);
    this.emit({ t: 'mesh', tier: this.tier, mat, pos, nrm, uv, col, idx }, [pos.buffer, nrm.buffer, uv.buffer, col.buffer, idx.buffer]);
    this.tris += s.idx.length / 3; s.pos = []; s.nrm = []; s.uv = []; s.col = []; s.idx = [];
  }
  // one triangle with a flat normal; the winding is corrected to agree with `n`
  tri(mat, a, b, c, n, col, ua, ub, uc) {
    if (mat === 'midsolid' && this.tier === 'm') { mat = 'mid'; ua = ub = uc = SOLID_UV; }       // slice 3 step 2: one mid material per unit (street.js: uv.x < -500 = untextured)
    const s = this.mesh(mat), v0 = s.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (dot < 0) { const t = b; b = c; c = t; const tu = ub; ub = uc; uc = tu; }
    const P = [a, b, c], U = [ua, ub, uc], cc = lin(col), T = this.T;
    const nn = T ? [T.c * n[0] + T.s * n[2], n[1], -T.s * n[0] + T.c * n[2]] : n;
    for (let k = 0; k < 3; k++) { const f = this.ao ? this.ao(P[k]) : 1; if (T) s.pos.push(T.c * P[k][0] + T.s * P[k][2] + T.tx, P[k][1], -T.s * P[k][0] + T.c * P[k][2] + T.tz); else s.pos.push(P[k][0], P[k][1], P[k][2]); s.nrm.push(nn[0], nn[1], nn[2]); s.uv.push(U[k][0], U[k][1]); s.col.push(cc[0] * f, cc[1] * f, cc[2] * f); }      // f: baked contact darkening (ground, under cornices)
    s.idx.push(v0, v0 + 1, v0 + 2);
    if (s.pos.length > 150000) this.flushMesh(mat, s);
  }
  uvOf(p, n) { return Math.abs(n[2]) >= Math.abs(n[0]) && Math.abs(n[2]) >= Math.abs(n[1]) ? [p[0], p[1]] : Math.abs(n[0]) >= Math.abs(n[1]) ? [p[2], p[1]] : [p[0], p[2]]; }
  quad(mat, a, b, c, d, n, col) { const ua = this.uvOf(a, n), ub = this.uvOf(b, n), uc = this.uvOf(c, n), ud = this.uvOf(d, n); this.tri(mat, a, b, c, n, col, ua, ub, uc); this.tri(mat, a, c, d, n, col, ua, uc, ud); }
  fan(mat, pts, n, col) { const U = pts.map((p) => this.uvOf(p, n)); for (let i = 1; i < pts.length - 1; i++) this.tri(mat, pts[0], pts[i], pts[i + 1], n, col, U[0], U[i], U[i + 1]); }
  // an axis-aligned box (all six faces, or the faces named in `skip` omitted: 'x-', 'x+', 'y-', 'y+', 'z-', 'z+')
  box(mat, x0, y0, z0, x1, y1, z1, col, skip = '') {
    const q = (a, b, c, d, n, k) => { if (!skip.includes(k)) this.quad(mat, a, b, c, d, n, col); };
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 'z+'); q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 'z-');
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 'x+'); q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 'x-');
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 'y+'); q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 'y-');
  }
  // instances: centre, euler (YXZ) and scale -> a column-major 4x4
  ibox(part, cx, cy, cz, sx, sy, sz, tint = [1, 1, 1], rx = 0, ry = 0, rz = 0, par = [0, 0, 0, 0]) {
    if (this.tier) {                                                    // slice 3 step 2 (draw calls): the district's boxes share one material, its poles are plain cylinders
      if (part === 'box_metal' || part === 'box_iron' || part === 'box_paint') part = 'box_any';
      else if (part === 'pole') { part = 'cyl'; sx *= 0.19; sz *= 0.19; }
    }
    let l = this.i.get(part); if (!l) { l = { m: [], c: [], p: [] }; this.i.set(part, l); }
    const cxr = Math.cos(rx), sxr = Math.sin(rx), cyr = Math.cos(ry), syr = Math.sin(ry), czr = Math.cos(rz), szr = Math.sin(rz);
    // R = Ry * Rx * Rz
    const r00 = cyr * czr + syr * sxr * szr, r01 = -cyr * szr + syr * sxr * czr, r02 = syr * cxr;
    const r10 = cxr * szr, r11 = cxr * czr, r12 = -sxr;
    const r20 = -syr * czr + cyr * sxr * szr, r21 = syr * szr + cyr * sxr * czr, r22 = cyr * cxr;
    const T = this.T;
    if (T) { const X = (a, b, d) => [T.c * a + T.s * d, b, -T.s * a + T.c * d], c0 = X(r00 * sx, r10 * sx, r20 * sx), c1 = X(r01 * sy, r11 * sy, r21 * sy), c2 = X(r02 * sz, r12 * sz, r22 * sz), cp = X(cx, cy, cz);
      l.m.push(c0[0], c0[1], c0[2], 0, c1[0], c1[1], c1[2], 0, c2[0], c2[1], c2[2], 0, cp[0] + T.tx, cp[1], cp[2] + T.tz, 1); }
    else l.m.push(r00 * sx, r10 * sx, r20 * sx, 0, r01 * sy, r11 * sy, r21 * sy, 0, r02 * sz, r12 * sz, r22 * sz, 0, cx, cy, cz, 1);
    const c = lin(tint); l.c.push(c[0], c[1], c[2]); l.p.push(par[0], par[1], par[2], par[3]); this.inst++;
    if (l.c.length > 3 * 20000) this.flushInst(part, l);
  }
  flushInst(part, l) {
    if (!l.c.length) return;
    const mats = new Float32Array(l.m), cols = new Float32Array(l.c), par = new Float32Array(l.p);
    this.emit({ t: 'inst', tier: this.tier, part, mats, cols, par }, [mats.buffer, cols.buffer, par.buffer]); l.m = []; l.c = []; l.p = [];
  }
  flush() { for (const [k, s] of this.m) this.flushMesh(k, s); for (const [k, l] of this.i) this.flushInst(k, l); }
}

/* ------------------------------------------------------------------ polygon triangulation (ear clipping; counter-clockwise (x, z), small simple polygons) */
function earClip(poly) {
  const n = poly.length, idx = [...Array(n).keys()], out = [];
  const area = poly.reduce((s, p, i) => { const q = poly[(i + 1) % n]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) idx.reverse();
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length], a = poly[ia], b = poly[ib], c = poly[ic];
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inTri(poly[j], a, b, c))) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/* ------------------------------------------------------------------ wall with rectangular openings (+ reveals); `breaks` adds vertex rows for the baked AO */
function wallHoles(O, mat, col, fz, n, x0, x1, y0, y1, holes, breaks = O.breaks || []) {
  const P = (x, y) => [x, y, fz], N = [0, 0, n];
  const slab = (a, b, c, d) => {
    if (!(b - a > 1e-3 && d - c > 1e-3)) return;
    const ys = [c, ...breaks.filter((y) => y > c + 0.02 && y < d - 0.02).sort((p, q) => p - q), d];
    for (let i = 0; i < ys.length - 1; i++) O.quad(mat, P(a, ys[i]), P(b, ys[i]), P(b, ys[i + 1]), P(a, ys[i + 1]), N, col);
  };
  // split the wall at every hole edge (holes of different widths may share a column, e.g. a door under a window), then fill around the holes in each strip
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])].filter((x) => x >= x0 && x <= x1).map((x) => +x.toFixed(4)))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i], xb = xs[i + 1], m = (xa + xb) / 2; let y = y0;
    for (const h of holes.filter((h) => h.x0 <= m && h.x1 >= m).sort((a, b) => a.y0 - b.y0)) { slab(xa, xb, y, Math.min(y1, h.y0)); y = Math.max(y, h.y1); }
    slab(xa, xb, y, y1);
  }
  for (const h of holes) {                                            // reveals: 22 cm deep by default, darker toward the glass
    const rv = h.rv ?? 0.22, c2 = mul(col, 0.62), z0 = fz, z1 = fz - n * rv, rm = h.rmat || mat;
    O.quad(rm, [h.x0, h.y0, z0], [h.x0, h.y0, z1], [h.x0, h.y1, z1], [h.x0, h.y1, z0], [1, 0, 0], c2);
    O.quad(rm, [h.x1, h.y0, z1], [h.x1, h.y0, z0], [h.x1, h.y1, z0], [h.x1, h.y1, z1], [-1, 0, 0], c2);
    O.quad(rm, [h.x0, h.y1, z0], [h.x0, h.y1, z1], [h.x1, h.y1, z1], [h.x1, h.y1, z0], [0, -1, 0], mul(col, 0.42));
    O.quad(rm, [h.x0, h.y0, z1], [h.x0, h.y0, z0], [h.x1, h.y0, z0], [h.x1, h.y0, z1], [0, 1, 0], mul(col, 0.8));
    if (!h.noBack) O.quad('paint', [h.x0, h.y0, z1], [h.x1, h.y0, z1], [h.x1, h.y1, z1], [h.x0, h.y1, z1], [0, 0, n], [0.03, 0.03, 0.035]);
  }
}

/* ------------------------------------------------------------------ shared facade context */
function context(O, rec) {
  const F = rec.front, n = F.n, zf = F.z, x0 = F.x0, x1 = F.x1, len = x1 - x0, H = rec.h, R = rng(rec.seed + 17);
  const fz = (d) => zf + n * d;
  const bx = (mat, xa, ya, d0, xb, yb, d1, col, skip = '') => { skip = skip.replace('in', n > 0 ? 'z-' : 'z+').replace('out', n > 0 ? 'z+' : 'z-'); const za = n > 0 ? fz(d0) : fz(d1), zb = n > 0 ? fz(d1) : fz(d0); O.box(mat, xa, ya, za, xb, yb, zb, col, skip); };
  const bodyMat = rec.mat.body, baseMat = rec.mat.base === 'same' ? bodyMat : rec.mat.base;
  const pick = (k, i) => PAL[k][((i % PAL[k].length) + PAL[k].length) % PAL[k].length];
  const palOf = (m) => (m === 'panel' ? 'panel' : PAL[m] ? m : 'brick');
  const bodyCol = mul(pick(palOf(bodyMat), rec.mat.tint), 0.95 + R() * 0.1);
  const baseCol = baseMat === bodyMat ? bodyCol : pick(palOf(baseMat), rec.mat.tint + 1);
  const trimCol = bodyMat === 'whitebrick' ? hex('#efe8d6') : rec.style === 'prewar' ? pick('limestone', rec.mat.tint) : rec.style === 'church' ? mul(bodyCol, 1.08) : bodyMat === 'brownstone' ? mul(bodyCol, 1.1) : mul(pick('brownstone', rec.mat.tint + 2), 1.15);
  const doorCol = pick('door', rec.mat.door), sash = pick('sash', (rec.seed >> 3) + 0);
  const winKind = (rec.year && rec.year < 1895 && R() < 0.7) ? 3 : 1;           // 2-over-2 sashes on most pre-1895 houses, 1-over-1 after
  const lit = () => (R() < 0.62 ? 1 : 0);
  // an interior-mapped window set 0.17 m into its reveal, + a projecting sill and a lintel (par: seed, lit, curtain, kind; tint = sash colour)
  const win = (xc, yc, w, h, o = {}) => {
    const d = o.d ?? -0.17, ry = (n > 0 ? 0 : PI) + (o.ry || 0);
    O.ibox('win', xc, yc, o.z ?? fz(d), w, h, 1, o.sash || sash, 0, ry, 0, [R(), o.lit ?? lit(), R(), o.kind ?? winKind]);
    if (o.bare) return;
    const sz = o.sz ?? fz(0.06), lz = o.lz ?? fz(0.05);
    O.ibox('box_stone', xc, yc - h / 2 - 0.06, sz, w + 0.22, 0.1, 0.24, o.trim || trimCol, 0, o.ry || 0, 0);
    if (!o.noLintel) O.ibox('box_stone', xc, yc + h / 2 + 0.12, lz, w + 0.3, 0.22, 0.16, o.trim || trimCol, 0, o.ry || 0, 0);
    if (o.ac !== false && (o.ac || (o.k >= 1 && R() < 0.2))) O.ibox('box_metal', xc, yc - h / 2 + 0.22, fz(0.12), 0.64, 0.42, 0.55, [0.8, 0.8, 0.78]);      // an AC unit in ~20% of upper windows
  };
  // a deep bracketed cornice: frieze, paired brackets, a dentil course, a 0.5 m crown with a dark soffit
  const cornice = (yc, Hc, col, o = {}) => {
    const proj = o.proj ?? 0.5, xa = x0 - 0.02, xb = x1 + 0.02;
    bx('paint', xa, yc, 0, xb, yc + Hc * 0.6, 0.1, col, 'in');                                         // frieze board
    bx('paint', xa, yc + Hc * 0.6, 0, xb, yc + Hc * 0.68, 0.2, mul(col, 0.92), 'in');                  // bed moulding
    bx('paint', xa, yc + Hc * 0.8, 0, xb, yc + Hc, proj, col, 'in');                                   // the crown
    bx('paint', xa, yc + Hc * 0.68, 0, xb, yc + Hc * 0.8, proj * 0.75, mul(col, 0.85), 'in');
    const nbk = Math.max(2, Math.round((xb - xa) / 0.85)), sp = (xb - xa - 0.3) / (nbk - 1);
    for (let i = 0; i < nbk; i++) {                                                                    // scroll brackets (a deep block + a drop)
      const x = xa + 0.15 + i * sp;
      O.ibox('box_stone', x, yc + Hc * 0.42, fz(proj * 0.45), 0.16, Hc * 0.76, proj * 0.8, mul(col, 0.95));
      O.ibox('box_stone', x, yc + Hc * 0.08, fz(0.14), 0.12, 0.2, 0.16, mul(col, 0.9));
    }
    if (o.dentils !== false) for (let x = xa + 0.08; x < xb - 0.05; x += 0.13) O.ibox('box_stone', x, yc + Hc * 0.64, fz(0.24), 0.065, 0.09, 0.1, mul(col, 0.88));
  };
  const B = { n, zf, x0, x1, len, H, R, fz, bx, bodyMat, baseMat, bodyCol, baseCol, trimCol, doorCol, sash, winKind, lit, win, cornice, pick };
  return B;
}
// an AO profile for one facade: dark at the ground (contact) and in a band under the cornice
const aoProfile = (yCorn, zf, n) => (p) => {
  let f = 1; const y = p[1];
  if (y < 0.9) f *= 0.6 + 0.4 * (Math.max(0, y) / 0.9);
  const dc = yCorn - y; if (dc >= -0.01 && dc < 0.8 && Math.abs(p[2] - zf) < 0.05) f *= 0.62 + 0.38 * (Math.max(0, dc) / 0.8);
  return f;
};

/* ------------------------------------------------------------------ (a)/(b) row houses: Neo-Grec / Italianate brownstone, Second Empire brick */
function rowHouse(O, rec, B, plan) {
  const { n, zf, x0, x1, len, H, R, fz, bx, bodyMat, baseMat, bodyCol, baseCol, trimCol, doorCol, win, cornice } = B;
  const sec = rec.style === 'second_empire', { mans, wf, Hb, Hc, Hm, fh, fy, yTop } = plan;
  const neo = !sec && (rec.angledBay || rec.rusticated || (rec.year >= 1880 && rec.year < 1900));
  const nb = Math.max(2, rec.bays), colW = len / nb, cx = (i) => x0 + (i + 0.5) * colW;
  const east = rec.stoop ? rec.stoop.side === 'e' : R() < 0.5, dc = east ? nb - 1 : 0, xd = cx(dc);
  const ww = clamp(colW * 0.5, 0.8, 1.1), baseM = baseMat === 'brownstone' || rec.rusticated ? 'brownstone' : baseMat === 'limestone' ? 'limestone' : bodyMat;
  const bayCols = []; for (let i = 0; i < nb; i++) if (i !== dc) bayCols.push(i);
  const bay = !!rec.angledBay && bayCols.length >= 2 && wf >= 2, p = 0.6;
  const bx0 = bay ? cx(bayCols[0]) - colW / 2 + 0.1 : 0, bx1 = bay ? cx(bayCols[bayCols.length - 1]) + colW / 2 - 0.1 : 0;
  const inBay = (i) => bay && bayCols.includes(i);
  O.breaks = [0.9, yTop - 0.8]; O.ao = aoProfile(yTop, zf, n);
  const holes = [], baseHoles = [];
  // basement: windows with iron grilles; the under-stoop door
  const by0 = 0.45, by1 = Math.min(Hb - 0.28, 1.55);
  for (let i = 0; i < nb; i++) {
    if (inBay(i)) continue;
    const xc = cx(i);
    if (i === dc) { if (rec.stoop) baseHoles.push({ x0: xc - 0.42, x1: xc + 0.42, y0: 0, y1: Hb - 0.3, rv: 0.45 }); continue; }
    baseHoles.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: by0, y1: by1 });
    win(xc, (by0 + by1) / 2, ww, by1 - by0, { ac: false, lit: R() < 0.4 ? 1 : 0, trim: mul(baseCol, 1.1) });
    for (let b = -2; b <= 2; b++) O.ibox('box_iron', xc + b * (ww / 5), (by0 + by1) / 2, fz(0.04), 0.022, by1 - by0, 0.022, IRON);
  }
  // the wall floors (parlour taller); bay columns live on the bay
  const wins = [];
  for (let k = 0; k < wf; k++) {
    const hf = fh[k], wh = hf * (k === 0 ? 0.68 : 0.6), sill = fy[k] + hf * (k === 0 ? 0.15 : 0.19);
    for (let i = 0; i < nb; i++) {
      if (i === dc && k === 0) continue;
      if (inBay(i)) continue;
      const xc = cx(i); holes.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: sill, y1: sill + wh }); wins.push({ xc, yc: sill + wh / 2, w: ww, h: wh, k });
    }
  }
  if (rec.stoop || dc >= 0) holes.push({ x0: xd - 0.62, x1: xd + 0.62, y0: Hb, y1: Hb + Math.min(2.95, fh[0] * 0.82), rv: 0.34, noBack: true });
  wallHoles(O, baseM, baseCol, fz(0), n, x0, x1, 0, Hb, baseHoles);
  wallHoles(O, bodyMat, bodyCol, fz(0), n, x0, x1, Hb, yTop, holes);
  if (baseM === 'brownstone' || rec.rusticated) for (let y = 0.4; y < Hb - 0.15; y += 0.38) O.ibox('box_stone', (x0 + x1) / 2, y, fz(0.0), len, 0.03, 0.04, mul(baseCol, 0.5));   // rusticated joints
  O.ibox('box_stone', (x0 + x1) / 2, Hb + 0.07, fz(0.06), len, 0.14, 0.14, trimCol);                // the water table / string course
  for (const w of wins) {
    win(w.xc, w.yc, w.w, w.h, { k: w.k });
    if (w.k === 0 && sec) O.ibox('box_stone', w.xc, w.yc - w.h / 2 - 0.36, fz(0.02), w.w, 0.4, 0.04, mul(trimCol, 0.92));      // incised spandrel panel
    if (neo) O.ibox('box_stone', w.xc, w.yc + w.h / 2 + 0.3, fz(0.09), w.w + 0.42, 0.1, 0.22, mul(trimCol, 1.04));             // Neo-Grec incised hood cap
  }
  if (bay) {                                                          // a 3-storey angled bay on a projecting rusticated base, ~0.6 m out (Neo-Grec)
    const segs = [[[bx0, 0], [bx0 + p, p], -1], [[bx0 + p, p], [bx1 - p, p], 0], [[bx1 - p, p], [bx1, 0], 1]];
    const fx0 = bx0 + p, fx1 = bx1 - p, fw = fx1 - fx0, nf = fw > 2.2 ? 2 : 1, fwW = nf === 2 ? Math.min(0.95, fw / 2 - 0.3) : Math.min(1.1, fw - 0.5);
    const fHoles = [], fBase = [{ x0: (fx0 + fx1) / 2 - fwW / 2, x1: (fx0 + fx1) / 2 + fwW / 2, y0: by0, y1: by1 }];
    win((fx0 + fx1) / 2, (by0 + by1) / 2, fwW, by1 - by0, { d: p - 0.17, sz: fz(p + 0.06), lz: fz(p + 0.05), ac: false, trim: mul(baseCol, 1.1) });
    for (let k = 0; k < wf; k++) {
      const hf = fh[k], wh = hf * (k === 0 ? 0.68 : 0.6), sill = fy[k] + hf * (k === 0 ? 0.15 : 0.19);
      for (let j = 0; j < nf; j++) {
        const xc = nf === 1 ? (fx0 + fx1) / 2 : fx0 + fw * (j === 0 ? 0.27 : 0.73);
        fHoles.push({ x0: xc - fwW / 2, x1: xc + fwW / 2, y0: sill, y1: sill + wh });
        win(xc, sill + wh / 2, fwW, wh, { d: p - 0.17, sz: fz(p + 0.06), lz: fz(p + 0.05), k });
        if (neo) O.ibox('box_stone', xc, sill + wh + 0.3, fz(p + 0.09), fwW + 0.36, 0.1, 0.2, mul(trimCol, 1.04));
      }
      for (const [a, b, sx] of segs) if (sx) {                         // a narrow window on each angled cheek
        const mx = (a[0] + b[0]) / 2, md = (a[1] + b[1]) / 2 + 0.03, ry = sx * n * PI / 4, ox = sx * 0.02;
        win(mx + ox, sill + wh / 2, 0.5, wh, { z: fz(md), ry, sz: fz(md + 0.05), lz: fz(md + 0.04), ac: false, k });
      }
    }
    wallHoles(O, 'brownstone', baseCol, fz(p), n, fx0, fx1, 0, Hb, fBase);
    wallHoles(O, bodyMat, bodyCol, fz(p), n, fx0, fx1, Hb, yTop, fHoles);
    for (const [a, b, sx] of segs) if (sx) {
      const dx = b[0] - a[0], dd = b[1] - a[1], l = Math.hypot(dx, dd), nr = [-dd / l, 0, n * dx / l];
      for (const [ya, yb, m, c] of [[0, 0.9, 'brownstone', baseCol], [0.9, Hb, 'brownstone', baseCol], [Hb, yTop - 0.8, bodyMat, bodyCol], [yTop - 0.8, yTop, bodyMat, bodyCol]])
        O.quad(m, [a[0], ya, fz(a[1])], [b[0], ya, fz(b[1])], [b[0], yb, fz(b[1])], [a[0], yb, fz(a[1])], nr, c);
    }
    O.fan('paint', [[bx0, yTop, fz(0)], [bx0 + p, yTop, fz(p)], [bx1 - p, yTop, fz(p)], [bx1, yTop, fz(0)]], [0, 1, 0], mul(bodyCol, 0.7));
    for (let y = 0.4; y < Hb - 0.15; y += 0.38) O.ibox('box_stone', (fx0 + fx1) / 2, y, fz(p), fw, 0.03, 0.04, mul(baseCol, 0.5));
    O.ibox('box_stone', (fx0 + fx1) / 2, Hb + 0.07, fz(p + 0.06), fw + 0.1, 0.14, 0.14, trimCol);
  }
  const corCol = sec ? CORNICE : bodyMat === 'brownstone' ? mul(bodyCol, 0.82) : mul(trimCol, 0.8);
  cornice(yTop, Hc, corCol, { proj: bay ? p + 0.22 : 0.5, dentils: rec.cornice !== 'plain' });
  if (rec.stoop) stoop(O, rec, B, Hb, xd, neo && !sec);
  doorway(O, B, xd, Hb, Math.min(2.95, fh[0] * 0.82), neo && !sec);
  O.ao = null; O.breaks = null;
  if (mans) mansard(O, rec, B, plan, nb, colW);
  const fzL = n < 0 ? 9.14 : -9.14, gap = rec.stoop ? [xd - 0.95, xd + 0.95] : [1e9, 1e9];   // the cast-iron areaway fence on the lot line
  for (let x = x0 + 0.08; x < x1 - 0.02; x += 0.13) if (x < gap[0] || x > gap[1]) O.ibox('box_iron', x, 0.5, fzL, 0.022, 1.0, 0.022, IRON);
  O.ibox('box_iron', (x0 + x1) / 2, 0.98, fzL, len, 0.04, 0.04, IRON); O.ibox('box_iron', (x0 + x1) / 2, 0.12, fzL, len, 0.04, 0.04, IRON);
}

// the slate mansard (the top story): a steep fish-scale front slope, arched dormers with angled pediments, a crowning moulding, a brick chimney
function mansard(O, rec, B, plan, nb, colW) {
  const { n, x0, x1, len, R, fz, win } = B, { yTop, Hc, Hm } = plan;
  const yt = yTop + Hc, top = yt + Hm, ins = 0.55, sc = mul(PAL.slate[(rec.seed >> 2) % PAL.slate.length], 0.95 + R() * 0.1);
  const zs = (y) => fz(0.06 - ((y - yt) / Hm) * (ins + 0.06));
  O.quad('slate', [x0, yt, zs(yt)], [x1, yt, zs(yt)], [x1, top, zs(top)], [x0, top, zs(top)], [0, (ins + 0.06) / Hm, n], sc);
  for (const [xe, nx] of [[x0, -1], [x1, 1]]) if (!rec.party[nx < 0 ? 0 : 1]) O.fan('slate', [[xe, yt, zs(yt)], [xe, top, zs(top)], [xe, yt, zs(top)]], [nx, 0, 0], sc);
  const nd = Math.max(1, (rec.roof && rec.roof.dormers) || 2), obs = OBSERVED[rec.num];
  const dp = PAL.dormer[obs ? obs.dormer : (rec.seed >> 4) % 2];
  for (let j = 0; j < nd; j++) {
    const xc = nd === 2 ? x0 + len * (j === 0 ? 0.27 : 0.73) : x0 + len * (j + 0.5) / nd;
    const w = 0.72, dw = w + 0.36, yb = yt + 0.3, wh = Math.min(1.55, Hm - 0.95), ys = yb + wh - w / 2, r = w / 2, R2 = dw / 2;
    const dz = 0.04, zF = fz(dz), ped = ys + R2 + 0.05, apex = ped + 0.42;
    const arc = (rr) => Array.from({ length: 9 }, (_, k) => [xc + Math.cos((k / 8) * PI) * rr, ys + Math.sin((k / 8) * PI) * rr]);
    const N3 = [0, 0, n], A1 = arc(r), A2 = arc(R2);
    O.quad('paint', [xc - R2, yb - 0.08, zF], [xc + R2, yb - 0.08, zF], [xc + R2, yb, zF], [xc - R2, yb, zF], N3, dp);
    for (const sx of [-1, 1]) O.quad('paint', [xc + sx * r, yb, zF], [xc + sx * R2, yb, zF], [xc + sx * R2, ys, zF], [xc + sx * r, ys, zF], N3, dp);
    for (let k = 0; k < 8; k++) O.quad('paint', [A1[k][0], A1[k][1], zF], [A2[k][0], A2[k][1], zF], [A2[k + 1][0], A2[k + 1][1], zF], [A1[k + 1][0], A1[k + 1][1], zF], N3, dp);
    for (const sx of [1, -1]) O.fan('paint', [[xc + sx * R2, ped, zF], ...(sx > 0 ? A2.slice(0, 5) : A2.slice(4)).map((q) => [q[0], q[1], zF]), [xc, ped, zF]], N3, mul(dp, 0.94));
    win(xc, yb + (ys - yb) / 2, w, ys - yb, { z: fz(dz - 0.12), noLintel: true, ac: false, sz: fz(dz + 0.05), trim: mul(dp, 1.1), k: 3 });
    O.fan('glass', [[xc - r, ys - 0.01, fz(dz - 0.12)], [xc + r, ys - 0.01, fz(dz - 0.12)], ...arc(r).reverse().map((q) => [q[0], q[1], fz(dz - 0.12)])].reverse(), [0, 0, n], [0.05, 0.06, 0.07]);
    for (const sx of [-1, 1]) {                                         // the reveal of the arched opening (left/right jambs) + cheeks back to the slope
      O.quad('paint', [xc + sx * r, yb, zF], [xc + sx * r, yb, fz(dz - 0.12)], [xc + sx * r, ys, fz(dz - 0.12)], [xc + sx * r, ys, zF], [-sx, 0, 0], mul(dp, 0.6));
      O.quad('slate', [xc + sx * R2, yb - 0.08, zF], [xc + sx * R2, yb - 0.08, zs(yb - 0.08)], [xc + sx * R2, ped, zs(ped)], [xc + sx * R2, ped, zF], [sx, 0, 0], sc);
    }
    const P0 = [xc - R2 - 0.12, ped, zF], P1 = [xc + R2 + 0.12, ped, zF], PA = [xc, apex, zF];       // the angled pediment, then its little roof back to the slope
    O.fan('paint', [P0, P1, PA], [0, 0, n], mul(dp, 1.08));
    O.quad('paint', [P0[0], P0[1] - 0.12, zF], [P1[0], P1[1] - 0.12, zF], [P1[0], P1[1], fz(dz + 0.05)], [P0[0], P0[1], fz(dz + 0.05)], [0, -0.3, n], mul(dp, 0.9));
    for (const [Pe, sx] of [[P0, -1], [P1, 1]]) O.quad('slate', [Pe[0], Pe[1], zF], [PA[0], PA[1], zF], [PA[0], PA[1], zs(apex)], [Pe[0], Pe[1], zs(ped)], [sx * 0.6, 0.8, 0], sc);
    O.ibox('box_stone', xc, yb - 0.12, fz(dz + 0.08), dw + 0.1, 0.1, 0.24, mul(dp, 0.9));
  }
  O.ibox('box_stone', (x0 + x1) / 2, top + 0.1, fz(-ins + 0.08), len + 0.04, 0.2, 0.36, CORNICE);
  if (R() < 0.75) O.ibox('box_stone', x0 + len * (0.15 + R() * 0.7), top + 0.85, fz(-ins - 3.0), 0.75, 1.7, 0.6, mul(B.bodyCol, 0.85));      // brick chimney
}

// a stoop to the parlour floor: steps + landing; Neo-Grec: solid brownstone cheek walls with massive newels; Second Empire: cast-iron railings and newels
function stoop(O, rec, B, Hb, xd, stone) {
  const { n, zf, fz, bx, baseCol } = B;
  const lot = Math.abs(zf) - 9.14, depthMax = clamp(lot + 0.95, 1.4, 3.0), land = 0.85, N = clamp(Math.round(Hb / 0.18), 6, 11), tread = (depthMax - land) / N, rise = Hb / N, sw = 1.45;
  STOOPS.push({ num: rec.num || '', xd, zf, n, Hb, land, depthMax, N, tread, rise, sw, cheek: stone ? 0.14 : 0.12 });      // for the walker (street_walk.js groundAt + colliders)
  bx('brownstone', xd - sw / 2, 0, 0, xd + sw / 2, Hb, land, baseCol);
  for (let s = 1; s <= N; s++) { const d0 = land + (s - 1) * tread, d1 = land + s * tread; bx('brownstone', xd - sw / 2, 0, d0, xd + sw / 2, Hb - s * rise, d1, mul(baseCol, s % 2 ? 1 : 0.97)); O.ibox('box_stone', xd, Hb - s * rise + 0.015, fz(d1 - 0.02), sw + 0.04, 0.03, 0.05, mul(baseCol, 1.12)); }
  const ax = Math.hypot(depthMax - land, Hb), tilt = Math.atan2(Hb, depthMax - land);
  for (const sx of [-1, 1]) {
    const rx = xd + sx * (sw / 2 + 0.14);
    if (stone) {                                                        // solid cheek wall following the steps + a heavy newel at the foot and at the landing
      // review: one wall with a smooth raking top (it was a staircase of boxes, blocky at eye level) and a lighter coping stone along the rake
      const dn = depthMax - 0.5, yT = Hb + 0.85, yN = Math.max(1.0, Hb * (0.5 / (depthMax - land)) + 0.85), wc = mul(baseCol, 0.96), prof = [[0, 0], [dn, 0], [dn, yN], [land, yT], [0, yT]];
      for (const ex of [-0.14, 0.14]) { const pts = prof.map(([d, y]) => [rx + ex, y, fz(d)]); O.fan('brownstone', pts, [Math.sign(ex), 0, 0], wc); O.fan('brownstone', pts.slice().reverse(), [Math.sign(ex), 0, 0], wc); }
      for (const [d0, y0, d1, y1] of [[0, yT, land, yT], [land, yT, dn, yN]]) { const q = [[rx - 0.14, y0, fz(d0)], [rx + 0.14, y0, fz(d0)], [rx + 0.14, y1, fz(d1)], [rx - 0.14, y1, fz(d1)]]; O.quad('brownstone', q[0], q[1], q[2], q[3], [0, 1, 0], wc); O.quad('brownstone', q[3], q[2], q[1], q[0], [0, 1, 0], wc); }
      { const L = Math.hypot(dn - land, yT - yN), t = Math.atan2(yT - yN, dn - land); O.ibox('box_stone', rx, (yT + yN) / 2 + 0.035, fz((land + dn) / 2), 0.36, 0.07, L + 0.04, mul(baseCol, 1.14), n > 0 ? t : -t); O.ibox('box_stone', rx, yT + 0.035, fz(land / 2), 0.36, 0.07, land, mul(baseCol, 1.14)); }
      bx('brownstone', rx - 0.27, 0, depthMax - 0.5, rx + 0.27, 1.25, depthMax, mul(baseCol, 1.02)); bx('brownstone', rx - 0.32, 1.25, depthMax - 0.55, rx + 0.32, 1.36, depthMax + 0.05, mul(baseCol, 1.1));
      bx('brownstone', rx - 0.24, Hb, land - 0.45, rx + 0.24, Hb + 1.15, land, mul(baseCol, 1.02));
    } else {
      bx('brownstone', rx - 0.12, 0, 0, rx + 0.12, Hb + 0.15, land, mul(baseCol, 0.94));
      for (let s = 1; s <= N; s++) { const d0 = land + (s - 1) * tread, d1 = land + s * tread; bx('brownstone', rx - 0.12, 0, d0, rx + 0.12, Hb - s * rise + 0.15, d1, mul(baseCol, 0.94)); }
      O.ibox('box_iron', rx, 0.65, fz(depthMax - 0.15), 0.16, 1.3, 0.16, IRON); O.ibox('box_iron', rx, 1.34, fz(depthMax - 0.15), 0.24, 0.1, 0.24, IRON);   // cast-iron newel
      O.ibox('box_iron', rx, Hb + 0.55, fz(land - 0.1), 0.12, 1.1, 0.12, IRON);
      O.ibox('box_iron', rx, (Hb + 1.05 + 1.05) / 2 - 0.02, fz((land + depthMax) / 2), 0.05, 0.05, ax, IRON, n > 0 ? tilt : -tilt);
      for (let b = 0; b <= N; b++) { const d = land + (b / N) * (depthMax - land), y = Hb - (b / N) * Hb; O.ibox('box_iron', rx, y + 0.55, fz(d), 0.022, 0.95, 0.022, IRON); }
    }
  }
}
function doorway(O, B, xd, yb, h, neo) {
  const { n, fz, doorCol, trimCol } = B, w = 1.2, dz = fz(-0.3);
  for (const s of [-1, 1]) {                                           // a double door: two leaves with raised panels
    const xa = xd + (s < 0 ? -w / 2 + 0.06 : 0.01), xb = xd + (s < 0 ? -0.01 : w / 2 - 0.06);
    O.quad('paint', [xa, yb, dz], [xb, yb, dz], [xb, yb + h - 0.5, dz], [xa, yb + h - 0.5, dz], [0, 0, n], doorCol);
    for (const [ya, yb2] of [[yb + 0.25, yb + 1.0], [yb + 1.2, yb + h - 0.75]]) O.ibox('box_paint', (xa + xb) / 2, (ya + yb2) / 2, fz(-0.28), (xb - xa) - 0.18, yb2 - ya, 0.04, mul(doorCol, 1.25));
  }
  O.quad('glass', [xd - w / 2 + 0.06, yb + h - 0.45, dz], [xd + w / 2 - 0.06, yb + h - 0.45, dz], [xd + w / 2 - 0.06, yb + h - 0.06, dz], [xd - w / 2 + 0.06, yb + h - 0.06, dz], [0, 0, n], [0.12, 0.13, 0.15]);
  O.ibox('box_paint', xd, yb + h - 0.48, fz(-0.27), w - 0.1, 0.06, 0.06, mul(doorCol, 0.8));
  if (neo) {                                                            // a bracketed hood on console brackets
    O.ibox('box_stone', xd, yb + h + 0.22, fz(0.3), w + 0.9, 0.24, 0.6, trimCol);
    for (const s of [-1, 1]) O.ibox('box_stone', xd + s * (w / 2 + 0.25), yb + h - 0.15, fz(0.18), 0.22, 0.6, 0.36, mul(trimCol, 0.96));
  } else O.ibox('box_stone', xd, yb + h + 0.16, fz(0.08), w + 0.5, 0.3, 0.24, trimCol);
}

/* ------------------------------------------------------------------ (c) pre-war apartment houses: tenement walk-ups + the white glazed-brick Beaux-Arts house (118-122) */
function prewar(O, rec, B) {
  const { n, zf, x0, x1, len, H, R, fz, bx, bodyMat, baseCol, bodyCol, trimCol, win, cornice } = B;
  const white = bodyMat === 'whitebrick', f = Math.max(2, rec.floors), Hc = clamp(0.05 * H, 0.9, 1.4), Hb = clamp(0.14 * H, 3.4, 4.4), Hs = (H - Hb - Hc) / (f - 1), top = H - Hc;
  const nb = white ? Math.max(3, Math.round(len / 3.6)) : rec.bays, colW = len / nb, cx = (i) => x0 + (i + 0.5) * colW, dc = Math.floor(nb / 2);
  const holes = [], baseHoles = [], wins = [], ww = clamp(colW * (white ? 0.36 : 0.5), 0.8, 1.2);
  for (let i = 0; i < nb; i++) {
    const xc = cx(i);
    if (i === dc) baseHoles.push({ x0: xc - 0.85, x1: xc + 0.85, y0: 0, y1: 2.9, rv: 0.35, noBack: true });
    else { const y1 = Math.min(Hb - 0.7, 2.8); baseHoles.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: 1.0, y1 }); wins.push({ xc, yc: (1.0 + y1) / 2, w: ww, h: y1 - 1.0, k: 0 }); }
    for (let k = 1; k < f; k++) { const y0 = Hb + (k - 1) * Hs, sill = y0 + Hs * 0.26, wh = Hs * 0.58; holes.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: sill, y1: sill + wh }); wins.push({ xc, yc: sill + wh / 2, w: ww, h: wh, k, i }); }
  }
  O.breaks = [0.9, top - 0.8]; O.ao = aoProfile(top, zf, n);
  wallHoles(O, rec.mat.base === 'limestone' ? 'limestone' : bodyMat, baseCol, fz(0), n, x0, x1, 0, Hb, baseHoles);
  wallHoles(O, bodyMat, bodyCol, fz(0), n, x0, x1, Hb, top, holes);
  O.ao = null; O.breaks = null;
  for (let y = 0.6; y < Hb - 0.2; y += 0.6) O.ibox('box_stone', (x0 + x1) / 2, y, fz(0.0), len, 0.03, 0.04, mul(baseCol, 0.6));
  O.ibox('box_stone', (x0 + x1) / 2, Hb + 0.08, fz(0.1), len, 0.16, 0.24, trimCol);
  for (const w of wins) win(w.xc, w.yc, w.w, w.h, { k: w.k, noLintel: white && w.k >= 1 && w.i !== 0 && w.i !== nb - 1 });
  const xd = cx(dc); door2(O, B, xd, 1.7, 2.9);
  if (white) {
    const tc = hex('#ece4cf');
    for (let j = 1; j < nb; j++) {                                    // 4 terra-cotta pilasters with Corinthian capitals over floors 1-2
      const xp = x0 + j * colW; bx('limestone', xp - 0.26, 0, 0, xp + 0.26, Hb + Hs - 0.45, 0.16, tc);
      bx('limestone', xp - 0.36, Hb + Hs - 0.45, 0, xp + 0.36, Hb + Hs - 0.05, 0.26, mul(tc, 1.03));
    }
    const y3 = Hb + Hs;                                                // modillioned cornice at the 3rd-floor sills
    bx('limestone', x0, y3 - 0.05, 0, x1, y3 + 0.3, 0.42, tc, 'in'); for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.42) O.ibox('box_stone', x, y3 - 0.12, fz(0.2), 0.12, 0.14, 0.36, tc);
    if (f >= 8) bx('limestone', x0, Hb + (f - 3) * Hs + Hs * 0.2, 0, x1, Hb + (f - 3) * Hs + Hs * 0.2 + 0.24, 0.24, tc, 'in');    // terra-cotta cornice under the 8th floor
    for (const w of wins) if (w.k >= 1 && (w.i === 0 || w.i === nb - 1)) {
      if (w.k >= 3 && w.k <= 6 || w.k === f - 1) O.ibox('box_stone', w.xc, w.yc - w.h / 2 - 0.42, fz(0.05), w.w + 0.1, 0.55, 0.08, mul(tc, 0.97));          // spandrel panels
      if (w.k === 1 || w.k === 3 || w.k === 5) {                      // bracketed balconets with cast-iron railings at the 2nd, 4th and 6th floors
        const yb = w.yc - w.h / 2 - 0.1, bw = w.w + 0.7;
        O.ibox('box_stone', w.xc, yb, fz(0.3), bw, 0.12, 0.6, tc);
        for (const s of [-1, 1]) O.ibox('box_stone', w.xc + s * (bw / 2 - 0.15), yb - 0.25, fz(0.18), 0.14, 0.4, 0.34, tc);
        O.ibox('box_iron', w.xc, yb + 0.95, fz(0.58), bw, 0.04, 0.04, IRON); O.ibox('box_iron', w.xc, yb + 0.12, fz(0.58), bw, 0.03, 0.03, IRON);
        for (const s of [-1, 1]) O.ibox('box_iron', w.xc + s * bw / 2, yb + 0.5, fz(0.3), 0.04, 0.9, 0.58, IRON);
        for (let b = -bw / 2 + 0.1; b < bw / 2; b += 0.11) O.ibox('box_iron', w.xc + b, yb + 0.55, fz(0.58), 0.02, 0.85, 0.02, IRON);
      }
    }
    cornice(top, Hc, mul(tc, 0.98), { proj: 0.55 });                  // denticulated roof cornice
    const pt = H + 0.05;                                               // the parapet + arched pediments over the outer bays, each with a cartouche
    bx('limestone', x0, pt, 0, x1, pt + 0.9, 0.3, tc);
    for (const i of [0, nb - 1]) {
      const xc = cx(i), r = colW * 0.55, base = pt + 0.9, ring = Array.from({ length: 11 }, (_, k) => [xc + Math.cos((k / 10) * PI) * r, base + Math.sin((k / 10) * PI) * r * 0.8]);
      for (const d of [0.0, 0.3]) O.fan('limestone', [[xc - r, base, fz(d)], ...ring.slice().reverse().map((q) => [q[0], q[1], fz(d)])].reverse(), [0, 0, d > 0 ? n : -n], tc);
      for (let k = 0; k < 10; k++) O.quad('limestone', [ring[k][0], ring[k][1], fz(0)], [ring[k + 1][0], ring[k + 1][1], fz(0)], [ring[k + 1][0], ring[k + 1][1], fz(0.3)], [ring[k][0], ring[k][1], fz(0.3)], [ring[k][0] - xc, 1, 0], mul(tc, 0.94));
      O.ibox('box_stone', xc, base + r * 0.3, fz(0.4), 0.7, 0.9, 0.2, mul(tc, 1.02)); O.ibox('box_stone', xc, base - 0.05, fz(0.36), 2 * r + 0.2, 0.14, 0.2, mul(tc, 0.95));
    }
    O.ibox('box_paint', xd, 3.1, fz(1.1), 2.0, 0.08, 2.2, hex('#2a4a3a'));                                           // the canvas entrance awning
    for (const s of [-1, 1]) O.ibox('box_iron', xd + s * 0.95, 1.6, fz(2.15), 0.04, 3.0, 0.04, IRON);
    return;
  }
  O.ibox('box_paint', xd, 3.25, fz(0.7), 2.4, 0.12, 1.4, [0.15, 0.17, 0.2]);
  for (const s of [-1, 1]) O.ibox('box_iron', xd + s * 1.1, 3.0, fz(1.3), 0.04, 0.5, 0.04, IRON);
  for (let k = 3; k < f; k += 3) O.ibox('box_stone', (x0 + x1) / 2, Hb + (k - 1) * Hs - 0.06, fz(0.05), len, 0.12, 0.12, trimCol);
  cornice(top, Hc, mul(bodyCol, 0.55), { proj: 0.6 });
  if (rec.fireEscape) {                                               // a front fire escape: platforms, rails, stair runs and a drop ladder on two bays
    const fc = Math.max(0, Math.min(nb - 2, Math.round(nb / 2 - 1 + (R() < 0.5 ? -1 : 0)))), fx0 = cx(fc) - colW * 0.55, fx1 = cx(fc + 1) + colW * 0.55, fxm = (fx0 + fx1) / 2, fl = fx1 - fx0;
    for (let k = 1; k < f - 1; k++) {
      const y = Hb + (k - 1) * Hs + Hs * 0.2, dd = 1.05;
      O.ibox('box_iron', fxm, y, fz(dd / 2), fl, 0.05, dd, IRON); O.ibox('box_iron', fxm, y + 0.95, fz(dd), fl, 0.04, 0.04, IRON); O.ibox('box_iron', fxm, y + 0.5, fz(dd), fl, 0.03, 0.03, IRON);
      for (const sx of [fx0, fx1]) O.ibox('box_iron', sx, y + 0.5, fz(dd / 2), 0.04, 1.0, dd, IRON);
      for (let x = fx0 + 0.15; x < fx1; x += 0.25) O.ibox('box_iron', x, y + 0.5, fz(dd), 0.02, 0.95, 0.02, IRON);
      O.ibox('box_iron', fx1 - 0.35, y - Hs / 2, fz(dd / 2), 0.5, 0.04, Math.hypot(Hs, dd) * 0.97, IRON, Math.atan2(Hs, dd) * n * -1);
    }
    O.ibox('box_iron', fx0 + 0.3, Hb * 0.55 + 0.8, fz(0.5), 0.5, 0.04, 2.2, IRON, 0.5 * n);
  }
}
function door2(O, B, xd, w, h) {                                        // an apartment-house entrance: glazed double door, sidelight transom
  const { n, fz, doorCol, trimCol } = B, dz = fz(-0.32);
  O.quad('paint', [xd - w / 2, 0, dz], [xd + w / 2, 0, dz], [xd + w / 2, h - 0.5, dz], [xd - w / 2, h - 0.5, dz], [0, 0, n], mul(doorCol, 0.8));
  for (const s of [-1, 1]) O.quad('glass', [xd + s * 0.12, 0.9, fz(-0.3)], [xd + s * (w / 2 - 0.12), 0.9, fz(-0.3)], [xd + s * (w / 2 - 0.12), h - 0.65, fz(-0.3)], [xd + s * 0.12, h - 0.65, fz(-0.3)], [0, 0, n], [0.1, 0.11, 0.13]);
  O.quad('glass', [xd - w / 2, h - 0.45, dz], [xd + w / 2, h - 0.45, dz], [xd + w / 2, h - 0.05, dz], [xd - w / 2, h - 0.05, dz], [0, 0, n], [0.12, 0.13, 0.15]);
  O.ibox('box_stone', xd, h + 0.2, fz(0.1), w + 0.7, 0.36, 0.3, trimCol);
}

/* ------------------------------------------------------------------ (d) 2000s condo */
function condo(O, rec, B) {
  const { n, zf, x0, x1, len, H, R, fz, bx, bodyCol, win } = B;
  const f = Math.max(2, rec.floors), Hb = Math.min(3.8, 0.2 * H), Hs = (H - Hb - 0.4) / (f - 1), top = H - 0.4, holes = [], wins = [], accent = PAL.panel[(rec.mat.tint + 2) % 4], nb = rec.bays, colW = len / nb, brick = mul(PAL.brick[rec.mat.tint % 7], 0.9);
  for (let i = 0; i < nb; i++) {
    const xc = x0 + (i + 0.5) * colW, w = colW * 0.7, lobby = i === Math.floor(nb / 2);
    holes.push({ x0: xc - w / 2, x1: xc + w / 2, y0: lobby ? 0 : 0.7, y1: Hb - 0.6, rv: 0.25, noBack: lobby }); wins.push({ xc, yc: ((lobby ? 0 : 0.7) + Hb - 0.6) / 2, w, h: Hb - 0.6 - (lobby ? 0 : 0.7), lobby, k: 0 });
    for (let k = 1; k < f; k++) { const y0 = Hb + (k - 1) * Hs, sill = y0 + 0.4, wh = Hs - 0.85; holes.push({ x0: xc - w / 2, x1: xc + w / 2, y0: sill, y1: sill + wh, rv: 0.25 }); wins.push({ xc, yc: sill + wh / 2, w, h: wh, k }); }
  }
  O.breaks = [0.9]; O.ao = aoProfile(-10, zf, n);
  wallHoles(O, 'brick', brick, fz(0), n, x0, x1, 0, Hb, holes.filter((h) => h.y1 <= Hb));
  wallHoles(O, (rec.seed >> 1) % 2 ? 'brick' : 'panel', (rec.seed >> 1) % 2 ? brick : mix(accent, bodyCol, 0.3), fz(0), n, x0, x1, Hb, top, holes.filter((h) => h.y1 > Hb));
  O.ao = null; O.breaks = null;
  for (const w of wins) {
    win(w.xc, w.yc, w.w, w.h, { d: -0.2, kind: 2, lit: w.lobby ? 1 : undefined, bare: true, sash: FRAME });
    O.ibox('box_metal', w.xc, w.yc - w.h / 2 - 0.05, fz(0.03), w.w + 0.1, 0.1, 0.12, mul(accent, 0.7));
    if (w.k >= 2 && w.k % 2 === 0 && R() < 0.35) O.ibox('box_iron', w.xc, w.yc - w.h / 2 + 0.55, fz(0.1), w.w, 0.04, 0.04, IRON);
  }
  O.ibox('box_paint', (x0 + x1) / 2, Hb - 0.25, fz(0.5), len * 0.5, 0.14, 1.0, [0.2, 0.22, 0.24]);
  bx('panel', x0, top, 0, x1, H, 0.12, mul(accent, 0.8));
}

/* ------------------------------------------------------------------ (e) church: Gothic, rock-faced stone; a corner tower with an octagonal spire (147: St. Paul's German
   Evangelical Lutheran, 1897-98, Schneider & Herter, now Greater Metropolitan Baptist), a gabled nave front with a tall pointed window, a pointed portal, a stair turret */
function church(O, rec, B) {
  const { n, zf, x0, x1, len, H, R, fz, bx, bodyCol, trimCol } = B;
  const tw = clamp(len * 0.26, 5, 7.5), tx0 = x1 - tw, wc = mul(bodyCol, 0.8), tc = mul(bodyCol, 1.12), dark = [0.05, 0.05, 0.07];
  const eave = 0.55 * H, apex = 0.8 * H, tt = 0.78 * H, spire = H * 1.4, tur = Math.min(1.8, len * 0.08), nx0 = x0 + tur, mid = (nx0 + tx0) / 2;
  const wall = (xa, xb, ya, yb, d = 0, col = wc) => O.quad('rock', [xa, ya, fz(d)], [xb, ya, fz(d)], [xb, yb, fz(d)], [xa, yb, fz(d)], [0, 0, n], col);
  const pointed = (xc, y0, w, ys, d) => { const P = [[xc - w / 2, y0], [xc + w / 2, y0]]; for (let k = 0; k <= 6; k++) { const a = (k / 6) * (PI / 3); P.push([xc - w / 2 + w * Math.cos(a), ys + w * Math.sin(a)]); } for (let k = 1; k <= 6; k++) { const a = PI * 2 / 3 + (k / 6) * (PI / 3); P.push([xc + w / 2 + w * Math.cos(a), ys + w * Math.sin(a)]); } return P.map((q) => [q[0], q[1], fz(d)]); };
  const opening = (xc, y0, w, ys, col = [0.06, 0.07, 0.09]) => {   // a stone surround + the glass (or a door), a sill
    O.fan('rock', pointed(xc, y0 - 0.12, w + 0.5, ys, 0.04), [0, 0, n], tc); O.fan('glass', pointed(xc, y0, w, ys, 0.07), [0, 0, n], col);
    O.ibox('box_stone', xc, y0 - 0.1, fz(0.12), w + 0.6, 0.16, 0.26, tc);
  };
  O.breaks = [0.9]; O.ao = aoProfile(-10, zf, n);
  wall(nx0, tx0, 0, eave); O.fan('rock', [[nx0, eave, fz(0)], [tx0, eave, fz(0)], [mid, apex, fz(0)]], [0, 0, n], wc);
  wall(x0, nx0, 0, 0.7 * H, 0.3); wall(tx0, x1, 0, tt, 0.25);
  O.ao = null; O.breaks = null;
  bx('rock', x0, 0, 0.3 - tur, nx0, 0.7 * H, 0.3, wc, 'out'); bx('rock', tx0, 0, 0.25 - tw, x1, tt, 0.25, wc, 'out');
  for (const [xa, xb, d] of [[x0, nx0, 0.3], [tx0, x1, 0.25]]) for (let y = 3; y < (xa === x0 ? 0.7 * H : tt); y += 6.5) O.ibox('box_stone', (xa + xb) / 2, y, fz(d + 0.06), xb - xa + 0.1, 0.2, 0.14, tc);   // string courses
  // gable coping + finial; the turret's pinnacle
  for (const s of [-1, 1]) { const a = s < 0 ? [nx0, eave] : [tx0, eave], l = Math.hypot(mid - a[0], apex - a[1]); O.ibox('box_stone', (a[0] + mid) / 2, (a[1] + apex) / 2 + 0.12, fz(0.12), l, 0.3, 0.4, tc, 0, 0, Math.atan2(apex - a[1], mid - a[0])); }
  O.ibox('box_stone', mid, apex + 0.6, fz(0.1), 0.35, 1.4, 0.35, tc);
  const pyr = (xa, xb, d0, d1, yb, yt, col, k = 4) => { const cx_ = (xa + xb) / 2, cd = (d0 + d1) / 2, rx = (xb - xa) / 2, rd = (d1 - d0) / 2; for (let i = 0; i < k; i++) { const a0 = (i / k) * 2 * PI + PI / k, a1 = ((i + 1) / k) * 2 * PI + PI / k, p0 = [cx_ + Math.cos(a0) * rx * (k === 4 ? 1.414 : 1), yb, fz(cd + Math.sin(a0) * rd * (k === 4 ? 1.414 : 1))], p1 = [cx_ + Math.cos(a1) * rx * (k === 4 ? 1.414 : 1), yb, fz(cd + Math.sin(a1) * rd * (k === 4 ? 1.414 : 1))], am = (a0 + a1) / 2; O.fan('slate', [p0, p1, [cx_, yt, fz(cd)]], [Math.cos(am), 0.4, n * Math.sin(am)], col); } };
  pyr(x0, nx0, 0.3 - tur, 0.3, 0.7 * H, 0.86 * H, tc);
  // the nave front: a tall pointed window with tracery, a pointed portal with red doors, a small arcade between
  const ww = Math.min(4.2, (tx0 - nx0) * 0.34), wy0 = 0.33 * H, wys = 0.62 * H - ww * 0.866;
  opening(mid, wy0, ww, wys, [0.09, 0.08, 0.12]);
  for (const s of [-1, 0, 1]) O.ibox('box_stone', mid + s * ww / 4, (wy0 + wys) / 2 + 0.3, fz(0.12), 0.12, wys - wy0 + 0.6, 0.12, tc);
  { const rr = ww * 0.28, yc = wys + ww * 0.42, pts = Array.from({ length: 16 }, (_, k) => [mid + Math.cos((k / 16) * 2 * PI) * rr, yc + Math.sin((k / 16) * 2 * PI) * rr, fz(0.1)]); O.fan('rock', pts, [0, 0, n], tc); O.fan('glass', pts.map((q) => [mid + (q[0] - mid) * 0.75, yc + (q[1] - yc) * 0.75, fz(0.12)]), [0, 0, n], [0.1, 0.08, 0.14]); }
  const pw = 2.6, pys = 4.6 - pw * 0.866;
  for (const [g, d] of [[1.5, 0.12], [0.75, 0.2]]) O.fan('rock', pointed(mid, 0, pw + g, pys, d), [0, 0, n], mul(tc, 0.95 + g * 0.03));
  O.fan('paint', pointed(mid, 0, pw, pys, 0.24), [0, 0, n], hex('#7a1d1d')); O.ibox('box_paint', mid, (pys + 0.5) / 2, fz(0.26), 0.05, pys + 0.3, 0.03, dark);
  for (let k = -2; k <= 2; k++) { const ax = mid + k * 0.8; O.fan('glass', pointed(ax, 6.1, 0.42, 6.9, 0.06), [0, 0, n], [0.08, 0.08, 0.1]); O.ibox('box_stone', ax + 0.4, 6.7, fz(0.08), 0.1, 1.4, 0.12, tc); }
  for (const xb of [nx0, tx0]) for (let k = 0; k < 3; k++) { const yb = k * eave / 3, w = 0.9 - k * 0.2; bx('rock', xb - w / 2, yb, 0, xb + w / 2, yb + eave / 3, 0.75 - k * 0.22, wc); }      // stepped buttresses
  // the tower: lancets, a belfry with louvred openings, corner pinnacles, an octagonal spire
  const tm = (tx0 + x1) / 2;
  opening(tm, 1.0, 1.0, 3.2, [0.07, 0.07, 0.09]); O.fan('paint', pointed(tm, 0, 1.4, 1.4, 0.28), [0, 0, n], hex('#7a1d1d'));
  for (const y of [8, 12.5]) opening(tm, y, 0.7, y + 1.8);
  for (const s of [-1, 1]) { opening(tm + s * tw * 0.2, tt - 6.5, 1.0, tt - 3.4); for (let y = tt - 6.3; y < tt - 3.0; y += 0.32) O.ibox('box_paint', tm + s * tw * 0.2, y, fz(0.33), 1.0, 0.05, 0.12, mul(wc, 0.5), 0.5); }
  bx('rock', tx0 - 0.15, tt, -0.15, x1 + 0.15, tt + 0.5, 0.4, tc);
  for (const [px, pd] of [[tx0 + 0.45, 0.0], [x1 - 0.45, 0.0], [tx0 + 0.45, -tw + 0.9], [x1 - 0.45, -tw + 0.9]]) { bx('rock', px - 0.4, tt + 0.5, pd - 0.4, px + 0.4, tt + 2.6, pd + 0.4, wc); pyr(px - 0.4, px + 0.4, pd - 0.4, pd + 0.4, tt + 2.6, tt + 6.2, tc); }
  pyr(tx0 + 0.9, x1 - 0.9, 0.25 - tw + 0.9, 0.25 - 0.9, tt + 0.5, spire, mul(wc, 0.92), 8);
  for (let k = 0; k < 4; k++) O.ibox('box_stone', mid - 0.9 + k * 0.6, 0.1, fz(0.9 + k * 0.0), 0.5, 0.2, 1.4, mul(tc, 0.95));
}

/* ------------------------------------------------------------------ a building's own walls and roof (front handled by its style builder) */
function buildShell(O, rec, plan) {
  const poly = rec.poly, n0 = poly.length, H = rec.h, R = rng(rec.seed + 5);
  const F = rec.front, ring = poly.map((p) => [p[0], p[1]]);
  const col = F ? mul(PAL.brick[(rec.mat.tint + 3) % 7], 0.68) : mul(PAL.brick[(rec.bin >> 3) % 7], 0.6 + R() * 0.2);
  const mans = plan && plan.mans;
  // exposed side walls: churches in their stone, the white apartment house parged white (the photo), everything else common brick
  const white = !!(rec.mat && rec.mat.body === 'whitebrick'), sideM = rec.style === 'church' ? 'rock' : white ? 'stone' : 'brick', sideC = rec.style === 'church' ? mul(PAL.stone[0], 0.7) : white ? [0.86, 0.85, 0.82] : col;
  const Hw = F && rec.style === 'church' ? 0.55 * H : H;
  O.ao = (p) => (p[1] < 0.9 ? 0.6 + 0.4 * Math.max(0, p[1]) / 0.9 : 1);
  for (let i = 0; i < n0; i++) {
    const a = ring[i], b = ring[(i + 1) % n0], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const nx = dz / l, nz = -dx / l;
    if (F && Math.abs(nz) > 0.85 && nz * F.n > 0 && Math.abs((a[1] + b[1]) / 2 - F.z) < 1.3) continue;        // the street wall: the facade builder drew it
    // slice 3 step 2: a wall on another street line is a facade (rec.sides: corner ends 'lo' / 'hi', a through lot's 'back'); draw only what lies outside it
    const segs = [[a, b]], sides = F && rec.sides ? rec.sides : [];
    for (const sd of sides) {
      const isEnd = sd.end !== 'back', k = isEnd ? 1 : 0, j = 1 - k;                          // k: the coordinate the wall runs along (v for an end, u for the back)
      if (isEnd ? !(Math.abs(nx) > 0.85 && (sd.end === 'hi' ? nx > 0 : nx < 0) && Math.abs((a[0] + b[0]) / 2 - sd.u) < 1.3) : !(Math.abs(nz) > 0.85 && nz * F.n < 0 && Math.abs((a[1] + b[1]) / 2 - sd.v) < 1.3)) continue;
      const r0 = isEnd ? sd.v0 : sd.u0, r1 = isEnd ? sd.v1 : sd.u1, next = [];
      for (const [p, q] of segs) {
        const lo = Math.min(p[k], q[k]), hi = Math.max(p[k], q[k]), at = (t) => { const f = (t - p[k]) / ((q[k] - p[k]) || 1), o = [0, 0]; o[k] = t; o[j] = p[j] + (q[j] - p[j]) * f; return o; };
        if (hi <= r0 + 0.05 || lo >= r1 - 0.05) { next.push([p, q]); continue; }
        if (lo < r0 - 0.05) next.push(p[k] < q[k] ? [p, at(r0)] : [at(r0), q]);
        if (hi > r1 + 0.05) next.push(p[k] < q[k] ? [at(r1), q] : [p, at(r1)]);
      }
      segs.length = 0; segs.push(...next);
    }
    for (const [p, q] of segs) {
      O.quad(sideM, [p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], 0.9, q[1]], [p[0], 0.9, p[1]], [nx, 0, nz], sideC);
      O.quad(sideM, [p[0], 0.9, p[1]], [q[0], 0.9, q[1]], [q[0], Hw, q[1]], [p[0], Hw, p[1]], [nx, 0, nz], sideC);
    }
  }
  O.ao = null;
  let cap = ring.map((p) => p.slice());
  if (F) cap = cap.map((p) => ((Math.abs(p[1] - F.z) < 1.3 && (p[1] - F.z) * F.n >= -1.3) ? [p[0], F.z - (mans ? F.n * 0.55 : 0)] : p));
  const tris = earClip(cap), rc = [0.22, 0.22, 0.24];
  for (const t of tris) O.tri('roof', [cap[t[0]][0], Hw, cap[t[0]][1]], [cap[t[1]][0], Hw, cap[t[1]][1]], [cap[t[2]][0], Hw, cap[t[2]][1]], [0, 1, 0], rc, [cap[t[0]][0], cap[t[0]][1]], [cap[t[1]][0], cap[t[1]][1]], [cap[t[2]][0], cap[t[2]][1]]);
  if (F && rec.style === 'church') {                                    // the nave's slate gable roof, ridge front-to-back
    const zs = ring.map((p) => p[1]), back = F.n > 0 ? Math.min(...zs) : Math.max(...zs), tw = clamp(F.len * 0.26, 5, 7.5), tur = Math.min(1.8, F.len * 0.08), xa = F.x0 + tur, xb = F.x1 - tw, mid = (xa + xb) / 2, eave = 0.55 * H, apex = 0.8 * H;
    O.quad('slate', [xa, eave, F.z], [mid, apex, F.z], [mid, apex, back], [xa, eave, back], [-(apex - eave), mid - xa, 0], mul(PAL.slate[0], 0.8));
    O.quad('slate', [mid, apex, F.z], [xb, eave, F.z], [xb, eave, back], [mid, apex, back], [apex - eave, xb - mid, 0], mul(PAL.slate[0], 0.8));
  }
}

/* ------------------------------------------------------------------ street, ground, props */
function buildStreet(O, S, faces, opt) {
  const st = S.street, hw = st.half, rd = st.roadbed / 2, lineW = st.sidewalk0.lineW, lineE = st.sidewalk0.lineE, asw = st.sidewalk0.aveSidewalk, xW = st.xW, xE = st.xE;
  const flat = (mat, x0, x1, z0, z1, y, col) => O.quad(mat, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], col);
  const R = rng(99), Rs = rng(123), LA = opt.omitRear ? 62 : 150;          // slice 3: with the district around, the base street stops short of 124th (the district's units take over)
  flat('asphalt', xW - 160, xE + 160, -LA - 70 * (LA < 150 ? 0 : 1), -rd, -0.16, [0.95, 0.95, 0.97]); flat('asphalt', xW - 160, xE + 160, rd, LA + 70 * (LA < 150 ? 0 : 1), -0.16, [0.95, 0.95, 0.97]);
  flat('asphalt', xW - 160, lineW - asw, -rd, rd, -0.16, [0.95, 0.95, 0.97]); flat('asphalt', lineE + asw, xE + 160, -rd, rd, -0.16, [0.95, 0.95, 0.97]);
  // W 123rd's roadbed with a crown (~2 %): kerb edges at -0.16, the centre line at -0.07
  const xa = lineW - asw, xb = lineE + asw, yc = -0.07;
  O.quad('asphalt', [xa, -0.16, -rd], [xb, -0.16, -rd], [xb, yc, 0], [xa, yc, 0], [0, 1, 0.02], [0.95, 0.95, 0.97]);
  O.quad('asphalt', [xa, yc, 0], [xb, yc, 0], [xb, -0.16, rd], [xa, -0.16, rd], [0, 1, -0.02], [0.95, 0.95, 0.97]);
  const crownY = (z) => yc - (0.09 * Math.abs(z)) / rd;
  for (let i = 0; i < 14; i++) {                                       // utility-cut patches and a long trench repair: darker, newer asphalt
    const x = lineW + 8 + R() * (lineE - lineW - 16), w = 1.2 + R() * 3.5, z0 = -rd + 0.4 + R() * (2 * rd - 2.5), d = 0.8 + R() * 1.8, z1 = Math.min(rd - 0.3, z0 + d), t = R() < 0.6 ? 0.68 : 1.18;
    O.quad('asphalt', [x, crownY(z0) + 0.006, z0], [x + w, crownY(z0) + 0.006, z0], [x + w, crownY(z1) + 0.006, z1], [x, crownY(z1) + 0.006, z1], [0, 1, 0], [t, t, t * 1.02]);
  }
  { const z = -rd * 0.35; O.quad('asphalt', [lineW + 20, crownY(z) + 0.005, z], [lineE - 30, crownY(z) + 0.005, z], [lineE - 30, crownY(z + 0.9) + 0.005, z + 0.9], [lineW + 20, crownY(z + 0.9) + 0.005, z + 0.9], [0, 1, 0], [0.74, 0.74, 0.76]); }
  // the avenue sidewalks (plain), the areaways/yards behind the lot line
  for (const [a, b] of [[lineW - asw, lineW], [lineE, lineE + asw]]) { flat('sidewalk', Math.min(a, b), Math.max(a, b), -rd - LA, -rd, 0.0, [0.86, 0.85, 0.82]); flat('sidewalk', Math.min(a, b), Math.max(a, b), rd, rd + LA, 0.0, [0.86, 0.85, 0.82]); }
  for (const sd of [-1, 1]) flat('sidewalk', lineW, lineE, sd < 0 ? -32 : hw, sd < 0 ? -hw : 32, -0.02, [0.66, 0.64, 0.6]);
  // W 123rd's sidewalks: 5-ft slabs with a joint gap and per-slab tone, a granite kerb, tree pits (left as gaps)
  const trees = (S.trees || []).filter((t) => !(opt.clear || []).some((c) => Math.hypot(t[0] - c[0], t[1] - c[1]) < c[2]));
  const pits = trees.map((t) => [t[0] - 0.75, t[0] + 0.75, t[1]]);
  for (const sd of [-1, 1]) {
    flat('sidewalk', lineW, lineE, sd < 0 ? -hw : rd, sd < 0 ? -rd : hw, -0.012, [0.42, 0.41, 0.39]);
    const za = sd < 0 ? -hw : rd + 0.2, zb = sd < 0 ? -rd - 0.2 : hw, sl = 1.524, rows = Math.max(1, Math.round((zb - za) / sl)), dz = (zb - za) / rows;
    for (let x = lineW; x < lineE - 0.05; x += sl) for (let r = 0; r < rows; r++) {
      const z0 = za + r * dz, z1 = z0 + dz, xe = Math.min(lineE, x + sl);
      if (pits.some((p) => x + sl > p[0] && x < p[1] && Math.abs((z0 + z1) / 2 - p[2]) < 0.9)) continue;
      const t = 0.9 + Rs() * 0.16 - (Rs() < 0.06 ? 0.12 : 0);
      flat('sidewalk', x + 0.008, xe - 0.008, z0 + 0.008, z1 - 0.008, 0.0, [t, t * 0.99, t * 0.96]);
    }
    const zc = sd * rd; O.box('granite', lineW, -0.16, zc - (sd < 0 ? 0.2 : 0), lineE, 0.005, zc + (sd > 0 ? 0.2 : 0), [0.5, 0.5, 0.49]);
  }
  for (const [xc, sg] of [[lineW - asw, -1], [lineE + asw, 1]]) { O.box('granite', xc - 0.1, -0.16, -rd - 150, xc + 0.1, 0.0, -rd, [0.75, 0.75, 0.73]); O.box('granite', xc - 0.1, -0.16, rd, xc + 0.1, 0.0, rd + 150, [0.75, 0.75, 0.73]); }
  for (const c of st.crosswalks || []) for (let z = -rd + 0.4; z < rd - 0.3; z += 0.95) flat('paintline', c.x - 1.5, c.x + 1.5, z, z + 0.5, -0.155, [0.9, 0.9, 0.88]);
  for (const x of [lineW + 0.1, lineE - 1.3]) for (const sd of [-1, 1]) flat('tactile', x, x + 1.2, sd < 0 ? -rd - 0.9 : rd, sd < 0 ? -rd : rd + 0.9, 0.006, [0.85, 0.7, 0.1]);
  for (const x of [-34, 41]) O.fan('asphalt', Array.from({ length: 12 }, (_, k) => [x + Math.cos((k / 12) * 2 * PI) * 0.45, crownY(-0.5) + 0.01, -0.5 + Math.sin((k / 12) * 2 * PI) * 0.45]).reverse(), [0, 1, 0], [0.35, 0.35, 0.37]);
  // tree pits: soil, a low 3-sided guard (open to the kerb); the trees themselves are EZ-Tree instances placed by street.js
  const circles = [];
  for (const t of trees) {
    const [x, z] = t, sd = Math.sign(z), z0 = z - 0.6, z1 = z + 0.6;
    flat('paint', x - 0.74, x + 0.74, z0, z1, -0.006, [0.13, 0.09, 0.06]);
    for (const [px, pz] of [[x - 0.75, z0], [x + 0.75, z0], [x - 0.75, z1], [x + 0.75, z1]]) O.ibox('box_iron', px, 0.24, pz, 0.04, 0.48, 0.04, GUARD);
    const zb = sd > 0 ? z1 : z0; O.ibox('box_iron', x, 0.46, zb, 1.5, 0.035, 0.035, GUARD); O.ibox('box_iron', x, 0.2, zb, 1.5, 0.025, 0.025, GUARD);
    for (const px of [x - 0.75, x + 0.75]) { O.ibox('box_iron', px, 0.46, z, 0.035, 0.035, 1.2, GUARD); O.ibox('box_iron', px, 0.2, z, 0.025, 0.025, 1.2, GUARD); }
    circles.push([x, z, 0.35]);
  }
  // NYC street lights: a tapered grey pole, a davit arm and a cobra-head luminaire over the roadbed
  for (const [x, z, sd] of S.lamps) {
    O.ibox('pole', x, 4.3, z, 1, 8.6, 1, [0.42, 0.44, 0.44]); O.ibox('cyl', x, 0.35, z, 0.36, 0.7, 0.36, [0.4, 0.42, 0.42]);
    O.ibox('box_metal', x, 8.75, z - sd * 0.7, 0.09, 0.09, 1.5, [0.42, 0.44, 0.44], 0.25 * sd); O.ibox('box_metal', x, 8.95, z - sd * 1.8, 0.08, 0.08, 1.0, [0.42, 0.44, 0.44]);
    O.ibox('lamp', x, 8.86, z - sd * 2.5, 0.42, 0.16, 0.85, [1, 0.9, 0.7]); O.ibox('pool', x, 0.012, z - sd * 2.5, 9, 9, 1, [1, 0.82, 0.55], -PI / 2); circles.push([x, z, 0.14]);
  }
  for (const [x, z] of S.hydrants) { O.ibox('cyl', x, 0.38, z, 0.28, 0.76, 0.28, [0.72, 0.1, 0.08]); O.ibox('cyl', x, 0.62, z, 0.38, 0.1, 0.1, [0.72, 0.1, 0.08]); O.ibox('cyl', x, 0.8, z, 0.2, 0.12, 0.2, [0.75, 0.62, 0.15]); circles.push([x, z, 0.25]); }
  for (const [x, z] of S.signs) {                                     // the corner sign posts carry the two street-name blades (text drawn by street.js)
    O.ibox('cyl', x, 1.7, z, 0.07, 3.4, 0.07, [0.4, 0.4, 0.42]); circles.push([x, z, 0.1]);
    const ave = x < 0 ? 2 : 1; BLADES.push([x, 3.05, z, 'x', 1.15, 0], [x, 3.35, z, 'z', ave === 2 ? 2.35 : 1.6, ave]);
  }
  avenues(O, S, circles, opt);
  O.trees = trees;
  return circles;
}

/* ---- slice 2 review: the two avenue ends (WORLD.md §4.1 street furniture). Malcolm X Blvd (Lenox, east, xE) and Adam Clayton Powell Jr Blvd (west, xW): 100-ft
   rights of way (aveHalf 15.24 m, 6 m sidewalks, an 18.5 m roadway; the data has no ACP median, so none is drawn), lane paint, zebra crosswalks and stop bars,
   the far-side sidewalks + kerbs, W 123rd's continuation past each avenue, traffic + pedestrian signals on all 4 corners, name blades and a few lamp posts. */
const BLADES = [];                                                    // [x, y, z, axis the blade runs along, length, text row] -> street.js draws the text
const SIG = hex('#1f2620'), LENS_OFF = [[0.16, 0.05, 0.04], [0.16, 0.12, 0.03], [0.04, 0.13, 0.08]], LENS_ON = [[1.0, 0.12, 0.08], [1.0, 0.7, 0.1], [0.25, 1.0, 0.6]];
function avenues(O, S, circles, opt = {}) {
  const st = S.street, rd = st.roadbed / 2, hw = st.half, AH = st.aveHalf || 15.24, asw = st.sidewalk0.aveSidewalk, K = AH - asw;
  const flat = (mat, x0, x1, z0, z1, y, col) => O.quad(mat, [Math.min(x0, x1), y, Math.min(z0, z1)], [Math.max(x0, x1), y, Math.min(z0, z1)], [Math.max(x0, x1), y, Math.max(z0, z1)], [Math.min(x0, x1), y, Math.max(z0, z1)], [0, 1, 0], col);
  const WHITE = [0.92, 0.92, 0.9], YEL = [0.95, 0.72, 0.12], PY = -0.155, L = opt.omitRear ? 62 : 150;
  for (const [xc, out, row] of [[st.xW, -1, 2], [st.xE, 1, 1]]) {                 // out: the side away from our block
    const far = xc + out * K, lot = xc + out * AH;
    // the far-side sidewalk + kerb, and W 123rd's continuation (sidewalks, kerbs) beyond the far lot line
    for (const sd of [-1, 1]) { flat('sidewalk', far, lot, sd * rd, sd * (rd + L), 0.0, [0.84, 0.83, 0.8]); O.box('granite', Math.min(far, far - out * 0.2), -0.16, Math.min(sd * rd, sd * (rd + L)), Math.max(far, far - out * 0.2), 0.0, Math.max(sd * rd, sd * (rd + L)), [0.72, 0.72, 0.7]); }
    for (const sd of [-1, 1]) { flat('sidewalk', lot, lot + out * L, sd * rd, sd * hw, 0.0, [0.84, 0.83, 0.8]); O.box('granite', Math.min(lot, lot + out * L), -0.16, sd > 0 ? rd : -rd - 0.2, Math.max(lot, lot + out * L), 0.0, sd > 0 ? rd + 0.2 : -rd, [0.72, 0.72, 0.7]); }
    // lane paint: a double yellow centre line, dashed lane lines, stop bars, zebra crosswalks on both sides of the intersection
    const zc0 = rd + 4.2;
    for (const sd of [-1, 1]) {
      const za = sd * zc0, zb = sd * L;
      for (const dx of [-0.17, 0.07]) flat('paintline', xc + dx, xc + dx + 0.1, za, zb, PY, YEL);
      for (const lx of [-3.35, 3.35]) for (let z = zc0 + 2; z < L - 3; z += 12) flat('paintline', xc + lx - 0.06, xc + lx + 0.06, sd * z, sd * (z + 3), PY, WHITE);
      flat('paintline', xc, xc + sd * K, sd * (zc0 + 0.1), sd * (zc0 + 0.6), PY, WHITE);   // right-hand traffic: the stop bar spans the approach half
      for (let x = xc - K + 0.5; x < xc + K - 0.4; x += 1.25) flat('paintline', x, x + 0.6, sd * (rd + 0.7), sd * (rd + 3.7), PY, WHITE);
    }
    // traffic + pedestrian signals on the 4 corners: a dark-green pole, a head on the pole for each street, a mast arm with a head over the avenue's far lanes
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = xc + sx * (K + 0.55), z = sz * (rd + 0.55), h = 4.6;
      O.ibox('pole', x, h / 2, z, 1.25, h, 1.25, SIG); O.ibox('cyl', x, 0.3, z, 0.34, 0.6, 0.34, SIG); circles.push([x, z, 0.14]);
      const head = (hx, hy, hz, face, on) => {                                       // face: [fx, fz] the way the lenses look; on: 0 red, 2 green
        const along = Math.abs(face[0]) > 0.5;
        O.ibox('box_paint', hx, hy, hz, along ? 0.28 : 0.36, 1.0, along ? 0.36 : 0.28, SIG);
        for (let k = 0; k < 3; k++) { const c = k === on ? LENS_ON[k] : LENS_OFF[k]; O.ibox('lens', hx + face[0] * 0.15, hy + 0.32 - k * 0.32, hz + face[1] * 0.15, 0.22, 0.04, 0.22, c, along ? 0 : PI / 2, 0, along ? PI / 2 : 0); }
      };
      head(x, h - 0.2, z + sz * 0.3, [0, sz], 2);                                    // for avenue traffic coming toward this corner: green
      head(x + sx * 0.3, h - 0.2, z, [sx, 0], 0);                                    // for W 123rd traffic: red
      const arm = 5.5; O.ibox('box_metal', x - sx * arm / 2, 5.6, z, arm, 0.1, 0.1, SIG);
      head(x - sx * (arm - 0.2), 5.0, z, [0, sz], 2);
      const ped = (px, pz, face, walk) => LM.pedSignal(O, px, 2.7, pz, face, walk, SIG);
      ped(x, z - sz * 0.2, [0, -sz], true);                                          // across W 123rd: walk (the avenue is green)
      ped(x - sx * 0.2, z, [-sx, 0], false);                                         // across the avenue: don't walk
      if (sx === out) BLADES.push([x, 3.25, z, 'x', 1.15, 0], [x, 3.55, z, 'z', row === 2 ? 2.35 : 1.6, row]);
    }
    // a few lamp posts along both avenue sidewalks, davit arms over the roadway
    for (const sx of [-1, 1]) for (const z of [-118, -76, -34, 34, 76, 118].filter((q) => Math.abs(q) < L)) {
      const x = xc + sx * (K + 0.6), d = -sx;
      O.ibox('pole', x, 4.3, z, 1, 8.6, 1, [0.42, 0.44, 0.44]); O.ibox('cyl', x, 0.35, z, 0.36, 0.7, 0.36, [0.4, 0.42, 0.42]);
      O.ibox('box_metal', x + d * 0.7, 8.75, z, 1.5, 0.09, 0.09, [0.42, 0.44, 0.44], 0, 0, -0.25 * d); O.ibox('box_metal', x + d * 1.8, 8.95, z, 1.0, 0.08, 0.08, [0.42, 0.44, 0.44]);
      O.ibox('lamp', x + d * 2.5, 8.86, z, 0.85, 0.16, 0.42, [1, 0.9, 0.7]); O.ibox('pool', x + d * 2.5, 0.012, z, 9, 9, 1, [1, 0.82, 0.55], -PI / 2); circles.push([x, z, 0.14]);
    }
  }
}

const STOOPS = [];
export function buildAll(job, emit) {
  STOOPS.length = 0; BLADES.length = 0;
  const O = new Out(emit), opt = job.opt || {}, polys = [], bld = [];
  const circles = buildStreet(O, job.street, job.faces, opt);
  for (const face of job.faces) for (const rec of face.buildings) {
    const row = rec.front && (rec.style === 'brownstone' || rec.style === 'second_empire' || isMansard(rec));
    const plan = row ? storyPlan(rec) : null;
    if (opt.omitRear && rec.rear) { polys.push({ pts: rec.poly, h: rec.h, bin: rec.bin, front: null }); continue; }      // slice 3: the district's own unit draws these (street.js o.district)
    buildShell(O, rec, plan);
    if (rec.front) {
      const B = context(O, rec);
      if (row) rowHouse(O, rec, B, plan);
      else if (rec.style === 'prewar') prewar(O, rec, B);
      else if (rec.style === 'condo') condo(O, rec, B);
      else if (rec.style === 'church') church(O, rec, B);
      bld.push({ num: rec.num || '', bin: rec.bin, style: rec.style, x0: +rec.front.x0.toFixed(1), plutoFloors: rec.floors, lpc: rec.lpc || 0, basement: rec.basement ? 1 : 0, wallFloors: plan ? plan.wf : rec.floors, mansardFloor: plan && plan.mans ? 1 : 0, h: rec.h, roof: rec.roof ? rec.roof.type : '' });
    }
    polys.push({ pts: rec.poly, h: rec.h, bin: rec.bin, front: rec.front || null });
  }
  O.flush();
  emit({ t: 'trees', trees: O.trees || [] }); emit({ t: 'blades', list: BLADES.slice() });
  emit({ t: 'collide', polys, circles, stoops: STOOPS.slice() });
  return { tris: O.tris, instances: O.inst, buildings: polys.length, bld };
}

/* ================================================================== slice 3 (docs/WORLD.md 14): the district. buildUnit(job, emit) builds ONE streaming unit: a block face (buildings
   + sidewalk, kerb, yard, lamps, hydrants, trees' pits, bus shelter) or an intersection (corners, crosswalks, signals, the subway entrance), in two tiers:
   'n' near (full 3-D kit) and 'm' mid (extruded footprints with a window-grid atlas). Descriptors: scripts/world/district.mjs. Everything is emitted in the
   street frame (x east, z south); buildings are drawn in their FACE frame and turned by O.T (a rotation about y). Pure JS, no `three`. */
export const KIT_VER = 's3.4';
const hv = (n) => { let h = 2166136261 >>> 0; for (const ch of String(n)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const toG = (th, p) => (th ? [p[1], -p[0]] : [p[0], p[1]]);                       // face frame -> street frame (th = 0 or +90 degrees)
// slice 3 step 3 (WORLD 14.3): a sidewalk shed (NYC Local Law 11 scaffolding) on ~5 % of the buildings: a dark-green plywood deck 3.55 m up, a parapet hoarding, steel posts on a 3.4 m
// pitch with diagonal braces, and a work light under the deck. Flat-fronted styles only (no stoops, no shop awnings); skipped where a lamp, tree, hydrant or shelter stands.
const SHED_G = [0.1, 0.27, 0.2], SHED_P = [0.14, 0.2, 0.17], SHED_STYLES = ['tenement', 'prewar', 'condo'];
function sidewalkShed(O, col, u, th, rec) {
  const F = rec.front, K = u.kerb; if (!F || rec.lm || !SHED_STYLES.includes(rec.style) || rec.stoop || hv('shed' + rec.bin) % 100 >= 22 || F.len < 5.5) return false;
  const s = Math.sign(K.c - F.z), va = F.z, vb = K.c - s * 0.75, D = Math.abs(vb - va); if (!s || D < 3.2) return false;
  const x0 = F.x0 + 0.15, x1 = F.x1 - 0.15, w = x1 - x0, vm = (va + vb) / 2;
  const A = toG(th, [x0 - 0.3, Math.min(va, vb) - 0.3]), B = toG(th, [x1 + 0.3, Math.max(va, vb) + 0.3]), rx0 = Math.min(A[0], B[0]), rx1 = Math.max(A[0], B[0]), rz0 = Math.min(A[1], B[1]), rz1 = Math.max(A[1], B[1]);
  const hit = (p) => p[0] > rx0 && p[0] < rx1 && p[1] > rz0 && p[1] < rz1;
  if ((u.lamps || []).some(hit) || (u.hydrants || []).some(hit) || (u.trees || []).some(hit) || (u.shelters || []).some((q) => hit([q.x, q.z]))) return false;
  const xc = (x0 + x1) / 2, n = Math.max(1, Math.round(w / 3.4)), pitch = w / n;
  O.ibox('box_paint', xc, 3.55, vm, w, 0.14, D, SHED_G);                                           // the plywood deck
  O.ibox('box_paint', xc, 4.1, vb, w, 1.0, 0.07, SHED_G);                                          // the parapet hoarding
  O.ibox('box_metal', xc, 4.62, vb, w, 0.07, 0.1, SHED_P);                                         // its top rail
  O.ibox('box_metal', xc, 3.43, va + s * 0.1, w, 0.18, 0.12, SHED_P);                              // the ledger against the facade
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * pitch, g = toG(th, [x, vb]);
    O.ibox('box_metal', x, 1.74, vb, 0.16, 3.48, 0.16, SHED_P); col.circles.push([g[0], g[1], 0.17]);
    if (i < n) O.ibox('box_metal', x + pitch / 2, 3.2, vb, pitch - 0.2, 0.1, 0.1, SHED_P);        // a rail between the posts
    if (i % 2 === 0 && i < n) O.ibox('box_metal', x + pitch * 0.25, 2.85, vb - s * 0.62, 0.07, 1.9, 0.07, SHED_P, s * 0.33);   // a diagonal brace back to the deck
  }
  for (let i = 0; i < n; i++) O.ibox('lamp', x0 + (i + 0.5) * pitch, 3.44, vm, 0.8, 0.05, 0.14, [1, 0.95, 0.78]);
  (col.shedAt || (col.shedAt = [])).push(toG(th, [xc, vm]).map((v) => Math.round(v * 10) / 10));
  return true;
}

// the shared grid facade: ground (shopfront or lobby) + floors of windows + cornice + optional fire escape. kind: 'commercial' | 'tenement' | 'tower'
function gridFacade(O, rec, B, kind) {
  const { n, zf, x0, x1, len, H, R, fz, bx, bodyMat, bodyCol, baseCol, trimCol, win, cornice, doorCol } = B;
  const f = Math.max(2, rec.floors), tower = kind === 'tower', shop = !!rec.shop && !tower, Hs0 = shop ? 4.3 : Math.min(3.8, 0.2 * H), Hc = tower ? 0.3 : clamp(0.05 * H, 0.7, 1.2);
  const top = H - Hc, Hs = (top - Hs0) / (f - 1), nb = Math.max(2, rec.bays), colW = len / nb, cx = (i) => x0 + (i + 0.5) * colW, holes = [], wins = [];
  const ww = tower ? colW * 0.78 : clamp(colW * 0.5, 0.8, 1.15), wk = tower ? 2 : B.winKind;
  for (let k = 1; k < f; k++) for (let i = 0; i < nb; i++) {
    const xc = cx(i), y0 = Hs0 + (k - 1) * Hs, sill = y0 + Hs * (tower ? 0.18 : 0.27), wh = Hs * (tower ? 0.66 : 0.55);
    holes.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: sill, y1: sill + wh, rv: tower ? 0.2 : 0.22 }); wins.push({ xc, yc: sill + wh / 2, w: ww, h: wh, k });
  }
  O.breaks = [0.9, top - 0.8]; O.ao = aoProfile(top, zf, n);
  // ground floor
  if (shop) LM.shopRow(O, rec, B, Hs0);
  else {
    const bh = [], dc = Math.floor(nb / 2);
    for (let i = 0; i < nb; i++) { const xc = cx(i); if (i === dc) bh.push({ x0: xc - 0.85, x1: xc + 0.85, y0: 0, y1: 2.7, rv: 0.3, noBack: true }); else bh.push({ x0: xc - ww / 2, x1: xc + ww / 2, y0: 1.0, y1: Math.min(Hs0 - 0.5, 2.6) }); }
    wallHoles(O, tower ? 'brick' : 'stone', tower ? bodyCol : baseCol, fz(0), n, x0, x1, 0, Hs0, bh);
    for (const h of bh) if (!h.noBack) win((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, h.x1 - h.x0, h.y1 - h.y0, { k: 0, bare: tower });
    door2(O, B, cx(dc), 1.7, 2.7);
  }
  wallHoles(O, tower && R() < 0.5 ? 'panel' : bodyMat, tower && R() < 0.5 ? mix(bodyCol, [0.5, 0.5, 0.52], 0.5) : bodyCol, fz(0), n, x0, x1, Hs0, top, holes);
  O.ao = null; O.breaks = null;
  for (const w of wins) win(w.xc, w.yc, w.w, w.h, { k: w.k, kind: wk, bare: tower, noLintel: tower, sash: tower ? FRAME : undefined });
  if (tower) { for (let k = 2; k < f; k += 2) O.ibox('box_stone', (x0 + x1) / 2, Hs0 + (k - 1) * Hs - 0.02, fz(0.04), len, 0.12, 0.1, mul(bodyCol, 1.25)); bx('stone', x0, top, 0, x1, H, 0.2, mul(bodyCol, 0.8)); }
  else cornice(top, Hc, mul(bodyCol, 0.55), { proj: kind === 'commercial' ? 0.55 : 0.5, dentils: kind === 'commercial' });
  if (rec.fireEscape && !tower) {                                       // a front fire escape: landings with rails on two bays, drop ladder
    const fc = Math.max(0, Math.min(nb - 2, Math.round(nb / 2 - 1 + (R() < 0.5 ? -1 : 0)))), fx0 = cx(fc) - colW * 0.55, fx1 = cx(fc + 1) + colW * 0.55, fxm = (fx0 + fx1) / 2, fl = fx1 - fx0;
    for (let k = 1; k < f; k++) {
      const y = Hs0 + (k - 1) * Hs + Hs * 0.2, dd = 1.0;
      O.ibox('box_iron', fxm, y, fz(dd / 2), fl, 0.05, dd, IRON); O.ibox('box_iron', fxm, y + 0.95, fz(dd), fl, 0.04, 0.04, IRON); O.ibox('box_iron', fxm, y + 0.5, fz(dd), fl, 0.03, 0.03, IRON);
      for (const sx of [fx0, fx1]) O.ibox('box_iron', sx, y + 0.5, fz(dd / 2), 0.04, 1.0, dd, IRON);
      for (let x = fx0 + 0.15; x < fx1; x += 0.3) O.ibox('box_iron', x, y + 0.5, fz(dd), 0.02, 0.95, 0.02, IRON);
      if (k > 1) O.ibox('box_iron', fx1 - 0.35, y - Hs / 2, fz(dd / 2), 0.5, 0.04, Math.hypot(Hs, dd) * 0.97, IRON, Math.atan2(Hs, dd) * n * -1);
    }
  }
}

// mid tier: the footprint extruded (a flat window-grid atlas on the walls, a cornice band on the street face, awnings on shops), vertex-coloured
function midBuilding(M, rec, T, pal) {
  const poly = rec.poly, nP = poly.length, H = rec.h, tint = pal[((rec.seed || rec.bin || 0) >>> 0) % pal.length], cell = [13.6, 13.2];
  const col = rec.style === 'tower' ? [0.74, 0.7, 0.66] : rec.style === 'church' ? [0.6, 0.6, 0.6] : rec.mat && rec.mat.body === 'whitebrick' ? [1.05, 1.02, 0.95] : tint;
  for (let i = 0; i < nP; i++) {
    const a = poly[i], b = poly[(i + 1) % nP], du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv); if (l < 0.3) continue;
    const nx = dv / l, nz = -du / l, ctr = (a[1] + b[1]) / 2;
    M.quad('mid', [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], H, b[1]], [a[0], H, a[1]], [nx, 0, nz], col);
    if (rec.front && Math.abs(nz) > 0.9 && Math.abs(ctr - rec.front.z) < 1.2 && nz * rec.front.n > 0) {
      const nn = [0, 0, rec.front.n], z = rec.front.z + rec.front.n * 0.28;
      M.quad('midsolid', [a[0], H - 0.9, z], [b[0], H - 0.9, z], [b[0], H, z], [a[0], H, z], nn, [0.3, 0.27, 0.25]);
      if (rec.shop) M.quad('midsolid', [a[0], 0.3, rec.front.z + rec.front.n * 0.05], [b[0], 0.3, rec.front.z + rec.front.n * 0.05], [b[0], 4.0, rec.front.z + rec.front.n * 0.05], [a[0], 4.0, rec.front.z + rec.front.n * 0.05], nn, [0.1, 0.12, 0.14]);
    }
  }
  const cap = poly.map((p) => [p[0], p[1]]); for (const t of earClip(cap)) M.tri('midsolid', [cap[t[0]][0], H, cap[t[0]][1]], [cap[t[1]][0], H, cap[t[1]][1]], [cap[t[2]][0], H, cap[t[2]][1]], [0, 1, 0], [0.22, 0.22, 0.24], [0, 0], [0.01, 0], [0.01, 0.01]);
}

// slice 3 step 2: the landmark + 125th St builders (landmarks.js), given this kit's helpers
const LM = makeLandmarks({ PAL, hex, mul, mix, clamp, rng, wallHoles, aoProfile, IRON, FRAME, context });
// a corner building's second street facade (rec.sides, district.mjs): the same style drawn in a frame turned +-90 degrees about y (u' along the side wall, z' = out)
function sideFacades(O, rec, th) {
  if (!rec.sides || rec.style === 'church' || rec.lm === 'apollo' || rec.lm === 'sob') return;
  const T0 = O.T;
  for (const sd of rec.sides) {
    const hi = sd.end === 'hi', bk = sd.end === 'back', fn = rec.front.n;
    // the facade's own frame: x along the wall, z out of it (+1). An end: turned +-90 degrees; a back: turned 180 (front facing +v) or not at all (front facing -v)
    const th2 = bk ? (fn > 0 ? PI : 0) : hi ? PI / 2 : -PI / 2;
    const front = bk ? (fn > 0 ? { x0: -sd.u1, x1: -sd.u0, z: -sd.v, n: 1, len: sd.len } : { x0: sd.u0, x1: sd.u1, z: sd.v, n: 1, len: sd.len })
      : hi ? { x0: -sd.v1, x1: -sd.v0, z: sd.u, n: 1, len: sd.len } : { x0: sd.v0, x1: sd.v1, z: -sd.u, n: 1, len: sd.len };
    const r2 = { ...rec, front, sides: null, party: [0, 0], stoop: null, bays: Math.max(2, Math.round(sd.len / 2.5)), seed: (Math.imul(rec.seed || 1, 7) + 13) & 0xffffff, fireEscape: 0 };
    O.T = { c: Math.cos(th + th2), s: Math.sin(th + th2), tx: 0, tz: 0 };
    const B = context(O, r2);
    if (rec.lm === 'theresa') LM.theresa(O, r2, B, { sign: hi });
    else if (rec.style === 'commercial') LM.commercial(O, r2, B);
    else if (rec.style === 'tower') gridFacade(O, r2, B, 'tower');
    else if (rec.style === 'prewar') prewar(O, r2, B);
    else if (rec.style === 'condo') condo(O, r2, B);
    else gridFacade(O, { ...r2, shop: rec.shop ? 1 : 0, cornice: 'bracketed' }, B, 'tenement');
    O.T = T0;
  }
}
const MIDTONES = [[0.66, 0.52, 0.46], [0.6, 0.47, 0.42], [0.9, 0.78, 0.72], [0.72, 0.6, 0.55], [0.8, 0.7, 0.64], [0.55, 0.44, 0.4]].map((c) => c);
// the quads of the mid walls need uvs in tile units: Out.quad's uvOf gives metres, the atlas material (district.js) scales by 1/cell with texture.repeat

export function buildUnit(job, emit) {
  const u = job.unit, t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  STOOPS.length = 0;
  const O = new Out(emit, 'n'), M = new Out(emit, 'm');
  const col = { walls: [], boxes: [], circles: [], cyls: [], fence: [], trees: u.trees || [], stoops: [] };
  const flat = (mat, x0, x1, z0, z1, y, c, o = O) => { if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return; o.quad(mat, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], c); };
  const gran = [0.72, 0.72, 0.7];
  // a ground rectangle minus the holes in it (the subway stairwell): up to four strips round each hole
  const holed = (r, fn) => { let rs = [r]; for (const h of u.holes || []) rs = rs.flatMap((q) => { if (h[0] >= q[2] || h[2] <= q[0] || h[1] >= q[3] || h[3] <= q[1]) return [q];
    const o = []; if (h[1] > q[1]) o.push([q[0], q[1], q[2], h[1]]); if (h[3] < q[3]) o.push([q[0], h[3], q[2], q[3]]); const z0 = Math.max(q[1], h[1]), z1 = Math.min(q[3], h[3]);
    if (h[0] > q[0]) o.push([q[0], z0, h[0], z1]); if (h[2] < q[2]) o.push([h[2], z0, q[2], z1]); return o; }); rs.forEach(fn); };
  let nb = 0;
  if (u.kind === 'F') {
    const th = u.T.th, tc = { c: Math.cos(th), s: Math.sin(th), tx: 0, tz: 0 }, W = u.walk, K = u.kerb, withNear = !u.skipNear && u.inner;
    // ---- mid tier: all buildings (including those the base path draws near)
    M.T = tc; const pal = MIDTONES;
    for (const rec of u.buildings) if (!LM.midLandmark(M, rec)) midBuilding(M, rec, tc, pal);
    M.T = null;
    // a mid-tier sidewalk + yard slab so the ground reads when the near ground fades out
    flat('midsolid', W[0], W[2], W[1], W[3], -0.045, [0.62, 0.6, 0.57], M);
    // ---- colliders (street frame)
    for (const rec of u.buildings) {
      const pts = rec.poly.map((p) => toG(th, p)); col.walls.push({ pts, h: rec.h, bin: rec.bin });
      if (rec.front && (rec.angledBay || rec.rusticated)) { const F = rec.front, z0 = F.z, z1 = F.z + F.n * 0.75, q = [toG(th, [F.x0, Math.min(z0, z1)]), toG(th, [F.x1, Math.max(z0, z1)])]; col.boxes.push({ x0: Math.min(q[0][0], q[1][0]), z0: Math.min(q[0][1], q[1][1]), x1: Math.max(q[0][0], q[1][0]), z1: Math.max(q[0][1], q[1][1]), y0: 1.5, y1: rec.h }); }
    }
    // the lot line: a fence along the whole face (nothing walks into the block)
    if (u.line && !u.skipNear) col.fence.push(u.avenue ? [u.line.c, u.line.a, u.line.c, u.line.b] : [u.line.a, u.line.c, u.line.b, u.line.c]);
    if (withNear) {
      O.T = null;
      // ---- ground: sidewalk slab (a textured quad), granite kerb, the yard behind the building line
      holed(W, (a) => flat('sidewalk', a[0], a[2], a[1], a[3], 0.0, [0.86, 0.85, 0.82]));
      flat('sidewalk', u.yard[0], u.yard[2], u.yard[1], u.yard[3], -0.02, [0.5, 0.48, 0.44]);
      if (K.axis === 'z') O.box('granite', K.a, -0.16, K.c - (K.inward > 0 ? 0.2 : 0), K.b, 0.005, K.c + (K.inward < 0 ? 0.2 : 0), gran);
      else O.box('granite', K.c - (K.inward > 0 ? 0.2 : 0), -0.16, K.a, K.c + (K.inward < 0 ? 0.2 : 0), 0.005, K.b, gran);
      // lane paint on the avenue faces (the W face carries the centre line, each face its own dashed lane line) and on 125th (the S face)
      if (u.cars && (u.avenue || u.c125) && u.cars.rd) {
        const Y = [0.95, 0.72, 0.12], WH = [0.92, 0.92, 0.9], PY = -0.155, rdh = u.cars.rd, c0 = K.c - K.inward * rdh;
        if (u.avenue) { if (u.side === 'W') for (const dx of [-0.17, 0.07]) flat('paintline', c0 + dx, c0 + dx + 0.1, K.a + 4.5, K.b - 4.5, PY, Y);
          // slice 3 step 3: ACP / Lenox are 34 m between the sidewalks: a solid parking line 2.4 m off the kerb, then a dashed lane line every 3.6 m up to the centre line
          for (let d = 2.4; d < rdh - 1.6; d += 3.6) { const lx = K.c - K.inward * d; if (d < 3) flat('paintline', lx - 0.06, lx + 0.06, K.a + 6, K.b - 8, PY, WH); else for (let z = K.a + 6; z < K.b - 8; z += 9) flat('paintline', lx - 0.06, lx + 0.06, z, z + 3, PY, WH); } }
        else if (u.side === 'S') for (const dz of [-0.17, 0.07]) flat('paintline', K.a + 4.5, K.b - 4.5, c0 + dz, c0 + dz + 0.1, PY, Y);
      }
      // tree pits: soil + a low three-sided guard (the trees are EZ-Tree instances placed by district.js)
      for (const [x, z] of col.trees) {
        const sd = u.avenue ? 0 : Math.sign(K.c - z) || 1;
        flat('paint', x - 0.74, x + 0.74, z - 0.6, z + 0.6, -0.006, [0.13, 0.09, 0.06]);
        for (const [px, pz] of [[x - 0.75, z - 0.6], [x + 0.75, z - 0.6], [x - 0.75, z + 0.6], [x + 0.75, z + 0.6]]) O.ibox('box_iron', px, 0.24, pz, 0.04, 0.48, 0.04, GUARD);
        O.ibox('box_iron', x, 0.46, z + 0.6, 1.5, 0.035, 0.035, GUARD); O.ibox('box_iron', x, 0.46, z - 0.6, 1.5, 0.035, 0.035, GUARD);
        col.circles.push([x, z, 0.35]);
      }
      // street lights (cobra heads over the roadway), hydrants
      for (const [x, z, sd] of u.lamps) {
        const ax = u.avenue, dx = ax ? -sd : 0, dz = ax ? 0 : -sd, SG = [0.42, 0.44, 0.44];
        O.ibox('pole', x, 4.3, z, 1, 8.6, 1, SG); O.ibox('cyl', x, 0.35, z, 0.36, 0.7, 0.36, [0.4, 0.42, 0.42]);
        if (ax) { O.ibox('box_metal', x + dx * 0.7, 8.75, z, 1.5, 0.09, 0.09, SG, 0, 0, -0.25 * dx); O.ibox('box_metal', x + dx * 1.8, 8.95, z, 1.0, 0.08, 0.08, SG); O.ibox('lamp', x + dx * 2.5, 8.86, z, 0.85, 0.16, 0.42, [1, 0.9, 0.7]); O.ibox('pool', x + dx * 2.5, 0.012, z, 9, 9, 1, [1, 0.82, 0.55], -PI / 2); }
        else { O.ibox('box_metal', x, 8.75, z + dz * 0.7, 0.09, 0.09, 1.5, SG, 0.25 * -dz); O.ibox('box_metal', x, 8.95, z + dz * 1.8, 0.08, 0.08, 1.0, SG); O.ibox('lamp', x, 8.86, z + dz * 2.5, 0.42, 0.16, 0.85, [1, 0.9, 0.7]); O.ibox('pool', x, 0.012, z + dz * 2.5, 9, 9, 1, [1, 0.82, 0.55], -PI / 2); }
        col.circles.push([x, z, 0.14]); col.cyls.push([x, z, 0.14, 8.6]);
      }
      for (const [x, z] of u.hydrants) { O.ibox('cyl', x, 0.38, z, 0.28, 0.76, 0.28, [0.72, 0.1, 0.08]); O.ibox('cyl', x, 0.62, z, 0.38, 0.1, 0.1, [0.72, 0.1, 0.08]); O.ibox('cyl', x, 0.8, z, 0.2, 0.12, 0.2, [0.75, 0.62, 0.15]); col.circles.push([x, z, 0.25]); }
      // bus shelters on the avenues (steel frame, glass panels, a bench, a roof; no ads)
      for (const sh of u.shelters || []) {
        const L = 3.6, D = 1.5, s = sh.face, SK = [0.2, 0.22, 0.24];
        const cxm = sh.x, czm = sh.z, rear = cxm - s * (D / 2);
        O.ibox('box_metal', cxm, 2.55, czm, D + 0.3, 0.1, L + 0.3, SK); O.ibox('box_stone', rear, 1.35, czm, 0.03, 2.2, L, [0.42, 0.55, 0.6]);
        for (const dz of [-L / 2, 0, L / 2]) { O.ibox('box_metal', rear, 1.3, czm + dz, 0.07, 2.5, 0.07, SK); O.ibox('box_metal', rear + s * D, 1.3, czm + dz, 0.07, 2.5, 0.07, SK); }
        for (const dz of [-L / 2 + 0.7, L / 2 - 0.7]) O.ibox('box_metal', rear + s * D / 2, 0.5, czm + dz, D - 0.3, 0.06, 0.05, SK);
        O.ibox('box_metal', rear + s * 0.35, 0.5, czm, 0.4, 0.06, L - 0.8, [0.3, 0.32, 0.34]);
        O.ibox('box_iron', rear + s * D, 1.3, czm + L / 2 + 0.7, 0.05, 2.6, 0.05, SK);
        col.boxes.push({ x0: cxm - D / 2 - 0.1, z0: czm - L / 2 - 0.1, x1: cxm + D / 2 + 0.1, z1: czm + L / 2 + 0.1, y0: 0, y1: 2.6 }); col.shelter = true;
      }
      // ---- buildings (full kit) in the face frame
      O.T = tc;
      const Rg = rng(hv(u.id));
      for (const rec of u.buildings) {
        if (rec.nb) continue;
        if (rec.lm === 'sob') {                                          // the State Office Building: the whole slab + its plaza (landmarks.js)
          const pz = LM.sob(O, rec, tc, { a: u.line.a, b: u.line.b, z0: rec.front.z, z1: u.line.c, line: u.line.c });
          for (const t of pz) col.trees.push(t); nb++; continue;
        }
        const row = rec.front && (rec.style === 'brownstone' || rec.style === 'second_empire' || isMansard(rec)), plan = row ? storyPlan(rec) : null;
        buildShell(O, rec, plan);
        if (rec.front) {
          const B = context(O, rec);
          if (rec.lm === 'apollo') LM.apollo(O, rec, B);
          else if (rec.lm === 'theresa') LM.theresa(O, rec, B);
          else if (row) rowHouse(O, rec, B, plan);
          else if (rec.style === 'prewar') prewar(O, rec, B);
          else if (rec.style === 'condo') condo(O, rec, B);
          else if (rec.style === 'church') church(O, rec, B);
          else if (rec.style === 'commercial') LM.commercial(O, rec, B);
          else if (rec.style === 'tenement' || rec.style === 'tower') gridFacade(O, rec, B, rec.style);
          else prewar(O, rec, B);
          sideFacades(O, rec, th);
          if (sidewalkShed(O, col, u, th, rec)) col.sheds = (col.sheds || 0) + 1;
          nb++;
        }
      }
      O.T = null; void Rg;
      for (const s of STOOPS) {                                          // the stoop masses (not climbable here): boxes in the street frame
        const a = toG(th, [s.xd - s.sw / 2 - 0.3, s.zf]), b = toG(th, [s.xd + s.sw / 2 + 0.3, s.zf + s.n * s.depthMax]);
        col.boxes.push({ x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]), y0: 0, y1: s.Hb + 1.0 });
      }
    }
  } else if (u.kind === 'P') {                                          // slice 3 step 2: Marcus Garvey Park's west half (landmarks.js park)
    LM.park(O, M, u, col);
  } else {                                                              // an intersection
    const { xa, zs, rdS, hwS, rdA, AH } = u, base = u.base;
    if (!base && u.inner) {
      const asw = u.asw, WH = [0.92, 0.92, 0.9], SIG = hex('#1f2620');
      const sub = u.subway;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const xA = sx < 0 ? xa - AH : xa + rdA, xB = sx < 0 ? xa - rdA : xa + AH, zA = sz < 0 ? zs - hwS : zs + rdS, zB = sz < 0 ? zs - rdS : zs + hwS;
        flat('sidewalk', xA, xB, zA, zB, 0.0, [0.86, 0.85, 0.82]);
        // granite kerb pieces along both street edges of the corner
        O.box('granite', xA, -0.16, sz < 0 ? zB - 0.2 : zA, xB, 0.005, sz < 0 ? zB : zA + 0.2, gran);
        O.box('granite', sx < 0 ? xB - 0.2 : xA, -0.16, zA, sx < 0 ? xB : xA + 0.2, 0.005, zB, gran);
        // the signal pole: head toward the avenue, head toward the street, mast arm, pedestrian signals (as W 123rd's corners)
        const x = xa + sx * (rdA + 0.55), z = zs + sz * (rdS + 0.55), h = 4.6;
        O.ibox('pole', x, h / 2, z, 1.25, h, 1.25, SIG); O.ibox('cyl', x, 0.3, z, 0.34, 0.6, 0.34, SIG); col.circles.push([x, z, 0.14]); col.cyls.push([x, z, 0.14, h]);
        const head = (hx, hy, hz, face, on) => { const along = Math.abs(face[0]) > 0.5; O.ibox('box_paint', hx, hy, hz, along ? 0.28 : 0.36, 1.0, along ? 0.36 : 0.28, SIG);
          for (let k = 0; k < 3; k++) { const c = k === on ? LENS_ON[k] : LENS_OFF[k]; O.ibox('lens', hx + face[0] * 0.15, hy + 0.32 - k * 0.32, hz + face[1] * 0.15, 0.22, 0.04, 0.22, c, along ? 0 : PI / 2, 0, along ? PI / 2 : 0); } };
        head(x, h - 0.2, z + sz * 0.3, [0, sz], 2); head(x + sx * 0.3, h - 0.2, z, [sx, 0], 0);
        const arm = 5.5; O.ibox('box_metal', x - sx * arm / 2, 5.6, z, arm, 0.1, 0.1, SIG); head(x - sx * (arm - 0.2), 5.0, z, [0, sz], 2);
        const ped = (px, pz, face, walk) => LM.pedSignal(O, px, 2.7, pz, face, walk, SIG);
        ped(x, z - sz * 0.2, [0, -sz], true); ped(x - sx * 0.2, z, [-sx, 0], false);
      }
      if (sub && sub.rect) LM.subway(O, col, sub);
      // zebra crosswalks on the four legs + stop bars
      for (const sz of [-1, 1]) { const z0 = zs + sz * (rdS + 0.7); for (let x = xa - AH + asw + 0.4; x < xa + AH - asw - 0.4; x += 1.25) flat('paintline', x, x + 0.6, Math.min(z0, z0 + sz * 3.0), Math.max(z0, z0 + sz * 3.0), -0.155, WH); }
      for (const sx of [-1, 1]) { const x0 = xa + sx * (rdA + 0.7); for (let z = zs - rdS + 0.4; z < zs + rdS - 0.4; z += 1.25) flat('paintline', Math.min(x0, x0 + sx * 3.0), Math.max(x0, x0 + sx * 3.0), z, z + 0.6, -0.155, WH); }
    }
    // a mid ground slab at the intersection corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) flat('midsolid', sx < 0 ? xa - AH : xa + rdA, sx < 0 ? xa - rdA : xa + AH, sz < 0 ? zs - hwS : zs + rdS, sz < 0 ? zs - rdS : zs + hwS, -0.045, [0.62, 0.6, 0.57], M);
  }
  O.flush(); M.flush();
  emit({ t: 'unitcol', id: u.id, col });
  return { tris: O.tris + M.tris, instances: O.inst, buildings: nb, sheds: col.sheds || 0, shedAt: col.shedAt || [], ms: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0) };
}
