"""Build the shared animation clips GLB (animations only, the MPFB 'game_engine' skeleton) for every Epoch person.

  blender -b -P scripts/people/build_clips.py
Writes build/people-work/glb/clips.glb (uncompressed; build_all.sh meshopt-compresses it into epoch/web/static/app/people/)
and build/people-work/records/clips.json (durations, loop flags, sit/lie heights, walk speed).

How: the Quaternius Universal Animation Library 1 + 2 (CC0) clips are retargeted onto the user's MPFB rig by world-space
rotation deltas (each bone's rotation relative to the source T-pose, applied to the target rest pose after a per-bone
swing that lines the target's rest bone directions up with the source's), plus the pelvis position scaled by hip height.
Clips UAL does not have (typing, reading, sipping, piano, waving, ...) are authored here procedurally as layers on top of
the retargeted idle / sit_idle: 2-bone arm IK to target points, hand orientation, finger curls, head/spine turns, all
with smooth envelopes. Every value below is deterministic (no randomness), so a rebuild gives the same file.
"""
import bpy, sys, os, math, json
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import specs
import build_lib as L

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(ROOT, "build", "people-raw")
WORK = os.path.join(ROOT, "build", "people-work")
OUT = os.path.join(WORK, "glb", "clips.glb")
UAL1 = os.path.join(RAW, "ual1", "Animation Library[Standard]", "Godot", "AnimationLibrary_Godot_Standard.glb")
UAL2 = os.path.join(RAW, "ual2", "Universal Animation Library 2 [Standard]", "Unreal-Godot", "UAL2_Standard.glb")
FPS = 24

# ------------------------------------------------------------------ target rig (the user's skeleton)
rig, basemesh = L.build_human(specs.USER, [], WORK)
L.activate(basemesh)
if basemesh.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
L.clean_body(basemesh)
L.ground_and_center(rig, [basemesh])            # barefoot soles at z=0, like the characters (their shoes at 0)
for o in list(rig.children):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.context.scene.render.fps = FPS
TB = rig.data.bones
ORDER = []                                     # parents before children


def _walk(b):
    ORDER.append(b.name)
    for c in b.children:
        _walk(c)


for b in TB:
    if b.parent is None:
        _walk(b)
CHILDREN = {n: [c.name for c in TB[n].children] for n in ORDER}
DESC = {}


def _desc(n):
    if n not in DESC:
        out = []
        for c in CHILDREN[n]:
            out += [c] + _desc(c)
        DESC[n] = out
    return DESC[n]


for n in ORDER:
    _desc(n)
REST_R = {n: TB[n].matrix_local.to_quaternion() for n in ORDER}
REST_H = {n: TB[n].head_local.copy() for n in ORDER}
LOCAL_OFF = {}
for n in ORDER:
    p = TB[n].parent
    LOCAL_OFF[n] = (TB[p.name].matrix_local.inverted() @ TB[n].head_local) if p else None
LEFT = 1.0 if TB["clavicle_l"].head_local.x > 0 else -1.0       # +X is the character's left
FWD = Vector((0, -1, 0))                                         # MPFB characters face -Y (glTF +Z)
UP = Vector((0, 0, 1))

# ------------------------------------------------------------------ sources
FINGERS = ("index", "middle", "ring", "pinky", "thumb")


def map_ual1(name):
    """UAL1 (Rigify DEF-*) -> UE/MPFB names"""
    if not name.startswith("DEF-"):
        return None
    n = name[4:]
    side = ""
    if n.endswith((".L", ".R")):
        side = "_" + n[-1].lower()
        n = n[:-2]
    table = {"hips": "pelvis", "spine.001": "spine_01", "spine.002": "spine_02", "spine.003": "spine_03",
             "neck": "neck_01", "head": "head", "shoulder": "clavicle", "upper_arm": "upperarm", "forearm": "lowerarm",
             "hand": "hand", "thigh": "thigh", "shin": "calf", "foot": "foot", "toe": "ball"}
    if n in table:
        return table[n] + side
    for f in FINGERS:
        for k in ("01", "02", "03"):
            if n in (f"f_{f}.{k}", f"{f}.{k}"):
                return f"{f}_{k}{side}"
    return None


def map_ual2(name):
    if name == "Head":
        return "head"
    return name if name in TB and name != "Root" else None


def import_lib(path, mapper):
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in set(bpy.data.objects) - before_o if o.type == 'ARMATURE')
    for o in set(bpy.data.objects) - before_o:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    acts = {}
    for a in set(bpy.data.actions) - before_a:
        k = a.name.split("|")[-1]
        acts[k[:-4] if k.endswith(".001") else k] = a
    if arm.animation_data:
        for tr in arm.animation_data.nla_tracks:
            tr.mute = True
    m = {}
    for b in arm.data.bones:
        t = mapper(b.name)
        if t:
            m[t] = b.name
    bpy.context.scene.render.fps = FPS
    return {"arm": arm, "acts": acts, "map": m}


LIBS = {"ual1": import_lib(UAL1, map_ual1), "ual2": import_lib(UAL2, map_ual2)}
print("[clips] ual1 actions:", len(LIBS["ual1"]["acts"]), "ual2 actions:", len(LIBS["ual2"]["acts"]))

DIR_CHILD = {"pelvis": "spine_01", "spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "neck_01", "neck_01": "head"}
for s in ("_l", "_r"):
    DIR_CHILD.update({"clavicle" + s: "upperarm" + s, "upperarm" + s: "lowerarm" + s, "lowerarm" + s: "hand" + s,
                      "hand" + s: "middle_01" + s, "thigh" + s: "calf" + s, "calf" + s: "foot" + s, "foot" + s: "ball" + s})
    for f in FINGERS:
        DIR_CHILD[f"{f}_01{s}"] = f"{f}_02{s}"
        DIR_CHILD[f"{f}_02{s}"] = f"{f}_03{s}"


def calibrate(lib):
    """per-bone swing that turns the target rest bone directions into the source rest (T-pose) directions"""
    arm, m = lib["arm"], lib["map"]
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    src_rest_r = {t: (mw @ arm.data.bones[s].matrix_local).to_quaternion() for t, s in m.items()}
    src_head = {t: mw @ arm.data.bones[s].head_local for t, s in m.items()}
    C = {}
    for n in ORDER:
        c = DIR_CHILD.get(n)
        if c and c in m and n in m:
            dt = (REST_H[c] - REST_H[n]).normalized()
            ds = (src_head[c] - src_head[n]).normalized()
            C[n] = dt.rotation_difference(ds)
        else:
            p = TB[n].parent
            C[n] = C.get(p.name, Quaternion()) if p else Quaternion()
    lib["C"], lib["src_rest_r"], lib["src_head"] = C, src_rest_r, src_head
    lib["hip_ratio"] = REST_H["pelvis"].z / src_head["pelvis"].z


for lib in LIBS.values():
    calibrate(lib)


# ------------------------------------------------------------------ pose = (R: world rotations, P: pelvis head position)
def sample(lib, action, frame):
    arm, m = lib["arm"], lib["map"]
    ad = arm.animation_data or arm.animation_data_create()
    if ad.action is not action:
        ad.action = action
        try:
            if action.slots:
                ad.action_slot = action.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(math.floor(frame)), subframe=frame - math.floor(frame))
    mw = arm.matrix_world
    R = {}
    for n in ORDER:
        if n in m:
            w = (mw @ arm.pose.bones[m[n]].matrix).to_quaternion()
            d = w @ lib["src_rest_r"][n].inverted()
            R[n] = d @ lib["C"][n] @ REST_R[n]
        else:
            p = TB[n].parent
            if p is None:
                R[n] = REST_R[n].copy()
            else:      # unmapped child: keep its rest offset to the parent
                R[n] = R[p.name] @ REST_R[p.name].inverted() @ REST_R[n]
    sp = mw @ arm.pose.bones[m["pelvis"]].head
    P = REST_H["pelvis"] + (sp - lib["src_head"]["pelvis"]) * lib["hip_ratio"]
    return {"R": R, "P": P}


def fk(pose):
    """world head positions of every bone"""
    R, pos = pose["R"], {}
    for n in ORDER:
        p = TB[n].parent
        if p is None:
            pos[n] = REST_H[n].copy()
        elif n == "pelvis":
            pos[n] = pose["P"].copy()
        else:
            pos[n] = pos[p.name] + R[p.name] @ LOCAL_OFF[n]
    return pos


def copy_pose(pose):
    return {"R": {k: q.copy() for k, q in pose["R"].items()}, "P": pose["P"].copy()}


def lerp_pose(a, b, w):
    if w <= 0:
        return copy_pose(a)
    if w >= 1:
        return copy_pose(b)
    return {"R": {k: a["R"][k].slerp(b["R"][k], w) for k in a["R"]}, "P": a["P"].lerp(b["P"], w)}


def rot(pose, bone, q, with_desc=True):
    """rotate a bone (and its descendants) by the world rotation q"""
    for n in [bone] + (DESC[bone] if with_desc else []):
        pose["R"][n] = q @ pose["R"][n]


def rot_axis(pose, bone, axis, angle):
    rot(pose, bone, Quaternion(Vector(axis).normalized(), angle))


def bone_dir(pose, n):
    return (pose["R"][n] @ Vector((0, 1, 0))).normalized()


def swing_to(pose, bone, cur, want):
    if cur.length < 1e-6 or want.length < 1e-6:
        return
    rot(pose, bone, cur.normalized().rotation_difference(want.normalized()))


def ik_arm(pose, side, target, pole):
    """2-bone IK: upperarm -> lowerarm so the wrist (hand head) reaches target; elbow bends toward pole"""
    ua, la, ha = "upperarm" + side, "lowerarm" + side, "hand" + side
    pos = fk(pose)
    S, E, W = pos[ua], pos[la], pos[ha]
    a, b = (E - S).length, (W - E).length
    t = Vector(target) - S
    d = max(min(t.length, a + b - 1e-4), abs(a - b) + 1e-4)
    u = t.normalized()
    x = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(a * a - x * x, 0.0))
    p = Vector(pole)
    v = (p - u * p.dot(u))
    v = v.normalized() if v.length > 1e-6 else Vector((0, 0, -1))
    E2 = S + u * x + v * h
    swing_to(pose, ua, E - S, E2 - S)
    pos = fk(pose)
    swing_to(pose, la, pos[ha] - pos[la], (S + u * d) - pos[la])


def palm_normal(pose, side, pos=None):
    pos = pos or fk(pose)
    d = bone_dir(pose, "hand" + side)
    across = (pos["index_01" + side] - pos["pinky_01" + side]).normalized()
    n = d.cross(across) * (1 if side == "_l" else -1)
    return n.normalized(), across


def orient_hand(pose, side, fwd, palm, forearm_share=0.5):
    """point the hand along fwd with its palm facing `palm`; part of the twist goes to the forearm"""
    la, ha = "lowerarm" + side, "hand" + side
    fwd, palm = Vector(fwd).normalized(), Vector(palm).normalized()
    # forearm twist about its own axis
    ax = bone_dir(pose, la)
    n, _ = palm_normal(pose, side)
    a = (n - ax * n.dot(ax))
    b = (palm - ax * palm.dot(ax))
    if a.length > 1e-4 and b.length > 1e-4:
        ang = a.normalized().angle(b.normalized())
        if a.cross(b).dot(ax) < 0:
            ang = -ang
        rot(pose, la, Quaternion(ax, ang * forearm_share))
    # hand: swing to fwd, then twist palm
    swing_to(pose, ha, bone_dir(pose, ha), fwd)
    hd = bone_dir(pose, ha)
    n, _ = palm_normal(pose, side)
    a = (n - hd * n.dot(hd))
    b = (palm - hd * palm.dot(hd))
    if a.length > 1e-4 and b.length > 1e-4:
        ang = a.normalized().angle(b.normalized())
        if a.cross(b).dot(hd) < 0:
            ang = -ang
        rot(pose, ha, Quaternion(hd, ang))


def curl(pose, side, fingers, angles):
    """bend finger joints toward the palm; angles = (base, mid, tip) radians"""
    for f in fingers:
        for k, ang in zip(("01", "02", "03"), angles):
            n = f"{f}_{k}{side}"
            if n not in pose["R"] or abs(ang) < 1e-5:
                continue
            pn, across = palm_normal(pose, side)
            d = bone_dir(pose, n)
            axis = across if f != "thumb" else pn
            q = Quaternion(axis, ang)
            if ((q @ d) - d).dot(pn) < 0:
                q = Quaternion(axis, -ang)
            rot(pose, n, q)


def look(pose, yaw=0.0, pitch=0.0, roll=0.0, spine=0.15):
    """turn the head: yaw (left +), pitch (down +), shared between spine_03, neck and head"""
    shares = (("spine_03", spine), ("neck_01", 0.4 - spine / 2), ("head", 0.6 - spine / 2))
    for n, s in shares:
        if yaw:
            rot_axis(pose, n, UP, yaw * s * LEFT)
        if pitch:
            right = FWD.cross(UP)          # pitch about the character's left-right axis
            rot_axis(pose, n, right, -pitch * s)
        if roll:
            rot_axis(pose, n, FWD, roll * s)


def lean(pose, pitch=0.0, side=0.0):
    """bend the spine forward (+) / back (-)"""
    right = FWD.cross(UP)
    for n, s in (("spine_01", 0.3), ("spine_02", 0.35), ("spine_03", 0.35)):
        if pitch:
            rot_axis(pose, n, right, -pitch * s)
        if side:
            rot_axis(pose, n, FWD, side * s)


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def env(t, t0, t1, t2, t3):
    """0 before t0, ramps up to 1 at t1, holds to t2, ramps down to 0 at t3"""
    if t < t0 or t > t3:
        return 0.0
    if t < t1:
        return smooth((t - t0) / max(t1 - t0, 1e-6))
    if t <= t2:
        return 1.0
    return 1.0 - smooth((t - t2) / max(t3 - t2, 1e-6))


def with_weight(pose, w, fn):
    """apply fn to a copy of pose and blend the result back with weight w"""
    if w <= 1e-4:
        return pose
    p2 = copy_pose(pose)
    fn(p2)
    return lerp_pose(pose, p2, w)


# ------------------------------------------------------------------ base clips
def base(lib, act, loop=True):
    a = LIBS[lib]["acts"][act]
    f0, f1 = a.frame_range
    n = f1 - f0

    def at(t):
        f = t * FPS
        if loop:
            f = f % n
        else:
            f = min(f, n)
        return sample(LIBS[lib], a, f0 + f)
    return at, n / FPS


def detrend(frames):
    """remove horizontal drift of the pelvis over a looping clip (in-place locomotion)"""
    if len(frames) < 2:
        return 0.0
    d = frames[-1]["P"] - frames[0]["P"]
    d.z = 0
    for i, p in enumerate(frames):
        p["P"] -= d * (i / (len(frames) - 1))
    return d.length


# ------------------------------------------------------------------ clip recipes
def shoulder(pos, side):
    return pos["upperarm" + side]


def side_vec(side):
    return Vector((LEFT if side == "_l" else -LEFT, 0, 0))


POLE_DOWN = {s: Vector((0, 0.6, -1)) + side_vec(s) * 0.5 for s in ("_l", "_r")}


def desk_hands(p, t, spread=0.17, fwd=0.40, down=0.27, palm=(0, 0, -1), fingers=None, drift=None):
    pos = fk(p)
    for s in ("_l", "_r"):
        sh = shoulder(pos, s)
        tgt = sh + FWD * fwd + UP * (-down) + side_vec(s) * (spread - abs(sh.x))
        if drift:
            tgt += drift(s, t)
        ik_arm(p, s, tgt, POLE_DOWN[s])
        orient_hand(p, s, FWD + UP * -0.25 - side_vec(s) * 0.15, palm)
        if fingers:
            fingers(p, s, t)


def typing_fingers(p, s, t):
    ph = 0.0 if s == "_l" else 0.37
    for i, f in enumerate(("index", "middle", "ring", "pinky")):
        k = 0.5 + 0.5 * math.sin(2 * math.pi * (t * 2.6 + ph + i * 0.29))
        tap = max(0.0, math.sin(2 * math.pi * (t * 1.7 + ph * 2 + i * 0.41))) ** 3
        curl(p, s, (f,), (0.12 + 0.08 * k + 0.22 * tap, 0.22 + 0.06 * k, 0.12))
    curl(p, s, ("thumb",), (0.15, 0.1, 0.0))


def recipe_sit_type(t, sit):
    p = sit(t)
    look(p, pitch=0.30 + 0.03 * math.sin(t * 1.3), yaw=0.04 * math.sin(t * 0.7))
    lean(p, pitch=0.14)                          # leans in to the keys (hands ~0.6 m ahead of the pelvis: a desk with the laptop mid-surface)

    def drift(s, tt):
        return Vector((0.015 * math.sin(tt * 2.1 + (0 if s == "_l" else 1.7)), 0.01 * math.sin(tt * 1.3), 0.004 * math.sin(tt * 9)))
    desk_hands(p, t, fwd=0.50, down=0.26, fingers=typing_fingers, drift=drift)
    return p


def recipe_play_piano(t, sit):
    p = sit(t)
    look(p, pitch=0.18, yaw=0.08 * math.sin(t * 2 * math.pi / 4))
    lean(p, pitch=0.06 + 0.03 * math.sin(t * 2 * math.pi / 2))

    def drift(s, tt):
        return Vector((0.10 * math.sin(2 * math.pi * tt / 4 + (0 if s == "_l" else 0.6)), 0, 0.006 * math.sin(tt * 12)))

    def fingers(pp, s, tt):
        for i, f in enumerate(("index", "middle", "ring", "pinky", "thumb")):
            k = max(0.0, math.sin(2 * math.pi * (tt * 3.0 + i * 0.21 + (0 if s == "_l" else 0.5)))) ** 2
            curl(pp, s, (f,), (0.30 + 0.35 * k, 0.40, 0.25) if f != "thumb" else (0.1 + 0.2 * k, 0.1, 0))
    desk_hands(p, t, spread=0.22, fwd=0.44, down=0.25, fingers=fingers, drift=drift)
    return p


def recipe_sit_read(t, sit, dur):
    p = sit(t)
    look(p, pitch=0.42, yaw=0.03 * math.sin(t * 0.9))
    lean(p, pitch=0.05)
    turn = env(t, 3.2, 3.8, 4.0, 4.7)          # page turn: the right hand sweeps over to the left
    pos = fk(p)
    for s in ("_l", "_r"):
        sh = shoulder(pos, s)
        tgt = sh + FWD * 0.30 + UP * -0.22 + side_vec(s) * (0.12 - abs(sh.x))
        palm = UP * 0.8 - side_vec(s) * 0.6
        if s == "_r" and turn > 0:
            tgt = tgt.lerp(sh + FWD * 0.33 + UP * -0.19 + side_vec("_l") * 0.02 + side_vec(s) * (-abs(sh.x)), turn)
            tgt += UP * 0.04 * math.sin(math.pi * turn)
            palm = palm.lerp(Vector((0, 0, -1)), turn)
        ik_arm(p, s, tgt, POLE_DOWN[s])
        orient_hand(p, s, FWD + UP * 0.1 - side_vec(s) * 0.3, palm)
        curl(p, s, ("index", "middle", "ring", "pinky"), (0.35, 0.4, 0.2))
    return p


def recipe_sit_sip(t, sit, dur):
    p = sit(t)
    w = env(t, 1.2, 2.2, 3.1, 4.1)
    look(p, pitch=0.15 - 0.30 * env(t, 1.8, 2.4, 2.9, 3.5))
    pos = fk(p)
    s = "_r"
    sh = shoulder(pos, s)
    rest = sh + FWD * 0.36 + UP * -0.33 + side_vec(s) * (0.20 - abs(sh.x))
    mouth = pos["head"] + FWD * 0.15 + UP * -0.06 + side_vec(s) * 0.03
    ik_arm(p, s, rest.lerp(mouth, w), POLE_DOWN[s] + side_vec(s) * 0.8)
    orient_hand(p, s, FWD.lerp(UP, 0.2 + 0.4 * w) - side_vec(s) * 0.3, -side_vec(s) + UP * 0.2 * w)
    curl(p, s, ("index", "middle", "ring", "pinky"), (0.9, 0.8, 0.5))
    curl(p, s, ("thumb",), (0.3, 0.2, 0))
    # the other hand rests on the desk
    sl = "_l"
    shl = shoulder(pos, sl)
    ik_arm(p, sl, shl + FWD * 0.34 + UP * -0.34 + side_vec(sl) * (0.18 - abs(shl.x)), POLE_DOWN[sl])
    orient_hand(p, sl, FWD + UP * -0.2 - side_vec(sl) * 0.25, (0, 0, -1))
    curl(p, sl, ("index", "middle", "ring", "pinky"), (0.3, 0.35, 0.2))
    return p


def recipe_idle_look(t, idle, dur):
    p = idle(t)
    yaw = 0.62 * env(t, 0.4, 1.3, 2.1, 2.9) - 0.52 * env(t, 2.6, 3.5, 4.3, 5.2)
    look(p, yaw=yaw, pitch=-0.06 * env(t, 0.4, 1.3, 4.3, 5.2), spine=0.2)
    return p


def recipe_stand_stretch(t, idle, dur):
    p = idle(t)
    w = env(t, 0.3, 1.3, 2.4, 3.5)

    def up(pp):
        pos = fk(pp)
        lean(pp, pitch=-0.18)
        look(pp, pitch=-0.25)
        pos = fk(pp)
        for s in ("_l", "_r"):
            sh = shoulder(pos, s)
            ik_arm(pp, s, sh + UP * 0.75 + side_vec(s) * 0.10 + FWD * 0.03, side_vec(s) + FWD * -0.3)
            orient_hand(pp, s, UP, FWD + side_vec(s) * 0.2)
            curl(pp, s, ("index", "middle", "ring", "pinky"), (0.05, 0.05, 0.0))
    return with_weight(p, w, up)


def recipe_yawn(t, idle, dur):
    p = idle(t)
    w = env(t, 0.3, 1.0, 2.0, 2.9)

    def yawn(pp):
        look(pp, pitch=-0.35, roll=0.08)
        pos = fk(pp)
        s = "_r"
        mouth = pos["head"] + FWD * 0.13 + UP * -0.05
        ik_arm(pp, s, mouth, POLE_DOWN[s] + side_vec(s))
        orient_hand(pp, s, UP * 0.6 - side_vec(s), FWD * -1)
        curl(pp, s, ("index", "middle", "ring", "pinky"), (0.25, 0.25, 0.15))
        sl = "_l"
        shl = pos["upperarm" + sl]
        ik_arm(pp, sl, shl + side_vec(sl) * 0.40 + UP * 0.25 + FWD * 0.05, Vector((0, 0.4, -1)))
        orient_hand(pp, sl, side_vec(sl) + UP * 0.5, FWD)
        rot_axis(pp, "clavicle_l", FWD, -0.12 * LEFT)
        rot_axis(pp, "clavicle_r", FWD, 0.12 * LEFT)
    return with_weight(p, w, yawn)


def recipe_wave(t, idle, dur):
    p = idle(t)
    w = env(t, 0.0, 0.45, dur - 0.55, dur)

    def wave(pp):
        pos = fk(pp)
        s = "_r"
        sh = shoulder(pos, s)
        osc = math.sin(2 * math.pi * 1.6 * (t - 0.45))
        tgt = sh + side_vec(s) * (0.30 + 0.07 * osc) + UP * 0.32 + FWD * 0.12
        ik_arm(pp, s, tgt, side_vec(s) + UP * -1.2 + FWD * -0.2)
        orient_hand(pp, s, UP + side_vec(s) * (0.25 * osc), FWD, forearm_share=0.7)
        curl(pp, s, ("index", "middle", "ring", "pinky"), (0.05, 0.05, 0.0))
        look(pp, yaw=-0.05, pitch=-0.05)
    return with_weight(p, w, wave)


def recipe_point(t, idle, dur):
    p = idle(t)
    w = env(t, 0.0, 0.5, dur - 0.7, dur)

    def point(pp):
        look(pp, yaw=-0.12, pitch=-0.05)
        pos = fk(pp)
        s = "_r"
        sh = shoulder(pos, s)
        ik_arm(pp, s, sh + FWD * 0.70 + side_vec(s) * 0.12 + UP * 0.08, Vector((0, 0.3, -1)) + side_vec(s))
        orient_hand(pp, s, FWD + side_vec(s) * 0.12 + UP * 0.1, (0, 0, -1))
        curl(pp, s, ("middle", "ring", "pinky"), (1.3, 1.2, 0.7))
        curl(pp, s, ("index",), (0.0, 0.05, 0.0))
        curl(pp, s, ("thumb",), (0.5, 0.4, 0.0))
    return with_weight(p, w, point)


def recipe_cheer(t, idle, dur):
    p = idle(t)
    w = env(t, 0.0, 0.35, dur - 0.5, dur)

    def cheer(pp):
        look(pp, pitch=-0.18)
        lean(pp, pitch=-0.05)
        pos = fk(pp)
        pump = 0.06 * math.sin(2 * math.pi * 2.0 * t)
        for s in ("_l", "_r"):
            sh = shoulder(pos, s)
            ik_arm(pp, s, sh + UP * (0.62 + pump) + side_vec(s) * 0.30 + FWD * 0.06, side_vec(s) + Vector((0, 0.4, -1)))
            orient_hand(pp, s, UP + side_vec(s) * 0.3, FWD)
            curl(pp, s, ("index", "middle", "ring", "pinky"), (1.3, 1.3, 0.9))
            curl(pp, s, ("thumb",), (0.5, 0.5, 0.2))
    return with_weight(p, w, cheer)


def rest_pose():
    return {"R": {n: q.copy() for n, q in REST_R.items()}, "P": REST_H["pelvis"].copy()}


def recipe_sleep(t, _unused, dur):
    """lying on the back on a bed whose surface is at the character's feet level (y=0); head toward -Z (glTF)"""
    p = rest_pose()
    pos = fk(p)
    for s in ("_l", "_r"):
        sh = shoulder(pos, s)
        ik_arm(p, s, sh + UP * -0.48 + side_vec(s) * 0.12 + FWD * -0.02, Vector((0, 1, 0)) + side_vec(s))
        orient_hand(p, s, -UP + side_vec(s) * 0.1, -side_vec(s))
        curl(p, s, ("index", "middle", "ring", "pinky"), (0.3, 0.4, 0.3))
        curl(p, s, ("thumb",), (0.2, 0.1, 0.0))
    breath = math.sin(2 * math.pi * t / dur)
    right = FWD.cross(UP)
    rot_axis(p, "spine_02", right, 0.012 * breath)
    rot_axis(p, "spine_03", right, 0.008 * breath)
    look(p, yaw=0.30, pitch=0.12, spine=0.0)
    for s, a in (("_l", 0.14), ("_r", 0.03)):
        rot_axis(p, "thigh" + s, right, a)          # knees a touch bent, one more than the other
        rot_axis(p, "calf" + s, right, -a * 1.7)
    # lie down: rotate the whole body so its head->feet line is horizontal, face up
    rot(p, "pelvis", Quaternion(Vector((1, 0, 0)), -math.pi / 2))
    pos = fk(p)
    feet = (pos["foot_l"] + pos["foot_r"]) / 2
    axis = pos["head"] - feet
    tilt = math.atan2(axis.z, axis.y)
    rot(p, "pelvis", Quaternion(Vector((1, 0, 0)), -tilt))
    pos = fk(p)
    # rest the back of the pelvis / head / heels on the surface (body thickness behind each joint)
    low = min(pos["pelvis"].z - 0.11, pos["spine_03"].z - 0.10, pos["head"].z - 0.09,
              pos["foot_l"].z - 0.05, pos["foot_r"].z - 0.05)
    p["P"] = p["P"] + Vector((0, 0, -low))
    return p


# ------------------------------------------------------------------ build all clips
def narrow_stance(pose, ang=0.105):
    """The retargeted UAL idle stands with the feet ~0.39 m apart (hips 0.21 m): a wide cowboy stance on the MakeHuman rig. Adduct both
    legs about the forward axis so the feet land about shoulder... hip width apart (~0.24 m), and keep each foot flat on the floor."""
    for sd in ("_l", "_r"):
        x0 = abs(fk(pose)["foot" + sd].x)
        rot_axis(pose, "thigh" + sd, FWD, ang)
        if abs(fk(pose)["foot" + sd].x) > x0:                      # wrong way round: undo and go the other way
            rot_axis(pose, "thigh" + sd, FWD, -2 * ang)
            used = -ang
        else:
            used = ang
        rot_axis(pose, "foot" + sd, FWD, -used)                    # sole back to level
    return pose


_idle_raw, idle_len = base("ual1", "Idle_Loop")


def idle_at(t):
    return narrow_stance(_idle_raw(t))



sit_at, sit_len = base("ual1", "Sitting_Idle_Loop")


def frames_for(dur):
    return int(round(dur * FPS)) + 1


CLIPS = {}      # name -> (list of poses, loop, notes)


def add(name, poses, loop, **extra):
    CLIPS[name] = (poses, loop, extra)
    print(f"[clips] {name}: {len(poses)} frames, {(len(poses) - 1) / FPS:.2f}s, loop={loop}")


def straight(lib, act, loop=True, name=None, repeat=1):
    at, d = base(lib, act, loop)
    n = frames_for(d * repeat)
    return [at(i / FPS) for i in range(n)], d * repeat


poses, d = straight("ual1", "Idle_Loop")
for _p in poses:
    narrow_stance(_p)
add("idle", poses, True)
poses, d = straight("ual1", "Walk_Loop")
drift = detrend(poses)
# walking speed from the planted foot: average backward speed of the lower foot
foot_v = []
for i in range(1, len(poses)):
    a, b = fk(poses[i - 1]), fk(poses[i])
    s = "_l" if a["foot_l"].z < a["foot_r"].z else "_r"
    foot_v.append((b["foot" + s].y - a["foot" + s].y) * FPS)
speed = abs(sum(foot_v) / len(foot_v))
add("walk", poses, True, speed_mps=round(max(speed, drift / max(d, 1e-6)), 3))
poses, d = straight("ual1", "Sitting_Idle_Loop", repeat=2)
sit_pelvis = sum(p["P"].z for p in poses) / len(poses)
add("sit_idle", poses, True, pelvis_height_m=round(sit_pelvis, 3))
poses, d = straight("ual1", "Dance_Loop", repeat=3)
detrend(poses)
add("dance", poses, True)
poses, d = straight("ual2", "Chest_Open", loop=False)
add("kneel", poses, False)
poses, d = straight("ual2", "Farm_Watering")
detrend(poses)
add("water", poses, True)


def authored(name, dur, loop, fn, base_at):
    n = frames_for(dur)
    out = []
    for i in range(n):
        t = i / FPS
        out.append(fn(t, base_at, dur))
    add(name, out, loop)


sit_loop = sit_len * 2                                   # sit-based loops are whole numbers of sit_idle cycles
authored("sit_type", sit_loop * 2, True, lambda t, b, d: recipe_sit_type(t, b), sit_at)
authored("sit_read", sit_len * 4, True, recipe_sit_read, sit_at)
authored("sit_sip", sit_len * 3, True, recipe_sit_sip, sit_at)
authored("play_piano", sit_len * 2, True, lambda t, b, d: recipe_play_piano(t, b), sit_at)
authored("idle_look", idle_len * 2, True, recipe_idle_look, idle_at)
authored("stand_stretch", 3.8, False, recipe_stand_stretch, idle_at)
authored("yawn", 3.2, False, recipe_yawn, idle_at)
authored("wave", 2.6, False, recipe_wave, idle_at)
authored("point", 2.6, False, recipe_point, idle_at)
authored("cheer", 2.4, False, recipe_cheer, idle_at)
idle0 = idle_at(0.0)
authored("sleep", 4.0, True, recipe_sleep, None)
lie = fk(CLIPS["sleep"][0][0])

# ------------------------------------------------------------------ bake into actions on the target rig
for lib in LIBS.values():
    arm = lib["arm"]
    for a in list(lib["acts"].values()):
        bpy.data.actions.remove(a)
    bpy.data.objects.remove(arm, do_unlink=True)
for a in list(bpy.data.actions):
    if a.users == 0:
        bpy.data.actions.remove(a)


def to_local(pose):
    R = pose["R"]
    out = {}
    for n in ORDER:
        p = TB[n].parent
        if p is None:
            q = REST_R[n].inverted() @ R[n]
        else:
            q = REST_R[n].inverted() @ REST_R[p.name] @ R[p.name].inverted() @ R[n]
        out[n] = q.normalized()
    loc = TB["pelvis"].matrix_local.inverted() @ pose["P"]
    return out, loc


rig.animation_data_create()
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
for name, (poses, loop, extra) in CLIPS.items():
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    prev = {}
    for i, pose in enumerate(poses):
        loc_q, loc = to_local(pose)
        for n, q in loc_q.items():
            if n in prev and prev[n].dot(q) < 0:
                q = -q
            prev[n] = q
            pb = rig.pose.bones[n]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=i)
            if n == "pelvis":
                pb.location = loc
                pb.keyframe_insert("location", frame=i)
    for fc in getattr(act, "fcurves", []) or []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    st = track.strips.new(name, 0, act)
    rig.animation_data.action = None
rig.animation_data.action = None
if os.environ.get("CLIPS_DEBUG"):
    for name in os.environ["CLIPS_DEBUG"].split(","):
        rig.animation_data.action = bpy.data.actions[name]
        try:
            rig.animation_data.action_slot = bpy.data.actions[name].slots[0]
        except Exception:
            pass
        bpy.context.scene.frame_set(int(len(CLIPS[name][0]) * 0.4))
        bpy.context.view_layer.update()
        pos = fk(CLIPS[name][0][int(len(CLIPS[name][0]) * 0.4)])
        for n in ("pelvis", "head", "hand_r", "hand_l", "foot_l", "lowerarm_r"):
            print(f"[dbg] {name} {n:10s} blender {tuple(round(x, 3) for x in rig.pose.bones[n].head)} fk {tuple(round(x, 3) for x in pos[n])}")
    rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.matrix_basis.identity()

for o in list(bpy.context.scene.objects):
    if o is not None and o != rig:
        o.select_set(False)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_skins=True,
                          export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                          export_frame_step=1, export_optimize_animation_size=True,
                          export_optimize_animation_keep_anim_armature=True, export_anim_single_armature=True,
                          export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
                          export_reset_pose_bones=True, export_anim_slide_to_zero=True, export_extras=False,
                          export_cameras=False, export_lights=False)

hip = REST_H["pelvis"].z
rec = {"skeleton_ref": "user", "fps": FPS, "hip_height_m": round(hip, 4), "bones": ORDER,
       "clips": {n: dict({"duration": round((len(p) - 1) / FPS, 4), "loop": lp}, **ex) for n, (p, lp, ex) in CLIPS.items()},
       "sleep": {"pelvis_height_m": round(lie["pelvis"].z, 3), "head_toward_gltf": "-z",
                 "head_from_pelvis_m": round(lie["head"].y - lie["pelvis"].y, 3)}}
with open(os.path.join(WORK, "records", "clips.json"), "w") as f:
    json.dump(rec, f, indent=1)
print("[clips] wrote", OUT, os.path.getsize(OUT), "bytes")
