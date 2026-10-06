import { chromium } from 'playwright';
// Deterministic gameplay capture: the game loop is stopped and advanced by exactly 1/FPS per frame,
// so the clip plays at real speed whatever the (software) GPU manages.
// Usage (dev server on 127.0.0.1:5178): node tools/capture/gameplay.mjs <framesDir>
//   then: ffmpeg -framerate 30 -i <framesDir>/f%04d.png -c:v libx264 -pix_fmt yuv420p docs/media/gameplay.mp4
const out = process.argv[2], FPS = 30;
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5178/');
await page.waitForFunction(() => window.stickfight, null, { timeout: 120000 });
await page.evaluate(async () => {
  const a = window.stickfight; await a.startMatch(); a.input.locked = true;
  a.loop.running = false; // manual stepping from here
  a.hud.setNote('', 0);
  window.aimAt = (k) => {
    const me = a.adapter.fighters().find(f => f.id === a.adapter.localId);
    const ds = a.adapter.fighters().filter(f => f.kind !== 'player' && f.alive && f.id !== me.id)
      .map(f => ({ f, d: Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z), fw: -(f.pos.x - me.pos.x) * Math.sin(me.yaw) - (f.pos.z - me.pos.z) * Math.cos(me.yaw) }))
      .filter(o => o.fw > 0).sort((x, y) => x.d - y.d);
    const t = ds[Math.min(k, ds.length - 1)]?.f; if (!t) return null;
    const eyeY = me.pos.y + me.height - 0.1, hy = t.pos.y + t.height - 0.12;
    const dx = t.pos.x - me.pos.x, dz = t.pos.z - me.pos.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(hy - eyeY, Math.hypot(dx, dz)), name: t.name };
  };
});
const at = {};
const on = (f, fn) => (at[f] ??= []).push(fn);
const key = (f, code, len = 2) => { on(f, p => p.evaluate(c => window.stickfight.input.press(c), code)); on(f + len, p => p.evaluate(c => window.stickfight.input.release(c), code)); };
let aim = null; // {from, to, f0, n}
const aimTo = (f, k, n = 9) => on(f, async p => { const t = await p.evaluate(k => window.aimAt(k), k); const cur = await p.evaluate(() => ({ yaw: window.stickfight.input.yaw, pitch: window.stickfight.input.pitch })); if (t) { let dy = t.yaw - cur.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); aim = { from: cur, to: { yaw: cur.yaw + dy, pitch: t.pitch }, f0: f, n }; console.log('aim', t.name); } });
const turn = (f, dyaw, n) => on(f, async p => { const cur = await p.evaluate(() => ({ yaw: window.stickfight.input.yaw, pitch: window.stickfight.input.pitch })); aim = { from: cur, to: { yaw: cur.yaw + dyaw, pitch: 0 }, f0: f, n }; });

// ---- choreography (frames at 30 fps) ----
key(2, 'Digit2');                       // sniper
key(24, 'KeyW', 60);                    // run down the lane
key(38, 'Space'); key(50, 'Space');     // jump, air jump
key(56, 'ShiftLeft');                   // air dash
key(78, 'KeyC', 16);                    // slide on landing
aimTo(96, 0, 10);
key(106, 'Mouse2', 18); key(112, 'Mouse0'); // quickscope ~0.2 s after scoping in
key(132, 'KeyQ');                       // shoulder swap
aimTo(140, 1, 10);
key(150, 'Space'); key(153, 'Mouse2', 14); key(160, 'Mouse0'); // airborne quickscope
key(176, 'Digit2', 0);
turn(180, 0.9, 20);
key(184, 'KeyD', 50); key(186, 'ShiftLeft'); // strafe + ground dash
key(212, 'Space'); key(222, 'Space');
turn(230, -0.9, 20);
aimTo(252, 0, 8);
key(262, 'Mouse2', 30); key(276, 'Mouse0');
const END = 300;

for (let f = 0; f < END; f++) {
  for (const fn of at[f] ?? []) await fn(page);
  if (aim) {
    const u = Math.min(1, (f - aim.f0) / aim.n), e = u * u * (3 - 2 * u);
    await page.evaluate(([y, pch]) => { const i = window.stickfight.input; i.yaw = y; i.pitch = pch; }, [aim.from.yaw + (aim.to.yaw - aim.from.yaw) * e, aim.from.pitch + (aim.to.pitch - aim.from.pitch) * e]);
    if (u >= 1) aim = null;
  }
  await page.evaluate((dt) => window.stickfight.loop.advance(dt), 1 / FPS);
  await page.screenshot({ path: `${out}/f${String(f).padStart(4, '0')}.png` });
  if (f % 30 === 0) console.log('frame', f);
}
await browser.close();
