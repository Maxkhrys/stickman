// Headless simulation checks: movement numbers, collision edge cases, hit registration, bots.
// Run: npm test
import { Match, TICK_DT } from '../src/sim/match';
import { BTN, emptyCommand, type InputCommand } from '../src/sim/types';
import { yawTo } from '../src/sim/vec';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failed++;
}

function setup(mode: 'range' | 'ffa', bots = 0) {
  const m = new Match({ mode, difficulty: 'hard', playerName: 'P', botCount: bots, timeLimit: 999, scoreLimit: 999, seed: 5 });
  const p = m.fighters[0];
  const place = (x: number, y: number, z: number) => {
    p.pos.x = x; p.pos.y = y; p.pos.z = z; p.vel.x = p.vel.y = p.vel.z = 0; p.onGround = true;
  };
  const run = (secs: number, f: (c: InputCommand, i: number) => void) => {
    let maxY = -99;
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const c = emptyCommand();
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

// --- movement feel ---
{
  const { place, run, hs } = setup('range');
  place(-14, 0, 8);
  run(0.1, (c) => { c.forward = 1; c.yaw = 0; });
  check('ground accel snappy', hs() > 7, `${hs().toFixed(2)} m/s after 0.1s`);
  run(0.2, () => {});
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
  run(2.5, (c, i) => {
    if (i % 24 === 12 || i === 0) dir = -dir;
    yaw -= dir * 2.4 * TICK_DT;
    c.yaw = yaw; c.strafe = dir; c.buttons = BTN.JUMP;
  });
  check('bhop + air strafe gains speed', hs() > 10.5, `${hs().toFixed(2)} m/s after 2.5s`);
}
// --- collision ---
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
  const cj = run(0.9, (c, i) => { c.yaw = yawTo(1, 0); c.forward = 1; if (i === 21) c.buttons = BTN.JUMP; if (i > 23 && !p.onGround) c.buttons |= BTN.CROUCH; });
  check('crouch-jump onto 2m crate', cj >= 1.99, `max y ${cj.toFixed(2)}`);
  place(-27, 0, -12);
  p.vel.z = 19;
  run(0.5, () => {});
  check('no tunnelling at 19 m/s', p.pos.z < -8.84, `z=${p.pos.z.toFixed(2)}`);
}
// --- hit registration ---
{
  const { m, p, run } = setup('range');
  const d = m.fighters.find((f) => f.name === 'Dummy 1')!;
  const aim = (c: InputCommand, yoff: number) => {
    const ey = p.pos.y + p.height - 0.16;
    const dx = d.pos.x - p.pos.x, dz = d.pos.z - p.pos.z;
    c.yaw = yawTo(dx, dz);
    c.pitch = Math.atan2(d.pos.y + d.height - yoff - ey, Math.hypot(dx, dz));
  };
  run(0.5, (c) => { c.slot = 1; aim(c, 0.21); });
  run(0.3, (c, i) => { aim(c, 0.21); if (i === 0) c.buttons = BTN.FIRE; });
  check('pistol headshot = 90', d.hp === 10, `dummy hp ${d.hp}`);
  run(0.3, (c, i) => { aim(c, 0.21); if (i === 0) c.buttons = BTN.FIRE; });
  check('second headshot kills', !d.alive, `alive=${d.alive}`);
}
// --- bots ---
{
  const { m, p } = setup('ffa', 6);
  p.alive = false;
  p.respawnTimer = 1e9;
  let kills = 0;
  for (let i = 0; i < 60 * 60; i++) {
    m.step(TICK_DT);
    for (const e of m.drainEvents()) if (e.type === 'kill') kills++;
  }
  check('bots fight each other', kills >= 5, `${kills} kills in 60s`);
  const moved = m.fighters.filter((f) => f.kind === 'bot' && f.stats.deaths + f.stats.kills > 0).length;
  check('most bots engaged', moved >= 4, `${moved}/6 bots scored or died`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
