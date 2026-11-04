// city/mh_ground.js · the ground of real Manhattan: terrain, a painted map texture (blocks, streets, parks, tree canopy,
// lakes, the user's lots), the bulkhead edge, the rivers, a faint far shore, and the district mask.
// Everything is drawn in the street-grid frame (u across the avenues, v along them), so the grid is crisp on the texture.
import * as THREE from 'three';
import { MS, glsl } from './palette.js';
import { CA, SA, toU, toV, fromUV, COMMON_GLSL } from './mh_tiles.js';

const ring2 = (f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; };

/* ------------------------------------------------------------------ terrain + roof height samplers */
export function makeTerrain(buf) {
  const dv = new DataView(buf);
  const T = { cell: dv.getFloat32(8, true), ox: dv.getFloat32(12, true), oz: dv.getFloat32(16, true), nx: dv.getUint32(20, true), nz: dv.getUint32(24, true), unit: dv.getFloat32(28, true) };
  const a = new Int16Array(buf, 32, T.nx * T.nz);
  const at = (c, r) => { if (c < 0 || r < 0 || c >= T.nx || r >= T.nz) return null; const v = a[r * T.nx + c]; return v === -32768 ? null : v * T.unit; };
  function h(x, z) {
    const fx = (x - T.ox) / T.cell - 0.5, fz = (z - T.oz) / T.cell - 0.5, c = Math.floor(fx), r = Math.floor(fz), p = fx - c, q = fz - r;
    let s = 0, w = 0;
    const v00 = at(c, r), v10 = at(c + 1, r), v01 = at(c, r + 1), v11 = at(c + 1, r + 1);
    if (v00 != null) { s += v00 * (1 - p) * (1 - q); w += (1 - p) * (1 - q); }
    if (v10 != null) { s += v10 * p * (1 - q); w += p * (1 - q); }
    if (v01 != null) { s += v01 * (1 - p) * q; w += (1 - p) * q; }
    if (v11 != null) { s += v11 * p * q; w += p * q; }
    return w > 1e-3 ? s / w : null;
  }
  const isLand = (x, z) => at(Math.floor((x - T.ox) / T.cell), Math.floor((z - T.oz) / T.cell)) != null;
  /** ground surface the renderer draws (a little under the data so it never pokes through a facade; never below the bulkhead) */
  const ground = (x, z) => { const v = h(x, z); return v == null ? 0.9 : Math.max(0.9, v - 1.0); };
  return { T, h, isLand, ground };
}
export function makeHeights(buf) {
  const dv = new DataView(buf);
  const H = { cell: dv.getFloat32(8, true), ox: dv.getFloat32(12, true), oz: dv.getFloat32(16, true), nx: dv.getUint32(20, true), nz: dv.getUint32(24, true) };
  const a = new Int16Array(buf, 32, H.nx * H.nz);
  /** highest roof within r metres of (x, z), or -1e9 */
  return function roofAt(x, z, r = 12) {
    const c0 = Math.floor((x - r - H.ox) / H.cell), c1 = Math.floor((x + r - H.ox) / H.cell), r0 = Math.floor((z - r - H.oz) / H.cell), r1 = Math.floor((z + r - H.oz) / H.cell);
    let m = -1e9;
    for (let rr = Math.max(0, r0); rr <= Math.min(H.nz - 1, r1); rr++) for (let cc = Math.max(0, c0); cc <= Math.min(H.nx - 1, c1); cc++) { const v = a[rr * H.nx + cc]; if (v !== -32768 && v * 0.1 > m) m = v * 0.1; }
    return m;
  };
}

/* ------------------------------------------------------------------ frame of the painted textures */
export function makeFrame(land, mppWanted, maxPx) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const poly of land.polys) for (let i = 0; i < poly[0].length; i += 2) { const x = poly[0][i], z = poly[0][i + 1], u = toU(x, z), v = toV(x, z); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const M = 320; u0 -= M; u1 += M; v0 -= M; v1 += M;
  const mpp = Math.max(mppWanted, (v1 - v0) / maxPx, (u1 - u0) / maxPx);
  const W = Math.ceil((u1 - u0) / mpp), H = Math.ceil((v1 - v0) / mpp);
  u1 = u0 + W * mpp; v1 = v0 + H * mpp;
  return { u0, u1, v0, v1, mpp, W, H, xf: new THREE.Vector4(u0, v0, 1 / (u1 - u0), 1 / (v1 - v0)) };
}
function ctxFor(F, scale = 1) {
  const c = document.createElement('canvas'); c.width = Math.round(F.W / scale); c.height = Math.round(F.H / scale);
  const x = c.getContext('2d');
  const m = F.mpp * scale;
  x.setTransform(CA / m, -SA / m, SA / m, CA / m, -F.u0 / m, F.v1 / m);           // draw straight in metres (x, z)
  return { c, x, m };
}
function polyPath(x, rings) { for (const f of rings) { for (let i = 0; i < f.length; i += 2) { if (i === 0) x.moveTo(f[0], f[1]); else x.lineTo(f[i], f[i + 1]); } x.closePath(); } }
function linePath(x, f) { for (let i = 0; i < f.length; i += 2) { if (i === 0) x.moveTo(f[0], f[1]); else x.lineTo(f[i], f[i + 1]); } }

// ground palette (sRGB): pale limestone sidewalks, blue-slate asphalt, blue-hour park greens
const G = {
  block: '#8f8b84', blockAlt: '#99948b', street: '#363e4f', avenue: '#323a4b', highway: '#3a4254', path: '#b9ad93',
  grass: '#4c8a5d', grassDeep: '#3f7a53', play: '#6f8873', plaza: '#a29d92', court: '#577a68', woods: '#3c6e4c',
  canopy: '#2f5f41', canopyStreet: '#365f45', lake: '#203f69', home: '#c4d6e8', homeEdge: '#8CC4EE',
};
const PARK_COL = { 'Playground': G.play, 'Jointly Operated Playground': G.play, 'Recreational Field/Courts': G.court, 'Triangle/Plaza': G.plaza, 'Mall': G.grass, 'Buildings/Institutions': G.plaza, 'Waterfront Facility': G.plaza, 'Nature Area': G.woods, 'Managed Sites': G.plaza };

/** paints the ground and aux textures. aux: r = night street glow, g = land/shore proximity (water foam), b = lake */
export function paintGround(F, D, { trees, home }) {
  const t0 = performance.now();
  const { c, x } = ctxFor(F, 1);
  x.lineJoin = 'round'; x.lineCap = 'round';
  // land
  x.fillStyle = G.block; x.beginPath(); for (const p of D.land.polys) polyPath(x, p); x.fill('evenodd');
  // parks
  for (const pk of D.parks.parks) {
    const ty = D.parks.types[pk.t];
    x.fillStyle = PARK_COL[ty] || (pk.a > 40 ? G.grassDeep : G.grass);
    x.beginPath(); polyPath(x, pk.p); x.fill('evenodd');
  }
  // tree canopy (real street-tree positions and the park trees), painted so it reads from far away too
  if (trees) {
    x.fillStyle = G.canopy;
    const n = trees.n, a = trees.a;
    for (let i = 0; i < n; i++) {
      const tx = a[4 * i], tz = a[4 * i + 2], r = a[4 * i + 3] * 0.95;
      if (i === trees.street) x.fillStyle = G.canopy;
      x.beginPath(); x.arc(tx, tz, r, 0, Math.PI * 2); x.fill();
    }
  }
  // lakes
  x.fillStyle = G.lake; x.beginPath(); for (const l of D.hydro.lakes) polyPath(x, l.p); x.fill('evenodd');
  // streets: paths, streets, avenues, highways (bridges are geometry)
  const W = (l) => Math.max(l.c === 4 ? 2.6 : 6, l.w || (l.c === 1 ? 18 : l.c === 2 ? 14 : 10));
  const draw = (cls, col, k = 1) => { x.strokeStyle = col; for (const l of D.streets.lines) if (l.c === cls) { x.lineWidth = W(l) * k; x.beginPath(); linePath(x, l.p); x.stroke(); } };
  draw(4, G.path);
  draw(0, G.street); draw(1, G.avenue); draw(2, G.highway);
  // the user's block: the 28 lots read as theirs, a soft Columbia-blue edge
  if (home) {
    x.fillStyle = G.home; x.strokeStyle = G.homeEdge; x.lineWidth = 1.6;
    for (const lot of home) { x.beginPath(); polyPath(x, [lot.footprint]); x.fill(); x.stroke(); }
  }
  // water stays transparent (alpha test): punch the river back out of anything that spilled over the shore
  x.globalCompositeOperation = 'destination-in'; x.beginPath(); for (const p of D.land.polys) polyPath(x, p); x.fillStyle = '#000'; x.fill('evenodd');
  x.globalCompositeOperation = 'source-over';

  // aux (half resolution)
  const A = ctxFor(F, 2), ax = A.x;
  ax.setTransform(1, 0, 0, 1, 0, 0); ax.fillStyle = '#000'; ax.fillRect(0, 0, A.c.width, A.c.height);
  ax.setTransform(CA / A.m, -SA / A.m, SA / A.m, CA / A.m, -F.u0 / A.m, F.v1 / A.m);
  ax.globalCompositeOperation = 'lighter'; ax.lineJoin = 'round'; ax.lineCap = 'round';
  // street light glow: wide soft strokes, avenues brighter
  const glow = (cls, add, a) => { ax.strokeStyle = `rgba(${a},0,0,1)`; for (const l of D.streets.lines) if (l.c === cls) { ax.lineWidth = W(l) + add; ax.beginPath(); linePath(ax, l.p); ax.stroke(); } };
  glow(0, 10, 60); glow(1, 22, 90); glow(1, 8, 70); glow(2, 14, 60);
  // shore proximity: land solid, then rings outward (foam band sits around 0.4-0.6)
  for (const [w, a] of [[150, 26], [90, 30], [48, 40], [22, 50], [8, 60]]) {
    ax.strokeStyle = `rgba(0,${a},0,1)`; ax.lineWidth = w;
    for (const p of D.land.polys) { ax.beginPath(); polyPath(ax, [p[0]]); ax.stroke(); }
  }
  ax.fillStyle = 'rgba(0,255,0,1)'; ax.beginPath(); for (const p of D.land.polys) polyPath(ax, p); ax.fill('evenodd');
  ax.fillStyle = 'rgba(0,0,255,1)'; ax.beginPath(); for (const l of D.hydro.lakes) polyPath(ax, l.p); ax.fill('evenodd');

  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const aux = new THREE.CanvasTexture(A.c); aux.generateMipmaps = true; aux.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, aux, ms: performance.now() - t0, canvas: c };
}

/* ------------------------------------------------------------------ the district mask (r = lit) */
export function createMask(F, nta, brow) {
  const scale = Math.max(1, Math.round(40 / F.mpp));
  const mk = () => ctxFor(F, scale);
  const A = mk(), B = mk();
  const tA = new THREE.CanvasTexture(A.c), tB = new THREE.CanvasTexture(B.c);
  for (const t of [tA, tB]) { t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  let cur = 0;
  // Billionaires' Row is a small corridor of its own on top of Midtown: lit only by its own id ('BROW'), otherwise a soft mist
  // (a grey the shader reads as half locked), so its supertalls stay readable on the skyline whatever else is open.
  const MIST = '#808080';
  function paint(ctx, lit) {
    const x = ctx.x;
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = lit === 'all' ? '#fff' : '#000'; x.fillRect(0, 0, ctx.c.width, ctx.c.height); x.restore();
    if (lit === 'all') return;
    x.fillStyle = '#fff';
    try { x.filter = 'blur(1.4px)'; } catch { /* no canvas filter: hard-edged but still soft from linear filtering */ }
    for (const n of nta.neighborhoods) if (lit.has(n.code)) { x.beginPath(); for (const p of n.polys) polyPath(x, p); x.fill('evenodd'); }
    if (brow && brow.region) {
      x.fillStyle = lit.has('BROW') ? '#fff' : MIST;
      x.beginPath(); const q = brow.region.poly; for (let i = 0; i < q.length; i += 2) { if (i === 0) x.moveTo(q[0], q[1]); else x.lineTo(q[i], q[i + 1]); } x.closePath(); x.fill();
    }
    x.filter = 'none';
  }
  paint(A, 'all'); paint(B, 'all'); tA.needsUpdate = tB.needsUpdate = true;
  return {
    texA: tA, texB: tB,
    /** paints the new mask into the back buffer; returns which one (0 = A, 1 = B) now holds it */
    set(lit) { cur = 1 - cur; const ctx = cur ? B : A; paint(ctx, lit); (cur ? tB : tA).needsUpdate = true; return cur; },
  };
}

/* ------------------------------------------------------------------ terrain mesh */
export function buildGroundMesh(F, TR, mat, step) {
  const nu = Math.ceil((F.u1 - F.u0) / step) + 1, nv = Math.ceil((F.v1 - F.v0) / step) + 1;
  const near = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const [x, z] = fromUV(F.u0 + i * step, F.v0 + j * step);
    if (TR.isLand(x, z)) near[j * nu + i] = 1;
  }
  // dilate twice so the alpha-tested shoreline is always covered
  for (let pass = 0; pass < 2; pass++) {
    const src = near.slice();
    for (let j = 1; j < nv - 1; j++) for (let i = 1; i < nu - 1; i++) if (!src[j * nu + i]) { if (src[j * nu + i - 1] || src[j * nu + i + 1] || src[(j - 1) * nu + i] || src[(j + 1) * nu + i] || src[(j - 1) * nu + i - 1] || src[(j + 1) * nu + i + 1] || src[(j - 1) * nu + i + 1] || src[(j + 1) * nu + i - 1]) near[j * nu + i] = 1; }
  }
  const vid = new Int32Array(nu * nv).fill(-1), pos = [], uv = [], idx = [];
  const vert = (i, j) => {
    const k = j * nu + i; if (vid[k] >= 0) return vid[k];
    const u = F.u0 + i * step, v = F.v0 + j * step, [x, z] = fromUV(u, v);
    pos.push(x, TR.ground(x, z), z); uv.push((u - F.u0) / (F.u1 - F.u0), (v - F.v0) / (F.v1 - F.v0));
    return (vid[k] = pos.length / 3 - 1);
  };
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    if (!(near[j * nu + i] || near[j * nu + i + 1] || near[(j + 1) * nu + i] || near[(j + 1) * nu + i + 1])) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    // (u, v) -> (x, z) is a rotation with v pointing to -z: keep the triangles facing up
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // make sure normals point up (winding depends on the frame's handedness)
  const nrm = g.attributes.normal; let up = 0; for (let i = 0; i < nrm.count; i += 97) up += nrm.getY(i);
  if (up < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.name = 'ground'; m.frustumCulled = false;
  return { mesh: m, tris: idx.length / 3 };
}

const GFRAG_PARS = /* glsl */`
uniform sampler2D uAux;
varying vec3 vWP;
float gLocked;
`;
export function createGroundMaterial(tex, aux, U) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  mat.customProgramCacheKey = () => 'mh-ground-1';
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U, { uAux: { value: aux } });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_GLSL + GFRAG_PARS)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 ax = texture2D(uAux, vMapUv);
        vec3 gEm = vec3(0.0);
        {
          // lakes: the sky in the water, a slow shimmer
          float lake = smoothstep(0.35, 0.8, ax.b);
          float sh = vn2(vWP.xz * 0.08 + uTime * 0.05) * 0.6 + vn2(vWP.xz * 0.21 - uTime * 0.07) * 0.4;
          vec3 lk = mix(${glsl("#132a4c")}, mix(uSkyRefl, vec3(0.16, 0.3, 0.52), 0.55) * (0.55 + 0.45 * uDay), 0.45 + 0.25 * sh);
          diffuseColor.rgb = mix(diffuseColor.rgb, lk, lake);
          gEm += lk * lake * 0.18 + uWarm * lake * smoothstep(0.7, 0.95, sh) * 0.035 * uGlow;
          // snow on blocks and parks, wet streets after rain
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97), uSnow * 0.75 * (1.0 - lake));
          diffuseColor.rgb *= 1.0 - uWet * 0.25;
          // street light: warm pools along the streets at night (stronger on the avenues)
          gEm += uWarm * pow(ax.r, 1.4) * uGlow * (0.42 + 0.35 * uWet);
          gLocked = lockedAt(vWP.xz);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(0.78, 0.86, 1.04), gLocked * 0.75) * (1.0 - 0.4 * gLocked);
          gEm *= 1.0 - 0.85 * gLocked;
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEm;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uLockCol, gLocked * 0.42);');
  };
  return mat;
}

/* ------------------------------------------------------------------ the bulkhead: a stone edge round the island */
export function buildEdge(land, TR, U) {
  const pos = [], col = [], idx = [];
  const top = [0.42, 0.44, 0.5], bot = [0.18, 0.21, 0.28];
  for (const poly of land.polys) {
    const r = ring2(poly[0]); if (r.length < 3) continue;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      const ya = TR.ground(ax, az), yb = TR.ground(bx, bz), b = pos.length / 3;
      pos.push(ax, ya, az, bx, yb, bz, bx, -3, bz, ax, -3, az);
      col.push(...top, ...top, ...bot, ...bot);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
  void U;
  const m = new THREE.Mesh(g, mat); m.name = 'edge'; m.frustumCulled = false;
  return { mesh: m, tris: idx.length / 3 };
}

/* ------------------------------------------------------------------ the rivers and the harbour */
const WVERT = /* glsl */`
varying vec3 vWP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const WFRAG = /* glsl */`
${COMMON_GLSL}
varying vec3 vWP;
uniform sampler2D uAux;
uniform vec3 uHor, uTop, uDeep, uDisc, uDiscCol, uFogCol;
uniform float uFogNear, uFogFar, uMotion;
void main() {
  vec3 V = normalize(cameraPosition - vWP);
  float t = uTime * uMotion;
  vec2 p = vWP.xz;
  float dist = length(cameraPosition - vWP);
  // every ripple layer fades out by its pixel footprint (metres per pixel), not by distance alone: a ripple narrower than ~2 pixels aliases and crawls
  float fp = length(fwidth(p)) + 1e-3;
  float detail = (1.0 - smoothstep(2500.0, 12000.0, dist)) * (1.0 - smoothstep(1.2, 3.5, fp));
  float fineW = 1.0 - smoothstep(0.12, 0.5, fp);
  float midW = 1.0 - smoothstep(3.0, 9.0, fp);
  vec2 g = vec2(vn2(p * 0.018 + vec2(t * 0.03, 0.0)) - vn2(p * 0.018 + vec2(3.1, 1.7 - t * 0.025)),
                (vn2(p * 0.047 + vec2(7.3, 2.1 + t * 0.05)) - vn2(p * 0.047 + vec2(-t * 0.04, 5.0))) * midW);
  g += 0.5 * vec2(vn2(p * 0.15 + t * 0.12) - 0.5, vn2(p * 0.15 + vec2(4.0, -t * 0.1)) - 0.5) * detail;
  vec3 N = normalize(vec3(g.x * 0.1, 1.0, g.y * 0.1));
  // fine ripples only for the sun / moon glints, so they sparkle instead of pooling into blotches
  vec2 g2 = vec2(vn2(p * 0.9 + vec2(t * 0.4, 0.0)) - 0.5, vn2(p * 0.9 + vec2(2.7, -t * 0.35)) - 0.5) * detail * fineW;
  vec3 N2 = normalize(N + vec3(g2.x * 0.5, 0.0, g2.y * 0.5));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 refl = mix(uHor, uTop, clamp(R.y * 1.6, 0.0, 1.0));
  vec3 col = mix(uDeep, refl, 0.16 + 0.5 * fres);
  float sp = pow(max(dot(reflect(-V, N2), uDisc), 0.0), 380.0);
  col += uDiscCol * sp * (0.05 + 0.7 * uDay);
  vec2 uv = gridUV(p);
  // sampled unconditionally (a branch here breaks the mip derivatives and draws a seam at the frame edge)
  float inb = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  vec4 ax = texture2D(uAux, clamp(uv, 0.0, 1.0)) * inb;
  float shore = ax.g;
  // shallower, lighter water along the bulkheads, a moving foam line where the river meets the edge
  col = mix(col, col * 1.22 + vec3(0.012, 0.03, 0.05), smoothstep(0.08, 0.55, shore) * 0.6);
  float fn = vn2(p * 0.22 + vec2(t * 0.25, -t * 0.12)) * 0.6 + mix(0.5, vn2(p * 0.7 - t * 0.35), fineW) * 0.4;
  float band = smoothstep(0.3, 0.5, shore) * (1.0 - smoothstep(0.8, 0.95, shore));
  col += vec3(0.62, 0.74, 0.88) * band * smoothstep(0.42, 0.72, fn) * (0.16 + 0.3 * uDay) * detail;
  // the city's lights in the river at night
  col += uWarm * smoothstep(0.02, 0.5, shore) * uGlow * 0.07 * (0.6 + 0.8 * fn);
  float f = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogCol, f);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
export function createWater(aux, U, center) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: WVERT, fragmentShader: WFRAG, fog: false,
    uniforms: Object.assign({}, U, {
      uAux: { value: aux }, uHor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uDeep: { value: new THREE.Color(0x0b2148) },
      uDisc: { value: new THREE.Vector3(0, 0.4, -1) }, uDiscCol: { value: new THREE.Color() }, uFogCol: { value: new THREE.Color() },
      uFogNear: { value: 2000 }, uFogFar: { value: 9000 }, uMotion: { value: 1 },
    }),
  });
  const g = new THREE.PlaneGeometry(240000, 240000, 1, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat); m.position.set(center[0], 0, center[1]); m.name = 'water'; m.frustumCulled = false; m.renderOrder = -2;
  return m;
}

/* ------------------------------------------------------------------ a very faint far shore (the other boroughs, flat, no buildings) */
export function buildFarShore(fs) {
  const geos = [];
  for (const p of fs.polys) {
    const r = ring2(p.p); if (r.length < 3) continue;
    const shape = new THREE.Shape(r.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape, 1).rotateX(-Math.PI / 2);
    geos.push(g);
  }
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#132a50'), fog: true, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  // seen at a grazing angle (a low camera looking up the island) the far shore would sit as a dark slab on the haze line: fade it there
  mat.customProgramCacheKey = () => 'mh-farshore-1';
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarW;').replace('#include <project_vertex>', '#include <project_vertex>\nvFarW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarW;')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.a *= smoothstep(0.025, 0.07, max(cameraPosition.y - vFarW.y, 0.0) / max(distance(cameraPosition.xz, vFarW.xz), 1.0));');
  };
  const grp = new THREE.Group(); grp.name = 'farshore';
  for (const g of geos) { const m = new THREE.Mesh(g, mat); m.position.y = 0.4; m.renderOrder = -1; grp.add(m); }
  return { grp, mat };
}

export const GROUND_COLORS = G;
