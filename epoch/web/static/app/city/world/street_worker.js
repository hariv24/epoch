// city/world/street_worker.js · the Web Worker that builds the street's geometry from the descriptors (docs/WORLD.md 5, 12.2).
// A module worker cannot use the page's import map, so this file and kit.js import nothing from `three`: they emit typed arrays only.
// Slice 3: {t:'unit'} jobs build one streaming unit (kit.js buildUnit) and cache the emitted messages in IndexedDB (database epoch-world, store units, key id|version),
// so a second visit streams the geometry straight from disk (no building). IndexedDB is available inside workers; the main thread only receives the messages.
import { buildAll, buildUnit, KIT_VER } from './kit.js';
let dbp = null;
const db = () => dbp || (dbp = new Promise((res) => {
  try { const rq = indexedDB.open('epoch-world', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('units'); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null); } catch { res(null); }
}));
const idbGet = (k) => db().then((d) => (d ? new Promise((res) => { try { const r = d.transaction('units').objectStore('units').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch { res(null); } }) : null));
const idbPut = (k, v) => db().then((d) => (d ? new Promise((res) => { try { const t = d.transaction('units', 'readwrite'); t.objectStore('units').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch { res(false); } }) : false));
async function unitJob(m) {
  const t0 = performance.now(), key = m.unit.id + '|' + KIT_VER + '|' + (m.ver || ''), cached = m.nocache ? null : await idbGet(key);
  if (cached && cached.msgs) {
    for (const msg of cached.msgs) self.postMessage({ ...msg, uid: m.unit.id });
    self.postMessage({ t: 'unitdone', uid: m.unit.id, cached: 1, ms: Math.round(performance.now() - t0), stats: cached.stats }); return;
  }
  const acc = [], stats = buildUnit({ unit: m.unit }, (msg) => { acc.push(msg); self.postMessage({ ...msg, uid: m.unit.id }); });
  const ms = Math.round(performance.now() - t0);
  self.postMessage({ t: 'unitdone', uid: m.unit.id, cached: 0, ms, stats });
  idbPut(key, { msgs: acc, stats }).catch(() => {});
}
self.onmessage = (e) => {
  const m = e.data;
  if (m && m.t === 'unit') { unitJob(m).catch((err) => self.postMessage({ t: 'error', uid: m.unit && m.unit.id, message: String(err && err.stack || err) })); return; }
  const t0 = performance.now();
  try {
    const stats = buildAll(m, (msg, tr) => self.postMessage(msg, tr || []));
    self.postMessage({ t: 'done', stats, ms: Math.round(performance.now() - t0) });
  } catch (err) { self.postMessage({ t: 'error', message: String(err && err.stack || err) }); }
};
