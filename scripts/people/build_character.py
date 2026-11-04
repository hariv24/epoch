"""Build one character (one outfit) and export its LOD GLBs.

  blender -b -P scripts/people/build_character.py -- --id user --outfit everyday
  blender -b -P scripts/people/build_character.py -- --id npc_maya
Writes epoch/web/static/app/people/<user|npc>/... and a build record in build/people-work/records/.
"""
import sys, os, json, argparse, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import specs
import build_lib as L

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "build", "people-work", "glb")   # uncompressed; build_all.sh meshopt-compresses into epoch/web/static/app/people/
WORK = os.path.join(ROOT, "build", "people-work")

ap = argparse.ArgumentParser()
ap.add_argument("--id", required=True)
ap.add_argument("--outfit", default=None)
ap.add_argument("--lods", default="close,mid,far")
ap.add_argument("--blend", action="store_true", help="also save the built .blend (for renders/debugging)")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])

t0 = time.time()
if args.id == "user":
    spec = specs.USER
    outfit = args.outfit or "everyday"
    items = specs.OUTFITS[outfit]
    budgets = specs.LODS["user"]
    stem = os.path.join("user", outfit)
else:
    spec = next(n for n in specs.NPCS if n["id"] == args.id)
    items = list(spec["clothes"]) + list(spec.get("acc", []))
    budgets = specs.LODS["npc"]
    outfit = None
    stem = os.path.join("npc", spec["id"])

# split: MPFB clothes assets vs. generated accessories
clothes, generated = [], []
for it in items:
    if isinstance(it, tuple):
        clothes.append(it)
        continue
    kind, *rest = it.split(":")
    if kind in ("glasses",):
        clothes.append((rest[0], {"rough": 0.3}))
    elif kind in ("cap", "beard"):
        clothes.append((rest[0], {"tint": rest[1]} if len(rest) > 1 else {}))
    else:
        generated.append((kind, rest[0]))

rig, basemesh = L.build_human(spec, clothes, WORK)
bone_names = {b.name for b in rig.data.bones}

# bake the phenotype first so accessories measure the final body
L.activate(basemesh)
if basemesh.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
acc_objs = []
for kind, color in generated:
    fn = {"scarf": L.make_scarf, "backpack": L.make_backpack, "headphones": L.make_headphones}[kind]
    acc_objs.append(fn(rig, basemesh, color))
L.clean_body(basemesh)

tag = (spec["id"] + ("_" + outfit if outfit else ""))
texdir = os.path.join(WORK, "tex", tag)
parts = L.process_materials(rig, spec, clothes, texdir, tag, skip=acc_objs)
for o in acc_objs:
    parts.append((o, "accessory", {"accessory": True, "opts": {}, "albedo": None}))

for obj, role, info in parts:
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            L.activate(obj)
            bpy.ops.object.modifier_apply(modifier=m.name)
    L.strip_vgroups(obj, bone_names)
    if info.get("opts", {}).get("relax_chest"):
        L.relax_cloth_chest(obj)
    if info.get("opts", {}).get("loose"):
        L.loosen_cloth(obj)
    if info.get("opts", {}).get("inflate"):            # cloth thickness: stops the body poking through at the shoulder blades and armpits
        for v in obj.data.vertices:
            v.co += v.normal * info["opts"]["inflate"]
    if info.get("albedo_sleeve") is not None:
        L.split_sleeves(obj, {b for b in bone_names if b.startswith(("upperarm", "lowerarm", "hand"))}, rig)
    L.triangulate(obj)

body = next(p[0] for p in parts if p[1] == "body")
cover = [p[0] for p in parts if p[1] == "clothes" and not ("glasses" in p[2]["opts"].get("asset", ""))]
print(f"[build] {spec['id']}: hid {L.hide_covered_body(body, cover)} covered body faces")
for p in parts:
    if p[1] == "clothes" and p[2]["opts"].get("short_sleeves"):
        print(f"[build] hid {L.hide_sleeve_arm(body, p[0])} arm faces inside the sleeves")
# layered clothes: faces of inner garments under an 'outer' one (coat over sweater, cardigan over tee) go too
outer = [p[0] for p in parts if p[1] == "clothes" and p[2]["opts"].get("outer")]
for p in parts:
    if p[1] == "clothes" and p[0] not in outer and not any(w in p[2]["opts"].get("asset", "") for w in L.SHOE_WORDS + ("glasses", "hat", "cap", "beard", "pants", "jeans", "trouser", "skirt", "short", "trunks")):
        if outer:
            print(f"[build] {p[0].name}: hid {L.hide_covered_body(p[0], outer, max_dist=0.06)} faces under the outer layer")
L.ground_and_center(rig, [p[0] for p in parts])
height = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o, r, i in parts if r == "body")
hip = rig.data.bones["pelvis"].head_local.z
record = {"id": spec["id"], "outfit": outfit, "name": spec.get("name"), "role": "user" if args.id == "user" else "npc",
          "height_m": round(height, 3), "hip_height_m": round(hip, 3), "lods": {}, "parts": {}}
for obj, role, info in parts:
    record["parts"][obj.name] = role

full_tris = L.total_tris([p[0] for p in parts])
print(f"[build] {tag}: built in {time.time() - t0:.1f}s, full res {full_tris} tris, height {height:.3f} m")

if args.blend:
    os.makedirs(os.path.join(WORK, "blend"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "blend", tag + ".blend"))

full = {p[0].name: p[0].data.copy() for p in parts}      # every LOD decimates from the full-res meshes
for lod in args.lods.split(","):
    budget, texsize = budgets[lod]
    for p in parts:
        old = p[0].data
        p[0].data = full[p[0].name].copy()
        if old.users == 0:
            bpy.data.meshes.remove(old)
    if lod in ("mid", "far"):
        drop = {"eyelashes"} if lod == "mid" else {"eyelashes", "eyebrows", "eyes"}
        keep = []
        for p in parts:
            if p[1] in drop:
                bpy.data.objects.remove(p[0], do_unlink=True)
            else:
                keep.append(p)
        parts = keep
    tris = L.fit_budget(parts, budget, protect_head=(lod != "far"))
    L.assign_materials(parts, texsize, texdir, f"{tag}_{lod}", keep_normals=(lod == "close"))
    path = os.path.join(OUT, f"{stem}.{lod}.glb")
    size = L.export_glb(rig, [p[0] for p in parts], path)
    record["lods"][lod] = {"file": os.path.relpath(path, OUT), "tris": tris, "bytes": size, "texture_px": texsize}
    print(f"[build] {tag} {lod}: {tris} tris, {size / 1024:.0f} KB")
    if args.blend and lod == "close":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "blend", tag + ".close.blend"))

os.makedirs(os.path.join(WORK, "records"), exist_ok=True)
with open(os.path.join(WORK, "records", tag + ".json"), "w") as f:
    json.dump(record, f, indent=1)
print(f"[build] {tag} done in {time.time() - t0:.1f}s")
