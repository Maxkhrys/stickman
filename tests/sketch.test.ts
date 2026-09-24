// Sketch Slide (experimental paint-and-slide) simulation checks. `npm run test:sketch`
import assert from 'node:assert/strict';
import { Match, TICK_DT, TICK_RATE } from '../src/sim/match';
import { BTN, emptyCommand, type GameEvent, type InputCommand } from '../src/sim/types';
import { PAINT, PaintGrid } from '../src/sim/paint';
import { World } from '../src/sim/world';
import { MAPS } from '../src/sim/map';
import type { Fighter } from '../src/sim/fighter';

let passed = 0;
function test(name: string, run: () => string | void) {
  const detail = run();
  passed++;
  console.log(`PASS ${name}${detail ? `  (${detail})` : ''}`);
}

type Opts = { sketchSlide?: boolean; seed?: number; mode?: 'range' | 'ffa'; bots?: number };
function match(o: Opts = {}) {
  return new Match({ mode: o.mode ?? 'range', difficulty: 'easy', playerName: 'P', botCount: o.bots ?? 0, timeLimit: 999, scoreLimit: 999, seed: o.seed ?? 4, sketchSlide: o.sketchSlide });
}
function place(f: Fighter, x: number, z: number, yaw: number, y = 0) {
  f.pos.x = f.prevPos.x = x; f.pos.z = f.prevPos.z = z; f.pos.y = f.prevPos.y = y;
  f.vel.x = f.vel.y = f.vel.z = 0; f.onGround = true; f.yaw = f.prevYaw = f.lowerYaw = yaw; f.spawnProtect = 0;
}
function steps(m: Match, secs: number, cmd: (c: InputCommand, i: number) => void) {
  const p = m.fighters[0];
  for (let i = 0; i < Math.round(secs / TICK_DT); i++) {
    const c = emptyCommand();
    c.yaw = p.yaw;
    c.pitch = p.pitch;
    cmd(c, i);
    m.submit(0, c);
    m.step(TICK_DT);
  }
}
const quietDummies = (m: Match) => { for (const f of m.fighters.slice(1)) { f.alive = false; f.respawnTimer = 1e9; } };

/** paint a strip ahead of the player by shooting the floor, then slide down it; returns slide distance */
function paintAndSlide(m: Match, paint: boolean) {
  const p = m.fighters[0];
  quietDummies(m);
  place(p, -12, 10, 0); // facing -Z down an open lane
  p.weapons[p.cur].id = 'ar';
  if (paint) {
    for (let k = 0; k < 14; k++) {
      steps(m, 0.12, (c) => { c.pitch = -0.28 + k * 0.01; c.buttons = BTN.FIRE; });
      steps(m, 0.02, () => {});
    }
    steps(m, 2.2, (c) => { c.buttons = BTN.RELOAD; });
  }
  place(p, -12, 10, 0);
  const start = { ...p.pos };
  let active = 0;
  steps(m, 0.5, (c) => { c.forward = 1; });
  steps(m, 1.2, (c, i) => { c.forward = 1; c.buttons = i < 60 ? BTN.CROUCH : 0; if (p.sketchSlide) active++; });
  return { dist: Math.hypot(p.pos.x - start.x, p.pos.z - start.z), active, cells: m.paint.cells.size };
}

test('option off: identical outcome to the previous rules, no paint', () => {
  const a = match({ sketchSlide: false }), b = match({});
  const ra = paintAndSlide(a, true), rb = paintAndSlide(b, true);
  assert.equal(ra.cells, 0);
  assert.equal(ra.active, 0);
  assert.ok(Math.abs(ra.dist - rb.dist) < 1e-9);
  return `slide ${ra.dist.toFixed(3)} m`;
});

test('own paint lowers slide friction (bonus only while sliding on it)', () => {
  const off = paintAndSlide(match({ sketchSlide: true }), false);
  const on = paintAndSlide(match({ sketchSlide: true }), true);
  assert.ok(on.cells > 0, 'no paint laid');
  assert.ok(on.active > 0, 'bonus never active');
  assert.ok(on.dist > off.dist, `painted ${on.dist} vs plain ${off.dist}`);
  assert.ok(on.dist < off.dist * 1.25, 'bonus stacks or accelerates');
  return `plain ${off.dist.toFixed(2)} m, painted ${on.dist.toFixed(2)} m, ${on.cells} cells, active ${on.active} ticks`;
});

test('no speed gain beyond the slide start impulse (no stacking, no per-frame boost)', () => {
  const m = match({ sketchSlide: true });
  const p = m.fighters[0];
  paintAndSlide(m, true);
  place(p, -12, 10, 0);
  steps(m, 0.5, (c) => { c.forward = 1; });
  let peak = 0, prev = 0, gained = 0;
  steps(m, 1.0, (c, i) => {
    c.forward = 1; c.buttons = BTN.CROUCH;
    const s = Math.hypot(p.vel.x, p.vel.z);
    if (i > 2 && p.sliding && s > prev + 1e-6) gained++;
    prev = s; peak = Math.max(peak, s);
  });
  assert.equal(gained, 0, 'speed rose during the slide');
});

test('ownership is deterministic, later writes overwrite, same-tick order is stable', () => {
  const w = new World(MAPS.range);
  const run = () => {
    const g = new PaintGrid(w, TICK_RATE);
    g.paint({ x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, 3, 10);
    g.paint({ x: 1.2, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, 5, 10); // same tick, later in fighter order
    return [...g.cells.values()].map((c) => `${c.key}:${c.owner}:${c.expire}`).join('|');
  };
  const a = run(), b = run();
  assert.equal(a, b);
  const g = new PaintGrid(w, TICK_RATE);
  g.paint({ x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, 3, 10);
  assert.equal(g.ownerAt(1, 0, 1, 11), 3);
  g.paint({ x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, 5, 20);
  assert.equal(g.ownerAt(1, 0, 1, 21), 5);
});

test('marks expire at the configured life and cleanup is bounded', () => {
  const w = new World(MAPS.range);
  const g = new PaintGrid(w, TICK_RATE);
  g.paint({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 1, 0);
  const life = Math.round(PAINT.life * TICK_RATE);
  assert.equal(g.ownerAt(0.1, 0, 0.1, life - 1), 1);
  g.expire(life);
  assert.equal(g.ownerAt(0.1, 0, 0.1, life), -1);
  assert.equal(g.cells.size, 0);
  for (let i = 0; i < 5000; i++) g.paint({ x: -15 + (i % 60) * 0.5, y: 0, z: -80 + Math.floor(i / 60) }, { x: 0, y: 1, z: 0 }, 1, 100);
  assert.ok(g.cells.size <= PAINT.maxCells, `cells ${g.cells.size}`);
  return `cap ${PAINT.maxCells}, holding ${g.cells.size}`;
});

test('walls do not take gameplay paint; a bridge and the floor under it are separate', () => {
  const w = new World(MAPS.range);
  const g = new PaintGrid(w, TICK_RATE);
  assert.equal(g.paint({ x: 17.9, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, 1, 0), 0);
  // range catwalk: box centred (15, -42), 3 x 26, top at 3.5
  const cat = w.boxes.find((b) => b.min.y > 2 && b.max.x - b.min.x < 4 && b.max.z - b.min.z > 20)!;
  const top = cat.max.y, x = (cat.min.x + cat.max.x) / 2, z = (cat.min.z + cat.max.z) / 2;
  assert.ok(g.paint({ x, y: top, z }, { x: 0, y: 1, z: 0 }, 2, 0) > 0);
  assert.equal(g.ownerAt(x, top, z, 1), 2);
  assert.equal(g.ownerAt(x, 0, z, 1), -1, 'bridge paint leaked to the floor below');
  g.paint({ x, y: 0, z }, { x: 0, y: 1, z: 0 }, 3, 1);
  assert.equal(g.ownerAt(x, 0, z, 2), 3);
  assert.equal(g.ownerAt(x, top, z, 2), 2);
});

test('shots into a fighter or through cover never paint behind them', () => {
  const m = match({ sketchSlide: true });
  const p = m.fighters[0];
  const d = m.fighters[1]; // stationary range dummy at (-6, -10)
  for (const f of m.fighters.slice(2)) { f.alive = false; f.respawnTimer = 1e9; }
  place(p, d.pos.x, d.pos.z + 3, 0);
  p.weapons[p.cur].id = 'ar';
  // aim through the dummy's body at the floor behind it: the ray stops at the dummy
  steps(m, 0.4, (c) => { c.pitch = -0.3; c.buttons = BTN.FIRE; });
  let behind = 0;
  for (const c of m.paint.cells.values()) if ((c.cz + 0.5) * PAINT.cell < d.pos.z - 0.3) behind++;
  assert.equal(behind, 0, `${behind} cells behind the dummy`);
  // cover: the firing-line wall of the range backstop never lets paint land behind it
  return `${m.paint.cells.size} cells, none behind the target`;
});

test('leaving paint or the ground removes the bonus within the grace window', () => {
  const m = match({ sketchSlide: true });
  const p = m.fighters[0];
  paintAndSlide(m, true);
  place(p, -12, 10, 0);
  steps(m, 0.5, (c) => { c.forward = 1; });
  let airborneActive = 0;
  steps(m, 0.6, (c, i) => { c.forward = 1; c.buttons = BTN.CROUCH | (i === 20 ? BTN.JUMP : 0); if (!p.onGround && p.sketchSlide) airborneActive++; });
  assert.equal(airborneActive, 0);
});

test('simulation outcome does not depend on render schedule (sim-only state)', () => {
  const trace = () => {
    const m = match({ sketchSlide: true, mode: 'ffa', bots: 3, seed: 11 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 600; i++) { m.submit(0, emptyCommand()); m.step(TICK_DT); events.push(...m.drainEvents()); }
    return `${m.paint.cells.size}|${m.fighters.map((f) => `${f.pos.x.toFixed(5)},${f.pos.z.toFixed(5)}`).join(';')}`;
  };
  assert.equal(trace(), trace());
});

test('eight fighters under sustained fire stay within the cell budget', () => {
  const m = match({ sketchSlide: true, mode: 'ffa', bots: 7, seed: 2 });
  let max = 0;
  for (let i = 0; i < Math.round(30 / TICK_DT); i++) { m.submit(0, emptyCommand()); m.step(TICK_DT); m.drainEvents(); max = Math.max(max, m.paint.cells.size); }
  assert.ok(max <= PAINT.maxCells);
  return `peak ${max} live cells over 30 s`;
});

test('map change / restart starts with clean paint', () => {
  const m = match({ sketchSlide: true });
  paintAndSlide(m, true);
  assert.ok(m.paint.cells.size > 0);
  assert.equal(match({ sketchSlide: true }).paint.cells.size, 0);
});

console.log(`\n${passed} sketch-slide checks passed`);
