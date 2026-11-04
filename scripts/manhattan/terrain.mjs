// Ground heightfield for Manhattan, built from the per-building ground elevations of the footprint dataset
// (NAVD88, converted to metres) and rasterised over the land polygon.  File "MTRN" v1 (little-endian):
//   0 char[4] 'MTRN'  4 u16 version(=1)  6 u16 reserved  8 f32 cell (m)  12 f32 originX  16 f32 originZ (corner of cell [0,0])
//   20 u32 nx  24 u32 nz  28 f32 unit (m per int16 step = 0.1)  32 i16[nx*nz] row-major (z rows, x columns), -32768 = water / off-island
export const CELL = 25;
export const UNIT = 0.1;

export function buildTerrain(rawLand, buildings, bounds) {
  const pad = 150;
  const ox = Math.floor((bounds[0] - pad) / CELL) * CELL, oz = Math.floor((bounds[1] - pad) / CELL) * CELL;
  const nx = Math.ceil((bounds[2] + pad - ox) / CELL), nz = Math.ceil((bounds[3] + pad - oz) / CELL);
  const land = new Uint8Array(nx * nz);
  // scanline fill, even-odd over every ring of every land polygon
  for (let r = 0; r < nz; r++) {
    const z = oz + (r + 0.5) * CELL;
    const xs = [];
    for (const poly of rawLand) for (const ring of poly) {
      for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - ox) / CELL - 0.5)), c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - ox) / CELL - 0.5));
      for (let c = c0; c <= c1; c++) land[r * nx + c] = 1;
    }
  }
  const sum = new Float64Array(nx * nz), cnt = new Float32Array(nx * nz);
  for (const b of buildings) {
    const c = Math.floor((b.cx - ox) / CELL), r = Math.floor((b.cz - oz) / CELL);
    if (c < 0 || r < 0 || c >= nx || r >= nz) continue;
    const w = Math.min(4, 1 + b.area / 400);
    sum[r * nx + c] += b.gm * w; cnt[r * nx + c] += w;
  }
  const h = new Float32Array(nx * nz); const have = new Uint8Array(nx * nz);
  for (let i = 0; i < h.length; i++) if (land[i] && cnt[i] > 0) { h[i] = sum[i] / cnt[i]; have[i] = 1; }
  // grow into land cells without samples (parks, plazas, piers) from filled 8-neighbours
  let remaining = 1;
  for (let it = 0; it < 400 && remaining; it++) {
    remaining = 0;
    const add = [];
    for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c;
      if (!land[i] || have[i]) continue;
      let s = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= nz || cc >= nx) continue;
        const j = rr * nx + cc;
        if (have[j]) { s += h[j]; n++; }
      }
      if (n) add.push([i, s / n]); else remaining++;
    }
    for (const [i, v] of add) { h[i] = v; have[i] = 1; }
  }
  // two light blur passes over land cells (the source is quantised to whole feet and building-biased)
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(h);
    for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
      const i = r * nx + c;
      if (!land[i]) continue;
      let s = h[i] * 2, n = 2;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= nz || cc >= nx) continue;
        const j = rr * nx + cc;
        if (land[j]) { s += h[j]; n++; }
      }
      out[i] = s / n;
    }
    h.set(out);
  }
  const buf = Buffer.alloc(32 + nx * nz * 2);
  buf.write('MTRN', 0, 'ascii'); buf.writeUInt16LE(1, 4);
  buf.writeFloatLE(CELL, 8); buf.writeFloatLE(ox, 12); buf.writeFloatLE(oz, 16);
  buf.writeUInt32LE(nx, 20); buf.writeUInt32LE(nz, 24); buf.writeFloatLE(UNIT, 28);
  let landCells = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < nx * nz; i++) {
    if (!land[i]) { buf.writeInt16LE(-32768, 32 + 2 * i); continue; }
    landCells++;
    const v = Math.max(-300, Math.min(3000, Math.round(h[i] / UNIT)));
    buf.writeInt16LE(v, 32 + 2 * i);
    if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i];
  }
  const sample = (x, z) => {
    const fx = (x - ox) / CELL - 0.5, fz = (z - oz) / CELL - 0.5;
    const c0 = Math.max(0, Math.min(nx - 2, Math.floor(fx))), r0 = Math.max(0, Math.min(nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - c0)), tz = Math.max(0, Math.min(1, fz - r0));
    let s = 0, w = 0;
    for (const [dc, dr, ww] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]]) {
      const i = (r0 + dr) * nx + c0 + dc;
      if (land[i]) { s += h[i] * ww; w += ww; }
    }
    return w > 0 ? s / w : 0;
  };
  return { buf, sample, info: { cell: CELL, originX: ox, originZ: oz, nx, nz, unit: UNIT, landCells, minY: Math.round(lo * 10) / 10, maxY: Math.round(hi * 10) / 10 } };
}
