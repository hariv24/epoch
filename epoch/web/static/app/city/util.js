// city/util.js · small helpers shared by the city modules: seeded randomness, colour helpers and Geo,
// a tiny merged-geometry builder (positions, flat normals, vertex colours and one vec4 "aA" attribute
// that the city shader reads: u along the facade, facade width, surface kind, landmark section).
import * as THREE from 'three';

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

// small fast seeded PRNG (mulberry32); same seed, same city
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// integer hash to [0,1)
export function hash01(n) {
  n = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
export const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

const _c = new THREE.Color();
export const rgb = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };       // linear working space
export function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
export function tint(c, to, t) { const o = rgb(to); return [c[0] + (o[0] - c[0]) * t, c[1] + (o[1] - c[1]) * t, c[2] + (o[2] - c[2]) * t]; }
export function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
// small per-building variation so neighbouring lots never look stamped
export function jitter(c, r, amt = 0.1) { const f = 1 + (r - 0.5) * 2 * amt; return [c[0] * f, c[1] * f, c[2] * (1 + (r - 0.5) * amt)]; }

const KIND = { win: 0, plain: 1, crown: 2, door: 3, bill: 4, fence: 5, glow: 6, water: 7, stone: 8, inlay: 9, ghost: 10 };
export { KIND };

export class Geo {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.aa = []; this.idx = []; this.n = 0; this.vols = []; }   // vols: axis-aligned boxes [x0,y0,z0,x1,y1,z1] of every box()/cyl(), for the people clearance check (city/people_fit.js)

  _v(x, y, z, nx, ny, nz, c, u, fw, kind, sec) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c[0], c[1], c[2]); this.aa.push(u, fw, kind, sec);
    return this.n++;
  }

  // quad corners CCW seen from outside. `c` is one colour or an array of four (bottom-left, bottom-right, top-right, top-left)
  quad(p0, p1, p2, p3, c, u0 = 0, fw = 1, kind = 1, sec = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { // degenerate (pyramid tip): use the other diagonal
      const wx = p2[0] - p1[0], wy = p2[1] - p1[1], wz = p2[2] - p1[2];
      nx = uy * wz - uz * wy; ny = uz * wx - ux * wz; nz = ux * wy - uy * wx; l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
    }
    nx /= l; ny /= l; nz /= l;
    const cc = Array.isArray(c[0]) ? c : [c, c, c, c];
    const a = this._v(p0[0], p0[1], p0[2], nx, ny, nz, cc[0], u0, fw, kind, sec);
    const b = this._v(p1[0], p1[1], p1[2], nx, ny, nz, cc[1], u0 + fw, fw, kind, sec);
    const d = this._v(p2[0], p2[1], p2[2], nx, ny, nz, cc[2], u0 + fw, fw, kind, sec);
    const e = this._v(p3[0], p3[1], p3[2], nx, ny, nz, cc[3], u0, fw, kind, sec);
    this.idx.push(a, b, d, a, d, e);
  }

  // axis aligned box. o: {win, kind, sec, top, bottom, ctop, sides}
  box(x0, y0, z0, x1, y1, z1, c, o = {}) {
    const kSide = o.win ? KIND.win : (o.kind ?? 1), kTop = o.kind ?? 1, sec = o.sec ?? 0, w = x1 - x0, d = z1 - z0;
    const sides = o.sides ?? 15;               // bit 1 front(+z) 2 back 4 right(+x) 8 left
    if (!o.win && (x1 - x0) > 0.004 && (z1 - z0) > 0.004 && (y1 - y0) > 0.004) this.vols.push([x0, y0, z0, x1, y1, z1]);
    if (sides & 1) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, 0, w, kSide, sec);
    if (sides & 2) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c, 0, w, kSide, sec);
    if (sides & 4) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c, 0, d, kSide, sec);
    if (sides & 8) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c, 0, d, kSide, sec);
    if (o.top !== false) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], o.ctop || c, 0, w, kTop, sec);
    if (o.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, 0, w, kTop, sec);
  }
  // centred box helper
  cbox(cx, y0, cz, w, h, d, c, o) { this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, c, o); }

  // rectangle -> rectangle frustum (roofs, tapers, pyramids when the top size is 0)
  frustum(cx, cz, y0, y1, w0, d0, w1, d1, c, o = {}, cx1 = cx, cz1 = cz) {
    const kind = o.kind ?? 1, sec = o.sec ?? 0, a = w0 / 2, b = d0 / 2, e = w1 / 2, f = d1 / 2;
    const B = [[cx - a, y0, cz + b], [cx + a, y0, cz + b], [cx + a, y0, cz - b], [cx - a, y0, cz - b]];
    const T = [[cx1 - e, y1, cz1 + f], [cx1 + e, y1, cz1 + f], [cx1 + e, y1, cz1 - f], [cx1 - e, y1, cz1 - f]];
    this.quad(B[0], B[1], T[1], T[0], c, 0, w0, kind, sec);         // front
    this.quad(B[1], B[2], T[2], T[1], c, 0, d0, kind, sec);         // right
    this.quad(B[2], B[3], T[3], T[2], c, 0, w0, kind, sec);         // back
    this.quad(B[3], B[0], T[0], T[3], c, 0, d0, kind, sec);         // left
    if (w1 > 1e-4 && d1 > 1e-4 && o.top !== false) this.quad(T[0], T[1], T[2], T[3], o.ctop || c, 0, w1, kind, sec);
  }

  // n-sided prism / cone. rot = start angle
  cyl(cx, cz, y0, y1, r0, r1, seg, c, o = {}) {
    const kind = o.kind ?? 1, sec = o.sec ?? 0, rot = o.rot ?? 0, sk = o.win ? 0 : kind;
    { const rr = Math.max(r0, r1); if (!o.win && rr > 0.01 && y1 - y0 > 0.004) this.vols.push([cx - rr, y0, cz - rr, cx + rr, y1, cz + rr]); }
    const P = (r, y, k) => { const a = rot + (k / seg) * TAU; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; };
    const chord = Math.max(0.02, 2 * Math.max(r0, r1) * Math.sin(Math.PI / seg));
    for (let k = 0; k < seg; k++) {
      const b0 = P(r0, y0, k), b1 = P(r0, y0, k + 1), t0 = P(r1, y1, k), t1 = P(r1, y1, k + 1);
      this.quad(b1, b0, t0, t1, c, 0, chord, sk, sec);
    }
    if (r1 > 1e-4 && o.top !== false) {
      const ctr = [cx, y1, cz], cc = o.ctop || c;
      for (let k = 0; k < seg; k++) this.tri(ctr, P(r1, y1, k + 1), P(r1, y1, k), cc, kind, sec);
    }
    if (o.bottom && r0 > 1e-4) {
      const ctr = [cx, y0, cz];
      for (let k = 0; k < seg; k++) this.tri(ctr, P(r0, y0, k), P(r0, y0, k + 1), c, kind, sec);
    }
  }
  tri(p0, p1, p2, c, kind = 1, sec = 0) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const a = this._v(p0[0], p0[1], p0[2], nx, ny, nz, c, 0, 1, kind, sec), b = this._v(p1[0], p1[1], p1[2], nx, ny, nz, c, 0, 1, kind, sec), d = this._v(p2[0], p2[1], p2[2], nx, ny, nz, c, 0, 1, kind, sec);
    this.idx.push(a, b, d);
  }

  // thin square bar from a to b (cables, rails, poles, ladders)
  bar(a, b, th, c, o = {}) {
    const kind = o.kind ?? 1, sec = o.sec ?? 0;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz); if (l < 1e-6) return;
    const dir = [dx / l, dy / l, dz / l], up = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let sx = dir[1] * up[2] - dir[2] * up[1], sy = dir[2] * up[0] - dir[0] * up[2], sz = dir[0] * up[1] - dir[1] * up[0];
    let sl = Math.hypot(sx, sy, sz); sx = sx / sl * th / 2; sy = sy / sl * th / 2; sz = sz / sl * th / 2;
    let tx = dir[1] * sz - dir[2] * sy, ty = dir[2] * sx - dir[0] * sz, tz = dir[0] * sy - dir[1] * sx;
    const tl = Math.hypot(tx, ty, tz); tx = tx / tl * th / 2; ty = ty / tl * th / 2; tz = tz / tl * th / 2;
    const A = (s, t) => [a[0] + sx * s + tx * t, a[1] + sy * s + ty * t, a[2] + sz * s + tz * t];
    const B = (s, t) => [b[0] + sx * s + tx * t, b[1] + sy * s + ty * t, b[2] + sz * s + tz * t];
    this.quad(A(-1, -1), A(1, -1), B(1, -1), B(-1, -1), c, 0, 1, kind, sec);
    this.quad(A(1, -1), A(1, 1), B(1, 1), B(1, -1), c, 0, 1, kind, sec);
    this.quad(A(1, 1), A(-1, 1), B(-1, 1), B(1, 1), c, 0, 1, kind, sec);
    this.quad(A(-1, 1), A(-1, -1), B(-1, -1), B(-1, 1), c, 0, 1, kind, sec);
    if (o.caps) { this.quad(A(-1, 1), A(1, 1), A(1, -1), A(-1, -1), c, 0, 1, kind, sec); this.quad(B(-1, -1), B(1, -1), B(1, 1), B(-1, 1), c, 0, 1, kind, sec); }
  }

  // any THREE geometry, flat shaded, optionally transformed
  addGeometry(g, c, o = {}, m = null) {
    const kind = o.kind ?? 1, sec = o.sec ?? 0;
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.attributes.position, v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i + 2 < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); d.fromBufferAttribute(p, i + 2);
      if (m) { a.applyMatrix4(m); b.applyMatrix4(m); d.applyMatrix4(m); }
      this.tri([a.x, a.y, a.z], [b.x, b.y, b.z], [d.x, d.y, d.z], o.vcol ? o.vcol(a, b, d) : c, kind, sec);
    }
    void v;
  }
  sphere(cx, cy, cz, r, ws, hs, c, o = {}, sy = 1) {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, o.half ? Math.PI / 2 : Math.PI);
    this.addGeometry(g, c, o, new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(new THREE.Matrix4().makeScale(1, sy, 1))); g.dispose();
  }
  // low-poly flat shaded blob (tree canopy, bush)
  blob(cx, cy, cz, r, c, o = {}, sy = 1, detail = 0) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    this.addGeometry(g, c, o, new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(new THREE.Matrix4().makeScale(1, sy, 1))); g.dispose();
  }

  // copy another Geo here, rotated about y and moved (and uniformly scaled)
  append(o, dx = 0, dy = 0, dz = 0, rotY = 0, s = 1, secOverride = null) {
    const base = this.n, cs = Math.cos(rotY), sn = Math.sin(rotY);
    for (let i = 0; i < o.n; i++) {
      const x = o.pos[i * 3] * s, y = o.pos[i * 3 + 1] * s, z = o.pos[i * 3 + 2] * s, nx = o.nor[i * 3], ny = o.nor[i * 3 + 1], nz = o.nor[i * 3 + 2];
      this.pos.push(x * cs + z * sn + dx, y + dy, -x * sn + z * cs + dz);
      this.nor.push(nx * cs + nz * sn, ny, -nx * sn + nz * cs);
      this.col.push(o.col[i * 3], o.col[i * 3 + 1], o.col[i * 3 + 2]);
      this.aa.push(o.aa[i * 4], o.aa[i * 4 + 1] * s, o.aa[i * 4 + 2], secOverride ?? o.aa[i * 4 + 3]);
    }
    for (const k of o.idx) this.idx.push(base + k);
    this.n += o.n;
  }

  get empty() { return this.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(this.aa, 4));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
