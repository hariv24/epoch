// city/mh_seasonal.js · small, tasteful seasonal props on the real city. Purely cosmetic, built the first time a key is switched on.
// Keys follow docs/FEATURES-V2.md section 6 (the same set the diorama had, see seasonal.js):
//   halloween, diwali, thanksgiving_week, holiday_lights, nye_ball_drop / new_year, cherry_blossoms, holi,
//   july_4th / india_independence_day / pride (flags), nyc_marathon
// Where things stand:
//   per-lot props  (pumpkins, diyas, flags, blossom trees, garlands, colour splashes) are children of each day-lot's own frame
//                  (mh_home.js), so they sit on the stoop and scale with the tower
//   plaza props    (Columbia's Low Plaza: rangoli, the big tree, the parade balloon, finish arch, rainbow crossing) live in a small frame there
//   the ball       rides on the real One Times Square (nye_ball_drop and new_year)
//   fireworks      burst over the river beside the framed block (setFrame), or over the Hudson in the free city
// Under reduced motion nothing moves (flags, balloon, bats, runners, petals and fireworks are frozen or hidden).
import * as THREE from 'three';
import { Geo, rgb, shade, clamp, smooth, hash01, rng, KIND, TAU } from './util.js';
import { createCityMaterial } from './shader.js';
import { createFlakes, createFireworks } from './particles.js';
import { CA, SA, fromUV } from './mh_tiles.js';

const FW_PALETTE = {
  nye_ball_drop: ['#ffd36b', '#ffffff', '#7fb4ff', '#ff7ab8'], new_year: ['#ffd36b', '#ffffff', '#7fb4ff', '#ff7ab8'],
  july_4th: ['#ff4a4a', '#ffffff', '#4a7bff'], india_independence_day: ['#ff9933', '#ffffff', '#2ecc71'], diwali: ['#ffb347', '#ff6a3d', '#ffe38a', '#ff7ac8'],
};
const RAINBOW = ['#e8453c', '#f28c28', '#f7d417', '#3cb371', '#3a8fe0', '#8b5fd0'];

// a cloth that waves in the vertex shader (shared.uTime), one coloured quad per cell
function flagBatch(shared, items, cols = 6) {
  const pos = [], col = [], fl = [], idx = []; let n = 0; const c = new THREE.Color();
  for (const f of items) {
    const rows = f.rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      c.set(f.colorAt(i / cols, j / rows, (i + 0.5) / cols, (j + 0.5) / rows));
      const x0 = f.x + (i / cols) * f.w, x1 = f.x + ((i + 1) / cols) * f.w, y0 = f.y - (j / rows) * f.h, y1 = f.y - ((j + 1) / rows) * f.h;
      pos.push(x0, y0, f.z, x1, y0, f.z, x1, y1, f.z, x0, y1, f.z); for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      fl.push(i / cols, (i + 1) / cols, (i + 1) / cols, i / cols); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aFl', new THREE.Float32BufferAttribute(fl, 1)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x15100a });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFl; uniform float uTime;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); float fw = aFl * aFl; transformed.z += sin(uTime * 4.2 + position.x * 38.0 + position.y * 6.0) * 0.016 * fw; transformed.y += sin(uTime * 5.1 + position.x * 30.0) * 0.006 * fw;');
  };
  m.customProgramCacheKey = () => 'witness-flag-v1';
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; return mesh;
}
const FLAG = {
  us: { rows: 5, colorAt: (u, v, uc, vc) => (uc < 0.42 && vc < 0.62 ? '#2b3f95' : (Math.floor(v * 5) % 2 === 0 ? '#d9423e' : '#f4f1fa')) },
  india: { rows: 3, colorAt: (u, v, uc, vc) => (Math.abs(uc - 0.5) < 0.1 && vc > 0.34 && vc < 0.66 ? '#27358f' : vc < 0.34 ? '#ff9933' : vc < 0.67 ? '#f6f3ee' : '#2e9a4e') },
  rainbow: { rows: 6, colorAt: (u, v, uc, vc) => RAINBOW[Math.min(5, Math.floor(vc * 6))] },
  marathon: { rows: 4, colorAt: (u, v, uc, vc) => ((Math.floor(uc * 6) + Math.floor(vc * 4)) % 2 ? '#f2eee8' : '#26283e') },
};

/**
 * home: createHome() result (slotLots: each lot's frame `g`); plaza: {x, z, y} on Columbia's Low Plaza; ball: {x, z, y} top of One Times Square
 * (or null); target: the orbit target (particles follow it); tablet: lighter particle counts.
 */
export function createSeasonal({ scene, shared, home, radial, target, plaza, ball, TR, tablet = false }) {
  const root = new THREE.Group(); root.name = 'seasonal'; scene.add(root);
  const { mat: propMat } = createCityMaterial(shared, { ao: 0 });
  const built = {}, shown = new Set(); let motion = true, dayNow = 0, weatherWet = false, forceFw = false, pxNow = 600;
  const lots = home.slotLots;
  const dm = new THREE.Object3D();
  const LIGHT = tablet ? 0.6 : 1;
  // the plaza frame: grid aligned, one unit = PS metres (the old diorama's lot is about 1.5 units, here the plaza steps are about 90 m wide)
  const PS = 9;
  const P = new THREE.Group(); P.name = 'plaza'; P.position.set(plaza.x, plaza.y, plaza.z); P.scale.setScalar(PS); root.add(P);
  P.rotation.y = -Math.atan2(SA, CA);                // local +x runs across the avenues (u), local +z runs south along them
  P.updateMatrixWorld(true);

  const mk = (geo, mat = propMat) => { const m = new THREE.Mesh(geo.build(), mat); m.frustumCulled = false; return m; };
  /** runs fn(g, lot) for each day-lot in the lot's own frame (x, z = 0 is the lot centre, z = 1.02 the stoop) and hangs the result on it */
  const perLot = (grp, fn) => {
    for (const lot of lots) {
      const g = new Geo(); fn(g, lot);
      if (!g.empty) { const m = mk(g); lot.g.add(m); grp.userData.parts.push(m); }
    }
  };
  const lotDecal = (grp, lot, x, z, r, c, o = {}) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color(c), transparent: true, opacity: o.opacity ?? 0.7, depthWrite: false, blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false, toneMapped: o.tone ?? true }));
    m.position.set(x, 0.03, z); m.scale.set(r * 2, 1, r * 2); m.renderOrder = 3; m.frustumCulled = false; lot.g.add(m); grp.userData.parts.push(m); return m;
  };
  const newGroup = () => { const grp = new THREE.Group(); grp.userData.parts = []; return grp; };
  const detach = (grp) => { for (const m of grp.userData.parts) m.visible = false; };
  const attach = (grp, on) => { for (const m of grp.userData.parts) m.visible = on; };
  const front = () => 1.02;
  const pole = (g, x, z, h, th = 0.018, c = rgb('#d8e4f0')) => g.bar([x, 0, z], [x, h, z], th, c);
  let pxFlakes = [];
  const mkFlakes = (o) => { const f = createFlakes({ ...o, max: Math.round(o.max * LIGHT) }); f.u.uCenter.value = target; f.u.uPx.value = pxNow; f.u.uBox.value.set(26 * PS, 0, 24 * PS); f.u.uH.value = 10 * PS; f.u.uSize.value = (o.size ?? 0.05) * PS; f.u.uSway.value = (o.sway ?? 0.3) * PS; f.u.uSpeed.value = (o.speed ?? 0.8) * PS; pxFlakes.push(f); return f; };
  const baseFlakes = (f, y) => { f.u.uBaseY.value = y - 1.2 * PS; };

  const B = {};
  /* ---------------- halloween ---------------- */
  B.halloween = () => {
    const grp = newGroup(), r = rng(31), org = rgb('#f08a24'), org2 = rgb('#d9731c'), stem = rgb('#4a7a3c'), face = rgb('#ffd15a');
    const pumpkin = (g, x, z, s) => {
      g.sphere(x, 0.06 * s, z, 0.07 * s, 8, 6, r() < 0.5 ? org : org2, {}, 0.8); g.box(x - 0.008 * s, 0.11 * s, z - 0.008 * s, x + 0.008 * s, 0.145 * s, z + 0.008 * s, stem);
      g.box(x - 0.03 * s, 0.07 * s, z + 0.052 * s, x - 0.012 * s, 0.085 * s, z + 0.062 * s, face, { kind: KIND.glow, top: false, sides: 1 });
      g.box(x + 0.012 * s, 0.07 * s, z + 0.052 * s, x + 0.03 * s, 0.085 * s, z + 0.062 * s, face, { kind: KIND.glow, top: false, sides: 1 });
      g.box(x - 0.03 * s, 0.035 * s, z + 0.056 * s, x + 0.03 * s, 0.047 * s, z + 0.064 * s, face, { kind: KIND.glow, top: false, sides: 1 });
    };
    perLot(grp, (g, lot) => {
      const h = hash01(lot.k * 31 + 7); if (h < 0.18) return;
      const side = h < 0.6 ? -1 : 1, x = side * (0.48 + 0.1 * r()), z = front() + 0.05;
      pumpkin(g, x, z, 1.7 + 0.6 * r()); lotDecal(grp, lot, x, z + 0.05, 0.34, '#ff8a2a', { opacity: 0.55 });
      if (h > 0.55) pumpkin(g, x + side * 0.26, z + 0.04, 1.2);
    });
    // bats: a small flock circling over the block at dusk
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-0.12, 0.05, -0.02, 0, 0, 0.05, 0, 0, -0.04, 0.12, 0.05, -0.02, 0, 0, 0.05, 0, 0, -0.04], 3)); bg.computeVertexNormals();
    const bats = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0x14102a, side: THREE.DoubleSide, fog: false }), 8); bats.frustumCulled = false; grp.add(bats);
    const items = Array.from({ length: 8 }, () => ({ a: r() * TAU, rad: 2.6 + r() * 2.6, y: 3.0 + r() * 2.4, sp: 0.22 + r() * 0.2, ph: r() * 6 }));
    const BS = 4.2;
    return {
      group: grp, update(t, on, p) {
        const show = p.day < 0.55; bats.visible = show; if (!show) return false;
        const c = target;
        items.forEach((b, i) => { const a = b.a + (on ? t * b.sp : 0), flap = on ? Math.sin(t * 12 + b.ph) : 0.3; dm.position.set(c.x + Math.cos(a) * b.rad * BS * 4, c.y + (b.y + Math.sin(t * 0.6 + b.ph) * 0.3 * (on ? 1 : 0)) * BS * 2.4, c.z + Math.sin(a) * b.rad * BS * 3); dm.rotation.set(0, -a + Math.PI / 2, 0); dm.scale.set(1.2 * BS * 2.4, flap * BS * 2.4, 1.2 * BS * 2.4); dm.updateMatrix(); bats.setMatrixAt(i, dm.matrix); });
        bats.instanceMatrix.needsUpdate = true; return on;
      },
    };
  };

  /* ---------------- diwali ---------------- */
  B.diwali = () => {
    const grp = newGroup(), clay = rgb('#b8602a'), gls = [];
    perLot(grp, (g, lot) => {
      for (const dx of [-0.6, -0.3, 0.3, 0.6]) if (hash01(lot.k * 17 + Math.round(dx * 10)) > 0.25) {
        const x = dx, z = front() + 0.06, k = 2.0;
        g.cyl(x, z, 0, 0.026 * k, 0.05 * k, 0.036 * k, 8, clay, {}); g.cyl(x, z, 0.026 * k, 0.07 * k, 0.016 * k, 0.0, 6, rgb('#ffd27a'), { kind: KIND.glow });
        gls.push(lotDecal(grp, lot, x, z, 0.3, '#ff9a2e', { opacity: 0.6 }));
      }
    });
    // a rangoli on the plaza: rings of colour with petals
    const pg = new Geo(), rx = -1.4, rz = 0.0, RK = 1.5, ring = ['#e84a8a', '#f59a2b', '#f7d417', '#27b39a', '#e84a8a', '#f4f1fa'];
    ring.forEach((c, i) => pg.cyl(rx, rz, 0.022 + i * 0.0012, 0.0235 + i * 0.0012, (0.5 - i * 0.075) * RK, (0.5 - i * 0.075) * RK, 24, rgb(c), { sides: 0 }));
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; pg.blob(rx + Math.cos(a) * 0.43 * RK, 0.04, rz + Math.sin(a) * 0.43 * RK, 0.08, rgb(k % 2 ? '#f7d417' : '#27b39a'), {}, 0.4); }
    const pm = mk(pg); P.add(pm); grp.userData.parts.push(pm);
    return { group: grp, update(t, on) { for (const d of gls) d.material.opacity = 0.5 + (on ? 0.12 * Math.sin(t * 3.1) : 0); return on; } };
  };

  /* ---------------- thanksgiving ---------------- */
  B.thanksgiving_week = () => {
    const grp = newGroup(), balloon = new THREE.Group(), g = new Geo();
    const body = rgb('#d98a45'), light = rgb('#f0b46a'), red = rgb('#d9453f'), yel = rgb('#f2c53a'), teal = rgb('#2fa89a'), cream = rgb('#f4ece0');
    g.sphere(0, 1.7, 0, 0.42, 12, 8, body, {}, 0.88);
    g.sphere(0.0, 2.04, 0.34, 0.2, 10, 8, light, {});
    g.sphere(0.0, 1.9, 0.47, 0.11, 8, 6, red, {}, 1.0);
    g.sphere(-0.07, 2.1, 0.5, 0.03, 6, 5, cream, {}); g.sphere(0.07, 2.1, 0.5, 0.03, 6, 5, cream, {});
    g.sphere(-0.07, 2.1, 0.53, 0.014, 5, 4, rgb('#1d2140'), {}); g.sphere(0.07, 2.1, 0.53, 0.014, 5, 4, rgb('#1d2140'), {});
    g.box(-0.035, 2.0, 0.5, 0.035, 2.06, 0.6, yel, {});
    [red, yel, teal, red, yel].forEach((c, i) => { const a = -0.9 + i * 0.45; g.sphere(Math.sin(a) * 0.4, 1.85 + Math.cos(a) * 0.35, -0.38, 0.17, 8, 6, c, {}, 1.5); });
    for (const sx of [-0.14, 0.14]) g.bar([sx, 1.3, 0.02], [sx, 1.0, 0.04], 0.04, yel);
    const cord = rgb('#e9e4f6');
    for (const [hx, hz] of [[-0.55, 0.45], [0.6, 0.4], [-0.5, -0.5], [0.55, -0.5]]) { g.bar([hx * 0.4, 1.55, hz * 0.4], [hx, 0.06, hz], 0.006, cord); g.box(hx - 0.02, 0.0, hz - 0.015, hx + 0.02, 0.07, hz + 0.015, rgb('#ffc83d')); g.sphere(hx, 0.09, hz, 0.015, 5, 4, rgb('#f0c9a0'), {}); }
    balloon.add(mk(g)); balloon.scale.setScalar(1.6); P.add(balloon); grp.userData.parts.push(balloon);
    const leaves = mkFlakes({ max: 420, color: 0xe08a3a, size: 0.085, speed: 0.55, sway: 0.7, spin: 1.6, petal: true, opacity: 0.9, seed: 12, name: 'leaves' }); leaves.setCount(220); root.add(leaves.mesh); grp.userData.parts.push(leaves.mesh);
    return {
      group: grp, leaves, update(t, on) {
        const u = on ? ((t * 0.016) % 1) : 0.42; balloon.position.set(2.6, 0.4, -4.5 + 9 * u); balloon.rotation.y = Math.PI; balloon.children[0].position.y = on ? Math.sin(t * 0.9) * 0.05 : 0;
        leaves.u.uTime.value = t; baseFlakes(leaves, target.y); return on;
      },
    };
  };

  /* ---------------- holiday lights ---------------- */
  B.holiday_lights = () => {
    const grp = newGroup(), steel = rgb('#2b3f63'), cols = ['#ff4a4a', '#ffd25a', '#3ccf8c', '#5aa8ff', '#ff7ac8'], bulbs = [];
    // a garland across each lot's front: two posts and a string of bulbs
    perLot(grp, (g, lot) => {
      const z = front() + 0.04;
      for (const x of [-0.72, 0.72]) { g.bar([x, 0, z], [x, 0.5, z], 0.02, steel); g.sphere(x, 0.52, z, 0.03, 6, 5, rgb('#ffd25a'), { kind: KIND.glow }); }
      for (let b = 1; b < 12; b++) { const u = b / 12; bulbs.push({ lot, x: -0.72 + 1.44 * u, y: 0.5 - Math.sin(u * Math.PI) * 0.09, z }); }
    });
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), Math.max(1, bulbs.length)); bm.frustumCulled = false; bm.count = bulbs.length;
    const mt = new THREE.Matrix4(), mm = new THREE.Matrix4();
    bulbs.forEach((p, i) => { dm.position.set(p.x, p.y, p.z); dm.scale.setScalar(1); dm.rotation.set(0, 0, 0); dm.updateMatrix(); mm.multiplyMatrices(p.lot.g.matrixWorld, dm.matrix); bm.setMatrixAt(i, mm); });
    root.add(bm); grp.userData.parts.push(bm); void mt;
    // the big plaza tree
    const tg = new Geo(), gr = rgb('#2f8f66'), tx = 1.8, tz = 0.05;
    tg.box(tx - 0.03, 0, tz - 0.03, tx + 0.03, 0.2, tz + 0.03, rgb('#6b4d3d'));
    [[0.16, 0.55, 0.3], [0.45, 0.85, 0.23], [0.75, 1.12, 0.16]].forEach(([y0, y1, rr], i) => tg.cyl(tx, tz, y0 + 0.1, y1 + 0.1, rr, 0.01, 9, shade(gr, 1 + i * 0.1)));
    tg.sphere(tx, 1.3, tz, 0.045, 8, 6, rgb('#ffe08a'), { kind: KIND.glow });
    const rt = rng(4); for (let i = 0; i < 26; i++) { const y = 0.25 + rt() * 0.85, rad = 0.3 * (1 - (y - 0.15) / 1.1) + 0.02, a = rt() * TAU; tg.sphere(tx + Math.cos(a) * rad, y, tz + Math.sin(a) * rad, 0.016, 5, 4, rgb(cols[i % 5]), { kind: KIND.glow }); }
    const tm = mk(tg); P.add(tm); grp.userData.parts.push(tm);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color('#ffd48a'), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); glow.position.set(tx, 0.03, tz); glow.scale.setScalar(1.2); P.add(glow); grp.userData.parts.push(glow);
    const flurry = mkFlakes({ max: 500, color: 0xffffff, size: 0.045, speed: 0.55, sway: 0.4, seed: 21, name: 'flurry' }); flurry.setCount(280); root.add(flurry.mesh); grp.userData.parts.push(flurry.mesh);
    const c = new THREE.Color(); let lastTw = -1;
    function paint(t) { bulbs.forEach((p, i) => { const on = (Math.floor(t * 2.2) + i) % 5; c.set(cols[(i + (on === 0 ? 1 : 0)) % 5]).multiplyScalar(on === 0 ? 1.5 : 3.0); bm.setColorAt(i, c); }); if (bm.instanceColor) bm.instanceColor.needsUpdate = true; }
    paint(0);
    return { group: grp, flurry, update(t, on) { flurry.u.uTime.value = t; baseFlakes(flurry, target.y); flurry.mesh.visible = !weatherWet; if (on && Math.floor(t * 2.2) !== lastTw) { lastTw = Math.floor(t * 2.2); paint(t); } return on; } };
  };

  /* ---------------- new year: the ball on the real One Times Square ---------------- */
  const ballFor = (drops) => () => {
    const grp = newGroup(); const holder = new THREE.Group(); root.add(holder); grp.userData.parts.push(holder);
    if (!ball) return { group: grp, update: () => false };
    holder.position.set(ball.x, ball.y, ball.z);
    const R = 2.2;
    const geo = new THREE.IcosahedronGeometry(R, 1), n = geo.attributes.position.count, cc = new Float32Array(n * 3), cs = ['#5aa8ff', '#ffffff', '#ff7ac8', '#ffd36b', '#9be7ff'], c = new THREE.Color();
    for (let f = 0; f < n / 3; f++) { c.set(cs[(f * 7) % cs.length]); for (let k = 0; k < 3; k++) { cc[(f * 3 + k) * 3] = c.r; cc[(f * 3 + k) * 3 + 1] = c.g; cc[(f * 3 + k) * 3 + 2] = c.b; } }
    geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const bl = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(2.0, 2.0, 2.0), fog: false })); bl.frustumCulled = false;
    const pg = new Geo(); pg.bar([0, 0, 0], [0, 7.5, 0], 0.35, rgb('#d8e4f0')); pg.bar([0, 2.4, 0], [0, 2.7, 0], 0.8, rgb('#c9a35a'));
    const poleM = mk(pg), halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: new THREE.Color(1.0, 0.85, 0.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); halo.scale.setScalar(26);
    holder.add(poleM, bl, halo);
    return {
      group: grp, update(t, on, p) {
        const top = 9.8, rest = 2.8;
        const k = smooth(drops && p.hourF >= 23.9833 ? clamp((p.hourF - 23.9833) / 0.0167, 0, 1) : 0);
        bl.position.y = top + (rest - top) * k; halo.position.y = bl.position.y; bl.rotation.y = on ? t * 0.5 : 0;
        bl.material.color.setScalar(on ? 1.8 + 0.5 * Math.sin(t * 3.2) : 2.0); halo.material.opacity = 0.2 + 0.3 * clamp(p.glow ?? 1, 0, 1);
        return on;
      },
    };
  };
  B.nye_ball_drop = ballFor(true); B.new_year = ballFor(false);

  /* ---------------- cherry blossoms ---------------- */
  B.cherry_blossoms = () => {
    const grp = newGroup(), r = rng(77), pinks = ['#f5a9c8', '#ffc4da', '#ee8fb5', '#ffd3e4'], trunk = rgb('#6b4d3d');
    const tree = (g, x, z, s) => {
      g.box(x - 0.022 * s, 0, z - 0.022 * s, x + 0.022 * s, 0.17 * s, z + 0.022 * s, trunk, { top: false });
      g.blob(x, 0.3 * s, z, 0.17 * s, rgb(pinks[(r() * 4) | 0]), {}, 0.95); g.blob(x + 0.1 * s, 0.26 * s, z + 0.03 * s, 0.11 * s, rgb(pinks[(r() * 4) | 0]), {}, 0.9); g.blob(x - 0.09 * s, 0.34 * s, z - 0.03 * s, 0.1 * s, rgb(pinks[(r() * 4) | 0]), {}, 0.9); g.blob(x, 0.44 * s, z, 0.09 * s, rgb('#ffd3e4'), {}, 0.9);
    };
    perLot(grp, (g, lot) => { const h = hash01(lot.k * 13 + 3); if (h < 0.3) return; tree(g, h < 0.65 ? -0.58 : 0.58, front() + 0.01, 0.95 + 0.4 * r()); });
    const pg = new Geo(); for (const x of [-3.2, -2.1, -1.0, 1.0, 2.1, 3.2]) tree(pg, x, 0.7 + (Math.abs(x) % 2 > 1 ? 0.5 : 0), 1.25);
    const pm = mk(pg); P.add(pm); grp.userData.parts.push(pm);
    const petals = mkFlakes({ max: 520, color: 0xffb4d0, size: 0.07, speed: 0.32, sway: 0.8, spin: 1.8, petal: true, opacity: 0.9, seed: 33, name: 'petals' }); petals.setCount(260); root.add(petals.mesh); grp.userData.parts.push(petals.mesh);
    return { group: grp, petals, update(t, on) { petals.u.uTime.value = t; baseFlakes(petals, target.y); return on; } };
  };

  /* ---------------- holi ---------------- */
  B.holi = () => {
    const grp = newGroup(), r = rng(808), cs = ['#ff3d9a', '#ffd21f', '#27d3ff', '#7cff6a', '#b068ff', '#ff7a2a'];
    perLot(grp, (g, lot) => { for (let i = 0; i < 2; i++) if (hash01(lot.k * 7 + i) > 0.25) lotDecal(grp, lot, (r() - 0.5) * 1.3, front() + 0.02 + r() * 0.1, 0.3 + r() * 0.35, cs[(lot.k + i) % 6], { opacity: 0.8, additive: false }); });
    for (let i = 0; i < 14; i++) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color(cs[i % 6]), transparent: true, opacity: 0.8, depthWrite: false, fog: false })); d.position.set((r() - 0.5) * 7, 0.03, (r() - 0.5) * 3); d.scale.setScalar(0.6 + r() * 0.9); d.renderOrder = 3; P.add(d); grp.userData.parts.push(d); }
    const puffs = Array.from({ length: 8 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: new THREE.Color(cs[i % 6]), transparent: true, opacity: 0.5, depthWrite: false, fog: false })); P.add(s); grp.userData.parts.push(s); return { s, x: (r() - 0.5) * 6, z: (r() - 0.5) * 2, ph: r() }; });
    return { group: grp, update(t, on) { puffs.forEach((p) => { const u = on ? ((t * 0.06 + p.ph) % 1) : p.ph; p.s.position.set(p.x + Math.sin(u * 6 + p.ph * 9) * 0.3, 0.3 + u * 1.6, p.z); p.s.scale.setScalar(0.7 + u * 1.3); p.s.material.opacity = 0.75 * Math.sin(u * Math.PI); }); return on; } };
  };

  /* ---------------- flags ---------------- */
  const flagsKey = (kind, perLotP = 0.5) => () => {
    const grp = newGroup(), spec = FLAG[kind];
    for (const lot of lots) {
      if (hash01(lot.k * 5 + 1) > perLotP + (kind === 'us' ? 0.1 : 0)) continue;
      const g = new Geo(), x = 0.62, z = front() - 0.02;
      pole(g, x, z, 0.95, 0.024); g.sphere(x, 0.97, z, 0.03, 6, 5, rgb('#f2c53a'), {});
      const m = mk(g), fl = flagBatch(shared, [{ x: x + 0.012, y: 0.93, z, w: 0.46, h: 0.29, rows: spec.rows, colorAt: spec.colorAt }]);
      lot.g.add(m, fl); grp.userData.parts.push(m, fl);
    }
    return { group: grp, update: () => false };
  };
  B.july_4th = flagsKey('us', 0.55); B.india_independence_day = flagsKey('india', 0.55);
  B.pride = () => {
    const f = flagsKey('rainbow', 0.55)(), g = new Geo();
    RAINBOW.forEach((c, i) => { const w = 6 / 6; g.box(-3 + i * w, 0.02, -0.5, -3 + (i + 1) * w, 0.03, 0.5, rgb(c), { sides: 0, kind: KIND.inlay }); });
    const m = mk(g); P.add(m); f.group.userData.parts.push(m); return f;
  };

  /* ---------------- marathon ---------------- */
  B.nyc_marathon = () => {
    const grp = newGroup(), g = new Geo(), ax = -2.6, az = -0.2;
    pole(g, ax - 0.8, az, 0.85, 0.04, rgb('#e8e4f4')); pole(g, ax + 0.8, az, 0.85, 0.04, rgb('#e8e4f4'));
    g.box(ax - 0.84, 0.74, az - 0.03, ax + 0.84, 0.88, az + 0.03, rgb('#3a6fd8')); g.box(ax - 0.84, 0.88, az - 0.03, ax + 0.84, 0.905, az + 0.03, rgb('#ff8a2a'), { kind: KIND.glow });
    for (let k = 0; k < 12; k++) g.box(ax - 0.78 + k * 0.13, 0.77, az + 0.03, ax - 0.7 + k * 0.13, 0.85, az + 0.034, k % 2 ? rgb('#f4f1fa') : rgb('#ff8a2a'), { kind: KIND.glow, top: false, sides: 1 });
    const gm = mk(g), fl = flagBatch(shared, [{ x: ax + 0.86, y: 0.84, z: az, w: 0.26, h: 0.16, rows: 4, colorAt: FLAG.marathon.colorAt }]);
    P.add(gm, fl); grp.userData.parts.push(gm, fl);
    const rg = new Geo(); rg.box(-0.012, 0.03, -0.01, 0.012, 0.075, 0.01, rgb('#ffffff')); rg.box(-0.01, 0, -0.008, 0.01, 0.035, 0.008, rgb('#1b2b47')); rg.sphere(0, 0.088, 0, 0.012, 5, 4, rgb('#f0c9a0'), {});
    const N = Math.round(44 * LIGHT), runners = new THREE.InstancedMesh(rg.build(), propMat, N), r = rng(66), cs = ['#ff8a2a', '#3a6fd8', '#e8453c', '#27b39a', '#f4f1fa', '#f2c53a'], c = new THREE.Color();
    const rs = Array.from({ length: N }, () => ({ off: r(), lane: (r() - 0.5) * 1.05, sp: 0.5 + r() * 0.25, ph: r() * 6 })); rs.forEach((q, i) => runners.setColorAt(i, c.set(cs[i % 6])));
    runners.frustumCulled = false; P.add(runners); grp.userData.parts.push(runners);
    const zA = -4, zB = az - 0.6;
    return { group: grp, update(t, on) { rs.forEach((q, i) => { const u = (q.off + (on ? t * q.sp * 0.045 : 0)) % 1; dm.position.set(ax + q.lane, 0 + (on ? Math.abs(Math.sin(t * 9 + q.ph)) * 0.012 : 0), zB + (zA - zB) * u); dm.rotation.set(0, Math.PI, 0); dm.scale.setScalar(1.4); dm.updateMatrix(); runners.setMatrixAt(i, dm.matrix); }); runners.instanceMatrix.needsUpdate = true; return on; } };
  };

  /* ---------------- fireworks ---------------- */
  const fw = createFireworks(tablet ? 3 : 5, tablet ? 50 : 70); root.add(fw.mesh);
  let frame = { c: [plaza.x, plaza.z], y: plaza.y, right: [CA, SA], fwd: [SA, -CA], s: 20 };
  let fwWanted = false, fwPal = null;
  function aimFireworks() {
    if (!fwPal) return;
    const { c, y, right, fwd, s } = frame;
    const sp = [[-14.6, 3.0, -1.5], [14.4, 3.6, -4.5], [-14.8, 3.4, -8.5], [14.6, 3.2, 3.5], [-14.4, 3.8, 4.5]].slice(0, fw.shells);
    fw.configure(sp.map(([x, h, z]) => [c[0] + right[0] * x * s - fwd[0] * z * s, y + h * s * 1.3, c[1] + right[1] * x * s - fwd[1] * z * s]), fwPal);
    fw.u.uScale.value = s;
  }

  /* ---------------- public ---------------- */
  let keys = [];
  function set(list) {
    keys = (list || []).map((k) => (typeof k === 'string' ? k : k && k.key)).filter(Boolean);
    const want = new Set(keys.filter((k) => B[k]));
    for (const k of want) if (!built[k]) { try { built[k] = B[k](); root.add(built[k].group); } catch (e) { console.warn('seasonal', k, e); built[k] = { group: newGroup(), update: () => false }; } }
    for (const k of Object.keys(built)) { const on = want.has(k); built[k].group.visible = on; attach(built[k].group, on); }
    shown.clear(); want.forEach((k) => shown.add(k));
    const fk = [...want].filter((k) => FW_PALETTE[k]);
    fwWanted = fk.length > 0; fwPal = fwWanted ? fk.flatMap((k) => FW_PALETTE[k]) : null; aimFireworks();
    return keys;
  }
  /** per frame; t = scene clock, on = motion allowed. Returns true while props want frames. */
  function update(t, on, p) {
    motion = on; dayNow = p.day; let busy = false;
    for (const k of shown) { const b = built[k]; if (b && b.update && b.update(t, on, p)) busy = true; }
    const night = dayNow < 0.35;
    fw.setVisible(on && fwWanted && (night || forceFw));          // frozen sparks look wrong, so reduced motion shows none
    fw.u.uTime.value = t; if (fw.mesh.visible) busy = true;
    return busy;
  }
  return {
    set, update, group: root, fireworks: fw, get keys() { return keys.slice(); }, get shown() { return [...shown]; },
    setWet(w) { weatherWet = !!w; },
    setPx(px) { pxNow = px; fw.u.uPx.value = px; for (const f of pxFlakes) f.u.uPx.value = px; },
    /** where the fireworks go: {c:[x,z] centre, y ground, right:[x,z], fwd:[x,z] (away from the camera), s metres per diorama unit} */
    setFrame(f) { frame = { ...frame, ...f }; aimFireworks(); },
    forceFireworks(v) { forceFw = !!v; }, known: Object.keys(B), built, plazaFrame: P, motion: () => motion,
  };
}
void fromUV;
