// city/particles.js · cheap GPU particles for weather and seasonal touches. No CPU work per frame: positions are computed in the
// vertex shader from one time uniform, inside a box that follows the camera target.
//   createRain()      thin falling streaks (LineSegments)
//   createFlakes()    snow, petals, leaves (Points, soft round sprites)
//   createFireworks() a few looping shells of sparks high above the river (Points)
// Every object has .u (uniforms), .setCount(n), and is hidden (visible=false) when its count is 0.
import * as THREE from 'three';

function rand4(n, seed = 1) {
  const a = new Float32Array(n * 4); let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < n * 4; i++) a[i] = r();
  return a;
}

const RAIN_VERT = /* glsl */`
attribute vec4 aR;
uniform float uTime, uSpeed, uLen, uH, uBaseY;
uniform vec3 uCenter, uBox;
uniform vec2 uWind;
varying float vA;
void main() {
  float spd = uSpeed * (0.85 + 0.3 * fract(aR.x * 7.13 + aR.z * 3.7));
  float y = mod(aR.y * uH - uTime * spd, uH);
  vec3 p = vec3((aR.x - 0.5) * uBox.x, y, (aR.z - 0.5) * uBox.z) + vec3(uCenter.x, uBaseY, uCenter.z);
  p.xz += uWind * (uH - y) * 0.12;
  vec3 v = vec3(uWind.x, -spd, uWind.y);
  float tail = aR.w > 0.5 ? 1.0 : 0.0;
  p -= v * uLen * tail;
  vA = 1.0 - tail * 0.9;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main() { gl_FragColor = vec4(uColor, uOpacity * vA); }`;

export function createRain(max = 2600) {
  const g = new THREE.BufferGeometry(), r = rand4(max, 77), pos = new Float32Array(max * 2 * 3), aR = new Float32Array(max * 2 * 4);
  for (let i = 0; i < max; i++) for (let e = 0; e < 2; e++) { const k = i * 2 + e; aR[k * 4] = r[i * 4]; aR[k * 4 + 1] = r[i * 4 + 1]; aR[k * 4 + 2] = r[i * 4 + 2]; aR[k * 4 + 3] = e; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  const u = { uTime: { value: 0 }, uSpeed: { value: 9 }, uLen: { value: 0.034 }, uH: { value: 11 }, uBaseY: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 0, 30) }, uWind: { value: new THREE.Vector2(0.6, 0.2) }, uColor: { value: new THREE.Color(0.72, 0.82, 1.0) }, uOpacity: { value: 0.3 } };
  const m = new THREE.LineSegments(g, new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: u, transparent: true, depthWrite: false, fog: false }));
  m.frustumCulled = false; m.visible = false; m.renderOrder = 8; m.name = 'rain';
  return { mesh: m, u, max, setCount(n) { n = Math.max(0, Math.min(max, n | 0)); g.setDrawRange(0, n * 2); m.visible = n > 0; } };
}

const FLAKE_VERT = /* glsl */`
attribute vec4 aR;
uniform float uTime, uSpeed, uSway, uSize, uPx, uH, uSpin, uBaseY;
uniform vec3 uCenter, uBox;
uniform vec2 uWind;
varying float vA, vS;
void main() {
  float spd = uSpeed * (0.55 + 0.9 * aR.w);
  float y = mod(aR.y * uH - uTime * spd, uH);
  float ph = aR.w * 40.0 + aR.x * 10.0;
  float x = mod(aR.x * uBox.x + uTime * uWind.x * 0.35, uBox.x) - uBox.x * 0.5 + sin(uTime * 0.7 + ph) * uSway;
  float z = mod(aR.z * uBox.z + uTime * uWind.y * 0.35, uBox.z) - uBox.z * 0.5 + cos(uTime * 0.5 + ph) * uSway;
  vec3 p = vec3(x + uCenter.x, y + uBaseY, z + uCenter.z);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * aR.w) * uPx / max(-mv.z, 0.5), 1.0, 14.0);
  vA = smoothstep(0.0, 0.5, y) * (1.0 - smoothstep(uH - 1.5, uH, y));
  vS = aR.w * 6.28 + uTime * uSpin * (aR.x - 0.5) * 4.0;
}`;
const FLAKE_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity, uPetal; varying float vA, vS;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (uPetal > 0.5) { float s = sin(vS), co = cos(vS); c = vec2(c.x * co - c.y * s, c.x * s + c.y * co); c.y *= 1.9; }
  float d = length(c);
  float a = smoothstep(0.5, 0.12, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * vA * uOpacity);
}`;

export function createFlakes(o = {}) {
  const max = o.max || 1600, g = new THREE.BufferGeometry(), r = rand4(max, o.seed || 5);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(r, 4));
  const u = {
    uTime: { value: 0 }, uBaseY: { value: 0 }, uSpeed: { value: o.speed ?? 0.8 }, uSway: { value: o.sway ?? 0.3 }, uSize: { value: o.size ?? 0.05 }, uPx: { value: 600 }, uH: { value: o.height ?? 10 }, uSpin: { value: o.spin ?? 0 },
    uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(o.w ?? 26, 0, o.d ?? 24) }, uWind: { value: new THREE.Vector2(0.3, 0.1) },
    uColor: { value: new THREE.Color(o.color ?? 0xffffff) }, uOpacity: { value: o.opacity ?? 0.85 }, uPetal: { value: o.petal ? 1 : 0 },
  };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: FLAKE_VERT, fragmentShader: FLAKE_FRAG, uniforms: u, transparent: true, depthWrite: false, fog: false }));
  m.frustumCulled = false; m.visible = false; m.renderOrder = 8; m.name = o.name || 'flakes';
  return { mesh: m, u, max, setCount(n) { n = Math.max(0, Math.min(max, n | 0)); g.setDrawRange(0, n); m.visible = n > 0; } };
}

/* ---- fireworks: shells burst high, sparks fly out, fall and fade, then the shell repeats ---- */
const FW_VERT = /* glsl */`
attribute vec4 aR;        // x,y: direction angles; z: speed; w: shell index
attribute vec3 aOrigin;   // burst point
attribute vec3 aCol;
uniform float uTime, uPx, uPeriod, uScale;
varying vec3 vC; varying float vA;
void main() {
  float shell = aR.w;
  float t = mod(uTime + shell * 2.3, uPeriod) - 0.2;          // seconds since this shell burst; negative = still rising
  float rise = clamp((t + 0.2) / 0.2, 0.0, 1.0);
  vec3 p = aOrigin;
  float ang = aR.x * 6.2831, el = acos(1.0 - 2.0 * aR.y);
  vec3 d = vec3(sin(el) * cos(ang), cos(el), sin(el) * sin(ang));
  float k = max(t, 0.0);
  float sp = 0.7 + aR.z * 0.9;
  p += d * sp * (1.0 - exp(-k * 1.7)) * 1.5 * uScale;
  p.y -= 0.22 * k * k * uScale;
  float life = 1.0 - smoothstep(1.1, 2.1, k);
  float flash = exp(-k * 7.0) * 1.5;
  vA = (t < 0.0 ? 0.0 : life * (0.55 + flash)) * (0.7 + 0.3 * sin(uTime * 30.0 + aR.z * 50.0));
  vC = aCol;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.17 * uScale * uPx / max(-mv.z, 0.5) * (0.8 + life), 1.5, 16.0);
}`;
const FW_FRAG = /* glsl */`
varying vec3 vC; varying float vA; uniform float uOpacity;
void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); if (a * vA < 0.01) discard; gl_FragColor = vec4(vC * 2.2, a * vA * uOpacity); }`;

export function createFireworks(shells = 5, per = 70) {
  const n = shells * per, g = new THREE.BufferGeometry(), r = rand4(n, 31), origin = new Float32Array(n * 3), col = new Float32Array(n * 3), aR = new Float32Array(n * 4);
  const set = new THREE.BufferAttribute(col, 3);
  for (let i = 0; i < n; i++) { const s = Math.floor(i / per); aR.set([r[i * 4], r[i * 4 + 1], r[i * 4 + 2], s], i * 4); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aR', new THREE.BufferAttribute(aR, 4));
  g.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3)); g.setAttribute('aCol', set);
  const u = { uTime: { value: 0 }, uPx: { value: 600 }, uPeriod: { value: 7.5 }, uOpacity: { value: 1 }, uScale: { value: 1 } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: FW_VERT, fragmentShader: FW_FRAG, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.frustumCulled = false; m.visible = false; m.renderOrder = 9; m.name = 'fireworks';
  // positions of the shells (x, y, z) and their palettes (array of hex) are set per celebration
  function configure(points, palette) {
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i / per) % points.length, p = points[s];
      origin[i * 3] = p[0]; origin[i * 3 + 1] = p[1]; origin[i * 3 + 2] = p[2];
      c.set(palette[(s + Math.floor((i % per) / 24)) % palette.length]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.attributes.aOrigin.needsUpdate = true; g.attributes.aCol.needsUpdate = true;
  }
  return { mesh: m, u, configure, shells, setVisible(v) { m.visible = !!v; } };
}
