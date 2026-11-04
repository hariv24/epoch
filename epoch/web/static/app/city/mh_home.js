// city/mh_home.js · the user's year of lots: one real Manhattan tax lot for every day since Day 1 (home.json v2: weeks[row].slots[], a row of 7 touching
// lots per Monday-to-Sunday week, walking order from Low Library through Morningside Heights and on into the northern Upper West Side).
// The real buildings of those lots are not in the city tiles any more, so every slot is a levelled pad that stays where it is:
//   a day with study   -> the day tower (tower_model.js, towers.js as the fallback, + shader.js: storeys by deep minutes, lit doors at the floor, the crown
//                         at the target, a beacon per shipped output), permanent, scaled to the real lot and turned to face its street;
//   a rest day         -> a pocket park;
//   a day without study-> an empty lot that stays empty: gravel, a low plywood hoarding and a survey stake (calm, no shame);
//   today              -> the lot with its site, a bright ring and a soft marker (construction state as before);
//   economy            -> setUpgrades(ids) puts the shop's tower upgrades on every study tower; a three-star day (days[].gold or setGold(dates))
//                         gets a permanent gold crown, a steady gold light and a soft light beam (one instanced draw for all the beams);
//   days to come       -> quiet pads with survey stakes.
// This week's row is outlined. All pads, hoardings and stakes are one merged mesh (rebuilt only when a lot changes state); towers are one mesh each, culled
// by the camera frustum and, with a camera given, hidden beyond ~9 km; the per-frame work only visits lots that have a day.
//   slot -> lot: slot n (days since Day 1) is the n-th slot of home.json in order (the payload's `slot.n`; else the date minus home.dayOne).
//   slot index handed to the app: city mode = the index in the days array; framed stages (onlyDays) = the weekday of this week's row (0 = Monday).
import * as THREE from 'three';
import { clamp, smooth, hash01, Geo, rgb, KIND } from './util.js';
import { createCityMaterial, makeShared, FLOOR_H } from './shader.js';
import { buildBuilding, buildSite, pickStyle, STYLE, LOT_W, LOT_D } from './towers.js';
import { tryDayTower } from './tower_model.js';
import { MS, hdr } from './palette.js';

const MAXF = 16;
const ring2 = (f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; };
const FAR_CITY = 9000, FAR_STAGE = 1600, NEAR_STAGE = 1300;     // towers further than this from the camera are not drawn (a few pixels at most; the framed stages only ever look at one block)

// pad colours (linear working space)
const PAD = {
  future: { top: rgb('#a8b1c3'), edge: rgb('#7b8599') },
  empty: { top: rgb('#a08f74'), edge: rgb('#76694f') },
  tower: { top: rgb('#8d8b86'), edge: rgb('#6b6965') },
  site: { top: rgb('#a89c90'), edge: rgb('#7d746b') },
  rest: { top: rgb('#4f8661'), edge: rgb('#3b6a4c') },
};
const HOARD = rgb('#c2a36c'), HOARD_TOP = rgb('#e2cfa4'), POST = rgb('#6d5a3e'), STAKE = rgb('#efe6cf'), FLAG = rgb('#ff8a3a');

/** slot data of the week row that holds the client's today (clamped to the year), or the nearest row */
function currentRowSlots(home) {
  const rows = home.weeks || [], dayOneN = Math.floor(Date.parse((home.dayOne || '2026-10-18') + 'T00:00:00Z') / 864e5);
  const n = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5) - dayOneN;
  const flat = []; for (const w of rows) for (const s of w.slots) flat.push([w.row, s]);
  if (!flat.length) return [];
  const row = flat[clamp(n, 0, flat.length - 1)][0];
  return (rows.find((w) => w.row === row) || rows[0]).slots;
}
/** where to look at a row of lots from: its middle, a distance that fits it, and the street side it faces (theta for three's spherical coordinates) */
function viewOfSlots(sl) {
  if (!sl.length) return { t: [0, 0], r: 320, theta: 0 };
  let cx = 0, cz = 0, fx = 0, fz = 0; for (const s of sl) { cx += s.x; cz += s.z; fx += s.front[0]; fz += s.front[1]; } cx /= sl.length; cz /= sl.length;
  let ext = 40; for (const s of sl) ext = Math.max(ext, Math.hypot(s.x - cx, s.z - cz) * 2 + 24);
  return { t: [cx, cz], r: clamp(ext * 1.55, 240, 520), theta: Math.atan2(fx, fz) + 0.4 };
}
export const homeWeekView = (home) => viewOfSlots(currentRowSlots(home));

export function createHome({ scene, home, streets, TR, homeMeshes, wake, motion: motion0, onlyDays = false, camera = null }) {
  const shared = makeShared();
  let motion = motion0;
  const rel = onlyDays, FAR = onlyDays ? FAR_STAGE : FAR_CITY;
  const grp = new THREE.Group(); grp.name = 'home'; scene.add(grp);
  // the real buildings these lots replaced are not part of the world any more
  if (homeMeshes) for (const m of homeMeshes.values()) m.visible = false;

  const rows = home.weeks || [];
  const dayOneN = Math.floor(Date.parse((home.dayOne || '2026-10-18') + 'T00:00:00Z') / 864e5);
  const slots = []; for (const w of rows) for (const s of w.slots) slots.push({ ...s, week: w.row });
  const NS = slots.length;

  /* ---- lot frames: each slot in its own scaled, turned frame (x = along the street, z = toward the street) */
  const lots = [];
  for (let k = 0; k < NS; k++) {
    const L = slots[k], fp = ring2(L.footprint);
    let cx = 0, cz = 0; for (const [x, z] of fp) { cx += x; cz += z; } cx /= fp.length; cz /= fp.length;
    const fx = L.front[0], fz = L.front[1];
    const th = Math.atan2(fx, fz), rx = Math.cos(th), rz = -Math.sin(th);           // local +x in world
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of fp) { const a = (x - cx) * rx + (z - cz) * rz, b = (x - cx) * fx + (z - cz) * fz; x0 = Math.min(x0, a); x1 = Math.max(x1, a); z0 = Math.min(z0, b); z1 = Math.max(z1, b); }
    const W = x1 - x0, Dd = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const ox = cx + rx * mx + fx * mz, oz = cz + rz * mx + fz * mz;
    // the pad: level with the mean ground under the footprint
    // (on a slope the pad is level with the highest ground under the footprint, so the terrain never pokes through; its skirt reaches the lowest)
    let gmax = -1e9, gmin = 1e9;
    const probe = (x, z) => { const h = TR.ground(x, z); gmax = Math.max(gmax, h); gmin = Math.min(gmin, h); };
    for (const [x, z] of fp) { probe(x, z); probe((x + cx) / 2, (z + cz) / 2); }
    probe(cx, cz);
    const padY = gmax + 0.15, padBottom = Math.min(gmin - 0.6, padY - 0.7);
    const sh = Math.max(3.2, Math.min(W / LOT_W, Dd / LOT_D) * 0.97), sv = clamp(sh, 8.6, 10.6);
    const g = new THREE.Group(); g.position.set(ox, padY, oz); g.rotation.y = th; g.scale.set(sh, sv, sh); g.updateMatrixWorld(true); grp.add(g);
    const hw = W / 2, hd = Dd / 2;
    lots.push({ k, n: L.n, row: L.week, wd: L.wd, L, fp, g, sh, sv, th, x: ox, z: oz, fx, fz, rx, rz, hw, hd, padY, padBottom, cx, cz,
      kind: 'future', slot: -1, hasDay: false, mesh: null, mat: null, U: null, geo: null, sig: '', F: 0, style: 'prewar', day: null, padStyle: 'future',
      gT: 1, g0: 1, gv: 0, topY: 0, height: 0, flashStart: -1, bodyFlash: 0, doorLevel: 0, doorFlash: 0, crownLevel: 0, crownFlash: 0, doors: false, crown: false, isToday: false,
      beacons: [], bBorn: [], slots: [], aviation: null, doorX: 0, lamps: [], lampBorn: [], siteLamps: [], fog: 0, w: 1.46, d: 1.5, target: 6, crownY: 0, real: null, gr: 1 });
  }

  /* ---- this week's row */
  const slotLots = [];                                    // the lots of this week's row (a stable array: the seasonal props and the camera frames read it)
  const centre = [0, 0];
  let curRow = -1;
  const todayN0 = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5) - dayOneN;
  function setRow(row) {
    if (row === curRow) return false;
    curRow = row;
    slotLots.length = 0; for (const l of lots) if (l.row === row) slotLots.push(l);
    if (!slotLots.length) return true;
    centre[0] = slotLots.reduce((a, l) => a + l.x, 0) / slotLots.length; centre[1] = slotLots.reduce((a, l) => a + l.z, 0) / slotLots.length;
    return true;
  }
  setRow(lots.length ? lots[clamp(todayN0, 0, NS - 1)].row : 0);

  /* ---- outlines (rings) made from the real footprints */
  function ringParts(fp, inset, wd, y) {
    let cx = 0, cz = 0; for (const [x, z] of fp) { cx += x; cz += z; } cx /= fp.length; cz /= fp.length;
    const pos = [], idx = [], n = fp.length;
    for (let i = 0; i < n; i++) {
      const [x, z] = fp[i], dx = cx - x, dz = cz - z, L = Math.hypot(dx, dz) || 1, a = Math.min(inset, L * 0.4), b = Math.min(inset + wd, L * 0.7);
      pos.push(x + dx / L * a, y, z + dz / L * a, x + dx / L * b, y, z + dz / L * b);
    }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * i, 2 * j, 2 * j + 1, 2 * i, 2 * j + 1, 2 * i + 1); }
    return { pos, idx };
  }
  function outlineGeo(list, inset, wd, dy) {
    const pos = [], idx = [];
    for (const l of list) { const p = ringParts(l.fp, inset, wd, l.padY + dy), o = pos.length / 3; for (const v of p.pos) pos.push(v); for (const i of p.idx) idx.push(i + o); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  }
  const ringMatToday = new THREE.MeshBasicMaterial({ color: hdr(MS.accent, 2.6), toneMapped: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const ringMatPick = new THREE.MeshBasicMaterial({ color: hdr(MS.limestone, 1.8), toneMapped: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const ringMatWeek = new THREE.MeshBasicMaterial({ color: hdr(MS.accent, onlyDays ? 1.5 : 1.0), toneMapped: false, transparent: true, opacity: onlyDays ? 0.8 : 0.5, side: THREE.DoubleSide, depthWrite: false });
  const ringToday = new THREE.Mesh(new THREE.BufferGeometry(), ringMatToday), ringPick = new THREE.Mesh(new THREE.BufferGeometry(), ringMatPick), ringWeek = new THREE.Mesh(new THREE.BufferGeometry(), ringMatWeek);
  ringToday.renderOrder = 4; ringPick.renderOrder = 4; ringWeek.renderOrder = 3;
  for (const m of [ringToday, ringPick, ringWeek]) { m.frustumCulled = false; m.visible = false; grp.add(m); }
  let pickedLot = null, ringsHidden = false;
  function drawRings() {
    if (ringWeek.geometry) ringWeek.geometry.dispose();
    ringWeek.geometry = outlineGeo(slotLots, 0.1, onlyDays ? 1.5 : 0.8, 0.12); ringWeek.visible = !ringsHidden && slotLots.length > 0;
    const t = todayLot();
    ringToday.geometry.dispose(); ringToday.geometry = t ? outlineGeo([t], 0.2, 1.4, 0.2) : new THREE.BufferGeometry(); ringToday.visible = !ringsHidden && !!t;
    ringPick.geometry.dispose(); ringPick.geometry = pickedLot ? outlineGeo([pickedLot], 1.8, 1.1, 0.25) : new THREE.BufferGeometry(); ringPick.visible = !ringsHidden && !!pickedLot;
  }

  /* ---- the merged pads: slab, skirt, hoarding, stakes for every slot, one mesh (colours depend on each lot's state) */
  const { mat: padMat } = createCityMaterial(shared, { ao: 0 });
  const padMesh = new THREE.Mesh(new THREE.BufferGeometry(), padMat); padMesh.frustumCulled = false; padMesh.name = 'pads'; grp.add(padMesh);
  const v2 = (p) => new THREE.Vector2(p[0], p[1]);
  const inRing = (x, z, r) => { let c = false; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  function addPad(G, lot, style) {
    const P = PAD[style] || PAD.future, y = lot.padY, fp = lot.fp, vary = 0.94 + 0.1 * hash01(lot.k * 31 + 7);
    const top = [P.top[0] * vary, P.top[1] * vary, P.top[2] * vary], edge = P.edge;
    // slab top (the footprint, triangulated)
    const tris = THREE.ShapeUtils.triangulateShape(fp.map(v2), []);
    for (const t of tris) {
      const a = [fp[t[0]][0], y, fp[t[0]][1]], b = [fp[t[1]][0], y, fp[t[1]][1]], c = [fp[t[2]][0], y, fp[t[2]][1]];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      if (ny > 0) G.tri(a, b, c, top, KIND.plain, 0); else G.tri(a, c, b, top, KIND.plain, 0);
    }
    // skirt (both faces: the footprint's winding is not worth trusting)
    const n = fp.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = fp[i], [bx, bz] = fp[(i + 1) % n], len = Math.hypot(bx - ax, bz - az); if (len < 0.2) continue;
      const yb = lot.padBottom;
      G.quad([ax, yb, az], [bx, yb, bz], [bx, y, bz], [ax, y, az], edge, 0, len, KIND.plain, 0);
      G.quad([bx, yb, bz], [ax, yb, az], [ax, y, az], [bx, y, bz], edge, 0, len, KIND.plain, 0);
    }
    return n;
  }
  function addHoarding(G, lot) {
    const fp = lot.fp, n = fp.length, y = lot.padY, h = 2.2;
    for (let i = 0; i < n; i++) {
      const [ax, az] = fp[i], [bx, bz] = fp[(i + 1) % n], len = Math.hypot(bx - ax, bz - az); if (len < 0.3) continue;
      G.quad([ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az], HOARD, 0, len, KIND.plain, 0);
      G.quad([bx, y, bz], [ax, y, az], [ax, y + h, az], [bx, y + h, bz], HOARD, 0, len, KIND.plain, 0);
      const dx = (bx - ax) / len, dz = (bz - az) / len, t = 0.07;                  // a thin cap along the top
      G.quad([ax - dz * t, y + h, az + dx * t], [bx - dz * t, y + h, bz + dx * t], [bx + dz * t, y + h, bz - dx * t], [ax + dz * t, y + h, az - dx * t], HOARD_TOP, 0, len, KIND.plain, 0);
      G.bar([ax, y, az], [ax, y + h + 0.25, az], 0.16, POST);
    }
  }
  function stakeAt(G, x, z, y, h) {
    G.bar([x, y, z], [x, y + h, z], 0.22, STAKE);
    G.box(x - 0.03, y + h - 0.9, z - 0.03, x + 1.1, y + h - 0.05, z + 0.03, FLAG, { kind: KIND.plain });
  }
  function addStakes(G, lot, style) {
    const sx = lot.hw - 1.3, sz = lot.hd - 1.3, y = lot.padY, spots = style === 'empty' ? [[-sx, sz]] : [[-sx, sz], [sx, sz]];
    for (const [lx, lz] of spots) {
      let x = lot.x + lot.rx * lx + lot.fx * lz, z = lot.z + lot.rz * lx + lot.fz * lz;
      if (!inRing(x, z, lot.fp)) { x = lot.cx; z = lot.cz; }
      stakeAt(G, x, z, y, style === 'empty' ? 3.4 : 2.6);
    }
  }
  let padSig = '';
  function rebuildPads() {
    let sig = ''; for (const l of lots) sig += l.padStyle[0];
    if (sig === padSig) return; padSig = sig;
    const G = new Geo();
    for (const l of lots) {
      const st = l.padStyle;
      addPad(G, l, st);
      if (st === 'empty') { addHoarding(G, l); addStakes(G, l, st); } else if (st === 'future') addStakes(G, l, st);
    }
    padMesh.geometry.dispose(); padMesh.geometry = G.build();
  }

  /* ---- instanced bits that ride on the towers (local lot frame -> world through each lot's matrix) */
  const N = Math.min(NS, 400);
  const mkI = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.count = 0; grp.add(m); return m; };
  const lampPosts = mkI(new THREE.CylinderGeometry(0.012, 0.015, 0.3, 5).translate(0, 0.15, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.dark) }), N * 8);
  const lampHeads = mkI(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: true }), N * 8);
  const bMast = mkI(new THREE.CylinderGeometry(0.012, 0.014, 0.4, 5).translate(0, 0.2, 0), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.steel) }), N * 6);
  const bOrb = mkI(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), N * 6);
  const avi = mkI(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), N + 2);
  // glow sprites for the beacons and today's lot, so they read from a kilometre away too
  const glowG = new THREE.BufferGeometry(), GMAX = N * 7 + 2;
  glowG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GMAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  glowG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GMAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
  glowG.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(GMAX), 1).setUsage(THREE.DynamicDrawUsage));
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: 800 } },
    vertexShader: 'attribute vec3 color; attribute float aSize; uniform float uPx; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z; float s = aSize * uPx / max(d, 1.0); float far = smoothstep(500.0, 2500.0, d); vA = 1.0; vC = color; gl_PointSize = clamp(max(s, mix(0.0, 9.0, far) * step(30.0, aSize)), 0.0, 40.0) + 2.0; }',
    fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vC * a * vA, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const glow = new THREE.Points(glowG, glowMat); glow.frustumCulled = false; glow.renderOrder = 6; grp.add(glow);

  /* blueprint of today's target */
  const blueprint = new THREE.Group(); blueprint.visible = false;
  blueprint.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(MS.accent), transparent: true, opacity: 0.1, depthWrite: false })));
  blueprint.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: new THREE.Color(MS.beacon), transparent: true, opacity: 0.3, depthWrite: false })));

  const dummy = new THREE.Object3D(), tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), beaconTone = new THREE.Color(MS.beacon), tmpV = new THREE.Vector3();
  const toWorld = (lot, x, y, z, s = 1, sy = s) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, sy, s); dummy.updateMatrix(); return tmpM.multiplyMatrices(lot.g.matrixWorld, dummy.matrix); };

  const dateNum = (d) => (typeof d.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(d.date) ? Math.floor(Date.parse(d.date + 'T00:00:00Z') / 864e5) : 20000);
  function setGeometry(lot, built, kind) {
    if (!lot.mesh) { const { mat, U } = createCityMaterial(shared, {}); lot.mat = mat; lot.U = U; lot.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); lot.mesh.frustumCulled = true; lot.g.add(lot.mesh); }
    if (lot.geo) lot.geo.dispose();
    const g = new Geo(); g.append(built.geo);
    lot.geo = g.build(); lot.mesh.geometry = lot.geo; void kind;
  }

  /* ---- economy: tower upgrades on every study tower, gold crowns (and a soft light beam) on three-star days ---- */
  let upgList = [], upgKey = '', goldDays = new Set();
  function setUpgrades(list) {
    const l = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string').slice().sort(), k = l.join(',');
    if (k === upgKey) return false; upgList = l; upgKey = k; if (lastDays) setDays(lastDays, { animate: false }); return true;
  }
  function setGold(days) {
    const s2 = new Set(Array.isArray(days) ? days : []), same = s2.size === goldDays.size && [...s2].every((d) => goldDays.has(d));
    if (same) return false; goldDays = s2; if (lastDays) setDays(lastDays, { animate: false }); return true;
  }
  // the beam: an open cone of soft gold light standing on the crown, brighter after dark, steady (no time term). It widens with the view
  // distance so it still reads as a thin line from across the island, and fades out toward its top.
  const BEAM_H = 170;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
    uniforms: { uGlow: shared.uGlow, uDay: shared.uDay, uCol: { value: hdr('#ffc94d', 1.0) } },
    vertexShader: `varying float vY; varying float vF; varying float vD;
      void main() {
        vec3 p = position;
        vec4 o = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = distance(o.xyz, cameraPosition);
        float wide = clamp(d / 700.0, 1.0, 9.0);
        p.xz *= wide;
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * vec3(position.x, 0.0, position.z));
        vec3 v = normalize(cameraPosition - wp.xyz);
        vF = abs(dot(n, v)); vY = position.y; vD = d;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform float uGlow; uniform float uDay; uniform vec3 uCol; varying float vY; varying float vF; varying float vD;
      void main() {
        float y = clamp(vY, 0.0, 1.0);
        float a = pow(1.0 - y, 1.7) * (0.2 + 0.8 * vF * vF);
        a *= mix(0.05, 0.34, clamp(uGlow, 0.0, 1.0)) * mix(1.0, 0.55, clamp(uDay, 0.0, 1.0));
        a *= smoothstep(0.0, 0.05, y) * mix(0.3, 1.0, smoothstep(80.0, 600.0, vD));     // softer close up, so it never walls off the view
        a = clamp(a, 0.0, 1.0);
        gl_FragColor = vec4(uCol * a, 1.0);
      }`,
  });
  const beamGeo = new THREE.CylinderGeometry(1.6, 2.6, 1, 12, 1, true).translate(0, 0.5, 0).scale(1, 1, 1);
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, Math.min(NS, 400)); beams.frustumCulled = false; beams.count = 0; beams.renderOrder = 5; beams.name = 'gold-beams'; grp.add(beams);
  const beamM = new THREE.Matrix4(), beamS = new THREE.Vector3(1, BEAM_H, 1), beamQ = new THREE.Quaternion(), beamP = new THREE.Vector3();
  function layoutGold() {
    let n = 0;
    for (const lot of live) {
      if (!lot.gold || lot.kind !== 'tower' || !lot.lantern || n >= beams.instanceMatrix.count) continue;
      beamP.set(lot.lantern.x, lot.lantern.y * lot.gr, lot.lantern.z).applyMatrix4(lot.g.matrixWorld);
      beamM.compose(beamP, beamQ, beamS); beams.setMatrixAt(n++, beamM);
    }
    beams.count = n; beams.instanceMatrix.needsUpdate = true; beams.visible = n > 0;
  }

  let slotOf = [];          // slot index handed to the app -> lot
  let live = [];            // the lots that have a day in the payload
  let lastDays = null;
  function setDays(days, { animate = true } = {}) {
    lastDays = days;
    const now = performance.now() / 1000;
    // which lot hosts which day
    const byLot = new Map();
    days.forEach((d, k) => {
      if (!d) return;
      const n = Number.isFinite(d.n) ? d.n : dateNum(d) - dayOneN;
      if (n >= 0 && n < NS && !byLot.has(lots[n])) byLot.set(lots[n], { d, k });
    });
    const ti = days.findIndex((d) => d && d.isToday), todayLotN = ti >= 0 ? (Number.isFinite(days[ti].n) ? days[ti].n : dateNum(days[ti]) - dayOneN) : -1;
    const tl = todayLotN >= 0 && todayLotN < NS ? lots[todayLotN] : null;
    const rowChanged = setRow(tl ? tl.row : curRow);
    slotOf = []; live = [];
    for (const lot of lots) {
      const rec = byLot.get(lot);
      if (!rec) {
        // no record: a day gone by without a payload entry is an empty lot, one still to come is a quiet pad
        lot.hasDay = false; lot.day = null; lot.slot = -1; lot.isToday = false; lot.beacons = []; lot.lamps = []; lot.doors = lot.crown = false;
        const k = todayLotN >= 0 ? (lot.n < todayLotN ? 'empty' : 'future') : 'future';
        if (lot.kind !== k) { lot.kind = k; lot.sig = ''; lot.F = 0; lot.topY = 0; lot.roofY = 0; lot.height = 0; lot.slots = []; lot.aviation = null; lot.roof = null; lot.siteLamps = []; if (lot.mesh) lot.mesh.visible = false; }
        lot.padStyle = k;
        continue;
      }
      const { d, k } = rec, dn = dateNum(d);
      lot.hasDay = true; lot.day = d; live.push(lot);
      lot.slot = rel ? (lot.row === curRow ? lot.wd : -1) : k;
      if (lot.slot >= 0) slotOf[lot.slot] = lot;
      const prevF = lot.kind === 'tower' ? lot.F : 0, prevTop = lot.kind === 'tower' ? lot.topY * lot.gr : 0.06;
      let F = clamp(d.floors | 0, 0, MAXF); if (F === 0 && (d.doors || d.crown)) F = 1;
      const scaffold = !!d.scaffold || d.status === 'repair';
      let kind;
      if (F > 0) kind = rel && Math.hypot(lot.x - centre[0], lot.z - centre[1]) > NEAR_STAGE ? 'far' : 'tower';     // a framed stage only builds the towers near its row (the rest stay pads)
      else if (d.status === 'rest') kind = 'rest';
      else if (d.status === 'future') kind = 'future';
      else if (d.isToday) kind = 'open';
      else if (scaffold && d.status === 'missed') kind = 'missed';
      else kind = 'empty';
      const h = hash01(dn * 977 + 11), style = pickStyle(F, h), target = d.targetFloor || 6;
      const stars = clamp(d.stars | 0, 0, 3), gold = !!(d.gold || (d.date && goldDays.has(d.date)));
      const sig = kind + ':' + F + ':' + style + ':' + target + ':' + scaffold + ':' + dn + ':' + stars + ':' + (gold ? 'g' : '') + ':' + upgKey;
      lot.gold = gold && kind === 'tower';
      lot.isToday = !!d.isToday; lot.doors = !!d.doors; lot.crown = !!d.crown; lot.target = target;
      if (sig !== lot.sig) {
        lot.sig = sig; lot.kind = kind; lot.F = F; lot.style = style;
        if (kind === 'tower') {
          // the Morningside day tower (tower_model.js); the classic per-style builder only if it ever throws
          const nb = tryDayTower({ F, seed: dn, target, scaffold, stars, gold, upgrades: upgList });
          const sp = nb ? nb.look : STYLE[style], w = nb ? nb.w : F >= 9 ? 1.38 : 1.46, dd = nb ? nb.d : style === 'brownstone' ? 1.5 : style === 'bodega' ? 1.15 : style === 'walkup' ? 1.45 : style === 'prewar' ? 1.6 : 1.42 + h * 0.08;
          const b = nb || buildBuilding({ F, w, d: dd, style, seed: dn, target, scaffold });
          lot.lantern = b.lantern || { x: 0, y: b.top, z: 0 };
          lot.roofY = b.roofY ?? b.top; lot.w = w; lot.d = dd; lot.topY = b.top; lot.height = b.top; lot.slots = b.slots; lot.roof = b.roof; lot.aviation = b.aviation; lot.doorX = b.doorX; lot.crownY = b.crownY || 0; lot.siteLamps = [];
          setGeometry(lot, b, 'tower');
          const U = lot.U; U.uPitch.value = sp.pitch; U.uFill.value.set(sp.fill[0], sp.fill[1]); U.uGlass.value = sp.glass; U.uLitP.value = sp.litP * (nb ? 1 : 0.92 + 0.14 * hash01(dn + 5)); U.uSeed.value = (dn % 997) * 1.37; U.uAO.value = 0.34;
          if (animate && motion) {
            lot.gT = 1; lot.gr = clamp(prevTop / Math.max(b.top, 0.2), 0.03, 1); lot.gv = 0;
            if (F > prevF) { lot.flashStart = now + 0.08; U.uFlashF0.value = prevF; lot.bodyFlash = 1; }
          } else { lot.gr = 1; lot.gv = 0; U.uFlashT.value = -1; }
        } else if (kind === 'future' || kind === 'empty' || kind === 'far') {
          if (lot.mesh) lot.mesh.visible = false;
          lot.topY = 0; lot.roofY = 0; lot.height = 0; lot.slots = []; lot.aviation = null; lot.roof = null; lot.siteLamps = [];
        } else {
          const b = buildSite({ kind, seed: dn });
          lot.w = 1.4; lot.d = 1.7; lot.topY = 0.3; lot.roofY = 0.3; lot.height = 0.3; lot.slots = []; lot.roof = null; lot.aviation = null; lot.siteLamps = b.lamps || [];
          setGeometry(lot, b, kind);
          lot.U.uSeed.value = (dn % 997) * 1.37; lot.gr = 1; lot.gv = 0; lot.U.uFlashT.value = -1;
        }
      }
      lot.padStyle = kind === 'tower' || kind === 'far' ? 'tower' : kind === 'rest' ? 'rest' : kind === 'open' || kind === 'missed' ? 'site' : kind;
      if (lot.mesh) lot.mesh.visible = kind === 'tower' || kind === 'rest' || kind === 'open' || kind === 'missed';
      if (lot.U) lot.U.uGrow.value = lot.gr;
      if (lot.doors && !lot.doorWas && animate && motion) lot.doorFlash = 1;
      if (lot.crown && !lot.crownWas && animate && motion) lot.crownFlash = 1;
      lot.doorWas = lot.doors; lot.crownWas = lot.crown;
      if (!animate || !motion) { lot.doorLevel = lot.doors ? 1 : 0; lot.crownLevel = lot.crown ? 1 : 0; }
      const want = d.beacons || [];
      for (let j = lot.beacons.length; j < want.length; j++) lot.bBorn[j] = animate && motion ? now : -9;
      lot.beacons = want.slice(0, 6);
      const had = lot.lamps.length; lot.lamps = (d.lamps || []).slice(0, 8);
      for (let j = had; j < lot.lamps.length; j++) lot.lampBorn[j] = animate && motion ? now : -9;
      lot.fog = d.fog | 0;
    }
    if (pickedLot && (!pickedLot.hasDay || pickedLot.slot < 0)) pickedLot = null;
    rebuildPads(); drawRings(); void rowChanged;
    placeBlueprint(); layoutLamps(); layoutBeacons(now); updateAvi(0); layoutGold();
    wake();
  }
  function todayLot() { for (const l of live) if (l.isToday) return l; return null; }

  function layoutLamps() {
    let n = 0; const now = performance.now() / 1000;
    for (const lot of live) {
      if (lot.kind === 'future' || lot.kind === 'empty' || lot.kind === 'far' || !lot.lamps.length) continue;
      lot.lamps.forEach((hex, j) => {
        const age = clamp((now - lot.lampBorn[j]) / 0.45, 0, 1), s = Math.max(0.001, age >= 1 ? 1 : (1 + 0.5 * Math.sin(age * Math.PI)) * smooth(age));
        const x = (j - (lot.lamps.length - 1) / 2) * 0.17, z = LOT_D / 2 + 0.07;
        lampPosts.setMatrixAt(n, toWorld(lot, x, 0, z, s));
        lampHeads.setMatrixAt(n, toWorld(lot, x, 0.33 * s, z, s)); lampHeads.setColorAt(n, tmpC.set(hex).multiplyScalar(1.8));
        n++;
      });
    }
    lampPosts.count = lampHeads.count = n; lampPosts.instanceMatrix.needsUpdate = lampHeads.instanceMatrix.needsUpdate = true; if (lampHeads.instanceColor) lampHeads.instanceColor.needsUpdate = true;
  }
  function layoutBeacons(now) {
    let n = 0, moving = false, gi = 0;
    const gp = glowG.attributes.position.array, gc = glowG.attributes.color.array, gs = glowG.attributes.aSize.array;
    for (const lot of live) {
      if (lot.kind !== 'tower' || !lot.beacons.length) continue;
      lot.beacons.forEach((hex, j) => {
        if (n >= N * 6 || gi >= GMAX - 2) return;
        const sl = lot.slots[j % lot.slots.length] || { x: 0, y: lot.topY, z: 0 };
        const age = lot.bBorn[j] > 0 ? (now - lot.bBorn[j]) / 0.7 : 1;
        let s = age >= 1 ? 1 : smooth(clamp(age, 0, 1)) * (1 + 0.25 * Math.sin(clamp(age, 0, 1) * Math.PI)); if (age < 1) moving = true;
        s = Math.max(s, 0.001);
        const y = sl.y * lot.gr;
        bMast.setMatrixAt(n, toWorld(lot, sl.x, y, sl.z, 1, s));
        const pulse = motion ? 1 + 0.18 * Math.sin(now * 3 + j * 1.7) : 1;
        bOrb.setMatrixAt(n, toWorld(lot, sl.x, y + 0.42 * s, sl.z, s * pulse)); bOrb.setColorAt(n, tmpC.set(hex).lerp(beaconTone, 0.15).multiplyScalar(2.0));
        tmpV.set(sl.x, y + 0.42 * s, sl.z).applyMatrix4(lot.g.matrixWorld);
        gp[3 * gi] = tmpV.x; gp[3 * gi + 1] = tmpV.y; gp[3 * gi + 2] = tmpV.z; tmpC.set(hex).multiplyScalar(1.4 * s); gc[3 * gi] = tmpC.r; gc[3 * gi + 1] = tmpC.g; gc[3 * gi + 2] = tmpC.b; gs[gi] = 7; gi++;
        n++;
      });
    }
    // a steady gold light on each three-star crown (with the beam, it finds the gold days from across the island at night)
    for (const lot of live) {
      if (!lot.gold || lot.kind !== 'tower' || !lot.lantern || gi >= GMAX - 2) continue;
      tmpV.set(lot.lantern.x, lot.lantern.y * lot.gr + 0.04, lot.lantern.z).applyMatrix4(lot.g.matrixWorld);
      gp[3 * gi] = tmpV.x; gp[3 * gi + 1] = tmpV.y; gp[3 * gi + 2] = tmpV.z; tmpC.set('#ffc94d').multiplyScalar(0.9); gc[3 * gi] = tmpC.r; gc[3 * gi + 1] = tmpC.g; gc[3 * gi + 2] = tmpC.b; gs[gi] = 30; gi++;
    }
    // a soft Columbia-blue marker over today's lot (finds the block from the whole island)
    const t = todayLot();
    if (t) {
      tmpV.set(0, Math.max(t.topY * t.gr, 0.3) + 0.9, 0).applyMatrix4(t.g.matrixWorld);
      gp[3 * gi] = tmpV.x; gp[3 * gi + 1] = tmpV.y; gp[3 * gi + 2] = tmpV.z; tmpC.set(MS.accent).multiplyScalar(1.3); gc[3 * gi] = tmpC.r; gc[3 * gi + 1] = tmpC.g; gc[3 * gi + 2] = tmpC.b; gs[gi] = 32; gi++;
    }
    glowG.setDrawRange(0, gi); glowG.attributes.position.needsUpdate = glowG.attributes.color.needsUpdate = glowG.attributes.aSize.needsUpdate = true;
    bMast.count = bOrb.count = n; bMast.instanceMatrix.needsUpdate = bOrb.instanceMatrix.needsUpdate = true; if (bOrb.instanceColor) bOrb.instanceColor.needsUpdate = true;
    return moving;
  }
  function updateAvi(t) {
    let n = 0;
    for (const lot of live) if (lot.kind === 'tower' && lot.aviation && n < N + 2) {
      const a = lot.aviation; avi.setMatrixAt(n, toWorld(lot, a.x, a.y * lot.gr, a.z, 1));
      const on = !motion ? 1 : (Math.sin(t * 2.4 + n * 1.3) > 0.45 ? 1 : 0.12); avi.setColorAt(n, tmpC.setRGB(1.9 * on, 0.18 * on, 0.16 * on)); n++;
    }
    avi.count = n; avi.instanceMatrix.needsUpdate = true; if (avi.instanceColor) avi.instanceColor.needsUpdate = true;
  }
  function placeBlueprint() {
    const t = todayLot();
    if (blueprint.parent) blueprint.parent.remove(blueprint);
    const ry = t ? (t.roofY ?? t.topY) : 0;
    if (t && t.kind === 'tower' && !t.crown && t.F >= 1 && t.target * FLOOR_H > ry * t.gr + 0.1) {
      const y0 = ry * t.gr, y1 = t.target * FLOOR_H;
      t.g.add(blueprint); blueprint.visible = true; blueprint.position.set(0, y0, LOT_D / 2 - t.d / 2); blueprint.scale.set(t.w * 0.9, y1 - y0, t.d * 0.9);
    } else blueprint.visible = false;
  }

  /* crane: a comeback day lifts the first floor into place */
  let crane = null;
  function craneAt(i) {
    const lot = slotOf[i]; if (!lot) return;
    if (crane) crane.lot.g.remove(crane.g);
    const yel = rgb(MS.accent), grey = rgb(MS.slate), mg = new Geo();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mg.bar([sx * 0.06, 0, sz * 0.06], [sx * 0.06, 2.6, sz * 0.06], 0.03, yel);
    for (let y = 0; y < 2.5; y += 0.25) { mg.bar([-0.06, y, 0.06], [0.06, y + 0.25, 0.06], 0.014, yel); mg.bar([0.06, y, -0.06], [-0.06, y + 0.25, -0.06], 0.014, yel); }
    const jg = new Geo();
    jg.bar([-0.8, 0, 0], [1.6, 0, 0], 0.05, yel); jg.bar([-0.8, 0.12, 0], [1.6, 0.0, 0], 0.016, yel); jg.box(-0.95, -0.1, -0.1, -0.6, 0.15, 0.1, grey);
    const { mat } = createCityMaterial(shared, { ao: 0 });
    const g = new THREE.Group(), jibG = new THREE.Group();
    jibG.position.y = 2.62; jibG.add(new THREE.Mesh(jg.build(), mat));
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(MS.beacon) })); cable.position.set(1.3, -0.5, 0);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), new THREE.MeshLambertMaterial({ color: new THREE.Color(MS.limestone) })); blk.position.set(1.3, -1.1, 0);
    jibG.add(cable, blk); g.add(new THREE.Mesh(mg.build(), mat), jibG); g.position.set(0.55, 0, -0.1); lot.g.add(g);
    crane = { g, jibG, cable, blk, lot, t0: performance.now() / 1000 }; wake();
  }
  function stepCrane(now) {
    if (!crane) return false;
    const t = now - crane.t0;
    crane.jibG.rotation.y = -Math.PI * 0.5 * (1 - smooth(clamp(t / 0.9, 0, 1)));
    const drop = smooth(clamp((t - 0.9) / 0.7, 0, 1)) * (1 - smooth(clamp((t - 1.8) / 0.7, 0, 1)));
    const len = 0.5 + 1.0 * drop; crane.cable.scale.y = len; crane.cable.position.y = -len / 2; crane.blk.position.y = -len - 0.1;
    crane.g.scale.setScalar(clamp(t / 0.3, 0, 1) * (1 - smooth(clamp((t - 2.3) / 0.3, 0, 1))) + 0.001);
    if (t > 2.65 || !motion) { crane.lot.g.remove(crane.g); crane = null; return false; }
    return true;
  }

  /* far towers are not drawn: a few pixels at the most, and a year of towers adds up */
  let frame = 0;
  function cull() {
    if (!camera) return;
    const cp = camera.position;
    for (const l of live) if (l.mesh && l.kind !== 'future' && l.kind !== 'empty' && l.kind !== 'far') l.mesh.visible = Math.hypot(l.x - cp.x, l.z - cp.z) < FAR;
  }

  function step(dt, now, clock) {
    let moving = false, grew = false;
    shared.uTime.value = clock;
    if ((frame++ & 15) === 0) cull();
    for (const lot of live) {
      if (!lot.U) continue;
      const U = lot.U;
      if (lot.kind === 'tower') {
        if (motion) { const a = 60 * (lot.gT - lot.gr) - 9 * lot.gv; lot.gv += a * dt; lot.gr += lot.gv * dt; } else { lot.gr = lot.gT; lot.gv = 0; }
        if (Math.abs(lot.gT - lot.gr) < 0.002 && Math.abs(lot.gv) < 0.002) { lot.gr = lot.gT; lot.gv = 0; } else { moving = true; grew = true; }
        U.uGrow.value = lot.gr;
      }
      if (lot.flashStart > 0) { const ft = now - lot.flashStart; if (ft > 2.2) { lot.flashStart = -1; U.uFlashT.value = -1; } else { U.uFlashT.value = Math.max(0, ft); moving = true; } }
      if (lot.bodyFlash > 0) { lot.bodyFlash = Math.max(0, lot.bodyFlash - dt * 1.8); moving = true; }
      U.uFlash.value = lot.bodyFlash;
      if (lot.doorFlash > 0) { lot.doorFlash = Math.max(0, lot.doorFlash - dt * 1.6); moving = true; }
      const dT = lot.doors ? 1 : 0; lot.doorLevel += (dT - lot.doorLevel) * Math.min(1, dt * 7); if (Math.abs(dT - lot.doorLevel) < 0.01) lot.doorLevel = dT; else moving = true;
      U.uDoor.value = lot.doorLevel + lot.doorFlash * 1.1;
      if (lot.crownFlash > 0) { lot.crownFlash = Math.max(0, lot.crownFlash - dt * 0.8); moving = true; }
      const cT = lot.crown ? 1 : 0; lot.crownLevel += (cT - lot.crownLevel) * Math.min(1, dt * 5); if (Math.abs(cT - lot.crownLevel) < 0.01) lot.crownLevel = cT; else moving = true;
      U.uCrown.value = lot.crownLevel; U.uCrownPulse.value = lot.crownFlash > 0 ? Math.sin(lot.crownFlash * 10) * lot.crownFlash : 0;
    }
    if (layoutBeacons(now)) moving = true;
    layoutLamps();
    if (grew) { placeBlueprint(); layoutGold(); }
    updateAvi(clock);
    if (stepCrane(now)) moving = true;
    return moving;
  }

  /* picking: the ray against each lot's box in its own frame */
  const inv = new THREE.Matrix4(), lray = new THREE.Ray(), box = new THREE.Box3(), hit = new THREE.Vector3();
  function pickRay(ray) {
    let best = -1, bd = 1e18;
    for (const lot of live) {
      if (lot.slot < 0) continue;
      inv.copy(lot.g.matrixWorld).invert(); lray.copy(ray).applyMatrix4(inv);
      box.min.set(-LOT_W / 2, -0.1, -LOT_D / 2); box.max.set(LOT_W / 2, lot.kind === 'tower' ? Math.max(0.6, lot.topY * lot.gr + 0.35) : 0.25, LOT_D / 2);
      if (lray.intersectBox(box, hit)) { hit.applyMatrix4(lot.g.matrixWorld); const d = hit.distanceTo(ray.origin); if (d < bd) { bd = d; best = lot.slot; } }
    }
    return best;
  }
  function setPicked(i) { pickedLot = i >= 0 ? (slotOf[i] || null) : null; drawRings(); }
  function lotOfSlot(i) { return slotOf[i] || null; }
  /** the highest thing on the block near (x, z): the camera glides over the towers */
  function topNear(x, z, r) {
    let m = -1e9;
    for (const lot of live) if (lot.kind === 'tower' && Math.hypot(x - lot.x, z - lot.z) < r + lot.sh * 1.2) m = Math.max(m, lot.g.position.y + lot.topY * lot.gr * lot.sv + 6);
    return m;
  }
  function setPx(px) { glowMat.uniforms.uPx.value = px; }
  function setMotion(on) { motion = !!on; if (!motion) for (const l of live) { l.gr = l.gT; l.gv = 0; if (l.U) { l.U.uGrow.value = 1; l.U.uFlashT.value = -1; } l.flashStart = -1; } }
  function hideUi(on) { ringsHidden = !!on; blueprint.visible = !on && blueprint.parent != null; for (const m of [ringToday, ringPick, ringWeek]) m.visible = !on && m.geometry.attributes.position != null; }
  /** the middle of this week's row: fly-to "My block" frames it */
  function weekCentre() { return centre; }
  const weekView = () => viewOfSlots(slotLots.map((l) => l.L));
  rebuildPads(); drawRings();
  return { grp, lots, slotLots, centre, shared, setDays, step, setUpgrades, setGold, goldLots: () => live.filter((l) => l.gold && l.kind === 'tower'), pickRay, setPicked, lotOfSlot, todayLot, craneAt, topNear, setPx, setMotion, hideUi, weekCentre, weekView, slotCount: NS, rowCount: rows.length,
    pulse(i) { const l = slotOf[i]; if (l) l.bodyFlash = 1; wake(); }, repad() { padSig = ''; rebuildPads(); wake(); }, currentRow: () => curRow, days: () => lastDays };
}
