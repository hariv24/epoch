// city/flow.js · the flow meter. Eight tall brass streetlights stand along the front street of this week's block; every hour of
// unbroken focus ("flow") lights one more, left to right, one at a time with a little flicker like a real lamp warming up.
// The next lamp glows faintly and grows as the current hour fills. No XP, nothing is lost when the chain ends: the lamps just go quiet.
//   setFlow({hours_lit, minutes?, to_next_hour_min?, active?})
import * as THREE from 'three';
import { Geo, rgb, clamp, smooth } from './util.js';
import { createCityMaterial } from './shader.js';
import { LOT_D } from './towers.js';

export const FLOW_LAMPS = 8;

export function createFlow({ scene, L, shared, radial, setPool }) {
  const z = L.rowZ[L.rows - 1] + LOT_D / 2 + 0.2, xs = Array.from({ length: FLOW_LAMPS }, (_, i) => -5.25 + i * 1.5);
  const g = new Geo(), steel = rgb('#2b3f63'), brass = rgb('#d9cdb2'), dim = rgb('#1d2c48');      // Morningside: navy iron, limestone collars
  for (const x of xs) {
    g.box(x - 0.045, 0, z - 0.045, x + 0.045, 0.05, z + 0.045, steel); g.box(x - 0.03, 0.05, z - 0.03, x + 0.03, 0.09, z + 0.03, brass);
    g.bar([x, 0.09, z], [x, 0.6, z], 0.026, steel); g.bar([x, 0.24, z], [x, 0.26, z], 0.05, brass);
    g.bar([x, 0.6, z], [x, 0.69, z + 0.03], 0.02, steel); g.bar([x, 0.69, z + 0.03], [x, 0.7, z + 0.09], 0.02, steel);
    g.cyl(x, z + 0.1, 0.62, 0.645, 0.052, 0.042, 8, brass); g.cyl(x, z + 0.1, 0.78, 0.84, 0.062, 0.0, 8, dim);                  // lantern cap and crown
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.bar([x + Math.cos(a) * 0.052, 0.645, z + 0.1 + Math.sin(a) * 0.052], [x + Math.cos(a) * 0.058, 0.78, z + 0.1 + Math.sin(a) * 0.058], 0.008, brass); }
  }
  const { mat } = createCityMaterial(shared, { ao: 0 });
  const poles = new THREE.Mesh(g.build(), mat); poles.frustumCulled = false; poles.name = 'flow-poles'; scene.add(poles);
  const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.058, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), FLOW_LAMPS);
  globes.frustumCulled = false; globes.name = 'flow-globes'; scene.add(globes);
  const dm = new THREE.Object3D(), col = new THREE.Color();
  dm.scale.setScalar(1); xs.forEach((x, i) => { dm.position.set(x, 0.715, z + 0.1); dm.updateMatrix(); globes.setMatrixAt(i, dm.matrix); });
  globes.instanceMatrix.needsUpdate = true;
  const halos = xs.map((x) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: new THREE.Color(1.0, 0.76, 0.42), transparent: true, opacity: 0, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    s.position.set(x, 0.715, z + 0.1); s.scale.setScalar(0.05); s.visible = false; s.renderOrder = 7; scene.add(s); return s;
  });

  const lamps = xs.map((x, i) => ({ x, i, on: false, lvl: 0, startAt: 0, poolOn: false }));
  let hours = 0, frac = 0, motion = true, nextFrac = 0;

  function paint(now) {
    lamps.forEach((l, i) => {
      let k = l.lvl;
      if (l.on && l.lvl < 0.995 && motion) k *= 0.72 + 0.28 * Math.sin(now * 38 + i * 9.1) * Math.sin(now * 23 + i);     // warm-up flicker
      const warm = k > 0.5;
      globes.setColorAt(i, col.setRGB(0.42 + 2.4 * k, 0.5 + 1.7 * k, 0.66 + 0.5 * k).multiplyScalar(k < 0.02 ? 0.28 : 1));
      const h = halos[i]; h.visible = k > 0.03; h.material.opacity = 0.6 * k; h.scale.setScalar(0.1 + 0.55 * k);
      if (warm !== l.poolOn) { l.poolOn = warm; setPool('f' + i, warm ? [l.x, z + 0.2, 0.55, new THREE.Color(1.0, 0.74, 0.42), 0.6] : null); }
    });
    globes.instanceColor.needsUpdate = true;
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
  return { set, update, poles, globes, lamps, get hours() { return hours; } };
}
void smooth;
