// city/spots/kit.js · the shared toolkit of the study spots (docs/COZY.md section 4.5): light by hour, the painted view out of a window,
// rain and snow on the glass, dust motes, warm lamp pools and window light, steam, a wall clock on New York time, and the "crowd":
// every other person in a spot (human.js people: varied, clearly human) drawn as ONE mesh, posed on the CPU each frame (one draw call).
// Nothing here owns a renderer. Everything is procedural: no models, no image files.
import * as THREE from 'three';
import { Geo, rgb, shade, clamp, lerp, rng, smooth, TAU } from '../util.js';
import { figureMaterial } from '../character.js';
import { buildPerson, randomLook, specOf, DIM } from '../human.js';

export { Geo, rgb, shade, clamp, lerp, rng, smooth, TAU };
export const C = rgb;
/** a linear colour times k, as [r, g, b] (for HDR glow bits) */
export const hc = (hex, k = 1) => { const c = new THREE.Color(hex).multiplyScalar(k); return [c.r, c.g, c.b]; };
const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const ease = easeIO;

/* ------------------------------------------------------------ textures (canvas, made once per stage) */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function radialTex() {
  return canvasTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }, false);
}
/** a light shaft: bright at the window (v = 1), fading toward the floor (v = 0), soft at the sides */
export function beamTex() {
  return canvasTex(32, 128, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = i / (w - 1), v = 1 - j / (h - 1), side = Math.sin(Math.PI * u), a = Math.pow(side, 1.6) * (0.25 + 0.75 * v * v);
      const k = (j * w + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
  }, false);
}
/** the shape of a mullioned window, for the patch of sun it throws on the floor */
export function paneTex(cols = 3, rows = 4, arch = true) {
  return canvasTex(96, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = '#fff';
    const pad = 3, cw = (w - pad * 2) / cols, rh = (h - pad * 2) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) x.fillRect(pad + i * cw + 2, pad + j * rh + 2, cw - 4, rh - 4);
    if (arch) { x.globalCompositeOperation = 'destination-in'; x.beginPath(); x.moveTo(0, h); x.lineTo(0, w / 2); x.arc(w / 2, w / 2, w / 2, Math.PI, 0); x.lineTo(w, h); x.closePath(); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    x.filter = 'blur(2px)'; const d = x.getImageData(0, 0, w, h); x.putImageData(d, 0, 0);
  }, false);
}

/* ------------------------------------------------------------ materials */
export function makeMaterials() {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });           // screens, always on
  const lamp = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });           // lamp bulbs and shades: .color = how lit
  const gold = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });           // gilt and brass catching the light
  const radial = radialTex(), beam = beamTex();
  const add = (map, o = {}) => new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: o.side ?? THREE.FrontSide, opacity: 1 });
  const pools = add(radial);                                   // warm pools under the lamps
  const beams = add(beam, { side: THREE.DoubleSide });         // window light in the air
  const blob = new THREE.MeshBasicMaterial({ map: radial, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.32 });   // contact shadows
  const all = [solid, glow, lamp, gold, pools, beams, blob];
  return { solid, glow, lamp, gold, pools, beams, blob, radial, beam, dispose() { all.forEach((m) => m.dispose()); radial.dispose(); beam.dispose(); } };
}

/* ------------------------------------------------------------ textured quads (decals, beams): positions, uvs and a colour per vertex */
export class Quads {
  constructor() { this.p = []; this.uv = []; this.c = []; this.i = []; this.n = 0; }
  quad(p0, p1, p2, p3, col, uv = [0, 0, 1, 1]) {
    const cc = Array.isArray(col[0]) ? col : [col, col, col, col], [u0, v0, u1, v1] = uv, b = this.n;
    for (const [p, c, u, v] of [[p0, cc[0], u0, v0], [p1, cc[1], u1, v0], [p2, cc[2], u1, v1], [p3, cc[3], u0, v1]]) { this.p.push(p[0], p[1], p[2]); this.c.push(c[0], c[1], c[2]); this.uv.push(u, v); }
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3); this.n += 4;
  }
  /** a flat decal on a horizontal surface at height y */
  flat(cx, y, cz, w, d, col, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (x, z) => [cx + x * c + z * s, y, cz - x * s + z * c];
    this.quad(P(-w / 2, d / 2), P(w / 2, d / 2), P(w / 2, -d / 2), P(-w / 2, -d / 2), col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setIndex(this.i); g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.n === 0; }
}

/* ------------------------------------------------------------ light by hour (New York or local, the app's "ny" preference) */
// h: hour; top/hor: sky; sun: colour + strength, elev (0 horizon .. 1 high), az (-1 rays toward the back .. 1 toward the viewer);
// hemi sky/ground + strength; lamp: how much the lamps carry the scene; shafts: visible window light
const KEYS = [
  { h: 0, top: '#061229', hor: '#1a3060', sun: '#2a3654', sunI: 0, elev: 0, az: 0, hs: '#38446a', hg: '#231c2a', hI: 0.34, lamp: 1, shafts: 0 },
  { h: 5.3, top: '#0a1a3a', hor: '#2a4174', sun: '#2a3654', sunI: 0, elev: 0, az: -0.6, hs: '#3f4c72', hg: '#231c2a', hI: 0.36, lamp: 1, shafts: 0 },
  { h: 6.4, top: '#5a6fa8', hor: '#f2b48e', sun: '#ffc7a0', sunI: 0.7, elev: 0.06, az: -0.7, hs: '#a3b2d0', hg: '#5a4a44', hI: 0.62, lamp: 0.85, shafts: 0.45 },
  { h: 8.2, top: '#8dbbe9', hor: '#e3edf6', sun: '#e9f1ff', sunI: 1.55, elev: 0.28, az: -0.5, hs: '#d2e2f6', hg: '#7a6650', hI: 1.05, lamp: 0.45, shafts: 1 },
  { h: 12.5, top: '#76aee6', hor: '#d6e7f6', sun: '#fff8ec', sunI: 1.9, elev: 0.72, az: 0, hs: '#eef2f7', hg: '#8a7660', hI: 1.35, lamp: 0.3, shafts: 0.55 },
  { h: 16.3, top: '#86acdb', hor: '#f5dab3', sun: '#ffd093', sunI: 1.75, elev: 0.3, az: 0.45, hs: '#f1dcc2', hg: '#7a6048', hI: 1.0, lamp: 0.55, shafts: 1 },
  { h: 18.4, top: '#56689f', hor: '#ffad6a', sun: '#ff9d58', sunI: 1.25, elev: 0.09, az: 0.65, hs: '#e7b892', hg: '#5a4436', hI: 0.78, lamp: 0.85, shafts: 0.9 },
  { h: 19.5, top: '#1b2f62', hor: '#5d76ae', sun: '#7d8fd0', sunI: 0, elev: 0, az: 0.7, hs: '#5b6ea6', hg: '#2e2638', hI: 0.48, lamp: 1, shafts: 0 },
  { h: 21, top: '#071530', hor: '#1d3561', sun: '#2a3654', sunI: 0, elev: 0, az: 0, hs: '#3b4566', hg: '#231c2a', hI: 0.34, lamp: 1, shafts: 0 },
  { h: 24, top: '#061229', hor: '#1a3060', sun: '#2a3654', sunI: 0, elev: 0, az: 0, hs: '#38446a', hg: '#231c2a', hI: 0.34, lamp: 1, shafts: 0 },
];
const _a = new THREE.Color(), _b = new THREE.Color();
const mixHex = (a, b, t) => _a.set(a).lerp(_b.set(b), t).clone();
/** the weather of /api/weather boiled down to 0..1 amounts (the same reading as city/weather.js) */
export function weatherAmounts(w) {
  const t = { cover: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0, cond: null };
  if (!w || w.enabled === false || w.available === false || !w.condition) return t;
  const cc = w.cloud_cover != null ? clamp(w.cloud_cover / 100, 0, 1) : null, pr = Math.max(0, +w.precipitation_mm || 0);
  t.cond = w.condition; t.wind = clamp((+w.wind_kmh || 0) / 40, 0, 1);
  switch (w.condition) {
    case 'clouds': t.cover = Math.max(0.5, cc ?? 0.7); break;
    case 'rain': t.cover = Math.max(0.78, cc ?? 0.85); t.rain = clamp(0.45 + pr / 3, 0.45, 1); break;
    case 'snow': t.cover = Math.max(0.72, cc ?? 0.8); t.snow = clamp(0.5 + pr / 2, 0.5, 1); break;
    case 'fog': t.cover = 0.6; t.fog = 0.9; break;
    case 'storm': t.cover = 1; t.rain = 1; t.storm = 1; break;
    default: t.cover = Math.min(0.4, (cc ?? 0.1) * 0.55);
  }
  return t;
}
export function lightAt(hour, wt = weatherAmounts(null)) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const A = KEYS[i], B = KEYS[i + 1], t = smooth(clamp((h - A.h) / Math.max(0.01, B.h - A.h), 0, 1));
  const L = {
    hour: h, top: mixHex(A.top, B.top, t), hor: mixHex(A.hor, B.hor, t), sun: mixHex(A.sun, B.sun, t), sunI: lerp(A.sunI, B.sunI, t),
    elev: lerp(A.elev, B.elev, t), az: lerp(A.az, B.az, t), hemiSky: mixHex(A.hs, B.hs, t), hemiGround: mixHex(A.hg, B.hg, t), hemiI: lerp(A.hI, B.hI, t),
    lamp: lerp(A.lamp, B.lamp, t), shafts: lerp(A.shafts, B.shafts, t),
  };
  L.night = clamp(1 - L.hemiI / 0.9, 0, 1) * (h < 6 || h > 19 ? 1 : 0.6);
  L.day = clamp((L.hemiI - 0.4) / 0.9, 0, 1);
  L.bucket = h >= 5.5 && h < 10 ? 'morning' : h >= 10 && h < 15.8 ? 'day' : h >= 15.8 && h < 19.1 ? 'golden' : h >= 19.1 && h < 20.3 ? 'blue' : 'night';
  // weather: clouds hide the sun and grey the sky, rain darkens, snow brightens and cools
  const cov = wt.cover || 0, grey = L.day > 0.2 ? '#aab6c6' : '#24314d';
  L.sunI *= 1 - 0.88 * cov; L.shafts *= 1 - 0.92 * cov;
  L.top.lerp(_a.set(grey), cov * 0.75); L.hor.lerp(_a.set(L.day > 0.2 ? '#c4ccd6' : '#2c3a58'), cov * 0.7);
  L.hemiSky.lerp(_a.set(L.day > 0.2 ? '#c9d2de' : '#3a4566'), cov * 0.55);
  if (wt.rain) { L.hemiI *= 1 - 0.22 * wt.rain; L.lamp = Math.max(L.lamp, 0.55 + 0.4 * wt.rain); }
  if (wt.snow) { L.hemiI *= 1 + 0.12 * wt.snow * L.day; L.hemiSky.lerp(_a.set('#e6eefa'), 0.35 * wt.snow * L.day); }
  L.rain = wt.rain || 0; L.snow = wt.snow || 0; L.cover = cov; L.fog = wt.fog || 0; L.wind = wt.wind || 0;
  L.key = L.bucket + ':' + Math.round(h * 4) + ':' + (wt.cond || '-');
  return L;
}
/** New York's wall-clock time as {h, m, s} (the spots are in New York) */
export function nyTime(d = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(d);
    const g = (k) => +((p.find((x) => x.type === k) || {}).value || 0);
    return { h: g('hour') % 24, m: g('minute'), s: g('second') };
  } catch { return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() }; }
}

/* ------------------------------------------------------------ the painted view out of a window */
// kind: campus (Low Library's dome over the South Lawn), avenue (the far side of Amsterdam Ave), skyline (south to Midtown), park, hall
export function paintView(kind, L, o = {}) {
  const W = o.w || 1024, H = o.h || 512;
  return canvasTex(W, H, (x) => {
    const night = L.night > 0.55, dusk = L.bucket === 'blue' || L.bucket === 'golden';
    const g = x.createLinearGradient(0, 0, 0, H * 0.78);
    g.addColorStop(0, '#' + L.top.getHexString()); g.addColorStop(1, '#' + L.hor.getHexString());
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const r = rng(o.seed || 11);
    if (night && L.cover < 0.5) { x.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 70; i++) x.fillRect(r() * W, r() * H * 0.45, 1.4, 1.4); }
    if (L.sunI > 0.3 && L.elev < 0.35 && kind !== 'avenue') {            // a low sun glows near the horizon
      const sx = W * (0.5 + L.az * 0.35), sy = H * (0.62 - L.elev * 0.9), sg = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.5);
      sg.addColorStop(0, 'rgba(255,236,200,0.95)'); sg.addColorStop(0.15, 'rgba(255,214,160,0.45)'); sg.addColorStop(1, 'rgba(255,200,140,0)');
      x.fillStyle = sg; x.fillRect(0, 0, W, H);
    }
    // soft clouds
    const cl = 0.15 + L.cover * 0.7; x.fillStyle = night ? `rgba(40,56,92,${0.35 * cl})` : `rgba(255,255,255,${0.42 * cl})`;
    for (let i = 0; i < 9; i++) { const cx = r() * W, cy = H * (0.08 + r() * 0.3), rw = W * (0.08 + r() * 0.14); x.beginPath(); x.ellipse(cx, cy, rw, rw * 0.22, 0, 0, TAU); x.fill(); }
    const ink = night ? '#0d1a33' : dusk ? '#55597a' : '#8b97ab', ink2 = night ? '#14223f' : dusk ? '#6c6f8c' : '#a3adbd';
    const lit = (n, x0, y0, w, h) => { if (!night && !dusk) return; x.fillStyle = 'rgba(255,214,150,0.9)'; for (let i = 0; i < n; i++) if (r() < 0.55) x.fillRect(x0 + r() * w, y0 + r() * h, 3, 4); };
    if (kind === 'campus') {
      // trees of the South Lawn, then Low Library: a colonnade, a stepped base and the shallow dome
      x.fillStyle = ink2; for (let i = 0; i < 16; i++) { const cx = i * W / 15 + r() * 30, cy = H * 0.7; x.beginPath(); x.ellipse(cx, cy, 70 + r() * 40, 46 + r() * 20, 0, 0, TAU); x.fill(); }
      const cx = W * 0.5, base = H * 0.72, bw = W * 0.38;
      x.fillStyle = night ? '#1a2846' : dusk ? '#8c7f8a' : '#d8d0c2';
      x.fillRect(cx - bw / 2, base - H * 0.2, bw, H * 0.2);                          // the hall
      x.fillRect(cx - bw * 0.2, base - H * 0.27, bw * 0.4, H * 0.07);                 // the drum
      x.beginPath(); x.ellipse(cx, base - H * 0.27, bw * 0.2, H * 0.13, 0, Math.PI, 0); x.fill();                 // the dome
      x.fillStyle = night ? '#0f1a30' : 'rgba(80,72,64,0.35)';
      for (let i = 0; i < 10; i++) x.fillRect(cx - bw * 0.3 + i * bw * 0.0665, base - H * 0.17, 5, H * 0.13);   // the columns' shadows
      if (night) { x.fillStyle = 'rgba(255,206,140,0.85)'; for (let i = 0; i < 9; i++) x.fillRect(cx - bw * 0.27 + i * bw * 0.0665, base - H * 0.15, 8, H * 0.1); }
      x.fillStyle = ink; x.fillRect(0, base, W, H - base);                            // the lawn and the walk
      x.fillStyle = night ? 'rgba(255,214,150,0.5)' : 'rgba(255,255,255,0.18)'; x.fillRect(0, base + 6, W, 3);
      lit(30, 0, base - H * 0.12, W * 0.25, H * 0.1); lit(30, W * 0.75, base - H * 0.12, W * 0.25, H * 0.1);
    } else if (kind === 'avenue') {
      // the far side of the avenue: pre-war walk-ups and brick, shopfronts with awnings, a street tree
      let px = -20;
      while (px < W) {
        const bw = 120 + r() * 110, bh = H * (0.55 + r() * 0.3), col = night ? ['#1b2340', '#24203a', '#1d2a44'][Math.floor(r() * 3)] : ['#b98a6a', '#c9b49a', '#a8735a', '#d8cbb4'][Math.floor(r() * 4)];
        x.fillStyle = col; x.fillRect(px, H - bh, bw, bh);
        for (let fy = H - bh + 18; fy < H * 0.78; fy += 34) for (let fx = px + 12; fx < px + bw - 20; fx += 30) { x.fillStyle = night ? (r() < 0.5 ? 'rgba(255,212,150,0.9)' : '#0f1830') : 'rgba(60,70,90,0.55)'; x.fillRect(fx, fy, 14, 20); }
        x.fillStyle = ['#3f6b4e', '#7a3b2e', '#2f4d6e'][Math.floor(r() * 3)]; x.fillRect(px + 8, H * 0.8, bw - 16, 12);    // awnings
        x.fillStyle = night ? 'rgba(255,220,170,0.75)' : 'rgba(40,50,70,0.5)'; x.fillRect(px + 12, H * 0.83, bw - 24, H * 0.12);
        px += bw + 4;
      }
      x.fillStyle = night ? '#141a2a' : '#5d6470'; x.fillRect(0, H * 0.95, W, H * 0.05);
      x.fillStyle = night ? '#0e1424' : '#3f5f46'; x.beginPath(); x.ellipse(W * 0.72, H * 0.42, 110, 90, 0, 0, TAU); x.fill(); x.fillRect(W * 0.72 - 6, H * 0.45, 12, H * 0.5);
    } else if (kind === 'skyline') {
      // south toward Midtown: a band of towers, the Empire State's mast and the Chrysler's crown
      const base = H * (o.far ? 0.9 : 0.86), sk = o.far ? 0.42 : 1;           // far: a distant skyline, low on the horizon
      for (let layer = 0; layer < 3; layer++) {
        x.fillStyle = night ? ['#1a2a4c', '#121f3a', '#0c1830'][layer] : dusk ? ['#8a87a6', '#6f6d8e', '#575774'][layer] : ['#b7c3d4', '#9daabe', '#8593a8'][layer];
        let px = 0; while (px < W) { const bw = (18 + r() * 40) * (o.far ? 0.6 : 1), bh = H * sk * (0.05 + r() * (0.18 + layer * 0.06)); x.fillRect(px, base - bh + layer * 14 * sk, bw, bh + 40); if (night) lit(6, px, base - bh + layer * 14 * sk, bw, bh); px += bw + 2; }
      }
      const esx = W * 0.46, csx = W * 0.6;
      x.fillStyle = night ? '#0b1530' : dusk ? '#4a4a68' : '#7c8aa2';
      const Hs = H * sk, q = o.far ? 0.5 : 1;
      x.fillRect(esx - 26 * q, base - Hs * 0.5, 52 * q, Hs * 0.5); x.fillRect(esx - 16 * q, base - Hs * 0.6, 32 * q, Hs * 0.1); x.fillRect(esx - 7 * q, base - Hs * 0.68, 14 * q, Hs * 0.08); x.fillRect(esx - 2 * q, base - Hs * 0.78, 4 * q, Hs * 0.1);
      x.fillRect(csx - 18 * q, base - Hs * 0.44, 36 * q, Hs * 0.44); x.beginPath(); x.moveTo(csx - 18 * q, base - Hs * 0.44); x.lineTo(csx, base - Hs * 0.6); x.lineTo(csx + 18 * q, base - Hs * 0.44); x.fill();
      if (night) { x.fillStyle = 'rgba(255,226,170,0.95)'; x.fillRect(esx - 14 * q, base - Hs * 0.6, 28 * q, Hs * 0.035); x.fillStyle = 'rgba(220,235,255,0.95)'; x.beginPath(); x.moveTo(csx - 12 * q, base - Hs * 0.47); x.lineTo(csx, base - Hs * 0.58); x.lineTo(csx + 12 * q, base - Hs * 0.47); x.fill(); }
    } else if (kind === 'park') {
      x.fillStyle = ink2; for (let i = 0; i < 22; i++) { x.beginPath(); x.ellipse(r() * W, H * (0.55 + r() * 0.2), 80 + r() * 60, 50 + r() * 30, 0, 0, TAU); x.fill(); }
      x.fillStyle = ink; let px = 0; while (px < W) { const bw = 30 + r() * 50, bh = H * (0.18 + r() * 0.2); x.fillRect(px, H * 0.55 - bh, bw, bh); lit(8, px, H * 0.55 - bh, bw, bh); px += bw + 8; }
      x.fillStyle = night ? '#0e1a24' : '#5f7d4e'; x.fillRect(0, H * 0.7, W, H * 0.3);
    } else {
      x.fillStyle = ink; x.fillRect(0, H * 0.75, W, H * 0.25);
    }
    if (L.fog || L.rain) { x.fillStyle = `rgba(${night ? '30,44,70' : '200,208,218'},${0.25 * Math.max(L.fog, L.rain)})`; x.fillRect(0, 0, W, H); }
  });
}

/* ------------------------------------------------------------ rain and snow on the glass (one shader plane over the windows) */
const GLASS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const GLASS_FRAG = /* glsl */`
varying vec2 vUv; uniform float uTime, uRain, uSnow, uAspect, uNight; uniform vec3 uTint;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv * vec2(uAspect, 1.0);
  float a = 0.0;
  if (uRain > 0.01) {
    // running drops: one per narrow column, each with its own speed and a fading trail
    vec2 q = uv * vec2(26.0, 3.0);
    float col = floor(q.x), r = h1(col + 3.0);
    float y = fract(q.y * 0.5 + uTime * (0.10 + 0.22 * r) + r * 7.0);
    float x = fract(q.x) - 0.5 + 0.12 * sin(q.y * 4.0 + r * 9.0);
    float head = smoothstep(0.12, 0.0, length(vec2(x * 1.4, (y - 0.06) * 6.0)));
    float trail = smoothstep(0.05, 0.0, abs(x)) * smoothstep(0.06, 0.5, y) * (1.0 - y) * 0.6;
    a += (head + trail) * step(0.35, r);
    // beads that sit still on the pane
    vec2 g = uv * 42.0, id = floor(g), f = fract(g) - 0.5;
    float hb = h2(id), d = length(f - (vec2(h2(id + 1.7), h2(id + 3.1)) - 0.5) * 0.6);
    a += smoothstep(0.18 * hb, 0.02, d) * step(0.6, hb) * 0.7;
    a *= uRain;
  }
  float s = 0.0;
  if (uSnow > 0.01) {
    // flakes drifting down outside the glass, and a little frost gathered on the sill
    for (int k = 0; k < 2; k++) {
      float sc = 9.0 + float(k) * 7.0;
      vec2 q = uv * sc + vec2(sin(uTime * 0.3 + float(k)) * 0.6, uTime * (0.35 + 0.2 * float(k)));
      vec2 id = floor(q), f = fract(q) - 0.5; float r = h2(id + float(k) * 13.0);
      s += smoothstep(0.09, 0.0, length(f - (vec2(r, h2(id + 5.0)) - 0.5) * 0.7)) * step(0.55, r);
    }
    s += smoothstep(0.1, 0.0, vUv.y) * 0.5;
    s *= uSnow;
  }
  vec3 c = mix(vec3(0.82, 0.88, 0.98), uTint, uNight * 0.7);
  float alpha = clamp(a * 0.55 + s * 0.8, 0.0, 0.9);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(c * (1.0 + s * 0.3), alpha);
}`;
export function createGlass(w, h) {
  const u = { uTime: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 }, uAspect: { value: w / h }, uNight: { value: 0 }, uTint: { value: new THREE.Color('#ffd9a0') } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: u, transparent: true, depthWrite: false }));
  m.renderOrder = 4; m.visible = false; m.name = 'glass';
  return { mesh: m, u, set(L) { u.uRain.value = L.rain; u.uSnow.value = L.snow; u.uNight.value = L.night; m.visible = L.rain > 0.01 || L.snow > 0.01; } };
}

/* ------------------------------------------------------------ dust motes drifting in the window light (no CPU work per frame) */
const MOTE_VERT = /* glsl */`
attribute vec4 aR; uniform float uTime, uPx, uSize; varying float vA;
void main(){
  vec3 p = position;
  float ph = aR.x * 6.2831;
  p.x += sin(uTime * 0.13 + ph) * 0.35 * aR.y; p.z += cos(uTime * 0.11 + ph * 1.3) * 0.35 * aR.z;
  p.y += sin(uTime * 0.07 + ph * 0.7) * 0.25 + fract(uTime * 0.012 * (0.5 + aR.w) + aR.w) * 0.6 - 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + aR.w) * uPx / max(-mv.z, 0.4), 1.0, 5.0);
  vA = 0.5 + 0.5 * sin(uTime * (0.6 + aR.y) + ph);
}`;
const MOTE_FRAG = 'uniform vec3 uColor; uniform float uAmt; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uAmt; if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, 1.0); }';
export function createMotes(n = 260) {
  const g = new THREE.BufferGeometry(), r = rng(91), aR = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) aR[i] = r();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  const u = { uTime: { value: 0 }, uPx: { value: 700 }, uSize: { value: 0.028 }, uColor: { value: new THREE.Color('#ffe6b8') }, uAmt: { value: 0 } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.frustumCulled = false; m.renderOrder = 6; m.name = 'motes';
  /** place the motes: fn(rand) -> [x, y, z] (a point in the window light) */
  function scatter(fn) {
    const P = g.attributes.position.array, rr = rng(17);
    for (let i = 0; i < n; i++) { const q = fn(rr); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
    g.attributes.position.needsUpdate = true;
  }
  return { mesh: m, u, scatter };
}

/* ------------------------------------------------------------ steam from a cup or the espresso machine */
const STEAM_VERT = /* glsl */`
attribute vec4 aR; uniform float uTime, uPx, uH; varying float vA;
void main(){
  float k = fract(uTime * (0.18 + 0.1 * aR.x) + aR.y);
  vec3 p = position + vec3(sin(k * 6.0 + aR.z * 6.28) * 0.025 * (0.4 + k), k * uH, cos(k * 5.0 + aR.w * 6.28) * 0.02 * k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.035 + 0.08 * k) * uPx / max(-mv.z, 0.3), 1.0, 26.0);
  vA = smoothstep(0.0, 0.15, k) * (1.0 - k);
}`;
const STEAM_FRAG = 'uniform float uAmt; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA * 0.32 * uAmt; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.95, 0.96, 1.0), a); }';
export function createSteam(n = 16, height = 0.32) {
  const g = new THREE.BufferGeometry(), r = rng(n * 7 + 3), aR = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) aR[i] = r();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  const u = { uTime: { value: 0 }, uPx: { value: 700 }, uH: { value: height }, uAmt: { value: 1 } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STEAM_VERT, fragmentShader: STEAM_FRAG, uniforms: u, transparent: true, depthWrite: false }));
  m.frustumCulled = false; m.renderOrder = 7; m.name = 'steam';
  return { mesh: m, u };
}

/* ------------------------------------------------------------ a wall clock (face built into the room; two hands that move) */
export function clockHands(r, mats) {
  const grp = new THREE.Group(); grp.name = 'clock';
  const hand = (len, w, col) => { const g = new Geo(); g.box(-w / 2, -0.06 * len, 0, w / 2, len, 0.015, C(col)); const m = new THREE.Mesh(g.build(), mats.solid); grp.add(m); return m; };
  const hr = hand(r * 0.52, r * 0.07, '#1b1712'), mn = hand(r * 0.78, r * 0.05, '#1b1712'); mn.position.z = 0.012;
  const sec = hand(r * 0.82, r * 0.016, '#9b2a22'); sec.position.z = 0.024;
  return { group: grp, set(t) { hr.rotation.z = -((t.h % 12) + t.m / 60) / 12 * TAU; mn.rotation.z = -(t.m + t.s / 60) / 60 * TAU; sec.rotation.z = -t.s / 60 * TAU; } };
}
/** the clock's face (a brass bezel, an ivory dial, twelve ticks) facing +z at (x, y, z): coloured geometries for mergeColored() */
export function clockFace(x, y, z, r) {
  const face = new Geo(); face.cyl(0, 0, 0, 0.05, r * 1.14, r * 1.14, 24, C('#b08a3e')); face.cyl(0, 0, 0.05, 0.062, r, r, 24, C('#f3ecd8'));
  const fb = face.build(); fb.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  const out = [fb];
  for (let i = 0; i < 12; i++) {
    const l = i % 3 === 0 ? 0.17 : 0.09, w = i % 3 === 0 ? 0.035 : 0.02, tg = new Geo();
    tg.box(-w * r, r * (0.9 - l), 0, w * r, r * 0.9, 0.01, C('#2b2520'));
    const tb = tg.build(); tb.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z + 0.062).multiply(new THREE.Matrix4().makeRotationZ((i / 12) * TAU))); out.push(tb);
  }
  return out;
}

/* ------------------------------------------------------------ the crowd: every other person in a spot, one skinned-on-the-CPU mesh */
// Each person is a small hierarchy of Object3D pivots (pelvis, torso, head, shoulders, elbows, wrists, hips, knees) that the spot poses
// every frame; the parts' rest vertices are transformed by those pivots into one shared buffer (one draw call for everyone).
// The people come from human.js (docs/COZY.md 3b): varied builds, skin tones, hair and clothes, a subtle face, seeded per person.
// Two levels of detail: 'mid' (<= 800 triangles) near the camera and 'lo' far away; the index buffer only holds the level in use.
export function personLook(r) { return randomLook(r); }
const LOD_FAR = 11, LOD_NEAR = 9.5;                      // metres from the camera (with a little hysteresis)
export function createCrowd(looks) {
  const people = [], parts = [];
  let nv = 0, niMax = 0;
  for (const L of looks) {
    const N = () => new THREE.Object3D();
    const root = N(), pelvis = N(), torso = N(), head = N(), armL = N(), armR = N(), upL = N(), upR = N(), elbowL = N(), elbowR = N(), wristL = N(), wristR = N();
    const hipL = N(), hipR = N(), kneeL = N(), kneeR = N();
    root.add(pelvis); pelvis.add(torso); torso.add(head); pelvis.add(armL, armR); armL.add(upL); armR.add(upR); upL.add(elbowL); upR.add(elbowR); elbowL.add(wristL); elbowR.add(wristR);
    root.add(hipL, hipR); hipL.add(kneeL); hipR.add(kneeR);
    head.position.y = DIM.NECK_Y;
    armL.position.set(-DIM.SH_X, DIM.SH_Y, 0); armR.position.set(DIM.SH_X, DIM.SH_Y, 0); elbowL.position.y = elbowR.position.y = -DIM.UPPER; wristL.position.y = wristR.position.y = -DIM.FORE;
    hipL.position.x = -DIM.HIP_X; hipR.position.x = DIM.HIP_X; kneeL.position.y = kneeR.position.y = -DIM.THIGH;
    const person = { root, pelvis, torso, head, armL, armR, upL, upR, elbowL, elbowR, wristL, wristR, hipL, hipR, kneeL, kneeR, look: L, visible: true, st: {}, lod: 'mid', parts: { mid: [], lo: [] } };
    const spec = specOf(L);
    for (const det of ['mid', 'lo']) {
      const P = buildPerson(spec, det).parts;
      // index 0 of each pair is the figure's right side (x < 0): here armL / hipL sit at x < 0
      const list = [[P.torso, torso], [P.head, head], [P.upper[0], upL], [P.fore[0], elbowL], [P.hand[0], wristL], [P.upper[1], upR], [P.fore[1], elbowR], [P.hand[1], wristR],
        [P.thigh[0], hipL], [P.shin[0], kneeL], [P.thigh[1], hipR], [P.shin[1], kneeR]];
      if (P.glasses) list.push([P.glasses, head]);
      for (const [geo, node] of list) { const pt = { geo, node, person, v0: nv }; person.parts[det].push(pt); parts.push(pt); nv += geo.n; niMax += det === 'mid' ? geo.idx.length : 0; }
    }
    setSit(person); people.push(person);
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(Math.max(1, niMax));
  for (const pt of parts) col.set(pt.geo.col, pt.v0 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
  /** the index buffer holds each visible person at their level of detail */
  let idxKey = '';
  function reindex() {
    const key = people.map((p) => (p.visible ? p.lod[0] : '-')).join('');
    if (key === idxKey) return; idxKey = key;
    let k = 0;
    for (const p of people) { if (!p.visible) continue; for (const pt of p.parts[p.lod]) { const src = pt.geo.idx; for (let i = 0; i < src.length; i++) idx[k++] = src[i] + pt.v0; } }
    g.setDrawRange(0, k); g.index.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(g, figureMaterial()); mesh.frustumCulled = false; mesh.name = 'crowd';
  const cam = new THREE.Vector3(), wp = new THREE.Vector3(); let haveCam = false;
  mesh.onBeforeRender = (r, s, camera) => { camera.getWorldPosition(cam); haveCam = true; };
  const e = new Float32Array(16);
  /** pose every visible person into the shared buffer: elbows bend with the arm, palms turn down as hands reach forward */
  function skin() {
    for (const p of people) {
      for (const [arm, up, el, wr, s] of [[p.armL, p.upL, p.elbowL, p.wristL, -1], [p.armR, p.upR, p.elbowR, p.wristR, 1]]) {
        const ax = arm.rotation.x;
        if (-ax > 1.4 && -ax < 2.2 && s * arm.rotation.z > 0.25) { up.rotation.x = -0.6 - ax; el.rotation.x = -2.1; wr.rotation.y = 0; continue; }   // a hand at the chin
        const bend = 0.1 + 0.68 * Math.sin(clamp(-ax / 2.6, 0, 1) * Math.PI);
        up.rotation.x = 0.45 * (bend - 0.1); el.rotation.x = -bend;
        wr.rotation.y = -s * 1.2 * clamp((-ax - bend * 0.55) / 1.3, 0, 1);
      }
      p.root.updateMatrixWorld(true);
      if (haveCam && p.visible) { p.root.getWorldPosition(wp); const d = wp.distanceTo(cam); p.lod = p.lod === 'mid' ? (d > LOD_FAR ? 'lo' : 'mid') : (d < LOD_NEAR ? 'mid' : 'lo'); }
    }
    reindex();
    for (const p of people) {
      if (!p.visible) continue;
      for (const pt of p.parts[p.lod]) {
        const P = pt.geo.pos, Nn = pt.geo.nor, n = pt.geo.n, o = pt.v0 * 3;
        pt.node.matrixWorld.toArray(e);
        for (let i = 0; i < n; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], a = o + i * 3;
          pos[a] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[a + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[a + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const nx = Nn[i * 3], ny = Nn[i * 3 + 1], nz = Nn[i * 3 + 2];
          nor[a] = e[0] * nx + e[4] * ny + e[8] * nz; nor[a + 1] = e[1] * nx + e[5] * ny + e[9] * nz; nor[a + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
        }
      }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
  }
  reindex();
  return { mesh, people, skin, stats: () => ({ people: people.length, tris: g.drawRange.count / 3, lod: people.map((p) => p.lod) }), dispose() { g.dispose(); } };
}
/* poses for crowd people (and the same numbers drive the user's figure through character.js's pivots). Seated: thighs a little below
 * level so the feet reach the floor; the head looks down at the table. */
export function setSit(p, lean = 0) {
  p.pelvis.position.y = 0.53; p.pelvis.rotation.set(lean, 0, 0);
  p.hipL.position.y = p.hipR.position.y = 0.53; p.hipL.rotation.set(-Math.PI / 2 + 0.15, 0, 0); p.hipR.rotation.set(-Math.PI / 2 + 0.15, 0, 0);
  p.kneeL.rotation.set(Math.PI / 2 - 0.15, 0, 0); p.kneeR.rotation.set(Math.PI / 2 - 0.15, 0, 0);
  if (p.head) p.head.rotation.set(0.28, 0, 0);
}
export function setStand(p, lean = 0) {
  p.pelvis.position.y = 0.92; p.pelvis.rotation.set(lean, 0, 0);
  p.hipL.position.y = p.hipR.position.y = 0.92; p.hipL.rotation.set(0, 0, 0); p.hipR.rotation.set(0, 0, 0); p.kneeL.rotation.set(0.03, 0, 0); p.kneeR.rotation.set(0.03, 0, 0);
  if (p.head) p.head.rotation.set(0.05, 0, 0);
}
export function setWalk(p, ph) {
  setStand(p); const sw = Math.sin(ph);
  p.hipL.rotation.x = sw * 0.45; p.hipR.rotation.x = -sw * 0.45;
  p.kneeL.rotation.x = Math.max(0, -Math.cos(ph)) * 0.6 + 0.04; p.kneeR.rotation.x = Math.max(0, Math.cos(ph)) * 0.6 + 0.04;
  p.armL.rotation.set(-sw * 0.36, 0, -0.05); p.armR.rotation.set(sw * 0.36, 0, 0.05);
  p.pelvis.position.y = 0.91 + Math.abs(Math.cos(ph)) * 0.022; p.pelvis.rotation.y = sw * 0.06;
}
/** arm angles for a seated activity at time t (seconds); `ph` de-syncs people. Returns [lx, lz, rx, rz, lean] */
export function seatedArms(act, t, ph = 0) {
  switch (act) {
    case 'type': { const a = Math.sin(t * 13 + ph), b = Math.sin(t * 11.3 + ph * 1.7); return [-1.08 + a * 0.05, 0.08, -1.08 + b * 0.05, -0.08, 0.1 + 0.015 * Math.sin(t * 0.7 + ph)]; }
    case 'write': { return [-0.95, 0.12, -1.0 + Math.sin(t * 7 + ph) * 0.05, -0.1 + Math.sin(t * 3.1 + ph) * 0.12, 0.2]; }
    case 'read': {
      const c = ((t + ph * 3) % 9) / 9, turn = c > 0.86 ? Math.sin((c - 0.86) / 0.14 * Math.PI) : 0;        // a page turn every 9 s
      return [-0.85, 0.15, -0.85 - turn * 0.25, -0.15 - turn * 0.55, 0.16];
    }
    case 'think': return [-0.6, 0.05, -1.7, 0.35, -0.04 + 0.02 * Math.sin(t * 0.5 + ph)];        // a hand at the chin, leaning back a little
    case 'stretch': { const k = Math.sin(clamp(((t + ph) % 4) / 4, 0, 1) * Math.PI); return [-0.9 - k * 2.0, 0.15 + k * 0.2, -0.9 - k * 2.0, -0.15 - k * 0.2, -0.12 * k]; }
    case 'rest': return [-0.75, 0.05, -0.75, -0.05, -0.08];
    default: return [-0.2, 0.05, -0.2, -0.05, 0];
  }
}
export function applyArms(p, a) { p.armL.rotation.set(a[0], 0, a[1]); p.armR.rotation.set(a[2], 0, a[3]); p.pelvis.rotation.x = a[4] || 0; if (p.head) p.head.rotation.x = clamp(0.2 + (a[4] || 0) * 0.8 + (a[2] < -1.5 ? -0.15 : 0), -0.15, 0.45); }

/* ------------------------------------------------------------ furniture builders shared by the spots */
/** book spines along a shelf (the same idea as room.js books()) */
export function books(g, x0, x1, y, z0, z1, r, hmax = 0.26, cols = ['#7a3b2e', '#2f4d6e', '#d9c39a', '#3f6b4e', '#8c6a3a', '#5b4a7a', '#a5452f', '#e8e1cf', '#1f3a33', '#6b2430']) {
  let x = x0;
  while (x < x1 - 0.03) {
    const w = 0.025 + r() * 0.04, h = hmax * (0.6 + r() * 0.4); if (x + w > x1) break;
    if (r() < 0.04) { x += w + 0.02; continue; }                                   // a gap where a book is out
    g.box(x, y, z0, x + w, y + h, z1 - r() * 0.03, C(cols[Math.floor(r() * cols.length)]), { bottom: false });
    x += w + 0.003;
  }
}
/** books along z (for a shelf on a wall that runs along z) */
export function booksZ(g, z0, z1, y, x0, x1, r, hmax = 0.26) {
  const cols = ['#7a3b2e', '#2f4d6e', '#d9c39a', '#3f6b4e', '#8c6a3a', '#5b4a7a', '#a5452f', '#e8e1cf', '#1f3a33', '#6b2430'];
  let z = z0;
  while (z < z1 - 0.03) {
    const w = 0.025 + r() * 0.04, h = hmax * (0.6 + r() * 0.4); if (z + w > z1) break;
    if (r() < 0.04) { z += w + 0.02; continue; }
    const d = r() * 0.03; g.box(x0 + (x1 > x0 ? d : 0), y, z, x1 - (x1 < x0 ? d : 0), y + h, z + w, C(cols[Math.floor(r() * cols.length)]), { bottom: false });
    z += w + 0.003;
  }
}
/** a reading-room chair whose sitter faces +z; origin = the seat centre on the floor */
export function chairGeo(g, x, z, ry, wood) {
  const c = Math.cos(ry), s = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const box = (lx0, y0, lz0, lx1, y1, lz1, col) => { const a = P(lx0, lz0), b = P(lx1, lz1), q = P(lx0, lz1), d = P(lx1, lz0); g.box(Math.min(a[0], b[0], q[0], d[0]), y0, Math.min(a[1], b[1], q[1], d[1]), Math.max(a[0], b[0], q[0], d[0]), y1, Math.max(a[1], b[1], q[1], d[1]), col); };
  box(-0.22, 0.43, -0.2, 0.22, 0.48, 0.22, wood);
  for (const [lx, lz] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.19], [0.19, 0.19]]) box(lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.43, lz + 0.02, shade(wood, 0.8));
  box(-0.21, 0.48, -0.23, 0.21, 0.52, -0.19, wood); box(-0.21, 0.82, -0.24, 0.21, 0.92, -0.18, wood);
  for (const lx of [-0.19, -0.06, 0.06, 0.19]) box(lx - 0.012, 0.52, -0.225, lx + 0.012, 0.82, -0.2, shade(wood, 0.9));
}
/** a merged geometry from several THREE geometries that keep their own colours (Geo.addGeometry loses them) */
export function mergeColored(list) {
  let n = 0, ni = 0; for (const b of list) { n += b.attributes.position.count; ni += b.index ? b.index.count : b.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let v = 0, k = 0;
  for (const b of list) {
    const c = b.attributes.position.count; pos.set(b.attributes.position.array, v * 3); nor.set(b.attributes.normal.array, v * 3);
    if (b.attributes.color) col.set(b.attributes.color.array, v * 3); else col.fill(1, v * 3, (v + c) * 3);
    if (b.index) for (let i = 0; i < b.index.count; i++) idx[k++] = b.index.array[i] + v; else for (let i = 0; i < c; i++) idx[k++] = v + i;
    v += c;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
  return g;
}
/** a person's legs as a list of coloured geometries in world space (for mergeColored) */
export function seatedLegs(x, z, ry, L, y = 0) {
  const P = buildPerson(specOf(L), 'mid').parts, root = new THREE.Object3D(), hipL = new THREE.Object3D(), hipR = new THREE.Object3D(), kneeL = new THREE.Object3D(), kneeR = new THREE.Object3D();
  root.add(hipL, hipR); hipL.add(kneeL); hipR.add(kneeR); root.position.set(x, y, z); root.rotation.y = ry;
  hipL.position.set(-DIM.HIP_X, 0.53, 0); hipR.position.set(DIM.HIP_X, 0.53, 0); hipL.rotation.x = hipR.rotation.x = -Math.PI / 2 + 0.15; kneeL.position.y = kneeR.position.y = -DIM.THIGH; kneeL.rotation.x = kneeR.rotation.x = Math.PI / 2 - 0.15;
  root.updateMatrixWorld(true);
  return [[P.thigh[0], hipL], [P.thigh[1], hipR], [P.shin[0], kneeL], [P.shin[1], kneeR]].map(([geo, node]) => { const b = geo.build(); b.applyMatrix4(node.matrixWorld); return b; });
}
/** the green banker's lamp: brass foot and stem, a green glass shade; its bulb and the shade's glow go into gl (lamp material). Facing +z. */
export function bankersLamp(g, gl, x, y, z, ry = 0, shadeHex = '#1f6b47') {
  const brass = C('#b8913f'), c = Math.cos(ry), s = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [fx, fz] = P(0, -0.06); g.cyl(fx, fz, y, y + 0.025, 0.09, 0.08, 10, brass);
  g.cyl(fx, fz, y + 0.025, y + 0.33, 0.012, 0.012, 6, brass);
  // the shade: a half-pipe along the lamp's x axis, green glass outside
  const half = 0.17, sy = y + 0.34, segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = Math.PI * (i / segs), a1 = Math.PI * ((i + 1) / segs), r = 0.075;
    const pA = (a, lx) => { const ly = Math.sin(a) * r, lz = Math.cos(a) * r; const [px, pz] = P(lx, lz); return [px, sy + ly, pz]; };
    g.quad(pA(a0, -half), pA(a0, half), pA(a1, half), pA(a1, -half), C(shadeHex));
    g.quad(pA(a1, -half), pA(a1, half), pA(a0, half), pA(a0, -half), C('#f3e3b8'));
  }
  { const e = [P(-half + 0.02, -0.035), P(half - 0.02, 0.035), P(-half + 0.02, 0.035), P(half - 0.02, -0.035)], xs = e.map((q) => q[0]), zs = e.map((q) => q[1]);
    gl.box(Math.min(...xs), sy - 0.014, Math.min(...zs), Math.max(...xs), sy + 0.004, Math.max(...zs), hc('#ffd9a0', 2.4)); }
  return { x: P(0, 0)[0], y: sy, z: P(0, 0)[1] };
}
/** an open laptop facing a sitter on its -z side... the sitter faces +z, so the screen faces -z. (x,z) = the keyboard centre */
export function laptop(g, gl, x, y, z, ry = 0, open = true) {
  const c = Math.cos(ry), s = Math.sin(ry), P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  const body = C('#9aa4b5'), lid = C('#3f4b60');
  g.quad(P(-0.16, 0.012, -0.11), P(0.16, 0.012, -0.11), P(0.16, 0.012, 0.11), P(-0.16, 0.012, 0.11), body);
  g.quad(P(-0.16, 0, -0.11), P(-0.16, 0, 0.11), P(0.16, 0, 0.11), P(0.16, 0, -0.11), shade(body, 0.6));
  g.quad(P(-0.16, 0, 0.11), P(0.16, 0, 0.11), P(0.16, 0.012, 0.11), P(-0.16, 0.012, 0.11), shade(body, 0.85));
  if (open) {
    g.quad(P(0.16, 0.012, 0.11), P(-0.16, 0.012, 0.11), P(-0.16, 0.22, 0.16), P(0.16, 0.22, 0.16), lid);
    g.quad(P(-0.16, 0.012, 0.11), P(0.16, 0.012, 0.11), P(0.16, 0.22, 0.16), P(-0.16, 0.22, 0.16), lid);
    gl.quad(P(0.145, 0.03, 0.105), P(-0.145, 0.03, 0.105), P(-0.145, 0.205, 0.148), P(0.145, 0.205, 0.148), hc('#a8d4ff', 1.1));     // faces the sitter (-z)
  } else g.quad(P(-0.16, 0.022, -0.11), P(0.16, 0.022, -0.11), P(0.16, 0.022, 0.11), P(-0.16, 0.022, 0.11), lid);
}
/** an open book (two pages) lying on a table, spine along the sitter's x axis... spine along z: pages left/right of the sitter */
export function openBook(g, x, y, z, ry = 0, cover = '#7a3b2e') {
  const c = Math.cos(ry), s = Math.sin(ry), P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  g.quad(P(-0.17, 0.004, -0.12), P(-0.17, 0.004, 0.12), P(0.17, 0.004, 0.12), P(0.17, 0.004, -0.12), C(cover));
  g.quad(P(-0.16, 0.022, 0.11), P(0, 0.012, 0.11), P(0, 0.012, -0.11), P(-0.16, 0.022, -0.11), C('#f4eedf'));
  g.quad(P(0, 0.012, 0.11), P(0.16, 0.022, 0.11), P(0.16, 0.022, -0.11), P(0, 0.012, -0.11), C('#efe8d6'));
}
/** a soft contact shadow (blob decal) under furniture and people */
export function blob(q, x, y, z, w, d, k = 1) { q.flat(x, y, z, w, d, [k, k, k]); }
