// city/shader.js · one patched Lambert material for everything built from Geo (towers, filler blocks, landmarks, cars, ground).
// It turns the vec4 attribute aA (u along facade, facade width, kind, landmark section) into procedural window grids,
// lit lobby doors, a lit crown band, billboards, chain-link fences and landmark section reveal. No textures.
import * as THREE from 'three';
import { MS, glsl } from './palette.js';

export const FLOOR_H = 0.4;

// shared by every material: time of day, clock
export function makeShared() {
  return {
    uGlow: { value: 1 },            // 0 day .. 1 night: how strongly lit windows shine
    uDay: { value: 0 },             // 0 night .. 1 midday: how bright the glass reflection is
    uTime: { value: 0 },
    uSkyRefl: { value: new THREE.Color(0x2f639b) },
    uBill: { value: 1 },
    uSnow: { value: 0 },            // 0..1 weather: up-facing surfaces turn white
  };
}

const VERT_PARS = /* glsl */`
attribute vec4 aA;
varying vec4 vA;
varying vec3 vOP;
varying vec3 vON;
uniform float uGrow;
uniform float uLandmark;
uniform float uSecOn[5];
uniform float uSecY[5];
`;
const VERT_MAIN = /* glsl */`
vec3 transformed = vec3( position );
vA = aA; vOP = position; vON = normal;
transformed.y *= uGrow;
if (uLandmark > 0.5) {
  int sIdx = int(aA.w + 0.5);
  transformed.y += uSecY[sIdx];
  if (uSecOn[sIdx] < 0.5) transformed = vec3(0.0);
}
`;

const FRAG_PARS = /* glsl */`
#define FLOOR_H ${FLOOR_H.toFixed(3)}
#define WIN_WARM ${glsl(MS.windowWarm)}
#define WIN_AMBER ${glsl(MS.windowAmber)}
#define WIN_COOL ${glsl(MS.windowCool)}
#define CROWN_COL ${glsl(MS.accent)}
#define DOOR_COL ${glsl(MS.windowWarm)}
varying vec4 vA;
varying vec3 vOP;
varying vec3 vON;
uniform float uGlow, uDay, uTime, uBill, uSnow;
uniform vec3 uSkyRefl;
uniform float uSeed, uLitP, uPitch, uGlass, uAO;
uniform vec2 uFill;
uniform float uEmis, uDesat;
uniform float uDoor, uCrown, uCrownPulse, uFlashT, uFlashF0, uFlash, uGround;
uniform float uSecFlash[5];
uniform float uLandmark;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const FRAG_COLOR = /* glsl */`
#include <color_fragment>
vec3 cityEmis = vec3(0.0);
{
  float kind = vA.z;
  float sideF = 1.0 - abs(vON.y);
  if (kind < 1.5 || (kind > 7.5 && kind < 8.5)) {
    diffuseColor.rgb *= 1.0 - uAO * sideF * exp(-max(vOP.y, 0.0) * 3.2);
  }
  if (kind < 0.5) {
    float fw = max(vA.y, 0.01);
    float bid = (uLandmark > 0.5) ? 0.0 : floor(vA.w + 0.5);        // rounded: an interpolated id is never exactly an integer, and the hash would turn that into noise
    vec2 sd = vec2(uSeed + bid * 7.13, uSeed * 0.5 + bid * 3.71);
    float cols = max(1.0, floor(fw / (uPitch * (0.82 + 0.09 * mod(bid, 5.0))) + 0.5));
    float cu = vA.x / fw * cols;
    float cv = vOP.y / FLOOR_H;
    vec2 cell = vec2(floor(cu), floor(cv));
    vec2 fr = vec2(fract(cu), fract(cv));
    float ground = (cell.y < 0.5) ? 1.0 : 0.0;
    vec2 fill = mix(uFill, vec2(0.86, 0.56), ground);
    vec2 q = (fr - (1.0 - fill) * 0.5) / fill;
    vec2 fq = fwidth(q) + 1e-4;
    float mx = clamp(min(q.x, 1.0 - q.x) / fq.x + 0.5, 0.0, 1.0);
    float my = clamp(min(q.y, 1.0 - q.y) / fq.y + 0.5, 0.0, 1.0);
    float cov = mx * my;
    float far = smoothstep(0.3, 0.85, max(fq.x, fq.y));
    cov = mix(cov, fill.x * fill.y, far);
    float hh = h21(cell + sd);
    float lit = step(hh, uLitP);
    // a few windows blink on and off slowly, like real people going to bed
    float flick = step(0.9, h21(cell * 1.3 + sd + 7.0));
    lit *= 1.0 - flick * step(0.5, fract(uTime * 0.02 + h21(cell + 3.0)));
    float hw = h21(cell * 1.7 + sd + 2.0);
    // Morningside: limestone-warm lamplight, a few amber rooms and about one in six cool blue (screens, cold light)
    float wI = 0.5 + 0.5 * h21(cell * 2.3 + sd + 5.0);
    vec3 warm = mix(WIN_WARM, WIN_AMBER, hw * hw);
    vec3 litCol = mix(warm, WIN_COOL, step(0.84, h21(cell * 3.1 + sd)));
    litCol = mix(litCol, vec3(dot(litCol, vec3(0.36, 0.5, 0.14))) * vec3(0.92, 0.96, 1.06), uDesat);
    lit = mix(lit, uLitP * 0.9, far);
    if (ground > 0.5) lit = uDoor * step(hh, 0.92);
    vec3 deep = vec3(0.03, 0.055, 0.12);
    vec3 refl = uSkyRefl * (0.45 + 0.5 * uDay) * (0.7 + 0.3 * q.y);
    vec3 paneCol = mix(deep, refl, clamp(0.2 + 0.5 * uDay + 0.22 * uGlass * (0.5 + 0.5 * uDay), 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, paneCol, cov);
    // little sill under each window
    float sill = (1.0 - my) * step(q.y, 0.0) * step(-0.3, q.y) * step(-0.12, q.x) * step(q.x, 1.12);
    diffuseColor.rgb *= 1.0 - 0.14 * sill;
    float fa = 0.0;
    if (uFlashT >= 0.0 && cell.y >= uFlashF0) {
      float ft = uFlashT - (cell.y - uFlashF0) * 0.07;
      fa = smoothstep(0.0, 0.08, ft) * (1.0 - smoothstep(0.0, 1.3, ft));
    }
    float on = max(lit * uGlow, fa);
    // a lit room is not a flat white tile: a mullion, a frame, and light that falls off toward the ceiling.
    // Kept below the bloom threshold so the facade between the windows still reads (only the brightest rooms glow).
    float mull = mix(1.0, smoothstep(0.03, 0.03 + 1.5 * fq.x, abs(q.x - 0.5)), (1.0 - far) * step(0.17, fill.x * fw / cols));
    float frame = mix(1.0, smoothstep(0.0, 0.14, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y))) * 0.4 + 0.6, 1.0 - far);
    float room = mix(1.0, 0.72 + 0.4 * (1.0 - q.y), 1.0 - far);
    float wl = mull * frame * room;
    cityEmis += cov * (litCol * 1.0 * wI * wl * lit * uGlow * uEmis + vec3(1.5, 1.35, 1.1) * fa);
    diffuseColor.rgb = mix(diffuseColor.rgb, litCol * 0.42 * wl, cov * on * 0.3);
  } else if (kind < 1.5) {
    // plain surface
  } else if (kind < 2.5) {
    // lit crown band (target met)
    // Morningside: the crown is Columbia blue (the reward colour), not gold
    float k = uCrown * (1.0 + 0.35 * uCrownPulse);
    cityEmis += CROWN_COL * 2.4 * k;
    diffuseColor.rgb = mix(diffuseColor.rgb, CROWN_COL, min(k, 1.0) * 0.55);
  } else if (kind < 3.5) {
    // lobby door
    cityEmis += DOOR_COL * 2.0 * uDoor;
    diffuseColor.rgb *= mix(0.45, 1.0, uDoor);
  } else if (kind < 4.5) {
    // billboard: a grid of little screens in warm white, cyan, magenta and amber that change slowly
    vec2 bp = vec2(vA.x * 4.2, vOP.y * 3.3);
    vec2 bc = floor(bp), bf = fract(bp);
    float panel = step(0.07, bf.x) * step(bf.x, 0.93) * step(0.1, bf.y) * step(bf.y, 0.9);
    float hs = h21(bc + 3.7), ph = floor(uTime * 0.4 + hs * 9.0), h2 = h21(bc + ph * 1.7 + 11.0);
    vec3 hue = h2 < 0.3 ? vec3(1.0, 0.58, 0.26) : (h2 < 0.55 ? vec3(0.32, 0.82, 1.0) : (h2 < 0.78 ? vec3(1.0, 0.4, 0.62) : vec3(1.0, 0.92, 0.74)));
    float inten = 0.55 + 0.45 * sin(uTime * 1.1 + hs * 20.0);
    cityEmis += hue * (0.42 + 0.5 * inten) * panel * uBill;
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.22, hue * 0.35, panel * 0.5);
  } else if (kind < 5.5) {
    // chain-link fence
    vec2 g = vec2(vA.x, vOP.y) * 11.0;
    float l1 = abs(fract((g.x + g.y) * 0.5) - 0.5), l2 = abs(fract((g.x - g.y) * 0.5) - 0.5);
    float w = max(0.07, fwidth((g.x + g.y) * 0.5) * 0.9);
    if (min(l1, l2) > w && vOP.y > 0.045) discard;
  } else if (kind < 6.5) {
    // always-on light (lamp heads, headlights, sign bands)
    cityEmis += diffuseColor.rgb * 1.9 * (0.22 + 0.78 * uGlow);
    diffuseColor.rgb *= 0.25;
  } else if (kind < 8.5) {
    // masonry: courses and staggered joints, only on upright faces
    if (kind > 7.5) {
      float uu = abs(vON.x) > 0.5 ? vOP.z : vOP.x;
      float row = floor(vOP.y / 0.075);
      float fy = fract(vOP.y / 0.075), fx = fract((uu + mod(row, 2.0) * 0.06) / 0.12);
      float ly = smoothstep(0.0, 0.1, fy) * smoothstep(0.0, 0.1, 1.0 - fy);
      float lx = smoothstep(0.0, 0.07, fx) * smoothstep(0.0, 0.07, 1.0 - fx);
      float m = mix(0.78, 1.0, ly * lx) * (0.94 + 0.12 * h21(vec2(row, floor((uu + mod(row, 2.0) * 0.06) / 0.12))));
      float side = 1.0 - abs(vON.y);
      diffuseColor.rgb *= mix(1.0, m, side * (1.0 - smoothstep(0.02, 0.05, max(fwidth(vOP.y), 0.0) * 2.0)));
    }
  } else if (kind < 9.5) {
    // inlay: paint that keeps a gentle glow of its own (not enough to bloom)
    cityEmis += diffuseColor.rgb * 0.5 * (0.25 + 0.75 * uGlow);
  } else if (kind < 10.5) {
    // translucent ghost lit from within a little (target blueprint)
    cityEmis += diffuseColor.rgb * 0.5;
  }
  if (uLandmark > 0.5) {
    float sf = uSecFlash[int(vA.w + 0.5)];
    cityEmis += diffuseColor.rgb * 2.2 * sf + CROWN_COL * sf * 0.5;
  }
  if (uSnow > 0.001) {
    float up = smoothstep(0.6, 0.95, vON.y) * (vOP.y > -0.03 ? 1.0 : 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.9, 1.0), uSnow * up * 0.88);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uFlash * 0.28);
  cityEmis += WIN_WARM * uFlash * 0.25;
}
`;

// creates a material plus the per-material uniforms. `shared` carries the time-of-day uniforms.
export function createCityMaterial(shared, init = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const U = {
    uGrow: { value: 1 }, uLandmark: { value: init.landmark ? 1 : 0 },
    uSecOn: { value: [1, 1, 1, 1, 1] }, uSecY: { value: [0, 0, 0, 0, 0] }, uSecFlash: { value: [0, 0, 0, 0, 0] },
    uSeed: { value: init.seed ?? 0 }, uLitP: { value: init.litP ?? 0.72 }, uPitch: { value: init.pitch ?? 0.3 },
    uFill: { value: new THREE.Vector2(...(init.fill || [0.5, 0.62])) }, uGlass: { value: init.glass ?? 0 }, uAO: { value: init.ao ?? 0.32 },
    uDoor: { value: 0 }, uCrown: { value: 0 }, uCrownPulse: { value: 0 }, uFlashT: { value: -1 }, uFlashF0: { value: 0 }, uFlash: { value: 0 },
    uGround: { value: 0 }, uEmis: { value: init.emis ?? 1 }, uDesat: { value: init.desat ?? 0 },
  };
  mat.userData.U = U;
  mat.customProgramCacheKey = () => 'witness-city-ms1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cityEmis;');
  };
  return { mat, U };
}
