// city/sky.js · time of day. Keyframes by local hour -> sky colours, light colours, window glow, stars.
// The sky itself is one shader on a big inside-out sphere (gradient, sun / moon, stars, a few soft clouds). No textures.
// The gradient is read from the view ray lifted by a fixed bias: the camera looks down at the diorama, so the horizon
// is never on screen, but the corners beyond the island still show a proper dusk-to-night gradient.
import * as THREE from 'three';
import { clamp } from './util.js';

// [hour, top, mid, horizon, keyColour, keyIntensity, hemiSky, hemiGround, hemiIntensity, windowGlow, day, stars]
// Morningside: a blue-hour Upper West Side. Night is navy (#05122A -> #0E2B57 -> #2F639B, the theme's own gradient at 20:36),
// dusk keeps a last limestone-peach glow on the horizon so it reads apart from night, mornings rise to Columbia blue.
const KEYS = [
  [0,    '#05122A', '#0A2148', '#1F4A82', '#b4c8e6', 0.55, '#6682b4', '#16284a', 1.00, 1.00, 0.00, 1.00],
  [4.8,  '#071a3c', '#123366', '#2F639B', '#b4c8e6', 0.55, '#6682b4', '#1a2c50', 1.00, 0.96, 0.02, 0.85],
  [6.0,  '#1c4180', '#5b86be', '#f3d3a6', '#ffd2a0', 1.20, '#8aa8dc', '#4a4a5e', 0.98, 0.55, 0.22, 0.12],
  [7.8,  '#3d7acc', '#8CC4EE', '#F3EFE6', '#fff2dc', 1.85, '#a8ccf4', '#6e6e78', 1.00, 0.14, 0.80, 0.00],
  [12,   '#3a7fd8', '#8CC4EE', '#dceeff', '#fff7ea', 2.00, '#b8d8ff', '#807e88', 1.05, 0.00, 1.00, 0.00],
  [16.5, '#4478c6', '#9cc6ea', '#f3e4c4', '#ffe8c0', 1.90, '#a8c8f0', '#78707a', 1.02, 0.06, 0.88, 0.00],
  [18.0, '#24528e', '#6e98c8', '#f2c590', '#ffc27e', 1.70, '#a0bce6', '#54505c', 0.98, 0.50, 0.38, 0.06],
  [19.3, '#0E2B57', '#2F639B', '#d9a98e', '#f7b990', 1.05, '#7c9cd0', '#34405a', 0.98, 0.88, 0.12, 0.40],
  [20.6, '#05122A', '#0E2B57', '#2F639B', '#b0c6e8', 0.70, '#6e8cc4', '#1e2e54', 1.00, 1.00, 0.02, 0.90],
  [22,   '#05122A', '#0c2550', '#26568f', '#b4c8e6', 0.58, '#6884b6', '#1a2b50', 1.00, 1.00, 0.00, 1.00],
  [24,   '#05122A', '#0A2148', '#1F4A82', '#b4c8e6', 0.55, '#6682b4', '#16284a', 1.00, 1.00, 0.00, 1.00],
];
const K = KEYS.map((k) => ({ h: k[0], top: new THREE.Color(k[1]), mid: new THREE.Color(k[2]), hor: new THREE.Color(k[3]), key: new THREE.Color(k[4]), keyI: k[5], hemiS: new THREE.Color(k[6]), hemiG: new THREE.Color(k[7]), hemiI: k[8], glow: k[9], day: k[10], stars: k[11] }));

export function timeParams(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0; while (K[i + 1].h < h) i++;
  const a = K[i], b = K[i + 1], t = (h - a.h) / (b.h - a.h), s = t * t * (3 - 2 * t);
  const c = (x, y) => x.clone().lerp(y, s), n = (x, y) => x + (y - x) * s;
  const out = { top: c(a.top, b.top), mid: c(a.mid, b.mid), hor: c(a.hor, b.hor), key: c(a.key, b.key), keyI: n(a.keyI, b.keyI), hemiS: c(a.hemiS, b.hemiS), hemiG: c(a.hemiG, b.hemiG), hemiI: n(a.hemiI, b.hemiI), glow: n(a.glow, b.glow), day: n(a.day, b.day), stars: n(a.stars, b.stars) };
  // where the light comes from. Sun path 6..18, moon path 18..30, always a little toward the viewer so fronts are lit.
  const sunUp = h >= 6 && h < 18, ph = sunUp ? (h - 6) / 12 : (((h >= 18 ? h - 18 : h + 6)) / 12);
  const ang = Math.PI * ph, el = 0.2 + Math.sin(ang) * 0.8;
  out.light = new THREE.Vector3(Math.cos(ang) * 0.95, el, 0.55).normalize();
  out.disc = new THREE.Vector3(Math.cos(ang) * 0.9, 0.04 + Math.sin(ang) * 0.62, -0.75).normalize();     // where the sun / moon sits in the sky
  out.isSun = sunUp;
  out.hourF = h;
  return out;
}

const VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }
`;
const FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uTop, uMid, uHor, uDiscCol, uDisc, uFogCol;
uniform float uStars, uTime, uDay, uSun, uTwinkle, uCover, uFlash, uWind, uLift, uFogAmt;
float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y + uLift;                     // lifted: the horizon band sits just under the top of the frame (the free 360 camera uses the true horizon)
  float t = smoothstep(-0.12, 0.62, y);
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.34, t));
  col = mix(col, uTop, smoothstep(0.26, 1.0, t));
  float sd = max(dot(d, uDisc), 0.0);
  col += uDiscCol * (pow(sd, 6.0) * 0.28 + pow(sd, 40.0) * 0.5) * (uSun * 0.8 + 0.3) * (1.0 - uCover * 0.8);
  // soft clouds, lit from the horizon colour. Weather (uCover) thickens and darkens them.
  vec2 cp = d.xz / (abs(d.y) + 0.55) * 2.2 + vec2(uTime * (0.004 + 0.012 * uWind), 0.0);
  float cth = 0.56 - 0.3 * uCover;
  float cl = smoothstep(cth, cth + 0.3 - 0.12 * uCover, vn(cp * 1.3) * 0.62 + vn(cp * 2.9) * 0.38);
  cl *= smoothstep(-0.05, 0.25, y) * (1.0 - smoothstep(0.55, 0.9, y) * (1.0 - uCover * 0.8));
  col = mix(col, mix(uHor, uTop, 0.35) * (0.8 + 0.5 * uDay) + uHor * 0.25, cl * (0.18 + 0.3 * uDay + 0.45 * uCover));
  // sun or moon disc (HDR so bloom lifts it a little)
  float disc = smoothstep(0.9992, 0.9997, sd);
  col += uDiscCol * disc * (uSun > 0.5 ? 2.6 : 1.7) * (1.0 - uCover);
  col += uDiscCol * smoothstep(0.996, 0.9992, sd) * 0.2 * (1.0 - uCover);
  // stars
  if (uStars > 0.01 && y > 0.1) {
    vec3 p = d * 150.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float hs = h31(ip);
    float star = step(0.9965, hs) * smoothstep(0.5, 0.0, length(fp));
    float tw = 0.65 + 0.35 * sin(uTime * 1.6 * uTwinkle + hs * 60.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * uStars * smoothstep(0.1, 0.5, y) * (1.0 - uDay) * 1.4;
  }
  col += vec3(0.55, 0.62, 0.95) * uFlash;
  // the free camera: below the horizon is the haze the far city dissolves into, so land, water and sky meet without a seam
  col = mix(col, uFogCol, uFogAmt * smoothstep(0.075, -0.015, d.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uDiscCol: { value: new THREE.Color() }, uDisc: { value: new THREE.Vector3(0, 0.4, -1) },
      uStars: { value: 1 }, uTime: { value: 0 }, uDay: { value: 0 }, uSun: { value: 0 }, uTwinkle: { value: 1 }, uCover: { value: 0 }, uFlash: { value: 0 }, uWind: { value: 0 },
      uLift: { value: 0.34 }, uFogCol: { value: new THREE.Color() }, uFogAmt: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 20), mat);
  mesh.renderOrder = -100; mesh.frustumCulled = false;
  mesh.name = 'sky';
  function set(p) {
    const u = mat.uniforms;
    u.uTop.value.copy(p.top); u.uMid.value.copy(p.mid); u.uHor.value.copy(p.hor); u.uDisc.value.copy(p.disc);
    u.uDiscCol.value.copy(p.isSun ? new THREE.Color(1.0, 0.82, 0.55).lerp(new THREE.Color(1.0, 0.95, 0.85), clamp(p.day, 0, 1)) : new THREE.Color(0.8, 0.88, 1.0));
    u.uStars.value = p.stars; u.uDay.value = p.day; u.uSun.value = p.isSun ? 1 : 0;
  }
  return { mesh, mat, set };
}
