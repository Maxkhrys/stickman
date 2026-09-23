import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('verification', { recursive: true });
const browser = await chromium.launch({ headless: !process.env.DISPLAY, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok) => { checks.push({ name, ok }); assert.ok(ok, name); console.log('PASS', name); };
const draw = async () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  await page.goto(process.env.URL || 'http://127.0.0.1:5178', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.stickfight);
  check('Main menu loads', await page.getByRole('button', { name: 'PLAY', exact: true }).isVisible());
  await page.screenshot({ path: '/tmp/claude-0/-home-user-stickman/bc74881a-fc4a-5522-9f2f-c6fec0dbff56/scratchpad/v/menu.png' });
  await page.getByRole('button', { name: 'Armory & contracts', exact: true }).click();
  check('Four rendered weapon previews', await page.locator('.weapon-entry img').evaluateAll(imgs => imgs.length === 4 && imgs.every(i => i.complete && i.naturalWidth > 0)));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-stickman/bc74881a-fc4a-5522-9f2f-c6fec0dbff56/scratchpad/v/armory.png' });
  await page.getByRole('button', { name: 'Unlock · 350 Ink', exact: true }).click();
  check('Purchase debits 350 Ink and equips SMG', await page.evaluate(() => window.stickfight.profile.data.ink === 250 && window.stickfight.settings.primary === 'smg'));
  await page.getByRole('button', { name: 'Blueprint · 160 Ink', exact: true }).click();
  check('Character ink purchase', await page.evaluate(() => window.stickfight.profile.data.ink === 90 && window.stickfight.profile.color === 0x22c6e0));
  await page.reload({ waitUntil: 'networkidle' });
  check('Profile survives browser reload', await page.evaluate(() => window.stickfight.profile.owns('smg') && window.stickfight.profile.data.ink === 90));
  await page.getByRole('button', { name: 'Third person', exact: true }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.waitForFunction(() => window.stickfight.state === 'playing' && window.stickfight.input.locked);
  await draw();
  check('Third person active', await page.evaluate(() => window.stickfight.renderer.thirdPersonActive));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-stickman/bc74881a-fc4a-5522-9f2f-c6fec0dbff56/scratchpad/v/third-person.png' });
  const start = await page.evaluate(() => ({ ...window.stickfight.adapter.fighters()[0].pos }));
} catch (error) {
  console.log('FAILED', error.message, JSON.stringify(await page.evaluate(() => { const a = window.stickfight; const f = a.adapter.fighters()[0]; return { mode: a.settings.cameraMode, tp: a.renderer.thirdPersonActive, alive: f.alive, pos: f.pos, map: a.adapter.map().name, children: a.renderer.scene.children.length, state: a.state, frame: a.loop?.frame }; })), errors);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-stickman/bc74881a-fc4a-5522-9f2f-c6fec0dbff56/scratchpad/v/fail.png' });
} finally { await browser.close(); }
