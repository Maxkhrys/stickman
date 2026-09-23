import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const dir = 'verification/mobile';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: !process.env.DISPLAY,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok) => { checks.push({ name, ok: !!ok }); assert.ok(ok, name); console.log('PASS', name); };
const draw = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const tap = name => page.locator(`[data-touch="${name}"]`).tap();
const center = async name => {
  const b = await page.locator(`[data-touch="${name}"]`).boundingBox();
  assert.ok(b, `Visible ${name} control`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const cdp = await context.newCDPSession(page);
const points = new Map();
async function touch(type, id, point) {
  const ended = id !== undefined && points.has(id) ? [points.get(id)] : [];
  if (id !== undefined) {
    if (point) points.set(id, { id, ...point, radiusX: 3, radiusY: 3, force: 1 });
    else points.delete(id);
  }
  if (type === 'touchCancel') points.clear();
  // A partial end names the lifted contact; cancellation terminates the whole sequence.
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? ended : [...points.values()] });
  await draw(); // Chromium may coalesce moves until the next display frame.
}
async function expectButton(name, mask) {
  await page.evaluate(() => { window.mobileSeen = []; });
  await tap(name);
  await page.waitForFunction(mask => window.mobileSeen.some(c => (c.buttons & mask) !== 0), mask);
  check(`${name} tap reaches the existing simulation command`, true);
}
const weapon = () => page.evaluate(() => { const f = window.stickfight.adapter.fighters()[0]; return f.weapons[f.cur].id; });
try {
  await page.goto(process.env.URL || 'http://127.0.0.1:5178', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.stickfight);
  check('Automatic touch detection', await page.evaluate(() => window.stickfight.input.touchMode));
  check('Touch layer does not obstruct menus', !(await page.locator('#touch-controls').isVisible()));
  await page.screenshot({ path: `${dir}/menu-landscape.png` });
  await page.getByRole('button', { name: 'PLAY', exact: true }).tap();
  await page.waitForFunction(() => window.stickfight.state === 'playing' && window.stickfight.input.locked);
  check('Mobile plays without browser pointer lock', await page.evaluate(() => !document.pointerLockElement));
  await page.evaluate(() => {
    window.mobileSeen = [];
    const input = window.stickfight.input, original = input.buildCommand.bind(input);
    input.buildCommand = () => {
      const cmd = original();
      window.mobileSeen.push({ ...cmd });
      if (window.mobileSeen.length > 256) window.mobileSeen.shift();
      return cmd;
    };
  });
  check('Living sand remains enabled', await page.evaluate(async () => (await import('/src/render/sand.ts')).SAND.enabled));
  const origin = await page.evaluate(() => ({ ...window.stickfight.adapter.fighters()[0].pos }));
  const shots = await page.evaluate(() => window.stickfight.adapter.fighters()[0].stats.shots);
  const stick = await center('move');
  await touch('touchStart', 1, stick);
  await touch('touchMove', 1, { x: stick.x, y: stick.y - 45 });
  await touch('touchStart', 2, { x: 430, y: 160 });
  const fire = await center('fire');
  await touch('touchStart', 3, fire);
  await page.waitForFunction(({ origin, shots }) => {
    const f = window.stickfight.adapter.fighters()[0];
    return Math.hypot(f.pos.x - origin.x, f.pos.z - origin.z) > 0.1 && f.stats.shots > shots;
  }, { origin, shots });
  check('Real movement and firing with three simultaneous contacts', true);
  const yaw = await page.evaluate(() => window.stickfight.input.yaw);
  await touch('touchMove', 2, { x: 465, y: 160 });
  check('Independent look while moving and firing', await page.evaluate(yaw => window.stickfight.input.yaw < yaw && window.stickfight.input.isHeld('fire'), yaw));
  const yaw2 = await page.evaluate(() => window.stickfight.input.yaw);
  await touch('touchMove', 3, { x: fire.x - 25, y: fire.y });
  check('Fire button supports two-thumb drag aiming', await page.evaluate(yaw2 => window.stickfight.input.yaw > yaw2 && window.stickfight.input.isHeld('fire'), yaw2));
  await touch('touchEnd', 3);
  check('Releasing fire preserves movement', await page.evaluate(() => !window.stickfight.input.isHeld('fire') && window.stickfight.input.buildCommand().forward > 0.9));
  await touch('touchCancel');
  check('Native cancellation clears held controls', await page.evaluate(() => { const c = window.stickfight.input.buildCommand(); return c.buttons === 0 && c.forward === 0 && c.strafe === 0; }));
  await expectButton('reload', 16);
  await expectButton('jump', 1);
  await expectButton('crouch', 2);
  await tap('ads');
  await page.waitForFunction(() => window.stickfight.adapter.fighters()[0].ads > 0.9);
  check('Tap-to-ADS uses existing aiming', await page.locator('[data-touch="ads"]').getAttribute('aria-pressed') === 'true');
  await tap('ads');
  await page.waitForFunction(() => window.stickfight.adapter.fighters()[0].ads < 0.1);
  const seenWeapons = new Set([await weapon()]);
  for (let i = 0; i < 6; i++) {
    const old = await weapon();
    await tap('next');
    await page.waitForFunction(old => { const f = window.stickfight.adapter.fighters()[0]; return f.weapons[f.cur].id !== old && f.switchTimer === 0; }, old);
    const current = await weapon();
    seenWeapons.add(current);
    if (current === 'sniper') {
      await tap('ads');
      await page.waitForFunction(() => window.stickfight.renderer.zoom.scopeCover > 0.8);
      await page.screenshot({ path: `${dir}/sniper-scope-touch.png` });
      check('Sniper scope remains usable behind touch controls', true);
      await tap('ads');
      await page.waitForFunction(() => window.stickfight.renderer.zoom.scopeCover < 0.1);
    }
  }
  check('All six range weapons accessible from touch', seenWeapons.size === 6);
  const oldWeapon = await weapon();
  await tap('previous');
  await page.waitForFunction(old => { const f = window.stickfight.adapter.fighters()[0]; return f.weapons[f.cur].id !== old; }, oldWeapon);
  check('Reverse weapon cycling', true);
  const camera = await page.evaluate(() => window.stickfight.settings.cameraMode);
  await tap('camera');
  check('Camera button preserves perspective switching', await page.evaluate(camera => window.stickfight.settings.cameraMode !== camera, camera));
  const side = await page.evaluate(() => window.stickfight.settings.shoulder);
  await tap('shoulder');
  check('Camera shoulder button', await page.evaluate(side => window.stickfight.settings.shoulder !== side, side));
  await tap('hitboxes');
  check('Practice hit regions still available', await page.evaluate(() => window.stickfight.settings.showHitboxes && window.stickfight.renderer.hitboxes.enabled));
  await tap('hitboxes');
  await tap('score'); await draw();
  check('Touch scoreboard opens', await page.locator('[data-touch="score"]').getAttribute('aria-pressed') === 'true');
  await tap('score');
  await page.screenshot({ path: `${dir}/game-landscape.png` });
  await touch('touchStart', 1, await center('fire'));
  await touch('touchStart', 2, await center('pause'));
  await touch('touchCancel');
  await page.waitForFunction(() => window.stickfight.state === 'paused');
  check('Pause releases fire and hides touch layer', await page.evaluate(() => !window.stickfight.input.locked && window.stickfight.input.buildCommand().buttons === 0) && !(await page.locator('#touch-controls').isVisible()));
  await page.getByRole('button', { name: /resume/i }).tap();
  await page.waitForFunction(() => window.stickfight.state === 'playing');
  await tap('ads');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.stickfight.state === 'paused');
  check('Portrait rotation pauses and clears ADS', await page.evaluate(() => window.stickfight.input.buildCommand().buttons === 0));
  check('Rotate hint is visible without blocking menus', await page.locator('.touch-rotate-hint').isVisible());
  await page.screenshot({ path: `${dir}/portrait-paused.png` });
  await page.getByRole('button', { name: /resume/i }).tap();
  check('Portrait resume safely stays paused', await page.evaluate(() => window.stickfight.state === 'paused' && !window.stickfight.input.locked));
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByRole('button', { name: /resume/i }).tap();
  await page.waitForFunction(() => window.stickfight.state === 'playing');
  check('Every small-landscape action has a visible 44px target', await page.locator('#touch-controls button').evaluateAll(es => es.every(e => { const b = e.getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; })));
  await page.screenshot({ path: `${dir}/small-landscape.png` });
  await touch('touchStart', 1, await center('fire'));
  await page.evaluate(() => dispatchEvent(new Event('blur')));
  await touch('touchCancel');
  check('App-switch blur pauses and clears fire', await page.evaluate(() => window.stickfight.state === 'paused' && window.stickfight.input.buildCommand().buttons === 0));
  await page.getByRole('button', { name: 'Quit to menu', exact: true }).tap();
  check('Quit returns to usable menu', await page.getByRole('button', { name: 'PLAY', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Armory & contracts', exact: true }).tap();
  check('Armory fits the mobile viewport', await page.locator('.armory-sheet').evaluate(e => e.scrollWidth <= e.clientWidth + 2 && e.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({ path: `${dir}/armory-mobile.png` });
  check('No mobile runtime errors', errors.length === 0);
} catch (error) {
  await page.screenshot({ path: `${dir}/failure.png` }).catch(() => {});
  console.error(await page.evaluate(() => ({ state: window.stickfight?.state, active: window.stickfight?.input.locked, text: document.body.innerText.slice(0, 1000) })).catch(() => null));
  throw error;
} finally {
  await writeFile(`${dir}/report.json`, JSON.stringify({ checks, errors, note: 'Chromium touch emulation / software GPU. Physical iOS/Android and hardware FPS are not measured.' }, null, 2));
  await browser.close();
}
