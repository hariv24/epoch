// city/people_fit.js · "nothing passes through anything" for people in any scene (docs/PEOPLE-SPEC.md §10.2). Generic: the Today room uses it
// now; Butler desks, café tables, benches and rails reuse it (they only have to hand over their furniture boxes).
//   makeVols(items)                 world OBBs from furniture (Geo.vols + pose), tagged seat / desktop / keyboard / floor / wall / other
//   sampleCloud(P, clip, opt)       the skinned vertices of a person over N frames of a clip (root-local, placement independent)
//   evaluate(cloud, place, vols)    per-object penetration / clearance / designed-contact report for a placement
//   solve(cloud, vols, base, opt)   search x/z (+-20 cm) and yaw (+-15 deg) around an anchor for a placement that passes; cached per key
//   fitGrip(P, clip, prop, side)    the rigid transform that puts a prop in the hand over the whole clip (penetration <= 0.5 cm)
//   bookOnThighs(...)               the open book placed from the thigh vertices, on the lap
//   findStandSpot(...)              a free floor spot >= 15 cm from furniture over the whole clip, facing a target
//   makeMug() / makeBook()          procedural props with real sizes (mug 8 cm x 9.5 cm with a handle; open paperback 12.5 x 18 x 2.5 cm per page, cover + page block)
//   formatReport(rep)               the printed text; window.__peopleFit exposes everything for debugging.
// Nothing here edits a bone: only the person's root placement, furniture heights (within real-world ranges) and props change.
import * as THREE from 'three';

/* ------------------------------------------------------------------ groups */
import { GROUPS, DESIGNED, sdist, thin, evaluate, solve, findStandSpot, setTol, bookOnThighs } from './world/fitmath.js';
export { GROUPS, thin, evaluate, solve, findStandSpot, setTol, bookOnThighs };   // bookOnThighs lives in fitmath (it also runs in the fit worker)
const GI = Object.fromEntries(GROUPS.map((g, i) => [g, i]));
const keyOf = (n) => n.replace(/_\d+$/, '').replace(/^mixamorig\d*[:_]?/, '');
export function groupOf(key) {
  if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(key)) return 'finger';
  if (/Hand$/.test(key)) return 'hand';
  if (/ForeArm/.test(key)) return 'forearm';
  if (/Arm$|Shoulder/.test(key)) return 'upperarm';
  if (/Hips/.test(key)) return 'pelvis';
  if (/UpLeg/.test(key)) return 'thigh';
  if (/Leg$/.test(key)) return 'shin';
  if (/Foot|Toe/.test(key)) return 'foot';
  if (/Neck|Head/.test(key)) return 'head';
  return 'torso';
}
const sideOf = (key) => (/^Left/.test(key) ? 1 : /^Right/.test(key) ? 2 : 0);

/* ------------------------------------------------------------------ volumes (OBBs: an axis-aligned box in a furniture frame, yawed + moved) */
// (the evaluate / solve / findStandSpot maths and the designed-contact tables live in world/fitmath.js: pure arrays, shared with the fit worker)

// items: [{ name, vols: Geo.vols, x, y, z, ry, tag?(box)->kind }]; extra: more world-space volumes ({ name, kind, b:[x0,y0,z0,x1,y1,z1] })
export function makeVols(items, extra = []) {
  const out = [];
  for (const it of items) {
    const c = Math.cos(it.ry || 0), s = Math.sin(it.ry || 0);
    (it.vols || []).forEach((b, i) => {
      const kind = (it.tag && it.tag(b, i)) || 'other';
      out.push(mkVol(it.name + '#' + i, kind, b, it.x || 0, it.y || 0, it.z || 0, c, s));
    });
  }
  for (const e of extra) out.push(mkVol(e.name, e.kind || 'other', e.b, e.x || 0, e.y || 0, e.z || 0, e.c ?? 1, e.s ?? 0));
  return out;
}
function mkVol(name, kind, b, px, py, pz, c, s) {
  const xs = [], zs = [];
  for (const lx of [b[0], b[3]]) for (const lz of [b[2], b[5]]) { xs.push(px + lx * c + lz * s); zs.push(pz - lx * s + lz * c); }
  return { name, kind, b, px, py, pz, c, s, wb: [Math.min(...xs), py + b[1], Math.min(...zs), Math.max(...xs), py + b[4], Math.max(...zs)] };
}
// horizontal frame helper: item-local -> world
export const toWorld = (it, lx, lz) => { const c = Math.cos(it.ry), s = Math.sin(it.ry); return [it.x + lx * c + lz * s, it.z - lx * s + lz * c]; };

/* ------------------------------------------------------------------ the sampled cloud */
function* sampleGen(P, clip, o = {}) {              // one `yield` per sampled frame, so a caller can hand the main thread back between frames
  const F = o.frames || 24, stride = o.stride || 4, dur = P.clipDuration(clip), t0 = o.t0 || 0, span = (o.t1 || dur) - t0;
  const meshes = P.meshes(), parts = [];
  let n = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, idx = [], grp = [], sid = [];
    const gOfBone = m.skeleton.bones.map((b) => { const k = keyOf(b.name); return [GI[groupOf(k)], sideOf(k)]; });
    for (let i = 0; i < pos.count; i += stride) {
      let bj = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bj = si.getComponent(i, k); } }
      idx.push(i); grp.push(gOfBone[bj][0]); sid.push(gOfBone[bj][1]);
    }
    parts.push({ m, idx, grp, sid }); n += idx.length;
  }
  const grp = new Uint8Array(n), side = new Uint8Array(n);
  { let o2 = 0; for (const p of parts) { grp.set(p.grp, o2); side.set(p.sid, o2); o2 += p.idx.length; } }
  const frames = [], v = new THREE.Vector3(), inv = new THREE.Matrix4();
  const savedPos = P.root.position.clone(), savedRot = P.root.rotation.y, savedCur = P.current;
  P.root.position.set(0, 0, 0); P.root.rotation.y = 0;                                  // sample at the origin: the cloud is root-local
  for (let f = 0; f < F; f++) {
    P.still(clip, t0 + (span * f) / F);
    P.root.updateMatrixWorld(true); inv.copy(P.root.matrixWorld).invert();
    const a = new Float32Array(n * 3); let o2 = 0;
    for (const p of parts) {
      p.m.skeleton.update();
      for (const i of p.idx) { p.m.getVertexPosition(i, v); v.applyMatrix4(p.m.matrixWorld).applyMatrix4(inv); a[o2++] = v.x; a[o2++] = v.y; a[o2++] = v.z; }
    }
    frames.push(a); yield f;
  }
  P.root.position.copy(savedPos); P.root.rotation.y = savedRot; void savedCur;
  return { clip, n, F, frames, grp, side, dur, t0, span };
}
export function sampleCloud(P, clip, o = {}) { const g = sampleGen(P, clip, o); let r; while (!(r = g.next()).done); return r.value; }
// the same, but gives the main thread back every ~25 ms (no long task). The person must not be on screen meanwhile: it is posed at the origin frame by frame.
export async function sampleCloudAsync(P, clip, o = {}) {
  const g = sampleGen(P, clip, o), vis = P.root.visible; P.root.visible = false;
  try { let t = performance.now(); for (;;) { const r = g.next(); if (r.done) return r.value; if (performance.now() - t > 25) { await new Promise((res) => setTimeout(res, 0)); t = performance.now(); } } } finally { P.root.visible = vis; }
}
/* ------------------------------------------------------------------ the placement solver (cached) */
const solveCache = new Map();
export function cacheGet(key) { if (solveCache.has(key)) return solveCache.get(key); try { const s = localStorage.getItem('epoch.fit.' + key); if (s) { const v = JSON.parse(s); solveCache.set(key, v); return v; } } catch { /* storage may be blocked */ } return null; }
export function cachePut(key, v) { solveCache.set(key, v); try { localStorage.setItem('epoch.fit.' + key, JSON.stringify(v)); } catch { /* ignore */ } }
export function cacheClear() { solveCache.clear(); try { for (const k of Object.keys(localStorage)) if (k.startsWith('epoch.fit.')) localStorage.removeItem(k); } catch { /* ignore */ } }

/* ------------------------------------------------------------------ props: real sizes, bevelled */
const mat = (c, r = 0.5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
function roundedBox(w, h, d, r, material) {                      // an extruded rounded rectangle with a bevel on the faces
  const s = new THREE.Shape(), x = w / 2 - r, y = d / 2 - r;
  s.moveTo(-x, -d / 2); s.lineTo(x, -d / 2); s.absarc(x, -y, r, -Math.PI / 2, 0); s.lineTo(w / 2, y); s.absarc(x, y, r, 0, Math.PI / 2); s.lineTo(-x, d / 2); s.absarc(-x, y, r, Math.PI / 2, Math.PI); s.lineTo(-w / 2, -y); s.absarc(-x, -y, r, Math.PI, Math.PI * 1.5);
  const bev = Math.min(0.0018, h / 3), g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, h - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);               // lies on y = 0, thickness up
  g.computeVertexNormals(); return new THREE.Mesh(g, material);
}
// mug: base at y = 0 on its axis, handle on +x. Body 8 cm across (outer), 9.5 cm tall, wall 4 mm, rim and base bevelled.
export const MUG = { r: 0.04, h: 0.095, handleX: 0.04, handleR: 0.0245, handleTube: 0.0055, handleY: 0.05 };
export function makeMug() {
  const g = new THREE.Group(); g.name = 'mug';
  const ceramic = mat(0xe9e3d4, 0.38), coffee = mat(0x3b2616, 0.25);
  const R = MUG.r, H = MUG.h, w = 0.004, b = 0.0035;
  const pts = [[0.001, 0], [R - b, 0], [R - 0.0007, 0.0007], [R, b], [R, H - b], [R - 0.0007, H - 0.0007], [R - b, H], [R - w + b, H], [R - w, H - 0.0007], [R - w, H - 0.011], [0.001, H - 0.011]].map((p) => new THREE.Vector2(p[0], p[1]));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), ceramic); body.material.side = THREE.DoubleSide;
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(R - w, 32), coffee); liquid.rotation.x = -Math.PI / 2; liquid.position.y = H - 0.017;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(MUG.handleR, MUG.handleTube, 10, 24, Math.PI), ceramic);
  handle.position.set(MUG.handleX, MUG.handleY, 0); handle.rotation.z = -Math.PI / 2;
  g.add(body, liquid, handle); return g;
}
// open book lying on y = 0: 25 cm across (two 12.5 cm pages), 18 cm deep (the spine runs along z), 2.5 cm thick at the spine
export const BOOK = { w: 0.125, d: 0.18, t: 0.025 };           // a paperback: 15 x 22 does not fit the lap of Sitting Idle (belly to hands on the knees is ~14 cm), so 12.5 x 18 per page
export function makeBook() {
  const g = new THREE.Group(); g.name = 'book';
  const cover = mat(0x2f4d6e, 0.7), pages = mat(0xf1ead8, 0.9), edge = mat(0xe3dcc8, 0.9);
  for (const s of [-1, 1]) {
    const half = new THREE.Group();
    const c = roundedBox(BOOK.w + 0.004, 0.003, BOOK.d + 0.008, 0.003, cover); c.position.set(0, 0, 0);
    const p = roundedBox(BOOK.w - 0.004, BOOK.t - 0.012, BOOK.d - 0.004, 0.002, pages); p.position.set(0, 0.003, 0);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BOOK.w - 0.01, BOOK.d - 0.012), mat(0xf6f1e3, 0.85)); top.rotation.x = -Math.PI / 2; top.position.y = 0.003 + BOOK.t - 0.012 + 0.0004;
    half.add(c, p, top); void edge;
    half.position.x = s * (BOOK.w / 2 + 0.0005); half.rotation.z = -s * 0.07;           // a shallow V towards the spine
    g.add(half);
  }
  const spine = roundedBox(0.012, BOOK.t - 0.004, BOOK.d + 0.008, 0.002, cover); spine.position.y = -0.0004; g.add(spine);
  return g;
}
// collision volumes (prop-local, axis-aligned boxes) for the check
export const MUG_VOL = [-MUG.r, 0, -MUG.r, MUG.r, MUG.h, MUG.r];
export const BOOK_VOL = [-BOOK.w - 0.004, 0, -BOOK.d / 2 - 0.004, BOOK.w + 0.004, BOOK.t, BOOK.d / 2 + 0.004];

/* ------------------------------------------------------------------ grip: where the prop sits in a hand over the whole clip */
function mugPen(x, y, z) {                                        // penetration depth (m, >0 = inside) of a mug-local point; the handle is a half torus
  let pen = -1e9;
  const r = Math.hypot(x, z);
  if (y > 0 && y < MUG.h && r < MUG.r) pen = Math.min(MUG.r - r, y, MUG.h - y);
  const hx = x - MUG.handleX, hy = y - MUG.handleY;
  if (hx > -0.002) { const d = Math.hypot(Math.hypot(hx, hy) - MUG.handleR, z); pen = Math.max(pen, MUG.handleTube - d); }
  return pen;
}
function mugGap(x, y, z) {                                         // distance to the body, or to the handle tube (a mug is held by its handle as much as by its body)
  const dr = Math.max(Math.hypot(x, z) - MUG.r, 0), dy = Math.max(-y, y - MUG.h, 0); let d = Math.hypot(dr, dy);
  const hx = x - MUG.handleX, hy = y - MUG.handleY;
  if (hx > -0.002) d = Math.min(d, Math.max(0, Math.hypot(Math.hypot(hx, hy) - MUG.handleR, z) - MUG.handleTube));
  return d;
}
let TILTW = 60;
export const setTiltWeight = (w) => { TILTW = w; };
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// side: 'Right' | 'Left'. Returns { pos: Vector3, quat: Quaternion } of the prop in the hand-bone frame (metres, no scale), and the verification report.
export function fitGrip(P, clip, side = 'Right', o = {}) {
  const hand = P.bones[side + 'Hand']; if (!hand) throw new Error('no ' + side + 'Hand');
  const F = o.frames || 24, dur = P.clipDuration(clip), t0 = o.t0 || 0, span = (o.t1 || dur) - t0;
  const meshes = P.meshes(), want = new Set(), tmp = new THREE.Vector3();
  const parts = meshes.map((m) => {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, pos = m.geometry.attributes.position, idx = [];
    const ok = m.skeleton.bones.map((b) => { const k = keyOf(b.name); return k.startsWith(side + 'Hand') ? 1 : 0; });
    for (let i = 0; i < pos.count; i += 2) { let bj = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bj = si.getComponent(i, k); } } if (ok[bj]) idx.push(i); }
    return { m, idx };
  }); void want;
  const frames = [], handQ = [], handY = [], pq = new THREE.Quaternion(), pp = new THREE.Vector3(), ps = new THREE.Vector3(), M = new THREE.Matrix4();
  const sp = P.root.position.clone(), sr = P.root.rotation.y; P.root.position.set(0, 0, 0); P.root.rotation.y = 0;
  for (let f = 0; f < F; f++) {
    P.still(clip, t0 + (span * f) / F); P.root.updateMatrixWorld(true);
    hand.matrixWorld.decompose(pp, pq, ps); M.compose(pp, pq, new THREE.Vector3(1, 1, 1)).invert(); handQ.push(pq.clone()); handY.push(pp.y);
    const pts = [];
    for (const p of parts) { p.m.skeleton.update(); for (const i of p.idx) { p.m.getVertexPosition(i, tmp); tmp.applyMatrix4(p.m.matrixWorld).applyMatrix4(M); pts.push(tmp.x, tmp.y, tmp.z); } }
    frames.push(Float32Array.from(pts));
  }
  P.root.position.copy(sp); P.root.rotation.y = sr;
  // candidate = prop frame in the hand frame: axis (prop +y) in one of 6 directions, roll (handle direction) in 12 steps, position on a grid
  const qs = [];
  { const N = 220, ga = Math.PI * (3 - Math.sqrt(5));                       // prop axis directions spread over the sphere, 12 rolls each
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = new THREE.Vector3(Math.cos(ga * i) * r, y, Math.sin(ga * i) * r), qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), a);
      for (let k = 0; k < 12; k++) qs.push(new THREE.Quaternion().setFromAxisAngle(a, (k / 12) * Math.PI * 2).multiply(qa));
    } }
  const up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(), tiltOf = (q, hq) => { ax.set(0, 1, 0).applyQuaternion(q).applyQuaternion(hq); return Math.acos(Math.max(-1, Math.min(1, ax.dot(up)))); };
  const evalCand = (pos, q, fr, stride, hqs, hys) => {
    const inv = q.clone().invert(); let maxPen = -1e9, gapSum = 0, cnt = 0, tilt = 0; const v = new THREE.Vector3();
    for (let fi = 0; fi < fr.length; fi++) {
      const f = fr[fi]; if (hqs) { const t = tiltOf(q, hqs[fi]), lap = hys[fi] < 0.78 ? 1 : 0.05; tilt += lap * Math.max(0, t - 0.4) * (t > 1.2 ? 4 : 1); }
      let fg = 1e9;
      for (let i = 0; i < f.length; i += 3 * stride) {
        v.set(f[i] - pos.x, f[i + 1] - pos.y, f[i + 2] - pos.z).applyQuaternion(inv);
        const p = mugPen(v.x, v.y, v.z); if (p > maxPen) maxPen = p;
        if (p <= 0) { const g = mugGap(v.x, v.y, v.z); if (g < fg) fg = g; } else fg = 0;
      }
      gapSum += fg; cnt++;
    }
    return { maxPen, gap: gapSum / cnt, tilt: hqs ? tilt / cnt : 0, score: 1000 * Math.max(0, maxPen - 0.0003) + 60 * (gapSum / cnt) + TILTW * (hqs ? tilt / cnt : 0) };
  };
  { // keep the orientations that hold the prop (mostly) upright over the clip, as a real mug is held
    const meanTilt = (q) => { let t = 0, n = 0; handQ.forEach((hq, i) => { if (handY[i] < 0.78) { t += tiltOf(q, hq); n++; } }); return t / Math.max(1, n); };
    const scored = qs.map((q) => ({ q, t: meanTilt(q) })).sort((x, y) => x.t - y.t);
    const keep = scored.filter((e) => e.t < 0.45).map((e) => e.q);
    qs.length = 0; qs.push(...(keep.length >= 30 ? keep : scored.slice(0, 30).map((e) => e.q)));
  }
  const fewI = [0, 4, 8, 12, 16, 20], few = fewI.map((i) => frames[i % F]), fewQ = fewI.map((i) => handQ[i % F]), fewY = fewI.map((i) => handY[i % F]);
  let cands = [];
  const g0 = 0.05, gs = 0.01;
  for (const q of qs) for (let x = -g0; x <= g0 + 1e-9; x += gs) for (let y = -g0; y <= g0 + 1e-9; y += gs) for (let z = -g0; z <= g0 + 1e-9; z += gs) {
    const pos = new THREE.Vector3(x, y, z), r = evalCand(pos, q, few, 5, fewQ, fewY); cands.push({ pos, q, score: r.score + 3 * pos.length() });
  }
  cands.sort((a, b) => a.score - b.score); cands = cands.slice(0, 12);
  let best = null;
  for (const c of cands) {
    let cur = { pos: c.pos.clone(), q: c.q.clone() }, cs = evalCand(cur.pos, cur.q, frames, 1, handQ, handY).score + 3 * cur.pos.length();
    for (const st of [0.004, 0.002, 0.001]) for (let it = 0; it < 3; it++) for (const d of [[st, 0, 0], [-st, 0, 0], [0, st, 0], [0, -st, 0], [0, 0, st], [0, 0, -st]]) {
      const np = cur.pos.clone().add(new THREE.Vector3(...d)), s = evalCand(np, cur.q, frames, 1, handQ, handY).score + 3 * np.length();
      if (s < cs) { cs = s; cur.pos = np; }
    }
    for (const ang of [0.08, -0.08, 0.04, -0.04]) for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const nq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax), ang).multiply(cur.q), s = evalCand(cur.pos, nq, frames, 1, handQ, handY).score + 3 * cur.pos.length();
      if (s < cs) { cs = s; cur.q = nq; }
    }
    if (!best || cs < best.cs) best = { ...cur, cs };
  }
  const contact = (() => { const inv = best.q.clone().invert(), v = new THREE.Vector3(); let n = 0, mx = 0; for (const f of frames) { let c = 0; for (let i = 0; i < f.length; i += 3) { v.set(f[i] - best.pos.x, f[i + 1] - best.pos.y, f[i + 2] - best.pos.z).applyQuaternion(inv); if (mugPen(v.x, v.y, v.z) <= 0 && mugGap(v.x, v.y, v.z) < 0.006) c++; } n += c; mx = Math.max(mx, c); } return { mean: n / frames.length, max: mx, of: frames[0].length / 3 }; })();
  const fin = evalCand(best.pos, best.q, frames, 1, handQ, handY), tl = handQ.map((hq) => tiltOf(best.q, hq) * 57.3), lapTilt = tl.filter((t, i) => handY[i] < 0.78);
  return { pos: best.pos, quat: best.q, contact, maxPen: Math.max(0, fin.maxPen), gap: fin.gap, ok: fin.maxPen <= 0.005, tiltMax: Math.max(...tl), tiltMean: tl.reduce((a, b) => a + b, 0) / tl.length, lapTiltMean: lapTilt.reduce((a, b) => a + b, 0) / Math.max(1, lapTilt.length), lapTiltMax: Math.max(0, ...lapTilt) };
}
// attach a prop to the hand bone with the fitted frame (world metres -> bone units)
export function attachToHand(P, obj, grip, side = 'Right') {
  const b = P.bones[side + 'Hand'], ws = new THREE.Vector3(), bq = new THREE.Quaternion(), bp = new THREE.Vector3();
  b.add(obj); b.updateWorldMatrix(true, false); b.matrixWorld.decompose(bp, bq, ws);
  const bqi = bq.clone().invert();
  obj.scale.setScalar(1 / ws.x);                                   // the prop is modelled in metres
  obj.position.copy(grip.pos).multiplyScalar(1 / ws.x);              // grip.pos / grip.quat are in the hand frame (the bone's own axes)
  obj.quaternion.copy(grip.quat); void bqi;
  return obj;
}

/* ------------------------------------------------------------------ reading: the open book rests on the thighs */
// cloud: sampled at the sit clip. Returns { x, y, z, yaw } in root-local metres (book base on y, centred), found from the thigh vertices at the clip's first frames.
// which way a sit/stand clip faces in root-local space (radians about +y from +z): from the pelvis to the feet of the first frame
export function clipFacing(cloud) {
  const a = cloud.frames[0]; let hx = 0, hz = 0, hn = 0, fx = 0, fz = 0, fn = 0;
  for (let i = 0; i < cloud.n; i++) { const g = cloud.grp[i]; if (g === GI.pelvis) { hx += a[i * 3]; hz += a[i * 3 + 2]; hn++; } else if (g === GI.foot) { fx += a[i * 3]; fz += a[i * 3 + 2]; fn++; } }
  return Math.atan2(fx / fn - hx / hn, fz / fn - hz / hn);
}

/* ------------------------------------------------------------------ the printed report */
export function formatReport(title, rep, extra = '') {
  const L = ['[fit] ' + title + (extra ? '  ' + extra : '')];
  for (const r of rep.rows.slice().sort((a, b) => Math.max(b.penND, b.penD) - Math.max(a.penND, a.penD))) {
    const cm = (v) => (Math.abs(v) > 50 ? '  -  ' : (v * 100).toFixed(1).padStart(5));
    L.push('  ' + r.name.padEnd(30) + r.kind.padEnd(9) + 'pen ' + cm(r.penND) + ' cm  clear ' + cm(r.clear) + ' cm' + (DESIGNED[r.kind] ? '  contact(' + DESIGNED[r.kind].join('/') + ') ' + cm(r.contact) + ' cm pen ' + cm(r.penD) : '') + '  ' + r.status + (r.note ? ' (' + r.note + ')' : ''));
  }
  L.push('  RESULT ' + (rep.ok ? (rep.clean ? 'PASS' : 'PASS (gate) with near-misses') : 'FAIL') + '  max penetration ' + (rep.maxPen * 100).toFixed(2) + ' cm');
  return L.join('\n');
}
export const _internals = { sdist, mkVol, GI };
