// city/decorate.js · decorating mode for the home scene (docs/COZY.md 4.2): free placement on a 0.25 m grid, Sims / Animal Crossing style.
//
//   checkEntry(room, info, e, others) -> null | { code, hint }   the same rules as epoch/layout.check (the server has the last word)
//   entryBox(info, e) -> [x0, x1, z0, z1]                         the turned footprint's bounding box of a floor entry
//   placeNear(room, catalog, id, entries, near) -> entry | null    the nearest free valid spot for a piece (like layout.place_near)
//   createDecorator(ctx) -> { enter(itemId?), exit(), on, select(id), key(e), pointer handlers, update(dt), dispose }
//
// ctx (room.js stage mode) gives: THREE, host, canvas, camera, controls, scene, motion(), say(text, tone), sfx(name), requestRender(),
//   state() -> { room, catalog, entries, storage, budget, homeWord }   (room = GET /api/home/layout `room`, catalog = its `catalog`)
//   setEntries(entries, { animate: id })   redraws the pieces where the entries say (no save)
//   groupOf(id) -> THREE.Group             the piece's own group (decorating unbakes the merged batch)
//   save(entries) -> Promise of the POST /api/home/layout result
//   thumb(id) -> Promise of a data URL (a small render of the piece for the storage drawer)
//   onExit()
// Input: mouse drag; touch: tap to select, then drag; keyboard: Tab cycles pieces, arrows move one cell, R turns 90 degrees
// (Shift+R 15 degrees), Delete sends to storage, Ctrl/Cmd+Z undoes (last 10 moves), Esc or Done leaves. Saves 400 ms after a drop.
// Reduced motion: pieces snap into place, no squash-and-settle.

const GRID = 0.25, EPS = 0.01, BOUNDS_EPS = 0.03, WALL_NEAR = 0.12, WALL_Y_MIN = 0.3, WALL_TOP_GAP = 0.1;
const HALF_PI = Math.PI / 2;
const SIZE_WORD = { studio: 'studio', '1-bed': 'one-bedroom', loft: 'loft', penthouse: 'penthouse' };
export const homeWord = (size) => SIZE_WORD[size] || 'home';

const normRy = (r) => { r = r % (2 * Math.PI); if (r > Math.PI) r -= 2 * Math.PI; else if (r <= -Math.PI) r += 2 * Math.PI; return Math.round(r * 1000) / 1000; };
const r2 = (v) => Math.round(v * 100) / 100;
export function entryBox(info, e) {
  const [w, d] = info.size, c = Math.abs(Math.cos(e.ry || 0)), s = Math.abs(Math.sin(e.ry || 0));
  const hx = (c * w) / 2 + (s * d) / 2, hz = (s * w) / 2 + (c * d) / 2;
  return [e.x - hx, e.x + hx, e.z - hz, e.z + hz];
}
const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > EPS;
function wallPose(room, info, e) {
  const wl = room.walls && room.walls[e.wall]; if (!wl) return null;
  const a = wl.lo + e.u * (wl.hi - wl.lo), h = info.size[2];
  return { a, lo: a - info.size[0] / 2, hi: a + info.size[0] / 2, y0: e.y, y1: e.y + h, wl };
}
function hides(wl, lo, hi, y0, box, height) {
  if (height <= y0 + 0.1) return false;
  const plane = wl.plane;
  if (wl.axis === 'x') return box[2] - plane < WALL_NEAR && box[3] > plane + EPS && Math.min(hi, box[1]) - Math.max(lo, box[0]) > EPS;
  return box[0] - plane < WALL_NEAR && box[1] > plane + EPS && Math.min(hi, box[3]) - Math.max(lo, box[2]) > EPS;
}
const TAKEN = { code: 'taken', hint: "That spot's taken." };
/** the server's rules, client side, so the ghost can turn red before the drop */
export function checkEntry(room, catalog, e, others) {
  const info = catalog[e.id]; if (!info) return { code: 'unknown_item', hint: 'That item is not in the shop.' };
  if (e.surface === 'wall') {
    const p = wallPose(room, info, e); if (!p) return { code: 'bad_wall', hint: 'Pick a solid wall for that.' };
    if (p.lo < p.wl.lo - BOUNDS_EPS || p.hi > p.wl.hi + BOUNDS_EPS || e.y < WALL_Y_MIN || e.y + info.size[2] > room.H - WALL_TOP_GAP) return { code: 'out_of_bounds', hint: 'That does not fit on the wall.' };
    for (const b of p.wl.blocked || []) if (Math.min(p.hi, b.a1) - Math.max(p.lo, b.a0) > EPS && Math.min(p.y1, b.y1) - Math.max(p.y0, b.y0) > EPS) return { code: 'window', hint: 'There is a window or a door there.' };
    for (const o of others) {
      const oi = catalog[o.id]; if (!oi) continue;
      if (o.surface === 'wall' && o.wall === e.wall) { const q = wallPose(room, oi, o); if (q && Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) > EPS && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > EPS) return TAKEN; }
      else if (o.surface !== 'wall' && !oi.layer && hides(p.wl, p.lo, p.hi, p.y0, entryBox(oi, o), oi.size[2])) return TAKEN;
    }
    return null;
  }
  const box = entryBox(info, e), W = room.W, D = room.D;
  if (box[0] < -W / 2 - BOUNDS_EPS || box[1] > W / 2 + BOUNDS_EPS || box[2] < -D / 2 - BOUNDS_EPS || box[3] > D / 2 + BOUNDS_EPS) return { code: 'out_of_bounds', hint: (info.name || 'That') + ' does not fit there.' };
  if (info.layer) {
    for (const o of others) { const oi = catalog[o.id]; if (oi && o.surface !== 'wall' && oi.layer === info.layer && overlap(box, entryBox(oi, o))) return TAKEN; }
    return null;
  }
  for (const ob of room.obstacles || []) if (overlap(box, [ob.x0, ob.x1, ob.z0, ob.z1])) return TAKEN;
  for (const o of others) {
    const oi = catalog[o.id]; if (!oi) continue;
    if (o.surface !== 'wall') { if (!oi.layer && overlap(box, entryBox(oi, o))) return TAKEN; }
    else { const q = wallPose(room, oi, o); if (q && hides(q.wl, q.lo, q.hi, q.y0, box, info.size[2])) return TAKEN; }
  }
  return null;
}
/** the nearest free valid entry for a piece, or null when the room is full */
export function placeNear(room, catalog, id, entries, near) {
  const info = catalog[id]; if (!info) return null;
  const others = entries.filter((x) => x.id !== id);
  if (info.surface === 'wall') {
    const cands = [];
    for (const [wid, wl] of Object.entries(room.walls || {})) {
      for (let a = wl.lo + info.size[0] / 2; a <= wl.hi - info.size[0] / 2 + 1e-9; a += GRID) {
        const x = wl.axis === 'x' ? a : wl.plane, z = wl.axis === 'x' ? wl.plane : a;
        cands.push({ d: near ? (x - near[0]) ** 2 + (z - near[1]) ** 2 : 0, e: { id, surface: 'wall', wall: wid, u: Math.round(((a - wl.lo) / (wl.hi - wl.lo)) * 10000) / 10000, y: info.wall_y || 1.3 } });
      }
    }
    cands.sort((p, q) => p.d - q.d);
    for (const c of cands) if (!checkEntry(room, catalog, c.e, others)) return c.e;
    return null;
  }
  const [nx, nz] = near || [0, 0], pts = [];
  for (let x = -room.W / 2; x <= room.W / 2 + 1e-9; x += GRID) for (let z = -room.D / 2; z <= room.D / 2 + 1e-9; z += GRID) pts.push([r2(x), r2(z)]);
  pts.sort((p, q) => ((p[0] - nx) ** 2 + (p[1] - nz) ** 2) - ((q[0] - nx) ** 2 + (q[1] - nz) ** 2));
  for (const [x, z] of pts) for (const ry of [0, HALF_PI, Math.PI, -HALF_PI]) {
    const e = { id, surface: 'floor', x, z, ry: normRy(ry) };
    if (!checkEntry(room, catalog, e, others)) return e;
  }
  return null;
}
/** snap a floor centre to the grid, then hug a wall when the footprint is within a cell of it (a bookshelf sits flush) */
function snapFloor(room, info, x, z, ry) {
  const e = { x: Math.round(x / GRID) * GRID, z: Math.round(z / GRID) * GRID, ry };
  const b = entryBox(info, e), W = room.W, D = room.D;
  if (b[2] < -D / 2 + GRID && b[2] > -D / 2 - GRID) e.z += -D / 2 - b[2];
  if (b[0] < -W / 2 + GRID && b[0] > -W / 2 - GRID) e.x += -W / 2 - b[0];
  if (b[3] > D / 2) e.z -= b[3] - D / 2;
  if (b[1] > W / 2) e.x -= b[1] - W / 2;
  if (b[2] < -D / 2) e.z += -D / 2 - b[2];
  if (b[0] < -W / 2) e.x += -W / 2 - b[0];
  e.x = r2(e.x); e.z = r2(e.z);
  return e;
}
const clean = (e) => (e.surface === 'wall' ? { id: e.id, surface: 'wall', wall: e.wall, u: e.u, y: e.y } : { id: e.id, surface: 'floor', x: e.x, z: e.z, ry: e.ry });
const same = (a, b) => JSON.stringify(a.map(clean)) === JSON.stringify(b.map(clean));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function createDecorator(ctx) {
  const THREE = ctx.THREE, host = ctx.host, canvas = ctx.canvas;
  let on = false, sel = null, drag = null, undo = [], saved = null, saveT = 0, pending = null, lastTap = { id: null, t: 0 };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const BLUE = new THREE.Color('#8cc4ee'), RED = new THREE.Color('#ff7a6b');
  // the selection outline (Columbia blue) and the footprint ghost (red where the drop would be refused)
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: BLUE, depthTest: false, transparent: true, toneMapped: false }));
  outline.renderOrder = 20; outline.visible = false; ctx.scene.add(outline);
  const ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  ghost.renderOrder = 19; ghost.visible = false; ctx.scene.add(ghost);
  const tweens = [];

  // the DOM: a toolbar along the top of the scene and a storage drawer that slides up from the bottom
  const ui = document.createElement('div'); ui.className = 'deco'; ui.hidden = true;
  ui.innerHTML = '<div class="deco__bar" role="toolbar" aria-label="Decorating your home">' +
    '<p class="deco__msg" data-deco="msg" aria-live="polite"></p>' +
    '<div class="deco__btns"><button type="button" class="deco__btn" data-deco="rotate" aria-label="Turn the selected piece (R)">Turn</button>' +
    '<button type="button" class="deco__btn" data-deco="store" aria-label="Put the selected piece in storage (Delete)">Store</button>' +
    '<button type="button" class="deco__btn" data-deco="undo" aria-label="Undo the last move (Ctrl Z)">Undo</button>' +
    '<button type="button" class="deco__btn deco__btn--done" data-deco="done">Done</button></div></div>' +
    '<div class="deco__drawer" data-deco="drawer"><div class="deco__dh"><b>Storage</b><span class="deco__cap" data-deco="cap"></span></div><ul class="deco__list" data-deco="list" aria-label="In storage"></ul></div>';
  host.appendChild(ui);
  const $ = (k) => ui.querySelector('[data-deco="' + k + '"]');
  let msgT = 0;
  function say(text, tone) { const m = $('msg'); m.textContent = text || ''; m.dataset.tone = tone || ''; clearTimeout(msgT); if (tone === 'warn') msgT = setTimeout(hint, 3200); }
  function hint() {
    const st = ctx.state(), info = sel && st.catalog[sel];
    if (info) say(info.name + (info.surface === 'wall' ? '. Drag it along the wall.' : '. Drag to move, R to turn.') + (info.activity_line ? ' ' + info.activity_line : ''));
    else say('Pick a piece to move it, or add one from storage.');
  }
  const word = () => homeWord(ctx.state().room && ctx.state().room.size);
  function capText() { const st = ctx.state(); return 'Your ' + word() + ' fits ' + st.budget + ' things. ' + st.entries.length + (st.entries.length === 1 ? ' is' : ' are') + ' out.'; }

  async function renderDrawer() {
    const st = ctx.state(), list = $('list');
    $('cap').textContent = capText();
    const items = st.storage || [];
    list.innerHTML = items.length ? items.map((s) => '<li><button type="button" class="deco__item" data-add="' + esc(s.item) + '"><span class="deco__thumb" data-thumb="' + esc(s.item) + '" aria-hidden="true"></span><span class="deco__name">' + esc(s.name || s.item) + '</span></button></li>').join('')
      : '<li class="deco__empty">Storage is empty. New furniture from the store lands here.</li>';
    for (const s of items) {
      Promise.resolve(ctx.thumb && ctx.thumb(s.item)).then((url) => { const el = list.querySelector('[data-thumb="' + CSS.escape(s.item) + '"]'); if (el && url) el.style.backgroundImage = 'url("' + url + '")'; }).catch(() => {});
    }
  }

  function info(id) { return ctx.state().catalog[id]; }
  function entryOf(id) { return ctx.state().entries.find((e) => e.id === id); }
  function select(id, opts = {}) {
    sel = id && entryOf(id) ? id : null;
    showSel();
    if (sel && !opts.quiet) hint();
    ctx.requestRender();
  }
  function showSel(cand, bad) {
    const e = cand || (sel && entryOf(sel)), inf = e && info(e.id);
    if (!e || !inf) { outline.visible = false; ghost.visible = false; return; }
    const [w, d, h] = inf.size;
    if (e.surface === 'wall') {
      const wl = ctx.state().room.walls[e.wall], a = wl.lo + e.u * (wl.hi - wl.lo), off = 0.03;
      const cx = wl.axis === 'x' ? a : wl.plane + off, cz = wl.axis === 'x' ? wl.plane + off : a;
      outline.position.set(cx, e.y + h / 2, cz); outline.rotation.set(0, wl.ry, 0); outline.scale.set(w + 0.04, h + 0.04, Math.max(d, 0.05) + 0.02);
      ghost.position.set(cx, e.y + h / 2, cz); ghost.rotation.set(0, wl.ry, 0); ghost.scale.set(w, h, 1);
    } else {
      outline.position.set(e.x, h / 2, e.z); outline.rotation.set(0, e.ry, 0); outline.scale.set(w + 0.04, h + 0.02, d + 0.04);
      const b = entryBox(inf, e);
      ghost.position.set((b[0] + b[1]) / 2, 0.016, (b[2] + b[3]) / 2); ghost.rotation.set(-HALF_PI, 0, 0); ghost.scale.set(b[1] - b[0], b[3] - b[2], 1);
    }
    outline.visible = true; ghost.visible = true;
    outline.material.color.copy(bad ? RED : BLUE); ghost.material.color.copy(bad ? RED : BLUE); ghost.material.opacity = bad ? 0.42 : 0.28;
  }

  /* ---- changes: every committed move goes through here (undo, redraw, save after 400 ms) ---- */
  function commit(next, opts = {}) {
    const st = ctx.state();
    if (same(next, st.entries)) return;
    undo.push(st.entries.map(clean)); if (undo.length > 10) undo.shift();
    ctx.setEntries(next.map(clean), { animate: opts.animate });
    if (ctx.sfx) ctx.sfx('tick');
    scheduleSave();
    showSel(); renderDrawer();
  }
  function scheduleSave() {
    clearTimeout(saveT);
    saveT = setTimeout(doSave, 400);
  }
  async function doSave() {
    const st = ctx.state(), entries = st.entries.map(clean);
    if (saved && same(saved, entries)) return;
    pending = entries;
    let res = null;
    try { res = await ctx.save(entries); } catch { res = null; }
    if (pending !== entries) return;                                           // a newer save is on its way
    pending = null;
    if (res && res.ok !== false) { saved = entries; renderDrawer(); return; }
    // refused (or offline): back to the last layout the server accepted
    const back = saved || undo[0];
    if (back) ctx.setEntries(back.map(clean), {});
    say(res && res.hint ? res.hint : "That didn't save. Nothing moved.", 'warn');
    showSel(); renderDrawer();
  }

  /* ---- pointer: raycast the pieces, drag on the floor or along a wall ---- */
  function setRay(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
  }
  function pickAt(ev) {
    setRay(ev);
    let best = null;
    for (const e of ctx.state().entries) {
      const g = ctx.groupOf(e.id); if (!g) continue;
      const hits = ray.intersectObject(g, true);
      if (hits.length && (!best || hits[0].distance < best.d)) best = { id: e.id, d: hits[0].distance };
    }
    return best && best.id;
  }
  function floorAt(ev) { setRay(ev); return ray.ray.intersectPlane(floorPlane, hit) ? hit.clone() : null; }
  function wallAt(ev) {
    setRay(ev);
    const st = ctx.state(); let best = null;
    for (const [wid, wl] of Object.entries(st.room.walls || {})) {
      const n = wl.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), pl = new THREE.Plane(n, -wl.plane);
      const p = ray.ray.intersectPlane(pl, new THREE.Vector3()); if (!p) continue;
      const a = wl.axis === 'x' ? p.x : p.z; if (a < wl.lo - 0.4 || a > wl.hi + 0.4 || p.y < 0 || p.y > st.room.H) continue;
      const dist = p.distanceTo(ray.ray.origin);
      if (!best || dist < best.dist) best = { wid, wl, a, y: p.y, dist };
    }
    return best;
  }
  function candidate(ev) {
    const st = ctx.state(), e0 = entryOf(drag.id), inf = info(drag.id); if (!e0 || !inf) return null;
    if (e0.surface === 'wall') {
      const w = wallAt(ev); if (!w) return null;
      const a = w.a + drag.offA, lo = w.wl.lo, hi = w.wl.hi, half = inf.size[0] / 2;
      const aa = Math.min(hi - half, Math.max(lo + half, Math.round(a / GRID) * GRID));
      const y = Math.min(st.room.H - WALL_TOP_GAP - inf.size[2], Math.max(WALL_Y_MIN, Math.round((w.y + drag.offY) / GRID) * GRID));
      return { id: e0.id, surface: 'wall', wall: w.wid, u: Math.round(((aa - lo) / (hi - lo)) * 10000) / 10000, y: Math.round(y * 1000) / 1000 };
    }
    const p = floorAt(ev); if (!p) return null;
    const s = snapFloor(st.room, inf, p.x + drag.offX, p.z + drag.offZ, e0.ry);
    return { id: e0.id, surface: 'floor', x: s.x, z: s.z, ry: e0.ry };
  }
  function onDown(ev) {
    if (!on || ev.button > 0) return;
    const id = pickAt(ev);
    if (!id) { drag = { none: true, x: ev.clientX, y: ev.clientY }; return; }
    const touch = ev.pointerType === 'touch';
    if (touch && sel !== id) { select(id); drag = null; return; }              // touch: the first tap selects, the next drag moves
    if (sel !== id) select(id);
    const e0 = entryOf(id);
    drag = { id, start: clean(e0), moved: false, x: ev.clientX, y: ev.clientY, pid: ev.pointerId };
    if (e0.surface === 'wall') { const w = wallAt(ev), wl = ctx.state().room.walls[e0.wall], a = wl.lo + e0.u * (wl.hi - wl.lo); drag.offA = w ? a - w.a : 0; drag.offY = w ? e0.y - w.y : 0; }
    else { const p = floorAt(ev); drag.offX = p ? e0.x - p.x : 0; drag.offZ = p ? e0.z - p.z : 0; }
    ctx.controls.enabled = false;
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* fine */ }
    ev.preventDefault();
  }
  function onMove(ev) {
    if (!on || !drag || drag.none) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 4) return;
    drag.moved = true;
    const c = candidate(ev); if (!c) return;
    const others = ctx.state().entries.filter((x) => x.id !== drag.id);
    const bad = checkEntry(ctx.state().room, ctx.state().catalog, c, others);
    drag.cand = c; drag.bad = bad;
    ctx.previewEntry(c);                                                       // the piece follows the pointer (not saved yet)
    showSel(c, !!bad);
    say(bad ? bad.hint : (info(c.id) || {}).name || '', bad ? 'warn' : '');
    ctx.requestRender();
  }
  function onUp(ev) {
    if (!on || !drag) return;
    const d = drag; drag = null; ctx.controls.enabled = true;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* fine */ }
    if (d.none) { if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5) select(null); return; }
    if (!d.moved) { const now = performance.now(); lastTap = { id: d.id, t: now }; return; }
    const st = ctx.state();
    if (!d.cand || d.bad) {
      ctx.previewEntry(d.start);
      say(d.bad ? d.bad.hint : "That spot's taken.", 'warn'); showSel(); ctx.requestRender();
      return;
    }
    commit(st.entries.map((x) => (x.id === d.id ? d.cand : x)), { animate: d.id });
  }

  /* ---- actions ---- */
  function rotate(step = HALF_PI) {
    const e = sel && entryOf(sel); if (!e || e.surface === 'wall') { if (e) say('Pictures hang straight on the wall.', 'warn'); return; }
    const inf = info(e.id), st = ctx.state(), others = st.entries.filter((x) => x.id !== e.id);
    let n = { ...clean(e), ry: normRy(e.ry + step) };
    if (checkEntry(st.room, st.catalog, n, others)) { const s = snapFloor(st.room, inf, n.x, n.z, n.ry); n = { ...n, x: s.x, z: s.z }; }
    const bad = checkEntry(st.room, st.catalog, n, others);
    if (bad) { say(bad.hint === "That spot's taken." ? 'No room to turn it here.' : bad.hint, 'warn'); return; }
    commit(st.entries.map((x) => (x.id === e.id ? n : x)), { animate: e.id });
  }
  function store() {
    const e = sel && entryOf(sel); if (!e) return;
    const name = (info(e.id) || {}).name || 'It';
    const st = ctx.state(); sel = null;
    commit(st.entries.filter((x) => x.id !== e.id));
    say(name + ' is in storage.');
  }
  function add(id, opts = {}) {
    const st = ctx.state();
    if (entryOf(id)) { select(id); return true; }
    if (st.entries.length >= st.budget) { say(capText() + ' Store something first.', 'warn'); return false; }
    const near = opts.near || [0, (st.room.D || 4) / 2 - 1.2];
    const e = placeNear(st.room, st.catalog, id, st.entries, near);
    if (!e) { say('There is no free spot for that. Move something first.', 'warn'); return false; }
    commit(st.entries.concat([e]), { animate: opts.animate === false ? null : id });
    select(id);
    return true;
  }
  function doUndo() {
    const prev = undo.pop(); if (!prev) { say('Nothing to undo.', 'warn'); return; }
    ctx.setEntries(prev, {}); scheduleSave();
    if (sel && !entryOf(sel)) sel = null;
    showSel(); renderDrawer(); say('Undone.');
  }
  function move(dx, dz) {
    const e = sel && entryOf(sel); if (!e) return;
    const st = ctx.state(), others = st.entries.filter((x) => x.id !== e.id);
    let n;
    if (e.surface === 'wall') {
      const wl = st.room.walls[e.wall], span = wl.hi - wl.lo;
      n = { ...clean(e), u: Math.round(Math.min(1, Math.max(0, e.u + (dx * GRID) / span)) * 10000) / 10000, y: Math.round((e.y - dz * GRID) * 1000) / 1000 };
    } else n = { ...clean(e), x: r2(e.x + dx * GRID), z: r2(e.z + dz * GRID) };
    const bad = checkEntry(st.room, st.catalog, n, others);
    if (bad) { showSel(n, true); ctx.previewEntry(n); ctx.requestRender(); say(bad.hint, 'warn'); setTimeout(() => { if (on) { ctx.previewEntry(clean(entryOf(e.id) || e)); showSel(); ctx.requestRender(); } }, 450); return; }
    commit(st.entries.map((x) => (x.id === e.id ? n : x)));
  }
  function cycle(dir) {
    const ids = ctx.state().entries.map((e) => e.id); if (!ids.length) return false;
    const i = sel ? ids.indexOf(sel) : -1, j = i + dir;
    if (j < 0 || j >= ids.length) return false;                                // past the ends: let Tab leave the scene
    select(ids[j]); return true;
  }
  function key(ev) {
    if (!on) return false;
    const k = ev.key, mod = ev.ctrlKey || ev.metaKey;
    if (k === 'Escape') { ev.preventDefault(); exit(); return true; }
    if (mod && (k === 'z' || k === 'Z')) { ev.preventDefault(); doUndo(); return true; }
    if (mod || ev.altKey) return false;
    if (k === 'Tab') { if (cycle(ev.shiftKey ? -1 : 1)) { ev.preventDefault(); return true; } select(null); return false; }
    if (k === 'r' || k === 'R') { ev.preventDefault(); rotate(ev.shiftKey ? Math.PI / 12 : HALF_PI); return true; }
    if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); store(); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) { ev.preventDefault(); if (!sel) cycle(1); else move(arrows[k][0], arrows[k][1]); return true; }
    return false;
  }
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.deco;
    if (a === 'done') exit();
    else if (a === 'rotate') rotate(HALF_PI);
    else if (a === 'store') store();
    else if (a === 'undo') doUndo();
    else if (b.dataset.add) add(b.dataset.add);
  });
  // long-press the Turn button for a 15-degree step (touch has no Shift)
  let lp = 0;
  ui.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-deco="rotate"]'); if (!b) return; lp = setTimeout(() => { lp = -1; rotate(Math.PI / 12); }, 450); });
  ui.addEventListener('pointerup', (e) => { if (lp > 0) clearTimeout(lp); if (lp === -1) { e.preventDefault(); lp = 0; const b = e.target.closest('[data-deco="rotate"]'); if (b) { b.dataset.skip = '1'; setTimeout(() => { delete b.dataset.skip; }, 50); } } });
  ui.addEventListener('click', (e) => { const b = e.target.closest('[data-deco="rotate"]'); if (b && b.dataset.skip) { e.stopImmediatePropagation(); } }, true);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function enter(itemId, opts = {}) {
    on = true; ui.hidden = false; host.classList.add('is-decorating');
    saved = ctx.state().entries.map(clean); undo = [];
    renderDrawer();
    if (itemId) { if (!entryOf(itemId)) add(itemId, { animate: opts.animate }); else select(itemId); }
    else hint();
    requestAnimationFrame(() => { ui.classList.add('is-open'); });
    ctx.requestRender();
  }
  function exit() {
    if (!on) return;
    clearTimeout(saveT); doSave();
    on = false; sel = null; drag = null; ui.classList.remove('is-open'); ui.hidden = true; host.classList.remove('is-decorating');
    outline.visible = false; ghost.visible = false; ctx.controls.enabled = true;
    ctx.onExit && ctx.onExit();
    ctx.requestRender();
  }
  return {
    enter, exit, select, key, add,
    get on() { return on; }, get selected() { return sel; },
    refresh() { if (on) { renderDrawer(); showSel(); } },
    update() { return false; },
    dispose() { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); ui.remove(); outline.geometry.dispose(); outline.material.dispose(); ghost.geometry.dispose(); ghost.material.dispose(); ctx.scene.remove(outline, ghost); void tweens; },
  };
}
