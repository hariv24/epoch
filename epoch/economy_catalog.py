"""The money system's catalog (docs/ECONOMY.md): job titles, homes, shop items and the NYC events calendar.

Pure data and tiny pure helpers; nothing here touches the database. `epoch/economy.py` builds the engine on top.

Every number is a price or a rent in whole dollars. Homes are REAL residential buildings: `bin` is the NYC Building Identification
Number as it appears in the footprint data the 3D city is built from, `address` is the PLUTO tax-lot address, and `x`, `z`, `base_y`,
`height_m` are read from the LOD0 tile of that building (local metres, X east, Z south, see docs/MANHATTAN-DATA.md). The one-line
descriptions are game flavour ("a floor-through" is the kind of home, not a claim about that exact unit).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable

# --------------------------------------------------------------------------
# Pay: job titles by skill-ladder node count (5 ladders x 5 nodes = 25 nodes)
# --------------------------------------------------------------------------

# (nodes needed, title, dollars per deep hour). The thresholds are spread over about a year of steady work: the node gates in
# game.NODE_GATES need 75 outputs and 400 deep hours in all, so the last titles take most of the year.
TITLES: list[tuple[int, str, int]] = [
    (0, "Barista", 25),
    (2, "Intern", 30),
    (5, "Columbia TA", 35),
    (10, "Research Assistant", 45),
    (16, "ML Engineer", 60),
    (22, "Founder", 80),
]

OUTPUT_DOLLARS = 50            # per shipped output, 3 a day (the same cap as XP)
OUTPUT_DAILY_CAP = 3
STAR_DOLLARS = 50              # a three-star day, once a day
KEPT_WEEK_DOLLARS = 100        # a kept week, once a week
INTEREST_RATE = 0.02           # on savings at the close of a kept week
INTEREST_CAP_DOLLARS = 200
DEPOSIT_WEEKS = 2              # a move costs this many weeks' rent as a deposit (returned when you move out)
UNPAID_WEEKS_TO_MOVE = 2       # in a row

# --------------------------------------------------------------------------
# Homes: one per district of the level ladder (game.DISTRICTS), each a real residential building
# --------------------------------------------------------------------------

SIZES = {"studio": 4, "1-bed": 6, "loft": 8, "penthouse": 12}     # the old fixed furniture slots per size tier (kept for the old room view)
BUDGETS = {"studio": 8, "1-bed": 12, "loft": 16, "penthouse": 24}  # how many things a home holds with free placement (docs/COZY.md 4.2)


def _home(hid: str, district: str, name: str, blurb: str, bin_: int, address: str, size: str, rent: int, floor: int,
          x: float, z: float, base_y: float, height_m: float) -> dict[str, Any]:
    return {
        "id": hid, "district": district, "name": name, "blurb": blurb, "bin": bin_, "address": address, "size": size,
        "slots": SIZES[size], "budget": BUDGETS[size], "rent": rent, "deposit": rent * DEPOSIT_WEEKS, "floor": floor,
        "x": x, "z": z, "base_y": base_y, "height_m": height_m,
    }


HOMES: list[dict[str, Any]] = [
    _home("morningside-studio", "Morningside Heights", "Pre-war walk-up studio",
          "A top-floor studio a short walk from the Columbia gate. Radiators, high ceilings, a window onto a quiet block.",
          1059500, "421 W 118th St", "studio", 150, 6, 2169.2, -5460.6, 37.1, 24.2),
    _home("harlem-floorthrough", "Harlem", "Brownstone floor-through",
          "The whole parlour floor of a brownstone: front to back, with a stoop and a back garden.",
          1057741, "124 W 123rd St", "1-bed", 200, 2, 3153.3, -5323.2, 6.2, 16.5),
    _home("uws-prewar", "Upper West Side", "Pre-war one-bedroom",
          "Thick walls, a long hall and a view over West End Avenue's trees.",
          1033975, "575 West End Ave", "1-bed", 260, 8, 659.1, -3468.1, 19.7, 49.5),
    _home("cpw-parkview", "Central Park", "Central Park West one-bedroom",
          "A pre-war co-op home with the park right across the street.",
          1028166, "55 Central Park West", "1-bed", 320, 12, 499.7, -1490.7, 20.5, 71.3),
    _home("ues-parkavenue", "Upper East Side", "Park Avenue one-bedroom",
          "A doorman building on a wide avenue, a few minutes from the museums.",
          1041136, "620 Park Ave", "1-bed", 370, 9, 1511.4, -896.0, 14.6, 51.5),
    _home("hk-walkup", "Hell's Kitchen", "Ninth Avenue walk-up",
          "A fire-escape walk-up over restaurant row. Loud, warm and close to everything.",
          1026572, "404 W 48th St", "1-bed", 410, 4, -452.9, -374.2, 12.9, 21.1),
    _home("midtown-highrise", "Midtown & Times Square", "Midtown high-rise one-bedroom",
          "A modern tower near Columbus Circle, with the lights of Midtown in the window.",
          1024894, "1752 Broadway", "1-bed", 440, 24, 301.8, -734.9, 24.2, 112.8),
    _home("chelsea-corner", "Chelsea", "Chelsea corner loft",
          "A big corner room with tall windows, a short walk from the High Line.",
          1013243, "363 W 20th St", "loft", 460, 11, -1451.6, 1579.0, 2.1, 57.4),
    _home("gramercy-prewar", "Flatiron & Gramercy", "Gramercy Park pre-war",
          "A quiet pre-war home beside the gated park. Keys to the park are another story.",
          1017953, "34 Gramercy Park E", "loft", 480, 8, 15.6, 2390.4, 6.9, 43.0),
    _home("village-walkup", "Greenwich Village", "Village walk-up with a fire escape",
          "A fifth-floor walk-up a block from Washington Square, with a fire escape for plants.",
          1009438, "19 W 8th St", "1-bed", 500, 5, -1034.3, 2882.7, 6.0, 18.2),
    _home("soho-castiron", "SoHo & Tribeca", "Cast-iron loft",
          "Tall iron-framed windows over cobblestones, a loft with room to spread out.",
          1002979, "15 Greene St", "loft", 600, 4, -1509.9, 4201.4, 3.5, 26.1),
    _home("les-corner", "Lower East Side", "Mulberry Street corner loft",
          "A top-floor corner above the noodle shops, a few streets from the bridges.",
          1001805, "30 Mulberry St", "loft", 625, 6, -1205.1, 4925.4, 5.6, 21.8),
    _home("fidi-harbor", "Financial District", "Glass-tower one-bedroom with a harbour view",
          "A high floor at the tip of the island, with the harbour and the ferries below.",
          1086256, "10 Liberty St", "1-bed", 650, 38, -1945.7, 5719.0, 3.9, 154.9),
    _home("heights-riverside", "Upper Manhattan", "Riverside Drive loft with a river view",
          "Big rooms high above the Hudson, with the George Washington Bridge down the river.",
          1063252, "790 Riverside Dr", "loft", 750, 9, 3212.2, -8400.4, 21.9, 48.2),
    _home("brow-penthouse", "Billionaires' Row", "The Central Park Tower penthouse",
          "The dream home: the whole park in the window, and Morningside Heights at the far end of it, where you started.",
          1090180, "217 W 57th St", "penthouse", 900, 100, 347.8, -836.2, 24.4, 472.4),
]
HOME_BY_ID = {h["id"]: h for h in HOMES}

# --------------------------------------------------------------------------
# The shop. `kind` is the aisle: furniture | outfit | experience | upgrade.
# --------------------------------------------------------------------------

AISLES = [
    {"id": "furniture", "name": "Furniture and decor"},
    {"id": "outfit", "name": "Outfits"},
    {"id": "experience", "name": "NYC experiences"},
    {"id": "upgrade", "name": "Tower upgrades"},
]


def _item(iid: str, kind: str, name: str, price: int, blurb: str, category: str, tier: str = "basic",
          district: str | None = None) -> dict[str, Any]:
    return {"id": iid, "kind": kind, "name": name, "price": price, "blurb": blurb, "category": category, "tier": tier,
            "district": district}


FURNITURE: list[dict[str, Any]] = [
    _item("desk_setup", "furniture", "Desk setup", 150, "A plain desk, a good chair and room for one notebook.", "desk"),
    _item("bookshelf", "furniture", "Bookshelf", 200, "Floor to ceiling, mostly paperbacks.", "shelf"),
    _item("trailing_plant", "furniture", "Trailing plant", 35, "A pothos that is very hard to kill.", "plant"),
    _item("reading_lamp", "furniture", "Reading lamp", 55, "A warm light over the desk.", "lamp"),
    _item("woven_rug", "furniture", "Woven rug", 110, "Soft underfoot.", "rug"),
    _item("postcard_board", "furniture", "Cork board of postcards", 45, "Your Passport postcards, pinned up.", "wall"),
    _item("skyline_print", "furniture", "Framed skyline print", 90, "The island at dusk, in a thin black frame.", "art"),
    _item("record_player", "furniture", "Record player", 140, "One shelf of jazz records.", "audio"),
    _item("two_seat_sofa", "furniture", "Two-seat sofa", 380, "Deep enough for a nap.", "sofa"),
    _item("reading_armchair", "furniture", "Reading armchair", 320, "A corner chair with a footstool.", "armchair", "nice"),
    _item("fiddle_fig", "furniture", "Fiddle-leaf fig", 120, "Tall, leafy and a little dramatic.", "plant", "nice"),
    _item("standing_desk", "furniture", "Standing desk", 520, "Two monitors' worth of room.", "desk", "nice"),
    _item("brass_telescope", "furniture", "Brass telescope", 420, "Aimed at the sky over the river.", "telescope", "nice"),
    _item("oil_painting", "furniture", "Oil painting", 650, "A rainy avenue, thick with paint.", "art", "nice"),
    _item("espresso_corner", "furniture", "Espresso corner", 280, "A small machine and two cups.", "kitchen", "nice"),
    _item("upright_piano", "furniture", "Upright piano", 2400, "A real one, slightly out of tune.", "piano", "nice"),
    _item("marble_desk", "furniture", "Marble-top desk", 2600, "A long white desk facing the window.", "desk", "penthouse"),
    _item("velvet_sectional", "furniture", "Velvet sectional", 3800, "Room for everyone you have not met yet.", "sofa", "penthouse"),
    _item("leather_lounge", "furniture", "Leather lounge chair", 1600, "Low, wide and very quiet.", "armchair", "penthouse"),
    _item("crystal_chandelier", "furniture", "Crystal chandelier", 2200, "Hung from a very high ceiling.", "lamp", "penthouse"),
    _item("silk_rug", "furniture", "Silk Persian rug", 1900, "Hand-knotted, in deep blues.", "rug", "penthouse"),
    _item("bronze_sculpture", "furniture", "Bronze sculpture", 3200, "A tall, thin figure with no face.", "art", "penthouse"),
    _item("library_wall", "furniture", "Library wall", 4200, "Rolling ladder included.", "shelf", "penthouse"),
    _item("glass_wine_wall", "furniture", "Glass wine wall", 2800, "Lit from below.", "kitchen", "penthouse"),
    _item("grand_piano", "furniture", "Grand piano", 7500, "Black, polished, at the window.", "piano", "penthouse"),
]

DEFAULT_OUTFIT = "everyday"
OUTFITS: list[dict[str, Any]] = [
    _item(DEFAULT_OUTFIT, "outfit", "Everyday clothes", 0, "A tee, jeans and clean sneakers. Always yours.", "casual"),
    _item("columbia_hoodie", "outfit", "Columbia-blue hoodie", 80, "Light blue, soft, no logos.", "hoodie"),
    _item("nyu_hoodie", "outfit", "NYU-violet hoodie", 80, "Deep violet, soft, no logos.", "hoodie"),
    _item("plain_jersey", "outfit", "Plain jersey", 90, "A basketball jersey with no logos.", "jersey"),
    _item("running_gear", "outfit", "Running gear", 120, "For laps around the Reservoir.", "sport"),
    _item("library_cardigan", "outfit", "Library cardigan", 140, "Oatmeal wool with deep pockets.", "casual", "nice"),
    _item("winter_coat", "outfit", "Winter coat and scarf", 220, "Long, charcoal, with a red scarf.", "coat", "nice"),
    _item("navy_suit", "outfit", "Navy suit", 450, "Fitted, for interviews and openings.", "suit", "nice"),
    _item("camel_overcoat", "outfit", "Camel overcoat", 1400, "The coat you see in every Fifth Avenue window.", "coat", "penthouse"),
]

EXPERIENCES: list[dict[str, Any]] = [
    _item("columbia_lecture", "experience", "A Columbia lecture, back row", 40, "Sitting in on a class you are not enrolled in.",
          "campus", district="Morningside Heights"),
    _item("evensong", "experience", "Evensong at St. John the Divine", 50, "The largest cathedral in the world, mostly empty.",
          "music", district="Morningside Heights"),
    _item("apollo_night", "experience", "Amateur Night at the Apollo", 75, "A tough, loving crowd.",
          "show", district="Harlem"),
    _item("lincoln_ballet", "experience", "Ballet at Lincoln Center", 180, "Fourth ring, front row of the standing area.",
          "show", district="Upper West Side"),
    _item("park_rowboat", "experience", "A rowboat on the Central Park lake", 70, "One hour, two oars, a skyline above the trees.",
          "outdoor", district="Central Park"),
    _item("met_morning", "experience", "A morning at the Met", 60, "Start at the Egyptian wing before the crowds.",
          "museum", district="Upper East Side"),
    _item("ninth_dumplings", "experience", "Dumplings on Ninth Avenue", 45, "Standing at a counter, napkins everywhere.",
          "food", district="Hell's Kitchen"),
    _item("broadway_show", "experience", "A Broadway show, balcony seats", 260, "The lights go down and the whole room breathes in.",
          "show", district="Midtown & Times Square"),
    _item("top_of_rock", "experience", "Top of the Rock at dusk", 140, "The whole island turns on its lights below you.",
          "view", district="Midtown & Times Square"),
    _item("high_line_evening", "experience", "An evening on the High Line", 30, "A path of grass above the street.",
          "outdoor", district="Chelsea"),
    _item("knicks_msg", "experience", "Knicks at Madison Square Garden", 320, "Loud, orange and blue, and nobody sits down.",
          "sport", district="Flatiron & Gramercy"),
    _item("village_jazz", "experience", "A jazz club in the Village", 90, "A basement, a trio, one more set.",
          "music", district="Greenwich Village"),
    _item("soho_gallery_hop", "experience", "Gallery hop in SoHo", 40, "Free wine, loud opinions.",
          "museum", district="SoHo & Tribeca"),
    _item("katz_deli", "experience", "Pastrami at Katz's Deli", 35, "Keep the ticket. You will need it.",
          "food", district="Lower East Side"),
    _item("ferry_sunset", "experience", "The Staten Island Ferry at sunset", 25, "Free in real life, a postcard here.",
          "outdoor", district="Financial District"),
    _item("cloisters_autumn", "experience", "The Cloisters in autumn", 45, "Medieval rooms at the north end of the island.",
          "museum", district="Upper Manhattan"),
    _item("brow_dinner", "experience", "Dinner in the clouds on 57th Street", 600, "A table at the top, the park a dark rectangle below.",
          "food", "penthouse", district="Billionaires' Row"),
]

UPGRADES: list[dict[str, Any]] = [
    _item("string_lights", "upgrade", "String lights", 150, "Warm bulbs along the roofline of every study tower.", "lights"),
    _item("painted_tank", "upgrade", "Painted water tank", 350, "The rooftop tank in a fresh coat of colour.", "roof"),
    _item("awning_doorman", "upgrade", "Awning and doorman", 400, "A striped awning and a figure in a long coat at the door.", "entrance"),
    _item("neon_sign", "upgrade", "Neon sign", 500, "A small neon sign on the side of each tower.", "sign"),
    _item("rooftop_garden", "upgrade", "Rooftop garden", 600, "Green planters and a tiny tree on top.", "roof"),
    _item("brass_doors", "upgrade", "Brass doors", 700, "Polished brass doors at the foot of each tower.", "entrance"),
]

# --------------------------------------------------------------------------
# Cozy life sim (docs/COZY.md): free placement, activities, chest-only items, study spots, daily missions
# --------------------------------------------------------------------------

# What a piece of furniture unlocks for the character at home. `line` is the store card's promise; `night_only` activities only
# play after dark. `look_outside` and `sleep` need no furniture (the window and the bed are part of every home); `make_tea` is also
# free in a home with a kitchen (see layout.ROOMS `kitchen`).
ACTIVITIES: dict[str, dict[str, Any]] = {
    "read": {"name": "Read", "line": "Your character will read here."},
    "water_plants": {"name": "Water the plants", "line": "Your character will water this."},
    "look_outside": {"name": "Look out of the window", "line": "", "free": True},
    "make_tea": {"name": "Make tea", "line": "Your character will make tea here."},
    "play_piano": {"name": "Play the piano", "line": "Your character will play the piano here."},
    "play_records": {"name": "Play records", "line": "Your character will play records here."},
    "browse_records": {"name": "Flip through records", "line": "Your character will flip through the records here."},
    "stargaze": {"name": "Stargaze", "line": "Your character will stargaze here, after dark.", "night_only": True},
    "work_desk": {"name": "Work at the desk", "line": "Your character will work here."},
    "type": {"name": "Type", "line": "Your character will type here."},
    "sleep": {"name": "Sleep", "line": "", "free": True, "night_only": True},
}

# Geometry of every furniture piece, in metres. `size` = [w, d, h]: the footprint is w (across the front) by d (front to back);
# for a wall piece [w, thickness, h]. `anchor` = [ax, az], the footprint's centre in the model's own frame (the frame room.js builds
# in: x across, z from the back (0) to the front); the layout stores the footprint CENTRE, so a renderer puts the model at
# centre - R(ry) * anchor. `surface`: floor | wall. `layer`: 'under' (rugs: may lie beneath other things) or 'over' (hangs from the
# ceiling); neither collides with ordinary floor pieces. `mount` is room.js's old slot mounting (used by the slot migration only).
_GEO: dict[str, dict[str, Any]] = {
    "desk_setup": {"size": [1.25, 1.15, 1.1], "anchor": [0, 0.62], "activity": "work_desk"},
    "bookshelf": {"size": [0.95, 0.34, 2.0], "anchor": [0, 0.17]},
    "trailing_plant": {"size": [0.45, 0.45, 1.1], "anchor": [0, 0.22], "activity": "water_plants"},
    "reading_lamp": {"size": [0.95, 0.5, 1.65], "anchor": [0.21, 0.35]},
    "woven_rug": {"size": [2.0, 1.4, 0.02], "anchor": [0, 0], "layer": "under", "mount": "rug"},
    "postcard_board": {"size": [0.96, 0.05, 0.64], "surface": "wall", "mount": "wall", "wall_y": 1.25},
    "skyline_print": {"size": [0.84, 0.05, 0.58], "surface": "wall", "mount": "wall", "wall_y": 1.3},
    "record_player": {"size": [0.96, 0.45, 0.85], "anchor": [0, 0.24], "activity": "play_records"},
    "two_seat_sofa": {"size": [1.7, 0.9, 0.88], "anchor": [0, 0.48], "activity": "read"},
    "reading_armchair": {"size": [0.85, 1.35, 1.0], "anchor": [0, 0.72], "activity": "read"},
    "fiddle_fig": {"size": [0.6, 0.6, 1.9], "anchor": [0.05, 0.3], "activity": "water_plants"},
    "standing_desk": {"size": [1.45, 0.7, 1.6], "anchor": [0, 0.38], "activity": "work_desk"},
    "brass_telescope": {"size": [0.7, 0.8, 1.5], "anchor": [0, 0.45], "activity": "stargaze"},
    "oil_painting": {"size": [1.15, 0.05, 1.0], "surface": "wall", "mount": "wall", "wall_y": 1.15},
    "espresso_corner": {"size": [1.16, 0.62, 1.35], "anchor": [0, 0.31], "activity": "make_tea"},
    "upright_piano": {"size": [1.5, 1.4, 1.3], "anchor": [0, 0.7], "activity": "play_piano"},
    "marble_desk": {"size": [2.0, 1.2, 1.2], "anchor": [0, 0.63], "activity": "work_desk"},
    "velvet_sectional": {"size": [2.7, 2.05, 0.85], "anchor": [0, 1.08], "activity": "read"},
    "leather_lounge": {"size": [0.85, 1.5, 1.05], "anchor": [0, 0.74], "activity": "read"},
    "crystal_chandelier": {"size": [0.85, 0.85, 0.9], "anchor": [0, 0], "layer": "over", "mount": "ceiling"},
    "silk_rug": {"size": [2.8, 1.9, 0.03], "anchor": [0, 0], "layer": "under", "mount": "rug"},
    "bronze_sculpture": {"size": [0.5, 0.5, 2.3], "anchor": [0, 0.35]},
    "library_wall": {"size": [2.8, 0.75, 3.2], "anchor": [0, 0.375]},
    "glass_wine_wall": {"size": [1.6, 0.42, 2.2], "anchor": [0, 0.21]},
    "grand_piano": {"size": [1.5, 2.4, 1.8], "anchor": [0, 1.15], "activity": "play_piano"},
    # chest-only furniture (never sold; models fall back to the nearest category until room.js has its own)
    "subway_map_print": {"size": [0.9, 0.05, 0.65], "surface": "wall", "mount": "wall", "wall_y": 1.3},
    "brass_desk_clock": {"size": [0.35, 0.3, 0.9], "anchor": [0, 0.15]},
    "typewriter": {"size": [0.7, 0.55, 0.95], "anchor": [0, 0.28], "activity": "type"},
    "record_crate": {"size": [0.6, 0.4, 0.5], "anchor": [0, 0.2], "activity": "browse_records"},
    "velvet_armchair": {"size": [0.9, 0.95, 0.95], "anchor": [0, 0.48], "activity": "read"},
    "flatiron_globe": {"size": [0.4, 0.4, 0.9], "anchor": [0, 0.2]},
}


def _with_geo(item: dict[str, Any]) -> dict[str, Any]:
    g = _GEO[item["id"]]
    w, d, h = g["size"]
    item.update(
        size=list(g["size"]), anchor=list(g.get("anchor") or [0, round(d / 2, 3)]), surface=g.get("surface", "floor"),
        layer=g.get("layer"), activity=g.get("activity"), mount=g.get("mount", "floor"), wall_y=g.get("wall_y"),
    )
    item.setdefault("chest_only", False)
    return item


for _f in FURNITURE:
    _with_geo(_f)


def _chest(iid: str, kind: str, name: str, blurb: str, category: str, value: int) -> dict[str, Any]:
    item = _item(iid, kind, name, 0, blurb, category, "chest")
    item.update(chest_only=True, value=value)
    return item


# Never sold: they only come out of a daily chest (a rare find, or a postcard).
CHEST_FURNITURE: list[dict[str, Any]] = [_with_geo(_chest(*row)) for row in (
    ("subway_map_print", "furniture", "Vintage subway map print", "An old map of the lines, folded once and framed.", "art", 120),
    ("brass_desk_clock", "furniture", "Brass desk clock", "It ticks a little loudly and keeps good time.", "decor", 90),
    ("typewriter", "furniture", "Typewriter", "Green keys, a ribbon that still works.", "decor", 160),
    ("record_crate", "furniture", "A crate of records", "A wooden crate of jazz, soul and one very scratched opera.", "decor", 80),
    ("velvet_armchair", "furniture", "Columbia-blue velvet armchair", "Deep blue, deep seat.", "armchair", 260),
    ("flatiron_globe", "furniture", "Flatiron snow globe", "Shake it and the avenue goes quiet.", "decor", 40),
)]
CHEST_OUTFITS: list[dict[str, Any]] = [
    _chest("yellow_raincoat", "outfit", "Yellow raincoat and boots", "Bright yellow, for the days it pours.", "coat", 160),
    _chest("varsity_jacket", "outfit", "Varsity-style jacket", "Wool and leather sleeves, no logos.", "jacket", 180),
]
CHEST_POSTCARDS: list[dict[str, Any]] = [
    _chest("postcard_high_line_sunrise", "postcard", "Sunrise on the High Line", "The first light along the old rail line.", "postcard", 0),
    _chest("postcard_met_midnight", "postcard", "Midnight on the Met steps", "The steps are empty and the lamps are on.", "postcard", 0),
    _chest("postcard_bridge_fog", "postcard", "Fog over the Brooklyn Bridge", "The towers come and go in the fog.", "postcard", 0),
]
CHEST_ITEMS: list[dict[str, Any]] = CHEST_FURNITURE + CHEST_OUTFITS + CHEST_POSTCARDS
CHEST_RARE: list[dict[str, Any]] = CHEST_FURNITURE + CHEST_OUTFITS     # the 20% prize pool (postcards have their own 15% roll)

ITEMS: list[dict[str, Any]] = FURNITURE + OUTFITS + EXPERIENCES + UPGRADES        # what the store sells
ITEM_BY_ID = {i["id"]: i for i in ITEMS + CHEST_ITEMS}                              # everything that can be owned

# --------------------------------------------------------------------------
# Study spots (docs/COZY.md 4.5): where a focus block happens. `price` is the unlock cost in dollars, `district` the level gate
# (a game.DISTRICTS name), `home` unlocks it for free once you have lived in that home. Butler is free and always open.
# --------------------------------------------------------------------------

DEFAULT_SPOT = "butler"
STUDY_SPOTS: list[dict[str, Any]] = [
    {"id": "butler", "name": "Butler Library reading room", "short": "Butler Library", "pin": "Studying at Butler",
     "blurb": "Banker's lamps, long oak tables and tall arched windows. Where it starts.", "price": 0, "district": None,
     "outdoor": False, "home": None, "gate_name": "Butler Library"},
    {"id": "cafe_amsterdam", "name": "A café on Amsterdam Ave", "short": "Amsterdam Ave café", "pin": "Studying at the café",
     "blurb": "A narrow café with a pressed-tin ceiling and a window seat on the avenue.", "price": 300, "district": None,
     "outdoor": False, "home": None, "gate_name": "The café on Amsterdam Ave"},
    {"id": "low_steps", "name": "Low Library steps", "short": "Low Library steps", "pin": "Studying on the Low steps",
     "blurb": "Wide stone steps over the South Lawn. Open air, so rain and snow are part of it.", "price": 450, "district": None,
     "outdoor": True, "home": None, "gate_name": "The Low Library steps"},
    {"id": "rooftop", "name": "A rooftop in Morningside", "short": "Morningside rooftop", "pin": "Studying on the roof",
     "blurb": "Tar roof, a water tank, string lights and the skyline to the south.", "price": 700, "district": None,
     "outdoor": True, "home": None, "gate_name": "The Morningside rooftop"},
    {"id": "park_bench", "name": "Central Park bench, the Mall", "short": "Central Park bench", "pin": "Studying in the park",
     "blurb": "A bench under the elms on the Mall. It follows the season and the weather.", "price": 900,
     "district": "Central Park", "outdoor": True, "home": None, "gate_name": "The Central Park bench"},
    {"id": "nypl_rose", "name": "The grand reading room on Fifth Ave", "short": "Fifth Ave reading room", "pin": "Studying on Fifth Ave",
     "blurb": "A hall as long as a block, painted sky overhead and brass lamps on every table.", "price": 1200,
     "district": "Midtown & Times Square", "outdoor": False, "home": None, "gate_name": "The Fifth Ave reading room"},
    {"id": "penthouse_desk", "name": "Your penthouse desk", "short": "Penthouse desk", "pin": "Studying at home",
     "blurb": "The marble desk, with Central Park in the window.", "price": 0, "district": None, "outdoor": False,
     "home": "brow-penthouse", "gate_name": "The penthouse desk"},
]
SPOT_BY_ID = {sp["id"]: sp for sp in STUDY_SPOTS}

# --------------------------------------------------------------------------
# Daily missions and the chest (docs/COZY.md 4.6)
# --------------------------------------------------------------------------

MISSION_TIERS = ("easy", "medium", "stretch")
# id, tier, text ({n} = minutes, {category}), the lower-case phrase used in "Mission done: ..."
MISSIONS: list[dict[str, Any]] = [
    {"id": "early_bird", "tier": "easy", "text": "Log your first hour before 11 AM", "done_text": "an early first hour"},
    {"id": "one_block", "tier": "easy", "text": "Finish one focus block", "done_text": "one focus block"},
    {"id": "full_focus", "tier": "easy", "text": "Rate a block \"Full focus\"", "done_text": "a full-focus block"},
    {"id": "doors_by_noon", "tier": "easy", "text": "Open the doors before noon", "done_text": "the doors open by noon"},
    {"id": "two_blocks", "tier": "medium", "text": "Finish two focus blocks", "done_text": "two focus blocks"},
    {"id": "deep_n", "tier": "medium", "text": "{n} of deep focus today", "done_text": "{n} of deep focus"},
    {"id": "two_subjects", "tier": "medium", "text": "Study two different subjects", "done_text": "two different subjects"},
    {"id": "new_spot", "tier": "medium", "text": "Study at a different spot", "done_text": "a different spot"},
    {"id": "math_hour", "tier": "medium", "text": "An hour of {category}", "done_text": "an hour of {category}"},
    {"id": "crown", "tier": "stretch", "text": "Light the crown", "done_text": "the crown lit"},
    {"id": "long_block", "tier": "stretch", "text": "One block of 75 minutes or more", "done_text": "a 75-minute block"},
    {"id": "deep_stretch", "tier": "stretch", "text": "{n} of deep focus today", "done_text": "{n} of deep focus"},
    {"id": "ship_it", "tier": "stretch", "text": "Ship an output", "done_text": "an output shipped"},
]
MISSION_BY_ID = {m["id"]: m for m in MISSIONS}
# Never offered together: the second contains the first.
MISSION_CONFLICTS: list[frozenset] = [frozenset({"one_block", "two_blocks"}), frozenset({"deep_n", "deep_stretch"})]

BLOCK_MIN_SECONDS = 25 * 60        # a "focus block" for a mission is at least this much worked time
LONG_BLOCK_SECONDS = 75 * 60
EARLY_BIRD_HOUR = 11               # local clock hour: the first logged hour must start before this
DOORS_HOUR = 12
SUBJECT_MIN_MINUTES = 15           # "two subjects": at least this much deep time in each
MATH_HOUR_MINUTES = 60
SHIP_IT_PER_WEEK = 2               # ship_it is offered on at most this many days of a Monday-to-Sunday week
DEEP_DEFAULTS = (60, 120)          # medium / stretch deep minutes before there is any history
DEEP_MEDIUM = (0.8, 45, 180)       # factor of the median deep minutes, min, max
DEEP_STRETCH = (1.2, 90, 300)
DEEP_ROUND = 15
HISTORY_ACTIVE_DAYS = 14

CHEST_MAX = 7                      # unopened chests that wait at once
CHEST_MONEY_MIN, CHEST_MONEY_MAX, CHEST_MONEY_STEP = 40, 100, 5
CHEST_STREAK_BONUS = 10            # dollars per chest day in the current run of consecutive chest days
CHEST_MONEY_CAP = 150
CHEST_RARE_CHANCE = 0.20
CHEST_POSTCARD_CHANCE = 0.15
CHEST_PITY_AFTER = 5               # this many chests in a row without a rare item: the next one has one
CHEST_FALLBACK_DOLLARS = 50        # a rare roll with nothing left to give pays this instead

# --------------------------------------------------------------------------
# The NYC events calendar: limited-time experiences by real date window (New York dates) or by live weather.
# --------------------------------------------------------------------------

Window = Callable[[int], tuple[date, date]]


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _md(m1: int, d1: int, m2: int, d2: int) -> Window:
    """A fixed window each year; a window that wraps the new year (Dec to Jan) starts in `year`."""
    def window(year: int) -> tuple[date, date]:
        return date(year, m1, d1), date(year + (1 if (m2, d2) < (m1, d1) else 0), m2, d2)
    return window


def _marathon(year: int) -> tuple[date, date]:
    sunday = _nth_weekday(year, 11, 6, 1)               # the NYC Marathon is the first Sunday in November
    return sunday - timedelta(days=3), sunday + timedelta(days=1)


def _thanksgiving(year: int) -> tuple[date, date]:
    thursday = _nth_weekday(year, 11, 3, 4)             # the parade runs on Thanksgiving morning
    return thursday - timedelta(days=1), thursday


# `window` is a function year -> (first day, last day), both inclusive, in New York time. `weather` events are on whenever the
# live NYC weather condition matches, inside `months` (a snow day in November through April).
EVENTS: list[dict[str, Any]] = [
    {"id": "leaves_riverside", "name": "Fall leaves in Riverside Park", "price": 15, "district": "Morningside Heights", "window": _md(10, 15, 11, 15),
     "blurb": "The park above the river turns orange for a few weeks.", "season": "autumn"},
    {"id": "halloween_parade", "name": "The Village Halloween Parade", "price": 35, "district": None, "window": _md(10, 29, 10, 31),
     "blurb": "Giant puppets and a very long line of costumes up Sixth Avenue.", "season": "autumn"},
    {"id": "marathon_cheer", "name": "Cheering at the NYC Marathon", "price": 20, "district": "Central Park", "window": _marathon,
     "blurb": "Hand out high-fives near the finish line in the park.", "season": "autumn"},
    {"id": "thanksgiving_balloons", "name": "Balloons on Central Park West", "price": 30, "district": "Upper West Side", "window": _thanksgiving,
     "blurb": "The giant balloons are filled the night before, in the streets beside the museum.", "season": "autumn"},
    {"id": "holiday_windows", "name": "The Fifth Avenue holiday windows", "price": 45, "district": "Midtown & Times Square", "window": _md(11, 20, 1, 5),
     "blurb": "Department-store windows with whole little worlds inside.", "season": "winter"},
    {"id": "rockefeller_tree", "name": "The Rockefeller Center tree", "price": 60, "district": "Midtown & Times Square", "window": _md(12, 1, 1, 10),
     "blurb": "A very tall tree, a very small rink.", "season": "winter"},
    {"id": "ball_drop", "name": "The Times Square ball drop", "price": 120, "district": "Midtown & Times Square", "window": _md(12, 30, 1, 1),
     "blurb": "A million people, one countdown.", "season": "winter"},
    {"id": "hot_chocolate_snow", "name": "Hot chocolate on a snow day", "price": 18, "district": None, "weather": "snow", "months": (11, 12, 1, 2, 3, 4),
     "blurb": "It is snowing in New York right now. A paper cup and two gloves.", "season": "winter"},
    {"id": "cherry_blossoms", "name": "Cherry blossoms in the park", "price": 20, "district": "Central Park", "window": _md(4, 5, 4, 25),
     "blurb": "Pink petals on the paths for about two weeks.", "season": "spring"},
    {"id": "smorgasburg", "name": "Smorgasburg on a Saturday", "price": 45, "district": None, "window": _md(4, 4, 6, 14),
     "blurb": "Dozens of food stalls, one paper tray at a time.", "season": "spring"},
    {"id": "shakespeare_park", "name": "Shakespeare in the Park", "price": 50, "district": "Central Park", "window": _md(6, 1, 8, 31),
     "blurb": "An open-air stage and a play under the summer sky.", "season": "summer"},
    {"id": "july_fireworks", "name": "Fireworks over the East River", "price": 60, "district": None, "window": _md(7, 1, 7, 4),
     "blurb": "Barges, crowds on the piers and a very loud finale.", "season": "summer"},
]
EVENT_BY_ID = {e["id"]: e for e in EVENTS}


def event_window(event: dict[str, Any], year: int) -> tuple[date, date] | None:
    fn = event.get("window")
    return fn(year) if fn else None


def title_for(nodes: int) -> tuple[int, str, int]:
    """(index, title, dollars per hour) for a node count."""
    best = 0
    for i, (need, _title, _rate) in enumerate(TITLES):
        if nodes >= need:
            best = i
    return best, TITLES[best][1], TITLES[best][2]
