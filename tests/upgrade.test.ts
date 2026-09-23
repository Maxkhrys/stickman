import assert from 'node:assert/strict';
import { Profile, PROFILE_KEY } from '../src/core/Profile';
import { Match, TICK_DT } from '../src/sim/match';
import { clipCamera } from '../src/render/thirdPerson';
import { World } from '../src/sim/world';
import { MAPS } from '../src/sim/map';
import { BTN, emptyCommand } from '../src/sim/types';
import { WEAPONS } from '../src/config/weapons';
import { traceFireLine } from '../src/sim/combat';
import { eyePos } from '../src/sim/fighter';
import { forwardFromAngles } from '../src/sim/vec';

let passed = 0;
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const data = new Map<string, string>();
const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
const opts = { mode: 'sketch' as const, mapId: 'bookyard' as const, difficulty: 'easy' as const, playerName: 'Tester', botCount: 1, timeLimit: 999, scoreLimit: 60, seed: 8 };
function idle(m: Match, seconds: number) { for (let i = 0; i < Math.round(seconds / TICK_DT); i++) { m.submit(0, emptyCommand()); m.step(TICK_DT); } }
function quiet(m: Match) { for (const f of m.fighters.slice(1)) { f.alive = false; f.respawnTimer = 1e6; } }

test('Purchases persist; cannot double-spend or buy unaffordable weapons', () => {
  const p = new Profile(storage);
  assert.equal(p.data.ink, 600);
  assert.equal(p.buyWeapon('smg'), true);
  assert.equal(p.data.ink, 250);
  assert.equal(p.buyWeapon('smg'), false);
  assert.equal(p.buyWeapon('carbine'), false);
  const reload = new Profile(storage);
  assert.equal(reload.owns('smg'), true);
  assert.equal(reload.data.ink, 250);
  assert.equal(reload.selectInk('cyan'), true);
  assert.equal(new Profile(storage).color, 0x22c6e0);
});
test('Rewards are idempotent; daily contracts only pay once', () => {
  const p = new Profile(storage);
  const r = { id: 'match-1', kills: 10, headshots: 5, objective: 30, won: true, weaponKills: { smg: 10 } };
  const receipt = p.settle(r)!;
  assert.equal(receipt.contracts.length, 3);
  const balance = p.data.ink;
  assert.equal(p.settle(r), null);
  assert.equal(p.data.ink, balance);
  assert.equal(new Profile(storage).settle(r), null);
  assert.equal(p.settle({ ...r, id: 'match-2' })!.contracts.length, 0);
  assert.equal(p.data.mastery.smg, 20);
});
test('Corrupt saves cannot inject unknown unlocks or negative balances', () => {
  storage.setItem(PROFILE_KEY, JSON.stringify({ version: 1, ink: -999, xp: 'oops', owned: ['invalid'], equippedInk: 'invalid' }));
  const p = new Profile(storage);
  assert.equal(p.data.ink, 0); assert.equal(p.level, 1); assert.equal(p.color, 0xffd23f);
  assert.deepEqual(p.data.owned, ['ar', 'sniper']);
  storage.setItem(PROFILE_KEY, '{broken');
  assert.equal(new Profile(storage).data.ink, 600);
});
test('Camera sweep stops before thin walls, floor, and ramp solids', () => {
  const w = new World({ ...MAPS.bookyard, boxes: [{ min: { x: -3, y: 0, z: 1 }, max: { x: 3, y: 4, z: 1.01 }, color: 0 }], ramps: [] });
  const p = clipCamera(w, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: 4 });
  assert.ok(p.z < 0.87 && p.z > 0.6);
  assert.ok(clipCamera(w, { x: 0, y: 1.6, z: 0 }, { x: 0, y: -2, z: 0 }).y >= 0.15);
  const ramp = new World({ ...MAPS.bookyard, boxes: [], ramps: [{ x0: -2, x1: 2, z0: -2, z1: 2, axis: 'z', h0: 0, h1: 2, color: 0 }] });
  const r = clipCamera(ramp, { x: 0, y: 2.5, z: 0 }, { x: 0, y: 0.5, z: 1.5 });
  assert.ok(r.y > 1.4);
});
test('Capture scores only sole occupant; contest and death stop scoring', () => {
  const m = new Match(opts); quiet(m);
  const p = m.fighters[0]; p.pos = { x: 0, y: 0, z: 0 }; idle(m, 2.1);
  assert.equal(p.stats.objective, 2);
  const b = m.fighters[1]; b.alive = true; b.kind = 'player'; b.pos = { x: 1, y: 0, z: 0 };
  idle(m, 1.1); assert.equal(p.stats.objective, 2); assert.equal(m.info.objective!.contested, true);
  b.alive = false; b.respawnTimer = 1e6; p.alive = false; p.respawnTimer = 1e6;
  idle(m, 1.1); assert.equal(p.stats.objective, 2);
});
test('Capture rotates and determines winner from objective points', () => {
  const m = new Match(opts); quiet(m); m.fighters[0].pos = { x: 30, y: 0, z: 20 };
  idle(m, 40.1); assert.equal(m.info.objective!.index, 1);
  const win = new Match({ ...opts, scoreLimit: 2 }); quiet(win);
  win.fighters[0].pos = { x: 0, y: 0, z: 0 }; idle(win, 2.2);
  assert.equal(win.info.ended, true); assert.equal(win.info.winnerId, 0);
});
test('SMG hits configured fire rate; carbine requires new trigger presses', () => {
  for (const primary of ['smg', 'carbine'] as const) {
    const m = new Match({ ...opts, mode: 'ffa', primary }); quiet(m);
    idle(m, 0.5);
    for (let i = 0; i < 120; i++) { const c = emptyCommand(); c.buttons = BTN.FIRE; m.submit(0, c); m.step(TICK_DT); }
    assert.equal(m.fighters[0].stats.shots, primary === 'smg' ? 15 : 1);
  }
});
test('Reload and fire on same tick cannot shoot after reload begins', () => {
  const m = new Match({ ...opts, mode: 'ffa' }); quiet(m); idle(m, 0.5);
  const p = m.fighters[0]; p.weapons[0].mag = 10;
  const c = emptyCommand(); c.buttons = BTN.FIRE | BTN.RELOAD;
  m.submit(0, c); m.step(TICK_DT);
  assert.equal(p.stats.shots, 0); assert.ok(p.reloadTimer > 0);
});
test('Copied render pose never intersects own hitboxes', () => {
  const m = new Match({ ...opts, mode: 'ffa' }); quiet(m);
  const p = m.fighters[0]; p.pos = { x: 0, y: 0, z: 0 };
  const r = traceFireLine(m, { ...p }, forwardFromAngles(0, 0));
  assert.notEqual(r.tr.fighter?.id, p.id);
  assert.ok(r.tr.t > 5);
  assert.ok(eyePos(p).y > 1);
  assert.equal(WEAPONS.smg.magSize, 36);
});
test('Objective bots navigate and score on both arenas', () => {
  for (const mapId of ['arena', 'bookyard'] as const) {
    const m = new Match({ ...opts, mapId, botCount: 6, scoreLimit: 999, difficulty: 'normal' });
    m.fighters[0].alive = false; m.fighters[0].respawnTimer = 1e6;
    idle(m, 90);
    const points = m.fighters.reduce((n, f) => n + f.stats.objective, 0);
    assert.ok(points > 3, `${mapId}: bots scored ${points}`);
    console.log(`${mapId}: ${points} objective points`);
  }
});
console.log(`${passed} upgrade checks passed`);
