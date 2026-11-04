// city/mh_flow.js · the flow meter on the real city. Eight tall brass streetlights stand along the avenue nearest the user's block
// (Broadway or Amsterdam, from streets.json); every hour of unbroken focus ("flow") lights one more, one at a time with a little
// flicker like a real lamp warming up. The next lamp glows faintly and grows as the current hour fills. No XP, nothing is lost when
// the chain ends: the lamps just go quiet. Same API as city/flow.js: set({hours_lit, minutes?, to_next_hour_min?, active?}), update().
import * as THREE from 'three';
import { Geo, rgb, clamp } from './util.js';
import { createCityMaterial } from './shader.js';

export const FLOW_LAMPS = 8;

/** eight points along the avenue nearest (cx, cz): [{x, z, nx, nz}] (n = unit normal to the kerb side that faces the block) */
export function lampSites(streets, cx, cz, step = 26) {
  let best = null, bd = 1e18;
  for (const l of streets.lines) {
    if (l.c !== 1 && l.c !== 0) continue;
    const p = l.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz; if (L2 < 1) continue;
      const t = clamp(((cx - ax) * dx + (cz - az) * dz) / L2, 0, 1), qx = ax + dx * t, qz = az + dz * t, d = (qx - cx) ** 2 + (qz - cz) ** 2 + (l.c === 1 ? 0 : 150 * 150);
      if (d < bd) { bd = d; best = { l, i, t }; }
    }
  }
  if (!best) return [];
  // walk the polyline both ways from the nearest point, then take eight evenly spaced points centred on it
  // best.i indexes the flat [x, z, ...] array, lens indexes points
  const p = best.l.p, pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const bi = best.i / 2, s0 = lens[bi] + best.t * (lens[bi + 1] - lens[bi]), total = lens[lens.length - 1];
  const at = (s) => { s = clamp(s, 0, total); let i = 1; while (i < lens.length - 1 && lens[i] < s) i++; const a = pts[i - 1], b = pts[i], u = (s - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]), dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return { x: a[0] + dx * u, z: a[1] + dz * u, dx: dx / L, dz: dz / L }; };
  const out = [], half = (best.l.w || 18) / 2 + 2.2, start = clamp(s0 - step * (FLOW_LAMPS - 1) / 2, 0, Math.max(0, total - step * (FLOW_LAMPS - 1)));
  for (let k = 0; k < FLOW_LAMPS; k++) {
    const q = at(start + k * step); let nx = -q.dz, nz = q.dx;
    if ((cx - q.x) * nx + (cz - q.z) * nz < 0) { nx = -nx; nz = -nz; }                    // the kerb on the block's side
    out.push({ x: q.x + nx * half, z: q.z + nz * half, nx, nz });
  }
  return out;
}

export function createFlow({ scene, shared, radial, sites, TR }) {
  const g = new Geo(), steel = rgb('#2b3f63'), brass = rgb('#d9cdb2'), dim = rgb('#1d2c48');      // Morningside: navy iron, limestone collars
  const H = 7.2;
  const ys = sites.map((s) => (TR ? TR.ground(s.x, s.z) : 0));
  sites.forEach((s, i) => {
    const x = s.x, z = s.z, y = ys[i];
    g.box(x - 0.45, y, z - 0.45, x + 0.45, y + 0.6, z + 0.45, steel); g.box(x - 0.3, y + 0.6, z - 0.3, x + 0.3, y + 1.1, z + 0.3, brass);
    g.bar([x, y + 1.1, z], [x, y + H, z], 0.26, steel); g.bar([x, y + 2.8, z], [x, y + 3.0, z], 0.5, brass);
    g.cyl(x, z, y + H, y + H + 0.35, 0.55, 0.45, 8, brass); g.cyl(x, z, y + H + 1.7, y + H + 2.3, 0.62, 0.0, 8, dim);                     // lantern cap and crown
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.bar([x + Math.cos(a) * 0.5, y + H + 0.35, z + Math.sin(a) * 0.5], [x + Math.cos(a) * 0.58, y + H + 1.7, z + Math.sin(a) * 0.58], 0.09, brass); }
  });
  const { mat } = createCityMaterial(shared, { ao: 0 });
  const poles = new THREE.Mesh(g.build(), mat); poles.frustumCulled = false; poles.name = 'flow-poles'; poles.visible = sites.length > 0; scene.add(poles);
  const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), FLOW_LAMPS);
  globes.frustumCulled = false; globes.name = 'flow-globes'; globes.count = sites.length; scene.add(globes);
  const dm = new THREE.Object3D(), col = new THREE.Color();
  sites.forEach((s, i) => { dm.position.set(s.x, ys[i] + H + 1.0, s.z); dm.updateMatrix(); globes.setMatrixAt(i, dm.matrix); });
  globes.instanceMatrix.needsUpdate = true;
  const halos = sites.map((s, i) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: new THREE.Color(1.0, 0.76, 0.42), transparent: true, opacity: 0, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    sp.position.set(s.x, ys[i] + H + 1.0, s.z); sp.scale.setScalar(2); sp.visible = false; sp.renderOrder = 7; scene.add(sp); return sp;
  });
  // a warm pool of light on the avenue under each lit lamp
  const pools = sites.map((s, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color(1.0, 0.74, 0.42), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    m.position.set(s.x, ys[i] + 0.35, s.z); m.scale.setScalar(16); m.visible = false; m.renderOrder = 3; scene.add(m); return m;
  });

  const lamps = sites.map((s, i) => ({ i, on: false, lvl: 0, startAt: 0 }));
  let hours = 0, nextFrac = 0, motion = true;
  function paint(now) {
    lamps.forEach((l, i) => {
      let k = l.lvl;
      if (l.on && l.lvl < 0.995 && motion) k *= 0.72 + 0.28 * Math.sin(now * 38 + i * 9.1) * Math.sin(now * 23 + i);     // warm-up flicker
      globes.setColorAt(i, col.setRGB(0.42 + 2.4 * k, 0.5 + 1.7 * k, 0.66 + 0.5 * k).multiplyScalar(k < 0.02 ? 0.28 : 1));
      const h = halos[i]; h.visible = k > 0.03; h.material.opacity = 0.6 * k; h.scale.setScalar(3 + 14 * k);
      const p = pools[i]; p.visible = k > 0.03; p.material.opacity = 0.5 * k;
    });
    if (globes.instanceColor) globes.instanceColor.needsUpdate = true;
  }
  function set(f, now) {
    f = f || {};
    const n = clamp(Math.round(f.hours_lit != null ? f.hours_lit : f.hours != null ? f.hours : 0), 0, FLOW_LAMPS);
    const prev = hours; hours = n;
    nextFrac = f.to_next_hour_min != null ? clamp(1 - f.to_next_hour_min / 60, 0, 1) : f.minutes != null ? clamp((f.minutes % 60) / 60, 0, 1) : 0;
    if (f.active === false && f.hours_lit == null) hours = 0;
    lamps.forEach((l, i) => {
      if (i < hours) { if (!l.on) { l.on = true; l.startAt = motion ? now + Math.max(0, i - prev) * 0.55 + 0.1 : now; if (!motion) l.lvl = 1; } }
      else { l.on = false; if (!motion) l.lvl = 0; }
    });
    paint(now);
  }
  /** returns true while a lamp is still changing */
  function update(dt, now, on) {
    motion = on; let busy = false;
    lamps.forEach((l, i) => {
      let tgt = 0;
      if (l.on) { if (now >= l.startAt) tgt = 1; else tgt = l.lvl; }
      else if (i === hours && nextFrac > 0.02 && hours < FLOW_LAMPS) tgt = 0.1 + 0.2 * nextFrac * (motion ? 0.8 + 0.2 * Math.sin(now * 2) : 1);   // the next lamp warms up as the hour fills
      const k = on ? 1 - Math.exp(-dt * (tgt > l.lvl ? 9 : 2.5)) : 1;
      const d = tgt - l.lvl; if (Math.abs(d) > 0.004) { l.lvl += d * k; busy = true; } else l.lvl = tgt;
      if (l.on && now < l.startAt) busy = true;
    });
    if (busy) paint(now);
    return busy || (on && lamps.some((l) => !l.on && l.lvl > 0.01));
  }
  paint(0);
  return { set, update, poles, globes, lamps, sites, get hours() { return hours; } };
}
