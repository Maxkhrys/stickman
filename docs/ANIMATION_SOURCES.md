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
| idle | Basic Shooter Pack / rifle aiming idle | full body at rest; upper-body aim base while moving; grip calibration |
| walkF/B/L/R | Magic Locomotion Pack / Standing Walk Forward/Back/Left/Right | directional walk (lower body) |
| runF/B/L/R | Magic Locomotion Pack / Standing Run Forward/Back/Left/Right | directional run |
| sprint | Magic Locomotion Pack / Standing Sprint Forward | fast forward run / post-dash |
| crouchIdle | Pro Sword and Shield Pack / sword and shield crouch idle | crouch stance |
| jump, tuck, reach, land | Basic Shooter Pack / rifle jump (frames 2–9, 8–12, 12–15, 15–18) | takeoff, rising, apex, landing |
| fall | Action Adventure Pack / falling idle | long drops |
| reload, fire | Basic Shooter Pack / reloading, firing rifle | torso motion (hands stay on the weapon via IK) |
| walkSniper | Max / walking with sniper.glb — "walking holding a sniper.001" (frames 18–54, one step cycle) | forward walk with the sniper out |
| walkSniperAdsR | Max / same file — "aimed down sights with sniper walking.001" (frames 30–66) | scoped sidestep right |
| walkSniperAdsL | the above, mirrored left/right | scoped sidestep left |

Max's file is a Tripo export on the yellow robot's own rig (same rest pose), so it retargets onto the
robot unchanged and onto the armored character through the same swing alignment. Its export runs
4⅙ step cycles; one clean cycle was cut so it blends in phase with the other walks.

Weapon models (`public/assets/weapons/`) were supplied by Max: AR (textured), sniper, pistol, compact
gun. Their grip, support-hand, muzzle and eye sockets are in `src/config/weaponModels.ts`.
