# Drawn-v3 aim and shot alignment

Base: `feat/drawn-renderer-v3`, `ac40914ea93c32c06a299f6a180dd574f72975d9`.
Repair branch: `fix/aim-shot-alignment-v3`. Production is not modified.

## Changes

The former third-person crosshair projected each hit point, including enemies. Because the shoulder camera and eye ray have different origins, the crosshair jumped when the ray entered a fighter. It now stays at screen centre. Exact centre-ray convergence produces ordinary eye-origin firing angles, with independent camera-relative movement. There is no near-target cone, aim attraction, persistent target, lead or homing. Raw mouse angles are never rewritten by convergence.

Barrel collision now checks the entire muzzle-to-impact path, instead of converging on an arbitrary point 1.8 metres ahead. Eye-to-barrel checks still prevent shooting through cover. Shot direction, tracer endpoint and damage impulse agree. Hitscan damage remains immediate and deterministic; strokes are presentation only.

Shot visuals are queued until the current camera and weapon poses exist. Third-person flashes use the actual per-weapon barrel-tip socket, including formation scale. First-person effects use the current viewmodel socket. Short, ink-outlined flashes replace oversized or overlapping additive stars; effects clear on switch, death and map reset. A cosmetic origin that would cross cover falls back to the safe simulation origin.

Tracer endpoints are copied at firing and never retargeted. Close shots get one visible frame at 30, 60 and 120 Hz. Pool reuse clears stale strokes. Thickness is clamped in screen pixels using current FOV. Hit-stop no longer slows bullet strokes or muzzle flashes.

## Verification

Run `npm test`, `npm run test:upgrade`, `npm run test:motion`, `npm run test:sketch`, `npm run test:aim`, and `npm run build`.

With Vite on port 5178, run `node tests/browser.mjs` and `node tests/aim.browser.mjs`. An optional `CHROMIUM_PATH` selects a local Chromium binary. Browser reports and screenshots are written to `verification/`. The new checks cover reticle stability, both shoulders, subpixel static convergence, all firearm sockets, endpoint immutability, effects lifetimes, short tracers and blocked barrels.

## Scope and limitations

Existing movement, recoil tuning, accuracy/spread, scopes, weapon geometry, notebook rendering, progression and game modes are retained. This is a bot/practice-range repair, not production multiplayer certification. The existing torso hitboxes remain wider than the thin drawn torso; this pass does not silently rebalance them. Browser automation cannot substitute for mouse-feel testing on the user's GPU and screen.
