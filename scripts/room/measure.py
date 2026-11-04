"""Measure GLB/glTF files in Blender (Z-up, after import): overall + per-object bounds, and surface heights
by ray-casting straight down at fractions of the footprint.

    Blender -b -P scripts/room/measure.py -- file.glb [file2.glb ...] [--probe fx,fy ...]

fx, fy in [0,1] across the overall X / Y extent (fy=0 is -Y, i.e. the glTF +Z "front").
"""
import sys

import bpy
from mathutils import Vector


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    files, probes, i = [], [], 0
    while i < len(a):
        if a[i] == "--probe":
            probes.append(tuple(float(v) for v in a[i + 1].split(",")))
            i += 2
        else:
            files.append(a[i])
            i += 1
    return files, probes


def world_bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def main():
    files, probes = args()
    for f in files:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=f)
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        lo, hi = world_bounds(meshes)
        d = hi - lo
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
        print(f"[measure] {f}\n  size x{d.x:.3f} y{d.y:.3f} z{d.z:.3f}  min {tuple(round(v, 3) for v in lo)}  tris {tris}")
        for o in meshes:
            a, b = world_bounds([o])
            s = b - a
            print(f"   - {o.name[:40]:40} x{s.x:9.3f} y{s.y:9.3f} z{s.z:9.3f}  min({a.x:.2f},{a.y:.2f},{a.z:.2f})  mats {[m.name for m in o.data.materials]}")
        dg = bpy.context.evaluated_depsgraph_get()
        for fx, fy in probes:
            p = Vector((lo.x + fx * d.x, lo.y + fy * d.y, hi.z + 1.0))
            hit, loc, _n, _i, ob, _m = bpy.context.scene.ray_cast(dg, p, Vector((0, 0, -1)))
            print(f"   probe ({fx},{fy}): " + (f"z={loc.z - lo.z:.3f} on {ob.name[:30]}" if hit else "miss"))


main()
