// city/weather.js · live weather over the diorama. Everything is subtle and cheap.
//   clouds       a few flat-shaded clumps drifting behind the skyline (instanced), plus soft cloud shadows on the ground
//   rain, snow   GPU particles (see particles.js), thickness follows the intensity
//   fog          drifting low mist and a shorter fog distance
//   lighting     apply(p) bends the time-of-day parameters: the sun/moon is covered, the key light dims, the sky greys out,
//                windows glow a little more on dull days; a storm adds the odd soft flash
// set({condition, is_day, cloud_cover, precipitation_mm, wind_kmh, available, enabled}) takes the /api/weather object.
// Values ease toward their targets (about 3 s). Under reduced motion they snap and nothing moves.
import * as THREE from 'three';
import { clamp, lerp, rng, TAU } from './util.js';
import { createRain, createFlakes } from './particles.js';

// Morningside overcast: navy-slate at night, a pale Columbia grey by day, near-white blue for snow
const NIGHT = { top: new THREE.Color('#0f1f3b'), mid: new THREE.Color('#1a2e52'), hor: new THREE.Color('#2c4670') };
const DAY = { top: new THREE.Color('#687e9e'), mid: new THREE.Color('#8ba0bc'), hor: new THREE.Color('#b3c3d6') };
const SNOW = { top: new THREE.Color('#a4b4ca'), mid: new THREE.Color('#bfcddc'), hor: new THREE.Color('#d9e2ee') };
const tmp = new THREE.Color(), tmp2 = new THREE.Color(), WHITE = new THREE.Color(0xf2f8ff);

export function targetsFor(w) {
  const t = { cover: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0 };
  if (!w || w.enabled === false || w.available === false || !w.condition) return t;
  const cc = w.cloud_cover != null ? clamp(w.cloud_cover / 100, 0, 1) : null, pr = Math.max(0, +w.precipitation_mm || 0);
  t.wind = clamp((+w.wind_kmh || 0) / 40, 0, 1);
  switch (w.condition) {
    case 'clouds': t.cover = Math.max(0.5, cc ?? 0.7); break;
    case 'rain': t.cover = Math.max(0.78, cc ?? 0.85); t.rain = clamp(0.4 + pr / 3, 0.4, 1); break;
    case 'snow': t.cover = Math.max(0.72, cc ?? 0.8); t.snow = clamp(0.45 + pr / 2, 0.45, 1); break;
    case 'fog': t.cover = 0.55; t.fog = 0.9; break;
    case 'storm': t.cover = 1; t.rain = 1; t.storm = 1; t.wind = Math.max(t.wind, 0.5); break;
    default: t.cover = Math.min(0.4, (cc ?? 0.1) * 0.55); break;       // clear
  }
  return t;
}

export function createWeather({ scene, sky, target, L, radial, camera = null, unit = 1, bare = false }) {   // `camera`: only for the free-orbit city, where the cloud deck follows the viewer
  const group = new THREE.Group(); group.name = 'weather'; scene.add(group);
  const v = { cover: 0, rain: 0, snow: 0, fog: 0, storm: 0, wind: 0, flash: 0, dark: 0 };
  let T = targetsFor(null), motion = true, tNow = 0, flashT = 6 + Math.random() * 8, flashSeq = 0, dayAmt = 0.5;
  const info = { condition: null, is_day: null };

  /* ---- clouds: clumps of squashed icospheres, drifting with the wind, behind and beside the skyline ---- */
  const CLOUDS = 18, PUFFS = 5, r = rng(404);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, transparent: true, opacity: 0.92 });
  const cloudMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, CLOUDS * PUFFS);
  cloudMesh.frustumCulled = false; cloudMesh.count = 0; cloudMesh.renderOrder = 1; cloudMesh.name = 'clouds'; group.add(cloudMesh);
  const clouds = Array.from({ length: CLOUDS }, (_, i) => ({
    x: (r() - 0.5) * 84, y: 5.2 + r() * 3.4, z: -(8 + r() * 28) + (i % 5 === 0 ? 10 : 0), s: 1.5 + r() * 1.9, sp: 0.18 + r() * 0.22,
    puffs: Array.from({ length: PUFFS }, (_, k) => ({ dx: (k - (PUFFS - 1) / 2) * (0.7 + r() * 0.4), dy: (r() - 0.3) * 0.5, dz: (r() - 0.5) * 0.9, sc: 0.7 + r() * 0.55 - Math.abs(k - 2) * 0.12 })),
  }));
  const dm = new THREE.Object3D();
  // free-orbit camera (World > City): the cloud deck stays behind the skyline of whatever side you look from, and thins out as you look
  // down or pull far back, so a cloud never fills the view
  let camFade = 1;
  const ramp = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  function followCamera() {
    if (!camera) return;
    const dx = camera.position.x - target.x, dy = camera.position.y - target.y, dz = camera.position.z - target.z, rr = Math.hypot(dx, dy, dz) || 1;
    cloudMesh.rotation.y = Math.atan2(dx, dz) - 0.12;
    camFade = ramp(0.7, 0.95, Math.acos(clamp(dy / rr, -1, 1))) * (1 - ramp(30, 55, rr));
    cloudMat.opacity = 0.92 * camFade;
  }
  function layoutClouds(t) {
    const n = Math.round(v.cover * CLOUDS * (0.4 + 0.6 * v.cover)); let c = 0;
    for (let i = 0; i < n; i++) {
      const cl = clouds[i], x = ((cl.x + t * cl.sp * (0.4 + 1.6 * v.wind) + 44) % 88 + 88) % 88 - 44;
      for (const p of cl.puffs) {
        dm.position.set(x + p.dx * cl.s, cl.y + p.dy * cl.s, cl.z + p.dz * cl.s); dm.rotation.set(0, i + p.dx, 0);
        dm.scale.set(cl.s * p.sc * 1.15, cl.s * p.sc * 0.62, cl.s * p.sc * 0.9); dm.updateMatrix(); cloudMesh.setMatrixAt(c++, dm.matrix);
      }
    }
    cloudMesh.count = c; cloudMesh.instanceMatrix.needsUpdate = true; cloudMesh.visible = c > 0 && camFade > 0.01;
  }

  /* ---- soft cloud shadows sliding over the streets ---- */
  const SHN = 7;
  const shMat = new THREE.MeshBasicMaterial({ map: radial, color: 0x030a18, transparent: true, opacity: 0.0, depthWrite: false, fog: false });
  const shMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shMat, SHN);
  shMesh.frustumCulled = false; shMesh.renderOrder = 3; shMesh.count = 0; group.add(shMesh);
  const shadowsOf = Array.from({ length: SHN }, () => ({ x: (r() - 0.5) * 20, z: L.zBack * 0.2 + r() * (L.zFront - L.zBack) * 0.6, s: 3 + r() * 3, sp: 0.15 + r() * 0.2 }));
  function layoutShadows(t) {
    const n = Math.round(v.cover * SHN * dayAmt);
    for (let i = 0; i < n; i++) { const s = shadowsOf[i], x = ((s.x + t * s.sp + 14) % 28 + 28) % 28 - 14; dm.position.set(x, 0.035, s.z); dm.rotation.set(0, 0, 0); dm.scale.set(s.s * 1.5, 1, s.s); dm.updateMatrix(); shMesh.setMatrixAt(i, dm.matrix); }
    shMesh.count = n; shMesh.instanceMatrix.needsUpdate = true; shMesh.visible = n > 0;
    shMat.opacity = 0.16 * dayAmt * Math.min(1, v.cover * 1.3);
  }

  /* ---- low mist ---- */
  const FOGN = 16;
  const fogMat = new THREE.MeshBasicMaterial({ map: radial, color: 0xa9bdd6, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const fogMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fogMat, FOGN);
  fogMesh.frustumCulled = false; fogMesh.renderOrder = 5; fogMesh.count = 0; group.add(fogMesh);
  const banks = Array.from({ length: FOGN }, (_, i) => ({ x: (r() - 0.5) * 22, z: L.zBack + (L.zFront - L.zBack) * (0.1 + 0.85 * (i / FOGN)), y: 0.3 + r() * 1.2, s: 4 + r() * 4, sp: (r() - 0.5) * 0.3 }));
  function layoutFog(t) {
    const n = Math.round(v.fog * FOGN);
    for (let i = 0; i < n; i++) { const b = banks[i]; dm.position.set(b.x + Math.sin(t * 0.07 * b.sp * 6 + i) * 1.6, b.y, b.z); dm.rotation.set(0, 0, 0); dm.scale.set(b.s * 2.2, 1, b.s * 1.1); dm.updateMatrix(); fogMesh.setMatrixAt(i, dm.matrix); }
    fogMesh.count = n; fogMesh.instanceMatrix.needsUpdate = true; fogMesh.visible = n > 0;
    fogMat.opacity = 0.34 * v.fog;
  }

  /* ---- rain, snow ---- */
  const rain = createRain(2600), snow = createFlakes({ max: 1800, speed: 0.75, sway: 0.35, size: 0.06, seed: 9, name: 'snow' });
  rain.u.uCenter.value = snow.u.uCenter.value = target; group.add(rain.mesh, snow.mesh);

  // `unit` (a number, or a function for a free camera) is how many metres one diorama unit is worth: the particles are sized and timed
  // in diorama units, so on the real city everything scales with it and falls the same way on screen. `bare` leaves the cloud clumps,
  // cloud shadows and ground mist out (the real-city sky draws its own clouds and fog).
  const U = () => (typeof unit === 'function' ? unit() : unit);
  let quiet = false, lastU = 0;
  if (bare) { cloudMesh.visible = shMesh.visible = fogMesh.visible = false; }
  function layout(t) {
    const none = v.cover < 0.004 && v.rain < 0.004 && v.snow < 0.004 && v.fog < 0.004;
    const k = U();
    if (none && quiet && Math.abs(k / (lastU || 1) - 1) < 0.08) return;
    quiet = none; lastU = k;
    rain.u.uTime.value = snow.u.uTime.value = t;
    if (!bare) { layoutClouds(t); layoutShadows(t); layoutFog(t); }
    rain.u.uBox.value.set(34 * k, 0, 30 * k); rain.u.uH.value = 11 * k; rain.u.uLen.value = 0.034 * k;
    snow.u.uBox.value.set(26 * k, 0, 24 * k); snow.u.uH.value = 10 * k; snow.u.uSize.value = 0.06 * k; snow.u.uSway.value = 0.35 * k;
    rain.setCount(Math.round(v.rain * (bare ? 1500 : 2200))); rain.u.uOpacity.value = bare ? 0.1 + 0.12 * v.rain : 0.16 + 0.17 * v.rain;
    rain.u.uWind.value.set((0.5 + 3.2 * v.wind) * k, 0.3 * k); rain.u.uSpeed.value = (8.5 + 3 * v.storm) * k;
    snow.setCount(Math.round(v.snow * (bare ? 1100 : 1800))); snow.u.uWind.value.set((0.3 + 2 * v.wind) * k, 0.2 * k); snow.u.uSpeed.value = 0.75 * k; snow.u.uOpacity.value = 0.55 + 0.35 * v.snow;
  }
  /** the particle box sits around `y` (the ground under the camera target); call each frame on the real city */
  function setBase(y) { rain.u.uBaseY.value = y - 0.15 * rain.u.uH.value; snow.u.uBaseY.value = y - 0.15 * snow.u.uH.value; }

  function set(w) {
    T = targetsFor(w); info.condition = w && w.condition || null; info.is_day = w ? w.is_day : null;
    if (!motion) { Object.assign(v, T); v.dark = darkOf(); layout(tNow); }
  }
  const darkOf = () => clamp(Math.max(v.rain, v.snow * 0.45, v.storm) * 0.75 + v.cover * 0.25, 0, 1);

  /** per-frame: ease toward the targets, drift, lightning. Returns true while something still needs frames. */
  function update(dt, t, on) {
    motion = on; tNow = t;
    let busy = false;
    const k = on ? 1 - Math.exp(-dt * 0.9) : 1;
    for (const key of ['cover', 'rain', 'snow', 'fog', 'storm', 'wind']) {
      const d = T[key] - v[key];
      if (Math.abs(d) > 0.004) { v[key] += d * k; busy = true; } else v[key] = T[key];
    }
    v.dark = darkOf(); if (!bare) followCamera();
    if (on && v.storm > 0.5) {
      flashT -= dt;
      if (flashT <= 0) { flashSeq = 3; flashT = 7 + Math.random() * 12; }
      if (flashSeq > 0) { v.flash = Math.max(v.flash, 0.65); flashSeq--; }
    }
    if (v.flash > 0.001) { v.flash *= Math.exp(-dt * 9); busy = true; } else v.flash = 0;
    layout(t);
    return busy;
  }

  /** bend the time-of-day parameters (mutates p) */
  function apply(p) {
    dayAmt = clamp(p.day, 0, 1);
    const cov = v.cover * 0.88, dk = v.dark;
    if (cov > 0.001) {
      for (const key of ['top', 'mid', 'hor']) {
        tmp.copy(NIGHT[key]).lerp(DAY[key], dayAmt);
        if (v.snow > 0.01) tmp.lerp(tmp2.copy(SNOW[key]).multiplyScalar(0.4 + 0.6 * dayAmt), v.snow * (0.5 + 0.5 * dayAmt));
        tmp.multiplyScalar(1 - dk * 0.42 * (0.4 + 0.6 * dayAmt));
        // city glow tints the underside of the cloud deck at night
        if (dayAmt < 0.5 && key !== 'top') tmp.lerp(tmp2.setRGB(0.2, 0.18, 0.16), 0.26 * (1 - dayAmt * 2) * v.cover);     // limestone-warm city glow
        p[key].lerp(tmp, cov);
      }
    }
    p.keyI *= 1 - 0.72 * v.cover; p.hemiI *= 1 + 0.18 * v.cover * dayAmt; p.day *= 1 - 0.3 * v.cover; p.stars *= 1 - v.cover;
    p.glow = Math.min(1.1, p.glow + (0.4 * v.cover + 0.15 * dk) * dayAmt);
    if (v.flash > 0) { p.hemiI += 2.6 * v.flash; p.glow *= 1 - 0.3 * v.flash; }
    sky.mat.uniforms.uCover.value = v.cover; sky.mat.uniforms.uWind.value = v.wind; sky.mat.uniforms.uFlash.value = v.flash * 0.55;
    // cloud clumps take the sky's colours
    tmp.copy(p.hor).lerp(WHITE, 0.55 * dayAmt).multiplyScalar(1 - dk * 0.45);
    cloudMat.color.copy(tmp).multiplyScalar(0.5 + 0.7 * dayAmt); cloudMat.emissive.copy(p.hor).multiplyScalar(0.2 + 0.25 * (1 - dayAmt));
    fogMat.color.copy(p.hor).lerp(p.mid, 0.4).lerp(WHITE, 0.1 * dayAmt);
    rain.u.uColor.value.copy(tmp2.setRGB(0.64, 0.8, 1.0)).multiplyScalar(0.55 + 0.6 * dayAmt);
    snow.u.uColor.value.copy(tmp2.setRGB(0.95, 0.97, 1.0)).multiplyScalar(0.8 + 0.3 * dayAmt);
    return p;
  }
  function setPx(px) { snow.u.uPx.value = px; }
  return { group, v, set, update, apply, setPx, setBase, info, rain, snow, targets: () => T, layout: (t) => layout(t) };
}

void lerp; void TAU;
