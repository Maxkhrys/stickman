# Sand identity v1 handoff

## Base and branch

Base `dac8e78bb5585ea643c7b40e5304f793badb65a5` on `codex/third-person-armory`. Work branch `feat/sand-identity-v1`. The armory branch is still an open draft PR (#1) against `claude/stickfight-fps-game-58be96`. Preserve its camera, armory, extra weapons and objective changes. This PR should target the armory branch; integrate it with Claude's later work deliberately.

## Implementation

* `src/render/sand.ts`: shared appearance and limits, shared fixed mineral grain texture, viewmodel material recolouring. `?sand=0` compares the previous presentation without touching game rules.
* `src/render/CharacterRenderer.ts`: skeleton based mineral bodies; up to four bounded moving joint-local wounds per fighter; small wrist streams on draw/reload; world weapon formation; ragdoll collapse and directional phased disintegration; spawn presentation reconstructs over 280 ms with gameplay active immediately. Dead and removed fighter state is cleaned up.
* `src/render/Effects.ts`: shared 600-slot instanced grain pool; impacted sand is directional; falling grains settle using `World.surfaceBelow`, including elevated surfaces; grains expire, and `clear()` resets effects on map change/restart.
* `src/render/Viewmodel.ts`, `src/render/vm/hands.ts`, `src/render/vm/kit.ts`, `src/render/tpGuns.ts`: mineral hands and forearms, compact silhouettes and scoped sniper; weapon mesh compaction and batched grains follow the existing draw/reload/bolt timers. Scope glass and sight sockets remain in place.
* `src/game/App.ts`: consumes existing authoritative hit and kill events at their actual impact coordinates. No simulation damage, collision, reload, spawn protection or hitbox changes.

## Contracts

Hit events already include `victim`, `pos`, `dir`, `part`, `killed` and `blocked`. A blocked hit has no sand wound. `CharacterRenderer.wound` anchors each live wound to the nearest joint of the shared skeleton using a yaw-local offset. It leaks briefly from the updated posed joint. Kill events supply directional impulse and headshot bit to existing ragdoll. Existing `switchTimer`, `reloadTimer`, `drawProgress`, `reloadProgress`, `boltProgress` and `scopeCover` drive formation. Presentation does not feed combat.

## Tuning

Edit `SAND` in `src/render/sand.ts`: `maxWounds`, `woundLife`, `trickleInterval`, `impactGrains`, `grainSize`, `collapseTime`, `pileLife`. Grain pool ceiling remains `MAX_PARTICLES` in `Effects.ts`. Grain contrast is in `grainMap` and density comes from texture repeat in `src/render/sand.ts`. `?sand=0` is the old presentation comparison toggle.

## Validation and environment

Commands: `npm ci`, `npm run typecheck`, `npm test`, `npm run test:upgrade`, `npm run build`, `node tests/sand.browser.mjs`. Existing full browser script also ran but its third-person assertion failed after profile reload in this environment; sand-specific browser script independently exercised range, movement, sniper ADS, fire, reload, rapid switching, wound cleanup, particle budget and elevated settling. The dedicated script records stills in `verification/` (ignored locally). Test browser: headless Chromium 1194 with SwiftShader, 1100 × 800 viewport, device pixel ratio 1, 8 range fighters, same scene and 55 draw calls, 24 animation frame samples. Final fixed-texture run: median 68.9 ms/frame with `?sand=0` versus 110.6 ms/frame with sand. Both modes are far below 60 FPS on this software renderer, and sand remains materially slower here. A discarded per-fragment noise shader was slower (145.7 versus 251.1 ms/frame). Hardware GPU FPS not measured. Visual passes inspected range and sniper scope stills; extended motion and subjective weapon feel need human play on hardware.

## Known limitations and Opus refinements

* Sand palette and contours are an initial visual system over the existing doodle arena. Push mineral layering and segmented erosion further, while keeping hitboxes opaque and unchanged.
* Wound anchors use nearest joint plus yaw-local offset; elbow and knee articulation may show drift. A minimal hitbox segment identifier or barycentric segment anchor would improve accuracy.
* Scope remains the original scope, and firing SFX remain sharp originals. Add subtle gritty material accents in audio without softening weapon reports.
* Sand in the sniper weapon currently compacts around established rig pieces. Sculpt more integrated hand-to-barrel shape, preserving all sight socket positions and ADS timing.
* Effect cap is hard and finite; particle allocation scans available slots. If GPU frame time suffers, use a free list and profile texture sampling and particle updates before adding decoration.
* `?sand=0` compares presentation within this branch; compare with the precise base commit if an independent before/after profiling session is required.

Continue from `feat/sand-identity-v1` after reviewing the PR. Do not reset this branch or replace existing working combat, camera, practice range, armory or objective systems. Improve the geometry, animation and close-up material craft, then rerun all tests and inspect both motion and still frames on a hardware GPU.
