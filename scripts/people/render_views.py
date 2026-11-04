"""Render exported people GLBs with EEVEE (verification / contact sheets).

  blender -b -P scripts/people/render_views.py -- --out DIR --size 512 [--clips clips.glb --clip walk --t 0.25] \
      [--angle 20] [--close] a.glb b.glb ...
One PNG per GLB (named after the file, plus the clip). Montage them with ImageMagick (see build_all.sh).
"""
import bpy, sys, os, math, argparse
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--size", type=int, default=512)
ap.add_argument("--clips", default=None)
ap.add_argument("--clip", default=None)
ap.add_argument("--t", type=float, default=0.3, help="fraction of the clip")
ap.add_argument("--angle", type=float, default=18.0, help="camera yaw (deg) off the front")
ap.add_argument("--close", action="store_true", help="head-and-shoulders framing")
ap.add_argument("glbs", nargs="+")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
os.makedirs(args.out, exist_ok=True)


def clear():
    bpy.ops.wm.read_homefile(use_empty=True)


def setup_scene():
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = args.size
    sc.render.resolution_y = args.size if args.close else int(args.size * 1.4)
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    w = bpy.data.worlds.new("w"); sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get("Background") or w.node_tree.nodes.new("ShaderNodeBackground")
    if not bg.outputs[0].links:
        out = w.node_tree.nodes.get("World Output") or w.node_tree.nodes.new("ShaderNodeOutputWorld")
        w.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs[0].default_value = (0.52, 0.55, 0.6, 1); bg.inputs[1].default_value = 0.9
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", 'SUN')); sc.collection.objects.link(key)
    key.rotation_euler = (math.radians(55), 0, math.radians(-35)); key.data.energy = 3.2; key.data.angle = math.radians(8)
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", 'SUN')); sc.collection.objects.link(rim)
    rim.rotation_euler = (math.radians(60), 0, math.radians(160)); rim.data.energy = 1.2
    floor = bpy.data.meshes.new("floor"); floor.from_pydata([(-5, -5, 0), (5, -5, 0), (5, 5, 0), (-5, 5, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new("floor", floor); sc.collection.objects.link(fo)
    fm = bpy.data.materials.new("floor"); fm.diffuse_color = (0.35, 0.33, 0.31, 1)
    try:
        fm.use_nodes = True
        fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.3, 0.28, 0.26, 1)
    except Exception:
        pass
    fo.data.materials.append(fm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    return cam


clip_action = None
for glb in args.glbs:
    clear()
    cam = setup_scene()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in bpy.data.objects if o not in before]
    rig = next((o for o in objs if o.type == 'ARMATURE'), None)
    name = os.path.splitext(os.path.basename(glb))[0]
    if args.clips and rig is not None:
        b2 = set(bpy.data.objects)
        acts_before = set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=args.clips)
        for o in set(bpy.data.objects) - b2:
            bpy.data.objects.remove(o, do_unlink=True)
        act = next(a for a in bpy.data.actions if a not in acts_before and a.name.split("|")[-1].startswith(args.clip)
                   and a.name.split("|")[-1] in (args.clip, args.clip + "_")) if False else None
        for a in set(bpy.data.actions) - acts_before:
            base = a.name.split("|")[-1]
            if base == args.clip or a.name == args.clip:
                act = a
        if act is None:
            raise SystemExit(f"clip {args.clip} not found in {args.clips}: {[a.name for a in bpy.data.actions]}")
        rig.animation_data_create()
        rig.animation_data.action = act
        try:
            if act.slots:
                rig.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        f0, f1 = act.frame_range
        bpy.context.scene.frame_set(int(round(f0 + (f1 - f0) * args.t)))
        name += "." + args.clip
    bpy.context.view_layer.update()
    meshes = [o for o in objs if o.type == 'MESH']
    pts = []
    for o in meshes:
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts += [ev.matrix_world @ me.vertices[i].co for i in range(0, len(me.vertices), 7)]
        ev.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    a = math.radians(args.angle)
    if args.close:
        target = Vector((c.x, c.y, hi.z - 0.17))
        dist = 1.25
        cam.data.lens = 85
    else:
        target = Vector((c.x, c.y, (lo.z + hi.z) / 2))
        dist = max(hi.z - lo.z, 1.0) * 1.3 + 0.8
        cam.data.lens = 50
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.12 * dist))
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = os.path.join(args.out, name + (".face" if args.close else "") + ".png")
    bpy.ops.render.render(write_still=True)
    print("[render]", bpy.context.scene.render.filepath)
