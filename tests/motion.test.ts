// Locomotion / turning regression checks for the sim gait and the presentation animator.
// Runs headless: three.js math only, no DOM. `npm run test:motion`
import assert from 'node:assert/strict';
import { Match, TICK_DT } from '../src/sim/match';
import { emptyCommand, type InputCommand } from '../src/sim/types';
import { cadence, gaitDuty, strideLength } from '../src/sim/body';
import { BACKPEDAL_IN, BACKPEDAL_OUT } from '../src/sim/movement';
import { StickAnim } from '../src/render/anim/StickAnimator';
import type { Skeleton } from '../src/sim/body';

let passed = 0;
function test(name: string, run: () => string | void) {
  const detail = run();
  passed++;
  console.log(`PASS ${name}${detail ? `  (${detail})` : ''}`);
}

function setup() {
  const m = new Match({ mode: 'range', difficulty: 'easy', playerName: 'P', botCount: 0, timeLimit: 999, scoreLimit: 999, seed: 3 });
  const p = m.fighters[0];
  const anim = new StickAnim();
  const place = (x: number, z: number, yaw: number) => {
    p.pos.x = p.prevPos.x = x; p.pos.z = p.prevPos.z = z; p.pos.y = p.prevPos.y = 0;
    p.vel.x = p.vel.y = p.vel.z = 0; p.onGround = true;
    p.yaw = p.prevYaw = p.lowerYaw = p.prevLowerYaw = yaw;
    anim.reset();
  };
  const stats = { maxPlantErr: 0, maxPlantDrift: 0, nan: 0, contacts: 0, frames: 0, maxTwist: 0 };
  let prev: [number, number, number][] | null = null, prevModes: number[] | null = null;
  /** step the sim and the animator together; `frame` = presentation step (s) */
  const run = (secs: number, cmd: (c: InputCommand, t: number) => void, frame = TICK_DT) => {
    let acc = 0;
    for (let i = 0; i < Math.round(secs / TICK_DT); i++) {
      const c = emptyCommand();
      c.yaw = p.yaw;
      c.pitch = 0;
      cmd(c, i * TICK_DT);
      m.submit(0, c);
      m.step(TICK_DT);
      acc += TICK_DT;
      if (acc + 1e-9 < frame) continue;
      anim.update(p, p, acc, m.time, m.world);
      acc = 0;
      const P = anim.pose;
      stats.frames++;
      if (!finite(P)) stats.nan++;
      const modes = anim.feet.map((f) => f.mode as number);
      const ank: [number, number, number][] = [P.lAnkle, P.rAnkle].map((q) => [q.x, q.y, q.z]);
      if (prev && prevModes) for (let k = 0; k < 2; k++) {
        if (modes[k] === 0 && prevModes[k] === 0) stats.maxPlantDrift = Math.max(stats.maxPlantDrift, Math.hypot(ank[k][0] - prev[k][0], ank[k][1] - prev[k][1], ank[k][2] - prev[k][2]));
        if (modes[k] === 0 && prevModes[k] === 1) stats.contacts++;
      }
      stats.maxPlantErr = Math.max(stats.maxPlantErr, anim.plantError);
      stats.maxTwist = Math.max(stats.maxTwist, anim.diag.twist);
      prev = ank;
      prevModes = modes;
    }
  };
  const reset = () => { Object.assign(stats, { maxPlantErr: 0, maxPlantDrift: 0, nan: 0, contacts: 0, frames: 0, maxTwist: 0 }); prev = prevModes = null; };
  return { m, p, anim, place, run, stats, reset };
}

function finite(sk: Skeleton) {
  for (const k in sk) {
    const q = (sk as unknown as Record<string, unknown>)[k];
    if (q && typeof q === 'object') {
      const v = q as { x: number; y: number; z: number };
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return false;
    }
  }
  return true;
}

test('gait model: cadence 4-5 contacts/s at full run, stance span stays reachable', () => {
  const c = cadence(8.2);
  assert.ok(c >= 4 && c <= 5, `cadence ${c}`);
  assert.ok(Math.abs((2 * 8.2) / c - strideLength(8.2)) < 1e-9);
  for (const v of [0.5, 1.5, 3.8, 8.2, 12, 16]) assert.ok(gaitDuty(v) > 0.15 && gaitDuty(v) <= 0.62);
  return `8.2 m/s -> ${c.toFixed(2)} contacts/s, stride ${strideLength(8.2).toFixed(2)} m`;
});

test('blocked movement does not advance the run cycle', () => {
  const { p, place, run } = setup();
  place(16.5, 6, -Math.PI / 2); // facing the +X side wall, 1.6 m away
  run(1.2, (c) => (c.forward = 1));
  const g0 = p.gait;
  run(1.0, (c) => (c.forward = 1));
  const moved = Math.abs(p.gait - g0);
  assert.ok(p.travelSpeed < 0.05, `travel ${p.travelSpeed}`);
  assert.ok(moved < 1e-6, `gait advanced ${moved}`);
  return `travel ${p.travelSpeed.toFixed(3)} m/s, gait change ${moved.toExponential(1)}`;
});

test('teleport / respawn corrections are not counted as travel', () => {
  const { m, p, place, run } = setup();
  place(0, 5, 0);
  run(0.3, (c) => (c.forward = 1));
  const g0 = p.gait;
  p.pos.x += 6; // correction between ticks
  m.submit(0, { ...emptyCommand(), yaw: p.yaw, forward: 1 });
  m.step(TICK_DT);
  assert.ok(p.travelSpeed < 30 && Math.abs(p.gait - g0) < 1, `gait jump ${p.gait - g0}`);
});

test('backpedal classification has hysteresis at the 110 degree boundary', () => {
  const { p, place, run } = setup();
  place(-15, 6, 0);
  let flips = 0, last = p.backpedal;
  // travel direction wobbles about +-8 degrees around 110 degrees off the aim (crosses 115, never 100)
  run(2.2, (c, t) => {
    const rel = 110 * (Math.PI / 180) + Math.sin(t * 11) * 0.2;
    c.yaw = 0;
    c.forward = Math.round(Math.cos(rel) * 100) / 100;
    c.strafe = Math.round(Math.sin(rel) * 100) / 100;
    if (t > 0.4 && p.backpedal !== last) flips++;
    last = p.backpedal;
  });
  assert.ok(BACKPEDAL_IN > BACKPEDAL_OUT);
  assert.ok(flips <= 1, `flips ${flips}`);
  return `${flips} classification change(s) over 1.8 s of wobble around 110 degrees (backpedal=${p.backpedal})`;
});

for (const fps of [30, 60, 120]) {
  test(`planted feet stay locked and reachable after IK (${fps} Hz presentation)`, () => {
    const { place, run, stats, reset } = setup();
    place(-3, 8, 0);
    run(0.3, () => {}, 1 / fps);
    reset();
    // forward, strafe, rapid reversals, backpedal, stop
    run(1.2, (c) => (c.forward = 1), 1 / fps);
    run(0.8, (c) => (c.strafe = 1), 1 / fps);
    run(1.3, (c, t) => (c.strafe = Math.floor(t / 0.3) % 2 ? 1 : -1), 1 / fps);
    run(0.8, (c) => (c.forward = -1), 1 / fps);
    run(0.8, () => {}, 1 / fps);
    assert.equal(stats.nan, 0);
    assert.ok(stats.maxPlantDrift < 0.001, `planted ankle drift ${stats.maxPlantDrift}`);
    assert.ok(stats.maxPlantErr < 0.06, `post-IK plant error ${stats.maxPlantErr}`);
    return `drift ${stats.maxPlantDrift.toFixed(4)} m, post-IK err ${stats.maxPlantErr.toFixed(3)} m, ${stats.contacts} contacts`;
  });
}

test('full-speed run lands 4-5.5 foot contacts per second', () => {
  const { place, run, stats, reset } = setup();
  place(-3, 12, 0);
  run(0.6, (c) => (c.forward = 1));
  reset();
  run(2.0, (c) => (c.forward = 1));
  const perSec = stats.contacts / 2;
  assert.ok(perSec >= 4 && perSec <= 5.5, `contacts/s ${perSec}`);
  return `${perSec.toFixed(2)} contacts/s`;
});

test('aim yaw wrapping across +-pi keeps the torso twist small', () => {
  const { p, place, run, stats, reset } = setup();
  place(-3, 0, Math.PI - 0.02);
  run(0.5, () => {});
  reset();
  run(2, (c, t) => { c.yaw = Math.PI + Math.sin(t * 7) * 0.25; if (c.yaw > Math.PI) c.yaw -= Math.PI * 2; });
  assert.ok(stats.maxTwist < 1.0, `twist ${stats.maxTwist}`);
  assert.equal(stats.nan, 0);
  void p;
  return `max pelvis/aim twist ${stats.maxTwist.toFixed(2)} rad`;
});

test('sharp reversals and 180 degree flicks keep the torso twist bounded', () => {
  const { place, run, stats, reset } = setup();
  place(-3, 8, 0);
  reset();
  run(3, (c, t) => { c.forward = 1; c.yaw = Math.floor(t / 0.7) % 2 ? Math.PI : 0; });
  assert.ok(stats.maxTwist <= 1.76, `twist ${stats.maxTwist}`);
  assert.equal(stats.nan, 0);
  return `max twist ${stats.maxTwist.toFixed(2)} rad`;
});

test('reset / respawn snaps without NaN and with feet under the body', () => {
  const { p, anim, place, run } = setup();
  place(-3, 8, 0);
  run(0.5, (c) => (c.forward = 1));
  place(5, -20, 1.2);
  run(0.1, () => {});
  const P = anim.pose;
  assert.ok(finite(P));
  for (const a of [P.lAnkle, P.rAnkle]) assert.ok(Math.hypot(a.x - p.pos.x, a.z - p.pos.z) < 0.6, 'foot left behind after respawn');
});

test('no NaN under random input fuzz (jump, slide, flicks, extreme pitch)', () => {
  const { p, anim, place, run } = setup();
  place(0, 0, 0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let bad = 0;
  run(8, (c) => {
    c.forward = Math.round(rnd() * 2 - 1);
    c.strafe = Math.round(rnd() * 2 - 1);
    c.yaw = p.yaw + (rnd() - 0.5) * 0.8;
    c.pitch = (rnd() - 0.5) * 3.1;
    if (rnd() < 0.05) c.buttons |= 1 << 0;
    if (rnd() < 0.05) c.buttons |= 1 << 1;
    if (!finite(anim.pose)) bad++;
  }, 1 / 60);
  assert.equal(bad, 0);
});

console.log(`\n${passed} motion checks passed`);
