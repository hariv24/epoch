// city/mh_tiles.js · real Manhattan buildings: tile decoding, the building shader and the LOD / streaming manager.
// Tiles are 'MNTL' v2 (see docs/MANHATTAN-DATA.md). Positions stay quantised u16 on the GPU: a tile mesh is placed at its
// quantisation origin and scaled by posScale, so decoding is only slicing the file plus one per-vertex attribute fill.
//   aB (u16 x4, per vertex, copied from the building table): baseY dm + 1000, height dm, style | flags << 8 | shopfront << 15,
//   seed | accent << 8 | storey-height code << 12
// The building shader (patched Lambert, flat shaded) draws era / height colours, procedural windows (warm lit, cool unlit,
// more lit at night), cornice bands, Times Square screens, accent lighting on the notables and the locked-district fog.
import * as THREE from 'three';
import { MS, glsl } from './palette.js';

export const GA = (29 * Math.PI) / 180;          // the street grid, east of true north
export const CA = Math.cos(GA), SA = Math.sin(GA);
/** grid frame: u across the avenues (east-ish), v along them (north-ish) */
export const toU = (x, z) => x * CA + z * SA;
export const toV = (x, z) => x * SA - z * CA;
export const fromUV = (u, v) => [u * CA + v * SA, u * SA - v * CA];

// notable buildings with their own light (BINs from notables.json). The five ladder landmarks are epoch/game.py LADDER_LANDMARKS:
// Math = Empire State (1), ML/DL = Chrysler (2), Papers = Butler Library (9, Columbia), Writing/X = One Times Square (4).
export const ACCENT = { 1015862: 1, 1036156: 2, 1016278: 3, 1085682: 4, 1088469: 5, 1084466: 7, 1087167: 8, 1076262: 8, 1035381: 8, 1082165: 9 };
export const STYLE_N = { generic: 0, walkup: 1, rowhouse: 2, prewar_tower: 3, artdeco: 4, modern_tower: 5, postwar_midrise: 6, loft: 7, institution: 8, commercial_low: 9, landmark: 10, garage: 11, utility: 12, supertall_glass: 13, steinway_terracotta: 14, park_grid: 15, cps_limestone: 16 };

/* ------------------------------------------------------------------ shopfronts */
// Which buildings get a lit shopfront ground floor: the ones fronting an avenue or a two-way crosstown street (street class 1 in
// streets.json), by their centroid's distance to the centreline. Set once from manhattan.js before the tiles decode.
let shopFn = null;
export function setShopFn(fn) { shopFn = fn; }
const SHOP_STYLES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 9]);
export function makeShopFn(streets) {
  const CELL = 120, grid = new Map(), segs = [];
  for (const l of streets.lines) {
    if (l.c !== 1) continue;
    const p = l.p, hw = (l.w || 14) / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const s = segs.length; segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], hw]);
      const x0 = Math.floor(Math.min(p[i], p[i + 2]) / CELL) - 1, x1 = Math.floor(Math.max(p[i], p[i + 2]) / CELL) + 1;
      const z0 = Math.floor(Math.min(p[i + 1], p[i + 3]) / CELL) - 1, z1 = Math.floor(Math.max(p[i + 1], p[i + 3]) / CELL) + 1;
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x + ',' + z; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(s); }
    }
  }
  return (b) => {
    if (!SHOP_STYLES.has(b.style) || b.h < 6 || (b.flags & 16)) return false;
    if (b.style === 5 && (b.seed & 3) === 0) return false;
    const a = grid.get(Math.floor(b.cx / CELL) + ',' + Math.floor(b.cz / CELL)); if (!a) return b.style === 9;
    for (const s of a) {
      const [ax, az, bx, bz, hw] = segs[s], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((b.cx - ax) * dx + (b.cz - az) * dz) / L2));
      if (Math.hypot(b.cx - ax - dx * t, b.cz - az - dz * t) < hw + 30) return (b.seed % 7) !== 0 || b.style === 9;
    }
    return b.style === 9;
  };
}

/* ------------------------------------------------------------------ decode */
export function decodeTile(buf) {
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 77 || dv.getUint8(1) !== 78) throw new Error('not an MNTL tile');
  const h = {
    lod: dv.getUint16(6, true), tx: dv.getInt32(8, true), tz: dv.getInt32(12, true), ox: dv.getFloat32(16, true), oz: dv.getFloat32(20, true),
    ps: dv.getFloat32(24, true), pad: dv.getFloat32(28, true), ys: dv.getFloat32(32, true), yo: dv.getFloat32(36, true),
    nv: dv.getUint32(40, true), ni: dv.getUint32(44, true), nb: dv.getUint32(48, true), nc: dv.getUint32(52, true), chunkOff: dv.getUint32(56, true), bOff: dv.getUint32(60, true),
  };
  const pos = new Uint16Array(buf, 64, h.nv * 3);
  const idxOff = 64 + ((h.nv * 6 + 3) & ~3);
  const chunks = [];
  for (let c = 0; c < h.nc; c++) { const p = h.chunkOff + 16 * c; chunks.push({ vF: dv.getUint32(p, true), vC: dv.getUint32(p + 4, true), iF: dv.getUint32(p + 8, true), iC: dv.getUint32(p + 12, true) }); }
  const aB = new Uint16Array(h.nv * 4);
  const blds = new Array(h.nb);
  for (let i = 0; i < h.nb; i++) {
    const p = h.bOff + 40 * i;
    const b = {
      bin: dv.getUint32(p, true), baseY: dv.getFloat32(p + 4, true), h: dv.getFloat32(p + 8, true), iF: dv.getUint32(p + 12, true), iC: dv.getUint32(p + 16, true),
      vF: dv.getUint32(p + 20, true), vC: dv.getUint32(p + 24, true), cx: h.ox + dv.getInt16(p + 28, true) / 10, cz: h.oz + dv.getInt16(p + 30, true) / 10,
      year: dv.getUint16(p + 32, true), style: dv.getUint8(p + 34), flags: dv.getUint8(p + 35), floors: dv.getUint8(p + 36), seed: dv.getUint8(p + 37), chunk: dv.getUint16(p + 38, true),
    };
    let acc = ACCENT[b.bin] || 0;
    if (!acc && (b.flags & 1) && b.h > 12) acc = 6;                                  // an individual landmark: soft floodlight
    // the storey height from the real floor count (PLUTO), so the window rows line up with the building's own floors: 2.6-5.4 m in 0.2 m steps, 0 = unknown
    const fhq = b.floors > 0 && b.h > 4 ? Math.max(1, Math.min(15, Math.round(((b.h - (b.floors > 1 ? 1.1 : 0)) / b.floors - 2.6) / 0.2) + 1)) : 0;   // less the parapet
    const shop = shopFn && shopFn(b) ? 1 : 0;                                        // a shopfront ground floor (avenues and the big crosstown streets)
    const a0 = Math.max(0, Math.min(65535, Math.round(b.baseY * 10 + 1000))), a1 = Math.min(65535, Math.round(b.h * 10)), a2 = b.style | ((b.flags & 127) << 8) | (shop << 15), a3 = b.seed | ((acc & 15) << 8) | (fhq << 12);
    for (let v = b.vF, e = b.vF + b.vC; v < e; v++) { const o = v * 4; aB[o] = a0; aB[o + 1] = a1; aB[o + 2] = a2; aB[o + 3] = a3; }
    blds[i] = b;
  }
  return { h, buf, pos, idxOff, chunks, aB, blds };
}

/** world position of vertex i of a decoded tile */
export function vtx(t, i, out) {
  const h = t.h; out[0] = h.ox - h.pad + t.pos[3 * i] * h.ps; out[1] = h.yo + t.pos[3 * i + 1] * h.ys; out[2] = h.oz - h.pad + t.pos[3 * i + 2] * h.ps; return out;
}

/** meshes for a decoded tile: one per chunk, all sharing the material. opts.only = Set of building indices (home file). */
export function tileMeshes(t, mat, name = 'tile') {
  const h = t.h, out = [];
  for (const c of t.chunks) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Uint16Array(t.buf, 64 + c.vF * 6, c.vC * 3), 3));
    g.setAttribute('aB', new THREE.BufferAttribute(t.aB.subarray(c.vF * 4, (c.vF + c.vC) * 4), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(t.buf, t.idxOff + 2 * c.iF, c.iC), 1));
    g.boundingSphere = localSphere(t.pos, c.vF, c.vC);
    g.boundingBox = null;
    const m = new THREE.Mesh(g, mat);
    m.position.set(h.ox - h.pad, h.yo, h.oz - h.pad); m.scale.set(h.ps, h.ys, h.ps);
    m.matrixAutoUpdate = false; m.updateMatrix(); m.name = name;
    out.push(m);
  }
  return out;
}
function localSphere(pos, vF, vC) {
  let x0 = 65535, y0 = 65535, z0 = 65535, x1 = 0, y1 = 0, z1 = 0;
  for (let i = vF * 3, e = (vF + vC) * 3; i < e; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1);
}
/** one mesh per listed building (the home file: each lot's real building can be hidden on its own) */
export function buildingMeshes(t, mat) {
  const h = t.h, out = new Map();
  for (const b of t.blds) {
    const c = t.chunks[b.chunk]; if (!c) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Uint16Array(t.buf, 64 + c.vF * 6, c.vC * 3), 3));
    g.setAttribute('aB', new THREE.BufferAttribute(t.aB.subarray(c.vF * 4, (c.vF + c.vC) * 4), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(t.buf, t.idxOff + 2 * b.iF, b.iC), 1));
    g.boundingSphere = localSphere(t.pos, b.vF, b.vC);
    const m = new THREE.Mesh(g, mat);
    m.position.set(h.ox - h.pad, h.yo, h.oz - h.pad); m.scale.set(h.ps, h.ys, h.ps); m.matrixAutoUpdate = false; m.updateMatrix();
    out.set(b.bin, m);
  }
  return out;
}

/* ------------------------------------------------------------------ shared uniforms (time of day, district mask, landmarks) */
export function makeUniforms() {
  return {
    uGlow: { value: 1 }, uDay: { value: 0 }, uTime: { value: 0 }, uSnow: { value: 0 }, uWet: { value: 0 },
    uSkyRefl: { value: new THREE.Color(0x2f639b) }, uSkyTop: { value: new THREE.Color(0x0e2b57) }, uWarm: { value: new THREE.Color(MS.windowWarm) },
    uMask: { value: null }, uMask2: { value: null }, uMaskMix: { value: 1 }, uMaskXf: { value: new THREE.Vector4(0, 0, 1, 1) }, uLockOn: { value: 0 }, uLockCol: { value: new THREE.Color(MS.fog) },
    uLmLvl: { value: [0, 0, 0, 0, 0] }, uLmFlash: { value: [0, 0, 0, 0, 0] }, uLmCol: { value: [0, 1, 2, 3, 4].map(() => new THREE.Color(1, 1, 1)) },
    uTsq: { value: new THREE.Vector2(0, 0) }, uDetail: { value: 1 },
    uCut: { value: new THREE.Vector4(0, 0, 0, 0) }, uCutR: { value: 16 },
  };
}

// GLSL shared by the building, ground and tree materials: hashes, the grid frame and the district mask
export const COMMON_GLSL = /* glsl */`
uniform float uGlow, uDay, uTime, uSnow, uWet, uMaskMix, uLockOn, uDetail;
uniform vec3 uSkyRefl, uWarm, uLockCol;
uniform sampler2D uMask, uMask2;
uniform vec4 uMaskXf;
uniform vec4 uCut;
uniform float uCutR;
// cutaway: on the framed stages (and a picked lot) the real buildings between the camera and the user's tower open up in a soft,
// screen-door cone, so a 16-storey day tower stays in sight among Morningside's taller neighbours. rel = fragment - camera.
float cutAway(vec3 rel) {
  if (uCut.w < 0.5) return 0.0;
  vec3 ab = uCut.xyz - cameraPosition; float L2 = max(dot(ab, ab), 1.0), L = sqrt(L2);
  float t = dot(rel, ab) / L2;
  if (t < 0.03 || t > 1.0 - 0.75 * uCutR / L) return 0.0;
  float d = length(rel - ab * t), rr = uCutR * (0.45 + 0.55 * t);
  return (1.0 - smoothstep(rr * 0.86, rr, d)) * smoothstep(0.03, 0.08, t);
}
float cutNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
vec2 gridUV(vec2 xz) { float u = xz.x * ${CA.toFixed(6)} + xz.y * ${SA.toFixed(6)}; float v = xz.x * ${SA.toFixed(6)} - xz.y * ${CA.toFixed(6)}; return vec2((u - uMaskXf.x) * uMaskXf.z, (v - uMaskXf.y) * uMaskXf.w); }
float lockedAt(vec2 xz) {
  if (uLockOn < 0.5) return 0.0;
  vec2 uv = gridUV(xz);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float a = texture2D(uMask, uv).r, b = texture2D(uMask2, uv).r;
  return 1.0 - smoothstep(0.25, 0.75, mix(a, b, uMaskMix));
}
`;

const BVERT_PARS = /* glsl */`
attribute vec4 aB;
varying vec4 vB;
varying vec3 vWP;
varying vec3 vRel;
varying vec2 vLoc;
`;
const BVERT_MAIN = /* glsl */`
#include <project_vertex>
vB = aB;
vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
// small-magnitude copies for the facade maths: kilometre-scale world coordinates leave too few float bits for screen derivatives
// (Morningside is 5.5 km from the origin, where the window grid broke into per-pixel noise)
vRel = vWP - cameraPosition;
vLoc = vWP.xz - modelMatrix[3].xz;
`;

const BFRAG_PARS = /* glsl */`
varying vec4 vB;
varying vec3 vWP;
varying vec3 vRel;
varying vec2 vLoc;
uniform float uLmLvl[5], uLmFlash[5];
uniform vec3 uLmCol[5];
uniform vec2 uTsq;
uniform vec3 uSkyTop;
#define WIN_WARM ${glsl(MS.windowWarm)}
#define WIN_AMBER ${glsl(MS.windowAmber)}
#define WIN_COOL ${glsl(MS.windowCool)}
#define C_ACCENT ${glsl(MS.accent)}
#define C_BEACON ${glsl(MS.beacon)}
#define C_LIME ${glsl(MS.limestone)}
float gLocked;
vec3 pal(float f, float k) {
  // f: material family, k: per-building pick 0..1. Warm masonry against the blue hour: brick reds and ochres, cream limestone,
  // chocolate brownstone, buff and white brick, blue-teal glass, painted cast iron. Every family has a few related tones.
  if (f > 10.5) return k < 0.5 ? mix(${glsl('#c4a47f')}, ${glsl('#d3b896')}, k * 2.0) : mix(${glsl('#ad8a68')}, ${glsl('#be9c7a')}, k);   // buff / tan brick (pre-war)
  if (f > 9.5) return mix(${glsl('#c9c6bf')}, ${glsl('#dcd9d2')}, k);                                                // 432 Park: pale board-formed concrete
  if (f > 8.5) return mix(${glsl('#8a5a43')}, ${glsl('#a56f4e')}, k);                                                // 111 W 57th: terracotta and bronze
  if (f < 0.5) return k < 0.3 ? mix(${glsl('#8e4a3a')}, ${glsl('#a65c46')}, k * 3.3) : (k < 0.55 ? mix(${glsl('#7a4536')}, ${glsl('#905a46')}, k) : (k < 0.75 ? mix(${glsl('#a8704f')}, ${glsl('#ba835f')}, k) : (k < 0.9 ? mix(${glsl('#6c4038')}, ${glsl('#7f4c40')}, k) : mix(${glsl('#c8baa4')}, ${glsl('#d8ccb8')}, k))));   // red, brown, ochre brick; a few painted cream
  if (f < 1.5) return mix(${glsl('#5c3c2f')}, ${glsl('#76513f')}, k);                                                 // brownstone
  if (f < 2.5) return k < 0.5 ? mix(${glsl('#d4c6aa')}, ${glsl('#e2d7c0')}, k * 2.0) : (k < 0.8 ? mix(${glsl('#c2b093')}, ${glsl('#cfbfa2')}, k) : ${glsl('#b8a68c')});   // limestone
  if (f < 3.5) return k < 0.5 ? mix(${glsl('#cdc6b9')}, ${glsl('#dcd5c8')}, k * 2.0) : (k < 0.8 ? mix(${glsl('#b7a993')}, ${glsl('#c5b7a1')}, k) : mix(${glsl('#9a8e83')}, ${glsl('#a89b8f')}, k));   // white / tan / grey brick (post-war)
  if (f < 4.5) return k < 0.35 ? mix(${glsl('#2e4a63')}, ${glsl('#3a5a76')}, k * 2.8) : (k < 0.7 ? mix(${glsl('#3d5d6c')}, ${glsl('#4b6e7a')}, k) : mix(${glsl('#5a6570')}, ${glsl('#6b7681')}, k));   // glass: blue, teal-grey, smoke
  if (f < 5.5) return mix(${glsl('#8a8d90')}, ${glsl('#9d9a94')}, k);                                                 // concrete
  if (f < 6.5) return k < 0.3 ? ${glsl('#cbbfa6')} : (k < 0.5 ? ${glsl('#a3a7a4')} : (k < 0.68 ? ${glsl('#76806f')} : (k < 0.84 ? ${glsl('#a8836a')} : ${glsl('#626a75')})));   // cast-iron paint: cream, dove, sage, rust, slate
  if (f < 7.5) return mix(${glsl('#dcd2be')}, ${glsl('#e9e1cf')}, k);                                                 // civic limestone
  return k < 0.55 ? mix(${glsl('#b8a58c')}, ${glsl('#c8b79f')}, k) : mix(${glsl('#93604a')}, ${glsl('#a36d55')}, k);   // commercial stucco or brick
}
// box-filtered patterns: exact averages over the pixel footprint fw, so detail finer than a pixel settles to its mean instead of shimmering
float ptI(float x, float w) { return floor(x) * w + max(fract(x) - 1.0 + w, 0.0); }
float pulse(float x, float c, float w, float fw) { x -= c + 0.5 * w; fw = max(fw, 1e-4); return (ptI(x + 0.5 * fw, w) - ptI(x - 0.5 * fw, w)) / fw; }   // 1 on [c - w/2, c + w/2] of each unit period
float band(float x, float a, float b, float fw) { fw = max(fw, 1e-4); return clamp((x - a) / fw + 0.5, 0.0, 1.0) - clamp((x - b) / fw + 0.5, 0.0, 1.0); }
`;

// Facade grammar per style (kind): 0 brick walk-up / tenement, 1 rowhouse, 2 pre-war (rusticated base, belt course, cornice), 3 art deco
// (piers and dark spandrels), 4 cast-iron loft, 5 post-war (slab lines), 6 glass (mullions, spandrels, sky reflection), 7 civic stone,
// 8 garage / utility, 9 low commercial, 10 the Billionaires' Row specials. Storeys follow the real floor count; avenue buildings get a
// shopfront storey. Every ornament is drawn with box-filtered bands and fades by its pixel footprint, so zooming out stays calm.
const BFRAG_COLOR = /* glsl */`
#include <color_fragment>
if (cutAway(vRel) > cutNoise(gl_FragCoord.xy) * 0.999 + 0.001) discard;
vec3 bEmis = vec3(0.0);
{
  float baseY = vB.x * 0.1 - 100.0, H = vB.y * 0.1;
  float st = floor(mod(vB.z, 256.0) + 0.5), shop = step(32767.5, vB.z);
  float sd = floor(mod(vB.w, 256.0) + 0.5), acc = floor(mod(floor(vB.w / 256.0 + 0.001), 16.0) + 0.5), fhq = floor(vB.w / 4096.0 + 0.001);
  vec3 wn = normalize(cross(dFdx(vRel), dFdy(vRel)));
  float rel = vWP.y - baseY, top = H - rel;
  float k = h21(vec2(sd, 3.7));
  float kind = 0.0, fam = 0.0, fh = 3.2, pitch = 2.4, glass = 0.0, litK = 1.0, rustF = 0.0, corn = 0.7, fesc = 0.0; vec2 fill = vec2(0.42, 0.56);
  if (st < 0.5) {
    if (H > 75.0) { kind = 6.0; fam = 4.0; fh = 3.9; pitch = 1.6; glass = 1.0; fill = vec2(0.9, 0.7); corn = 0.0; }
    else if (H > 26.0) { if (k < 0.62) { kind = 2.0; fam = k < 0.3 ? 2.0 : 11.0; rustF = 2.0; corn = 1.0; } else { kind = 5.0; fam = 3.0; fh = 2.9; corn = 0.0; } }
    else { fh = 3.1; fesc = 0.5; }
  }
  else if (st < 1.5) { fh = 3.1; pitch = 2.3; fesc = 1.0; }
  else if (st < 2.5) { kind = 1.0; fam = k < 0.62 ? 1.0 : 0.0; fh = 3.4; pitch = 2.0; fill = vec2(0.4, 0.62); rustF = 1.0; corn = 1.0; }
  else if (st < 3.5) { kind = 2.0; fam = k < 0.45 ? 2.0 : (k < 0.85 ? 11.0 : 0.0); fh = 3.2; pitch = 2.3; rustF = 2.0; corn = 1.0; }
  else if (st < 4.5) { kind = 3.0; fam = k < 0.6 ? 11.0 : 2.0; fh = 3.6; pitch = 2.1; fill = vec2(0.36, 0.62); rustF = 1.0; corn = 0.4; }
  else if (st < 5.5) { kind = 6.0; fam = 4.0; fh = 3.8; pitch = 1.55; glass = 1.0; fill = vec2(0.9, 0.72); litK = 0.9; corn = 0.0; }
  else if (st < 6.5) { kind = 5.0; fam = k < 0.6 ? 3.0 : 11.0; fh = 2.9; pitch = 2.0; fill = vec2(0.66, 0.46); corn = 0.0; }
  else if (st < 7.5) { kind = 4.0; fam = 6.0; fh = 4.2; pitch = 3.0; fill = vec2(0.62, 0.68); corn = 0.8; }
  else if (st < 8.5) { kind = 7.0; fam = k < 0.5 ? 0.0 : 7.0; fh = 4.4; pitch = 3.4; fill = vec2(0.4, 0.56); litK = 0.8; rustF = 1.0; corn = 1.0; }
  else if (st < 9.5) { kind = 9.0; fam = 8.0; fh = 4.4; pitch = 3.2; fill = vec2(0.55, 0.5); }
  else if (st < 10.5) { kind = 7.0; fam = 7.0; fh = 4.6; pitch = 3.0; fill = vec2(0.36, 0.55); litK = 0.7; rustF = 1.5; corn = 1.0; }
  else if (st < 11.5) { kind = 8.0; fam = 5.0; fh = 3.0; pitch = 9.0; fill = vec2(0.96, 0.3); litK = 0.3; corn = 0.0; }
  else if (st < 12.5) { kind = 8.0; fam = 5.0; fh = 5.0; pitch = 6.0; fill = vec2(0.3, 0.3); litK = 0.25; corn = 0.0; }
  else if (st < 13.5) { kind = 6.0; fam = 4.0; fh = 4.3; pitch = 1.5; glass = 1.0; fill = vec2(0.94, 0.78); litK = 0.85; corn = 0.0; }
  else if (st < 14.5) { kind = 10.0; fam = 9.0; fh = 4.3; pitch = 1.25; fill = vec2(0.55, 0.9); litK = 0.8; corn = 0.0; }       // Steinway Tower: tall slim windows between bronze-and-terracotta ribs
  else if (st < 15.5) { kind = 10.0; fam = 10.0; fh = 3.05; pitch = 3.05; fill = vec2(0.76, 0.76); litK = 0.9; corn = 0.0; }    // 432 Park: a pure grid of 3 m square windows in a pale frame
  else { kind = 2.0; fam = 2.0; fh = 3.7; pitch = 2.3; fill = vec2(0.42, 0.66); litK = 0.9; rustF = 2.0; corn = 1.0; }          // 220 Central Park South: limestone, punched windows
  if (fhq > 0.5 && kind < 9.5 && abs(kind - 8.0) > 0.5) fh = 2.6 + (fhq - 1.0) * 0.2;
  vec3 nightK = mix(vec3(1.0), vec3(0.76, 0.83, 1.0) * 0.74, uGlow);  // night: facades fall back into the blue (keeping a little of the brick), the windows carry the city
  vec3 base = pal(fam, h21(vec2(sd, 9.1)));
  base *= (0.82 + 0.24 * h21(vec2(sd, 1.3))) * (1.0 + (vec3(h21(vec2(sd, 2.1)), h21(vec2(sd, 4.4)), h21(vec2(sd, 6.2))) - 0.5) * 0.07);
  base *= nightK;
  vec3 stone = mix(base, C_LIME * (0.6 + 0.2 * h21(vec2(sd, 8.8))) * nightK, kind > 0.5 && kind < 1.5 ? 0.25 : 0.62);   // trim: lintels, sills, belt courses, cornices
  float wall = 1.0 - smoothstep(0.55, 0.8, abs(wn.y));
  vec3 col = base;
  if (wall < 0.5) {
    // roofs: tar, silver coating, gravel, the odd green roof, with faint membrane seams; the lower part of a setback reads as the same stone
    float r = h21(vec2(sd, 5.5));
    vec3 roofC = r < 0.42 ? ${glsl('#3a3f4a')} : (r < 0.72 ? ${glsl('#7f858d')} : (r < 0.95 || H > 45.0 ? ${glsl('#756c5f')} : ${glsl('#536049')}));   // green roofs only on low buildings
    if (glass > 0.5) roofC = ${glsl('#59606c')};
    if (wn.y < 0.95) roofC = mix(base * 0.8, roofC, 0.5);
    float ru = dot(vLoc, vec2(${CA.toFixed(6)}, ${SA.toFixed(6)})) / 1.6, rfw = fwidth(ru);
    float seam = pulse(ru, 0.0, 0.07, rfw) * (1.0 - smoothstep(0.08, 0.3, rfw)) * uDetail;
    float gn = vn2(vLoc * 0.35) * 0.18 + 0.91;
    col = roofC * gn * (1.0 - 0.14 * seam) * mix(1.0, 0.82, uGlow);
    col = mix(col, ${glsl('#dfe8f4')}, uSnow * 0.85);
  } else {
    // the facade's horizontal coordinate. A derivative normal carries ~1e-4 rad of per-pixel noise, which a kilometre of lever arm turns
    // into ragged window edges: walls on the street grid (most of them) snap to its exact axes, the others measure from a nearby anchor.
    vec2 tg = normalize(vec2(-wn.z, wn.x) + 1e-5);
    vec2 gA = vec2(${CA.toFixed(6)}, ${SA.toFixed(6)}), gB = vec2(-${SA.toFixed(6)}, ${CA.toFixed(6)});
    float ca = dot(tg, gA), cb = dot(tg, gB);
    vec2 anchor = vec2(0.0);
    if (abs(ca) > 0.9994) tg = gA * sign(ca);
    else if (abs(cb) > 0.9994) tg = gB * sign(cb);
    else anchor = floor(vLoc / 128.0) * 128.0;
    float u = dot(vLoc - anchor, tg) + sd * 1.7;
    float fwR = fwidth(rel) + 1e-4;
    // storeys: a taller shopfront storey at the street, the floors above share the rest so the top floor still meets the roof
    float shopOn = shop * step(6.0, H) * step(kind, 9.5);
    float gfh = fh;
    if (shopOn > 0.5) { gfh = max(fh * 1.3, 4.3); float nf = max(floor((H - 1.1) / fh + 0.5) - 1.0, 1.0); fh = max((H - 1.1 - gfh) / nf, 2.4); }
    float fv = rel < gfh ? rel / gfh : 1.0 + (rel - gfh) / fh;
    vec2 cu = vec2(u / pitch, fv);
    vec2 cell = floor(cu), fr = fract(cu);
    float ground = step(cell.y, 0.5) * step(8.0, H);
    vec2 fl = mix(fill, vec2(0.86, 0.62), ground * (1.0 - glass));
    vec2 q = (fr - (1.0 - fl) * 0.5) / fl;
    vec2 cpp = fwidth(cu) + 1e-4;                       // cells per pixel
    vec2 fq = cpp / fl;
    float mx = clamp(min(q.x, 1.0 - q.x) / fq.x + 0.5, 0.0, 1.0), my = clamp(min(q.y, 1.0 - q.y) / fq.y + 0.5, 0.0, 1.0);
    float cov = mx * my;
    float cm = cpp.x * 0.3 + cpp.y * 0.7;                // walls are seen obliquely: weigh the vertical rate
    float far = smoothstep(0.2, 0.55, cm);
    float dk = (1.0 - smoothstep(0.12, 0.45, cm)) * uDetail;   // ornament fades before it could alias
    cov = mix(cov, fl.x * fl.y, far) * uDetail;
    float inShop = shopOn * (1.0 - clamp((rel - gfh) / fwR + 0.5, 0.0, 1.0));
    // no windows in the cornice / parapet band at the top of the building, nor behind the shopfront
    float cor = (glass < 0.5) ? (1.0 - smoothstep(0.75, 1.05, top)) : 0.0;
    // keep: where a window may be. A window row that would run into the cornice is left out whole rather than cut in half, and
    // its reveal, lintel and sill go with it (they used to leave a row of dark ghost rectangles under the cornice)
    float keep = (1.0 - cor) * (1.0 - inShop) * step(0.35, rel);
    float wTop = cell.y + 0.5 + 0.5 * fl.y, relTop = wTop <= 1.0 ? wTop * gfh : gfh + (wTop - 1.0) * fh;
    if (glass < 0.5) keep *= 1.0 - step(H - 1.0, relTop) * (1.0 - far);
    cov *= keep;
    float upper = clamp((fv - 1.0) / max(cpp.y, 1e-3) + 0.5, 0.0, 1.0);    // above the ground storey
    // --- masonry modelling
    float winBox = band(q.x, -0.08, 1.08, fq.x) * band(q.y, -0.08, 1.08, fq.y);
    if (glass < 0.5 && kind < 9.5) {
      // window reveals: a soft shadow ring around punched openings
      col *= 1.0 - 0.28 * max(winBox * keep - cov, 0.0) * dk;
      // stone lintels and sills (brick, rowhouses, pre-war, civic)
      if (kind < 2.5 || abs(kind - 7.0) < 0.5) {
        float hx = band(q.x, -0.1, 1.1, fq.x);
        float ls = hx * (band(q.y, 1.02, 1.16, fq.y) + band(q.y, -0.13, -0.03, fq.y));
        col = mix(col, stone * 1.06, ls * 0.8 * dk * keep);
      }
      // art deco: light brick piers rising between the window columns, dark spandrels between the windows
      if (abs(kind - 3.0) < 0.5) {
        float inCol = band(q.x, 0.0, 1.0, fq.x);
        col = mix(col, stone * 1.1, (1.0 - inCol) * 0.4 * dk);
        col = mix(col, base * vec3(0.55, 0.5, 0.48), inCol * (1.0 - band(q.y, 0.0, 1.0, fq.y)) * 0.55 * dk * upper);
        col = mix(col, stone * 1.08, smoothstep(H * 0.84, H * 0.92, rel) * 0.35);
      }
      // cast-iron lofts: an entablature line at every floor
      if (abs(kind - 4.0) < 0.5) col = mix(col, col * 1.18 + 0.01, pulse(fv, 0.0, 0.1, cpp.y) * 0.9 * dk);
      // post-war: concrete slab edges at each floor
      if (abs(kind - 5.0) < 0.5) col = mix(col, stone * 1.12, pulse(fv, 0.02, 0.09, cpp.y) * 0.75 * dk * upper);
      // rusticated stone base with a belt course above it (pre-war, rowhouse stoops, civic)
      if (rustF > 0.5) {
        float rustH = gfh + (rustF - 1.0) * fh;
        float inR = 1.0 - clamp((rel - rustH) / fwR + 0.5, 0.0, 1.0);
        col = mix(col, stone * 0.96, inR * (kind > 0.5 && kind < 1.5 ? 0.35 : 0.55) * (1.0 - inShop));
        float gw = fwR / 0.62;
        col *= 1.0 - 0.3 * pulse(rel / 0.62, 0.0, 0.14, gw) * inR * (1.0 - smoothstep(0.25, 0.6, gw)) * uDetail;
        col = mix(col, stone * 1.1, band(rel, rustH, rustH + 0.45, fwR) * 0.85);
        col *= 1.0 - 0.22 * band(rel, rustH - 0.4, rustH, fwR);
      }
      // fire escapes on walk-ups: platforms, railings, posts and the ladder across a pair of bays, in front of the windows
      if (fesc > 0.0) {
        float bx = u / (pitch * 2.0), fwB = fwidth(bx) + 1e-4;
        float onB = step(h21(vec2(floor(bx), sd * 1.3 + 2.0)), 0.3 * fesc) * dk * upper * step(1.6, top);
        float fy = fract(fv), fx = fract(bx);
        float fe = band(fy, 0.0, 0.07, cpp.y) * 0.95 + band(fy, 0.3, 0.335, cpp.y) * 0.7
                 + (band(fx, 0.03, 0.06, fwB) + band(fx, 0.94, 0.97, fwB)) * 0.6
                 + band(fy - fx * 0.85, 0.06, 0.12, cpp.y + fwB) * band(fx, 0.12, 0.88, fwB) * 0.6;
        fe = clamp(fe, 0.0, 1.0) * onB;
        col *= 1.0 - 0.12 * onB;
        col = mix(col, vec3(0.025, 0.028, 0.035), fe * 0.85);
        cov *= 1.0 - fe * 0.75;
      }
    }
    // --- cornice: a stone (or painted pressed-metal) band at the roofline with a shadow line under it; a pale coping catches the sky
    if (corn > 0.0) {
      vec3 cc = kind < 0.5 && h21(vec2(sd, 12.0)) < 0.5 ? mix(base * 0.55, ${glsl('#5d6255')}, 0.4) * nightK : stone * 1.08;
      col = mix(col, cc, band(top, 0.15, 1.0, fwR) * corn);
      col *= 1.0 - 0.32 * corn * band(top, 1.0, 1.45, fwR);
      if (abs(kind - 2.0) < 0.5 && H > 40.0) { float c2 = H - 3.0 * fh; col = mix(col, stone * 1.05, band(rel, c2, c2 + 0.6, fwR) * 0.8); col *= 1.0 - 0.2 * band(rel, c2 - 0.5, c2, fwR); }
    }
    col = mix(col, col * 1.22 + 0.015 * (1.0 - uGlow), band(top, -1.0, 0.22, fwR) * 0.8);
    // curtain walls: dark spandrel panels, a faint vertical gradient
    if (glass > 0.5) col = mix(base * 0.72, base * (0.8 + 0.3 * smoothstep(0.0, 1.0, fract(rel / 37.0))), 0.6);
    // ambient occlusion at the street and a slightly darker canyon for the lower floors
    col *= mix(0.62, 1.0, smoothstep(0.0, 3.2, rel)) * mix(0.86, 1.0, smoothstep(0.0, 26.0, rel));
    // --- windows
    vec2 cid = cell + vec2(sd * 13.0, sd * 7.0) + floor(wn.xz * 2.0 + 0.5) * 31.0;
    float hh = h21(cid);
    // offices behind curtain walls light up a floor (or a bay of it) at a time, and only a few at night
    if (glass > 0.5) hh = mix(h21(vec2(cell.y, floor(cell.x / 6.0)) + vec2(sd * 3.1, sd)), hh, 0.25);
    float bLit = 0.35 + 1.1 * h21(vec2(sd, 17.0));      // some buildings are mostly dark, some busy
    float litP = mix(0.05, 0.3, uGlow) * litK * bLit;
    float lit = step(hh, litP);
    float flick = step(0.93, h21(cid * 1.3 + 7.0));
    lit *= 1.0 - flick * step(0.5, fract(uTime * 0.015 + h21(cid + 3.0)));
    float wI = mix(0.55 + 0.45 * h21(cid * 2.3 + 5.0), 0.78, far);
    vec3 warm = mix(WIN_WARM, WIN_AMBER, mix(h21(cid * 1.7 + 2.0), 0.4, far));
    vec3 litCol = mix(mix(warm, WIN_COOL, step(0.83, h21(cid * 3.1))), mix(warm, WIN_COOL, 0.17), far);
    lit = mix(lit, litP * (1.0 - 0.45 * glass), far);
    if (ground > 0.5) { lit = step(hh, 0.55 * uGlow + 0.05) * step(st, 9.5); litCol = mix(WIN_WARM, WIN_AMBER, 0.5); }
    vec3 deep = ${glsl('#0a1430')};
    vec3 refl = uSkyRefl * (0.45 + 0.55 * uDay) * (0.65 + 0.35 * q.y);
    vec3 pane = mix(deep, refl, clamp(0.16 + 0.3 * uDay, 0.0, 1.0));     // by day a window reads dark with a little sky in it
    if (glass < 0.5) {
      // lived-in windows: a pulled blind or a pale curtain in the upper part of some panes, so the grid is not one flat stamp.
      // Far off it settles to its mean tint (no per-window pattern to shimmer).
      float hc = h21(cid * 0.71 + 13.0);
      vec3 blindC = hc < 0.5 ? ${glsl('#d9cdb4')} : (hc < 0.8 ? ${glsl('#b9b2a4')} : ${glsl('#9fb0bf')});
      float blindH = 0.25 + 0.6 * h21(cid * 1.9 + 4.0);
      float hasB = step(0.62, hc + 0.25 * h21(vec2(sd, 21.0)));
      float bl = mix(hasB * band(q.y, 1.0 - blindH, 1.0, fq.y), 0.2, far) * (1.0 - ground);
      pane = mix(pane, blindC * (0.35 + 0.65 * uDay) * mix(vec3(1.0), nightK, 0.6), bl * 0.75);
    }
    vec3 reflE = vec3(0.0);
    if (glass > 0.5) {
      // glass: a dark tinted pane that mirrors the sky, brighter at grazing angles, each panel tilted a touch differently
      vec3 V = normalize(-vRel), R = reflect(-V, wn);
      float fres = pow(1.0 - clamp(dot(wn, V), 0.0, 1.0), 3.0);
      vec3 sky = mix(uSkyRefl, uSkyTop, clamp(R.y * 1.6 + 0.25, 0.0, 1.0));
      float cl = vn2(vec2(u * 0.012 + sd, rel * 0.008));
      float tilt = mix(h21(cell + sd * 3.0), 0.5, far);
      pane = mix(base * 0.42, deep, 0.35);
      reflE = sky * (0.1 + 0.6 * fres) * (0.7 + 0.6 * cl) * (0.82 + 0.36 * tilt) * (0.3 + 0.7 * uDay);
      // a centre mullion in each bay, close up
      cov *= 1.0 - band(q.x, 0.485, 0.515, fq.x) * 0.85 * dk;
    }
    col = mix(col, pane, cov);
    float on = lit * uGlow;
    float wk = 1.1 - 0.45 * glass;
    float em0 = cov * wI * on * wk;
    bEmis += reflE * cov * (1.0 - on);
    // far away the window grid would alias into noise: keep the sparkle by lighting coarser blocks of windows instead
    float lvf = cm * 2.4;
    if (lvf > 1.0 && ground < 0.5) {
      float gs = exp2(min(floor(log2(lvf * 1.6)) + 1.0, 5.0));
      vec2 bcu = cu / gs; vec2 bc = floor(bcu), bf = fract(bcu);
      float bh = h21(bc + vec2(sd * 5.3, sd * 2.9) + gs * 7.0);
      vec2 bq = abs(bf - 0.5) * 2.0, bw = fwidth(bcu) * 2.0 + 1e-4;
      float bm = clamp((0.62 - bq.x) / bw.x + 0.5, 0.0, 1.0) * clamp((0.62 - bq.y) / bw.y + 0.5, 0.0, 1.0);
      float blit = step(bh, litP * 1.25 * (1.0 - 0.45 * glass));
      float sp = bm * blit * (1.0 - cor) * step(0.35, rel) * uDetail;
      em0 = mix(em0, sp * fl.x * fl.y / 0.385 * 0.78 * uGlow * wk, far);
    }
    bEmis += litCol * em0;
    col = mix(col, litCol * 0.45, cov * on * 0.35 * (1.0 - glass * 0.6));
    // --- shopfronts: glazed bays under a sign band, warm inside, a few shutters down; neon in some signs after dark
    if (shopOn > 0.5) {
      float su = u / 5.5, fwS = fwidth(su) + 1e-4, sb = floor(su), sfx = fract(su), farS = smoothstep(0.3, 0.8, fwS);
      float h1 = mix(h21(vec2(sb, sd * 1.7)), 0.5, farS), h2 = mix(h21(vec2(sb, sd * 2.3 + 5.0)), 0.3, farS), h3 = h21(vec2(sb, sd + 9.0));
      float glzX = mix(band(sfx, 0.07, 0.93, fwS), 0.86, farS);
      float glz = glzX * band(rel, 0.3, gfh * 0.7, fwR);
      float fas = band(rel, gfh * 0.74, gfh * 0.93, fwR) * mix(band(sfx, 0.02, 0.98, fwS), 0.96, farS);
      vec3 signC = h1 < 0.25 ? ${glsl('#7a2b28')} : (h1 < 0.45 ? ${glsl('#24452f')} : (h1 < 0.65 ? ${glsl('#1e2c47')} : (h1 < 0.8 ? ${glsl('#2b2a2e')} : ${glsl('#c4ad84')})));
      float open = mix(step(h2, 0.82), 0.82, farS);
      vec3 glzC = mix(${glsl('#6e737a')}, mix(${glsl('#141820')}, WIN_AMBER * 0.3, 0.45 + 0.3 * uDay), open);
      col = mix(col, glzC * mix(vec3(1.0), nightK, 0.5), glz);
      col = mix(col, signC * nightK, fas);
      float sFade = 1.0 - smoothstep(1.2, 3.0, fwR);
      bEmis += WIN_AMBER * glz * open * (0.12 + 1.25 * uGlow) * sFade;
      vec3 neon = h3 < 0.5 ? vec3(1.0, 0.42, 0.32) : vec3(0.42, 0.82, 1.0);
      bEmis += mix(neon, signC * 3.0, 0.4) * fas * step(h3, 0.32) * (1.0 - farS) * uGlow * 0.5 * sFade;
    }
    // the street's light on the lower walls after dark (shop windows, lamps)
    bEmis += WIN_AMBER * 0.055 * uGlow * (1.0 - smoothstep(0.0, 10.0, rel)) * (0.35 + 0.65 * shopOn);
    // Times Square: billboards wrap the lower floors near the bow tie
    float tsq = 1.0 - smoothstep(130.0, 230.0, length(vWP.xz - uTsq));
    if (tsq > 0.0 && rel > 4.0 && rel < 58.0 + 40.0 * step(3.5, acc) * step(acc, 4.5)) {
      vec2 bp = vec2(u / 9.0, rel / 7.0); vec2 bc = floor(bp), bf = fract(bp);
      float panel = step(0.05, bf.x) * step(bf.x, 0.95) * step(0.08, bf.y) * step(bf.y, 0.92) * step(0.35, h21(bc + sd));
      float ph = floor(uTime * 0.35 + h21(bc) * 9.0), h2 = h21(bc + ph * 1.7 + 11.0);
      vec3 hue = h2 < 0.3 ? vec3(1.0, 0.58, 0.26) : (h2 < 0.55 ? vec3(0.32, 0.82, 1.0) : (h2 < 0.78 ? vec3(1.0, 0.4, 0.62) : vec3(1.0, 0.92, 0.74)));
      hue = mix(hue, uLmCol[4], uLmLvl[4] * 0.45 * step(0.5, h21(bc + 4.0)));
      float m = panel * tsq;
      col = mix(col, hue * 0.3, m * 0.8);
      bEmis += hue * m * (0.5 + 0.5 * uGlow) * (0.85 + 0.6 * uLmLvl[4] + uLmFlash[4] * 2.0);
    }
  }
  // blue hour: a little of the city's own glow on the walls, so the masonry keeps its colour after dark instead of going black.
  // Lower walls take the street's warm bounce, upper walls the cool of the sky; walls turned to the sky's afterglow (west-ish)
  // hold a touch more, so the blocks keep their form at night instead of reading as flat navy slabs.
  {
    float relB = vWP.y - (vB.x * 0.1 - 100.0), topB = vB.y * 0.1 - relB;
    float up = smoothstep(4.0, 60.0, relB);
    vec3 bounce = mix(vec3(1.06, 0.97, 0.86), vec3(0.86, 0.95, 1.12), up);
    float face = 0.85 + 0.3 * clamp(-wn.x * 0.8 + wn.z * 0.35, -1.0, 1.0);
    bEmis += col * bounce * 0.15 * face * uGlow * wall;
    // sky rim: the parapet coping and the top metre of wall catch the last of the sky (night) or a soft highlight (day), box-filtered
    float fwT = fwidth(topB) + 1e-4;
    float rim = band(topB, -0.6, 0.55, fwT) * wall * (1.0 - smoothstep(1.5, 4.0, fwT));
    bEmis += mix(uSkyRefl, uSkyTop, 0.3) * rim * 0.22 * uGlow;
  }
  // accent lighting on the notables (the ladder landmarks grow brighter and take their ladder colour as they unlock)
  float night = 0.25 + 0.75 * uGlow;
  if (acc > 0.5) {
    if (acc < 1.5) {              // Empire State: the lit tower top above the 72nd-floor setback, the mast
      float kk = smoothstep(262.0, 270.0, rel);
      float band = 0.65 + 0.35 * step(0.5, fract(rel / 6.0));
      vec3 c = mix(mix(C_BEACON, C_ACCENT, 0.5), uLmCol[1], uLmLvl[1] * 0.85);
      bEmis += c * kk * band * night * (0.3 + 1.0 * uLmLvl[1] + uLmFlash[1] * 3.0) * (rel > 381.0 ? 1.5 : 1.0);
      col = mix(col, c * 0.5, kk * 0.5);
    } else if (acc < 2.5) {       // Chrysler: the terraced crown with its triangular windows, the needle
      float kk = smoothstep(236.0, 242.0, rel);
      float tri = step(0.55, fract(rel / 5.5 + abs(fract(dot(vWP.xz, vec2(0.7, 0.7)) / 9.0) - 0.5) * 1.4));
      vec3 c = mix(${glsl('#fff1d2')}, uLmCol[2], uLmLvl[2] * 0.7);
      bEmis += c * kk * (0.35 + 0.65 * tri) * night * (1.1 + 1.4 * uLmLvl[2] + uLmFlash[2] * 3.0);
      col = mix(col, ${glsl('#c9ccd3')}, kk * 0.6);
    } else if (acc < 3.5) {       // Flatiron: floodlit limestone (a city favourite, not tied to a ladder)
      bEmis += C_LIME * wall * (0.25 + 0.35 * smoothstep(0.0, 85.0, rel)) * night * 0.4;
    } else if (acc < 4.5) {       // One Times Square: the screen stack (handled with the billboards above) and a top glow
      bEmis += uLmCol[4] * smoothstep(H - 7.0, H - 3.0, rel) * night * (0.15 + 0.6 * uLmLvl[4] + uLmFlash[4] * 2.0) * 0.5;
    } else if (acc < 5.5) {       // One World Trade: white spire and crown
      bEmis += C_BEACON * smoothstep(410.0, 418.0, rel) * night * 1.6;
    } else if (acc < 6.5) {       // other landmarks: soft warm uplight
      bEmis += C_LIME * wall * (1.0 - smoothstep(0.0, 36.0, rel)) * 0.12 * uGlow;
    } else if (acc < 7.5) {       // Low Library: the dome and colonnade lit warm
      bEmis += C_LIME * (0.16 + 0.34 * smoothstep(18.0, 30.0, rel)) * uGlow * 0.55;
    } else if (acc > 8.5) {       // Butler Library (Papers): the colonnade and the roofline, one bay lit per section
      vec2 tg9 = normalize(vec2(-wn.z, wn.x) + 1e-5);
      float bay = mod(floor((dot(vLoc, tg9) + sd * 1.7) / 13.0), 5.0);
      float lit9 = step(bay + 0.5, floor(uLmLvl[3] * 5.0 + 0.5));
      vec3 c9 = mix(C_LIME, uLmCol[3], 0.65);
      float band9 = smoothstep(4.0, 9.0, rel) * (1.0 - smoothstep(H * 0.62, H * 0.72, rel));       // the tall order of columns
      float cornice9 = smoothstep(H - 5.0, H - 2.5, rel);
      bEmis += c9 * wall * night * ((0.1 + 0.24 * band9 + 0.5 * cornice9) * (0.25 + 0.75 * lit9) + (0.9 * lit9 * band9 + 1.0 * cornice9 * lit9) * (0.35 + uLmFlash[3] * 3.0));
      col = mix(col, C_LIME * 0.75, 0.45 * wall);
    } else {                      // Woolworth / 30 Rock / Grand Central: crown light
      bEmis += mix(WIN_WARM, C_LIME, 0.5) * smoothstep(H * 0.82, H * 0.9, rel) * wall * night * 0.5;
    }
  }
  // the user's district fog: locked neighbourhoods sit desaturated and dim under a soft veil
  gLocked = lockedAt(vWP.xz);
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, vec3(lum) * vec3(0.78, 0.86, 1.04), gLocked * 0.75) * (1.0 - 0.42 * gLocked);
  bEmis *= 1.0 - 0.88 * gLocked;
  diffuseColor.rgb = col;
}
`;

/** the building material (one for every tile) */
export function createBuildingMaterial(U) {
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.FrontSide });
  mat.customProgramCacheKey = () => 'mh-bld-2';
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + BVERT_PARS).replace('#include <project_vertex>', BVERT_MAIN);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + BFRAG_PARS)
      .replace('#include <color_fragment>', BFRAG_COLOR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmis;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uLockCol, gLocked * (0.28 + 0.4 * (1.0 - smoothstep(0.0, 140.0, vWP.y))));');
  };
  return mat;
}

/* ------------------------------------------------------------------ the streaming / LOD manager */
// Every tile has up to three LODs. Each update picks a wanted LOD per tile from its distance to the camera (times the device's
// LOD bias), keeps the visible total under the triangle budget by coarsening the farthest tiles first, loads what is missing
// (nearest and visible first, a few at a time) and shows the best loaded LOD meanwhile. Unshown fine LODs are evicted LRU.
export function createTileManager({ base, manifest, mat, parent, budget, bias, memBudget, onChange, onTile }) {
  const T = manifest.tiles.map((t) => {
    const lods = [0, 1, 2].map((n) => t.lods[n] || null);
    const box = new THREE.Box3();
    for (const e of lods) if (e) { const b = e.bounds; box.union(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]))); }
    return { x: t.x, z: t.z, lods, box, grp: [null, null, null], state: [0, 0, 0], shown: -1, used: 0, dist: 0, vis: false, want: 2, data: [null, null, null] };
  });
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), boxE = new THREE.Box3();
  let inflight = 0, bytes = 0, stamp = 0, firstAll = null;
  const MAXQ = 4;
  const stats = { tris: 0, shownTiles: [0, 0, 0], loaded: 0, bytes: 0, loads: 0, decodeMs: 0, firstFull: 0 };

  function load(t, n) {
    t.state[n] = 1; inflight++;
    const e = t.lods[n], t0 = performance.now();
    fetch(new URL(e.file, base)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((buf) => {
      const t1 = performance.now();
      const d = decodeTile(buf);
      const g = new THREE.Group(); g.name = `tile ${t.x},${t.z} lod${n}`;
      for (const m of tileMeshes(d, mat)) g.add(m);
      g.visible = false; parent.add(g);
      t.grp[n] = g; t.data[n] = d; t.state[n] = 2; bytes += e.bytes; stats.loads++;
      stats.decodeMs += performance.now() - t1;
      onTile?.(t, n, d, performance.now() - t0);
    }).catch((err) => { t.state[n] = 3; console.warn('tile', e.file, err); }).finally(() => { inflight--; onChange?.(); });
  }
  function evict(t, n) {
    const g = t.grp[n]; if (!g) return;
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    parent.remove(g); t.grp[n] = null; t.data[n] = null; t.state[n] = 0; bytes -= t.lods[n].bytes;
    onTile?.(t, n, null, 0);
  }

  function update(camera, force = 0) {
    stamp++;
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const cp = camera.position;
    const scaleK = bias;
    for (const t of T) {
      boxE.copy(t.box).expandByScalar(40);
      t.vis = frustum.intersectsBox(boxE);
      t.dist = t.box.distanceToPoint(cp);
      let w = t.dist < 1350 * scaleK ? 0 : t.dist < 4600 * scaleK ? 1 : 2;
      t.want = w;
    }
    // triangle budget: coarsen the farthest visible tiles until it fits
    const vis = T.filter((t) => t.vis).sort((a, b) => a.dist - b.dist);
    const triOf = (t, n) => { let k = n; while (k < 3 && !t.lods[k]) k++; if (k >= 3) { k = n; while (k >= 0 && !t.lods[k]) k--; } return t.lods[k] ? t.lods[k].tris : 0; };
    let sum = 0; for (const t of vis) sum += triOf(t, t.want);
    for (let i = vis.length - 1; i >= 0 && sum > budget; i--) {
      const t = vis[i]; while (t.want < 2 && sum > budget) { sum -= triOf(t, t.want); t.want++; sum += triOf(t, t.want); }
    }
    for (let i = vis.length - 1; i >= 0 && sum > budget; i--) { const t = vis[i]; sum -= triOf(t, t.want); t.want = 3; }      // last resort: drop the farthest tiles
    // what to show now, what to load
    const queue = [];
    let shownTris = 0; stats.shownTiles = [0, 0, 0];
    for (const t of T) {
      let w = t.want;
      if (w < 3) { if (!t.lods[w]) { let k = w; while (k < 3 && !t.lods[k]) k++; if (k >= 3) { k = w; while (k >= 0 && !t.lods[k]) k--; } w = k; } }
      let show = -1;
      if (w >= 0 && w < 3) {
        if (t.state[w] === 2) show = w;
        else {
          if (t.state[w] === 0 && (t.vis || t.dist < 2500)) queue.push({ t, n: w, p: (t.vis ? 0 : 1e6) + t.dist * (w === 2 ? 0.2 : 1) });
          // meanwhile: the nearest loaded LOD, finer first when it is within budget, otherwise coarser
          for (const k of [w + 1, w - 1, w + 2, w - 2]) if (k >= 0 && k < 3 && t.state[k] === 2) { show = k; break; }
        }
      }
      for (let n = 0; n < 3; n++) if (t.grp[n]) t.grp[n].visible = n === show && t.vis;
      t.shown = show; if (show >= 0) { t.used = stamp; if (t.vis) { shownTris += t.lods[show].tris; stats.shownTiles[show]++; } }
    }
    queue.sort((a, b) => a.p - b.p);
    while (inflight < MAXQ && queue.length) { const q = queue.shift(); load(q.t, q.n); }
    // memory: drop the least recently shown fine LODs beyond the budget
    if (bytes > memBudget) {
      const cands = [];
      for (const t of T) for (let n = 0; n < 2; n++) if (t.state[n] === 2 && t.shown !== n) cands.push({ t, n, u: t.used, d: t.dist });
      cands.sort((a, b) => a.u - b.u || b.d - a.d);
      for (const c of cands) { if (bytes <= memBudget) break; evict(c.t, c.n); }
    }
    stats.tris = shownTris; stats.loaded = T.reduce((s, t) => s + t.state.filter((x) => x === 2).length, 0); stats.bytes = bytes; stats.inflight = inflight; stats.queued = queue.length;
    if (!firstAll && !queue.length && !inflight) firstAll = performance.now();
    stats.idle = !queue.length && !inflight;
    return stats;
  }
  /** load every tile's coarsest LOD first (the whole island, ~1.6 MB) */
  function preloadCoarse() { for (const t of T) { const n = t.lods[2] ? 2 : 1; if (t.state[n] === 0) load(t, n); } }
  return { T, update, stats, preloadCoarse, get busy() { return inflight > 0; } };
}
