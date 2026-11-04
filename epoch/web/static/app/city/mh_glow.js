// city/mh_glow.js · soft glow points (beacons, landmark lights, the dream-home light). One draw call per set; sizes are metres at
// the point, with a small floor in pixels for sizes >= 30 so the light still reads from across the island.
import * as THREE from 'three';

export function makeGlow(max) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: 800 } },
    vertexShader: 'attribute vec3 color; attribute float aSize; uniform float uPx; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = -mv.z; float s = aSize * uPx / max(d, 1.0); float far = smoothstep(500.0, 2500.0, d); vA = 1.0; vC = color; gl_PointSize = clamp(max(s, mix(0.0, 9.0, far) * step(30.0, aSize)), 0.0, 40.0) + 2.0; }',
    fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vC * a * vA, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 6;
  const P = g.attributes.position.array, C = g.attributes.color.array, S = g.attributes.aSize.array;
  let n = 0;
  return {
    points, mat, max,
    clear() { n = 0; },
    add(x, y, z, r, gg, b, size) { if (n >= max) return; P[3 * n] = x; P[3 * n + 1] = y; P[3 * n + 2] = z; C[3 * n] = r; C[3 * n + 1] = gg; C[3 * n + 2] = b; S[n] = size; n++; },
    commit() { g.setDrawRange(0, n); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.aSize.needsUpdate = true; points.visible = n > 0; },
    setPx(px) { mat.uniforms.uPx.value = px; },
    get count() { return n; },
  };
}
