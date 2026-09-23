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
  await page.screenshot({ path: 'verification/menu.png' });
  await page.getByRole('button', { name: 'Armory & contracts', exact: true }).click();
  check('Four rendered weapon previews', await page.locator('.weapon-entry img').evaluateAll(imgs => imgs.length === 4 && imgs.every(i => i.complete && i.naturalWidth > 0)));
  await page.screenshot({ path: 'verification/armory.png' });
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
  await page.screenshot({ path: 'verification/third-person.png' });
  const start = await page.evaluate(() => ({ ...window.stickfight.adapter.fighters()[0].pos }));
  await page.keyboard.down('w');
  await page.waitForFunction(start => { const p = window.stickfight.adapter.fighters()[0].pos; return Math.hypot(p.x - start.x, p.z - start.z) > 0.3; }, start, { timeout: 15000 });
  await page.keyboard.up('w');
  check('Real movement input', await page.evaluate(start => { const p = window.stickfight.adapter.fighters()[0].pos; return Math.hypot(p.x - start.x, p.z - start.z) > 0.1; }, start));
  await page.keyboard.press('KeyQ');
  check('Shoulder key swaps camera', await page.evaluate(() => window.stickfight.settings.shoulder === -1));
  await page.keyboard.press('KeyV'); await draw();
  check('V returns to first person', await page.evaluate(() => !window.stickfight.renderer.thirdPersonActive));
  // All weapon rigs must render in hip, ADS and reload, including the new unlocks.
  for (const id of ['ar', 'sniper', 'pistol', 'melee', 'smg', 'carbine']) {
    await page.evaluate(id => { const a = window.stickfight; const f = a.adapter.fighters()[0]; a.input.slotReq = f.weapons.findIndex(w => w.id === id); }, id);
    await page.waitForFunction(id => { const f = window.stickfight.adapter.fighters()[0]; return f.weapons[f.cur].id === id && f.switchTimer === 0; }, id);
    await page.mouse.down({ button: 'right' });
    if (id !== 'melee') await page.waitForFunction(() => window.stickfight.adapter.fighters()[0].ads > 0.98);
    await draw();
    await page.screenshot({ path: `verification/weapon-${id}.png` });
    await page.mouse.up({ button: 'right' });
    if (id !== 'melee') {
      const before = await page.evaluate(() => window.stickfight.adapter.fighters()[0].stats.shots);
      await page.mouse.down();
      await page.waitForFunction(before => window.stickfight.adapter.fighters()[0].stats.shots > before, before);
      await page.mouse.up();
      await page.keyboard.press('KeyR'); await page.waitForTimeout(100);
    }
    check(`${id} rig runs`, errors.length === 0);
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.stickfight.state === 'paused');
  await page.getByRole('button', { name: 'Quit to menu', exact: true }).click();
  await page.getByRole('button', { name: 'Hold the Sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Bookyard', exact: true }).click();
  await page.getByRole('button', { name: 'Third person', exact: true }).click();
  await page.waitForTimeout(1100); // browser's Escape pointer-lock cooldown
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.waitForFunction(() => window.stickfight.state === 'playing' && window.stickfight.input.locked);
  await draw();
  check('New map, equipped weapon and character loaded', await page.evaluate(() => { const a = window.stickfight; const f = a.adapter.fighters()[0]; return a.adapter.map().name === 'Bookyard' && f.weapons[0].id === 'smg' && f.color === 0x22c6e0; }));
  // Inspect objective at center, then let real match rules finish a short deterministic round.
  await page.evaluate(() => { const a = window.stickfight; const m = a.adapter.match; m.fighters[0].pos = { x: 0, y: 0, z: 3 }; m.fighters[0].prevPos = { ...m.fighters[0].pos }; for (const f of m.fighters.slice(1)) { f.alive = false; f.respawnTimer = 9999; } });
  await page.waitForFunction(() => window.stickfight.adapter.fighters()[0].stats.objective >= 1, null, { timeout: 20000 }); await draw();
  await page.screenshot({ path: 'verification/bookyard-objective.png' });
  check('Objective scores and HUD shows state', await page.evaluate(() => window.stickfight.adapter.fighters()[0].stats.objective >= 1 && document.querySelector('.objective-panel').textContent.includes('SCORING')));
  await page.evaluate(() => { window.stickfight.adapter.match.opts.scoreLimit = 2; });
  await page.waitForFunction(() => window.stickfight.state === 'ended', null, { timeout: 10000 });
  check('Match result awards currency', await page.evaluate(() => window.stickfight.profile.data.matches === 1 && window.stickfight.profile.data.ink > 90));
  await page.screenshot({ path: 'verification/results.png' });
  const balance = await page.evaluate(() => window.stickfight.profile.data.ink);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  check('Match reward persists', await page.evaluate(balance => window.stickfight.profile.data.ink === balance, balance));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Armory & contracts', exact: true }).click(); await draw();
  await page.screenshot({ path: 'verification/armory-mobile.png' });
  check('Mobile armory fits viewport', await page.locator('.armory-sheet').evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth));
  check('No runtime errors', errors.length === 0);
} catch (error) {
  console.log('BROWSER DIAGNOSTIC', await page.evaluate(() => ({ state: window.stickfight?.state, locked: window.stickfight?.input.locked, lockElement: document.pointerLockElement?.tagName, errors: document.body.innerText.slice(0,1200) })));
  await page.screenshot({ path: 'verification/failure.png' }).catch(() => {});
  throw error;
} finally {
  await writeFile('verification/report.json', JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
