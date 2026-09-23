import type { DifficultyDef } from '../config/difficulty';
import { WEAPONS } from '../config/weapons';
import { buildSkeleton, createSkeleton } from './body';
import type { SimContext } from './context';
import { eyePos, type Fighter } from './fighter';
import type { NavGraph } from './nav';
import { BTN, emptyCommand, type InputCommand } from './types';
import { angleDiff, clamp, pitchTo, v3, vclone, vdist, vdistH, yawTo, type Vec3 } from './vec';
import { boltCycling } from './weaponsim';

export type BotState = 'patrol' | 'investigate' | 'engage' | 'cover' | 'flank' | 'retreat';

const skel = createSkeleton();

/**
 * Bot brain. It perceives the world the way a player would (line of sight, a view cone, hearing,
 * damage) and outputs one InputCommand per tick, so bots run through the exact same movement and
 * weapon rules as humans. Difficulty only changes perception, reaction, aim and decisions.
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
  /** continuous tracking time on the current target (drives aim settle) */
  holdTime = 0;
  reactLeft = 0;
  lastSeen: Vec3 | null = null;
  lastSeenTime = -99;
  lastLostTime = -99;
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
  planted = false;
  senseTimer = 0;
  stuckCheck = 0;
  stuckTime = 0;
  lastCheckPos: Vec3 = v3();
  burstLeft = 3;
  burstPause = 0;
  hadToken = false;
  useAds = false;
  private countedShot = -99;
  /** the bot's (lagging) estimate of the target's velocity */
  private estVel: Vec3 = v3();
  /** previous perceived target line, for smooth-pursuit feed-forward */
  private prevLineYaw = NaN;
  private prevLinePitch = NaN;
  lookAround = 0;
  wantSlot = 0;
  scopeHold = 0;

  constructor(
    private f: Fighter,
    private diff: DifficultyDef,
    private nav: NavGraph,
    private rng: () => number,
  ) {
    this.aimYaw = f.yaw;
  }

  private rand(lo: number, hi: number) {
    return lo + (hi - lo) * this.rng();
  }

  reset() {
    this.state = 'patrol';
    this.stateTime = 0;
    this.targetId = -1;
    this.visible = false;
    this.holdTime = 0;
    this.lastSeen = null;
    this.path = [];
    this.goal = null;
    this.heard = null;
    this.aimYaw = this.f.yaw;
    this.aimPitch = 0;
    this.wantSlot = 0;
    this.hadToken = false;
    this.planted = false;
    this.burstPause = 0;
  }

  private setState(s: BotState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    this.path = [];
    this.goal = null;
  }

  /** Gunfire / footsteps. Heard positions are approximate (no wallhack-precision). */
  hear(src: Fighter, time: number, loud: number) {
    const d = vdist(src.pos, this.f.pos);
    if (d > this.diff.hearing * loud) return;
    const n = this.diff.hearingNoise;
    this.heard = v3(src.pos.x + this.rand(-n, n), src.pos.y, src.pos.z + this.rand(-n, n));
    this.heardTime = time;
  }

  /** Getting hit tells you roughly where it came from - not an exact, continuous track. */
  onDamaged(attacker: Fighter, time: number) {
    if (attacker === this.f) return;
    if (!this.visible || this.targetId !== attacker.id) {
      const n = this.diff.hearingNoise * 0.5;
      this.heard = v3(attacker.pos.x + this.rand(-n, n), attacker.pos.y, attacker.pos.z + this.rand(-n, n));
      this.heardTime = time;
      const e = eyePos(this.f);
      const desired = yawTo(this.heard.x - e.x, this.heard.z - e.z);
      this.aimYaw += angleDiff(desired, this.aimYaw) * 0.35; // flinch toward the pain, not a snap
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

  /** Genuine detection: inside the view cone (or very close / just shot us) AND line of sight. */
  private sense(ctx: SimContext) {
    const f = this.f;
    const eye = eyePos(f);
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const o of ctx.fighters) {
      if (o === f || !o.alive || o.kind === 'dummy' || o.spawnProtect > 0) continue;
      const d = vdist(o.pos, f.pos);
      if (d > 80) continue;
      const tracked = o.id === this.targetId && this.visible;
      const ang = Math.abs(angleDiff(yawTo(o.pos.x - eye.x, o.pos.z - eye.z), f.yaw));
      const shotUs = o.id === f.lastAttacker && ctx.time - f.lastDamageTime < 1.2;
      const inView = ang < this.diff.fovHalf || d < 3.5 || (tracked && ang < 1.6) || (shotUs && ang < 1.9);
      if (!inView) continue;
      buildSkeleton(o, o.weapons[o.cur].id, skel);
      if (!ctx.world.los(eye, skel.head) && !ctx.world.los(eye, skel.chest) && !ctx.world.los(eye, skel.pelvis)) continue;
      let score = d;
      if (o.id === this.targetId) score -= 10;
      if (shotUs) score -= 8;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    const wasVisible = this.visible;
    if (best) {
      const newTarget = best.id !== this.targetId;
      if (newTarget || !wasVisible) {
        const recent = !newTarget && ctx.time - this.lastLostTime < this.diff.memory;
        const rt = this.rand(this.diff.reaction[0], this.diff.reaction[1]);
        this.reactLeft = recent ? rt * this.diff.reacquire : rt;
        this.holdTime = recent ? this.holdTime * 0.5 : 0;
        this.aimHead = this.rng() < this.diff.headChance;
        this.useAds = this.rng() < this.diff.adsChance;
        if (newTarget) this.estVel = v3();
        this.prevLineYaw = NaN;
        this.burstPause = 0;
        this.errTimer = 0;
      }
      this.targetId = best.id;
      this.visible = true;
    } else {
      if (wasVisible) this.lastLostTime = ctx.time;
      this.visible = false;
    }
  }

  think(ctx: SimContext, dt: number): InputCommand {
    const f = this.f;
    const d = this.diff;
    const cmd = emptyCommand();
    this.stateTime += dt;

    this.senseTimer -= dt;
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.08 + this.rng() * 0.05;
      this.sense(ctx);
    }
    let tgt = this.target(ctx);
    if (!tgt) {
      this.visible = false;
      if (this.targetId >= 0 && !this.lastSeen) this.targetId = -1;
    }
    if (this.visible && tgt) {
      this.holdTime += dt;
      this.reactLeft -= dt;
      this.lastSeen = vclone(tgt.pos);
      this.lastSeenTime = ctx.time;
    } else {
      this.holdTime = Math.max(0, this.holdTime - dt);
      // memory fades: no tracking through walls beyond a brief recollection
      if (this.lastSeen && ctx.time - this.lastSeenTime > d.memory) {
        this.heard = this.heard ?? vclone(this.lastSeen);
        this.lastSeen = null;
        this.targetId = -1;
      }
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
        else if (hpFrac < d.retreatAt && this.rng() < dt * 3 * (1.2 - d.aggression)) this.setState('retreat');
        else if (reloading && hpFrac < 0.75 && this.visible && tgt && vdist(f.pos, tgt.pos) > 6) this.setState('cover');
        else if (!this.visible && ctx.time - this.lastSeenTime > 1.1) {
          const ls = this.lastSeen;
          this.setState(this.rng() < d.aggression ? 'flank' : 'investigate');
          if (this.state === ('investigate' as BotState) && ls) {
            this.heard = vclone(ls);
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
        else if ((this.arrived() && this.stateTime > 1) || !this.lastSeen) {
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

    // ---------------- movement ----------------
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

    const sniper = slot.id === 'sniper';
    switch (this.state) {
      case 'patrol': {
        if (this.arrived() || !this.goal) randomGoal();
        follow();
        if (d.jumpRate > 0.2 && this.rng() < dt * d.jumpRate) jump = true;
        break;
      }
      case 'investigate': {
        if (!this.goal && this.heard) this.goTo(this.heard);
        if (!follow()) {
          this.lookAround += dt;
          lookYaw = this.aimYaw + dt * 2.2;
        } else this.lookAround = 0;
        break;
      }
      case 'engage': {
        if (tgt && this.visible) {
          const dist = vdist(tgt.pos, f.pos);
          const toX = (tgt.pos.x - f.pos.x) / Math.max(dist, 0.01);
          const toZ = (tgt.pos.z - f.pos.z) / Math.max(dist, 0.01);
          this.strafeTimer -= dt;
          if (this.strafeTimer <= 0) {
            this.strafeTimer = 0.4 + this.rng() * 0.8;
            if (this.rng() < 0.65) this.strafeDir = -this.strafeDir;
            this.moveBias = this.rng() * 2 - 1;
          }
          const planted = this.planted || (sniper && f.ads > 0.5) || (this.useAds && f.ads > 0.5 && this.rng() < 0.02);
          const s = planted ? 0 : d.strafe * this.strafeDir;
          wishX = -toZ * s;
          wishZ = toX * s;
          const melee = slot.id === 'melee';
          const ideal = melee ? 0 : sniper ? 24 : 11 + (1 - d.aggression) * 8;
          let push = planted ? 0 : clamp((dist - ideal) / 6, -1, 1) * 0.8 + this.moveBias * 0.25;
          if (melee) push = 1;
          wishX += toX * push;
          wishZ += toZ * push;
          if (!planted && this.rng() < dt * d.jumpRate) jump = true;
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
      if (this.stuckTime >= 1) {
        jump = true;
        this.strafeDir = -this.strafeDir;
      }
      if (this.stuckTime >= 2) {
        this.stuckTime = 0;
        this.path = [];
        this.goal = null;
      }
    }

    // ---------------- aim: consistent wander error + tracking lag ----------------
    const eye = eyePos(f);
    let desiredYaw = this.aimYaw;
    let desiredPitch = 0;
    let onTarget = false;
    let dist = 99;
    let ffYaw = 0, ffPitch = 0;
    if (tgt && this.visible) {
      dist = vdist(tgt.pos, f.pos);
      buildSkeleton(tgt, tgt.weapons[tgt.cur].id, skel);
      // a point on the torso (difficulty decides how high) or the head
      const h = d.aimHeight;
      const aimPt = this.aimHead
        ? skel.head
        : v3(skel.pelvis.x + (skel.chest.x - skel.pelvis.x) * h, skel.pelvis.y + (skel.chest.y - skel.pelvis.y) * h, skel.pelvis.z + (skel.chest.z - skel.pelvis.z) * h);
      // human-like tracking: a delayed read of where you are, extrapolated with a velocity estimate that
      // adapts slowly. Constant motion is tracked well; reversing direction makes them overshoot.
      const va = 1 - Math.exp(-dt / d.velAdapt);
      this.estVel.x += (tgt.vel.x - this.estVel.x) * va;
      this.estVel.y += (tgt.vel.y - this.estVel.y) * va;
      this.estVel.z += (tgt.vel.z - this.estVel.z) * va;
      const lag = d.trackLag;
      const px = aimPt.x + (this.estVel.x - tgt.vel.x) * lag;
      const py = aimPt.y + (this.estVel.y - tgt.vel.y) * lag * 0.5;
      const pz = aimPt.z + (this.estVel.z - tgt.vel.z) * lag;
      const dx = px - eye.x, dy = py - eye.y, dz = pz - eye.z;
      const trueYaw = yawTo(dx, dz);
      const truePitch = pitchTo(dy, Math.hypot(dx, dz));
      // wander error: smooth, shrinks toward a floor the longer they hold you, grows while they move
      const ownSpeed = Math.hypot(f.vel.x, f.vel.z);
      const amp =
        d.aimError * (d.aimErrorFloor + (1 - d.aimErrorFloor) * Math.exp(-this.holdTime / d.errorSettle)) * (1 + 0.4 * Math.min(ownSpeed / 8, 1));
      this.errTimer -= dt;
      if (this.errTimer <= 0) {
        this.errTimer = 0.35 + this.rng() * 0.3;
        this.errTX = (this.rng() * 2 - 1) * amp;
        // misses are mostly sideways (lagging a strafer), rarely high: hits favour the torso
        this.errTY = (this.rng() * 2 - 1) * amp * 0.22;
      }
      const k = 1 - Math.exp(-6 * dt);
      this.errX += (this.errTX - this.errX) * k;
      this.errY += (this.errTY - this.errY) * k;
      desiredYaw = trueYaw + this.errX;
      desiredPitch = truePitch + this.errY;
      // smooth pursuit: follow the perceived target line's own motion (no constant trailing lag)
      if (!Number.isNaN(this.prevLineYaw) && this.reactLeft < 0.1) {
        ffYaw = angleDiff(trueYaw, this.prevLineYaw);
        ffPitch = truePitch - this.prevLinePitch;
      }
      this.prevLineYaw = trueYaw;
      this.prevLinePitch = truePitch;
      const tol = (Math.max(0.02, Math.atan2(0.28, dist)) + amp * 0.4) * d.fireTolerance;
      onTarget = Math.abs(angleDiff(this.aimYaw, trueYaw)) < tol && Math.abs(this.aimPitch - truePitch) < tol;
    } else if (lookYaw !== null) {
      desiredYaw = lookYaw;
    } else if (Math.hypot(wishX, wishZ) > 0.1) {
      desiredYaw = yawTo(wishX, wishZ);
      if (this.lastSeen && ctx.time - this.lastSeenTime < d.memory && this.state !== 'retreat') {
        desiredYaw = yawTo(this.lastSeen.x - eye.x, this.lastSeen.z - eye.z); // pre-aim where they were
      }
    }
    const follow_ = 1 - Math.exp(-d.turnSmooth * dt);
    const maxTurn = d.turnRate * dt * (this.visible ? 1 : 0.8);
    this.aimYaw += clamp(ffYaw + angleDiff(desiredYaw, this.aimYaw) * follow_, -maxTurn, maxTurn);
    this.aimPitch += clamp(ffPitch + (desiredPitch - this.aimPitch) * follow_, -maxTurn, maxTurn);
    if (!this.visible) this.prevLineYaw = NaN;

    // ---------------- permission + trigger discipline ----------------
    let allowed = true;
    if (tgt && this.visible) {
      allowed = ctx.requestAttack ? ctx.requestAttack(f, tgt) : true;
      if (allowed && !this.hadToken) this.reactLeft = Math.max(this.reactLeft, d.tokenDelay);
      this.hadToken = allowed;
    } else this.hadToken = false;

    let fire = false;
    let ads = false;
    if (this.burstPause > 0) this.burstPause -= dt;
    // count real shots (the weapon may fire later in the tick than this brain runs)
    if (f.lastShotTime > this.countedShot) {
      this.countedShot = f.lastShotTime;
      if (slot.id === 'ar') {
        this.burstLeft--;
        if (this.burstLeft <= 0) {
          const close = tgt && this.visible && vdist(tgt.pos, f.pos) < 6;
          this.burstPause = this.rand(d.burstPause[0], d.burstPause[1]) * (close ? 0.5 : 1);
          this.burstLeft = Math.max(1, Math.round(this.rand(d.burst[0], d.burst[1])));
          this.planted = this.rng() < d.plantChance;
        }
      } else if (slot.id === 'pistol') {
        this.burstPause = this.rand(0.14, 0.3) * (1 + d.burstPause[0]);
      }
    }
    const canShoot = tgt && this.visible && allowed && this.reactLeft <= 0;
    if (sniper && tgt && this.visible && dist > 7 && !reloading) {
      // quickscope rhythm: raise, settle, fire; the bolt pulls them off the scope
      ads = !boltCycling(f);
      if (f.ads >= 0.95) this.scopeHold += dt;
      else this.scopeHold = 0;
      fire = !!canShoot && onTarget && this.scopeHold >= d.sniperSettle && slot.boltLeft <= 0 && f.fireCooldown <= 1e-6;
    } else if (canShoot && onTarget) {
      ads = this.useAds && dist > 8 && slot.id !== 'melee';
      if (slot.id === 'melee') fire = dist < 2.6;
      else fire = this.burstPause <= 0;
    }
    if (!this.visible) this.planted = false;
    // keep the sights up between bursts while the target is still in view
    if (!ads && this.useAds && tgt && this.visible && dist > 8 && slot.id !== 'melee' && slot.id !== 'sniper' && !reloading) ads = true;

    // ---------------- weapon selection ----------------
    const hasSniper = f.weapons.findIndex((w) => w.id === 'sniper');
    const primaryIdx = 0;
    const pistolIdx = f.weapons.findIndex((w) => w.id === 'pistol');
    const meleeIdx = f.weapons.findIndex((w) => w.id === 'melee');
    if (tgt && this.visible && dist < 2.8 && meleeIdx >= 0) this.wantSlot = meleeIdx;
    else if (tgt && this.visible && hasSniper >= 0 && dist < 7 && pistolIdx >= 0) this.wantSlot = pistolIdx;
    else if (tgt && this.visible && slot.id === 'ar' && slot.mag === 0 && f.weapons[pistolIdx]?.mag > 0 && dist < 18) this.wantSlot = pistolIdx;
    else if (slot.id === 'melee' && (!this.visible || dist > 5)) this.wantSlot = primaryIdx;
    else if (slot.id === 'pistol' && !this.visible && f.weapons[primaryIdx].mag > 0) this.wantSlot = primaryIdx;
    else if (slot.id === 'pistol' && slot.mag === 0) this.wantSlot = primaryIdx;
    else if (slot.id === 'pistol' && hasSniper >= 0 && this.visible && dist > 10) this.wantSlot = primaryIdx;
    cmd.slot = this.wantSlot !== f.cur ? this.wantSlot : -1;

    let reload = false;
    if (def.kind === 'hitscan' && !reloading && !this.visible && slot.mag < def.magSize * 0.6) reload = true;

    // ---------------- build command ----------------
    cmd.yaw = this.aimYaw - f.recoilYaw * d.recoilComp;
    cmd.pitch = clamp(this.aimPitch - f.recoilPitch * d.recoilComp, -1.5, 1.5);
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
    if (ads) cmd.buttons |= BTN.ADS;
    if (reload) cmd.buttons |= BTN.RELOAD;
    // semi-auto weapons need a fresh press each shot
    if (!def.auto && fire && f.prevButtons & BTN.FIRE) cmd.buttons &= ~BTN.FIRE;
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
      const dd = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
      if (dd > 14 || dd < 2) continue;
      const p = v3(n.x, n.y + 1.2, n.z);
      if (ctx.world.los(threat, p)) continue;
      const toThreat = Math.hypot(n.x - threat.x, n.z - threat.z);
      const score = dd - toThreat * 0.3;
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
    const dd = Math.hypot(dx, dz) || 1;
    const side = this.rng() < 0.5 ? -1 : 1;
    const off = 9 + this.rng() * 5;
    this.goTo(v3(ls.x - (dz / dd) * off * side - (dx / dd) * 3, ls.y, ls.z + (dx / dd) * off * side - (dz / dd) * 3));
  }

  private pickRetreat(ctx: SimContext, tgt: Fighter | null) {
    const f = this.f;
    const from = tgt ? tgt.pos : this.lastSeen ?? f.pos;
    let best: Vec3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const n = this.nav.nodes[Math.floor(this.rng() * this.nav.nodes.length)];
      const dd = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
      if (dd > 30) continue;
      const away = Math.hypot(n.x - from.x, n.z - from.z);
      const hidden = !ctx.world.los(v3(from.x, from.y + 1.6, from.z), v3(n.x, n.y + 1.2, n.z));
      const score = away - dd * 0.4 + (hidden ? 15 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = v3(n.x, n.y, n.z);
      }
    }
    if (best) this.goTo(best);
  }
}
