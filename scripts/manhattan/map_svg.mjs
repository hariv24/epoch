// The no-WebGL fallback for World > City: a flat map of Manhattan (land, parks, lakes, neighbourhoods, avenues and the user's
// Morningside block), drawn lying on its side (north to the right) so it fills a wide stage. Build time only.
//
//   node scripts/manhattan/map_svg.mjs      -> epoch/web/static/app/city/manhattan/map.svg
//
// Units are 10 m; the Manhattan street grid is turned square to the page (29 degrees).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'epoch/web/static/app/city/manhattan');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const GA = (29 * Math.PI) / 180, CA = Math.cos(GA), SA = Math.sin(GA);
// page frame: X = along the avenues (north to the right), Y = across them (east is down)
const PX = (x, z) => (x * SA - z * CA) / 10, PY = (x, z) => (x * CA + z * SA) / 10;

function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const toPts = (flat) => { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([PX(flat[i], flat[i + 1]), PY(flat[i], flat[i + 1])]); return r; };
const f1 = (v) => (Math.round(v * 10) / 10).toString();
function ringD(flat, tol, closed = true) {
  let p = toPts(flat);
  if (closed) {               // split the ring at its farthest point so both halves have a real chord
    let f = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2; if (d > fd) { fd = d; f = i; } }
    const a = dp(p.slice(0, f + 1), tol), b = dp(p.slice(f).concat([p[0]]), tol);
    p = a.concat(b.slice(1));
  } else p = dp(p, tol);
  if (p.length < (closed ? 4 : 2)) return '';
  let d = 'M' + f1(p[0][0]) + ' ' + f1(p[0][1]);
  for (let i = 1; i < p.length; i++) d += 'l' + f1(p[i][0] - p[i - 1][0]) + ' ' + f1(p[i][1] - p[i - 1][1]);
  return d + (closed ? 'z' : '');
}
const polyD = (rings, tol) => rings.map((r) => ringD(r, tol)).join('');

const land0 = J('land.json'), parks = J('parks.json'), nta = J('nta.json'), streets = J('streets.json'), home = J('home.json');
const homeLots = home.weeks ? home.weeks.flatMap((w) => w.slots) : home.lots;   // home.json v2: the year of lots (weeks[].slots), v1: lots[]
// drop the far-shore pier outlines (same rule as city/manhattan.js dropDetachedPiers)
const land = { ...land0, polys: (() => { const P = land0.polys, main = P.reduce((m, p) => (p[0].length > m[0].length ? p : m), P[0])[0]; return P.filter((p) => { if (p[0].length >= 24) return true; let cx = 0, cz = 0; const n = p[0].length / 2; for (let i = 0; i < p[0].length; i += 2) { cx += p[0][i] / n; cz += p[0][i + 1] / n; } let d = Infinity; for (let i = 0; i < main.length; i += 2) d = Math.min(d, Math.hypot(main[i] - cx, main[i + 1] - cz)); return d < 200; }); })() };
const hydro = fs.existsSync(path.join(OUT, 'hydro.json')) ? J('hydro.json') : { lakes: [] };
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
for (const p of land.polys) for (const [x, y] of toPts(p[0])) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
const M = 60; x0 -= M; x1 += M; y0 -= M + 40; y1 += M;
const W = x1 - x0, H = y1 - y0;

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x0)} ${f1(y0)} ${f1(W)} ${f1(H)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of Manhattan with your Morningside Heights block and your year of lots">`);
parts.push('<style>.w{fill:#0B1F3F}.l{fill:#21406B}.n{fill:none;stroke:#3D6BA3;stroke-width:.9;opacity:.75}.p{fill:#2E6B57}.k{fill:#1B3C69}.a{fill:none;stroke:#3F6699;stroke-width:1.1;stroke-linecap:round;opacity:.8}.h{fill:#8CC4EE;stroke:#D2E9FF;stroke-width:.5}.t{font:700 26px system-ui,-apple-system,Segoe UI,sans-serif;fill:#CFE3F6;opacity:.82}.ts{font:600 18px system-ui,-apple-system,Segoe UI,sans-serif;fill:#9DB9D8;opacity:.8}.hl{font:800 24px system-ui,-apple-system,Segoe UI,sans-serif;fill:#8CC4EE}</style>');
parts.push(`<rect class="w" x="${f1(x0)}" y="${f1(y0)}" width="${f1(W)}" height="${f1(H)}"/>`);
parts.push(`<path class="l" fill-rule="evenodd" d="${land.polys.map((p) => polyD(p, 0.4)).join('')}"/>`);
parts.push(`<path class="p" fill-rule="evenodd" d="${parks.parks.filter((p) => p.a > 0.6).map((p) => polyD(p.p, 0.5)).join('')}"/>`);
parts.push(`<path class="k" fill-rule="evenodd" d="${hydro.lakes.map((l) => polyD(l.p, 0.3)).join('')}"/>`);
parts.push(`<path class="a" d="${streets.lines.filter((l) => l.c === 1 || l.c === 2).map((l) => ringD(l.p, 0.8, false)).join('')}"/>`);
parts.push(`<path class="n" d="${nta.neighborhoods.map((n) => n.polys.map((p) => ringD(p[0], 0.8)).join('')).join('')}"/>`);
parts.push(`<path class="h" d="${homeLots.map((l) => ringD(l.footprint, 0.05)).join('')}"/>`);
// labels
const at = (code) => nta.neighborhoods.find((n) => n.code === code);
const lab = (txt, code, cls = 't', dy = 0) => { const n = at(code); if (!n) return; parts.push(`<text class="${cls}" x="${f1(PX(n.centroid[0], n.centroid[1]))}" y="${f1(PY(n.centroid[0], n.centroid[1]) + dy)}" text-anchor="middle">${txt}</text>`); };
lab('Central Park', 'MN6491'); lab('Midtown', 'MN0502'); lab('Financial District', 'MN0101', 'ts'); lab('Harlem', 'MN1002', 'ts'); lab('Washington Heights', 'MN1201', 'ts'); lab('Greenwich Village', 'MN0202', 'ts'); lab('Upper West Side', 'MN0702', 'ts'); lab('Upper East Side', 'MN0802', 'ts');
{ const n = at('MN0901'); const hl7 = homeLots.slice(0, 28), hx = hl7.reduce((a, l) => a + PX(l.x, l.z), 0) / hl7.length, hy = hl7.reduce((a, l) => a + PY(l.x, l.z), 0) / hl7.length;
  parts.push(`<circle cx="${f1(hx)}" cy="${f1(hy)}" r="30" fill="none" stroke="#8CC4EE" stroke-width="3"/><text class="hl" x="${f1(hx)}" y="${f1(hy - 44)}" text-anchor="middle">Your block · Morningside Heights</text>`); void n; }
// north arrow (north is to the right)
parts.push(`<g transform="translate(${f1(x1 - 90)} ${f1(y0 + 70)})" opacity=".8"><path d="M-34 0h56" stroke="#CFE3F6" stroke-width="3" fill="none"/><path d="M30 0l-14-9v18z" fill="#CFE3F6"/><text class="ts" x="-4" y="-16" text-anchor="middle">N</text></g>`);
parts.push('</svg>');
const svg = parts.join('\n');
fs.writeFileSync(path.join(OUT, 'map.svg'), svg);
console.log(`map.svg ${(svg.length / 1024).toFixed(0)} KB, ${f1(W)} x ${f1(H)} (10 m units)`);
