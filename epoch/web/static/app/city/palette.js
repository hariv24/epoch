// city/palette.js · Morningside: the one colour source for the 3D city ("Low Library after dark").
// A blue-hour Upper West Side night: navy sky and fog, limestone-warm windows (cool blue ones as the secondary),
// Columbia blue for the reward bits (today's ring, the crown band, beacons, the crane on the construction cam).
// Hex strings are sRGB; util.rgb() / THREE.Color turn them into the linear working space.
import * as THREE from 'three';

export const MS = {
  // sky (blue hour) and fog
  skyTop: '#05122A', skyMid: '#0E2B57', skyBottom: '#2F639B', fog: '#183A68',
  // the page behind the scene
  navy: '#081A33', surface: '#0F2547', ink: '#F2F8FF',
  // light
  windowWarm: '#FFE3AE', windowAmber: '#FFCB86', windowCool: '#CDE7FF', lamp: '#FFDDA6',
  // the reward colour and its brighter beacon tone
  accent: '#8CC4EE', accentDeep: '#4F8FCB', beacon: '#D2E9FF',
  // materials
  limestone: '#F3EFE6', limestoneShade: '#D9D0BE', slate: '#2B3F63', steel: '#9DB4D2', dark: '#1B2B47',
};

// an HDR (linear, > 1) colour for bloom-lit bits: hex * k
export const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
// a GLSL vec3 literal of a hex colour in the linear working space (for shader constants)
export const glsl = (hex, k = 1) => { const c = new THREE.Color(hex).multiplyScalar(k); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
