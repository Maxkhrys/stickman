import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('verification', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5192 } });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const reports = [];
try {
  for (const sand of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:5192/${sand ? '' : '?sand=0'}`, { waitUntil: 'domcontentloaded' });
    console.log('Loaded', sand ? 'sand' : 'old');
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
    await page.waitForFunction(() => window.stickfight?.state === 'playing');
    await page.waitForTimeout(550);
    const frame = await page.evaluate(async () => {
      const samples = [];
      let previous = performance.now();
      for (let i = 0; i < 24; i++) await new Promise((resolve) => requestAnimationFrame(() => { const now = performance.now(); samples.push(now - previous); previous = now; resolve(); }));
      return { medianMs: samples.sort((a, b) => a - b)[12], calls: window.stickfight.renderer.renderer.info.render.calls, fighters: window.stickfight.adapter.fighters().length };
    });
    console.log('Sampled', sand ? 'sand' : 'old', frame.medianMs);
    await page.screenshot({ path: `verification/${sand ? 'sand' : 'old'}-range.png` });
    if (sand) {
      const lifecycle = await page.evaluate(() => {
        const a = window.stickfight;
        const fx = a.renderer.effects;
        const f = a.adapter.fighters().find((fighter) => fighter.kind !== 'player');
        const p = { ...f.pos, y: f.pos.y + 1.2 };
        a.renderer.characters.wound(f.id, p, f.yaw);
        const c = a.renderer.characters.chars.get(f.id);
        const attached = c.wounds.length === 1;
        f.pos.x += 0.9; f.prevPos.x = f.pos.x;
        fx.clear();
        a.renderer.characters.update(0.1, a.adapter.fighters(), 1, a.adapter.info().time, a.adapter.fighters()[0].id, a.adapter.world(), a.renderer.camera);
        const movedWound = fx.particles.some((grain) => grain.alive && grain.sand && grain.p.x > p.x + 0.4 && grain.p.x < p.x + 1.4);
        fx.clear();
        fx.sandBurst({ ...p }, f.color, 700, 0, undefined, 0.05);
        const bounded = fx.particles.filter((x) => x.alive).length <= 600;
        fx.clear();
        const cleared = fx.particles.every((x) => !x.alive);
        const platform = a.adapter.world().boxes.find((b) => b.max.y > 1 && b.max.x - b.min.x > 1 && b.max.z - b.min.z > 1);
        let platformSettled = false;
        if (platform) {
          const x = (platform.min.x + platform.max.x) / 2;
          const z = (platform.min.z + platform.max.z) / 2;
          fx.setWorld(a.adapter.world());
          fx.sandBurst({ x, y: platform.max.y + 0.2, z }, 0xbba89b, 1, 0, undefined, 2);
          for (let i = 0; i < 24; i++) fx.update(1 / 60);
          platformSettled = fx.particles.some((grain) => grain.alive && Math.abs(grain.p.y - platform.max.y) < 0.1);
        }
        fx.clear();
        a.renderer.characters.reset();
        const woundsCleared = a.renderer.characters.chars.size === 0;
        return { attached, movedWound, bounded, cleared, platformSettled, woundsCleared };
      });
      assert.ok(Object.values(lifecycle).every(Boolean), JSON.stringify(lifecycle));
      console.log('Lifecycle', lifecycle);
      // Player can move, draw sniper, scope, fire and switch back without UI exceptions.
      const start = await page.evaluate(() => ({ ...window.stickfight.adapter.fighters()[0].pos }));
      await page.keyboard.down('KeyW'); await page.waitForTimeout(350); await page.keyboard.up('KeyW');
      assert.ok(await page.evaluate((p) => { const q = window.stickfight.adapter.fighters()[0].pos; return Math.hypot(q.x - p.x, q.z - p.z) > 0.05; }, start));
      await page.keyboard.press('Digit2'); await page.waitForTimeout(400);
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(520);
      await page.screenshot({ path: 'verification/sand-sniper-ads.png' });
      await page.mouse.down(); await page.waitForTimeout(180); await page.mouse.up();
      await page.mouse.up({ button: 'right' });
      await page.keyboard.press('KeyR'); await page.keyboard.press('Digit3'); await page.keyboard.press('Digit1');
      await page.waitForTimeout(250);
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log('PASS sand lifecycle, movement, scope, fire, reload and rapid switching');
    }
    reports.push({ sand, frame });
    await page.close();
  }
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  await server.close();
}
