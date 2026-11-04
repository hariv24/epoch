/* audio.js · Epoch sound: phase-change chimes and synthesised soundscapes (rain, cafe, brown noise, subway).
 *
 * Everything is made with the Web Audio API from generated noise and a few oscillators. There are no audio files and no
 * network requests. Soundscapes are OFF by default and fade in and out. Chimes respect the Sound toggle (Witness.prefs.sound).
 * Browsers only allow audio after a tap or key press, so the first interaction on a page "unlocks" it.
 *
 * Public handle: window.WitnessAudio
 *   chime('work'|'break'|'done')           soft three-note bell (only if the Sound toggle is on)
 *   cue('coin'|'mission'|'chest'|'place'|'page')  tiny game cues for the cozy HUD (only if the Sound toggle is on)
 *   play(name) / stop()                    start or fade out a soundscape ('rain'|'cafe'|'brown'|'subway')
 *   setVolume(0..100), volume()            master level of the soundscape
 *   selected(), playing(), blocked()       state; blocked() is true while the browser is still waiting for a tap
 *   on(fn)                                 fn(event, data) for 'select' (a picker changed), 'state' (playing/blocked changed)
 *   managed = true                         a page (the Focus Screen) decides when to play; the picker only emits 'select'
 *
 * The picker markup is _soundscape.html ([data-js="soundscape"]); this file wires every instance on the page.
 */
(function () {
  'use strict';
  var DOC = document, BODY = DOC.body, D = BODY.dataset || {};
  function qs(s, r) { return (r || DOC).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || DOC).querySelectorAll(s)); }
  function J(n, r) { return qs('[data-js="' + n + '"]', r); }
  function num(x, d) { x = Number(x); return isFinite(x) ? x : d; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('witness.app.' + k); if (v === null) localStorage.removeItem('witness.app.' + k); else localStorage.setItem('witness.app.' + k, v); } catch (e) { /* private mode */ } return null; }

  var ctx = null, master = null, comp = null;
  var noiseCache = {};
  var cur = null;                    // { name, out, stop }
  // The soundscape and its level belong to THIS device: picking rain on the laptop must not make the tablet start rain too.
  // (The server's saved value is only the first-run level; it is never used to start a sound by itself.)
  var storedVol = store('ss.vol');
  var vol = Math.min(100, Math.max(0, storedVol !== null && storedVol !== '' ? num(storedVol, 40) : num(D.soundscapeVolume, 40)));
  var sel = ['rain', 'cafe', 'brown', 'subway'].indexOf(store('ss.sel')) >= 0 ? store('ss.sel') : 'off';
  var listeners = [];
  var wantPlay = null;               // a soundscape the user asked for while the browser still blocks audio
  var unlockBound = false;

  function emit(ev, data) { listeners.slice().forEach(function (f) { try { f(ev, data); } catch (e) { /* listener failed */ } }); }
  function reduced() { var W = window.Witness; return !!(W && W.reduced && W.reduced()); }

  /* ---------------------------------------------------------------- context */
  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
        master = ctx.createGain(); master.gain.value = 0;
        master.connect(comp); comp.connect(ctx.destination);
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* needs a gesture */ } }
    return ctx;
  }
  function isBlocked() { return !!(ctx && ctx.state !== 'running') || (!ctx && !!wantPlay); }
  function bindUnlock() {
    if (unlockBound) return; unlockBound = true;
    var go = function () {
      ensure();
      if (ctx && ctx.state === 'running') {
        DOC.removeEventListener('pointerdown', go, true); DOC.removeEventListener('keydown', go, true); unlockBound = false;
        if (wantPlay) { var n = wantPlay; wantPlay = null; start(n); }
        emit('state', {});
      }
    };
    DOC.addEventListener('pointerdown', go, true); DOC.addEventListener('keydown', go, true);
  }

  /* ---------------------------------------------------------------- noise buffers (looped without a seam) */
  function makeNoise(kind) {
    if (noiseCache[kind]) return noiseCache[kind];
    var rate = ctx.sampleRate, L = Math.floor(rate * 6), X = Math.floor(rate * 0.6), N = L + X, a = new Float32Array(N), i;
    if (kind === 'white') { for (i = 0; i < N; i++) a[i] = Math.random() * 2 - 1; }
    else if (kind === 'pink') {
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, w;
      for (i = 0; i < N; i++) {
        w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    } else {   // brown: integrated white noise, leaky so it does not drift
      var last = 0;
      for (i = 0; i < N; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; a[i] = last * 3.5; }
    }
    var out = ctx.createBuffer(1, L, rate), o = out.getChannelData(0);
    for (i = 0; i < L; i++) o[i] = a[i];
    for (i = 0; i < X; i++) { var t = i / X; o[i] = a[i] * Math.sin(t * Math.PI / 2) + a[L + i] * Math.cos(t * Math.PI / 2); }   // equal-power crossfade of the tail into the head
    noiseCache[kind] = out; return out;
  }
  function noiseSrc(kind, offsetFrac) {
    var s = ctx.createBufferSource(); s.buffer = makeNoise(kind); s.loop = true;
    s.start(0, (offsetFrac == null ? Math.random() : offsetFrac) * s.buffer.duration);
    return s;
  }
  function filt(type, f, q) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; }
  function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  function lfo(rate, depth, target, base) {      // slow wobble of an AudioParam
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = rate; g.gain.value = depth; target.value = base; o.connect(g); g.connect(target); o.start(); return o;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* a scene collects its nodes and timers so stop() can clean up */
  function scene() {
    var nodes = [], timers = [], alive = true;
    return {
      add: function (n) { nodes.push(n); return n; },
      every: function (fn, minMs, maxMs) { var loop = function () { if (!alive) return; fn(); timers.push(setTimeout(loop, rnd(minMs, maxMs))); }; timers.push(setTimeout(loop, rnd(minMs, maxMs) * 0.5)); },
      kill: function () { alive = false; timers.forEach(clearTimeout); nodes.forEach(function (n) { try { if (n.stop) n.stop(); } catch (e) { /* already stopped */ } try { n.disconnect(); } catch (e) { /* gone */ } }); nodes = []; timers = []; },
      get alive() { return alive; },
    };
  }
  function ping(sc, out, f, dur, peak, type) {       // one short, soft blip
    peak = Math.max(0.0003, peak);
    var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  function tick(out, f, dur, peak, q) {              // a tiny filtered noise burst (a raindrop, a wheel joint)
    peak = Math.max(0.0003, peak);
    var t = ctx.currentTime, s = ctx.createBufferSource(), g = ctx.createGain(), b = filt('bandpass', f, q || 1.2);
    s.buffer = makeNoise('white'); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(b); b.connect(g); g.connect(out); s.start(t, Math.random() * 4, dur + 0.05);
  }

  var BUILD = {
    brown: function (out, sc) {
      var s = sc.add(noiseSrc('brown')), lp = sc.add(filt('lowpass', 900, 0.4)), g = sc.add(gain(0.9));
      s.connect(lp); lp.connect(g); g.connect(out);
    },
    rain: function (out, sc) {
      var bed = sc.add(noiseSrc('white')), hp = sc.add(filt('highpass', 600, 0.5)), lp = sc.add(filt('lowpass', 9000, 0.3)), bg = sc.add(gain(0.16));
      bed.connect(hp); hp.connect(lp); lp.connect(bg); bg.connect(out);
      var body = sc.add(noiseSrc('pink')), bp = sc.add(filt('bandpass', 1700, 0.35)), pg = sc.add(gain(0.55));
      body.connect(bp); bp.connect(pg); pg.connect(out);
      var low = sc.add(noiseSrc('brown')), llp = sc.add(filt('lowpass', 260, 0.5)), lg = sc.add(gain(0.2));
      low.connect(llp); llp.connect(lg); lg.connect(out);
      sc.add(lfo(0.06, 0.04, bg.gain, 0.16));
      sc.add(lfo(0.045, 0.1, pg.gain, 0.55));
      var drops = sc.add(gain(1)); drops.connect(out);
      sc.every(function () { var n = 1 + Math.floor(Math.random() * 3); for (var i = 0; i < n; i++) (function (d) { setTimeout(function () { if (sc.alive) tick(drops, rnd(1800, 5200), rnd(0.012, 0.03), rnd(0.05, 0.14), 2); }, d); })(i * rnd(10, 70)); }, 35, 160);
      sc.every(function () { ping(sc, drops, rnd(900, 2400), rnd(0.03, 0.07), rnd(0.008, 0.02)); }, 600, 2200);   // a drop on a window ledge
    },
    cafe: function (out, sc) {
      var voices = [[320, 0.9, 0.11], [560, 0.8, 0.17], [900, 0.9, 0.23], [1400, 0.7, 0.31], [2100, 0.7, 0.13]];
      var sum = sc.add(gain(0.8)), lp = sc.add(filt('lowpass', 2800, 0.4)); sum.connect(lp); lp.connect(out);
      voices.forEach(function (v, i) {
        var s = sc.add(noiseSrc('pink', i / 5)), b = sc.add(filt('bandpass', v[0], v[1] * 3)), g = sc.add(gain(0.5));
        s.connect(b); b.connect(g); g.connect(sum);
        sc.add(lfo(v[2], 0.28, g.gain, 0.34));                                    // syllable-like rise and fall
        sc.add(lfo(v[2] * 0.37 + 0.05, 80 + 60 * i, b.frequency, v[0]));            // the voices drift in pitch
      });
      var room = sc.add(noiseSrc('brown')), rl = sc.add(filt('lowpass', 220, 0.4)), rg = sc.add(gain(0.35));
      room.connect(rl); rl.connect(rg); rg.connect(out);
      var cl = sc.add(gain(1)); cl.connect(out);
      sc.every(function () { var f = rnd(2300, 3600); ping(sc, cl, f, rnd(0.18, 0.4), rnd(0.012, 0.03)); if (Math.random() < 0.6) setTimeout(function () { if (sc.alive) ping(sc, cl, f * rnd(1.4, 1.62), rnd(0.12, 0.3), rnd(0.008, 0.02)); }, rnd(40, 110)); }, 3500, 11000);   // a cup on a saucer
      sc.every(function () { tick(cl, rnd(400, 900), rnd(0.05, 0.12), rnd(0.05, 0.1), 0.8); }, 5000, 14000);                                                             // a chair
    },
    subway: function (out, sc) {
      var base = sc.add(noiseSrc('brown')), bl = sc.add(filt('lowpass', 170, 0.6)), bg = sc.add(gain(0.7));
      base.connect(bl); bl.connect(bg); bg.connect(out);
      sc.add(lfo(0.05, 0.12, bg.gain, 0.7));
      var air = sc.add(noiseSrc('pink')), al = sc.add(filt('lowpass', 500, 0.5)), ag = sc.add(gain(0.1));
      air.connect(al); al.connect(ag); ag.connect(out);
      function pass() {                                                // a train goes by: a swell with a moving filter and wheel clacks
        if (!sc.alive) return;
        var t = ctx.currentTime, dur = rnd(11, 16), peak = rnd(0.5, 0.8);
        var n = ctx.createBufferSource(); n.buffer = makeNoise('brown'); n.loop = true;
        var bp = filt('bandpass', 110, 0.9), g = ctx.createGain(), hs = filt('highpass', 1400, 0.4), hg = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        bp.frequency.setValueAtTime(95, t); bp.frequency.exponentialRampToValueAtTime(300, t + dur * 0.45); bp.frequency.exponentialRampToValueAtTime(130, t + dur);
        hg.gain.setValueAtTime(0.0001, t); hg.gain.exponentialRampToValueAtTime(0.035, t + dur * 0.4); hg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.85);
        var w = ctx.createBufferSource(); w.buffer = makeNoise('white'); w.loop = true; w.connect(hs); hs.connect(hg); hg.connect(out);
        n.connect(bp); bp.connect(g); g.connect(out);
        n.start(t, Math.random() * 4); w.start(t, Math.random() * 4); n.stop(t + dur + 0.2); w.stop(t + dur + 0.2);
        var clacks = Math.floor(dur * 3.2), step = 0.3;
        for (var i = 0; i < clacks; i++) {
          var at = i * step * (1 - 0.35 * Math.sin(i / clacks * Math.PI)), k = Math.sin(i / clacks * Math.PI);
          (function (delay, level) { setTimeout(function () { if (sc.alive) { tick(out, rnd(180, 420), 0.06, 0.1 * level, 1); ping(sc, out, 62, 0.09, 0.07 * level); } }, delay * 1000); })(at + 0.5, k);
        }
      }
      sc.every(pass, 22000, 40000);
      setTimeout(function () { if (sc.alive) pass(); }, 2500);
    },
  };

  /* ---------------------------------------------------------------- soundscape control */
  function level() { return Math.pow(vol / 100, 1.7) * 0.9; }
  function fadeMaster(to, secs) { if (!ctx || !master) return; var t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(to, t + secs); }
  function start(name) {
    if (!BUILD[name]) return false;
    wantPlay = name;
    if (!ensure()) { return false; }
    if (ctx.state !== 'running') { bindUnlock(); emit('state', {}); return false; }     // wait for a tap
    wantPlay = null;
    if (cur && cur.name === name) { fadeMaster(level(), 0.4); return true; }
    var old = cur;
    if (old) { var og = old.out; try { og.gain.setTargetAtTime(0, ctx.currentTime, 0.4); } catch (e) { /* ignore */ } setTimeout(function () { old.sc.kill(); try { og.disconnect(); } catch (e) { /* gone */ } }, 1800); }
    var out = ctx.createGain(); out.gain.value = old ? 0 : 1; out.connect(master);
    var sc = scene();
    try { BUILD[name](out, sc); } catch (e) { sc.kill(); return false; }
    if (old) out.gain.setTargetAtTime(1, ctx.currentTime, 0.7);
    cur = { name: name, out: out, sc: sc };
    fadeMaster(level(), old ? 0.4 : (reduced() ? 0.5 : 2.6));
    emit('state', {});
    return true;
  }
  function stop() {
    wantPlay = null;
    if (!cur) { emit('state', {}); return; }
    var c = cur; cur = null;
    fadeMaster(0, reduced() ? 0.3 : 1.4);
    setTimeout(function () { if (cur && cur === c) return; c.sc.kill(); try { c.out.disconnect(); } catch (e) { /* gone */ } }, 1700);
    emit('state', {});
  }

  /* ---------------------------------------------------------------- chimes */
  function bell(f, at, dur, peak) {
    var t = ctx.currentTime + at;
    [[1, 1], [2.01, 0.28], [3.02, 0.1]].forEach(function (h) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * h[0];
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * h[1], t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / h[0] * 1.2);
      o.connect(g); g.connect(comp || ctx.destination); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function chime(kind) {
    var W = window.Witness; if (W && W.prefs && !W.prefs.sound) return;
    if (!ensure() || ctx.state !== 'running') return;
    var C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
    if (kind === 'break') { bell(G5, 0, 1.6, 0.07); bell(E5, 0.32, 1.7, 0.06); bell(C5, 0.66, 2.2, 0.06); }
    else if (kind === 'done') { bell(C5, 0, 1.4, 0.06); bell(E5, 0.18, 1.4, 0.06); bell(G5, 0.36, 1.4, 0.06); bell(C6, 0.58, 2.6, 0.07); }
    else { bell(C5, 0, 1.5, 0.07); bell(G5, 0.28, 2.0, 0.07); }       // back to work
  }
  /* small game cues for the cozy HUD (docs/COZY.md 4.7): quiet, short, only with the Sound toggle on */
  function swell(f0, f1, dur, peak) {
    var t = ctx.currentTime, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.7);
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); o2.frequency.setValueAtTime(f0 * 1.5, t); o2.frequency.exponentialRampToValueAtTime(f1 * 1.5, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(comp || ctx.destination); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function rustle(dur, peak) {      // a page turn: a short band of noise that sweeps up
    var t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = makeNoise('white'); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(4200, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(comp || ctx.destination); s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
  }
  function cue(kind) {
    var W = window.Witness; if (!W || !W.prefs || !W.prefs.sound) return;
    if (!ensure() || ctx.state !== 'running') return;
    if (kind === 'coin') { bell(1318.5, 0, 0.35, 0.03); bell(1975.5, 0.07, 0.5, 0.025); }
    else if (kind === 'mission') { bell(783.99, 0, 0.9, 0.04); bell(1174.7, 0.12, 1.2, 0.035); }
    else if (kind === 'chest') { swell(220, 660, 1.4, 0.05); bell(1046.5, 1.15, 1.6, 0.04); bell(1568, 1.3, 1.8, 0.03); }
    else if (kind === 'place') { bell(392, 0, 0.18, 0.05); }
    else if (kind === 'page') { rustle(0.28, 0.04); }
  }

  /* ---------------------------------------------------------------- the picker (every [data-js="soundscape"] on the page) */
  var panels = [];
  function syncPickers() {
    panels.forEach(function (p) {
      qsa('[data-js="ss-choice"]', p).forEach(function (r) { r.checked = r.value === sel; });
      var v = J('ss-volume', p); if (v && Number(v.value) !== vol) v.value = vol;
      var t = J('ss-vol-text', p); if (t) t.textContent = String(vol);
      var h = J('ss-hint', p);
      if (h) h.textContent = wantPlay && isBlocked() ? 'Tap anywhere once and the ' + labelOf(wantPlay) + ' starts.' : (cur ? labelOf(cur.name) + ' is playing.' : '');
    });
    qsa('[data-js="sounds-open"]').forEach(function (b) { b.classList.toggle('is-on', !!cur); });
  }
  function labelOf(n) { return { rain: 'rain', cafe: 'cafe', brown: 'brown noise', subway: 'subway rumble' }[n] || n; }
  function pick(name, fromUser) {
    sel = name; if (fromUser) store('ss.sel', name === 'off' ? null : name);
    D.soundscape = name; try { BODY.dataset.soundscape = name; } catch (e) { /* ignore */ }
    emit('select', { name: name, user: !!fromUser });
    if (!api.managed) { if (name === 'off') stop(); else start(name); }
    syncPickers();
  }
  function initPicker(p) {
    panels.push(p);
    qsa('[data-js="ss-choice"]', p).forEach(function (r) { r.addEventListener('change', function () { if (r.checked) pick(r.value, true); }); });
    var v = J('ss-volume', p), saveT = 0;
    if (v) {
      v.addEventListener('input', function () { vol = Math.min(100, Math.max(0, num(v.value, 40))); if (cur) fadeMaster(level(), 0.15); syncPickers(); });
      v.addEventListener('change', function () { clearTimeout(saveT); saveT = setTimeout(function () { store('ss.vol', String(vol)); }, 250); });
    }
    var br = J('ss-breaks', p);
    if (br) { br.checked = store('ss.breaks') === '1'; br.addEventListener('change', function () { store('ss.breaks', br.checked ? '1' : null); emit('select', { name: sel, user: false }); }); }
    var x = J('sounds-close', p); if (x) x.addEventListener('click', function () { closePanel(p); });
  }
  function closePanel(p) {
    p.hidden = true;
    qsa('[data-js="sounds-open"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    var b = J('sounds-open'); if (b) b.focus({ preventScroll: true });
  }
  function init() {
    qsa('[data-js="soundscape"]').forEach(initPicker);
    DOC.addEventListener('click', function (e) {
      var o = e.target.closest && e.target.closest('[data-js="sounds-open"]');
      if (o) {
        var p = qs('#soundsPanel'); if (!p) return;
        var open = p.hidden; p.hidden = !open; o.setAttribute('aria-expanded', String(open));
        if (open) { var f = qs('input:checked', p) || qs('input', p); if (f) f.focus({ preventScroll: true }); }
        return;
      }
      var pan = qs('#soundsPanel');
      if (pan && !pan.hidden && !(e.target.closest && e.target.closest('#soundsPanel'))) { pan.hidden = true; qsa('[data-js="sounds-open"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); }
    });
    DOC.addEventListener('keydown', function (e) { var pan = qs('#soundsPanel'); if (e.key === 'Escape' && pan && !pan.hidden) { e.stopPropagation(); closePanel(pan); } });
    DOC.addEventListener('pointerdown', function () { ensure(); }, { once: true, capture: true });   // first tap anywhere unlocks audio
    syncPickers();
  }

  var api = window.WitnessAudio = {
    ensure: ensure, chime: chime, cue: cue, play: start, stop: stop,
    setVolume: function (v) { vol = Math.min(100, Math.max(0, num(v, vol))); if (cur) fadeMaster(level(), 0.15); syncPickers(); },
    volume: function () { return vol; },
    selected: function () { return sel; }, playing: function () { return cur ? cur.name : null; }, blocked: function () { return !!wantPlay && isBlocked(); },
    pauseOnBreak: function () { return store('ss.breaks') === '1'; },
    on: function (fn) { listeners.push(fn); }, managed: false, labelOf: labelOf,
  };
  api.refreshUI = syncPickers;
  if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', init); else init();
})();
