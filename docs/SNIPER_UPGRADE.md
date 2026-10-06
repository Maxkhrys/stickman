# Sniper & movement upgrade

Rogue Company–style readable third-person shooting, Deadlock-style traversal, built around a
quickscope sniper. Branch `claude/sniper-movement-upgrade-bxz6or`.

## Launch

```bash
npm i
npm run dev            # http://localhost:5173 — starts in Practice on Foundry with the armored character
npm run build          # type-check + production bundle in dist/
npm test               # simulation suite
npm run test:movement  # movement, map routes, shot pipeline, FPS equivalence (30/60/120/144)
npm run test:upgrade   # armory / objective / camera checks
```

Menu → **Map** (Foundry, Crossfire, Bookyard) and **Character** (Armored, Yellow robot, Stickman).
All three characters share one controller, hitboxes, weapons and ADS.

## Controls

| Key | Action |
|---|---|
| WASD | run / strafe |
| Space | jump; once more in the air for the air jump (needs a fresh press) |
| Shift | dash (2 charges, refill 2.4 s each; one dash per airtime) |
| C | crouch; while running = momentum slide |
| RMB | scope / ADS (~150 ms for the sniper) |
| LMB | fire (one shot per press for the sniper) |
| R | reload |
| Q | swap shoulder |
| 1–4, wheel | weapons |
| T | reset practice (targets, position, charges) |
| H | hit-region overlay |
| V | first / third person |
| Esc | pause (releases every held key; so does losing focus) |

HUD: dash and air-jump/air-dash pips above health, a readiness bar under the crosshair while
scoping (yellow = the next shot is fully accurate), hit / headshot / elimination markers, and
QUICKSCOPE / AIRBORNE tags on sniper eliminations.

## How the pieces fit

* **Simulation** runs at 120 Hz (`src/sim`). Inputs carry the camera's offset from the eye, so a
  shot is resolved in two stages (`resolveShot` in `src/sim/combat.ts`): the camera ray through the
  reticle finds the aim point, then the real trace runs from the muzzle to it. A wall right in front of
  the muzzle blocks the shot; the shooter is excluded from their own trace; damage is applied once.
* **Movement** (`src/sim/movement.ts`): capped acceleration, jump buffer + coyote time, one air jump,
  dash charges with one air dash, momentum slide, sub-stepped collision (no tunnelling), and ADS that
  bleeds speed instead of cutting it.
* **Characters** (`src/render/robot/RobotRenderer.ts`): baked clips retargeted to each rig,
  phase-locked directional blending (walk/run/sprint × 4 directions), an aim layer over the upper
  body, two-bone IK putting both hands on the actual weapon, crouch/slide hip drop with leg IK.
* **Camera** (`src/render/GameRenderer.ts`): over-the-shoulder rig with collision (snaps in, eases
  out), shoulder swap, and ADS that slides the camera into the sights (third → first person). The
  aim point stays coherent while the rig moves.
* **Foundry** (`src/sim/maps/foundry.ts`): 150 × 110 m (~3× the old arena), ground, 2.6 m containers,
  4.4–4.5 m catwalks/balconies, 7.5 m warehouse roofs, 9 m smelter roof. The catwalk gap needs the air
  jump; the pipe-bridge gap needs air jump + air dash. Routes are checked against the real movement
  code in `tests/movement.test.ts`.

## Tuning locations

| What | Where |
|---|---|
| movement (speeds, jumps, dash, slide, caps) | `src/config/movement.ts` |
| weapons (damage, spread, ADS time, readiness, bolt, recoil) | `src/config/weapons.ts` |
| weapon models, sockets, ADS eye position | `src/config/weaponModels.ts` (`ADS_CAMERA_FORWARD`) |
| shoulder camera offsets | `CAM` in `src/render/GameRenderer.ts` |
| locomotion blend speeds, LOD distance | `BLEND_SPEED`, `LOD_DISTANCE` in `src/render/robot/RobotRenderer.ts` |
| map layout | `src/sim/maps/foundry.ts` (`FOUNDRY_GEOM` holds the route heights/gaps) |

## Performance

Measured in this environment, which has **no GPU** (Chromium on SwiftShader, a CPU rasteriser), so
frame times are not representative of a real machine; draw calls and triangles are.

| Scene (1280×720) | Before: median frame / draws / tris | After |
|---|---|---|
| FFA arena, third person | 267 ms / 98 / 97k | 533 ms / 82 / 251k |
| FFA arena, first person | 333 ms / 58 / 10k | 733 ms / 102 / 299k |
| FFA Foundry, third person | n/a | 583 ms / 43 / 212k |
| Practice Foundry, third person | n/a | 750 ms / 51 / 319k |

The "before" stickmen were ~1–2k triangles each; the textured characters are ~57k plus a 26–56k
weapon. What keeps that in check:

* the map is merged into ~5 draw calls (`src/render/mapMesh.ts`);
* characters off screen skip animation and drawing;
* distance LOD: past 14 m (screen-size based, so a scope's zoom restores full detail) characters and
  guns draw a reduced index buffer over the same vertices (`tools/asset/lod.mjs`, ~15k tris per
  character) — this cut scene triangles 2.3–3× in the measurements above;
* effects, shadows, decals and bullet holes are pooled instanced meshes.

**60 FPS at 1080p has not been verified** — there is no GPU here to verify it on. The CPU side of a
frame (sim + animation + IK for 8 fighters) is a few ms in the HUD's FRAME readout. Check it on real
hardware with the HUD FPS readout (Settings → Show FPS); if a weak GPU struggles, lower Render scale
first, then `LOD_DISTANCE`.

## Gameplay recording

`docs/media/gameplay.mp4` (10 s, 30 fps, `tools/capture/gameplay.mjs`): captured by stepping the game loop exactly 1/30 s per frame
in headless Chromium, so it plays at real speed even though the software renderer is slow. It shows the
sniper run, jump + air jump + air dash, slide, quickscope, shoulder swap and an airborne quickscope.

## Known limitations

* Performance numbers above are software-rendered; real-GPU numbers still need taking.
* The scoped walk clip only steps sideways; walking forward or back while scoped uses the hip walk's legs.
* Hands are placed by IK on the weapon, so the source clips' own arm poses (e.g. Max's low rifle carry)
  are not used; only legs, hips and torso sway come from them.
* At LOD distance thin parts (straps, fingers) are simplified away; up close everything is full detail.
* Bots use the movement kit (double jump, dash) on nav links but do not plan air-dash routes.
