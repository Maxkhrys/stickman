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
**Scribbler** SMG, **Finepoint** carbine (armory purchases), **Highlighter** pistol, **Pencil** melee.
Fighters are made of living sand: hits tear grains from the wound, weapons form from the forearms,
and eliminated fighters crumble (`?sand=0` shows the previous look).

Modes: **Practice Range** (all weapons, dummies, hit regions, live latency/accuracy/spread readout),
**Free-for-all** and **Hold the Sketch** capture (1–8 bots) on two arenas. Bot skill: Easy (default) /
Normal / Hard. V toggles first/third person, Q swaps shoulders. Completed matches earn Ink/XP for the armory.
Settings (hip / ADS / scope sensitivity, FOV, camera shake, volumes, FOV kick, damage numbers,
render scale, difficulty, bot count, keybinds) and the profile persist in localStorage.

Tests: `npm test` (simulation suite), `npm run test:upgrade` (armory/objective/camera checks),
`node tests/browser.mjs` and `node tests/sand.browser.mjs` (Chromium flows). `vmlab.html` (dev only)
is a viewmodel inspection harness.

Weapon tuning lives in `src/config/weapons.ts`; movement in `src/config/movement.ts`.
Architecture and the multiplayer plan: [ARCHITECTURE.md](ARCHITECTURE.md).

## Armory update

`V` switches first/third person; `Q` swaps shoulders. Settings also expose camera choice and both keybinds. Scoped sniper aiming uses first person. Third-person reticle shows the actual fighter shot path; red means the barrel is blocked by cover.

Choose Crossfire or Bookyard. **Hold the Sketch** awards one point each second you occupy the marked zone alone. Contested zones stop scoring. Zone moves every 40 seconds; first to 60 wins.

Open **Armory & contracts** to spend earned Ink on Scribbler SMG, Finepoint carbine and character colors. Everyone starts with 600 Ink plus the original rifle/sniper. Finish matches for rewards; quitting and practice give none. Daily contracts refresh at midnight UTC. XP and weapon mastery track completed matches. Progress saves in this browser only.

Practice range has six weapons; use the wheel to reach SMG and carbine (slots 5/6).

Validation: `npm test && npm run test:upgrade && npm run build`. For browser checks start Vite on `127.0.0.1:5178`, run `npx playwright install chromium`, then `node tests/browser.mjs`.

Claude integration instructions: [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md).
