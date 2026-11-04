// city/world/foliage.js · slice 3 step 3: late-October street and park trees (STREET.md 4: mostly green, about a third yellow / orange).
// EZ-Tree's own leaf shader (a simplex-noise wind sway) draws NOTHING once the leaf mesh is instanced (the trees were bare skeletons all over Harlem), so the pooled trees swap it for
// a plain Phong leaf card: the EZ oak / ash alpha-cutout texture, alphaTest 0.5 (a hard cutout, no dither), per-leaf colour in a vertex attribute and a small per-tree brightness in the
// instance colour. The colour comes in CLUSTERS (a hash of the leaf's cell in tree space, about 2 m), so a crown reads as green with yellow and orange lobes, not as noise.
import * as THREE from 'three';
const GREEN = [[0.27, 0.52, 0.13], [0.22, 0.46, 0.12], [0.31, 0.56, 0.16], [0.2, 0.42, 0.14]];            // x (leaf luma * 2.3) lands near linear (0.18, 0.36, 0.1)
const YELLOW = [[1.0, 0.8, 0.12], [0.95, 0.72, 0.1], [0.9, 0.82, 0.2]];
const ORANGE = [[0.95, 0.44, 0.08], [0.86, 0.34, 0.07], [0.9, 0.52, 0.1]];
const h3 = (a, b, c, s) => { let h = (Math.imul(a + 101, 73856093) ^ Math.imul(b + 57, 19349663) ^ Math.imul(c + 13, 83492791) ^ Math.imul(s + 7, 2654435761)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** colour the leaves of a generated EZ Tree in clusters and swap in the plain leaf material. warm = the share of yellow / orange clusters (0.35). cell = cluster size in tree units. */
export function autumnLeaves(tr, seed, warm = 0.35, cell = 2.0) {
  const g = tr.leavesMesh.geometry, pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  for (let q = 0; q < n; q += 4) {
    let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 4; k++) { cx += pos.getX(q + k); cy += pos.getY(q + k); cz += pos.getZ(q + k); } cx /= 4; cy /= 4; cz /= 4;
    const i = Math.floor(cx / cell), j = Math.floor(cy / cell), l = Math.floor(cz / cell), r = h3(i, j, l, seed), r2 = h3(i, j, l, seed + 91), r3 = h3(Math.round(cx * 7), Math.round(cy * 7), Math.round(cz * 7), seed + 5);
    const pal = r < 1 - warm ? GREEN : r < 1 - warm * 0.45 ? YELLOW : ORANGE, c = pal[Math.floor(r2 * pal.length) % pal.length], v = 0.88 + 0.24 * r3;     // a little per-leaf brightness
    for (let k = 0; k < 4; k++) { col[(q + k) * 3] = c[0] * v; col[(q + k) * 3 + 1] = c[1] * v; col[(q + k) * 3 + 2] = c[2] * v; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const old = tr.leavesMesh.material, m = new THREE.MeshPhongMaterial({ name: 'leaves', map: old.map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, specular: new THREE.Color(0x0b0b0b), shininess: 8 });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * 2.3;'); };
  m.customProgramCacheKey = () => 'ezleaf-autumn-cluster';
  tr.leavesMesh.material = m; old.dispose();
  return m;
}
/** per-tree brightness for the instance colour (about 0.9 .. 1.1) */
export const treeTint = (c) => 0.9 + 0.2 * c;
