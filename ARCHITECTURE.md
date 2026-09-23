# STICKFIGHT architecture

```
 raw input ──► Input (core/Input.ts) ──► InputCommand ──► NetworkAdapter ──► Match (sim/, authoritative)
                                                                               │  120 Hz fixed tick
 bots: BotBrain.think() ─────────────────► InputCommand ───────────────────────┘
                                                                               │
                                     GameEvent[] + Fighter state ◄─────────────┘
                                          │
          ┌───────────────────────────────┼───────────────────────────┐
   GameRenderer (interpolated)        Sfx (WebAudio)              Hud / Menus (DOM)
```

## Rules the code follows

1. **`src/sim/` is pure.** No three.js, no DOM, no `Math.random` in gameplay paths (seeded
   `mulberry32`). It can run in Node unchanged — that is how the headless movement/bot tests run.
2. **Everything acts through `InputCommand`.** Move, jump, crouch/slide, fire, ADS, reload and
   `switchWeapon` (slot/scroll) are fields of one command consumed per tick. Bots produce the same
   commands, so they obey the same movement and weapon rules as players.
3. **Fixed 120 Hz simulation, interpolated rendering.** `core/Loop.ts` accumulates real time, steps
   `Match.step(1/60)`, then renders with `alpha`. Fighters keep `prevPos/prevYaw/prevHeight/prevRecoil`
   for interpolation. The local camera uses the *latest* mouse angles (not interpolated) for zero added latency.
4. **Output is events + state.** Shots, hits, kills, landings, reloads… are `GameEvent`s. Renderer, audio and HUD
   only read these + fighter state; they never mutate the sim. Kill hit-stop is presentation-only.
5. **`NetworkAdapter`** (`src/net/`) is the only thing the client talks to. `LocalAdapter` hosts the Match in-tab.

## Multiplayer plan (authoritative WebSocket server)

**Server**: Node process running `Match` unchanged at 120 Hz (or 60 Hz with the same code). Clients send `InputCommand`s (with `seq`)
over WebSocket (binary, ~20 bytes each). Server applies each client's commands in order, broadcasts
snapshots at 20–30 Hz (quantised positions/angles, delta-compressed against the last acked snapshot) plus
reliable events (kills, hits confirmed).

**Client-side prediction** (`WebSocketAdapter.sendCommand`): run `simulateMovement` + `updateWeapon` for the
local fighter immediately on a predicted copy and store the command in a ring buffer. On each snapshot,
reset the local fighter to the server state for `lastProcessedSeq` and re-simulate the unacknowledged
commands (reconciliation). Movement is already deterministic per command, so corrections are rare; small
errors are smoothed over ~100 ms visually.

**Entity interpolation**: remote fighters are rendered ~100 ms in the past between two snapshots — the
renderer already interpolates between `prevPos` and `pos`, so the adapter only needs to feed it a buffered pair.

**Lag compensation for hitscan**: the server keeps ~1 s of per-tick fighter history (pos, height, yaw, crouch/slide).
When a fire command arrives, it rewinds every other fighter to the tick the shooter *saw*
(`server tick − RTT/2 − interp delay`, clamped to 200 ms), runs `traceShot` against `buildHitboxes` on the
rewound states, then restores. Hitboxes are derived from sim state only (`sim/hitboxes.ts`), never from
render animation, precisely so this rewind is exact. Client shows hitmarkers optimistically only for sounds; damage
numbers/kill feed wait for server confirmation.

**Anti-cheat basics**: validate command rates, clamp angle deltas, cap movement per tick (the sim already
bounds speeds), and never trust client hit claims.

## Directory map

| path | purpose |
|---|---|
| `src/config/` | **weapons.ts** (all weapon stats), movement.ts, difficulty.ts |
| `src/sim/` | match, movement physics, collision world, hitboxes, combat, weapon state machine, nav graph + A*, bot AI |
| `src/net/` | `NetworkAdapter` interface, `LocalAdapter` |
| `src/core/` | fixed loop, raw input → commands, settings (localStorage) |
| `src/sim/body.ts` | deterministic skeleton shared by hitboxes (capsules + OBBs) and character rendering, so what you see is what you hit |
| `src/render/` | map baking (fat ink lines, contact shadows), instanced toon characters + ragdolls, `vm/` viewmodel kit (weapons, gloves, sockets), render-to-texture sniper lens, effects, camera rig |
| `src/audio/` | procedural WebAudio SFX |
| `src/ui/` | HUD + menus (DOM) |
| `src/game/App.ts` | wires everything together, maps events to feedback |

## Third person, progression and objectives

Third person changes presentation only. `clipCamera` sweeps a small camera volume against the collision world. The HUD projects `traceFireLine`, shared with combat, to show the real eye/muzzle shot path. No camera origin is accepted as shooting authority. Scoped sniper aiming returns to first person. Online competitive queues should enforce one perspective per lobby to avoid mixed-perspective visibility advantages.

`Profile` owns local earned currency, unlocks, cosmetic character inks, UTC daily contracts and mastery. Purchases occur before matches and produce the next match's primary/color options. Completion events settle rewards once per match ID. This is an offline progression store, not an anti-cheat boundary. An authoritative multiplayer service must own purchases, validate equipped inventory and sign/commit match rewards in its database.

Hold the Sketch is authoritative Match state, driven by fixed ticks. Occupancy, score, rotation and winner are exposed through MatchInfo; the renderer only visualizes them. Bots reach zones through their existing waypoint and command layers. Future snapshots need objective fields plus objective stats; they require no client authority over scoring.

## Stick-figure sand bodies

* `sim/body.ts` is still the single skeleton for rendering **and** hitboxes. The stick-figure look is a
  presentation layer in `render/CharacterRenderer.ts` (`STICK` radii: slim ribcage/pelvis ellipsoids, spine,
  clavicle bar, tapered bones with joint beads). `sim/hitboxes.ts` (`HIT`) wraps those radii plus the ink
  outline with a small deliberate margin; the hit-region and bot-difficulty tests guard both.
* `render/sand.ts`: one shader injection for every sand surface (bodies, piles, viewmodel sand parts).
  Grain coordinates are metric per instance (instance scale applied), with fine/coarse grains, clumps,
  relief, a slow downhill creep, vertex roughness and a granular ink edge. Per-instance attributes
  `aDisturb` (cohesion loss) and `aWound` (nearest wound, world space) carve local wound craters, respawn
  reformation, low-HP weak patches and top-down death erosion by discard; the outline hull shares the field.
* Loose grains (wound flow, footfalls, landing, speed trails, weapon formation, idle slippage) come from the
  pooled particle system in `Effects.ts`, scaled by distance and the quality tier. Presentation never feeds
  the simulation.
* Quality tiers (`SAND_BUDGET`, Settings → Graphics): shader taps, particle cap, loose-grain density, pixel
  ratio cap. Auto = Low on touch devices, High elsewhere.

## Touch input

`ui/TouchControls.ts` owns every finger by the control it started on (pointer capture) and only calls
`Input.touchPress/touchRelease/touchMove/touchLook/touchScroll`. `Input.buildCommand()` merges those with
keys and mouse into the same `InputCommand`, so touch play runs the identical fixed-tick simulation (no
mobile-specific gameplay code). Touch look uses the same zoom-compensated `sensScale` as the mouse.
`Input.touchMode` replaces pointer lock with a plain locked flag; emulated mouse events after a tap are
ignored so a tap can never fire.
