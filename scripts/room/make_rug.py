"""Procedural area rug (geometry only; the look comes from Poly Haven CC0 textures).

    Blender -b -P scripts/room/make_rug.py -- <out.glb> --body DIFF,NOR,ARM,TILE --border DIFF,NOR,ARM,TILE
            [--size 1.6x2.3] [--band 0.06] [--thick 0.012]

A W x L x thick slab: a woven body panel inset by `band` metres, bound by a band (the cotton binding) that
also wraps the sides. The top edge is rounded (4 mm, 3 segments). UVs are planar in metres / TILE, so the
weave keeps its real size. Each textures' ARM map supplies roughness (G) and metalness (B), glTF ORM style.
Origin at the floor centre; the long side runs along Z (glTF), i.e. front/back.
"""
import sys

import bmesh
import bpy
from mathutils import Vector


def parse():
    a = sys.argv[sys.argv.index("--") + 1:]
    o = {"out": a[0], "size": (1.6, 2.3), "band": 0.06, "thick": 0.012}
    i = 1
    while i < len(a):
        k, v = a[i], a[i + 1]
        if k in ("--body", "--border"):
            d, n, r, t = v.split(",")
            o[k[2:]] = (d, n, r, float(t))
        elif k == "--size":
            o["size"] = tuple(float(x) for x in v.split("x"))
        elif k == "--band":
            o["band"] = float(v)
        elif k == "--thick":
            o["thick"] = float(v)
        i += 2
    return o


def material(name, diff, nor, arm):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    td = nt.nodes.new("ShaderNodeTexImage")
    td.image = bpy.data.images.load(diff)
    nt.links.new(td.outputs["Color"], bsdf.inputs["Base Color"])
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = bpy.data.images.load(arm)
    ta.image.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(ta.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = bpy.data.images.load(nor)
    tn.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def main():
    o = parse()
    W, L = o["size"]
    T, B = o["thick"], o["band"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new("rug")
    ob = bpy.data.objects.new("rug", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(material("rug_body", *o["body"][:3]))
    ob.data.materials.append(material("rug_binding", *o["border"][:3]))
    bm = bmesh.new()
    # box W (x) by L (y) by T (z)
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(W, L, T), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, T / 2), verts=bm.verts)
    top_edges = [e for e in bm.edges if all(v.co.z > T - 1e-6 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=top_edges, offset=min(0.004, T * 0.4), segments=3, affect="EDGES", profile=0.5)
    # inset the (flat) top face to split body / binding
    top = max(bm.faces, key=lambda f: f.calc_center_median().z * (f.calc_area() > W * L * 0.5))
    ret = bmesh.ops.inset_individual(bm, faces=[top], thickness=B - 0.004, depth=0)
    for f in bm.faces:
        f.material_index = 1
    top.material_index = 0
    uv = bm.loops.layers.uv.new("UVMap")
    tb, tr = o["body"][3], o["border"][3]
    for f in bm.faces:
        t = tb if f.material_index == 0 else tr
        n = f.normal
        for l in f.loops:
            c = l.vert.co
            if abs(n.z) > 0.5:
                l[uv].uv = (c.x / t, c.y / t)
            elif abs(n.x) > abs(n.y):
                l[uv].uv = (c.y / t, c.z / t)
            else:
                l[uv].uv = (c.x / t, c.z / t)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=o["out"], export_format="GLB", use_selection=True, export_yup=True)
    print(f"[rug] {o['out']}: w{W:.2f} x d{L:.2f} x h{T:.3f} m, {sum(len(p.vertices) - 2 for p in me.polygons)} tris")


main()
