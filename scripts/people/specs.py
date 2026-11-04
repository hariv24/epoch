"""Epoch people: every character and outfit the build produces (pure data, no Blender imports).

Colours are sRGB hex. A clothing entry is (asset_dir_name, options):
  tint        recolour the asset texture to this colour (keeps the cloth detail from the texture's luminance)
  contrast    detail strength when tinting (1 = as the texture, <1 flatter, >1 punchier)
  sleeve_tint faces skinned mostly to the arm bones get this colour instead (e.g. a varsity jacket's sleeves)
  rough       PBR roughness (default 0.85 for cloth)
  material    use an alternative .mhmat shipped with the asset (system_clothes_materials01 pack)
Accessories built in Blender from primitives (no texture): 'scarf:<hex>', 'backpack:<hex>', 'headphones:<hex>'.
"""

# MakeHuman macro phenotype (0..1). age 0.5 = 25 years; race weights sum to 1.
USER = {
    "id": "user", "role": "user", "name": "You",
    "phenotype": {"gender": 1.0, "age": 0.47, "muscle": 0.58, "weight": 0.55, "proportions": 0.6, "height": 0.45,
                  "cupsize": 0.0, "firmness": 0.5, "race": {"asian": 0.12, "caucasian": 0.52, "african": 0.36}},
    # PEOPLE-SPEC 3: shoulders clearly wider than the hips, flat chest, male read (extra MakeHuman targets, applied before clothes are fitted)
    "targets": [{"target": "torso-vshape-incr", "value": 0.7}, {"target": "measure-shoulder-dist-incr", "value": 0.55},
                {"target": "measure-hips-circ-decr", "value": 0.5}, {"target": "hip-scale-horiz-decr", "value": 0.35},
                {"target": "measure-waist-circ-incr", "value": 0.35}, {"target": "torso-muscle-pectoral-decr", "value": 1.0},
                {"target": "breast-volume-vert-down", "value": 0.5}, {"target": "breast-dist-decr", "value": 0.5}],
    # warm brown skin (the app's code-built figure used #8d5a3b); mean albedo of the processed skin texture
    "skin": {"source": "young_caucasian_male", "target": "#9e6a4a"},
    "eyes": "brown", "iris": "#4a2e1c", "eyebrows": "eyebrow002", "eyelashes": "eyelashes01",
    "hair": ("short01", {"tint": "#141110", "contrast": 0.8}),
}

TEE = ("elvs_crude_t-shirt_male", {})
JEANS = "punkduck_male_classic_jeans"
# the jeans texture has a "Punkduck" duck label patch and a button printed "MAKEHUMAN BLENDER": painted out (no logos or text, SPEC 3)
JEANS_PAINT = [(0.0, 0.385, 0.145, 0.50, "cloth"), (0.035, 0.495, 0.135, 0.585, "#8b929c"), (0.035, 0.575, 0.14, 0.69, "#8b929c")]
HOODIE = "elvs_hooded_sweat_jacket1"
LONGCOAT = "mindfront_cardigan_long_open_front"

# every id in epoch/economy_catalog.py OUTFITS + CHEST_OUTFITS (tests/test_people_assets.py checks this)
OUTFITS = {
    "everyday": [("toigo_basic_tucked_t-shirt", {"tint": "#b4b0bc", "contrast": 0.7, "inflate": 0.004, "short_sleeves": True, "relax_chest": True, "loose": True}),
                 (JEANS, {"tint": "#3d5a80", "contrast": 1.1, "paint": JEANS_PAINT}),
                 ("punkduck_comfortable_sneakers", {"tint": "#efeeea", "contrast": 0.15})],
    "columbia_hoodie": [(HOODIE, {"tint": "#9cc8ef", "contrast": 0.05}),
                        (JEANS, {"tint": "#5b6270"}),
                        ("punkduck_comfortable_sneakers", {})],
    "nyu_hoodie": [(HOODIE, {"tint": "#5b2a86", "contrast": 0.05}),
                   (JEANS, {"tint": "#2e3440"}),
                   ("punkduck_comfortable_sneakers", {})],
    "plain_jersey": [("elvs_male_athletic_tank1", {"tint": "#2c5aa0", "contrast": 0.5}),
                     ("mindfront_male_swimming_trunks_01", {"tint": "#2c5aa0", "contrast": 0.5}),
                     ("punkduck_comfortable_sneakers", {"tint": "#20242c"})],
    "running_gear": [("elvs_crude_t-shirt_male", {"tint": "#ff7a59", "contrast": 0.7}),
                     ("mindfront_male_swimming_trunks_01", {"tint": "#1f232b", "contrast": 0.8}),
                     ("punkduck_comfortable_sneakers", {"tint": "#62dda8", "contrast": 0.8})],
    "library_cardigan": [("mindfront_knitted_sweater_01", {"tint": "#d9c7a3"}),
                         ("toigo_wool_pants", {"tint": "#6b4f3a"}),
                         ("mindfront_shoes_oxford_male", {"tint": "#4a3526"})],
    "winter_coat": [("mindfront_knitted_sweater_02", {"tint": "#2a2d33"}),
                    (LONGCOAT, {"tint": "#3a3f47", "contrast": 0.8, "outer": True}),
                    ("toigo_wool_pants", {"tint": "#2a2d33"}),
                    ("mindfront_shoes_oxford_male", {"tint": "#26211d"}),
                    "scarf:#c8243a"],
    "navy_suit": [("male_elegantsuit01", {"material": "toigo_male_elegant_suit_blue_with_red_striped_tie"}),
                  ("mindfront_shoes_oxford_male", {"tint": "#121318"})],
    "camel_overcoat": [("mindfront_knitted_sweater_02", {"tint": "#2b2a2e"}),
                       (LONGCOAT, {"tint": "#c19a6b", "contrast": 0.8, "outer": True}),
                       ("toigo_wool_pants", {"tint": "#2b2a2e"}),
                       ("mindfront_shoes_oxford_male", {"tint": "#151515"}),
                       "scarf:#2a3346"],
    "yellow_raincoat": [(HOODIE, {"tint": "#f2c230", "contrast": 0.05, "rough": 0.38}),
                        (JEANS, {"tint": "#2e3440"}),
                        ("punkduck_winter_boots", {"tint": "#e0ac1e", "rough": 0.4})],
    "varsity_jacket": [(HOODIE, {"tint": "#1f3a6b", "sleeve_tint": "#efe8d8", "contrast": 0.05}),
                       (JEANS, {"tint": "#3d4250"}),
                       ("punkduck_comfortable_sneakers", {})],
}

# Other people: students and customers. Seeded names; ages ~18-35; mixed genders, ethnicities, body types.
NPCS = [
    {"id": "npc_maya", "name": "Maya", "phenotype": {"gender": 0.0, "age": 0.42, "muscle": 0.5, "weight": 0.45, "height": 0.45,
                                                      "race": {"asian": 0.1, "caucasian": 0.6, "african": 0.3}},
     "skin": {"source": "cutoff3d_indian_female_skin"}, "eyes": "brown", "eyebrows": "eyebrow010",
     "hair": ("long01", {"tint": "#17110d"}),
     "clothes": [("toigo_fisherman_sweater", {"tint": "#8a9a5b"}), ("punkduck_female_tight_jeans", {"tint": "#2f3a55"}),
                 ("toigo_ankle_boots_female", {})], "acc": ["glasses:kwnet_at_optical_glasses"]},
    {"id": "npc_jamal", "name": "Jamal", "phenotype": {"gender": 1.0, "age": 0.5, "muscle": 0.7, "weight": 0.55, "height": 0.6,
                                                        "race": {"asian": 0.0, "caucasian": 0.1, "african": 0.9}},
     "skin": {"source": "young_african_male"}, "eyes": "brown", "eyebrows": "eyebrow002",
     "hair": ("short04", {"tint": "#0f0d0c"}),
     "clothes": [(HOODIE, {"tint": "#3b4a3a", "contrast": 0.05}), ("cortu_cargo_pants", {"tint": "#5a5348"}), ("punkduck_comfortable_sneakers", {})],
     "acc": ["headphones:#1c1c1e"]},
    {"id": "npc_lena", "name": "Lena", "phenotype": {"gender": 0.0, "age": 0.38, "muscle": 0.45, "weight": 0.4, "height": 0.6,
                                                      "race": {"asian": 0.0, "caucasian": 1.0, "african": 0.0}},
     "skin": {"source": "young_caucasian_female"}, "eyes": "bluegreen", "eyebrows": "eyebrow011",
     "hair": ("ponytail01", {"tint": "#a07a4a"}),
     "clothes": [("toigo_basic_tucked_t-shirt", {"tint": "#e8e2d6", "contrast": 0.6}), ("punkduck_female_tight_jeans", {"tint": "#3d5a80"}),
                 ("punkduck_comfortable_sneakers", {})], "acc": ["backpack:#2f3a4a"]},
    {"id": "npc_kenji", "name": "Kenji", "phenotype": {"gender": 1.0, "age": 0.55, "muscle": 0.45, "weight": 0.42, "height": 0.48,
                                                        "race": {"asian": 1.0, "caucasian": 0.0, "african": 0.0}},
     "skin": {"source": "young_asian_male"}, "eyes": "brown", "eyebrows": "eyebrow003",
     "hair": ("short02", {"tint": "#141210"}),
     "clothes": [("elvs_male_shirt_untucked_bd1", {"tint": "#7d96b8", "contrast": 0.7}), ("toigo_wool_pants", {"tint": "#3a3530"}),
                 ("mindfront_shoes_oxford_male", {})], "acc": ["glasses:spamrakuen_tbm_glasses_frames_01"]},
    {"id": "npc_sofia", "name": "Sofia", "phenotype": {"gender": 0.0, "age": 0.48, "muscle": 0.45, "weight": 0.62, "height": 0.4,
                                                        "race": {"asian": 0.1, "caucasian": 0.75, "african": 0.15}},
     "skin": {"source": "toigo_light_skin_female_bronze"}, "eyes": "brown", "eyebrows": "eyebrow006",
     "hair": ("bob02", {"tint": "#2a1a12"}),
     "clothes": [("mindfront_knitted_sweater_02", {"tint": "#8c2f39"}), ("toigo_long_full_skirt", {}),
                 ("toigo_ankle_boots_female", {})]},
    {"id": "npc_marcus", "name": "Marcus", "phenotype": {"gender": 1.0, "age": 0.62, "muscle": 0.5, "weight": 0.7, "height": 0.55,
                                                          "race": {"asian": 0.0, "caucasian": 0.95, "african": 0.05}},
     "skin": {"source": "young_caucasian_male2"}, "eyes": "blue", "eyebrows": "eyebrow002",
     "hair": ("short01", {"tint": "#6b4a2b"}),
     "clothes": [("namuhekam_male_polo_shirt", {"tint": "#2f4f4f"}), (JEANS, {"tint": "#4a5568"}), ("shoes02", {})],
     "acc": ["cap:mindfront_knitted_hat_01:#3a3a3e"]},
    {"id": "npc_aisha", "name": "Aisha", "phenotype": {"gender": 0.0, "age": 0.45, "muscle": 0.5, "weight": 0.5, "height": 0.55,
                                                        "race": {"asian": 0.0, "caucasian": 0.2, "african": 0.8}},
     "skin": {"source": "young_african_female"}, "eyes": "brown", "eyebrows": "eyebrow007",
     "hair": ("afro01", {"tint": "#120e0c"}),
     "clothes": [("mindfront_knitted_sweater_01", {"tint": "#e3b04b"}), ("punkduck_female_tight_jeans", {"tint": "#1f2430"}),
                 ("punkduck_comfortable_sneakers", {})], "acc": ["backpack:#7a2e2e"]},
    {"id": "npc_daniel", "name": "Daniel", "phenotype": {"gender": 1.0, "age": 0.35, "muscle": 0.4, "weight": 0.38, "height": 0.62,
                                                          "race": {"asian": 0.05, "caucasian": 0.9, "african": 0.05}},
     "skin": {"source": "young_caucasian_male"}, "eyes": "brownlight", "eyebrows": "eyebrow005",
     "hair": ("cortu_short_messy_hair", {"tint": "#3b2a1c"}),
     "clothes": [("elvs_crude_t-shirt_male", {"tint": "#4b5b3c", "contrast": 0.7}), ("cortu_cargo_pants", {"tint": "#c2b08a"}),
                 ("punkduck_comfortable_sneakers", {"tint": "#7d8a99", "contrast": 0.8})], "acc": ["headphones:#d9d9d9"]},
    {"id": "npc_priya", "name": "Priya", "phenotype": {"gender": 0.0, "age": 0.52, "muscle": 0.45, "weight": 0.5, "height": 0.38,
                                                        "race": {"asian": 0.15, "caucasian": 0.5, "african": 0.35}},
     "skin": {"source": "cutoff3d_indian_female_skin", "target": "#8f5e40"}, "eyes": "brown", "eyebrows": "eyebrow012",
     "hair": ("braid01", {"tint": "#120d0a"}),
     "clothes": [("mindfront_cardigan_long_open_front", {"tint": "#6d7f99", "outer": True}), ("toigo_basic_tucked_t-shirt", {"tint": "#f2efe9", "contrast": 0.5}),
                 ("punkduck_female_tight_jeans", {"tint": "#2b2f3a"}), ("toigo_ballet_flats", {})]},
    {"id": "npc_leo", "name": "Leo", "phenotype": {"gender": 1.0, "age": 0.45, "muscle": 0.5, "weight": 0.5, "height": 0.5,
                                                    "race": {"asian": 0.2, "caucasian": 0.6, "african": 0.2}},
     "skin": {"source": "toigo_light_skin_male_bronze"}, "eyes": "brown", "eyebrows": "eyebrow001",
     "hair": ("short03", {"tint": "#1d1612"}),
     "clothes": [("mindfront_lusekofta", {}), (JEANS, {"tint": "#26324a"}), ("toigo_ankle_boots_male", {})],
     "acc": ["cap:elvs_male_flat_cap1:#4a4038"]},
    {"id": "npc_hana", "name": "Hana", "phenotype": {"gender": 0.0, "age": 0.4, "muscle": 0.4, "weight": 0.42, "height": 0.35,
                                                      "race": {"asian": 1.0, "caucasian": 0.0, "african": 0.0}},
     "skin": {"source": "young_asian_female"}, "eyes": "brown", "eyebrows": "eyebrow009",
     "hair": ("toigo_blunt_bob_with_bangs", {"tint": "#15110f"}),
     "clothes": [("ews_striped_shirt", {"tint": "#e9e6df", "contrast": 0.9}), ("punkduck_female_tight_jeans", {"tint": "#1e1f24"}),
                 ("toigo_ballet_flats", {"tint": "#1b1b1d"})],
     "acc": ["backpack:#c9b79c"]},
    {"id": "npc_omar", "name": "Omar", "phenotype": {"gender": 1.0, "age": 0.68, "muscle": 0.55, "weight": 0.6, "height": 0.52,
                                                      "race": {"asian": 0.05, "caucasian": 0.75, "african": 0.2}},
     "skin": {"source": "toigo_light_skin_male_bronze", "target": "#a77a5a"}, "eyes": "brown", "eyebrows": "eyebrow008",
     "hair": ("culturalibre_hair_02", {"tint": "#1a1512"}),
     "clothes": [("elvs_male_shirt_untucked_bd1", {"tint": "#e9e4da", "contrast": 0.6}), ("toigo_wool_pants", {"tint": "#2c3446"}),
                 ("mindfront_shoes_oxford_male", {})], "acc": ["beard:wdg_scruffy_beard:#1a1512"]},
]

# LOD triangle budgets (whole character, all meshes) and texture sizes (px, longest side)
LODS = {
    "user": {"close": (15000, 1024), "mid": (4800, 512), "far": (1500, 128)},
    "npc": {"close": (10000, 1024), "mid": (4800, 512), "far": (1500, 128)},
}
