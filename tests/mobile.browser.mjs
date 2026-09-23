// Touch play on an iPhone-sized landscape viewport with real multi-touch (CDP touch events -> pointer
// events). Verifies the on-screen controls drive the same simulation as keyboard + mouse.
// Run against a dev server: URL=http://127.0.0.1:5178 node tests/mobile.browser.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('verification', { recursive: true });
const URL = process.env.URL || 'http://127.0.0.1:5178';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// iPhone 14 class: 844 x 390 CSS px landscape, DPR 3, touch, mobile viewport
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const errors = [];
const checks = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); assert.ok(ok, name + ' ' + detail); };
const frames = (n = 2) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const sim = () => page.evaluate(() => { const a = window.stickfight; const f = a.adapter.fighters()[0]; const w = f.weapons[f.cur];
  return { state: a.state, locked: a.input.locked, x: f.pos.x, z: f.pos.z, y: f.pos.y, yaw: a.input.yaw, pitch: a.input.pitch, shots: f.stats.shots, ads: f.ads, weapon: w.id, crouch: f.crouching, vy: f.vel.y, cover: a.renderer.zoom.scopeCover, time: a.adapter.info().time }; });

// multi-touch driver: every CDP event carries all fingers currently down
const fingers = new Map();
const send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.values()].map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
async function fdown(id, x, y) { fingers.set(id, { id, x, y }); await send('touchStart'); }
async function fmove(id, x, y) { const p = fingers.get(id); p.x = x; p.y = y; await send('touchMove'); }
async function fup(id) { const p = fingers.get(id); fingers.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...fingers.values()].map((q) => ({ x: q.x, y: q.y, id: q.id })) }); void p; }
async function tap(x, y, id = 9) { await fdown(id, x, y); await frames(1); await fup(id); }
const center = (sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.stickfight);
  check('Touch device detected (coarse pointer)', await page.evaluate(() => window.stickfight.input.touchMode && document.body.classList.contains('touch')));

  // portrait: rotate prompt covers the page
  await page.setViewportSize({ width: 390, height: 844 });
  await frames(2);
  check('Portrait shows rotate prompt', await page.evaluate(() => getComputedStyle(document.querySelector('.rotate-hint')).display !== 'none'));
  await page.screenshot({ path: 'verification/mobile-portrait.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await frames(2);
  check('Landscape hides rotate prompt', await page.evaluate(() => getComputedStyle(document.querySelector('.rotate-hint')).display === 'none'));

  // start the practice range by tapping PLAY
  await page.evaluate(() => { window.stickfight.settings.mode = 'range'; });
  await page.getByRole('button', { name: 'PLAY', exact: true }).tap();
  await page.waitForFunction(() => window.stickfight.state === 'playing' && window.stickfight.input.locked, null, { timeout: 30000 });
  await frames(3);
  check('Touch controls visible while playing', await page.evaluate(() => !document.getElementById('touch').classList.contains('hidden')));
  await page.screenshot({ path: 'verification/mobile-hud.png' });

  // tapping a control never leaks into an emulated mouse click (Mouse0 would fire)
  const s0 = await sim();
  const jumpBtn = await center('#touch .jump');
  await tap(jumpBtn.x, jumpBtn.y);
  await frames(3);
  const s1 = await sim();
  check('Tap on JUMP does not fire', s1.shots === s0.shots, `shots ${s0.shots} -> ${s1.shots}`);
  check('JUMP button jumps', s1.y > 0.05 || s1.vy > 0.5, `y ${s1.y.toFixed(2)} vy ${s1.vy.toFixed(2)}`);
  await frames(40);

  // simultaneous: left thumb pushes the stick forward, right thumb looks, third finger holds FIRE
  const fire = await center('#touch .fire');
  const a0 = await sim();
  await fdown(1, 120, 300);
  await fmove(1, 120, 230); // full forward
  await fdown(2, 560, 200);
  await fdown(3, fire.x, fire.y);
  for (let i = 0; i < 12; i++) { await fmove(2, 560 + (i + 1) * 6, 200); await frames(1); }
  await frames(6);
  const a1 = await sim();
  await fup(3); await fup(2); await fup(1);
  const moved = Math.hypot(a1.x - a0.x, a1.z - a0.z);
  check('Stick moves the player', moved > 0.5, `${moved.toFixed(2)} m`);
  check('Look drag turns the view at the same time', Math.abs(a1.yaw - a0.yaw) > 0.1, `dyaw ${(a1.yaw - a0.yaw).toFixed(3)} rad`);
  check('FIRE held fires at the same time', a1.shots > a0.shots, `shots +${a1.shots - a0.shots}`);
  await frames(4);
  const a2 = await sim();
  check('Releasing the stick stops input', Math.hypot(a2.x - a1.x, a2.z - a1.z) < moved, 'stick released');

  // fire-drag: the FIRE finger aims while shooting (no need to lift the look thumb)
  const b0 = await sim();
  await fdown(4, fire.x, fire.y);
  for (let i = 0; i < 10; i++) { await fmove(4, fire.x - (i + 1) * 5, fire.y - (i + 1) * 2); await frames(1); }
  const b1 = await sim();
  await fup(4);
  check('Dragging from FIRE aims while firing', Math.abs(b1.yaw - b0.yaw) > 0.05 && b1.shots > b0.shots, `dyaw ${(b1.yaw - b0.yaw).toFixed(3)} shots +${b1.shots - b0.shots}`);

  // a finger crossing other controls keeps its owner (look finger slides over JUMP: no jump)
  const c0 = await sim();
  await fdown(5, 600, 150);
  await fmove(5, jumpBtn.x, jumpBtn.y);
  await frames(3);
  const c1 = await sim();
  await fup(5);
  check('Look finger crossing a button keeps looking (no press)', c1.vy <= 0.01 && Math.abs(c1.yaw - c0.yaw) > 0.05, `vy ${c1.vy.toFixed(2)}`);

  // ADS toggle
  const ads = await center('#touch .ads');
  await tap(ads.x, ads.y);
  await frames(20);
  const d1 = await sim();
  check('AIM tap toggles ADS on', d1.ads > 0.9, `ads ${d1.ads.toFixed(2)}`);
  // look while aimed: same drag turns less (zoom-compensated sensitivity)
  const e0 = await sim();
  await fdown(6, 600, 200); for (let i = 0; i < 6; i++) { await fmove(6, 600 + (i + 1) * 10, 200); await frames(1); } await fup(6);
  const e1 = await sim();
  await tap(ads.x, ads.y);
  await frames(20);
  const d2 = await sim();
  check('AIM tap again toggles ADS off', d2.ads < 0.1, `ads ${d2.ads.toFixed(2)}`);
  await fdown(6, 600, 200); for (let i = 0; i < 6; i++) { await fmove(6, 600 + (i + 1) * 10, 200); await frames(1); } await fup(6);
  const e2 = await sim();
  const aimTurn = Math.abs(e1.yaw - e0.yaw), hipTurn = Math.abs(e2.yaw - d2.yaw);
  check('ADS look is slower than hip look (zoom compensation)', aimTurn < hipTurn && aimTurn > 0, `ads ${aimTurn.toFixed(3)} vs hip ${hipTurn.toFixed(3)} rad`);

  // weapon swap -> sniper, scope in, quick-scope shot
  const swap = await center('#touch .swap');
  let guard = 0;
  while ((await sim()).weapon !== 'sniper' && guard++ < 8) { await tap(swap.x, swap.y); await frames(20); }
  check('Swap button cycles to the sniper', (await sim()).weapon === 'sniper');
  await tap(ads.x, ads.y);
  await page.waitForFunction(() => window.stickfight.renderer.zoom.scopeCover > 0.95, null, { timeout: 20000 });
  await frames(2);
  await page.screenshot({ path: 'verification/mobile-scope.png' });
  const f0 = await sim();
  await tap(fire.x, fire.y, 7);
  await frames(6);
  const f1 = await sim();
  check('Scoped touch shot fires (quick-scope)', f1.shots === f0.shots + 1, `shots +${f1.shots - f0.shots}`);
  await tap(ads.x, ads.y);
  await frames(10);

  // slide: stick forward + SLIDE
  const crouch = await center('#touch .crouch');
  await fdown(1, 120, 300); await fmove(1, 120, 230);
  await frames(25);
  await fdown(8, crouch.x, crouch.y);
  await frames(4);
  const g1 = await sim();
  await fup(8); await fup(1);
  check('SLIDE button crouches / slides', g1.crouch, `crouching ${g1.crouch}`);

  // pause button -> pause menu; Resume tap -> playing
  const pause = await center('#touch .pause');
  await tap(pause.x, pause.y);
  await page.waitForFunction(() => window.stickfight.state === 'paused');
  check('Pause button pauses', true);
  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await page.waitForFunction(() => window.stickfight.state === 'playing' && window.stickfight.input.locked);
  check('Resume by tap', true);

  // rotating to portrait mid-game pauses behind the prompt
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.stickfight.state === 'paused', null, { timeout: 5000 });
  check('Portrait mid-game pauses', true);
  await page.setViewportSize({ width: 844, height: 390 });
  await frames(2);

  // other iPhone-style aspect ratios keep every control on screen
  for (const [w, h] of [[932, 430], [667, 375], [780, 360]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.getByRole('button', { name: 'Resume', exact: true }).tap().catch(() => {});
    await frames(3);
    const inside = await page.evaluate(() => [...document.querySelectorAll('#touch .tb')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
    check(`Controls fit ${w}x${h}`, inside);
  }
  await page.screenshot({ path: 'verification/mobile-hud-wide.png' });
  check('No runtime errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  await page.screenshot({ path: 'verification/mobile-failure.png' }).catch(() => {});
  throw e;
} finally {
  await writeFile('verification/mobile-report.json', JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
