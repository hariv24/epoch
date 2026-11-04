// city/world/district.js · slice 3 (docs/WORLD.md 14): walkable Harlem around home, STREAMED. attachDistrict(S, o) adds to a mounted street (street.js, o.district) the units of
// data/h/ (scripts/world/district.mjs): block-face chunks (buildings + sidewalk + props) and intersections. Each unit is fetched on demand, built in the street worker
// (kit.js buildUnit, no `three`; the worker caches its messages in IndexedDB, so a second visit streams from disk) and turned into meshes here a few ms per tick.
//   Ring: units load when their bounding box is within LOAD_R (250 m) of the camera, nearest first, two at a time; they unload beyond UNLOAD_R (340 m).
//   Tiers (fade.js): NEAR (the full kit) for a unit whose nearest point is within ON_D (84 m; it drops back beyond OFF_D = 100 m: hysteresis), MID (extruded footprints + a window-grid
//   atlas) out to ~320 m, the fog is the far tier. Slice 3 step 3: a unit that changes tier cross-fades by TIME (RAMP_MS = 1 s of screen-door dither, ramped per unit), then it is fully
//   solid with no dither at all. A group's visibility only flips where its contribution is already zero (so there is no pop; logged in tierLog).
//   Also here: street trees (EZ-Tree instance pools), parked cars (cars.js pool), the walker's dynamic colliders (collidersNear), groundAt, bounds.
import { autumnLeaves, treeTint } from './foliage.js';
export async function attachDistrict(S, o = {}) {
  const THREE = S.THREE, base = new URL('./data/h/', import.meta.url), F = S.FADE;
  const index = await fetch(new URL('index.json', base)).then((r) => r.json());
  const LOAD_R = o.loadR || 250, UNLOAD_R = LOAD_R + 90, ON_D = o.nearOn || 84, OFF_D = o.nearOff || 100, RAMP_MS = o.rampMs || 1000, MID_END = F.far1 + 6, ver = String(index.units.reduce((a, u) => a + u.bytes, 0));
  const streets = index.streets.map((s) => ({ ...s, rd: s.roadbed / 2 })), aves = index.avenues.map((a) => ({ ...a }));
  const A = index.area, ss = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const U = new Map(), tierLog = [], stats = { requested: 0, ready: 0, cached: 0, built: 0, workerMs: 0, cachedMs: 0, msgMax: 0, late: 0, unloaded: 0, builtMs: [], cachedMsList: [] };
  for (const m of index.units) U.set(m.id, { id: m.id, meta: m, bbox: m.bbox, state: 'idle', gN: null, gM: null, objs: [], pending: 0, done: false, col: null, showN: false, showM: false, cars: null, trees: [], t0: 0, tObj: null, wantN: false, ramp: null });
  let preloaded = false, rev = 0, camP = new THREE.Vector3(), inflight = 0, lastUpd = -1e9, tick = 0;
  const queue = [];                                                           // worker messages waiting to become meshes (time-sliced)

  /* ---- the world's ground: one asphalt plane under everything (roadways); the units lay sidewalks, yards and paint on top */
  {
    const x0 = A.xOut[0] - 40, x1 = A.xOut[1] + 40, z0 = A.zOut[0] - 40, z1 = A.zOut[1] + 40, g = new THREE.BufferGeometry();
    // slice 3 step 2: the plane is cut round the holes in the ground (index.holes: the subway stairwell), as strips
    let rs = [[x0, z0, x1, z1]];
    for (const h of index.holes || []) rs = rs.flatMap((q) => { if (h[0] >= q[2] || h[2] <= q[0] || h[1] >= q[3] || h[3] <= q[1]) return [q];
      const out = []; if (h[1] > q[1]) out.push([q[0], q[1], q[2], h[1]]); if (h[3] < q[3]) out.push([q[0], h[3], q[2], q[3]]); const za = Math.max(q[1], h[1]), zb = Math.min(q[3], h[3]);
      if (h[0] > q[0]) out.push([q[0], za, h[0], zb]); if (h[2] < q[2]) out.push([h[2], za, q[2], zb]); return out; });
    const P = [], N = [], UV = [], I = [];
    rs.forEach((q, k) => { P.push(q[0], 0, q[1], q[2], 0, q[1], q[2], 0, q[3], q[0], 0, q[3]); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); UV.push(q[0], q[1], q[2], q[1], q[2], q[3], q[0], q[3]); const b = 4 * k; I.push(b, b + 2, b + 1, b, b + 3, b + 2); });
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(P.length).fill(0.89), 3)); g.setIndex(I);
    const m = new THREE.Mesh(g, S.M.asphalt); m.position.y = -0.17; m.receiveShadow = true; m.matrixAutoUpdate = true; m.frustumCulled = false; S.world.add(m); m.updateMatrix(); m.matrixAutoUpdate = false;
  }

  /* ---- ground height + bounds (street frame) */
  const roadK = (x, z) => {
    let k = 0;
    for (const s of streets) { const d = Math.abs(z - (s.z + s.k * x)) - s.rd; if (d < 0.25) k = Math.max(k, 1 - ss(d / 0.25 + 0.0)); }
    for (const a of aves) { const d = Math.abs(x - a.x) - a.rd; if (d < 0.25) k = Math.max(k, 1 - ss(d / 0.25)); }
    return k;
  };
  const groundAt = (x, z) => -0.16 * roadK(x, z);
  const xFDB = aves.find((a) => /FREDERICK/.test(a.key)).x, xMMP = aves.find((a) => /MOUNT MORRIS/.test(a.key)).x;
  const bounds = { X0: xFDB - 4, X1: xMMP - 3, Z0: streets.find((s) => s.n === 126).z - 2, Z1: streets.find((s) => s.n === 120).z + 2 };

  /* ---- the soft barrier (slice 3 step 3): orange-and-white Type III barricades across the roadway on the three edges where the walk ends (126th, 120th, Frederick Douglass Blvd) (the walker's toast says "Unlocks with more of Harlem").
     Three instanced meshes (top board, bottom board, legs), 3 draw calls, ~25k triangles; they sit just beyond the walk limit (0.5 m past where the walker stops). */
  {
    const edges = [['z', bounds.Z0 + 0.35, bounds.X0, bounds.X1], ['z', bounds.Z1 - 0.35, bounds.X0, bounds.X1], ['x', bounds.X0 + 0.35, bounds.Z0, bounds.Z1]];   // (no barricades along Mount Morris Park West: the park fence is that edge)
    const P = [], bx = new THREE.BoxGeometry(1, 1, 1), mk = (c, n) => { const im = new THREE.InstancedMesh(bx, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }), n); im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; return im; };
    for (const [ax, c, a, b] of edges) for (let t = a + 1.5; t < b - 1.5; t += 2.7) { if (ax === 'z') P.push([t, c, 0]); else P.push([c, t, Math.PI / 2]); }
    const top = mk(0xe8650a, P.length), bot = mk(0xf2f0e8, P.length), leg = mk(0x2c2f33, P.length * 2), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), yAx = new THREE.Vector3(0, 1, 0);
    P.forEach(([x, z, ry], i) => {
      q.setFromAxisAngle(yAx, ry); const cs = Math.cos(ry), sn = Math.sin(ry);
      top.setMatrixAt(i, m.compose(v.set(x, 1.0, z), q, sc.set(2.3, 0.22, 0.05))); bot.setMatrixAt(i, m.compose(v.set(x, 0.72, z), q, sc.set(2.3, 0.22, 0.05)));
      for (const [k, sgn] of [[0, -1], [1, 1]]) leg.setMatrixAt(i * 2 + k, m.compose(v.set(x + cs * sgn * 1.0, 0.5, z - sn * sgn * 1.0), q, sc.set(0.06, 1.0, 0.6)));
    });
    for (const im of [top, bot, leg]) { im.instanceMatrix.needsUpdate = true; S.world.add(im); }
    top.name = bot.name = leg.name = 'edge-barrier'; var barrierCount = P.length;
  }

  /* ---- messages -> meshes (a few ms per slice) */
  const pumpOnce = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 4) {
      const { m, u } = queue.shift(); if (u.dead) { u.pending--; continue; }
      const tier = m.tier === 'm' ? 'm' : 'n', grp = tier === 'm' ? u.gM : u.gN;
      try { S.addMsg(m, grp, u.objs); } catch (e) { console.warn('district addMsg', e); }
      u.pending--; if (u.done && u.pending === 0) ready(u);
    }
    stats.sliceMax = Math.max(stats.sliceMax || 0, performance.now() - t0);
    if (queue.length) setTimeout(pumpOnce, 0);
  };
  let pumping = false;
  const kickPump = () => { if (!pumping) { pumping = true; setTimeout(() => { pumping = false; pumpOnce(); }, 0); } };
  S.onUnitMsg = (m) => {
    const u = U.get(m.uid); if (!u || u.state === 'idle') return;
    if (m.t === 'mesh' || m.t === 'inst') { u.pending++; queue.push({ m, u }); kickPump(); }
    else if (m.t === 'unitcol') u.col = m.col;
    else if (m.t === 'unitdone') { u.done = true; u.cached = !!m.cached; u.workerMs = m.ms; u.stats = m.stats; if (u.pending === 0) ready(u); }
    else if (m.t === 'error') { console.warn('district unit', m.uid, m.message); u.state = 'idle'; u.dead = false; inflight = Math.max(0, inflight - 1); }
  };

  /* ---- trees (EZ-Tree variants, instance pools) */
  const TREE_R = o.treeR || 80, TREE_CAP = o.treeCap || 90;
  let treePool = null, treeBusy = null;
  function ensureTrees() {
    if (treePool || treeBusy) return treeBusy;
    const { Tree, treeOpts, AUT } = S.treeKit, V = [['plane', 11], ['plane', 23], ['plane', 37], ['locust', 5], ['locust', 41]], out = [];
    treeBusy = new Promise((done) => {
      const next = (i) => {
        if (i < V.length) { const tr = new Tree(); tr.options.copy(treeOpts(V[i][0], V[i][1])); tr.generate(); tr.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(tr); out.push({ kind: V[i][0], tr, h: bb.max.y - bb.min.y }); setTimeout(() => next(i + 1), 0); return; }
        out.forEach((v, vi) => {
          autumnLeaves(v.tr, V[vi][1] * 31 + vi);                                  // foliage.js: clustered green / yellow / orange, a plain alpha-cutout leaf card
          v.tr.branchesMesh.material.specular = new THREE.Color(0x080808); v.tr.branchesMesh.material.shininess = 4;
          v.ims = [[v.tr.branchesMesh, false], [v.tr.leavesMesh, true]].map(([mesh, tinted]) => { const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, TREE_CAP); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; if (tinted) im.setColorAt(0, new THREE.Color(1, 1, 1)); S.world.add(im); return { im, tinted }; });
        });
        treePool = { out, AUT }; done(treePool);
      };
      setTimeout(() => next(0), 0);
    });
    return treeBusy;
  }
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), vv = new THREE.Vector3(), sc = new THREE.Vector3(), cc = new THREE.Color();
  let treesAt = [1e9, 1e9, -1];
  function updateTrees(force) {
    if (!treePool) return;
    if (!force && Math.hypot(camP.x - treesAt[0], camP.z - treesAt[1]) < 4 && treesAt[2] === rev) return; treesAt = [camP.x, camP.z, rev];
    const cand = [[], [], [], [], []];
    for (const u of U.values()) if (u.state === 'ready' && u.trees.length && u.dmin < TREE_R + 30) for (const t of u.trees) { const d = Math.hypot(t[0] - camP.x, t[1] - camP.z); if (d < TREE_R) cand[t.v].push([d, t]); }
    treePool.out.forEach((v, j) => {
      const list = cand[j].sort((a, b) => a[0] - b[0]).slice(0, TREE_CAP);
      v.ims.forEach(({ im, tinted }) => {
        list.forEach(([, t], k) => {
          const H = (v.kind === 'plane' ? 11.5 : 9.5) + t[2] * 1.1 + t.b * 2.0, s = H / v.h;
          im.setMatrixAt(k, m4.compose(vv.set(t[0], -0.01, t[1]), qq.setFromEuler(ee.set(0, t.a * Math.PI * 2, 0)), sc.set(s * (0.92 + t.c * 0.16), s, s * (0.92 + t.c * 0.16))));
          if (tinted) { const b = treeTint(t.c); im.setColorAt(k, cc.setRGB(b, b, b)); }
        });
        im.count = list.length; im.instanceMatrix.needsUpdate = true; if (tinted && im.instanceColor) im.instanceColor.needsUpdate = true;
      });
    });
    S.shadowDirty(); S.loop.kick();
  }

  /* ---- cars (cars.js pool) */
  let carPool = null, carBusy = null;
  const ensureCars = () => carBusy || (carBusy = import('./cars.js').then((m) => { carMod = m; return m.plantCarPool({ THREE, world: S.world, renderer: S.renderer, cap: o.carCap || 90, radius: o.carR || 85 }); }).then((p) => { carPool = p; for (const u of U.values()) if (u.state === 'ready') addCars(u); return p; }).catch((e) => { console.warn('district cars', e); return null; }));
  let carMod = null;
  function addCars(u) {
    if (!carPool || !carMod || !u.doc || !u.doc.cars || u.doc.skipNear || !u.meta.inner) return;
    const d = u.doc, hash = [...d.id].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7);
    u.cars = carMod.layoutKerb(d.cars, d.hydrants || [], d.shelters || [], hash); carPool.setUnit(u.id, u.cars);
  }

  /* ---- unit lifecycle */
  const dBox = (b, p) => { const dx = Math.max(b[0] - p.x, 0, p.x - b[2]), dz = Math.max(b[1] - p.z, 0, p.z - b[3]); const fx = Math.max(Math.abs(p.x - b[0]), Math.abs(p.x - b[2])), fz = Math.max(Math.abs(p.z - b[1]), Math.abs(p.z - b[3])); return [Math.hypot(dx, dz), Math.hypot(fx, fz)]; };
  async function load(u) {
    u.state = 'loading'; u.t0 = performance.now(); inflight++; stats.requested++;
    try {
      u.doc = await fetch(new URL(u.id + '.json', base)).then((r) => r.json());
      u.gN = new THREE.Group(); u.gM = new THREE.Group(); u.gN.visible = false; u.gM.visible = false; S.world.add(u.gN, u.gM);
      // fade.js: a near-capable unit owns a uT value (its near AND mid clones follow it: the near keeps ign < uT, the mid the rest). A mid-only unit is always solid (FADE.zero).
      // The user's own W 123rd faces (skipNear) keep the shared legacy distance dither: their neighbour is the slice-2 base street, built outside any unit.
      u.cap = !!(u.meta.inner && !u.meta.skipNear); u.wantN = false; u.tObj = u.cap ? { value: 0 } : null;
      if (u.cap) u.gN.userData.fade = u.tObj;
      if (u.cap) u.gM.userData.fade = u.meta.kind === 'P' ? F.zero : u.tObj; else if (!u.meta.skipNear) u.gM.userData.fade = F.zero;
      S.worker.postMessage({ t: 'unit', unit: u.doc, ver });
    } catch (e) { console.warn('district load', u.id, e); u.state = 'idle'; inflight = Math.max(0, inflight - 1); }
  }
  function ready(u) {
    if (u.state !== 'loading') return;
    u.state = 'ready'; inflight = Math.max(0, inflight - 1); u.readyAt = performance.now(); stats.ready++;
    if (u.cached) { stats.cached++; stats.cachedMs += u.workerMs || 0; stats.cachedMsList.push(u.workerMs || 0); } else { stats.built++; stats.workerMs += u.workerMs || 0; stats.builtMs.push(u.workerMs || 0); }
    // trees get their variant + jitter once; the pool picks them up on the next update
    u.trees = ((u.col && u.col.trees) || []).map((t) => { const r = (n) => { let h = (Math.imul(Math.round(t[0] * 100) + 7919 * n, 2654435761) ^ Math.imul(Math.round(t[1] * 100), 40503)) >>> 0; return (h % 10007) / 10007; }; const o2 = [t[0], t[1], t[2]]; o2.v = r(1) < 0.62 ? Math.floor(r(2) * 3) : 3 + Math.floor(r(3) * 2); o2.a = r(4); o2.b = r(5); o2.c = r(6); return o2; });
    if (u.trees.length) ensureTrees().then(() => updateTrees(true));
    if (carPool) addCars(u); else ensureCars();
    const [dmin] = dBox(u.bbox, camP); if (preloaded && dmin < ON_D && u.cap) { stats.late++; u.late = Math.round(dmin); }
    rev++; S.shadowDirty(); S.loop.kick(); applyVis(u); if (o.onUnit) o.onUnit(u);
  }
  function unload(u) {
    u.dead = true; ramping.delete(u); if (u.gN) { S.world.remove(u.gN); S.world.remove(u.gM); } if (u.tObj) S.fadeKit.disposeUnit(u.tObj);
    for (const ob of u.objs) { if (ob.geometry) { for (const k in ob.geometry.attributes) { const a = ob.geometry.attributes[k]; if (a && a.array && a.dispose) void a; } ob.geometry.dispose(); } if (ob.dispose) ob.dispose(); }
    if (carPool) carPool.dropUnit(u.id);
    u.objs = []; u.gN = u.gM = null; u.state = 'idle'; u.done = false; u.pending = 0; u.col = null; u.cars = null; u.trees = []; u.showN = u.showM = false; u.tObj = null; u.wantN = false; u.ramp = null; u.fresh = undefined; u.showMidWanted = undefined; stats.unloaded++; rev++; U.set(u.id, { ...u, dead: false });
  }
  /* ---- the tier state per unit: wantN (with hysteresis) -> a 1 s ramp of uT -> solid. Group visibility only flips where the group's share is 0. */
  const ramping = new Set(); let rafId = 0;
  const log = (u, tier, on, dmin, dmax) => tierLog.push({ t: +(performance.now() / 1000).toFixed(2), id: u.id, tier, on, dmin: Math.round(dmin), dmax: Math.round(dmax), cam: [Math.round(camP.x), Math.round(camP.z)] });
  function setVis(u) {                                                       // from the unit's current uT (and the mid range)
    const tv = u.cap ? u.tObj.value : 0, isP = u.meta.kind === 'P';
    const n = u.cap && (tv > 0 || u.wantN), m = u.mid && (!u.cap || isP || tv < 1);
    if (n !== u.showN) { u.showN = n; u.gN.visible = n; S.shadowDirty(); }
    if (m !== u.showM) { u.showM = m; u.gM.visible = m; }
  }
  function rampTick() {
    rafId = 0; const now = performance.now();
    for (const u of ramping) {
      const k = Math.min(1, (now - u.ramp.t0) / RAMP_MS); u.tObj.value = u.ramp.from + (u.ramp.to - u.ramp.from) * k;
      if (k >= 1) { u.tObj.value = u.ramp.to; u.ramp = null; ramping.delete(u); S.shadowDirty(); }
      setVis(u);
    }
    S.loop.kick(); if (ramping.size) rafId = requestAnimationFrame(rampTick);
  }
  function startRamp(u, to, instant) {
    if (instant) { u.tObj.value = to; u.ramp = null; ramping.delete(u); return; }
    u.ramp = { t0: performance.now(), from: u.tObj.value, to }; ramping.add(u); if (!rafId) rafId = requestAnimationFrame(rampTick);
  }
  function applyVis(u, dm) {
    if (u.state !== 'ready') return;
    const [dmin, dmax] = dm || dBox(u.bbox, camP);
    u.mid = dmin < MID_END;
    if (u.mid !== u.showMidWanted) { u.showMidWanted = u.mid; log(u, 'mid', u.mid, dmin, dmax); }
    if (u.cap) {
      const want = u.wantN ? dmin < OFF_D : dmin < ON_D;
      if (want !== u.wantN || u.fresh === undefined) {
        const first = u.fresh === undefined; u.fresh = false; u.wantN = want;
        if (!first || want) log(u, 'near', want, dmin, dmax);
        startRamp(u, want ? 1 : 0, !preloaded || (first && !want));            // the street-opening preload: no ramp; a unit that starts far: solid mid at once
      }
    }
    setVis(u);
  }
  function update(p, force) {
    camP.copy(p); const now = performance.now();
    if (!force && now - lastUpd < 120) return; lastUpd = now; tick++;
    const want = [];
    for (const u of U.values()) { const [dmin, dmax] = dBox(u.bbox, p); u.dmin = dmin; u.dmax = dmax;
      if (u.state === 'idle' && dmin < LOAD_R) want.push(u);
      else if (u.state === 'ready') { applyVis(u, [dmin, dmax]); if (dmin > UNLOAD_R) unload(U.get(u.id)); } }
    want.sort((a, b) => a.dmin - b.dmin);
    for (const u of want) { if (inflight >= (o.inflight || 2)) break; load(u); }
    if (carPool) carPool.update(S.camera, false);
    updateTrees(false);
  }

  /* ---- the walker's colliders around (x, z) */
  const carsNear = (x, z, R) => (carPool ? carPool.near(x, z, R) : []);
  let colCache = { key: '', v: null };
  function collidersNear(x, z, R = 60) {
    const key = `${rev}|${Math.round(x / 8)}|${Math.round(z / 8)}`; if (colCache.key === key) return colCache.v;
    const obbs = [], circles = [], vols = [], cyls = [], edge = (a, b, half, h, name, kind) => {
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez); if (L < 0.05) return; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; if (Math.abs(mx - x) > R + L / 2 || Math.abs(mz - z) > R + L / 2) return;
      obbs.push({ n: name, x: mx, z: mz, hw: L / 2 + half, hd: half, ry: Math.atan2(-ez, ex) });
      if (h) vols.push({ name, kind: kind || 'wall', b: [Math.min(a[0], b[0]) - half, 0, Math.min(a[1], b[1]) - half, Math.max(a[0], b[0]) + half, h, Math.max(a[1], b[1]) + half] });
    };
    for (const u of U.values()) {
      if (u.state !== 'ready' || !u.col) continue; const b = u.bbox; if (x < b[0] - R || x > b[2] + R || z < b[1] - R || z > b[3] + R) continue;
      for (const w of u.col.walls) { const pts = w.pts; for (let i = 0; i < pts.length; i++) edge(pts[i], pts[(i + 1) % pts.length], 0.2, w.h, 'bldg ' + w.bin); }
      for (const f of u.col.fence) edge([f[0], f[1]], [f[2], f[3]], 0.05, 1.0, 'fence', 'fence');
      for (const q of u.col.boxes) { const hw = (q.x1 - q.x0) / 2, hd = (q.z1 - q.z0) / 2, cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2; if (Math.abs(cx - x) > R || Math.abs(cz - z) > R) continue; obbs.push({ n: 'box', x: cx, z: cz, hw, hd, ry: 0 }); vols.push({ name: 'box', kind: 'wall', b: [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1] }); }
      for (const c of u.col.circles) {
        if (Math.abs(c[0] - x) > R || Math.abs(c[1] - z) > R) continue; circles.push({ n: 'prop', x: c[0], z: c[1], r: c[2] });
        if (c[2] > 0.3) { cyls.push([c[0], c[1], 0.2, 6]); vols.push({ name: 'canopy', kind: 'wall', b: [c[0] - 2.2, 3.5, c[1] - 2.2, c[0] + 2.2, 11, c[1] + 2.2] }); }
        else if (c[2] > 0.2) vols.push({ name: 'hydrant', kind: 'wall', b: [c[0] - c[2], 0, c[1] - c[2], c[0] + c[2], 0.8, c[1] + c[2]] });
        else cyls.push([c[0], c[1], 0.14, 8]);
      }
    }
    for (const c of carsNear(x, z, R)) { obbs.push({ n: 'car', x: c.x, z: c.z, hw: c.hx, hd: c.hz, ry: 0 }); vols.push({ name: 'car', kind: 'wall', b: [c.x - c.hx, 0, c.z - c.hz, c.x + c.hx, 1.46, c.z + c.hz] }); }
    colCache = { key, v: { obbs, circles, vols, cyls, rev } }; return colCache.v;
  }

  const api = {
    S, index, U, update, groundAt, bounds, collidersNear, tierLog, stats, streets, aves, get rev() { return rev; }, get inflight() { return inflight; }, get carPool() { return carPool; },
    ensureCars, ensureTrees, updateTrees,
    /** load every unit within `r` of (x, z) and wait for them (behind the street-opening fade) */
    async preload(x, z, r = 130) {
      camP.set(x, 1.6, z); update(camP, true);
      const t0 = performance.now();
      await new Promise((res) => { const chk = () => { camP.set(x, 1.6, z); update(camP, true); const pend = [...U.values()].filter((u) => u.state === 'loading' || (u.state === 'idle' && dBox(u.bbox, camP)[0] < r)); if (!pend.length && !queue.length) res(); else if (performance.now() - t0 > 30000) res(); else setTimeout(chk, 60); }; chk(); });
      await Promise.all([ensureTrees(), ensureCars()]); updateTrees(true); if (carPool) carPool.update(S.camera, true);
      stats.preloadMs = Math.round(performance.now() - t0); preloaded = true; tierLog.length = 0;
    },
    info() { const ready = [...U.values()].filter((u) => u.state === 'ready'); return { units: U.size, ready: ready.length, near: ready.filter((u) => u.showN).length, mid: ready.filter((u) => u.showM).length, inflight, queue: queue.length, rev, ...stats, cars: carPool ? carPool.stat : null, tierEvents: tierLog.length }; },
    dispose() { for (const u of U.values()) if (u.state === 'ready') unload(u); },
  };
  S.district = api; return api;
}
