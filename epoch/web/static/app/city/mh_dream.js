// city/mh_dream.js · the dream home on Billionaires' Row (W 57th St / Central Park South), and the mist that keeps the corridor in sight.
//
// Data: manhattan/brow.json (scripts/manhattan/brow.mjs): the corridor polygon and every tower of 120 m or more in it, each with the
// outline of the building cut just under its roof. The home is whichever BIN the game names (epoch/game.py DREAM_HOME_BIN, sent in
// /api/world as districts.dream_home); any tower in brow.json works with no rebuild.
//   locked   : cloud banks around the towers (the corridor is "in the clouds"), one pale light at the top of the home tower
//   unlocked : the clouds clear; a warm band of penthouse windows lights up near the top of the home tower with a soft beacon
//   pose()   : the camera "Home" pose: just outside the penthouse facade, looking north across Central Park to Morningside Heights
import * as THREE from 'three';
import { clamp } from './util.js';
import { MS, hdr } from './palette.js';
import { makeGlow } from './mh_glow.js';

const PANE_W = 2.5, FLOOR = 3.9, FLOORS = 3, OUT = 0.5;

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  const lum = [1.0, 0.72, 0.9, 0.58];
  for (let i = 0; i < 4; i++) {
    const g = x.createLinearGradient(0, 6, 0, 58);
    const k = lum[i];
    g.addColorStop(0, `rgba(255,${Math.round(214 * k + 20)},${Math.round(140 * k + 20)},${0.95 * k + 0.05})`);
    g.addColorStop(1, `rgba(255,${Math.round(190 * k + 20)},${Math.round(110 * k + 20)},${0.9 * k + 0.05})`);
    x.fillStyle = g; x.fillRect(i * 64 + 5, 6, 54, 52);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createDream({ scene, brow, TR, home: homeXZ, park: parkXZ = null, wake }) {
  const grp = new THREE.Group(); grp.name = 'dream'; scene.add(grp);
  const towers = new Map(brow.towers.map((t) => [t.bin, t]));
  const region = brow.region;
  const winTex = windowTexture();
  const bandMat = new THREE.MeshBasicMaterial({ map: winTex, transparent: true, depthWrite: false, toneMapped: false, color: hdr(MS.windowWarm, 1.5), opacity: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  let band = null, bin = 0, lit = false, level = 0, goal = 0, tower = null;
  const glow = makeGlow(4); grp.add(glow.points);
  const beaconCol = new THREE.Color(), warm = new THREE.Color(MS.windowWarm);
  let motion = true;

  /* ---- mist: soft cloud banks hugging the corridor while it is locked ---- */
  const cloudMap = cloudTexture();
  const clouds = [];
  {
    const [cx, cz] = region.centre, rng = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < 26; i++) {
      const a = rng(i) * Math.PI * 2, d = Math.sqrt(rng(i + 40)) * 520;
      const m = new THREE.SpriteMaterial({ map: cloudMap, color: 0xdfeaf8, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const sp = new THREE.Sprite(m);
      const y = 45 + rng(i + 80) * 125;
      sp.position.set(cx + Math.cos(a) * d * 1.4, y, cz + Math.sin(a) * d * 0.9);
      const s = 220 + rng(i + 120) * 260; sp.scale.set(s * 1.5, s * 0.42, 1); sp.renderOrder = 5; sp.userData = { base: 0.3 + rng(i + 160) * 0.2, ph: rng(i + 200) * 6.28 };
      grp.add(sp); clouds.push(sp);
    }
  }

  function clearBand() { if (band) { grp.remove(band); band.geometry.dispose(); band = null; } }
  function buildBand(t) {
    clearBand();
    if (!t || !t.band || !t.band.seg.length) return;
    const pos = [], uv = [], idx = [], y0 = t.band.y - (FLOORS * FLOOR) / 2, y1 = y0 + FLOORS * FLOOR;
    let acc = 0;
    for (let i = 0; i < t.band.seg.length; i += 6) {
      const [ax, az, bx, bz, nx, nz] = t.band.seg.slice(i, i + 6), len = Math.hypot(bx - ax, bz - az);
      if (len < 0.8) continue;
      const k = pos.length / 3, ox = nx * OUT, oz = nz * OUT, u0 = acc / (PANE_W * 4), u1 = (acc + len) / (PANE_W * 4);
      pos.push(ax + ox, y0, az + oz, bx + ox, y0, bz + oz, bx + ox, y1, bz + oz, ax + ox, y1, az + oz);
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      // the cut gives the outward normal; make the winding face it
      const cr = (bx - ax) * nz - (bz - az) * nx;       // z-component of (b-a) x n in the xz plane
      if (cr > 0) idx.push(k, k + 1, k + 2, k, k + 2, k + 3); else idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
      acc += len;
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    band = new THREE.Mesh(g, bandMat); band.frustumCulled = false; band.renderOrder = 4; grp.add(band);
  }

  function setBin(b) {
    const t = towers.get(+b) || [...towers.values()].sort((p, q) => q.topY - p.topY)[0] || null;
    tower = t; bin = t ? t.bin : 0;
    buildBand(t); refresh(); wake();
    return bin;
  }
  function setLit(on, instant) {
    lit = !!on; goal = lit ? 1 : 0;
    if (instant || !motion) level = goal;
    refresh(); wake();
  }
  function refresh() {
    const L = level;
    bandMat.opacity = clamp(L * 1.0, 0, 1); if (band) band.visible = L > 0.01;
    for (const c of clouds) c.material.opacity = c.userData.base * (1 - L);
    glow.clear();
    if (tower) {
      const top = tower.topY;
      // locked: one small pale light on the home tower; unlocked: a warm beacon
      beaconCol.set(0xcfe3ff).lerp(warm, L).multiplyScalar(0.55 + 1.15 * L);
      glow.add(tower.x, top + 5, tower.z, beaconCol.r, beaconCol.g, beaconCol.b, 30 + 14 * L);
      if (L > 0.02 && tower.band) { const c = warm.clone().multiplyScalar(0.9 * L); glow.add(tower.x, tower.band.y, tower.z, c.r, c.g, c.b, 34); }
    }
    glow.commit();
  }

  /** frame step: eases the unlock, breathes the beacon. Returns true while something still moves. */
  function step(dt, now) {
    let moving = false;
    if (Math.abs(goal - level) > 0.002) { level += (goal - level) * (motion ? 1 - Math.exp(-dt * 1.2) : 1); if (Math.abs(goal - level) < 0.004) level = goal; refresh(); moving = true; }
    if (motion && tower && glow.count) {
      const k = 0.82 + 0.18 * Math.sin(now * 1.7), a = glow.points.geometry.attributes.color.array;
      beaconCol.set(0xcfe3ff).lerp(warm, level).multiplyScalar((0.55 + 1.15 * level) * k);
      a[0] = beaconCol.r; a[1] = beaconCol.g; a[2] = beaconCol.b; glow.points.geometry.attributes.color.needsUpdate = true;
      for (const c of clouds) if (c.material.opacity > 0.01) c.position.x += Math.sin(now * 0.05 + c.userData.ph) * dt * 1.2;
      moving = true;
    }
    return moving && motion;
  }
  /** mist colour follows the sky: the scene's fog colour, a little lighter */
  const tone = new THREE.Color();
  function setTone(fogCol, day = 0) { tone.copy(fogCol).lerp(new THREE.Color(0xffffff), 0.28 + 0.4 * day); for (const c of clouds) c.material.color.copy(tone); }
  function setMotion(on) { motion = !!on; if (!motion) { level = goal; refresh(); } }

  /** unit vector (x, z) from the home tower toward Morningside Heights: turned part of the way toward the middle of Central Park, so the
   *  park fills the window and Morningside sits just left of centre at its far end */
  function dirToHome(t) {
    let dx = homeXZ[0] - t.x, dz = homeXZ[1] - t.z, L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (parkXZ) { let px = parkXZ[0] - t.x, pz = parkXZ[1] - t.z; const P = Math.hypot(px, pz) || 1; px /= P; pz /= P; dx = dx * 0.4 + px * 0.6; dz = dz * 0.4 + pz * 0.6; L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; }
    return [dx, dz];
  }

  /** camera pose for the Home fly-to: outside the penthouse facade, looking toward Morningside across the park */
  function pose() {
    const t = tower; if (!t || !t.band) return null;
    const [dx, dz] = dirToHome(t);
    // the point of the cut that reaches farthest toward home, among the facades that face it
    let best = null, bd = -1e9, s = t.band.seg;
    for (let i = 0; i < s.length; i += 6) {
      if (s[i + 4] * dx + s[i + 5] * dz < 0.25) continue;
      for (const [px, pz] of [[s[i], s[i + 1]], [s[i + 2], s[i + 3]]]) { const d = (px - t.x) * dx + (pz - t.z) * dz; if (d > bd) { bd = d; best = [px, pz]; } }
    }
    if (!best) { bd = 20; best = [t.x + dx * 20, t.z + dz * 20]; }
    const out = 32, camX = best[0] + dx * out, camZ = best[1] + dz * out, camY = t.band.y + 1.5;
    const R = 140, phi = 1.43;
    const tgtX = camX + dx * R * Math.sin(phi), tgtZ = camZ + dz * R * Math.sin(phi), tgtY = camY - R * Math.cos(phi);
    return { t: [tgtX, tgtZ], abs: tgtY, r: R, phi, theta: Math.atan2(-dx, -dz), exact: true, label: 'Dream home' };
  }
  return { grp, towers, region, setBin, setLit, step, setMotion, setTone, pose, setPx: (px) => glow.setPx(px), get bin() { return bin; }, get lit() { return lit; }, get tower() { return tower; }, get level() { return level; }, glow };
}
