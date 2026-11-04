/* Epoch money UI (docs/ECONOMY.md): the header wallet pill, "+$X" fact toasts after a log or a focus block, and the NYC Store, Passport
   and Home pages (two-step buying, equip / place / toggle, moving). Classic script, loaded after app.js; it only uses window.Witness
   (api, toast, prefs, sfx) and never touches the 3D city. Everything it needs is found through data-js attributes. If anything throws,
   the server-rendered pages still show their numbers. */
(function () {
  'use strict';
  var DOC = document;
  function qs(sel, root) { return (root || DOC).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || DOC).querySelectorAll(sel)); }
  function J(name, root) { return qs('[data-js="' + name + '"]', root); }
  function JJ(name, root) { return qsa('[data-js="' + name + '"]', root); }
  function W() { return window.Witness || null; }
  function quiet() { var w = W(); return !!(w && w.prefs && w.prefs.quiet) || DOC.documentElement.classList.contains('quiet'); }
  function money(n) { n = Math.trunc(Number(n) || 0); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }
  function toast(o) { var w = W(); if (w && w.toast) w.toast(o); }
  function later(ms, fn) { return setTimeout(fn, ms); }
  function post(url, body) {
    var w = W();
    return w.api.post(url, body).catch(function (err) {
      toast({ icon: 'info', tone: 'violet', title: err && err.kind === 'offline' ? "Can't reach Epoch on this computer." : 'That did not go through. Nothing was changed.' });
      return null;
    });
  }

  /* ------------------------------------------------------------------ wallet pill + "+$X" toasts */
  var known = null;         // { cents, title, perHour } from the last /api/economy
  var inflight = null, lastCheck = 0;

  function paintPill(cents, pop) {
    JJ('wallet-pill').forEach(function (p) {
      p.dataset.cents = String(cents);
      var n = J('wallet-num', p), text = money(Math.trunc(cents / 100));
      if (n && n.textContent !== text) { n.textContent = text; if (pop && W() && W().popEl) W().popEl(p); }
      p.setAttribute('aria-label', 'Savings ' + text + '. Open the wallet');
    });
    JJ('m-savings').forEach(function (n) { n.dataset.cents = String(cents); n.textContent = money(Math.trunc(cents / 100)); });
    JJ('m-balance').forEach(function (n) { n.textContent = money(Math.trunc(cents / 100)); });
  }

  /* every change of the savings is announced once, so the cozy HUD can fly coins and count up (cozy.js listens) */
  function emitMoney(delta, cents, prevCents, econ, source) {
    try { DOC.dispatchEvent(new CustomEvent('witness:money', { detail: { delta_cents: delta, balance_cents: cents, prev_cents: prevCents, economy: econ || null, source: source || null } })); } catch (e) { /* older browsers */ }
  }

  function readEconomy() {
    var w = W(); if (!w) return Promise.resolve(null);
    return w.api.get('/api/economy').then(function (e) { return e && e.ok ? e : null; }).catch(function () { return null; });
  }

  function prime() {
    var pill = J('wallet-pill'); if (!pill) return;
    readEconomy().then(function (e) {
      if (!e) return;
      known = { cents: e.balance_cents, title: e.rate && e.rate.title, perHour: e.rate && e.rate.per_hour };
      paintPill(e.balance_cents, false);
    });
  }

  /* Called after any write that can earn (a log, an output, a stopped focus block). Reads the new balance and says what was added. */
  function after() {
    if (!J('wallet-pill') && !known) return;
    var now = Date.now(); if (inflight && now - lastCheck < 1500) return inflight;
    lastCheck = now;
    inflight = new Promise(function (resolve) {
      later(450, function () {   // let the server finish banking, and let the other toasts land first
        readEconomy().then(function (e) {
          inflight = null; resolve();
          if (!e) return;
          var prev = known;
          known = { cents: e.balance_cents, title: e.rate.title, perHour: e.rate.per_hour };
          paintPill(e.balance_cents, !!prev && e.balance_cents !== prev.cents);
          if (prev && e.balance_cents !== prev.cents) emitMoney(e.balance_cents - prev.cents, e.balance_cents, prev.cents, e);
          if (quiet() || !prev) return;
          var exact = e.balance_cents - prev.cents;
          if (exact > 0) {
            // to the cent, so "+$8.75" and the savings line agree (a whole-dollar floor could say +$8 while savings went up by $9)
            var shown = '+' + (exact % 100 ? '$' + (exact / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : money(exact / 100));
            toast({ icon: 'wallet', tone: 'mint', title: shown + ' earned', sub: 'Savings ' + money(Math.trunc(e.balance_cents / 100)), ms: 4600 });
            if (W() && W().sfx) W().sfx('tick');
          }
          if (prev.title && (e.rate.title !== prev.title || e.rate.per_hour > prev.perHour)) {
            later(900, function () { toast({ icon: 'star', tone: 'violet', title: 'A raise: ' + e.rate.title + ', ' + money(e.rate.per_hour) + ' an hour', sub: 'It counts from the moment the skill unlocked.', ms: 6000 }); });
          }
        });
      });
    });
    return inflight;
  }

  /* ------------------------------------------------------------------ page refresh (swap the page's money-root, keep scroll + the open aisle) */
  var refreshing = false;
  function refreshRoot(focusItem) {
    var root = J('money-root'); if (!root || refreshing) return Promise.resolve();
    refreshing = true;
    var aisle = currentAisle(), y = window.scrollY;
    return fetch(location.pathname + location.search, { credentials: 'same-origin', headers: { 'Accept': 'text/html' } })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var next = qs('[data-js="money-root"]', doc); if (!next) throw new Error('shape');
        root.innerHTML = next.innerHTML;
        var bar = qs('.m-bar .m-savings', doc), cur = qs('.m-bar .m-savings');
        if (bar && cur) cur.innerHTML = bar.innerHTML;
        initAisles(aisle);
        initThumbs();
        window.scrollTo(0, y);
        var n = J('m-savings');
        if (n) paintPill(Number(n.dataset.cents) || 0, false);
        if (focusItem) {
          var a = qs('[data-item="' + focusItem + '"]', root), b = a && (qs('button, a.btn', a) || a);
          if (b) { if (b === a) a.setAttribute('tabindex', '-1'); try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        }
      })
      .catch(function () { location.reload(); })
      .then(function () { refreshing = false; });
  }

  /* ------------------------------------------------------------------ aisles */
  function currentAisle() { var c = qs('[data-js="aisle-tabs"] input:checked'); return c ? c.value : null; }
  function showAisle(name, keepHash) {
    var panels = JJ('aisle-panel'); if (!panels.length) return;
    panels.forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    qsa('[data-js="aisle-tabs"] input').forEach(function (r) { r.checked = r.value === name; });
    if (!keepHash) { try { history.replaceState(null, '', location.pathname + '#' + name); } catch (e) { /* ignore */ } }
  }
  function initAisles(prefer) {
    var tabs = J('aisle-tabs'); if (!tabs) return;
    var names = qsa('input', tabs).map(function (r) { return r.value; });
    var h = (location.hash || '').slice(1);
    showAisle(prefer && names.indexOf(prefer) >= 0 ? prefer : (names.indexOf(h) >= 0 ? h : tabs.dataset.default || names[0]), true);
  }

  /* ------------------------------------------------------------------ the confirm sheet */
  var cf = { busy: false, run: null };
  function dlg() { return J('confirm-dlg'); }
  function openConfirm(o) {
    var d = dlg(); if (!d) return;
    J('cf-eyebrow', d).textContent = o.eyebrow || 'Confirm';
    J('cf-title', d).textContent = o.title;
    var dl = J('cf-lines', d); dl.innerHTML = '';
    (o.lines || []).forEach(function (l) {
      var row = DOC.createElement('div'); if (l[2]) row.className = l[2];
      var dt = DOC.createElement('dt'), dd = DOC.createElement('dd'); dt.textContent = l[0]; dd.textContent = l[1]; dd.className = 'num';
      row.appendChild(dt); row.appendChild(dd); dl.appendChild(row);
    });
    J('cf-note', d).textContent = o.note || '';
    var art0 = J('cf-art', d); if (art0) { art0.innerHTML = ''; art0.hidden = true; }
    var err = J('cf-error', d); err.hidden = !o.error; err.textContent = o.error || '';
    var yes = J('cf-yes', d); yes.textContent = o.yes || 'Yes'; yes.classList.remove('is-busy'); yes.removeAttribute('aria-disabled');
    cf.run = o.run; cf.busy = false;
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    try { yes.focus(); } catch (e) { /* ignore */ }
  }
  function closeConfirm() { var d = dlg(); if (d && d.open) d.close('cancel'); }
  function initConfirm() {
    DOC.addEventListener('click', function (e) {
      var y = e.target.closest && e.target.closest('[data-js="cf-yes"]'); if (!y) return;
      if (cf.busy || !cf.run) return;
      cf.busy = true; y.classList.add('is-busy'); y.setAttribute('aria-disabled', 'true');
      Promise.resolve(cf.run()).then(function () { cf.busy = false; y.classList.remove('is-busy'); y.removeAttribute('aria-disabled'); });
    });
  }

  /* ------------------------------------------------------------------ buying */
  var HOW = {
    furniture: 'It goes into a free slot in your room, or into storage if the room is full.',
    outfit: 'You will wear it right away. You can switch outfits any time.',
    experience: 'It becomes a postcard in your Passport.',
    upgrade: 'It switches on for all of your study towers. You can turn it off again.',
  };
  function showError(msg) { var d = dlg(), e = d && J('cf-error', d); if (e) { e.textContent = msg; e.hidden = !msg; } }

  function quoteLines(q) {
    return [['Price', money(q.price)], ['Savings now', money(q.balance)], ['Savings after', money(q.balance_after), 'is-after']];
  }
  function startBuy(btn) {
    if (btn.getAttribute('aria-disabled') === 'true') {
      toast({ icon: 'info', tone: 'violet', title: btn.dataset.why || 'Not enough savings yet.' });
      return;
    }
    var item = btn.dataset.item, art = btn.closest('[data-aisle]'), aisle = art && art.dataset.aisle;
    post('/api/shop/buy', { item: item }).then(function (res) {
      if (!res) return;
      if (res.ok === false) { toast({ icon: 'info', tone: 'violet', title: res.hint || 'That is not available right now.' }); if (res.code === 'stale' || res.code === 'price_changed') refreshRoot(); return; }
      var q = res.quote;
      openConfirm({
        eyebrow: 'Buy', title: q.name || btn.dataset.name, lines: quoteLines(q), note: HOW[aisle] || '', yes: 'Yes, buy it for ' + money(q.price),
        run: function () { return confirmBuy(item, q); },
      });
    });
  }
  function confirmBuy(item, q) {
    return post('/api/shop/buy', { item: item, price: q.price, token: q.token }).then(function (res) {
      if (!res) { showError('Could not reach Epoch. Nothing was bought.'); return; }
      if (res.ok === false) {
        if ((res.code === 'stale' || res.code === 'price_changed') && res.quote) {
          var nq = res.quote;
          openConfirm({ eyebrow: 'Buy', title: nq.name || q.name, lines: quoteLines(nq), note: 'Your savings or the price changed a little. Check it once more.', yes: 'Yes, buy it for ' + money(nq.price), run: function () { return confirmBuy(item, nq); } });
        } else { showError(res.hint || 'That did not go through. Nothing was bought.'); }
        return;
      }
      closeConfirm();
      // the server's toast already says the new savings; only add the line when it does not
      toast({ icon: res.passport ? 'ticket' : 'shopping-bag', tone: 'mint', title: res.toast || ('Bought ' + res.name + '.'), sub: res.toast ? '' : 'Savings ' + money(res.balance), ms: 5200 });
      if (W() && W().sfx) W().sfx('levelUp');
      var before = known && known.cents;
      known = known || {}; known.cents = res.balance_cents;
      paintPill(res.balance_cents, true);
      if (before != null && before !== res.balance_cents) emitMoney(res.balance_cents - before, res.balance_cents, before, null, 'buy');
      var card = qs('[data-item="' + item + '"]'), aisle = card && card.dataset.aisle;
      return refreshRoot(item).then(function () { if (aisle === 'furniture') offerPlace(item, res, card); });
    });
  }

  /* ------------------------------------------------------------------ equip / place / toggle */
  var EQUIP_TOAST = {
    'furniture:1': 'Placed in your room.', 'furniture:0': 'Moved to storage.', 'outfit:1': 'Wearing it.', 'outfit:0': 'Back in everyday clothes.',
    'upgrade:1': 'Showing on your towers.', 'upgrade:0': 'Switched off on your towers.',
  };
  function doEquip(btn) {
    if (btn.classList.contains('is-busy')) return;
    var kind = btn.dataset.kind, item = btn.dataset.item, on = btn.dataset.on === '1';
    btn.classList.add('is-busy');
    post('/api/equip', { kind: kind, item: item, on: on }).then(function (res) {
      btn.classList.remove('is-busy');
      if (!res) return;
      if (res.ok === false) { toast({ icon: 'info', tone: 'violet', title: res.hint || 'That did not change.' }); return; }
      toast({ icon: 'check', tone: 'mint', title: EQUIP_TOAST[kind + ':' + (on ? 1 : 0)] || 'Done.' });
      if (W() && W().refresh) { try { W().refresh(); } catch (e) { /* ignore */ } }
      return refreshRoot(item);
    });
  }

  /* ------------------------------------------------------------------ moving home */
  function moveLines(q) {
    var out = [['New rent', money(q.rent) + ' a week'], ['Deposit for the new place', money(q.deposit)]];
    if (q.deposit_back) out.push(['Deposit back from this place', money(q.deposit_back)]);
    out.push(['Paid today', money(q.net)], ['Savings after', money(q.balance_after), 'is-after']);
    return out;
  }
  function startMove(btn) {
    var home = btn.dataset.home;
    post('/api/home/move', { home: home }).then(function (res) {
      if (!res) return;
      if (res.ok === false) { toast({ icon: 'info', tone: 'violet', title: res.hint || 'You cannot move there yet.' }); return; }
      var q = res.quote;
      openConfirm({
        eyebrow: 'Move', title: q.name || btn.dataset.name, lines: moveLines(q),
        note: (q.note ? q.note + ' ' : '') + 'Your furniture comes with you; anything that does not fit waits safely in storage.', yes: 'Yes, move here',
        run: function () { return confirmMove(home, q); },
      });
    });
  }
  function confirmMove(home, q) {
    return post('/api/home/move', { home: home, token: q.token }).then(function (res) {
      if (!res) { showError('Could not reach Epoch. Nothing changed.'); return; }
      if (res.ok === false) {
        if (res.code === 'stale' && res.quote) { var nq = res.quote; openConfirm({ eyebrow: 'Move', title: nq.name || q.name, lines: moveLines(nq), note: 'Your savings changed a little. Check it once more.', yes: 'Yes, move here', run: function () { return confirmMove(home, nq); } }); }
        else showError(res.hint || 'That did not go through. Nothing changed.');
        return;
      }
      closeConfirm();
      toast({ icon: 'house', tone: 'mint', title: res.toast || ('You live in ' + res.name + ' now.'), ms: 5600 });
      if (W() && W().sfx) W().sfx('levelUp');
      if (W() && W().refresh) { try { W().refresh(); } catch (e) { /* ignore */ } }
      paintPill(res.balance_cents != null ? res.balance_cents : Math.round((res.balance || 0) * 100), true);
      return refreshRoot();
    });
  }

  /* ------------------------------------------------------------------ "Open my room": the 3D room is built by the city code; ask for it if it is there */
  /* docs/COZY.md 3: "Open my room" goes to Today's home scene in decorate mode. On Today itself the scene is right there. */
  function openRoom(item) {
    var w = W();
    try {
      if (w && w.cozyUI && typeof w.cozyUI.decorate === 'function' && J('home-scene')) { w.cozyUI.decorate(item ? { item: item } : {}); return; }
    } catch (e) { /* fall through to the Today page */ }
    location.href = '/?decorate=1' + (item ? '&item=' + encodeURIComponent(item) : '') + '#home';
  }

  /* ------------------------------------------------------------------ 3D store: thumbnails, a slow turn on hover / focus, "Place it now" */
  var thumbsP = null;
  function reduced() { var w = W(); return !!(w && w.reduced && w.reduced()); }
  function thumbsMod() {
    var w = W();
    if (!w || !w.base || !w.ensureImportMap || (w.threeOn && !w.threeOn())) return Promise.resolve(null);
    if (!thumbsP) {
      try { w.ensureImportMap(); } catch (e) { return Promise.resolve(null); }
      thumbsP = import(new URL('city/thumbs.js', w.base).href).then(function (m) { return m && m.supported() ? m : null; }).catch(function (e) { console.warn('store thumbnails off', e); return null; });
    }
    return thumbsP;
  }
  function specOf(card) {
    var a = card.dataset.aisle, id = card.dataset.item;
    if (a === 'furniture') return { kind: 'item', id: id, category: card.dataset.category || '' };
    if (a === 'outfit') return { kind: 'figure', outfit: id };
    return null;
  }
  function thumbOne(m, card) {
    var spec = specOf(card), art = qs('.item__art', card); if (!spec || !art || art.dataset.thumb) return;
    art.dataset.thumb = 'wait';
    var p = spec.kind === 'figure' ? m.figureThumb(spec.outfit, { size: 168 }) : m.itemThumb(spec.id, spec.category, { size: 168 });
    p.then(function (url) {
      if (!url || !card.isConnected) { art.dataset.thumb = 'none'; return; }
      var img = DOC.createElement('img'); img.className = 'item__3d'; img.alt = ''; img.decoding = 'async'; img.src = url; img.setAttribute('aria-hidden', 'true');
      var cv = DOC.createElement('canvas'); cv.className = 'item__spin'; cv.setAttribute('aria-hidden', 'true'); cv.hidden = true;
      art.appendChild(img); art.appendChild(cv); art.classList.add('has-3d'); art.dataset.thumb = 'ok';
    });
  }
  var thumbIO = null;
  function initThumbs() {
    var cards = qsa('.item[data-aisle="furniture"], .item[data-aisle="outfit"]'); if (!cards.length) return;
    thumbsMod().then(function (m) {
      if (!m) return;
      if (thumbIO) thumbIO.disconnect();
      if ('IntersectionObserver' in window) {
        thumbIO = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) { thumbIO.unobserve(en.target); thumbOne(m, en.target); } }); }, { rootMargin: '240px 0px' });
        qsa('.item[data-aisle="furniture"], .item[data-aisle="outfit"]').forEach(function (c) { if (!qs('.item__art[data-thumb]', c)) thumbIO.observe(c); });
      } else qsa('.item[data-aisle="furniture"], .item[data-aisle="outfit"]').forEach(function (c) { thumbOne(m, c); });
    });
  }
  var spinning = null;
  function startSpin(card) {
    if (reduced() || !card || (spinning && spinning.card === card)) return;
    var art = qs('.item__art.has-3d', card), cv = art && qs('.item__spin', art), spec = specOf(card); if (!cv || !spec) return;
    stopSpin();
    thumbsMod().then(function (m) {
      if (!m || !card.isConnected) return;
      cv.hidden = false; art.classList.add('is-spinning');
      spinning = { card: card, h: m.spin(cv, spec, { size: cv.clientWidth || 168, speed: 0.6 }) };
    });
  }
  function stopSpin() {
    if (!spinning) return;
    var art = qs('.item__art', spinning.card), cv = art && qs('.item__spin', art);
    try { spinning.h.stop(); } catch (e) { /* gone */ }
    if (cv) cv.hidden = true; if (art) art.classList.remove('is-spinning');
    spinning = null;
  }
  function initSpin() {
    DOC.addEventListener('pointerover', function (e) { var c = e.target.closest && e.target.closest('.item'); if (c && e.pointerType === 'mouse') startSpin(c); });
    DOC.addEventListener('pointerout', function (e) { var c = e.target.closest && e.target.closest('.item'); if (c && spinning && spinning.card === c && !c.contains(e.relatedTarget)) stopSpin(); });
    DOC.addEventListener('focusin', function (e) { var c = e.target.closest && e.target.closest('.item'); if (c) startSpin(c); else stopSpin(); });
    DOC.addEventListener('visibilitychange', function () { if (DOC.hidden) stopSpin(); });
  }
  /* after buying furniture: a calm sheet with the piece turning, and "Place it now" (it opens Today's home in decorate mode, the piece selected) */
  function offerPlace(item, res, card) {
    var d = dlg(); if (!d) return;
    var name = res.name || (card && card.dataset.name) || 'Your new piece';
    var line = card ? ((qs('.item__act-line', card) || {}).textContent || '') : '';
    var where = res.stored ? 'It is in storage until you place it.' : 'It is in your room. Place it where you like.';
    openConfirm({ eyebrow: 'Yours now', title: name, lines: [['Savings now', money(res.balance)]], note: (line ? line + ' ' : '') + where, yes: 'Place it now',
      run: function () { closeConfirm(); openRoom(item); return Promise.resolve(); } });
    var panel = qs('.sheet__panel', d), art = J('cf-art', d);
    if (!art && panel) { art = DOC.createElement('div'); art.className = 'cf-art'; art.dataset.js = 'cf-art'; art.setAttribute('aria-hidden', 'true'); panel.insertBefore(art, panel.children[1] || null); }
    if (!art) return;
    art.innerHTML = ''; art.hidden = true;
    thumbsMod().then(function (m) {
      if (!m || !d.open) return;
      var cv = DOC.createElement('canvas'); cv.className = 'cf-art__cv'; art.appendChild(cv); art.hidden = false;
      if (reduced()) m.itemThumb(item, card && card.dataset.category, { size: 180 }).then(function (u) { if (!u) return; var img = DOC.createElement('img'); img.src = u; img.alt = ''; img.className = 'cf-art__img'; art.replaceChildren(img); });
      else { var h = m.spin(cv, { kind: 'item', id: item, category: card && card.dataset.category }, { size: 180, speed: 0.7 }); d.addEventListener('close', function () { h.stop(); art.innerHTML = ''; art.hidden = true; }, { once: true }); }
    });
  }

  /* ------------------------------------------------------------------ settings: the third star */
  function initStar() {
    var sel = qs('#f-deep_star_minutes');
    function sync(minutes) {
      qsa('[data-js="star-setting"]').forEach(function (r) { r.checked = String(r.value) === String(minutes); });
      if (sel) sel.value = String(minutes);
    }
    function save(minutes) {
      post('/api/settings/star', { minutes: Number(minutes) }).then(function (res) {
        if (!res) return;
        if (res.ok === false) { toast({ icon: 'info', tone: 'violet', title: res.hint || 'That did not save.' }); return; }
        sync(res.deep_star_minutes);
        toast({ icon: 'star', title: 'The third star now needs ' + res.hours + ' hours of deep focus.', sub: 'Days that already have the star keep it.' });
        if (W() && W().refresh) { try { W().refresh(); } catch (er) { /* ignore */ } }
      });
    }
    DOC.addEventListener('change', function (e) {
      var el = e.target; if (!el || !el.matches) return;
      if (el.matches('[data-js="star-setting"]') && el.checked) save(el.value);
      else if (el.id === 'f-deep_star_minutes') save(el.value);
    });
  }

  /* ------------------------------------------------------------------ wiring */
  function init() {
    initConfirm(); initStar();
    DOC.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-js="buy"],[data-js="equip"],[data-js="move"],[data-js="open-room"]'); if (!t) return;
      var kind = t.dataset.js;
      if (kind === 'buy') startBuy(t); else if (kind === 'equip') doEquip(t); else if (kind === 'move') startMove(t);
      else { e.preventDefault(); openRoom(); }
    });
    DOC.addEventListener('change', function (e) {
      var r = e.target; if (r && r.matches && r.matches('[data-js="aisle-tabs"] input') && r.checked) showAisle(r.value);
    });
    addEventListener('hashchange', function () { var n = (location.hash || '').slice(1); if (qs('[data-js="aisle-panel"][data-panel="' + n + '"]')) showAisle(n, true); });
    DOC.addEventListener('witness:events', function () { after(); });
    initAisles();
    prime();
    initThumbs(); initSpin();
    DOC.addEventListener('visibilitychange', function () { if (!DOC.hidden && J('wallet-pill')) { later(300, function () { readEconomy().then(function (e) { if (e) { known = { cents: e.balance_cents, title: e.rate.title, perHour: e.rate.per_hour }; paintPill(e.balance_cents, false); } }); }); } });
  }

  /* the chest or another screen changed the savings: keep the pill and the "+$X" baseline in step, so nothing is announced twice */
  function sync(cents) { if (cents == null) return; known = known || {}; known.cents = cents; paintPill(cents, false); }
  window.WitnessMoney = { after: after, refresh: refreshRoot, openRoom: openRoom, money: money, sync: sync };
  if (DOC.readyState === 'loading') DOC.addEventListener('DOMContentLoaded', function () { try { init(); } catch (e) { console.error('Epoch money UI could not start.', e); } });
  else { try { init(); } catch (e) { console.error('Epoch money UI could not start.', e); } }
})();
