// city/thumbs.js · small 3D pictures of furniture and outfits for the store, the chest reward card and "Place it now" (docs/COZY.md 4.3).
//   ONE shared offscreen WebGL renderer for the whole page (never one per card). It is created on first use and can be let go with release().
//   itemThumb(id, category, { size })  -> Promise<string|null>   an object URL of a 3/4 view of room.js ITEM_MODELS[id] (category fallback)
//   figureThumb(outfit, { size })      -> Promise<string|null>   the faceless figure (character.js buildFigure) wearing that outfit
//   spin(canvas, spec, { size })       -> { stop() }             slow turntable drawn into a card's own 2D canvas (hover / focus); one at a time
//   supported()                        -> boolean                WebGL2 is there (no WebGL: callers keep their flat SVG glyph)
//   release()                          -> frees the renderer and its GL context (the Today page calls it after a reward card)
// Cache: object URLs in memory, and a small webp data URL per picture in localStorage (keyed by this file's fingerprinted URL, so a new
// build of the models never shows a stale picture). Everything is wrapped: a failure gives null and the caller keeps its glyph.
import * as THREE from 'three';
import { Geo, rng } from './util.js';
import { modelFor } from './room.js';
import { buildFigure, figureMaterial, glowMaterial } from './character.js';

const VER = (() => { let h = 0; const s = String(import.meta.url).replace(/[?#].*$/, ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); })();
const PREFIX = 'witness.app.thumb.';
const mem = new Map();          // key -> object URL
const pending = new Map();      // key -> Promise
let R = null;                   // { renderer, scene, camera, solid, shadow, out2d }
let okGL = null;
let active = null;              // the one running spin

export function supported() {
  if (okGL !== null) return okGL;
  try { const c = document.createElement('canvas'); okGL = !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch { okGL = false; }
  return okGL;
}

function sweepOld() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX) && !k.startsWith(PREFIX + VER + '.')) drop.push(k); }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage blocked */ }
}

function ensure() {
  if (R) return R;
  if (!supported()) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(1); renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7d7266, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe0ff, 0.9); rim.position.set(-4, 2.5, -3); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 80);
  // a soft contact shadow (a radial blob on the floor), shared by every picture
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(8,20,40,0.42)'); gr.addColorStop(1, 'rgba(8,20,40,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(c);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = -1; scene.add(shadow);
  const out2d = document.createElement('canvas');
  R = { renderer, scene, camera, solid: new THREE.MeshLambertMaterial({ vertexColors: true }), shadow, shadowTex, out2d };
  sweepOld();
  return R;
}

export function release() {
  if (active) active.stop();
  if (!R) return;
  try {
    R.solid.dispose(); R.shadow.geometry.dispose(); R.shadow.material.dispose(); R.shadowTex.dispose();
    R.renderer.dispose(); R.renderer.forceContextLoss();
  } catch { /* already gone */ }
  R = null;
}

function seedOf(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) % 99991; return h + 3; }

/* build the object for a spec: { kind:'item', id, category } or { kind:'figure', outfit } -> { obj, mount, dispose } */
function buildObject(spec) {
  const r = ensure(); if (!r) return null;
  if (spec.kind === 'figure') {
    const f = buildFigure(spec.outfit || 'everyday');
    f.setPose('stand');
    const obj = new THREE.Group(); obj.add(f.root);
    return { obj, mount: 'figure', dispose: () => f.dispose() };
  }
  const m = modelFor(spec.id, spec.category), g = new Geo(), gl = new Geo(), rr = rng(seedOf(String(spec.id)));
  const H = 2.9;
  if (m.mount === 'wall') m.build(g, gl, rr, m.y || 1.3); else m.build(g, gl, rr, H);
  const obj = new THREE.Group();
  const meshes = [];
  if (!g.empty) { const me = new THREE.Mesh(g.build(), r.solid); obj.add(me); meshes.push(me); }
  if (!gl.empty) { const me = new THREE.Mesh(gl.build(), glowMaterial()); obj.add(me); meshes.push(me); }
  return { obj, mount: m.mount, dispose: () => meshes.forEach((me) => me.geometry.dispose()) };
}

/* frame the camera on the object (a calm 3/4 view; rugs from higher up, wall pieces from the front) and place the contact shadow */
function frame(built, turn = 0) {
  const { camera, shadow } = R, obj = built.obj;
  obj.rotation.y = 0; obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  obj.position.set(-ctr.x, -box.min.y, -ctr.z);            // centred on the turntable, standing on y = 0
  const pivot = obj.parent && obj.parent.userData.pivot ? obj.parent : null;
  if (pivot) pivot.rotation.y = turn; else obj.rotation.y = turn;
  const rad = Math.max(0.15, size.length() / 2);
  const el = built.mount === 'rug' ? 0.95 : built.mount === 'wall' ? 0.16 : built.mount === 'figure' ? 0.22 : 0.42;
  const az = built.mount === 'wall' ? 0.28 : 0.62;
  const dist = rad / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (built.mount === 'figure' ? 0.98 : 1.04);
  const ty = built.mount === 'rug' ? 0 : size.y * 0.48;
  camera.position.set(Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(0, ty, 0); camera.updateProjectionMatrix();
  const sw = Math.max(size.x, size.z) * 1.35 + 0.2;
  shadow.scale.set(sw, sw, 1); shadow.position.set(0, 0.002, 0); shadow.visible = built.mount !== 'wall';
}

function draw(built, px, turn) {
  const { renderer, scene, camera, out2d } = R;
  if (renderer.domElement.width !== px) renderer.setSize(px, px, false);
  camera.aspect = 1;
  const pivot = new THREE.Group(); pivot.userData.pivot = true; pivot.add(built.obj); scene.add(pivot);
  frame(built, turn);
  renderer.render(scene, camera);
  scene.remove(pivot); pivot.remove(built.obj);
  if (out2d.width !== px) { out2d.width = px; out2d.height = px; }
  const x = out2d.getContext('2d'); x.clearRect(0, 0, px, px); x.drawImage(renderer.domElement, 0, 0);
  return out2d;
}

function keyOf(spec, px) { return (spec.kind === 'figure' ? 'fig.' + (spec.outfit || 'everyday') : 'item.' + spec.id) + '.' + px; }

function fromStore(key) {
  try { return localStorage.getItem(PREFIX + VER + '.' + key); } catch { return null; }
}
function toStore(key, dataUrl) {
  if (!dataUrl || dataUrl.length > 90000) return;
  try { localStorage.setItem(PREFIX + VER + '.' + key, dataUrl); } catch { /* full or blocked: memory only */ }
}
function dataUrlToBlobUrl(d) {
  try {
    const [head, b64] = d.split(','), mime = (/data:([^;]+)/.exec(head) || [])[1] || 'image/png', bin = atob(b64), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([a], { type: mime }));
  } catch { return null; }
}

const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 16));
let chain = Promise.resolve();   // pictures are drawn one after another, in idle time, so the page never stutters

function picture(spec, opts = {}) {
  const css = Math.max(48, Math.min(320, opts.size || 160)), px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
  const key = keyOf(spec, px);
  if (mem.has(key)) return Promise.resolve(mem.get(key));
  if (pending.has(key)) return pending.get(key);
  const stored = fromStore(key);
  if (stored) { const u = dataUrlToBlobUrl(stored); if (u) { mem.set(key, u); return Promise.resolve(u); } }
  if (!supported()) return Promise.resolve(null);
  const p = (chain = chain.then(() => new Promise((resolve) => idle(() => {
    let built = null;
    try {
      if (!ensure()) { resolve(null); return; }
      built = buildObject(spec); if (!built) { resolve(null); return; }
      const cv = draw(built, px, 0);
      let d = null; try { d = cv.toDataURL('image/webp', 0.86); if (!/^data:image\/webp/.test(d)) d = cv.toDataURL('image/png'); } catch { d = null; }
      toStore(key, d);
      const u = d ? dataUrlToBlobUrl(d) : null;
      if (u) mem.set(key, u);
      resolve(u);
    } catch (e) { console.warn('thumbs', e); resolve(null); }
    finally { try { built && built.dispose(); } catch { /* fine */ } pending.delete(key); }
  }))));
  pending.set(key, p);
  return p;
}

export const itemThumb = (id, category, opts) => picture({ kind: 'item', id, category }, opts);
export const figureThumb = (outfit, opts) => picture({ kind: 'figure', outfit }, opts);

/* a slow turn drawn into the card's own canvas (only the shared renderer draws; the card canvas is a plain 2D canvas) */
export function spin(canvas, spec, opts = {}) {
  if (active) active.stop();
  if (!canvas || !ensure()) return { stop() {} };
  const css = opts.size || canvas.clientWidth || 160, px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  const ctx = canvas.getContext('2d');
  let built = null; try { built = buildObject(spec); } catch { built = null; }
  if (!built) return { stop() {} };
  let raf = 0, last = 0, turn = 0, stopped = false;
  const speed = opts.speed || 0.55;                          // radians a second: a slow, calm turn
  const tick = (t) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (document.hidden) return;
    if (last && t - last < 33) return;                       // about 30 frames a second is plenty
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    turn += dt * speed;
    try { const cv = draw(built, px, turn); ctx.clearRect(0, 0, px, px); ctx.drawImage(cv, 0, 0); } catch { handle.stop(); }
  };
  const handle = {
    stop() { if (stopped) return; stopped = true; cancelAnimationFrame(raf); try { built.dispose(); } catch { /* fine */ } if (active === handle) active = null; },
  };
  active = handle;
  raf = requestAnimationFrame(tick);
  return handle;
}

export function cacheInfo() { return { ver: VER, memory: mem.size, gl: !!R }; }
