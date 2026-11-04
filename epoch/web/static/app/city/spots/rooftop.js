// city/spots/rooftop.js · "A rooftop in Morningside" (docs/COZY.md section 4.5): the tar roof of a pre-war walk-up. A wooden water tank
// on its steel stand, the stair bulkhead with a lamp over the door, a brick parapet with stone coping, string lights on poles, plants
// in pots, and a folding table where the user works, looking south over the roofs toward Midtown. The skyline is the real city
// rendered from the user's own roof when the construction cam can lend its renderer, else a painted skyline. One neighbour reads in a
// deck chair by the tank. Open air: it follows the hour and the weather (rain and snow fall across the view).
// Budget: about 20k triangles and under 16 draw calls before the user's figure.
import * as THREE from 'three';
import {
  Geo, C, hc, rng, shade, clamp, lerp, Quads, createCrowd, personLook, mergeColored, laptop, openBook,
  createGlass, setSit, seatedArms, applyArms,
} from './kit.js';
import { cupMesh } from './butler.js';

function foldingChair(g, x, z, ry, col) {
  const c = Math.cos(ry), s = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const bar = (a, b, ya, yb, w = 0.025) => { const A = P(a[0], a[1]), B = P(b[0], b[1]); g.bar([A[0], ya, A[1]], [B[0], yb, B[1]], w, col); };
  const seat = [P(-0.21, -0.2), P(0.21, -0.2), P(0.21, 0.2), P(-0.21, 0.2)];
  g.quad([seat[3][0], 0.46, seat[3][1]], [seat[2][0], 0.46, seat[2][1]], [seat[1][0], 0.46, seat[1][1]], [seat[0][0], 0.46, seat[0][1]], shade(col, 1.1));
  for (const sx of [-0.2, 0.2]) { bar([sx, 0.22], [sx, -0.22], 0, 0.46); bar([sx, -0.22], [sx, 0.2], 0, 0.46); bar([sx, -0.21], [sx, -0.25], 0.46, 0.9); }
  const A = P(-0.21, -0.24), B = P(0.21, -0.24); g.quad([A[0], 0.62, A[1]], [B[0], 0.62, B[1]], [B[0], 0.88, B[1]], [A[0], 0.88, A[1]], shade(col, 1.1));
}

export function build(ctx) {
  const { mats } = ctx;
  const X0 = -6, X1 = 6, Z0 = -5, Z1 = 6;
  const r = rng(707);
  const group = new THREE.Group(); group.name = 'rooftop';
  const g = new Geo(), lampG = new Geo(), glowG = new Geo(), pools = new Quads(), shadows = new Quads();
  const BRICK = C('#8a4a36'), COPING = C('#cfc6b4'), STEEL = C('#3a3e44'), TANK = C('#8a6a4a');

  /* ---------------------------------------------------------------- the roof: tar with seams, a wooden deck under the table */
  g.box(X0, -0.3, Z0, X1, 0, Z1, C('#3b3733'), { sides: 1 | 4 | 8 });
  for (let k = 0; k < 14; k++) { const x = X0 + r() * 12, z = Z0 + r() * 11, w = 0.6 + r() * 2.2; g.box(x, 0, z, Math.min(X1, x + w), 0.004, Math.min(Z1, z + 0.08), C('#2a2724'), { sides: 0 }); }
  for (let x = -1.6; x < 2.6; x += 0.15) g.box(x, 0, -2.4, x + 0.14, 0.05, 1.4, shade(C('#8c6a48'), 0.85 + r() * 0.25), { sides: 1 | 2, bottom: false });
  shadows.flat(0.5, 0.055, -1.0, 2.2, 1.6, [1, 1, 1]);
  /* ---------------------------------------------------------------- the parapet: brick, stone coping (back, left, right; the front is open) */
  const PH = 1.05;
  const wall = (x0, z0, x1, z1) => {
    g.box(x0, 0, z0, x1, PH, z1, BRICK);
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let y = 0.08; y < PH - 0.05; y += 0.16) for (let u = (along ? x0 : z0) + (Math.round(y / 0.16) % 2 ? 0.12 : 0); u < (along ? x1 : z1) - 0.1; u += 0.25) {
      const v = shade(BRICK, 0.85 + r() * 0.3);
      if (along) g.quad([u, y, z1 + 0.003], [u + 0.23, y, z1 + 0.003], [u + 0.23, y + 0.13, z1 + 0.003], [u, y + 0.13, z1 + 0.003], v);
      else g.quad([x1 + 0.003, y, u + 0.23], [x1 + 0.003, y, u], [x1 + 0.003, y + 0.13, u], [x1 + 0.003, y + 0.13, u + 0.23], v);
    }
    g.box(x0 - 0.05, PH, z0 - 0.05, x1 + 0.05, PH + 0.08, z1 + 0.05, COPING);
  };
  wall(X0, Z0 - 0.3, X1, Z0); wall(X0 - 0.3, Z0, X0, Z1);
  g.box(X1, 0, Z0, X1 + 0.3, PH, Z1, BRICK); g.box(X1 - 0.05, PH, Z0, X1 + 0.35, PH + 0.08, Z1, COPING);
  /* ---------------------------------------------------------------- the water tank on its stand */
  const TX = 3.9, TZ = -2.6, TY = 2.4, TR = 1.25, TH = 2.7;
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(TX + dx * 0.95 - 0.06, 0, TZ + dz * 0.95 - 0.06, TX + dx * 0.95 + 0.06, TY, TZ + dz * 0.95 + 0.06, STEEL);
  g.bar([TX - 0.95, 0.4, TZ - 0.95], [TX + 0.95, TY - 0.2, TZ - 0.95], 0.04, STEEL); g.bar([TX + 0.95, 0.4, TZ + 0.95], [TX - 0.95, TY - 0.2, TZ + 0.95], 0.04, STEEL);
  g.box(TX - 1.15, TY - 0.12, TZ - 1.15, TX + 1.15, TY, TZ + 1.15, STEEL);
  g.cyl(TX, TZ, TY, TY + TH, TR, TR * 0.96, 18, TANK);
  for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; g.bar([TX + Math.cos(a) * TR * 1.002, TY, TZ + Math.sin(a) * TR * 1.002], [TX + Math.cos(a) * TR * 0.962, TY + TH, TZ + Math.sin(a) * TR * 0.962], 0.012, shade(TANK, 0.75)); }
  for (const y of [0.35, 1.0, 1.65, 2.3]) g.cyl(TX, TZ, TY + y, TY + y + 0.05, TR * 1.01 - y * 0.015, TR * 1.01 - y * 0.015, 18, STEEL, { top: false });
  g.cyl(TX, TZ, TY + TH, TY + TH + 0.9, TR * 1.04, 0.06, 18, C('#5a4632'));
  g.bar([TX - 0.6, 0, TZ + 1.1], [TX - 0.6, TY + TH, TZ + 1.18], 0.03, STEEL); g.bar([TX - 0.95, 0, TZ + 1.1], [TX - 0.95, TY + TH, TZ + 1.18], 0.03, STEEL);
  for (let y = 0.3; y < TY + TH; y += 0.3) g.bar([TX - 0.95, y, TZ + 1.12], [TX - 0.6, y, TZ + 1.12], 0.02, STEEL);
  shadows.flat(TX, 0.006, TZ, 3.2, 3.2, [1, 1, 1]);
  /* ---------------------------------------------------------------- the stair bulkhead, with its lamp over the door */
  const BX0 = -5.9, BX1 = -3.3, BZ0 = 1.4, BZ1 = 4.6, BH = 2.6;
  g.box(BX0, 0, BZ0, BX1, BH, BZ1, C('#9a5a42')); g.box(BX0 - 0.1, BH, BZ0 - 0.1, BX1 + 0.1, BH + 0.15, BZ1 + 0.1, COPING);
  g.box(BX1, 0, 2.4, BX1 + 0.02, 2.1, 3.3, C('#2f4d6e')); g.box(BX1 + 0.02, 1.0, 2.48, BX1 + 0.03, 1.08, 2.55, C('#b8913f'));
  lampG.cyl(BX1 + 0.16, 2.85, 2.25, 2.4, 0.07, 0.09, 8, hc('#ffd9a0', 2.2)); g.box(BX1, 2.4, 2.78, BX1 + 0.2, 2.44, 2.92, STEEL);
  pools.flat(BX1 + 0.8, 0.01, 2.85, 2.6, 2.4, hc('#ffcf8a', 0.6));
  shadows.flat((BX0 + BX1) / 2, 0.006, (BZ0 + BZ1) / 2, 3.4, 4.0, [1, 1, 1]);
  // an AC unit and a vent
  g.box(4.6, 0, 3.0, 5.6, 0.8, 4.1, C('#9aa0a6')); for (let k = 0; k < 6; k++) g.box(4.59, 0.1 + k * 0.11, 3.1, 4.6, 0.15 + k * 0.11, 4.0, C('#5a5f66'), { top: false });
  g.cyl(-2.0, 4.6, 0, 0.9, 0.18, 0.18, 10, C('#8d8a84')); g.cyl(-2.0, 4.6, 0.9, 1.0, 0.28, 0.1, 10, C('#6b6862'));
  /* ---------------------------------------------------------------- plants along the back parapet; a crate with a thermos */
  for (let x = -1.8; x < 5.6; x += 0.9 + r() * 0.5) {
    const pr = 0.18 + r() * 0.12; g.cyl(x, Z0 + 0.4, 0, pr * 1.8, pr, pr * 0.8, 10, C(['#a5452f', '#8a6a4a', '#c9b49a'][Math.floor(r() * 3)]));
    for (let k = 0; k < 4; k++) g.blob(x + (r() - 0.5) * pr * 1.6, pr * 1.8 + 0.12 + r() * 0.35, Z0 + 0.4 + (r() - 0.5) * pr, pr * (0.7 + r() * 0.4), C(['#3f6b3a', '#4f7d44', '#5a8a4a', '#2f5a30'][k]), {}, 1.1);
  }
  g.box(2.0, 0, -0.55, 2.5, 0.42, -0.05, C('#a07a50')); g.cyl(2.18, -0.3, 0.42, 0.72, 0.05, 0.05, 8, C('#7a3b2e')); g.cyl(2.18, -0.3, 0.72, 0.76, 0.03, 0.03, 8, STEEL);
  /* ---------------------------------------------------------------- the folding table and chairs; the user's place */
  const TBX = 0.5, TBZ = -1.0, TBY = 0.74;
  g.box(TBX - 0.62, TBY - 0.03, TBZ - 0.36, TBX + 0.62, TBY, TBZ + 0.36, C('#e9e5dd'));
  for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) g.bar([TBX + dx, 0.05, TBZ + dz], [TBX + dx * 0.9, TBY - 0.03, TBZ + dz * 0.9], 0.03, STEEL);
  foldingChair(g, TBX, -0.4, Math.PI, C('#2f4d6e')); foldingChair(g, TBX - 0.2, -1.65, 0.15, C('#2f4d6e'));
  const seat = { x: TBX, z: -0.4, ry: Math.PI };
  laptop(g, glowG, TBX + 0.05, TBY, -0.82, Math.PI - 0.1);
  openBook(g, TBX - 0.38, TBY, -0.86, Math.PI + 0.3, '#a5452f');
  const cup = cupMesh(mats); cup.position.set(TBX + 0.4, TBY, -0.78); group.add(cup);
  const cupHome = cup.position.clone();
  // a lantern on the table (lit after dusk)
  g.box(TBX - 0.5, TBY, TBZ - 0.22, TBX - 0.38, TBY + 0.02, TBZ - 0.1, STEEL); lampG.cyl(TBX - 0.44, TBZ - 0.16, TBY + 0.02, TBY + 0.16, 0.04, 0.04, 8, hc('#ffcf8a', 1.8));
  pools.flat(TBX - 0.3, TBY + 0.004, TBZ, 1.3, 0.9, hc('#ffe0a8', 0.5));
  // the neighbour's deck chair by the tank
  const NX = -2.0, NZ = -0.2;
  g.box(NX - 0.3, 0.25, NZ - 0.35, NX + 0.3, 0.32, NZ + 0.35, C('#c9b49a')); g.quad([NX - 0.3, 0.32, NZ - 0.35], [NX + 0.3, 0.32, NZ - 0.35], [NX + 0.3, 0.95, NZ - 0.62], [NX - 0.3, 0.95, NZ - 0.62], C('#3f6b4e'));
  for (const dx of [-0.28, 0.28]) { g.bar([NX + dx, 0, NZ + 0.3], [NX + dx, 0.32, NZ + 0.3], 0.03, STEEL); g.bar([NX + dx, 0, NZ - 0.5], [NX + dx, 0.95, NZ - 0.62], 0.03, STEEL); }
  /* ---------------------------------------------------------------- string lights on poles */
  const poles = [[5.6, -4.6], [-5.6, -4.6], [5.6, 2.2], [-3.2, 1.3], [1.0, -4.6]];
  for (const [x, z] of poles) g.bar([x, 0, z], [x, 3.2, z], 0.06, C('#4a3826'));
  const strands = [[poles[0], poles[3]], [poles[1], poles[2]], [poles[4], poles[3]], [poles[0], poles[4]]];
  const bulbs = new Geo();
  for (const [a, b] of strands) {
    const n = 18, sag = 0.7;
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t), y = 3.15 - sag * 4 * t * (1 - t);
      if (prev) g.bar(prev, [x, y, z], 0.012, C('#1d1714'));
      if (k > 0 && k < n) bulbs.sphere(x, y - 0.06, z, 0.045, 6, 4, hc('#ffd9a0', 2.4));
      prev = [x, y, z];
    }
  }
  /* ---------------------------------------------------------------- the neighbour roofs below and around: blocks that fall away (lit windows at night) */
  const nb = new Geo(), nbw = new Geo();
  const blocks = [[-30, -24, -40, -14, -6], [-22, -8, -26, -12, -3], [8, 26, -30, -12, -4], [14, 36, -50, -30, 2], [-44, -28, -60, -38, 4], [-12, 6, -70, -40, -2], [9, 30, -16, 4, -5], [-30, -12, 2, 20, -7]];
  for (const [x0, x1, z0, z1, top] of blocks) {
    const col = C(['#7a5a48', '#8a6a52', '#6b5a50', '#9a8a78'][Math.floor(r() * 4)]);
    nb.box(x0, -30, z0, x1, top, z1, col); nb.box(x0 - 0.2, top, z0 - 0.2, x1 + 0.2, top + 0.4, z1 + 0.2, shade(col, 1.2));
    if (top > -6) for (let y = top - 2; y > top - 14; y -= 2.6) for (let x = x0 + 1; x < x1 - 1; x += 2.2) if (r() < 0.45) nbw.box(x, y, z1 + 0.02, x + 0.9, y + 1.3, z1 + 0.03, hc('#ffcf8a', 1.2), { top: false });
    if (r() < 0.6) { const tx = lerp(x0 + 2, x1 - 2, r()), tz = lerp(z0 + 2, z1 - 2, r()); nb.box(tx - 0.8, top, tz - 0.8, tx + 0.8, top + 1.6, tz + 0.8, STEEL); nb.cyl(tx, tz, top + 1.6, top + 3.6, 1.1, 1.05, 10, TANK); nb.cyl(tx, tz, top + 3.6, top + 4.2, 1.15, 0.05, 10, C('#5a4632')); }
  }

  /* ---------------------------------------------------------------- merge */
  const roomMesh = new THREE.Mesh(mergeColored([g.build(), nb.build()]), mats.solid); group.add(roomMesh);
  const lampMesh = new THREE.Mesh(mergeColored([lampG.build(), bulbs.build()]), mats.lamp); group.add(lampMesh);
  const glowMesh = new THREE.Mesh(glowG.build(), mats.glow); group.add(glowMesh);
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0 });
  const winMesh = new THREE.Mesh(nbw.build(), winMat); group.add(winMesh);
  const poolMesh = new THREE.Mesh(pools.build(), mats.pools); poolMesh.renderOrder = 3; group.add(poolMesh);
  const shadowMesh = new THREE.Mesh(shadows.build(), mats.blob); shadowMesh.renderOrder = 1; group.add(shadowMesh);
  // the skyline: a wide backdrop far to the south (the camera looks toward -z)
  const VW = 220, VH = 110, viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  viewMesh.position.set(0, VH / 2 - 42, -95); group.add(viewMesh);
  // rain and snow fall across the view (the same shader as the windows, as a sheet in the air)
  const rain = createGlass(18, 9); rain.mesh.position.set(0.5, 3.5, 2.6); group.add(rain.mesh);
  const pt = new THREE.PointLight(0xffc98a, 0, 7, 1.6); pt.position.set(TBX - 0.4, 1.4, TBZ); group.add(pt);
  const door = new THREE.PointLight(0xffc98a, 0, 6, 1.6); door.position.set(BX1 + 0.6, 2.2, 2.85); group.add(door);

  /* ---------------------------------------------------------------- the neighbour */
  const crowd = createCrowd([personLook(rng(5))]); group.add(crowd.mesh);
  const nbp = crowd.people[0]; nbp.root.position.set(NX, -0.18, NZ - 0.05); nbp.root.rotation.y = 0; setSit(nbp, -0.35);

  const fogCol = new THREE.Color();
  function outdoorSky(L, scene) {
    scene.background = L.top.clone().lerp(L.hor, 0.35);
    fogCol.copy(L.hor).lerp(L.top, 0.3); scene.fog.color.copy(fogCol); scene.fog.near = 40; scene.fog.far = 160 - 60 * Math.max(L.fog, L.rain * 0.6);
  }
  function sunDir(L) { const e = Math.max(0.1, L.elev); return new THREE.Vector3(0.55 * L.az + 0.2, -Math.sin(e) - 0.15, -Math.cos(e) * 0.8).normalize(); }
  function setLight(L) {
    mats.lamp.color.setScalar(0.35 + 0.75 * L.lamp * (0.3 + 0.7 * L.night)); mats.pools.color.setScalar(0.05 + 0.95 * L.lamp * L.night);
    winMat.opacity = clamp(L.night * 1.2 - 0.1, 0, 1); winMesh.visible = winMat.opacity > 0.02;
    pt.intensity = 1.6 * L.night; door.intensity = 1.4 * L.night;
    rain.set(L);
  }
  function setView(tex) {
    const m = viewMesh.material; if (m.map && m.map !== tex) m.map.dispose(); m.map = tex; m.needsUpdate = true;
    // the real render has its horizon near the middle (put it at eye level); the painted skyline stands on its bottom edge
    const real = tex.image && tex.image.width === 1280; viewMesh.position.y = real ? -1 : 44;
  }
  function update(t, motion) {
    rain.u.uTime.value = t;
    if (motion) { const c = (t + 5) % 20, k = c > 17 ? Math.sin((c - 17) / 3 * Math.PI) : 0; applyArms(nbp, [-1.1, 0.2, -1.1 - k * 0.3, -0.2 - k * 0.5, -0.35]); }
    else applyArms(nbp, [-1.1, 0.2, -1.1, -0.2, -0.35]);
    void seatedArms;
    crowd.skin();
  }
  update(0, false);

  const frames = { wide: { pos: [-0.5, 2.5, 5.6], target: [-1.1, 1.5, -6.0], fov: 50 }, tall: { pos: [0.2, 2.15, 3.6], target: [0.0, 1.3, -4.0], fov: 58 } };
  const routes = {
    seat: { x: seat.x, z: seat.z, ry: seat.ry }, standAt: [seat.x, 0.25],
    toStretch: [[seat.x, 0.25], [-0.9, 1.7]], stretch: { x: -0.9, z: 1.7, ry: 0 },
    toCoffee: [[-0.9, 1.7], [1.4, 0.9], [2.25, 0.35]], coffeeExit: false, coffee: { x: 2.25, z: 0.35, ry: Math.PI },
    fromCoffee: [[2.25, 0.35], [2.0, -2.2], [0.9, -4.0]], window: { x: 0.9, z: -4.0, ry: Math.PI },
    toSeat: [[0.9, -4.0], [1.9, -2.2], [1.6, 0.25], [seat.x, 0.25], [seat.x, seat.z]],
  };
  return {
    group, crowd, frames, seat, routes, cup, cupHome, view: { kind: 'skyline', seed: 41, far: true }, setView, setLight, update, outdoorSky,
    title: 'A rooftop in Morningside', others: 1, fog: { color: '#2a3550', near: 40, far: 160 }, background: '#1b2a4a',
    sunDir, interior: false, realView: { home: true, look: 'empire-state', up: 38, ahead: 80, lookUp: 150, fov: 46 },
    dispose() { group.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== crowd.mesh) { o.geometry.dispose(); if (o.material && !Object.values(mats).includes(o.material)) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } } }); crowd.dispose(); },
  };
}
