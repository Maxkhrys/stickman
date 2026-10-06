# Animation sources

Both character rigs (armored default, yellow robot) use Mixamo bone names. Clips are retargeted
offline by `tools/anim/bake-robot.mjs` into rig-local int16 quaternions (`public/assets/<char>/anims.json`)
and sampled by hand at runtime (`src/render/robot/clips.ts`). The raw packs are not in the repo (size +
licence); the Mixamo packs come from the shared animation collection in the anthonysadveture repo, and the
Tripo exports are Max's own files.

```bash
# <packs> holds "Basic Shooter Pack/", "Magic Locomotion Pack/", ..., "Singles/" and "Max/" (Max/all.glb is
# the Tripo export "Update all animations")
node tools/anim/bake-robot.mjs bake <packs> public/assets/robot/anims.json
CHAR_GLB=public/assets/armored/armored.glb node tools/anim/bake-robot.mjs bake <packs> public/assets/armored/anims.json
node tools/asset/lod.mjs 0.12 0.03 public/assets/armored/armored.glb public/assets/robot/robot.glb public/assets/weapons/*.glb   # distance LOD
```

Retargeting: each target bone takes the source bone's world rotation change from its rest pose, after
a swing that aligns the two rigs' rest bone directions (`W = Δ · C · R0`), so A-pose and T-pose rigs and
different bone axes all line up. Hip travel is scaled by hip height. Loops are baked in place (the
controller owns movement); the planted-foot speed ("stride") and left-foot contact phase ("sync") are
measured so locomotion phase-locks to ground speed without foot sliding. The bake log prints, per clip,
the net hip travel and planted-foot direction (0 = forward, +90 = left), which is how the direction of each
Tripo clip was checked.

## Mixamo clips

| Runtime clip | Source | Used for |
|---|---|---|
| idle | Basic Shooter Pack / rifle aiming idle | grip calibration (the hand-to-weapon frame is measured from this pose); fallback when `idleUp` is missing |
| idleUp | Locomotion Pack / idle | relaxed upright stance: legs, hips and spine at rest (arms are IK'd onto the weapon) |
| walkF/B/L/R | Magic Locomotion Pack / Standing Walk Forward/Back/Left/Right | directional walk (lower body) |
| runF/B/L/R | Magic Locomotion Pack / Standing Run Forward/Back/Left/Right | directional run |
| sprint | Magic Locomotion Pack / Standing Sprint Forward | fallback when `sprintRifle` is missing |
| jump, tuck, reach, land | Basic Shooter Pack / rifle jump (frames 2–9, 8–12, 12–15, 15–18) | takeoff, rising, apex, landing |
| fall | Action Adventure Pack / falling idle | long drops |
| hardLand | Action Adventure Pack / hard landing (frames 8–48, 2x) | hard landing standing still: lower-body absorb |
| hitFront | Basic Shooter Pack / hit reaction | flinch from the front (spine, neck, head) |
| hitL, hitR | Singles / Standing React Large From Left (R is mirrored) | flinch from the sides |
| hitBack | Singles / Standing React Large From Back | flinch from behind |
| death | Pro Sword and Shield Pack / sword and shield death | death fall, faces the shooter, replaces the old procedural tip-over |
| meleeGuard | Pro Sword and Shield Pack / sword and shield idle (4) | arms while the pencil is out (the chest keeps the upright idle) |
| meleeLight, meleeLightB | Pro Sword and Shield Pack / slash (3) and slash, strike portions at 2.4–2.6x | alternating quick cuts |
| meleeHeavy | Pro Sword and Shield Pack / attack (2), 1.8x | lunging stab; its thrust lands at the heavy attack's 0.3 s windup |
| reload, fire | Basic Shooter Pack / reloading, firing rifle | baked but not currently played (reload and fire are driven by the weapon IK) |

## Max's Tripo pack ("Update all animations", `Max/all.glb`)

A Tripo export on the yellow robot's own rig (same rest pose), 16 clips of 5 s at 24 fps each. It retargets
onto the robot unchanged and onto the armored character through the same swing alignment. The action sits
somewhere inside each 5 s window, so every clip is trimmed: `tools/anim/loops.mjs` finds whole gait cycles
(walks, crouch walks, sprint) and `tools/anim/windows.mjs` shows where the action starts and ends (rolls,
slide, reactions). `bake-robot.mjs glb <file> <out.json>` bakes every clip whole to look at them
(`robotlab.html?lib=...`).

| Runtime clip | Tripo clip and window | Used for |
|---|---|---|
| walkSniper | walking holding a sniper, 1.57–2.73 s (one cycle) | forward walk with the sniper out |
| walkSniperAdsR / L | aimed down sights with sniper walking, 1.8–2.93 s (L mirrored) | scoped sidestep right / left |
| roll | armed with rifle roll, 0.73–2.97 s at 4.4x | forward dodge roll (ground dash) and the landing roll |
| rollR, rollL | Side dodge rolls right / left holding a rifle, at 5.3x | sideways dash: the body keeps facing the aim |
| sideDive, sideDiveL | sideways armed with rifle roll fast dive, at 5x (L mirrored) | backward dash (the clip dives back and to the right) |
| crouchIdle | Crouch walk with a rifle forward, first frame | crouch stance at rest |
| crouchF, crouchB, crouchL, crouchR | Crouch walk with a rifle forward / backwards / left / right, one gait cycle each | crouch locomotion (replaces the walk and run family while crouched) |
| slideHold | Slide with a rifle, a still frame of the squat | pose while sliding |
| slideExit | Slide with a rifle, 3.5–4.5 s at 3.2x | the stand-up when a slide ends |
| sprintRifle | sprinting with rifle aggressive, 1.63–2.23 s (one cycle) | full-speed forward run |
| headshot | Headshot reaction, 1.6–3.8 s at 3.5x | head and torso snap on a headshot hit |
| bolt | Sniper bolt action, 0.47–2.33 s at 2.2x | chest and head motion during the bolt cycle (hands stay on the weapon IK) |

Not used: `running forward fast empty handed hands swinging` (a single run burst that cannot loop, and
unarmed arms) and `sprinting empty handed aggressive` (the export is a character standing still).
Tripo's crouch strafes travel at about 0.6 m/s with short steps; at the 3 m/s crouch speed the gait
cadence is capped (`MAX_CYCLES` in `RobotRenderer.ts`) so the feet slide a little instead of the legs
running in fast forward.

Weapon models (`public/assets/weapons/`) were supplied by Max: AR (textured), sniper, pistol, compact
gun. Their grip, support-hand, muzzle and eye sockets are in `src/config/weaponModels.ts`.

## Other clips in the collection that were judged and not used

Seen in the in-engine pose sheets (`poselab.html`, `robotlab.html`) and left out on purpose: Magic Locomotion's
standing idle (a wide caster stance), the sword-and-shield crouch idle (a sitting squat with elbows on the
knees), the crouched-sneaking and cover clips (a deep stalking hunch), sword-and-shield idles and run (guard
stance legs), the Sprinting Forward Roll and Falling To Roll (replaced by Max's armed rolls, which keep the
rifle in the hands). The sword and shield kick is a good candidate for a future melee kick. Longbow
locomotion (walk/run in four directions plus run-to-stop) and the Locomotion Pack strafes are alternatives
to the Magic set if the cadence ever needs changing; `bake-robot.mjs catalog` measures any of them.

## Preview sheets

`poselab.html` runs the real `RobotRenderer` on static fighters:
`?set=stance|crouchwalk|melee|roll|rolldirs|react|walks|moves&view=side|front&zoom=2.4&t=2.4&char=armored`
(`roll` takes `&rdir=` degrees from the aim: 0 forward, 90 right, 155 back-right; add `&dump=1` to log spine
bone positions). `robotlab.html?char=armored&clips=idleUp,roll,...&phases=6&view=side` shows raw baked clips on
either rig.
