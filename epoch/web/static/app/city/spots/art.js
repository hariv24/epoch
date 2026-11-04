// city/spots/art.js · a flat 2D picture of each study spot (inline SVG, no three.js). It is what the Focus Screen shows without WebGL,
// while the 3D scene loads, and as the small picture in the spot picker.
//   spotArt(id, { hour, mini }) -> '<svg ...>' string. The light follows the hour: day, golden hour, blue hour, night.
import { spotOf } from './places.js';

function sky(h) {
  if (h >= 7 && h < 16) return { top: '#8fc0e8', bot: '#dcecf6', glass: '#cfe4f4', lamp: 0.25, sun: '#fff6dc', warm: '#f4e3c0', night: 0 };
  if (h >= 16 && h < 18.5) return { top: '#f0a36a', bot: '#f8d9a4', glass: '#f6cf98', lamp: 0.55, sun: '#ffd28a', warm: '#f6c98a', night: 0.2 };
  if (h >= 5.5 && h < 7) return { top: '#6f86b8', bot: '#f2c2a0', glass: '#c9b9c8', lamp: 0.6, sun: '#ffdcae', warm: '#f2cfa2', night: 0.35 };
  if (h >= 18.5 && h < 20) return { top: '#24345e', bot: '#6f6a95', glass: '#4b5a86', lamp: 0.9, sun: '#ffc98a', warm: '#ffcf8a', night: 0.7 };
  return { top: '#0e1630', bot: '#24305a', glass: '#1d2a4e', lamp: 1, sun: '#ffc98a', warm: '#ffcf8a', night: 1 };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let uid = 0;

/** the faceless figure at a table, from behind/3/4 (a head, a sweater, arms on the table) */
function sitter(x, y, s, top, hair = '#2a1f1a') {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-14 0 C-14 -22 14 -22 14 0 Z" fill="${top}"/><circle cx="0" cy="-27" r="8" fill="#c58c64"/><path d="M-8.4 -28 a8.4 8.4 0 0 1 16.8 0 c0 -3 -3 -9 -8.4 -9 s-8.4 6 -8.4 9z" fill="${hair}"/></g>`;
}
function skyline(y, w, col, seed = 3) {
  let d = `M0 ${y}`, x = 0, r = seed;
  while (x < w) { r = (r * 9301 + 49297) % 233280; const bw = 14 + (r % 30), bh = 18 + ((r >> 3) % 70); d += ` L${x} ${y - bh} L${x + bw} ${y - bh}`; x += bw + 2; d += ` L${x} ${y}`; }
  return `<path d="${d} L${w} ${y} Z" fill="${col}"/>`;
}
function litWindows(y, w, n, k, col) {
  let s = '', r = 7; for (let i = 0; i < n; i++) { r = (r * 9301 + 49297) % 233280; if ((r % 100) / 100 > k) continue; s += `<rect x="${(r % w)}" y="${y - 10 - (r >> 4) % 60}" width="3" height="3" fill="${col}"/>`; }
  return s;
}

const SCENES = {
  library(L, id) {
    const g = 'g' + id, lampA = (0.35 + 0.65 * L.lamp).toFixed(2);
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient>
      <radialGradient id="${g}l" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd590" stop-opacity="${lampA}"/><stop offset="1" stop-color="#ffd590" stop-opacity="0"/></radialGradient></defs>
      <rect width="400" height="250" fill="#e3d8c3"/><rect y="0" width="400" height="26" fill="#33435c"/>`;
    for (let x = 12; x < 400; x += 26) s += `<circle cx="${x}" cy="13" r="2.4" fill="#d9b45a"/>`;
    for (const x of [40, 160, 280]) s += `<path d="M${x} 150 V70 a40 40 0 0 1 80 0 V150 Z" fill="url(#${g}s)" stroke="#6e4a2c" stroke-width="5"/><path d="M${x + 40} 30 V150 M${x + 27} 34 V150 M${x + 53} 34 V150 M${x} 100 H${x + 80}" stroke="#2e261f" stroke-width="2" opacity=".7"/>
      ${L.night < 0.5 ? `<path d="M${x + 40} 30 q-36 0 -36 30 h72 q0 -30 -36 -30z" fill="#c9cfd8" opacity=".55"/>` : ''}`;
    s += `<rect y="150" width="400" height="100" fill="#7b5634"/><rect y="150" width="400" height="10" fill="#563823"/>`;
    // a long table, lamps, the people
    s += `<rect x="20" y="196" width="360" height="12" rx="2" fill="#86603c"/><rect x="30" y="208" width="10" height="42" fill="#563823"/><rect x="360" y="208" width="10" height="42" fill="#563823"/>`;
    for (const x of [70, 150, 250, 330]) s += `<ellipse cx="${x}" cy="196" rx="44" ry="14" fill="url(#${g}l)"/><path d="M${x - 14} 182 h28 l-4 -8 h-20z" fill="#1f6b47"/><rect x="${x - 1}" y="182" width="2" height="14" fill="#b8913f"/>`;
    s += sitter(110, 196, 1, '#3d4a5e') + sitter(210, 196, 1.08, '#6b5b4a', '#1d1714') + sitter(300, 196, 0.96, '#4f5d4a');
    return s;
  },
  cafe(L, id) {
    const g = 'g' + id;
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient></defs>
      <rect width="400" height="250" fill="#5a3f2e"/>`;
    for (let x = 0; x < 400; x += 20) for (let y = 0; y < 30; y += 20) s += `<rect x="${x + 2}" y="${y + 2}" width="16" height="16" fill="#b9b2a2" stroke="#8d8676"/>`;
    s += `<rect x="30" y="50" width="220" height="120" fill="url(#${g}s)" stroke="#2b2622" stroke-width="6"/>${skyline(170, 220, '#5d6478', 5).replace('<path', '<path transform="translate(30 0)"')}`;
    if (L.night > 0.4) s += `<g transform="translate(30 0)">${litWindows(170, 220, 60, 0.6, '#ffd590')}</g>`;
    s += `<path d="M30 50 h220 l-10 18 h-200z" fill="#7a3b2e"/><path d="M30 50 h220 l-10 18 h-200z" fill="none" stroke="#f1ece2" stroke-dasharray="11 11" stroke-width="18" opacity=".35"/>`;
    s += `<rect x="270" y="110" width="110" height="140" fill="#3e2a1e"/><rect x="270" y="104" width="110" height="10" fill="#86603c"/><rect x="290" y="70" width="34" height="34" rx="3" fill="#9aa4b5"/><circle cx="307" cy="66" r="3" fill="#fff" opacity=".6"/>`;
    s += `<rect x="20" y="180" width="240" height="10" fill="#86603c"/><rect y="190" width="400" height="60" fill="#2b2622" opacity=".65"/>`;
    s += sitter(110, 180, 1, '#7a8794') + `<rect x="150" y="172" width="12" height="9" rx="2" fill="#f1ece2"/>` + sitter(200, 180, 0.9, '#8a6f5a', '#5a3a22');
    for (const x of [60, 160, 320]) s += `<circle cx="${x}" cy="8" r="6" fill="#ffd590" opacity="${(0.4 + 0.6 * L.lamp).toFixed(2)}"/>`;
    return s;
  },
  rooftop(L, id) {
    const g = 'g' + id;
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient></defs>
      <rect width="400" height="250" fill="url(#${g}s)"/>${skyline(180, 400, L.night > 0.5 ? '#1a2240' : '#7d8aa5', 9)}`;
    s += `<path d="M250 180 V60 l6 -24 l6 24 V180z" fill="${L.night > 0.5 ? '#1a2240' : '#6c7894'}"/>`;
    if (L.night > 0.4) s += litWindows(180, 400, 120, 0.55, '#ffd590');
    s += `<rect y="180" width="400" height="70" fill="#3a3632"/><rect y="176" width="400" height="8" fill="#6b625a"/>`;
    s += `<g transform="translate(40 70)"><rect x="0" y="40" width="70" height="66" fill="#8a6a4a"/><path d="M-4 40 L35 14 L74 40z" fill="#5e4632"/><rect x="6" y="106" width="6" height="34" fill="#4a3826"/><rect x="58" y="106" width="6" height="34" fill="#4a3826"/></g>`;
    s += `<path d="M0 40 Q200 90 400 30" fill="none" stroke="#2b2622" stroke-width="1.2"/>`;
    for (let i = 0; i <= 16; i++) { const t = i / 16, x = t * 400, y = 40 * (1 - t) * (1 - t) + 2 * 90 * t * (1 - t) + 30 * t * t; s += `<circle cx="${x}" cy="${y + 4}" r="3.4" fill="#ffd590" opacity="${(0.35 + 0.65 * L.lamp).toFixed(2)}"/>`; }
    s += `<rect x="180" y="200" width="120" height="8" fill="#9a8a6a"/><rect x="190" y="208" width="4" height="42" fill="#6b625a"/><rect x="286" y="208" width="4" height="42" fill="#6b625a"/>` + sitter(240, 200, 1, '#4f5d4a');
    return s;
  },
  steps(L, id) {
    const g = 'g' + id;
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient></defs><rect width="400" height="250" fill="url(#${g}s)"/>`;
    s += `<path d="M120 110 a80 46 0 0 1 160 0z" fill="#b7ad9c"/><rect x="100" y="108" width="200" height="50" fill="#d9cfbb"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="${60 - i * 10}" y="${158 + i * 9}" width="${280 + i * 20}" height="9" fill="${i % 2 ? '#cfc4ae' : '#ddd3bf'}"/>`;
    s += `<rect y="212" width="400" height="38" fill="#5c7d4a"/>` + sitter(150, 212, 0.9, '#3d4a5e') + sitter(260, 194, 0.8, '#8a6f5a');
    return s;
  },
  park(L, id) {
    const g = 'g' + id;
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient></defs><rect width="400" height="250" fill="url(#${g}s)"/>`;
    s += `<path d="M150 250 L190 120 h20 L250 250z" fill="#c7b89a"/><rect y="200" width="400" height="50" fill="#4f6d3d" opacity=".9"/>`;
    for (const [x, r] of [[40, 70], [110, 60], [300, 64], [370, 72]]) s += `<rect x="${x - 4}" y="80" width="8" height="140" fill="#4a3826"/><circle cx="${x}" cy="70" r="${r}" fill="#3f6b3a" opacity=".92"/>`;
    for (const x of [150, 260]) s += `<rect x="${x}" y="150" width="3" height="70" fill="#2b2f38"/><circle cx="${x + 1.5}" cy="148" r="5" fill="#ffd590" opacity="${(0.3 + 0.7 * L.lamp).toFixed(2)}"/>`;
    s += `<rect x="90" y="212" width="70" height="6" fill="#6e4a2c"/>` + sitter(125, 212, 0.85, '#7d6e8a');
    return s;
  },
  penthouse(L, id) {
    const g = 'g' + id;
    let s = `<defs><linearGradient id="${g}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient></defs><rect width="400" height="250" fill="#e9e3d8"/>`;
    s += `<rect x="20" y="20" width="360" height="160" fill="url(#${g}s)"/>${skyline(150, 360, L.night > 0.5 ? '#1a2240' : '#8a97b2', 2).replace('<path', '<path transform="translate(20 0)"')}<rect x="20" y="150" width="360" height="30" fill="#3f6b3a"/>`;
    for (let x = 20; x <= 380; x += 90) s += `<rect x="${x - 2}" y="20" width="4" height="160" fill="#2b2f38"/>`;
    s += `<rect x="120" y="190" width="200" height="12" fill="#efe9de"/><rect x="130" y="202" width="8" height="48" fill="#b8b0a2"/><rect x="302" y="202" width="8" height="48" fill="#b8b0a2"/>` + sitter(220, 190, 1, '#2f3a4a');
    return s;
  },
};

export function spotArt(id, o = {}) {
  const sp = spotOf(id), h = o.hour != null ? o.hour : new Date().getHours() + new Date().getMinutes() / 60, L = sky(((h % 24) + 24) % 24);
  const draw = SCENES[sp.art] || SCENES.library, n = ++uid;
  const night = L.night > 0.5 ? `<rect width="400" height="250" fill="#0b1024" opacity="${(0.18 * L.night).toFixed(2)}"/>` : '';
  return `<svg class="spotart" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(sp.name)}" xmlns="http://www.w3.org/2000/svg">${draw(L, n)}${night}</svg>`;
}
