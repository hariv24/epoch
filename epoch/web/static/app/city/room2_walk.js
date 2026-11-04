// city/room2_walk.js · walking + furniture use for Room v2 (docs/ROOM-V2.md §6, §13.2 item 2). Created by room2.js once Hariv is loaded.
// Keys: arrows / WASD move him relative to the camera (Walking 1.4 m/s, Shift = running 3.0 m/s, turn 540 deg/s, 0.3 s crossfades).
// Collision: a capsule (r = 0.25 m, a circle in plan) against the room's world volumes (furniture, walls, dividers; the archway and doorway
// openings are gaps between wall boxes) with sliding. Click / tap: furniture -> A* on a 0.1 m grid -> walk -> Stand To Sit where it fits ->
// the activity, placed by people_fit (the PEOPLE-SPEC §10.2 gate). No hand-held props. After 25 s idle a routine by local time takes over.
// Debug: window.__room2.walk { status(), clickAnchor(id), clickFloor(x, z), press(code), release(code), fit(id), minClear }
import * as THREE from 'three';
import { createController, KEYS } from './world/controller.js';

const D2R = Math.PI / 180, R_CAP = 0.22, WALK = 1.4, RUN = 3.0, TURN = 540 * D2R, GRID = 0.1, GRID_PAD = +(new URLSearchParams(location.search).get('pad') ?? 0), AUTO_AFTER = 25, AUTO_ON = new URLSearchParams(location.search).get('auto') !== '0';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rot = (yaw, x, z) => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];   // root-local -> world offset (three's rotation.y)

export function createWalker(c) {
  const { camera, canvas, controls, P, vols, bounds: B, host } = c;
  /* Fit with the two heavy solvers made "ask the worker, then retry": in async mode a solve that is not memoised yet records its request and throws NEED;
   * preplanAsync() runs it in the fit worker (people.js), memoises the result and replays the plan (inputs are replayed identically: the chair / desk
   * tweaks are snapshotted and restored). A click (sync mode) still solves inline, using any memoised result. No main-thread task is longer than the
   * sampled cloud's per-frame step. */
  const NEED = { need: true }, memo = new Map(), cids = new WeakMap(); let cidN = 0, asyncMode = false, wanted = null;
  const Fit = Object.assign(Object.create(null), c.Fit, {
    solve(cloud, v, base, o) { return heavy('solve', cloud, v, base, null, o, () => c.Fit.solve(cloud, v, base, o)); },
    bookOnThighs(cloud) { return heavy('book', cloud, null, null, null, null, () => c.Fit.bookOnThighs(cloud)); },
    findStandSpot(cloud, v, near, yaw, o) { return heavy('stand', cloud, v, near, yaw, o, () => c.Fit.findStandSpot(cloud, v, near, yaw, o)); },
  });
  function heavy(op, cloud, v, a, b, o, inline) {
    let id = cids.get(cloud); if (!id) cids.set(cloud, id = ++cidN);
    const k = op + id + JSON.stringify([v, a, b, o]); if (memo.has(k)) return memo.get(k);
    if (asyncMode) { wanted = { op, cloud, v, a, b, o, k }; throw NEED; }
    return inline();
  }
  const root = P.root, pos = { x: root.position.x, z: root.position.z }, motion = c.motion;
  const stats = { minClear: 9, frames: 0 };
  let yaw = root.rotation.y, anim = 'idle', st = 'free', job = null, auto = false, idleFor = 0, jobSince = 0, clock = 0, disposed = false;
  let pending = null, path = null, pathI = 0, faceYaw = null, timer = 0, book = null, lastText = '', routineI = 0, stuck = 0, lastDist = 0, doorT = 0, doorOpen = false, doorWant = false, card = null, pendingClick = 0;
  const keys = new Set(), plans = new Map(), reports = {};

  /* ---------------------------------------------------------------- collision + A* */
  /* Oriented footprints (ROOM-V2 §15.2): a piece that was placed carries its own box (centre, half extents, rotation); walls and counters are axis-aligned boxes;
   * thin poles and plants are circles. Rugs (top < 0.12 m) never block. The body is a circle of R_CAP; contacts are resolved by pushing it out along the normal. */
  const solids = vols.filter((v) => v.kind !== 'floor' && v.kind !== 'footrest' && v.b[1] < 1.0 && v.b[4] > 0.12);
  const wd = { obbs: [], circles: [], bounds: B };
  for (const v of solids) {
    const o = v.ob, n = v.name;
    if (o && o.r) wd.circles.push({ n, x: o.x, z: o.z, r: o.r });
    else if (o && /^plant_/.test(n)) wd.circles.push({ n, x: o.x, z: o.z, r: Math.min(0.22, Math.max(o.hx, o.hz) * 0.8) });
    else if (o && Math.min(o.hx, o.hz) * 2 < 0.15) wd.circles.push({ n, x: o.x, z: o.z, r: 0.12 });
    else if (o) wd.obbs.push({ n, x: o.x, z: o.z, hw: o.hx, hd: o.hz, ry: o.ry });
    else wd.obbs.push({ n, x: (v.b[0] + v.b[3]) / 2, z: (v.b[2] + v.b[5]) / 2, hw: (v.b[3] - v.b[0]) / 2, hd: (v.b[5] - v.b[2]) / 2, ry: 0 });
  }
  const ctl = createController(wd, { radius: R_CAP, grid: GRID, gridPad: GRID_PAD, stats }), { clearance, hit, resolve, nearestFree, astar, lastMove } = ctl, { nx, nz, blocked } = ctl.grid;

  /* ---------------------------------------------------------------- the body */
  const setRoot = (x, z, y = 0, yw = yaw) => { ctl.resetEject(); pos.x = x; pos.z = z; yaw = yw; root.position.set(x, y, z); root.rotation.y = yw; };
  const loco = (name, fade = 0.3) => { if (anim === name) return; anim = name; if (motion()) P.play(name, { fade }); else P.still('idle', 0); };
  const restoreAnim = () => { if (motion()) P.play(anim, { restart: true, fade: 0 }); else P.still('idle', 0); };
  function hipsAt(clip, t) {
    const sp = root.position.clone(), sr = root.rotation.y; root.position.set(0, 0, 0); root.rotation.y = 0;
    P.still(clip, t); root.updateMatrixWorld(true); const v = P.boneWorld('Hips', new THREE.Vector3()); root.position.copy(sp); root.rotation.y = sr; return { x: v.x, z: v.z, y: v.y };
  }
  const _v = new THREE.Vector3();
  function skel(clip, t, x, z, yw, y = 0) {            // live bone positions of a clip at root (x, y, z, yw): hips, head, mean of the feet, lowest bone
    const sp = root.position.clone(), sr = root.rotation.y; root.position.set(x, y, z); root.rotation.y = yw; P.still(clip, t); root.updateMatrixWorld(true);
    const at = (k) => P.boneWorld(k, new THREE.Vector3()), feet = Object.keys(P.bones).filter((k) => /foot/i.test(k) && !/toe/i.test(k)).map(at), f = new THREE.Vector3(); feet.forEach((q) => f.add(q)); if (feet.length) f.multiplyScalar(1 / feet.length);
    let ymin = 9; for (const k of Object.keys(P.bones)) ymin = Math.min(ymin, at(k).y);
    const r = { hips: at('Hips'), head: at('Head'), feet: f, ymin }; root.position.copy(sp); root.rotation.y = sr; root.updateMatrixWorld(true); return r;
  }
  const cloudOf = (clip) => c.cloudOf(P, clip, { frames: 24, stride: 4 });
  const rayDown = new THREE.Raycaster();
  function topAt(obj, x, z, dflt) { obj.updateMatrixWorld(true); rayDown.set(new THREE.Vector3(x, 4, z), new THREE.Vector3(0, -1, 0)); const h = rayDown.intersectObject(obj, true); return h.length ? Math.max(...h.map((q) => q.point.y)) : dflt; }

  /* ---------------------------------------------------------------- planning an activity (fit gate) */
  const FLOOR = { name: 'floor', kind: 'floor', b: [-40, -2, -40, 40, 0, 40] };
  const worldVols = (drop = []) => vols.filter((v) => !drop.includes(v.name)).map((v) => ({ name: v.name, kind: v.kind, b: v.b }));
  const text = (a, clip, rep, extra) => Fit.formatReport(a.id + ' / ' + a.activity + ' / ' + clip + ' / hariv.glb  [' + c.shell + ']', rep, extra);
  /* plan cache (docs/ROOM-V2.md §14.7 check 10): the solves block the main thread for 0.2-2.8 s each, so the results are kept in localStorage, keyed by
   * shell + asset fingerprint (the /static/v/<hash>/ in this module's URL) + a hash of the collision volumes. A hit re-applies the chair / desk tweaks
   * (fx) and skips the solver; a miss solves once, then stores. */
  const hashStr = (t) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const CKEY = 'epoch.room2.plans.v1', CHASH = hashStr([c.shell, import.meta.url.replace(/[^/]*$/, ''), c.lieClip, JSON.stringify(vols.map((v) => [v.name, v.b.map((q) => Math.round(q * 1000))]))].join('|'));
  let cblob = null;
  const cread = () => { if (cblob) return cblob; try { const j = JSON.parse(localStorage.getItem(CKEY) || 'null'); cblob = j && j.k === CHASH ? j : { k: CHASH, plans: {} }; } catch { cblob = { k: CHASH, plans: {} }; } return cblob; };
  const cwrite = (id, pl, text) => { try { const b = cread(); b.plans[id] = { pl, text }; localStorage.setItem(CKEY, JSON.stringify(b)); } catch { /* storage blocked: solve every time */ } };
  function applyFx(a, fx) {
    if (!fx) return; let any = false;
    if (fx.chair && c.placed[a.id]) { const g = c.placed[a.id].g; g.scale.y *= fx.chair; g.updateMatrixWorld(true); any = true; }
    if (fx.desk && c.placed.desk) { const d = c.placed.desk; d.g.scale.y *= fx.desk.k; d.g.updateMatrixWorld(true); for (const [id, dy] of Object.entries(fx.desk.moved)) if (c.placed[id]) { c.placed[id].g.position.y -= dy; c.placed[id].g.updateMatrixWorld(true); } any = true; }
    if (any) c.shadow();
  }
  function planFor(a) {
    if (plans.has(a.id)) return plans.get(a.id);
    const hit = cread().plans[a.id];
    if (hit && hit.pl) { try { applyFx(a, hit.pl.fx); reports[a.id] = { rep: { ok: hit.pl.ok }, text: (hit.text || '') + '\n(cached plan)' }; plans.set(a.id, hit.pl); return hit.pl; } catch (e) { console.warn('room2 cached plan', e); } }
    let pl;
    try { pl = buildPlan(a); if (!pl.error) cwrite(a.id, pl, reports[a.id] && reports[a.id].text); } catch (e) { if (e === NEED) throw e; console.warn('room2 plan', a.id, e); pl = { kind: 'stand', clip: 'idle', place: { x: a.use ? a.use.x : a.obb.x, z: a.use ? a.use.z : a.obb.z, y: 0, yaw: a.use ? a.use.yaw : 0 }, error: String(e) }; }
    plans.set(a.id, pl); restoreAnim(); return pl;
  }
  function standPlan(a, clip = 'idle') {
    const cloud = cloudOf(clip);
    let near, yw;
    if (a.use) { near = { x: a.use.x, z: a.use.z }; yw = a.use.yaw; }
    else { const p = nearestFree(a.obb.x + Math.sin(a.obb.ry) * (a.obb.d / 2 + 0.6), a.obb.z + Math.cos(a.obb.ry) * (a.obb.d / 2 + 0.6)); near = p; yw = Math.atan2(a.obb.x - p.x, a.obb.z - p.z); }
    const V = Fit.makeVols([], [FLOOR, ...worldVols(['footrest'])]), bounds = [B.X0 + 0.3, B.X1 - 0.3, B.Z0 + 0.3, B.Z1 - 0.3];
    let s = Fit.findStandSpot(cloud, V, near, yw, { radius: 1.0, bounds });
    const margin = (v) => (v.kind === 'wall' || v.kind === 'shell' ? 0.02 : 0.15);
    let rep = Fit.evaluate(cloud, { x: s.x, y: 0, z: s.z, yaw: yw }, V, { margin });
    if (a.activity === 'window' && a.obb) {            // centre him on the window (within 0.10 m along the wall): re-solve with the lateral axis pinned, keep it only if it still fits
      const alongX = Math.abs(Math.sin(a.obb.ry)) < 0.5, c0 = alongX ? a.obb.x : a.obb.z, off = Math.abs((alongX ? s.x : s.z) - c0);
      if (off > 0.1) {
        const b2 = alongX ? [c0 - 0.1, c0 + 0.1, bounds[2], bounds[3]] : [bounds[0], bounds[1], c0 - 0.1, c0 + 0.1];
        const n2 = alongX ? { x: c0, z: near.z } : { x: near.x, z: c0 };
        const s2 = Fit.findStandSpot(cloud, V, n2, yw, { radius: 1.0, bounds: b2 }), rep2 = Fit.evaluate(cloud, { x: s2.x, y: 0, z: s2.z, yaw: yw }, V, { margin });
        if (rep2.ok || !rep.ok) { s = s2; rep = rep2; }
      }
    }
    reports[a.id] = { rep, text: text(a, clip, rep, 'standing spot (' + s.x.toFixed(2) + ', ' + s.z.toFixed(2) + ')') };
    return { kind: 'stand', clip, place: { x: s.x, z: s.z, y: 0, yaw: yw }, ok: rep.ok };
  }
  function buildPlan(a) {
    const act = a.activity, pg = c.placed[a.id];
    if (act === 'bed_sleep' && pg) return lyingPlan(a, pg);
    if ((act === 'desk_typing' || act === 'sofa_read') && pg && a.use) return sitPlan(a, pg, act === 'desk_typing' ? 'typing' : 'sit_idle');
    return standPlan(a, 'idle');
  }
  function sitPlan(a, pg, clip) {
    const cloud = cloudOf(clip), g = pg.g, lb = pg.lb, ry = pg.ry, soft = a.activity === 'sofa_read';
    let seatY = Math.min(0.48, Math.max(0.38, topAt(g, a.use.x, a.use.z, 0.44))), ky = 1;
    if (!soft) {                                    // PEOPLE-SPEC §10.2: adjust the seat within real ranges (38-48 cm; an office chair's gas lift): scale the chair's height so the clip's seat contact lands on it
      const gi = [Fit.GROUPS.indexOf('pelvis'), Fit.GROUPS.indexOf('thigh')]; let sum = 0;
      for (const fr of cloud.frames) { let m = 9; for (let i = 0; i < cloud.n; i++) if (gi.includes(cloud.grp[i]) && fr[i * 3 + 1] < m) m = fr[i * 3 + 1]; sum += m; }
      const want = Math.min(0.48, Math.max(0.38, sum / cloud.F + 0.005));
      ky = Math.min(1.1, Math.max(0.88, want / seatY)); if (Math.abs(ky - 1) > 0.004) { g.scale.y *= ky; g.updateMatrixWorld(true); seatY *= ky; c.shadow(); }
    }
    const top = lb.max.y * g.scale.y;
    const seat = [lb.min.x, seatY - 0.3, lb.min.z, lb.max.x, seatY, lb.max.z], back = [lb.min.x, seatY, lb.min.z, lb.max.x, top, lb.min.z + 0.2];
    const arms = (lb.max.x - lb.min.x) > 0.7 ? [[lb.min.x, seatY, lb.min.z, lb.min.x + 0.11, seatY + 0.22, lb.max.z], [lb.max.x - 0.11, seatY, lb.min.z, lb.max.x, seatY + 0.22, lb.max.z]] : [];
    const item = { name: a.id, vols: [seat, back, ...arms], x: g.position.x, y: 0, z: g.position.z, ry, tag: (b, i) => (i === 0 ? (soft ? 'seat_soft' : 'seat') : 'other') };
    const drop = [a.id], fx = {};
    if (!soft && Math.abs(ky - 1) > 0.004) fx.chair = ky;
    const mk = () => {
      const extra = [FLOOR];
      if (clip === 'typing') { drop.push('desk', 'laptop'); const d = c.placed.desk; if (d) { d.g.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(d.g), top = bb.max.y; extra.push({ name: 'desktop', kind: 'desktop', b: [bb.min.x, top - 0.04, bb.min.z, bb.max.x, top, bb.max.z] }); } }
      return Fit.makeVols([item], [...extra, ...worldVols(drop)]);
    };
    let V = mk(), sol = Fit.solve(cloud, V, { x: a.use.x, y: 0, z: a.use.z, yaw: a.use.yaw }, { range: 0.2, coarse: 0.04 }), deskNote = '';
    let lowered = 0;
    for (let it = 0; it < 4 && clip === 'typing' && c.placed.desk; it++) {   // the hands are in the desktop: lower the desk (PEOPLE-SPEC §10.2: 70-78 cm), with what stands on it
      const dRow = sol.report.rows.find((r) => r.name === 'desktop' && r.status === 'FAIL'); if (!dRow) break;
      const d = c.placed.desk, bb0 = new THREE.Box3().setFromObject(d.g), top0 = bb0.max.y, delta = Math.min(top0 - 0.7, 0.02); if (delta < 0.003) break;
      d.g.scale.y *= (top0 - delta) / top0; d.g.updateMatrixWorld(true); lowered += delta;
      fx.desk = fx.desk || { k: 1, moved: {} }; fx.desk.k *= (top0 - delta) / top0;
      for (const [id, q] of Object.entries(c.placed)) if (id !== 'desk' && q.g && Math.abs(q.g.position.y + q.bb.min.y - top0) < 0.05 && q.bb.max.x > bb0.min.x - 0.05 && q.bb.min.x < bb0.max.x + 0.05 && q.bb.max.z > bb0.min.z - 0.05 && q.bb.min.z < bb0.max.z + 0.05) { q.g.position.y -= delta; q.g.updateMatrixWorld(true); fx.desk.moved[id] = (fx.desk.moved[id] || 0) + delta; }
      c.shadow(); V = mk(); sol = Fit.solve(cloud, V, { x: a.use.x, y: 0, z: a.use.z, yaw: a.use.yaw }, { range: 0.2, coarse: 0.04 });
    }
    if (lowered) deskNote = ', desk lowered ' + (lowered * 100).toFixed(1) + ' cm to ' + new THREE.Box3().setFromObject(c.placed.desk.g).max.y.toFixed(3) + ' m';
    let pl = sol.place, rep = sol.report;
    if (clip === 'typing' && !rep.ok) for (const back of [0.01, 0.02]) {            // forearm just into the desktop: ease the chair back 1-2 cm
      const q = { ...pl, x: pl.x - Math.sin(pl.yaw) * back, z: pl.z - Math.cos(pl.yaw) * back }, r2 = Fit.evaluate(cloud, q, V, {}); if (r2.ok) { pl = q; rep = r2; break; }
    }
    reports[a.id] = { rep, text: text(a, clip, rep, 'seat top ' + seatY.toFixed(3) + ' m (chair height x' + ky.toFixed(2) + ')' + deskNote + ', offset ' + (Math.hypot(pl.x - a.use.x, pl.z - a.use.z) * 100).toFixed(0) + ' cm, ' + V.length + ' volumes') };
    let bk = null; if (clip === 'sit_idle') bk = Fit.bookOnThighs(cloud);
    // Stand To Sit / Sit To Stand keep their root motion: line their hips up with the activity clip's
    const hAct = hipsAt(clip, 0), dIn = P.clipDuration('stand_to_sit'), dOut = P.clipDuration('sit_to_stand');
    const h0 = hipsAt('stand_to_sit', 0), h1 = hipsAt('stand_to_sit', dIn - 1e-3), l0 = hipsAt('sit_to_stand', 0), l1 = hipsAt('sit_to_stand', dOut - 1e-3);
    const eo = rot(pl.yaw, h1.x - hAct.x, h1.z - hAct.z), enterRoot = { x: pl.x - eo[0], z: pl.z - eo[1] }, st0 = rot(pl.yaw, h0.x, h0.z);
    const lo = rot(pl.yaw, l0.x - hAct.x, l0.z - hAct.z), leaveRoot = { x: pl.x - lo[0], z: pl.z - lo[1] }, le = rot(pl.yaw, l1.x, l1.z);
    return { kind: 'sit', fx, clip, place: pl, seatY, ok: rep.ok, book: bk, enterRoot, dIn, dOut, start: { x: enterRoot.x + st0[0], z: enterRoot.z + st0[1] }, leaveRoot, leaveEnd: { x: leaveRoot.x + le[0], z: leaveRoot.z + le[1] } };
  }
  function lyingPlan(a, pg) {
    const clip = c.lieClip, cloud = cloudOf(clip), g = pg.g, lb = pg.lb, ry = pg.ry;
    const top = topAt(g, g.position.x, g.position.z, 0.55), f0 = cloud.frames[0];
    let cx = 0, cz = 0, hx = 0, hz = 0, hn = 0, px = 0, pz = 0, pn = 0, ymin = 9;
    for (let i = 0; i < cloud.n; i++) { cx += f0[i * 3]; cz += f0[i * 3 + 2]; if (cloud.grp[i] === Fit.GROUPS.indexOf('head')) { hx += f0[i * 3]; hz += f0[i * 3 + 2]; hn++; } if (cloud.grp[i] === Fit.GROUPS.indexOf('pelvis')) { px += f0[i * 3]; pz += f0[i * 3 + 2]; pn++; } }
    for (const fr of cloud.frames) for (let i = 0; i < cloud.n; i++) ymin = Math.min(ymin, fr[i * 3 + 1]);
    cx /= cloud.n; cz /= cloud.n;
    const phi = Math.atan2(hx / hn - px / pn, hz / hn - pz / pn), yaw0 = ry + Math.PI - phi, wc = new THREE.Vector3((lb.min.x + lb.max.x) / 2, 0, (lb.min.z + lb.max.z) / 2 + 0.05); g.localToWorld(wc);
    const co = rot(yaw0, cx, cz), base = { x: wc.x - co[0], y: top - ymin, z: wc.z - co[1], yaw: yaw0 };
    const mat = [lb.min.x + 0.04, top - 0.3, lb.min.z + 0.04, lb.max.x - 0.04, top, lb.max.z - 0.04];
    const item = { name: a.id, vols: [mat], x: g.position.x, y: 0, z: g.position.z, ry, tag: () => 'mattress' };
    const V = Fit.makeVols([item], [FLOOR, ...worldVols([a.id])]);
    const sol = Fit.solve(cloud, V, base, { range: 0.25, coarse: 0.04 }), pl = sol.place, rep = sol.report;
    reports[a.id] = { rep, text: text(a, clip, rep, 'mattress top ' + top.toFixed(3) + ' m, body is the contact, ' + V.length + ' volumes') };
    // settle on the RENDERED skeleton: yaw so Hips->Head runs along the bed's long axis (head to the headboard), hips 0.14 m over the mattress, body centred on it
    const lx = (lb.max.x - lb.min.x) >= (lb.max.z - lb.min.z), ax = lx ? [1, 0] : [0, 1], hlen = (lx ? lb.max.x - lb.min.x : lb.max.z - lb.min.z), cl = new THREE.Vector3((lb.min.x + lb.max.x) / 2, 0, (lb.min.z + lb.max.z) / 2);
    const endW = (sg, wd = 0) => g.localToWorld(new THREE.Vector3(cl.x + ax[0] * sg * hlen * 0.47 + ax[1] * wd, 0, cl.z + ax[1] * sg * hlen * 0.47 + ax[0] * wd)), eA = endW(1), eB = endW(-1);
    const endH = (sg) => Math.max(...[-0.4, -0.2, 0, 0.2, 0.4].map((wd) => { const q = endW(sg, wd); return topAt(g, q.x, q.z, 0); })), hA = endH(1), hB = endH(-1);
    c.dbgBed = { hA, hB, lx, hlen };
    const hd = hA >= hB ? [eA.x - eB.x, eA.z - eB.z] : [eB.x - eA.x, eB.z - eA.z], tYaw = Math.atan2(hd[0], hd[1]);
    const sk0 = skel(clip, 0, 0, 0, 0), bv = [sk0.head.x - sk0.hips.x, sk0.head.z - sk0.hips.z], yawS = wrap(tYaw - Math.atan2(bv[0], bv[1]));
    const sk1 = skel(clip, 0, 0, 0, yawS), mid = g.localToWorld(cl.clone()), cx1 = (sk1.head.x + sk1.feet.x) / 2, cz1 = (sk1.head.z + sk1.feet.z) / 2;
    pl.x = mid.x - cx1; pl.z = mid.z - cz1; pl.yaw = yawS; pl.y = top + 0.11 - sk1.hips.y; pl.top = top; pl.axis = Math.atan2(hd[0], hd[1]);
    const side = [-1, 1].map((sd) => { const p = g.localToWorld(new THREE.Vector3(sd * ((lb.max.x - lb.min.x) / 2 + 0.5), 0, (lb.min.z + lb.max.z) / 2 + 0.1)); return nearestFree(p.x, p.z); });
    return { kind: 'lie', clip, place: pl, ok: rep.ok, sides: side, top, axis: pl.axis };
  }

  /* ---------------------------------------------------------------- jobs */
  const nowFrom = (a) => (a.use ? { x: a.use.x, z: a.use.z } : { x: a.obb.x, z: a.obb.z });
  const flush = () => { if (pending && st === 'free') { const f = pending; pending = null; f(); } };
  function defer(fn) {                                  // a new destination while seated / lying / mid-transition: stand up first (Sit To Stand), then go
    if (st === 'enter' || st === 'leave' || st === 'bed' || st === 'unbed') { pending = fn; return true; }
    if (st === 'act' && job && job.pl && job.pl.kind !== 'stand') { pending = fn; leaveSeat(); return true; }
    return false;
  }
  function goAnchor(a, o = {}) {
    if (defer(() => goAnchor(a, o))) return null;
    cancelJob(); idleFor = o.auto ? idleFor : 0; auto = !!o.auto;
    const pl = planFor(a); job = { a, pl, since: clock }; jobSince = clock;
    let target;
    if (pl.kind === 'sit') target = nearestFree(pl.start.x, pl.start.z);
    else if (pl.kind === 'lie') target = pl.sides.reduce((b, s) => (Math.hypot(s.x - pos.x, s.z - pos.z) < Math.hypot(b.x - pos.x, b.z - pos.z) ? s : b));
    else target = { x: pl.place.x, z: pl.place.z };
    if (!motion()) { teleport(job); return job; }
    beginPath(target.x, target.z);
    if (!path) { if (Math.hypot(target.x - pos.x, target.z - pos.z) < 0.3) arrive(); else { job = null; st = 'free'; } }
    return job;
  }
  function teleport(jb) {
    const pl = jb.pl; st = 'act';
    if (pl.kind === 'sit') { setRoot(pl.place.x, pl.place.z, pl.place.y, pl.place.yaw); anim = pl.clip; P.still(pl.clip, 0); showBook(pl); }
    else if (pl.kind === 'lie') { setRoot(pl.place.x, pl.place.z, pl.place.y, pl.place.yaw); anim = pl.clip; P.still(pl.clip, 0); }
    else { setRoot(pl.place.x, pl.place.z, 0, pl.place.yaw); anim = 'idle'; P.still('idle', 0); }
    followCam(1); c.kick();
  }
  function goFloor(x, z, o = {}) {
    if (defer(() => goFloor(x, z, o))) return;
    cancelJob(); idleFor = 0; auto = !!o.auto;
    const t = nearestFree(x, z);
    if (!motion()) { setRoot(t.x, t.z, 0, yaw); st = 'free'; followCam(1); c.kick(); return; }
    beginPath(t.x, t.z);
  }
  function beginPath(tx, tz) {
    path = astar(pos.x, pos.z, tx, tz); pathI = 1; stuck = 0; lastDist = 1e9;
    if (!path || path.length < 2) { path = null; return; }
    st = 'path'; c.kick();
  }
  function cancelJob() { path = null; faceYaw = null; if (book) { book.removeFromParent(); book = null; } if (job && job.holdBook) { /* gone with the job */ } job = null; }
  function arrive() {
    path = null; const pl = job && job.pl;
    if (!pl) { st = 'free'; loco('idle'); return; }
    if (pl.kind === 'sit') {
      setRoot(pl.enterRoot.x, pl.enterRoot.z, pl.place.y, pl.place.yaw); anim = 'stand_to_sit'; P.play('stand_to_sit', { once: true, fade: 0.15 });
      st = 'enter'; timer = pl.dIn; return;
    }
    if (pl.kind === 'lie') {
      job.from = { x: pos.x, z: pos.z, y: 0, yaw }; st = 'bed'; timer = 0; anim = pl.clip; P.play(pl.clip, { fade: 0.5 }); return;
    }
    faceYaw = pl.place.yaw; st = 'turn';
  }
  function showBook(pl) {
    if (pl.clip !== 'sit_idle' || !pl.book) return; book = Fit.makeBook(); book.traverse((n) => { if (n.isMesh) n.castShadow = n.receiveShadow = true; });
    book.position.set(pl.book.x, pl.book.y, pl.book.z); book.rotation.y = pl.book.yaw; root.add(book);
  }
  function leaveSeat() {
    const jb = job; if (!jb) { st = 'free'; return; }
    const pl = jb.pl; if (book) { book.removeFromParent(); book = null; }
    if (pl.kind === 'sit' && motion()) { setRoot(pl.leaveRoot.x, pl.leaveRoot.z, pl.place.y, pl.place.yaw); anim = 'sit_to_stand'; P.play('sit_to_stand', { once: true, fade: 0.15 }); st = 'leave'; timer = pl.dOut; return; }
    if (pl.kind === 'lie' && motion()) { const s = jb.from || pl.sides[0]; job.out = { x: s.x, z: s.z }; job.fromLie = { x: pos.x, z: pos.z, y: root.position.y }; anim = 'idle'; P.play('idle', { fade: 0.5 }); st = 'unbed'; timer = 0; return; }
    const e = pl.kind === 'sit' ? pl.leaveEnd : pl.kind === 'lie' ? (jb.from || pl.sides[0]) : pos; const f = nearestFree(e.x, e.z);
    setRoot(f.x, f.z, 0, yaw); anim = 'idle'; P.still('idle', 0); job = null; st = 'free'; c.kick(); flush();
  }

  /* ---------------------------------------------------------------- input */
  const typing = () => { const a = document.activeElement; if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true; return !!document.querySelector('dialog[open], [aria-modal="true"], .drawer.is-open, .modal.is-open, [data-drawer-open]'); };
  const onKeyDown = (e) => {
    const k = KEYS[e.code]; if (!k || e.ctrlKey || e.metaKey || e.altKey || typing() || card || (c.suspended && c.suspended())) return;
    if (k !== 'run' && (e.code.startsWith('Arrow'))) e.preventDefault();
    idleFor = 0; if (k !== 'run') { takeOver(); if (c.release) c.release(); } keys.add(k); c.kick();
  };
  const onKeyUp = (e) => { const k = KEYS[e.code]; if (k) keys.delete(k); };
  const onBlur = () => keys.clear();
  function takeOver() {
    auto = false; pending = null;
    if (st === 'path' || st === 'turn') { path = null; faceYaw = null; job = null; st = 'free'; }
    else if (st === 'act' && job) { if (job.pl.kind === 'stand') { job = null; st = 'free'; } else leaveSeat(); }
  }
  let down = null, fwdWalk = false;
  const onDown = (e) => { idleFor = 0; if (auto && st === 'path') { path = null; job = null; st = 'free'; auto = false; loco('idle'); } down = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now(), ok: true } : (down && { ...down, ok: false }); };
  const onUp = (e) => {
    if (!down || !down.ok || e.button > 0) { if (e.isPrimary) down = null; return; }
    const d = down; down = null; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700 || card) return;
    clearTimeout(pendingClick); const cx = e.clientX, cy = e.clientY;
    pendingClick = setTimeout(() => pick(cx, cy), e.pointerType === 'touch' ? 0 : 240);
  };
  const onDbl = () => clearTimeout(pendingClick);
  const ray = new THREE.Raycaster(), fp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function hitOf(r) {
    let best = null; const consider = (d, v) => { if (d != null && (!best || d < best.d)) best = { d, ...v }; };
    const o = r.ray;
    if (c.door) { const b = new THREE.Box3(new THREE.Vector3(c.door.box[0], c.door.box[1], c.door.box[2]), new THREE.Vector3(c.door.box[3], c.door.box[4], c.door.box[5])), p = o.intersectBox(b, new THREE.Vector3()); if (p) consider(o.origin.distanceTo(p), { door: true }); }
    for (const a of c.anchors) {
      if (a.id === 'closet') continue;
      const ob = a.obb, m = new THREE.Matrix4().compose(new THREE.Vector3(ob.x, ob.y0 + ob.h / 2, ob.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ob.ry), new THREE.Vector3(1, 1, 1)).invert();
      const lr = o.clone().applyMatrix4(m), p = lr.intersectBox(new THREE.Box3(new THREE.Vector3(-ob.w / 2, -ob.h / 2, -ob.d / 2), new THREE.Vector3(ob.w / 2, ob.h / 2, ob.d / 2)), new THREE.Vector3());
      if (p) consider(lr.origin.distanceTo(p), { a });
    }
    for (const [vn, act] of [['desk', 'desk_typing'], ['kitchen', 'kettle']]) {
      const v = vols.find((q) => q.name === vn), a = c.anchors.find((q) => q.activity === act); if (!v || !a) continue;
      const p = o.intersectBox(new THREE.Box3(new THREE.Vector3(v.b[0], v.b[1], v.b[2]), new THREE.Vector3(v.b[3], v.b[4], v.b[5])), new THREE.Vector3()); if (p) consider(o.origin.distanceTo(p), { a });
    }
    const fpnt = o.intersectPlane(fp, new THREE.Vector3()); if (fpnt && (!best || o.origin.distanceTo(fpnt) < best.d + 0.0)) { if (!best) best = { d: o.origin.distanceTo(fpnt), floor: fpnt }; else if (!best.a && !best.door) best.floor = fpnt; }
    return best;
  }
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const h = hitOf(ray); if (!h) return;
    if (h.door) return goDoor();
    if (h.a) return goAnchor(h.a);
    if (h.floor && Math.abs(h.floor.x) < B.X1 + 0.3) goFloor(h.floor.x, h.floor.z);
  }

  /* ---------------------------------------------------------------- the front door */
  function goDoor() {
    if (!c.door) return; if (defer(() => goDoor())) return; cancelJob(); idleFor = 0; auto = false;
    const ap = nearestFree(c.door.approach.x, c.door.approach.z);
    if (!motion()) { setRoot(ap.x, ap.z, 0, c.door.yaw); showCard(); return; }
    job = { door: true, pl: { kind: 'door', place: { ...ap, y: 0, yaw: c.door.yaw } } }; beginPath(ap.x, ap.z); if (!path) { if (Math.hypot(ap.x - pos.x, ap.z - pos.z) < 0.3) arrive(); else { job = null; st = 'free'; } }
  }
  function showCard() {
    if (card) return; doorWant = true; keys.clear(); st = 'door'; loco('idle'); c.kick();
    if (c.onDoor) { card = { remove() {} }; try { c.onDoor(api); } catch (e) { console.warn('onDoor', e); closeCard(); } return; }      // slice 2: the street (world/outside.js) answers; closeCard() brings him back
    card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'The front door');
    Object.assign(card.style, { position: 'absolute', left: '50%', bottom: '1.2rem', transform: 'translateX(-50%)', width: 'min(22rem, 88%)', zIndex: '6', textAlign: 'center', padding: '1rem 1.2rem' });
    card.innerHTML = '<p class="card__head" style="margin:0 0 .7rem">The hallway and your street are coming next</p><button type="button" class="btn btn--sm btn--violet" data-door-back>Back</button>';
    const back = () => closeCard(); card.querySelector('button').addEventListener('click', back);
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
    (host.querySelector('[data-js="home-scene"]') || host).appendChild(card); card.querySelector('button').focus({ preventScroll: true });
  }
  function closeCard() {
    if (!card) return; card.remove(); card = null; doorWant = false;
    const d = c.door, o = nearestFree(d.approach.x + d.inward.x * 0.5, d.approach.z + d.inward.z * 0.5); setRoot(o.x, o.z, 0, yaw); st = 'free'; job = null; c.kick(); canvas.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- per frame */
  function followCam(k) {
    if (c.inside && c.inside()) return;                  // the inside view has its own spring-arm rig (room2_cam.js)
    if (c.tweening && c.tweening()) return;
    const tx = Math.min(B.X1 - 0.5, Math.max(B.X0 + 0.5, pos.x)), tz = Math.min(B.Z1 - 0.5, Math.max(B.Z0 + 0.5, pos.z)), t = controls.target;
    const dx = (tx - t.x) * k, dz = (tz - t.z) * k; t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz;
  }
  const turnTo = (want, dt) => { const d = wrap(want - yaw), s = TURN * dt; yaw = Math.abs(d) <= s ? want : yaw + Math.sign(d) * s; root.rotation.y = yaw; return Math.abs(wrap(want - yaw)) < 0.01; };
  /* one step of the wanted displacement (slide / steer): world/controller.js; the body follows */
  const moveBy = (dx, dz) => { const m = ctl.moveBy(pos, dx, dz); root.position.x = pos.x; root.position.z = pos.z; return m; };
  const unstick = (dt) => { const r = ctl.unstick(pos, dt, root.position.y <= 0.05); root.position.x = pos.x; root.position.z = pos.z; return r; };
  function routineTarget() {
    const h = c.hourNow(), by = (act) => c.anchors.find((q) => q.activity === act && !/armchair/.test(q.id));   // the armchairs fail the fit gate (5.4 / 4.7 cm): never auto-life
    if (h >= 22.5 || h < 5.5) return by('bed_sleep');
    if (h < 10) { const list = [by('kettle'), by('window')].filter(Boolean); return list.length ? list[routineI % list.length] : null; }
    if (h < 17) return by('desk_typing');
    return by('sofa_read');
  }
  let speed = 0;
  const setGait = (k) => { if (P.mixer) P.mixer.timeScale = motion() ? k : 1; };              // walk / run clip speed follows the real ground speed
  function update(dt) {
    if (disposed) return false; clock += dt; stats.frames++;
    let busy = false; fwdWalk = false;
    if (st === 'free' || st === 'path' || st === 'turn') busy = unstick(dt);
    if (doorWant !== doorOpen || (c.door && c.door.ang !== (doorWant ? 1 : 0))) {
      const d = c.door; if (d) { const goal = doorWant ? 1 : 0; d.ang += Math.sign(goal - d.ang) * Math.min(Math.abs(goal - d.ang), motion() ? dt / 0.6 : 1); d.leaf.rotation.y = -d.knob * d.ang * 1.55; c.shadow(); busy = true; if (d.ang === goal) doorOpen = doorWant; }
    }
    if (st === 'door') { loco('idle'); setGait(1); return true; }
    const kx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), kz = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0);
    if ((kx || kz) && (st === 'free' || st === 'path' || st === 'turn' || (st === 'act' && !job))) {
      if (st !== 'free') takeOver(); st = 'free';
    }
    if (st === 'free') {
      if (kx || kz) {
        const az = c.azimuth ? c.azimuth() : controls.getAzimuthalAngle(), fx = -Math.sin(az), fz = -Math.cos(az), rx = -fz, rz = fx;
        let dx = fx * kz + rx * kx, dz = fz * kz + rz * kx; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const run = keys.has('run'), sp = run ? RUN : WALK; fwdWalk = kz > 0 && !kx;
        const m = moveBy(dx * sp * dt, dz * sp * dt), v = dt > 0 ? m / dt : 0;
        speed += (v - speed) * (1 - Math.exp(-dt / 0.06));                                                       // his actual ground speed, lightly smoothed
        const moving = speed > (anim === 'walk' || anim === 'run' ? 0.15 : 0.25);
        turnTo(moving && m > 1e-5 ? Math.atan2(lastMove.x, lastMove.z) : Math.atan2(dx, dz), dt);               // face the way he really goes (along a wall), not the way the key points
        loco(moving ? (run ? 'run' : 'walk') : 'idle'); setGait(moving ? Math.min(1.15, Math.max(0.45, speed / sp)) : 1);
        followCam(motion() ? 1 - Math.pow(1 - 0.08, dt * 60) : 1); busy = true; idleFor = 0;
        if (c.door && !doorWant && Math.hypot(pos.x - c.door.centre.x, pos.z - c.door.centre.z) < 0.78 && (c.door.centre.x - pos.x) * dx + (c.door.centre.z - pos.z) * dz > 0.5 * Math.hypot(c.door.centre.x - pos.x, c.door.centre.z - pos.z)) { yaw = Math.atan2(c.door.centre.x - pos.x, c.door.centre.z - pos.z); root.rotation.y = yaw; showCard(); }
      } else { loco('idle'); setGait(1); speed = 0; }
    } else if (st === 'path') {
      setGait(1);
      const wp = path[pathI], dx = wp[0] - pos.x, dz = wp[1] - pos.z, d = Math.hypot(dx, dz);
      if (d < 0.07) { pathI++; if (pathI >= path.length) { arrive(); busy = true; } }
      else {
        turnTo(Math.atan2(dx, dz), dt); const m = moveBy((dx / d) * Math.min(WALK * dt, d), (dz / d) * Math.min(WALK * dt, d)); loco('walk');
        fwdWalk = true; stuck = m < WALK * dt * 0.2 ? stuck + dt : 0; if (stuck > 1) { path = null; if (job) job = null; st = 'free'; loco('idle'); }
        followCam(motion() ? 1 - Math.pow(1 - 0.08, dt * 60) : 1);
      }
      busy = true;
    } else if (st === 'turn') {
      loco('idle'); if (turnTo(faceYaw, dt)) { if (job && job.door) { showCard(); return true; } st = 'act'; jobSince = clock; if (job && job.pl && job.pl.clip !== 'idle') P.play(job.pl.clip, { fade: 0.3 }); } busy = true;
    } else if (st === 'enter') {
      timer -= dt; busy = true;
      if (timer <= 0) { const pl = job.pl; setRoot(pl.place.x, pl.place.z, pl.place.y, pl.place.yaw); anim = pl.clip; P.play(pl.clip, { fade: 0.3 }); showBook(pl); st = 'act'; jobSince = clock; }
    } else if (st === 'leave') {
      timer -= dt; busy = true;
      if (timer <= 0) { const f = nearestFree(job.pl.leaveEnd.x, job.pl.leaveEnd.z); setRoot(f.x, f.z, 0, yaw); anim = 'idle'; P.play('idle', { fade: 0.3 }); job = null; st = 'free'; flush(); }
    } else if (st === 'bed') {                                       // slide from the bedside onto the mattress while the lying clip fades in
      timer += dt; busy = true; const k = Math.min(1, timer / 0.8), s = k * k * (3 - 2 * k), f = job.from, pl = job.pl.place;
      setRoot(f.x + (pl.x - f.x) * s, f.z + (pl.z - f.z) * s, pl.y * s, f.yaw + wrap(pl.yaw - f.yaw) * s);
      if (k >= 1) { st = 'act'; jobSince = clock; }
    } else if (st === 'unbed') {
      timer += dt; busy = true; const k = Math.min(1, timer / 0.8), s = k * k * (3 - 2 * k), f = job.fromLie, o = job.out;
      setRoot(f.x + (o.x - f.x) * s, f.z + (o.z - f.z) * s, f.y * (1 - s), yaw);
      if (k >= 1) { job = null; st = 'free'; flush(); }
    } else if (st === 'act') { busy = motion(); }
    // auto-life: 25 s without input
    idleFor += dt;
    if (AUTO_ON && !kx && !kz && idleFor >= AUTO_AFTER && (st === 'act' || st === 'free') && !card) {
      const want = routineTarget();
      if (want) {
        if (job && job.a && job.a.id === want.id) { if (c.hourNow() < 10 && c.hourNow() >= 5.5 && clock - jobSince > 40) routineI++; }
        else if (st === 'free' || (job && job.a)) goAnchor(want, { auto: true });
      }
    }
    if (st === 'act' && job && job.pl && !job._framed && c.onAct) {          // arrived: the camera frames the activity (room2_cam.js); any key / drag hands it back
      job._framed = true; const a = job.a;
      if (a && a.activity) c.onAct({ activity: a.activity, id: a.id, x: pos.x, z: pos.z, yaw, axis: job.pl.axis, centre: a.obb ? { x: a.obb.x, z: a.obb.z } : null });
    }
    if (c.sh) { c.sh.position.set(root.position.x, 0.003, root.position.z); c.sh.visible = root.position.y < 0.12; }
    return busy;
  }
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('dblclick', onDbl);
  const api = {
    update, stats, goAnchor, get door() { return c.door; }, state: () => st, hint: () => ({ fwd: fwdWalk, yaw }), goFloor, goDoor, closeCard,
    press(code) { const k = KEYS[code]; if (k) { if (k !== 'run') { idleFor = 0; takeOver(); } keys.add(k); c.kick(); } }, release(code) { const k = KEYS[code]; if (k) keys.delete(k); },
    clickAnchor(id) { const a = c.anchors.find((q) => q.id === id) || c.anchors.find((q) => q.activity === id); if (a) goAnchor(a); return !!a; },
    clickFloor(x, z) { goFloor(x, z); }, tp(x, z, yw) { cancelJob(); pending = null; keys.clear(); setRoot(x, z, 0, yw == null ? yaw : yw); st = 'free'; loco('idle'); c.kick(); }, pickAt: pick,
    fit(id) { const a = c.anchors.find((q) => q.id === id) || c.anchors.find((q) => q.activity === id); if (!a) return null; planFor(a); return reports[a.id] || null; },
    status() { return { state: st, anim, x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), y: +root.position.y.toFixed(3), hipsY: +P.boneWorld('Hips', new THREE.Vector3()).y.toFixed(2), yaw: +(yaw / D2R).toFixed(0), job: job && (job.a ? job.a.id : job.door ? 'door' : 'floor'), clip: P.current, minClear: +stats.minClear.toFixed(3), idleFor: +idleFor.toFixed(1), auto, book: !!book, card: !!card }; },
    useNow(id) { const a = c.anchors.find((q) => q.id === id) || c.anchors.find((q) => q.activity === id); if (!a) return null; cancelJob(); pending = null; const pl = planFor(a); job = { a, pl, since: clock }; jobSince = clock; teleport(job); if (pl.kind === 'stand') { faceYaw = null; } if (pl.clip && pl.clip !== 'idle') P.play(pl.clip, { fade: 0 }); anim = pl.clip || 'idle'; idleFor = 0; return a.id; },
    measure(id) {
      const a = c.anchors.find((q) => q.id === id) || c.anchors.find((q) => q.activity === id), pl = job && job.pl, P3 = (k) => P.boneWorld(k, new THREE.Vector3()), hips = P3('Hips'), head = P3('Head'), fk = Object.keys(P.bones).filter((k) => /foot/i.test(k) && !/toe/i.test(k)), fy = Math.min(...fk.map((k) => P3(k).y));
      const o = { id: a.id, state: st, clip: P.current, pelvisY: +hips.y.toFixed(3), headY: +head.y.toFixed(3), feetY: +fy.toFixed(3), yawDeg: +(yaw / D2R).toFixed(0), x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), fitOk: pl && pl.ok }; let ok = st === 'act';
      if (pl && pl.kind === 'sit') { o.surf = +pl.seatY.toFixed(3); o.d = +(hips.y - pl.seatY).toFixed(3); o.book = !!book; ok = ok && o.d >= 0.03 && o.d <= 0.15 && (pl.clip !== 'sit_idle' || book); }
      else if (pl && pl.kind === 'lie') { o.surf = +pl.top.toFixed(3); o.d = +(hips.y - pl.top).toFixed(3); const bd = Math.atan2(head.x - hips.x, head.z - hips.z), dy = Math.abs(wrap(bd - pl.axis)) / D2R; o.axisErrDeg = +dy.toFixed(0); const g = c.placed[a.id].g, lb = c.placed[a.id].lb; const inside = [head, hips, ...fk.map(P3)].every((q) => { const l = g.worldToLocal(q.clone()); return l.x >= lb.min.x && l.x <= lb.max.x && l.z >= lb.min.z && l.z <= lb.max.z; }); o.inside = inside; ok = ok && o.d >= 0.1 && o.d <= 0.18 && dy <= 10 && inside; }
      else if (pl) { const ob = a.obb, dx = pos.x - ob.x, dz = pos.z - ob.z, ux = Math.sin(ob.ry), uz = Math.cos(ob.ry), dn = dx * ux + dz * uz, dist = Math.abs(dn) - ob.d / 2; o.surf = 0; o.distToFront = +dist.toFixed(2); const want = a.use ? a.use.yaw : Math.atan2(ob.x - pos.x, ob.z - pos.z); o.yawErrDeg = +(Math.abs(wrap(yaw - want)) / D2R).toFixed(0); o.yawWant = +(want / D2R).toFixed(0); ok = ok && o.yawErrDeg <= 20 && dist <= (a.activity === 'window' ? 0.8 : 0.6) && o.feetY < 0.2; }
      if (pl && pl.kind === 'sit' && a.activity === 'desk_typing') o.gate = reports[a.id] && reports[a.id].rep.ok;
      o.pass = ok ? 'PASS' : 'FAIL'; return o;
    },
    setLie(n) { c.lieClip = n; plans.delete('bed'); delete reports.bed; }, azimuth: () => controls.getAzimuthalAngle(), map() { const rows = []; for (let j = 0; j < nz; j++) { let r = ''; for (let i = 0; i < nx; i++) r += blocked[i * nz + j] ? '#' : '.'; rows.push(r + ' ' + (B.Z0 + j * GRID).toFixed(1)); } return rows.join('\n'); }, astar,
    reports, plans, hipsAt, cloudOf, lastText: () => lastText, solids: () => solids.length, clearance, pos, R: R_CAP, resolve, inside: () => hit(pos.x, pos.z, R_CAP - 0.02), speed: () => speed, gait: () => (P.mixer ? P.mixer.timeScale : 1), solidList: () => solids.map((q) => ({ ...q })),
    dispose() { disposed = true; window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('dblclick', onDbl); clearTimeout(pendingClick); if (card) card.remove(); },
  };
  setRoot(pos.x, pos.z, 0, yaw);
  // solve every activity once, spread over idle time, so the first click is instant and the chair's height is already adjusted
  { /* armchairs (not in auto-life) solve on first click */ const todo = c.anchors.filter((a) => (['desk_typing', 'sofa_read', 'bed_sleep', 'kettle'].includes(a.activity) && c.placed[a.id] || a.activity === 'kettle') && !/armchair/.test(a.id)); let i = 0;
    const snap = () => Object.values(c.placed).filter((q) => q && q.g).map((q) => [q.g, q.g.scale.y, q.g.position.y]);
    const restore = (sn) => { for (const [g, sy, py] of sn) { g.scale.y = sy; g.position.y = py; g.updateMatrixWorld(true); } };
    const clipFor = (a) => (a.activity === 'bed_sleep' ? c.lieClip : a.activity === 'desk_typing' ? 'typing' : a.activity === 'sofa_read' ? 'sit_idle' : 'idle');
    const pre = async (a) => {                      // every heavy step off the main thread: the cloud per frame (yielding), the solves in the fit worker
      if (plans.has(a.id) || cread().plans[a.id]) { planFor(a); return; }
      if (c.cloudOfAsync) await c.cloudOfAsync(P, clipFor(a), { frames: 24, stride: 4 }).catch(() => {});
      for (let t = 0; t < 12 && !disposed; t++) {
        const sn = snap(); asyncMode = true; wanted = null;
        try { planFor(a); asyncMode = false; return; } catch (e) { asyncMode = false; restore(sn); if (e !== NEED || !wanted) throw e; }
        const w = wanted; memo.set(w.k, await (w.op === 'solve' ? c.solveFit(w.cloud, w.v, w.a, w.o) : w.op === 'book' ? c.bookSpot(w.cloud) : c.standSpot(w.cloud, w.v, w.a, w.b, w.o)));
        if (keys.size || st !== 'free') return;     // the user took over: a click solves inline from the memo
      }
    };
    const next = () => { if (disposed || i >= todo.length) return;
      if (keys.size || st !== 'free' || idleFor < 1.5) { setTimeout(next, 400); return; }   // solves run in the worker; only the small replay steps are on this thread
      pre(todo[i]).catch((e) => console.warn('room2 pre-plan', e)).then(() => { i++; setTimeout(next, 250); }); };
    setTimeout(next, c.preplanMs == null ? 2500 : c.preplanMs); }
  return api;
}
