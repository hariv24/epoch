// city/people.js · real people in the 3D scenes (docs/PEOPLE-SPEC.md §5, docs/PEOPLE.md). PROOF scope: one user character, the Today room.
//   const P = await createPerson({ outfit: 'everyday', lod: 'close' })      // rejects if anything fails to load: callers keep buildFigure()
//   P.root            THREE.Group, feet at y = 0, faces +Z; add it to the scene and place it
//   P.play(name, { fade = 0.3, at })   crossfade to a clip (idle, idle_look, sit_read, sit_type, ...); at = start time (s) or 'random'
//   P.update(dt)      advance the mixer + the head look-at;  returns true while it needs frames
//   P.lookAt(vec3 | null, weight)   world point the head turns toward (clamped, eased);  P.still(name, t) shows one frame (reduced motion)
//   P.dispose()
//   makeLighting(scene, renderer)   -> rig { setNight(bool), place(vec3), dispose() }   key + rim + a low RoomEnvironment PMREM for people
//   makeContactShadow(w, d, opacity) -> THREE.Mesh (a soft blob lying flat; add it under the feet or the seat)
// Skin: MeshPhysicalMaterial + onBeforeCompile: wrap lighting and a warm subsurface term at the light terminator (SPEC 5.1).
// URLs are relative to this module (pages load from /static/v/<fingerprint>/), the decoder and loaders are the vendored three addons.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BASE = new URL('../people/', import.meta.url);
let loader = null, manP = null, clipsP = null;
const gltfCache = new Map(), matCache = new Map();
const getLoader = () => loader || (loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
const manifest = () => manP || (manP = fetch(new URL('manifest.json', BASE)).then((r) => { if (!r.ok) throw new Error('people manifest ' + r.status); return r.json(); }));
const clipList = () => clipsP || (clipsP = getLoader().loadAsync(new URL('clips.glb', BASE).href).then((g) => g.animations));

/* ------------------------------------------------------------------ materials */
// shared uniforms: the same wrap and warm subsurface values for every person
const SKIN = { wrap: { value: 0.45 }, sss: { value: new THREE.Color('#c0502a') }, sssK: { value: 0.16 } };
function skinMaterial(src) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map, normalMap: src.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), color: 0xffffff,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    metalness: 0, roughness: 0.56, specularIntensity: 0.4, sheen: 0.25, sheenColor: new THREE.Color('#e0a07c'), sheenRoughness: 0.6, envMapIntensity: 0.3,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWrap = SKIN.wrap; sh.uniforms.uSss = SKIN.sss; sh.uniforms.uSssK = SKIN.sssK;
    sh.fragmentShader = sh.fragmentShader
      .replace('void RE_Direct_Physical', 'uniform float uWrap; uniform vec3 uSss; uniform float uSssK;\nvoid RE_Direct_Physical')
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
        `float ndl = dot( geometryNormal, directLight.direction );
		float wrapped = saturate( ( ndl + uWrap ) / ( 1.0 + uWrap ) );
		float term = pow( saturate( 1.0 - abs( ndl ) ), 2.0 ) * smoothstep( -0.9, -0.05, ndl + 0.35 );
		reflectedLight.directDiffuse += wrapped * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F )
			+ uSss * term * uSssK * directLight.color * ( 0.35 + 0.65 * material.diffuseContribution );`);
  };
  m.customProgramCacheKey = () => 'epoch-skin-1';
  return m;
}
function convert(src, meshName) {
  const key = src.uuid;
  if (matCache.has(key)) return matCache.get(key);
  const n = (src.name || '') + ' ' + (meshName || '');
  let m;
  if (/_body|\.body/.test(n)) m = skinMaterial(src);
  else if (/low-poly/.test(n)) {                                                    // the eyes: a glossy cornea over the iris texture
    m = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 0.35, envMapIntensity: 0.55 });
  } else if (/eyebrow|eyelash/.test(n)) {                                           // alpha-tested, never sorted: no halos
    m = new THREE.MeshStandardMaterial({ map: src.map, alphaMap: null, roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.4, transparent: false, depthWrite: true, alphaToCoverage: true });
  } else if (/hair/.test(n)) {
    m = new THREE.MeshPhysicalMaterial({ map: src.map, roughness: 0.48, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true, sheen: 0.4, sheenColor: new THREE.Color('#6a5a52'), sheenRoughness: 0.5, envMapIntensity: 0.7, specularIntensity: 0.6 });
  } else {                                                                           // clothes, shoes: plain PBR, a little env
    m = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: Math.max(0.55, src.roughness), metalness: 0, envMapIntensity: 0.35, side: THREE.DoubleSide, alphaTest: src.alphaTest, transparent: false });
    if (src.alphaTest) m.alphaToCoverage = true;
  }
  m.name = src.name; if (m.map) m.map.anisotropy = 4;
  matCache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ the person */
const PLAIN = new Set(['idle', 'idle_look', 'walk']);
export async function createPerson(o = {}) {
  const man = await manifest();
  const ch = man.characters.find((c) => c.id === (o.id || 'user')); if (!ch) throw new Error('no such character');
  const outfit = ch.outfits[o.outfit] ? o.outfit : ch.default_outfit;
  const file = ch.outfits[outfit].lods[o.lod || 'close'].file;
  const url = new URL(file, BASE).href;
  if (!gltfCache.has(url)) gltfCache.set(url, getLoader().loadAsync(url));
  const [g, clips] = await Promise.all([gltfCache.get(url), clipList()]);
  const root = new THREE.Group(); root.name = 'person-' + ch.id;
  const body = cloneSkinned(g.scene); root.add(body);
  let tris = 0;
  body.traverse((n) => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    n.frustumCulled = false; n.castShadow = false; n.receiveShadow = false;
    n.material = convert(n.material, n.name);
    tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
  });
  const bones = {}; body.traverse((n) => { if (n.isBone) bones[n.name] = n; });
  // clips for this body: the pelvis translation scales with the hip height (docs/PEOPLE.md)
  const k = ch.hip_height_m / man.clips.ref_hip_height_m, own = new Map();
  for (const c of clips) {
    const cc = c.clone();
    for (const t of cc.tracks) if (t.name === 'pelvis.position') { const v = t.values; for (let i = 0; i < v.length; i++) v[i] *= k; }
    own.set(c.name, cc);
  }
  const mixer = new THREE.AnimationMixer(body);
  const actions = new Map();
  const act = (name) => { let a = actions.get(name); if (!a) { const c = own.get(name); if (!c) throw new Error('no clip ' + name); a = mixer.clipAction(c); const loop = (man.clips.items[name] || {}).loop !== false; a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; actions.set(name, a); } return a; };
  let cur = null, curName = '';
  function play(name, opt = {}) {
    if (name === curName && !opt.restart) return;
    const next = act(name), fade = opt.fade == null ? 0.3 : Math.min(0.4, Math.max(0.25, opt.fade));
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.setEffectiveTimeScale(1);
    if (opt.at === 'random') next.time = Math.random() * next.getClip().duration; else if (typeof opt.at === 'number') next.time = opt.at;
    next.play();
    if (cur && cur !== next) { if (opt.fade === 0) { cur.stop(); } else next.crossFadeFrom(cur, fade, false); }
    cur = next; curName = name;
  }
  function still(name, t = 0) {                                                      // one frame (reduced motion): the pose at t seconds
    play(name, { fade: 0, at: t, restart: curName !== name }); cur.time = t; cur.paused = true; mixer.update(0); body.updateMatrixWorld(true); updateLook(0, true); updateBook();
  }
  // head look-at: turn the animated head toward a world point, clamped (yaw 55, pitch 30) and eased
  const head = bones.head, neck = bones.neck_01;
  body.updateMatrixWorld(true);
  const qRest = new THREE.Quaternion(); head.getWorldQuaternion(qRest);
  const rootQ0 = new THREE.Quaternion(); root.getWorldQuaternion(rootQ0);
  const fwdLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(qRest.clone().invert());
  let target = null, lookW = 0, wantW = 0;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
  let targetFn = null;
  function lookAt(p, w = 1) { targetFn = typeof p === 'function' ? p : null; target = p ? target || new THREE.Vector3() : null; if (p && !targetFn) target.copy(p); wantW = p ? w : 0; }
  function applyTurn(bone, share, desiredDir, headPos) {
    bone.getWorldQuaternion(q1);
    const fwd = v1.copy(fwdLocal).applyQuaternion(q1).normalize();
    q2.setFromUnitVectors(fwd, desiredDir);                                          // world delta that points the face at the target
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q2.w)));
    const lim = 0.95;                                                                // ~55 deg total
    if (ang > lim) q2.slerp(new THREE.Quaternion(), 1 - lim / ang);
    q2.slerp(new THREE.Quaternion(), 1 - share * lookW);
    q3.copy(q2).multiply(q1);                                                        // new world rotation
    bone.parent.getWorldQuaternion(q1); q1.invert();
    bone.quaternion.copy(q1.multiply(q3));
    bone.updateMatrixWorld(true);
  }
  function updateLook(dt, snap) {
    lookW += (wantW - lookW) * (snap ? 1 : Math.min(1, dt * 4));
    if (!target || lookW < 0.01) return;
    body.updateMatrixWorld(true);
    if (targetFn) targetFn(target);
    head.getWorldPosition(v2);
    const dir = target.clone().sub(v2).normalize();
    if (neck) applyTurn(neck, 0.4, dir, v2);
    applyTurn(head, 0.9, dir, v2);
  }
  // a book held in both hands (sit_read): follows the midpoint of the hands, its page turned toward the face
  let book = null;
  function handsMid(out) { const a = bones.hand_l, b = bones.hand_r; a.getWorldPosition(v1); b.getWorldPosition(out); return out.add(v1).multiplyScalar(0.5); }
  function showBook(on) {
    if (on && !book) {
      const g = new THREE.Group(), cover = new THREE.MeshStandardMaterial({ color: 0x2f4d6e, roughness: 0.7 }), pages = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.9 });
      const blk = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.022, 0.2), pages), back = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.006, 0.21), cover);
      back.position.y = -0.014; blk.position.y = 0; g.add(blk, back);
      const hump = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.2), cover); hump.position.y = 0.0; g.add(hump);
      book = g; root.add(book);
    }
    if (book) book.visible = !!on;
  }
  const bm = new THREE.Vector3(), bx = new THREE.Vector3(), bz = new THREE.Vector3(), by = new THREE.Vector3(), bq = new THREE.Matrix4();
  function updateBook() {
    if (!book || !book.visible) return;
    handsMid(bm); head.getWorldPosition(v2);
    bx.set(0, 0, 0); bones.hand_l.getWorldPosition(bx); bones.hand_r.getWorldPosition(bz); bx.sub(bz).setY(0).normalize();   // across the pages
    by.copy(v2).sub(bm).normalize().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.5, 0)).normalize();               // page normal: toward the face, lifted
    bz.crossVectors(bx, by).normalize(); bx.crossVectors(by, bz).normalize();
    bq.makeBasis(bx, by, bz);
    book.parent.worldToLocal(bm); book.position.copy(bm).addScaledVector(by, -0.0).add(new THREE.Vector3(0, 0.0, 0));
    root.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); book.quaternion.setFromRotationMatrix(inv.multiply(bq));
  }
  function update(dt) {
    mixer.update(dt);
    body.updateMatrixWorld(true);
    updateLook(dt, false);
    updateBook();
    return true;
  }
  function dispose() { mixer.stopAllAction(); mixer.uncacheRoot(body); root.removeFromParent(); body.traverse((n) => { if (n.skeleton) n.skeleton.dispose(); }); }
  return { root, body, bones, mixer, play, update, lookAt, still, showBook, handsMid, dispose, tris, hip: ch.hip_height_m, clipInfo: man.clips.items, get current() { return curName; } };
}

/* ------------------------------------------------------------------ lighting for people (SPEC 5.5) */
let envCache = null;
export function makeLighting(scene, renderer, o = {}) {
  if (!envCache || envCache.r !== renderer) {
    const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(new RoomEnvironment(), 0.04); pm.dispose();
    envCache = { r: renderer, tex: rt.texture };
  }
  const env = envCache.tex;
  const key = new THREE.DirectionalLight(0xffd9b0, 0.8), rim = new THREE.DirectionalLight(0xa9c4ff, 1.1), fill = new THREE.DirectionalLight(0xfff0e0, 0.2);
  const grp = new THREE.Group(); grp.name = 'people-lights'; grp.add(key, key.target, rim, rim.target, fill, fill.target);
  scene.add(grp);
  const mats = () => [...matCache.values()];
  function apply() { for (const m of mats()) { if (m.envMap !== env) { m.envMap = env; m.needsUpdate = true; } } }
  let at = new THREE.Vector3(), night = false, camPos = null;
  function aim() {
    const c = camPos || new THREE.Vector3(0, 2.2, 6), toCam = c.clone().sub(at); toCam.y = 0; if (toCam.lengthSq() < 1e-4) toCam.set(0, 0, 1); toCam.normalize();
    const side = new THREE.Vector3(toCam.z, 0, -toCam.x);                              // camera-right
    key.position.copy(at).addScaledVector(toCam, 2.2).addScaledVector(side, 1.8).add(new THREE.Vector3(0, 2.6, 0)); key.target.position.copy(at).add(new THREE.Vector3(0, 1, 0));
    rim.position.copy(at).addScaledVector(toCam, -2.4).addScaledVector(side, -1.2).add(new THREE.Vector3(0, 2.4, 0)); rim.target.position.copy(key.target.position);
    fill.position.copy(at).addScaledVector(toCam, 2.0).addScaledVector(side, -2.2).add(new THREE.Vector3(0, 0.8, 0)); fill.target.position.copy(key.target.position);
  }
  function setNight(n) {
    night = !!n;
    key.intensity = night ? 1.25 : 0.8; key.color.set(night ? 0xffcf96 : 0xffe2c0);
    rim.intensity = night ? 1.6 : 0.9; rim.color.set(night ? 0x8fb0ff : 0xb8d0ff);
    fill.intensity = night ? 0.4 : 0.2;
    for (const m of mats()) if (m.envMapIntensity != null && m.userData.envBase == null) m.userData.envBase = m.envMapIntensity;
    for (const m of mats()) if (m.userData.envBase != null) m.envMapIntensity = m.userData.envBase * (night ? 0.8 : 1);
  }
  return { apply, setNight, place(p, cam) { at.copy(p); if (cam) camPos = cam.clone(); aim(); }, aim, env, group: grp, dispose() { scene.remove(grp); } };
}

export function makeContactShadow(w = 0.9, d = 0.9, opacity = 0.42) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, depthWrite: false, toneMapped: false, color: 0x1a0f0a }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 1; m.name = 'contact-shadow';
  return m;
}

export const _debug = { SKIN, matCache };
