import assert from 'node:assert/strict';
import { cameraAimDirection } from '../src/sim/cameraAim';
import { traceFireLine, fireHitscan } from '../src/sim/combat';
import { createFighter, eyePos, muzzlePos } from '../src/sim/fighter';
import { World } from '../src/sim/world';
import { MAPS, type Box } from '../src/sim/map';
import { simulateMovement } from '../src/sim/movement';
import { emptyCommand, type GameEvent, type WeaponId } from '../src/sim/types';
import { WEAPONS } from '../src/config/weapons';
import { v3, vdist, vnorm, vsub, vaddScaled, forwardFromAngles } from '../src/sim/vec';
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('PASS', name); };
const world = (boxes: Box[] = []) => new World({ ...MAPS.arena, boxes, ramps: [], props: [] });
function fighter(id = 0, w: WeaponId = 'ar') { const f = createFighter(id, 'Test', 0, 'player', [w]); f.alive = true; return f; }

test('Off-ray enemies cannot attract the aim; no persistent target state', () => {
  const f = fighter(), target = fighter(1), w = world();
  const origin = v3(0.92, eyePos(f).y + 0.2, 2.75), dir = v3(0, 0, -1);
  const base = cameraAimDirection({ world: w, fighters: [f] }, f, origin, dir);
  const before = JSON.stringify(f);
  for (const x of [-2, -0.5, 2, 8]) {
    target.pos = v3(x, 0, -10);
    assert.deepEqual(cameraAimDirection({ world: w, fighters: [f, target] }, f, origin, dir), base);
  }
  target.pos = v3(origin.x, 0.3, -10);
  assert.notDeepEqual(cameraAimDirection({ world: w, fighters: [f, target] }, f, origin, dir), base);
  target.pos.x = 8;
  assert.deepEqual(cameraAimDirection({ world: w, fighters: [f, target] }, f, origin, dir), base);
  assert.equal(JSON.stringify(f), before);
});

test('Both shoulders converge exactly on the centre ray at close and long distances', () => {
  for (const side of [-1, 1]) for (const range of [2, 5, 20, 60]) {
    const f = fighter(), y = eyePos(f).y;
    const wall = { min: v3(-100, 0, -range - 0.01), max: v3(100, 100, -range), color: 0 };
    const ctx = { world: world([wall]), fighters: [f] };
    const origin = v3(side * 0.92, y + 0.2, 2.75);
    const d = cameraAimDirection(ctx, f, origin, v3(0, 0, -1));
    const t = (-range - f.pos.z) / d.z;
    assert.ok(vdist(vaddScaled(eyePos(f), d, t), v3(origin.x, origin.y, -range)) < 1e-8);
  }
});

test('A surface behind the eye never turns the barrel backwards', () => {
  const f = fighter();
  const w = world([{ min: v3(0.5, 0, 1), max: v3(1.5, 4, 1.01), color: 0 }]);
  assert.deepEqual(cameraAimDirection({ world: w, fighters: [f] }, f, v3(0.92, 1.7, 2.75), v3(0, 0, -1)), v3(0, 0, -1));
});

test('Camera-visible targets cannot be shot through eye-level cover', () => {
  const f = fighter(), target = fighter(1); target.pos = v3(0.92, 0.3, -10);
  const w = world([{ min: v3(-0.3, 0, -1), max: v3(0.3, 3, -0.8), color: 0 }]);
  const ctx = { world: w, fighters: [f, target] };
  const d = cameraAimDirection(ctx, f, v3(0.92, 1.8, 2.75), v3(0, 0, -1));
  const tr = traceFireLine(ctx, f, d);
  assert.equal(tr.tr.fighter, null); assert.ok(tr.tr.normal); assert.ok(tr.tr.point.z > -1.01);
});

test('Full muzzle path catches thin cover beyond the old 1.8m check', () => {
  const f = fighter();
  const eye = eyePos(f), muzzle = muzzlePos(f), target = vaddScaled(eye, v3(0, 0, -1), WEAPONS.ar.range);
  const d = vnorm(vsub(target, muzzle));
  const p = vaddScaled(muzzle, d, (-4 - muzzle.z) / d.z);
  const w = world([{ min: v3(p.x - 0.015, p.y - 0.015, -4.01), max: v3(p.x + 0.015, p.y + 0.015, -3.99), color: 0 }]);
  assert.equal(w.raycast(eye, v3(0, 0, -1), 5), null);
  const tr = traceFireLine({ world: w, fighters: [f] }, f, v3(0, 0, -1));
  assert.equal(tr.obstructed, true); assert.ok(tr.tr.point.z >= -4.01 && tr.tr.point.z <= -3.99);
});

test('Gun inside a wall uses a safe near-face origin and no backward tracer', () => {
  const f = fighter();
  const w = world([{ min: v3(-1, 0, -0.6), max: v3(1, 3, -0.2), color: 0 }]);
  const tr = traceFireLine({ world: w, fighters: [f] }, f, v3(0, 0, -1));
  assert.equal(tr.obstructed, true); assert.ok(tr.muzzle.z > tr.tr.point.z);
  assert.ok(tr.muzzle.z > -0.2);
});

test('Camera-relative movement does not bend toward the convergence target', () => {
  const a = fighter(), b = fighter(), w = world();
  const cmd = { ...emptyCommand(), forward: 1, strafe: 0.2, yaw: 0.8 };
  for (let i = 0; i < 60; i++) {
    simulateMovement(a, cmd, 1 / 120, w, [], i / 120);
    simulateMovement(b, { ...cmd, yaw: 1.1, moveYaw: 0.8 }, 1 / 120, w, [], i / 120);
  }
  assert.ok(vdist(a.pos, b.pos) < 1e-9); assert.notEqual(a.yaw, b.yaw);
});

test('Every firearm reports one immutable straight muzzle-to-impact shot', () => {
  for (const weapon of ['ar', 'smg', 'carbine', 'pistol', 'sniper'] as const) {
    const f = fighter(0, weapon); f.ads = 1;
    const events: GameEvent[] = [];
    const ctx = { world: world(), fighters: [f], events, time: 1, rng: () => 0.5, onDamaged() {}, onKilled() {} };
    fireHitscan(ctx, f, WEAPONS[weapon]);
    const shots = events.filter(e => e.type === 'shot');
    assert.equal(shots.length, 1);
    const e = shots[0];
    assert.ok(vdist(e.dir, vnorm(vsub(e.to, e.from))) < 1e-10);
    const end = { ...e.to }; f.yaw = 2; f.pos.x = 5;
    assert.deepEqual(e.to, end);
  }
});
console.log(`${passed} aiming checks passed`);
