// city/spots/penthouse.js · "Your penthouse desk" (docs/COZY.md section 4.5): a quiet corner of the Billionaires' Row penthouse. A
// floor-to-ceiling glass wall over Central Park, pale oak floor, a marble desk facing the view with a brass lamp, a low bookcase, a
// rug and a reading chair. Nobody else is here. Opens once the user has lived in the penthouse (economy_catalog STUDY_SPOTS).
import * as THREE from 'three';
import { Geo, C, hc, rng, shade, clamp, Quads, mergeColored, laptop, openBook, booksZ, createGlass, paneTex } from './kit.js';
import { cupMesh } from './butler.js';

export function build(ctx) {
  const { mats } = ctx;
  const X0 = -5, X1 = 5, Z0 = -4, Z1 = 5, H = 3.6;
  const r = rng(1201);
  const group = new THREE.Group(); group.name = 'penthouse';
  const g = new Geo(), lampG = new Geo(), glowG = new Geo(), pools = new Quads(), shadows = new Quads();
  // pale oak floor, a rug, the plaster walls and ceiling
  for (let x = X0; x < X1 - 1e-3; x += 0.22) g.box(x, -0.04, Z0, x + 0.22, 0, Z1, shade(C('#c9ab84'), 0.9 + r() * 0.16), { sides: 0 });
  g.box(-2.6, 0, -1.0, 1.6, 0.012, 2.4, C('#d8cfc0'), { sides: 0 }); g.box(-2.45, 0.012, -0.85, 1.45, 0.016, 2.25, C('#a8b6c4'), { sides: 0 });
  g.box(X0 - 0.2, 0, Z0, X0, H, Z1, C('#f1ece2'), { sides: 4, top: false });
  g.box(X0, H, Z0, X1, H + 0.1, Z1, C('#f6f2ea'), { sides: 0, bottom: true, top: false });
  // the glass wall at the back (z = Z0): slim bronze mullions
  for (let x = X0; x <= X1 + 1e-3; x += 2.5) g.box(x - 0.04, 0, Z0 - 0.06, x + 0.04, H, Z0 + 0.02, C('#4a3f35'));
  g.box(X0, 0, Z0 - 0.06, X1, 0.08, Z0 + 0.04, C('#4a3f35')); g.box(X0, H - 0.08, Z0 - 0.06, X1, H, Z0 + 0.04, C('#4a3f35'));
  // the desk: a marble slab on two brass legs, facing the view; a lamp; the user's things
  const DX = 0.6, DZ = -2.2, DY = 0.76;
  g.box(DX - 0.9, DY - 0.05, DZ - 0.4, DX + 0.9, DY, DZ + 0.4, C('#ece8e2'));
  for (const s of [-1, 1]) g.box(DX + s * 0.8 - 0.03, 0, DZ - 0.32, DX + s * 0.8 + 0.03, DY - 0.05, DZ + 0.32, C('#b8913f'));
  shadows.flat(DX, 0.004, DZ, 2.2, 1.2, [1, 1, 1]);
  g.cyl(DX - 0.7, DZ - 0.2, DY, DY + 0.02, 0.08, 0.08, 10, C('#b8913f')); g.bar([DX - 0.7, DY, DZ - 0.2], [DX - 0.55, DY + 0.42, DZ - 0.12], 0.02, C('#b8913f'));
  g.cyl(DX - 0.55, DZ - 0.12, DY + 0.36, DY + 0.46, 0.04, 0.11, 10, C('#2b2f38')); lampG.cyl(DX - 0.55, DZ - 0.12, DY + 0.35, DY + 0.36, 0.09, 0.09, 8, hc('#ffe0a8', 2.0));
  pools.flat(DX - 0.45, DY + 0.004, DZ, 1.2, 0.9, hc('#ffe0a8', 0.55));
  const seat = { x: DX, z: DZ + 0.75, ry: Math.PI };
  g.box(DX - 0.25, 0.42, DZ + 0.55, DX + 0.25, 0.48, DZ + 0.97, C('#2b2f38')); g.box(DX - 0.25, 0.48, DZ + 0.92, DX + 0.25, 0.95, DZ + 0.98, C('#2b2f38')); g.cyl(DX, DZ + 0.75, 0, 0.42, 0.04, 0.04, 6, C('#b8913f'));
  laptop(g, glowG, DX, DY, DZ + 0.3, Math.PI);
  openBook(g, DX + 0.45, DY, DZ + 0.25, Math.PI - 0.2, '#2f4d6e');
  const cup = cupMesh(mats); cup.position.set(DX - 0.35, DY, DZ + 0.3); group.add(cup); const cupHome = cup.position.clone();
  // a low bookcase on the left wall, a reading chair, a plant
  g.box(X0, 0, -1.5, X0 + 0.4, 1.1, 2.5, C('#8a6a4a'));
  for (const y of [0.08, 0.58]) booksZ(g, -1.4, 2.4, y, X0 + 0.38, X0 + 0.05, r, 0.42);
  g.box(-3.0, 0, 1.6, -2.1, 0.42, 2.5, C('#a8b6c4')); g.box(-3.0, 0.42, 2.35, -2.1, 0.95, 2.5, C('#97a6b6')); g.box(-3.05, 0.2, 1.6, -2.95, 0.6, 2.5, C('#97a6b6')); g.box(-2.15, 0.2, 1.6, -2.05, 0.6, 2.5, C('#97a6b6'));
  g.cyl(3.9, -3.2, 0, 0.5, 0.26, 0.2, 10, C('#e9e5dd')); for (let k = 0; k < 8; k++) g.blob(3.9 + (r() - 0.5) * 0.6, 0.8 + r() * 1.0, -3.2 + (r() - 0.5) * 0.6, 0.25, C(['#3f6b3a', '#4f7d44'][k % 2]), {}, 1.2);

  const roomMesh = new THREE.Mesh(mergeColored([g.build()]), mats.solid); group.add(roomMesh);
  const lampMesh = new THREE.Mesh(lampG.build(), mats.lamp); group.add(lampMesh);
  const glowMesh = new THREE.Mesh(glowG.build(), mats.glow); group.add(glowMesh);
  const poolMesh = new THREE.Mesh(pools.build(), mats.pools); poolMesh.renderOrder = 3; group.add(poolMesh);
  const shadowMesh = new THREE.Mesh(shadows.build(), mats.blob); shadowMesh.renderOrder = 1; group.add(shadowMesh);
  const VW = 40, VH = 20, viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  viewMesh.position.set(0, VH / 2 - 7, Z0 - 9); group.add(viewMesh);
  const glass = createGlass(X1 - X0, H); glass.mesh.position.set(0, H / 2, Z0 - 0.03); group.add(glass.mesh);
  const patchMat = new THREE.MeshBasicMaterial({ map: paneTex(4, 1, false), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const patch = new Quads(); patch.flat(0, 0.006, Z0 + 2.2, X1 - X0, 4.0, [0.35, 0.3, 0.24]);
  const patchMesh = new THREE.Mesh(patch.build(), patchMat); patchMesh.renderOrder = 2; group.add(patchMesh);
  const lampLight = new THREE.PointLight(0xffc98a, 0, 6, 1.6); lampLight.position.set(DX - 0.5, 1.4, DZ + 0.2); group.add(lampLight);

  function sunDir(L) { const e = Math.max(0.1, L.elev); return new THREE.Vector3(0.4 * L.az, -Math.sin(e), Math.cos(e)).normalize(); }
  function setLight(L) {
    mats.lamp.color.setScalar(0.55 + 0.6 * L.lamp); mats.pools.color.setScalar(0.2 + 0.8 * L.lamp);
    lampLight.intensity = 1.6 * L.lamp; patchMat.color.setScalar(clamp(L.shafts, 0, 1)); patchMesh.visible = L.shafts > 0.03;
    glass.set(L);
  }
  function setView(tex) { const m = viewMesh.material; if (m.map && m.map !== tex) m.map.dispose(); m.map = tex; m.needsUpdate = true; }
  function update(t) { glass.u.uTime.value = t; }
  const frames = { wide: { pos: [2.6, 2.2, 4.4], target: [-0.2, 1.4, -4.0], fov: 50 }, tall: { pos: [1.9, 1.9, 2.6], target: [0.2, 1.2, -3.2], fov: 58 } };
  const routes = {
    seat: { ...seat }, standAt: [DX, DZ + 1.3], toStretch: [[DX, DZ + 1.3], [-0.6, 0.8]], stretch: { x: -0.6, z: 0.8, ry: 0 },
    toCoffee: [[-0.6, 0.8], [2.0, 2.6], [3.6, 4.4]], coffeeExit: true,
    fromCoffee: [[3.6, 4.4], [2.4, 0.2], [2.6, -3.3]], window: { x: 2.6, z: -3.3, ry: Math.PI },
    toSeat: [[2.6, -3.3], [1.9, -1.0], [DX, -0.9], [DX, seat.z]],
  };
  return {
    group, frames, seat, routes, cup, cupHome, view: { kind: 'park', seed: 3 }, setView, setLight, update,
    title: 'Your penthouse desk', others: 0, fog: { color: '#2a2420', near: 20, far: 60 }, background: '#1c1815',
    sunDir, interior: true, realView: null,
    dispose() { group.traverse((o) => { if (o.isMesh || o.isPoints) { o.geometry.dispose(); if (o.material && !Object.values(mats).includes(o.material)) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } } }); },
  };
}
