// Visual review harness for the third-person stick fighter.
// Drives the real game deterministically (loop stopped, fixed 60 Hz frames), poses the local
// fighter through locomotion / combat states and writes stills plus contact sheets to
// verification/char/. Run: node tests/character.capture.mjs  [filter]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const OUT = 'verification/char';
await mkdir(OUT, { recursive: true });
const filter = process.argv[2] ?? '';
const server = await createServer({ server: { host: '127.0.0.1', port: 5196 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await browser.close().catch(() => {}); process.exit(1); });
const W = Number(process.env.CAP_W ?? 900), H = Number(process.env.CAP_H ?? 600);
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
// optional offline font cache (node_modules/.cache/fonts, fetched once with curl) so HUD captures use the real hands
{
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = 'node_modules/.cache/fonts';
  const files = await readdir(dir).catch(() => []);
  if (files.includes('fonts.css')) {
    await page.route('https://fonts.googleapis.com/**', async (r) => r.fulfill({ contentType: 'text/css', body: await readFile(`${dir}/fonts.css`, 'utf8') }));
    await page.route('https://fonts.gstatic.com/**', async (r) => r.fulfill({ contentType: 'font/woff2', body: await readFile(`${dir}/${r.request().url().split('/').pop()}`) }));
  }
}
page.on('pageerror', (e) => errors.push(e.message));
const shots = [];

async function boot() {
  if (process.env.CAP_SKETCH) await page.addInitScript(() => { window.__sketch = true; });
  await page.goto('http://127.0.0.1:5196/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.stickfight);
  await page.evaluate(() => { const a = window.stickfight; a.settings.cameraMode = 'third'; a.settings.mode = 'range'; a.settings.sketchSlide = !!window.__sketch; });
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.waitForFunction(() => window.stickfight.state === 'playing');
  await page.evaluate(() => {
    const a = window.stickfight;
    a.loop.stop();
    a.input.locked = true;
    const me = () => a.adapter.fighters()[0];
    window.cap = {
      me,
      keys(list) { a.input.held.clear(); for (const k of list) a.input.held.add(k); },
      tap(k) { a.input.latched.add(k); },
      slot(i) { a.input.slotReq = i; },
      step(sec) { const n = Math.max(1, Math.round(sec * 60)); for (let i = 0; i < n; i++) a.loop.advance(1 / 60); },
      look(yaw, pitch = 0) { a.input.yaw = yaw; a.input.pitch = pitch; },
      inspect(v) { a.renderer.inspect = v; a.loop.advance(0); },
      place(x, z, yaw) {
        const f = me();
        f.pos.x = f.prevPos.x = x; f.pos.z = f.prevPos.z = z; f.vel.x = f.vel.z = 0; f.yaw = f.prevYaw = yaw; f.lowerYaw = f.prevLowerYaw = yaw;
        a.input.yaw = yaw; a.input.pitch = 0; a.renderer.characters.reset();
      },
      state() { const an = a.renderer.characters.animOf(me().id); return { anim: an?.state, tp: a.renderer.thirdPersonActive, pos: me().pos, vel: me().vel, ground: me().onGround, slide: me().sliding }; },
    };
    // HUD stays; the practice panel and notes cover the fighter in small captures
    document.querySelectorAll('.panel.stats,.note').forEach((e) => (e.style.display = 'none'));
  });
}

const label0 = (name, v) => `${name}-${typeof v === 'string' ? v : 'custom'}`;
async function snap(name, views = ['tp']) {
  for (const v of views) {
    const view = typeof v === 'string' ? VIEWS[v] : v;
    await page.evaluate((ins) => window.cap.inspect(ins), view.ins);
    const t0 = Date.now();
    const buf = await page.screenshot({ timeout: 120000 });
    if (Date.now() - t0 > 5000) console.log('slow screenshot', label0(name, v), Date.now() - t0, 'ms');
    const label = `${name}${views.length > 1 || v !== 'tp' ? '-' + (typeof v === 'string' ? v : 'custom') : ''}`;
    await writeFile(`${OUT}/${label}.png`, buf);
    shots.push({ label, buf });
  }
  await page.evaluate(() => window.cap.inspect(null));
}

const VIEWS = {
  tp: { ins: null },
  front: { ins: { yaw: Math.PI, pitch: 0.12, dist: 3.2, height: 1.0 } },
  rear: { ins: { yaw: 0, pitch: 0.12, dist: 3.2, height: 1.0 } },
  side: { ins: { yaw: Math.PI / 2, pitch: 0.08, dist: 3.2, height: 0.95 } },
  side2: { ins: { yaw: -Math.PI / 2, pitch: 0.08, dist: 3.2, height: 0.95 } },
  tq: { ins: { yaw: Math.PI * 0.75, pitch: 0.15, dist: 3.1, height: 1.0 } },
  high: { ins: { yaw: Math.PI * 0.8, pitch: 0.9, dist: 3.4, height: 0.9 } },
  low: { ins: { yaw: Math.PI * 0.8, pitch: -0.25, dist: 3.0, height: 0.7 } },
  close: { ins: { yaw: Math.PI * 0.62, pitch: 0.1, dist: 1.5, height: 1.2 } },
  closeL: { ins: { yaw: -Math.PI * 0.62, pitch: 0.1, dist: 1.5, height: 1.2 } },
  far: { ins: { yaw: Math.PI * 0.7, pitch: 0.1, dist: 14, height: 1.0 } },
};

const scenes = {
  async idle() {
    await page.evaluate(() => { cap.keys([]); cap.step(1.2); });
    await snap('idle', ['tp', 'front', 'rear', 'side', 'tq', 'high', 'low', 'far']);
  },
  async pitch() {
    await page.evaluate(() => { cap.keys([]); cap.look(cap.me().yaw, 1.2); cap.step(0.4); });
    await snap('aim-up', ['tp', 'side']);
    await page.evaluate(() => { cap.look(cap.me().yaw, -1.2); cap.step(0.4); });
    await snap('aim-down', ['tp', 'side']);
    await page.evaluate(() => { cap.look(cap.me().yaw, 0); cap.step(0.3); });
  },
  async turn() {
    await page.evaluate(() => { cap.keys([]); cap.step(0.5); const y = cap.me().yaw; for (let i = 0; i < 6; i++) { cap.look(y + i * 0.2); cap.step(1 / 60); } });
    await snap('turn-in-place', ['side', 'high']);
    await page.evaluate(() => cap.step(0.4));
    await snap('turn-settled', ['high']);
  },
  async sprint() {
    await page.evaluate(() => { cap.keys(['KeyW']); cap.step(0.9); });
    await snap('sprint', ['tp', 'side', 'front']);
    await page.evaluate(() => cap.step(0.13));
    await snap('sprint-b', ['side']);
    await page.evaluate(() => { cap.keys([]); cap.step(0.08); });
    await snap('stop', ['side']);
    await page.evaluate(() => cap.step(0.6));
  },
  async strafe() {
    await page.evaluate(() => { cap.keys(['KeyD']); cap.step(0.8); });
    await snap('strafe', ['tp', 'front', 'high']);
    await page.evaluate(() => { cap.keys(['KeyA']); cap.step(0.12); });
    await snap('direction-change', ['tp', 'front']);
    await page.evaluate(() => { cap.keys(['KeyW', 'KeyD']); cap.step(0.7); });
    await snap('diagonal', ['tq']);
    await page.evaluate(() => { cap.keys(['KeyS']); cap.step(0.7); });
    await snap('backpedal', ['side']);
    await page.evaluate(() => { cap.keys([]); cap.step(0.6); });
  },
  async jump() {
    await page.evaluate(() => { cap.keys(['KeyW']); cap.step(0.6); cap.keys(['KeyW', 'Space']); cap.step(2 / 60); cap.keys(['KeyW']); });
    await snap('jump-launch', ['side']);
    await page.evaluate(() => cap.step(0.16));
    await snap('jump-air', ['side', 'tp']);
    await page.evaluate(() => { cap.step(0.2); });
    await snap('jump-fall', ['side']);
    await page.evaluate(() => { for (let i = 0; i < 90 && !cap.me().onGround; i++) cap.step(1 / 60); cap.step(3 / 60); });
    await snap('jump-land', ['side', 'tp']);
    await page.evaluate(() => { cap.keys([]); cap.step(0.6); });
  },
  async slide() {
    await page.evaluate(() => { cap.keys(['KeyW']); cap.step(0.8); cap.keys(['KeyW', 'ShiftLeft']); cap.step(0.2); });
    await snap('slide', ['tp', 'side']);
    await page.evaluate(() => { cap.keys(['KeyW']); for (let i = 0; i < 90 && cap.me().sliding; i++) cap.step(1 / 60); cap.step(0.1); });
    await snap('slide-exit', ['side']);
    await page.evaluate(() => { cap.keys(['ShiftLeft']); cap.step(0.5); });
    await snap('crouch-walk', ['side']);
    await page.evaluate(() => { cap.keys([]); cap.step(0.6); });
    await snap('crouch-exit', ['side']);
  },
  async fire() {
    await page.evaluate(() => { cap.keys(['Mouse0']); cap.step(0.05); });
    await snap('hipfire', ['tp', 'side']);
    await page.evaluate(() => { cap.keys(['Mouse2']); cap.step(0.4); });
    await snap('ads', ['tp', 'side', 'front']);
    await page.evaluate(() => { cap.keys([]); cap.tap('KeyR'); cap.step(0.45); });
    await snap('reload-mag', ['tp', 'side']);
    await page.evaluate(() => cap.step(0.5));
    await snap('reload-out', ['side']);
    await page.evaluate(() => cap.step(1.2));
  },
  async weapons() {
    for (const [slot, name] of [[2, 'pistol'], [1, 'sniper'], [4, 'smg'], [5, 'carbine']]) {
      await page.evaluate((s) => { cap.keys([]); cap.slot(s); cap.step(0.06); }, slot);
      await snap(`switch-${name}`, ['side']);
      await page.evaluate(() => cap.step(0.6));
      await snap(`hold-${name}`, ['tp', 'side', 'front']);
    }
    await page.evaluate(() => { cap.slot(1); cap.step(0.7); cap.keys(['Mouse2']); cap.step(0.12); });
    await snap('sniper-raise', ['tp']);
    await page.evaluate(() => { cap.step(0.5); });
    await snap('sniper-scope', ['tp']);
    await page.evaluate(() => { cap.keys(['Mouse2', 'Mouse0']); cap.step(0.05); cap.keys([]); cap.step(0.45); });
    await snap('sniper-bolt', ['side']);
    await page.evaluate(() => { cap.slot(0); cap.step(0.6); });
  },
  async melee() {
    await page.evaluate(() => { cap.keys([]); cap.slot(3); cap.step(0.5); });
    await snap('melee-guard', ['tp', 'side']);
    await page.evaluate(() => { cap.keys(['Mouse0']); cap.step(2 / 60); cap.keys([]); });
    await snap('melee-light-a', ['tp', 'high']);
    await page.evaluate(() => cap.step(0.06));
    await snap('melee-light-b', ['high']);
    await page.evaluate(() => { cap.step(0.6); cap.keys(['Mouse2']); cap.step(2 / 60); cap.keys([]); cap.step(0.2); });
    await snap('melee-heavy-wind', ['tp', 'side']);
    await page.evaluate(() => cap.step(0.14));
    await snap('melee-heavy-stab', ['side']);
    await page.evaluate(() => { cap.step(0.8); cap.slot(0); cap.step(0.5); });
  },
  async hit() {
    await page.evaluate(() => { const a = window.stickfight; const f = cap.me(); a.renderer.characters.hurt(f.id, 1, 0); a.renderer.characters.wound(f.id, { x: f.pos.x + 0.05, y: f.pos.y + 1.3, z: f.pos.z }, f.yaw); cap.step(0.07); });
    await snap('hit-react', ['front', 'side']);
    await page.evaluate(() => cap.step(0.6));
  },
  async hud() {
    await page.evaluate(() => { document.querySelectorAll('.panel.stats,.note').forEach((e) => (e.style.display = '')); cap.keys(['Mouse0']); cap.step(0.25); cap.keys([]); cap.step(0.1); });
    await snap('hud-practice', ['tp']);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.stickfight.renderer.resize(); cap.step(0.1); });
    await snap('hud-mobile-portrait', ['tp']);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => { window.stickfight.renderer.resize(); cap.step(0.1); });
    await snap('hud-mobile-landscape', ['tp']);
    await page.setViewportSize({ width: W, height: H });
    await page.evaluate(() => { window.stickfight.renderer.resize(); document.querySelectorAll('.panel.stats,.note').forEach((e) => (e.style.display = 'none')); cap.step(0.1); });
  },
  async closeup() {
    for (const [slot, name] of [[0, 'ar'], [2, 'pistol'], [1, 'sniper'], [4, 'smg'], [3, 'melee']]) {
      await page.evaluate((s) => { cap.keys([]); cap.slot(s); cap.step(0.7); }, slot);
      await snap(`close-${name}`, ['close', 'closeL']);
    }
    await page.evaluate(() => { cap.slot(0); cap.step(0.7); cap.keys(['Mouse2']); cap.step(0.4); });
    await snap('close-ar-ads', ['close']);
    await page.evaluate(() => { cap.keys(['Mouse0']); cap.step(0.2); cap.keys([]); cap.tap('KeyR'); cap.step(0.2); });
    await snap('close-reload-a', ['close']);
    await page.evaluate(() => cap.step(0.45));
    await snap('close-reload-b', ['close']);
    await page.evaluate(() => cap.step(0.6));
    await snap('close-reload-c', ['close']);
    await page.evaluate(() => { cap.step(1); cap.look(cap.me().yaw, 1.3); cap.step(0.4); });
    await snap('close-pitch-up', ['close', 'side']);
    await page.evaluate(() => { cap.look(cap.me().yaw, -1.3); cap.step(0.4); });
    await snap('close-pitch-down', ['close', 'side']);
    await page.evaluate(() => { cap.look(cap.me().yaw, 0); cap.step(0.3); });
  },
  async sketch() {
    // experimental Sketch Slide: paint a lane with the Inkblaster, slide down it
    await page.evaluate(() => { cap.place(-12, 10, 0); cap.keys([]); cap.slot(0); cap.step(0.5); for (let k = 0; k < 14; k++) { cap.look(0, -0.28 + k * 0.01); cap.keys(['Mouse0']); cap.step(0.12); cap.keys([]); cap.step(0.03); } cap.look(0, 0); cap.tap('KeyR'); cap.step(2.2); });
    console.log('sketch state', JSON.stringify(await page.evaluate(() => ({ opt: window.stickfight.settings.sketchSlide, cells: window.stickfight.adapter.paint()?.cells.size, pos: cap.me().pos, shots: cap.me().stats.shots }))));
    await snap('sketch-paint', ['tp', 'high']);
    await page.evaluate(() => { document.querySelectorAll('.note').forEach((e) => (e.style.display = 'none')); cap.place(-12, 10, 0); cap.keys(['KeyW']); cap.step(0.5); cap.keys(['KeyW', 'ShiftLeft']); cap.step(0.25); });
    await snap('sketch-slide', ['tp', 'side']);
    await page.evaluate(() => { cap.keys([]); cap.step(0.6); });
  },
  async debug() {
    await page.evaluate(() => { const fl = window.stickfight.renderer.characters.debug.flags; fl.authSkeleton = fl.renderSkeleton = fl.footTargets = fl.handTargets = true; cap.keys(['KeyW', 'KeyD']); cap.step(0.7); });
    await snap('debug-overlays', ['side', 'high']);
    await page.evaluate(() => { const fl = window.stickfight.renderer.characters.debug.flags; fl.hideBody = true; });
    await snap('debug-skeleton-only', ['side']);
    await page.evaluate(() => { const fl = window.stickfight.renderer.characters.debug.flags; for (const k in fl) fl[k] = false; cap.keys([]); cap.step(0.5); });
  },
  async death() {
    await page.evaluate(() => {
      const a = window.stickfight;
      const f = cap.me();
      a.renderer.characters.kill(f, { x: 0.7, y: 0.1, z: 0.7 }, false);
      f.alive = false; f.respawnTimer = 99;
      cap.step(0.25);
    });
    // death cam is first person; look at the collapse from outside
    await page.evaluate(() => { const a = window.stickfight; a.renderer.inspect = null; });
    await snap('death-a', [{ ins: { yaw: Math.PI * 0.75, pitch: 0.35, dist: 3.5, height: 0.6 } }]).catch(() => {});
    await page.evaluate(() => cap.step(0.45));
    await snap('death-b', [{ ins: { yaw: Math.PI * 0.75, pitch: 0.35, dist: 3.5, height: 0.6 } }]).catch(() => {});
  },
};

await boot();
// open space away from targets
await page.evaluate(() => { cap.step(0.2); });
for (const [name, fn] of Object.entries(scenes)) {
  if (filter && !name.includes(filter)) continue;
  await page.evaluate(() => { cap.keys([]); cap.place(-3, 4, 0); cap.step(0.4); });
  console.log('scene', name, JSON.stringify(await page.evaluate(() => cap.state())));
  await fn();
}

// contact sheets: 12 stills per page
const cols = 4, per = 12;
for (let s = 0; s * per < shots.length; s++) {
  const group = shots.slice(s * per, (s + 1) * per);
  const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px;font:12px sans-serif;color:#fff">` +
    group.map((g) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/png;base64,${g.buf.toString('base64')}"><span style="position:absolute;left:4px;top:2px;background:#000a;padding:1px 4px">${g.label}</span></div>`).join('') + '</body>';
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  await sheet.setContent(html);
  await sheet.screenshot({ path: `${OUT}/sheet-${String(s).padStart(2, '0')}${filter ? '-' + filter : ''}.png`, fullPage: true });
  await sheet.close();
}
assert.equal(errors.length, 0, errors.join('\n'));
console.log(`captured ${shots.length} stills, no page errors`);
await browser.close();
await server.close();
