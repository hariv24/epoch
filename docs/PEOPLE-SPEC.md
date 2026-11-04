# Real people in Epoch: detailed spec (agreed direction, 2026-10-23)

**Status:** the assets exist (see docs/PEOPLE.md: 69 GLBs + clips.glb in `epoch/web/static/app/people/`, built from MakeHuman/MPFB2 + Quaternius UAL, all CC0). They are **not wired into the app yet**. **The next step is a PROOF (§7), not a full build.**

## 1. The user's words
- "This still doesn't look like a real character, human-like… is it that hard to replicate something that can really function like a human being?"
- "Whenever sitting or doing some motion the legs and hips get messed up."
- "Why does it look so bad?" (about three.js renders: flat dark skin, a feminine-reading user, people sitting on nothing in a grey void)
- "I told you to give a detailed description every time."

## 2. The quality bar
- **Target:** people that read instantly as **real humans** at the app's camera distances. Think a modern indie or AA life sim, The Sims 4 level: natural proportions, warm living skin, eyes with life, clothes that sit on the body, motion with weight.
- **Not:** cartoon, mannequin, plastic, uncanny, sitting on air, twisted hips.
- **The honest ceiling:** free CC0 MakeHuman assets. Lighting and materials decide most of the result, so they're specified as carefully as the models.

## 3. The user's character (must read at a glance as a young South Indian man)
- **Reference photo (added 10-23):** `hariv photo.png` in the project root, the user's own selfie. It's personal: never copy it into `static/`, never ship or publish it. Use it for the build, hair, skin and tee fit only, not as a face replica (§9). Cues from the photo are folded into the bullets below.
- **Age and body:** about 22–26. Height 1.72–1.75 m. A **solid, slightly stocky build** (photo): broad shoulders, thick upper arms and neck, a flat chest, and a straight torso from ribs to hips (no waist taper, a little fullness at the belly is fine). Shoulder width ÷ hip width ≥ 1.25 on the posed mesh. MakeHuman gender fully male, muscle about 0.55–0.6 with the pectorals flattened (round pecs under a tight tee read as breasts; the v1 proof had this bug), weight slightly above neutral (about 0.55–0.6).
- **Face:** an oval to slightly square jaw, a defined brow, dark brown eyes, full but not heavy eyebrows, clean-shaven (no CC0 stubble exists). Male facial proportions, checked in a straight-on close-up.
- **Skin:** warm medium-brown with a golden undertone, a little lighter and warmer than v1 (texture mean about #9e6a4a, up from #8a5a3c). In daylight the rendered mid-cheek should land near the photo's cheek, about #b07856 in shade to #cb927a lit. It must never look grey, plastic or near-black.
- **Hair:** thick black hair, short and tapered on the sides, with a voluminous, textured top (about 5–7 cm) swept up and back. No buzz cut, no flat helmet, nothing feminine. Pick the closest CC0 MakeHuman hair asset.
- **Face cues (not a replica):** an oval to slightly round face with full cheeks, straight, fairly thick natural dark brows, dark brown eyes, full lips, a broad nose. Clean-shaven or the faintest shadow.
- **Default outfit:** a **regular-fit crew-neck** t-shirt (never scoop-neck, never skin-tight; it hangs straight from the chest) in light heather grey (photo: about #b4b0bc) or white, dark indigo jeans, white sneakers. **No logos or text** on any clothing. Optional later: a white smartwatch on the left wrist.
- **Every store outfit** (economy_catalog OUTFITS, including chest-only ones) on the same body, keeping these male cues.

## 4. Other people (NPCs)
10–12 people, ages 18–35, with mixed genders, ethnicities and body types, and everyday NYC clothes: hoodies, jackets, tees, cardigans, a skirt. 2–3 have glasses, headphones, a cap or a backpack. No logos. Each one's look is seeded, so it's stable between visits.

## 5. Rendering recipe (people must look good in the app's lighting, not just in Blender)
1. **Skin material** (a shared module that every person uses):
   - **Base:** MeshPhysicalMaterial, extended through onBeforeCompile.
   - **Wrap lighting:** diffuse = saturate((N·L + w) / (1 + w)), with w = 0.35–0.5.
   - **Warm subsurface term:** at the light terminator, sss × pow(saturate(1 − |N·L|), 2) × light, with sss colour ≈ #c0502a. Shadow edges go warm and red, never grey.
   - **Surface:** metalness 0, roughness 0.5–0.6, specularIntensity ≈ 0.4, sheen 0.2–0.3 (warm, sheenRoughness 0.6), sensible normalScale.
   - **Colour space:** sRGB for baseColor and emissive; linear for normal and roughness.
2. **Eyes:**
   - A glossy cornea (clearcoat 1, roughness ≈ 0.05), so each eye gets a catchlight.
   - Off-white sclera.
   - Lashes and brows with correct alpha (alphaHash or alphaTest; no sorting halos).
3. **Hair:** alpha-tested cards with correct sorting and backface handling. No see-through head, no white fringes.
4. **Clothes:**
   - Proper colour spaces.
   - No white or blue patches. The current jeans waistband has them: fix the texture alpha or the belt layer.
   - No z-fighting between body and cloth (delete hidden body faces under clothing if needed).
5. **Character lighting** in every scene with people:
   - A PMREM environment from three.js RoomEnvironment (built in) at a low envMapIntensity.
   - A warm key light plus a cool rim light that affect people.
   - Exposure and tone mapping chosen so brown skin keeps its detail by day and night.
   - A blob or contact shadow under feet and seats.

## 6. Animation recipe and checks (the "legs and hips get messed up" bug must die)
**At the source (Blender):**
- Align the rest poses and bone rolls of the Quaternius rig and the MPFB rig **before** baking.
- Scale root and hip translation per character (the clip reference hip is 0.905 m; the user's is 0.923 m).
- Bake with foot locks or IK.
- Sitting clips use a seat target.
- Fix pelvis and upper-thigh skin weights, or use MPFB game-rig weights.

**Each clip must pass, from the front, side and back at key frames, on the user's character and 2 NPCs:**

| Clip | Must | Must not |
|---|---|---|
| sit_idle / sit_type / sit_read / sit_sip | pelvis on the seat; thighs horizontal and parallel; knees at about 90°; shins vertical; feet flat; hands on the laptop or book | sink into the seat, float, collapse or twist thighs, bend knees backwards, lose a hand in the desk |
| walk | heel–toe contact, slight arm swing, a natural stride for the height | foot sliding, knee pop, hip candy-wrapper twist |
| idle / idle_look | subtle breathing, weight shift every few seconds | frozen statue, T-pose flashes |
| wave / cheer / point / dance | readable, quick, returns cleanly to idle | arm passing through the head or body |
| kneel / sleep / stand_stretch | stable contact with floor or bed | limbs inside the bed or floor |

**In the app:**
- Crossfade transitions take 0.25–0.4 s.
- A head look-at toward the laptop, book or window.
- Typing hands rest on the keyboard plane.
- If eyelid bones exist, blink every 3–6 s.

## 7. Process: a PROOF first (this is the next step)
**One cheap, small agent** (start with Sonnet; Opus only if Sonnet's results fall short), **one scene**, then **stop and show the user**:
1. Fix the user character's male read, the crew-neck tee and the jeans patches, and rebuild only the user's everyday outfit (close LOD).
2. Fix the sit clips and walk to pass §6, and rebuild clips.glb.
3. Implement the §5 skin, eye and lighting recipe in a small `city/people.js` (load, clone, mixer, material).
4. Place the user's character in the **Today room** only, in three states: standing at the window (idle_look), reading on the sofa (sit_read), typing at the desk (sit_type).
5. Screenshots: 1280×800, day and night, plus a face close-up and a side view of the seated pose. Before/after against the old figure.
6. **No other scenes, no NPCs in scenes, no review agent.** Report and stop.

Only after the user says the proof looks right: wire the remaining scenes (Butler with students, café, rooftop, the city walk, store turntables), then one review.

## 8. Performance and fallbacks
- Room scene with the user ≤ ~150k triangles. Butler with 8–10 people ≤ 180k laptop / ≤ 120k tablet (mid and far LODs).
- 60 fps laptop, ≥ 30 fps tablet while animating. Render on demand; 0 idle frames under reduced motion.
- Keep the old code-built figure as an automatic fallback if loading fails.

## 9. Non-goals (for now)
Facial animation and lip sync, cloth simulation, hair physics, the user's real face from a photo.

## 10. Direction v3: Mixamo people + motion capture (agreed 2026-10-23 evening)
**Why:** the user rejected the MakeHuman build as "slop": unnatural hands, a chest-out stance, a book he couldn't hold. The cause was agent-authored poses and bodies. The user's words: "It doesn't have to look like me. It has to look like a normal human being. Normal chest, normal legs, normal hands." From now on, **bodies come from an artist and motion comes from motion capture.** Agents only place, blend and attach props, and never author bone poses.
- **Source:** Mixamo (free Adobe login; the user downloads, never an agent). Licence: free to use inside the app, **never redistribute the raw files**. This is a deliberate exception to the CC0 rule. Raw FBX goes in `build/mixamo/` (gitignored). The converted GLBs must stay out of any public repo or demo page.
- **Characters (8):** 1 user (a normal young man, casual clothes) + 7 NPCs (mixed men and women, casual student clothes; no mannequins, armour, fantasy or zombies).
- **Download settings:** characters FBX Binary + T-pose. Animations with the **user's character selected**, FBX Binary, **Without Skin**, 30 fps, no keyframe reduction, **In Place** for any walk or jog.
- **Clip list** (search terms; the user picks the most natural variant):
  - Proof: sitting idle, typing, sitting reading, idle, looking around, stand to sit, sit to stand, walking.
  - Home: drinking (standing and seated), playing piano, 2 calm dances, sleeping/laying, stretching, yawn, texting, picking up / kneeling (chest + box unpack), watering (skip if none), telescope or looking through (skip if none).
  - Reactions: waving, cheering, clapping, victory/fist pump, pointing.
  - Study spots and street: writing (seated), sitting talking, sitting laughing, thinking, leaning (rail), talking (standing), talking on phone, 2 more walk variants, jogging, 2 more idle variants, waiting.
- **Props attach to hand bones** (book, mug, phone, pen). Seats are placed so the pelvis meets the seat. Hands meet the keyboard by moving the chair or desk, never by editing bones.
- §5 (lighting, contact shadows) and §6 (checks) still apply. §3's photo cues are dropped: a normal human is the bar, not a likeness.

### 10.1 What the user actually downloaded (2026-10-23, `maxiamo/`, gitignored)
- **Characters: use all 17** (the user's words: "don't skip any characters… I need every one of them"). Private app only, so keep the game-IP ones out of any public demo. Each needs the CC-BY credit from its GLB's `asset.extras`.
  - **Mixamo bones, use directly (10):** antony, duke, mr_froggle, maria (Egunoff LOD series), tbg leather jacket, free_animated_male, middle-aged suit, mapontes worker, michelle, casual_npc_woman.
  - **Mixamo-like bones, name-map them (3):** indian_man_in_suit (`Hips_01`… suffixes), mixamo-_alexis (`Alexis:` prefix, cm units), taunt (`Hips_81`… suffixes).
  - **Unreal-style bones, retarget them (1):** mint_swimsuit (`pelvis`, `spine_01`…, 4 skins, 101k tris). Map Mixamo → UE names and retarget on rest-pose differences (SkeletonUtils.retargetClip or Blender), never hand-posed.
  - **No rig (3):** stefano (clean T-pose), women_hot (A-pose), mai_shiranui (a posed statue, hand on hip; 2M tris). Converted to clean FBX in `maxiamo/to_rig/` (≤100k tris, 1.75 m, feet at 0) for the **user to auto-rig on Mixamo**. mai's pose means auto-rig will deform badly, so she stays a static figure unless the user's Mixamo result looks fine.
- **Clips:** 51 loose FBX plus the packs, unzipped into `maxiamo/<Pack>/`: Locomotion (walk, run, turns, strafes, jump), Free Test (samba, gangnam style, back flip), Soccer (jog forward/backward/strafe, standing up, fallen idle, kicks), Male Drunk (drunk idle/walk), Breakdance (34 moves).
- **Substitutes for clips Mixamo didn't have.** All mocap; never author poses.

| Missing clip | Use instead |
|---|---|
| jogging | Soccer `jog forward` |
| calm dance / records | `samba dancing`, `Happy Idle` sway |
| piano | `Typing` at the piano bench |
| reading on the sofa | `Sitting Idle` with an open book resting on the lap |
| reading in the library | `Writing` with a notebook |
| looking around / window / telescope / leaning / thinking / waiting | `Breathing Idle`, `Happy Idle`, `Idle`, `Old Man Idle`, `Standing W_Briefcase Idle`, `Texting While Standing`; the body faces the target |
| bed | `Laying Sleeping` / `Sleeping Idle`; getting up is `Waking` |
| chest | `Kneeling Inspecting` |
| store box | `Picking Up from floor` |
| big wins (level up, Seven Clear Days) | breakdance moves, `back flip to uppercut`, `Victory`, `Fist Pump` |
| park | Soccer clips |

### 10.2 Update, late 10-23: the user's character, the roster, and "things pass through"
- **The user's character is Dylan** (`dylan_-_lod_man_character.glb`, Egunoff, CC-BY-4.0), **named "Hariv"** everywhere in the app (ids, labels, file names such as `hariv.glb`). The credit keeps the original title and author: "Dylan – LOD man character by Egunoff, used as Hariv".
- **New NPCs** (all Mixamo-rigged, CC-BY):
  - Egunoff: andrew, serj, dude, gordon (men); sara, veronica, mrsnoodle, nancy (women).
  - ustoopia: police_man (29 joints, likely no finger bones).
  - Antony and Duke become NPCs.
- **Skipped (the user's call):** stefano, women_hot, mai_shiranui. Don't use the `to_rig/` FBX files.
- **The user's complaint:** "the items created by you just seem to pass through": the mug in the hand, the hand at the desk by the window, sitting on the sofa. The rules below are a generic system every scene uses (room, Butler, café, rooftop, park), not per-shot tweaks:
  1. **Clearance check (verifiable):** a debug function samples the active clip at 24 frames, computes skinned vertex positions (three.js `SkinnedMesh.applyBoneTransform`, decimated sampling is fine) against every nearby furniture and prop volume (OBB), and prints the max penetration in cm per object.
     - Gate: **≤ 1 cm** everywhere.
     - Exceptions are the *designed contacts*, each within ±1.5 cm: pelvis and thighs on the seat top, feet on the floor, fingertips on the keyboard plane, forearms resting on a desk or table top.
     - Clearance from everything else (desk edges and apron, chair back, sofa arms, window sill, radiator, walls) is **≥ 2 cm**.
  2. **Placement solver:** for each activity anchor (a furniture item + a clip), search the character's offset relative to that furniture (x/z ±20 cm in 1 cm steps, yaw ±15°) to pass the gate. Cache the result per furniture type + clip + character, so it isn't re-solved per frame.
     - Anchors are relative to the furniture, so they survive decorate mode moving it.
     - If nothing passes, adjust the furniture's seat or desk height within real-world ranges (seat 38–48 cm, desk 72–76 cm). Never edit bones.
  3. **Held props sit in the grip:**
     - Each prop gets a grip frame computed from the hand bones in the clip (thumb and index/middle finger joints), so the fingers wrap the handle or cover.
     - Gate: prop-vs-finger penetration **≤ 0.5 cm** over the whole clip.
     - Real sizes: mug Ø 8 cm × 9.5 cm with a handle; book 15 × 22 × 2.5 cm; phone 7 × 15 × 0.8 cm.
     - Props are simple procedural objects, but with bevels and real proportions, not slabs.
  4. **Reading** (no reading clip exists): `Sitting Idle` with the open book **resting on the thighs** (placed from the thigh bones at the clip's rest frame), never floating in the hands.
  5. **Standing spots** (window, telescope, rail): a free floor spot ≥ 15 cm from all furniture over the whole clip, with the body facing the target.
- The proof for 10.2 is the Today room only (desk typing, sofa tea, sofa reading, window), with close-up crops of every contact area and the printed clearance report. Only then do the scenes get wired.
