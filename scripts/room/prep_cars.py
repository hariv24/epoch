"""Street cars: raw Sketchfab GLB -> real-scale, floor-aligned, badge-free, paint-separable GLBs (LOD0 + LOD1).

    blender -b -P scripts/room/prep_cars.py -- <camry|tiida> <src.glb> <out_dir>

Camry (CC-BY, zairiq): the body is one photo-baked atlas; paint is a separate mask texture (camry_mask.webp, same UVs) applied in the shader.
Tiida/Versa (CC-BY, Jean Wally): flat PBR materials are rebuilt per part; 'paint' is its own material; the badge mesh and interior are removed.
Both: uniform scale to the real length (Camry 4.80 m, Tiida 4.30 m), origin at floor centre, front = glTF +Z. Interior, undercarriage detail dropped.
"""
import sys

import bpy
from mathutils import Matrix, Vector

kind, src, outdir = sys.argv[sys.argv.index("--") + 1:][:3]
LEN = {"camry": 4.80, "tiida": 4.30}[kind]
T0 = {"camry": 10500, "tiida": 14000}[kind]
T1 = 2600
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o)

DROP = {"camry": {"CAMRY_INTERIOR"}, "tiida": {"interior", "phong3"}}[kind]      # phong3 = the Nissan badge mesh
for o in list(meshes):
    if o.data.materials[0].name in DROP:
        bpy.data.objects.remove(o)
        meshes.remove(o)

def world_bbox(objs):
    vs = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return [min(v[i] for v in vs) for i in range(3)], [max(v[i] for v in vs) for i in range(3)]

lo, hi = world_bbox(meshes)
s = LEN / (hi[1] - lo[1])
cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
M = Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -lo[2]))
for o in meshes:
    o.data.transform(M @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

def mat(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    return m

if kind == "tiida":
    P = {
        "paint": mat("paint", (1, 1, 1), 0.3), "glass": mat("glass", (0.03, 0.045, 0.06), 0.06, 0.5), "tyre": mat("tyre", (0.03, 0.03, 0.03), 0.85),
        "rim": mat("rim", (0.62, 0.64, 0.67), 0.35, 0.9), "trim": mat("trim", (0.035, 0.035, 0.035), 0.6), "lightH": mat("lightH", (0.8, 0.8, 0.76), 0.12, 0.3),
        "lightT": mat("lightT", (0.5, 0.03, 0.03), 0.2), "plate": mat("plate", (0.85, 0.85, 0.82), 0.5),
    }
    MAP = {"tyre": "tyre", "chrome": "rim", "phong1": "glass", "disk": "trim", "phong8": "trim", "chassis": "trim", "Light_R": "lightT", "lights": "lightH",
           "carpaint": "paint", "material": "rim", "plast_1": "plate", "surr_glass": "glass", "pl_S": "trim", "red_glass": "lightT"}
    for o in meshes:
        key = MAP[o.data.materials[0].name]
        o.data.materials.clear(); o.data.materials.append(P[key])
else:
    PAINT = mat("paint", (1, 1, 1), 0.3)
    TYRE = mat("tyre", (0.03, 0.03, 0.03), 0.85)
    for o in meshes:
        n = o.data.materials[0].name
        if n == "Standard_5":                                     # the flat white hood panel: plain paint
            o.data.materials.clear(); o.data.materials.append(PAINT)
        elif n == "Camry_Def":
            o.data.materials[0].name = "body"
        elif n == "chassis_def":
            o.data.materials[0].name = "under"
        elif n == "TCM_Tires_D":                                   # flat rubber: the 256 px tyre texture cannot be re-encoded and adds nothing
            o.data.materials.clear(); o.data.materials.append(TYRE)
        elif n == "TCM_Wheel_D":
            o.data.materials[0].name = "rim"
    for m in bpy.data.materials:
        b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
        if b:
            b.inputs["Roughness"].default_value = {"body": 0.4, "paint": 0.3, "rim": 0.35}.get(m.name, 0.7)
            b.inputs["Metallic"].default_value = 0.0 if m.name != "rim" else 0.6

def lod(tag, target):
    bpy.ops.object.select_all(action="DESELECT")
    objs = {}
    for o in meshes:
        d = o.copy(); d.data = o.data.copy(); bpy.context.collection.objects.link(d)
        objs.setdefault(d.data.materials[0].name, []).append(d)
    out = []
    for name, lst in objs.items():
        bpy.ops.object.select_all(action="DESELECT")
        for d in lst: d.select_set(True)
        bpy.context.view_layer.objects.active = lst[0]
        if len(lst) > 1: bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active; j.name = name; out.append(j)
    tot = sum(len(j.data.polygons) for j in out)
    if target < tot:
        for j in out:
            md = j.modifiers.new("d", "DECIMATE"); md.ratio = max(0.04, target / tot)
            bpy.context.view_layer.objects.active = j; bpy.ops.object.modifier_apply(modifier="d")
    tris = 0
    for j in out:
        j.data.calc_loop_triangles(); tris += len(j.data.loop_triangles)
    bpy.ops.object.select_all(action="DESELECT")
    for j in out: j.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f"{outdir}/{kind}_{tag}.glb", use_selection=True, export_image_format="WEBP", export_apply=True, export_yup=True)
    print("LOD", kind, tag, "tris", tris, "mats", len(out))
    for j in out: bpy.data.objects.remove(j)

lod("lod0", T0)
lod("lod1", T1)
lo, hi = world_bbox(meshes)
print("SIZE", [round(hi[i] - lo[i], 2) for i in range(3)])
