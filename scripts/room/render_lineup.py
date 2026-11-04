"""EEVEE lineup render of prepared room GLBs at true scale next to a 1.75 m human (verification sheets).

    Blender -b -P scripts/room/render_lineup.py -- --out out.png [--size 1600x700] [--gap 0.35]
            [--view 3q|front|top] [--human PATH|none] [--floor TEX_DIR] [--wall DIFF,NOR] [--ortho M] [--human-turn DEG]
            item.glb [item2.glb ...]

Items are prepared GLBs (metres, origin at the floor centre, front = glTF +Z). They're laid left to right
along X with `gap` metres between footprints; the human stands first. The camera is orthographic so every
cell in a sheet shares one scale. A Poly Haven studio HDRI + a sun give PBR-readable light.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HDRI = os.path.join(ROOT, "build", "polyhaven-raw", "studio_small_09", "studio_small_09_1k.hdr")
# the user's own Epoch character (people pipeline, uncompressed), scaled to 1.75 m; Dylan's opaque hair cards hide his face
HUMAN = os.path.join(ROOT, "build", "people-work", "glb", "user", "everyday.close.glb")
if not os.path.exists(HUMAN):
    HUMAN = os.path.join(ROOT, "maxiamo", "characters", "dylan_-_lod_man_character.glb")
HUMAN_KEEP = {"Object_6", "Object_8", "Object_10", "Object_12", "Object_14", "Object_16", "Object_18"}  # LOD0


def parse():
    a = sys.argv[sys.argv.index("--") + 1:]
    o = {"out": None, "size": (1600, 700), "gap": 0.35, "view": "3q", "human": HUMAN, "floor": None,
         "items": [], "ortho": None, "wall": None, "human_turn": 0.0}
    i = 0
    while i < len(a):
        k = a[i]
        if k == "--out":
            o["out"] = a[i + 1]; i += 2
        elif k == "--size":
            o["size"] = tuple(int(x) for x in a[i + 1].split("x")); i += 2
        elif k == "--gap":
            o["gap"] = float(a[i + 1]); i += 2
        elif k == "--view":
            o["view"] = a[i + 1]; i += 2
        elif k == "--human":
            o["human"] = None if a[i + 1] == "none" else a[i + 1]; i += 2
        elif k == "--floor":
            o["floor"] = a[i + 1]; i += 2
        elif k == "--human-turn":
            o["human_turn"] = float(a[i + 1]); i += 2
        elif k == "--wall":
            o["wall"] = a[i + 1].split(","); i += 2
        elif k == "--ortho":
            o["ortho"] = float(a[i + 1]); i += 2
        else:
            o["items"].append(a[i]); i += 1
    return o


def import_group(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [ob for ob in bpy.context.scene.objects if ob not in before]
    for ob in [ob for ob in new if ob.name.startswith("Icosphere")]:  # the importer's bone-shape helper
        bpy.data.objects.remove(ob, do_unlink=True)
    return [ob for ob in bpy.context.scene.objects if ob not in before]


def bounds(objs):
    """World bounds of the evaluated (skinned/deformed) geometry."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in objs:
        if ob.type != "MESH":
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi


def move(objs, d):
    for ob in objs:
        if ob.parent is None:
            ob.location += d


def wall_material(diff, nor):
    m = bpy.data.materials.new("wall")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mapn = nt.nodes.new("ShaderNodeMapping")
    mapn.inputs["Scale"].default_value = (0.5, 0.5, 0.5)  # 2 m tile
    mapn.inputs["Rotation"].default_value = (1.5708, 0, 0)  # x/z plane -> uv
    nt.links.new(geo.outputs["Position"], mapn.inputs["Vector"])
    td = nt.nodes.new("ShaderNodeTexImage")
    td.image = bpy.data.images.load(diff)
    nt.links.new(mapn.outputs["Vector"], td.inputs["Vector"])
    nt.links.new(td.outputs["Color"], bsdf.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = bpy.data.images.load(nor)
    tn.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(mapn.outputs["Vector"], tn.inputs["Vector"])
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def floor_material(tex_dir):
    m = bpy.data.materials.new("floor")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    if not tex_dir:
        bsdf.inputs["Base Color"].default_value = (0.82, 0.81, 0.79, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
        return m
    files = os.listdir(tex_dir)
    pick = lambda tag: next((os.path.join(tex_dir, f) for f in files if tag in f), None)
    coord = nt.nodes.new("ShaderNodeNewGeometry")  # world position, metres
    mapn = nt.nodes.new("ShaderNodeMapping")
    mapn.inputs["Scale"].default_value = (0.5, 0.5, 0.5)  # Poly Haven floor tile = 2 m
    mapn.inputs["Rotation"].default_value = (0, 0, 1.5708)  # boards run along X (the lineup's long axis)
    nt.links.new(coord.outputs["Position"], mapn.inputs["Vector"])
    for tag, sock, nonc in (("_diff_", "Base Color", False), ("_rough_", "Roughness", True)):
        p = pick(tag)
        if p:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(p)
            if nonc:
                t.image.colorspace_settings.name = "Non-Color"
            nt.links.new(mapn.outputs["Vector"], t.inputs["Vector"])
            nt.links.new(t.outputs["Color"], bsdf.inputs[sock])
    p = pick("_nor_gl_")
    if p:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(p)
        t.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(mapn.outputs["Vector"], t.inputs["Vector"])
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def main():
    o = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = o["size"]
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    try:
        sc.eevee.use_shadows = True
        sc.eevee.use_raytracing = True
    except AttributeError:
        pass
    # world HDRI
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    env = w.node_tree.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI)
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Strength"].default_value = 0.9
    w.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
    # sun
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.2
    sun.angle = math.radians(6)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(so)

    x = 0.0
    groups = []
    if o["human"]:
        objs = import_group(o["human"])
        if any(ob.name.split(".")[0] in HUMAN_KEEP for ob in objs):  # the Dylan file: keep LOD0 only
            for ob in [ob for ob in objs if ob.type == "MESH" and ob.name.split(".")[0] not in HUMAN_KEEP]:
                bpy.data.objects.remove(ob, do_unlink=True)
        objs = [ob for ob in sc.objects if ob.name not in ("sun",) and ob.type in ("MESH", "EMPTY", "ARMATURE")]
        lo, hi = bounds(objs)
        s = 1.75 / (hi.z - lo.z)
        roots = [ob for ob in objs if ob.parent is None]
        pivot = bpy.data.objects.new("human_pivot", None)  # scale to 1.75 m, turn to face the camera (-Y)
        sc.collection.objects.link(pivot)
        for r in roots:
            r.parent = pivot
        pivot.scale = (s, s, s)
        pivot.rotation_euler = (0, 0, math.radians(o["human_turn"]))
        roots = [pivot]
        objs.append(pivot)
        bpy.context.view_layer.update()
        lo, hi = bounds(objs)
        move(roots, Vector((-lo.x, -(lo.y + hi.y) / 2, -lo.z)))
        bpy.context.view_layer.update()
        lo, hi = bounds(objs)
        x = hi.x + o["gap"]
        groups.append(objs)
    for path in o["items"]:
        objs = import_group(path)
        lo, hi = bounds(objs)
        roots = [ob for ob in objs if ob.parent is None]
        move(roots, Vector((x - lo.x, 0, 0)))
        bpy.context.view_layer.update()
        lo, hi = bounds(objs)
        x = hi.x + o["gap"]
        groups.append(objs)
    allobjs = [ob for g in groups for ob in g]
    lo, hi = bounds(allobjs)
    # floor
    bpy.ops.mesh.primitive_plane_add(size=1)
    fl = bpy.context.active_object
    fl.scale = (hi.x - lo.x + 8, hi.y - lo.y + 8, 1)
    fl.location = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)
    fl.data.materials.append(floor_material(o["floor"]))
    if o["wall"]:  # a 2.9 m plaster wall 0.25 m behind the deepest item
        bpy.ops.mesh.primitive_plane_add(size=1)
        wl = bpy.context.active_object
        wl.scale = (hi.x - lo.x + 8, 2.9, 1)
        wl.rotation_euler = (math.radians(90), 0, 0)
        wl.location = ((lo.x + hi.x) / 2, hi.y + 0.25, 1.45)
        wl.data.materials.append(wall_material(*o["wall"]))
    # camera
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    c = (lo + hi) / 2
    if o["view"] == "front":
        d = Vector((0, -1, 0.12))
    elif o["view"] == "top":
        d = Vector((0, -0.001, 1))
    else:
        d = Vector((0.55, -1, 0.62))
    co.location = c + d.normalized() * 20
    co.rotation_euler = (c - co.location).to_track_quat("-Z", "Y").to_euler()
    aspect = o["size"][0] / o["size"][1]
    span = max((hi.x - lo.x) * 1.08, (hi.z - lo.z) * aspect * 1.35, (hi.y - lo.y) * 1.2)
    cam.ortho_scale = o["ortho"] or span
    sc.render.filepath = o["out"]
    bpy.ops.render.render(write_still=True)
    print(f"[lineup] {o['out']} ortho {cam.ortho_scale:.2f} m")


main()
