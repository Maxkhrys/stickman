# STICKFIGHT v2.1: grounded movement, marker characters, Sketch Slide

Branch `feat/marker-motion-v2-1`, based on `f07e18102368a3269e9f16c1d46a107c1afe188e` (head of
`feat/stickman-character-v2`). There are three stages, each in its own commit:

| Stage | Commit | Scope |
|---|---|---|
| A | `c44ae1b` | Locomotion and turning corrections, diagnostics, `tests/motion.test.ts` |
| B | `f4f80cd` | Marker/pencil fighter material, headband/tails, first-person hands, smears |
| C | `c0ec6d2` | Opt-in Sketch Slide experiment, `tests/sketch.test.ts` |

Of the references named in the brief, only the prompt file arrived. The recording and the approved image did not, so
problems were reproduced with `tests/character.clips.mjs`, and art direction follows the written brief.

## Gait vocabulary (`src/sim/body.ts`)

* **Step**: one foot contact to the next contact of the other foot. This is half a cycle.
* **Stride**: one full cycle, two steps. `strideLength(v) = 2v / cadence(v)`.
* **Cadence**: foot contacts per second, counting both feet. `cadence(v) = clamp(1.7 + 0.33v, 1.7, 4.8)`, which is
  4.41 at 8.2 m/s. Before this change it was about 8.4.
* **Duty**: the fraction of a cycle one foot spends in stance. `gaitDuty(v)` falls from 0.62 at a walk to 0.24 at a
  run, so a run has flight phases. The animator also caps the stance span at 0.72 m, so a planted foot always stays
  reachable.

The gait advances by collision-resolved travel, `f.travelSpeed`. Jumps and slides never advance it. Walls stop it.
Corrections faster than 30 m/s are rejected. Footstep events fire on the gait's contacts. Backpedal has hysteresis:
it starts above 115° and ends below 100°.

## Measured results (continuous clips, 60 Hz presentation, fixed 120 Hz sim)

Baseline is `f07e181`, measured before any edits. After is `c0ec6d2`. The table shows the maximum planted-foot drift
per frame, measured on the final post-IK ankle.

| Clip | Contacts/s before | Contacts/s after | Drift before | Drift after | Max pelvis↔aim twist before | after |
|---|---|---|---|---|---|---|
| run-forward | 7.76 | 4.66 | 0 | 0 | 0.17 | 0.17 |
| run-backward | 7.76 | 5.17 | 1.7 cm | 0 | 0.17 | 0.17 |
| strafe | 8.08 | 5.19 | 2.1 cm | 0 | 1.39 | 1.39 |
| reversals (A/D every 0.32 s) | 7.60 | 6.80 | 5.3 cm | 0 | 1.28 | 1.39 |
| run-turn-180 | 8.44 | 5.16 | 5.1 cm | 0 | 3.06 | 1.80 |
| turn-stationary | – | – | 0 | 0 | 2.96 | 1.75 |
| ramp | 8.06 | 4.93 | 3.2 cm | 0 | 0.17 | 0.17 |
| slide-exit | 8.40 | 4.80 | 4.2 cm | 0.02 cm | 0.17 | 0.17 |
| jump | 7.40 | 4.11 | 2.6 cm | 4.8 cm* | 0.17 | 0.17 |

\* This is the vertical landing settle: an inertial offset in y only, with no horizontal skate.

The maximum post-IK plant error is 0 in every clip. The worst before the reach clamp was added was 2.1 m. There are
no NaN frames.

The wall-push clip now starts 5 m from the wall. The gait freezes on contact and the feet settle to idle, so there is
no stationary sprint. Its 8.1 contacts/s figure comes from a 0.5 s window of acceleration plus settle steps.

Render schedules, using the same sim: run-forward gives 4.74, 4.66 and 4.66 contacts/s at 30, 60 and 120 Hz.
Reversals give 6.0, 6.8 and 8.4. Plant drift and post-IK error are 0 at every schedule. `tests/motion.test.ts` also
asserts 0 drift and 0 plant error at 30, 60 and 120 Hz.

## Turning

The sim hips (`lowerYaw`) are already rate-limited, so the presentation pelvis now follows them directly. It no
longer adds a second damping spring. The discontinuities that remain are the sim's hard 80° clamp and leaving the
turn-in-place hold. These become an inertial offset that decays to zero. Torso twist is bounded to 100° while moving
and while turning in place. A planted foot twisted more than 69° off the hips is replanned, so it never swivels with
the knee snapping.

## Rig / hitbox contract

The hitboxes still come only from the sim skeleton; no render state feeds them. `?animdebug` shows the largest
distance between drawn and hitbox joints, and which joint it is. It also restates the torso mismatch.

**Known mismatch, unchanged in this preview.** The chest OBB is 0.42 m wide and the stomach OBB 0.36 m. The drawn
spine is 0.10 m. Seen from the front, the torso hit area is about 0.21 m² against about 0.05 m² drawn.

**Proposal, required before competitive multiplayer.** Replace the torso OBBs with a spine capsule of radius
0.09 m, and use limb capsules of radius 0.05–0.055 m that follow the shared pose. Front torso area would drop about
55%. Expect noticeably harder body shots and a relatively more valuable head (radius 0.19 m, unchanged). Weapon
time-to-kill tuning would need a pass. Regression tests are needed for ray-vs-capsule parity against the drawn
silhouette at 5, 15 and 40 m, and for lag-compensation rewinds. This is a gameplay change and is **not** made here.

## Stage B: material and effects

* `src/render/marker.ts` builds small cached textures. The dry-marker fill has faint overlapping passes and short
  broken drags along each limb's UV v-axis, so the texture never slides in world space. A few pencil hatches and
  grain are added on top. Shading uses a restrained two-band toon ramp. Ink hulls get a wobble baked into the mesh
  shape, so it never boils. The same file makes the smear and paint-cell textures.
* The headband is a thin painted stripe. Its tapered ribbon ends are pulled toward a rest pose trailing behind the
  head. Each fighter has one or two tails depending on id, so fighters differ by silhouette as well as colour.
* First-person hands and forearms use the marker fill. Weapon rigs and sights are unchanged.
* Smears come from a 16-slot instanced pool: slide start, landing above 9 m/s, or a hard stop from a sprint. Each
  smear dries into the paper over 0.9 s and stays on the floor only.

## Stage C: Sketch Slide (experimental, off by default)

Turn it on with Settings → Sketch Slide (experimental). It then applies to the range and to bot matches; normal
rules are unchanged while it is off, and the tests assert equivalence.

`src/sim/paint.ts` defines 0.5 m surface-local cells:

* Each cell is keyed by surface id: the floor, each box top, or each ramp.
* A cell holds its owner's fighter id and an expiry tick.
* Life is 12 s. There is a hard cap of 2048 cells, and the oldest cell is evicted first.

Only Inkblaster (`ar`) shots paint, at their authoritative world impact, and only on up-facing walkable surfaces.
Shots that hit a fighter or a wall never paint. A fighter who is already sliding and grounded over their own usable
paint gets `slideFriction × 0.85`. Nothing else changes: no impulse, stacking, accuracy, damage or reload bonus. A
0.1 s grace covers cell edges, and leaving the ground or the slide clears it immediately.

`src/render/PaintLayer.ts` draws the paint in one instanced draw. The opaque core of each quad is exactly the
gameplay cell; the feathered rim is decoration only. Cells dry toward paper colour in their last 1.5 s. The HUD shows
a "SKETCH SLIDE" tag only while the bonus is active.

**Tuning note.** At the specified 15%, the bonus is small. In the test layout it added 6 cm to a 14.7 m slide,
because the slide itself is short (0.85 s). The effect is real but subtle. Tune `PAINT.frictionMult` in `sim/paint.ts`
first.

## Verification (actually run)

* `npm run typecheck` · `npm test` (all passed) · `npm run test:upgrade` (10) · `npm run test:motion` (12, new) ·
  `npm run test:sketch` (11, new) · `npm run build`.
* `node tests/browser.mjs` passed all 21 checks against Vite on port 5178.
* `node tests/sand.browser.mjs` failed once in the first run with no captured diagnostic, then passed three
  consecutive reruns. Treat it as possibly flaky.
* `node tests/character.clips.mjs <tag>`: baseline, stageA, after, and 30/120 Hz subsets (webm, filmstrip and per-frame
  JSON in `verification/clips/`).
* `node tests/character.capture.mjs` closeup, sketch and HUD stills. `CAP_SKETCH=1` enables the paint scene.
* `node tests/character.perf.mjs`, an 8-fighter FFA on SwiftShader: `CharacterRenderer.update` averages 0.50 ms
  (p50 0.3 ms, p95 1.6 ms), with 29 draws and about 92k triangles. Before this change it was 0.27–0.46 ms and 25–26
  draws. This is headless SwiftShader CPU time, not hardware GPU FPS, which was not measured.

## Remaining issues

* The recording and the approved concept image were never received, so this still needs a pass against them.
* The hitbox mismatch described above is unresolved by design.
* The Sketch Slide bonus is subtle at 15%. Paint in a light player ink, such as yellow, is low-contrast on the paper.
* The capture harness's first screenshot after a long batch of stepped frames can take about 60 s while SwiftShader
  drains queued frames. This is a harness artefact.
* Hand-feel of cadence, camera and turning still needs play on real hardware.
