# STICKFIGHT integration handoff

Codex branch: `codex/third-person-armory`
Base: `fad7edf` on `claude/stickfight-fps-game-58be96` (Arcade upgrade, part 1).

## Integrating unfinished Claude work

1. Commit or stash your unfinished edits on your current branch first.
2. Fetch `origin/codex/third-person-armory` and inspect its diff against `fad7edf`.
3. Create an integration branch from your saved Claude branch and merge `origin/codex/third-person-armory` into it. Do not reset, force-push, or replace either branch wholesale.
4. Resolve conflicts by keeping both feature sets. Read the integration points below before choosing either side of a conflict.
5. Run `npm ci`, `npm test`, `npm run test:upgrade`, and `npm run build`. Run `node tests/browser.mjs` against Vite at port 5178 after `npx playwright install chromium`.
6. Play both cameras, all six weapons, both maps, and a full capture match. Check purchases and match rewards survive reload. Deploy the integrated build only after that verification.

## Features in this branch

* V toggles first/third person; Q swaps shoulders. Both bindings editable and saved.
* Swept camera collision with floor/ramp/wall avoidance, full local character, third-person ADS, first-person sniper scope.
* Actual eye/muzzle trace projected to the reticle in third person. Shots still originate from the fighter, never the camera. Red reticle indicates barrel obstruction.
* Scribbler SMG and Finepoint semi-auto carbine, with stat configurations, distinct procedural rigs, sounds, recoil and third-person meshes. All six weapons are available in the practice range; wheel reaches slots 5 and 6.
* Armory with photographs of actual gun rigs, weapon purchases, equipped primary, character ink colors, daily contracts, XP levels and weapon mastery counters.
* Browser-local profile: 600 starting Ink, existing AR/sniper remain owned, SMG costs 350, carbine costs 500. New weapons trade strengths and weaknesses.
* Completed matches award Ink/XP. Quitting and the practice range award nothing. Match IDs prevent duplicate payouts; daily contracts automatically claim once per UTC day.
* Hold the Sketch: free-for-all capture zone, solo occupation gives one point per second, contested zone stops scoring, moves every 40 seconds, first to 60 wins. Bots navigate toward zones and fight for them.
* Bookyard arena: book-stack lanes, two ruler walks, flanking gaps and eight spawns. Both arenas support FFA and capture.
* Fixed simultaneous reload/fire input firing after reload starts. Cleared latched actions on pointer-lock loss. Restored keyboard Tab navigation in menus.
* Responsive armory, focus styling, reduced-motion CSS, objective HUD, score-aware results and rewards receipt.

## Conflict-sensitive integration points

* `src/sim/types.ts`: `WeaponId` adds `smg`, `carbine`; `GameMode` adds `sketch`.
* `src/config/weapons.ts`: `PrimaryId` is shared. Base guns retained, AR draw reduced to 0.24 s; two new weapon definitions compose the base AR stats.
* `src/render/vm/weapons.ts`: original Claude rigs retained; new rigs have explicit sockets. Preserve your sight/model work and propagate suitable changes to the new rigs.
* `src/render/GameRenderer.ts`: third-person camera and visibility; new `FrameInput` fields. Never move authoritative shooting origin to camera position.
* `src/sim/combat.ts`: `traceFireLine` is shared by gunfire and third-person reticle, including barrel obstruction. Shooter excluded by ID, allowing copied presentation poses.
* `src/sim/match.ts`: objective state, scoring, winner ID, map selection and player color. Keep fixed 120 Hz tick from the base.
* `src/sim/bots.ts`: objective navigation override feeds existing movement commands; retreat and cover remain available.
* `src/core/Profile.ts`: independent saved progression. Future backend must validate rewards and purchases; localStorage is not trusted multiplayer authority.
* `src/game/App.ts`: profile, weapon kill tallies, reward settlement, camera callbacks, objective rendering and third-person tracers.
* `src/ui/Menus.ts`: constructor now takes Profile; `showEnd` now takes MatchInfo and RewardReceipt.
* `src/ui/Hud.ts`: mode-aware sorting, zone scores, projected aim and capture panel.

## Validation

Existing simulation suite and 10 new upgrade checks pass locally, including bot captures on both maps. Production build passes. GitHub Actions runs the real Chromium flow and uploads screenshots/report as `stickfight-verification` on the pull request. Inspect its final status before integration.

Local browser launch was blocked by container socket permissions, so browser verification is performed on the GitHub runner. Hardware 144 FPS has not been measured here. No backend, real-money payments or multiplayer service added.
