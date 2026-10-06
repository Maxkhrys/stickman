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
   the knees. Crouch now uses Max's crouch-walk clips (second pass, below); without them it falls back to
   the upright stance dropped at the hips with the two-bone leg IK bending the knees.
4. **The idle was a deep, bladed rifle stance** for the whole body. The legs and spine now use the Locomotion Pack
   idle, an upright relaxed stance. The arms still go onto the weapon through IK.

## New in this pass

| Feature | Where | Notes |
|---|---|---|
| **Dodge roll** | sim `rollTimer` (`src/sim/movement.ts`), `MOVE.rollTime` 0.5 s, `MOVE.rollLowTime` 0.36 s | A ground dash is a roll in the dash direction. Body tucks: hitboxes use the crouch profile (head 1.60 m to 0.95 m) for the first 0.36 s. Air dashes, jumping and sliding never roll; jumping out of a roll cancels it. Movement distances and charges are unchanged. |
| Roll animation | `roll`, `rollL`, `rollR`, `sideDive` clips (Max's), full body, gun rides in the hand | the clip follows the dash direction relative to the aim: forward = forward roll, sideways = side roll while still facing the aim, backward = back dive |
| Landing roll / heavy landing | `roll`, `hardLand` clips | fall speed > 9 m/s while moving: tuck and roll (visual only, no speed loss). Fall > 12 m/s standing: deep lower-body absorb |
| **Hit reactions** | `hitFront/L/R/Back` clips plus a bullet-direction torso jerk | direction comes from the bullet vs the fighter's facing |
| **Death** | `death` clip | plays facing the shooter, replaces the tip-over |
| **Melee ("Pencil")** | `meleeGuard`, `meleeLight`, `meleeLightB`, `meleeHeavy` | light = alternating cuts, heavy = lunging stab timed so the thrust lands at the 0.3 s windup. Procedural 3D pencil in the right hand |
| First-person melee | camera-relative IK hand path | the third-person clips play below the screen from the head camera, so first person drives the pencil hand along its own path (same timing) |
| Dash / roll feedback | `GameRenderer.dashFx`, `Sfx.dash`, `Sfx.airJump` | FOV punch, camera dip, a first-person lean into the roll (up to 11.5 degrees, eased), whoosh sound (also for other fighters, spatial). Air jump gets a chirp |

Tuning knobs: `MOVE.rollTime`, `MOVE.rollLowTime` (set it to 0 to remove the low profile),
`ROLL_TIME` / `HURT_TIME` / `PENCIL_SCALE` in `RobotRenderer.ts`, `MELEE_PATHS` for the first-person swing
paths, and the `PICKS` table in `tools/anim/bake-robot.mjs` for every clip (then re-run the bake commands
in `ANIMATION_SOURCES.md`).

## Second pass: Max's "Update all animations" pack

Max's 16-clip Tripo export (`Max/all.glb`) is baked in and wired up. What each clip does in the game:

| Clip | Where it plays |
|---|---|
| Armed rifle roll, side dodge rolls left and right, sideways dive | The dodge roll, chosen from the dash direction relative to the aim (forward / left / right / back). Sideways rolls keep the body facing the aim. The forward roll is also the landing roll |
| Crouch walk forward, back, left, right | Crouch locomotion, blended in as the stance lowers; the first frame is the crouch idle. Cadence is capped so Tripo's short steps do not run in fast forward at crouch speed |
| Slide with a rifle | A held squat while sliding, and the stand-up when the slide ends. Procedural hip drop and foot IK are bypassed |
| Sprinting with a rifle | Full-speed forward run (replaces the Mixamo sprint) |
| Walking with a sniper, aimed-down-sights walking | The sniper carry walk and scoped sidestep, re-cut from the new export (one gait cycle each) |
| Headshot reaction | A hit that lands on the head plays this instead of the directional flinch, plus a procedural head throw |
| Sniper bolt action | Chest and head motion while the bolt cycles (the hands stay on the weapon IK) |
| Running / sprinting empty handed | Not used: one cannot loop and the other is a character standing still |

First person: Max's crouch clips lean the head and shoulders well forward of the hips, which put the chest in the
camera. The local body is now slid back (up to 0.45 m) and down (up to 0.4 m) so the head sits over the
camera like a standing head does; the arms, gun IK and bolt/reload hand paths are solved from the shifted
body. Third-person is unaffected.

The Mixamo roll, landing roll and crouch idle they replace are gone from the bake, so the clip files stay
around 1.1 MB per character. `tools/anim/loops.mjs` and `windows.mjs` are the tools that found each clip's
window; `bake-robot.mjs glb` bakes a whole file for them.

## Third pass: weapons held, smoother camera, centre dot

**Weapons floating away from the arms.** Max's recording showed the gun hanging in front of the face while the
arms did their own thing. Measuring it (`poselab.html?...&gaps=1` prints how far each hand is from the gun) showed
the support hand missing the handguard by 12-30 cm in most poses, standing still included, and it predates the
animation passes. The gun sits where the aim frame puts it (rifle at the shoulder, arm's length ahead of the face)
and an upright torso simply cannot reach the handguard from there, so the arm IK clamped at full stretch short of it.
It is fixed in three layers, in `RobotRenderer.ts`:

1. **Reach solver** (`reachSolve`): twists the chest (up to 35 degrees, support shoulder forward) and then leans it
   (up to 20 degrees) until both hands can reach their sockets, a few iterations of forward kinematics per frame, near
   fighters only. If the arm is still short the support hand takes hold further back along the gun, and as a last
   resort the body steps up to 12 cm toward the gun (never for the first-person body, whose head is locked to the
   camera).
2. **Gun follows the body:** the gun rides the fast part of the chest's motion (run bob, stride twist, flinch)
   against a slow reference in the character frame, so it moves with the arms instead of being nailed to the
   aim frame. Aiming down sights fades this out so the sights stay exactly on the camera.
3. **First-person gun inertia:** the gun trails fast mouse turns on a damped spring (up to about 5 degrees) and
   settles; ADS locks it back on.

Result across the stance, crouch-walk, movement and walk sets, both characters: both hands at 0.0 cm from the gun
(previously up to 30 cm).

**Camera.**
* Third person hangs from a damped pivot (`smoothPivot` in `GameRenderer.ts`): the pivot advances with a slowed
  copy of the player's velocity and is pulled to the player with a short time constant, so a steady run has no lag
  while dashes, slides, landings and stair steps ease in instead of jolting the frame (a dash start trails by about
  0.3 m and catches up; stopping rolls on a little, like a real follow camera). It is capped, snaps on respawn or a
  view switch, and never sits behind a wall. Settings: **Camera smoothing** Rigid / Smooth (default) / Floaty.
* First-person bob is a smooth stride dip with rounded ends (the old one had a cusp every step) plus a gentler sway.

**Centre dot.** The old dot was 2 px and vanished against the ink crosshair. It is now a round dot in the crosshair
colour with a white ring and a faint dark outer ring, so it reads on any background. Settings: **Centre dot** Off /
Small / Medium (default) / Large. The four ticks still fade as the sights come up; the dot stays (35% for iron
sights, fully faded for the sniper scope).

Tuning: `SWAY_SMOOTH` / `SWAY_MAX` / `REACH_YAW` / `REACH_LEAN` in `RobotRenderer.ts`, the lag spring in the
first-person block before `weaponFrame` there, `smoothPivot` time constants in `GameRenderer.ts`.

## Verification

* `npm test`, `npm run test:movement` (five new roll checks), `npm run test:upgrade`, `npm run build`.
* Pose sheets of the real renderer: `poselab.html?set=stance|crouchwalk|melee|roll|rolldirs|react|walks|moves&view=side` on both rigs.
* In-game frame captures through the deterministic stepper: run, roll, melee (third and first person),
  hit, death, hard and rolling landings.
* Not measured: frame rate on real hardware (this container has no GPU). The additions are one extra
  mesh per melee fighter, a few more clips sampled per fighter, and nothing per frame beyond that. The
  clip file grew from about 0.4 MB to 1.1 MB per character (the 8-second upright idle and the 2-3 s rolls are the largest clips).

## Known limitations

* There is no true back-roll: a backward dash uses Max's sideways dive (it dives back and to one side).
* Roll and death clips are full body with no IK, so feet can float or sink a few centimetres on slopes.
* Hit reactions drive only the spine, neck and head: the arms stay on the gun so aim stays readable.
* The slide is Max's squat held while sliding: feet are flat under the hips rather than extended out front.
* Crouch strafes are slow clips: at crouch speed their feet slide a little (cadence is capped, not stretched).
* Third-person melee uses sword-and-shield clips, so the pencil is gripped like a sword. A purpose-made
  pencil set (below) would look better.

## Animations still worth generating (Tripo text to animation)

Tripo exports on the robot's rig import unchanged (that is how Max's clips work). Each prompt should say in
place, no travel, and loop where noted. In rough order of value now that slide, rolls, crouch walks, bolt
and headshot are in:

1. **Pencil melee**: "A fighter holding a pencil like a short sword does a fast horizontal slash from right to left. In place, 0.5 seconds." Plus "a fast backhand slash back from left to right", "a lunging stab straight ahead with the pencil, step forward and recover", and "a stealthy backstab: step behind and drive the pencil down". Melee still uses sword-and-shield clips.
2. **Air dash and double jump**: "A soldier air dashing forward, body leaning almost horizontal, legs trailing, rifle held in both hands" and "a soldier does a second mid-air jump with a quick forward flip, tucked, then opens up to fall."
3. **Death variants**: "falls backward after a headshot and lies still", "collapses forward onto knees then face down", "spins and falls to the side after a shot to the leg".
4. **Weapon switching**: "A soldier lowers a rifle and draws a pistol from the hip in half a second", "slings the rifle onto the back and raises a sniper rifle to the shoulder".
5. **Reloads**: "A soldier reloads an assault rifle: drops the magazine, pulls a fresh one from the belt, slaps it in, and racks the charging handle. Upper body only, 2 seconds." (the current reload is the weapon IK only)
6. **Landing and falling**: "A soldier lands from a long fall into a deep crouch with one hand on the ground, then rises" and "a soldier falling through the air, arms out, legs bent, loop".
7. **Vault and mantle**: "A soldier vaults over a waist-high wall in one fluid motion" and "climbs onto a ledge at chest height."
8. **Emotes / victory**: "A soldier spins a rifle in the hand and holds it up in victory."
