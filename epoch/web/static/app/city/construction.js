// city/construction.js · the construction cam. While a Pomodoro work block runs, a tower crane and scaffolding stand on today's
// lot and the new floors rise with the clock. During a break the crane is parked. When the block is rated a last beam is
// lifted into place with a little tree and a flag ("topping out"), the windows light up and the site is cleared.
//
//   set({active, phase, progress, floors | minutes, remaining, duration})   see DOM_CONTRACT.md (3D section)
//   toppingOut()                                                             run the ceremony now
//
// Cheap: the rising block is rebuilt (a few hundred vertices) only when it grew by a few millimetres, everything else is a
// handful of transforms. Reduced motion: the pose is static, no swinging, no smoothing, no sparks.
import * as THREE from 'three';
import { Geo, rgb, shade, clamp, smooth, KIND, rng, TAU } from './util.js';
import { createCityMaterial, FLOOR_H } from './shader.js';
import { LOT_D } from './towers.js';
import { MS, hdr } from './palette.js';

const BEACON = hdr(MS.accent, 2.6);
const seg = (t, a, b) => smooth(clamp((t - a) / (b - a), 0, 1));
const MIN_PER_FLOOR = 15;
const CYCLE = 18;
// crane position on the back sidewalk of the lot (lot-local), the beam pile, and the site cabin
const CR = { x: 0.56, z: -1.12 }, PILE = { x: -0.64, z: -1.12 }, CAB = { x: -0.06, z: -1.1 };

function addTree(g, cx, y0, s = 1) {
  const c = rgb('#3f9570');
  g.cyl(cx, 0, y0, y0 + 0.07 * s, 0.07 * s, 0.0, 6, c); g.cyl(cx, 0, y0 + 0.045 * s, y0 + 0.13 * s, 0.055 * s, 0.0, 6, shade(c, 1.15)); g.cyl(cx, 0, y0 + 0.1 * s, y0 + 0.19 * s, 0.04 * s, 0.0, 6, c);
}
function hookGeo() { const g = new Geo(); g.bar([0, 0, 0], [0, -1, 0], 0.012, rgb(MS.dark)); return g.build(); }

function makeCloth(w, h, cols, rows, colorAt) {
  const n = (cols + 1) * (rows + 1), pos = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { const k = j * (cols + 1) + i, c = colorAt(i / cols, j / rows); col.set(c, k * 3); }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x0a1424 }));
  mesh.frustumCulled = false;
  function update(t, amp = 1) {
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols, k = (j * (cols + 1) + i) * 3, f = u * u;
      pos[k] = u * w; pos[k + 1] = -j / rows * h + Math.sin(t * 5 + u * 5) * 0.012 * f * amp; pos[k + 2] = Math.sin(t * 4.2 + u * 6.5 + j * 0.4) * 0.03 * f * amp;
    }
    g.attributes.position.needsUpdate = true;
  }
  update(0, 0);
  return { mesh, update };
}

// `place(lot)` puts the site where the lot is: the diorama stands the lots in the scene, the real-Manhattan block (mh_home.js) stands
// each lot in its own scaled, turned frame, so there the site is parented to that frame (the lot passed in then has x = z = 0).
export function createConstruction({ scene, shared, getToday, radial, setPool, wake = () => {}, place = null }) {
  const root = new THREE.Group(); root.name = 'construction'; root.visible = false; scene.add(root);
  const putRoot = place ? (lot) => place(root, lot) : (lot) => root.position.set(lot.x, 0, lot.z);
  const craneG = new THREE.Group(), bodyG = new THREE.Group(); root.add(craneG, bodyG);
  const { mat: craneMat } = createCityMaterial(shared, { ao: 0 });
  const { mat: bodyMat, U: bodyU } = createCityMaterial(shared, { litP: 0.1, pitch: 0.2, fill: [0.9, 0.58], glass: 1, seed: 21, ao: 0.18, emis: 0.8 });
  // Morningside: a Columbia-blue tower crane (the reward colour), slate counterweights, limestone precast
  const yel = rgb(MS.accent), grey = rgb(MS.slate), dark = rgb(MS.dark), precast = rgb('#d9cdb2');

  /* ---- site cabin and the beam pile (static) ---- */
  const siteG = new Geo();
  siteG.box(CAB.x - 0.17, 0.0, CAB.z - 0.08, CAB.x + 0.17, 0.15, CAB.z + 0.08, rgb('#ece6da'), { ctop: rgb('#c9c0ae') });
  siteG.box(CAB.x - 0.14, 0.05, CAB.z + 0.08, CAB.x - 0.02, 0.12, CAB.z + 0.086, rgb('#ffe3a0'), { kind: KIND.glow, top: false, sides: 1 });
  siteG.box(CAB.x + 0.03, 0.0, CAB.z + 0.08, CAB.x + 0.1, 0.1, CAB.z + 0.086, rgb(MS.accentDeep), { top: false, sides: 1 });
  for (let k = 0; k < 4; k++) siteG.box(PILE.x - 0.2, 0.012 + k * 0.03, PILE.z - 0.04 + (k % 2) * 0.01, PILE.x + 0.2, 0.04 + k * 0.03, PILE.z + 0.04 + (k % 2) * 0.01, k % 2 ? shade(precast, 0.86) : precast);
  for (const sx of [-0.3, 0.3]) siteG.cyl(PILE.x + sx + 0.2, PILE.z + 0.16, 0.0, 0.07, 0.034, 0.016, 6, rgb('#ff9a4a'));
  const siteMesh = new THREE.Mesh(siteG.build(), craneMat); siteMesh.frustumCulled = false; root.add(siteMesh);

  /* ---- crane: static mast, rotating jib group ---- */
  let mastMesh = null, Hm = 3;
  const jibG = new THREE.Group(), trolleyG = new THREE.Group(), blockG = new THREE.Group();
  jibG.add(trolleyG); trolleyG.add(blockG);
  const cableMesh = new THREE.Mesh(hookGeo(), craneMat); cableMesh.frustumCulled = false; trolleyG.add(cableMesh);
  // hook block, carried beam, and the top beam with its little tree and flag
  const bg = new Geo(); bg.box(-0.035, -0.09, -0.025, 0.035, 0, 0.025, rgb(MS.limestone)); bg.box(-0.012, -0.13, -0.012, 0.012, -0.09, 0.012, grey);
  const blockMesh = new THREE.Mesh(bg.build(), craneMat); blockMesh.frustumCulled = false; blockG.add(blockMesh);
  const beamGeo = (() => { const g = new Geo(); g.box(-0.2, -0.045, -0.025, 0.2, -0.015, 0.025, precast); g.box(-0.2, -0.015, -0.006, 0.2, 0.0, 0.006, precast); g.bar([-0.1, -0.015, 0], [0, -0.0, 0], 0.006, dark); g.bar([0.1, -0.015, 0], [0, -0.0, 0], 0.006, dark); return g.build(); })();
  const beamMesh = new THREE.Mesh(beamGeo, craneMat); beamMesh.position.y = -0.13; beamMesh.frustumCulled = false; blockG.add(beamMesh);
  const treeMesh = (() => { const g = new Geo(); addTree(g, -0.14, 0, 1); return new THREE.Mesh(g.build(), craneMat); })();
  treeMesh.position.y = -0.145; treeMesh.frustumCulled = false; blockG.add(treeMesh);
  const redLight = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: hdr(MS.accent, 2.6), toneMapped: false, fog: false }));    // Columbia-blue beacon on the jib
  craneG.add(jibG); jibG.add(redLight);

  function buildCrane(H, tipX) {
    if (mastMesh) { mastMesh.geometry.dispose(); craneG.remove(mastMesh); }
    Hm = H;
    const m = new Geo(), th = 0.032;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.bar([sx * 0.055, 0, sz * 0.055], [sx * 0.055, H, sz * 0.055], th, yel);
    for (let y = 0; y < H - 0.1; y += 0.22) {
      const y1 = Math.min(H, y + 0.22);
      m.bar([-0.055, y, 0.055], [0.055, y1, 0.055], 0.013, yel); m.bar([0.055, y, -0.055], [-0.055, y1, -0.055], 0.013, yel);
      m.bar([0.055, y, 0.055], [0.055, y1, -0.055], 0.013, yel); m.bar([-0.055, y, -0.055], [-0.055, y1, 0.055], 0.013, yel);
      m.bar([-0.055, y1, 0.055], [0.055, y1, 0.055], 0.011, yel); m.bar([-0.055, y1, -0.055], [-0.055, y1, 0.055], 0.011, yel);
    }
    for (let y = 0.9; y < H - 0.2; y += 0.9) m.sphere(0.0, y, 0.075, 0.018, 6, 5, rgb(MS.beacon), { kind: KIND.glow });
    m.box(-0.1, 0, -0.1, 0.1, 0.03, 0.1, grey);                                                // base
    m.box(-0.085, H - 0.02, -0.085, 0.085, H + 0.02, 0.085, grey);                               // slew ring
    mastMesh = new THREE.Mesh(m.build(), craneMat); mastMesh.frustumCulled = false; craneG.add(mastMesh);
    // jib group (built once per height change, cheap)
    if (jibG.userData.mesh) { jibG.userData.mesh.geometry.dispose(); jibG.remove(jibG.userData.mesh); }
    const j = new Geo(), Lj = tipX, Lc = 0.62;
    j.bar([-0.05, 0.1, 0], [Lj, 0.06, 0], 0.02, yel);
    for (const z of [-0.04, 0.04]) j.bar([-0.05, 0.0, z], [Lj, 0.0, z], 0.02, yel);
    for (let x = 0; x < Lj - 0.14; x += 0.14) { const s = ((x / 0.14) | 0) % 2 ? -1 : 1; j.bar([x, 0, 0.04 * s], [x + 0.07, 0.085, 0], 0.011, yel); j.bar([x + 0.07, 0.085, 0], [x + 0.14, 0, -0.04 * s], 0.011, yel); }
    j.bar([-0.05, 0.08, 0], [-Lc, 0.02, 0], 0.02, yel); for (const z of [-0.04, 0.04]) j.bar([-0.05, 0.0, z], [-Lc, 0.0, z], 0.02, yel);
    j.box(-Lc, -0.07, -0.06, -Lc + 0.2, 0.04, 0.06, grey); j.box(-Lc + 0.22, -0.07, -0.06, -Lc + 0.4, 0.03, 0.06, shade(grey, 0.85));     // counterweights
    j.bar([-0.05, 0.1, 0], [0, 0.5, 0], 0.02, yel); j.bar([0.0, 0.5, 0], [Lj * 0.86, 0.075, 0], 0.008, dark); j.bar([0.0, 0.5, 0], [-Lc, 0.03, 0], 0.008, dark);
    for (const x of [Lj - 0.02, Lj * 0.55, -Lc + 0.04]) j.sphere(x, 0.03, 0, 0.022, 6, 5, rgb(MS.beacon), { kind: KIND.glow });
    j.box(0.07, -0.16, 0.05, 0.2, -0.02, 0.14, shade(yel, 0.9)); j.box(0.12, -0.13, 0.14, 0.19, -0.06, 0.145, rgb(MS.windowWarm), { kind: KIND.glow, top: false, sides: 1 });  // cab
    const jm = new THREE.Mesh(j.build(), craneMat); jm.frustumCulled = false; jibG.add(jm); jibG.userData.mesh = jm;
    jibG.position.y = H + 0.02; redLight.position.set(0, 0.54, 0);
    craneG.position.set(CR.x, 0, CR.z);
  }

  /* ---- the rising block (rebuilt as it grows) ---- */
  const bodyMesh = new THREE.Mesh(new THREE.BufferGeometry(), bodyMat); bodyMesh.frustumCulled = false; bodyG.add(bodyMesh);
  const glowMat = new THREE.SpriteMaterial({ map: radial, color: hdr(MS.beacon, 2.2), toneMapped: false, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });   // blue-white weld
  const weld = new THREE.Sprite(glowMat); weld.scale.setScalar(0.34); weld.visible = false; bodyG.add(weld);
  let fp = { cx: 0, cz: 0.1, hw: 0.6, hd: 0.62 };
  function buildBody(h, glassTop) {
    const g = new Geo(), { cx, cz, hw, hd } = fp, x0 = cx - hw, x1 = cx + hw, z0 = cz - hd, z1 = cz + hd;
    const slab = rgb('#e3dccd'), colr = rgb('#bdb4a2'), glass = rgb('#5f86b8'), steel = rgb('#b9cce3'), plank = rgb('#b49a7a'), net = rgb(MS.accentDeep), rebar = rgb('#8a6a52');
    g.box(x0 - 0.04, 0, z0 - 0.04, x1 + 0.04, 0.026, z1 + 0.04, shade(slab, 0.8));                                       // pad
    if (glassTop > 0.02) g.box(x0 + 0.015, 0.026, z0 + 0.015, x1 - 0.015, glassTop, z1 - 0.015, glass, { win: true, ctop: shade(glass, 0.8) });
    const nf = Math.floor(h / FLOOR_H + 1e-6);
    for (let k = 1; k <= nf; k++) g.box(x0, k * FLOOR_H - 0.03, z0, x1, k * FLOOR_H, z1, slab, { ctop: shade(slab, 0.9) });      // floor plates
    const cy0 = Math.max(0.026, glassTop);
    if (h > cy0 + 0.01) {
      const xs = [x0 + 0.025, cx, x1 - 0.025], zs = [z0 + 0.025, z1 - 0.025];
      for (const x of xs) for (const z of zs) g.bar([x, cy0, z], [x, h, z], 0.04, colr, { caps: true });
      g.bar([x0 + 0.025, cy0, cz], [x0 + 0.025, h, cz], 0.04, colr); g.bar([x1 - 0.025, cy0, cz], [x1 - 0.025, h, cz], 0.04, colr);
    }
    for (const [x, z] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.04, z0 + 0.04], [x0 + 0.04, z1 - 0.04], [x1 - 0.04, z1 - 0.04]]) g.bar([x, h, z], [x, h + 0.1, z], 0.012, rebar);
    // scaffolding on the front and both sides, rising a little above the work
    const hs = h + 0.3, sx0 = x0 - 0.075, sx1 = x1 + 0.075, sz1 = z1 + 0.075, sz0 = z0 + 0.15;
    const pole = (x, z) => g.bar([x, 0, z], [x, hs, z], 0.018, steel);
    for (let i = 0; i <= 5; i++) pole(sx0 + (sx1 - sx0) * i / 5, sz1);
    for (const x of [sx0, sx1]) for (let i = 0; i <= 3; i++) pole(x, sz0 + (sz1 - sz0) * i / 3);
    for (let y = 0.22; y <= hs; y += FLOOR_H) {
      g.bar([sx0, y, sz1], [sx1, y, sz1], 0.014, steel); g.box(sx0, y - 0.012, z1 + 0.02, sx1, y, sz1 + 0.01, plank);
      for (const x of [sx0, sx1]) { g.bar([x, y, sz0], [x, y, sz1], 0.014, steel); g.box(x - 0.012, y - 0.012, sz0, x + 0.012, y, sz1, plank); }
      g.bar([sx0, y + 0.11, sz1], [sx1, y + 0.11, sz1], 0.009, steel);
    }
    const nb = Math.max(1, Math.floor(hs / (FLOOR_H * 2)));
    for (let k = 0; k < nb; k++) { const ya = k * FLOOR_H * 2 + 0.22, yb = Math.min(hs, ya + FLOOR_H * 2); g.bar([sx0, ya, sz1], [sx1, yb, sz1], 0.01, steel); g.bar([sx1, ya, sz1], [sx0, yb, sz1], 0.01, steel); }
    if (glassTop > 0.05) if (glassTop > 0.4) g.box(sx0 + 0.02, Math.max(0.05, glassTop - 0.8), sz1 + 0.006, sx1 - 0.02, glassTop - 0.02, sz1 + 0.012, net, { top: false, sides: 1, kind: KIND.fence });   // safety net (see-through mesh)
    // work lamps: the top corners and one half way up the scaffold
    for (const x of [x1 - 0.06, x0 + 0.06]) { g.bar([x, h, z1 - 0.05], [x, h + 0.24, z1 - 0.05], 0.014, dark); g.sphere(x, h + 0.26, z1 - 0.05, 0.035, 8, 6, rgb(MS.windowWarm), { kind: KIND.glow }); }
    if (h > 0.5) g.sphere(cx, Math.floor(h / FLOOR_H / 2) * FLOOR_H + 0.14, sz1 + 0.04, 0.03, 8, 6, rgb(MS.windowWarm), { kind: KIND.glow });
    const old = bodyMesh.geometry; bodyMesh.geometry = g.build(); old.dispose();
    weld.position.set(x0 + 0.1, h + 0.08, z1 + 0.02);
  }

  /* ---- topping out: top beam with a tree and a flag, sparks ---- */
  const topG = new THREE.Group(); topG.visible = false; bodyG.add(topG);
  const tbGeo = new Geo(); tbGeo.box(-0.42, 0, -0.03, 0.42, 0.035, 0.03, rgb(MS.limestone)); tbGeo.bar([0.3, 0.035, 0], [0.3, 0.2, 0], 0.012, rgb(MS.dark));
  addTree(tbGeo, -0.3, 0.035, 1.1);
  topG.add(new THREE.Mesh(tbGeo.build(), craneMat)); topG.scale.setScalar(1.6);
  const pole = new Geo(); pole.bar([0.3, 0.035, 0], [0.3, 0.5, 0], 0.014, rgb('#d8e4f0')); pole.sphere(0.3, 0.52, 0, 0.022, 8, 6, rgb(MS.beacon), { kind: KIND.glow });
  topG.add(new THREE.Mesh(pole.build(), craneMat));
  const LADDER = [[0.35, 0.66, 1.0], [0.66, 0.6, 1.0], [0.27, 0.88, 0.63], [1.0, 0.54, 0.42], [0.96, 0.54, 0.88]];
  const flag = makeCloth(0.26, 0.16, 6, 3, (u, v) => (v < 0.34 ? rgb(MS.accent) : v < 0.67 ? rgb(MS.limestone) : rgb('#17396a')));
  flag.mesh.position.set(0.3, 0.5, 0); topG.add(flag.mesh);
  const streamers = LADDER.map((c, i) => { const s = makeCloth(0.2, 0.025, 5, 1, () => c); s.mesh.position.set(-0.3 + i * 0.045, 0.2, 0.02 * (i % 2 ? 1 : -1)); s.mesh.rotation.z = -1.2 - i * 0.05; topG.add(s.mesh); return s; });
  const SP = 46, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3);
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ map: radial, color: new THREE.Color(1.7, 2.1, 2.6), size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  sparks.frustumCulled = false; sparks.visible = false; bodyG.add(sparks);
  function burst(y) {
    const r = rng((Math.random() * 1e9) | 0);
    for (let i = 0; i < SP; i++) { spPos.set([fp.cx + 0.3, y + 0.5, fp.cz], i * 3); const a = r() * TAU, s = 0.5 + r() * 1.1; spVel.set([Math.cos(a) * s, 0.9 + r() * 1.4, Math.sin(a) * s], i * 3); }
    sparks.visible = true; S.sparkT = 0;
  }

  /* ---- site cabin steam (break) ---- */
  const steamMat = new THREE.SpriteMaterial({ map: radial, color: 0xe2ecf8, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const steam = [0, 1, 2].map(() => { const s = new THREE.Sprite(steamMat.clone()); s.visible = false; root.add(s); return s; });

  /* ---- state ---- */
  const S = {
    on: false, phase: 'idle', floors: 3, targetP: 0, p: 0, recvAt: 0, rem: null, dur: null, lot: null, lotSig: '', baseY: 0.03, fade: 0, fadeTo: 0,
    topStart: -1, topped: false, suppress: false, retiring: false, autoRetire: -1, glass: 0, litP: 0.1, builtH: -1, builtG: -1, theta: -2, rh: 1, hy: 2, carry: 0, carryTop: false, sparkT: -1, flash: 0, motion: true, t0: 0,
  };
  let geom = null;                                                                      // {thB, rB, thP, rP}

  function layoutFor(lot) {
    if (lot.kind === 'tower' && lot.roof) { fp = { cx: lot.roof.cx, cz: lot.roof.cz, hw: clamp(lot.roof.hw, 0.42, 0.7) * 0.94, hd: clamp(lot.roof.hd, 0.42, 0.78) * 0.94 }; S.baseY = (lot.roofY ?? lot.topY) * lot.g; }
    else { fp = { cx: 0, cz: 0.1, hw: 0.6, hd: 0.62 }; S.baseY = 0.03; }
    const dxB = fp.cx - CR.x, dzB = fp.cz - CR.z, dxP = PILE.x - CR.x, dzP = PILE.z - CR.z;
    geom = { thB: Math.atan2(-dzB, dxB), rB: Math.hypot(dxB, dzB), thP: Math.atan2(-dzP, dxP), rP: Math.hypot(dxP, dzP) };
    if (geom.thP > 0) geom.thP -= TAU;                                                 // keep the swing short: pile at about -pi, building at about -2
    const H = S.baseY + S.floors * FLOOR_H + 1.0;
    buildCrane(Math.max(2.2, H), 1.75);
    bodyG.position.set(0, S.baseY, 0); S.builtH = -1; S.builtG = -1;
    putRoot(lot);
    S.lotSig = lotSig(lot); S.baseF = lot.kind === 'tower' ? lot.F : 0;
    setPool('cons', [lot.x, lot.z + 1.0, 0.85, new THREE.Color(MS.lamp), 0.45]);
  }
  const lotSig = (lot) => [lot.i, lot.kind, lot.F, lot.sig, Math.round(lot.topY * lot.g * 100)].join(':');

  function begin(lot) {
    const was = S.on;
    S.lot = lot; S.on = true; S.topped = false; S.topStart = -1; S.retiring = false; S.autoRetire = -1; S.p = 0; S.glass = 0; S.sparkT = -1; sparks.visible = false; topG.visible = false;
    S.litP = 0.1; bodyU.uLitP.value = 0.1; bodyU.uFlash.value = 0; S.flash = 0; S.fadeTo = 1; if (!was || !S.motion) S.fade = S.motion ? 0 : 1;
    layoutFor(lot);
    root.visible = true; S.theta = geom.thP; S.rh = geom.rP; S.hy = Hm - 0.62; S.t0 = performance.now() / 1000;
  }
  function retire() { if (S.on && !S.retiring) { S.retiring = true; S.fadeTo = 0; } }

  let lastKey = '';
  function set(st) {
    const now = performance.now() / 1000;
    // the crew is on site while a block runs (active), while paused, during a break, and for the topping-out ceremony
    const present = st && (st.active || st.paused || st.phase === 'break' || st.phase === 'topout');
    if (!present) { lastKey = ''; S.suppress = false; retire(); return; }
    const key = JSON.stringify([st.phase, st.active, st.paused, st.progress, st.floors, st.minutes, st.remaining, st.duration]);      // the host re-sends the same state with every refresh: ignore repeats
    if (key === lastKey && S.on && !S.retiring) return;
    lastKey = key;
    const paused = !!st.paused;
    const phase = st.phase === 'break' ? 'break' : st.phase === 'topout' ? 'topout' : (paused ? 'hold' : 'work');
    if (phase === 'work') S.suppress = false;
    else if (S.suppress) return;          // the ceremony is over and the floors are real: a repeated break/topout payload must not rebuild the site
    const floors = clamp(Math.round(st.floors != null ? st.floors : st.minutes != null ? st.minutes / MIN_PER_FLOOR : 3), 1, 8);
    const prog = clamp(+st.progress || 0, 0, 1);
    const lot = getToday();
    const fresh = !S.on || S.retiring || (phase === 'work' && S.on && (S.topped || (S.phase === 'break' && prog < 0.6) || (S.phase === 'work' && S.targetP > 0.6 && prog < S.targetP - 0.5)));
    S.floors = floors;
    if (fresh) {
      if (lot) begin(lot); else { S.on = true; S.lot = null; S.retiring = false; S.topped = false; S.topStart = -1; S.p = 0; S.fadeTo = 1; }
      if (phase === 'topout') S.p = 1;
      else if (phase === 'break') S.p = 1;
    } else if (phase === 'work' && lot && floors !== S.floors0) layoutFor(lot);
    S.floors0 = floors;
    if (phase === 'work') { S.targetP = prog; S.rem = st.remaining != null ? +st.remaining : null; S.dur = st.duration != null ? +st.duration : null; S.recvAt = now; }
    else if (phase === 'hold') { S.targetP = prog || S.targetP; S.rem = null; }            // paused: the building stops where it is
    else { S.targetP = 1; S.rem = null; }                                                   // break / topout: the block that just ended is complete
    if (phase === 'topout' && S.topStart < 0) startTopping(now);
    S.phase = phase;
  }
  function startTopping(now) {
    if (!S.on || !S.lot) { const lot = getToday(); if (!lot) return; S.floors = S.floors || 2; S.floors0 = S.floors; begin(lot); S.p = 1; }
    S.suppress = false; S.topStart = now; S.topped = true; S.targetP = 1; S.phase = 'topout'; S.fadeTo = 1; S.retiring = false; S.autoRetire = now + (S.motion ? 11 : 8);
    setTimeout(wake, (S.motion ? 11 : 8) * 1000 + 150); setTimeout(wake, (S.motion ? 11 : 8) * 1000 + 1500);         // reduced motion draws no frames of its own: ask for one when it is time to clear the site
    if (!S.motion) { S.p = 1; S.glass = 1; S.litP = 0.55; bodyU.uLitP.value = S.litP; topG.visible = true; topG.position.set(fp.cx, S.floors * FLOOR_H, fp.cz); flag.update(0, 0.3); }
  }
  function toppingOut() { startTopping(performance.now() / 1000); }

  /** the lot data changed (setDays): follow it, or hand over to the real tower */
  function onLots() {
    if (!S.on) return;
    const lot = getToday();
    if (!lot) { root.visible = false; S.lot = null; return; }
    if (lotSig(lot) !== S.lotSig || S.lot !== lot) {
      // the block was rated and floors really appeared on today's tower: that is the topping-out moment
      const grew = lot.kind === 'tower' && lot.F > S.baseF && S.lot && S.lot.i === lot.i;
      if (grew && !S.topped && (S.phase === 'break' || S.phase === 'topout' || S.p > 0.9)) { S.lot = lot; S.lotSig = lotSig(lot); S.baseF = lot.F; startTopping(performance.now() / 1000); return; }
      if (S.topped) { S.lot = lot; putRoot(lot); S.lotSig = lotSig(lot); }   // hand over: the finished block stays where it was
      else { S.lot = lot; layoutFor(lot); root.visible = true; }
    }
  }

  const tmpv = new THREE.Vector3();
  function pose(now) {
    const t = now - S.t0, Hhi = Hm - 0.62, topY = S.baseY + S.p * S.floors * FLOOR_H;
    let th, rh, hy, carry = 0, carryTop = false, red = 1;
    const { thB, rB, thP, rP } = geom;
    if ((S.phase === 'break' || S.phase === 'hold') && S.topStart < 0) {
      th = thB + 1.15; rh = 0.9; hy = Hhi; red = 0.18;
    } else if (S.topStart >= 0) {
      const tt = now - S.topStart;
      const sw = seg(tt, 0, 2.2), back = seg(tt, 6.4, 9.0);
      th = (thP + (thB - thP) * sw) + (thB + 1.15 - thB) * back; rh = rP + (rB - rP) * sw + (0.9 - rB) * back;
      const low = seg(tt, 2.2, 4.0) - seg(tt, 4.2, 5.6);
      hy = Hhi - (Hhi - (topY + 0.2)) * low; carryTop = tt < 4.1; carry = carryTop ? 1 : 0;
    } else {
      const c = ((t % CYCLE) + CYCLE) % CYCLE;
      const sw = seg(c, 3, 7.5) - seg(c, 12.5, 17);
      th = thP + (thB - thP) * sw; rh = rP + (rB - rP) * sw;
      const lowP = seg(c, 0, 1.8) - seg(c, 2.2, 3.4), lowB = seg(c, 7.5, 9.2) - seg(c, 10.0, 11.2);
      hy = Hhi - (Hhi - 0.18) * lowP - (Hhi - (topY + 0.2)) * lowB;
      carry = c > 2.0 && c < 10.1 ? 1 : 0;
    }
    return { th, rh, hy, carry, carryTop, red };
  }

  function update(dt, now, motion) {
    S.motion = motion;
    if (!S.on) return false;
    // appear / retire
    if (!S.retiring && S.autoRetire > 0 && now >= S.autoRetire) { S.suppress = true; retire(); }
    const lot = S.lot || getToday();
    if (!lot) return false;
    if (!S.lot) { S.lot = lot; layoutFor(lot); root.visible = true; }
    const kf = motion ? 1 - Math.exp(-dt * (S.fadeTo ? 3 : 2.2)) : 1;
    S.fade += (S.fadeTo - S.fade) * kf; if (Math.abs(S.fadeTo - S.fade) < 0.01) S.fade = S.fadeTo;
    const fading = S.fade !== S.fadeTo;
    if (S.fadeTo === 0 && S.fade === 0) { S.on = false; root.visible = false; S.phase = 'idle'; S.topStart = -1; S.topped = false; S.retiring = false; setPool('cons', null); return false; }
    for (const m of [craneMat, bodyMat]) { const tr = S.fade < 0.999; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = S.fade; }
    root.visible = S.fade > 0.003;

    // progress: extrapolate from the server's countdown, then ease toward it
    let target = S.targetP;
    if (S.phase === 'work' && S.dur > 0 && S.rem != null) target = clamp(1 - Math.max(0, S.rem - (now - S.recvAt)) / S.dur, 0, 1);
    const kp = motion ? 1 - Math.exp(-dt * (S.phase === 'topout' ? 1.2 : 2.4)) : 1;
    const prev = S.p; S.p += (target - S.p) * kp; if (Math.abs(target - S.p) < 0.0004) S.p = target;
    const h = S.p * S.floors * FLOOR_H;
    // the glazing trails the frame by a floor; it catches up when the block tops out
    const wantGlass = S.topStart >= 0 && now - S.topStart > 3.2 ? 1 : 0;
    S.glass += (wantGlass - S.glass) * (motion ? 1 - Math.exp(-dt * 1.2) : 1); if (Math.abs(wantGlass - S.glass) < 0.003) S.glass = wantGlass;
    const gTrail = Math.max(0, (Math.floor(h / FLOOR_H + 1e-6) - 1)) * FLOOR_H;
    const glassTop = gTrail + (h - gTrail) * S.glass;
    if (Math.abs(h - S.builtH) > 0.004 || Math.abs(glassTop - S.builtG) > 0.004) { buildBody(h, glassTop); S.builtH = h; S.builtG = glassTop; }

    // crane
    const pz = pose(now);
    const kc = motion ? 1 - Math.exp(-dt * 3.2) : 1;
    S.theta += (pz.th - S.theta) * kc; S.rh += (pz.rh - S.rh) * kc; S.hy += (pz.hy - S.hy) * (motion ? 1 - Math.exp(-dt * 4) : 1);
    jibG.rotation.y = S.theta;
    trolleyG.position.set(S.rh, -0.03, 0);
    const jibY = jibG.position.y + craneG.position.y, len = Math.max(0.12, jibY - 0.03 - S.hy);
    cableMesh.scale.y = len; blockG.position.y = -len;
    const sway = motion ? Math.sin(now * 1.3) * 0.02 * Math.min(1, len) : 0; blockG.position.x = sway * 0.5;
    beamMesh.visible = pz.carry > 0 && !pz.carryTop; treeMesh.visible = pz.carryTop;
    if (pz.carryTop) { beamMesh.visible = true; beamMesh.scale.set(1.0, 1, 1); }
    treeMesh.position.set(-0.12, -0.13, 0);
    redLight.material.color.copy(BEACON).multiplyScalar(motion ? (0.25 + 0.75 * (Math.sin(now * (pz.red > 0.5 ? 2.6 : 1.1)) > 0.2 ? 1 : 0.1)) * (0.4 + 0.6 * pz.red) : 0.9);

    // topping out: beam released, top set in place, sparks and a flash, windows light up
    if (S.topStart >= 0) {
      const tt = now - S.topStart;
      if (tt >= 4.1 && !topG.visible) {
        topG.visible = true; topG.position.set(fp.cx, h + 0.0, fp.cz); if (motion) { burst(h); S.flash = 1; }
      }
      if (topG.visible) { topG.position.y = h; const amp = motion ? 1 : 0.3; flag.update(now, amp); streamers.forEach((s, i) => s.update(now + i * 0.7, amp)); }
      S.litP += ((tt > 4.1 ? 0.62 : 0.1) - S.litP) * (motion ? 1 - Math.exp(-dt * 0.9) : 1); bodyU.uLitP.value = S.litP;
    }
    if (S.flash > 0) { S.flash = Math.max(0, S.flash - dt * 1.6); bodyU.uFlash.value = S.flash; } else if (bodyU.uFlash.value) bodyU.uFlash.value = 0;
    // sparks
    if (sparks.visible && motion) {
      S.sparkT += dt;
      for (let i = 0; i < SP; i++) { spVel[i * 3 + 1] -= 2.6 * dt; spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt; }
      spGeo.attributes.position.needsUpdate = true; sparks.material.opacity = clamp(1.6 - S.sparkT, 0, 1);
      if (S.sparkT > 1.7) sparks.visible = false;
    }
    // weld flicker while the frame is going up
    const welding = S.phase === 'work' && motion && S.p < 0.999 && S.p > 0.001;
    weld.visible = welding; if (welding) { glowMat.opacity = 0.25 + 0.5 * Math.abs(Math.sin(now * 37) * Math.sin(now * 11)); weld.scale.setScalar(0.16 + 0.1 * Math.abs(Math.sin(now * 23))); weld.position.y = h + 0.08; }
    // steam from the cabin during a break
    const brk = S.phase === 'break' && S.topStart < 0;
    steam.forEach((s, i) => {
      s.visible = brk && motion && S.fade > 0.2; if (!s.visible) return;
      const u = ((now * 0.22 + i / 3) % 1);
      s.position.set(CAB.x + 0.06 + Math.sin(u * 5 + i) * 0.03, 0.2 + u * 0.4, CAB.z); s.scale.setScalar(0.06 + u * 0.12); s.material.opacity = Math.sin(u * Math.PI) * 0.35;
    });
    void prev; void tmpv; void fading;
    return motion && (fading || (S.topStart >= 0 && now - S.topStart < 10) || S.flash > 0 || sparks.visible);
  }

  /** where the camera should look for the focus view */
  function focus() {
    const lot = S.lot || getToday(); if (!lot) return null;
    const baseY = lot.kind === 'tower' ? (lot.roofY ?? lot.topY) * lot.g : 0.03, top = baseY + Math.max(S.floors, 3) * FLOOR_H;
    return { x: lot.x, z: lot.z, baseY, top, craneTop: Math.max(2.2, top + 1.0) };
  }
  return { group: root, S, set, toppingOut, update, onLots, focus, get on() { return S.on; }, get phase() { return S.phase; } };
}
void LOT_D;
