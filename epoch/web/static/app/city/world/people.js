// city/world/people.js · one place for people in any scene (docs/WORLD.md §10): the cast + clips (mxpeople.js), the fit maths + plan cache (people_fit.js)
// and the fit SOLVE in a Web Worker. The cloud sampling (skinned vertices) stays on the main thread; the solve is pure array math on Float32Arrays,
// so a cold load no longer freezes the page for 1-2.8 s. If the worker cannot start, the same maths runs inline (never worse than before).
//   loadPerson(file)                          -> Promise<P>  (createMxPerson)
//   cloudOf(P, clip, o)                       the sampled cloud, cached per person + clip + frames
//   solveFit(cloud, vols, base, o)            -> Promise<{ dx, dz, dyaw, dh, place, report }>   (worker)
//   standSpot(cloud, vols, near, yaw, o)      -> Promise<{ x, z, yaw, report, margin }>          (worker)
//   setTol(t)                                 seat / hand / foot tolerance (Butler 2.5 cm), main thread + worker
//   Fit                                       people_fit.js as a namespace (makeVols, evaluate, cacheGet/cachePut, props, ...)
import * as Fit from '../people_fit.js';
import { solve as solveSync, findStandSpot as standSync, setTol as setTolLocal } from './fitmath.js';
export { Fit };
export { makeContactShadow, makeLighting } from '../mxpeople.js';
export const loadPerson = (file, o = {}) => import('../mxpeople.js').then((m) => m.createMxPerson({ ...o, file }));

let tol = 0.015, worker = null, dead = false, seq = 0;
const waiting = new Map();
export function setTol(t = 0.015) { tol = t; setTolLocal(t); Fit.setTol(t); }
function spawn() {
  if (worker || dead) return worker;
  try {
    worker = new Worker(new URL('./fitworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.ok ? w.res(e.data.r) : w.rej(new Error(e.data.err)); };
    worker.onerror = () => { dead = true; const w = worker; worker = null; try { w.terminate(); } catch { /* gone */ } for (const [, p] of waiting) p.rej(new Error('fit worker failed')); waiting.clear(); };
  } catch { dead = true; worker = null; }
  return worker;
}
function ask(op, cloud, vols, a, b, o, sync) {
  const w = spawn();
  if (!w) return Promise.resolve().then(sync);
  return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); w.postMessage({ id, op, tol, cloud, vols, a, b, o }); }).catch(() => sync());
}
export const solveFit = (cloud, vols, base, o = {}) => ask('solve', cloud, vols, base, null, o, () => solveSync(cloud, vols, base, o));
export const standSpot = (cloud, vols, near, yaw, o = {}) => ask('stand', cloud, vols, near, yaw, o, () => standSync(cloud, vols, near, yaw, o)).then((r) => {
  if (r && typeof r.margin !== 'function') { const clear = o.clear ?? 0.15; r.margin = (v) => (v.kind === 'wall' || v.kind === 'shell' ? 0.02 : clear); } return r;
});
export const bookSpot = (cloud) => ask('book', cloud, null, null, null, null, () => Fit.bookOnThighs(cloud));
export function terminateFitWorker() { if (worker) { worker.terminate(); worker = null; } }

const clouds = new WeakMap();
const cloudKey = (clip, o) => clip + '|' + (o.frames || 24) + '|' + (o.stride || 4) + '|' + (o.t0 || 0) + '|' + (o.t1 || 0);
const cloudMap = (P) => { let m = clouds.get(P); if (!m) clouds.set(P, m = new Map()); return m; };
export function cloudOf(P, clip, o = { frames: 24, stride: 4 }) {      // sync (on demand, cached)
  const m = cloudMap(P), k = cloudKey(clip, o); if (!m.has(k)) m.set(k, Fit.sampleCloud(P, clip, o)); return m.get(k);
}
export async function cloudOfAsync(P, clip, o = { frames: 24, stride: 4 }) {      // yields between frames: no long task on a cold load
  const m = cloudMap(P), k = cloudKey(clip, o); if (!m.has(k)) m.set(k, await Fit.sampleCloudAsync(P, clip, o)); return m.get(k);
}
