// city/world/cam.js · the spring-arm camera rig shared by every walkable scene (was city/room2_cam.js; docs/WORLD.md §10; room2_cam.js re-exports it). Docs: docs/ROOM-V2.md §14.
// Pivot = Hariv's root + (0, 1.55, 0), eased with a 0.12 s lag, shifted 0.35 m to his right (over the shoulder). Arm 2.2 m (scroll / pinch 1.2-3.5),
// pitch -35..+25 deg (positive = looking up), FOV 60, near 0.05. Collision: the arm is cast from the pivot against the shell (walls, both dividers,
// the lintels over the archway / doorway, the ceiling and floor) and the TALL furniture (top >= 1.4 m), with a 0.25 m stand-off; it pulls in at once and
// eases back out over ~0.3 s. Low furniture never blocks, but the camera is never left inside it (it is lifted over it, or the arm shortens).
// Yaw is an azimuth like OrbitControls': the camera sits at pivot + arm * (sin yaw, ., cos yaw) and looks along -(sin yaw, cos yaw).
// Debug (?debug=1): window.__room2.cam(), setLook(yawDeg, pitchDeg), setMode('inside' | 'overview').
const D2R = Math.PI / 180, SHIFT = 0.35;
const M_CAM = 0.25, M_PIV = 0.2, FLOOR_Y = 0.3, LOOK_PX = 6, DEG_PER_PX = 0.25;
// the room's numbers; another scene (Butler v2: seated, a 9 m hall) overrides them with c.opt = { PITCH0, PMIN, PMAX, ARM0, ARM_MIN, ARM_MAX, EYE, CEIL, yawRange }
const DEF = { PITCH0: -12 * D2R, PMIN: -35 * D2R, PMAX: 25 * D2R, ARM0: 2.2, ARM_MIN: 1.2, ARM_MAX: 3.5, EYE: 1.55, CEIL: 3.25, yawRange: 0, SWING: false };
// outdoors (street_walk.js) two more, both opt-in so the room and Butler are unchanged: c.cyls = [[x, z, r, yTop]] thin poles the camera is pushed around (never
// a box that shortens the arm: no pop as a lamp post passes), and opt.SWING: when the arm behind him is blocked (his stoop landing, a building corner) the arm
// swings sideways and/or up to the nearest free direction, eased; rig.yaw stays the look the user chose (W walks along it), only the shot moves.
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createRig(c) {
  const { PITCH0, PMIN, PMAX, ARM0, ARM_MIN, ARM_MAX, EYE, CEIL, yawRange, SWING } = { ...DEF, ...(c.opt || {}) };
  const cyls = c.cyls || [], M_POLE = 0.18;
  let yaw0 = 0;                                   // yawRange > 0: drag-to-look stays within +-yawRange of the yaw it was enabled at
  const clampYaw = (y) => (yawRange > 0 ? wrap(yaw0 + clamp(wrap(y - yaw0), -yawRange, yawRange)) : wrap(y));
  const { THREE, camera, canvas, vols, dividers, bounds: B, RH, person, motion, kick } = c;
  const root = person.root;
  /* ---- the collision world */
  const hard = [], walls = [], low = [], names = new Map();
  for (const v of vols) {
    if (v.kind === 'floor' || v.kind === 'footrest') continue;
    if (v.kind === 'wall' || v.kind === 'shell') { hard.push(v.b); walls.push(v.b); } else if (v.b[4] >= 1.4 && Math.min(v.b[3] - v.b[0], v.b[5] - v.b[2]) >= 0.5) { hard.push(v.b); names.set(v.b, v.name); } else { low.push(v.b); names.set(v.b, v.name); }
  }
  for (const d of dividers) for (const op of d.open) { const b = [op.x - op.w / 2, op.h, d.z - d.t / 2, op.x + op.w / 2, RH, d.z + d.t / 2]; hard.push(b); walls.push(b); }
  { const k = vols.find((v) => v.name === 'kitchen');       // the upper cabinets over the counter
    if (k) { const b = k.b; let u = null;
      if (b[3] >= B.X1 - 0.01) u = [b[3] - 0.36, 1.4, b[2], b[3], 2.3, b[5]]; else if (b[0] <= B.X0 + 0.01) u = [b[0], 1.4, b[2], b[0] + 0.36, 2.3, b[5]]; else if (b[5] >= B.Z1 - 0.01) u = [b[0], 1.4, b[5] - 0.36, b[3], 2.3, b[5]];
      if (u) { hard.push(u); names.set(u, 'uppers'); } } }
  let extra = [];
  const lo = (m, y0) => [B.X0 + m, y0, B.Z0 + m], hi = (m, y1) => [B.X1 - m, y1, B.Z1 - m];
  const LO_C = lo(M_CAM, FLOOR_Y), HI_C = hi(M_CAM, CEIL), LO_P = lo(M_PIV, 0.1), HI_P = hi(M_PIV, RH - 0.05);

  function segBox(p0, d, b, m) {                  // first entry t in [0,1] of the segment into the box grown by m; 2 = none. A start already inside the margin shrinks it.
    const dx = Math.max(b[0] - p0[0], 0, p0[0] - b[3]), dy = Math.max(b[1] - p0[1], 0, p0[1] - b[4]), dz = Math.max(b[2] - p0[2], 0, p0[2] - b[5]), dd = Math.max(dx, dy, dz);      // L-infinity: the grown box is a box
    const mm = Math.min(m, dd - 0.003); if (mm <= 0) return 2;
    let t0 = 0, t1 = 1;
    for (let a = 0; a < 3; a++) {
      const l = b[a] - mm, h = b[a + 3] + mm;
      if (Math.abs(d[a]) < 1e-9) { if (p0[a] < l || p0[a] > h) return 2; continue; }
      let s = (l - p0[a]) / d[a], e = (h - p0[a]) / d[a]; if (s > e) { const q = s; s = e; e = q; }
      t0 = Math.max(t0, s); t1 = Math.min(t1, e); if (t0 > t1) return 2;
    }
    return t0;
  }
  function clampT(p0, d, L, H) {
    let t = 1;
    for (let a = 0; a < 3; a++) { const l = Math.min(L[a], p0[a]), h = Math.max(H[a], p0[a]); if (d[a] > 1e-9) t = Math.min(t, (h - p0[a]) / d[a]); else if (d[a] < -1e-9) t = Math.min(t, (l - p0[a]) / d[a]); }
    return Math.max(0, t);
  }
  function cast(p0, p1, m, L, H) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; let t = clampT(p0, d, L, H);
    for (const b of hard) { const s = segBox(p0, d, b, m); if (s < t) t = s; }
    return t;
  }
  const inBox = (p, b, m) => p[0] > b[0] - m && p[0] < b[3] + m && p[1] > b[1] - m && p[1] < b[4] + m && p[2] > b[2] - m && p[2] < b[5] + m;
  const lowHit = (p) => { for (const b of low) if (inBox(p, b, 0.1)) return b; return null; };
  function validHard(p, pv) {                    // as cast(): a camera already closer to a surface than the stand-off (its pivot is) may not get any closer
    for (const a of [0, 1, 2]) { const l = Math.min(LO_C[a], pv[a]), h = Math.max(HI_C[a], pv[a]); if (p[a] < l - 1e-6 || p[a] > h + 1e-6) return false; }
    for (const b of hard) { const mm = Math.min(M_CAM - 0.02, boxDistInf(pv, b) - 0.003); if (mm > 0 && inBox(p, b, mm)) return false; }
    return true;
  }

  /* ---- state */
  let on = false, wantCur = ARM0, yaw = 0, pitch = PITCH0, userArm = ARM0, armCur = ARM0, hit = ARM0, shot = null, lastDrag = -9, clock = 0, fade = 1, fadeApplied = 1;
  const head = [root.position.x, EYE, root.position.z], piv = [0, 0, 0], cam = [0, 0, 0];
  let lastSig = '', mode = 'follow', wasFwd = false, settleTo = -1;
  const dirOf = (az, p) => [-Math.sin(az) * Math.cos(p), Math.sin(p), -Math.cos(az) * Math.cos(p)];
  const rightOf = (az) => [Math.cos(az), 0, -Math.sin(az)];

  let side = 1, sideCur = 1;
  function pivotAt(h, az, sd = sideCur) {        // the shoulder shift, cast so it never leaves the room / enters a wall
    const r = rightOf(az), k = SHIFT * sd, t = cast(h, [h[0] + r[0] * k, h[1], h[2] + r[2] * k], M_PIV, LO_P, HI_P);
    return [h[0] + r[0] * k * t, h[1], h[2] + r[2] * k * t];
  }
  function pickSide(h, az) {                     // over the right shoulder; against a wall (or in a doorway) swap to the left one
    const r = rightOf(az), tt = (sd) => cast(h, [h[0] + r[0] * SHIFT * sd, h[1], h[2] + r[2] * SHIFT * sd], M_PIV, LO_P, HI_P), tr = tt(1), tl = tt(-1);
    if (side === 1 && tr < 0.6 && tl > tr + 0.2) side = -1; else if (side === -1 && tr >= 0.95) side = 1;
  }
  function armAt(pv, az, p, want) {              // the free arm length along (az, p)
    const d = dirOf(az, p), t = cast(pv, [pv[0] - d[0] * want, pv[1] - d[1] * want, pv[2] - d[2] * want], M_CAM, LO_C, HI_C);
    return Math.max(0, t * want - 0.01);
  }
  const headNow = () => (shot && shot.focus ? shot.focus : [root.position.x, root.position.y + EYE, root.position.z]);

  /* ---- fade Hariv when the camera is almost inside his head */
  const mats = []; root.traverse((n) => { if (n.isMesh && n.material) for (const m of [].concat(n.material)) if (!mats.some((q) => q.m === m)) mats.push({ m, t: m.transparent, o: m.opacity, dw: m.depthWrite }); });
  function applyFade(k) {
    if (Math.abs(k - fadeApplied) < 0.01 && !(k === 1 && fadeApplied !== 1)) return;
    const wasOpaque = fadeApplied >= 0.999; fadeApplied = k;
    for (const q of mats) { const flip = (k < 0.999) !== !wasOpaque; q.m.opacity = q.o * k; q.m.transparent = k < 0.999 ? true : q.t; q.m.depthWrite = k < 0.999 ? false : q.dw; if (flip) q.m.needsUpdate = true; }
  }

  /* ---- the swing (outdoors): offsets tried when the arm behind him is short, nearest first; 'up' = a steeper look down from higher */
  let sw = 0, swP = 0, swT = 0, swTP = 0;
  const SW_OFF = []; for (let d = -120; d <= 120; d += 10) SW_OFF.push(d * D2R);
  const SW_UP = -30 * D2R, Q = Math.PI / 2;
  function pickSwing(h, want) {                  // score = free arm (of the wanted length) - the swing away from "behind him" - the move from the current swing (no side flips)
    const free = (o, p) => { const az = yaw + o, pv = pivotAt(h, az); return armAt(pv, az, p, want); };
    if (free(0, pitch) >= want * 0.92) { swT = 0; swTP = 0; return; }
    let best = null;
    for (const o of SW_OFF) for (const up of [0, 1]) {
      const p = up ? Math.min(pitch, SW_UP) : pitch, a = free(o, p);
      const J = Math.min(a, want) / want - 0.4 * Math.abs(o) / Q - 0.15 * Math.abs(o - sw) / Q - up * 0.08 - (a < 1.0 ? 1 : 0);
      if (!best || J > best.J) best = { o, dp: p - pitch, J };
    }
    swT = best.o; swTP = best.dp;
  }
  function pushPoles(p) {                        // thin poles: the camera point is moved sideways out of a pole's circle (continuous, so no pop)
    for (const q of cyls) {
      if (p[1] > q[3] + M_POLE) continue; const dx = p[0] - q[0], dz = p[2] - q[1], d = Math.hypot(dx, dz), R = q[2] + M_POLE;
      if (d >= R) continue; const ux = d > 1e-4 ? dx / d : Math.cos(yaw), uz = d > 1e-4 ? dz / d : -Math.sin(yaw); p[0] = q[0] + ux * R; p[2] = q[1] + uz * R;
    }
  }

  /* ---- the frame */
  function solveCamera(dt, snap) {
    const k = snap || !motion() ? 1 : 1 - Math.exp(-dt / 0.12), h = headNow();
    head[0] += (h[0] - head[0]) * k; head[1] += (h[1] - head[1]) * k; head[2] += (h[2] - head[2]) * k;
    if (SWING) {
      if (!dragging) pickSwing(head, wantCur);
      const crushed = armCur < 0.7, short = armCur < 1.2, ks = snap || !motion() ? 1 : 1 - Math.exp(-dt / (crushed ? 0.05 : short ? 0.1 : 0.35)), dS = wrap(swT - sw); sw += Math.sign(dS) * Math.min(Math.abs(dS) * ks, (crushed ? 720 : short ? 360 : 150) * D2R * Math.max(dt, 1e-3));   // crushed: swing out fast swP += (swTP - swP) * ks;
      if (snap || !motion()) { sw = swT; swP = swTP; }
    }
    const yv = yaw + sw, pt = clamp(pitch + swP, PMIN, PMAX);
    pickSide(head, yv); sideCur += (side - sideCur) * (snap || !motion() ? 1 : 1 - Math.exp(-dt / 0.15));
    const pv = pivotAt(head, yv); piv[0] = pv[0]; piv[1] = pv[1]; piv[2] = pv[2];
    hit = armAt(piv, yv, pt, wantCur);
    // the arm shortens at up to 7 m/s (never a single-frame jump while he slides along a wall, ROOM-V2 §15.2) and grows back with a 0.1 s ease; the loop below still guarantees it never ends up inside a box
    armCur = snap || !motion() ? hit : hit < armCur ? Math.max(hit, armCur - 7 * Math.min(dt, 0.05)) : armCur + (hit - armCur) * (1 - Math.exp(-dt / (SWING && armCur < 0.8 ? 0.04 : 0.1)));   // outdoors a crushed arm (in his head) comes back out fast
    const d = dirOf(yv, pt);
    for (let i = 0; i < 60; i++) {                // never inside furniture: lift over a low box, else shorten
      cam[0] = piv[0] - d[0] * armCur; cam[1] = piv[1] - d[1] * armCur; cam[2] = piv[2] - d[2] * armCur;
      const lb = lowHit(cam);
      if (lb) { const y = lb[4] + 0.1; const q = [cam[0], y, cam[2]]; if (y <= CEIL && validHard(q, piv) && !lowHit(q)) { cam[1] = y; break; } armCur = Math.max(0, armCur - 0.05); continue; }
      if (!validHard(cam, piv) && armCur > 0) { armCur = Math.max(0, armCur - 0.05); continue; }
      break;
    }
    if (SWING && !snap && motion() && dt > 0) {                         // outdoors: only the arm's GROWTH is limited (9 m/s) and the camera stays on the look ray through the pivot, so a
      const r0 = Math.hypot(camera.position.x - piv[0], camera.position.y - piv[1], camera.position.z - piv[2]), r = Math.hypot(cam[0] - piv[0], cam[1] - piv[1], cam[2] - piv[2]), mx = 9 * Math.min(dt, 0.0167);
      if (r > r0 + mx && r > 1e-3) { const k = (r0 + mx) / r; cam[0] = piv[0] + (cam[0] - piv[0]) * k; cam[1] = piv[1] + (cam[1] - piv[1]) * k; cam[2] = piv[2] + (cam[2] - piv[2]) * k; }   // fast turn never leaves him off-screen; a shorter arm on the free ray is always valid
    } else if (!snap && motion() && !dragging && dt > 0) {
      const dx = cam[0] - camera.position.x, dy = cam[1] - camera.position.y, dz = cam[2] - camera.position.z, d = Math.hypot(dx, dy, dz), mx = 9 * Math.min(dt, 0.0167);
      if (d > mx && d < 6) {
        const k = mx / d, q = [camera.position.x + dx * k, camera.position.y + dy * k, camera.position.z + dz * k];
        if (!SWING) { cam[0] = q[0]; cam[1] = q[1]; cam[2] = q[2]; }
        else for (let j = 1; ; j++) {                            // outdoors the caught-up point must not be inside a facade / cheek wall: step on along the catch-up line until it is free
          const kk = Math.min(1, k * j), r = [camera.position.x + dx * kk, camera.position.y + dy * kk, camera.position.z + dz * kk];
          if (kk >= 1 || validHard(r, piv)) { cam[0] = r[0]; cam[1] = r[1]; cam[2] = r[2]; break; }
        }
      }
    }
    if (cyls.length) pushPoles(cam);
    camera.position.set(cam[0], cam[1], cam[2]); camera.rotation.order = 'YXZ'; camera.rotation.set(pt, yv, 0);
    fade += ((armCur < 0.6 ? 0.25 : 1) - fade) * (snap || !motion() ? 1 : 1 - Math.exp(-dt / 0.08)); applyFade(fade);
  }
  function update(dt) {
    if (!on) return false; clock += dt;
    const w = c.state ? c.state() : 'free', hint = c.hint ? c.hint() : null;
    if (shot && w !== 'act') shot = null;                                           // he left the activity
    if (shot) {                                                                      // ease into the framed shot (0.8 s)
      const k = motion() ? 1 - Math.exp(-dt / 0.2) : 1;
      yaw += wrap(shot.yaw - yaw) * k; pitch += (shot.pitch - pitch) * k;
    } else if (hint && hint.fwd && clock - lastDrag > 1) {                           // gentle recentre while he walks forward
      const want = hint.yaw + Math.PI, d = wrap(want - yaw), mx = 45 * D2R * dt; yaw += Math.abs(d) <= mx ? d : Math.sign(d) * mx;
    }
    if (hint && wasFwd && !hint.fwd) settleTo = clock + 3.5;                       // a short (click-)walk ended part-way through the recentre
    if (!shot && hint && !hint.fwd && clock < settleTo && clock - lastDrag > 1 && w === 'free') {   // ...so finish it: settle in behind him (eased, <= 60 deg/s)
      const d = wrap(hint.yaw + Math.PI - yaw), mx = 60 * D2R * dt * Math.min(1, Math.abs(d) / (25 * D2R) + 0.25);
      if (!motion()) yaw += d; else yaw += Math.abs(d) <= mx ? d : Math.sign(d) * mx; if (Math.abs(d) < 0.01) settleTo = -1;
    }
    wasFwd = !!(hint && hint.fwd); yaw = wrap(yaw);
    wantCur += ((shot ? shot.arm : userArm) - wantCur) * (motion() ? 1 - Math.exp(-dt / 0.2) : 1);
    solveCamera(dt, false);
    const sig = camera.position.x.toFixed(4) + '|' + camera.position.y.toFixed(4) + '|' + camera.position.z.toFixed(4) + '|' + yaw.toFixed(4) + '|' + pitch.toFixed(4) + '|' + fade.toFixed(3);
    const ch = sig !== lastSig; lastSig = sig; return ch || dragging || (settleTo > clock && !shot);
  }

  /* ---- input: drag to look, wheel / pinch for the arm */
  const ptr = new Map(); let drag = null, dragging = false, pinch0 = 0, armPinch0 = 0;
  const onDown = (e) => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    else { drag = null; const [a, b] = [...ptr.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; armPinch0 = userArm; }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const onMove = (e) => {
    if (!on || !ptr.has(e.pointerId)) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; userArm = clamp(armPinch0 * (pinch0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1)), ARM_MIN, ARM_MAX); shot = null; kick(); return; }
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved) { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) <= LOOK_PX) return; drag.moved = true; drag.lx = drag.sx; drag.ly = drag.sy; dragging = true; }
    look((e.clientX - drag.lx) * DEG_PER_PX, (e.clientY - drag.ly) * DEG_PER_PX); drag.lx = e.clientX; drag.ly = e.clientY;
  };
  const onUp = (e) => { ptr.delete(e.pointerId); if (drag && drag.id === e.pointerId) { dragging = false; drag = null; } if (ptr.size < 2) pinch0 = 0; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } kick(); };
  function look(dxDeg, dyDeg) { yaw = clampYaw(yaw + dxDeg * D2R); pitch = clamp(pitch - dyDeg * D2R, PMIN, PMAX); shot = null; lastDrag = clock; kick(); }
  const onWheel = (e) => { if (!on) return; e.preventDefault(); userArm = clamp(userArm + Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0035, ARM_MIN, ARM_MAX); shot = null; kick(); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /* ---- activity framings (docs/ROOM-V2.md §14.5): the candidate with the most free arm wins */
  function frame(act) {
    if (!on || !act) return false; const f = [Math.sin(act.yaw), Math.cos(act.yaw)], r = [-f[1], f[0]], az = (o) => Math.atan2(o[0], o[1]);
    const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k], neg = (a) => [-a[0], -a[1]];
    let cands = [], focus = null;
    switch (act.activity) {
      case 'desk_typing': cands = [add(neg(f), r, 0.55), add(neg(f), r, -0.55)].map((o) => ({ yaw: az(o), pitch: -20 * D2R, arm: 1.7 })); break;
      case 'sofa_read': cands = [add(f, r, 0.6), add(f, r, -0.6)].map((o) => ({ yaw: az(o), pitch: -14 * D2R, arm: 2.4 })); break;
      case 'bed_sleep': { const ax = act.axis != null ? act.axis : act.yaw, foot = [Math.sin(ax + Math.PI), Math.cos(ax + Math.PI)], q = (s) => [foot[0] * Math.cos(s) + foot[1] * Math.sin(s), -foot[0] * Math.sin(s) + foot[1] * Math.cos(s)];
        cands = [q(0.7), q(-0.7), q(0)].map((o) => ({ yaw: az(o), pitch: -33 * D2R, arm: 2.8 })); if (act.centre) focus = [act.centre.x, 0.85, act.centre.z]; break; }
      case 'kettle': cands = [r, neg(r)].map((o) => ({ yaw: az(o), pitch: -15 * D2R, arm: 2.0 })); break;
      case 'window': cands = [add(neg(f), r, 0.15), neg(f)].map((o) => ({ yaw: az(o), pitch: -6 * D2R, arm: 1.8 })); break;
      default: return false;
    }
    const h = focus || [root.position.x, root.position.y + EYE, root.position.z];
    let best = null;
    for (const cd of cands) { const pv = pivotAt(h, cd.yaw), a = armAt(pv, cd.yaw, cd.pitch, cd.arm); if (!best || a > best.a + 0.05) best = { cd, a }; if (a >= cd.arm * 0.85) { best = { cd, a }; break; } }
    shot = { ...best.cd, focus }; kick(); return true;
  }
  const release = () => { if (shot) { shot = null; kick(); } };

  /* ---- debug numbers */
  function boxDistInf(p, b) { return Math.max(b[0] - p[0], 0, p[0] - b[3], b[1] - p[1], 0, p[1] - b[4], b[2] - p[2], 0, p[2] - b[5]); }
  function boxDist(p, b) { return Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[3]), Math.max(b[1] - p[1], 0, p[1] - b[4]), Math.max(b[2] - p[2], 0, p[2] - b[5])); }
  function report() {
    const p = [camera.position.x, camera.position.y, camera.position.z];
    let mw = Math.min(p[0] - B.X0, B.X1 - p[0], p[2] - B.Z0, B.Z1 - p[2], RH - p[1], p[1]); for (const b of walls) mw = Math.min(mw, boxDist(p, b));
    let mt = 9, mtn = ''; for (const b of hard) { const d = boxDist(p, b); if (d < mt) { mt = d; mtn = names.get(b) || 'wall'; } }
    let inF = null; for (const b of [...low, ...hard]) if (boxDist(p, b) === 0 && !walls.includes(b)) { inF = names.get(b) || 'box'; break; }
    let lim = null; { const d0 = dirOf(yaw, pitch), dd0 = [-d0[0] * wantCur, -d0[1] * wantCur, -d0[2] * wantCur]; let bt = clampT(piv, dd0, LO_C, HI_C); lim = bt < 1 ? 'room' : null; for (const b of hard) { const q = segBox(piv, dd0, b, M_CAM); if (q < bt) { bt = q; lim = names.get(b) || b.map((v) => +v.toFixed(2)).join(','); } } }
    const inRoom = p[0] > B.X0 && p[0] < B.X1 && p[2] > B.Z0 && p[2] < B.Z1 && p[1] > 0 && p[1] < RH;
    let inWall = false; for (const b of walls) if (boxDist(p, b) === 0) inWall = true;
    camera.updateMatrixWorld(true);            // project() needs this frame's view matrix (the renderer only refreshes it at draw time: a stale one miscounted fast turns as 'not visible')
    const t = new THREE.Vector3(root.position.x, root.position.y + 1.5, root.position.z).project(camera), insideF = t.z < 1 && Math.abs(t.x) <= 1 && Math.abs(t.y) <= 1;
    const tgt = [root.position.x, root.position.y + 1.5, root.position.z], dd = [tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]]; let occl = null; for (const b of hard) if (segBox(p, dd, b, 0) < 1) occl = names.get(b) || b.map((v) => +v.toFixed(2)).join(',');
    let minPole = 9; for (const q of cyls) if (p[1] < q[3]) minPole = Math.min(minPole, Math.hypot(p[0] - q[0], p[2] - q[1]) - q[2]);
    return { pos: p.map((v) => +v.toFixed(3)), arm: +armCur.toFixed(3), minPole: +minPole.toFixed(3), swingDeg: +(sw / D2R).toFixed(0), want: +wantCur.toFixed(2), hit: +hit.toFixed(3), mode, yawDeg: +(yaw / D2R).toFixed(1), pitchDeg: +(pitch / D2R).toFixed(1),
      limiter: lim, pivot: piv.map((v) => +v.toFixed(2)), minWall: +mw.toFixed(3), minTall: +mt.toFixed(3), minTallName: mtn, inRoom, inWall, inFurniture: inF, harivVisible: insideF && !occl && fadeApplied > 0.2, occludedBy: occl, headNdc: [+t.x.toFixed(2), +t.y.toFixed(2)], fade: +fadeApplied.toFixed(2), shot: shot ? 'on' : 'off', fov: camera.fov };
  }

  function enable(v) {
    if (v === on) return; on = !!v; mode = on ? 'inside' : 'overview';
    if (on) {
      camera.fov = 60; camera.near = 0.05; camera.updateProjectionMatrix();
      yaw = yaw0 = wrap(root.rotation.y + Math.PI); pitch = PITCH0; side = sideCur = 1; shot = null; lastDrag = -9;
      head[0] = root.position.x; head[1] = root.position.y + EYE; head[2] = root.position.z; wantCur = userArm; armCur = 0; solveCamera(0, true); armCur = hit; solveCamera(0, true);
    } else { applyFade(1); fade = 1; camera.fov = 38; camera.near = 0.1; camera.updateProjectionMatrix(); camera.rotation.order = 'XYZ'; }
    kick();
  }
  return {
    enable, update, frame, release, report, look, get on() { return on; }, get yaw() { return yaw; }, get pitch() { return pitch; }, get arm() { return armCur; },
    setLook(yDeg, pDeg) { yaw = clampYaw(yDeg * D2R); pitch = clamp(pDeg * D2R, PMIN, PMAX); shot = null; lastDrag = clock; if (on) solveCamera(0, true); kick(); },
    snap() { if (on) { solveCamera(0, true); kick(); } },
    // slice 3 (streaming): replace the dynamic boxes ([x0,y0,z0,x1,y1,z1]) the district adds around the walker; they are walls for the arm, the fade and the metrics
    setExtra(boxes) { for (const b of extra) { let i = hard.indexOf(b); if (i >= 0) hard.splice(i, 1); i = walls.indexOf(b); if (i >= 0) walls.splice(i, 1); } extra = boxes; for (const b of extra) { hard.push(b); walls.push(b); } },
    dispose() { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('wheel', onWheel); applyFade(1); },
  };
}
