import type { DifficultyDef } from '../config/difficulty';
import { WEAPONS } from '../config/weapons';
import type { SimContext } from './context';
import { chestPos, eyePos, type Fighter } from './fighter';
import type { NavGraph } from './nav';
import { BTN, emptyCommand, type InputCommand } from './types';
import { angleDiff, clamp, pitchTo, v3, vclone, vdist, vdistH, yawTo, type Vec3 } from './vec';

export type BotState = 'patrol' | 'investigate' | 'engage' | 'cover' | 'flank' | 'retreat';

/**
 * Bot brain. Reads the world like a player would (LOS, hearing, damage) and outputs an InputCommand
 * every tick, so bots run through exactly the same movement/weapon code as humans.
 *
 *  patrol -> (hear) investigate -> (see) engage -> (low hp / reloading) cover -> engage
 *                                          engage -> (lost target) flank / investigate
 *                                          engage -> (critical hp) retreat -> (healed) patrol
 */
export class BotBrain {
  state: BotState = 'patrol';
  stateTime = 0;
  targetId = -1;
  visible = false;
  seenFor = 0;
  reactLeft = 0;
  lastSeen: Vec3 | null = null;
  lastSeenTime = -99;
  heard: Vec3 | null = null;
  heardTime = -99;

  path: number[] = [];
  pathIdx = 0;
  goal: Vec3 | null = null;
  repathTimer = 0;

  aimYaw = 0;
  aimPitch = 0;
  errX = 0;
  errY = 0;
  errTX = 0;
  errTY = 0;
  errTimer = 0;
  aimHead = false;

  strafeDir = 1;
  strafeTimer = 0;
  moveBias = 0;
  senseTimer = 0;
  stuckCheck = 0;
  stuckTime = 0;
  lastCheckPos: Vec3 = v3();
  burstLeft = 5;
  burstPause = 0;
  lookAround = 0;
  wantSlot = 0;

  constructor(
    private f: Fighter,
    private diff: DifficultyDef,
    private nav: NavGraph,
    private rng: () => number,
  ) {
    this.aimYaw = f.yaw;
  }

  reset() {
    this.state = 'patrol';
    this.stateTime = 0;
    this.targetId = -1;
    this.visible = false;
    this.seenFor = 0;
    this.lastSeen = null;
    this.path = [];
    this.goal = null;
    this.heard = null;
    this.aimYaw = this.f.yaw;
    this.aimPitch = 0;
    this.wantSlot = 0;
  }

  private setState(s: BotState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.goal = null;
  }

  hear(pos: Vec3, time: number, loud: number) {
    const d = vdist(pos, this.f.pos);
    if (d > this.diff.hearing * loud) return;
    this.heard = vclone(pos);
    this.heardTime = time;
  }

  onDamaged(attacker: Fighter, time: number) {
    if (attacker === this.f) return;
    // pain awareness: we know roughly where it came from
    if (!this.visible || this.targetId !== attacker.id) {
      this.targetId = attacker.id;
      this.lastSeen = vclone(attacker.pos);
      this.lastSeenTime = time;
      this.heard = vclone(attacker.pos);
      this.heardTime = time;
      // snap-turn toward the attacker (partially)
      const e = eyePos(this.f);
      const desired = yawTo(attacker.pos.x - e.x, attacker.pos.z - e.z);
      this.aimYaw += angleDiff(desired, this.aimYaw) * 0.6;
      if (this.state === 'patrol' || this.state === 'investigate') this.setState('investigate');
    }
  }

  private goTo(p: Vec3) {
    const from = this.nav.nearest(this.f.pos);
    const to = this.nav.nearest(p);
    this.path = this.nav.findPath(from, to);
    this.pathIdx = 0;
    this.goal = vclone(p);
    this.repathTimer = 3 + this.rng() * 2;
  }

  private arrived(): boolean {
    return this.pathIdx >= this.path.length;
  }

  private target(ctx: SimContext): Fighter | null {
    if (this.targetId < 0) return null;
    const t = ctx.fighters.find((x) => x.id === this.targetId);
    return t && t.alive ? t : null;
  }

  private sense(ctx: SimContext) {
    const f = this.f;
    const eye = eyePos(f);
    const fwdYaw = f.yaw;
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const o of ctx.fighters) {
      if (o === f || !o.alive || o.kind === 'dummy') continue;
      const d = vdist(o.pos, f.pos);
      if (d > 80) continue;
      const tracked = o.id === this.targetId && this.visible;
      const yawTo_ = yawTo(o.pos.x - eye.x, o.pos.z - eye.z);
      const inFov = Math.abs(angleDiff(yawTo_, fwdYaw)) < this.diff.fovHalf || d < 3.5 || tracked;
      if (!inFov) continue;
      const head = v3(o.pos.x, o.pos.y + o.height - 0.2, o.pos.z);
      if (!ctx.world.los(eye, chestPos(o)) && !ctx.world.los(eye, head)) continue;
      let score = d;
      if (o.id === this.targetId) score -= 10;
      if (o.id === f.lastAttacker && ctx.time - f.lastDamageTime < 3) score -= 8;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    const wasVisible = this.visible;
    if (best) {
      const newTarget = best.id !== this.targetId;
      const recentlySeen = !newTarget && ctx.time - this.lastSeenTime < 1.2;
      if (newTarget || !wasVisible) {
        const [lo, hi] = this.diff.reaction;
        const rt = lo + (hi - lo) * this.rng();
        this.reactLeft = recentlySeen ? rt * 0.5 : rt;
        if (newTarget) this.seenFor = 0;
        this.aimHead = this.rng() < this.diff.headChance;
      }
      this.targetId = best.id;
      this.visible = true;
    } else {
      this.visible = false;
    }
  }

  think(ctx: SimContext, dt: number): InputCommand {
    const f = this.f;
    const cmd = emptyCommand();
    this.stateTime += dt;

    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.08 + this.rng() * 0.04;
      this.sense(ctx);
    }
    let tgt = this.target(ctx);
    if (!tgt) {
      this.visible = false;
      if (this.targetId >= 0) {
        this.targetId = -1;
        this.lastSeen = null;
      }
    }
    if (this.visible && tgt) {
      this.seenFor += dt;
      this.reactLeft -= dt;
      this.lastSeen = vclone(tgt.pos);
      this.lastSeenTime = ctx.time;
    } else {
      this.seenFor = Math.max(0, this.seenFor - dt * 1.5);
    }

    const hpFrac = f.hp / f.maxHp;
    const slot = f.weapons[f.cur];
    const def = WEAPONS[slot.id];
    const reloading = f.reloadTimer > 0;

    // ---------------- transitions ----------------
    switch (this.state) {
      case 'patrol':
        if (this.visible) this.setState('engage');
        else if (this.heard && ctx.time - this.heardTime < 4) this.setState('investigate');
        break;
      case 'investigate':
        if (this.visible) this.setState('engage');
        else if ((this.arrived() && this.stateTime > 0.5 && this.lookAround > 1.6) || this.stateTime > 14) {
          this.heard = null;
          this.setState('patrol');
        }
        break;
      case 'engage':
        if (!tgt && !this.lastSeen) this.setState('patrol');
        else if (hpFrac < this.diff.retreatAt && this.rng() < dt * 3 * (1.2 - this.diff.aggression)) this.setState('retreat');
        else if (reloading && hpFrac < 0.75 && this.visible && vdist(f.pos, tgt!.pos) > 6) this.setState('cover');
        else if (!this.visible && ctx.time - this.lastSeenTime > 1.1) {
          this.setState(this.rng() < this.diff.aggression ? 'flank' : 'investigate');
          if ((this.state as BotState) === 'investigate' && this.lastSeen) {
            this.heard = vclone(this.lastSeen);
            this.heardTime = ctx.time;
          }
        }
        break;
      case 'cover':
        if ((this.arrived() && !reloading && this.stateTime > 0.8) || this.stateTime > 6) {
          if (this.lastSeen) {
            this.heard = vclone(this.lastSeen);
            this.heardTime = ctx.time;
          }
          this.setState(this.visible ? 'engage' : 'investigate');
        }
        break;
      case 'flank':
        if (this.visible && this.stateTime > 0.3) this.setState('engage');
        else if (this.arrived() && this.stateTime > 1) {
          if (this.lastSeen) {
            this.heard = vclone(this.lastSeen);
            this.heardTime = ctx.time;
          }
          this.setState('investigate');
        } else if (this.stateTime > 12) this.setState('patrol');
        break;
      case 'retreat':
        if (hpFrac > 0.85) this.setState('patrol');
        else if (this.visible && tgt && vdist(tgt.pos, f.pos) < 7) this.setState('engage');
        break;
    }
    tgt = this.target(ctx);

    // ---------------- movement goals ----------------
    let wishX = 0, wishZ = 0;
    let lookYaw: number | null = null;
    let jump = false;
    let crouch = false;

    const follow = () => {
      if (this.arrived()) return false;
      const node = this.nav.nodes[this.path[this.pathIdx]];
      const dx = node.x - f.pos.x, dz = node.z - f.pos.z;
      const hd = Math.hypot(dx, dz);
      if (hd < 0.75 && Math.abs(node.y - f.pos.y) < 1.4) {
        this.pathIdx++;
        return follow();
      }
      wishX = dx / hd;
      wishZ = dz / hd;
      const prev = this.pathIdx > 0 ? this.path[this.pathIdx - 1] : this.nav.nearest(f.pos);
      if ((this.nav.edgeIsJump(prev, this.path[this.pathIdx]) || node.y - f.pos.y > 0.6) && hd < 2.2) jump = true;
      return true;
    };

    const randomGoal = () => {
      for (let i = 0; i < 6; i++) {
        const n = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
        if (n.edges.length && Math.hypot(n.x - f.pos.x, n.z - f.pos.z) > 15) {
          this.goTo(v3(n.x, n.y, n.z));
          return;
        }
      }
    };

    switch (this.state) {
      case 'patrol': {
        if (this.arrived() || !this.goal) randomGoal();
        follow();
        // occasional bhop on long straightaways (hard+)
        if (this.diff.jumpRate > 0.25 && this.rng() < dt * this.diff.jumpRate) jump = true;
        break;
      }
      case 'investigate': {
        if (!this.goal && this.heard) this.goTo(this.heard);
        if (!follow()) {
          this.lookAround += dt;
          lookYaw = this.aimYaw + dt * 2.5;
        } else this.lookAround = 0;
        break;
      }
      case 'engage': {
        if (tgt && this.visible) {
          const d = vdist(tgt.pos, f.pos);
          const toX = (tgt.pos.x - f.pos.x) / Math.max(d, 0.01);
          const toZ = (tgt.pos.z - f.pos.z) / Math.max(d, 0.01);
          // strafe (perpendicular) with random direction changes
          this.strafeTimer -= dt;
          if (this.strafeTimer <= 0) {
            this.strafeTimer = 0.35 + this.rng() * 0.7;
            if (this.rng() < 0.7) this.strafeDir = -this.strafeDir;
            this.moveBias = this.rng() * 2 - 1;
          }
          const s = this.diff.strafe * this.strafeDir;
          wishX = -toZ * s;
          wishZ = toX * s;
          // range control
          const melee = slot.id === 'melee';
          const ideal = melee ? 0 : 11 + (1 - this.diff.aggression) * 8;
          let push = clamp((d - ideal) / 6, -1, 1) * 0.8 + this.moveBias * 0.25;
          if (melee) push = 1;
          wishX += toX * push;
          wishZ += toZ * push;
          if (this.rng() < dt * this.diff.jumpRate) jump = true;
          if (this.diff.strafe > 0.8 && this.rng() < dt * 0.25 && f.onGround && Math.hypot(f.vel.x, f.vel.z) > 6) crouch = true;
        } else if (this.lastSeen) {
          if (!this.goal) this.goTo(this.lastSeen);
          follow();
        }
        break;
      }
      case 'cover': {
        if (!this.goal) this.pickCover(ctx, tgt);
        follow();
        crouch = this.arrived() && reloading;
        break;
      }
      case 'flank': {
        if (!this.goal) this.pickFlank();
        follow();
        break;
      }
      case 'retreat': {
        if (!this.goal) this.pickRetreat(ctx, tgt);
        if (!follow() && this.stateTime > 2) this.pickRetreat(ctx, tgt);
        break;
      }
    }

    // periodic repath (targets move)
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 && this.goal) {
      if ((this.state === 'engage' || this.state === 'investigate') && this.lastSeen && !this.visible) this.goTo(this.lastSeen);
      else this.repathTimer = 2;
    }

    // stuck detection
    this.stuckCheck -= dt;
    if (this.stuckCheck <= 0) {
      this.stuckCheck = 0.5;
      const moved = vdistH(f.pos, this.lastCheckPos);
      const wantsMove = Math.hypot(wishX, wishZ) > 0.3;
      if (wantsMove && moved < 0.5) this.stuckTime += 0.5;
      else this.stuckTime = 0;
      this.lastCheckPos = vclone(f.pos);
      if (this.stuckTime >= 1) jump = true;
      if (this.stuckTime >= 1) this.strafeDir = -this.strafeDir;
      if (this.stuckTime >= 2) {
        this.stuckTime = 0;
        this.path = [];
        this.goal = null;
      }
    }

    // ---------------- aim ----------------
    const eye = eyePos(f);
    let desiredYaw = this.aimYaw;
    let desiredPitch = 0;
    let onTarget = false;
    let dist = 99;
    if (tgt && this.visible) {
      dist = vdist(tgt.pos, f.pos);
      const hy = this.aimHead ? tgt.height - 0.2 : tgt.height * 0.62;
      // slight tracking lag: aim where the target was a moment ago; shrinks as they hold you
      const lag = 0.06 * Math.exp(-this.seenFor * this.diff.trackImprove);
      const px = tgt.pos.x - tgt.vel.x * lag, py = tgt.pos.y + hy - tgt.vel.y * lag * 0.5, pz = tgt.pos.z - tgt.vel.z * lag;
      const dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
      const trueYaw = yawTo(dx, dz);
      const truePitch = pitchTo(dy, Math.hypot(dx, dz));
      // aim error that shrinks the longer they hold you
      this.errTimer -= dt;
      const errMag = this.diff.aimError * (0.25 + 0.75 * Math.exp(-this.seenFor * this.diff.trackImprove));
      if (this.errTimer <= 0) {
        this.errTimer = 0.2 + this.rng() * 0.25;
        this.errTX = (this.rng() * 2 - 1) * errMag;
        this.errTY = (this.rng() * 2 - 1) * errMag * 0.6;
      }
      const k = 1 - Math.exp(-8 * dt);
      this.errX += (this.errTX - this.errX) * k;
      this.errY += (this.errTY - this.errY) * k;
      desiredYaw = trueYaw + this.errX;
      desiredPitch = truePitch + this.errY;
      const tol = Math.max(0.035, Math.atan2(0.3, dist)) + errMag * 0.5;
      onTarget = Math.abs(angleDiff(this.aimYaw, trueYaw)) < tol && Math.abs(this.aimPitch - truePitch) < tol;
    } else if (lookYaw !== null) {
      desiredYaw = lookYaw;
    } else if (Math.hypot(wishX, wishZ) > 0.1) {
      desiredYaw = yawTo(wishX, wishZ);
      if (this.lastSeen && ctx.time - this.lastSeenTime < 3 && this.state !== 'retreat') {
        desiredYaw = yawTo(this.lastSeen.x - eye.x, this.lastSeen.z - eye.z); // pre-aim
      }
    }
    const turn = 1 - Math.exp(-this.diff.turnSpeed * dt * (this.visible ? 1 : 0.6));
    this.aimYaw += angleDiff(desiredYaw, this.aimYaw) * turn;
    this.aimPitch += (desiredPitch - this.aimPitch) * turn;

    // ---------------- weapons ----------------
    let fire = false;
    if (this.burstPause > 0) this.burstPause -= dt;
    if (tgt && this.visible && this.reactLeft <= 0 && onTarget) {
      if (slot.id === 'melee') fire = dist < 2.6;
      else if (slot.id === 'pistol') fire = f.fireCooldown <= 1e-6 && this.rng() < 0.35;
      else if (this.burstPause <= 0) {
        fire = true;
        if (f.fireCooldown <= 1e-6 && slot.mag > 0) {
          this.burstLeft--;
          if (this.burstLeft <= 0) {
            const close = dist < 12;
            this.burstPause = close ? 0.05 : 0.16 + this.rng() * 0.2;
            this.burstLeft = close ? 10 : 3 + Math.floor(this.rng() * 5);
          }
        }
      }
    }

    // weapon selection
    if (tgt && this.visible && dist < 2.8) this.wantSlot = 2;
    else if (tgt && this.visible && slot.id === 'ar' && slot.mag === 0 && f.weapons[1].mag > 0 && dist < 18) this.wantSlot = 1;
    else if (slot.id === 'melee' && (!this.visible || dist > 5)) this.wantSlot = 0;
    else if (slot.id === 'pistol' && !this.visible && f.weapons[0].mag > 0) this.wantSlot = 0;
    else if (slot.id === 'pistol' && slot.mag === 0) this.wantSlot = 0;
    cmd.slot = this.wantSlot !== f.cur ? this.wantSlot : -1;

    let reload = false;
    if (def.kind === 'hitscan' && !reloading && !this.visible && slot.mag < def.magSize * 0.6) reload = true;

    // ---------------- build command ----------------
    cmd.yaw = this.aimYaw - f.recoilYaw * this.diff.recoilComp;
    cmd.pitch = clamp(this.aimPitch - f.recoilPitch * this.diff.recoilComp, -1.5, 1.5);
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0.05) {
      const nx = wishX / Math.max(wl, 1), nz = wishZ / Math.max(wl, 1);
      const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
      cmd.forward = clamp(-sy * nx - cy * nz, -1, 1);
      cmd.strafe = clamp(cy * nx - sy * nz, -1, 1);
    }
    if (jump) cmd.buttons |= BTN.JUMP;
    if (crouch) cmd.buttons |= BTN.CROUCH;
    if (fire) cmd.buttons |= BTN.FIRE;
    if (reload) cmd.buttons |= BTN.RELOAD;
    // semi-auto needs a fresh press each shot
    if (slot.id === 'pistol' && fire && f.prevButtons & BTN.FIRE) cmd.buttons &= ~BTN.FIRE;
    return cmd;
  }

  private pickCover(ctx: SimContext, tgt: Fighter | null) {
    const f = this.f;
    const threat = tgt ? eyePos(tgt) : this.lastSeen ? v3(this.lastSeen.x, this.lastSeen.y + 1.6, this.lastSeen.z) : null;
    if (!threat) return;
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < 60; i++) {
      const n = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
      const d = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
      if (d > 14 || d < 2) continue;
      const p = v3(n.x, n.y + 1.2, n.z);
      if (ctx.world.los(threat, p)) continue;
      const toThreat = Math.hypot(n.x - threat.x, n.z - threat.z);
      const score = d - toThreat * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = v3(n.x, n.y, n.z);
      }
    }
    if (best) this.goTo(best);
    else this.pickRetreat(ctx, tgt);
  }

  private pickFlank() {
    const f = this.f;
    const ls = this.lastSeen;
    if (!ls) return;
    const dx = ls.x - f.pos.x, dz = ls.z - f.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const side = this.rng() < 0.5 ? -1 : 1;
    const off = 9 + this.rng() * 5;
    const p = v3(ls.x - (dz / d) * off * side - (dx / d) * 3, ls.y, ls.z + (dx / d) * off * side - (dz / d) * 3);
    this.goTo(p);
  }

  private pickRetreat(ctx: SimContext, tgt: Fighter | null) {
    const f = this.f;
    const from = tgt ? tgt.pos : this.lastSeen ?? f.pos;
    let best: Vec3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const n = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
      const d = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
      if (d > 30) continue;
      const away = Math.hypot(n.x - from.x, n.z - from.z);
      const hidden = !ctx.world.los(v3(from.x, from.y + 1.6, from.z), v3(n.x, n.y + 1.2, n.z));
      const score = away - d * 0.4 + (hidden ? 15 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = v3(n.x, n.y, n.z);
      }
    }
    if (best) this.goTo(best);
  }
}
