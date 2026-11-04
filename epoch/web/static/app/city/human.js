// city/human.js · people that look human (docs/COZY.md 3b): stylised-realistic, clearly human, never a mascot.
// One builder for everyone: the user's own character (character.js buildFigure: room, Today, city, Focus, store turntables) and the
// other people in the study spots (spots/kit.js createCrowd). Smooth low-poly parts, merged per body part, vertex colours only
// (figureMaterial), so a person costs one draw call per part (the user) or nothing extra at all (the crowd is one mesh).
//
//   buildPerson(spec, det) -> { parts, dims }       det: 'hi' (the user, <= 3k triangles), 'mid' (others, <= 800), 'lo' (far LOD)
//     spec = { skin, hair, hairStyle, look, build, glasses, iris, acc }   (hex colours; look = an OUTFIT_LOOK-style clothes object)
//     parts: torso, head, eyes (hi only; blink by scaling y), upper[2], fore[2], hand[2], thigh[2], shin[2] (index 0 = the figure's
//            right side, x < 0), glasses, headphones, backpack (each a SoftGeo or null), in the pivot frames listed in DIM below.
//   randomLook(r) -> a seeded person (skin, hair and hair style, build, clothes) for the crowd
//
// Frames (metres, facing +z, y up): spine at the hips (DIM.HIP above the feet); shoulders at (±SH_X, SH_Y) on the spine; the neck
// pivot at NECK_Y on the spine; the elbow UPPER below the shoulder; the wrist FORE below the elbow; hips at (±HIP_X, HIP); the knee
// THIGH below the hip; the sole SHIN below the knee.
import * as THREE from 'three';
import { Geo, rgb, shade, clamp, mixc } from './util.js';

const PI = Math.PI, TAU = PI * 2;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

export const DIM = { HIP: 0.92, HIP_X: 0.095, SH_X: 0.172, SH_Y: 0.452, NECK_Y: 0.542, UPPER: 0.29, FORE: 0.25, HAND_AT: 0.3, THIGH: 0.46, SHIN: 0.46 };
const SEG = { hi: { torso: 12, limb: 8, hand: 6, shoe: 8, headT: 12, headP: 9, hairU: 4, neck: 8 }, mid: { torso: 8, limb: 5, hand: 4, shoe: 4, headT: 8, headP: 5, hairU: 2, neck: 5 }, lo: { torso: 6, limb: 4, hand: 3, shoe: 4, headT: 6, headP: 4, hairU: 2, neck: 4 } };

/* ------------------------------------------------------------ smooth geometry: lofted rings with averaged normals */
export class SoftGeo extends Geo {
  /** rows of points (each a closed loop of the same length), optional poles; normals are averaged per vertex (smooth shading).
   *  o: { col: colour | (row, k, p) => colour, pole0, pole1, inward (an inner surface), skip(row) (no band below that row) } */
  lattice(rows, o = {}) {
    const R = rows.length, seg = rows[0].length, base = this.n;
    const colAt = typeof o.col === 'function' ? o.col : () => o.col;
    for (let r = 0; r < R; r++) for (let k = 0; k < seg; k++) { const p = rows[r][k]; this._v(p[0], p[1], p[2], 0, 1, 0, colAt(r, k, p), 0, 1, 1, 0); }
    const V = (r, k) => base + r * seg + (((k % seg) + seg) % seg);
    const p0 = o.pole0 ? this._v(o.pole0[0], o.pole0[1], o.pole0[2], 0, 1, 0, colAt(0, 0, o.pole0), 0, 1, 1, 0) : -1;
    const p1 = o.pole1 ? this._v(o.pole1[0], o.pole1[1], o.pole1[2], 0, 1, 0, colAt(R - 1, 0, o.pole1), 0, 1, 1, 0) : -1;
    const T = [];
    if (p0 >= 0) for (let k = 0; k < seg; k++) T.push(p0, V(0, k + 1), V(0, k));
    for (let r = 0; r + 1 < R; r++) { if (o.skip && o.skip(r)) continue; for (let k = 0; k < seg; k++) { const A = V(r, k), B = V(r, k + 1), C = V(r + 1, k + 1), D = V(r + 1, k); T.push(A, B, C, A, C, D); } }
    if (p1 >= 0) for (let k = 0; k < seg; k++) T.push(V(R - 1, k), V(R - 1, k + 1), p1);
    // outward: a band's face normal against the direction away from its row's centre (the widest row decides)
    let flip = false;
    if (R >= 2) {
      let best = 0, br = 0;
      for (let r = 0; r + 1 < R; r++) { const row = rows[r]; let cx = 0, cy = 0, cz = 0; for (const p of row) { cx += p[0]; cy += p[1]; cz += p[2]; } cx /= seg; cy /= seg; cz /= seg; let s = 0; for (const p of row) s += Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz); if (s > best) { best = s; br = r; } }
      const row = rows[br]; let cx = 0, cy = 0, cz = 0; for (const p of row) { cx += p[0]; cy += p[1]; cz += p[2]; } cx /= seg; cy /= seg; cz /= seg;
      let dot = 0;
      for (let k = 0; k < seg; k++) {
        const A = row[k], B = row[(k + 1) % seg], D = rows[br + 1][k];
        const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
        dot += (uy * vz - uz * vy) * (A[0] - cx) + (uz * vx - ux * vz) * (A[1] - cy) + (ux * vy - uy * vx) * (A[2] - cz);
      }
      flip = dot < 0;
    }
    if (o.inward) flip = !flip;
    const n = this.n - base, N = new Float64Array(n * 3), P = this.pos;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i], b = flip ? T[i + 2] : T[i + 1], c = flip ? T[i + 1] : T[i + 2];
      this.idx.push(a, b, c);
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { const j = (v - base) * 3; N[j] += fx; N[j + 1] += fy; N[j + 2] += fz; }
    }
    for (let j = 0; j < n; j++) {
      let x = N[j * 3], y = N[j * 3 + 1], z = N[j * 3 + 2]; const l = Math.hypot(x, y, z);
      if (l > 1e-12) { x /= l; y /= l; z /= l; } else { x = 0; y = 1; z = 0; }
      const q = (base + j) * 3; this.nor[q] = x; this.nor[q + 1] = y; this.nor[q + 2] = z;
    }
  }
  /** a tube through stations. axis 'y': {y, rx, rz, cx, cz, col, p}; axis 'z': {z, rx, ry, cx, cy, col, p}; axis 'x': {x, ry, rz, cy, cz}.
   *  p = squareness (2 = an ellipse, 3-4 = a rounded box). o: { cap0, cap1 (pole distance past the end), rot, mod(point, st), colFn } */
  tube(st, seg, o = {}) {
    const ax = o.axis || 'y', rot = o.rot || 0, rows = [];
    for (const s of st) {
      const row = [], p = s.p || 2;
      for (let k = 0; k < seg; k++) {
        const t = rot + (k / seg) * TAU; let c = Math.cos(t), si = Math.sin(t);
        if (p !== 2) { c = Math.sign(c) * Math.pow(Math.abs(c), 2 / p); si = Math.sign(si) * Math.pow(Math.abs(si), 2 / p); }
        let q;
        if (ax === 'y') q = [(s.cx || 0) + s.rx * c, s.y, (s.cz || 0) + s.rz * si];
        else if (ax === 'z') q = [(s.cx || 0) + s.rx * c, (s.cy || 0) + s.ry * si, s.z];
        else q = [s.x, (s.cy || 0) + s.ry * c, (s.cz || 0) + s.rz * si];
        if (o.mod) o.mod(q, s);
        row.push(q);
      }
      rows.push(row);
    }
    const end = (s, dir, d) => (ax === 'y' ? [s.cx || 0, s.y + dir * d, s.cz || 0] : ax === 'z' ? [s.cx || 0, s.cy || 0, s.z + dir * d] : [s.x + dir * d, s.cy || 0, s.cz || 0]);
    const key = ax === 'y' ? 'y' : ax === 'z' ? 'z' : 'x', d0 = Math.sign(st[1][key] - st[0][key]) || 1, n = st.length;
    const pole0 = o.cap0 != null ? end(st[0], -d0, o.cap0) : null, pole1 = o.cap1 != null ? end(st[n - 1], d0, o.cap1) : null;
    if (pole0 && o.mod) o.mod(pole0, st[0]); if (pole1 && o.mod) o.mod(pole1, st[n - 1]);
    const col = o.colFn ? (r, k, q) => o.colFn(q, st[Math.min(r, n - 1)]) : (r) => st[Math.min(r, n - 1)].col;
    this.lattice(rows, { col, pole0, pole1, inward: o.inward, skip: o.skip });
  }
  /** a smooth ellipsoid, rotated by the Euler angles rot = [x, y, z] */
  ell(cx, cy, cz, rx, ry, rz, ws, hs, col, rot = null) {
    const e = rot ? new THREE.Euler(rot[0], rot[1], rot[2]) : null, v = new THREE.Vector3(), rows = [];
    const T = (x, y, z) => { if (!e) return [cx + x, cy + y, cz + z]; v.set(x, y, z).applyEuler(e); return [cx + v.x, cy + v.y, cz + v.z]; };
    for (let i = 1; i < hs; i++) {
      const ph = (i / hs) * PI, s = Math.sin(ph), c = Math.cos(ph), row = [];
      for (let k = 0; k < ws; k++) { const t = (k / ws) * TAU; row.push(T(rx * s * Math.cos(t), ry * c, rz * s * Math.sin(t))); }
      rows.push(row);
    }
    if (!rows.length) return;
    this.lattice(rows, { col, pole0: T(0, ry, 0), pole1: T(0, -ry, 0) });
  }
  /** a thin plate following a surface z = surf(x, y) + dz: corners [[x, y] x4] (bilinear), flat shaded */
  plate(corners, surf, dz, col, nu = 2, nv = 2) {
    let A2 = 0; for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; A2 += p[0] * q[1] - q[0] * p[1]; }
    if (A2 < 0) corners = [corners[1], corners[0], corners[3], corners[2]];          // always facing +z
    const P = (u, v) => {
      const a = corners[0], b = corners[1], c = corners[2], d = corners[3];
      const x = (1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * c[0]);
      const y = (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * c[1]);
      return [x, y, surf(x, y) + dz];
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const p00 = P(i / nu, j / nv), p10 = P((i + 1) / nu, j / nv), p11 = P((i + 1) / nu, (j + 1) / nv), p01 = P(i / nu, (j + 1) / nv);
      // corners go bottom-left, bottom-right, top-right, top-left seen from the front (+z): CCW
      const area = (q, w, e) => (w[0] - q[0]) * (e[1] - q[1]) - (w[1] - q[1]) * (e[0] - q[0]);
      if (Math.abs(area(p00, p10, p11)) > 1e-9) this.tri(p00, p10, p11, col);
      if (Math.abs(area(p00, p11, p01)) > 1e-9) this.tri(p00, p11, p01, col);
    }
  }
}

/* ------------------------------------------------------------ colours and the person spec */
const C = (h) => rgb(h);
const darker = (c, k) => shade(c, k);

/** the torso's shape: [y, rx, rz, cz, p] (spine frame), scaled per person by build (sh shoulders, ch chest, wa waist, hp hips, bu, be) */
const TORSO = [
  [-0.13, 0.092, 0.074, 0.0, 2.0],
  [-0.09, 0.148, 0.097, -0.004, 2.2],
  [-0.02, 0.168, 0.106, -0.008, 2.3],
  [0.06, 0.156, 0.099, -0.002, 2.3],
  [0.16, 0.142, 0.093, 0.006, 2.3],
  [0.26, 0.150, 0.099, 0.011, 2.4],
  [0.35, 0.164, 0.106, 0.014, 2.5],
  [0.42, 0.178, 0.102, 0.008, 2.6],
  [0.465, 0.174, 0.088, -0.005, 2.6],
  [0.51, 0.13, 0.072, -0.010, 2.2],
  [0.545, 0.07, 0.06, -0.010, 2.0],
];
const TORSO_KEYS = { hi: [0, 1, 2, 4, 6, 7, 8, 9, 10], mid: [0, 2, 4, 6, 8, 10], lo: [0, 2, 4, 7, 10] };
function torsoProfile(B) {
  const rows = TORSO.map(([y, rx, rz, cz, p]) => {
    let fx = 1, dz = 0, dcz = 0;
    if (y >= 0.4) fx = B.sh; else if (y >= 0.3) fx = (B.sh + B.ch) / 2; else if (y >= 0.22) fx = B.ch; else if (y >= 0.12) fx = B.wa; else if (y >= 0.03) fx = (B.wa + B.hp) / 2; else fx = B.hp;
    if (y >= 0.28 && y <= 0.38) { dz += B.bu; dcz += B.bu * 0.6; }
    if (y >= 0.08 && y <= 0.2) { dz += B.be; dcz += B.be * 0.7; }
    if (y >= 0.25 && y < 0.3) { dz += B.bu * 0.4; dcz += B.bu * 0.25; }
    return { y, rx: rx * fx, rz: rz * (0.94 + 0.06 * fx) + dz, cz: cz + dcz, p };
  });
  const at = (y) => {
    if (y <= rows[0].y) return { ...rows[0], y };
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1];
      if (y <= b.y) { const t = (y - a.y) / (b.y - a.y); return { y, rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), cz: lerp(a.cz, b.cz, t), p: lerp(a.p, b.p, t) }; }
    }
    return { ...rows[rows.length - 1], y };
  };
  /** the front surface z at (x, y): a superellipse cross-section */
  const front = (x, y) => { const q = at(y), u = clamp(Math.abs(x) / q.rx, 0, 0.999); return q.cz + q.rz * Math.pow(1 - Math.pow(u, q.p), 1 / q.p); };
  const back = (x, y) => { const q = at(y), u = clamp(Math.abs(x) / q.rx, 0, 0.999); return q.cz - q.rz * Math.pow(1 - Math.pow(u, q.p), 1 / q.p); };
  return { rows, at, front, back };
}

/** limb stations from a shape [[y, rx, rz, cx, cz]...] (top to bottom) and clothes: covers = [{ y0 (top), y1 (bottom), col, add }] */
function limbStations(shape, keys, covers, skin, crisp, none = false) {
  const ys = new Set(keys.map((i) => shape[i][0]));
  const yTop = shape[0][0], yBot = shape[shape.length - 1][0];
  const edges = [];
  if (!none) for (const c of covers) for (const e of [c.y0, c.y1]) if (e < yTop - 0.004 && e > yBot + 0.004) edges.push(e);
  const at = (y) => {
    for (let i = 0; i + 1 < shape.length; i++) {
      const a = shape[i], b = shape[i + 1];
      if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0] || 1); return [y, lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3] || 0, b[3] || 0, t), lerp(a[4] || 0, b[4] || 0, t)]; }
    }
    return y > yTop ? shape[0] : shape[shape.length - 1];
  };
  const coverAt = (y) => covers.find((c) => y <= c.y0 + 1e-6 && y >= c.y1 - 1e-6) || null;
  const list = [];
  const push = (y, cov) => { const s = at(y), add = cov ? cov.add || 0 : 0; list.push({ y, rx: s[1] + add, rz: s[2] + add, cx: s[3], cz: s[4], col: cov ? cov.col : skin }); };
  const all = [...ys];
  for (const e of edges) { if (crisp) { all.push(e + 0.0035, e - 0.0035); } else all.push(e); }
  all.sort((a, b) => b - a);
  const out = [];
  for (const y of all) if (!out.length || Math.abs(out[out.length - 1] - y) > 1e-4) out.push(y);
  for (const y of out) {
    let cov = coverAt(y);
    if (crisp) { for (const e of edges) { if (Math.abs(y - (e + 0.0035)) < 1e-5) cov = coverAt(e + 0.006); if (Math.abs(y - (e - 0.0035)) < 1e-5) cov = coverAt(e - 0.006); } }
    push(y, cov);
  }
  return list;
}

/* ------------------------------------------------------------ the head: an egg with a jaw, the face, the hair */
function headShape(B) { const k = B.hs || 1; return { rx: 0.082 * k * (B.hw || 1), ry: 0.116 * k, rz: 0.101 * k, cy: 0.16 * k, chin: 0.022 * k, jaw: B.jaw || 1 }; }
/** a point on the head at (theta around y, 0 = the face; phi from the crown), pushed out by `out` */
function headPt(H, th, ph, out = 0) {
  const s = Math.sin(ph), c = Math.cos(ph), st = Math.sin(th), ct = Math.cos(th);
  const low = sm((ph - 1.5) / (PI - 1.5));
  const rx = H.rx * (1 - 0.2 * low * H.jaw) + out;
  const rz = (ct >= 0 ? H.rz * (1 - 0.1 * low) : H.rz * (1.04 - 0.38 * low)) + out;
  return [rx * s * st, H.cy + (H.ry + out) * c, rz * s * ct + H.chin * low];
}
const headFront = (H, x, y) => {   // the face's z at (x, y): solve phi from y, then theta from x
  const c = clamp((y - H.cy) / H.ry, -0.999, 0.999), ph = Math.acos(c), s = Math.sin(ph), low = sm((ph - 1.5) / (PI - 1.5));
  const rx = H.rx * (1 - 0.2 * low * H.jaw), st = clamp(x / (rx * s || 1e-6), -0.999, 0.999), ct = Math.sqrt(1 - st * st);
  return H.rz * (1 - 0.1 * low) * s * ct + H.chin * low;
};

function buildHead(g, eyesG, spec, det) {
  const S = SEG[det], H = headShape(spec.build), skin = C(spec.skin), hair = C(spec.hair || '#1d1714');
  const rows = [];
  for (let i = 1; i < S.headP; i++) { const ph = (i / S.headP) * PI, row = []; for (let k = 0; k < S.headT; k++) row.push(headPt(H, (k / S.headT) * TAU, ph)); rows.push(row); }
  g.lattice(rows, { col: skin, pole0: headPt(H, 0, 0), pole1: headPt(H, 0, PI) });
  // the neck: from inside the shoulders up into the head
  const nr = 0.053 * (spec.build.nk || 1);
  g.tube([{ y: -0.07, rx: nr * 1.05, rz: nr, cz: -0.012, col: skin }, { y: 0.02, rx: nr, rz: nr * 0.95, cz: -0.012, col: skin }, { y: 0.1, rx: nr * 0.95, rz: nr * 0.9, cz: -0.004, col: skin }].filter((q, i) => det === 'hi' || i !== 1), S.neck);
  // ears
  const earY = H.cy - 0.006, earX = H.rx + 0.002, earCol = darker(skin, 0.9);
  if (det === 'hi') for (const s of [-1, 1]) g.ell(s * earX, earY, -0.012, 0.011, 0.028, 0.018, 5, 4, earCol, [0, s * 0.35, s * 0.08]);
  else if (det === 'mid') for (const s of [-1, 1]) g.ell(s * earX, earY, -0.012, 0.011, 0.026, 0.016, 4, 2, earCol, [0, s * 0.35, 0]);
  if (det !== 'lo') buildFace(g, eyesG, H, spec, det, skin, hair);
  buildHair(g, H, spec, det, skin, hair);
  if (spec.look && spec.look.headband) { const hb = C(spec.look.headband); hairRing(g, H, 0.98, 1.16, 0.012, hb, S.headT); }
  return H;
}

/** the face: subtle and human. Eyes are small (a warm off-white with a dark iris and a lash line), brows, a nose and soft lips. */
function buildFace(g, eyesG, H, spec, det, skin, hair) {
  const eyeY = H.cy + 0.004, eyeX = 0.031 * (H.rx / 0.082), lip = mixc(skin, C('#6e3b33'), 0.38), browC = mixc(hair, skin, 0.25), iris = C(spec.iris || '#2a1a12');
  const zf = (x, y) => headFront(H, x, y);
  if (det === 'hi') {
    const E = eyesG;                                      // a separate mesh, origin at the eyes' height (so it can blink)
    for (const s of [-1, 1]) {
      const x = s * eyeX, z = zf(x, eyeY) - 0.0035;
      E.ell(x, 0, z, 0.0118, 0.0064, 0.006, 6, 4, C('#d9d0c5'), [0, s * 0.32, 0]);
      E.ell(x - s * 0.0008, -0.0004, z + 0.0046, 0.0059, 0.0059, 0.0024, 6, 3, iris, [0, s * 0.32, 0]);
      E.ell(x, 0.0056, z + 0.001, 0.0128, 0.0019, 0.0057, 5, 3, darker(hair, 0.8), [0, s * 0.32, -s * 0.06]);   // the upper lid and lashes
      // the brow above, slightly arched
      g.ell(x + s * 0.002, eyeY + 0.0215, zf(x, eyeY + 0.021) + 0.0012, 0.0165, 0.0032, 0.0045, 4, 3, browC, [0, s * 0.3, -s * 0.1]);
    }
    const ny = H.cy - 0.024, nz = zf(0, ny);
    g.ell(0, ny, nz - 0.0005, 0.0118, 0.018, 0.0088, 6, 4, darker(skin, 0.97), [-0.3, 0, 0]);                 // the nose
    g.ell(0, ny - 0.015, zf(0, ny - 0.015) + 0.0035, 0.0128, 0.0052, 0.0068, 5, 3, darker(skin, 0.93));      // its tip and nostrils
    const my = H.cy - 0.058, mz = zf(0, my);
    g.ell(0, my, mz - 0.0015, 0.0185, 0.0052, 0.0072, 6, 3, lip);                                          // the lips
    g.ell(0, my - 0.0005, mz + 0.0046, 0.0165, 0.0011, 0.0026, 4, 3, darker(lip, 0.6));                     // the mouth line
  } else {
    // mid: tiny flat features, still readable at the reading-room distance
    for (const s of [-1, 1]) {
      const x = s * eyeX;
      g.plate([[x - 0.011, eyeY - 0.004], [x + 0.011, eyeY - 0.004], [x + 0.011, eyeY + 0.004], [x - 0.011, eyeY + 0.004]], zf, 0.0012, C('#d9d0c4'), 1, 1);
      g.plate([[x - 0.0045, eyeY - 0.004], [x + 0.0045, eyeY - 0.004], [x + 0.0045, eyeY + 0.004], [x - 0.0045, eyeY + 0.004]], zf, 0.0022, iris, 1, 1);
      g.plate([[x - 0.013, eyeY + 0.017], [x + 0.013, eyeY + 0.017], [x + 0.012, eyeY + 0.022], [x - 0.012, eyeY + 0.022]], zf, 0.0018, browC, 1, 1);
    }
    const ny = H.cy - 0.028;
    g.ell(0, ny, zf(0, ny) + 0.004, 0.011, 0.02, 0.012, 4, 2, darker(skin, 0.95), [-0.3, 0, 0]);
    const my = H.cy - 0.058;
    g.plate([[-0.015, my - 0.003], [0.015, my - 0.003], [0.014, my + 0.002], [-0.014, my + 0.002]], zf, 0.0015, lip, 1, 1);
  }
}

/** hair as a shell over the head: per column a hairline (front, side, back) and a thickness; styles change both (and add pieces) */
const HAIR = {
  short: { f: 0.72, s: 1.55, b: 2.05, top: 0.03, side: 0.012, quiff: 0.01 },
  buzz: { f: 0.66, s: 1.42, b: 2.0, top: 0.006, side: 0.004 },
  curly: { f: 0.58, s: 1.55, b: 2.1, top: 0.042, side: 0.032, bump: 0.011 },
  wavy: { f: 0.55, s: 2.05, b: 2.3, top: 0.02, side: 0.016, wave: 0.006, part: 0.35 },
  bun: { f: 0.6, s: 1.5, b: 1.98, top: 0.01, side: 0.008, bun: true },
  long: { f: 0.55, s: 1.85, b: 1.95, top: 0.018, side: 0.014, drop: true, part: -0.3 },
  cap: { f: 0.62, s: 1.45, b: 2.05, top: 0.012, side: 0.008, cap: true },
  beanie: { f: 0.62, s: 1.45, b: 2.02, top: 0.01, side: 0.008, beanie: true },
};
export const HAIR_STYLES = Object.keys(HAIR);
function hairRing(g, H, ph0, ph1, out, col, seg) {
  const rows = [];
  for (const [ph, o] of [[ph0, out * 0.6], [ph0 + 0.02, out], [ph1 - 0.02, out], [ph1, out * 0.6]]) { const row = []; for (let k = 0; k < seg; k++) row.push(headPt(H, (k / seg) * TAU, ph, o)); rows.push(row); }
  g.lattice(rows, { col });
}
function buildHair(g, H, spec, det, skin, hairCol) {
  const st = HAIR[spec.hairStyle] || HAIR.short, S = SEG[det], nT = S.headT, nU = S.hairU + (st.drop ? 2 : 0);
  const seed = (spec.seed || 1) * 7.13;
  const noise = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233 + seed) * 43758.5453; return v - Math.floor(v); };
  const lineAt = (th) => {
    const ct = Math.cos(th + (st.part || 0) * 0.15), wf = Math.pow(Math.max(0, ct), 1.3), wb = Math.max(0, -ct);
    return st.s + (st.f - st.s) * wf + (st.b - st.s) * wb;
  };
  const thick = (th, ph, v) => {
    let t = lerp(st.top, st.side, sm(ph / 1.4));
    if (st.bump && det !== 'lo') t += st.bump * (noise(Math.round(th * 10), Math.round(ph * 10)) - 0.3);
    if (st.wave && det !== 'lo') t += st.wave * Math.sin(th * 7 + ph * 4);
    if (st.quiff) t += st.quiff * Math.max(0, Math.cos(th)) * (1 - sm(ph / 0.9));
    return t * (1 - 0.75 * sm((v - 0.8) / 0.2)) + 0.0015;
  };
  const rows = [], dropFrom = st.drop ? 0.62 : 1;
  for (let u = 1; u <= nU; u++) {
    const v = u / nU, row = [];
    for (let k = 0; k < nT; k++) {
      const th = (k / nT) * TAU, end = lineAt(th);
      const front = Math.max(0, Math.cos(th)) > 0.62;
      if (!st.drop || front || v <= dropFrom) {
        const ph = (st.drop && !front ? Math.min(v / dropFrom, 1) : v) * end;
        row.push(headPt(H, th, ph, thick(th, ph, st.drop && !front ? 0.5 : v)));
      } else {
        // long hair below the head: falls straight down from the side/back of the head, flaring a little
        const ph = end, p = headPt(H, th, ph, thick(th, ph, 0.5)), w = (v - dropFrom) / (1 - dropFrom);
        const fall = (0.26 + 0.06 * Math.max(0, -Math.cos(th))) * w, flare = 1 + 0.12 * w;
        row.push([p[0] * flare, p[1] - fall, p[2] * flare - 0.01 * w]);
      }
    }
    rows.push(row);
  }
  const hairC = (r, k, p) => { void p; return st.wave || st.bump ? shade(hairCol, 0.92 + 0.16 * noise(k, r)) : hairCol; };
  g.lattice(rows, { col: hairC, pole0: headPt(H, 0, 0, st.top + 0.0015) });
  if (st.drop) {   // the inside of the fall, so it is never see-through from the front
    const inner = rows.map((row) => row.map((p) => [p[0] * 0.94, p[1], p[2] * 0.94 - 0.004]));
    const first = Math.max(0, Math.round(dropFrom * nU) - 1);
    g.lattice(inner.slice(first), { col: shade(hairCol, 0.7), inward: true });
  }
  if (st.bun) g.ell(0, H.cy + H.ry * 0.62, -H.rz * 0.92, 0.04, 0.036, 0.038, det === 'hi' ? 8 : 5, det === 'hi' ? 6 : 4, hairCol);
  if (st.cap || st.beanie) {
    const hat = C(spec.hat || (st.cap ? '#2f4d6e' : '#7a3b2e'));
    const end = st.cap ? 1.22 : 1.32, rows2 = [], nU2 = det === 'hi' ? 4 : det === 'mid' ? 3 : 2;
    for (let u = 1; u <= nU2; u++) { const ph = (u / nU2) * end, row = []; for (let k = 0; k < nT; k++) { const th = (k / nT) * TAU, f = Math.max(0, Math.cos(th)); row.push(headPt(H, th, ph * (1 - 0.1 * f), (st.cap ? 0.024 : 0.034) + (st.beanie && u === nU2 ? 0.01 : 0))); } rows2.push(row); }
    g.lattice(rows2, { col: (r) => (st.beanie && r === rows2.length - 1 ? shade(hat, 0.82) : hat), pole0: headPt(H, 0, 0, st.cap ? 0.026 : 0.038) });
    if (st.cap) { const by = H.cy + H.ry * Math.cos(1.08), bz = headFront(H, 0, by); g.ell(0, by - 0.004, bz + 0.045, 0.072, 0.0075, 0.058, det === 'hi' ? 8 : 5, 3, shade(hat, 0.9), [0.14, 0, 0]); }
  }
}

/* ------------------------------------------------------------ the body */
const ARM_UP = [[0.04, 0.026, 0.026], [0.025, 0.043, 0.044], [-0.01, 0.049, 0.049], [-0.08, 0.046, 0.047, 0, 0.004], [-0.16, 0.043, 0.045, 0, 0.004], [-0.24, 0.04, 0.04], [-0.29, 0.038, 0.037], [-0.315, 0.033, 0.032]];
const ARM_UP_K = { hi: [0, 1, 2, 4, 5, 6, 7], mid: [0, 3, 7], lo: [1, 7] };
const ARM_LO = [[0.035, 0.03, 0.03], [0.015, 0.04, 0.038], [-0.03, 0.042, 0.039, 0, 0.003], [-0.09, 0.038, 0.034, 0, 0.002], [-0.15, 0.032, 0.028], [-0.21, 0.027, 0.023], [-0.25, 0.025, 0.021], [-0.262, 0.02, 0.016]];
const ARM_LO_K = { hi: [1, 2, 3, 4, 6, 7], mid: [1, 4, 7], lo: [1, 7] };
const THIGH_S = [[0.075, 0.06, 0.065], [0.05, 0.085, 0.09], [-0.03, 0.091, 0.095, 0, 0.004], [-0.13, 0.084, 0.087, 0, 0.006], [-0.25, 0.073, 0.076, 0, 0.004], [-0.36, 0.063, 0.065], [-0.44, 0.057, 0.06], [-0.48, 0.056, 0.058]];
const THIGH_K = { hi: [1, 2, 3, 5, 6, 7], mid: [1, 4, 7], lo: [1, 7] };
const SHIN_S = [[0.03, 0.046, 0.048], [0.01, 0.05, 0.052], [-0.07, 0.053, 0.06, 0, -0.01], [-0.15, 0.048, 0.053, 0, -0.008], [-0.25, 0.039, 0.041], [-0.33, 0.032, 0.033], [-0.39, 0.03, 0.031], [-0.41, 0.028, 0.03]];
const SHIN_K = { hi: [1, 2, 4, 5, 6, 7], mid: [1, 4, 7], lo: [1, 7] };

function garment(L) {
  const top = C(L.top), bot = C(L.bottom);
  const coat = L.coat ? C(L.coat) : null;
  return {
    top, bot, coat, arm: C(L.arm || L.coat || L.top), sleeve: L.sleeve || 'long', shoes: C(L.shoes || '#2a2724'),
    shirt: L.shirt ? C(L.shirt) : null, tie: L.tie ? C(L.tie) : null, trim: L.trim ? C(L.trim) : null, zip: L.zip ? C(L.zip) : null,
    scarf: L.scarf ? C(L.scarf) : null, socks: L.socks ? C(L.socks) : null, boots: L.boots ? C(L.boots) : null,
    hood: !!L.hood, pocket: !!L.pocket, lapel: !!L.lapel, open: !!(L.open || (L.shirt && !L.coat)), collar: !!L.collar, buttons: L.buttons || 0,
    shorts: !!L.shorts, longShorts: !!L.longShorts, skirt: !!L.skirt, tucked: !!(L.tucked || L.tie), shoe: L.shoe || (L.boots ? 'boot' : 'sneaker'),
    jacket: L.jacket ? C(L.jacket) : null, kind: L.kind || '',
  };
}

function buildTorso(g, G, B, det, skin) {
  const S = SEG[det], prof = torsoProfile(B), crisp = det === 'hi';
  const outer = G.coat || G.jacket || G.top;
  const hemY = G.coat ? -0.15 : G.tucked ? 0.03 : -0.02;
  // colour by height: trousers below the hem, the top (or coat/jacket) above, a belt when tucked, a rib at the neck
  const bands = [];
  if (!G.coat) bands.push([hemY, G.bot]);
  if (G.tucked && !G.coat) bands.push([0.045, darker(C('#2b2420'), 1)]);
  bands.push([0.52, G.open || G.coat || G.lapel ? outer : darker(outer, 0.84)]);
  bands.push([9, skin]);
  const colAt = (y) => {
    if (!G.coat && y < hemY) return G.bot;
    if (G.tucked && !G.coat && y < 0.045 && y >= hemY) return C('#2b2420');
    if (G.trim && G.kind === 'varsity' && y < hemY + 0.05) return (Math.floor((y - hemY) / 0.016) % 2) ? G.trim : outer;
    if (y > 0.512 && !(G.open || G.coat || G.lapel)) return darker(outer, 0.84);
    return outer;
  };
  const ys = new Set(TORSO_KEYS[det].map((i) => TORSO[i][0]));
  if (crisp) {
    const edges = [hemY, 0.512]; if (G.tucked && !G.coat) edges.push(0.045);
    if (G.kind === 'varsity' && G.trim) for (let k = 1; k < 3; k++) edges.push(hemY + k * 0.016);
    for (const e of edges) if (e > -0.12 && e < 0.535) { ys.add(e - 0.003); ys.add(e + 0.003); }
  } else if (det === 'mid') { ys.add(hemY + 0.004); ys.add(0.515); }
  void bands;
  const list = [...ys].sort((a, b) => a - b).map((y) => { const q = prof.at(y), add = !G.coat && y >= hemY && y < hemY + 0.03 && !G.tucked ? 0.005 : 0; return { y, rx: q.rx + add, rz: q.rz + add, cz: q.cz, p: q.p, col: colAt(y) }; });
  g.tube(list, S.torso, { cap0: 0.03, cap1: 0.012, rot: PI / 2 });
  const F = (x, y) => prof.front(x, y), nu = det === 'hi' ? 3 : 1;
  if (det === 'lo') return prof;
  const sh = B.sh;
  // open fronts: the shirt in a V, lapels, a tie, a collar
  if (G.open || G.lapel) {
    const inner = G.shirt || (G.coat ? darker(G.top, 0.9) : G.top), vb = G.tie ? 0.28 : G.coat ? 0.36 : 0.22;
    if (G.open && !G.coat) g.plate([[0, vb], [0.0001, vb], [0.058 * sh, 0.522], [-0.058 * sh, 0.522]], F, 0.0025, inner, 1, nu + 1);
    if (G.coat && G.lapel) g.plate([[0, 0.32], [0.0001, 0.32], [0.05, 0.522], [-0.05, 0.522]], F, 0.0025, G.scarf ? G.scarf : inner, 1, nu + 1);
    if (G.tie) { g.plate([[-0.016, 0.3], [0.016, 0.3], [0.011, 0.505], [-0.011, 0.505]], F, 0.006, G.tie, 1, nu + 1); g.plate([[0, 0.268], [0.0001, 0.268], [0.016, 0.3], [-0.016, 0.3]], F, 0.006, G.tie, 1, 1); g.plate([[-0.013, 0.497], [0.013, 0.497], [0.012, 0.52], [-0.012, 0.52]], F, 0.009, darker(G.tie, 0.85), 1, 1); }
    if (G.collar || G.tie) for (const s of [-1, 1]) g.plate([[s * 0.012, 0.5], [s * 0.046, 0.505], [s * 0.052, 0.532], [s * 0.016, 0.53]].map((p) => (s < 0 ? p : p)), F, 0.008, G.shirt || C('#f4f4f0'), 1, 1);
    if (G.lapel) {
      const lap = darker(outer, 0.86);
      for (const s of [-1, 1]) {
        const c = s < 0 ? [[-0.004, vb + 0.01], [-0.03, vb + 0.02], [-0.098 * sh, 0.468], [-0.06 * sh, 0.522]] : [[0.03, vb + 0.02], [0.004, vb + 0.01], [0.06 * sh, 0.522], [0.098 * sh, 0.468]];
        g.plate(c, F, 0.0075, lap, 1, nu + 1);
      }
    }
    if (G.buttons) for (let i = 0; i < G.buttons; i++) { const y = vb - 0.02 - i * 0.07, x = G.coat ? 0.045 : 0.012; for (const s of G.coat ? [-1, 1] : [1]) { if (det === 'hi') g.ell(s * x, y, F(s * x, y) + 0.004, 0.0075, 0.0075, 0.004, 4, 3, darker(outer, 0.55)); else g.plate([[s * x - 0.006, y - 0.006], [s * x + 0.006, y - 0.006], [s * x + 0.006, y + 0.006], [s * x - 0.006, y + 0.006]], F, 0.009, darker(outer, 0.55), 1, 1); } }
  } else if (G.kind !== 'tank') {
    // a crew neck rib, slightly darker
  }
  if (G.kind === 'tank' && G.trim) {
    g.plate([[0, 0.43], [0.0001, 0.43], [0.06, 0.53], [-0.06, 0.53]], F, 0.002, G.trim, 1, nu);
    g.plate([[0, 0.448], [0.0001, 0.448], [0.046, 0.53], [-0.046, 0.53]], F, 0.0035, skin, 1, nu);
  }
  if (G.zip) g.plate([[-0.006, G.coat ? -0.14 : -0.01], [0.006, G.coat ? -0.14 : -0.01], [0.006, 0.5], [-0.006, 0.5]], F, 0.003, G.zip, 1, det === 'hi' ? 6 : 3);
  if (G.kind === 'varsity' && !G.zip) for (let i = 0; i < 4; i++) { const y = 0.06 + i * 0.1; g.ell(0.01, y, F(0.01, y) + 0.003, 0.006, 0.006, 0.003, 4, 3, G.trim || C('#efe8d6')); }
  if (G.pocket) g.plate([[-0.115, 0.04], [0.115, 0.04], [0.085, 0.2], [-0.085, 0.2]], F, 0.006, darker(outer, 0.86), nu, 1);
  if (G.hood) {
    // the hood, down: a soft roll around the back of the neck and over the shoulders
    const hc = darker(outer, 0.92);
    const hr = [{ y: 0.47, rx: 0.12, rz: 0.088, cz: -0.024, col: hc }, { y: 0.515, rx: 0.098, rz: 0.083, cz: -0.03, col: hc }, { y: 0.55, rx: 0.08, rz: 0.074, cz: -0.032, col: darker(hc, 0.9) }, { y: 0.565, rx: 0.07, rz: 0.066, cz: -0.032, col: darker(hc, 0.75) }];
    g.tube(det === 'hi' ? hr : [hr[0], hr[3]], det === 'hi' ? 10 : 6);
    g.ell(0, 0.5, prof.back(0, 0.5) - 0.03, 0.1, 0.06, 0.05, det === 'hi' ? 8 : 5, det === 'hi' ? 5 : 3, hc, [0.35, 0, 0]);
    if (G.kind !== 'raincoat' && !G.zip && det === 'hi') for (const s of [-1, 1]) g.bar([s * 0.028, 0.51, F(s * 0.028, 0.51) + 0.01], [s * 0.034, 0.37, F(s * 0.034, 0.37) + 0.006], 0.0055, C('#f0ece4'));
  }
  if (G.scarf) {
    g.tube([{ y: 0.475, rx: 0.098, rz: 0.084, cz: -0.006, col: G.scarf }, { y: 0.52, rx: 0.092, rz: 0.08, cz: -0.006, col: G.scarf }, { y: 0.565, rx: 0.074, rz: 0.068, cz: -0.006, col: darker(G.scarf, 0.85) }], det === 'hi' ? 10 : 6, { cap0: 0.004 });
    g.plate([[0.012, 0.26], [0.072, 0.27], [0.07, 0.48], [0.018, 0.48]], F, 0.012, darker(G.scarf, 0.92), 1, nu + 1);
  }
  return prof;
}

function buildArm(up, lo, hand, G, s, det, skin) {
  const S = SEG[det], sl = G.sleeve, crisp = det === 'hi';
  const cloth = G.arm, cuff = G.kind === 'varsity' && G.trim ? G.trim : G.hood || G.kind === 'sweater' ? darker(cloth, 0.86) : cloth;
  const upCov = sl === 'long' ? [{ y0: 1, y1: -1, col: cloth, add: 0.007 }] : sl === 'short' ? [{ y0: 1, y1: -0.13, col: cloth, add: 0.008 }] : [];
  const loCov = sl === 'long' ? (det === 'hi' ? [{ y0: 1, y1: -0.215, col: cloth, add: 0.009 }, { y0: -0.215, y1: -0.24, col: cuff, add: 0.006 }] : [{ y0: 1, y1: -0.235, col: cloth, add: 0.008 }]) : [];
  const flip = (st) => st.map((q) => ({ ...q, cx: (q.cx || 0) * -s }));
  up.tube(flip(limbStations(ARM_UP, ARM_UP_K[det], upCov, skin, crisp, det === 'lo')), S.limb, { cap0: 0.014, cap1: 0.006 });
  lo.tube(flip(limbStations(ARM_LO, ARM_LO_K[det], loCov, skin, crisp, det === 'lo')), S.limb, { cap0: 0.01, cap1: 0.006 });
  // the hand, in the wrist frame: palm faces the body (-s x), thumb forward, fingers curled a little toward the palm
  const pal = -s, hs = S.hand;
  if (det === 'lo') { hand.tube([{ y: 0.0, rx: 0.014, rz: 0.028, col: skin }, { y: -0.1, rx: 0.013, rz: 0.036, cx: pal * 0.01, col: skin }], hs, { cap0: 0.005, cap1: 0.04 }); return; }
  if (det === 'mid') {
    hand.tube([{ y: 0.004, rx: 0.015, rz: 0.03, col: skin }, { y: -0.06, rx: 0.016, rz: 0.043, cz: 0.004, col: skin }, { y: -0.14, rx: 0.009, rz: 0.03, cx: pal * 0.016, col: skin }], hs, { cap0: 0.005, cap1: 0.01 });
    return;
  }
  hand.tube([{ y: 0.004, rx: 0.018, rz: 0.027, col: skin }, { y: -0.045, rx: 0.019, rz: 0.042, col: skin }, { y: -0.088, rx: 0.016, rz: 0.04, cx: pal * 0.003, col: skin }], hs, { cap0: 0.006, cap1: 0.004 });
  hand.tube([{ y: -0.08, rx: 0.0145, rz: 0.039, cx: pal * 0.003 }, { y: -0.125, rx: 0.0125, rz: 0.036, cx: pal * 0.01 }, { y: -0.155, rx: 0.0095, rz: 0.027, cx: pal * 0.022 }].map((q) => ({ ...q, col: skin })), hs, { cap1: 0.008 });
  // the thumb: from the heel of the palm, forward and down
  hand.tube([{ y: -0.012, rx: 0.011, rz: 0.012, cx: pal * 0.006, cz: 0.026, col: skin }, { y: -0.045, rx: 0.0105, rz: 0.011, cx: pal * 0.01, cz: 0.046, col: skin }, { y: -0.075, rx: 0.0085, rz: 0.009, cx: pal * 0.016, cz: 0.054, col: skin }], 4, { cap0: 0.004, cap1: 0.007 });
}

function buildLeg(th, sh, G, s, det, skin) {
  const S = SEG[det], crisp = det === 'hi';
  const pants = G.skirt ? [] : G.shorts ? [{ y0: 1, y1: G.longShorts ? -0.36 : -0.24, col: G.bot, add: G.longShorts ? 0.018 : 0.014 }] : [{ y0: 1, y1: -1, col: G.bot, add: 0.01 }];
  const shinCov = [];
  if (G.boots) shinCov.push({ y0: -0.2, y1: -1, col: G.boots, add: 0.014 });
  if (!G.shorts && !G.skirt) shinCov.push({ y0: 1, y1: -0.385, col: G.bot, add: 0.01 });
  if (G.socks) shinCov.push({ y0: G.longShorts ? -0.2 : -0.31, y1: -1, col: G.socks, add: 0.003 });
  if (G.longShorts && G.trim) pants.unshift({ y0: -0.335, y1: -0.36, col: G.trim, add: 0.019 });
  const flip = (st) => st.map((q) => ({ ...q, cx: (q.cx || 0) * -s }));
  th.tube(flip(limbStations(THIGH_S, THIGH_K[det], pants, skin, crisp, det === 'lo')), S.limb, { cap0: 0.012, cap1: 0.022 });
  // a long coat (or a skirt) falls over the thigh: a wider open sleeve, reaching across the middle so the two meet
  const panel = G.coat || (G.skirt ? G.bot : null);
  if (panel) {
    const yb = G.coat ? -0.44 : -0.34, mid = -s * 0.026;
    const st = [{ y: 0.07, rx: 0.098, rz: 0.1, cx: mid, col: panel }, { y: -0.1, rx: 0.104, rz: 0.104, cx: mid * 1.1, col: panel }, { y: yb, rx: 0.118, rz: 0.112, cx: mid * 1.2, col: darker(panel, 0.94) }, { y: yb - 0.004, rx: 0.1, rz: 0.096, cx: mid * 1.2, col: darker(panel, 0.6) }];
    th.tube(det === 'hi' ? st : [st[0], st[2], st[3]], S.limb);
  }
  sh.tube(flip(limbStations(SHIN_S, SHIN_K[det], shinCov, skin, crisp, det === 'lo')), S.limb, { cap0: 0.01, cap1: 0.004 });
  buildShoe(sh, G, det);
}

/** a shoe in the knee frame (sole at -SHIN): a loft from heel to toe with a flat sole; sneakers get a pale sole line */
function buildShoe(g, G, det) {
  const sole = -DIM.SHIN, kind = G.shoe, up = G.boots || G.shoes;
  const dress = kind === 'dress', boot = kind === 'boot';
  const Z = [[-0.062, 0.032, -0.4], [-0.047, 0.042, -0.385], [-0.005, 0.045, -0.39], [0.045, 0.049, -0.41], [0.095, 0.048, -0.426], [0.14, 0.04, -0.437], [0.172, 0.027, -0.445]];
  const keys = det === 'hi' ? [0, 1, 2, 3, 5, 6] : det === 'mid' ? [0, 3, 5, 6] : [0, 6];
  const st = keys.map((i) => { const [z, w, top] = Z[i], t = boot && z < 0.05 ? Math.max(top, -0.33) : top, h = t - sole; return { z, rx: w * (dress ? 0.93 : 1), ry: h * 0.7, cy: sole + h * 0.3, cx: 0, col: up }; });
  const soleCol = dress ? darker(C('#2a2420'), 1) : boot ? darker(up, 0.6) : mixc(C('#f2f0ea'), up, 0.15);
  const soleH = dress ? 0.008 : 0.016;
  g.tube(st, SEG[det].shoe, { axis: 'z', cap0: 0.008, cap1: 0.012, mod: (q) => { if (q[1] < sole) q[1] = sole; }, colFn: (q, s) => (q[1] < sole + soleH ? soleCol : s.col) });
}

/** glasses (thin dark rims), headphones (a band and two cups), a backpack (straps over the shoulders) */
function buildGlasses(g, H, col, n = 6) {
  const y = H.cy + 0.004, c = C(col || '#24201d'), ex = 0.031 * (H.rx / 0.082), flat = n < 6;
  // a rim edge: a bar close up, a thin front-facing strip further away (2 triangles)
  const edge = (a, b) => { if (!flat) { g.bar(a, b, 0.003, c); return; } const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * 0.0018, ny = dx / l * 0.0018; g.quad([a[0] - nx, a[1] - ny, a[2]], [b[0] - nx, b[1] - ny, b[2]], [b[0] + nx, b[1] + ny, b[2]], [a[0] + nx, a[1] + ny, a[2]], c); };
  for (const s of [-1, 1]) {
    const cx = s * ex, z = headFront(H, cx, y) + 0.011, pts = [];
    for (let k = 0; k <= n; k++) { const a = (k / n) * TAU + (flat ? PI / 4 : 0); pts.push([cx + Math.cos(a) * 0.019, y + Math.sin(a) * 0.0135, z - 0.004 * Math.max(0, s * Math.cos(a))]); }
    for (let k = 0; k < n; k++) edge(pts[k], pts[k + 1]);
    if (!flat) g.bar([cx + s * 0.019, y + 0.004, z - 0.002], [s * (H.rx + 0.004), y + 0.006, -0.012], 0.003, c);
    else g.quad([s * (H.rx + 0.003), y + 0.002, -0.012], [cx + s * 0.019, y + 0.002, z - 0.003], [cx + s * 0.019, y + 0.006, z - 0.003], [s * (H.rx + 0.003), y + 0.006, -0.012].map((v, i) => v), c);
  }
  const bz = headFront(H, 0, y) + 0.012;
  if (!flat) g.bar([-ex + 0.019, y + 0.003, bz], [ex - 0.019, y + 0.003, bz], 0.003, c); else edge([-ex + 0.019, y + 0.003, bz], [ex - 0.019, y + 0.003, bz]);
}
function buildHeadphones(g, H, col) {
  const c = C(col || '#2b2f38'), pad = C('#3a3f48'), n = 7, pts = [];
  for (let k = 0; k <= n; k++) { const a = -PI / 2 + (k / n) * PI; pts.push([Math.sin(a) * (H.rx + 0.022), H.cy + Math.cos(a) * (H.ry + 0.02) - 0.004, -0.008]); }
  for (let k = 0; k < n; k++) g.bar(pts[k], pts[k + 1], 0.014, c);
  for (const s of [-1, 1]) g.tube([{ x: s * (H.rx - 0.004), ry: 0.032, rz: 0.028, cy: H.cy - 0.008, cz: -0.012, col: pad }, { x: s * (H.rx + 0.012), ry: 0.035, rz: 0.03, cy: H.cy - 0.008, cz: -0.012, col: c }, { x: s * (H.rx + 0.026), ry: 0.03, rz: 0.026, cy: H.cy - 0.008, cz: -0.012, col: c }], 8, { axis: 'x', cap0: 0.002, cap1: 0.003 });
}
function buildBackpack(g, prof, col) {
  const c = C(col || '#3d4a5e'), z0 = prof.back(0, 0.3) - 0.055;
  g.tube([{ y: 0.1, rx: 0.12, rz: 0.05, cz: z0, p: 4, col: darker(c, 0.85) }, { y: 0.12, rx: 0.13, rz: 0.06, cz: z0, p: 4, col: c }, { y: 0.4, rx: 0.13, rz: 0.06, cz: z0 + 0.004, p: 4, col: c }, { y: 0.44, rx: 0.11, rz: 0.05, cz: z0 + 0.01, p: 4, col: c }], 8, { cap0: 0.006, cap1: 0.02 });
  g.tube([{ y: 0.14, rx: 0.1, rz: 0.03, cz: z0 - 0.06, p: 4, col: darker(c, 0.9) }, { y: 0.28, rx: 0.1, rz: 0.03, cz: z0 - 0.06, p: 4, col: darker(c, 0.9) }], 6, { cap0: 0.005, cap1: 0.005 });
  const st = darker(c, 0.7);
  for (const s of [-1, 1]) {
    const x = s * 0.085;
    g.bar([x, 0.42, z0 + 0.03], [x * 1.05, 0.49, prof.back(x, 0.49) + 0.01], 0.012, st);
    g.bar([x * 1.05, 0.49, prof.back(x, 0.49) + 0.01], [x * 1.1, 0.49, prof.front(x, 0.49) + 0.004], 0.012, st);
    g.bar([x * 1.1, 0.49, prof.front(x, 0.49) + 0.004], [x * 1.25, 0.3, prof.front(x * 1.25, 0.3) + 0.006], 0.012, st);
    g.bar([x * 1.25, 0.3, prof.front(x * 1.25, 0.3) + 0.006], [x * 1.45, 0.14, prof.back(x * 1.45, 0.14) + 0.03], 0.012, st);
  }
}

/** build every part of one person at one detail level */
export function buildPerson(spec, det = 'hi') {
  const B = { sh: 1, ch: 1, wa: 1, hp: 1, bu: 0, be: 0, hs: 1, ...(spec.build || {}) };
  const sp = { ...spec, build: B };
  const skin = C(spec.skin || '#8d5a3b'), G = garment(spec.look || {});
  const torso = new SoftGeo(), head = new SoftGeo(), eyes = det === 'hi' ? new SoftGeo() : null;
  const prof = buildTorso(torso, G, B, det, skin);
  const H = buildHead(head, eyes, sp, det);
  const upper = [new SoftGeo(), new SoftGeo()], fore = [new SoftGeo(), new SoftGeo()], hand = [new SoftGeo(), new SoftGeo()], thigh = [new SoftGeo(), new SoftGeo()], shin = [new SoftGeo(), new SoftGeo()];
  [-1, 1].forEach((s, i) => { buildArm(upper[i], fore[i], hand[i], G, s, det, skin); buildLeg(thigh[i], shin[i], G, s, det, skin); });
  let glasses = null, headphones = null, backpack = null;
  if (spec.glasses && det !== 'lo') { glasses = new SoftGeo(); buildGlasses(glasses, H, typeof spec.glasses === 'string' ? spec.glasses : null, det === 'hi' ? 6 : 4); }
  const acc = spec.acc || {};
  if (acc.headphones) { headphones = new SoftGeo(); buildHeadphones(headphones, H, acc.headphones === true ? null : acc.headphones); }
  if (acc.backpack) { backpack = new SoftGeo(); buildBackpack(backpack, prof, acc.backpack === true ? null : acc.backpack); }
  return { parts: { torso, head, eyes, upper, fore, hand, thigh, shin, glasses, headphones, backpack }, head: H, prof, eyeY: H.cy + 0.004 };
}

/* ------------------------------------------------------------ seeded people for the crowd (varied, muted, no logos) */
const SKINS = ['#8d5a3b', '#c58c64', '#e0b293', '#6b4129', '#a8714d', '#f0c9a8', '#7a4a2e', '#d8a37c', '#5a3622', '#b98262'];
const HAIRS = ['#1d1714', '#3b2a20', '#5a3a22', '#2a1f1a', '#7a5a3a', '#14110f', '#8a6a4a', '#b08a5a', '#1a1412', '#6b6560'];
const TOPS = ['#3d4a5e', '#6b5b4a', '#7a8794', '#4f5d4a', '#8a6f5a', '#5a3f45', '#c9bba3', '#2f3a4a', '#7d6e8a', '#a39880', '#8c3f3a', '#e4ddd0', '#4a6a7a', '#9a7a52'];
const BOTS = ['#2b2f38', '#3d4554', '#4a3f35', '#23262d', '#5a5248', '#33415c', '#6b6458'];
const SHOES = ['#2a2724', '#e8e6e0', '#5a4636', '#1d1f24', '#c8c2b8'];
const STYLES = ['short', 'short', 'buzz', 'curly', 'wavy', 'bun', 'long', 'long', 'cap', 'beanie', 'curly', 'wavy'];
const KINDS = ['tee', 'sweater', 'sweater', 'hoodie', 'shirt', 'jacket', 'cardigan', 'tee'];
/** a seeded person: the old fields (top, bottom, skin, hair, shoes, sleeve, style) plus build, clothes kind and accessories */
export function randomLook(r) {
  const p = (a) => a[Math.floor(r() * a.length) % a.length];
  const top = p(TOPS), bottom = p(BOTS), skin = p(SKINS), hair = p(HAIRS), shoes = p(SHOES), style = p(STYLES), kind = p(KINDS);
  const soft = r() < 0.5;                                          // a softer, narrower build or a broader one, each varied again
  const build = soft
    ? { sh: 0.88 + r() * 0.08, ch: 0.92 + r() * 0.08, wa: 0.84 + r() * 0.1, hp: 1.0 + r() * 0.08, bu: r() < 0.7 ? 0.008 + r() * 0.01 : 0, be: 0, hs: 0.95 + r() * 0.05, hw: 0.95 + r() * 0.05, jaw: 1.1 }
    : { sh: 0.98 + r() * 0.1, ch: 0.98 + r() * 0.08, wa: 0.95 + r() * 0.12, hp: 0.92 + r() * 0.08, bu: 0, be: r() < 0.25 ? 0.012 : 0, hs: 0.98 + r() * 0.05, hw: 0.98 + r() * 0.05, jaw: 0.9 };
  const sleeve = kind === 'tee' ? (r() < 0.6 ? 'short' : 'long') : 'long';
  const look = { top, bottom, shoes, sleeve, kind };
  if (kind === 'hoodie') { look.hood = true; look.pocket = r() < 0.6; }
  if (kind === 'shirt') { look.collar = true; look.tucked = r() < 0.4; look.buttons = 4; look.shirt = top; look.kind = 'shirt'; }
  if (kind === 'jacket') { look.open = true; look.lapel = r() < 0.5; look.shirt = p(['#e4ddd0', '#2b2f38', '#c9bba3', '#7a8794']); look.top = p(['#3a3f47', '#5a4636', '#2f3a4a', '#6b5b4a']); }
  if (kind === 'cardigan') { look.open = true; look.shirt = p(['#efe8d6', '#2b2f38', '#8a6f5a']); look.buttons = 3; }
  if (soft && r() < 0.25) { look.skirt = true; look.socks = r() < 0.5 ? '#2b2f38' : null; }
  return {
    top: look.top, bottom, skin, hair, shoes, sleeve, style, look, build, glasses: r() < 0.22 ? p(['#24201d', '#5a3a22', '#8a8f98']) : false,
    hat: p(['#2f4d6e', '#7a3b2e', '#3f5a4a', '#c9bba3', '#2b2f38']), iris: p(['#2a1a12', '#3a2414', '#4a3a26', '#2f3a3a']), seed: Math.floor(r() * 1e6),
  };
}
/** a crowd look -> a buildPerson spec (old looks from before still work: missing fields get defaults) */
export function specOf(L) {
  const look = L.look || { top: L.top, bottom: L.bottom, shoes: L.shoes, sleeve: L.sleeve, kind: 'tee' };
  if (L.look && (L.top !== L.look.top || L.bottom !== L.look.bottom)) Object.assign(look, { top: L.top, bottom: L.bottom });   // a caller recoloured it (the barista)
  return { skin: L.skin, hair: L.hair, hairStyle: L.style || 'short', look, build: L.build || {}, glasses: L.glasses, hat: L.hat, iris: L.iris, seed: L.seed || 1 };
}
/** one accessory on its own (built when first shown): 'glasses' and 'headphones' in the neck frame, 'backpack' in the spine frame */
export function accessoryGeo(kind, spec) {
  const B = { sh: 1, ch: 1, wa: 1, hp: 1, bu: 0, be: 0, hs: 1, ...(spec.build || {}) }, g = new SoftGeo(), H = headShape(B);
  if (kind === 'glasses') buildGlasses(g, H, typeof spec.glasses === 'string' ? spec.glasses : null);
  else if (kind === 'headphones') buildHeadphones(g, H, null);
  else if (kind === 'backpack') buildBackpack(g, torsoProfile(B), null);
  return g;
}
