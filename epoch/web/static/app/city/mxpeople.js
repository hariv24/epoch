// city/mxpeople.js · Mixamo people (docs/PEOPLE-SPEC.md §10): bodies from artists (Sketchfab GLBs, CC-BY), motion from Mixamo mocap.
// Nothing here authors a bone pose. A clip is retargeted by copying each source bone's WORLD rotation change from its rest pose onto the
// character's matching bone (so bone rolls and rest-pose differences between rigs do not matter); the hips move by the source hips
// displacement scaled by the hip-height ratio. Props are only parented to a hand bone.
//   const P = await createMxPerson({ file: 'user.glb' })     // rejects if anything fails to load: the caller keeps the code-built figure
//   P.root  feet at y = 0, faces +Z.   P.play(name, { fade, at })   P.update(dt)   P.still(name, t)   P.attachProp(obj3d, 'RightHand')   P.dispose()
// Assets live in ../people/mixamo/ (gitignored: Mixamo files are never redistributed). Same API shape as people.js createPerson (lookAt is a no-op).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { _debug } from './people.js';
export { makeLighting, makeContactShadow } from './people.js';

const BASE = new URL('../people/mixamo/', import.meta.url);
const FPS = 30, HEIGHT = 1.76;                                       // every character is scaled to the same standing height
// Sketchfab exports use KHR_materials_pbrSpecularGlossiness, which three.js no longer reads: map the diffuse texture to a standard material
class SpecGloss {
  constructor(p) { this.parser = p; this.name = 'KHR_materials_pbrSpecularGlossiness'; }
  ext(i) { const d = this.parser.json.materials[i]; return d && d.extensions && d.extensions[this.name]; }
  getMaterialType(i) { return this.ext(i) ? THREE.MeshStandardMaterial : null; }
  extendMaterialParams(i, params) {
    const e = this.ext(i); if (!e) return Promise.resolve();
    const df = e.diffuseFactor || [1, 1, 1, 1];
    params.color = new THREE.Color().setRGB(df[0], df[1], df[2], THREE.LinearSRGBColorSpace); params.opacity = df[3]; params.metalness = 0; params.roughness = 0.85;
    return e.diffuseTexture ? this.parser.assignTexture(params, 'map', e.diffuseTexture, THREE.SRGBColorSpace) : Promise.resolve();
  }
}
let loader = null;
const getLoader = () => loader || (loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register((p) => new SpecGloss(p)));   // meshopt: the prepped Butler students (people/mixamo/students/)
const cache = new Map();
const load = (file) => { const u = new URL(file, BASE).href; if (!cache.has(u)) cache.set(u, getLoader().loadAsync(u)); return cache.get(u); };

// mixamorig:Hips, mixamorigHips, mixamorig9:Hips (three drops the colon), Sketchfab suffixes (mixamorig_Hips_03) -> Hips
export const norm = (n) => n.replace(/_\d+$/, '').replace(/^mixamorig\d*[:_]?/, '').replace(/^Alexis[:_]?(?=[A-Z])/, '');   // 'Alexis:Hips' (Butler v2 student) -> Hips

/* ------------------------------------------------------------------ the motion source (clips.glb) */
let srcP = null;
function source() {
  return srcP || (srcP = load('clips.glb').then((g) => {
    const scene = g.scene, bones = new Map();
    scene.updateMatrixWorld(true);
    scene.traverse((n) => { if (/^mixamorig/.test(n.name)) bones.set(norm(n.name), n); });
    const rest = new Map(); for (const [k, b] of bones) rest.set(k, b.getWorldQuaternion(new THREE.Quaternion()));
    const hips = bones.get('Hips'), hipsRest = hips.getWorldPosition(new THREE.Vector3());
    const dummy = scene.getObjectByProperty('isSkinnedMesh', true); if (dummy) dummy.visible = false;
    return { scene, bones, rest, hips, hipsRest, clips: new Map(g.animations.map((a) => [a.name, a])), mixer: new THREE.AnimationMixer(scene) };
  }));
}

/* ------------------------------------------------------------------ a character */
function prepare(g) {
  const body = cloneSkinned(g.scene), holder = new THREE.Group(), root = new THREE.Group();
  holder.add(body); root.add(holder); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body, true), s = HEIGHT / (box.max.y - box.min.y);
  holder.scale.setScalar(s); holder.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  root.updateMatrixWorld(true);
  return { root, holder, body };
}
const triOf = (n) => (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
export function characterTris(body) {
  let t = 0; body.traverse((n) => { if (n.isMesh && n.visible) t += triOf(n); }); return t;
}
// Egunoff's "LOD man" GLBs hold 3 LODs of every part in one file. Keep the closest (largest) mesh per material plus small parts (eyes, teeth);
// the other LODs stay in the scene graph, hidden (`userData.lod`), for the scenes that want a mid or far figure.
export function pickLods(body) {
  const by = new Map(), meshes = []; body.traverse((n) => { if (n.isMesh) { meshes.push(n); const k = n.material.name || n.material.uuid; (by.get(k) || by.set(k, []).get(k)).push(n); } });
  let tall = 0; for (const n of meshes) { n.geometry.computeBoundingBox(); tall = Math.max(tall, n.geometry.boundingBox.max.y - n.geometry.boundingBox.min.y); }
  const hidden = [];
  for (const list of by.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => triOf(b) - triOf(a));
    list.forEach((n, i) => { if (i && (n.geometry.boundingBox.max.y - n.geometry.boundingBox.min.y) > tall * 0.2) { n.visible = false; n.userData.lod = i; hidden.push(n); } });
  }
  return hidden;
}
const qi = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v3 = new THREE.Vector3(), m4 = new THREE.Matrix4();

// build an AnimationClip for this character from a source clip. o: { trim:[t0,t1] seconds, strip:'ref'|'none', name }
function retarget(ch, src, clipName, o = {}) {
  const clip = src.clips.get(clipName); if (!clip) throw new Error('no source clip ' + clipName);
  const act = src.mixer.clipAction(clip); act.reset().play();
  const t0 = o.trim ? o.trim[0] : 0, t1 = o.trim ? o.trim[1] : clip.duration, n = Math.max(2, Math.round((t1 - t0) * FPS) + 1);
  const bones = ch.order, times = new Float32Array(n), quats = new Map(bones.map((b) => [b, new Float32Array(n * 4)])), hipPos = new Float32Array(n * 3);
  const wq = new Map(), hp = ch.hipsParent;
  let ref = null, drift = null;
  if (o.inPlace) {                                   // a locomotion loop with root motion baked in (the walk clip travels 1.44 m per 1.07 s cycle): take out the linear travel so the
    const at = (t) => { act.time = Math.min(clip.duration - 1e-4, t); src.mixer.update(0); src.scene.updateMatrixWorld(true); return src.hips.getWorldPosition(new THREE.Vector3()); };
    drift = at(t0 + (n - 1) / FPS).sub(at(t0)); drift.y = 0;   // hips stay over the root and the cycle loops without the feet snapping back (WORLD.md §13.4 stoop check)
  }
  for (let f = 0; f < n; f++) {
    const t = Math.min(clip.duration - 1e-4, t0 + f / FPS); times[f] = f / FPS;
    act.time = t; src.mixer.update(0); src.scene.updateMatrixWorld(true);
    for (const b of bones) {
      const k = ch.keys.get(b), sb = src.bones.get(k), parentQ = wq.get(b.parent) || ch.restW.get(b.parent) || qi.identity();
      let q;
      if (sb) {
        sb.getWorldQuaternion(qa); qa.multiply(qb.copy(src.rest.get(k)).invert());      // world rotation change from the source rest
        const w = qa.multiply(ch.restW.get(b)).clone(); wq.set(b, w);
        q = qb.copy(parentQ).invert().multiply(w).clone();
      } else { q = b.userData.restQ.clone(); wq.set(b, parentQ.clone().multiply(q)); }
      q.toArray(quats.get(b), f * 4);
    }
    // hips: source displacement from its rest position, scaled by the hip-height ratio, expressed in the hips' parent space
    src.hips.getWorldPosition(v3); v3.sub(src.hipsRest);
    if (o.strip !== 'none') { if (!ref) ref = new THREE.Vector3(v3.x, 0, v3.z); v3.x -= ref.x; v3.z -= ref.z; if (drift) { const k = f / (n - 1); v3.x -= drift.x * k; v3.z -= drift.z * k; } }   // root motion out (pelvis stays over the root)
    v3.multiplyScalar(ch.k).add(ch.hipsRestW);
    m4.copy(hp.matrixWorld).invert(); v3.applyMatrix4(m4); v3.toArray(hipPos, f * 3);
  }
  act.stop(); src.mixer.uncacheAction(clip);
  const tracks = [new THREE.VectorKeyframeTrack(ch.hips.uuid + '.position', times, hipPos)];
  for (const b of bones) tracks.push(new THREE.QuaternionKeyframeTrack(b.uuid + '.quaternion', times, quats.get(b)));
  return new THREE.AnimationClip(o.name || clipName, (n - 1) / FPS, tracks);
}

// the clips each state needs: [source clip, options, loop]
const CLIPS = {
  typing: ['typing', {}], sit_idle: ['sit_idle', {}], sit_drink: ['sit_drink', { trim: [124 / FPS, 456 / FPS] }],
  idle: ['idle', {}], idle_happy: ['idle_happy', {}], walk: ['walk', { inPlace: true }],
  run: ['run', { inPlace: true }], sleep: ['sleep', {}], lie: ['lie', {}], wake: ['wake', { strip: 'none' }],
  sit_read: ['sit_idle', {}], sit_to_type: ['sit_to_type', { strip: 'none' }], stand_to_sit: ['stand_to_sit', { strip: 'none' }], sit_to_stand: ['sit_to_stand', { strip: 'none' }],
  writing: ['writing', {}], yawn: ['yawn', {}], arm_stretch: ['arm_stretch', {}], neck_stretch: ['neck_stretch', {}],   // Butler v2 (docs/BUTLER-V2.md §5)
};

export async function createMxPerson(o = {}) {
  const [g, src] = await Promise.all([load(o.file || 'hariv.glb'), source()]);
  const ch = prepare(g), { root, body } = ch;
  const hiddenLods = pickLods(body);
  root.name = 'mx-person';
  const tris = characterTris(body);
  // materials: the GLB's own (MeshStandardMaterial); registered with people.js lighting so env + night scaling apply
  body.traverse((n) => {
    if (!n.isMesh) return;
    n.frustumCulled = false; n.castShadow = false; n.receiveShadow = false;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (m.map) m.map.anisotropy = 4;
      if (m.alphaTest > 0 || m.transparent) { m.alphaToCoverage = true; m.depthWrite = true; m.transparent = false; if (!m.alphaTest) m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
      m.envMapIntensity = 0.45; m.roughness = Math.max(m.roughness ?? 0.8, 0.6); m.metalness = Math.min(m.metalness ?? 0, 0.1);
      _debug.matCache.set(m.uuid, m);
    }
  });
  // bones, mapped to the source by normalised name
  const bones = {}, order = [], keys = new Map(), restW = new Map();
  root.updateMatrixWorld(true);
  body.traverse((n) => {
    if (!n.isBone) return;
    const k = norm(n.name); keys.set(n, k); if (!bones[k]) bones[k] = n; order.push(n);
    n.userData.restQ = n.quaternion.clone();
  });
  const hips = bones.Hips; if (!hips) throw new Error('character has no Hips bone');
  for (const b of order) restW.set(b, b.getWorldQuaternion(new THREE.Quaternion()));
  let p = hips.parent; while (p && p !== root) { restW.set(p, p.getWorldQuaternion(new THREE.Quaternion())); p = p.parent; }
  restW.set(root, new THREE.Quaternion());
  const hipsRestW = hips.getWorldPosition(new THREE.Vector3());
  const k = hipsRestW.y / src.hipsRest.y;
  // only the mapped bones need tracks; bones in `order` that are unmapped (twist helpers etc.) follow their parents
  const chInfo = { order: order.filter((b) => true), keys, restW, hips, hipsParent: hips.parent, hipsRestW, k };
  const mixer = new THREE.AnimationMixer(body), actions = new Map(), clipsOwn = new Map();
  const act = (name) => {
    let a = actions.get(name);
    if (!a) {
      const def = CLIPS[name]; if (!def) throw new Error('no clip ' + name);
      // retarget from a clean rest pose (the live pose is put back afterwards: Butler v2 builds clips while the person is playing another)
      const livePose = order.map((b) => b.quaternion.clone());
      for (const b of order) b.quaternion.copy(b.userData.restQ);
      // the clip is baked in the character's creation frame: lazily built clips must not see wherever the scene has moved the root since
      const sp = root.position.clone(), sr = root.rotation.y; root.position.set(0, 0, 0); root.rotation.y = 0; root.updateMatrixWorld(true);
      const c = retarget(chInfo, src, def[0], { ...def[1], name });
      root.position.copy(sp); root.rotation.y = sr; order.forEach((b, i) => b.quaternion.copy(livePose[i])); root.updateMatrixWorld(true);
      clipsOwn.set(name, c); a = mixer.clipAction(c); a.setLoop(THREE.LoopRepeat, Infinity); actions.set(name, a);
    }
    return a;
  };
  const hipRest = hips.position.clone(); void hipRest;
  let cur = null, curName = '';
  function play(name, opt = {}) {
    if (name === curName && !opt.restart && !opt.once) return;
    const next = act(name), fade = opt.fade == null ? 0.3 : Math.min(0.4, Math.max(0.25, opt.fade));
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.setEffectiveTimeScale(1);
    if (opt.once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; } else { next.setLoop(THREE.LoopRepeat, Infinity); next.clampWhenFinished = false; }
    const dur = next.getClip().duration;
    if (opt.at === 'random') next.time = Math.random() * dur; else if (typeof opt.at === 'number') next.time = Math.min(dur - 1e-3, opt.at);
    next.play();
    if (cur && cur !== next) { if (opt.fade === 0) cur.stop(); else next.crossFadeFrom(cur, fade, false); }
    cur = next; curName = name;
  }
  function still(name, t = 0) { play(name, { fade: 0, at: t, restart: curName !== name }); cur.time = t; cur.paused = true; mixer.update(0); root.updateMatrixWorld(true); }
  function update(dt) { mixer.update(dt); return true; }
  const props = [], ws = new THREE.Vector3();
  // a prop is only parented to a bone; `tf.pos` (metres) and `tf.rot` are in the bone's own frame, scale is made world-metric
  function attachProp(obj, boneKey, tf = {}) {
    const b = bones[boneKey]; if (!b) return null;
    b.add(obj); b.updateWorldMatrix(true, false); b.getWorldScale(ws);
    obj.scale.setScalar(1 / ws.x); obj.position.copy(tf.pos || new THREE.Vector3()).multiplyScalar(1 / ws.x); if (tf.rot) obj.rotation.copy(tf.rot);
    props.push(obj); return obj;
  }
  function dispose() { mixer.stopAllAction(); mixer.uncacheRoot(body); root.removeFromParent(); body.traverse((n) => { if (n.skeleton) n.skeleton.dispose(); }); for (const p of props) p.removeFromParent(); }
  // world position of a bone (for tests / aiming helpers)
  const boneWorld = (key, out = new THREE.Vector3()) => bones[key] ? bones[key].getWorldPosition(out) : out.set(0, 0, 0);
  return { root, body, bones, mixer, play, update, still, lookAt() {}, showBook() {}, hiddenLods, meshes: () => { const m = []; body.traverse((n) => { if (n.isSkinnedMesh && n.visible) m.push(n); }); return m; }, clipDuration: (name) => act(name).getClip().duration, handsMid: (out) => out.set(0, 1, 0), attachProp, boneWorld, dispose, tris, holder: ch.holder, scale: ch.holder.scale.x, hipsRest: hipsRestW, get current() { return curName; } };
}
