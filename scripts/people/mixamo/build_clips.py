"""Mixamo FBX (Without Skin) -> one clips GLB. blender -b -P scripts/people/mixamo/build_clips.py
Only converts: the FBX armature (mixamorig bones) + one animation per clip, names below. No pose is authored or edited.
Root motion, trimming and retargeting to a character happen at load time in city/people.js (SkeletonUtils.retargetClip).
Output (gitignored, never redistribute): epoch/web/static/app/people/mixamo/clips.glb"""
import bpy, os
SRC = '/Users/harivkannan/Desktop/DOLLA/accotability/maxiamo/'
OUT = '/Users/harivkannan/Desktop/DOLLA/accotability/epoch/web/static/app/people/mixamo/clips.glb'
CLIPS = {  # clip name -> fbx (in-place Locomotion Pack walk for 'walk')
    'typing': 'Typing', 'sit_to_type': 'Sit To Type', 'sit_idle': 'Sitting Idle', 'sit_drink': 'Sitting Drinking',
    'idle': 'Breathing Idle', 'idle_happy': 'Happy Idle', 'stand_to_sit': 'Stand To Sit', 'sit_to_stand': 'Sit To Stand',
    'walk': 'Locomotion Pack/walking', 'walk_root': 'Walking',
    'run': 'Locomotion Pack/running', 'sleep': 'Sleeping Idle', 'lie': 'Laying Sleeping', 'wake': 'Waking',
    # Butler v2 (docs/BUTLER-V2.md §5): seated study + standing break clips
    'writing': 'Writing', 'yawn': 'Yawn', 'arm_stretch': 'Arm Stretching', 'neck_stretch': 'Neck Stretching',
}
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
base = None; acts = {}
for name, f in CLIPS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=SRC + f + '.fbx')
    new = [o for o in bpy.data.objects if o not in before]
    arm = [o for o in new if o.type == 'ARMATURE'][0]
    act = arm.animation_data.action; act.name = name; acts[name] = act
    if base is None:
        base = arm
        for o in new:
            if o is not arm and o.type != 'EMPTY' or o.type == 'MESH': bpy.data.objects.remove(o)
    else:
        arm.animation_data.action = None
        for o in new: bpy.data.objects.remove(o)
# a one-triangle dummy mesh skinned to the Hips, so the exported glTF carries a real skin (three needs a Skeleton as the retarget source)
me = bpy.data.meshes.new('dummy'); me.from_pydata([(0, 0, 0), (0.001, 0, 0), (0, 0.001, 0)], [], [(0, 1, 2)])
dm = bpy.data.objects.new('dummy', me); bpy.context.scene.collection.objects.link(dm)
hips = [b.name for b in base.data.bones if b.name.endswith('Hips')][0]
dm.vertex_groups.new(name=hips).add([0, 1, 2], 1.0, 'REPLACE')
md = dm.modifiers.new('arm', 'ARMATURE'); md.object = base; dm.parent = base
# one NLA strip per clip on the base armature -> exported as separate glTF animations
ad = base.animation_data; ad.action = None
for name, act in acts.items():
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, int(act.frame_range[0]), act); st.name = name
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_force_sampling=True, export_optimize_animation_size=True, export_skins=True, export_apply=False,
                          export_nla_strips_merged_animation_name='')
print('WROTE', OUT, os.path.getsize(OUT))
