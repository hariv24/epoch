/* subway.js · World > Lines: the five ladders drawn as NYC-subway-style lines from GET /api/subway.
 *
 * One card per line: a coloured route with a white station dot for every node (reached, next stop, ahead), a train
 * on the line at train.position (station units: 0 = before station 1, 5 = at the last station), and the next-station text.
 * The diagram is horizontal on wide screens and vertical on phones. Each card also has a plain list of the stations with what
 * each one needs, so nothing depends on seeing the picture. The server renders a plain list first (no-JS fallback).
 */
(function () {
  'use strict';
  var W = window.Witness;
  var DOC = document;
  var host = DOC.querySelector('[data-js="subway"]'); if (!host) return;
  var data = null, mode = '', reducedMotion = function () { return !!(W && W.reduced && W.reduced()); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtMin(m) { m = Math.round(Number(m) || 0); return m >= 60 ? (m % 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : (m / 60) + 'h') : m + 'm'; }
  function needs(st) {
    var bits = [];
    if (st.needs_outputs) bits.push(st.needs_outputs + (st.needs_outputs === 1 ? ' output' : ' outputs'));
    if (st.needs_deep_min) bits.push(fmtMin(st.needs_deep_min) + ' deep');
    if (st.needs_link) bits.push(st.needs_link + (st.needs_link === 1 ? ' output with a link' : ' outputs with links'));
    return bits.join(', ');
  }
  function onColor(hex) {            // black or white text on a line colour, whichever reads better
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return '#fff';
    var n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.3 ? '#04142B' : '#fff';
  }
  // Ladder lines use the theme's category tokens, so they read on navy (dark) and on paper (light).
  var LINE_VAR = { 'Python': '--c-python', 'Math': '--c-math', 'ML/DL': '--c-ml', 'Papers': '--c-papers', 'Writing/X': '--c-writing' };
  function lineStyle(line) {
    var v = LINE_VAR[line.ladder];
    if (v) return '--lc:var(' + v + ',' + esc(line.color) + ');--on-lc:light-dark(#fff,#04142B)';
    return '--lc:' + esc(line.color) + ';--on-lc:' + onColor(line.color);
  }
  function reached(line) { return line.stations.filter(function (s) { return s.unlocked; }).length; }

  /* ---- the picture ---- */
  function stationSVG(st, x, y, vertical, nameX, nameY, anchor) {
    var cls = 'st st--' + (st.status || (st.unlocked ? 'passed' : 'ahead'));
    var out = '<g class="' + cls + '" transform="translate(' + x + ' ' + y + ')"><title>' + esc(st.n + '. ' + st.name + (st.unlocked ? ' (reached)' : st.status === 'next' ? ' (next stop)' : ' (ahead)')) + '</title>';
    if (st.status === 'next') out += '<circle class="st__halo" r="22"/>';
    out += '<circle class="st__dot" r="14"/>';
    if (st.unlocked) out += '<path class="st__tick" d="M-5 0.5l3.6 3.6L6 -3.4"/>';
    else if (st.status !== 'next') out += '<rect class="st__lock" x="-4.5" y="-2" width="9" height="7" rx="1.6"/><path class="st__lockarc" d="M-2.6 -2v-2.4a2.6 2.6 0 0 1 5.2 0V-2"/>';
    else out += '<circle class="st__pip" r="4.5"/>';
    out += '</g>';
    out += '<text class="st__n" x="' + nameX + '" y="' + (nameY - 19) + '" text-anchor="' + anchor + '">' + (vertical ? '' : 'Stop ' + st.n) + '</text>';
    var words = String(st.name).split(' '), lines = [st.name];
    if (!vertical && st.name.length > 11 && words.length > 1) {        // two short lines read better than one long one under a narrow stop
      var best = 1, diff = 99; for (var i = 1; i < words.length; i++) { var d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length); if (d < diff) { diff = d; best = i; } }
      lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
    }
    out += '<text class="st__name" x="' + nameX + '" y="' + nameY + '" text-anchor="' + anchor + '">' + lines.map(function (ln, k) { return '<tspan x="' + nameX + '" dy="' + (k ? 17 : 0) + '">' + esc(ln) + '</tspan>'; }).join('') + '</text>';
    return out;
  }
  function trainSVG(line, x, y, vertical) {
    return '<g class="train" data-pos="' + line.train.position + '" style="transform:translate(' + x + 'px,' + y + 'px)"><g class="train__body">' +
      '<rect class="train__car" x="' + (vertical ? -17 : -26) + '" y="' + (vertical ? -13 : -15) + '" width="' + (vertical ? 34 : 52) + '" height="' + (vertical ? 26 : 30) + '" rx="9"/>' +
      '<circle class="train__bullet" cx="0" cy="0" r="10"/><text class="train__letter" x="0" y="0.5" text-anchor="middle" dominant-baseline="central">' + esc(line.bullet) + '</text></g></g>';
  }
  function horizontal(line, width) {
    var n = line.stations.length, padL = 54, padR = 54, usable = width - padL - padR, step = usable / n;   // slot 0 = the terminal, 1..n = stations
    var xs = function (p) { return padL + p * step; }, y = 58, H = 150;
    var done = Math.max(0, Math.min(n, line.train.position));
    var svg = '<svg class="sline__svg" viewBox="0 0 ' + width + ' ' + H + '" width="100%" role="img" aria-label="' + esc(routeLabel(line)) + '" focusable="false">';
    svg += '<line class="route route--ahead" x1="' + xs(0) + '" y1="' + y + '" x2="' + xs(n) + '" y2="' + y + '"/>';
    svg += '<line class="route route--done" x1="' + xs(0) + '" y1="' + y + '" x2="' + xs(done) + '" y2="' + y + '"/>';
    svg += '<rect class="term" x="' + (xs(0) - 8) + '" y="' + (y - 8) + '" width="16" height="16" rx="4"/>';
    line.stations.forEach(function (st, i) { svg += stationSVG(st, xs(i + 1), y, false, xs(i + 1), y + 52, 'middle'); });
    svg += trainSVG(line, xs(done), y, false);
    return svg + '</svg>';
  }
  function vertical(line, width) {
    var n = line.stations.length, step = 66, x = 38, y0 = 34, H = y0 + n * step + 24, W2 = Math.max(260, width);
    var ys = function (p) { return y0 + p * step; };
    var done = Math.max(0, Math.min(n, line.train.position));
    var svg = '<svg class="sline__svg" viewBox="0 0 ' + W2 + ' ' + H + '" width="100%" role="img" aria-label="' + esc(routeLabel(line)) + '" focusable="false">';
    svg += '<line class="route route--ahead" x1="' + x + '" y1="' + ys(0) + '" x2="' + x + '" y2="' + ys(n) + '"/>';
    svg += '<line class="route route--done" x1="' + x + '" y1="' + ys(0) + '" x2="' + x + '" y2="' + ys(done) + '"/>';
    svg += '<rect class="term" x="' + (x - 8) + '" y="' + (ys(0) - 8) + '" width="16" height="16" rx="4"/><text class="st__n" x="' + (x + 28) + '" y="' + (ys(0) + 4) + '">Start</text>';
    line.stations.forEach(function (st, i) { svg += stationSVG(st, x, ys(i + 1), true, x + 28, ys(i + 1) + 5, 'start'); });
    svg += trainSVG(line, x, ys(done), true);
    return svg + '</svg>';
  }
  function routeLabel(line) {
    var r = reached(line), t = line.stations.length;
    return line.name + ': ' + r + ' of ' + t + ' stations reached. ' + (line.complete ? 'The line is complete.' : 'The train is on its way to ' + (line.train.next_station || 'the next station') + '.');
  }

  /* ---- a line card ---- */
  function card(line, width, vert) {
    var r = reached(line), t = line.stations.length, pct = Math.round(r / t * 100);
    var list = line.stations.map(function (st) {
      var tag = st.unlocked ? 'reached' : st.status === 'next' ? 'next stop' : 'ahead', req = !st.unlocked && needs(st) ? ' <span class="muted">Needs ' + esc(needs(st)) + '.</span>' : '';
      return '<li class="is-' + esc(st.status) + '"><b>' + st.n + '. ' + esc(st.name) + '</b> <span class="tag">' + tag + '</span>' + req + '</li>';
    }).join('');
    return '<section class="card sline' + (line.complete ? ' is-complete' : '') + '" style="' + lineStyle(line) + '" aria-labelledby="sl-' + esc(line.bullet) + '">' +
      '<header class="sline__head"><span class="bullet" aria-hidden="true">' + esc(line.bullet) + '</span><h3 id="sl-' + esc(line.bullet) + '">' + esc(line.name) + '</h3>' +
      '<span class="pill pill--sm">' + esc(line.landmark) + '</span><span class="sline__count num" title="Stations reached">' + r + '/' + t + '</span></header>' +
      '<div class="sline__fig" data-pct="' + pct + '">' + (vert ? vertical(line, width) : horizontal(line, width)) + '</div>' +
      '<p class="sline__next">' + (line.complete ? 'Every station on this line is lit.' : esc(line.next_text || ('Next stop: ' + (line.train.next_station || '')))) + '</p>' +
      '<details class="sline__more"><summary>As a list</summary><ol class="sline__list">' + list + '</ol></details></section>';
  }
  function render() {
    if (!data || !data.lines) return;
    var first = host.querySelector('.sline__fig'), width = Math.round((first ? first.clientWidth : host.clientWidth) || host.clientWidth || 640);
    var vert = width < 520;
    var m = (vert ? 'v' : 'h') + (vert ? '' : Math.round(width / 40));
    if (m === mode && host.querySelector('.sline__svg')) return;
    mode = m;
    host.innerHTML = data.lines.map(function (l) { return card(l, vert ? 320 : Math.max(640, width), vert); }).join('');
    animate();
  }
  /* the trains roll in from the start of their line (skipped under reduced motion) */
  function animate() {
    if (reducedMotion()) return;
    Array.prototype.forEach.call(host.querySelectorAll('.train'), function (t) {
      var to = t.style.transform; t.style.transition = 'none';
      var m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(to); if (!m) return;
      var fig = t.closest('.sline__svg'), vert = fig && fig.getAttribute('viewBox').split(' ')[2] < 400;
      t.style.transform = 'translate(' + (vert ? m[1] : 54) + 'px,' + (vert ? 34 : m[2]) + 'px)';
      void t.getBoundingClientRect();
      t.style.transition = ''; t.style.transform = to;
    });
  }

  function load() {
    var go = W && W.api ? W.api.get('/api/subway') : fetch('/api/subway', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
    return go.then(function (d) { if (d && d.lines) { data = d; mode = ''; render(); } }).catch(function () { /* the server list stays */ });
  }

  var tab = DOC.querySelector('[data-js="world-tabs"]'), loaded = false;
  function onShow() { if (!loaded) { loaded = true; load(); } else render(); }
  DOC.addEventListener('witness:worldtab', function (e) { if (e.detail && e.detail.name === 'lines') onShow(); });
  DOC.addEventListener('witness:refreshed', function () { if (loaded && !DOC.querySelector('#lines').hidden) load(); });
  if (!tab || !DOC.querySelector('#lines').hidden) onShow();
  var t0 = 0;
  addEventListener('resize', function () { clearTimeout(t0); t0 = setTimeout(function () { if (data && !DOC.querySelector('#lines').hidden) render(); }, 150); });
})();
