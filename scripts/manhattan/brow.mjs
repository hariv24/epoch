// Billionaires' Row: the supertall corridor along W 57th St / Central Park South, as data the 3D city can use.
//
//   node scripts/manhattan/brow.mjs        (needs the tiles from build_manhattan.mjs; run it again after every tile rebuild)
//
// Writes epoch/web/static/app/city/manhattan/brow.json:
//   region  the corridor as a grid-aligned rectangle (8th Avenue to Park Avenue, W 56th St to Central Park South), in the same
//           metre frame as every other layer (x east, z south). The renderer keeps it in soft mist until the last level.
//   towers  every building of 120 m or more inside the region: bin, name, x, z, baseY, heightM, topY and a "band": the outline of
//           the building cut horizontally just under its roof (flat [x0,z0,x1,z1,nx,nz,...] segments, n = outward normal). The
//           renderer builds the penthouse window band and the camera pose outside the facade from it, so the dream home (the BIN
//           in epoch/game.py, DREAM_HOME_BIN) can be any tower listed here with no rebuild.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackTile } from './pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../epoch/web/static/app/city/manhattan');
const GA = (29 * Math.PI) / 180, CA = Math.cos(GA), SA = Math.sin(GA);
const toU = (x, z) => x * CA + z * SA, toV = (x, z) => x * SA - z * CA, fromUV = (u, v) => [u * CA + v * SA, u * SA - v * CA];

// grid extent of the corridor (u across the avenues from 8th Avenue to Park Avenue, v along them from W 56th to Central Park South)
const U = [-330, 950], V = [735, 1025];
const MIN_H = 120;
const NAMES = {
  1090180: { name: 'Central Park Tower', address: '217 W 57th St' },
  1023728: { name: '111 West 57th Street (Steinway Tower)', address: '111 W 57th St' },
  1088565: { name: 'One57', address: '157 W 57th St' },
  1090184: { name: '220 Central Park South', address: '220 Central Park S' },
  1088817: { name: '432 Park Avenue', address: '432 Park Ave' },
};
const r1 = (v) => Math.round(v * 10) / 10;

/** horizontal cut of one building's wall triangles at height y -> [x0,z0,x1,z1,nx,nz, ...] (n = outward unit normal) */
function sliceBuilding(d, b, y) {
  const c = d.chunks[b.chunk], out = [], seen = new Set();
  const P = (i) => [d.pos[3 * (c.vFirst + d.idx[i]) ], d.pos[3 * (c.vFirst + d.idx[i]) + 1], d.pos[3 * (c.vFirst + d.idx[i]) + 2]];
  for (let i = b.first; i < b.first + b.count; i += 3) {
    const a = P(i), bb = P(i + 1), cc = P(i + 2);
    const ymin = Math.min(a[1], bb[1], cc[1]), ymax = Math.max(a[1], bb[1], cc[1]);
    if (!(ymin < y && ymax > y)) continue;
    // face normal (counter-clockwise = front), keep walls only
    const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
    if (Math.abs(ny / nl) > 0.3) continue;
    const pts = [];
    for (const [p, q] of [[a, bb], [bb, cc], [cc, a]]) {
      if ((p[1] < y) !== (q[1] < y)) { const t = (y - p[1]) / (q[1] - p[1]); pts.push([p[0] + (q[0] - p[0]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    if (pts.length !== 2) continue;
    const hl = Math.hypot(nx, nz) || 1, key = [r1(pts[0][0]), r1(pts[0][1]), r1(pts[1][0]), r1(pts[1][1])].join(',');
    if (seen.has(key)) continue; seen.add(key);
    if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 0.05) continue;
    out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1], nx / hl, nz / hl]);
  }
  return out;
}
const length = (segs) => segs.reduce((s, q) => s + Math.hypot(q[2] - q[0], q[3] - q[1]), 0);

/** merge collinear neighbours (a wall quad cuts into two triangles) so the band has one quad per facade */
function merge(segs) {
  const res = [];
  const used = new Array(segs.length).fill(false);
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    let [x0, z0, x1, z1, nx, nz] = segs[i]; used[i] = true;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const s = segs[j];
        if (Math.abs(s[4] - nx) > 0.02 || Math.abs(s[5] - nz) > 0.02) continue;
        const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
        const off = (px, pz) => Math.abs(((px - x0) * dz - (pz - z0) * dx) / L);
        if (off(s[0], s[1]) > 0.08 || off(s[2], s[3]) > 0.08) continue;
        const ts = [0, L, ((s[0] - x0) * dx + (s[1] - z0) * dz) / L, ((s[2] - x0) * dx + (s[3] - z0) * dz) / L];
        const lo = Math.min(...ts), hi = Math.max(...ts);
        // touching or overlapping?
        if (!(Math.min(ts[2], ts[3]) <= L + 0.08 && Math.max(ts[2], ts[3]) >= -0.08)) continue;
        const ax = x0 + (dx / L) * lo, az = z0 + (dz / L) * lo, bx = x0 + (dx / L) * hi, bz = z0 + (dz / L) * hi;
        x0 = ax; z0 = az; x1 = bx; z1 = bz; used[j] = true; grew = true;
      }
    }
    res.push([x0, z0, x1, z1, nx, nz]);
  }
  return res;
}

export function buildBrow() {
  const man = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  const towers = [];
  for (const t of man.tiles) {
    const e = t.lods?.[0]; if (!e) continue;
    const d = unpackTile(fs.readFileSync(path.join(OUT, e.file)));
    for (const b of d.table) {
      if (b.h < MIN_H) continue;
      const u = toU(b.cx, b.cz), v = toV(b.cx, b.cz);
      if (u < U[0] || u > U[1] || v < V[0] || v > V[1]) continue;
      const topY = b.baseY + b.h;
      // choose the cut: a few floors under the roof, where the outline is the same just above and just below
      let best = null;
      const base = Math.min(40, Math.max(14, b.h * 0.1));
      for (const k of [1, 0.85, 1.2, 0.7, 1.45, 1.8, 2.2, 2.7]) {
        const y = topY - base * k, a = sliceBuilding(d, b, y), lo = length(sliceBuilding(d, b, y - 6)), hi = length(sliceBuilding(d, b, y + 6)), me = length(a);
        if (!a.length) continue;
        const stable = Math.abs(lo - me) / me < 0.04 && Math.abs(hi - me) / me < 0.04;
        if (stable) { best = { y, segs: a }; break; }
        if (!best) best = { y, segs: a, loose: true };
      }
      const info = NAMES[b.bin] || {};
      towers.push({
        bin: b.bin, name: info.name || null, address: info.address || null, x: r1(b.cx), z: r1(b.cz), baseY: r1(b.baseY), heightM: r1(b.h), topY: r1(topY),
        floors: b.floors, year: b.year,
        band: best ? { y: r1(best.y), stable: !best.loose, seg: merge(best.segs).flatMap((q) => [r1(q[0]), r1(q[1]), r1(q[2]), r1(q[3]), Math.round(q[4] * 100) / 100, Math.round(q[5] * 100) / 100]) } : null,
      });
    }
  }
  towers.sort((a, b) => b.topY - a.topY);
  const corners = [[U[0], V[0]], [U[1], V[0]], [U[1], V[1]], [U[0], V[1]]].map(([u, v]) => fromUV(u, v));
  const json = {
    version: 1,
    note: "Billionaires' Row: W 57th St / Central Park South. See scripts/manhattan/brow.mjs.",
    region: { id: 'BROW', name: "Billionaires' Row", u: U, v: V, poly: corners.flatMap(([x, z]) => [r1(x), r1(z)]), centre: fromUV((U[0] + U[1]) / 2, (V[0] + V[1]) / 2).map(r1) },
    towers,
  };
  fs.writeFileSync(path.join(OUT, 'brow.json'), JSON.stringify(json));
  return json;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const j = buildBrow();
  console.log(`[brow] ${j.towers.length} towers >= ${MIN_H} m in the corridor; ${fs.statSync(path.join(OUT, 'brow.json')).size} bytes`);
  for (const t of j.towers.slice(0, 8)) console.log(`  ${t.bin}  ${String(t.name || '').padEnd(40)} top ${t.topY} m  band ${t.band ? `y=${t.band.y} ${t.band.seg.length / 6} facades${t.band.stable ? '' : ' (loose)'}` : 'none'}`);
}
