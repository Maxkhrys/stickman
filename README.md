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
| R, 1 2 3, wheel | reload, weapons |
| Tab / Esc | scoreboard / pause |

Modes: **Gun Range** (dummies, distance markers, movement playground, live speed/DPS/spread readout)
and **Free-for-all vs 6 bots** (first to 25, 6 min). Bot difficulty: Easy / Normal / Hard / Insane.
Settings (sensitivity, ADS sensitivity, FOV (default 100), volume, camera bob, FOV kick, render scale,
crosshair colour, keybinds) are saved to localStorage.

Weapon tuning lives in `src/config/weapons.ts`; movement in `src/config/movement.ts`.
Architecture and the multiplayer plan: [ARCHITECTURE.md](ARCHITECTURE.md).
