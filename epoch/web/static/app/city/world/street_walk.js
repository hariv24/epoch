// city/world/street_walk.js · slice 2 (docs/WORLD.md §13): Hariv walks the generated W 123rd St. attachWalk(street, o) adds, to a mounted street (street.js):
// the colliders (building edges, the lot-line fence, stoop cheeks, tree guards and trunks, lamps, hydrants, signs) fed to world/controller.js, groundAt(x, z)
// (roadway crown, kerbs eased over 0.25 m, the 124 stoop's treads), Hariv (a second hariv.glb, feet on the treads by two-bone leg IK), the spring-arm rig
// (world/cam.js) outdoors (arm 3.0 m, 1.5-5.0, pitch -30..+35), keyboard + click input and the door rules (124's door goes home; others: "Not your place").
//   const W = await attachWalk(streetApi, { motion(), toast(text), onHome(), hourFn() })   -> { spawn(), update, groundAt, ctl, rig, P, rec(on), samples, stats(), ... }
// Frame: x east, z south (street.js); 124 is on the south side (front z = 11, facing north = -z), its stoop on the east end of the facade.
import { createController, KEYS } from './controller.js';
import { createRig } from './cam.js';
import { loadPerson, makeContactShadow } from './people.js';

const D2R = Math.PI / 180, R_CAP = 0.22, WALK = 1.4, RUN = 3.0, TURN = 540 * D2R;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ss = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

export async function attachWalk(S, o = {}) {
  const THREE = S.THREE, data = S.data, col = S.collide, motion = o.motion || (() => true);
  if (!data || !col) throw new Error('street not built');
  const street = data.street.street, rd = street.roadbed / 2, lineW = street.sidewalk0.lineW, lineE = street.sidewalk0.lineE, asw = street.sidewalk0.aveSidewalk;
  const kerbW = lineW - asw, kerbE = lineE + asw, ROAD = 18.48, LOT = street.half;               // far kerbs 18.48 m beyond; the lot line 9.144 m from the centreline
  const B = { X0: kerbW - ROAD, X1: kerbE + ROAD, Z0: -13, Z1: 13 };
  if (o.district) Object.assign(B, o.district.bounds);
  const stoops = col.stoops || [], D = o.district || null;                         // slice 3: the streamed district (district.js), or null = the slice-2 street only

  /* ---- ground height */
  function stoopY(x, z) {
    for (const s of stoops) {
      if (Math.abs(x - s.xd) > s.sw / 2 + 0.02) continue;
      const d = s.n * (z - s.zf); if (d < -0.05 || d > s.depthMax) continue;
      if (d <= s.land) return s.Hb;
      const idx = (d - s.land) / s.tread, k = Math.min(s.N - 1, Math.floor(idx)), fr = idx - k;
      return Math.max(0, s.Hb - s.rise * (k + ss(fr / 0.3)));
    }
    return null;
  }
  function groundAt(x, z) {
    if (D && !(Math.abs(z) < rd + 0.3 && x >= kerbW - 0.3 && x <= kerbE + 0.3)) { const sy0 = stoopY(x, z); return sy0 != null ? sy0 : D.groundAt(x, z); }
    const sy = stoopY(x, z); if (sy != null) return sy;
    const az = Math.abs(z), inSt = x >= kerbW && x <= kerbE;
    const road = inSt ? -0.07 - (0.09 * Math.min(az, rd)) / rd : -0.16;
    const k = ss((az - rd) / 0.25) * ss((x - kerbW) / 0.25) * ss((kerbE - x) / 0.25);
    return road * (1 - k);
  }

  /* ---- colliders (controller) and the camera's boxes (cam.js: [x0,y0,z0,x1,y1,z1]) */
  const obbs = [], circles = [], vols = [], cyls = [], push = (b, kind, name) => vols.push({ name, kind, b });
  const edgeObb = (a, b, half, hgt, name, kind) => {
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez); if (L < 0.05) return;
    obbs.push({ n: name, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hw: L / 2 + half, hd: half, ry: Math.atan2(-ez, ex) });
    if (hgt) { const x0 = Math.min(a[0], b[0]) - half, x1 = Math.max(a[0], b[0]) + half, z0 = Math.min(a[1], b[1]) - half, z1 = Math.max(a[1], b[1]) + half; push([x0, 0, z0, x1, hgt, z1], kind || 'wall', name); }
  };
  for (const p of col.polys) {                                                          // every building: its outline is a wall (and a full-height box for the camera)
    const pts = p.pts, n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (Math.min(a[1], b[1]) > 14 && Math.max(a[1], b[1]) > 14) { push([Math.min(a[0], b[0]) - 0.1, 0, Math.min(a[1], b[1]) - 0.1, Math.max(a[0], b[0]) + 0.1, p.h, Math.max(a[1], b[1]) + 0.1], 'wall', 'facade ' + (p.bin || '')); continue; }
      if (Math.max(Math.abs(a[1]), Math.abs(b[1])) < 4) continue;
      edgeObb(a, b, 0.2, p.h, 'bldg ' + (p.bin || ''));
    }
  }
  for (const f of [data.south, data.north]) for (const r of f.buildings) if (r.front && (r.angledBay || r.rusticated)) {                    // bays project ~0.7 m above the base
    const F = r.front, zs = [F.z, F.z + F.n * 0.75].sort((a, b) => a - b); push([F.x0, 1.5, zs[0], F.x1, r.h, zs[1]], 'wall', 'bay ' + (r.num || ''));
  }
  // the lot-line fence on both sides: a wall with a gap at every stoop
  for (const sd of [-1, 1]) {
    const z = sd * LOT, gaps = stoops.filter((s) => Math.sign(s.zf) === sd).map((s) => [s.xd - 0.95, s.xd + 0.95]).sort((a, b) => a[0] - b[0]);
    let x = D ? lineW : B.X0; const segs = [];                                   // with the district, W 123rd's own lot line only (the avenue sidewalks are open)
    for (const g of gaps) { if (g[0] > x) segs.push([x, g[0]]); x = Math.max(x, g[1]); } segs.push([x, D ? lineE : B.X1]);
    for (const [a, b] of segs) edgeObb([a, z], [b, z], 0.05, 1.0, 'fence', 'fence');
  }
  for (const s of stoops) {                                                              // cheek walls / railings and the stoop mass
    for (const sx of [-1, 1]) {
      const rx = s.xd + sx * (s.sw / 2 + 0.14), zc = s.zf + s.n * (s.depthMax / 2);
      obbs.push({ n: 'cheek ' + s.num, x: rx, z: zc, hw: s.cheek, hd: s.depthMax / 2 + 0.03, ry: 0 });
      for (let k = 0; k <= s.N; k++) {                                                 // the camera's cheek/railing boxes step down with the treads (one 2.3 m box over the whole run blocked the arm all the way down)
        const d0 = k === 0 ? -0.05 : s.land + (k - 1) * s.tread, d1 = k === 0 ? s.land : Math.min(s.depthMax, s.land + k * s.tread), za = s.zf + s.n * d0, zb = s.zf + s.n * d1;
        push([rx - s.cheek, 0, Math.min(za, zb), rx + s.cheek, Math.max(0.95, s.Hb - s.rise * Math.max(0, k - 1) + 0.9), Math.max(za, zb)], 'wall', 'cheek ' + s.num);
      }
    }
    for (let k = 0; k <= s.N; k++) {                                                   // the stoop mass for the camera, stepped like the treads
      const d0 = k === 0 ? 0 : s.land + (k - 1) * s.tread, d1 = k === 0 ? s.land : Math.min(s.depthMax, s.land + k * s.tread), za = s.zf + s.n * d0, zb = s.zf + s.n * d1, top = s.Hb - s.rise * k;
      if (top > 0.02) push([s.xd - s.sw / 2, 0, Math.min(za, zb), s.xd + s.sw / 2, top, Math.max(za, zb)], 'wall', 'stoop ' + s.num);
    }
  }
  for (const c of col.circles) {
    const [x, z, r] = c; circles.push({ n: 'prop', x, z, r });
    if (r > 0.3) {                                                                      // a street tree: trunk + guard (3 rails, open to the kerb) + the low canopy
      const sd = Math.sign(z), zb = z + sd * 0.6;
      edgeObb([x - 0.75, zb], [x + 0.75, zb], 0.04, 0.5, 'guard', 'fence');
      for (const px of [x - 0.75, x + 0.75]) edgeObb([px, z - sd * 0.6], [px, zb], 0.04, 0.5, 'guard', 'fence');
      cyls.push([x, z, 0.2, 6]); push([x - 2.2, 3.5, z - 2.2, x + 2.2, 11, z + 2.2], 'wall', 'canopy');                 // the trunk is a thin pole for the camera (cam.js cyls)
    } else if (r > 0.2) push([x - r, 0, z - r, x + r, 0.8, z + r], 'wall', 'hydrant');
    else if (r > 0.12) cyls.push([x, z, 0.14, 9]);                                    // lamp posts and signal poles: a small circle, not an inflated box (the camera is pushed round it)
    else cyls.push([x, z, 0.06, 3.3]);
  }
  if (S.data && S.data.street && S.cars !== false) {                                  // parked cars (cars.js): blocks for the walker and the camera; the kerb-side sidewalk stays free
    const { layoutCars } = await import('./cars.js');
    for (const c of layoutCars(S.data.street)) { obbs.push({ n: 'car', x: c.x, z: c.z, hw: c.hl, hd: c.hw, ry: 0 }); push([c.x - c.hl, 0, c.z - c.hw, c.x + c.hl, 1.46, c.z + c.hw], 'wall', 'car'); }
  }
  const near = (q) => Math.abs(q.z) < 16;
  const ctl = createController({ obbs: obbs.filter(near), circles, walls: [], bounds: B }, { radius: R_CAP, grid: D ? 40 : 1.0, stats: { minClear: 9 } });
  const baseSolids = ctl.solids.slice(), baseCyls = cyls.slice();
  // slice 3: the colliders of the streamed units near the walker replace the dynamic part of the controller's solids (and the camera rig's boxes + poles)
  let dynAt = [1e9, 1e9, -1], dynCount = 0;
  function syncDyn(force) {
    if (!D) return;
    if (!force && Math.hypot(pos.x - dynAt[0], pos.z - dynAt[1]) < 5 && dynAt[2] === D.rev) return;
    const c = D.collidersNear(pos.x, pos.z, 70); dynAt = [pos.x, pos.z, D.rev];
    const sol = ctl.solids; sol.length = 0; for (const b of baseSolids) sol.push(b);
    for (const b of c.obbs) { if (Math.hypot(b.x - pos.x, b.z - pos.z) > 70 + b.hw) continue; sol.push({ n: b.n, x: b.x, z: b.z, hx: b.hw, hz: b.hd, c: Math.cos(b.ry || 0), s: Math.sin(b.ry || 0) }); }
    for (const q of c.circles) sol.push({ n: q.n, circle: true, x: q.x, z: q.z, r: q.r });
    cyls.length = 0; for (const q of baseCyls) cyls.push(q); for (const q of c.cyls) cyls.push(q);
    rig.setExtra(c.vols.map((v) => v.b)); dynCount = sol.length;
  }

  /* ---- Hariv */
  const P = await loadPerson('hariv.glb'); S.world.add(P.root);
  P.root.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; if (n.material) for (const m of [].concat(n.material)) m.clippingPlanes = null; } });
  const blob = makeContactShadow(0.75, 0.55, 0.5); S.world.add(blob);
  const root = P.root, pos = { x: 0, z: 0 };
  let yaw = Math.PI, anim = 'idle', speed = 0, fwdWalk = false, active = false, leaving = false, ankleH = 0.08, ikOn = true, clock = 0, lastToast = -9, moved = 0;
  const keys = new Set();

  // two-bone leg IK: the foot goes by the difference between the ground under it and the ground under the root (stoop treads, kerbs)
  const B_ = P.bones, v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  function rotateWorld(bone, from, to) {                                                    // turn `bone` so the world direction `from` becomes `to`
    qa.setFromUnitVectors(from, to); bone.getWorldQuaternion(qb); qb.premultiply(qa); bone.parent.getWorldQuaternion(qc); bone.quaternion.copy(qc.invert().multiply(qb)); bone.updateMatrixWorld(true);
  }
  function leg(side, dy) {
    const hip = B_[side + 'UpLeg'], knee = B_[side + 'Leg'], foot = B_[side + 'Foot']; if (!hip || !knee || !foot) return;
    const H = hip.getWorldPosition(new THREE.Vector3()), K = knee.getWorldPosition(new THREE.Vector3()), A = foot.getWorldPosition(new THREE.Vector3());
    const T = A.clone(); T.y += dy;
    const l1 = H.distanceTo(K), l2 = K.distanceTo(A), vT = T.clone().sub(H), d0 = vT.length(), d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, d0));
    const dirT = vT.normalize(), ha = A.clone().sub(H).normalize(), kp = K.clone().sub(H); kp.addScaledVector(ha, -kp.dot(ha));
    if (kp.lengthSq() < 1e-8) kp.set(0, 0, 1); kp.normalize(); kp.addScaledVector(dirT, -kp.dot(dirT)); kp.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const K2 = H.clone().addScaledVector(dirT, a).addScaledVector(kp, h);
    const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
    rotateWorld(hip, K.clone().sub(H).normalize(), K2.clone().sub(H).normalize());
    const K3 = knee.getWorldPosition(v1), A3 = foot.getWorldPosition(v2);
    rotateWorld(knee, A3.clone().sub(K3).normalize(), T.clone().sub(K3).normalize());
    foot.parent.getWorldQuaternion(qc); foot.quaternion.copy(qc.invert().multiply(footQ)); foot.updateMatrixWorld(true);
  }
  const footPos = (side) => (B_[side + 'Foot'] ? B_[side + 'Foot'].getWorldPosition(v3) : v3.set(0, 0, 0));
  // three's mixer only writes a bone when its sampled value changed since its last write, so on a frame where the clip value repeats the bone keeps LAST frame's
  // IK pose and the IK would stack on top of it (the 43.6 cm one-frame foot pop on every stoop descent). The leg bones go back to their animated pose first.
  const legBones = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].map((k) => B_[k]).filter(Boolean), animQ = legBones.map(() => new THREE.Quaternion());
  let animSaved = false;
  const legsToAnim = () => { if (animSaved) legBones.forEach((b, i) => b.quaternion.copy(animQ[i])); };
  const saveAnim = () => { legBones.forEach((b, i) => animQ[i].copy(b.quaternion)); animSaved = true; };
  let ikErr = 0;
  let shift = 0, pel = null;
  function applyIK(dt) {
    root.updateMatrixWorld(true);
    const g0 = groundAt(pos.x, pos.z), fl = footPos('Left').clone(), fr = footPos('Right').clone();
    const dyL = groundAt(fl.x, fl.z) - g0, dyR = groundAt(fr.x, fr.z) - g0;
    const want = Math.max(-0.75, Math.min(0.5, Math.min(dyL, dyR)));                      // the pelvis goes to the lower foot's ground (a straight stance leg cannot reach lower); the other leg lifts onto its tread
    // the pelvis eases both ways (down fast, up a little slower): a one-frame 17.5 cm pelvis drop read as a pop; the stance foot stays on its tread either way
    // on the absolute height, so the root's own tread edges (g0) do not reach the pelvis either
    const tgt = g0 + want; pel = pel == null || !motion() || Math.abs(tgt - pel) > 0.8 ? tgt : pel + (tgt - pel) * (1 - Math.exp(-dt / (tgt < pel ? 0.035 : 0.07)));
    shift = pel - g0; root.position.y = pel; root.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      const f = footPos(side), dy = groundAt(f.x, f.z) - root.position.y;
      if (Math.abs(dy) > 0.01) leg(side, dy);
    }
    root.updateMatrixWorld(true);
  }

  /* ---- the camera rig */
  const camB = { X0: B.X0 - 12, X1: B.X1 + 12, Z0: D ? B.Z0 - 12 : -40, Z1: D ? B.Z1 + 12 : 40 };
  const rig = createRig({ THREE, camera: S.camera, canvas: S.canvas, vols, cyls, dividers: [], bounds: camB, RH: 60, person: P, motion, kick: () => S.loop.kick(), state: () => 'free', hint: () => ({ fwd: fwdWalk, yaw }),
    opt: { PITCH0: -10 * D2R, PMIN: -30 * D2R, PMAX: 35 * D2R, ARM0: 3.0, ARM_MIN: 1.5, ARM_MAX: 5.0, EYE: 1.55, CEIL: 30, SWING: true } });

  /* ---- doors */
  const doorOf = (s) => ({ x: s.xd, z: s.zf - s.n * 0.3, y0: s.Hb, y1: s.Hb + 2.4 });
  const dOf = (s, x, z) => s.n * (z - s.zf);
  function toast(t) { if (clock - lastToast < 2.5) return; lastToast = clock; if (o.toast) o.toast(t); }
  function useDoor(s) { if (leaving) return; if (s.num === '124') { leaving = true; keys.clear(); if (o.onHome) o.onHome(); } else toast('Not your place'); }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const onDown = (e) => { if (e.isPrimary && e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    const d = down; down = null; if (!active || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
    const r = S.canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, S.camera);
    for (const s of stoops) {
      const dr = doorOf(s); if (Math.abs(ray.ray.direction.z) < 1e-6) continue;
      const t = (dr.z - ray.ray.origin.z) / ray.ray.direction.z; if (t <= 0) continue;
      const px = ray.ray.origin.x + ray.ray.direction.x * t, py = ray.ray.origin.y + ray.ray.direction.y * t;
      if (Math.abs(px - dr.x) < 0.6 && py > dr.y0 && py < dr.y1) {
        if (Math.hypot(pos.x - dr.x, pos.z - dr.z) < 4.5 && s.num === '124') return useDoor(s);
        return toast(s.num === '124' ? 'Walk up to your door' : 'Not your place');
      }
    }
  };
  const typing = () => { const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true; return !!document.querySelector('dialog[open], [aria-modal="true"], .drawer.is-open, .modal.is-open, [data-drawer-open]'); };
  const onKeyDown = (e) => { const k = KEYS[e.code]; if (!active || !k || e.ctrlKey || e.metaKey || e.altKey || typing()) return; if (e.code.startsWith('Arrow')) e.preventDefault(); keys.add(k); if (k !== 'run') rig.release(); S.loop.kick(); };
  const onKeyUp = (e) => { const k = KEYS[e.code]; if (k) keys.delete(k); };
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
  S.canvas.addEventListener('pointerdown', onDown); S.canvas.addEventListener('pointerup', onUp);

  /* ---- recording (debug): one sample per frame */
  let recOn = false; const samples = [];
  const stat = { frames: 0, stuck: 0, jitter: 0, inside: 0, minClear: 9 };

  /* ---- the frame */
  const turnTo = (want, dt) => { const d = wrap(want - yaw), s = TURN * dt; yaw = Math.abs(d) <= s ? want : yaw + Math.sign(d) * s; root.rotation.y = yaw; };
  const loco = (name) => { if (anim === name) return; anim = name; if (motion()) P.play(name, { fade: 0.3 }); else P.still('idle', 0); };
  let qx = NaN, intro = false, tween = 0;
  function step(dt) {
    if (!active) return false;
    clock += dt; stat.frames++;
    const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), kz = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0), run = keys.has('run');
    let busy = false; fwdWalk = false;
    const p0x = pos.x, p0z = pos.z;
    if (D) { D.update(S.camera.position, false); syncDyn(false); }
    ctl.unstick(pos, dt, true);
    if (intro && (kx || kz)) { intro = false; tween = 0.001; }                                  // the stepping-out shot hands over to the follow camera behind him (0.45 s)
    if (tween > 0) {
      tween += dt; const d = wrap(yaw + Math.PI - rig.yaw); rig.look((d * (motion() ? 1 - Math.exp(-dt / 0.1) : 1)) / D2R, 0);
      if (Math.abs(d) < 0.35 || tween > 0.9) tween = 0;
    }
    if ((kx || kz) && !leaving && tween === 0) {
      const az = rig.yaw, fx = -Math.sin(az), fz = -Math.cos(az), rx = -fz, rz = fx;
      let dx = fx * kz + rx * kx, dz = fz * kz + rz * kx; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const sp = run ? RUN : WALK; fwdWalk = kz > 0 && !kx;
      const m = ctl.moveBy(pos, dx * sp * dt, dz * sp * dt), v = dt > 0 ? m / dt : 0;
      speed += (v - speed) * (1 - Math.exp(-dt / 0.06));
      const moving = speed > (anim === 'walk' || anim === 'run' ? 0.15 : 0.25);
      turnTo(moving && m > 1e-5 ? Math.atan2(ctl.lastMove.x, ctl.lastMove.z) : Math.atan2(dx, dz), dt);
      loco(moving ? (run ? 'run' : 'walk') : 'idle'); if (P.mixer) P.mixer.timeScale = motion() ? (moving ? Math.min(1.15, Math.max(0.45, speed / sp)) : 1) : 1;
      busy = true;
      for (const s of stoops) {                                                         // walking into a door
        const d = dOf(s, pos.x, pos.z);
        if (Math.abs(pos.x - s.xd) < 0.7 && d > 0 && d < 0.75 && s.Hb - groundAt(pos.x, pos.z) < 0.05 && (-s.n * dz) > 0.5 * Math.hypot(dx, dz)) useDoor(s);
      }
    } else { loco('idle'); if (P.mixer) P.mixer.timeScale = 1; speed = 0; }
    root.position.set(pos.x, groundAt(pos.x, pos.z), pos.z); root.rotation.y = yaw;
    legsToAnim(); if (motion()) P.update(dt); else P.still('idle', 0);
    saveAnim(); if (ikOn) applyIK(dt);
    blob.position.set(pos.x, root.position.y + 0.01, pos.z); blob.visible = true;
    const camBusy = rig.update(dt);
    const qz = D ? Math.round(pos.z / 6) * 6 : 0, q = Math.round(pos.x / 6) * 6 + qz * 1e5; if (q !== qx) { qx = q; S.placeSun(Math.round(pos.x / 6) * 6, qz); }
    if (D && (pos.x < B.X0 + 0.9 || pos.x > B.X1 - 0.9 || pos.z < B.Z0 + 0.9 || pos.z > B.Z1 - 0.9)) toast('Unlocks with more of Harlem');
    if (recOn) {
      const rep = rig.report(); const L = footPos('Left').clone(), R = footPos('Right').clone();
      const eL = L.y - (groundAt(L.x, L.z) + ankleH), eR = R.y - (groundAt(R.x, R.z) + ankleH);
      samples.push({ t: clock, dt, x: pos.x, z: pos.z, y: root.position.y, v: Math.hypot(pos.x - p0x, pos.z - p0z) / Math.max(dt, 1e-4), W: fwdWalk ? 1 : (kx || kz ? 2 : 0), ins: ctl.hit(pos.x, pos.z, R_CAP - 0.02) ? 1 : 0, anim,
        cam: rep.pos, minPole: rep.minPole, swing: rep.swingDeg, occ: rep.occludedBy, ndc: rep.headNdc, fade: rep.fade, minWall: rep.minWall, inWall: rep.inWall, vis: rep.harivVisible, arm: rep.arm, eP: Math.min(Math.abs(eL), Math.abs(eR)), eL, eR, st: stoopY(pos.x, pos.z) != null ? 1 : 0 });
    }
    return busy || camBusy || motion();
  }
  S.setStep(step);

  /* ---- enter / leave */
  function spawn() {
    const s = stoops.find((q) => q.num === '124') || stoops[0], d = 0.5;
    leaving = false; keys.clear(); pel = null; pos.x = s.xd - 0.35; pos.z = s.zf + s.n * d; yaw = s.n > 0 ? 0 : Math.PI; speed = 0; anim = 'idle';
    root.position.set(pos.x, groundAt(pos.x, pos.z), pos.z); root.rotation.y = yaw; ctl.resetEject();
    if (motion()) P.play('idle', { fade: 0, restart: true }); else P.still('idle', 0);
    P.update(0); root.updateMatrixWorld(true);
    const f = footPos('Left'); ankleH = Math.max(0.03, f.y - root.position.y);
    rig.enable(true); S.camera.near = 0.15; S.camera.updateProjectionMatrix(); rig.setLook((yaw + Math.PI) / D2R, -12); rig.snap(); intro = false; tween = 0;   // the look is behind him (W goes to the street); the wall is behind, so the shot swings to the free side (cam.js SWING)
    qx = NaN; step(0.0001); S.loop.kick();
  }
  function setActive(on) { active = !!on; if (on) { S.setWalk(true); S.setPreRender(null); } else { keys.clear(); } }
  const api = {
    spawn, setActive, step, groundAt, stoopY, ctl, rig, P, vols, stoops, obbs, B, get active() { return active; }, get leaving() { return leaving; }, pos, root,
    leg, footPos, rec(on) { recOn = !!on; if (on) samples.length = 0; }, samples, ankleH: () => ankleH, setIK(v) { ikOn = !!v; },
    press(code) { const k = KEYS[code]; if (k) { keys.add(k); if (k !== 'run') rig.release(); S.loop.kick(); } }, release(code) { const k = KEYS[code]; if (k) keys.delete(k); },
    syncDyn, get dynCount() { return dynCount; }, D,
    tp(x, z, yw) { pel = null; pos.x = x; pos.z = z; if (yw != null) yaw = yw; if (D) { D.update(S.camera.position, true); syncDyn(true); } ctl.resetEject(); root.position.set(x, groundAt(x, z), z); root.rotation.y = yaw; rig.snap(); S.loop.kick(); },
    useDoor: (num) => { const s = stoops.find((q) => q.num === (num || '124')); if (s) useDoor(s); },
    status() { return { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), y: +root.position.y.toFixed(3), yawDeg: +(yaw / D2R).toFixed(0), anim, speed: +speed.toFixed(2), cam: rig.report() }; },
    dispose() { active = false; window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); S.canvas.removeEventListener('pointerdown', onDown); S.canvas.removeEventListener('pointerup', onUp); rig.dispose(); P.dispose(); },
  };
  return api;
}
