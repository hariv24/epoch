// city/world/street.js · the walkable street on the slice-0 engine (docs/WORLD.md 12.2, 12.3). Slice 1: W 123rd St, Lenox <-> ACP, both faces, previewed
// from fixed "photographer" cameras (?street=preview). Geometry is generated in a Web Worker (street_worker.js + kit.js, no `three` there) as typed arrays;
// this file turns them into BufferGeometry / InstancedMesh in small time-sliced steps (no main-thread task > 100 ms), warms the shaders with
// renderer.compileAsync (render.js warm) before the first frame, and draws on demand.
//
//   mountStreet(host, { hour, cam, season, shot, onReady }) -> api | null
//   api: { cams, setCam(name), setHour(h), info(), ready (Promise), collide, renderer, scene, camera, dispose() }
//   URL (home_today.js): ?street=preview [&cam=fig2|fig1|fig14|east|west] [&hour=11] [&shot=1]       debug (?debug=1): window.__street, window.__perf
// Interior-mapped windows: one quad per window, a fragment shader ray-casts a procedural room behind it (back wall, side walls, floor, ceiling, a picture or
// bookshelf, curtains or blinds, a lit lamp at night by seed), then the glass reflection and the sash bars. Every other part is an InstancedMesh per type.
// Look pass (10-31): Poly Haven CC0 maps (assets/tex, scripts/world/street_tex.py), dark reflective glass with painted sashes and muntins, the real sun for
// NYC's date and clock (EDT/EST + equation of time), soft shadows, haze, and EZ-Tree street trees (vendor/ez-tree, MIT) baked into 5 variants and instanced.
import * as THREE from 'three';
import { createRenderer, createLoop, createAdaptiveDpr, installPerf, addRoomEnvironment, warm } from './render.js';
import { createTextures, rng } from './textures.js';
import { Tree } from './vendor/ez-tree/tree.js';
import { patchFade, fadeFrag, FADE, FADE_DECL, unitMat, disposeUnit } from './fade.js';
import { SIGN_CELLS } from './kit.js';
import { autumnLeaves, treeTint } from './foliage.js';
import { SIGN_STYLES } from './landmarks.js';

// slice 3: the window shader with the near-tier distance dither (fade.js); the sign atlas (generic shop words; the Apollo and the 125 St board by name)
const winFade = (vs, fs) => ({ vs: vs.replace('void main() {', 'varying float vFD;\nvoid main() {').replace('gl_Position = projectionMatrix * mvPosition;', 'gl_Position = projectionMatrix * mvPosition; vFD = length(mvPosition.xyz);'), fs: fs.replace('void main() {', FADE_DECL + 'void main() {\n' + fadeFrag('near')) });
// slice 3 step 2: the sign atlas, 2 columns x NR rows of 512 x 64 cells (SIGN_CELLS, landmarks.js). A sign instance picks its cell with aPar.x and the used share of the
// cell's width with aPar.y (square symbols use the left 64 px). Shops: generic words in 3 colour styles each; named text only for the LPC landmarks + the subway board.
function signAtlas() {
  const N = SIGN_CELLS.length, NR = Math.ceil(N / 2), c = document.createElement('canvas'); c.width = 1024; c.height = 64 * NR; const g = c.getContext('2d');
  const font = (px, w = 800, fam = '"Helvetica Neue", Helvetica, Arial, sans-serif') => `${w} ${px}px ${fam}`;
  const fit = (txt, maxW, px, w, fam) => { let f = px; g.font = font(f, w, fam); while (g.measureText(txt).width > maxW && f > 12) { f -= 2; g.font = font(f, w, fam); } return f; };
  SIGN_CELLS.forEach((cell, i) => {
    const x = (i % 2) * 512, y = (NR - 1 - Math.floor(i / 2)) * 64; g.save(); g.beginPath(); g.rect(x, y, 512, 64); g.clip(); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (cell.kind === 'shop') {
      const [bg, fg] = SIGN_STYLES[cell.st]; g.fillStyle = bg; g.fillRect(x, y, 512, 64);
      g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(x + 5, y + 5, 502, 54); g.globalAlpha = 1;
      fit(cell.w, 470, 42); g.fillStyle = fg; g.fillText(cell.w, x + 256, y + 34);
    } else if (cell.kind === 'apollo') {                                       // the marquee crown (296 px used): red neon letters on cream
      g.fillStyle = '#f2d98e'; g.fillRect(x, y, 512, 64); fit('APOLLO', 270, 54, 900, 'Georgia, "Times New Roman", serif');
      g.lineWidth = 7; g.strokeStyle = '#8c0f0f'; g.strokeText('APOLLO', x + 148, y + 35); g.fillStyle = '#e21f1f'; g.fillText('APOLLO', x + 148, y + 35);
      g.lineWidth = 1.6; g.strokeStyle = '#ffd88a'; g.strokeText('APOLLO', x + 148, y + 35);
    } else if (cell.kind === 'blade') {                                        // the vertical blade: letters drawn turned 90 degrees, bottom (left) to top (right): O L L O P A
      g.fillStyle = '#f2d98e'; g.fillRect(x, y, 512, 64); const L = 'OLLOPA'; g.font = font(60, 900, 'Georgia, "Times New Roman", serif');
      for (let k = 0; k < 6; k++) { g.save(); g.translate(x + 43 + k * 85, y + 33); g.rotate(Math.PI / 2); g.lineWidth = 7; g.strokeStyle = '#8c0f0f'; g.strokeText(L[k], 0, 0); g.fillStyle = '#e21f1f'; g.fillText(L[k], 0, 0); g.lineWidth = 1.6; g.strokeStyle = '#ffd88a'; g.strokeText(L[k], 0, 0); g.restore(); }
    } else if (cell.kind === 'board') {                                        // the marquee's letter boards: abstract white letter blocks (no readable text)
      g.fillStyle = '#0c0c0e'; g.fillRect(x, y, 512, 64); g.fillStyle = '#f4f1e8'; let r = 7;
      for (const yy of [10, 27, 44]) { let xx = 24 + (r % 5) * 6; while (xx < 488) { r = (r * 1103515245 + 12345) >>> 0; const wl = 3 + (r % 7); for (let k = 0; k < wl && xx < 488; k++) { g.fillRect(x + xx, y + yy, 5, 10); xx += 7; } xx += 10; } }
    } else if (cell.kind === 'sub') {                                          // the station board (282 px used): "125 St" + the red 2 and 3 bullets
      g.fillStyle = '#111113'; g.fillRect(x, y, 512, 64); g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.font = font(36, 700); g.fillText('125 St', x + 12, y + 34);
      for (const [k, d] of [[0, '2'], [1, '3']]) { const cx = x + 190 + k * 44; g.fillStyle = '#ee352e'; g.beginPath(); g.arc(cx, y + 32, 19, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = font(28, 700); g.fillText(d, cx, y + 34); }
      g.fillStyle = '#ffffff'; g.fillRect(x + 6, y + 4, 270, 2);
    } else if (cell.kind === 'walk' || cell.kind === 'hand') {                 // the pedestrian signal symbols (64 x 64)
      g.fillStyle = '#0a0a0a'; g.fillRect(x, y, 512, 64);
      if (cell.kind === 'walk') {
        g.fillStyle = g.strokeStyle = '#f2f4f2'; g.lineCap = 'round'; g.beginPath(); g.arc(x + 34, y + 11, 6, 0, Math.PI * 2); g.fill(); g.lineWidth = 7;
        g.beginPath(); g.moveTo(x + 32, y + 20); g.lineTo(x + 29, y + 38); g.stroke(); g.lineWidth = 5;
        g.beginPath(); g.moveTo(x + 29, y + 37); g.lineTo(x + 21, y + 48); g.lineTo(x + 18, y + 58); g.moveTo(x + 29, y + 37); g.lineTo(x + 37, y + 47); g.lineTo(x + 43, y + 57);
        g.moveTo(x + 32, y + 22); g.lineTo(x + 22, y + 31); g.lineTo(x + 19, y + 38); g.moveTo(x + 32, y + 22); g.lineTo(x + 40, y + 30); g.lineTo(x + 46, y + 33); g.stroke();
      } else {
        g.fillStyle = '#ff7a12'; const r = (a, b, w, h) => { g.beginPath(); g.roundRect ? g.roundRect(x + a, y + b, w, h, 3) : g.rect(x + a, y + b, w, h); g.fill(); };
        r(19, 28, 26, 26); for (let k = 0; k < 4; k++) r(19 + k * 7, 9 + (k === 0 || k === 3 ? 4 : 0), 5.5, 24); g.save(); g.translate(x + 45, y + 38); g.rotate(-0.6); r(-3 - x, -16 - y, 6, 18); g.restore();
      }
    } else if (cell.kind === 'theresa') {                                      // HOTEL THERESA: raised bronze-dark letters on the white terra-cotta
      g.fillStyle = '#ece6d6'; g.fillRect(x, y, 512, 64); fit('HOTEL THERESA', 480, 44, 700, 'Georgia, "Times New Roman", serif'); g.fillStyle = '#5a4630'; g.fillText('HOTEL THERESA', x + 256, y + 35);
    } else { g.fillStyle = '#222'; g.fillRect(x, y, 512, 64); }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { t, N: NR };
}
const D2R = Math.PI / 180;
const DATA = new URL('./data/', import.meta.url);

/* ---- photographer cameras (street frame: x east, z south; the LPC photos were taken from the opposite sidewalk at eye height) */
export const CAMS = {
  fig2: { label: 'Fig. 2 · 124-128 W 123rd', pos: [14.4, 1.55, -8.6], look: [14.4, 5.2, 11], hfov: 56, aspect: 1434 / 1078 },
  fig1: { label: 'Fig. 1 · 107-111 W 123rd', pos: [44.5, 1.55, -2.6], look: [60.0, 8.4, -10.6], hfov: 62, aspect: 1038 / 1582 },
  fig14: { label: 'Fig. 14 · 118-122 W 123rd', pos: [13.0, 1.55, -7.4], look: [31.5, 14.5, 10.6], hfov: 60, aspect: 1108 / 1661 },
  church: { label: '147 W 123rd · St. Paul\'s German Ev. Lutheran (1898)', pos: [-63.0, 1.55, 8.4], look: [-48.5, 17.0, -10.6], hfov: 66, aspect: 3 / 4 },
  east: { label: 'Looking east to Lenox Ave', pos: [-38, 1.6, 4.0], look: [140, 4.0, -2], hfov: 62, aspect: 16 / 9 },
  west: { label: 'Looking west to Adam Clayton Powell Jr Blvd', pos: [38, 1.6, 4.0], look: [-140, 4.0, -2], hfov: 62, aspect: 16 / 9 },
};

/* ---- the street's maps (1 tile = `tile` m; the kit's UVs are metres; the vertex colour carries each building's tint) */
const TEX = new URL('./assets/tex/', import.meta.url);
function maps(T) {
  const m = (name, tile, srgb) => T.tex(new URL(name + '.webp', TEX), { rx: 1 / tile, ry: 1 / tile, srgb });
  const roof = T.canvasTex(128, (c, S, r) => { c.fillStyle = '#e6e6e6'; c.fillRect(0, 0, S, S); for (let i = 0; i < 1500; i++) { const v = Math.round(200 + (r() - 0.5) * 50); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(r() * S, r() * S, 2, 2); } }, 0.5, 0.5, true, 29);
  return {
    brick: [m('brick_diff', 2.5, true), m('brick_nor', 2.5, false)], whitebrick: [m('whitebrick_diff', 2.5, true), m('brick_nor', 2.5, false)],
    stone: [m('stone_diff', 1.2, true), m('stone_nor', 1.2, false)], rock: [m('stone_diff', 0.5, true), m('stone_nor', 0.5, false)], slate: [m('slate_diff', 0.9, true), m('slate_nor', 0.9, false)],
    asphalt: [m('asphalt_diff', 3, true), m('asphalt_nor', 3, false)], sidewalk: [m('sidewalk_diff', 3, true), m('sidewalk_nor', 3, false)], roof: [roof, null],
  };
}

/* ---- the interior-mapped window (one instanced quad per window) */
const WIN_VS = /* glsl */`
attribute vec4 aPar; attribute vec3 aTint;
varying vec3 vP; varying vec3 vC; varying vec2 vSz; varying vec4 vPar; varying vec3 vTint;
#include <fog_pars_vertex>
void main() {
  mat4 im = modelMatrix * instanceMatrix;
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), 1.0);
  vec3 camL = (inverse(im) * vec4(cameraPosition, 1.0)).xyz * sc;
  vP = position * sc; vC = camL; vSz = sc.xy; vPar = aPar; vTint = aTint;
  vec4 mvPosition = viewMatrix * im * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WIN_FS = /* glsl */`
uniform float uNight; uniform vec3 uSkyTop; uniform vec3 uSkyLow; uniform vec3 uOpp; uniform float uAmb;
varying vec3 vP; varying vec3 vC; varying vec2 vSz; varying vec4 vPar; varying vec3 vTint;
#include <fog_pars_fragment>
float h1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
vec3 curtain(float k) { k = floor(k * 7.0); return k < 1.0 ? vec3(.69,.58,.4) : k < 2.0 ? vec3(.56,.4,.27) : k < 3.0 ? vec3(.26,.37,.5) : k < 4.0 ? vec3(.5,.26,.26) : k < 5.0 ? vec3(.79,.75,.66) : k < 6.0 ? vec3(.2,.34,.24) : vec3(.4,.32,.55); }
vec3 wall(float k) { k = floor(k * 5.0); return k < 1.0 ? vec3(.62,.55,.45) : k < 2.0 ? vec3(.38,.5,.4) : k < 3.0 ? vec3(.42,.5,.6) : k < 4.0 ? vec3(.68,.5,.4) : vec3(.66,.6,.4); }
void main() {
  float seed = vPar.x, lit = vPar.y, kind = vPar.w;
  vec2 hs = vSz * 0.5; vec2 uv = vP.xy / vSz + 0.5;
  vec3 ray = normalize(vP - vC);
  // the room behind the pane (ray-cast box: back wall, side walls, floor, ceiling)
  float D = 2.8 + h1(seed * 3.1) * 1.6, RW = hs.x + 0.9 + h1(seed * 5.7) * 0.8, yf = -hs.y - 0.9, yc = yf + 2.75;
  float tx = ray.x > 0.0 ? (RW - vP.x) / ray.x : (-RW - vP.x) / ray.x;
  float ty = ray.y > 0.0 ? (yc - vP.y) / ray.y : (yf - vP.y) / ray.y;
  float tz = (-D - vP.z) / min(ray.z, -1e-4);
  float t = min(min(tx, ty), tz); vec3 hp = vP + ray * t;
  vec3 wc = wall(h1(seed * 7.7)); vec3 col; float shade = 1.0;
  if (t == tz) {
    col = wc; vec2 q = vec2(hp.x / (2.0 * RW) + 0.5, (hp.y - yf) / (yc - yf));
    float f = h1(seed * 11.3);
    if (f < 0.34 && q.x > 0.18 && q.x < 0.5 && q.y > 0.35 && q.y < 0.7) col = mix(vec3(.5,.35,.2), vec3(.2,.3,.45), step(0.5, fract(q.x * 9.0))) * 0.9;
    else if (f < 0.62 && q.x > 0.1 && q.x < 0.45 && q.y > 0.08 && q.y < 0.82) { float bk = h1(floor(q.y * 12.0) * 13.0 + floor(q.x * 30.0)); col = mix(vec3(.28,.17,.1), vec3(.55 + bk * .3, .25 + bk * .2, .2), step(0.45, bk)) * (fract(q.y * 12.0) < 0.1 ? 0.3 : 1.0); }
    shade = 0.95;
  } else if (t == ty) { col = ray.y > 0.0 ? vec3(.8, .78, .72) : vec3(.34, .22, .14) * (0.75 + 0.25 * step(0.5, fract(hp.x * 6.0))); shade = 0.8; }
  else { col = wc * 0.85; shade = 0.75; }
  float isLit = lit * step(0.5, uNight);
  float lamp = exp(-length(vec3(hp.x - (h1(seed * 2.2) - 0.5) * RW, hp.y - (yf + 1.5), hp.z + D * 0.5)) * 0.55);
  float deep = exp(-max(0.0, -hp.z) * 0.35);                         // daylight falls off into the room
  vec3 room = uNight > 0.5 ? (isLit > 0.5 ? col * shade * (0.55 + 1.0 * lamp) * vec3(1.0, 0.78, 0.5) * 1.15 : (h1(seed * 4.4) < 0.1 ? vec3(.05, .1, .18) * (0.5 + col.b) : col * 0.01))
                           : col * shade * (0.03 + 0.11 * deep);       // by day an interior reads dark from the street
  bool shop = kind > 4.5;
  if (shop) {                                                         // slice 3 step 2: a shop: shelves of goods on the back wall, a light floor, fluorescent strips on the ceiling
    vec3 sc;
    if (t == tz) { vec2 q = vec2(hp.x / (2.0 * RW) + 0.5, (hp.y - yf) / (yc - yf)); float row = floor(q.y * 6.0), gk = h1(floor(q.x * 40.0) * 3.7 + row * 11.0 + seed * 5.0);
      vec3 goods = mix(vec3(.62,.3,.26), mix(vec3(.7,.62,.34), vec3(.32,.4,.55), step(0.6, gk)), step(0.35, gk)) * (0.55 + 0.4 * h1(gk * 9.0));
      goods = mix(goods, vec3(dot(goods, vec3(.33))), 0.35);
      float onShelf = step(0.12, q.y) * step(q.y, 0.7) * step(0.3, fract(q.y * 6.0)) * step(0.25, h1(floor(q.x * 6.0) + seed * 3.0));
      sc = mix(wall(h1(seed * 2.9)) * 1.2, goods, onShelf * 0.85); }
    else if (t == ty) sc = ray.y > 0.0 ? vec3(.9) * (0.75 + 0.9 * step(0.82, fract(hp.z * 0.6))) : vec3(.66,.64,.6) * (0.85 + 0.15 * step(0.5, fract(hp.x * 1.6) + fract(hp.z * 1.6) * 0.0));
    else sc = wall(h1(seed * 2.9)) * 1.1;
    room = sc * (uNight > 0.5 ? (lit > 0.5 ? vec3(1.0, 0.97, 0.9) : vec3(0.02)) : vec3(0.2));
  }
  float cw = shop ? 0.0 : h1(seed * 9.1) < 0.55 ? 0.08 + h1(seed * 1.9) * 0.22 : 0.0; vec3 cc = curtain(vPar.z);
  float inCur = step(uv.x, cw) + step(1.0 - cw, uv.x);
  float bl = shop ? 0.0 : h1(seed * 6.3) < 0.28 ? 0.15 + h1(seed * 8.8) * 0.5 : 0.0;
  vec3 nightK = uNight > 0.5 ? (isLit > 0.5 ? vec3(1.0, .8, .52) * 0.8 : vec3(0.012)) : vec3(0.32);
  float folds = 0.78 + 0.22 * sin(uv.x * 90.0);
  room = mix(room, cc * nightK * folds, min(1.0, inCur) * 0.92);
  room = mix(room, vec3(.82, .8, .74) * nightK * (0.8 + 0.2 * step(0.5, fract(uv.y * 28.0))), step(0.001, bl) * step(1.0 - bl, uv.y) * 0.95);
  // the glass: a mirror of the street (sky above the opposite cornices, the opposite facades, the pavement), old-glass wobble, Fresnel
  vec3 r = normalize(vec3(ray.x + sin(uv.y * 19.0 + seed * 40.0) * 0.015, ray.y + sin(uv.x * 13.0 + seed * 9.0) * 0.01, -ray.z));
  float el = r.y / max(0.05, length(r.xz)), sky = 0.5 + 0.25 * h1(floor(r.x * 4.0 + seed * 7.0));
  vec3 opp = uOpp * (0.75 + 0.25 * step(0.5, fract(r.x * 6.0 + 0.3)) * step(0.4, fract(el * 5.0)));
  vec3 refl = el > sky ? mix(uSkyLow, uSkyTop, clamp((el - sky) * 1.4, 0.0, 1.0)) : el > -0.08 ? opp : uOpp * 0.7;
  float F = 0.05 + 0.95 * pow(1.0 - clamp(abs(ray.z), 0.0, 1.0), 5.0);
  col = mix(room, refl, uNight > 0.5 ? 0.06 + F * 0.4 : shop ? clamp(0.16 + F * 1.2, 0.0, 0.75) : clamp(0.3 + F * 1.6, 0.0, 0.9));
  col += uNight > 0.5 ? vec3(0.0) : vec3(1.0, 0.97, 0.9) * 0.6 * pow(max(0.0, 1.0 - abs(el - sky - 0.15) * 3.0), 6.0) * 0.0;
  // sashes: a frame, the meeting rail (double-hung), a vertical muntin in each sash (2-over-2) or a mullion (kind 2, the condos)
  float fw = 0.055; vec2 e = hs - abs(vP.xy); float fr = step(min(e.x, e.y), fw);
  float rail = (kind > 2.5 && kind < 4.5) || kind < 1.5 ? step(abs(vP.y - 0.02), 0.035) : 0.0;
  float mun = kind > 2.5 && kind < 4.5 ? step(abs(vP.x), 0.016) : kind > 1.5 && kind < 2.5 ? step(abs(vP.x), 0.025) : 0.0;
  float edge = step(min(e.x, e.y), fw * 0.35) * 0.35 + step(abs(vP.y - 0.055), 0.008) * 0.3;
  vec3 frameC = vTint * uAmb * (1.0 - edge);
  col = mix(col, frameC, max(fr, max(rail, mun)));
  if (kind > 5.5 && uNight > 0.5) {                                   // a roll-down gate, closed at night: ribbed grey steel, a bottom bar, a little dirt toward the ground
    float rib = 0.7 + 0.3 * smoothstep(0.0, 0.45, abs(fract(vP.y * 8.5) - 0.5));
    col = vec3(0.1, 0.105, 0.115) * rib * (0.6 + 0.4 * smoothstep(-hs.y, hs.y, vP.y)) * (1.0 - 0.35 * step(vP.y, -hs.y + 0.08));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/* ---- the sun for NYC (lat 40.8) on a given day/hour, as a direction in the street frame */
export function sunDir(hour, doy, rot) {
  const lat = 40.81 * D2R, dec = -23.44 * D2R * Math.cos((2 * Math.PI / 365) * (doy + 10)), H = (hour - 12) * 15 * D2R;
  const east = -Math.cos(dec) * Math.sin(H), north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(H) * Math.sin(lat), up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const xc = east, zc = -north;                                         // city frame: x east, z south
  const x = xc * Math.cos(rot) - zc * Math.sin(rot), z = xc * Math.sin(rot) + zc * Math.cos(rot);
  return { dir: new THREE.Vector3(x, up, z).normalize(), elev: Math.asin(up) / D2R };
}

const dayOfYear = (d = new Date()) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
// NYC clock hour -> local solar time (EDT/EST from the tz database, longitude 73.95 W, the equation of time)
export function solarHour(hour, d = new Date()) {
  const B = (2 * Math.PI * (dayOfYear(d) - 81)) / 365, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  let dst = 0; try { dst = /EDT/.test(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).format(d)) ? 1 : 0; } catch { /* no tz data */ }
  return hour - dst + (75 - 73.95) / 15 + eot / 60;
}
const skyTex = (top, low) => { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(0.62, low); g.addColorStop(1, low); x.fillStyle = g; x.fillRect(0, 0, 4, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

export function mountStreet(host, o = {}) {
  performance.mark('street:mount');
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return null;
  const PQ = new URLSearchParams(location.search);
  const sceneEl = host.querySelector('[data-js="home-scene"]') || host;
  if (o.shot || PQ.has('shot')) {
    host.dataset.shot = '1'; Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '9999', borderRadius: '0', margin: '0', border: '0' });
    sceneEl.style.blockSize = '100vh';
    const st = document.createElement('style'); st.textContent = '[data-shot] .homestage__scene > :not(canvas), [data-shot] > :not(.homestage__scene) { display: none !important }'; document.head.appendChild(st);
  }
  const renderer = createRenderer({ alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const canvas = renderer.domElement; canvas.className = 'homestage__canvas street__canvas'; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'West 123rd Street, Harlem, from the sidewalk. Preview.');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  sceneEl.insertBefore(canvas, sceneEl.firstChild); host.classList.add('is-3d');
  const label = document.createElement('p'); label.className = 'street__label'; Object.assign(label.style, { position: 'absolute', left: '12px', bottom: '10px', margin: '0', padding: '4px 10px', font: '600 12px/1.3 system-ui,sans-serif', color: '#fff', background: 'rgba(8,26,51,.72)', borderRadius: '8px', zIndex: 3, pointerEvents: 'none' }); sceneEl.appendChild(label);

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.5, 0.2, 700);
  performance.mark('street:renderer'); addRoomEnvironment(renderer, scene); scene.environmentIntensity = 0.5; performance.mark('street:env');
  const hemi = new THREE.HemisphereLight(0xbcd4ee, 0x6f6a60, 0.8), sun = new THREE.DirectionalLight(0xfff1d6, 2.4); scene.add(hemi, sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3; renderer.shadowMap.autoUpdate = false;
  const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 260;
  const world = new THREE.Group(); scene.add(world);

  const T = createTextures({ onLoad: () => { renderer.shadowMap.needsUpdate = true; kick(); } }), tx = maps(T);
  const std = (p) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...p });
  const tm = (k, p = {}, ns = 1) => std({ map: tx[k][0], normalMap: tx[k][1], normalScale: new THREE.Vector2(ns, ns), ...p });
  const M = {
    brick: tm('brick', { roughness: 0.88 }), whitebrick: tm('whitebrick', { roughness: 0.32, envMapIntensity: 1.2 }, 0.5), brownstone: tm('stone', { roughness: 0.82 }, 0.8),
    limestone: tm('stone', { roughness: 0.78 }, 0.6), stone: tm('stone', { roughness: 0.85 }, 1.0), rock: tm('rock', { roughness: 0.92 }, 1.1), panel: std({ roughness: 0.5, metalness: 0.2 }),
    slate: tm('slate', { roughness: 0.5, envMapIntensity: 0.8 }, 1.2), sidewalk: tm('sidewalk', { roughness: 0.86 }, 0.6), asphalt: tm('asphalt', { roughness: 0.93 }, 0.8),
    roof: std({ map: tx.roof[0] }), paint: std({ roughness: 0.55, side: THREE.DoubleSide }), glass: std({ roughness: 0.12, metalness: 0.0, envMapIntensity: 0.55, emissive: new THREE.Color(0xffc477), emissiveIntensity: 0 }),
    granite: tm('stone', { roughness: 0.6 }, 0.5), grass: std({ map: T.canvasTex(256, (c, S, r) => { c.fillStyle = '#8a9a6a'; c.fillRect(0, 0, S, S); for (let i = 0; i < 9000; i++) { const v = 0.75 + r() * 0.5; c.fillStyle = `rgba(${Math.round(110 * v)},${Math.round(125 * v)},${Math.round(70 * v)},0.6)`; c.fillRect(r() * S, r() * S, 1.5, 3); } for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(${150 + r() * 60},${90 + r() * 40},30,0.55)`; c.fillRect(r() * S, r() * S, 3, 2); } }, 0.33, 0.33, true, 31), roughness: 0.95 }), paintline: std({ roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), tactile: std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  const WF = o.district ? winFade(WIN_VS, WIN_FS) : { vs: WIN_VS, fs: WIN_FS };
  const winMat = new THREE.ShaderMaterial({ vertexShader: WF.vs, fragmentShader: WF.fs, fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...(o.district ? { uFade: FADE.u, uT: FADE.legacy } : {}), uNight: { value: 0 }, uSkyTop: { value: new THREE.Color(0x6fa0d6) }, uSkyLow: { value: new THREE.Color(0xcfe0ee) }, uOpp: { value: new THREE.Color(0x3a2a24) }, uAmb: { value: 0.6 } }, side: THREE.FrontSide });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0.1 });
  const lensMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const poolTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,214,150,0.9)'); g.addColorStop(1, 'rgba(255,214,150,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3 });
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10), pole = new THREE.CylinderGeometry(0.07, 0.12, 1, 8), plane = new THREE.PlaneGeometry(1, 1);
  const PARTS = {
    box_stone: [box, std({ vertexColors: false, roughness: 0.85 }), true], box_iron: [box, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5 }), false], box_metal: [box, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), false],
    box_paint: [box, new THREE.MeshStandardMaterial({ roughness: 0.7 }), false], cyl: [cyl, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), false], pole: [pole, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 }), false],
    lamp: [box, lampMat, false], pool: [plane, poolMat, false], win: [plane, winMat, false],
    lens: [cyl, lensMat, false], lensb: [box, lensMat, false],                                   // signal lenses: unlit, so a lit lens reads lit by day and by night
  };
  PARTS.box_stone[1] = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  let midMat0 = null;
  // slice 3 step 2: the sign atlas (shop words, the landmarks, the subway board, the pedestrian symbols); backlit at night (applyTime)
  const { t: stex, N: sN } = signAtlas();
  const signMat = new THREE.MeshStandardMaterial({ map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.12, roughness: 0.55, side: THREE.DoubleSide });
  signMat.onBeforeCompile = (sh) => { sh.vertexShader = 'attribute vec4 aPar;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n { float cl = mod(aPar.x, 2.0), rw = floor(aPar.x / 2.0 + 0.01); vMapUv = vec2((vMapUv.x * max(aPar.y, 0.01) + cl) / 2.0, (vMapUv.y + rw) / ' + sN.toFixed(1) + '); }\n#endif\n#ifdef USE_EMISSIVEMAP\n vEmissiveMapUv = vMapUv;\n#endif'); };
  signMat.customProgramCacheKey = () => 'street-sign-3';
  PARTS.sign = [plane, signMat, false];
  if (o.district) {                                                    // slice 3: the globe part, the mid-tier materials, the near-tier dither on every shared material
    PARTS.sph = [new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: 0x1f8a46, emissive: 0x2aff6a, emissiveIntensity: 1.4, roughness: 0.3 }), false];
    const R5 = rng(5), R7 = rng(7), atlas = (lit) => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'), r = lit ? R7 : R5;
      g.fillStyle = lit ? '#000' : '#9a5a45'; g.fillRect(0, 0, 512, 512);
      if (!lit) for (let i = 0; i < 3600; i++) { const v = 130 + r() * 50; g.fillStyle = `rgba(${v + 25},${v - 25},${v - 40},0.5)`; g.fillRect(r() * 512, r() * 512, 6, 3); }
      const warm = ['#ffc477', '#ffd79a', '#ffb560', '#f3e2c0'];
      for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) for (const cx of [22, 86]) { const x = bx * 128 + cx, y = by * 128 + 24, w = 26, h = 62;
        if (lit) { if (r() < 0.38) { g.fillStyle = warm[Math.floor(r() * warm.length)]; g.fillRect(x, y, w, h); if (r() < 0.4) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, w, h * (0.2 + r() * 0.5)); } } }
        else { g.fillStyle = '#1d2630'; g.fillRect(x, y, w, h); g.fillStyle = '#d8d2c4'; g.fillRect(x - 3, y + h, w + 6, 5); g.fillRect(x - 3, y - 5, w + 6, 5); g.fillStyle = '#2b333d'; g.fillRect(x + w / 2 - 1, y, 2, h); g.fillRect(x, y + h / 2, w, 2); } }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 13.6, 1 / 13.2); t.colorSpace = lit ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    M.mid = new THREE.MeshStandardMaterial({ map: atlas(false), emissiveMap: atlas(true), emissive: new THREE.Color(0xffc477), emissiveIntensity: 0, roughness: 0.9, vertexColors: true });
    // slice 3 step 2: the mid tier's untextured solids (roofs, bands, the park, the landmark masses) ride in the same mesh with uv.x < -500: no atlas, no lit windows
    M.mid.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n if (vMapUv.x > -500.0) {\n #include <map_fragment>\n }\n#endif').replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n if (vMapUv.x > -500.0) {\n #include <emissivemap_fragment>\n } else totalEmissiveRadiance = vec3(0.0);\n#endif'); };
    M.mid.customProgramCacheKey = () => 'mid-solid-uv';
    PARTS.box_any = [box, new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.12 }), false];
    M.midsolid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); midMat0 = M.mid;
    for (const k of Object.keys(M)) if (k !== 'asphalt' && k !== 'mid' && k !== 'midsolid') patchFade(M[k], 'near');
    for (const k of Object.keys(PARTS)) if (k !== 'win') patchFade(PARTS[k][1], 'near');
    patchFade(M.mid, 'mid'); patchFade(M.midsolid, 'mid');
  }

  /* ---- the worker's messages become meshes, a few per slice */
  const queue = [], meshes = [], info = { tris: 0, instances: 0, workerMs: 0, buildings: 0, sliceMax: 0, slices: 0, parts: 0 };
  let carsApi = null, collide = null, worker = null, disposed = false, built = false, doneAt = 0;
  function addMesh(m, grp, keep) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1)); g.computeBoundingSphere();
    const bm = M[m.mat] || M.paint, mesh = new THREE.Mesh(g, grp && grp.userData.fade ? unitMat(bm, grp.userData.fade) : bm); const ground = m.mat === 'asphalt' || m.mat === 'sidewalk';
    mesh.castShadow = !ground && m.mat !== 'paintline' && m.mat !== 'tactile' && m.tier !== 'm'; mesh.receiveShadow = m.tier !== 'm'; mesh.matrixAutoUpdate = false; (grp || world).add(mesh); (keep || meshes).push(mesh); info.tris += m.idx.length / 3; info.parts++; return mesh;
  }
  function addInst(m, grp, keep) {
    let [geo, mat, tinted] = PARTS[m.part] || PARTS.box_paint; const n = m.cols.length / 3;
    if (grp && (m.part === 'win' || m.part === 'sign')) geo = geo.clone();                         // the per-instance attributes live on the geometry: one clone per unit
    const im = new THREE.InstancedMesh(geo, grp && grp.userData.fade ? unitMat(mat, grp.userData.fade) : mat, n); im.instanceMatrix.array.set(m.mats); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    if (m.part === 'win') { geo.setAttribute('aPar', new THREE.InstancedBufferAttribute(m.par, 4)); geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(m.cols, 3)); }
    else if (m.part === 'sign') geo.setAttribute('aPar', new THREE.InstancedBufferAttribute(m.par, 4));
    else im.instanceColor = new THREE.InstancedBufferAttribute(m.cols, 3);
    im.castShadow = m.part === 'box_stone' || m.part === 'box_iron' || m.part === 'pole' || m.part === 'box_metal' || m.part === 'box_any'; im.receiveShadow = m.part !== 'pool'; if (m.tier === 'm') { im.castShadow = false; im.receiveShadow = false; } if (grp) { im.frustumCulled = true; im.computeBoundingSphere(); } (grp || world).add(im); (keep || meshes).push(im);
    info.instances += n; info.tris += n * (geo.index ? geo.index.count / 3 : 2); info.parts++; return im;
  }
  function pump() {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) { const m = queue.shift(); if (m.t === 'mesh') addMesh(m); else if (m.t === 'inst') addInst(m); }
    const dt = performance.now() - t0; info.sliceMax = Math.max(info.sliceMax, dt); info.slices++;
    if (queue.length) setTimeout(pump, 0); else if (doneAt && !built) finish();
  }
  let resolveReady; const ready = new Promise((r) => { resolveReady = r; });
  function finish() {
    built = true; performance.mark('street:built'); blades(); if (o.walk && !o.district) midTier();
    plantTrees().then(plantParked).then(upload).then(() => { renderer.shadowMap.needsUpdate = true; return warm(renderer, scene, camera); }).then(prewarm).then(() => { if (!disposed) { performance.mark('street:ready'); resolveReady(api); loop.kick(); } });
  }

  /* ---- slice 2 (docs/WORLD.md 13.2): the mid tier, flat facades with a window grid (no 3-D detail): the far sides of both avenues and the avenue frontages beyond the block,
     so the corners do not end in an empty horizon. One merged mesh, a canvas map for the brick + window grid and an emissive map for the lit windows at night. */
  /* ---- street-name blades (kit.js avenues + the corner posts): NYC green, white border and text, both faces; one merged mesh over a 3-row text atlas */
  let bladeList = [];
  function blades() {
    if (!bladeList.length) return;
    const TXT = ['W 123 St', 'Malcolm X Blvd', 'Adam Clayton Powell Jr Blvd'], c = document.createElement('canvas'); c.width = 1024; c.height = 384; const g = c.getContext('2d');
    TXT.forEach((t, i) => { const y = i * 128; g.fillStyle = '#0d6b3a'; g.fillRect(0, y, 1024, 128); g.strokeStyle = '#f4f4ee'; g.lineWidth = 7; g.strokeRect(9, y + 9, 1006, 110);
      g.fillStyle = '#f4f4ee'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 84; g.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`; while (g.measureText(t).width > 960 && fs > 30) { fs -= 4; g.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`; } g.fillText(t, 512, y + 68); });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const pos = [], uv = [], nrm = [], idx = []; let vi = 0;
    for (const [x, y, z, ax, len, row] of bladeList) {
      const v0 = 1 - (row + 1) / 3, v1 = 1 - row / 3, h = 0.24, alongX = ax === 'x';
      for (const side of [1, -1]) {                                                 // one face each way, text left-to-right from both
        const n = alongX ? [0, 0, side] : [side, 0, 0], off = 0.012 * side, a = -len / 2, b = len / 2;
        const P = (u, yy) => (alongX ? [x + u * side, yy, z + off] : [x + off, yy, z - u * side]);
        for (const p of [P(a, y - h / 2), P(b, y - h / 2), P(b, y + h / 2), P(a, y + h / 2)]) { pos.push(...p); nrm.push(...n); }
        uv.push(0, v0, 1, v0, 1, v1, 0, v1); idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 })); m.matrixAutoUpdate = false; m.castShadow = true;
    world.add(m); meshes.push(m); info.tris += idx.length / 3; info.parts++; info.blades = bladeList.length;
  }
  let midMat = midMat0;
  function midTier() {
    const st = (S0 => S0)(o.street || null); void st;
    const R = rng(4242), cell = [13.6, 13.2];                          // one map tile = 4 x 4 window bays (3.4 x 3.3 m each): lit windows no longer repeat every bay at night
    const mk = (lit) => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'), r = rng(lit ? 7 : 5);
      g.fillStyle = lit ? '#000' : '#9a5a45'; g.fillRect(0, 0, 512, 512);
      if (!lit) for (let i = 0; i < 3600; i++) { const v = 130 + r() * 50; g.fillStyle = `rgba(${v + 25},${v - 25},${v - 40},0.5)`; g.fillRect(r() * 512, r() * 512, 6, 3); }
      const warm = ['#ffc477', '#ffd79a', '#ffb560', '#f3e2c0'];
      for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) for (const cx of [22, 86]) {
        const x = bx * 128 + cx, y = by * 128 + 24, w = 26, h = 62;
        if (lit) { if (r() < 0.38) { g.fillStyle = warm[Math.floor(r() * warm.length)]; g.fillRect(x, y, w, h); if (r() < 0.4) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y, w, h * (0.2 + r() * 0.5)); } } }
        else { g.fillStyle = '#1d2630'; g.fillRect(x, y, w, h); g.fillStyle = '#d8d2c4'; g.fillRect(x - 3, y + h, w + 6, 5); g.fillRect(x - 3, y - 5, w + 6, 5); g.fillStyle = '#2b333d'; g.fillRect(x + w / 2 - 1, y, 2, h); g.fillRect(x, y + h / 2, w, 2); }
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = lit ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    midMat = new THREE.MeshStandardMaterial({ map: mk(false), emissiveMap: mk(true), emissive: new THREE.Color(0xffc477), emissiveIntensity: 0, roughness: 0.9, vertexColors: true });
    const pos = [], nrm = [], uv = [], col = [], idx = [], idxS = []; let vi = 0;
    const quad = (p0, p1, p2, p3, n, u, v, c, solid) => { for (const p of [p0, p1, p2, p3]) { pos.push(...p); nrm.push(...n); col.push(...c); } uv.push(0, 0, u, 0, u, v, 0, v); (solid ? idxS : idx).push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4; };
    const box = (x0, x1, z0, z1, h, c) => {
      quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], (x1 - x0) / cell[0], h / cell[1], c); quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], (x1 - x0) / cell[0], h / cell[1], c);
      quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], (z1 - z0) / cell[0], h / cell[1], c); quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], (z1 - z0) / cell[0], h / cell[1], c);
      quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], 0.01, 0.01, [0.45, 0.43, 0.4], true);
    };
    // the street face of a mid-tier building: a projecting cornice band and, on the avenues, a shopfront (dark glass, a coloured awning); flat, vertex-coloured, no map
    const face = (ax, f, a, b, n, h, shop, rr) => {
      const P = (u, y, d) => (ax === 'x' ? [f + n * d, y, u] : [u, y, f + n * d]), N = ax === 'x' ? [n, 0, 0] : [0, 0, n];
      const q = (u0, u1, y0, y1, d, c) => { const ps = [P(u0, y0, d), P(u1, y0, d), P(u1, y1, d), P(u0, y1, d)]; if ((ax === 'x') === (n > 0)) ps.reverse(); quad(ps[0], ps[1], ps[2], ps[3], N, 1, 1, c, true); };
      const cc = [0.32, 0.29, 0.27]; q(a, b, h - 0.75, h, 0.32, cc); q(a, b, h - 0.95, h - 0.75, 0.16, mulc(cc, 0.8));
      if (!shop) { q(a + 0.25, b - 0.25, 0, 0.9, 0.04, [0.42, 0.36, 0.32]); return; }
      const aw = AWN[Math.floor(rr * AWN.length)];
      for (let u = a + 0.3; u < b - 0.6; u += 6.5) { const e = Math.min(b - 0.3, u + 6.0); q(u, e, 0.35, 3.3, 0.05, [0.07, 0.085, 0.1]); q(u, e, 3.3, 3.85, 0.55, aw); }
      q(a, b, 3.85, 4.4, 0.06, [0.18, 0.17, 0.16]);
    };
    const AWN = [[0.55, 0.1, 0.1], [0.1, 0.32, 0.18], [0.12, 0.2, 0.42], [0.42, 0.12, 0.2], [0.6, 0.45, 0.12]], mulc = (c, k) => c.map((v) => v * k);
    const tones = [[1, 0.95, 0.9], [0.92, 0.86, 0.8], [0.85, 0.8, 0.78], [1.05, 0.9, 0.82], [0.8, 0.82, 0.86]];
    const rowTones = [[0.66, 0.52, 0.46], [0.6, 0.47, 0.42], [1, 0.95, 0.9], [0.9, 0.78, 0.72], [1.08, 1.0, 0.86], [0.72, 0.6, 0.55]];
    // along an avenue: buildings stacked in z, their street face at x = fx (n = the way it looks)
    const run = (xa, xb, z0, z1, fx, n) => { let z = z0; while (z < z1 - 8) { const w = Math.min(z1 - z, 14 + R() * 14), h = 17 + Math.floor(R() * 6) * 3.3; box(xa, xb, z, z + w, h, tones[Math.floor(R() * tones.length)]); face('x', fx, z, z + w, n, h, true, R()); z += w; } };
    // along W 123rd past each avenue: 3-5 storey row houses, 5-7 m lots, their face at z = fz
    const runX = (x0, x1, fz, n) => { let x = x0; while (x < x1 - 4) { const w = Math.min(x1 - x, 5 + R() * 2.2), h = 11.5 + Math.floor(R() * 4) * 1.6 + (R() < 0.15 ? 9 : 0), z0 = n < 0 ? fz : fz - 14, z1 = n < 0 ? fz + 14 : fz;
      box(x, x + w, z0, z1, h, rowTones[Math.floor(R() * rowTones.length)]); face('z', fz, x, x + w, n, h, false, R()); x += w; } };
    const W0 = -145.66, E0 = 144.46, nW = -115.18, nE = 113.98, HW = 9.144;
    run(W0 - 18, W0, HW, 150, W0, 1); run(W0 - 18, W0, -150, -HW, W0, 1); run(E0, E0 + 18, HW, 150, E0, -1); run(E0, E0 + 18, -150, -HW, E0, -1);     // the far side of each avenue
    run(nW, nW + 16, 42, 150, nW, -1); run(nW, nW + 16, -150, -42, nW, -1); run(nE - 16, nE, 42, 150, nE, 1); run(nE - 16, nE, -150, -42, nE, 1);           // the avenue frontages beyond our block's corner lots
    for (const sd of [-1, 1]) { runX(W0 - 150, W0 - 18, sd * HW, sd); runX(E0 + 18, E0 + 150, sd * HW, sd); }                                                 // W 123rd past both avenues
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex([...idx, ...idxS]); g.addGroup(0, idx.length, 0); g.addGroup(idx.length, idxS.length, 1); g.computeBoundingSphere();
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, [midMat, solidMat]); m.matrixAutoUpdate = false; m.receiveShadow = false; m.castShadow = false; world.add(m); meshes.push(m); info.tris += (idx.length + idxS.length) / 3; info.parts++; info.midTier = (idx.length + idxS.length) / 6;
    midMat.emissiveIntensity = hour >= 18.5 || hour < 6.5 ? 0.55 : 0;
  }
  // every map is decoded off-thread (img.decode) and uploaded in its own task before the first frame, so no frame pays ~1 s of texImage2D + mipmaps
  function upload() {
    const set = new Set(); scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap']) if (m[k]) set.add(m[k]); });
    const list = [...set], t0 = performance.now();
    const loaded = (t) => new Promise((res) => { const img = t.image; if (!img || !('complete' in img)) return res(); const go = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(res); if (img.complete && img.naturalWidth) go(); else { img.addEventListener('load', go, { once: true }); img.addEventListener('error', () => res(), { once: true }); } });
    return list.reduce((p, t) => p.then(() => loaded(t)).then(() => new Promise((res) => setTimeout(() => { const s0 = performance.now(); renderer.initTexture(t); info.texMax = Math.max(info.texMax || 0, Math.round(performance.now() - s0)); res(); }, 0))), Promise.resolve())
      .then(() => { info.textures = list.length; info.uploadMs = Math.round(performance.now() - t0); });
  }
  // compileAsync does not cover every variant the first real frame needs (shadow-depth programs, ANGLE/Metal linking), so the first frame cost
  // 0.15-0.3 s. Draw the world a few objects at a time into a 1x1 scissor, one task each: programs, depth variants and buffers are ready before frame 1.
  function prewarm() {
    const objs = []; world.traverse((o) => { if (o.isMesh) objs.push(o); });
    const vis = objs.map((o) => o.visible), fc = objs.map((o) => o.frustumCulled), t0 = performance.now(), steps = [];
    for (let i = 0; i < objs.length; i += 3) steps.push(objs.slice(i, i + 3));
    const one = (grp) => new Promise((res) => setTimeout(() => {
      if (disposed) return res(); const s0 = performance.now();
      objs.forEach((o) => { o.visible = false; o.frustumCulled = false; }); grp.forEach((o) => { o.visible = true; });
      renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); renderer.setScissorTest(false);
      info.warmMax = Math.max(info.warmMax || 0, Math.round(performance.now() - s0)); res();
    }, 0));
    return steps.reduce((p, g) => p.then(() => one(g)), Promise.resolve()).then(() => { objs.forEach((o, i) => { o.visible = vis[i]; o.frustumCulled = fc[i]; }); renderer.shadowMap.needsUpdate = true; info.prewarmMs = Math.round(performance.now() - t0); });
  }
  /* ---- street trees: EZ-Tree (vendor/ez-tree, MIT). 5 variants (3 London planes, 2 honey locusts), generated once, one per task (<100 ms each),
     then one InstancedMesh per variant and part. Late-October colour: the leaf card is desaturated and re-tinted per tree (instanceColor). */
  let treeList = [];
  const AUT = { plane: [[0.6, 0.58, 0.24], [0.66, 0.55, 0.22], [0.52, 0.52, 0.22], [0.72, 0.5, 0.2]], locust: [[0.9, 0.7, 0.16], [0.84, 0.62, 0.14], [0.78, 0.66, 0.2]] };
  const treeOpts = (kind, seed) => ({
    seed, type: 'deciduous',
    bark: { type: 'oak', tint: kind === 'plane' ? 0xc9c0ae : 0x8a7f72, flatShading: false, textured: true, textureScale: { x: 0.5, y: 4 } },
    branch: kind === 'plane'
      ? { levels: 3, angle: { 1: 42, 2: 52, 3: 55 }, children: { 0: 6, 1: 4, 2: 3 }, force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.012 }, gnarliness: { 0: 0.04, 1: 0.16, 2: 0.22, 3: 0.1 },
          length: { 0: 26, 1: 15, 2: 7, 3: 3 }, radius: { 0: 1.5, 1: 0.6, 2: 0.6, 3: 0.6 }, sections: { 0: 9, 1: 6, 2: 4, 3: 3 }, segments: { 0: 8, 1: 5, 2: 4, 3: 3 }, start: { 1: 0.38, 2: 0.25, 3: 0.2 }, taper: { 0: 0.72, 1: 0.7, 2: 0.7, 3: 0.7 }, twist: { 0: 0.05, 1: 0, 2: 0, 3: 0 } }
      : { levels: 3, angle: { 1: 55, 2: 50, 3: 50 }, children: { 0: 5, 1: 4, 2: 3 }, force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.0 }, gnarliness: { 0: 0.08, 1: 0.22, 2: 0.25, 3: 0.1 },
          length: { 0: 22, 1: 14, 2: 7, 3: 3 }, radius: { 0: 1.2, 1: 0.55, 2: 0.6, 3: 0.6 }, sections: { 0: 8, 1: 6, 2: 4, 3: 3 }, segments: { 0: 7, 1: 5, 2: 4, 3: 3 }, start: { 1: 0.42, 2: 0.3, 3: 0.2 }, taper: { 0: 0.7, 1: 0.7, 2: 0.7, 3: 0.7 }, twist: { 0: 0, 1: 0, 2: 0, 3: 0 } },
    leaves: { type: kind === 'plane' ? 'oak' : 'ash', billboard: 'double', angle: 40, count: kind === 'plane' ? 30 : 40, start: 0.05, size: kind === 'plane' ? 3.7 : 3.5, sizeVariance: 0.6, tint: 0xffffff, alphaTest: 0.5 },   // review: fuller crowns (was 18-20 leaves per twig, 3.4 / 2.6 m)
  });
  function plantTrees() {
    const t0 = performance.now(), V = [['plane', 11], ['plane', 23], ['plane', 37], ['locust', 5], ['locust', 41]], out = [];
    if (!treeList.length) return Promise.resolve();
    return new Promise((done) => {
      const next = (i) => {
        if (disposed) return done();
        if (i < V.length) {
          const s0 = performance.now(), tr = new Tree(); tr.options.copy(treeOpts(V[i][0], V[i][1])); tr.generate();
          tr.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(tr); out.push({ kind: V[i][0], tr, h: bb.max.y - bb.min.y });
          info.treeMs = Math.max(info.treeMs || 0, Math.round(performance.now() - s0)); setTimeout(() => next(i + 1), 0); return;
        }
        const R = rng(777), groups = out.map(() => []);
        for (const t of treeList) { const pl = R() < 0.62, cand = out.map((o, j) => j).filter((j) => (out[j].kind === 'plane') === pl); groups[cand[Math.floor(R() * cand.length)]].push([t, R(), R(), R()]); }
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
        out.forEach((o, j) => {
          const list = groups[j]; if (!list.length) return;
          autumnLeaves(o.tr, j * 37 + 5);                                          // foliage.js: clustered green / yellow / orange (EZ-Tree's own leaf shader draws nothing when instanced)
          const bm = o.tr.branchesMesh.material; bm.specular = new THREE.Color(0x080808); bm.shininess = 4;
          for (const [mesh, tinted] of [[o.tr.branchesMesh, false], [o.tr.leavesMesh, true]]) {
            const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
            list.forEach(([t, a, b, c], k) => {
              const H = (o.kind === 'plane' ? 11.5 : 9.5) + t[2] * 1.1 + b * 2.0, s = H / o.h;
              m4.compose(v.set(t[0], -0.01, t[1]), q.setFromEuler(e.set(0, a * Math.PI * 2, 0)), sc.set(s * (0.92 + c * 0.16), s, s * (0.92 + c * 0.16))); im.setMatrixAt(k, m4);
              if (tinted) { const bb = treeTint(c); im.setColorAt(k, new THREE.Color(bb, bb, bb)); }
            });
            im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; world.add(im); meshes.push(im);
            info.tris += list.length * (mesh.geometry.index ? mesh.geometry.index.count / 3 : 0); info.parts++;
          }
        });
        info.trees = treeList.length; info.treeBakeMs = Math.round(performance.now() - t0); done();
      };
      setTimeout(() => next(0), 0);
    });
  }

  /* ---- the loop: a fixed camera, drawn on demand, nothing until the shaders are compiled */
  let gateResolve; const readyGate = new Promise((r) => { gateResolve = r; });
  let firstDraw = true;
  let carsUpd = null;
  function plantParked() { if (o.cars === false || PQ.get('cars') === '0' || !api.data) return Promise.resolve(); return import('./cars.js').then((m) => m.plantCars({ THREE, world, data: api.data.street, renderer })).then((c) => { carsApi = c; carsUpd = (cam) => c.update(cam); c.update(camera, true); info.cars = c.count; }).catch((e) => console.warn('street cars', e)); }
  let stepFn = null, preRender = null;       // slice 2 (street_walk.js): the walker's per-frame step + a hook just before each draw
  const loop = createLoop({ render: (dt) => { const t = performance.now(); if (carsUpd) carsUpd(camera); if (preRender) preRender(dt); renderer.render(scene, camera); if (firstDraw) { firstDraw = false; info.firstFrameMs = Math.round(performance.now() - t); } }, step: (dt, now) => (stepFn ? stepFn(dt, now) : false), ready: readyGate });
  function kick() { loop.kick(); }
  createAdaptiveDpr(renderer, loop, { max: Math.min(devicePixelRatio || 1, 2) });
  if (PQ.get('debug') || PQ.has('perf')) installPerf(loop);
  ready.then(() => gateResolve());

  let camName = 'fig2', hour = 11, rotY = 0;
  function size() { const r = sceneEl.getBoundingClientRect(); return [Math.max(2, r.width), Math.max(2, r.height)]; }
  let walkOn = false, sunFocus = [0, 0];
  function placeSun(x, z) { sunFocus = [x, z]; sun.target.position.set(x, 0, z); sun.position.set(x, 0, z).addScaledVector(sunV.dir, 120); sun.target.updateMatrixWorld(); renderer.shadowMap.needsUpdate = true; }
  function applyCam() {
    if (walkOn) { const [w, h] = size(); camera.aspect = w / h; camera.updateProjectionMatrix(); placeSun(sunFocus[0], sunFocus[1]); return; }      // the walker's rig owns the camera
    const c = CAMS[camName] || CAMS.fig2, [w, h] = size(), asp = w / h;
    camera.aspect = asp; camera.fov = (2 * Math.atan(Math.tan(c.hfov * D2R / 2) / asp)) / D2R; camera.updateProjectionMatrix();
    camera.position.set(...c.pos); camera.lookAt(new THREE.Vector3(...c.look)); camera.updateMatrixWorld();
    label.textContent = c.label + ' · ' + (hour >= 7 && hour < 18 ? 'day' : 'night');
    const f = new THREE.Vector3(...c.look).sub(camera.position).normalize(), focus = camera.position.clone().addScaledVector(f, 30);
    sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunV.dir, 120); sun.target.updateMatrixWorld(); renderer.shadowMap.needsUpdate = true;
  }
  let sunV = sunDir(solarHour(11), dayOfYear(), 0);
  function applyTime() {
    const night = hour >= 18.5 || hour < 6.5, dusk = !night && (hour >= 17 || hour < 8);
    sunV = sunDir(solarHour(night ? 11 : hour), dayOfYear(), rotY);
    const top = night ? '#0b1430' : dusk ? '#5c7db0' : '#7fb0e0', low = night ? '#26325a' : dusk ? '#f0c8a0' : '#dcebf5';
    scene.background = skyTex(top, low); scene.fog = new THREE.Fog(new THREE.Color(night ? '#1a2036' : '#c9d6e0'), night ? 40 : 35, night ? 330 : 420);
    hemi.color.set(night ? 0x1c2850 : 0xbcd4ee); hemi.groundColor.set(night ? 0x0c0f1a : 0x6f6a60); hemi.intensity = night ? 0.28 : 0.85;
    sun.color.set(night ? 0x8da6d8 : dusk ? 0xffc48a : 0xfff1d6); sun.intensity = night ? 0.35 : dusk ? 1.6 : 2.4; sun.castShadow = !night; scene.environmentIntensity = night ? 0.12 : 0.5;
    renderer.toneMappingExposure = night ? 1.15 : 1.05;
    winMat.uniforms.uAmb.value = night ? 0.06 : 0.55; winMat.uniforms.uOpp.value.set(night ? '#0a0a10' : '#4a3a32');
    winMat.uniforms.uNight.value = night ? 1 : 0; winMat.uniforms.uSkyTop.value.set(top); winMat.uniforms.uSkyLow.value.set(low);
    signMat.emissiveIntensity = night ? 1.5 : 0.12;
    if (midMat) midMat.emissiveIntensity = night ? 0.55 : 0; lampMat.emissiveIntensity = night ? 6 : 0.1; poolMat.opacity = night ? 0.85 : 0; poolMat.visible = night; M.glass.emissiveIntensity = night ? 0.9 : 0;
    applyCam(); kick();
  }
  function setCam(n) { if (CAMS[n]) { camName = n; applyCam(); kick(); } return camName; }
  function setHour(h) { hour = +h; applyTime(); return hour; }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { const [w, h] = size(); renderer.setSize(w, h, false); applyCam(); kick(); }) : null;
  if (ro) ro.observe(sceneEl);

  /* ---- load the descriptors, hand them to the worker */
  const api = {
    cams: CAMS, setCam, setHour, ready, THREE, canvas, sceneEl, host, sun, hemi, M, world, label, std,
    // slice 3 (district.js): add worker messages into a unit group; the tree kit; shared parts
    addMsg: (m, grp, keep) => (m.t === 'mesh' ? addMesh(m, grp, keep) : addInst(m, grp, keep)), PARTS, winMat, FADE, fadeKit: { disposeUnit }, treeKit: { Tree, treeOpts, AUT }, get worker() { return worker; }, workerInfo: info, shadowDirty: () => { renderer.shadowMap.needsUpdate = true; },
    // slice 2: the walkable street (street_walk.js)
    setStep(fn) { stepFn = fn; }, setPreRender(fn) { preRender = fn; }, placeSun, setWalk(on) { walkOn = !!on; label.style.display = on ? 'none' : ''; if (on) { const [w, h] = size(); camera.aspect = w / h; camera.near = 0.15; camera.updateProjectionMatrix(); } },
    get hour() { return hour; }, get night() { return hour >= 18.5 || hour < 6.5; }, get frame() { return rotY; }, size,
    show(on) { canvas.style.display = on ? 'block' : 'none'; if (on) { const [w, h] = size(); renderer.setSize(w, h, false); if (walkOn) { camera.aspect = w / h; camera.updateProjectionMatrix(); } renderer.shadowMap.needsUpdate = true; loop.kick(); } },
    get built() { return built; }, get cars() { return carsApi; }, get collide() { return collide; }, renderer, scene, camera, loop,
    info: () => ({ ...info, draws: renderer.info.render.calls, trisDrawn: renderer.info.render.triangles, programs: renderer.info.programs ? renderer.info.programs.length : 0, frames: loop.frames, camName, hour, ready: built }),
    dispose() { disposed = true; if (worker) worker.terminate(); loop.dispose(); if (ro) ro.disconnect(); T.dispose(); renderer.dispose(); canvas.remove(); label.remove(); },
  };
  if (o.hidden) canvas.style.display = 'none';
  camName = o.cam || PQ.get('cam') || 'fig2'; hour = PQ.has('hour') ? +PQ.get('hour') : o.hour != null ? +o.hour : 11;
  (async () => {
    try {
      const get = (f) => fetch(new URL(f, DATA)).then((r) => r.json());
      const [south, north, street] = await Promise.all([get('w123_south.json'), get('w123_north.json'), get('w123_street.json')]);
      api.data = { south, north, street }; rotY = street.frame.rot; const [w, h] = size(); renderer.setSize(w, h, false); applyTime();
      performance.mark('street:worker-start');
      worker = new Worker(new URL('./street_worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.uid && api.onUnitMsg) { api.onUnitMsg(m); return; }                   // slice 3: a streaming unit's message (district.js)
        if (m.t === 'done') { info.workerMs = m.ms; info.buildings = m.stats.buildings; info.bld = m.stats.bld; doneAt = performance.now(); if (!queue.length) finish(); return; }
        if (m.t === 'error') { console.warn('street worker', m.message); return; }
        if (m.t === 'collide') { collide = m; return; }
        if (m.t === 'trees') { treeList = m.trees; return; }
        if (m.t === 'blades') { bladeList = m.list; return; }
        const start = !queue.length; queue.push(m); if (start) setTimeout(pump, 0);
      };
      worker.postMessage({ faces: [south, north], street, opt: { omitRear: !!o.district, season: o.season || 'autumn', clear: Object.values(CAMS).filter((c) => Math.abs(c.pos[1] - 1.55) < 0.01).flatMap((c) => [[c.pos[0], c.pos[2], 3.6], [c.look[0], c.look[2] > 0 ? 6.9 : -6.9, 4.5]]) } });
    } catch (e) { console.warn('street', e); }
  })();
  if (PQ.get('debug') || PQ.has('perf') || o.debug) window.__street = api;
  if (o.onReady) ready.then(o.onReady);
  return api;
}
