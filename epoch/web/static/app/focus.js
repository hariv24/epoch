/* focus.js · Epoch Focus Screen + shared Pomodoro client + live sync.
 *
 *  - A small client for the server-side Pomodoro (docs/FEATURES-V2.md sections 3 and 4): GET /api/pomodoro, the SSE stream
 *    GET /api/stream (with a 5 s polling fallback), countdowns computed from phase_ends_at and the server clock offset.
 *  - The Focus Screen (/pomodoro): dial, phases, presets + a Custom rhythm (steppers), controls, "+5 min" buttons, the end-of-block sheet
 *    (rate, Keep going, Start break), break tips, chimes, soundscape, fullscreen, construction cam. A finished work block HOLDS the run
 *    ("between" state): the break starts only when the person answers the block or taps Start break. The server renders the current
 *    state and every control is a real form, so it works without this file.
 *  - Today: the "Start a focus run" sheet, the live run card, and game events made on another device (the tablet) played here.
 *
 * Needs window.Witness (app.js) and, optionally, window.WitnessAudio (audio.js).
 */
(function () {
  'use strict';
  var W = window.Witness;
  if (!W) return;
  var DOC = document, ROOT = DOC.documentElement, BODY = DOC.body;
  var PAGE = (BODY.dataset && BODY.dataset.page) || '';
  // the study-spot modules load from this script's own folder (pages load code from /static/v/<fingerprint>/): keep every path relative
  var SPOT_BASE = new URL('./', (DOC.currentScript && DOC.currentScript.src) || location.href), SPOT_VENDOR = new URL('../vendor/', SPOT_BASE);
  function qs(s, r) { return (r || DOC).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || DOC).querySelectorAll(s)); }
  function J(n, r) { return qs('[data-js="' + n + '"]', r); }
  function num(x, d) { x = Number(x); return isFinite(x) ? x : (d == null ? 0 : d); }
  function later(ms, fn) { return setTimeout(fn, ms); }
  var api = W.api;

  /* ====================================================================== shared Pomodoro client */
  var P = {
    state: null, offset: 0, rev: -1, listeners: [], first: true, samples: [],
    onState: function (fn) { P.listeners.push(fn); if (P.state) fn(P.state, { initial: true }); },
    now: function () { return Date.now() + P.offset; },
    remaining: function (run) {
      if (!run || run.phase === 'done' || run.phase === 'waiting') return 0;
      if (run.paused || !run.phase_ends_at) return Math.max(0, num(run.remaining_seconds));
      return Math.max(0, Math.ceil((Date.parse(run.phase_ends_at) - P.now()) / 1000));
    },
    apply: function (s) {
      if (!s || s.ok === false || typeof s !== 'object') return;
      if (s.server_epoch_ms) {
        // server_epoch_ms is cut to whole seconds and a pushed state can be a moment old, so every sample UNDER-estimates the server clock.
        // The largest recent sample is the best one.
        var nowMs = Date.now(); P.samples.push({ t: nowMs, off: s.server_epoch_ms - nowMs });
        P.samples = P.samples.filter(function (x) { return nowMs - x.t < 600000; }).slice(-14);
        P.offset = Math.max.apply(null, P.samples.map(function (x) { return x.off; })) + 150;
      }
      var prev = P.state, changed = !prev || s.rev !== prev.rev || (s.run && prev.run && (s.run.status !== prev.run.status || s.run.phase !== prev.run.phase));
      P.state = s; P.rev = s.rev;
      var first = P.first; P.first = false;
      P.listeners.slice().forEach(function (fn) { try { fn(s, { prev: prev, changed: changed, first: first }); } catch (e) { console.warn('pomodoro listener', e); } });
    },
    fetch: function () { return api.get('/api/pomodoro').then(function (s) { P.apply(s); return s; }).catch(function () { return null; }); },
    post: function (action, body) { return api.post('/api/pomodoro/' + action, body || {}); },
  };
  W.pomodoro = P;

  /* ====================================================================== live transport: SSE, then polling */
  var live = { es: null, mode: 'off', poll: 0, hiddenAt: 0, closeT: 0 };
  function setMode(m) {
    live.mode = m;
    var el = J('sync-state');
    if (el) { el.dataset.mode = m; var t = qs('span', el); if (t) t.textContent = m === 'live' ? 'Live' : m === 'poll' ? 'Syncing' : 'Offline'; }
  }
  function startPolling() {
    if (live.poll) return;
    setMode('poll');
    var go = function () { P.fetch().then(function (s) { if (!s && live.poll) setMode('off'); else if (s && live.poll) setMode('poll'); }); };
    live.poll = setInterval(go, 5000); go();
  }
  function stopPolling() { if (live.poll) { clearInterval(live.poll); live.poll = 0; } }
  function onGame(d) {
    if (!d || d.origin === W.clientId) return;                       // my own write: the response already played its events
    if (Array.isArray(d.events) && d.events.length) W.playEvents(d.events, { startDelay: 250 });
    later(500, function () { W.refresh(); });
  }
  function openStream() {
    if (live.es || !window.EventSource) { if (!window.EventSource) startPolling(); return; }
    var es;
    try { es = new EventSource('/api/stream'); } catch (e) { startPolling(); return; }
    live.es = es;
    es.addEventListener('open', function () { stopPolling(); setMode('live'); });
    es.addEventListener('pomodoro', function (e) { try { P.apply(JSON.parse(e.data)); } catch (er) { /* bad frame */ } stopPolling(); setMode('live'); });
    es.addEventListener('game', function (e) { try { onGame(JSON.parse(e.data)); } catch (er) { /* bad frame */ } });
    es.addEventListener('error', function () {
      // the browser retries by itself; while it does (or if it gave up, e.g. 401 after a revoke) poll so the screen never goes stale
      if (es.readyState === 2) { live.es = null; }
      startPolling();
    });
  }
  function closeStream() { if (live.es) { live.es.close(); live.es = null; } stopPolling(); setMode('off'); }
  function startLive() {
    openStream();
    DOC.addEventListener('visibilitychange', function () {
      if (DOC.hidden) { live.hiddenAt = Date.now(); live.closeT = later(120000, function () { if (DOC.hidden) closeStream(); }); }
      else { clearTimeout(live.closeT); if (!live.es) { P.fetch(); openStream(); } else P.fetch(); }
    });
    // a paired tablet that went to sleep or changed network: reconnect when it comes back
    addEventListener('online', function () { if (!live.es) openStream(); P.fetch(); });
  }

  /* ====================================================================== formatting */
  function clock(s) {
    s = Math.max(0, Math.floor(s));
    // MM:SS up to 99:59 so a 90 minute block keeps the big digits; H:MM:SS only from 100 minutes
    var pad = function (n) { return String(n).padStart(2, '0'); };
    if (s < 6000) return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h + ':' + pad(m) + ':' + pad(s % 60);
  }
  function speak(el, text) { if (el && el.textContent !== text) el.textContent = text; }

  /* ====================================================================== nav dot + Today run card (every page) */
  function updateGlobals(s) {
    var dot = J('focus-dot'); if (dot) dot.hidden = !(s.active || (s.pending_ratings && s.pending_ratings.length));
    var card = J('today-run');
    if (card) {
      var run = s.run, active = !!s.active, pend = s.pending_ratings && s.pending_ratings.length;
      card.hidden = !(active || pend);
      if (!card.hidden) {
        card.classList.toggle('is-break', active && run && run.phase === 'break');
        var title = J('run-title', card), sub = J('run-sub', card);
        if (active && run && run.phase === 'waiting') {
          speak(title, 'Block done');
          speak(sub, 'Your ' + (run.next && run.next.phase === 'break' ? 'break is waiting for you' : run.next ? 'next block is waiting for you' : 'run is ready to finish') + (pend ? ' \u00B7 ' + pend + ' to rate' : ''));
        } else if (active && run) {
          speak(title, run.phase === 'break' ? 'Break' : run.category + (run.label ? ': ' + run.label : ''));
          speak(sub, 'Cycle ' + run.cycle + ' of ' + run.cycles + (run.paused ? ' \u00B7 paused' : '') + (pend ? ' \u00B7 ' + pend + ' to rate' : ''));
        } else { speak(title, 'A block is ready to rate'); speak(sub, pend + (pend === 1 ? ' block waits' : ' blocks wait') + ' for a word on how it went.'); }
        tickCard();
      }
    }
  }
  function tickCard() {
    var card = J('today-run'); if (!card || card.hidden || !P.state) return;
    var c = J('run-clock', card), s = P.state;
    if (c) speak(c, s.active && s.run && s.run.phase !== 'waiting' ? clock(P.remaining(s.run)) : '');
  }

  /* ====================================================================== the Focus Screen */
  function focusScreen(root) {
    var els = {
      phasePill: J('phase-pill', root), phaseLabel: J('phase-label', root), cycleText: J('cycle-text', root), dial: J('dial', root), dialTime: J('dial-time', root),
      dialSub: J('dial-sub', root), taskCat: J('task-cat', root), taskLabel: J('task-label', root), nextText: J('next-text', root), live: J('focus-live', root),
      camText: J('cam-text', root), camDot: J('cam-dot', root), rate: J('rate', root), rateForm: J('rate-form', root), rateBlock: J('rate-block', root),
      rateTitle: J('rate-title', root), rateSub: J('rate-sub', root), rateNote: J('rate-note', root), rateBar: J('rate-bar', root), rateBarText: J('rate-bar-text', root),
      fs: J('fullscreen', root), stopbox: J('stopbox', root), startForm: J('start-form', root), summary: J('summary', root),
      keep: J('keep-line', root), stopNote: J('stop-note', root), legacy: J('legacy-note', root),
      between: J('between', root), betweenTitle: J('between-title', root), betweenSub: J('between-sub', root), nextLabel: J('next-label', root),
      phaseTotal: J('phase-total', root), extendTitle: J('extend-title', root), rateKeep: J('rate-keep', root), rateNext: J('rate-next', root), rateLaterBtn: J('rate-later', root),
    };
    var baseTitle = DOC.title, wantsNew = /[?&]new=1/.test(location.search), dismissed = loadDismissed(), lastKey = null, lastSec = -1, boundaryAt = 0, announced = '';
    var previewing = false, wakeLock = null, rateReturn = null, lastSt = null, lastWaitBlock = null;

    /* blocks whose sheet this tab closed ("rate it later") stay closed over a reload, so a running break is not covered again */
    function loadDismissed() { try { return JSON.parse(sessionStorage.getItem('epoch.rate.dismissed') || '{}') || {}; } catch (e) { return {}; } }
    function saveDismissed() { try { sessionStorage.setItem('epoch.rate.dismissed', JSON.stringify(dismissed)); } catch (e) { /* private window */ } }

    /* ---- the state of the screen ---- */
    function stateOf(s) {
      var run = s.run;
      if (run && s.active) return run.phase === 'break' ? 'break' : run.phase === 'waiting' ? 'between' : 'work';
      if (run && !wantsNew) return 'done';
      return 'idle';
    }
    function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
    function setPhaseIcon(name) { var u = els.phasePill && qs('use', els.phasePill); if (u) u.setAttribute('href', u.getAttribute('href').replace(/#.*$/, '#i-' + name)); }

    function render(s, meta) {
      meta = meta || {};
      var run = s.run, st = stateOf(s), paused = !!(run && s.active && run.paused);
      if (s.active) wantsNew = false;
      var key = run ? run.id + ':' + run.phase_index + ':' + run.status : 'none';
      root.dataset.state = st; root.dataset.paused = paused ? 'true' : 'false';
      root.dataset.phase = st === 'break' ? 'break' : 'work';
      root.dataset.pending = String((s.pending_ratings || []).length);

      var label = st === 'work' ? (paused ? 'Paused' : 'Deep work') : st === 'break' ? (paused ? 'Break, paused' : 'Break') : st === 'between' ? 'Block done' : st === 'done' ? (run.status === 'finished' ? 'Run complete' : 'Run stopped') : 'Ready';
      setText(els.phaseLabel, label); setPhaseIcon(st === 'break' ? 'coffee' : st === 'done' || st === 'between' ? 'check' : 'brain');
      setText(els.cycleText, run && s.active ? 'Cycle ' + run.cycle + ' of ' + run.cycles : run ? (run.status === 'finished' ? run.cycles + (run.cycles === 1 ? ' cycle' : ' cycles') : 'Stopped in cycle ' + run.cycle) : '');
      setText(els.taskCat, run ? run.category : ''); setText(els.taskLabel, run && run.label ? run.label : '');
      setText(els.nextText, run && s.active && st !== 'between' ? (run.next ? 'Next: ' + (run.next.phase === 'break' ? 'a break' : 'a work block') + ', ' + Math.round(run.next.seconds / 60) + ' min.' : 'Last block of the run.') : '');
      renderExtra(s, st, run);
      setText(els.dialSub, st === 'work' ? (paused ? (run.away ? 'paused while you were away' : 'paused') : 'left in this block') : st === 'break' ? (paused ? (run.away ? 'paused while you were away' : 'paused') : 'of rest') : '');
      if (els.summary && run) {
        var kept = num(run.blocks_kept) > 0;
        setText(qs('.summary__t', els.summary), run.status === 'finished' ? 'All ' + run.cycles + (run.cycles === 1 ? ' block' : ' blocks') + ' done.' : kept ? 'The time you did is kept.' : 'Nothing was logged from this run.');
        setText(J('summary-sub', els.summary), kept ? "Every block you rated is in today's log." : 'Start another whenever you are ready.');
      }
      setText(els.keep, s.keep_awake && s.active && !paused ? 'This Mac stays awake while the timer runs.' : '');
      setText(els.stopNote, st === 'break' || st === 'between' ? 'Stopping now ends the run. The blocks you finished stay.' : 'Stopping mid-block keeps the time you did, so you can rate it.');
      if (els.legacy) els.legacy.hidden = !s.legacy_focus;
      var cat = run ? run.category : null;
      if (els.camText) setText(els.camText, st === 'work' || st === 'break' ? (st === 'break' ? 'Break: the crew rests' : cat + (paused ? ' (paused)' : '')) : st === 'between' ? 'Block done' : "Today's tower");
      if (els.camDot) els.camDot.dataset.on = st === 'work' && !paused ? '1' : '0';
      if (els.camDot && cat) els.camDot.style.setProperty('--cc', 'var(' + W.catOf(cat).v + ')');

      // a different run or phase: announce it, chime, tell the 3D cam
      if (key !== lastKey) {
        var started = run && run.phase_ends_at && run.phase_seconds ? Date.parse(run.phase_ends_at) - run.phase_seconds * 1000 : 0;
        var fresh = started ? (P.now() - started) < 25000 : false;
        var sinceEnd = run && run.waiting && run.waiting.since ? P.now() - Date.parse(run.waiting.since) : Infinity;
        if (lastKey !== null && !meta.first) {
          // the block-end chime is the old "break" chime; a break the person started by tapping makes no sound of its own
          if (st === 'work' && fresh && lastSt !== 'between') chime('work'); else if (st === 'between' && sinceEnd < 25000) chime('break'); else if (st === 'done' && run && run.status === 'finished') chime('done');
          var msg = st === 'work' ? 'Work block ' + (run ? run.cycle : '') + ' started.' : st === 'break' ? 'Break time.' : st === 'between' ? 'Block done. Your ' + (run && run.next && run.next.phase === 'break' ? 'break starts when you tap Start break.' : 'next step is waiting for you.') : st === 'done' ? (run && run.status === 'finished' ? 'Run complete.' : 'Run stopped.') : '';
          if (msg && msg !== announced) { announced = msg; setText(els.live, msg); }
        }
        lastKey = key; lastSec = -1;
      }
      lastSt = st;
      renderTime(s);
      renderRate(s);
      construction(s, st, paused);
      sound(s, st, paused);
      wake(s.active && !paused && st !== 'between');
      if (s.active && /[?&]new=1/.test(location.search)) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
    }

    /* ---- the between screen, the "+5 min" row, and the labels that depend on what comes next ---- */
    function renderExtra(s, st, run) {
      var w = run && run.waiting, nx = run && run.next, mins = function (sec) { return Math.round(num(sec) / 60); };
      if (els.between && run && st === 'between') {
        setText(els.betweenTitle, 'Block done: ' + (w ? w.minutes : mins(run.phase_seconds)) + ' min');
        setText(els.betweenSub, run.last ? 'That was the last block. Rate it, or keep going if you are not done.'
          : nx && nx.phase === 'break' ? 'Your ' + mins(nx.seconds) + ' min break has not started. It starts when you tap Start break.' : 'The next block starts when you tap Start.');
      }
      if (els.nextLabel && run) {
        var lab = nx ? (nx.phase === 'break' ? 'Start ' + mins(nx.seconds) + ' min break' : 'Start next block') : 'Finish the run';
        setText(els.nextLabel, lab);
        var u = qs('.c-next use', root); if (u) u.setAttribute('href', u.getAttribute('href').replace(/#.*$/, '#i-' + (nx && nx.phase === 'break' ? 'coffee' : 'play')));
      }
      if (els.extendTitle) setText(els.extendTitle, st === 'break' ? 'Need a longer break?' : st === 'between' ? 'Not done yet? Keep going:' : 'Need more time on this block?');
      if (els.phaseTotal) {
        var t = '';
        if (run && s.active && (st === 'work' || st === 'break')) {
          var tot = mins(run.phase_seconds), extra = mins(run.extra_seconds);
          t = (st === 'break' ? 'Break' : 'Block') + ': ' + tot + ' min' + (extra ? ' in all (' + mins(run.base_seconds) + ' + ' + extra + ' more)' : '');
        }
        setText(els.phaseTotal, t);
      }
      // the end-of-block sheet: "Keep going" and "rate later" only belong to the block the run is holding for
      var open = P.state ? pendingList(P.state)[0] : null;
      var holds = !!(w && w.unrated && open && open.block_id === w.block_id);
      if (els.rateKeep) els.rateKeep.hidden = !holds;
      if (els.rateNext) {
        els.rateNext.hidden = !holds;
        setText(els.rateNext, nx ? (nx.phase === 'break' ? 'Start my break, rate later' : 'Start the next block, rate later') : 'Finish the run, rate later');
      }
      if (els.rateLaterBtn) els.rateLaterBtn.hidden = holds;
    }

    /* ---- the dial: re-rendered every 250 ms but only touches the DOM when the second changes ---- */
    function renderTime(s) {
      var run = s.run; if (!run || !s.active) return;
      if (run.phase === 'waiting') { if (DOC.title.indexOf('Block done') !== 0) DOC.title = 'Block done \u00B7 Epoch'; return; }
      var rem = P.remaining(run), sec = rem;
      if (sec === lastSec) return; lastSec = sec;
      var total = Math.max(1, num(run.phase_seconds)), p = Math.min(100, Math.max(0, (total - rem) / total * 100));
      setText(els.dialTime, clock(rem));
      els.dialTime.classList.toggle('is-long', rem >= 6000);
      els.dial.style.setProperty('--p', p.toFixed(2)); els.dial.style.setProperty('--deg', (p * 3.6).toFixed(2) + 'deg');
      var st = run.phase === 'break' ? 'Break' : 'Deep work';
      DOC.title = clock(rem) + ' · ' + st + (run.paused ? ' (paused)' : '') + ' · Epoch';
      if (rem === 0 && !run.paused && Date.now() - boundaryAt > 1500) { boundaryAt = Date.now(); P.fetch(); }     // the phase just ended: ask for the next one now
      if (rem === 60 && !run.paused) setText(els.live, (run.phase === 'break' ? 'Break' : 'Work block') + ' ends in one minute.');
    }
    function tickAll() {
      if (!P.state) return;
      renderTime(P.state); tickCard();
      if (!P.state.active) { if (DOC.title !== baseTitle && !/Focus/.test(DOC.title)) DOC.title = baseTitle; }
    }

    /* ---- chimes, soundscape ---- */
    function chime(kind) { if (window.WitnessAudio) WitnessAudio.chime(kind); }
    function sound(s, st, paused) {
      var A = window.WitnessAudio; if (!A) return;
      var name = A.selected(), want = false;
      if (name !== 'off') {
        if (st === 'work' && !paused) want = true;
        else if (st === 'break' && !paused && !A.pauseOnBreak()) want = true;
        else if ((st === 'idle' || st === 'done') && previewing) want = true;
      }
      if (st === 'work' || st === 'break') previewing = false;
      if (want) A.play(name); else if (A.playing() || A.blocked()) A.stop();
    }
    if (window.WitnessAudio) {
      WitnessAudio.managed = true;
      WitnessAudio.on(function (ev, d) {
        if (ev !== 'select') return;
        if (d && d.user && d.name !== 'off' && P.state && !P.state.active) previewing = true;
        if (d && d.name === 'off') previewing = false;
        if (P.state) sound(P.state, stateOf(P.state), !!(P.state.run && P.state.active && P.state.run.paused));
      });
    }

    /* ---- the rating sheet ---- */
    function pendingList(s) {
      // the block the run is holding for comes first; then the oldest
      var hold = s.run && s.run.waiting ? s.run.waiting.block_id : null;
      return (s.pending_ratings || []).filter(function (b) { return !dismissed[b.block_id]; }).sort(function (a, b) { return (b.block_id === hold) - (a.block_id === hold) || a.block_id - b.block_id; });
    }
    var openBlock = null;
    function renderRate(s) {
      // the run moved on without this screen (the break was started from the tablet): the sheet for that block closes here too
      var holdNow = s.run && s.run.waiting ? s.run.waiting.block_id : null;
      if (lastWaitBlock != null && holdNow !== lastWaitBlock) { dismissed[lastWaitBlock] = true; saveDismissed(); }
      lastWaitBlock = holdNow;
      var all = s.pending_ratings || [], open = pendingList(s)[0];
      var bar = els.rateBar;
      if (bar) { bar.hidden = !(all.length && !open); setText(els.rateBarText, all.length + (all.length === 1 ? ' block to rate' : ' blocks to rate')); }
      if (!open) { hideRate(); return; }
      if (openBlock !== open.block_id) {
        openBlock = open.block_id;
        els.rateBlock.value = open.block_id;
        setText(els.rateTitle, (open.partial ? 'Stopped early: ' : 'Block done: ') + open.minutes + ' min of ' + open.category);
        setText(els.rateSub, open.label ? open.label : 'Pick one. It becomes one entry in today\'s log.');
        var r = qs('input[name="category"][value="' + open.category.replace(/"/g, '') + '"]', els.rateForm); if (r) r.checked = true;
        els.rateNote.value = '';
      }
      showRate();
    }
    function showRate() {
      if (!els.rate.hidden) return;
      rateReturn = DOC.activeElement;
      els.rate.hidden = false; root.classList.add('is-rating');
      qsa('.focus__grid, .focus__bar, .sounds', root).forEach(function (n) { n.inert = true; });
      var f = qs('.btn--mint', els.rateForm) || qs('button', els.rateForm); if (f) f.focus({ preventScroll: true });
      if (!W.reduced()) { els.rate.classList.remove('is-in'); void els.rate.offsetWidth; els.rate.classList.add('is-in'); }
    }
    function hideRate() {
      openBlock = null; if (els.rate.hidden) return;
      els.rate.hidden = true; root.classList.remove('is-rating');
      qsa('.focus__grid, .focus__bar, .sounds', root).forEach(function (n) { n.inert = false; });
      Object.keys(W.scenes).forEach(function (k) { if (W.scenes[k]) W.scenes[k].invalidate(); });     // repaint the cam after the sheet closes
      if (rateReturn && DOC.contains(rateReturn)) { try { rateReturn.focus({ preventScroll: true }); } catch (e) { /* gone */ } } rateReturn = null;
    }
    function later_() {
      if (openBlock != null) { dismissed[openBlock] = true; saveDismissed(); }
      if (P.state) renderRate(P.state);
    }
    els.rateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var sub = e.submitter || DOC.activeElement, value = sub && sub.name === 'focus' ? sub.value : '';
      if (sub && sub.dataset && sub.dataset.act === 'discard') {         // "This didn't happen": drop the block, log nothing
        qsa('.btn--rate, .rate__skip', els.rateForm).forEach(function (b) { b.disabled = true; });
        var bid = Number(els.rateBlock.value) || undefined;
        api.post('/api/pomodoro/discard', { block_id: bid }).then(function (res) {
          qsa('.btn--rate, .rate__skip', els.rateForm).forEach(function (b) { b.disabled = false; });
          if (!res || res.ok === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not go through.' }); P.fetch(); return; }
          dismissed[bid] = true; saveDismissed(); if (res.pomodoro) P.apply(res.pomodoro); else P.fetch();
          W.toast({ icon: 'info', tone: 'violet', title: 'Dropped. Nothing was logged.' });
        }).catch(function () { qsa('.btn--rate, .rate__skip', els.rateForm).forEach(function (b) { b.disabled = false; }); els.rateForm.action = '/pomodoro/discard'; HTMLFormElement.prototype.submit.call(els.rateForm); });
        return;
      }
      if (sub && sub.dataset && sub.dataset.act === 'next') {              // "Start my break, rate later": the block stays to be rated from the bar
        var nb = Number(els.rateBlock.value) || undefined;
        act('next', {}, sub).then(function (res) { if (res && res.ok !== false) { dismissed[nb] = true; saveDismissed(); } if (P.state) renderRate(P.state); }).catch(function () { els.rateForm.action = '/pomodoro/next'; HTMLFormElement.prototype.submit.call(els.rateForm); });
        return;
      }
      if (!value) return;
      var cat = (qs('input[name="category"]:checked', els.rateForm) || {}).value, body = { focus: value, block_id: Number(els.rateBlock.value) || undefined, category: cat, note: els.rateNote.value.trim() };
      qsa('.btn--rate', els.rateForm).forEach(function (b) { b.disabled = true; });
      var wasPartial = !!(P.state && (pendingList(P.state)[0] || {}).partial);
      api.post('/api/pomodoro/rate', body).then(function (res) {
        qsa('.btn--rate', els.rateForm).forEach(function (b) { b.disabled = false; });
        if (!res || res.ok === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not log. Try again.' }); return; }
        if (res.pomodoro) { dismissed[body.block_id] = true; saveDismissed(); P.apply(res.pomodoro); } else P.fetch();
        // a finished block is rated while the crew rests: top the new floors out now (the 3D module also does it on its own when the tower grows)
        if (!wasPartial && P.state && P.state.active && P.state.run && P.state.run.phase === 'break' && W.setConstruction) W.setConstruction({ active: true, phase: 'topout', progress: 1, category: P.state.run.category });
        W.applyWriteResult(res, { entry: res.entry, floatEl: els.dial });
      }).catch(function (err) {
        qsa('.btn--rate', els.rateForm).forEach(function (b) { b.disabled = false; });
        if (err && err.kind === 'offline') W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer.", sub: 'Your block is kept. Try again in a moment.' });
        else HTMLFormElement.prototype.submit.call(els.rateForm);
      });
    });
    var laterBtn = J('rate-later', root); if (laterBtn) laterBtn.addEventListener('click', later_);
    if (els.rateBar) els.rateBar.addEventListener('click', function () { dismissed = {}; saveDismissed(); if (P.state) renderRate(P.state); });
    var scrim = J('rate-scrim', root); if (scrim) scrim.addEventListener('click', later_);
    els.rate.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); later_(); return; }
      if (e.key === 'Tab') {                                     // keep Tab inside the sheet
        var f = qsa('button:not([disabled]), input:not([disabled]), a[href]', els.rateForm).filter(function (n) { return n.offsetParent !== null; });
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && DOC.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && DOC.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    /* ---- controls: every form becomes an API call ---- */
    function act(action, body, btn) {
      if (btn) btn.classList.add('is-busy');
      return P.post(action, body).then(function (res) {
        if (btn) btn.classList.remove('is-busy');
        if (!res || res.ok === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not go through.' }); P.fetch(); return res; }
        if (res.pomodoro) P.apply(res.pomodoro); else P.fetch();
        if (action === 'start') W.sfx('ping');                 // render() plays the work chime when the new phase appears
        return res;
      });
    }
    root.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.matches && f.matches('[data-js="act"]')) {
        e.preventDefault();
        var a = f.dataset.act, sub = e.submitter || f.querySelector('button');
        if (els.stopbox) els.stopbox.open = false;
        var body = {};
        if (a === 'extend') body.minutes = Number(sub && sub.value) || 5;
        (a === 'stop-discard' ? act('stop', { discard: true }, sub) : a === 'stop' ? act('stop', { discard: false }, sub) : act(a, body, sub)).then(function (res) {
          if (res && res.ok !== false && a === 'extend') W.toast({ icon: 'timer', tone: 'violet', title: '+' + body.minutes + ' min added.' });
        }).catch(function (err) {
          if (sub) sub.classList.remove('is-busy');
          if (err && err.kind === 'offline') W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); else HTMLFormElement.prototype.submit.call(f);
        });
      } else if (f === els.startForm) {
        e.preventDefault();
        var d = {}; qsa('input', f).forEach(function (i) { if (i.type === 'radio' ? i.checked : true) d[i.name] = i.value; });
        var btn = qs('button[type=submit]', f);
        if (window.WitnessAudio) WitnessAudio.ensure();                 // this tap unlocks audio for the chimes
        var startBody = { preset: d.preset, category: d.category, label: (d.label || '').trim() };
        if (d.preset === 'custom') { startBody.work_min = Number(d.work_min); startBody.break_min = Number(d.break_min); startBody.cycles = Number(d.cycles); }
        if (Spots.selected) startBody.spot = Spots.selected;           // the spot picked on this screen (omitted = the last one used)
        act('start', startBody, btn).catch(function (err) {
          if (btn) btn.classList.remove('is-busy');
          if (err && err.kind === 'offline') W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); else f.submit();
        });
      }
    });
    var again = J('again', root);
    if (again) again.addEventListener('click', function (e) { e.preventDefault(); wantsNew = true; root.classList.add('is-setup'); try { history.replaceState(null, '', '?new=1'); } catch (er) { /* ignore */ } if (P.state) render(P.state); var f = qs('input[name="label"]', els.startForm); if (f && matchMedia('(pointer:fine)').matches) f.focus(); });
    if (wantsNew) root.classList.add('is-setup');
    var spots = spotScreen(root, stateOf);
    DOC.addEventListener('keydown', function (e) {                       // space or P: pause / resume, when nothing else has the focus
      if (e.metaKey || e.ctrlKey || e.altKey || !P.state || !P.state.active || !els.rate.hidden) return;
      var t = DOC.activeElement && DOC.activeElement.tagName;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(t || '')) return;
      if (e.key === ' ' || e.key.toLowerCase() === 'p') { e.preventDefault(); act(P.state.run.paused ? 'resume' : 'pause'); }
    });

    /* ---- construction cam: show today's tower, tell the 3D module what the crew is doing ---- */
    var camSent = '';
    function construction(s, st, paused) {
      // the 3D module draws a crew, a crane and the new floors rising with the block (DOM_CONTRACT.md, city.js API)
      var run = s.run, c;
      if (st === 'work' && run) {
        var total = Math.max(1, num(run.phase_seconds)), rem = P.remaining(run);
        c = { active: true, paused: paused, phase: 'work', category: run.category, progress: Math.min(1, Math.max(0, (total - rem) / total)), minutes: Math.round(total / 60) };
        if (!paused) { c.remaining = rem; c.duration = total; }
      } else if (st === 'break') c = { active: true, paused: paused, phase: 'break', category: run ? run.category : null, progress: 1 };
      else if (st === 'between' && run) c = { active: true, paused: true, phase: 'work', category: run.category, progress: 1, minutes: Math.round(num(run.phase_seconds) / 60) };
      else c = { active: false, phase: 'idle' };
      var key = JSON.stringify([c.active, c.paused, c.phase, c.minutes, Math.round(num(c.remaining) / 5), run && run.id]);
      if (key === camSent && !paused) return;                   // the module extrapolates between calls; only send when something changed
      camSent = key; W.setConstruction(c);
    }
    var camPoll = setInterval(function () {            // the 3D scene is built a moment after load: hand it the current state once it exists
      if (W.scenes.week) { clearInterval(camPoll); camSent = ''; if (P.state) construction(P.state, stateOf(P.state), !!(P.state.run && P.state.active && P.state.run.paused)); }
    }, 500);
    later(40000, function () { clearInterval(camPoll); });

    /* ---- fullscreen + keep the screen on ---- */
    if (els.fs && (DOC.fullscreenEnabled || DOC.webkitFullscreenEnabled)) {
      els.fs.hidden = false;
      var fsNow = function () { return DOC.fullscreenElement || DOC.webkitFullscreenElement; };
      els.fs.addEventListener('click', function () {
        try {
          if (fsNow()) (DOC.exitFullscreen || DOC.webkitExitFullscreen).call(DOC);
          else { var r = ROOT.requestFullscreen || ROOT.webkitRequestFullscreen; var p = r.call(ROOT, { navigationUI: 'hide' }); if (p && p.catch) p.catch(function () {}); }
        } catch (e) { /* not allowed here */ }
      });
      var onFs = function () {
        var on = !!fsNow(); els.fs.setAttribute('aria-pressed', String(on)); els.fs.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
        var u = qs('use', els.fs); if (u) u.setAttribute('href', u.getAttribute('href').replace(/#.*$/, '#i-' + (on ? 'minimize' : 'maximize')));
        root.classList.toggle('is-fullscreen', on);
      };
      DOC.addEventListener('fullscreenchange', onFs); DOC.addEventListener('webkitfullscreenchange', onFs);
    }
    function wake(on) {
      if (!('wakeLock' in navigator)) return;
      if (on && !wakeLock) { navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }, function () { /* not allowed on plain http */ }); }
      else if (!on && wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    }
    DOC.addEventListener('visibilitychange', function () { if (!DOC.hidden && P.state) wake(P.state.active && !(P.state.run && P.state.run.paused)); });

    /* ---- the Custom rhythm: steppers (big, for touch), a live total, numbers kept inside the limits ---- */
    (function customRhythm() {
      var panel = J('custom-panel', root); if (!panel || !els.startForm) return;
      var inputs = {}; ['work_min', 'break_min', 'cycles'].forEach(function (n) { inputs[n] = qs('input[name="' + n + '"]', panel); });
      var sum = J('custom-total', panel), cardSub = J('custom-card-sub', root);
      function bounds(inp) { return [num(inp.min, 0), num(inp.max, 999)]; }
      function read(inp) { var b = bounds(inp), v = parseInt(inp.value, 10); if (!isFinite(v)) v = num(inp.defaultValue, b[0]); return Math.min(b[1], Math.max(b[0], v)); }
      function hm(m) { return m >= 60 ? Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm' : m + ' min'; }
      function summary() {
        var w = read(inputs.work_min), b = read(inputs.break_min), c = read(inputs.cycles);
        var all = w * c + b * (c - 1);
        setText(sum, (c === 1 ? 'One block of ' + w + ' min, no break.' : c + ' blocks of ' + w + ' min' + (b ? ', ' + b + ' min break' + (c > 2 ? 's' : '') + ' between.' : ', no breaks.')) + ' ' + hm(all) + ' in all.');
        setText(cardSub, w + ' / ' + b + ' x ' + c);
      }
      function clampAll() { Object.keys(inputs).forEach(function (n) { inputs[n].value = String(read(inputs[n])); }); summary(); }
      panel.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.stepper__b'); if (!btn) return;
        var inp = qs('input', btn.closest('.stepper')), step = Number(btn.dataset.step), v = read(inp), b = bounds(inp), n;
        if (Math.abs(step) > 1) n = step > 0 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step + step;     // 52 +5 -> 55, 52 -5 -> 50
        else n = v + step;
        inp.value = String(Math.min(b[1], Math.max(b[0], n))); summary();
      });
      panel.addEventListener('input', summary);
      panel.addEventListener('change', clampAll);
      var radios = qsa('input[name="preset"]', els.startForm);
      function sync() { var on = radios.some(function (r) { return r.checked && r.value === 'custom'; }); panel.hidden = !on; }
      radios.forEach(function (r) { r.addEventListener('change', sync); });
      sync(); summary();
    })();

    /* ---- go ---- */
    P.onState(function (s, meta) { render(s, meta); if (spots) spots.sync(s, meta); });
    setInterval(tickAll, 250);
  }

  /* ====================================================================== study spots (docs/COZY.md 4.5) */
  // Spots: the list from GET /api/spots and the one picked on this page (sent with the next start). The scene itself is
  // city/spots/index.js; the 2D picture (no WebGL, or while it loads) is city/spots/art.js.
  var Spots = {
    data: null, selected: null, loading: null,
    load: function (force) {
      if (Spots.loading && !force) return Spots.loading;
      Spots.loading = api.get('/api/spots').then(function (d) { if (d && d.ok !== false) { Spots.data = d; if (!Spots.selected) Spots.selected = null; } return d; }).catch(function () { return null; });
      return Spots.loading;
    },
  };
  W.spots = Spots;
  function ensureImportMap() {
    if (qs('script[type="importmap"]')) return;
    var s = DOC.createElement('script'); s.type = 'importmap';
    s.textContent = JSON.stringify({ imports: { 'three': new URL('three/three.module.js', SPOT_VENDOR).href, 'three/addons/': new URL('three/addons/', SPOT_VENDOR).href } });
    DOC.head.appendChild(s);
  }
  var artMod = null;
  function spotArt(el, id, opts) {
    if (!el) return;
    var go = function (m) { try { el.innerHTML = m.spotArt(id, opts || {}); } catch (e) { /* the frame keeps its colour */ } };
    if (artMod) { go(artMod); return; }
    import(new URL('city/spots/art.js', SPOT_BASE).href).then(function (m) { artMod = m; go(m); }).catch(function () { /* no ES modules: the frame keeps its colour */ });
  }
  function money(n) { return '$' + Math.round(num(n)).toLocaleString('en-US'); }

  function spotScreen(root, stateOf) {
    var host = J('spot-stage', root), cam = J('spotcam', root); if (!host || !cam) return null;
    var chip = J('spot-chip', root), chipText = J('spot-chip-text', root), pipBtn = J('pip-swap', root), dlg = J('spot-dlg', DOC), list = J('spot-list', DOC), note = J('spot-dlg-note', DOC);
    var art = J('spot-art', root), idleText = J('spot-idle-text', root), setupName = J('setup-spot-name', root);
    var stage = null, shown = host.dataset.spot || 'butler', names = {}, swapped = false, pulse = 0, lastWeather = null, lastMotion = null, lastOutfit = null;
    names[shown] = { short: chipText ? chipText.textContent.trim() : 'Butler Library' };
    var hourNow = function () { try { return W.hourFn(); } catch (e) { var d = new Date(); return d.getHours() + d.getMinutes() / 60; } };
    var homeNow = function () { var e = W.state && W.state.world && W.state.world.economy; return (e && e.home) || null; };
    var outfitNow = function () { var e = W.state && W.state.world && W.state.world.economy; return (e && (e.outfit || (e.equipped && e.equipped.outfit))) || 'everyday'; };
    spotArt(art, shown, { hour: hourNow() });

    /* ---- the 3D scene: after first paint, like the other scenes; never in the way of the timer ---- */
    function boot() {
      if (W.prefs && W.prefs.three === 'off') { host.classList.add('use-art'); return; }
      ensureImportMap();
      import(new URL('city/spots/index.js', SPOT_BASE).href).then(function (m) {
        stage = m.createSpotStage(host, { spot: shown, outfit: outfitNow(), hour: hourNow, motion: !W.reduced(), weather: W.state && W.state.weather, realView: realView, home: homeNow });
        if (!stage) { host.classList.add('no-webgl'); return; }
        W.spotStage = stage;
        if (swapped) stage.setInset(true);
        if (P.state) sync(P.state, { initial: true });
      }).catch(function (e) { console.warn('Study spot unavailable, keeping the picture', e); host.classList.add('no-webgl'); });
    }
    if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 1200 }); else later(60, boot);
    // the window view of a spot is the real city, rendered once by the construction cam's scene from the spot's own windows
    function realView(req) {
      return new Promise(function (res) {
        var tries = 0;
        (function wait() {
          var sc = W.scenes && W.scenes.week;
          if (sc && typeof sc.viewFrom === 'function') { Promise.resolve(sc.viewFrom(req)).then(res, function () { res(null); }); return; }
          if (++tries > 60) { res(null); return; }
          later(500, wait);
        })();
      });
    }
    // live settings: motion, weather, the outfit, the hour preference (cheap checks; nothing renders unless they changed)
    setInterval(function () {
      if (!stage) return;
      var mo = !W.reduced(); if (mo !== lastMotion) { lastMotion = mo; stage.setMotion(mo); }
      var w = W.state && W.state.weather; if (w && w !== lastWeather) { lastWeather = w; stage.setWeather(w); }
      var o = outfitNow(); if (o !== lastOutfit) { lastOutfit = o; stage.setOutfit(o); }
    }, 2500);

    /* ---- the construction cam as a picture-in-picture: throttled to about 15 fps while it is small; tap to swap ---- */
    try { swapped = localStorage.getItem('epoch.spot.swap') === '1'; } catch (e) { /* private window */ }
    // small, the cam draws about 15 frames a second while a block or a break runs (motion on), one a second otherwise, and one every
    // 30 seconds under reduced motion; big (swapped), it runs as usual
    var pulseMs = 0;
    function camRate() {
      var st = P.state ? stateOf(P.state) : 'idle', live = (st === 'work' || st === 'break') && !(P.state.run && P.state.run.paused);
      return W.reduced() ? (st === 'idle' || st === 'done' ? 0 : 30000) : live ? 66 : 1000;
    }
    function throttleCam() {
      clearInterval(pulse); pulse = 0; pulseMs = 0;
      var sc = W.scenes && W.scenes.week; if (!sc || typeof sc.pause !== 'function') return;
      if (swapped) { sc.pause(DOC.hidden); return; }
      sc.pause(true); sc.pause(false); sc.pause(true);           // one fresh frame now
      pulseMs = camRate();
      if (pulseMs) pulse = setInterval(function () { if (DOC.hidden) return; sc.pause(false); sc.pause(true); }, pulseMs);
    }
    function applySwap() {
      cam.classList.toggle('is-swapped', swapped);
      if (pipBtn) { pipBtn.setAttribute('aria-pressed', swapped ? 'true' : 'false'); pipBtn.setAttribute('aria-label', swapped ? 'Show the study spot big' : "Show today's tower big"); }
      if (stage) stage.setInset(swapped);
      throttleCam();
      var sc = W.scenes && W.scenes.week; if (sc && sc.invalidate) later(60, function () { sc.invalidate(); });
    }
    if (pipBtn) pipBtn.addEventListener('click', function () { swapped = !swapped; try { localStorage.setItem('epoch.spot.swap', swapped ? '1' : '0'); } catch (e) { /* fine */ } applySwap(); });
    applySwap();
    var camWait = setInterval(function () { if (W.scenes && W.scenes.week) { clearInterval(camWait); throttleCam(); } }, 500);
    later(45000, function () { clearInterval(camWait); });
    DOC.addEventListener('visibilitychange', function () { if (!DOC.hidden) throttleCam(); });

    /* ---- the idle state: the empty seat, and "Start a focus run" over the scene ---- */
    var startBtn = J('spot-start', root), closeBtn = J('setup-close', root), change = J('setup-spot-change', root);
    if (startBtn) startBtn.addEventListener('click', function () {
      root.classList.add('is-setup');
      var f = qs('.preset input:checked', root) || qs('.setup button[type=submit]', root); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* fine */ }
    });
    if (closeBtn) closeBtn.addEventListener('click', function () { root.classList.remove('is-setup'); if (startBtn) startBtn.focus({ preventScroll: true }); });
    if (change) change.addEventListener('click', openPicker);

    /* ---- the spot chip and the picker ---- */
    if (chip) chip.addEventListener('click', openPicker);
    function openPicker() {
      if (!dlg) return;
      if (!dlg.open) dlg.showModal();
      renderList(Spots.data);
      Spots.load(true).then(renderList);
    }
    function activeRun() { return !!(P.state && P.state.active); }
    function renderList(d) {
      if (!list) return;
      if (!d || !d.spots) { if (!Spots.data) list.innerHTML = '<li class="small muted">Loading the spots...</li>'; return; }
      var quiet = !!d.quiet, run = activeRun(), here = (P.state && P.state.spot && P.state.spot.short) || '';
      if (note) note.textContent = run ? 'You are in a block at ' + here + '. The spot you pick is for your next run.' : 'Your next run starts at the spot you pick.';
      list.innerHTML = d.spots.map(function (s) {
        var cls = 'spotrow is-' + s.state + (s.selected ? ' is-selected' : ''), act;
        if (s.state === 'open') act = s.selected ? '<span class="pill pill--mint">' + W.ico('check') + 'Your spot</span>' : '<button class="btn btn--sm" type="button" data-spot-pick="' + W.esc(s.id) + '">Study here</button>';
        else if (s.state === 'available') act = quiet ? '<span class="small muted">Opens with savings</span>' : (s.can_buy || s.affordable ? '<button class="btn btn--sm btn--ghost" type="button" data-spot-buy="' + W.esc(s.id) + '">Unlock for ' + money(s.price) + '</button>' : '<span class="small muted">' + W.esc(s.why_not || ('Unlocks for ' + money(s.price))) + '</span>');
        else act = '<span class="spotrow__gate">' + W.ico('lock') + '<span>' + W.esc(s.gate || s.why_not || 'Not open yet') + '</span></span>';
        return '<li class="' + cls + '" data-spot-row="' + W.esc(s.id) + '"><span class="spotrow__art" aria-hidden="true" data-spot-art="' + W.esc(s.id) + '"></span>' +
          '<span class="spotrow__t"><b>' + W.esc(s.name) + '</b><small>' + W.esc(s.blurb || '') + '</small>' + (s.state === 'available' && !quiet && s.price ? '<small class="spotrow__price">' + money(s.price) + ' to unlock' + (s.outdoor ? ' · open air' : '') + '</small>' : s.outdoor ? '<small class="spotrow__price">Open air</small>' : '') + '</span>' +
          '<span class="spotrow__act" data-spot-act>' + act + '</span></li>';
      }).join('');
      qsa('[data-spot-art]', list).forEach(function (el) { spotArt(el, el.getAttribute('data-spot-art'), { hour: hourNow(), mini: true }); });
      d.spots.forEach(function (s) { names[s.id] = { short: s.short, name: s.name }; });
    }
    if (list) list.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-spot-pick]'), buy = e.target.closest('[data-spot-buy]'), yes = e.target.closest('[data-spot-confirm]'), no = e.target.closest('[data-spot-cancel]');
      if (pick) choose(pick.getAttribute('data-spot-pick'), pick);
      else if (buy) quote(buy.getAttribute('data-spot-buy'), buy);
      else if (yes) confirmBuy(yes);
      else if (no) renderList(Spots.data);
    });
    function choose(id, btn) {
      if (btn) btn.classList.add('is-busy');
      api.post('/api/spots/select', { spot: id }).then(function (res) {
        if (btn) btn.classList.remove('is-busy');
        if (!res || res.ok === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That spot is not open yet.' }); return; }
        Spots.selected = res.selected || id;
        if (res.spot) names[res.spot.id] = { short: res.spot.short, name: res.spot.name };
        if (!activeRun()) show(Spots.selected);
        setLabels(Spots.selected);
        W.toast({ icon: 'map-pin', tone: 'violet', title: res.message || ('Your next run is at ' + ((res.spot && res.spot.short) || 'the new spot') + '.') });
        if (dlg && dlg.open) dlg.close();
        Spots.load(true); P.fetch();
      }).catch(function () { if (btn) btn.classList.remove('is-busy'); W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); });
    }
    // unlocking is the store's safe two-step buy: a quote first, then the price and token the person saw
    function quote(id, btn) {
      btn.classList.add('is-busy');
      api.post('/api/shop/buy', { item: id }).then(function (res) {
        btn.classList.remove('is-busy');
        var q = res && res.quote, row = btn.closest('[data-spot-row]'), slot = row && qs('[data-spot-act]', row);
        if (!res || !q || res.ok === false && !q) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not go through.' }); return; }
        if (res.ok === false || q.affordable === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'Not quite enough savings yet.' }); return; }
        if (slot) slot.innerHTML = '<span class="spotrow__confirm"><span class="small">Unlock for ' + money(q.price) + '? You will have ' + money(q.balance_after) + ' left.</span>' +
          '<span class="spotrow__btns"><button class="btn btn--sm" type="button" data-spot-confirm="' + W.esc(id) + '" data-price="' + W.esc(q.price) + '" data-token="' + W.esc(q.token) + '">Unlock</button><button class="btn btn--sm btn--ghost" type="button" data-spot-cancel>Not now</button></span></span>';
        var y = slot && qs('[data-spot-confirm]', slot); if (y) y.focus();
      }).catch(function () { btn.classList.remove('is-busy'); W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); });
    }
    function confirmBuy(btn) {
      var id = btn.getAttribute('data-spot-confirm');
      btn.classList.add('is-busy');
      api.post('/api/shop/buy', { item: id, price: Number(btn.getAttribute('data-price')), token: btn.getAttribute('data-token') }).then(function (res) {
        btn.classList.remove('is-busy');
        if (!res || res.ok === false) { W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not go through.' }); Spots.load(true).then(renderList); return; }
        W.toast({ icon: 'map-pin', tone: 'mint', title: res.toast || ((res.name || 'The spot') + ' is yours.') });
        if (typeof W.refresh === 'function') W.refresh();
        Spots.selected = id; if (!activeRun()) show(id); setLabels(id);
        Spots.load(true).then(renderList); P.fetch();
      }).catch(function () { btn.classList.remove('is-busy'); W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); });
    }

    /* ---- following the run ---- */
    function setLabels(id) {
      var n = names[id] || {}, short = n.short || (P.state && P.state.spot && P.state.spot.id === id ? P.state.spot.short : '') || '';
      if (!short) return;
      if (chipText && chipText.textContent !== short) chipText.textContent = short;
      if (setupName && setupName.textContent !== short) setupName.textContent = short;
      if (idleText) idleText.textContent = 'Your seat at ' + short + ' is waiting.';
    }
    function show(id) {
      if (!id || id === shown && (stage ? stage.spotId === id : true)) return;
      shown = id; host.dataset.spot = id;
      spotArt(art, id, { hour: hourNow() });
      if (stage) stage.setSpot(id);
    }
    var lastLabel = '';
    function sync(s, meta) {
      meta = meta || {};
      var st = stateOf(s), run = s.run, active = !!(run && s.active);
      if (s.spot) names[s.spot.id] = { short: s.spot.short, name: s.spot.name };
      // a run going: its spot; a finished run on screen: where it happened; idle: the spot picked here, else the one the server remembers
      var id = active ? (run.spot || (s.spot && s.spot.id)) : st === 'done' ? ((run && run.spot) || (s.spot && s.spot.id)) : (Spots.selected || s.selected_spot || (s.spot && s.spot.id));
      id = id || shown;
      show(id); setLabels(id);
      if (!names[id]) Spots.load().then(function (d) { if (d && d.spots) { d.spots.forEach(function (x) { names[x.id] = { short: x.short, name: x.name }; }); setLabels(id); } });
      if (st !== 'idle') root.classList.remove('is-setup');
      if (!swapped && W.scenes && W.scenes.week && camRate() !== pulseMs) throttleCam();
      if (!stage) return;
      var el = 0;
      if (active && run.phase_seconds && (st === 'work' || st === 'break')) el = Math.max(0, num(run.phase_seconds) - P.remaining(run));
      else if (active && run.waiting && run.waiting.since) el = Math.max(0, (P.now() - Date.parse(run.waiting.since)) / 1000);
      stage.setRun({ state: st, paused: !!(active && run.paused), category: run ? run.category : null, elapsed: el, initial: !!(meta.initial || meta.first) });
      var lab = stage.describe(); if (lab !== lastLabel) { lastLabel = lab; host.setAttribute('aria-label', lab); }
    }
    return { sync: sync, stage: function () { return stage; } };
  }

  /* ====================================================================== Today: the start sheet and the run card */
  function todayHooks() {
    var form = J('run-form');
    // the spot row of the start sheet: the open spots as chips, the selected one checked (locked ones live in the Focus Screen's picker)
    var spotRow = J('run-spot-row'), spotBox = J('run-spots');
    function fillSpots() {
      if (!spotRow || !spotBox) return;
      Spots.load(true).then(function (d) {
        if (!d || !d.spots) return;
        var open = d.spots.filter(function (s) { return s.state === 'open'; });
        if (!open.length) return;
        var sel = Spots.selected || d.selected || 'butler';
        spotBox.innerHTML = open.map(function (s) {
          return '<label class="chip"><input type="radio" name="spot" value="' + W.esc(s.id) + '"' + (s.id === sel ? ' checked' : '') + '><span>' + W.ico('map-pin') + W.esc(s.short || s.name) + '</span></label>';
        }).join('') + (d.spots.length > open.length ? '<a class="small runspots__more" href="/pomodoro">More spots</a>' : '');
        spotRow.hidden = false;
      });
    }
    if (form) {
      var dlg = form.closest('dialog');
      fillSpots();
      if (dlg) dlg.addEventListener('toggle', function () { if (dlg.open) fillSpots(); });
      DOC.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-js="focus-start"]')) fillSpots(); });
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var d = {}; qsa('input', form).forEach(function (i) { if (i.type === 'radio' ? i.checked : true) d[i.name] = i.value; });
        var btn = qs('button[type=submit]', form); if (btn) btn.classList.add('is-busy');
        if (window.WitnessAudio) WitnessAudio.ensure();
        var body = { preset: d.preset, category: d.category, label: (d.label || '').trim() };
        if (d.spot) body.spot = d.spot;
        P.post('start', body).then(function (res) {
          if (btn) btn.classList.remove('is-busy');
          if (!res || res.ok === false) {
            if (res && res.code === 'already_running') { location.href = '/pomodoro'; return; }
            W.toast({ icon: 'info', tone: 'violet', title: (res && res.hint) || 'That did not start.' }); return;
          }
          location.href = '/pomodoro';
        }).catch(function (err) { if (btn) btn.classList.remove('is-busy'); if (err && err.kind === 'offline') W.toast({ icon: 'info', tone: 'violet', title: "Can't reach Epoch on this computer." }); else HTMLFormElement.prototype.submit.call(form); });
      });
    }
    // with a run going, the button goes straight to the focus screen instead of opening the start sheet
    DOC.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-js="focus-start"]');
      if (a && P.state && (P.state.active || (P.state.pending_ratings || []).length)) { e.preventDefault(); e.stopImmediatePropagation(); location.href = '/pomodoro'; }
    }, true);
  }

  /* ====================================================================== boot */
  function boot() {
    P.onState(updateGlobals);
    setInterval(tickCard, 500);
    var root = J('focus');
    if (root) focusScreen(root);
    todayHooks();
    if (PAGE === 'pomodoro' || PAGE === 'today') { startLive(); P.fetch(); [350, 700, 1050].forEach(function (d) { later(d, P.fetch); }); }       // a few quick samples pin down the clock offset
    else if (PAGE !== 'pair') P.fetch();
  }
  if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', boot); else boot();
})();
