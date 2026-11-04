// city/spots/cafe.js · "A café on Amsterdam Ave" (docs/COZY.md section 4.5): a narrow neighbourhood café. A pressed-tin ceiling, exposed
// brick, a black-and-white tiled floor, a counter at the back with a lit pastry case and an espresso machine that steams, pendant lamps,
// and a long window ledge facing the avenue. The user's seat is at the window ledge (we look over their shoulder at the street);
// two other customers and a barista keep it alive. Generic and unbranded: no names, no lettering.
// Budget: about 25k triangles and under 16 draw calls before the user's figure.
import * as THREE from 'three';
import {
  Geo, C, hc, rng, shade, clamp, lerp, Quads, createCrowd, personLook, mergeColored, chairGeo, laptop, openBook,
  createGlass, createMotes, createSteam, setSit, setStand, setWalk, seatedArms, applyArms, paneTex,
} from './kit.js';
import { cupMesh } from './butler.js';

export function build(ctx) {
  const { mats } = ctx;
  const X0 = -3.2, X1 = 3.2, Z0 = -5, Z1 = 4.2, H = 3.7;
  const r = rng(208);
  const group = new THREE.Group(); group.name = 'cafe';
  const g = new Geo(), lampG = new Geo(), glowG = new Geo(), pools = new Quads(), shadows = new Quads();
  const WOOD = C('#7a5233'), WOOD2 = C('#5a3b24'), TOP = C('#8f6740'), GREEN = C('#24453a'), CREAM = C('#efe6d2');

  /* ---------------------------------------------------------------- floor: small black-and-white tiles, a worn path */
  const T = 0.3;
  for (let x = X0; x < X1 - 1e-3; x += T) for (let z = Z0; z < Z1 - 1e-3; z += T) {
    const k = (Math.round((x - X0) / T) + Math.round((z - Z0) / T)) % 2, v = 0.92 + r() * 0.1;
    g.box(x, -0.02, z, Math.min(X1, x + T), 0, Math.min(Z1, z + T), k ? shade(C('#e2dacb'), v) : shade(C('#4a4440'), v), { sides: 0 });
  }
  /* ---------------------------------------------------------------- the left wall: exposed brick, shelves of jars and cups */
  g.box(X0 - 0.25, 0, Z0, X0, H, Z1, C('#b9ab98'), { sides: 4, top: false });
  for (let row = 0, y = 0.02; y < H - 0.05; row++, y += 0.085) {
    let z = Z0 + (row % 2 ? -0.12 : 0);
    while (z < Z1) { const z1 = Math.min(Z1, z + 0.23); if (z1 > Z0) g.quad([X0 + 0.004, y, Math.max(Z0, z)], [X0 + 0.004, y, z1], [X0 + 0.004, y + 0.072, z1], [X0 + 0.004, y + 0.072, Math.max(Z0, z)], shade(C(['#8a4532', '#9a5038', '#7d3e2d', '#a3593f'][Math.floor(r() * 4)]), 0.9 + r() * 0.18)); z += 0.245; }
  }
  for (const y of [1.55, 2.15]) {
    g.box(X0, y, -2.4, X0 + 0.28, y + 0.04, 1.6, WOOD2);
    for (let z = -2.3; z < 1.5; z += 0.22 + r() * 0.12) {
      const k = r();
      if (k < 0.45) { g.cyl(X0 + 0.14, z, y + 0.04, y + 0.2 + r() * 0.08, 0.06, 0.06, 8, C(['#c9b37a', '#7a3b2e', '#e8e1cf', '#3f6b4e'][Math.floor(r() * 4)])); g.cyl(X0 + 0.14, z, y + 0.24, y + 0.27, 0.055, 0.055, 8, C('#8c6a3a')); }
      else if (k < 0.8) { g.cyl(X0 + 0.14, z, y + 0.04, y + 0.13, 0.05, 0.045, 8, CREAM); }
      else g.box(X0 + 0.04, y + 0.04, z - 0.04, X0 + 0.24, y + 0.3, z + 0.04, C(['#2f4d6e', '#a5452f', '#d9c39a'][Math.floor(r() * 3)]));
    }
  }
  // a chalkboard on the brick (no lettering: a few soft chalk strokes)
  g.box(X0, 0.95, 2.0, X0 + 0.05, 2.35, 3.6, C('#5a3b24'));
  g.box(X0 + 0.05, 1.0, 2.05, X0 + 0.06, 2.3, 3.55, C('#22302b'), { top: false });
  for (let k = 0; k < 7; k++) { const y = 2.15 - k * 0.16, w = 0.5 + r() * 0.8; g.box(X0 + 0.061, y, 2.2, X0 + 0.065, y + 0.025, 2.2 + w, C('#cfd6d0'), { top: false }); }

  /* ---------------------------------------------------------------- the back wall and the counter */
  g.box(X0, 0, Z0 - 0.2, X1, H, Z0, CREAM, { sides: 1, top: false });
  g.box(-0.6, 0, Z0, 0.4, 2.2, Z0 + 0.03, C('#3a2a1e'));                        // the kitchen door
  g.box(-0.5, 1.5, Z0 + 0.03, 0.3, 1.9, Z0 + 0.04, C('#d9c9a8'));               // its round-ish window, lit from behind
  lampG.box(-0.45, 1.55, Z0 + 0.045, 0.25, 1.85, Z0 + 0.05, hc('#ffd9a0', 0.9), { top: false });
  // shelves of cups behind the counter
  for (const y of [1.45, 1.85]) { g.box(0.8, y, Z0, 3.0, y + 0.03, Z0 + 0.25, WOOD2); for (let x = 0.9; x < 2.9; x += 0.16) g.cyl(x, Z0 + 0.12, y + 0.03, y + 0.12, 0.045, 0.04, 7, CREAM); }
  // the counter: dark wood, a marble top
  const CZ0 = -4.05, CZ1 = -3.45, CH = 1.02;
  g.box(-2.7, 0, CZ0, 2.9, CH - 0.04, CZ1, WOOD2);
  for (let x = -2.6; x < 2.85; x += 0.45) g.box(x, 0.12, CZ1, x + 0.38, CH - 0.16, CZ1 + 0.01, shade(WOOD2, 1.15), { top: false });
  g.box(-2.75, CH - 0.04, CZ0 - 0.02, 2.95, CH, CZ1 + 0.05, C('#e9e5dd'));
  shadows.flat(0.1, 0.004, CZ1 + 0.15, 6.2, 0.6, [0.9, 0.9, 0.9]);
  // the pastry case (lit inside), with croissants, buns and slices on two shelves
  { const x0 = -2.55, x1 = -0.75, y0 = CH, y1 = CH + 0.5;
    g.box(x0, y0, CZ0 + 0.02, x1, y0 + 0.04, CZ1, C('#3a2a1e'));
    g.box(x0, y1 - 0.02, CZ0 + 0.02, x1, y1, CZ1, C('#3a2a1e'));
    for (const x of [x0, x1 - 0.03]) g.box(x, y0, CZ0 + 0.02, x + 0.03, y1, CZ1, C('#3a2a1e'));
    glowG.box(x0 + 0.03, y0 + 0.04, CZ0 + 0.03, x1 - 0.03, y0 + 0.045, CZ1 - 0.02, hc('#ffe6c0', 0.55), { sides: 0 });
    glowG.box(x0 + 0.03, y1 - 0.025, CZ0 + 0.03, x1 - 0.03, y1 - 0.02, CZ1 - 0.02, hc('#fff2d8', 1.2), { sides: 0, top: false, bottom: true });
    for (let x = x0 + 0.14; x < x1 - 0.1; x += 0.2) {
      g.blob(x, y0 + 0.08, (CZ0 + CZ1) / 2 + (r() - 0.5) * 0.15, 0.065, C(['#c98a3e', '#b8743a', '#e0b070', '#8a4a2e'][Math.floor(r() * 4)]), {}, 0.55);
      g.blob(x + 0.05, y0 + 0.3, (CZ0 + CZ1) / 2, 0.055, C(['#d9a05a', '#f0d9b0', '#7a3b2e'][Math.floor(r() * 3)]), {}, 0.6);
    }
    g.box(x0, y0 + 0.24, CZ0 + 0.02, x1, y0 + 0.255, CZ1, C('#cfc8bc')); }
  // the espresso machine: chrome, two group heads, cups warming on top
  const EM = { x: 0.75, z: -3.8 };
  { const y = CH, CH2 = C('#c8ccd2');
    g.box(EM.x - 0.42, y, EM.z - 0.22, EM.x + 0.42, y + 0.42, EM.z + 0.18, CH2);
    g.box(EM.x - 0.44, y + 0.42, EM.z - 0.24, EM.x + 0.44, y + 0.46, EM.z + 0.2, shade(CH2, 0.8));
    g.box(EM.x - 0.4, y + 0.08, EM.z + 0.18, EM.x + 0.4, y + 0.3, EM.z + 0.19, C('#7a3b2e'), { top: false });
    for (const dx of [-0.2, 0.2]) { g.cyl(EM.x + dx, EM.z + 0.26, y + 0.18, y + 0.26, 0.05, 0.05, 8, shade(CH2, 0.7)); g.box(EM.x + dx - 0.03, y + 0.12, EM.z + 0.3, EM.x + dx + 0.03, y + 0.18, EM.z + 0.42, C('#1d1714')); }
    g.bar([EM.x + 0.36, y + 0.32, EM.z + 0.2], [EM.x + 0.42, y + 0.1, EM.z + 0.3], 0.02, shade(CH2, 0.7));
    for (let k = 0; k < 4; k++) g.cyl(EM.x - 0.3 + k * 0.2, EM.z - 0.04, y + 0.46, y + 0.54, 0.04, 0.035, 7, CREAM);
    g.box(EM.x + 0.55, y, EM.z - 0.12, EM.x + 0.85, y + 0.32, EM.z + 0.12, C('#2b2f38')); }        // the grinder
  const steamM = createSteam(14, 0.45); steamM.mesh.position.set(EM.x + 0.43, CH + 0.1, EM.z + 0.31); group.add(steamM.mesh);

  /* ---------------------------------------------------------------- the shop window on the right (x = X1), the ledge, the window seats */
  const WIN = { z0: -3.7, z1: 3.5, y0: 0.72, y1: 3.15 }, MC = C('#1f3a33');
  g.box(X1, 0, Z0, X1 + 0.25, WIN.y0, Z1, CREAM, { sides: 8 });
  g.box(X1, WIN.y1, Z0, X1 + 0.25, H, Z1, CREAM, { sides: 8, top: false, bottom: true });
  g.box(X1, WIN.y0, Z0, X1 + 0.25, WIN.y1, WIN.z0, CREAM, { sides: 8 | 1 }); g.box(X1, WIN.y0, WIN.z1, X1 + 0.25, WIN.y1, Z1, CREAM, { sides: 8 | 2 });
  for (let k = 0; k <= 4; k++) { const z = lerp(WIN.z0, WIN.z1, k / 4); g.box(X1 + 0.06, WIN.y0, z - 0.04, X1 + 0.14, WIN.y1, z + 0.04, MC); }
  g.box(X1 + 0.06, 2.55, WIN.z0, X1 + 0.14, 2.62, WIN.z1, MC);                                      // the transom bar
  for (let k = 0; k < 8; k++) { const z = lerp(WIN.z0, WIN.z1, (k + 0.5) / 8); g.box(X1 + 0.07, 2.62, z - 0.015, X1 + 0.13, WIN.y1, z + 0.015, MC); }
  g.box(X1 - 0.02, WIN.y0 - 0.06, WIN.z0, X1 + 0.16, WIN.y0, WIN.z1, MC);
  // the ledge and its chairs; the user's is the third
  const LX0 = 2.5, LX1 = X1, LY = 0.76, LZ0 = -3.0, LZ1 = 2.4;
  g.box(LX0, LY - 0.05, LZ0, LX1, LY, LZ1, TOP);
  for (const z of [LZ0 + 0.1, LZ1 - 0.1]) g.box(LX0 + 0.05, 0, z - 0.04, LX0 + 0.12, LY - 0.05, z + 0.04, WOOD2);
  shadows.flat((LX0 + LX1) / 2, 0.004, (LZ0 + LZ1) / 2, 1.0, LZ1 - LZ0 + 0.4, [1, 1, 1]);
  const ledgeSeats = [-2.2, -0.9, 0.4, 1.7], seat = { x: 2.05, z: 0.4, ry: Math.PI / 2 };
  for (const z of ledgeSeats) { chairGeo(g, 2.05, z, Math.PI / 2, C('#4a3122')); shadows.flat(2.05, 0.004, z, 0.7, 0.7, [0.8, 0.8, 0.8]); }
  // a small round table in the middle with two chairs, another by the brick
  const tables = [{ x: -0.7, z: 1.3 }, { x: -2.2, z: -1.6 }];
  for (const t of tables) {
    g.cyl(t.x, t.z, 0, 0.04, 0.24, 0.24, 10, C('#2b2f38')); g.cyl(t.x, t.z, 0.04, 0.72, 0.03, 0.03, 6, C('#2b2f38')); g.cyl(t.x, t.z, 0.72, 0.76, 0.38, 0.38, 14, C('#e9e5dd'));
    shadows.flat(t.x, 0.004, t.z, 1.4, 1.4, [1, 1, 1]);
  }
  chairGeo(g, -0.7, 0.62, 0, C('#4a3122')); chairGeo(g, -0.7, 1.98, Math.PI, C('#4a3122')); chairGeo(g, -2.2, -0.92, Math.PI, C('#4a3122'));
  // a plant in the corner by the window, a coat rack
  g.cyl(2.85, 3.75, 0, 0.42, 0.2, 0.16, 10, C('#a5452f')); for (let k = 0; k < 9; k++) g.blob(2.85 + (r() - 0.5) * 0.4, 0.6 + r() * 0.7, 3.75 + (r() - 0.5) * 0.4, 0.18 + r() * 0.1, C(['#3f6b3a', '#4f7d44', '#2f5a30'][k % 3]), {}, 1.1);

  /* ---------------------------------------------------------------- the pressed-tin ceiling and the pendant lamps */
  g.box(X0, H, Z0, X1 + 0.25, H + 0.1, Z1, C('#f6f2e8'), { sides: 0, bottom: true, top: false });
  for (let x = X0 + 0.05; x < X1 - 0.3; x += 0.6) for (let z = Z0 + 0.05; z < Z1 - 0.3; z += 0.6) {
    g.box(x + 0.06, H - 0.035, z + 0.06, x + 0.54, H, z + 0.54, C('#f2ede2'), { top: false, bottom: true });
    g.box(x + 0.2, H - 0.06, z + 0.2, x + 0.4, H - 0.035, z + 0.4, C('#fffaf0'), { top: false, bottom: true });
  }
  g.box(X0, H - 0.25, Z0, X0 + 0.12, H, Z1, C('#e6e0d0')); g.box(X0, H - 0.25, Z0, X1, H, Z0 + 0.12, C('#e6e0d0'));
  const pend = [[-0.6, -1.8], [-0.7, 1.3], [-2.2, -1.6], [2.8, -1.6], [2.8, 0.9], [0.6, -3.5]];
  for (const [x, z] of pend) {
    const y = x > 2.5 ? 2.25 : z < -3 ? 2.35 : 2.15;
    g.bar([x, H, z], [x, y + 0.24, z], 0.012, C('#1d1714'));
    g.cyl(x, z, y + 0.12, y + 0.24, 0.05, 0.03, 8, C('#b8913f'));
    g.cyl(x, z, y, y + 0.12, 0.2, 0.05, 12, C('#24453a'), { top: false });
    lampG.cyl(x, z, y - 0.06, y + 0.04, 0.07, 0.07, 8, hc('#ffd9a0', 2.2));
    pools.flat(x, 0.012, z, 2.2, 2.2, hc('#ffcf8a', 0.5));
    if (x > 2.5) pools.flat(x - 0.15, LY + 0.004, z, 1.0, 1.6, hc('#ffe0a8', 0.45));
  }
  pools.flat(-0.7, 0.765, 1.3, 0.9, 0.9, hc('#ffe0a8', 0.35)); pools.flat(-2.2, 0.765, -1.6, 0.9, 0.9, hc('#ffe0a8', 0.35));

  /* ---------------------------------------------------------------- the other people: two customers and the barista */
  const lr = rng(61), looks = [personLook(lr), personLook(lr), { ...personLook(lr), top: '#2b2f38', bottom: '#23262d' }];
  const crowd = createCrowd(looks); group.add(crowd.mesh);
  const [pA, pB, bar] = crowd.people;
  pA.root.position.set(-0.7, 0, 0.62); pA.root.rotation.y = 0; pA.st = { act: 'read', ph: 1.3 };
  pB.root.position.set(2.05, 0, -2.2); pB.root.rotation.y = Math.PI / 2; pB.st = { act: 'type', ph: 4.1 };
  bar.root.position.set(0.75, 0, -4.45); bar.root.rotation.y = 0; setStand(bar); bar.st = { ph: 0 };
  openBook(g, -0.7, 0.76, 0.98, 0, '#5b4a7a'); g.cyl(-0.45, 1.05, 0.76, 0.85, 0.04, 0.035, 8, CREAM);
  laptop(g, glowG, 2.48, LY, -2.2, Math.PI / 2);
  for (const p of [pA, pB]) setSit(p);

  /* ---------------------------------------------------------------- the user's place at the window: a notebook, a laptop, the cup */
  const S = seat;
  laptop(g, glowG, S.x + 0.47, LY, S.z + 0.08, Math.PI / 2 + 0.12);
  openBook(g, S.x + 0.45, LY, S.z - 0.42, Math.PI / 2 - 0.2, '#3f6b4e');
  const cup = cupMesh(mats); cup.position.set(S.x + 0.5, LY, S.z + 0.5); group.add(cup);
  const cupHome = cup.position.clone();

  /* ---------------------------------------------------------------- merge; the view out; the glass; the light through the window */
  const roomMesh = new THREE.Mesh(mergeColored([g.build()]), mats.solid); group.add(roomMesh);
  const lampMesh = new THREE.Mesh(lampG.build(), mats.lamp); group.add(lampMesh);
  const glowMesh = new THREE.Mesh(glowG.build(), mats.glow); group.add(glowMesh);
  const poolMesh = new THREE.Mesh(pools.build(), mats.pools); poolMesh.renderOrder = 3; group.add(poolMesh);
  const shadowMesh = new THREE.Mesh(shadows.build(), mats.blob); shadowMesh.renderOrder = 1; group.add(shadowMesh);
  const VW = 14, VH = 7, viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  viewMesh.position.set(X1 + 3.2, 0.2 + VH / 2 - 0.6, (WIN.z0 + WIN.z1) / 2); viewMesh.rotation.y = -Math.PI / 2; group.add(viewMesh);
  // the sidewalk and the kerb just outside, so the street has a floor
  const out = new Geo(); out.box(X1 + 0.25, -0.05, Z0 - 3, X1 + 3.2, 0, Z1 + 3, C('#8d8a84'), { sides: 0 }); out.box(X1 + 2.6, -0.05, Z0 - 3, X1 + 2.75, 0.06, Z1 + 3, C('#b4b0a8'));
  const outMesh = new THREE.Mesh(out.build(), mats.solid); group.add(outMesh);
  const glass = createGlass(WIN.z1 - WIN.z0, WIN.y1 - WIN.y0); glass.mesh.position.set(X1 + 0.1, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2); glass.mesh.rotation.y = -Math.PI / 2; group.add(glass.mesh);
  const motes = createMotes(120); group.add(motes.mesh);
  const patchMat = new THREE.MeshBasicMaterial({ map: paneTex(4, 2, false), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const patchMesh = new THREE.Mesh(new THREE.BufferGeometry(), patchMat); patchMesh.renderOrder = 2; group.add(patchMesh);
  const lampLight = new THREE.PointLight(0xffc98a, 0, 6, 1.6); lampLight.position.set(2.7, 2.0, 0.6); group.add(lampLight);
  const fill = new THREE.PointLight(0xffc98a, 0, 8, 1.6); fill.position.set(-0.7, 2.0, 0.0); group.add(fill);

  function sunDir(L) { const e = Math.max(0.1, L.elev); return new THREE.Vector3(-Math.cos(e) * 0.9, -Math.sin(e), Math.cos(e) * 0.45 * L.az).normalize(); }
  let sunKey = '';
  function rebuildSun(L) {
    if (L.key === sunKey) return; sunKey = L.key;
    const d = sunDir(L), pq = new Quads(), amt = clamp(L.shafts, 0, 1), w = new THREE.Color().copy(L.sun), col = [w.r * 0.38 * amt, w.g * 0.38 * amt, w.b * 0.38 * amt];
    if (amt > 0.02) {
      const hit = (y, z) => { const t = y / -d.y; return [X1 + d.x * t, 0.008, z + d.z * t]; };
      const a = hit(WIN.y0, WIN.z0), b = hit(WIN.y0, WIN.z1), c = hit(2.55, WIN.z1), e = hit(2.55, WIN.z0);
      pq.quad(b, a, e, c, col, [1, 0, 0, 1]);
      motes.scatter((rr) => { const y = lerp(0.8, 2.5, rr()), z = lerp(WIN.z0, WIN.z1, rr()), t = (y / -d.y) * rr(); return [X1 + d.x * t, y + d.y * t, z + d.z * t]; });
    }
    patchMesh.geometry.dispose(); patchMesh.geometry = pq.empty ? new THREE.BufferGeometry() : pq.build(); patchMesh.visible = !pq.empty;
  }
  function setLight(L) {
    rebuildSun(L);
    mats.lamp.color.setScalar(0.6 + 0.55 * L.lamp); mats.pools.color.setScalar(0.25 + 0.75 * L.lamp);
    lampLight.intensity = 1.4 * L.lamp; fill.intensity = 1.8 * L.lamp * (0.4 + 0.6 * L.night);
    motes.u.uAmt.value = clamp(L.shafts, 0, 1) * 0.6;
    steamM.u.uAmt.value = 0.7 + 0.5 * L.night;
    glass.set(L);
  }
  function setView(tex) { const m = viewMesh.material; if (m.map && m.map !== tex) m.map.dispose(); m.map = tex; m.needsUpdate = true; }

  /* ---------------------------------------------------------------- their slow loops */
  function update(t, motion) {
    glass.u.uTime.value = t; motes.u.uTime.value = t; steamM.u.uTime.value = t;
    steamM.mesh.visible = motion;
    if (motion) {
      // the customers: reading with page turns, typing, the odd sip; the barista: tamp, pull, wipe the counter
      const ca = ((t + 3) % 40) < 4 ? 'think' : 'read'; applyArms(pA, seatedArms(ca, t, pA.st.ph));
      const cb = ((t + 17) % 55) < 5 ? 'stretch' : ((t + 17) % 55) < 30 ? 'type' : 'read'; applyArms(pB, seatedArms(cb, t, pB.st.ph));
      const c = t % 24;
      if (c < 8) { bar.root.position.x = 0.75; bar.armL.rotation.set(-1.25 + Math.sin(t * 3) * 0.08, 0, 0.1); bar.armR.rotation.set(-1.2, 0, -0.15); }
      else if (c < 12) { bar.root.position.x = lerp(0.75, -0.2, (c - 8) / 4); setWalk(bar, t * 7); }
      else if (c < 20) { setStand(bar); bar.root.position.x = -0.2 + Math.sin((c - 12) * 1.2) * 0.25; bar.armR.rotation.set(-1.1, 0, -0.1 + Math.sin(t * 4) * 0.35); bar.armL.rotation.set(-0.3, 0, 0.1); }
      else { bar.root.position.x = lerp(-0.2, 0.75, (c - 20) / 4); setWalk(bar, t * 7); }
      if (c < 8 || (c >= 12 && c < 20)) setStand(bar);
      bar.root.rotation.y = c >= 8 && c < 12 ? -Math.PI / 2 : c >= 20 ? Math.PI / 2 : Math.PI;
      if (c < 8 || (c >= 12 && c < 20)) { bar.root.rotation.y = Math.PI; }
    } else {
      applyArms(pA, seatedArms('read', 2, 0)); applyArms(pB, seatedArms('type', 0, 0)); setStand(bar); bar.root.rotation.y = Math.PI; bar.armL.rotation.set(-1.2, 0, 0.1); bar.armR.rotation.set(-1.2, 0, -0.1);
    }
    crowd.skin();
  }
  update(0, false);

  /* ---------------------------------------------------------------- framing and the routes the user's figure walks */
  const frames = { wide: { pos: [-1.7, 2.15, 6.9], target: [1.55, 1.2, -0.7], fov: 50 }, tall: { pos: [-0.3, 1.95, 5.1], target: [2.0, 1.15, -0.3], fov: 58 } };
  const routes = {
    seat: { x: S.x, z: S.z, ry: S.ry }, standAt: [S.x - 0.55, S.z],
    toStretch: [[S.x - 0.55, S.z], [1.0, 1.9]], stretch: { x: 1.0, z: 1.9, ry: 0 },
    toCoffee: [[1.0, 1.9], [1.25, -1.6], [0.75, -3.0]], coffeeExit: false, coffee: { x: 0.75, z: -3.0, ry: Math.PI },
    fromCoffee: [[0.75, -3.0], [1.3, -1.6], [1.45, 2.95], [2.75, 3.05]], window: { x: 2.75, z: 3.05, ry: Math.PI / 2 },
    toSeat: [[2.75, 3.05], [1.5, 2.8], [1.5, S.z], [S.x, S.z]],
  };

  return {
    group, crowd, frames, seat, routes, cup, cupHome, view: { kind: 'avenue', seed: 23 }, setView, setLight, update,
    title: 'A café on Amsterdam Ave', others: 3, fog: { color: '#2a2420', near: 14, far: 40 }, background: '#1c1815',
    sunDir, interior: true, realView: null,
    setPx(px) { steamM.u.uPx.value = px; motes.u.uPx.value = px; },
    dispose() { group.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== crowd.mesh) { o.geometry.dispose(); if (o.material && !Object.values(mats).includes(o.material)) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } } }); crowd.dispose(); },
  };
}
