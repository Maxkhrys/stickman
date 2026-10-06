import { chromium } from 'playwright';
// Deterministic combat capture: run, dodge roll, slide, air dash, pencil swings, a hit reaction, then the same
// in first person. The game loop is stopped and advanced by exactly 1/FPS per frame, so the clip plays at real
// speed whatever the (software) GPU manages.
// Usage (dev server on 127.0.0.1:5178): node tools/capture/combat.mjs <framesDir>
//   then: ffmpeg -framerate 30 -i <framesDir>/f%04d.jpg -c:v libx264 -pix_fmt yuv420p docs/media/combat.mp4
const out = process.argv[2], FPS = 30;
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5178/');
await page.waitForFunction(() => window.stickfight, null, { timeout: 120000 });
await page.evaluate(async () => {
  const a = window.stickfight; await a.startMatch(); a.input.locked = true;
  a.loop.running = false; // manual stepping from here
  a.hud.setNote('', 0);
});
const at = {};
const on = (f, fn) => (at[f] ??= []).push(fn);
const key = (f, code, len = 2) => { on(f, p => p.evaluate(c => window.stickfight.input.press(c), code)); on(f + len, p => p.evaluate(c => window.stickfight.input.release(c), code)); };
const turn = (f, dyaw, n) => on(f, async p => { const cur = await p.evaluate(() => ({ yaw: window.stickfight.input.yaw, pitch: window.stickfight.input.pitch })); aim = { from: cur, to: { yaw: cur.yaw + dyaw, pitch: 0 }, f0: f, n }; });
let aim = null;

// ---- choreography (frames at 30 fps) ----
key(1, 'Digit1', 1);                     // assault rifle
key(6, 'KeyW', 70);                      // run down the lane
key(26, 'KeyA', 16); key(30, 'ShiftLeft'); // dodge roll to the left, still running
key(58, 'KeyC', 14);                     // slide
key(80, 'Space'); key(92, 'Space');      // jump, air jump
key(100, 'ShiftLeft');                   // air dash
turn(104, 0.8, 18);
key(124, 'Digit4', 1);                   // pencil
key(138, 'Mouse0'); key(150, 'Mouse0');  // two quick cuts (alternating sides)
key(164, 'Mouse2');                      // heavy stab
on(186, p => p.evaluate(() => { const a = window.stickfight; a.renderer.characters.hurt(a.adapter.localId, 0.3, 1); }));
key(196, 'Digit1', 1);
turn(200, -0.8, 14);
key(216, 'KeyV', 1);                     // first person
key(230, 'Digit4', 1);
key(248, 'Mouse0'); key(260, 'Mouse2');  // pencil in first person
key(282, 'Digit1', 1);
key(290, 'KeyW', 40); key(300, 'ShiftLeft'); // first-person roll
const END = 336;

for (let f = 0; f < END; f++) {
  for (const fn of at[f] ?? []) await fn(page);
  if (aim) {
    const u = Math.min(1, (f - aim.f0) / aim.n), e = u * u * (3 - 2 * u);
    await page.evaluate(([y, pch]) => { const i = window.stickfight.input; i.yaw = y; i.pitch = pch; }, [aim.from.yaw + (aim.to.yaw - aim.from.yaw) * e, aim.from.pitch + (aim.to.pitch - aim.from.pitch) * e]);
    if (u >= 1) aim = null;
  }
  await page.evaluate((dt) => window.stickfight.loop.advance(dt), 1 / FPS);
  await page.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 82 });
  if (f % 30 === 0) console.log('frame', f);
}
await browser.close();
