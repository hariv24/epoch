// city/skyline.js · permanent skyline icons (not tied to progress): Chrysler, Flatiron, One WTC, a pencil tower and a faceted
// glass tower. They are stylised and a little shorter than the real thing so they fit in frame. Each fills a Geo (merged, dim windows).
import { Geo, rgb, shade, tint, mixc, KIND, TAU } from './util.js';
import { FLOOR_H } from './shader.js';

const C = (h) => rgb(h);

// vertical prism over a convex polygon (x,z pairs, any winding), windows on the sides
function prism(g, pts, y0, y1, c, id, ctop) {
  let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    let a = pts[i], b = pts[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
    // outward normal of a quad (a -> b going up) is (-ez, 0, ex) * h ... flip the edge when it points inward
    if ((-ez) * mx + ex * mz < 0) { const t = a; a = b; b = t; }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    g.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], c, 0, L, KIND.win, id);
  }
  const top = pts.slice().sort((p, q) => Math.atan2(p[1] - cz, p[0] - cx) - Math.atan2(q[1] - cz, q[0] - cx));
  for (let i = 1; i + 1 < top.length; i++) g.tri([top[0][0], y1, top[0][1]], [top[i + 1][0], y1, top[i + 1][1]], [top[i][0], y1, top[i][1]], ctop || shade(c, 0.5));
}
const ring = (cx, cz, r, n, rot = 0) => Array.from({ length: n }, (_, k) => [cx + Math.cos(rot + (k / n) * TAU) * r, cz + Math.sin(rot + (k / n) * TAU) * r]);
const silver = C('#b9bfd2');

function chrysler(g, x, zf, s) {
  const cz = zf - 0.7 * s, body = C('#a89a88'), id = 41;
  const box = (w, d, y0, y1, c) => g.box(x - w / 2, y0, cz - d / 2, x + w / 2, y1, cz + d / 2, c, { win: true, sec: id, ctop: shade(c, 0.5) });
  box(1.5 * s, 1.3 * s, 0, 1.5, body);                                 // base block
  box(1.18 * s, 1.1 * s, 1.5, 3.0, shade(body, 1.04));
  g.box(x - 0.66 * s, 3.0, cz - 0.58 * s, x + 0.66 * s, 3.05, cz + 0.58 * s, C('#d8cdb8'), { ctop: C('#6a6460') });
  box(0.92 * s, 0.88 * s, 3.05, 4.0, shade(body, 1.08));
  g.box(x - 0.5 * s, 4.0, cz - 0.48 * s, x + 0.5 * s, 4.05, cz + 0.48 * s, C('#d8cdb8'), { ctop: C('#6a6460') });
  // eagle gargoyles at the corners of the 61st floor
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(x + sx * 0.45 * s - 0.035, 3.9, cz + sz * 0.43 * s - 0.035, x + sx * 0.45 * s + 0.035, 3.99, cz + sz * 0.43 * s + 0.035, silver);
  // terraced stainless crown: stacked flattened domes with a lit seam between
  const tiers = [[0.46, 0.34], [0.4, 0.3], [0.33, 0.28], [0.26, 0.26], [0.19, 0.22], [0.12, 0.2]];
  let y = 4.05;
  tiers.forEach(([r, h], i) => {
    g.cyl(x, cz, y, y + h * 0.5, r * s, r * s * 0.97, 16, silver, { top: false });
    g.sphere(x, y + h * 0.5, cz, r * s * 0.97, 16, 5, shade(silver, 1.05), { half: true }, h * 0.5 / (r * s * 0.97));
    g.cyl(x, cz, y + h * 0.5 - 0.012, y + h * 0.5 + 0.012, r * s * 0.99, r * s * 0.99, 16, C('#fff0c8'), { kind: KIND.glow, top: false });
    y += h * 0.85;
  });
  g.cyl(x, cz, y, y + 1.05, 0.05 * s, 0.006, 6, silver);
  g.sphere(x, y + 1.06, cz, 0.03, 6, 4, C('#ff5a50'), { kind: KIND.glow });
}

function flatiron(g, x, zf, s) {
  const stone = C('#c8b79e'), id = 42, H = 4.4;
  // wedge: apex toward the viewer, back wall wide; slightly flattened apex
  const A1 = [x - 0.06 * s, zf], A2 = [x + 0.06 * s, zf], B = [x + 0.78 * s, zf - 1.5 * s], Cc = [x - 0.78 * s, zf - 1.5 * s];
  prism(g, [A1, A2, B, Cc], 0, H, stone, id, C('#6a6460'));
  prism(g, [[A1[0] - 0.02, A1[1] + 0.02], [A2[0] + 0.02, A2[1] + 0.02], [B[0] + 0.04, B[1]], [Cc[0] - 0.04, Cc[1]]], H, H + 0.07, shade(stone, 1.15), id, C('#56514e'));
  prism(g, [A1, A2, B, Cc], 0.0, 0.5, shade(stone, 0.88), id, shade(stone, 0.5));       // rusticated base
  g.box(x - 0.3 * s, H + 0.07, zf - 1.1 * s, x + 0.3 * s, H + 0.2, zf - 0.7 * s, shade(stone, 0.8));
}

function wtc(g, x, zf, s) {
  const cz = zf - 0.65 * s, glass = C('#5d7aa4'), id = 43;
  g.box(x - 0.62 * s, 0, cz - 0.62 * s, x + 0.62 * s, 0.9, cz + 0.62 * s, shade(glass, 0.92), { win: true, sec: id, ctop: shade(glass, 0.5) });
  // chamfered tapering shaft: octagon at the base, rotating to a square at the top
  const steps = 7;
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps, t1 = (k + 1) / steps, y0 = 0.9 + t0 * 4.3, y1 = 0.9 + t1 * 4.3, rr0 = 0.6 - t0 * 0.15, rr1 = 0.6 - t1 * 0.15;
    g.cyl(x, cz, y0, y1, rr0 * s * 1.08, rr1 * s * 1.08, 8, shade(glass, 1.0 + t0 * 0.12), { win: true, sec: id, rot: Math.PI / 8 + t0 * 0.35, top: k === steps - 1 });
  }
  const top = 5.2;
  g.cyl(x, cz, top, top + 0.22, 0.46 * s, 0.28 * s, 8, shade(glass, 1.25), { rot: Math.PI / 8 + 0.35 });
  g.cyl(x, cz, top + 0.22, top + 1.35, 0.04 * s, 0.006, 6, silver);
  g.sphere(x, top + 1.36, cz, 0.04, 6, 4, C('#fff2d6'), { kind: KIND.glow });
}

function pencil(g, x, zf, s) {
  const cz = zf - 0.4 * s, c = C('#c2bcb4'), id = 44;
  g.box(x - 0.3 * s, 0, cz - 0.3 * s, x + 0.3 * s, 6.0, cz + 0.3 * s, c, { win: true, sec: id, ctop: shade(c, 0.5) });
  g.box(x - 0.33 * s, 6.0, cz - 0.33 * s, x + 0.33 * s, 6.07, cz + 0.33 * s, shade(c, 1.15));
  g.box(x - 0.2 * s, 6.07, cz - 0.2 * s, x + 0.2 * s, 6.2, cz + 0.2 * s, shade(c, 0.85));
  g.sphere(x, 6.26, cz, 0.03, 6, 4, C('#ff5a50'), { kind: KIND.glow });
}

function bofa(g, x, zf, s) {
  const cz = zf - 0.7 * s, c = C('#7b95b0'), id = 45;
  g.box(x - 0.58 * s, 0, cz - 0.58 * s, x + 0.58 * s, 0.7, cz + 0.58 * s, shade(c, 0.9), { win: true, sec: id });
  g.box(x - 0.5 * s, 0.7, cz - 0.5 * s, x + 0.5 * s, 3.4, cz + 0.5 * s, c, { win: true, sec: id, ctop: shade(c, 0.5) });
  g.frustum(x, cz, 3.4, 5.1, 1.0 * s, 1.0 * s, 0.42 * s, 0.42 * s, shade(c, 1.1), { kind: KIND.win, sec: id });
  g.cyl(x, cz, 5.1, 6.0, 0.05 * s, 0.006, 6, silver);
  g.sphere(x, 6.02, cz, 0.032, 6, 4, C('#ff5a50'), { kind: KIND.glow });
}

const ICONS = { chrysler, flatiron, wtc, pencil, bofa };
export function buildIcon(g, name, x, zFront, s = 1) { const f = ICONS[name]; if (f) f(g, x, zFront, s); }
void FLOOR_H; void tint; void mixc; void ring;
