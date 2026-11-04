// city/spots/butler2_hall.js · the shell of Butler 301 for butler2.js, built to docs/BUTLER-V2.md 12 (the user's photos in build/ref/butler/: reference only).
// Window wall (x = X0): 9 tall rectangular windows (2.0 x 8.3 m, sill 3.2 m) with dark steel mullions (4 x 10 panes) and an art-deco grille in the
//   lowest 2 rows; limestone pilasters with capitals between them; no arches. Opposite wall (x = X1): limestone ashlar #E8E0CF, 3 gilt-framed portraits
//   hung high, square bronze grilles, the central doorway with a round-arched pediment. Far end wall (z = Z1): a pedimented oak doorcase and an NYC clock.
// All round: a 2.6 m dark-oak bookcase band (~9k instanced books, many red / green / blue spines) topped by a wood cornice.
// Ceiling: gold / ochre coffers (#B8862E / #8A5A24) with gilded mouldings and recessed downlights; a deep stepped cornice. 5 three-ring brass chandeliers
//   (1.6 / 1.2 / 0.8 m, bottoms at 4.5 m) down the aisle. Floor: cream stone, black diamonds in the 3 m aisle, black squares on a 1.5 m grid elsewhere.
// Procedural only (canvas textures + merged / instanced geometry). buildHall(ctx) -> { glass, windows, chandLights, haloU, setLight(o), tickClock() }
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HALL = { X0: -7, X1: 7, Z0: -7, Z1: 17, H: 13, T: 0.6 };
export const WIN = { n: 9, pitch: 2.6, w: 2.0, sill: 3.2, top: 11.5, z0: -5.4, rows: 10, cols: 4 };
export const winZ = (k) => WIN.z0 + k * WIN.pitch;
export const BC = { h: 2.6, d: 0.42 };
export const DOOR = { z: 5.0, w: 1.4, h: 3.5 };
export const CHAND_Z = [-5.4, -0.2, 5.0, 10.2, 15.4], CHAND_Y = 4.5;

let seed = 11; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const uvScale = (g, k) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); return g; };
const V2 = (x, y) => new THREE.Vector2(x, y);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
export function rod(a, b, r0, r1 = r0, seg = 6) {        // a tapered cylinder from point a to point b
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); _d.subVectors(B, A); const l = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, l, seg, 1, false); _q.setFromUnitVectors(_up, _d.normalize());
  return g.applyMatrix4(_m.compose(A.add(B).multiplyScalar(0.5), _q, _s));
}

/* ---- canvas textures */
function drawAshlar(g, w) {                  // 2.4 m tile: 4 courses of 0.6 m, 1.2 m blocks, staggered joints
  const c = w / 4;
  for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) { const v = 0.955 + R() * 0.07; g.fillStyle = rgb(228 * v, 216 * v, 192 * v); g.fillRect(k * 2 * c + (r % 2) * c, r * c, 2 * c, c); }
  for (let i = 0; i < 14000; i++) { const d = R() < 0.5; g.fillStyle = d ? rgb(120, 104, 80, 0.06) : rgb(255, 250, 240, 0.08); g.fillRect(R() * w, R() * w, 1 + R() * 2, 1 + R() * 2); }
  g.strokeStyle = rgb(150, 136, 112, 0.55); g.lineWidth = 2;
  for (let r = 0; r < 4; r++) { g.beginPath(); g.moveTo(0, r * c + 1); g.lineTo(w, r * c + 1); g.stroke(); for (let k = 0; k < 3; k++) { const x = k * 2 * c + (r % 2) * c + 1; g.beginPath(); g.moveTo(x, r * c); g.lineTo(x, r * c + c); g.stroke(); } }
}
function drawCoffer(g, w) {                  // one coffer's painted panel: brown border, gold fret lines, a meander band, the warm ochre field, the downlight's ring
  g.fillStyle = '#7a4c1e'; g.fillRect(0, 0, w, w);
  const rect = (i, col) => { g.fillStyle = col; g.fillRect(i, i, w - 2 * i, w - 2 * i); }, line = (i, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(i, i, w - 2 * i, w - 2 * i); };
  rect(14, '#8a5a24'); line(44, '#d9b25a', 5); rect(54, '#a6742c');
  g.strokeStyle = '#7e5222'; g.lineWidth = 5;       // the meander (Greek key) band
  for (const side of [0, 1, 2, 3]) { g.save(); g.translate(w / 2, w / 2); g.rotate(side * Math.PI / 2); g.translate(-w / 2, -w / 2);
    for (let x = 70; x < w - 90; x += 34) { g.beginPath(); g.moveTo(x, 104); g.lineTo(x, 66); g.lineTo(x + 26, 66); g.lineTo(x + 26, 92); g.lineTo(x + 12, 92); g.lineTo(x + 12, 80); g.stroke(); } g.restore(); }
  line(114, '#d9b25a', 4); rect(122, '#b8862e');
  const gr = g.createRadialGradient(w / 2, w / 2, 10, w / 2, w / 2, w * 0.4); gr.addColorStop(0, 'rgba(232,190,110,0.55)'); gr.addColorStop(1, 'rgba(232,190,110,0)'); g.fillStyle = gr; g.fillRect(122, 122, w - 244, w - 244);
  line(170, 'rgba(140,92,36,0.8)', 3);
  for (let i = 0; i < 5000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(90,56,20,0.07)' : 'rgba(255,220,150,0.07)'; g.fillRect(R() * w, R() * w, 2, 2); }
  g.beginPath(); g.arc(w / 2, w / 2, 24, 0, 7); g.fillStyle = '#6a4418'; g.fill(); g.beginPath(); g.arc(w / 2, w / 2, 32, 0, 7); g.strokeStyle = '#e0bc66'; g.lineWidth = 3; g.stroke();
}
function drawFloor(g, w, h) {                // 1024 x 2048 = the whole floor (14 x 24 m): cream stone, terrazzo speckle, slab joints, the aisle's diamonds + border, squares elsewhere
  const { X0, X1, Z0, Z1 } = HALL, sx = w / (X1 - X0), sz = h / (Z1 - Z0), px = (x) => (x - X0) * sx, pz = (z) => (z - Z0) * sz;
  g.fillStyle = '#e8e0cf'; g.fillRect(0, 0, w, h);
  for (let x = X0; x < X1; x += 1.5) for (let z = Z0; z < Z1; z += 1.5) { const v = 0.97 + R() * 0.05; g.fillStyle = rgb(233 * v, 225 * v, 208 * v); g.fillRect(px(x), pz(z), 1.5 * sx, 1.5 * sz); }
  for (let i = 0; i < 90000; i++) { const t = R(); g.fillStyle = t < 0.4 ? 'rgba(120,110,95,0.35)' : t < 0.6 ? 'rgba(40,36,32,0.3)' : t < 0.8 ? 'rgba(170,140,110,0.3)' : 'rgba(255,255,250,0.4)'; g.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1 + R() * 1.5); }
  g.strokeStyle = 'rgba(150,138,118,0.5)'; g.lineWidth = 1.2;
  for (let x = X0; x <= X1; x += 1.5) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), h); g.stroke(); }
  for (let z = Z0; z <= Z1; z += 1.5) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(w, pz(z)); g.stroke(); }
  g.fillStyle = '#16151a';
  const sq = (x, z, s, rot) => { g.save(); g.translate(px(x), pz(z)); if (rot) g.rotate(Math.PI / 4); g.fillRect(-s * sx / 2, -s * sz / 2, s * sx, s * sz); g.restore(); };
  for (let x = X0 + 1.5; x < X1; x += 1.5) for (let z = Z0 + 1.5; z < Z1; z += 1.5) if (Math.abs(x) > 1.6) sq(x, z, 0.3, false);
  g.fillStyle = '#e4dccb'; g.fillRect(px(-1.5), 0, 3 * sx, h);                                     // the aisle: a lighter field, a dark border, the diamonds
  for (let i = 0; i < 26000; i++) { const t = R(); g.fillStyle = t < 0.5 ? 'rgba(120,110,95,0.3)' : 'rgba(255,255,250,0.35)'; g.fillRect(px(-1.5) + R() * 3 * sx, R() * h, 1.4, 1.4); }
  g.fillStyle = '#2a2622'; g.fillRect(px(-1.5) - 2, 0, 5, h); g.fillRect(px(1.5) - 3, 0, 5, h);
  g.fillStyle = '#16151a';
  for (let z = Z0 + 0.6; z < Z1; z += 1.2) { sq(-0.75, z, 0.32, true); sq(0.75, z, 0.32, true); sq(0, z + 0.6, 0.32, true); }
}
function drawGrille(g, w, h) {               // a fine art-deco grille for the lowest ~1.7 panes: thin bars, a small motif per cell (alpha: the bars)
  g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineCap = 'round'; const nc = 8, nr = 3, cw = w / nc, ch = h / nr;
  g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  for (let c = 0; c < nc; c++) for (let r = 0; r < nr; r++) { const x = c * cw, y = r * ch, cx = x + cw / 2, cy = y + ch / 2;
    g.lineWidth = 2.6; g.beginPath(); g.moveTo(cx, y + 4); g.lineTo(x + cw - 4, cy); g.lineTo(cx, y + ch - 4); g.lineTo(x + 4, cy); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx, y + ch * 0.32); g.lineTo(x + cw * 0.68, cy); g.lineTo(cx, y + ch * 0.68); g.lineTo(x + cw * 0.32, cy); g.closePath(); g.stroke();
    g.lineWidth = 3.2; g.strokeRect(x, y, cw, ch); }
}
function drawBronze(g, w) {                  // a small square bronze ventilation grille
  g.fillStyle = '#1b140d'; g.fillRect(0, 0, w, w); g.strokeStyle = '#9a7646'; g.lineWidth = 7; g.strokeRect(6, 6, w - 12, w - 12);
  g.lineWidth = 4; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(k * w / 4, 10); g.lineTo(k * w / 4, w - 10); g.stroke(); g.beginPath(); g.moveTo(10, k * w / 4); g.lineTo(w - 10, k * w / 4); g.stroke(); }
  g.lineWidth = 5; g.beginPath(); g.arc(w / 2, w / 2, w * 0.2, 0, 7); g.stroke(); for (let a = 0; a < 8; a++) { g.beginPath(); g.arc(w / 2 + Math.cos(a * Math.PI / 4) * w * 0.2, w / 2 + Math.sin(a * Math.PI / 4) * w * 0.2, w * 0.07, 0, 7); g.stroke(); }
}
function drawPortraits(g, w, h) {            // 3 dark oil portraits side by side (an atlas): umber ground, a sitter in a dark coat, a lit face
  const P = [['#5a4630', '#1c1612', '#b48a64', '#2a1e14'], ['#4a4434', '#231a14', '#c09a72', '#6a6a6a'], ['#5c3a28', '#2a1c16', '#b08060', '#1a1410']];
  P.forEach(([bg, coat, skin, hair], i) => { const x0 = i * w / 3, pw = w / 3;
    const gr = g.createRadialGradient(x0 + pw * 0.45, h * 0.35, 8, x0 + pw / 2, h * 0.5, h * 0.75); gr.addColorStop(0, bg); gr.addColorStop(1, '#0e0905'); g.fillStyle = gr; g.fillRect(x0, 0, pw, h);
    g.fillStyle = coat; g.beginPath(); g.moveTo(x0 + pw * 0.08, h); g.quadraticCurveTo(x0 + pw * 0.14, h * 0.58, x0 + pw * 0.5, h * 0.55); g.quadraticCurveTo(x0 + pw * 0.86, h * 0.58, x0 + pw * 0.92, h); g.fill();
    g.fillStyle = '#d9cfb6'; g.beginPath(); g.moveTo(x0 + pw * 0.43, h * 0.56); g.lineTo(x0 + pw * 0.57, h * 0.56); g.lineTo(x0 + pw * 0.5, h * 0.7); g.fill();
    const fg = g.createRadialGradient(x0 + pw * 0.47, h * 0.36, 2, x0 + pw * 0.5, h * 0.38, pw * 0.16); fg.addColorStop(0, '#e2bc92'); fg.addColorStop(1, skin); g.fillStyle = fg;
    g.beginPath(); g.ellipse(x0 + pw * 0.5, h * 0.39, pw * 0.13, h * 0.13, 0, 0, 7); g.fill();
    g.fillStyle = hair; g.beginPath(); g.ellipse(x0 + pw * 0.5, h * 0.3, pw * 0.14, h * 0.07, 0, Math.PI, 0); g.fill();
    for (let k = 0; k < 2500; k++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,230,180,0.05)'; g.fillRect(x0 + R() * pw, R() * h, 2, 2); } });
}

export function buildHall(ctx) {
  const { scene, M, box, mesh, merged, tex, ROOM, rigVols, solid } = ctx, { X0, X1, Z0, Z1, H, T } = HALL, TILE = 2.4;
  const plNor = tex(new URL('tex/plaster_wall_nor.webp', ROOM));
  M.ashlar = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, drawAshlar), normalMap: plNor, normalScale: V2(0.45, 0.45), roughness: 0.9 });
  M.lime = new THREE.MeshStandardMaterial({ color: 0xe9dfca, normalMap: plNor, normalScale: V2(0.35, 0.35), roughness: 0.85 });
  M.gild = new THREE.MeshStandardMaterial({ color: 0xb8862e, roughness: 0.55, metalness: 0.25, emissive: 0x4a2a08, emissiveIntensity: 0 });
  M.gilt = new THREE.MeshStandardMaterial({ color: 0xe0b860, roughness: 0.32, metalness: 0.75, emissive: 0x6a4410, emissiveIntensity: 0 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.55 });
  M.voidm = new THREE.MeshBasicMaterial({ color: 0x120e0a });
  const cofT = canvasTex(512, 512, drawCoffer);
  M.coffer = new THREE.MeshStandardMaterial({ map: cofT, roughness: 0.6, metalness: 0.1, emissive: 0xffffff, emissiveMap: cofT, emissiveIntensity: 0 });
  const floorT = canvasTex(1024, 2048, drawFloor); floorT.wrapS = floorT.wrapT = THREE.ClampToEdgeWrapping;
  M.floorStone = new THREE.MeshStandardMaterial({ map: floorT, color: 0xdcd4c4, roughness: 0.45, metalness: 0 });

  /* floor */
  { const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2); mesh(g, M.floorStone, false, true); }
  /* walls: the opposite wall + both end walls (planes), the window wall (a slab with 9 openings; it casts the sun's shadow) */
  const plane = (w, h, x, y, z, ry) => { const g = new THREE.PlaneGeometry(w, h); uvScale(g, 1); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * h / TILE); return g.rotateY(ry).translate(x, y, z); };
  merged([plane(Z1 - Z0, H, X1, H / 2, (Z0 + Z1) / 2, -Math.PI / 2), plane(X1 - X0, H, 0, H / 2, Z0, 0), plane(X1 - X0, H, 0, H / 2, Z1, Math.PI)], M.ashlar, true, true);
  const windows = [];
  { const sh = new THREE.Shape([V2(Z0, 0), V2(Z1, 0), V2(Z1, H), V2(Z0, H)]);
    for (let k = 0; k < WIN.n; k++) { const z = winZ(k), a = z - WIN.w / 2, b = z + WIN.w / 2; windows.push({ k, z, a, b }); sh.holes.push(new THREE.Path([V2(a, WIN.sill), V2(a, WIN.top), V2(b, WIN.top), V2(b, WIN.sill)])); }
    const g = uvScale(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false }), 1 / TILE);
    const m = mesh(g, [M.ashlar, M.lime], true, true); m.rotation.y = -Math.PI / 2; m.position.x = X0; }
  /* the windows: steel frames + mullions (4 x 10 panes), stone sills, the fine bronze art-deco grille over the lowest ~17%, the glass (the campus view) */
  { const S = [], L = [], xm = X0 - T * 0.5, pane = (WIN.top - WIN.sill) / WIN.rows;
    for (const { z, a, b } of windows) {
      S.push(box(0.1, WIN.top - WIN.sill, 0.1, xm, WIN.sill, a + 0.05), box(0.1, WIN.top - WIN.sill, 0.1, xm, WIN.sill, b - 0.05), box(0.1, 0.1, WIN.w, xm, WIN.top - 0.1, z), box(0.1, 0.08, WIN.w, xm, WIN.sill, z));
      for (const dz of [-WIN.w / 4, WIN.w / 4]) S.push(box(0.04, WIN.top - WIN.sill, 0.03, xm, WIN.sill, z + dz));
      S.push(box(0.05, WIN.top - WIN.sill, 0.05, xm, WIN.sill, z));
      for (let r = 1; r < WIN.rows; r++) S.push(box(0.04, r % 5 === 0 ? 0.05 : 0.03, WIN.w, xm, WIN.sill + r * pane - 0.02, z));
      L.push(box(T + 0.1, 0.1, WIN.w + 0.06, X0 - T / 2 + 0.05, WIN.sill - 0.1, z), box(0.08, 0.06, WIN.w + 0.3, X0 + 0.04, WIN.sill - 0.16, z));
    }
    merged(S, M.steel, true, true); merged(L, M.lime, true, true);
    const gt = canvasTex(512, 384, drawGrille, true); gt.wrapS = gt.wrapT = THREE.ClampToEdgeWrapping; gt.anisotropy = 8;
    M.grille = new THREE.MeshStandardMaterial({ color: 0x4a3a26, map: gt, alphaTest: 0.3, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
    const G = windows.map(({ z }) => new THREE.PlaneGeometry(WIN.w - 0.1, 1.7 * pane - 0.04).rotateY(Math.PI / 2).translate(xm + 0.04, WIN.sill + 0.85 * pane, z));
    merged(G, M.grille, true, false);
    const pos = [], uv = [], idx = [], xg = X0 - T * 0.62;
    windows.forEach(({ k, a, b }, i) => { const c = 0.72 - 0.44 * k / (WIN.n - 1), hw = 0.11, o = i * 4;
      pos.push(xg, WIN.sill, a, xg, WIN.sill, b, xg, WIN.top, b, xg, WIN.top, a); uv.push(c + hw, 0, c - hw, 0, c - hw, 1, c + hw, 1); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    var glass = mesh(g, M.glass, false, false); }
  /* pilasters (both long walls on the window pier lines, the end walls at x = +-3.5): base, shaft, a simple capital */
  const PZ = Array.from({ length: WIN.n + 1 }, (_, k) => winZ(k) - WIN.pitch / 2), P0 = BC.h + 0.18, P1 = 11.35;
  { const S = [];
    for (const [k, z] of PZ.entries()) { const w = k === 0 || k === WIN.n ? 0.6 : 0.8;
      for (const [x, s] of [[X0, 1], [X1, -1]]) { const px = (p) => x + s * p / 2;
        S.push(box(0.16, P1 - P0, w, px(0.16), P0, z), box(0.22, 0.26, w + 0.1, px(0.22), P0, z), box(0.22, 0.15, w + 0.08, px(0.22), P1, z), box(0.3, 0.25, w + 0.2, px(0.3), P1 + 0.15, z)); } }
    for (const z of [Z0, Z1]) for (const x of [-3.5, 3.5]) { const s = z === Z0 ? 1 : -1, pz = (p) => z + s * p / 2;
      S.push(box(0.8, P1 - P0, 0.16, x, P0, pz(0.16)), box(0.9, 0.26, 0.22, x, P0, pz(0.22)), box(0.88, 0.15, 0.22, x, P1, pz(0.22)), box(1.0, 0.25, 0.3, x, P1 + 0.15, pz(0.3))); }
    merged(S, M.lime, false, true); }
  /* the cornice where the walls meet the ceiling: frieze, a gilt bed moulding, the ochre corona and crown */
  { const C = { lime: [], gilt: [], gild: [] };
    for (const [y0, y1, p, m] of [[11.75, 12.2, 0.12, 'lime'], [12.2, 12.32, 0.24, 'gilt'], [12.32, 12.72, 0.46, 'gild'], [12.72, 12.8, 0.56, 'gilt'], [12.8, 13.0, 0.68, 'gild']])
      C[m].push(box(p, y1 - y0, Z1 - Z0, X0 + p / 2, y0, (Z0 + Z1) / 2), box(p, y1 - y0, Z1 - Z0, X1 - p / 2, y0, (Z0 + Z1) / 2), box(X1 - X0, y1 - y0, p, 0, y0, Z0 + p / 2), box(X1 - X0, y1 - y0, p, 0, y0, Z1 - p / 2));
    merged(C.lime, M.lime, false, true); merged(C.gilt, M.gilt, false, false); merged(C.gild, M.gild, false, false); }
  /* the coffered ceiling: 5 x 9 coffers on the window bays, ochre beams, two nested gilt mouldings per coffer, the painted panel, recessed downlights */
  const CX = [0, 1, 2, 3, 4, 5].map((i) => -6.35 + i * 2.54), haloP = [], haloS = [];
  { const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(Math.PI / 2).translate(0, H, (Z0 + Z1) / 2), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - CX[0]) / 2.54, (p.getZ(i) - PZ[0]) / WIN.pitch);
    mesh(g, M.coffer, true, false);
    const B = [], Mo = [], D = [], m4 = new THREE.Matrix4();
    for (const x of CX) B.push(box(0.4, 0.42, PZ[WIN.n] - PZ[0] + 0.4, x, H - 0.42, (PZ[0] + PZ[WIN.n]) / 2));
    for (const z of PZ) B.push(box(CX[5] - CX[0] + 0.4, 0.42, 0.4, 0, H - 0.42, z));
    merged(B, M.gild, false, false);
    for (let i = 0; i < 5; i++) for (let j = 0; j < WIN.n; j++) {
      const x0 = CX[i] + 0.2, x1 = CX[i + 1] - 0.2, z0 = PZ[j] + 0.2, z1 = PZ[j + 1] - 0.2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (const [ins, w, d] of [[0.04, 0.08, 0.16], [0.3, 0.06, 0.08]]) { const a0 = x0 + ins, a1 = x1 - ins, b0 = z0 + ins, b1 = z1 - ins;
        Mo.push(box(a1 - a0, d, w, cx, H - d, b0 + w / 2), box(a1 - a0, d, w, cx, H - d, b1 - w / 2), box(w, d, b1 - b0 - 2 * w, a0 + w / 2, H - d, cz), box(w, d, b1 - b0 - 2 * w, a1 - w / 2, H - d, cz)); }
      const pts = [[cx - 0.62, cz - 0.62], [cx + 0.62, cz - 0.62], [cx - 0.62, cz + 0.62], [cx + 0.62, cz + 0.62]];
      if (!(i === 2 && CHAND_Z.some((q) => Math.abs(q - cz) < 0.3))) pts.push([cx, cz]);
      for (const [x, z] of pts) { D.push(m4.makeTranslation(x, H - 0.005, z).clone()); haloP.push(x, H - 0.06, z); haloS.push(0.42); }
    }
    for (const z of PZ.slice(1, -1)) for (const x of [-6.0, 6.0]) { D.push(m4.makeTranslation(x, H - 0.425, z).clone()); haloP.push(x, H - 0.48, z); haloS.push(0.42); }
    merged(Mo, M.gilt, false, false);
    M.down = new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false });
    const dl = new THREE.InstancedMesh(new THREE.CircleGeometry(0.065, 10).rotateX(Math.PI / 2), M.down, D.length); D.forEach((q, i) => dl.setMatrixAt(i, q)); scene.add(dl);
    var downCount = D.length; }
  /* the bookcase band: 2.6 m of dark oak all round (breaks for the doors), 6 shelves, a wood cornice; books instanced (back + bottom faces dropped) */
  const SHELF = [0.1, 0.5, 0.9, 1.3, 1.7, 2.1], carc = [], books = [];
  const PAL = [0x7a1c18, 0x8e2a1e, 0x5a1e1a, 0x9a3a24, 0x24432f, 0x2f5a3c, 0x1f3a2c, 0x1f3358, 0x2a4a7a, 0x223050, 0x6b4a2a, 0x3c2a22, 0xa08a5a, 0x4a1f2a, 0x2e2e2e, 0xc9b48a, 0x7a5a2a];
  function run(axis, wc, inw, u0, u1) {
    const d = BC.d, L = u1 - u0, mid = (u0 + u1) / 2, nb = Math.max(1, Math.round(L / 0.95)), bw = L / nb;
    const B = (us, h, vs, uc, y, vc) => (axis === 'z' ? box(vs, h, us, wc + inw * vc, y, uc, 0.6) : box(us, h, vs, uc, y, wc + inw * vc, 0.6));
    carc.push(B(L, BC.h, 0.02, mid, 0, 0.01), B(L, 0.1, 0.03, mid, 0, d - 0.015), B(L, 0.15, d, mid, BC.h - 0.15, d / 2));
    for (let i = 0; i <= nb; i++) carc.push(B(0.05, BC.h - 0.15, d, Math.min(u1 - 0.025, Math.max(u0 + 0.025, u0 + i * bw)), 0, d / 2));
    for (const y of SHELF) carc.push(B(L, 0.03, d - 0.02, mid, y - 0.03, d / 2));
    carc.push(B(L, 0.06, d + 0.05, mid, BC.h, (d + 0.05) / 2), B(L, 0.07, d + 0.1, mid, BC.h + 0.06, (d + 0.1) / 2), B(L, 0.05, d + 0.15, mid, BC.h + 0.13, (d + 0.15) / 2));
    const ry = axis === 'z' ? inw * Math.PI / 2 : inw > 0 ? 0 : Math.PI;
    for (let b = 0; b < nb; b++) for (let s = 0; s < SHELF.length; s++) {
      const gap = (s + 1 < SHELF.length ? SHELF[s + 1] - 0.03 : BC.h - 0.15) - SHELF[s], e = u0 + (b + 1) * bw - 0.03;
      let u = u0 + b * bw + 0.03; const hb = Math.min(0.34, gap - 0.04) * (0.74 + R() * 0.2);
      while (u < e - 0.03) {
        if (R() < 0.035) { u += 0.05 + R() * 0.1; continue; }
        const w = 0.022 + R() * 0.035, h = hb * (0.82 + R() * 0.18), dd = 0.17 + R() * 0.08; if (u + w > e) break;
        const lean = u + w > e - 0.12 && R() < 0.25 ? (R() - 0.5) * 0.5 : 0, v = d - 0.03 - dd / 2 - R() * 0.015;
        books.push({ x: axis === 'z' ? wc + inw * v : u + w / 2, z: axis === 'z' ? u + w / 2 : wc + inw * v, y: SHELF[s], w, h, d: dd, ry, lean, c: PAL[(R() * PAL.length) | 0] }); u += w + 0.001;
      }
    }
    const v0 = wc, v1 = wc + inw * (d + 0.15), b = axis === 'z' ? [Math.min(v0, v1), u0, Math.max(v0, v1), u1] : [u0, Math.min(v0, v1), u1, Math.max(v0, v1)];
    rigVols.push({ name: 'bookcase', kind: 'shell', b: [b[0], 0, b[1], b[2], BC.h + 0.2, b[3]] }); solid.push({ name: 'bookcase', b });
  }
  run('z', X0, 1, Z0, Z1); run('z', X1, -1, Z0, DOOR.z - 0.98); run('z', X1, -1, DOOR.z + 0.98, Z1);
  run('x', Z0, 1, X0 + BC.d, X1 - BC.d); run('x', Z1, -1, X0 + BC.d, -1.08); run('x', Z1, -1, 1.08, X1 - BC.d);
  merged(carc, M.oakMid || M.oakDark, true, true);
  M.book = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, normalMap: M.leather.normalMap, normalScale: V2(0.4, 0.4) });
  { const bg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), ia = bg.index.array; bg.setIndex([...ia.slice(0, 18), ...ia.slice(24, 30)]); bg.clearGroups();
    const im = new THREE.InstancedMesh(bg, M.book, books.length), o = new THREE.Object3D(), col = new THREE.Color();
    books.forEach((q, i) => { o.position.set(q.x, q.y, q.z); o.rotation.set(0, q.ry, q.lean); o.scale.set(q.w, q.h, q.d); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, col.setHex(q.c).multiplyScalar(1.15)); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  /* the opposite wall: the central doorway (classical surround, round-arched pediment), 3 gilt-framed portraits hung high, square bronze grilles */
  { const S = [], dz = DOOR.z, hw = DOOR.w / 2;
    mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h).rotateY(-Math.PI / 2).translate(X1 - 0.004, DOOR.h / 2, dz), M.voidm, false, false);
    S.push(box(0.12, DOOR.h + 0.18, 0.18, X1 - 0.06, 0, dz - hw - 0.09), box(0.12, DOOR.h + 0.18, 0.18, X1 - 0.06, 0, dz + hw + 0.09), box(0.12, 0.18, DOOR.w, X1 - 0.06, DOOR.h, dz));
    S.push(box(0.2, 0.32, DOOR.w + 0.6, X1 - 0.1, DOOR.h + 0.18, dz), box(0.3, 0.1, DOOR.w + 0.8, X1 - 0.15, DOOR.h + 0.5, dz));
    const yb = DOOR.h + 0.6, ar = new THREE.Shape(); ar.absarc(0, 0, 1.12, 0, Math.PI, false); ar.lineTo(-0.9, 0); ar.absarc(0, 0, 0.9, Math.PI, 0, true); ar.lineTo(1.12, 0);
    const ag = new THREE.ExtrudeGeometry(ar, { depth: 0.24, bevelEnabled: false, curveSegments: 24 }); uvScale(ag, 1 / TILE);
    const am = mesh(ag, M.lime, false, true); am.rotation.y = -Math.PI / 2; am.position.set(X1, yb, dz);
    const tg = new THREE.ShapeGeometry(new THREE.Shape().absarc(0, 0, 0.9, 0, Math.PI, false), 24); const tm = mesh(tg, M.lime, false, true); tm.rotation.y = -Math.PI / 2; tm.position.set(X1 - 0.06, yb, dz);
    S.push(box(0.3, 0.34, 0.26, X1 - 0.15, yb + 0.84, dz));
    merged(S, M.lime, false, true);
    const pt = canvasTex(768, 320, drawPortraits); pt.wrapS = pt.wrapT = THREE.ClampToEdgeWrapping; M.portrait = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.55 });
    const PG = [], F = [], pw = 1.45, ph = 1.85, py = 7.3;
    [winZ(2), winZ(6), winZ(8)].forEach((z, i) => { const g = new THREE.PlaneGeometry(pw, ph), uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
      PG.push(g.rotateY(-Math.PI / 2).translate(X1 - 0.07, py, z));
      F.push(box(0.12, 0.16, pw + 0.32, X1 - 0.06, py - ph / 2 - 0.16, z), box(0.12, 0.16, pw + 0.32, X1 - 0.06, py + ph / 2, z), box(0.12, ph, 0.16, X1 - 0.06, py - ph / 2, z - pw / 2 - 0.08), box(0.12, ph, 0.16, X1 - 0.06, py - ph / 2, z + pw / 2 + 0.08)); });
    merged(PG, M.portrait, false, true); merged(F, M.gilt, false, true);
    const bt = canvasTex(128, 128, drawBronze); M.bronze = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.45, metalness: 0.5 });
    const GG = []; for (let k = 0; k < WIN.n; k++) if (k !== 4) GG.push(new THREE.PlaneGeometry(0.5, 0.5).rotateY(-Math.PI / 2).translate(X1 - 0.01, 4.3, winZ(k)));
    merged(GG, M.bronze, false, true); }
  /* the far end wall: a small pedimented oak doorcase, the clock above it (NYC time) */
  const clock = {};
  { const S = [], zf = Z1;
    mesh(new THREE.PlaneGeometry(1.3, 2.4).rotateY(Math.PI).translate(0, 1.2, zf - 0.004), M.voidm, false, false);
    S.push(box(0.16, 2.56, 0.12, -0.73, 0, zf - 0.06), box(0.16, 2.56, 0.12, 0.73, 0, zf - 0.06), box(1.3, 0.16, 0.12, 0, 2.4, zf - 0.06), box(1.9, 0.3, 0.16, 0, 2.56, zf - 0.08), box(2.1, 0.08, 0.26, 0, 2.86, zf - 0.13));
    const tri = new THREE.ExtrudeGeometry(new THREE.Shape([V2(-1.02, 0), V2(1.02, 0), V2(0, 0.52)]), { depth: 0.2, bevelEnabled: false }); tri.translate(0, 2.94, zf - 0.22); mesh(tri, M.oakDark, false, true);
    merged(S, M.oakDark, false, true);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; clock.cv = cv; clock.t = new THREE.CanvasTexture(cv); clock.t.colorSpace = THREE.SRGBColorSpace;
    M.clock = new THREE.MeshStandardMaterial({ map: clock.t, roughness: 0.5, emissive: 0xffffff, emissiveMap: clock.t, emissiveIntensity: 0 });
    mesh(new THREE.CircleGeometry(0.42, 40).rotateY(Math.PI).translate(0, 4.3, zf - 0.05), M.clock, false, false);
    mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 40).translate(0, 4.3, zf - 0.05), M.brass, false, false); }
  function tickClock() {
    let hh = 0, mm = 0; try { for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date())) { if (p.type === 'hour') hh = +p.value; if (p.type === 'minute') mm = +p.value; } } catch { const d = new Date(); hh = d.getHours(); mm = d.getMinutes(); }
    if (clock.last === hh * 60 + mm) return; clock.last = hh * 60 + mm;
    const g = clock.cv.getContext('2d'), c = 128; g.fillStyle = '#f2ead8'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#2a2016'; g.fillStyle = '#2a2016';
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r0 = i % 5 ? 112 : 98; g.lineWidth = i % 5 ? 2 : 6; g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * 120, c - Math.cos(a) * 120); g.stroke(); }
    const hand = (a, l, w) => { g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(c - Math.sin(a) * 14, c + Math.cos(a) * 14); g.lineTo(c + Math.sin(a) * l, c - Math.cos(a) * l); g.stroke(); };
    hand(((hh % 12) + mm / 60) / 12 * Math.PI * 2, 62, 9); hand(mm / 60 * Math.PI * 2, 94, 5); g.beginPath(); g.arc(c, c, 8, 0, 7); g.fill(); clock.t.needsUpdate = true;
  }
  tickClock();
  /* the chandeliers: 3 stacked brass rings of candle bulbs (1.6 / 1.2 / 0.8 m), a stem, a long chain to a ceiling canopy; a warm point light in each */
  const chandLights = [], sleeves = [], bulbs = [];
  { const G = [];
    for (const cz of CHAND_Z) {
      const rings = [[0.8, CHAND_Y + 0.12, 16], [0.6, CHAND_Y + 0.74, 12], [0.4, CHAND_Y + 1.3, 8]];
      for (const [r, y, n] of rings) {
        G.push(new THREE.TorusGeometry(r, 0.024, 6, 48).rotateX(Math.PI / 2).translate(0, y, cz), new THREE.TorusGeometry(r * 0.94, 0.012, 4, 40).rotateX(Math.PI / 2).translate(0, y - 0.07, cz));
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; G.push(rod([0, y - 0.1, cz], [Math.cos(a) * r, y, cz + Math.sin(a) * r], 0.009, 0.009, 4)); }
        for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2, x = Math.cos(a) * r, z = cz + Math.sin(a) * r; sleeves.push([x, y + 0.02, z]); bulbs.push([x, y + 0.15, z]); haloP.push(x, y + 0.15, z); haloS.push(0.3); }
      }
      G.push(rod([0, CHAND_Y - 0.12, cz], [0, CHAND_Y + 1.55, cz], 0.035, 0.03, 8));
      for (const [y, r] of [[CHAND_Y - 0.12, 0.07], [CHAND_Y + 0.6, 0.06], [CHAND_Y + 1.2, 0.05]]) G.push(new THREE.SphereGeometry(r, 10, 8).translate(0, y, cz));
      G.push(new THREE.ConeGeometry(0.16, 0.22, 10).rotateX(Math.PI).translate(0, CHAND_Y + 1.62, cz), rod([0, CHAND_Y + 1.7, cz], [0, H - 0.42, cz], 0.016, 0.016, 5), new THREE.CylinderGeometry(0.13, 0.2, 0.12, 14).translate(0, H - 0.48, cz));
      const pl = new THREE.PointLight(0xffc98a, 0, 26, 2); pl.position.set(0, CHAND_Y + 0.7, cz); scene.add(pl); chandLights.push(pl);
    }
    mesh(mergeGeometries(G), M.brass, false, false);
    const sl = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 6).translate(0, 0.055, 0), M.paper, sleeves.length), bl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6).scale(1, 1.35, 1), M.down, bulbs.length), m4 = new THREE.Matrix4();
    sleeves.forEach((p, i) => sl.setMatrixAt(i, m4.makeTranslation(...p))); bulbs.forEach((p, i) => bl.setMatrixAt(i, m4.makeTranslation(...p))); scene.add(sl, bl); }
  /* recycling bins (blue + green) at two aisle ends */
  { const G = [];
    for (const [x, z, c] of [[-1.32, 3.2, 0x2456a8], [1.32, 3.2, 0x2f6a3a], [-1.32, 10.6, 0x2f6a3a], [1.32, 10.6, 0x2456a8]]) {
      for (const g of [box(0.34, 0.72, 0.34, x, 0, z), box(0.36, 0.05, 0.36, x, 0.72, z)]) { const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); G.push(g); }
      rigVols.push({ name: 'bin', kind: 'chair', b: [x - 0.18, 0, z - 0.18, x + 0.18, 0.77, z + 0.18] }); solid.push({ name: 'bin', b: [x - 0.18, z - 0.18, x + 0.18, z + 0.18] }); }
    M.bin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }); merged(G, M.bin, true, true); }
  /* glow halos (downlights + candle bulbs): additive points, one draw call */
  const haloU = { uC: { value: new THREE.Color(0xffd9a0) }, uI: { value: 0.3 }, uPx: { value: 600 } };
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(haloP, 3)); g.setAttribute('sz', new THREE.Float32BufferAttribute(haloS, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'attribute float sz; uniform float uPx; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(256.0, uPx * sz / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uC; uniform float uI; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = (exp(-r * r * 6.0) * 0.8 + exp(-r * r * 40.0)) * (1.0 - smoothstep(0.85, 1.0, r)) * uI; gl_FragColor = vec4(uC * a, 1.0); }' }));
    pts.frustumCulled = false; scene.add(pts); }

  function setLight(o) {          // o: { night, ch (chandelier cd), ceil (ceiling glow), halo, down (downlight colour scale) }
    chandLights.forEach((l, i) => { l.intensity = o.ch * (i === CHAND_Z.length - 1 ? 0.45 : 1); });   // the last one hangs 1.6 m from the end wall
    M.coffer.emissiveIntensity = o.ceil; M.gild.emissiveIntensity = o.ceil * 1.6; M.gilt.emissiveIntensity = o.ceil * 1.2; M.clock.emissiveIntensity = o.night ? 0.25 : 0;
    haloU.uI.value = o.halo; M.down.color.setRGB(1, 0.94, 0.82).multiplyScalar(o.down);
  }
  return { glass, windows, chandLights, haloU, setLight, tickClock, counts: { books: books.length, downlights: downCount, bulbs: bulbs.length } };
}
