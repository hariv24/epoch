// Binary tile writer.  Format "MNTL" v2 (little-endian).  Documented for renderer authors in docs/MANHATTAN-DATA.md.
//
// A tile is one square (TILE m) of the island, one file per LOD.  It holds *positions and indices only*: no
// normals and no per-vertex building id, because the mesh is built with shared vertices (see mesh.mjs) and is
// meant to be shaded flat (derivative normals in the shader, or `flatShading`).  The per-building table gives
// each building's vertex / index range so the renderer can derive any per-building attribute at load time.
//
//  header (64 bytes)
//    0  char[4] 'MNTL'
//    4  u16 version (=2)   6  u16 lod
//    8  i32 tileX         12  i32 tileZ
//   16  f32 originX       20  f32 originZ         tile corner in local metres (tileX*TILE, tileZ*TILE)
//   24  f32 posScale      28  f32 pad              position step (m) and horizontal pad (m)
//   32  f32 yScale        36  f32 yOffset
//   40  u32 nVerts        44  u32 nIndices   48 u32 nBuildings   52 u32 nChunks
//   56  u32 chunkTableOffset                 60  u32 buildingTableOffset
//  sections (each padded to 4 bytes):
//    positions  u16 x3 per vertex :  x = originX - pad + q*posScale ;  y = yOffset + q*yScale ;  z = originZ - pad + q*posScale
//    indices    u16 per index     :  triangle list (counter-clockwise = front face), RELATIVE to its chunk's first vertex
//    chunks     16 bytes each     :  u32 vFirst, u32 vCount, u32 iFirst, u32 iCount   (vFirst/iFirst are tile-global offsets;
//                                    every chunk has <= 65535 vertices so indices fit in u16; draw one mesh per chunk)
//    buildings  40 bytes each     :
//        0 u32 bin (0 for merged LOD2 masses)    4 f32 baseY (ground, m)     8 f32 height (m above baseY to the highest roof)
//       12 u32 iFirst   16 u32 iCount  (tile-global index range, in indices)  20 u32 vFirst  24 u32 vCount (tile-global)
//       28 i16 cx   30 i16 cz   centroid in 0.1 m units relative to the tile origin
//       32 u16 year (0 = unknown)   34 u8 style (STYLES in buildings.mjs)   35 u8 flags (FLAGS in buildings.mjs)
//       36 u8 floors   37 u8 seed (hash of bin)   38 u16 chunk index
export const TILE = 1500;
export const POS_SCALE = 0.05;
export const PAD = 100;
export const Y_SCALE = 0.05;
export const Y_OFFSET = -10;
export const MAX_CHUNK_VERTS = 65000;
export const BUILDING_REC = 40;

const q = (v, o, s) => Math.max(0, Math.min(65535, Math.round((v - o) / s)));

/** table[i] needs vFirst/vCount (indices into mesh.pos) and first/count (indices into mesh.idx). */
export function packTile({ lod, tx, tz, mesh, table }) {
  const nv = mesh.nv, ni = mesh.ni, nb = table.length;
  // ---- chunking: consecutive buildings, vertex budget per chunk
  const chunks = [];
  let cur = null;
  const chunkOf = new Uint16Array(nb);
  for (let b = 0; b < nb; b++) {
    const t = table[b];
    if (t.vCount > MAX_CHUNK_VERTS) throw new Error('building with >65000 vertices: bin ' + t.bin);
    if (!cur || cur.vCount + t.vCount > MAX_CHUNK_VERTS) {
      cur = { vFirst: t.vFirst, vCount: 0, iFirst: t.first, iCount: 0 };
      chunks.push(cur);
    }
    cur.vCount = t.vFirst + t.vCount - cur.vFirst;
    cur.iCount = t.first + t.count - cur.iFirst;
    chunkOf[b] = chunks.length - 1;
  }
  const pad4 = (n) => (n + 3) & ~3;
  const posBytes = pad4(nv * 6), idxBytes = pad4(ni * 2);
  const chunkOff = 64 + posBytes + idxBytes;
  const bOff = chunkOff + chunks.length * 16;
  const total = bOff + nb * BUILDING_REC;
  const buf = Buffer.alloc(total);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  buf.write('MNTL', 0, 'ascii');
  dv.setUint16(4, 2, true); dv.setUint16(6, lod, true);
  dv.setInt32(8, tx, true); dv.setInt32(12, tz, true);
  const ox = tx * TILE, oz = tz * TILE;
  dv.setFloat32(16, ox, true); dv.setFloat32(20, oz, true);
  dv.setFloat32(24, POS_SCALE, true); dv.setFloat32(28, PAD, true);
  dv.setFloat32(32, Y_SCALE, true); dv.setFloat32(36, Y_OFFSET, true);
  dv.setUint32(40, nv, true); dv.setUint32(44, ni, true); dv.setUint32(48, nb, true); dv.setUint32(52, chunks.length, true);
  dv.setUint32(56, chunkOff, true); dv.setUint32(60, bOff, true);
  let o = 64;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = mesh.pos[3 * i], y = mesh.pos[3 * i + 1], z = mesh.pos[3 * i + 2];
    dv.setUint16(o + 6 * i, q(x, ox - PAD, POS_SCALE), true);
    dv.setUint16(o + 6 * i + 2, q(y, Y_OFFSET, Y_SCALE), true);
    dv.setUint16(o + 6 * i + 4, q(z, oz - PAD, POS_SCALE), true);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  o += posBytes;
  for (const c of chunks) {
    for (let i = c.iFirst; i < c.iFirst + c.iCount; i++) dv.setUint16(o + 2 * i, mesh.idx[i] - c.vFirst, true);
  }
  o += idxBytes;
  for (let c = 0; c < chunks.length; c++) {
    const p = chunkOff + 16 * c;
    dv.setUint32(p, chunks[c].vFirst, true); dv.setUint32(p + 4, chunks[c].vCount, true);
    dv.setUint32(p + 8, chunks[c].iFirst, true); dv.setUint32(p + 12, chunks[c].iCount, true);
  }
  for (let i = 0; i < nb; i++) {
    const t = table[i], p = bOff + BUILDING_REC * i;
    dv.setUint32(p, t.bin >>> 0, true); dv.setFloat32(p + 4, t.baseY, true); dv.setFloat32(p + 8, t.h, true);
    dv.setUint32(p + 12, t.first, true); dv.setUint32(p + 16, t.count, true);
    dv.setUint32(p + 20, t.vFirst, true); dv.setUint32(p + 24, t.vCount, true);
    dv.setInt16(p + 28, Math.max(-32768, Math.min(32767, Math.round((t.cx - ox) * 10))), true);
    dv.setInt16(p + 30, Math.max(-32768, Math.min(32767, Math.round((t.cz - oz) * 10))), true);
    dv.setUint16(p + 32, t.year & 0xffff, true);
    buf[p + 34] = t.style; buf[p + 35] = t.flags; buf[p + 36] = Math.min(255, t.floors);
    buf[p + 37] = (Math.imul(t.bin | 0, 2654435761) >>> 24) & 255;
    dv.setUint16(p + 38, chunkOf[i], true);
  }
  return { buf, nv, ni, nb, nChunks: chunks.length, bounds: [x0, y0, z0, x1, y1, z1] };
}

/** Parse a tile back (used by the self-test and as a reference decoder for the renderer). */
export function unpackTile(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'MNTL') throw new Error('bad magic');
  const h = {
    version: dv.getUint16(4, true), lod: dv.getUint16(6, true), tx: dv.getInt32(8, true), tz: dv.getInt32(12, true),
    ox: dv.getFloat32(16, true), oz: dv.getFloat32(20, true), ps: dv.getFloat32(24, true), pad: dv.getFloat32(28, true),
    ys: dv.getFloat32(32, true), yo: dv.getFloat32(36, true), nv: dv.getUint32(40, true), ni: dv.getUint32(44, true),
    nb: dv.getUint32(48, true), nc: dv.getUint32(52, true), chunkOff: dv.getUint32(56, true), bOff: dv.getUint32(60, true),
  };
  const pad4 = (n) => (n + 3) & ~3;
  let o = 64;
  const pos = new Float32Array(h.nv * 3);
  for (let i = 0; i < h.nv; i++) {
    pos[3 * i] = h.ox - h.pad + dv.getUint16(o + 6 * i, true) * h.ps;
    pos[3 * i + 1] = h.yo + dv.getUint16(o + 6 * i + 2, true) * h.ys;
    pos[3 * i + 2] = h.oz - h.pad + dv.getUint16(o + 6 * i + 4, true) * h.ps;
  }
  o += pad4(h.nv * 6);
  const idx = new Uint16Array(h.ni); for (let i = 0; i < h.ni; i++) idx[i] = dv.getUint16(o + 2 * i, true);
  const chunks = [];
  for (let c = 0; c < h.nc; c++) {
    const p = h.chunkOff + 16 * c;
    chunks.push({ vFirst: dv.getUint32(p, true), vCount: dv.getUint32(p + 4, true), iFirst: dv.getUint32(p + 8, true), iCount: dv.getUint32(p + 12, true) });
  }
  const table = [];
  for (let i = 0; i < h.nb; i++) {
    const p = h.bOff + BUILDING_REC * i;
    table.push({
      bin: dv.getUint32(p, true), baseY: dv.getFloat32(p + 4, true), h: dv.getFloat32(p + 8, true),
      first: dv.getUint32(p + 12, true), count: dv.getUint32(p + 16, true), vFirst: dv.getUint32(p + 20, true), vCount: dv.getUint32(p + 24, true),
      cx: h.ox + dv.getInt16(p + 28, true) / 10, cz: h.oz + dv.getInt16(p + 30, true) / 10, year: dv.getUint16(p + 32, true),
      style: buf[p + 34], flags: buf[p + 35], floors: buf[p + 36], seed: buf[p + 37], chunk: dv.getUint16(p + 38, true),
    });
  }
  return { h, pos, idx, chunks, table };
}
