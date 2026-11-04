// city/spots/butler.js · the Butler Library reading room (docs/COZY.md section 4.5, "the reference recipe"). The user's first
// impression of studying in Epoch, so it is the most detailed spot.
//   One end bay of a long limestone hall: three tall arched windows with warm oak reveals on the left wall (the view out is Low
//   Library's dome across the South Lawn), dark oak bookcases with procedural spines on the right wall and the end wall, a deep
//   blue-grey coffered ceiling with gold rosettes, a wall clock on New York time over the door, two rows of long oak tables with
//   green banker's lamps (one per two seats) and their warm pools, 10 faceless students, dust in the window light.
// The same builder makes the grand reading room on Fifth Ave (variant 'rose'): a taller, longer hall, a painted-sky ceiling in
// gilded frames, chandeliers and brass lamps.
// Budget: about 70k triangles and under 20 draw calls before the user's figure (docs/COZY.md section 7).
import * as THREE from 'three';
import {
  Geo, C, hc, rng, shade, clamp, lerp, Quads, createCrowd, personLook, mergeColored, chairGeo, bankersLamp, laptop, openBook, books, booksZ,
  clockFace, clockHands, createGlass, createMotes, paintView, setSit, setStand, setWalk, seatedArms, applyArms, nyTime, paneTex,
} from './kit.js';

export function build(ctx) {
  const { mats } = ctx, rose = ctx.variant === 'rose';
  const X0 = -6, X1 = 6, Z0 = -6, Z1 = rose ? 17 : 14, H = rose ? 10.6 : 9;
  const r = rng(rose ? 515 : 114);
  const group = new THREE.Group(); group.name = rose ? 'rose-room' : 'butler';
  const g = new Geo(), lampG = new Geo(), glowG = new Geo(), goldG = new Geo(), extra = [];
  const pools = new Quads(), shadows = new Quads();
  const LIME = C(rose ? '#e8dcc6' : '#e9e1d0'), LIME2 = C(rose ? '#d9cab0' : '#d9cfbb'), OAK = C('#6e4a2c'), OAK2 = C('#563823'), OAK_TOP = C('#86603c');
  const windows = rose ? [-3.4, 1.6, 6.6, 11.6] : [-4.4, -0.4, 3.6, 7.6];
  const WIN = { w: 2.3, y0: rose ? 3.2 : 2.3, y1: rose ? 7.6 : 6.4 }, WR = WIN.w / 2;

  /* ---------------------------------------------------------------- floor: oak planks, the aisle runner */
  for (let x = X0; x < X1 - 1e-3; x += 0.2) {
    let z = Z0;
    while (z < Z1) { const l = 1.2 + r() * 1.4, z1 = Math.min(Z1, z + l); g.box(x, -0.05, z, x + 0.2, 0, z1, shade(C(rose ? '#8a6640' : '#7b5634'), 0.86 + r() * 0.24), { sides: 0 }); z = z1 + 0.004; }
  }
  g.box(-1.05, 0, Z0 + 0.4, 1.05, 0.012, Z1, C('#2c4a3d'), { sides: 0 });
  for (const s of [-1, 1]) g.box(s * 0.98 - 0.05, 0.012, Z0 + 0.4, s * 0.98 + 0.05, 0.016, Z1, C('#9a7a46'), { sides: 0 });

  /* ---------------------------------------------------------------- the window wall (x = -6): stone, three arched openings, oak reveals */
  const T = 0.6;                                               // wall thickness: the reveals are this deep
  const archTop = (dz) => WIN.y1 + Math.sqrt(Math.max(0, WR * WR - dz * dz));
  const openings = windows.map((zc) => ({ z0: zc - WR, z1: zc + WR, zc }));
  {
    let z = Z0;
    const wallBox = (za, zb, ya, yb) => { if (zb - za > 1e-3 && yb - ya > 1e-3) g.box(X0 - T, ya, za, X0, yb, zb, LIME, { sides: 4 | 1 | 2, top: false }); };
    for (const o of openings) {
      wallBox(z, o.z0, 0, H); wallBox(o.z0, o.z1, 0, WIN.y0);
      const N = 10;                                            // the stone above the arch, in thin slices that follow the curve
      for (let k = 0; k < N; k++) { const a = o.z0 + (k / N) * WIN.w, b = o.z0 + ((k + 1) / N) * WIN.w, top = archTop((a + b) / 2 - o.zc); wallBox(a, b, top, H); }
      z = o.z1;
    }
    wallBox(z, Z1, 0, H);
    for (const o of openings) {
      // oak reveals: the jambs, a deep sill, the arch soffit in slices
      g.box(X0 - T, WIN.y0, o.z0, X0, WIN.y1, o.z0 + 0.04, OAK); g.box(X0 - T, WIN.y0, o.z1 - 0.04, X0, WIN.y1, o.z1, OAK);
      g.box(X0 - T, WIN.y0 - 0.1, o.z0 - 0.08, X0 + 0.22, WIN.y0, o.z1 + 0.08, OAK_TOP);
      const N = 12;
      for (let k = 0; k < N; k++) { const a = o.z0 + (k / N) * WIN.w, b = o.z0 + ((k + 1) / N) * WIN.w, top = archTop((a + b) / 2 - o.zc); g.box(X0 - T, top - 0.05, a, X0, top, b, OAK, { sides: 0, bottom: true, top: false }); }
      // mullions and transoms (dark bronze), the arch's fan of bars
      const mx = X0 - T * 0.55, MC = C('#2e261f');
      for (const dz of [-WR / 3, WR / 3]) { const top = archTop(dz); g.box(mx - 0.03, WIN.y0, o.zc + dz - 0.025, mx + 0.03, top, o.zc + dz + 0.025, MC); }
      for (let y = WIN.y0 + 1.03; y < WIN.y1 + 0.01; y += 1.03) g.box(mx - 0.03, y - 0.025, o.z0, mx + 0.03, y + 0.025, o.z1, MC);
      for (let k = 0; k <= 8; k++) { const a = Math.PI * (k / 8); g.bar([mx, WIN.y1 + Math.sin(a) * WR * 0.35, o.zc - Math.cos(a) * WR * 0.35], [mx, WIN.y1 + Math.sin(a) * WR * 0.97, o.zc - Math.cos(a) * WR * 0.97], 0.04, MC); }
    }
  }
  // pilasters between the windows, a stone base course, an oak dado, the cornice
  const pil = [];
  for (let i = 0; i <= windows.length; i++) { const z = i === 0 ? windows[0] - 2.1 : i === windows.length ? windows[i - 1] + 2.1 : (windows[i - 1] + windows[i]) / 2; if (z > Z0 + 0.2 && z < Z1 - 0.2) pil.push(z); }
  const corniceY = H - 1.0;
  for (const z of pil) {
    g.box(X0, 0, z - 0.38, X0 + 0.2, corniceY, z + 0.38, LIME2);
    g.box(X0, 0, z - 0.46, X0 + 0.28, 0.42, z + 0.46, shade(LIME2, 0.86));
    g.box(X0, corniceY - 0.4, z - 0.46, X0 + 0.28, corniceY, z + 0.46, shade(LIME2, 1.04));
  }
  g.box(X0, 0, Z0, X0 + 0.06, 1.25, Z1, OAK2);
  for (let z = Z0 + 0.2; z < Z1 - 0.5; z += 1.1) g.box(X0 + 0.06, 0.18, z, X0 + 0.075, 1.07, z + 0.9, shade(OAK2, 1.12), { top: false });
  for (const [x0, x1] of [[X0, X0 + 0.35], [X1 - 0.35, X1]]) {
    g.box(x0, corniceY, Z0, x1, corniceY + 0.22, Z1, shade(LIME, 0.96)); g.box(x0 + (x0 < 0 ? 0 : 0.1), corniceY + 0.22, Z0, x1 - (x0 < 0 ? 0.1 : 0), corniceY + 0.5, Z1, shade(LIME, 1.02));
  }

  /* ---------------------------------------------------------------- the right wall (x = +6): dark oak bookcases under limestone */
  const BH = 3.1, BD = 0.46, SH = 7;
  g.box(X1, 0, Z0, X1 + 0.3, H, Z1, LIME, { sides: 8, top: false });
  g.box(X1 - BD, 0, Z0, X1, 0.12, Z1, OAK2);
  g.box(X1 - BD - 0.04, BH, Z0, X1, BH + 0.16, Z1, OAK);
  for (let z = Z0; z <= Z1 - 0.9; z += 1.0) {
    g.box(X1 - BD, 0.12, z, X1, BH, z + 0.04, OAK);
    for (let k = 0; k < SH; k++) {
      const y = 0.14 + (k * (BH - 0.2)) / SH; g.box(X1 - BD, y, z + 0.04, X1, y + 0.03, z + 1.0, OAK);
      booksZ(g, z + 0.06, z + 0.98, y + 0.03, X1 - 0.02, X1 - BD + 0.04, r, Math.min(0.34, (BH - 0.2) / SH - 0.06));
    }
  }
  g.box(X1 - 0.01, 0.12, Z0, X1, BH, Z1, shade(OAK2, 0.6), { sides: 8, top: false });
  for (const z of pil) { g.box(X1 - 0.2, BH + 0.16, z - 0.38, X1, corniceY, z + 0.38, LIME2); g.box(X1 - 0.28, corniceY - 0.4, z - 0.46, X1, corniceY, z + 0.46, shade(LIME2, 1.04)); }
  // high blind arches between the pilasters (a quiet echo of the windows)
  for (let i = 0; i + 1 < pil.length; i++) { const zc = (pil[i] + pil[i + 1]) / 2; g.box(X1 - 0.05, BH + 0.9, zc - 1.0, X1, corniceY - 0.7, zc + 1.0, shade(LIME, 0.9), { top: false }); }

  /* ---------------------------------------------------------------- the end wall (z = -6): a doorway, bookcases, the clock, a lunette */
  const DW = 1.0, DH = 3.2;
  g.box(X0 - T, 0, Z0 - 0.4, -DW, H, Z0, LIME, { sides: 1, top: false }); g.box(DW, 0, Z0 - 0.4, X1 + 0.3, H, Z0, LIME, { sides: 1, top: false });
  g.box(-DW, DH + DW, Z0 - 0.4, DW, H, Z0, LIME, { sides: 1, top: false });
  for (let k = 0; k < 10; k++) { const a = -DW + (k / 10) * 2 * DW, b = -DW + ((k + 1) / 10) * 2 * DW, m = (a + b) / 2, top = DH + Math.sqrt(Math.max(0, DW * DW - m * m)); g.box(a, top, Z0 - 0.4, b, DH + DW, Z0, LIME, { sides: 1 | 4 | 8, bottom: true, top: false }); g.box(a, top - 0.06, Z0 - 0.4, b, top, Z0 + 0.02, OAK, { sides: 1, bottom: true }); }
  g.box(-DW - 0.12, 0, Z0, -DW, DH, Z0 + 0.08, OAK); g.box(DW, 0, Z0, DW + 0.12, DH, Z0 + 0.08, OAK);
  g.box(-DW, 0, Z0 - 0.4, -DW + 0.02, DH, Z0, OAK2); g.box(DW - 0.02, 0, Z0 - 0.4, DW, DH, Z0, OAK2);
  // the corridor beyond: a warm, dim hall
  g.box(-DW, 0, Z0 - 3, DW, DH + DW, Z0 - 2.98, C('#4a3826'), { sides: 1, top: false });
  g.box(-DW, -0.02, Z0 - 3, DW, 0, Z0 - 0.4, C('#5a4029'), { sides: 0 });
  lampG.box(-0.25, DH - 0.4, Z0 - 2.95, 0.25, DH - 0.1, Z0 - 2.9, hc('#ffcf8a', 1.6), { sides: 1 });
  for (const [x0, x1] of [[X0, -DW - 0.25], [DW + 0.25, X1 - BD]]) {
    g.box(x0, 0, Z0, x1, 0.12, Z0 + BD, OAK2); g.box(x0, BH, Z0, x1, BH + 0.16, Z0 + BD + 0.04, OAK);
    for (let x = x0; x < x1 - 0.5; x += 1.0) {
      const xb = Math.min(x1, x + 1.0); g.box(x, 0.12, Z0, x + 0.04, BH, Z0 + BD, OAK);
      for (let k = 0; k < SH; k++) { const y = 0.14 + (k * (BH - 0.2)) / SH; g.box(x + 0.04, y, Z0, xb, y + 0.03, Z0 + BD, OAK); books(g, x + 0.06, xb - 0.02, y + 0.03, Z0 + 0.02, Z0 + BD - 0.04, r, Math.min(0.34, (BH - 0.2) / SH - 0.06)); }
    }
  }
  // the clock, in a carved stone frame over the door; a lunette above with a gilt edge
  const CK = { x: 0, y: DH + DW + 1.15, z: Z0 + 0.06, r: 0.56 };
  g.box(-0.95, CK.y - 0.85, Z0, 0.95, CK.y + 0.85, Z0 + 0.05, shade(LIME2, 0.96));
  extra.push(...clockFace(CK.x, CK.y, CK.z, CK.r));
  const hands = clockHands(CK.r, mats); hands.group.position.set(CK.x, CK.y, CK.z + 0.075); group.add(hands.group);
  {
    const ly = CK.y + 1.25, lr = 2.4;
    for (let k = 0; k < 16; k++) { const a0 = Math.PI * (k / 16), a1 = Math.PI * ((k + 1) / 16); g.quad([-Math.cos(a1) * lr, ly + Math.sin(a1) * lr * 0.55, Z0 + 0.01], [-Math.cos(a0) * lr, ly + Math.sin(a0) * lr * 0.55, Z0 + 0.01], [0, ly, Z0 + 0.01], [0, ly, Z0 + 0.01], C(rose ? '#6b7f9a' : '#8ea3b4')); g.bar([-Math.cos(a0) * lr, ly + Math.sin(a0) * lr * 0.55, Z0 + 0.03], [-Math.cos(a1) * lr, ly + Math.sin(a1) * lr * 0.55, Z0 + 0.03], 0.05, C('#a8884a')); }
    g.box(-lr, ly - 0.03, Z0 + 0.01, lr, ly + 0.03, Z0 + 0.05, C('#a8884a'));
  }
  g.box(X0, corniceY, Z0, X1, corniceY + 0.22, Z0 + 0.3, shade(LIME, 0.96)); g.box(X0, corniceY + 0.22, Z0, X1, corniceY + 0.5, Z0 + 0.4, shade(LIME, 1.02));

  /* ---------------------------------------------------------------- the ceiling: deep blue-grey coffers, gold rosettes (or the painted sky) */
  g.box(X0 - T, H, Z0 - 0.4, X1 + 0.3, H + 0.3, Z1, C('#26344c'), { sides: 0, bottom: true, top: false });
  const CS = 1.5;
  if (!rose) {
    for (let x = X0; x <= X1 + 1e-3; x += CS) { g.box(x - 0.12, H - 0.42, Z0, x + 0.12, H, Z1, C('#3a4a64'), { top: false, bottom: true }); goldG.box(x - 0.13, H - 0.43, Z0, x - 0.1, H - 0.4, Z1, hc('#c9a24e', 0.75), { top: false, bottom: true }); goldG.box(x + 0.1, H - 0.43, Z0, x + 0.13, H - 0.4, Z1, hc('#c9a24e', 0.75), { top: false, bottom: true }); }
    for (let z = Z0; z <= Z1 + 1e-3; z += CS) g.box(X0, H - 0.42, z - 0.12, X1, H, z + 0.12, C('#3a4a64'), { top: false, bottom: true });
    for (let x = X0 + CS / 2; x < X1; x += CS) for (let z = Z0 + CS / 2; z < Z1; z += CS) { goldG.cyl(x, z, H - 0.03, H - 0.01, 0.16, 0.16, 8, hc('#e2b85a', 1.0), { top: false, bottom: true }); goldG.cyl(x, z, H - 0.05, H - 0.03, 0.06, 0.06, 6, hc('#ffd88a', 1.4), { top: false, bottom: true }); }
  } else {
    // the Rose room: a painted sky in gilded frames
    for (let x = X0 + 0.5; x < X1 - 0.5; x += 5.5) for (let z = Z0 + 0.5; z < Z1 - 0.5; z += 5.2) {
      const x1 = Math.min(X1 - 0.5, x + 5), z1 = Math.min(Z1 - 0.5, z + 4.7);
      g.quad([x, H - 0.02, z], [x1, H - 0.02, z], [x1, H - 0.02, z1], [x, H - 0.02, z1], [C('#a9c6e4'), C('#c9dcef'), C('#f0e2c8'), C('#d9c6b0')]);
      for (const [a, b] of [[[x, z], [x1, z]], [[x1, z], [x1, z1]], [[x1, z1], [x, z1]], [[x, z1], [x, z]]]) goldG.bar([a[0], H - 0.06, a[1]], [b[0], H - 0.06, b[1]], 0.14, hc('#d9b04f', 1.0));
    }
  }

  /* ---------------------------------------------------------------- tables, chairs, lamps */
  const tableZ = rose ? [-3.6, -0.4, 2.8, 6.0, 9.2] : [-3.9, -0.9, 2.1, 5.1];
  const rowX = [[-5.4, -1.25], [1.25, 5.4]], seatsX = (xa) => [0, 1, 2, 3].map((k) => xa + 0.55 + k * 1.03);
  const lampSpots = [];
  for (const zt of tableZ) for (const [xa, xb] of rowX) {
    g.box(xa, 0.74, zt - 0.62, xb, 0.79, zt + 0.62, OAK_TOP);
    g.box(xa + 0.08, 0.62, zt - 0.54, xb - 0.08, 0.74, zt + 0.54, OAK);
    for (const lx of [xa + 0.14, (xa + xb) / 2, xb - 0.14]) for (const lz of [zt - 0.48, zt + 0.48]) g.cyl(lx, lz, 0, 0.62, 0.05, 0.065, 6, OAK2);
    g.box(xa + 0.1, 0.79, zt - 0.05, xb - 0.1, 0.86, zt + 0.05, OAK);              // the low book rail down the middle
    shadows.flat((xa + xb) / 2, 0.004, zt, xb - xa + 0.6, 2.6, [1, 1, 1]);
    for (const sx of seatsX(xa)) {
      const ry = rose ? 0 : 0;
      const p = bankersLamp(g, lampG, sx, 0.86, zt, ry, rose ? '#8a6a2a' : '#1f6b47'); lampSpots.push({ x: p.x, y: p.y, z: p.z, zt });
      pools.flat(sx, 0.795, zt, 1.25, 1.15, hc('#ffcf8a', 0.75));
      pools.flat(sx, 0.94, zt, 0.62, 0.5, hc('#ffe0a8', 0.35));
    }
  }
  // the user's place: the window-side row of the near table, back to the camera (we look over their shoulder at the hall)
  const seat = { x: -1.76, z: 5.1 + 0.85, ry: Math.PI, table: 5.1 };
  if (rose) { seat.z = 6.0 + 0.85; seat.table = 6.0; }
  const chairsTaken = new Set();
  const seatKey = (x, z) => x.toFixed(2) + ',' + z.toFixed(2);
  for (const zt of tableZ) for (const [xa] of rowX) for (const sx of seatsX(xa)) for (const side of [-1, 1]) {
    const z = zt + side * 0.85, ry = side < 0 ? 0 : Math.PI, jx = (r() - 0.5) * 0.08, jr = (r() - 0.5) * 0.18;
    chairGeo(g, sx + jx, z + side * (r() < 0.2 ? 0.18 : 0), ry + jr, C(rose ? '#6a4a2c' : '#5e3f25'));
    shadows.flat(sx + jx, 0.004, z, 0.7, 0.7, [0.8, 0.8, 0.8]);
    void chairsTaken;
  }

  /* ---------------------------------------------------------------- the students: muted clothes, faceless, each with their own things on the table */
  const studentSeats = rose
    ? [[-2.79, 6.0 - 0.85, 1], [-4.85, 2.8 - 0.85, 1], [-1.76, 2.8 + 0.85, -1], [4.89, 2.8 - 0.85, 1], [1.8, 2.8 - 0.85, 1], [-3.82, -0.4 - 0.85, 1], [3.86, -0.4 + 0.85, -1], [-1.76, -3.6 - 0.85, 1], [2.83, -3.6 - 0.85, 1], [4.89, 6.0 - 0.85, 1], [-4.85, 9.2 - 0.85, 1], [1.8, -0.4 - 0.85, 1]]
    : [[-2.79, 5.1 - 0.85, 1], [-4.85, 2.1 - 0.85, 1], [-1.76, 2.1 + 0.85, -1], [4.89, 2.1 - 0.85, 1], [1.8, 2.1 - 0.85, 1], [-3.82, -0.9 - 0.85, 1], [3.86, -0.9 + 0.85, -1], [-1.76, -3.9 - 0.85, 1], [2.83, -3.9 - 0.85, 1], [4.89, 5.1 - 0.85, 1]];
  const lr = rng(rose ? 77 : 33), looks = studentSeats.map(() => personLook(lr));
  const crowd = createCrowd(looks); group.add(crowd.mesh);
  const ACTS = ['type', 'write', 'read', 'read', 'type', 'think'];
  crowd.people.forEach((p, i) => {
    const [x, z, f] = studentSeats[i], ry = f > 0 ? 0 : Math.PI, kind = i % 3 === 0 ? 'laptop' : i % 3 === 1 ? 'book' : 'notes';
    p.root.position.set(x, 0, z); p.root.rotation.y = ry;
    const fz = z + f * 0.5, k = Math.floor(lr() * 4);
    if (kind === 'laptop') laptop(g, glowG, x, 0.79, z + f * 0.43, ry);
    else if (kind === 'book') openBook(g, x, 0.79, fz, ry, ['#7a3b2e', '#2f4d6e', '#3f6b4e'][k % 3]);
    else { g.box(x - 0.14, 0.79, fz - 0.1, x + 0.14, 0.8, fz + 0.1, C('#efe8d6')); g.box(x + 0.16, 0.79, fz - 0.06, x + 0.18, 0.8, fz + 0.08, C('#2b2f38')); }
    for (let b = 0; b < 1 + (i % 3); b++) g.box(x + 0.3, 0.79 + b * 0.05, fz - 0.12, x + 0.52, 0.79 + b * 0.05 + 0.045, fz + 0.08, C(['#7a3b2e', '#2f4d6e', '#d9c39a', '#5b4a7a'][(i + b) % 4]));
    p.st = { x, z, ry, f, act: kind === 'laptop' ? 'type' : kind === 'book' ? 'read' : 'write', kind, until: 8 + lr() * 30, ph: lr() * 10, mode: 'sit', walker: i === 4 || (rose && i === 10), next: 70 + lr() * 120 };
    setSit(p); applyArms(p, seatedArms(p.st.act, 0, p.st.ph));
  });

  /* ---------------------------------------------------------------- the user's place: a laptop, an open book, a stack, the cup (moves) */
  const S = seat, tz = S.table;
  laptop(g, glowG, S.x - 0.12, 0.79, S.z - 0.45, Math.PI - 0.18);
  openBook(g, S.x + 0.3, 0.79, S.z - 0.38, Math.PI + 0.25, '#2f4d6e');
  for (let b = 0; b < 3; b++) g.box(S.x - 0.66, 0.79 + b * 0.055, tz + 0.12 - (b % 2) * 0.02, S.x - 0.42, 0.79 + b * 0.055 + 0.05, tz + 0.32, C(['#7a3b2e', '#d9c39a', '#3f6b4e'][b]));
  const cup = cupMesh(mats); cup.position.set(S.x - 0.36, 0.79, S.z - 0.34); group.add(cup);
  const cupHome = cup.position.clone();

  /* ---------------------------------------------------------------- merge the static room */
  const solid = mergeColored([g.build(), ...extra]);
  const roomMesh = new THREE.Mesh(solid, mats.solid); roomMesh.name = 'room'; group.add(roomMesh);
  const lampMesh = new THREE.Mesh(lampG.build(), mats.lamp); group.add(lampMesh);
  const glowMesh = new THREE.Mesh(glowG.build(), mats.glow); group.add(glowMesh);
  const goldMesh = new THREE.Mesh(goldG.build(), mats.gold); group.add(goldMesh);
  const poolMesh = new THREE.Mesh(pools.build(), mats.pools); poolMesh.renderOrder = 3; group.add(poolMesh);
  const shadowMesh = new THREE.Mesh(shadows.build(), mats.blob); shadowMesh.renderOrder = 1; group.add(shadowMesh);
  if (rose) {                                                    // chandeliers: a brass ring of warm bulbs
    const cg = new Geo(), cl = new Geo();
    for (let z = Z0 + 3; z < Z1 - 2; z += 5.2) for (const x of [-3, 3]) {
      cg.bar([x, H, z], [x, H - 1.6, z], 0.03, C('#8a6a2a')); cg.cyl(x, z, H - 2.0, H - 1.9, 0.75, 0.75, 12, C('#b8913f'));
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; cl.cyl(x + Math.cos(a) * 0.75, z + Math.sin(a) * 0.75, H - 1.9, H - 1.78, 0.05, 0.03, 6, hc('#ffd9a0', 2.2)); }
      cl.cyl(x, z, H - 2.25, H - 2.0, 0.18, 0.12, 8, hc('#ffe2b0', 1.6));
    }
    group.add(new THREE.Mesh(cg.build(), mats.solid)); group.add(new THREE.Mesh(cl.build(), mats.lamp));
  }

  /* ---------------------------------------------------------------- the view out, the glass, the light */
  const VX = X0 - T - 0.25, viewH = H - 1.2, viewMesh = new THREE.Mesh(new THREE.PlaneGeometry(Z1 - Z0, viewH), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
  viewMesh.position.set(VX, 0.9 + viewH / 2, (Z0 + Z1) / 2); viewMesh.rotation.y = Math.PI / 2; group.add(viewMesh);
  const glass = createGlass(Z1 - Z0, viewH); glass.mesh.position.set(X0 - T * 0.75, 0.9 + viewH / 2, (Z0 + Z1) / 2); glass.mesh.rotation.y = Math.PI / 2; group.add(glass.mesh);
  const motes = createMotes(rose ? 320 : 260); group.add(motes.mesh);
  const beamMesh = new THREE.Mesh(new THREE.BufferGeometry(), mats.beams); beamMesh.renderOrder = 5; group.add(beamMesh);
  const patchMat = new THREE.MeshBasicMaterial({ map: paneTex(3, 4, true), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const patchMesh = new THREE.Mesh(new THREE.BufferGeometry(), patchMat); patchMesh.renderOrder = 2; group.add(patchMesh);
  const lampLight = new THREE.PointLight(0xffc98a, 0, 7, 1.6); lampLight.position.set(S.x - 0.03, 1.32, tz + 0.05); group.add(lampLight);
  const fillLight = new THREE.PointLight(0xffc98a, 0, 9, 1.6); fillLight.position.set(-3.0, 1.4, rose ? 2.8 : 2.1); group.add(fillLight);

  let sunKey = '';
  function sunDir(L) { const a = L.az * 0.85, e = Math.max(0.08, L.elev); return new THREE.Vector3(Math.cos(e) * Math.cos(a), -Math.sin(e), Math.cos(e) * Math.sin(a)).normalize(); }
  /** the window light: sheets of light in the air, the windows' shapes on the floor (or the bookcases when the sun is low) */
  function rebuildSun(L) {
    const k = L.key + (L.shafts > 0.02 ? 's' : '');
    if (k === sunKey) return; sunKey = k;
    const d = sunDir(L), q = new Quads(), pq = new Quads(), boxes = [], warm = new THREE.Color().copy(L.sun);
    const amt = clamp(L.shafts, 0, 1), col = [warm.r * 0.022 * amt, warm.g * 0.022 * amt, warm.b * 0.022 * amt], pcol = [warm.r * 0.42 * amt, warm.g * 0.42 * amt, warm.b * 0.42 * amt];
    if (amt > 0.02) for (const o of openings) {
      const y0 = WIN.y0, y1 = WIN.y1 + WR * 0.6, hit = (y, z) => {
        // follow the ray from the window (x = X0) until it meets the floor or the bookcases on the far wall
        const tf = y / -d.y, tw = (X1 - BD - X0) / d.x, t = Math.min(tf, tw);
        return [X0 + d.x * t, y + d.y * t, z + d.z * t, t === tw ? 'wall' : 'floor'];
      };
      for (const dz of [-0.75, 0, 0.75]) {
        const z = o.zc + dz * WR, a = [X0, y0, z], b = [X0, y1, z], A = hit(y0, z), B = hit(y1, z);
        q.quad(a, [A[0], A[1], A[2]], [B[0], B[1], B[2]], b, col, [0, 1, 1, 0]);
      }
      const c00 = hit(y0, o.z0), c01 = hit(y0, o.z1), c10 = hit(y1, o.z0), c11 = hit(y1, o.z1);
      if (c00[3] === c11[3]) {
        const lift = c00[3] === 'floor' ? 0.008 : 0, off = c00[3] === 'wall' ? -0.01 : 0;
        pq.quad([c01[0] + off, c01[1] + lift, c01[2]], [c00[0] + off, c00[1] + lift, c00[2]], [c10[0] + off, c10[1] + lift, c10[2]], [c11[0] + off, c11[1] + lift, c11[2]], pcol, [1, 0, 0, 1]);
      }
      boxes.push(o);
    }
    beamMesh.geometry.dispose(); beamMesh.geometry = q.empty ? new THREE.BufferGeometry() : q.build(); beamMesh.visible = !q.empty;
    patchMesh.geometry.dispose(); patchMesh.geometry = pq.empty ? new THREE.BufferGeometry() : pq.build(); patchMesh.visible = !pq.empty;
    if (boxes.length) motes.scatter((rr) => {
      const o = boxes[Math.floor(rr() * boxes.length) % boxes.length], y = lerp(WIN.y0, WIN.y1 + WR * 0.5, rr()), z = lerp(o.z0, o.z1, rr());
      const tmax = Math.min(y / -d.y, (X1 - BD - X0) / d.x), t = tmax * (0.08 + 0.84 * rr());
      return [X0 + d.x * t, y + d.y * t, z + d.z * t];
    });
  }
  function setLight(L) {
    rebuildSun(L);
    const lampK = 0.55 + 0.6 * L.lamp;
    mats.lamp.color.setScalar(lampK); mats.pools.color.setScalar(0.2 + 0.8 * L.lamp); mats.gold.color.setScalar(0.3 + 0.18 * L.lamp + 0.4 * L.day);
    lampLight.intensity = 1.6 * L.lamp; fillLight.intensity = 2.2 * L.lamp * (0.4 + 0.6 * L.night);
    motes.u.uAmt.value = clamp(L.shafts, 0, 1) * 0.9;
    glass.set(L);
  }
  const view = { kind: 'campus', seed: 7 };
  function setView(tex) { const m = viewMesh.material; if (m.map && m.map !== tex) m.map.dispose(); m.map = tex; m.needsUpdate = true; }

  /* ---------------------------------------------------------------- the students' slow life */
  const door = { x: 0, z: Z0 - 0.6 }, aisleX = 0;
  function studentStep(p, t, dt) {
    const s = p.st;
    if (s.mode === 'sit') {
      if (t > s.until) {
        const choices = s.kind === 'laptop' ? ['type', 'type', 'read', 'think', 'stretch'] : s.kind === 'book' ? ['read', 'read', 'write', 'think', 'stretch'] : ['write', 'write', 'read', 'think', 'stretch'];
        s.act = choices[Math.floor(Math.abs(Math.sin(t * 12.9898 + s.ph) * 43758.5453) % 1 * choices.length)];
        s.until = t + (s.act === 'stretch' ? 4 : s.act === 'think' ? 6 + (s.ph % 4) : 18 + (s.ph * 7 % 30));
      }
      if (s.walker && t > s.next) { s.mode = 'rise'; s.t0 = t; }
      applyArms(p, seatedArms(s.act, t, s.ph));
    } else if (s.mode === 'rise') {
      const k = clamp((t - s.t0) / 0.8, 0, 1); setStand(p); applyArms(p, [-0.2, 0.05, -0.2, -0.05, 0]); p.root.position.set(s.x, 0, s.z - s.f * 0.35 * k);
      if (k >= 1) { s.mode = 'walk'; s.path = [[s.x, s.z - s.f * 0.4], [s.x, s.z - s.f * 0.4], [aisleX + 0.3, s.z - s.f * 0.4], [aisleX + 0.3, door.z + 0.8], [door.x + 0.3, door.z - 0.5]]; s.seg = 0; s.d = 0; s.back = false; }
    } else if (s.mode === 'walk') {
      const P = s.path, a = P[s.seg], b = P[s.seg + 1];
      if (!b) { if (s.back) { s.mode = 'sit'; p.root.position.set(s.x, 0, s.z); p.root.rotation.y = s.ry; setSit(p); s.next = t + 120 + (s.ph * 37 % 140); } else { s.mode = 'gone'; p.visible = false; s.until2 = t + 35 + (s.ph * 13 % 40); } return; }
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.001; s.d += dt * 1.05;
      if (s.d >= L) { s.d -= L; s.seg++; return; }
      const k = s.d / L; p.root.position.set(lerp(a[0], b[0], k), 0, lerp(a[1], b[1], k)); p.root.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      setWalk(p, t * 7.2 + s.ph);
    } else if (s.mode === 'gone') {
      if (t > s.until2) { p.visible = true; s.mode = 'walk'; s.back = true; s.path = [[door.x + 0.3, door.z - 0.5], [aisleX + 0.3, door.z + 0.8], [aisleX + 0.3, s.z - s.f * 0.4], [s.x, s.z - s.f * 0.4], [s.x, s.z]]; s.seg = 0; s.d = 0; }
    }
  }
  let tPrev = 0;
  function update(t, motion) {
    hands.set(nyTime());
    glass.u.uTime.value = t; motes.u.uTime.value = t;
    if (motion) { const dt = clamp(t - tPrev, 0, 0.1); for (const p of crowd.people) studentStep(p, t, dt); }
    tPrev = t;
    crowd.skin();
  }
  crowd.skin();

  /* ---------------------------------------------------------------- framing and the routes the user's figure walks */
  const frames = rose
    ? { wide: { pos: [1.2, 3.4, 14.0], target: [-2.0, 2.0, 0.2], fov: 48 }, tall: { pos: [0.4, 2.5, 10.6], target: [-2.2, 1.35, 3.8], fov: 54 } }
    : { wide: { pos: [1.1, 3.0, 12.2], target: [-1.9, 1.75, -0.6], fov: 47 }, tall: { pos: [0.2, 2.45, 9.8], target: [-2.8, 1.25, 3.0], fov: 54 } };
  // the break's window: the lane between two tables that faces a window, nearest the seat (so the walk there stays clear of chairs)
  const laneZ = S.z + 0.62, lanes = tableZ.slice(1).map((z, i) => (z + tableZ[i]) / 2).filter((z) => windows.some((w) => Math.abs(z - w) < WR - 0.25));
  const winZ = lanes.length ? lanes.reduce((b, z) => (Math.abs(z - laneZ) < Math.abs(b - laneZ) ? z : b), lanes[0]) : laneZ;
  const routes = {
    seat: { x: S.x, z: S.z, ry: 0 },
    standAt: [S.x, laneZ],
    toStretch: [[S.x, laneZ], [aisleX + 0.2, laneZ]], stretch: { x: aisleX + 0.2, z: laneZ, ry: 0 },
    toCoffee: [[aisleX + 0.2, laneZ], [aisleX - 0.3, door.z + 0.8], [door.x - 0.3, door.z - 0.5]], coffeeExit: true,
    fromCoffee: [[door.x - 0.3, door.z - 0.5], [aisleX - 0.3, door.z + 0.8], [aisleX - 0.3, winZ], [X0 + 1.05, winZ]],
    window: { x: X0 + 1.05, z: winZ, ry: -Math.PI / 2 },
    toSeat: [[X0 + 1.05, winZ], [aisleX, winZ], [aisleX, laneZ], [S.x, laneZ], [S.x, S.z]],
  };

  // Mirror the hall (x -> -x) so the windows and their light are on the right of the picture and the HUD covers the bookcases.
  // three.js flips the face winding for a negative scale; everything the stage reads in world space is mirrored here too.
  group.scale.x = -1; hands.group.scale.x = -1;
  const mx = (p) => [-p[0], p[1]], mo = (o) => ({ ...o, x: -o.x, ry: o.ry == null ? o.ry : -o.ry });
  const mf = (f) => ({ ...f, pos: [-f.pos[0], f.pos[1], f.pos[2]], target: [-f.target[0], f.target[1], f.target[2]] });
  const W = {
    frames: { wide: mf(frames.wide), tall: mf(frames.tall) }, seat: mo(seat),
    routes: Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? (Array.isArray(v[0]) ? v.map(mx) : mx(v)) : typeof v === 'object' ? mo(v) : v])),
  };
  const sunWorld = (L) => { const d = sunDir(L); d.x = -d.x; return d; };
  function setViewM(tex) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; tex.offset.x = 1; tex.needsUpdate = true; setView(tex); }
  return {
    group, crowd, frames: W.frames, seat: W.seat, routes: W.routes, cup, cupHome, view, setView: setViewM, setLight, update,
    title: rose ? 'The grand reading room on Fifth Ave' : 'Butler Library reading room',
    others: crowd.people.length, fog: { color: rose ? '#2a2420' : '#211c1a', near: 18, far: 46 }, background: '#1c1815',
    sunDir: sunWorld, interior: true, realView: rose ? null : { look: 'low-library', from: 'butler-library', up: 12 },
    dispose() { group.traverse((o) => { if (o.isMesh || o.isPoints) { o.geometry.dispose(); if (o.material && o.material.map && o.material !== mats.pools && o.material !== mats.beams && o.material !== mats.blob) o.material.map.dispose(); } }); crowd.dispose(); patchMat.dispose(); viewMesh.material.dispose(); },
  };
}

/** a coffee cup on its saucer (a separate object: the figure picks it up) */
export function cupMesh(mats) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.008, 0.075, 0.075, 12, C('#f1ece2'));
  g.cyl(0, 0, 0.008, 0.1, 0.04, 0.048, 10, C('#f6f2ea'));
  g.cyl(0, 0, 0.096, 0.1, 0.044, 0.044, 10, C('#4a2c1a'));
  g.box(0.045, 0.035, -0.008, 0.07, 0.075, 0.008, C('#f1ece2'));
  const m = new THREE.Mesh(g.build(), mats.solid); m.name = 'cup'; return m;
}
