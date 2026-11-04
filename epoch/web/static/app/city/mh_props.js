// city/mh_props.js · instanced detail on real Manhattan: trees (the real street trees of the 2015 census plus park trees),
// avenue and street lamps (one point each, glowing at night), rooftop water towers on pre-war mid-rises and mechanical boxes.
// Everything is binned per 1.5 km tile so only the tiles near the camera draw it.
import * as THREE from 'three';
import { MS } from './palette.js';
import { COMMON_GLSL } from './mh_tiles.js';
import { Geo, rgb } from './util.js';
import { waterTank } from './towers.js';

const TILE = 1500;
const tkey = (x, z) => Math.floor(x / TILE) + ',' + Math.floor(z / TILE);

/* ------------------------------------------------------------------ trees */
export function decodeTrees(buf) {
  const dv = new DataView(buf), n = dv.getUint32(8, true), street = dv.getUint32(12, true);
  const a = new Float32Array(n * 4), kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = 16 + 8 * i;
    a[4 * i] = dv.getInt16(o, true) / 2; a[4 * i + 2] = dv.getInt16(o + 2, true) / 2; a[4 * i + 1] = dv.getInt16(o + 4, true) / 10; a[4 * i + 3] = dv.getUint8(o + 6) / 10; kind[i] = dv.getUint8(o + 7);
  }
  return { n, street, a, kind };
}
function treeGeometry() {
  // a low-poly crown (a squashed octahedron, 8 faces) on a 3-sided trunk; unit radius, crown centre at y = 0
  const g = new THREE.OctahedronGeometry(1, 0);
  const crown = g.index ? g.toNonIndexed() : g;             // PolyhedronGeometry is already non-indexed in three r186
  const p = crown.attributes.position.array.slice();
  for (let i = 0; i < p.length; i += 3) p[i + 1] *= 1.18;
  crown.dispose(); if (crown !== g) g.dispose();
  const trunk = [];
  const T = (a) => [Math.cos(a) * 0.12, Math.sin(a) * 0.12];
  for (let k = 0; k < 3; k++) {
    const [x0, z0] = T((k / 3) * Math.PI * 2), [x1, z1] = T(((k + 1) / 3) * Math.PI * 2);
    trunk.push(x0, -1.9, z0, x1, -1.9, z1, x1, -0.6, z1, x0, -1.9, z0, x1, -0.6, z1, x0, -0.6, z0);
  }
  const all = new Float32Array(p.length + trunk.length); all.set(p, 0); all.set(trunk, p.length);
  const part = new Float32Array(all.length / 3); part.fill(1, p.length / 3);     // 1 = trunk
  const out = new THREE.InstancedBufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(all, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return out;
}
function seasonTint() {
  const m = new Date().getMonth();          // NYC: green May-Sep, turning Oct-Nov, bare-ish brown Dec-Mar, fresh Apr
  if (m >= 9 && m <= 10) return { a: '#4d7d4a', b: '#c98a3a', mix: m === 9 ? 0.32 : 0.55 };
  if (m === 11 || m <= 2) return { a: '#4b5f4c', b: '#7a6a58', mix: 0.55 };
  if (m === 3) return { a: '#6aa768', b: '#9ccf7a', mix: 0.3 };
  return { a: '#3f7f52', b: '#5a9a62', mix: 0.3 };
}
export function createTrees(trees, U) {
  const S = seasonTint();
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const uni = { uTreeA: { value: new THREE.Color(S.a) }, uTreeB: { value: new THREE.Color(S.b) }, uTreeMix: { value: S.mix } };
  mat.customProgramCacheKey = () => 'mh-tree-1';
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U, uni);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aT; attribute float aK; attribute float aPart; varying vec3 vWP; varying float vPart; varying float vH;')
      .replace('#include <begin_vertex>', `vec3 transformed = position;
        float r = aT.w;
        vec3 sc = aPart > 0.5 ? vec3(r, r * 1.2, r) : vec3(r, r * 1.05, r);
        transformed = transformed * sc + vec3(aT.x, aT.y + r * 1.9 + 0.2, aT.z);
        vPart = aPart; vH = fract(sin(dot(aT.xz, vec2(12.9898, 78.233))) * 43758.5453) + aK * 0.0;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = transformed;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + 'varying vec3 vWP; varying float vPart; varying float vH; uniform vec3 uTreeA, uTreeB; uniform float uTreeMix; float gLocked;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 leaf = mix(uTreeA, uTreeB, clamp(uTreeMix * (0.4 + 1.2 * vH) , 0.0, 1.0)) * (0.82 + 0.3 * fract(vH * 7.3));
        diffuseColor.rgb = vPart > 0.5 ? vec3(0.22, 0.17, 0.14) : leaf;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), uSnow * 0.6 * (1.0 - vPart));
        gLocked = lockedAt(vWP.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * vec3(0.78, 0.86, 1.04), gLocked * 0.75) * (1.0 - 0.4 * gLocked);`)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uLockCol, gLocked * 0.4);');
  };
  const base = treeGeometry();
  const bins = new Map();
  for (let i = 0; i < trees.n; i++) { const k = tkey(trees.a[4 * i], trees.a[4 * i + 2]); let b = bins.get(k); if (!b) bins.set(k, (b = [])); b.push(i); }
  const groups = [];
  for (const [k, list] of bins) {
    const aT = new Float32Array(list.length * 4), aK = new Float32Array(list.length);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = 0;
    list.forEach((i, j) => { for (let c = 0; c < 4; c++) aT[4 * j + c] = trees.a[4 * i + c]; aK[j] = trees.kind[i]; const x = aT[4 * j], z = aT[4 * j + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y1 = Math.max(y1, aT[4 * j + 1] + 20); });
    const g = new THREE.InstancedBufferGeometry();
    g.index = null; g.attributes.position = base.attributes.position; g.attributes.aPart = base.attributes.aPart;
    g.setAttribute('aT', new THREE.InstancedBufferAttribute(aT, 4)); g.setAttribute('aK', new THREE.InstancedBufferAttribute(aK, 1));
    g.instanceCount = list.length;
    const box = new THREE.Box3(new THREE.Vector3(x0 - 10, -5, z0 - 10), new THREE.Vector3(x1 + 10, y1, z1 + 10));
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(g, mat); m.frustumCulled = true; m.name = 'trees ' + k; m.visible = false;
    groups.push({ key: k, mesh: m, box, count: list.length });
  }
  const trisPer = base.attributes.position.count / 3;
  return { groups, mat, trisPer };
}

/* ------------------------------------------------------------------ street lamps: one glowing point per lamp */
const LVERT = /* glsl */`
${COMMON_GLSL}
attribute float aK;
uniform float uPx, uLampSize;
varying float vA; varying float vK;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  float s = uLampSize * (aK > 0.5 ? 1.25 : 1.0) * uPx / max(d, 1.0);
  vA = smoothstep(0.5, 1.6, s) * (1.0 - smoothstep(4000.0, 9000.0, d)) * (1.0 - 0.85 * lockedAt(position.xz));
  vK = aK;
  gl_PointSize = clamp(s, 2.0, 16.0);   // lamps narrower than about a pixel fade out (see vA): a 1-2 px dot snaps from pixel to pixel as the camera moves
}
`;
const LFRAG = /* glsl */`
uniform vec3 uLampCol; uniform float uGlow;
varying float vA; varying float vK;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, r); a = a * a;
  if (a < 0.02 || vA < 0.01) discard;
  vec3 col = uLampCol * (1.6 + 2.2 * (1.0 - r)) * (0.15 + 0.85 * uGlow);
  gl_FragColor = vec4(col * a * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
export function createLamps(streets, TR, U) {
  const pts = [], kinds = [];
  const put = (x, z, k) => { pts.push(x, TR.ground(x, z) + 8.5, z); kinds.push(k); };
  for (const l of streets.lines) {
    if (l.c === 3 || l.c === 4) continue;
    const p = l.p, spacing = l.c === 1 ? 34 : l.c === 2 ? 52 : 42, off = Math.max(4, (l.w || 12) / 2 + 2.2);
    let carry = spacing * 0.5, side = 1;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      let s = carry;
      for (; s < L; s += spacing) {
        const x = ax + dx * s, z = az + dz * s;
        if (l.c === 1) { put(x + nx * off, z + nz * off, 1); put(x - nx * off, z - nz * off, 1); }
        else if (l.c === 2) put(x, z, 0);
        else { put(x + nx * off * side, z + nz * off * side, 0); side = -side; }
      }
      carry = s - L;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(kinds, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    vertexShader: LVERT, fragmentShader: LFRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: Object.assign({}, U, { uPx: { value: 800 }, uLampSize: { value: 5.5 }, uLampCol: { value: new THREE.Color(MS.lamp) } }),
  });
  const pointsMesh = new THREE.Points(g, mat); pointsMesh.name = 'lamps'; pointsMesh.frustumCulled = false; pointsMesh.renderOrder = 5;
  return { mesh: pointsMesh, mat, count: kinds.length };
}

/* ------------------------------------------------------------------ rooftop water towers and mechanical boxes (per LOD0 tile) */
let tankGeo = null, boxGeo = null;
function geos() {
  if (tankGeo) return;
  const g = new Geo(); waterTank(g, 0, 0, 0, 1); tankGeo = g.build(); tankGeo.deleteAttribute('aA');
  // a stair / elevator bulkhead: a masonry box under a slightly overhanging cap, a dark door on one side and a vent on top. Neutral
  // greys here; each instance is tinted to its building (brick, buff, concrete) through the instance colour.
  const b = new Geo();
  b.box(-0.5, 0, -0.5, 0.5, 1, 0.5, rgb('#d9d9d9'), { ctop: rgb('#bdbdbd') });
  b.box(-0.56, 1, -0.56, 0.56, 1.09, 0.56, rgb('#f2f2f2'), { ctop: rgb('#9a9a9a') });
  b.box(-0.17, 0, 0.5, 0.17, 0.72, 0.53, rgb('#3a3a3a'));
  b.box(-0.22, 1.09, -0.28, 0.12, 1.36, 0.06, rgb('#b8b8b8'));
  boxGeo = b.build(); boxGeo.deleteAttribute('aA');
}
const roofMats = new WeakMap(); let roofPlain = null;
// one material per stage (each stage has its own uniforms). Water towers and boxes take the same district veil as the buildings under them, so locked rooftops do not float dark in the mist
function roofMaterial(U) {
  if (!U) return roofPlain || (roofPlain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  if (roofMats.has(U)) return roofMats.get(U);
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }); roofMats.set(U, roofMat);
  roofMat.customProgramCacheKey = () => 'mh-roof-2';
  roofMat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 wpR = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nwpR = instanceMatrix * wpR;\n#endif\nvWP = (modelMatrix * wpR).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + 'varying vec3 vWP; float gLocked;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (cutAway(vWP - cameraPosition) > cutNoise(gl_FragCoord.xy) * 0.999 + 0.001) discard;
        gLocked = lockedAt(vWP.xz);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * vec3(0.78, 0.86, 1.04), gLocked * 0.75) * (1.0 - 0.42 * gLocked);`)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uLockCol, gLocked * (0.28 + 0.4 * (1.0 - smoothstep(0.0, 140.0, vWP.y))));');
  };
  return roofMat;
}
// bulkhead tints by the building's style: brick on walk-ups and pre-wars, buff and white brick on post-wars, concrete and metal on towers
const BULK = { brick: ['#8a5444', '#7a4a3c', '#9c6a52'], buff: ['#b9a78d', '#c8bba5', '#a8987f'], metal: ['#7d8796', '#8e959e', '#6f7884'] };
const bulkCols = Object.fromEntries(Object.entries(BULK).map(([k, v]) => [k, v.map((h) => new THREE.Color(h))]));
function bulkTint(st, r) {
  const fam = st === 1 || st === 2 || st === 3 || st === 7 || st === 0 ? 'brick' : st === 6 || st === 4 || st === 8 || st === 9 ? 'buff' : 'metal';
  const list = bulkCols[fam]; return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
/** finds rooftops in a decoded LOD0 tile and returns {grp, tris} with instanced water towers and boxes */
export function buildRoofProps(t, excludeBins, U) {
  geos(); const roofMat = roofMaterial(U);
  const h = t.h, pos = t.pos, tanks = [], boxes = [];
  for (const b of t.blds) {
    if (!b.bin || (b.flags & 16) || (excludeBins && excludeBins.has(b.bin))) continue;
    const st = b.style, H = b.h, r = ((b.seed * 2654435761) >>> 0) / 4294967296, r2 = ((b.seed * 40503 + 977) >>> 0) % 1000 / 1000;
    const prewarish = (st === 1 || st === 3 || st === 7 || (st === 0 && H < 60) || st === 6) && (b.year === 0 || b.year < 1965);
    const modern = st === 5 || st === 13 || st === 6 || st === 9 || st === 8;
    const wantTank = prewarish && H >= 14 && H <= 80 && r < (st === 3 || st === 7 ? 0.55 : 0.32);
    const wantBox = !wantTank && (modern || H > 24) && r < 0.7 && H > 9;
    if (!wantTank && !wantBox) continue;
    // the top roof: the vertices within 0.4 m of the highest point
    let ym = -1e9;
    for (let v = b.vF; v < b.vF + b.vC; v++) { const y = pos[3 * v + 1]; if (y > ym) ym = y; }
    let sx = 0, sz = 0, n = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const lim = ym - 0.4 / h.ys;
    for (let v = b.vF; v < b.vF + b.vC; v++) if (pos[3 * v + 1] >= lim) { const x = pos[3 * v], z = pos[3 * v + 2]; sx += x; sz += z; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!n) continue;
    const span = Math.min(x1 - x0, z1 - z0) * h.ps; if (span < (wantTank ? 7 : 6)) continue;
    const cx = h.ox - h.pad + (sx / n) * h.ps, cz = h.oz - h.pad + (sz / n) * h.ps, cy = h.yo + ym * h.ys;
    const off = (r2 - 0.5) * span * 0.35;
    if (wantTank) tanks.push([cx + off, cy, cz - off * 0.6, 13 + r2 * 4, r * 6.28]);
    else boxes.push([cx - off, cy, cz + off * 0.5, Math.min(span * 0.42, 4 + r2 * 9), r * 6.28, 2.2 + r * 2.2, bulkTint(st, r2)]);
  }
  const grp = new THREE.Group(); grp.name = 'roofprops';
  let tris = 0;
  if (tanks.length) {
    const im = new THREE.InstancedMesh(tankGeo, roofMat, tanks.length);
    tanks.forEach(([x, y, z, s, a], i) => { tmpQ.setFromAxisAngle(UP, a); tmpS.set(s, s, s); tmpP.set(x, y, z); im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); });
    im.computeBoundingSphere(); grp.add(im); tris += tanks.length * tankGeo.index.count / 3;
  }
  if (boxes.length) {
    const im = new THREE.InstancedMesh(boxGeo, roofMat, boxes.length);
    boxes.forEach(([x, y, z, s, a, hh, c], i) => { tmpQ.setFromAxisAngle(UP, a); tmpS.set(s, hh, s * 0.7); tmpP.set(x, y, z); im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS)); im.setColorAt(i, c); });
    im.computeBoundingSphere(); grp.add(im); tris += boxes.length * boxGeo.index.count / 3;
  }
  return { grp, tris, tanks: tanks.length, boxes: boxes.length };
}
