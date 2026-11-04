"""Free placement in the home (docs/COZY.md 4.2): the room geometry, the placement rules and the move from the old fixed slots.

Pure functions, no database. `economy.py` stores what comes out of here in `econ_choice` key `layout`.

The room numbers in ROOMS mirror `LAYOUTS` in `static/app/city/room.js` (a test compares them with the JavaScript, so they cannot drift).
Coordinates are the room's own, in metres: x runs east (the window wall is at the back, z = -D/2), z runs toward the viewer, the
floor is y = 0. The front wall (z = +D/2) and the right wall (x = +W/2) are cut away, so the SOLID walls a picture can hang on are:

    n   the back (window) wall, facing +z, along x
    w   the left wall, facing +x, along z
    p   the one-bedroom's partition (its east face), facing +x, along z

A layout entry is one of

    floor: {"id", "surface": "floor", "x", "z", "ry"}         x, z = the CENTRE of the footprint; ry = turn in radians (0 = facing +z)
    wall:  {"id", "surface": "wall", "wall": "n|w|p", "u", "y"}    u = 0..1 along the wall, y = height of the picture's bottom edge

The footprint of a floor piece is its catalog `size` [w, d, h] turned by ry (collisions use the bounding box of the turned footprint).
Rugs (`layer: 'under'`) only collide with other rugs, and a hanging light (`layer: 'over'`) only with other hanging lights.
The client snaps to a 0.25 m grid; the server only rounds (x, z to 1 cm, ry to 1 mrad), so migrated positions are kept exactly.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

from . import economy_catalog as cat

GRID = 0.25
EPS = 0.01                 # two boxes that overlap by less than this (m) are just touching
BOUNDS_EPS = 0.03          # a footprint may poke this far past a wall (model clearance)
WALL_NEAR = 0.12           # a tall floor piece this close to a wall hides what hangs there
WALL_Y_MIN = 0.3
WALL_TOP_GAP = 0.1
HALF_PI = math.pi / 2


def _slot(x: float, z: float, ry: float, wall: bool) -> dict[str, Any]:
    return {"x": x, "z": z, "ry": ry, "wall": wall}


# Mirrors LAYOUTS in room.js. `slots` are the OLD fixed slots (only the migration and the old room view use them).
ROOMS: dict[str, dict[str, Any]] = {
    "studio": {
        "W": 5.0, "D": 4.0, "H": 2.9, "label": "Studio",
        "windows": [{"x0": 0.1, "x1": 1.6, "y0": 0.85, "y1": 2.45}],
        "bed": {"x": -1.75, "z": -1.0, "ry": 0.0, "w": 1.35, "l": 2.0},
        "kitchen": {"x0": -2.5, "x1": -1.92, "z0": 0.55, "z1": 1.95},
        "slots": [_slot(2.05, -2, 0, True), _slot(-0.45, -2, 0, True), _slot(1.7, 0.9, -0.6, False), _slot(0.35, 0.35, 0, False)],
        "stand": {"x": 0.85, "z": -1.35},
    },
    "1-bed": {
        "W": 7.0, "D": 5.0, "H": 3.0, "label": "One-bedroom",
        "windows": [{"x0": -0.2, "x1": 1.2, "y0": 0.85, "y1": 2.5}, {"x0": 2.0, "x1": 3.2, "y0": 0.85, "y1": 2.5},
                    {"x0": -3.0, "x1": -2.1, "y0": 1.0, "y1": 2.4}],
        "partition": {"x": -1.0, "z0": -2.5, "z1": 0.6, "door": [-0.7, 0.25]},
        "bed": {"x": -2.5, "z": -1.5, "ry": 0.0, "w": 1.5, "l": 2.0},
        "slots": [_slot(1.6, -2.5, 0, True), _slot(3.45, -2.5, 0, True), _slot(-0.95, -1.7, HALF_PI, True),
                  _slot(-3.5, 0.95, HALF_PI, True), _slot(1.1, 0.7, 0, False), _slot(2.75, 1.25, -0.5, False)],
        "stand": {"x": 0.5, "z": -1.85},
    },
    "loft": {
        "W": 9.0, "D": 6.0, "H": 3.8, "label": "Loft",
        "windows": [{"x0": -1.6, "x1": -0.4, "y0": 0.7, "y1": 3.25}, {"x0": 0.8, "x1": 2.0, "y0": 0.7, "y1": 3.25},
                    {"x0": 3.2, "x1": 4.3, "y0": 0.7, "y1": 3.25}],
        "columns": [[-1.0, 0.6], [2.4, 0.6]],
        "bed": {"x": -3.4, "z": -1.95, "ry": 0.0, "w": 1.7, "l": 2.1, "platform": True},
        "slots": [_slot(0.2, -3, 0, True), _slot(2.6, -3, 0, True), _slot(-2.05, -3, 0, True), _slot(-4.5, 0.5, HALF_PI, True),
                  _slot(-4.5, 2.1, HALF_PI, True), _slot(-1.6, 1.6, 0.3, False), _slot(0.8, 1.9, 0, False), _slot(3.3, 1.5, -0.4, False)],
        "stand": {"x": 1.4, "z": -2.35},
    },
    "penthouse": {
        "W": 12.0, "D": 7.0, "H": 4.2, "label": "Penthouse", "glass_wall": True,
        "windows": [{"x0": -5.9, "x1": 5.9, "y0": 0.06, "y1": 4.1}],
        "bed": {"x": -4.85, "z": 2.2, "ry": HALF_PI, "w": 1.9, "l": 2.2},
        "island": {"x": 3.7, "z": 2.6},
        "slots": [_slot(-4.0, -3.15, 0, False), _slot(-1.8, -3.15, 0, False), _slot(0.6, -3.15, 0, False), _slot(2.7, -3.15, 0, False),
                  _slot(4.9, -3.15, 0, False), _slot(-6, -2.2, HALF_PI, True), _slot(-6, -0.3, HALF_PI, True),
                  _slot(-2.6, 0.6, 0.2, False), _slot(0.2, 0.9, 0, False), _slot(2.6, 0.4, -0.3, False), _slot(-1.2, 2.7, 0, False),
                  _slot(5.0, 0.4, -0.6, False)],
        "stand": {"x": -0.6, "z": -2.55},
    },
}

# 124 W 123rd St parlour floor (docs/ROOM-V2.md 16.1): interior 4.60 m wide (0.29 m party walls) x 13.80 m deep (0.42 m front and rear
# walls), ceiling 3.45. Street windows 1.00 x 2.45 m, sill 0.50, centres x -1.45 and +0.25; garden windows the same, centres x -1.1 / +1.1.
_BROWN_WIN = ([{"wall": "n", "x0": c - 0.5, "x1": c + 0.5, "y0": 0.5, "y1": 2.95} for c in (-1.45, 0.25)]
              + [{"wall": "s", "x0": c - 0.5, "x1": c + 0.5, "y0": 0.5, "y1": 2.95} for c in (-1.1, 1.1)])

# Homes with their own room shape (docs/ROOM-V2.md 16.1). Same frame as ROOMS: x centred across W, z centred across D, -z = the street
# (window) wall, -x = the west wall. `dividers` are 15 cm cross walls at z with one opening [x0, x1] (optionally spanning only [x0, x1]
# of the width); `hall` is the 15 cm wall along the stair-hall strip (x = 1.10 from the front wall back to z = +1.0, one door);
# `keepouts` are fixed things and door swings no floor piece may stand in. Every other home uses its size tier's room.
ROOMS_BY_HOME: dict[str, dict[str, Any]] = {
    "harlem-floorthrough": {
        "size": "1-bed", "rev": 2, "word": "one-bedroom",
        "W": 4.6, "D": 13.8, "H": 3.45, "label": "Brownstone floor-through",
        "windows": _BROWN_WIN,
        "dividers": [{"id": "d1", "z": -1.4, "t": 0.15, "x0": -2.3, "x1": 1.1, "opening": [-1.5, 0.3], "open_h": 2.7},
                     {"id": "d2", "z": 1.9, "t": 0.15, "opening": [-1.46, -0.54], "open_h": 2.1}],
        "hall": {"id": "h", "x": 1.1, "t": 0.15, "z0": -6.9, "z1": 1.0, "door": [-0.75, 0.15], "door_h": 2.2},
        "keepouts": [
            {"id": "stair_hall", "x0": 1.1, "x1": 2.3, "z0": -6.9, "z1": 1.0},
            {"id": "kitchen", "x0": -2.3, "x1": -1.68, "z0": -1.3, "z1": 1.3},
            {"id": "fireplace", "x0": -2.3, "x1": -1.85, "z0": -5.02, "z1": -3.38},
            {"id": "front_door", "x0": 0.2, "x1": 1.1, "z0": -0.75, "z1": 0.15},
            {"id": "bath", "x0": 0.1, "x1": 1.1, "z0": 0.4, "z1": 1.9},
            {"id": "bath_nook", "x0": 1.1, "x1": 2.3, "z0": 1.0, "z1": 1.9},
            {"id": "bedzone", "x0": -0.45, "x1": 1.95, "z0": 1.975, "z1": 4.2},
            {"id": "closet", "x0": -2.3, "x1": -1.6, "z0": 3.75, "z1": 5.25},
        ],
        "wall_blocks": {"w": [(-5.02, -3.38, 0.0, 3.45), (-1.3, 1.3, 0.0, 3.45), (3.75, 5.25, 0.0, 2.4)],
                        "e": [(-6.9, 1.0, 0.0, 3.45)]},
        "bed": {"x": 0.45, "z": 3.025, "ry": 0.0, "w": 1.7, "l": 2.1},
        "study": {"item": "desk_setup", "x": -1.45, "ry": 0.0},
        "slots": [_slot(-0.6, -6.9, 0, True), _slot(-1.45, -6.3, 0, False), _slot(0.5, -3.0, 0.4, False), _slot(-0.6, -2.2, 0, False),
                  _slot(-0.9, 0.6, 0, False), _slot(-0.6, 2.9, 0, False)],
        "stand": {"x": 0.25, "z": -5.8},
    },
}

SIZE_WORD = {"studio": "studio", "1-bed": "one-bedroom", "loft": "loft", "penthouse": "penthouse"}


class LayoutError(Exception):
    """A calm refusal of a placement. `index` is the position in the submitted list (None for the layout as a whole)."""

    def __init__(self, code: str, hint: str, index: int | None = None, item: str | None = None, **extra: Any) -> None:
        super().__init__(hint)
        self.code, self.hint, self.index, self.item, self.extra = code, hint, index, item, extra

    def as_dict(self) -> dict[str, Any]:
        out = {"code": self.code, "hint": self.hint, **self.extra}
        if self.index is not None:
            out["index"] = self.index
        if self.item:
            out["item"] = self.item
        return out


# --------------------------------------------------------------------------
# The room: walls, fixed furniture
# --------------------------------------------------------------------------

def room_for(home_id: str, size: str) -> str:
    """The room key to use for a home: its own id when it has a custom shape, else its size tier. Pass this to every function here."""
    return home_id if home_id in ROOMS_BY_HOME else size


def room_marker(key: str) -> str:
    return f"{key}/{ROOMS_BY_HOME[key]['rev']}"


def room(size: str) -> dict[str, Any]:
    return ROOMS_BY_HOME.get(size) or ROOMS.get(size) or ROOMS["studio"]


def _divider_solids(rm: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for dv in rm.get("dividers") or []:
        o0, o1 = dv["opening"]
        for a0, a1 in ((dv.get("x0", -rm["W"] / 2), o0), (o1, dv.get("x1", rm["W"] / 2))):
            if a1 - a0 > 0.01:
                out.append({"kind": "divider", "x0": a0, "x1": a1, "z0": dv["z"] - dv["t"] / 2, "z1": dv["z"] + dv["t"] / 2})
    return out


def walls(rm: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The solid walls a picture can hang on: axis, extent [lo, hi] along it, the plane it sits in, the way it faces and what is
    already on it (windows, a kitchen, a door) as blocked rectangles [a0, a1] x [y0, y1]."""
    W, D, H = rm["W"], rm["D"], rm["H"]
    out: dict[str, dict[str, Any]] = {
        "n": {"axis": "x", "lo": -W / 2, "hi": W / 2, "plane": -D / 2, "ry": 0.0,
              "inward": 1, "blocked": [{"a0": w["x0"], "a1": w["x1"], "y0": w["y0"], "y1": w["y1"]} for w in rm["windows"] if w.get("wall", "n") == "n"]},
        "w": {"axis": "z", "lo": -D / 2, "hi": D / 2, "plane": -W / 2, "ry": HALF_PI, "inward": 1, "blocked": []},
    }
    if rm.get("dividers"):      # a brownstone: the other exterior walls and the +z face of each divider
        out["s"] = {"axis": "x", "lo": -W / 2, "hi": W / 2, "plane": D / 2, "ry": math.pi, "inward": -1,
                    "blocked": [{"a0": w["x0"], "a1": w["x1"], "y0": w["y0"], "y1": w["y1"]} for w in rm["windows"] if w.get("wall") == "s"]}
        out["e"] = {"axis": "z", "lo": -D / 2, "hi": D / 2, "plane": W / 2, "ry": -HALF_PI, "inward": -1, "blocked": []}
        for wid, blocks in (rm.get("wall_blocks") or {}).items():
            out[wid]["blocked"] += [{"a0": a0, "a1": a1, "y0": y0, "y1": y1} for a0, a1, y0, y1 in blocks]
        hl = rm.get("hall")
        if hl:      # the stair-hall wall: its west face looks into the apartment, one door
            out[hl["id"]] = {"axis": "z", "lo": hl["z0"], "hi": hl["z1"], "plane": hl["x"], "ry": -HALF_PI, "inward": -1,
                             "blocked": [{"a0": hl["door"][0], "a1": hl["door"][1], "y0": 0.0, "y1": hl["door_h"]}]}
        for dv in rm["dividers"]:
            o0, o1 = dv["opening"]
            out[dv["id"]] = {"axis": "x", "lo": dv.get("x0", -W / 2), "hi": dv.get("x1", W / 2), "plane": dv["z"] + dv["t"] / 2, "ry": 0.0, "inward": 1,
                             "blocked": [{"a0": o0, "a1": o1, "y0": 0.0, "y1": dv["open_h"]}]}
    k = rm.get("kitchen")
    if k:
        out["w"]["blocked"].append({"a0": k["z0"], "a1": k["z1"], "y0": 0.0, "y1": H})
    p = rm.get("partition")
    if p:
        d0, d1 = p["door"]
        out["p"] = {"axis": "z", "lo": p["z0"], "hi": p["z1"], "plane": p["x"] + 0.06, "ry": HALF_PI, "inward": 1,
                    "blocked": [{"a0": d0, "a1": d1, "y0": 0.0, "y1": 2.1}]}
    return out


def _rotated_box(cx: float, cz: float, w: float, d: float, ry: float) -> tuple[float, float, float, float]:
    c, s = abs(math.cos(ry)), abs(math.sin(ry))
    hx, hz = c * w / 2 + s * d / 2, s * w / 2 + c * d / 2
    return (cx - hx, cx + hx, cz - hz, cz + hz)


def obstacles(rm: dict[str, Any]) -> list[dict[str, Any]]:
    """Fixed furniture a floor piece cannot stand on: the bed, a kitchenette, an island, a partition and columns (boxes x0 x1 z0 z1)."""
    out: list[dict[str, Any]] = []
    b = rm.get("bed")
    if b:
        w, l = b["w"] + (0.5 if b.get("platform") else 0.0), b["l"] + (0.3 if b.get("platform") else 0.0)
        out.append({"kind": "bed", **dict(zip(("x0", "x1", "z0", "z1"), _rotated_box(b["x"], b["z"], w, l, b["ry"])))})
    k = rm.get("kitchen")
    if k:
        out.append({"kind": "kitchen", "x0": k["x0"], "x1": k["x1"], "z0": k["z0"], "z1": k["z1"]})
    i = rm.get("island")
    if i:
        out.append({"kind": "island", "x0": i["x"] - 1.05, "x1": i["x"] + 1.05, "z0": i["z"] - 0.45, "z1": i["z"] + 0.45})
    p = rm.get("partition")
    if p:
        d0, d1 = p["door"]
        out.append({"kind": "partition", "x0": p["x"] - 0.06, "x1": p["x"] + 0.06, "z0": p["z0"], "z1": d0})
        out.append({"kind": "partition", "x0": p["x"] - 0.06, "x1": p["x"] + 0.06, "z0": d1, "z1": p["z1"]})
    out += _divider_solids(rm)
    out += [{"kind": k["id"], "x0": k["x0"], "x1": k["x1"], "z0": k["z0"], "z1": k["z1"]} for k in rm.get("keepouts") or []]
    for cx, cz in rm.get("columns") or []:
        out.append({"kind": "column", "x0": cx - 0.24, "x1": cx + 0.24, "z0": cz - 0.24, "z1": cz + 0.24})
    return out


def describe(size: str) -> dict[str, Any]:
    """The room as the client needs it to snap and to draw ghosts (JSON-able)."""
    rm = room(size)
    return {
        "size": rm.get("size", size), "room": size if size in ROOMS_BY_HOME else None, "label": rm["label"], "W": rm["W"], "D": rm["D"], "H": rm["H"], "grid": GRID,
        "windows": rm["windows"], "glass_wall": bool(rm.get("glass_wall")),
        "walls": {k: {kk: vv for kk, vv in w.items()} for k, w in walls(rm).items()},
        "obstacles": obstacles(rm), "stand": rm["stand"],
        "kitchen": bool(rm.get("kitchen") or rm.get("island") or any(k["id"] == "kitchen" for k in rm.get("keepouts") or [])),
        "dividers": rm.get("dividers") or [],
    }


# --------------------------------------------------------------------------
# Catalog access and entries
# --------------------------------------------------------------------------

def geo(item_id: str) -> dict[str, Any] | None:
    it = cat.ITEM_BY_ID.get(item_id)
    return it if it is not None and it.get("kind") == "furniture" and it.get("size") else None


def _num(v: Any, lo: float = -100.0, hi: float = 100.0) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) and lo <= f <= hi else None


def _norm_ry(v: float) -> float:
    r = math.fmod(v, 2 * math.pi)
    if r > math.pi:
        r -= 2 * math.pi
    elif r <= -math.pi:
        r += 2 * math.pi
    return round(r, 3)


def normalize(raw: Any, index: int | None = None) -> dict[str, Any]:
    """Clean one submitted entry (types, rounding, surface from the catalog). Raises LayoutError."""
    if not isinstance(raw, dict):
        raise LayoutError("bad_layout", "Something in that layout is not an item.", index)
    iid = str(raw.get("id") or "")
    g = geo(iid)
    if g is None:
        raise LayoutError("unknown_item", "That item is not in the shop.", index, iid or None)
    want = raw.get("surface", g["surface"])
    if want != g["surface"]:
        hang = g["surface"] == "wall"
        raise LayoutError("wrong_surface", f"{g['name']} {'hangs on a wall' if hang else 'stands on the floor'}.", index, iid)
    if g["surface"] == "wall":
        wall = str(raw.get("wall") or "")
        u, y = _num(raw.get("u"), -1, 2), _num(raw.get("y"), -10, 20)
        if wall not in ("n", "w", "p", "s", "e", "h", "d1", "d2") or u is None or y is None:
            raise LayoutError("bad_wall", "Pick a spot on a solid wall for that.", index, iid)
        return {"id": iid, "surface": "wall", "wall": wall, "u": round(u, 4), "y": round(y, 3)}
    x, z = _num(raw.get("x")), _num(raw.get("z"))
    ry = _num(raw.get("ry", 0.0), -1000, 1000)
    if x is None or z is None or ry is None:
        raise LayoutError("bad_position", "That spot is not on the floor plan.", index, iid)
    return {"id": iid, "surface": "floor", "x": round(x, 2), "z": round(z, 2), "ry": _norm_ry(ry)}


def floor_box(e: dict[str, Any]) -> tuple[float, float, float, float]:
    w, d, _h = geo(e["id"])["size"]
    return _rotated_box(e["x"], e["z"], w, d, e["ry"])


def wall_pose(rm: dict[str, Any], e: dict[str, Any]) -> dict[str, Any] | None:
    """Where a wall piece's centre is: {wall, a (along), x, z, ry, y0, y1, half}."""
    wl = walls(rm).get(e["wall"])
    if wl is None:
        return None
    w, _t, h = geo(e["id"])["size"]
    a = wl["lo"] + e["u"] * (wl["hi"] - wl["lo"])
    x, z = (a, wl["plane"]) if wl["axis"] == "x" else (wl["plane"], a)
    return {"wall": e["wall"], "a": a, "x": x, "z": z, "ry": wl["ry"], "y0": e["y"], "y1": e["y"] + h, "half": w / 2, "w": wl}


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return min(a[1], b[1]) - max(a[0], b[0]) > EPS and min(a[3], b[3]) - max(a[2], b[2]) > EPS


def _layer(e: dict[str, Any]) -> str | None:
    return geo(e["id"]).get("layer")


def check(rm: dict[str, Any], e: dict[str, Any], others: Iterable[dict[str, Any]], index: int | None = None) -> None:
    """Raise LayoutError unless entry `e` fits the room next to `others` (entries already accepted)."""
    g = geo(e["id"])
    name = g["name"]
    if e["surface"] == "wall":
        pose = wall_pose(rm, e)
        if pose is None:
            raise LayoutError("bad_wall", "Pick a solid wall for that.", index, e["id"])
        wl, w, h = pose["w"], g["size"][0], g["size"][2]
        lo, hi = pose["a"] - w / 2, pose["a"] + w / 2
        if lo < wl["lo"] - BOUNDS_EPS or hi > wl["hi"] + BOUNDS_EPS or e["y"] < WALL_Y_MIN or e["y"] + h > rm["H"] - WALL_TOP_GAP:
            raise LayoutError("out_of_bounds", "That does not fit on the wall.", index, e["id"])
        for b in wl["blocked"]:
            if min(hi, b["a1"]) - max(lo, b["a0"]) > EPS and min(pose["y1"], b["y1"]) - max(pose["y0"], b["y0"]) > EPS:
                raise LayoutError("window", "There is a window or a door there.", index, e["id"])
        for o in others:
            if o["surface"] == "wall" and o["wall"] == e["wall"]:
                op = wall_pose(rm, o)
                og = geo(o["id"])
                if (min(hi, op["a"] + og["size"][0] / 2) - max(lo, op["a"] - og["size"][0] / 2) > EPS
                        and min(pose["y1"], op["y1"]) - max(pose["y0"], op["y0"]) > EPS):
                    raise LayoutError("taken", "That spot's taken.", index, e["id"])
            elif o["surface"] == "floor" and not _layer(o):
                if _hides(rm, wl, e["wall"], lo, hi, pose["y0"], floor_box(o), geo(o["id"])["size"][2]):
                    raise LayoutError("taken", "That spot's taken.", index, e["id"])
        return
    box = floor_box(e)
    W, D = rm["W"], rm["D"]
    if box[0] < -W / 2 - BOUNDS_EPS or box[1] > W / 2 + BOUNDS_EPS or box[2] < -D / 2 - BOUNDS_EPS or box[3] > D / 2 + BOUNDS_EPS:
        raise LayoutError("out_of_bounds", f"{name} does not fit there.", index, e["id"])
    for dv in rm.get("dividers") or []:
        if box[2] < dv["z"] - EPS and box[3] > dv["z"] + EPS and box[0] < dv.get("x1", W / 2) - EPS and box[1] > dv.get("x0", -W / 2) + EPS:
            raise LayoutError("divider", f"{name} would sit across the wall.", index, e["id"])
    hl = rm.get("hall")
    if hl and box[1] > hl["x"] + EPS and box[2] < hl["z1"] - EPS and box[3] > hl["z0"] + EPS:
        raise LayoutError("divider", f"{name} would sit in the stair hall.", index, e["id"])
    layer = g.get("layer")
    if layer:
        for o in others:
            if o["surface"] == "floor" and _layer(o) == layer and _overlap(box, floor_box(o)):
                raise LayoutError("taken", "That spot's taken.", index, e["id"])
        return
    for ob in obstacles(rm):
        if _overlap(box, (ob["x0"], ob["x1"], ob["z0"], ob["z1"])):
            raise LayoutError("taken", "That spot's taken.", index, e["id"])
    wls = walls(rm)
    for o in others:
        if o["surface"] == "floor":
            if not _layer(o) and _overlap(box, floor_box(o)):
                raise LayoutError("taken", "That spot's taken.", index, e["id"])
        else:
            wl = wls.get(o["wall"])
            og = geo(o["id"])
            op = wall_pose(rm, o)
            if wl and op and _hides(rm, wl, o["wall"], op["a"] - og["size"][0] / 2, op["a"] + og["size"][0] / 2, op["y0"], box, g["size"][2]):
                raise LayoutError("taken", "That spot's taken.", index, e["id"])


def _hides(rm: dict[str, Any], wl: dict[str, Any], wid: str, lo: float, hi: float, y0: float, box: tuple, height: float) -> bool:
    """Is a floor box standing right against the wall, along [lo, hi], taller than the bottom of what hangs there?"""
    if height <= y0 + 0.1:
        return False
    plane, inw = wl["plane"], wl.get("inward", 1)
    if wl["axis"] == "x":     # a wall along x: the box's z range touches the wall; along = x
        near = (box[2] - plane < WALL_NEAR and box[3] > plane + EPS) if inw > 0 else (plane - box[3] < WALL_NEAR and box[2] < plane - EPS)
        return near and min(hi, box[1]) - max(lo, box[0]) > EPS
    near = (box[0] - plane < WALL_NEAR and box[1] > plane + EPS) if inw > 0 else (plane - box[1] < WALL_NEAR and box[0] < plane - EPS)
    return near and min(hi, box[3]) - max(lo, box[2]) > EPS


def validate(size: str, raw_items: Any, *, budget: int, owned: set[str], home_word: str | None = None) -> list[dict[str, Any]]:
    """Validate a whole submitted layout (a list of entries). Returns the cleaned entries in order. Raises LayoutError at the first
    problem: not owned, twice, over the budget, wrong surface, out of the room, on a window, on top of something."""
    if not isinstance(raw_items, list):
        raise LayoutError("bad_layout", "The layout needs to be a list of items.")
    rm = room(size)
    word = home_word or rm.get("word") or SIZE_WORD.get(size, "home")
    if len(raw_items) > budget:
        raise LayoutError("over_budget", f"Your {word} fits {budget} things.", budget=budget, count=len(raw_items))
    out, seen = [], set()
    for i, raw in enumerate(raw_items):
        e = normalize(raw, i)
        g = geo(e["id"])
        if e["id"] not in owned:
            raise LayoutError("not_owned", f"You do not have {g['name']} yet.", i, e["id"])
        if e["id"] in seen:
            raise LayoutError("duplicate", f"{g['name']} is already in the room.", i, e["id"])
        seen.add(e["id"])
        check(rm, e, out, i)
        out.append(e)
    return out


# --------------------------------------------------------------------------
# Finding a spot: the nearest free place, and the migration from the old slots
# --------------------------------------------------------------------------

def _grid_points(rm: dict[str, Any], near: tuple[float, float] | None) -> list[tuple[float, float]]:
    nx, nz = near if near is not None else (0.0, -rm["D"] / 2)
    xs = [round(-rm["W"] / 2 + k * GRID, 2) for k in range(int(rm["W"] / GRID) + 1)]
    zs = [round(-rm["D"] / 2 + k * GRID, 2) for k in range(int(rm["D"] / GRID) + 1)]
    pts = [(x, z) for x in xs for z in zs]
    pts.sort(key=lambda p: ((p[0] - nx) ** 2 + (p[1] - nz) ** 2, p[1], p[0]))
    return pts


def _try(rm: dict[str, Any], e: dict[str, Any], taken: list[dict[str, Any]]) -> bool:
    try:
        check(rm, e, taken)
        return True
    except LayoutError:
        return False


def _wall_candidates(rm: dict[str, Any], item_id: str, near: tuple[float, float] | None, y: float | None = None) -> list[dict[str, Any]]:
    g = geo(item_id)
    w = g["size"][0]
    yy = y if y is not None else (g.get("wall_y") or 1.3)
    out = []
    for wid, wl in walls(rm).items():
        a = wl["lo"] + w / 2
        while a <= wl["hi"] - w / 2 + 1e-9:
            x, z = (a, wl["plane"]) if wl["axis"] == "x" else (wl["plane"], a)
            dist = 0.0 if near is None else (x - near[0]) ** 2 + (z - near[1]) ** 2
            out.append((dist, wid, {"id": item_id, "surface": "wall", "wall": wid,
                                    "u": round((a - wl["lo"]) / (wl["hi"] - wl["lo"]), 4), "y": round(yy, 3)}))
            a += GRID
    out.sort(key=lambda t: (t[0], t[1], t[2]["u"]))
    return [t[2] for t in out]


def place_near(size: str, taken: list[dict[str, Any]], item_id: str, near: tuple[float, float] | None = None,
               ry_first: float | None = None) -> dict[str, Any] | None:
    """The nearest valid entry for `item_id` next to `taken`, or None when the room has no space. A floor piece keeps `ry_first`
    where it can and otherwise tries the quarter turns."""
    rm, g = room(size), geo(item_id)
    if g is None:
        return None
    if g["surface"] == "wall":
        for e in _wall_candidates(rm, item_id, near):
            if _try(rm, e, taken):
                return e
        return None
    turns = [0.0, HALF_PI, math.pi, -HALF_PI]
    if ry_first is not None:
        turns = [ry_first] + [t for t in turns if abs(_norm_ry(t - ry_first)) > 0.01]
    for x, z in _grid_points(rm, near):
        for ry in turns:
            e = {"id": item_id, "surface": "floor", "x": x, "z": z, "ry": _norm_ry(ry)}
            if _try(rm, e, taken):
                return e
    return None


def slot_entry(size: str, idx: int, item_id: str) -> dict[str, Any] | None:
    """The layout entry that puts `item_id` exactly where the old room view drew it in fixed slot `idx` (None if it has no such
    place: an easel piece in a non-wall slot, or an unknown slot)."""
    rm, g = room(size), geo(item_id)
    if g is None or not 0 <= idx < len(rm["slots"]):
        return None
    sl = rm["slots"][idx]
    x, z, ry = sl["x"], sl["z"], sl["ry"]
    s, c = math.sin(ry), math.cos(ry)
    if g["surface"] == "wall":
        if not sl["wall"]:
            return None
        for wid, wl in walls(rm).items():
            if wl["ry"] != ry and abs(_norm_ry(wl["ry"] - ry)) > 0.01:
                continue
            a = x if wl["axis"] == "x" else z
            plane_gap = abs((z if wl["axis"] == "x" else x) - wl["plane"])
            if plane_gap < 0.2 and wl["lo"] - 0.01 <= a <= wl["hi"] + 0.01:
                return {"id": item_id, "surface": "wall", "wall": wid,
                        "u": round((a - wl["lo"]) / (wl["hi"] - wl["lo"]), 4), "y": round(g.get("wall_y") or 1.3, 3)}
        return None
    mount = g.get("mount", "floor")
    if mount == "rug":
        fwd = 1.15 if sl["wall"] else 0.2
        cx, cz = x + s * fwd, z + c * fwd
    elif mount == "ceiling":
        cx, cz = x + s * 1.3, z + c * 1.3
    else:
        ax, az = g["anchor"]
        cx, cz = x + ax * c + az * s, z - ax * s + az * c
    return {"id": item_id, "surface": "floor", "x": round(cx, 2), "z": round(cz, 2), "ry": _norm_ry(ry)}


def slot_of(size: str, e: dict[str, Any]) -> int | None:
    """The old fixed-slot index an entry sits exactly on, or None (the old room view only knows these)."""
    for idx in range(len(room(size)["slots"])):
        s = slot_entry(size, idx, e["id"])
        if s is None or s["surface"] != e["surface"]:
            continue
        if e["surface"] == "wall":
            if s["wall"] == e["wall"] and abs(s["u"] - e["u"]) < 0.002 and abs(s["y"] - e["y"]) < 0.02:
                return idx
        elif abs(s["x"] - e["x"]) < 0.015 and abs(s["z"] - e["z"]) < 0.015 and abs(_norm_ry(s["ry"] - e["ry"])) < 0.01:
            return idx
    return None


def auto_place(size: str, taken: list[dict[str, Any]], item_id: str) -> dict[str, Any] | None:
    """A good place for something new: an old slot position if it is free and valid (so the old room view still draws it where it
    always did), else the nearest free spot against the back wall."""
    rm = room(size)
    for idx in range(len(rm["slots"])):
        e = slot_entry(size, idx, item_id)
        if e is not None and slot_of(size, e) == idx and not any(slot_of(size, t) == idx for t in taken) and _try(rm, e, taken):
            return e
    return place_near(size, taken, item_id, near=(0.0, -rm["D"] / 2), ry_first=0.0)


def migrate_slots(size: str, placed: list[str | None]) -> tuple[list[dict[str, Any]], list[str]]:
    """Convert the old slot assignments (one furniture id or None per slot) into layout entries. A piece keeps its exact place when
    it still fits; otherwise it goes to the nearest free spot. Returns (entries, ids that found no room)."""
    rm = room(size)
    out: list[dict[str, Any]] = []
    left: list[str] = []
    for idx, iid in enumerate(placed):
        if not iid or geo(iid) is None or any(o["id"] == iid for o in out):
            continue
        e = slot_entry(size, idx, iid)
        if e is not None and _try(rm, e, out):
            out.append(e)
            continue
        sl = rm["slots"][idx] if idx < len(rm["slots"]) else {"x": 0.0, "z": 0.0, "ry": 0.0}
        e = place_near(size, out, iid, near=(sl["x"], sl["z"]), ry_first=sl["ry"])
        if e is None:
            left.append(iid)
        else:
            out.append(e)
    return out, left


def study_entry(key: str) -> dict[str, Any] | None:
    """Where the study piece (the desk) goes in a custom room: flush to the street wall, facing out."""
    rm, st = room(key), room(key).get("study")
    if not st or geo(st["item"]) is None:
        return None
    d = geo(st["item"])["size"][1]
    return {"id": st["item"], "surface": "floor", "x": round(st["x"], 2), "z": round(-rm["D"] / 2 + d / 2 + 0.02, 2), "ry": _norm_ry(st["ry"])}


def fit_home(key: str, raw_items: list[Any], first: bool = False) -> tuple[list[Any], list[str], bool]:
    """Fit a saved layout into a custom room. `first` (the first time this room shape is seen) also sends the study piece to the study
    spot. A piece that already fits is kept exactly; a misfit goes to the nearest valid spot; one with no room at all is returned in
    `left` (to storage), never dropped. Returns (items in the same order, ids left over, changed). Idempotent."""
    rm = room(key)
    keep: list[Any] = []                # (raw, normalized or None)
    for r in raw_items:
        try:
            keep.append((r, normalize(r)))
        except LayoutError:
            keep.append((r, None))      # not ours to judge: kept untouched
    taken: list[dict[str, Any]] = []
    result: dict[int, Any] = {}
    study = study_entry(key) if first else None
    if study is not None:
        for i, (_r, n) in enumerate(keep):
            if n is not None and n["id"] == study["id"] and n["surface"] == "floor":
                e = study if _try(rm, study, taken) else place_near(key, taken, study["id"], near=(study["x"], study["z"]), ry_first=study["ry"])
                if e is not None:
                    taken.append(e)
                    result[i] = e
                break
    left: list[str] = []
    for i, (r, n) in enumerate(keep):
        if i in result:
            continue
        if n is None or any(t["id"] == n["id"] for t in taken):
            result[i] = r
            continue
        if _try(rm, n, taken):
            e = n
        else:
            near = (n["x"], n["z"]) if n["surface"] == "floor" else None
            e = place_near(key, taken, n["id"], near=near, ry_first=n.get("ry"))
        if e is None:
            left.append(n["id"])
        else:
            taken.append(e)
            result[i] = e
    out = [result[i] for i in range(len(keep)) if i in result]
    before = [n if n is not None else r for r, n in keep]
    return out, left, out != before
