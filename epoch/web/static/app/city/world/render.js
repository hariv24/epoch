// city/world/render.js · the shared renderer preset + frame loop (docs/WORLD.md §10). The brownstone (room2.js) and Butler (butler2.js) both use it.
//   createRenderer({ alpha })            WebGL2, ACES tone mapping, exposure 1, sRGB, PCF shadows rendered on demand (shadowMap.needsUpdate), antialias
//   addRoomEnvironment(renderer, scene)  PMREM of three's RoomEnvironment as scene.environment (the soft PBR fill both scenes use)
//   createLoop({ render, step, gate, throttle })   -> { kick, pause(p), renderNow, dispose, frames }
//        render on demand: frames only while step(dt, now) returns true (something moves) or for two frames after kick();
//        NEVER queues two rAFs (they compound every frame: the ROOM-V2 perf fix); pauses while the tab is hidden (and re-kicks on return);
//        gate() -> false skips drawing (off screen); throttle() -> ms minimum between draws (Butler's 15 fps picture-in-picture)
//   warm(renderer, scene, camera)       compileAsync: shader programs built off the critical path (no 0.2-0.6 s first-frame freeze)
//   createLoop({ ready })                ready: a Promise (e.g. warm(...)); nothing is drawn until it settles, so the first frame never pays the 0.2-0.3 s shader compile
//   createAdaptiveDpr(renderer, loop, {max})  -> { ratio, max, setMax(m), enabled }   dynamic resolution: start at max (min(dpr,2)); each 1 s of continuous frames,
//        p90 > 18.5 ms for 2 s steps the pixel ratio down 0.25 (floor 1), p90 < 13 ms for 4 s steps up (ceiling max); ?dpr=fixed opts out. Applies setPixelRatio + setSize (same css size).
//   installPerf(loop)                    under ?debug=1: window.__perf { stats(), reset() } = rAF-delta fps / p50 / p95 / max plus long tasks (>50 ms)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createRenderer({ alpha = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  return renderer;
}
export function addRoomEnvironment(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
}
// compile every material's programs in parallel without blocking the page (KHR_parallel_shader_compile); resolves when ready. Never rejects.
export const warm = (renderer, scene, camera) => (renderer.compileAsync ? renderer.compileAsync(scene, camera).catch(() => {}) : Promise.resolve());
export function sizeTo(renderer, camera, w, h, dpr) {
  if (dpr) renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}

export function createLoop({ render, step = () => false, gate = () => true, throttle = () => 0, ready = null }) {
  let raf = 0, needs = 2, last = 0, paused = false, disposed = false, frames = 0, waiting = !!ready;
  if (ready) Promise.resolve(ready).catch(() => {}).then(() => { waiting = false; kick(); });
  const loop = { get frames() { return frames; }, get raf() { return raf; }, get paused() { return paused; }, kick, pause, renderNow, dispose, onFrame: null };
  function kick() { needs = Math.max(needs, 2); if (!raf && !paused && !disposed && !waiting) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0; if (disposed || paused || document.hidden || !gate()) return;
    const th = throttle(); if (th && last && now - last < th) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016); last = now;
    const busy = step(dt, now);
    render(dt, now); frames++; if (loop.onFrame) loop.onFrame(now);
    if (busy || --needs > 0) { if (!raf) raf = requestAnimationFrame(frame); } else last = 0;      // a kick() during this frame may have queued one already
  }
  function pause(p) { paused = !!p; if (!paused) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function renderNow() { if (waiting) return; const r = raf; raf = 0; if (r) cancelAnimationFrame(r); last = 0; frame(performance.now()); }
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);
  function dispose() { disposed = true; if (raf) cancelAnimationFrame(raf); raf = 0; document.removeEventListener('visibilitychange', onVis); }
  return loop;
}

export function createAdaptiveDpr(renderer, loop, { max = Math.min(window.devicePixelRatio || 1, 2), floor = 1, onChange = null } = {}) {
  const enabled = !/(^|[?&])dpr=fixed(&|$)/.test(location.search);
  const a = { ratio: Math.max(floor, max), max: Math.max(floor, max), enabled, changes: 0 };
  let win = [], winStart = 0, prev = 0, lowS = 0, highS = 0, upNeed = 4, lastUp = false;
  function apply(r) {
    r = Math.min(a.max, Math.max(floor, r)); if (r === a.ratio) return; a.ratio = r; a.changes++;
    const v = renderer.getSize(new THREE.Vector2()); renderer.setPixelRatio(r); renderer.setSize(v.x, v.y, false);
    win = []; winStart = 0; prev = 0; lowS = highS = 0; if (onChange) onChange(r); loop.kick();
  }
  a.setMax = (m) => { m = Math.max(floor, m); if (m === a.max) return; const wasTop = a.ratio >= a.max; a.max = m; if (wasTop || a.ratio > m) a.ratio = m; };
  const chain = loop.onFrame;
  loop.onFrame = (now) => {
    if (chain) chain(now);
    if (!enabled) return;
    const d = prev ? now - prev : 0; prev = now;
    if (d <= 0 || d > 250) { win = []; winStart = 0; lowS = highS = 0; return; }       // idle gap / tab switch: not continuous rendering
    if (!winStart) winStart = now; win.push(d);
    if (now - winStart < 1000) return;
    if (win.length >= 20) {
      const s = win.slice().sort((x, y) => x - y), p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
      // headroom = frames steady at the display's own vsync (60 Hz: ~16.7 ms, 120 Hz: ~8.3 ms); a fixed "< 13 ms" can never pass on 60 Hz
      const p10 = s[Math.floor(s.length * 0.1)], steady = p90 < 17.5 && p90 <= Math.max(13, p10 * 1.12);
      if (p90 > 18.5) { lowS++; highS = 0; } else if (steady) { highS++; lowS = 0; } else { lowS = highS = 0; }
      if (lowS >= 2) { if (lastUp) upNeed = Math.min(32, upNeed * 2); lastUp = false; apply(a.ratio - 0.25); }
      else if (highS >= upNeed && a.ratio < a.max) { lastUp = true; apply(a.ratio + 0.25); }
    } else { lowS = highS = 0; }
    win = []; winStart = 0;
  };
  loop.dpr = a;
  return a;
}

export function installPerf(loop) {
  const d = [], lt = []; let prev = 0;
  const chain = loop.onFrame;
  loop.onFrame = (now) => { if (chain) chain(now); if (prev) d.push(now - prev); prev = now; if (d.length > 4000) d.shift(); };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  window.__perf = {
    get dpr() { return loop.dpr ? loop.dpr.ratio : null; },
    reset() { d.length = 0; lt.length = 0; prev = 0; },
    stats() { const s = [...d].sort((a, b) => a - b), q = (x) => (s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * x))].toFixed(1) : 0), sum = s.reduce((a, b) => a + b, 0); return { frames: s.length, fps: sum ? +(1000 * s.length / sum).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: s.length ? +s[s.length - 1].toFixed(1) : 0, longtasks: [...lt] }; },
  };
}
