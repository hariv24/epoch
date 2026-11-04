// Renderer-side extras for the real-Manhattan City view, built once from the generated tiles plus two more NYC Open
// Data tables. Build time only; the app reads the results offline.
//
//   node scripts/manhattan/props.mjs [--refresh]      (run after scripts/build_manhattan.mjs)
//
// Writes into epoch/web/static/app/city/manhattan/:
//   hydro.json   inland water (Central Park Reservoir, The Lake, Harlem Meer ...), see hydro.mjs
//   heights.bin  'MHGT' v1: the highest roof per 20 m cell (camera collision: the free camera never enters a building)
//                0 'MHGT' 4 u16 version 8 f32 cell 12 f32 originX 16 f32 originZ 20 u32 nx 24 u32 nz 28 f32 unit(0.1 m) 32 i16[nx*nz]
//                (absolute height above sea level in 0.1 m, -32768 = no building)
//   trees.bin    'MTRE' v1: about 4 in 10 living street trees of the 2015 Street Tree Census, moved behind the kerb (NYC Parks, `uvpi-gqnh`, real
//                positions) plus park trees scattered over the Parks Properties polygons, kept off buildings, roads, paths and
//                water and thinned on the big Central Park lawns.
//                0 'MTRE' 4 u16 version 8 u32 count 12 u32 streetCount  16.. records of 8 B:
//                i16 x (0.5 m), i16 z (0.5 m), i16 y (0.1 m, ground), u8 size (0.1 m crown radius), u8 kind (0 park, 1 street, 2 woods)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached } from './fetch.mjs';
import { lonLatToXZ, pointInPoly } from './geo.mjs';
import { unpackTile } from './pack.mjs';
import { buildHydro } from './hydro.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(ROOT, 'build/manhattan-raw');
const OUT = path.join(ROOT, 'epoch/web/static/app/city/manhattan');
const REFRESH = process.argv.includes('--refresh');
const t0 = Date.now();
const lap = (m) => console.log(`[props] ${m} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const ring2 = (flat) => { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); return r; };
const manifest = J('manifest.json');
const hydro = await buildHydro({ refresh: REFRESH });
lap(`hydro: ${hydro.lakes.length} inland water bodies`);

// ------------------------------------------------------------------ terrain sampler
const tb = fs.readFileSync(path.join(OUT, 'terrain.bin'));
const tdv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
const T = { cell: tdv.getFloat32(8, true), ox: tdv.getFloat32(12, true), oz: tdv.getFloat32(16, true), nx: tdv.getUint32(20, true), nz: tdv.getUint32(24, true), unit: tdv.getFloat32(28, true) };
const tv = (c, r) => { c = Math.max(0, Math.min(T.nx - 1, c)); r = Math.max(0, Math.min(T.nz - 1, r)); const v = tdv.getInt16(32 + 2 * (r * T.nx + c), true); return v === -32768 ? null : v * T.unit; };
function ground(x, z) {
  const fx = (x - T.ox) / T.cell - 0.5, fz = (z - T.oz) / T.cell - 0.5, c = Math.floor(fx), r = Math.floor(fz), a = fx - c, b = fz - r;
  let s = 0, w = 0;
  for (const [dc, dr, k] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) { const v = tv(c + dc, r + dr); if (v != null) { s += v * k; w += k; } }
  return w > 0 ? s / w : 1;
}

// ------------------------------------------------------------------ buildings: roof heights (20 m) and a 4 m occupancy mask
const [bx0, , bz0, bx1, , bz1] = manifest.frame.bounds3d;
const HC = 20, hox = Math.floor((bx0 - 200) / HC) * HC, hoz = Math.floor((bz0 - 200) / HC) * HC;
const hnx = Math.ceil((bx1 + 200 - hox) / HC), hnz = Math.ceil((bz1 + 200 - hoz) / HC);
const roof = new Float32Array(hnx * hnz).fill(-1e9);
const OC = 4, onx = Math.ceil((bx1 + 200 - hox) / OC), onz = Math.ceil((bz1 + 200 - hoz) / OC);
const occ = new Uint8Array(onx * onz);
function rasterTri(ax, az, bx, bz, cx, cz, cell, nx, nz, fn) {
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - hox) / cell)), x1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - hox) / cell));
  const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - hoz) / cell)), z1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - hoz) / cell));
  const d = (bx - ax) * (cz - az) - (bz - az) * (cx - ax); if (Math.abs(d) < 1e-6) { fn(x0, z0); return; }
  for (let r = z0; r <= z1; r++) for (let c = x0; c <= x1; c++) {
    // a cell counts when its centre or any corner of the triangle's bbox overlap test passes (conservative for small cells)
    const px = hox + (c + 0.5) * cell, pz = hoz + (r + 0.5) * cell;
    const w0 = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / d, w1 = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / d, w2 = 1 - w0 - w1;
    if ((w0 >= -0.05 && w1 >= -0.05 && w2 >= -0.05) || (x0 === x1 && z0 === z1)) fn(c, r);
  }
}
function addTile(buf, roofs = true) {   // roofs = false: only the occupancy mask (the cleared home lots: pads and towers, no roof to collide with)
  const t = unpackTile(buf);
  const P = t.pos;
  for (const ch of t.chunks) {
    for (let i = 0; i < ch.iCount; i += 3) {
      const a = ch.vFirst + t.idx[ch.iFirst + i], b = ch.vFirst + t.idx[ch.iFirst + i + 1], c = ch.vFirst + t.idx[ch.iFirst + i + 2];
      const ay = P[3 * a + 1], by = P[3 * b + 1], cy = P[3 * c + 1], top = Math.max(ay, by, cy);
      if (roofs) rasterTri(P[3 * a], P[3 * a + 2], P[3 * b], P[3 * b + 2], P[3 * c], P[3 * c + 2], HC, hnx, hnz, (cc, rr) => { const k = rr * hnx + cc; if (roof[k] < top) roof[k] = top; });
      // roofs (near-flat triangles) mark the footprint in the occupancy mask
      if (Math.max(ay, by, cy) - Math.min(ay, by, cy) < 0.6) rasterTri(P[3 * a], P[3 * a + 2], P[3 * b], P[3 * b + 2], P[3 * c], P[3 * c + 2], OC, onx, onz, (cc, rr) => { occ[rr * onx + cc] = 1; });
    }
  }
  return t.table.length;
}
let nb = 0;
for (const tile of manifest.tiles) { const e = tile.lods[0] || tile.lods[1] || tile.lods[2]; nb += addTile(fs.readFileSync(path.join(OUT, e.file))); }
nb += addTile(fs.readFileSync(path.join(OUT, manifest.files.homeBuildings)), false);
{
  const hb = Buffer.alloc(32 + 2 * hnx * hnz), dv = new DataView(hb.buffer);
  hb.write('MHGT', 0, 'ascii'); dv.setUint16(4, 1, true); dv.setFloat32(8, HC, true); dv.setFloat32(12, hox, true); dv.setFloat32(16, hoz, true);
  dv.setUint32(20, hnx, true); dv.setUint32(24, hnz, true); dv.setFloat32(28, 0.1, true);
  for (let i = 0; i < roof.length; i++) dv.setInt16(32 + 2 * i, roof[i] < -1e8 ? -32768 : Math.min(32767, Math.round(roof[i] * 10)), true);
  fs.writeFileSync(path.join(OUT, 'heights.bin'), hb);
  lap(`heights.bin: ${hnx}x${hnz} cells of ${HC} m from ${nb} buildings, ${(hb.length / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------------ roads and paths into the occupancy mask (trees stay off them)
const streets = J('streets.json');
function stampLine(p, halfW, val) {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (OC * 0.5)));
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n, rr = Math.ceil(halfW / OC);
      const c0 = Math.floor((x - hox) / OC), r0 = Math.floor((z - hoz) / OC);
      for (let dr = -rr; dr <= rr; dr++) for (let dc = -rr; dc <= rr; dc++) {
        const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= onx || r >= onz) continue;
        if (Math.hypot(hox + (c + 0.5) * OC - x, hoz + (r + 0.5) * OC - z) <= halfW + OC * 0.5) occ[r * onx + c] |= val;
      }
    }
  }
}
for (const l of streets.lines) { if (l.c === 3) continue; stampLine(l.p, l.c === 4 ? 2.2 : Math.max(4, l.w / 2 + 0.5), 2); }
const occAt = (x, z) => { const c = Math.floor((x - hox) / OC), r = Math.floor((z - hoz) / OC); return c < 0 || r < 0 || c >= onx || r >= onz ? 0 : occ[r * onx + c]; };
const nearBuilding = (x, z) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (occAt(x + dc * OC, z + dr * OC) & 1) return true; return false; };

// ------------------------------------------------------------------ street trees (real positions)
const rows = await cached(RAW, { id: 'street_trees', dataset: 'uvpi-gqnh', select: 'tree_id,latitude,longitude,tree_dbh', where: "boroname='Manhattan' AND status='Alive'", page: 20000 }, REFRESH);
// Census points sit in tree pits just behind the kerb, but the census and the street centrelines disagree by a few metres,
// so many points landed on the painted carriageway ("trees in the middle of the road"). Each street tree is pushed out to
// CURB_SET metres behind the kerb of any road it stands on (the same widths mh_ground.js paints), and dropped when that spot
// is inside a building or it can't get off the road (an intersection).
const CURB_SET = 1.5, SEG = 40, segGrid = new Map(), STREET_KEEP_TENTHS = 4;
const roadHalfW = (l) => Math.max(6, l.w || (l.c === 1 ? 18 : l.c === 2 ? 14 : 10)) / 2;
for (const l of streets.lines) {
  if (l.c > 2) continue;                                               // bridges are geometry; paths may run under trees
  const hw = roadHalfW(l), pad = hw + CURB_SET + 1;
  for (let i = 0; i + 3 < l.p.length; i += 2) {
    const s = [l.p[i], l.p[i + 1], l.p[i + 2], l.p[i + 3], hw];
    const gx0 = Math.floor((Math.min(s[0], s[2]) - pad) / SEG), gx1 = Math.floor((Math.max(s[0], s[2]) + pad) / SEG);
    const gz0 = Math.floor((Math.min(s[1], s[3]) - pad) / SEG), gz1 = Math.floor((Math.max(s[1], s[3]) + pad) / SEG);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const k = gx + ',' + gz; let a = segGrid.get(k); if (!a) segGrid.set(k, a = []); a.push(s);
    }
  }
}
function curbSpot(x, z, set) {
  for (let pass = 0; pass < 4; pass++) {
    let worst = null;
    for (const [ax, az, bx, bz, hw] of segGrid.get(Math.floor(x / SEG) + ',' + Math.floor(z / SEG)) || []) {
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz), need = hw + set;
      if (d < need && (!worst || need - d > worst.gap)) worst = { gap: need - d, px, pz, d, need, dx, dz };
    }
    if (!worst) return [x, z];
    if (pass === 3) break;
    let nx, nz;
    if (worst.d > 0.05) { nx = (x - worst.px) / worst.d; nz = (z - worst.pz) / worst.d; }
    else { const L = Math.hypot(worst.dx, worst.dz) || 1; nx = -worst.dz / L; nz = worst.dx / L; }
    x = worst.px + nx * worst.need; z = worst.pz + nz * worst.need;
  }
  return null;
}
const trees = [];
let moved = 0, dropped = 0;
for (const r of rows) {
  const lat = +r.latitude, lon = +r.longitude; if (!lat || !lon) continue;
  const [x0, z0] = lonLatToXZ(lon, lat);
  if (occAt(x0, z0) & 1) continue;                                     // a census point inside a footprint (data noise)
  // keep about 4 in 10 street trees (a fixed pick by tree id): drawing all 62k reads greener than Manhattan feels on the ground
  if ((Math.imul(+r.tree_id || 0, 2654435761) >>> 0) % 10 >= STREET_KEEP_TENTHS) continue;
  const fits = (s) => s && !(occAt(s[0], s[1]) & 1);
  let spot = curbSpot(x0, z0, CURB_SET);
  if (!fits(spot)) spot = curbSpot(x0, z0, 0.6);                      // narrow sidewalk: hug the kerb instead
  if (!fits(spot)) { dropped++; continue; }
  const [x, z] = spot; if (x !== x0 || z !== z0) moved++;
  const dbh = Math.max(2, Math.min(40, +r.tree_dbh || 6));            // trunk diameter at breast height, inches
  trees.push([x, z, ground(x, z), Math.min(4, 1.2 + Math.sqrt(dbh) * 0.55), 1]);   // crown radius, m: smaller, so crowns don't blanket the street
}
lap(`street trees: ${moved} moved off the carriageway, ${dropped} dropped (no room behind the kerb)`);
const streetCount = trees.length;
lap(`street trees: ${streetCount} of ${rows.length} census points`);

// ------------------------------------------------------------------ park trees
const parks = J('parks.json');
const lakes = hydro.lakes.map((l) => l.p.map(ring2));
const inLake = (x, z) => lakes.some((p) => pointInPoly(x, z, p));
// the open lawns of Central Park, as rough ellipses (centre lon/lat, semi-axes in metres along/across the grid): fewer trees there
const GA = (29 * Math.PI) / 180;
const LAWNS = [
  [-73.9665, 40.7813, 230, 120],   // Great Lawn
  [-73.9750, 40.7717, 170, 95],    // Sheep Meadow
  [-73.9580, 40.7940, 200, 120],   // North Meadow
  [-73.9560, 40.7898, 60, 55],     // East Meadow
  [-73.9775, 40.7685, 90, 70],     // Heckscher Ballfields
  [-73.9705, 40.7752, 55, 45],     // Cedar Hill
  [-73.9632, 40.7770, 70, 45],     // Great Lawn's east edge / Arthur Ross Pinetum gaps
].map(([lon, lat, a, b]) => { const [x, z] = lonLatToXZ(lon, lat); return { x, z, a, b }; });
const onLawn = (x, z) => LAWNS.some((l) => { const dx = x - l.x, dz = z - l.z, u = dx * Math.cos(GA) + dz * Math.sin(GA), v = dx * Math.sin(GA) - dz * Math.cos(GA); return (u / l.b) ** 2 + (v / l.a) ** 2 < 1; });
// trees per 1,000 m2 by park type (Parks Properties `typecategory`)
const DENS = { 'Flagship Park': 4.6, 'Community Park': 4.0, 'Neighborhood Park': 3.6, 'Nature Area': 9.0, 'Garden': 4.5, 'Parkway': 5.5, 'Strip': 5.5, 'Mall': 6.5,
  'Triangle/Plaza': 2.2, 'Playground': 1.6, 'Jointly Operated Playground': 1.2, 'Recreational Field/Courts': 0.6, 'Waterfront Facility': 1.4, 'Historic House Park': 3.5,
  'Buildings/Institutions': 1.5, 'Undeveloped': 2.5, 'Managed Sites': 1.5 };
let seed = 1234567;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const vnoise = (x, z) => { const s = Math.sin(x * 0.0123 + z * 0.0071) * 0.5 + Math.sin(x * 0.0051 - z * 0.0139 + 1.7) * 0.5; return s; };
let parkCount = 0;
for (const pk of parks.parks) {
  const type = parks.types[pk.t], dens = (DENS[type] ?? 2) / 1000; if (dens <= 0) continue;
  const poly = pk.p.map(ring2);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const s = Math.sqrt(1 / dens);
  const woods = type === 'Nature Area' || /Inwood Hill|Highbridge|Fort Tryon|Morningside Park|Riverside Park|Carl Schurz/.test(pk.n);
  for (let z = z0 + s * rnd(); z < z1; z += s) for (let x = x0 + s * rnd(); x < x1; x += s) {
    const px = x + (rnd() - 0.5) * s * 1.6, pz = z + (rnd() - 0.5) * s * 1.6;
    if (!pointInPoly(px, pz, poly)) continue;
    const o = occAt(px, pz); if (o & 2) continue; if (nearBuilding(px, pz)) continue;
    if (inLake(px, pz)) continue;
    let keep = 0.9 + 0.25 * vnoise(px, pz);                                       // natural groves and gaps
    if (onLawn(px, pz)) keep *= 0.06;
    if (rnd() > keep) continue;
    const big = type === 'Flagship Park' || woods;
    trees.push([px, pz, ground(px, pz), (big ? 3.4 : 2.7) + rnd() * (big ? 2.6 : 1.6), woods ? 2 : 0]);
    parkCount++;
  }
}
lap(`park trees: ${parkCount}`);

{
  const n = trees.length, b = Buffer.alloc(16 + 8 * n), dv = new DataView(b.buffer);
  b.write('MTRE', 0, 'ascii'); dv.setUint16(4, 1, true); dv.setUint32(8, n, true); dv.setUint32(12, streetCount, true);
  const q = (v, k) => Math.max(-32767, Math.min(32767, Math.round(v * k)));
  trees.forEach(([x, z, y, rad, kind], i) => { const o = 16 + 8 * i; dv.setInt16(o, q(x, 2), true); dv.setInt16(o + 2, q(z, 2), true); dv.setInt16(o + 4, q(y, 10), true); b[o + 6] = Math.min(255, Math.round(rad * 10)); b[o + 7] = kind; });
  fs.writeFileSync(path.join(OUT, 'trees.bin'), b);
  lap(`trees.bin: ${n} trees, ${(b.length / 1024).toFixed(0)} KB`);
}
