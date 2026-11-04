// Capture static snapshots of a running (TEMP!) Underdog app for the theme previews.
// Usage: node tools/capture.mjs http://127.0.0.1:8752 [today|focus|all]
// Writes base/today.html, base/focus.html, base/assets/{style.css,icons.svg,fonts/*,city.png,city-cam.png}.
// Never point this at the live app on :8765 (it only reads, but keep it clean).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage, sleep } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                       // docs/themes-v2
const APP = path.resolve(ROOT, '../../underdog/web/static'); // read-only source
const BASE = path.join(ROOT, 'base'), ASSETS = path.join(BASE, 'assets');
const origin = process.argv[2] || 'http://127.0.0.1:8752';
const which = process.argv[3] || 'all';
if (/:8765\b/.test(origin)) { console.error('refusing to capture the live app on :8765'); process.exit(1); }

fs.mkdirSync(path.join(ASSETS, 'fonts'), { recursive: true });

// ---- static assets (copied, URLs rewritten to be relative) ----
let css = fs.readFileSync(path.join(APP, 'app/style.css'), 'utf8').replaceAll('../vendor/fonts/', 'fonts/');
fs.writeFileSync(path.join(ASSETS, 'style.css'), css);
fs.copyFileSync(path.join(APP, 'app/icons.svg'), path.join(ASSETS, 'icons.svg'));
for (const f of fs.readdirSync(path.join(APP, 'vendor/fonts'))) fs.copyFileSync(path.join(APP, 'vendor/fonts', f), path.join(ASSETS, 'fonts', f));
fs.copyFileSync(path.join(APP, 'app/icon.svg'), path.join(ASSETS, 'icon-current.svg'));

// In-page clean-up run before serialising: drop the live canvas, put the city screenshot in its place,
// clear transient UI (toasts, confetti), and freeze entrance animations.
const PREP = (img) => `(() => {
  document.querySelectorAll('[data-js="stage"]').forEach((s) => {
    s.querySelectorAll('canvas, .fallback').forEach((c) => c.remove());
    s.classList.remove('use-svg', 'no-webgl');
    const im = document.createElement('img'); im.className = 'snap-city'; im.alt = ''; im.src = '${img}';
    s.prepend(im);
  });
  document.querySelectorAll('.toasts > *, .floaty, canvas').forEach((t) => t.remove());
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  return true;
})()`;

function rewrite(html, kind) {
  let h = html;
  h = h.replace(/<script\b[\s\S]*?<\/script>/gi, '');                         // static: no scripts at all
  h = h.replace(/<link[^>]+rel="(?:manifest|apple-touch-icon|preload)"[^>]*>/gi, '');
  h = h.replace(/<link[^>]+rel="icon"[^>]*>/gi, '<link rel="icon" href="assets/icon-current.svg" data-slot="favicon">');
  h = h.replace(/\/static\/app\/style\.css/g, 'assets/style.css');
  // file:// blocks external <use href>, so the sprite is inlined at the top of <body>
  h = h.replace(/(["'])https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?=[\/#"'])/g, '$1');   // app.js writes absolute origins
  h = h.replace(/\/static\/app\/icons\.svg#/g, '#');
  const sprite = fs.readFileSync(path.join(APP, 'app/icons.svg'), 'utf8').replace(/<svg /, '<svg id="ud-sprite" ');
  h = h.replace(/(<body[^>]*>)/i, '$1\n' + sprite);
  h = h.replace(/(href|action)="\/(?!\/)/g, '$1="#/');                           // inert links/forms
  // theme hook points: snapshot css, then the theme css (build.mjs fills THEME_CSS)
  h = h.replace('</head>', '  <link rel="stylesheet" href="assets/snapshot.css">\n  <!--THEME_HEAD-->\n</head>');
  h = h.replace(/<html([^>]*)>/i, (m, a) => '<html' + a.replace(/\sdata-theme="[^"]*"/, '') + ' data-theme="dark" data-snapshot="' + kind + '">');
  // mark the brand mark slot so build.mjs can swap in the theme icon
  h = h.replace(/(<a class="brand"[^>]*>\s*)<svg viewBox="0 0 34 34"[\s\S]*?<\/svg>/, '$1<!--BRAND_ICON--><svg viewBox="0 0 34 34" aria-hidden="true" data-slot="brand"><rect x="4" y="9" width="17" height="22" rx="4" fill="#F59E0B"/><rect x="21" y="16" width="9" height="15" rx="3" fill="#5B4BDB"/><rect x="8" y="13" width="3.6" height="3.6" rx="1" fill="#FFF7E8"/><rect x="14" y="13" width="3.6" height="3.6" rx="1" fill="#FFF7E8"/><rect x="8" y="20" width="3.6" height="3.6" rx="1" fill="#FFF7E8"/><rect x="24" y="21" width="3" height="3" rx="1" fill="#FFF7E8"/></svg><!--/BRAND_ICON-->');
  return '<!doctype html>\n' + h;
}

const SNAP_CSS = `/* snapshot-only rules (not part of the app). The 3D canvas is replaced by a still of the real city. */
.stage > .snap-city{position:absolute;inset:0;inline-size:100%;block-size:100%;object-fit:cover;display:block;z-index:0}
.stage > :not(.snap-city){z-index:1}
/* city tint layer driven by city.json (build.mjs sets --city-tint / --city-tint-blend / --city-tint-opacity) */
.stage::after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:var(--city-tint,none);
  mix-blend-mode:var(--city-tint-blend,normal);opacity:var(--city-tint-opacity,0)}
.view,.o-1,.o-2,.o-3,.o-4,.o-5,.o-6,[class*="o-"]{animation:none !important}
`;
fs.writeFileSync(path.join(ASSETS, 'snapshot.css'), SNAP_CSS);

const port = 9450 + Math.floor(Math.random() * 40);
const c = await launch(port);
const p = await newPage(port);
try {
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await p.ev(`1`);
  if (which === 'all' || which === 'today') {
    await p.viewport(1280, 900);
    await p.goto(origin + '/', 6500);
    await p.ev(`document.documentElement.dataset.theme='dark'`);
    await sleep(1500);
    await p.ev(`(()=>{const s=document.querySelector('[data-js="stage"]'); s.scrollIntoView({block:'center'}); return true})()`);
    await sleep(1500);
    // the city still: 2x for crispness
    const r = await p.ev(`(()=>{const b=document.querySelector('[data-js="stage"]').getBoundingClientRect(); return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}})()`);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    await sleep(2500);
    const r2 = await p.ev(`(()=>{const b=document.querySelector('[data-js="stage"]').getBoundingClientRect(); return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}})()`);
    // hide overlays so the still is the bare scene
    await p.ev(`document.querySelectorAll('[data-js="stage"] > :not(canvas)').forEach(e=>e.style.visibility='hidden')`);
    await sleep(300);
    const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: r2.x, y: r2.y, width: r2.w, height: r2.h, scale: 1 }, captureBeyondViewport: true });
    fs.writeFileSync(path.join(ASSETS, 'city.png'), Buffer.from(shot.data, 'base64'));
    await p.ev(`document.querySelectorAll('[data-js="stage"] > :not(canvas)').forEach(e=>e.style.visibility='')`);
    await p.viewport(1280, 900);
    await p.ev(`scrollTo(0,0)`);
    await p.ev(PREP('assets/city.png'));
    const html = await p.ev(`document.documentElement.outerHTML`);
    fs.writeFileSync(path.join(BASE, 'today.html'), rewrite(html, 'today'));
    console.log('today ok; stage', JSON.stringify(r), 'errors', p.errors.length);
  }
  if (which === 'all' || which === 'focus') {
    await p.viewport(1280, 800);
    await p.goto(origin + '/pomodoro', 6500);
    await p.ev(`document.documentElement.dataset.theme='dark'`);
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(3000);
    const r = await p.ev(`(()=>{const s=document.querySelector('[data-js="stage"]'); if(!s) return null; const b=s.getBoundingClientRect(); return {x:b.x+scrollX,y:b.y+scrollY,w:b.width,h:b.height}})()`);
    if (r) {
      await p.ev(`document.querySelectorAll('[data-js="stage"] > :not(canvas)').forEach(e=>e.style.visibility='hidden')`);
      await sleep(300);
      const shot = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 }, captureBeyondViewport: true });
      fs.writeFileSync(path.join(ASSETS, 'city-cam.png'), Buffer.from(shot.data, 'base64'));
      await p.ev(`document.querySelectorAll('[data-js="stage"] > :not(canvas)').forEach(e=>e.style.visibility='')`);
    }
    await p.viewport(1280, 800);
    await p.ev(PREP('assets/city-cam.png'));
    const html = await p.ev(`document.documentElement.outerHTML`);
    fs.writeFileSync(path.join(BASE, 'focus.html'), rewrite(html, 'focus'));
    console.log('focus ok; stage', JSON.stringify(r), 'errors', p.errors.length);
  }
  if (p.errors.length) console.log(p.errors.slice(0, 8).join('\n'));
} finally { c.proc.kill(); fs.rmSync(c.dir, { recursive: true, force: true }); }
