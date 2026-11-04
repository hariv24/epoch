// Projection + 2-D geometry helpers shared by the Manhattan build.
//
// LOCAL FRAME (what the renderer sees): metres, X = east, Y = up (metres above NAD83 / NAVD88 mean sea
// level, as in the city's ground-elevation attribute), Z = south (so north is -Z, like a map drawn
// top-up seen from above in three.js).  Origin = ORIGIN lon/lat (Times Square).
//
//   x =  (lon - lon0) * mPerDegLon(lat)
//   z = -(lat - lat0) * mPerDegLat(lat_mid)    -> implemented below as a latitude integral that is
//                                                 exact (WGS84 meridian arc), so there is no drift.
// Over Manhattan's ±12 km this is within ~0.3 m of a true local tangent-plane projection.

export const ORIGIN = { lon: -73.98513, lat: 40.7589 };
export const FT = 0.3048; // international foot (heights, elevations in the footprint dataset are in feet)
export const FT_US = 1200 / 3937; // US survey foot (State Plane coordinates)

const A = 6378137.0;
const E2 = 0.00669437999014;
const D2R = Math.PI / 180;

// meridian arc length from the equator (series, metres)
function meridian(latRad) {
  const e2 = E2, e4 = e2 * e2, e6 = e4 * e2;
  return A * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latRad
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latRad)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latRad)
    - (35 * e6 / 3072) * Math.sin(6 * latRad));
}
const M0 = meridian(ORIGIN.lat * D2R);
function mPerDegLon(latDeg) {
  const p = latDeg * D2R;
  const s = Math.sin(p);
  return (Math.PI / 180) * A * Math.cos(p) / Math.sqrt(1 - E2 * s * s);
}

export function lonLatToXZ(lon, lat) {
  const x = (lon - ORIGIN.lon) * mPerDegLon(lat);
  const z = -(meridian(lat * D2R) - M0);
  return [x, z];
}
export function xzToLonLat(x, z) {
  // invert meridian arc by Newton iteration
  let lat = ORIGIN.lat + (-z) / 111200;
  for (let i = 0; i < 6; i++) {
    const f = meridian(lat * D2R) - M0 + z;
    const p = lat * D2R;
    const s = Math.sin(p);
    const dm = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5); // d(meridian)/d(lat rad)
    lat -= f / dm / D2R;
  }
  return [ORIGIN.lon + x / mPerDegLon(lat), lat];
}

// ---------------------------------------------------------------- EPSG:2263 (NY Long Island, US ft)
const SP = (() => {
  const a = 6378137.0, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2);
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
  const p1 = (40 + 40 / 60) * D2R, p2 = (41 + 2 / 60) * D2R, p0 = (40 + 10 / 60) * D2R, l0 = -74 * D2R;
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * Math.pow(t(p1), n));
  const r0 = a * F * Math.pow(t(p0), n);
  return { a, e, n, F, r0, l0 };
})();
/** NY State Plane Long Island (US survey feet) -> [lon, lat] */
export function sp2263ToLonLat(xft, yft) {
  const { a, e, n, F, r0, l0 } = SP;
  const x = (xft - 984250.0) * FT_US;
  const y = yft * FT_US;
  const rr = Math.sign(n) * Math.hypot(x, r0 - y);
  const tt = Math.pow(rr / (a * F), 1 / n);
  const th = Math.atan2(x, r0 - y);
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2));
  return [(th / n + l0) / D2R, phi / D2R];
}

// ---------------------------------------------------------------- 2-D polygon helpers (x,z plane)
/** Signed area of a ring given as [[x,z],…] (positive = counter-clockwise in a math x-right/z-up plane). */
export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
export function ringCentroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
    const w = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += w; cx += (r[j][0] + r[i][0]) * w; cz += (r[j][1] + r[i][1]) * w;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0; for (const p of r) { sx += p[0]; sz += p[1]; }
    return [sx / r.length, sz / r.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** poly = [outer, hole, …] */
export function pointInPoly(x, z, poly) {
  if (!pointInRing(x, z, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(x, z, poly[i])) return false;
  return true;
}
export function bboxOf(ring) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
  return [x0, z0, x1, z1];
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.sqrt(l2);
}
function dpOpen(pts, tol, keep, lo, hi) {
  let md = 0, mi = -1;
  for (let i = lo + 1; i < hi; i++) { const d = perpDist(pts[i], pts[lo], pts[hi]); if (d > md) { md = d; mi = i; } }
  if (mi >= 0 && md > tol) { keep[mi] = 1; dpOpen(pts, tol, keep, lo, mi); dpOpen(pts, tol, keep, mi, hi); }
}
/** Douglas-Peucker on a closed ring (no repeated last point). Returns a new ring, ≥3 pts or null. */
export function simplifyRing(ring, tol) {
  const n = ring.length;
  if (n <= 3) return ring.slice();
  // anchor on the two mutually farthest-ish points (first, and the farthest from it)
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[far] = 1;
  const a = ring.slice(0, far + 1);
  const b = ring.slice(far).concat([ring[0]]);
  const ka = new Uint8Array(a.length); ka[0] = 1; ka[a.length - 1] = 1; dpOpen(a, tol, ka, 0, a.length - 1);
  const kb = new Uint8Array(b.length); kb[0] = 1; kb[b.length - 1] = 1; dpOpen(b, tol, kb, 0, b.length - 1);
  const out = [];
  for (let i = 0; i < a.length; i++) if (ka[i]) out.push(a[i]);
  for (let i = 1; i < b.length - 1; i++) if (kb[i]) out.push(b[i]);
  return out.length >= 3 ? out : null;
}
/** Drop repeated points and (near) collinear vertices; keeps the ring closed-implicit. */
export function cleanRing(ring, eps = 0.02) {
  let r = [];
  for (const p of ring) { const q = r[r.length - 1]; if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) r.push(p); }
  while (r.length > 1 && Math.abs(r[0][0] - r[r.length - 1][0]) <= eps && Math.abs(r[0][1] - r[r.length - 1][1]) <= eps) r.pop();
  if (r.length < 3) return null;
  let changed = true;
  while (changed && r.length > 3) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (perpDist(b, a, c) < eps) { r.splice(i, 1); i--; changed = true; }
    }
  }
  return r;
}
/** Minimum-area oriented rectangle of a point set -> { cx, cz, w, d, angle } (angle of the w axis, radians in x-z plane). */
export function minAreaRect(pts) {
  // convex hull (monotone chain)
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of hull) { const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ang, u0, u1, v0, v1 };
  }
  const { ang, u0, u1, v0, v1 } = best;
  const c = Math.cos(ang), s = Math.sin(ang);
  const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
  return { cx: mu * c - mv * s, cz: mu * s + mv * c, w: u1 - u0, d: v1 - v0, angle: ang };
}
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export const round = (v, d = 1) => { const k = 10 ** d; return Math.round(v * k) / k; };
