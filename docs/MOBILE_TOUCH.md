# Mobile touch v1

Base inspected: `c1c038f09ecdcf1f715af464d648e472473f766f` on
`claude/stickfight-fps-game-58be96` and `integration/sand-opus`. This includes
Claude's sand wound/formation/death/audio and ramp/camera fixes on top of the
sand and armory integration. The feature branch preserves that tree; it does
not modify the simulation, renderer, audio, existing game flow or Vercel config.

## Open and play

Use the same deployment URL on desktop and mobile. A coarse primary pointer
plus touch capability selects the mobile input session. Rotate to landscape
and tap Play. Portrait menus are usable, but gameplay requires landscape.
There is no separate game, native installation or pointer-lock dependency on
mobile. `?controls=touch` forces touch for hybrid devices; `?controls=desktop`
forces desktop controls. The default does not treat a narrow desktop window
as a phone.

Left stick moves; drag the right side to look. The fire button can itself be
dragged while held, so two thumbs can move, aim and shoot. AIM toggles ADS/scope.
JUMP and SLIDE are held actions. RELOAD is a one-tick request. NEXT / GUN cycle
both directions through all equipped weapons, including all six in practice.
VIEW / SIDE switch perspective and shoulder, SCORE toggles the scoreboard,
HITS toggles the existing practice hit-region overlay. Pause/Resume is explicit.
Existing Settings sensitivity and ADS/scope multipliers apply to touch with
CSS-pixel-based calibration and the existing FOV compensation.

## Integration notes

`Input.locked` is the existing App input-session flag, not proof of native mouse
pointer lock. It now means either an active desktop pointer-lock session or an
active mobile Play/Resume session. `pointerLocked` internally tracks real browser
pointer lock, so compatibility mouse events cannot fire from a touch button.
All input still produces the existing `InputCommand`; no damage, cadence,
hitbox, movement, AI or progression rules are replaced.

Pointer ownership and capture are independent per control. Short taps latch for
one simulation tick. Cancellations discard stale latches. Blur, page hide,
visibility loss and resize clear contacts, movement, ADS and buttons; portrait
rotation and app switching pause, and returning never resumes by itself.

`src/ui/touch.css` is scoped to capability-selected touch mode. It moves HUD
information out of the thumb zones, retains scrollable menus, uses safe-area
insets, and gives action buttons at least 44 CSS pixels. The viewport permits
normal browser accessibility zoom; touch-action is disabled on the game control
surface, not globally across the menus.

## Verification

The development environment cannot clone/fetch network resources or navigate
localhost. An offline Chromium harness using the actual transpiled Input and
TouchControls passed 34 checks, including native three-contact input,
independent release, cancellation, tap latches, ADS, rotation and pause.
The desktop command regression in that offline harness used simulated lock
notifications; actual browser pointer lock is covered by the existing repository
browser suite on a served page.

The new `Mobile touch checks` workflow runs type checking and the full game with
real Chromium-emitted touch events via `tests/mobile.browser.mjs`. The existing
`Verify STICKFIGHT` workflow is unchanged and retains simulation, upgrade,
production-build and desktop browser checks. Review their results on the PR;
this document does not claim a future CI run has already passed.

Not claimed: physical iPhone/Android testing, Safari/WebKit verification, 60 FPS,
native fullscreen, orientation locking, haptics, gamepad support or a PWA.
This pass intentionally leaves render quality and the sand presentation intact.
Hardware performance and touch sensitivity need a phone playtest before a
production promotion. No production deployment or unrelated Vercel project
configuration is changed by this branch.
