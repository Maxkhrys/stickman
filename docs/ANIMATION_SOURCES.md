# Animation sources

Both character rigs (armored default, yellow robot) use Mixamo bone names. Clips are retargeted
offline by `tools/anim/bake-robot.mjs` into rig-local int16 quaternions (`public/assets/<char>/anims.json`)
and sampled by hand at runtime (`src/render/robot/clips.ts`). The raw packs are not in the repo (size +
licence); they come from the shared animation collection in the anthonysadveture repo.

```bash
# <packs> holds "Basic Shooter Pack/", "Magic Locomotion Pack/", ..., "Singles/" and "Max/"
node tools/anim/bake-robot.mjs bake <packs> public/assets/robot/anims.json
CHAR_GLB=public/assets/armored/armored.glb node tools/anim/bake-robot.mjs bake <packs> public/assets/armored/anims.json
node tools/asset/lod.mjs 0.12 0.03 public/assets/armored/armored.glb public/assets/robot/robot.glb public/assets/weapons/*.glb   # distance LOD
```

Retargeting: each target bone takes the source bone's world rotation change from its rest pose, after
a swing that aligns the two rigs' rest bone directions (`W = Δ · C · R0`), so A-pose and T-pose rigs and
different bone axes all line up. Hip travel is scaled by hip height. Loops are baked in place (the
controller owns movement); the planted-foot speed ("stride") and left-foot contact phase ("sync") are
measured so locomotion phase-locks to ground speed without foot sliding.

| Runtime clip | Source | Used for |
|---|---|---|
| idle | Basic Shooter Pack / rifle aiming idle | grip calibration (the hand-to-weapon frame is measured from this pose); fallback when `idleUp` is missing |
| walkF/B/L/R | Magic Locomotion Pack / Standing Walk Forward/Back/Left/Right | directional walk (lower body) |
| runF/B/L/R | Magic Locomotion Pack / Standing Run Forward/Back/Left/Right | directional run |
| sprint | Magic Locomotion Pack / Standing Sprint Forward | fast forward run / post-dash |
| jump, tuck, reach, land | Basic Shooter Pack / rifle jump (frames 2–9, 8–12, 12–15, 15–18) | takeoff, rising, apex, landing |
| fall | Action Adventure Pack / falling idle | long drops |
| reload, fire | Basic Shooter Pack / reloading, firing rifle | baked but not currently played (reload and fire are driven by the weapon IK) |
| walkSniper | Max / walking with sniper.glb — "walking holding a sniper.001" (frames 18–54, one step cycle) | forward walk with the sniper out |
| walkSniperAdsR | Max / same file — "aimed down sights with sniper walking.001" (frames 30–66) | scoped sidestep right |
| walkSniperAdsL | the above, mirrored left/right | scoped sidestep left |

| idleUp | Locomotion Pack / idle | relaxed upright stance: legs, hips and spine at rest, and the crouch (the hips drop, leg IK bends the knees) |
| roll | Singles / Sprinting Forward Roll (frames 11–35, 1.6x) | ground dash = dodge roll (full body, `MOVE.rollTime`) |
| rollLand | Action Adventure Pack / falling to roll (frames 10–44, 1.5x) | hard landing while moving (visual only) |
| hardLand | Action Adventure Pack / hard landing (frames 8–48, 2x) | hard landing standing still: lower-body absorb |
| hitFront | Basic Shooter Pack / hit reaction | flinch from the front (spine, neck, head) |
| hitL, hitR | Singles / Standing React Large From Left (R is mirrored) | flinch from the sides |
| hitBack | Singles / Standing React Large From Back | flinch from behind |
| death | Pro Sword and Shield Pack / sword and shield death | death fall, faces the shooter, replaces the old procedural tip-over |
| meleeGuard | Pro Sword and Shield Pack / sword and shield idle (4) | arms while the pencil is out (the chest keeps the upright idle) |
| meleeLight, meleeLightB | Pro Sword and Shield Pack / slash (3) and slash, strike portions at 2.4–2.6x | alternating quick cuts |
| meleeHeavy | Pro Sword and Shield Pack / attack (2), 1.8x | lunging stab; its thrust lands at the heavy attack's 0.3 s windup |


Max's file is a Tripo export on the yellow robot's own rig (same rest pose), so it retargets onto the
robot unchanged and onto the armored character through the same swing alignment. Its export runs
4⅙ step cycles; one clean cycle was cut so it blends in phase with the other walks.

Weapon models (`public/assets/weapons/`) were supplied by Max: AR (textured), sniper, pistol, compact
gun. Their grip, support-hand, muzzle and eye sockets are in `src/config/weaponModels.ts`.

## Other clips in the collection that were judged and not used

Seen in the in-engine pose sheets (`poselab.html`, `robotlab.html`) and left out on purpose: Magic Locomotion's
standing idle (a wide caster stance), the sword-and-shield crouch idle (a sitting squat with elbows on the
knees), the crouched-sneaking and cover clips (a deep stalking hunch), sword-and-shield idles and run (guard
stance legs). The sword and shield kick is a good candidate for a future melee kick. Longbow locomotion
(walk/run in four directions plus run-to-stop) and the Locomotion Pack strafes are alternatives to the Magic
set if the cadence ever needs changing; `bake-robot.mjs catalog` measures any of them.

## Preview sheets

`poselab.html` runs the real `RobotRenderer` on static fighters: `?set=stance|melee|roll|react|moves&view=side&zoom=2.4&t=2.4&char=armored`
(add `&dump=1` to log spine bone positions). `robotlab.html?char=armored&clips=idleUp,roll,...&phases=6&view=side`
shows raw baked clips on either rig.
