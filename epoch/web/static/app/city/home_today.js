// city/home_today.js · Today opens into your apartment (docs/COZY.md 4.1, 4.4). Boots the home scene (room.js mountHomeStage) after first
// paint and feeds it from what the page already has (no new polling):
//   - cozy.js (the HUD) turns every write (app.js "witness:write", which carries the game's diff events) and every /api/economy read into
//     Witness.cozy.react(kind) and Witness.cozy.setChest / setMissions calls; this file maps those kinds onto the character's reactions
//   - the htmx "witness:events" (HTML form posts, which do not go through app.js) feed the same reaction queue here
//   - the pomodoro stream (Witness.pomodoro.onState, SSE): away at the study spot during a run, home and a cheer when it ends
//   - the /api/economy, /api/world and /api/home/layout answers other code fetches keep the room, the outfit and the activities current
// Public API (window.Witness.cozy), for cozy.js, money.js and tests:
//   react(name) -> Promise   character reactions: wave | nod | cheer | point | crown | output | mission | chest | dance | yawn | look_up
//                            and the cozy.js kinds: ack (looks up at once) | log | deep | doors | floor | three_stars | chest_ready |
//                            chest_open (the crate in the room opens) | chest_done
//   decorate(itemId | {item}, {unbox})   open decorating, with that piece selected (unbox plays the box drop of "Place it now")
//   unbox(itemId)            "Place it now": a box drops into the room, opens, the piece pops out, decorating starts with it selected
//   exitDecorate()           decorating -> bool
//   playChest() -> Promise   the character kneels, the lid pops, light beams (1.6 s)
//   setChest(chest | readyCount)   show / hide the crate in the room;   setMissions(missions)   the scene summary's "Missions 1 of 3"
//   force(activity | null)   hold one home activity (its piece must be out), e.g. 'play_records'; null goes back to the schedule
//   onWrite(result)          feed a write result by hand;   refresh()   re-read /api/home/layout and /api/economy
//   summary() -> string      the scene's screen-reader summary;   info()   debug numbers (draw calls, triangles, activity);   stage
// Slice 2 (docs/WORLD.md 13): the apartment door opens onto the walkable W 123rd St (world/outside.js); ?street=open skips the focus guard (debug).
// ?street=preview mounts city/world/street.js instead of the room (W 123rd St from the LPC photographers' spots; &cam=fig2|fig1|fig14|east|west &hour=11).
// Events on document: "cozy:ready" (detail: the API), "cozy:decorate" (detail: {on}); "cozy:chest-tap" bubbles from the scene when the
// crate in the room is tapped (cozy.js opens the chest; set Witness.cozy.onChestTap to handle it directly instead).
import { mountHomeStage } from './room.js';

const DOC = document;
const J = (n, r) => (r || DOC).querySelector('[data-js="' + n + '"]');

export async function bootHomeToday() {
  const W = window.Witness, host = J('home-stage');
  if (!W || !host || host.dataset.booted) return null;
  host.dataset.booted = '1';
  // ?street=preview: the walkable-street preview (docs/WORLD.md 12.3), fixed photographer cameras on W 123rd St. The default Today page is untouched.
  if (new URLSearchParams(location.search).get('street') === 'preview') {
    try { const m = await import('./world/street.js'); const api = m.mountStreet(host, {}); if (api) { window.Witness.street = api; return null; } } catch (e) { console.warn('street preview', e); }
  }
  const api = W.api, prefs = W.prefs || {};
  const motion = () => !(W.reduced ? W.reduced() : matchMedia('(prefers-reduced-motion: reduce)').matches);
  const quiet = () => !!(prefs.quiet || DOC.body.dataset.quiet === '1');
  const cityScene = () => (W.scenes && (W.scenes.week || W.scenes.city)) || null;
  const live = DOC.getElementById('toasts');
  function announce(text) {
    if (!live || !text) return;
    const s = DOC.createElement('span'); s.className = 'sr-only'; s.textContent = text; live.appendChild(s);
    setTimeout(() => s.remove(), 4000);
  }

  const [layout, econ] = await Promise.all([api.get('/api/home/layout').catch(() => null), api.get('/api/economy').catch(() => null)]);
  const flat = prefs.three === 'off';
  // Room v2 (docs/ROOM-V2.md §13.2 item 2) is the Today room for every home that has a shell; ?room2=0 shows the old room, ?room2=1 forces it
  const r2q = new URLSearchParams(location.search).get('room2');
  const room2 = r2q === '1' || (r2q !== '0' && !flat && !!(econ && econ.home && ['harlem-floorthrough', 'morningside-studio'].includes(econ.home.id)));
  let outside = null;       // slice 2 (world/outside.js): the street behind the apartment door
  const stageOpts = {
    onDoor: (wk) => { if (outside) outside.onDoor(wk); else if (wk && wk.closeCard) wk.closeCard(); }, suspended: () => !!(outside && (outside.active || outside.busy)),
    flat, layout: layout && layout.ok !== false ? layout : null, econ: econ && econ.ok !== false ? econ : null,
    hourFn: () => (W.hourFn ? W.hourFn() : new Date().getHours()), motion, quiet, api, cityScene,
    weather: () => W.state && W.state.weather, announce,
    say: (t) => W.toast && W.toast({ icon: 'info', tone: 'violet', title: t }),
    sfx: (n) => { try { W.sfx && W.sfx(n); } catch { /* sound is optional */ } },
    soundOn: () => !!prefs.sound,
    onChestTap: () => {
      if (W.cozy && typeof W.cozy.onChestTap === 'function') W.cozy.onChestTap();
      else if (W.cozyUI && typeof W.cozyUI.openChest === 'function') W.cozyUI.openChest();
      host.dispatchEvent(new CustomEvent('cozy:chest-tap', { bubbles: true }));
    },
    onDecorate: (on) => { host.classList.toggle('is-decorating', !!on); const b = J('home-decorate'); if (b) b.setAttribute('aria-pressed', String(!!on)); DOC.dispatchEvent(new CustomEvent('cozy:decorate', { detail: { on: !!on } })); },
    onSaved: () => { if (window.WitnessMoney && window.WitnessMoney.refresh) { /* the Home page refreshes itself; Today has nothing to swap */ } },
  };
  const stage = room2 ? await import('./room2.js').then((m) => m.mountRoom2(host, stageOpts) || mountHomeStage(host, stageOpts)).catch((e) => { console.warn('room2', e); return mountHomeStage(host, stageOpts); }) : mountHomeStage(host, stageOpts);
  if (!stage) return null;
  if (room2) import('./world/outside.js').then((m) => {
    outside = m.createOutside(host, { stage, W, say: stageOpts.say, hourFn: stageOpts.hourFn, motion, announce });
    W.outside = outside; if (new URLSearchParams(location.search).get('debug')) window.__world = outside;
  }).catch((e) => console.warn('outside', e));

  /* ---- reactions: cozy.js names them, the character plays them (one at a time, queued, the activity resumes after) ---- */
  const ALIAS = { ack: 'look_up', log: 'nod', deep: 'cheer', doors: 'crown', floor: 'point', three_stars: 'dance', chest_ready: 'chest', stars: 'dance' };
  const recent = new Map();
  function react(name) {
    const k = String(name || '');
    if (k === 'chest_open') return stage.playChest();
    if (k === 'chest_done') return Promise.resolve(false);
    const n = ALIAS[k] || k, now = Date.now();
    if (recent.has(n) && now - recent.get(n) < 1500) return Promise.resolve(false);      // the same news from two sources plays once
    recent.set(n, now);
    // "ack" is the instant answer to a log (well inside 300 ms); the real reaction (nod / cheer) follows the server's answer
    if (n === 'look_up' && recent.has('nod')) recent.delete('nod');
    return stage.react(n);
  }
  const kindsOf = (ev) => (ev || []).map((e) => String((e && e.kind) || '').toLowerCase());
  /** a write's result -> the biggest reaction that applies (the same choice cozy.js makes for app.js writes) */
  function onWrite(res) {
    if (!res || res.ok === false) return;
    const k = kindsOf(res.events);
    if (k.includes('target') || k.includes('crown')) react('crown');
    else if (k.includes('floor')) react('doors');
    else if (k.includes('output') || k.includes('ship') || res.output) react('output');
    else if (res.entry && res.entry.deep) react('deep');
    else if (res.entry || k.includes('log')) react('log');
  }
  function onRead(url, res) {
    if (!res || res.ok === false) return;
    if (/^\/api\/economy\b/.test(url)) {
      stage.setEconomy(res);
      const sig = JSON.stringify(((res.home && res.home.layout && res.home.layout.items) || []).map((e) => [e.id, e.x, e.z, e.ry, e.u, e.y, e.wall]));
      if (layoutSig != null && sig !== layoutSig && !stage.decorating) refreshLayout();
      layoutSig = sig;
    } else if (/^\/api\/world\b/.test(url)) {
      if (res.economy) stage.setEconomy(res.economy);
    } else if (/^\/api\/weather\b/.test(url)) stage.setWeather(res);
  }
  let layoutSig = null;
  function refreshLayout() { return api.get('/api/home/layout').then((p) => { if (p && p.ok !== false) stage.setLayout(p); }).catch(() => {}); }
  // observe Witness.api (the same object app.js, money.js, cozy.js and focus.js call): nothing is fetched twice
  if (!api.__cozy) {
    const get0 = api.get, post0 = api.post;
    api.get = function (u) { const p = get0.apply(this, arguments); p.then((r) => { try { onRead(String(u), r); } catch (e) { console.warn('cozy read', e); } }, () => {}); return p; };
    api.post = function (u) {
      const p = post0.apply(this, arguments);
      p.then((r) => {
        try {
          // a purchase, an equip or a move changes the room: re-read the layout (the save of the layout itself answers with it)
          if (/^\/api\/(shop\/buy|equip|move)/.test(String(u)) && r && r.ok !== false) { refreshLayout(); api.get('/api/economy').catch(() => {}); }
        } catch (e) { console.warn('cozy write', e); }
      }, () => {});
      return p;
    };
    api.__cozy = true;
  }
  // htmx forms (the HTML routes) send their game events as an HX-Trigger; app.js plays the toasts, the character plays this
  DOC.addEventListener('witness:events', (e) => {
    const d = e.detail, ev = Array.isArray(d) ? d : (d && Array.isArray(d.value) ? d.value : (d && Array.isArray(d.events) ? d.events : null));
    if (!ev || !ev.length) return;
    const log = ev.find((x) => String(x && x.kind).toLowerCase() === 'log');
    onWrite({ events: ev, entry: log ? { deep: !!(log.fx && log.fx.deep) || /deep/i.test(String(log.detail || '')) } : null });
  });
  DOC.addEventListener('witness:refreshed', () => {
    if (cityScene()) viewOnce();
    if (W.state && W.state.weather) stage.setWeather(W.state.weather);
    stage.summary();
  });
  let viewDone = false;
  function viewOnce() { if (viewDone) return; viewDone = true; stage.refreshView(); }
  // the window waits for the city scene (built after the first refresh, on idle): look a few times, then keep the painted sky
  [1500, 4000, 9000, 16000].forEach((ms) => setTimeout(() => { if (!viewDone && cityScene()) viewOnce(); }, ms));

  // the focus run (SSE): away at the study spot during a run, back home when it ends, and a cheer for a finished block
  if (W.pomodoro && W.pomodoro.onState) {
    let wasActive = null;
    W.pomodoro.onState((s, meta) => {
      const active = !!(s && s.active);
      if (active && wasActive !== true) stage.setEconomy({ character: { state: 'studying', spot: s.spot || null } });
      else if (!active && wasActive === true) { stage.setEconomy({ character: { state: 'walking_home' } }); setTimeout(() => react('cheer'), 900); }
      const prev = meta && meta.prev, ph = s && s.run && s.run.phase, pph = prev && prev.run && prev.run.phase;
      if (prev && pph === 'work' && ph && ph !== 'work' && active) announce('Block done.');
      wasActive = active;
    });
  }

  /* ---- the Decorate button (cozy.js builds it in the HUD; a plain one in the markup works too) and Esc from anywhere ---- */
  DOC.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-js="home-decorate"]');
    if (b) { e.preventDefault(); if (stage.decorating) stage.exitDecorate(); else stage.decorate(); }
  });
  DOC.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stage.decorating && !host.contains(DOC.activeElement) && !e.defaultPrevented) stage.exitDecorate();
  });
  DOC.addEventListener('visibilitychange', () => stage.pause(DOC.hidden));
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener && mq.addEventListener('change', () => stage.setMotion(motion()));
  DOC.addEventListener('witness:setting', (e) => { const n = e.detail && e.detail.name; if (n === 'motion') setTimeout(() => stage.setMotion(motion()), 0); if (n === 'quiet_mode') setTimeout(() => stage.summary(), 0); if (n === 'sky_tz' && stage.relight) setTimeout(() => stage.relight(), 0); });

  const decorateArg = (a) => (a && typeof a === 'object' ? a.item || null : a || null);
  const cozy = {
    stage, react, onWrite, refresh: () => Promise.all([refreshLayout(), api.get('/api/economy').catch(() => null)]),
    decorate: (a, o) => stage.decorate(decorateArg(a), o || (a && typeof a === 'object' ? { unbox: !!a.unbox } : {})),
    unbox: (id) => stage.decorate(decorateArg(id), { unbox: true }),
    exitDecorate: () => stage.exitDecorate(),
    force: (act) => (stage.force ? stage.force(act) : false),
    playChest: () => stage.playChest(), setChest: (c) => stage.setChest(c), setMissions: (m) => stage.setMissions && stage.setMissions(m),
    summary: () => stage.summary(), info: () => stage.info(),
  };
  W.cozy = Object.assign(W.cozy || {}, cozy);
  Object.defineProperty(W.cozy, 'decorating', { get: () => stage.decorating, configurable: true });
  DOC.dispatchEvent(new CustomEvent('cozy:ready', { detail: W.cozy }));
  return W.cozy;
}
