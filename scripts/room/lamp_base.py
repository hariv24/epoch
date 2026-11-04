"""Turn Poly Haven's clamp-on anglepoise (desk_lamp_arm_01) into a freestanding desk lamp.

    Blender -b -P scripts/room/lamp_base.py -- <in.glb (prepared, origin at clamp bottom)> <out.glb>

The desk has a drawer box under its whole top, so a clamp can't grip any edge. This cuts the C-clamp off
just under its upper jaw (z = CUT), adds a bevelled weighted disc base (BASE_D x BASE_H) under the pivot
block and drops the lamp onto it. The disc reuses the lamp's own material, with its UVs collapsed onto
a plain painted patch of the arm (sampled from the upper-jaw block), so paint, roughness and metalness match.
"""
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

CUT = 0.085      # m, just below the upper jaw's underside (~0.087)
BASE_D = 0.18    # m, disc diameter
BASE_H = 0.024   # m, disc height
BEVEL = 0.006    # m


def main():
    src, out = sys.argv[sys.argv.index("--") + 1:][:2]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    lamp = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    me = lamp.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    # a UV on the painted upper-jaw block, to colour the disc
    block = [f for f in bm.faces if CUT + 0.004 < f.calc_center_median().z < CUT + 0.02 and abs(f.normal.z) < 0.3]
    block.sort(key=lambda f: -f.calc_area())
    paint_uv = sum((l[uv].uv for l in block[0].loops), Vector((0, 0))) / len(block[0].loops)
    mat_index = block[0].material_index
    # footprint of the pivot block (for the disc centre)
    vs = [v.co for v in bm.verts if CUT < v.co.z < CUT + 0.02]
    cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
    cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
    # cut off everything below CUT
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, CUT), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.translate(bm, verts=list(bm.verts), vec=(0, 0, BASE_H - CUT))
    # disc base
    ret = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48, radius1=BASE_D / 2,
                                radius2=BASE_D / 2, depth=BASE_H,
                                matrix=Matrix.Translation((cx, cy, BASE_H / 2)))
    disc_verts = set(ret["verts"])
    disc_faces = [f for f in bm.faces if all(v in disc_verts for v in f.verts)]
    disc_edges = [e for e in bm.edges if all(v in disc_verts for v in e.verts)
                  and any(abs(f.normal.z) > 0.9 for f in e.link_faces)]
    bmesh.ops.bevel(bm, geom=disc_edges, offset=BEVEL, segments=3, affect="EDGES", profile=0.5)
    disc_verts = {v for v in bm.verts if v.co.z <= BASE_H + 1e-5 and (Vector((v.co.x - cx, v.co.y - cy)).length
                                                                      <= BASE_D / 2 + 1e-4)}
    for f in bm.faces:
        if all(v in disc_verts for v in f.verts):
            f.material_index = mat_index
            f.smooth = True
            for l in f.loops:
                # tiny spread so the patch reads as painted metal, not a flat swatch
                l[uv].uv = paint_uv + Vector(((l.vert.co.x - cx) * 0.01, (l.vert.co.y - cy) * 0.01))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    lamp.select_set(True)
    bpy.context.view_layer.objects.active = lamp
    bpy.ops.object.shade_auto_smooth(angle=0.6)
    lo = Vector((min(v.co.x for v in me.vertices), min(v.co.y for v in me.vertices), min(v.co.z for v in me.vertices)))
    hi = Vector((max(v.co.x for v in me.vertices), max(v.co.y for v in me.vertices), max(v.co.z for v in me.vertices)))
    me.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
    lamp.name = "lamp"
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    d = hi - lo
    print(f"[lamp_base] {out}: w{d.x:.3f} x d{d.y:.3f} x h{d.z:.3f} m, {sum(len(p.vertices) - 2 for p in me.polygons)} tris, paint uv {tuple(round(c, 3) for c in paint_uv)}")


main()
