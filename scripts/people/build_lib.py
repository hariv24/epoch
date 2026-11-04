"""Epoch people: Blender-side helpers to build one MakeHuman (MPFB2) character, clean it for glTF and export LODs.

Run only inside Blender (see build_character.py). Deterministic: the same specs give the same files.
"""
import bpy, bmesh, os, sys, math, json, re, glob, colorsys
import numpy as np
from mathutils import Vector, Matrix

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

DATA = LocationService.get_user_data()          # MPFB user data (assets copied there by fetch_assets.sh)
SKELETON_RIG = "game_engine"                    # Unreal-style bone names; the Quaternius UAL clips use the same names


# ---------------------------------------------------------------- small utils
def hex2srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def tris_of(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    for c in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for d in list(c):
            c.remove(d)


def activate(obj, select_only=True):
    if select_only:
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def asset_mhclo(subdir, name):
    d = os.path.join(DATA, subdir, name)
    files = sorted(glob.glob(os.path.join(d, "*.mhclo")))
    if not files:
        raise FileNotFoundError(f"no mhclo in {d}")
    return f"{name}/{os.path.basename(files[0])}"


def mhmat_textures(path):
    out = {}
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            p = line.strip().split(None, 1)
            if len(p) == 2 and p[0] in ("diffuseTexture", "normalmapTexture"):
                out[p[0]] = os.path.join(os.path.dirname(path), p[1].strip())
    return out


# ---------------------------------------------------------------- images
def img_to_np(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def np_resize(a, size):
    """box-filter downscale (or plain nearest upscale) so the longest side == size"""
    h, w = a.shape[:2]
    s = size / max(h, w)
    if abs(s - 1) < 1e-6:
        return a
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    if s < 1 and (h % nh == 0) and (w % nw == 0):
        return a.reshape(nh, h // nh, nw, w // nw, 4).mean(axis=(1, 3))
    ys = (np.arange(nh) + 0.5) / s - 0.5
    xs = (np.arange(nw) + 0.5) / s - 0.5
    ys = np.clip(np.round(ys).astype(int), 0, h - 1)
    xs = np.clip(np.round(xs).astype(int), 0, w - 1)
    if s < 1:   # average a k x k neighbourhood first to avoid aliasing
        k = max(1, int(round(1 / s)))
        from numpy.lib.stride_tricks import sliding_window_view
        pad = np.pad(a, ((0, k), (0, k), (0, 0)), mode='edge')
        c = np.cumsum(np.cumsum(pad, 0), 1)
        c = np.pad(c, ((1, 0), (1, 0), (0, 0)))
        box = (c[k:k + h, k:k + w] - c[0:h, k:k + w] - c[k:k + h, 0:w] + c[0:h, 0:w]) / (k * k)
        return box[ys][:, xs]
    return a[ys][:, xs]


def np_to_image(a, name, outdir, alpha):
    h, w = a.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    img.pixels.foreach_set(np.ascontiguousarray(a, dtype=np.float32).ravel())
    os.makedirs(outdir, exist_ok=True)
    img.filepath_raw = os.path.join(outdir, name + ".png")
    img.file_format = 'PNG'
    img.save()
    return img


def tint_texture(a, target_hex, contrast=1.0):
    """recolour: keep the cloth/skin detail (luminance ratio to the mean) and move the mean colour to target"""
    rgb_lin = srgb2lin(a[..., :3])
    lum = rgb_lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mask = a[..., 3] > 0.5
    m = lum[mask].mean() if mask.any() else lum.mean()
    detail = np.power(np.clip(lum / max(m, 1e-4), 0.05, 4), contrast)   # floor: flattened (low-contrast) tints never go black
    # transparent texels (often black RGB) take the typical cloth tone, never the plain target colour: UV edges that sample the
    # texture background otherwise show as bright patches (the jeans waistband)
    typical = float(np.median(detail[mask])) if mask.any() else 1.0
    detail = np.where(mask, detail, typical)
    out = srgb2lin(hex2srgb(target_hex))[None, None, :] * detail[..., None]
    res = a.copy()
    res[..., :3] = lin2srgb(out)
    return res


def paint_rects(a, rects):
    """flat-fill rectangles of a texture (to remove logos, printed text, label patches). rect = (x0, y0, x1, y1, fill) in 0..1,
    measured from the TOP-left of the image as viewed; fill = '#rrggbb' or 'cloth' (the image's median colour)"""
    h, w = a.shape[:2]
    res = a.copy()
    for x0, y0, x1, y1, fill in rects:
        r0, r1 = int((1 - y1) * h), int((1 - y0) * h)        # Blender pixel rows run bottom to top
        c0, c1 = int(x0 * w), int(x1 * w)
        if fill == 'cloth':
            col = np.median(res[..., :3][res[..., 3] > 0.5].reshape(-1, 3), axis=0)
        else:
            col = hex2srgb(fill)
        res[r0:r1, c0:c1, :3] = col
        res[r0:r1, c0:c1, 3] = 1.0
    return res


def recolor_iris(a, target_hex, sat_min=0.30):
    """eyes: the stock 'brown' iris is a saturated red-brown that reads red under warm light. Recolour the saturated pixels (the iris,
    not the sclera) to a natural dark brown, keeping the iris detail and the black pupil."""
    rgb = a[..., :3]
    mx, mn = rgb.max(axis=-1), rgb.min(axis=-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    iris = (sat > sat_min) & (mx < 0.8) & (a[..., 3] > 0.5)
    if not iris.any():
        return a
    lin = srgb2lin(rgb)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    detail = np.clip(lum / max(float(lum[iris].mean()), 1e-4), 0.0, 3.0)
    out = srgb2lin(hex2srgb(target_hex))[None, None, :] * detail[..., None]
    res = a.copy()
    res[..., :3] = np.where(iris[..., None], lin2srgb(out), rgb)
    return res


def shift_mean(a, target_hex, strength=1.0):
    """skin: multiply each channel (linear) so the mean albedo matches target, keeping all detail and its hue variation"""
    rgb_lin = srgb2lin(a[..., :3])
    mask = a[..., 3] > 0.5
    mean = rgb_lin[mask].mean(axis=0) if mask.any() else rgb_lin.reshape(-1, 3).mean(axis=0)
    gain = srgb2lin(hex2srgb(target_hex)) / np.maximum(mean, 1e-4)
    gain = 1 + (gain - 1) * strength
    res = a.copy()
    res[..., :3] = lin2srgb(rgb_lin * gain[None, None, :])
    return res


def mean_srgb(a):
    mask = a[..., 3] > 0.5
    rgb = srgb2lin(a[..., :3])[mask] if mask.any() else srgb2lin(a[..., :3]).reshape(-1, 3)
    return lin2srgb(rgb.mean(axis=0))


# ---------------------------------------------------------------- materials
def make_material(name, base_img=None, normal_img=None, color=(0.8, 0.8, 0.8), rough=0.85, alpha="OPAQUE", cutoff=0.4,
                  metallic=0.0, spec=0.5):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    if base_img is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base_img
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha == "MASK":
            m = nt.nodes.new("ShaderNodeMath")
            m.operation = 'GREATER_THAN'
            m.inputs[1].default_value = cutoff
            nt.links.new(t.outputs["Alpha"], m.inputs[0])
            nt.links.new(m.outputs[0], bsdf.inputs["Alpha"])
        elif alpha == "BLEND":
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    else:
        bsdf.inputs["Base Color"].default_value = (*srgb2lin(color), 1.0)
    if normal_img is not None:
        normal_img.colorspace_settings.name = 'Non-Color'
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = normal_img
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if alpha == "BLEND":
        mat.surface_render_method = 'BLENDED'
    mat.use_backface_culling = alpha == "OPAQUE"
    return mat


def material_images(obj):
    """(diffuse_path, normal_path) used by an MPFB GAMEENGINE material"""
    d = n = None
    if not obj.material_slots or obj.material_slots[0].material is None:
        return None, None
    for node in obj.material_slots[0].material.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image is not None:
            p = bpy.path.abspath(node.image.filepath)
            if node.name.startswith("Normal"):
                n = p
            elif node.name.startswith("Diffuse"):
                d = p
    return d, n


# ---------------------------------------------------------------- build
def build_human(spec, clothes, workdir):
    """Create the MPFB human with rig, body parts and clothes. Returns (rig, parts) where parts maps object -> role info."""
    reset_scene()
    info = HumanService._create_default_human_info_dict()
    ph = dict(info["phenotype"])
    for k, v in spec["phenotype"].items():
        ph[k] = v
    info["phenotype"] = ph
    info["rig"] = SKELETON_RIG
    if spec.get("targets"):
        info["targets"] = list(info.get("targets") or []) + list(spec["targets"])
    info["eyes"] = "low-poly/low-poly.mhclo"
    info["eyebrows"] = asset_mhclo("eyebrows", spec.get("eyebrows", "eyebrow001"))
    info["eyelashes"] = asset_mhclo("eyelashes", spec.get("eyelashes", "eyelashes01"))
    info["hair"] = asset_mhclo("hair", spec["hair"][0])
    info["skin_mhmat"] = ""
    info["skin_material_type"] = "NONE"
    info["clothes_material_type"] = "GAMEENGINE"
    info["eyes_material_type"] = "GAMEENGINE"
    info["clothes"] = [asset_mhclo("clothes", c[0]) for c in clothes]
    info["name"] = spec["id"]
    s = HumanService.get_default_deserialization_settings()
    s["subdiv_levels"] = 0
    basemesh = HumanService.deserialize_from_dict(info, s)
    rig = basemesh.parent
    assert rig is not None and rig.type == 'ARMATURE', "MPFB did not create a rig"
    return rig, basemesh


def classify(obj, spec, clothes):
    """role of a child mesh of the MPFB character"""
    n = obj.name.split(".", 1)[1] if "." in obj.name else obj.name
    if obj.name.endswith(".body"):
        return "body", {}
    if n.startswith("low-poly") or n.startswith("high-poly"):
        return "eyes", {}
    if n.startswith("eyebrow") or n.startswith("mindfront_eyebrows"):
        return "eyebrows", {}
    if n.startswith("eyelashes") or n.startswith("mindfront_eyelashes"):
        return "eyelashes", {}
    if n == spec["hair"][0] or n.startswith(spec["hair"][0]):
        return "hair", spec["hair"][1]
    for name, opts in clothes:
        if n == name or n.startswith(name):
            return "clothes", dict(opts, asset=name)
    return "other", {}


def clean_body(basemesh):
    """bake shape keys (the phenotype), apply the helper / delete-group masks, drop non-bone vertex groups"""
    activate(basemesh)
    if basemesh.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for m in list(basemesh.modifiers):
        if m.type == 'MASK':
            bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
            bpy.ops.object.modifier_apply(modifier=m.name)
        elif m.type in ('SUBSURF',):
            basemesh.modifiers.remove(m)


def strip_vgroups(obj, bone_names):
    for g in list(obj.vertex_groups):
        if g.name not in bone_names:
            obj.vertex_groups.remove(g)


def split_sleeves(obj, arm_bones, rig=None):
    """assign a second material slot to the sleeves: faces skinned mostly to arm bones AND outside the shoulder joints"""
    me = obj.data
    while len(me.materials) < 2:            # a second slot must exist, or later modifier applies clamp the index to 0
        me.materials.append(me.materials[0] if len(me.materials) else None)
    gidx = {g.index for g in obj.vertex_groups if g.name in arm_bones}
    arm_w = np.zeros(len(me.vertices), dtype=np.float32)
    tot_w = np.zeros(len(me.vertices), dtype=np.float32)
    for v in me.vertices:
        for g in v.groups:
            tot_w[v.index] += g.weight
            if g.group in gidx:
                arm_w[v.index] += g.weight
    frac = arm_w / np.maximum(tot_w, 1e-6)
    xs = abs(rig.data.bones["upperarm_l"].head_local.x) if rig is not None else 0.0
    co = np.array([v.co[:] for v in me.vertices], dtype=np.float32)
    for p in me.polygons:
        vi = list(p.vertices)
        p.material_index = 1 if (frac[vi].min() > 0.7 and np.abs(co[vi, 0]).mean() > xs + 0.02) else 0
    print(f"[build] sleeves: {sum(1 for p in me.polygons if p.material_index == 1)} of {len(me.polygons)} faces")


def hide_covered_body(basemesh, cloth_objs, max_dist=0.15):
    """delete body faces that are fully under clothing (stops skin poking through when posed, saves triangles).
    A vertex is covered when a ray along its normal hits a clothing mesh within max_dist. Head and hand vertices stay."""
    from mathutils.bvhtree import BVHTree
    if not cloth_objs:
        return 0
    dg = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, dg) for o in cloth_objs]
    me = basemesh.data
    keep_groups = {g.index for g in basemesh.vertex_groups
                   if g.name == "head" or g.name.startswith(("hand", "index", "middle", "ring", "pinky", "thumb", "neck"))}
    arm_groups = {g.index for g in basemesh.vertex_groups if g.name.startswith(("upperarm", "lowerarm"))}
    covered = np.zeros(len(me.vertices), dtype=bool)
    for v in me.vertices:
        if sum(g.weight for g in v.groups if g.group in keep_groups) > 0.3:
            continue
        # arms: only tight cover counts (a ray from a bare inner arm must not "see" the shirt on the torso)
        dist = min(max_dist, 0.04) if sum(g.weight for g in v.groups if g.group in arm_groups) > 0.5 else max_dist
        co, n = v.co, v.normal
        for t in trees:
            hit = t.ray_cast(co + n * 0.001, n, dist)
            if hit[0] is None:
                # cloth that sits just INSIDE the skin (muscular arms, shoulders after the V-shape targets) is missed by the outward
                # ray, and the skin then pokes through it: look back in from just outside as well
                hit = t.ray_cast(co + n * 0.02, -n, 0.03)
            if hit[0] is not None:
                covered[v.index] = True
                break
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dead = [f for f in bm.faces if all(covered[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    return len(dead)


def relax_cloth_chest(obj, iters=8):
    """The tee shrink-wraps the body: the pecs read as two bumps and the sternum leaves a dimple at the front of the collar. Smooth the
    FRONT of the chest (never the back, the collar rim or the sleeves), and the dimple under the collar."""
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    torso = [v for v in bm.verts if abs(v.co.x) < 0.2 and 1.0 < v.co.z < 1.5]
    ymid = sum(v.co.y for v in torso) / max(1, len(torso))
    sign = -1.0 if min(v.co.y for v in torso) < ymid - 0.05 and (ymid - min(v.co.y for v in torso)) > (max(v.co.y for v in torso) - ymid) else 1.0
    front = lambda v: (v.co.y - ymid) * sign > 0.0
    chest = [v for v in torso if front(v) and 1.08 < v.co.z < 1.40]
    dimple = [v for v in torso if front(v) and abs(v.co.x) < 0.07 and 1.38 <= v.co.z < 1.47]
    for _ in range(iters):
        bmesh.ops.smooth_vert(bm, verts=chest, factor=0.5, use_axis_x=False, use_axis_y=True, use_axis_z=False)
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=dimple, factor=0.35, use_axis_x=False, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()


def loosen_cloth(obj, chest=1.05, waist_keep=0.0):
    """regular fit: the tee hangs straight from the chest instead of following the waist. Scale the torso out from the body axis, and
    never let any row below the chest be narrower than waist_keep x the chest width."""
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    torso = [v for v in bm.verts if abs(v.co.x) < 0.2 and 1.0 < v.co.z < 1.40]
    ymid = sum(v.co.y for v in torso) / len(torso)
    rows = {}
    for v in torso:
        k = round(v.co.z / 0.03); rows[k] = max(rows.get(k, 0), abs(v.co.x))
    wchest = max(w for k, w in rows.items() if k * 0.03 > 1.22)
    for v in torso:
        w = rows[round(v.co.z / 0.03)]
        sx = max(chest, waist_keep * wchest / max(w, 1e-4)) if v.co.z < 1.30 else chest
        fade = min(1.0, (1.40 - v.co.z) / 0.06)                          # keep the collar and shoulders where they are
        sx = 1 + (sx - 1) * fade
        v.co.x *= sx
        v.co.y = ymid + (v.co.y - ymid) * (1 + (chest - 1) * 0.8 * fade)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()


def hide_sleeve_arm(basemesh, cloth, margin=0.012):
    """short sleeves: delete the arm skin that lies inside the sleeve (upper-arm vertices closer to the shoulder than the sleeve hem).
    The ray test misses it when the cloth sits just inside the muscular arm, and a quad of skin then shows through the sleeve."""
    bmc = bmesh.new(); bmc.from_mesh(cloth.data)
    hem = [v.co.x for e in bmc.edges if e.is_boundary for v in e.verts if abs(v.co.x) > 0.2]
    bmc.free()
    if not hem:
        return 0
    limit = min(abs(x) for x in hem) - margin
    arm_groups = {g.index for g in basemesh.vertex_groups if g.name.startswith("upperarm")}
    me = basemesh.data
    covered = {v.index for v in me.vertices if abs(v.co.x) < limit and v.co.z > 1.0 and sum(g.weight for g in v.groups if g.group in arm_groups) > 0.4}
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    dead = [f for f in bm.faces if all(v.index in covered for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free(); me.update()
    return len(dead)


# ---------------------------------------------------------------- accessories (built from primitives, skinned by copying weights)
def body_ring(basemesh, z, band=0.012, ymax=None):
    co = np.array([v.co[:] for v in basemesh.data.vertices], dtype=np.float32)
    sel = co[np.abs(co[:, 2] - z) < band]
    if ymax is not None:
        sel = sel[sel[:, 1] < ymax]
    return sel


def copy_weights(target, source):
    """skin a generated accessory: nearest-surface weights from the body"""
    activate(target)
    mod = target.modifiers.new("dt", 'DATA_TRANSFER')
    mod.object = source
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'
    mod.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.datalayout_transfer(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def rigid_to_bone(obj, bone):
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')


def finish_accessory(obj, rig, color, rough=0.9):
    obj.parent = rig
    m = obj.modifiers.new("Armature", 'ARMATURE')
    m.object = rig
    obj.data.materials.append(make_material(obj.name + ".mat", color=hex2srgb(color), rough=rough))
    for p in obj.data.polygons:
        p.use_smooth = True


def make_scarf(rig, basemesh, color):
    bones = rig.data.bones
    neck = bones["neck_01"].head_local
    z = neck.z - 0.005
    ring = body_ring(basemesh, z, 0.015)
    cx, cy = float(np.median(ring[:, 0])), float(np.median(ring[:, 1]))
    rx = (np.percentile(ring[:, 0], 98) - np.percentile(ring[:, 0], 2)) / 2 + 0.03
    ry = (np.percentile(ring[:, 1], 98) - np.percentile(ring[:, 1], 2)) / 2 + 0.03
    bm = bmesh.new()
    seg, sides, r = 28, 10, 0.028
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = Vector((cx + rx * math.sin(a), cy - ry * math.cos(a), z - 0.01 + 0.012 * math.cos(a)))
        out = Vector((math.sin(a) * ry, -math.cos(a) * rx, 0)).normalized()
        up = Vector((0, 0, 1))
        rings.append([bm.verts.new(c + out * (r * math.cos(b)) + up * (r * 0.75 * math.sin(b)))
                      for b in [2 * math.pi * j / sides for j in range(sides)]])
    for i in range(seg):
        for j in range(sides):
            a, b = rings[i], rings[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    # a hanging tail at the front, slightly to the side, following the chest
    co = np.array([v.co[:] for v in basemesh.data.vertices], dtype=np.float32)
    x0, w, th = cx + 0.06, 0.11, 0.012
    prev = None
    steps = 9
    for k in range(steps + 1):
        zz = z - 0.03 - k * 0.04
        band = co[(np.abs(co[:, 2] - zz) < 0.02) & (np.abs(co[:, 0] - x0) < 0.06)]
        yfront = float(band[:, 1].min()) if len(band) else cy - ry
        y = yfront - 0.025 - 0.004 * k
        xs = (x0 - w / 2 + 0.01 * k * 0.3, x0 + w / 2)
        quad = [bm.verts.new((xs[0], y, zz)), bm.verts.new((xs[1], y, zz)),
                bm.verts.new((xs[1], y + th, zz)), bm.verts.new((xs[0], y + th, zz))]
        if prev:
            for j in range(4):
                bm.faces.new((prev[j], prev[(j + 1) % 4], quad[(j + 1) % 4], quad[j]))
        else:
            bm.faces.new(list(reversed(quad)))
        prev = quad
    bm.faces.new(prev)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("scarf")
    bm.to_mesh(me)
    obj = bpy.data.objects.new(rig.name + ".scarf", me)
    bpy.context.scene.collection.objects.link(obj)
    copy_weights(obj, basemesh)
    finish_accessory(obj, rig, color)
    return obj


def make_backpack(rig, basemesh, color):
    bones = rig.data.bones
    s2, s3 = bones["spine_02"].head_local, bones["spine_03"].head_local
    co = np.array([v.co[:] for v in basemesh.data.vertices], dtype=np.float32)
    zc = (s2.z + s3.z) / 2 + 0.02
    band = co[(np.abs(co[:, 2] - zc) < 0.05) & (np.abs(co[:, 0]) < 0.08)]
    yback = float(band[:, 1].max())
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.30, 0.13, 0.40), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0.0, yback + 0.075, zc - 0.02), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=3, affect='EDGES', profile=0.5)
    # two shoulder straps: thin bands from the top of the pack over the shoulders to the armpits
    for sx in (-1, 1):
        cl = bones["clavicle_l" if sx > 0 else "clavicle_r"]
        x = cl.tail_local.x * 0.75
        top_z = cl.tail_local.z + 0.03
        pts = []
        for k in range(9):
            t = k / 8
            ang = math.pi * t
            yy = (yback + 0.01) * (1 - t) + 0.0 * t
            zz = top_z - 0.02
            # arc from back over shoulder to the front
            yc = (yback + 0.01 + (-0.11)) / 2
            ry = (yback + 0.01 - (-0.11)) / 2
            pts.append(Vector((x, yc + ry * math.cos(ang), zz + 0.045 * math.sin(ang))))
        pts.append(Vector((x * 1.15, -0.10, top_z - 0.20)))
        prev = None
        for p in pts:
            v = [bm.verts.new(p + Vector((-0.025, 0, 0))), bm.verts.new(p + Vector((0.025, 0, 0)))]
            if prev:
                bm.faces.new((prev[0], prev[1], v[1], v[0]))
            prev = v
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("backpack")
    bm.to_mesh(me)
    obj = bpy.data.objects.new(rig.name + ".backpack", me)
    bpy.context.scene.collection.objects.link(obj)
    rigid_to_bone(obj, "spine_03")
    finish_accessory(obj, rig, color)
    return obj


def make_headphones(rig, basemesh, color):
    head = rig.data.bones["head"]
    co = np.array([v.co[:] for v in basemesh.data.vertices], dtype=np.float32)
    hz = head.head_local.z
    top = float(co[(np.abs(co[:, 0]) < 0.02) & (co[:, 2] > hz)][:, 2].max())
    ear_z = hz + 0.045
    band = co[np.abs(co[:, 2] - ear_z) < 0.01]
    half = float(np.percentile(np.abs(band[:, 0]), 99)) + 0.012
    ycen = float(np.median(band[:, 1])) + 0.01
    bm = bmesh.new()
    # band: a flattened half-ring over the head
    seg = 20
    prev = None
    for i in range(seg + 1):
        a = math.pi * i / seg
        x = -math.cos(a) * (half + 0.005)
        z = ear_z + 0.02 + math.sin(a) * (top - ear_z + 0.012)
        v = [bm.verts.new((x, ycen - 0.018, z)), bm.verts.new((x, ycen + 0.018, z))]
        if prev:
            bm.faces.new((prev[0], prev[1], v[1], v[0]))
        prev = v
    for sx in (-1, 1):
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.045, radius2=0.045, depth=0.035)
        vs = r['verts']
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
        bmesh.ops.translate(bm, verts=vs, vec=(sx * (half + 0.012), ycen, ear_z))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("headphones")
    bm.to_mesh(me)
    obj = bpy.data.objects.new(rig.name + ".headphones", me)
    bpy.context.scene.collection.objects.link(obj)
    rigid_to_bone(obj, "head")
    finish_accessory(obj, rig, color, rough=0.5)
    return obj


# ---------------------------------------------------------------- materials pass
def process_materials(rig, spec, clothes, texdir, tag, skip=()):
    """replace MPFB materials with clean glTF-friendly PBR ones; recolour textures; return list of (obj, role, info)"""
    parts = []
    eyes_mat = os.path.join(DATA, "eyes", "materials", spec.get("eyes", "brown") + ".mhmat")
    skip = {o.name for o in skip}
    for obj in [o for o in rig.children if o.type == 'MESH' and o.name not in skip]:
        role, opts = classify(obj, spec, clothes)
        d, n = material_images(obj)
        if role == "body":
            sk = spec["skin"]
            mh = glob.glob(os.path.join(DATA, "skins", sk["source"], "*.mhmat"))[0]
            d = mhmat_textures(mh).get("diffuseTexture")
            n = None
        elif role == "eyes":
            d = mhmat_textures(eyes_mat).get("diffuseTexture")
        elif role == "clothes" and opts.get("material"):
            alt = glob.glob(os.path.join(DATA, "clothes", opts["asset"], opts["material"], "*.mhmat"))[0]
            d = mhmat_textures(alt).get("diffuseTexture", d)
        info = {"role": role, "opts": opts, "diffuse": d, "normal": n}
        a = img_to_np(d) if d and os.path.exists(d) else None
        if a is not None:
            if role == "eyes" and spec.get("iris"):
                a = recolor_iris(a, spec["iris"])
            if role == "body" and spec["skin"].get("target"):
                a = shift_mean(a, spec["skin"]["target"])
            elif opts.get("tint"):
                a = tint_texture(a, opts["tint"], opts.get("contrast", 1.0))
            if opts.get("paint"):
                a = paint_rects(a, opts["paint"])
        info["albedo"] = a
        info["normal_np"] = img_to_np(n) if n and os.path.exists(n) else None
        info["mean"] = mean_srgb(a) if a is not None else np.array([0.6, 0.6, 0.6])
        if opts.get("sleeve_tint") and a is not None:
            info["albedo_sleeve"] = tint_texture(img_to_np(d), opts["sleeve_tint"], opts.get("contrast", 1.0))
        parts.append((obj, role, info))
    return parts


ROUGH = {"body": 0.58, "eyes": 0.15, "eyebrows": 0.9, "eyelashes": 0.9, "hair": 0.62, "clothes": 0.85, "other": 0.85}
ALPHA = {"eyebrows": "BLEND", "eyelashes": "BLEND", "hair": "MASK"}


def assign_materials(parts, texsize, texdir, tag, keep_normals):
    """(re)build every material at the given texture size. texsize None = flat colours"""
    for obj, role, info in parts:
        if info.get("accessory"):
            continue
        new_mats = []
        rough = info["opts"].get("rough", ROUGH.get(role, 0.85))
        alpha = ALPHA.get(role, "OPAQUE")
        cutout = info["opts"].get("cutout") or "glasses" in info["opts"].get("asset", "")
        if role == "clothes" and cutout and info["albedo"] is not None and info["albedo"][..., 3].min() < 0.5:
            alpha = "MASK"      # glasses lenses: cut out
        elif alpha == "OPAQUE" and info["albedo"] is not None:
            a = info["albedo"]
            holes = a[..., 3] < 0.5         # some cloth textures carry stray alpha holes; opaque cloth ignores them
            if holes.any():
                a[holes, :3] = info["mean"][None, :]
            a[..., 3] = 1.0
        base = norm = None
        stem = f"{tag}_{obj.name.replace('.', '_')}"
        if info["albedo"] is not None and texsize:
            size = texsize
            if role in ("eyebrows", "eyelashes"):
                size = min(texsize, 256)
            if role == "eyes":
                size = min(texsize, 256)
            base = np_to_image(np_resize(info["albedo"], size), stem + f"_c{size}", texdir, alpha != "OPAQUE")
            if keep_normals and info["normal_np"] is not None:
                norm = np_to_image(np_resize(info["normal_np"], min(size, 512)), stem + f"_n{size}", texdir, False)
        mat = make_material(stem, base, norm, color=info["mean"], rough=rough, alpha=alpha if base is not None else (
            "OPAQUE" if role not in ("eyelashes",) else "BLEND"))
        new_mats.append(mat)
        if info.get("albedo_sleeve") is not None:
            sb = np_to_image(np_resize(info["albedo_sleeve"], texsize), stem + f"_s{texsize}", texdir, False) if texsize else None
            mean_s = mean_srgb(info["albedo_sleeve"])
            new_mats.append(make_material(stem + "_sleeve", sb, None, color=mean_s, rough=rough))
        # replace slots in place: materials.clear() would reset every face's material index to 0
        mats = obj.data.materials
        for i, m in enumerate(new_mats):
            if i < len(mats):
                mats[i] = m
            else:
                mats.append(m)
        while len(mats) > len(new_mats):
            mats.pop(index=len(mats) - 1)


# ---------------------------------------------------------------- decimation / LOD
def head_faces(obj):
    gi = obj.vertex_groups.get("head")
    if gi is None:
        return set()
    w = np.zeros(len(obj.data.vertices), dtype=np.float32)
    for v in obj.data.vertices:
        for g in v.groups:
            if g.group == gi.index:
                w[v.index] = g.weight
    return {p.index for p in obj.data.polygons if min(w[i] for i in p.vertices) > 0.6}


def decimate_selected(obj, ratio, faces=None):
    """collapse-decimate (only `faces` when given; the borders with other faces stay put)"""
    if ratio >= 0.999:
        return
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in obj.data.polygons:
        p.select = (faces is None) or (p.index in faces)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.decimate(ratio=max(ratio, 0.02), use_symmetry=True, symmetry_axis='X')
    bpy.ops.object.mode_set(mode='OBJECT')


def triangulate(obj):
    activate(obj)
    m = obj.modifiers.new("tri", 'TRIANGULATE')
    m.quad_method = 'BEAUTY'
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    bpy.ops.object.modifier_apply(modifier=m.name)


def total_tris(objs):
    return sum(tris_of(o) for o in objs)


SHOE_WORDS = ("shoe", "sneaker", "boot", "flats", "oxford", "sandal")


def _weight(role, info):
    if role == "body":
        return 3.0
    if role in ("eyes", "eyebrows", "eyelashes"):
        return 0.5
    if role == "hair":
        return 1.0
    if info.get("accessory"):
        return 0.5
    asset = info.get("opts", {}).get("asset", "")
    if any(w in asset for w in SHOE_WORDS):
        return 0.35
    return 1.0


def decimate_whole(obj, ratio):
    """collapse-decimate a whole mesh with the modifier (keeps thin parts like arms better than the edit-mode op)"""
    if ratio >= 0.999:
        return
    activate(obj)
    m = obj.modifiers.new("dec", 'DECIMATE')
    m.ratio = max(ratio, 0.01)
    m.use_symmetry = True
    m.symmetry_axis = 'X'
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    bpy.ops.object.modifier_apply(modifier=m.name)


def fit_budget(parts, budget, protect_head=True):
    """decimate (full-res) meshes so the whole character fits `budget` triangles.
    The budget is shared by weight * sqrt(tris) (body > clothes > shoes); the body's head gets a fixed share."""
    objs = [p[0] for p in parts]
    if total_tris(objs) <= budget:
        return total_tris(objs)
    n = {p[0].name: tris_of(p[0]) for p in parts}
    share = {p[0].name: _weight(p[1], p[2]) * math.sqrt(max(n[p[0].name], 1)) for p in parts}
    target, free, left = {}, dict(share), budget * 0.98
    while free:                                  # water-filling: small meshes keep everything, the rest is shared
        tot = sum(free.values())
        capped = [k for k, w in free.items() if left * w / tot >= n[k]]
        if not capped:
            for k, w in free.items():
                target[k] = left * w / tot
            break
        for k in capped:
            target[k] = n[k]
            left -= n[k]
            free.pop(k)
    for obj, role, info in parts:
        cnt, goal = n[obj.name], target[obj.name]
        if cnt < 60 or goal >= cnt * 0.999:
            continue
        if role == "body" and protect_head:
            hf = head_faces(obj)
            hn = sum(len(obj.data.polygons[i].vertices) - 2 for i in hf)
            head_goal = min(hn, goal * (0.38 if budget >= 8000 else 0.3))
            rest_goal = max(goal - head_goal, 50)
            decimate_selected(obj, rest_goal / max(cnt - hn, 1), set(range(len(obj.data.polygons))) - hf)
            decimate_selected(obj, head_goal / max(hn, 1), head_faces(obj))
        elif role in ("eyelashes", "eyebrows"):
            decimate_whole(obj, max(goal / cnt, 0.5))
        else:
            decimate_whole(obj, goal / cnt)
        now = tris_of(obj)
        if now > goal * 1.04:                    # one correction pass on the whole mesh
            decimate_whole(obj, goal / now)
    for _ in range(3):                           # still over: take the excess from the non-body meshes
        excess = total_tris(objs) - budget
        if excess <= 0:
            break
        rest = [p[0] for p in parts if p[1] != "body" and tris_of(p[0]) >= 60]
        pool = sum(tris_of(o) for o in rest)
        if pool <= 0:
            break
        for o in rest:
            decimate_whole(o, max(0.3, 1 - (excess * 1.05) / pool))
    return total_tris(objs)


# ---------------------------------------------------------------- export
def ground_and_center(rig, meshes):
    """feet at z=0 (Blender) -> y=0 in glTF; character centred on x/y at the origin"""
    zmin = min(min((o.matrix_world @ v.co).z for v in o.data.vertices) for o in meshes)
    if abs(zmin) > 1e-4:
        rig.location.z -= zmin
        bpy.context.view_layer.update()
        activate(rig)
        for o in meshes:
            o.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def export_glb(rig, meshes, path, quality=82):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    rig.select_set(True)
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_skins=True, export_animations=False, export_morph=False, export_def_bones=False,
                              export_image_format='WEBP', export_image_quality=quality, export_texcoords=True,
                              export_normals=True, export_tangents=False, export_vertex_color='NONE',
                              export_extras=False, export_cameras=False, export_lights=False, export_leaf_bone=False,
                              export_rest_position_armature=True)
    return os.path.getsize(path)
