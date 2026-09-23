import { DIFFICULTY } from '../config/difficulty';
import { MOVE } from '../config/movement';
import { WEAPONS } from '../config/weapons';
import { BotBrain } from './bots';
import type { SimContext } from './context';
import { createFighter, type Fighter } from './fighter';
import { MAPS, type MapDef } from './map';
import { simulateMovement } from './movement';
import { NavGraph } from './nav';
import { BTN, emptyCommand, type Difficulty, type GameEvent, type GameMode, type InputCommand } from './types';
import { mulberry32, v3, vcopy, vdist } from './vec';
import { updateWeapon } from './weaponsim';
import { World } from './world';

export interface MatchOptions {
  mode: GameMode;
  difficulty: Difficulty;
  playerName: string;
  botCount: number;
  timeLimit: number;
  scoreLimit: number;
  seed?: number;
}

export interface MatchInfo {
  mode: GameMode;
  mapName: string;
  timeLeft: number;
  scoreLimit: number;
  ended: boolean;
  time: number;
}

const BOT_NAMES = ['Scribble', 'Doodle', 'Twig', 'Pencil', 'Sketch', 'Noodle', 'Matchstick', 'Squiggle'];
const COLORS = [0x1c1c22, 0xe0413a, 0x2f7de1, 0x2fb85a, 0xf0a020, 0x9b4de0, 0xe05aa8, 0x20b8c8];

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** Authoritative simulation. On a future server this class runs as-is. */
export class Match implements SimContext {
  readonly map: MapDef;
  readonly world: World;
  readonly nav: NavGraph;
  readonly fighters: Fighter[] = [];
  readonly events: GameEvent[] = [];
  readonly rng: () => number;
  time = 0;
  tick = 0;
  timeLeft: number;
  ended = false;
  private cmds = new Map<number, InputCommand>();
  private brains = new Map<number, BotBrain>();
  private eventCursor = 0;

  constructor(readonly opts: MatchOptions) {
    this.map = opts.mode === 'range' ? MAPS.range : MAPS.arena;
    this.world = new World(this.map);
    this.nav = new NavGraph(this.world, 2);
    this.rng = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0);
    this.timeLeft = opts.mode === 'range' ? Infinity : opts.timeLimit;

    const player = createFighter(0, opts.playerName || 'You', COLORS[0], 'player');
    this.fighters.push(player);

    if (opts.mode === 'ffa') {
      const diff = DIFFICULTY[opts.difficulty];
      for (let i = 0; i < opts.botCount; i++) {
        const b = createFighter(i + 1, BOT_NAMES[i % BOT_NAMES.length], COLORS[(i + 1) % COLORS.length], 'bot');
        this.fighters.push(b);
        this.brains.set(b.id, new BotBrain(b, diff, this.nav, this.rng));
      }
    } else {
      this.map.dummies.forEach((d, i) => {
        const f = createFighter(100 + i, `Dummy ${i + 1}`, 0xf07a3a, 'dummy');
        f.dummy = d;
        f.maxHp = 100;
        this.fighters.push(f);
      });
    }
    for (const f of this.fighters) this.respawn(f, true);
  }

  get info(): MatchInfo {
    return {
      mode: this.opts.mode,
      mapName: this.map.name,
      timeLeft: this.timeLeft,
      scoreLimit: this.opts.scoreLimit,
      ended: this.ended,
      time: this.time,
    };
  }

  /** input/command layer entry point */
  submit(id: number, cmd: InputCommand) {
    this.cmds.set(id, cmd);
  }

  drainEvents(): GameEvent[] {
    const out = this.events.splice(0, this.events.length);
    this.eventCursor = 0;
    return out;
  }

  onDamaged(victim: Fighter, attacker: Fighter) {
    this.brains.get(victim.id)?.onDamaged(attacker, this.time);
  }

  onKilled(victim: Fighter, killer: Fighter) {
    if (this.opts.mode === 'ffa' && killer.stats.kills >= this.opts.scoreLimit) this.endMatch();
    void victim;
  }

  private endMatch() {
    if (this.ended) return;
    this.ended = true;
    this.events.push({ type: 'matchEnd' });
  }

  private respawn(f: Fighter, initial = false) {
    let pos = v3();
    let yaw = 0;
    if (f.dummy) {
      pos = v3(f.dummy.pos.x, f.dummy.pos.y, f.dummy.pos.z);
      yaw = f.dummy.yaw;
    } else {
      // farthest spawn from living enemies
      let best = -Infinity;
      const spawns = this.map.spawns;
      const offset = Math.floor(this.rng() * spawns.length);
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[(i + offset) % spawns.length];
        let minD = 1000;
        for (const o of this.fighters) {
          if (o === f || !o.alive) continue;
          minD = Math.min(minD, vdist(o.pos, s.pos));
        }
        const score = minD + this.rng() * 6 - (initial ? 0 : 0);
        if (score > best) {
          best = score;
          pos = v3(s.pos.x, s.pos.y, s.pos.z);
          yaw = s.yaw;
        }
      }
    }
    vcopy(f.pos, pos);
    vcopy(f.prevPos, pos);
    f.vel = v3();
    f.yaw = f.prevYaw = yaw;
    f.pitch = f.prevPitch = 0;
    f.hp = f.maxHp;
    f.alive = true;
    f.onGround = true;
    f.crouching = false;
    f.sliding = false;
    f.height = f.prevHeight = MOVE.standHeight;
    f.cur = 0;
    f.switchTimer = WEAPONS[f.weapons[0].id].drawTime;
    f.reloadTimer = 0;
    f.fireCooldown = 0;
    f.meleeWindup = 0;
    f.recoilPitch = f.recoilYaw = f.prevRecoilPitch = f.prevRecoilYaw = 0;
    f.bloom = 0;
    f.ads = 0;
    f.shotIndex = 0;
    f.lastDamageTime = -99;
    for (const w of f.weapons) w.mag = WEAPONS[w.id].magSize;
    this.brains.get(f.id)?.reset();
    this.events.push({ type: 'spawn', id: f.id });
  }

  private dummyCommand(f: Fighter, dt: number): InputCommand {
    const d = f.dummy!;
    const cmd = emptyCommand();
    cmd.yaw = d.yaw;
    f.dummyT += dt;
    if (d.strafe) {
      // strafe back and forth around its home position (with Krunker-like acceleration)
      const phase = Math.sin((f.dummyT / d.period) * Math.PI);
      const off = (f.pos.x - d.pos.x) * Math.cos(d.yaw) - (f.pos.z - d.pos.z) * Math.sin(d.yaw);
      cmd.strafe = phase > 0 ? 1 : -1;
      if (Math.abs(off) > 5) cmd.strafe = off > 0 ? -1 : 1;
      if (d.jump && Math.sin(f.dummyT * 2.1) > 0.97) cmd.buttons |= BTN.JUMP;
    }
    if (d.crouch) cmd.buttons |= BTN.CROUCH;
    return cmd;
  }

  step(dt: number) {
    if (this.ended) return;
    this.time += dt;
    this.tick++;

    for (const f of this.fighters) {
      vcopy(f.prevPos, f.pos);
      f.prevYaw = f.yaw;
      f.prevPitch = f.pitch;
      f.prevHeight = f.height;
      f.prevRecoilPitch = f.recoilPitch;
      f.prevRecoilYaw = f.recoilYaw;
    }

    for (const f of this.fighters) {
      if (!f.alive) {
        f.respawnTimer -= dt;
        // players' commands still drain while dead
        if (f.respawnTimer <= 0) this.respawn(f);
        continue;
      }
      let cmd: InputCommand;
      if (f.kind === 'player') cmd = this.cmds.get(f.id) ?? emptyCommand();
      else if (f.kind === 'bot') cmd = this.brains.get(f.id)!.think(this, dt);
      else cmd = this.dummyCommand(f, dt);

      simulateMovement(f, cmd, dt, this.world, this.events);
      updateWeapon(this, f, cmd, dt);
      f.prevButtons = cmd.buttons;

      // Krunker-style regen after a few seconds out of combat
      if (f.alive && f.hp < f.maxHp && this.time - f.lastDamageTime > (f.kind === 'dummy' ? 2.5 : 5)) {
        f.hp = Math.min(f.maxHp, f.hp + (f.kind === 'dummy' ? 200 : 22) * dt);
      }
      if (f.pos.y < -30) f.pos.y = 5;
    }

    // hearing: bots react to gunfire & footsteps
    for (let i = this.eventCursor; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type !== 'shot' && e.type !== 'step' && e.type !== 'melee') continue;
      const src = this.fighters.find((x) => x.id === e.id);
      if (!src) continue;
      const loud = e.type === 'shot' ? 1 : e.type === 'melee' ? 0.25 : 0.2;
      for (const [id, brain] of this.brains) if (id !== src.id) brain.hear(src.pos, this.time, loud);
    }
    this.eventCursor = this.events.length;

    if (this.timeLeft !== Infinity) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endMatch();
      }
    }
  }

  botState(id: number): string | undefined {
    return this.brains.get(id)?.state;
  }
}
