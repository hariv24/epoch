// city/room2.js · Room v2 (docs/ROOM-V2.md §12-13). Loaded only with ?room2=1 on the Today page (home_today.js); nothing else uses it.
// Data-driven: SHELLS['morningside-studio'] (the 6.4 x 5.2 m studio proof, §3) and SHELLS['harlem-floorthrough'] (the 5.6 x 11.2 m
// Harlem brownstone parlour floor, §13.1: front parlour with a marble fireplace, a cased opening with pocket doors, the kitchen, a second
// divider, the back bedroom on the garden). The shell follows the user's home id (econ.home.id); any other home falls back to the studio.
// Shared by both: plaster walls + baseboard + crown, tall sash windows (deep reveals, radiators, linen curtains, the real city in the
// glass at the room's own hour), panelled doors, the kitchen run, downloaded furniture (room/assets, LICENSES.md), Sims "walls down",
// day/night light, and Hariv at a window on a free spot (people_fit.findStandSpot, PEOPLE-SPEC §10.2 item 5).
// Anchors for the interaction build: export ANCHORS (filled when the furniture is placed) and anchors():
//   { id, activity: 'desk_typing'|'sofa_read'|'window'|'bed_sleep'|'kettle'|null, zone, obb: { x, z, ry, w, d, y0, h }, use: { x, z, yaw } }
//   obb = world centre, rotation about Y, full extents along the item's own x/z; use = the floor spot + facing yaw (rotation.y) for the activity.
// Debug: &shell=studio|brownstone  &tod=day|night|<hour>  &yaw=<deg> &pitch=<deg> &dist=<m> &zone=<id>  &bed=grey  &shot=1
//        window.__room2 { view(yaw, pitch, dist, zone), setTod(t), info(), anchors(), state }   window.__peopleFit.report()
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, addRoomEnvironment, createLoop, createAdaptiveDpr, installPerf, sizeTo, warm } from './world/render.js';
import { createTextures, rng } from './world/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STUB = 0.45, WARM = 0xffe3ae, D2R = Math.PI / 180;
/* ------------------------------------------------------------------ the shells (room frame: x across the width, -z = the street wall) */
// The brownstone's numbers are layout.ROOMS_BY_HOME['harlem-floorthrough'] (decorate validation), so the 3D shell and the server agree.
// faces: street (z = -D/2), back (z = +D/2), west (x = -W/2, u = -z), east (x = +W/2, u = z); a face's u runs along it, w points into the room.
export const SHELLS = {
  'morningside-studio': {
    W: 6.4, D: 5.2, H: 2.9, T: 0.2, base: 0.12, crown: 0.08, casing: 0.075, floor: 'oak', cutaway: 'facing', zoom: [3, 10],
    home: { yaw: -45, pitch: 35, dist: 8.6, target: [0, 0.8, 0] },
    win: { w: 1.0, y0: 0.75, y1: 2.55 }, windows: [{ face: 'street', u: -1.1 }, { face: 'street', u: 1.1 }],
    doors: [
      { id: 'front', face: 'back', u: -1.7, w: 0.9, h: 2.1, mat: 'doorFront', leaves: 1, knob: 1, front: true },
      { id: 'bath', face: 'east', u: 1.85, w: 0.8, h: 2.1, mat: 'trim', leaves: 1, knob: -1 },
      { id: 'closet', face: 'west', u: -1.85, w: 1.2, h: 2.1, mat: 'trim', leaves: 2 },
    ],
    dividers: [], kitchen: { face: 'back', u0: -0.6, mods: ['sink', 'drawers', 'oven', 'fridgeU'] },
    sun: [-4.2, 9.0, -11.0], hemiDay: 0.9, zones: [], hariv: { face: 'street', u: -1.1 },
  },
  'harlem-floorthrough': {
    // 124 W 123rd St, parlour floor (docs/ROOM-V2.md 16.1): interior 4.60 x 13.80 m, party walls Ts 0.29, front and rear walls T 0.42, ceiling 3.45.
    // Stair-hall strip along the east wall (x 1.10..2.30, z -6.90..+1.0); parlour + middle room are 3.40 m wide, the bedroom the full 4.60.
    W: 4.6, D: 13.8, H: 3.45, T: 0.42, Ts: 0.29, base: 0.18, crown: 0.15, casing: 0.1, floor: 'herringbone', cutaway: 'between', zoom: [4, 20],
    home: { yaw: 140, pitch: 44, dist: 17, target: [0, 0.8, -0.5] },
    win: { w: 1.0, y0: 0.5, y1: 2.95, shutters: true },
    // street (u = x): x -1.45, +0.25. back (u = -x): garden windows at x -1.1, +1.1
    windows: [{ face: 'street', u: -1.45 }, { face: 'street', u: 0.25 }, { face: 'back', u: 1.1 }, { face: 'back', u: -1.1 }],
    // u of a door is along its face: street/divider A u = x - centre, back u = -x, west u = -z, hall A u = z - (-2.95), bathW A u = z - 1.15
    doors: [
      { id: 'front', face: 'hall', u: 2.65, w: 0.9, h: 2.2, mat: 'walnut', leaves: 1, knob: 1, front: true },        // the apartment door, z -0.30
      { id: 'bath', face: 'bathW', u: 0, w: 0.7, h: 2.1, mat: 'trim', leaves: 1, knob: 1 },                          // z 1.15
      // the bedroom closet is a painted built-in in front of the west wall (dressBrownstone; the server's closet keep-out x -2.3..-1.6, z 3.75..5.25)
    ],
    dividers: [
      { id: 'arch', z: -1.4, t: 0.15, span: [-2.3, 1.1], open: [{ x: -0.6, w: 1.8, h: 2.7, pocket: true }] },       // cased opening to the middle room
      { id: 'bedwall', z: 1.9, t: 0.15, open: [{ x: -1.0, w: 0.92, h: 2.1 }] },                                      // the bedroom doorway, x -1.46..-0.54 (0.9 m +2 cm)
    ],
    // free-standing wall slabs (A face = the side that looks into the apartment; c = its plane; slab runs behind it)
    parts: [
      { id: 'hall', ax: 'z', face: 'W', c: 1.1, t: 0.15, a0: -6.9, a1: 1.0 },                                       // the stair-hall wall
      { id: 'bathW', ax: 'z', face: 'W', c: 0.1, t: 0.1, a0: 0.4, a1: 1.9 },                                         // the bathroom (SE of the middle room) west wall
      { id: 'bathN', ax: 'x', face: 'N', c: 0.4, t: 0.1, a0: 0.1, a1: 1.1 },
      { id: 'nookN', ax: 'x', face: 'N', c: 1.0, t: 0.1, a0: 1.1, a1: 2.3 },                                         // closes the stair hall at z +1.0
    ],
    hall: { x0: 1.1, x1: 2.3, z0: -6.9, z1: 1.0 }, bath: { x0: 0.1, x1: 2.3, z0: 0.4, z1: 1.9 },
    kitchen: { face: 'west', u0: -1.3, mods: [{ type: 'tall', w: 0.68 }, { type: 'drawers', w: 0.7 }, 'sink', 'oven'] },   // z +1.30 (fridge) .. -1.30 (stove)
    fireplace: { face: 'west', u: 4.2 },                                                                          // z -4.2
    // 124 W 123rd St is on the south side of the street: the parlour faces north, the sun comes over the gardens (+z)
    sun: [3.4, 9.5, 12.5], hemiDay: 1.05,
    zones: [
      { id: 'parlour', x: -0.6, z: -4.15, z0: -6.9, z1: -1.4, dist: 8.5 },
      { id: 'kitchen', x: -0.2, z: 0.25, z0: -1.4, z1: 1.9, dist: 7.5 },
      { id: 'bedroom', x: 0.0, z: 4.4, z0: 1.9, z1: 6.9, dist: 8.5 },
    ],
    hariv: { face: 'street', u: 0.25 },
  },
};
const FACE = { street: 0, back: 1, entry: 1, garden: 1, west: 2, east: 3, hall: 8, hallB: 9, bathW: 10, bathWB: 11, bathN: 12, bathNB: 13, nookN: 14, nookNB: 15 };      // 8.. follow the two dividers' faces (4-7)
export const ANCHORS = [];
export const anchors = () => ANCHORS.map((a) => JSON.parse(JSON.stringify(a)));
const asset = (p) => new URL('../room/assets/' + p, import.meta.url).href;

/* ------------------------------------------------------------------ geometry helpers */
// bevelled box w (x) x h (y) x d (z), centred; every edge rounded by r (the procedural rule: bevels >= 1 cm where the part allows it)
function rbox(w, h, d, r = 0.01) {
  r = Math.max(0.0005, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005));
  const iw = w - 2 * r, ih = h - 2 * r, c = Math.min(r * 0.6, iw / 2, ih / 2), s = new THREE.Shape(), x0 = -iw / 2, x1 = iw / 2, y0 = -ih / 2, y1 = ih / 2;
  s.moveTo(x0 + c, y0); s.lineTo(x1 - c, y0); s.quadraticCurveTo(x1, y0, x1, y0 + c); s.lineTo(x1, y1 - c); s.quadraticCurveTo(x1, y1, x1 - c, y1);
  s.lineTo(x0 + c, y1); s.quadraticCurveTo(x0, y1, x0, y1 - c); s.lineTo(x0, y0 + c); s.quadraticCurveTo(x0, y0, x0 + c, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0002, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 2 });
  g.translate(0, 0, -(d - 2 * r) / 2); return g;
}
const cyl = (r, len, axis = 'y', seg = 14, r2 = r) => { const g = new THREE.CylinderGeometry(r, r2, len, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return g; };
// a moulding profile [[w, y], ...] run along u from u0 to u1; ends that meet an inside corner are mitred
function profileRun(pts, u0, u1, m0, m1) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([w, y]) => new THREE.Vector2(w, y))), { depth: u1 - u0, bevelEnabled: false, curveSegments: 1 });
  const p = g.attributes.position, L = u1 - u0;
  for (let i = 0; i < p.count; i++) {
    const w = p.getX(i), y = p.getY(i), z = p.getZ(i); let u = u1 - z;          // (x, z) -> (w, u1 - z) is a proper rotation: faces stay outward
    if (m0 && z > L - 1e-6) u += w; if (m1 && z < 1e-6) u -= w;
    p.setXYZ(i, u, y, w);
  }
  g.computeVertexNormals(); return g;
}
// split [a, b] by cuts [u0, u1, mitre]: square ends at door casings, mitred ends at inside corners
function segs(a, b, cuts) {
  const out = []; let u = a, m = true;
  for (const [c0, c1, mt] of cuts.filter((c) => c[1] > a && c[0] < b).sort((p, q) => p[0] - q[0])) { if (c0 - u > 0.02) out.push([u, c0, m, !!mt]); u = Math.max(u, c1); m = !!mt; }
  if (b - u > 0.02) out.push([u, b, m, true]);
  return out;
}
const paintPaint = (g, S, R) => { g.fillStyle = '#f6f6f6'; g.fillRect(0, 0, S, S); for (let i = 0; i < 900; i++) { const v = 200 + R() * 55 | 0; g.fillStyle = `rgba(${v},${v},${v},${0.05 + R() * 0.05})`; g.fillRect(R() * S, R() * S, 1 + R() * 2, 20 + R() * 120); } };
const stonePaint = (g, S, R) => { g.fillStyle = '#e9e5de'; g.fillRect(0, 0, S, S); for (let i = 0; i < 5000; i++) { const v = 150 + R() * 100 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 8},${0.08 + R() * 0.25})`; const r = R() * 2.2; g.beginPath(); g.arc(R() * S, R() * S, r, 0, 7); g.fill(); } };
const brushPaint = (g, S, R) => { g.fillStyle = '#c4c6c8'; g.fillRect(0, 0, S, S); for (let i = 0; i < 1400; i++) { const v = 150 + R() * 100 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(0, R() * S, S, 1); } };
const linenPaint = (g, S, R) => { g.fillStyle = '#f2efe8'; g.fillRect(0, 0, S, S); for (let i = 0; i < S; i += 2) { g.fillStyle = `rgba(120,110,95,${0.04 + R() * 0.05})`; g.fillRect(0, i, S, 1); g.fillRect(i, 0, 1, S); } for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(110,100,85,0.08)'; g.fillRect(R() * S, R() * S, 30 + R() * 90, 1.5); } };
const tilePaint = (g, S) => { g.fillStyle = '#d9d4cb'; g.fillRect(0, 0, S, S); const tw = S / 2, th = S / 4, gr = 3; for (let r = 0; r < 4; r++) for (let k = -1; k < 3; k++) { const x = k * tw + (r % 2 ? tw / 2 : 0); const gd = g.createLinearGradient(0, r * th, 0, r * th + th); gd.addColorStop(0, '#fbfaf7'); gd.addColorStop(1, '#efece6'); g.fillStyle = gd; g.fillRect(x + gr / 2, r * th + gr / 2, tw - gr, th - gr); } };
const barkPaint = (g, S, R) => { g.fillStyle = '#e4ded2'; g.fillRect(0, 0, S, S); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(40,34,28,${0.35 + R() * 0.4})`; g.fillRect(R() * S, R() * S, 4 + R() * 18, 1 + R() * 2); } };
// two prints for the walls (painted canvases in walnut frames): the Hudson at dusk, and leaves
const riverPaint = (g, S) => { g.fillStyle = '#f3efe6'; g.fillRect(0, 0, S, S); const m = S * 0.1, w = S - 2 * m, gd = g.createLinearGradient(0, m, 0, m + w * 0.6); gd.addColorStop(0, '#e9b07c'); gd.addColorStop(1, '#f6d9a8'); g.fillStyle = gd; g.fillRect(m, m, w, w * 0.6);
  g.fillStyle = '#fbe8bf'; g.beginPath(); g.arc(m + w * 0.62, m + w * 0.42, w * 0.09, 0, 7); g.fill(); g.fillStyle = '#5b5f7a'; g.beginPath(); g.moveTo(m, m + w * 0.6); for (let k = 0; k <= 12; k++) g.lineTo(m + (w * k) / 12, m + w * (0.52 + 0.05 * Math.sin(k * 1.7))); g.lineTo(m + w, m + w * 0.6); g.fill();
  for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#35506e' : '#29425d'; g.fillRect(m, m + w * (0.6 + k * 0.05), w, w * 0.05); } g.fillStyle = 'rgba(251,232,191,0.7)'; g.fillRect(m + w * 0.55, m + w * 0.62, w * 0.14, 3); g.fillRect(m + w * 0.58, m + w * 0.7, w * 0.08, 3); };
const leafPaint = (g, S, R) => { g.fillStyle = '#f1ece1'; g.fillRect(0, 0, S, S); const m = S * 0.12; g.fillStyle = '#e6dccb'; g.fillRect(m, m, S - 2 * m, S - 2 * m);
  for (let k = 0; k < 7; k++) { g.save(); g.translate(m + R() * (S - 2 * m), m + R() * (S - 2 * m)); g.rotate(R() * 6.3); g.fillStyle = ['#47613d', '#6b8a4e', '#2f4a3a', '#8aa36b'][k % 4]; g.beginPath(); g.ellipse(0, 0, S * (0.06 + R() * 0.05), S * (0.14 + R() * 0.08), 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(241,236,225,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -S * 0.12); g.lineTo(0, S * 0.12); g.stroke(); g.restore(); } };
// the brownstone's other prints (all painted here, no text): a fern plate, a mid-century abstract, a black-and-white street photo, an old
// map of the island, a dusk seascape (over the bed) and a lemon still life (kitchen); `m` = the white mat around the picture
const matted = (g, S, m, bg = '#f4efe4') => { g.fillStyle = bg; g.fillRect(0, 0, S, S); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(m - 2, m - 2, S - 2 * m + 4, S - 2 * m + 4); };
const fernPaint = (g, S, R) => { matted(g, S, S * 0.1, '#f2ecdc'); const m = S * 0.1; g.fillStyle = '#ece3cf'; g.fillRect(m, m, S - 2 * m, S - 2 * m);
  g.strokeStyle = '#4c6a3c'; g.lineWidth = 2; g.beginPath(); g.moveTo(S * 0.5, S * 0.86); g.quadraticCurveTo(S * 0.56, S * 0.5, S * 0.44, S * 0.16); g.stroke();
  for (let k = 0; k < 18; k++) { const t = k / 18, x = S * (0.5 + 0.06 * Math.sin(t * 2.6) - 0.02 * t), y = S * (0.84 - t * 0.66), L = S * 0.2 * Math.sin(Math.PI * (0.15 + 0.85 * t)) + 4;
    for (const sd of [-1, 1]) { g.save(); g.translate(x, y); g.rotate(sd * (1.1 - t * 0.4)); g.fillStyle = ['#56774a', '#6d8c58', '#47653c'][k % 3]; g.beginPath(); g.ellipse(0, -L / 2, L * 0.16, L / 2, 0, 0, 7); g.fill(); g.restore(); } }
  g.fillStyle = 'rgba(80,70,55,0.45)'; g.fillRect(S * 0.36, S * 0.885, S * 0.28, 2); };
const abstractPaint = (g, S) => { matted(g, S, S * 0.09); const m = S * 0.09, w = S - 2 * m; g.fillStyle = '#efe4cf'; g.fillRect(m, m, w, w);
  g.fillStyle = '#c4643f'; g.beginPath(); g.arc(m + w * 0.36, m + w * 0.38, w * 0.22, 0, 7); g.fill(); g.fillStyle = '#e1a948'; g.beginPath(); g.moveTo(m + w * 0.52, m + w); g.lineTo(m + w * 0.52, m + w * 0.62); g.arc(m + w * 0.72, m + w * 0.62, w * 0.2, Math.PI, 0); g.lineTo(m + w * 0.92, m + w); g.fill();
  g.fillStyle = '#23395b'; g.fillRect(m + w * 0.1, m + w * 0.7, w * 0.34, w * 0.3); g.fillStyle = '#7d8b6a'; g.fillRect(m + w * 0.62, m + w * 0.12, w * 0.24, w * 0.08); };
const photoPaint = (g, S, R) => { matted(g, S, S * 0.12, '#f6f4ef'); const m = S * 0.12, w = S - 2 * m; const gd = g.createLinearGradient(0, m, 0, m + w); gd.addColorStop(0, '#d9d9d6'); gd.addColorStop(1, '#8d8d8a'); g.fillStyle = gd; g.fillRect(m, m, w, w);
  for (let k = 0; k < 6; k++) { const x = m + (w * k) / 6, top = m + w * (0.12 + R() * 0.08), v = 70 + R() * 40 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, top, w / 6 + 1, w);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { g.fillStyle = `rgba(30,30,30,0.8)`; g.fillRect(x + w * (0.03 + c * 0.075), top + w * (0.06 + r * 0.13), w * 0.04, w * 0.08); }
    g.fillStyle = 'rgb(55,55,55)'; g.beginPath(); g.moveTo(x + w * 0.02, m + w * 0.86); g.lineTo(x + w * 0.1, m + w * 0.62); g.lineTo(x + w * 0.14, m + w * 0.62); g.lineTo(x + w * 0.14, m + w * 0.86); g.fill(); }
  g.fillStyle = 'rgb(120,120,118)'; g.fillRect(m, m + w * 0.86, w, w * 0.14); g.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 400; i++) g.fillRect(m + R() * w, m + R() * w, 1, 1); };
const mapPaint = (g, S, R) => { matted(g, S, S * 0.08, '#efe6d2'); const m = S * 0.08, w = S - 2 * m; g.fillStyle = '#e8dcc0'; g.fillRect(m, m, w, w); g.fillStyle = '#8fb0bf'; g.fillRect(m, m, w, w);
  g.fillStyle = '#e7d8b6'; g.beginPath(); g.moveTo(m + w * 0.62, m + w * 0.02); g.bezierCurveTo(m + w * 0.78, m + w * 0.2, m + w * 0.66, m + w * 0.6, m + w * 0.42, m + w * 0.98); g.lineTo(m + w * 0.3, m + w * 0.96); g.bezierCurveTo(m + w * 0.44, m + w * 0.6, m + w * 0.5, m + w * 0.24, m + w * 0.56, m + w * 0.02); g.fill();
  g.fillStyle = '#e2d2ad'; g.fillRect(m, m, w * 0.18, w); g.fillRect(m + w * 0.86, m, w * 0.14, w);
  g.save(); g.clip(); g.strokeStyle = 'rgba(120,85,55,0.5)'; g.lineWidth = 1; for (let k = 1; k < 40; k++) { g.beginPath(); g.moveTo(m + w * 0.2, m + w * k / 40 + w * 0.12); g.lineTo(m + w * 0.85, m + w * k / 40 - w * 0.12); g.stroke(); } for (let k = 1; k < 9; k++) { g.beginPath(); g.moveTo(m + w * (0.3 + k * 0.05), m); g.lineTo(m + w * (0.1 + k * 0.05), m + w); g.stroke(); } g.fillStyle = '#9db27c'; g.save(); g.translate(m + w * 0.55, m + w * 0.42); g.rotate(-0.5); g.fillRect(-w * 0.03, -w * 0.12, w * 0.06, w * 0.24); g.restore(); g.restore();
  g.strokeStyle = 'rgba(110,80,50,0.6)'; g.lineWidth = 3; g.strokeRect(m + 6, m + 6, w - 12, w - 12); };
const seaPaint = (g, S) => { matted(g, S, S * 0.06, '#f3eee4'); const m = S * 0.06, w = S - 2 * m; const gd = g.createLinearGradient(0, m, 0, m + w * 0.62); gd.addColorStop(0, '#9fb4c8'); gd.addColorStop(0.7, '#e8c9a8'); gd.addColorStop(1, '#f0d9b8'); g.fillStyle = gd; g.fillRect(m, m, w, w * 0.62);
  const gs = g.createLinearGradient(0, m + w * 0.62, 0, m + w); gs.addColorStop(0, '#6f8796'); gs.addColorStop(1, '#3f5462'); g.fillStyle = gs; g.fillRect(m, m + w * 0.62, w, w * 0.38);
  g.fillStyle = 'rgba(250,230,200,0.5)'; for (let k = 0; k < 9; k++) g.fillRect(m + w * (0.3 + k * 0.03), m + w * (0.64 + k * 0.03), w * (0.3 - k * 0.025), 2); };
const lemonPaint = (g, S, R) => { matted(g, S, S * 0.1); const m = S * 0.1, w = S - 2 * m; g.fillStyle = '#2f4f6e'; g.fillRect(m, m, w, w); g.fillStyle = '#d9cdb4'; g.fillRect(m, m + w * 0.68, w, w * 0.32);
  g.fillStyle = '#e8e2d6'; g.beginPath(); g.ellipse(m + w * 0.5, m + w * 0.7, w * 0.3, w * 0.08, 0, 0, 7); g.fill();
  for (const [x, y, r] of [[0.38, 0.6, 0.11], [0.56, 0.58, 0.12], [0.47, 0.5, 0.1], [0.66, 0.66, 0.09]]) { g.fillStyle = '#e9c53c'; g.beginPath(); g.ellipse(m + w * x, m + w * y, w * r, w * r * 0.82, 0.3, 0, 7); g.fill(); g.fillStyle = 'rgba(255,250,210,0.5)'; g.beginPath(); g.ellipse(m + w * (x - r * 0.3), m + w * (y - r * 0.3), w * r * 0.3, w * r * 0.2, 0.3, 0, 7); g.fill(); }
  g.fillStyle = '#4f6e3a'; g.beginPath(); g.ellipse(m + w * 0.6, m + w * 0.46, w * 0.07, w * 0.025, -0.6, 0, 7); g.fill(); };
const knitPaint = (g, S, R) => { g.fillStyle = '#efe7d8'; g.fillRect(0, 0, S, S); for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x += 4) { g.fillStyle = `rgba(130,110,85,${0.08 + R() * 0.08})`; g.fillRect(x, y, 2, 3); } for (const y of [0.18, 0.24, 0.76, 0.82]) { g.fillStyle = 'rgba(28,48,82,0.85)'; g.fillRect(0, y * S, S, S * 0.025); } };

/* ------------------------------------------------------------------ the stage */
const runnerPaint = (g, S, R) => {          // a flat-woven kilim runner: navy border, cream guard, rust field, stacked diamonds (v runs along its length)
  g.fillStyle = '#ece2cb'; g.fillRect(0, 0, S, S); g.fillStyle = '#2a3550'; g.fillRect(S * 0.04, S * 0.02, S * 0.92, S * 0.96);
  g.fillStyle = '#e6d8bb'; g.fillRect(S * 0.11, S * 0.045, S * 0.78, S * 0.91); g.fillStyle = '#7f4334'; g.fillRect(S * 0.15, S * 0.06, S * 0.7, S * 0.88); g.fillStyle = '#c9a77a'; for (const x of [0.19, 0.79]) g.fillRect(S * x, S * 0.06, S * 0.02, S * 0.88);
  for (let k = 0; k < 7; k++) { const cy = S * (0.12 + k * 0.127), cx = S / 2;
    for (const [w, h, c] of [[0.22, 0.05, '#2a3550'], [0.15, 0.034, '#dccdb0'], [0.07, 0.016, '#b9793a']]) { g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy - h * S); g.lineTo(cx + w * S, cy); g.lineTo(cx, cy + h * S); g.lineTo(cx - w * S, cy); g.closePath(); g.fill(); } }
  for (let i = 0; i < 3000; i++) { const v = R() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${0.03 + R() * 0.05})`; g.fillRect(R() * S, R() * S, 3, 1); }
};
const coirPaint = (g, S, R) => { g.fillStyle = '#9c7446'; g.fillRect(0, 0, S, S); for (let i = 0; i < 2600; i++) { const v = 60 + R() * 120 | 0; g.fillStyle = `rgba(${v + 40},${v + 20},${v - 10},0.35)`; g.fillRect(R() * S, R() * S, 1, 3 + R() * 6); }
  g.strokeStyle = '#3a2a1c'; g.lineWidth = S * 0.06; g.strokeRect(S * 0.03, S * 0.03, S * 0.94, S * 0.94); };

export function mountRoom2(host, o = {}) {
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return null;
  const PQ = new URLSearchParams(location.search);
  const pick = PQ.get('shell'), homeId = o.econ && o.econ.home && o.econ.home.id;
  const shellId = pick === 'studio' ? 'morningside-studio' : pick === 'brownstone' ? 'harlem-floorthrough' : (SHELLS[homeId] ? homeId : 'morningside-studio');
  const S = SHELLS[shellId], BS = shellId === 'harlem-floorthrough';
  const { W: RW, D: RD, H: RH, T } = S, X0 = -RW / 2, X1 = RW / 2, Z0 = -RD / 2, Z1 = RD / 2, WIN = S.win, CW = S.casing;
  const sceneEl = host.querySelector('[data-js="home-scene"]') || host;
  const motion = () => (o.motion ? o.motion() !== false : true);
  if (PQ.has('shot')) {
    host.dataset.shot = '1'; Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999', borderRadius: '0', margin: '0', border: '0' });
    sceneEl.style.blockSize = '100vh';
    const st = document.createElement('style'); st.textContent = '[data-shot] .homestage__scene > :not(canvas), [data-shot] > :not(.homestage__scene) { display: none !important }'; document.head.appendChild(st);
  }
  const renderer = createRenderer({ alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0); renderer.localClippingEnabled = true;
  const canvas = renderer.domElement; canvas.className = 'homestage__canvas'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', (BS ? 'Your brownstone floor-through' : 'Your studio apartment') + '. Drag to look around; Q and E turn 45 degrees; double-click ' + (BS ? 'a room to centre on it.' : 're-centres.'));
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  sceneEl.appendChild(canvas); host.classList.add('is-3d');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  addRoomEnvironment(renderer, scene);
  const world = new THREE.Group(); scene.add(world);
  let disposed = false, mode = '', frozen = false;
  const loop = createLoop({ render: () => renderer.render(scene, camera), step: (dt) => stepFrame(dt) });
  function kick() { loop.kick(); }
  createAdaptiveDpr(renderer, loop, { max: Math.min(devicePixelRatio || 1, 2) });
  if (PQ.get('debug')) installPerf(loop);

  /* ---- textures and materials */
  const TXL = createTextures({ onLoad: () => { renderer.shadowMap.needsUpdate = true; kick(); } }), canvasTex = TXL.canvasTex;
  const tex = (n, rx, ry, srgb) => TXL.tex(asset('tex/' + n + '.webp'), { rx, ry, srgb });
  const HB = 3.4;                                                                     // the herringbone tile is 3.4 m square
  const TX = {
    oakD: tex('oak_floor_diff', RW / 2, RD / 2, true), oakN: tex('oak_floor_nor', RW / 2, RD / 2), oakA: tex('oak_floor_arm', RW / 2, RD / 2),
    woodD: tex('oak_floor_diff', 0.5, 0.5, true),
    plD: tex('plaster_wall_diff', 0.5, 0.5, true), plN: tex('plaster_wall_nor', 0.5, 0.5), plA: tex('plaster_wall_arm', 0.5, 0.5),
    paint: canvasTex(512, paintPaint), stone: canvasTex(512, stonePaint, 1.6, 1.6), brush: canvasTex(256, brushPaint, 2, 2), linen: canvasTex(256, linenPaint, 2, 7),
    tile: canvasTex(256, tilePaint, 1 / 0.3, 1 / 0.3), bark: canvasTex(128, barkPaint, 3, 1), knit: canvasTex(256, knitPaint, 1.6, 1.6),
  };
  if (BS) Object.assign(TX, {
    hbD: tex('herringbone_parquet_diff', RW / HB, RD / HB, true), hbN: tex('herringbone_parquet_nor', RW / HB, RD / HB), hbA: tex('herringbone_parquet_arm', RW / HB, RD / HB),
    mbD: tex('marble_01_diff', 1 / 1.5, 1 / 1.5, true), mbN: tex('marble_01_nor', 1 / 1.5, 1 / 1.5),
    runner: canvasTex(512, runnerPaint), coir: canvasTex(256, coirPaint),
  });
  const PR = RH - 0.52;                                                               // the brownstone's picture rail (top edge); the frieze above it is paler
  function plasterTone(m) {     // brownstone walls: warm putty below the picture rail, a pale frieze above, soft darkening into inside corners and under the cornice
    const dz = S.dividers.flatMap((d) => [d.z - d.t / 2, d.z + d.t / 2]); while (dz.length < 4) dz.push(99);
    const U = { uLo: { value: new THREE.Color(0xe9dbc3) }, uHi: { value: new THREE.Color(0xf2ebdf) }, uRail: { value: PR - 0.02 }, uBox: { value: new THREE.Vector4(X0, X1, Z0, Z1) }, uDiv: { value: new THREE.Vector4(...dz.slice(0, 4)) }, uTop: { value: RH } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform vec3 uLo, uHi; uniform float uRail, uTop; uniform vec4 uBox, uDiv;').replace('#include <map_fragment>', `#include <map_fragment>
        { float dx = min(abs(vWp.x - uBox.x), abs(vWp.x - uBox.y));
          float dz = min(min(abs(vWp.z - uBox.z), abs(vWp.z - uBox.w)), min(min(abs(vWp.z - uDiv.x), abs(vWp.z - uDiv.y)), min(abs(vWp.z - uDiv.z), abs(vWp.z - uDiv.w))));
          float ao = 1.0 - 0.17 * (1.0 - smoothstep(0.0, 0.6, max(dx, dz))) - 0.08 * (1.0 - smoothstep(0.0, 0.55, uTop - vWp.y));
          diffuseColor.rgb *= mix(uLo, uHi, step(uRail, vWp.y)) * ao; }`);
    };
    m.customProgramCacheKey = () => 'room2-plaster-bs';
  }
  const std = (p) => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, dithering: true, ...p });
  const MK = {
    plaster: () => { const m = std({ map: TX.plD, normalMap: TX.plN, normalScale: new THREE.Vector2(BS ? 0.7 : 0.45, BS ? 0.7 : 0.45), roughnessMap: TX.plA, aoMap: TX.plA, roughness: 1, envMapIntensity: 0.7 }); if (BS) plasterTone(m); return m; },
    trim: () => std({ color: 0xf4f0e8, map: TX.paint, roughness: 0.42 }),
    cap: () => std({ color: 0xbfb3a1, roughness: 0.85 }),
    doorFront: () => std({ color: 0x26344d, map: TX.paint, roughness: 0.36 }),
    walnut: () => std({ color: 0x8a5a3a, map: TX.woodD, roughness: 0.42 }),
    brass: () => std({ color: 0xc89f55, metalness: 1, roughness: 0.3 }),
    chrome: () => std({ color: 0xe6e8ea, metalness: 1, roughness: 0.14 }),
    steel: () => std({ color: 0xd2d4d6, map: TX.brush, metalness: 0.85, roughness: 0.33 }),
    steelD: () => std({ color: 0xc9cbcd, map: TX.brush, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide }),
    basin: () => std({ color: 0xb8bbbe, map: TX.brush, metalness: 0.9, roughness: 0.3, side: THREE.BackSide }),
    blackGlass: () => std({ color: 0x0c0d0f, roughness: 0.1, metalness: 0.3 }),
    ring: () => std({ color: 0x3a3c40, roughness: 0.5, metalness: 0.6 }),
    dark: () => std({ color: 0x22201d, roughness: 0.8 }),
    cabNavy: () => std({ color: 0x2f3e59, map: TX.paint, roughness: 0.4 }),
    stone: () => std({ color: 0xffffff, map: TX.stone, roughness: 0.3 }),
    tile: () => std({ color: 0xffffff, map: TX.tile, roughness: 0.2 }),
    iron: () => std({ color: 0xd9d2c5, map: TX.paint, roughness: 0.48, metalness: 0.3 }),
    castIron: () => std({ color: 0x1d1d20, roughness: 0.55, metalness: 0.55 }),
    soot: () => std({ color: 0x0b0a09, roughness: 1 }),
    marble: () => std({ color: 0xffffff, map: TX.mbD || TX.stone, normalMap: TX.mbN || null, roughness: 0.22, envMapIntensity: 0.9 }),
    oak: () => std({ map: TX.oakD, roughness: 0.55 }),
    band: () => std({ color: 0x6a4630, map: TX.woodD, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    linen: () => std({ color: 0xece4d4, map: TX.linen, roughness: 0.95, side: THREE.DoubleSide }),
    tie: () => std({ color: 0xbfae92, map: TX.linen, roughness: 0.9 }),
    glass: () => std({ color: 0xe4edf2, transparent: true, opacity: 0.12, roughness: 0.03, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }),
    bark: () => std({ map: TX.bark, roughness: 0.9 }),
    knit: () => std({ map: TX.knit, roughness: 0.95 }),
    canvasBag: () => std({ color: 0xcfbf9f, map: TX.linen, roughness: 0.92 }),
    navyFab: () => std({ color: 0x1f2b45, map: TX.linen, roughness: 0.88 }),
    olive: () => std({ color: 0x5b5a3c, map: TX.linen, roughness: 0.9 }),
    sole: () => std({ color: 0xece8de, roughness: 0.7 }),
    leather: () => std({ color: 0x5a3a26, roughness: 0.55 }),
    ceramic: () => std({ color: 0xe9e3d6, roughness: 0.22 }),
    plate: () => std({ color: 0xf6f4ef, roughness: 0.18 }),
    plastic: () => std({ color: 0xf1efea, roughness: 0.45 }),
    bottle: () => std({ color: 0x4d7d9c, metalness: 0.7, roughness: 0.32 }),
    cover1: () => std({ color: 0x8c2f2a, roughness: 0.6 }), cover2: () => std({ color: 0x23395b, roughness: 0.6 }),
    cover3: () => std({ color: 0xb08a3e, roughness: 0.6 }), cover4: () => std({ color: 0x3f5a46, roughness: 0.6 }), cover5: () => std({ color: 0xe3d8c2, roughness: 0.65 }),
    ceilPaint: () => std({ color: 0xf7f4ee, roughness: 0.9 }),
    led: () => std({ color: 0xfff4e0, emissive: 0xffd49a, emissiveIntensity: 0, roughness: 0.5 }),
    gilt: () => std({ color: 0xb8924a, metalness: 0.8, roughness: 0.38 }),
    milk: () => std({ color: 0xf7f2e8, emissive: 0xffe2b8, emissiveIntensity: 0, roughness: 0.3 }),
    runner: () => std({ color: 0xffffff, map: TX.runner || TX.knit, roughness: 0.95 }),
    coir: () => std({ color: 0xffffff, map: TX.coir || TX.bark, roughness: 1 }),
  };
  /* ---- walls: 4 exterior + the dividers; faces are the frames things hang on (a divider has two) */
  const Ts = S.Ts || T;               // party-wall thickness (the front and rear walls are T)
  const walls = [
    { id: 'street', out: [0, -1], p: [0, Z0], T, len: RW + 2 * Ts, face0: 0 },
    { id: 'back', out: [0, 1], p: [0, Z1], T, len: RW + 2 * Ts, face0: 1 },
    { id: 'west', out: [-1, 0], p: [X0, 0], T: Ts, len: RD, face0: 2 },
    { id: 'east', out: [1, 0], p: [X1, 0], T: Ts, len: RD, face0: 3 },
  ];
  const faces = [
    { wall: 0, x: 0, z: Z0, ry: 0, inner: [X0, X1] }, { wall: 1, x: 0, z: Z1, ry: Math.PI, inner: [X0, X1] },
    { wall: 2, x: X0, z: 0, ry: Math.PI / 2, inner: [Z0, Z1] }, { wall: 3, x: X1, z: 0, ry: -Math.PI / 2, inner: [Z0, Z1] },
  ];
  // a divider may span only [s0, s1] of the width (the cased opening stops at the stair-hall wall); its face frame sits at the span's centre cx,
  // so a face u = world x - cx, and wl.div.open is in that local u (S.dividers keeps world x for the camera rig)
  S.dividers.forEach((d) => {
    const [s0, s1] = d.span || [X0, X1], cx = (s0 + s1) / 2, len = s1 - s0, op = d.open.map((o) => ({ ...o, x: o.x - cx }));
    walls.push({ id: d.id, out: [0, 1], p: [0, d.z], T: d.t, len, face0: faces.length, div: { ...d, open: op }, cx });
    faces.push({ wall: walls.length - 1, x: cx, z: d.z + d.t / 2, ry: 0, inner: [-len / 2, len / 2], side: 'A' }, { wall: walls.length - 1, x: cx, z: d.z - d.t / 2, ry: Math.PI, inner: [-len / 2, len / 2], side: 'B' });
  });
  // free-standing slabs: face A looks W/E/S/N (ry -90/+90/0/180 deg), u runs along the slab from its centre
  for (const q of S.parts || []) {
    const [nx, nz, ry] = { W: [-1, 0, -Math.PI / 2], E: [1, 0, Math.PI / 2], S: [0, 1, 0], N: [0, -1, Math.PI] }[q.face], len = q.a1 - q.a0, ac = (q.a0 + q.a1) / 2;
    const xA = q.ax === 'z' ? q.c : ac, zA = q.ax === 'z' ? ac : q.c;
    walls.push({ id: q.id, out: [nx, nz], p: [xA - nx * q.t / 2, zA - nz * q.t / 2], T: q.t, len, face0: faces.length, part: q, cx: q.ax === 'z' ? zA : xA });
    faces.push({ wall: walls.length - 1, x: xA, z: zA, ry, inner: [-len / 2, len / 2], side: 'A' }, { wall: walls.length - 1, x: xA - nx * q.t, z: zA - nz * q.t, ry: ry + Math.PI, inner: [-len / 2, len / 2], side: 'B' });
  }
  const planes = walls.map(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), RH + 0.01));
  const mcache = new Map();
  const mat = (wi, key) => { const k = wi + '|' + key; if (!mcache.has(k)) { const m = MK[key](); if (wi >= 0) m.clippingPlanes = [planes[wi]]; mcache.set(k, m); } return mcache.get(k); };
  const toW = (fi, u, w) => { const f = faces[fi], c = Math.cos(f.ry), s = Math.sin(f.ry); return [f.x + u * c + w * s, f.z - u * s + w * c]; };
  const vbox = (fi, u0, u1, w0, w1, y0, y1) => { const a = toW(fi, u0, w0), b = toW(fi, u1, w1); return [Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y1, Math.max(a[1], b[1])]; };
  // static parts merged per (clip plane, material) in world space: the whole shell is a few dozen draw calls
  const SB = new Map(), curtainMeshes = [];
  function bAdd(clip, M, key, geo, x = 0, y = 0, z = 0, ry = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (ry) g.rotateY(ry); g.translate(x, y, z); if (M) g.applyMatrix4(M);
    const k = clip + '|' + key; if (!SB.has(k)) SB.set(k, []); SB.get(k).push(g);
  }
  function flush(shadow = true) {
    for (const [k, list] of SB) {
      const [clip, key] = [+k.split('|')[0], k.split('|')[1]];
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat(clip, key)); mesh.castShadow = shadow && key !== 'glass' && key !== 'band'; mesh.receiveShadow = true; mesh.name = k; world.add(mesh); list.forEach((g) => g.dispose());
      if (key === 'linen' || key === 'tie') curtainMeshes.push([clip, mesh]); if (key === 'glass') mesh.renderOrder = 2;
    }
    SB.clear();
  }
  const mkB = (clip, M) => { const b = { add(key, geo, x, y, z, ry) { bAdd(clip, M, key, geo, x, y, z, ry); return b; } }; return b; };
  faces.forEach((f, fi) => {
    f.M = new THREE.Matrix4().makeRotationY(f.ry).setPosition(f.x, 0, f.z);
    f.W = new THREE.Group(); f.F = new THREE.Group(); for (const g of [f.W, f.F]) { g.position.set(f.x, 0, f.z); g.rotation.y = f.ry; world.add(g); }
    f.bw = mkB(f.wall, f.M); f.bf = mkB(-1, f.M);
  });
  const BX = mkB(-1, null);

  /* ---- lights */
  const hemi = new THREE.HemisphereLight(0xcfe0f7, 0x9a8670, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.4); sun.position.set(...S.sun); sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
  const SR = Math.max(5.5, RD / 2 + 1.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 50 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 4;
  const nightLights = [], dayNight = [];                                          // dayNight: [light, day, night] (the windowless middle room is lit all day)                                                                  // [light, night intensity]
  const deskSpot = new THREE.SpotLight(WARM, 0, 4, 0.62, 0.55, 2); deskSpot.castShadow = true; deskSpot.shadow.mapSize.set(1024, 1024); deskSpot.shadow.bias = -0.0006; deskSpot.shadow.radius = 3; scene.add(deskSpot, deskSpot.target);
  const floorLampL = new THREE.SpotLight(WARM, 0, 6, 0.8, 1.0, 2); scene.add(floorLampL, floorLampL.target);     // the drum shade lets light out downward
  const floorGlow = new THREE.PointLight(WARM, 0, 0, 2); scene.add(floorGlow);                                    // no cut-off radius: no banded ring on the wall
  nightLights.push([deskSpot, 16], [floorLampL, 8], [floorGlow, BS ? 1.0 : 0.35]);
  const point = (x, y, z, v, c = WARM) => { const l = new THREE.PointLight(c, 0, 0, 2); l.position.set(x, y, z); scene.add(l); nightLights.push([l, v]); return l; };
  if (!BS) point(0.2, RH - 0.25, -0.2, 4.5);                                      // the brownstone has no ceiling fill: its lamps make the pools (below, after the kitchen)
  const personFill = new THREE.PointLight(0xfff0dc, 0, 3.2, 2); scene.add(personFill);         // a soft fill on the visible side of people (night: their front)

  /* ---- the shell: wall solids (window openings run to the floor; the part under each window is a separate, never-clipped block so the
   *      sill stays when the wall drops), caps, baseboards and crowns */
  const WINS = S.windows.map((w) => ({ fi: FACE[w.face], u: w.u }));
  const DOORS = S.doors.map((d) => ({ ...d, fi: FACE[d.face] }));
  const FP = S.fireplace ? { fi: FACE[S.fireplace.face], u: S.fireplace.u } : null;
  const K = (() => {
    const k = S.kitchen; if (!k) return null; let u = k.u0;
    const mods = k.mods.map((m) => { const r = { type: m.type || m, w: m.w || 0.6, u0: u }; u += r.w + (r.type === 'tall' ? 0.02 : 0); return r; });
    const base = mods.filter((m) => m.type !== 'tall');
    return { fi: FACE[k.face], u0: k.u0, u1: u, mods, b0: base[0].u0, cd: 0.56 };
  })();
  if (BS && K) {      // night: an under-cabinet strip over the counter (a pool on the worktop) + a soft bounce; a low warm glow at the mantel
    const kf = faces[K.fi], um = (K.b0 + K.u1) / 2, [kx, kz] = toW(K.fi, um, 0.34), [tx, tz] = toW(K.fi, um, 0.3);
    const ks = new THREE.SpotLight(WARM, 0, 3.2, 1.15, 0.9, 2); ks.position.set(kx, 1.8, kz); ks.target.position.set(tx, 0, tz); scene.add(ks, ks.target); dayNight.push([ks, 2.6, 6]);
    // (its soft night bounce is the middle room's ceiling globe now: see the ceiling, below)
    kf.bw.add('led', rbox(K.u1 - K.b0 - 0.12, 0.012, 0.022, 0.004), um, 1.834, 0.3);
  }
  if (BS && FP) { const [mx, mz] = toW(FP.fi, FP.u, 0.45); point(mx, 1.45, mz, 0.35); }
  const rectShape = (u0, y0, u1, y1) => { const s = new THREE.Shape(); s.moveTo(u0, y0); s.lineTo(u1, y0); s.lineTo(u1, y1); s.lineTo(u0, y1); s.closePath(); return s; };
  const caps = [];
  walls.forEach((wl, i) => {
    const f = faces[wl.face0], s = rectShape(-wl.len / 2, -0.3, wl.len / 2, RH), holes = [], open = [];
    for (const w of WINS) if (w.fi === wl.face0) holes.push([w.u - WIN.w / 2, 0, w.u + WIN.w / 2, WIN.y1]);
    for (const d of DOORS) if (d.fi === wl.face0) holes.push([d.u - d.w / 2, 0, d.u + d.w / 2, d.h]);
    if (wl.div) for (const op of wl.div.open) { holes.push([op.x - op.w / 2, 0, op.x + op.w / 2, op.h]); open.push([op.x - op.w / 2, op.x + op.w / 2]); }
    for (const [u0, y0, u1, y1] of holes) { const p = new THREE.Path(); p.moveTo(u0, y0); p.lineTo(u0, y1); p.lineTo(u1, y1); p.lineTo(u1, y0); p.closePath(); s.holes.push(p); }
    const g = new THREE.ExtrudeGeometry(s, { depth: wl.T, bevelEnabled: false }); g.translate(0, 0, -wl.T);
    f.bw.add('plaster', g);
    for (const w of WINS) if (w.fi === wl.face0) { const b = new THREE.ExtrudeGeometry(rectShape(w.u - WIN.w / 2, -0.3, w.u + WIN.w / 2, WIN.y0), { depth: wl.T, bevelEnabled: false }); b.translate(0, 0, -wl.T); f.bf.add('plaster', b); }
    // the cap: one strip per solid run (none across an open archway); it rides the wall's current height
    const L = i < 4 && i >= 2 ? wl.len - 0.03 : wl.len, list = [];
    for (const [a, b] of segs(-L / 2, L / 2, open.map(([a0, a1]) => [a0, a1, false]))) { const cg = rbox(b - a, 0.014, wl.T + 0.012, 0.004); cg.translate((a + b) / 2, 0, -wl.T / 2); cg.applyMatrix4(f.M); list.push(cg.index ? cg.toNonIndexed() : cg); }
    const cap = new THREE.Mesh(mergeGeometries(list.map((q) => { for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); return q; })), mat(-1, 'cap'));
    cap.receiveShadow = true; cap.position.y = RH + 0.007; world.add(cap); caps.push(cap);
  });
  const bh = S.base, bt = BS ? 0.02 : 0.016, BASE = [[0, 0], [bt, 0], [bt, bh * 0.8], [bt - 0.003, bh * 0.9], [0.007, bh * 0.975], [0, bh]];
  const ck = S.crown / 0.08, CROWN = [[0, RH], [0, RH - 0.08 * ck], [0.01 * ck, RH - 0.08 * ck], [0.013 * ck, RH - 0.072 * ck]];
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; CROWN.push([(0.016 + 0.046 * (1 - Math.cos(a))) * ck, RH - (0.07 - 0.052 * Math.sin(a)) * ck]); }
  CROWN.push([0.066 * ck, RH - 0.012 * ck], [0.066 * ck, RH]);
  const PRAIL = [[0, PR - 0.048], [0.008, PR - 0.048], [0.013, PR - 0.042], [0.02, PR - 0.032], [0.023, PR - 0.021], [0.021, PR - 0.012], [0.015, PR - 0.007], [0.015, PR - 0.003], [0.009, PR], [0, PR]];
  faces.forEach((f, fi) => {
    const [a, b] = f.inner, cuts = [];
    for (const d of DOORS) if (d.fi === fi) cuts.push([d.u - d.w / 2 - CW, d.u + d.w / 2 + CW, false]);
    if (K && K.fi === fi) cuts.push([K.u0 - 0.005, K.u1 + 0.005, false]);
    if (FP && FP.fi === fi) cuts.push([FP.u - 0.78, FP.u + 0.78, false]);
    const wl = walls[f.wall];
    if (wl.div) for (const op of wl.div.open) { const uo = f.side === 'A' ? op.x : -op.x; cuts.push([uo - op.w / 2 - CW - 0.02, uo + op.w / 2 + CW + 0.02, false]); }
    const junc = [];
    const juncB = [];
    if (fi === 8) for (const d of S.dividers) if (d.span && d.span[1] >= S.parts[0].c - 0.01) { const j = [d.z - d.t / 2 - walls[f.wall].cx, d.z + d.t / 2 - walls[f.wall].cx, true]; junc.push(j); juncB.push(j); }
    if (fi === 2 || fi === 3) for (const d of S.dividers) {
      if (d.span && (fi === 2 ? d.span[0] > X0 + 0.01 : d.span[1] < X1 - 0.01)) continue;        // this divider does not reach that wall
      const z0 = d.z - d.t / 2, z1 = d.z + d.t / 2, j = fi === 2 ? [-z1, -z0, true] : [z0, z1, true]; junc.push(j);
      if (!d.open.some((op) => (fi === 2 ? op.x - op.w / 2 : op.x + op.w / 2) * (fi === 2 ? -1 : 1) > RW / 2 - 0.05)) juncB.push(j);      // a doorway at the corner: the baseboard runs through
    }
    for (const [u0, u1, m0, m1] of segs(a, b, [...cuts, ...juncB])) f.bw.add('trim', profileRun(BASE, u0, u1, m0, m1));
    for (const [u0, u1, m0, m1] of segs(a, b, junc)) f.bw.add('trim', profileRun(CROWN, u0, u1, m0, m1));
    if (BS) {      // the picture rail: butts into the window casings and the archway's corniced head, runs over the doors
      const rc = [...junc]; for (const w of WINS) if (w.fi === fi) rc.push([w.u - WIN.w / 2 - 0.09, w.u + WIN.w / 2 + 0.09, false]);
      if (wl.div) for (const op of wl.div.open) if (op.h + 0.2 > PR - 0.05) { const uo = f.side === 'A' ? op.x : -op.x; rc.push([uo - op.w / 2 - CW - 0.045, uo + op.w / 2 + CW + 0.045, false]); }
      for (const [u0, u1, m0, m1] of segs(a, b, rc)) f.bw.add('trim', profileRun(PRAIL, u0, u1, m0, m1));
    }
  });
  // floor (oak strip in the studio; herringbone parquet with a darker 12 cm border band per room in the brownstone) + the ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), BS
    ? std({ map: TX.hbD, normalMap: TX.hbN, aoMap: TX.hbA, roughness: 0.62, envMapIntensity: 0.3 })
    : std({ map: TX.oakD, normalMap: TX.oakN, roughnessMap: TX.oakA, aoMap: TX.oakA, roughness: 1, envMapIntensity: 0.3 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
  if (BS) {
    const bands = [Z0, ...S.dividers.flatMap((d) => [d.z - d.t / 2, d.z + d.t / 2]), Z1];
    const strip = (cx, cz, w, d) => { const g = new THREE.PlaneGeometry(w, d); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d); g.rotateX(-Math.PI / 2); BX.add('band', g, cx, 0.0012, cz); };
    const HX = S.hall ? S.hall.x0 : X1;                                              // the border band stops at the stair-hall wall
    for (let k = 0; k < bands.length; k += 2) {
      const z0 = bands[k], z1 = bands[k + 1], bw = 0.12, xe = z0 < (S.hall ? S.hall.z1 : -99) ? HX : X1, xc = (X0 + xe) / 2, w = xe - X0;
      strip(xc, z0 + bw / 2, w, bw); strip(xc, z1 - bw / 2, w, bw); strip(X0 + bw / 2, (z0 + z1) / 2, bw, z1 - z0 - 2 * bw); strip(xe - bw / 2, (z0 + z1) / 2, bw, z1 - z0 - 2 * bw);
    }
    const patch = (key, x0, x1, z0, z1, y) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0), uv.getY(i) * (z1 - z0)); g.rotateX(-Math.PI / 2); BX.add(key, g, (x0 + x1) / 2, y, (z0 + z1) / 2); };
    if (S.hall) patch('cap', S.hall.x0 + 0.15, S.hall.x1, S.hall.z0, S.hall.z1, 0.002);                    // the stair hall: grey stone (not part of the apartment)
    if (S.bath) { patch('tile', 0.2, 1.1, 0.5, 1.0, 0.002); patch('tile', 0.2, 2.3, 1.1, 1.825, 0.002); }       // the bathroom (an L: the nook behind the hall)
  }
  const ceilCaster = new THREE.Mesh(new THREE.BoxGeometry(RW + 2 * Ts, 0.12, RD + 2 * T), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ceilCaster.position.y = RH + 0.06; ceilCaster.castShadow = true; world.add(ceilCaster);
  const ceilGrp = new THREE.Group(); ceilGrp.visible = false; world.add(ceilGrp);
  { const cv = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), mat(-1, 'ceilPaint')); cv.rotation.x = Math.PI / 2; cv.position.y = RH; ceilGrp.add(cv); }
  if (BS) {     // the plaster ceiling medallion over the parlour (seen when the camera is under the ceiling)
    const pr = [[0.0, 0], [0.06, -0.012], [0.1, -0.05], [0.16, -0.045], [0.2, -0.03], [0.24, -0.042], [0.3, -0.028], [0.36, -0.035], [0.42, -0.016], [0.46, 0]].map(([r, y]) => new THREE.Vector2(r, y));
    const md = new THREE.Mesh(new THREE.LatheGeometry(pr, 48), mat(-1, 'trim')); md.position.set(-0.6, RH - 0.002, -4.15); ceilGrp.add(md);
  }
  if (BS) {     // the middle room has no window: a schoolhouse globe on a brass stem over the galley, lit day and night (§16 look pass)
    const lx = -0.75, lz = 0.2, add = (key, geo, y) => { const m = new THREE.Mesh(geo, mat(-1, key)); m.position.set(lx, y, lz); ceilGrp.add(m); };
    add('brass', cyl(0.07, 0.022, 'y', 24), RH - 0.011); add('brass', cyl(0.008, 0.36, 'y', 8), RH - 0.2); add('brass', cyl(0.05, 0.05, 'y', 20, 0.062), RH - 0.4);
    add('milk', new THREE.SphereGeometry(0.14, 28, 18), RH - 0.54);
    const cl = new THREE.PointLight(WARM, 0, 0, 2); cl.position.set(lx, RH - 0.72, lz); scene.add(cl); dayNight.push([cl, 2.4, 5.5]);
  }

  /* ---- windows: frame at the outer side of a deep plaster reveal, two sashes x two panes, painted shutters folded into the reveal (the
   *      brownstone), stool + apron (never clipped: the sill stays), casings, a brass rod with two linen panels tied back, a radiator */
  const cards = new Map();
  function curtainGeo(sd, cx) {                     // sd -1: the left panel; folds stay, the panel pinches at the tie-back
    const g = new THREE.PlaneGeometry(1, 1, 14, 30), p = g.attributes.position, hw = WIN.w / 2;
    const top = Math.min(WIN.y1 + 0.13, RH - S.crown - 0.07), bot = 0.03, tie = Math.max(1.05, WIN.y0 + 0.37), tt = (top - tie) / (top - bot);
    const uo = cx + sd * (hw + 0.3), ui0 = cx + sd * (hw - 0.03), uiT = cx + sd * (hw + 0.17), uiB = cx + sd * hw;
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i) + 0.5, t = 0.5 - p.getY(i);
      let ui; if (t <= tt) { const k = t / tt; ui = ui0 + (uiT - ui0) * (k * k * (3 - 2 * k)); } else { const k = (t - tt) / (1 - tt); ui = uiT + (uiB - uiT) * Math.sqrt(k); }
      const wid = Math.abs(ui - uo), amp = 0.01 + 0.032 * (wid / 0.33);
      p.setXYZ(i, uo + (ui - uo) * s, top + (bot - top) * t, 0.118 + amp * (0.5 + 0.5 * Math.sin(s * Math.PI * 2 * 4.5 + (sd > 0 ? 1.2 : 0))));
    }
    g.computeVertexNormals(); return g;
  }
  for (const { fi, u: cx } of WINS) {
    const f = faces[fi], Tw = walls[f.wall].T, b = f.bw, bf = f.bf, WW = WIN.w, WY0 = WIN.y0, WY1 = WIN.y1, fw = -Tw + 0.04, Fm = 0.05, hh = WY1 - WY0, hw = WW / 2;
    b.add('trim', rbox(Fm, hh, 0.05, 0.008), cx - hw + Fm / 2, (WY0 + WY1) / 2, fw).add('trim', rbox(Fm, hh, 0.05, 0.008), cx + hw - Fm / 2, (WY0 + WY1) / 2, fw);
    b.add('trim', rbox(WW, Fm, 0.05, 0.008), cx, WY1 - Fm / 2, fw).add('trim', rbox(WW, Fm, 0.06, 0.008), cx, WY0 + Fm / 2, fw);
    const ih = hh - 2 * Fm, sh = ih / 2 + 0.02, iw = WW - 2 * Fm;
    for (const [yc, wz] of [[WY1 - Fm - sh / 2, fw - 0.018], [WY0 + Fm + sh / 2, fw + 0.018]]) {
      const st = 0.045, rl = 0.05;
      b.add('trim', rbox(st, sh, 0.034, 0.006), cx - iw / 2 + st / 2, yc, wz).add('trim', rbox(st, sh, 0.034, 0.006), cx + iw / 2 - st / 2, yc, wz);
      b.add('trim', rbox(iw, rl, 0.034, 0.006), cx, yc + sh / 2 - rl / 2, wz).add('trim', rbox(iw, rl, 0.034, 0.006), cx, yc - sh / 2 + rl / 2, wz);
      b.add('trim', rbox(0.022, sh - 2 * rl + 0.01, 0.024, 0.005), cx, yc, wz);                              // the sash bar: 2 panes per sash
      b.add('glass', new THREE.PlaneGeometry(iw - 2 * st + 0.01, sh - 2 * rl + 0.01), cx, yc, wz - 0.004);
    }
    b.add('brass', rbox(0.07, 0.014, 0.03, 0.005), cx, WY0 + Fm + sh - 0.012, fw + 0.045);
    if (WIN.shutters) for (const sd of [-1, 1]) {                                   // folded-back interior shutters lining the reveal
      const sw = Tw - 0.09, su = cx + sd * (hw - 0.016), sy = (WY0 + WY1) / 2 + 0.02, shh = hh - 0.1;
      b.add('trim', rbox(0.024, shh, sw, 0.004), su, sy, -0.015 - sw / 2);
      for (const [py, ph] of [[WY0 + 0.07 + (shh - 0.2) * 0.17, (shh - 0.2) * 0.3], [WY0 + 0.07 + (shh - 0.2) * 0.5 + 0.05, (shh - 0.2) * 0.3], [WY0 + 0.07 + (shh - 0.2) * 0.84 + 0.1, (shh - 0.2) * 0.3]])
        b.add('trim', rbox(0.01, ph, sw - 0.06, 0.004), su - sd * 0.015, py, -0.015 - sw / 2);
      b.add('brass', cyl(0.006, 0.03, 'x'), su - sd * 0.02, sy, -0.04);
    }
    const sd0 = Tw - 0.05;                                                          // stool (sill), 6 cm proud, and apron: never clipped
    bf.add('trim', rbox(WW + 0.18, 0.034, sd0 + 0.06, 0.01), cx, WY0 + 0.019, (0.06 - sd0) / 2);
    bf.add('trim', rbox(WW + 0.1, 0.075, 0.02, 0.006), cx, WY0 - 0.0375, 0.01);
    for (const sd of [-1, 1]) b.add('trim', rbox(0.07, WY1 + 0.04 - (WY0 + 0.036), 0.02, 0.006), cx + sd * (hw + 0.035), (WY1 + 0.04 + WY0 + 0.036) / 2, 0.01);
    b.add('trim', rbox(WW + 0.18, 0.085, 0.026, 0.008), cx, WY1 + 0.0425, 0.013);
    const yr = Math.min(WY1 + 0.16, RH - S.crown - 0.04);
    b.add('brass', cyl(0.011, WW + 0.62, 'x'), cx, yr, 0.115);
    for (const sd of [-1, 1]) { b.add('brass', cyl(0.007, 0.115, 'z'), cx + sd * (hw + 0.2), yr, 0.058); b.add('brass', new THREE.SphereGeometry(0.022, 12, 8), cx + sd * (hw + 0.33), yr, 0.115); }
    for (const sd of [-1, 1]) {
      b.add('linen', curtainGeo(sd, cx));
      b.add('tie', new THREE.TorusGeometry(1, 0.15, 6, 24).scale(0.085, 0.05, 0.12).rotateX(Math.PI / 2), cx + sd * (hw + 0.235), Math.max(1.05, WY0 + 0.37), 0.128);
    }
    // cast-iron radiator under the window (free-standing: it stays when the wall drops)
    const rh = Math.min(0.53, WY0 - 0.17), wc = 0.11, n = 13, pitch = 0.8 / n;
    for (let k = 0; k < n; k++) bf.add('iron', rbox(pitch * 0.8, rh, 0.13, 0.02), cx - 0.4 + pitch * (k + 0.5), 0.07 + rh / 2, wc);
    bf.add('iron', cyl(0.017, 0.8, 'x'), cx, 0.12, wc).add('iron', cyl(0.017, 0.8, 'x'), cx, 0.07 + rh - 0.05, wc);
    for (const sd of [-1, 1]) bf.add('iron', rbox(0.05, 0.075, 0.13, 0.01), cx + sd * 0.35, 0.0375, wc);
    bf.add('iron', cyl(0.013, 0.07, 'x'), cx + 0.435, 0.12, wc).add('brass', cyl(0.019, 0.06), cx + 0.48, 0.13, wc).add('iron', cyl(0.013, 0.1), cx + 0.48, 0.05, wc);
  }
  // the view cards: the real city at the room's hour, 0.3 m behind each window wall's outer face, only ever seen through the glass
  for (const fi of new Set(WINS.map((w) => w.fi))) {
    const us = WINS.filter((w) => w.fi === fi).map((w) => w.u), Tw = walls[faces[fi].wall].T, cw = Math.max(4.9, Math.max(...us) - Math.min(...us) + WIN.w + 2.2), chh = cw / 1.678;
    const vm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), card = new THREE.Mesh(new THREE.PlaneGeometry(cw, chh), vm);
    card.position.set((Math.max(...us) + Math.min(...us)) / 2, (WIN.y0 + WIN.y1) / 2, -Tw - 0.3); faces[fi].W.add(card); cards.set(fi, card);
  }

  let FRONT = null;
  /* ---- doors (closed): painted jamb liners, recessed panelled leaves, casings, brass hardware, an oak saddle */
  for (const d of DOORS) {
    const f = faces[d.fi], Tw = walls[f.wall].T, b = f.bw, uc = d.u, lw = d.w - 0.04, wz = -0.065, th = 0.045, n = d.leaves || 1, each = (lw - (n - 1) * 0.004) / n;
    for (const sd of [-1, 1]) b.add('trim', rbox(0.02, d.h, Tw, 0.003), uc + sd * (d.w / 2 - 0.01), d.h / 2, -Tw / 2);
    b.add('trim', rbox(d.w, 0.02, Tw, 0.003), uc, d.h - 0.01, -Tw / 2);
    f.bf.add('oak', rbox(d.w, 0.014, Tw + 0.02, 0.004), uc, 0.007, -Tw / 2 + 0.01);
    for (const sd of [-1, 1]) b.add('trim', rbox(CW, d.h + CW, BS ? 0.03 : 0.02, 0.006), uc + sd * (d.w / 2 + CW / 2), (d.h + CW) / 2, BS ? 0.015 : 0.01);
    b.add('trim', rbox(d.w + 2 * CW + 0.04, 0.095 * (CW / 0.075), BS ? 0.05 : 0.027, 0.008), uc, d.h + 0.06 * (CW / 0.075), BS ? 0.025 : 0.0135);
    if (BS) {
      for (const sd of [-1, 1]) { b.add('trim', rbox(0.024, d.h + CW, 0.046, 0.008), uc + sd * (d.w / 2 + CW - 0.012), (d.h + CW) / 2, 0.023); b.add('trim', rbox(CW + 0.02, 0.24, 0.05, 0.006), uc + sd * (d.w / 2 + CW / 2), 0.12, 0.025); }
      b.add('trim', rbox(d.w + 2 * CW + 0.1, 0.035, 0.075, 0.01), uc, d.h + 0.06 * (CW / 0.075) + 0.08, 0.0375);
    }
    let leafShim = null;
    if (d.front) {                                                                  // the front door's leaf is its own hinged group (the swing, ROOM-V2 §13.1); everything else in the wall stays baked
      const hu = d.knob > 0 ? uc - lw / 2 : uc + lw / 2, lg = new THREE.Group(); lg.position.set(hu, 0, wz); f.W.add(lg);
      leafShim = { add(key, geo, x, y, z) { const m = new THREE.Mesh(geo, mat(f.wall, key)); m.position.set(x - hu, y, z - wz); m.castShadow = m.receiveShadow = true; lg.add(m); return leafShim; } };
      FRONT = { leaf: lg, knob: d.knob, fi: d.fi, u: uc, w: d.w, h: d.h, ang: 0 };
    }
    for (let k = 0; k < n; k++) {
      const lc = uc - lw / 2 + each / 2 + k * (each + 0.004), lh = d.h - 0.04, ly = 0.016 + lh / 2;
      const B = d.front ? leafShim : b;
      B.add(d.mat, rbox(each, lh, th, 0.006), lc, ly, wz);
      const cols = d.leaves === 2 ? 1 : 2, pw = (each - 0.16 - (cols - 1) * 0.1) / cols, front = wz + th / 2, hk = d.h / 2.1;
      for (let c = 0; c < cols; c++) for (const [py, ph] of [[1.5 * hk, 0.95 * hk], [0.5 * hk, 0.7 * hk]]) B.add(d.mat, rbox(pw, ph, 0.014, 0.006), lc - each / 2 + 0.08 + pw / 2 + c * (pw + 0.1), py, front + 0.003);
      const kx = d.leaves === 2 ? lc + (k ? -1 : 1) * (each / 2 - 0.045) : lc + d.knob * (each / 2 - 0.045);
      B.add('brass', cyl(0.028, 0.012, 'z'), kx, 0.98, front + 0.006).add('brass', cyl(0.008, 0.05, 'z'), kx, 0.98, front + 0.03).add('brass', new THREE.SphereGeometry(0.027, 16, 10), kx, 0.98, front + 0.06);
      if (d.leaves !== 2) for (const hy of [0.25, 1.05, d.h - 0.25]) B.add('brass', rbox(0.012, 0.09, 0.028, 0.004), lc - d.knob * (each / 2 + 0.002), hy, front - 0.01);
      if (d.front) { B.add('brass', cyl(0.011, 0.014, 'z'), lc, 1.55, front + 0.007); B.add('brass', cyl(0.03, 0.012, 'z'), kx, 1.14, front + 0.006).add('brass', rbox(0.014, 0.05, 0.018, 0.005), kx, 1.14, front + 0.02); }
    }
  }
  /* ---- divider openings: jamb liners, casings with plinth blocks and a corniced head on both faces; the parlour's pocket doors half out */
  walls.forEach((wl) => {
    if (!wl.div) return; const t = wl.T, fA = faces[wl.face0], fB = faces[wl.face0 + 1];
    for (const op of wl.div.open) {
      const atWall = (sd) => Math.abs(op.x + sd * op.w / 2) > wl.len / 2 - 0.05;
      for (const sd of [-1, 1]) if (!atWall(sd)) fA.bw.add('trim', rbox(0.02, op.h, t, 0.003), op.x + sd * (op.w / 2 - 0.01), op.h / 2, -t / 2);
      fA.bw.add('trim', rbox(op.w, 0.02, t, 0.003), op.x, op.h - 0.01, -t / 2);
      fA.bf.add('oak', rbox(op.w, 0.012, t + 0.03, 0.004), op.x, 0.006, -t / 2);
      for (const [f, u] of [[fA, op.x], [fB, -op.x]]) {
        for (const sd0 of [-1, 1]) {
          const sd = f.side === 'A' ? sd0 : -sd0; if (atWall(sd0)) continue;
          f.bw.add('trim', rbox(CW, op.h + 0.02, 0.022, 0.006), u + sd * (op.w / 2 + CW / 2), (op.h + 0.02) / 2, 0.011);
          f.bw.add('trim', rbox(CW + 0.016, 0.22, 0.032, 0.006), u + sd * (op.w / 2 + CW / 2), 0.11, 0.016);
        }
        const h0 = Math.max(-wl.len / 2, u - op.w / 2 - CW - 0.045), h1 = Math.min(wl.len / 2, u + op.w / 2 + CW + 0.045);
        f.bw.add('trim', rbox(h1 - h0 - 0.07, 0.14, 0.028, 0.008), (h0 + h1) / 2, op.h + 0.09, 0.014);
        f.bw.add('trim', rbox(h1 - h0, 0.04, 0.065, 0.012), (h0 + h1) / 2, op.h + 0.18, 0.0325);
      }
      if (op.pocket) for (const sd of [-1, 1]) {                                     // 1.2 m leaves, half pulled out of the wall
        const vis = op.w > 1.5 && op.w < 2.1 ? 0.3 : 0.6, lu = op.x + sd * (op.w / 2 - vis / 2 + 0.01), lh = op.h - 0.03, b = fA.bw;
        b.add('walnut', rbox(vis + 0.02, lh, 0.04, 0.006), lu, 0.01 + lh / 2, -t / 2);
        for (const s2 of [-1, 1]) for (const [py, ph] of [[lh * 0.66, lh * 0.5], [lh * 0.2, lh * 0.26]]) b.add('walnut', rbox(vis - 0.18, ph, 0.012, 0.005), lu - sd * 0.01, py, -t / 2 + s2 * 0.024);
        for (const s2 of [-1, 1]) b.add('brass', rbox(0.03, 0.12, 0.006, 0.002), lu - sd * (vis / 2 - 0.04), 1.0, -t / 2 + s2 * 0.021);
      }
    }
  });

  /* ---- the kitchen run: navy shaker base cabinets with a finished back (it shows when the wall drops), a stone counter with an undermount
   *      sink, a cooktop over an oven, the studio's under-counter fridge or the brownstone's full-height one, wall-hung uppers (they drop
   *      with the wall), a subway-tile backsplash */
  const KS = {};
  if (K) {
    const f = faces[K.fi], KB = f.bf, KW = f.bw, cd = K.cd, toe = 0.1, fz = cd - 0.022 + 0.011, bk = 0.02;
    const shaker = (b, key, u, y, w, h, z) => {
      b.add(key, rbox(w, h, 0.022, 0.0105), u, y, z);
      const s = Math.min(0.065, w * 0.18), fr = z + 0.013;
      b.add(key, rbox(s, h, 0.008, 0.003), u - w / 2 + s / 2, y, fr).add(key, rbox(s, h, 0.008, 0.003), u + w / 2 - s / 2, y, fr);
      b.add(key, rbox(w - 2 * s, s, 0.008, 0.003), u, y + h / 2 - s / 2, fr).add(key, rbox(w - 2 * s, s, 0.008, 0.003), u, y - h / 2 + s / 2, fr);
    };
    const knob = (b, u, y, z) => b.add('brass', cyl(0.006, 0.026, 'z'), u, y, z + 0.013).add('brass', new THREE.SphereGeometry(0.016, 12, 8), u, y, z + 0.03);
    const pull = (b, u, y, z, len = 0.14) => { b.add('brass', cyl(0.006, len, 'x'), u, y, z + 0.04); for (const s of [-1, 1]) b.add('brass', cyl(0.005, 0.03, 'z'), u + s * (len / 2 - 0.01), y, z + 0.025); };
    const cab = K.mods.filter((m) => m.type !== 'tall' && m.type !== 'fridgeU'), cab0 = cab[0].u0, cab1 = cab[cab.length - 1].u0 + cab[cab.length - 1].w;
    KB.add('dark', rbox(cab1 - cab0, toe, cd - 0.07, 0.01), (cab0 + cab1) / 2, toe / 2, bk + (cd - 0.07) / 2);
    KB.add('cabNavy', rbox(K.u1 - K.b0, 0.85, 0.018, 0.004), (K.b0 + K.u1) / 2, 0.43, 0.009);                     // the finished back
    for (let x = K.b0; x <= K.u1 + 1e-6; x += 0.3) KB.add('cabNavy', rbox(0.04, 0.85, 0.008, 0.003), Math.min(K.u1 - 0.02, Math.max(K.b0 + 0.02, x)), 0.43, -0.003);
    for (const m of K.mods) {
      const uc = m.u0 + m.w / 2;
      if (m.type === 'tall') {           // full-height fridge 0.68 x 1.8 m: brushed-steel doors (fridge over a freezer drawer), bar handles
        KB.add('dark', rbox(m.w, 1.8, 0.64, 0.015), uc, 0.9, 0.33).add('steel', rbox(m.w - 0.006, 1.06, 0.03, 0.012), uc, 1.26, 0.665).add('steel', rbox(m.w - 0.006, 0.66, 0.03, 0.012), uc, 0.37, 0.665);
        KB.add('steel', cyl(0.01, 0.62, 'y'), m.u0 + 0.06, 1.2, 0.72).add('steel', cyl(0.01, 0.4, 'x'), uc, 0.62, 0.72);
        for (const y of [0.92, 1.48]) KB.add('steel', cyl(0.007, 0.04, 'z'), m.u0 + 0.06, y, 0.695);
        for (const s of [-1, 1]) KB.add('steel', cyl(0.007, 0.04, 'z'), uc + s * 0.18, 0.62, 0.695);
        KW.add('trim', rbox(m.w, 0.38, 0.33, 0.01), uc, 2.03, 0.165); shaker(KW, 'trim', uc, 2.03, m.w - 0.006, 0.36, 0.341); knob(KW, uc, 1.9, 0.341);
        KS.tall = m; continue;
      }
      if (m.type === 'fridgeU') {        // under-counter fridge (0.85 m): dark body, brushed-steel door, vertical bar handle
        KB.add('dark', rbox(m.w - 0.006, 0.84, cd - 0.04, 0.01), uc, 0.42, bk + (cd - 0.04) / 2).add('steel', rbox(m.w - 0.01, 0.82, 0.026, 0.01), uc, 0.43, fz);
        KB.add('steel', cyl(0.009, 0.42, 'y'), uc - 0.24, 0.56, fz + 0.045); for (const y of [0.37, 0.75]) KB.add('steel', cyl(0.006, 0.035, 'z'), uc - 0.24, y, fz + 0.026);
      } else KB.add('cabNavy', rbox(m.w, 0.76, cd - 0.042, 0.01), uc, toe + 0.38, bk + (cd - 0.042) / 2);
      if (m.type === 'sink') {
        for (const sd of [-1, 1]) { shaker(KB, 'cabNavy', uc + sd * (m.w / 4 - 0.001), toe + 0.38, m.w / 2 - 0.006, 0.74, fz); knob(KB, uc + sd * 0.04, toe + 0.62, fz); }
        const basin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.35), mat(-1, 'basin')); basin.position.set(uc, 0.8, 0.28); basin.receiveShadow = true; f.F.add(basin);
        KB.add('dark', cyl(0.03, 0.004), uc, 0.702, 0.3);
        const c = new THREE.CatmullRomCurve3([[0, 0.9, 0.055], [0, 1.16, 0.055], [0, 1.24, 0.12], [0, 1.2, 0.22], [0, 1.12, 0.245]].map((p) => new THREE.Vector3(uc + p[0], p[1], p[2])));
        KB.add('chrome', new THREE.TubeGeometry(c, 24, 0.011, 8)).add('chrome', cyl(0.024, 0.03), uc, 0.915, 0.055).add('chrome', rbox(0.012, 0.012, 0.07, 0.004), uc + 0.07, 0.96, 0.055);
        KS.sink = m;
      } else if (m.type === 'drawers') {
        for (const [y, h] of [[toe + 0.665, 0.17], [toe + 0.43, 0.28], [toe + 0.15, 0.28]]) { shaker(KB, 'cabNavy', uc, y, m.w - 0.006, h, fz); pull(KB, uc, y + (h > 0.2 ? h / 2 - 0.06 : 0), fz); }
        KS.drawers = m;
      } else if (m.type === 'oven') {
        KB.add('steel', rbox(m.w - 0.006, 0.1, 0.022, 0.006), uc, toe + 0.7, fz);
        for (const s of [-1, 1]) KB.add('dark', cyl(0.018, 0.022, 'z'), uc + s * 0.12, toe + 0.7, fz + 0.02);
        KB.add('blackGlass', rbox(m.w - 0.006, 0.6, 0.022, 0.008), uc, toe + 0.33, fz).add('steel', cyl(0.009, 0.46, 'x'), uc, toe + 0.58, fz + 0.045);
        for (const s of [-1, 1]) KB.add('steel', cyl(0.007, 0.035, 'z'), uc + s * 0.2, toe + 0.58, fz + 0.025);
        KB.add('blackGlass', rbox(0.52, 0.008, 0.48, 0.004), uc, 0.904, 0.3);
        for (const [w, r] of [[0.18, 0.085], [0.42, 0.065]]) KB.add('ring', new THREE.TorusGeometry(r, 0.0035, 6, 36).rotateX(Math.PI / 2), uc, 0.909, w);
        KS.oven = m;
      } else if (m.type === 'end') { shaker(KB, 'cabNavy', uc, toe + 0.38, m.w - 0.006, 0.74, fz); knob(KB, uc + m.w / 2 - 0.05, toe + 0.62, fz); KS.end = m; }
      KW.add('trim', rbox(m.w, 0.75, 0.31, 0.01), uc, 1.825, 0.155); shaker(KW, 'trim', uc, 1.825, m.w - 0.006, 0.73, 0.321); knob(KW, uc + m.w / 2 - 0.08, 1.5, 0.321);
    }
    { const s = rectShape(K.b0 - 0.01, -(cd + 0.065), K.u1 + 0.005, 0), sk = KS.sink;
      if (sk) { const h = new THREE.Path(); const a = sk.u0 + sk.w / 2 - 0.23, b2 = sk.u0 + sk.w / 2 + 0.23; h.moveTo(a, -0.1); h.lineTo(b2, -0.1); h.lineTo(b2, -0.46); h.lineTo(a, -0.46); h.closePath(); s.holes.push(h); }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 2 }); g.rotateX(-Math.PI / 2); g.translate(0, 0.865, 0);
      KB.add('stone', g); }
    { const tg = new THREE.PlaneGeometry(K.u1 - K.b0, 0.55); const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (K.u1 - K.b0), uv.getY(i) * 0.55);
      const bs = new THREE.Mesh(tg, mat(f.wall, 'tile')); bs.position.set((K.b0 + K.u1) / 2, 0.9 + 0.275, 0.003); bs.receiveShadow = true; f.W.add(bs); }
  }

  /* ---- the brownstone's marble fireplace: pilasters on plinths, a frieze with a centre tablet, a moulded shelf, a black cast-iron arched
   *      insert over a sooty firebox, a grate with birch logs, and a marble hearth slab */
  if (FP) {
    const b = faces[FP.fi].bf, u = FP.u;
    for (const sd of [-1, 1]) { b.add('marble', rbox(0.24, 0.12, 0.24, 0.01), u + sd * 0.63, 0.06, 0.12); b.add('marble', rbox(0.2, 0.83, 0.2, 0.012), u + sd * 0.63, 0.535, 0.1); b.add('marble', rbox(0.23, 0.05, 0.22, 0.01), u + sd * 0.63, 0.97, 0.11); }
    b.add('marble', rbox(1.5, 0.2, 0.17, 0.01), u, 1.065, 0.085).add('marble', rbox(0.3, 0.13, 0.03, 0.008), u, 1.06, 0.18);
    b.add('marble', rbox(1.64, 0.05, 0.3, 0.014), u, 1.19, 0.15).add('marble', rbox(1.56, 0.025, 0.25, 0.008), u, 1.155, 0.125);
    b.add('marble', rbox(1.6, 0.03, 0.45, 0.008), u, 0.015, 0.225);
    const ins = rectShape(-0.53, 0.03, 0.53, 0.94), arch = new THREE.Path(); arch.moveTo(-0.29, 0.04); arch.lineTo(0.29, 0.04); arch.lineTo(0.29, 0.56); arch.absarc(0, 0.56, 0.29, 0, Math.PI, false); arch.lineTo(-0.29, 0.04); ins.holes.push(arch);
    const ig = new THREE.ExtrudeGeometry(ins, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 16 }); ig.translate(0, 0, 0.04);
    b.add('castIron', ig, u, 0, 0).add('soot', rbox(0.62, 0.88, 0.03, 0.004), u, 0.47, 0.02);
    b.add('castIron', rbox(0.46, 0.02, 0.2, 0.004), u, 0.12, 0.17);
    for (let k = 0; k < 6; k++) b.add('castIron', cyl(0.006, 0.12), u - 0.2 + k * 0.08, 0.18, 0.265);
    b.add('castIron', cyl(0.007, 0.44, 'x'), u, 0.24, 0.265);
    for (const [du, dy, dw, r] of [[-0.06, 0.17, 0.17, 0.045], [0.07, 0.17, 0.19, 0.04], [0.0, 0.245, 0.18, 0.038]]) b.add('bark', cyl(r, 0.36, 'x', 12), u + du, dy, dw);
  }

  /* ---- procedural pieces (no CC0 model): floor lamp, table lamp, café table, trash can, backpack, bottle, shoe rack, tote on hooks */
  const floorLamp = new THREE.Group(); world.add(floorLamp);
  { const base = new THREE.Mesh(cyl(0.14, 0.024, 'y', 28), mat(-1, 'dark')); base.position.y = 0.012;
    const pole = new THREE.Mesh(cyl(0.011, 1.42, 'y', 10), mat(-1, 'brass')); pole.position.y = 0.73; const nk = new THREE.Mesh(cyl(0.02, 0.05, 'y', 10), mat(-1, 'brass')); nk.position.y = 1.38;
    for (const m of [base, pole, nk]) { m.castShadow = m.receiveShadow = true; floorLamp.add(m); }
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 32, 1, true), std({ color: 0xefe7d6, map: TX.linen, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xffd49a, emissiveIntensity: 0 }));
    shade.position.y = 1.43; shade.castShadow = true; floorLamp.add(shade); floorLamp.userData.shade = shade; }
  const emissiveShades = [floorLamp.userData.shade];
  function tableLamp() {
    const g = new THREE.Group(), pr = [[0, 0], [0.06, 0], [0.065, 0.02], [0.085, 0.08], [0.09, 0.14], [0.07, 0.22], [0.03, 0.27], [0.016, 0.29], [0, 0.29]].map(([r, y]) => new THREE.Vector2(r, y));
    const base = new THREE.Mesh(new THREE.LatheGeometry(pr, 32), mat(-1, 'ceramic')); base.castShadow = true; g.add(base);
    const nk = new THREE.Mesh(cyl(0.008, 0.16, 'y', 8), mat(-1, 'brass')); nk.position.y = 0.36; g.add(nk);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.2, 32, 1, true), std({ color: 0xefe7d6, map: TX.linen, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xffd49a, emissiveIntensity: 0 }));
    sh.position.y = 0.45; sh.castShadow = true; g.add(sh); emissiveShades.push(sh); return g;
  }

  /* ---- contact shadows: one merged mesh (soft dark patches; nothing floats) */
  let shadowTex = null, contactMesh = null; const contacts = [];
  function contact(x, z, w, d, op = 0.5, ry = 0) { contacts.push([x, z, w, d, op, ry]); }
  function flushContacts() {
    if (!shadowTex) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 63); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); shadowTex = new THREE.CanvasTexture(c); }
    const P = [], U = [], C = [], I = [];
    contacts.forEach(([x, z, w, d, op, ry], k) => {
      const c = Math.cos(ry), s = Math.sin(ry);
      for (const [a, b2, uu, vv] of [[-w / 2, -d / 2, 0, 0], [w / 2, -d / 2, 1, 0], [w / 2, d / 2, 1, 1], [-w / 2, d / 2, 0, 1]]) { P.push(x + a * c + b2 * s, 0.0025, z - a * s + b2 * c); U.push(uu, vv); C.push(1, 1, 1, op); }
      I.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4, k * 4 + 3, k * 4 + 2);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4)); g.setIndex(I);
    if (contactMesh) { world.remove(contactMesh); contactMesh.geometry.dispose(); }
    contactMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, vertexColors: true, depthWrite: false, color: 0x1a120c, toneMapped: false }));
    contactMesh.renderOrder = 1; world.add(contactMesh);
  }
  for (const { fi, u } of WINS) { const [x, z] = toW(fi, u, 0.11); contact(x, z, faces[fi].ry % Math.PI ? 0.36 : 1.0, faces[fi].ry % Math.PI ? 1.0 : 0.36, 0.45); }
  if (K) { const [a, b] = toW(K.fi, K.u0, 0), [c, d] = toW(K.fi, K.u1, 0.63); contact((a + c) / 2, (b + d) / 2, Math.abs(c - a) + 0.25, Math.abs(d - b) + 0.25, 0.5); }
  if (FP) { const [x, z] = toW(FP.fi, FP.u, 0.2); contact(x, z, 0.6, 1.8, 0.45); }

  /* ---- volumes for the clearance gate, anchors for the interaction build */
  const vols = [], placed = {}, state = { shell: shellId, assets: 0, assetsTotal: 0, person: false, view: 'none', ready: false, errors: [] };
  const AABB = (name, kind, b) => vols.push({ name, kind, b: b.isBox3 ? [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] : b });
  walls.forEach((wl, i) => {
    const f = faces[wl.face0];
    if (!wl.div) { AABB('wall:' + wl.id, 'wall', vbox(wl.face0, -wl.len / 2, wl.len / 2, -wl.T, 0, -0.3, RH)); return; }
    for (const [a, b] of segs(-wl.len / 2, wl.len / 2, wl.div.open.map((op) => [op.x - op.w / 2, op.x + op.w / 2, false]))) AABB('wall:' + wl.id + '@' + a.toFixed(1), 'wall', vbox(wl.face0, a, b, -wl.T, 0, -0.3, RH));
    void f; void i;
  });
  for (const { fi, u: cx } of WINS) {
    const Tw = walls[faces[fi].wall].T, hw = WIN.w / 2;
    AABB('sill@' + fi + ':' + cx, 'shell', vbox(fi, cx - hw - 0.09, cx + hw + 0.09, -Tw + 0.05, 0.06, WIN.y0, WIN.y0 + 0.036));
    AABB('radiator@' + fi + ':' + cx, 'other', vbox(fi, cx - 0.42, cx + 0.5, 0.045, 0.175, 0, Math.min(0.62, WIN.y0 - 0.05)));
    for (const sd of [-1, 1]) AABB('curtain@' + fi + ':' + cx + (sd < 0 ? 'L' : 'R'), 'shell', vbox(fi, Math.min(cx + sd * (hw + 0.3), cx + sd * (hw - 0.04)), Math.max(cx + sd * (hw + 0.3), cx + sd * (hw - 0.04)), 0, 0.17, 0, WIN.y1 + 0.17));
  }
  if (K) { AABB('kitchen', 'other', vbox(K.fi, K.b0, K.u1, 0, K.cd + 0.065, 0, 1.25)); if (KS.tall) AABB('fridge', 'other', vbox(K.fi, KS.tall.u0, KS.tall.u0 + KS.tall.w, 0, 0.74, 0, 1.82)); }
  if (FP) { AABB('mantel', 'other', vbox(FP.fi, FP.u - 0.82, FP.u + 0.82, 0, 0.3, 0, 1.22)); AABB('hearth', 'other', vbox(FP.fi, FP.u - 0.8, FP.u + 0.8, 0, 0.45, 0, 0.03)); }
  const zoneOf = (z) => { const zn = S.zones.find((q) => z >= q.z0 - 0.01 && z <= q.z1 + 0.01); return zn ? zn.id : 'room'; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  function addAnchor(id, activity, obb, use) { ANCHORS.push({ id, activity: activity || null, zone: zoneOf(use ? use.z : obb.z), obb: { x: r3(obb.x), z: r3(obb.z), ry: r3(obb.ry), w: r3(obb.w), d: r3(obb.d), y0: r3(obb.y0 || 0), h: r3(obb.h) }, use: use ? { x: r3(use.x), z: r3(use.z), yaw: r3(use.yaw) } : null }); }
  ANCHORS.length = 0;
  for (const { fi, u } of WINS) {                                   // every window is a 'window' spot (Hariv's own is replaced by his solved spot)
    const [x, z] = toW(fi, u, 0.0), [ux, uz] = toW(fi, u, 0.62), f = faces[fi];
    addAnchor('window:' + walls[f.wall].id + ':x' + x.toFixed(2), 'window', { x, z, ry: f.ry, w: WIN.w + 0.18, d: 0.3, y0: WIN.y0, h: WIN.y1 - WIN.y0 }, { x: ux, z: uz, yaw: Math.atan2(-Math.sin(f.ry), -Math.cos(f.ry)) });
  }

  /* ---- downloaded models: one fetch per file, clones for repeats; wall-hung ones clip with their wall */
  let loader = null; const gcache = new Map();
  async function load(name) {
    if (!gcache.has(name)) {
      state.assetsTotal++;
      gcache.set(name, (async () => {
        if (!loader) { const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]); loader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); }
        const g = await loader.loadAsync(asset(name + '.glb'));
        // a transmissive material (clock / mirror glass) makes three.js re-draw every opaque object in a transmission pre-pass: plain alpha instead
        g.scene.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; for (const m of [].concat(n.material)) { if (m.map) m.map.anisotropy = 8; if (m.transmission > 0) { state.transmissive = (state.transmissive || '') + name + ' '; m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.3); m.depthWrite = false; n.castShadow = false; } } } });
        state.assets++; return g.scene;
      })());
    }
    return (await gcache.get(name)).clone(true);
  }
  const safe = (n) => load(n).catch((e) => { state.errors.push(n + ': ' + e.message); return null; });
  function put(id, obj, x, z, ry = 0, y = 0, op = {}) {
    if (!obj) return null;
    if (op.cast === false) obj.traverse((n) => { if (n.isMesh) n.castShadow = false; });
    const lb = new THREE.Box3().setFromObject(obj), g = new THREE.Group(); g.add(obj); g.position.set(x, y, z); g.rotation.y = ry; g.name = id; world.add(g); g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g); placed[id] = { g, bb, lb, ry };
    (state.sizes = state.sizes || {})[id] = [+(lb.max.x - lb.min.x).toFixed(3), +(lb.max.y - lb.min.y).toFixed(3), +(lb.max.z - lb.min.z).toFixed(3)];
    if (op.vol !== false) {
      AABB(id, op.kind || 'other', bb);
      const lc = lb.getCenter(new THREE.Vector3()), wc = g.localToWorld(lc.clone());     // the piece's own oriented footprint for walking (room2_walk.js §15): centre, half extents in its own frame, rotation
      vols[vols.length - 1].ob = { x: wc.x, z: wc.z, hx: (lb.max.x - lb.min.x) / 2, hz: (lb.max.z - lb.min.z) / 2, ry };
    }
    if (op.shadow) { const c = lb.getCenter(new THREE.Vector3()); g.localToWorld(c); contact(c.x, c.z, (lb.max.x - lb.min.x) * 1.12 + 0.08, (lb.max.z - lb.min.z) * 1.12 + 0.08, op.shadow, ry); }
    if (op.anchor) {
      const c = lb.getCenter(new THREE.Vector3()), wc = g.localToWorld(c.clone()), w = lb.max.x - lb.min.x, d = lb.max.z - lb.min.z;
      let use = op.use;
      if (use === 'front' || !use) { const p = g.localToWorld(new THREE.Vector3(c.x, 0, lb.max.z + 0.35)); use = { x: p.x, z: p.z, yaw: ry + Math.PI }; }
      else if (use === 'seat') { const p = g.localToWorld(new THREE.Vector3(c.x, 0, c.z + d * 0.08)); use = { x: p.x, z: p.z, yaw: ry }; }
      addAnchor(id, op.activity, { x: wc.x, z: wc.z, ry, w, d, y0: bb.min.y, h: lb.max.y - lb.min.y }, use);
    }
    return bb;
  }
  function onWall(fi, obj, u, y, op = {}) {      // wall-hung: lives in the face's clipped frame, so it drops (hides) with its wall
    if (!obj) return null; const f = faces[fi];
    if (op.scale) obj.scale.setScalar(op.scale);
    obj.traverse((n) => { if (n.isMesh) { n.material = [].concat(n.material).map((m) => { const c = m.clone(); c.clippingPlanes = [planes[f.wall]]; return c; }); if (n.material.length === 1) n.material = n.material[0]; } });
    const lb = new THREE.Box3().setFromObject(obj); obj.position.set(u, y, -lb.min.z + 0.004); f.W.add(obj); return obj;
  }
  function print(fi, u, y, w, h, paint, frame = 'walnut', fw = 0.03) {        // wall-hung (clipped with its wall): a frame + a painted canvas
    const f = faces[fi]; f.bw.add(frame, rbox(w + 2 * fw, h + 2 * fw, 0.03, 0.006), u, y + h / 2, 0.015);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTex(512, paint), roughness: 0.85, dithering: true, clippingPlanes: [planes[f.wall]] }));
    pl.position.set(u, y + h / 2, 0.0305); pl.receiveShadow = true; f.W.add(pl);
  }
  /* ---- the wall clock shows the real local time: two hands in the face frame (they ride the wall: clipped with it) */
  const clockHands = [];
  function addClockHands(fi, ck) {
    if (!ck) return; const f = faces[fi]; f.W.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(ck), c = f.W.worldToLocal(bb.getCenter(new THREE.Vector3())), mx = f.W.worldToLocal(bb.max.clone()), mn = f.W.worldToLocal(bb.min.clone());
    const R = Math.min(Math.abs(mx.x - mn.x), Math.abs(mx.y - mn.y)) / 2, zf = Math.max(mx.z, mn.z);
    for (const [len, wd, k] of [[R * 0.5, 0.014, 'h'], [R * 0.76, 0.009, 'm']]) {
      const pv = new THREE.Group(); pv.position.set(c.x, c.y, zf + (k === 'h' ? 0.003 : 0.006));
      const g = rbox(wd, len, 0.003, 0.0012); g.translate(0, len / 2 - 0.01, 0); const m = new THREE.Mesh(g, mat(f.wall, 'dark')); pv.add(m); f.W.add(pv); clockHands.push([k, pv]);
    }
    setClock();
  }
  function setClock() {
    let hv; try { hv = hourNow(); } catch { const d = new Date(); hv = d.getHours() + d.getMinutes() / 60; }   // the same hour as the sky and the top bar (NYC by default)
    const h = ((hv % 12) + 12) % 12, mi = (h % 1) * 60;
    for (const [k, pv] of clockHands) pv.rotation.z = -(k === 'h' ? h / 12 : mi / 60) * Math.PI * 2;
    renderer.shadowMap.needsUpdate = true; kick();
  }
  const clockTimer = setInterval(() => { if (!disposed && clockHands.length) setClock(); }, 20000);
  const ray = new THREE.Raycaster();
  function tops(obj, x, z) { obj.updateMatrixWorld(true); ray.set(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0)); return ray.intersectObject(obj, true).map((h) => h.point.y); }
  const topAt = (obj, x, z, dflt) => { const t = tops(obj, x, z); return t.length ? Math.max(...t) : dflt; };
  const proc = (key, geo, x, y, z, ry = 0) => BX.add(key, geo, x, y, z, ry);
  function bake(g) { g.updateMatrixWorld(true); g.traverse((n) => { if (n.isMesh && n.userData.k) bAdd(-1, null, n.userData.k, n.geometry.clone().applyMatrix4(n.matrixWorld)); }); world.remove(g); }
  const placeFloorLamp = (x, z, tx, tz) => {
    floorLamp.position.set(x, 0, z); floorLampL.position.set(x, 1.36, z); floorLampL.target.position.set(tx, 0, tz); floorGlow.position.set(x, 1.5, z);
    contact(x, z, 0.42, 0.42, 0.5); AABB('floorlamp', 'other', [x - 0.2, 0, z - 0.2, x + 0.2, 1.58, z + 0.2]); vols[vols.length - 1].ob = { x, z, r: 0.12 };
    addAnchor('floorlamp', null, { x, z, ry: 0, w: 0.4, d: 0.4, h: 1.58 }, null);
  };
  const deskLampAim = (lampBB, lp, D, ryL) => {
    const c = Math.cos(ryL), s = Math.sin(ryL), hx = 0, hz = 0.12, hy = lampBB.max.y - 0.07;
    deskSpot.position.set(lp.position.x + hx * c + hz * s, hy, lp.position.z - hx * s + hz * c); deskSpot.target.position.set((D.min.x + D.max.x) / 2 - 0.1, D.max.y, (D.min.z + D.max.z) / 2 + 0.05);
  };
  const sizeOf = (ob) => new THREE.Box3().setFromObject(ob).getSize(new THREE.Vector3());
  const bedFile = PQ.get('bed') === 'grey' ? 'bed_grey' : 'bed';
  let Fm = null;
  const mug = (x, y, z, r) => { if (!Fm) return; const m = Fm.makeMug(); m.traverse((n) => { if (n.isMesh) n.castShadow = n.receiveShadow = true; }); m.position.set(x, y, z); m.rotation.y = r; world.add(m); return m; };

  /* ---- the studio's furniture (the proof, unchanged) */
  async function dressStudio() {
    const [bed, desk, chair, sofa, rug, lamp] = await Promise.all([bedFile, 'desk', 'chair', 'sofa', 'rug', 'lamp'].map(safe));
    const WX = (i) => WINS[i].u;
    if (bed) { const s = sizeOf(bed); put('bed', bed, X0 + s.z / 2 + 0.025, -0.45, Math.PI / 2, 0, { shadow: 0.55, anchor: true, activity: 'bed_sleep', use: 'seat' }); }
    if (desk) { const s = sizeOf(desk); put('desk', desk, WX(1), Z0 + 0.2 + s.z / 2, 0, 0, { shadow: 0.55, anchor: true }); }
    const D = placed.desk && placed.desk.bb;
    if (chair) { const s = sizeOf(chair); put('chair', chair, WX(1), (D ? D.max.z : Z0 + 0.8) + s.z / 2 + 0.07, Math.PI, 0, { shadow: 0.4, anchor: true, activity: 'desk_typing', use: 'seat' }); }
    if (sofa) { const s = sizeOf(sofa); put('sofa', sofa, X1 - s.z / 2 - 0.035, 0.05, -Math.PI / 2, 0, { shadow: 0.55, anchor: true, activity: 'sofa_read', use: 'seat' }); }
    if (rug) { const s = sizeOf(rug); put('rug', rug, 0.25, -0.2, s.x < s.z ? Math.PI / 2 : 0, 0, { kind: 'footrest' }); }
    if (lamp && D) { const bb = put('lamp', lamp, D.max.x - 0.17, D.min.z + 0.15, -0.93, D.max.y); deskLampAim(bb, placed.lamp.g, D, -0.93); }
    const Sb = placed.sofa && placed.sofa.bb;
    placeFloorLamp(X1 - 0.4, Sb ? Sb.min.z - 0.3 : -1.1, X1 - 0.65, (Sb ? Sb.min.z - 0.3 : -1.1) + 0.2);
    Fm = await import('./people_fit.js').catch(() => null);
    if (KS.drawers) for (const [du, w, r] of [[0.22, 0.34, 0.6], [0.36, 0.46, 2.2]]) { const [x, z] = toW(K.fi, KS.drawers.u0 + du, w); mug(x, 0.9, z, r); }
    if (KS.drawers) { const [x, z] = toW(K.fi, KS.drawers.u0 + 0.3, 0.6); addAnchor('kitchen', 'kettle', { x: (toW(K.fi, (K.b0 + K.u1) / 2, 0.31))[0], z: (toW(K.fi, (K.b0 + K.u1) / 2, 0.31))[1], ry: faces[K.fi].ry, w: K.u1 - K.b0, d: 0.63, h: 0.9 }, { x, z, yaw: Math.atan2(-Math.sin(faces[K.fi].ry), -Math.cos(faces[K.fi].ry)) }); }
  }

  /* ---- the brownstone's furniture and the lived-in layer (§13.1) */
  async function dressBrownstone() {
    const names = [bedFile, 'desk', 'sofa', 'rug', ...['plant_big', 'plant_small', 'books', 'frame3', 'mirror', 'kettle', 'bowl', 'apple', 'lemon', 'wallclock', 'alarm', 'nightstand', 'armchair', 'cafechair', 'shelf', 'basket', 'laptop', 'officechair', 'desklamp', 'vase', 'candle', 'board', 'coffeetable'].map((n) => 'bs/' + n)];
    await Promise.all(names.map(safe));                                                    // warm the cache in parallel
    const L = (n) => safe(n.includes('/') || n === bedFile || ['desk', 'chair', 'sofa', 'rug', 'lamp'].includes(n) ? n : 'bs/' + n);
    Fm = await import('./people_fit.js').catch(() => null);
    const wInto = (fi) => Math.atan2(-Math.sin(faces[fi].ry), -Math.cos(faces[fi].ry));       // facing the wall
    const BOOKC = ['cover1', 'cover5', 'cover2', 'leather', 'cover3', 'cover4'];
    const bookRow = (x, y, z, ry, len, k) => {         // cheap standing books (plain boxes, merged): spines along the row, facing its +z (the GLB set is 7.4k triangles)
      const c = Math.cos(ry), sn = Math.sin(ry); let u = -len / 2;
      while (u < len / 2 - 0.03) { const w = 0.022 + ((k * 37) % 7) * 0.004, h = 0.165 + ((k * 53) % 5) * 0.008, d = 0.13 + ((k * 11) % 3) * 0.01, lx = u + w / 2;
        proc(BOOKC[k % BOOKC.length], new THREE.BoxGeometry(w, h, d), x + lx * c, y + h / 2, z - lx * sn, ry); u += w + 0.002; k++; }
    };
    const stain = (ob, hex, rough) => { if (ob) ob.traverse((n) => { if (!n.isMesh) return; const a = [].concat(n.material).map((m) => { const c = m.clone(); c.color.setHex(hex); if (rough != null) c.roughness = rough; return c; }); n.material = a.length === 1 ? a[0] : a; }); return ob; };
    // -- front parlour: the study spot at the left street window, facing out
    const desk = await L('desk'); put('desk', desk, WINS[0].u, Z0 + 0.57, 0, 0, { shadow: 0.55, anchor: true });
    const D = placed.desk.bb, dTop = D.max.y;
    const chair = await L('officechair'); { const s = sizeOf(chair); put('chair', chair, WINS[0].u + 0.22, D.max.z + s.z / 2 + 0.07, Math.PI - 0.08, 0, { shadow: 0.4, anchor: true, activity: 'desk_typing', use: 'seat' }); }
    const lamp = await L('desklamp'); if (lamp) { const bb = put('lamp', lamp, D.max.x - 0.17, D.min.z + 0.15, -0.93, dTop, { vol: false }); deskLampAim(bb, placed.lamp.g, D, -0.93); }
    const laptop = await L('laptop'); put('laptop', laptop, WINS[0].u - 0.08, (D.min.z + D.max.z) / 2 + 0.06, 0.05, dTop, { vol: false });
    proc('bottle', cyl(0.035, 0.22, 'y', 20), D.min.x + 0.12, dTop + 0.11, D.min.z + 0.14); proc('dark', cyl(0.028, 0.04, 'y', 16), D.min.x + 0.12, dTop + 0.24, D.min.z + 0.14);
    mug(D.min.x + 0.3, dTop, D.max.z - 0.14, 2.6);
    { // the power strip under the desk and the charger cable up the back leg to the laptop
      const px = WINS[0].u - 0.2, pz = Z0 + 0.24; proc('plastic', rbox(0.28, 0.035, 0.055, 0.008), px, 0.0175, pz);
      for (let k = 0; k < 4; k++) proc('dark', rbox(0.03, 0.006, 0.03, 0.003), px - 0.1 + k * 0.065, 0.036, pz);
      const c = new THREE.CatmullRomCurve3([[px - 0.1, 0.04, pz], [px - 0.16, 0.02, pz + 0.08], [D.min.x + 0.45, 0.05, D.min.z + 0.05], [D.min.x + 0.47, dTop - 0.05, D.min.z + 0.04], [WINS[0].u - 0.25, dTop + 0.008, D.min.z + 0.12]].map((p) => new THREE.Vector3(...p)));
      proc('dark', new THREE.TubeGeometry(c, 40, 0.0035, 6), 0, 0, 0);
    }
    { // the backpack by the chair, leaning a little
      const g = new THREE.Group(); g.position.set(D.min.x - 0.12, 0, D.min.z + 0.3); g.rotation.y = 0.5; world.add(g);
      const add = (key, geo, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat(-1, key)); m.position.set(x, y, z); m.rotation.x = rx; m.userData.k = key; g.add(m); };
      add('navyFab', rbox(0.3, 0.42, 0.17, 0.06), 0, 0.21, 0, -0.12); add('navyFab', rbox(0.23, 0.17, 0.06, 0.03), 0, 0.13, 0.1, -0.12);
      add('leather', rbox(0.06, 0.012, 0.03, 0.005), 0, 0.24, 0.115, -0.12); add('navyFab', new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), 0, 0.42, -0.04, 0);
      for (const sd of [-1, 1]) add('navyFab', rbox(0.045, 0.34, 0.014, 0.006), sd * 0.08, 0.24, -0.09, -0.15);
      contact(g.position.x, g.position.z, 0.42, 0.32, 0.45, 0.5); AABB('backpack', 'other', new THREE.Box3().setFromObject(g)); bake(g);
    }
    { // a small waste basket by the desk
      const x = D.max.x + 0.2, z = Z0 + 0.42; proc('steelD', new THREE.CylinderGeometry(0.12, 0.1, 0.3, 28, 1, true), x, 0.15, z); proc('steel', cyl(0.1, 0.006, 'y', 28), x, 0.004, z);
      proc('steel', new THREE.TorusGeometry(0.12, 0.006, 6, 28).rotateX(Math.PI / 2), x, 0.3, z); contact(x, z, 0.32, 0.32, 0.45); AABB('trash', 'other', [x - 0.13, 0, z - 0.13, x + 0.13, 0.31, z + 0.13]);
    }
    // the loveseat (the long sofa shrunk to 1.55 m) backs on the stair-hall wall and faces the fireplace across the rug; the coffee table (0.5 x 0.9) between
    const sofa = await L('sofa'); { const s0 = sizeOf(sofa); sofa.scale.x = 1.55 / s0.x; }
    put('sofa', sofa, S.parts[0].c - 0.03 - sizeOf(sofa).z / 2, -3.95, -Math.PI / 2, 0, { shadow: 0.55, anchor: true, activity: 'sofa_read', use: 'seat' });
    const Sb = placed.sofa.bb;
    const rug = await L('rug'); { rug.scale.setScalar(0.82); put('rug', rug, Sb.min.x - 0.1 - sizeOf(rug).x / 2 + 0.25, -3.95, 0, 0, { kind: 'footrest' }); }
    const ct = await L('coffeetable'); { ct.scale.set(0.5 / 0.6, 1, 0.9 / 1.202); put('coffeetable', ct, Sb.min.x - 0.45 - sizeOf(ct).x / 2, -3.95, 0, 0, { shadow: 0.45, anchor: true }); }
    const C = placed.coffeetable.bb, cTop = topAt(placed.coffeetable.g, (C.min.x + C.max.x) / 2, -3.95, C.max.y);
    mug((C.min.x + C.max.x) / 2 + 0.06, cTop, -4.22, 0.8);
    proc('cover2', rbox(0.16, 0.028, 0.23, 0.004), (C.min.x + C.max.x) / 2 - 0.04, cTop + 0.014, -3.71, 0.3); proc('plate', rbox(0.15, 0.022, 0.22, 0.003), (C.min.x + C.max.x) / 2 - 0.035, cTop + 0.04, -3.71, 0.25);
    const ps1 = await L('plant_small'); put('plant_small@coffee', ps1, (C.min.x + C.max.x) / 2, -3.95, 0.4, cTop, { vol: false });
    { // a knit throw folded on the sofa seat, street end
      const seatY = topAt(placed.sofa.g, (Sb.min.x + Sb.max.x) / 2 - 0.1, Sb.min.z + 0.35, 0.45);
      proc('knit', rbox(0.42, 0.06, 0.5, 0.025), (Sb.min.x + Sb.max.x) / 2 - 0.08, seatY + 0.03, Sb.min.z + 0.38, 0.12);
    }
    placeFloorLamp(S.parts[0].c - 0.2, Sb.max.z + 0.2, Sb.min.x - 0.3, Sb.max.z);
    // the armchair angled to the hearth, the bookshelf beside the fireplace
    const arm = await L('armchair'); { const tx = -0.3, tz = -3.7, x = -1.7, z = -2.2; put('armchair', arm, x, z, Math.atan2(tx - x, tz - z), 0, { shadow: 0.5, anchor: true, activity: 'sofa_read', use: 'seat' }); }
    const shelf = stain(await L('shelf'), 0x6f4a31, 0.55); { const s = sizeOf(shelf); const [x, z] = toW(8, -2.6, s.z / 2 + 0.015); put('shelf', shelf, x, z, faces[8].ry, 0, { shadow: 0.45, anchor: true });
      const sg = placed.shelf.g, ys = [...new Set(tops(sg, x, z + 0.2).map((v) => +v.toFixed(3)))].sort((a, b) => a - b), boards = ys.filter((y, k) => k < ys.length - 1 && ys[k + 1] - y > 0.21 && y < 1.9);
      let k = 0;
      for (const y of boards) {
        const ox = k % 2 ? -0.27 : 0.27;                                                   // books at one end, something else at the other
        if (k < 4) { const bk = await L('books'); bk.scale.setScalar(0.82); put('books@' + k, bk, x, z + (k % 2 ? 0.18 : -0.18), faces[8].ry, y + 0.002, { vol: false, cast: false }); }
        else bookRow(x, y + 0.002, z + (k % 2 ? 0.16 : -0.16), faces[8].ry, 0.42, k * 3);
        if (k === 4) { const v = await L('vase'); v.scale.setScalar(0.6); put('vase@shelf', v, x, z + ox, 0, y + 0.002, { vol: false, cast: false }); }
        else if (k === 1) { const pl = await L('plant_small'); put('plant@shelf', pl, x, z + ox, 0.7, y + 0.002, { vol: false, cast: false }); }
        else bookRow(x, y + 0.002, z + ox, faces[8].ry, 0.24, k * 5 + 1);
        k++;
      }
      state.shelfBoards = boards.map((v) => +v.toFixed(3)); state.shelfHits = ys;
    }
    // the mantel: the gilt mirror above, candlesticks, a vase, a small plant
    if (FP) {
      onWall(FP.fi, await L('mirror'), FP.u, 1.28, { scale: 2.15 });
      for (const sd of [-1, 1]) { const cd = await L('candle'); const [x, z] = toW(FP.fi, FP.u + sd * 0.66, 0.15); put('candle@' + sd, cd, x, z, 0, 1.215, { vol: false }); }
      { const v = await L('vase'); v.scale.setScalar(0.75); const [x, z] = toW(FP.fi, FP.u - 0.36, 0.15); put('vase@mantel', v, x, z, 0, 1.215, { vol: false }); }
      { const bk = await L('books'); bk.scale.setScalar(0.85); const [x, z] = toW(FP.fi, FP.u + 0.28, 0.13); put('books@mantel', bk, x, z, faces[FP.fi].ry, 1.215, { vol: false }); }
      const [hx, hz] = toW(FP.fi, FP.u, 0.12); addAnchor('fireplace', null, { x: hx, z: hz, ry: faces[FP.fi].ry, w: 1.64, d: 0.3, h: 1.22 }, null);
    }
    const ps2 = await L('plant_small'); { const [x, z] = toW(0, WINS[0].u - 0.33, -0.06); put('plant_small@sill', ps2, x, z, 0.3, WIN.y0 + 0.036, { vol: false }); }
    const pb1 = await L('plant_big'); put('plant_big@parlour', pb1, 0.78, -1.92, 0.6, 0, { shadow: 0.45 });
    print(8, -1.25, 1.3, 0.9, 0.62, riverPaint);
    // a salon-style gallery round it over the sofa (the east wall), and a map by the street corner of the west wall
    print(8, -2.11, 1.3, 0.4, 0.54, photoPaint, 'dark', 0.022); print(8, -0.45, 1.66, 0.34, 0.44, fernPaint, 'gilt', 0.025);
    print(8, -0.45, 1.2, 0.34, 0.34, abstractPaint, 'dark', 0.02); print(8, -1.25, 2.04, 0.46, 0.32, seaPaint, 'gilt', 0.025);
    print(2, 2.7, 1.45, 0.56, 0.72, mapPaint, 'walnut', 0.035);
    onWall(faces.findIndex((f) => f.wall === 4 && f.side === 'B'), await L('frame3'), 1.3, 1.55);
    // -- the middle: café table + 2 chairs, fruit bowl; kettle, mugs, dish rack, cutting board on the counter; the clock; coat hooks + shoes
    // (no café table: the middle room's route is 1.78 m between the counter and the bathroom, so a bistro set would pinch it, §16.1 "if routes allow")
    if (KS.tall) {          // the fruit bowl rides on top of the fridge
      const [x, z] = toW(K.fi, KS.tall.u0 + KS.tall.w / 2, 0.36), fy = 1.83, bw = await L('bowl'); put('bowl', bw, x, z, 0, fy, { vol: false });
      for (const [fx, fz, n] of [[-0.09, 0.0, 'apple'], [-0.01, 0.06, 'apple'], [-0.03, -0.05, 'lemon'], [0.02, 0.0, 'apple']]) { const fr = await L(n); put(n + '@' + fx, fr, x + fx, z + fz, fx * 20, fy + 0.02 + (n === 'apple' && fx === -0.01 ? 0.03 : 0), { vol: false }); }
    }
    if (KS.drawers) {
      const f = K.fi, ufc = KS.drawers.u0, top = 0.9;
      { const kt = await L('kettle'); const [x, z] = toW(f, ufc + 0.17, 0.3); put('kettle', kt, x, z, faces[f].ry + 0.5, top, { vol: false }); void x;
        const [ux, uz] = toW(f, ufc + 0.17, K.cd + 0.065 + 0.32), [ax, az] = toW(f, (K.b0 + K.u1) / 2, 0.31);
        addAnchor('kitchen', 'kettle', { x: ax, z: az, ry: faces[f].ry, w: K.u1 - K.b0, d: 0.63, h: 0.9 }, { x: ux, z: uz, yaw: wInto(f) }); }
      { const [x, z] = toW(f, ufc + 0.36, 0.5); mug(x, top, z, 0.6); }
      { const bd = await L('board'); bd.rotation.x = -(Math.PI / 2 + 0.15); const g = new THREE.Group(); g.add(bd); const [x, z] = toW(f, ufc + 0.25, 0.075); g.position.set(x, top + 0.125, z); g.rotation.y = faces[f].ry; world.add(g); }
      { // dish rack next to the sink: a white tray, a wire frame and three plates on edge
        const g = new THREE.Group(); const [x, z] = toW(f, ufc + 0.56, 0.28); g.position.set(x, top, z); g.rotation.y = faces[f].ry; world.add(g);
        const add = (key, geo, a, y, b2, rx = 0) => { const m = new THREE.Mesh(geo, mat(-1, key)); m.position.set(a, y, b2); m.rotation.x = rx; m.userData.k = key; g.add(m); };
        add('plastic', rbox(0.27, 0.025, 0.36, 0.008), 0, 0.0125, 0);
        for (const sd of [-1, 1]) for (const b2 of [-0.15, 0.15]) add('chrome', cyl(0.003, 0.14), sd * 0.12, 0.09, b2);
        for (const sd of [-1, 1]) add('chrome', cyl(0.003, 0.3, 'z'), sd * 0.12, 0.16, 0);
        for (let k = 0; k < 3; k++) add('plate', cyl(0.105, 0.012, 'z', 32), 0, 0.13, -0.08 + k * 0.06, -0.12);
        bake(g);
      }
    }
    if (KS.oven) {
      const f = K.fi, uc = KS.oven.u0 + KS.oven.w / 2, [px, pz] = toW(f, uc, 0.18), cy = 0.909;
      proc('steel', cyl(0.1, 0.13, 'y', 28), px, cy + 0.065, pz); proc('steel', cyl(0.104, 0.012, 'y', 28), px, cy + 0.136, pz); proc('dark', new THREE.SphereGeometry(0.02, 12, 8), px, cy + 0.15, pz);
      for (const sd of [-1, 1]) { const [hx, hz] = toW(f, uc + sd * 0.12, 0.18); proc('dark', rbox(0.045, 0.016, 0.026, 0.006), hx, cy + 0.11, hz, faces[f].ry); }
      const b = faces[f].bf, fz = K.cd - 0.011;
      b.add('knit', rbox(0.22, 0.32, 0.008, 0.003), uc + 0.1, 0.53, fz + 0.063).add('knit', rbox(0.22, 0.1, 0.008, 0.003), uc + 0.1, 0.64, fz + 0.03);
    }
    { const rg = new THREE.PlaneGeometry(0.72, 2.3); rg.rotateX(-Math.PI / 2); proc('runner', rg, -0.92, 0.004, 0.15); contact(-0.92, 0.15, 0.8, 2.4, 0.16);
      const mg = new THREE.PlaneGeometry(0.44, 0.7); mg.rotateX(-Math.PI / 2); proc('coir', mg, 0.8, 0.005, -0.3); }
    { const bf = faces.findIndex((q) => q.wall === 5 && q.side === 'B'); const ck = onWall(bf, await L('wallclock'), 0.2, 1.85); addClockHands(bf, ck); print(12, 0, 1.3, 0.46, 0.6, lemonPaint, 'dark', 0.022); }
    { // coat hooks (walnut rail, brass hooks) with a canvas tote and an olive jacket-free scarf loop; a shoe rack with 2 pairs below
      const fa = faces.findIndex((q) => q.wall === 4 && q.side === 'A'), f = faces[fa], b = f.bw, u0 = 1.3 - 0.05;
      b.add('walnut', rbox(0.62, 0.09, 0.022, 0.006), u0 + 0.05, 1.72, 0.011);
      for (let k = 0; k < 4; k++) { b.add('brass', cyl(0.008, 0.06, 'z'), u0 - 0.2 + k * 0.17, 1.72, 0.05); b.add('brass', new THREE.SphereGeometry(0.013, 10, 8), u0 - 0.2 + k * 0.17, 1.725, 0.082); }
      b.add('canvasBag', rbox(0.36, 0.4, 0.07, 0.02), u0 - 0.03, 1.38, 0.06).add('canvasBag', new THREE.TorusGeometry(0.1, 0.008, 6, 16, Math.PI), u0 - 0.03, 1.575, 0.06);
      b.add('olive', rbox(0.2, 0.55, 0.05, 0.02), u0 + 0.31, 1.42, 0.05).add('olive', rbox(0.17, 0.12, 0.06, 0.03), u0 + 0.31, 1.7, 0.06);
      const sb = f.bf, rw = 0.62, rd = 0.3;
      for (const y of [0.08, 0.3]) for (let k = 0; k < 5; k++) sb.add('walnut', rbox(rw, 0.018, 0.045, 0.004), u0 + 0.05, y, 0.03 + k * 0.06);
      for (const sd of [-1, 1]) for (const w of [0.03, rd - 0.03]) sb.add('walnut', rbox(0.03, 0.32, 0.03, 0.006), u0 + 0.05 + sd * (rw / 2 - 0.015), 0.16, w);
      for (const [du, y, key] of [[-0.12, 0.09, 'navyFab'], [0.13, 0.31, 'leather']]) for (const sd of [-1, 1]) {
        sb.add('sole', rbox(0.095, 0.025, 0.27, 0.012), u0 + 0.05 + du + sd * 0.055, y + 0.0215, 0.15);
        sb.add(key, rbox(0.088, 0.075, 0.2, 0.035), u0 + 0.05 + du + sd * 0.055, y + 0.07, 0.17);
      }
      const [x, z] = toW(fa, u0 + 0.05, rd / 2); contact(x, z, 0.7, 0.4, 0.4); AABB('shoerack', 'other', vbox(fa, u0 + 0.05 - rw / 2, u0 + 0.05 + rw / 2, 0, rd, 0, 0.42));
    }
    // -- back bedroom: the Dark Modern Bed against the divider, facing the gardens; nightstand + lamp + alarm clock; basket; plant; a print
    const bed = await L(bedFile); { const s = sizeOf(bed); const dz = S.dividers[1].z + S.dividers[1].t / 2; put('bed', bed, 0.45, dz + s.z / 2 + 0.02, 0, 0, { shadow: 0.55, anchor: true, activity: 'bed_sleep', use: 'seat' }); }
    const B = placed.bed.bb;
    const ns = await L('nightstand'); { const s = sizeOf(ns); put('nightstand', ns, B.max.x + 0.08 + s.x / 2, S.dividers[1].z + S.dividers[1].t / 2 + s.z / 2 + 0.03, 0, 0, { shadow: 0.45, anchor: true }); }
    { const N = placed.nightstand.bb, nx = (N.min.x + N.max.x) / 2, nz = (N.min.z + N.max.z) / 2, nTop = topAt(placed.nightstand.g, nx, nz, N.max.y);
      const tl = tableLamp(); tl.position.set(nx - 0.08, nTop, nz - 0.04); world.add(tl); point(nx - 0.04, nTop + 0.42, nz + 0.3, 1.3);                     // in front of the shade: no hotspot on the wall behind
      const al = await L('alarm'); put('alarm', al, nx + 0.13, nz + 0.06, -0.3, nTop, { vol: false });
      proc('cover1', rbox(0.15, 0.03, 0.22, 0.004), nx + 0.1, nTop + 0.015, nz - 0.08, 0.15); }
    // the laundry basket under the leaf print in the doorway corner, a towel and a navy tee on top
    const bk = await L('basket'); put('basket', bk, X0 + 0.32, 3.05, 0.2, 0, { shadow: 0.45 });
    { const Kb = placed.basket.bb, ty = Kb.max.y; proc('knit', rbox(0.3, 0.05, 0.22, 0.02), X0 + 0.3, ty - 0.012, 3.02, 0.35); proc('navyFab', rbox(0.24, 0.035, 0.18, 0.015), X0 + 0.36, ty + 0.022, 3.1, -0.3); }
    // a bigger rug across the room under the lower bed, faded so it is not the parlour's twin
    { const r2 = stain(await L('rug'), 0xcdbfb0); put('rug@bedroom', r2, 0.45, B.max.z - 0.25, Math.PI / 2, 0, { kind: 'footrest' }); }
    const pb2 = await L('plant_big'); put('plant_big@bedroom', pb2, X1 - 0.36, Z1 - 0.45, 2.2, 0, { shadow: 0.45 });
    const ps3 = await L('plant_small'); { const [x, z] = toW(1, WINS[3].u + 0.3, -0.06); put('plant_small@garden', ps3, x, z, 1.1, WIN.y0 + 0.036, { vol: false }); }
    print(2, -2.9, 1.25, 0.5, 0.7, leafPaint);
    { const hb = faces.findIndex((q) => q.wall === 5 && q.side === 'A'); print(hb, 0.45, Math.max(1.35, B.max.y + 0.28), 1.15, 0.5, seaPaint, 'walnut', 0.03); }
    { // the closet: a painted built-in with panelled double doors (the server's closet keep-out x -2.3..-1.6, z 3.75..5.25); it drops with the west wall
      const f = faces[2], b = f.bw, uc = -4.5, cw = 1.5, cd = 0.62, ch = 2.5, lh = 2.2, ly0 = 0.11, each = (cw - 0.076) / 2;
      f.bf.add('trim', rbox(cw - 0.01, STUB, cd - 0.04, 0.004), uc, STUB / 2, (cd - 0.04) / 2);                   // the stub that shows when the wall is down
      for (const sd of [-1, 1]) b.add('trim', rbox(0.035, ch, cd, 0.006), uc + sd * (cw / 2 - 0.0175), ch / 2, cd / 2);
      b.add('trim', rbox(cw - 0.07, ly0, 0.03, 0.004), uc, ly0 / 2, cd - 0.045);                                       // recessed plinth
      b.add('trim', rbox(cw, ch - ly0 - lh, 0.035, 0.006), uc, ly0 + lh + (ch - ly0 - lh) / 2, cd - 0.0175);              // head rail
      b.add('trim', rbox(cw + 0.06, 0.035, cd + 0.03, 0.008), uc, ch + 0.0175, (cd + 0.03) / 2).add('trim', rbox(cw + 0.11, 0.03, cd + 0.055, 0.008), uc, ch + 0.05, (cd + 0.055) / 2);
      for (let k = 0; k < 2; k++) {
        const lc = uc - (cw - 0.07) / 2 + each / 2 + k * (each + 0.006), fz = cd - 0.015;
        b.add('trim', rbox(each, lh, 0.03, 0.005), lc, ly0 + lh / 2, fz);
        for (const [py, ph] of [[ly0 + lh * 0.7, lh * 0.44], [ly0 + lh * 0.24, lh * 0.32]]) b.add('trim', rbox(each - 0.17, ph, 0.012, 0.005), lc, py, fz + 0.019);
        const kx = lc + (k ? -1 : 1) * (each / 2 - 0.05);
        b.add('brass', cyl(0.008, 0.035, 'z'), kx, 1.05, fz + 0.03).add('brass', new THREE.SphereGeometry(0.021, 14, 10), kx, 1.05, fz + 0.05);
      }
      b.add('dark', rbox(0.006, lh, 0.01, 0.002), uc, ly0 + lh / 2, cd - 0.03);
      const [cx, cz] = toW(2, uc, cd / 2); contact(cx, cz, cd + 0.12, cw + 0.15, 0.5);
      AABB('closet', 'other', vbox(2, uc - cw / 2 - 0.07, uc + cw / 2 + 0.07, 0, cd + 0.05, 0, ch + 0.09));
      const [ax, az] = toW(2, uc, cd), [ux, uz] = toW(2, uc, cd + 0.5); addAnchor('closet', null, { x: ax, z: az, ry: faces[2].ry, w: cw, d: 0.06, h: lh }, { x: ux, z: uz, yaw: wInto(2) });
    }
    { // the dresser (the nightstand's big sister: the same classic piece, widened) on the east wall past the bed's foot; two prints over it
      const dr = await L('nightstand'); dr.scale.set(1.9, 1.22, 1.1); const s = sizeOf(dr), [x, z] = toW(3, 5.55, s.z / 2 + 0.02); put('dresser', dr, x, z, faces[3].ry, 0, { shadow: 0.5 });
      const Dr = placed.dresser.bb, dx = (Dr.min.x + Dr.max.x) / 2, dt = topAt(placed.dresser.g, dx, 5.55, Dr.max.y);
      { const pl = await L('plant_small'); put('plant@dresser', pl, dx + 0.02, 5.2, 0.5, dt, { vol: false, cast: false }); }
      for (const [j, key, w, d, r] of [[0, 'cover4', 0.25, 0.18, 0.12], [1, 'cover5', 0.23, 0.16, -0.2], [2, 'cover1', 0.21, 0.15, 0.3]]) proc(key, new THREE.BoxGeometry(w, 0.032, d), dx + 0.06, dt + 0.016 + j * 0.033, 5.6, r);
      { const v = await L('vase'); v.scale.setScalar(0.7); put('vase@dresser', v, dx - 0.02, 5.93, 0, dt, { vol: false, cast: false }); }
      print(3, 5.3, 1.22, 0.36, 0.48, photoPaint, 'dark', 0.022); print(3, 5.8, 1.32, 0.3, 0.38, abstractPaint, 'gilt', 0.022);
    }
    { // the reading corner by the west garden window: the parlour armchair's twin turned to the room, a stack of books on the floor
      const a2 = await L('armchair'); put('armchair@bedroom', a2, -1.86, 5.88, 1.35, 0, { shadow: 0.6, cast: false });
      const tx = -2.06, tz = 6.6, tt = 0.575;
      proc('walnut', cyl(0.19, 0.025, 'y', 32), tx, tt - 0.0125, tz); proc('walnut', cyl(0.028, tt - 0.05, 'y', 12), tx, (tt - 0.025) / 2 + 0.01, tz); proc('walnut', cyl(0.12, 0.03, 'y', 24, 0.15), tx, 0.015, tz);
      contact(tx, tz, 0.42, 0.42, 0.45); AABB('sidetable', 'other', [tx - 0.19, 0, tz - 0.19, tx + 0.19, tt + 0.02, tz + 0.19]);
      const tl = tableLamp(); tl.scale.setScalar(0.9); tl.position.set(tx - 0.03, tt, tz + 0.04); world.add(tl);                                  // shade glow only (no extra light: the per-pixel light count is the 2x cost)
      proc('cover2', rbox(0.16, 0.026, 0.23, 0.004), tx + 0.08, tt + 0.013, tz - 0.07, 0.5); proc('cover1', rbox(0.15, 0.024, 0.21, 0.004), tx + 0.08, tt + 0.038, tz - 0.07, 0.3);
      print(2, -6.0, 1.32, 0.42, 0.56, fernPaint, 'gilt', 0.025);
    }
  }

  const furnished = (BS ? dressBrownstone() : dressStudio()).then(async () => {
    if (disposed) return;
    flush(); flushContacts(); setLevels(isNight()); await warm(renderer, scene, camera); if (disposed) return; renderer.shadowMap.needsUpdate = true; kick();
    return loadPerson();
  }).catch((e) => { state.errors.push('furnish: ' + e.message); state.ready = true; console.warn('room2 furnish', e); });

  /* ---- Hariv: a free standing spot at his window, facing it, Breathing Idle; the clearance report is the PEOPLE-SPEC §10.2 gate */
  let person = null, fitText = 'not run', walker = null, rig = null;
  async function loadPerson() {
    try {
      const mod = await import('./world/people.js'), Fit = mod.Fit;
      const P = await mod.loadPerson('hariv.glb'); if (disposed) { P.dispose(); return; }
      world.add(P.root);
      const cloud = await mod.cloudOfAsync(P, 'idle', { frames: 24, stride: 4 });
      const V = Fit.makeVols([], [{ name: 'floor', kind: 'floor', b: [-40, -2, -40, 40, 0, 40] }, ...vols.filter((v) => v.kind !== 'footrest')]);
      const hf = FACE[S.hariv.face], f = faces[hf], yaw = Math.atan2(-Math.sin(f.ry), -Math.cos(f.ry)), [nx, nz] = toW(hf, S.hariv.u, 0.62), near = { x: nx, z: nz };
      const zn = S.zones.find((q) => nz >= q.z0 && nz < q.z1), zb = zn ? [zn.z0 + 0.2, zn.z1 - 0.3] : [Z0 + 0.2, Z1 - 0.3];
      const s = await mod.standSpot(cloud, V, near, yaw, { radius: 1.0, bounds: [X0 + 0.3, X1 - 0.3, ...zb] });
      const margin = (v) => (v.kind === 'wall' || v.kind === 'shell' ? 0.02 : 0.15);
      const rep = Fit.evaluate(cloud, { x: s.x, y: 0, z: s.z, yaw }, V, { margin });
      fitText = Fit.formatReport('window / idle (Breathing Idle) / hariv.glb  [' + shellId + ']  (standing: furniture margin 15 cm, walls/sills/curtains 2 cm)', rep,
        'spot (' + s.x.toFixed(2) + ', ' + s.z.toFixed(2) + ') m, ' + (Math.hypot(s.x - near.x, s.z - near.z) * 100).toFixed(0) + ' cm from the nominal one, ' + V.length + ' volumes');
      P.root.position.set(s.x, 0, s.z); P.root.rotation.y = yaw;
      if (motion()) P.play('idle', { fade: 0, restart: true, at: 0 }); else P.still('idle', 0);
      P.root.traverse((n) => { if (n.isMesh && n.material) for (const m of [].concat(n.material)) m.clippingPlanes = null; });
      var sh = mod.makeContactShadow(0.7, 0.5, 0.45); sh.position.set(s.x, 0.003, s.z); world.add(sh);
      const wa = ANCHORS.find((a) => a.activity === 'window' && a.id === 'window:' + walls[f.wall].id + ':x' + toW(hf, S.hariv.u, 0)[0].toFixed(2)); if (wa) wa.use = { x: r3(s.x), z: r3(s.z), yaw: r3(yaw) };
      person = P; state.person = true; aimFill();
      try {                                                    // walking + furniture use (docs/ROOM-V2.md §6)
        const Wk = await import('./room2_walk.js'); if (disposed) return;
        const door = FRONT && (() => { const fi = FRONT.fi, u = FRONT.u, a0 = toW(fi, u, 0), a1 = toW(fi, u, 1), f = faces[fi]; return { leaf: FRONT.leaf, knob: FRONT.knob, ang: 0, box: vbox(fi, u - FRONT.w / 2 - 0.1, u + FRONT.w / 2 + 0.1, -0.3, 0.45, 0, FRONT.h), centre: { x: toW(fi, u, 0.1)[0], z: toW(fi, u, 0.1)[1] }, approach: { x: toW(fi, u, 0.85)[0], z: toW(fi, u, 0.85)[1] }, inward: { x: a1[0] - a0[0], z: a1[1] - a0[1] }, yaw: Math.atan2(-Math.sin(f.ry), -Math.cos(f.ry)) }; })();
        walker = Wk.createWalker({ camera, canvas, controls, P, Fit, cloudOf: mod.cloudOf, cloudOfAsync: mod.cloudOfAsync, solveFit: mod.solveFit, standSpot: mod.standSpot, bookSpot: mod.bookSpot, vols, bounds: { X0, X1, Z0, Z1 }, host, shell: shellId, placed, anchors: ANCHORS, motion, kick, hourNow: () => hourNow(), lieClip: PQ.get('lie') || 'lie', door: door || null, onDoor: o.onDoor || null, suspended: o.suspended || null, tweening: () => !!tw, azimuth: () => (rig && rig.on ? rig.yaw : controls.getAzimuthalAngle()), inside: () => !!(rig && rig.on), hint: () => rig && rig.on ? walker.hint() : null, release: () => rig && rig.release(), onAct: (a) => { if (rig && rig.on) rig.frame(a); }, shadow: () => { renderer.shadowMap.needsUpdate = true; }, sh });
        window.__room2.walk = walker;
        try {                                                  // the inside view (docs/ROOM-V2.md §14)
          const Rg = await import('./room2_cam.js'); if (disposed) return;
          rig = Rg.createRig({ THREE, camera, canvas, vols, dividers: S.dividers, bounds: { X0, X1, Z0, Z1 }, RH, person: P, motion, kick, state: () => walker.state(), hint: () => (walker ? walker.hint() : null) });     // the hint drives the gentle recentre (§14.4)
          window.__room2.cam = () => rig.report(); window.__room2.setLook = (y, p) => rig.setLook(y, p); window.__room2.rig = rig;
          let want = 'inside'; try { want = localStorage.getItem('epoch.room2.view') === 'overview' ? 'overview' : 'inside'; } catch { /* storage blocked */ }
          if (PQ.get('view') === 'overview' || PQ.get('view') === 'inside') want = PQ.get('view');
          if (host.classList.contains('is-decorating')) want = 'overview';
          setMode(want, true); hud();
        } catch (e) { state.errors.push('cam: ' + e.message); console.warn('room2 cam', e); }
        if (PQ.get('debug') === '1') { window.__room2.useNow = (id) => walker.useNow(id); window.__room2.measure = (id) => walker.measure(id); window.__room2.setMode = (m) => setMode(m); window.__room2.mode = () => (rig && rig.on ? 'inside' : 'overview'); window.__room2.clockAt = () => { const v = new THREE.Vector3(); clockHands[0][1].getWorldPosition(v); return [v.x, v.y, v.z]; }; }
        const pf = window.__peopleFit; if (pf) { pf.activities = walker.reports; pf.report = () => { const t = [fitText, ...Object.values(walker.reports).map((r) => r.text)].join('\n\n'); console.log(t); return t; }; }
      } catch (e) { state.errors.push('walk: ' + e.message); console.warn('room2 walk', e); }
      window.__peopleFit = { fit: Fit, report() { console.log(fitText); return fitText; }, rep };
      console.log('[room2] ' + fitText.split('\n').pop());
    } catch (e) { state.errors.push('person: ' + e.message); console.warn('room2 person', e); }
    state.ready = true; logInfo(); kick();
  }

  /* ---- the window views + the soft backdrop: the real city from the home's spot at the room's hour (the garden side looks back) */
  let home = (o.econ && o.econ.home && o.econ.home.x != null) ? o.econ.home : null, viewKey = '', viewBusy = false, viewTries = 0;
  let todForce = '';
  function hourNow() {
    if (PQ.has('tod') || todForce) { const t = todForce || PQ.get('tod'); const named = { morning: 7.5, day: 13, golden: 17.5, blue: 19.5, night: 23 }; return named[t] != null ? named[t] : (parseFloat(t) || 12); }
    try { return o.hourFn ? o.hourFn() : new Date().getHours() + new Date().getMinutes() / 60; } catch { return 12; }
  }
  const isNight = () => { const h = hourNow(); return h < 6.5 || h >= 19.25; };
  function paintedSky(night) {
    return canvasTex(512, (g, Sz, R) => {
      const gd = g.createLinearGradient(0, 0, 0, Sz); if (night) { gd.addColorStop(0, '#0b1530'); gd.addColorStop(1, '#2b3756'); } else { gd.addColorStop(0, '#86aed8'); gd.addColorStop(1, '#dfe8ef'); }
      g.fillStyle = gd; g.fillRect(0, 0, Sz, Sz);
      for (let i = 0; i < 26; i++) { const x = R() * Sz, w = 20 + R() * 60, h = Sz * (0.25 + R() * 0.5); g.fillStyle = night ? '#141b2c' : `rgb(${150 + R() * 40},${150 + R() * 35},${155 + R() * 35})`; g.fillRect(x, Sz - h, w, h);
        if (night) for (let k = 0; k < 30; k++) { g.fillStyle = R() < 0.5 ? 'rgba(255,214,150,0.85)' : 'rgba(255,240,210,0.5)'; g.fillRect(x + R() * w, Sz - h + R() * h, 2, 3); } }
    }, 1, 1);
  }
  // the garden side: across the yards, the brick backs of the next street's row houses (cornices, stone lintels, fire escapes), big
  // plane-tree canopies in three tones lit from the sun side, board fences and planted beds; far layers hazed and softened for depth
  function paintedGarden(night) {
    return canvasTex(1024, (g, Sz, R) => {
      const W = Sz, H = Sz, rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`, jit = (c, k) => c.map((v) => Math.max(0, Math.min(255, v + (R() - 0.5) * k)));
      const sky = g.createLinearGradient(0, 0, 0, H * 0.5);
      if (night) { sky.addColorStop(0, '#0a1229'); sky.addColorStop(0.6, '#1f2a47'); sky.addColorStop(1, '#3d3a4c'); } else { sky.addColorStop(0, '#87aed6'); sky.addColorStop(0.6, '#bcd2e4'); sky.addColorStop(1, '#e3e4df'); }
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      if (!night) for (let i = 0; i < 7; i++) { const cx = R() * W, cy = H * (0.03 + R() * 0.12), rx = 80 + R() * 140; const cg = g.createRadialGradient(cx, cy, 4, cx, cy, rx); cg.addColorStop(0, 'rgba(255,255,255,0.55)'); cg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = cg; g.beginPath(); g.ellipse(cx, cy, rx, rx * 0.3, 0, 0, 7); g.fill(); }
      // far: taller blocks two streets over, soft and hazy
      { const fc = document.createElement('canvas'); fc.width = fc.height = W / 4; const fg = fc.getContext('2d'); fg.scale(0.25, 0.25);      // painted small and scaled up: soft, and cheap (no blur filter)
      for (let x = -20; x < W;) { const w = 90 + R() * 150, top = H * (0.04 + R() * 0.09), c = night ? [26, 30, 46] : jit([172, 160, 152], 24); fg.fillStyle = rgb(c); fg.fillRect(x, top, w, H);
        for (let wy = top + 12; wy < H * 0.4; wy += 22) for (let wx = x + 8; wx < x + w - 8; wx += 18) { fg.fillStyle = night ? (R() < 0.3 ? 'rgba(255,205,140,0.8)' : 'rgba(10,12,20,0.6)') : 'rgba(70,80,95,0.35)'; fg.fillRect(wx, wy, 8, 11); }
        x += w + R() * 8; }
      g.drawImage(fc, 0, 0, W, H); }
      g.fillStyle = night ? 'rgba(28,34,58,0.45)' : 'rgba(205,216,226,0.5)'; g.fillRect(0, 0, W, H * 0.55);
      // mid: the backs of the row houses, 4 storeys of brick
      for (let x = -40; x < W;) {
        const w = 170 + R() * 50, top = H * (0.16 + R() * 0.05), base = night ? jit([38, 30, 32], 8) : jit([[146, 80, 62], [132, 74, 60], [160, 100, 76], [118, 82, 70], [170, 120, 92]][R() * 5 | 0], 14);
        g.fillStyle = rgb(base); g.fillRect(x, top, w, H);
        for (let y = top; y < H * 0.8; y += 6) { g.fillStyle = `rgba(30,18,12,${night ? 0.1 : 0.07 + R() * 0.05})`; g.fillRect(x, y, w, 1); }
        for (let k = 0; k < w * 2.2; k++) { g.fillStyle = rgb(jit(base, night ? 12 : 50), night ? 0.2 : 0.35); g.fillRect(x + R() * w, top + R() * (H * 0.62), 9, 4); }
        const lit = night ? [255, 200, 130] : null, fr = night ? [60, 52, 48] : [236, 230, 218];
        for (let fy = top + 26, fl = 0; fy < H * 0.7; fy += 76, fl++) for (let c = 0; c < 3; c++) {
          const ww = 28, wh = 50, wx = x + (w / 3) * (c + 0.5) - ww / 2;
          g.fillStyle = night ? '#2c2627' : '#ddd3c2'; g.fillRect(wx - 5, fy - 7, ww + 10, 7); g.fillRect(wx - 4, fy + wh, ww + 8, 5);
          if (night && R() < 0.38) { const lg = g.createLinearGradient(0, fy, 0, fy + wh); lg.addColorStop(0, rgb(lit)); lg.addColorStop(1, rgb([200, 140, 80])); g.fillStyle = lg; }
          else if (night) g.fillStyle = '#0e1018';
          else { const lg = g.createLinearGradient(0, fy, 0, fy + wh); lg.addColorStop(0, '#9fb3c6'); lg.addColorStop(0.5, '#4d5b6b'); lg.addColorStop(1, '#2b333d'); g.fillStyle = lg; }
          g.fillRect(wx, fy, ww, wh);
          if (!night && R() < 0.4) { g.fillStyle = rgb(jit([226, 214, 190], 20), 0.9); g.fillRect(wx + 2, fy + 2, ww * (0.3 + R() * 0.3), wh - 4); }
          g.fillStyle = rgb(fr); g.fillRect(wx, fy + wh / 2 - 1.5, ww, 3); g.fillRect(wx + ww / 2 - 1, fy, 2, wh); g.strokeStyle = rgb(fr); g.lineWidth = 2; g.strokeRect(wx, fy, ww, wh);
        }
        g.fillStyle = night ? '#1f1b1c' : '#d6ccbb'; g.fillRect(x - 4, top - 9, w + 8, 10); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 4, top + 1, w + 8, 4);
        if (R() < 0.5) {      // a fire escape: a platform per floor, rails, and the ladder between
          const fx = x + w * (0.12 + R() * 0.3), fw = w * 0.45; g.strokeStyle = night ? 'rgba(8,8,10,0.95)' : 'rgba(30,30,34,0.9)'; g.lineWidth = 2;
          for (let fy = top + 80; fy < H * 0.7; fy += 76) { g.fillStyle = g.strokeStyle; g.fillRect(fx, fy, fw, 3); g.strokeRect(fx, fy - 16, fw, 16); for (let k = 0; k < fw; k += 7) g.fillRect(fx + k, fy - 16, 1, 16); g.beginPath(); g.moveTo(fx + fw * 0.7, fy); g.lineTo(fx + fw * 0.9, fy + 76); g.stroke(); }
        }
        const sh = g.createLinearGradient(x, 0, x + 24, 0); sh.addColorStop(0, 'rgba(0,0,0,0.22)'); sh.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(x, top, 24, H);
        x += w + (R() < 0.3 ? 3 : 0);
      }
      g.fillStyle = night ? 'rgba(20,26,44,0.25)' : 'rgba(200,212,222,0.18)'; g.fillRect(0, 0, W, H);       // a little air between us and them
      // trees: plane-tree canopies out of the yards (trunk, a few limbs, leaf clusters in shadow / mid / sun tones)
      const trees = [0.06, 0.27, 0.5, 0.72, 0.94].map((t) => [W * (t + (R() - 0.5) * 0.05), H * (0.44 + R() * 0.1), W * (0.13 + R() * 0.05)]);
      for (const [cx, cy, rad] of trees) {
        g.strokeStyle = night ? '#0a0c0b' : '#6a5a4a'; g.lineCap = 'round';
        g.lineWidth = 14; g.beginPath(); g.moveTo(cx, H * 0.86); g.quadraticCurveTo(cx + 10, cy + rad * 0.5, cx - 6, cy); g.stroke();
        g.lineWidth = 6; for (let k = 0; k < 4; k++) { const a = -Math.PI / 2 + (R() - 0.5) * 2.2; g.beginPath(); g.moveTo(cx, cy + rad * 0.3); g.lineTo(cx + Math.cos(a) * rad * 0.7, cy + Math.sin(a) * rad * 0.6); g.stroke(); }
        const pal = night ? [[10, 16, 13], [14, 22, 17], [19, 28, 22]] : [[44, 66, 38], [70, 100, 52], [118, 146, 76]];
        for (let pass = 0; pass < 3; pass++) for (let i = 0; i < 420; i++) {
          const a = R() * 6.283, r = Math.sqrt(R()) * rad * (1 - pass * 0.18), px = cx + Math.cos(a) * r * 1.2 - pass * rad * 0.1, py = cy + Math.sin(a) * r * 0.85 - pass * rad * 0.12;
          if ((R() < 0.06 && pass === 0)) continue;                                   // sky holes through the crown
          g.fillStyle = rgb(jit(pal[pass], 16), 0.85); g.beginPath(); g.ellipse(px, py, 5 + R() * 9, 4 + R() * 6, R() * 3, 0, 7); g.fill();
        }
      }
      // the yards: board fences, shrubs and beds, a strip of paving
      const fy0 = H * 0.74, fy1 = H * 0.86;
      for (let fx = 0; fx < W; fx += 13) { const v = night ? 18 + R() * 8 : 118 + R() * 34; g.fillStyle = rgb([v, v * 0.8, v * 0.6]); g.fillRect(fx, fy0 + R() * 5, 12, fy1 - fy0); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(fx + 12, fy0, 1, fy1 - fy0); }
      g.fillStyle = night ? '#141210' : '#7d6650'; g.fillRect(0, fy0 + 14, W, 5); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, fy0 + 19, W, 6);
      g.fillStyle = night ? '#141210' : '#8a7a68'; g.fillRect(0, fy1, W, H - fy1);
      for (let fx = 0; fx < W; fx += 40) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(fx, fy1, 1, H - fy1); }
      for (let i = 0; i < 90; i++) { const x = R() * W, y = fy1 - 6 + R() * 26, r = 10 + R() * 24, c = night ? [12, 18, 14] : jit([62, 98, 50], 40); g.fillStyle = rgb(c, 0.92); g.beginPath(); g.ellipse(x, y, r * 1.3, r, 0, 0, 7); g.fill();
        if (!night && R() < 0.25) { g.fillStyle = ['#d9785c', '#e8c25a', '#f1ece0', '#b58ac7'][R() * 4 | 0]; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + (R() - 0.5) * r * 2, y - R() * r * 0.8, 2.5, 0, 7); g.fill(); } } }
    }, 1, 1);
  }
  function setView(fi, t) { const c = cards.get(fi); if (!c) { t.dispose(); return; } const old = c.material.map; c.material.map = t; c.material.needsUpdate = true; if (old && old !== t) old.dispose(); kick(); }
  async function refreshView(force) {
    if (disposed) return;
    const sc = o.cityScene && o.cityScene(), night = isNight();
    const k = (night ? 'n' : 'd') + '|' + (home && home.id) + '|' + (sc ? 'city' : 'paint');
    if (!force && k === viewKey) return;
    if (cards.has(1)) setView(1, paintedGarden(night));
    if (!sc || !sc.viewFrom || !sc.homeView || !home) { viewKey = k; setView(0, paintedSky(night)); state.view = 'paint'; return; }
    if (viewBusy) return; viewBusy = true; viewKey = k;
    try {
      const hv = sc.homeView(home); if (!hv) throw new Error('no home view');
      const copy = (cv) => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); return c; };
      const cv = copy(await sc.viewFrom({ pos: hv.pos, look: hv.look, width: 1280, height: 763, fov: 58, hour: hourNow(), noTrees: true }));
      if (disposed) return;
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; setView(0, t); state.view = 'city';
      const stageEl = host.closest('.homestage') || host, w = sceneEl.clientWidth || 1280, h = sceneEl.clientHeight || 720, asp = Math.max(0.6, Math.min(3.2, w / h));
      const bw = asp >= 1 ? 1280 : Math.round(1280 * asp), bd = await sc.viewFrom({ pos: hv.pos, look: hv.look, width: bw, height: Math.round(bw / asp), fov: 72, wait: 900, hour: hourNow(), noTrees: true });
      if (!disposed && bd) { stageEl.style.setProperty('--home-backdrop', `url("${bd.toDataURL('image/jpeg', 0.82)}")`); stageEl.dataset.backdrop = '1'; }
    } catch (e) {
      console.warn('room2 view', e); setView(0, paintedSky(night)); state.view = 'paint';
      if (viewTries++ < 8) setTimeout(() => { if (!disposed) refreshView(true); }, 1500);      // the city may still be loading its tiles
    }
    finally { viewBusy = false; kick(); }
  }

  /* ---- light by the hour: day = sun through the windows + cool sky fill; night = warm lamps (#FFE3AE), the desk lamp shadowed */
  const winFill = WINS.map(({ fi, u }) => { const [x, z] = toW(fi, u, 0.45); const l = new THREE.PointLight(0xd6e4ff, 2.5, 6, 1.6); l.position.set(x, (WIN.y0 + WIN.y1) / 2 - 0.1, z); scene.add(l); return l; });
  function applyLight(force) {
    const night = isNight(), m = night ? 'night' : 'day';
    if (m === mode && !force) return; mode = m; host.dataset.hour = night ? 'night' : 'day';
    setLevels(night); renderer.shadowMap.needsUpdate = true; refreshView(true); kick();
  }
  function setLevels(night) {
    sun.visible = !night; hemi.color.setHex(night ? 0x2a3a5c : 0xcfe0f7); hemi.groundColor.setHex(night ? 0x1d1712 : 0x9a8670); hemi.intensity = night ? (BS ? 0.12 : 0.22) : S.hemiDay;
    winFill.forEach((l) => { l.color.setHex(night ? 0x7f98c8 : 0xd6e4ff); l.intensity = night ? (BS ? 0.5 : 1.1) : 2.5; });
    for (const [k, m] of mcache) { if (k.endsWith('|led')) m.emissiveIntensity = night ? 2.2 : (BS ? 1.3 : 0); else if (k.endsWith('|milk')) m.emissiveIntensity = night ? 1.25 : 0.7; }
    for (const [l, v] of nightLights) l.intensity = night ? v : 0;
    for (const [l, d, n] of dayNight) l.intensity = night ? n : d;
    for (const sh of emissiveShades) sh.material.emissiveIntensity = night ? 0.9 : 0;
    personFill.intensity = night ? 1.4 : 0.5;
    scene.environmentIntensity = night ? (BS ? 0.08 : 0.12) : 0.35; renderer.toneMappingExposure = night ? 1.05 : 1.0;
  }

  /* ---- camera: full 360 orbit, pitch 18-65 deg, zoom per shell, damping 0.12, Q/E 45 deg steps; double-click centres a zone (or home) */
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.12, enablePan: false, minDistance: S.zoom[0], maxDistance: S.zoom[1], minPolarAngle: THREE.MathUtils.degToRad(90 - 65), maxPolarAngle: THREE.MathUtils.degToRad(90 - 18), rotateSpeed: 0.7 });
  const HOME = { yaw: S.home.yaw * D2R, pitch: S.home.pitch * D2R, dist: S.home.dist, target: S.home.target };
  controls.target.set(...HOME.target);
  const place = (yaw, pitch, dist) => { const t = controls.target; camera.position.set(t.x + dist * Math.cos(pitch) * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * Math.cos(pitch) * Math.cos(yaw)); camera.lookAt(t); controls.update(); };
  const zoneById = (id) => S.zones.find((q) => q.id === id);
  if (PQ.has('zone') && zoneById(PQ.get('zone'))) { const zn = zoneById(PQ.get('zone')); controls.target.set(zn.x, 0.8, zn.z); }
  place(PQ.has('yaw') ? +PQ.get('yaw') * D2R : HOME.yaw, PQ.has('pitch') ? +PQ.get('pitch') * D2R : HOME.pitch, PQ.has('dist') ? +PQ.get('dist') : HOME.dist);
  let tw = null, curZone = '';
  function tweenTo(to) {
    const t0 = controls.target.clone(), t1 = to.target ? new THREE.Vector3(...to.target) : t0.clone();
    const from = { yaw: controls.getAzimuthalAngle(), pitch: Math.PI / 2 - controls.getPolarAngle(), dist: camera.position.distanceTo(t0) };
    to = { ...from, ...to }; let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const f = (k) => { controls.target.lerpVectors(t0, t1, k); place(from.yaw + dy * k, from.pitch + (to.pitch - from.pitch) * k, from.dist + (to.dist - from.dist) * k); };
    if (!motion()) { f(1); kick(); return; }
    tw = { t: 0, dur: 0.45, f }; kick();
  }
  const step = (dir) => { const q = Math.PI / 4, az = controls.getAzimuthalAngle(); tweenTo({ yaw: Math.round((az + dir * q) / q) * q }); };
  const onKey = (e) => {
    const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || (o.suspended && o.suspended())) return;
    if (e.key === 'o' || e.key === 'O') { setMode(rig && rig.on ? 'overview' : 'inside'); return; }
    if (rig && rig.on) return;
    if (e.key === 'q' || e.key === 'Q') step(-1); else if (e.key === 'e' || e.key === 'E') step(1);
  };
  document.addEventListener('keydown', onKey);
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function centreZone(id) { const zn = zoneById(id); if (!zn) { curZone = ''; tweenTo({ ...HOME }); return; } curZone = id; tweenTo({ target: [zn.x, 0.8, zn.z], dist: zn.dist }); }
  canvas.addEventListener('dblclick', (e) => {
    if (rig && rig.on) return;
    if (!S.zones.length) { tweenTo({ ...HOME }); return; }
    const r = canvas.getBoundingClientRect(), nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(nd, camera); const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
    const zn = p && Math.abs(p.x) <= X1 + 0.3 ? S.zones.find((q) => p.z >= q.z0 && p.z < q.z1) : null;
    centreZone(!zn || zn.id === curZone ? '' : zn.id);
  });
  controls.addEventListener('change', kick);

  /* ---- Inside (third-person spring arm, room2_cam.js) <-> Overview (the 360 dollhouse above); the choice is remembered per browser */
  let modeBtn = null;
  function hud() {
    if (modeBtn || !rig) return;
    modeBtn = document.createElement('button'); modeBtn.type = 'button'; modeBtn.className = 'btn btn--sm'; modeBtn.dataset.js = 'room2-mode';
    Object.assign(modeBtn.style, { position: 'absolute', top: '3.6rem', right: '0.6rem', zIndex: '5' });
    modeBtn.addEventListener('click', () => { setMode(rig.on ? 'overview' : 'inside'); canvas.focus({ preventScroll: true }); });
    sceneEl.appendChild(modeBtn); setMode(rig.on ? 'inside' : 'overview', true);
  }
  function setMode(m, quiet) {
    if (!rig) return; const wantIn = m === 'inside' && !host.classList.contains('is-decorating');
    if (wantIn === rig.on && quiet !== true) return;
    tw = null;
    if (wantIn) { controls.enabled = false; rig.enable(true); }
    else {
      const was = rig.on; rig.enable(false); controls.enabled = true;
      if (was || quiet === true) { const p = walker ? walker.pos : { x: 0, z: 0 }; controls.target.set(Math.min(X1 - 0.5, Math.max(X0 + 0.5, p.x)), 0.8, Math.min(Z1 - 0.5, Math.max(Z0 + 0.5, p.z))); place(HOME.yaw, HOME.pitch, HOME.dist); }
    }
    if (!quiet) { try { localStorage.setItem('epoch.room2.view', wantIn ? 'inside' : 'overview'); } catch { /* storage blocked */ } }
    if (modeBtn) { modeBtn.textContent = wantIn ? 'Overview' : 'Inside'; modeBtn.setAttribute('aria-label', wantIn ? 'Switch to the overview (dollhouse) view (O)' : 'Switch to the inside view (O)'); modeBtn.setAttribute('aria-pressed', String(wantIn)); }
    canvas.setAttribute('aria-label', (BS ? 'Your brownstone floor-through' : 'Your studio apartment') + (wantIn ? '. Inside view: drag to look, W A S D to walk, scroll to zoom, O for the overview.' : '. Overview: drag to look around; Q and E turn 45 degrees; O for the inside view.'));
    updateWalls(0, true); aimFill(); renderer.shadowMap.needsUpdate = true; kick();
  }
  document.addEventListener('cozy:decorate', (e) => { if (e.detail && e.detail.on) setMode('overview', true); });

  /* ---- walls down. Studio: a wall whose outward normal faces the camera (dot > 0.2). Brownstone: any wall (dividers too) whose plane lies
   *      between the camera and the target. It drops to a 0.45 m capped stub in 0.25 s; its windows, doors and wall-hung things go with it */
  const wallH = walls.map(() => RH);
  function updateWalls(dt, instant) {
    const vx = camera.position.x, vz = camera.position.z, L = Math.hypot(vx, vz) || 1, tg = controls.target, inside = !!(rig && rig.on);
    let moving = false, changed = false;
    walls.forEach((wl, i) => {
      let drop;
      if (inside) drop = false;
      else if (S.cutaway === 'facing') drop = (wl.out[0] * vx + wl.out[1] * vz) / L > 0.2;
      else { const sc = (vx - wl.p[0]) * wl.out[0] + (vz - wl.p[1]) * wl.out[1], st = (tg.x - wl.p[0]) * wl.out[0] + (tg.z - wl.p[1]) * wl.out[1]; drop = sc * st < 0 && Math.abs(sc) > 0.05; }
      const want = drop ? STUB : RH;
      if (wallH[i] !== want) {
        const sp = ((RH - STUB) / 0.25) * dt;
        wallH[i] = instant || inside || !motion() ? want : want > wallH[i] ? Math.min(want, wallH[i] + sp) : Math.max(want, wallH[i] - sp);
        moving = true; if (wallH[i] === want) changed = true;
      }
      planes[i].constant = wallH[i] + 0.0005; caps[i].position.y = wallH[i] + 0.007;
    });
    for (const [fi, c] of cards) c.visible = wallH[faces[fi].wall] > RH - 0.01;
    for (const [wi, m] of curtainMeshes) m.visible = wallH[wi] > RH - 0.3;
    ceilGrp.visible = camera.position.y < RH - 0.05;
    if (changed) renderer.shadowMap.needsUpdate = true;
    return moving;
  }
  const _v = new THREE.Vector3();
  function aimFill() { if (!person) return; const p = person.root.position; _v.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize(); personFill.position.set(p.x + _v.x * 1.1, 1.45, p.z + _v.z * 1.1); }

  /* ---- render on demand (world/render.js): frames only while something moves (orbit damping, a wall dropping, a tween, Hariv breathing) */
  function stepFrame(dt) {
    const inside = !!(rig && rig.on);
    let busy = inside ? false : controls.update();
    if (tw && !inside) { tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.f(k * k * (3 - 2 * k)); if (k >= 1) tw = null; busy = true; }
    if (walker) busy = walker.update(dt) || busy;
    if (inside) busy = rig.update(dt) || busy;
    busy = updateWalls(dt) || busy; aimFill();
    if (person && motion() && !frozen) { person.update(dt); busy = true; }
    return busy;
  }
  const resize = () => { const w = sceneEl.clientWidth || 800, h = sceneEl.clientHeight || 500; sizeTo(renderer, camera, w, h); kick(); };
  const ro = new ResizeObserver(resize); ro.observe(sceneEl);
  flush(); resize(); updateWalls(0, true); applyLight(true);

  function info() {
    const nu = renderer.shadowMap.needsUpdate; renderer.shadowMap.needsUpdate = false; renderer.render(scene, camera); const dc = renderer.info.render.calls, dt = renderer.info.render.triangles; renderer.shadowMap.needsUpdate = nu;
    let tris = 0, calls = 0;
    scene.traverseVisible((n) => { if (n.isMesh && !(n.material && n.material.colorWrite === false)) { const g = n.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; calls++; } });
    return { triangles: Math.round(tris), meshes: calls, drawnMainPass: dt, drawCalls: dc, textures: renderer.info.memory.textures, frames: loop.frames, mode, walls: wallH.map((h) => +h.toFixed(2)), anchors: ANCHORS.length, ...state };
  }
  function logInfo() { const i = info(); console.log('[room2] ' + shellId + ': triangles ' + i.triangles + ' (budget ' + (BS ? 300000 : 250000) + '), meshes ' + i.meshes + ', mode ' + i.mode + ', assets ' + i.assets + '/' + i.assetsTotal); }
  async function fps(ms = 3000) { const f0 = loop.frames, t0 = performance.now(); const hold = setInterval(kick, 16); await new Promise((r) => setTimeout(r, ms)); clearInterval(hold); return +((loop.frames - f0) / ((performance.now() - t0) / 1000)).toFixed(1); }
  window.__room2 = {
    state, info, fps, furnished, anchors, shell: shellId,
    vols: () => vols.map((v) => ({ name: v.name, kind: v.kind, b: v.b.map((q) => Math.round(q * 1000) / 1000), ob: v.ob || null })),      // debug (ROOM-V2 §16.3 plan log)
    shellData: () => JSON.parse(JSON.stringify(S)),
    probe() { const r = {}; const run = (k) => { renderer.info.reset(); renderer.render(scene, camera); r[k] = renderer.info.render.calls + '/' + renderer.info.render.triangles; };
      const nu = renderer.shadowMap.needsUpdate, ar = renderer.info.autoReset; renderer.info.autoReset = false; renderer.shadowMap.needsUpdate = false; run('main');
      renderer.shadowMap.enabled = false; run('noShadowMap');
      { const s2 = new THREE.Scene(); s2.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); renderer.info.reset(); renderer.render(s2, camera); r.oneBox = renderer.info.render.calls + '/' + renderer.info.render.triangles + ' rev ' + THREE.REVISION; } renderer.shadowMap.enabled = true; renderer.shadowMap.needsUpdate = nu; renderer.info.autoReset = ar; r.autoReset = ar; return JSON.stringify(r); },
    breakdown() { const out = {}; for (const c of world.children) { let t = 0, m = 0; c.traverseVisible((n) => { if (n.isMesh) { const g = n.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; m++; } }); const k = (c.name || c.type).replace(/@.*$/, ''); out[k] = out[k] || [0, 0, 0]; out[k][0] += Math.round(t); out[k][1] += m; out[k][2]++; } return Object.entries(out).sort((x, y) => y[1][0] - x[1][0]).map(([k, v]) => k + ' ' + v.join('/')).join('; '); },
    view(yaw, pitch = 35, dist = HOME.dist, zone) {
      tw = null; const zn = zone && zoneById(zone); controls.target.set(...(zn ? [zn.x, 0.8, zn.z] : zone === 'centre' ? [0, 0.8, 0] : HOME.target)); curZone = zn ? zn.id : '';
      place(yaw * D2R, pitch * D2R, dist); updateWalls(0, true); aimFill(); renderer.shadowMap.needsUpdate = true; kick(); return info().walls;
    },
    focus(x, z, yaw, pitch = 25, dist = 2.4, y = 0.9) { tw = null; controls.target.set(x, y, z); place(yaw * D2R, pitch * D2R, dist); updateWalls(0, true); aimFill(); renderer.shadowMap.needsUpdate = true; kick(); },
    setTod(t) { todForce = t; applyLight(true); return mode; },
    freeze() { frozen = true; if (person) person.still('idle', 0); renderer.shadowMap.needsUpdate = true; kick(); },
  };

  const stage = {
    react: () => Promise.resolve(false), playChest: () => Promise.resolve(false),
    setEconomy(e) { const h = e && e.home; if (h && h.x != null) { const moved = !home || home.id !== h.id; home = h; if (moved) refreshView(true); } },
    setLayout() {}, setWeather() {}, setChest() {}, setMissions() {}, force: () => false,
    refreshView: () => refreshView(true), anchors,
    decorate: () => { setMode('overview', true); return false; }, exitDecorate: () => false, get decorating() { return false; },
    pause(h) { loop.pause(h); }, get walker() { return walker; }, get rig() { return rig; }, get canvas() { return canvas; }, get person() { return person; }, kick,
    setMotion() { if (person) { if (motion()) person.play('idle', { restart: true }); else person.still('idle', 0); } kick(); },
    summary: () => (BS ? 'Your brownstone parlour floor (room v2): the front parlour with the marble fireplace, the kitchen through the archway, the bedroom on the garden.'
      : 'Your studio apartment (room v2 proof): bed, desk by the window, sofa, kitchenette.') + (person ? ' Hariv is at the window.' : ''),
    info,
    dispose() { disposed = true; loop.dispose(); TXL.dispose(); clearInterval(clockTimer); if (walker) walker.dispose(); ro.disconnect(); document.removeEventListener('keydown', onKey); if (rig) rig.dispose(); if (modeBtn) modeBtn.remove(); controls.dispose(); renderer.dispose(); canvas.remove(); host.classList.remove('is-3d'); },
  };
  refreshView();
  return stage;
}
