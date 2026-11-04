// city/world/cars.js · parked cars along both kerbs of W 123rd St (docs/WORLD.md §13, slice 2 cars). Two real, CC-BY cars (assets/cars/LICENSES.md):
// a 2011 Camry sedan and a 2011 Nissan Versa/Tiida hatchback, each LOD0 (<= 14k tris, near) + LOD1 (~2.6k, beyond 30 m), all INSTANCED (one InstancedMesh per material per LOD).
// The body paint is recolourable per instance: Tiida has its own 'paint' material; Camry's baked atlas has a paint mask (camry_mask.webp, same UVs).
//   layoutCars(data)   data = w123_street.json  -> [{ kind, x, z, ry, hl, hw, color }]   pure + seeded (the walker builds its colliders from it, before the GLBs load)
//   plantCars({ THREE, world, data, renderer }) -> Promise<{ update(camera), count, tris, dispose() }>
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const KINDS = [{ id: 'camry', len: 4.8, hw: 0.97 }, { id: 'tiida', len: 4.3, hw: 0.97 }];
const LOD_DIST = 30;
// NYC mix (sRGB hex, weight): white, silver, grey, black, dark blue, dark red, beige, dark green, and a rare bright one
export const PALETTE = [[0xeeeeea, 19], [0xc3c6c9, 19], [0x6d7075, 16], [0x16171a, 15], [0x1b2a4a, 9], [0x6a1a1f, 7], [0xcbbd9d, 5], [0x1f3a2c, 5], [0xe0a01a, 1.2], [0x1d8fb0, 1.2], [0xc9382b, 0.9]];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function layoutCars(data, seed = 20261031) {
  const street = data.street, R = rng(seed), rd = street.roadbed / 2, lineW = street.sidewalk0.lineW, lineE = street.sidewalk0.lineE, hyd = data.hydrants || [];
  const cw = (street.crosswalks || []).map((c) => [c.x - c.depth / 2, c.x + c.depth / 2]);
  const x0 = Math.max(lineW, ...cw.filter((c) => c[1] < 0).map((c) => c[1] + 6)), x1 = Math.min(lineE, ...cw.filter((c) => c[0] > 0).map((c) => c[0] - 6));   // 6 m (20 ft) clear of the crosswalks
  const tot = PALETTE.reduce((s, p) => s + p[1], 0), pick = () => { let r = R() * tot; for (const [c, w] of PALETTE) { r -= w; if (r <= 0) return c; } return PALETTE[0][0]; };
  const out = [];
  for (const sd of [-1, 1]) {
    const mine = hyd.filter((h) => Math.sign(h[1]) === sd).map((h) => h[0]);
    let cx = x1;                                                    // the kerb is filled from the east end westward (the way the traffic flows)
    cx -= R() * 3;
    while (cx > x0) {
      const k = R() < 0.5 ? 0 : 1, L = KINDS[k].len, hi = cx, lo = cx - L;                                  // the car occupies [lo, hi]
      if (lo < x0) break;
      const bad = mine.find((h) => h > lo - 4.6 && h < hi + 4.6);                                           // 4.6 m (15 ft) from a hydrant
      if (bad !== undefined) { cx = bad - 4.6 - 0.05; continue; }
      if (R() < 0.25) { cx = lo - 0.6 - R() * 0.9; continue; }                                              // ~25 % of the kerb empty (a vacant slot)
      const zc = sd * (rd - (0.25 + R() * 0.1) - KINDS[k].hw);
      out.push({ kind: k, x: (lo + hi) / 2 + (R() - 0.5) * 0.04, z: zc, ry: -Math.PI / 2 + (R() - 0.5) * 0.03, hl: L / 2, hw: KINDS[k].hw, color: pick() });
      cx = lo - (0.6 + R() * 0.9);                                                                          // 0.6-1.5 m between bumpers
    }
  }
  return out;
}
export const crownY = (street, z) => -0.07 - (0.09 * Math.abs(z)) / (street.roadbed / 2);

export async function plantCars({ THREE, world, data, renderer }) {
  const street = data.street, list = layoutCars(data), loader = new GLTFLoader(), base = new URL('./assets/cars/', import.meta.url);
  const mask = await new Promise((res) => new THREE.TextureLoader().load(new URL('camry_mask.webp', base).href, res, undefined, () => res(null)));
  if (mask) { mask.flipY = false; mask.colorSpace = THREE.NoColorSpace; mask.anisotropy = 4; }
  const nI = list.length, paint = new THREE.InstancedBufferAttribute(new Float32Array(nI * 3), 3), col = new THREE.Color();
  list.forEach((c, i) => { col.setHex(c.color); paint.setXYZ(i, col.r, col.g, col.b); });
  paint.setUsage(THREE.DynamicDrawUsage);
  const patch = (m, masked) => {                                                                              // per-instance paint: multiply the body (the masked part of the atlas) by aPaint
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec3 aPaint;\nvarying vec3 vPaint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPaint = aPaint;');
      sh.fragmentShader = 'varying vec3 vPaint;\n' + (masked ? 'uniform sampler2D tMask;\n' : '') + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' +
        (masked ? ' diffuseColor.rgb *= mix(vec3(1.0), vPaint * 1.15, texture2D(tMask, vMapUv).r);' : ' diffuseColor.rgb *= vPaint;'));
      if (masked) sh.uniforms.tMask = { value: mask };
    };
    m.customProgramCacheKey = () => 'car-paint-' + (masked ? 'mask' : 'flat');
  };
  const parts = [];                                                                                           // [{ kind, lod, mesh, tris }]
  let tris = 0;
  for (let k = 0; k < KINDS.length; k++) for (const lod of [0, 1]) {
    const gl = await loader.loadAsync(new URL(`${KINDS[k].id}_lod${lod}.glb`, base).href); gl.scene.updateMatrixWorld(true);
    const cap = list.filter((c) => c.kind === k).length;
    gl.scene.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g.setAttribute('aPaint', paint);
      const mat = m.material; if (m.name === 'paint' || (m.name === 'body' && mat.map && mask)) patch(mat, m.name === 'body');
      if (m.name === 'glass' && mat.color) mat.envMapIntensity = 1.4;
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, cap)); im.count = 0; im.frustumCulled = false; im.castShadow = lod === 0 || true; im.receiveShadow = true; im.matrixAutoUpdate = false;
      world.add(im); parts.push({ kind: k, lod, mesh: im }); if (lod === 0) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
  }
  const idx = [[], []];                                                                                       // per kind: indices into list
  list.forEach((c, i) => idx[c.kind].push(i));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), last = new THREE.Vector3(1e9, 0, 1e9);
  const mats = list.map((c) => new THREE.Matrix4().compose(v.set(c.x, crownY(street, c.z), c.z), q.setFromAxisAngle(up, c.ry), one));
  const stat = { near: 0, far: 0 };
  function update(camera, force) {
    const p = camera.position; if (!force && Math.abs(p.x - last.x) + Math.abs(p.z - last.z) < 1.5) return; last.copy(p);
    const sel = [[[], []], [[], []]]; stat.near = stat.far = 0;
    for (let k = 0; k < 2; k++) for (const i of idx[k]) { const c = list[i], d = Math.hypot(c.x - p.x, c.z - p.z), l = d < LOD_DIST ? 0 : 1; sel[k][l].push(i); if (l) stat.far++; else stat.near++; }
    for (const pt of parts) {
      const s = sel[pt.kind][pt.lod], im = pt.mesh, pa = new Float32Array(0); void pa;
      s.forEach((i, j) => im.setMatrixAt(j, mats[i]));
      im.count = s.length; im.instanceMatrix.needsUpdate = true;
      im.userData.sel = s; const g = im.geometry;
      // the per-instance paint of this slice (the shared attribute is indexed by instance, so each LOD mesh gets its own copy)
      let a = g.getAttribute('aPaint'); if (a === paint) { a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, idx[pt.kind].length) * 3), 3); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aPaint', a); }
      s.forEach((i, j) => a.setXYZ(j, paint.getX(i), paint.getY(i), paint.getZ(i))); a.needsUpdate = true;
    }
    renderer.shadowMap.needsUpdate = true;
  }
  return { update, count: list.length, list, tris, stat, parts, dispose() { for (const pt of parts) { world.remove(pt.mesh); pt.mesh.geometry.dispose(); } } };
}


/* ---- slice 3 (docs/WORLD.md 14.3): parked cars on every street and avenue of the district. NYC rules: 4.6 m (15 ft) from a hydrant, clear of the corner crosswalks, none in a bus stop
   (15 m either side of a shelter), ~25 % of the kerb empty, one-way flow on the side streets (alternate by street number), right-hand traffic on the avenues, a lighter 125th. */
export function layoutKerb(k, hydrants = [], shelters = [], seed = 1) {
  const R = rng(seed), tot = PALETTE.reduce((a, p) => a + p[1], 0), pick = () => { let r = R() * tot; for (const [c, w] of PALETTE) { r -= w; if (r <= 0) return c; } return PALETTE[0][0]; };
  const ax = k.axis === 'z', clear = k.ave ? 5.4 : 0.4, lo = k.a + clear, hi = k.b - clear, out = [];
  const hy = hydrants.map((h) => (ax ? h[0] : h[1])), bus = shelters.map((q) => (ax ? q.x : q.z));
  // the car models' noses point along +z (their tail lights + plate sit at -z), so ry turns +z into the traffic direction: right-hand traffic on the two-way avenues
  // (a block's W face kerb = the avenue's EAST kerb, northbound -z: ry = PI; the E face kerb = the WEST kerb, southbound: 0); 125th St is two-way (south kerb eastbound);
  // the other side streets are one-way by parity (odd westbound, even eastbound)
  const dir = k.ave ? (k.inward > 0 ? Math.PI : 0) : k.two ? (k.inward > 0 ? Math.PI / 2 : -Math.PI / 2) : (k.par ? -Math.PI / 2 : Math.PI / 2);
  let cur = hi - R() * 3;
  while (cur > lo) {
    const kd = R() < 0.5 ? 0 : 1, L = KINDS[kd].len, a = cur - L;
    if (a < lo) break;
    const bad = hy.find((h) => h > a - 4.6 && h < cur + 4.6); if (bad !== undefined) { cur = bad - 4.65; continue; }
    const bs = bus.find((q) => q > a - 15 && q < cur + 15); if (bs !== undefined) { cur = bs - 15.05; continue; }
    if (R() < (k.nopark ? 0.55 : 0.25)) { cur = a - 0.6 - R() * 0.9; continue; }
    const along = (a + cur) / 2 + (R() - 0.5) * 0.04, off = k.c - k.inward * (0.28 + R() * 0.1 + KINDS[kd].hw), hw = KINDS[kd].hw;
    out.push({ kind: kd, x: ax ? along : off, z: ax ? off : along, ry: dir + (R() - 0.5) * 0.03, hx: ax ? L / 2 : hw, hz: ax ? hw : L / 2, color: pick() });
    cur = a - (0.6 + R() * 0.9);
  }
  return out;
}

/** one pool of instanced cars for the whole district: setUnit(id, list) / dropUnit(id), update(camera) picks the nearest <= cap within `radius` and a LOD by distance */
export async function plantCarPool({ THREE, world, renderer, cap = 150, radius = 130 }) {
  const loader = new GLTFLoader(), base = new URL('./assets/cars/', import.meta.url);
  const mask = await new Promise((res) => new THREE.TextureLoader().load(new URL('camry_mask.webp', base).href, res, undefined, () => res(null)));
  if (mask) { mask.flipY = false; mask.colorSpace = THREE.NoColorSpace; mask.anisotropy = 4; }
  const patch = (m, masked) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec3 aPaint;\nvarying vec3 vPaint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vPaint = aPaint;');
      sh.fragmentShader = 'varying vec3 vPaint;\n' + (masked ? 'uniform sampler2D tMask;\n' : '') + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' +
        (masked ? ' diffuseColor.rgb *= mix(vec3(1.0), vPaint * 1.15, texture2D(tMask, vMapUv).r);' : ' diffuseColor.rgb *= vPaint;'));
      if (masked) sh.uniforms.tMask = { value: mask };
    };
    m.customProgramCacheKey = () => 'car-paint-' + (masked ? 'mask' : 'flat');
  };
  const parts = []; let tris = 0;
  for (let k = 0; k < KINDS.length; k++) for (const lod of [0, 1]) {
    const gl = await loader.loadAsync(new URL(`${KINDS[k].id}_lod${lod}.glb`, base).href); gl.scene.updateMatrixWorld(true);
    gl.scene.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
      const pa = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); pa.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aPaint', pa);
      const mat = m.material; if (m.name === 'paint' || (m.name === 'body' && mat.map && mask)) patch(mat, m.name === 'body');
      const im = new THREE.InstancedMesh(g, mat, cap); im.count = 0; im.frustumCulled = false; im.castShadow = lod === 0; im.receiveShadow = true; im.matrixAutoUpdate = false; world.add(im);
      parts.push({ kind: k, lod, mesh: im, pa }); if (lod === 0) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
  }
  const units = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), col = new THREE.Color(), last = new THREE.Vector3(1e9, 0, 1e9);
  const stat = { shown: 0, near: 0, far: 0, total: 0 };
  let dirty = true;
  function update(camera, force) {
    const p = camera.position; if (!force && !dirty && Math.abs(p.x - last.x) + Math.abs(p.z - last.z) < 1.5) return; last.copy(p); dirty = false;
    const all = []; for (const l of units.values()) for (const c of l) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < radius) all.push([d, c]); }
    all.sort((a, b) => a[0] - b[0]); const use = all.slice(0, cap), sel = [[[], []], [[], []]];
    for (const [d, c] of use) sel[c.kind][d < LOD_DIST ? 0 : 1].push(c);
    stat.shown = use.length; stat.near = sel[0][0].length + sel[1][0].length; stat.far = use.length - stat.near;
    for (const pt of parts) {
      const s = sel[pt.kind][pt.lod], im = pt.mesh;
      s.forEach((c, j) => { im.setMatrixAt(j, m4.compose(v.set(c.x, -0.155, c.z), q.setFromAxisAngle(up, c.ry), one)); col.setHex(c.color); pt.pa.setXYZ(j, col.r, col.g, col.b); });
      im.count = s.length; im.instanceMatrix.needsUpdate = true; pt.pa.needsUpdate = true;
    }
    renderer.shadowMap.needsUpdate = true;
  }
  return {
    update, parts, tris, stat, units,
    setUnit(id, list) { units.set(id, list); dirty = true; stat.total = [...units.values()].reduce((a, l) => a + l.length, 0); },
    dropUnit(id) { units.delete(id); dirty = true; stat.total = [...units.values()].reduce((a, l) => a + l.length, 0); },
    near(x, z, R) { const out = []; for (const l of units.values()) for (const c of l) if (Math.abs(c.x - x) < R && Math.abs(c.z - z) < R) out.push(c); return out; },
    dispose() { for (const pt of parts) { world.remove(pt.mesh); pt.mesh.geometry.dispose(); } },
  };
}
