// city/manhattan.js · World > City: real Manhattan at real scale, from NYC Open Data (see docs/MANHATTAN-DATA.md), as a blue-hour
// low-poly diorama in the Morningside palette. The user's day towers rise on real lots in Morningside Heights, levels light up
// real neighbourhoods (setUnlockedDistricts), and the free 360 camera flies the whole 21 km island.
//
//   createManhattan(host, opts) -> the same API as city.js's createCity (setDays, setLandmarks, pick, view, snapshot, ...)
//                                  plus flyTo(name), places(), setUnlockedDistricts(ids), districts(). null without WebGL2.
//
// Modules: mh_tiles.js (tile decode, building shader, LOD streaming) mh_ground.js (terrain, painted ground, water, far shore,
// district mask) mh_props.js (trees, lamps, roof tanks) mh_bridges.js mh_home.js (the user's lots). Data: ./manhattan/*.
// Render on demand: no frames while nothing moves, the tab is hidden or the stage is off screen.
//
// Three kinds of stage share this scene (opts.mode, and the .stage--cam class):
//   'city'  World > City      the free 360 camera over the whole island, fly-to chips, districts, the dream home
//   'week'  the Today hero    this week's lots on the user's block, a framed view that may only sway a little (no pan, no zoom)
//   'cam'   the Focus Screen  today's lot close up with the crane, the same rules; the construction cam (construction.js) stands on it
// The economy (docs/ECONOMY.md, /api/world economy): setEconomy(e) dresses the user's faceless figure (character.js) and puts it where the
// routine says (Butler Library while a block runs, walking home, asleep at home, idle by today's lot), shows the shop's tower upgrades and the
// gold three-star crowns (mh_home.js), and marks the home building with a small light. Tapping the home (or openRoom()) opens the cutaway room
// (room.js); its window is this scene rendered from the home's real position and floor (viewFrom).
// 'week' and 'cam' stream only the tiles around the block (a small triangle budget) and skip the dream-home corridor.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from './util.js';
import { timeParams, createSky } from './sky.js';
import { MS } from './palette.js';
import { makeUniforms, createBuildingMaterial, createTileManager, decodeTile, buildingMeshes, setShopFn, makeShopFn, toU, toV, fromUV, GA, CA, SA } from './mh_tiles.js';
import { makeTerrain, makeHeights, makeFrame, paintGround, createMask, buildGroundMesh, createGroundMaterial, buildEdge, createWater, buildFarShore } from './mh_ground.js';
import { decodeTrees, createTrees, createLamps, buildRoofProps } from './mh_props.js';
import { buildBridges } from './mh_bridges.js';
import { createHome, homeWeekView } from './mh_home.js';
import { createDream } from './mh_dream.js';
import { createLandmarkLights, DEFAULT_BIN } from './mh_landmarks.js';
import { createWeather } from './weather.js';
import { createConstruction } from './construction.js';
import { createFlow, lampSites } from './mh_flow.js';
import { createSeasonal } from './mh_seasonal.js';
import { FLOOR_H } from './shader.js';
import { createCharacter } from './character.js';
import { makeGlow } from './mh_glow.js';

const DATA = new URL('./manhattan/', import.meta.url);
const LADDERS = ['Python', 'Math', 'ML/DL', 'Papers', 'Writing/X'];          // -> Brooklyn Bridge, Empire State, Chrysler, Flatiron, Times Square
const LADDER_HEX = { 'Python': 0x74b8ff, 'Math': 0xb4a6ff, 'ML/DL': 0x62dda8, 'Papers': 0xff9c7e, 'Writing/X': 0xf59ce2 };
const EXPOSURE = 1.06, ACTIVE_MS = 20000;
const TOP_PHI = 0.02, MAX_PHI = 1.46, MIN_R = 45, MAX_R = 40000;
const AVE = -GA;                                    // azimuth that looks uptown along the avenues
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// final pass: a gentle tilt-shift blur at the top and bottom (model-city look), the haze where the city meets the sky, a vignette
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1 / 800, 1 / 600) }, uBlur: { value: 1 }, uVig: { value: 0.28 }, uHaze: { value: new THREE.Vector3(0.1, 0.1, 0.3) }, uHazeAmt: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uBlur, uVig, uHazeAmt; uniform vec3 uHaze;
    void main() {
      vec2 uv = vUv; vec4 c = texture2D(tDiffuse, uv);
      float amt = smoothstep(0.34, 0.52, abs(uv.y - 0.5)) * uBlur * 0.7;
      if (amt > 0.01) {
        vec4 acc = c; float ws = 1.0;
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; vec2 o = vec2(cos(a), sin(a)) * uTexel * (amt * 4.5); acc += texture2D(tDiffuse, uv + o); acc += texture2D(tDiffuse, uv + o * 0.5); ws += 2.0; }
        c = acc / ws;
      }
      float hz = smoothstep(0.62, 1.04, uv.y); hz = hz * hz;
      c.rgb = mix(c.rgb, uHaze, hz * uHazeAmt);
      float v = smoothstep(1.05, 0.38, length((uv - 0.5) * vec2(1.0, 0.92)));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c;
    }`,
};

async function getJSON(name) { const r = await fetch(new URL(name, DATA)); if (!r.ok) throw new Error(name + ' ' + r.status); return r.json(); }
async function getBin(name) { const r = await fetch(new URL(name, DATA)); if (!r.ok) throw new Error(name + ' ' + r.status); return r.arrayBuffer(); }

export function createManhattan(host, opts = {}) {
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) { upgradeFallback(host); return null; }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch { upgradeFallback(host); return null; }
  const T0 = performance.now(), timing = { start: T0 };
  const qs = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();

  /* ------------------------------------------------------------ device profile */
  const kind = opts.mode === 'week' ? (opts.cam || host.classList.contains('stage--cam') ? 'cam' : 'week') : 'city';
  const block = kind !== 'city';
  const touch = matchMedia('(pointer:coarse)').matches;
  const gl = renderer.getContext(), maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const mem = navigator.deviceMemory || 8;
  const light = qs.get('city-profile') === 'tablet' || (qs.get('city-profile') !== 'laptop' && (touch || mem <= 4 || maxTex < 8192));
  const P0 = light
    ? { name: 'tablet', budget: 800000, bias: 0.62, dpr: 1.5, mpp: 5.6, maxPx: 4096, step: 50, treeDist: 1100, mem: 26e6, samples: 2, bloomRes: 0.5 }
    : { name: 'laptop', budget: 2500000, bias: 1.0, dpr: 2, mpp: 2.7, maxPx: 8192, step: 25, treeDist: 2100, mem: 70e6, samples: 4, bloomRes: 1 };
  // the Today hero and the focus screen only look at one block: a small tile budget, a coarser ground, shorter tree distance. The focus
  // screen runs for hours, so it is lighter still.
  const P = block ? { ...P0, name: P0.name + '-' + kind, budget: (kind === 'cam' ? 450000 : 650000) * (light ? 0.65 : 1), bias: (kind === 'cam' ? 0.42 : 0.5) * (light ? 0.85 : 1), mpp: light ? 5.6 : 3.6, maxPx: light ? 4096 : 6144, step: 40,
    treeDist: light ? 600 : 800, mem: light ? 20e6 : 34e6, dpr: kind === 'cam' ? Math.min(P0.dpr, 1.75) : P0.dpr, samples: light ? 2 : 4 } : P0;
  let hourFn = opts.hour || (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let motion = opts.motion !== false && !mqReduce.matches;
  let liveMode = false;                                  // the focus screen runs for hours: a touch tablet then renders a little lighter
  const dprCap = () => Math.min(devicePixelRatio || 1, P.dpr, liveMode && touch ? 1.25 : (host.clientWidth * host.clientHeight > 1.4e6 ? 1.5 : 2));
  renderer.setPixelRatio(dprCap());
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = EXPOSURE;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  host.classList.add('is-manhattan', 'is-loading');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(MS.fog), 2000, 9000);
  const camera = new THREE.PerspectiveCamera(36, 1, 2, 60000);
  const U = makeUniforms();
  const bmat = createBuildingMaterial(U);
  let clock = 10;

  /* ------------------------------------------------------------ lights, sky */
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a2250, 2.4); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3); scene.add(key); scene.add(key.target);
  const fillL = new THREE.DirectionalLight(0xffffff, 0.8); scene.add(fillL); scene.add(fillL.target);
  const sky = createSky(); scene.add(sky.mesh);
  sky.mat.uniforms.uLift.value = 0; sky.mat.uniforms.uFogAmt.value = 1;
  let cur = timeParams(12);

  /* ------------------------------------------------------------ camera + controls */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.085; controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.9; controls.panSpeed = 1.0;
  controls.enablePan = true; controls.screenSpacePanning = false; controls.enableZoom = true;
  controls.minPolarAngle = TOP_PHI; controls.maxPolarAngle = MAX_PHI; controls.minDistance = MIN_R; controls.maxDistance = MAX_R;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.keyPanSpeed = 30;
  renderer.domElement.style.touchAction = 'none';
  if (block) {
    // the Today hero and the focus screen keep a framed view: the block can be turned a little (and the page still scrolls), nothing else
    controls.enablePan = false; controls.enableZoom = false; controls.rotateSpeed = 0.65;
    controls.minPolarAngle = kind === 'cam' ? 0.78 : 0.7; controls.maxPolarAngle = kind === 'cam' ? 1.12 : 1.3;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    renderer.domElement.style.touchAction = 'pan-y';
  }
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ------------------------------------------------------------ live layers: weather particles, flow lamps, seasonal props, construction */
  // rain and snow are sized in diorama units (weather.js): `unit` metres per unit, from the framing (the framed stages) or the zoom (the free city)
  let unitFix = 15;
  const radial = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const weather = createWeather({ scene, sky, target: controls.target, L: { zBack: -10, zFront: 10, rows: 1, rowZ: [0] }, radial, unit: () => (block ? unitFix : clamp(camera.position.distanceTo(controls.target) / 21, 3, 90)), bare: true });
  let flow = null, seasonal = null, cons = null, pendingFlow = null, pendingSeasonal = null, pendingCons = null, liveForced = false, consWas = false;

  /* ------------------------------------------------------------ the world (filled in once the data arrives) */
  const world = new THREE.Group(); world.name = 'manhattan'; scene.add(world);
  let TR = null, roofAt = () => -1e9, F = null, mask = null, tiles = null, home = null, water = null, lamps = null, treeSet = null, bridges = null, places = {}, farshore = null;
  let dream = null, lmLights = null, dreamState = null, brow = null;
  let figure = null, econ = null, pendingEcon = null, homeGlow = null, homePick = null, capturing = false, charTimer = 0, chrWas = '';
  let D = null, ready = false, pendingDays = null, pendingLm = null, rows = null, homeMeshes = new Map(), homeBins = new Set();
  const roofProps = new Map();           // tile key -> {grp, tris}
  let lockOnTarget = 0, maskFrom = 1, maskTo = 1, maskT0 = 0;

  /* ------------------------------------------------------------ post */
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: P.samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.34, 1.0);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  const finalPass = new ShaderPass(FinalShader); composer.addPass(finalPass);

  /* ------------------------------------------------------------ view state */
  const target = controls.target;
  let lift = 0;                       // how far above the ground the orbit target is held (the Home pose looks out from a penthouse)
  let camAnim = null, zoomGoal = null, zoomTgt = null, userCam = false, hintDone = false, picked = -1;
  const sph = new THREE.Spherical(), off = new THREE.Vector3();
  const curR = () => camera.position.distanceTo(target);
  function place(name) { return places[name] || places.home || { t: [0, 0], r: 3000, phi: 0.9, theta: AVE }; }
  function setView(v, ms) {
    const ty = v.abs != null ? v.abs : TR ? TR.ground(v.t[0], v.t[1]) + (v.ty || 0) : 0;
    // narrow stages (phones) pull back so the same place still fits across the frame (not for poses that sit just outside a facade)
    const aspect = (host.clientWidth || 1200) / (host.clientHeight || 600), wide = v.r > 10000 ? 2.4 : 1.35;
    animateView({ target: new THREE.Vector3(v.t[0], ty, v.t[1]), r: v.exact ? v.r : v.r * clamp(wide / aspect, 1, 2.2), phi: v.phi, theta: v.theta, lift: Math.max(0, ty - (TR ? TR.ground(v.t[0], v.t[1]) : 0)) }, ms);
  }
  function animateView(goal, ms) {
    sph.setFromVector3(off.copy(camera.position).sub(target));
    const from = { phi: sph.phi, theta: sph.theta, r: sph.radius, t: target.clone() };
    const to = { phi: goal.phi ?? from.phi, theta: goal.theta ?? from.theta, r: clamp(goal.r ?? from.r, MIN_R, MAX_R), t: (goal.target || from.t).clone() };
    if (!goal.spin) { const d = to.theta - from.theta; to.theta = from.theta + Math.atan2(Math.sin(d), Math.cos(d)); }
    const dist = from.t.distanceTo(to.t);
    const dur = ms != null ? ms : clamp(900 + dist * 0.14 + Math.abs(Math.log(to.r / from.r)) * 260, 900, 2800);
    zeroControls(); zoomGoal = null; zoomTgt = null; lift = goal.lift || 0;
    camAnim = { t0: performance.now(), ms: motion ? dur : 0, from, to, lift: dist > 600 ? Math.min(dist * 0.55, 9000) : 0 };
    quietUntil = performance.now() + 5000; wake();
  }
  function stepAnim(nowMs) {
    const a = camAnim, t = a.ms > 0 ? clamp((nowMs - a.t0) / a.ms, 0, 1) : 1, e = eio(t);
    const phi = a.from.phi + (a.to.phi - a.from.phi) * e, th = a.from.theta + (a.to.theta - a.from.theta) * e;
    // long flights rise over the city and come down at the far end
    const r = Math.exp(Math.log(a.from.r) + (Math.log(a.to.r) - Math.log(a.from.r)) * e) + a.lift * Math.sin(Math.PI * t) * (motion ? 1 : 0);
    target.lerpVectors(a.from.t, a.to.t, e);
    camera.position.setFromSphericalCoords(r, phi, th).add(target); camera.lookAt(target);
    if (t >= 1) camAnim = null;
    return true;
  }
  /* ---- the framed stages (Today hero, focus screen): where the camera sits, and how far it may sway ---- */
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let bf = null, frameOn = false, az0 = 0, azHalf = kind === 'cam' ? 0.26 : 0.62, dirSign = 1, focusOn = false, focusOpts = {}, camDone = false, pendingFocus = null;
  const aspectNow = () => (host.clientWidth || 1200) / (host.clientHeight || 700);
  const fovT = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const lotTopM = (l) => (l.kind === 'tower' ? l.topY * l.sv : l.real ? 14 : 6);
  /** how many of the lots can be seen from a camera at azimuth `theta` (tall real buildings between the camera and a lot hide it). Today's lot counts double. */
  function seen(theta, phi, r, tgt, ls) {
    const cp = new THREE.Vector3().setFromSphericalCoords(r, phi, theta).add(tgt); let n = 0;
    for (const l of ls) {
      // a built tower must show its body (its storeys and doors), not just its crown over a neighbour's roof
      const built = l.kind === 'tower';
      const top = l.g.position.y + (built ? Math.max(lotTopM(l) * 0.5, 6) : Math.max(lotTopM(l) * 0.8, 9)), dx = l.x - cp.x, dz = l.z - cp.z, d = Math.hypot(dx, dz) || 1; let hit = false;
      for (let i = 1; i <= 36 && !hit; i++) {
        const t = i / 38, x = cp.x + dx * t, z = cp.z + dz * t;
        if (Math.hypot(l.x - x, l.z - z) < (built ? Math.sqrt((l.L && l.L.areaM2) || 600) * 0.72 + 3 : 26 + l.sh)) break;  // the lot's own walls (heights.bin still has the real building there) do not count
        if (roofAt(x, z, 7) > cp.y + (top - cp.y) * t + 1) hit = true;
      }
      // and from its street side: the doors, the lit storeys and the crown face the street (lot.th), the back is a blank wall
      if (!hit) n += (l.isToday ? 2 : 1) * (built ? (Math.cos(theta - l.th) > -0.15 ? 2 : 0.5) : 1);
    }
    return n;
  }
  /** the best heading near `th0` (and, if that is walled in, the other sides): most lots in sight, then nearest to th0 */
  function bestHeading(th0, phi, r, tgt, ls, spread = 1.0) {
    let best = th0, bs = -1;
    const cands = []; for (let k = -5; k <= 5; k++) cands.push(th0 + k * (spread / 5)); for (const q of [Math.PI / 2, Math.PI, -Math.PI / 2]) for (let k = -2; k <= 2; k++) cands.push(th0 + q + k * 0.25);
    for (const th of cands) {
      const sc = seen(th, phi, r, tgt, ls) - 0.9 * Math.abs(wrapA(th - th0)) / Math.PI;
      if (sc > bs + 1e-9) { bs = sc; best = th; }
    }
    return best;
  }
  /** this week's lots (or, before the days arrive, the first seven): the camera looks at their middle from the side most of them face */
  function weekFrame(aspect) {
    let ls = home.slotLots.filter((l) => l.slot >= 0); if (!ls.length) ls = home.slotLots.slice(0, 7);
    // the whole row: built days, today and the quiet pads of the days to come all sit in the frame (the weights below pull it toward what is built)
    // the middle of the week, pulled toward what is built (today's tower most), so the user's towers sit in the middle of the frame
    let cx = 0, cz = 0, wsum = 0; for (const l of ls) { const w = l.isToday ? 3 : l.kind === 'tower' ? 2 : 1; cx += l.x * w; cz += l.z * w; wsum += w; } cx /= wsum; cz /= wsum;
    let best = 0, bs = -1e9;
    for (const a of ls) { let sc = 0; for (const l of ls) sc += Math.cos(l.th - a.th); if (sc > bs + 1e-6) { bs = sc; best = a.th; } }
    const th = best + 0.36, cs = Math.cos(th), sn = Math.sin(th);
    let halfW = 18, hmax = 20, rad = 20; const gy = TR.ground(cx, cz);
    for (const l of ls) { halfW = Math.max(halfW, Math.abs((l.x - cx) * cs - (l.z - cz) * sn) + l.sh * 0.95); hmax = Math.max(hmax, lotTopM(l)); rad = Math.max(rad, Math.hypot(l.x - cx, l.z - cz) + l.sh); }
    const t = fovT(), Rw = (halfW * 1.12) / (t * aspect), Rh = ((hmax * 0.95 + rad * 0.6 + 14) * 1.05) / (2 * t);
    const r = clamp(Math.max(Rw, Rh), 150, 900), ty = gy + clamp(hmax * 0.34, 7, 70), tg = new THREE.Vector3(cx, ty, cz);
    // the week's towers stand among real buildings as tall as they are: if the usual tilt hides them, look down a little more steeply
    let pick = null;
    for (const phi of [0.95, 0.84, 0.74, 0.64, 0.56]) {
      const hd = bestHeading(th, phi, r, tg, ls), sc = seen(hd, phi, r, tg, ls) - (0.95 - phi) * 2.5;
      if (!pick || sc > pick.sc + 1e-9) pick = { phi, hd, sc };
    }
    return { target: tg, r, phi: pick.phi, theta: pick.hd, lift: ty - gy, half: 0.62 };
  }
  /** today's lot close up with the crane (the construction cam) */
  function camFrame(aspect) {
    const l = home.todayLot() || home.slotLots.find((q) => q.slot >= 0) || home.slotLots[0];
    const f = cons && cons.focus ? cons.focus() : null;
    const top = Math.max(f ? f.craneTop : 3.2, 2.6), t = fovT();
    const w = new THREE.Vector3(0.35, top * (focusOpts.lookY ?? 0.36), -0.2).applyMatrix4(l.g.matrixWorld), gy = TR.ground(l.x, l.z);
    const Rh = (top * l.sv * 1.18) / (2 * t), Rw = (4.2 * l.sh) / (2 * t * aspect);
    const r = focusOpts.distance || clamp(Math.max(Rh, Rw) * 1.12, 38, 420);
    const phi = focusOpts.polar ?? 0.92, th0 = l.th + (focusOpts.azimuth ?? 0.2);
    return { target: w, r, phi, theta: focusOpts.azimuth != null ? th0 : bestHeading(th0, phi, r, w, [{ ...l, isToday: true }], 0.8), lift: w.y - gy, half: 0.26 };
  }
  function computeFrame(aspect) { if (!home || !TR) return null; return kind === 'cam' || focusOn ? camFrame(aspect) : weekFrame(aspect); }
  /** (re)frame the stage. `ms` 0 = jump. A user who has turned the view keeps their heading, the distance and target still follow. */
  function reframe(ms = 0) {
    const f = computeFrame(aspectNow()); if (!f) return;
    const same = bf && bf.target.distanceTo(f.target) < 2 && Math.abs(bf.r - f.r) < 0.03 * f.r && Math.abs(bf.theta - f.theta) < 0.01 && bf.half === f.half;
    bf = f; frameOn = true; azHalf = f.half; unitFix = clamp(f.r / 21, 3, 60); az0 = f.theta;
    if (picked >= 0 || (same && ms > 0)) return;
    const keep = ms === 0 && userCam && camera.position.distanceTo(target) > 1;
    if (keep) { sph.setFromVector3(off.copy(camera.position).sub(target)); animateView({ target: f.target, r: f.r, phi: sph.phi, theta: sph.theta, lift: f.lift }, 0); }
    else animateView({ target: f.target, r: f.r, phi: f.phi, theta: f.theta, lift: f.lift }, ms);
    tilesDirty = true; wake();
  }
  function clampAz() {
    if (!block || !frameOn || camAnim) return false;
    sph.setFromVector3(off.copy(camera.position).sub(target));
    const rel = wrapA(sph.theta - az0); if (Math.abs(rel) <= azHalf) return false;
    sph.theta = az0 + Math.sign(rel) * azHalf; camera.position.copy(target).add(off.setFromSpherical(sph)); camera.lookAt(target); zeroControls(); return true;
  }
  function zeroControls() { try { controls._sphericalDelta.set(0, 0, 0); controls._panOffset.set(0, 0, 0); controls._scale = 1; } catch { /* private fields moved */ } }
  function cancelCam() { camAnim = null; zoomGoal = null; zoomTgt = null; }

  /* island rows: how far the orbit target may wander across the avenues at each point along them */
  function buildRows(land) {
    const R = 100, map = new Map();
    for (const poly of land.polys) {
      const r = poly[0];
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length, x0 = r[i], z0 = r[i + 1], x1 = r[j], z1 = r[j + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 40));
        for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n, u = toU(x, z), v = toV(x, z), key2 = Math.floor(v / R); const m = map.get(key2); if (m) { m[0] = Math.min(m[0], u); m[1] = Math.max(m[1], u); } else map.set(key2, [u, u]); }
      }
    }
    const ks = [...map.keys()], k0 = Math.min(...ks), k1 = Math.max(...ks);
    return { R, k0, k1, at(v) { let k = clamp(Math.floor(v / R), k0, k1); for (let d = 0; d < 30; d++) { const m = map.get(k + d) || map.get(k - d); if (m) return m; } return [-3000, 3000]; } };
  }
  function clampTarget() {
    if (!rows) return false;
    const u = toU(target.x, target.z), v = toV(target.x, target.z);
    const vc = clamp(v, rows.k0 * rows.R - 500, (rows.k1 + 1) * rows.R + 500);
    let lo = Infinity, hi = -Infinity; for (let d = -3; d <= 3; d++) { const m = rows.at(vc + d * rows.R); lo = Math.min(lo, m[0]); hi = Math.max(hi, m[1]); }
    const uc = clamp(u, lo - 450, hi + 450);
    let moved = false;
    if (uc !== u || vc !== v) { const [x, z] = fromUV(uc, vc); const dx = x - target.x, dz = z - target.z; target.x += dx; target.z += dz; camera.position.x += dx; camera.position.z += dz; moved = true; }
    if (TR) { const gy = TR.ground(target.x, target.z) + lift, dy = (gy - target.y) * 0.25; if (Math.abs(dy) > 0.01) { target.y += dy; camera.position.y += dy; moved = true; } }
    return moved;
  }
  // the camera never goes under the street or into a building: it glides up over roofs
  function clampCam() {
    if (!TR) return false;
    const p = camera.position;
    let minY = TR.ground(p.x, p.z) + 3;
    const roof = roofAt(p.x, p.z, 9); if (roof > -1e8) minY = Math.max(minY, roof + 5);
    if (home) minY = Math.max(minY, home.topNear(p.x, p.z, 25));
    if (p.y >= minY - 1e-3) return false;
    if (zoomGoal != null && zoomGoal < curR()) zoomGoal = null;
    p.y = Math.max(p.y + (minY - p.y) * 0.4, minY - 1.5); camera.lookAt(target);
    return true;
  }

  /* ------------------------------------------------------------ time of day, weather */
  let lastHour = 12;
  const tmpCol = new THREE.Color(), fogBase = { k: 1, haze: 0.3 };
  const fogNavy = new THREE.Color(MS.fog);
  function setTime(hour) {
    lastHour = hour;
    // weather bends the light: covered sun, a greyer sky, more lit windows on dull days (weather.js)
    const p = cur = weather.apply(timeParams(hour)), wx = weather.v, cover = wx.cover;
    sky.set(p);
    hemi.color.copy(p.hemiS); hemi.groundColor.copy(p.hemiG); hemi.intensity = p.hemiI * (1.55 - 0.55 * p.glow);
    key.color.copy(p.key); key.intensity = p.keyI * (2.1 - 0.7 * p.glow);
    const L = new THREE.Vector3(p.light.x, p.light.y, p.light.z);
    key.position.copy(target).addScaledVector(L, 5000); key.target.position.copy(target);
    fillL.color.copy(p.key); fillL.intensity = p.keyI * 0.5; fillL.position.copy(target).add(new THREE.Vector3(-L.x, Math.max(L.y, 0.35), -L.z).multiplyScalar(5000)); fillL.target.position.copy(target);
    scene.fog.color.copy(p.hor).lerp(p.mid, 0.55).lerp(fogNavy, 0.35 * (1 - p.day));
    fogBase.k = (1 - 0.6 * wx.fog - 0.2 * wx.rain - 0.1 * wx.snow) * (1 + 0.7 * clamp(p.day, 0, 1));      // clear days see farther
    sky.mat.uniforms.uFogCol.value.copy(scene.fog.color);
    U.uGlow.value = p.glow; U.uDay.value = p.day; U.uSkyRefl.value.copy(p.hor).lerp(p.top, 0.5); U.uSkyTop.value.copy(p.top).lerp(p.mid, 0.35);
    U.uSnow.value = Math.min(1, wx.snow * 1.6); U.uWet.value = Math.min(1, wx.rain * 1.4);
    U.uLockCol.value.copy(scene.fog.color).lerp(new THREE.Color(MS.fog), 0.5);
    dream?.setTone(scene.fog.color, clamp(p.day, 0, 1)); seasonal?.setWet(wx.rain > 0.2 || wx.snow > 0.2);
    if (home) { const s = home.shared; s.uGlow.value = p.glow; s.uDay.value = p.day; s.uSkyRefl.value.copy(U.uSkyRefl.value); s.uSnow.value = U.uSnow.value; s.uBill.value = 0.5 + 0.5 * p.glow; }
    if (water) {
      const wu = water.material.uniforms;
      wu.uHor.value.copy(p.hor).lerp(p.mid, 0.4); wu.uTop.value.copy(p.top); wu.uDisc.value.copy(p.disc);
      wu.uDiscCol.value.copy(sky.mat.uniforms.uDiscCol.value).multiplyScalar(1 - 0.94 * cover); wu.uDeep.value.copy(p.top).multiplyScalar(0.42).lerp(new THREE.Color(0x0b2350), 0.55);
      wu.uFogCol.value.copy(scene.fog.color);
    }
    bloom.strength = 0.06 + 0.2 * p.glow;
    renderer.toneMappingExposure = EXPOSURE - 0.16 * clamp(p.day, 0, 1);
    tmpCol.copy(p.hor).lerp(p.mid, 0.55).convertLinearToSRGB(); finalPass.uniforms.uHaze.value.set(tmpCol.r, tmpCol.g, tmpCol.b);
    fogBase.haze = 0.3 + 0.3 * wx.fog;
    invalidate();
  }
  // fog, haze and tilt-shift follow the camera: the whole island from 25 km stays crisp, a street view gets a soft distance
  function viewUniforms() {
    const r = curR(), h = Math.max(30, camera.position.y);
    off.copy(camera.position).sub(target); const phi = Math.acos(clamp(off.y / (off.length() || 1), -1, 1));
    const k = fogBase.k;
    scene.fog.near = Math.max(1400, r * 0.9) * k; scene.fog.far = Math.max(8500, r * 2.6 + h * 4) * k;
    if (water) { water.material.uniforms.uFogNear.value = scene.fog.near; water.material.uniforms.uFogFar.value = scene.fog.far; }
    camera.near = clamp(Math.min(h * 0.25, r * 0.08), 1.5, 600); camera.far = Math.max(30000, r * 4 + 20000); camera.updateProjectionMatrix();
    const tilt = clamp((phi - 0.2) / 0.7, 0, 1);
    finalPass.uniforms.uHazeAmt.value = fogBase.haze * tilt * tilt;
    finalPass.uniforms.uBlur.value = (host.clientWidth < 500 ? 0.55 : 1) * (0.2 + 0.8 * tilt) * clamp((r - 120) / 900, 0.15, 1);
    sky.mesh.position.copy(camera.position); sky.mesh.scale.setScalar(camera.far * 0.004);
    U.uDetail.value = 1;
    // cutaway toward the user's tower: today's lot on the Today hero and the focus screen, the picked lot anywhere
    const cl = home ? (picked >= 0 ? home.lotOfSlot(picked) : block ? home.todayLot() : null) : null;
    if (cl && curR() < 900) { const tm = Math.max(lotTopM(cl), 18); U.uCut.value.set(cl.x, cl.g.position.y + tm * 0.42, cl.z, 1); U.uCutR.value = clamp(tm * 0.85, 16, 46); }
    else U.uCut.value.w = 0;
  }

  /* ------------------------------------------------------------ render on demand */
  let raf = 0, last = 0, lastDraw = 0, visible = true, paused = false, activeUntil = performance.now() + ACTIVE_MS, quietUntil = 0, tilesDirty = true, firstFrame = 0;
  const wake = () => { activeUntil = performance.now() + ACTIVE_MS; invalidate(); };
  const canRun = () => visible && !document.hidden && !paused;
  function invalidate() { if (!raf && canRun()) raf = requestAnimationFrame(frame); }
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  renderer.info.autoReset = false;
  function render() {
    viewUniforms();
    renderer.info.reset();
    composer.render();
  }
  function frame(t) {
    raf = 0;
    if (capturing) return;
    const dt = Math.min((t - last) / 1000 || 0.016, 0.05); last = t;
    const now = performance.now() / 1000;
    let moving = false;
    if (camAnim) { stepAnim(performance.now()); moving = true; }
    else {
      // eased wheel zoom toward the point under the cursor
      if (zoomGoal != null) {
        const r = curR(), nr = r + (zoomGoal - r) * (motion ? 1 - Math.exp(-dt * 11) : 1);
        if (zoomTgt) { const k = 1 - nr / r; const dx = (zoomTgt.x - target.x) * k, dz = (zoomTgt.z - target.z) * k; target.x += dx; target.z += dz; camera.position.x += dx; camera.position.z += dz; }
        off.copy(camera.position).sub(target).setLength(nr); camera.position.copy(target).add(off);
        if (Math.abs(nr - zoomGoal) < 0.5 + zoomGoal * 0.002) { zoomGoal = null; zoomTgt = null; }
        moving = true;
      }
    }
    // the focus screen keeps the scene gently alive (about 20 fps) while a block runs
    const live = motion && (liveForced || (cons && cons.on));
    if (live && t + 1500 > activeUntil) activeUntil = t + 3000;
    if (live !== liveMode) { liveMode = live; if (touch) resize(); }
    const idle = motion && t < activeUntil && t > quietUntil;
    if (idle) {
      clock += dt; U.uTime.value = clock;
      if (block) {
        // sway gently inside the allowed arc around the framing
        controls.autoRotate = !camAnim; const rel = wrapA(controls.getAzimuthalAngle() - az0), lim = azHalf - 0.06;
        if (rel > lim) dirSign = -1; else if (rel < -lim) dirSign = 1;
        controls.autoRotateSpeed = (kind === 'cam' ? 0.2 : 0.5) * dirSign;
      } else { controls.autoRotate = !userCam; controls.autoRotateSpeed = 0.18; }
    } else controls.autoRotate = false;
    if (block) { weather.setBase(target.y); if (weather.update(dt, clock, motion)) { setTime(lastHour); moving = true; } if (flow && flow.update(dt, now, motion)) moving = true; if (seasonal && seasonal.update(clock, motion, cur)) moving = idle || moving; if (cons && cons.update(dt, now, motion)) moving = true; if (cons && cons.on !== consWas) consWas = cons.on; }
    else { weather.setBase(target.y); if (weather.update(dt, clock, motion)) { setTime(lastHour); moving = true; } if (flow && flow.update(dt, now, motion)) moving = true; if (seasonal && seasonal.update(clock, motion, cur)) moving = idle || moving; }
    if (home && home.step(dt, now, clock)) moving = true;
    let walker = false;
    if (figure) { figure.setSelf(0.16 + 0.3 * (U.uGlow.value || 0)); walker = figure.update(dt, now, motion, camera); if (figure.state !== chrWas) { chrWas = figure.state; placeHome(); } }
    if (dream && dream.step(dt, now)) moving = true;
    if (lmLights && motion && lmLights.glow.count) { lmLayout(now); moving = moving || idle; }
    if (maskT0) { const k = motion ? clamp((performance.now() - maskT0) / 1300, 0, 1) : 1; U.uMaskMix.value = maskFrom + (maskTo - maskFrom) * eio(k); if (k >= 1) maskT0 = 0; moving = true; }
    if (!camAnim) controls.update(dt);
    if (clampTarget()) moving = true;
    if (clampAz()) moving = true;
    if (clampCam()) moving = true;
    if (tiles && (tilesDirty || lastCam.distanceToSquared(camera.position) > 4 || tiles.busy)) {
      camera.updateMatrixWorld(); viewUniforms();
      const st = tiles.update(camera); tilesDirty = false; lastCam.copy(camera.position);
      updateProps();
      if (!timing.full && st.idle && st.loaded > 0) { timing.full = performance.now() - T0; }
    }
    if (moving || !idle || !block || t - lastDraw > (live ? 38 : 33) || camAnim) { render(); lastDraw = t; }
    if (!firstFrame && ready) { firstFrame = performance.now(); timing.firstFrame = firstFrame - T0; }
    if (moving || idle || (tiles && tiles.busy)) invalidate();
    else if (walker && !charTimer) charTimer = setTimeout(() => { charTimer = 0; invalidate(); }, 90);     // the walk home: about 11 fps, only while it is on screen
  }
  function updateProps() {
    if (!tiles) return;
    const cp = camera.position;
    if (treeSet) for (const g of treeSet.groups) g.mesh.visible = g.box.distanceToPoint(cp) < P.treeDist;
    for (const t of tiles.T) { const rp = roofProps.get(t.x + ',' + t.z); if (rp) rp.grp.visible = t.shown === 0 && t.vis && t.dist < 1600 * P.bias; }
  }

  controls.addEventListener('start', () => { cancelCam(); userCam = true; markUsed(); if (!block) showCaption(''); quietUntil = performance.now() + 6000; activeUntil = Math.max(activeUntil, quietUntil + 400); invalidate(); });
  controls.addEventListener('change', () => { tilesDirty = true; invalidate(); });
  controls.addEventListener('end', () => { quietUntil = performance.now() + 6000; setTimeout(wake, 6100); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); wake(); } });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(host);
  host.addEventListener('pointerenter', wake);
  function markUsed() { if (hintDone) return; hintDone = true; host.classList.add('is-explored'); try { localStorage.setItem('epoch.city360', '1'); } catch { /* private mode */ } }
  try { if (localStorage.getItem('epoch.city360') === '1') { hintDone = true; host.classList.add('is-explored'); } } catch { /* private mode */ }

  // wheel / trackpad: zoom toward the cursor. A page scroll passing over the stage keeps scrolling the page.
  {
    let hoverSince = 0, lastScroll = 0, engaged = false;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hp = new THREE.Vector3();
    host.addEventListener('pointerenter', () => { hoverSince = performance.now(); });
    host.addEventListener('pointerleave', () => { engaged = false; });
    renderer.domElement.addEventListener('pointerdown', () => { engaged = true; });
    addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true, capture: true });
    host.addEventListener('wheel', (e) => {
      if (e.target !== renderer.domElement) return;
      e.stopPropagation();
      const now = performance.now();
      if (!(engaged || e.ctrlKey || (now - hoverSince > 450 && now - lastScroll > 650))) return;
      e.preventDefault();
      const dy = clamp(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY, -240, 240);
      camAnim = null; zeroControls(); userCam = true; markUsed();
      const r0 = zoomGoal ?? curR(), nr = clamp(r0 * Math.exp(dy * (e.ctrlKey ? 0.011 : 0.0017)), MIN_R, MAX_R);
      const rc = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera);
      plane.constant = -target.y;
      if (nr < r0 && ray.ray.intersectPlane(plane, hp) && hp.distanceTo(target) < curR() * 3) zoomTgt = hp.clone(); else zoomTgt = null;
      zoomGoal = nr;
      quietUntil = now + 6000; wake();
    }, { capture: true, passive: false });
    host.querySelectorAll('[data-city-view]').forEach((b) => b.addEventListener('click', () => view(b.dataset.cityView)));
    host.querySelectorAll('[data-city-fly]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.cityFly)));
  }
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); host.classList.add('no-webgl'); upgradeFallback(host); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { host.classList.remove('no-webgl'); invalidate(); });
  mqReduce.addEventListener?.('change', () => setMotion(!mqReduce.matches));

  /* ------------------------------------------------------------ picking */
  {
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) { down = null; return; }
      down = null; if (!home) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
      const li = home.pickRay(ray.ray), hd = homeHit(ray.ray);
      if (hd != null && (li < 0 || hd < lotHitDist(li, ray.ray))) { requestRoom(); return; }
      pick(li);
    });
  }
  /* ---- the user's home (economy): a vertical cylinder round the real building for taps, a small light over it */
  const hitV = new THREE.Vector3();
  function homeHit(r) {
    if (!homePick) return null;
    const { x, z, rad, y0, y1 } = homePick, ox = r.origin.x - x, oz = r.origin.z - z, dx = r.direction.x, dz = r.direction.z;
    const a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - rad * rad, disc = b * b - 4 * a * c;
    if (a < 1e-9 || disc < 0) return null;
    for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) { if (t < 0) continue; r.at(t, hitV); if (hitV.y >= y0 - 2 && hitV.y <= y1 + 4) return t; }
    if (c < 0 && r.origin.y > y1 && r.direction.y < 0) { const t = (y1 - r.origin.y) / r.direction.y; r.at(t, hitV); if (Math.hypot(hitV.x - x, hitV.z - z) < rad) return t; }
    return null;
  }
  function lotHitDist(i, r) { const l = home.lotOfSlot(i); return l ? r.origin.distanceTo(new THREE.Vector3(l.x, l.g.position.y, l.z)) : Infinity; }
  function placeHome() {
    if (!econ || !econ.home || !TR) return;
    const h = econ.home, y0 = +h.base_y || TR.ground(h.x, h.z), y1 = y0 + (+h.height_m || 20);
    homePick = { x: +h.x, z: +h.z, rad: (+h.height_m || 0) > 150 ? 24 : 15, y0, y1, bin: h.bin };
    if (!homeGlow) { homeGlow = makeGlow(2); world.add(homeGlow.points); homeGlow.setPx(pxNowV); }
    const asleep = figure && figure.state === 'asleep', wy = Math.min(y1 - 2, y0 + (+h.floor || 3) * 3.2 + 1.6);
    homeGlow.clear();
    // a warm lamp at the home's floor (moon-blue while you are asleep there), a small one on the roof so the home is easy to find and tap
    const c = asleep ? [0.7, 0.95, 1.7] : [1.4, 1.05, 0.6];
    homeGlow.add(h.x, wy, h.z, c[0], c[1], c[2], asleep ? 22 : 14);
    homeGlow.add(h.x, y1 + 6, h.z, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 30);
    homeGlow.commit();
  }
  let roomP = null;
  function requestRoom() {
    try { if (window.Witness && typeof window.Witness.openRoom === 'function') { window.Witness.openRoom(); return; } } catch { /* fall through */ }
    openRoom({});
  }
  /** the cutaway room of the user's home (room.js), its window rendered from this scene */
  function openRoom(o = {}) {
    if (!roomP) roomP = import('./room.js');
    return roomP.then((m) => m.openRoom({ econ: o.econ || econ, fetchEconomy: o.fetchEconomy, viewFrom, homeView, motion, hour: lastHour, onClose: () => { wake(); } }));
  }
  /** where the home's window looks: from the real building at its real floor, toward the view it is known for (or the most open side) */
  function homeView(h) {
    h = h || (econ && econ.home); if (!h || !TR) return null;
    const x = +h.x, z = +h.z, eye = (+h.base_y || TR.ground(x, z)) + (+h.floor || 3) * 3.2 + 1.5;
    const nb = (id) => D && D.notables.notables.find((n) => n.id === id);
    const cp = places.centralpark ? places.centralpark.t : null;
    const at = (id) => { const n = nb(id); return n ? [n.x, n.z] : null; };
    const PREFER = { 'brow-penthouse': [cp, 'Central Park'], 'cpw-parkview': [cp, 'Central Park'], 'ues-parkavenue': [cp, 'Central Park'], 'fidi-harbor': [at('statue-of-liberty'), 'the harbour'],
      'heights-riverside': [at('gwb'), 'the George Washington Bridge'], 'midtown-highrise': [at('empire-state'), 'the Empire State Building'] }[h.id] || [null, null];
    const prefer = PREFER[0], toward = PREFER[0] ? PREFER[1] : null;
    let dir = null;
    if (prefer) { const dx = prefer[0] - x, dz = prefer[1] - z, L = Math.hypot(dx, dz) || 1; dir = [dx / L, dz / L]; }
    else {
      // the most open side: the longest run of street-level air at the window's height
      let best = -1;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a); let d = 0, out = false, free = 0;
        for (d = 2; d < 900; d += 8) { const r = roofAt(x + ux * d, z + uz * d, 3); if (!out) { if (r < eye || d > 60) out = true; continue; } if (r > eye) break; free = d; }
        if (free > best + 1) { best = free; dir = [ux, uz]; }
      }
    }
    if (!dir) dir = [0, -1];
    // step out of the building to its facade on that side
    let d = 0; for (; d < 80; d += 2) if (roofAt(x + dir[0] * d, z + dir[1] * d, 2) < eye - 1) break;
    const px = x + dir[0] * (d + 1.5), pz = z + dir[1] * (d + 1.5);
    const far = prefer ? Math.min(Math.hypot(prefer[0] - x, prefer[1] - z), 4000) : 500;
    const ly = prefer ? Math.max(TR.ground(px + dir[0] * far, pz + dir[1] * far), eye - far * (eye > 150 ? 0.16 : 0.06)) : eye - 25;
    return { pos: [px, eye, pz], look: [px + dir[0] * far, ly, pz + dir[1] * far], toward };
  }
  /** render this scene from any point into a canvas (the room's window). Streams the tiles for that view first, up to `wait` ms. */
  async function viewFrom(o = {}) {
    for (let i = 0; i < 80 && !ready; i++) await new Promise((r) => setTimeout(r, 100));
    if (!ready) return null;
    const v = o.pos ? o : homeView(o.home); if (!v) return null;
    const w = clamp(Math.round(o.width) || 1024, 64, 2048), h = clamp(Math.round(o.height) || 640, 64, 2048);
    const sv = { pos: camera.position.clone(), tgt: target.clone(), asp: camera.aspect, fov: camera.fov, lift, hour: lastHour };
    let c2 = null;
    capturing = true; if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try {
      home?.hideUi(true); if (figure) figure.group.visible = false;
      if (o.hour != null && Math.abs(o.hour - lastHour) > 1e-6) setTime(+o.hour);              // the room asks for its own hour (debug ?tod=): window and room light agree
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); composer.setPixelRatio(1); composer.setSize(w, h);
      bloom.resolution.set(w * 0.5, h * 0.5); finalPass.uniforms.uTexel.value.set(1 / w, 1 / h);
      camera.aspect = w / h; camera.fov = o.fov || 50; camera.updateProjectionMatrix();
      target.set(v.look[0], v.look[1], v.look[2]); camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
      // the orbit maths read the distance to the target: keep it moderate so the near plane and the fog suit a window
      const dir = new THREE.Vector3().subVectors(target, camera.position).normalize();
      target.copy(camera.position).addScaledVector(dir, 600); camera.lookAt(target);
      const t0 = performance.now();
      do { camera.updateMatrixWorld(); viewUniforms(); tiles?.update(camera); updateProps(); await new Promise((r) => setTimeout(r, 120)); }
      while (tiles && tiles.busy && performance.now() - t0 < (o.wait ?? 2600));
      camera.updateMatrixWorld(); viewUniforms(); U.uCut.value.w = 0; camera.near = Math.max(camera.near, 3); camera.updateProjectionMatrix();
      if (o.noTrees && treeSet) for (const g of treeSet.groups) g.mesh.visible = false;          // the low-poly trees read as green pyramids from an eye-level window (room2 inside view)
      renderer.info.reset(); composer.render();
      c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(renderer.domElement, 0, 0);
    } catch (e) { console.warn('window view', e); c2 = null; }
    finally {
      home?.hideUi(false);
      if (Math.abs(sv.hour - lastHour) > 1e-6) setTime(sv.hour);
      camera.position.copy(sv.pos); target.copy(sv.tgt); camera.aspect = sv.asp; camera.fov = sv.fov; lift = sv.lift; camera.lookAt(target); camera.updateProjectionMatrix();
      capturing = false; resize(); tilesDirty = true; wake();
    }
    return c2;
  }

  let preView = null;
  function pick(i) {
    if (!home) return;
    const lot = i >= 0 ? home.lotOfSlot(i) : null;
    picked = lot ? i : -1; home.setPicked(picked);
    if (lot) {
      if (!preView) preView = { t: target.clone(), r: curR() };
      const top = lot.g.position.y + Math.max(lot.topY * lot.gr * lot.sv, 8);
      animateView({ target: new THREE.Vector3(lot.x, top * 0.5 + lot.g.position.y * 0.5, lot.z), r: block && bf ? clamp(bf.r * 0.72, 40, 500) : clamp(curR(), 140, 320), lift: top * 0.4 }, 1100);
    } else if (preView) { if (block && bf) animateView({ target: bf.target, r: bf.r, lift: bf.lift }, 1100); else animateView({ target: preView.t, r: preView.r }, 1100); preView = null; }
    opts.onPick?.(picked); wake();
  }

  /* ------------------------------------------------------------ API helpers */
  function view(cmd) {
    if (block) return false;
    if (cmd === 'top') animateView({ phi: TOP_PHI, r: Math.max(curR() * 1.2, 900) });
    else if (cmd === 'rotate') { sph.setFromVector3(off.copy(camera.position).sub(target)); animateView({ theta: sph.theta + Math.PI / 2, spin: true }); }
    else if (cmd === 'reset') { if (picked >= 0) { picked = -1; home?.setPicked(-1); opts.onPick?.(-1); } preView = null; pressed('home'); setView(place('home'), 1400); }
    else if (places[cmd] || cmd === 'dream') flyTo(cmd);
    else return false;
    userCam = true; markUsed();
    return true;
  }
  // one line under the chips: where you are, and for Home the copy the game sends (still in the clouds / the park in the window)
  function showCaption(name) {
    const el = host.querySelector('[data-js="city-caption"]'); if (!el) return;
    let text = '';
    if (name === 'dream' && dreamState) { const c = dreamState.copy || {}, narrow = host.clientWidth < 520; text = dream && dream.lit ? [c.unlocked, narrow ? '' : c.unlockedSub].filter(Boolean).join(' ') : [c.locked, narrow ? '' : c.lockedSub].filter(Boolean).join(' '); }   // phones: the headline only, the view is the point
    el.textContent = text; el.hidden = !text;
  }
  function pressed(name) { host.querySelectorAll('[data-city-fly]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cityFly === name))); }
  function dreamView() {
    // lit: just outside the penthouse facade looking north over the park to Morningside. Locked: the corridor seen from the park, rising out of its mist.
    const p = dream && dream.lit ? dream.pose() : null;
    if (p) return p;
    const c = dream ? dream.region.centre : [0, 0];
    return { t: c, ty: 270, r: 1350, phi: 1.44, theta: AVE + Math.PI - 0.2, label: 'Dream home' };
  }
  function flyTo(name, o = {}) {
    if (block) return false;
    const v = name === 'dream' ? dreamView() : place(name); if (!v) return false;
    pressed(name); showCaption(name);
    if (picked >= 0) { picked = -1; home?.setPicked(-1); opts.onPick?.(-1); preView = null; }
    userCam = true; markUsed();
    setView(v, o.instant ? 0 : undefined); return true;
  }
  function setUnlockedDistricts(ids) {
    if (!D || !mask) { pendingDistricts = ids; return; }
    let lit = 'all';
    if (ids && ids !== 'all') {
      const want = (Array.isArray(ids) ? ids : [ids]).map(String);
      lit = new Set(D.nta.neighborhoods.filter((n) => want.some((w) => n.code === w || n.code.startsWith(w))).map((n) => n.code));
      if (want.includes('BROW')) lit.add('BROW');                // Billionaires' Row: its own corridor, never lit by the NTAs around it
    }
    litNow = lit;
    const which = mask.set(lit);
    U.uMask.value = mask.texA; U.uMask2.value = mask.texB; U.uLockOn.value = 1;
    maskFrom = U.uMaskMix.value; maskTo = which; maskT0 = performance.now(); wake();
    return lit === 'all' ? 'all' : [...lit];
  }
  let pendingDistricts = null, litNow = 'all';
  /** the dream home: {bin, lit, name, copy:{locked, lockedSub, unlocked, unlockedSub}} from /api/world districts.dream_home */
  function setDreamHome(d = {}) {
    dreamState = { ...(dreamState || {}), ...d, copy: { ...((dreamState && dreamState.copy) || {}), ...(d.copy || {}) } };
    if (!dream) return false;
    if (d.bin != null && d.bin !== dream.bin) dream.setBin(d.bin);
    if (d.lit != null) dream.setLit(!!d.lit, !ready);
    if (host.querySelector('[data-city-fly="dream"][aria-pressed="true"]')) showCaption('dream');
    return true;
  }

  /* ------------------------------------------------------------ loading */
  async function init() {
    const [manifest, land, parks, streets, nta, hydro, farshoreJ, notables, homeJ, terrainBuf, heightsBuf, treesBuf, homeBuf, browJ] = await Promise.all([
      getJSON('manifest.json'), getJSON('land.json'), getJSON('parks.json'), getJSON('streets.json'), getJSON('nta.json'), getJSON('hydro.json').catch(() => ({ lakes: [] })),
      getJSON('farshore.json').catch(() => ({ polys: [] })), getJSON('notables.json'), getJSON('home.json'), getBin('terrain.bin'), getBin('heights.bin').catch(() => null), getBin('trees.bin').catch(() => null), getBin('home/home_buildings.bin'),
      getJSON('brow.json').catch(() => null),
    ]);
    brow = browJ;
    timing.data = performance.now() - T0;
    // the borough boundary carries a few pier outlines along the Brooklyn shore; the city is Manhattan only, so they stay water
    land.polys = dropDetachedPiers(land.polys);
    D = { manifest, land, parks, streets, nta, hydro, farshore: farshoreJ, notables, home: homeJ };
    TR = makeTerrain(terrainBuf); if (heightsBuf) roofAt = makeHeights(heightsBuf);
    setShopFn(makeShopFn(streets));          // shopfront storeys along the avenues (read while the tiles decode)
    rows = buildRows(land);
    // places
    const nb = (id) => notables.notables.find((n) => n.id === id);
    const cp = parks.parks.filter((p) => /^Central Park/.test(p.n)).sort((a, b) => b.a - a.a)[0];
    const lb = land.bounds;
    // tiles first (the coarse island is ~1.6 MB), then everything that only paints
    tiles = createTileManager({ base: DATA, manifest, mat: bmat, parent: world, budget: P.budget, bias: P.bias, memBudget: P.mem,
      onChange: () => { tilesDirty = true; invalidate(); },
      onTile: (t, n, d) => {
        const k = t.x + ',' + t.z;
        if (n === 0) { const old = roofProps.get(k); if (old) { world.remove(old.grp); roofProps.delete(k); } if (d) { const rp = buildRoofProps(d, homeBins, U); rp.grp.visible = false; world.add(rp.grp); roofProps.set(k, rp); } }
        if (!timing.firstTile && d) timing.firstTile = performance.now() - T0;
      } });
    tiles.preloadCoarse();
    // home block: the real buildings of the year's lots (not in the tiles; kept hidden, the lots are pads and towers now)
    const hd = decodeTile(homeBuf); homeMeshes = buildingMeshes(hd, bmat); for (const [bin, m] of homeMeshes) { homeBins.add(bin); world.add(m); }
    const hv0 = homeWeekView(homeJ), centre = hv0.t;                      // my block = this week's row of lots (home.json v2, the year of lots)
    const low = nb('low-library'), esb = nb('empire-state'), chr = nb('chrysler'), wtc = nb('one-wtc');
    places = {
      home: { get t() { return home ? home.weekView().t : hv0.t; }, get r() { return home ? home.weekView().r : hv0.r; }, phi: 1.02, get theta() { return home ? home.weekView().theta : hv0.theta; }, label: 'My block' },
      columbia: { t: [low.x, low.z], r: 520, phi: 0.98, theta: AVE + 0.25, label: 'Columbia' },
      centralpark: { t: cp ? cp.c : [1300, -2600], r: 4300, phi: 0.66, theta: AVE + 0.08, label: 'Central Park' },
      midtown: { t: [(esb.x + chr.x) / 2 - 120, (esb.z + chr.z) / 2 + 150], ty: 60, r: 2300, phi: 1.16, theta: AVE - 0.42, label: 'Midtown' },
      timessquare: { t: [-60, 60], ty: 12, r: 560, phi: 1.13, theta: AVE + 0.05, label: 'Times Square' },
      downtown: { t: [wtc.x + 350, wtc.z + 420], ty: 60, r: 2700, phi: 1.12, theta: AVE + 0.25, label: 'Downtown' },
      // the long axis across the frame, seen from over the East River (Inwood on the right): the whole 21 km fits a laptop stage
      island: { t: [(lb[0] + lb[2]) / 2 + 840, (lb[1] + lb[3]) / 2 - 50], r: 16000, phi: 0.8, theta: AVE + Math.PI / 2 + 0.01, label: 'Whole island' },
    };
    // first view: the user's block
    if (!userCam) setView(places.home, 0);
    // ground
    F = makeFrame(land, P.mpp, P.maxPx);
    const treeData = treesBuf ? decodeTrees(treesBuf) : null;
    // home ring etc.
    home = createHome({ scene: world, home: homeJ, streets, TR, homeMeshes, wake, motion, onlyDays: block, camera });
    const pg = paintGround(F, D, { trees: treeData, home: home.slotLots.map((l) => l.L) });
    timing.paintMs = pg.ms;
    mask = createMask(F, nta, brow);
    U.uMaskXf.value.copy(F.xf); U.uMask.value = mask.texA; U.uMask2.value = mask.texB;
    const gmat = createGroundMaterial(pg.tex, pg.aux, U);
    const gm = buildGroundMesh(F, TR, gmat, P.step); world.add(gm.mesh);
    const edge = buildEdge(land, TR, U); world.add(edge.mesh);
    water = createWater(pg.aux, U, [(lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2]); world.add(water);
    farshore = buildFarShore(farshoreJ); world.add(farshore.grp);
    lamps = createLamps(streets, TR, U); world.add(lamps.mesh);
    if (treeData) { treeSet = createTrees(treeData, U); for (const g of treeSet.groups) world.add(g.mesh); }
    bridges = buildBridges(D, TR, U); world.add(bridges.mesh, bridges.web, bridges.bbLights, bridges.otherLights);
    if (brow) {
      dream = createDream({ scene: world, brow, TR, home: centre, park: cp ? cp.c : null, wake }); dream.setMotion(motion);
      dream.setBin(dreamState && dreamState.bin != null ? dreamState.bin : 0); dream.setLit(!!(dreamState && dreamState.lit), true); dream.setTone(scene.fog.color, clamp(cur.day, 0, 1));
    }
    lmLights = createLandmarkLights({ notables, TR }); world.add(lmLights.glow.points);
    // live layers on the real city: the flow avenue, seasonal props, the construction cam
    {
      const hc = home.centre, sites = lampSites(streets, hc[0], hc[1]);
      flow = createFlow({ scene: world, shared: home.shared, radial, sites, TR });
      const south = [-SA, CA], plz = [low.x + south[0] * 55, low.z + south[1] * 55], tsqB = notables.notables.find((n) => n.bin === 1085682);
      seasonal = createSeasonal({ scene: world, shared: home.shared, home, radial, target, plaza: { x: plz[0], z: plz[1], y: TR.ground(plz[0], plz[1]) }, ball: tsqB ? { x: tsqB.x, z: tsqB.z, y: (tsqB.baseY || 10) + tsqB.heightM } : null, TR, tablet: light });
      seasonal.setFrame({ c: [hc[0] - CA * 650, hc[1] - SA * 650], y: TR.ground(hc[0], hc[1]), right: [SA, -CA], fwd: [CA, SA], s: 22 });       // the free city: bursts over the Hudson beside the block
      const ad = new Map();
      const today = () => { const l = home.todayLot(); if (!l) return null; let a = ad.get(l); if (!a) { a = { lot: l, i: l.k, x: 0, z: 0, get kind() { return l.kind; }, get F() { return l.F; }, get sig() { return l.sig; }, get topY() { return l.topY; }, get roofY() { return l.roofY ?? l.topY; }, get g() { return l.gr; }, get roof() { return l.roof; } }; ad.set(l, a); } return a; };
      cons = createConstruction({ scene: world, shared: home.shared, getToday: today, radial, setPool: () => {}, wake, place: (root, a) => { a.lot.g.add(root); root.position.set(0, 0, 0); } });
      figure = createCharacter({ scene: world, TR, kind, home, roofAt, butler: nb('butler-library'), low, trees: treeData, wake });
    }
    D.stats = { groundTris: gm.tris, edgeTris: edge.tris, lamps: lamps.count, trees: treeData ? treeData.n : 0, bridgeTris: bridges.tris, tex: [pg.canvas.width, pg.canvas.height], mpp: F.mpp };
    ready = true; timing.ready = performance.now() - T0;
    setTime(opts.hourFixed ?? hourFn()); resize();
    if (pendingDays) { home.setDays(...pendingDays); pendingDays = null; cons.onLots(); }
    if (pendingFlow) { flow.set(pendingFlow, performance.now() / 1000); pendingFlow = null; }
    if (pendingSeasonal) { seasonal.set(pendingSeasonal); pendingSeasonal = null; }
    if (pendingCons) { cons.set(pendingCons); figure?.setConstruction(pendingCons); pendingCons = null; }
    if (pendingEcon) { const pe = pendingEcon; pendingEcon = null; setEconomy(pe); }
    if (block) { if (kind === 'cam' && !camDone && home.todayLot()) camDone = true, focusOn = true; if (pendingFocus) { const pf = pendingFocus; pendingFocus = null; focusOn = !!pf[0]; focusOpts = pf[1] || {}; } reframe(0); }
    if (pendingLm) { setLandmarks(...pendingLm); pendingLm = null; }
    if (dreamState) showCaption(host.querySelector('[data-city-fly="dream"][aria-pressed="true"]') ? 'dream' : '');
    if (pendingDistricts) { setUnlockedDistricts(pendingDistricts); pendingDistricts = null; }
    else if (qs.get('city-districts') === 'demo') setUnlockedDistricts(['MN09', 'MN07', 'MN6491', 'MN1002', 'MN1001']);
    setAttribution();
    host.classList.remove('is-loading');
    tilesDirty = true; wake();
  }
  function setAttribution() {
    let el = host.querySelector('[data-js="city-attrib"]');
    if (!el && block) { el = document.createElement('p'); el.className = 'stage__attrib'; el.dataset.js = 'city-attrib'; host.append(el); }
    if (el && D?.manifest?.attributionShort) el.textContent = D.manifest.attributionShort + ', 2015 Street Tree Census, Planimetric Hydrography';
  }
  init().catch((e) => { console.warn('Manhattan data', e); host.classList.add('no-webgl'); host.classList.remove('is-loading'); upgradeFallback(host); });

  /* ------------------------------------------------------------ resize */
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const dpr = dprCap();
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr); composer.setSize(w, h);
    bloom.resolution.set(w * dpr * P.bloomRes, h * dpr * P.bloomRes);
    finalPass.uniforms.uTexel.value.set(1 / (w * dpr), 1 / (h * dpr));
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const px = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    if (lamps) lamps.mat.uniforms.uPx.value = px;
    if (bridges) { bridges.bbLights.material.uniforms.uPx.value = px; bridges.otherLights.material.uniforms.uPx.value = px; }
    home?.setPx(px); homeGlow?.setPx(px); figure?.setPx(px); dream?.setPx(px); lmLights?.glow.setPx(px); weather.setPx(px); seasonal?.setPx(px); pxNowV = px;
    if (block && frameOn) reframe(0);
    tilesDirty = true; invalidate();
  }
  let pxNowV = 600;
  new ResizeObserver(resize).observe(host);

  /* ------------------------------------------------------------ API */
  function setLandmarks(list, { animate = true } = {}) {
    if (!ready) { pendingLm = [list, { animate }]; return; }
    for (const l of list || []) {
      const i = LADDERS.indexOf(l.ladder); if (i < 0) continue;
      const lvl = clamp((l.sections | 0) / 5, 0, 1), prev = U.uLmLvl.value[i];
      U.uLmLvl.value[i] = lvl; U.uLmCol.value[i].set(LADDER_HEX[l.ladder]);
      lmLights?.set(l.ladder, { bin: l.bin !== undefined ? l.bin : DEFAULT_BIN[l.ladder], sections: l.sections | 0, color: '#' + LADDER_HEX[l.ladder].toString(16).padStart(6, '0') });
      if (animate && motion && lvl > prev) flash(i);
    }
    if (bridges) bridges.bbLights.material.uniforms.uK.value = 0.35 + 0.9 * U.uLmLvl.value[0];
    lmLayout(performance.now() / 1000);
    wake();
  }
  function lmLayout(now) {
    if (!lmLights) return;
    const pulse = {}; LADDERS.forEach((n, i) => { pulse[n] = U.uLmFlash.value[i]; });
    lmLights.layout(pulse, now, motion);
  }
  /* live layers (the same API as the diorama's city.js, see DOM_CONTRACT.md) */
  let focusLotK = -1;
  /** Construction cam. {active, phase:'work'|'break'|'topout', progress 0..1, floors | minutes, remaining, duration (seconds)} */
  function setConstruction(st) { if (!cons) { pendingCons = st; return; } cons.set(st); figure?.setConstruction(st); if (cons.on !== consWas) { consWas = cons.on; if (focusOn && home?.todayLot()) reframe(900); } wake(); }
  function toppingOut() { cons?.toppingOut(); wake(); }
  /** Frame today's lot close up with the crane (the focus screen). on=false goes back to the week framing. */
  function focusConstruction(on = true, o = {}) {
    if (!block) return false;
    if (!on) { focusOn = false; pendingFocus = null; reframe(1000); return true; }
    if (!home || !home.todayLot()) { pendingFocus = [on, o]; return false; }
    pendingFocus = null; focusOn = true; focusOpts = o; focusLotK = home.todayLot().k; quietUntil = 0; reframe(1100); return true;
  }
  /** keep the scene gently animating (about 20 fps) even without interaction; the focus screen turns this on */
  function setLive(on) { liveForced = !!on; wake(); }
  function setSeasonal(keys) { if (!seasonal) { pendingSeasonal = keys; return []; } const r = seasonal.set(keys); seasonal.setPx(pxNowV); wake(); return r; }
  /** flow meter: {hours_lit, minutes?, to_next_hour_min?, active?} */
  function setFlow(f) { if (!flow) { pendingFlow = f; return; } flow.set(f, performance.now() / 1000); wake(); }
  /** the economy block of /api/world: {home, placed, outfit, upgrades, gold_days, character, focus, ...} (docs/ECONOMY.md) */
  function setEconomy(e) {
    if (!e || typeof e !== 'object') return;
    if (!ready || !home) { pendingEcon = e; return; }
    econ = e;
    home.setUpgrades(e.upgrades || []); home.setGold(e.gold_days || []);
    figure?.setEconomy(e);
    placeHome(); wake();
  }
  const flashes = [0, 0, 0, 0, 0];
  function flash(i) {
    flashes[i] = performance.now();
    const tick = () => { const k = clamp((performance.now() - flashes[i]) / 1600, 0, 1); U.uLmFlash.value[i] = (1 - k) * (1 - k); if (i === 0 && bridges) bridges.bbLights.material.uniforms.uK.value = 0.35 + 0.9 * U.uLmLvl.value[0] + 2 * (1 - k); lmLayout(performance.now() / 1000); invalidate(); if (k < 1) requestAnimationFrame(tick); };
    tick();
  }
  function setMotion(on) { motion = !!on; home?.setMotion(motion); dream?.setMotion(motion); if (water) water.material.uniforms.uMotion.value = motion ? 1 : 0; wake(); }
  function setWeather(w) { weather.set(w); setTime(lastHour); wake(); return weather.info; }
  function snapshot(o) {
    if (!o) { render(); return renderer.domElement.toDataURL('image/png'); }
    const w = clamp(Math.round(o.width) || 1200, 64, 4096), h = clamp(Math.round(o.height) || 800, 64, 4096);
    const sv = { pos: camera.position.clone(), tgt: target.clone(), asp: camera.aspect, hour: lastHour };
    let c2;
    try {
      home?.hideUi(true);
      if (o.hour != null) setTime(+o.hour);
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); composer.setPixelRatio(1); composer.setSize(w, h);
      finalPass.uniforms.uTexel.value.set(1 / w, 1 / h); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (o.view !== 'current') {
        const f = block ? computeFrame(w / h) : null;
        if (f) { target.copy(f.target); camera.position.setFromSphericalCoords(f.r, f.phi, f.theta).add(target); }
        else { const v = place('home'); target.set(v.t[0], TR ? TR.ground(v.t[0], v.t[1]) : 0, v.t[1]); camera.position.setFromSphericalCoords(v.r, v.phi, v.theta).add(target); }
        camera.lookAt(target);
      }
      camera.updateMatrixWorld(); if (tiles) tiles.update(camera); render();
      c2 = document.createElement('canvas'); c2.width = w; c2.height = h; c2.getContext('2d').drawImage(renderer.domElement, 0, 0);
    } finally {
      home?.hideUi(false);
      camera.position.copy(sv.pos); target.copy(sv.tgt); camera.aspect = sv.asp; camera.lookAt(target);
      if (o.hour != null) setTime(sv.hour);
      resize(); wake();
    }
    return new Promise((res, rej) => c2.toBlob((b) => (b ? res(b) : rej(new Error('snapshot failed'))), o.type || 'image/png', o.quality));
  }
  function camState() { sph.setFromVector3(off.copy(camera.position).sub(target)); return { az: sph.theta, polar: sph.phi, r: sph.radius, y: camera.position.y, t: [target.x, target.z], anim: !!camAnim }; }
  function setCam(v = {}) {
    cancelCam(); zeroControls(); userCam = true; if (!block) showCaption('');
    const c = camState();
    if (v.t) { target.set(v.t[0], TR ? TR.ground(v.t[0], v.t[1]) + (v.ty || 0) : 0, v.t[1]); lift = v.ty || 0; }
    camera.position.setFromSphericalCoords(clamp(v.r ?? c.r, MIN_R, MAX_R), clamp(v.polar ?? c.polar, TOP_PHI, MAX_PHI), v.az ?? c.az).add(target);
    camera.lookAt(target); controls.update(); for (let i = 0; i < 40 && clampCam(); i++);
    tilesDirty = true; wake(); return camState();
  }
  function debugState() {
    const st = tiles ? tiles.stats : {};
    const pm = performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576) } : null;
    return { profile: P.name, ready, timing: Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, Math.round(v)])), tiles: { ...st }, calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
      gpu: { ...renderer.info.memory }, heap: pm, stats: D?.stats, cam: camState(), hour: lastHour, glow: U.uGlow.value, motion };
  }
  const api = {
    setDays(days, o = {}) {
      if (!home) { pendingDays = [days, o]; return; }
      home.setDays(days, o); cons?.onLots();
      if (block) {
        if (kind === 'cam' && !camDone && home.todayLot()) { camDone = true; focusConstruction(true); }
        else if (pendingFocus) { const pf = pendingFocus; focusConstruction(pf[0], pf[1]); }
        else if (focusOn && home.todayLot() && home.todayLot().k !== focusLotK) focusConstruction(true, focusOpts);        // a new day: follow the new lot
        else reframe(frameOn ? 1100 : 0);
      }
    },
    setLandmarks, setTime: (h) => setTime(h), setHourFn: (fn) => { hourFn = fn; setTime(hourFn()); },
    pulse: (i) => home?.pulse(i),
    focusDay(i) {
      const l = home?.lotOfSlot(i); if (!l || focusOn) return;
      if (block && bf) { animateView({ target: new THREE.Vector3((l.x + bf.target.x) / 2, bf.target.y, (l.z + bf.target.z) / 2), r: bf.r * 0.86, lift: bf.lift }, 900); setTimeout(() => { if (picked < 0 && !focusOn) reframe(1200); }, 2400); }
      else animateView({ target: new THREE.Vector3(l.x, l.g.position.y + 20, l.z), r: clamp(curR(), 200, 700) });
    },
    nudgeLandmark(name) { const i = LADDERS.indexOf(name); if (i >= 0 && motion) flash(i); },
    craneAt: (i) => home?.craneAt(i), pick, setMotion,
    view, flyTo, places: () => [...Object.entries(places).map(([id, v]) => ({ id, label: v.label })), { id: 'dream', label: 'Dream home' }], setUnlockedDistricts, setDreamHome,
    dream: () => dream,
    districts: () => (D ? D.nta.neighborhoods.map((n) => ({ code: n.code, name: n.name })) : []),
    setCam, camState,
    pause: (p) => { paused = !!p; if (!paused) wake(); }, invalidate: wake,
    snapshot, setWeather, setSeasonal, setFlow, setConstruction, toppingOut, focusConstruction, setLive,
    setEconomy, openRoom, viewFrom, homeView, character: () => (figure ? { state: figure.state, visible: figure.group.visible, pos: figure.group.position.toArray(), scale: figure.group.scale.x, butler: figure.butlerSpot(), door: figure.homeDoor(), home: homePick } : null),
    debugState, renderNow: () => render(), renderer, scene,
    dbg: { camera, controls, U, tiles: () => tiles, home: () => home, D: () => D, P, bloom, finalPass, world, weather, flow: () => flow, seasonal: () => seasonal, cons: () => cons, frame: () => bf, kind, seen: (th, phi, r, tg, ls) => seen(th, phi, r, tg, ls), roofAt: (x, z, rr = 7) => roofAt(x, z, rr) },
    dispose() { cancelAnimationFrame(raf); controls.dispose(); composer.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
  camera.position.set(0, 3000, 6000); camera.lookAt(0, 0, 0);
  setTime(opts.hourFixed ?? hourFn()); resize();
  setInterval(() => { if (canRun()) setTime(hourFn()); }, 5 * 60 * 1000);
  setInterval(() => { if (cons && cons.on && !motion && canRun()) wake(); }, 20000);                // reduced motion: let the countdown move the building now and then
  setInterval(() => { if (figure && canRun()) { placeHome(); invalidate(); } }, 15000);   // one frame now and then: the walk home moves on (reduced motion), the routine changes with the clock
  try { if (qs.has('city-debug')) { (window.__city = window.__city || {})[block ? 'week' : 'city'] = api; } } catch { /* ignore */ }
  return api;
}

/** small (< 12 point) land pieces more than 200 m from the main island are piers on the far shore */
export function dropDetachedPiers(polys) {
  const main = polys.reduce((m, p) => (p[0].length > m[0].length ? p : m), polys[0])[0];
  return polys.filter((p) => {
    if (p[0].length >= 24) return true;
    let cx = 0, cz = 0; const n = p[0].length / 2; for (let i = 0; i < p[0].length; i += 2) { cx += p[0][i] / n; cz += p[0][i + 1] / n; }
    let d = Infinity; for (let i = 0; i < main.length; i += 2) d = Math.min(d, Math.hypot(main[i] - cx, main[i + 1] - cz));
    return d < 200;
  });
}

/* ------------------------------------------------------------ no WebGL: the 2-D map stays (inline it so the user's block reads) */
function upgradeFallback(host) {
  const box = host && host.querySelector('.fallback--map'); if (!box || box.dataset.inline) return;
  box.dataset.inline = '1';
}
