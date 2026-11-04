#!/usr/bin/env node
// Underdog theme builder (no npm installs; node >= 22 + Google Chrome).
//
//   node build.mjs                 build every theme in themes/
//   node build.mjs my-slug other   build only these (the gallery still lists every theme folder)
//   flags: --no-shots   skip headless Chrome (previews + gallery only)
//          --light      also shoot <slug>-today-1280-light.png
//
// Per theme it writes previews/<slug>-today.html, previews/<slug>-focus.html,
// shots/<slug>-today-1280.png, shots/<slug>-focus-1280.png, shots/<slug>-today-390.png,
// shots/<slug>-report.json (measured contrast + lint), then regenerates index.html (the gallery).
// See CONTRACT.md for what a theme folder must contain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const P = (...a) => path.join(ROOT, ...a);
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const wanted = argv.filter((a) => !a.startsWith('--'));
const allSlugs = fs.readdirSync(P('themes')).filter((d) => fs.existsSync(P('themes', d, 'theme.css'))).sort((a, b) => (a === 'night-clay' ? -1 : b === 'night-clay' ? 1 : a.localeCompare(b)));
const slugs = wanted.length ? wanted : allSlugs;
for (const s of slugs) if (!allSlugs.includes(s)) { console.error(`no theme folder themes/${s}/ with a theme.css`); process.exit(1); }
fs.mkdirSync(P('previews'), { recursive: true });
fs.mkdirSync(P('shots'), { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// ---------------------------------------------------------------- notes.md front matter
function parseNotes(slug) {
  const txt = read(P('themes', slug, 'notes.md')) || '';
  const meta = { name: slug, vibe: '', palette: [] };
  const fm = txt.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    let inPal = false;
    for (const line of fm[1].split('\n')) {
      const pal = line.match(/^\s+-?\s*([\w .\/-]+?)\s*:\s*"?(#[0-9a-fA-F]{3,8})"?\s*(?:#\s*(.*))?$/);
      if (inPal && pal) { meta.palette.push({ role: pal[1].trim(), hex: pal[2], note: (pal[3] || '').trim() }); continue; }
      const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kv) { inPal = kv[1] === 'palette'; if (!inPal) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').trim(); }
    }
  } else {
    const h = txt.match(/^#\s+(.+)$/m); if (h) meta.name = h[1].trim();
  }
  return meta;
}

// ---------------------------------------------------------------- lint (static)
const ALLOWED_DECOR = /^(:root(\[[^\]]*\])?(:not\([^)]*\))?|html|body|body::(before|after)|\.app::(before|after)|\.shell::(before|after)|\.bg(\b|_|-)[\w-]*(::(before|after))?|\.focus::(before|after)|\.stage::(before|after)|\.stage>\.snap-city|\.stage > \.snap-city)$/;
function lint(slug) {
  const dir = P('themes', slug), warn = [], err = [];
  for (const f of ['theme.css', 'icon.svg', 'icon-32.svg', 'icon-16.svg', 'city.json', 'notes.md']) if (!fs.existsSync(path.join(dir, f))) (f === 'notes.md' && slug === 'night-clay' ? warn : err).push(`missing ${f}`);
  const css = read(path.join(dir, 'theme.css')) || '';
  if (/@import\b/i.test(css)) err.push('theme.css uses @import (inline everything)');
  if (/url\(\s*['"]?(?:https?:)?\/\//i.test(css)) err.push('theme.css loads a remote url()');
  // rules outside the token/decoration allow-list must be preceded by a /* TWEAK: ... */ comment
  // TWEAK comments become a \u0001 marker, other comments go; @keyframes bodies are dropped; @media/@supports
  // headers are dropped so their inner rules are checked like top-level ones.
  let flat = css.replace(/\/\*\s*TWEAK[\s\S]*?\*\//g, '\u0001').replace(/\/\*[\s\S]*?\*\//g, '');
  flat = flat.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@(media|supports|layer|container)[^{]*\{/g, '');
  const tweaks = [];
  const re = /([^{}]+)\{/g; let m;
  while ((m = re.exec(flat))) {
    const raw = m[1], marked = raw.includes('\u0001');
    const sels = raw.split('\u0001').pop().trim().split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!sels.length || /^(from|to|\d+%)$/.test(sels[0])) continue;
    const off = sels.filter((x) => !ALLOWED_DECOR.test(x));
    if (off.length) { tweaks.push(off.join(', ')); if (!marked) warn.push(`component rule without a /* TWEAK: why */ comment: ${off.join(', ').slice(0, 90)}`); }
  }
  if (tweaks.length > 12) warn.push(`${tweaks.length} component tweaks (keep it small: <= 12)`);
  if (/animation|@keyframes/.test(css) && !/prefers-reduced-motion/.test(css)) err.push('theme.css animates but has no prefers-reduced-motion guard');
  for (const f of ['icon.svg', 'icon-32.svg', 'icon-16.svg', 'bg.svg', 'brand.svg']) {
    const s = read(path.join(dir, f)); if (!s) continue;
    if (/(href|src)\s*=\s*["'](?:https?:)?\/\//i.test(s) || /url\(\s*['"]?https?:/i.test(s)) err.push(`${f} references a remote resource`);
    if (/<script/i.test(s)) err.push(`${f} contains a script`);
    if (/<text\b/i.test(s) && f.startsWith('icon')) warn.push(`${f} uses <text> (fonts differ per device: convert lettering to paths)`);
    if (f === 'icon.svg' && !/viewBox\s*=\s*["']0 0 512 512["']/.test(s)) err.push('icon.svg must use viewBox="0 0 512 512"');
  }
  let city = null;
  try { city = JSON.parse(read(path.join(dir, 'city.json')) || 'null'); } catch (e) { err.push('city.json is not valid JSON: ' + e.message); }
  if (city) for (const k of ['skyTop', 'skyBottom', 'fog', 'windowWarm', 'windowCool', 'accent', 'beacon']) if (!/^#[0-9a-fA-F]{6}$/.test(city[k] || '')) err.push(`city.json: ${k} must be "#RRGGBB"`);
  return { warn, err, tweaks, city };
}

// ---------------------------------------------------------------- preview pages
function svgInline(file, prefix) {
  let s = fs.readFileSync(file, 'utf8').replace(/<\?xml[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  s = s.replace(/\sid="([^"]+)"/g, ` id="${prefix}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`).replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`);
  s = s.replace(/<svg\b/, '<svg aria-hidden="true" data-slot="brand" focusable="false"');
  return s;
}
function cityVars(city) {
  if (!city) return '';
  const v = { 'sky-top': city.skyTop, 'sky-mid': city.skyMid || city.skyTop, 'sky-bottom': city.skyBottom, fog: city.fog, 'window-warm': city.windowWarm, 'window-cool': city.windowCool, accent: city.accent, beacon: city.beacon };
  let css = ':root{' + Object.entries(v).map(([k, x]) => `--city-${k}:${x}`).join(';');
  const t = city.previewTint;
  if (t) css += `;--city-tint:${t.css || 'linear-gradient(var(--city-sky-top),var(--city-sky-bottom))'};--city-tint-blend:${t.blend || 'color'};--city-tint-opacity:${t.opacity ?? 0.35}`;
  css += '}';
  if (Array.isArray(city.stageBg)) css += `.stage{background:linear-gradient(${city.stageBg.join(',')})}`;
  return css;
}
const BAR_CSS = `.pv-bar{position:fixed;inset-block-end:12px;inset-inline-end:12px;z-index:999;display:flex;gap:6px;align-items:center;padding:6px;border-radius:999px;
  background:rgb(10 10 20/.82);color:#fff;font:700 12px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0/.4);backdrop-filter:blur(8px)}
.pv-bar a,.pv-bar button{all:unset;cursor:pointer;padding:7px 11px;border-radius:999px;color:#fff}.pv-bar a:hover,.pv-bar button:hover{background:rgb(255 255 255/.14)}
.pv-bar b{padding:0 8px;opacity:.75}.pv-bar a:focus-visible,.pv-bar button:focus-visible{outline:2px solid #fff}
html[data-shot] .pv-bar,html[data-embed] .pv-bar{display:none}`;
function buildPreview(slug, kind, meta, city) {
  const T = P('themes', slug);
  let h = fs.readFileSync(P('base', `${kind}.html`), 'utf8');
  h = h.replace(/(href|src)="assets\//g, '$1="../base/assets/');
  const head = [
    `<link rel="stylesheet" href="../themes/${slug}/theme.css" data-slot="theme">`,
    `<style data-slot="city">${cityVars(city)}</style>`,
    `<style data-slot="preview-bar">${BAR_CSS}</style>`,
    `<script>try{if(window.self!==window.top)document.documentElement.dataset.embed='';var t=new URLSearchParams(location.search).get('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>`,
  ].join('\n  ');
  h = h.replace('<!--THEME_HEAD-->', head);
  h = h.replace(/<link rel="icon"[^>]*data-slot="favicon"[^>]*>/, `<link rel="icon" type="image/svg+xml" sizes="32x32" href="../themes/${slug}/icon-32.svg"><link rel="icon" type="image/svg+xml" sizes="16x16" href="../themes/${slug}/icon-16.svg">`);
  const brandFile = fs.existsSync(path.join(T, 'brand.svg')) ? path.join(T, 'brand.svg') : path.join(T, 'icon-32.svg');
  if (fs.existsSync(brandFile)) h = h.replace(/<!--BRAND_ICON-->[\s\S]*?<!--\/BRAND_ICON-->/, svgInline(brandFile, 'brand-' + slug));
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.name)} · ${kind === 'today' ? 'Today' : 'Focus'}</title>`);
  const other = kind === 'today' ? 'focus' : 'today';
  const bar = `<nav class="pv-bar" aria-label="Preview"><a href="../index.html">Gallery</a><b>${esc(meta.name)}</b><a href="${slug}-${other}.html">${other === 'focus' ? 'Focus' : 'Today'}</a><button type="button" onclick="var r=document.documentElement;r.dataset.theme=r.dataset.theme==='light'?'dark':'light'">Light / dark</button></nav>`;
  h = h.replace(/<\/body>/i, bar + '\n</body>');
  fs.writeFileSync(P('previews', `${slug}-${kind}.html`), h);
}

// ---------------------------------------------------------------- contrast (measured in the browser)
const PAIRS = [
  // [fg, bg, min, label]
  ['--ink', '--bg', 4.5, 'body text on page'], ['--ink', '--s1', 4.5, 'body text on card'], ['--ink', '--s2', 4.5, 'text on well / ghost button'],
  ['--muted', '--s1', 4.5, 'muted text on card'], ['--muted', '--bg', 4.5, 'muted text on page'], ['--muted', '--s2', 4.5, 'placeholder in input'],
  ['--faint', '--s1', 3, 'faint icons on card'],
  ['--on-amber', '--amber', 4.5, 'amber button label'], ['--on-violet', '--violet', 4.5, 'violet button label'], ['--on-mint', '--mint', 4.5, 'mint button label'],
  ['--amber-ink', '--amber-soft', 4.5, 'active nav tab'], ['--violet', '--s1', 4.5, 'links on card'], ['--violet', '--violet-soft', 4.5, 'soft pill / callout'],
  ['--mint', '--mint-soft', 4.5, 'ok pill'], ['--ink', '--amber-soft', 4.5, 'amber callout text'], ['--ink', '--violet-soft', 4.5, 'violet callout text'],
  ['--bg', '--ink', 4.5, 'toast (inverted)'],
  ['--focus', '--bg', 3, 'focus ring on page'], ['--focus', '--s1', 3, 'focus ring on card'], ['--line-strong', '--s2', 3, 'input border'],
  ['--c-python', '--s1', 3, 'Python glyph'], ['--c-math', '--s1', 3, 'Math glyph'], ['--c-ml', '--s1', 3, 'ML/DL glyph'], ['--c-papers', '--s1', 3, 'Papers glyph'], ['--c-writing', '--s1', 3, 'Writing glyph'], ['--rest', '--s1', 3, 'Rest glyph'], ['--c-drift', '--s1', 3, 'Drift glyph'],
  ['--flame', '--s1', 3, 'run flame'], ['--amber', '--s2', 3, 'XP bar fill vs track'],
];
const MEASURE = `(async () => {
  await document.fonts.ready;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const probe = document.createElement('i'); probe.style.cssText = 'position:absolute;inline-size:0;block-size:0;overflow:hidden'; document.body.appendChild(probe);
  const col = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
  const px = (layers) => { cx.clearRect(0,0,1,1); cx.fillStyle = '#000'; cx.fillRect(0,0,1,1); for (const c of layers) { cx.fillStyle = c; cx.fillRect(0,0,1,1); } return [...cx.getImageData(0,0,1,1).data].slice(0,3); };
  const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126*f(rgb[0]) + 0.7152*f(rgb[1]) + 0.0722*f(rgb[2]); };
  const hex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  const pairs = ${JSON.stringify(PAIRS)};
  const bgc = col('--bg');
  const out = pairs.map(([fg, bg, min, label]) => {
    const b = px([bgc, col(bg)]), f = px([bgc, col(bg), col(fg)]);
    const L1 = lum(f), L2 = lum(b), r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return { fg, bg, fgHex: hex(f), bgHex: hex(b), ratio: Math.round(r * 100) / 100, min, pass: r >= min, label };
  });
  probe.remove();
  return out;
})()`;

// ---------------------------------------------------------------- screenshots
async function shoot(list) {
  const { launch, newPage, sleep } = await import('./tools/cdp.mjs');
  const port = 9300 + Math.floor(Math.random() * 600);
  const c = await launch(port);
  try {
    const p = await newPage(port);
    const external = [];
    p.handlers.push((d) => { if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (!/^(file|data|blob|about|chrome):/.test(u)) external.push(u); } });
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    const go = async (url, w, h) => { await p.viewport(w, h); await p.goto(url, 300); await p.ev(`document.documentElement.dataset.shot='';document.fonts.ready.then(()=>1)`); await sleep(350); };
    const full = async (w, file) => { const H = await p.ev('Math.ceil(document.documentElement.scrollHeight)'); await p.viewport(w, H); await sleep(300); await p.shot(file); };
    for (const slug of list) {
      external.length = 0; p.errors.length = 0; p.reqFailures.length = 0;
      const today = 'file://' + P('previews', `${slug}-today.html`), focus = 'file://' + P('previews', `${slug}-focus.html`);
      await go(today, 1280, 900);
      const contrast = await p.ev(MEASURE);
      await full(1280, P('shots', `${slug}-today-1280.png`));
      const fontsOK = await p.ev(`[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,''))`);
      const iconsOK = await p.ev(`[...document.querySelectorAll('use')].filter(u=>{const id=(u.getAttribute('href')||'').slice(1);return !document.getElementById(id)}).length`);
      let contrastLight; if (flags.has('--light')) { await go(today + '?theme=light', 1280, 900); contrastLight = await p.ev(MEASURE); await full(1280, P('shots', `${slug}-today-1280-light.png`)); const lf = contrastLight.filter((x) => !x.pass); console.log(`  ${slug}: light contrast ${contrastLight.length - lf.length}/${contrastLight.length}${lf.length ? ' · FAIL ' + lf.map((f) => `${f.fg} on ${f.bg} ${f.ratio}`).join(', ') : ''}`); }
      await go(focus, 1280, 800); await p.shot(P('shots', `${slug}-focus-1280.png`));
      await go(today, 390, 844); await full(390, P('shots', `${slug}-today-390.png`));
      const report = { slug, builtAt: new Date().toISOString(), contrast, ...(contrastLight ? { contrastLight } : {}), fonts: fontsOK, brokenIconRefs: iconsOK, externalRequests: [...new Set(external)], consoleErrors: p.errors.slice(0, 20), failedRequests: p.reqFailures.slice(0, 20) };
      const prev = JSON.parse(read(P('shots', `${slug}-report.json`)) || '{}');
      fs.writeFileSync(P('shots', `${slug}-report.json`), JSON.stringify({ ...prev, ...report }, null, 2));
      const fails = contrast.filter((x) => !x.pass);
      console.log(`  ${slug}: shots ok · contrast ${contrast.length - fails.length}/${contrast.length} pass${fails.length ? ' · FAIL ' + fails.map((f) => `${f.fg} on ${f.bg} ${f.ratio}`).join(', ') : ''}` +
        `${external.length ? ' · EXTERNAL REQUESTS ' + external.join(' ') : ''}${p.errors.length ? ' · console errors ' + p.errors.length : ''}${iconsOK ? ' · broken icon refs ' + iconsOK : ''} · fonts ${fontsOK.join('+') || 'NONE'}`);
    }
  } finally { c.proc.kill(); try { fs.rmSync(c.dir, { recursive: true, force: true }); } catch (e) {} }
}

// ---------------------------------------------------------------- gallery
function gallery() {
  const themes = allSlugs.map((slug) => {
    const meta = parseNotes(slug), L = lint(slug);
    const rep = JSON.parse(read(P('shots', `${slug}-report.json`)) || 'null');
    return { slug, meta, lint: L, rep, has: (f) => fs.existsSync(P('themes', slug, f)) };
  });
  const iconImg = (t, f, s, cls = '') => t.has(f) ? `<img class="${cls}" src="themes/${t.slug}/${f}" width="${s}" height="${s}" alt="">` : `<span class="missing" style="width:${s}px;height:${s}px">?</span>`;
  const chips = (t) => (t.meta.palette.length ? t.meta.palette : []).slice(0, 10).map((c) => `<li title="${esc(c.role)} ${esc(c.hex)}${c.note ? ' · ' + esc(c.note) : ''}"><i style="background:${esc(c.hex)}"></i><span>${esc(c.role)}</span><code>${esc(c.hex)}</code></li>`).join('');
  const status = (t) => {
    const out = [];
    if (t.rep?.contrast) { const f = t.rep.contrast.filter((x) => !x.pass); out.push(`<span class="st ${f.length ? 'bad' : 'ok'}">contrast ${t.rep.contrast.length - f.length}/${t.rep.contrast.length}</span>`); for (const x of f.slice(0, 4)) out.push(`<span class="st bad" title="${esc(x.label)}">${esc(x.fg)} on ${esc(x.bg)} ${x.ratio}:1 (needs ${x.min})</span>`); }
    else out.push('<span class="st warn">no shots yet</span>');
    if (t.rep?.externalRequests?.length) out.push('<span class="st bad">external requests</span>');
    for (const e of t.lint.err) out.push(`<span class="st bad">${esc(e)}</span>`);
    for (const w of t.lint.warn.slice(0, 3)) out.push(`<span class="st warn">${esc(w)}</span>`);
    if (t.lint.tweaks.length) out.push(`<span class="st">${t.lint.tweaks.length} component tweak${t.lint.tweaks.length > 1 ? 's' : ''}</span>`);
    return out.join('');
  };
  const card = (t) => `
  <article class="tcard${t.slug === 'night-clay' ? ' tcard--ref' : ''}" id="t-${esc(t.slug)}">
    <a class="tcard__frame" href="previews/${esc(t.slug)}-today.html" aria-label="Open the ${esc(t.meta.name)} Today preview">
      <div class="scaler" data-w="1280" data-h="900"><iframe src="previews/${esc(t.slug)}-today.html" loading="lazy" tabindex="-1" title="${esc(t.meta.name)} Today preview" scrolling="no"></iframe></div>
      ${t.slug === 'night-clay' ? '<span class="ref">Reference · current app</span>' : ''}
    </a>
    <div class="tcard__body">
      <div class="tcard__head">
        ${iconImg(t, 'icon.svg', 64, 'ico64')}
        <div><h2>${esc(t.meta.name)}</h2><p class="vibe">${esc(t.meta.vibe || '—')}</p></div>
      </div>
      <div class="sizes">${iconImg(t, 'icon.svg', 180, 'ico180')}<div class="sizes__small">${iconImg(t, 'icon.svg', 64)}${iconImg(t, 'icon-32.svg', 32)}${iconImg(t, 'icon-16.svg', 16)}<small>180 · 64 · 32 · 16</small></div></div>
      ${t.meta.palette.length ? `<ul class="pal">${chips(t)}</ul>` : ''}
      <div class="links"><a class="btn" href="previews/${esc(t.slug)}-today.html">Today</a><a class="btn" href="previews/${esc(t.slug)}-focus.html">Focus</a><a class="lnk" href="shots/${esc(t.slug)}-today-390.png">390 shot</a><a class="lnk" href="shots/${esc(t.slug)}-focus-1280.png">focus shot</a><a class="lnk" href="themes/${esc(t.slug)}/notes.md">notes</a></div>
      <div class="status">${status(t)}</div>
    </div>
  </article>`;
  const iconRow = (t) => `
    <tr><th scope="row"><a href="#t-${esc(t.slug)}">${esc(t.meta.name)}</a></th>
      <td>${iconImg(t, 'icon.svg', 180)}</td>
      <td><span class="mask mask--circle">${iconImg(t, 'icon.svg', 108)}</span></td>
      <td><span class="mask mask--squircle">${iconImg(t, 'icon.svg', 108)}</span></td>
      <td><span class="mask mask--safe">${iconImg(t, 'icon.svg', 108)}<i></i></span></td>
      <td class="lightbg">${iconImg(t, 'icon.svg', 64)}</td>
      <td>${iconImg(t, 'icon-32.svg', 32)}</td>
      <td>${iconImg(t, 'icon-16.svg', 16)}</td>
      <td><span class="tab"><img src="themes/${esc(t.slug)}/icon-16.svg" width="16" height="16" alt="">${esc(t.meta.name)} · Today</span></td></tr>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Underdog Theme Board</title>
<link rel="icon" href="themes/night-clay/icon-32.svg">
<style>
@font-face{font-family:"Fredoka";src:url("base/assets/fonts/fredoka-latin-wght-normal.woff2") format("woff2");font-weight:300 700}
@font-face{font-family:"Nunito";src:url("base/assets/fonts/nunito-latin-wght-normal.woff2") format("woff2");font-weight:200 1000}
:root{--bg:#090B16;--s1:#121528;--s2:#1A1E38;--line:#2A2F57;--ink:#F3F1FF;--muted:#A6ACD6;--amber:#FFB224;--violet:#9A8CFF;--bad:#FF8F8F;--warn:#FFCB6B;--ok:#46E0A0;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:500 15px/1.5 "Nunito",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(900px 500px at 85% -10%,#2A2466,transparent 60%),radial-gradient(700px 500px at -10% 110%,#14305E,transparent 55%)}
a{color:var(--violet)}
header.top{max-width:1480px;margin:0 auto;padding:40px 24px 8px;display:flex;flex-wrap:wrap;gap:16px 32px;align-items:end;justify-content:space-between}
h1,h2,h3{font-family:"Fredoka",system-ui,sans-serif;font-weight:600;margin:0;line-height:1.15}
h1{font-size:clamp(28px,4vw,44px)} h1 span{color:var(--amber)}
.lede{color:var(--muted);max-width:62ch;margin:6px 0 0}
.how{font-size:13px;color:var(--muted);background:var(--s1);border:1.5px solid var(--line);border-radius:16px;padding:10px 14px}
.how code{color:var(--ink)}
main{max-width:1480px;margin:0 auto;padding:16px 24px 80px}
.grid{display:grid;gap:22px;grid-template-columns:repeat(auto-fill,minmax(min(100%,430px),1fr))}
.tcard{background:var(--s1);border:1.5px solid var(--line);border-radius:24px;overflow:hidden;box-shadow:inset 0 2px 0 rgb(255 255 255/.06),0 4px 0 var(--line),0 24px 40px -20px #000;display:flex;flex-direction:column}
.tcard--ref{border-color:#6870B5}
.tcard__frame{display:block;position:relative;aspect-ratio:1280/900;overflow:hidden;background:#000;border-bottom:1.5px solid var(--line);outline-offset:-4px}
.tcard__frame:hover .scaler{filter:brightness(1.06)}
.scaler{position:absolute;top:0;left:0;width:1280px;height:900px;transform-origin:0 0;pointer-events:none}
.scaler iframe{width:1280px;height:900px;border:0;display:block}
.ref{position:absolute;left:12px;bottom:12px;background:var(--amber);color:#1A1000;font:800 12px/1 "Nunito";padding:7px 10px;border-radius:999px}
.tcard__body{padding:18px 20px 20px;display:grid;gap:14px}
.tcard__head{display:flex;gap:14px;align-items:center}
.tcard__head h2{font-size:22px}
.vibe{margin:2px 0 0;color:var(--muted);font-size:14px}
.ico64{border-radius:16px;flex:none}
.sizes{display:flex;gap:16px;align-items:center;background:var(--s2);border-radius:18px;padding:12px}
.ico180{border-radius:36px;width:180px;height:180px;flex:none}
.sizes__small{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.sizes__small small{width:100%;color:var(--muted);font-size:12px}
.pal{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.pal li{display:inline-flex;align-items:center;gap:6px;background:var(--s2);border:1px solid var(--line);border-radius:999px;padding:3px 9px 3px 4px;font-size:12px}
.pal i{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(255 255 255/.25)}
.pal code{color:var(--muted);font-size:11px}
.links{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.btn{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:14px;background:var(--amber);color:#1A1000;font-weight:800;text-decoration:none;box-shadow:inset 0 2px 0 rgb(255 255 255/.45),0 4px 0 #C47F00}
.btn+.btn{background:var(--s2);color:var(--ink);box-shadow:inset 0 2px 0 rgb(255 255 255/.08),0 4px 0 #6870B5}
.btn:active{transform:translateY(3px)}
.lnk{font-size:13px;font-weight:700;padding:8px 4px}
.status{display:flex;flex-wrap:wrap;gap:6px}
.st{font-size:12px;font-weight:700;border-radius:8px;padding:3px 8px;background:var(--s2);color:var(--muted)}
.st.ok{color:var(--ok)} .st.bad{color:var(--bad)} .st.warn{color:var(--warn)}
.missing{display:inline-grid;place-items:center;border:1.5px dashed var(--line);border-radius:12px;color:var(--muted)}
section.icons{margin-top:56px}
section.icons h2{font-size:28px} section.icons p{color:var(--muted);margin:4px 0 16px}
.tablewrap{overflow-x:auto;background:var(--s1);border:1.5px solid var(--line);border-radius:24px}
table{border-collapse:collapse;width:100%;min-width:1100px}
th,td{padding:16px 14px;text-align:center;vertical-align:middle;border-bottom:1px solid var(--line)}
thead th{font:800 12px/1.2 "Nunito";letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
tbody th{text-align:left;font-family:"Fredoka";font-size:18px;font-weight:600} tbody th a{color:var(--ink);text-decoration:none}
td img{display:block;margin:auto}
td:nth-child(2) img{border-radius:40px}
.lightbg{background:#F2EFE8}
.mask{display:inline-block;position:relative;width:108px;height:108px;overflow:hidden}
.mask img{width:108px;height:108px}
.mask--circle{border-radius:50%} .mask--squircle{border-radius:30%}
.mask--safe{border-radius:0} .mask--safe i{position:absolute;inset:10%;border-radius:50%;box-shadow:0 0 0 2px #FF5BD7,0 0 0 999px rgb(0 0 0/.45)}
.tab{display:inline-flex;align-items:center;gap:8px;background:#2B2D3A;color:#E8E8EE;border-radius:10px 10px 0 0;padding:8px 14px;font:500 12px system-ui;white-space:nowrap}
.tab img{margin:0}
footer{color:var(--muted);font-size:13px;text-align:center;padding:24px}
@media (max-width:520px){header.top,main{padding-inline:16px}.ico180{width:120px;height:120px;border-radius:26px}}
</style></head>
<body>
<header class="top">
  <div><h1>Underdog <span>theme board</span></h1>
  <p class="lede">Every theme on a real snapshot of Today and the Focus Screen. Night Clay is the reference (the app as it ships). Click a card to open the full preview; the bar in the corner of a preview flips light and dark.</p></div>
  <div class="how">Rebuild: <code>node docs/themes-v2/build.mjs [slug ...]</code> · contract: <a href="CONTRACT.md">CONTRACT.md</a></div>
</header>
<main>
  <div class="grid">${themes.map(card).join('')}</div>
  <section class="icons" aria-labelledby="icH">
    <h2 id="icH">All icons, side by side</h2>
    <p>Full tile, Android circle and squircle masks, the maskable safe zone (pink ring: everything important must sit inside it), a light home screen, and the favicon cuts in a browser tab.</p>
    <div class="tablewrap"><table>
      <thead><tr><th scope="col">Theme</th><th scope="col">180</th><th scope="col">Circle mask</th><th scope="col">Squircle</th><th scope="col">Safe zone</th><th scope="col">On light</th><th scope="col">32</th><th scope="col">16</th><th scope="col">Tab</th></tr></thead>
      <tbody>${themes.map(iconRow).join('')}</tbody>
    </table></div>
  </section>
</main>
<footer>Generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC by build.mjs · no network requests: everything is local.</footer>
<script>
  function fit(){document.querySelectorAll('.scaler').forEach(function(s){var w=s.parentElement.clientWidth;s.style.transform='scale('+(w/1280)+')'})}
  addEventListener('resize',fit);fit();
</script>
</body></html>`;
  fs.writeFileSync(P('index.html'), html);
}

// ---------------------------------------------------------------- run
console.log(`building ${slugs.join(', ')}`);
let hardErrors = 0;
for (const slug of slugs) {
  const meta = parseNotes(slug), L = lint(slug);
  for (const e of L.err) { console.log(`  ${slug}: ERROR ${e}`); hardErrors++; }
  for (const w of L.warn) console.log(`  ${slug}: warn ${w}`);
  buildPreview(slug, 'today', meta, L.city);
  buildPreview(slug, 'focus', meta, L.city);
}
if (!flags.has('--no-shots')) await shoot(slugs);
gallery();
console.log(`gallery: ${P('index.html')}`);
if (hardErrors) { console.log(`${hardErrors} contract error(s) above.`); process.exitCode = 1; }
