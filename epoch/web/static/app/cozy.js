/* cozy.js · the game feel over the home scene (docs/COZY.md 4.1 HUD, 4.6 missions + chest UI, 4.7 juice, 8 quiet mode and fallbacks).
 *
 * A classic script that app.js loads after its own start (relative to app.js, so it follows the /static/v/<fingerprint>/ path).
 * It only uses window.Witness (app.js), window.WitnessMoney (money.js) and window.WitnessAudio (audio.js); every call is guarded,
 * so if anything here throws the log card and the rest of the page keep working.
 *
 * Today page:
 *   host  [data-js="home-scene"]  the apartment scene (city/room.js stage mode, built by the scene code). If the page has none yet,
 *                                 this file adds one with an illustrated 2D apartment (also the no-WebGL fallback).
 *   HUD   [data-js="home-hud"]    inside the host; built here when the host does not bring one: money pill (count-up), job chip,
 *                                 missions chip with a ring, the chest (glows when ready, x3), stars, Decorate and Look outside.
 *   dock  [data-js="home-dock"]   a slim log bar on the scene's bottom edge, posting through /api/log (Witness.sendLog). Today no longer
 *                                 has one (docs/COZY.md 3a): its host carries data-no-dock and serves the HUD markup itself (data-cozy-built).
 * Every page: coins fly from the source (the docked bar, the button that was pressed, the chest) into the money pill on any money gain,
 *   mission-complete toasts and pulses, the chest-ready glow. The scene's character is told through Witness.cozy.react(kind) when present.
 *
 * Events in:  witness:write (app.js, every write), witness:money (money.js, every savings change), witness:refreshed, witness:setting.
 * Public:     window.Witness.cozyUI = { coins(from, cents), refresh(), openMissions(), openChest(), decorate({item}), setSource(el), summary() }
 * Copy rules (COZY.md 11): warm, short, factual; no guilt, no hype.
 */
(function () {
  'use strict';
  var DOC = document, ROOT = DOC.documentElement;
  function W() { return window.Witness || null; }
  function qs(s, r) { return (r || DOC).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || DOC).querySelectorAll(s)); }
  function J(n, r) { return qs('[data-js="' + n + '"]', r); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function later(ms, fn) { return setTimeout(fn, ms); }
  function num(x, d) { x = Number(x); return isFinite(x) ? x : (d == null ? 0 : d); }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function usd(cents) { var n = Math.trunc(num(cents) / 100); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }
  function icon(n) { var w = W(); return w && w.ico ? w.ico(n) : ''; }
  function reduced() { var w = W(); return !!(w && w.reduced && w.reduced()); }
  function quiet() { var w = W(); return !!(w && w.prefs && w.prefs.quiet) || ROOT.classList.contains('quiet'); }
  function gameOn() { var w = W(); return !(w && w.prefs && w.prefs.game === false) && !ROOT.classList.contains('nogame'); }
  function toast(o) { var w = W(); if (w && w.toast) w.toast(o); }
  function cue(name) { try { if (window.WitnessAudio && window.WitnessAudio.cue) window.WitnessAudio.cue(name); } catch (e) { /* audio is optional */ } }
  function store(k, v) { var w = W(); if (!w || !w.store) return null; if (v === undefined) return w.store.get('cozy.' + k); w.store.set('cozy.' + k, v); return null; }
  function visible(el) { if (!el || !el.isConnected) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  /* the scene code (city/room.js stage mode) answers to Witness.cozy; it may not be there (yet), so every call is optional */
  function cozy(fn) {
    var w = W(), c = w && w.cozy; if (!c || typeof c[fn] !== 'function') return undefined;
    try { return c[fn].apply(c, Array.prototype.slice.call(arguments, 1)); } catch (e) { console.warn('cozy.' + fn, e); return undefined; }
  }
  function react(kind, detail) { cozy('react', kind, detail || {}); }      // the scene shows a static pose under reduced motion

  var S = {
    econ: null, missions: null, chest: null, primed: false, host: null, hud: null, dock: null, own: false,
    doneSeen: {}, chestReady: 0, stars: -1, src: null, srcAt: 0, chestBusy: false, lastEcon: 0, fetching: null, missionsFull: null,
  };
  var isToday = !!DOC.getElementById('today-main');

  /* ====================================================================== data */
  function readEconomy(force) {
    var w = W(); if (!w || !w.api) return Promise.resolve(null);
    if (S.fetching && !force) return S.fetching;
    S.fetching = w.api.get('/api/economy').then(function (e) { S.fetching = null; if (!e || e.ok === false) return null; apply(e); return e; })
      .catch(function () { S.fetching = null; return null; });
    return S.fetching;
  }
  function apply(e) {
    var first = !S.econ;
    S.econ = e; S.lastEcon = Date.now();
    var m = e.missions || null, ch = e.chest || null;
    diffMissions(m, first);
    diffChest(ch, first);
    S.missions = m; S.chest = ch;
    paint();
    cozy('setChest', ch); cozy('setMissions', m);
  }
  function seenKey(date) { return 'seen.' + (date || ''); }
  function diffMissions(m, first) {
    if (!m || !Array.isArray(m.items)) return;
    var key = seenKey(m.date), raw = store(key), seen = {};
    try { seen = raw ? JSON.parse(raw) : {}; } catch (er) { seen = {}; }
    var fresh = [];
    m.items.forEach(function (it) { if (it.done && !seen[it.id]) { seen[it.id] = 1; if (!first || S.primed) fresh.push(it); } });
    store(key, JSON.stringify(seen));
    if (!fresh.length || quiet() || !gameOn() || m.enabled === false) return;
    var doneN = m.items.filter(function (x) { return x.done; }).length, total = m.items.length || 3, before = doneN - fresh.length;
    fresh.forEach(function (it, i) {
      later(900 + i * 1400, function () {
        var full = S.missionsFull && (S.missionsFull.missions || []).filter(function (x) { return x.id === it.id; })[0];
        var left = Math.max(0, total - (before + i + 1)), what = full && full.done_text ? full.done_text : lowerFirst(it.text);
        // "Mission done: two focus blocks. One to go for the chest." (counted here, so two missions finished by one log read right)
        var title = 'Mission done: ' + what + '. ' + (left === 0 ? 'That is all three.' : (left === 1 ? 'One' : left === 2 ? 'Two' : String(left)) + ' to go for the chest.');
        toast({ icon: 'target', tone: 'mint', title: title, ms: 5200 });
        cue('mission');
        pulse(J('hud-missions'));
        react('mission', { id: it.id });
      });
    });
  }
  function lowerFirst(s) { s = String(s || ''); return s.charAt(0).toLowerCase() + s.slice(1); }
  function diffChest(ch, first) {
    var ready = ch ? num(ch.ready) : 0;
    if (!first && ready > S.chestReady && !quiet() && gameOn()) {
      later(900 + 1500, function () {
        toast({ icon: 'sparkles', tone: 'violet', title: 'Your chest is ready.', sub: ready > 1 ? ready + ' chests are waiting on the shelf.' : 'Tap it to open.', ms: 5600 });
        cue('mission');
        react('chest_ready');
        var c = J('hud-chest'); if (c) { c.classList.remove('is-new'); void c.offsetWidth; c.classList.add('is-new'); }
      });
    }
    S.chestReady = ready;
  }
  function loadMissionsFull() {
    var w = W(); if (!w || !w.api) return Promise.resolve(null);
    return w.api.get('/api/missions').then(function (r) { if (r && r.ok !== false) S.missionsFull = r; return S.missionsFull; }).catch(function () { return null; });
  }

  /* ====================================================================== the HUD over the home scene */
  var RING_R = 9, RING_C = 2 * Math.PI * RING_R;
  var CHEST_SVG = '<svg class="hchest" viewBox="0 0 32 28" aria-hidden="true" focusable="false"><path d="M4 12 Q4 4 16 4 Q28 4 28 12Z" fill="#a8774f" stroke="#5b4128" stroke-width="1.6"/><rect x="4" y="12" width="24" height="13" rx="2" fill="#9a6a44" stroke="#5b4128" stroke-width="1.6"/><rect x="14" y="4.2" width="4" height="20.8" fill="#8cc4ee"/><rect x="14.2" y="13" width="3.6" height="4" rx="1" fill="#c9a14a"/></svg>';
  var COIN_SVG = '<svg class="hcoin" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="#f4c977" stroke="#b8862b" stroke-width="1.6"/><circle cx="12" cy="12" r="6.6" fill="none" stroke="#d9a440" stroke-width="1.2"/><path d="M12 7.6v8.8M14.3 9.4c-.5-.7-1.3-1-2.3-1-1.3 0-2.2.7-2.2 1.6 0 2.2 4.6 1.2 4.6 3.6 0 1-.9 1.7-2.4 1.7-1.1 0-2-.4-2.5-1.1" fill="none" stroke="#8a5d14" stroke-width="1.3" stroke-linecap="round"/></svg>';
  function hudHTML() {
    return '<div class="cozy-hud__tl">' +
        '<a class="hchip hchip--money" href="/money" data-js="hud-money" data-quiet-hide data-game-only aria-label="Savings. Open the wallet">' + COIN_SVG + '<b class="num" data-js="hud-money-num">$0</b></a>' +
        '<span class="hchip hchip--job" data-js="hud-job" data-quiet-hide data-game-only hidden></span>' +
      '</div>' +
      '<div class="cozy-hud__tr">' +
        '<button class="hchip hchip--missions" type="button" data-js="hud-missions" data-quiet-hide data-game-only aria-haspopup="dialog" aria-controls="missionsDlg" hidden>' +
          '<svg class="hring" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="hring__t" cx="12" cy="12" r="' + RING_R + '"/><circle class="hring__a" data-js="hud-ring" cx="12" cy="12" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/></svg>' +
          '<span class="hchip__t">Missions <b class="num" data-js="hud-missions-n">0/3</b></span></button>' +
        '<button class="hchip hchip--chest" type="button" data-js="hud-chest" data-quiet-hide data-game-only hidden>' + CHEST_SVG + '<b class="num" data-js="hud-chest-n"></b></button>' +
        '<span class="hchip hchip--stars" data-js="hud-stars" data-quiet-hide data-game-only role="img" aria-label="Stars today" hidden></span>' +
      '</div>' +
      '<div class="cozy-hud__br">' +
        '<button class="hbtn" type="button" data-js="hud-decorate">' + icon('layout-grid') + '<span>Decorate</span></button>' +
        '<a class="hbtn" href="/world#city" data-js="hud-outside">' + icon('eye') + '<span>Look outside</span></a>' +
      '</div>';
  }
  function dockHTML() {
    return '<label class="sr-only" for="dockText">What did you do this hour? For example 45m numpy ex 1-12</label>' +
      '<span class="cozy-dock__ic" aria-hidden="true">' + icon('pen-line') + '</span>' +
      '<input class="cozy-dock__in" id="dockText" name="text" type="text" data-js="dock-text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" maxlength="300" placeholder="What did you do this hour?  45m numpy">' +
      '<button class="cozy-dock__btn" type="submit" data-js="dock-btn">' + icon('plus') + '<span>Log</span></button>' +
      '<span class="sr-only" role="status" aria-live="polite" data-js="dock-status"></span>';
  }

  function mount() {
    if (!isToday) return;
    var main = DOC.getElementById('today-main'); if (!main) return;
    var host = J('home-scene');
    if (!host) { host = fallbackHost(main); S.own = true; }
    S.host = host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('cozy-host');
    var hud = J('home-hud', host);
    if (!hud) { hud = DOC.createElement('div'); hud.dataset.js = 'home-hud'; host.appendChild(hud); }
    if (!hud.dataset.cozyBuilt) { hud.classList.add('cozy-hud'); hud.innerHTML = hudHTML(); hud.dataset.cozyBuilt = '1'; }
    S.hud = hud;
    // Today is the room (docs/COZY.md 3a): no docked log bar. A host marked data-no-dock never gets one ("+ Add time" lives in the Today drawer).
    if (host.hasAttribute('data-no-dock')) { var old = J('home-dock', host); if (old) old.remove(); S.dock = null; watchFlat(host); paint(); return; }
    var dock = J('home-dock', host);
    if (!dock) { dock = DOC.createElement('form'); dock.dataset.js = 'home-dock'; dock.method = 'post'; dock.action = '/log'; host.appendChild(dock); }
    if (!dock.dataset.cozyBuilt) { dock.classList.add('cozy-dock'); dock.innerHTML = dockHTML(); dock.dataset.cozyBuilt = '1'; }
    dock.setAttribute('aria-label', 'Log this hour');
    S.dock = dock;
    // the docked bar comes first inside the scene, so the first thing Tab reaches on Today is still a log input
    if (dock.parentNode === host && host.firstChild !== dock) host.insertBefore(dock, host.firstChild);
    watchFlat(host);
    paint();
  }

  /* ---------- the illustrated 2D apartment: the fallback when the 3D scene is missing or WebGL is off (COZY.md 8) ---------- */
  function fallbackHost(main) {
    var sec = DOC.createElement('section');
    sec.className = 'card cozy-home';
    sec.dataset.js = 'home-scene'; sec.dataset.cozyFallback = '1';
    sec.setAttribute('aria-label', 'Your home');
    // after the notices and the level card, before the two columns (it spans the full width on desktop)
    var colL = qs('.b-colL', main);
    main.insertBefore(sec, colL || main.firstChild);
    return sec;
  }
  var flatResize = 0;
  addEventListener('resize', function () { clearTimeout(flatResize); flatResize = setTimeout(function () { if (S.host && J('home-flat', S.host)) paintFlat(); }, 200); });
  function watchFlat(host) {
    var check = function () {
      var no3d = S.own || host.classList.contains('no-webgl') || host.classList.contains('use-svg') || (W() && W().threeOn && !W().threeOn());
      var flat = J('home-flat', host);
      if (no3d && !flat && !J('home-fallback', host)) { flat = DOC.createElement('div'); flat.className = 'cozy-flat'; flat.dataset.js = 'home-flat'; host.insertBefore(flat, S.hud); paintFlat(); }
      else if (!no3d && flat && !S.own) flat.remove();
    };
    check();
    if (!S.own && 'MutationObserver' in window) new MutationObserver(check).observe(host, { attributes: true, attributeFilter: ['class'] });
  }
  var FLAT_KIND = { desk: 'desk', shelf: 'shelf', plant: 'plant', lamp: 'lamp', rug: 'rug', wall: 'board', art: 'art', audio: 'records', sofa: 'sofa', armchair: 'chair', telescope: 'scope', kitchen: 'cup', piano: 'piano', decor: 'clock', coat: 'shelf' };
  function flatPiece(kind, x) {
    var g = '<g transform="translate(' + x + ' 0)">';
    switch (kind) {
      case 'desk': g += '<rect x="-46" y="146" width="92" height="7" rx="2" fill="#9a6a44"/><rect x="-42" y="153" width="5" height="42" fill="#7b5536"/><rect x="37" y="153" width="5" height="42" fill="#7b5536"/><rect x="-16" y="122" width="32" height="22" rx="2" fill="#3f4b60"/><rect x="-13" y="125" width="26" height="15" fill="#a8d4ff"/><circle cx="34" cy="132" r="6" fill="#ffdba0"/>'; break;
      case 'shelf': g += '<rect x="-30" y="70" width="60" height="125" rx="3" fill="#7b5536"/>' + [0, 1, 2, 3].map(function (k) { return '<rect x="-25" y="' + (78 + k * 29) + '" width="50" height="22" fill="#5b4128"/><rect x="-23" y="' + (82 + k * 29) + '" width="7" height="18" fill="#c4553f"/><rect x="-15" y="' + (80 + k * 29) + '" width="6" height="20" fill="#2f4d6e"/><rect x="-8" y="' + (83 + k * 29) + '" width="8" height="17" fill="#d9c39a"/><rect x="2" y="' + (81 + k * 29) + '" width="6" height="19" fill="#3f6b4e"/>'; }).join(''); break;
      case 'plant': g += '<path d="M-14 170h28l-4 25h-20z" fill="#c96f4a"/><circle cx="-10" cy="150" r="14" fill="#3f8f5e"/><circle cx="8" cy="144" r="16" fill="#4fa86f"/><circle cx="0" cy="130" r="12" fill="#2f7a4c"/>'; break;
      case 'lamp': g += '<rect x="-2" y="100" width="4" height="95" fill="#2b2f38"/><path d="M-18 100h36l-8-22h-20z" fill="#efe2c6"/><circle cx="0" cy="104" r="22" fill="#ffdba0" opacity=".25"/>'; break;
      case 'rug': g += '<ellipse cx="0" cy="197" rx="70" ry="9" fill="#b9774f"/><ellipse cx="0" cy="197" rx="52" ry="6" fill="#e8dcc0"/>'; break;
      case 'board': case 'art': g += '<rect x="-28" y="60" width="56" height="40" rx="2" fill="#15171c"/><rect x="-24" y="64" width="48" height="32" fill="' + (kind === 'art' ? '#2a3f74' : '#c9a074') + '"/>' + (kind === 'art' ? '<path d="M-24 96v-10h6v-8h5v12h7v-16h6v14h6v-6h6v14z" fill="#141a2c"/>' : '<rect x="-20" y="68" width="12" height="9" fill="#8cc4ee"/><rect x="-4" y="70" width="12" height="9" fill="#f4c977"/><rect x="10" y="68" width="10" height="9" fill="#ff967a"/><rect x="-14" y="82" width="12" height="9" fill="#62dda8"/>'); break;
      case 'records': g += '<rect x="-34" y="158" width="68" height="37" rx="3" fill="#7b5536"/><rect x="-24" y="150" width="40" height="8" rx="2" fill="#d8cdb8"/><ellipse cx="-6" cy="150" rx="15" ry="3" fill="#15171c"/>'; break;
      case 'sofa': g += '<rect x="-60" y="150" width="120" height="30" rx="10" fill="#4f6b88"/><rect x="-60" y="128" width="120" height="28" rx="10" fill="#5f7d9b"/><rect x="-66" y="140" width="14" height="40" rx="6" fill="#4f6b88"/><rect x="52" y="140" width="14" height="40" rx="6" fill="#4f6b88"/><rect x="-56" y="180" width="6" height="15" fill="#2b2f38"/><rect x="50" y="180" width="6" height="15" fill="#2b2f38"/>'; break;
      case 'chair': g += '<rect x="-26" y="150" width="52" height="28" rx="8" fill="#3d7ab5"/><rect x="-26" y="122" width="52" height="34" rx="10" fill="#4f8cc8"/><rect x="-22" y="178" width="5" height="17" fill="#2b2f38"/><rect x="17" y="178" width="5" height="17" fill="#2b2f38"/>'; break;
      case 'scope': g += '<path d="M0 140l-14 55M0 140l14 55M0 140v55" stroke="#5b4128" stroke-width="3"/><rect x="-30" y="118" width="54" height="12" rx="6" fill="#c9a14a" transform="rotate(-24 0 124)"/>'; break;
      case 'piano': g += '<rect x="-48" y="110" width="96" height="85" rx="4" fill="#1d1e24"/><rect x="-44" y="146" width="88" height="10" fill="#f4f1ea"/>'; break;
      case 'cup': g += '<rect x="-30" y="150" width="60" height="45" rx="3" fill="#4f6b88"/><rect x="-10" y="136" width="20" height="14" rx="3" fill="#e8e1cf"/>'; break;
      default: g += '<rect x="-12" y="150" width="24" height="30" rx="4" fill="#c9a14a"/><circle cx="0" cy="146" r="10" fill="#f3efe6"/>';
    }
    return g + '</g>';
  }
  function hourNow() { var w = W(); try { return w && w.hourFn ? w.hourFn() : new Date().getHours(); } catch (e) { return new Date().getHours(); } }
  function paintFlat() {
    var flat = S.host && J('home-flat', S.host); if (!flat) return;
    var e = S.econ || {}, h = e.home || {}, lay = (h.layout && h.layout.items) || [], hour = hourNow();
    var night = hour < 6.5 || hour >= 19.5, dusk = !night && (hour >= 17.5 || hour < 7.5);
    var sky0 = night ? '#081a33' : dusk ? '#f29a5c' : '#8cc4ee', sky1 = night ? '#2a3f74' : dusk ? '#4a5f9a' : '#dbe7f3';
    var asleep = e.character && e.character.state === 'asleep';
    var items = lay.slice(0, 7), xs = [520, 640, 760, 880, 300, 420, 960];
    var pieces = items.map(function (it, i) { return flatPiece(FLAT_KIND[it.category] || 'other', xs[i]); }).join('');
    var lights = '';
    for (var i = 0; i < 22; i++) { var bx = 170 + i * 14, bh = 22 + ((i * 37) % 60); lights += '<rect x="' + bx + '" y="' + (150 - bh) + '" width="11" height="' + bh + '" fill="' + (night ? '#0d1b33' : '#7d8ea8') + '"/>'; if (night && i % 2) lights += '<rect x="' + (bx + 3) + '" y="' + (150 - bh + 6) + '" width="2" height="2" fill="#ffd696"/>'; }
    var fig = asleep ? '' : '<g transform="translate(' + (items.some(function (x) { return x.category === 'desk'; }) ? 520 : 250) + ' 0)"><rect x="-9" y="164" width="7" height="31" rx="3" fill="#3d5a80"/><rect x="2" y="164" width="7" height="31" rx="3" fill="#3d5a80"/><rect x="-13" y="128" width="26" height="40" rx="8" fill="#f1efe8"/><circle cx="0" cy="116" r="11" fill="#8d5a3b"/><path d="M-11 114a11 11 0 0 1 22 0z" fill="#1d1714"/></g>';
    // a tall scene (Today is the room, docs/COZY.md 3a) gets more wall above the floor strip and a tall window, so the picture fills it
    var hr = S.host.getBoundingClientRect(), A = hr.width > 0 && hr.height > 0 ? hr.width / hr.height : 6;
    var E = A >= 5 ? 0 : Math.round(1100 / Math.max(A, 1.25) - 210), F = Math.round(E * 0.24), wy = Math.round(E * 0.42), wt = 34 - wy, wh = 128 + wy;
    E -= F;                                                      // part of the extra height is floor below the strip, so the HUD bar never hides the room
    flat.dataset.aspect = A.toFixed(2);
    flat.innerHTML = '<svg viewBox="0 ' + (-E) + ' 1100 ' + (210 + E + F) + '" preserveAspectRatio="' + (A < 1 ? 'xMinYMax' : 'xMidYMax') + ' slice" role="img" aria-label="' + esc(roomSummary()) + '" focusable="false">' +
      '<defs><linearGradient id="cfSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky0 + '"/><stop offset="1" stop-color="' + sky1 + '"/></linearGradient></defs>' +
      '<rect y="' + (-E) + '" width="1100" height="' + (210 + E) + '" fill="' + (night ? '#2a2e3a' : '#e9e1d2') + '"/>' +
      (E ? '<rect y="' + (-E) + '" width="1100" height="22" fill="' + (night ? '#22252f' : '#ddd3c1') + '"/>' : '') +
      '<rect x="150" y="' + wt + '" width="340" height="' + wh + '" rx="4" fill="url(#cfSky)"/>' + lights +
      '<path d="M150 ' + Math.round(wt + wh / 2) + 'h340M320 ' + wt + 'v' + wh + '" stroke="#f4f1ea" stroke-width="6"/><rect x="150" y="' + wt + '" width="340" height="' + wh + '" rx="4" fill="none" stroke="#f4f1ea" stroke-width="8"/>' +
      '<rect x="0" y="195" width="1100" height="' + (15 + F) + '" fill="#9a6b47"/>' + (F ? '<rect x="0" y="195" width="1100" height="5" fill="#b5835c"/>' : '') +
      '<g transform="translate(60 0)"><rect x="-40" y="160" width="130" height="35" rx="4" fill="#6d4c35"/><rect x="-36" y="150" width="122" height="16" rx="6" fill="#f2efe8"/><rect x="0" y="146" width="86" height="12" rx="4" fill="#8cb0d6"/>' + (asleep ? '<ellipse cx="-14" cy="146" rx="12" ry="7" fill="#8d5a3b"/>' : '') + '</g>' +
      (night ? '<circle cx="1000" cy="' + (40 - Math.round(wy * 0.6)) + '" r="60" fill="#ffdba0" opacity=".14"/>' : '') +
      pieces + fig + '</svg>' +
      '<p class="cozy-flat__list small">' + esc(lay.length ? 'In the room: ' + lay.map(function (x) { return x.name || x.id; }).join(', ') + '.' : 'Nothing placed yet. Furniture you buy lives here.') + '</p>';
  }
  function roomSummary() {
    var e = S.econ || {}, h = e.home || {}, size = { studio: 'studio', '1-bed': 'one-bedroom', loft: 'loft', penthouse: 'penthouse' }[h.size] || 'home';
    var st = e.character && e.character.state, doing = st === 'asleep' ? "You're asleep." : st === 'studying' ? "You're out studying." : "You're at home.";
    var m = S.missions, mt = m && m.enabled !== false && !quiet() ? ' Missions ' + num(m.done) + ' of ' + num(m.total, 3) + '.' : '';
    return 'Your ' + size + (h.address ? ' at ' + h.address : '') + '. ' + doing + mt;
  }

  /* ---------- painting the chips ---------- */
  function paint() {
    var hud = S.hud; if (!hud) return;
    var e = S.econ;
    if (e) {
      var mnum = J('hud-money-num', hud), pill = J('hud-money', hud);
      if (mnum && mnum.dataset.v === undefined) { mnum.dataset.v = String(Math.trunc(num(e.balance_cents) / 100)); mnum.textContent = usd(e.balance_cents); }
      if (pill) pill.setAttribute('aria-label', 'Savings ' + usd(e.balance_cents) + '. Open the wallet');
      var job = J('hud-job', hud);
      if (job && e.rate) { job.textContent = e.rate.title + ' · $' + num(e.rate.per_hour) + '/h'; job.title = 'Your job and hourly rate'; job.hidden = false; }
    }
    var m = S.missions, mb = J('hud-missions', hud);
    if (mb) {
      var on = !!(m && m.enabled !== false && Array.isArray(m.items) && m.items.length);
      mb.hidden = !on;
      if (on) {
        var done = num(m.done), total = num(m.total, 3) || 3;
        J('hud-missions-n', hud).textContent = done + '/' + total;
        var ring = J('hud-ring', hud); if (ring) ring.setAttribute('stroke-dashoffset', (RING_C * (1 - clamp(done / total, 0, 1))).toFixed(2));
        mb.classList.toggle('is-done', done >= total);
        mb.setAttribute('aria-label', 'Missions: ' + done + ' of ' + total + ' done. Open the missions');
      }
    }
    var c = S.chest, cb = J('hud-chest', hud);
    if (cb) {
      var ready = c ? num(c.ready) : 0;
      cb.hidden = !(ready > 0);
      cb.classList.toggle('is-ready', ready > 0);
      var cn = J('hud-chest-n', hud); if (cn) cn.textContent = ready > 1 ? '×' + ready : '';
      cb.setAttribute('aria-label', ready > 1 ? ready + ' chests are ready. Open one' : 'Your chest is ready. Open it');
    }
    paintStars();
    if (S.own) { S.host.setAttribute('aria-label', roomSummary()); paintFlat(); }
  }
  function paintStars() {
    var el = S.hud && J('hud-stars', S.hud); if (!el) return;
    var w = W(), qsList = w && w.state && w.state.quests;
    var n = Array.isArray(qsList) ? qsList.filter(function (q) { return q.done; }).length : qsa('#today-main .quest.is-done').length;
    var total = Array.isArray(qsList) && qsList.length ? Math.min(3, qsList.length) : 3;
    el.hidden = false;
    var html = ''; for (var i = 0; i < total; i++) html += w && w.ico ? w.ico('star', 'ic' + (i < n ? ' on' : '')) : '';
    el.innerHTML = html; el.setAttribute('aria-label', n + ' of ' + total + ' stars today');
    if (S.stars >= 0 && n > S.stars) { pulse(el); if (n >= total) react('three_stars'); }
    S.stars = n;
  }
  function pulse(el) {
    if (!el || reduced()) return;
    el.classList.remove('is-pulse'); void el.offsetWidth; el.classList.add('is-pulse');
    later(1000, function () { el.classList.remove('is-pulse'); });
  }
  /* the money pill counts up when the coins land (Fredoka numerals, easeOutCubic through Witness.tween) */
  function countTo(cents) {
    var el = S.hud && J('hud-money-num', S.hud); if (!el) return;
    var w = W(), to = Math.trunc(num(cents) / 100);
    if (w && w.tween) w.tween(el, to, function (n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }, 900);
    else el.textContent = usd(cents);
    var pill = J('hud-money', S.hud); if (pill) pill.setAttribute('aria-label', 'Savings ' + usd(cents) + '. Open the wallet');
  }

  /* ====================================================================== coins (COZY.md 4.7) */
  function moneyTarget() {
    var a = S.hud && J('hud-money', S.hud);
    if (visible(a)) return a;
    var b = qsa('[data-js="wallet-pill"]').filter(visible)[0];
    return b || null;
  }
  function pointOf(x) {
    if (!x) return null;
    if (typeof x.x === 'number' && typeof x.y === 'number' && !x.getBoundingClientRect) return x;
    if (!x.getBoundingClientRect || !x.isConnected) return null;
    var r = x.getBoundingClientRect(); if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  var layer = null;
  function coinLayer() { if (!layer || !layer.isConnected) { layer = DOC.createElement('div'); layer.className = 'coinlayer'; layer.setAttribute('aria-hidden', 'true'); DOC.body.appendChild(layer); } return layer; }
  /* 6-12 small coins arc from the source into the pill; the pill counts up as they land. Reduced motion or quiet: just the number. */
  function coins(from, cents, opts) {
    opts = opts || {};
    var done = function () { if (opts.balance != null) countTo(opts.balance); if (opts.onDone) opts.onDone(); };
    var target = moneyTarget(), a = pointOf(from), b = pointOf(target);
    if (reduced() || quiet() || !gameOn() || !a || !b || !(cents > 0) || DOC.hidden || typeof Element.prototype.animate !== 'function') { done(); if (target) pulse(target); return; }
    var dollars = cents / 100, n = clamp(Math.round(5 + Math.log2(1 + dollars)), 6, 12), box = coinLayer(), landed = 0;
    for (var i = 0; i < n; i++) (function (k) {
      var c = DOC.createElement('span'); c.className = 'coin'; c.innerHTML = COIN_SVG; box.appendChild(c);
      var sx = a.x + (Math.random() - 0.5) * 36, sy = a.y + (Math.random() - 0.5) * 18;
      var lift = 70 + Math.random() * 70, mx = (sx + b.x) / 2 + (Math.random() - 0.5) * 80, my = Math.min(sy, b.y) - lift;
      var frames = [], steps = 14;
      for (var s = 0; s <= steps; s++) {
        var t = s / steps, u = 1 - t, x = u * u * sx + 2 * u * t * mx + t * t * b.x, y = u * u * sy + 2 * u * t * my + t * t * b.y;
        var sc = s === 0 ? 0.3 : t < 0.15 ? 1.15 : 1 - t * 0.35;
        frames.push({ transform: 'translate(' + (x - 9).toFixed(1) + 'px,' + (y - 9).toFixed(1) + 'px) scale(' + sc.toFixed(2) + ') rotate(' + Math.round(t * 540 * (k % 2 ? 1 : -1)) + 'deg)', opacity: s === steps ? 0.2 : 1, offset: t });
      }
      var anim = c.animate(frames, { duration: 620 + Math.random() * 220, delay: k * 55, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'both' });
      var fin = function () {
        c.remove(); landed++;
        if (landed === 1) { cue('coin'); }
        if (landed === 1 || landed === n) pulse(target);
        if (landed === n) done();
      };
      anim.onfinish = fin; anim.oncancel = fin;
    })(i);
    // a "+$12" right by the pill, once the first coins arrive
    later(520, function () {
      var p = pointOf(target); if (!p) return;
      var f = DOC.createElement('div'); f.className = 'floaty floaty--money'; f.textContent = '+' + (cents % 100 ? '$' + (cents / 100).toFixed(2) : usd(cents));
      f.style.left = p.x + 'px'; f.style.top = (p.y + 10) + 'px'; DOC.body.appendChild(f); later(1300, function () { f.remove(); });
    });
  }
  function setSource(el) { S.src = el || null; S.srcAt = Date.now(); }
  function sourceNow() {
    if (S.src && Date.now() - S.srcAt < 8000 && (S.src.x != null || (S.src.isConnected && visible(S.src)))) return S.src;
    var dock = S.dock && J('dock-btn', S.dock); if (visible(dock)) return dock;
    if (S.host && visible(S.host)) { var r = S.host.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }; }
    return { x: innerWidth / 2, y: innerHeight * 0.55 };
  }

  /* ====================================================================== reactions to writes (the character, and where coins start) */
  var lastActivity = 0;
  function onWrite(ev) {
    var d = ev.detail || {}, res = d.res || {}, entry = d.entry;
    if (d.source) setSource(d.source);
    lastActivity = Date.now();
    var kinds = (res.events || []).map(function (x) { return String(x && x.kind || '').toLowerCase(); });
    // one reaction per write, the biggest that applies (the scene queues and interrupts the current activity)
    if (kinds.indexOf('target') >= 0 || kinds.indexOf('crown') >= 0) react('crown');
    else if (kinds.indexOf('floor') >= 0) react('doors');
    else if (kinds.indexOf('output') >= 0 || kinds.indexOf('ship') >= 0 || res.output) react('output');
    else if (entry && entry.deep) react('deep');
    else if (entry) react('log');
    var before = d.before && d.before.floors, after = d.today && d.today.floors;
    if (before != null && after != null && after > before) later(1500, function () { react('floor', { floors: after }); });
    later(1100, loadMissionsFull);                              // the done_text for the toast, on any page
    later(1400, function () { readEconomy(true); });
  }
  function onMoney(ev) {
    var d = ev.detail || {}, delta = num(d.delta_cents);
    if (d.economy) apply(d.economy);
    if (delta > 0) coins(sourceNow(), delta, { balance: d.balance_cents });
    else countTo(d.balance_cents);
  }

  /* ====================================================================== the docked log bar */
  function onDockSubmit(e) {
    var f = e.target; if (!f || !f.matches || !f.matches('[data-js="home-dock"]')) return;
    e.preventDefault(); e.stopPropagation();
    var w = W(), inp = J('dock-text', f), btn = J('dock-btn', f), st = J('dock-status', f), raw = inp ? inp.value.trim() : '';
    if (!raw) { if (st) st.textContent = 'Type a line like 45m numpy ex 1-12.'; if (inp) { inp.focus(); inp.classList.remove('is-shake'); void inp.offsetWidth; inp.classList.add('is-shake'); } return; }
    if (!w || !w.sendLog) { HTMLFormElement.prototype.submit.call(f); return; }
    setSource(btn || inp);
    react('ack');                                               // the character looks up at once; the real reaction follows the answer
    if (btn) btn.classList.add('is-busy');
    w.sendLog({ text: raw }, { floatEl: btn || inp }).then(function (res) {
      if (btn) btn.classList.remove('is-busy');
      if (res) { inp.value = ''; if (st) st.textContent = 'Logged.'; }
      else if (st) st.textContent = 'That did not log. Your text is still here.';
    });
  }

  /* ====================================================================== the missions drawer */
  var TIER = { easy: 'Easy', medium: 'Medium', stretch: 'Stretch' };
  function missionNote(m) {
    var p = m.params || {};
    if (m.id === 'deep_n' || m.id === 'deep_stretch') return 'Sized from your own last two weeks of deep focus.';
    if (m.id === 'math_hour' && p.category) return p.category + ' is the subject you studied least this week.';
    if (m.id === 'new_spot') return 'Any study spot other than the last one you used.';
    if (m.id === 'early_bird') return 'The first hour you log today, started before 11 AM.';
    if (m.id === 'doors_by_noon') return 'The 30-minute floor, before 12 noon.';
    if (m.id === 'crown') return "Today's target, the crown on your tower.";
    if (m.id === 'ship_it') return 'A note, a commit, a notebook or a post.';
    if (m.id === 'full_focus') return 'Rate one focus block "Full focus".';
    return '';
  }
  function renderDrawer(full) {
    var d = J('missions-dlg'); if (!d) return;
    var list = J('missions-list', d), msg = J('missions-msg', d), date = J('missions-date', d);
    if (!full) { if (msg) msg.textContent = "Can't reach Epoch right now. Your missions are safe."; return; }
    if (date) date.textContent = full.date ? 'Today, ' + new Date(full.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Today';
    if (full.enabled === false) {
      if (msg) msg.textContent = 'Daily missions are off. Switch them on in Settings and three new ones arrive tomorrow.';
      if (list) list.innerHTML = '';
    } else {
      if (msg) msg.textContent = full.message || '';
      if (list) list.innerHTML = (full.missions || []).map(function (m) {
        var pct = Math.round(clamp(num(m.fraction), 0, 1) * 100), note = missionNote(m);
        return '<li class="mrow' + (m.done ? ' is-done' : '') + '" data-tier="' + esc(m.tier) + '">' +
          '<span class="mrow__check" aria-hidden="true">' + icon(m.done ? 'check' : 'target') + '</span>' +
          '<div class="mrow__b"><div class="mrow__top"><span class="mtier mtier--' + esc(m.tier) + '">' + esc(TIER[m.tier] || m.tier) + '</span><b class="mrow__t">' + esc(m.text) + '</b></div>' +
          '<div class="mbar" role="progressbar" aria-label="' + esc(m.text) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-valuetext="' + esc(m.done ? 'Done' : m.progress_text) + '"><i style="--p:' + (pct / 100).toFixed(3) + '"></i></div>' +
          '<p class="xs muted mrow__p"><span class="num">' + esc(m.done ? 'Done' : m.progress_text) + '</span>' + (note ? ' · ' + esc(note) : '') + '</p></div></li>';
      }).join('');
    }
    renderChestBox(full.chest, full.streak);
  }
  function renderChestBox(c, streak) {
    var d = J('missions-dlg'); if (!d) return;
    var t = J('mchest-title', d), sub = J('mchest-sub', d), btn = J('mchest-open', d), art = J('mchest-art', d);
    if (art && !art.innerHTML) art.innerHTML = CHEST_SVG;
    var ready = c ? num(c.ready) : 0;
    if (t) t.textContent = ready > 1 ? ready + ' chests are ready' : ready === 1 ? 'Your chest is ready' : 'The chest';
    var bits = [];
    if (ready > 0) bits.push(ready > 1 ? 'They never expire. Open them in any order you like.' : 'It never expires.');
    else bits.push(c && c.earned_today ? "Today's chest is opened. Three new missions tomorrow." : 'Finish all three missions and a chest appears in your home.');
    var sk = streak && num(streak.chest_days);
    if (sk > 1) bits.push(sk + ' chest days in a row. Each one adds $10 to the next chest.');
    if (sub) sub.textContent = bits.join(' ');
    if (art) art.classList.toggle('is-ready', ready > 0);
    if (btn) { btn.hidden = !(ready > 0); btn.textContent = ready > 1 ? 'Open one' : 'Open it'; }
    d.classList.toggle('has-chest', ready > 0);
  }
  function openMissions() {
    var d = J('missions-dlg');
    if (!d) { location.href = '/#home'; return; }
    renderDrawer(S.missionsFull);
    if (!d.open && typeof d.showModal === 'function') d.showModal();
    cue('page');
    loadMissionsFull().then(renderDrawer);
  }

  /* ====================================================================== the chest (COZY.md 4.6): kneel, lid pop, light, then the card */
  function played(date) { var raw = store('chests'); return !!(raw && raw.split(',').indexOf(date) >= 0); }
  function markPlayed(date) { var raw = store('chests'), a = raw ? raw.split(',') : []; if (a.indexOf(date) < 0) a.push(date); store('chests', a.slice(-40).join(',')); }
  var chestState = null;    // { layer, res, date, returnFocus }
  function openChest() {
    var w = W(); if (!w || !w.api || S.chestBusy) return;
    if (quiet() || !gameOn()) return;
    var c = S.chest || (S.missionsFull && S.missionsFull.chest);
    var date = c && c.next_date;
    var dlg = J('missions-dlg'); if (dlg && dlg.open) dlg.close('chest');
    if (!date) { toast({ icon: 'info', tone: 'violet', title: 'No chest is waiting. Three missions fill one.' }); return; }
    S.chestBusy = true;
    var animate = !reduced() && !played(date);
    var host = isToday && S.host && S.host.isConnected ? S.host : null;
    if (host && animate) { var r = host.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) host.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    var lay = buildChestLayer(host);
    chestState = { layer: lay, date: date, returnFocus: DOC.activeElement, host: host };
    var t0 = Date.now(), minMs = animate ? 1600 : 0;
    if (animate) { react('chest_open'); lay.classList.add('is-in'); later(380, function () { lay.classList.add('is-pop'); cue('chest'); }); }
    else lay.classList.add('is-static');
    w.api.post('/api/chest/open', { date: date }).then(function (res) {
      if (!res || res.ok === false) { closeChest(); toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That chest did not open. Nothing was lost.' }); return; }
      markPlayed(date);
      chestState.res = res;
      if (res.chest) { S.chest = res.chest; S.chestReady = num(res.chest.ready); paint(); renderChestBox(res.chest, S.missionsFull && S.missionsFull.streak); cozy('setChest', res.chest); }
      later(Math.max(0, minMs - (Date.now() - t0)), function () { showReward(res); });
    }).catch(function () { closeChest(); toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer. The chest stays on the shelf." }); });
  }
  function buildChestLayer(host) {
    var tpl = J('chest-tpl'), lay;
    if (tpl && tpl.content) lay = tpl.content.firstElementChild.cloneNode(true);
    else { lay = DOC.createElement('div'); lay.className = 'cozy-chest'; lay.innerHTML = '<div class="cozy-chest__card" role="dialog" aria-labelledby="chestH" data-js="chest-card" hidden><h2 id="chestH" data-js="chest-title"></h2><ul class="cozy-chest__items" data-js="chest-items"></ul><p class="small muted" data-js="chest-sub"></p><div class="cozy-chest__actions"><button class="btn" type="button" data-js="chest-collect">Collect</button></div></div>'; }
    if (host) { host.appendChild(lay); lay.classList.add('cozy-chest--in-scene'); }
    else { DOC.body.appendChild(lay); lay.classList.add('cozy-chest--overlay'); }
    lay.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); collect(); } if (e.key === 'Tab') { var b = J('chest-collect', lay); if (b && !J('chest-card', lay).hidden) { e.preventDefault(); b.focus(); } } });
    var btn = J('chest-collect', lay); if (btn) btn.addEventListener('click', collect);
    return lay;
  }
  function itemPhrase(items) { return items.map(function (x) { return x.name; }).join(' and '); }
  function showReward(res) {
    var st = chestState; if (!st || !st.layer.isConnected) return;
    var lay = st.layer, card = J('chest-card', lay);
    var when = J('chest-when', lay); if (when && res.date) when.textContent = 'Chest from ' + new Date(res.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    J('chest-title', lay).textContent = res.message || (usd(res.money_cents) + '.');
    var items = Array.isArray(res.items) ? res.items : [];
    var ul = J('chest-items', lay);
    ul.innerHTML = '<li class="cri cri--money">' + COIN_SVG + '<span><b class="num">' + esc(usd(res.money_cents)) + '</b><small>' + esc(res.bonus ? 'with a $' + num(res.bonus) + ' streak bonus' : 'into your savings') + '</small></span></li>' +
      items.map(function (it) {
        var where = it.kind === 'furniture' ? 'in storage, ready to place' : it.kind === 'outfit' ? 'in your wardrobe' : 'in your Passport';
        return '<li class="cri cri--' + esc(it.kind) + '" data-item="' + esc(it.item) + '"><span class="cri__art" data-js="cri-art">' + icon(it.kind === 'postcard' ? 'mail' : it.kind === 'outfit' ? 'person-standing' : 'house') + '</span><span><b>' + esc(it.name) + '</b><small>' + (it.rare ? 'Chest-only. ' : '') + esc(where) + '</small></span></li>';
      }).join('');
    var bits = [];
    if (res.already_opened) bits.push('You opened this one before. Nothing was added twice.');
    if (num(res.streak) > 1) bits.push(num(res.streak) + ' chest days in a row.');
    if (res.pity && res.pity.guaranteed) bits.push('Five chests without a find, so this one had one for sure.');
    var left = res.chest ? num(res.chest.ready) : 0; if (left > 0) bits.push(left + (left === 1 ? ' more chest is' : ' more chests are') + ' waiting.');
    J('chest-sub', lay).textContent = bits.join(' ');
    card.hidden = false; lay.classList.add('is-card');
    var b = J('chest-collect', lay); b.textContent = items.some(function (x) { return x.kind === 'furniture'; }) ? 'Collect' : 'Collect';
    try { b.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    // small 3D pictures of the finds, from the one shared offscreen renderer; let it go again afterwards (Today has its own scenes)
    var finds = items.filter(function (x) { return x.kind === 'furniture' || x.kind === 'outfit'; });
    if (finds.length) thumbs().then(function (m) {
      if (!m) return;
      Promise.all(finds.map(function (it) {
        var p = it.kind === 'outfit' ? m.figureThumb(it.item, { size: 72 }) : m.itemThumb(it.item, it.category, { size: 72 });
        return p.then(function (u) { var slot = qs('[data-item="' + it.item + '"] [data-js="cri-art"]', lay); if (u && slot) slot.innerHTML = '<img alt="" src="' + u + '">'; });
      })).then(function () { if (isToday) m.release(); });
    });
    var sr = DOC.createElement('span'); sr.className = 'sr-only'; sr.setAttribute('role', 'status'); sr.textContent = 'Chest opened: ' + (res.message || ''); lay.appendChild(sr);
  }
  function collect() {
    var st = chestState; if (!st) return;
    var res = st.res, lay = st.layer, card = J('chest-card', lay);
    if (!res) { closeChest(); return; }
    var items = Array.isArray(res.items) ? res.items : [];
    var money = num(res.money_cents), already = !!res.already_opened;
    var from = pointOf(J('chest-collect', lay)) || pointOf(card);
    if (window.WitnessMoney && window.WitnessMoney.sync) { try { window.WitnessMoney.sync(res.balance_cents); } catch (e) { /* optional */ } }
    var end = function () {
      closeChest();
      if (items.some(function (x) { return x.kind === 'furniture'; })) toast({ icon: 'house', tone: 'mint', title: itemPhrase(items.filter(function (x) { return x.kind === 'furniture'; })) + ' is in storage.', sub: 'Place it from Decorate.', ms: 5200 });
      if (items.some(function (x) { return x.kind === 'outfit'; })) toast({ icon: 'person-standing', tone: 'mint', title: itemPhrase(items.filter(function (x) { return x.kind === 'outfit'; })) + ' is yours.', sub: 'Wear it from the store, under Outfits.', ms: 5200 });
      if (items.some(function (x) { return x.kind === 'postcard'; })) toast({ icon: 'mail', tone: 'violet', title: 'A new postcard is in your Passport.', ms: 5200 });
      readEconomy(true); loadMissionsFull();
      if (items.some(function (x) { return x.kind === 'furniture'; })) cozy('refresh');
    };
    if (reduced() || already) { countTo(res.balance_cents); end(); return; }
    // the card flies to the wallet (and a find to the Decorate button), the coins pour into the pill
    var target = pointOf(moneyTarget()), dec = pointOf(S.hud && J('hud-decorate', S.hud));
    var goal = items.some(function (x) { return x.kind === 'furniture'; }) && dec ? dec : target;
    if (goal && card.animate) {
      var r = card.getBoundingClientRect(), dx = goal.x - (r.left + r.width / 2), dy = goal.y - (r.top + r.height / 2);
      card.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.12)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      lay.classList.add('is-leaving');
    }
    if (money > 0) coins(from, money, { balance: res.balance_cents });
    else countTo(res.balance_cents);
    later(560, end);
  }
  function closeChest() {
    var st = chestState; chestState = null; S.chestBusy = false;
    if (!st) return;
    st.layer.remove();
    cozy('react', 'chest_done');
    var back = (S.hud && J('hud-chest', S.hud)) || st.returnFocus;
    if (back && back.isConnected && !back.hidden) { try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    else { var m = S.hud && J('hud-missions', S.hud); if (m) try { m.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  /* ====================================================================== 3D thumbnails (city/thumbs.js, one shared renderer) */
  var thumbsP = null;
  function thumbs() {
    var w = W();
    if (!w || !w.base || !w.ensureImportMap || (w.threeOn && !w.threeOn())) return Promise.resolve(null);
    if (!thumbsP) {
      try { w.ensureImportMap(); } catch (e) { return Promise.resolve(null); }
      thumbsP = import(new URL('city/thumbs.js', w.base).href).then(function (m) { return m && m.supported() ? m : null; }).catch(function () { return null; });
    }
    return thumbsP;
  }

  /* ====================================================================== decorating and "Place it now" (COZY.md 4.3) */
  function decorate(opts) {
    opts = opts || {};
    var w = W();
    if (w && w.cozy && typeof w.cozy.decorate === 'function') { cozy('decorate', opts); return; }
    // the free-placement mode is not on this page yet: the room view still shows the new piece
    if (w && typeof w.openRoom === 'function') { w.openRoom(); if (opts.item) toast({ icon: 'house', tone: 'mint', title: 'Your new piece is in the room.', sub: 'It sits in the first good free spot.' }); }
  }
  /* a box drops into the apartment, opens, the piece pops out (300 ms), then decorate mode starts with it selected */
  function unbox(item) {
    if (!item) return;
    var w = W();
    if (w && w.cozy && typeof w.cozy.unbox === 'function') { cozy('unbox', item); return; }     // the 3D scene does it in the room itself
    var host = S.host;
    if (reduced() || !host || !visible(host)) { decorate({ item: item, select: true }); return; }
    var box = DOC.createElement('div'); box.className = 'cozy-box'; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="cozy-box__item" data-js="box-item"></div><div class="cozy-box__crate"><i class="cozy-box__flap cozy-box__flap--l"></i><i class="cozy-box__flap cozy-box__flap--r"></i><i class="cozy-box__tape"></i></div><i class="cozy-box__shadow"></i>';
    host.appendChild(box);
    var it = (S.econ && S.econ.home && S.econ.home.layout && (S.econ.home.layout.items || []).concat(S.econ.home.layout.storage || []).filter(function (x) { return (x.id || x.item) === item; })[0]) || {};
    thumbs().then(function (m) { if (!m) return; return m.itemThumb(item, it.category, { size: 140 }).then(function (u) { var s = J('box-item', box); if (u && s) s.innerHTML = '<img alt="" src="' + u + '">'; }); });
    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(function () { box.classList.add('is-drop'); });
    later(650, function () { cue('place'); box.classList.add('is-open'); });
    later(1250, function () { box.classList.add('is-out'); });
    later(1900, function () { box.remove(); decorate({ item: item, select: true }); });
  }
  function handleArrival() {
    if (!isToday) return;
    var sp; try { sp = new URLSearchParams(location.search); } catch (e) { return; }
    var place = sp.get('place'), deco = sp.get('decorate'), item = sp.get('item');
    if (!place && !deco) return;
    try { history.replaceState(null, '', location.pathname + (location.hash || '')); } catch (e) { /* ignore */ }
    var go = function () { if (place) unbox(place); else decorate(item ? { item: item, select: true } : {}); };
    // give the scene a moment to appear (it starts after first paint)
    var tries = 0, wait = function () { var w = W(); if ((w && w.cozy && w.cozy.decorate) || tries++ > 12) go(); else later(250, wait); };
    later(400, wait);
  }

  /* ====================================================================== wiring */
  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-js="hud-missions"],[data-js="hud-chest"],[data-js="mchest-open"],[data-js="hud-decorate"]');
    if (!t) return;
    var k = t.dataset.js;
    if (k === 'hud-missions') { e.preventDefault(); openMissions(); }
    else if (k === 'hud-chest' || k === 'mchest-open') { e.preventDefault(); setSource(t); openChest(); }
    else if (k === 'hud-decorate') { e.preventDefault(); decorate({}); }
  }
  function onSetting(e) {
    var d = e.detail || {};
    if (d.name === 'daily_missions' || d.name === 'quiet_mode' || d.name === 'game_enabled') later(400, function () { readEconomy(true); loadMissionsFull(); });
    if (d.name === 'three_d' && S.host) later(50, function () { watchFlat(S.host); });
  }
  var waved = false;
  function greet() {
    if (!isToday || waved || DOC.hidden) return;
    var last = num(store('seen'), 0), now = Date.now();
    store('seen', String(now));
    if (now - last > 30 * 60000) { waved = true; later(1200, function () { react('wave'); }); }
  }
  function init() {
    var w = W(); if (!w) return;
    mount();
    DOC.addEventListener('click', onClick);
    DOC.addEventListener('submit', onDockSubmit, true);
    // where the coins start: the button that was just pressed (the log button, a repeat chip, Ship it, the block-done card)
    DOC.addEventListener('submit', function (e) { var b = e.submitter || (e.target && e.target.querySelector && e.target.querySelector('[type=submit]')); if (b && !S.chestBusy) setSource(b); }, true);
    DOC.addEventListener('pointerdown', function (e) { var b = e.target.closest && e.target.closest('button, .btn, .chipbtn'); if (b && !S.chestBusy) setSource(b); }, true);
    DOC.addEventListener('witness:write', onWrite);
    DOC.addEventListener('witness:money', onMoney);
    DOC.addEventListener('witness:setting', onSetting);
    DOC.addEventListener('witness:refreshed', function () { paintStars(); if (Date.now() - S.lastEcon > 20000) readEconomy(); });
    DOC.addEventListener('htmx:afterSettle', function () { if (isToday && S.host && !S.host.isConnected) { S.hud = S.dock = null; mount(); } });
    DOC.addEventListener('visibilitychange', function () { if (!DOC.hidden) { greet(); if (Date.now() - S.lastEcon > 60000) readEconomy(); } });
    if (isToday) { readEconomy().then(function () { S.primed = true; handleArrival(); greet(); }); loadMissionsFull(); }
    else S.primed = true;          // other pages read after a write only; what this browser has already seen is the baseline
    // the 2D apartment's light follows the hour
    if (S.own) setInterval(function () { if (!DOC.hidden) paintFlat(); }, 10 * 60000);
  }

  window.Witness = window.Witness || {};
  window.Witness.cozyUI = {
    coins: function (from, cents, opts) { coins(from, cents, opts); }, refresh: function () { return readEconomy(true); },
    openMissions: openMissions, openChest: openChest, decorate: decorate, unbox: unbox, setSource: setSource, summary: roomSummary,
    get missions() { return S.missions; }, get chest() { return S.chest; },
  };
  try { init(); } catch (e) { console.error('Epoch cozy HUD could not start; the page still works.', e); }
})();
