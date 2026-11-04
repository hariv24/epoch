// city/spots/outdoor.js · the open-air study spots (docs/COZY.md section 4.5), smaller scenes than Butler:
//   'steps'  the Low Library steps and the South Lawn: wide limestone steps rising to the colonnade, lawns and trees on both sides,
//            students on the steps, the user on a stone bench at the foot with a laptop
//   'mall'   Central Park's Mall: the elm canopy over a long straight walk, benches and lamp posts down both sides, people strolling,
//            a coffee cart; the user on a bench facing the walk
// Both follow the hour and the weather (rain and snow fall across the view). No statues, no faces, no lettering.
import * as THREE from 'three';
import {
  Geo, C, hc, rng, shade, clamp, lerp, Quads, createCrowd, personLook, mergeColored, laptop, createGlass, setSit, setStand, setWalk, seatedArms, applyArms,
} from './kit.js';
import { cupMesh } from './butler.js';

function bench(g, x, z, ry, wood, iron) {
  const c = Math.cos(ry), s = Math.sin(ry), P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const slab = (lx0, y0, lz0, lx1, y1, lz1, col) => { const a = P(lx0, lz0), b = P(lx1, lz1), q = P(lx0, lz1), d = P(lx1, lz0); g.box(Math.min(a[0], b[0], q[0], d[0]), y0, Math.min(a[1], b[1], q[1], d[1]), Math.max(a[0], b[0], q[0], d[0]), y1, Math.max(a[1], b[1], q[1], d[1]), col); };
  for (let k = 0; k < 3; k++) slab(-0.9, 0.42, -0.2 + k * 0.14, 0.9, 0.46, -0.1 + k * 0.14, wood);
  for (let k = 0; k < 2; k++) slab(-0.9, 0.6 + k * 0.16, -0.27, 0.9, 0.7 + k * 0.16, -0.24, wood);
  for (const lx of [-0.8, 0.8]) { slab(lx - 0.03, 0, -0.22, lx + 0.03, 0.42, 0.2, iron); slab(lx - 0.03, 0.42, -0.28, lx + 0.03, 0.9, -0.22, iron); }
}
function lampPost(g, lampG, x, z) {
  g.cyl(x, z, 0, 0.25, 0.12, 0.1, 8, C('#23262d')); g.cyl(x, z, 0.25, 3.4, 0.05, 0.04, 8, C('#23262d'));
  g.cyl(x, z, 3.4, 3.48, 0.16, 0.16, 8, C('#23262d')); lampG.cyl(x, z, 3.48, 3.85, 0.13, 0.17, 8, hc('#ffe0a8', 2.0)); g.cyl(x, z, 3.85, 3.95, 0.2, 0.04, 8, C('#23262d'));
}
function tree(g, x, z, h, r, col, rr) {
  g.cyl(x, z, 0, h * 0.62, 0.16, 0.11, 7, C('#4a3826'));
  for (let k = 0; k < 6; k++) g.blob(x + (rr() - 0.5) * r * 1.2, h * (0.62 + rr() * 0.3), z + (rr() - 0.5) * r * 1.2, r * (0.55 + rr() * 0.35), shade(C(col), 0.85 + rr() * 0.3), {}, 0.8);
}

export function build(ctx) {
  const { mats } = ctx, mall = ctx.variant === 'mall';
  const r = rng(mall ? 901 : 450);
  const group = new THREE.Group(); group.name = mall ? 'mall' : 'steps';
  const g = new Geo(), lampG = new Geo(), glowG = new Geo(), pools = new Quads(), shadows = new Quads();
  const WOOD = C('#7a5a3a'), IRON = C('#23262d'), LIME = C('#ddd3bf');
  let seat, frames, routes, people = [], walkers = [], view, title;

  if (!mall) {
    /* ---- the plaza, the lawns, the steps, the colonnade at the top ---- */
    g.box(-14, -0.1, -16, 14, 0, 10, C('#cbbfa8'), { sides: 0 });
    for (let x = -14; x < 14; x += 1.4) g.box(x, 0, -16, x + 0.02, 0.003, 10, C('#b9ad96'), { sides: 0 });
    for (const [x0, x1] of [[-14, -6.5], [6.5, 14]]) g.box(x0, 0, -1, x1, 0.06, 10, C('#5c7d4a'), { sides: 1 | 2 | 4 | 8 });
    const SN = 14, SD = 0.42, SR = 0.15, SZ0 = -2;
    for (let k = 0; k < SN; k++) g.box(-6.5, 0, SZ0 - (k + 1) * SD, 6.5, (k + 1) * SR, SZ0 - k * SD, shade(LIME, k % 2 ? 0.95 : 1.02));
    const topY = SN * SR, topZ = SZ0 - SN * SD;
    g.box(-9, 0, topZ - 6, 9, topY, topZ, LIME);
    for (let k = -4; k <= 4; k++) g.cyl(k * 1.4, topZ - 1.4, topY, topY + 6.5, 0.32, 0.3, 12, C('#e6dcc8'));
    g.box(-7, topY + 6.5, topZ - 2.2, 7, topY + 7.6, topZ - 0.8, C('#e2d8c4')); g.box(-7.2, topY + 7.6, topZ - 2.4, 7.2, topY + 7.9, topZ - 0.6, C('#d4c9b2'));
    g.box(-7, topY, topZ - 6, 7, topY + 7.6, topZ - 2.2, C('#cfc4ae'));
    for (let k = -4; k <= 4; k++) lampG.box(k * 1.4 - 0.4, topY + 1.0, topZ - 2.21, k * 1.4 + 0.4, topY + 3.6, topZ - 2.2, hc('#ffcf8a', 1.0), { top: false });
    for (const [x, z] of [[-10, 2], [-11, -6], [10, 1], [11.5, -7], [-9, 7], [9.5, 7.5]]) { tree(g, x, z, 7 + r() * 2, 2.4, '#4f7d44', r); shadows.flat(x, 0.07, z, 5, 5, [1, 1, 1]); }
    for (const x of [-6.8, 6.8]) lampPost(g, lampG, x, 0.5);
    pools.flat(-6.8, 0.07, 0.5, 4, 4, hc('#ffcf8a', 0.6)); pools.flat(6.8, 0.07, 0.5, 4, 4, hc('#ffcf8a', 0.6));
    // the user's bench at the foot of the steps, facing the lawn (we look past them up the steps)
    bench(g, 1.2, 0.6, Math.PI, WOOD, IRON); shadows.flat(1.2, 0.004, 0.6, 2.4, 1.0, [1, 1, 1]);
    seat = { x: 1.6, z: 0.62, ry: Math.PI };
    laptop(g, glowG, 1.6, 0.6, 0.18, Math.PI);
    g.box(0.95, 0.46, 0.5, 1.25, 0.5, 0.75, C('#2f4d6e'));                                   // a notebook on the bench
    // students on the steps: sitting, reading; two walk up and down
    const lr = rng(12), looks = []; for (let i = 0; i < 7; i++) looks.push(personLook(lr));
    const crowd = createCrowd(looks); group.add(crowd.mesh); people = crowd.people;
    const sits = [[-4.2, 3, 0], [-2.6, 5, 0.2], [3.5, 2, -0.1], [5.0, 6, 0], [-0.8, 8, 0.1]];
    sits.forEach(([x, k, ry], i) => { const p = people[i]; p.root.position.set(x, k * SR - 0.46 + 0.0, SZ0 - k * SD + 0.12); p.root.rotation.y = ry; setSit(p); p.st = { act: ['read', 'write', 'type', 'read', 'think'][i], ph: i * 1.7 }; });
    walkers = [people[5], people[6]].map((p, i) => ({ p, x: i ? 2.6 : -1.6, ph: i * 9 }));
    group.userData.crowd = crowd;
    view = { kind: 'campus', seed: 5 }; title = 'Low Library steps';
    frames = { wide: { pos: [3.0, 2.6, 7.4], target: [-0.4, 2.2, -6.0], fov: 50 }, tall: { pos: [2.6, 2.0, 4.6], target: [0.6, 1.6, -4.0], fov: 58 } };
    routes = {
      seat: { ...seat }, standAt: [1.6, 1.2], toStretch: [[1.6, 1.2], [3.2, 2.2]], stretch: { x: 3.2, z: 2.2, ry: 0 },
      toCoffee: [[3.2, 2.2], [7.5, 4.5], [12, 6]], coffeeExit: true,
      fromCoffee: [[12, 6], [7.5, 4.5], [3.6, 0.2], [3.6, -1.6]], window: { x: 3.6, z: -1.6, ry: Math.PI },
      toSeat: [[3.6, -1.6], [2.6, 1.2], [1.6, 1.2], [1.6, 0.62]],
    };
  } else {
    /* ---- the Mall: the walk, the lawns, two rows of elms meeting overhead, benches and lamps ---- */
    g.box(-12, -0.1, -40, 12, 0, 12, C('#4f6d3d'), { sides: 0 });
    g.box(-3.2, 0, -40, 3.2, 0.02, 12, C('#c7b89a'), { sides: 0 });
    for (const s of [-1, 1]) {
      g.box(s * 3.2 - 0.1, 0, -40, s * 3.2 + 0.1, 0.12, 12, C('#8d8a84'));
      for (let z = 10; z > -40; z -= 5.5) { tree(g, s * 4.6, z, 9 + r() * 2, 3.4, '#3f6b3a', r); shadows.flat(s * 4.6, 0.025, z, 6, 6, [1, 1, 1]); }
      for (let z = 8; z > -36; z -= 5.5) bench(g, s * 3.6, z - 2.6, s > 0 ? -Math.PI / 2 : Math.PI / 2, WOOD, IRON);
      for (let z = 6; z > -38; z -= 11) { lampPost(g, lampG, s * 3.45, z); pools.flat(s * 3.0, 0.03, z, 4, 4, hc('#ffcf8a', 0.6)); }
    }
    // the canopy overhead: a few big soft masses
    for (let z = 10; z > -40; z -= 3.2) g.blob((r() - 0.5) * 3, 10.5 + r() * 1.5, z, 3.2 + r(), shade(C('#3a6234'), 0.8 + r() * 0.3), {}, 0.45);
    // a coffee cart on the walk
    g.box(-2.5, 0.25, -6.2, -1.2, 1.1, -5.4, C('#2f4d6e')); g.box(-2.6, 1.1, -6.3, -1.1, 1.14, -5.3, C('#e9e5dd'));
    g.box(-2.7, 2.0, -6.5, -1.0, 2.06, -5.1, C('#a5452f')); for (const x of [-2.6, -1.1]) g.bar([x, 1.14, -5.8], [x, 2.0, -5.8], 0.03, IRON);
    for (const dx of [-2.3, -1.4]) g.cyl(dx, -5.25, 0, 0.5, 0.25, 0.25, 10, IRON);
    lampG.box(-2.45, 1.9, -6.2, -1.25, 1.98, -5.4, hc('#ffd9a0', 1.6), { top: false, bottom: true });
    // the user's bench on the right side, facing the walk
    seat = { x: 3.62, z: -2.2, ry: -Math.PI / 2 };
    laptop(g, glowG, 3.2, 0.6, -2.2, -Math.PI / 2);
    const lr = rng(77), looks = []; for (let i = 0; i < 7; i++) looks.push(personLook(lr));
    const crowd = createCrowd(looks); group.add(crowd.mesh); people = crowd.people;
    [[-3.62, -7.8, Math.PI / 2], [-3.62, 3.2, Math.PI / 2], [3.62, -13.2, -Math.PI / 2]].forEach(([x, z, ry], i) => { const p = people[i]; p.root.position.set(x, 0, z); p.root.rotation.y = ry; setSit(p); p.st = { act: ['read', 'think', 'write'][i], ph: i * 2.3 }; });
    const bar = people[3]; bar.root.position.set(-1.85, 0, -6.9); bar.root.rotation.y = 0; setStand(bar); bar.st = null;
    walkers = [people[4], people[5], people[6]].map((p, i) => ({ p, x: [-1.4, 1.2, 0.2][i], ph: i * 13 }));
    group.userData.crowd = crowd;
    view = { kind: 'park', seed: 9 }; title = 'Central Park, the Mall';
    frames = { wide: { pos: [-1.6, 2.2, 7.5], target: [1.4, 1.5, -6.0], fov: 52 }, tall: { pos: [0.4, 2.0, 4.2], target: [2.4, 1.3, -3.6], fov: 58 } };
    routes = {
      seat: { ...seat }, standAt: [3.0, -2.2], toStretch: [[3.0, -2.2], [1.8, -0.6]], stretch: { x: 1.8, z: -0.6, ry: 0 },
      toCoffee: [[1.8, -0.6], [-0.6, -4.2], [-1.85, -4.8]], coffeeExit: false, coffee: { x: -1.85, z: -4.8, ry: Math.PI },
      fromCoffee: [[-1.85, -4.8], [0.4, -3.4], [2.2, -1.2]], window: { x: 2.2, z: -1.2, ry: Math.PI },
      toSeat: [[2.2, -1.2], [3.0, -2.2], [3.62, -2.2]],
    };
  }
  const crowd = group.userData.crowd;
  const cup = cupMesh(mats);
  const cupHome = mall ? new THREE.Vector3(3.62, 0.46, -1.55) : new THREE.Vector3(2.15, 0.46, 0.62); cup.position.copy(cupHome); group.add(cup);

  /* ---- merge; the backdrop; rain across the view ---- */
  const roomMesh = new THREE.Mesh(mergeColored([g.build()]), mats.solid); group.add(roomMesh);
  const lampMesh = new THREE.Mesh(lampG.build(), mats.lamp); group.add(lampMesh);
  const glowMesh = new THREE.Mesh(glowG.build(), mats.glow); group.add(glowMesh);
  const poolMesh = new THREE.Mesh(pools.build(), mats.pools); poolMesh.renderOrder = 3; group.add(poolMesh);
  const shadowMesh = new THREE.Mesh(shadows.build(), mats.blob); shadowMesh.renderOrder = 1; group.add(shadowMesh);
  const VW = 200, VH = 100, viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(VW, VH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  viewMesh.position.set(0, VH / 2 - 30, -80); group.add(viewMesh);
  const rain = createGlass(18, 9); rain.mesh.position.set(0.5, 3.5, mall ? 3 : 4); group.add(rain.mesh);

  const fogCol = new THREE.Color();
  function outdoorSky(L, scene) {
    scene.background = L.top.clone().lerp(L.hor, 0.35);
    fogCol.copy(L.hor).lerp(L.top, 0.3); scene.fog.color.copy(fogCol); scene.fog.near = 30; scene.fog.far = 120 - 50 * Math.max(L.fog, L.rain * 0.6);
  }
  function sunDir(L) { const e = Math.max(0.1, L.elev); return new THREE.Vector3(0.6 * L.az + 0.25, -Math.sin(e) - 0.2, -Math.cos(e) * 0.6).normalize(); }
  function setLight(L) {
    mats.lamp.color.setScalar(0.3 + 0.8 * L.lamp * (0.25 + 0.75 * L.night)); mats.pools.color.setScalar(0.04 + 0.96 * L.lamp * L.night);
    rain.set(L);
  }
  function setView(tex) { const m = viewMesh.material; if (m.map && m.map !== tex) m.map.dispose(); m.map = tex; m.needsUpdate = true; }
  function update(t, motion) {
    rain.u.uTime.value = t;
    for (const p of people) if (p.st) applyArms(p, seatedArms(motion ? p.st.act : 'read', motion ? t : 0, p.st.ph));
    for (const w of walkers) {
      const L2 = mall ? 44 : 26, d = motion ? ((t * 1.1 + w.ph * 3) % (2 * L2)) : w.ph, fw = d < L2, z = mall ? (fw ? 10 - d : 10 - (2 * L2 - d)) : (fw ? 8 - d : 8 - (2 * L2 - d));
      w.p.root.position.set(w.x + (fw ? 0 : 0.8), mall ? 0 : Math.max(0, Math.min(14 * 0.15, (-2 - z) / 0.42 * 0.15)), z);
      w.p.root.rotation.y = fw ? Math.PI : 0;
      if (motion) setWalk(w.p, t * 7 + w.ph); else setStand(w.p);
    }
    crowd.skin();
  }
  update(0, false);
  void clamp; void lerp;
  return {
    group, crowd, frames, seat, routes, cup, cupHome, view, setView, setLight, update, outdoorSky,
    title, others: people.length, fog: { color: '#2a3550', near: 30, far: 120 }, background: '#1b2a4a',
    sunDir, interior: false, realView: null,
    dispose() { group.traverse((o) => { if ((o.isMesh || o.isPoints) && o !== crowd.mesh) { o.geometry.dispose(); if (o.material && !Object.values(mats).includes(o.material)) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } } }); crowd.dispose(); },
  };
}
