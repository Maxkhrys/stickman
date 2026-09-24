# Stick fighter v2: handoff

Branch `feat/stickman-character-v2`, based on `c1c038f` (`integration/sand-opus`).

## What changed

* **Character.** The outfit humanoid (box torso, shorts, shoes, face, accessories) is gone. Fighters are graphite
  stick figures: a spherical head, a thin two-segment spine, clavicles, thin arms and legs, small hands and feet. Each
  limb is a cylinder with a joint sphere of the same radius at each end, so strokes look continuous. The instanced fill
  and ink-outline batches are unchanged. The outline thickens with distance, so at range the fighter reads as a drawn
  line. `f.color` now colours a headband with two verlet tails. It tints the body only slightly (2.5%).
* **Animation layer** (`src/render/anim/`). `StickAnim` builds the render pose from the authoritative skeleton
  (`sim/body.ts`). The sim skeleton is still the only source of hitboxes. The render pose uses the same joint names,
  so wounds, ragdolls and sand effects need no changes.
  * Feet are locked in world space while planted. Swings are driven by the sim gait phase and land on a predicted
    touchdown point. The duty factor depends on speed: long double support at a walk, flight phases at a sprint.
    Idle stepping and settle steps keep the feet under the body. Hips hold during turn-in-place until the aim twists
    past about 45°, then pivot with a step.
  * Pelvis: bob, weight-shift sway, stride twist and hip roll. The pelvis drops when needed so planted feet stay
    reachable on slopes, steps and long strides.
  * The body leans into acceleration and braces against hard stops. The spine takes a share of aim pitch.
  * On a jump, the feet stay planted until the legs extend, then tuck (push-off). In the air the pose blends from
    rise to fall. Landing absorbs through a sprung pelvis dip. The slide has a lead leg and a leaned-back torso.
    Mode switches are inertialized, so poses never pop.
  * Weapons are anchored to the shoulders with per-class holds (`holds.ts`: rifle, carbine, SMG, sniper, pistol,
    melee). The trigger hand is locked to the grip and the support hand to the handguard socket. Layered on top:
    aim sway (lag on fast mouse turns), recoil kick and rise, draw from low-ready, reload (tilt, then the hand goes to
    the mag, the belt and back), sniper bolt, sprint carry, landing settle, and pistol support hand swinging free at a
    sprint.
  * Melee has a guard pose, a light slash arc with alternating sides, and a heavy wind-up then stab. The torso twists
    through each.
  * Arms use two-bone IK with an aim-relative pole, so elbows don't flip at extreme pitch. The shoulder protracts
    before a hand would leave its socket.
  * All springs are critically damped (`spring.ts`), except the under-damped hit reaction. Vectors are preallocated,
    so there is no per-frame allocation in the animator.
* **Camera** (`GameRenderer`). Over-the-shoulder framing puts the fighter about a third off the reticle. The camera
  tightens on ADS and opens slightly at a sprint or slide. Collision still pulls the camera in instantly, and it now
  eases back out. Pivot height follows a velocity-compensated spring, which eases jumps, landings and step-ups with no
  steady lag. Rotation is still the raw mouse aim, with no added latency. The scoped sniper still switches to first
  person. Shot origin and `traceFireLine` projection are unchanged.
* **Sand.** Hits tear dark graphite chips, plus a few flecks of the fighter's ink. Wound trickles, weapon formation,
  headshots and the collapse into a pile now use the same dark dust colour (`dustColor`).
* **Art direction.** HUD changes: handwritten "Practice" title with a pink marker swipe, a taped index-card stat
  panel, compact numbered weapon chips, and a smaller layout on phones and short landscape screens. Arena changes:
  warm paper tooth, bluer guide lines, and a marker palette remap (purple to hot pink, green to yellow highlighter)
  applied to boxes, ramps, pencils and floor splats. Map geometry and collision are untouched.

## Dev tools

Open the game with `?animdebug`. Then:

| Key | Action |
|---|---|
| F6 | Cycle skeleton overlays: authoritative (blue), render (magenta), both |
| F7 | Foot and hand IK targets. Green shows where a foot is going, yellow is its plant |
| F8 | Freeze animation |
| F9 | Slow motion: 1, 0.5, 0.25, 0.1 (scales the loop) |
| F10 | Orbit camera: front / side / rear / three-quarter |
| F11 | Hide body |
| F12 | Hitboxes, including your own fighter in third person |

The panel reads out the animation state, speed, gait phase and each foot's plant/swing progress. Some browsers
reserve F11 and F12. Every flag can also be set from the console: `stickfight.renderer.characters.debug.flags`,
`stickfight.renderer.inspect`, `stickfight.loop.timeScale`.

## Tuning map

* Proportions: `STICK` in `anim/StickAnimator.ts`.
* Gait: duty factor (`0.62 - 0.26 * runN`), lift height, stance width and the idle step thresholds, all in
  `feetUpdate`.
* Body motion: `bob`, `sway`, `twist`, `roll`, the lean gain (`0.0105`, clamped to 0.24) and the brace, all in
  `update`.
* Weapons: `holds.ts`. Per class: hip and ADS offsets, sockets, cant, recoil, sprint drop, stance stagger.
* Camera: the `thirdPersonActive` block in `GameRenderer.render`. Back distance, side offset, lift, pivot spring
  (`w = 16`), collision ease-out (`w = 7`).

## Verification

* `npm ci`, `npm run typecheck`, `npm test`, `npm run test:upgrade`, `npm run build`
* `node tests/browser.mjs`, which needs Vite running on port 5178
* `node tests/sand.browser.mjs`
* `node tests/character.capture.mjs [scene]` writes stills and contact sheets to `verification/char/`. Scenes: idle,
  pitch, turn, sprint, strafe/direction change/diagonal/backpedal, jump launch/air/fall/land, slide/exit/crouch, hip
  fire, ADS, reload, weapon switches, sniper raise/scope/bolt, melee light/heavy, hit, death, HUD
  (desktop/mobile), close-ups, debug overlays.
* `node tests/character.perf.mjs` times `CharacterRenderer.update` over an 8-fighter FFA. Set `SHOTS=1` to also
  save frames.

For HUD captures with the real handwriting fonts, cache the Google fonts once in `node_modules/.cache/fonts`.
Instructions are in the capture script.

## Known issues / next steps

* **Hitboxes are unchanged and much thicker than the drawn body.** The chest OBB is 0.42 m wide while the drawn
  spine is 0.1 m, and the limb capsules are wider than the limb strokes. Shots can connect with visibly empty paper
  beside the torso. Resizing hitboxes is a gameplay/balance decision and was out of scope.
* The presentation pose deviates slightly from the sim legs: planted feet, the hip hold during turn-in-place, and
  about 0.05 m of head offset from the aim-pitch spine share at extreme pitch. The hitboxes follow the sim.
* Tuning was judged from SwiftShader stills and frame sequences. Motion feel, especially camera and melee timing,
  still needs hands-on play on real hardware. Hardware FPS was not measured.
* Looking steeply up in third person puts the camera low and close, so the body fills more of the screen.
* Death still uses the existing verlet ragdoll of the stick pose, shrinking into dust. A segment-by-segment crumble
  would sell "loses cohesion" better.
* `feat/sand-stickmen-mobile` and `feat/mobile-touch-v1` are not integrated here. The first rewrites
  `CharacterRenderer` and changes hitboxes, so merging it needs a deliberate choice.
