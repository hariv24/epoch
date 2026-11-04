// city/character.js · the user's figure: a stylised-realistic person (docs/COZY.md 3b), built by human.js. Clearly human, with a
// subtle face (small eyes with lids, brows, a nose, soft lips), real hair and modelled clothes; never a mascot, never a cartoon face.
// It wears the equipped outfit (economy_catalog.OUTFITS, each one visibly different) and follows the routine from /api/world economy.character:
//   studying      a running focus block: at a desk in Butler Library (the city view) or beside today's lot (the Today hero and the focus cam)
//   walking_home  for 12 minutes after a block: walks from Butler toward the home building (city), or strolls the sidewalk by today's lot
//   asleep        past the sleep cutoff: at home, so the street is empty and the home light turns moon-blue (a gentle nudge to sleep)
//   home          otherwise: standing idle beside today's lot
// Reduced motion: no walking animation, just placement (the figure is moved along its path now and then, never animated), and no
// breathing or blinking (static poses).
//
//   buildFigure(outfit, opts) -> { root, setPose(pose, phase), applyPose(P), hand, handL, head, setAccessory, setMotion, dispose }
//                                  used by the city, room.js, the study spots, construction cam and thumbnails (pose: stand | sit | walk | sleep | read)
//   buildDesk()         -> THREE.Group (desk, chair, lamp, laptop)        metres, the sitter faces +z
//   createCharacter({ scene, TR, kind, home, roofAt, butler, low, wake }) the city part (see manhattan.js)
import * as THREE from 'three';
import { Geo, rgb, shade, clamp } from './util.js';
import { MS, hdr } from './palette.js';
import { makeGlow } from './mh_glow.js';
import { SPOTS } from './spots/places.js';
import { buildPerson, accessoryGeo, DIM } from './human.js';

const SKIN = '#8d5a3b', HAIR = '#1d1714';
const WALK_MIN = 12;                                  // economy.CHARACTER_WALK_MINUTES
/** the user: warm brown skin, short black hair, dark brown eyes, an average build */
const USER = { skin: SKIN, hair: HAIR, hairStyle: 'short', iris: '#2a1a12', build: { sh: 1.0, ch: 1.0, wa: 0.97, hp: 0.97, bu: 0, be: 0, hs: 1, hw: 0.98, jaw: 1 }, seed: 7 };

/* ------------------------------------------------------------ outfits: each one is modelled (human.js reads these flags) */
export const OUTFIT_LOOK = {
  everyday:         { top: '#f1efe8', sleeve: 'short', bottom: '#3d5a80', shoes: '#f4f4f2', kind: 'tee' },                          // a tee, jeans, sneakers
  columbia_hoodie:  { top: '#9cc8ef', sleeve: 'long', bottom: '#5b6270', shoes: '#e8e8e4', hood: true, pocket: true, kind: 'hoodie' }, // hood, drawstrings, pocket
  nyu_hoodie:       { top: '#6a2c9a', sleeve: 'long', bottom: '#2e3440', shoes: '#f0f0ec', hood: true, pocket: true, kind: 'hoodie' },
  plain_jersey:     { top: '#f4f6fa', sleeve: 'none', bottom: '#f4f6fa', shorts: true, longShorts: true, shoes: '#20242c', trim: '#3a6fc4', socks: '#ffffff', kind: 'tank' },   // no logos
  running_gear:     { top: '#ff7a59', sleeve: 'short', bottom: '#1f232b', shorts: true, shoes: '#62dda8', headband: '#62dda8', socks: '#f2f2f2', kind: 'tee', shoe: 'runner' },
  library_cardigan: { top: '#d9c7a3', sleeve: 'long', bottom: '#6b4f3a', shoes: '#4a3526', shirt: '#f5f3ee', collar: true, buttons: 4, kind: 'sweater', shoe: 'dress' },
  winter_coat:      { top: '#3a3f47', sleeve: 'long', bottom: '#2a2d33', shoes: '#26211d', coat: '#3a3f47', scarf: '#c8243a', lapel: true, buttons: 3, shoe: 'dress' },
  navy_suit:        { top: '#1f2f55', sleeve: 'long', bottom: '#1f2f55', shoes: '#121318', shirt: '#f4f4f0', tie: '#7a1f2e', lapel: true, collar: true, buttons: 2, shoe: 'dress', kind: 'suit' },
  camel_overcoat:   { top: '#c19a6b', sleeve: 'long', bottom: '#2b2a2e', shoes: '#151515', coat: '#c19a6b', scarf: '#2a3346', lapel: true, buttons: 3, shoe: 'dress' },
  // chest-only (docs/COZY.md 4.6): a yellow raincoat with its hood down and boots, a varsity-style jacket with cream sleeves (no letters, no logos)
  yellow_raincoat:  { top: '#f2c230', sleeve: 'long', bottom: '#2e3440', shoes: '#e0ac1e', coat: '#f2c230', boots: '#e0ac1e', hood: true, zip: '#c99a1c', kind: 'raincoat', shoe: 'boot' },
  varsity_jacket:   { top: '#1f3a6b', sleeve: 'long', arm: '#efe8d8', bottom: '#3d4250', shoes: '#f4f4f2', trim: '#efe8d8', kind: 'varsity' },
};
export const lookOf = (id) => OUTFIT_LOOK[id] || OUTFIT_LOOK.everyday;

/* a Lambert material that keeps a little of its own colour after dark (vertex colour as a soft self-light), so the clothes still read at night */
const selfLight = { value: 0.18 };
let MAT = null;
export function figureMaterial() {
  if (MAT) return MAT;
  MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
  MAT.onBeforeCompile = (sh) => {
    sh.uniforms.uSelf = selfLight;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSelf;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uSelf;');
  };
  MAT.customProgramCacheKey = () => 'epoch-figure-1';
  return MAT;
}
export function setSelfLight(v) { selfLight.value = v; }

const mesh = (g, name) => { const m = new THREE.Mesh(g.build(), figureMaterial()); m.castShadow = false; if (name) m.name = name; return m; };
const nomotion = () => typeof document !== 'undefined' && !!document.documentElement && !!document.documentElement.classList && document.documentElement.classList.contains('nomotion');

/** the figure: about 1.76 m (7 heads), facing +z, feet at y = 0. Each body part is one smooth mesh on a pivot:
 *  body > spine (hips) > torso, neck > head (+ eyes that blink), shoulder > upper arm > elbow > forearm > wrist > hand;
 *  body > hip > thigh > knee > shin and shoe.
 *  setPose(name, phase) keeps the named poses of the city (stand | sit | walk | sleep | read); applyPose(P) takes the joint angles of the
 *  home life below (POSE_KEYS) and adds the life layer (breathing, blinking, the hands turning palm-down when reaching forward).
 *  hand / handL are the anchors a prop (a book, a cup) is held at. opts: { glasses, headphones, backpack, motion } */
export const POSE_KEYS = ['by', 'bz', 'brx', 'sx', 'sy', 'sz', 'nx', 'ny', 'nz', 'rax', 'ray', 'raz', 'rex', 'lax', 'lay', 'laz', 'lex', 'rhx', 'rhz', 'rkx', 'lhx', 'lhz', 'lkx'];
export const FIG_HIP = DIM.HIP;
export function buildFigure(outfitId = 'everyday', opts = {}) {
  const L = lookOf(outfitId), spec = { ...USER, look: L, glasses: opts.glasses || false };
  const { parts, eyeY } = buildPerson(spec, 'hi');
  const root = new THREE.Group(); root.name = 'figure';
  const body = new THREE.Group(); root.add(body);
  const spine = new THREE.Group(); spine.position.y = DIM.HIP; body.add(spine);
  const torso = mesh(parts.torso, 'torso'); spine.add(torso);                         // first mesh: the clothes (thumbnails and tests read it)
  const neck = new THREE.Group(); neck.position.y = DIM.NECK_Y; spine.add(neck);
  neck.add(mesh(parts.head, 'head'));
  const eyes = mesh(parts.eyes, 'eyes'); eyes.position.y = eyeY; neck.add(eyes);
  const arms = [], elbows = [], wrists = [], hands = [];
  [-1, 1].forEach((s, i) => {
    const piv = new THREE.Group(); piv.position.set(s * DIM.SH_X, DIM.SH_Y, 0); piv.add(mesh(parts.upper[i])); spine.add(piv); arms.push(piv);
    const el = new THREE.Group(); el.position.y = -DIM.UPPER; el.add(mesh(parts.fore[i])); piv.add(el); elbows.push(el);
    const wr = new THREE.Group(); wr.position.y = -DIM.FORE; wr.add(mesh(parts.hand[i])); el.add(wr); wrists.push(wr);
    const hand = new THREE.Group(); hand.position.y = -DIM.HAND_AT; el.add(hand); hands.push(hand);
  });
  const legs = [];
  [-1, 1].forEach((s, i) => {
    const hip = new THREE.Group(); hip.position.set(s * DIM.HIP_X, DIM.HIP, 0); hip.add(mesh(parts.thigh[i]));
    const knee = new THREE.Group(); knee.position.y = -DIM.THIGH; knee.add(mesh(parts.shin[i])); hip.add(knee);
    body.add(hip); legs.push({ hip, knee });
  });
  // accessories, built the first time they are shown
  const acc = {};
  function setAccessory(name, on) {
    if (!acc[name] && !on) return;
    if (!acc[name]) { const m = mesh(accessoryGeo(name, { ...spec, glasses: opts.glasses || true }), name); (name === 'backpack' ? spine : neck).add(m); acc[name] = m; }
    acc[name].visible = !!on;
  }
  for (const k of ['glasses', 'headphones', 'backpack']) if (opts[k]) setAccessory(k, true);
  let motion = opts.motion !== false;
  const t0 = (performance.now() / 1000) + Math.random() * 10;

  /** joint angles (radians) and body offsets: r* = the figure's right side (x < 0), l* = its left */
  function applyPose(P) {
    const v = (k) => P[k] || 0;
    body.position.set(0, v('by'), v('bz')); body.rotation.set(v('brx'), 0, 0);
    spine.rotation.set(v('sx'), v('sy'), v('sz')); neck.rotation.set(v('nx'), v('ny'), v('nz'));
    // arms hang a touch away from the hips, elbows soft
    arms[0].rotation.set(v('rax'), v('ray'), v('raz') - 0.05); elbows[0].rotation.set(v('rex') - 0.07, 0, 0);
    arms[1].rotation.set(v('lax'), v('lay'), v('laz') + 0.05); elbows[1].rotation.set(v('lex') - 0.07, 0, 0);
    // the forearm turns the palm down as the hand reaches forward (typing, the piano), and back toward the body as it hangs
    for (const [i, ax, ex, az] of [[0, v('rax'), v('rex'), v('raz')], [1, v('lax'), v('lex'), v('laz')]]) {
      const s = i ? 1 : -1, reach = clamp(-(ax + ex) / 1.5, 0, 1) * (1 - clamp(Math.abs(az) / 2.2, 0, 1));
      wrists[i].rotation.set(0, -s * reach * 1.3, 0);
    }
    legs[0].hip.rotation.set(v('rhx'), 0, v('rhz')); legs[0].knee.rotation.set(v('rkx'), 0, 0);
    legs[1].hip.rotation.set(v('lhx'), 0, v('lhz')); legs[1].knee.rotation.set(v('lkx'), 0, 0);
    life(v('brx') < -1);
  }
  /** breathing and blinking: from the clock, so every caller that re-poses each frame gets them; none under reduced motion */
  function life(asleep) {
    if (!motion || nomotion()) { torso.scale.set(1, 1, 1); eyes.scale.y = asleep ? 0.1 : 1; return; }
    const t = performance.now() / 1000 - t0, b = Math.sin(t * (asleep ? 1.15 : 1.6));
    torso.scale.set(1 + 0.005 * b, 1 + 0.004 * b, 1 + 0.014 * b);
    arms[0].position.y = arms[1].position.y = DIM.SH_Y + 0.0025 * b;
    if (asleep) { eyes.scale.y = 0.1; return; }
    const c = t % 4.3, d = (t + 1.9) % 11.7;                         // a blink every 4.3 s, and now and then a double one
    const k = c < 0.14 ? Math.sin((c / 0.14) * Math.PI) : d < 0.12 ? Math.sin((d / 0.12) * Math.PI) : 0;
    eyes.scale.y = 1 - 0.9 * k;
  }
  let pose = '';
  function setPose(p, phase = 0) {
    pose = p;
    applyPose(namedPose(p, phase));
  }
  setPose('stand');
  return {
    root, setPose, applyPose, get pose() { return pose; }, hand: hands[0], handL: hands[1], head: neck,
    setAccessory, setMotion(m) { motion = m !== false; },
    dispose() { root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); },
  };
}
/** the named poses as joint angles (the city and the cutaway room use these). Seated: thighs just below level so the feet reach the floor. */
export function namedPose(p, phase = 0) {
  const P = {};
  if (p === 'sit') {
    P.by = 0.53 - FIG_HIP;                                                                  // seat height 0.46 m
    P.rhx = P.lhx = -Math.PI / 2 + 0.15; P.rkx = P.lkx = Math.PI / 2 - 0.15;
    P.rax = P.lax = -0.78; P.rex = P.lex = -0.7;                                            // hands on the desk
    P.sx = 0.06;
  } else if (p === 'walk') {
    const sw = Math.sin(phase);
    P.rhx = sw * 0.45; P.lhx = -sw * 0.45;
    P.rkx = Math.max(0, -Math.cos(phase)) * 0.62 + 0.04; P.lkx = Math.max(0, Math.cos(phase)) * 0.62 + 0.04;
    P.rax = -sw * 0.36; P.lax = sw * 0.36; P.rex = -0.16 - 0.22 * Math.max(0, sw); P.lex = -0.16 - 0.22 * Math.max(0, -sw);
    P.by = Math.abs(Math.cos(phase)) * 0.022 - 0.012; P.sy = sw * 0.06; P.ny = -sw * 0.04; P.sx = 0.03;
  } else if (p === 'sleep') {
    P.brx = -Math.PI / 2; P.by = 0.12; P.bz = 0.87;                                         // on the back, centred, head toward -z
    P.raz = -0.05; P.laz = 0.05; P.rex = P.lex = -0.25; P.rkx = P.lkx = 0.08;
  } else if (p === 'read') {
    P.rax = P.lax = -0.7; P.rex = P.lex = -0.6;
  }
  return P;
}

/* ------------------------------------------------------------ the study desk: desk, chair, lamp (a warm glow), laptop and a notebook */
let GLOW_MAT = null;
export function glowMaterial() { if (!GLOW_MAT) GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); return GLOW_MAT; }
export function buildDesk() {
  const g = new Geo(), wood = rgb('#8a5a3a'), dark = rgb('#2b2f38'), grey = rgb('#9aa4b5');
  // the sitter is at z = 0 facing +z: the desk is in front, the chair under them
  g.box(-0.55, 0.72, 0.28, 0.55, 0.76, 0.86, wood, { bottom: true });
  for (const [x, z] of [[-0.5, 0.33], [0.5, 0.33], [-0.5, 0.81], [0.5, 0.81]]) g.box(x - 0.025, 0, z - 0.025, x + 0.025, 0.72, z + 0.025, shade(wood, 0.8));
  g.box(-0.22, 0.44, -0.2, 0.22, 0.48, 0.2, dark);                                           // chair seat
  g.box(-0.22, 0.48, -0.24, 0.22, 0.95, -0.2, dark);                                         // chair back
  for (const [x, z] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) g.box(x - 0.018, 0, z - 0.018, x + 0.018, 0.44, z + 0.018, grey);
  g.box(-0.16, 0.76, 0.42, 0.16, 0.775, 0.64, grey);                                         // laptop base
  g.quad([-0.16, 0.775, 0.64], [0.16, 0.775, 0.64], [0.16, 0.99, 0.7], [-0.16, 0.99, 0.7], rgb('#3f4b60'));
  g.quad([0.16, 0.775, 0.64], [-0.16, 0.775, 0.64], [-0.16, 0.99, 0.7], [0.16, 0.99, 0.7], rgb('#3f4b60'));
  g.box(0.22, 0.76, 0.4, 0.4, 0.78, 0.62, rgb('#e9e2d2'));                                   // notebook
  g.box(-0.46, 0.76, 0.66, -0.36, 0.78, 0.78, dark);                                         // lamp base
  g.bar([-0.41, 0.78, 0.72], [-0.36, 1.12, 0.62], 0.02, dark);
  const desk = new THREE.Mesh(g.build(), figureMaterial());
  const gl = new Geo(); gl.cyl(-0.33, 0.6, 1.02, 1.12, 0.1, 0.05, 8, hdrArr(MS.lamp, 1.6), { bottom: true });
  gl.box(-0.14, 0.79, 0.66, 0.14, 0.97, 0.672, hdrArr('#9fd0ff', 1.2), { top: false, sides: 2 });   // the screen's glow, facing the sitter
  const glow = new THREE.Mesh(gl.build(), glowMaterial());
  const grp = new THREE.Group(); grp.add(desk, glow); grp.name = 'desk';
  return grp;
}
function hdrArr(hex, k) { const c = hdr(hex, k); return [c.r, c.g, c.b]; }

/* ------------------------------------------------------------ the city part */
// kind: 'city' (World > City), 'week' (the Today hero), 'cam' (the focus construction cam)
export function createCharacter({ scene, TR, kind, home, roofAt, butler, low, trees = null, wake = () => {} }) {
  const grp = new THREE.Group(); grp.name = 'character'; grp.visible = false; scene.add(grp);
  let fig = null, outfit = '', desk = buildDesk(); desk.visible = false; grp.add(desk);
  const lamp = makeGlow(1); lamp.add(-0.33, 1.06, 0.6, 1.6, 1.15, 0.6, 1.4); lamp.commit(); lamp.points.visible = false; grp.add(lamp.points);   // the desk lamp, so a study block reads from afar
  const state = { econ: 'home', since: null, home: null, consOn: false, consEndAt: 0, walkLocal: 0, spot: 'butler', pin: 'Studying at Butler' };
  let butlerSpot = null, homeDoor = null, route = null, phase = 0, lastAnim = 0, motion = true;
  const tmp = new THREE.Vector3();

  /* the World view while studying (docs/COZY.md 4.5): no figure outside; the spot's building gets warm windows and a "Studying at ..." pin */
  let mark = null, markKey = '';
  function pinTexture(text) {
    const cv = document.createElement('canvas'), x = cv.getContext('2d'), F = 'bold 30px "Nunito", system-ui, sans-serif';
    x.font = F; const w = Math.ceil(x.measureText(text).width) + 78, h = 56; cv.width = w; cv.height = h;
    x.font = F; x.fillStyle = 'rgba(8,26,51,0.88)'; x.beginPath(); x.roundRect(1, 1, w - 2, h - 2, 18); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#8cc4ee'; x.beginPath(); x.arc(30, 23, 10, Math.PI, 0); x.lineTo(30, 42); x.closePath(); x.fill();
    x.fillStyle = 'rgba(8,26,51,1)'; x.beginPath(); x.arc(30, 23, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(text, 50, h / 2 + 1);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return { t, aspect: w / h };
  }
  function studyMark() {
    if (!mark) {
      const g = new THREE.Group(); g.name = 'studying-at';
      const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.85), toneMapped: false, side: THREE.DoubleSide });
      const wins = new THREE.Group(); for (let i = -2; i <= 2; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), wm); q.position.x = i * 4.2; wins.add(q); }
      const sm = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
      const pin = new THREE.Sprite(sm); pin.renderOrder = 999; pin.center.set(0.5, 0);
      g.add(wins, pin); mark = { g, wins, pin, wm, sm, aspect: 4 };
    }
    return mark;
  }
  function spotWhere() {
    const id = state.spot || 'butler', sp = SPOTS[id] && SPOTS[id].city;
    if (id === 'butler' && butler) return { x: butler.x, z: butler.z, tx: low ? low.x : butler.x, tz: low ? low.z : butler.z + 50 };
    if (sp && sp.home && state.home) return { x: +state.home.x, z: +state.home.z, tx: +state.home.x, tz: +state.home.z + 60, roof: true };
    if (sp && isFinite(sp.x)) return { x: sp.x, z: sp.z, tx: sp.x, tz: sp.z + 60, roof: !!sp.roof || !(SPOTS[id].building) };
    return butler ? { x: butler.x, z: butler.z, tx: butler.x, tz: butler.z + 50 } : null;
  }
  function showStudying(camera) {
    const w = spotWhere(); if (!w) return false;
    const m = studyMark(); if (m.g.parent !== grp) grp.add(m.g);
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0); grp.scale.setScalar(1);
    if (fig) fig.root.visible = false;
    const key = (state.spot || '') + '|' + w.x + '|' + w.z + '|' + state.pin;
    if (key !== markKey) {
      markKey = key;
      const ground = TR.ground(w.x, w.z), roof = Math.max(ground + 6, roofAt(w.x, w.z, 4));
      // the windows on the facade that faces the open side (Low Library for Butler, else south); none for an open-air spot
      const f = w.roof ? null : outside(w.x, w.z, w.tx, w.tz, -0.3);
      m.wins.visible = !!f;
      if (f) { m.wins.position.set(f.x, ground + (roof - ground) * 0.5, f.z); m.wins.rotation.set(0, f.face + Math.PI, 0); }
      m.pin.position.set(w.x, roof + 8, w.z);
      if (m.sm.map) m.sm.map.dispose();
      const tx = pinTexture(state.pin || 'Studying'); m.sm.map = tx.t; m.sm.needsUpdate = true; m.aspect = tx.aspect;
    }
    m.g.visible = true;
    const k = 0.042; m.pin.scale.set(k * m.aspect, k, 1);
    if (camera) { const d = camera.position.distanceTo(m.wins.getWorldPosition(tmp)); m.wins.scale.setScalar(clamp(d / 260, 1, 6)); }
    return false;
  }

  function wear(id) {
    if (id === outfit && fig) return;
    if (fig) { grp.remove(fig.root); fig.dispose(); }
    outfit = id; fig = buildFigure(id); grp.add(fig.root);
  }
  wear('everyday');

  // walk out of a building toward (tx, tz) until the roofs drop to the street: the spot just outside its facade
  function outside(x, z, tx, tz, extra) {
    const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    let d = 0;
    for (; d < 160; d += 2) { const px = x + ux * d, pz = z + uz * d; if (roofAt(px, pz, 2) < TR.ground(px, pz) + 2.5) break; }
    return { x: x + ux * (d + extra), z: z + uz * (d + extra), face: Math.atan2(-ux, -uz) };
  }
  function ensureSpots() {
    if (!butlerSpot && butler && low) butlerSpot = outside(butler.x, butler.z, low.x, low.z, 7);
    if (state.home && !homeDoor) {
      const to = butlerSpot || { x: state.home.x + 100, z: state.home.z };
      homeDoor = outside(state.home.x, state.home.z, to.x, to.z, 3);
    }
    if (!route && butlerSpot && homeDoor) route = makeRoute(butlerSpot, homeDoor);
  }
  // the walk home keeps to the street: a shortest path over a 4 m grid of the roof heights (cells under a roof are walls), found once
  function makeRoute(a, b) {
    const S = 4, pad = 160, x0 = Math.min(a.x, b.x) - pad, z0 = Math.min(a.z, b.z) - pad, nx = Math.ceil((Math.abs(a.x - b.x) + 2 * pad) / S), nz = Math.ceil((Math.abs(a.z - b.z) + 2 * pad) / S);
    const N = nx * nz, wall = new Uint8Array(N), dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * S, z = z0 + (j + 0.5) * S; wall[j * nx + i] = roofAt(x, z, 1) > TR.ground(x, z) + 3 ? 1 : 0; }
    const cell = (p) => clamp(Math.floor((p.z - z0) / S), 0, nz - 1) * nx + clamp(Math.floor((p.x - x0) / S), 0, nx - 1);
    const s0 = cell(a), s1 = cell(b); wall[s0] = 0; wall[s1] = 0;
    // a small binary heap of [cost, cell]
    const H = []; const push = (c, k) => { H.push([c, k]); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
    const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return top; };
    dist[s0] = 0; push(0, s0);
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false, guard = 0;
    while (H.length && guard++ < N * 4) {
      const [c, k] = pop(); if (c > dist[k]) continue; if (k === s1) { found = true; break; }
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj, w] of NB) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const q = jj * nx + ii; if (wall[q]) continue; const nc = c + w; if (nc < dist[q]) { dist[q] = nc; prev[q] = k; push(nc, q); } }
    }
    let pts;
    if (found) {
      pts = []; for (let k = s1; k >= 0; k = prev[k]) { const i = k % nx, j = (k - i) / nx; pts.push([x0 + (i + 0.5) * S, z0 + (j + 0.5) * S]); if (k === s0) break; }
      pts.reverse(); pts[0] = [a.x, a.z]; pts[pts.length - 1] = [b.x, b.z];
      // keep every 3rd point (smoother turns), and the ends
      pts = pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1);
    } else pts = [[a.x, a.z], [b.x, b.z]];
    const segs = []; let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (l < 1e-3) continue; segs.push({ p: pts[i], q: pts[i + 1], l }); total += l; }
    if (!segs.length) segs.push({ p: [a.x, a.z], q: [b.x, b.z], l: 1 });
    return { segs, total: Math.max(total, 1) };
  }
  function along(r, d) {
    for (const s of r.segs) { if (d <= s.l || s === r.segs[r.segs.length - 1]) { const t = s.l ? clamp(d / s.l, 0, 1) : 1; return { x: s.p[0] + (s.q[0] - s.p[0]) * t, z: s.p[1] + (s.q[1] - s.p[1]) * t, dir: Math.atan2(s.q[0] - s.p[0], s.q[1] - s.p[1]) }; } d -= s.l; }
    return null;
  }
  // beside today's lot, on its sidewalk (world metres from the lot's own frame), at the spot with the most room from the street trees
  // (a tree crown between the camera and the figure would hide it)
  const spotCache = new Map();
  function clearance(x, z) {
    if (!trees) return 99;
    let m = 99; const a = trees.a;
    for (let i = 0; i < trees.n; i++) { const dx = a[4 * i] - x, dz = a[4 * i + 2] - z; if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue; m = Math.min(m, Math.hypot(dx, dz) - (a[4 * i + 3] || 3)); }
    return m;
  }
  function lotSpot(off = 0) {
    const l = (home && (home.todayLot() || home.slotLots.find((q) => q.slot >= 0) || home.slotLots[0])) || null; if (!l) return null;
    let k = spotCache.get(l.k);
    if (!k) {
      let best = -1e9;
      for (const fa of [0.62, -0.62, 0.88, -0.88, 0.38, -0.38]) for (const b of [l.hd + 2.4, l.hd + 3.6]) {
        const x = l.x + l.rx * l.hw * fa + l.fx * b, z = l.z + l.rz * l.hw * fa + l.fz * b, sc = Math.min(clearance(x, z), 12) - Math.abs(fa) * 0.5;
        if (sc > best) { best = sc; k = { a: l.hw * fa, b }; }
      }
      spotCache.set(l.k, k);
    }
    const a = k.a + off, b = k.b;
    return { x: l.x + l.rx * a + l.fx * b, z: l.z + l.rz * a + l.fz * b, th: l.th, rx: l.rx, rz: l.rz, fx: l.fx, fz: l.fz, lot: l };
  }

  /** the routine right now: the server's state, with the live focus block (the construction cam) taking over between refreshes */
  function current(nowMs) {
    let s = state.econ, since = state.since;
    if (state.consOn) return { s: 'studying', since: null };
    if (state.walkLocal && nowMs - state.walkLocal < WALK_MIN * 60000 && s !== 'asleep') { s = 'walking_home'; since = state.walkLocal; }
    if (s === 'walking_home' && since && nowMs - since > WALK_MIN * 60000) s = 'home';
    return { s, since };
  }

  function place(x, z, yaw, pose, ph = 0) {
    grp.position.set(x, TR.ground(x, z) + 0.05, z); grp.rotation.y = yaw;
    fig.setMotion(motion);
    if (fig.pose !== pose || pose === 'walk') fig.setPose(pose, ph);
    // a backpack on the walk home, headphones while studying (docs/COZY.md 3b)
    fig.setAccessory('backpack', st === 'walking_home'); fig.setAccessory('headphones', st === 'studying');
  }

  let st = 'home';
  /** one step: returns true while the walk animation needs frames */
  function update(dt, nowSec, mot, camera) {
    motion = mot;
    ensureSpots();
    const nowMs = Date.now(), c = current(nowMs); st = c.s;
    desk.visible = false; lamp.points.visible = false; grp.visible = true;
    if (mark) mark.g.visible = false;
    if (fig) fig.root.visible = true;
    let anim = false;
    if (st === 'asleep') { grp.visible = false; return false; }
    if (st === 'studying' && kind === 'city') return showStudying(camera);     // inside the spot: the figure is not out on the street
    if (st === 'studying') {
      const sp = kind === 'city' && butlerSpot ? { x: butlerSpot.x, z: butlerSpot.z, yaw: butlerSpot.face + Math.PI / 2 } : (() => { const q = lotSpot(); return q && { x: q.x, z: q.z, yaw: q.th + Math.PI / 2 }; })();
      if (!sp) { grp.visible = false; return false; }
      place(sp.x, sp.z, sp.yaw, 'sit'); desk.visible = true; lamp.points.visible = true;
    } else if (st === 'walking_home') {
      const el = c.since ? Math.max(0, nowMs - c.since) / 1000 : 0;
      if (kind === 'city' && route) {
        const k = clamp(el / (WALK_MIN * 60), 0, 1), p = along(route, k * route.total);
        phase = motion ? nowSec * 7.5 : 0; place(p.x, p.z, p.dir, motion ? 'walk' : 'stand', phase); anim = motion;
      } else {
        const q = lotSpot(); if (!q) { grp.visible = false; return false; }
        const span = 34, d = (el * 1.25) % (2 * span), off = d < span ? d : 2 * span - d, dir = d < span ? 1 : -1;
        const x = q.x + q.rx * (off - 6), z = q.z + q.rz * (off - 6), yaw = Math.atan2(q.rx * dir, q.rz * dir);
        phase = motion ? nowSec * 7.5 : 0; place(x, z, yaw, motion ? 'walk' : 'stand', phase); anim = motion;
      }
    } else {
      const q = lotSpot(); if (!q) { grp.visible = false; return false; }
      place(q.x, q.z, q.th + 0.5, 'stand');
    }
    // a diorama figure: a little larger than life as the camera pulls back, so it still reads on the Today hero
    if (camera) { const d = camera.position.distanceTo(tmp.copy(grp.position)); grp.scale.setScalar(clamp(d / (kind === 'city' ? 60 : kind === 'cam' ? 38 : 52), 1.6, kind === 'city' ? 5 : 6)); }
    if (anim) { const vis = camera ? grp.position.distanceTo(camera.position) < 2600 : true; if (!vis) anim = false; }
    if (anim && nowSec - lastAnim < 0.08) return true;
    lastAnim = nowSec;
    return anim;
  }

  return {
    group: grp,
    get state() { return st; },
    setEconomy(e) {
      if (!e) return;
      const ch = e.character || {};
      state.econ = ch.state || 'home'; state.since = ch.since ? Date.parse(ch.since) : null;
      const spotId = ch.spot || (ch.state === 'studying' ? ch.location : null);
      if (spotId && spotId !== state.spot) { state.spot = spotId; markKey = ''; } if (ch.pin && ch.pin !== state.pin) { state.pin = ch.pin; markKey = ''; }
      if (state.econ !== 'walking_home' && state.econ !== 'home') state.walkLocal = 0;
      if (e.home && (!state.home || state.home.bin !== e.home.bin)) { state.home = e.home; homeDoor = null; route = null; }
      wear(e.outfit || 'everyday');
      wake();
    },
    /** the focus screen's construction state: a running work block means "studying" right now */
    setConstruction(c) {
      const on = !!(c && (c.active || c.paused) && c.phase !== 'break' && c.phase !== 'topout');
      if (state.consOn && !on) state.walkLocal = Date.now();
      state.consOn = on; wake();
    },
    homeDoor: () => { ensureSpots(); return homeDoor; },
    butlerSpot: () => { ensureSpots(); return butlerSpot; },
    update,
    setSelf(v) { setSelfLight(v); },
    setPx(px) { lamp.setPx(px); },
  };
}

/* ============================================================ home life (docs/COZY.md 4.4): activities at home and live reactions
 * createLife({ parent, outfit, motion, hooks }) puts a figure in a room and runs it:
 *   setWorld({ spots, boxes, door, camera() })   where each activity happens (room.js computes them from the placed furniture):
 *        spots[activityId] = { x, z, yaw, mode: 'sit'|'stand'|'kneel'|'bed', seat, ax, az (approach point), item, typing, standDesk }
 *        boxes = footprints [x0, x1, z0, z1, itemId] the walk avoids
 *   setMacro('home'|'asleep'|'studying'|'walking_home')   setActivities([ids])   setNight(bool)   setMotion(bool)   wear(outfit)
 *   react(name) -> Promise   the one-shot reactions below; they interrupt the activity, play, then the activity resumes
 *   update(dt, nowMs) -> true while it needs frames (a loop, a walk, a reaction)
 *   activity() -> { id, label }   for the scene summary
 * The activity is a weighted pick seeded by the day and the minute (so a visit now and one a minute later agree), held 30-90 s.
 * Each activity is a 2-6 s procedural loop on the hinge pivots, entered and left with a 0.4 s blend. Reduced motion: static poses, no
 * walking (the figure is simply placed), reactions show one still pose for their duration. The face stays calm and subtle: no cartoon expressions. */
const PI = Math.PI;
const ACT_LABEL = { read: 'reading', water_plants: 'watering the plants', look_outside: 'looking out of the window', make_tea: 'making tea',
  play_piano: 'playing the piano', play_records: 'playing records', browse_records: 'flipping through records', stargaze: 'stargazing',
  work_desk: 'working at the desk', type: 'typing', sleep: 'asleep' };
const ACT_WEIGHT = { read: 3, work_desk: 3, type: 2, look_outside: 1.6, make_tea: 1.5, water_plants: 1.2, play_piano: 2.2, play_records: 2.2, browse_records: 1, stargaze: 2.5 };
const typing = (t) => ({ sx: 0.14, nx: 0.32, rax: -0.62, rex: -0.92 + 0.08 * Math.sin(t * 13), lax: -0.62, lex: -0.92 + 0.08 * Math.sin(t * 13 + 1.7), raz: 0.1, laz: -0.1 });
const ACTS = {
  read: { prop: 'book', f: (t) => { const k = (t % 6) < 0.7 ? Math.sin(((t % 6) / 0.7) * PI) : 0; return { sx: 0.1, nx: 0.42 + 0.03 * Math.sin(t * 0.7), rax: -0.72, rex: -1.2, raz: 0.18, lax: -0.72 - 0.3 * k, lex: -1.2 + 0.35 * k, laz: -0.18 - 0.2 * k }; }, page: 6 },
  water_plants: { prop: 'can', f: (t) => { const k = 0.5 + 0.5 * Math.sin(t * 1.4); return { sx: 0.14, nx: 0.38, rax: -0.95 - 0.2 * k, rex: -0.3, raz: 0.05, lax: 0.05, lex: -0.2, propTilt: 0.15 + 0.75 * k }; } },
  look_outside: { f: (t) => ({ nx: -0.08, sz: 0.035 * Math.sin(t * 0.5), sy: 0.05 * Math.sin(t * 0.21), rax: 0.15, rex: -0.35, lax: 0.15, lex: -0.35, raz: 0.08, laz: -0.08 }) },
  make_tea: { prop: 'cup', steam: true, f: (t) => { const s = Math.pow(Math.max(0, Math.sin(t * 1.25)), 3); return { rax: -0.5 - 0.45 * s, rex: -1.5 - 0.55 * s, raz: 0.1, nx: 0.12 - 0.3 * s, lax: -0.35, lex: -0.9, laz: -0.12 }; } },
  play_piano: { glints: true, f: (t) => ({ sx: 0.12, nx: 0.28, rax: -0.82 + 0.12 * Math.sin(t * 7), rex: -0.6, raz: 0.12 + 0.07 * Math.sin(t * 2.1), lax: -0.82 + 0.12 * Math.sin(t * 7 + PI), lex: -0.6, laz: -0.12 + 0.07 * Math.sin(t * 2.1), sz: 0.05 * Math.sin(t * 1.2) }) },
  play_records: { spin: true, f: (t) => ({ sz: 0.08 * Math.sin(t * 2.2), nz: 0.07 * Math.sin(t * 2.2), nx: 0.08 + 0.07 * Math.sin(t * 4.4), rax: 0.12 * Math.sin(t * 2.2), lax: -0.12 * Math.sin(t * 2.2), raz: 0.18, laz: -0.18, rex: -0.45, lex: -0.45, by: 0.014 * Math.abs(Math.sin(t * 2.2)) }) },
  browse_records: { f: (t) => { const k = (t % 2.2) < 0.45 ? Math.sin(((t % 2.2) / 0.45) * PI) : 0; return { sx: 0.32, nx: 0.42, rax: -0.95 - 0.35 * k, rex: -0.35, lax: -0.75, lex: -0.6 }; } },
  stargaze: { f: (t) => ({ sx: 0.34, nx: 0.22, rax: -1.25, rex: -0.45, lax: -0.45, lex: -0.85, sz: 0.02 * Math.sin(t * 0.4) }) },
  work_desk: { f: typing },
  type: { f: typing },
  sleep: { f: (t) => ({ by: 0.12 + 0.006 * Math.sin(t * 1.5), raz: -0.05, laz: 0.05 }) },
};
// reactions: dur in seconds; face: turn toward the camera or the window; full: uses the legs too (seated, the upper body only)
const REACTS = {
  wave: { dur: 1.2, face: 'camera', f: (t) => ({ raz: -2.55 + 0.3 * Math.sin(t * 11), rex: -0.45, nz: 0.08 }) },
  nod: { dur: 1.0, face: 'camera', f: (t) => { const k = Math.max(0, Math.sin(t * 9)); return { rax: -1.25 - 0.4 * k, rex: -1.9, raz: 0.15, nx: 0.2 * k }; } },
  cheer: { dur: 1.4, face: 'camera', sparkles: 6, f: (t) => ({ raz: -2.75, laz: 2.75, rex: -0.25, lex: -0.25, nx: -0.22, by: 0.06 * Math.abs(Math.sin(t * 7)) }) },
  point: { dur: 1.6, face: 'window', flash: 'tower', f: (t) => ({ rax: -2.05 - 0.05 * Math.sin(t * 6), rex: -0.05, raz: -0.12, lax: 0.05, nx: -0.18 }) },
  crown: { dur: 2.0, face: 'camera', full: true, flash: 'crown', sparkles: 10, f: (t) => { const j = Math.abs(Math.sin(t * 6)); return { by: 0.13 * j, rhx: -0.25 * j, lhx: -0.25 * j, rkx: 0.45 * j, lkx: 0.45 * j, raz: -2.6 + 0.25 * Math.sin(t * 12), laz: 2.6 - 0.25 * Math.sin(t * 12), rex: -0.3, lex: -0.3, nx: -0.25 }; } },
  output: { dur: 1.6, face: 'camera', prop: 'paper', f: (t) => ({ rax: -2.6, rex: -0.35, lax: -2.6, lex: -0.35, raz: 0.12, laz: -0.12, sx: -0.08, nx: -0.28, by: 0.02 * Math.abs(Math.sin(t * 5)) }) },
  mission: { dur: 1.0, face: 'camera', f: (t) => ({ rax: -1.0, rex: -1.5, ray: -0.4, raz: 0.1, nx: 0.14 * Math.sin(t * 7) }) },
  chest: { dur: 1.5, go: 'chest', full: true, f: (t) => ({ by: -0.42, rhx: -1.5, rkx: 1.5, lhx: 0.15, lkx: 1.65, sx: 0.28, nx: 0.3, rax: -0.95, rex: -0.4, lax: -0.95, lex: -0.4 }) },
  dance: { dur: 2.5, face: 'camera', full: true, spin: true, f: (t) => { const b = Math.sin(t * 7.5); return { by: 0.04 * Math.abs(b), sz: 0.12 * b, nz: -0.1 * b, raz: -1.4 + 0.7 * Math.sin(t * 7.5), laz: 1.4 + 0.7 * Math.sin(t * 7.5 + PI), rex: -0.8, lex: -0.8, rhz: 0.08 * b, lhz: 0.08 * b, rkx: 0.25 * Math.max(0, b), lkx: 0.25 * Math.max(0, -b) }; } },
  yawn: { dur: 1.2, f: (t) => { const k = Math.sin(Math.min(1, t / 1.2) * PI); return { raz: -2.6 * k, laz: 2.6 * k, rex: -0.65 * k, lex: -0.65 * k, nx: -0.42 * k, sx: -0.07 * k }; } },
  look_up: { dur: 0.8, face: 'camera', f: () => ({ nx: -0.3, sx: -0.05, raz: 0.1, laz: -0.1 }) },
};
export const REACTIONS = Object.keys(REACTS);
const LOWER = ['by', 'bz', 'brx', 'rhx', 'rhz', 'rkx', 'lhx', 'lhz', 'lkx'];
const sitP = (seat = 0.46) => ({ by: seat + 0.07 - FIG_HIP, rhx: -PI / 2 + 0.15, lhx: -PI / 2 + 0.15, rkx: PI / 2 - 0.15, lkx: PI / 2 - 0.15 });
const kneelP = () => ({ by: -0.42, rhx: -1.5, rkx: 1.5, lhx: 0.15, lkx: 1.65 });
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrapA = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };

/* props, held in the right hand (a book open in both hands, a cup, a watering can, a sheet of paper) */
function buildProp(kind) {
  const g = new Geo();
  if (kind === 'book') { g.box(-0.13, -0.01, -0.02, 0.0, 0.0, 0.17, rgb('#f2ecdc')); g.box(0.0, -0.01, -0.02, 0.13, 0.0, 0.17, rgb('#ede5d0')); g.box(-0.135, -0.025, -0.025, 0.135, -0.01, 0.175, rgb('#2f4d6e')); }
  else if (kind === 'cup') { g.cyl(0, 0, -0.02, 0.08, 0.04, 0.045, 8, rgb('#f2f8ff')); g.box(0.04, 0.0, -0.01, 0.07, 0.05, 0.01, rgb('#f2f8ff')); }
  else if (kind === 'can') { g.box(-0.07, -0.05, -0.06, 0.07, 0.11, 0.06, rgb('#3f8f5e')); g.bar([0, 0.06, 0.05], [0, 0.12, 0.2], 0.018, rgb('#3f8f5e')); g.bar([-0.05, 0.11, 0], [0.05, 0.11, 0], 0.012, rgb('#2b2f38')); }
  else if (kind === 'paper') { g.box(-0.16, -0.03, -0.005, 0.16, 0.2, 0.005, rgb('#f8f6ef')); for (let k = 0; k < 5; k++) g.box(-0.12, 0.13 - k * 0.03, 0.006, 0.08 - (k % 2) * 0.05, 0.14 - k * 0.03, 0.008, rgb('#9aa4b5'), { top: false }); }
  const m = new THREE.Mesh(g.build(), figureMaterial()); m.name = 'prop-' + kind; return m;
}

/* tiny particle effects (sparkles, tea steam, piano glints): one Points cloud, additive, no textures */
function makeFx(parent) {
  const N = 72, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), P = [];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; parent.add(pts);
  for (let i = 0; i < N; i++) P.push({ life: 0 });
  const free = () => P.find((p) => p.life <= 0);
  function emit(x, y, z, vx, vy, vz, life, c, grav = 0) { const p = free(); if (!p) return; Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, c, grav }); }
  return {
    sparkle(x, y, z, n = 6, hex = '#ffe3a0') { const c = hdr(hex, 2.2); for (let i = 0; i < n; i++) { const a = (i / n) * 2 * PI + Math.random() * 0.4; emit(x, y, z, Math.cos(a) * 0.9, 1.1 + Math.random() * 0.7, Math.sin(a) * 0.9, 0.9 + Math.random() * 0.3, c, -2.2); } },
    steam(x, y, z) { emit(x + (Math.random() - 0.5) * 0.03, y, z + (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.04, 0.18 + Math.random() * 0.06, (Math.random() - 0.5) * 0.04, 1.4, hdr('#cfd8e6', 0.55), 0); },
    glint(x, y, z) { emit(x, y, z, (Math.random() - 0.5) * 0.12, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.08, 0.8, hdr(Math.random() < 0.5 ? '#ffe3a0' : '#a8d4ff', 1.8), 0); },
    update(dt) {
      let live = 0;
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (p.life > 0) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; live++; }
        const k = p.life > 0 ? Math.min(1, p.life / (p.max * 0.5)) : 0;
        pos[i * 3] = p.life > 0 ? p.x : 0; pos[i * 3 + 1] = p.life > 0 ? p.y : -50; pos[i * 3 + 2] = p.life > 0 ? p.z : 0;
        col[i * 3] = p.life > 0 ? p.c.r * k : 0; col[i * 3 + 1] = p.life > 0 ? p.c.g * k : 0; col[i * 3 + 2] = p.life > 0 ? p.c.b * k : 0;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; pts.visible = live > 0;
      return live > 0;
    },
    dispose() { parent.remove(pts); geo.dispose(); mat.dispose(); },
  };
}

export function createLife(o = {}) {
  const parent = o.parent, hooks = o.hooks || {};
  const grp = new THREE.Group(); grp.name = 'life'; parent.add(grp);
  let fig = null, outfit = '', motion = o.motion !== false, night = false, macro = 'home', hidden = false;   // hidden: a real person (city/people.js, ?people=1) stands in for the figure
  let world = { spots: {}, boxes: [], door: null, camera: null }, avail = ['look_outside'];
  const fx = makeFx(parent);
  const props = {};
  const prop = (k) => { if (!props[k]) { props[k] = buildProp(k); props[k].visible = false; } return props[k]; };
  function wear(id) {
    id = id || 'everyday';
    if (id === outfit && fig) return;
    const keep = fig ? { p: fig.root.position.clone(), r: fig.root.rotation.y } : null;
    if (fig) { for (const k in props) if (props[k].parent) props[k].parent.remove(props[k]); grp.remove(fig.root); fig.dispose(); }
    outfit = id; fig = buildFigure(id, { motion }); grp.add(fig.root);
    if (keep) { fig.root.position.copy(keep.p); fig.root.rotation.y = keep.r; }
    fig.applyPose(cur);
  }
  // the state machine
  const cur = {}, from = {}; let blendT = 1;          // the pose shown, the snapshot a blend starts from, 0..1 progress
  const st = { act: null, actStart: 0, seg: null, walk: null, react: null, queue: [], yawT: null, posT: null, clock: 0, nextGlint: 0, nextSteam: 0, pageAt: 0, lastSched: 0 };
  function snapshot() { for (const k of POSE_KEYS) from[k] = cur[k] || 0; blendT = motion ? 0 : 1; }

  /* ---- the schedule: seeded by the day and the minute, held 30-90 s ---- */
  let schedCache = null;
  function segmentAt(ms) {
    const d = new Date(ms), day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), mid = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const c = schedCache;
    if (c && c.day === day && c.start <= ms && ms < c.end) return c;
    let r, t, k, prev;
    if (c && c.day === day && c.end <= ms) { r = c.r; t = c.end; k = c.k + 1; prev = c.pick; } else { r = rngLocal(day * 7 + 3); t = mid; k = 0; prev = -1; }
    for (let guard = 0; guard < 5000; guard++) {
      const len = (30 + r() * 60) * 1000, pick = r();
      if (t + len > ms) { schedCache = { day, start: t, end: t + len, pick, prev, k, r }; return schedCache; }
      t += len; k++; prev = pick;
    }
    return { day, start: ms, end: ms + 60000, pick: 0.5, prev: -1, k: 0, r };
  }
  function choose(seg) {
    const list = avail.filter((a) => a !== 'sleep' && ACTS[a] && world.spots[a] && (a !== 'stargaze' || night));
    if (!list.length) return 'look_outside';
    let total = 0; for (const a of list) total += ACT_WEIGHT[a] || 1;
    const at = (v) => { let x = v * total; for (const a of list) { x -= ACT_WEIGHT[a] || 1; if (x <= 0) return a; } return list[list.length - 1]; };
    let a = at(seg.pick);
    if (seg.prev >= 0 && list.length > 1 && at(seg.prev) === a) a = list[(list.indexOf(a) + 1) % list.length];   // never the same twice in a row
    return a;
  }

  /* ---- walking: straight lines that step around footprints ---- */
  function blocked(ax, az, bx, bz, skip) {
    for (const b of world.boxes) {
      if (skip && b[4] === skip) continue;
      const x0 = b[0] - 0.18, x1 = b[1] + 0.18, z0 = b[2] - 0.18, z1 = b[3] + 0.18;
      if ((ax > x0 && ax < x1 && az > z0 && az < z1) || (bx > x0 && bx < x1 && bz > z0 && bz < z1)) continue;   // starting or ending inside: let it go
      let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
      const clip = (p, q) => { if (Math.abs(p) < 1e-9) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
      if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t0 < t1) return b;
    }
    return null;
  }
  // around the first footprint in the way by its nearest free corner, then on from there (up to three detours)
  function route(ax, az, bx, bz, skip, depth = 0) {
    const b = blocked(ax, az, bx, bz, skip); if (!b || depth > 2) return [[bx, bz]];
    const m = 0.38, cs = [[b[0] - m, b[2] - m], [b[1] + m, b[2] - m], [b[0] - m, b[3] + m], [b[1] + m, b[3] + m]]
      .filter((c) => !world.boxes.some((o) => o !== b && c[0] > o[0] - 0.15 && c[0] < o[1] + 0.15 && c[1] > o[2] - 0.15 && c[1] < o[3] + 0.15))
      .sort((p, q) => (Math.hypot(p[0] - ax, p[1] - az) + Math.hypot(bx - p[0], bz - p[1])) - (Math.hypot(q[0] - ax, q[1] - az) + Math.hypot(bx - q[0], bz - q[1])));
    for (const c of cs) if (!blocked(ax, az, c[0], c[1], skip)) return [c, ...route(c[0], c[1], bx, bz, skip, depth + 1)];
    return [[bx, bz]];
  }
  function goTo(x, z, then, speed = 1.05, skip = null, via = null) {
    if (!fig) return;
    const p = fig.root.position;
    if (!motion || Math.hypot(x - p.x, z - p.z) < 0.05) { p.x = x; p.z = z; then && then(); return; }
    // getting up from a seat inside a footprint (the desk chair, the sofa): step out to the front of the piece first
    const pts = via ? [via, ...route(via[0], via[1], x, z, skip)] : route(p.x, p.z, x, z, skip);
    st.walk = { pts, speed, then, phase: 0 };
    snapshot();
  }

  /* ---- start an activity: walk to its spot, then settle into the pose ---- */
  function exitOf(prev) {
    const p = fig.root.position;
    return prev && prev.ax != null && prev.az != null && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.35 ? [prev.ax, prev.az] : null;
  }
  function startActivity(a) {
    if (!fig) return;
    const prev = st.spot;
    const sp = (a === 'sleep' ? world.spots.sleep : world.spots[a]) || world.spots.look_outside; if (!sp) return;
    st.act = a; st.spot = sp; st.actStart = st.clock; st.pageAt = st.clock + 6;
    hooks.onActivity && hooks.onActivity(a, sp);
    for (const k in props) props[k].visible = false;
    const ax = sp.ax != null ? sp.ax : sp.x, az = sp.az != null ? sp.az : sp.z;
    if (a === 'sleep' || !motion) { st.walk = null; place(sp); snapshot(); blendT = 1; return; }
    fig.root.position.y = 0;
    goTo(ax, az, () => { st.posT = { x0: fig.root.position.x, z0: fig.root.position.z, x1: sp.x, z1: sp.z, t: 0 }; st.yawT = sp.yaw; snapshot(); }, 1.05, sp.item, exitOf(prev));
  }
  function place(sp) { fig.root.position.set(sp.x, sp.y || 0, sp.z); fig.root.rotation.y = sp.yaw; }
  function baseFor(sp, act) {
    if (!sp) return {};
    if (sp.mode === 'sit') return sitP(sp.seat);
    if (sp.mode === 'kneel') return kneelP();
    if (sp.mode === 'bed') return { brx: -PI / 2, by: 0.12, bz: 0.87 };
    return {};
  }

  /* ---- reactions ---- */
  function react(name, opt = {}) {
    if (!REACTS[name] || !fig || macro === 'studying') return Promise.resolve(false);
    if (macro === 'asleep' && name !== 'wave') return Promise.resolve(false);           // asleep: let them sleep
    return new Promise((res) => {
      if (st.queue.length >= 3) st.queue.shift();
      st.queue.push({ name, opt, res });
      hooks.wake && hooks.wake();
    });
  }
  function beginReaction(q) {
    const R = REACTS[q.name];
    st.react = { ...q, R, t: 0, yaw0: fig.root.rotation.y, seated: !!(st.spot && st.spot.mode !== 'stand' && !st.walk) };
    if (R.go === 'chest' && world.chest && motion) {
      const c = world.chest; st.react.t = -99;                                          // waits until it arrives
      st.react.wasSeated = st.react.seated; st.react.seated = false;
      goTo(c.ax, c.az, () => { if (st.react) { st.react.t = 0; st.react.yaw = c.yaw; snapshot(); } }, 2.1, null, exitOf(st.spot));
    } else snapshot();
    if (R.face === 'camera' && world.camera) { const c = world.camera(), p = fig.root.position; st.react.yaw = Math.atan2(c.x - p.x, c.z - p.z); }
    else if (R.face === 'window' && world.window) { const p = fig.root.position; st.react.yaw = Math.atan2(world.window.x - p.x, world.window.z - p.z); }
    if (st.react.seated && R.face) { const d = wrapA(st.react.yaw - fig.root.rotation.y); st.react.yaw = fig.root.rotation.y + Math.max(-0.6, Math.min(0.6, d)); }
    const P = fig.root.position;
    if (R.sparkles) setTimeout(() => fx.sparkle(P.x, P.y + (st.react && st.react.seated ? 1.4 : 1.95), P.z, R.sparkles), motion ? 250 : 0);
    if (R.flash) hooks.flash && hooks.flash(R.flash, R.dur);
    if (R.prop) { const pr = prop(R.prop); fig.hand.add(pr); pr.position.set(0.12, 0.02, 0); pr.rotation.set(0, 0, PI / 2); pr.visible = true; }
    hooks.onReact && hooks.onReact(q.name);
  }
  function endReaction() {
    const r = st.react; st.react = null;
    if (r.R.prop && props[r.R.prop]) props[r.R.prop].visible = false;
    snapshot();
    if (r.R.go === 'chest' || (r.R.full && !r.seated && r.wasSeated)) { const a = st.act; st.act = null; if (a) startActivity(a); }
    else if (r.yaw0 != null) st.yawT = st.spot && st.spot.yaw != null && !st.walk ? st.spot.yaw : r.yaw0;
    r.res(true);
  }

  /* ---- one step ---- */
  const tgt = {};
  function update(dt, nowMs = Date.now()) {
    if (!fig) return false;
    dt = Math.min(dt, 0.1); st.clock += dt;
    let anim = false;
    // the macro state decides the room: away while studying, in bed when asleep
    grp.visible = macro !== 'studying' && !hidden;
    if (macro === 'studying') { const fxa = fx.update(dt); return fxa; }
    const want = macro === 'asleep' && world.spots.sleep ? 'sleep' : null;
    if (want && st.act !== 'sleep') startActivity('sleep');
    if (!want) {
      const seg = segmentAt(nowMs);
      const gone = st.act && st.act !== 'look_outside' && (!avail.includes(st.act) || !world.spots[st.act]);
      if (st.forced && !(world.spots[st.forced] || st.forced === 'look_outside')) st.forced = null;
      if ((!st.act || st.act === 'sleep' || st.segK !== seg.k || gone || (st.forced && st.act !== st.forced)) && !st.react) {
        const a = st.forced || choose(seg); st.segK = seg.k;
        if (a !== st.act) startActivity(a);
      }
    }
    // reactions in the queue
    // a reaction starts at once, even mid-walk (the walk waits for it), so a log gets its answer inside 300 ms
    if (!st.react && st.queue.length) beginReaction(st.queue.shift());
    const reacting = !!(st.react && st.react.t > -50);
    for (const k of POSE_KEYS) tgt[k] = 0;
    const t = motion ? st.clock - st.actStart : 0.35;
    if (st.walk && reacting) {
      anim = true;                                                                      // stand still while the reaction plays
    } else if (st.walk) {
      const w = st.walk, p = fig.root.position, nx = w.pts[0];
      const dx = nx[0] - p.x, dz = nx[1] - p.z, d = Math.hypot(dx, dz), step = w.speed * dt;
      const yaw = Math.atan2(dx, dz); fig.root.rotation.y += wrapA(yaw - fig.root.rotation.y) * Math.min(1, dt * 10);
      if (d <= step) { p.x = nx[0]; p.z = nx[1]; w.pts.shift(); if (!w.pts.length) { st.walk = null; w.then && w.then(); } }
      else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
      w.phase += dt * w.speed * 7.2;
      Object.assign(tgt, namedPose('walk', w.phase));
      anim = true;
    } else {
      const A = ACTS[st.act] || ACTS.look_outside, sp = st.spot;
      Object.assign(tgt, baseFor(sp, st.act));
      const up = A.f(t);
      if (st.act === 'work_desk' && sp && sp.standDesk) Object.assign(up, { sx: 0.06, nx: 0.2 });
      Object.assign(tgt, up);
      if (motion) anim = true;
      // props and small effects of the activity
      const pk = A.prop; if (pk) { const pr = prop(pk); if (pr.parent !== fig.hand) fig.hand.add(pr); pr.visible = !st.react || !st.react.R.prop;
        if (pk === 'book') { pr.position.set(0.11, 0.0, 0.08); pr.rotation.set(-0.5, 0, 0.0); }
        else if (pk === 'cup') { pr.position.set(0.0, -0.03, 0.04); pr.rotation.set(0, 0, 0); }
        else if (pk === 'can') { pr.position.set(0.0, -0.03, 0.06); pr.rotation.set(up.propTilt || 0.3, 0, 0); } }
      if (motion && A.steam && st.clock > st.nextSteam && props.cup && props.cup.visible) { st.nextSteam = st.clock + 0.22; const w = new THREE.Vector3(); props.cup.getWorldPosition(w); fx.steam(w.x, w.y + 0.1, w.z); }
      if (motion && A.glints && st.clock > st.nextGlint && sp && sp.keys) { st.nextGlint = st.clock + 0.45; fx.glint(sp.keys[0] + (Math.random() - 0.5) * 0.6, sp.keys[1], sp.keys[2]); hooks.note && hooks.note(); }
      if (A.page && motion && st.clock > st.pageAt) { st.pageAt = st.clock + A.page; hooks.page && hooks.page(); }
      // settle onto the seat after the walk
      if (st.posT) { st.posT.t = Math.min(1, st.posT.t + dt / 0.4); const e = ease(st.posT.t), p = fig.root.position; p.x = st.posT.x0 + (st.posT.x1 - st.posT.x0) * e; p.z = st.posT.z0 + (st.posT.z1 - st.posT.z0) * e; if (st.posT.t >= 1) st.posT = null; anim = true; }
    }
    if (st.react) {
      const r = st.react;
      if (r.t > -50) {
        r.t += dt;
        const up = r.R.f(motion ? r.t : r.R.dur * 0.45);
        for (const k in up) { if (!r.R.full && LOWER.includes(k) && k !== 'by') continue; if (r.seated && LOWER.includes(k)) continue; tgt[k] = up[k] + (k === 'by' && !r.R.full ? (tgt.by || 0) : 0); }
        if (r.seated) tgt.by = baseFor(st.spot).by || tgt.by;
        if (r.yaw != null) { const want2 = r.R.spin && motion ? r.yaw + Math.min(1, r.t / r.R.dur) * 2 * PI : r.yaw; fig.root.rotation.y += wrapA(want2 - fig.root.rotation.y) * Math.min(1, dt * 9); }
        anim = true;
        if (r.t >= r.R.dur) endReaction();
      } else anim = true;
    } else if (st.yawT != null && !st.walk) {
      const d = wrapA(st.yawT - fig.root.rotation.y);
      fig.root.rotation.y += d * Math.min(1, dt * 8); if (Math.abs(d) < 0.01 || !motion) { fig.root.rotation.y = st.yawT; st.yawT = null; } else anim = true;
    }
    // blend from the snapshot into the target over 0.4 s
    if (blendT < 1) { blendT = Math.min(1, blendT + dt / 0.4); anim = true; }
    const e = ease(blendT);
    for (const k of POSE_KEYS) cur[k] = (from[k] || 0) + ((tgt[k] || 0) - (from[k] || 0)) * e;
    fig.applyPose(cur);
    if (fx.update(dt)) anim = true;
    return anim && motion;
  }

  wear(o.outfit || 'everyday');
  return {
    group: grp,
    get figure() { return fig; },
    wear,
    setWorld(w) {
      world = { ...world, ...w };
      // only a spot that really moved (its piece was moved or stored) sends the figure walking again
      const ns = st.act && world.spots[st.act], os = st.spot;
      if (st.act && (!ns || !os || ns.item !== os.item || Math.hypot(ns.x - os.x, ns.z - os.z) > 0.05 || Math.abs(wrapA((ns.yaw || 0) - (os.yaw || 0))) > 0.05)) { const a = st.act; st.act = null; st.walk = null; if (a === 'sleep' || avail.includes(a)) startActivity(a); }
      else if (ns) st.spot = ns;
    },
    setActivities(list) { avail = Array.isArray(list) && list.length ? list.slice() : ['look_outside']; },
    setMacro(m) { const was = macro; macro = m || 'home'; if (was === 'studying' && macro !== 'studying' && world.door && fig && motion) { fig.root.position.set(world.door.x, 0, world.door.z); st.act = null; } if (was === 'asleep' && macro !== 'asleep') st.act = null; },
    get macro() { return macro; },
    setNight(n) { night = !!n; },
    setMotion(m) { motion = m !== false; if (fig) fig.setMotion(motion); if (!motion) { st.walk = null; if (st.spot) place(st.spot); blendT = 1; } },
    react,
    get busy() { return !!(st.react || st.queue.length); },
    /** hold one activity (if its piece is out) until force(null): for the "see it now" links, tests and screenshots */
    force(a) { st.forced = a && ACTS[a] && a !== 'sleep' ? a : null; if (st.forced && st.act !== st.forced && !st.react) { st.act = null; } hooks.wake && hooks.wake(); return !!st.forced; },
    activity() { const a = macro === 'studying' ? null : st.act; return { id: a, label: a ? ACT_LABEL[a] || '' : '', item: st.spot && st.spot.item, seated: !!(st.spot && st.spot.mode === 'sit') }; },
    position() { return fig ? fig.root.position : null; },
    setHidden(h) { hidden = !!h; grp.visible = macro !== 'studying' && !hidden; },
    update,
    dispose() { fx.dispose(); for (const k in props) props[k].geometry.dispose(); if (fig) fig.dispose(); parent.remove(grp); },
  };
}
function rngLocal(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
