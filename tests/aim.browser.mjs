import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('verification/aim', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
const check = (name, ok) => { checks.push({ name, ok }); assert.ok(ok, name); console.log('PASS', name); };
try {
  await page.goto(process.env.URL || 'http://127.0.0.1:5178', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.stickfight);
  await page.evaluate(async () => {
    const a = window.stickfight; a.loop.stop();
    Object.assign(a.settings, { mode: 'range', cameraMode: 'third', cameraShake: 0, fovKick: false });
    a.input.lock = async () => {};
    await a.startMatch(); a.loop.stop();
    const f = a.adapter.fighters()[0];
    Object.assign(f, { yaw: 0, pitch: 0, lowerYaw: 0, prevYaw: 0, prevLowerYaw: 0, spawnProtect: 0, switchTimer: 0, ads: 0, prevAds: 0 });
    f.pos = { x: 0, y: 0, z: 5 }; f.prevPos = { ...f.pos };
    a.input.yaw = 0; a.input.pitch = 0;
    for (let i = 0; i < 20; i++) a.frame(1, 1 / 60);
  });
  const geometry = await page.evaluate(async () => {
    const a = window.stickfight, r = a.renderer, f = a.adapter.fighters()[0];
    const { emptyCommand } = await import('/src/sim/types.ts');
    const { forwardFromAngles, vaddScaled } = await import('/src/sim/vec.ts');
    const { traceFireLine, traceShot } = await import('/src/sim/combat.ts');
    const { eyePos } = await import('/src/sim/fighter.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const results = [];
    for (const shoulder of [-1, 1]) {
      a.settings.shoulder = shoulder;
      for (let i = 0; i < 60; i++) a.frame(1, 1 / 60);
      const raw = { yaw: a.input.yaw, pitch: a.input.pitch };
      const cmd = { ...emptyCommand(), ...raw };
      a.convergeCommand(cmd, f);
      const aim = r.aimRay(f, raw.yaw, raw.pitch);
      const desired = traceShot({ world: a.adapter.world(), fighters: a.adapter.fighters() }, f, aim.origin, aim.direction, 200).point;
      const dir = forwardFromAngles(cmd.yaw, cmd.pitch);
      const t = (desired.z - eyePos(f).z) / dir.z;
      const point = vaddScaled(eyePos(f), dir, t);
      const px = r.project(new THREE.Vector3(point.x, point.y, point.z));
      if (!px) throw Error('converged aim point is behind camera');
      results.push({ shoulder, error: Math.hypot(px.x - innerWidth / 2, px.y - innerHeight / 2), raw: raw.yaw === a.input.yaw && raw.pitch === a.input.pitch });
      // Sweep live fighters across the aim ray. The HUD and raw mouse never chase them.
      const target = a.adapter.fighters()[1];
      for (let i = -5; i <= 5; i++) {
        target.pos = { x: i * 0.3, y: 0, z: -6 }; target.prevPos = { ...target.pos };
        a.frame(1, 1 / 60);
        if (a.hud.xh.style.left !== '50%' || a.hud.xh.style.top !== '50%' || a.hud.hm.style.left !== '50%' || a.input.yaw !== raw.yaw) throw Error('reticle follows target');
      }
    }
    return results;
  });
  await writeFile('verification/aim/geometry.json', JSON.stringify(geometry, null, 2));
  check('Centred reticle and hitmarker stay fixed as enemies cross both shoulders', geometry.every(x => x.raw));
  check('Eye convergence matches screen centre within one pixel', geometry.every(x => x.error < 1));
  const effects = await page.evaluate(async () => {
    const { Effects } = await import('/src/render/Effects.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const e = new Effects(); e.pixelWorldScale = 0.001;
    const from = new THREE.Vector3(0, 1, 0), to = new THREE.Vector3(0, 1, -0.15);
    let shortVisible = true, noOvershoot = true;
    for (const fps of [30, 60, 120]) {
      e.clear(); e.tracer(from, to, 0.02, 0, 0.28, 330, 3.2);
      const t = e.tracers[(e.tracerIdx + 31) % 32];
      e.update(1 / fps);
      shortVisible &&= t.mesh.visible;
      const end = t.mesh.position.clone().addScaledVector(t.dir, t.mesh.scale.z);
      noOvershoot &&= end.distanceTo(to) < 1e-8;
      for (let i = 0; i < 30; i++) e.update(1 / fps);
      noOvershoot &&= !t.active && !t.mesh.visible;
    }
    e.clear(); e.tracerIdx = 0; e.tracer(from, to); e.update(0.01); e.tracerIdx = 0; e.tracer(from, from);
    const recycle = !e.tracers[0].active && !e.tracers[0].mesh.visible;
    e.clear(); e.tracer(from, new THREE.Vector3(0, 1, -60), 0.02, 0, 0, 300, 3.2);
    const t = e.tracers[(e.tracerIdx + 31) % 32]; e.update(0.002, 1 / 60);
    const hitStop = Math.abs(t.head - 5) < 1e-8;
    const anchor = from.clone();
    e.worldFlash(anchor, 0.18, out => { out.copy(anchor); return true; });
    const flash = e.flashes[(e.flashIdx + 9) % 10];
    e.update(1 / 60); anchor.x = 2; e.update(1 / 60);
    const follows = flash.s.position.x === 2 && flash.s.visible;
    for (let i = 0; i < 6; i++) e.update(0.001, 1 / 60);
    const expires = !flash.s.visible;
    e.worldFlash(from); e.clear(); e.update(1 / 60);
    const clears = e.flashes.every(f => !f.s.visible && !f.follow);
    return { shortVisible, noOvershoot, recycle, hitStop, follows, expires, clears };
  });
  await writeFile('verification/aim/effects.json', JSON.stringify(effects, null, 2));
  for (const [key, value] of Object.entries(effects)) check(`Effects regression: ${key}`, value);
  const sockets = await page.evaluate(async () => {
    const a = window.stickfight, r = a.renderer, f = a.adapter.fighters()[0];
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { muzzlePos } = await import('/src/sim/fighter.ts');
    let attached = true, copied = true, clears = true;
    for (const id of ['ar', 'smg', 'carbine', 'sniper', 'pistol']) {
      f.cur = f.weapons.findIndex(w => w.id === id); f.switchTimer = 0; f.ads = f.prevAds = 0;
      for (let i = 0; i < 12; i++) a.frame(1, 1 / 60);
      const from = muzzlePos(f), end = { x: from.x, y: from.y, z: from.z - 20 };
      const ev = { type: 'shot', id: f.id, weapon: id, from, to: end, dir: { x: 0, y: 0, z: -1 }, hitWorld: false, normal: null, obstructed: false };
      r.queueShot(ev, true); const saved = r.pendingShots[0].event.to.z; end.z = -999;
      copied &&= r.pendingShots[0].event.to.z === saved;
      a.frame(1, 1 / 60);
      const flash = r.effects.flashes[(r.effects.flashIdx + 9) % 10];
      const socket = new THREE.Vector3();
      attached &&= r.characters.muzzleOf(f.id, id, socket) && flash.s.visible && socket.distanceTo(flash.s.position) < 1e-6;
      r.effects.clear();
    }
    const vm = r.viewmodel;
    a.settings.cameraMode = 'first'; f.cur = 0; a.frame(1, 1 / 60);
    vm.fire('ar', 0); a.frame(1, 1 / 60);
    const fpAttached = vm.flash.visible && vm.flash.position.distanceTo(vm.muzzleVM) < 1e-8 && !vm.flashCore.visible;
    f.cur = 2; a.frame(1, 1 / 60); clears &&= !vm.flash.visible;
    vm.fire(f.weapons[f.cur].id, 0); f.alive = false; a.frame(1, 1 / 60); clears &&= !vm.flash.visible;
    f.alive = true; f.cur = 0; a.settings.cameraMode = 'third';
    return { attached, copied, fpAttached, clears };
  });
  await writeFile('verification/aim/sockets.json', JSON.stringify(sockets, null, 2));
  for (const [key, value] of Object.entries(sockets)) check(`Shot socket regression: ${key}`, value);
  await page.evaluate(async () => {
    const a = window.stickfight, f = a.adapter.fighters()[0]; a.settings.shoulder = 1;
    f.cur = 0; f.ads = f.prevAds = 0;
    for (let i = 0; i < 30; i++) a.frame(1, 1 / 60);
    const { fireHitscan } = await import('/src/sim/combat.ts'); const { WEAPONS } = await import('/src/config/weapons.ts');
    const m = a.adapter.match; m.events.length = 0; fireHitscan(m, f, WEAPONS.ar);
    for (const e of a.adapter.drainEvents()) a.onEvent(e);
    a.frame(1, 1 / 60);
  });
  await page.screenshot({ path: 'verification/aim/third-person-shot.png' });
  check('No browser runtime errors', errors.length === 0);
  await writeFile('verification/aim/geometry.json', JSON.stringify(geometry, null, 2));
} catch (error) { await page.screenshot({ path: 'verification/aim/failure.png' }).catch(() => {}); throw error; }
finally { await writeFile('verification/aim/report.json', JSON.stringify({ checks, errors }, null, 2)); await browser.close(); }
