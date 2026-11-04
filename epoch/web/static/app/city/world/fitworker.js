// city/world/fitworker.js · the fit solve off the main thread (docs/WORLD.md §10). A module worker: it cannot use the page's import map, so it imports only
// ./fitmath.js (plain arrays in, plain objects out; no `three`). Messages: { id, op: 'solve' | 'stand', tol, cloud, vols, a, b, o } -> { id, ok, r | err }.
import { solve, findStandSpot, setTol, bookOnThighs } from './fitmath.js';
self.onmessage = (e) => {
  const { id, op, tol, cloud, vols, a, b, o } = e.data;
  try {
    setTol(tol);
    const r = op === 'solve' ? solve(cloud, vols, a, o) : op === 'book' ? bookOnThighs(cloud) : findStandSpot(cloud, vols, a, b, o);
    if (r && typeof r.margin === 'function') delete r.margin;      // a function cannot be cloned (it silently dropped every stand-spot solve back onto the main thread, ~250 ms); people.js re-adds it
    self.postMessage({ id, ok: true, r });
  } catch (err) { self.postMessage({ id, ok: false, err: String((err && err.message) || err) }); }
};
