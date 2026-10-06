// Movement, Foundry route and shot-pipeline regression checks for the sniper/movement upgrade.
// Run: npm run test:movement
import { MOVE } from '../src/config/movement';
import { WEAPONS } from '../src/config/weapons';
import { FixedLoop } from '../src/core/Loop';
import { computeSpread } from '../src/sim/combat';
import { createFighter, eyePos, type Fighter } from '../src/sim/fighter';
import { MAPS, type Box, type MapDef } from '../src/sim/map';
import { FOUNDRY_GEOM } from '../src/sim/maps/foundry';
import { Match, TICK_DT } from '../src/sim/match';
import { simulateMovement } from '../src/sim/movement';
import { NavGraph } from '../src/sim/nav';
import { BTN, emptyCommand, type GameEvent, type InputCommand } from '../src/sim/types';
import { v3, yawTo } from '../src/sim/vec';
import { World } from '../src/sim/world';

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
  if (!ok) failed++;
}

function worldOf(boxes: Box[] = []): World {
  const map: MapDef = {
    name: 't', bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, floorColor: 0, skyColor: 0, fogColor: 0,
    boxes, ramps: [], spawns: [], dummies: [], props: [],
  };
  return new World(map);
}
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({ min: v3(x0, y0, z0), max: v3(x1, y1, z1), color: 0 });

/** A fighter driven tick by tick through the real movement code (prevButtons kept like Match does). */
function rig(world: World, x = 0, y = 0, z = 0, yaw = 0, loadout: Parameters<typeof createFighter>[4] = ['sniper', 'pistol', 'melee']) {
  const f = createFighter(0, 'p', 0, 'player', loadout);
  f.alive = true;
  f.pos = v3(x, y, z);
  f.prevPos = v3(x, y, z);
  f.yaw = yaw;
  f.onGround = true;
  const events: GameEvent[] = [];
  let time = 0;
  const step = (fill: (c: InputCommand) => void = () => {}) => {
    const c = emptyCommand();
    c.yaw = f.yaw;
    fill(c);
    simulateMovement(f, c, TICK_DT, world, events, time);
    f.prevButtons = c.buttons;
    time += TICK_DT;
  };
  const run = (secs: number, fill: (c: InputCommand, i: number) => void = () => {}) => {
    let maxY = f.pos.y;
    const n = Math.round(secs / TICK_DT);
    for (let i = 0; i < n; i++) {
      step((c) => fill(c, i));
      maxY = Math.max(maxY, f.pos.y);
    }
    return maxY;
  };
  const hs = () => Math.hypot(f.vel.x, f.vel.z);
  return { f, events, step, run, hs, now: () => time };
}

// ============================================================================ jumps
{
  const { f, run } = rig(worldOf());
  const top = run(1.5, (c) => { c.buttons = BTN.JUMP; }); // hold jump the whole time
  const single = MOVE.jumpVel ** 2 / (2 * MOVE.gravity);
  check('holding jump spends only the ground jump', top < single + 0.05 && f.airJumpsLeft === MOVE.airJumps, `apex ${top.toFixed(2)} m (single ${single.toFixed(2)}), air jumps left ${f.airJumpsLeft}`);
}
{
  const { f, run, events } = rig(worldOf());
  let presses = 0;
  // press, release, press, release, press: only one air jump may fire
  run(1.2, (c, i) => { if (i === 0 || i === 30 || i === 50) { c.buttons = BTN.JUMP; presses++; } });
  const air = events.filter((e) => e.type === 'airJump').length;
  check('one air jump per airtime on a fresh press', air === 1, `${air} air jumps from ${presses - 1} air presses`);
  run(1.5);
  check('landing refills the air jump and air dash', f.onGround && f.airJumpsLeft === MOVE.airJumps && f.airDashesLeft === MOVE.airDashes, `onGround ${f.onGround}, air jumps ${f.airJumpsLeft}, air dashes ${f.airDashesLeft}`);
}
{
  // coyote time: walk off a 3 m ledge, press jump shortly after leaving it -> a ground jump (air jump kept)
  const w = worldOf([box(-5, 0, -5, 5, 3, 0)]);
  const { f, run } = rig(w, 0, 3, -1, Math.PI); // facing +z, edge at z=0
  let left = -1;
  run(1.0, (c, i) => {
    c.forward = 1;
    if (left < 0 && !f.onGround) left = i;
    if (left >= 0 && i === left + Math.round(0.06 / TICK_DT)) c.buttons = BTN.JUMP;
  });
  check('coyote time allows a late ground jump', left >= 0 && f.airJumpsLeft === MOVE.airJumps && f.lastJumpTime > 0, `air jumps left ${f.airJumpsLeft}, jumped at ${f.lastJumpTime.toFixed(2)} s`);
}
{
  // jump buffer: press 0.08 s before touching down -> jumps on landing
  const { f, run, events } = rig(worldOf());
  f.pos.y = 2;
  f.onGround = false;
  const landT = Math.sqrt((2 * 2) / MOVE.gravity);
  const pressAt = Math.round((landT - 0.08) / TICK_DT);
  run(1.0, (c, i) => { if (i === pressAt) c.buttons = BTN.JUMP; });
  const jumps = events.filter((e) => e.type === 'jump').length;
  check('jump buffer fires on landing', jumps === 1, `${jumps} ground jump(s) after an early press`);
}

// ============================================================================ dashes
{
  const { f, run, events } = rig(worldOf());
  const dashes = () => events.filter((e) => e.type === 'dash').length;
  // three dash presses spaced past the gap: only two charges
  run(1.2, (c, i) => { c.forward = 1; if (i === 0 || i === 40 || i === 80) c.buttons = BTN.DASH; });
  check('two dash charges, third press refused', dashes() === 2, `${dashes()} dashes from 3 presses, charges ${f.dashCharges.toFixed(2)}`);
  run(MOVE.dashRecharge * 1.02);
  check('dash charge recharges', f.dashCharges >= 1, `charges ${f.dashCharges.toFixed(2)} after ${MOVE.dashRecharge}s`);
}
{
  const { f, run, events } = rig(worldOf());
  let peak = 0;
  run(1.4, (c, i) => {
    c.forward = 1;
    if (i === 0) c.buttons = BTN.JUMP;
    if (i === 20 || i === 60) c.buttons = BTN.DASH;
    if (f.dashTimer <= 0) peak = Math.max(peak, Math.hypot(f.vel.x, f.vel.z));
  });
  const air = events.filter((e) => e.type === 'dash' && e.air).length;
  check('one air dash per airtime', air === 1, `${air} air dashes from 2 presses`);
  check('dash exit hands back a capped speed', peak <= MOVE.dashExitSpeed + 0.01, `peak non-dash speed ${peak.toFixed(2)} m/s (exit ${MOVE.dashExitSpeed})`);
}
{
  // directional ground dash: strafe-left dash moves left
  const { f, run } = rig(worldOf());
  run(0.25, (c, i) => { c.strafe = -1; if (i === 0) c.buttons = BTN.DASH; });
  check('dash follows the held direction', f.pos.x < -2 && Math.abs(f.pos.z) < 0.1, `moved to x ${f.pos.x.toFixed(2)}, z ${f.pos.z.toFixed(2)}`);
}
{
  // dash -> slide does not chain the burst speed
  const { f, run, hs } = rig(worldOf());
  run(0.5, (c) => { c.forward = 1; });
  run(0.04, (c, i) => { c.forward = 1; if (i === 0) c.buttons = BTN.DASH; });
  run(0.02, (c) => { c.forward = 1; c.buttons = BTN.CROUCH; });
  check('dash into slide starts from the exit speed', f.sliding && hs() <= MOVE.dashExitSpeed + MOVE.slideBoost + 0.01, `sliding ${f.sliding} at ${hs().toFixed(2)} m/s`);
}
{
  // slide-jump-slide spam cannot pump speed past the slide cap
  const { run, hs } = rig(worldOf());
  let peak = 0;
  run(6, (c, i) => {
    c.forward = 1;
    const ph = i % 60;
    if (ph < 25) c.buttons = BTN.CROUCH;
    else if (ph === 26) c.buttons = BTN.JUMP;
    else if (ph > 40) c.buttons = BTN.CROUCH;
    peak = Math.max(peak, hs());
  });
  check('slide chains stay under the cap', peak <= MOVE.slideMaxSpeed + 0.01, `peak ${peak.toFixed(2)} m/s (cap ${MOVE.slideMaxSpeed})`);
}
{
  // no tunnelling: ground dash and air dash into a 0.2 m wall
  for (const air of [false, true]) {
    const w = worldOf([box(-5, 0, -3.2, 5, 6, -3.0)]);
    const { f, run } = rig(w, 0, 0, 0, 0);
    run(0.6, (c, i) => {
      c.forward = 1;
      if (air && i === 0) c.buttons = BTN.JUMP;
      if (i === (air ? 12 : 0)) c.buttons |= BTN.DASH;
    });
    check(`no tunnelling: ${air ? 'air' : 'ground'} dash into a thin wall`, f.pos.z > -3.0, `z ${f.pos.z.toFixed(3)} (wall face -3.0)`);
  }
}
{
  // scoping in at full run bleeds speed smoothly instead of stopping
  const { run, hs, step } = rig(worldOf());
  run(0.6, (c) => { c.forward = 1; });
  const before = hs();
  let worst = 0, prev = before;
  const f2 = { ads: 0 };
  for (let i = 0; i < 30; i++) {
    step((c) => { c.forward = 1; c.buttons = BTN.ADS; });
    worst = Math.max(worst, prev - hs());
    prev = hs();
  }
  void f2;
  check('scope entry does not erase momentum', worst <= MOVE.overspeedDecel * TICK_DT * 1.6 + MOVE.accel * TICK_DT * 0.5, `largest per-tick speed drop ${worst.toFixed(3)} m/s from ${before.toFixed(2)}`);
}

// ============================================================================ frame-rate independence
{
  // same scripted input timeline through the real FixedLoop at 30 / 60 / 120 / 144 fps
  const script = (t: number): InputCommand => {
    const c = emptyCommand();
    c.yaw = 0.3 * Math.sin(t);
    c.forward = 1;
    c.strafe = t > 1.2 && t < 1.8 ? 1 : 0;
    if ((t > 0.5 && t < 0.52) || (t > 0.8 && t < 0.82) || (t > 2.4 && t < 2.42)) c.buttons |= BTN.JUMP;
    if ((t > 1.0 && t < 1.02) || (t > 2.0 && t < 2.02)) c.buttons |= BTN.DASH;
    if (t > 2.9 && t < 3.3) c.buttons |= BTN.CROUCH;
    return c;
  };
  const results: string[] = [];
  for (const fps of [30, 60, 120, 144]) {
    const w = worldOf([box(4, 0, -30, 6, 2.6, -20)]);
    const { f, step, now } = rig(w);
    let ticks = 0;
    const loop = new FixedLoop(TICK_DT, () => { if (ticks++ < 480) step((c) => Object.assign(c, script(now()))); }, () => {});
    while (ticks < 480) loop.advance(1 / fps);
    results.push(`${f.pos.x.toFixed(3)},${f.pos.y.toFixed(3)},${f.pos.z.toFixed(3)}`);
  }
  const same = results.every((r) => r === results[0]);
  check('movement identical at 30/60/120/144 fps', same, results.join(' | '));
}

// ============================================================================ Foundry layout + routes
{
  const map = MAPS.foundry;
  const w = new World(map);
  const b = map.bounds;
  const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
  const old = (MAPS.arena.bounds.maxX - MAPS.arena.bounds.minX) * (MAPS.arena.bounds.maxZ - MAPS.arena.bounds.minZ);
  check('Foundry is about 3x the arena', area / old >= 2.8, `${area} m² vs ${old} m² (${(area / old).toFixed(2)}x)`);
  const tops = new Set(map.boxes.map((x) => Math.round(x.max.y * 10) / 10));
  check('Foundry has 3+ walkable elevation bands', [0, FOUNDRY_GEOM.balconyTop, FOUNDRY_GEOM.smelterTop].every((h) => h === 0 || tops.has(h)) && tops.has(FOUNDRY_GEOM.warehouseRoof), `tops include 4.4 / 7.5 / 9`);
  let bad = '';
  for (const s of [...map.spawns, map.trainingSpawn!]) {
    const surf = w.surfaceBelow(s.pos.x, s.pos.z, MOVE.radius, s.pos.y + 0.05);
    if (!w.isClear(s.pos.x, s.pos.y + 0.01, s.pos.z, MOVE.radius, MOVE.standHeight) || Math.abs(surf - s.pos.y) > 0.01) bad += ` spawn(${s.pos.x},${s.pos.z})`;
  }
  for (const d of map.dummies) {
    const surf = w.surfaceBelow(d.pos.x, d.pos.z, MOVE.radius, d.pos.y + 0.05);
    if (!w.isClear(d.pos.x, d.pos.y + 0.01, d.pos.z, MOVE.radius, MOVE.standHeight) || Math.abs(surf - d.pos.y) > 0.01) bad += ` dummy(${d.pos.x},${d.pos.y},${d.pos.z})`;
  }
  check('Foundry spawns and targets stand clear on a surface', bad === '', bad || `${map.spawns.length} spawns, ${map.dummies.length} targets`);

  // routes driven through the real movement code on the real map
  const route = (name: string, x: number, y: number, z: number, yaw: number, plan: 'jump' | 'double' | 'doubleDash', expectY: number, expect: boolean, runUp = 0.6) => {
    const { f, run } = rig(w, x, y, z, yaw);
    let st = 0, airAt = 0;
    let landed = false;
    run(runUp + 2.5, (c, i) => {
      const t = i * TICK_DT;
      if (st > 0 && f.onGround && t - airAt > 0.1) landed = true;
      c.forward = landed ? 0 : 1; // stop on the landing so momentum doesn't carry off the far side
      if (st === 0 && t >= runUp) { c.buttons = BTN.JUMP; st = 1; airAt = t; return; }
      if (st === 1 && plan !== 'jump' && !f.onGround && f.vel.y < 0.5) { c.buttons = BTN.JUMP; st = 2; return; }
      if (st === 2 && plan === 'doubleDash' && t - airAt > 0.75) { c.buttons = BTN.DASH; st = 3; }
    });
    const ok = Math.abs(f.pos.y - expectY) < 0.02 && f.onGround;
    check(`route: ${name} ${expect ? 'succeeds' : 'fails'}`, ok === expect, `ended at y ${f.pos.y.toFixed(2)} (${f.pos.x.toFixed(1)}, ${f.pos.z.toFixed(1)})`);
  };
  const east = yawTo(1, 0), north = yawTo(0, -1), west = yawTo(-1, 0);
  // container (x -15.2..-12.8, z -37..-31, 2.6 tall) approached from the west
  route('ground -> container with a single jump', -14, 0, -41, yawTo(0, 1), 'jump', 2.6, false, 0.35);
  route('ground -> container with a double jump', -14, 0, -41, yawTo(0, 1), 'double', 2.6, true, 0.35);
  // container top -> stacked container (5.2) at x -36.65..-30.55, from the lower container's east end
  route('container -> stacked container (double jump)', -30.3, 2.6, -40, west, 'double', 5.2, true, 0.02);
  // crate (1.2) with a single jump
  route('ground -> crate with a single jump', -5, 0, -27, north, 'jump', 1.2, true, 0.2);
  // north catwalk gap (x 18..23.5, top 4.5): run east from x 10
  const g = FOUNDRY_GEOM.catwalkGap;
  const runUp = (g[0] - 0.3 - 10) / MOVE.maxSpeed + 0.12;
  route('catwalk gap with a single jump', 10, 4.5, -52, east, 'jump', 4.5, false, runUp);
  route('catwalk gap with a double jump', 10, 4.5, -52, east, 'double', 4.5, true, runUp);
  // pipe bridge gap (x -4.5..4.5, top 4.4): run east from x -14
  const bg = FOUNDRY_GEOM.bridgeGap;
  const bUp = (bg[0] - 0.3 + 14) / MOVE.maxSpeed + 0.12;
  route('pipe bridge gap with a double jump', -14, 4.4, 30, east, 'double', 4.4, false, bUp);
  route('pipe bridge gap with double jump + air dash', -14, 4.4, 30, east, 'doubleDash', 4.4, true, bUp);
  // smelter roof from the balcony crate (6.6 -> 9)
  route('balcony crate -> smelter roof (double jump)', -7.2, 6.6, -9.6, yawTo(0, 1), 'double', 9, true, 0.02);
  // warehouse roof from the landing crate (5.6 -> 7.5)
  route('landing crate -> warehouse roof (double jump)', -20.6, 5.6, 32, west, 'double', 7.5, true, 0.02);

  // bots can navigate the levels (nav graph reaches L1 and L2 from the ground)
  const nav = new NavGraph(w, 2);
  const start = nav.nearest(map.trainingSpawn!.pos);
  const reach = (x: number, y: number, z: number) => nav.findPath(start, nav.nearest(v3(x, y, z))).length > 0;
  check('nav reaches catwalk, balcony and container tops', reach(0, 4.5, -52) && reach(0, 4.4, -9.5) && reach(-14, 2.6, -34), `${nav.nodes.length} nodes`);
}
{
  // bots fight on Foundry, and practice movers never shoot
  const m = new Match({ mode: 'ffa', difficulty: 'normal', playerName: 'P', botCount: 6, timeLimit: 999, scoreLimit: 999, mapId: 'foundry', seed: 3 });
  m.fighters[0].alive = false;
  m.fighters[0].respawnTimer = Infinity;
  m.fighters[0].pos.y = -50;
  let kills = 0, dashes = 0, airJumps = 0;
  for (let i = 0; i < 90 / TICK_DT; i++) {
    m.step(TICK_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'kill') kills++;
      if (e.type === 'dash') dashes++;
      if (e.type === 'airJump') airJumps++;
    }
  }
  check('bots fight on Foundry', kills >= 3, `${kills} kills, ${dashes} dashes, ${airJumps} air jumps in 90 s`);
  const r = new Match({ mode: 'range', difficulty: 'normal', playerName: 'P', botCount: 0, trainingBots: 2, timeLimit: 999, scoreLimit: 999, mapId: 'foundry', seed: 3 });
  let botShots = 0;
  for (let i = 0; i < 20 / TICK_DT; i++) {
    r.step(TICK_DT);
    for (const e of r.drainEvents()) if (e.type === 'shot' && e.id !== 0) botShots++;
  }
  const p = r.fighters[0];
  check('practice starts at the Foundry training spawn', Math.hypot(p.pos.x - MAPS.foundry.trainingSpawn!.pos.x, p.pos.z - MAPS.foundry.trainingSpawn!.pos.z) < 0.01, `player at (${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
  check('practice movers never shoot', botShots === 0, `${botShots} shots`);
  p.pos.x += 20;
  p.hp = 10;
  r.resetPractice();
  check('practice reset puts everyone back', p.hp === p.maxHp && Math.abs(p.pos.x - MAPS.foundry.trainingSpawn!.pos.x) < 0.01, `hp ${p.hp}, x ${p.pos.x.toFixed(1)}`);
}

// ============================================================================ shot pipeline
function shotSetup(boxes: Box[] = []) {
  const map: MapDef = {
    name: 't', bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, floorColor: 0, skyColor: 0, fogColor: 0,
    boxes, ramps: [], spawns: [{ pos: v3(0, 0, 0), yaw: 0 }], dummies: [{ pos: v3(0, 0, -30), yaw: 0, strafe: 0, period: 1 }], props: [],
  };
  const m = new Match({ mode: 'range', difficulty: 'normal', playerName: 'P', botCount: 0, timeLimit: 999, scoreLimit: 999, seed: 1 });
  // swap in the test map (the Match reads geometry through its world)
  (m as unknown as { map: MapDef }).map = map;
  (m as unknown as { world: World }).world = new World(map);
  const p = m.fighters[0];
  const d = m.fighters.find((f) => f.kind === 'dummy')!;
  p.pos = v3(0, 0, 0); p.yaw = 0; p.pitch = 0;
  d.pos = v3(0, 0, -30); d.yaw = 0;
  for (const f of m.fighters.filter((x) => x.kind === 'dummy' && x !== d)) { f.alive = false; f.respawnTimer = Infinity; f.pos.y = -100; }
  const tick = (fill: (c: InputCommand) => void) => {
    const c = emptyCommand();
    fill(c);
    m.submit(0, c);
    m.step(TICK_DT);
    return m.drainEvents();
  };
  return { m, p, d, tick };
}
const aimAtPoint = (p: Fighter, c: InputCommand, x: number, y: number, z: number, from = eyePos(p)) => {
  c.yaw = yawTo(x - from.x, z - from.z);
  c.pitch = Math.atan2(y - from.y, Math.hypot(x - from.x, z - from.z));
};
{
  // camera offset over the right shoulder: the reticle ray from the camera decides the aim point
  const { p, d, tick } = shotSetup();
  const off = { x: 0.6, y: 0.25, z: 1.8 }; // right, up, behind (yaw 0 looks -z)
  const evs: GameEvent[] = [];
  for (let i = 0; i < 60; i++) {
    evs.push(...tick((c) => {
      const e = eyePos(p);
      const cam = v3(e.x + off.x, e.y + off.y, e.z + off.z);
      aimAtPoint(p, c, d.pos.x, d.pos.y + 1.7, d.pos.z, cam);
      c.ox = off.x; c.oy = off.y; c.oz = off.z;
      c.buttons = BTN.ADS | (i === 50 ? BTN.FIRE : 0);
    }));
  }
  const hit = evs.find((e) => e.type === 'hit');
  check('shoulder-camera reticle shot lands where the camera aims', !!hit && hit.type === 'hit' && hit.part === 'head', hit && hit.type === 'hit' ? `hit ${hit.part}` : 'missed');
  const hits = evs.filter((e) => e.type === 'hit').length;
  const shots = evs.filter((e) => e.type === 'shot').length;
  check('damage applied once per shot', hits === shots && shots === 1, `${shots} shot(s), ${hits} hit event(s)`);
}
{
  // the camera can see past a wall the muzzle can't: the shot stops at the wall
  const { p, d, tick } = shotSetup([box(-1.0, 0, -1.2, 0.05, 3, -0.9)]); // wall in front-left of the barrel
  p.pos = v3(0.0, 0, 0);
  const evs: GameEvent[] = [];
  for (let i = 0; i < 60; i++) {
    evs.push(...tick((c) => {
      const cam = v3(eyePos(p).x + 1.2, eyePos(p).y + 0.2, eyePos(p).z + 1.6);
      aimAtPoint(p, c, d.pos.x - 3, d.pos.y + 1.4, d.pos.z, cam);
      c.ox = 1.2; c.oy = 0.2; c.oz = 1.6;
      c.buttons = i === 50 ? BTN.FIRE : 0;
    }));
  }
  const shot = evs.find((e) => e.type === 'shot');
  check('no shooting through the wall in front of the muzzle', !!shot && shot.type === 'shot' && shot.hitWorld && !evs.some((e) => e.type === 'hit'), shot && shot.type === 'shot' ? `shot stopped at z ${shot.to.z.toFixed(2)}` : 'no shot');
}
{
  // the shooter's own body never stops their shot (camera ray starts at the eye plane)
  const { p, d, tick } = shotSetup();
  const evs: GameEvent[] = [];
  for (let i = 0; i < 60; i++) {
    evs.push(...tick((c) => {
      // camera straight behind the head: the reticle ray passes through the shooter's own head
      aimAtPoint(p, c, d.pos.x, d.pos.y + 1.2, d.pos.z, v3(eyePos(p).x, eyePos(p).y, eyePos(p).z + 2));
      c.ox = 0; c.oy = 0; c.oz = 2;
      c.buttons = BTN.ADS | (i === 50 ? BTN.FIRE : 0);
    }));
  }
  const selfHit = evs.some((e) => e.type === 'hit' && e.victim === p.id);
  const hitDummy = evs.some((e) => e.type === 'hit' && e.victim === d.id);
  check('shooter is excluded from their own shot', !selfHit && hitDummy, `self hit ${selfHit}, dummy hit ${hitDummy}`);
}
{
  // sniper: one shot per press, quickscope + airborne flags from real shot state
  const { p, d, tick } = shotSetup();
  const evs: GameEvent[] = [];
  for (let i = 0; i < 60; i++) tick((c) => { c.slot = 1; aimAtPoint(p, c, d.pos.x, d.pos.y + 1.2, d.pos.z); });
  // quickscope: scope in, hold fire from just past the readiness threshold (~0.12 s) for a full second
  const readyTick = Math.ceil((WEAPONS.sniper.adsReady! * WEAPONS.sniper.adsTime) / TICK_DT) + 1;
  for (let i = 0; i < 120; i++) evs.push(...tick((c) => { aimAtPoint(p, c, d.pos.x, d.pos.y + 1.2, d.pos.z); c.buttons = BTN.ADS | (i >= readyTick ? BTN.FIRE : 0); }));
  check('sniper fires once per press while held', evs.filter((e) => e.type === 'shot').length === 1, `${evs.filter((e) => e.type === 'shot').length} shots in 1 s of held fire`);
  const hit = evs.find((e) => e.type === 'hit');
  check('quickscope flag on a fast scoped hit', !!hit && hit.type === 'hit' && hit.quickscope === true, hit && hit.type === 'hit' ? `quickscope ${hit.quickscope}` : 'no hit');
  // airborne scoped shot
  const s2 = shotSetup();
  const e2: GameEvent[] = [];
  for (let i = 0; i < 60; i++) s2.tick((c) => { c.slot = 1; aimAtPoint(s2.p, c, s2.d.pos.x, s2.d.pos.y + 1.2, s2.d.pos.z); });
  let airborneAtShot = false;
  for (let i = 0; i < 70; i++) {
    e2.push(...s2.tick((c) => {
      aimAtPoint(s2.p, c, s2.d.pos.x, s2.d.pos.y + 1.2, s2.d.pos.z);
      c.buttons = BTN.ADS | (i === 20 ? BTN.JUMP : 0) | (i === 45 ? BTN.FIRE : 0);
    }));
    if (i === 45) airborneAtShot = !s2.p.onGround;
  }
  void airborneAtShot;
  const h2 = e2.find((e) => e.type === 'hit');
  check('airborne scoped shot allowed and flagged', !!h2 && h2.type === 'hit' && h2.airborne === true, h2 && h2.type === 'hit' ? `airborne ${h2.airborne}, part ${h2.part}` : 'no hit');
}
{
  // hip spread is distinct; ready ADS is exact
  const f = createFighter(0, 'p', 0, 'player', ['sniper']);
  f.alive = true;
  const hip = computeSpread(f);
  f.ads = WEAPONS.sniper.adsReady!;
  const ready = computeSpread(f);
  f.ads = WEAPONS.sniper.adsReady! - 0.05;
  const almost = computeSpread(f);
  check('sniper hip spread distinct, exact at the readiness threshold', hip > 0.03 && ready === 0 && almost > 0, `hip ${(hip * 1000).toFixed(0)} mrad, just before ready ${(almost * 1000).toFixed(1)}, ready ${ready}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall movement checks passed');
process.exit(failed ? 1 : 0);
