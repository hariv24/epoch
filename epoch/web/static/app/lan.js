/* lan.js · Settings > "Use on your tablet": tablet-mode switch, addresses, pairing (QR + 6-digit code with a countdown), paired devices.
 * Progressive enhancement over _lan_panel.html: every control there is a real form, so this file only upgrades it.
 * Endpoints: docs/FEATURES-V2.md section 2 (GET /api/lan, POST /api/settings/lan, POST /api/pair/new, POST /api/devices/{id}/revoke). */
(function () {
  'use strict';
  var W = window.Witness; if (!W) return;
  var DOC = document;
  var panel = DOC.querySelector('[data-js="lan-panel"]'); if (!panel) return;
  function J(n) { return panel.querySelector('[data-js="' + n + '"]'); }
  function JJ(n) { return Array.prototype.slice.call(panel.querySelectorAll('[data-js="' + n + '"]')); }
  var api = W.api, esc = W.esc;
  var pair = { expires: 0, total: 600, timer: 0, poll: 0, devicesBefore: -1 };

  function toast(t, sub, tone) { W.toast({ icon: 'info', tone: tone || 'violet', title: t, sub: sub }); }

  /* ---- relative times and a short device description ---- */
  function rel(iso) {
    var t = Date.parse(iso || ''); if (!isFinite(t)) return 'never';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
  }
  function describeUA(ua) {
    ua = String(ua || ''); var os = /Android/i.test(ua) ? 'Android' : /iPad|iPhone/i.test(ua) ? 'iOS' : /Mac OS X/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : '';
    var br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return [os, br].filter(Boolean).join(' · ');
  }
  function refreshTimes() {
    JJ('reltime').forEach(function (t) { t.textContent = rel(t.getAttribute('datetime')); });
    JJ('device-ua').forEach(function (u) { var li = u.closest('.device'); var d = describeUA(li && li.dataset.ua); u.textContent = d ? d + ' ·' : ''; });
  }

  /* ---- render from GET /api/lan ---- */
  function render(info) {
    if (!info) return;
    panel.dataset.enabled = info.enabled ? '1' : '0'; panel.dataset.active = info.active ? '1' : '0';
    var tg = J('lan-toggle'); if (tg) tg.checked = !!info.enabled;
    var rs = J('lan-restart'); if (rs) {
      rs.hidden = !info.restart_needed;
      var t = J('lan-restart-text'); if (t) t.textContent = info.enabled ? 'Quit Epoch and start it again so it can listen on your network. The tablet cannot connect until then.' : 'Quit Epoch and start it again to stop listening on your network.';
    }
    var ub = J('lan-urls-box'); if (ub) ub.hidden = !info.enabled;
    var ul = J('lan-urls');
    if (ul) {
      ul.innerHTML = (info.urls || []).map(function (u) {
        return '<li><code>' + esc(u.url) + '</code><button class="btn btn--ghost js-only" type="button" data-js="copy-url" data-url="' + esc(u.url) + '">' + W.ico('copy') + 'Copy</button><span class="xs muted">' +
          (u.kind === 'ip' ? 'number address, best for Android' : 'name, works on most phones and Macs') + '</span></li>';
      }).join('') || '<li class="muted small">No network address found. Connect this computer to your Wi-Fi.</li>';
    }
    var help = J('pair-help'); if (help) help.textContent = info.enabled ? 'Make a one-time code, then scan the QR code or type the six digits on the tablet. It works once and lasts 10 minutes.' : 'Turn tablet mode on first.';
    var pb = J('pair-btn'); if (pb) pb.setAttribute('aria-disabled', info.enabled ? 'false' : 'true');
    renderDevices(info.devices || []);
  }
  function renderDevices(list) {
    var ul = J('device-list'); if (!ul) return;
    ul.innerHTML = list.map(function (d) {
      return '<li class="device" data-id="' + d.id + '" data-ua="' + esc(d.user_agent || '') + '"><span class="device__ic" aria-hidden="true">' + W.ico('tablet') + '</span>' +
        '<div class="device__t"><b>' + esc(d.name) + '</b><span class="xs muted"><span data-js="device-ua"></span> last seen <time datetime="' + esc(d.last_seen_utc || '') + '" data-js="reltime">' + esc(d.last_seen_utc || 'never') + '</time></span></div>' +
        '<form method="post" action="/settings/lan/devices/' + d.id + '/revoke" data-js="revoke-form"><button class="btn btn--ghost" type="submit" aria-label="Remove ' + esc(d.name) + '">Remove</button></form></li>';
    }).join('') || '<li class="muted small device--none" data-js="no-devices">No devices paired yet.</li>';
    refreshTimes();
  }
  function fetchInfo() { return api.get('/api/lan').then(function (i) { if (i && i.ok !== false) { render(i); return i; } return null; }).catch(function () { return null; }); }

  /* ---- the switch ---- */
  var tg = J('lan-toggle');
  if (tg) tg.addEventListener('change', function () {
    var on = tg.checked;
    api.post('/api/settings/lan', { enabled: on }).then(function (res) {
      if (!res || res.ok === false) { tg.checked = !on; toast((res && res.hint) || 'That could not be saved.'); return; }
      render(res);
      if (!on) closePairing();
    }).catch(function () { tg.checked = !on; toast("Can't reach Epoch on this computer."); });
  });
  var lf = J('lan-form'); if (lf) lf.addEventListener('submit', function (e) { e.preventDefault(); });

  /* ---- copy an address ---- */
  panel.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-js="copy-url"]'); if (!b) return;
    var url = b.dataset.url, done = function () { var o = b.innerHTML; b.textContent = 'Copied'; setTimeout(function () { b.innerHTML = o; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { toast('Select the address and copy it by hand.'); });
    else toast('Select the address and copy it by hand.');
  });

  /* ---- pairing: QR + code + countdown ---- */
  function fmt(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function tickPair() {
    var left = Math.round((pair.expires - Date.now()) / 1000), box = J('pairing-qr'); if (!box || box.hidden) return;
    var c = J('pair-count'), bar = J('pair-bar');
    if (c) c.textContent = fmt(left);
    if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / pair.total)).toFixed(3) + ')';
    if (left <= 0) {
      box.classList.add('is-expired'); var r = J('pair-result'); if (r) r.textContent = 'This code has expired. Make a new one.';
      clearInterval(pair.timer); pair.timer = 0; clearInterval(pair.poll); pair.poll = 0;
    }
  }
  function closePairing() { var box = J('pairing-qr'); if (box) { box.hidden = true; box.classList.remove('is-expired'); } clearInterval(pair.timer); clearInterval(pair.poll); pair.timer = pair.poll = 0; }
  function showPairing(p) {
    var box = J('pairing-qr'); if (!box) return;
    box.hidden = false; box.classList.remove('is-expired', 'is-paired');
    var q = J('pair-qr-svg'); if (q) q.innerHTML = p.qr && p.qr.svg || '';
    var c = J('pair-code'); if (c) { c.textContent = String(p.code).slice(0, 3) + ' ' + String(p.code).slice(3); c.dataset.code = p.code; }
    var pg = J('pair-page'); if (pg) pg.textContent = p.pair_page || '';
    var r = J('pair-result'); if (r) r.textContent = '';
    pair.expires = Date.parse(p.expires_at) || (Date.now() + 600000); pair.total = p.ttl_seconds || 600;
    clearInterval(pair.timer); pair.timer = setInterval(tickPair, 1000); tickPair();
    clearInterval(pair.poll);
    pair.devicesBefore = JJ('device-list')[0] ? JJ('device-list')[0].querySelectorAll('.device').length : 0;
    pair.poll = setInterval(function () {
      fetchInfo().then(function (info) {
        if (!info) return;
        if ((info.devices || []).length > pair.devicesBefore) {
          var d = info.devices[info.devices.length - 1]; box.classList.add('is-paired');
          var rr = J('pair-result'); if (rr) rr.textContent = 'Paired: ' + (d && d.name || 'a new device') + '. It can open Epoch now.';
          W.toast({ icon: 'check', tone: 'mint', title: 'Tablet paired.', sub: d && d.name });
          clearInterval(pair.timer); clearInterval(pair.poll); pair.timer = pair.poll = 0;
          var bar = J('pair-bar'); if (bar) bar.style.transform = 'scaleX(0)';
        }
      });
    }, 3000);
  }
  var pf = J('pair-form');
  if (pf) pf.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = J('pair-btn');
    if (btn.getAttribute('aria-disabled') === 'true') { toast('Turn tablet mode on first, then restart Epoch.'); return; }
    btn.classList.add('is-busy');
    api.post('/api/pair/new', {}).then(function (res) {
      btn.classList.remove('is-busy');
      if (!res || res.ok === false) { toast((res && res.hint) || 'A pairing code could not be made.'); return; }
      showPairing(res);
      if (res.restart_needed) { var rs = J('lan-restart'); if (rs) rs.hidden = false; }
      var c = J('pair-code'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: W.reduced() ? 'auto' : 'smooth' });
    }).catch(function (err) { btn.classList.remove('is-busy'); if (err && err.kind === 'offline') toast("Can't reach Epoch on this computer."); else HTMLFormElement.prototype.submit.call(pf); });
  });

  /* ---- revoke ---- */
  panel.addEventListener('submit', function (e) {
    var f = e.target; if (!f.matches || !f.matches('[data-js="revoke-form"]')) return;
    e.preventDefault();
    var li = f.closest('.device'), id = li && li.dataset.id, name = li && li.querySelector('b') ? li.querySelector('b').textContent : 'device';
    var btn = f.querySelector('button'); btn.classList.add('is-busy');
    api.post('/api/devices/' + id + '/revoke', {}).then(function (res) {
      btn.classList.remove('is-busy');
      if (!res || res.ok === false) { toast((res && res.hint) || 'That device could not be removed.'); return; }
      toast(name + ' removed.', 'It has to pair again to open Epoch.');
      fetchInfo();
    }).catch(function () { btn.classList.remove('is-busy'); f.submit(); });
  });

  // server-rendered pairing (no-JS form result): start its countdown
  var first = J('pairing-qr');
  if (first && !first.hidden && first.dataset.expires) { pair.expires = Date.parse(first.dataset.expires); pair.timer = setInterval(tickPair, 1000); tickPair(); }
  refreshTimes();
  setInterval(refreshTimes, 30000);
})();
