// app.js · Underdog "Your New York" clickable prototype.
// Everything here runs on fake, in-memory data. No network calls, nothing is stored except UI preferences.
// city.js (three.js) is loaded lazily and optionally: if WebGL or the module fails, the flat SVG skyline stays.

/* ====================================================================== helpers */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (n, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="icons.svg#i-${n}"/></svg>`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const later = (ms, fn) => setTimeout(fn, ms);
const store = {
  get(k) { try { return localStorage.getItem('witness.proto.' + k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('witness.proto.' + k); else localStorage.setItem('witness.proto.' + k, v); } catch { /* private mode */ } },
};
const nf = new Intl.NumberFormat('en-US');
const fmtMin = (m) => { m = Math.max(0, Math.round(m)); return m >= 60 ? (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`) : `${m}m`; };
const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');
const DAY3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYFULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const wkIdx = (d) => (d.getDay() + 6) % 7;
const fmtDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/* ====================================================================== content tables */
const CAT = {
  'Python':     { name: 'Python', label: 'Python', icon: 'terminal', hex: 0x5aa9ff, v: '--c-python', chip: 'c-python', lc: 'lc-python', deep: true, landmark: 'Bridge', nodes: ['Hello Loop', 'Data Wrangler', 'NumPy Native', 'Library Builder', 'Ship It'] },
  'Math':       { name: 'Math', label: 'Math', icon: 'sigma', hex: 0xa99bff, v: '--c-math', chip: 'c-math', lc: 'lc-math', deep: true, landmark: 'Brick tower', nodes: ['Vector Basics', 'Matrix Moves', 'Calculus Core', 'Probability Pulse', 'Proof Sketcher'] },
  'ML/DL':      { name: 'ML/DL', label: 'ML/DL', icon: 'brain', hex: 0x46e0a0, v: '--c-ml', chip: 'c-ml', lc: 'lc-ml', deep: true, landmark: 'Spire', nodes: ['First Model', 'Training Loop', 'Backprop by Hand', 'Architecture Tinkerer', 'Reproduced Result'] },
  'Papers':     { name: 'Papers', label: 'Papers', icon: 'book-open', hex: 0xff8a6b, v: '--c-papers', chip: 'c-papers', lc: 'lc-papers', deep: true, landmark: 'Domed library', nodes: ['First Read', 'Summary Post', 'Annotated Paper', 'Reproduction', 'Original Idea'] },
  'Writing/X':  { name: 'Writing/X', label: 'Writing/X', icon: 'pen-line', hex: 0xf58ae0, v: '--c-writing', chip: 'c-writing', lc: 'lc-writing', deep: true, landmark: 'Billboard tower', nodes: ['First Post', 'Small Series', 'Steady Voice', 'Long-form', 'Public Portfolio'] },
  'Rest':       { name: 'Rest', label: 'Rest hour', icon: 'tent-tree', hex: 0xb5aaff, v: '--rest', chip: 'c-rest', deep: false },
  'Distracted': { name: 'Distracted', label: 'Drift', icon: 'smartphone', hex: 0xc9b8a8, v: '--c-drift', chip: 'c-drift', deep: false },
  'Unknown':    { name: 'Unknown', label: "Don't remember", icon: 'circle-help', hex: 0xcfd3ee, v: '--faint', chip: 'c-drift', deep: false },
};
const LADDER = ['Python', 'Math', 'ML/DL', 'Papers', 'Writing/X'];
const CHIP_CATS = [...LADDER, 'Rest', 'Distracted'];
const TIMES = [[15, '15m'], [30, '30m'], [45, '45m'], [60, '1h'], [90, '1h 30m']];
const NODE_REQ = [[1, 0, 0], [3, 5, 0], [6, 15, 0], [10, 40, 1], [15, 80, 3]];   // outputs, deep hours, linked outputs
const DISTRICTS = [[1, 3, 'JFK Arrivals', 'plane'], [4, 6, 'Queens', 'map-pin'], [7, 10, 'Brooklyn', 'building-2'], [11, 15, 'Midtown', 'sparkles'],
  [16, 20, 'Washington Square', 'landmark'], [21, 26, 'Morningside', 'book-open'], [27, 999, 'Princeton', 'trophy']];
const districtOf = (L) => DISTRICTS.find((d) => L >= d[0] && L <= d[1]);
const cumXP = (L) => 150 * (L - 1) + 25 * L * (L - 1);
function levelFor(xp) { let L = 1; while (cumXP(L + 1) <= xp) L++; return { L, into: xp - cumXP(L), need: cumXP(L + 1) - cumXP(L), district: districtOf(L) }; }

const ACH = [
  { k: 'first_light', t: 'Easy', n: 'First Light', r: 'First entry ever.', i: 'sparkles', seed: true },
  { k: 'first_floor', t: 'Easy', n: 'Doors Open', r: 'First floor day.', i: 'check', seed: true },
  { k: 'first_ship', t: 'Easy', n: 'First Ship', r: 'First output.', i: 'trophy', seed: true },
  { k: 'first_close', t: 'Easy', n: 'Lights Out', r: 'First closed day.', i: 'moon', seed: true },
  { k: 'five_ships', t: 'Mid', n: 'Portfolio Started', r: '5 outputs in total.', i: 'layers', seed: true },
  { k: 'honest_hour', t: 'Easy', n: 'Honest Hour', r: 'First entry in Distracted, Rest or Unknown.', i: 'shield-check' },
  { k: 'first_focus', t: 'Easy', n: 'In the Zone', r: 'First focus session logged.', i: 'timer' },
  { k: 'linked_ship', t: 'Mid', n: 'Receipts', r: 'First output with a link.', i: 'send' },
  { k: 'clear_skies', t: 'Mid', n: 'Clear Skies', r: '3 quest stars in one day.', i: 'sun' },
  { k: 'early_floor', t: 'Mid', n: 'Early Doors', r: 'Floor met before 12:00 local.', i: 'zap' },
  { k: 'all_five', t: 'Mid', n: 'Five Ladders', r: 'At least one output in each of the 5 ladders.', i: 'landmark' },
  { k: 'fog_lifter', t: 'Mid', n: 'Fog Lifter', r: 'Resolve 10 foggy hours at Close.', i: 'cloud-fog' },
  { k: 'week_kept', t: 'Mid', n: 'Card Complete', r: 'First kept week.', i: 'calendar-check' },
  { k: 'first_comeback', t: 'Rare', n: 'Crane Day', r: 'First comeback day.', i: 'building-2' },
];

/* ====================================================================== the line parser */
const KW = {};
[
  ['Distracted', 'youtube yt reddit instagram insta tiktok netflix scroll scrolling doomscroll doomscrolling twitter games gaming game distracted drift drifted drifting phone discord memes shorts news'],
  ['Rest', 'rest nap walk lunch dinner breakfast gym break sleep shower chill eat food coffee relax'],
  ['Unknown', 'unknown idk unsure'],
  ['Python', 'python py numpy pandas matplotlib scipy pytest fastapi script scripting coding code notebook jupyter leetcode'],
  ['ML/DL', 'ml dl pytorch torch tensorflow neural nn backprop transformer transformers cs229 cs231n karpathy llm training gradient attention'],
  ['Math', 'math maths la algebra calculus calc proof proofs probability prob stats statistics vector vectors matrix matrices strang linear'],
  ['Papers', 'paper papers arxiv read reading abstract'],
  ['Writing/X', 'write writing post thread tweet blog essay x'],
].forEach(([cat, words]) => words.split(' ').forEach((w) => { if (!(w in KW)) KW[w] = cat; }));
const RX_H = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)(?![a-z])(?:\s*(\d{1,2})(?:\s*(?:minutes?|mins?|m)(?![a-z]))?)?/i;
const RX_M = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)(?![a-z])/i;
function parseLine(raw) {
  let rest = raw, min = null, m;
  if ((m = RX_H.exec(rest))) { min = Math.round(parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0)); rest = rest.replace(m[0], ' '); }
  else if ((m = RX_M.exec(rest))) { min = Math.round(parseFloat(m[1])); rest = rest.replace(m[0], ' '); }
  if (min !== null && (min < 1 || !isFinite(min))) min = null;
  if (min !== null && min > 600) min = 600;
  let cat = null;
  for (const tok of raw.toLowerCase().split(/[^a-z0-9/]+/)) { if (tok && KW[tok]) { cat = KW[tok]; break; } }
  return { min, cat, text: rest.replace(/\s+/g, ' ').trim() };
}

/* ====================================================================== state (fake, in memory) */
let S = null;
const today = () => S.days[S.tIdx];
function seed() {
  const now = new Date(), T = wkIdx(now), tIdx = 21 + T;
  const W = [[60, 'R', 95, 120, 45, 200, 0], [100, 80, 70, 'R', 130, 185, 150], [90, 110, 0, 35, 95, 60, 120]];
  const CUR = [0, 45, 120, 'R', 62, 90];
  const days = [];
  for (let i = 0; i < 28; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (i - tIdx));
    const wk = Math.floor(i / 7), di = i % 7;
    const v = wk < 3 ? W[wk][di] : di < T ? CUR[di] : di === T ? 25 : null;
    const d = { i, date, deep: 0, rest: false, future: false, lamps: [], outs: [] };
    if (v === null) d.future = true; else if (v === 'R') d.rest = true; else d.deep = v;
    if (!d.future && !d.rest && i < tIdx) { const r = (i * 7) % 5; if (r % 2 === 0) d.lamps.push(r === 0 ? CAT.Distracted.hex : CAT.Rest.hex); }
    days.push(d);
  }
  const out = (i, ladder, what) => { if (days[i] && !days[i].future) days[i].outs.push({ ladder, what, link: false }); };
  out(3, 'Python', 'list comprehension kata'); out(5, 'Math', 'matrix multiplication notes'); out(11, 'Python', 'pandas groupby notebook'); out(12, 'ML/DL', 'perceptron from scratch');
  out(13, 'Math', 'eigenvalues sketch'); out(15, 'Python', 'cli todo script'); out(18, 'Papers', 'summary of Attention Is All You Need');
  if (T > 2) out(23, 'Python', 'numpy broadcasting notebook'); else if (T > 1) out(22, 'Python', 'numpy broadcasting notebook');
  const mk = (id, cat, min, text, ago) => ({ id, cat, min, text, at: Date.now() - ago * 60000 });
  const st = {
    days, T, tIdx, target: 90, floor: 30, xp: 2120, sealed: false, weekKept: false,
    ladder: { 'Python': { out: 4, hours: 22, linked: 0 }, 'Math': { out: 2, hours: 9, linked: 0 }, 'ML/DL': { out: 1, hours: 6, linked: 0 }, 'Papers': { out: 1, hours: 3, linked: 0 }, 'Writing/X': { out: 0, hours: 1, linked: 0 } },
    totals: { deepMin: 41 * 60, daysShown: 63, outputs: 8, weeksKept: 2, comebacks: 3, bestRun: 11 },
    entries: [mk(1, 'Python', 25, 'numpy broadcasting', 75)],
    recent: [
      { cat: 'Python', min: 45, text: 'numpy ex 1-12' },
      { cat: 'Math', min: 60, text: 'LA 2.1' },
      { cat: 'Python', min: 25, text: 'numpy broadcasting' },
    ],
    wins: [], ach: {}, achNew: new Set(), bursts: 0, ships: 0,
    gaps: [
      { id: 1, label: 'Earlier · 1:00 to 2:00 PM', min: 60, guess: 'Python', src: 'VS Code, Terminal', done: false },
      { id: 2, label: 'Earlier · 4:15 to 5:00 PM', min: 45, guess: 'Distracted', src: 'YouTube in Safari', done: false },
      { id: 3, label: 'Earlier · 6:30 to 7:00 PM', min: 30, guess: 'Math', src: 'Preview, Notes', done: false },
    ],
    fogResolved: 8, q3: null, qDone: [false, false, false], stars: 0,
  };
  st.floorXP = days[tIdx].deep >= 30; st.crownXP = days[tIdx].deep >= st.target;
  ACH.forEach((a) => { st.ach[a.k] = !!a.seed; });
  const dn = (i) => DAYFULL[days[i].date.getDay() === 0 ? 6 : days[i].date.getDay() - 1];
  const ago = (d) => Date.now() - d * 86400000;
  st.wins.push({ icon: 'terminal', cc: '--c-python', text: '25m numpy broadcasting', at: Date.now() - 75 * 60000 });
  for (let i = 21; i < st.tIdx; i++) {
    const d = days[i];
    if (d.outs.length) st.wins.push({ icon: 'trophy', cc: '--amber-ink', text: 'Output 1 of 2 this week', at: ago(st.tIdx - i) });
    if (d.deep >= st.target) st.wins.push({ icon: 'target', cc: '--amber-ink', text: `Crown lit on a ${dn(i)}`, at: ago(st.tIdx - i) });
  }
  if (T > 1) st.wins.push({ icon: 'check', cc: '--mint', text: 'Back on. First floor day since Monday', at: ago(T - 1) });
  st.wins.push({ icon: 'sparkles', cc: '--violet', text: 'Longest session since you started: 2h 10m', at: ago(6) });
  st.wins.sort((a, b) => b.at - a.at);
  st.q3 = (wkOuts(st) < 2 && (6 - T) <= 3) ? 'ship' : new Date().getHours() >= 22 ? 'close' : 'second';
  return st;
}
const wkOuts = (st = S) => st.days.slice(21).reduce((n, d) => n + d.outs.length, 0);
const wkFloorDays = (st = S) => st.days.slice(21).filter((d) => !d.future && d.deep >= 30).length;
const wkRest = (st = S) => st.days.slice(21).filter((d) => d.rest).length;
const doorsOf = (d) => d.deep >= 30 || d.outs.length > 0;
const crownOf = (d) => d.deep >= S.target;
function statusOf(d) {
  if (d.future) return 'future';
  if (d.i === S.tIdx) {
    if (d.rest && d.deep === 0 && !doorsOf(d)) return 'rest';
    return crownOf(d) ? 'target' : doorsOf(d) ? 'floor' : 'open';
  }
  if (d.rest) return 'rest';
  if (crownOf(d)) return 'target';
  if (doorsOf(d)) return 'floor';
  return d.deep > 0 ? 'started' : 'missed';
}
const STATUS_TXT = { target: 'Crown lit', floor: 'Doors open', rest: 'Rest day', missed: 'Empty lot, waiting', started: 'Started', open: 'In progress', future: 'Not yet' };
const STATUS_ICON = { target: 'target', floor: 'check', rest: 'tent-tree', missed: 'layers', started: 'sparkles', open: 'pen-line', future: 'calendar-check' };
function calcRun() {
  let run = 0;
  for (let i = S.tIdx - 1; i >= 0; i--) { const s = statusOf(S.days[i]); if (s === 'target' || s === 'floor' || s === 'rest') run++; else break; }
  const t = today(); if (doorsOf(t) || t.rest) run++;
  return run;
}
function sections(c) { const L = S.ladder[c]; let n = 0; for (const [o, h, l] of NODE_REQ) { if (L.out >= o && L.hours >= h && L.linked >= l) n++; else break; } return n; }
const snap = () => { const t = today(); return { deep: t.deep, floors: Math.min(16, Math.floor(t.deep / 15)), doors: doorsOf(t), crown: crownOf(t), nodes: Object.fromEntries(LADDER.map((c) => [c, sections(c)])) }; };

/* ====================================================================== prefs, motion, quiet */
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const prefs = { motionOff: store.get('motion') === 'off', sound: store.get('sound') === '1', quiet: store.get('quiet') === '1', three: store.get('three') !== '0', ny: store.get('ny') === '1' };
const reduced = () => mqReduce.matches || prefs.motionOff;
const quiet = () => prefs.quiet;
const root = document.documentElement;

/* ====================================================================== sound (tiny Web Audio blips, off by default) */
let ac = null;
function audio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function blip(freq, at, dur, type = 'sine', gain = 0.05, slideTo = 0) {
  const c = audio(); if (!c) return;
  const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
}
const SFX = {
  tick() { blip(660, 0, 0.07, 'sine', 0.05); },
  ping() { blip(880, 0, 0.1, 'sine', 0.05); blip(1320, 0.09, 0.16, 'sine', 0.045); },
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.09, 0.18, 'triangle', 0.05)); },
  thunk() { blip(150, 0, 0.2, 'sine', 0.12, 55); },
};
const sfx = (n) => { if (prefs.sound) { try { SFX[n](); } catch { /* audio blocked */ } } };

/* ====================================================================== tween + small fx */
function tween(el, to, fmt, ms = 700) {
  const from = el.dataset.v === undefined ? to : +el.dataset.v;
  el.dataset.v = to;
  if (el._raf) cancelAnimationFrame(el._raf);
  if (el._to) clearTimeout(el._to);
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const f = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); el._raf = k < 1 ? requestAnimationFrame(f) : 0; };
  el._raf = requestAnimationFrame(f);
  el._to = later(ms + 120, () => { el.textContent = fmt(to); });
}
function popEl(el, cls = 'pop') {
  if (!el || reduced()) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  later(900, () => el.classList.remove(cls));
}
function floaty(text, el) {
  if (reduced() || quiet() || !el) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const f = document.createElement('div'); f.className = 'floaty'; f.textContent = text;
  f.style.left = r.left + r.width / 2 + 'px'; f.style.top = r.top + 4 + 'px';
  document.body.appendChild(f); later(1200, () => f.remove());
}
function toast({ icon = 'check', tone = '', title, sub = '', ms = 4200 }) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (tone ? ' toast--' + tone : '');
  el.innerHTML = `${ico(icon)}<div>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  later(ms, () => { el.classList.add('is-leaving'); later(260, () => el.remove()); });
}
let confettiFn = null;
function initConfetti() {
  if (typeof window.confetti !== 'function') return;
  const cv = document.createElement('canvas'); cv.className = 'confetti-canvas'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv);
  try { confettiFn = window.confetti.create(cv, { resize: true, useWorker: false }); } catch { confettiFn = null; }
}
const originOf = (el, dy = 0.5) => { if (!el) return { x: 0.5, y: 0.5 }; const r = el.getBoundingClientRect(); return { x: clamp((r.left + r.width / 2) / innerWidth, 0, 1), y: clamp((r.top + r.height * dy) / innerHeight, 0, 1) }; };
const PAL = { amber: '#FFB224', cream: '#FFF7E8', violet: '#9A8CFF', mint: '#46E0A0', gold: '#FFD98A' };
function burst(kind, el, extra = {}) {
  if (!confettiFn || reduced() || quiet()) return;
  const always = kind === 'comeback' || kind === 'district' || kind === 'week';
  if (!always) { if (S.bursts >= 3) return; S.bursts++; }       // at most 3 ordinary bursts a day
  const origin = originOf(el);
  const base = { origin, zIndex: 60, disableForReducedMotion: true, ticks: 160 };
  const presets = {
    floor: { particleCount: 12, spread: 55, startVelocity: 22, scalar: 0.8, colors: [PAL.mint, PAL.violet, PAL.cream] },
    crown: { particleCount: 40, spread: 85, startVelocity: 34, colors: [PAL.amber, PAL.cream, PAL.gold] },
    output: { particleCount: 60, spread: 100, startVelocity: 38, colors: [PAL.amber, PAL.cream, ...(extra.colors || [])] },
    comeback: { particleCount: 90, spread: 120, startVelocity: 40, ticks: 240, colors: [PAL.amber, PAL.cream, PAL.gold, '#FF8A6B'] },
    week: { particleCount: 70, spread: 110, startVelocity: 36, colors: [PAL.amber, PAL.mint, PAL.cream, PAL.violet] },
    district: { particleCount: 120, spread: 160, startVelocity: 30, gravity: 0.7, ticks: 320, scalar: 1.1, shapes: ['square'], colors: [PAL.amber, PAL.cream, PAL.violet, PAL.mint] },
    small: { particleCount: 18, spread: 60, startVelocity: 26, scalar: 0.8, colors: [PAL.amber, PAL.cream] },
  };
  try { confettiFn({ ...base, ...(presets[kind] || presets.small) }); } catch { /* canvas unavailable */ }
}
let momentEl = null, momentReturn = null;
function closeMoment() { if (!momentEl) return; momentEl.remove(); momentEl = null; if (momentReturn && document.contains(momentReturn)) momentReturn.focus({ preventScroll: true }); momentReturn = null; }
function showMoment({ icon, title, text, cta = 'Keep building' }) {
  closeMoment(); momentReturn = document.activeElement;
  const el = document.createElement('div'); el.className = 'moment'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'momentH');
  el.innerHTML = `<div class="moment__card"><div class="moment__icon">${ico(icon)}</div><h2 id="momentH">${esc(title)}</h2><p>${esc(text)}</p><button class="btn" type="button" id="momentOk">${esc(cta)}</button></div>`;
  document.body.appendChild(el); momentEl = el;
  $('momentOk').addEventListener('click', closeMoment);
  el.addEventListener('click', (e) => { if (e.target === el) closeMoment(); });
  $('momentOk').focus({ preventScroll: true });
}

/* ====================================================================== 3D scenes (optional) */
let cityMod = null, week = null, city = null;
const hourLocal = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
function hourNY() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
  return (+p.find((x) => x.type === 'hour').value % 24) + (+p.find((x) => x.type === 'minute').value) / 60;
}
const hourFn = () => (prefs.ny ? hourNY() : hourLocal());
function cityDay(d) {
  const st = statusOf(d), t = d.i === S.tIdx;
  return {
    floors: d.future ? 0 : Math.min(16, Math.floor(d.deep / 15)), targetFloor: Math.round(S.target / 15), status: st,
    doors: !d.future && doorsOf(d), crown: !d.future && crownOf(d), lamps: d.lamps.slice(), beacons: d.outs.map((o) => CAT[o.ladder].hex), isToday: t,
  };
}
function pushScenes(animate = true) {
  const lm = LADDER.map((l) => ({ ladder: l, sections: sections(l) }));
  try { week?.setDays(S.days.slice(21).map(cityDay), { animate }); week?.setLandmarks(lm, { animate }); } catch (e) { console.warn('week scene', e); }
  try { city?.setDays(S.days.map(cityDay), { animate }); city?.setLandmarks(lm, { animate }); } catch (e) { console.warn('city scene', e); }
}
function syncPause() {
  const p = document.hidden || !prefs.three;
  week?.pause(p); city?.pause(p);
}
function applyThree() {
  for (const id of ['stageWeek', 'stageCity']) $(id).classList.toggle('use-svg', !prefs.three);
  syncPause();
  if (prefs.three) ensureScenes();
}
let loadP = null;
function loadMod() {
  if (!loadP) loadP = import('./city.js').then((m) => { cityMod = m; return m; }).catch((e) => { console.warn('3D unavailable, keeping the flat skyline', e); $('stageWeek').classList.add('no-webgl'); $('stageCity').classList.add('no-webgl'); return null; });
  return loadP;
}
async function ensureScenes() {
  if (!prefs.three) return;
  if (!(await loadMod())) return;
  if (!week) {
    try { week = cityMod.createCity($('stageWeek'), { mode: 'week', hour: hourFn, motion: !reduced(), onPick: (i) => pickDay(i, 'week') }); } catch (e) { console.warn(e); week = null; }
    if (!week) $('stageWeek').classList.add('no-webgl'); else pushScenes(true);
  }
  if (!city && currentView === 'world' && worldMode === 'city') {
    try { city = cityMod.createCity($('stageCity'), { mode: 'city', hour: hourFn, motion: !reduced(), onPick: (i) => pickDay(i, 'city') }); } catch (e) { console.warn(e); city = null; }
    if (!city) $('stageCity').classList.add('no-webgl'); else pushScenes(true);
  }
  syncPause();
}

/* ====================================================================== flat skyline fallback (always rendered, shown when 3D is off) */
function skylineSVG(list, rows) {
  const cols = 7; let g = '';
  if (rows === 1) {
    g += '<rect class="gr" x="0" y="196" width="420" height="24"/>';
    list.forEach((d, i) => {
      const x = 22 + i * 57, s = statusOf(d), fl = d.future ? 0 : Math.min(16, Math.floor(d.deep / 15)), h = Math.max(6, fl * 10), y = 196 - h;
      const cls = s === 'target' ? 'b t' : s === 'floor' ? 'b f' : 'b';
      g += `<rect class="${cls}" x="${x}" y="${y}" width="42" height="${h}" rx="4"${d.i === S.tIdx ? ' style="stroke:#ffb224;stroke-width:3"' : ''}/>`;
      for (let f = 0; f < fl; f++) { g += `<rect class="win lit" x="${x + 8}" y="${196 - f * 10 - 8}" width="8" height="5" rx="1.5"/><rect class="win lit" x="${x + 26}" y="${196 - f * 10 - 8}" width="8" height="5" rx="1.5"/>`; }
      if (s === 'rest') g += `<circle cx="${x + 21}" cy="186" r="7" fill="#b5aaff"/>`;
      if (d.outs.length) g += `<circle cx="${x + 21}" cy="${y - 8}" r="5" fill="${hexStr(CAT[d.outs[0].ladder].hex)}"/>`;
    });
    return `<svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMax meet" focusable="false">${g}</svg>`;
  }
  for (let r = 0; r < rows; r++) {
    const y0 = 84 + r * 66; g += `<rect class="gr" x="0" y="${y0}" width="420" height="5" opacity="${0.4 + r * 0.2}"/>`;
    for (let c = 0; c < cols; c++) {
      const d = list[r * cols + c]; if (!d) continue;
      const x = 22 + c * 57, s = statusOf(d), fl = d.future ? 0 : Math.min(16, Math.floor(d.deep / 15)), h = Math.max(4, fl * 3.8);
      const cls = s === 'target' ? 'b t' : s === 'floor' ? 'b f' : 'b';
      g += `<rect class="${cls}" x="${x}" y="${y0 - h}" width="40" height="${h}" rx="3" opacity="${0.55 + r * 0.15}"${d.i === S.tIdx ? ' style="stroke:#ffb224;stroke-width:3"' : ''}/>`;
    }
  }
  return `<svg viewBox="0 0 420 300" preserveAspectRatio="xMidYMax meet" focusable="false">${g}</svg>`;
}

/* ====================================================================== day picking + day cards */
let pickedWeek = -1;
function dayInfoText(d) {
  const s = statusOf(d), bits = [d.future ? 'Not yet' : `${fmtMin(d.deep)} deep`];
  if (!d.future) { bits.push(d.outs.length ? `${d.outs.length} output${d.outs.length > 1 ? 's' : ''}` : 'no outputs'); bits.push(STATUS_TXT[s]); }
  return bits.join(' · ');
}
function showDayCard(el, d) {
  if (!d) { el.hidden = true; return; }
  el.hidden = false; el.innerHTML = `<b>${esc(fmtDate(d.date))}</b><p>${esc(dayInfoText(d))}</p><button type="button" aria-label="Close day card">${ico('x')}</button>`;
  el.querySelector('button').addEventListener('click', () => { if (el.id === 'dayCardWeek') { pickedWeek = -1; week?.pick(-1); } else city?.pick(-1); el.hidden = true; renderDays(); });
}
function pickDay(i, where) {
  if (where === 'week') { pickedWeek = i; showDayCard($('dayCardWeek'), i >= 0 ? S.days[21 + i] : null); renderDays(); }
  else showDayCard($('dayCardCity'), i >= 0 ? S.days[i] : null);
}
function renderDays() {
  const box = $('dayBtns');
  box.innerHTML = S.days.slice(21).map((d, k) => {
    const s = statusOf(d);
    return `<button class="daybtn${d.i === S.tIdx ? ' is-today' : ''}" type="button" data-k="${k}" data-st="${s}" aria-pressed="${pickedWeek === k}" aria-label="${esc(DAYFULL[k])}: ${esc(dayInfoText(d))}"><span>${DAY3[k]}</span>${ico(STATUS_ICON[s])}<span class="num">${d.future ? '' : fmtMin(d.deep).replace(' ', '')}</span></button>`;
  }).join('');
  $('fallbackWeek').innerHTML = skylineSVG(S.days.slice(21), 1);
  $('fallbackCity').innerHTML = skylineSVG(S.days, 4);
  if (!$('dayCardWeek').hidden && pickedWeek >= 0) showDayCard($('dayCardWeek'), S.days[21 + pickedWeek]);
}
$('dayBtns').addEventListener('click', (e) => {
  const b = e.target.closest('.daybtn'); if (!b) return;
  const k = +b.dataset.k;
  if (pickedWeek === k) { if (week) week.pick(-1); pickDay(-1, 'week'); return; }
  if (week) { week.pick(k); week.focusDay(k); } else pickDay(k, 'week');
  pickedWeek = k; renderDays();
});

/* ====================================================================== render: ring, level, quests, wins */
function renderRing(opts = {}) {
  const t = today(), deep = t.deep, doors = doorsOf(t), crown = crownOf(t);
  $('arcIn').style.setProperty('--p', doors ? 100 : clamp((deep / S.floor) * 100, 0, 100));
  $('arcOut').style.setProperty('--p', clamp((deep / S.target) * 100, 0, 100));
  $('arcIn').classList.toggle('is-done', doors); $('arcOut').classList.toggle('is-done', crown);
  tween($('deepNum'), deep, fmtMin);
  $('deepNum').classList.toggle('long', fmtMin(deep).length > 4);
  const gm = S.days[S.tIdx - 7]?.deep || 0;
  $('ghostG').setAttribute('transform', `rotate(${(clamp(gm / S.target, 0, 1) * 360 - 270).toFixed(1)} 80 80)`);
  $('ghostG').style.display = gm > 0 ? '' : 'none';
  $('ghostTxt').textContent = gm > 0 ? `Last week, same day: ${fmtMin(gm)}` : 'Last week, same day: nothing logged';
  $('floorMin').textContent = S.floor; $('targetMin').textContent = S.target;
  $('floorOk').hidden = !doors; $('targetOk').hidden = !crown;
  let lead;
  if (t.rest && deep === 0 && !doors) lead = 'Rest day. Doors stay open if you want them.';
  else if (!doors) lead = `Doors in ${S.floor - deep}m.`;
  else if (!crown) lead = `Doors open. Crown in ${fmtMin(S.target - deep)}.`;
  else lead = 'Crown lit. Anything extra is shown but not counted.';
  $('ringLead').textContent = lead;
  const over = deep - 240; $('capNote').hidden = over <= 0; if (over > 0) $('capNote').textContent = `+${over}m, past the cap. Shown, never counted.`;
  const fl = Math.min(16, Math.floor(deep / 15));
  $('floorsNum').textContent = fl; $('floorsLbl').textContent = fl === 1 ? ' floor today' : ' floors today';
  if (opts.pop) popEl($('ringWrap'), 'pop-ring');
  if (opts.floorsPop) popEl($('floorsPill'));
  const run = calcRun(), old = +$('runNum').textContent;
  $('runNum').textContent = run; 
  if (run > old) popEl($('runPill'));
}
function renderLevel(opts = {}) {
  const lv = levelFor(S.xp), pct = lv.into / lv.need;
  $('lvlName').textContent = `Level ${lv.L} · ${lv.district[2]}`;
  tween($('xpNum'), S.xp, (n) => nf.format(n), 900);
  $('xpTo').textContent = `${nf.format(lv.need - lv.into)} to Level ${lv.L + 1}`;
  $('xpFill').style.setProperty('--p', pct.toFixed(4));
  $('xpBar').setAttribute('aria-valuenow', Math.round(pct * 100));
  $('distIcon').querySelector('use').setAttribute('href', `icons.svg#i-${lv.district[3]}`);
  if (opts.shine) { const f = $('xpFill'); f.classList.remove('shine'); void f.offsetWidth; f.classList.add('shine'); }
  if (opts.badge) popEl(document.querySelector('.level__badge'));
}
function questList() {
  const t = today(), doors = doorsOf(t), crown = crownOf(t);
  const q3 = { ship: { t: 'Ship one small thing', s: 'A note, a commit or a post counts', done: wkOuts() >= 2 }, close: { t: 'Close the day', s: 'Fill the gaps, then seal', done: S.sealed }, second: { t: 'Add a line to your wins', s: 'Log a second hour', done: S.entries.length >= 2 } }[S.q3];
  return [
    { t: 'First light', s: 'Log one hour of anything, rest and drift count', done: S.entries.length > 0 },
    doors ? { t: 'Light the crown', s: crown ? 'Crown lit' : `${fmtMin(S.target - t.deep)} to go`, done: crown } : { t: 'Open the doors', s: `${S.floor} min or one output opens them`, done: false },
    q3,
  ];
}
function renderQuests() {
  const qs = questList(), prev = S.qDone.slice();
  $('quests').innerHTML = qs.map((q, i) => `<li class="quest${q.done ? ' is-done' : ''}"><span class="quest__box">${ico('check')}</span><span class="quest__t">${esc(q.t)}<small>${esc(q.s)}</small></span></li>`).join('');
  const n = qs.filter((q) => q.done).length;
  $('stars').setAttribute('aria-label', `${n} of 3 quest stars`);
  $('stars').innerHTML = qs.map((q) => `<svg class="ic${q.done ? ' on' : ''}" aria-hidden="true"><use href="icons.svg#i-star"/></svg>`).join('');
  qs.forEach((q, i) => { if (q.done && !prev[i] && !reduced()) { const box = $('quests').children[i]?.querySelector('.quest__box'); popEl(box); } S.qDone[i] = q.done; });
  if (n === 3 && S.stars < 3) { S.stars = 3; unlock('clear_skies'); }
  S.stars = Math.max(S.stars, n);
}
function whenTxt(at) {
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 20) return `${h}h ago`;
  const d = Math.round(m / 1440); return d <= 1 ? 'yesterday' : `${d} days ago`;
}
function addWin(icon, cc, text, extra = '') {
  S.wins.unshift({ icon, cc, text, extra, at: Date.now(), fresh: true });
  renderWins();
}
function renderWins() {
  $('wins').innerHTML = S.wins.slice(0, 5).map((w) => `<li class="win${w.fresh ? ' is-new' : ''}">${ico(w.icon).replace('class="ic"', `class="ic" style="--cc:var(${w.cc})"`)}<span>${esc(w.text)}<small>${esc(w.extra ? w.extra + ' · ' : '')}${esc(whenTxt(w.at))}</small></span></li>`).join('');
  S.wins.forEach((w) => { w.fresh = false; });
}

/* ====================================================================== render: log card (chips, preview, button) */
const sel = { min: null, cat: null };
let lastText = '';
function buildChips() {
  $('timeChips').innerHTML = TIMES.map(([v, l]) => `<label class="chip chip--time"><input type="radio" name="dur" value="${v}"><span>${l}</span></label>`).join('');
  $('catChips').innerHTML = CHIP_CATS.map((c) => `<label class="chip chip--${CAT[c].chip}"><input type="radio" name="cat" value="${esc(c)}"><span>${ico(CAT[c].icon)}${esc(CAT[c].label)}</span></label>`).join('');
  $('shipStage').innerHTML = LADDER.map((c, i) => `<label class="chip chip--${CAT[c].chip}"><input type="radio" name="shipst" value="${esc(c)}"${i === 0 ? ' checked' : ''}><span>${ico(CAT[c].icon)}${esc(c)}</span></label>`).join('');
}
function syncChips() {
  document.querySelectorAll('#timeChips input').forEach((i) => { i.checked = +i.value === sel.min; });
  document.querySelectorAll('#catChips input').forEach((i) => { i.checked = i.value === sel.cat; });
}
function renderRepeat() {
  $('repeatChips').innerHTML = S.recent.slice(0, 3).map((r, i) => `<button class="chipbtn" type="button" data-r="${i}">${ico('rotate-ccw')}<span>${esc(fmtMin(r.min))} ${esc(r.text || CAT[r.cat].label)}</span><small>${esc(CAT[r.cat].label)}</small></button>`).join('')
    || '<span class="small muted">Your last three logs show up here.</span>';
}
function renderPreview() {
  const { min, cat } = sel, text = parseLine($('logText').value).text, c = cat && CAT[cat];
  const ready = !!(min && cat), t = today();
  let tags = '';
  if (min) tags += `<span class="tag">${ico('timer')}${esc(fmtMin(min))}</span>`;
  if (c) tags += `<span class="tag tag--cat" style="color:var(${c.v})">${ico(c.icon)}<span>${esc(cat === 'Distracted' ? 'Distracted' : c.label)}</span></span>`;
  let hint;
  if (!min && !cat && !text) hint = 'Type a line, or tap a length and a kind of hour.';
  else if (!min) hint = text ? `${esc(text)} · How long? Try 45m.` : 'How long was it?';
  else if (!cat) hint = text ? `${esc(text)} · What kind of hour was it?` : 'What kind of hour was it?';
  else if (c.deep) { const nf2 = Math.floor(clamp(t.deep + min, 0, 16 * 15) / 15) - Math.floor(Math.min(t.deep, 240) / 15); hint = `${text ? esc(text) + ' · ' : ''}${nf2 > 0 ? `Adds ${nf2} floor${nf2 > 1 ? 's' : ''}.` : 'Builds toward the next floor.'}`; }
  else hint = `${text ? esc(text) + ' · ' : ''}No XP for this one. It adds a lamp to your street.`;
  $('preview').innerHTML = tags + `<span class="hint">${hint}</span>`;
  const btn = $('logBtn'); btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
  $('logBtnText').textContent = ready ? `Log ${fmtMin(min)} ${cat === 'Distracted' ? 'Distracted' : c.label}` : 'Log this hour';
}
function onTextInput() {
  const p = parseLine($('logText').value);
  if (p.min) sel.min = p.min;
  if (p.cat && p.cat !== 'Unknown') sel.cat = p.cat;
  else if (p.cat === 'Unknown') sel.cat = 'Unknown';
  syncChips(); renderPreview();
}
function clearInput() {
  $('logText').value = ''; sel.min = null; sel.cat = null; syncChips(); renderPreview();
  if (matchMedia('(pointer:fine)').matches) $('logText').focus({ preventScroll: true });
}
// let a checked radio chip be tapped again to clear it
let wasChecked = null;
for (const id of ['timeChips', 'catChips']) {
  const box = $(id);
  box.addEventListener('pointerdown', (e) => { const i = e.target.closest('input'); wasChecked = i && i.checked ? i : null; });
  box.addEventListener('keydown', () => { wasChecked = null; });
  box.addEventListener('click', (e) => {
    const i = e.target.closest('input'); if (!i) return;
    if (wasChecked === i) { i.checked = false; if (id === 'timeChips') sel.min = null; else sel.cat = null; }
    else if (id === 'timeChips') sel.min = +i.value; else sel.cat = i.value;
    wasChecked = null; renderPreview(); sfx('tick');
  });
}
$('logText').addEventListener('input', onTextInput);
$('logText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitLog(); } });
$('logBtn').addEventListener('click', submitLog);
$('repeatChips').addEventListener('click', (e) => {
  const b = e.target.closest('.chipbtn'); if (!b) return;
  const r = S.recent[+b.dataset.r]; if (!r) return;
  popEl(b); commitLog({ min: r.min, cat: r.cat, text: r.text, source: 'repeat' });
});
function submitLog() {
  const p = parseLine($('logText').value);
  if (p.min) sel.min = p.min;
  if (p.cat) sel.cat = p.cat;
  if (!sel.min || !sel.cat) {
    renderPreview();
    $('preview').querySelector('.hint').textContent = !sel.min && !sel.cat ? 'Add a length and a kind of hour, like 45m numpy.' : !sel.min ? 'How long was it? Try 45m, or tap a length.' : 'What kind of hour was it? Tap one below.';
    return;
  }
  commitLog({ min: sel.min, cat: sel.cat, text: p.text, source: 'log' });
  clearInput();
}

/* ====================================================================== the log: the one action that matters */
const fx = [];           // celebrations queued behind the receipt toast
function commitLog({ min, cat, text = '', source = 'log' }) {
  const c = CAT[cat], t = today(), before = snap(); let xp = 0; const ev = [];
  const entry = { id: S.entries.length + 2, cat, min, text, at: Date.now() };
  S.entries.unshift(entry);
  const key = (r) => `${r.cat}|${r.text}|${r.min}`;
  if (source !== 'backfill' && source !== 'lab' && source !== 'focus') S.recent = [{ cat, min, text }, ...S.recent.filter((r) => key(r) !== key({ cat, min, text }))].slice(0, 4);
  if (c.deep) {
    const old = Math.min(t.deep, 240); t.deep += min; const nw = Math.min(t.deep, 240);
    xp += Math.floor(nw / 4) - Math.floor(old / 4);
    S.ladder[cat].hours += min / 60; S.totals.deepMin += min;
    if (!S.floorXP && doorsOf(t)) { S.floorXP = true; xp += 10; ev.push('floor'); }
    if (!S.crownXP && crownOf(t)) { S.crownXP = true; xp += 15; ev.push('crown'); }
    if (ev.includes('floor')) {
      const prev = S.days[S.tIdx - 1];
      if (prev && statusOf(prev) === 'missed') { ev.push('comeback'); xp += 30; S.totals.comebacks++; }
      if (new Date().getHours() < 12) unlock('early_floor');
      unlock('first_floor');
    }
  } else {
    t.lamps.push(c.hex);
    unlock('honest_hour');
  }
  for (const l of LADDER) { const a = before.nodes[l], b = sections(l); if (b > a) { ev.push('node:' + l); xp += 50; } }
  if (!S.weekKept && wkFloorDays() >= 5 && wkOuts() >= 2) { S.weekKept = true; ev.push('week'); xp += 100; S.totals.weeksKept++; }
  finishAction({ entry, xp, ev, before, source });
}

function receipt(entry, xp, before) {
  const c = CAT[entry.cat], t = today();
  const floorsUp = Math.min(16, Math.floor(t.deep / 15)) - before.floors;
  if (c.deep) {
    const bits = []; if (xp > 0 && !quiet()) bits.push(`+${xp} XP`); if (floorsUp > 0) bits.push(`${floorsUp} floor${floorsUp > 1 ? 's' : ''} up`);
    toast({ icon: c.icon, title: `${fmtMin(entry.min)} ${c.label} logged. ${fmtMin(t.deep)} deep today.`, sub: bits.join(' · ') });
  } else if (entry.cat === 'Distracted') toast({ icon: 'smartphone', tone: 'violet', title: `${fmtMin(entry.min)} Distracted logged. The map is accurate.`, sub: 'A lamp joined your street. No penalty.' });
  else if (entry.cat === 'Rest') toast({ icon: 'tent-tree', tone: 'violet', title: `${fmtMin(entry.min)} rest logged. Rest is part of the map.`, sub: 'A lamp joined your street.' });
  else toast({ icon: 'cloud-fog', tone: 'violet', title: 'Unknown logged. You can fill it in at Close.', sub: 'A patch of fog waits on the lot.' });
}

function finishAction({ entry, xp, ev, before, source, ship }) {
  const t = today(), c = entry ? CAT[entry.cat] : null;
  if (ev.includes('floor')) S.totals.daysShown++;
  const lvBefore = levelFor(S.xp);
  S.xp += xp;
  const lvAfter = levelFor(S.xp);
  // 3D + panels update immediately (the "within a second" promise)
  pushScenes(true);
  renderRing({ pop: ev.includes('floor') || ev.includes('crown') || (entry && c.deep), floorsPop: Math.floor(t.deep / 15) > before.floors });
  renderLevel({ shine: xp > 0 && !quiet(), badge: lvAfter.L > lvBefore.L });
  renderQuests(); renderRepeat(); renderDays(); renderWorld();
  if (entry) {
    receipt(entry, xp, before);
    addWin(c.icon, c.v, `${fmtMin(entry.min)} ${entry.text || c.label}`, !entry.text ? '' : c.deep ? c.label : entry.cat === 'Distracted' ? 'honest hour' : 'honest log');
    sfx('tick');
    if (c.deep && xp > 0) floaty(`+${xp} XP`, $('logBtn'));
  }
  let delay = 420;
  const queue = (fn) => { later(delay, fn); delay += 520; };
  for (const e of ev) {
    if (e === 'floor') queue(() => { toast({ icon: 'check', tone: 'mint', title: `Doors open. ${fmtMin(t.deep)} deep today.` }); burst('floor', $('ringWrap')); sfx('ping'); });
    else if (e === 'crown') queue(() => { toast({ icon: 'target', title: `Crown lit. ${fmtMin(t.deep)} deep.`, sub: 'Anything extra is shown but not counted.' }); burst('crown', $('ringWrap'), {}); sfx('ping'); week?.pulse(S.T); });
    else if (e === 'comeback') queue(() => celebrate('comeback'));
    else if (e === 'week') queue(() => celebrate('week'));
    else if (e.startsWith('node:')) { const l = e.slice(5); queue(() => { toast({ icon: CAT[l].icon, title: `${l}: ${CAT[l].nodes[sections(l) - 1]} reached.`, sub: `${CAT[l].landmark} gained a section. +50 XP` }); week?.nudgeLandmark(l); city?.nudgeLandmark(l); burst('output', $('stageWeek'), { colors: [hexStr(CAT[l].hex)] }); sfx('levelUp'); }); }
  }
  if (ship) queue(() => {
    const n = wkOuts();
    toast({ icon: 'trophy', tone: 'violet', title: `Output ${Math.min(n, 2)} of 2 this week.${n > 2 ? ` (${n} shipped)` : ''}`, sub: n >= 2 ? 'Contract outputs met.' : 'Beacon lit on today\'s tower.' });
    burst('output', $('stageWeek'), { colors: [hexStr(CAT[ship.ladder].hex)] }); sfx('levelUp');
  });
  // XP level changes land last, so the smaller moments breathe first
  if (lvAfter.L > lvBefore.L) queue(() => {
    if (lvAfter.district[2] !== lvBefore.district[2]) celebrate('district', lvAfter);
    else { if (!quiet()) toast({ icon: 'star', title: `Level ${lvAfter.L}.`, sub: `${lvAfter.district[2]} · ${nf.format(lvAfter.need - lvAfter.into)} XP to Level ${lvAfter.L + 1}` }); sfx('ping'); }
  });
  checkAch(ev, source, ship);
}

function celebrate(kind, lv) {
  if (kind === 'comeback') {
    week?.craneAt(S.T); city?.craneAt(S.tIdx);
    burst('comeback', $('stageWeek')); sfx('levelUp'); unlock('first_comeback');
    showMoment({ icon: 'building-2', title: "You're back.", text: "First floor day after a quiet one. The crane lifted today's first floor into place, and the scaffolding is coming down.", cta: 'Back to the city' });
    toast({ icon: 'building-2', title: 'Back on. Comeback day logged.', sub: quiet() ? '' : '+30 XP' });
  } else if (kind === 'week') {
    if (!reduced()) for (let i = 0; i < 7; i++) later(i * 100, () => { week?.pulse(i); });
    burst('week', $('stageWeek')); sfx('levelUp'); unlock('week_kept');
    showMoment({ icon: 'calendar-check', title: 'Card complete.', text: '2 of 2 outputs, 5 of 5 floor days. The whole row of towers is lit.', cta: 'See the week' });
    renderWorld();
  } else if (kind === 'district') {
    const l = lv || levelFor(S.xp);
    burst('district', $('stageWeek')); sfx('levelUp');
    showMoment({ icon: l.district[3], title: l.district[2], text: `Level ${l.L}. A new district on the road to Courant, Morningside and Princeton. Nothing was spent to get here.`, cta: 'Look around' });
  }
}

/* ====================================================================== achievements */
function unlock(k) {
  if (S.ach[k]) return; S.ach[k] = true; S.achNew.add(k);
  const a = ACH.find((x) => x.k === k); if (!a) return;
  later(900, () => { toast({ icon: a.i, title: `${a.n}: ${a.r.replace(/\.$/, '')}.`, sub: `Achievement · ${a.t}` }); sfx('ping'); if (a.t === 'Rare') burst('small', $('achGrid')); });
  renderShelf();
}
function checkAch(ev, source, ship) {
  if (source === 'focus') unlock('first_focus');
  if (S.entries.length >= 1) unlock('first_light');
  if (ship && ship.link) unlock('linked_ship');
  if (LADDER.every((l) => S.ladder[l].out >= 1)) unlock('all_five');
  if (S.fogResolved >= 10) unlock('fog_lifter');
}

/* ====================================================================== output: "I shipped something" */
function shipOutput(ladder, what, url) {
  const t = today(), before = snap();
  const link = /^https?:\/\//i.test(url || '');
  t.outs.push({ ladder, what, link });
  S.ladder[ladder].out++; if (link) S.ladder[ladder].linked++; S.totals.outputs++;
  let xp = 0; const ev = [];
  S.ships++;
  if (S.ships <= 3) xp += 100 + (link ? 25 : 0);
  if (!before.doors && doorsOf(t)) { if (!S.floorXP) { S.floorXP = true; xp += 10; } ev.push('floor'); }
  for (const l of LADDER) { if (sections(l) > before.nodes[l]) { ev.push('node:' + l); xp += 50; } }
  if (!S.weekKept && wkFloorDays() >= 5 && wkOuts() >= 2) { S.weekKept = true; ev.push('week'); xp += 100; S.totals.weeksKept++; }
  unlock('first_ship'); if (S.totals.outputs >= 5) unlock('five_ships');
  addWin('trophy', '--amber-ink', `Shipped: ${what}`, `${ladder}${link ? ' · with a receipt' : ''}`);
  finishAction({ entry: null, xp, ev, before, source: 'ship', ship: { ladder, link } });
  if (xp > 0) floaty(`+${xp} XP`, $('shipBtn'));
  week?.nudgeLandmark(ladder); city?.nudgeLandmark(ladder);
}
$('shipBtn').addEventListener('click', () => {
  const d = $('shipDlg'); d.returnValue = '';
  const first = document.querySelector(`#shipStage input[value="${sel.cat && CAT[sel.cat]?.deep ? sel.cat : S.entries[0] && CAT[S.entries[0].cat].deep ? S.entries[0].cat : 'Python'}"]`);
  if (first) first.checked = true;
  $('shipWhat').value = ''; $('shipUrl').value = '';
  d.showModal(); $('shipWhat').focus();
});
$('shipDlg').addEventListener('click', (e) => { if (e.target === $('shipDlg')) $('shipDlg').close('cancel'); });
$('shipDlg').addEventListener('close', () => {
  if ($('shipDlg').returnValue !== 'ship') return;
  const ladder = (document.querySelector('#shipStage input:checked') || {}).value || 'Python';
  shipOutput(ladder, $('shipWhat').value.trim() || `${ladder} output`, $('shipUrl').value.trim());
});

/* ====================================================================== focus timer + rest day */
let focus = null, focusIv = 0;
function focusMinutes() { return Math.floor((Date.now() - focus.t0) / 60000 + focus.skip); }
function renderFocus() {
  const slot = $('focusSlot');
  if (!focus) { slot.innerHTML = ''; $('focusLbl').textContent = 'Focus'; $('focusBtn').setAttribute('aria-pressed', 'false'); return; }
  $('focusLbl').textContent = 'Stop'; $('focusBtn').setAttribute('aria-pressed', 'true');
  slot.innerHTML = `<div class="focuspill" style="margin-bottom:var(--sp-3)"><div><span class="eyebrow">Focus · ${esc(CAT[focus.cat].label)}</span><div class="num" id="focusClock">00:00</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn btn--sm btn--ghost" type="button" id="focusSkip">+10m (demo)</button><button class="btn btn--sm btn--violet" type="button" id="focusStop">Stop and log</button></div></div>`;
  $('focusSkip').addEventListener('click', () => { focus.skip += 10; tickFocus(); sfx('tick'); });
  $('focusStop').addEventListener('click', stopFocus);
  tickFocus();
}
function tickFocus() {
  if (!focus) return; const el = $('focusClock'); if (!el) return;
  const s = Math.floor((Date.now() - focus.t0) / 1000 + focus.skip * 60);
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function startFocus() {
  const p = parseLine($('logText').value);
  const cat = [p.cat, sel.cat].find((c) => c && CAT[c] && CAT[c].deep) || 'Python';
  focus = { t0: Date.now(), skip: 0, cat };
  clearInterval(focusIv); focusIv = setInterval(tickFocus, 1000);
  renderFocus(); sfx('tick');
  toast({ icon: 'timer', tone: 'violet', title: `Focus started · ${CAT[cat].label}.`, sub: 'The tower grows when you stop and log.' });
}
function stopFocus() {
  if (!focus) return;
  const m = focusMinutes();
  if (m < 1) { toast({ icon: 'timer', tone: 'violet', title: 'Under a minute so far.', sub: 'Tap +10m (demo) to fast-forward the clock.' }); return; }
  const cat = focus.cat; focus = null; clearInterval(focusIv); renderFocus();
  commitLog({ min: m, cat, text: 'focus session', source: 'focus' });
}
$('focusBtn').addEventListener('click', () => (focus ? stopFocus() : startFocus()));
$('restBtn').addEventListener('click', () => {
  const t = today();
  if (t.rest) { t.rest = false; toast({ icon: 'tent-tree', tone: 'violet', title: 'Rest day taken back.', sub: `${2 - wkRest()} rest tokens left this week.` }); }
  else if (wkRest() >= 2) { toast({ icon: 'tent-tree', tone: 'violet', title: 'Both rest tokens are used this week.', sub: 'Rest hours still count as honest logs.' }); return; }
  else {
    t.rest = true;
    toast({ icon: 'tent-tree', tone: 'violet', title: `Rest day logged. ${2 - wkRest()} token${2 - wkRest() === 1 ? '' : 's'} left this week.`, sub: t.deep > 0 ? `Today's ${fmtMin(t.deep)} stay on the board.` : 'A park tile slid onto today\'s lot.' });
    sfx('tick');
  }
  pushScenes(true); renderRing(); renderDays(); renderWorld(); syncRestBtn();
});
function syncRestBtn() { $('restLbl').textContent = today().rest ? 'Undo rest' : 'Rest day'; }

/* ====================================================================== World + Shelf + totals */
let worldBuilt = false;
function buildWorld() {
  if (worldBuilt) return; worldBuilt = true;
  $('outSlots').innerHTML = [0, 1].map(() => `<span class="slot">${ico('trophy')}</span>`).join('');
  $('floorPips').innerHTML = [0, 1, 2, 3, 4].map(() => `<span class="slot slot--pip">${ico('check')}</span>`).join('');
  $('restPips').innerHTML = [0, 1].map(() => `<span class="slot slot--pip slot--rest">${ico('tent-tree')}</span>`).join('');
  $('ghostChart').innerHTML = DAY3.map(() => '<div class="gcol"><i class="g"></i><i class="n"></i></div>').join('');
  $('ghostDays').innerHTML = DAY3.map((d) => `<span>${d[0]}</span>`).join('');
  $('totals').innerHTML = ['Deep hours', 'Days shown up', 'Outputs', 'Weeks kept', 'Comebacks', 'Best run'].map((l, i) => `<div class="total"><b class="num" id="tot${i}">0</b><span>${l}</span></div>`).join('');
  $('achGrid').innerHTML = ACH.map((a) => `<div class="achi" id="ach_${a.k}">${ico(a.i)}<span class="tier">${a.t}</span><b>${esc(a.n)}</b><small>${esc(a.r)}</small></div>`).join('');
  $('ladders').innerHTML = LADDER.map((l) => `<div class="ladder ${CAT[l].lc}" id="lad_${l.replace(/\W/g, '')}"><span class="ladder__ic">${ico(CAT[l].icon)}</span><div><b>${esc(l)} · ${esc(CAT[l].landmark)}</b><div class="nodes"><i></i><i></i><i></i><i></i><i></i></div><small></small></div></div>`).join('');
}
function renderWorld() {
  buildWorld();
  const tot = S.totals, run = calcRun(), best = Math.max(tot.bestRun, run);
  tot.bestRun = best;
  const vals = [`${Math.floor(tot.deepMin / 60)}h`, tot.daysShown, tot.outputs, tot.weeksKept, tot.comebacks, best];
  vals.forEach((v, i) => { $('tot' + i).textContent = v; });
  const outs = wkOuts(), fd = wkFloorDays(), rs = wkRest();
  $('outCount').textContent = Math.min(outs, 2); $('floorDayCount').textContent = Math.min(fd, 5); $('restCount').textContent = rs;
  [...$('outSlots').children].forEach((el, i) => el.classList.toggle('on', i < outs));
  [...$('floorPips').children].forEach((el, i) => el.classList.toggle('on', i < fd));
  [...$('restPips').children].forEach((el, i) => el.classList.toggle('on', i < rs));
  $('stampNote').textContent = S.weekKept ? 'Card complete. The week is kept and the row is lit.' : `${Math.max(0, 2 - outs)} output${2 - outs === 1 ? '' : 's'} and ${Math.max(0, 5 - fd)} floor day${5 - fd === 1 ? '' : 's'} to go. Monday starts a fresh card.`;
  const cols = [...$('ghostChart').children], max = Math.max(S.target, ...S.days.slice(14).map((d) => d.deep), 60);
  cols.forEach((col, k) => {
    const dNow = S.days[21 + k], dOld = S.days[14 + k];
    col.children[0].style.height = Math.round((dOld.deep / max) * 88) + 'px';
    col.children[1].style.height = dNow.future ? '0px' : Math.round((dNow.deep / max) * 88) + 'px'; col.children[1].style.minBlockSize = dNow.future ? '0' : '';
  });
  [...$('ghostDays').children].forEach((el, k) => { el.style.color = k === S.T ? 'var(--amber-ink)' : ''; });
  renderShelf();
}
function renderShelf() {
  if (!worldBuilt) return;
  let n = 0;
  for (const a of ACH) {
    const el = $('ach_' + a.k), on = !!S.ach[a.k]; if (on) n++;
    el.classList.toggle('on', on);
    if (S.achNew.has(a.k)) { el.classList.add('just'); S.achNew.delete(a.k); later(1200, () => el.classList.remove('just')); }
  }
  $('achCount').textContent = n;
  for (const l of LADDER) {
    const el = $('lad_' + l.replace(/\W/g, '')), sec = sections(l), L = S.ladder[l];
    [...el.querySelectorAll('.nodes i')].forEach((i, k) => i.classList.toggle('on', k < sec));
    let txt;
    if (sec >= 5) txt = `${CAT[l].landmark} complete. ${L.out} outputs, ${Math.floor(L.hours)}h.`;
    else { const [o, h, lk] = NODE_REQ[sec], bits = []; if (L.out < o) bits.push(`${o - L.out} more output${o - L.out > 1 ? 's' : ''}`); if (L.hours < h) bits.push(`${fmtMin((h - L.hours) * 60)} of ${l}`); if (L.linked < lk) bits.push(`${lk - L.linked} with a link`); txt = `Next: ${CAT[l].nodes[sec]} · ${bits.join(' and ') || 'ready'}`; }
    el.querySelector('small').textContent = `${sec} of 5 · ${txt}`;
  }
}
let currentView = 'today', worldMode = 'city';
document.querySelectorAll('input[name="wv"]').forEach((r) => r.addEventListener('change', () => {
  worldMode = r.value;
  for (const m of ['city', 'week', 'shelf']) $('wv-' + m).hidden = m !== worldMode;
  if (worldMode === 'city') ensureScenes();
  renderWorld();
}));
$('snapBtn').addEventListener('click', () => {
  if (!city) { toast({ icon: 'camera', tone: 'violet', title: 'Saving an image needs the 3D city.', sub: 'Turn on 3D city in Settings.' }); return; }
  try {
    const a = document.createElement('a'); a.href = city.snapshot(); a.download = 'my-new-york.png'; document.body.appendChild(a); a.click(); a.remove();
    toast({ icon: 'camera', tone: 'violet', title: 'Skyline saved as an image.', sub: 'Rendered here. Nothing was uploaded.' });
  } catch { toast({ icon: 'camera', tone: 'violet', title: 'Could not capture the skyline.' }); }
});

/* ====================================================================== Close the day */
function renderGaps() {
  const open = S.gaps.filter((g) => !g.done).length;
  $('fogNum').textContent = open; $('fogPill').lastElementChild.lastChild.textContent = open === 1 ? ' foggy hour' : ' foggy hours';
  $('gaps').innerHTML = S.gaps.map((g) => {
    if (g.done) return `<div class="gap is-done"><div class="gap__t"><b>${esc(g.label)}</b><span class="small muted">${g.result === 'Unknown' ? 'Left as unknown. That is allowed.' : 'Filled: ' + esc(g.result)}</span></div></div>`;
    const gc = CAT[g.guess];
    const chips = [`<button class="chipbtn" type="button" data-g="${g.id}" data-c="${g.guess}" style="border-color:var(--violet)">${ico('sparkles')}<span>Looks like ${esc(gc.label)}</span><small>${esc(g.src)}</small></button>`]
      .concat(CHIP_CATS.filter((c) => c !== g.guess).map((c) => `<button class="chipbtn" type="button" data-g="${g.id}" data-c="${esc(c)}">${ico(CAT[c].icon)}<span>${esc(CAT[c].label)}</span></button>`))
      .concat([`<button class="chipbtn" type="button" data-g="${g.id}" data-c="Unknown">${ico('cloud-fog')}<span>Don't remember</span></button>`]);
    return `<div class="gap"><div class="gap__t"><b>${esc(g.label)}</b><span class="small muted">${fmtMin(g.min)} not logged</span></div><div class="chips">${chips.join('')}</div></div>`;
  }).join('');
  const ready = open === 0 && !S.sealed;
  $('sealBtn').setAttribute('aria-disabled', ready ? 'false' : 'true');
  $('sealTxt').textContent = S.sealed ? 'Sealed. Tomorrow\'s lot is waiting.' : open ? `${open} ${open === 1 ? 'hour' : 'hours'} left to settle. "Don't remember" is a fine answer.` : 'Everything is settled. Seal the day when you are ready.';
  $('closeDot').hidden = S.sealed || !(new Date().getHours() >= 21 || new Date().getHours() < 3);
  $('recap').hidden = !S.sealed;
}
$('gaps').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  const g = S.gaps.find((x) => x.id === +b.dataset.g); if (!g || g.done) return;
  const cat = b.dataset.c; g.done = true; g.result = cat === 'Unknown' ? 'Unknown' : `${fmtMin(g.min)} ${CAT[cat].label}`;
  if (cat !== 'Unknown') { S.fogResolved++; commitLog({ min: g.min, cat, text: 'filled at Close', source: 'backfill' }); }
  else { toast({ icon: 'cloud-fog', tone: 'violet', title: 'Left as unknown. That is allowed.', sub: 'The fog stays a patch on the lot.' }); sfx('tick'); }
  checkAch([], 'backfill', null);
  renderGaps();
});
$('sealBtn').addEventListener('click', () => {
  if ($('sealBtn').getAttribute('aria-disabled') === 'true') {
    if (!S.sealed) { const open = S.gaps.filter((g) => !g.done).length; $('sealTxt').textContent = `${open} ${open === 1 ? 'hour' : 'hours'} left. Tap one answer each, "Don't remember" is allowed.`; }
    return;
  }
  S.sealed = true;
  const lo = $('lightsOut'); if (!reduced()) { lo.classList.remove('go'); void lo.offsetWidth; lo.classList.add('go'); later(1700, () => lo.classList.remove('go')); }
  sfx('thunk');
  later(reduced() ? 0 : 750, () => {
    S.xp += 10; renderLevel({ shine: true }); floaty('+10 XP', $('sealBtn'));
    toast({ icon: 'moon', tone: 'violet', title: 'Day sealed.', sub: quiet() ? '' : '+10 XP · lights are out' });
    burst('small', $('sealCard'));
    renderGaps(); renderQuests(); renderRecap();
    $('recap').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
  });
});
function renderRecap() {
  const t = today(), lv = levelFor(S.xp);
  $('recap').innerHTML = `<div class="card__head"><h2>Day recap</h2><span class="pill pill--mint">${ico('moon')}Sealed</span></div>
    <div class="recap">
      <div class="total"><b class="num">${Math.min(16, Math.floor(t.deep / 15))}</b><span>floors</span></div>
      <div class="total"><b class="num">${fmtMin(t.deep)}</b><span>deep today</span></div>
      <div class="total"><b class="num">${t.outs.length}</b><span>outputs today</span></div>
      <div class="total"><b class="num">${esc(lv.district[2])}</b><span>Level ${lv.L}${quiet() ? '' : ', ' + nf.format(S.xp) + ' XP'}</span></div>
    </div>
    <p class="small muted" style="margin:12px 0">${S.entries.length} hours logged today, including rest and drift. The map is accurate.</p>
    <button class="btn btn--ghost btn--sm" type="button" id="recapSave">${ico('camera')}Save as image</button>`;
  $('recapSave').addEventListener('click', () => {
    if (!week) { toast({ icon: 'camera', tone: 'violet', title: 'Saving an image needs the 3D city.' }); return; }
    try { const a = document.createElement('a'); a.href = week.snapshot(); a.download = 'my-day.png'; document.body.appendChild(a); a.click(); a.remove(); toast({ icon: 'camera', tone: 'violet', title: 'Day saved as an image.', sub: 'Nothing was uploaded.' }); } catch { /* ignore */ }
  });
}

/* ====================================================================== theme, sound, settings */
function effectiveTheme() { return root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function applyTheme(mode) {   // 'auto' | 'light' | 'dark'
  if (mode === 'auto') { delete root.dataset.theme; store.set('theme', null); } else { root.dataset.theme = mode; store.set('theme', mode); }
  syncTheme();
}
function syncTheme() {
  const dark = effectiveTheme() === 'dark';
  $('themeUse').setAttribute('href', `icons.svg#i-${dark ? 'sun' : 'moon'}`);
  $('themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  const mode = root.dataset.theme || 'auto';
  document.querySelectorAll('input[name="th"]').forEach((r) => { r.checked = r.value === mode; });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncTheme);
$('themeBtn').addEventListener('click', () => applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
document.querySelectorAll('input[name="th"]').forEach((r) => r.addEventListener('change', () => applyTheme(r.value)));

function setSound(on, fromUser = true) {
  prefs.sound = on; store.set('sound', on ? '1' : null);
  $('soundBtn').setAttribute('aria-pressed', on); $('soundBtn').setAttribute('aria-label', on ? 'Sound is on. Turn off' : 'Sound is off. Turn on');
  $('soundUse').setAttribute('href', `icons.svg#i-volume-${on ? '2' : 'x'}`); $('setSound').checked = on;
  if (on && fromUser) { audio(); SFX.ping(); }
}
$('soundBtn').addEventListener('click', () => setSound(!prefs.sound));
$('setSound').addEventListener('change', (e) => setSound(e.target.checked));

function applyMotion() {
  const off = reduced();
  if (prefs.motionOff) root.dataset.motion = 'off'; else delete root.dataset.motion;
  $('setMotion').checked = off; $('setMotion').disabled = mqReduce.matches;
  $('setMotion').title = mqReduce.matches ? 'Your operating system asks for reduced motion' : '';
  week?.setMotion(!off); city?.setMotion(!off);
}
$('setMotion').addEventListener('change', (e) => { prefs.motionOff = e.target.checked; store.set('motion', prefs.motionOff ? 'off' : null); applyMotion(); });
mqReduce.addEventListener?.('change', applyMotion);
function applyQuiet() { root.classList.toggle('quiet', prefs.quiet); $('setQuiet').checked = prefs.quiet; }
$('setQuiet').addEventListener('change', (e) => { prefs.quiet = e.target.checked; store.set('quiet', prefs.quiet ? '1' : null); applyQuiet(); if (S.sealed) renderRecap(); });
$('set3d').addEventListener('change', (e) => { prefs.three = e.target.checked; store.set('three', prefs.three ? null : '0'); applyThree(); });
$('setNY').addEventListener('change', (e) => { prefs.ny = e.target.checked; store.set('ny', prefs.ny ? '1' : null); week?.setHourFn(hourFn); city?.setHourFn(hourFn); toast({ icon: 'plane', tone: 'violet', title: prefs.ny ? 'The sky now follows New York time.' : 'The sky follows your local time.' }); });
document.querySelectorAll('input[name="tg"]').forEach((r) => r.addEventListener('change', () => {
  S.target = +r.value; S.crownXP = crownOf(today()) ? true : S.crownXP;
  pushScenes(true); renderRing(); renderQuests(); renderDays(); renderWorld();
  toast({ icon: 'target', title: `Daily target is ${S.target} minutes.`, sub: `The crown sits at floor ${Math.round(S.target / 15)}.` });
}));

/* demo lab */
const labShip = ['Math', 'Writing/X', 'ML/DL', 'Papers', 'Python']; let labShipI = 0;
$('lab').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lab]'); if (!b) return;
  const k = b.dataset.lab, t = today();
  if (k === 'crown') {
    if (!crownOf(t)) commitLog({ min: S.target - t.deep, cat: 'Python', text: 'demo lab: straight to the crown', source: 'lab' });
    else { burst('crown', $('ringWrap')); toast({ icon: 'target', title: `Crown lit. ${fmtMin(t.deep)} deep.`, sub: 'Replayed from the demo lab.' }); week?.pulse(S.T); sfx('ping'); }
  } else if (k === 'output') { const l = labShip[labShipI++ % labShip.length]; shipOutput(l, `demo ${l} output`, labShipI % 2 ? 'https://example.com/receipt' : ''); }
  else if (k === 'comeback') {
    celebrate('comeback'); S.xp += 30; S.totals.comebacks++; renderLevel({ shine: true }); renderWorld(); addWin('building-2', '--amber-ink', 'Back on. Comeback day (demo)', 'crane day');
  } else if (k === 'week') { if (!S.weekKept) { S.weekKept = true; S.totals.weeksKept++; S.xp += 100; renderLevel({ shine: true }); } celebrate('week'); }
  else if (k === 'district') {
    const lv = levelFor(S.xp), next = DISTRICTS.find((d) => d[0] > lv.L);
    if (!next) { celebrate('district', lv); return; }
    S.xp = Math.max(S.xp, cumXP(next[0])); const after = levelFor(S.xp);
    renderLevel({ shine: true, badge: true }); celebrate('district', after); addWin(next[3], '--violet', `${next[2]}, Level ${after.L}`, 'district');
  } else if (k === 'reset') resetDemo();
});
function resetDemo() {
  closeMoment(); if ($('shipDlg').open) $('shipDlg').close('cancel');
  focus = null; clearInterval(focusIv); renderFocus();
  $('toasts').innerHTML = '';
  S = seed(); pickedWeek = -1; $('dayCardWeek').hidden = true; $('dayCardCity').hidden = true;
  document.querySelectorAll('input[name="tg"]').forEach((r) => { r.checked = r.value === '90'; });
  document.querySelectorAll('.stars, .xp__fill').forEach(() => {});
  ['deepNum', 'xpNum'].forEach((id) => { delete $(id).dataset.v; });
  clearInput(); renderAll(); pushScenes(true);
  toast({ icon: 'rotate-ccw', tone: 'violet', title: 'Demo reset.', sub: 'Back to a fresh Brooklyn morning.' });
}

/* ====================================================================== navigation */
const VIEWS = ['today', 'close', 'world', 'settings'];
const TITLES = { today: 'Today', close: 'Close the day', world: 'World', settings: 'Settings' };
function route() {
  let v = (location.hash || '#today').slice(1); if (!VIEWS.includes(v)) v = 'today';
  currentView = v;
  VIEWS.forEach((n) => { $('view-' + n).hidden = n !== v; });
  document.querySelectorAll('.nav a').forEach((a) => { if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = `${TITLES[v]} · Underdog (prototype)`;
  if (v === 'world') { renderWorld(); if (worldMode === 'city') ensureScenes(); }
  if (v === 'close') renderGaps();
  if (v === 'today') week?.invalidate();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ====================================================================== clocks + misc listeners */
function tickClocks() {
  const d = new Date();
  $('clockLine').textContent = d.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  try { $('nycTime').textContent = 'NYC ' + new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch { $('nycTime').textContent = 'NYC'; }
}
document.addEventListener('visibilitychange', () => { syncPause(); if (!document.hidden) { tickClocks(); renderWins(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (momentEl) closeMoment(); }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
    if (currentView === 'today') { e.preventDefault(); $('logText').focus(); }
  }
});
// a little clay tilt on the ring card, only for a real mouse and only when motion is allowed
(function tilt() {
  const c = document.querySelector('.tilt'); if (!c) return;
  c.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || reduced()) return;
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    c.style.transform = `perspective(900px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
  });
  c.addEventListener('pointerleave', () => { c.style.transform = ''; });
})();

/* ====================================================================== boot */
function renderAll() {
  renderRing(); renderLevel(); renderQuests(); renderWins(); renderRepeat(); renderDays(); renderGaps(); renderWorld(); syncRestBtn(); renderPreview(); renderFocus();
}
function boot() {
  buildChips(); initConfetti();
  S = seed();
  applyTheme(store.get('theme') === 'light' || store.get('theme') === 'dark' ? store.get('theme') : 'auto');
  setSound(prefs.sound, false); applyMotion(); applyQuiet();
  $('set3d').checked = prefs.three; $('setNY').checked = prefs.ny;
  for (const id of ['stageWeek', 'stageCity']) $(id).classList.toggle('use-svg', !prefs.three);
  tickClocks(); setInterval(tickClocks, 20000);
  renderAll();
  route();
  if (matchMedia('(pointer:fine)').matches && currentView === 'today') $('logText').focus({ preventScroll: true });
  const go = () => ensureScenes();
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 }); else later(80, go);
}
try { boot(); } catch (e) { console.error('prototype boot failed', e); }
