/* app.js · Epoch "Your New York" front-end (production).
 *
 * Progressive enhancement: the server renders every page, and every <form> works as a plain POST without JS.
 * This script (a classic, deferred script, NOT a module) upgrades what is already on the page:
 *   - forms marked data-enhance / [data-js="log-form"] become fetch() calls to the JSON API (docs/game-design.md 9.4),
 *   - the "witness:events" HX-Trigger event from the HTML routes plays the same celebrations,
 *   - the ring, level bar, quests, wins, day buttons, totals and flat skyline are refreshed from GET /api/today and GET /api/world,
 *   - an on-demand 3D city (city.js + three.js, vendored) replaces the server-rendered SVG skyline when WebGL works.
 * If anything here is missing or throws, the server-rendered page keeps working.
 *
 * DOM CONTRACT (the templates match this; the full version with markup lives in static/app/DOM_CONTRACT.md):
 *   hooks are [data-js="name"] attributes. Page data comes from <body data-*>:
 *     data-page, data-today (YYYY-MM-DD), data-game (1|0), data-quiet (1|0), data-sound (1|0), data-motion (auto|on|off),
 *     data-three-d (auto|off), data-sky-tz (local|ny), data-hide-achievements (1|0), data-confetti-cap (default 3)
 *   forms: form[data-enhance="log|output|focus-stop|day-mark|close-label|close-seal"] (+ optional data-api="/api/...")
 *   settings: input[data-js="game-setting"][name="quiet_mode|sound|motion|three_d|sky_tz|hide_achievements|game_enabled"]
 *   dialogs: a|button[data-open-dialog="#id"], dialog.sheet#id, [data-close-dialog]
 *   3D hosts: .stage[data-js="stage"][data-stage="week|city"] > .fallback[data-js="fallback"] (server-rendered SVG)
 *
 * Voice rules (docs/game-design.md 5): every message is a fact about the work, in the user's own numbers.
 */
(function () {
  'use strict';

  /* ====================================================================== helpers */
  var DOC = document, ROOT = DOC.documentElement;
  var SCRIPT = DOC.currentScript || DOC.querySelector('script[src*="app/app.js"]');
  var BASE = new URL('./', (SCRIPT && SCRIPT.src) || location.href);           // .../static/app/
  var VENDOR = new URL('../vendor/', BASE);
  var ICONS = BASE.href + 'icons.svg';
  ROOT.classList.add('js');

  function qs(sel, root) { return (root || DOC).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || DOC).querySelectorAll(sel)); }
  function J(name, root) { return qs('[data-js="' + name + '"]', root); }
  function JJ(name, root) { return qsa('[data-js="' + name + '"]', root); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ico(n, cls) { return '<svg class="' + (cls || 'ic') + '" aria-hidden="true"><use href="' + ICONS + '#i-' + n + '"/></svg>'; }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function later(ms, fn) { return setTimeout(fn, ms); }
  function num(x, d) { x = Number(x); return isFinite(x) ? x : (d == null ? 0 : d); }
  function has(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function firstDef() { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i]; return undefined; }
  var NF = new Intl.NumberFormat('en-US');
  function fmtMin(m) { m = Math.max(0, Math.round(num(m))); return m >= 60 ? (m % 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : (m / 60) + 'h') : m + 'm'; }
  function hexStr(n) { return '#' + n.toString(16).padStart(6, '0'); }
  var DAY3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYFULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  var store = {
    get: function (k) { try { return localStorage.getItem('witness.app.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem('witness.app.' + k); else localStorage.setItem('witness.app.' + k, v); } catch (e) { /* private mode */ } },
  };

  /* dates: all calendar maths is done on 'YYYY-MM-DD' strings through UTC so time zones never shift a day */
  function parseDate(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function fmtDateISO(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function addDays(s, n) { return fmtDateISO(parseDate(s) + n * 86400000); }
  function dowOf(s) { return (new Date(parseDate(s)).getUTCDay() + 6) % 7; }                 // Monday = 0
  function mondayOf(s) { return addDays(s, -dowOf(s)); }
  function labelDate(s) { return new Date(parseDate(s)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function localISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ====================================================================== boot data, prefs */
  var BODY = DOC.body;
  var D = BODY.dataset || {};
  var CONFIG = { floor_min: 30, target_weekday: 90, target_weekend: 180, cap: 240, minutes_per_floor: 15, max_floors: 16 };
  var CAP_BURSTS = Math.max(0, num(D.confettiCap, 3));

  function bootFlag(name, key, dflt) {
    var v = D[name];
    if (v === undefined) v = store.get(key);
    if (v === undefined || v === null || v === '') return dflt;
    v = String(v).toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }
  var prefs = {
    game: bootFlag('game', 'game', true),
    quiet: bootFlag('quiet', 'quiet', false),
    sound: bootFlag('sound', 'sound', false),
    motion: firstDef(D.motion, store.get('motion'), 'auto'),                    // auto | on | off
    three: firstDef(D.threeD, store.get('three'), 'auto'),                      // auto | off
    ny: (firstDef(D.skyTz, store.get('skytz'), 'local') !== 'local'),
    hideAch: bootFlag('hideAchievements', 'hideach', false),
  };
  var mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return prefs.motion === 'off' || (prefs.motion !== 'on' && mqReduce.matches); }
  function quiet() { return prefs.quiet; }
  function gameOn() { return prefs.game; }

  function applyPrefsToDOM() {
    ROOT.classList.toggle('quiet', prefs.quiet);
    ROOT.classList.toggle('nogame', !prefs.game);
    ROOT.classList.toggle('hide-ach', prefs.hideAch);
    ROOT.classList.toggle('nomotion', reduced());
    if (prefs.motion === 'off') ROOT.dataset.motion = 'off';
    else if (prefs.motion === 'on') ROOT.dataset.motion = 'on';
    else delete ROOT.dataset.motion;
  }

  /* ---------- theme (auto | light | dark), kept in this browser only ---------- */
  function themeMode() { var t = store.get('theme'); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function effectiveTheme() { return ROOT.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') { ROOT.dataset.theme = mode; store.set('theme', mode); }
    else { delete ROOT.dataset.theme; store.set('theme', null); }
    syncTheme();
  }
  function syncTheme() {
    var dark = effectiveTheme() === 'dark';
    JJ('theme-toggle').forEach(function (b) {
      var use = qs('use', b); if (use) use.setAttribute('href', ICONS + '#i-' + (dark ? 'sun' : 'moon'));
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
    var mode = themeMode();
    JJ('theme-choice').forEach(function (r) { r.checked = r.value === mode; });
  }

  /* ====================================================================== content tables */
  var CAT = {
    'Python':     { label: 'Python', icon: 'terminal', hex: 0x6ab0ff, v: '--c-python', chip: 'c-python', deep: true, landmark: 'bridge' },
    'Math':       { label: 'Math', icon: 'sigma', hex: 0xb9a2ff, v: '--c-math', chip: 'c-math', deep: true, landmark: 'tower' },
    'ML/DL':      { label: 'ML/DL', icon: 'brain', hex: 0x5fdda5, v: '--c-ml', chip: 'c-ml', deep: true, landmark: 'spire' },
    'Papers':     { label: 'Papers', icon: 'book-open', hex: 0xff967a, v: '--c-papers', chip: 'c-papers', deep: true, landmark: 'dome' },
    'Writing/X':  { label: 'Writing/X', icon: 'pen-line', hex: 0xf590d6, v: '--c-writing', chip: 'c-writing', deep: true, landmark: 'billboard' },
    'Rest':       { label: 'Rest hour', icon: 'tent-tree', hex: 0xf4c977, v: '--rest', chip: 'c-rest', deep: false },
    'Distracted': { label: 'Drift', icon: 'smartphone', hex: 0x9aaecb, v: '--c-drift', chip: 'c-drift', deep: false },
    'Unknown':    { label: "Don't remember", icon: 'circle-help', hex: 0xc9d6e6, v: '--faint', chip: 'c-drift', deep: false },
  };
  function catOf(name) { return CAT[name] || { label: name || 'Other', icon: 'sparkles', hex: 0xc9d6e6, v: '--faint', chip: 'c-drift', deep: false }; }
  var DISTRICT_ICON = { 'Morningside Heights': 'book-open', 'Harlem': 'headphones', 'Upper West Side': 'coffee', 'Central Park': 'tent-tree', 'Upper East Side': 'landmark', "Hell's Kitchen": 'flame', 'Midtown & Times Square': 'sparkles', 'Chelsea': 'image', 'Flatiron & Gramercy': 'building-2', 'Greenwich Village': 'landmark', 'SoHo & Tribeca': 'layers', 'Lower East Side': 'map-pin', 'Financial District': 'train-front', 'Upper Manhattan': 'sun', "Billionaires' Row": 'house' };   // mirrors epoch/game.py DISTRICTS
  function cumXP(L) { return 150 * (L - 1) + 25 * L * (L - 1); }                      // docs/game-design.md 4.2
  var STATUS_TXT = { target: 'Crown lit', floor: 'Doors open', repaired: 'Repaired', rest: 'Rest day', skip: 'Rest day', missed: 'Empty lot, waiting', started: 'Started', open: 'In progress', future: 'Not yet', before_start: 'Not yet' };
  var STATUS_ICON = { target: 'target', floor: 'check', repaired: 'check', rest: 'tent-tree', skip: 'tent-tree', missed: 'layers', started: 'sparkles', open: 'pen-line', future: 'calendar-check', before_start: 'calendar-check' };
  var ACH_ICON = { first_light: 'sparkles', honest_hour: 'shield-check', first_floor: 'check', first_ship: 'trophy', first_close: 'moon', first_focus: 'timer', honest_week: 'shield-check',
    fog_lifter: 'cloud-fog', crown_x3: 'target', week_kept: 'calendar-check', five_ships: 'layers', linked_ship: 'send', all_five: 'landmark', clear_skies: 'sun', early_floor: 'zap',
    first_comeback: 'building-2', comeback_3: 'building-2', four_kept: 'calendar-check', node_first: 'landmark', landmark: 'landmark', ten_close: 'moon', fifty_hours: 'timer', hundred_hours: 'timer', thirty_ships: 'trophy' };

  /* ====================================================================== state */
  var ST = {
    today: D.today || localISO(),   // server's local date
    T: null,                        // normalised "today" numbers
    level: null,                    // {number, district, xp, into, needed, progress}
    run: null,
    world: null,                    // raw /api/world response
    pickedWeek: -1,
    busy: false,
    lastFetch: 0,
    shelf: null,
    weather: null,                  // GET /api/weather
    seasonal: null,                 // [{key, name, ...}] from /api/today and /api/world
    flow: null,                     // game.flow(): {minutes, hours_lit, active, ...}
    construction: null,             // last {active, phase, progress, ...} the Focus Screen sent (never re-sent: it carries a countdown)
  };

  /* ====================================================================== API */
  function ApiError(kind, status) { this.kind = kind; this.status = status || 0; }
  /* one random id per tab: the server echoes it on the live stream so a screen can skip its own events (docs/FEATURES-V2.md section 4) */
  var CLIENT_ID = (function () {
    var id = null;
    try { id = sessionStorage.getItem('witness.client'); } catch (e) { /* blocked */ }
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { sessionStorage.setItem('witness.client', id); } catch (e) { /* blocked */ }
    }
    return id;
  })();
  var API_TIMEOUT_MS = 40000;   // a typed line may wait on the free-LLM fallback; past this the request is dropped
  function apiFetch(method, url, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') opts.headers['X-Witness-Client'] = CLIENT_ID;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var ctl = null, timer = null, timedOut = false;
    if (typeof AbortController === 'function') {
      ctl = new AbortController(); opts.signal = ctl.signal;
      timer = setTimeout(function () { timedOut = true; ctl.abort(); }, API_TIMEOUT_MS);
    }
    var done = function (v) { if (timer) clearTimeout(timer); return v; };
    return fetch(url, opts).then(function (r) {
      done();
      if (!r.ok) {
        // A rejected body can still carry a kind {ok:false, hint}. Try to read it.
        return r.json().catch(function () { return null; }).then(function (j) {
          // a tablet whose pairing was revoked (or whose cookie is gone) goes back to the pairing page instead of polling forever
          if (r.status === 401 && j && j.code === 'unpaired' && location.pathname !== '/pair') { try { location.assign('/pair'); } catch (e) { /* ignore */ } }
          if (j && typeof j === 'object' && j.ok === false) return j;
          throw new ApiError('http', r.status);
        });
      }
      return r.json();
    }, function () { done(); throw new ApiError(timedOut ? 'timeout' : 'offline'); });
  }
  var api = {
    get: function (u) { return apiFetch('GET', u); },
    post: function (u, b) { return apiFetch('POST', u, b || {}); },
  };

  /* ====================================================================== sound (tiny Web Audio blips, off by default) */
  var ac = null;
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume().catch(function () {});
    return ac;
  }
  function blip(freq, at, dur, type, gain, slideTo) {
    var c = audio(); if (!c) return;
    var t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  var SFX = {
    tick: function () { blip(660, 0, 0.07, 'sine', 0.05); },
    ping: function () { blip(880, 0, 0.1, 'sine', 0.05); blip(1320, 0.09, 0.16, 'sine', 0.045); },
    levelUp: function () { [523, 659, 784, 1047].forEach(function (f, i) { blip(f, i * 0.09, 0.18, 'triangle', 0.05); }); },
    thunk: function () { blip(150, 0, 0.2, 'sine', 0.12, 55); },
  };
  function sfx(name) { if (!prefs.sound || !SFX[name]) return; try { SFX[name](); } catch (e) { /* audio blocked */ } }

  /* ====================================================================== tween + small fx */
  function tween(el, to, fmt, ms) {
    if (!el) return;
    ms = ms || 700;
    var from = el.dataset.v === undefined ? num(to) : num(el.dataset.v);
    el.dataset.v = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (el._to) clearTimeout(el._to);
    if (reduced() || from === to) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    var f = function (now) {
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      el._raf = k < 1 ? requestAnimationFrame(f) : 0;
    };
    el._raf = requestAnimationFrame(f);
    el._to = later(ms + 120, function () { el.textContent = fmt(to); });
  }
  function popEl(el, cls) {
    if (!el || reduced()) return;
    cls = cls || 'pop';
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    later(900, function () { el.classList.remove(cls); });
  }
  function floaty(text, el) {
    if (reduced() || quiet() || !gameOn() || !el) return;
    var r = el.getBoundingClientRect(); if (!r.width) return;
    var f = DOC.createElement('div'); f.className = 'floaty'; f.textContent = text;
    f.style.left = (r.left + r.width / 2) + 'px'; f.style.top = (r.top + 4) + 'px';
    DOC.body.appendChild(f); later(1200, function () { f.remove(); });
  }
  function toastBox() {
    var box = J('toasts');
    if (!box) { box = DOC.createElement('div'); box.className = 'toasts'; box.dataset.js = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-atomic', 'false'); DOC.body.appendChild(box); }
    return box;
  }
  function toast(o) {
    var box = toastBox(), el = DOC.createElement('div');
    el.className = 'toast' + (o.tone ? ' toast--' + o.tone : '');
    el.innerHTML = ico(o.icon || 'check') + '<div>' + esc(o.title) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + (o.code ? '<small><code>' + esc(o.code) + '</code></small>' : '') + '</div>';
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    later(o.ms || 4200, function () { el.classList.add('is-leaving'); later(260, function () { el.remove(); }); });
  }
  function joinFact(title, detail) {
    title = String(title || '').trim(); detail = String(detail || '').trim();
    if (!detail) return title;
    return title.replace(/[.!]+$/, '') + '. ' + detail;
  }

  /* ---------- confetti (canvas-confetti, vendored; loaded on first use; capped per day) ---------- */
  var confettiFn = null, confettiLoad = null;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = DOC.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; DOC.head.appendChild(s); });
  }
  function ensureConfetti() {
    if (confettiFn) return Promise.resolve(confettiFn);
    if (!confettiLoad) {
      confettiLoad = (typeof window.confetti === 'function' ? Promise.resolve() : loadScript(new URL('confetti/confetti.browser.min.js', VENDOR).href)).then(function () {
        if (typeof window.confetti !== 'function') return null;
        var cv = DOC.createElement('canvas'); cv.className = 'confetti-canvas'; cv.setAttribute('aria-hidden', 'true'); DOC.body.appendChild(cv);
        try { confettiFn = window.confetti.create(cv, { resize: true, useWorker: false }); } catch (e) { confettiFn = null; }
        return confettiFn;
      }).catch(function () { return null; });
    }
    return confettiLoad;
  }
  function originOf(el, dy) {
    if (!el) return { x: 0.5, y: 0.5 };
    var r = el.getBoundingClientRect();
    return { x: clamp((r.left + r.width / 2) / innerWidth, 0, 1), y: clamp((r.top + r.height * (dy == null ? 0.5 : dy)) / innerHeight, 0, 1) };
  }
  var PAL = { blue: '#8CC4EE', cream: '#F3EFE6', sky: '#D2E9FF', mint: '#62DDA8', gold: '#FFCE7A', coral: '#FF967A' };   // Morningside: Columbia blue, limestone, pale sky, mint, lamplight, coral
  var BURSTS = {
    floor:    { particleCount: 12, spread: 55, startVelocity: 22, scalar: 0.8, colors: [PAL.mint, PAL.sky, PAL.cream] },
    crown:    { particleCount: 40, spread: 85, startVelocity: 34, colors: [PAL.blue, PAL.cream, PAL.gold] },
    output:   { particleCount: 60, spread: 100, startVelocity: 38, colors: [PAL.blue, PAL.cream] },
    comeback: { particleCount: 90, spread: 120, startVelocity: 40, ticks: 240, colors: [PAL.blue, PAL.cream, PAL.gold, PAL.coral] },
    week:     { particleCount: 70, spread: 110, startVelocity: 36, colors: [PAL.blue, PAL.mint, PAL.cream, PAL.sky] },
    district: { particleCount: 120, spread: 160, startVelocity: 30, gravity: 0.7, ticks: 320, scalar: 1.1, shapes: ['square'], colors: [PAL.blue, PAL.cream, PAL.sky, PAL.mint] },
    small:    { particleCount: 18, spread: 60, startVelocity: 26, scalar: 0.8, colors: [PAL.blue, PAL.cream] },
  };
  var ALWAYS = { comeback: 1, district: 1, week: 1 };                               // never capped (docs/game-design.md 5)
  var burstMem = {};   // in-memory count, so the daily cap still holds when localStorage is blocked or cleared
  function burstsToday() { return Math.max(num(store.get('bursts.' + ST.today), 0), burstMem[ST.today] || 0); }
  function burst(kind, el, extra) {
    if (reduced() || quiet() || !gameOn()) return;
    extra = extra || {};
    var day = ST.today, counted = false;
    if (!ALWAYS[kind]) {
      var n = burstsToday(); if (n >= CAP_BURSTS) return;
      burstMem[day] = n + 1; counted = true;           // reserved now, so two bursts racing the script load cannot both pass
    }
    var release = function () { if (counted) burstMem[day] = Math.max(0, (burstMem[day] || 1) - 1); };
    ensureConfetti().then(function (fn) {
      if (!fn) { release(); return; }
      var p = Object.assign({ origin: originOf(el), zIndex: 60, disableForReducedMotion: true, ticks: 160 }, BURSTS[kind] || BURSTS.small);
      if (extra.count) p.particleCount = extra.count;
      if (extra.colors) p.colors = (p.colors || []).concat(extra.colors);
      try { fn(p); if (counted) store.set('bursts.' + day, String(burstMem[day])); } catch (e) { release(); /* canvas unavailable */ }
    }, release);
  }

  /* ---------- moment card (comeback, week kept, district) ---------- */
  var momentEl = null, momentReturn = null;
  var momentInert = [];
  function closeMoment() {
    if (!momentEl) return;
    momentEl.remove(); momentEl = null;
    momentInert.forEach(function (n) { n.inert = false; }); momentInert = [];
    if (momentReturn && DOC.contains(momentReturn)) { try { momentReturn.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    momentReturn = null;
  }
  function showMoment(o) {
    closeMoment(); momentReturn = DOC.activeElement;
    var el = DOC.createElement('div'); el.className = 'moment'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'momentH');
    el.innerHTML = '<div class="moment__card"><div class="moment__icon">' + ico(o.icon || 'sparkles') + '</div><h2 id="momentH">' + esc(o.title) + '</h2><p>' + esc(o.text || '') + '</p><button class="btn" type="button" id="momentOk">' + esc(o.cta || 'Keep building') + '</button></div>';
    DOC.body.appendChild(el); momentEl = el;
    // the card is modal: the page behind it is inert, and Tab stays on the card's one button
    Array.prototype.forEach.call(DOC.body.children, function (n) {
      if (n === el || n.inert || n.tagName === 'SCRIPT' || (n.dataset && n.dataset.js === 'toasts')) return;
      n.inert = true; momentInert.push(n);
    });
    el.addEventListener('keydown', function (ev) { if (ev.key === 'Tab') { ev.preventDefault(); qs('#momentOk', el).focus({ preventScroll: true }); } });
    qs('#momentOk', el).addEventListener('click', function () { closeMoment(); if (o.onOk) { try { o.onOk(); } catch (e) { /* optional */ } } });
    el.addEventListener('click', function (e) { if (e.target === el) closeMoment(); });
    qs('#momentOk', el).focus({ preventScroll: true });
  }

  /* ====================================================================== normalising API data */
  function normToday(raw) {
    if (!raw) return null;
    var r = raw.today && typeof raw.today === 'object' ? raw.today : raw;
    var ring = r.ring || {};
    var deep = num(firstDef(r.deep_minutes, r.deep), 0);
    var floorMin = num(firstDef(r.floor_minutes, CONFIG.floor_min), CONFIG.floor_min);
    var targetMin = num(firstDef(r.target_minutes, ST.T && ST.T.targetMin), 0);
    var floorMet = has(r, 'floor_met') ? !!r.floor_met : (ST.T ? ST.T.floorMet : deep >= floorMin);
    var targetMet = has(r, 'target_met') ? !!r.target_met : (targetMin ? Math.min(deep, CONFIG.cap) >= targetMin : false);
    var floorP = has(ring, 'floor_p') ? num(ring.floor_p) : (floorMet ? 100 : clamp(deep / floorMin * 100, 0, 100));
    var targetP = has(ring, 'target_p') ? num(ring.target_p) : (targetMin ? clamp(Math.min(deep, CONFIG.cap) / targetMin * 100, 0, 100) : 0);
    return {
      deep: deep, floors: has(r, 'floors') ? num(r.floors) : clamp(Math.floor(deep / CONFIG.minutes_per_floor), 0, CONFIG.max_floors),
      floorMet: floorMet, targetMet: targetMet, targetMin: targetMin, floorMin: floorMin, floorP: floorP, targetP: targetP,
      over: num(firstDef(r.over_cap_min, r.over_cap), 0), status: r.status || null, rest: !!(r.rest || r.status === 'rest' || r.status === 'skip' || r.mark),
      towerLine: r.tower_line || '', isComeback: !!r.is_comeback, ghost: has(r, 'ghost_minutes') ? num(r.ghost_minutes) : (ST.T ? ST.T.ghost : null),
    };
  }
  function normLevel(raw) {
    var l = raw && (raw.level || raw);
    if (!l || l.number == null) return null;
    var into = num(l.into), needed = num(l.needed, 1);
    return { number: num(l.number), district: l.district || '', xp: has(l, 'xp') && l.xp != null ? num(l.xp) : cumXP(num(l.number)) + into, into: into, needed: needed, progress: has(l, 'progress') ? num(l.progress) : (needed ? into / needed : 0) };
  }

  /* ====================================================================== render: run pill, level, ring */
  function renderRun(run) {
    if (run == null) return;
    var n = J('run-num'); if (n) { var old = num(n.textContent, 0); n.textContent = run; if (run > old) popEl(J('run-pill')); }
    var l = J('run-label'); if (l) l.textContent = ' day run';
  }
  /* ---------- flow meter: a row of avenue lights, one per hour of an unbroken chain (no XP) ---------- */
  function renderFlow(F) {
    var box = J('flow-meter'); if (!box || !F) return;
    var mins = F.active ? num(F.minutes) : 0, lights = JJ('flow-lights', box)[0] || J('flow-lights');
    if (lights) {
      qsa('.avlight', lights).forEach(function (el, i) {
        var f = clamp((mins - i * 60) / 60, 0, 1), was = el.classList.contains('is-on');
        el.style.setProperty('--f', f.toFixed(2)); el.classList.toggle('is-on', f >= 1);
        if (f >= 1 && !was) popEl(el, 'pop');
      });
    }
    var t = J('flow-text', box), h = J('flow-hours', box);
    if (t) {
      t.textContent = F.active && mins ? 'In flow for ' + fmtMin(mins) + '. ' + num(F.to_next_hour_min) + 'm to the next light.'
        : num(F.best_today) ? 'Best chain today: ' + fmtMin(F.best_today) + '. The next hour you log starts a fresh one.'
        : 'Back-to-back hours light the avenue, one lamp per hour.';
    }
    if (h) h.textContent = num(F.hours_lit) + ' lit';
  }

  function renderSeasonal(list) {
    var pill = J('seasonal-pill'); if (!pill) return;
    pill.hidden = !list.length;
    var t = J('seasonal-text', pill); if (t && list.length) t.textContent = (list[0].name || list[0].key) + (list.length > 1 ? ' +' + (list.length - 1) : '');
  }

  /* ---------- weather chip (Open-Meteo through GET /api/weather; the server caches it) ---------- */
  var WX_ICON = { clear: 'sun', clouds: 'cloud', rain: 'cloud-rain', snow: 'cloud-snow', fog: 'cloud-fog', storm: 'cloud-lightning' };
  function renderWeather(w) {
    var chip = J('weather-chip'); if (!chip) return;
    if (!w || w.enabled === false || !w.available || w.temp_c == null) { chip.hidden = true; return; }
    var icon = w.condition === 'clear' && w.is_day === false ? 'moon' : (WX_ICON[w.condition] || 'cloud');
    var use = qs('use', chip); if (use) use.setAttribute('href', ICONS + '#i-' + icon);
    var txt = J('weather-text', chip);
    if (txt) txt.textContent = 'NYC ' + Math.round(w.temp_c) + '°C · ' + String(w.description || '').toLowerCase();
    chip.title = 'New York now: ' + Math.round(w.temp_c) + '°C / ' + Math.round(w.temp_f) + '°F, ' + String(w.description || '').toLowerCase() + (w.stale ? ' (last known)' : '');
    chip.hidden = false;
  }
  function loadWeather() {
    return api.get('/api/weather').then(function (w) {
      if (!w || w.ok === false) return;
      ST.weather = w; renderWeather(w); pushAtmosphereAll();
    }).catch(function () { /* offline: the chip simply stays hidden */ });
  }

  function renderLevel(L, opts) {
    if (!L) return;
    opts = opts || {};
    var name = J('level-name'); if (name) name.textContent = 'Level ' + L.number + (L.district ? ' · ' + L.district : '');
    var xp = J('xp-num'); if (xp) tween(xp, L.xp, function (n) { return NF.format(n); }, 900);
    var to = J('xp-to'); if (to) to.textContent = NF.format(Math.max(0, L.needed - L.into)) + ' to Level ' + (L.number + 1);
    var fill = J('xp-fill'); if (fill) fill.style.setProperty('--p', clamp(L.progress, 0, 1).toFixed(4));
    var bar = J('xp-bar'); if (bar) bar.setAttribute('aria-valuenow', Math.round(clamp(L.progress, 0, 1) * 100));
    var di = J('dist-icon'); var use = di && qs('use', di);
    if (use) use.setAttribute('href', ICONS + '#i-' + (DISTRICT_ICON[L.district] || 'building-2'));
    if (opts.shine && fill) { fill.classList.remove('shine'); void fill.offsetWidth; fill.classList.add('shine'); }
    if (opts.badge) popEl(J('level-badge'));
  }
  function ringLead(T) {
    if (T.rest && !T.floorMet) return 'Rest day. Doors stay open if you want them.';
    if (!T.floorMet) return 'Doors in ' + fmtMin(Math.max(0, T.floorMin - T.deep)) + '.';
    if (!T.targetMet) return 'Doors open. Crown in ' + fmtMin(Math.max(0, T.targetMin - Math.min(T.deep, CONFIG.cap))) + '.';
    return 'Crown lit. Anything extra is shown but not counted.';
  }
  function renderRing(T, opts) {
    if (!T) return;
    opts = opts || {};
    var ain = J('arc-floor'), aout = J('arc-target');
    if (ain) { ain.style.setProperty('--p', T.floorP); ain.classList.toggle('is-done', T.floorMet); }
    if (aout) { aout.style.setProperty('--p', T.targetP); aout.classList.toggle('is-done', T.targetMet); }
    var dn = J('deep-num'); if (dn) { tween(dn, T.deep, fmtMin); dn.classList.toggle('long', fmtMin(T.deep).length > 4); }
    var lead = J('ring-lead'); if (lead) lead.textContent = ringLead(T);
    var fm = J('floor-min'); if (fm && T.floorMin) fm.textContent = T.floorMin;
    var tm = J('target-min'); if (tm && T.targetMin) tm.textContent = T.targetMin;
    var fo = J('floor-ok'); if (fo) fo.hidden = !T.floorMet;
    var to = J('target-ok'); if (to) to.hidden = !T.targetMet;
    var cap = J('cap-note'); if (cap) { cap.hidden = T.over <= 0; if (T.over > 0) cap.textContent = '+' + T.over + 'm, past the cap. Shown, never counted.'; }
    var tl = J('tower-line'); if (tl && T.towerLine) tl.textContent = T.towerLine;
    var np = J('floors-num'); if (np) np.textContent = T.floors;
    var nl = J('floors-label'); if (nl) nl.textContent = T.floors === 1 ? ' floor today' : ' floors today';
    renderGhost();
    renderHudDeep(T);
    if (opts.pop) popEl(J('ring-wrap'), 'pop-ring');
    if (opts.floorsPop) popEl(J('floors-pill'));
  }
  /* Today's HUD (docs/COZY.md 3a): deep time today with the doors and crown arcs, over the room */
  function hudLead(T) {
    if (T.rest && !T.floorMet) return 'Rest day';
    if (!T.floorMet) return 'Doors in ' + fmtMin(Math.max(0, T.floorMin - T.deep));
    if (!T.targetMet) return 'Crown in ' + fmtMin(Math.max(0, T.targetMin - Math.min(T.deep, CONFIG.cap)));
    return 'Crown lit';
  }
  function renderHudDeep(T) {
    var chip = J('hud-deep'); if (!chip || !T) return;
    var n = J('hud-deep-num', chip), lead = J('hud-deep-lead', chip), fa = J('hud-floor-arc', chip), ca = J('hud-crown-arc', chip), txt = hudLead(T);
    if (n) { if (n.textContent !== fmtMin(T.deep)) tween(n, T.deep, fmtMin); }
    if (lead) lead.textContent = txt;
    if (fa) { fa.style.setProperty('--p', T.floorP); fa.classList.toggle('is-done', T.floorMet); }
    if (ca) { ca.style.setProperty('--p', T.targetP); ca.classList.toggle('is-done', T.targetMet); }
    chip.setAttribute('aria-label', fmtMin(T.deep) + ' deep today. ' + txt + '. Open Today');
  }
  function renderGhost() {
    var g = J('ghost-g'), txt = J('ghost-text'); if (!g && !txt) return;
    var T = ST.T, w = ST.world, gm = null;
    if (w && w.ghost && Array.isArray(w.ghost.last_week_deep_by_dow)) gm = num(w.ghost.last_week_deep_by_dow[dowOf(ST.today)], 0);
    else if (T && T.ghost != null) gm = T.ghost;
    if (gm == null) return;
    var target = (T && T.targetMin) || CONFIG.target_weekday;
    if (g) { g.setAttribute('transform', 'rotate(' + (clamp(gm / target, 0, 1) * 360 - 270).toFixed(1) + ' 80 80)'); g.style.display = gm > 0 ? '' : 'none'; }
    if (txt) txt.textContent = gm > 0 ? 'Last week, same day: ' + fmtMin(gm) : 'Last week, same day: nothing logged';
  }

  /* ====================================================================== render: quests, wins, repeat chips */
  function renderQuests(list) {
    var ul = J('quests'); if (!ul || !Array.isArray(list)) return;
    var prev = qsa('.quest', ul).map(function (li) { return li.classList.contains('is-done'); });
    ul.innerHTML = list.slice(0, 3).map(function (q) {
      return '<li class="quest' + (q.done ? ' is-done' : '') + '"><span class="quest__box">' + ico('check') + '</span><span class="quest__t"><span class="quest__l">' + esc(q.label || q.title || '') + '</span>' + (q.sub || q.detail ? '<small>' + esc(q.sub || q.detail) + '</small>' : '') + '</span></li>';
    }).join('');
    var n = list.filter(function (q) { return q.done; }).length;
    var st = J('stars');
    if (st) {
      st.setAttribute('aria-label', n + ' of 3 quest stars');
      st.innerHTML = list.slice(0, 3).map(function (q) { return '<svg class="ic' + (q.done ? ' on' : '') + '" aria-hidden="true"><use href="' + ICONS + '#i-star"/></svg>'; }).join('');
    }
    list.slice(0, 3).forEach(function (q, i) { if (q.done && prev[i] === false) popEl(qs('.quest__box', ul.children[i])); });
  }
  var WIN_KIND = {
    floor: ['check', '--mint'], target: ['target', '--reward-ink'], crown: ['target', '--reward-ink'], output: ['trophy', '--reward-ink'], comeback: ['building-2', '--reward-ink'],
    week: ['calendar-check', '--mint'], week_kept: ['calendar-check', '--mint'], node: ['landmark', '--accent'], level: ['star', '--accent'], district: ['building-2', '--accent'],
    achievement: ['sparkles', '--accent'], seal: ['moon', '--accent'], close: ['moon', '--accent'], rest: ['tent-tree', '--rest'], honest: ['shield-check', '--rest'], record: ['sparkles', '--accent'],
  };
  function whenTxt(at) {
    var t = typeof at === 'number' ? at : Date.parse(at); if (!isFinite(t)) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60); if (h < 20) return h + 'h ago';
    var d = Math.round(m / 1440); return d <= 1 ? 'yesterday' : d + ' days ago';
  }
  /* ---------- which day it is + minutes past the sleep cutoff (plain words, from the server) ---------- */
  function renderRollover(R) {
    var box = J('rollover-note'); if (!box || !R) return;
    var d = J('rollover-day'), c = J('rollover-cutoff');
    if (d) d.textContent = R.day_text || '';
    if (c) c.textContent = (R.day_text && R.cutoff_text ? ' ' : '') + (R.cutoff_text || '');
    box.hidden = !(R.day_text || R.cutoff_text);
  }
  function renderWins(list) {
    var ul = J('wins'); if (!ul || !Array.isArray(list)) return;
    var seen = ul._seen || null, keys = [];
    ul.innerHTML = list.slice(0, 5).map(function (w) {
      var kind = String(w.kind || '').toLowerCase(), cat = w.category && CAT[w.category];
      var k = WIN_KIND[kind] || (cat ? [cat.icon, cat.v] : ['terminal', '--muted']);
      var icon = w.icon || k[0], cc = w.color_var || k[1];
      var text = w.text || w.label || w.title || '', key = text + '|' + (w.at || w.when || '');
      keys.push(key);
      var fresh = seen && seen.indexOf(key) < 0 && !reduced();
      var when = w.when || (w.at ? whenTxt(w.at) : '');
      var extra = [w.detail, when].filter(Boolean).join(' · ');
      return '<li class="win' + (fresh ? ' is-new' : '') + '"><svg class="ic" aria-hidden="true" style="--cc:var(' + esc(cc) + ')"><use href="' + ICONS + '#i-' + esc(icon) + '"/></svg><span>' + esc(text) + (extra ? '<small>' + esc(extra) + '</small>' : '') + '</span></li>';
    }).join('');
    ul._seen = keys;
  }
  function renderRepeat(list) {
    var box = J('repeat-chips'); if (!box || !Array.isArray(list)) return;
    box.innerHTML = list.slice(0, 3).map(function (r) {
      var cat = r.category || r.cat || '', c = catOf(cat), note = r.note || r.text || '', mins = num(r.minutes);
      var deep = has(r, 'deep') ? !!r.deep : c.deep;
      return '<button class="chipbtn" type="button" data-category="' + esc(cat) + '" data-minutes="' + mins + '" data-note="' + esc(note) + '" data-deep="' + (deep ? 1 : 0) + '" data-rest="' + (r.rest || cat === 'Rest' ? 1 : 0) + '">' +
        ico('rotate-ccw') + '<span>' + esc(fmtMin(mins)) + ' ' + esc(note || c.label) + '</span><small>' + esc(c.label) + '</small></button>';
    }).join('') || '<span class="small muted">Your last three logs show up here.</span>';
  }

  /* ====================================================================== world slots (days) */
  function expandLamps(lamps) {
    var out = [];
    (lamps || []).forEach(function (l) { var c = catOf(l.category); for (var i = 0; i < Math.max(1, num(l.n, 1)); i++) out.push(c.hex); });
    return out.slice(0, 8);
  }
  function normDay(d, cfgTargetFloor) {
    var deep = num(d.deep_minutes), floors = has(d, 'floors') ? num(d.floors) : clamp(Math.floor(deep / CONFIG.minutes_per_floor), 0, CONFIG.max_floors);
    var outs = Array.isArray(d.outputs) ? d.outputs : [];
    var tf = num(d.target_floor, cfgTargetFloor || 6);
    var status = d.status || 'open';
    var doors = has(d, 'floor_met') ? !!d.floor_met : (status === 'floor' || status === 'repaired' || outs.length > 0 || deep >= CONFIG.floor_min);
    var crown = has(d, 'target_met') ? !!d.target_met : (tf > 0 && floors >= tf && doors);
    var future = status === 'future' || status === 'before_start';
    return { date: d.date, dow: has(d, 'dow') ? num(d.dow) : dowOf(d.date), isToday: !!d.is_today || d.date === ST.today, status: status, future: future, deep: deep, floors: future ? 0 : floors,
      targetFloor: tf, doors: !future && doors, crown: !future && crown, over: num(d.over_cap_min), lamps: d.lamps || [], fog: num(d.fog_minutes), outputs: outs, mark: d.mark || null,
      comeback: !!d.is_comeback, closed: !!d.closed, stars: num(d.stars), n: slotNumber(d.date, d.slot) };
  }
  /* the day's place in the year of lots (the n-th lot of home.json), or -1 for a day with no lot: before Day 1, or after the last lot */
  function slotNumber(date, slot) {
    if (slot && typeof slot === 'object') return slot.lot === false ? -1 : num(slot.n, -1);
    var n = Math.round((parseDate(date) - parseDate(ST.dayOne)) / 86400000), lim = ST.world && ST.world.year ? num(ST.world.year.slots, 365) : 365;
    return isFinite(n) && n >= 0 && n < lim ? n : -1;
  }
  function blankDay(date, today) {
    return { date: date, dow: dowOf(date), isToday: date === today, status: date > today ? 'future' : 'before_start', future: true, deep: 0, floors: 0, targetFloor: 6, doors: false, crown: false, over: 0, lamps: [], fog: 0, outputs: [], mark: null, comeback: false, closed: false, stars: 0, n: slotNumber(date, null) };
  }
  function slotsFor(mode) {
    var w = ST.world; if (!w || !Array.isArray(w.days)) return null;
    var today = w.today || ST.today, mon = mondayOf(today), start = mode === 'city' ? addDays(mon, -21) : mon, n = mode === 'city' ? 28 : 7;
    if (mode === 'year') {          // every day of the year so far: from the Monday of Day 1's week to this Sunday (the 3D scenes get this list)
      start = mondayOf(ST.dayOne || (w.days[0] && w.days[0].date) || today); n = Math.max(7, Math.round((parseDate(mon) - parseDate(start)) / 86400000) + 7);
    }
    var byDate = {}; w.days.forEach(function (d) { byDate[d.date] = d; });
    var tf = w.config && w.config.target_weekday ? Math.round(w.config.target_weekday / (w.config.minutes_per_floor || 15)) : 6;
    var out = [];
    for (var i = 0; i < n; i++) { var ds = addDays(start, i); out.push(byDate[ds] ? normDay(byDate[ds], tf) : blankDay(ds, today)); }
    return out;
  }
  function cityDay(s) {
    var st = s.status;
    if (st === 'before_start' || st === 'future') st = 'future';
    else if (st === 'skip') st = 'rest';
    else if (st === 'repaired') st = 'floor';
    return { floors: s.floors, targetFloor: s.targetFloor, status: st, doors: s.doors, crown: s.crown, lamps: expandLamps(s.lamps),
      beacons: s.outputs.map(function (o) { return catOf(o.stage).hex; }), isToday: s.isToday, fog: s.fog, scaffold: !!s.scaffold, stars: s.stars | 0, n: s.n, date: s.date };
  }
  function visualStatus(s) {
    if (s.future) return 'future';
    if (s.status === 'rest' || s.status === 'skip') return s.doors ? 'floor' : 'rest';
    if (s.crown) return 'target';
    if (s.doors) return 'floor';
    if (s.status === 'missed') return 'missed';
    return s.deep > 0 ? 'started' : 'open';
  }
  function dayInfoText(s) {
    var vs = visualStatus(s), bits = [s.future ? 'Not yet' : fmtMin(s.deep) + ' deep'];
    if (!s.future) {
      bits.push(s.outputs.length ? s.outputs.length + ' output' + (s.outputs.length > 1 ? 's' : '') : 'no outputs');
      bits.push(STATUS_TXT[vs] || 'In progress');
      var lamps = s.lamps.reduce(function (a, l) { return a + num(l.n, 1); }, 0);
      if (lamps) bits.push(lamps + ' honest log' + (lamps > 1 ? 's' : ''));
      if (s.fog) bits.push(fmtMin(s.fog) + ' foggy');
    }
    return bits.join(' · ');
  }

  /* ---------- flat skyline (re-rendered from data, same classes the server uses) ---------- */
  function skylineSVG(slots, rows) {
    var g = '', i, f;
    if (rows === 1) {
      g += '<rect class="gr" x="0" y="196" width="420" height="24"/>';
      slots.forEach(function (s, k) {
        var x = 22 + k * 57, fl = s.future ? 0 : s.floors, h = Math.max(6, fl * 10), y = 196 - h, vs = visualStatus(s);
        var cls = 'b' + (vs === 'target' ? ' t' : vs === 'floor' ? ' f' : '') + (s.isToday ? ' today' : '');
        g += '<rect class="' + cls + '" x="' + x + '" y="' + y + '" width="42" height="' + h + '" rx="4"/>';
        for (f = 0; f < fl; f++) g += '<rect class="win lit" x="' + (x + 8) + '" y="' + (196 - f * 10 - 8) + '" width="8" height="5" rx="1.5"/><rect class="win lit" x="' + (x + 26) + '" y="' + (196 - f * 10 - 8) + '" width="8" height="5" rx="1.5"/>';
        if (vs === 'rest') g += '<circle class="park" cx="' + (x + 21) + '" cy="186" r="7"/>';
        if (s.fog) g += '<ellipse class="fog" cx="' + (x + 21) + '" cy="188" rx="24" ry="8"/>';
        var lampN = Math.min(4, s.lamps.reduce(function (a, l) { return a + num(l.n, 1); }, 0));
        for (i = 0; i < lampN; i++) g += '<circle class="lamp" cx="' + (x + 8 + i * 9) + '" cy="206" r="3"/>';
        if (s.outputs.length) g += '<circle class="beacon" cx="' + (x + 21) + '" cy="' + (y - 8) + '" r="5" style="fill:' + hexStr(catOf(s.outputs[0].stage).hex) + '"/>';
      });
      return '<svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMax meet" focusable="false">' + g + '</svg>';
    }
    for (var r = 0; r < rows; r++) {
      var y0 = 84 + r * 66; g += '<rect class="gr" x="0" y="' + y0 + '" width="420" height="5" opacity="' + (0.4 + r * 0.2) + '"/>';
      for (var c = 0; c < 7; c++) {
        var s = slots[r * 7 + c]; if (!s) continue;
        var x2 = 22 + c * 57, fl2 = s.future ? 0 : s.floors, h2 = Math.max(4, fl2 * 3.8), vs2 = visualStatus(s);
        var cls2 = 'b' + (vs2 === 'target' ? ' t' : vs2 === 'floor' ? ' f' : '') + (s.isToday ? ' today' : '');
        g += '<rect class="' + cls2 + '" x="' + x2 + '" y="' + (y0 - h2) + '" width="40" height="' + h2 + '" rx="3" opacity="' + (0.55 + r * 0.15) + '"/>';
      }
    }
    return '<svg viewBox="0 0 420 300" preserveAspectRatio="xMidYMax meet" focusable="false">' + g + '</svg>';
  }
  function renderFallbacks() {
    JJ('stage').forEach(function (host) {
      var mode = host.dataset.stage === 'city' ? 'city' : 'week', slots = slotsFor(mode), fb = J('fallback', host);
      if (!slots || !fb) return;
      fb.innerHTML = skylineSVG(slots, mode === 'city' ? 4 : 1);
    });
  }

  /* ---------- day buttons + cards ---------- */
  function renderDayBtns() {
    var box = J('day-btns'); if (!box) return;
    var slots = slotsFor('week'); if (!slots) return;
    box.innerHTML = slots.map(function (s, k) {
      var vs = visualStatus(s);
      return '<button class="daybtn' + (s.isToday ? ' is-today' : '') + '" type="button" data-k="' + k + '" data-st="' + vs + '" aria-pressed="' + (ST.pickedWeek === k) + '" aria-label="' + esc(DAYFULL[k] + ': ' + dayInfoText(s)) + '"><span>' + DAY3[k] + '</span>' + ico(STATUS_ICON[vs] || 'pen-line') + '<span class="num">' + (s.future ? '' : esc(fmtMin(s.deep).replace(' ', ''))) + '</span></button>';
    }).join('');
  }
  function showDayCard(host, slot) {
    var el = host && J('day-card', host); if (!el) return;
    if (!slot) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<b>' + esc(labelDate(slot.date)) + '</b><p>' + esc(dayInfoText(slot)) + '</p><button type="button" aria-label="Close day card">' + ico('x') + '</button>';
    qs('button', el).addEventListener('click', function () {
      el.hidden = true; var mode = host.dataset.stage === 'city' ? 'city' : 'week';
      if (scenes[mode]) scenes[mode].pick(-1);
      if (mode === 'week') { ST.pickedWeek = -1; renderDayBtns(); }
    });
  }
  function onPick(mode, i) {
    var slots = slotsFor(mode === 'city' ? 'year' : mode), host = qs('[data-js="stage"][data-stage="' + mode + '"]');
    if (!slots) return;
    if (mode === 'week') { ST.pickedWeek = i; renderDayBtns(); }
    showDayCard(host, i >= 0 ? slots[i] : null);
  }

  /* ---------- world panels: totals, stamp card, ghost chart ---------- */
  function currentWeek(w) {
    if (!w || !Array.isArray(w.weeks) || !w.weeks.length) return null;
    var mon = mondayOf(w.today || ST.today);
    return w.weeks.filter(function (x) { return x.monday === mon; })[0] || w.weeks[w.weeks.length - 1];
  }
  function renderTotals(w) {
    var box = J('totals'); if (!box || !w || !w.totals) return;
    var t = w.totals, items = [[Math.floor(num(t.deep_minutes) / 60) + 'h', 'Deep hours'], [num(t.days_shown_up), 'Days shown up'], [num(t.outputs), 'Outputs'], [num(t.weeks_kept), 'Weeks kept'], [num(t.comebacks), 'Comebacks'], [num(t.best_run), 'Best run']];
    box.innerHTML = items.map(function (it) { return '<div class="total"><b class="num">' + esc(it[0]) + '</b><span>' + it[1] + '</span></div>'; }).join('');
  }
  /* World > City badge: "Your year · N towers" (N = days with a tower in the year of lots) */
  function renderYear(w) {
    var el = J('year-badge'); if (!el || !w || !w.year) return;
    var n = num(w.year.built); el.textContent = 'Your year \u00b7 ' + n + (n === 1 ? ' tower' : ' towers');
  }
  function slotRow(box, n, cls, icon, on) {
    if (!box) return;
    if (box.children.length !== n) box.innerHTML = Array.apply(null, Array(n)).map(function () { return '<span class="slot' + cls + '">' + ico(icon) + '</span>'; }).join('');
    qsa('.slot', box).forEach(function (el, i) { var was = el.classList.contains('on'); el.classList.toggle('on', i < on); if (i < on && !was && box._ready) popEl(el, 'pop'); });
    box._ready = true;
  }
  /* The Week panel can be rendered by the server for another week (?week=); the live data is the current week's, so leave that card alone. */
  function viewingOtherWeek(w) {
    var panel = qs('[data-js="world-panel"][data-week-monday]');
    return !!panel && panel.dataset.weekMonday !== mondayOf((w && w.today) || ST.today);
  }
  function renderStamp(w) {
    if (viewingOtherWeek(w)) return;
    var wk = currentWeek(w); if (!wk || !J('out-slots')) return;
    var oReq = firstDef(wk.outputs_required, 2), fReq = firstDef(wk.floor_days_required, 5), skips = num(wk.skips_used) + num(wk.skips_left, 2);
    slotRow(J('out-slots'), oReq, '', 'trophy', num(wk.outputs));
    slotRow(J('floor-pips'), fReq, ' slot--pip', 'check', num(wk.floor_days));
    slotRow(J('rest-pips'), skips, ' slot--pip slot--rest', 'tent-tree', num(wk.skips_used));
    var set = function (n, v) { var el = J(n); if (el) el.textContent = v; };
    set('out-req', oReq); set('floor-req', fReq); set('rest-req', skips);
    set('out-count', Math.min(num(wk.outputs), oReq)); set('floor-day-count', Math.min(num(wk.floor_days), fReq)); set('rest-count', num(wk.skips_used));
    var note = J('stamp-note');
    if (note) {
      var oLeft = Math.max(0, oReq - num(wk.outputs)), fLeft = Math.max(0, fReq - num(wk.floor_days));
      note.textContent = wk.status === 'kept' ? 'Card complete. The week is kept and the row is lit.' : oLeft + ' output' + (oLeft === 1 ? '' : 's') + ' and ' + fLeft + ' floor day' + (fLeft === 1 ? '' : 's') + ' to go. Monday starts a fresh card.';
    }
  }
  function renderGhostChart(w) {
    var box = J('ghost-chart'); if (!box || !w || viewingOtherWeek(w)) return;
    var slots = slotsFor('week'), last = w.ghost && w.ghost.last_week_deep_by_dow || [];
    if (!slots) return;
    if (box.children.length !== 7) box.innerHTML = DAY3.map(function () { return '<div class="gcol"><i class="g"></i><i class="n"></i></div>'; }).join('');
    var max = Math.max(60, num(w.config && w.config.target_weekday, 90));
    slots.forEach(function (s) { max = Math.max(max, s.deep); }); last.forEach(function (v) { max = Math.max(max, num(v)); });
    slots.forEach(function (s, k) {
      var col = box.children[k]; if (!col) return;
      col.children[0].style.height = Math.round(num(last[k]) / max * 88) + 'px';
      col.children[1].style.height = s.future ? '0px' : Math.round(s.deep / max * 88) + 'px';
      col.children[1].style.minBlockSize = s.future ? '0' : '';
    });
    var dbox = J('ghost-days');
    if (dbox) { if (dbox.children.length !== 7) dbox.innerHTML = DAY3.map(function (d) { return '<span>' + d[0] + '</span>'; }).join(''); qsa('span', dbox).forEach(function (el, k) { el.style.color = k === dowOf(ST.today) ? 'var(--reward-ink)' : ''; }); }
  }

  /* ---------- shelf (achievements + ladders) from GET /api/shelf ---------- */
  function renderShelf(sh) {
    if (!sh) return;
    var grid = J('ach-grid');
    if (grid && Array.isArray(sh.achievements)) {
      var prevOn = {}; qsa('.achi', grid).forEach(function (el) { prevOn[el.dataset.key] = el.classList.contains('on'); });
      var n = 0;
      grid.innerHTML = sh.achievements.map(function (a) {
        if (a.unlocked) n++;
        return '<div class="achi' + (a.unlocked ? ' on' : '') + '" data-key="' + esc(a.key) + '">' + ico(a.icon || ACH_ICON[a.key] || 'sparkles') + '<span class="tier">' + esc(a.tier || '') + '</span><b>' + esc(a.name) + '</b><small>' + esc(a.desc || a.rule || '') + '</small></div>';
      }).join('');
      qsa('.achi.on', grid).forEach(function (el) { if (prevOn[el.dataset.key] === false) { el.classList.add('just'); later(1200, function () { el.classList.remove('just'); }); } });
      var cnt = J('ach-count'); if (cnt) cnt.textContent = n;
      var tot = J('ach-total'); if (tot) tot.textContent = sh.achievements.length;
    }
    var lad = J('ladders');
    if (lad && Array.isArray(sh.ladders)) {
      lad.innerHTML = sh.ladders.map(function (l) {
        var c = catOf(l.category), nodes = l.nodes || [], unlocked = nodes.filter(function (x) { return x.unlocked; }).length, txt;
        if (unlocked >= nodes.length && nodes.length) txt = (l.landmark || 'Landmark') + ' complete. ' + num(l.outputs) + ' outputs, ' + Math.floor(num(l.deep_minutes) / 60) + 'h.';
        else if (l.next_node) {
          var nn = l.next_node, bits = [], dOut = num(nn.needs_outputs) - num(l.outputs), dMin = num(nn.needs_deep_min) - num(l.deep_minutes), dLink = num(nn.needs_link) - num(l.linked);
          if (dOut > 0) bits.push(dOut + ' more output' + (dOut > 1 ? 's' : ''));
          if (dMin > 0) bits.push(fmtMin(dMin) + ' of ' + l.category);
          if (dLink > 0) bits.push(dLink + ' with a link');
          txt = 'Next: ' + nn.name + (bits.length ? ' · ' + bits.join(' and ') : ' · ready');
        } else txt = '';
        var key = String(l.category).replace(/\W/g, '').toLowerCase();
        var lc = { python: 'lc-python', math: 'lc-math', mldl: 'lc-ml', papers: 'lc-papers', writingx: 'lc-writing' }[key] || '';
        return '<div class="ladder ' + lc + '"><span class="ladder__ic">' + ico(c.icon) + '</span><div><b>' + esc(l.category) + ' · ' + esc(l.landmark || '') + '</b><div class="nodes">' +
          [0, 1, 2, 3, 4].map(function (i) { return '<i' + (i < unlocked ? ' class="on"' : '') + '></i>'; }).join('') + '</div><small>' + unlocked + ' of ' + (nodes.length || 5) + (txt ? ' · ' + esc(txt) : '') + '</small></div></div>';
      }).join('');
    }
  }
  function loadShelf() {
    if (!J('ach-grid') && !J('ladders')) return Promise.resolve();
    return api.get('/api/shelf').then(function (sh) { ST.shelf = sh; renderShelf(sh); }).catch(function () { /* server page stays */ });
  }

  /* ====================================================================== 3D scenes (optional, on demand) */
  var scenes = { week: null, city: null }, cityMod = null, loadP = null, sceneBuilding = {};
  function hourLocal() { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function hourNY() {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
      return (+p.filter(function (x) { return x.type === 'hour'; })[0].value % 24) + (+p.filter(function (x) { return x.type === 'minute'; })[0].value) / 60;
    } catch (e) { return hourLocal(); }
  }
  function hourFn() { return prefs.ny ? hourNY() : hourLocal(); }
  function threeOn() { return prefs.three !== 'off'; }
  function ensureImportMap() {
    if (qs('script[type="importmap"]')) return;
    var s = DOC.createElement('script'); s.type = 'importmap';
    s.textContent = JSON.stringify({ imports: { 'three': new URL('three/three.module.js', VENDOR).href, 'three/addons/': new URL('three/addons/', VENDOR).href } });
    DOC.head.appendChild(s);
  }
  function loadMod() {
    if (!loadP) {
      ensureImportMap();
      loadP = import(new URL('city.js', BASE).href).then(function (m) { cityMod = m; return m; }).catch(function (e) {
        console.warn('3D unavailable, keeping the flat skyline', e);
        JJ('stage').forEach(function (h) { h.classList.add('no-webgl'); });
        return null;
      });
    }
    return loadP;
  }
  function pushScene(mode, animate) {
    var sc = scenes[mode], slots = slotsFor('year'); if (!sc || !slots) return;
    try {
      sc.setDays(slots.map(cityDay), { animate: animate });       // the whole year of lots; the framed stages (week) number their slots by weekday
      sc.setLandmarks((ST.world.landmarks || []).map(function (l) { return { ladder: l.ladder, sections: num(l.nodes_unlocked), bin: l.bin }; }), { animate: animate });
      pushDistricts(sc);
      callScene(sc, 'setEconomy', ST.world.economy);              // the figure, its outfit and routine, tower upgrades, gold crowns, the home (city/character.js, mh_home.js)
    } catch (e) { console.warn('scene update', e); }
    pushAtmosphere(sc);
  }
  /* the district ladder: which neighbourhoods are lit, and the dream home on Billionaires' Row (epoch/game.py districts_block) */
  function pushDistricts(sc) {
    var d = ST.world && ST.world.districts; if (!d || !sc) return;
    callScene(sc, 'setUnlockedDistricts', d.unlocked);
    var h = d.dream_home;
    if (h) callScene(sc, 'setDreamHome', { bin: h.bin, lit: !!h.lit, name: h.name, copy: { locked: h.locked, lockedSub: h.locked_sub, unlocked: h.unlocked, unlockedSub: h.unlocked_sub } });
  }
  /* weather, seasonal decorations, flow and the construction state are optional city.js features: skip silently when missing */
  function callScene(sc, fn, arg) { try { if (sc && typeof sc[fn] === 'function' && arg !== undefined && arg !== null) sc[fn](arg); } catch (e) { /* optional */ } }
  function pushAtmosphere(sc) {
    callScene(sc, 'setWeather', ST.weather);
    callScene(sc, 'setSeasonal', ST.seasonal);
    callScene(sc, 'setFlow', ST.flow);
  }
  function pushAtmosphereAll() { Object.keys(scenes).forEach(function (k) { pushAtmosphere(scenes[k]); }); }
  function pushScenes(animate) { pushScene('week', animate); pushScene('city', animate); renderFallbacks(); renderDayBtns(); }
  /* the cutaway room of the user's home (city/room.js). The window is rendered by a live city scene when there is one. */
  function openRoom() {
    var sc = scenes.city || scenes.week, econ = ST.world && ST.world.economy, fetchE = function () { return api.get('/api/economy'); };
    if (sc && typeof sc.openRoom === 'function') return sc.openRoom({ econ: econ, fetchEconomy: fetchE });
    ensureImportMap();
    return import(new URL('city/room.js', BASE).href).then(function (m) {
      return econ ? m.openRoom({ econ: econ, fetchEconomy: fetchE }) : fetchE().then(function (e) { return m.openRoom({ econ: e }); });
    }).catch(function (e) { console.warn('room', e); });
  }
  function ensureScene(host) {
    var mode = host.dataset.stage === 'city' ? 'city' : 'week';
    if (scenes[mode] || sceneBuilding[mode]) return Promise.resolve(scenes[mode]);
    if (!threeOn() || prefs.three === 'off') { host.classList.add('use-svg'); return Promise.resolve(null); }
    host.classList.remove('use-svg');
    sceneBuilding[mode] = true;
    return loadMod().then(function (m) {
      sceneBuilding[mode] = false;
      if (!m) return null;
      var sc = null;
      try { sc = m.createCity(host, { mode: mode, hour: hourFn, motion: !reduced(), onPick: function (i) { onPick(mode, i); } }); } catch (e) { console.warn('3D scene', e); sc = null; }
      if (!sc) { host.classList.add('no-webgl'); return null; }
      host.classList.add('is-3d'); scenes[mode] = sc;
      pushScene(mode, false);
      return sc;
    });
  }
  function ensureScenes() {
    if (prefs.three === 'off') { applyThree(); return; }
    JJ('stage').forEach(function (host) {
      if (host.closest('[hidden]')) return;      // a hidden World panel builds its scene when it is shown
      ensureScene(host);
    });
  }
  function applyThree() {
    var off = prefs.three === 'off';
    JJ('stage').forEach(function (h) { h.classList.toggle('use-svg', off); });
    Object.keys(scenes).forEach(function (k) { if (scenes[k]) scenes[k].pause(off || DOC.hidden); });
    if (!off) ensureScenes();
  }
  function applyMotionToScenes() { Object.keys(scenes).forEach(function (k) { if (scenes[k]) scenes[k].setMotion(!reduced()); }); }

  /* ====================================================================== data refresh */
  function applyToday(data) {
    if (!data) return;
    ST.today = data.date || data.local_date || (typeof data.today === 'string' ? data.today : ST.today);
    if (data.day_number != null) {
      ST.dayNumber = num(data.day_number, 1); if (data.day_one) ST.dayOne = data.day_one;
      var el = J('day-line'); if (el && data.day_line) el.textContent = data.day_line;
      var et = J('day-tag'); if (et) et.textContent = 'Day ' + ST.dayNumber;
    }
    var T = normToday(data);
    if (T) { ST.T = T; renderRing(T); }
    var L = normLevel(data.level); if (L) { ST.level = L; renderLevel(L); }
    var run = firstDef(data.run, data.totals && data.totals.run); if (run && typeof run === 'object') run = run.current;      // /api/today sends {current, best}
    if (run != null) { ST.run = num(run); renderRun(ST.run); }
    if (Array.isArray(data.quests)) { ST.quests = data.quests; renderQuests(data.quests); }
    if (data.rollover) renderRollover(data.rollover);
    if (Array.isArray(data.wins)) renderWins(data.wins);
    var rep = data.repeat || data.repeat_chips; if (Array.isArray(rep)) renderRepeat(rep);
    if (data.close_dot !== undefined) { var cd = J('close-dot'); if (cd) cd.hidden = !data.close_dot; }
    if (data.flow) { ST.flow = data.flow; renderFlow(data.flow); }
    if (Array.isArray(data.seasonal)) { ST.seasonal = data.seasonal; renderSeasonal(data.seasonal); }
    if (data.flow || Array.isArray(data.seasonal)) pushAtmosphereAll();
  }
  function applyWorld(w, animate) {
    if (!w) return;
    ST.world = w; ST.today = w.today || ST.today;
    if (w.day_one) ST.dayOne = w.day_one;
    if (w.config) Object.keys(w.config).forEach(function (k) { if (w.config[k] != null) CONFIG[k] = w.config[k]; });
    if (Array.isArray(w.seasonal)) ST.seasonal = w.seasonal;
    var L = normLevel(w.level); if (L && !ST.level) { ST.level = L; renderLevel(L); }
    if (w.totals && w.totals.run != null && ST.run == null) { ST.run = num(w.totals.run); renderRun(ST.run); }
    renderTotals(w); renderYear(w); renderStamp(w); renderGhostChart(w); renderGhost();
    pushScenes(animate);
  }
  var wantWorld = function () { return !!(J('stage') || J('day-btns') || J('totals') || J('out-slots') || J('ghost-chart')); };
  function worldDays() { return 'all'; }                         // every day since Day 1: the 3D scenes show the whole year of lots
  function refreshToday() { return api.get('/api/today').then(applyToday).catch(function () { /* server page stays */ }); }
  function refreshWorld(animate) {
    if (!wantWorld()) return Promise.resolve();
    return api.get('/api/world?days=' + worldDays()).then(function (w) { applyWorld(w, animate); }).catch(function () { /* server page stays */ });
  }
  function refreshAll(animate) {
    ST.lastFetch = Date.now();
    return Promise.all([refreshToday(), refreshWorld(animate), loadShelf()]).then(function (r) {
      try { DOC.dispatchEvent(new CustomEvent('witness:refreshed')); } catch (e) { /* older browsers */ }
      return r;
    });
  }

  /* patch today's tower locally so the 3D reacts within the first frame, before the refetch confirms it */
  function patchToday(T, entry) {
    var w = ST.world; if (!w || !Array.isArray(w.days) || !T) return;
    var d = w.days.filter(function (x) { return x.date === (w.today || ST.today); })[0];
    if (!d) { d = { date: w.today || ST.today, is_today: true, status: 'open', lamps: [], outputs: [], fog_minutes: 0 }; w.days.push(d); }
    d.deep_minutes = T.deep; d.floors = T.floors; d.floor_met = T.floorMet; d.target_met = T.targetMet; d.over_cap_min = T.over;
    if (T.floorMet && (d.status === 'open' || d.status === 'missed')) d.status = 'floor';
    if (entry && entry.deep === false && entry.category) {
      d.lamps = d.lamps || [];
      var l = d.lamps.filter(function (x) { return x.category === entry.category; })[0];
      if (l) l.n = num(l.n, 1) + 1; else d.lamps.push({ category: entry.category, n: 1 });
    }
    pushScenes(true);
  }

  /* ====================================================================== events (celebrations) */
  var KIND = { log: 'log', floor: 'floor', target: 'crown', crown: 'crown', output: 'output', ship: 'output', shipped: 'output', node: 'node', ladder_node: 'node', ladder: 'node',
    comeback: 'comeback', crane: 'comeback', repair: 'repair', repaired: 'repair', week: 'week', week_kept: 'week', kept: 'week', level: 'level', level_up: 'level', district: 'district',
    achievement: 'achievement', ach: 'achievement', seal: 'seal', sealed: 'seal', close: 'seal', rest: 'rest', skip: 'rest', day_mark: 'rest', fog: 'fog', unfog: 'fog', postcard: 'postcard' };
  function kindOf(e) { return KIND[String(e && e.kind || '').toLowerCase()] || 'other'; }
  function ladderOf(e) { return (e.fx && (e.fx.ladder || e.fx.stage)) || e.ladder || e.stage || e.category || ''; }
  function playEvents(events, ctx) {
    if (!Array.isArray(events) || !events.length) return;
    ctx = ctx || {};
    var delay = ctx.startDelay == null ? 420 : ctx.startDelay;
    var queue = function (fn) { later(delay, fn); delay += 520; };
    var shown = function (el) { if (!el) return null; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth ? el : null; };
    var heroEl = function () { return shown(J('ring-wrap')) || shown(J('hud-deep')) || shown(J('log-btn')) || J('home-stage') || DOC.body; };
    var stageEl = function () { return shown(qs('[data-js="stage"]:not([data-source-only])')) || shown(J('home-stage')) || heroEl(); };
    var today = ST.today, todayIdx = dowOf(today);
    events.forEach(function (e) {
      var k = kindOf(e), fx = e.fx || {}, text = joinFact(e.title, e.detail), count = fx.confetti > 0 ? fx.confetti : 0;
      var dup = !!ctx.receiptText && text.replace(/[.!\s]+$/, '') === String(ctx.receiptText).replace(/[.!\s]+$/, '');   // the receipt toast already says this
      if (k === 'log') { if (!ctx.receiptShown && !ctx.skipReceipt) toast({ icon: 'check', title: text }); if (fx.sound) sfx(fx.sound); return; }
      if (k === 'fog' || k === 'postcard') { if (text) queue(function () { toast({ icon: k === 'fog' ? 'cloud-fog' : 'sparkles', tone: 'violet', title: text }); }); return; }
      if (!gameOn() && k !== 'seal' && k !== 'rest' && String(e && e.kind || '').toLowerCase() !== 'notice') return;
      if (k === 'floor') queue(function () { if (!dup) toast({ icon: 'check', tone: 'mint', title: text }); burst('floor', heroEl(), { count: count }); sfx(fx.sound || 'ping'); popEl(J('ring-wrap'), 'pop-ring'); });
      else if (k === 'crown') queue(function () { toast({ icon: 'target', title: text }); burst('crown', heroEl(), { count: count }); sfx(fx.sound || 'ping'); if (scenes.week) scenes.week.pulse(todayIdx); });
      else if (k === 'output') queue(function () {
        var lad = ladderOf(e), c = lad && CAT[lad];
        if (!dup) toast({ icon: 'trophy', tone: 'violet', title: text }); burst('output', stageEl(), { count: count, colors: c ? [hexStr(c.hex)] : null }); sfx(fx.sound || 'levelUp');
        if (lad) { if (scenes.week) scenes.week.nudgeLandmark(lad); if (scenes.city) scenes.city.nudgeLandmark(lad); }
      });
      else if (k === 'node') queue(function () {
        var lad = ladderOf(e), c = lad && CAT[lad];
        toast({ icon: (c && c.icon) || 'landmark', title: text }); burst('output', stageEl(), { count: count, colors: c ? [hexStr(c.hex)] : null }); sfx(fx.sound || 'levelUp');
        if (lad) { if (scenes.week) scenes.week.nudgeLandmark(lad); if (scenes.city) scenes.city.nudgeLandmark(lad); }
        loadShelf();
      });
      else if (k === 'comeback') queue(function () {
        if (scenes.week) scenes.week.craneAt(todayIdx);
        if (scenes.city) { var slots = slotsFor('year'); if (slots) scenes.city.craneAt(slots.map(function (s) { return s.date; }).indexOf(today)); }
        burst('comeback', stageEl(), { count: count }); sfx(fx.sound || 'levelUp');
        toast({ icon: 'building-2', title: text });
        showMoment({ icon: 'building-2', title: "You're back.", text: 'The crane lifted today\'s first floor into place and the scaffolding is coming down.', cta: 'Back to the city' });
      });
      else if (k === 'repair') queue(function () { toast({ icon: 'building-2', tone: 'violet', title: text }); burst('small', stageEl(), { count: count }); sfx(fx.sound || 'levelUp'); if (scenes.week) scenes.week.pulse(todayIdx); });
      else if (k === 'week') queue(function () {
        if (scenes.week && !reduced()) for (var i = 0; i < 7; i++) (function (n) { later(n * 100, function () { scenes.week.pulse(n); }); })(i);
        burst('week', stageEl(), { count: count }); sfx(fx.sound || 'levelUp');
        showMoment({ icon: 'calendar-check', title: e.title || 'Card complete.', text: e.detail || 'The whole row of towers is lit.', cta: 'See the week' });
        loadShelf();
      });
      else if (k === 'level') { if (!quiet()) queue(function () { toast({ icon: 'star', title: text }); sfx(fx.sound || 'ping'); popEl(J('level-badge')); }); }
      else if (k === 'district') { if (!quiet()) queue(function () {
        burst('district', stageEl(), { count: count }); sfx(fx.sound || 'levelUp');
        var dream = fx.district_id === 'billionaires-row';
        showMoment({ icon: fx.icon || DISTRICT_ICON[fx.district || e.title] || 'building-2', title: e.title || 'New district', text: e.detail || 'A new district on the road. Nothing was spent to get here.', cta: dream ? 'See the window' : 'Look around',
          onOk: function () { if (scenes.city) { if (fx.regions) callScene(scenes.city, 'setUnlockedDistricts', fx.regions); if (dream) { callScene(scenes.city, 'setDreamHome', { lit: true }); callScene(scenes.city, 'flyTo', 'dream'); } } } });
      }); }
      else if (k === 'achievement') { if (!quiet()) queue(function () { toast({ icon: fx.icon || ACH_ICON[fx.key] || 'sparkles', title: text }); if (count || e.size === 'medium') burst('small', qs('[data-js="ach-grid"]') || heroEl(), { count: count }); sfx(fx.sound || 'ping'); loadShelf(); }); }
      else if (k === 'seal') { /* the seal flow plays its own ritual */ }
      else if (k === 'rest') queue(function () { toast({ icon: 'tent-tree', tone: 'violet', title: text }); if (fx.sound) sfx(fx.sound); });
      else queue(function () { toast({ icon: 'sparkles', tone: 'violet', title: text }); if (count) burst('small', heroEl(), { count: count }); if (fx.sound) sfx(fx.sound); });
    });
  }
  function applyWriteResult(res, o) {
    o = o || {};
    var before = ST.T ? { floors: ST.T.floors } : { floors: 0 }, lvBefore = ST.level;
    var T = normToday(res);
    if (T) { ST.T = T; renderRing(T, { pop: !!(o.entry && o.entry.deep) || T.floorMet, floorsPop: T.floors > before.floors }); }
    var L = normLevel(res.level);
    if (L) {
      ST.level = L;
      var gained = lvBefore ? L.xp - lvBefore.xp : 0;
      renderLevel(L, { shine: gained > 0 && !quiet(), badge: lvBefore && L.number > lvBefore.number });
      if (gained > 0) floaty('+' + gained + ' XP', o.floatEl || J('log-btn'));
    }
    patchToday(T, res.entry || o.entry);
    var firstLog = (res.events || []).filter(function (e) { return kindOf(e) === 'log'; })[0];
    var rec = res.toast || (firstLog && joinFact(firstLog.title, firstLog.detail));
    var receiptShown = false;
    if (rec && !o.skipReceipt) { toast({ icon: o.icon || (res.entry && catOf(res.entry.category).icon) || 'check', title: rec }); receiptShown = true; sfx('tick'); }
    playEvents(res.events, { receiptShown: receiptShown, receiptText: rec });
    // cozy.js: the character's reaction and the coin source (docs/COZY.md 4.4, 4.7); before the money read so the coins know where to start
    try { DOC.dispatchEvent(new CustomEvent('witness:write', { detail: { res: res, entry: res.entry || o.entry || null, source: o.floatEl || null, before: before, today: T } })); } catch (e) { /* older browsers */ }
    later(600, function () { refreshAll(true); });
    if (window.WitnessMoney) { try { window.WitnessMoney.after(res); } catch (e) { /* the wallet pill is optional */ } }   // "+$X" toast (money.js)
  }

  /* ====================================================================== forms */
  var OFFLINE = function () { toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer.", sub: 'Start it with', code: 'python -m epoch' }); };
  var BOOL_KEYS = { deep: 1, rest: 1, public: 1 };
  var NUM_KEYS = { minutes: 1, id: 1, entry_id: 1, plan_block_id: 1, outputs: 1, floor_days: 1 };
  function formToJSON(form, submitter) {
    var out = {};
    qsa('input, select, textarea', form).forEach(function (el) {
      if (!el.name || el.disabled) return;
      var t = el.type;
      if (t === 'submit' || t === 'button' || t === 'file') return;
      if (t === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      if (t === 'checkbox') { if (BOOL_KEYS[el.name] || !el.hasAttribute('value')) out[el.name] = el.checked; else if (el.checked) out[el.name] = el.value; return; }
      out[el.name] = el.value;
    });
    if (submitter && submitter.name) out[submitter.name] = submitter.value;
    Object.keys(out).forEach(function (k) {
      if (BOOL_KEYS[k] && typeof out[k] !== 'boolean') out[k] = out[k] === '1' || out[k] === 'true' || out[k] === 'on';
      if (NUM_KEYS[k] && out[k] !== '' && out[k] != null && isFinite(Number(out[k]))) out[k] = Number(out[k]);
    });
    return out;
  }
  function nativeSubmit(form) { form.dataset.native = '1'; try { HTMLFormElement.prototype.submit.call(form); } catch (e) { /* ignore */ } }
  function setBusy(btn, on, label) {
    if (!btn) return;
    btn.classList.toggle('is-busy', on);
    var t = J('log-btn-text', btn) || btn;
    if (on) { btn._label = t.textContent; if (label) t.textContent = label; } else if (btn._label != null) { t.textContent = btn._label; btn._label = null; }
  }

  /* ---------- the log (text, chips, repeat chips) ---------- */
  var KW = {};
  [
    ['Distracted', 'youtube yt reddit instagram insta tiktok netflix scroll scrolling doomscroll doomscrolling twitter games gaming game distracted drift drifted drifting phone discord memes shorts news'],
    ['Rest', 'rest nap walk lunch dinner breakfast gym break sleep shower chill eat food coffee relax'],
    ['Unknown', 'unknown idk unsure'],
    ['Python', 'python py numpy pandas matplotlib scipy pytest fastapi script scripting coding code notebook jupyter leetcode'],
    ['ML/DL', 'ml dl pytorch torch tensorflow neural nn backprop transformer transformers cs229 cs231n karpathy llm training gradient attention'],
    ['Math', 'math maths la algebra calculus calc proof proofs probability prob stats statistics vector vectors matrix matrices strang linear'],
    ['Papers', 'paper papers arxiv read reading abstract'],
    ['Writing/X', 'write writing post thread tweet blog essay x'],
  ].forEach(function (p) { p[1].split(' ').forEach(function (w) { if (!has(KW, w)) KW[w] = p[0]; }); });
  var RX_H = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])(?:\s*(\d{1,2})(?:\s*(?:minutes?|mins?|m)(?![a-z]))?)?/i;
  var RX_M = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?![a-z])/i;
  function parseLine(raw) {      // preview only. The server parser is authoritative.
    var rest = raw, min = null, m;
    if ((m = RX_H.exec(rest))) { min = Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0)); rest = rest.replace(m[0], ' '); }
    else if ((m = RX_M.exec(rest))) { min = Math.round(parseFloat(m[1])); rest = rest.replace(m[0], ' '); }
    if (min !== null && (min < 1 || !isFinite(min))) min = null;
    if (min !== null && min > 600) min = 600;
    var cat = null, toks = raw.toLowerCase().split(/[^a-z0-9/]+/);
    for (var i = 0; i < toks.length; i++) { if (toks[i] && has(KW, toks[i])) { cat = KW[toks[i]]; break; } }
    return { min: min, cat: cat, text: rest.replace(/\s+/g, ' ').trim() };
  }
  var sel = { min: null, cat: null, explicitMin: false, explicitCat: false, deep: null, rest: false };
  function chipInputs(which) { var box = J(which === 'min' ? 'dur-chips' : 'cat-chips'); return box ? qsa('input', box) : []; }
  function syncChips() {
    chipInputs('min').forEach(function (i) { i.checked = sel.min != null && Number(i.value) === sel.min; });
    chipInputs('cat').forEach(function (i) { i.checked = sel.cat != null && i.value === sel.cat; });
  }
  function catIsDeep(name) {
    var inp = chipInputs('cat').filter(function (i) { return i.value === name; })[0];
    if (inp && inp.dataset.deep !== undefined) return inp.dataset.deep === '1';
    return catOf(name).deep;
  }
  function renderPreview() {
    var box = J('log-preview'), txt = J('log-text'); if (!box || !txt) return;
    var p = parseLine(txt.value), min = sel.min, cat = sel.cat, c = cat && catOf(cat), T = ST.T || { deep: 0 };
    var raw = txt.value.trim(), ready = !!(raw || (min && cat));
    var tags = '';
    if (min) tags += '<span class="tag">' + ico('timer') + esc(fmtMin(min)) + '</span>';
    if (c) tags += '<span class="tag tag--cat" style="color:var(--' + esc(c.v.replace(/^--/, '')) + ')">' + ico(c.icon) + '<span>' + esc(cat === 'Distracted' ? 'Distracted' : c.label) + '</span></span>';
    var hint;
    if (box._kind) hint = '<span class="hint is-kind">' + esc(box._kind) + '</span>';
    else if (!raw && !min && !cat) hint = '<span class="hint">Type a line, or tap a length and a kind of hour.</span>';
    else if (!min && !raw) hint = '<span class="hint">How long was it?</span>';
    else if (c && min && catIsDeep(cat)) {
      var cur = Math.min(T.deep || 0, CONFIG.cap), add = Math.floor(clamp(cur + min, 0, CONFIG.max_floors * CONFIG.minutes_per_floor) / CONFIG.minutes_per_floor) - Math.floor(cur / CONFIG.minutes_per_floor);
      hint = '<span class="hint">' + (p.text ? esc(p.text) + ' · ' : '') + (add > 0 ? 'Adds ' + add + ' floor' + (add > 1 ? 's' : '') + '.' : 'Builds toward the next floor.') + '</span>';
    } else if (c && min) hint = '<span class="hint">' + (p.text ? esc(p.text) + ' · ' : '') + 'It adds a lamp to your street.</span>';
    else hint = '<span class="hint">' + esc(p.text || raw) + '</span>';
    box.innerHTML = tags + hint;
    var btn = J('log-btn'); if (btn) { btn.setAttribute('aria-disabled', ready ? 'false' : 'true'); }
    var lbl = J('log-btn-text');
    if (lbl && !btn.classList.contains('is-busy')) lbl.textContent = (min && cat) ? 'Log ' + fmtMin(min) + ' ' + (cat === 'Distracted' ? 'Distracted' : c.label) : (qs('#logDlg') ? 'Log it' : 'Log this hour');
  }
  function onTextInput() {
    var txt = J('log-text'), box = J('log-preview'); if (box) box._kind = '';
    var p = parseLine(txt.value);
    if (!sel.explicitMin) sel.min = p.min;
    if (!sel.explicitCat) sel.cat = p.cat;
    syncChips(); renderPreview();
  }
  function clearInput() {
    var txt = J('log-text'); if (!txt) return;
    txt.value = ''; sel.min = null; sel.cat = null; sel.explicitMin = sel.explicitCat = false;
    syncChips(); renderPreview();
    if (matchMedia('(pointer:fine)').matches) txt.focus({ preventScroll: true });
  }
  function bodyFromChoice(cat, minutes, note) {
    var c = catOf(cat), inp = chipInputs('cat').filter(function (i) { return i.value === cat; })[0];
    var deep = inp && inp.dataset.deep !== undefined ? inp.dataset.deep === '1' : c.deep;
    var rest = inp ? inp.dataset.rest === '1' : cat === 'Rest';
    var b = { category: cat, minutes: minutes, deep: deep, rest: !!rest };
    if (note) b.note = note;
    return b;
  }
  function showKind(msg) {
    var box = J('log-preview'); if (box) { box._kind = msg; renderPreview(); }
    var st = J('log-status'); if (st && msg) st.textContent = msg;     // announced once; the preview itself stays quiet while typing
  }
  function sendLog(body, o) {
    o = o || {};
    if (ST.busy) { toast({ icon: 'info', tone: 'violet', title: 'Still reading the last one.' }); return Promise.resolve(false); }
    ST.busy = true;
    var btn = J('log-btn'), slow = later(350, function () { setBusy(btn, true, 'Reading…'); });
    return api.post('/api/log', body).then(function (res) {
      if (!res || res.ok === false) { showKind((res && (res.hint || res.message)) || 'I couldn\'t read that. Try "45m numpy ex 1-12".'); return false; }
      applyWriteResult(res, { entry: res.entry, icon: res.entry && catOf(res.entry.category).icon, floatEl: o.floatEl });
      if (o.clear) clearInput();
      return res;                                            // truthy: the docked log bar (cozy.js) reads the entry from it
    }).catch(function (err) {
      if (err && err.kind === 'offline') OFFLINE();
      else if (err && err.kind === 'timeout') toast({ icon: 'info', tone: 'violet', title: 'That is taking a while. Your text is still in the box.', sub: 'Check Today before sending it again.' });
      else if (err && err.status >= 400 && err.status < 500 && err.status !== 422 && o.form) { nativeSubmit(o.form); }
      else toast({ icon: 'info', tone: 'violet', title: 'That did not save. Your text is still in the box.', sub: 'Try again in a moment.' });
      return false;
    }).then(function (r) { clearTimeout(slow); setBusy(btn, false); ST.busy = false; return r; });
  }
  function submitLog(form) {
    var txt = J('log-text'), raw = txt ? txt.value.trim() : '';
    var p = parseLine(raw);
    if (sel.explicitMin || sel.explicitCat) {
      var min = sel.explicitMin ? sel.min : p.min, cat = sel.explicitCat ? sel.cat : p.cat;
      if (!min || !cat) { showKind(!min && !cat ? 'Add a length and a kind of hour, like 45m numpy.' : !min ? 'How long was it? Try 45m, or tap a length.' : 'What kind of hour was it? Tap one below.'); return; }
      return sendLog(bodyFromChoice(cat, min, p.text), { clear: true, form: form });
    }
    if (!raw) { showKind('Type a line like 45m numpy ex 1-12, or tap a length and a kind of hour.'); return; }
    return sendLog({ text: raw }, { clear: true, form: form });
  }
  function initLog() {
    // Everything is delegated from the document, so an htmx swap of the Today block can never orphan a listener.
    DOC.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('[data-js="log-text"]')) onTextInput(); });
    var wasChecked = null;
    DOC.addEventListener('pointerdown', function (e) { var i = e.target.closest && e.target.closest('[data-js="dur-chips"] input, [data-js="cat-chips"] input'); wasChecked = i && i.checked ? i : null; });
    DOC.addEventListener('click', function (e) {
      var i = e.target.closest && e.target.closest('[data-js="dur-chips"] input, [data-js="cat-chips"] input');
      if (i) {
        var isMin = !!i.closest('[data-js="dur-chips"]');
        if (wasChecked === i) { i.checked = false; if (isMin) { sel.min = null; sel.explicitMin = false; } else { sel.cat = null; sel.explicitCat = false; } onTextInput(); }
        else if (isMin) { sel.min = Number(i.value); sel.explicitMin = true; } else { sel.cat = i.value; sel.explicitCat = true; }
        wasChecked = null; renderPreview(); sfx('tick');
        return;
      }
      var b = e.target.closest && e.target.closest('[data-js="repeat-chips"] .chipbtn');
      if (b && b.dataset.category) {
        popEl(b);
        sendLog({ category: b.dataset.category, minutes: Number(b.dataset.minutes), deep: b.dataset.deep === '1', rest: b.dataset.rest === '1', note: b.dataset.note || '' }, { floatEl: b });
      }
    });
    DOC.addEventListener('keydown', function (e) { if (e.target.closest && e.target.closest('[data-js="dur-chips"], [data-js="cat-chips"]')) wasChecked = null; });
    renderPreview();
  }

  /* ---------- generic enhanced forms ---------- */
  var ENDPOINT = { 'output': '/api/outputs', 'focus-stop': '/api/focus/stop', 'day-mark': '/api/day-mark', 'close-label': '/api/close/label', 'close-seal': '/api/close/seal' };
  function afterOutputs(form, res) {
    var dlg = form.closest('dialog'); if (dlg && dlg.open) dlg.close('ship');
    applyWriteResult(res, { icon: 'trophy', floatEl: qs('[data-open-dialog]') });
    form.reset();
  }
  function handleForm(form, e) {
    var kind = form.dataset.enhance;
    if (!kind || kind === 'log' || form.dataset.native === '1') return;
    var url = form.dataset.api || ENDPOINT[kind]; if (!url) return;
    e.preventDefault();
    var submitter = e.submitter || null, btn = submitter || qs('button[type=submit], .btn', form);
    if (kind === 'close-seal') return sealDay(form, url, btn);
    if (kind === 'output') {
      var stage = qs('input[name=stage]:checked, select[name=stage]', form), what = qs('[name=what]', form);
      if (what && !what.value.trim()) what.value = ((stage && stage.value) || 'Python') + ' output';
    }
    var body = formToJSON(form, submitter);
    if (btn) btn.classList.add('is-busy');
    api.post(url, body).then(function (res) {
      if (btn) btn.classList.remove('is-busy');
      if (!res || res.ok === false) { toast({ icon: 'info', tone: 'violet', title: (res && (res.hint || res.message)) || 'That could not be saved. Nothing was lost.' }); return; }
      if (kind === 'output') afterOutputs(form, res);
      else if (kind === 'close-label') afterLabel(form, res, body);
      else if (kind === 'focus-stop') afterFocusStop(form, res, body);
      else applyWriteResult(res, { icon: kind === 'day-mark' ? 'tent-tree' : 'check', floatEl: btn });
      if (kind === 'day-mark') { var det = form.closest('details'); if (det) det.open = false; }
    }).catch(function (err) {
      if (btn) btn.classList.remove('is-busy');
      if (err && err.kind === 'offline') OFFLINE();
      else nativeSubmit(form);      // endpoint missing or rejected: fall back to the plain POST, nothing is lost
    });
  }
  function afterFocusStop(form, res, body) {
    var slot = form.closest('[data-js="focus-slot"]') || J('focus-slot'); if (slot) slot.innerHTML = '';
    if (body.outcome === 'cancelled') { toast({ icon: 'timer', tone: 'violet', title: res.toast || 'Focus session cancelled. Nothing was logged.' }); return; }
    applyWriteResult(res, { entry: res.entry, icon: 'timer' });
  }

  /* ---------- Close: label a gap, seal the day ---------- */
  function afterLabel(form, res, body) {
    var gap = form.closest('.gap'), c = body.category;
    if (gap) {
      var span = (qs('.gap__t b, h3', gap) || {}).textContent || '';
      var unknown = /don.?t remember|unknown/i.test(c || '');
      var hadFocus = gap.contains(DOC.activeElement);
      gap.classList.add('is-done');
      gap.innerHTML = '<div class="gap__t"><b>' + esc(span.replace(/\s*\(.*$/, '')) + '</b><span class="small muted">' + (unknown ? 'Left as unknown. That is allowed.' : 'Filled: ' + esc(c)) + '</span></div>';
    }
    if (gap && hadFocus) {          // the tapped button is gone: keep the keyboard's place (next gap, else the seal button)
      var nextGap = qs('.gap:not(.is-done) button, .gap:not(.is-done) input, .gap:not(.is-done) select'), sealBtn = J('seal-btn');
      var target = nextGap || sealBtn; if (target) { try { target.focus({ preventScroll: false }); } catch (e) { /* gone */ } }
    }
    var remaining = num(res.remaining_gaps, qsa('.gap:not(.is-done)').length);
    var fogN = J('fog-count'); if (fogN) fogN.textContent = remaining;
    var fogL = J('fog-label'); if (fogL) fogL.textContent = remaining === 1 ? ' foggy hour' : ' foggy hours';
    var fogM = J('fog-minutes'); if (fogM && res.fog_minutes != null) fogM.textContent = fmtMin(res.fog_minutes);
    syncSeal(remaining);
    if (/don.?t remember|unknown/i.test(c || '') && !(res.events || []).length) toast({ icon: 'cloud-fog', tone: 'violet', title: 'Left as unknown. That is allowed.', sub: 'The fog stays a patch on the lot.' });
    else if (!(res.events || []).length && res.toast) toast({ icon: 'check', title: res.toast });
    if (res.events && res.events.length) applyWriteResult(res, { icon: 'cloud-fog', skipReceipt: true });
    else later(300, function () { refreshAll(true); });
  }
  function initSeal() {
    var btn = J('seal-btn'); if (!btn) return;
    btn.setAttribute('aria-disabled', btn.dataset.ready === '1' ? 'false' : 'true');     // server HTML is enabled; only the script greys it
  }
  function syncSeal(remaining) {
    var btn = J('seal-btn'); if (!btn) return;
    var sealed = btn.dataset.sealed === '1', jobOpen = btn.dataset.jobOpen === '1';
    var ready = remaining === 0 && !sealed && !jobOpen;
    btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    var hint = J('seal-hint');
    if (hint) hint.textContent = sealed ? "Sealed. Tomorrow's lot is waiting." : jobOpen ? 'Answer the day-job question above, then seal.' : remaining ? remaining + ' ' + (remaining === 1 ? 'hour' : 'hours') + ' left to settle. "Don\'t remember" is a fine answer.' : 'Everything is settled. Seal the day when you are ready.';
  }
  function sealDay(form, url, btn) {
    var seal = J('seal-btn') || btn;
    if (seal && seal.getAttribute('aria-disabled') === 'true') {
      var hint = J('seal-hint'), open = qsa('.gap:not(.is-done)').length;
      if (hint && open) hint.textContent = open + ' ' + (open === 1 ? 'hour' : 'hours') + ' left. Tap one answer each, "Don\'t remember" is allowed.';
      return;
    }
    if (btn) btn.classList.add('is-busy');
    api.post(url, formToJSON(form)).then(function (res) {
      if (btn) btn.classList.remove('is-busy');
      if (!res || res.ok === false) { var h = J('seal-hint'); if (h) h.textContent = (res && (res.hint || res.message)) || 'A few hours are still open. Settle them, then seal.'; return; }
      if (seal) { seal.dataset.sealed = '1'; seal.setAttribute('aria-disabled', 'true'); var sl = qs('[data-js="seal-label"]', seal), su = qs('use', seal); if (sl) sl.textContent = 'Day sealed'; if (su) su.setAttribute('href', ICONS + '#i-check'); }
      syncSeal(0);
      var lo = J('lights-out') || qs('.lightsout');
      if (!lo) { lo = DOC.createElement('div'); lo.className = 'lightsout'; lo.dataset.js = 'lights-out'; lo.setAttribute('aria-hidden', 'true'); DOC.body.appendChild(lo); }
      if (!reduced()) { lo.classList.remove('go'); void lo.offsetWidth; lo.classList.add('go'); later(1700, function () { lo.classList.remove('go'); }); }
      sfx('thunk');
      later(reduced() ? 0 : 750, function () {
        var ev = (res.events || []).filter(function (e) { return kindOf(e) === 'seal'; })[0];
        toast({ icon: 'moon', tone: 'violet', title: ev ? joinFact(ev.title, ev.detail) : res.toast || 'Day sealed.' });
        burst('small', J('seal-card') || seal);
        renderRecap(res.recap || res);
        try { DOC.dispatchEvent(new CustomEvent('witness:sealed', { detail: { day: (form.querySelector('[name="day"]') || {}).value || ST.today, res: res } })); } catch (e) { /* older browsers */ }
        var rc = J('recap'); if (rc) rc.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
        var L = normLevel(res.level); if (L) { var old = ST.level; ST.level = L; renderLevel(L, { shine: !quiet() }); if (old && L.xp > old.xp) floaty('+' + (L.xp - old.xp) + ' XP', seal); }
        playEvents((res.events || []).filter(function (e) { return kindOf(e) !== 'seal'; }), { startDelay: 600 });
        refreshAll(true);
      });
    }).catch(function (err) {
      if (btn) btn.classList.remove('is-busy');
      if (err && err.kind === 'offline') OFFLINE(); else nativeSubmit(form);
    });
  }
  function renderRecap(r) {
    var box = J('recap'); if (!box) return;
    r = r || {};
    var t = r.today || r, L = normLevel(r.level) || ST.level;
    var floors = firstDef(r.floors, t.floors, ST.T && ST.T.floors, 0), deep = firstDef(r.deep_minutes, t.deep_minutes, ST.T && ST.T.deep, 0);
    var outs = Array.isArray(r.outputs) ? r.outputs.length : firstDef(r.outputs, r.outputs_today, r.output_count, 0);
    var logged = firstDef(r.logged_count, r.entries_count, Array.isArray(r.entries) ? r.entries.length : null);
    box.hidden = false;
    box.innerHTML = '<div class="card__head"><h2>' + (r.day_number ? 'Day ' + esc(r.day_number) + ' recap' : 'Day recap') + '</h2><span class="pill pill--mint">' + ico('moon') + 'Sealed</span></div>' +
      '<div class="recap"><div class="total"><b class="num">' + esc(floors) + '</b><span>floors</span></div><div class="total"><b class="num">' + esc(fmtMin(deep)) + '</b><span>deep today</span></div>' +
      '<div class="total"><b class="num">' + esc(outs) + '</b><span>outputs today</span></div>' +
      (L ? '<div class="total" data-quiet-hide><b class="num">' + esc(L.district) + '</b><span>Level ' + L.number + ', ' + NF.format(L.xp) + ' XP</span></div>' : '') + '</div>' +
      '<p class="small muted" style="margin:12px 0">' + (logged != null ? esc(logged) + ' hours logged today, including rest and drift. ' : '') + 'The map is accurate.</p>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-js="recap-save">' + ico('camera') + 'Save as image</button>';
    var sv = J('recap-save', box); if (sv) sv.addEventListener('click', function () { saveImage('week', 'my-day.png'); });
  }
  function saveImage(mode, name) {
    var sc = scenes[mode] || scenes.week || scenes.city;
    if (!sc) { toast({ icon: 'camera', tone: 'violet', title: 'Saving an image needs the 3D city.', sub: 'Turn on 3D city in Settings.' }); return; }
    var ok = function () { toast({ icon: 'camera', tone: 'violet', title: 'Skyline saved as an image.', sub: 'Rendered here. Nothing was uploaded.' }); };
    var fail = function () { toast({ icon: 'camera', tone: 'violet', title: 'Could not capture the skyline.' }); };
    var give = function (href, revoke) { var a = DOC.createElement('a'); a.href = href; a.download = name; DOC.body.appendChild(a); a.click(); a.remove(); if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 4000); };
    try {
      var p = sc.snapshot({ width: 1200, height: 800, view: mode === 'city' ? 'current' : 'hero' });     // a clean 3:2 render, not the on-screen crop
      if (p && typeof p.then === 'function') p.then(function (blob) { if (!blob) throw new Error('empty'); give(URL.createObjectURL(blob), true); ok(); }).catch(fail);
      else { give(sc.snapshot()); ok(); }
    } catch (e) { fail(); }
  }

  /* ---------- focus clock ---------- */
  var focusTimer = 0;
  function tickFocus() {
    var el = J('focus-clock'); if (!el) { clearInterval(focusTimer); focusTimer = 0; return; }
    var t0 = Date.parse(el.dataset.started || ''); if (!isFinite(t0)) return;
    var s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function initFocus() { if (J('focus-clock')) { tickFocus(); if (!focusTimer) focusTimer = setInterval(tickFocus, 1000); } }

  /* ====================================================================== settings, dialogs, tabs, misc */
  function applyGameSetting(name, value) {
    try { DOC.dispatchEvent(new CustomEvent('witness:setting', { detail: { name: name, value: value } })); } catch (e) { /* older browsers */ }   // cozy.js (daily missions, quiet mode)
    switch (name) {
      case 'quiet_mode': prefs.quiet = !!value; store.set('quiet', prefs.quiet ? '1' : null); break;
      case 'sound': prefs.sound = !!value; store.set('sound', prefs.sound ? '1' : null); syncSoundBtn(); if (prefs.sound) { audio(); SFX.ping(); } break;
      case 'motion': prefs.motion = String(value); store.set('motion', prefs.motion === 'auto' ? null : prefs.motion); break;
      case 'three_d': prefs.three = String(value); store.set('three', prefs.three === 'auto' ? null : prefs.three); break;
      case 'sky_tz': prefs.ny = String(value) !== 'local'; store.set('skytz', prefs.ny ? String(value) : null); Object.keys(scenes).forEach(function (k) { if (scenes[k]) scenes[k].setHourFn(hourFn); }); break;
      case 'hide_achievements': prefs.hideAch = !!value; store.set('hideach', prefs.hideAch ? '1' : null); break;
      case 'game_enabled': prefs.game = !!value; store.set('game', prefs.game ? null : '0'); break;
      default: return;
    }
    applyPrefsToDOM();
    if (name === 'motion') applyMotionToScenes();
    if (name === 'three_d') applyThree();
  }
  function settingValue(el) {
    if (el.type === 'checkbox') {
      if (el.dataset.onValue !== undefined || el.dataset.offValue !== undefined) return el.checked ? (el.dataset.onValue || 'on') : (el.dataset.offValue || 'off');
      return el.checked;
    }
    return el.value;
  }
  function initSettings() {
    DOC.addEventListener('change', function (e) {
      var el = e.target; if (!el || !el.matches) return;
      if (el.matches('[data-js="theme-choice"]')) { applyTheme(el.value); return; }
      if (!el.matches('[data-js="game-setting"]')) return;
      if (el.type === 'radio' && !el.checked) return;
      var name = el.name, value = settingValue(el), body = {}; body[name] = value;
      applyGameSetting(name, value);
      api.post('/api/settings/game', body).then(function (res) {
        if (res && res.ok === false) { toast({ icon: 'info', tone: 'violet', title: res.hint || 'That setting could not be saved.' }); return; }
        if (name === 'weather_enabled') loadWeather();                 // the chip and the sky follow the switch right away
        if (name === 'seasonal_enabled') refreshAll(false);
      }).catch(function (err) {
        toast({ icon: 'info', tone: 'violet', title: err && err.kind === 'offline' ? "Changed on this screen only. Can't reach Epoch." : 'Changed on this screen. Saving it did not go through.' });
      });
    });
    // reflect the current values into the settings controls
    JJ('game-setting').forEach(function (el) {
      var cur = { quiet_mode: prefs.quiet, sound: prefs.sound, motion: prefs.motion, three_d: prefs.three, sky_tz: prefs.ny ? 'ny' : 'local', hide_achievements: prefs.hideAch, game_enabled: prefs.game }[el.name];
      if (cur === undefined) return;
      if (el.type === 'checkbox') { if (el.dataset.onValue !== undefined || el.dataset.offValue !== undefined) el.checked = String(cur) === (el.dataset.onValue || 'on'); else el.checked = !!cur; }
      else if (el.type === 'radio' && el.name === 'sky_tz') el.checked = (el.value === 'local') === !prefs.ny;
      else if (el.type === 'radio') el.checked = el.value === String(cur);
    });
  }
  function syncSoundBtn() {
    JJ('sound-toggle').forEach(function (b) {
      b.setAttribute('aria-pressed', String(prefs.sound));
      b.setAttribute('aria-label', prefs.sound ? 'Sound is on. Turn off' : 'Sound is off. Turn on');
      var use = qs('use', b); if (use) use.setAttribute('href', ICONS + '#i-volume-' + (prefs.sound ? '2' : 'x'));
    });
    JJ('game-setting').forEach(function (el) { if (el.name === 'sound' && el.type === 'checkbox') el.checked = prefs.sound; });
  }

  function initDialogs() {
    DOC.addEventListener('click', function (e) {
      var o = e.target.closest && e.target.closest('[data-open-dialog]');
      if (o) {
        var d = qs(o.getAttribute('data-open-dialog'));
        if (d && typeof d.showModal === 'function') {
          e.preventDefault();
          var pre = o.dataset.preselect; if (pre) { var r = qs('input[value="' + pre + '"]', d); if (r) r.checked = true; }
          if (!d.open) d.showModal();
          var f = qs('[data-autofocus]', d) || qs('input[type=text], input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea', d); if (f) f.focus();
        }
        return;
      }
      var c = e.target.closest && e.target.closest('[data-close-dialog]');
      if (c) { var dd = c.closest('dialog'); if (dd) { e.preventDefault(); dd.close('cancel'); } return; }
      if (e.target.tagName === 'DIALOG' && e.target.classList.contains('sheet') && e.target.open) e.target.close('cancel');
    });
  }
  function initCopy() {
    DOC.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-js="copy-btn"]'); if (!b) return;
      var tgt = qs(b.dataset.copyTarget); if (!tgt) return;
      var text = tgt.value != null ? tgt.value : tgt.textContent;
      var done = function () { var old = b.textContent; b.textContent = 'Copied'; later(1600, function () { b.textContent = old; }); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { tgt.select && tgt.select(); });
      else { tgt.select && tgt.select(); try { DOC.execCommand('copy'); done(); } catch (er) { /* manual copy */ } }
    });
  }
  function initWorldTabs() {
    var tabs = J('world-tabs'); if (!tabs) return;
    var panels = JJ('world-panel');
    var names = qsa('input[type=radio]', tabs).map(function (r) { return r.value; });
    function show(name, quiet) {
      panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
      qsa('input[type=radio]', tabs).forEach(function (r) { r.checked = r.value === name; });
      // writing a fragment before the page has finished loading makes Chrome scroll to that panel, so the first paint of /world would start 150px down
      if (!quiet) { try { history.replaceState(null, '', location.pathname + location.search + '#' + name); } catch (e) { /* ignore */ } }
      if (name === 'city') ensureScenes();
      if (name === 'shelf') loadShelf();
      if (name === 'week') refreshWorld(false);
      Object.keys(scenes).forEach(function (k) { if (scenes[k]) scenes[k].invalidate(); });
      try { DOC.dispatchEvent(new CustomEvent('witness:worldtab', { detail: { name: name } })); } catch (e) { /* older browsers */ }
    }
    qsa('input[type=radio]', tabs).forEach(function (r) { r.addEventListener('change', function () { if (r.checked) show(r.value); }); });
    var h = (location.hash || '').slice(1), start = names.indexOf(h) >= 0 ? h : (tabs.dataset.default || 'city');
    show(start, !location.hash);
    addEventListener('hashchange', function () { var n = (location.hash || '').slice(1); if (names.indexOf(n) >= 0) show(n); });
    tabs.showTab = show;
  }

  /* ---------- clocks ---------- */
  function tickClocks() {
    var d = new Date(), cl = J('clock-line');
    if (cl) cl.textContent = d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    var n = J('nyc-time');
    if (n) { try { n.textContent = 'NYC ' + new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch (e) { n.textContent = 'NYC'; } }
  }

  /* ---------- keyboard ---------- */
  function typing() { var t = DOC.activeElement && DOC.activeElement.tagName; return /^(INPUT|TEXTAREA|SELECT)$/.test(t || '') || (DOC.activeElement && DOC.activeElement.isContentEditable); }
  var chordAt = 0;
  function shortcutsOn() { return store.get('keys') !== 'off'; }
  function initKeys() {
    JJ('shortcuts-toggle').forEach(function (cb) {
      cb.checked = shortcutsOn();
      cb.addEventListener('change', function () { store.set('keys', cb.checked ? null : 'off'); });
    });
    DOC.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && momentEl) { closeMoment(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || typing() || !shortcutsOn()) return;
      if (e.key === '/') {
        var t = J('log-text');
        if (t) { e.preventDefault(); openSheetOf(t); t.focus(); t.select(); }
        else { var home = qs('[data-nav="today"]'); if (home) { e.preventDefault(); location.href = home.getAttribute('href').split('#')[0] + '#log'; } }
        return;
      }
      if (e.key === 'g') { chordAt = Date.now(); return; }
      if (Date.now() - chordAt < 1200) {
        var map = { t: 'today', f: 'focus', c: 'close', w: 'world', m: 'money', s: 'settings' }, name = map[e.key];
        if (name) { var a = qs('[data-nav="' + name + '"]'); if (a) { e.preventDefault(); location.href = a.getAttribute('href'); } }
        chordAt = 0;
      }
    });
  }

  /* ---------- HX-Trigger "witness:events" from the HTML routes (htmx 2 puts the payload in detail.value) ---------- */
  function initHtmxEvents() {
    DOC.addEventListener('witness:events', function (e) {
      var d = e.detail, ev = Array.isArray(d) ? d : (d && Array.isArray(d.value) ? d.value : (d && Array.isArray(d.events) ? d.events : null));
      if (!ev || !ev.length) return;
      var log = ev.filter(function (x) { return kindOf(x) === 'log'; })[0];
      if (log) toast({ icon: 'check', title: joinFact(log.title, log.detail) });
      playEvents(ev, { receiptShown: true });
      refreshAll(true);
    });
    DOC.addEventListener('htmx:afterSettle', function () { initFocus(); renderPreview(); syncChips(); });
    // An htmx request that never lands (server down, 5xx, timeout) must say so, the way the fetch paths do.
    DOC.addEventListener('htmx:sendError', function () { OFFLINE(); });
    DOC.addEventListener('htmx:timeout', function () { OFFLINE(); });
    DOC.addEventListener('htmx:responseError', function () { toast({ icon: 'info', tone: 'violet', title: 'That did not save.', sub: 'Nothing was changed. Try again in a moment.' }); });
  }

  /* ---------- small tilt on the ring card (real mouse only, never under reduced motion) ---------- */
  function initTilt() {
    var c = qs('.tilt'); if (!c) return;
    c.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || reduced()) return;
      var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      c.style.transform = 'perspective(900px) rotateX(' + (-y * 6).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg)';
    });
    c.addEventListener('pointerleave', function () { c.style.transform = ''; });
  }

  /* ---------- day buttons, snapshot buttons ---------- */
  function initStageControls() {
    DOC.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.daybtn');
      if (b && J('day-btns') && J('day-btns').contains(b)) {
        var k = Number(b.dataset.k), host = qs('[data-js="stage"][data-stage="week"]'), slots = slotsFor('week');
        if (ST.pickedWeek === k) { if (scenes.week) scenes.week.pick(-1); ST.pickedWeek = -1; showDayCard(host, null); renderDayBtns(); return; }
        ST.pickedWeek = k;
        if (scenes.week) { scenes.week.pick(k); scenes.week.focusDay(k); }
        if (slots) showDayCard(host, slots[k]);
        renderDayBtns(); return;
      }
      var s = e.target.closest && e.target.closest('[data-js="snapshot"]');
      if (s) saveImage(s.dataset.stageTarget === 'city' ? 'city' : 'week', s.dataset.stageTarget === 'city' ? 'my-new-york.png' : 'my-week.png');
    });
  }

  /* ====================================================================== boot */
  function init() {
    applyPrefsToDOM();
    applyTheme(themeMode());
    syncSoundBtn();
    matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
    mqReduce.addEventListener && mqReduce.addEventListener('change', function () { applyPrefsToDOM(); applyMotionToScenes(); });
    DOC.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-js="theme-toggle"]')) applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
      else if (e.target.closest && e.target.closest('[data-js="sound-toggle"]')) {
        var on = !prefs.sound; applyGameSetting('sound', on);
        api.post('/api/settings/game', { sound: on }).catch(function () { /* local only */ });
      }
    });
    DOC.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.matches) return;
      if (f.matches('[data-js="log-form"]')) { if (f.dataset.native === '1') return; e.preventDefault(); submitLog(f); }
      else if (f.matches('form[data-enhance]')) handleForm(f, e);
    });
    initLog(); initSeal(); initSettings(); initDialogs(); initCopy(); initWorldTabs(); initKeys(); initHtmxEvents(); initTilt(); initStageControls(); initFocus();
    tickClocks(); setInterval(tickClocks, 20000);
    loadWeather(); setInterval(loadWeather, 20 * 60000);
    syncSeal(qsa('.gap:not(.is-done)').length);
    renderFallbacks();
    JJ('stage').forEach(function (h) { if (prefs.three === 'off') h.classList.add('use-svg'); });
    refreshAll(false).then(function () {
      var go = function () { ensureScenes(); if (!reduced() && !quiet()) ensureConfetti(); };
      if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else later(80, go);
    });
    DOC.addEventListener('visibilitychange', function () {
      Object.keys(scenes).forEach(function (k) { if (scenes[k]) scenes[k].pause(DOC.hidden || prefs.three === 'off'); });
      if (!DOC.hidden) { tickClocks(); if (Date.now() - ST.lastFetch > 5 * 60000) { refreshAll(false); loadWeather(); } }
    });
    var t = J('log-text'), sheet = t && t.closest('dialog');
    if (sheet) {
      // Today is the room (docs/COZY.md 3a): the log form is the "+ Add time" sheet. It opens for /#log, and when the server
      // sent back a typed line it could not read (no JavaScript), so that line is never lost.
      if (location.hash === '#log' || t.value.trim()) { openSheetOf(t); t.focus({ preventScroll: true }); }
    } else if (t && (location.hash === '#log' || matchMedia('(pointer:fine)').matches) && !location.hash.replace('#log', '')) t.focus({ preventScroll: true });
    if (J('roomday')) initRoomDay();
  }
  function openSheetOf(el) { var d = el && el.closest && el.closest('dialog'); if (d && !d.open && typeof d.showModal === 'function') { try { d.showModal(); } catch (e) { /* already modal elsewhere */ } } }
  /* Today is the room (docs/COZY.md 3a): /?home=1 (the Focus Screen's "Go home") is a one-time bypass of the focus redirect, so it
     leaves the address; the room fills the screen below the header, measured once and on resize (CSS has a close default). */
  function initRoomDay() {
    try { var u = new URL(location.href); if (u.searchParams.has('home')) { u.searchParams.delete('home'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } } catch (e) { /* fine */ }
    var stage = J('home-stage'); if (!stage) return;
    var fit = function () {
      var top = stage.getBoundingClientRect().top + (window.scrollY || 0), nav = qs('.nav'), bottom = 0;
      if (nav && getComputedStyle(nav).position === 'fixed') bottom = nav.getBoundingClientRect().height;
      DOC.documentElement.style.setProperty('--room-top', Math.max(0, Math.round(top)) + 'px');
      DOC.documentElement.style.setProperty('--room-bottom', Math.round(bottom) + 'px');
    };
    fit(); addEventListener('resize', fit); addEventListener('orientationchange', function () { later(200, fit); });
    // a log from the Add time sheet (or an output from the ship sheet) closes the sheet and the drawer, so the room shows the answer:
    // the character's reaction and the coins flying into the money pill
    var sheetAt = 0, mark = function (e) { if (e.target && e.target.closest && e.target.closest('#logDlg, #shipDlg')) sheetAt = Date.now(); };
    DOC.addEventListener('submit', mark, true); DOC.addEventListener('click', mark, true);
    DOC.addEventListener('witness:write', function () {
      if (Date.now() - sheetAt > 20000) return;
      sheetAt = 0;
      later(250, function () { ['#logDlg', '#shipDlg', '#todayDlg'].forEach(function (id) { var x = qs(id); if (x && x.open) x.close('logged'); }); });
    });
  }

  /* public handle, mostly for tests and the HTML routes */
  /* Day number = the day counter: the tracker's start date is Day 1, and it never goes below 1. */
  function dayNumberOf(iso) {
    var start = ST.dayOne || (ST.world && ST.world.day_one); if (!start || !iso) return null;
    var a = Date.parse(String(start).slice(0, 10) + 'T00:00:00Z'), b = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }
  function dayRange(firstIso, lastIso) {
    var a = dayNumberOf(firstIso), b = dayNumberOf(lastIso); if (a == null || b == null) return '';
    return a === b ? 'Day ' + a : 'Days ' + a + '-' + b;
  }
  window.Witness = {
    version: '2', refresh: function () { return refreshAll(true); }, playEvents: playEvents, toast: toast, state: ST, prefs: prefs, scenes: scenes,
    // for the v2 modules (focus.js, postcard.js, subway.js, lan.js, audio.js)
    api: api, clientId: CLIENT_ID, applyWriteResult: applyWriteResult, applyToday: applyToday, sfx: sfx, reduced: reduced, store: store, ico: ico, esc: esc, fmtMin: fmtMin,
    ensureScene: ensureScene, ensureScenes: ensureScenes, pushAtmosphere: pushAtmosphereAll, hourFn: hourFn, catOf: catOf, normToday: normToday,
    burst: burst, popEl: popEl, saveImage: saveImage, refreshWorld: refreshWorld, loadWeather: loadWeather, dowOf: dowOf, mondayOf: mondayOf, labelDate: labelDate, dayNumberOf: dayNumberOf, dayRange: dayRange,
    setConstruction: function (c) { ST.construction = c; Object.keys(scenes).forEach(function (k) { callScene(scenes[k], 'setConstruction', c); }); },
    openRoom: openRoom,         // the user's home as a 3D cutaway room (or a plain list without WebGL)
    // for cozy.js (the HUD over the home scene, docs/COZY.md 4.6-4.7) and money.js (store thumbnails)
    sendLog: sendLog, tween: tween, ensureImportMap: ensureImportMap, loadScript: loadScript, base: BASE.href, threeOn: threeOn, quiet: quiet, gameOn: gameOn,
  };

  try { init(); } catch (e) { console.error('Epoch UI could not start; the server-rendered page still works.', e); }
  // the cozy HUD, missions, chest and coins live in their own file so a failure there never touches the log (loaded relative to this script)
  try { loadScript(new URL('cozy.js', BASE).href).catch(function () { /* the plain page keeps working */ }); } catch (e) { /* ignore */ }
})();
