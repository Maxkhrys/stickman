// CPU cost of the character presentation layer with a full FFA lobby (8 fighters, bots moving and
// shooting). Times CharacterRenderer.update (animation + instanced body emission) per frame.
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 5198 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5198/');
await page.waitForFunction(() => !!window.stickfight);
await page.evaluate(() => { const a = window.stickfight; a.settings.cameraMode = 'third'; a.settings.mode = 'ffa'; a.settings.botCount = 7; a.settings.mapId = 'arena'; });
await page.getByRole('button', { name: 'PLAY', exact: true }).click();
await page.waitForFunction(() => window.stickfight.state === 'playing');
const r = await page.evaluate(() => {
  const a = window.stickfight;
  a.loop.stop();
  a.input.locked = true;
  const ch = a.renderer.characters;
  const orig = ch.update.bind(ch);
  const times = [];
  ch.update = (...args) => { const t = performance.now(); orig(...args); times.push(performance.now() - t); };
  a.input.held.add('KeyW');
  for (let i = 0; i < 240; i++) { if (i % 40 === 0) { a.input.held.delete('KeyW'); a.input.held.add(i % 80 ? 'KeyA' : 'KeyW'); } a.input.yaw += 0.01; a.loop.advance(1 / 60); }
  times.splice(0, 20);
  times.sort((x, y) => x - y);
  const avg = times.reduce((s, x) => s + x, 0) / times.length;
  const fighters = a.adapter.fighters();
  return { fighters: fighters.length, alive: fighters.filter((f) => f.alive).length, avgMs: +avg.toFixed(3), p50: +times[times.length >> 1].toFixed(3), p95: +times[Math.floor(times.length * 0.95)].toFixed(3), draws: a.renderer.renderer.info.render.calls, tris: a.renderer.renderer.info.render.triangles };
});
console.log(JSON.stringify(r));
if (process.env.SHOTS) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir('verification/char', { recursive: true });
  await page.setViewportSize({ width: 900, height: 600 });
  for (let k = 0; k < 4; k++) {
    await page.evaluate(() => { const a = window.stickfight; a.renderer.resize(); for (let i = 0; i < 20; i++) { a.input.yaw += 0.06; a.loop.advance(1 / 60); } });
    await page.screenshot({ path: `verification/char/ffa-${k}.png`, timeout: 120000 });
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
await browser.close();
await server.close();
