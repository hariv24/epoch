// Stage: extract roof "tiers" (setbacks, stepped roofs) for Manhattan buildings from the NYC DoITT/OTI
// 3-D Building Model (CityGML LoD2, 2014 vintage, "DA_WISE_GML.zip"). Only Manhattan BINs (1xxxxxx) are
// kept and only the roof polygons + ground level, which is all the extruder needs.
// Output: build/manhattan-raw/tiers3d.json  { bin: { g: groundFt, r: [[zFt, [ext...], [hole...]...], ...] } }
// (coordinates in EPSG:2263 feet, rounded to 0.01).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export const GML_URL = 'https://s-media.nyc.gov/agencies/oti/DA_WISE_GML.zip';
// Delivery areas whose envelope intersects Manhattan (checked against their gml:Envelope headers).
export const DAS = [9, 10, 12, 13, 14, 15, 19, 20];

const posRe = /<gml:posList>([^<]*)<\/gml:posList>/g;

function parseRing(txt) {
  const t = txt.trim().split(/\s+/);
  const n = (t.length / 3) | 0;
  const out = new Array(n * 3);
  for (let i = 0; i < n * 3; i++) out[i] = Math.round(parseFloat(t[i]) * 100) / 100;
  return out;
}

function polygonsOf(surfaceText) {
  // split into <gml:Polygon>…</gml:Polygon>
  const polys = [];
  let i = 0;
  for (;;) {
    const s = surfaceText.indexOf('<gml:Polygon', i);
    if (s < 0) break;
    const e = surfaceText.indexOf('</gml:Polygon>', s);
    if (e < 0) break;
    const ptxt = surfaceText.slice(s, e);
    const rings = [];
    posRe.lastIndex = 0;
    let m;
    while ((m = posRe.exec(ptxt))) rings.push(parseRing(m[1]));
    if (rings.length) polys.push(rings); // rings[0] exterior, rest interior
    i = e + 14;
  }
  return polys;
}

function parseBuilding(txt) {
  const bm = /name="BIN">\s*<gen:value>(\d+)</.exec(txt);
  if (!bm) return null;
  const bin = bm[1];
  if (bin.length !== 7 || bin[0] !== '1') return null;
  const roofs = [];
  let gmin = Infinity;
  let i = 0;
  for (;;) {
    const s = txt.indexOf('<bldg:RoofSurface', i);
    if (s < 0) break;
    const e = txt.indexOf('</bldg:RoofSurface>', s);
    if (e < 0) break;
    for (const rings of polygonsOf(txt.slice(s, e))) {
      let zs = 0, zmin = Infinity, zmax = -Infinity, n = 0;
      const ext = rings[0];
      for (let k = 2; k < ext.length; k += 3) { const z = ext[k]; zs += z; n++; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      roofs.push({ zmean: zs / n, zmin, zmax, rings });
    }
    i = e + 19;
  }
  i = 0;
  for (;;) {
    const s = txt.indexOf('<bldg:GroundSurface', i);
    if (s < 0) break;
    const e = txt.indexOf('</bldg:GroundSurface>', s);
    if (e < 0) break;
    for (const rings of polygonsOf(txt.slice(s, e))) {
      for (let k = 2; k < rings[0].length; k += 3) if (rings[0][k] < gmin) gmin = rings[0][k];
    }
    i = e + 21;
  }
  if (!roofs.length) return null;
  return { bin, g: Number.isFinite(gmin) ? gmin : null, roofs };
}

function streamDA(zip, da, onBuilding) {
  return new Promise((resolve, reject) => {
    const p = spawn('unzip', ['-p', zip, `DA_WISE_GMLs/DA${da}_3D_Buildings_Merged.gml`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const dec = new StringDecoder('utf8');
    let buf = '';
    let bytes = 0;
    p.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      buf += dec.write(chunk);
      let pos = 0;
      for (;;) {
        const s = buf.indexOf('<bldg:Building ', pos);
        if (s < 0) { pos = Math.max(pos, buf.length - 20); break; }
        const e = buf.indexOf('</bldg:Building>', s);
        if (e < 0) { pos = s; break; }
        onBuilding(buf.slice(s, e));
        pos = e + 16;
      }
      buf = buf.slice(pos);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 || code === 141 ? resolve(bytes) : reject(new Error('unzip exit ' + code))));
  });
}

export async function extractTiers(rawDir, { refresh = false } = {}) {
  const out = path.join(rawDir, 'tiers3d.json');
  if (!refresh && fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  const dir = path.join(rawDir, '3dmodel');
  const zip = path.join(dir, 'DA_WISE_GML.zip');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(zip) || fs.statSync(zip).size < 900e6) {
    console.log('[3d] downloading CityGML model (916 MB, one-off)…');
    await new Promise((res, rej) => {
      const c = spawn('curl', ['-sSL', '-C', '-', '-o', zip, GML_URL], { stdio: 'inherit' });
      c.on('close', (code) => (code === 0 ? res() : rej(new Error('curl exit ' + code))));
    });
  }
  const result = {};
  for (const da of DAS) {
    const t0 = Date.now();
    let kept = 0, seen = 0;
    const bytes = await streamDA(zip, da, (txt) => {
      seen++;
      const b = parseBuilding(txt);
      if (!b) return;
      // the same BIN can appear in two overlapping delivery areas: keep the one with more roof polygons
      const prev = result[b.bin];
      const cur = { g: b.g, r: b.roofs.map((r) => [Math.round(r.zmean * 100) / 100, Math.round((r.zmax - r.zmin) * 100) / 100, ...r.rings]) };
      if (!prev || prev.r.length < cur.r.length) result[b.bin] = cur;
      kept++;
    });
    console.log(`[3d] DA${da}: ${seen} buildings seen, ${kept} Manhattan kept, ${(bytes / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  fs.writeFileSync(out, JSON.stringify(result));
  console.log(`[3d] ${Object.keys(result).length} Manhattan BINs with roof tiers -> ${out}`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const raw = path.resolve(process.argv[2] || 'build/manhattan-raw');
  await extractTiers(raw, { refresh: process.argv.includes('--refresh') });
}
