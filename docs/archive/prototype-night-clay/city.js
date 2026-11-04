// city.js · the toy-diorama New York. Procedural low-poly, no models, no textures.
// Data in -> towers out. Render on demand: zero frames are scheduled when nothing moves,
// the tab is hidden, or the canvas is off screen. One module, no build step.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const LADDER_HEX = { 'Python': 0x5aa9ff, 'Math': 0xa99bff, 'ML/DL': 0x46e0a0, 'Papers': 0xff8a6b, 'Writing/X': 0xf58ae0 };
const FLOOR_H = 0.4, MAXF = 16, PX = 1.7, PZ = 1.9, WCOLS = 2, WPT = MAXF * 4 * WCOLS;
const ACTIVE_MS = 25000;                       // gentle idle life after load / interaction / log, then freeze
const rng = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);

// sky keyframes by hour: [hour, top, horizon, sun, window glow, stars]
const SKY = [
  [0,  '#050818', '#1a1b4a', 0.05, 1.0, 1.0],
  [5,  '#1a1d52', '#5a4a8a', 0.15, 0.9, 0.7],
  [7,  '#4f7fd8', '#ffb677', 0.8,  0.3, 0.0],
  [12, '#3f8bf0', '#bfe3ff', 1.1,  0.0, 0.0],
  [17, '#4673c8', '#ffa24d', 0.8,  0.25, 0.0],
  [19, '#2b2466', '#c0527a', 0.25, 0.85, 0.4],
  [21, '#0b1030', '#2a2468', 0.05, 1.0, 1.0],
  [24, '#050818', '#1a1b4a', 0.05, 1.0, 1.0],
];
function skyAt(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0; while (SKY[i + 1][0] < h) i++;
  const a = SKY[i], b = SKY[i + 1], t = (h - a[0]) / (b[0] - a[0]);
  const c = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  return { top: c(a[1], b[1]), hor: c(a[2], b[2]), sun: a[3] + (b[3] - a[3]) * t, glow: a[4] + (b[4] - a[4]) * t, stars: a[5] + (b[5] - a[5]) * t };
}

const TIER = [0x4a5589, 0x5a63c8, 0xe3a24a];     // started / floor met / crown lit

/* ---------- landmark builders: 5 parts each (one per ladder node) ---------- */
function mix(hex, to, t) { return new THREE.Color(hex).lerp(new THREE.Color(to), t); }
function mk(geo, color, { line = false } = {}) {
  const solid = line ? new THREE.LineBasicMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true });
  const ghost = line ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 })
                     : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false });
  const o = line ? new THREE.LineSegments(geo, solid) : new THREE.Mesh(geo, solid);
  o.userData.solid = solid; o.userData.ghost = ghost; return o;
}
const box = (w, h, d, x, y, z, c) => { const m = mk(new THREE.BoxGeometry(w, h, d), c); m.position.set(x, y + h / 2, z); return m; };
function landmark(kind, hex) {
  const c = mix(hex, 0x8c90b8, 0.2), c2 = mix(hex, 0xffffff, 0.25), P = [];
  const g = (...kids) => { const grp = new THREE.Group(); kids.forEach((k) => grp.add(k)); return grp; };
  if (kind === 'bridge') {
    const cab = (sx) => { const pts = []; for (let k = 0; k <= 4; k++) { const dx = 0.1 + k * 0.25; pts.push(sx * 1.55, 3.0, 0, sx * (1.55 + dx), 1.02, 0, sx * 1.55, 3.0, 0, sx * (1.55 - dx), 1.02, 0); } return mk(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), c2, { line: true }); };
    P.push(box(0.34, 3.1, 0.34, -1.55, 0, 0, c), box(0.34, 3.1, 0.34, 1.55, 0, 0, c), box(5.2, 0.16, 0.6, 0, 0.9, 0, c2), cab(-1), cab(1));
  } else if (kind === 'tower') {      // brick institute tower (stepped)
    P.push(box(1.6, 1.0, 1.4, 0, 0, 0, c), box(1.35, 1.0, 1.2, 0, 1.0, 0, c), box(1.1, 0.9, 1.0, 0, 2.0, 0, c2), box(0.85, 0.8, 0.8, 0, 2.9, 0, c));
    const roof = mk(new THREE.ConeGeometry(0.65, 0.8, 4), c2); roof.rotation.y = Math.PI / 4; roof.position.set(0, 4.1, 0); P.push(roof);
  } else if (kind === 'spire') {      // Empire-State-like tiers + mast
    const mast = mk(new THREE.CylinderGeometry(0.03, 0.07, 1.5, 6), c2); mast.position.set(0, 4.85, 0);
    P.push(box(1.5, 1.2, 1.5, 0, 0, 0, c), box(1.2, 1.1, 1.2, 0, 1.2, 0, c), box(0.9, 1.0, 0.9, 0, 2.3, 0, c2), box(0.6, 0.8, 0.6, 0, 3.3, 0, c), mast);
  } else if (kind === 'dome') {       // domed library
    const cols = g(...[-0.9, -0.45, 0, 0.45, 0.9].map((x) => { const m = mk(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8), c2); m.position.set(x, 0.4, 0.75); return m; }));
    const dome = mk(new THREE.SphereGeometry(0.85, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), c2); dome.position.set(0, 1.35, 0);
    const lan = mk(new THREE.CylinderGeometry(0.1, 0.14, 0.4, 8), c); lan.position.set(0, 2.4, 0);
    P.push(box(2.3, 0.8, 1.6, 0, 0, 0, c), cols, box(2.45, 0.14, 1.75, 0, 0.8, 0, c2), dome, lan);
  } else {                            // billboard tower
    const bb = (y, rot) => { const m = mk(new THREE.PlaneGeometry(0.9, 0.55), c2); m.userData.solid = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.4), toneMapped: false, side: THREE.DoubleSide }); m.position.set(0, y, 0.52); const gp = g(m); gp.rotation.y = rot; return gp; };
    const crown = box(1.1, 0.16, 1.1, 0, 3.0, 0, c2); const tip = mk(new THREE.ConeGeometry(0.4, 0.7, 4), c); tip.position.set(0, 3.5, 0); tip.rotation.y = Math.PI / 4;
    P.push(box(1.0, 3.0, 1.0, 0, 0, 0, c), bb(0.9, 0), bb(1.7, Math.PI / 2), bb(2.4, Math.PI), g(crown, tip));
  }
  return P;
}
const KINDS = { 'Python': 'bridge', 'Math': 'tower', 'ML/DL': 'spire', 'Papers': 'dome', 'Writing/X': 'billboard' };

/* ---------- the scene ---------- */
export function createCity(host, opts = {}) {
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return null;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' }); } catch { return null; }

  const mode = opts.mode || 'week';
  const ROWS = mode === 'city' ? 4 : 1, COLS = 7, N = ROWS * COLS;
  let hourFn = opts.hour || (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  let motion = opts.motion !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dprCap = () => Math.min(devicePixelRatio, host.clientWidth * host.clientHeight > 1.4e6 ? 1.5 : 2);
  renderer.setPixelRatio(dprCap());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 26, 70);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 220);
  const baseTarget = mode === 'city' ? new THREE.Vector3(0, 1.4, -1.6) : new THREE.Vector3(0, 2.0, -0.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(baseTarget);
  camera.position.setFromSphericalCoords(14, mode === 'city' ? 1.0 : 1.2, mode === 'city' ? 0.5 : 0).add(baseTarget);
  renderer.domElement.style.touchAction = 'pan-y';
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false; controls.enableZoom = false;
  if (mode === 'city') { controls.minPolarAngle = 0.55; controls.maxPolarAngle = 1.42; }
  else { controls.minPolarAngle = 1.0; controls.maxPolarAngle = 1.38; controls.minAzimuthAngle = -0.6; controls.maxAzimuthAngle = 0.6; }
  const polar = mode === 'city' ? 1.0 : 1.2, azim = mode === 'city' ? 0.5 : 0; let dirSign = 1;
  function fit() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    const aspect = w / h, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const need = mode === 'city' ? 8.6 : 7.4;                      // half-width of world to keep in frame
    const r = mode === 'city' ? clamp(need / (t * aspect) * 1.15, 17, 30) : clamp(need / (t * aspect), 12.5, 24);
    const cur = camera.position.clone().sub(controls.target);
    if (cur.lengthSq() < 1e-6) cur.setFromSphericalCoords(r, polar, azim); else cur.setLength(r);
    camera.position.copy(controls.target).add(cur);
  }

  /* lights */
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x1a1a3e, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(-9, 16, 10); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9a8cff, 0.35); rim.position.set(10, 6, -8); scene.add(rim);

  /* sky gradient (a 2px-wide canvas texture, stretched) */
  const skyCv = document.createElement('canvas'); skyCv.width = 2; skyCv.height = 256;
  const skyCtx = skyCv.getContext('2d'); const skyTex = new THREE.CanvasTexture(skyCv); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }));
  scene.add(orb);
  const sp = new Float32Array(260 * 3), r0 = rng(7);
  for (let i = 0; i < 260; i++) { const a = r0() * 6.283, e = 0.2 + r0() * 1.0, R = 90; sp.set([Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R * 0.8 + 4, -Math.abs(Math.sin(a) * Math.cos(e) * R) - 20], i * 3); }
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0xffffff, transparent: true, fog: false }));
  scene.add(stars);
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false });
  for (let k = 0; k < 5; k++) {
    const grp = new THREE.Group();
    for (let j = 0; j < 4; j++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.8 + (j % 2) * 0.35, 10, 8), cloudMat); s.position.set(j * 0.9, (j % 2) * 0.25, 0); s.scale.y = 0.6; grp.add(s); }
    grp.position.set(-30 + k * 14, 12 + (k % 3) * 3.2, -28 - (k % 2) * 8); grp.userData.speed = 0.25 + (k % 3) * 0.08; clouds.push(grp); scene.add(grp);
  }

  /* ---------- diorama platform ---------- */
  const W = 14.2, D = mode === 'city' ? 17.5 : 8.4, zc = mode === 'city' ? -2.1 : -1.2;
  const plat = new THREE.Group(); scene.add(plat);
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.36, D), new THREE.MeshStandardMaterial({ color: 0x2c326e, roughness: 0.95 }));
  top.position.set(0, -0.19, zc); plat.add(top);
  const under = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.7, D - 0.5), new THREE.MeshStandardMaterial({ color: 0x151a45, roughness: 1 }));
  under.position.set(0, -0.72, zc); plat.add(under);
  const under2 = new THREE.Mesh(new THREE.BoxGeometry(W - 1.6, 0.6, D - 1.6), new THREE.MeshStandardMaterial({ color: 0x0c1030, roughness: 1 }));
  under2.position.set(0, -1.37, zc); plat.add(under2);
  const roadZ = ROWS === 1 ? 1.75 : ((ROWS - 1) / 2) * PZ + 1.75;
  const road = new THREE.Mesh(new THREE.BoxGeometry(W - 0.4, 0.03, 1.1), new THREE.MeshStandardMaterial({ color: 0x15183c, roughness: 0.9 }));
  road.position.set(0, 0.005, roadZ); plat.add(road);
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.012, 0.06), new THREE.MeshBasicMaterial({ color: 0xf0d58a }), 14);
  const dd = new THREE.Object3D();
  for (let k = 0; k < 14; k++) { dd.position.set(-6.3 + k * 0.97, 0.03, roadZ); dd.updateMatrix(); dashes.setMatrixAt(k, dd.matrix); }
  plat.add(dashes);

  /* distant skyline silhouettes + a few lit windows */
  const farN = 40, farGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const far = new THREE.InstancedMesh(farGeo, new THREE.MeshBasicMaterial({ color: 0x111533 }), farN);
  const fr = rng(31), farWin = new Float32Array(150 * 3); let fw = 0;
  for (let k = 0; k < farN; k++) {
    const x = -36 + k * 1.85 + fr() * 0.8, w = 1.4 + fr() * 1.6, h = 3 + fr() * 9 + (k % 7 === 3 ? 6 : 0), z = -22 - fr() * 8;
    dd.position.set(x, -0.5, z); dd.scale.set(w, h, w); dd.rotation.set(0, 0, 0); dd.updateMatrix(); far.setMatrixAt(k, dd.matrix);
    for (let j = 0; j < 4 && fw < 150; j++) farWin.set([x + (fr() - 0.5) * w * 0.8, h * (0.15 + fr() * 0.75) - 0.5, z + w / 2 + 0.02], (fw++) * 3);
  }
  scene.add(far);
  const fwGeo = new THREE.BufferGeometry(); fwGeo.setAttribute('position', new THREE.BufferAttribute(farWin.slice(0, fw * 3), 3));
  const farWinPts = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false, color: 0xffd98a, transparent: true, fog: false })); scene.add(farWinPts);

  /* cabs (idle life) */
  const cabs = [];
  for (let k = 0; k < 2; k++) {
    const cab = new THREE.Group(), bodyM = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.6 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.3), bodyM); b1.position.y = 0.14;
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.26), bodyM); b2.position.set(-0.02, 0.28, 0);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), new THREE.MeshBasicMaterial({ color: 0xfff2b0, toneMapped: false })); lamp.position.set(0, 0.38, 0);
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.22), new THREE.MeshBasicMaterial({ color: 0xfff2b0, toneMapped: false })); hl.position.set(0.32, 0.15, 0);
    cab.add(b1, b2, lamp, hl); cab.userData = { dir: k ? -1 : 1, off: k * 0.5, lane: k ? -0.22 : 0.22 };
    cabs.push(cab); scene.add(cab);
  }

  function placeCabs() { for (const c of cabs) { const u = ((clock * 0.09 + c.userData.off) % 1 + 1) % 1; c.position.set(c.userData.dir * (-6.3 + u * 12.6), 0.02, roadZ + c.userData.lane); c.rotation.y = c.userData.dir > 0 ? 0 : Math.PI; } }
  let clock = 0;
  /* ---------- towers ---------- */
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const winMat = new THREE.MeshBasicMaterial({ toneMapped: false, fog: true });
  const wins = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.24), winMat, N * WPT);
  wins.frustumCulled = false; scene.add(wins);
  const winM = new Float32Array(N * WPT * 16), winLit = new Uint8Array(N * WPT), zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  const dummy = new THREE.Object3D(), tmpC = new THREE.Color(), cSteady = new THREE.Color(), cFlash = new THREE.Color(), cLit = new THREE.Color(0xffd98a), cOff = new THREE.Color(0x151a3a), cWhite = new THREE.Color(2.4, 2.1, 1.6);
  let glow = 1, winDirty = true;
  const slotR = rng(99);
  for (let i = 0; i < N * WPT; i++) winLit[i] = slotR() < 0.72 ? 1 : 0;

  const towers = [];
  const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), N * 8);
  lampMesh.frustumCulled = false; scene.add(lampMesh);
  const scaffGeo = (() => {
    const p = [], hgt = 1.15, a = 0.62;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(sx * a, 0, sz * a, sx * a, hgt, sz * a);
    for (let y = 0.3; y <= hgt + 0.01; y += 0.28) { for (const [x1, z1, x2, z2] of [[-a, -a, a, -a], [a, -a, a, a], [a, a, -a, a], [-a, a, -a, -a]]) p.push(x1, y, z1, x2, y, z2); }
    p.push(-a, 0, a, a, 0.55, a, a, 0.55, a, -a, 1.1, a);
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  })();
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x4fc79a, roughness: 0.8, flatShading: true });

  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / COLS), c = i % COLS;
    const b = {
      i, x: (c - 3) * PX, z: ROWS === 1 ? 0 : (r - (ROWS - 1) / 2) * PZ,
      w: 1.06 + ((i * 37) % 5) * 0.035, d: 1.06 + ((i * 53) % 5) * 0.035,
      h: 0.06, v: 0, target: 0.06, floors: 0, status: 'future', tier: 0, flash: 0, vis: new Uint8Array(MAXF), fbirth: new Float32Array(MAXF).fill(-1), fl: new Float32Array(MAXF).fill(-1),
      lamps: [], lampBorn: [], beacons: [], doorOpen: false, crownMet: false, crownFloor: 6, isToday: false, picked: false, day: null,
    };
    b.mat = new THREE.MeshStandardMaterial({ color: TIER[0], roughness: 0.8, flatShading: true });
    b.mesh = new THREE.Mesh(boxGeo, b.mat); b.mesh.position.set(b.x, 0, b.z); scene.add(b.mesh);
    b.capMat = new THREE.MeshStandardMaterial({ color: 0x8a92d8, roughness: 0.7 });
    b.cap = new THREE.Mesh(boxGeo, b.capMat); b.cap.scale.set(b.w + 0.1, 0.08, b.d + 0.1); scene.add(b.cap);
    // rooftop details: AC box + (some) NYC water tower
    b.ac = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x6b73b8, roughness: 0.9 })); b.ac.scale.set(0.28, 0.16, 0.3); scene.add(b.ac);
    const wt = new THREE.Group(); const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10), new THREE.MeshStandardMaterial({ color: 0xa8714a, roughness: 0.9 })); tank.position.y = 0.4;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 10), new THREE.MeshStandardMaterial({ color: 0x7a4f31 })); cone.position.y = 0.59;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), new THREE.MeshStandardMaterial({ color: 0x4a3a35 })); legs.position.y = 0.14;
    wt.add(tank, cone, legs); b.wt = wt; wt.visible = i % 3 === 1; scene.add(wt);
    // crown (target) band: ghost edges while unmet, solid glowing band when met
    b.crownGhost = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffb224, transparent: true, opacity: 0.85 })); b.crownGhost.visible = false; scene.add(b.crownGhost);
    b.crownSolid = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.45, 0.3), toneMapped: false })); b.crownSolid.visible = false; scene.add(b.crownSolid);
    // door
    b.doorMat = new THREE.MeshBasicMaterial({ color: 0x1a1d3a, toneMapped: false });
    b.door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.05), b.doorMat); b.door.position.set(b.x, 0.17, b.z + b.d / 2 + 0.02); scene.add(b.door);
    // beacons
    b.beaconG = new THREE.Group(); b.beaconG.position.set(b.x, 0, b.z); scene.add(b.beaconG);
    // scaffolding
    b.scaff = new THREE.LineSegments(scaffGeo, new THREE.LineBasicMaterial({ color: 0xb5aaff, transparent: true, opacity: 0.85 })); b.scaff.position.set(b.x, 0, b.z); b.scaff.scale.set(b.w * 0.9, 1, b.d * 0.9); b.scaff.visible = false; scene.add(b.scaff);
    // park tile for rest days
    const tile = new THREE.Group(); const tm = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x7f74d0, roughness: 0.9 })); tm.scale.set(b.w + 0.1, 0.12, b.d + 0.1); tile.add(tm);
    const t1 = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 7), treeMat); t1.position.set(-0.22, 0.38, 0.1);
    const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 7), treeMat); t2.position.set(0.24, 0.32, -0.15);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 2), toneMapped: false })); moon.position.set(0.1, 0.9, 0.2);
    tile.add(t1, t2, moon); tile.position.set(b.x, 0, b.z); tile.visible = false; b.tile = tile; scene.add(tile);
    // survey stake on empty lots
    const stake = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), new THREE.MeshStandardMaterial({ color: 0xcfc6a8 })); pole.position.y = 0.3;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: 0xffb224, side: THREE.DoubleSide, toneMapped: false })); flag.position.set(0.11, 0.54, 0);
    stake.add(pole, flag); stake.position.set(b.x + 0.1, 0.06, b.z + 0.1); stake.visible = false; b.stake = stake; scene.add(stake);
    // hit box for picking
    b.hit = new THREE.Mesh(boxGeo, hitMat); b.hit.userData.i = i; b.hit.position.set(b.x, 0, b.z); scene.add(b.hit);
    // windows for this tower
    for (let f = 0; f < MAXF; f++) for (let k = 0; k < 4; k++) for (let cc = 0; cc < WCOLS; cc++) {
      const idx = i * WPT + ((f * 4 + k) * WCOLS + cc), dist = (k % 2 ? b.d : b.w) / 2 + 0.006, off = (cc - (WCOLS - 1) / 2) * 0.46;
      dummy.position.set(b.x, (f + 0.5) * FLOOR_H, b.z); dummy.rotation.set(0, k * Math.PI / 2, 0); dummy.scale.setScalar(1);
      dummy.translateZ(dist); dummy.translateX(off); dummy.updateMatrix(); dummy.matrix.toArray(winM, idx * 16);
      wins.setMatrixAt(idx, zeroM); wins.setColorAt(idx, cOff);
    }
    // today ground ring + picked ring
    towers.push(b);
  }
  const ringGeo = new THREE.RingGeometry(0.86, 1.0, 40).rotateX(-Math.PI / 2);
  const todayRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.3, 0.3), toneMapped: false, transparent: true, opacity: 0.9 })); todayRing.visible = false; todayRing.position.y = 0.02; scene.add(todayRing);
  const pickRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.85, 2.2), toneMapped: false, transparent: true, opacity: 0.95 })); pickRing.visible = false; pickRing.position.y = 0.025; scene.add(pickRing);

  /* ---------- landmarks ---------- */
  const lmScale = mode === 'city' ? 1.0 : 0.62;
  const lmZ = mode === 'city' ? -((ROWS - 1) / 2) * PZ - 3.3 : -3.0;
  const landmarks = Object.keys(KINDS).map((name, k) => {
    const parts = landmark(KINDS[name], LADDER_HEX[name]);
    const grp = new THREE.Group(); const lx = (k - 2) * (mode === 'city' ? 2.9 : 2.55);
    grp.position.set(lx, 0, lmZ - (k % 2) * 0.4); grp.scale.setScalar(lmScale); scene.add(grp);
    const items = parts.map((p) => { grp.add(p); return { o: p, y: 0, v: 0, on: false, target: 0 }; });
    return { name, grp, items, sections: 0, x: lx };
  });
  function applyPart(it, on) {
    it.on = on;
    it.o.traverse((n) => { if (n.userData.solid) n.material = on ? n.userData.solid : n.userData.ghost; });
  }
  function setLandmarks(list, { animate = true } = {}) {
    for (const l of list) {
      const lm = landmarks.find((x) => x.name === l.ladder); if (!lm) continue;
      lm.items.forEach((it, idx) => {
        const on = idx < l.sections;
        if (on && !it.on && animate && motion) { it.y = -1.2; it.v = 0; it.flash = 1; }
        applyPart(it, on);
        if (on && !it.flash) it.y = 0;
      });
      lm.sections = l.sections;
    }
    wake();
  }
  landmarks.forEach((lm) => lm.items.forEach((it) => applyPart(it, false)));

  /* ---------- sky / time ---------- */
  function setTime(hour) {
    const s = skyAt(hour);
    const g = skyCtx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + s.top.getHexString(THREE.SRGBColorSpace)); g.addColorStop(0.62, '#' + s.hor.getHexString(THREE.SRGBColorSpace)); g.addColorStop(1, '#' + s.hor.getHexString(THREE.SRGBColorSpace));
    skyCtx.fillStyle = g; skyCtx.fillRect(0, 0, 2, 256); skyTex.needsUpdate = true;
    scene.fog.color.copy(s.hor); sun.intensity = s.sun; hemi.intensity = 0.55 + 0.5 * s.sun; rim.intensity = 0.2 + 0.4 * s.stars;
    stars.material.opacity = s.stars; stars.visible = s.stars > 0.02;
    far.material.color.copy(s.hor).lerp(new THREE.Color(0x0b0e26), 0.62);
    farWinPts.material.opacity = clamp(s.glow * 1.1, 0, 1);
    cloudMat.opacity = clamp(s.sun * 0.8 - 0.15, 0, 0.8);
    glow = s.glow;
    const hh = ((hour % 24) + 24) % 24, day = hh >= 6 && hh < 18, ph = day ? (hh - 6) / 12 : ((hh >= 18 ? hh - 18 : hh + 6) / 12);
    const ang = Math.PI * (1 - ph);
    orb.position.set(Math.cos(ang) * 24, 3 + Math.sin(ang) * 17, -42);
    orb.material.color.set(day ? new THREE.Color(2.2, 1.7, 0.8) : new THREE.Color(1.5, 1.5, 1.9)); orb.visible = orb.position.y > 4;
    winDirty = true; recolorAll(); invalidate();
  }

  /* ---------- window plumbing ---------- */
  function steady(idx) { return winLit[idx] ? cSteady.copy(cLit).multiplyScalar(0.3 + 0.95 * glow) : cSteady.copy(cOff); }
  function setFloorWindows(b, f, show, color) {
    for (let k = 0; k < 8; k++) {
      const idx = b.i * WPT + f * 8 + k;
      if (show) wins.setMatrixAt(idx, dummy.matrix.fromArray(winM, idx * 16)); else wins.setMatrixAt(idx, zeroM);
      if (show) wins.setColorAt(idx, color || steady(idx));
    }
    winDirty = true;
  }
  function recolorAll() {
    for (const b of towers) for (let f = 0; f < MAXF; f++) if (b.vis[f] && b.fl[f] < 0) for (let k = 0; k < 8; k++) wins.setColorAt(b.i * WPT + f * 8 + k, steady(b.i * WPT + f * 8 + k));
    winDirty = true;
  }

  /* ---------- data in ---------- */
  // days: oldest -> newest, length <= N. Each: {floors, targetFloor, status, doors, crown, lamps:[hex], beacons:[hex], isToday}
  function setDays(days, { animate = true } = {}) {
    const now = performance.now() / 1000;
    days.slice(-N).forEach((d, k) => {
      const b = towers[k]; b.day = d;
      const prevFloors = b.floors, floors = clamp(d.floors | 0, 0, MAXF);
      b.status = d.status; b.floors = floors; b.crownFloor = d.targetFloor || 6; b.isToday = !!d.isToday;
      const flat = d.status === 'missed' || d.status === 'rest' || d.status === 'future';
      b.target = flat ? 0.06 : Math.max(0.06, floors * FLOOR_H);
      b.tier = d.crown ? 2 : d.doors ? 1 : 0;
      if (floors > prevFloors && animate && motion) {
        for (let f = prevFloors; f < Math.min(floors, prevFloors + 8); f++) b.fbirth[f] = now + (f - prevFloors) * 0.05 + 0.08;
        b.flash = 1;
      }
      if (floors < prevFloors) for (let f = floors; f < MAXF; f++) { b.vis[f] = 0; b.fl[f] = -1; setFloorWindows(b, f, false); }
      // door
      if (d.doors && !b.doorOpen) { b.doorFlash = 1; }
      b.doorOpen = !!d.doors;
      if (d.crown && !b.crownMet && animate && motion) b.crownFlash = 1;
      b.crownMet = !!d.crown;
      // beacons
      const want = d.beacons || [];
      while (b.beacons.length < want.length) { const j = b.beacons.length; const grp = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xcfc6e8 })); pole.position.y = 0.25;
        const orbM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(want[j]).multiplyScalar(1.7), toneMapped: false })); orbM.position.y = 0.55; grp.add(pole, orbM);
        grp.position.x = (j - (want.length - 1) / 2) * 0.28; grp.userData = { born: animate && motion ? now : -9, j }; grp.scale.setScalar(animate && motion ? 0.001 : 1); b.beaconG.add(grp); b.beacons.push(grp); }
      b.beacons.forEach((g, j) => { g.visible = j < want.length; });
      // lamps
      const had = b.lamps.length; b.lamps = (d.lamps || []).slice(0, 8);
      for (let j = had; j < b.lamps.length; j++) b.lampBorn[j] = animate && motion ? now : -9;
      // status props
      b.scaff.visible = d.status === 'missed' || d.status === 'repair';
      b.tile.visible = d.status === 'rest';
      b.stake.visible = floors === 0 && (d.status === 'future' || d.status === 'open');
      if (!motion || !animate) { b.h = b.target; b.v = 0; }
    });
    for (let k = days.length; k < N; k++) { /* unused slots stay empty */ }
    const t = towers.find((x) => x.isToday); if (t) { todayRing.visible = true; todayRing.position.x = t.x; todayRing.position.z = t.z; todayRing.scale.set(t.w * 0.78, 1, t.d * 0.78); } else todayRing.visible = false;
    layoutLamps(); wake();
  }
  function layoutLamps() {
    let n = 0; const now = performance.now() / 1000;
    for (const b of towers) {
      b.lamps.forEach((hex, j) => {
        const age = clamp((now - b.lampBorn[j]) / 0.45, 0, 1), s = age >= 1 ? 1 : (1 + 0.5 * Math.sin(age * Math.PI)) * smooth(age);
        dummy.position.set(b.x + (j - (b.lamps.length - 1) / 2) * 0.26, 0.09, b.z + b.d / 2 + 0.42); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(Math.max(s, 0.001)); dummy.updateMatrix();
        lampMesh.setMatrixAt(n, dummy.matrix); lampMesh.setColorAt(n, tmpC.set(hex).multiplyScalar(1.6)); n++;
      });
    }
    lampMesh.count = n; lampMesh.instanceMatrix.needsUpdate = true; if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  }

  /* ---------- crane (comeback day) ---------- */
  let crane = null;
  function craneAt(i) {
    const b = towers[i]; if (!b) return;
    if (crane) scene.remove(crane.g);
    const g = new THREE.Group(), yel = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.6 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), yel); mast.position.set(0, 1.3, 0);
    const jibG = new THREE.Group(); jibG.position.y = 2.6; const jib = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.1), yel); jib.position.x = 0.7;
    const cw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x6b6f96 })); cw.position.x = -0.7;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); cable.position.set(1.5, -0.5, 0);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x5a63c8 })); blk.position.set(1.5, -1.1, 0);
    jibG.add(jib, cw, cable, blk); g.add(mast, jibG);
    g.position.set(b.x + b.w / 2 + 0.5, 0, b.z - 0.2); scene.add(g);
    crane = { g, jibG, cable, blk, b, t0: performance.now() / 1000 }; wake();
  }
  function stepCrane(now) {
    if (!crane) return false;
    const t = now - crane.t0, k = clamp(t / 2.6, 0, 1);
    crane.jibG.rotation.y = -Math.PI * 0.5 * (1 - smooth(clamp(t / 0.9, 0, 1)));
    const drop = smooth(clamp((t - 0.9) / 0.7, 0, 1)) * (1 - smooth(clamp((t - 1.8) / 0.7, 0, 1)));
    const len = 0.5 + 1.0 * drop; crane.cable.scale.y = len; crane.cable.position.y = -len / 2; crane.blk.position.y = -len - 0.1;
    crane.g.position.y = crane.b.h; crane.g.scale.setScalar(clamp(t / 0.3, 0, 1) * (1 - smooth(clamp((t - 2.3) / 0.3, 0, 1))) + 0.001);
    if (t > 2.65) { scene.remove(crane.g); crane = null; return false; }
    return true;
  }

  /* ---------- per-frame work ---------- */
  let focusX = null, focusUntil = 0;
  function focusDay(i, ms = 2200) { const b = towers[i]; if (!b) return; focusX = b.x - baseTarget.x; focusUntil = performance.now() + ms; wake(); }
  function nudgeLandmark(name) { const lm = landmarks.find((x) => x.name === name); if (!lm) return; focusX = lm.x - baseTarget.x; focusUntil = performance.now() + 2600; wake(); }
  let twinkleAt = 0;

  function step(dt, now) {
    let moving = false;
    for (const b of towers) {
      const k = 60, c = 9, a = k * (b.target - b.h) - c * b.v;
      if (motion) { b.v += a * dt; b.h += b.v * dt; } else { b.h = b.target; b.v = 0; }
      if (Math.abs(b.target - b.h) < 0.002 && Math.abs(b.v) < 0.002) { b.h = b.target; b.v = 0; } else moving = true;
      if (b.flash > 0) { b.flash = Math.max(0, b.flash - dt * 1.8); moving = true; }
      if (b.doorFlash > 0) { b.doorFlash = Math.max(0, b.doorFlash - dt * 1.6); moving = true; }
      if (b.crownFlash > 0) { b.crownFlash = Math.max(0, b.crownFlash - dt * 0.8); moving = true; }
      // windows
      for (let f = 0; f < MAXF; f++) {
        const should = f < b.floors && b.h > (f + 0.8) * FLOOR_H && (b.fbirth[f] < 0 || b.fbirth[f] <= now);
        if (should && !b.vis[f]) { b.vis[f] = 1; b.fl[f] = b.fbirth[f] >= 0 ? now : -1; setFloorWindows(b, f, true, b.fl[f] >= 0 ? cWhite : null); }
        else if (!should && b.vis[f] && f >= b.floors) { b.vis[f] = 0; setFloorWindows(b, f, false); }
        if (b.vis[f] && b.fl[f] >= 0) {
          const age = (now - b.fl[f]) / 1.3; moving = true;
          if (age >= 1) { b.fl[f] = -1; b.fbirth[f] = -1; for (let q = 0; q < 8; q++) wins.setColorAt(b.i * WPT + f * 8 + q, steady(b.i * WPT + f * 8 + q)); }
          else for (let q = 0; q < 8; q++) { const idx = b.i * WPT + f * 8 + q; wins.setColorAt(idx, cFlash.copy(cWhite).lerp(steady(idx), smooth(age))); }
          winDirty = true;
        } else if (!b.vis[f] && f < b.floors && b.fbirth[f] > now) moving = true;
      }
      // pose
      const h = Math.max(b.h, 0.05), flat = b.status === 'missed' || b.status === 'rest' || b.status === 'future';
      b.mesh.visible = b.status !== 'rest'; b.mesh.scale.set(b.w, h, b.d);
      const col = flat ? 0x3a4072 : TIER[b.tier]; b.mat.color.setHex(col).lerp(tmpC.set(0xffffff), b.flash * 0.45);
      b.cap.visible = b.mesh.visible && !flat; b.cap.position.set(b.x, h, b.z);
      b.ac.visible = b.cap.visible && b.floors >= 2; b.ac.position.set(b.x - 0.28, h + 0.08, b.z - 0.2);
      b.wt.visible = (b.i % 3 === 1) && b.floors >= 4 && b.cap.visible; b.wt.position.set(b.x + 0.22, h, b.z - 0.12);
      b.hit.scale.set(b.w + 0.1, Math.max(h, 1.3) + 0.2, b.d + 0.1);
      // crown
      const cy = b.crownFloor * FLOOR_H, eligible = !flat && (b.isToday || b.tier >= 1);
      b.crownGhost.visible = eligible && !b.crownMet; b.crownSolid.visible = eligible && b.crownMet && h >= cy - 0.05;
      b.crownGhost.scale.set(b.w + 0.2, 0.1, b.d + 0.2); b.crownGhost.position.set(b.x, cy, b.z);
      const cp = b.crownFlash > 0 ? 1 + 0.35 * Math.sin(b.crownFlash * 10) * b.crownFlash : 1;
      b.crownSolid.scale.set((b.w + 0.14) * cp, 0.12 * cp, (b.d + 0.14) * cp); b.crownSolid.position.set(b.x, cy - 0.04, b.z);
      // door
      const lit = b.doorOpen; b.doorMat.color.setRGB(lit ? 2.3 : 0.1, lit ? 1.5 + b.doorFlash : 0.11, lit ? 0.4 + b.doorFlash * 1.4 : 0.23);
      b.door.visible = !flat;
      // beacons
      b.beaconG.position.y = h + 0.04;
      for (const g of b.beacons) { if (!g.visible) continue; const age = (now - g.userData.born) / 0.7; const s = age >= 1 ? 1 : smooth(clamp(age, 0, 1)) * (1 + 0.25 * Math.sin(age * Math.PI)); if (age < 1) moving = true; g.scale.setScalar(Math.max(s, 0.001)); const pulse = 1 + 0.18 * Math.sin(now * 3 + g.userData.j); g.children[1].scale.setScalar(pulse); }
      b.stake.children[1].rotation.y = Math.sin(now * 2 + b.i) * 0.5;
    }
    // lamps animate in
    layoutLamps();
    // landmarks lift into place
    for (const lm of landmarks) for (const it of lm.items) {
      if (it.flash > 0 || Math.abs(it.y) > 0.002) { const a = 70 * (0 - it.y) - 10 * it.v; it.v += a * dt; it.y += it.v * dt; if (Math.abs(it.y) < 0.002 && Math.abs(it.v) < 0.01) { it.y = 0; it.v = 0; it.flash = 0; } else moving = true; }
      if (it.flash > 0) it.flash = Math.max(0, it.flash - dt * 0.9);
      it.o.position.y = (it.o.userData.y0 ??= it.o.position.y) + it.y;
    }
    if (stepCrane(now)) moving = true;
    return moving;
  }

  /* ---------- post: bloom ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.7, 0.82);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  let useBloom = opts.bloom !== false;

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setPixelRatio(dprCap()); renderer.setSize(w, h, false);
    composer.setPixelRatio(dprCap()); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix(); fit(); invalidate();
  }
  new ResizeObserver(resize).observe(host);

  /* ---------- render on demand ---------- */
  let raf = 0, last = 0, lastDraw = 0, visible = true, paused = false, activeUntil = performance.now() + ACTIVE_MS, quietUntil = 0;
  const wake = () => { activeUntil = performance.now() + ACTIVE_MS; invalidate(); };
  const canRun = () => visible && !document.hidden && !paused;
  function invalidate() { if (!raf && canRun()) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    const dt = Math.min((t - last) / 1000 || 0.016, 0.05); last = t; clock += dt;
    const now = performance.now() / 1000;
    let moving = step(dt, now);
    const idle = motion && t < activeUntil && t > quietUntil;
    // camera focus nudge (both camera and target move so the view slides, it doesn't tilt)
    const wantX = focusX !== null && performance.now() < focusUntil ? focusX * 0.45 : 0;
    const dx = (baseTarget.x + wantX - controls.target.x) * Math.min(1, dt * 4);
    if (Math.abs(dx) > 0.0005) { controls.target.x += dx; camera.position.x += dx; moving = true; }
    if (idle) {
      controls.autoRotate = true;
      if (mode === 'week') { const a = controls.getAzimuthalAngle(); if (a > 0.3) dirSign = -1; else if (a < -0.3) dirSign = 1; controls.autoRotateSpeed = 1.1 * dirSign; }
      else controls.autoRotateSpeed = 0.7;
      // gentle life: cabs, clouds, window twinkle
      placeCabs();
      for (const cl of clouds) { cl.position.x += cl.userData.speed * dt; if (cl.position.x > 36) cl.position.x = -36; }
      if (t > twinkleAt) { twinkleAt = t + 900; for (let q = 0; q < 6; q++) { const b = towers[(Math.random() * N) | 0], f = (Math.random() * MAXF) | 0; if (b.vis[f] && b.fl[f] < 0) { const idx = b.i * WPT + f * 8 + ((Math.random() * 8) | 0); winLit[idx] ^= 1; wins.setColorAt(idx, steady(idx)); winDirty = true; } } }
    } else controls.autoRotate = false;
    if (winDirty) { wins.instanceMatrix.needsUpdate = true; if (wins.instanceColor) wins.instanceColor.needsUpdate = true; winDirty = false; }
    if (todayRing.visible) { const p = 1 + 0.06 * Math.sin(clock * 3); const tb = towers.find((x) => x.isToday); if (tb) todayRing.scale.set(tb.w * 0.78 * p, 1, tb.d * 0.78 * p); }
    if (moving || !idle || t - lastDraw > 33) {
      controls.update(dt); lastDraw = t;
      useBloom ? composer.render() : renderer.render(scene, camera);
    }
    if (moving || idle) invalidate();
  }
  controls.addEventListener('start', () => { quietUntil = performance.now() + 6000; activeUntil = Math.max(activeUntil, quietUntil + 400); invalidate(); });
  controls.addEventListener('change', invalidate);
  controls.addEventListener('end', () => { quietUntil = performance.now() + 6000; setTimeout(wake, 6100); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); wake(); } });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }).observe(host);
  host.addEventListener('pointerenter', wake);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); host.classList.add('no-webgl'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { host.classList.remove('no-webgl'); invalidate(); });
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener?.('change', () => setMotion(!mq.matches));

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) { down = null; return; }
    down = null; const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(towers.map((b) => b.hit), false)[0];
    if (hit) pick(hit.object.userData.i); else pick(-1);
  });
  function pick(i) {
    towers.forEach((b) => { b.picked = b.i === i; });
    const b = towers[i]; if (b && i >= 0) { pickRing.visible = true; pickRing.position.x = b.x; pickRing.position.z = b.z; pickRing.scale.set(b.w * 0.95, 1, b.d * 0.95); } else pickRing.visible = false;
    opts.onPick?.(i); wake();
  }

  /* ---------- API ---------- */
  function setMotion(on) { motion = !!on; if (!motion) { towers.forEach((b) => { b.h = b.target; b.v = 0; }); } wake(); invalidate(); }
  const api = {
    setDays, setLandmarks, setTime: (h) => setTime(h), setHourFn: (fn) => { hourFn = fn; setTime(hourFn()); },
    pulse: (i) => { const b = towers[i]; if (b) { b.flash = 1; } wake(); }, focusDay, nudgeLandmark, craneAt, pick, setMotion,
    pause: (p) => { paused = !!p; if (!paused) wake(); }, invalidate: wake,
    snapshot() { useBloom ? composer.render() : renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    renderNow: () => (useBloom ? composer.render() : renderer.render(scene, camera)), renderer, scene,
    dispose() { cancelAnimationFrame(raf); controls.dispose(); composer.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
  placeCabs(); fit(); setTime(opts.hourFixed ?? hourFn()); resize();
  setInterval(() => { if (canRun()) setTime(hourFn()); }, 5 * 60 * 1000);
  return api;
}
