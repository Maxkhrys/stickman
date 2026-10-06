# Animation fix and combat feel pass

Follow-up to the sniper and movement upgrade. Branch `claude/clever-planck-b246gl` (on top of
`claude/sniper-movement-upgrade-bxz6or`). Nothing here touches production.

## What was wrong

Max's recording showed the armored character hunched, craning her head forward with her butt pushed out,
arms splayed with open hands when the pencil was out, and a squat that read as sitting. Pose sheets rendered
through the real `RobotRenderer` (`poselab.html`) found the causes:

1. **A math bug, present since the first robot commit.** `rotateWorld(bone, q)` was called with the shared
   scratch quaternion as `q`, and it overwrote that scratch before using it, so every spine bone (and the head)
   had its own world rotation *squared* instead of being nudged by the aim pitch. That is the hunch, the
   craned neck and the pushed-out hips, for every character in every pose, including walking. Fixed in
   `src/render/robot/RobotRenderer.ts` (`rotateWorld` copies its argument first).
2. **Melee had no animation at all.** With the pencil out, the arms kept the rifle-aiming idle pose with
   no weapon in them: the splayed hands in the recording. It now has a guard stance, swing clips and a
   pencil model in the hand (see below).
3. **Crouch looked like sitting.** It used the sword-and-shield crouch idle, a deep squat with elbows on
   the knees. Crouch is now the relaxed upright stance dropped at the hips; the two-bone leg IK bends the
   knees and keeps the feet planted, the same path crouch-walking already used.
4. **The idle was a deep, bladed rifle stance** for the whole body. The legs and spine now use the Locomotion Pack
   idle, an upright relaxed stance. The arms still go onto the weapon through IK.

## New in this pass

| Feature | Where | Notes |
|---|---|---|
| **Dodge roll** | sim `rollTimer` (`src/sim/movement.ts`), `MOVE.rollTime` 0.5 s, `MOVE.rollLowTime` 0.36 s | A ground dash is a roll in the dash direction. Body tucks: hitboxes use the crouch profile (head 1.60 m to 0.95 m) for the first 0.36 s. Air dashes, jumping and sliding never roll; jumping out of a roll cancels it. Movement distances and charges are unchanged. |
| Roll animation | `roll` clip, full body, gun rides in the hand | faces the dash direction, so a left dash rolls left |
| Landing roll / heavy landing | `rollLand`, `hardLand` clips | fall speed > 9 m/s while moving: tuck and roll (visual only, no speed loss). Fall > 12 m/s standing: deep lower-body absorb |
| **Hit reactions** | `hitFront/L/R/Back` clips plus a bullet-direction torso jerk | direction comes from the bullet vs the fighter's facing |
| **Death** | `death` clip | plays facing the shooter, replaces the tip-over |
| **Melee ("Pencil")** | `meleeGuard`, `meleeLight`, `meleeLightB`, `meleeHeavy` | light = alternating cuts, heavy = lunging stab timed so the thrust lands at the 0.3 s windup. Procedural 3D pencil in the right hand |
| First-person melee | camera-relative IK hand path | the third-person clips play below the screen from the head camera, so first person drives the pencil hand along its own path (same timing) |
| Dash / roll feedback | `GameRenderer.dashFx`, `Sfx.dash`, `Sfx.airJump` | FOV punch, camera dip, a first-person lean into the roll (up to 11.5 degrees, eased), whoosh sound (also for other fighters, spatial). Air jump gets a chirp |

Tuning knobs: `MOVE.rollTime`, `MOVE.rollLowTime` (set it to 0 to remove the low profile),
`ROLL_TIME` / `HURT_TIME` / `PENCIL_SCALE` in `RobotRenderer.ts`, `MELEE_PATHS` for the first-person swing
paths, and the `PICKS` table in `tools/anim/bake-robot.mjs` for every clip (then re-run the bake commands
in `ANIMATION_SOURCES.md`).

## Verification

* `npm test`, `npm run test:movement` (five new roll checks), `npm run test:upgrade`, `npm run build`.
* Pose sheets of the real renderer: `poselab.html?set=stance|melee|roll|react|moves&view=side` on both rigs.
* In-game frame captures through the deterministic stepper: run, roll, melee (third and first person),
  hit, death, hard and rolling landings.
* Not measured: frame rate on real hardware (this container has no GPU). The additions are one extra
  mesh per melee fighter, a few more clips sampled per fighter, and nothing per frame beyond that. The
  clip file grew from about 0.4 MB to 0.8 MB per character (the 8-second upright idle is the largest clip).

## Known limitations

* The roll is a forward tumble turned toward the dash direction, so a backward dash tumbles backward in
  the same forward-roll motion rather than a true back-roll.
* Roll and death clips are full body with no IK, so feet can float or sink a few centimetres on slopes.
* Hit reactions drive only the spine, neck and head: the arms stay on the gun so aim stays readable.
* Slide is still the procedural pose (hips drop, legs IK to the slide ankles, lean back).
* Third-person melee uses sword-and-shield clips, so the pencil is gripped like a sword. A purpose-made
  pencil set (below) would look better.

## Animations worth generating (Tripo text to animation)

Tripo exports on the robot's rig import unchanged (that is how Max's sniper walk worked). Each prompt
should say in place, no travel, and loop where noted. In rough order of value:

1. **Slide**: "A soldier sliding on the ground feet first, leaning back, one leg extended and one knee bent, holding a rifle in both hands pointing forward. In place, hold the pose with a slight sway. Loop."
2. **Side dodge rolls** (left and right, with a rifle): "A soldier does a quick sideways dodge roll to the left holding a rifle close to the chest and comes up in a ready stance. In place, 0.8 seconds."
3. **Crouch walk with rifle** (forward, back, left, right): "A soldier crouch-walking forward in a low stance, rifle held at the shoulder pointing forward, torso upright. In place, one step cycle, loop."
4. **Pencil melee**: "A fighter holding a pencil like a short sword does a fast horizontal slash from right to left. In place, 0.5 seconds." Plus "a fast backhand slash back from left to right", "a lunging stab straight ahead with the pencil, step forward and recover", and "a stealthy backstab: step behind and drive the pencil down".
5. **Sniper bolt action**: "A soldier cycles the bolt of a sniper rifle: pull back sharply, push forward, lock down, then settles back into aiming. Upper body only, 1 second."
6. **Air dash and double jump**: "A soldier air dashing forward, body leaning almost horizontal, legs trailing, rifle held in both hands" and "a soldier does a second mid-air jump with a quick forward flip, tucked, then opens up to fall."
7. **Headshot reaction and death variants**: "Head snaps back from a bullet hit, the soldier staggers one step back", "falls backward after a headshot and lies still", "collapses forward onto knees then face down".
8. **Weapon switching**: "A soldier lowers a rifle and draws a pistol from the hip in half a second", "slings the rifle onto the back and raises a sniper rifle to the shoulder".
9. **Vault and mantle**: "A soldier vaults over a waist-high wall in one fluid motion" and "climbs onto a ledge at chest height."
10. **Emotes / victory**: "A soldier spins a rifle in the hand and holds it up in victory."
