// city/spots/index.js · the study-spot stage of the Focus Screen (docs/COZY.md section 4.5).
//   createSpotStage(host, opts) -> stage | null (null without WebGL2: the page keeps its 2D picture of the spot)
//     opts: { spot, outfit, hour() -> hour, motion, touch, weather, realView(req) -> Promise<canvas|null>, home() -> economy home }
//   stage.setSpot(id)        load a spot (city/spots/<module>.js build(ctx)); the old one is disposed
//   stage.setRun(r)          { state: 'idle'|'work'|'break'|'between'|'done', paused, category } from the Pomodoro state
//   stage.setOutfit(id) .setWeather(w) .setMotion(on) .setHourFn(fn) .setInset(on) .pause(on) .invalidate() .describe() .stats() .dispose()
// The user's own faceless figure (character.js buildFigure, wearing their outfit) studies at the spot: typing, page turns and a sip of
// coffee during a block; on a break it stands, stretches, fetches a coffee and looks out of the window; while a finished block waits for
// an answer it stops and looks up. Other people live on in their slow loops (kit.js crowd).
// Rendering: on demand. With motion on and the stage on screen it ticks at 30 fps (15 fps as a picture-in-picture); under reduced
// motion it draws only when something changes (and once a minute for the wall clock). It stops while the tab is hidden.
import * as THREE from 'three';
import { buildFigure, namedPose, setSelfLight } from '../character.js';
import { makeMaterials, lightAt, weatherAmounts, paintView, createSteam, clamp, lerp, ease } from './kit.js';
import { SPOTS, spotOf } from './places.js';

export { SPOTS };
const NOTABLES = new URL('../manhattan/notables.json', import.meta.url);
const WALK = 1.15;                    // metres a second

function webgl2() { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } }

function createClassicStage(host, opts = {}) {
  if (!webgl2()) return null;
  let renderer;
  const touch = opts.touch ?? matchMedia('(pointer:coarse)').matches;
  try { renderer = new THREE.WebGLRenderer({ antialias: !touch, alpha: false, powerPreference: 'default' }); } catch { return null; }
  if (!renderer.capabilities || !renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'spot-canvas'; renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  renderer.info.autoReset = false;

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(47, 1, 0.1, 160);
  scene.fog = new THREE.Fog(0x211c1a, 18, 46);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun); scene.add(sun.target);
  const mats = makeMaterials();
  const steam = createSteam(14, 0.3); scene.add(steam.mesh);

  let hourFn = opts.hour || (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  let motion = opts.motion !== false, weather = opts.weather || null, outfit = opts.outfit || 'everyday';
  let spot = null, spotId = null, loading = null, L = null, lightKey = '', viewKey = '', viewAt = -1e9, inset = false, paused = false, visible = true;
  let fig = null, cup = null;
  const run = { state: 'idle', paused: false, since: performance.now(), prev: 'idle', category: null, fresh: true };

  /* ------------------------------------------------------------ the user's figure */
  function wear(id) {
    if (fig && id === outfit) return;
    outfit = id || 'everyday';
    if (fig) { scene.remove(fig.root); fig.dispose(); }
    fig = buildFigure(outfit); fig.root.visible = false; scene.add(fig.root);
    invalidate();
  }

  /* ------------------------------------------------------------ loading a spot */
  function setSpot(id) {
    id = SPOTS[id] ? id : 'butler';
    if (id === spotId && (spot || loading)) return loading || Promise.resolve(spot);
    spotId = id;
    const [file, variant] = spotOf(id).scene;
    const p = import('./' + file).then((m) => {
      if (spotId !== id) return null;
      const next = m.build({ mats, variant, id });
      if (spot) { scene.remove(spot.group); try { spot.dispose(); } catch { /* fine */ } }
      if (cup && cup.parent) cup.parent.remove(cup);
      spot = next; cup = spot.cup; scene.add(spot.group);
      if (cup && cup.parent !== spot.group) spot.group.add(cup);
      const bg = new THREE.Color(spot.background || '#1c1815'); scene.background = bg;
      scene.fog.color.set(spot.fog?.color || '#211c1a'); scene.fog.near = spot.fog?.near ?? 18; scene.fog.far = spot.fog?.far ?? 46;
      lightKey = ''; viewKey = ''; viewAt = -1e9; hasReal = false; clearTimeout(viewTimer); plan = null; planFor = '';
      relight(true); frameCam(); invalidate();
      loading = null; host.dataset.spot = id; host.classList.add('is-3d');
      if (opts.onSpot) opts.onSpot(id);
      return spot;
    }).catch((e) => { loading = null; console.warn('study spot', e); if (spotId === id && id !== 'butler') { spotId = null; return setSpot('butler'); } return null; });
    loading = p; return p;
  }

  /* ------------------------------------------------------------ light by hour and weather; the view out of the window */
  function relight(force) {
    if (!spot) return;
    const nl = lightAt(hourFn(), weatherAmounts(weather));
    if (!force && nl.key === lightKey) return;
    L = nl; lightKey = nl.key;
    hemi.color.copy(L.hemiSky); hemi.groundColor.copy(L.hemiGround); hemi.intensity = L.hemiI * (spot.interior ? 1.3 : 1.9) + (spot.interior ? 0.12 * L.night : 0);
    sun.color.copy(L.sun); sun.intensity = L.sunI * (spot.interior ? 0.7 : 1.6);
    const d = spot.sunDir ? spot.sunDir(L) : new THREE.Vector3(0.4, -0.8, 0.3);
    sun.position.copy(d).multiplyScalar(-30); sun.target.position.set(0, 0, 0);
    if (spot.outdoorSky) spot.outdoorSky(L, scene);
    setSelfLight(0.06 + 0.12 * L.night);
    renderer.toneMappingExposure = 1.0 + 0.12 * L.night;
    spot.setLight(L);
    steam.u.uAmt.value = 0.6 + 0.6 * L.night;
    refreshView();
    invalidate();
  }
  // The view out: the painted one at once; then the real city, rendered from the spot's own windows by the construction cam's scene
  // (at most once a minute; a newer hour or weather is rendered when the minute is up, and the last real view stays meanwhile).
  let hasReal = false, viewTimer = 0;
  function refreshView() {
    if (!spot || !spot.view) return;
    const key = spotId + ':' + L.bucket + ':' + (weather && weather.condition) + ':' + Math.round(L.hour);
    if (key === viewKey) return; viewKey = key;
    const real = spot.realView && opts.realView;
    if (!real || !hasReal) spot.setView(paintView(spot.view.kind, L, { seed: spot.view.seed, far: spot.view.far }));
    if (!real) return;
    clearTimeout(viewTimer);
    viewTimer = setTimeout(renderReal, Math.max(0, viewAt + 60000 - performance.now()));
  }
  function renderReal() {
    if (!spot || !spot.realView) return;
    viewAt = performance.now();
    const want = spotId;
    realViewFor(spot.realView).then((cv) => {
      if (!cv || want !== spotId || !spot) return;
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; spot.setView(t); hasReal = true; invalidate();
    }).catch(() => { /* the painted view stays */ });
  }
  let notables = null;
  async function realViewFor(req) {
    if (!notables) notables = await fetch(NOTABLES).then((r) => r.json()).then((j) => j.notables || []).catch(() => []);
    let a = notables.find((n) => n.id === req.from);
    const b = notables.find((n) => n.id === req.look);
    if (req.home) {                                     // from the user's own roof (the rooftop spot)
      const h = opts.home && opts.home(); if (!h || !b || !isFinite(+h.x)) return null;
      const top = (+h.base_y || 0) + (+h.height_m || 20) + (req.up ?? 4), dx = b.x - h.x, dz = b.z - h.z, l = Math.hypot(dx, dz) || 1, ah = req.ahead || 0;
      return opts.realView({ pos: [+h.x + dx / l * ah, top, +h.z + dz / l * ah], look: [b.x, (b.baseY || 0) + (req.lookUp ?? 14), b.z], width: 1280, height: 640, fov: req.fov || 50 });
    }
    if (!a || !b) return null;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    const ey = (a.baseY || 0) + (req.up || 10);
    const pos = [a.x + ux * (req.ahead ?? 32), ey, a.z + uz * (req.ahead ?? 32)], look = [b.x, (b.baseY || 0) + (req.lookUp ?? 14), b.z];
    return opts.realView({ pos, look, width: 1280, height: 640, fov: req.fov || 50 });
  }

  /* ------------------------------------------------------------ camera: framed by the spot, a slow sway, a little drag-to-look */
  const look = { yaw: 0, pitch: 0, goalYaw: 0, goalPitch: 0, at: 0 };
  let aspect = 1.6, push = 0;
  function frameCam() {
    if (!spot) return;
    const F = spot.frames, t = clamp((aspect - 0.95) / (1.55 - 0.95), 0, 1), a = F.tall, b = F.wide;
    const pos = new THREE.Vector3().fromArray(a.pos).lerp(new THREE.Vector3().fromArray(b.pos), t);
    const tgt = new THREE.Vector3().fromArray(a.target).lerp(new THREE.Vector3().fromArray(b.target), t);
    if (push > 0 && spot.seat) { const s = new THREE.Vector3(spot.seat.x, 1.15, spot.seat.z); pos.lerp(s, 0.12 * push); tgt.lerp(s, 0.25 * push); }
    camera.fov = lerp(a.fov, b.fov, t);
    const off = pos.clone().sub(tgt), sph = new THREE.Spherical().setFromVector3(off), now = performance.now() / 1000;
    const sway = motion && !inset ? Math.sin(now * 0.11) * 0.012 : 0;
    sph.theta += look.yaw + sway; sph.phi = clamp(sph.phi - look.pitch, 0.6, 1.62);
    camera.position.copy(tgt).add(new THREE.Vector3().setFromSpherical(sph)); camera.lookAt(tgt);
    camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  {
    const el = renderer.domElement; let drag = null;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => { if (inset) return; drag = { x: e.clientX, y: e.clientY, yaw: look.goalYaw, pitch: look.goalPitch }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return; const w = el.clientWidth || 800;
      look.goalYaw = clamp(drag.yaw - (e.clientX - drag.x) / w * 0.9, -0.42, 0.42); look.goalPitch = clamp(drag.pitch + (e.clientY - drag.y) / w * 0.5, -0.12, 0.16);
      look.at = performance.now(); if (!motion) { look.yaw = look.goalYaw; look.pitch = look.goalPitch; } invalidate();
    });
    const up = () => { drag = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', () => { look.goalYaw = 0; look.goalPitch = 0; if (!motion) { look.yaw = 0; look.pitch = 0; } invalidate(); });
  }

  /* ------------------------------------------------------------ the user's routine at the spot */
  let plan = null, planFor = '';
  const at = { x: 0, z: 0, ry: 0 };
  function pathLen(P) { let l = 0; for (let i = 0; i + 1 < P.length; i++) l += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); return l; }
  function walkAt(P, d) {
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= l || i === P.length - 2) { const k = l ? clamp(d / l, 0, 1) : 1; return { x: lerp(a[0], b[0], k), z: lerp(a[1], b[1], k), ry: l > 1e-3 ? Math.atan2(b[0] - a[0], b[1] - a[1]) : null }; }
      d -= l;
    }
    return { x: P[0][0], z: P[0][1], ry: null };
  }
  /** a break: stand up, stretch, fetch a coffee, look out of the window (a list of timed steps) */
  function breakPlan(R) {
    const st = [{ k: 'rise', d: 0.9 }];
    st.push({ k: 'walk', P: R.toStretch }); st.push({ k: 'stretch', d: 6.5, at: R.stretch });
    st.push({ k: 'walk', P: R.toCoffee });
    if (R.coffeeExit) st.push({ k: 'away', d: 16 }); else st.push({ k: 'pour', d: 5, at: R.coffee });
    st.push({ k: 'walk', P: R.fromCoffee, cup: true }); st.push({ k: 'window', d: 1e9, at: R.window, cup: true });
    let t = 0; for (const s of st) { if (s.k === 'walk') s.d = pathLen(s.P) / WALK; s.t0 = t; t += s.d; }
    return st;
  }
  function returnPlan(R, from) {
    const P = [[from.x, from.z], ...R.toSeat.slice(1)], st = [{ k: 'walk', P, cup: run.prev === 'break' }, { k: 'sit', d: 0.8 }, { k: 'seated', d: 1e9 }];
    let t = 0; for (const s of st) { if (s.k === 'walk') s.d = pathLen(s.P) / WALK; s.t0 = t; t += s.d; }
    return st;
  }
  const tmpV = new THREE.Vector3();
  // Poses are joint angles on the figure's hinge pivots (character.js applyPose / POSE_KEYS): r* is the figure's right arm (it holds
  // the cup), l* the left; sx leans the spine, nx tips the head (+ down, - up), by drops the body onto a seat.
  const SIT = namedPose('sit');
  const P = {
    type: (t) => ({ sx: 0.14, nx: 0.32, rax: -0.62, rex: -0.92 + 0.08 * Math.sin(t * 13), lax: -0.62, lex: -0.92 + 0.08 * Math.sin(t * 13 + 1.7), raz: 0.1, laz: -0.1 }),
    typeStill: () => ({ sx: 0.14, nx: 0.32, rax: -0.62, rex: -0.92, lax: -0.62, lex: -0.92, raz: 0.1, laz: -0.1 }),
    read: (t) => { const k = (t % 6) < 0.7 ? Math.sin(((t % 6) / 0.7) * Math.PI) : 0; return { sx: 0.12, nx: 0.45 + 0.03 * Math.sin(t * 0.7), rax: -0.72, rex: -1.1, raz: 0.18, lax: -0.72 - 0.3 * k, lex: -1.1 + 0.35 * k, laz: -0.18 - 0.25 * k }; },
    think: (t) => ({ sx: -0.04, nx: -0.06 + 0.03 * Math.sin(t * 0.5), ny: 0.12 * Math.sin(t * 0.3), lax: -1.15, lex: -2.0, laz: -0.25, rax: -0.55, rex: -0.75, raz: 0.1 }),
    sip: (s) => ({ sx: 0.04, nx: 0.12 - 0.32 * s, rax: -0.55 - 0.5 * s, rex: -1.25 - 0.75 * s, raz: 0.12, lax: -0.62, lex: -0.92, laz: -0.1 }),
    rest: () => ({ sx: -0.1, nx: 0.05, rax: -0.55, rex: -0.65, lax: -0.55, lex: -0.65, raz: 0.08, laz: -0.08 }),
    lookUp: (q) => ({ sx: 0.1 - 0.26 * q, nx: 0.3 - 0.58 * q, rax: -0.62 + 0.12 * q, rex: -0.92 + 0.3 * q, lax: -0.62 + 0.12 * q, lex: -0.92 + 0.3 * q, raz: 0.1, laz: -0.1 }),
    stretch: (q, sw) => ({ sx: -0.12 * q, nx: -0.22 * q, rax: -q * 2.9, raz: 0.15 + sw, rex: -0.1, lax: -q * 2.9, laz: -0.15 + sw, lex: -0.1 }),
    carry: () => ({ rax: -0.45, rex: -1.35, raz: 0.12 }),
    pour: (k) => ({ sx: 0.1, nx: 0.3, rax: -0.75, rex: -0.85 + 0.08 * Math.sin(k * 3), lax: -0.7, lex: -0.9, raz: 0.1, laz: -0.1 }),
    window: (sip, k) => ({ nx: -0.06 - 0.1 * sip, sy: 0.05 * Math.sin(k * 0.21), rax: -0.4 - 0.45 * sip, rex: -1.35 - 0.7 * sip, raz: 0.12, lax: 0.12, lex: -0.3, laz: -0.06 }),
  };
  /** a seated pose (on the chair), a standing one, or the walk with an optional cup */
  function poseSit(extra) { fig.applyPose({ ...SIT, ...extra }); }
  function poseStand(extra) { fig.applyPose(extra || {}); }
  function poseWalk(ph, cupIn) { const W = namedPose('walk', ph); if (cupIn) Object.assign(W, P.carry()); fig.applyPose(W); }
  function handPos(out = tmpV) {
    if (!fig.hand) return out.set(at.x, 1.0, at.z);
    fig.root.updateMatrixWorld(true); return fig.hand.getWorldPosition(out);
  }
  function cupTo(where) {
    if (!cup || !spot) return;
    if (where === 'home') { cup.position.copy(spot.cupHome); cup.rotation.set(0, 0, 0); }
    else { const h = handPos(); h.y -= 0.06; if (cup.parent) { cup.parent.updateMatrixWorld(true); cup.parent.worldToLocal(h); } cup.position.copy(h); cup.rotation.set(0, 0, 0); }
  }
  /** the seated loop of a block: type, read with page turns, a sip of coffee, a moment of thought */
  function seatedWork(t) {
    const c = t % 50;
    if (c < 16) return ['type', null]; if (c < 27) return ['read', null]; if (c < 31) return ['sip', (c - 27) / 4]; if (c < 45) return ['type', null]; return ['think', null];
  }
  function place(x, z, ry) { at.x = x; at.z = z; if (ry != null) at.ry = ry; fig.root.position.set(x, 0, z); fig.root.rotation.y = at.ry; }

  function updateFigure(nowS) {
    if (!spot || !fig) return false;
    const R = spot.routes, S = spot.seat, st = run.state, e = (performance.now() - run.since) / 1000;
    let anim = false;
    if (st === 'idle') { fig.root.visible = false; cupTo('home'); steam.mesh.visible = false; return false; }
    fig.root.visible = true;
    const seated = (extra) => { place(S.x, S.z, S.ry); poseSit(extra); };
    let hot = false;
    if (st === 'break') {
      if (!motion) {                                              // a still picture: at the window with a coffee
        const w = R.window; place(w.x, w.z, w.ry); poseStand(P.window(0, 0)); cupTo('hand'); hot = true;
      } else {
        if (planFor !== 'break:' + run.since) { plan = breakPlan(R); planFor = 'break:' + run.since; if (!run.fresh) run.skip = plan.find((s) => s.k === 'window').t0; }
        const te = e + (run.skip || 0), s = plan.find((x) => te >= x.t0 && te < x.t0 + x.d) || plan[plan.length - 1], k = te - s.t0;
        if (s.k === 'rise') { const q = ease(clamp(k / s.d, 0, 1)); place(lerp(S.x, R.standAt[0], q), lerp(S.z, R.standAt[1], q), S.ry); fig.applyPose({ by: SIT.by * (1 - q), rhx: SIT.rhx * (1 - q), lhx: SIT.lhx * (1 - q), rkx: SIT.rkx * (1 - q), lkx: SIT.lkx * (1 - q), sx: 0.25 * Math.sin(q * Math.PI), rax: -0.5, lax: -0.5 }); cupTo('home'); }
        else if (s.k === 'walk') { const p = walkAt(s.P, k * WALK); place(p.x, p.z, p.ry); poseWalk(nowS * 7.4, s.cup); if (s.cup) { cupTo('hand'); hot = true; } else cupTo('home'); }
        else if (s.k === 'stretch') { place(s.at.x, s.at.z, s.at.ry); const q = Math.sin(clamp(k / 2.6, 0, 1) * Math.PI / 2) * (1 - clamp((k - s.d + 1.2) / 1.2, 0, 1)); poseStand(P.stretch(q, Math.sin(k * 1.4) * 0.12 * q)); cupTo('home'); }
        else if (s.k === 'away') { fig.root.visible = false; cupTo('home'); }
        else if (s.k === 'pour') { place(s.at.x, s.at.z, s.at.ry); poseStand(P.pour(k)); cupTo('hand'); hot = true; }
        else { const w = s.at; place(w.x, w.z, w.ry); const c = k % 14, sip = c > 10 ? Math.sin((c - 10) / 4 * Math.PI) : 0; poseStand(P.window(sip, k)); cupTo('hand'); hot = true; }
        anim = true;
      }
    } else if (st === 'work') {
      if (motion && run.prev === 'break' && !run.fresh && planFor !== 'back:' + run.since && (Math.abs(at.x - S.x) > 0.05 || Math.abs(at.z - S.z) > 0.05)) { plan = returnPlan(R, { x: at.x, z: at.z }); planFor = 'back:' + run.since; }
      const back = planFor === 'back:' + run.since && plan;
      const s = back ? (plan.find((x) => e >= x.t0 && e < x.t0 + x.d) || plan[plan.length - 1]) : null;
      if (s && s.k === 'walk') { const p = walkAt(s.P, (e - s.t0) * WALK); place(p.x, p.z, p.ry); poseWalk(nowS * 7.4, s.cup); if (s.cup) { cupTo('hand'); hot = true; } else cupTo('home'); anim = true; }
      else if (s && s.k === 'sit') { const q = ease(clamp((e - s.t0) / s.d, 0, 1)); place(lerp(R.standAt[0], S.x, q), lerp(R.standAt[1], S.z, q), S.ry); fig.applyPose({ by: SIT.by * q, rhx: SIT.rhx * q, lhx: SIT.lhx * q, rkx: SIT.rkx * q, lkx: SIT.lkx * q, rax: -0.6, lax: -0.6 }); cupTo('home'); anim = true; }
      else if (run.paused) { seated(P.rest()); cupTo('home'); }
      else if (!motion) { seated(P.typeStill()); cupTo('home'); }
      else {
        const [act, q] = seatedWork(nowS + 7);
        if (act === 'sip') { const lift = Math.sin(clamp(q, 0, 1) * Math.PI); seated(P.sip(lift)); if (lift > 0.15) { cupTo('hand'); hot = true; } else cupTo('home'); }
        else { seated(P[act](nowS)); cupTo('home'); }
        anim = true;
      }
    } else if (st === 'between') {
      // the block is done and the run is holding: stop typing, sit back, look up
      const q = motion ? ease(clamp(e / 0.7, 0, 1)) : 1;
      seated(P.lookUp(q)); cupTo('home'); anim = motion && q < 1;
    } else {                                                     // done: the run is over, a quiet moment at the table
      seated(P.rest()); cupTo('home');
    }
    hot = hot || (st === 'work' && motion);
    steam.mesh.visible = motion && !!cup && hot && fig.root.visible;
    if (steam.mesh.visible) { cup.updateMatrixWorld(true); steam.mesh.position.set(0, 0.1, 0).applyMatrix4(cup.matrixWorld); }
    return anim;
  }

  /* ------------------------------------------------------------ the loop */
  let raf = 0, last = 0, lastDraw = 0, clockMin = -1, t0 = performance.now();
  const canRun = () => visible && !document.hidden && !paused;
  function invalidate() { if (!raf && canRun()) raf = requestAnimationFrame(frame); }
  function fps() { return inset ? 15 : 30; }
  function frame(t) {
    raf = 0;
    if (!spot) return;
    const nowS = (t - t0) / 1000;
    const live = motion;
    if (live && t - lastDraw < 1000 / fps() - 2) { invalidate(); return; }
    lastDraw = t;
    // ease the drag-look back home after 20 s
    if (performance.now() - look.at > 20000 && (look.goalYaw || look.goalPitch)) { look.goalYaw *= motion ? 0.985 : 0; look.goalPitch *= motion ? 0.985 : 0; if (Math.abs(look.goalYaw) < 1e-3) look.goalYaw = 0; if (Math.abs(look.goalPitch) < 1e-3) look.goalPitch = 0; }
    look.yaw += (look.goalYaw - look.yaw) * (motion ? 0.18 : 1); look.pitch += (look.goalPitch - look.pitch) * (motion ? 0.18 : 1);
    const goalPush = run.state === 'between' ? 1 : 0; push += (goalPush - push) * (motion ? 0.03 : 1);
    if (t - last > 30000 || !L) { relight(false); last = t; }
    frameCam();
    updateFigure(nowS);
    spot.update(nowS, motion && !inset);
    steam.u.uTime.value = nowS;
    renderer.info.reset();
    renderer.render(scene, camera);
    clockMin = new Date().getMinutes();
    if (live || Math.abs(look.goalYaw - look.yaw) > 1e-3 || Math.abs(push - goalPush) > 0.01) invalidate();
  }
  // reduced motion: one frame a minute moves the clock hands on during a run; the light is re-read every few minutes either way
  const clockTimer = setInterval(() => { if (run.state !== 'idle' && new Date().getMinutes() !== clockMin) invalidate(); }, 15000);   // idle + reduced motion: no frames at all
  const lightTimer = setInterval(() => { relight(false); }, 120000);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) invalidate(); }); io.observe(host);
  const onVis = () => { if (!document.hidden) invalidate(); };
  document.addEventListener('visibilitychange', onVis);
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    aspect = w / h;
    const dpr = Math.min(devicePixelRatio || 1, inset ? 1 : touch ? 1.25 : (w * h > 1.3e6 ? 1.5 : 1.75));
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    steam.u.uPx.value = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    spot?.setPx?.(steam.u.uPx.value);
    frameCam(); invalidate();
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); host.classList.add('no-webgl'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { host.classList.remove('no-webgl'); invalidate(); });

  /* ------------------------------------------------------------ API */
  function setRun(r = {}) {
    const st = r.state || 'idle', changed = st !== run.state || !!r.paused !== run.paused;
    if (st !== run.state) { run.prev = run.state; run.since = performance.now() - (r.elapsed ? r.elapsed * 1000 : 0); run.fresh = !r.initial && !(r.elapsed > 30); run.skip = 0; }
    run.state = st; run.paused = !!r.paused; run.category = r.category || null;
    if (changed) invalidate();
  }
  const describeRun = () => {
    const where = spot ? (spot.title || 'the study spot') : 'the study spot', n = spot ? spot.others : 0, others = n ? ' ' + n + ' other ' + (n === 1 ? 'person is' : 'people are') + ' here.' : '';
    const st = run.state;
    const you = st === 'idle' ? ' Your seat is waiting.' : st === 'work' ? (run.paused ? ' You are sitting back, paused.' : ' You are working at your table.') : st === 'break' ? ' You are on a break, stretching and getting a coffee.' : st === 'between' ? ' The block is done and you are looking up.' : ' The run is over.';
    return where + '.' + you + others;
  };
  wear(outfit); resize(); setSpot(opts.spot || 'butler');
  return {
    setSpot, setRun, get spotId() { return spotId; }, get spot() { return spot; },
    setOutfit(id) { wear(id || 'everyday'); },
    setWeather(w) { weather = w || null; relight(false); },
    setMotion(on) { motion = !!on; invalidate(); },
    setHourFn(fn) { if (typeof fn === 'function') { hourFn = fn; relight(true); } },
    setInset(on) { inset = !!on; resize(); },
    pause(p) { paused = !!p; if (!paused) invalidate(); },
    invalidate, resize, describe: describeRun,
    stats() { return { spot: spotId, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, light: L && L.bucket, state: run.state, inset, motion, figure: fig && fig.root.visible ? fig.root.position.toArray().map((v) => +v.toFixed(2)) : null }; },
    renderNow() { const r = raf; raf = 0; if (r) cancelAnimationFrame(r); lastDraw = 0; frame(performance.now()); },
    renderer, scene, camera,
    dispose() {
      cancelAnimationFrame(raf); clearTimeout(viewTimer); clearInterval(clockTimer); clearInterval(lightTimer); io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
      if (spot) { try { spot.dispose(); } catch { /* fine */ } } if (fig) fig.dispose(); mats.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch { /* fine */ } renderer.domElement.remove();
    },
  };
}

/* ------------------------------------------------------------ Butler Library v2 (docs/BUTLER-V2.md) */
// The Butler spot is spots/butler2.js: its own renderer (the brownstone pipeline), the Mixamo cast and the inside camera. ?butler2=0, another spot,
// or any load error shows the classic stage above instead. This wrapper keeps the stage API focus.js uses and replays the settings on a swap.
const b2Wanted = () => { try { return new URLSearchParams(location.search).get('butler2') !== '0'; } catch { return true; } };
export function createSpotStage(host, opts = {}) {
  if (!webgl2()) return null;
  if (!b2Wanted()) return createClassicStage(host, opts);
  const st = { run: null, inset: false, motion: opts.motion !== false, weather: opts.weather || null, outfit: opts.outfit, hour: opts.hour, paused: false };
  let cur = null, kind = '', want = SPOTS[opts.spot] ? opts.spot : 'butler', gen = 0, b2failed = false;
  const drop = () => { if (cur) { try { cur.dispose(); } catch { /* fine */ } } cur = null; };
  function replay() {
    if (!cur) return;
    if (kind === 'classic') { cur.setMotion(st.motion); if (st.weather) cur.setWeather(st.weather); }
    if (st.inset) cur.setInset(true); if (st.run) cur.setRun(st.run); if (st.paused) cur.pause(true);
  }
  function classic(id) {
    if (cur && kind === 'classic') return cur.setSpot(id);
    drop(); kind = 'classic';
    cur = createClassicStage(host, { ...opts, spot: id, motion: st.motion, weather: st.weather, outfit: st.outfit, hour: st.hour }); replay();
    return Promise.resolve(cur);
  }
  function butler2() {
    drop(); kind = 'b2'; const my = ++gen;
    const fail = (e) => { console.warn('Butler v2 unavailable, showing the classic Butler', e); if (my === gen && kind === 'b2') { b2failed = true; drop(); kind = ''; classic('butler'); } };
    return import('./butler2.js').then((m) => {
      if (my !== gen || kind !== 'b2') return null;
      cur = m.createButler2Stage(host, { ...opts, motion: st.motion, weather: st.weather, hour: st.hour, onFail: fail }); replay(); return cur;
    }).catch(fail);
  }
  function setSpot(id) {
    want = SPOTS[id] ? id : 'butler';
    if (want === 'butler' && !b2failed) return kind === 'b2' ? Promise.resolve(cur) : butler2();
    gen++; return classic(want);
  }
  setSpot(want);
  const call = (f, ...a) => (cur && typeof cur[f] === 'function' ? cur[f](...a) : undefined);
  return {
    setSpot,
    setRun(r) { st.run = r; call('setRun', r); },
    get spotId() { return cur ? cur.spotId : want; }, get spot() { return cur ? cur.spot : null; }, get version() { return kind; },
    setOutfit(id) { st.outfit = id; call('setOutfit', id); },
    setWeather(w) { st.weather = w || null; call('setWeather', w); },
    setMotion(on) { st.motion = !!on; call('setMotion', on); },
    setHourFn(fn) { if (typeof fn === 'function') st.hour = fn; call('setHourFn', fn); },
    setInset(on) { st.inset = !!on; call('setInset', on); },
    pause(p) { st.paused = !!p; call('pause', p); },
    invalidate() { call('invalidate'); }, resize() { call('resize'); }, renderNow() { call('renderNow'); },
    describe() { return cur ? cur.describe() : 'Butler Library.'; },
    stats() { return cur ? cur.stats() : { spot: want, loading: true }; },
    get renderer() { return cur && cur.renderer; }, get scene() { return cur && cur.scene; }, get camera() { return cur && cur.camera; },
    dispose() { gen++; kind = 'gone'; drop(); },
  };
}
