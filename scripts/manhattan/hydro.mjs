// Inland water for the Manhattan renderer: the Central Park Reservoir, The Lake, Harlem Meer, Turtle Pond and the
// other ponds, from NYC Planimetric Database: Hydrography (NYC Open Data `pjs3-c3z5`, OTI). Build time only.
//
//   node scripts/manhattan/hydro.mjs [--refresh]
//
// Reads/writes the raw rows in build/manhattan-raw/hydro.json, keeps polygons whose centre lies on Manhattan's land
// polygon (the rivers are already water around the land polygon), projects them into the local frame and writes
// epoch/web/static/app/city/manhattan/hydro.json = { source, lakes: [{ n: name, a: areaM2, p: [ring, hole...] }] }
// with flat [x, z, ...] rings (0.1 m precision, 1 m Douglas-Peucker tolerance).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached } from './fetch.mjs';
import { lonLatToXZ, simplifyRing, ringArea, ringCentroid, pointInPoly, round } from './geo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = path.join(ROOT, 'build/manhattan-raw');
const OUT = path.join(ROOT, 'epoch/web/static/app/city/manhattan');

export async function buildHydro({ refresh = false } = {}) {
  const rows = await cached(RAW, { id: 'hydro', dataset: 'pjs3-c3z5', select: 'the_geom,name,feat_code', where: 'within_box(the_geom, 40.882, -74.03, 40.68, -73.905)', page: 2000 }, refresh);
  const land = JSON.parse(fs.readFileSync(path.join(OUT, 'land.json'), 'utf8'));
  const landPolys = land.polys.map((poly) => poly.map((flatRing) => { const r = []; for (let i = 0; i < flatRing.length; i += 2) r.push([flatRing[i], flatRing[i + 1]]); return r; }));
  const onLand = (x, z) => landPolys.some((p) => pointInPoly(x, z, p));
  const lakes = [];
  for (const row of rows) {
    const g = row.the_geom; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map((ring) => { const r = ring.map(([lon, lat]) => lonLatToXZ(lon, lat)); if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r; });
      const outer = simplifyRing(rings[0], 1.0); if (!outer || outer.length < 3) continue;
      const a = Math.abs(ringArea(outer)); if (a < 300 || a > 1.5e6) continue;      // > 1.5 km2: a river polygon whose centre happens to fall on land
      const [cx, cz] = ringCentroid(outer);
      if (!onLand(cx, cz)) continue;                                    // river and bay polygons: already water
      const holes = rings.slice(1).map((r) => simplifyRing(r, 1.0)).filter((r) => r && r.length >= 3 && Math.abs(ringArea(r)) > 60);
      const flat = (r) => r.flatMap(([x, z]) => [round(x), round(z)]);
      const n = row.name && row.name !== 'unset' ? row.name.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) : '';
      lakes.push({ n, a: Math.round(a), p: [flat(outer), ...holes.map(flat)] });
    }
  }
  lakes.sort((p, q) => q.a - p.a);
  const out = { source: 'NYC Planimetric Database: Hydrography (NYC Open Data pjs3-c3z5, OTI)', lakes };
  fs.writeFileSync(path.join(OUT, 'hydro.json'), JSON.stringify(out));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await buildHydro({ refresh: process.argv.includes('--refresh') });
  console.log(`hydro.json: ${out.lakes.length} lakes`, out.lakes.slice(0, 8).map((l) => `${l.n || '-'} ${Math.round(l.a)} m2`).join(', '));
}
