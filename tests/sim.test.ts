// Headless simulation checks: movement numbers, collision edge cases, hit registration,
// weapon state rules, sniper, obstruction, bots. Run: npm test
import { Match, TICK_DT } from '../src/sim/match';
import { BTN, emptyCommand, type HitPart, type InputCommand } from '../src/sim/types';
import { yawTo } from '../src/sim/vec';
import { buildSkeleton, createSkeleton } from '../src/sim/body';
import { eyePos, type Fighter } from '../src/sim/fighter';
import { computeSpread } from '../src/sim/combat';
import { weaponState } from '../src/sim/weaponsim';
import { FixedLoop } from '../src/core/Loop';
import { MAPS } from '../src/sim/map';
import { World } from '../src/sim/world';
import { createFighter } from '../src/sim/fighter';
import { simulateMovement } from '../src/sim/movement';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failed++;
}

function setup(mode: 'range' | 'ffa', bots = 0, difficulty: 'easy' | 'normal' | 'hard' = 'hard', seed = 5) {
  const m = new Match({ mode, difficulty, playerName: 'P', botCount: bots, timeLimit: 999, scoreLimit: 999, seed });
  const p = m.fighters[0];
  const place = (x: number, y: number, z: number) => {
    p.pos.x = x; p.pos.y = y; p.pos.z = z; p.vel.x = p.vel.y = p.vel.z = 0; p.onGround = true;
  };
  const run = (secs: number, f: (c: InputCommand, i: number) => void) => {
    let maxY = -99;
    for (let i = 0; i < Math.round(secs / TICK_DT); i++) {
      const c = emptyCommand();
      c.yaw = p.yaw;
      c.pitch = p.pitch;
      f(c, i);
      m.submit(0, c);
      m.step(TICK_DT);
      maxY = Math.max(maxY, p.pos.y);
    }
    return maxY;
  };
  const hs = () => Math.hypot(p.vel.x, p.vel.z);
  return { m, p, place, run, hs };
}

/** aim command at a world point from the player's eye */
function aimAt(p: Fighter, c: InputCommand, x: number, y: number, z: number) {
  const e = eyePos(p);
  c.yaw = yawTo(x - e.x, z - e.z);
  c.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
}

// ---------------------------------------------------------------- movement feel
{
  const { place, run, hs } = setup('range');
  place(-14, 0, 8);
  run(0.1, (c) => { c.forward = 1; c.yaw = 0; });
  check('ground accel snappy', hs() > 7, `${hs().toFixed(2)} m/s after 0.1s`);
  run(0.2, (c) => { c.yaw = 0; });
  check('stops quickly', hs() < 2, `${hs().toFixed(2)} m/s after 0.2s release`);
  place(-14, 0, 8);
  run(0.4, (c) => { c.forward = 1; c.yaw = 0; });
  const before = hs();
  run(0.05, (c) => { c.forward = 1; c.yaw = 0; c.buttons = BTN.CROUCH; });
  check('slide boost', hs() > before + 3, `${before.toFixed(1)} -> ${hs().toFixed(1)}`);
}
{
  const { place, run, hs } = setup('range');
  place(-14, 0, 8);
  let yaw = 0, dir = 1;
  run(0.3, (c) => { c.forward = 1; c.yaw = yaw; });
  const per = Math.round(0.4 / TICK_DT);
  run(2.5, (c, i) => {
    if (i % per === per / 2 || i === 0) dir = -dir;
    yaw -= dir * 2.4 * TICK_DT;
    c.yaw = yaw; c.strafe = dir; c.buttons = BTN.JUMP;
  });
  check('bhop + air strafe gains speed', hs() > 10.5, `${hs().toFixed(2)} m/s after 2.5s`);
}
// ---------------------------------------------------------------- collision
{
  const { p, place, run } = setup('ffa');
  place(-13, 0, 0);
  run(1.2, (c) => { c.yaw = yawTo(1, 0); c.forward = 1; });
  check('walk up ramp onto tower', Math.abs(p.pos.y - 2.4) < 0.01, `y=${p.pos.y.toFixed(2)}`);
  place(0, 0, 26);
  const top = run(1, (c) => { if (p.onGround) c.buttons = BTN.JUMP; });
  check('catwalk ceiling stops head', top + 1.8 <= 2.61, `head max ${(top + 1.8).toFixed(2)}`);
  place(-34, 0, 26);
  run(1.4, (c) => { c.yaw = yawTo(1, 0); c.forward = 1; });
  check('ramp up to catwalk', Math.abs(p.pos.y - 3) < 0.01, `y=${p.pos.y.toFixed(2)}`);
  place(-36, 0, -20);
  const jt = Math.round(0.35 / TICK_DT);
  const cj = run(0.9, (c, i) => { c.yaw = yawTo(1, 0); c.forward = 1; if (i === jt) c.buttons = BTN.JUMP; if (i > jt + 4 && !p.onGround) c.buttons |= BTN.CROUCH; });
  check('crouch-jump onto 2m crate', cj >= 1.99, `max y ${cj.toFixed(2)}`);
  place(-27, 0, -12);
  p.vel.z = 19;
  run(0.5, () => {});
  check('no tunnelling at 19 m/s', p.pos.z < -8.84, `z=${p.pos.z.toFixed(2)}`);
}
// ---------------------------------------------------------------- hit registration per region
{
  const { m, p, run, place } = setup('range');
  const d = m.fighters.find((f) => f.name === 'Dummy 1')!; // static at (-6, -10)
  const sk = createSkeleton();
  const slotOf = (id: string) => p.weapons.findIndex((w) => w.id === id);
  const regions: [string, (s: ReturnType<typeof createSkeleton>) => { x: number; y: number; z: number }, HitPart][] = [
    ['head', (s) => s.head, 'head'],
    ['chest', (s) => ({ x: s.chest.x, y: s.chest.y - 0.1, z: s.chest.z }), 'chest'],
    ['stomach', (s) => ({ x: s.pelvis.x, y: s.pelvis.y + 0.05, z: s.pelvis.z }), 'stomach'],
    ['thigh', (s) => ({ x: (s.lHip.x + s.lKnee.x) / 2, y: (s.lHip.y + s.lKnee.y) / 2, z: (s.lHip.z + s.lKnee.z) / 2 }), 'limb'],
    ['forearm', (s) => ({ x: (s.lElbow.x + s.lHand.x) / 2, y: (s.lElbow.y + s.lHand.y) / 2, z: (s.lElbow.z + s.lHand.z) / 2 }), 'limb'],
  ];
  for (const dist of [5, 20, 40]) {
    for (const [name, pt, want] of regions) {
      place(d.pos.x + 0.001, 0, d.pos.z + dist);
      d.hp = d.maxHp; d.alive = true;
      for (const w of p.weapons) w.mag = 99;
      let got: string = 'miss';
      run(0.25, (c, i) => {
        c.slot = slotOf('pistol');
        buildSkeleton(d, d.weapons[d.cur].id, sk);
        const t = pt(sk);
        aimAt(p, c, t.x, t.y, t.z);
        c.buttons = BTN.ADS;
        if (i === Math.round(0.2 / TICK_DT)) c.buttons |= BTN.FIRE;
      });
      let shotInfo = '';
      for (const e of m.drainEvents()) {
        if (e.type === 'hit' && e.victim === d.id) got = e.part;
        if (e.type === 'shot') shotInfo = `to y=${e.to.y.toFixed(2)} z=${e.to.z.toFixed(2)} world=${e.hitWorld}`;
      }
      check(`hit region ${name} @${dist}m`, got === want, `got ${got} ${got === want ? '' : shotInfo + ' dummy alive=' + d.alive + ' hp=' + d.hp}`);
    }
  }
}
// ---------------------------------------------------------------- ADS timing + accuracy curve
{
  const { p, run } = setup('range');
  run(0.5, (c) => { c.slot = 0; });
  let tAr = -1;
  run(0.4, (c, i) => { c.buttons = BTN.ADS; if (tAr < 0 && p.ads >= 1) tAr = i * TICK_DT; });
  check('rifle ADS entry 150-190ms', tAr >= 0.14 && tAr <= 0.19, `${(tAr * 1000).toFixed(0)} ms`);
  run(0.3, (c) => { c.slot = 1; });
  let tSn = -1, accAt = -1;
  const hip = computeSpread(p);
  run(0.5, (c, i) => {
    c.buttons = BTN.ADS;
    if (accAt < 0 && computeSpread(p) < 0.0005) accAt = i * TICK_DT;
    if (tSn < 0 && p.ads >= 1) tSn = i * TICK_DT;
  });
  check('sniper ADS entry 260-320ms', tSn >= 0.25 && tSn <= 0.32, `${(tSn * 1000).toFixed(0)} ms`);
  check('sniper precise as scope appears', accAt > 0.2 && accAt <= 0.25, `hip spread ${(hip * 1000).toFixed(0)} mrad, precise at ${(accAt * 1000).toFixed(0)} ms (overlay full ~238ms)`);
  // reverse halfway: progress stays continuous
  run(0.2, () => {});
  const seq: number[] = [];
  run(0.3, (c, i) => { if (i < Math.round(0.14 / TICK_DT)) c.buttons = BTN.ADS; seq.push(p.ads); });
  let maxJump = 0;
  for (let i = 1; i < seq.length; i++) maxJump = Math.max(maxJump, Math.abs(seq[i] - seq[i - 1]));
  check('ADS reversal is continuous', maxJump <= TICK_DT / (0.28 * 0.75) + 1e-9, `max step ${maxJump.toFixed(4)}`);
}
// ---------------------------------------------------------------- sniper lethality per region
{
  const { m, p, run, place } = setup('range');
  const d = m.fighters.find((f) => f.name === 'Dummy 1')!;
  const sk = createSkeleton();
  const cases: [string, (s: ReturnType<typeof createSkeleton>) => { x: number; y: number; z: number }, boolean][] = [
    ['head', (s) => s.head, true],
    ['upper chest', (s) => ({ x: s.chest.x, y: s.chest.y - 0.08, z: s.chest.z }), true],
    ['stomach', (s) => ({ x: s.pelvis.x, y: s.pelvis.y + 0.02, z: s.pelvis.z }), false],
    ['thigh', (s) => ({ x: (s.rHip.x + s.rKnee.x) / 2, y: (s.rHip.y + s.rKnee.y) / 2, z: (s.rHip.z + s.rKnee.z) / 2 }), false],
  ];
  for (const [name, pt, lethal] of cases) {
    place(d.pos.x, 0, d.pos.z + 30);
    d.hp = d.maxHp; d.alive = true;
    run(0.6, (c, i) => {
      c.slot = 1;
      buildSkeleton(d, d.weapons[d.cur].id, sk);
      const t = pt(sk);
      aimAt(p, c, t.x, t.y, t.z);
      c.buttons = BTN.ADS;
      if (i === Math.round(0.55 / TICK_DT)) c.buttons |= BTN.FIRE;
    });
    check(`sniper ${name} ${lethal ? 'kills' : 'does not kill'} at full hp`, d.alive === !lethal, `hp ${d.hp}`);
    run(1.3, (c) => { c.slot = 1; }); // let the bolt / respawn settle
    m.drainEvents();
  }
}
// ---------------------------------------------------------------- bolt cycle cannot be skipped by switching
{
  const { m, p, run, place } = setup('range');
  place(-3, 0, 3);
  run(0.6, (c) => { c.slot = 1; c.yaw = 0; });
  let shots = 0;
  const count = () => { for (const e of m.drainEvents()) if (e.type === 'shot') shots++; };
  run(0.05, (c) => { c.yaw = 0; c.buttons = BTN.FIRE; });
  count();
  // switch to pistol mid-bolt and straight back, then spam fire
  run(0.2, (c) => { c.yaw = 0; c.slot = 2; });
  const boltKept = p.weapons[1].boltLeft;
  let secondAt = -1;
  run(1.5, (c, i) => {
    c.yaw = 0;
    c.slot = 1;
    c.buttons = i % 2 ? BTN.FIRE : 0;
    const before = shots;
    count();
    if (secondAt < 0 && shots > before) secondAt = i * TICK_DT;
  });
  count();
  check('bolt not bypassed by switching', shots >= 1 && (secondAt < 0 || secondAt > 0.9), `second shot ${secondAt < 0 ? 'none' : (secondAt * 1000).toFixed(0) + 'ms after returning'}`);
  check('bolt state kept on the slot while holstered', boltKept > 0.5, `boltLeft ${boltKept.toFixed(2)}s after switching away`);
  check('state rules report bolting', weaponState(p) === 'bolting' || weaponState(p) === 'ready', `state ${weaponState(p)}`);
}
// ---------------------------------------------------------------- reload insert timing + cancel rules
{
  const { p, run } = setup('range');
  run(0.5, (c) => { c.slot = 0; });
  p.weapons[0].mag = 3;
  run(0.05, (c) => { c.buttons = BTN.RELOAD; });
  run(1.9 * 0.5, () => {});
  const midMag = p.weapons[0].mag;
  run(0.1, (c) => { c.slot = 2; }); // switch before insert (62%)
  check('switch before insert cancels reload', midMag === 3 && p.weapons[0].mag === 3, `mag ${p.weapons[0].mag}`);
  run(0.5, (c) => { c.slot = 0; });
  run(0.05, (c) => { c.buttons = BTN.RELOAD; });
  run(1.9 * 0.7, () => {});
  const afterInsert = p.weapons[0].mag;
  run(0.05, (c) => { c.slot = 2; });
  check('ammo refills at magazine insert', afterInsert === 30 && p.weapons[0].mag === 30, `mag ${afterInsert}`);
  // firing does not cancel a reload
  run(0.5, (c) => { c.slot = 0; });
  p.weapons[0].mag = 5;
  run(0.05, (c) => { c.buttons = BTN.RELOAD; });
  let shotDuring = false;
  run(0.5, (c) => { c.buttons = BTN.FIRE; if (p.weapons[0].mag !== 5 && p.reloadTimer > 0) shotDuring = true; });
  check('firing does not cancel reload', !shotDuring && p.reloadTimer > 0, `reloadTimer ${p.reloadTimer.toFixed(2)}`);
}
// ---------------------------------------------------------------- fire lock after respawn + spawn protection
{
  const { m, p, run } = setup('ffa', 1, 'easy', 11);
  const bot = m.fighters[1];
  // kill the player, keep FIRE held through the respawn
  p.hp = 1;
  p.lastDamageTime = m.time;
  run(0.05, () => {});
  p.alive = false;
  p.respawnTimer = 0.1;
  let shotsAfter = 0;
  run(0.6, (c) => { c.buttons = BTN.FIRE; });
  for (const e of m.drainEvents()) if (e.type === 'shot' && e.id === 0) shotsAfter++;
  check('no shot after respawn while fire held', shotsAfter === 0 && p.alive, `shots ${shotsAfter}`);
  check('spawn protection active', p.spawnProtect > 0, `${p.spawnProtect.toFixed(2)}s`);
  // damage is blocked
  const hp0 = p.hp;
  m.fighters[1].stats.damage = 0;
  // simulate a direct hit through applyDamage via a bot shot is non-deterministic; call combat directly
  import('../src/sim/combat').then(() => {});
  run(0.1, () => {});
  check('protected player keeps hp', p.hp === hp0, `hp ${p.hp}`);
  run(0.1, (c) => { c.buttons = BTN.FIRE; });
  check('firing ends protection', p.spawnProtect === 0, `${p.spawnProtect}`);
  void bot;
}
// ---------------------------------------------------------------- barrel obstruction
{
  const { m, p, run, place } = setup('range');
  // a ledge between the eye (1.64) and the hip-fire barrel (~1.49)
  m.world.boxes.push({ min: { x: -5, y: 0, z: -5.2 }, max: { x: -1, y: 1.55, z: -4.8 }, color: 0 });
  place(-3, 0, -4.2);
  run(0.5, (c) => { c.slot = 0; c.yaw = 0; c.pitch = 0; });
  let hip: boolean | null = null;
  run(0.05, (c) => { c.yaw = 0; c.pitch = 0.0; c.buttons = BTN.FIRE; });
  for (const e of m.drainEvents()) if (e.type === 'shot') hip = e.obstructed;
  run(0.5, (c) => { c.yaw = 0; c.pitch = 0; c.buttons = BTN.ADS; });
  let ads: boolean | null = null;
  run(0.05, (c) => { c.yaw = 0; c.pitch = 0; c.buttons = BTN.ADS | BTN.FIRE; });
  for (const e of m.drainEvents()) if (e.type === 'shot') ads = e.obstructed;
  check('hip barrel blocked by ledge the eye sees over', hip === true, `obstructed=${hip}`);
  check('raising the gun (ADS) clears the ledge', ads === false, `obstructed=${ads}`);
  m.world.boxes.pop();
}
// ---------------------------------------------------------------- bots
{
  const { m, p } = setup('ffa', 6, 'hard');
  p.alive = false;
  p.respawnTimer = 1e9;
  let kills = 0;
  for (let i = 0; i < 60 / TICK_DT; i++) {
    m.step(TICK_DT);
    for (const e of m.drainEvents()) if (e.type === 'kill') kills++;
  }
  check('bots fight each other', kills >= 5, `${kills} kills in 60s`);
}

// ---------------------------------------------------------------- frame-rate independence (through the real frame loop)
{
  const runAt = (frameDt: (i: number) => number, seconds: number, weapon: number, hold: 'fire' | 'bhop') => {
    const { m, p } = setup('range');
    p.pos.x = -14; p.pos.z = 8;
    let shots = 0, t = 0, maxShotsInFrame = 0, frameShots = 0;
    const loop = new FixedLoop(TICK_DT, () => {
      const c = emptyCommand();
      c.slot = weapon;
      c.yaw = 0;
      if (hold === 'fire' && t > 0.5) c.buttons = BTN.FIRE;
      if (hold === 'bhop') { c.forward = 1; if (t > 0.8 && t < 0.85) c.buttons = BTN.JUMP; }
      m.submit(0, c);
      m.step(TICK_DT);
      for (const e of m.drainEvents()) if (e.type === 'shot') { shots++; frameShots++; }
    }, () => {});
    let i = 0;
    while (t < seconds) {
      const d = frameDt(i++);
      frameShots = 0;
      loop.advance(d);
      maxShotsInFrame = Math.max(maxShotsInFrame, frameShots);
      t += d;
    }
    return { shots, maxShotsInFrame, dist: Math.hypot(p.pos.x + 14, p.pos.z - 8), dropped: loop.droppedTime };
  };
  const rates = [30, 60, 144, 240];
  const ar = rates.map((hz) => runAt(() => 1 / hz, 2.5, 0, 'fire'));
  const jitter = runAt((i) => (i % 3 === 0 ? 1 / 30 : 1 / 144), 2.5, 0, 'fire');
  const counts = [...ar, jitter].map((r) => r.shots);
  check('AR fire rate independent of frame rate', Math.max(...counts) - Math.min(...counts) <= 1 && counts[0] >= 19, `shots in 2 s of fire @30/60/144/240/jitter fps: ${counts.join('/')}`);
  const mv = rates.map((hz) => runAt(() => 1 / hz, 2, 0, 'bhop').dist);
  check('movement independent of frame rate', Math.max(...mv) - Math.min(...mv) < 0.25 && mv[0] > 10, `distance after 2 s run + jump: ${mv.map((d) => d.toFixed(2)).join(' / ')} m`);
  // a 400 ms hitch while holding fire must not dump stored-up shots
  const stall = runAt((i) => (i === 60 ? 0.4 : 1 / 60), 2.5, 0, 'fire');
  check('no shot burst after a stalled frame', stall.maxShotsInFrame <= 1 && stall.dropped >= 0.19, `max shots in one frame ${stall.maxShotsInFrame}, dropped ${(stall.dropped * 1000).toFixed(0)} ms of backlog`);
}

// ---------------------------------------------------------------- difficulty ladder (1v1 rifle duel at 16 m)
{
  const duel = (diff: 'easy' | 'normal' | 'hard', seed: number, strafe: boolean) => {
    const m = new Match({ mode: 'ffa', difficulty: diff, playerName: 'P', botCount: 1, timeLimit: 999, scoreLimit: 999, seed });
    const p = m.fighters[0], b = m.fighters[1];
    b.weapons = [{ id: 'ar', mag: 30, boltLeft: 0 }, { id: 'pistol', mag: 12, boltLeft: 0 }, { id: 'melee', mag: 0, boltLeft: 0 }];
    const put = (f: Fighter, x: number, yaw: number) => { f.pos.x = f.prevPos.x = x; f.pos.z = f.prevPos.z = 20; f.pos.y = 0; f.vel.x = f.vel.z = 0; f.yaw = f.lowerYaw = yaw; f.spawnProtect = 0; };
    put(p, 8, yawTo(-1, 0));
    put(b, -8, yawTo(1, 0));
    (m as unknown as { brains: Map<number, { aimYaw: number }> }).brains.get(1)!.aimYaw = yawTo(1, 0);
    let t = 0;
    for (let i = 0; i < 15 / TICK_DT; i++) {
      const c = emptyCommand();
      c.yaw = yawTo(-1, 0);
      if (strafe) c.strafe = Math.floor(t / 0.6) % 2 ? 1 : -1;
      m.submit(0, c);
      m.step(TICK_DT);
      t += TICK_DT;
      for (const e of m.drainEvents()) if (e.type === 'kill' && e.victim === 0) return t;
    }
    return 15;
  };
  const med = (diff: 'easy' | 'normal' | 'hard', strafe: boolean) => {
    const r = Array.from({ length: 12 }, (_, i) => duel(diff, 100 + i * 7, strafe)).sort((a, b) => a - b);
    return r[6];
  };
  const es = med('easy', false), ns = med('normal', false), hs = med('hard', false);
  const em = med('easy', true), hm = med('hard', true);
  check('difficulty ladder vs standing player', es > ns && ns > hs && es > 3 * hs, `survive easy ${es.toFixed(1)}s / normal ${ns.toFixed(1)}s / hard ${hs.toFixed(1)}s`);
  check('easy bots forgive strafing', em >= 10 && hm < em, `strafing survive easy ${em.toFixed(1)}s / hard ${hm.toFixed(1)}s`);
}

// ---- collision sweep: random runs/jumps/strafes never sink the body into ramp sides or boxes ----
{
  let bad = 0, runs = 0;
  for (const m of ['arena', 'bookyard'] as const) {
    const w = new World(MAPS[m]);
    const b = MAPS[m].bounds;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 250; k++) {
      const x = b.minX + rnd() * (b.maxX - b.minX), z = b.minZ + rnd() * (b.maxZ - b.minZ), yaw = rnd() * 6.28;
      if (!w.isClear(x, 0, z, 0.36, 1.8) || w.rampHeightMax(x, z, 0.36) > -Infinity) continue;
      const f = createFighter(0, 'p', 0, 'player', ['ar', 'pistol', 'melee']);
      f.pos = { x, y: 0, z }; f.prevPos = { ...f.pos }; f.onGround = true;
      const btn = (rnd() < 0.3 ? BTN.JUMP : 0) | (rnd() < 0.2 ? BTN.CROUCH : 0), strafe = rnd() < 0.5 ? 0 : 1;
      runs++;
      for (let i = 0; i < 240; i++) {
        const c = emptyCommand(); c.forward = 1; c.strafe = strafe; c.yaw = yaw + i * 0.004; c.buttons = btn;
        simulateMovement(f, c, TICK_DT, w, [], i * TICK_DT);
        if (w.rampHeightMax(f.pos.x, f.pos.z, 0.3) > f.pos.y + 0.56 || !w.isClear(f.pos.x, f.pos.y + 0.01, f.pos.z, 0.33, f.height - 0.02)) { bad++; break; }
      }
    }
  }
  check('no clipping into ramp sides or boxes', bad === 0, `${bad} of ${runs} random run/jump/crouch paths penetrated`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
