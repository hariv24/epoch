// city/world/outside.js · slice 2 (docs/WORLD.md §13): the apartment door <-> W 123rd St. Owns the focus guard (13.3), the 0.4 s fades (13.1), the pre-built street
// (street.js + street_walk.js, built in a Web Worker while the user is still inside, so the transition itself holds no long task) and the small street HUD.
//   const out = createOutside(host, { stage, W, say(text), hourFn(), motion() })      stage = the room2 API (needs .walker / .rig / .canvas / .pause)
//   out.onDoor(walkerApi)   called by room2_walk.js when the apartment door is used: guard -> fade -> street, or the "street opens when your focus block ends" card
//   out.guard(state?)       -> { open, why };   out.active;   out.goHome();   out.api (debug: street, walk)
// Guard (the user, 11-01): open any time except while a focus block's timer is running (a paused block, a break, idle: open). Before 11-01 it was breaks + 30 min after a block. The end of a block is noted from the
// pomodoro stream (W.pomodoro.onState) in localStorage, from pending_ratings[].ended_utc and (review fix: a finished AND rated run has no end time in /api/pomodoro)
// from /api/today, which the Today page already serves: flow.last_end (the end of the last deep study entry) and the logged wins' times. No server change.
import { warm } from './render.js';

const FADE_MS = 400, KEY = 'epoch.street.lastBlockEnd';
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };

export function evalGuard(s, now = Date.now(), lastEnd = 0, override = false) {      // the user, 11-01: open any time except while the focus timer is running
  if (override) return { open: true, why: 'override (?street=open)' };
  const run = s && s.run;
  if (run && run.phase === 'work' && run.status === 'running') return { open: false, why: 'the focus timer is running' };
  return { open: true, why: run && run.status === 'paused' && run.phase === 'work' ? 'the focus timer is paused' : 'not studying' };
}

export function createOutside(host, o) {
  const { stage, W } = o, PQ = new URLSearchParams(location.search), DOC = document;
  const sceneEl = host.querySelector('[data-js="home-scene"]') || host, motion = () => (o.motion ? o.motion() !== false : true);
  let street = null, walk = null, building = null, active = false, busy = false, disposed = false, lastState = null, card = null;
  const override = () => PQ.get('street') === 'open';
  const hourNow = () => { try { const h = o.hourFn ? o.hourFn() : new Date().getHours(); return +h; } catch { return 12; } };

  /* ---- the guard */
  let todayEnd = 0;
  const lastEnd = () => Math.max(+LS.get(KEY) || 0, todayEnd);
  async function fetchTodayEnd() {                 // the last finished block, from the Today data (a rated block is a logged entry with an end time)
    try {
      const r = await Promise.race([fetch('/api/today', { cache: 'no-store', headers: { accept: 'application/json' } }).then((x) => (x.ok ? x.json() : null)), new Promise((res) => setTimeout(() => res(null), 1500))]);
      if (r) { const ts = [r.flow && r.flow.last_end, ...((r.wins || []).filter((w) => w.kind === 'log').map((w) => w.at))].map((t) => Date.parse(t || '')).filter((n) => n > 0 && n <= Date.now() + 60000); todayEnd = ts.length ? Math.max(...ts) : todayEnd; }
    } catch { /* offline: keep what we had */ }
    return todayEnd;
  }
  async function currentState() {
    const te = fetchTodayEnd();
    if (W && W.pomodoro) { try { const s = await Promise.race([W.pomodoro.fetch(), new Promise((r) => setTimeout(() => r(null), 1500))]); if (s) lastState = s; } catch { /* keep the last */ } }
    await te; return lastState || (W && W.pomodoro && W.pomodoro.state) || null;
  }
  const guard = (s) => evalGuard(s === undefined ? lastState || (W && W.pomodoro && W.pomodoro.state) : s, Date.now(), lastEnd(), override());

  /* ---- ui: fade, toast, card, hud */
  const fade = DOC.createElement('div'); fade.className = 'street__fade'; fade.setAttribute('aria-hidden', 'true');
  Object.assign(fade.style, { position: 'absolute', inset: '0', background: '#0a1022', opacity: '0', pointerEvents: 'none', zIndex: '8', transition: 'opacity ' + FADE_MS + 'ms ease' });
  sceneEl.appendChild(fade);
  const fadeTo = (v) => new Promise((res) => {
    if (!motion()) { fade.style.transition = 'none'; fade.style.opacity = String(v); fade.style.pointerEvents = v ? 'auto' : 'none'; return res(); }
    fade.style.transition = 'opacity ' + FADE_MS + 'ms ease'; fade.style.pointerEvents = v ? 'auto' : 'none';
    requestAnimationFrame(() => { fade.style.opacity = String(v); setTimeout(res, FADE_MS + 20); });
  });
  const hud = DOC.createElement('div'); hud.className = 'street__hud'; hud.hidden = true;
  Object.assign(hud.style, { position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '10px', zIndex: '6', display: 'flex', gap: '10px', alignItems: 'center', whiteSpace: 'nowrap', font: '600 12px/1.3 system-ui,sans-serif', color: '#fff' });
  hud.innerHTML = '<button type="button" class="btn btn--sm btn--violet" data-street-home>Back inside</button><span style="padding:4px 10px;background:rgba(8,26,51,.72);border-radius:999px">W walk · Shift run · drag to look · click your door (124)</span>';
  sceneEl.appendChild(hud); hud.querySelector('button').addEventListener('click', () => goHome());
  function toast(text) { if (o.say) o.say(text); const t = DOC.createElement('div'); t.className = 'street__toast'; t.textContent = text; t.setAttribute('role', 'status');
    Object.assign(t.style, { position: 'absolute', left: '50%', top: '14%', transform: 'translateX(-50%)', zIndex: '7', padding: '8px 16px', background: 'rgba(8,26,51,.85)', color: '#fff', borderRadius: '999px', font: '600 13px system-ui,sans-serif', pointerEvents: 'none' });
    sceneEl.appendChild(t); setTimeout(() => t.remove(), 1800); }

  /* ---- the street, built ahead of time */
  function ensureStreet() {
    if (building) return building;
    building = (async () => {
      const m = await import('./street.js'); const T = performance.now(), tm = (n) => { out.build = out.build || []; out.build.push([n, Math.round(performance.now() - T)]); };
      const useD = PQ.get('district') !== '0';                                  // slice 3: Harlem around home, streamed (?district=0 = the slice-2 street only)
      const S = m.mountStreet(host, { hidden: true, walk: true, hour: hourNow(), district: useD }); if (!S) throw new Error('no webgl2'); tm('mount');
      await S.ready; tm('ready'); const w = await import('./street_walk.js');
      let D = null;
      if (useD) { const dm = await import('./district.js'); D = await dm.attachDistrict(S, {}); const st = (S.collide.stoops || []).find((q) => q.num === '124') || { xd: 0, zf: 11 }; await D.preload(st.xd, st.zf, 140); tm('district'); }
      walk = await w.attachWalk(S, { motion, toast, onHome: () => goHome(), district: D }); street = S; tm('attach');
      await warm(S.renderer, S.scene, S.camera); tm('warm'); if (disposed) return null;
      // Hariv's programs + buffers before the first visible frame: one skinned mesh per task (a single draw of everything links ~3 s of shaders in one task)
      const r = S.renderer, meshes = []; walk.root.traverse((n) => { if (n.isMesh) meshes.push(n); });
      const world = S.world, others = []; world.children.forEach((c) => { if (c !== walk.root) others.push([c, c.visible]); });
      for (const m of meshes) {
        if (disposed) break; await new Promise((res) => setTimeout(res, 0));
        others.forEach(([c]) => { c.visible = false; }); meshes.forEach((q) => { q.visible = q === m; });
        r.setScissorTest(true); r.setScissor(0, 0, 1, 1); r.shadowMap.needsUpdate = true; r.render(S.scene, S.camera); r.setScissorTest(false);
      }
      tm('hariv-prewarm'); meshes.forEach((q) => { q.visible = true; }); others.forEach(([c, v]) => { c.visible = v; }); r.shadowMap.needsUpdate = true;
      return { S, walk };
    })().catch((e) => { console.warn('street build', e); building = null; return null; });
    return building;
  }
  function maybePrebuild() { if (building || disposed) return; if (!guard().open) return; const go = () => { if (!building && !disposed && guard().open) ensureStreet(); }; if (window.requestIdleCallback) requestIdleCallback(() => setTimeout(go, 1500), { timeout: 8000 }); else setTimeout(go, 3000); }
  setTimeout(() => fetchTodayEnd().then(maybePrebuild), 2500);

  /* ---- in <-> out */
  const roomCanvas = () => stage.canvas || host.querySelector('canvas:not(.street__canvas)');
  async function goOut() {
    if (busy || active) return; busy = true;
    const t0 = performance.now();
    await fadeTo(1);
    const b = await ensureStreet();
    if (!b) { busy = false; await fadeTo(0); toast('The street is not available'); stage.walker && stage.walker.closeCard(); return; }
    const { S } = b, mk = []; const mark = (n) => mk.push([n, Math.round(performance.now() - t0)]); mark('built');
    active = true; stage.pause(true); const rc = roomCanvas(); if (rc) rc.style.display = 'none'; mark('pause');
    if (!PQ.has('hour')) S.setHour(hourNow()); mark('hour');
    walk.setActive(true); S.show(true); mark('show'); walk.spawn(); mark('spawn'); out.marks = mk; S.canvas.focus({ preventScroll: true }); hud.hidden = false; S.canvas.setAttribute('aria-label', 'West 123rd Street, Harlem. You are on your stoop. W walks, drag looks, Shift runs.');
    if (o.announce) o.announce('You are outside, on your stoop at 124 West 123rd Street.');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await fadeTo(0); busy = false; out.lastOutMs = Math.round(performance.now() - t0);
  }
  async function goHome() {
    if (!active || busy) return; busy = true; walk.setActive(false);
    await fadeTo(1);
    const { S } = await building; S.show(false); const rc = roomCanvas(); if (rc) rc.style.display = '';
    hud.hidden = true; active = false; stage.pause(false);
    const wk = stage.walker, rig = stage.rig;
    if (wk) {
      wk.closeCard(); const d = wk.door, yaw = d ? Math.atan2(d.inward.x, d.inward.z) : 0, p = wk.pos;
      wk.tp(p.x, p.z, yaw); if (rig) { rig.setLook((yaw + Math.PI) / (Math.PI / 180), -12); rig.snap(); }
    }
    stage.kick && stage.kick(); const c = stage.canvas; if (c) c.focus({ preventScroll: true });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await fadeTo(0); busy = false;
  }
  function showCard(wk) {
    if (card) return;
    card = DOC.createElement('div'); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'The street opens when your focus block ends');
    Object.assign(card.style, { position: 'absolute', left: '50%', bottom: '1.2rem', transform: 'translateX(-50%)', width: 'min(24rem, 88%)', zIndex: '6', textAlign: 'center', padding: '1rem 1.2rem' });
    card.innerHTML = '<p class="card__head" style="margin:0 0 .7rem">You are mid focus block. The street opens when it ends.</p><p style="margin:0"><a class="btn btn--sm btn--violet" href="/pomodoro" data-street-study>Back to focus</a> <button type="button" class="btn btn--sm" data-street-back>Back</button></p>';
    const back = () => { if (!card) return; card.remove(); card = null; wk.closeCard(); };
    card.querySelector('[data-street-back]').addEventListener('click', back); card.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
    sceneEl.appendChild(card); card.querySelector('[data-street-back]').focus({ preventScroll: true });
  }
  async function onDoor(wk) {
    const s = await currentState(), g = guard(s); out.lastGuard = g;
    if (!g.open) { showCard(wk); return; }
    goOut();
  }
  const out = {
    onDoor, guard, goHome, goOut, fetchTodayEnd, get todayEnd() { return todayEnd; }, get active() { return active; }, get busy() { return busy; }, lastGuard: null, lastOutMs: 0,
    get api() { return { street, walk, S: street, ensureStreet }; },
    dispose() { disposed = true; if (walk) walk.dispose(); if (street) street.dispose(); fade.remove(); hud.remove(); if (card) card.remove(); },
  };
  if (W && W.pomodoro && W.pomodoro.onState) W.pomodoro.onState((s, meta) => {
    lastState = s; const prev = meta && meta.prev, pp = prev && prev.run && prev.run.phase, ph = s && s.run && s.run.phase;
    if (prev && ((pp === 'work' && ph && ph !== 'work') || (prev.active && !s.active && pp === 'work'))) LS.set(KEY, String(Date.now()));
    for (const r of (s && s.pending_ratings) || []) { const t = Date.parse(r.ended_utc); if (t > lastEnd()) LS.set(KEY, String(t)); }
    if (!active && !busy && !disposed) maybePrebuild();
  });
  return out;
}
