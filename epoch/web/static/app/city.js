// city.js · "Your New York": a cozy low-poly diorama of Manhattan at the hour it really is. No models, no textures.
// Loaded on first use by app.js via import(). Needs an import map for "three" and "three/addons/" (app.js injects one if the page has none).
// createCity() returns null when WebGL2 is missing, so the server-rendered SVG skyline simply stays.
//
//   one day  = one lot on a Manhattan block grid (a week per block row, newest week nearest the camera)
//   floors   = deep minutes; lit lobby door = floor met; lit crown band = target met; rooftop beacon = a shipped output
//   no tower = a calm plot (future), a building site with a fence (missed), a small park (rest day)
//   landmarks grow in 5 sections as ladder nodes unlock (locked sections are faint ghost outlines)
//
// Render on demand: zero frames are scheduled when nothing moves, the tab is hidden or the canvas is off screen.
// Modules: city/util.js (geometry builder) shader.js (window/lit-door shader) sky.js towers.js world.js landmarks.js life.js
// Colours: city/palette.js holds the Morningside palette (blue-hour navy, limestone-warm windows, Columbia blue for the reward bits).
// Live layers (wave 2): construction.js (crane + rising block while a Pomodoro work block runs), weather.js + particles.js (clouds, rain,
// snow, fog), seasonal.js (decorations), flow.js (flow-meter streetlights). Public API: see DOM_CONTRACT.md section 5, "3D city module API".
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, smooth, hash01, rng, Geo, rgb, KIND } from './city/util.js';
import { createCityMaterial, makeShared, FLOOR_H } from './city/shader.js';
import { timeParams, createSky } from './city/sky.js';
import { buildBuilding, buildSite, buildPad, pickStyle, STYLE, LOT_W, LOT_D, tree } from './city/towers.js';
import { tryDayTower } from './city/tower_model.js';
import { makeLayout, buildGround, buildSlab, buildFillers, buildFar, createWater } from './city/world.js';
import { buildSurround, createHarbour } from './city/surround.js';
import { buildLandmark } from './city/landmarks.js';
import { createCars, createFerry, createBirds } from './city/life.js';
import { createConstruction } from './city/construction.js';
import { createWeather } from './city/weather.js';
import { createSeasonal } from './city/seasonal.js';
import { createFlow } from './city/flow.js';
import { MS, hdr } from './city/palette.js';
import { createManhattan } from './city/manhattan.js';

// the ladder colours of the Morningside theme (style.css --c-*, dark half)
export const LADDER_HEX = { 'Python': 0x74b8ff, 'Math': 0xb4a6ff, 'ML/DL': 0x62dda8, 'Papers': 0xff9c7e, 'Writing/X': 0xf59ce2 };
const MAXF = 16;
const ACTIVE_MS = 25000;
const EXPOSURE = 1.08;
const fogNavy = new THREE.Color(MS.fog), beaconTone = new THREE.Color(MS.beacon);                       // gentle idle life after load / interaction / log, then freeze
// World > City's free camera: all the way round, from straight above (a hair off the pole, so lookAt never flips)
// down to just above the horizon, and from a street-level look at the hero block out to the whole harbour.
const TOP_PHI = 0.012, MAX_PHI = 1.46, MIN_R = 3.6, MAX_R = 66;

/* a soft round gradient, used for light pools and mist */
function radialTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roundedRingGeo(w, d, r, t) {
  const rr = (s, x0, y0, x1, y1, rad) => { s.moveTo(x0 + rad, y0); s.lineTo(x1 - rad, y0); s.quadraticCurveTo(x1, y0, x1, y0 + rad); s.lineTo(x1, y1 - rad); s.quadraticCurveTo(x1, y1, x1 - rad, y1); s.lineTo(x0 + rad, y1); s.quadraticCurveTo(x0, y1, x0, y1 - rad); s.lineTo(x0, y0 + rad); s.quadraticCurveTo(x0, y0, x0 + rad, y0); };
  const s = new THREE.Shape(); rr(s, -w / 2, -d / 2, w / 2, d / 2, r);
  const h = new THREE.Path(); rr(h, -w / 2 + t, -d / 2 + t, w / 2 - t, d / 2 - t, Math.max(0.01, r - t)); s.holes.push(h);
  return new THREE.ShapeGeometry(s, 6).rotateX(-Math.PI / 2);
}

// small final pass: a gentle tilt-shift blur at the top and bottom edges (model-city look) and a soft vignette
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 800, 1 / 600) }, uBlur: { value: 1 }, uVig: { value: 0.3 }, uHaze: { value: new THREE.Vector3(0.1, 0.1, 0.3) }, uHazeAmt: { value: 0.5 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uBlur, uVig, uHazeAmt; uniform vec3 uHaze;
    void main() {
      vec2 uv = vUv; vec4 c = texture2D(tDiffuse, uv);
      float amt = smoothstep(0.36, 0.52, abs(uv.y - 0.5)) * uBlur * 0.7;
      if (amt > 0.01) {
        vec4 acc = c; float ws = 1.0;
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * uTexel * (amt * 4.5); acc += texture2D(tDiffuse, uv + o); acc += texture2D(tDiffuse, uv + o * 0.5); ws += 2.0; }
        c = acc / ws;
      }
      // distant city dissolves into the sky colour toward the top of the frame
      float hz = smoothstep(0.55, 1.02, uv.y); hz = hz * hz;
      c.rgb = mix(c.rgb, uHaze, hz * uHazeAmt);
      float v = smoothstep(1.05, 0.38, length((uv - 0.5) * vec2(1.0, 0.92)));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c;
    }`,
};

export function createCity(host, opts = {}) {
  // Every stage is real Manhattan (city/manhattan.js): World > City with the free camera, the Today hero and the focus screen framed on
  // the user's own block. The invented diorama below is only kept for `opts.legacy` (tests, comparisons).
  if (!opts.legacy) return createManhattan(host, { ...opts, mode: opts.mode === 'city' ? 'city' : 'week' });
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return null;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'default' }); } catch { return null; }

  const mode = opts.mode || 'week';
  const L = makeLayout(mode), ROWS = L.rows, COLS = 7, N = ROWS * COLS;
  let hourFn = opts.hour || (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let motion = opts.motion !== false && !mqReduce.matches;

  let liveMode = false;                                                                     // the focus screen runs for hours: a touch tablet then renders a little lighter
  const touch = matchMedia('(pointer:coarse)').matches;
  const dprCap = () => Math.min(devicePixelRatio || 1, liveMode && touch ? 1.25 : host.clientWidth * host.clientHeight > 1.4e6 ? 1.5 : 2);
  renderer.setPixelRatio(dprCap());
  // Neutral tone mapping keeps the hue of bright things: lamplit windows stay limestone-warm instead of clipping to white (ACES did)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(MS.fog), 34, 150);
  const camera = new THREE.PerspectiveCamera(32, 1, mode === 'city' ? 0.3 : 0.5, 700);
  const shared = makeShared();
  let clock = 12;                                 // seconds of "scene time"; advances only while awake

  /* ------------------------------------------------------------ camera, controls */
  const isCity = mode === 'city';
  const baseTarget = new THREE.Vector3(isCity ? 2.2 : 0, isCity ? 1.3 : 1.5, isCity ? -0.8 : -0.4);
  const polar0 = isCity ? 1.0 : 1.16, azim0 = isCity ? 0.12 : 0.14;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(baseTarget);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false; controls.enableZoom = false; controls.rotateSpeed = 0.65;
  controls.minPolarAngle = isCity ? 0.6 : 0.85; controls.maxPolarAngle = isCity ? 1.34 : 1.32;
  controls.minAzimuthAngle = isCity ? -0.9 : -0.62; controls.maxAzimuthAngle = isCity ? 0.9 : 0.62;
  controls.minDistance = 4; controls.maxDistance = 70;
  renderer.domElement.style.touchAction = 'pan-y';
  if (isCity) {
    // the free 360 camera (World > City only; the Today hero and the focus screen keep their framed views)
    controls.minPolarAngle = TOP_PHI; controls.maxPolarAngle = MAX_PHI;
    controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
    controls.minDistance = MIN_R; controls.maxDistance = MAX_R;
    controls.enableZoom = true; controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.6;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };      // one finger looks around, two pinch to zoom (and turn)
    renderer.domElement.style.touchAction = 'none';                                       // only gestures that start on the city; the page scrolls everywhere else
  }
  let baseR = 21, flight = null, dirSign = 1;
  camera.position.setFromSphericalCoords(baseR, polar0, azim0).add(baseTarget);
  function calcFit(aspect) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const wide = clamp((aspect - 1.25) / 0.7, 0, 1);
    // city: the hero block (28 lots) is centred a little left so the East River and the bridge fit on the right of a wide frame
    const needW = isCity ? 6.6 + 1.2 * (1 - wide) : 6.4 + 2.2 * wide, needH = isCity ? 7.7 : 4.7;
    return { tx: isCity ? 0.6 + 1.6 * wide : baseTarget.x, r: clamp(Math.max(needW / (t * aspect), needH / t), 11, 46) };
  }
  function fit() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const f = calcFit(w / h);
    if (isCity) baseTarget.x = f.tx;
    const r = f.r;
    const cur = camera.position.clone().sub(controls.target);
    const k = baseR ? r / baseR : 1;
    baseR = r;
    if (cur.lengthSq() < 1e-6) cur.setFromSphericalCoords(r, polar0, azim0); else cur.multiplyScalar(k);
    camera.position.copy(controls.target).add(cur);
  }

  /* ------------------------------------------------------------ lights, sky, fog */
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a2250, 2.4); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-8, 14, 9); scene.add(key); scene.add(key.target);
  // city: a soft fill from the opposite side, so the backs of the towers read when the camera goes round
  const backFill = isCity ? new THREE.DirectionalLight(0xffffff, 0.8) : null; if (backFill) { scene.add(backFill); scene.add(backFill.target); }
  const sky = createSky(); scene.add(sky.mesh);
  let cur = timeParams(12);

  /* ------------------------------------------------------------ static world */
  const worldG = new THREE.Group(); scene.add(worldG);
  const { mat: groundMat } = createCityMaterial(shared, { ao: 0.0 });
  const { mat: fillMat } = createCityMaterial(shared, { litP: 0.24, pitch: 0.4, fill: [0.52, 0.6], seed: 3, ao: 0.3, emis: 0.36, desat: 0.4 });
  const { mat: farMat } = createCityMaterial(shared, { litP: 0.2, pitch: 0.46, fill: [0.5, 0.6], seed: 9, ao: 0.0, emis: 0.3, desat: 0.5 });
  const ground = buildGround(L);
  const sur = isCity ? buildSurround(L) : null;                                            // the rest of New York, all the way round
  if (sur) { ground.geo.append(sur.ground); for (const p of sur.pools) ground.pools.push(p); }
  const plazaGeo = new Geo(), pr = rng(61);
  for (const p of L.plots.filter((q) => !q.bridge)) {
    plazaGeo.box(p.x - 1.75, 0, p.z - 0.86, p.x + 1.75, 0.02, p.z + 0.86, rgb('#4a5d82'), { ctop: rgb('#55698f') });
    for (const [dx, dz] of [[-1.55, -0.7], [1.55, -0.7], [-1.55, 0.7], [1.55, 0.7]]) tree(plazaGeo, p.x + dx, p.z + dz, pr, 0.9 + pr() * 0.3, pr() < 0.2);
  }
  ground.geo.append(plazaGeo);
  const groundMesh = new THREE.Mesh(ground.geo.build(), groundMat); groundMesh.name = 'ground'; worldG.add(groundMesh);
  const slabMesh = new THREE.Mesh(buildSlab(L).build(), groundMat); slabMesh.name = 'slab'; worldG.add(slabMesh);
  const fill = buildFillers(L);
  if (sur) fill.geo.append(sur.near);
  const fillMesh = new THREE.Mesh(fill.geo.build(), fillMat); fillMesh.name = 'blocks'; worldG.add(fillMesh);
  const farGeo = buildFar(L); if (sur) farGeo.append(sur.far);
  const farMesh = new THREE.Mesh(farGeo.build(), farMat); farMesh.name = 'far'; worldG.add(farMesh);
  const water = sur ? createHarbour(sur.lands, sur.waterPolys) : createWater(L); worldG.add(water);
  if (isCity) { sky.mat.uniforms.uLift.value = 0.0; sky.mat.uniforms.uFogAmt.value = 1; }

  /* ------------------------------------------------------------ city: a coarse height field so the free camera never ends up inside a building or under the street */
  const HF = (() => {
    if (!isCity) return null;
    const X0 = -110, Z0 = -130, NX = 220, NZ = 250, h = new Float32Array(NX * NZ);
    const put = (x, z, w, d, hh) => {
      const a = Math.max(0, Math.floor(x - w / 2 - X0)), b = Math.min(NX - 1, Math.floor(x + w / 2 - X0)), c = Math.max(0, Math.floor(z - d / 2 - Z0)), e = Math.min(NZ - 1, Math.floor(z + d / 2 - Z0));
      for (let j = c; j <= e; j++) for (let i = a; i <= b; i++) if (h[j * NX + i] < hh) h[j * NX + i] = hh;
    };
    for (const q of fill.shadows) put(q.x, q.z, q.w, q.d, q.h + 0.5);
    for (const q of sur.rects) put(q.x, q.z, q.w, q.d, q.h);
    for (const ic of L.icons) put(ic.x, ic.z - 0.8, 2, 2, 7.6);
    return { at(x, z) { const i = Math.floor(x - X0), j = Math.floor(z - Z0); let m = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ) m = Math.max(m, h[jj * NX + ii]); } return m; } };
  })();
  groundMesh.frustumCulled = slabMesh.frustumCulled = fillMesh.frustumCulled = farMesh.frustumCulled = false;

  /* ------------------------------------------------------------ light pools, shadows, rings, mist (dynamic decals) */
  const radial = radialTexture();
  const poolMat = new THREE.MeshBasicMaterial({ map: radial, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const POOL_MAX = isCity ? 1800 : 700;
  const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, POOL_MAX); poolMesh.frustumCulled = false; poolMesh.renderOrder = 3; scene.add(poolMesh);
  const dynPools = new Map();                               // key -> [x, z, r, color]
  const dpool = new THREE.Object3D(), poolCol = new THREE.Color(), warmPool = new THREE.Color(MS.lamp);
  function rebuildPools() {
    let n = 0;
    const put = (x, z, r, col, k) => { if (n >= POOL_MAX) return; dpool.position.set(x, 0.014, z); dpool.scale.set(r * 2, 1, r * 2); dpool.updateMatrix(); poolMesh.setMatrixAt(n, dpool.matrix); poolMesh.setColorAt(n, poolCol.copy(col).multiplyScalar(k)); n++; };
    for (const [x, z, r, k] of ground.pools) put(x, z, r * 0.75, warmPool, 0.12 * k);
    for (const v of dynPools.values()) put(v[0], v[1], v[2], v[3], v[4]);
    poolMesh.count = n; poolMesh.instanceMatrix.needsUpdate = true; if (poolMesh.instanceColor) poolMesh.instanceColor.needsUpdate = true;
  }

  // soft ground shadows: one dynamic mesh with a fanned polygon per building
  const shadowRects = [];                                    // {x,z,w,d,h}
  const SH_MAX = fill.shadows.length + N * 2 + 40;
  const shPos = new Float32Array(SH_MAX * 8 * 3), shCol = new Float32Array(SH_MAX * 8 * 4), shIdx = new Uint16Array(SH_MAX * 18);
  const shGeo = new THREE.BufferGeometry();
  shGeo.setAttribute('position', new THREE.BufferAttribute(shPos, 3).setUsage(THREE.DynamicDrawUsage));
  shGeo.setAttribute('color', new THREE.BufferAttribute(shCol, 4).setUsage(THREE.DynamicDrawUsage));
  shGeo.setIndex(new THREE.BufferAttribute(shIdx, 1).setUsage(THREE.DynamicDrawUsage));
  const shMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shMesh = new THREE.Mesh(shGeo, shMat); shMesh.frustumCulled = false; shMesh.renderOrder = 2; scene.add(shMesh);
  let shStrength = 0.5, shDirty = true;
  const hullPts = [];
  function hull(points) {
    const p = points.slice().sort((a, b) => a.x - b.x || a.z - b.z), cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  function updateShadows() {
    shDirty = false;
    const lx = cur.light.x, lz = cur.light.z, ly = Math.max(cur.light.y, 0.2);
    let vi = 0, ii = 0, ri = 0;
    const all = fill.shadows.concat(shadowRects);
    for (const s of all) {
      if (ri >= SH_MAX) break; ri++;
      const len = Math.min(2.4, s.h / ly * 0.5), sx = -lx / Math.hypot(lx, lz) * len, sz = -lz / Math.hypot(lx, lz) * len;
      const x0 = s.x - s.w / 2, x1 = s.x + s.w / 2, z0 = s.z - s.d / 2, z1 = s.z + s.d / 2;
      hullPts.length = 0;
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { hullPts.push({ x, z, a: 0.55 }); hullPts.push({ x: x + sx, z: z + sz, a: 0.0 }); }
      const hp = hull(hullPts), base = vi;
      for (let k = 0; k < hp.length && k < 8; k++) {
        shPos[vi * 3] = hp[k].x; shPos[vi * 3 + 1] = 0.006; shPos[vi * 3 + 2] = hp[k].z;
        shCol[vi * 4] = 0.015; shCol[vi * 4 + 1] = 0.035; shCol[vi * 4 + 2] = 0.1; shCol[vi * 4 + 3] = hp[k].a * shStrength; vi++;
      }
      for (let k = 1; k + 1 < Math.min(hp.length, 8); k++) { shIdx[ii++] = base; shIdx[ii++] = base + k; shIdx[ii++] = base + k + 1; }
    }
    for (; ii < shIdx.length; ii++) shIdx[ii] = 0;
    shGeo.attributes.position.needsUpdate = true; shGeo.attributes.color.needsUpdate = true; shGeo.index.needsUpdate = true;
  }

  const ringBase = roundedRingGeo(LOT_W - 0.02, LOT_D - 0.02, 0.16, 0.05);
  const todayRing = new THREE.Mesh(ringBase, new THREE.MeshBasicMaterial({ color: hdr(MS.accent, 2.4), toneMapped: false, transparent: true, opacity: 0.95, fog: false }));   // today: Columbia blue, the pin is where you land
  todayRing.visible = false; todayRing.position.y = 0.02; scene.add(todayRing);
  const pickRing = new THREE.Mesh(ringBase, new THREE.MeshBasicMaterial({ color: hdr(MS.limestone, 1.7), toneMapped: false, transparent: true, opacity: 0.95, fog: false }));
  pickRing.visible = false; pickRing.position.y = 0.024; scene.add(pickRing);
  // blueprint of the crown height on today's tower (faint Columbia-blue outline, not a glowing box)
  const bpGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const blueprint = new THREE.Group(); blueprint.visible = false; scene.add(blueprint);
  blueprint.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(MS.accent), transparent: true, opacity: 0.08, depthWrite: false, fog: false })));
  blueprint.add(new THREE.LineSegments(bpGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(MS.beacon), transparent: true, opacity: 0.26, depthWrite: false })));

  const mistMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: 0xcfe0f5, transparent: true, opacity: 0.5, depthWrite: false, fog: false }), N * 3);
  mistMesh.frustumCulled = false; mistMesh.count = 0; mistMesh.renderOrder = 4; scene.add(mistMesh);
  const mistItems = [];

  /* ------------------------------------------------------------ instanced bits that ride on towers */
  const lampPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.015, 0.3, 5).translate(0, 0.15, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.dark) }), N * 8);
  const lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: true }), N * 8);
  const bMast = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.014, 0.4, 5).translate(0, 0.2, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.steel) }), N * 6);
  const bOrb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), N * 6);
  const avi = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), N + 8);
  for (const m of [lampPosts, lampHeads, bMast, bOrb, avi]) { m.frustumCulled = false; m.count = 0; scene.add(m); }

  /* ------------------------------------------------------------ lots (one per day) */
  const lots = [];
  const padGeo = buildPad();
  const sFlat = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    const { mat, U } = createCityMaterial(shared, {});
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.frustumCulled = false;
    const lot = {
      i, r, c, x: L.lotX(c), z: L.lotZ(r), mat, U, mesh, geo: null, sig: '', kind: 'future', F: 0, style: 'prewar', day: null,
      g: 1, gv: 0, gT: 1, topY: 0.4, height: 0.4, flashStart: -1, bodyFlash: 0, doorLevel: 0, doorFlash: 0, crownLevel: 0, crownFlash: 0,
      doors: false, crown: false, isToday: false, beacons: [], bBorn: [], slots: [], roof: null, aviation: null, doorX: 0, lamps: [], lampBorn: [], siteLamps: [], fog: 0,
      box: new THREE.Box3(), crownY: 0, w: 1.46, d: 1.5, target: 6, scaffold: false,
    };
    mesh.position.set(lot.x, 0, lot.z); scene.add(mesh); lots.push(lot);
  }
  const dateNum = (k, days) => {
    const d = days[k] && days[k].date;
    if (typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)) return Math.floor(Date.parse(d + 'T00:00:00Z') / 864e5);
    const ti = days.findIndex((q) => q && q.isToday), base = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
    return ti >= 0 ? base - (ti - k) : 20000 + k;
  };

  function applyLotGeometry(lot, built, kind, F, grow) {
    if (lot.geo) lot.geo.dispose();
    const g = new Geo(); if (kind === 'tower') g.append(padGeo);
    g.append(built.geo);
    lot.geo = g.build(); lot.mesh.geometry = lot.geo;
    lot.box.min.set(lot.x - LOT_W / 2, -0.1, lot.z - LOT_D / 2); lot.box.max.set(lot.x + LOT_W / 2, Math.max(0.5, kind === 'tower' ? built.top + 0.5 : 0.5), lot.z + LOT_D / 2);
    void F; void grow;
  }

  /* ------------------------------------------------------------ landmarks */
  const landmarks = [];
  /** local bounding box of one landmark section (for the camera's roof clamp) */
  function secBounds(sg) {
    const a = sg.pos, bx = { x0: 1e9, x1: -1e9, y1: 0, z0: 1e9, z1: -1e9 };
    for (let i = 0; i < a.length; i += 3) { if (a[i] < bx.x0) bx.x0 = a[i]; if (a[i] > bx.x1) bx.x1 = a[i]; if (a[i + 1] > bx.y1) bx.y1 = a[i + 1]; if (a[i + 2] < bx.z0) bx.z0 = a[i + 2]; if (a[i + 2] > bx.z1) bx.z1 = a[i + 2]; }
    return bx;
  }
  for (const p of L.plots) {
    const hex = LADDER_HEX[p.name], b = buildLandmark(p.name, hex);
    const { mat, U } = createCityMaterial(shared, { landmark: true, litP: 0.8, pitch: 0.24, fill: [0.5, 0.68], seed: 17, ao: 0.28, emis: 0.9 });
    const mesh = new THREE.Mesh(b.geo.build(), mat); mesh.frustumCulled = false;
    const grp = new THREE.Group(); grp.position.set(p.x, 0, p.z); grp.rotation.y = p.rot; grp.scale.setScalar(p.scale); grp.add(mesh); scene.add(grp);
    // locked sections: faint solid massing in the ladder colour (not outlines)
    const ghostMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex).lerp(new THREE.Color(0xa9b8e8), 0.72), transparent: true, opacity: 0.2, depthWrite: false, emissive: new THREE.Color(hex).lerp(new THREE.Color(0xa9b8e8), 0.6), emissiveIntensity: 0.16 });
    const ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat); ghost.frustumCulled = false; ghost.renderOrder = 6; grp.add(ghost);
    // depth pre-pass: only the nearest face of the ghost massing blends, so it reads as one calm solid, not overlapping glass
    const ghostZ = new THREE.Mesh(ghost.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })); ghostZ.frustumCulled = false; ghostZ.renderOrder = 5; grp.add(ghostZ);
    landmarks.push({ name: p.name, plot: p, grp, mesh, mat, U, ghost, ghostZ, secGeos: b.sections, secBox: b.sections.map(secBounds), sections: 0, y: [0, 0, 0, 0, 0], v: [0, 0, 0, 0, 0], flash: [0, 0, 0, 0, 0], height: b.height * p.scale, avi: b.aviation, x: p.x, z: p.z });
    rebuildGhost(landmarks[landmarks.length - 1]);
  }
  function rebuildGhost(lm) {
    const gg = new Geo();
    lm.secGeos.forEach((sg, i) => { if (i >= lm.sections) gg.append(sg, 0, 0, 0, 0, 1.0); });
    lm.ghost.geometry.dispose(); lm.ghost.geometry = lm.ghostZ.geometry = gg.empty ? new THREE.BufferGeometry() : gg.build();
    lm.ghost.visible = lm.ghostZ.visible = !gg.empty;
  }
  function setLandmarks(list, { animate = true } = {}) {
    for (const l of list) {
      const lm = landmarks.find((x) => x.name === l.ladder); if (!lm) continue;
      const s = clamp(l.sections | 0, 0, 5), prev = lm.sections;
      for (let k = 0; k < 5; k++) {
        lm.U.uSecOn.value[k] = k < s ? 1 : 0;
        if (k < s && k >= prev && animate && motion) { lm.y[k] = -1.4; lm.v[k] = 0; lm.flash[k] = 1; }
        else if (k < s && k >= prev) { lm.y[k] = 0; }
        if (k >= s) { lm.y[k] = 0; lm.flash[k] = 0; }
      }
      lm.sections = s; rebuildGhost(lm);
    }
    updateAviation(); wake();
  }
  landmarks.forEach((lm) => { for (let k = 0; k < 5; k++) lm.U.uSecOn.value[k] = 0; });

  /* ------------------------------------------------------------ life */
  const cars = createCars(L, shared, scene);
  const ferry = createFerry(L, shared, scene);
  const birds = createBirds(scene);

  /* ------------------------------------------------------------ live layers: weather, seasonal props, flow streetlights, construction cam */
  const todayLot = () => lots.find((l) => l.isToday) || null;
  const weather = createWeather({ scene, sky, target: controls.target, L, radial, camera: isCity ? camera : null });
  const setPool = (k, v) => { if (v) dynPools.set(k, v); else dynPools.delete(k); rebuildPools(); invalidate(); };
  const flow = createFlow({ scene, L, shared, radial, setPool });
  const seasonal = createSeasonal({ scene, shared, L, lots, landmarks, radial, target: controls.target });
  const cons = createConstruction({ scene, shared, getToday: todayLot, radial, setPool, wake: () => wake() });
  let lastHour = 12, liveForced = false, focusOn = false, focusAz = 0, focusFlight = null, pendingFocus = null, focusOpts = {}, focusLotI = -1, consWas = false, camDone = false;
  const camHost = host.classList.contains('stage--cam');

  /* ------------------------------------------------------------ time of day */
  const fogBase = { near: 34, far: 150, haze: 0.36, blur: 1 };
  const warmHead = new THREE.Color(1.0, 0.8, 0.5), tmpCol = new THREE.Color();
  function setTime(hour, fromWeather) {
    lastHour = hour;
    const p = cur = weather.apply(timeParams(hour));
    sky.set(p);
    hemi.color.copy(p.hemiS); hemi.groundColor.copy(p.hemiG); hemi.intensity = p.hemiI * 1.5;
    key.color.copy(p.key); key.intensity = p.keyI * 2.2; key.position.copy(p.light).multiplyScalar(30);
    const wv = weather.v;
    scene.fog.color.copy(p.hor).lerp(p.mid, 0.55).lerp(fogNavy, 0.35 * (1 - p.day)); scene.fog.near = 34 * (1 - 0.65 * wv.fog - 0.15 * wv.rain); scene.fog.far = 150 * (1 - 0.6 * wv.fog - 0.2 * wv.rain - 0.1 * wv.snow);
    fogBase.near = scene.fog.near; fogBase.far = scene.fog.far;
    if (isCity) {
      sky.mat.uniforms.uFogCol.value.copy(scene.fog.color);
      backFill.color.copy(p.key); backFill.intensity = p.keyI * 0.55; backFill.position.set(-p.light.x, Math.max(p.light.y, 0.35), -p.light.z).multiplyScalar(30);
    }
    shared.uSnow.value = Math.min(1, weather.v.snow * 1.6);
    shared.uGlow.value = p.glow; shared.uDay.value = p.day; shared.uSkyRefl.value.copy(p.hor).lerp(p.top, 0.5);
    shared.uBill.value = 0.5 + 0.5 * p.glow;
    const wu = water.material.uniforms;
    wu.uHor.value.copy(p.hor).lerp(p.mid, 0.4); wu.uTop.value.copy(p.top); wu.uDisc.value.copy(p.disc); wu.uGlow.value = p.glow; wu.uDayAmt.value = p.day;
    wu.uDiscCol.value.copy(sky.mat.uniforms.uDiscCol.value).multiplyScalar(1 - 0.94 * weather.v.cover); wu.uDeep.value.copy(p.top).multiplyScalar(0.45).lerp(new THREE.Color(0x0d2a5a), 0.55);
    poolMat.opacity = 1; poolMat.color.setScalar((0.1 + 0.9 * p.glow) * (1 + 0.45 * wv.rain));            // wet streets mirror the lamps
    lampHeads.material.color.copy(tmpCol.setRGB(1, 1, 1)).multiplyScalar(1);
    shStrength = 0.2 + 0.4 * (0.3 + 0.7 * clamp(p.keyI / 2, 0, 1)); if (!fromWeather) shDirty = true;
    bloom.strength = 0.05 + 0.17 * p.glow;
    renderer.toneMappingExposure = EXPOSURE - 0.16 * clamp(p.day, 0, 1);                       // limestone by day must not clip; nights get the full exposure
    tmpCol.copy(p.hor).lerp(p.mid, 0.55).convertLinearToSRGB(); finalPass.uniforms.uHaze.value.set(tmpCol.r, tmpCol.g, tmpCol.b); finalPass.uniforms.uHazeAmt.value = fogBase.haze = 0.36 + 0.3 * wv.fog + 0.1 * wv.rain;
    birds.mesh.visible = motion && p.day > 0.2 && p.glow < 0.7 && wv.rain < 0.2 && wv.snow < 0.2;
    seasonal.setWet(wv.rain > 0.2 || wv.snow > 0.2);
    // streetlamp heads in the static ground glow with the windows (kind GLOW in the shader)
    invalidate();
  }

  /* ------------------------------------------------------------ data in */
  const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
  function layoutLamps(withPools) {
    let n = 0; const now = performance.now() / 1000;
    for (const lot of lots) {
      lot.lamps.forEach((hex, j) => {
        const age = clamp((now - lot.lampBorn[j]) / 0.45, 0, 1), s = age >= 1 ? 1 : (1 + 0.5 * Math.sin(age * Math.PI)) * smooth(age);
        const x = lot.x + (j - (lot.lamps.length - 1) / 2) * 0.17, z = lot.z + LOT_D / 2 + 0.07;
        dummy.position.set(x, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(Math.max(s, 0.001)); dummy.updateMatrix(); lampPosts.setMatrixAt(n, dummy.matrix);
        dummy.position.set(x, 0.33 * Math.max(s, 0.001), z); dummy.updateMatrix(); lampHeads.setMatrixAt(n, dummy.matrix); lampHeads.setColorAt(n, tmpC.set(hex).multiplyScalar(1.8));
        n++;
      });
    }
    lampPosts.count = lampHeads.count = n; lampPosts.instanceMatrix.needsUpdate = true; lampHeads.instanceMatrix.needsUpdate = true; if (lampHeads.instanceColor) lampHeads.instanceColor.needsUpdate = true;
    if (!withPools) return;
    for (const lot of lots) lot.lamps.forEach((hex, j) => dynPools.set('l' + lot.i + '_' + j, [lot.x + (j - (lot.lamps.length - 1) / 2) * 0.17, lot.z + LOT_D / 2 + 0.07, 0.3, new THREE.Color(hex), 0.6]));
  }
  function layoutBeacons(now) {
    let n = 0, moving = false;
    for (const lot of lots) {
      if (lot.kind !== 'tower') continue;
      lot.beacons.forEach((hex, j) => {
        const sl = lot.slots[j % lot.slots.length] || { x: 0, y: lot.topY, z: 0 };
        const age = lot.bBorn[j] > 0 ? (now - lot.bBorn[j]) / 0.7 : 1;
        let s = age >= 1 ? 1 : smooth(clamp(age, 0, 1)) * (1 + 0.25 * Math.sin(clamp(age, 0, 1) * Math.PI)); if (age < 1) moving = true;
        s = Math.max(s, 0.001);
        const y = sl.y * lot.g + 0.0;
        dummy.position.set(lot.x + sl.x, y, lot.z + sl.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, s, 1); dummy.updateMatrix(); bMast.setMatrixAt(n, dummy.matrix);
        const pulse = 1 + 0.18 * Math.sin(now * 3 + j * 1.7);
        dummy.position.y = y + 0.42 * s; dummy.scale.setScalar(s * pulse); dummy.updateMatrix(); bOrb.setMatrixAt(n, dummy.matrix); bOrb.setColorAt(n, tmpC.set(hex).lerp(beaconTone, 0.15).multiplyScalar(2.0));
        n++;
      });
    }
    bMast.count = bOrb.count = n; bMast.instanceMatrix.needsUpdate = bOrb.instanceMatrix.needsUpdate = true; if (bOrb.instanceColor) bOrb.instanceColor.needsUpdate = true;
    return moving;
  }
  let aviList = [];
  function updateAviation() {
    aviList = [];
    for (const lot of lots) if (lot.kind === 'tower' && lot.aviation) aviList.push({ lot, p: lot.aviation });
    for (const lm of landmarks) if (lm.avi && lm.sections >= 5) aviList.push({ lm, p: lm.avi });
    avi.count = Math.min(aviList.length, avi.instanceMatrix.count);
    blinkAvi(0, true);
  }
  function blinkAvi(t, force) {
    for (let i = 0; i < avi.count; i++) {
      const a = aviList[i], lot = a.lot, lm = a.lm;
      if (lot) dummy.position.set(lot.x + a.p.x, a.p.y * lot.g, lot.z + a.p.z);
      else dummy.position.set(lm.x + a.p.x * lm.plot.scale, a.p.y * lm.plot.scale, lm.z + a.p.z * lm.plot.scale);
      dummy.scale.setScalar(1); dummy.updateMatrix(); avi.setMatrixAt(i, dummy.matrix);
      const on = !motion ? 1 : (Math.sin(t * 2.4 + i * 1.3) > 0.45 ? 1 : 0.12);
      avi.setColorAt(i, tmpC.setRGB(1.9 * on, 0.18 * on, 0.16 * on));
    }
    avi.instanceMatrix.needsUpdate = true; if (avi.instanceColor) avi.instanceColor.needsUpdate = true; void force;
  }

  function refreshShadowRects() {
    shadowRects.length = 0;
    for (const lot of lots) if (lot.kind === 'tower') shadowRects.push({ x: lot.x, z: lot.z + LOT_D / 2 - lot.d / 2, w: lot.w, d: lot.d, h: Math.max(0.2, lot.height * lot.g) });
    for (const lm of landmarks) if (lm.sections > 0) shadowRects.push({ x: lm.x, z: lm.z, w: 1.3 * lm.plot.scale, d: 1.0 * lm.plot.scale, h: lm.height * (lm.sections / 5) });
    shDirty = true;
  }

  function setDays(days, { animate = true } = {}) {
    const now = performance.now() / 1000;
    const list = days.slice(-N);
    list.forEach((d, k) => {
      const lot = lots[k]; lot.day = d;
      const prevF = lot.kind === 'tower' ? lot.F : 0, prevTop = lot.kind === 'tower' ? lot.topY * lot.g : 0.06, wasKind = lot.kind;
      let F = clamp(d.floors | 0, 0, MAXF);
      if (F === 0 && (d.doors || d.crown)) F = 1;
      const kind = F > 0 ? 'tower' : (d.status === 'rest' ? 'rest' : d.status === 'missed' ? 'missed' : d.status === 'future' ? 'future' : 'open');
      const dn = dateNum(k, list), h = hash01(dn * 977 + 11), style = pickStyle(F, h);
      const target = d.targetFloor || 6, scaffold = !!d.scaffold || d.status === 'repair';
      const stars = clamp(d.stars | 0, 0, 3), sig = kind + ':' + F + ':' + style + ':' + target + ':' + scaffold + ':' + dn + ':' + stars;
      lot.isToday = !!d.isToday; lot.doors = !!d.doors; lot.crown = !!d.crown; lot.target = target;
      if (sig !== lot.sig) {
        lot.sig = sig; lot.kind = kind === 'tower' ? 'tower' : kind; lot.F = F; lot.style = style;
        if (kind === 'tower') {
          const nb = tryDayTower({ F, seed: dn, target, scaffold, stars });
          const sp = nb ? nb.look : STYLE[style], w = nb ? nb.w : F >= 9 ? 1.38 : 1.46, dd = nb ? nb.d : style === 'brownstone' ? 1.5 : style === 'bodega' ? 1.15 : style === 'walkup' ? 1.45 : style === 'prewar' ? 1.6 : 1.42 + h * 0.08;
          const b = nb || buildBuilding({ F, w, d: dd, style, seed: dn, target, scaffold });
          lot.roofY = b.roofY ?? b.top; lot.w = w; lot.d = dd; lot.topY = b.top; lot.height = b.top; lot.slots = b.slots; lot.roof = b.roof; lot.aviation = b.aviation; lot.doorX = b.doorX; lot.crownY = b.crownY || 0; lot.siteLamps = [];
          applyLotGeometry(lot, b, 'tower', F);
          const U = lot.U; U.uPitch.value = sp.pitch; U.uFill.value.set(sp.fill[0], sp.fill[1]); U.uGlass.value = sp.glass; U.uLitP.value = sp.litP * (0.92 + 0.14 * hash01(dn + 5)); U.uSeed.value = (dn % 997) * 1.37; U.uAO.value = 0.34;
          // grow from what stood here before
          if (animate && motion) {
            lot.gT = 1; lot.g = clamp(prevTop / Math.max(b.top, 0.2), 0.03, 1); if (F > prevF && wasKind === 'tower') lot.g = clamp(prevTop / Math.max(b.top, 0.2), 0.05, 1); lot.gv = 0;
            if (F > prevF) { lot.flashStart = now + 0.08; U.uFlashF0.value = prevF; lot.bodyFlash = 1; }
          } else { lot.g = 1; lot.gv = 0; U.uFlashT.value = -1; }
        } else {
          const b = buildSite({ kind, seed: dn });
          lot.w = 1.4; lot.d = 1.7; lot.topY = 0.3; lot.height = 0.3; lot.slots = []; lot.aviation = null; lot.siteLamps = b.lamps || [];
          applyLotGeometry(lot, b, kind, 0);
          lot.U.uSeed.value = (dn % 997) * 1.37; lot.g = 1; lot.gv = 0; lot.U.uFlashT.value = -1;
        }
      }
      lot.U.uGrow.value = lot.g;
      // doors and crown
      if (lot.doors && !lot.doorWas && animate && motion) lot.doorFlash = 1;
      if (lot.crown && !lot.crownWas && animate && motion) lot.crownFlash = 1;
      lot.doorWas = lot.doors; lot.crownWas = lot.crown;
      if (!animate || !motion) { lot.doorLevel = lot.doors ? 1 : 0; lot.crownLevel = lot.crown ? 1 : 0; }
      // beacons
      const want = d.beacons || [];
      for (let j = lot.beacons.length; j < want.length; j++) lot.bBorn[j] = animate && motion ? now : -9;
      lot.beacons = want.slice(0, 6);
      // lamps
      const had = lot.lamps.length; lot.lamps = (d.lamps || []).slice(0, 8);
      for (let j = had; j < lot.lamps.length; j++) lot.lampBorn[j] = animate && motion ? now : -9;
      for (let j = lot.lamps.length; j < 8; j++) dynPools.delete('l' + lot.i + '_' + j);
      lot.fog = d.fog | 0;
    });
    // blueprint + today ring
    const t = lots.find((x) => x.isToday);
    if (t) { todayRing.visible = true; todayRing.position.x = t.x; todayRing.position.z = t.z; } else todayRing.visible = false;
    placeBlueprint();
    // door pools, park lamp pools, mist
    for (const lot of lots) {
      if (lot.kind === 'tower' && lot.doors) dynPools.set('d' + lot.i, [lot.x + lot.doorX, lot.z + LOT_D / 2 + 0.2, 0.34, warmPool, 0.4]); else dynPools.delete('d' + lot.i);
      lot.siteLamps.forEach((p, j) => dynPools.set('s' + lot.i + '_' + j, [lot.x + p[0], lot.z + p[2], 0.45, warmPool, 0.26]));
      if (lot.kind === 'tower' || !lot.siteLamps.length) for (let j = 0; j < 3; j++) if (lot.kind === 'tower') dynPools.delete('s' + lot.i + '_' + j);
    }
    mistItems.length = 0;
    for (const lot of lots) if (lot.fog > 0) for (let j = 0; j < 3; j++) mistItems.push({ x: lot.x + (j - 1) * 0.5, z: lot.z + 0.1 + (j % 2) * 0.35, y: 0.1 + j * 0.09, s: 1.1 + (j % 2) * 0.35, ph: lot.i * 1.7 + j });
    layoutMist(0);
    layoutLamps(true); rebuildPools(); refreshShadowRects(); updateAviation();
    updateAvi();
    cons.onLots();
    if (pendingFocus) focusConstruction(...pendingFocus);
    else if (focusOn && todayLot() && todayLot().i !== focusLotI) focusConstruction(true, focusOpts);       // a new day: follow the new lot
    else if (camHost && !camDone && todayLot()) { camDone = true; focusConstruction(true); }          // the focus screen (.stage--cam) frames today's lot by itself
    wake();
  }
  function updateAvi() { blinkAvi(clock, true); }
  function layoutMist(t) {
    mistItems.forEach((m, i) => { dummy.position.set(m.x + Math.sin(t * 0.15 + m.ph) * 0.12, m.y, m.z); dummy.rotation.set(0, m.ph, 0); dummy.scale.set(m.s * 1.7, 1, m.s * 1.4); dummy.updateMatrix(); mistMesh.setMatrixAt(i, dummy.matrix); });
    mistMesh.count = mistItems.length; mistMesh.instanceMatrix.needsUpdate = true;
  }
  function placeBlueprint() {
    const t = lots.find((x) => x.isToday);
    if (t && t.kind === 'tower' && !t.crown && t.F >= 1 && t.target * FLOOR_H > (t.roofY ?? t.topY) * t.g + 0.1 && !cons.on) {
      const y0 = (t.roofY ?? t.topY) * t.g, y1 = t.target * FLOOR_H;
      blueprint.visible = true; blueprint.position.set(t.x, y0, t.z + LOT_D / 2 - t.d / 2); blueprint.scale.set(t.w * 0.9, y1 - y0, t.d * 0.9);
    } else blueprint.visible = false;
  }

  /* ------------------------------------------------------------ crane (comeback day) */
  let crane = null;
  function craneAt(i) {
    const lot = lots[i]; if (!lot) return;
    if (crane) { scene.remove(crane.g); }
    const yel = rgb(MS.accent), grey = rgb(MS.slate);
    const mg = new Geo();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mg.bar([sx * 0.06, 0, sz * 0.06], [sx * 0.06, 2.6, sz * 0.06], 0.03, yel);
    for (let y = 0; y < 2.5; y += 0.25) { mg.bar([-0.06, y, 0.06], [0.06, y + 0.25, 0.06], 0.014, yel); mg.bar([0.06, y, -0.06], [-0.06, y + 0.25, -0.06], 0.014, yel); }
    const jg = new Geo();
    jg.bar([-0.8, 0, 0], [1.6, 0, 0], 0.05, yel); jg.bar([-0.8, 0.12, 0], [1.6, 0.0, 0], 0.016, yel); jg.box(-0.95, -0.1, -0.1, -0.6, 0.15, 0.1, grey); jg.box(-0.06, -0.12, -0.08, 0.1, 0.04, 0.08, rgb(MS.limestoneShade));
    const { mat } = createCityMaterial(shared, { ao: 0 });
    const g = new THREE.Group(), mast = new THREE.Mesh(mg.build(), mat), jibG = new THREE.Group(), jib = new THREE.Mesh(jg.build(), mat);
    jibG.position.y = 2.62; jibG.add(jib);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(MS.beacon) })); cable.position.set(1.3, -0.5, 0);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.limestone) })); blk.position.set(1.3, -1.1, 0);
    jibG.add(cable, blk); g.add(mast, jibG);
    g.position.set(lot.x + 0.55, 0, lot.z - 0.1); scene.add(g);
    crane = { g, jibG, cable, blk, lot, t0: performance.now() / 1000 }; wake();
  }
  function stepCrane(now) {
    if (!crane) return false;
    const t = now - crane.t0;
    crane.jibG.rotation.y = -Math.PI * 0.5 * (1 - smooth(clamp(t / 0.9, 0, 1)));
    const drop = smooth(clamp((t - 0.9) / 0.7, 0, 1)) * (1 - smooth(clamp((t - 1.8) / 0.7, 0, 1)));
    const len = 0.5 + 1.0 * drop; crane.cable.scale.y = len; crane.cable.position.y = -len / 2; crane.blk.position.y = -len - 0.1;
    crane.g.position.y = crane.lot.topY * crane.lot.g * 0 + 0.0; crane.g.scale.setScalar(clamp(t / 0.3, 0, 1) * (1 - smooth(clamp((t - 2.3) / 0.3, 0, 1))) + 0.001);
    if (t > 2.65) { scene.remove(crane.g); crane = null; return false; }
    return true;
  }

  /* ------------------------------------------------------------ per-frame work */
  function step(dt, now) {
    let moving = false, towerMoved = false;
    for (const lot of lots) {
      if (lot.kind === 'tower') {
        if (motion) { const a = 60 * (lot.gT - lot.g) - 9 * lot.gv; lot.gv += a * dt; lot.g += lot.gv * dt; } else { lot.g = lot.gT; lot.gv = 0; }
        if (Math.abs(lot.gT - lot.g) < 0.002 && Math.abs(lot.gv) < 0.002) { lot.g = lot.gT; lot.gv = 0; } else { moving = true; towerMoved = true; }
        lot.U.uGrow.value = lot.g;
      }
      const U = lot.U;
      if (lot.flashStart > 0) { const ft = now - lot.flashStart; if (ft > 2.2) { lot.flashStart = -1; U.uFlashT.value = -1; } else { U.uFlashT.value = Math.max(0, ft); moving = true; } }
      if (lot.bodyFlash > 0) { lot.bodyFlash = Math.max(0, lot.bodyFlash - dt * 1.8); moving = true; }
      U.uFlash.value = lot.bodyFlash;
      if (lot.doorFlash > 0) { lot.doorFlash = Math.max(0, lot.doorFlash - dt * 1.6); moving = true; }
      const dT = lot.doors ? 1 : 0; lot.doorLevel += (dT - lot.doorLevel) * Math.min(1, dt * 7); if (Math.abs(dT - lot.doorLevel) < 0.01) lot.doorLevel = dT; else moving = true;
      U.uDoor.value = lot.doorLevel + lot.doorFlash * 1.1;
      if (lot.crownFlash > 0) { lot.crownFlash = Math.max(0, lot.crownFlash - dt * 0.8); moving = true; }
      const cT = lot.crown ? 1 : 0; lot.crownLevel += (cT - lot.crownLevel) * Math.min(1, dt * 5); if (Math.abs(cT - lot.crownLevel) < 0.01) lot.crownLevel = cT; else moving = true;
      U.uCrown.value = lot.crownLevel; U.uCrownPulse.value = lot.crownFlash > 0 ? Math.sin(lot.crownFlash * 10) * lot.crownFlash : 0;
    }
    if (layoutBeacons(now)) moving = true;
    layoutLamps();
    if (towerMoved) { refreshShadowRects(); placeBlueprint(); blinkAvi(clock, true); }
    for (const lm of landmarks) {
      let any = false;
      for (let k = 0; k < 5; k++) {
        if (lm.flash[k] > 0 || Math.abs(lm.y[k]) > 0.002) {
          const a = 70 * (0 - lm.y[k]) - 10 * lm.v[k]; lm.v[k] += a * dt; lm.y[k] += lm.v[k] * dt;
          if (Math.abs(lm.y[k]) < 0.002 && Math.abs(lm.v[k]) < 0.01) { lm.y[k] = 0; lm.v[k] = 0; } else any = true;
        }
        if (lm.flash[k] > 0) { lm.flash[k] = Math.max(0, lm.flash[k] - dt * 0.9); any = true; }
        lm.U.uSecY.value[k] = lm.y[k]; lm.U.uSecFlash.value[k] = lm.flash[k] * lm.flash[k];
      }
      if (any) moving = true;
    }
    if (stepCrane(now)) moving = true;
    // live layers
    if (weather.update(dt, clock, motion)) { setTime(lastHour, true); moving = true; }
    if (flow.update(dt, now, motion)) moving = true;
    seasonal.update(clock, motion, cur);
    if (cons.update(dt, now, motion)) moving = true;
    if (cons.on !== consWas) { consWas = cons.on; placeBlueprint(); }
    return moving;
  }

  /* ------------------------------------------------------------ post: MSAA, bloom on lights only, tilt-shift + vignette */
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.32, 1.0);              // threshold at 1.0: only lamps, beacons and the brightest rooms bloom
  composer.addPass(bloom); composer.addPass(new OutputPass());
  const finalPass = new ShaderPass(FinalShader); composer.addPass(finalPass);
  // city: fog, top-of-frame haze and tilt-shift follow the camera, so a zoomed-out or top-down view is not washed out
  const vOff = new THREE.Vector3();
  function viewUniforms(tgt = controls.target) {
    if (!isCity) return;
    vOff.copy(camera.position).sub(tgt); const r = vOff.length() || 1, phi = Math.acos(clamp(vOff.y / r, -1, 1)), extra = Math.max(0, r - 24);
    scene.fog.near = fogBase.near + extra; scene.fog.far = fogBase.far + extra * 1.7;
    const tilt = smooth(clamp((phi - 0.25) / 0.65, 0, 1));
    finalPass.uniforms.uHazeAmt.value = fogBase.haze * tilt;
    finalPass.uniforms.uBlur.value = fogBase.blur * (0.15 + 0.85 * tilt);
  }
  const render = () => { sky.mesh.position.copy(camera.position); viewUniforms(); composer.render(); };

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const dpr = dprCap();
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr); composer.setSize(w, h);
    finalPass.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr)); finalPass.uniforms.uBlur.value = fogBase.blur = w < 500 ? 0.55 : 1;
    camera.aspect = w / h; camera.updateProjectionMatrix(); fit(); pointScale(h * dpr); invalidate();
  }
  function pointScale(px) { const k = px / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); weather.setPx(k); seasonal.setPx(k); }
  new ResizeObserver(resize).observe(host);

  /* ------------------------------------------------------------ render on demand */
  let raf = 0, last = 0, lastDraw = 0, visible = true, paused = false, activeUntil = performance.now() + ACTIVE_MS, quietUntil = 0;
  const wake = () => { activeUntil = performance.now() + ACTIVE_MS; invalidate(); };
  const canRun = () => visible && !document.hidden && !paused;
  function invalidate() { if (!raf && canRun()) raf = requestAnimationFrame(frame); }
  const tTarget = new THREE.Vector3(), off = new THREE.Vector3(), sph = new THREE.Spherical();
  function stepCamera(dt) {
    const nowMs = performance.now();
    if (camAnim) return stepAnim(nowMs);
    const f = flight && nowMs < flight.until ? flight : null;
    tTarget.copy(f ? f.target : baseTarget);
    // the Today hero / focus screen always settle on their framing distance; the free city camera keeps the user's zoom
    // and only eases the distance while a flight asks for it (a picked tower, a nudge) or a wheel zoom is gliding
    let wantR = f && f.abs ? f.abs : baseR * (f ? f.scale : 1), kR = 5;
    if (isCity) { if (f && nowMs < (f.rUntil ?? f.until)) { /* flight distance */ } else if (zoomGoal != null) { wantR = zoomGoal; kR = 11; } else wantR = null; }
    const k = motion ? 1 - Math.exp(-dt * 5) : 1, kz = motion ? 1 - Math.exp(-dt * kR) : 1;
    let moved = false;
    off.copy(tTarget).sub(controls.target);
    if (off.lengthSq() > 1e-6) { off.multiplyScalar(k); controls.target.add(off); camera.position.add(off); moved = true; }
    off.copy(camera.position).sub(controls.target);
    const r = off.length(), nr = wantR == null ? r : r + (wantR - r) * kz;
    if (Math.abs(nr - r) > 0.004) { off.setLength(nr); camera.position.copy(controls.target).add(off); moved = true; } else if (wantR != null && wantR === zoomGoal) zoomGoal = null;
    if (f && f.polar != null) {                                      // focus view: ease the tilt (and, for a moment, the heading) too
      sph.setFromVector3(off.copy(camera.position).sub(controls.target));
      const dp = f.polar - sph.phi, da = f.az != null && performance.now() < f.azUntil ? f.az - sph.theta : 0;
      if (Math.abs(dp) > 0.002 || Math.abs(da) > 0.002) { sph.phi += dp * k; sph.theta += da * k; off.setFromSpherical(sph); camera.position.copy(controls.target).add(off); moved = true; }
    }
    return moved;
  }
  /* ------------------------------------------------------------ city: view buttons (eased flights), wheel zoom, the height clamp */
  let camAnim = null, zoomGoal = null, userCam = false, preR = null;
  const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const curR = () => camera.position.distanceTo(controls.target);
  function zeroControls() { try { controls._sphericalDelta.set(0, 0, 0); controls._panOffset.set(0, 0, 0); controls._scale = 1; } catch { /* private fields moved: harmless */ } }
  function cancelCam() { camAnim = null; zoomGoal = null; if (flight) flight.rUntil = 0; }
  function animateView(goal, ms = 780) {
    sph.setFromVector3(off.copy(camera.position).sub(controls.target));
    const from = { phi: sph.phi, theta: sph.theta, r: sph.radius, t: controls.target.clone() };
    const to = { phi: goal.phi ?? from.phi, theta: goal.theta ?? from.theta, r: clamp(goal.r ?? from.r, MIN_R, MAX_R), t: (goal.target || from.t).clone() };
    if (!goal.spin) { const d = to.theta - from.theta; to.theta = from.theta + Math.atan2(Math.sin(d), Math.cos(d)); }   // the short way round
    zeroControls(); zoomGoal = null; userCam = true; markUsed();
    camAnim = { t0: performance.now(), ms: motion ? ms : 0, from, to };
    quietUntil = performance.now() + 6000; wake();
  }
  function stepAnim(nowMs) {
    const a = camAnim, t = a.ms > 0 ? clamp((nowMs - a.t0) / a.ms, 0, 1) : 1, e = eio(t);
    const phi = a.from.phi + (a.to.phi - a.from.phi) * e, th = a.from.theta + (a.to.theta - a.from.theta) * e, r = a.from.r + (a.to.r - a.from.r) * e;
    controls.target.lerpVectors(a.from.t, a.to.t, e);
    camera.position.setFromSphericalCoords(r, phi, th).add(controls.target); camera.lookAt(controls.target);
    if (t >= 1) camAnim = null;
    return true;
  }
  /** World > City view buttons: 'top' (look straight down), 'rotate' (the city turns a quarter clockwise on screen, so the next side
   *  comes into view: the camera walks a quarter round the other way), 'reset' (the hero 3/4 view) */
  function view(cmd) {
    if (!isCity) return false;
    const tgt = flight && flight.target && performance.now() < flight.until ? flight.target : baseTarget;
    if (cmd === 'top') animateView({ phi: TOP_PHI, r: clamp(curR(), baseR * 1.15, baseR * 1.8), target: tgt });
    else if (cmd === 'rotate') { sph.setFromVector3(off.copy(camera.position).sub(controls.target)); animateView({ theta: sph.theta + Math.PI / 2, spin: true, target: tgt }); }
    else if (cmd === 'reset') {
      if (pickRing.visible) { pickRing.visible = false; opts.onPick?.(-1); }
      flight = null; preR = null;
      animateView({ phi: polar0, theta: azim0, r: baseR, target: baseTarget }, 900);
    } else return false;
    return true;
  }
  // a gentle height clamp: the camera glides up over a roof instead of passing through it, and never sinks below the street
  function clampCam() {
    if (!isCity) return false;
    const p = camera.position, t = controls.target;
    let minY = Math.max(0.5, HF.at(p.x, p.z) + 0.55);
    for (const lot of lots) if (lot.kind === 'tower' && Math.abs(p.x - lot.x) < 1.6 && Math.abs(p.z - lot.z) < 1.8) minY = Math.max(minY, lot.topY * lot.g + 0.9);
    for (const lm of landmarks) if (lm.sections > 0) {                    // unlocked sections only, each by its own footprint (the plots are rotated and scaled)
      const s = lm.plot.scale, dx = p.x - lm.x, dz = p.z - lm.z, co = Math.cos(lm.plot.rot), si = Math.sin(lm.plot.rot), lx = (dx * co - dz * si) / s, lz = (dx * si + dz * co) / s, m = 0.7 / s;
      for (let i = 0; i < lm.sections && i < lm.secBox.length; i++) { const b = lm.secBox[i]; if (lx > b.x0 - m && lx < b.x1 + m && lz > b.z0 - m && lz < b.z1 + m) minY = Math.max(minY, b.y1 * s + 0.8); }
    }
    if (p.y >= minY - 1e-3) return false;
    if (zoomGoal != null && zoomGoal < curR()) zoomGoal = null;             // a wheel zoom ends on the roof instead of pushing into it
    p.y = Math.max(p.y + (minY - p.y) * 0.35, minY - 0.25); camera.lookAt(t);
    return true;
  }
  let hintDone = false;
  function markUsed() {
    if (hintDone || !isCity) return; hintDone = true; host.classList.add('is-explored');
    try { localStorage.setItem('epoch.city360', '1'); } catch { /* private mode */ }
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min((t - last) / 1000 || 0.016, 0.05); last = t;
    const now = performance.now() / 1000;
    let moving = step(dt, now);
    const live = motion && (liveForced || cons.on);                  // the focus screen keeps the scene gently alive (about 20 fps)
    if (live && t + 1500 > activeUntil) activeUntil = t + 3000;
    if (live !== liveMode) { liveMode = live; if (touch) resize(); }
    const idle = motion && t < activeUntil && t > quietUntil;
    if (stepCamera(dt)) moving = true;
    if (idle) {
      clock += dt; shared.uTime.value = clock; water.material.uniforms.uTime.value = clock; sky.mat.uniforms.uTime.value = clock;
      cars.update(clock); ferry.update(clock); if (birds.mesh.visible) birds.update(clock, L);
      blinkAvi(clock); layoutMist(clock);
      controls.autoRotate = !(isCity && userCam);                     // once you have looked around yourself, the city stays where you left it
      const half = focusOn ? 0.26 : (isCity ? 0.9 : 0.62), lim = half - 0.06, rel = controls.getAzimuthalAngle() - (focusOn ? focusAz : 0);
      if (rel > lim) dirSign = -1; else if (rel < -lim) dirSign = 1;
      controls.autoRotateSpeed = (focusOn ? 0.2 : isCity ? 0.55 : 0.9) * dirSign;
    } else controls.autoRotate = false;
    if (shDirty) updateShadows();
    if (moving || !idle || t - lastDraw > (live ? 38 : 33)) { if (!camAnim) controls.update(dt); if (clampCam()) moving = true; lastDraw = t; render(); }
    if (moving || idle) invalidate();
  }
  controls.addEventListener('start', () => { if (isCity) { cancelCam(); userCam = true; markUsed(); } quietUntil = performance.now() + 6000; activeUntil = Math.max(activeUntil, quietUntil + 400); invalidate(); });
  controls.addEventListener('change', invalidate);
  controls.addEventListener('end', () => { quietUntil = performance.now() + 6000; setTimeout(wake, 6100); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); wake(); } });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(host);
  host.addEventListener('pointerenter', wake);
  if (isCity) {
    // Wheel / trackpad: a smooth zoom toward the city. A page scroll that merely passes over the stage keeps scrolling the page:
    // the wheel zooms once the pointer has rested on the city (or after a drag on it); a trackpad pinch (ctrl+wheel) always zooms.
    let hoverSince = 0, lastScroll = 0, engaged = false;
    host.addEventListener('pointerenter', () => { hoverSince = performance.now(); });
    host.addEventListener('pointerleave', () => { engaged = false; });
    renderer.domElement.addEventListener('pointerdown', () => { engaged = true; });
    addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true, capture: true });
    host.addEventListener('wheel', (e) => {
      if (e.target !== renderer.domElement) return;
      e.stopPropagation();                                                      // OrbitControls' own (stepped) wheel zoom never runs
      const now = performance.now();
      if (!(engaged || e.ctrlKey || (now - hoverSince > 450 && now - lastScroll > 650))) return;
      e.preventDefault();
      const dy = clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY, -240, 240);
      camAnim = null; if (flight) flight.rUntil = 0; zeroControls(); userCam = true; markUsed();
      zoomGoal = clamp((zoomGoal ?? curR()) * Math.exp(dy * (e.ctrlKey ? 0.011 : 0.0016)), MIN_R, MAX_R);
      quietUntil = now + 6000; wake();
    }, { capture: true, passive: false });
    host.querySelectorAll('[data-city-view]').forEach((b) => b.addEventListener('click', () => view(b.dataset.cityView)));
    try { if (localStorage.getItem('epoch.city360') === '1') { hintDone = true; host.classList.add('is-explored'); } } catch { /* private mode */ }
  }
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); host.classList.add('no-webgl'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { host.classList.remove('no-webgl'); invalidate(); });
  mqReduce.addEventListener?.('change', () => setMotion(!mqReduce.matches));

  /* ------------------------------------------------------------ picking */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitP = new THREE.Vector3(); let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) { down = null; return; }
    down = null; const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    let best = -1, bd = 1e9;
    for (const lot of lots) {
      const b = lot.box.clone(); b.max.y = Math.max(0.5, lot.kind === 'tower' ? lot.topY * lot.g + 0.35 : 0.5);
      if (ray.ray.intersectBox(b, hitP)) { const d = hitP.distanceTo(camera.position); if (d < bd) { bd = d; best = lot.i; } }
    }
    pick(best);
  });
  function pick(i) {
    const lot = lots[i];
    const now = performance.now();
    if (lot && i >= 0) {
      pickRing.visible = true; pickRing.position.x = lot.x; pickRing.position.z = lot.z;
      if (isCity && preR == null) preR = curR();
      camAnim = null; zoomGoal = null;
      flight = { target: new THREE.Vector3(lot.x * 0.85, Math.min(lot.height * 0.5, 3.2) + 0.3, lot.z * 0.85), scale: isCity ? 0.6 : 0.72, until: Infinity, rUntil: now + 1800 };
    } else {
      pickRing.visible = false; flight = focusOn ? focusFlight : null;
      if (isCity && preR != null) { flight = { target: baseTarget.clone(), abs: preR, scale: 1, until: now + 1600 }; preR = null; }
    }
    opts.onPick?.(i); wake();
  }

  /* ------------------------------------------------------------ nudges */
  function focusDay(i, ms = 2200) {
    const lot = lots[i]; if (!lot || focusOn) return;                      // the construction-cam screen keeps its own framing
    flight = { target: new THREE.Vector3(lot.x * 0.5, baseTarget.y, baseTarget.z), scale: 1, until: performance.now() + ms }; wake();
  }
  function nudgeLandmark(name) {
    const lm = landmarks.find((x) => x.name === name); if (!lm) return;
    flight = { target: new THREE.Vector3(lm.x * 0.6, Math.min(lm.height * 0.45, 3), lm.z * 0.5), scale: 0.78, until: performance.now() + 2600 }; wake();
  }

  /* ------------------------------------------------------------ API */
  function setMotion(on) {
    motion = !!on;
    if (!motion) { lots.forEach((b) => { b.g = b.gT; b.gv = 0; b.U.uGrow.value = b.g; b.U.uFlashT.value = -1; b.flashStart = -1; }); birds.mesh.visible = false; blinkAvi(0); }
    else birds.mesh.visible = cur.day > 0.2 && cur.glow < 0.7;
    wake(); invalidate();
  }
  /* ------------------------------------------------------------ live layers: public API */
  /** Construction cam. See DOM_CONTRACT.md. {active, phase:'work'|'break'|'topout', progress 0..1, floors | minutes, remaining, duration (seconds)} */
  function setConstruction(st) { cons.set(st); if (cons.on !== consWas) { consWas = cons.on; placeBlueprint(); } wake(); }
  function toppingOut() { cons.toppingOut(); wake(); }
  /** Frame today's lot close up with the crane (tablet focus screen). on=false goes back to the normal view. */
  function focusConstruction(on = true, o = {}) {
    focusOn = !!on;
    if (!focusOn) { pendingFocus = null; focusFlight = null; if (flight && flight.focus) flight = null; wake(); return true; }
    const f = cons.focus() || (() => { const t = todayLot(); return t ? { x: t.x, z: t.z, baseY: 0, top: 2.2, craneTop: 3.4 } : null; })();
    if (!f) { focusOn = false; pendingFocus = [on, o]; return false; }       // today's lot is not known yet: retry when setDays arrives
    pendingFocus = null; focusLotI = (todayLot() || {}).i;
    const top = Math.max(f.craneTop, 2.6), aspect = (host.clientWidth || 1200) / (host.clientHeight || 750);
    const R = o.distance || Math.max(clamp((top + 1.0) * 2.7, 9.5, 24), 4.8 / (0.574 * aspect));
    focusOpts = o; focusAz = o.azimuth ?? 0.2;
    focusFlight = flight = { target: new THREE.Vector3(f.x + 0.35, top * (o.lookY ?? 0.36), f.z - 0.2), abs: R, scale: 1, polar: o.polar ?? 1.2, az: focusAz, azUntil: performance.now() + 1800, until: Infinity, focus: true };
    quietUntil = 0; wake(); return true;
  }
  /** keep the scene gently animating (about 20 fps) even without interaction; the focus screen turns this on. Automatic while a construction run is active. */
  function setLive(on) { liveForced = !!on; wake(); }
  /** /api/weather object in, clouds / rain / snow / fog / light out */
  function setWeather(w) { weather.set(w); setTime(lastHour, true); wake(); return weather.info; }
  /** list of season keys (strings or {key}) from /api/today.seasonal */
  function setSeasonal(keys) { const r = seasonal.set(keys); seasonal.setPx(pxNow()); wake(); return r; }
  /** flow meter: {hours_lit, minutes?, to_next_hour_min?, active?} */
  function setFlow(f) { flow.set(f, performance.now() / 1000); wake(); }
  const pxNow = () => (host.clientHeight * dprCap()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

  /** snapshot() with no argument keeps the old behaviour (a PNG data URL of the live canvas, synchronous).
   *  snapshot({width, height, hour?, view?, type?, quality?}) resolves to a Blob of a clean render (no rings or outlines) at exactly that size.
   *  view: 'hero' (default, the canonical framing for that aspect) or 'current' (what the camera sees now). */
  function snapshot(o) {
    if (!o) { render(); return renderer.domElement.toDataURL('image/png'); }
    return snapshotBlob(o);
  }
  function snapshotBlob(o = {}) {
    const w = clamp(Math.round(o.width) || 1200, 64, 4096), h = clamp(Math.round(o.height) || 800, 64, 4096);
    const ui = [todayRing, pickRing, blueprint], uiVis = ui.map((x) => x.visible);
    const sv = { pos: camera.position.clone(), quat: camera.quaternion.clone(), asp: camera.aspect, hour: lastHour };
    let canvas2d;
    try {
      ui.forEach((x) => { x.visible = false; });
      if (o.hour != null) setTime(+o.hour, true);
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); composer.setPixelRatio(1); composer.setSize(w, h);
      finalPass.uniforms.uTexel.value.set(1 / w, 1 / h); finalPass.uniforms.uBlur.value = fogBase.blur = w < 500 ? 0.55 : 1;
      camera.aspect = w / h; camera.updateProjectionMatrix(); pointScale(h);
      if (o.view !== 'current') {
        const f = calcFit(w / h), tgt = new THREE.Vector3(isCity ? f.tx : baseTarget.x, baseTarget.y, baseTarget.z);
        camera.position.setFromSphericalCoords(f.r, polar0, azim0).add(tgt); camera.lookAt(tgt);
      }
      if (shDirty) updateShadows();
      sky.mesh.position.copy(camera.position);
      if (o.view !== 'current') { const f = calcFit(w / h); viewUniforms(new THREE.Vector3(isCity ? f.tx : baseTarget.x, baseTarget.y, baseTarget.z)); } else viewUniforms();
      composer.render();
      canvas2d = document.createElement('canvas'); canvas2d.width = w; canvas2d.height = h;
      canvas2d.getContext('2d').drawImage(renderer.domElement, 0, 0);
    } finally {
      ui.forEach((x, i) => { x.visible = uiVis[i]; });
      camera.position.copy(sv.pos); camera.quaternion.copy(sv.quat); camera.aspect = sv.asp; camera.updateProjectionMatrix();
      if (o.hour != null) setTime(sv.hour, true);
      resize(); wake();
    }
    return new Promise((resolve, reject) => canvas2d.toBlob((b) => (b ? resolve(b) : reject(new Error('snapshot failed'))), o.type || 'image/png', o.quality));
  }
  function debugState() {
    return { hour: lastHour, weather: { ...weather.v }, weatherInfo: { ...weather.info }, seasonal: seasonal.shown, flow: flow.hours, construction: { on: cons.on, phase: cons.phase, p: cons.S.p, floors: cons.S.floors, fade: cons.S.fade }, live: liveForced || cons.on, focus: focusOn, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
  /** where the camera is: {az, polar, r, y} (radians, scene units) */
  function camState() { sph.setFromVector3(off.copy(camera.position).sub(controls.target)); return { az: sph.theta, polar: sph.phi, r: sph.radius, y: camera.position.y, anim: !!camAnim }; }
  /** jump the camera (debug / screenshots): any of {az, polar, r}; keeps the current orbit target */
  function setCam(v = {}) {
    const c = camState(); cancelCam(); zeroControls(); flight = null; if (isCity) userCam = true;
    controls.target.copy(baseTarget); if (v.tx != null) controls.target.set(v.tx, v.ty ?? baseTarget.y, v.tz ?? baseTarget.z);
    camera.position.setFromSphericalCoords(clamp(v.r ?? c.r, controls.minDistance, controls.maxDistance), clamp(v.polar ?? c.polar, controls.minPolarAngle, controls.maxPolarAngle), v.az ?? c.az).add(controls.target);
    camera.lookAt(controls.target); controls.update(); for (let i = 0; i < 40 && clampCam(); i++); wake(); return camState();
  }

  const api = {
    setDays, setLandmarks, setTime: (h) => setTime(h), setHourFn: (fn) => { hourFn = fn; setTime(hourFn()); },
    pulse: (i) => { const b = lots[i]; if (b) { b.bodyFlash = 1; } wake(); }, focusDay, nudgeLandmark, craneAt, pick, setMotion,
    view, setCam, camState,
    setView(v) { if (v.tx != null) baseTarget.set(v.tx, v.ty, v.tz); if (v.r) baseR = v.r; controls.target.copy(baseTarget); camera.position.setFromSphericalCoords(baseR, v.polar ?? polar0, v.az ?? azim0).add(baseTarget); if (v.fov) { camera.fov = v.fov; camera.updateProjectionMatrix(); } flight = null; controls.update(); wake(); },
    pause: (p) => { paused = !!p; if (!paused) wake(); }, invalidate: wake,
    snapshot, setConstruction, toppingOut, focusConstruction, setLive, setWeather, setSeasonal, setFlow, debugState,
    renderNow: () => render(), renderer, scene, dbg: { hit: (nx, ny) => { ray.setFromCamera(ndc.set(nx, ny), camera); return ray.intersectObjects(scene.children, true).slice(0, 4).map((h) => ({ x: +h.point.x.toFixed(2), y: +h.point.y.toFixed(2), z: +h.point.z.toFixed(2), name: h.object.name || h.object.type })); }, bloom, hemi, key, controls, camera, finalPass, shared, scene, lots, landmarks, weather, seasonal, flow, cons },
    dispose() { cancelAnimationFrame(raf); controls.dispose(); composer.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
  // initial state
  cars.update(0); ferry.update(0);
  fit(); setTime(opts.hourFixed ?? hourFn()); resize();
  rebuildPools(); refreshShadowRects(); updateShadows();
  setInterval(() => { if (canRun()) setTime(hourFn()); }, 5 * 60 * 1000);
  setInterval(() => { if (cons.on && !motion && canRun()) wake(); }, 20000);                         // reduced motion: let the countdown move the building now and then
  void KIND; void hash01;
  try { if (new URLSearchParams(location.search).has('city-debug')) { (window.__city = window.__city || {})[mode] = api; } } catch { /* ignore */ }
  return api;
}
