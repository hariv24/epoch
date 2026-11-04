// city/room.js · the user's home as a small low-poly 3D cutaway room (docs/ECONOMY.md "Seeing your home").
//   openRoom({ econ, fetchEconomy, viewFrom, homeView, motion, hour, onClose })
//     econ        the economy block of /api/world (or /api/economy): home {id, name, address, size, floor, x, z, base_y, ...}, placed[], outfit, character
//     viewFrom    optional: the city scene's window renderer (manhattan.js viewFrom). The window then shows the REAL view from the home's real spot
//                 and floor (the Central Park Tower penthouse looks out over Central Park). Without it the window shows a painted sky.
//     fetchEconomy optional: () => Promise of GET /api/economy, for what is in storage
// The layout follows the home's size tier (studio / 1-bed / loft / penthouse). Every furniture and decor item of the catalog has a cheap but
// recognisable model, placed in its slot when owned and placed. The faceless figure (character.js) is in the room: asleep in bed past the sleep
// cutoff, at the desk when there is one, otherwise at the window.
// Render on demand: one frame per change (orbit, the window arriving), nothing in between; the renderer is disposed when the room closes.
// No WebGL: a plain 2D list of the room (what is placed, what is in storage).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Geo, rgb, shade, clamp, rng } from './util.js';
import { buildFigure, figureMaterial, glowMaterial, setSelfLight, createLife } from './character.js';
import { createDecorator, checkEntry, placeNear, entryBox, homeWord } from './decorate.js';

const C = rgb;
const hc = (hex, k = 1) => { const c = new THREE.Color(hex).multiplyScalar(k); return [c.r, c.g, c.b]; };

/* ------------------------------------------------------------ layouts by size tier (metres; floor centre at the origin, the window wall at -z) */
// slot: {x, z, ry, wall} ry turns the item's front (+z) into the room; wall = it backs onto a solid wall (art hangs there)
export const LAYOUTS = {
  studio: {
    W: 5, D: 4, H: 2.9, floor: '#9a6b47', wall: '#e9e1d2', side: '#ddd3c1', label: 'Studio',
    windows: [{ x0: 0.1, x1: 1.6, y0: 0.85, y1: 2.45, grid: [2, 2] }],
    bed: { x: -1.75, z: -1.0, ry: 0, w: 1.35, l: 2.0 }, kitchen: { x0: -2.5, x1: -1.92, z0: 0.55, z1: 1.95 },
    slots: [{ x: 2.05, z: -2, ry: 0, wall: true }, { x: -0.45, z: -2, ry: 0, wall: true }, { x: 1.7, z: 0.9, ry: -0.6, wall: false }, { x: 0.35, z: 0.35, ry: 0, wall: false }],
    stand: { x: 0.85, z: -1.35 },
  },
  '1-bed': {
    W: 7, D: 5, H: 3.0, floor: '#a7774f', wall: '#ece5d8', side: '#e0d6c4', label: 'One-bedroom',
    windows: [{ x0: -0.2, x1: 1.2, y0: 0.85, y1: 2.5, grid: [2, 2] }, { x0: 2.0, x1: 3.2, y0: 0.85, y1: 2.5, grid: [2, 2] }, { x0: -3.0, x1: -2.1, y0: 1.0, y1: 2.4, grid: [1, 2] }],
    partition: { x: -1.0, z0: -2.5, z1: 0.6, door: [-0.7, 0.25] },
    bed: { x: -2.5, z: -1.5, ry: 0, w: 1.5, l: 2.0 },
    slots: [{ x: 1.6, z: -2.5, ry: 0, wall: true }, { x: 3.45, z: -2.5, ry: 0, wall: true }, { x: -0.95, z: -1.7, ry: Math.PI / 2, wall: true },
      { x: -3.5, z: 0.95, ry: Math.PI / 2, wall: true }, { x: 1.1, z: 0.7, ry: 0, wall: false }, { x: 2.75, z: 1.25, ry: -0.5, wall: false }],
    stand: { x: 0.5, z: -1.85 },
  },
  loft: {
    W: 9, D: 6, H: 3.8, floor: '#7d5a3e', wall: '#a8553d', side: '#e6dccb', brick: true, label: 'Loft',
    windows: [{ x0: -1.6, x1: -0.4, y0: 0.7, y1: 3.25, grid: [2, 4] }, { x0: 0.8, x1: 2.0, y0: 0.7, y1: 3.25, grid: [2, 4] }, { x0: 3.2, x1: 4.3, y0: 0.7, y1: 3.25, grid: [2, 4] }],
    columns: [[-1.0, 0.6], [2.4, 0.6]], bed: { x: -3.4, z: -1.95, ry: 0, w: 1.7, l: 2.1, platform: true },
    slots: [{ x: 0.2, z: -3, ry: 0, wall: true }, { x: 2.6, z: -3, ry: 0, wall: true }, { x: -2.05, z: -3, ry: 0, wall: true }, { x: -4.5, z: 0.5, ry: Math.PI / 2, wall: true },
      { x: -4.5, z: 2.1, ry: Math.PI / 2, wall: true }, { x: -1.6, z: 1.6, ry: 0.3, wall: false }, { x: 0.8, z: 1.9, ry: 0, wall: false }, { x: 3.3, z: 1.5, ry: -0.4, wall: false }],
    stand: { x: 1.4, z: -2.35 },
  },
  penthouse: {
    W: 12, D: 7, H: 4.2, floor: '#e9e6df', wall: '#f1ede4', side: '#e4dfd3', marble: true, glassWall: true, label: 'Penthouse',
    windows: [{ x0: -5.9, x1: 5.9, y0: 0.06, y1: 4.1, grid: [8, 1] }],
    bed: { x: -4.85, z: 2.2, ry: Math.PI / 2, w: 1.9, l: 2.2 }, island: { x: 3.7, z: 2.6 },
    slots: [{ x: -4.0, z: -3.15, ry: 0, wall: false }, { x: -1.8, z: -3.15, ry: 0, wall: false }, { x: 0.6, z: -3.15, ry: 0, wall: false }, { x: 2.7, z: -3.15, ry: 0, wall: false },
      { x: 4.9, z: -3.15, ry: 0, wall: false }, { x: -6, z: -2.2, ry: Math.PI / 2, wall: true }, { x: -6, z: -0.3, ry: Math.PI / 2, wall: true },
      { x: -2.6, z: 0.6, ry: 0.2, wall: false }, { x: 0.2, z: 0.9, ry: 0, wall: false }, { x: 2.6, z: 0.4, ry: -0.3, wall: false }, { x: -1.2, z: 2.7, ry: 0, wall: false }, { x: 5.0, z: 0.4, ry: -0.6, wall: false }],
    stand: { x: -0.6, z: -2.55 },
  },
};
/* The Harlem brownstone floor-through (docs/ROOM-V2.md 16.1, the real 124 W 123rd St parlour floor; mirrors ROOMS_BY_HOME in epoch/layout.py).
   DATA ONLY: the old room view still picks its shape by size tier; the server sends this shape in /api/home/layout `room`. */
LAYOUTS['harlem-floorthrough'] = {
  W: 4.6, D: 13.8, H: 3.45, floor: '#a7774f', wall: '#ede6da', side: '#e0d6c4', label: 'Brownstone floor-through',
  windows: [{ wall: 'n', x0: -1.95, x1: -0.95, y0: 0.5, y1: 2.95, grid: [2, 4] }, { wall: 'n', x0: -0.25, x1: 0.75, y0: 0.5, y1: 2.95, grid: [2, 4] },
    { wall: 's', x0: -1.6, x1: -0.6, y0: 0.5, y1: 2.95, grid: [2, 4] }, { wall: 's', x0: 0.6, x1: 1.6, y0: 0.5, y1: 2.95, grid: [2, 4] }],
  dividers: [{ id: 'd1', z: -1.4, t: 0.15, x0: -2.3, x1: 1.1, opening: [-1.5, 0.3], open_h: 2.7 }, { id: 'd2', z: 1.9, t: 0.15, opening: [-1.46, -0.54], open_h: 2.1 }],
  hall: { id: 'h', x: 1.1, t: 0.15, z0: -6.9, z1: 1.0, door: [-0.75, 0.15], door_h: 2.2 },
  keepouts: [{ id: 'stair_hall', x0: 1.1, x1: 2.3, z0: -6.9, z1: 1.0 }, { id: 'kitchen', x0: -2.3, x1: -1.68, z0: -1.3, z1: 1.3 },
    { id: 'fireplace', x0: -2.3, x1: -1.85, z0: -5.02, z1: -3.38 }, { id: 'front_door', x0: 0.2, x1: 1.1, z0: -0.75, z1: 0.15 },
    { id: 'bath', x0: 0.1, x1: 1.1, z0: 0.4, z1: 1.9 }, { id: 'bath_nook', x0: 1.1, x1: 2.3, z0: 1.0, z1: 1.9 },
    { id: 'bedzone', x0: -0.45, x1: 1.95, z0: 1.975, z1: 4.2 }, { id: 'closet', x0: -2.3, x1: -1.6, z0: 3.75, z1: 5.25 }],
  bed: { x: 0.45, z: 3.025, ry: 0, w: 1.7, l: 2.1 },
  slots: [{ x: -0.6, z: -6.9, ry: 0, wall: true }, { x: -1.45, z: -6.3, ry: 0, wall: false }, { x: 0.5, z: -3.0, ry: 0.4, wall: false },
    { x: -0.6, z: -2.2, ry: 0, wall: false }, { x: -0.9, z: 0.6, ry: 0, wall: false }, { x: -0.6, z: 2.9, ry: 0, wall: false }],
  stand: { x: 0.25, z: -5.8 },
};
const layoutOf = (size) => LAYOUTS[size] || LAYOUTS.studio;

/* ------------------------------------------------------------ furniture and decor: one small builder per catalog item (local frame: back at z = 0, front +z) */
function books(g, x0, x1, y, z0, z1, r, hmax = 0.26) {
  const cols = ['#7a3b2e', '#2f4d6e', '#d9c39a', '#3f6b4e', '#8c6a3a', '#5b4a7a', '#c4553f', '#e8e1cf'];
  let x = x0;
  while (x < x1 - 0.03) { const w = 0.025 + r() * 0.035, h = hmax * (0.62 + r() * 0.38); if (x + w > x1) break; g.box(x, y, z0, x + w, y + h, z1 - r() * 0.03, C(cols[Math.floor(r() * cols.length)])); x += w + 0.004; }
}
function shelves(g, w, h, d, wood, r, rows) {
  const t = 0.03;
  g.box(-w / 2, 0, 0, -w / 2 + t, h, d, wood); g.box(w / 2 - t, 0, 0, w / 2, h, d, wood); g.box(-w / 2, h - t, 0, w / 2, h, d, wood);
  g.box(-w / 2, 0, 0, w / 2, h, 0.015, shade(wood, 0.7), { top: false });
  for (let k = 0; k < rows; k++) { const y = 0.05 + (k * (h - 0.1)) / rows; g.box(-w / 2 + t, y, 0, w / 2 - t, y + t, d, wood); books(g, -w / 2 + t + 0.01, w / 2 - t - 0.01, y + t, 0.03, d - 0.02, r, Math.min(0.3, (h - 0.1) / rows - 0.06)); }
}
// a chair whose sitter faces -z (toward a desk at the wall); the back is on the +z side
function chair(g, x, z, col, legs = '#2b2f38') {
  g.box(x - 0.22, 0.425, z - 0.22, x + 0.22, 0.475, z + 0.22, C(col));        // seat top 0.475 (was 0.49; real range 0.38-0.48): the feet rest on the desk's 6.5 cm footrest
  g.box(x - 0.22, 0.475, z + 0.18, x + 0.22, 0.95, z + 0.23, C(col));
  for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) g.cbox(x + lx, 0, z + lz, 0.035, 0.425, 0.035, C(legs));
}
function frameArt(g, gl, w, h, y, frame, paint) {
  g.box(-w / 2, y, 0, w / 2, y + h, 0.035, C(frame));
  paint(g, gl, -w / 2 + 0.05, w / 2 - 0.05, y + 0.05, y + h - 0.05, 0.037);
}
function easel(g, h) { const wood = C('#8a6a48'); g.bar([-0.3, 0, 0.35], [0, h + 0.3, 0.05], 0.03, wood); g.bar([0.3, 0, 0.35], [0, h + 0.3, 0.05], 0.03, wood); g.bar([0, 0, -0.2], [0, h + 0.2, 0.03], 0.03, wood); g.box(-0.34, h - 0.06, 0.02, 0.34, h - 0.02, 0.12, wood); }
const lampGlow = (gl, x, y, z, r0, r1, h, hex = '#ffdba0') => gl.cyl(x, z, y, y + h, r0, r1, 10, hc(hex, 1.5), { bottom: true });

// mount: floor | wall (hung at the slot's wall, on an easel elsewhere) | rug (on the floor in front of the slot) | ceiling
export const ITEM_MODELS = {
  desk_setup: { mount: 'floor', seat: 0.95, build(g, gl, r, H, opt) {
    const keep = opt && opt.glb;                      // glb: the desk, chair and lamp are GLBs; only the footrest and laptop stay procedural
    const wood = C('#9a6a44');
    // desk top 0.735 (was 0.76; real range 0.72-0.76) and the laptop 8 cm nearer the chair: the Mixamo typing pose reaches the keys at these heights
    // Mixamo's typist: thighs 41 cm and fingers 66.5 cm above its floor, knees 69 cm. So: a 6.5 cm footrest, seat 0.475, desk top 0.734 (real 0.72-0.76) with a
    // thin 1.8 cm slab (underside 0.716 clears the knees by 2 cm) and a 9 mm laptop.
    if (!keep) { g.box(-0.62, 0.716, 0.05, 0.62, 0.734, 0.66, wood); for (const [x, z] of [[-0.58, 0.09], [0.58, 0.09], [-0.58, 0.62], [0.58, 0.62]]) g.cbox(x, 0, z, 0.04, 0.716, 0.04, shade(wood, 0.8)); }
    g.box(-0.3, 0, 0.3, 0.3, 0.065, 0.74, shade(wood, 0.7));
    g.box(-0.2, 0.734, 0.2, 0.2, 0.743, 0.44, C('#9aa4b5')); g.quad([0.2, 0.743, 0.2], [-0.2, 0.743, 0.2], [-0.2, 0.968, 0.17], [0.2, 0.968, 0.17], C('#3f4b60'));
    gl.box(-0.18, 0.758, 0.18, 0.18, 0.948, 0.192, hc('#a8d4ff', 1.1), { top: false, sides: 1 });
    g.box(0.45, 0.734, 0.3, 0.6, 0.754, 0.52, C('#ece6d6'));
    if (!keep) { g.cbox(-0.5, 0.734, 0.2, 0.1, 0.03, 0.1, C('#2b2f38')); g.bar([-0.5, 0.764, 0.2], [-0.44, 1.074, 0.32], 0.02, C('#2b2f38')); lampGlow(gl, -0.4, 0.994, 0.36, 0.1, 0.05, 0.1); chair(g, 0, 0.95, '#3a4152'); }
  } },
  bookshelf: { mount: 'floor', build(g, gl, r) { shelves(g, 0.95, 2.0, 0.34, C('#7b5536'), r, 5); } },
  trailing_plant: { mount: 'floor', build(g) {
    const pot = C('#c96f4a'), leaf = [C('#3f8f5e'), C('#4fa86f'), C('#2f7a4c')];
    g.box(-0.2, 0, 0.05, 0.2, 0.75, 0.4, C('#6d4c35')); g.cyl(0, 0.22, 0.75, 0.95, 0.14, 0.16, 8, pot);
    for (let k = 0; k < 6; k++) g.blob(Math.cos(k) * 0.1, 1.0 + (k % 2) * 0.05, 0.22 + Math.sin(k) * 0.08, 0.1, leaf[k % 3], {}, 0.8);
    for (const [x, z, l] of [[-0.15, 0.12, 0.6], [0.16, 0.3, 0.7], [0.05, 0.38, 0.5], [-0.1, 0.36, 0.45]]) { g.bar([x, 0.95, z], [x * 1.4, 0.95 - l, z + 0.06], 0.012, leaf[2]); for (let t = 0.2; t < 1; t += 0.25) g.blob(x + (x * 0.4) * t, 0.95 - l * t, z + 0.06 * t, 0.04, leaf[1], {}, 0.7); }
  } },
  reading_lamp: { mount: 'floor', build(g, gl) {
    const metal = C('#2b2f38');
    g.cyl(0, 0.35, 0, 0.03, 0.17, 0.17, 10, metal); g.bar([0, 0.03, 0.35], [0, 1.45, 0.35], 0.03, metal);
    g.cyl(0, 0.35, 1.38, 1.62, 0.24, 0.15, 10, C('#efe2c6'), { top: false }); lampGlow(gl, 0, 1.4, 0.35, 0.2, 0.12, 0.18);
    g.cyl(0.45, 0.35, 0, 0.55, 0.04, 0.04, 6, C('#7b5536')); g.cyl(0.45, 0.35, 0.55, 0.58, 0.22, 0.22, 12, C('#9a6a44')); g.box(0.38, 0.58, 0.3, 0.56, 0.64, 0.44, C('#c4553f'));
  } },
  woven_rug: { mount: 'rug', build(g) {
    g.box(-1.0, 0, -0.7, 1.0, 0.012, 0.7, C('#d8c7a4')); g.box(-0.9, 0.012, -0.6, 0.9, 0.016, 0.6, C('#b9774f'));
    for (let k = 0; k < 5; k++) g.box(-0.8, 0.016, -0.5 + k * 0.24, 0.8, 0.02, -0.42 + k * 0.24, C(k % 2 ? '#2f4d6e' : '#e8dcc0'));
  } },
  postcard_board: { mount: 'wall', y: 1.25, build(g, gl, r, y) {
    g.box(-0.48, y, 0, 0.48, y + 0.64, 0.03, C('#5b4128')); g.box(-0.44, y + 0.04, 0.03, 0.44, y + 0.6, 0.04, C('#c9a074'), { top: false });
    const cols = ['#8cc4ee', '#f4c977', '#ff967a', '#62dda8', '#f2f8ff', '#b9a2ff', '#e9e1d2', '#ffcf5a'];
    for (let k = 0; k < 8; k++) { const x = -0.36 + (k % 4) * 0.21 + (r() - 0.5) * 0.03, yy = y + 0.12 + Math.floor(k / 4) * 0.25 + (r() - 0.5) * 0.03; g.box(x - 0.08, yy, 0.04, x + 0.08, yy + 0.11, 0.045, C(cols[k]), { top: false }); g.cbox(x, yy + 0.09, 0.046, 0.015, 0.015, 0.01, C('#c4553f')); }
  } },
  skyline_print: { mount: 'wall', y: 1.3, build(g, gl, r, y) {
    frameArt(g, gl, 0.84, 0.58, y, '#15171c', (g2, gl2, x0, x1, y0, y1, z) => {
      g2.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [C('#f29a5c'), C('#f29a5c'), C('#2a3f74'), C('#2a3f74')]);
      let x = x0; while (x < x1 - 0.02) { const w = 0.03 + r() * 0.06, h = 0.05 + r() * 0.22; g2.box(x, y0, z, Math.min(x1, x + w), y0 + h, z + 0.004, C('#141a2c'), { top: false }); x += w + 0.008; }
      gl2.box(x0 + 0.2, y0 + 0.02, z + 0.005, x0 + 0.215, y0 + 0.31, z + 0.008, hc('#d9dee8', 0.8), { top: false });
    });
  } },
  record_player: { mount: 'floor', build(g) {
    const wood = C('#7b5536'); g.box(-0.48, 0, 0.02, 0.48, 0.55, 0.44, wood); for (const x of [-0.35, -0.12, 0.12, 0.35]) g.box(x - 0.1, 0.06, 0.44, x + 0.1, 0.5, 0.45, shade(wood, 0.85), { top: false });
    g.box(-0.24, 0.55, 0.08, 0.24, 0.62, 0.4, C('#d8cdb8')); g.cyl(-0.04, 0.24, 0.62, 0.635, 0.13, 0.13, 14, C('#15171c')); g.cyl(-0.04, 0.24, 0.635, 0.64, 0.04, 0.04, 8, C('#c4553f'));
    g.bar([0.16, 0.64, 0.12], [0.06, 0.65, 0.3], 0.012, C('#c9ccd4'));
    for (let k = 0; k < 7; k++) g.box(0.3 + k * 0.025, 0.55, 0.12, 0.318 + k * 0.025, 0.85, 0.42, C(['#15171c', '#2f4d6e', '#c4553f', '#15171c', '#f4c977', '#15171c', '#3f6b4e'][k]));
  } },
  two_seat_sofa: { mount: 'floor', build(g) {
    const fab = C('#3f7f86'), d = shade(fab, 0.82);
    g.box(-0.85, 0.12, 0.05, 0.85, 0.28, 0.78, d); for (const x of [-0.42, 0.42]) g.box(x - 0.4, 0.28, 0.2, x + 0.4, 0.385, 0.88, fab);     // low sofa seat: cushion top 0.385 (real sofas 0.35-0.45; the cushion compresses up to 3 cm) (was 0.52), same footprint
    g.box(-0.85, 0.28, 0.05, 0.85, 0.84, 0.25, fab); for (const s of [-1, 1]) g.box(s * 0.85 - (s > 0 ? 0.16 : 0), 0.12, 0.05, s * 0.85 + (s > 0 ? 0 : 0.16), 0.58, 0.9, d);
    for (const [x, z] of [[-0.78, 0.12], [0.78, 0.12], [-0.78, 0.84], [0.78, 0.84]]) g.cbox(x, 0, z, 0.05, 0.12, 0.05, C('#2b2f38'));
    g.box(-0.6, 0.385, 0.27, -0.25, 0.665, 0.4, C('#f4c977'));
  } },
  reading_armchair: { mount: 'floor', build(g) {
    const fab = C('#b4553a'), d = shade(fab, 0.8);
    g.box(-0.42, 0.12, 0.05, 0.42, 0.42, 0.85, d); g.box(-0.3, 0.42, 0.25, 0.3, 0.52, 0.84, fab); g.box(-0.42, 0.42, 0.05, 0.42, 1.0, 0.25, fab);
    for (const s of [-1, 1]) g.box(s * 0.42 - (s > 0 ? 0.13 : 0), 0.12, 0.05, s * 0.42 + (s > 0 ? 0 : 0.13), 0.66, 0.85, d);
    for (const [x, z] of [[-0.36, 0.1], [0.36, 0.1], [-0.36, 0.8], [0.36, 0.8]]) g.cbox(x, 0, z, 0.05, 0.12, 0.05, C('#5b4128'));
    g.box(-0.25, 0.08, 1.0, 0.25, 0.36, 1.38, fab); for (const [x, z] of [[-0.21, 1.04], [0.21, 1.04], [-0.21, 1.34], [0.21, 1.34]]) g.cbox(x, 0, z, 0.04, 0.08, 0.04, C('#5b4128'));
  } },
  fiddle_fig: { mount: 'floor', build(g) {
    const leaf = [C('#2f6b45'), C('#3f8f5e'), C('#27593a')];
    g.cyl(0, 0.3, 0, 0.42, 0.2, 0.24, 10, C('#e8e1cf')); g.bar([0, 0.42, 0.3], [0.05, 1.5, 0.3], 0.045, C('#6b4a32'));
    for (let k = 0; k < 14; k++) { const a = k * 2.4, y = 0.9 + (k / 14) * 1.0; g.blob(0.05 + Math.cos(a) * 0.2, y, 0.3 + Math.sin(a) * 0.2, 0.13, leaf[k % 3], {}, 0.55); }
  } },
  standing_desk: { mount: 'floor', stand: 0.75, build(g, gl) {
    const top = C('#d9c8a8'), leg = C('#2b2f38');
    g.box(-0.72, 1.04, 0.05, 0.72, 1.08, 0.72, top); for (const x of [-0.6, 0.6]) { g.cbox(x, 0, 0.38, 0.07, 1.04, 0.07, leg); g.cbox(x, 0, 0.38, 0.08, 0.03, 0.62, leg); }
    for (const x of [-0.32, 0.32]) { g.box(x - 0.3, 1.2, 0.12, x + 0.3, 1.56, 0.15, C('#1b1f2a')); g.cbox(x, 1.08, 0.18, 0.05, 0.12, 0.05, leg); gl.box(x - 0.28, 1.22, 0.151, x + 0.28, 1.54, 0.156, hc(x < 0 ? '#9fd0ff' : '#c4f0dc', 1.0), { top: false, sides: 1 }); }
    g.box(-0.25, 1.08, 0.42, 0.2, 1.1, 0.56, C('#3a4152'));
  } },
  brass_telescope: { mount: 'floor', build(g) {
    const brass = C('#c9a14a'), wood = C('#5b4128');
    for (const a of [0, 2.1, 4.2]) g.bar([Math.cos(a) * 0.32, 0, 0.45 + Math.sin(a) * 0.32], [0, 1.05, 0.45], 0.03, wood);
    g.bar([-0.05, 1.0, 0.65], [0.15, 1.42, 0.05], 0.11, brass); g.bar([0.15, 1.42, 0.05], [0.19, 1.5, -0.06], 0.13, shade(brass, 1.15)); g.bar([-0.05, 1.0, 0.65], [-0.08, 0.95, 0.72], 0.04, C('#2b2f38'));
  } },
  oil_painting: { mount: 'wall', y: 1.15, build(g, gl, r, y) {
    frameArt(g, gl, 1.15, 0.85, y, '#b08a3c', (g2, gl2, x0, x1, y0, y1, z) => {
      g2.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [C('#5c6878'), C('#5c6878'), C('#9aa7b8'), C('#9aa7b8')]);
      for (let k = 0; k < 6; k++) { const x = x0 + 0.05 + k * 0.17, h = 0.25 + r() * 0.35; g2.box(x, y0 + 0.18, z, x + 0.12, y0 + 0.18 + h, z + 0.004, C('#3a4250'), { top: false }); }
      g2.box(x0 + 0.05, y0, z + 0.004, x1 - 0.05, y0 + 0.18, z + 0.006, C('#2e3440'), { top: false });
      g2.box(x0 + 0.42, y0 + 0.06, z + 0.006, x0 + 0.62, y0 + 0.13, z + 0.009, C('#f2c230'), { top: false });
      for (const x of [x0 + 0.2, x1 - 0.25]) gl2.cbox(x, y0 + 0.4, z + 0.008, 0.03, 0.03, 0.004, hc('#ffdba0', 1.4));
    });
    g.box(-0.3, y + 0.95, 0.0, 0.3, y + 0.98, 0.12, C('#b08a3c')); gl.box(-0.28, y + 0.93, 0.08, 0.28, y + 0.95, 0.11, hc('#ffe3ae', 1.2));
  } },
  espresso_corner: { mount: 'floor', build(g, gl) {
    const cab = C('#2f4d6e'); g.box(-0.55, 0, 0.02, 0.55, 0.88, 0.58, cab); g.box(-0.58, 0.88, 0.0, 0.58, 0.92, 0.62, C('#e8e1cf'));
    for (const x of [-0.27, 0.27]) g.box(x - 0.25, 0.08, 0.58, x + 0.25, 0.82, 0.59, shade(cab, 1.15), { top: false });
    g.box(-0.22, 0.92, 0.12, 0.18, 1.32, 0.46, C('#c9ccd4')); g.box(-0.18, 0.98, 0.46, 0.14, 1.04, 0.5, C('#1b1f2a')); gl.cbox(0.1, 1.24, 0.462, 0.04, 0.03, 0.004, hc('#62dda8', 1.3));
    for (const x of [0.3, 0.42]) { g.cyl(x, 0.32, 0.92, 0.99, 0.035, 0.04, 8, C('#f2f8ff')); }
  } },
  upright_piano: { mount: 'floor', build(g) {
    const wood = C('#3a2418');
    g.box(-0.74, 0.0, 0.02, 0.74, 1.25, 0.6, wood); g.box(-0.7, 0.68, 0.6, 0.7, 0.74, 0.86, wood); g.box(-0.68, 0.74, 0.62, 0.68, 0.77, 0.84, C('#f4f1ea'));
    for (let k = 0; k < 18; k++) { if (k % 7 === 2 || k % 7 === 6) continue; const x = -0.66 + k * 0.075; g.box(x, 0.77, 0.62, x + 0.04, 0.8, 0.74, C('#15171c')); }
    for (const x of [-0.66, 0.62]) g.box(x, 0, 0.6, x + 0.05, 0.68, 0.86, wood);
    g.box(-0.4, 0.42, 1.05, 0.4, 0.48, 1.4, wood); for (const [x, z] of [[-0.36, 1.08], [0.36, 1.08], [-0.36, 1.37], [0.36, 1.37]]) g.cbox(x, 0, z, 0.04, 0.42, 0.04, wood);
  } },
  marble_desk: { mount: 'floor', seat: 1.0, build(g, gl) {
    const marble = C('#f1eee8'), gold = C('#c9a14a');
    g.box(-1.0, 0.72, 0.05, 1.0, 0.77, 0.75, marble); for (const x of [-0.92, 0.92]) { g.bar([x, 0, 0.12], [x, 0.72, 0.4], 0.03, gold); g.bar([x, 0, 0.68], [x, 0.72, 0.4], 0.03, gold); }
    g.cbox(-0.7, 0.77, 0.25, 0.12, 0.02, 0.12, gold); g.bar([-0.7, 0.79, 0.25], [-0.62, 1.15, 0.38], 0.02, gold); lampGlow(gl, -0.58, 1.08, 0.4, 0.11, 0.06, 0.1);
    g.box(-0.22, 0.77, 0.2, 0.22, 0.8, 0.48, C('#d9dee8')); g.box(0.4, 0.77, 0.3, 0.62, 0.84, 0.5, C('#2f4d6e'));
    chair(g, 0, 1.0, '#e8e1cf', '#c9a14a');
  } },
  velvet_sectional: { mount: 'floor', build(g) {
    const v = C('#1f5e57'), d = shade(v, 0.78);
    g.box(-1.35, 0.1, 0.05, 1.35, 0.42, 1.0, d); g.box(-1.35, 0.42, 0.05, 1.35, 0.85, 0.3, v);
    g.box(0.45, 0.1, 1.0, 1.35, 0.42, 2.1, d); g.box(1.2, 0.42, 0.3, 1.35, 0.7, 2.1, v); g.box(-1.35, 0.42, 0.3, -1.18, 0.7, 1.0, v);
    for (const x of [-0.85, -0.05]) g.box(x - 0.38, 0.42, 0.32, x + 0.38, 0.54, 0.98, v); g.box(0.48, 0.42, 0.32, 1.18, 0.54, 2.06, v);
    g.box(-0.9, 0.54, 0.32, -0.55, 0.82, 0.44, C('#c9a14a')); g.box(0.75, 0.54, 0.32, 1.1, 0.82, 0.44, C('#e8e1cf'));
  } },
  leather_lounge: { mount: 'floor', build(g) {
    const lea = C('#8a4b26'), shell = C('#2b1a12');
    g.cyl(0, 0.45, 0, 0.04, 0.28, 0.28, 10, C('#2b2f38')); g.bar([0, 0.04, 0.45], [0, 0.32, 0.45], 0.05, C('#2b2f38'));
    g.box(-0.42, 0.32, 0.12, 0.42, 0.42, 0.85, shell); g.box(-0.38, 0.42, 0.18, 0.38, 0.52, 0.82, lea);
    g.quad([-0.42, 0.42, 0.12], [0.42, 0.42, 0.12], [0.42, 1.05, -0.02], [-0.42, 1.05, -0.02], shell); g.quad([0.38, 0.5, 0.2], [-0.38, 0.5, 0.2], [-0.38, 1.0, 0.07], [0.38, 1.0, 0.07], lea);
    g.quad([-0.38, 0.5, 0.2], [0.38, 0.5, 0.2], [0.38, 1.0, 0.07], [-0.38, 1.0, 0.07], lea);
    g.box(-0.3, 0.26, 1.05, 0.3, 0.38, 1.5, lea); g.cyl(0, 1.27, 0, 0.26, 0.04, 0.04, 6, C('#2b2f38'));
  } },
  crystal_chandelier: { mount: 'ceiling', build(g, gl, r, H) {
    const gold = C('#c9a14a'); g.bar([0, H, 0], [0, H - 0.6, 0], 0.025, gold);
    for (const [y, rad, n] of [[H - 0.75, 0.42, 12], [H - 0.6, 0.28, 8], [H - 0.48, 0.14, 6]]) {
      g.cyl(0, 0, y, y + 0.03, rad, rad, 12, gold, { top: false });
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, x = Math.cos(a) * rad, z = Math.sin(a) * rad; gl.box(x - 0.018, y - 0.14, z - 0.018, x + 0.018, y - 0.01, z + 0.018, hc('#fff3d6', 1.6)); gl.cbox(x, y + 0.03, z, 0.025, 0.06, 0.025, hc('#ffdba0', 1.9)); }
    }
    gl.sphere(0, H - 0.9, 0, 0.06, 6, 4, hc('#fff3d6', 1.6));
  } },
  silk_rug: { mount: 'rug', build(g) {
    g.box(-1.4, 0, -0.95, 1.4, 0.012, 0.95, C('#c9a14a')); g.box(-1.3, 0.012, -0.85, 1.3, 0.016, 0.85, C('#1d3566')); g.box(-1.15, 0.016, -0.7, 1.15, 0.019, 0.7, C('#7a1f2e'));
    g.box(-1.05, 0.019, -0.6, 1.05, 0.022, 0.6, C('#24427a')); g.cyl(0, 0, 0.022, 0.026, 0.42, 0.42, 8, C('#c9a14a'), { rot: Math.PI / 8 }); g.cyl(0, 0, 0.026, 0.029, 0.25, 0.25, 8, C('#7a1f2e'), { rot: Math.PI / 8 });
  } },
  bronze_sculpture: { mount: 'floor', build(g) {
    const bronze = C('#8c6239'), stone = C('#e8e4dc');
    g.box(-0.25, 0, 0.1, 0.25, 0.95, 0.6, stone);
    g.bar([-0.04, 0.95, 0.35], [-0.02, 1.55, 0.35], 0.04, bronze); g.bar([0.04, 0.95, 0.35], [0.02, 1.55, 0.35], 0.04, bronze);
    g.bar([0, 1.55, 0.35], [0, 2.05, 0.35], 0.07, bronze); g.bar([0, 1.98, 0.35], [-0.16, 1.72, 0.38], 0.03, bronze); g.bar([0, 1.98, 0.35], [0.12, 2.25, 0.33], 0.03, bronze);
    g.blob(0, 2.15, 0.35, 0.065, bronze, {}, 1.3);
  } },
  library_wall: { mount: 'floor', build(g, gl, r, H) {
    const h = Math.min(H - 0.15, 3.2); shelves(g, 2.8, h, 0.38, C('#5b3a24'), r, Math.round(h / 0.42));
    const brass = C('#c9a14a'); g.bar([0.6, 0, 0.75], [0.8, h - 0.1, 0.42], 0.035, brass); g.bar([1.05, 0, 0.75], [1.25, h - 0.1, 0.42], 0.035, brass);
    for (let k = 1; k < 8; k++) { const t = k / 8; g.bar([0.6 + 0.2 * t, (h - 0.1) * t, 0.75 - 0.33 * t], [1.05 + 0.2 * t, (h - 0.1) * t, 0.75 - 0.33 * t], 0.025, brass); }
    g.bar([-1.4, h - 0.08, 0.44], [1.4, h - 0.08, 0.44], 0.02, brass);
  } },
  glass_wine_wall: { mount: 'floor', build(g, gl) {
    const steel = C('#2b2f38'), w = 1.6, h = 2.2;
    g.box(-w / 2, 0, 0, w / 2, 0.12, 0.42, steel); g.box(-w / 2, h - 0.06, 0, w / 2, h, 0.42, steel); for (const x of [-w / 2, 0, w / 2 - 0.04]) g.box(x, 0, 0.38, x + 0.04, h, 0.42, steel);
    g.box(-w / 2, 0, 0, w / 2, h, 0.02, C('#1b1f2a'), { top: false });
    gl.box(-w / 2 + 0.05, 0.12, 0.05, w / 2 - 0.05, 0.14, 0.36, hc('#ffcf8a', 1.4));
    const bot = ['#2f5a3a', '#5a1f28', '#2f5a3a', '#3a2418'];
    for (let row = 0; row < 7; row++) for (let k = 0; k < 9; k++) { const x = -w / 2 + 0.12 + k * 0.17, y = 0.24 + row * 0.27; g.bar([x, y, 0.06], [x, y, 0.34], 0.07, C(bot[(row + k) % 4])); }
    for (let row = 0; row < 7; row++) g.box(-w / 2 + 0.04, 0.2 + row * 0.27, 0.03, w / 2 - 0.04, 0.21 + row * 0.27, 0.38, C('#c9ccd4'));
  } },
  grand_piano: { mount: 'floor', build(g) {
    const black = C('#1d1e24');
    const sh = new THREE.Shape(); sh.moveTo(-0.75, 0); sh.lineTo(0.75, 0); sh.lineTo(0.75, 0.9); sh.bezierCurveTo(0.75, 1.6, 0.35, 1.5, 0.15, 1.95); sh.bezierCurveTo(-0.05, 2.35, -0.75, 2.3, -0.75, 1.9); sh.lineTo(-0.75, 0);
    const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 6 });
    g.addGeometry(ex, black, {}, new THREE.Matrix4().makeTranslation(0, 1.0, 0.25).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))); ex.dispose();
    for (const [x, z] of [[-0.65, 0.4], [0.65, 0.4], [-0.3, 2.1]]) g.cbox(x, 0, z, 0.08, 0.7, 0.08, black);
    g.box(-0.72, 0.68, 0.0, 0.72, 0.76, 0.28, black); g.box(-0.7, 0.76, 0.02, 0.7, 0.79, 0.26, C('#f4f1ea'));
    for (let k = 0; k < 18; k++) { if (k % 7 === 2 || k % 7 === 6) continue; const x = -0.68 + k * 0.077; g.box(x, 0.79, 0.12, x + 0.04, 0.82, 0.26, black); }
    // the lid, hinged on the long straight side and propped open
    const lidG = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 6 });
    g.addGeometry(lidG, shade(black, 1.5), {}, new THREE.Matrix4().makeTranslation(-0.75, 1.0, 0.25).multiply(new THREE.Matrix4().makeRotationZ(0.6)).multiply(new THREE.Matrix4().makeTranslation(0.75, 0, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))); lidG.dispose();
    g.bar([0.6, 1.0, 1.0], [0.36, 1.74, 1.0], 0.02, C('#3a3b40'));
    g.box(-0.7, 1.0, 0.0, 0.7, 1.02, 0.05, C('#c9a14a'));
    g.box(-0.4, 0.45, -0.55, 0.4, 0.52, -0.2, black); for (const [x, z] of [[-0.36, -0.52], [0.36, -0.52], [-0.36, -0.23], [0.36, -0.23]]) g.cbox(x, 0, z, 0.04, 0.45, 0.04, black);
  } },
  // chest-only pieces (docs/COZY.md 4.6): never sold, found in the daily chest
  subway_map_print: { mount: 'wall', y: 1.3, build(g, gl, r, y) {
    frameArt(g, gl, 0.9, 0.65, y, '#2b2f38', (g2, gl2, x0, x1, y0, y1, z) => {
      g2.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], C('#efe6cf'));
      g2.box(x0 + 0.02, y0 + 0.02, z, x0 + 0.2, y1 - 0.02, z + 0.003, C('#cfe0ea'), { top: false });                 // the river
      const lines = ['#c4553f', '#2f6db5', '#3f8f5e', '#f2c230', '#8a4fa8'];
      for (let k = 0; k < 5; k++) { const yy = y0 + 0.08 + k * 0.1, xa = x0 + 0.12 + r() * 0.1, xb = x1 - 0.06 - r() * 0.12; g2.box(xa, yy, z + 0.004, xb, yy + 0.014, z + 0.007, C(lines[k]), { top: false }); g2.box(xa + (xb - xa) * (0.3 + r() * 0.4), yy - 0.06, z + 0.004, xa + (xb - xa) * (0.3 + r() * 0.4) + 0.014, yy + 0.06, z + 0.007, C(lines[k]), { top: false }); }
      for (let k = 0; k < 12; k++) g2.cbox(x0 + 0.15 + r() * (x1 - x0 - 0.25), y0 + 0.06 + r() * (y1 - y0 - 0.12), z + 0.008, 0.016, 0.016, 0.003, C('#f8f6ef'));
    });
  } },
  brass_desk_clock: { mount: 'floor', build(g, gl) {
    const wood = C('#6d4c35'), brass = C('#c9a14a');
    g.box(-0.16, 0, 0.02, 0.16, 0.62, 0.28, wood); g.box(-0.17, 0.62, 0.01, 0.17, 0.66, 0.29, shade(wood, 1.15));
    g.box(-0.12, 0.66, 0.08, 0.12, 0.69, 0.22, brass); g.cyl(0, 0.15, 0.69, 0.71, 0.05, 0.05, 8, brass);
    g.cyl(0, 0.15, 0.71, 0.86, 0.09, 0.09, 14, brass, { rot: 0 }); g.box(-0.075, 0.715, 0.235, 0.075, 0.855, 0.24, C('#f4f1ea'), { top: false });
    g.box(-0.004, 0.785, 0.241, 0.004, 0.84, 0.244, C('#15171c'), { top: false }); g.box(-0.004, 0.783, 0.241, 0.04, 0.79, 0.244, C('#15171c'), { top: false });
    gl.cbox(0, 0.875, 0.15, 0.03, 0.02, 0.03, hc('#ffe3ae', 1.1));
  } },
  typewriter: { mount: 'floor', seat: 0.78, build(g) {
    const wood = C('#7b5536'), body = C('#2f5a4a'), keys = C('#e8e1cf');
    g.box(-0.34, 0.68, 0.02, 0.34, 0.72, 0.54, wood); for (const [x, z] of [[-0.3, 0.06], [0.3, 0.06], [-0.3, 0.5], [0.3, 0.5]]) g.cbox(x, 0, z, 0.04, 0.68, 0.04, shade(wood, 0.8));
    g.box(-0.2, 0.72, 0.12, 0.2, 0.82, 0.42, body); g.quad([0.2, 0.82, 0.42], [-0.2, 0.82, 0.42], [-0.2, 0.86, 0.22], [0.2, 0.86, 0.22], body);
    g.box(-0.24, 0.84, 0.12, 0.24, 0.9, 0.2, C('#1b1f2a')); g.box(-0.13, 0.88, 0.14, 0.13, 1.06, 0.15, C('#f8f6ef'));
    for (let row = 0; row < 3; row++) for (let k = 0; k < 7; k++) g.cbox(-0.15 + k * 0.05 + row * 0.012, 0.82 + row * 0.012, 0.38 - row * 0.05, 0.026, 0.02, 0.026, keys);
    g.cyl(0, 0.78, 0, 0.44, 0.03, 0.03, 6, C('#2b2f38')); g.cyl(0, 0.78, 0.44, 0.48, 0.18, 0.18, 12, C('#5b4128'));
  } },
  record_crate: { mount: 'floor', build(g, gl, r) {
    const wood = C('#a8865a');
    g.box(-0.28, 0, 0.02, 0.28, 0.04, 0.38, wood); for (const z of [0.02, 0.35]) g.box(-0.28, 0.04, z, 0.28, 0.32, z + 0.03, wood); for (const x of [-0.28, 0.25]) g.box(x, 0.04, 0.02, x + 0.03, 0.32, 0.38, wood);
    const cols = ['#15171c', '#c4553f', '#2f4d6e', '#f4c977', '#3f6b4e', '#e8e1cf', '#8a4fa8'];
    for (let k = 0; k < 11; k++) { const x = -0.23 + k * 0.042, h = 0.3 + r() * 0.04; g.box(x, 0.04, 0.05, x + 0.034, h, 0.35, C(cols[k % cols.length])); }
  } },
  velvet_armchair: { mount: 'floor', build(g) {
    const fab = C('#5f97c9'), d = shade(fab, 0.78);
    g.box(-0.45, 0.12, 0.05, 0.45, 0.42, 0.9, d); g.box(-0.32, 0.42, 0.25, 0.32, 0.54, 0.88, fab); g.box(-0.45, 0.42, 0.05, 0.45, 0.95, 0.25, fab);
    for (let k = 0; k < 3; k++) g.box(-0.3 + k * 0.2, 0.5, 0.25, -0.14 + k * 0.2, 0.92, 0.27, shade(fab, 1.08), { top: false });
    for (const s of [-1, 1]) g.box(s * 0.45 - (s > 0 ? 0.14 : 0), 0.12, 0.05, s * 0.45 + (s > 0 ? 0 : 0.14), 0.68, 0.9, d);
    for (const [x, z] of [[-0.38, 0.1], [0.38, 0.1], [-0.38, 0.85], [0.38, 0.85]]) g.cbox(x, 0, z, 0.05, 0.12, 0.05, C('#c9a14a'));
  } },
  flatiron_globe: { mount: 'floor', build(g, gl) {
    const stone = C('#e8e4dc'), wood = C('#5b4128');
    g.box(-0.17, 0, 0.03, 0.17, 0.62, 0.37, stone); g.box(-0.19, 0.62, 0.01, 0.19, 0.65, 0.39, shade(stone, 0.92));
    g.cyl(0, 0.2, 0.65, 0.7, 0.11, 0.12, 12, wood);
    const t = 0.2; g.quad([-0.04, 0.7, t + 0.05], [0.05, 0.7, t - 0.03], [0.05, 0.84, t - 0.03], [-0.04, 0.84, t + 0.05], C('#d9c3a0')); g.quad([0.05, 0.7, t - 0.03], [-0.05, 0.7, t - 0.05], [-0.05, 0.84, t - 0.05], [0.05, 0.84, t - 0.03], C('#c7ae88'));
    g.quad([-0.05, 0.7, t - 0.05], [-0.04, 0.7, t + 0.05], [-0.04, 0.84, t + 0.05], [-0.05, 0.84, t - 0.05], C('#b89c74'));
    { const disc = new THREE.CircleGeometry(0.12, 14); gl.addGeometry(disc, hc('#bcd9f2', 0.55), {}, new THREE.Matrix4().makeTranslation(0, 0.8, 0.13)); disc.dispose(); }   // the glass, seen from the front
    g.cyl(0, 0.2, 0.92, 0.935, 0.03, 0.03, 8, C('#c9a14a'));
    for (let k = 0; k < 9; k++) gl.cbox(-0.07 + ((k * 37) % 14) / 100, 0.72 + ((k * 53) % 15) / 100, 0.15 + ((k * 29) % 10) / 100, 0.012, 0.012, 0.012, hc('#ffffff', 1.2));
  } },
};
// anything new in the catalog still gets a simple stand-in by category
const BY_CATEGORY = { decor: 'brass_desk_clock', desk: 'desk_setup', shelf: 'bookshelf', plant: 'trailing_plant', lamp: 'reading_lamp', rug: 'woven_rug', wall: 'postcard_board', art: 'skyline_print', audio: 'record_player', sofa: 'two_seat_sofa', armchair: 'reading_armchair', telescope: 'brass_telescope', kitchen: 'espresso_corner', piano: 'upright_piano' };
export const modelFor = (item, category) => ITEM_MODELS[item] || ITEM_MODELS[BY_CATEGORY[category]] || ITEM_MODELS.bookshelf;

/* ------------------------------------------------------------ free placement (docs/COZY.md 4.2, epoch/layout.py): where a layout entry's model goes */
// the solid walls a picture can hang on, as epoch/layout.walls() describes them: n = back (window) wall, w = left wall, p = the 1-bed partition
export function roomWalls(L) {
  const out = { n: { axis: 'x', lo: -L.W / 2, hi: L.W / 2, plane: -L.D / 2, ry: 0 }, w: { axis: 'z', lo: -L.D / 2, hi: L.D / 2, plane: -L.W / 2, ry: Math.PI / 2 } };
  if (L.partition) out.p = { axis: 'z', lo: L.partition.z0, hi: L.partition.z1, plane: L.partition.x + 0.06, ry: Math.PI / 2 };
  return out;
}
const strSeed = (id) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 99991; };
/** the model of one placed piece in its own frame (back at z = 0, front +z). info = the layout item (size, anchor, category, surface) */
export function buildItemGeo(id, info, L, entry) {
  const m = modelFor(id, info && info.category), ig = new Geo(), igl = new Geo(), rr = rng(strSeed(id) + 7);
  const wall = entry && entry.surface === 'wall';
  if (m.mount === 'wall') { if (!wall) easel(ig, 1.25); m.build(ig, igl, rr, wall ? (+entry.y || m.y || 1.3) : 1.25); }
  else m.build(ig, igl, rr, L.H);
  return { ig, igl, m };
}
/** the group transform of an entry: floor pieces by their footprint centre minus the turned anchor, wall pieces on their wall */
export function entryPose(L, e, info, walls = roomWalls(L)) {
  if (e.surface === 'wall') {
    const wl = walls[e.wall] || walls.n, a = wl.lo + (+e.u || 0) * (wl.hi - wl.lo);
    return wl.axis === 'x' ? { x: a, z: wl.plane + 0.004, ry: wl.ry } : { x: wl.plane + 0.004, z: a, ry: wl.ry };
  }
  const an = (info && info.anchor) || [0, ((info && info.size && info.size[1]) || 0.6) / 2], c = Math.cos(+e.ry || 0), sn = Math.sin(+e.ry || 0);
  return { x: e.x - (an[0] * c + an[1] * sn), z: e.z - (-an[0] * sn + an[1] * c), ry: +e.ry || 0 };
}
/** the layout entries of an economy block (/api/economy home.layout, /api/world economy.layout), or null for an old payload */
export function layoutItemsOf(e) {
  if (!e) return null;
  const l = (e.home && e.home.layout) || e.layout;
  return l && Array.isArray(l.items) ? l.items : null;
}

/* ------------------------------------------------------------ the shell: floor, the two cutaway walls, windows, the fixed bits (bed, kitchenette) */
function wallWithHoles(g, x0, x1, y0, y1, z, t, holes, col) {
  const hs = holes.slice().sort((a, b) => a.x0 - b.x0); let x = x0;
  for (const h of hs) {
    if (h.x0 > x + 1e-3) g.box(x, y0, z - t, h.x0, y1, z, col);
    if (h.y0 > y0 + 1e-3) g.box(h.x0, y0, z - t, h.x1, h.y0, z, col);
    if (h.y1 < y1 - 1e-3) g.box(h.x0, h.y1, z - t, h.x1, y1, z, col);
    x = h.x1;
  }
  if (x < x1 - 1e-3) g.box(x, y0, z - t, x1, y1, z, col);
}
/* ------------------------------------------------------------ realistic GLBs + textures (room/assets/, free licences in LICENSES.md); the procedural pieces show until a file loads and stay if it fails */
const _glbCache = new Map();
function loadGLB(name) {
  if (!_glbCache.has(name)) _glbCache.set(name, (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    return (await l.loadAsync(new URL('../room/assets/' + name + '.glb', import.meta.url).href)).scene;
  })());
  return _glbCache.get(name).then((sc) => sc.clone(true));
}
/** scale uniformly to fit w x d (and h if given), stand on y0, centre on (cx, cz); turn 90deg when that fits better (rugs) */
function fitGLB(obj, o) {
  const bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
  let rot = 0, sx = sz.x, sd = sz.z;
  if (o.turn && o.w && o.d && Math.min(o.w / sd, o.d / sx) > Math.min(o.w / sx, o.d / sd)) { rot = Math.PI / 2; sx = sz.z; sd = sz.x; }
  const k = Math.min(o.w ? o.w / sx : 1e9, o.d ? o.d / sd : 1e9, o.h ? o.h / sz.y : 1e9), inner = new THREE.Group();
  obj.position.set(-ctr.x, -bb.min.y, -ctr.z); inner.add(obj); inner.scale.setScalar(k); inner.rotation.y = rot;
  const out = new THREE.Group(); out.add(inner); out.position.set(o.cx || 0, o.y0 || 0, o.cz || 0); if (o.ry) out.rotation.y = o.ry;
  out.userData.k = k; return out;
}
let _shellMats = null;
function shellMats() {
  if (_shellMats) return _shellMats;
  const tl = new THREE.TextureLoader(), u = (f) => new URL('../room/assets/tex/' + f, import.meta.url).href;
  const mk = (base, col) => {
    const t = (f, srgb) => { const x = tl.load(u(base + f)); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 4; if (srgb) x.colorSpace = THREE.SRGBColorSpace; return x; };
    return new THREE.MeshStandardMaterial({ map: t('_diff.webp', true), normalMap: t('_nor.webp'), roughnessMap: t('_arm.webp'), roughness: 1, metalness: 0, vertexColors: true });
  };
  return (_shellMats = { floor: mk('oak_floor'), wall: mk('plaster_wall') });
}
/** world-space UVs for a box mesh: 1 uv unit = one 2 m texture tile (so the oak boards come out about 7 cm wide), projected along each face's dominant normal */
function addUV(geo) {
  const P = geo.attributes.position, N = geo.attributes.normal, uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    const [a, b] = ay >= ax && ay >= az ? [x, z] : az >= ax ? [x, y] : [z, y]; uv[i * 2] = a / 2; uv[i * 2 + 1] = b / 2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}

function buildShell(L, r) {
  const g = new Geo(), gl = new Geo(), gf = new Geo(), gw = new Geo(), gb = new Geo(), { W, D, H } = L, bz = -D / 2, lx = -W / 2, t = 0.18;
  const floor = C(L.floor), wall = C(L.wall), side = C(L.side), trim = C('#f4efe4');
  // floor: boards (or marble tiles in the penthouse), a slab edge in front
  if (L.marble) { for (let i = 0; i < W / 1.0; i++) for (let j = 0; j < D / 1.0; j++) g.box(lx + i, -0.06, bz + j, lx + i + 1, 0, bz + j + 1, shade(floor, (i + j) % 2 ? 0.96 : 1.02)); }
  else gf.box(lx, -0.06, bz, -lx, 0, -bz, C('#ffffff'));                                         // oak boards: textured in buildRoom
  g.box(lx - t, -0.4, bz - t, -lx, -0.06, -bz, C('#3a3f4a'), { top: false });
  // the window wall and the side wall (the front and right walls are cut away so the room can be seen)
  if (L.glassWall) {
    g.box(lx - t, H, bz - t, -lx, H + 0.25, bz, C('#d8d4cb')); g.box(lx - t, -0.06, bz - t, -lx, 0.06, bz, C('#2b2f38'));
  } else {
    const wc = L.brick ? C('#a8553d') : wall;
    wallWithHoles(L.brick ? g : gw, lx - t, -lx, -0.06, H, bz, t, L.windows, L.brick ? wc : C('#ffffff'));
    if (L.brick) for (let y = 0.1; y < H; y += 0.15) g.box(lx, y, bz + 0.002, -lx, y + 0.012, bz + 0.004, C('#c9a48e'), { top: false, sides: 1 });
    g.box(lx, 0, bz, -lx, 0.1, bz + 0.02, trim);                                                     // skirting
  }
  gw.box(lx - t, -0.06, bz, lx, H, -bz, C('#ffffff')); g.box(lx, 0, bz, lx + 0.02, 0.1, -bz, trim);
  g.box(lx - t, H, bz - t, lx, H + 0.25, -bz, shade(side, 0.9));
  // window frames and mullions
  for (const w of L.windows) {
    const fc = L.glassWall ? C('#2b2f38') : L.brick ? C('#1f2329') : C('#f4f1ea'), ft = L.glassWall ? 0.05 : 0.06, [nx, ny] = w.grid || [1, 1];
    for (let i = 0; i <= nx; i++) { const x = w.x0 + ((w.x1 - w.x0) * i) / nx; g.box(x - ft / 2, w.y0, bz - 0.06, x + ft / 2, w.y1, bz + 0.02, fc); }
    for (let j = 0; j <= ny; j++) { const y = w.y0 + ((w.y1 - w.y0) * j) / ny; g.box(w.x0, y - ft / 2, bz - 0.06, w.x1, y + ft / 2, bz + 0.02, fc); }
    if (!L.glassWall) { g.box(w.x0 - 0.06, w.y0 - 0.05, bz, w.x1 + 0.06, w.y0, bz + 0.14, trim); g.box(w.x0 + 0.1, 0.18, bz + 0.02, w.x1 - 0.1, 0.62, bz + 0.12, C('#d6d1c6')); for (let x = w.x0 + 0.14; x < w.x1 - 0.12; x += 0.07) g.box(x, 0.2, bz + 0.12, x + 0.03, 0.6, bz + 0.135, C('#c4beb2')); }
  }
  // the door in the side wall (a studio's kitchenette is on that wall: its door is on the cut-away side)
  if (!L.kitchen) g.box(lx + 0.0, 0, 1.0, lx + 0.03, 2.1, 1.95, C('#6d4c35'));
  if (!L.kitchen) g.cbox(lx + 0.05, 1.0, 1.85, 0.03, 0.05, 0.05, C('#c9a14a'));
  if (L.partition) {
    const p = L.partition, [d0, d1] = p.door;
    g.box(p.x - 0.06, 0, p.z0, p.x + 0.06, H, d0, wall); g.box(p.x - 0.06, 0, d1, p.x + 0.06, H, p.z1, wall); g.box(p.x - 0.06, 2.1, d0, p.x + 0.06, H, d1, wall);
  }
  if (L.columns) for (const [x, z] of L.columns) { g.cyl(x, z, 0, H, 0.14, 0.14, 10, C('#2b2f38')); g.cyl(x, z, H - 0.25, H, 0.14, 0.24, 10, C('#2b2f38')); }
  if (L.bed) bedAt(gb, L.bed);
  if (L.kitchen) {
    const k = L.kitchen, zf = k.z1 - 0.66;                                                           // counter and cabinets, then a small fridge at the end
    g.box(k.x0, 0, k.z0, k.x1, 0.88, zf, C('#4f6b88')); g.box(k.x0, 0.88, k.z0, k.x1 + 0.03, 0.92, zf, C('#e8e1cf'));
    for (let z = k.z0 + 0.05; z < zf - 0.3; z += 0.42) g.box(k.x1, 0.1, z, k.x1 + 0.01, 0.8, z + 0.36, C('#5f7d9b'), { top: false, sides: 4 });
    g.cyl(k.x0 + 0.3, k.z0 + 0.35, 0.92, 0.95, 0.12, 0.12, 8, C('#c9ccd4'));
    g.box(k.x0, 0, zf + 0.01, k.x1 + 0.02, 1.75, k.z1, C('#e9ecf0')); g.box(k.x1 + 0.02, 1.0, zf + 0.1, k.x1 + 0.04, 1.4, zf + 0.14, C('#9aa4b5'));
    g.box(k.x0, 1.5, k.z0, k.x0 + 0.35, 2.2, zf, C('#4f6b88'));
  }
  if (L.island) { const { x, z } = L.island; g.box(x - 1.0, 0, z - 0.4, x + 1.0, 0.9, z + 0.4, C('#2b2f38')); g.box(x - 1.05, 0.9, z - 0.45, x + 1.05, 0.95, z + 0.45, C('#f1eee8')); for (const dx of [-0.6, 0, 0.6]) { g.cyl(x + dx, z + 0.7, 0, 0.7, 0.03, 0.03, 6, C('#c9a14a')); g.cyl(x + dx, z + 0.7, 0.7, 0.76, 0.18, 0.18, 10, C('#2b2f38')); } }
  // a ceiling light so the room is warm after dark
  gl.cyl(0.4, 0, H - 0.12, H - 0.04, 0.22, 0.22, 12, hc('#ffe3ae', 1.3), { bottom: true });
  return { g, gl, gf, gw, gb, L };
}
/** the meshes of a shell: vertex-coloured bits, textured floor + walls, the bed (procedural until bed.glb loads; a platform bed stays procedural) */
function shellMeshes(sh, solid, glow, add) {
  const M = shellMats(), out = [new THREE.Mesh(sh.g.build(), solid), new THREE.Mesh(sh.gl.build(), glow)];
  if (sh.gf.n) out.push(new THREE.Mesh(addUV(sh.gf.build()), M.floor));
  if (sh.gw.n) out.push(new THREE.Mesh(addUV(sh.gw.build()), M.wall));
  const bedM = new THREE.Mesh(sh.gb.build(), solid); out.push(bedM);
  const b = sh.L.bed;
  if (b && !b.platform) loadGLB('bed').then((o) => {
    const fit = fitGLB(o, { w: b.w, d: b.l, cx: b.x, cz: b.z, ry: b.ry }); if (!bedM.parent) return;
    bedM.parent.add(fit); bedM.parent.remove(bedM);
  }).catch((e) => console.warn('bed.glb kept procedural', e));
  out.forEach(add); return out;
}
function bedAt(g, b) {
  const c = Math.cos(b.ry), s = Math.sin(b.ry), wood = C('#6d4c35'), sheet = C('#f2efe8'), duvet = C('#8cb0d6');
  const put = (lx0, ly0, lz0, lx1, ly1, lz1, col) => {
    const xs = [lx0 * c + lz0 * s, lx1 * c + lz0 * s, lx0 * c + lz1 * s, lx1 * c + lz1 * s], zs = [-lx0 * s + lz0 * c, -lx1 * s + lz0 * c, -lx0 * s + lz1 * c, -lx1 * s + lz1 * c];
    g.box(b.x + Math.min(...xs), ly0, b.z + Math.min(...zs), b.x + Math.max(...xs), ly1, b.z + Math.max(...zs), col);
  };
  const hw = b.w / 2, hl = b.l / 2;
  if (b.platform) put(-hw - 0.25, 0, -hl, hw + 0.25, 0.22, hl + 0.3, C('#5b4128'));
  const y = b.platform ? 0.22 : 0;
  put(-hw, y, -hl + 0.07, hw, y + 0.28, hl, wood); put(-hw + 0.03, y + 0.28, -hl + 0.1, hw - 0.03, y + 0.5, hl - 0.03, sheet);
  put(-hw + 0.02, y + 0.5, -hl + 0.55, hw - 0.02, y + 0.56, hl - 0.02, duvet); put(-hw, y, -hl + 0.01, hw, y + 0.95, -hl + 0.07, wood);
  for (const k of [-1, 1]) put(k * hw * 0.48 - 0.28, y + 0.5, -hl + 0.12, k * hw * 0.48 + 0.28, y + 0.62, -hl + 0.46, C('#ffffff'));
  return y + 0.5;
}

/* ------------------------------------------------------------ the window: a painted sky until the real view arrives */
function paintedSky(hour) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320; const x = c.getContext('2d');
  const night = hour < 6 || hour > 19.5, g = x.createLinearGradient(0, 0, 0, 320);
  if (night) { g.addColorStop(0, '#05122a'); g.addColorStop(0.7, '#183a68'); g.addColorStop(1, '#2f639b'); } else { g.addColorStop(0, '#6fa6d9'); g.addColorStop(0.75, '#c9dcef'); g.addColorStop(1, '#efe9dc'); }
  x.fillStyle = g; x.fillRect(0, 0, 512, 320);
  const r = rng(7); x.fillStyle = night ? '#0d1b33' : '#7d8ea8';
  for (let i = 0; i < 40; i++) { const w = 10 + r() * 22, h = 30 + r() * 120; x.fillRect(i * 13 - 10, 320 - h, w, h); }
  if (night) { x.fillStyle = 'rgba(255,214,150,0.85)'; for (let i = 0; i < 160; i++) x.fillRect(r() * 512, 200 + r() * 120, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ------------------------------------------------------------ the dialog */
let OPEN = null;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const SIZE_WORD = { studio: 'studio', '1-bed': 'one-bedroom', loft: 'loft', penthouse: 'penthouse' };

export function openRoom(o = {}) {
  if (OPEN) { OPEN.focus(); return OPEN; }
  let econ = o.econ || null;
  const prevFocus = document.activeElement;
  const ov = document.createElement('div');
  ov.className = 'room-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'room-ov-t');
  ov.innerHTML = '<div class="room-ov__card"><header class="room-ov__head"><div class="room-ov__titles"><h2 class="room-ov__t" id="room-ov-t">Your home</h2><p class="room-ov__sub" data-room="sub"></p></div>' +
    '<button type="button" class="room-ov__x" data-room="close" aria-label="Close your home"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button></header>' +
    '<div class="room-ov__stage" data-room="stage"></div><p class="room-ov__view" data-room="view"></p><div class="room-ov__list" data-room="list"></div></div>';
  document.body.appendChild(ov);
  const $ = (k) => ov.querySelector('[data-room="' + k + '"]');
  const stage = $('stage');
  let disposed = false, three = null;

  function close() {
    if (disposed) return; disposed = true;
    document.removeEventListener('keydown', onKey, true);
    if (three) three.dispose();
    ov.remove(); OPEN = null;
    try { prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); } catch { /* gone */ }
    o.onClose?.();
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Tab') { const b = $('close'); e.preventDefault(); b.focus(); } }
  document.addEventListener('keydown', onKey, true);
  $('close').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  function fill(e) {
    econ = e || econ || {};
    const h = econ.home || {}, L = layoutOf(h.size), slots = +h.slots || L.slots.length;
    const placed = Array.isArray(econ.placed) ? econ.placed : Array.isArray(h.placed) ? h.placed : [];
    const items = layoutItemsOf(econ), budget = +(h.budget || (econ.layout && econ.layout.budget)) || slots;
    const outfit = econ.outfit || (econ.equipped && econ.equipped.outfit) || 'everyday';
    const used = items ? items.length : placed.length;
    $('sub').textContent = [h.address, h.district, (SIZE_WORD[h.size] || 'home') + ', ' + used + ' of ' + (items ? budget : slots) + ' places used'].filter(Boolean).join(' · ');
    ov.querySelector('.room-ov__t').textContent = h.name || 'Your home';
    const storage = Array.isArray(econ.storage) ? econ.storage : null;
    const inRoom = items ? items.map((p) => '<li>' + esc(p.name || p.id) + '</li>').join('') : placed.map((p) => '<li><span class="room-ov__slot">' + (p.slot + 1) + '</span>' + esc(p.name || p.item) + '</li>').join('');
    $('list').innerHTML = '<h3 class="room-ov__lh">In the room</h3>' + (used ? '<ul>' + inRoom + '</ul>' : '<p>Nothing placed yet. Furniture you buy goes straight into the room.</p>') +
      (storage && storage.length ? '<h3 class="room-ov__lh">In storage</h3><ul>' + storage.map((x) => '<li>' + esc(x.name || x.item) + '</li>').join('') + '</ul>' : '');
    return { h, L, placed, items, outfit, character: econ.character };
  }
  const first = fill(econ);
  if (o.fetchEconomy) Promise.resolve().then(o.fetchEconomy).then((e) => { if (!disposed && e && e.ok !== false) { const keep = econ; econ = { ...keep, ...e, placed: (e.home && e.home.placed) || keep?.placed, layout: (e.home && e.home.layout) || keep?.layout, outfit: (e.equipped && e.equipped.outfit) || keep?.outfit, character: e.character || keep?.character }; fill(econ); three?.refill(econ); } }).catch(() => { /* the list stays */ });

  // WebGL, or the 2D list on its own
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) { ov.classList.add('room-ov--flat'); stage.hidden = true; $('view').textContent = ''; $('close').focus(); OPEN = { focus: () => $('close').focus(), close }; return OPEN; }
  try { three = createRoom3D(stage, first, o, (txt) => { $('view').textContent = txt; }); } catch (e) { console.warn('room', e); ov.classList.add('room-ov--flat'); stage.hidden = true; }
  $('close').focus({ preventScroll: true });
  OPEN = { focus: () => $('close').focus(), close, refill: (e) => { fill(e); three?.refill(e); } };
  return OPEN;
}

function createRoom3D(host, first, o, setViewText) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'room-ov__canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const hour = o.hour != null ? o.hour : new Date().getHours() + new Date().getMinutes() / 60, night = hour < 6.5 || hour > 19;
  scene.background = new THREE.Color(night ? '#081a33' : '#dbe7f3');
  scene.add(new THREE.HemisphereLight(night ? 0xffe6c4 : 0xfff6e8, night ? 0x2a2250 : 0x8c7f70, night ? 1.6 : 2.2));
  const key = new THREE.DirectionalLight(night ? 0xffd8a0 : 0xffffff, night ? 1.2 : 2.0); key.position.set(3, 6, 5); scene.add(key);
  const sun = new THREE.DirectionalLight(night ? 0x8cb0ff : 0xfff2dc, night ? 0.25 : 1.4); sun.position.set(-1, 4, -6); scene.add(sun);
  setSelfLight(night ? 0.12 : 0.04);
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const roomG = new THREE.Group(); scene.add(roomG);
  let viewMesh = null, viewTex = null, fig = null, L = first.L, cur = first, disposed = false, raf = 0;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false; controls.enableDamping = false; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.7;
  controls.minAzimuthAngle = -1.0; controls.maxAzimuthAngle = 0.75; controls.minPolarAngle = 0.55; controls.maxPolarAngle = 1.36;
  controls.addEventListener('change', () => draw());
  renderer.domElement.style.touchAction = 'none';

  function build(state) {
    for (const ch of [...roomG.children]) { roomG.remove(ch); ch.traverse?.((m) => { if (m.isMesh && m.geometry) m.geometry.dispose(); }); }
    const h = state.h, placed = state.placed; L = layoutOf(h.size); cur = state;
    const r = rng(((h.bin | 0) % 99991) + 3);
    const sh = buildShell(L, r);
    let deskSlot = null;
    if (Array.isArray(state.items)) {
      const walls = roomWalls(L);
      for (const e of state.items) {
        const { ig, igl, m } = buildItemGeo(e.id, e, L, e), pz = entryPose(L, e, e, walls);
        const grp = new THREE.Group(); grp.add(new THREE.Mesh(ig.build(), solid)); if (!igl.empty) grp.add(new THREE.Mesh(igl.build(), glowMaterial()));
        grp.position.set(pz.x, m.mount === 'rug' ? 0.001 : 0, pz.z); grp.rotation.y = pz.ry; if (m.mount === 'rug') grp.renderOrder = -1;
        roomG.add(grp);
        if ((m.seat || m.stand) && !deskSlot) deskSlot = { sl: { x: pz.x, z: pz.z, ry: pz.ry }, m, grp };
      }
    } else {
      const slotUse = new Map(); for (const p of placed) if (p && p.slot >= 0 && p.slot < L.slots.length) slotUse.set(p.slot, p);
      for (const [i, p] of slotUse) {
        const sl = L.slots[i], m = modelFor(p.item, p.category), ig = new Geo(), igl = new Geo(), rr = rng(i * 131 + 7);
        if (m.mount === 'wall') { if (!sl.wall) easel(ig, 1.25); m.build(ig, igl, rr, sl.wall ? (m.y || 1.3) : 1.25); }
        else if (m.mount === 'ceiling') m.build(ig, igl, rr, L.H);
        else m.build(ig, igl, rr, L.H);
        const grp = new THREE.Group(); grp.add(new THREE.Mesh(ig.build(), solid)); if (!igl.empty) grp.add(new THREE.Mesh(igl.build(), glowMaterial()));
        const fwd = m.mount === 'rug' ? (sl.wall ? 1.15 : 0.2) : m.mount === 'ceiling' ? 1.3 : sl.wall ? 0.02 : 0;
        grp.position.set(sl.x + Math.sin(sl.ry) * fwd, m.mount === 'rug' ? 0.001 : 0, sl.z + Math.cos(sl.ry) * fwd); grp.rotation.y = sl.ry;
        if (m.mount === 'rug') grp.renderOrder = -1;
        roomG.add(grp);
        if ((m.seat || m.stand) && !deskSlot) deskSlot = { sl, m, grp };
      }
    }
    shellMeshes(sh, solid, glowMaterial(), (m) => roomG.add(m));
    // the view behind the windows: one plane covering every opening, the image fitted across it
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const w of L.windows) { bx0 = Math.min(bx0, w.x0); bx1 = Math.max(bx1, w.x1); by0 = Math.min(by0, w.y0); by1 = Math.max(by1, w.y1); }
    bx0 = Math.max(bx0 - 0.3, -L.W / 2); bx1 = Math.min(bx1 + 0.3, L.W / 2);
    const top = Math.min(by1 + 0.12, L.H - 0.04), bot = Math.max(by0 - 0.2, -0.05), pw = bx1 - bx0, ph = top - bot;
    viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: viewTex || paintedSky(hour), toneMapped: false }));
    viewMesh.position.set((bx0 + bx1) / 2, (top + bot) / 2, -L.D / 2 - (L.glassWall ? 0.1 : 0.24)); viewMesh.userData.aspect = pw / ph;
    roomG.add(viewMesh);
    // the figure: asleep in bed, at the desk, or at the window looking out
    if (fig) fig.dispose();
    fig = buildFigure(state.outfit || o.econ?.outfit || 'everyday');
    const st = (state.character && state.character.state) || 'home';
    if (st === 'asleep' && L.bed) {
      const b = L.bed; fig.setPose('sleep'); fig.root.position.set(b.x, (b.platform ? 0.22 : 0) + 0.5, b.z); fig.root.rotation.y = b.ry;
    } else if (deskSlot) {
      const { sl, m } = deskSlot, d = m.seat || m.stand; fig.setPose(m.seat ? 'sit' : 'stand');
      fig.root.position.set(sl.x + Math.sin(sl.ry) * d, 0, sl.z + Math.cos(sl.ry) * d); fig.root.rotation.y = sl.ry + Math.PI;
    } else { fig.setPose('stand'); fig.root.position.set(L.stand.x, 0, L.stand.z); fig.root.rotation.y = Math.PI; }
    roomG.add(fig.root);
    frameCam();
  }
  function frameCam() {
    const w = host.clientWidth || 800, h = host.clientHeight || 500, asp = w / h;
    camera.aspect = asp; camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), need = Math.max((L.W * 0.62) / (t * asp), (L.H * 0.95) / t);
    controls.target.set(-0.2, L.H * 0.42, -0.2);
    camera.position.setFromSphericalCoords(need * 1.02, 1.12, 0.32).add(controls.target);
    controls.minDistance = need * 0.55; controls.maxDistance = need * 1.4; controls.update();
  }
  function draw() { if (disposed || raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!disposed) renderer.render(scene, camera); }); }
  function resize() { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); frameCam(); draw(); }
  const ro = new ResizeObserver(resize); ro.observe(host);
  build(first); resize();

  // the real view out of the window, rendered by the city scene from the home's own spot and floor
  const home = first.h;
  const compass = (dx, dz) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360 / 45) % 8];
  const fl = +home.floor || 0;
  if (o.viewFrom && home && home.x != null) {
    setViewText('Looking out from floor ' + fl + '...');
    const hv = o.homeView ? o.homeView(home) : null, asp = viewMesh.userData.aspect || 1.6;
    const W = Math.round(clamp(asp, 0.8, 3.2) >= 1.6 ? 1280 : 900), H = Math.round(W / clamp(asp, 0.8, 3.2));
    Promise.resolve(o.viewFrom({ ...(hv || {}), home, width: W, height: H, fov: L.glassWall ? 62 : 52 })).then((cv) => {
      if (disposed || !cv) { if (!disposed) setViewText(''); return; }
      viewTex = new THREE.CanvasTexture(cv); viewTex.colorSpace = THREE.SRGBColorSpace;
      if (viewMesh) { viewMesh.material.map?.dispose(); viewMesh.material.map = viewTex; viewMesh.material.needsUpdate = true; }
      const toward = hv && hv.toward ? 'toward ' + hv.toward : hv ? 'looking ' + compass(hv.look[0] - hv.pos[0], hv.look[2] - hv.pos[2]) : '';
      setViewText('The real view from floor ' + fl + (toward ? ', ' + toward : '') + '.');
      draw();
    }).catch(() => setViewText(''));
  } else setViewText('');

  return {
    refill(e) { const h = e.home || cur.h; build({ h, L: layoutOf(h.size), placed: Array.isArray(e.placed) ? e.placed : Array.isArray(h.placed) ? h.placed : cur.placed, items: layoutItemsOf(e) || cur.items, outfit: e.outfit || (e.equipped && e.equipped.outfit) || cur.outfit, character: e.character || cur.character }); draw(); },
    dispose() {
      disposed = true; ro.disconnect(); controls.dispose(); if (raf) cancelAnimationFrame(raf);
      roomG.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); if (m.material && m.material !== solid && m.material !== figureMaterial() && m.material !== glowMaterial()) { m.material.map?.dispose(); m.material.dispose(); } } });
      solid.dispose(); viewTex?.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* fine */ } renderer.domElement.remove();
    },
  };
}

/* ============================================================ the home scene: stage mode (docs/COZY.md 4.1, 4.2, 4.4)
 * mountHomeStage(host, o) -> controller. The persistent apartment at the top of Today (the modal above stays for the city and Home).
 *   host   the [data-js="home-stage"] section; the canvas goes into its [data-js="home-scene"] element (or host itself)
 *   o.layout     GET /api/home/layout (room geometry, catalog, items, storage, budget)      o.econ  GET /api/economy
 *   o.hourFn()   the hour (NYC or local, the `ny` preference)    o.motion() / o.quiet()      o.weather() -> /api/weather
 *   o.api        { get(url), post(url, body) } (Witness.api)      o.cityScene() -> the live city scene (its viewFrom renders the window)
 *   o.announce(text) polite screen-reader line   o.say(text) a visible calm note   o.sfx(name)   o.onChestTap()   o.onDecorate(on)
 * controller: setEconomy(e), setLayout(payload), setWeather(w), react(name) -> Promise, decorate(itemId?, {unbox}) , exitDecorate(),
 *   playChest() -> Promise, setChest(chest | ready), setMissions(m), force(activity | null), relight(), pause(bool), summary(),
 *   refreshView(), dispose(), info() (debug numbers), canvas
 * Render on demand: frames only while something moves (the character's loop at 30 fps, a walk, a reaction, a drag, a tween), none
 * while the tab is hidden or the scene is scrolled away, none at all when idle under reduced motion. */
const BUCKETS = {
  night:   { hemi: [0xffe6c4, 0x2a2250, 1.15], key: [0xffd8a0, 0.75], sun: [0x8cb0ff, 0.22], self: 0.14, lamps: 1, ceil: 1, patch: 0, bg: 'night' },
  morning: { hemi: [0xe8f0ff, 0x8c7f70, 1.9], key: [0xf4f7ff, 1.25], sun: [0xfff0d8, 1.7], self: 0.05, lamps: 0, ceil: 0, patch: 0.5, dir: [-0.55, 1.0], tint: '#fff1d8', bg: 'morning' },
  day:     { hemi: [0xfff6e8, 0x8c7f70, 2.2], key: [0xffffff, 1.6], sun: [0xffffff, 1.3], self: 0.04, lamps: 0, ceil: 0, patch: 0.38, dir: [-0.12, 0.45], tint: '#fff8ea', bg: 'day' },
  golden:  { hemi: [0xffe0bc, 0x7a5a48, 1.75], key: [0xffc890, 1.2], sun: [0xffb46a, 2.0], self: 0.06, lamps: 0.35, ceil: 0, patch: 0.7, dir: [0.75, 1.35], tint: '#ffc27a', bg: 'golden' },
  blue:    { hemi: [0xc8d4ff, 0x2a2250, 1.35], key: [0xffd8a0, 0.85], sun: [0x7f9cff, 0.3], self: 0.1, lamps: 1, ceil: 0.8, patch: 0, bg: 'blue' },
};
export const bucketOf = (h) => (h < 5.5 || h >= 20.75 ? 'night' : h < 9 ? 'morning' : h < 16.5 ? 'day' : h < 18.75 ? 'golden' : 'blue');
// where each activity happens, in the piece's own frame: the seat (or standing spot), which way the figure faces (0 = the piece's front)
const USE = {
  two_seat_sofa: { act: 'read', x: 0.42, z: 0.66, seat: 0.385, ax: 0.42, az: 1.35, face: 0 },
  reading_armchair: { act: 'read', x: 0, z: 0.5, seat: 0.52, ax: 0.7, az: 0.6, face: 0 },
  velvet_armchair: { act: 'read', x: 0, z: 0.52, seat: 0.54, ax: 0, az: 1.3, face: 0 },
  leather_lounge: { act: 'read', x: 0, z: 0.5, seat: 0.52, ax: 0.75, az: 0.55, face: 0 },
  velvet_sectional: { act: 'read', x: -0.45, z: 0.62, seat: 0.54, ax: -0.45, az: 1.5, face: 0 },
  desk_setup: { act: 'work_desk', x: 0, z: 0.95, seat: 0.475, az: 1.5, face: Math.PI },
  marble_desk: { act: 'work_desk', x: 0, z: 1.0, seat: 0.475, az: 1.55, face: Math.PI },
  standing_desk: { act: 'work_desk', x: 0, z: 0.82, mode: 'stand', face: Math.PI, standDesk: true },
  typewriter: { act: 'type', x: 0, z: 0.78, seat: 0.48, az: 1.25, face: Math.PI },
  upright_piano: { act: 'play_piano', x: 0, z: 1.22, seat: 0.48, az: 1.7, face: Math.PI, keys: [0, 0.82, 0.74] },
  grand_piano: { act: 'play_piano', x: 0, z: -0.37, seat: 0.52, az: -0.95, face: 0, keys: [0, 0.84, 0.15] },
  record_player: { act: 'play_records', x: 0, z: 0.95, mode: 'stand', face: Math.PI },
  record_crate: { act: 'browse_records', x: 0, z: 0.78, mode: 'kneel', face: Math.PI },
  brass_telescope: { act: 'stargaze', x: -0.12, z: 1.12, mode: 'stand', face: Math.PI },
  espresso_corner: { act: 'make_tea', x: 0, z: 1.0, mode: 'stand', face: Math.PI },
};
const LAMP_AT = { reading_lamp: [0, 1.42, 0.35], desk_setup: [-0.4, 0.994, 0.36], marble_desk: [-0.58, 1.06, 0.4], brass_desk_clock: [0, 0.9, 0.15] };
const PHRASE = { sofa: 'on the sofa', armchair: 'in the armchair', desk: 'at the desk', piano: 'at the piano', audio: 'by the record player', decor: '', telescope: 'at the telescope', kitchen: 'in the kitchen corner', plant: '' };

function canvasTex(w, h, paint) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function patchTex(nx, ny) {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.72); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.35)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,1)'; x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= nx; i++) x.fillRect((i / nx) * w - 3, 0, 6, h);
    for (let j = 0; j <= ny; j++) x.fillRect(0, (j / ny) * h - 3, w, 6);
  });
}
function glassTex(kind) {
  return canvasTex(256, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    let s = 17; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    if (kind === 'snow') { for (let i = 0; i < 90; i++) { const px = r() * w, py = r() * h, rad = 1 + r() * 2.2; x.fillStyle = 'rgba(255,255,255,' + (0.5 + r() * 0.5) + ')'; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill(); } }
    else { x.lineCap = 'round'; for (let i = 0; i < 70; i++) { const px = r() * w, py = r() * h, l = 10 + r() * 26; x.strokeStyle = 'rgba(210,228,255,' + (0.25 + r() * 0.4) + ')'; x.lineWidth = 1 + r(); x.beginPath(); x.moveTo(px, py); x.lineTo(px - l * 0.12, py + l); x.stroke(); }
      for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(220,235,255,0.55)'; x.beginPath(); x.arc(r() * w, r() * h, 1.5 + r() * 2.5, 0, 7); x.fill(); } }
  });
}
function flashTex(crown) {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); g.addColorStop(0, crown ? 'rgba(255,214,110,1)' : 'rgba(255,240,210,1)'); g.addColorStop(0.35, crown ? 'rgba(255,190,80,0.55)' : 'rgba(255,226,170,0.45)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (crown) { x.fillStyle = 'rgba(255,236,170,1)'; x.beginPath(); x.moveTo(40, 78); x.lineTo(44, 50); x.lineTo(54, 64); x.lineTo(64, 44); x.lineTo(74, 64); x.lineTo(84, 50); x.lineTo(88, 78); x.closePath(); x.fill(); }
  });
}
function buildChest() {
  const g = new Geo(), lid = new Geo(), wood = C('#a8784a'), dark = C('#7b5536'), blue = C('#6fa6d9');
  g.box(-0.26, 0, -0.18, 0.26, 0.26, 0.18, wood); for (const z of [-0.18, 0.165]) g.box(-0.26, 0.02, z, 0.26, 0.05, z + 0.015, dark);
  g.box(-0.04, 0, -0.185, 0.04, 0.27, 0.185, blue); g.box(-0.265, 0, -0.04, 0.265, 0.27, 0.04, blue);
  lid.box(-0.27, 0, 0, 0.27, 0.08, 0.38, shade(wood, 1.08)); lid.box(-0.04, 0.005, -0.004, 0.04, 0.085, 0.384, blue); lid.box(-0.275, 0.005, 0.15, 0.275, 0.085, 0.23, blue);
  lid.box(-0.1, 0.085, 0.13, 0.1, 0.12, 0.25, blue);
  const grp = new THREE.Group(); grp.name = 'chest';
  const base = new THREE.Mesh(g.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const hinge = new THREE.Group(); hinge.position.set(0, 0.26, -0.19); const lm = new THREE.Mesh(lid.build(), base.material); hinge.add(lm);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: flashTex(false), color: 0x9fd0ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.position.y = 0.3; glow.renderOrder = 4;
  const beams = new THREE.Group(); const bm = new THREE.MeshBasicMaterial({ color: 0xffe3a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02 + k * 0.006, 0.09 + k * 0.012, 1.6, 8, 1, true), bm); b.position.set(-0.12 + k * 0.06, 1.05, (k % 2) * 0.06 - 0.03); b.rotation.z = (k - 2) * 0.12; beams.add(b); }
  beams.visible = false;
  grp.add(base, hinge, glow, beams);
  return { grp, hinge, glow, beams, beamMat: bm, dispose() { base.geometry.dispose(); lm.geometry.dispose(); base.material.dispose(); glow.geometry.dispose(); glow.material.map.dispose(); glow.material.dispose(); beams.children.forEach((b) => b.geometry.dispose()); bm.dispose(); } };
}
function buildBox() {
  const g = new Geo(), card = C('#c9a074'), tape = C('#e8dcc0');
  g.box(-0.35, 0, -0.3, 0.35, 0.5, 0.3, card); g.box(-0.36, 0.48, -0.06, 0.36, 0.505, 0.06, tape);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), grp = new THREE.Group(), flaps = [];
  grp.add(new THREE.Mesh(g.build(), mat));
  for (const s of [-1, 1]) {                                                       // two lid flaps hinged on the long edges
    const f = new Geo(); f.box(s < 0 ? 0 : -0.35, 0, -0.3, s < 0 ? 0.35 : 0, 0.02, 0.3, shade(card, 1.06));
    const h = new THREE.Group(); h.position.set(s * 0.35, 0.5, 0); h.add(new THREE.Mesh(f.build(), mat)); grp.add(h); flaps.push({ h, s });
  }
  return { grp, flaps, dispose() { grp.traverse((x) => { if (x.isMesh) x.geometry.dispose(); }); mat.dispose(); } };
}

export function mountHomeStage(host, o = {}) {
  const probe = document.createElement('canvas');
  const can = !o.flat && probe.getContext('webgl2');
  if (!can) return mountFlat(host, o);
  try { return createStage(host, o); } catch (e) { console.warn('home stage', e); return mountFlat(host, o); }
}

function createStage(host, o) {
  const PQ = new URLSearchParams(location.search);
  const sceneEl = host.querySelector('[data-js="home-scene"]') || host;
  const motion = () => (o.motion ? o.motion() !== false : true), quiet = () => !!(o.quiet && o.quiet());
  const touch = matchMedia('(pointer:coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.5 : 2)); renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0; renderer.setClearColor(0x000000, 0);
  // the canvas is the keyboard target (E decorates; decorating takes Tab, the arrows, R, Delete, Ctrl+Z, Esc) and carries the scene's summary.
  // It comes after the docked log bar and the HUD in the DOM, so the log input stays the first thing Tab reaches; CSS layers it underneath.
  const canvas = renderer.domElement; canvas.className = 'homestage__canvas';
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-roledescription', '3D scene'); canvas.setAttribute('aria-keyshortcuts', 'E'); canvas.setAttribute('aria-label', 'Your home.');
  sceneEl.appendChild(canvas);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8c7f70, 2); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(3, 6, 5); scene.add(key);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-1, 4, -6); scene.add(sun);
  const ceil = new THREE.PointLight(0xffd9a8, 0, 9, 1.6); scene.add(ceil);
  const lamps = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffcf8a, 0, 4.5, 1.7); scene.add(l); return l; });
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const shellG = new THREE.Group(), itemsG = new THREE.Group(), fxG = new THREE.Group(); scene.add(shellG, itemsG, fxG);
  const batch = { solid: null, glow: null };
  const recs = new Map();
  let L = LAYOUTS.studio, size = 'studio', walls = roomWalls(L), viewMesh = null, viewTex = null, glass = null, glassKind = '', patches = [], patchKey = '';
  let lay = o.layout || null, econ = o.econ || null, entries = [], catalog = {}, storage = [], budget = 8;
  let disposed = false, paused = false, visible = true, raf = 0, lastT = 0, lastFrame = 0, bucket = '', viewKey = '', viewBusy = false, lot = null;
  let chest = null, chestReady = 0, box = null, decor = null, lastInput = 0, activeItem = null, spinDisc = null;
  const tweens = [];
  const life = createLife({ parent: scene, outfit: 'everyday', motion: motion(), hooks: {
    wake: () => wake(),
    flash: (kind, dur) => flashWindow(kind, dur),
    onActivity: (a, sp) => { activeItem = sp && sp.item; setDisc(a === 'play_records' ? sp.item : null); updateSummary(); if (crew && crew.P) crewSync(); },
    onReact: (name) => { const say = { cheer: 'Your character cheers.', crown: 'Your character celebrates the crown.', output: 'Your character holds up what you shipped.', mission: 'A thumbs-up for the mission.', dance: 'A little dance for three stars.', point: 'Your character points at the window: a new floor on today\'s tower.', chest: 'Your character kneels by the chest.' }[name]; if (say && o.announce) o.announce(say); },
    note: () => pianoNote(),
  } });

  /* ---------------------------------------------------------------- real people (PROOF, docs/PEOPLE-SPEC.md 7): ?people=1 only
   * The user's character from city/people.js stands at the window (idle_look), reads on the sofa (sit_read) or types at the desk (sit_type).
   * Debug: &pose=sit_read|sit_type|idle_look  &tod=night|day|13.5  &cam=close|face|side|front|back|sit-side|sit-front|sit-back  &t=<clip seconds> freezes a frame.
   * If anything fails to load, the code-built figure (character.js) stays. */
  const crew = PQ.get('people') !== '0' ? { P: null, mod: null, lights: null, floorSh: null, seatSh: null, busy: false, failed: false, spots: null, want: '', key: '', dbgCam: PQ.get('cam') || '', frozen: PQ.has('t') } : null;
  if (crew) window.__crew = crew;                                                        // debug handle (proof shots)
  const lifeGrp = { get visible() { return false; }, set visible(v) { life.setHidden(!v); } };
  const getLifeGrp = () => lifeGrp;
  const ALIAS = { desk: 'sit_type', sofa: 'sit_tea', tea: 'sit_tea', read: 'sit_read', window: 'idle_look' };
  const STATE = { sit_type: { clip: 'typing', spot: 'work_desk' }, sit_tea: { clip: 'sit_idle', spot: 'read' }, sit_read: { clip: 'sit_read', spot: 'read' }, idle_look: { clip: 'idle' } };
  const CHAR = 'hariv.glb';
  const poseOf = () => {
    const f = PQ.get('pose'); if (f) return ALIAS[f] || f;
    if (life.macro !== 'home') return null;
    const a = life.activity().id;
    return a === 'read' ? 'sit_read' : (a === 'work_desk' || a === 'type') ? 'sit_type' : a === 'make_tea' ? 'sit_tea' : 'idle_look';   // anything else: Breathing Idle
  };
  async function crewLoad() {
    if (!crew || crew.P || crew.busy || crew.failed || disposed) return;
    crew.busy = true;
    try {
      if (PQ.get('peoplefail')) throw new Error('forced failure (debug)');
      const mod = await import('./mxpeople.js'); const fit = await import('./people_fit.js'); const P = await mod.createMxPerson({ file: CHAR });
      if (disposed) { P.dispose(); return; }
      window.__peopleFit = { fit, crew, report(state) { const R = crew.reports || {}; const t = (state ? [state] : Object.keys(R)).map((k) => R[k].text).join('\n') + (crew.gripText ? '\n' + crew.gripText : ''); console.log(t); return t; }, clearCache: fit.cacheClear, vols: () => crew.vols };
      crew.mod = mod; crew.fit = fit; crew.P = P; crew.lights = mod.makeLighting(scene, renderer); crew.lights.apply();
      crew.floorSh = mod.makeContactShadow(0.95, 0.75, 0.5); crew.seatSh = mod.makeContactShadow(0.5, 0.5, 0.35);
      scene.add(P.root, crew.floorSh, crew.seatSh);
      crewSync(true);
    } catch (e) { console.warn('people: could not load, keeping the figure', e); crew.failed = true; const g = getLifeGrp(); if (g) g.visible = true; draw(); }
    crew.busy = false;
  }
  // where the pose happens: the activity anchor of the furniture (seat height included)
  function crewSpot(pose) {
    const sp = crew.spots || {}, st = STATE[pose] || {};
    if (st.spot === 'read') return sp.read && { ...sp.read, seat: sp.read.seat || 0.385 };
    if (st.spot === 'work_desk') return (sp.work_desk || sp.type) && { ...(sp.work_desk || sp.type), seat: (sp.work_desk || sp.type).seat || 0.475 };
    return sp.look_outside;
  }
  /* ---- clearance + placement (city/people_fit.js, docs/PEOPLE-SPEC.md 10.2) */
  function tagBox(u, r, b, deskTop) {
    const area = (b[3] - b[0]) * (b[5] - b[2]);
    if (u && u.seat != null && Math.abs(b[4] - u.seat) < 0.012 && u.x > b[0] - 0.35 && u.x < b[3] + 0.35 && u.z > b[2] - 0.35 && u.z < b[5] + 0.35) return r.inf.category === 'sofa' || r.inf.category === 'armchair' ? 'seat_soft' : 'seat';
    if (b[1] < 0.001 && b[4] > 0.02 && b[4] < 0.09) return 'footrest';
    if (r.inf.category === 'desk') {
      if (b[4] > 0.68 && b[4] < 0.8 && area > 0.45) return 'desktop';
      if (deskTop && Math.abs(b[1] - deskTop) < 0.006 && b[3] - b[0] > 0.3 && b[5] - b[2] > 0.15 && b[4] - b[1] < 0.03) return 'keyboard';
    }
    return 'other';
  }
  const footTop = (spot) => { const r = spot && recs.get(spot.item); if (!r) return 0; let t = 0; for (const b of r.ig.vols) if (b[1] < 0.001 && b[4] > 0.02 && b[4] < 0.09) t = Math.max(t, b[4]); return t; };   // a footrest under the desk lifts the floor the feet stand on
  function crewVols() {
    const items = [], F = crew.fit;
    for (const r of recs.values()) { if (!r.ig || !r.ig.vols.length || !r.pose) continue; const u = USE[r.id]; let dt = 0; for (const b of r.ig.vols) if (r.inf.category === 'desk' && b[4] > 0.68 && b[4] < 0.8 && (b[3] - b[0]) * (b[5] - b[2]) > 0.45) dt = Math.max(dt, b[4]); items.push({ name: r.id, vols: r.ig.vols, x: r.pose.x, y: r.pose.y || 0, z: r.pose.z, ry: r.pose.ry || 0, tag: (b) => tagBox(u, r, b, dt) }); }
    const extra = [{ name: 'floor', kind: 'floor', b: [-40, -2, -40, 40, 0, 40] }];
    (crew.shellVols || []).forEach((b, i) => { if (b[4] > 0.01) extra.push({ name: 'shell#' + i, kind: b[4] - b[1] > 1.8 ? 'wall' : 'shell', b }); });
    return F.makeVols(items, extra);
  }
  const crewSig = () => [...recs.values()].map((r) => r.id + ':' + (r.pose ? [r.pose.x, r.pose.z, r.pose.ry].map((v) => v.toFixed(2)).join(',') : '')).sort().join('|') + '|' + size;
  function crewCloud(cn) {
    crew.clouds = crew.clouds || {};
    if (!crew.clouds[cn]) { const c = crew.fit.sampleCloud(crew.P, cn, { frames: 24, stride: 4 }); c.face = cn === 'idle' ? 0 : crew.fit.clipFacing(c); crew.clouds[cn] = c; crew.key = ''; }
    return crew.clouds[cn];
  }
  // pelvis centroid of the first frame (root-local), so the pelvis (not the root) lands on the anchor
  function pelvisOf(c) { const a = c.frames[0], G = crew.fit._internals.GI.pelvis; let x = 0, z = 0, n = 0; for (let i = 0; i < c.n; i++) if (c.grp[i] === G) { x += a[i * 3]; z += a[i * 3 + 2]; n++; } return [x / n, z / n]; }
  function crewPlace(pose, spot) {
    const F = crew.fit, P = crew.P, st = STATE[pose], cn = st.clip, cloud = crewCloud(cn), sit = pose.startsWith('sit_');
    crew.reports = crew.reports || {}; crew.solved = crew.solved || {};
    const sig = crewSig(), vols = crew.volsSig === sig && crew.vols ? crew.vols : (crew.vols = crewVols(), crew.volsSig = sig, crew.vols);
    let place, rep, extra = '';
    if (sit) {
      const yaw0 = (spot.yaw || 0) - cloud.face, [px, pz] = pelvisOf(cloud), c = Math.cos(yaw0), s = Math.sin(yaw0);
      let fy = 1e9; { const G = F._internals.GI.foot; for (const a of cloud.frames) for (let i = 0; i < cloud.n; i++) if (cloud.grp[i] === G && a[i * 3 + 1] < fy) fy = a[i * 3 + 1]; }
      const dy = -fy + (footTop(spot) || 0);                                                                   // the lowest foot vertex of the clip rests on the floor (feet flat)
      const base = { x: spot.x - (px * c + pz * s), y: dy, z: spot.z - (-px * s + pz * c), yaw: yaw0 };
      const r = recs.get(spot.item), ry = r ? r.pose.ry : 0, ci = Math.cos(ry), si = Math.sin(ry);
      const key = [spot.item, cn, CHAR, 'v2'].join('|');                                  // per furniture type + clip + character; offsets are in the furniture's frame
      const at = (o) => ({ x: base.x + o.dx * ci + o.dz * si, y: dy + (o.dh || 0), z: base.z - o.dx * si + o.dz * ci, yaw: base.yaw + o.dyaw });
      let off = F.cacheGet(key);
      if (off && !F.evaluate(cloud, at(off), vols).ok) off = null;                        // a cached offset must still pass here, else solve again
      if (!off) {
        const t0 = performance.now(), sol = F.solve(cloud, vols, base, { range: parseFloat(PQ.get('range') || '0.2') });
        const wx = sol.place.x - base.x, wz = sol.place.z - base.z;
        off = { dx: wx * ci - wz * si, dz: wx * si + wz * ci, dyaw: sol.dyaw, dh: sol.dh, ms: Math.round(performance.now() - t0) }; F.cachePut(key, off);
      }
      place = at(off);
      extra = 'anchor=' + spot.item + ' offset=(' + (off.dx * 100).toFixed(0) + ',' + (off.dz * 100).toFixed(0) + ')cm yaw ' + (off.dyaw * 57.3).toFixed(0) + 'deg solve ' + (off.ms ?? 'cached') + 'ms';
    } else {
      const sp = spot, yaw = (sp.yaw || 0), key = ['stand', cn, CHAR, 'v2'].join('|') + sig;
      let st2 = crew.solved[key];
      if (!st2) st2 = crew.solved[key] = F.findStandSpot(cloud, vols, { x: sp.x, z: sp.z }, yaw, { radius: 1.0, bounds: [-L.W / 2 + 0.3, L.W / 2 - 0.3, -L.D / 2 + 0.2, L.D / 2 - 0.3] });
      place = { x: st2.x, y: 0, z: st2.z, yaw }; extra = 'free spot ' + ((Math.hypot(st2.x - sp.x, st2.z - sp.z)) * 100).toFixed(0) + ' cm from the nominal one';
    }
    // the final report on the full cloud (+ props that move with the person)
    const margin = sit ? undefined : (v) => (v.kind === 'wall' ? 0.02 : 0.15);
    const pv = [];
    if (pose === 'sit_read' && crew.book) { const b = crew.book, c = Math.cos(place.yaw), s = Math.sin(place.yaw); pv.push({ name: 'book', kind: 'book', b: crew.fit.BOOK_VOL, x: place.x + b.x * c + b.z * s, y: place.y + b.y, z: place.z - b.x * s + b.z * c, c: Math.cos(place.yaw + b.yaw), s: Math.sin(place.yaw + b.yaw) }); }
    rep = F.evaluate(cloud, place, [...vols, ...F.makeVols([], pv)], { margin });
    crew.reports[pose] = { text: F.formatReport(pose + ' / ' + cn + ' / ' + CHAR + (sit ? '' : '  (standing: furniture margin 15 cm)'), rep, extra), rep, place, extra };
    return place;
  }
  function crewProps(pose) {
    const F = crew.fit, P = crew.P;
    if (pose === 'sit_tea' && !crew.mug) { crew.mug = F.makeMug(); scene.add(crew.mug); }
    if (crew.mug && pose === 'sit_tea') {                                                  // the mug stands on the desk, else on the sofa arm: never in his hand
      const rd = [...recs.values()].find((r) => r.inf.category === 'desk' && r.pose), rs = [...recs.values()].find((r) => r.inf.category === 'sofa' && r.pose);
      const on = rd || rs, c = on ? Math.cos(on.pose.ry) : 1, sn = on ? Math.sin(on.pose.ry) : 0;
      const [lx, ly, lz] = rd ? [0.42, 0.734, 0.12] : rs ? [-((rs.inf.size || [1.7])[0] / 2 - 0.09), 0.6, 0.45] : [0, 0, 0];
      if (on) crew.mug.position.set(on.pose.x + lx * c + lz * sn, ly, on.pose.z - lx * sn + lz * c); else crew.mug.visible = false;
    }
    if (pose === 'sit_read' && !crew.book) {
      const cloud = crewCloud('sit_read'), b = F.bookOnThighs(cloud); crew.book = b; crew.bookObj = F.makeBook(); crew.bookObj.position.set(b.x, b.y, b.z); crew.bookObj.rotation.y = b.yaw; P.root.add(crew.bookObj);
    }
    if (crew.mug && !(pose === 'sit_tea' && crew.mug.position.y > 0)) crew.mug.visible = false; else if (crew.mug) crew.mug.visible = true;
    if (crew.bookObj) crew.bookObj.visible = pose === 'sit_read';
  }
  function crewSync(force) {
    if (!crew || !crew.P || !crew.spots || disposed) return;
    const pose = crew.want = poseOf(), g = getLifeGrp();
    if (!pose) { crew.P.root.visible = false; crew.floorSh.visible = crew.seatSh.visible = false; if (g) g.visible = true; return; }
    let spot = crewSpot(pose), usePose = pose;
    if (!spot && pose !== 'idle_look') { spot = crew.spots.look_outside; usePose = 'idle_look'; }
    if (PQ.get('at') === 'open' && !sit0(usePose)) spot = { x: 0.2, z: 0.95, yaw: 0 };       // debug: stand in the open facing the camera (face close-up)
    if (!spot) { if (g) g.visible = true; return; }
    if (g) g.visible = false;
    const P = crew.P, sit = usePose.startsWith('sit_'), open = PQ.get('at') === 'open';
    P.root.visible = true;
    crewProps(usePose);
    const key = usePose + '@' + spot.x.toFixed(2) + ',' + spot.z.toFixed(2) + ',' + (spot.yaw || 0).toFixed(2) + '|' + crewSig();
    let place;
    if (open) place = { x: spot.x, y: 0, z: spot.z, yaw: 0 }; else place = crewPlace(usePose, spot);
    P.root.position.set(place.x, place.y, place.z); P.root.rotation.y = place.yaw;
    crew.faceOff = (crew.clouds && crew.clouds[STATE[usePose].clip] ? crew.clouds[STATE[usePose].clip].face : 0);   // which way the clip faces, for the debug cameras
    crew.floorSh.position.set(place.x, 0.012, place.z); crew.floorSh.visible = true;
    crew.floorSh.scale.set(sit ? 1.5 : 0.8, sit ? 1.3 : 0.8, 1);
    crew.seatSh.visible = sit; if (sit) crew.seatSh.position.set(place.x, spot.seat + 0.004, place.z - 0.02);
    if (key !== crew.key || force) {
      crew.key = key;
      const cn = STATE[usePose].clip;
      if (motion() && !crew.frozen) P.play(cn, { fade: 0.3, at: 'random' });
      else P.still(cn, crew.frozen ? parseFloat(PQ.get('t')) || 0 : 1);
      P.root.updateMatrixWorld(true);
    }
    crew.lights.place(new THREE.Vector3(place.x, 0, place.z), camera.position); crew.lights.setNight(bucket === 'night' || bucket === 'blue'); crew.lights.aim();
    crewCam(); draw();
  }
  const sit0 = (n) => n.startsWith('sit_');
  const world_win = () => { const w0 = L.windows[0]; return { x: (w0.x0 + w0.x1) / 2, z: -L.D / 2 }; };
  // debug cameras for the proof shots: straight-on face, side of the seated pose, etc. (the orbit limits are lifted while one is on)
  let camSet = '';
  function crewCam() {
    if (!crew || !crew.dbgCam || !crew.P) return;
    if (PQ.get('bare') && !crew.bare) {                       // debug: only the person, a seat slab and a floor, so side/front shots are not blocked by the room
      crew.bare = new THREE.Group(); const gm = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.9 });
      const sp0 = crew.P.root.position, yw = crew.P.root.rotation.y;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.46), gm); const st = crewSpot(crew.want) || { seat: 0.46 };
      seat.position.set(sp0.x, (st.seat || 0.46) - 0.02, sp0.z); seat.rotation.y = yw;
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0xb8aa98, roughness: 1 })); fl.rotation.x = -Math.PI / 2; fl.position.set(sp0.x, 0.001, sp0.z);
      crew.bare.add(seat, fl); scene.add(crew.bare);
    }
    if (crew.bare) { shellG.visible = false; itemsG.visible = false; if (batch.solid) batch.solid.visible = false; if (batch.glow) batch.glow.visible = false; }
    const m = crew.dbgCam, P = crew.P, p = P.root.position, yaw = P.root.rotation.y + (crew.faceOff || 0), fx = Math.sin(yaw), fz = Math.cos(yaw), sit = crew.key.startsWith('sit_');
    const hy = sit ? 1.12 : 1.62;
    const set = (cx, cy, cz, tx, ty, tz, fov) => {
      controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity; controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI; controls.minDistance = 0.2; controls.maxDistance = 30;
      camera.fov = fov || 36; camera.updateProjectionMatrix(); camera.position.set(cx, cy, cz); controls.target.set(tx, ty, tz); camAnim = true; controls.update(); camAnim = false;
    };
    const rx = fz, rz = -fx;                                   // the person's left (facing +z at yaw 0 -> +x is the person's left)
    if (m === 'close') { const t = new THREE.Vector3(p.x, sit ? 0.85 : 0.95, p.z); const c = camera.position.clone().sub(controls.target); set(t.x + 1.7, t.y + 1.15, t.z + 3.4, t.x, t.y, t.z, 34); void c; }
    else if (m === 'face') set(p.x + fx * 1.2, hy + 0.02, p.z + fz * 1.2, p.x, hy - 0.04, p.z, 24);
    else if (m === 'chest') set(p.x + fx * 2.3, 1.3, p.z + fz * 2.3, p.x, 1.28, p.z, 22);
    else if (m === 'sit-side') set(p.x + rx * 3.2, 0.85, p.z + rz * 3.2, p.x, 0.75, p.z, 26);
    else if (m === 'sit-front') set(p.x + fx * 3.0, 1.0, p.z + fz * 3.0, p.x, 0.8, p.z, 26);
    else if (m === 'sit-back') set(p.x - fx * 3.0, 1.15, p.z - fz * 3.0, p.x, 0.8, p.z, 26);
    else if (m === 'hand') { const h = P.boneWorld('RightHand'); set(h.x + rx * 0.9 + fx * 0.5, h.y + 0.15, h.z + rz * 0.9 + fz * 0.5, h.x, h.y, h.z, 24); }
    else if (['keys', 'mug', 'back', 'thighs', 'legs', 'book', 'stand'].includes(m)) {            // close-ups of every contact area (proof crops)
      const B = (k) => P.boneWorld(k), mid = (a, b) => B(a).add(B(b)).multiplyScalar(0.5), V = (x, y, z) => new THREE.Vector3(x, y, z);
      const side = (d) => V(rx * d, 0, rz * d), front = (d) => V(fx * d, 0, fz * d);
      let t, c, fov = 30;
      if (m === 'keys') { t = mid('LeftHand', 'RightHand'); c = t.clone().add(side(-0.6)).add(front(0.5)).add(V(0, 0.38, 0)); fov = 28; }
      else if (m === 'mug') { t = B('RightHand'); c = t.clone().add(side(-0.55)).add(front(0.55)).add(V(0, 0.22, 0)); fov = 22; }
      else if (m === 'back') { t = B('Spine1'); c = t.clone().add(side(0.95)).add(front(-0.45)).add(V(0, 0.15, 0)); fov = 30; }
      else if (m === 'thighs') { t = mid('LeftUpLeg', 'LeftLeg'); c = t.clone().add(side(1.1)).add(V(0, 0.05, 0)); fov = 28; }
      else if (m === 'legs') { t = mid('LeftLeg', 'RightLeg'); c = t.clone().add(front(1.1)).add(V(0, 0.25, 0)); fov = 30; }
      else if (m === 'book') { const bo = crew.bookObj; t = bo ? bo.getWorldPosition(new THREE.Vector3()) : mid('LeftUpLeg', 'RightUpLeg'); c = t.clone().add(side(0.7)).add(front(0.6)).add(V(0, 0.5, 0)); fov = 24; }
      else { t = mid('Hips', 'Spine2'); c = t.clone().add(front(-1.9)).add(side(-0.55)).add(V(0, 0.3, 0)); fov = 40; }
      set(c.x, c.y, c.z, t.x, t.y, t.z, fov);
    }
    else if (m === 'side') set(p.x + rx * 3.2, 1.0, p.z + rz * 3.2, p.x, 0.95, p.z, 28);
  }

  /* ---------------------------------------------------------------- the room */
  function buildRoom(sz) {
    size = LAYOUTS[sz] ? sz : 'studio'; L = LAYOUTS[size]; walls = roomWalls(L);
    for (const ch of [...shellG.children]) { shellG.remove(ch); ch.traverse?.((m) => { if (m.isMesh) { m.geometry.dispose(); if (m.material !== solid && m.material !== glowMaterial()) { m.material.map?.dispose(); m.material.dispose(); } } }); }
    const sh = buildShell(L, rng(size.length * 131 + 9));
    if (crew) crew.shellVols = [...sh.g.vols, ...sh.gw.vols, ...sh.gf.vols, ...sh.gb.vols];
    shellMeshes(sh, solid, glowMaterial(), (m) => shellG.add(m));
    // the view behind the windows: one plane covering every opening
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const w of L.windows) { bx0 = Math.min(bx0, w.x0); bx1 = Math.max(bx1, w.x1); by0 = Math.min(by0, w.y0); by1 = Math.max(by1, w.y1); }
    bx0 = Math.max(bx0 - 0.3, -L.W / 2); bx1 = Math.min(bx1 + 0.3, L.W / 2);
    const top = Math.min(by1 + 0.12, L.H - 0.04), bot = Math.max(by0 - 0.2, -0.05), pw = bx1 - bx0, ph = top - bot;
    viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: viewTex || paintedSky(hourNow()), toneMapped: false }));
    viewMesh.position.set((bx0 + bx1) / 2, (top + bot) / 2, -L.D / 2 - (L.glassWall ? 0.1 : 0.24)); viewMesh.userData = { aspect: pw / ph, pw, ph };
    shellG.add(viewMesh);
    glass = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    glass.position.copy(viewMesh.position); glass.position.z = -L.D / 2 - (L.glassWall ? 0.03 : 0.08); glass.visible = false; glass.renderOrder = 2; glassKind = ''; shellG.add(glass);
    flash.mesh.position.set(viewMesh.position.x, viewMesh.position.y, viewMesh.position.z + 0.02); shellG.add(flash.mesh);
    patchKey = ''; viewKey = ''; viewTex = null;
    frameCam(true);
  }
  const flash = { mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: flashTex(false), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), tower: null, crown: null };
  flash.mesh.visible = false; flash.mesh.renderOrder = 3;

  /* ---------------------------------------------------------------- the pieces */
  const infoOf = (id) => catalog[id] || (lay && (lay.items || []).find((x) => x.id === id)) || null;
  const DYNAMIC = (inf) => inf && inf.category === 'plant';
  function recFor(e) {
    let r = recs.get(e.id); const inf = infoOf(e.id) || { category: '', size: [0.6, 0.6, 1], anchor: [0, 0.3] };
    const wallKey = e.surface === 'wall' ? 'wall' : 'floor';
    if (r && r.kind === wallKey) return r;
    if (r) dropRec(r);
    const built = buildItemGeo(e.id, inf, L, e.surface === 'wall' ? { surface: 'wall', y: 0 } : e);
    const group = new THREE.Group(); group.name = 'item:' + e.id;
    group.add(new THREE.Mesh(built.ig.build(), solid)); if (!built.igl.empty) group.add(new THREE.Mesh(built.igl.build(), glowMaterial()));
    if (built.m.mount === 'rug') group.renderOrder = -1;
    r = { id: e.id, kind: wallKey, inf, ig: built.ig, igl: built.igl, m: built.m, group };
    recs.set(e.id, r); itemsG.add(group);
    if (wallKey === 'floor') swapGLB(r, e.id);
    return r;
  }
  /* the realistic model of a desk, sofa or rug (room/assets/): same footprint, the procedural one shows until it loads and stays if it fails.
   * The procedural boxes stay as the invisible collision volumes (the people solver reads r.ig.vols); only what is drawn changes. */
  function swapGLB(r, id) {
    const c = r.inf.category, sz = r.inf.size || [1, 1, 1], an = r.inf.anchor || [0, sz[1] / 2];
    const kind = id === 'desk_setup' ? 'desk' : (c === 'sofa' && id === 'two_seat_sofa') ? 'sofa' : (c === 'rug' && r.m.mount === 'rug') ? 'rug' : '';
    if (!kind) return;
    const want = kind === 'desk' ? ['desk', 'chair', 'lamp'] : [kind];
    Promise.all(want.map(loadGLB)).then((os) => {
      if (recs.get(id) !== r || disposed) return;
      let parts;
      if (kind === 'desk') {
        const desk = fitGLB(os[0], { h: 0.734, cx: 0, cz: 0.355, w: 1.24, d: 0.62 }), chair = fitGLB(os[1], { h: 0.95, cx: 0, cz: 0.95, ry: Math.PI }), lamp = fitGLB(os[2], { h: 0.42, cx: -0.5, cz: 0.2, y0: 0.734, ry: 0.3 });
        parts = [desk, chair, lamp];
      } else parts = [fitGLB(os[0], { w: sz[0], d: sz[1], cx: an[0], cz: an[1], turn: kind === 'rug', y0: kind === 'rug' ? 0.001 : 0 })];
      const keepIg = r.ig, ig = new Geo(), igl = new Geo(); if (kind === 'desk') r.m.build(ig, igl, rng(strSeed(id) + 7), L.H, { glb: true });
      ig.vols = keepIg.vols; r.ig = ig; r.igl = igl;
      r.group.clear(); r.group.add(new THREE.Mesh(ig.build(), solid)); if (!igl.empty) r.group.add(new THREE.Mesh(igl.build(), glowMaterial()));
      r.glb = new THREE.Group(); parts.forEach((p) => r.glb.add(p)); r.group.add(r.glb); r.group.updateMatrixWorld(true);
      if (batch.solid) bake();
      if (crew) { crew.key = ''; if (crew.P) crewSync(true); }
      draw();
    }).catch((e) => console.warn(id + ': keeping the procedural model', e));
  }
  function dropRec(r) { itemsG.remove(r.group); r.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); recs.delete(r.id); }
  function poseRec(r, e) {
    const pz = entryPose(L, e, r.inf, walls);
    r.group.position.set(pz.x, e.surface === 'wall' ? (+e.y || 1.3) : r.m.mount === 'rug' ? 0.001 : 0, pz.z); r.group.rotation.y = pz.ry; r.pose = { ...pz, y: r.group.position.y };
  }
  function syncItems(list) {
    const keep = new Set(list.map((e) => e.id));
    for (const r of [...recs.values()]) if (!keep.has(r.id)) dropRec(r);
    for (const e of list) poseRec(recFor(e), e);
    itemsG.updateMatrixWorld(true);
  }
  function unbake() { if (batch.solid) { scene.remove(batch.solid, batch.glow); batch.solid.geometry.dispose(); batch.glow?.geometry.dispose(); batch.solid = batch.glow = null; } for (const r of recs.values()) { r.group.visible = true; r.group.children.forEach((ch) => { ch.visible = true; }); } }
  function bake() {
    unbake();
    if (decor && decor.on) return;
    const a = new Geo(), b = new Geo(); let n = 0;
    for (const r of recs.values()) {
      if (DYNAMIC(r.inf) || r.m.mount === 'rug') continue;                                    // plants sway, rugs draw first
      const p = r.pose; a.append(r.ig, p.x, p.y, p.z, p.ry); if (!r.igl.empty) b.append(r.igl, p.x, p.y, p.z, p.ry); if (r.glb) r.group.children.forEach((ch) => { if (ch !== r.glb) ch.visible = false; }); else r.group.visible = false; n++;
    }
    if (!n) return;
    batch.solid = new THREE.Mesh(a.build(), solid); scene.add(batch.solid);
    if (!b.empty) { batch.glow = new THREE.Mesh(b.build(), glowMaterial()); scene.add(batch.glow); }
  }
  function setDisc(itemId) {
    if (spinDisc) { spinDisc.parent?.remove(spinDisc); spinDisc.geometry.dispose(); spinDisc = null; }
    const r = itemId && recs.get(itemId); if (!r || !motion()) return;
    const g = new Geo(); g.cyl(0, 0, 0, 0.012, 0.13, 0.13, 16, C('#15171c')); g.cyl(0, 0, 0.012, 0.016, 0.045, 0.045, 10, C('#c4553f')); g.box(0.07, 0.012, -0.01, 0.12, 0.016, 0.01, C('#f4c977'));
    spinDisc = new THREE.Mesh(g.build(), solid); spinDisc.position.set(-0.04, 0.635, 0.24); r.group.add(spinDisc); r.group.visible = true;
    if (batch.solid) bake();
  }

  /* ---------------------------------------------------------------- where the character goes */
  function computeWorld() {
    const spots = {}, boxes = [], toW = (r, lx, lz) => { const c = Math.cos(r.pose.ry), sn = Math.sin(r.pose.ry); return [r.pose.x + lx * c + lz * sn, r.pose.z - lx * sn + lz * c]; };
    const room = lay && lay.room;
    for (const ob of (room && room.obstacles) || []) boxes.push([ob.x0, ob.x1, ob.z0, ob.z1, ob.kind]);
    const day = new Date().getDate();
    const byAct = {};
    for (const e of entries) {
      const r = recs.get(e.id); if (!r || e.surface === 'wall') continue;
      if (!r.inf.layer) boxes.push([...entryBox(r.inf, e), e.id]);
      const u = USE[e.id];
      if (u) {
        const [x, z] = toW(r, u.x, u.z), [ax, az] = u.az != null ? toW(r, u.ax || u.x, u.az) : [x, z];
        (byAct[u.act] = byAct[u.act] || []).push({ x, z, ax, az, yaw: r.pose.ry + u.face, mode: u.mode || 'sit', seat: u.seat, item: e.id, standDesk: u.standDesk, keys: u.keys ? (() => { const [kx, kz] = toW(r, u.keys[0], u.keys[2]); return [kx, u.keys[1] + 0.1, kz]; })() : null });
      } else if (r.inf.category === 'plant' || r.inf.activity === 'water_plants') {
        const cx = e.x, cz = e.z, side = cx > 0 ? -1 : 1, sx = cx + side * 0.62, sz = cz + 0.25;
        (byAct.water_plants = byAct.water_plants || []).push({ x: sx, z: sz, yaw: Math.atan2(cx - sx, cz - sz), mode: 'stand', item: e.id });
      }
    }
    for (const a in byAct) spots[a] = byAct[a][day % byAct[a].length];
    // tea: the espresso corner, else the studio kitchenette or the penthouse island
    if (!spots.make_tea && L.kitchen) { const k = L.kitchen; spots.make_tea = { x: k.x1 + 0.42, z: (k.z0 + k.z1 - 0.66) / 2, yaw: -Math.PI / 2, mode: 'stand' }; }
    if (!spots.make_tea && L.island) spots.make_tea = { x: L.island.x - 0.3, z: L.island.z - 0.85, yaw: 0, mode: 'stand' };
    // the window: the layout's standing spot, or the nearest free point along the window wall
    const w0 = L.windows[0], inBox = (x, z) => boxes.some((b) => x > b[0] - 0.2 && x < b[1] + 0.2 && z > b[2] - 0.2 && z < b[3] + 0.2);
    let st = { x: L.stand.x, z: L.stand.z };
    if (inBox(st.x, st.z)) { for (let k = 0; k < 40; k++) { const x = (w0.x0 + w0.x1) / 2 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2)) * 0.25, z = -L.D / 2 + 0.55 + Math.floor(k / 16) * 0.4; if (!inBox(x, z) && Math.abs(x) < L.W / 2 - 0.3) { st = { x, z }; break; } } }
    spots.look_outside = { x: st.x, z: st.z, yaw: Math.PI, mode: 'stand' };
    if (L.bed) { const b = L.bed; spots.sleep = { x: b.x, z: b.z, y: (b.platform ? 0.22 : 0) + 0.5, yaw: b.ry, mode: 'bed' }; }
    const winX = (w0.x0 + w0.x1) / 2;
    life.setWorld({ spots, boxes, door: { x: L.W / 2 - 0.45, z: L.D / 2 - 0.35 }, window: { x: winX, z: -L.D / 2 }, camera: () => camera.position, chest: chest && chest.grp.visible ? chestSpot() : null });
    placeLamps();
    if (crew) { crew.spots = spots; if (crew.P) crewSync(); else crewLoad(); }
  }
  function placeLamps() {
    const list = [];
    for (const e of entries) { const r = recs.get(e.id), at = r && LAMP_AT[e.id]; if (!at) continue; const c = Math.cos(r.pose.ry), sn = Math.sin(r.pose.ry); list.push([r.pose.x + at[0] * c + at[2] * sn, at[1], r.pose.z - at[0] * sn + at[2] * c]); }
    for (const e of entries) if (e.id === 'crystal_chandelier') { const r = recs.get(e.id); if (r) list.unshift([r.pose.x, L.H - 0.9, r.pose.z]); }
    lamps.forEach((l, i) => { const p = list[i]; l.userData.on = !!p; if (p) l.position.set(p[0], p[1], p[2]); });
    applyLight(true);
  }

  /* ---------------------------------------------------------------- light by the hour */
  function hourNow() {
    if (PQ.has('tod')) { const t = PQ.get('tod'); const named = { morning: 7.5, day: 13, golden: 17.5, blue: 19.5, night: 23 }; return named[t] != null ? named[t] : (parseFloat(t) || 12); }   // debug: ?tod=night|day|18.5
    try { return o.hourFn ? o.hourFn() : new Date().getHours() + new Date().getMinutes() / 60; } catch { return 12; }
  }
  function applyLight(force) {
    const b = bucketOf(hourNow()), asleep = life.macro === 'asleep';
    if (b === bucket && !force) return false;
    const changed = b !== bucket; bucket = b;
    const B = BUCKETS[b];
    hemi.color.setHex(B.hemi[0]); hemi.groundColor.setHex(B.hemi[1]); hemi.intensity = B.hemi[2] * (asleep ? 0.55 : 1);
    key.color.setHex(B.key[0]); key.intensity = B.key[1] * (asleep ? 0.4 : 1); sun.color.setHex(B.sun[0]); sun.intensity = B.sun[1];
    const k = L.W > 9 ? 1.8 : L.W > 6 ? 1.35 : 1;
    ceil.position.set(0.4, L.H - 0.35, 0); ceil.distance = 7 * k; ceil.intensity = asleep ? 0 : B.ceil * 3.2 * k;
    for (const l of lamps) l.intensity = l.userData.on && !asleep ? B.lamps * 2.6 : (l.userData.on && asleep ? 0.25 : 0);
    setSelfLight(B.self);
    life.setNight(b === 'night' || b === 'blue');
    host.dataset.hour = b; host.dataset.asleep = asleep ? '1' : '0';
    buildPatches(B);
    if (changed) refreshView();
    return true;
  }
  function buildPatches(B) {
    const k = bucket + '|' + size;
    if (k === patchKey) return; patchKey = k;
    for (const p of patches) { fxG.remove(p); p.geometry.dispose(); p.material.map?.dispose(); p.material.dispose(); } patches = [];
    if (!B.patch || L.glassWall && bucket === 'day') return;
    for (const w of L.windows) {
      if (w.x0 < -L.W / 2 + 0.3 && L.partition && w.x1 < L.partition.x) continue;
      const y0 = w.y0, y1 = Math.min(w.y1, w.y0 + 1.8), [dx, dz] = B.dir, bz = -L.D / 2;
      const P = (x, y) => [x + dx * y, 0.012, Math.min(L.D / 2 - 0.1, bz + dz * y)];
      const q = [P(w.x0, y0), P(w.x1, y0), P(w.x1, y1), P(w.x0, y1)];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...q[0], ...q[1], ...q[2], ...q[3]], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 2, 1, 0, 3, 2]);
      const [nx, ny] = w.grid || [1, 1];
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: patchTex(nx, Math.max(1, Math.round(ny * (y1 - y0) / (w.y1 - w.y0)))), color: new THREE.Color(B.tint), transparent: true, opacity: B.patch, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
      m.renderOrder = 1; fxG.add(m); patches.push(m);
    }
  }

  /* ---------------------------------------------------------------- the window: the real city at this hour, re-rendered only when the hour bucket or the weather changes */
  let weather = null, home = null;
  const wxKind = (w) => { const c = String((w && w.condition) || '').toLowerCase(); return /snow|sleet/.test(c) ? 'snow' : /rain|drizzle|storm|shower|thunder/.test(c) ? 'rain' : 'clear'; };
  function setWeather(w) {
    weather = w || null; const kind = wxKind(weather);
    if (glass && kind !== glassKind) {
      glassKind = kind; glass.material.map?.dispose(); glass.material.map = kind === 'clear' ? null : glassTex(kind); glass.material.needsUpdate = true; glass.visible = kind !== 'clear';
      if (glass.material.map) { glass.material.map.wrapS = glass.material.map.wrapT = THREE.RepeatWrapping; glass.material.map.repeat.set(viewMesh.userData.pw / 1.4, viewMesh.userData.ph / 1.4); }
      refreshView(); draw();
    }
  }
  function aimView(sc) {
    const h = home; if (!h || h.x == null || !sc.homeView) return null;
    const hv = sc.homeView(h); if (!hv) return null;
    let l = null;
    try { const H = sc.dbg && sc.dbg.home && sc.dbg.home(); const q = H && H.todayLot && H.todayLot(); if (q) l = { x: q.x, z: q.z, y: (q.g ? q.g.position.y : 0), top: Math.max(8, (q.topY || 10) * (q.gr || 1) * (q.sv || 1)) }; } catch { l = null; }
    const roofAt = sc.dbg && sc.dbg.roofAt;
    if (l && roofAt && Math.hypot(l.x - h.x, l.z - h.z) < 1600 && !/penthouse|parkview|parkavenue|harbor|riverside|highrise/.test(String(h.id))) {
      // the window faces the user's block: step out of the building on that side, look at today's tower
      const eye = hv.pos[1], dx = l.x - h.x, dz = l.z - h.z, D = Math.hypot(dx, dz) || 1, ux = dx / D, uz = dz / D;
      let d = 0; for (; d < 80; d += 2) if (roofAt(h.x + ux * d, h.z + uz * d, 2) < eye - 1) break;
      const pos = [h.x + ux * (d + 1.5), eye, h.z + uz * (d + 1.5)], ly = l.y + l.top * 0.55;
      return { pos, look: [l.x, Math.min(eye, ly), l.z], lotTop: [l.x, l.y + l.top, l.z], toward: 'toward your block' };
    }
    return { ...hv, lotTop: l ? [l.x, l.y + l.top, l.z] : null };
  }
  async function refreshView(force) {
    if (!viewMesh || disposed) return;
    const sc = o.cityScene && o.cityScene();
    const k = bucket + '|' + wxKind(weather) + '|' + (home && home.id) + '|' + size + '|' + (sc ? 'city' : 'paint');
    if (!force && k === viewKey) return;
    if (!sc || !sc.viewFrom) { viewKey = k; setView(paintedSky(hourNow())); return; }
    if (viewBusy) { viewKey = ''; return; }
    viewBusy = true; viewKey = k;
    try {
      const v = aimView(sc), asp = viewMesh.userData.aspect || 1.6;
      if (!v) { setView(paintedSky(hourNow())); return; }
      const fov = L.glassWall ? 62 : 52, W = Math.round(clamp(asp, 0.8, 3.2) >= 1.6 ? 1280 : 900), H = Math.round(W / clamp(asp, 0.8, 3.2));
      const cv = await sc.viewFrom({ pos: v.pos, look: v.look, width: W, height: H, fov, hour: hourNow() });
      if (disposed || !cv) return;
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; setView(t);
      paintBackdrop(sc, v);
      // where today's tower is in that picture: the window flashes it when a floor completes
      lot = null;
      if (v.lotTop) {
        const cam = new THREE.PerspectiveCamera(fov, W / H, 1, 8000); cam.position.set(...v.pos);
        const dir = new THREE.Vector3(v.look[0] - v.pos[0], v.look[1] - v.pos[1], v.look[2] - v.pos[2]).normalize();
        cam.lookAt(cam.position.clone().addScaledVector(dir, 600)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        const p = new THREE.Vector3(...v.lotTop).project(cam);
        if (p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95) lot = { u: p.x * 0.5 + 0.5, v: p.y * 0.5 + 0.5 };
      }
      if (o.onView) o.onView(v.toward || '');
    } catch (e) { console.warn('window view', e); }
    finally { viewBusy = false; if (!viewKey) refreshView(); draw(); }
  }
  // The stage around the cutaway shows the same real view, wider and soft-focused in CSS (.homestage[data-backdrop]),
  // so the room sits in its neighbourhood instead of on a blank backdrop. Painted once per hour bucket / weather / home.
  async function paintBackdrop(sc, v) {
    const stageEl = host.closest('.homestage') || host;
    try {
      const w = sceneEl.clientWidth || 1280, h = sceneEl.clientHeight || 640, asp = clamp(w / h, 0.6, 3.2);
      const W = asp >= 1 ? 1280 : Math.round(1280 * asp), H = Math.round(W / asp);
      const cv = await sc.viewFrom({ pos: v.pos, look: v.look, width: W, height: H, fov: 72, wait: 900, hour: hourNow() });
      if (disposed || !cv) return;
      stageEl.style.setProperty('--home-backdrop', `url("${cv.toDataURL('image/jpeg', 0.82)}")`);
      stageEl.dataset.backdrop = '1';
    } catch (e) { /* the hour gradient stays */ }
  }
  function setView(tex) { if (!viewMesh) return; const old = viewMesh.material.map; viewMesh.material.map = tex; viewMesh.material.needsUpdate = true; if (old && old !== tex) old.dispose(); viewTex = tex; draw(); }
  function flashWindow(kind, dur = 1.6) {
    if (!viewMesh) return;
    const crown = kind === 'crown', m = flash.mesh, U = viewMesh.userData;
    m.material.map?.dispose(); m.material.map = flashTex(crown); m.material.needsUpdate = true;
    const s = lot ? Math.min(U.pw, U.ph) * 0.55 : Math.min(U.pw, U.ph) * 1.2;
    m.scale.set(s, s, 1);
    m.position.set(viewMesh.position.x + (lot ? (lot.u - 0.5) * U.pw : 0), viewMesh.position.y + (lot ? (lot.v - 0.5) * U.ph : 0), viewMesh.position.z + 0.03);
    m.visible = true;
    if (!motion()) { m.material.opacity = 0.8; draw(); setTimeout(() => { m.visible = false; draw(); }, dur * 1000); return; }
    tween(dur, (t) => { m.material.opacity = Math.sin(Math.min(1, t) * Math.PI) * (0.65 + 0.35 * Math.sin(t * 18)); }, () => { m.visible = false; });
  }

  /* ---------------------------------------------------------------- the chest (docs/COZY.md 4.6): a crate with a Columbia-blue ribbon */
  function chestSpot() { const p = chest.grp.position; return { x: p.x, z: p.z, ax: p.x, az: p.z + 0.62, yaw: Math.PI }; }
  let chestPlaying = false, chestLater = null;
  function setChest(n) {
    if (n && typeof n === 'object') n = n.ready;
    if (chestPlaying) { chestLater = n; return; }                                   // the crate stays until its lid and beams finish
    chestReady = quiet() ? 0 : Math.max(0, +n || 0);
    if (chestReady && !chest) { chest = buildChest(); scene.add(chest.grp); }
    if (!chest) return;
    if (chestReady) {
      const room = lay && lay.room;
      if (room) {
        const fake = { chest_box: { size: [0.6, 0.45, 0.4], anchor: [0, 0], name: 'Chest' } };
        const cat2 = { ...catalog, ...fake }; const e = placeNear({ ...room, walls: {} }, cat2, 'chest_box', entries.filter((x) => x.surface !== 'wall'), [0.7, L.D / 2 - 0.9]);
        if (e) chest.grp.position.set(e.x, 0, e.z); else chest.grp.position.set(0.6, 0, L.D / 2 - 0.6);
      }
      chest.grp.visible = true; chest.hinge.rotation.x = 0; chest.beams.visible = false;
    } else chest.grp.visible = false;
    computeWorld(); updateSummary(); draw();
  }
  function playChest() {
    if (!chest || !chest.grp.visible || chestPlaying) return Promise.resolve(false);
    chestPlaying = true;
    const done = (v) => { setTimeout(() => { chestPlaying = false; if (chestLater != null) { const n = chestLater; chestLater = null; setChest(n); } }, motion() ? 900 : 1200); return v; };
    if (!motion()) { chest.hinge.rotation.x = -1.9; draw(); return Promise.resolve(true).then(done); }
    const p = life.position(), c = chestSpot(), home2 = life.macro === 'home' || life.macro === 'walking_home';
    const wait = p && home2 ? Math.hypot(p.x - c.ax, p.z - c.az) / 2.1 + 0.45 : 0;
    if (home2) life.react('chest');
    return new Promise((res) => setTimeout(() => {
      tween(0.3, (t) => { const k = Math.min(1, t / 0.3); chest.hinge.rotation.x = -1.9 * (1 - Math.pow(1 - k, 3)) - 0.15 * Math.sin(k * Math.PI); });
      chest.beams.visible = true;
      tween(1.6, (t) => { const k = Math.min(1, t / 1.6); chest.beamMat.opacity = Math.sin(k * Math.PI) * 0.55; chest.beams.scale.set(1, 0.3 + 0.7 * Math.min(1, k * 3), 1); chest.beams.rotation.y = k * 0.8; }, () => { chest.beams.visible = false; res(true); });
    }, wait * 1000)).then(done);
  }

  /* ---------------------------------------------------------------- the camera: a 3/4 cutaway, +-30 degrees of yaw, 10-35 degrees of pitch, limited zoom, a slow drift home after 20 s */
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false; controls.enableDamping = false; controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.6; controls.enableZoom = false;
  const DEF = { theta: 0.3, phi: 1.13 }, TGT_Y = 0.3;
  controls.minAzimuthAngle = DEF.theta - 0.52; controls.maxAzimuthAngle = DEF.theta + 0.52; controls.minPolarAngle = 0.96; controls.maxPolarAngle = 1.4;
  let need = 8, camAnim = false;
  controls.addEventListener('change', () => { if (!camAnim) lastInput = performance.now(); draw(); });
  const setTouchAction = () => { canvas.style.touchAction = decor && decor.on ? 'none' : 'pan-y'; };
  function frameCam(reset) {
    const w = sceneEl.clientWidth || 800, h = sceneEl.clientHeight || 450, asp = w / h;
    camera.aspect = asp; camera.updateProjectionMatrix();
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // narrow (phone): the near corners stick out more; wide (laptop, tablet): frame tighter so the room fills more of the stage
    need = Math.max((L.W * (asp < 1.3 ? 1.36 : 1.1)) / (2 * t * asp), (L.H * (asp > 1.5 ? 0.84 : 1.12)) / t, 4);
    controls.minDistance = need * 0.42; controls.maxDistance = need * 1.3;
    if (reset) { controls.target.set(-0.1, L.H * TGT_Y, 0.1); camera.position.setFromSphericalCoords(need, DEF.phi, DEF.theta).add(controls.target); }
    else { const off = camera.position.clone().sub(controls.target); off.setLength(clamp(off.length(), controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(off); }
    camAnim = true; controls.update(); camAnim = false;
  }
  function flyCam(target, dist, theta, phi, dur = 1.2) {
    const t0 = controls.target.clone(), s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const t1 = target.clone(), s1 = new THREE.Spherical(dist, phi ?? s0.phi, theta ?? s0.theta);
    if (!motion()) { controls.target.copy(t1); camera.position.setFromSpherical(s1).add(t1); camAnim = true; controls.update(); camAnim = false; draw(); return; }
    tween(dur, (t) => {
      const k = 1 - Math.pow(1 - Math.min(1, t / dur), 3);
      controls.target.lerpVectors(t0, t1, k);
      camera.position.setFromSphericalCoords(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k).add(controls.target);
      camAnim = true; controls.update(); camAnim = false;
    });
  }
  const atHome = () => { const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); return Math.abs(s.theta - DEF.theta) < 0.01 && Math.abs(s.phi - DEF.phi) < 0.01 && Math.abs(s.radius - need) < 0.05 && controls.target.distanceTo(new THREE.Vector3(-0.1, L.H * TGT_Y, 0.1)) < 0.02; };
  function driftHome() { if (!motion() || (decor && decor.on) || atHome()) return; flyCam(new THREE.Vector3(-0.1, L.H * TGT_Y, 0.1), need, DEF.theta, DEF.phi, 2.4); }
  // the wheel zooms only with Ctrl/Cmd (or while decorating), so scrolling the page past the scene still scrolls
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey || (decor && decor.on))) return;
    e.preventDefault();
    const off = camera.position.clone().sub(controls.target), l = clamp(off.length() * (e.deltaY > 0 ? 1.08 : 0.92), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(off.setLength(l)); lastInput = performance.now(); camAnim = true; controls.update(); camAnim = false; draw();
  }, { passive: false });

  // taps: the chest opens, a double tap or double click frames a piece (or goes back to the whole room)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null, lastTap = 0;
  function rayAt(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pickItem(e) {
    rayAt(e); let best = null;
    for (const r of recs.values()) { const h = ray.intersectObject(r.group, true); if (h.length && (!best || h[0].distance < best.d)) best = { r, d: h[0].distance }; }
    return best && best.r;
  }
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; lastInput = performance.now(); });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) { downAt = null; return; }
    downAt = null;
    if (decor && decor.on) return;
    if (chest && chest.grp.visible) { rayAt(e); if (ray.intersectObject(chest.grp, true).length) { if (o.onChestTap) o.onChestTap(); else host.dispatchEvent(new CustomEvent('cozy:chest-tap', { bubbles: true })); return; } }
    const now = performance.now();
    if (now - lastTap < 320) { lastTap = 0; frameAt(e); } else lastTap = now;
  });
  function frameAt(e) {
    const r = pickItem(e);
    if (!r) { flyCam(new THREE.Vector3(-0.1, L.H * TGT_Y, 0.1), need, DEF.theta, DEF.phi); return; }
    const sz = r.inf.size || [1, 1, 1], b = new THREE.Box3().setFromObject(r.group), c = b.getCenter(new THREE.Vector3());
    flyCam(c, clamp(Math.max(sz[0], sz[2]) * 3.2, controls.minDistance, need * 0.85));
  }

  /* ---------------------------------------------------------------- the frame loop */
  function running() { return !disposed && !paused && !document.hidden && visible; }
  function wake() { if (!raf && running()) raf = requestAnimationFrame(frame); }
  function draw() { wake(); }
  function tween(dur, fn, done) { tweens.push({ t: 0, dur, fn, done }); wake(); }
  function frame(now) {
    raf = 0; if (!running()) return;
    const minGap = touch ? 32 : 31;                                                         // 30 fps while animating
    if (lastFrame && now - lastFrame < minGap) { raf = requestAnimationFrame(frame); return; }
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 30; lastT = now; lastFrame = now;
    let anim = false;
    if (life.update(dt)) anim = true;
    if (crew && crew.P && crew.P.root.visible && !crew.frozen && motion()) { crew.P.update(dt); anim = true; }
    for (let i = tweens.length - 1; i >= 0; i--) { const tw = tweens[i]; tw.t += dt; tw.fn(tw.t); if (tw.t >= tw.dur) { tweens.splice(i, 1); tw.done && tw.done(); } }
    if (tweens.length) anim = true;
    if (motion()) {
      if (spinDisc) { spinDisc.rotation.y += dt * 3.5; }
      const ar = activeItem && recs.get(activeItem);
      if (ar && DYNAMIC(ar.inf)) { ar.group.rotation.z = 0.02 * Math.sin(now / 420); }
      if (glass && glass.visible && glass.material.map) { glass.material.map.offset.y += dt * (glassKind === 'snow' ? 0.04 : 0.22); glass.material.map.offset.x += dt * (glassKind === 'snow' ? 0.012 : 0.0); anim = true; }
      if (chest && chest.grp.visible) { chest.glow.material.opacity = 0.32 + 0.18 * Math.sin(now / 380); chest.glow.lookAt(camera.position); anim = true; }
      if (performance.now() - lastInput > 20000 && lastInput) { lastInput = 0; driftHome(); }
    } else if (chest && chest.grp.visible) chest.glow.lookAt(camera.position);
    renderer.render(scene, camera);
    if (anim && motion()) raf = requestAnimationFrame(frame); else { lastT = 0; lastFrame = 0; }
  }
  function resize() { const w = sceneEl.clientWidth, h = sceneEl.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); frameCam(false); draw(); }
  const ro = new ResizeObserver(() => resize()); ro.observe(sceneEl);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) wake(); }, { threshold: 0.02 }) : null;
  io && io.observe(sceneEl);
  const onVis = () => { if (!document.hidden) { lastT = 0; wake(); } };
  document.addEventListener('visibilitychange', onVis);
  // a still frame now and then: the activity moves on, the hour changes (this is the only clock when motion is reduced)
  const tick = setInterval(() => {
    if (awakeUntil && Date.now() >= awakeUntil) { awakeUntil = 0; if (econ) setEconomy({ character: econ.character || {} }); }
    if (!running()) return; applyLight(false); wake(); maybeYawn();
  }, 15000);

  /* ---------------------------------------------------------------- reactions, yawns, the summary */
  let lastYawn = 0, awakeUntil = 0;
  function maybeYawn() {
    const h = new Date().getHours();
    if ((h >= 23 || h < 4) && life.macro === 'home' && !life.busy && !(decor && decor.on) && Date.now() - lastYawn > 600000) { lastYawn = Date.now(); life.react('yawn'); }
  }
  function updateSummary() {
    const el = sceneEl, h = (econ && econ.home) || home || {};
    const where = 'Your ' + homeWord(size) + (h.address ? ' at ' + h.address : '') + '.';
    let who = '';
    if (life.macro === 'studying') { const sp = econ && econ.character && econ.character.spot; who = "You're out studying" + (sp && sp.name ? ' at ' + sp.name : '') + '.'; }
    else if (life.macro === 'asleep') who = "You're asleep.";
    else { const a = life.activity(); if (a.label) { const inf = a.item && infoOf(a.item), ph = inf && PHRASE[inf.category]; who = "You're " + a.label + (ph && (a.id === 'read' || a.id === 'type') ? ' ' + ph : '') + '.'; } }
    const m = econ && econ.missions, bits = [where, who];
    if (!quiet() && m && m.enabled && m.total) bits.push('Missions ' + m.done + ' of ' + m.total + '.');
    if (!quiet() && chestReady) bits.push(chestReady > 1 ? chestReady + ' chests are ready.' : 'A chest is ready.');
    const text = bits.filter(Boolean).join(' ');
    const label = text + (decor && decor.on ? ' Decorating: Tab picks a piece, the arrows move it, R turns it, Delete stores it, Escape finishes.' : ' Press E to decorate.');
    if (canvas.getAttribute('aria-label') !== label) canvas.setAttribute('aria-label', label);
    void el;
    const away = host.querySelector('[data-js="home-away"]');
    if (away) { away.hidden = life.macro !== 'studying'; if (!away.hidden) away.textContent = who; }
    return text;
  }
  let audio = null, lastNote = 0;
  function pianoNote() {
    if (!o.soundOn || !o.soundOn() || !visible || document.hidden) return;
    const now = performance.now(); if (now - lastNote < 850) return; lastNote = now;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') return;
      const f = [261.6, 293.7, 329.6, 392, 440, 523.3][Math.floor(Math.random() * 6)], t = audio.currentTime, osc = audio.createOscillator(), g = audio.createGain();
      osc.type = 'sine'; osc.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.018, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(g).connect(audio.destination); osc.start(t); osc.stop(t + 1.2);
    } catch { /* no sound */ }
  }

  /* ---------------------------------------------------------------- data in */
  const clean = (e) => (e.surface === 'wall' ? { id: e.id, surface: 'wall', wall: e.wall, u: +e.u, y: +e.y } : { id: e.id, surface: 'floor', x: +e.x, z: +e.z, ry: +e.ry || 0 });
  function setLayout(p, opts = {}) {
    if (!p || p.ok === false) return;
    lay = p;
    const sz = (p.room && p.room.size) || (p.home && p.home.size) || size;
    catalog = { ...(p.catalog || {}) };
    for (const it of p.items || []) if (!catalog[it.id]) catalog[it.id] = it;
    storage = p.storage || []; budget = +(p.home && p.home.budget) || budget;
    if (sz !== size || !viewMesh) { for (const r of [...recs.values()]) dropRec(r); buildRoom(sz); }
    if (!(decor && decor.on) || opts.force) { entries = (p.items || []).map(clean); syncItems(entries); bake(); }
    computeWorld(); applyLight(true); setWeather(weather); updateSummary(); draw();
    if (decor) decor.refresh();
  }
  function setEconomy(e) {
    if (!e || e.ok === false) return;
    econ = { ...(econ || {}), ...e };
    const h = e.home; if (h && h.x != null) { const moved = !home || home.id !== h.id; home = h; if (moved) refreshView(true); }
    const outfit = (e.equipped && e.equipped.outfit) || e.outfit; if (outfit) life.wear(outfit);
    const ch = e.character || {}, hint = ch.activity_hint;
    if (hint && Array.isArray(hint.activities)) life.setActivities(hint.activities);
    let macro = (hint && hint.macro) || ch.state || 'home';
    if (macro === 'asleep' && Date.now() < awakeUntil) macro = 'home';               // just logged past the cutoff: up for a while
    const was = life.macro; life.setMacro(macro);
    if (was !== life.macro) applyLight(true);
    if (e.chest) setChest(e.chest.ready);
    updateSummary(); wake();
  }

  /* ---------------------------------------------------------------- decorating (city/decorate.js) */
  const thumbs = new Map();
  function thumb(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    const p = new Promise((res) => {
      try {
        const inf = infoOf(id) || {}, built = buildItemGeo(id, inf, L, inf.surface === 'wall' ? { surface: 'wall', y: 0 } : { surface: 'floor' });
        const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xfff6e8, 0x8c7f70, 2.4)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(2, 4, 5); sc.add(dl);
        const g = new THREE.Group(); const m1 = new THREE.Mesh(built.ig.build(), solid); g.add(m1); let m2 = null; if (!built.igl.empty) { m2 = new THREE.Mesh(built.igl.build(), glowMaterial()); g.add(m2); } sc.add(g);
        const bb = new THREE.Box3().setFromObject(g), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()), r = Math.max(sz.x, sz.y, sz.z) * 0.95 + 0.1;
        const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 50); cam.position.set(c.x + r * 1.1, c.y + r * 0.8, c.z + r * 2.0); cam.lookAt(c);
        const W = 160, H = 120, rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 }), px = new Uint8Array(W * H * 4);
        const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px); renderer.setRenderTarget(prev);
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx2 = cv.getContext('2d'), img = ctx2.createImageData(W, H);
        const enc = (v) => { const x = v / 255; return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4; img.data[d] = enc(px[s]); img.data[d + 1] = enc(px[s + 1]); img.data[d + 2] = enc(px[s + 2]); img.data[d + 3] = px[s + 3]; }
        ctx2.putImageData(img, 0, 0);
        rt.dispose(); m1.geometry.dispose(); m2?.geometry.dispose();
        res(cv.toDataURL('image/png'));
      } catch (e) { res(null); }
    });
    thumbs.set(id, p); return p;
  }
  function squash(id) {
    const r = recs.get(id); if (!r || !motion()) return;
    const g = r.group;
    tween(0.12, (t) => { const k = Math.min(1, t / 0.12), y = k < 0.5 ? 1 - 0.15 * Math.sin(k * Math.PI) : 1 + 0.06 * Math.sin((k - 0.5) * 2 * Math.PI) * (1 - k); g.scale.set(1 + (1 - y) * 0.4, y, 1 + (1 - y) * 0.4); }, () => g.scale.set(1, 1, 1));
  }
  function getDecor() {
    if (decor) return decor;
    decor = createDecorator({
      THREE, host: sceneEl, canvas, camera, controls, scene,
      motion, requestRender: draw, sfx: o.sfx,
      state: () => ({ room: { ...(lay && lay.room), size }, catalog, entries, storage, budget }),
      setEntries(list, opt = {}) {
        const before = new Set(entries.map((x) => x.id));
        entries = list.map(clean); syncItems(entries);
        // what is left out goes to storage (the server confirms on save)
        const ids = new Set(entries.map((x) => x.id));
        for (const id of before) if (!ids.has(id) && !storage.find((s) => s.item === id)) { const inf = infoOf(id) || {}; storage = storage.concat([{ item: id, name: inf.name || id, category: inf.category, size: inf.size, surface: inf.surface }]); }
        storage = storage.filter((s) => !ids.has(s.item));
        computeWorld(); if (opt.animate) squash(opt.animate); draw();
      },
      previewEntry(e) { const r = recs.get(e.id); if (r) { poseRec(r, e); draw(); } },
      groupOf: (id) => recs.get(id) && recs.get(id).group,
      save: (list) => (o.api ? o.api.post('/api/home/layout', { items: list }) : Promise.resolve({ ok: true })).then((res) => { if (res && res.ok !== false) { lay = res; storage = res.storage || storage; budget = +(res.home && res.home.budget) || budget; catalog = { ...catalog, ...(res.catalog || {}) }; if (o.onSaved) o.onSaved(res); } return res; }),
      thumb,
      onExit() { flyCam(new THREE.Vector3(-0.1, L.H * TGT_Y, 0.1), need, DEF.theta, DEF.phi, 0.6); bake(); setTouchAction(); o.onDecorate && o.onDecorate(false); computeWorld(); updateSummary(); try { canvas.focus({ preventScroll: true }); } catch { /* fine */ } },
    });
    return decor;
  }
  function decorate(itemId, opt = {}) {
    if (!lay) return false;
    const d = getDecor(); unbake();
    const fresh = itemId && !entries.find((x) => x.id === itemId);
    d.enter(itemId || null, { animate: !opt.unbox });
    flyCam(new THREE.Vector3(-0.1, L.H * 0.12, 0.25), need * 1.06, DEF.theta, 0.98, 0.6);
    setTouchAction(); o.onDecorate && o.onDecorate(true);
    if (fresh && opt.unbox && motion()) unboxAt(itemId);
    try { canvas.focus({ preventScroll: true }); } catch { /* fine */ }
    updateSummary();
    return true;
  }
  function unboxAt(id) {
    const r = recs.get(id); if (!r) return;
    if (!box) { box = buildBox(); scene.add(box.grp); }
    const p = r.group.position, g = r.group; box.grp.visible = true; box.grp.position.set(r.pose.x, 2.6, r.pose.z); box.grp.scale.set(1, 1, 1); box.flaps.forEach((f) => { f.h.rotation.z = 0; });
    g.scale.set(0.01, 0.01, 0.01);
    tween(0.3, (t) => { const k = Math.min(1, t / 0.3); box.grp.position.y = 2.6 * (1 - k * k); }, () => {
      tween(0.18, (t) => { const k = Math.min(1, t / 0.18); box.flaps.forEach((f) => { f.h.rotation.z = f.s * -2.2 * k; }); }, () => {
        tween(0.3, (t) => { const k = Math.min(1, t / 0.3), s = k < 0.7 ? 0.2 + 1.0 * (k / 0.7) : 1.2 - 0.2 * ((k - 0.7) / 0.3); g.scale.set(s, s, s); box.grp.scale.setScalar(1 - k); }, () => { g.scale.set(1, 1, 1); box.grp.visible = false; });
      });
    });
    if (o.sfx) o.sfx('tick'); void p;
  }
  // keyboard on the scene: E decorates, and decorating takes the keys (Tab, arrows, R, Delete, Ctrl+Z, Esc)
  // (keys typed into the docked log bar or pressed on a HUD button are theirs; Esc still leaves decorating from the toolbar)
  sceneEl.addEventListener('keydown', (e) => {
    const onCanvas = e.target === canvas, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (decor && decor.on) { if (onCanvas || (e.key === 'Escape' && !typing)) decor.key(e); return; }
    if (onCanvas && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); decorate(); }
  });

  /* ---------------------------------------------------------------- start */
  buildRoom((o.layout && o.layout.room && o.layout.room.size) || (o.econ && o.econ.home && o.econ.home.size) || 'studio');
  setTouchAction();
  if (o.econ) setEconomy(o.econ);
  if (o.layout) setLayout(o.layout);
  if (o.weather) setWeather(o.weather());
  resize();
  host.classList.add('is-3d');

  return {
    setEconomy, setLayout, setWeather, setChest, playChest,
    setMissions(m) { if (m && typeof m === 'object') { econ = { ...(econ || {}), missions: m }; updateSummary(); } },
    get canvas() { return canvas; },
    react: (name) => {
      // something the user just did while the character sleeps (a log past the cutoff): they get up for ten minutes, then go back to bed
      if (life.macro === 'asleep' && !/^(wave|yawn)$/.test(name)) { awakeUntil = Date.now() + 10 * 60000; life.setMacro('home'); applyLight(true); updateSummary(); }
      const p = life.react(name); wake(); return p;
    },
    force: (a) => { const ok = life.force(a); wake(); return ok; },
    decorate, exitDecorate: () => decor && decor.exit(), get decorating() { return !!(decor && decor.on); },
    refreshView: () => refreshView(true), summary: updateSummary,
    relight: () => { applyLight(true); draw(); },                                   // the hour source changed (NYC / local), or a test set it
    pause(p) { paused = !!p; if (!paused) { lastT = 0; wake(); } },
    setMotion(m) { life.setMotion(m); if (!m) { tweens.splice(0).forEach((t) => { t.fn(t.dur); t.done && t.done(); }); setDisc(null); } wake(); },
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, size, items: entries.length, activity: life.activity(), macro: life.macro, bucket, decorating: !!(decor && decor.on), lot, view: viewKey }),
    life, renderNow: () => { renderer.render(scene, camera); },
    dispose() {
      disposed = true; clearInterval(tick); ro.disconnect(); io && io.disconnect(); document.removeEventListener('visibilitychange', onVis); if (raf) cancelAnimationFrame(raf);
      decor && decor.dispose(); if (crew && crew.P) { crew.P.dispose(); crew.lights && crew.lights.dispose(); } life.dispose(); chest && chest.dispose(); box && box.dispose(); unbake();
      for (const r of [...recs.values()]) dropRec(r);
      scene.traverse((m) => { if (m.isMesh && m.geometry) { m.geometry.dispose(); if (m.material && m.material !== solid && m.material !== figureMaterial() && m.material !== glowMaterial()) { m.material.map?.dispose(); m.material.dispose(); } } });
      solid.dispose(); controls.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* fine */ } canvas.remove(); host.classList.remove('is-3d');
    },
  };
}

/* ------------------------------------------------------------ no WebGL (or 3D off): an illustrated 2D apartment card, the pieces listed, a plain list to decorate */
function mountFlat(host, o) {
  const sceneEl = host.querySelector('[data-js="home-scene"]') || host;
  const card = document.createElement('div'); card.className = 'homeflat';
  sceneEl.appendChild(card); host.classList.add('is-flat');
  // cozy.js paints the illustrated apartment (inline SVG, the pieces listed) when the scene says it has no WebGL; this card then only
  // carries the decorating list (storage toggles). Without cozy.js the card draws its own illustration.
  sceneEl.classList.add('no-webgl');
  const cozyFlat = () => sceneEl.querySelector('[data-js="home-flat"]');
  let lay = o.layout || null, econ = o.econ || null, listMode = false;
  function svg() {
    const p = lay || {}, room = p.room || { W: 5, D: 4, H: 2.9, windows: [{ x0: 0.1, x1: 1.6, y0: 0.85, y1: 2.45 }] }, items = p.items || [];
    const W = 600, Hh = 250, sx = (x) => ((x + room.W / 2) / room.W) * 520 + 40, floorY = 200, sy = (y) => floorY - (y / room.H) * 170;
    const h = (o.hourFn ? o.hourFn() : 12), b = bucketOf(h), sky = { night: '#0d2140', blue: '#2b4a86', golden: '#f2a65a', morning: '#9fc6ea', day: '#8cc4ee' }[b];
    let s = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" role="img" aria-label="An illustration of your ' + homeWord(room.size) + '"><rect x="40" y="25" width="520" height="175" rx="6" fill="#e9e1d2"/><rect x="40" y="200" width="520" height="30" rx="4" fill="#9a6b47"/>';
    for (const w of room.windows || []) s += '<rect x="' + sx(w.x0).toFixed(1) + '" y="' + sy(w.y1).toFixed(1) + '" width="' + (sx(w.x1) - sx(w.x0)).toFixed(1) + '" height="' + (sy(w.y0) - sy(w.y1)).toFixed(1) + '" fill="' + sky + '" stroke="#f4f1ea" stroke-width="4"/>';
    const cols = { sofa: '#3f7f86', armchair: '#b4553a', desk: '#9a6a44', shelf: '#7b5536', plant: '#3f8f5e', lamp: '#efe2c6', rug: '#b9774f', audio: '#7b5536', piano: '#3a2418', art: '#15171c', wall: '#5b4128', telescope: '#c9a14a', kitchen: '#2f4d6e', decor: '#c9a14a' };
    for (const e of items) {
      const c = cols[e.category] || '#8a6a48', sz = e.size || [0.8, 0.5, 0.9];
      if (e.surface === 'wall') { const wl = room.walls && room.walls[e.wall]; if (!wl || e.wall !== 'n') continue; const a = wl.lo + e.u * (wl.hi - wl.lo); s += '<rect x="' + sx(a - sz[0] / 2).toFixed(1) + '" y="' + sy(e.y + sz[2]).toFixed(1) + '" width="' + (sz[0] / room.W * 520).toFixed(1) + '" height="' + (sz[2] / room.H * 170).toFixed(1) + '" rx="2" fill="' + c + '"/>'; continue; }
      if (e.layer === 'under') { s += '<rect x="' + sx(e.x - sz[0] / 2).toFixed(1) + '" y="203" width="' + (sz[0] / room.W * 520).toFixed(1) + '" height="10" rx="4" fill="' + c + '"/>'; continue; }
      const hh = Math.min(sz[2], room.H - 0.2) / room.H * 170, ww = Math.max(sz[0], 0.3) / room.W * 520;
      s += '<rect x="' + (sx(e.x) - ww / 2).toFixed(1) + '" y="' + (floorY - hh + 6).toFixed(1) + '" width="' + ww.toFixed(1) + '" height="' + hh.toFixed(1) + '" rx="6" fill="' + c + '" opacity="0.92"/>';
    }
    return s + '</svg>';
  }
  const esc2 = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function render() {
    const p = lay || {}, items = p.items || [], st = p.storage || [], other = cozyFlat();
    card.hidden = !!other && !listMode; card.classList.toggle('is-list', listMode);
    if (card.hidden) { card.innerHTML = ''; return; }
    card.innerHTML = (other ? '' : svg()) +
      '<div class="homeflat__list"><p class="homeflat__cap">' + esc2(p.capacity_text || '') + '</p>' +
      '<h3 class="homeflat__h">In the room</h3><ul>' + (items.length ? items.map((e) => '<li><span>' + esc2(e.name || e.id) + '</span>' + (listMode ? '<button type="button" class="homeflat__btn" data-flat-out="' + esc2(e.id) + '">Store</button>' : '') + '</li>').join('') : '<li>Nothing out yet.</li>') + '</ul>' +
      (st.length ? '<h3 class="homeflat__h">In storage</h3><ul>' + st.map((x) => '<li><span>' + esc2(x.name || x.item) + '</span>' + (listMode ? '<button type="button" class="homeflat__btn" data-flat-in="' + esc2(x.item) + '">Put it out</button>' : '') + '</li>').join('') + '</ul>' : '') +
      (listMode ? '<button type="button" class="homeflat__btn homeflat__done" data-flat-done>Done</button>' : '') + '</div>';
  }
  async function equip(id, on) {
    if (!o.api) return;
    const res = await o.api.post('/api/equip', { kind: 'furniture', item: id, on }).catch(() => null);
    if (res && res.ok === false && o.say) o.say(res.hint || 'That did not change.');
    const fresh = await o.api.get('/api/home/layout').catch(() => null);
    if (fresh && fresh.ok !== false) lay = fresh; render();
  }
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.flatOut) equip(b.dataset.flatOut, false);
    else if (b.dataset.flatIn) equip(b.dataset.flatIn, true);
    else if (b.hasAttribute('data-flat-done')) { listMode = false; render(); o.onDecorate && o.onDecorate(false); }
  });
  render(); setTimeout(render, 0);
  const summary = () => { const h = (econ && econ.home) || {}; const t = 'Your ' + homeWord((lay && lay.room && lay.room.size) || h.size) + (h.address ? ' at ' + h.address : '') + '. ' + ((lay && lay.items) || []).length + ' pieces out.'; sceneEl.setAttribute('aria-label', t); return t; };
  summary();
  return {
    flat: true,
    setEconomy(e) { econ = e || econ; summary(); }, setLayout(p) { if (p && p.ok !== false) { lay = p; render(); summary(); } }, setWeather() {}, setChest() {},
    playChest: () => Promise.resolve(false), react: () => Promise.resolve(false),
    decorate() { listMode = true; render(); o.onDecorate && o.onDecorate(true); const b = card.querySelector('button'); b && b.focus(); return true; }, exitDecorate() { listMode = false; render(); }, get decorating() { return listMode; },
    refreshView() {}, summary, pause() {}, setMotion() {}, info: () => ({ flat: true }), dispose() { card.remove(); host.classList.remove('is-flat'); },
  };
}
