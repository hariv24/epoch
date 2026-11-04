// city/world/controller.js · the character controller shared by every walkable scene (was inside room2_walk.js; docs/WORLD.md §10, ROOM-V2 §15).
// Generic over a collision world: createController({ obbs: [{ x, z, hw, hd, ry, n? }], circles: [{ x, z, r, n? }], walls: [obbs], bounds: { X0, X1, Z0, Z1 } }, { radius, grid, gridPad, stats }).
// The body is a circle of `radius` (0.22 m) in plan. Oriented boxes, circles and wall boxes are solids; the world's bounds are the outer limit. Streets will feed per-block colliders later.
//   gap / clearance / hit / free     signed gap to the nearest surface, free-space tests
//   resolve(x, z)                    push out of every solid (up to 4 corner passes) -> { x, z, touched, ok }
//   moveBy(pos, dx, dz)              one step of a wanted displacement: slide along the contact, steer +-35 deg (remembering the side) if the way is blocked; mutates pos, returns the distance moved
//   unstick(pos, dt)                 ease out of a solid along the shortest way within 0.25 s (never stuck)
//   nearestFree(x, z) / astar(sx, sz, tx, tz)   a 0.1 m grid A* with string-pulling; grid = { nx, nz, blocked }
// Camera-relative WASD / arrows are read by the caller (scene key state); the controller does the physics.
const D2R = Math.PI / 180;
export const KEYS = { ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ShiftLeft: 'run', ShiftRight: 'run' };
export function createController(world, o = {}) {
  const B = world.bounds, R_CAP = o.radius ?? 0.22, GRID = o.grid ?? 0.1, GRID_PAD = o.gridPad ?? 0, stats = o.stats || { minClear: 9 };
  const lastMove = { x: 0, z: 0 };
  const box = (b) => ({ n: b.n, x: b.x, z: b.z, hx: b.hw, hz: b.hd, c: Math.cos(b.ry || 0), s: Math.sin(b.ry || 0) });
  const solids = [...(world.obbs || []).map(box), ...(world.walls || []).map(box), ...(world.circles || []).map((q) => ({ n: q.n, circle: true, x: q.x, z: q.z, r: q.r }))];
  /* signed gap from (x, z) to a solid's surface with the outward normal there (inside: the shortest way out, gap < 0) */
  const gapOf = (q, x, z, out) => {
    if (q.circle) { const dx = x - q.x, dz = z - q.z, d = Math.hypot(dx, dz); out.nx = d > 1e-6 ? dx / d : 1; out.nz = d > 1e-6 ? dz / d : 0; return d - q.r; }
    const dx = x - q.x, dz = z - q.z, lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c, ax = Math.abs(lx) - q.hx, az = Math.abs(lz) - q.hz;
    let nlx, nlz, g;
    if (ax > 0 || az > 0) { const ex = Math.max(ax, 0), ez = Math.max(az, 0); g = Math.hypot(ex, ez); nlx = Math.sign(lx) * ex / g; nlz = Math.sign(lz) * ez / g; }
    else if (ax > az) { g = ax; nlx = Math.sign(lx) || 1; nlz = 0; } else { g = az; nlx = 0; nlz = Math.sign(lz) || 1; }
    out.nx = nlx * q.c + nlz * q.s; out.nz = -nlx * q.s + nlz * q.c; return g;
  };
  const _g = { nx: 0, nz: 0 };
  const dist2 = (s, x, z) => Math.max(0, gapOf(s, x, z, _g));
  const clearance = (x, z) => { let m = 9; for (const s of solids) m = Math.min(m, gapOf(s, x, z, _g)); return m - R_CAP; };
  const hit = (x, z, r = R_CAP) => { if (x < B.X0 + r || x > B.X1 - r || z < B.Z0 + r || z > B.Z1 - r) return true; for (const s of solids) if (gapOf(s, x, z, _g) < r) return true; return false; };
  const free = (x, z) => !hit(x, z, R_CAP + 0.01);
  /* push (x, z) out of every solid and the room bounds (up to 4 passes for corners); returns the new spot and whether it was touched */
  function resolve(x, z, r = R_CAP) {
    let touched = false;
    for (let it = 0; it < 4; it++) {
      let any = false;
      for (const s of solids) { const g = gapOf(s, x, z, _g); if (g < r - 1e-5) { const k = r - g + 1e-4; x += _g.nx * k; z += _g.nz * k; any = true; } }
      const cx = Math.min(B.X1 - r, Math.max(B.X0 + r, x)), cz = Math.min(B.Z1 - r, Math.max(B.Z0 + r, z)); if (cx !== x || cz !== z) { x = cx; z = cz; any = true; }
      if (!any) break; touched = true;
    }
    return { x, z, touched, ok: !hit(x, z, r - 2e-3) };
  }
  function nearestFree(x, z, maxR = 2.5) {
    if (free(x, z)) return { x, z };
    for (let r = 0.05; r <= maxR; r += 0.05) for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (free(px, pz)) return { x: px, z: pz }; }
    return { x, z };
  }
  const nx = Math.round((B.X1 - B.X0) / GRID), nz = Math.round((B.Z1 - B.Z0) / GRID), blocked = new Uint8Array(nx * nz);
  const cellOf = (x, z) => [Math.min(nx - 1, Math.max(0, Math.floor((x - B.X0) / GRID))), Math.min(nz - 1, Math.max(0, Math.floor((z - B.Z0) / GRID)))];
  const centre = (i, j) => [B.X0 + (i + 0.5) * GRID, B.Z0 + (j + 0.5) * GRID];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const [x, z] = centre(i, j); blocked[i * nz + j] = hit(x, z, R_CAP + GRID_PAD) ? 1 : 0; }
  const lineClear = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.04); for (let k = 0; k <= n; k++) { const t = n ? k / n : 0; if (hit(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, R_CAP + 0.01)) return false; } return true; };
  function astar(sx, sz, tx, tz) {
    const near = (x, z) => { let [i, j] = cellOf(x, z); if (!blocked[i * nz + j]) return [i, j]; let best = null, bd = 1e9; for (let a = -12; a <= 12; a++) for (let b = -12; b <= 12; b++) { const p = i + a, q = j + b; if (p < 0 || q < 0 || p >= nx || q >= nz || blocked[p * nz + q]) continue; const d = a * a + b * b; if (d < bd) { bd = d; best = [p, q]; } } return best; };
    const s = near(sx, sz), t = near(tx, tz); if (!s || !t) return null;
    const idx = (i, j) => i * nz + j, g = new Float32Array(nx * nz).fill(1e9), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
    const h = (i, j) => Math.hypot(i - t[0], j - t[1]), heap = [[h(s[0], s[1]), s[0], s[1]]];
    const push = (e) => { heap.push(e); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    g[idx(s[0], s[1])] = 0; let found = false;
    while (heap.length) {
      const [, i, j] = pop(), id = idx(i, j); if (closed[id]) continue; closed[id] = 1;
      if (i === t[0] && j === t[1]) { found = true; break; }
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue; const p = i + a, q = j + b; if (p < 0 || q < 0 || p >= nx || q >= nz || blocked[idx(p, q)]) continue;
        if (a && b && (blocked[idx(i + a, j)] || blocked[idx(i, j + b)])) continue;
        const ng = g[id] + Math.hypot(a, b); if (ng < g[idx(p, q)]) { g[idx(p, q)] = ng; from[idx(p, q)] = id; push([ng + h(p, q), p, q]); }
      }
    }
    if (!found) return null;
    const cells = []; for (let id = idx(t[0], t[1]); id >= 0; id = from[id]) cells.push([Math.floor(id / nz), id % nz]);
    cells.reverse(); let pts = cells.map(([i, j]) => centre(i, j)); pts[0] = [sx, sz];
    if (free(tx, tz) && lineClear(pts[pts.length - 1], [tx, tz])) pts.push([tx, tz]);
    const out = [pts[0]]; let a = 0;                                                  // string-pulling: the longest clear segment from each kept point
    while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !lineClear(pts[a], pts[b])) b--; out.push(pts[b]); a = b; }
    return out;
  }

  /* One step of the wanted displacement: slide (push out along the contact normal, keeping the tangent), up to 4 corner passes; if the wanted way is blocked
   * but a way within +-35 deg is open, steer that way (remembering the side so it never flips). Returns the distance actually moved. */
  let steerSide = 1, ejectT = 0;
  function moveBy(pos, dx, dz) {
    const L = Math.hypot(dx, dz); if (L < 1e-9) return 0;
    let r = resolve(pos.x + dx, pos.z + dz);
    if (!r.ok) r = { x: pos.x, z: pos.z };
    else if (r.touched) {
      const prog = ((r.x - pos.x) * dx + (r.z - pos.z) * dz) / (L * L);
      if (prog < 0.6) steer: for (const a of [8, 16, 24, 35]) for (const sg of [steerSide, -steerSide]) {
        const ang = a * D2R * sg, c = Math.cos(ang), sn = Math.sin(ang), qx = pos.x + dx * c - dz * sn, qz = pos.z + dx * sn + dz * c;
        if (!hit(qx, qz)) { r = { x: qx, z: qz }; steerSide = sg; break steer; }
      }
    }
    const m = Math.hypot(r.x - pos.x, r.z - pos.z); lastMove.x = r.x - pos.x; lastMove.z = r.z - pos.z;
    pos.x = r.x; pos.z = r.z; stats.minClear = Math.min(stats.minClear, clearance(r.x, r.z)); return m;
  }
  /* never stuck: if he is inside a solid (an activity ended, a teleport, a layout change) ease him out along the shortest way within 0.25 s */
  function unstick(pos, dt, grounded = true) {
    if (!grounded) { ejectT = 0; return false; }
    const r = resolve(pos.x, pos.z); if (!r.touched) { ejectT = 0; return false; }
    if (!r.ok) { const f = nearestFree(pos.x, pos.z); r.x = f.x; r.z = f.z; }
    ejectT = ejectT > 0 ? ejectT : 0.25; const k = Math.min(1, dt / Math.max(ejectT, dt)); ejectT = Math.max(0, ejectT - dt);
    pos.x += (r.x - pos.x) * k; pos.z += (r.z - pos.z) * k; stats.ejected = (stats.ejected || 0) + 1; return true;
  }
  return { solids, grid: { nx, nz, blocked }, stats, lastMove, radius: R_CAP, gap: (q, x, z, out) => gapOf(q, x, z, out), clearance, hit, free, resolve, nearestFree, astar, moveBy, unstick, resetEject() { ejectT = 0; }, bounds: B };
}
