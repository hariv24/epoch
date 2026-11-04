// city/spots/butler2.js · Butler Library v2: the reading room Butler 301 (docs/BUTLER-V2.md 11, 12; the shell is butler2_hall.js).
// The brownstone's pipeline (room2.js): ACES tone mapping, RoomEnvironment PMREM, PCF shadows rendered on demand, Poly Haven PBR textures.
// The hall: 14 m wide x 13 m high x 24 m (z = -7 .. 17); 9 tall steel-mullion windows on the left wall (x = -7) with the sun's feathered shafts,
// a gold coffered ceiling with downlights, 5 three-ring brass chandeliers, cream stone floor with black squares, a 2.6 m oak bookcase band all round.
// 10 tables (4.2 x 1.2 m, top 0.74 m, grey-beige tops) run across the hall in 5 rows either side of the 3 m aisle; dark Windsor chairs (seat 0.45 m),
// cream pleated cone lamps. People: Hariv (people/mixamo/hariv.glb, the Columbia sweatshirt) typing at the window-side table next to the aisle;
// 10 students (people/mixamo/students/*.glb) with seated mocap loops; one leaves / arrives through the aisle every 3-6 min. Every seat runs people_fit.
// Camera: room2_cam.js behind Hariv's right shoulder (seated eye 1.22 m), drag yaw +-150, pitch -30..+35, arm 1.0-4.0 m.
//   createButler2Stage(host, opts) -> the spot-stage API of spots/index.js (setRun, setInset, setMotion, setWeather, setHourFn, pause, describe, stats,
//   dispose, ...). opts.onFail(err) is called when anything fails to load: spots/index.js then shows the classic Butler.
// Debug (URL): &tod=morning|day|golden|night|<hour>  &run=work|idle  &fit=fresh  &shot=1 (full-window canvas)  &realview=0
//   window.__butler2 { ready, info(), setTod(t), setLook(yawDeg, pitchDeg), cam(), free(pos, look, fov), inside(), fitText(), live(), sweep() }
import * as THREE from 'three';
import { createRenderer, addRoomEnvironment, createLoop, createAdaptiveDpr, installPerf, sizeTo } from '../world/render.js';
import { createTextures } from '../world/textures.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fit, loadPerson, solveFit, setTol, cloudOfAsync } from '../world/people.js';
import { createRig } from '../world/cam.js';
import { paintView, lightAt, weatherAmounts } from './kit.js';
import { buildHall, HALL, WIN, rod } from './butler2_hall.js';

const D2R = Math.PI / 180;
const ROOM = new URL('../../room/assets/', import.meta.url), BA = new URL('../../spots/assets/butler/', import.meta.url);
const NOTABLES = new URL('../manhattan/notables.json', import.meta.url);
const { X0, X1, Z0, Z1, H } = HALL;                                          // hall interior (docs/BUTLER-V2.md 12: 14 m wide x 13 m high, 24 m of length)
const AISLE = 3, TAB = { L: 4.2, W: 1.2, top: 0.74 };                       // tables run ACROSS the hall (long axis = x), from the 3 m central aisle to each long wall
const SEAT_TOP = 0.45, CHAIR_OFF = 0.42, SEAT_DX = [-1.5, -0.5, 0.5, 1.5], LAMP_DX = [-1, 0, 1];
const ROWS = [-0.5, 3.2, 6.9, 10.6, 14.3];                                  // table rows down the hall (pitch 3.7 m); 2 tables per row, one each side of the aisle
// TABLES[i]: i = row * 2 + (0 left | 1 right). Seats: n = the near side (z > table, facing -z, yaw pi), f = the far side (facing +z, yaw 0); id = 'T' + table + n|f + index
const TABLES = ROWS.flatMap((z, r) => [-1, 1].map((sd, k) => { const x = sd * (AISLE / 2 + TAB.L / 2); return { i: r * 2 + k, r, sd, x, z, x0: x - TAB.L / 2, x1: x + TAB.L / 2, z0: z - TAB.W / 2, z1: z + TAB.W / 2, gap: -sd }; }));
const SEATS = TABLES.flatMap((t) => SEAT_DX.flatMap((dx, i) => [
  { id: 'T' + t.i + 'n' + i, tab: t, x: t.x + dx, cz: t.z + TAB.W / 2 + CHAIR_OFF, yaw: Math.PI },
  { id: 'T' + t.i + 'f' + i, tab: t, x: t.x + dx, cz: t.z - TAB.W / 2 - CHAIR_OFF, yaw: 0 },
])).map((s, ci) => ({ ...s, ci, bz: -Math.cos(s.yaw) }));
// the cast (docs/BUTLER-V2.md 5, 11): 10 students (5 women + 5 men) + Hariv; mocap only, seated clips only while seated.
const CAST = [
  { id: 'hariv', file: 'hariv.glb', seat: 'T0f3', clip: 'typing', alt: null, name: 'Hariv' , sy: 0.44, dhR: 0.08 },
  { id: 'sara', file: 'students/sara.glb', seat: 'T0n1', clip: 'typing', alt: null, name: 'Sara', woman: true , sy: 0.43 },
  { id: 'dude', file: 'students/dude.glb', seat: 'T0f0', clip: 'writing', alt: null, name: 'Dude' , sy: 0.47, dhR: 0.08 },
  { id: 'veronica', file: 'students/veronica.glb', seat: 'T1f1', clip: 'writing', alt: null, name: 'Veronica', woman: true, book: true , sy: 0.46 },
  { id: 'andrew', file: 'students/andrew.glb', seat: 'T1n2', clip: 'writing', alt: null, name: 'Andrew' , sy: 0.47 },
  { id: 'maria', file: 'students/maria.glb', seat: 'T2f2', clip: 'writing', alt: null, name: 'Maria', woman: true , sy: 0.46 },
  { id: 'duke', file: 'students/duke.glb', seat: 'T3f0', clip: 'writing', alt: null, name: 'Duke' , sy: 0.48 },
  { id: 'antony', file: 'students/antony.glb', seat: 'T4n1', clip: 'writing', alt: null, name: 'Antony' , sy: 0.45 },
  { id: 'alexis', file: 'students/alexis.glb', seat: 'T5n3', clip: 'writing', alt: null, name: 'Alexis', woman: true , sy: 0.43 },
  { id: 'noodle', file: 'students/mrsnoodle.glb', seat: 'T6f1', clip: 'writing', alt: null, name: 'Mrs Noodle', woman: true, book: true , sy: 0.44 },
  { id: 'froggle', file: 'students/froggle.glb', seat: 'T9n2', clip: 'writing', alt: null, name: 'Mr Froggle' , sy: 0.44 },
];
const LIGHT = {          // ch = chandelier point lights (cd), ceil = the ceiling's glow, halo = bulb / downlight halos, down = downlight brightness, sky = window sky fill
  morning: { sun: 0xdce6ff, sunI: 2.8, el: 20, az: 30, sky: 0xcfdcf2, gnd: 0x9a8a74, hemi: 0.6, env: 0.32, fog: 0x9aa0a6, shaft: 0.035, lamp: 0.5, exp: 0.9, ch: 4, ceil: 0.03, halo: 0.25, down: 1.0, skyI: 0.9, skyC: 0xd6e4ff },
  day: { sun: 0xfff3e2, sunI: 3.4, el: 36, az: 18, sky: 0xe4ecf6, gnd: 0xa8957c, hemi: 0.72, env: 0.36, fog: 0xb4aa98, shaft: 0.03, lamp: 0.5, exp: 0.8, ch: 4, ceil: 0.03, halo: 0.22, down: 1.0, skyI: 1.0, skyC: 0xdde8ff },
  golden: { sun: 0xffb064, sunI: 3.4, el: 13, az: -14, sky: 0xf0c49a, gnd: 0x8a6a4c, hemi: 0.6, env: 0.28, fog: 0x9c7a58, shaft: 0.045, lamp: 0.9, exp: 1.02, ch: 10, ceil: 0.08, halo: 0.5, down: 1.15, skyI: 0.8, skyC: 0xffc890 },
  night: { sun: 0, sunI: 0, el: 30, az: 0, sky: 0xc08a4c, gnd: 0x6a4e34, hemi: 0.36, env: 0.14, fog: 0x2a1d12, shaft: 0, lamp: 3.6, exp: 1.05, ch: 40, ceil: 0.3, halo: 1.0, down: 1.7, skyI: 0.12, skyC: 0x5d74a8 },
};
const bucketOf = (h) => { h = ((h % 24) + 24) % 24; return h < 6.5 || h >= 19.5 ? 'night' : h < 10 ? 'morning' : h < 16.5 ? 'day' : 'golden'; };
const TOD = { morning: 8, day: 12.5, golden: 18, night: 22 };
const LOOK0 = [-8, 8];                  // the default look, relative to straight behind Hariv: turned 8 deg toward the window wall (negative = toward x = X0), 8 deg up (the aisle, chandeliers, windows: photos 2, 5)

export function createButler2Stage(host, opts = {}) {
  const PQ = new URLSearchParams(location.search), SHOT = PQ.has('shot'), DEBUG = PQ.has('debug') || SHOT;
  const renderer = createRenderer({ alpha: false });
  const canvas = renderer.domElement; canvas.className = 'spot-canvas'; canvas.setAttribute('aria-hidden', 'true'); canvas.style.touchAction = 'none';
  if (SHOT) { Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '99999' }); document.body.appendChild(canvas); } else host.prepend(canvas);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
  addRoomEnvironment(renderer, scene);
  scene.fog = new THREE.Fog(0xb4aa98, 20, 70);
  let disposed = false, visible = true, inset = false, ready = false, freeCam = false, bucket = '';
  let motion = opts.motion !== false, hourFn = opts.hour || (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }), weather = opts.weather || null;
  const tod = PQ.get('tod'); if (tod) hourFn = () => (TOD[tod] ?? +tod);
  const run = { state: PQ.get('run') || 'idle', paused: false };
  const loop = createLoop({ render: () => renderer.render(scene, camera), step: (dt, now) => stepFrame(dt, now), gate: () => visible, throttle: () => (inset ? 64 : 0) });
  const kick = () => loop.kick();
  const adpr = createAdaptiveDpr(renderer, loop, { max: Math.min(devicePixelRatio || 1, 1.75) });
  if (DEBUG) installPerf(loop);
  const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; kick(); };

  /* ---- textures and materials (Poly Haven, CC0: room/assets/LICENSES.md, spots/assets/butler/LICENSES.md) */
  const TXL = createTextures({ onLoad: shadowsDirty });
  const tex = (url, srgb) => TXL.tex(url, { srgb });
  const pbr = (base, id, o = {}) => new THREE.MeshStandardMaterial({ map: tex(new URL(id + '_diff.webp', base), true), normalMap: tex(new URL(id + '_nor.webp', base)), roughnessMap: tex(new URL(id + '_arm.webp', base)), aoMap: o.ao ? tex(new URL(id + '_arm.webp', base)) : null, roughness: o.r ?? 1, metalness: 0, color: o.color ?? 0xffffff, normalScale: new THREE.Vector2(o.n ?? 1, o.n ?? 1) });
  const M = {
    oakDark: pbr(BA, 'fine_grained_wood', { color: 0x6c4c2e }),
    oakMid: pbr(BA, 'fine_grained_wood', { color: 0x8c6640 }),
    leather: pbr(BA, 'brown_leather', { color: 0xffffff, n: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.3, metalness: 0.9 }),
    shade: new THREE.MeshStandardMaterial({ color: 0xf1e6cc, roughness: 0.9, emissive: 0xffd9a0, emissiveIntensity: 0.15, side: THREE.DoubleSide }),
    shadeIn: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 1.2, side: THREE.BackSide }),
    paper: new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.9 }),
    cover: new THREE.MeshStandardMaterial({ color: 0x24324a, roughness: 0.7 }),
    kraft: new THREE.MeshStandardMaterial({ color: 0x9a7350, roughness: 0.9 }),
    glass: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  };
  const uvScale = (g, k) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); return g; };
  function box(w, h, d, x, y, z, tile = 0.6) {        // a box with world-metric UVs (tile metres per texture repeat); y = bottom
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    g.translate(x, y + h / 2, z); return g;
  }
  const mesh = (geo, mat, cast = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; scene.add(m); return m; };
  const merged = (list, mat, cast, recv) => mesh(mergeGeometries(list.filter(Boolean)), mat, cast, recv);

  /* ---- the hall (butler2_hall.js): walls, windows, ceiling, cornice, chandeliers, floor, the bookcase band, doors, portraits, clock */
  const rigVols = [];                                 // camera collision: { name, kind, b: [x0,y0,z0,x1,y1,z1] }
  const solid = [];                                   // furniture AABBs for the walk-out check
  const hall = buildHall({ scene, M, box, mesh, merged, tex, ROOM, rigVols, solid });

  /* ---- ten tables (5 rows x both sides of the aisle): pale grey-beige tops with dark banding, dark wood bases; cream pleated lamps on brass bases */
  const TOP = TAB.top;
  M.topPale = new THREE.MeshStandardMaterial({ color: 0xbab2a2, roughness: 0.85, metalness: 0 });
  { const P = [], Q = [];
    for (const t of TABLES) { const { x0, x1, z0, z1, x, z } = t;
      P.push(box(TAB.L, 0.044, TAB.W, x, TOP - 0.05, z), box(TAB.L - 0.16, 0.1, TAB.W - 0.16, x, TOP - 0.15, z));
      Q.push(box(TAB.L - 0.07, 0.006, TAB.W - 0.07, x, TOP - 0.006, z));
      for (const lx of [x0 + 0.12, x1 - 0.12]) for (const lz of [z0 + 0.12, z1 - 0.12]) P.push(box(0.1, TOP - 0.15, 0.1, lx, 0, lz));
      P.push(box(TAB.L - 0.3, 0.06, 0.06, x, 0.12, z));
      rigVols.push({ name: 'table' + t.i, kind: 'table', b: [x0, 0, z0, x1, TOP, z1] }); solid.push({ name: 'table' + t.i, b: [x0, z0, x1, z1] }); }
    merged(P, M.oakDark, true, true); merged(Q, M.topPale, false, true); }
  const lampLights = [];
  const pleat = (rt, rb, h, n = 48, k = 24, a = 0.05) => { const g = new THREE.CylinderGeometry(rt, rb, h, n, 1, true), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), s = 1 + a * Math.cos(Math.atan2(z, x) * k); p.setX(i, x * s); p.setZ(i, z * s); } g.computeVertexNormals(); return g; };
  { const br = [], shG = [], shI = [], pools = [], SY = TOP + 0.44;        // cream pleated cone shades (top r 8.5 cm, bottom r 16 cm, 24 cm tall) on brass stems
    const cone = pleat(0.085, 0.16, 0.24), coneIn = new THREE.CylinderGeometry(0.083, 0.155, 0.24, 24, 1, true);
    for (const t of TABLES) for (const dx of LAMP_DX) { const lx = t.x + dx, lz = t.z;
      br.push(new THREE.CylinderGeometry(0.055, 0.07, 0.025, 16).translate(lx, TOP + 0.0125, lz), new THREE.CylinderGeometry(0.011, 0.015, 0.36, 8).translate(lx, TOP + 0.18, lz), new THREE.SphereGeometry(0.02, 8, 6).translate(lx, SY + 0.135, lz));
      shG.push(cone.clone().translate(lx, SY, lz)); shI.push(coneIn.clone().translate(lx, SY, lz));
      pools.push(new THREE.PlaneGeometry(1.0, 1.0).rotateX(-Math.PI / 2).translate(lx, TOP + 0.003, lz));
      if (t.i === 0 && dx >= 0) { const sp = new THREE.SpotLight(0xffd9a8, 1, 4.5, 1.2, 0.75, 2); sp.position.set(lx, SY - 0.06, lz); sp.target.position.set(lx, 0, lz); scene.add(sp, sp.target); lampLights.push(sp); } }
    merged(br, M.brass, true, true); mesh(mergeGeometries(shG), M.shade, false, false); mesh(mergeGeometries(shI), M.shadeIn, false, false);
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,210,150,1)'); gr.addColorStop(1, 'rgba(255,210,150,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    M.pool = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2 }); mesh(mergeGeometries(pools), M.pool, false, false); }

  /* ---- light: the sun through the 9 windows (shadowed), the sky fill from the window side, hemisphere fill, the chandeliers (butler2_hall.js), feathered shafts + motes */
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 80 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6); scene.add(hemi);
  const skyFill = new THREE.DirectionalLight(0xd6e4ff, 1); skyFill.position.set(X0 - 6, 7, 5); skyFill.target.position.set(0, 1, 5); scene.add(skyFill, skyFill.target);
  const shaftU = { uC: { value: new THREE.Color(0xfff0d6) }, uI: { value: 0.05 } };
  const shaft = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: shaftU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: 'attribute float k; attribute float e; attribute vec3 nn; varying float vK; varying float vY; varying float vE; varying float vF; void main(){ vK = k; vE = e; vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; vF = abs(dot(normalize(nn), normalize(cameraPosition - w.xyz))); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 uC; uniform float uI; varying float vK; varying float vY; varying float vE; varying float vF; void main(){ float a = uI * pow(1.0 - vK, 1.4) * smoothstep(0.0, 1.2, vY) * smoothstep(0.0, 0.7, vE) * smoothstep(0.04, 0.5, vF); gl_FragColor = vec4(uC * a, 1.0); }' }));
  shaft.frustumCulled = false; scene.add(shaft);
  const NM = 320, moteU = { uC: shaftU.uC, uI: { value: 0 }, uT: { value: 0 }, uPx: { value: 600 } };
  const motes = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ uniforms: moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'attribute float ph; uniform float uT, uPx; varying float vA; void main(){ vec3 p = position + vec3(sin(uT*0.11+ph)*0.18, sin(uT*0.07+ph*2.0)*0.12, cos(uT*0.09+ph*1.3)*0.18); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = uPx * 0.006 / -mv.z; vA = 0.55 + 0.45 * sin(uT * 0.8 + ph * 5.0); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uC; uniform float uI; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA * uI; gl_FragColor = vec4(uC * a, 1.0); }' }));
  motes.frustumCulled = false; scene.add(motes);
  function buildShaft(dir, len) {          // each window's rectangle swept along the sun; soft at the corners (e) and where a side is seen edge-on (nn)
    const pos = [], k = [], e = [], nn = [], n3 = new THREE.Vector3();
    for (const w of hall.windows) {
      const c = [[w.a, WIN.sill], [w.b, WIN.sill], [w.b, WIN.top], [w.a, WIN.top]].map(([z, y]) => new THREE.Vector3(X0, y, z));
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4], m = a.clone().lerp(b, 0.5); n3.subVectors(b, a).cross(dir).normalize();
        for (const [p, q, ep, eq] of [[a, m, 0, 1], [m, b, 1, 0]]) { const p2 = p.clone().addScaledVector(dir, len), q2 = q.clone().addScaledVector(dir, len);
          for (const [v, kk, ee] of [[p, 0, ep], [q, 0, eq], [q2, 1, eq], [p, 0, ep], [q2, 1, eq], [p2, 1, ep]]) { pos.push(v.x, v.y, v.z); k.push(kk); e.push(ee); nn.push(n3.x, n3.y, n3.z); } } } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('k', new THREE.Float32BufferAttribute(k, 1)); g.setAttribute('e', new THREE.Float32BufferAttribute(e, 1)); g.setAttribute('nn', new THREE.Float32BufferAttribute(nn, 3));
    shaft.geometry.dispose(); shaft.geometry = g;
    let s = 3; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647), mp = [], ph = [];
    for (let i = 0; i < NM; i++) { const w = hall.windows[1 + (i % 3)], u = w.a + R() * WIN.w, y = WIN.sill + R() * (WIN.top - WIN.sill), t = R() * len * 0.75; mp.push(X0 + dir.x * t, y + dir.y * t, u + dir.z * t); ph.push(R() * 6.283); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3)); mg.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 1));
    motes.geometry.dispose(); motes.geometry = mg;
  }
  let viewTex = null, hasReal = false;
  function setViewTex(t) { if (viewTex && viewTex !== t) viewTex.dispose(); viewTex = t; M.glass.map = t; M.glass.needsUpdate = true; kick(); }
  function applyLight(force) {
    const h = hourFn(), b = bucketOf(h); if (b === bucket && !force) return; bucket = b; const L = LIGHT[b], night = b === 'night';
    sun.visible = !night; sun.color.setHex(L.sun || 0); sun.intensity = L.sunI;
    const dir = new THREE.Vector3(Math.cos(L.el * D2R) * Math.cos(L.az * D2R), -Math.sin(L.el * D2R), Math.cos(L.el * D2R) * Math.sin(L.az * D2R)).normalize();
    sun.target.position.set(0, 3, 5); sun.position.copy(sun.target.position).addScaledVector(dir, -34);
    hemi.color.setHex(L.sky); hemi.groundColor.setHex(L.gnd); hemi.intensity = L.hemi; scene.environmentIntensity = L.env; renderer.toneMappingExposure = L.exp;
    skyFill.color.setHex(L.skyC); skyFill.intensity = L.skyI; hall.setLight({ night, ch: L.ch, ceil: L.ceil, halo: L.halo, down: L.down });
    scene.fog.color.setHex(L.fog); renderer.setClearColor(L.fog);
    for (const l of lampLights) l.intensity = L.lamp;
    M.shade.emissiveIntensity = night ? 0.7 : 0.15; if (M.pool) M.pool.opacity = night ? 0.8 : b === 'golden' ? 0.35 : 0.15; if (M.screen) M.screen.color.setScalar(night ? 1 : 0.8).multiply(new THREE.Color(0xb8cdee)); M.shadeIn.emissiveIntensity = night ? 2.2 : 1.0;
    shaftU.uC.value.setHex(b === 'golden' ? 0xffc27a : b === 'morning' ? 0xe4ecff : 0xfff0d6); shaftU.uI.value = L.shaft; shaft.visible = motes.visible = !night && L.shaft > 0;
    moteU.uI.value = motion ? (b === 'golden' ? 0.9 : 0.6) : 0;
    if (!night) buildShaft(dir, Math.min(16, (WIN.top - 0.2) / Math.max(0.15, -dir.y)));
    if (!hasReal) setViewTex(paintView('campus', lightAt(h, weatherAmounts(weather)), { seed: 7 }));
    M.glass.color.setScalar(night ? 0.55 : 1);
    shadowsDirty(); if (ready) realView();
  }
  /* Low Library + South Lawn painted into the window texture (docs/BUTLER-V2.md 13.3): the city render alone shows no dome from this height. The slice is centred on windows 5-6 (the far ones in the default frame),
     so the dome is in view from the default camera (windows nearest Hariv, down the hall). Shapes are drawn in texture space; u runs 0.72 -> 0.28 over the 9 windows. */
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  function paintDome(c) {
    const g = c.getContext('2d'), W = c.width, H = c.height, cx = 0.5 * W, base = 0.82 * H, night = bucket === 'night';
    const x0 = 0.25 * W, sw = 0.5 * W, hz = 0.64 * H, sr = mulberry(11);                                          // sky, distant skyline, soft trees: the view is mostly sky and campus, not a flat fill
    const sk = g.createLinearGradient(0, 0, 0, hz); if (night) { sk.addColorStop(0, '#05081a'); sk.addColorStop(1, '#101a36'); } else { sk.addColorStop(0, '#7fb0e0'); sk.addColorStop(0.7, '#b9d6ee'); sk.addColorStop(1, '#e6eef0'); }
    g.fillStyle = sk; g.fillRect(x0, 0, sw, hz + 2);
    if (!night) for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x0 + sr() * sw, 0.1 * H + sr() * 0.3 * H, 0.05 * W + sr() * 0.05 * W, 0.012 * H, 0, 0, 7); g.fill(); }
    for (let i = 0; i < 26; i++) { const bx = x0 + i * sw / 26, bh2 = (0.02 + sr() * 0.07) * H, bw2 = sw / 26 * (0.9 + sr() * 0.6); g.fillStyle = night ? '#0b1022' : (sr() < 0.5 ? '#9fa8b4' : '#b3a99c'); g.fillRect(bx, hz - bh2, bw2, bh2 + 2);
      if (night && sr() < 0.35) { g.fillStyle = '#f2cf85'; g.fillRect(bx + bw2 * 0.3, hz - bh2 * (0.2 + sr() * 0.6), 3, 4); } }
    const tg = g.createLinearGradient(0, hz - 0.02 * H, 0, base + 0.02 * H); tg.addColorStop(0, night ? '#0a1420' : '#6f9a64'); tg.addColorStop(1, night ? '#08101a' : '#8fb27a'); g.fillStyle = tg; g.fillRect(x0, hz, sw, base - hz + 0.02 * H);
    for (let i = 0; i < 90; i++) { const tx = x0 + sr() * sw, ty = hz + sr() * (base - hz) * 0.6; g.fillStyle = night ? 'rgba(10,22,24,0.9)' : (sr() < 0.5 ? 'rgba(86,126,78,0.85)' : 'rgba(112,150,92,0.8)'); g.beginPath(); g.arc(tx, ty, (0.012 + sr() * 0.014) * W, 0, 7); g.fill(); }
    const hg = g.createLinearGradient(0, 0, 0, base); hg.addColorStop(0, 'rgba(255,248,230,0)'); hg.addColorStop(1, night ? 'rgba(20,30,60,0.15)' : 'rgba(255,246,225,0.28)'); g.fillStyle = hg; g.fillRect(x0, 0, sw, base);   // daylight haze
    const lawn = g.createLinearGradient(0, base, 0, base + 0.3 * H); lawn.addColorStop(0, '#7fa268'); lawn.addColorStop(1, '#a9bf88');
    g.save(); g.beginPath(); g.rect(cx - 0.2 * W, base, 0.4 * W, 0.34 * H); g.clip(); g.fillStyle = lawn; g.fillRect(cx - 0.2 * W, base, 0.4 * W, 0.34 * H);
    g.fillStyle = 'rgba(220,214,196,0.9)'; g.beginPath(); g.moveTo(cx - 0.012 * W, base + 0.01 * H); g.lineTo(cx + 0.012 * W, base + 0.01 * H); g.lineTo(cx + 0.05 * W, base + 0.34 * H); g.lineTo(cx - 0.05 * W, base + 0.34 * H); g.fill(); g.restore();   // the central walk
    const stone = '#d6cfbc', shade = '#b9b19b', bw = 0.19 * W, bh = 0.045 * H;
    g.fillStyle = '#8c8570'; g.fillRect(cx - bw / 2 - 4, base - 0.006 * H, bw + 8, 0.01 * H);
    g.fillStyle = stone; g.fillRect(cx - bw / 2, base - bh, bw, bh);                                     // the long limestone body
    g.fillStyle = shade; for (let i = 0; i < 16; i++) g.fillRect(cx - bw / 2 + (i + 0.5) * bw / 16 - 1.5, base - bh * 0.92, 3, bh * 0.84);   // the portico columns
    g.fillStyle = stone; g.beginPath(); g.moveTo(cx - 0.05 * W, base - bh); g.lineTo(cx + 0.05 * W, base - bh); g.lineTo(cx, base - bh - 0.022 * H); g.fill();   // pediment
    const dr = 0.052 * W, dy = base - bh;                                                                    // drum, then the green-grey dome
    g.fillStyle = stone; g.fillRect(cx - dr, dy - 0.03 * H, 2 * dr, 0.03 * H); g.fillStyle = shade; for (let i = 0; i < 9; i++) g.fillRect(cx - dr + (i + 0.5) * 2 * dr / 9 - 1, dy - 0.028 * H, 2, 0.026 * H);
    const dg = g.createLinearGradient(cx - dr, 0, cx + dr, 0); dg.addColorStop(0, '#9dbfae'); dg.addColorStop(0.55, '#6f9a89'); dg.addColorStop(1, '#4f7a6b');
    g.fillStyle = dg; g.beginPath(); g.ellipse(cx, dy - 0.03 * H, dr * 0.98, 0.1 * H, 0, Math.PI, 0); g.fill();
    g.fillStyle = shade; g.fillRect(cx - 2, dy - 0.03 * H - 0.114 * H, 4, 0.016 * H);                           // lantern
    if (night) { g.fillStyle = 'rgba(8,12,24,0.45)'; g.fillRect(cx - 0.2 * W, base - 0.2 * H, 0.4 * W, 0.55 * H); }
  }
  // the real campus from Butler's windows (the construction cam's scene, as spots/index.js does), else the painted South Lawn
  let notables = null, viewBusy = false;
  async function realView() {
    if (!opts.realView || PQ.get('realview') === '0' || viewBusy) return; viewBusy = true;
    try {
      if (!notables) notables = await fetch(NOTABLES).then((r) => r.json()).then((j) => j.notables || []).catch(() => []);
      const a = notables.find((n) => n.id === 'butler-library'), b = notables.find((n) => n.id === 'low-library'); if (!a || !b) return;
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const cv = await opts.realView({ pos: [a.x + dx / l * 32, (a.baseY || 0) + 12, a.z + dz / l * 32], look: [b.x, (b.baseY || 0) + 14, b.z], width: 1024, height: 1024, fov: 55, hour: hourFn(), noTrees: true });
      if (!cv || disposed) return;
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0);
      paintDome(c); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; hasReal = true; setViewTex(t);
    } catch (e) { console.warn('butler2 view', e); } finally { viewBusy = false; }
  }

  /* ---- loading: chairs (instanced) + laptops, then Hariv, then one student per idle slot */
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const people = [], plans = {}, chairParts = [];
  let rig = null, chairInfo = null, lap = null, rig_yaw0 = 0, frameNo = 0;
  const idle = () => new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(r, { timeout: 600 }) : setTimeout(r, 30)));
  const SEAT = (id) => SEATS.find((q) => q.id === id);
  const cm4 = new THREE.Matrix4(), cq = new THREE.Quaternion(), cv3 = new THREE.Vector3(), cs3 = new THREE.Vector3(1, 1, 1), cY = new THREE.Vector3(0, 1, 0);
  function setChairD(s, d) {            // slide a chair straight back from its table by d metres
    s.d = d; cq.setFromAxisAngle(cY, s.yaw); cv3.set(s.x, 0, s.cz + s.bz * d); cs3.set(1, (s.sy || SEAT_TOP) / SEAT_TOP, 1); cm4.compose(cv3, cq, cs3);
    for (const p of chairParts) { p.im.setMatrixAt(s.ci, p.tmp.multiplyMatrices(cm4, p.local)); p.im.instanceMatrix.needsUpdate = true; }
    shadowsDirty();
  }
  function buildLaptops() {            // thin aluminium laptops, ~31 x 22 cm, 1.5 cm base, the screen open ~110 deg with a soft glow (3 instanced meshes)
    const W = 0.31, D = 0.22, Hb = 0.015, LH = 0.21, th = 20 * D2R;
    const lid = new THREE.BoxGeometry(W, LH, 0.008).translate(0, LH / 2, 0).rotateX(th).translate(0, Hb, D / 2), base = new THREE.BoxGeometry(W, Hb, D).translate(0, Hb / 2, 0);
    const keys = new THREE.PlaneGeometry(0.27, 0.1).rotateX(-Math.PI / 2).translate(0, Hb + 0.0004, -0.012);
    const scr = new THREE.PlaneGeometry(0.29, 0.188).rotateY(Math.PI).translate(0, LH / 2, -0.0042).rotateX(th).translate(0, Hb, D / 2);
    const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.34 }), kb = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.8 });
    M.screen = new THREE.MeshBasicMaterial({ color: 0xb8cdee });
    const mk = (g, m, cast) => { const im = new THREE.InstancedMesh(g, m, 16); im.count = 0; im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; };
    lap = { n: 0, ims: [mk(mergeGeometries([base, lid]), alu, true), mk(keys, kb, false), mk(scr, M.screen, false)] };
    M.alu = alu; M.kb = kb;
  }
  function addLaptop(x, z, yaw) { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, TOP, z), new THREE.Quaternion().setFromAxisAngle(cY, yaw), cs3); for (const im of lap.ims) { im.setMatrixAt(lap.n, m); im.count = lap.n + 1; im.instanceMatrix.needsUpdate = true; } lap.n++; shadowsDirty(); }
  function windsor(lb) {               // a dark Windsor captain's chair inside the fit box of the café chair (so the people_fit volumes and caches stay valid):
    const cx = (lb.min.x + lb.max.x) / 2, hw = Math.min(0.235, (lb.max.x - lb.min.x) / 2 - 0.01), z0 = lb.min.z + 0.02, z1 = lb.max.z - 0.02, top = Math.min(lb.max.y, 0.88), S = SEAT_TOP;
    const sd = Math.min(0.44, z1 - z0), sz = z1 - sd / 2, R0 = hw, rz = z0 + R0, G = [];   // saddle seat, 4 splayed legs + H stretcher, 9 spindles, a curved arm rail, a crest
    G.push(new THREE.CylinderGeometry(1, 1, 0.045, 24).scale(hw, 1, sd / 2).translate(cx, S - 0.0225, sz));
    const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz2]) => [[cx + sx * hw * 0.62, S - 0.045, sz + sz2 * sd * 0.32], [cx + sx * (hw * 0.62 + 0.05), 0, sz + sz2 * (sd * 0.32 + 0.05)]]);
    for (const [a, b] of legs) G.push(rod(a, b, 0.017, 0.022, 7));
    const at = (l, u) => l[0].map((v, i) => v + (l[1][i] - v) * u);
    G.push(rod(at(legs[0], 0.62), at(legs[2], 0.62), 0.011), rod(at(legs[1], 0.62), at(legs[3], 0.62), 0.011));
    const m0 = at([at(legs[0], 0.62), at(legs[2], 0.62)], 0.5), m1 = at([at(legs[1], 0.62), at(legs[3], 0.62)], 0.5); G.push(rod(m0, m1, 0.011));
    const RY = S + 0.22; G.push(new THREE.TorusGeometry(R0, 0.02, 6, 28, Math.PI).rotateX(-Math.PI / 2).translate(cx, RY, rz));
    for (const sx of [-1, 1]) G.push(rod([cx + sx * R0, RY, rz], [cx + sx * R0, RY, rz + 0.07], 0.02), rod([cx + sx * (R0 - 0.01), S, rz + 0.06], [cx + sx * R0, RY, rz + 0.06], 0.012));
    for (let i = 0; i < 9; i++) { const a = Math.PI * (0.12 + 0.76 * i / 8), x = Math.cos(a) * (R0 - 0.005), z = -Math.sin(a) * (R0 - 0.005), tall = i >= 3 && i <= 5;
      G.push(rod([cx + x * 0.92, S, rz + z * 0.92], [cx + x, tall ? top - 0.03 : RY, rz + z], 0.008, 0.01, 5)); }
    G.push(new THREE.TorusGeometry(R0, 0.026, 6, 12, Math.PI * 0.42).rotateX(-Math.PI / 2).rotateY(Math.PI * 0.29).translate(cx, top - 0.03, rz));
    return mergeGeometries(G);
  }
  async function loadFurniture() {
    const cg = await gl.loadAsync(new URL('bs/cafechair.glb', ROOM).href);
    const ch = cg.scene; ch.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(ch), rc = new THREE.Raycaster(new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y + 1, (bb.min.z + bb.max.z) / 2 + 0.06), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(ch, true).find((h) => h.point.y < bb.max.y * 0.75), seat0 = hit ? hit.point.y : bb.max.y * 0.5, k = SEAT_TOP / seat0;
    ch.scale.setScalar(k); ch.updateMatrixWorld(true);
    const lb = new THREE.Box3().setFromObject(ch);
    chairInfo = { lb, seatY: SEAT_TOP, top: lb.max.y, scale: k, seat0 };
    M.chair = new THREE.MeshStandardMaterial({ map: M.oakDark.map, normalMap: M.oakDark.normalMap, roughnessMap: M.oakDark.roughnessMap, color: 0x2a221c, roughness: 0.8 });   // black Windsor: very dark wood
    const im = new THREE.InstancedMesh(windsor(lb), M.chair, SEATS.length); im.castShadow = im.receiveShadow = true; im.frustumCulled = false; scene.add(im); chairParts.push({ im, local: new THREE.Matrix4(), tmp: new THREE.Matrix4() });
    for (const c of CAST) { const q = SEAT(c.seat); if (q && c.sy) q.sy = c.sy; }
    for (const s of SEATS) { setChairD(s, 0);
      const x0 = s.yaw === 0 ? s.x + lb.min.x : s.x - lb.max.x, x1 = s.yaw === 0 ? s.x + lb.max.x : s.x - lb.min.x, z0 = s.yaw === 0 ? s.cz + lb.min.z : s.cz - lb.max.z, z1 = s.yaw === 0 ? s.cz + lb.max.z : s.cz - lb.min.z;
      rigVols.push({ name: 'chair ' + s.id, kind: 'chair', b: [x0, 0, z0, x1, lb.max.y, z1] }); s.sol = { name: 'chair ' + s.id, seat: s.id, b: [x0, z0, x1, z1] }; solid.push(s.sol); }
    buildLaptops();
  }
  // Hariv's table: a closed notebook, a stack of 3 books, a paper coffee cup. Nothing in his hands. (The laptop is added with his seat.)
  const propVols = [];
  function harivProps(s) {
    const e = s.cz - 0.0 + (s.yaw === 0 ? 0.42 : -0.42), sg = s.yaw === 0 ? -1 : 1, x = s.x, P = [];          // e = the table edge on his side; props sit toward the table (sg flips x and z for the far side)
    const dz = (v) => e - sg * v;
    const nb = box(0.21, 0.014, 0.28, x - 0.4 * sg, TOP, dz(0.26)); P.push(['nb', nb, M.cover, [x - 0.4 * sg - 0.105, TOP, dz(0.4), x - 0.4 * sg + 0.105, TOP + 0.014, dz(0.12)].map((q, i) => q)]);
    const books = []; [[0.17, 0.035, 0.24, 0.08], [0.16, 0.03, 0.23, -0.12], [0.15, 0.04, 0.215, 0.2]].reduce((y, [w, h, d, r], i) => { const g = new THREE.BoxGeometry(w, h, d).rotateY(r).translate(x - 0.42 * sg, y + h / 2, dz(0.6)); books.push([g, [0x5a1e1a, 0x24413a, 0x6b4a2a][i]]); return y + h; }, TOP);
    for (const [g, c] of books) { const m = M.leather.clone(); m.color.setHex(c); mesh(g, m, true, true); }
    const box2 = (cx, cz, hw, hd, h) => [Math.min(cx - hw, cx + hw), TOP, Math.min(cz - hd, cz + hd), Math.max(cx - hw, cx + hw), TOP + h, Math.max(cz - hd, cz + hd)];
    propVols.push(box2(x - 0.42 * sg, dz(0.6), 0.1, 0.12, 0.105));
    const cx = x + 0.52 * sg, cz = dz(0.3);
    mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.03, 0), new THREE.Vector2(0.043, 0.105), new THREE.Vector2(0, 0.105)], 24).translate(cx, TOP, cz), M.paper, true, true);
    mesh(new THREE.CylinderGeometry(0.0425, 0.037, 0.04, 24, 1, true).translate(cx, TOP + 0.055, cz), M.kraft, false, true); mesh(new THREE.CylinderGeometry(0.046, 0.044, 0.012, 24).translate(cx, TOP + 0.111, cz), M.paper, true, true);
    propVols.push(box2(cx, cz, 0.05, 0.05, 0.12));
    for (const [, g, m, v] of P) { mesh(g, m, true, true); propVols.push([Math.min(v[0], v[3]), v[1], Math.min(v[2], v[5]), Math.max(v[0], v[3]), v[4], Math.max(v[2], v[5])]); }
  }
  function openPages(x, z, yaw, w = 0.42, d = 0.29) {    // an open notebook / book lying flat (two pages and a cover), rotated to face its reader
    const g = new THREE.Group(); g.position.set(x, TOP, z); g.rotation.y = yaw;
    const cv = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.004, d + 0.01).translate(0, 0.002, 0), M.cover), pg = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, d).translate(0, 0.007, 0), M.paper);
    cv.receiveShadow = pg.receiveShadow = true; pg.castShadow = true; g.add(cv, pg); scene.add(g); return g;
  }
  function fitVols(s, withProps, lift, syIn) {
    const lb = chairInfo.lb, t = s.tab, sy = syIn || s.sy || SEAT_TOP, topY = chairInfo.top * sy / SEAT_TOP;
    const item = { name: 'chair-' + s.id, vols: [[lb.min.x, sy - 0.3, lb.min.z, lb.max.x, sy, lb.max.z], [lb.min.x, sy, lb.min.z, lb.max.x, topY, lb.min.z + 0.12]], x: s.x, y: 0, z: s.cz, ry: s.yaw, tag: (b, i) => (i === 0 ? 'seat' : 'other') };
    const extra = [{ name: 'floor', kind: 'floor', b: [-40, -2, -40, 40, 0, 40] }, { name: 'desktop', kind: 'desktop', b: [t.x0, TOP - 0.05, t.z0, t.x1, TOP + lift, t.z1] },
      { name: 'apron', kind: 'other', b: [t.x0 + 0.08, TOP - 0.15, t.z0 + 0.08, t.x1 - 0.08, TOP - 0.05, t.z1 - 0.08] }];
    for (const x of [t.x0 + 0.12, t.x1 - 0.12]) for (const z of [t.z0 + 0.12, t.z1 - 0.12]) extra.push({ name: 'leg', kind: 'other', b: [x - 0.05, 0, z - 0.05, x + 0.05, TOP - 0.15, z + 0.05] });
    for (const dx of LAMP_DX) extra.push({ name: 'lamp', kind: 'other', b: [t.x + dx - 0.12, TOP, t.z - 0.12, t.x + dx + 0.12, TOP + 0.4, t.z + 0.12] });
    if (withProps) propVols.forEach((b, i) => extra.push({ name: 'prop' + i, kind: 'other', b }));
    return Fit.makeVols([item], extra);
  }
  // hands / forearms on the table: per frame, the lowest hand, finger or forearm point over the table's footprint, relative to the working surface
  const HG = new Set(['hand', 'finger', 'forearm'].map((g) => Fit.GROUPS.indexOf(g))), HM = new Set(['hand', 'finger'].map((g) => Fit.GROUPS.indexOf(g)));
  function handsOn(cloud, pl, t, ref) {
    const c = Math.cos(pl.yaw), s = Math.sin(pl.yaw), per = []; let mx = 0, mz = 0, mn = 0;
    for (const a of cloud.frames) { let m = 9; for (let i = 0; i < cloud.n; i++) { const g = cloud.grp[i]; if (!HG.has(g)) continue; const x = a[i * 3], z = a[i * 3 + 2], wx = pl.x + x * c + z * s, wz = pl.z - x * s + z * c, wy = pl.y + a[i * 3 + 1];
      if (HM.has(g)) { mx += wx; mz += wz; mn++; } if (wx > t.x0 && wx < t.x1 && wz > t.z0 && wz < t.z1) m = Math.min(m, wy - ref); } per.push(m); }
    per.sort((p, q) => p - q);
    return { median: per[per.length >> 1], min: per[0], max: per[per.length - 1], mid: [mx / Math.max(1, mn), mz / Math.max(1, mn)] };
  }
  const merge = (cl) => ({ ...cl[0], F: cl.reduce((t, c) => t + c.F, 0), frames: cl.flatMap((c) => c.frames) });
  const PG = new Set(['pelvis', 'thigh'].map((g) => Fit.GROUPS.indexOf(g)));
  async function clipNeeds(P, cast) {        // the clip's own heights with the feet on the floor: seat = lowest pelvis/thigh point, hands = lowest hand/finger point (medians over frames)
    const cmc = await cloudOfAsync(P, cast.clip, { frames: 24, stride: 4 }), ca = cast.alt ? await cloudOfAsync(P, cast.alt, { frames: 12, stride: 4 }) : null, seat = [], hand = [];
    for (const a of cmc.frames) { let sm = 9, hm = 9; for (let i = 0; i < cmc.n; i++) { const y = a[i * 3 + 1], g = cmc.grp[i]; if (PG.has(g)) sm = Math.min(sm, y); else if (HM.has(g)) hm = Math.min(hm, y); } seat.push(sm); hand.push(hm); }
    const med = (q) => q.sort((x, y) => x - y)[q.length >> 1];
    return { cm: cmc, ca, seat: med(seat) + 0.005, hands: med(hand) };
  }
  const LIFT = (cast) => (cast.clip === 'typing' ? 0.015 : 0.01);      // the laptop deck / the notebook, over the table top
  async function plan(P, cast, trial) {
    const s = SEAT(cast.seat), hv = cast.id === 'hariv', lift = LIFT(cast), sy = cast.sy || SEAT_TOP;
    const key = 'butler2.v6.' + cast.id + '.' + s.id + '.' + cast.clip + '+' + cast.alt + '.' + sy.toFixed(3) + '.' + (cast.dhR || 0.055) + '.' + chairInfo.seat0.toFixed(3);
    let pl = trial || PQ.get('fit') === 'fresh' ? null : Fit.cacheGet(key); const nd = pl ? null : await clipNeeds(P, cast);
    if (hv) harivProps(s);
    if (!pl) {
      const t0 = performance.now(), V = fitVols(s, hv, lift, sy);
      const sol = await solveFit(merge([nd.cm, nd.ca].filter(Boolean)), V, { x: s.x, y: 0, z: s.cz, yaw: s.yaw }, { range: 0.2, coarse: 0.04, dh: cast.dhR || 0.055, feetTol: cast.dhR || 0.055 }), rep = sol.report, hd = handsOn(nd.cm, sol.place, s.tab, TOP + lift);
      const seatRow = rep.rows.find((r) => r.kind === 'seat'), pen = rep.rows.filter((r) => r.kind !== 'seat' && r.kind !== 'desktop' && r.kind !== 'floor').reduce((m, r) => Math.max(m, r.penND, r.penD), 0);
      const fails = rep.rows.filter((r) => r.status === 'FAIL').map((r) => r.name + ' ' + r.note);
      pl = { place: sol.place, ok: rep.ok, seat: seatRow ? +(seatRow.contact * 100).toFixed(2) : null, seatPen: seatRow ? +(seatRow.penD * 100).toFixed(2) : null, deskPen: +((rep.rows.find((r) => r.kind === 'desktop') || { penD: 0 }).penD * 100).toFixed(2),
        pen: +(pen * 100).toFixed(2), hands: { median: +(hd.median * 100).toFixed(2), min: +(hd.min * 100).toFixed(2), max: +(hd.max * 100).toFixed(2) }, mid: hd.mid, offset: +(Math.hypot(sol.place.x - s.x, sol.place.z - s.cz) * 100).toFixed(1), dh: +(sol.dh * 100).toFixed(1), fails, ms: Math.round(performance.now() - t0),
        need: { seat: +nd.seat.toFixed(3), hands: +nd.hands.toFixed(3) } };
      if (!trial) Fit.cachePut(key, pl);
    }
    if (trial) return pl;
    plans[cast.id] = { ...pl, seatId: s.id };
    return pl;
  }
  async function addPerson(cast) {
    const P = await loadPerson(cast.file);
    const s = SEAT(cast.seat), pl = await plan(P, cast);
    P.root.position.set(pl.place.x, pl.place.y, pl.place.z); P.root.rotation.y = pl.place.yaw; P.root.updateMatrixWorld(true);
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    if (cast.clip === 'typing') addLaptop(pl.mid[0] + fx * 0.02, pl.mid[1] + fz * 0.02, s.yaw);
    else { openPages(pl.mid[0] + fx * 0.04, pl.mid[1] + fz * 0.04, s.yaw); if (cast.book) openPages(pl.mid[0] + Math.cos(s.yaw) * 0.42, pl.mid[1] - Math.sin(s.yaw) * 0.42 + fz * 0.02, s.yaw + 0.2, 0.3, 0.21); }
    const pp = { cast, P, seat: s, pl, t: 0, next: 0, clip: '', back: 0, free: null, off: null, q: null, step: null, away: false, busy: false, lod: 0, lodPairs: [], onBreak: false };
    // LOD: the lower mesh of each material (people/mixamo/students/ keep LOD0 + LOD1) replaces LOD0 beyond ~5 m
    const vis = []; P.body.traverse((n) => { if (n.isSkinnedMesh && n.visible) vis.push(n); });
    for (const h of P.hiddenLods) { const kk = h.material.name || h.material.uuid; pp.lodPairs.push([vis.find((v) => (v.material.name || v.material.uuid) === kk), h]); }
    scene.add(P.root); people.push(pp); setClip(pp, true); shadowsDirty();
    return pp;
  }
  /* feet down: the seated clips were captured on lower chairs or with raised feet, so after the seat fit the shoes hang 4-9 cm above the floor.
     Per person and seated clip the lowest vertex is measured once (raw clip pose); after every mixer update both thighs swing down about the hip's
     lateral axis (<= 8 deg, seated + not busy only), so the shoes reach the floor. The fit gate (people_fit) still scores the raw clip. */
  const FEET = new Set(['typing', 'writing', 'sit_idle']), fq = new THREE.Quaternion(), fp = new THREE.Quaternion(), fax = new THREE.Vector3(), fdn = new THREE.Vector3(0, -1, 0), fa = new THREE.Vector3(), fb = new THREE.Vector3();
  function measureDrop(pp) {
    if (disposed || pp.busy || pp.away || !FEET.has(pp.clip) || (pp.drop && pp.clip in pp.drop)) return;
    const P = pp.P; undoDrop(pp); P.update(0); P.root.updateMatrixWorld(true); let mn = 9;
    for (const n of P.meshes()) { const c = n.geometry.attributes.position.count; for (let i = 0; i < c; i += 3) { n.getVertexPosition(i, fa); fa.applyMatrix4(n.matrixWorld); if (fa.y < mn) mn = fa.y; } }
    const r = P.root.rotation.y, fx = Math.sin(r), fz = Math.cos(r); let d = 0;
    for (const sd of ['Left', 'Right']) { P.boneWorld(sd + 'UpLeg', fa); P.boneWorld(sd + 'Foot', fb); d += Math.max(0.25, (fb.x - fa.x) * fx + (fb.z - fa.z) * fz) / 2; }
    let th = Math.min(8 * D2R, Math.asin(Math.min(0.9, Math.max(0, mn - 0.004) / d)));
    (pp.drop = pp.drop || {})[pp.clip] = th; pp.dropGap = +(mn * 100).toFixed(1);
    for (let k = 0; k < 14 && th > 0; k++) {   // thighs into the front edge of the seat <= 1.3 cm: shrink the swing until they do not
      feetDown(pp); const e = edgeOf(pp); undoDrop(pp); pp.edge = +(e * 100).toFixed(2); if (e <= 0.013) break; th *= 0.9; pp.drop[pp.clip] = th; }
    kick();
  }
  const eq = new THREE.Vector3();
  function edgeOf(pp) {          // deepest skinned vertex (m) in the front 12 cm of the chair seat below its top: thighs into the front edge (docs/BUTLER-V2.md 13.1)
    const s = pp.seat, sy = s.sy || SEAT_TOP, lb = chairInfo.lb, c = Math.cos(s.yaw), sn = Math.sin(s.yaw); let mx = 0; pp.P.root.updateMatrixWorld(true);
    pp.P.body.traverse((n) => { if (!n.isSkinnedMesh || !n.visible) return; n.skeleton.update(); const k = n.geometry.attributes.position.count; for (let i = 0; i < k; i++) { n.getVertexPosition(i, eq); eq.applyMatrix4(n.matrixWorld);
      const dx = eq.x - s.x, dz = eq.z - (s.cz + s.bz * (s.d || 0)), lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (lz > lb.max.z - 0.14 && lz < lb.max.z - 0.02 && Math.abs(lx) < 0.235 && eq.y < sy && eq.y > sy - 0.12) mx = Math.max(mx, sy - eq.y); } });
    return mx;
  }
  function undoDrop(pp) {        // some retargeted clips carry no thigh track, so the mixer does not reset the thighs: restore last frame's base first
    if (!pp.legSet) return; for (const k in pp.legSet) { const b = pp.P.bones[k]; if (b && b.quaternion.equals(pp.legSet[k])) b.quaternion.copy(pp.legBase[k]); } pp.legSet = null;
  }
  function feetDown(pp) {
    undoDrop(pp); const th = pp.drop && pp.drop[pp.clip]; if (!th || pp.busy || pp.away) return;
    const r = pp.P.root.rotation.y; fax.set(Math.sin(r), 0, Math.cos(r)).cross(fdn).normalize(); fq.setFromAxisAngle(fax, th); pp.legSet = {}; pp.legBase = pp.legBase || {};
    for (const k of ['LeftUpLeg', 'RightUpLeg']) { const b = pp.P.bones[k]; if (!b || !b.parent) continue; b.parent.updateWorldMatrix(true, false); b.parent.getWorldQuaternion(fp);
      pp.legBase[k] = (pp.legBase[k] || new THREE.Quaternion()).copy(b.quaternion); b.quaternion.premultiply(fp.clone().invert().multiply(fq).multiply(fp)); pp.legSet[k] = b.quaternion.clone(); }
  }
  function setLod(pp, l) { if (l === pp.lod || !pp.lodPairs.length) return; pp.lod = l; for (const [a, b] of pp.lodPairs) { if (a) a.visible = !l; b.visible = !!l; } }
  function setClip(pp, first) {
    let want;
    if (pp.cast.id === 'hariv') want = run.state === 'work' && !run.paused ? pp.cast.clip : 'sit_idle';
    else { want = pp.clip === pp.cast.clip && !first ? pp.cast.alt || pp.cast.clip : pp.cast.clip; pp.next = want === pp.cast.alt ? 6 + Math.random() * 6 : 25 + Math.random() * 45; pp.t = 0; }
    if (want !== pp.clip) { pp.P.play(want, { fade: first ? 0 : 0.4, at: first ? 'random' : 0 }); pp.clip = want; }
    if (FEET.has(want) && !(pp.drop && want in pp.drop)) setTimeout(() => measureDrop(pp), first ? 300 : 1200);
  }

  /* ---- animation sequences: Hariv's break (Sit To Stand -> stretch -> Stand To Sit) and a student's walk-out / arrival through the central aisle */
  const STAND_BACK = 0.3, CHAIR_K = 1.8, WALK_V = 1.25, ease = (u) => u * u * (3 - 2 * u), rnd = (a, b) => a + Math.random() * (b - a);
  function applyRoot(pp) { const r = pp.P.root, pl = pp.pl; if (pp.free) r.position.set(pp.free.x, pl.place.y, pp.free.z); else r.position.set(pl.place.x, pl.place.y, pl.place.z + pp.seat.bz * pp.back); }
  function setBack(pp, b) { pp.back = b; setChairD(pp.seat, b * CHAIR_K); applyRoot(pp); }
  function enqueue(pp, steps, after) { pp.q = steps; pp.qi = -1; pp.after = after || null; pp.busy = true; nextStep(pp); }
  function nextStep(pp) {
    pp.qi++; const st = pp.q && pp.q[pp.qi];
    if (!st) { pp.q = null; pp.step = null; pp.busy = false; if (pp.after) pp.after(pp); return; }
    pp.step = st; pp.t0 = 0; if (st.fn) st.fn(pp);
    if (st.clip) { pp.P.play(st.clip, { once: !!st.once, restart: true, fade: st.fade ?? 0.25 }); pp.clip = st.clip; }
  }
  function tickStep(pp, dt) {
    const st = pp.step; if (!st) return; pp.t0 += dt;
    if (st.wp) {                      // follow the waypoints at walking speed, turning toward the heading
      let mv = WALK_V * dt; const r = pp.P.root;
      while (mv > 1e-6 && pp.wi < st.wp.length) { const [tx, tz] = st.wp[pp.wi], dx = tx - pp.free.x, dz = tz - pp.free.z, d = Math.hypot(dx, dz);
        if (d > 0.02) { const h = Math.atan2(dx, dz); let dy = h - r.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.rotation.y += dy * Math.min(1, dt * 7); }
        if (d <= mv) { pp.free.x = tx; pp.free.z = tz; mv -= d; pp.wi++; } else { pp.free.x += dx / d * mv; pp.free.z += dz / d * mv; mv = 0; } }
      applyRoot(pp); if (pp.wi >= st.wp.length) { if (st.end) st.end(pp); nextStep(pp); }
    } else {
      const u = Math.min(1, pp.t0 / st.dur); if (st.upd) st.upd(pp, u);
      if (pp.t0 >= st.dur) { if (st.end) st.end(pp); nextStep(pp); }
    }
  }
  function standOff(pp) { const h = pp.P.boneWorld('Hips', cv3), r = pp.P.root.position; pp.off = { x: h.x - r.x, z: h.z - r.z }; pp.free = { x: r.x + pp.off.x, z: r.z + pp.off.z }; pp.P.root.position.set(pp.free.x, pp.pl.place.y, pp.free.z); }
  const standUp = (pp) => ({ clip: 'sit_to_stand', once: true, dur: pp.P.clipDuration('sit_to_stand'), fade: 0.3, upd: (p, u) => setBack(p, STAND_BACK * ease(Math.min(1, u / 0.7))), end: (p) => { p.back = STAND_BACK; standOff(p); } });
  const sitDown = (pp) => ({ clip: 'stand_to_sit', once: true, dur: pp.P.clipDuration('stand_to_sit'), fade: 0.25, fn: (p) => { p.free = null; p.P.root.rotation.y = p.pl.place.yaw; p.back = STAND_BACK; applyRoot(p); },
    upd: (p, u) => setBack(p, STAND_BACK * (1 - ease(Math.max(0, (u - 0.3) / 0.7)))), end: (p) => { p.back = 0; setBack(p, 0); } });
  const aisleX = 0;
  function pathOut(s, A) {            // waypoints after standing: sidestep through the gap toward the aisle, out behind the chair row, along the lane to the aisle, down the aisle to the end door
    const g = s.tab.gap, bx = s.x + g * 0.5, zb = s.cz + s.bz * 0.83;
    return [[bx, s.cz + s.bz * 0.05], [bx, zb], [aisleX, zb], [aisleX, Z1 - 1.0]];
  }
  function breakNow() {
    const pp = people.find((p) => p.cast.id === 'hariv'); if (!pp || pp.busy) return false; pp.onBreak = true;
    const stretch = ['arm_stretch', 'neck_stretch', 'yawn'][(Math.random() * 3) | 0];
    enqueue(pp, [standUp(pp), { clip: stretch, dur: Math.min(7, Math.max(4, pp.P.clipDuration(stretch))), fade: 0.3, fn: (p) => { p.P.root.position.set(p.free.x, p.pl.place.y, p.free.z); } }, sitDown(pp)], (p) => { p.onBreak = false; p.clip = ''; setClip(p, true); });
    return true;
  }
  function leave(id) {
    const pp = people.find((p) => p.cast.id === id); if (!pp || pp.busy || pp.away || id === 'hariv') return false; const s = pp.seat;
    enqueue(pp, [standUp(pp), { clip: 'walk', wp: pathOut(s), fn: (p) => { p.wi = 0; } }], (p) => { p.away = true; p.P.root.visible = false; p.clip = ''; p.free = null; });
    return true;
  }
  function arrive(id) {
    const pp = people.find((p) => p.cast.id === id); if (!pp || pp.busy || !pp.away) return false; const s = pp.seat, pl = pp.pl, out = pathOut(s), r = pp.P.root;
    const A = [pl.place.x + pp.off.x, pl.place.z + s.bz * STAND_BACK + pp.off.z], wp = [...out.slice().reverse(), A];
    pp.away = false; r.visible = true; pp.free = { x: aisleX, z: Z1 - 0.6 }; r.rotation.y = Math.PI; applyRoot(pp);
    enqueue(pp, [{ clip: 'walk', wp: wp.slice(1), fn: (p) => { p.wi = 0; p.back = STAND_BACK; } }, sitDown(pp)], (p) => { p.clip = ''; setClip(p, true); });
    return true;
  }
  const sched = { next: rnd(180, 360), arriveAt: 0, who: null, fast: false };
  function schedule(dt) {
    if (sched.who) { sched.arriveAt -= dt; if (sched.arriveAt <= 0) { if (arrive(sched.who)) sched.who = null; else sched.arriveAt = 3; } return; }
    sched.next -= dt; if (sched.next > 0) return;
    const c = people.filter((p) => p.cast.id !== 'hariv' && !p.busy && !p.away); if (!c.length) { sched.next = 10; return; }
    const w = c[(Math.random() * c.length) | 0]; if (leave(w.cast.id)) { sched.who = w.cast.id; sched.arriveAt = sched.fast ? 25 : rnd(60, 110); sched.next = sched.fast ? 40 : rnd(180, 360); }
  }
  async function warm() {              // retarget the clips the sequences need, one per idle slot (a clip costs ~50 ms)
    for (const pp of people) for (const c of pp.cast.id === 'hariv' ? ['sit_to_stand', 'arm_stretch', 'neck_stretch', 'yawn', 'stand_to_sit'] : ['sit_to_stand', 'walk', 'stand_to_sit']) { await idle(); if (disposed) return; try { pp.P.clipDuration(c); } catch (e) { console.warn('butler2 warm', c, e.message); } }
  }
  async function load() {
    setTol(0.025);
    applyLight(true);
    await loadFurniture();
    const hv = await addPerson(CAST[0]);
    rig = createRig({ THREE, camera, canvas, vols: rigVols, dividers: [], bounds: { X0, X1, Z0, Z1 }, RH: H, person: hv.P, motion: () => motion, kick,
      opt: { PITCH0: -14 * D2R, PMIN: -30 * D2R, PMAX: 35 * D2R, ARM0: 1.9, ARM_MIN: 1.0, ARM_MAX: 4.0, EYE: 1.22, CEIL: H - 0.6, yawRange: 150 * D2R } });
    rig.enable(true); rig_yaw0 = rig.yaw / D2R; rig.setLook(rig_yaw0 + LOOK0[0], LOOK0[1]); resize(); ready = true; host.dataset.spot = 'butler'; host.classList.add('is-3d'); kick();   // is-3d hides the 2D art (style.css .spotstage.is-3d)
    for (const c of CAST.slice(1)) { await idle(); if (disposed) return; await addPerson(c); kick(); }
    ready = 'all'; setTimeout(() => { if (!disposed) realView(); }, 4000); warm();
  }

  /* ---- the frame: render while anyone moves (they always do with motion on); 15 fps as a picture-in-picture */
  function stepFrame(dt, now) {
    let busy = rig && !freeCam ? rig.update(dt) : false;
    if (motion) {
      for (const pp of people) { if (pp.away) continue; pp.P.update(dt); feetDown(pp);
        if (pp.busy) tickStep(pp, dt); else if (pp.cast.id !== 'hariv') { pp.t += dt; if (pp.t > pp.next) setClip(pp); } }
      if (ready === 'all') schedule(dt);
      moteU.uT.value = now / 1000; busy = busy || people.length > 0;
    }
    if (++frameNo % 10 === 0) for (const pp of people) { if (pp.away) continue; const d = camera.position.distanceTo(pp.P.root.position); setLod(pp, d > 5.5 ? 1 : d < 4.5 ? 0 : pp.lod); }
    return busy;
  }
  function resize() {
    const w = SHOT ? innerWidth : host.clientWidth, h = SHOT ? innerHeight : host.clientHeight; if (!w || !h) return;
    adpr.setMax(Math.min(devicePixelRatio || 1, inset ? 1 : w * h > 1.3e6 ? 1.5 : 1.75));
    const dpr = adpr.ratio; sizeTo(renderer, camera, w, h, dpr);
    moteU.uPx.value = hall.haloU.uPx.value = (h * dpr) / (2 * Math.tan((camera.fov * D2R) / 2)); if (rig && !freeCam) rig.snap(); kick();
  }
  const ro = new ResizeObserver(resize); ro.observe(SHOT ? document.body : host);
  const io = new IntersectionObserver(([en]) => { visible = SHOT || en.isIntersecting; if (visible) kick(); }); io.observe(host);
  const lightTimer = setInterval(() => { applyLight(false); hall.tickClock(); kick(); }, 60000);

  /* ---- checks (docs/BUTLER-V2.md 8): numbers measured from the live scene */
  function walkOut() {             // stand up, sidestep through the gap, out behind the chair row, along the lane, down the aisle to the door; body radius 0.25 m
    const out = [];
    for (const c of CAST.slice(1)) {
      const s = SEAT(c.seat), pts = [[s.x, s.cz + s.bz * 0.05], ...pathOut(s)];
      let min = 9, at = '';
      for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05);
        for (let j = 0; j <= n; j++) { const x = ax + (bx - ax) * j / n, z = az + (bz - az) * j / n;
          for (const o of solid) { if (o.seat === s.id) continue; const dx = Math.max(o.b[0] - x, 0, x - o.b[2]), dz = Math.max(o.b[1] - z, 0, z - o.b[3]), d = Math.hypot(dx, dz) - 0.25; if (d < min) { min = d; at = o.name; } }
          const dw = Math.min(x - X0, X1 - x, z - Z0, Z1 - z) - 0.25; if (dw < min) { min = dw; at = 'wall'; } } }
      out.push({ id: c.id, min: +min.toFixed(3), at, ok: min >= 0 });
    }
    return out;
  }
  function fitText() {
    const L = [];
    for (const c of CAST) { const p = plans[c.id]; if (!p) { L.push('MISSING ' + c.id); continue; }
      const handOk = p.hands.median >= -2.5 && p.hands.median <= 2.5 && p.hands.min >= -2.5, seatOk = p.seat != null && Math.abs(p.seat) <= 2.5, penOk = p.pen <= 1.0 && p.deskPen <= 2.5;
      L.push((p.ok && seatOk && handOk && penOk ? 'PASS' : 'FAIL') + ' seat ' + p.seatId + ' ' + c.name + ' (' + c.clip + '+' + c.alt + '; chair ' + (c.sy || SEAT_TOP) + ', table 0.74, clip wants seat ' + p.need.seat + ' hands ' + p.need.hands + '; height shift ' + p.dh + ' cm): seat contact ' + p.seat + ' cm (pen ' + p.seatPen + '), hands/forearms over the surface: median ' + p.hands.median + ' cm, min ' + p.hands.min + ', max ' + p.hands.max + '; other pen ' + p.pen + ' cm; desk pen ' + p.deskPen + ' cm; moved ' + p.offset + ' cm' + (p.fails.length ? '; FAILS: ' + p.fails.join(', ') : '') + (p.ms ? '; solved in ' + p.ms + ' ms' : '; from cache')); }
    for (const w of walkOut()) L.push((w.ok ? 'PASS' : 'FAIL') + ' walk-out ' + w.id + ': min clearance ' + w.min + ' m (nearest ' + w.at + ')');
    return L.join('\n');
  }
  const v = new THREE.Vector3();
  function live() {                // bone world positions after mixer.update (wrist joints, so a resting hand reads ~2-4 cm above the surface)
    return people.map((pp) => { const P = pp.P, r = (k) => +(P.boneWorld(k, v).y).toFixed(3);
      return { id: pp.cast.id, clip: pp.clip, hipsY: r('Hips'), lHandY: r('LeftHand'), rHandY: r('RightHand'), lFootY: r('LeftFoot'), rFootY: r('RightFoot'), top: TOP, seat: SEAT_TOP }; });
  }
  function headTrack() {           // 11.7: every writer's head height above the table over 3 s of the clip (Head joint; eyes ~8 cm higher). Advances the animation clock.
    return people.filter((pp) => pp.cast.clip === 'writing' && !pp.busy && !pp.away).map((pp) => { let mn = 9, mx = 0; for (let i = 0; i < 30; i++) { pp.P.update(0.1); pp.P.root.updateMatrixWorld(true); const y = pp.P.boneWorld('Head', v).y - TOP; mn = Math.min(mn, y); mx = Math.max(mx, y); }
      return { id: pp.cast.id, clip: pp.clip, headMin: +mn.toFixed(3), headMax: +mx.toFixed(3), eyeMin: +(mn + 0.08).toFixed(3), ok: mn + 0.08 >= 0.30 }; });
  }
  function sweep() {
    const rows = []; let bad = 0;
    for (const p of [-30, 0, 35]) for (let y = -150; y <= 150; y += 10) { rig.setLook(y + rig_yaw0, p); const r = rig.report(); if (!r.inRoom || r.inWall || r.inFurniture) bad++; rows.push(r); }
    rig.setLook(rig_yaw0 + LOOK0[0], LOOK0[1]);
    return { frames: rows.length, bad, minWall: Math.min(...rows.map((r) => r.minWall)), arms: [Math.min(...rows.map((r) => r.arm)), Math.max(...rows.map((r) => r.arm))], yawSpan: [Math.min(...rows.map((r) => r.yawDeg)), Math.max(...rows.map((r) => r.yawDeg))] };
  }
  function info() {
    renderer.render(scene, camera); const ri = renderer.info.render; let tris = 0, ppl = 0;
    scene.traverseVisible((n) => { if (n.isMesh) { const g = n.geometry, c = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (n.isInstancedMesh ? n.count : 1); tris += c; if (n.isSkinnedMesh) ppl += c; } });
    return { ready, bucket, drawCalls: ri.calls, drawnTris: ri.triangles, sceneTris: Math.round(tris), peopleTris: Math.round(ppl), people: people.length, lods: people.map((p) => p.cast.id + ':' + p.lod).join(' '), frames, textures: renderer.info.memory.textures };
  }
  const api = {
    get ready() { return ready; }, info, fitText, live, walkOut, sweep, headTrack, breakNow, leave, arrive, fast(on = true) { sched.fast = on; sched.next = on ? 5 : rnd(180, 360); },
    freeze() { motion = false; moteU.uI.value = 0; moteU.uT.value = 1; for (const pp of people) { pp.P.still(pp.clip || pp.cast.clip, 0); feetDown(pp); } renderer.shadowMap.needsUpdate = true; kick(); },
    setTod(t) { hourFn = () => (TOD[t] ?? +t); applyLight(true); },
    setLook(y, p) { freeCam = false; rig.setLook(y + rig_yaw0, p); kick(); }, cam: () => rig.report(),
    free(pos, look, fov = 50) { freeCam = true; camera.fov = fov; camera.updateProjectionMatrix(); camera.rotation.order = 'XYZ'; camera.position.set(...pos); camera.lookAt(...look); kick(); },
    inside() { freeCam = false; camera.rotation.order = 'YXZ'; camera.fov = 60; camera.updateProjectionMatrix(); rig.snap(); kick(); },
    floorGap() {                   // the lowest skinned vertex of each seated person (cm above the floor): shows whether any feet float
      const v3 = new THREE.Vector3(); return people.filter((pp) => !pp.away).map((pp) => { pp.P.root.updateMatrixWorld(true); let mn = 9;
        pp.P.body.traverse((n) => { if (!n.isSkinnedMesh || !n.visible) return; const c = n.geometry.attributes.position.count; for (let i = 0; i < c; i += 2) { n.getVertexPosition(i, v3); v3.applyMatrix4(n.matrixWorld); if (v3.y < mn) mn = v3.y; } });
        return { id: pp.cast.id, clip: pp.clip, minY: +(mn * 100).toFixed(1), rawGap: pp.dropGap, thighDeg: pp.drop && pp.drop[pp.clip] ? +(pp.drop[pp.clip] / D2R).toFixed(1) : 0, lift: +(pp.P.root.position.y * 100).toFixed(1) }; }); },
    async trial(id, clip, sy, alt, dhR) {     // fit search: solve one person with a clip and a chair height, uncached (does not change the scene)
      const pp = people.find((p) => p.cast.id === id), c = { ...pp.cast, clip, alt: alt === undefined ? null : alt, sy, dhR }, l0 = pp.lod; setLod(pp, 0); const pl = await plan(pp.P, c, true); setLod(pp, l0);
      const ok = pl.ok && pl.seat != null && Math.abs(pl.seat) <= 2.5 && pl.hands.median >= -2.5 && pl.hands.median <= 2.5 && pl.hands.min >= -2.5 && pl.pen <= 1 && pl.deskPen <= 2.5;
      return { id, clip, sy, ok, seat: pl.seat, hm: pl.hands.median, hmin: pl.hands.min, pen: pl.pen, desk: pl.deskPen, dh: pl.dh, fails: pl.fails, need: pl.need };
    },
    async explore(id, clip, sy, dhR, thDeg) {   // search tool: refit one person with a clip / chair height, run the feet-down swing, report the gate + edge + feet (changes the scene)
      const pp = people.find((p) => p.cast.id === id), c = pp.cast, s = pp.seat; setLod(pp, 0); Object.assign(c, { clip, alt: null, sy, dhR }); s.sy = sy; setChairD(s, 0);
      const pl = await plan(pp.P, c, true); pp.pl = pl; applyRoot(pp); pp.P.play(clip, { fade: 0, at: 0 }); pp.clip = clip; undoDrop(pp); pp.drop = {}; pp.legSet = null; measureDrop(pp); if (thDeg != null) pp.drop[clip] = thDeg * D2R; pp.P.update(0); feetDown(pp);
      pp.P.root.updateMatrixWorld(true); let mn = 9; pp.P.body.traverse((n) => { if (!n.isSkinnedMesh || !n.visible) return; n.skeleton.update(); const k = n.geometry.attributes.position.count; for (let i = 0; i < k; i += 2) { n.getVertexPosition(i, eq); eq.applyMatrix4(n.matrixWorld); if (eq.y < mn) mn = eq.y; } });
      const ok = pl.ok && pl.seat != null && Math.abs(pl.seat) <= 2.5 && pl.hands.median >= -2.5 && pl.hands.median <= 2.5 && pl.hands.min >= -2.5 && pl.pen <= 1 && pl.deskPen <= 2.5;
      return { id, clip, sy, dhR, ok, seat: pl.seat, hm: pl.hands.median, hmin: pl.hands.min, desk: pl.deskPen, dh: pl.dh, edge: +(edgeOf(pp) * 100).toFixed(2), feet: +(mn * 100).toFixed(1), thigh: pp.drop[clip] ? +(pp.drop[clip] / D2R).toFixed(1) : 0 };
    },
    edgePen() { return people.filter((pp) => !pp.away).map((pp) => ({ id: pp.cast.id, clip: pp.clip, sy: pp.seat.sy || SEAT_TOP, edge: +(edgeOf(pp) * 100).toFixed(2) })); },   // thighs into the chair's front edge (cm), with the feet-down swing applied
    people: () => people.map((p) => ({ id: p.cast.id, clip: p.clip, away: p.away, busy: p.busy, lod: p.lod, pos: p.P.root.position.toArray().map((q) => +q.toFixed(3)), yaw: +p.P.root.rotation.y.toFixed(3) })),
  };
  if (DEBUG) window.__butler2 = api;
  const t0 = 0;
  resize();
  load().catch((e) => { console.warn('butler2', e); if (!disposed && opts.onFail) opts.onFail(e); });

  return {
    spotId: 'butler', spot: { title: 'Butler Library' }, renderer, scene, camera, isButler2: true,
    setSpot() { /* spots/index.js swaps stages for other spots */ },
    setRun(r = {}) { const st = r.state || 'idle', was = run.state; if (st === run.state && !!r.paused === run.paused) return; run.state = st; run.paused = !!r.paused; const hv = people.find((p) => p.cast.id === 'hariv');
      if (hv && st === 'break' && was !== 'break' && ready === 'all') breakNow(); else if (hv && !hv.busy) setClip(hv); kick(); },
    setOutfit() { /* Hariv wears the Columbia sweatshirt here */ },
    setWeather(w) { weather = w || null; },
    setMotion(on) { motion = !!on; moteU.uI.value = motion && bucket !== 'night' ? 0.6 : 0; kick(); },
    setHourFn(fn) { if (typeof fn === 'function' && !tod) { hourFn = fn; applyLight(false); } },
    setInset(on) { inset = !!on; resize(); },
    pause(p) { loop.pause(p); },
    invalidate: kick, resize,
    describe() { const n = Math.max(0, people.length - 1); return 'Butler Library reading room. ' + (run.state === 'work' ? 'You are typing at a long table by the window, next to the aisle.' : 'Your seat by the window is waiting.') + (n ? ' ' + n + ' other students are here.' : ''); },
    stats() { const i = info(); return { spot: 'butler', v: 2, calls: i.drawCalls, tris: i.drawnTris, light: bucket, state: run.state, inset, motion }; },
    renderNow() { loop.renderNow(); },
    dispose() {
      disposed = true; loop.dispose(); TXL.dispose(); clearInterval(lightTimer); clearInterval(t0); ro.disconnect(); io.disconnect(); setTol(0.015);
      if (rig) rig.dispose(); for (const pp of people) pp.P.dispose();
      scene.traverse((n) => { if (n.geometry) n.geometry.dispose(); }); for (const m of Object.values(M)) { m.dispose(); }
      renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* fine */ } canvas.remove(); if (window.__butler2 === api) delete window.__butler2;
    },
  };
}
