// city/life.js · tiny life: yellow cabs on the avenues and streets, a ferry on the Hudson, a flock of birds at dusk,
// blinking aircraft lights. Everything here is cheap (instanced) and only moves while the scene is "awake".
// Under reduced motion nothing moves: cars sit on their lanes, lights stay steady, the flock is hidden.
import * as THREE from 'three';
import { Geo, rgb, shade, KIND, rng, clamp } from './util.js';
import { createCityMaterial } from './shader.js';

function carGeo() {
  const g = new Geo(), white = [1, 1, 1], glass = rgb('#16223a'), tyre = rgb('#17182c');
  g.box(-0.25, 0.035, -0.115, 0.25, 0.115, 0.115, white, {});
  g.box(-0.14, 0.115, -0.1, 0.12, 0.2, 0.1, white, {});
  g.box(-0.125, 0.125, -0.103, 0.105, 0.185, 0.103, glass, {});
  for (const [x, z] of [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]]) g.box(x - 0.045, 0, z - 0.012, x + 0.045, 0.06, z + 0.012, tyre, {});
  for (const z of [-0.07, 0.07]) { g.box(0.248, 0.06, z - 0.025, 0.262, 0.095, z + 0.025, rgb('#fff0c0'), { kind: KIND.glow }); g.box(-0.262, 0.06, z - 0.025, -0.248, 0.095, z + 0.025, rgb('#ff8a7a'), { kind: KIND.glow }); }
  g.box(-0.03, 0.2, -0.035, 0.05, 0.235, 0.035, rgb('#fff6d0'), { kind: KIND.glow });
  return g;
}

export function createCars(L, shared, parent) {
  const { mat } = createCityMaterial(shared, { litP: 0, ao: 0 });
  const geo = carGeo().build();
  const routes = [];
  const zA = L.zBack + 0.8, zB = L.zFront - 3.6;
  // avenues (north-south): two lanes each
  for (const sx of [-1, 1]) {
    routes.push({ ax: 'z', fixed: sx * 5.88, from: zB, to: zA, speed: 0.55 });     // northbound lane
    routes.push({ ax: 'z', fixed: sx * 6.62, from: zA, to: zB, speed: 0.5 });      // southbound lane
  }
  // cross streets in front of and between the rows (east-west)
  const sz = [L.b0 + L.PZ * 0, L.bN];
  for (let k = 1; k < L.rows; k++) sz.push(L.b0 + L.PZ * k);
  sz.forEach((z, i) => { routes.push({ ax: 'x', fixed: z + (i % 2 ? 0.2 : -0.2), from: i % 2 ? L.HW - 0.8 : -L.HW + 0.8, to: i % 2 ? -L.HW + 0.8 : L.HW - 0.8, speed: 0.42 }); });
  const cars = [], r = rng(5);
  const colours = ['#ffc43a', '#ffc43a', '#ffc43a', '#ffc43a', '#e8e4f6', '#6f9ad0', '#ffc43a', '#d98aa8'];
  routes.forEach((rt, i) => { const n = i % 3 === 0 ? 2 : 1; for (let k = 0; k < n; k++) cars.push({ rt, off: (k * 0.5 + r() * 0.35 + i * 0.13) % 1, col: new THREE.Color(colours[(i + k * 3) % colours.length]) }); });
  const mesh = new THREE.InstancedMesh(geo, mat, cars.length); mesh.frustumCulled = false; mesh.name = 'cars';
  cars.forEach((c, i) => mesh.setColorAt(i, c.col));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function update(t) {
    cars.forEach((c, i) => {
      const rt = c.rt, len = Math.abs(rt.to - rt.from), u = (((t * rt.speed) / len + c.off) % 1 + 1) % 1;
      const along = rt.from + (rt.to - rt.from) * u, dir = Math.sign(rt.to - rt.from);
      if (rt.ax === 'z') { p.set(rt.fixed, -0.05, along); q.setFromAxisAngle(up, dir > 0 ? -Math.PI / 2 : Math.PI / 2); }
      else { p.set(along, -0.05, rt.fixed); q.setFromAxisAngle(up, dir > 0 ? 0 : Math.PI); }
      const edge = Math.min(u, 1 - u) * len, k = clamp(edge / 0.6, 0.001, 1);
      s.setScalar(k); m.compose(p, q, s); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  parent.add(mesh);
  return { mesh, update, mat };
}

export function createFerry(L, shared, parent) {
  const { mat } = createCityMaterial(shared, { litP: 0.9, pitch: 0.18, fill: [0.7, 0.6], ao: 0.1 });
  const g = new Geo(), hull = rgb('#ece6da'), navy = rgb('#17396a'), org = rgb('#ff9a52');
  g.box(-0.9, 0, -0.26, 0.9, 0.1, 0.26, navy, {});
  g.frustum(0.9, 0, 0, 0.1, 0.0, 0.52, 0.36, 0.52, navy);
  g.box(-0.85, 0.1, -0.25, 0.85, 0.3, 0.25, hull, { win: true });
  g.box(-0.6, 0.3, -0.2, 0.55, 0.5, 0.2, shade(hull, 0.95), { win: true });
  g.box(-0.62, 0.5, -0.22, 0.57, 0.53, 0.22, org, {});
  g.cyl(0.0, 0.0, 0.53, 0.76, 0.07, 0.06, 8, org); g.cyl(-0.3, 0, 0.53, 0.72, 0.06, 0.05, 8, org);
  g.box(0.1, 0.53, -0.025, 0.14, 0.6, 0.025, rgb('#fff6d0'), { kind: KIND.glow });
  const geo = g.build();
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.name = 'ferry'; mesh.scale.setScalar(0.62);
  const x = -(L.HW + L.waterW - 1.15), zA = L.zBack + 1.5, zB = L.zFront - 2.2;
  function update(t) {
    const len = zB - zA, u = ((t * 0.28) / len + 0.35) % 1, z = zB - u * len;
    mesh.position.set(x, -0.5, z); mesh.rotation.y = -Math.PI / 2 + Math.sin(t * 0.6) * 0.01;
    mesh.position.y = -0.5 + Math.sin(t * 1.1) * 0.015;
    const e = Math.min(u, 1 - u) * len, k = clamp(e / 1.2, 0.001, 1); mesh.scale.setScalar(0.62 * k);
  }
  update(0); parent.add(mesh);
  return { mesh, update };
}

export function createBirds(parent) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.5, 0.12, 0.18, -0.5, 0.0, 0.24, 0, 0, 0, 0.5, 0.12, 0.18, 0.5, 0.0, 0.24], 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0x13203a, side: THREE.DoubleSide, fog: true });
  const N = 9, mesh = new THREE.InstancedMesh(g, mat, N); mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'birds';
  const r = rng(11), seeds = Array.from({ length: N }, () => ({ dx: (r() - 0.5) * 5, dz: (r() - 0.5) * 3, dy: (r() - 0.5) * 1.2, ph: r() * 6.28 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function update(t, L) {
    const span = 90, u = ((t * 1.4 + 20) % span) - span / 2;
    for (let i = 0; i < N; i++) {
      const b = seeds[i], flap = 0.35 + Math.abs(Math.sin(t * 7 + b.ph)) * 0.9;
      p.set(u + b.dx - 20, 13 + b.dy + Math.sin(t * 0.3 + i) * 0.4, L.zBack + 4 + b.dz); q.setFromAxisAngle(up, Math.PI / 2 * 0 + 0);
      s.set(1, flap, 1); m.compose(p, q, s); mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0, { zBack: -10 });
  parent.add(mesh);
  return { mesh, update };
}
