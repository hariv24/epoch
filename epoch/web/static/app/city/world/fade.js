// city/world/fade.js · slice 3 (docs/WORLD.md 14.3): the near / mid tier crossfade without a pop. Step 3 rewrote it: the dither is TIME based, not a fixed distance band.
//   Every near-tier material discards fragments by a screen-door dither (IGN noise) against a per-unit value uT in 0..1; the mid-tier materials keep the complement. A unit
//   that changes tier ramps uT over ~1 s (district.js), then it is fully solid (uT = 1 / 0: `ign >= 1` never fires, so there is NO dither left on screen).
//   uT per material:  >= 0  the unit's own value (a per-unit clone of the shared material, see unitMat);  FADE.legacy (-1) the old distance band 60-90 m
//   (the slice-2 base street's meshes and the user's own W 123rd faces, which are built outside the unit groups);  FADE.zero (0) mid-only units (always solid).
//   The mid tier still fades out at the far end (260-310 m) by distance: that is inside the fog, not a tier switch.
import * as THREE from 'three';
export const FADE = { u: { value: new THREE.Vector4(60, 90, 260, 310) }, near0: 60, near1: 90, far0: 260, far1: 310, off: false, legacy: { value: -1 }, zero: { value: 0 } };
const IGN = 'float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));';
export const FADE_DECL = 'uniform vec4 uFade; uniform float uT; varying float vFD;\n';
export const fadeFrag = (mode) => `  ${IGN}\n  float kn = uT >= 0.0 ? uT : 1.0 - smoothstep(uFade.x, uFade.y, vFD);\n` + (mode === 'near'
  ? '  if (ign >= kn) discard;\n'
  : '  float ko = 1.0 - smoothstep(uFade.z, uFade.w, vFD);\n  if (ign < kn || ign >= ko) discard;\n');
/** patch a built-in material (Standard / Basic / Lambert): a varying distance + the dither test at the top of main(). `this` is the material that compiles (a per-unit clone, or the shared original) */
export function patchFade(mat, mode) {
  if (mat.__fadeMode) return mat;                                      // PARTS share materials (lens / lensb): patch once
  mat.__fadeMode = mode;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    sh.uniforms.uFade = FADE.u; sh.uniforms.uT = this.__uT || FADE.legacy;
    sh.vertexShader = 'varying float vFD;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vFD = length(mvPosition.xyz);');
    sh.fragmentShader = FADE_DECL + sh.fragmentShader.replace('void main() {', 'void main() {\n' + fadeFrag(mode));
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + '|fade2-' + mode;
  mat.needsUpdate = true;
  return mat;
}
// Properties street.js animates on the shared originals (applyTime): the clones read them live so a unit built at noon still lights up at night.
const LIVE = ['emissiveIntensity', 'opacity', 'visible', 'envMapIntensity'];
/** the unit's clone of a shared (patched) material: same program (same cache key), its own uT. `t` is { value } (also holds the clone cache). */
export function unitMat(mat, t) {
  if (!mat.__fadeMode && !mat.isShaderMaterial) return mat;
  const cache = t.clones || (t.clones = new Map());
  let c = cache.get(mat); if (c) return c;
  c = mat.clone(); c.__fadeMode = mat.__fadeMode || 'near'; c.__uT = t; c.onBeforeCompile = mat.onBeforeCompile; c.customProgramCacheKey = mat.customProgramCacheKey;
  if (mat.isShaderMaterial) c.uniforms = { ...mat.uniforms, uT: t };                    // the same uniform entries (uNight, uSkyTop ...): the clone follows applyTime
  for (const k of LIVE) if (k in mat) Object.defineProperty(c, k, { get: () => mat[k], set: () => {}, configurable: true });
  cache.set(mat, c); return c;
}
/** free a unit's clones (the program stays: it is shared) */
export function disposeUnit(t) { if (t && t.clones) { for (const c of t.clones.values()) c.dispose(); t.clones.clear(); } }
