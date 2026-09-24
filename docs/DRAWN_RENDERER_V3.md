# STICKFIGHT drawn-v3: drawn renderer and motion pass

Branch `feat/drawn-renderer-v3`, based on `fe81593` (head of `feat/marker-motion-v2-1`, which contains `c0ec6d2`).
`feat/marker-motion-v2-1` is not modified.

## What changed

| Stage | Scope |
|---|---|
| A/B | The body is now `src/render/stroke.ts`: each spine, arm and leg chain is a Hermite curve through the 3D skeleton joints, expanded to a camera-facing marker ribbon with round caps. Joint balls, tubes, toon shading and ink hulls are gone. The head is a filled ink disc with a fixed wobbly edge. Range dummies have pink heads with an ink rim. The headband is off (`SHOW_HEADBAND`). Wobble is seeded by fighter and sample index, so it never boils. Everything draws in one call from a preallocated buffer. Stroke weight grows with distance so the line still reads at range. |
| A/B (death) | Strokes break into drifting, shrinking dashes. Ink flecks peel off, then a small ink burst and a floor smear. Sand pulses are no longer used for death. |
| C | Step shaping by direction: backpedal steps are about 20% shorter and 30% lower; strafe steps are about 45% narrower and 20% lower. The pelvis, hysteresis and planting are unchanged. |
| D | ADS magnification: SMG 1.5x, AR 1.67x, pistol 1.4x, carbine 1.8x. The sniper is unchanged. This is real world-FOV reduction, and sensitivity already follows the presented FOV. In third-person ADS the fighter shifts further toward the screen edge (shoulder offset +0.14, camera 0.6 m closer instead of 1.15 m). |
| E | Tracers are tapered, crossed pen strips with a dashed alpha and a per-shot dash phase. Each weapon has its own ink, weight and length (`TRACER_STYLE` in App). The muzzle flash is a doodled yellow star with an ink outline. Impacts throw ink and graphite flecks with no sparks. Headshots get a star accent. Kills leave a splat. |
| F/G | Coloured solids use marker-hatch coverage mixed onto paper. World edges are inked with overshoot and a fixed mid-stroke wobble (2.6 px). Pink crates get drawn cross-bracing. Cyan solids become paper. Splats are bigger and mostly pink/yellow, with satellite droplets. Pencils are hatched. There is a doodle sun, and five hand-lettered notes sit high on the tall walls. The floating rings are removed. |
| H | The HUD label is "HP". HP and ammo digits are solid ink. The help note collapses once the player moves, and F1 reopens it. A `drawn-v3 <sha>` build tag appears next to the fps counter on dev and preview builds, and is empty when `VERCEL_ENV=production`. |

## Verification (run)

The following all passed: `npm run typecheck`, `npm test`, `npm run test:upgrade` (10), `npm run test:motion` (12), `npm run test:sketch` (11), `npm run build`, and `node tests/browser.mjs` (21).

Perf (`tests/character.perf.mjs`, 8-fighter FFA, SwiftShader CPU):

| | Update avg | p95 | Draws | Tris |
|---|---|---|---|---|
| v2.1 | 0.50 ms | 1.6 ms | 29 | ~92k |
| v3 | 0.75 ms | 1.8 ms | 20 | ~33k |

The update is slower because the ribbon is rebuilt on the CPU every frame. Hardware FPS was not measured.

Captures:

* `verification/v3/compare-*.png`: before (`fe81593`) and after, with the same scene, camera and 1280x720 resolution:
  * standing rear (`hud-practice`, `idle-tp`)
  * running side (`sprint-side`)
  * ADS (`ads-tp`)
  * firing (`hipfire-tp`)
  * front (`idle-front`)
* `verification/char/sheet-00-closeup.png`: close views of every weapon.
* `verification/char/sheet-00-death.png`: death.

## Known issues / still different from the concept

* The motion pass is light. There are no authored contact → compression → push-off → recovery key poses, no lateral pelvis weight transfer on strafes, and no step-based pivot for large turns. These need a dedicated pass with continuous clips.
* World linework is still geometric fat lines on box edges, not a screen-space edge pass. Pencils and props keep Lambert shading.
* Weapons are still the old low-poly toon meshes and read more 3D than the body.
* The head disc is pulled slightly toward the camera so the neck tucks behind it. From very close it can overlap the gun.
* The 30–50 m ADS gate and barrel-obstruction behaviour were verified by code path and stills, not a dedicated measured test.
* Wall notes use the Permanent Marker font. If the font has not loaded when the map texture is built, the canvas falls back to a system font.
