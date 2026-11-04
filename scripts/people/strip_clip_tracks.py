"""Post-process the clips GLB: keep only rotation tracks (+ the pelvis translation).

Translation/scale tracks of the reference skeleton would force its bone lengths onto every other body, so they go.
Run with plain python (no Blender):  python -I scripts/people/strip_clip_tracks.py build/people-work/glb/clips.glb
Unused accessors are pruned later by `gltf-transform meshopt`.
"""
import json, struct, sys

path = sys.argv[1]
b = open(path, "rb").read()
magic, ver, _ = struct.unpack("<III", b[:12])
jl, jt = struct.unpack("<II", b[12:20])
j = json.loads(b[20:20 + jl])
rest = b[20 + jl:]
names = {i: n.get("name") for i, n in enumerate(j["nodes"])}
kept = removed = 0
for anim in j.get("animations", []):
    chans, samplers, remap = [], [], {}
    for c in anim["channels"]:
        t = c["target"]
        keep = t["path"] == "rotation" or (t["path"] == "translation" and names.get(t.get("node")) == "pelvis")
        if not keep:
            removed += 1
            continue
        si = c["sampler"]
        if si not in remap:
            remap[si] = len(samplers)
            samplers.append(anim["samplers"][si])
        c["sampler"] = remap[si]
        chans.append(c)
        kept += 1
    anim["channels"], anim["samplers"] = chans, samplers
js = json.dumps(j, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
out = struct.pack("<II", len(js), 0x4E4F534A) + js + rest
open(path, "wb").write(struct.pack("<III", magic, ver, 12 + len(out)) + out)
print(f"[strip] {path}: kept {kept} channels, removed {removed}")
