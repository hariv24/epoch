// city/mh_bridges.js · Manhattan's bridges as low-poly geometry: the Brooklyn Bridge (granite towers with their pointed arches,
// the cable web and its necklace lights), the Manhattan and Williamsburg bridges, the Queensboro cantilever, the George
// Washington Bridge, and simple decks for the Harlem River crossings. Positions come from the street centreline's bridge
// pieces (NYC Open Data, Manhattan's share of each bridge) and the real spans; the far halves continue into the faint far shore.
import * as THREE from 'three';
import { Geo, rgb } from './util.js';
import { MS } from './palette.js';

const STONE = rgb('#b9ab93'), STONE_D = rgb('#9a8d78'), STEEL = rgb('#7f93ad'), STEEL_D = rgb('#5d6f88'), DECK = rgb('#4a5366'), DECK_T = rgb('#3a4252'), GWB = rgb('#8a9bb0');

function axisOf(lines, name) {
  const ls = lines.filter((l) => l.n === name); if (!ls.length) return null;
  // the longest piece's end that lies farthest out over the river is the borough line (mid-river)
  let best = null, bl = 0;
  for (const l of ls) { const p = l.p, L = Math.hypot(p[p.length - 2] - p[0], p[p.length - 1] - p[1]); if (L > bl) { bl = L; best = p; } }
  return best;
}
function dir2(ax, az, bx, bz) { const L = Math.hypot(bx - ax, bz - az) || 1; return [(bx - ax) / L, (bz - az) / L]; }

// a cable from a to b sagging to `sag` below the chord (parabola), as thin bars
function cable(g, a, b, sag, n, th, col, out) {
  let prev = a;
  for (let k = 1; k <= n; k++) {
    const t = k / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    g.bar(prev, p, th, col); if (out) out.push(p); prev = p;
  }
}

/* a suspension bridge along axis d (unit, x/z) from the Manhattan approach start S through the Manhattan tower M */
function suspension(g, lines, o) {
  const { S, M, d, span, side, towerH, deckY, deckW, style } = o;
  const n = [-d[1], d[0]];
  const P = (s, y, w = 0) => [M[0] + d[0] * s + n[0] * w, y, M[1] + d[1] * s + n[1] * w];
  const sStart = -Math.hypot(M[0] - S[0], M[1] - S[1]), farT = span, farA = span + side, farEnd = farA + side * 0.9;
  // deck: ramps up from the approach to the tower, a gentle arch over the main span, down again on the far side
  const deckAt = (s) => {
    if (s < 0) return o.groundS + 2 + (deckY - o.groundS - 2) * ((s - sStart) / -sStart);
    if (s <= span) return deckY + 4 * (s / span) * (1 - s / span) * span * 0.012;
    return Math.max(2, deckY - ((s - span) / (farEnd - span)) * (deckY - 4));
  };
  const steps = 60, s0 = sStart, s1 = farEnd;
  for (let k = 0; k < steps; k++) {
    const a = s0 + (s1 - s0) * (k / steps), b = s0 + (s1 - s0) * ((k + 1) / steps), ya = deckAt(a), yb = deckAt(b), hw = deckW / 2;
    g.quad(P(a, ya, -hw), P(b, yb, -hw), P(b, yb, hw), P(a, ya, hw), DECK_T);                              // road
    g.quad(P(a, ya - 3, hw), P(b, yb - 3, hw), P(b, yb, hw), P(a, ya, hw), DECK);                         // fascia
    g.quad(P(b, yb - 3, -hw), P(a, ya - 3, -hw), P(a, ya, -hw), P(b, yb, -hw), DECK);
    g.quad(P(a, ya - 3, -hw), P(a, ya - 3, hw), P(b, yb - 3, hw), P(b, yb - 3, -hw), DECK);              // underside
  }
  // towers
  const tw = deckW + 8, td = style === 'gothic' ? 18 : 9;
  for (const s of [0, span]) {
    if (style === 'gothic') {
      // granite: a solid base to the deck, three piers between two pointed arches, a cornice-topped head
      const box = (s0_, s1_, w0, w1, y0, y1, c) => {
        const A = P(s0_, y0, w0), B = P(s0_, y0, w1), C = P(s1_, y0, w1), D = P(s1_, y0, w0), A2 = P(s0_, y1, w0), B2 = P(s0_, y1, w1), C2 = P(s1_, y1, w1), D2 = P(s1_, y1, w0);
        g.quad(B, A, A2, B2, c); g.quad(D, C, C2, D2, c); g.quad(A, D, D2, A2, c); g.quad(C, B, B2, C2, c); g.quad(A2, D2, C2, B2, c);
      };
      const a = s - td / 2, b = s + td / 2, hw = tw / 2, op = 10.5, mid = 2.6, yD = deckY - 3, ySp = deckY + 24, yAp = deckY + 34, yTop = towerH;
      box(a - 2, b + 2, -hw - 2, hw + 2, -3, yD, STONE_D);                                    // pier in the river
      box(a, b, -hw, -hw + (hw - op - mid), yD, yTop, STONE);                                  // outer piers
      box(a, b, hw - (hw - op - mid), hw, yD, yTop, STONE);
      box(a, b, -mid, mid, yD, yTop, STONE);                                                   // centre pier
      box(a, b, -hw, hw, yAp, yTop, STONE);                                                    // head over the arches
      box(a - 1.2, b + 1.2, -hw - 1.2, hw + 1.2, yTop - 2.4, yTop - 1.2, STONE_D);             // cornice
      // the pointed tops of the two arches
      for (const sgn of [-1, 1]) {
        const w0 = sgn < 0 ? -mid - op : mid, w1 = sgn < 0 ? -mid : mid + op, wm = (w0 + w1) / 2;
        for (const [ss, flip] of [[a, false], [b, true]]) {
          const L1 = P(ss, ySp, w0), Lt = P(ss, yAp, w0), M1 = P(ss, yAp, wm), R1 = P(ss, ySp, w1), Rt = P(ss, yAp, w1);
          if (!flip) { g.tri(L1, M1, Lt, STONE); g.tri(R1, Rt, M1, STONE); } else { g.tri(L1, Lt, M1, STONE); g.tri(R1, M1, Rt, STONE); }
        }
        g.quad(P(a, ySp, w0), P(b, ySp, w0), P(b, yAp, wm), P(a, yAp, wm), STONE_D);
        g.quad(P(b, ySp, w1), P(a, ySp, w1), P(a, yAp, wm), P(b, yAp, wm), STONE_D);
      }
    } else {
      const legW = style === 'gwb' ? 7 : 5, col = style === 'gwb' ? GWB : STEEL;
      for (const w of [-tw / 2, tw / 2]) {
        const c = P(s, 0, w);
        g.box(c[0] - legW / 2, -3, c[2] - legW / 2, c[0] + legW / 2, towerH, c[2] + legW / 2, col, {});
      }
      // cross bracing (portal struts) and, for the GWB, the lattice X's
      const nB = style === 'gwb' ? 6 : 4;
      for (let k = 1; k <= nB; k++) {
        const y = deckY + (towerH - deckY) * (k / nB) - 2;
        g.bar(P(s, y, -tw / 2), P(s, y, tw / 2), 3.2, col);
        if (style === 'gwb' || k < nB) { const yb = deckY + (towerH - deckY) * ((k - 1) / nB); g.bar(P(s, yb, -tw / 2), P(s, y, tw / 2), 1.4, STEEL_D); g.bar(P(s, yb, tw / 2), P(s, y, -tw / 2), 1.4, STEEL_D); }
      }
      g.box(...(() => { const c = P(s, 0, 0); return [c[0] - 3, -3, c[2] - 3, c[0] + 3, deckY - 3, c[2] + 3]; })(), STEEL_D, {});
    }
  }
  // main cables, suspenders and (Brooklyn) the diagonal stays; necklace light points ride on the cables
  const lights = [], lines2 = [];
  const capY = towerH + (style === 'gothic' ? -1 : 0);
  for (const w of [-deckW / 2 + 1, deckW / 2 - 1]) {
    const T0 = P(0, capY, w), T1 = P(span, capY, w), A0 = P(-side, deckAt(-side) + 3, w), A1 = P(farA, deckAt(farA) + 3, w);
    const sag = capY - deckY - 4;
    cable(g, A0, T0, side * 0.04, 10, 0.9, STEEL_D, lights);
    cable(g, T0, T1, sag, 30, 1.0, STEEL_D, lights);
    cable(g, T1, A1, side * 0.04, 10, 0.9, STEEL_D, lights);
    for (let s = 12; s < span; s += 12) { const t = s / span, y = capY - (capY - deckY) * 0 - sag * 4 * t * (1 - t); lines2.push(P(s, y, w), P(s, deckAt(s), w)); }
    if (style === 'gothic') for (const [tS, sg] of [[0, 1], [span, -1], [0, -1], [span, 1]]) for (let k = 1; k <= 9; k++) { const s = tS + sg * k * 18; if (s < -side || s > farA) continue; lines2.push(P(tS, capY - 4, w), P(s, deckAt(s), w)); }
  }
  return { lights, lines: lines2 };
}

export function buildBridges(D, TR, lmUniforms) {
  const g = new Geo(), lines = D.streets.lines, names = D.streets.names;
  const idOf = (nm) => names.indexOf(nm);
  const out = { lights: [], lightsBB: [], segs: [] };
  const groundAt = (x, z) => TR.ground(x, z);
  const notable = (id) => D.notables.notables.find((n) => n.id === id);
  // --- Brooklyn Bridge: main span 486 m, towers 84 m above the water, deck about 41 m at mid-span
  {
    const p = axisOf(lines, idOf('Brooklyn Brg'));
    if (p) {
      const S = [p[0], p[1]], E = [p[p.length - 2], p[p.length - 1]], d = dir2(S[0], S[1], E[0], E[1]);
      const M = [E[0] - d[0] * 243, E[1] - d[1] * 243];
      const r = suspension(g, lines, { S, M, d, span: 486, side: 283, towerH: 84, deckY: 38, deckW: 26, style: 'gothic', groundS: groundAt(S[0], S[1]) });
      out.lightsBB.push(...r.lights); out.segs.push(...r.lines);
    }
  }
  // --- Manhattan Bridge: 448 m, steel towers 102 m
  {
    const p = axisOf(lines, idOf('Manhattan Brg'));
    if (p) {
      const S = [p[0], p[1]], E = [p[p.length - 2], p[p.length - 1]], d = dir2(S[0], S[1], E[0], E[1]);
      const M = [E[0] - d[0] * 224, E[1] - d[1] * 224];
      const r = suspension(g, lines, { S, M, d, span: 448, side: 222, towerH: 102, deckY: 40, deckW: 36, style: 'steel', groundS: groundAt(S[0], S[1]) });
      out.lights.push(...r.lights); out.segs.push(...r.lines);
    }
  }
  // --- Williamsburg Bridge: 488 m, steel towers 102 m
  {
    const ls = lines.filter((l) => l.n === idOf('Williamsburg Brg')).sort((a, b) => b.w - a.w);
    const p = ls.length ? ls.reduce((m, l) => (l.p.length > m.p.length ? l : m), ls[0]).p : null;
    if (p) {
      let S = [p[0], p[1]], E = [p[p.length - 2], p[p.length - 1]];
      if (TR.isLand(E[0], E[1]) && !TR.isLand(S[0], S[1])) [S, E] = [E, S];
      const d = dir2(S[0], S[1], E[0], E[1]);
      const M = [E[0] - d[0] * 244, E[1] - d[1] * 244];
      const r = suspension(g, lines, { S, M, d, span: 488, side: 180, towerH: 102, deckY: 41, deckW: 36, style: 'steel', groundS: groundAt(S[0], S[1]) });
      out.lights.push(...r.lights); out.segs.push(...r.lines);
    }
  }
  // --- George Washington Bridge: the Manhattan tower (notables), 1,067 m to the New Jersey tower, 184 m towers, deck 65 m
  {
    const nt = notable('gwb'), bike = axisOf(lines, idOf('George Washington Brdg Bike Path'));
    if (nt && bike) {
      const A = [bike[0], bike[1]], B = [bike[bike.length - 2], bike[bike.length - 1]];
      let d = dir2(A[0], A[1], B[0], B[1]); if (d[0] > 0) d = [-d[0], -d[1]];                 // toward New Jersey (west)
      const M = [nt.x, nt.z], S = [M[0] - d[0] * 320, M[1] - d[1] * 320];
      const r = suspension(g, lines, { S, M, d, span: 1067, side: 186, towerH: 184, deckY: 65, deckW: 36, style: 'gwb', groundS: groundAt(S[0], S[1]) });
      out.lights.push(...r.lights); out.segs.push(...r.lines);
    }
  }
  // --- Queensboro Bridge: a cantilever over both channels and Roosevelt Island
  {
    const p = axisOf(lines, idOf('Ed Koch Queensboro Br Ped Path')) || axisOf(lines, idOf('Ed Koch Queensboro Brg'));
    if (p) {
      const S = [p[0], p[1]], E = [p[p.length - 2], p[p.length - 1]], d = dir2(S[0], S[1], E[0], E[1]), n = [-d[1], d[0]];
      const L = Math.hypot(E[0] - S[0], E[1] - S[1]) + 260, deckY = 42, hw = 13;
      const P = (s, y, w = 0) => [S[0] + d[0] * s + n[0] * w, y, S[1] + d[1] * s + n[1] * w];
      // piers where the axis crosses a shore
      const piers = []; let wasLand = true;
      for (let s = 0; s < L; s += 8) { const q = P(s, 0), land = TR.isLand(q[0], q[2]); if (land !== wasLand) piers.push(s + (land ? -12 : 12)); wasLand = land; }
      const g0 = groundAt(S[0], S[1]);
      const deckAt = (s) => (s < 120 ? g0 + (deckY - g0) * (s / 120) : deckY);
      for (let k = 0; k < 50; k++) { const a = (L * k) / 50, b = (L * (k + 1)) / 50; g.quad(P(a, deckAt(a), -hw), P(b, deckAt(b), -hw), P(b, deckAt(b), hw), P(a, deckAt(a), hw), DECK_T); g.quad(P(a, deckAt(a) - 6, hw), P(b, deckAt(b) - 6, hw), P(b, deckAt(b), hw), P(a, deckAt(a), hw), STEEL_D); g.quad(P(b, deckAt(b) - 6, -hw), P(a, deckAt(a) - 6, -hw), P(a, deckAt(a), -hw), P(b, deckAt(b), -hw), STEEL_D); }
      // top chord: rises to a peak over every pier
      const topAt = (s) => { let m = 14; for (const q of piers) m = Math.max(m, 62 - Math.abs(s - q) * 0.32); return deckY + m; };
      for (const w of [-hw, hw]) {
        let prev = null;
        for (let s = 120; s <= L; s += 12) { const q = P(s, topAt(s), w); if (prev) g.bar(prev, q, 1.6, STEEL); prev = q; if (((s / 12) | 0) % 2 === 0) out.segs.push(P(s, deckY, w), q); else out.segs.push(P(s - 12, deckY, w), q); }
      }
      for (const q of piers) { for (const w of [-hw, hw]) { const c = P(q, 0, w); g.box(c[0] - 3, -3, c[2] - 3, c[0] + 3, topAt(q) + 8, c[2] + 3, STONE, {}); const tip = P(q, topAt(q) + 8, w); g.cyl(tip[0], tip[2], tip[1], tip[1] + 12, 2.6, 0, 6, STEEL_D); } }
    }
  }
  // --- the rest: simple decks over the water, continued to the far shore
  const SIMPLE = ['Robert F Kennedy Brg', 'Willis Ave Bridge', '3 Ave Bridge', 'Madison Ave Bridge', '145 St Bridge', 'Macombs Dam Brg', 'Washington Brg', 'Alexander Hamilton Brg', 'University Heights Brg', 'Broadway Brg', 'Henry Hudson Brg', 'Roosevelt Is Brg', 'High Brg', 'Amtrak Brg', 'Hell Gate Bridge'];
  for (const nm of SIMPLE) {
    const id = idOf(nm); if (id < 0) continue;
    for (const l of lines) {
      if (l.n !== id) continue;
      const p = l.p.slice();
      const ex = p[p.length - 2], ez = p[p.length - 1];
      if (!TR.isLand(ex, ez)) { const d = dir2(p[p.length - 4], p[p.length - 3], ex, ez); p.push(ex + d[0] * 160, ez + d[1] * 160); }
      const gy = Math.max(groundAt(p[0], p[1]), 8), w = Math.max(8, l.w || 10) / 2;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], [dx, dz] = dir2(ax, az, bx, bz), nx = -dz * w, nz = dx * w;
        const ya = TR.isLand(ax, az) ? Math.max(groundAt(ax, az) + 0.5, Math.min(gy, groundAt(ax, az) + 6)) : gy, yb = TR.isLand(bx, bz) ? Math.max(groundAt(bx, bz) + 0.5, Math.min(gy, groundAt(bx, bz) + 6)) : gy;
        g.quad([ax - nx, ya, az - nz], [bx - nx, yb, bz - nz], [bx + nx, yb, bz + nz], [ax + nx, ya, az + nz], DECK_T);
        g.quad([ax + nx, ya - 2.5, az + nz], [bx + nx, yb - 2.5, bz + nz], [bx + nx, yb, bz + nz], [ax + nx, ya, az + nz], DECK);
        g.quad([bx - nx, yb - 2.5, bz - nz], [ax - nx, ya - 2.5, az - nz], [ax - nx, ya, az - nz], [bx - nx, yb, bz - nz], DECK);
        if (!TR.isLand(bx, bz)) g.box(bx - 2.5, -2, bz - 2.5, bx + 2.5, yb - 2.5, bz + 2.5, STONE_D, {});
      }
    }
  }
  const geo = g.build(); geo.deleteAttribute('aA');
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'bridges';
  // cable web as thin lines
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(out.segs.flat(), 3));
  const web = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color('#9fb2cc'), transparent: true, opacity: 0.55 })); web.name = 'bridge web';
  // necklace lights: the Brooklyn Bridge's (the Python landmark: brighter as the ladder unlocks) and the others'
  const mkPts = (arr, col, size) => {
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(arr.flat(), 3));
    const pm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCol: { value: new THREE.Color(col) }, uK: { value: 1 }, uPx: { value: 800 }, uSize: { value: size }, uGlow: lmUniforms.uGlow },
      vertexShader: 'uniform float uPx, uSize; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float s = uSize * uPx / max(-mv.z, 1.0); vA = clamp(s / 1.5, 0.0, 1.0) * (1.0 - smoothstep(6000.0, 14000.0, -mv.z)); gl_PointSize = clamp(s, 1.5, 12.0); }',
      fragmentShader: 'uniform vec3 uCol; uniform float uK, uGlow; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); if (a < 0.02) discard; if (uGlow < 0.05) discard; gl_FragColor = vec4(uCol * (1.5 + 2.0 * (1.0 - r)) * a * vA * uK * uGlow, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    });
    const pts = new THREE.Points(pg, pm); pts.frustumCulled = false; pts.renderOrder = 5; return pts;
  };
  const bbLights = mkPts(out.lightsBB, MS.beacon, 3.4), otherLights = mkPts(out.lights, MS.lamp, 2.6);
  return { mesh, web, bbLights, otherLights, tris: geo.index.count / 3 };
}
