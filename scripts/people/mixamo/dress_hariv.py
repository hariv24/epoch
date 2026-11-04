"""Dress Hariv (Dylan, Egunoff LOD man) in the Columbia sweatshirt.
Run:  blender -b -P scripts/people/mixamo/dress_hariv.py -- [in.glb] [out.glb]
(Blender only supplies numpy + mathutils; the glTF is edited directly, so Dylan's spec-gloss materials survive.)
  1. Arthur's "Tops" mesh (maxiamo/characters/arthur_-_lod_man_character.glb) is retargeted per bone from Arthur's bind pose to Hariv's
     (p' = sum w * inv(IBM_hariv[b]) * IBM_arthur[b] * p), keeping Arthur's weights, and replaces all three of Hariv's top meshes.
  2. Its 512 px texture is upscaled to 2048, recoloured Columbia blue #B9D9EB with white piping, and a white serif COLUMBIA arch
     (ImageMagick -distort Arc, ~26 cm wide) is projected onto the front of the chest.
  3. Hariv's Body faces buried under the sweatshirt (torso + sleeves) are dropped so skin can't poke through.
  3b. Trouser faces above the hem + PANTS_KEEP cm that sit inside the sweatshirt (a ray outward hits it) are dropped, so the waistband cannot poke through when seated.
Credit: Arthur - LOD man character, Egunoff, CC-BY 4.0 (Sketchfab)."""
import json, struct, sys, os, zlib, subprocess, tempfile, re
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = '/Users/harivkannan/Desktop/DOLLA/accotability/'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HARIV = args[0] if args else ROOT + 'epoch/web/static/app/people/mixamo/hariv.glb'
OUT = args[1] if len(args) > 1 else HARIV
ARTHUR = ROOT + 'maxiamo/characters/arthur_-_lod_man_character.glb'
FONT = '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'
BLUE = (0x8C, 0xC4, 0xEE); NAVY = (0x1D, 0x3A, 0x6B); WHITE = (0xF4, 0xF4, 0xF2); BLUE_GAIN = 1.0   # the room key light lifts the texture; 0.9 keeps it reading as B9D9EB on screen
TEX = 2048; PXCM = 60; TEXT_W_CM = 26.0; ARC_DEG = 55
CHEST_BELOW_COLLAR = float(os.environ.get('CHEST_DY', 13.0))   # cm below the collar top

# ---------------------------------------------------------------- glb io
def load(p):
    d = open(p, 'rb').read(); l = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + l]); off = 20 + l
    bl = struct.unpack('<I', d[off:off + 4])[0]; return j, bytearray(d[off + 8:off + 8 + bl])
CT = {5120: 'i1', 5121: 'u1', 5122: 'i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(j, b, ai):
    a = j['accessors'][ai]; bv = j['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    stride = bv.get('byteStride') or dt.itemsize * n; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(b, dtype=np.uint8, count=(a['count'] - 1) * stride + dt.itemsize * n, offset=off)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy().view(dt).reshape(a['count'], n)
    if a.get('normalized'): out = out.astype(np.float32) / np.iinfo(dt).max
    return out
def add_view(j, b, data, target=None):
    while len(b) % 4: b.append(0)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': len(b), 'byteLength': len(data), **({'target': target} if target else {})}); b.extend(data)
    return len(j['bufferViews']) - 1
def add_acc(j, b, arr, ctype, typ, target=None, minmax=False):
    arr = np.ascontiguousarray(arr, dtype=CT[ctype]); bv = add_view(j, b, arr.tobytes(), target)
    a = {'bufferView': bv, 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    j['accessors'].append(a); return len(j['accessors']) - 1
def save(j, b, p):
    j['buffers'][0]['byteLength'] = len(b); js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(b) % 4: b.append(0)
    open(p, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(b)) + struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(b)) + b'BIN\x00' + bytes(b))
norm = lambda n: re.sub(r'^mixamorig\d*[:_]?', '', re.sub(r'_\d+$', '', n))
def skin_info(j, b):
    s = j['skins'][0]; names = [norm(j['nodes'][x]['name']) for x in s['joints']]
    return names, read(j, b, s['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)   # row-major IBMs
def png(rgb):
    h, w, _ = rgb.shape; raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    ck = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ck(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ck(b'IDAT', zlib.compress(raw, 9)) + ck(b'IEND', b'')

# ---------------------------------------------------------------- inputs
hj, hb = load(HARIV); aj, ab = load(ARTHUR)
hn, hibm = skin_info(hj, hb); an, aibm = skin_info(aj, ab)
hidx = {n: i for i, n in enumerate(hn)}; assert set(an) <= set(hn), set(an) - set(hn)
jmap = np.array([hidx[n] for n in an])
amat = next(m for m in aj['materials'] if m['name'] == 'Topmat'); atm = [i for i, m in enumerate(aj['meshes']) if aj['materials'][m['primitives'][0]['material']]['name'] == 'Topmat']
assert len(atm) == 1; ap = aj['meshes'][atm[0]]['primitives'][0]; at = ap['attributes']
P = read(aj, ab, at['POSITION']).astype(np.float64); N = read(aj, ab, at['NORMAL']).astype(np.float64); UV = read(aj, ab, at['TEXCOORD_0']).astype(np.float64)
J = read(aj, ab, at['JOINTS_0']).astype(int); W = read(aj, ab, at['WEIGHTS_0']).astype(np.float64); IDX = read(aj, ab, ap['indices']).reshape(-1, 3).astype(int)
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)

# ---------------------------------------------------------------- 1. retarget Arthur's top onto Hariv's bind pose
M = np.einsum('kij,kjl->kil', np.linalg.inv(hibm[jmap]), aibm)         # [arthur joint] -> 4x4 into Hariv's rest pose
Mv = M[J]                                                              # N,4,4,4
ph = np.concatenate([P, np.ones((len(P), 1))], 1)
P2 = np.einsum('nk,nkij,nj->ni', W, Mv, ph)[:, :3]
N2 = np.einsum('nk,nkij,nj->ni', W, Mv[:, :, :3, :3], N); N2 /= np.linalg.norm(N2, axis=1, keepdims=True)
J2 = jmap[J]
print('top before y', P[:, 1].min(), P[:, 1].max(), 'x', P[:, 0].min(), P[:, 0].max(), '-> after y', P2[:, 1].min(), P2[:, 1].max(), 'x', P2[:, 0].min(), P2[:, 0].max())
GIRTH = float(os.environ.get('GIRTH', 1.05))
if GIRTH != 1.0:       # optional: thicken/slim the torso (not the sleeves) around the spine line
    tor = np.abs(P2[:, 0]) < 25; c = np.array([0.0, 0, -2.0])
    P2[tor, 0] = P2[tor, 0] * GIRTH; P2[tor, 2] = (P2[tor, 2] - c[2]) * GIRTH + c[2]
if float(os.environ.get('DZ', 2.0)):   # Dylan's belly/pants sit ~1.5 cm further forward than Arthur's: shift the lower torso forward, fading out by the chest
    tor = np.abs(P2[:, 0]) < 25; P2[tor, 2] += float(os.environ.get('DZ', 2.0)) * np.clip((135 - P2[tor, 1]) / 35, 0, 1)
torso = np.abs(P2[:, 0]) < 22
tor = np.abs(P2[:, 0]) < 25; h0 = P2[tor, 1].min()   # lengthen + flare the hem 3 cm so no trouser shows above it
fall = np.clip((h0 + 14 - P2[tor, 1]) / 14, 0, 1); P2[tor, 1] -= 3.0 * fall; P2[tor, 0] *= 1 + 0.03 * fall; P2[tor, 2] = (P2[tor, 2] + 1.0) * (1 + 0.03 * fall) - 1.0
bk = (np.abs(P2[:, 0]) < 25) & (P2[:, 2] < -2); P2[bk, 2] -= 1.5 * np.clip(1 - np.abs(P2[bk, 1] - 96) / 10, 0, 1) * np.exp(-(P2[bk, 0] / 9) ** 2)   # trouser waist sliver showed through the lower back
torso = np.abs(P2[:, 0]) < 22
collar = P2[np.abs(P2[:, 0]) < 12, 1].max(); hem = P2[torso, 1].min(); sleeve = np.abs(P2[:, 0]).max()
print('collar', collar, 'hem', hem, 'sleeve end', sleeve)

# ---------------------------------------------------------------- 2. texture
aimg = aj['images'][aj['textures'][amat['pbrMetallicRoughness']['baseColorTexture']['index'] if 'pbrMetallicRoughness' in amat else amat['extensions']['KHR_materials_pbrSpecularGlossiness']['diffuseTexture']['index']]['source']]
bv = aj['bufferViews'][aimg['bufferView']]; tmp = tempfile.mkdtemp(); open(tmp + '/a.png', 'wb').write(bytes(ab[bv['byteOffset']:bv['byteOffset'] + bv['byteLength']]))
subprocess.check_call(['magick', tmp + '/a.png', '-alpha', 'off', '-colorspace', 'sRGB', '-filter', 'Lanczos', '-resize', f'{TEX}x{TEX}!', '-depth', '8', 'gray:' + tmp + '/a.gray'])
lum = np.fromfile(tmp + '/a.gray', dtype=np.uint8).reshape(TEX, TEX).astype(np.float64) / 255
lo, hi = np.percentile(lum, 5), np.percentile(lum, 95); print('lum lo/hi', lo, hi)
t = np.clip((lum - (lo + hi) / 2 + 0.12) / 0.24, 0, 1); t = t * t * (3 - 2 * t)           # 0 = piping, 1 = fabric
shade = np.clip(lum / max(hi, 1e-6), 0.92, 1.04)[..., None]
img = (np.array(WHITE)[None, None] * (1 - t[..., None]) + np.array(BLUE)[None, None] * BLUE_GAIN * shade * t[..., None])
# decal mask
mw = int(TEXT_W_CM * PXCM)
subprocess.check_call(['magick', '-background', 'black', '-fill', 'white', '-font', FONT, '-pointsize', '300', '-kerning', '14', 'label:COLUMBIA', '-trim', '+repage',
                       '-virtual-pixel', 'black', '-distort', 'Arc', str(ARC_DEG), '-trim', '+repage', '-resize', f'{mw}x', '-depth', '8', tmp + '/m.pgm'])
hd = open(tmp + '/m.pgm', 'rb').read(); mt = hd.split(b'\n', 3); mh = int(mt[1].split()[1]); mask = np.frombuffer(mt[3], dtype=np.uint8).reshape(mh, mw).astype(np.float64) / 255
print('decal px', mw, mh, 'cm h', mh / PXCM)
cx, cy = float(np.median(P2[torso & (P2[:, 2] > 0), 0]) * 0), collar - CHEST_BELOW_COLLAR
alpha = np.zeros((TEX, TEX))
fn = np.cross(P2[IDX[:, 1]] - P2[IDX[:, 0]], P2[IDX[:, 2]] - P2[IDX[:, 0]]); fnn = N2[IDX].sum(1)
for f, tri in enumerate(IDX):
    if fnn[f, 2] < 0.3 or np.abs(P2[tri, 0]).max() > 20: continue          # front-facing torso only
    uv = UV[tri] * TEX; x0, y0 = np.floor(uv.min(0)).astype(int) - 1; x1, y1 = np.ceil(uv.max(0)).astype(int) + 1
    xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, TEX)), np.arange(max(y0, 0), min(y1, TEX))); q = np.stack([xs + 0.5, ys + 0.5], -1).reshape(-1, 2)
    A = np.array([[uv[1, 0] - uv[0, 0], uv[2, 0] - uv[0, 0]], [uv[1, 1] - uv[0, 1], uv[2, 1] - uv[0, 1]]])
    if abs(np.linalg.det(A)) < 1e-9: continue
    l12 = np.linalg.solve(A, (q - uv[0]).T).T; l = np.concatenate([1 - l12.sum(1, keepdims=True), l12], 1); ok = (l > -0.02).all(1)
    if not ok.any(): continue
    pos = l[ok] @ P2[tri]; mu = (pos[:, 0] - cx) * PXCM + mw / 2; mv = (cy - pos[:, 1]) * PXCM + mh / 2
    inside = (mu >= 0) & (mu < mw - 1) & (mv >= 0) & (mv < mh - 1)
    ui = np.floor(mu[inside]).astype(int); vi = np.floor(mv[inside]).astype(int); fu = mu[inside] - ui; fv = mv[inside] - vi
    a = mask[vi, ui] * (1 - fu) * (1 - fv) + mask[vi, ui + 1] * fu * (1 - fv) + mask[vi + 1, ui] * (1 - fu) * fv + mask[vi + 1, ui + 1] * fu * fv
    sel = np.flatnonzero(ok)[inside]; qq = q[sel].astype(int); alpha[qq[:, 1], qq[:, 0]] = np.maximum(alpha[qq[:, 1], qq[:, 0]], a)
ol = np.zeros_like(alpha); R = 2.5   # navy outline ~2.5 px at 2048
for dy in range(-3, 4):
    for dx in range(-3, 4):
        if dx * dx + dy * dy <= R * R + 0.5: ol = np.maximum(ol, np.roll(np.roll(alpha, dy, 0), dx, 1))
img = img * (1 - ol[..., None]) + np.array(NAVY)[None, None] * ol[..., None]
img = img * (1 - alpha[..., None]) + np.array(WHITE)[None, None] * alpha[..., None]
rgb = np.clip(img + 0.5, 0, 255).astype(np.uint8)
open(os.path.dirname(OUT) + '/sweat_tex.png' if os.environ.get('DEBUG_TEX') else os.devnull, 'wb').write(png(rgb))
pngb = png(rgb); print('png bytes', len(pngb))

# ---------------------------------------------------------------- 3. drop buried body faces
bvh = BVHTree.FromPolygons([Vector(v) for v in P2], [tuple(t) for t in IDX])
ARM = {'LeftArm', 'LeftForeArm', 'LeftShoulder', 'RightArm', 'RightForeArm', 'RightShoulder'}; TOR = {'Hips', 'Spine', 'Spine1', 'Spine2'}
def strip_body(mi):
    pr = hj['meshes'][mi]['primitives'][0]; pos = read(hj, hb, pr['attributes']['POSITION']).astype(np.float64); jn = read(hj, hb, pr['attributes']['JOINTS_0']).astype(int); wt = read(hj, hb, pr['attributes']['WEIGHTS_0'])
    dom = np.array([hn[jn[i, np.argmax(wt[i])]] for i in range(len(pos))]); cov = np.zeros(len(pos), bool)
    for i in np.flatnonzero(np.isin(dom, list(ARM | TOR))):
        v = pos[i]
        if dom[i] in ARM: if_ok = abs(v[0]) < sleeve - 1.2
        else: if_ok = hem + 1.0 < v[1] < collar - 1.5
        if not if_ok: continue
        loc, nrm, k, d = bvh.find_nearest(Vector(v))
        if loc is not None and d < 7.0: cov[i] = True
    ix = read(hj, hb, pr['indices']).reshape(-1, 3).astype(int); keep = ~cov[ix].all(1)
    print('body mesh', mi, 'faces', len(ix), '-> kept', int(keep.sum()))
    pr['indices'] = add_acc(hj, hb, ix[keep].astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
PANTS_KEEP = float(os.environ.get('PANTS_KEEP', 3.0))   # cm of trouser kept under the hem, so no gap opens when the hem rides up
def strip_pants(mi):   # 3b. the trouser waistband under the sweatshirt: seated, the hips bend and it poked through the lower back (Butler v3 fix)
    pr = hj['meshes'][mi]['primitives'][0]; pos = read(hj, hb, pr['attributes']['POSITION']).astype(np.float64); cov = np.zeros(len(pos), bool)
    for i in np.flatnonzero(pos[:, 1] > hem + PANTS_KEEP):
        v = pos[i]; d = Vector((v[0], 0.0, v[2] + 2.0))
        if d.length < 1e-6: continue
        d.normalize(); loc, nrm, k, dist = bvh.ray_cast(Vector(v), d, 12.0)
        if loc is not None: cov[i] = True
    ix = read(hj, hb, pr['indices']).reshape(-1, 3).astype(int); keep = ~cov[ix].all(1)
    print('pants mesh', mi, 'faces', len(ix), '-> kept', int(keep.sum()), 'top y', round(pos[:, 1].max(), 1), 'hem', round(hem, 1))
    pr['indices'] = add_acc(hj, hb, ix[keep].astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
bodymat = [i for i, m in enumerate(hj['materials']) if m['name'] == 'Bodymat'][0]; topmat = [i for i, m in enumerate(hj['materials']) if m['name'] == 'Topmat'][0]
pantmat = [i for i, m in enumerate(hj['materials']) if m['name'] == 'Bottommat'][0]
for mi, m in enumerate(hj['meshes']):
    pr = m['primitives'][0]
    if pr['material'] == bodymat and hj['accessors'][pr['indices']]['count'] > 6000: strip_body(mi)
    if pr['material'] == pantmat and 'JOINTS_0' in pr['attributes']: strip_pants(mi)

# ---------------------------------------------------------------- 4. write the new top into the first Topmat mesh; the other two LOD nodes share it
tops = [i for i, m in enumerate(hj['meshes']) if m['primitives'][0]['material'] == topmat]; print('old top meshes', tops)
tex = {'bufferView': add_view(hj, hb, pngb), 'mimeType': 'image/png'}; hj['images'].append(tex)
hj['samplers'] = hj.get('samplers') or [{}]; hj['textures'].append({'sampler': 0, 'source': len(hj['images']) - 1})
hj['materials'].append({'name': 'Sweatshirt', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': len(hj['textures']) - 1}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0}})
prim = {'attributes': {'POSITION': add_acc(hj, hb, P2, 5126, 'VEC3', 34962, True), 'NORMAL': add_acc(hj, hb, N2, 5126, 'VEC3', 34962), 'TEXCOORD_0': add_acc(hj, hb, UV, 5126, 'VEC2', 34962),
                       'JOINTS_0': add_acc(hj, hb, J2, 5123, 'VEC4', 34962), 'WEIGHTS_0': add_acc(hj, hb, W, 5126, 'VEC4', 34962)},
        'indices': add_acc(hj, hb, IDX.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), 'material': len(hj['materials']) - 1, 'mode': 4}
hj['meshes'][tops[0]] = {'name': 'Tops_Sweatshirt', 'primitives': [prim]}
for n in hj['nodes']:
    if n.get('mesh') in tops: n['mesh'] = tops[0]
for m in tops[1:]: hj['meshes'][m] = {'name': 'unused', 'primitives': [{'attributes': {'POSITION': hj['meshes'][tops[0]]['primitives'][0]['attributes']['POSITION']}, 'mode': 0}]}
hj['asset'].setdefault('extras', {})['sweatshirt'] = 'Tops mesh from "Arthur - LOD man character" by Egunoff (CC-BY-4.0, https://sketchfab.com/egunoff), retargeted and recoloured'
save(hj, hb, OUT); print('wrote', OUT, os.path.getsize(OUT))

# ---------------------------------------------------------------- diagnostics: shirt vs pants / body extents per height band (cm)
if os.environ.get('DIAG'):
    j2, b2 = load(OUT)
    def verts(mat):
        out = []
        for m in j2['meshes']:
            pr = m['primitives'][0]
            if j2['materials'][pr.get('material', 0)]['name'] == mat and 'JOINTS_0' in pr['attributes']: out.append(read(j2, b2, pr['attributes']['POSITION']))
        return max(out, key=len)
    sh = verts('Sweatshirt'); pa = verts('Bottommat'); bo = verts('Bodymat')
    for y in range(80, 156, 6):
        f = lambda v, lim=30: v[(np.abs(v[:, 1] - y) < 2) & (np.abs(v[:, 0]) < lim)]
        r = lambda v: ('x %.1f..%.1f z %.1f..%.1f' % (v[:, 0].min(), v[:, 0].max(), v[:, 2].min(), v[:, 2].max())) if len(v) else '-'
        print('y', y, 'shirt', r(f(sh)), '| pants', r(f(pa)), '| body', r(f(bo)))
