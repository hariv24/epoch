// city/world/fitmath.js · the pure array math of people_fit.js (docs/WORLD.md §10): evaluate / solve / findStandSpot / thin on plain Float32Arrays and plain volume objects.
// No `three` import, so the same file runs on the main thread (people_fit re-exports it) and inside the fit worker (fitworker.js; module workers cannot use the page's import map).
export const GROUPS = ['torso', 'head', 'pelvis', 'thigh', 'shin', 'foot', 'upperarm', 'forearm', 'hand', 'finger'];
const GI = Object.fromEntries(GROUPS.map((g, i) => [g, i]));
export const DESIGNED = { seat: ['pelvis', 'thigh'], seat_soft: ['pelvis', 'thigh'], floor: ['foot'], footrest: ['foot'], keyboard: ['finger', 'hand'], desktop: ['forearm', 'hand', 'finger'], book: ['thigh'], mattress: ['pelvis', 'torso', 'head', 'thigh', 'shin', 'foot', 'upperarm', 'forearm', 'hand', 'finger'] };
const CONTACT = { seat: 1, seat_soft: 1, mattress: 1, keyboard: 1, book: 1 };              // kinds that must actually be touched (feet: any floor/footrest, checked as a union below)
const SUPPORT = new Set(['floor', 'footrest']);
let TOL = 0.015; const GATE = 0.01, SOFT = 0.03;
export const setTol = (t = 0.015) => { TOL = t; };          // Butler v2 (docs/BUTLER-V2.md 11.4) runs its seat / hand / foot contacts at +-2.5 cm; everyone else keeps 1.5                // soft cushions may compress 3 cm under the pelvis and thighs (seat_soft); every other designed contact is +-1.5 cm
const hinge = (v, tol) => 300 * Math.max(0, v - tol) + 20 * Math.max(0, v - tol * 0.5);   // steep past the limit, gentle pull toward the middle of the tolerance
const tolOf = (kind) => (kind === 'seat_soft' || kind === 'mattress' ? SOFT : TOL);
// signed distance from a world point to a volume: negative = inside (depth to the nearest face)
export function sdist(v, x, y, z) {
  const dx = x - v.px, dz = z - v.pz, lx = dx * v.c - dz * v.s, lz = dx * v.s + dz * v.c, ly = y - v.py, b = v.b;
  const ox = Math.max(b[0] - lx, lx - b[3], 0), oy = Math.max(b[1] - ly, ly - b[4], 0), oz = Math.max(b[2] - lz, lz - b[5], 0);
  if (ox > 0 || oy > 0 || oz > 0) return Math.hypot(ox, oy, oz);
  return -Math.min(lx - b[0], b[3] - lx, ly - b[1], b[4] - ly, lz - b[2], b[5] - lz);
}
export function thin(cloud, fStep, pStep) {
  const keep = []; for (let i = 0; i < cloud.n; i += pStep) keep.push(i);
  const frames = []; for (let f = 0; f < cloud.F; f += fStep) { const a = cloud.frames[f], b = new Float32Array(keep.length * 3); keep.forEach((i, j) => { b[j * 3] = a[i * 3]; b[j * 3 + 1] = a[i * 3 + 1]; b[j * 3 + 2] = a[i * 3 + 2]; }); frames.push(b); }
  return { ...cloud, n: keep.length, F: frames.length, frames, grp: Uint8Array.from(keep, (i) => cloud.grp[i]), side: Uint8Array.from(keep, (i) => cloud.side[i]) };
}

// place: { x, y, z, yaw }. opt.margin(vol) -> required clearance for non-designed pairs (default 2 cm). Returns { rows, ok, clean, maxPen, cost }.
export function evaluate(cloud, place, vols, opt = {}) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw), margin = opt.margin || (() => 0.02), rows = [];
  // world bounds of the whole cloud for this placement (prefilter volumes)
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const a of cloud.frames) for (let i = 0; i < cloud.n; i += 7) {
    const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2], wx = place.x + x * c + z * s, wz = place.z - x * s + z * c, wy = place.y + y;
    if (wx < bx0) bx0 = wx; if (wx > bx1) bx1 = wx; if (wy < by0) by0 = wy; if (wy > by1) by1 = wy; if (wz < bz0) bz0 = wz; if (wz > bz1) bz1 = wz;
  }
  let cost = 0, maxPen = 0, ok = true, clean = true, support = 1e9;
  for (const v of vols) {
    const m = SUPPORT.has(v.kind) ? 0.02 : margin(v), inf = Math.max(m, 0.03) + 0.04, w = v.wb;
    if (w[0] > bx1 + inf || w[3] < bx0 - inf || w[1] > by1 + inf || w[4] < by0 - inf || w[2] > bz1 + inf || w[5] < bz0 - inf) continue;
    const des = DESIGNED[v.kind] || [], desMask = new Uint8Array(GROUPS.length); for (const g of des) desMask[GI[g]] = 1;
    let minND = 1e9, minD = 1e9, gND = '', gD = '', fND = 0, fD = 0, pND = null, pD = null;
    for (let f = 0; f < cloud.F; f++) {
      const a = cloud.frames[f];
      for (let i = 0; i < cloud.n; i++) {
        const x = a[i * 3], z0 = a[i * 3 + 2], wx = place.x + x * c + z0 * s, wz = place.z - x * s + z0 * c, wy = place.y + a[i * 3 + 1];
        if (wx < w[0] - inf || wx > w[3] + inf || wz < w[2] - inf || wz > w[5] + inf || wy < w[1] - inf || wy > w[4] + inf) continue;
        const d = sdist(v, wx, wy, wz), g = cloud.grp[i];
        if (desMask[g]) { if (d < minD) { minD = d; gD = GROUPS[g]; fD = f; pD = [wx, wy, wz]; } } else if (d < minND) { minND = d; gND = GROUPS[g]; fND = f; pND = [wx, wy, wz]; }
      }
    }
    if (minND > 5 && minD > 5) continue;                                              // nothing near
    const penND = Math.max(0, -minND), penD = Math.max(0, -minD), tol = tolOf(v.kind);
    let status = 'PASS', note = '';
    const rowPen = Math.max(penND, penD);
    if (penND > GATE) { status = 'FAIL'; note = 'pen ' + gND; }
    else if (penD > tol) { status = 'FAIL'; note = 'pen ' + gD; }
    else if (CONTACT[v.kind] && des.length && minD < 5 && minD > TOL) { status = 'FAIL'; note = 'float ' + gD + ' ' + (minD * 100).toFixed(1) + 'cm'; }
    else if (minND < m - 0.0005 && minND < 5) { status = 'NEAR'; note = 'clearance ' + gND; }
    if (status === 'FAIL') ok = false; if (status !== 'PASS') clean = false;
    cost += hinge(penND, GATE) + hinge(penD, tol) + 150 * Math.max(0, Math.min(m, 1) - minND) + (CONTACT[v.kind] && des.length && minD < 5 ? hinge(Math.max(0, minD), TOL) : 0);
    maxPen = Math.max(maxPen, rowPen);
    if (SUPPORT.has(v.kind) && minD < 5) support = Math.min(support, Math.abs(minD) <= TOL ? 0 : minD);
    rows.push({ name: v.name, kind: v.kind, penND, penD, clear: minND, contact: minD, gND, gD, fND, fD, pND, pD, status, note });
  }
  const feetTol = opt.feetTol ?? TOL;
  if (opt.feet !== false && support < 1e9 && Math.abs(support) > feetTol) {                // the feet touch the floor or a footrest (union), else they float
    ok = clean = false; cost += hinge(Math.abs(support), feetTol); rows.push({ name: 'feet support', kind: 'floor', penND: 0, penD: 0, clear: 9, contact: support, status: 'FAIL', note: 'feet float ' + (support * 100).toFixed(1) + 'cm' });
  }
  return { rows, ok, clean, maxPen, cost };
}

// search offsets dx,dz (+-range) and yaw (+-yawRange) around base = { x, y, z, yaw }; prefer small moves. `want` optionally pulls toward a point ({x,z,k}).
export function solve(cloud, vols, base, o = {}) {
  const dhR = o.dh ?? 0.03, range = o.range ?? 0.2, yawR = o.yawRange ?? (15 * Math.PI) / 180, coarse = o.coarse ?? 0.02;
  const small = thin(cloud, Math.max(1, Math.floor(cloud.F / 8)), Math.max(1, Math.floor(cloud.n / 1400)));
  const pen = (dx, dz, dy) => 0.35 * Math.hypot(dx, dz) + 0.6 * Math.abs(dy) + (o.want ? (o.want.k || 1) * Math.hypot(base.x + dx - o.want.x, base.z + dz - o.want.z) : 0);
  const tryAt = (cl, dx, dz, dy) => { const p = { x: base.x + dx, y: base.y, z: base.z + dz, yaw: base.yaw + dy }; const r = evaluate(cl, p, vols, o); return { dx, dz, dy, p, r, score: r.cost + pen(dx, dz, dy) }; };
  let best = null; const n = Math.round(range / coarse);
  const yaws = [0, 0.5, -0.5, 1, -1].map((k) => k * yawR);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (const dy of yaws) { const t = tryAt(small, i * coarse, j * coarse, dy); if (!best || t.score < best.score) best = t; }
  // refine around the best at 1 cm / 2 deg, on the thin cloud, then verify on the full one
  let fine = best;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (const dy of [-0.06, -0.03, 0, 0.03, 0.06]) {
    const dx = best.dx + i * 0.01, dz = best.dz + j * 0.01, yy = best.dy + dy;
    if (Math.abs(dx) > range + 1e-6 || Math.abs(dz) > range + 1e-6 || Math.abs(yy) > yawR + 0.06) continue;
    const t = tryAt(small, dx, dz, yy); if (t.score < fine.score) fine = t;
  }
  // height: the person may sit up to 3 cm lower/higher (cushions, soft rugs) to balance the feet and the seat contacts
  let bestY = 0, bestC = 1e9;
  for (let dh = -dhR; dh <= dhR + 1e-9; dh += 0.0025) { const p = { ...fine.p, y: base.y + dh }, r = evaluate(small, p, vols, o), c = r.cost + 0.4 * Math.abs(dh); if (c < bestC) { bestC = c; bestY = dh; } }
  // finish on the FULL cloud (the thin one can miss the closest vertex): a small hill climb over x, z, yaw and height
  let cur = { dx: fine.dx, dz: fine.dz, dy: fine.dy, dh: bestY };
  const at = (c) => ({ x: base.x + c.dx, y: base.y + c.dh, z: base.z + c.dz, yaw: base.yaw + c.dy });
  const score = (c) => { const r = evaluate(cloud, at(c), vols, o); return { r, s: r.cost + pen(c.dx, c.dz, c.dy) + 0.4 * Math.abs(c.dh) }; };
  let sc = score(cur);
  for (let it = 0; it < 14; it++) {
    let improved = false;
    for (const d of [[0.005, 0, 0, 0], [-0.005, 0, 0, 0], [0, 0.005, 0, 0], [0, -0.005, 0, 0], [0, 0, 0.02, 0], [0, 0, -0.02, 0], [0, 0, 0, 0.0025], [0, 0, 0, -0.0025], [0.01, 0.01, 0, 0], [-0.01, -0.01, 0, 0], [0.01, -0.01, 0, 0], [-0.01, 0.01, 0, 0]]) {
      const c = { dx: cur.dx + d[0], dz: cur.dz + d[1], dy: cur.dy + d[2], dh: cur.dh + d[3] };
      if (Math.abs(c.dx) > range + 1e-6 || Math.abs(c.dz) > range + 1e-6 || Math.abs(c.dy) > yawR + 0.06 || Math.abs(c.dh) > dhR + 1e-6) continue;
      const t = score(c); if (t.s < sc.s - 1e-9) { sc = t; cur = c; improved = true; }
    }
    if (!improved) break;
  }
  return { dx: cur.dx, dz: cur.dz, dyaw: cur.dy, dh: cur.dh, place: at(cur), report: sc.r };
}

// a free floor spot near `near` ({x,z}) facing yaw, >= `clear` (15 cm) from furniture. Walls / sills use the 2 cm margin.
export function findStandSpot(cloud, vols, near, yaw, o = {}) {
  const clear = o.clear ?? 0.15, R = o.radius ?? 1.0, step = o.step ?? 0.05;
  const small = thin(cloud, Math.max(1, Math.floor(cloud.F / 6)), Math.max(1, Math.floor(cloud.n / 1200)));
  const margin = (v) => (v.kind === 'wall' || v.kind === 'shell' ? 0.02 : clear);
  let best = null;
  for (let dx = -R; dx <= R + 1e-6; dx += step) for (let dz = -R; dz <= R + 1e-6; dz += step) {
    const x = near.x + dx, z = near.z + dz; if (o.bounds && (x < o.bounds[0] || x > o.bounds[1] || z < o.bounds[2] || z > o.bounds[3])) continue;
    const r = evaluate(small, { x, y: 0, z, yaw }, vols, { margin });
    const score = r.cost * 40 + Math.hypot(dx, dz) + (r.ok ? 0 : 5);
    if (!best || score < best.score) best = { score, x, z, r };
  }
  // refine at 1 cm around, verify on the full cloud
  let fine = best;
  for (let dx = -0.04; dx <= 0.04 + 1e-6; dx += 0.01) for (let dz = -0.04; dz <= 0.04 + 1e-6; dz += 0.01) {
    const x = best.x + dx, z = best.z + dz, r = evaluate(small, { x, y: 0, z, yaw }, vols, { margin }), score = r.cost * 40 + Math.hypot(x - near.x, z - near.z) + (r.ok ? 0 : 5);
    if (score < fine.score) fine = { score, x, z, r };
  }
  // finish on the full cloud (the thin one can miss the closest vertex)
  let cur = { x: fine.x, z: fine.z }, cs = null;
  const sc = (x, z) => { const r = evaluate(cloud, { x, y: 0, z, yaw }, vols, { margin }); return { r, s: r.cost * 40 + Math.hypot(x - near.x, z - near.z) + (r.ok ? 0 : 5) }; };
  cs = sc(cur.x, cur.z);
  for (let it = 0; it < 12; it++) {
    let imp = false;
    for (const [dx, dz] of [[0.01, 0], [-0.01, 0], [0, 0.01], [0, -0.01], [0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]]) { const t = sc(cur.x + dx, cur.z + dz); if (t.s < cs.s - 1e-9) { cs = t; cur = { x: cur.x + dx, z: cur.z + dz }; imp = true; break; } }
    if (!imp) break;
  }
  return { x: cur.x, z: cur.z, yaw, report: cs.r, margin };
}


// the open book on the lap (BOOK = a paperback, 12.5 x 18 cm per page); moved here from people_fit.js so the fit worker can run it
const BOOK = { w: 0.125, d: 0.18, t: 0.025 };
export function bookOnThighs(cloud) {
  const a = cloud.frames[0], th = [], other = [];
  for (let i = 0; i < cloud.n; i++) { const p = [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]; if (cloud.grp[i] === GI.thigh) th.push(p); else if ([GI.hand, GI.finger, GI.forearm, GI.pelvis, GI.torso, GI.upperarm].includes(cloud.grp[i])) other.push(p); }
  let zmin = 1e9, zmax = -1e9; for (const p of th) { zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); }
  let best = null;
  const hw = BOOK.w + 0.004, hd = BOOK.d / 2 + 0.004;
  for (let z = zmin + hd * 0.45; z <= zmax - hd * 0.3; z += 0.01) for (let x = -0.08; x <= 0.08 + 1e-6; x += 0.01) for (const yaw of [0, 0.12, -0.12, 0.25, -0.25]) {
    const c = Math.cos(yaw), s = Math.sin(yaw), inFoot = (p) => { const dx = p[0] - x, dz = p[2] - z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < hw && Math.abs(lz) < hd; };
    let top = -1e9, nth = 0; for (const p of th) if (inFoot(p)) { nth++; if (p[1] > top) top = p[1]; }
    if (nth < 30) continue;
    const base = top + 0.001;
    let pen = 0, wg = '';
    for (const fr of [0, 8, 16]) { const A = cloud.frames[fr % cloud.F]; for (let i = 0; i < cloud.n; i++) { const g = cloud.grp[i]; if (g === GI.thigh || !(g === GI.hand || g === GI.finger || g === GI.forearm || g === GI.pelvis || g === GI.torso || g === GI.upperarm)) continue; const px = A[i * 3], py = A[i * 3 + 1], pz = A[i * 3 + 2], dx = px - x, dz = pz - z, lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < hw + 0.02 && Math.abs(lz) < hd + 0.02 && py > base - 0.002 && py < base + BOOK.t + 0.02) { const q = Math.min(base + BOOK.t + 0.02 - py, py - base + 0.02); if (q > pen) { pen = q; wg = GROUPS[g]; } } } }
    for (const p of []) { const dx = p[0] - x, dz = p[2] - z, lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < hw + 0.03 && Math.abs(lz) < hd + 0.03 && p[1] < base + BOOK.t + 0.03) pen = Math.max(pen, base + BOOK.t + 0.03 - p[1]); }
    const score = pen * 100 + Math.hypot(x, z - (zmin + zmax) / 2) * 0.5 + nth * -0.0004;
    if (!best || score < best.score) best = { score, x, y: base, z, yaw, pen, wg };
  }
  return best;
}

