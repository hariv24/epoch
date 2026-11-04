"""Blender step of the room-asset pipeline: raw GLB/glTF -> clean, real-scale GLB (before compression).

    Blender -b -P scripts/room/prep_asset.py -- <src> <out.glb> [--include REGEX] [--rot-z DEG]
            [--scale S | --scale SX,SY,SZ] [--fit-height H] [--roughness R]

- Imports <src>, deletes every mesh whose name doesn't match --include, deletes armatures/empties/lights/cameras
  (meshes keep their rest pose).
- Rotates about Z (so the object's front ends up on Blender -Y == glTF +Z), then scales in that oriented frame
  (X = width, Y = depth, Z = height). --fit-height scales uniformly so the total height equals H metres.
- --roughness forces one roughness on every material (unlinking any roughness texture); for sources that ship
  a flat, too-glossy value (the rug's "texture" is a single uniform colour).
- Joins into one object, puts the origin at the floor centre of the footprint (bbox centre in X/Y, min Z = 0),
  applies all transforms and exports a GLB (Y-up). Prints size + triangle count.
Compression (resize, webp, meshopt) happens afterwards in scripts/room/build_assets.sh.
"""
import math
import re
import sys

import bpy
from mathutils import Matrix, Vector


def parse():
    a = sys.argv[sys.argv.index("--") + 1:]
    o = {"src": a[0], "out": a[1], "include": ".*", "rot_z": 0.0, "scale": (1.0, 1.0, 1.0), "fit_height": None,
         "roughness": None}
    i = 2
    while i < len(a):
        k = a[i]
        if k == "--include":
            o["include"] = a[i + 1]
        elif k == "--rot-z":
            o["rot_z"] = float(a[i + 1])
        elif k == "--scale":
            v = [float(x) for x in a[i + 1].split(",")]
            o["scale"] = tuple(v * 3 if len(v) == 1 else v)
        elif k == "--fit-height":
            o["fit_height"] = float(a[i + 1])
        elif k == "--roughness":
            o["roughness"] = float(a[i + 1])
        i += 2
    return o


def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in objs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def main():
    o = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if o["src"].endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=o["src"])
    else:
        sys.exit("unsupported source")
    rx = re.compile(o["include"])
    scene = bpy.context.scene
    keep = [ob for ob in scene.objects if ob.type == "MESH" and rx.search(ob.name)
            and not ob.name.startswith("Icosphere")]  # the importer's bone-shape helper for rigged files
    if not keep:
        sys.exit(f"nothing matches {o['include']!r}")
    # freeze world transforms (and armature deform at rest) into the mesh data, then drop everything else
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in keep:
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me.transform(ob.matrix_world)
        ob.modifiers.clear()
        ob.parent = None
        ob.data = me
        ob.matrix_world = Matrix.Identity(4)
    for ob in list(scene.objects):
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    # orient, then scale in the oriented frame
    rot = Matrix.Rotation(math.radians(o["rot_z"]), 4, "Z")
    for ob in keep:
        ob.data.transform(rot)
    if o["fit_height"]:
        lo, hi = bounds(keep)
        s = o["fit_height"] / (hi.z - lo.z)
        o["scale"] = tuple(c * s for c in o["scale"])
    sm = Matrix.Diagonal((*o["scale"], 1.0))
    for ob in keep:
        ob.data.transform(sm)
        if o["scale"][0] * o["scale"][1] * o["scale"][2] < 0:
            ob.data.flip_normals()
    if o["roughness"] is not None:
        for m in {m for ob in keep for m in ob.data.materials if m and m.use_nodes}:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    for l in list(n.inputs["Roughness"].links):
                        m.node_tree.links.remove(l)
                    n.inputs["Roughness"].default_value = o["roughness"]
    # join
    bpy.ops.object.select_all(action="DESELECT")
    for ob in keep:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = keep[0]
    if len(keep) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    # origin at floor centre of the footprint
    lo, hi = bounds([ob])
    ob.data.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    ob.data.update()
    ob.name = re.sub(r"\.glb$", "", o["out"].split("/")[-1])
    lo, hi = bounds([ob])
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    bpy.ops.export_scene.gltf(filepath=o["out"], export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_skins=False,
                              export_morph=False, export_cameras=False, export_lights=False)
    d = hi - lo
    # glTF: width = X, depth = Z (Blender Y), height = Y (Blender Z)
    print(f"[prep] {o['out']}: w{d.x:.3f} x d{d.y:.3f} x h{d.z:.3f} m, {tris} tris, scale {tuple(round(s, 4) for s in o['scale'])}")


main()
