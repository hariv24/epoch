// Extruding buildings into tile meshes.
//
// A building is described by one or more "surfaces": a planar roof polygon (outer ring + holes, local metres)
// with a roof plane z(x,z).  Walls are generated for every ring edge and run from the ground (or from
// whatever lower surface sits right next to the edge, e.g. a podium beside a tower, or a lower neighbour
// across a party wall) up to the roof.  Edges that are hidden by an equal-or-taller neighbour emit nothing,
// which removes the invisible interior faces of the dense Manhattan blocks.
import * as THREE from '../../epoch/web/static/vendor/three/three.module.js';
import { ringArea, pointInRing, bboxOf } from './geo.mjs';

const { ShapeUtils, Vector2 } = THREE;
export const SKIRT = 1.0; // walls start this far below the building's ground level (hides terrain slope gaps)
const PROBE = +(process.env.PROBE || 0.25); // how far outside a wall we look for a neighbouring surface (m)
const CELL = 32;

/** growable typed buffers for one tile mesh (positions + triangle indices only; see pack.mjs for why) */
export class MeshBuf {
  constructor() {
    this.nv = 0; this.ni = 0;
    this.pos = new Float32Array(3 * 4096);
    this.idx = new Uint32Array(3 * 8192);
  }
  _vcap(n) {
    if ((this.nv + n) * 3 <= this.pos.length) return;
    let cap = this.pos.length; while (cap < (this.nv + n) * 3) cap *= 2;
    const p = new Float32Array(cap); p.set(this.pos.subarray(0, this.nv * 3)); this.pos = p;
  }
  _icap(n) {
    if (this.ni + n <= this.idx.length) return;
    let cap = this.idx.length; while (cap < this.ni + n) cap *= 2;
    const i = new Uint32Array(cap); i.set(this.idx.subarray(0, this.ni)); this.idx = i;
  }
  vert(x, y, z) {
    this._vcap(1);
    const k = this.nv++;
    this.pos[3 * k] = x; this.pos[3 * k + 1] = y; this.pos[3 * k + 2] = z;
    return k;
  }
  tri(a, b, c) { this._icap(3); this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
}

/** Spatial index of roof surfaces for neighbour/occlusion queries. */
export class SurfaceIndex {
  constructor() { this.cells = new Map(); this.list = []; }
  add(s) {
    s.sid = this.list.length; this.list.push(s);
    const [x0, z0, x1, z1] = s.bbox;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = cx * 100003 + cz;
        let a = this.cells.get(k); if (!a) this.cells.set(k, (a = []));
        a.push(s);
      }
  }
  /** highest roof elevation at (x,z) among surfaces other than `self` that contain the point, or -Infinity */
  coverZ(x, z, self) {
    const a = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    let best = -Infinity;
    if (!a) return best;
    for (const s of a) {
      if (s === self) continue;
      const b = s.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (!pointInRing(x, z, s.rings[0])) continue;
      let inHole = false;
      for (let h = 1; h < s.rings.length; h++) if (pointInRing(x, z, s.rings[h])) { inHole = true; break; }
      if (inHole) continue;
      const zz = s.pa * x + s.pb * z + s.pc;
      if (zz > best) best = zz;
    }
    return best;
  }
}

/**
 * Build a surface record.  rings = [outer, ...holes] of [x,z]; zOf = plane z(x,z) as {a,b,c}
 * Normalises winding (outer CCW area>0, holes CW area<0).
 */
export function makeSurface(rings, plane, bid, extra = {}) {
  const rs = rings.map((r, i) => {
    const a = ringArea(r);
    const wantPositive = i === 0;
    return (a > 0) === wantPositive ? r : r.slice().reverse();
  });
  const s = { rings: rs, pa: plane.a, pb: plane.b, pc: plane.c, bid, bbox: bboxOf(rs[0]), ...extra };
  s.zTop = Math.max(...rs[0].map((p) => plane.a * p[0] + plane.b * p[1] + plane.c));
  return s;
}
export const flat = (z) => ({ a: 0, b: 0, c: z });

/** least-squares-free plane fit through three well separated points of a 3-D ring ([x,z,y] triples) */
export function fitPlane(ring3) {
  const n = ring3.length;
  let ia = 0, ib = 0, best = -1;
  for (let i = 1; i < n; i++) { const d = (ring3[i][0] - ring3[0][0]) ** 2 + (ring3[i][1] - ring3[0][1]) ** 2; if (d > best) { best = d; ib = i; } }
  let ic = 0, ba = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs((ring3[ib][0] - ring3[ia][0]) * (ring3[i][1] - ring3[ia][1]) - (ring3[ib][1] - ring3[ia][1]) * (ring3[i][0] - ring3[ia][0]));
    if (a > ba) { ba = a; ic = i; }
  }
  const mean = ring3.reduce((s, p) => s + p[2], 0) / n;
  let zmin = Infinity, zmax = -Infinity;
  for (const p of ring3) { if (p[2] < zmin) zmin = p[2]; if (p[2] > zmax) zmax = p[2]; }
  if (zmax - zmin < 0.35 || ba < 1e-3) return { a: 0, b: 0, c: mean, flat: true };
  const A = ring3[ia], B = ring3[ib], C = ring3[ic];
  const ux = B[0] - A[0], uz = B[1] - A[1], uy = B[2] - A[2];
  const vx = C[0] - A[0], vz = C[1] - A[1], vy = C[2] - A[2];
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-6) return { a: 0, b: 0, c: mean, flat: true };
  const a = (uy * vz - vy * uz) / det;
  const b = (ux * vy - vx * uy) / det;
  const c = A[2] - a * A[0] - b * A[1];
  // reject if the plane does not hold for the rest of the ring (not planar): flatten
  let dev = 0;
  for (const p of ring3) dev = Math.max(dev, Math.abs(a * p[0] + b * p[1] + c - p[2]));
  if (dev > 0.6 || Math.hypot(a, b) > 3) return { a: 0, b: 0, c: mean, flat: true };
  return { a, b, c, flat: false };
}

function wallSegments(s, surfaces, p0, p1, outN, ground) {
  // returns [{f0,f1,b0,b1}] where bottoms are elevations at f0/f1 along the edge
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const L = Math.hypot(dx, dz);
  const ns = Math.max(1, Math.min(6, Math.round(L / 5)));
  const bases = new Array(ns);
  for (let j = 0; j < ns; j++) {
    const f = (j + 0.5) / ns;
    const x = p0[0] + dx * f + outN[0] * PROBE, z = p0[1] + dz * f + outN[1] * PROBE;
    const cz = surfaces.coverZ(x, z, s);
    bases[j] = cz;
  }
  return { ns, bases, L };
}

/**
 * Emit one surface (roof + walls) into the mesh. Returns number of triangles added.
 * ground = building ground elevation in metres.
 * Vertices are shared: a wall's top edge reuses the roof's ring vertices and adjacent walls reuse their bottom
 * corners, so the mesh needs no normals (the renderer shades it flat) and costs ~2 vertices per ring point.
 */
export function emitSurface(mesh, surfaces, s, ground) {
  const t0 = mesh.ni;
  const y0 = ground - SKIRT;
  const zOf = (p) => s.pa * p[0] + s.pb * p[1] + s.pc;
  // --- roof (one vertex per ring point, rings concatenated: outer first, then holes)
  const contour = s.rings[0].map((p) => new Vector2(p[0], p[1]));
  const holes = s.rings.slice(1).map((r) => r.map((p) => new Vector2(p[0], p[1])));
  let faces;
  try { faces = ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
  const pts = [...s.rings[0]];
  const ringStart = [0];
  for (let h = 1; h < s.rings.length; h++) { ringStart.push(pts.length); pts.push(...s.rings[h]); }
  const base0 = mesh.nv;
  for (const p of pts) mesh.vert(p[0], zOf(p), p[1]);
  for (const f of faces) {
    let [a, b, c] = f;
    const A = pts[a], B = pts[b], C = pts[c];
    // up-facing winding: need (b-a)x(c-a).y > 0 -> uz*vx - ux*vz
    const ux = B[0] - A[0], uz = B[1] - A[1], vx = C[0] - A[0], vz = C[1] - A[1];
    if (uz * vx - ux * vz < 0) { const t = b; b = c; c = t; }
    mesh.tri(base0 + a, base0 + b, base0 + c);
  }
  // --- walls
  const cache = new Map();
  const vert = (key, x, y, z) => {
    let v = cache.get(key);
    if (v === undefined) { v = mesh.vert(x, y, z); cache.set(key, v); }
    return v;
  };
  for (let r = 0; r < s.rings.length; r++) {
    const ring = s.rings[r];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const p0 = ring[i], p1 = ring[i1];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const L = Math.hypot(dx, dz);
      if (L < 0.15) continue;
      const nx = dz / L, nz = -dx / L; // outward normal (outer ring CCW, holes CW)
      const { ns, bases } = wallSegments(s, surfaces, p0, p1, [nx, nz], ground);
      let j = 0;
      while (j < ns) {
        const bj = bases[j];
        let k = j + 1;
        while (k < ns && (bases[k] === bj || Math.abs(bases[k] - bj) < 0.3)) k++;
        const fa = j / ns, fb = k / ns;
        const xa = p0[0] + dx * fa, za = p0[1] + dz * fa, xb = p0[0] + dx * fb, zb = p0[1] + dz * fb;
        const ta = zOf([xa, za]), tb = zOf([xb, zb]);
        const base = bj === -Infinity ? y0 : Math.max(bj - 0.2, y0); // 0.2 m overlap under the neighbour's roof hides hairline cracks
        if (ta - base > 0.12 || tb - base > 0.12) {
          const ya = Math.max(ta, base), yb = Math.max(tb, base);
          // vertex ids: ring vertices are shared with the roof; interior split points are cached per edge
          const ka = fa === 0 ? `${r}:${i}` : `${r}:${i}:${fa}`;
          const kb = fb === 1 ? `${r}:${i1}` : `${r}:${i}:${fb}`;
          const bk = Math.round(base * 20);
          const aBot = vert(`b${ka}:${bk}`, xa, base, za);
          const bBot = vert(`b${kb}:${bk}`, xb, base, zb);
          const aTop = (ya === ta && fa === 0) ? base0 + ringStart[r] + i : vert(`t${ka}:${Math.round(ya * 20)}`, xa, ya, za);
          const bTop = (yb === tb && fb === 1) ? base0 + ringStart[r] + i1 : vert(`t${kb}:${Math.round(yb * 20)}`, xb, yb, zb);
          mesh.tri(aBot, bTop, bBot);
          mesh.tri(aBot, aTop, bTop);
        }
        j = k;
      }
    }
  }
  return (mesh.ni - t0) / 3;
}
