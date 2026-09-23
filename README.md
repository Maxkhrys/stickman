# STICKFIGHT ✎

A fast, Krunker-style stickman FPS set inside a notebook doodle world. Vite + TypeScript + Three.js,
no backend, no asset files (textures and sounds are generated at runtime).

## Run

```bash
npm i && npm run dev        # http://localhost:5173
npm run build               # type-check + production build -> dist/
npm run preview             # serve dist/
```

## Deploy (Vercel, static)

```bash
npm i -g vercel
vercel          # preview deploy (framework: Vite, output: dist — also set in vercel.json)
vercel --prod
```
Or import the repo in the Vercel dashboard. No settings needed.

## Play

| | |
|---|---|
| WASD | move (air-strafe by turning while holding A/D) |
| Space | jump — hold to bunny hop (jump buffer + coyote time) |
| Shift | crouch; while running = slide with speed boost (slide-hop to keep it) |
| LMB / RMB | fire / aim down sights (knife: quick slash / heavy stab, lunges at close targets, backstabs) |
| R, 1–4, wheel | reload, weapons (range: 4 slots with instant switching) |
| H | toggle hit-region overlay (practice range) |
| Tab / Esc | scoreboard / pause |

Weapons: **Inkblaster** rifle, **Graphite** bolt-action quickscope sniper (head / upper chest one-shot),
**Highlighter** pistol, **Pencil** melee. Pick the primary (rifle or sniper) in the main menu.

Modes: **Practice Range** (dummies, distance markers, hit regions, live latency/accuracy/spread readout)
and **Free-for-all** (1–8 bots, first to 25, 6 min). Bot skill: Easy (default) / Normal / Hard.
Settings (hip / ADS / scope sensitivity, FOV, camera shake, master / weapon / hit-feedback volume,
FOV kick, damage numbers, render scale, difficulty, bot count) persist in localStorage.

Tests: `npm test` runs the headless simulation suite (hit regions, ADS timing, sniper lethality and
bolt rules, reload/switch rules, spawn protection, barrel obstruction, frame-rate independence, bot
difficulty ladder). `vmlab.html` (dev server only) is a viewmodel inspection harness.

Weapon tuning lives in `src/config/weapons.ts`; movement in `src/config/movement.ts`.
Architecture and the multiplayer plan: [ARCHITECTURE.md](ARCHITECTURE.md).
