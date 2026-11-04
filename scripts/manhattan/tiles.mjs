import { MeshBuf, SurfaceIndex, emitSurface, makeSurface, flat } from './mesh.mjs';
import { surfacesFor, lod2Masses, lod1Masses } from './buildings.mjs';
import { TILE } from './pack.mjs';

/**
 * Build the meshes of one LOD for all given buildings.  Returns Map("tx,tz" -> { tx, tz, mesh, table, tris })
 */
export function meshLod(buildings, lod, log = console.log, { fixedTile = null } = {}) {
  let list = buildings;
  let extraMasses = [];
  if (lod === 1) {
    const { kept, merged } = lod1Masses(buildings);
    list = kept; extraMasses = merged;
  } else if (lod === 2) {
    const { towers, merged } = lod2Masses(buildings);
    list = towers; extraMasses = merged;
  }
  const idx = new SurfaceIndex();
  const items = [];
  for (const b of list) {
    const surfs = surfacesFor(b, lod);
    if (!surfs.length) continue;
    for (const s of surfs) idx.add(s);
    items.push({ b, surfs });
  }
  for (const m of extraMasses) {
    const surfs = m.parts.map((p) => makeSurface(p, flat(m.gm + m.hm), -1, {}));
    for (const s of surfs) idx.add(s);
    items.push({ b: m, surfs });
  }
  items.sort((p, q) => p.b.cx - q.b.cx || p.b.cz - q.b.cz);
  const tiles = new Map();
  for (const it of items) {
    const { b, surfs } = it;
    const tx = fixedTile ? fixedTile[0] : Math.floor(b.cx / TILE), tz = fixedTile ? fixedTile[1] : Math.floor(b.cz / TILE);
    const key = tx + ',' + tz;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { tx, tz, mesh: new MeshBuf(), table: [], tris: 0 }));
    const first = t.mesh.ni, vFirst = t.mesh.nv;
    let top = -Infinity;
    for (const s of surfs) {
      emitSurface(t.mesh, idx, s, b.gm);
      if (s.zTop > top) top = s.zTop;
    }
    const count = t.mesh.ni - first;
    t.tris += count / 3;
    t.table.push({ bin: b.bin, baseY: b.gm, h: top - b.gm, first, count, vFirst, vCount: t.mesh.nv - vFirst, cx: b.cx, cz: b.cz, year: b.year || 0, style: b.style, flags: b.flags, floors: b.floors });
  }
  let nb = 0, nt = 0, nv = 0;
  for (const t of tiles.values()) { nb += t.table.length; nt += t.tris; nv += t.mesh.nv; }
  log(`[mesh] LOD${lod}: ${nb} buildings/masses, ${nv} vertices, ${nt} triangles in ${tiles.size} tiles`);
  return tiles;
}
