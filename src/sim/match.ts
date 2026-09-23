import { DIFFICULTY, type DifficultyDef } from '../config/difficulty';
import { MOVE } from '../config/movement';
import { RANGE_LOADOUT, WEAPONS, matchLoadout } from '../config/weapons';
import { BotBrain } from './bots';
import type { SimContext } from './context';
import { createFighter, eyePos, type Fighter } from './fighter';
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
  /** player's primary for matches (range always carries everything) */
  primary?: 'ar' | 'sniper';
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
/** head colours: loud, distinct from each other and from the paper world */
export const BOT_COLORS = [0xff4f9a, 0x2fa8ff, 0x3ddc84, 0xffb020, 0x9b5cf6, 0xff6a3d, 0x14c8c8, 0xe0e04a];
export const PLAYER_COLOR = 0xffd23f;

/** 120 Hz: halves the worst-case wait between a click and the shot being simulated. */
export const TICK_RATE = 120;
export const TICK_DT = 1 / TICK_RATE;

const SPAWN_PROTECT = 2.0;

/** Authoritative simulation. On a future server this class runs as-is. */
export class Match implements SimContext {
  readonly map: MapDef;
  readonly world: World;
  readonly nav: NavGraph;
  readonly fighters: Fighter[] = [];
  readonly events: GameEvent[] = [];
  readonly rng: () => number;
  readonly diff: DifficultyDef;
  time = 0;
  tick = 0;
  timeLeft: number;
  ended = false;
  private cmds = new Map<number, InputCommand>();
  private brains = new Map<number, BotBrain>();
  private eventCursor = 0;
  /** bots currently allowed to shoot at a human (limits how many engage you at once) */
  private attackers = new Map<number, number>();

  constructor(readonly opts: MatchOptions) {
    this.map = opts.mode === 'range' ? MAPS.range : MAPS.arena;
    this.world = new World(this.map);
    this.nav = new NavGraph(this.world, 2);
    this.rng = mulberry32(opts.seed ?? (Math.random() * 1e9) | 0);
    this.timeLeft = opts.mode === 'range' ? Infinity : opts.timeLimit;
    this.diff = DIFFICULTY[opts.difficulty];

    const playerLoadout = opts.mode === 'range' ? RANGE_LOADOUT : matchLoadout(opts.primary ?? 'ar');
    const player = createFighter(0, opts.playerName || 'You', PLAYER_COLOR, 'player', playerLoadout);
    this.fighters.push(player);

    if (opts.mode === 'ffa') {
      const count = Math.max(1, Math.min(8, Math.round(opts.botCount)));
      for (let i = 0; i < count; i++) {
        const primary = i < this.diff.sniperBots ? 'sniper' : 'ar';
        const b = createFighter(i + 1, BOT_NAMES[i % BOT_NAMES.length], BOT_COLORS[i % BOT_COLORS.length], 'bot', matchLoadout(primary));
        this.fighters.push(b);
        this.brains.set(b.id, new BotBrain(b, this.diff, this.nav, this.rng));
      }
    } else {
      this.map.dummies.forEach((d, i) => {
        const f = createFighter(100 + i, `Dummy ${i + 1}`, 0xff8a3d, 'dummy', ['melee']);
        f.dummy = d;
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
    this.attackers.delete(victim.id);
    if (this.opts.mode === 'ffa' && killer.stats.kills >= this.opts.scoreLimit) this.endMatch();
  }

  /**
   * Attack tokens: at most `diff.maxAttackers` bots may shoot at a human at the same time, so you can
   * finish a fight before the whole arena piles on. Bots vs bots are unrestricted.
   */
  requestAttack(bot: Fighter, target: Fighter): boolean {
    if (target.kind !== 'player') return true;
    for (const [id, t] of this.attackers) if (this.time - t > 0.4) this.attackers.delete(id);
    if (this.attackers.has(bot.id) || this.attackers.size < this.diff.maxAttackers) {
      this.attackers.set(bot.id, this.time);
      return true;
    }
    return false;
  }

  private endMatch() {
    if (this.ended) return;
    this.ended = true;
    this.events.push({ type: 'matchEnd' });
  }

  /** Spawn scoring: far from enemies AND out of their line of sight. */
  private pickSpawn(f: Fighter): { pos: ReturnType<typeof v3>; yaw: number } {
    const spawns = this.map.spawns;
    let best = -Infinity;
    let pick = spawns[0];
    const enemies = this.fighters.filter((o) => o !== f && o.alive && o.kind !== 'dummy');
    for (const s of spawns) {
      let minD = 60;
      let seen = false;
      const head = v3(s.pos.x, s.pos.y + 1.6, s.pos.z);
      for (const o of enemies) {
        const d = vdist(o.pos, s.pos);
        minD = Math.min(minD, d);
        if (!seen && d < 75 && this.world.los(eyePos(o), head)) seen = true;
      }
      let score = minD + this.rng() * 5;
      if (seen) score -= 45;
      if (minD < 10) score -= 30;
      if (score > best) {
        best = score;
        pick = s;
      }
    }
    return { pos: v3(pick.pos.x, pick.pos.y, pick.pos.z), yaw: pick.yaw };
  }

  private respawn(f: Fighter, initial = false) {
    let pos = v3();
    let yaw = 0;
    if (f.dummy) {
      pos = v3(f.dummy.pos.x, f.dummy.pos.y, f.dummy.pos.z);
      yaw = f.dummy.yaw;
    } else {
      const sp = this.pickSpawn(f);
      pos = sp.pos;
      yaw = sp.yaw;
    }
    vcopy(f.pos, pos);
    vcopy(f.prevPos, pos);
    f.vel = v3();
    f.yaw = f.prevYaw = yaw;
    f.lowerYaw = f.prevLowerYaw = yaw;
    f.pitch = f.prevPitch = 0;
    f.gait = f.prevGait = 0;
    f.hp = f.maxHp;
    f.alive = true;
    f.onGround = true;
    f.crouching = false;
    f.sliding = false;
    f.height = f.prevHeight = MOVE.standHeight;
    f.cur = 0;
    f.switchTimer = WEAPONS[f.weapons[0].id].drawTime;
    f.reloadTimer = 0;
    f.reloadInserted = false;
    f.fireCooldown = 0;
    f.fireQueuedAt = -99;
    f.fireLock = true; // must release fire after spawning: no accidental shots
    f.meleeWindup = 0;
    f.recoilPitch = f.recoilYaw = f.prevRecoilPitch = f.prevRecoilYaw = 0;
    f.kickPitch = f.kickYaw = 0;
    f.kickTime = -99;
    f.bloom = 0;
    f.ads = f.prevAds = 0;
    f.shotIndex = 0;
    f.lastDamageTime = -99;
    f.spawnProtect = f.kind === 'dummy' || this.opts.mode === 'range' || initial ? 0 : SPAWN_PROTECT;
    for (const w of f.weapons) {
      w.mag = WEAPONS[w.id].magSize;
      w.boltLeft = 0;
    }
    this.attackers.delete(f.id);
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
      f.prevLowerYaw = f.lowerYaw;
      f.prevGait = f.gait;
      f.prevRecoilPitch = f.recoilPitch;
      f.prevRecoilYaw = f.recoilYaw;
    }
    const wopts = { instantSwitch: this.opts.mode === 'range' };

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

      simulateMovement(f, cmd, dt, this.world, this.events, this.time);
      updateWeapon(this, f, cmd, dt, wopts);
      f.prevButtons = cmd.buttons;
      if (f.spawnProtect > 0) {
        f.spawnProtect = Math.max(0, f.spawnProtect - dt);
        if (f.spawnProtect === 0) this.events.push({ type: 'protectEnd', id: f.id });
      }

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
      for (const [id, brain] of this.brains) if (id !== src.id) brain.hear(src, this.time, loud);
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
