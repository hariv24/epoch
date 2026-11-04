"""Build the street's facade/ground textures (docs/WORLD.md 4.1, 12.2) into epoch/web/static/app/city/world/assets/tex/ (webp, 1K, CC0).

    python3 -I scripts/room/ph_fetch.py texture red_bricks_04 1k            # once per source (cached in build/polyhaven-raw/)
    python3 -I scripts/room/ph_fetch.py texture asphalt_02 1k
    python3 -I scripts/room/ph_fetch.py texture concrete_floor_worn_001 1k
    ~/anaconda3/bin/python -I scripts/world/street_tex.py                   # needs Pillow + numpy; cwebp on PATH

Outputs (all tile in metres, see TILE below; the runtime sets repeat = 1 / tile):
  brick_*      Poly Haven red_bricks_04 (running bond, thin mortar), albedo neutralised so the per-building vertex tint carries the hue
  whitebrick_* the same bond re-lit as white glazed brick (light grey mortar), for the 1910s white apartment houses
  stone_*      procedural ashlar (brownstone / limestone / church): fine grain from concrete_floor_worn_001 + 0.6 m courses, tinted per building
  slate_*      procedural fish-scale slate for the mansards (deterministic, seed 7)
  asphalt_*, sidewalk_*   Poly Haven asphalt_02 / concrete_floor_worn_001
Deterministic: same inputs -> same bytes (fixed seeds).
"""
import json
import os
import subprocess

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "build", "polyhaven-raw")
OUT = os.path.join(ROOT, "epoch", "web", "static", "app", "city", "world", "assets", "tex")
TMP = os.path.join(ROOT, "build", "world-raw", "tex")
N = 1024


def load(aid, kind):
    return np.asarray(Image.open(os.path.join(RAW, aid, f"{aid}_{kind}_1k.jpg")).convert("RGB").resize((N, N), Image.LANCZOS), dtype=np.float32) / 255.0


def save(name, arr, q=82):
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    png = os.path.join(TMP, name + ".png")
    Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)).save(png)
    subprocess.run(["cwebp", "-quiet", "-q", str(q), "-m", "6", png, "-o", os.path.join(OUT, name + ".webp")], check=True)


def normal_from_height(h, strength):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * strength, gy * strength, np.ones_like(h)])     # OpenGL (+Y up)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def main():
    # brick: keep the bond and the brick-to-brick variation, push the mean to a light warm neutral so the vertex tint picks the red
    b = load("red_bricks_04", "diff")
    m = b.reshape(-1, 3).mean(0)
    brick = np.clip(b / m * np.array([0.78, 0.74, 0.72]), 0, 1)
    save("brick_diff", brick)
    bn = load("red_bricks_04", "nor_gl")
    save("brick_nor", bn)
    # white glazed brick: the same bond, bricks bright and even, mortar a light warm grey (the mortar is where the albedo is low and bluish)
    L = lum(b)
    mortar = np.clip((np.percentile(L, 22) - L) * 9.0, 0, 1)
    mortar = np.asarray(Image.fromarray((mortar * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255
    face = 0.9 + (L - L.mean()) * 0.18
    wb = np.dstack([face, face * 0.985, face * 0.96]) * (1 - mortar[..., None]) + np.array([0.62, 0.6, 0.57]) * mortar[..., None]
    save("whitebrick_diff", np.clip(wb, 0, 1))
    # stone ashlar (brownstone / limestone): the fine grain of worn concrete, 0.6 m courses, staggered head joints, slight per-block tone
    rng = np.random.default_rng(11)
    g = lum(load("concrete_floor_worn_001", "diff"))
    g = 0.86 + (g - g.mean()) * 0.55
    yy, xx = np.mgrid[0:N, 0:N] / N                                    # 1 tile = 1.2 m: 2 courses of 0.6 m, blocks 1.2 / 0.6 m wide
    course = np.floor(yy * 2).astype(int)
    off = np.where(course % 2 == 0, 0.0, 0.5)
    blk = np.floor((xx + off) * 1.0 + 0) .astype(int) + course * 7
    tone = rng.uniform(0.95, 1.05, 64)[blk % 64]
    jy = np.minimum(np.abs(yy * 2 - np.round(yy * 2)), 1) / 2 * 1.2   # metres to the nearest bed joint
    jx = np.abs(((xx + off) % 1.0) - np.round((xx + off) % 1.0)) * 1.2
    joint = np.clip(1 - np.minimum(jy, jx) / 0.006, 0, 1)
    stone = g * tone * (1 - 0.35 * joint)
    save("stone_diff", np.dstack([stone, stone, stone]))
    save("stone_nor", normal_from_height(np.asarray(Image.fromarray((np.clip(stone, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float32) / 255 - joint * 0.4, 6.0))
    # fish-scale slate: 1 tile = 0.9 m wide x 0.9 m high, 6 columns x 9 rows (15 cm wide, 10 cm exposure), rounded butts, rows offset by half a scale
    rng = np.random.default_rng(7)
    cols, rows = 6, 9
    sw, sh = N / cols, N / rows
    hgt = np.zeros((N, N), np.float32)
    alb = np.zeros((N, N), np.float32)
    Y, X = np.mgrid[0:N, 0:N].astype(np.float32)
    for r in range(rows + 1):                                          # painted top row first so lower rows (later, nearer the eave) overlap
        y0 = r * sh
        for c in range(-1, cols + 1):
            x0 = c * sw + (r % 2) * sw / 2
            cx, R = x0 + sw / 2, sw / 2
            # a scale: rectangle from y0 - sh down to the round butt at y0 + sh*0.5
            inside = (np.abs(X - cx) <= R - 1.2) & (Y >= y0 - sh) & (((Y - (y0 + sh * 0.5 - R)) <= 0) | ((X - cx) ** 2 + (Y - (y0 + sh * 0.5 - R)) ** 2 <= (R - 1.2) ** 2))
            for dy in (0, N, -N):
                ins = inside if dy == 0 else np.roll(inside, dy, axis=0)
                t = rng.uniform(0.78, 1.0) if dy == 0 else None
                if dy == 0:
                    tt = t
                dist = np.clip((y0 + sh * 0.5 - Y) / (sh * 1.5), 0, 1)        # thick at the butt, thinner up-slope
                if dy:
                    dist = np.roll(dist, dy, axis=0)
                hgt[ins] = 0.4 + 0.6 * (1 - dist[ins])
                alb[ins] = tt * (0.92 + 0.08 * (1 - dist[ins]))
    gap = (hgt == 0)
    alb[gap] = 0.18
    alb = alb * (0.94 + 0.06 * (g[:N, :N] - 0.86) / 0.2)
    slate = np.dstack([alb * 0.98, alb, alb * 1.04])
    save("slate_diff", np.clip(slate, 0, 1))
    save("slate_nor", normal_from_height(np.asarray(Image.fromarray((hgt * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255, 9.0))
    # ground
    save("asphalt_diff", load("asphalt_02", "diff"))
    save("asphalt_nor", load("asphalt_02", "nor_gl"))
    save("sidewalk_diff", load("concrete_floor_worn_001", "diff"))
    save("sidewalk_nor", load("concrete_floor_worn_001", "nor_gl"))
    lic = ["# Street textures (city/world/assets/tex)", "", "| File | Source | Licence |", "|---|---|---|"]
    for f, src in [("brick_*, whitebrick_diff", "red_bricks_04"), ("asphalt_*", "asphalt_02"), ("sidewalk_*, stone grain", "concrete_floor_worn_001")]:
        meta = json.load(open(os.path.join(RAW, src, "meta.json")))
        lic.append(f"| {f} | Poly Haven [{meta['name']}]({meta['url']}) by {', '.join(meta['authors'])} | CC0 |")
    lic.append("| stone_*, slate_* | procedural (scripts/world/street_tex.py), stone grain from concrete_floor_worn_001 | CC0 |")
    lic.append("")
    lic.append("Built by `scripts/world/street_tex.py` (1K webp). Poly Haven assets are CC0 (https://polyhaven.com/license).")
    open(os.path.join(OUT, "LICENSES.md"), "w").write("\n".join(lic) + "\n")
    print("ok", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
