import * as THREE from 'three';
import { MOVE } from '../../config/movement';
import { WEAPONS } from '../../config/weapons';
import { BODY, buildSkeleton, createSkeleton, gaitDuty, ik, strideLength, type BodyState, type Skeleton } from '../../sim/body';
import type { Fighter } from '../../sim/fighter';
import type { WeaponId } from '../../sim/types';
import type { Vec3 } from '../../sim/vec';
import type { World } from '../../sim/world';
import { HOLDS } from './holds';
import { cd1, cd3, cdAngle, clamp, s1, smooth01, spring1, spring3, wrapAngle } from './spring';

// ============================================================================
//  Presentation animation for one stick fighter.
//
//    authoritative skeleton (sim/body.ts, hitboxes)       ── read only
//        ↓ target
//    locomotion layer   world-planted feet, pelvis bob/sway/twist, lean from
//                       acceleration, turn-in-place, jump push-off, landing
//        ↓
//    aim / action layer spine pitch share, shoulder-anchored weapon with sway,
//                       recoil, draw, reload, bolt, sprint carry, melee arcs
//        ↓
//    IK + secondary     two-bone IK with pole vectors, shoulder reach,
//                       pelvis drop for reach, hit springs, headband tails
//        ↓
//    render skeleton    same joint names as the sim skeleton, so wounds,
//                       ragdolls and effects keep working
//
//  Nothing here feeds back into the sim. All state is preallocated.
// ============================================================================

/** Visual proportions of the stick figure (heights shared with the sim skeleton). */
export const STICK = {
  shoulderW: 0.15,
  hipW: 0.075,
  headR: 0.19,
  spineR: 0.05,
  armR: 0.036,
  legR: 0.042,
  handR: 0.048,
  footR: 0.036,
  legReach: BODY.thigh + BODY.shin - 0.01,
  armReach: BODY.upperArm + BODY.forearm - 0.006,
};

const V = () => new THREE.Vector3();

/** joints compared against the hitbox skeleton (damage-bearing ones; feet planted by design) */
const DEV_JOINTS = ['head', 'chest', 'pelvis', 'lShoulder', 'rShoulder', 'lHand', 'rHand', 'lKnee', 'rKnee'] as const;

/** Longest ground distance one stance may cover (m): the leg reaches +-0.36 around the hip. */
const STANCE_SPAN = 0.72;

const enum FootMode {
  Planted,
  Swing,
  Free,
}

interface Foot {
  side: -1 | 1;
  mode: FootMode;
  /** swing driven by gait phase (true) or by its own clock (idle steps, stop settling) */
  phased: boolean;
  plant: THREE.Vector3;
  from: THREE.Vector3;
  target: THREE.Vector3;
  out: THREE.Vector3;
  prevOut: THREE.Vector3;
  off: THREE.Vector3;
  offV: THREE.Vector3;
  inert: THREE.Vector3;
  yaw: number;
  fromYaw: number;
  targetYaw: number;
  s: number;
  u0: number;
  groundY: number;
  toePitch: number;
  /** debug: where this foot wants to be */
  goal: THREE.Vector3;
  /** freshly predicted touchdown; `target` chases it at a bounded speed, then commits near landing */
  pred: THREE.Vector3;
  /** swing endpoints relative to the body (x/z), and the swing's duration in seconds */
  fromRel: THREE.Vector3;
  toRel: THREE.Vector3;
  swingT: number;
  /** post-IK distance between where the foot should be and where the leg actually put it */
  ikErr: number;
}

function mkFoot(side: -1 | 1): Foot {
  return {
    side, mode: FootMode.Planted, phased: false,
    plant: V(), from: V(), target: V(), out: V(), prevOut: V(), off: V(), offV: V(), inert: V(), goal: V(), pred: V(), fromRel: V(), toRel: V(), swingT: 0.16, ikErr: 0,
    yaw: 0, fromYaw: 0, targetYaw: 0, s: 0, u0: 0, groundY: 0, toePitch: 0,
  };
}

/** Mutable interpolated view of a fighter, the input to both skeletons. */
export interface AnimView extends BodyState {
  alive: boolean;
  /** collision-resolved travel speed from the sim (m/s) */
  travelSpeed?: number;
}

// scratch
const t1 = V(), t2 = V(), t3 = V(), t4 = V();
const PEL = V(), LEANH = V();
const restX = [0, 0], restZ = [0, 0], restYaw = [0, 0];
const A = V(), U = V(), R = V(), F = V(), PR = V(), PF = V(), UR = V();
const qA = new THREE.Quaternion(), qO = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const up = new THREE.Vector3(0, 1, 0);

function setV(o: Vec3, p: THREE.Vector3) {
  o.x = p.x;
  o.y = p.y;
  o.z = p.z;
}

export class StickAnim {
  readonly auth: Skeleton = createSkeleton();
  readonly pose: Skeleton = createSkeleton();
  readonly spineMid = V();
  readonly gunPos = V();
  readonly gunQuat = new THREE.Quaternion();
  showGun = true;
  /** debug: IK goals for the hands */
  readonly handGoalR = V();
  readonly handGoalL = V();
  readonly feet: [Foot, Foot] = [mkFoot(-1), mkFoot(1)];
  /** headband tails: 2 tails x 3 points (point 0 is the knot) */
  readonly tails = [
    [V(), V(), V()],
    [V(), V(), V()],
  ];
  private tailsPrev = [
    [V(), V(), V()],
    [V(), V(), V()],
  ];
  readonly headQuat = new THREE.Quaternion();
  state = 'idle';
  /** one-shot presentation cues this frame (renderer turns them into marker smears): 0 = none */
  cue = 0;
  cueStrength = 0;
  private wasSliding = false;
  private fastT = -9;
  private stopArmed = false;

  private init = false;
  private lastPos = V();
  private sv = V();
  private sa = V();
  private pelvisH = s1(BODY.pelvisY);
  private pelvisDrop = s1(0);
  private pelvisYaw = s1(0);
  private turning = false;
  private land = s1(0);
  private lean = V();
  private leanV = V();
  private hit = V();
  private hitV = V();
  private swayYaw = s1(0);
  private swayPitch = s1(0);
  private lastYaw = 0;
  private lastPitch = 0;
  private sprint = s1(0);
  private adsS = s1(0);
  private grounded = true;
  private airT = 0;
  private lastLand = -99;
  private moving = false;
  private breath = Math.random() * 10;
  private stepCooldown = 0;
  private yawFollow = false;
  private yawInert = 0;
  private lastLowerYaw = 0;
  private contactTimes: number[] = [];
  private clock = 0;
  /** diagnostics for the debug panel and capture harness */
  readonly diag = { cadence: 0, plantError: 0, twist: 0, travel: 0, stance: '--', jointDev: 0, jointDevName: '' };
  /** max post-IK plant error this frame (m) */
  plantError = 0;

  /** kick the upper body away from a hit (world direction) */
  hurt(dx: number, dz: number, strength = 1) {
    this.hitV.x += dx * 2.4 * strength;
    this.hitV.z += dz * 2.4 * strength;
    this.hitV.y -= 0.4 * strength;
  }

  reset() {
    this.init = false;
  }

  /**
   * Produce the render skeleton for this frame. `v` is the interpolated fighter view,
   * `time` the presented sim time, `dt` the (possibly slowed) presentation step.
   */
  update(f: Fighter, v: AnimView, dt: number, time: number, world: World) {
    dt = Math.min(dt, 1 / 20);
    const w = f.weapons[f.cur].id as WeaponId;
    const auth = buildSkeleton(v, w, this.auth);
    const P = this.pose;
    // legs follow collision-resolved travel (walls stop the cycle); velocity only predicts touchdowns
    const hs = v.travelSpeed ?? Math.hypot(v.vel.x, v.vel.z);
    this.clock += dt;
    const pos = t4.set(v.pos.x, v.pos.y, v.pos.z);
    if (!this.init || pos.distanceTo(this.lastPos) > 2.5) this.snap(v, world);
    this.lastPos.copy(pos);

    // ---------------- motion signals ----------------
    t1.set(v.vel.x, v.vel.y, v.vel.z);
    cd3(this.sv, this.sa, t1, 11, dt);
    const grounded = v.onGround;
    const slide = v.sliding;
    const crouch = auth.crouch;
    const speedN = Math.min(hs / MOVE.maxSpeed, 1.3);
    const runN = clamp((hs - 3) / 4.5, 0, 1);
    if (grounded && !this.grounded) this.onLand(f, v);
    if (!grounded && this.grounded && v.vel.y > 1) this.land.v -= 0.9; // push-off dip, then extension
    if (f.lastLandTime !== this.lastLand) {
      this.lastLand = f.lastLandTime;
      if (time - f.lastLandTime < 0.1) this.land.v -= Math.min(f.lastLandSpeed, 22) * 0.075;
    }
    // cues: 1 = slide start, 2 = heavy landing, 3 = hard stop (sparse; the renderer rate-limits)
    this.cue = 0;
    if (slide && !this.wasSliding) { this.cue = 1; this.cueStrength = hs; }
    else if (grounded && !this.grounded && f.lastLandSpeed > 9) { this.cue = 2; this.cueStrength = f.lastLandSpeed; }
    else if (grounded && !slide && this.stopArmed && hs < 2.5 && this.clock - this.fastT < 0.5) { this.cue = 3; this.cueStrength = 8; this.stopArmed = false; }
    if (hs > 6.5) { this.fastT = this.clock; this.stopArmed = true; }
    this.wasSliding = slide;
    this.airT = grounded ? 0 : this.airT + dt;
    this.grounded = grounded;
    spring1(this.land, 17, 0.62, dt);
    this.land.x = clamp(this.land.x, -0.3, 0.08);
    this.moving = grounded && !slide && hs > (this.moving ? 0.35 : 0.9);
    this.stepCooldown = Math.max(0, this.stepCooldown - dt);

    // ---------------- pelvis ----------------
    const aimYaw = v.yaw;
    if (this.moving || !grounded || slide) {
      // Hips follow the sim's lower-body yaw exactly (the sim already rate-limits it), so there is no
      // second damping stage. Discontinuities (leaving a turn-in-place hold, the sim's hard 80 degree
      // clamp during a sharp reversal) become an inertial offset that decays to zero.
      this.turning = false;
      if (!this.yawFollow) {
        this.yawInert = wrapAngle(this.pelvisYaw.x - v.lowerYaw);
        this.yawFollow = true;
      } else {
        const jump = wrapAngle(v.lowerYaw - this.lastLowerYaw);
        const lim = 14 * dt;
        if (Math.abs(jump) > lim) this.yawInert -= jump - clamp(jump, -lim, lim);
      }
      this.yawInert = wrapAngle(this.yawInert) * Math.exp(-14 * dt);
      let py = v.lowerYaw + this.yawInert;
      // bounded torso twist: hips never end up further than 100 degrees from the aim
      const tw = wrapAngle(py - aimYaw);
      if (Math.abs(tw) > 1.75) {
        py = aimYaw + Math.sign(tw) * 1.75;
        this.yawInert = wrapAngle(py - v.lowerYaw);
      }
      this.pelvisYaw.x = py;
      this.pelvisYaw.v = 0;
    } else {
      this.yawFollow = false;
      // turn in place: hips hold until the aim twists them too far, then pivot with a step
      const d = wrapAngle(aimYaw - this.pelvisYaw.x);
      if (Math.abs(d) > 0.8) this.turning = true;
      if (this.turning) {
        const goal = aimYaw - Math.sign(d) * 0.12;
        cdAngle(this.pelvisYaw, goal, 11, dt);
        if (Math.abs(wrapAngle(goal - this.pelvisYaw.x)) < 0.04) this.turning = false;
      } else cdAngle(this.pelvisYaw, this.pelvisYaw.x, 11, dt);
      // a flick faster than the pivot still never twists the torso past 100 degrees
      const tw = wrapAngle(this.pelvisYaw.x - aimYaw);
      if (Math.abs(tw) > 1.75) this.pelvisYaw.x = aimYaw + Math.sign(tw) * 1.75;
    }
    this.lastLowerYaw = v.lowerYaw;
    const pYaw = this.pelvisYaw.x;
    PF.set(-Math.sin(pYaw), 0, -Math.cos(pYaw));
    PR.set(Math.cos(pYaw), 0, -Math.sin(pYaw));
    const amp = clamp(hs / 1.5, 0, 1) * (this.moving ? 1 : 0);
    const g = v.gait;
    const dirSign = hs > 0.1 ? clamp(((v.vel.x * PF.x + v.vel.z * PF.z) / hs) * 3, -1, 1) : 1;
    const bobShift = 0.35 + (Math.PI / 2 - 0.35) * runN;
    const bob = -(0.016 + 0.024 * speedN) * amp * Math.cos(2 * (g - bobShift)) * (1 - 0.5 * crouch);
    const sway = -(0.028 - 0.018 * runN) * amp * Math.sin(g);
    const twist = -(0.09 + 0.08 * runN) * amp * Math.cos(g) * dirSign;
    const roll = 0.045 * amp * Math.sin(g);
    // idle weight shift
    this.breath += dt;
    const idle = grounded && !this.moving && !slide ? 1 : 0;
    const shift = Math.sin(this.breath * 0.9) * 0.012 * idle;
    cd1(this.pelvisH, auth.pelvis.y - v.pos.y, 20, dt);
    // hard deceleration braces the hips down
    const decel = hs > 0.5 ? Math.max(0, -(this.sa.x * v.vel.x + this.sa.z * v.vel.z) / hs) : 0;
    const brace = grounded && !slide ? clamp(decel / 40, 0, 1) * 0.05 : 0;
    const pel = PEL.set(v.pos.x, v.pos.y + this.pelvisH.x + bob + this.land.x - brace - this.pelvisDrop.x, v.pos.z);
    pel.addScaledVector(PR, sway + shift);
    // accel lean: the base shifts slightly opposite the lean so the torso tips, not the hips
    const leanH = LEANH.set(this.sa.x, 0, this.sa.z).multiplyScalar(0.0105);
    if (!grounded) leanH.multiplyScalar(0.35);
    const ll = leanH.length();
    if (ll > 0.24) leanH.multiplyScalar(0.24 / ll);
    pel.addScaledVector(leanH, -0.12);
    setV(P.pelvis, pel);
    const pelvisYawT = pYaw + twist;
    PR.set(Math.cos(pelvisYawT), -roll, -Math.sin(pelvisYawT)).normalize();
    PF.set(-Math.sin(pelvisYawT), 0, -Math.cos(pelvisYawT));
    setV(P.lowerRight, PR);
    P.lowerFwd.x = PF.x;
    P.lowerFwd.y = 0;
    P.lowerFwd.z = PF.z;
    const hipY = -0.04;
    P.lHip.x = pel.x - PR.x * STICK.hipW;
    P.lHip.y = pel.y - PR.y * STICK.hipW + hipY;
    P.lHip.z = pel.z - PR.z * STICK.hipW;
    P.rHip.x = pel.x + PR.x * STICK.hipW;
    P.rHip.y = pel.y + PR.y * STICK.hipW + hipY;
    P.rHip.z = pel.z + PR.z * STICK.hipW;

    // ---------------- feet ----------------
    const hold = HOLDS[w];
    this.feetUpdate(f, v, dt, world, hs, crouch, hold.stagger, pel);
    // drop the pelvis so planted feet stay reachable (slopes, steps, long strides)
    let drop = -Infinity;
    for (const ft of this.feet) {
      if (ft.mode === FootMode.Free) continue;
      const hip = ft.side < 0 ? P.lHip : P.rHip;
      const dh = Math.hypot(ft.out.x - hip.x, ft.out.z - hip.z);
      const maxH = Math.sqrt(Math.max(0, STICK.legReach * STICK.legReach - dh * dh));
      drop = Math.max(drop, hip.y - (ft.out.y + maxH * 0.985));
    }
    const dropNow = this.pelvisDrop.x;
    const dropT = drop === -Infinity ? 0 : clamp(drop + dropNow, 0, 0.3);
    // sink immediately when a planted foot needs it (a late sink would stretch the leg this frame),
    // rise back smoothly
    if (dropT > dropNow) { this.pelvisDrop.x = dropT; this.pelvisDrop.v = 0; } else cd1(this.pelvisDrop, dropT, 30, dt);
    const dd = this.pelvisDrop.x - dropNow;
    P.pelvis.y -= dd;
    P.lHip.y -= dd;
    P.rHip.y -= dd;
    pel.y -= dd;
    for (const ft of this.feet) {
      const s = ft.side;
      const hip = s < 0 ? P.lHip : P.rHip;
      const ankle = s < 0 ? P.lAnkle : P.rAnkle;
      const knee = s < 0 ? P.lKnee : P.rKnee;
      const toe = s < 0 ? P.lToe : P.rToe;
      setV(ankle, ft.out);
      // knees point along the foot, slightly outward
      const fy = ft.yaw;
      const kx = -Math.sin(fy) + PR.x * s * 0.15, kz = -Math.cos(fy) + PR.z * s * 0.15;
      ik(hip, ankle, BODY.thigh, BODY.shin, kx, 0.05, kz, knee);
      // audit the FINAL ankle: ik() pulls an unreachable ankle in, which would silently drag a plant
      ft.ikErr = Math.hypot(ankle.x - ft.out.x, ankle.y - ft.out.y, ankle.z - ft.out.z);
      const cp = Math.cos(ft.toePitch), sp = Math.sin(ft.toePitch);
      toe.x = ankle.x - Math.sin(fy) * BODY.footLen * cp;
      toe.y = ankle.y - 0.03 + sp * BODY.footLen;
      toe.z = ankle.z - Math.cos(fy) * BODY.footLen * cp;
    }

    this.plantError = 0;
    for (const ft of this.feet) if (ft.mode === FootMode.Planted) this.plantError = Math.max(this.plantError, ft.ikErr);
    {
      const d = this.diag;
      while (this.contactTimes.length && this.clock - this.contactTimes[0] > 1) this.contactTimes.shift();
      d.cadence = this.contactTimes.length;
      d.plantError = this.plantError;
      d.twist = Math.abs(wrapAngle(v.yaw - this.pelvisYaw.x));
      d.travel = hs;
      d.stance = this.feet.map((ft) => (ft.mode === FootMode.Planted ? 'S' : ft.mode === FootMode.Swing ? 'w' : 'a')).join('');
    }

    // ---------------- spine ----------------
    const yaw = v.yaw, pitch = v.pitch;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), spt = Math.sin(pitch), cpt = Math.cos(pitch);
    F.set(-sy, 0, -cy);
    R.set(cy, 0, -sy);
    A.set(-sy * cpt, spt, -cy * cpt);
    U.set(sy * spt, cpt, cy * spt);
    setV(P.upperFwd, F);
    setV(P.upperRight, R);
    setV(P.aimDir, A);
    setV(P.aimUp, U);
    // lean target: authoritative spine + acceleration + landing + a share of aim pitch
    t3.set(auth.spineUp.x, auth.spineUp.y, auth.spineUp.z);
    t3.add(leanH);
    // sprinting pitches the whole body into the run a little more than the sim spine does
    t3.addScaledVector(F, -this.land.x * 1.6 + brace * 2 - spt * 0.14 + 0.1 * runN * amp * Math.max(0, dirSign));
    t3.addScaledVector(PR, -sway * 1.5);
    t3.normalize();
    cd3(this.lean, this.leanV, t3, 15, dt);
    spring3(this.hit, this.hitV, 15, 0.42, dt);
    const su = t3.copy(this.lean).addScaledVector(this.hit, 1).normalize();
    setV(P.spineUp, su);
    const breathe = Math.sin(this.breath * 1.9) * 0.006 * (1 - amp);
    const chest = t2.copy(pel).addScaledVector(su, BODY.spine);
    chest.y += breathe;
    setV(P.chest, chest);
    this.spineMid.copy(pel).lerp(chest, 0.5).addScaledVector(F, 0.018 + 0.03 * crouch + 0.012 * this.adsS.x);
    P.neck.x = chest.x + su.x * BODY.neck;
    P.neck.y = chest.y + su.y * BODY.neck;
    P.neck.z = chest.z + su.z * BODY.neck;
    const hu = t1.set(su.x + F.x * spt * 0.25, su.y + 1, su.z + F.z * spt * 0.25).normalize();
    setV(P.headUp, hu);
    P.head.x = P.neck.x + hu.x * BODY.headUp;
    P.head.y = P.neck.y + hu.y * BODY.headUp;
    P.head.z = P.neck.z + hu.z * BODY.headUp;
    eul.set(pitch * 0.55, yaw, 0);
    this.headQuat.setFromEuler(eul);

    // ---------------- weapon + arms ----------------
    this.arms(f, v, w, dt, time, hs, twist, grounded, slide);

    // ---------------- secondary ----------------
    this.tailsUpdate(dt);
    // how far the drawn joints sit from the authoritative (hitbox) skeleton
    let dev = 0, devName = '';
    for (const k of DEV_JOINTS) {
      const a = auth[k] as Vec3, b = P[k] as Vec3;
      const e = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (e > dev) { dev = e; devName = k; }
    }
    this.diag.jointDev = dev;
    this.diag.jointDevName = devName;
    this.state = !v.alive ? 'dead' : slide ? 'slide' : !grounded ? (v.vel.y > 0 ? 'jump' : 'fall') : this.moving ? (hs > MOVE.maxSpeed * 0.85 ? 'sprint' : hs > 3.5 ? 'run' : 'walk') : this.turning ? 'turn' : crouch > 0.5 ? 'crouch' : 'idle';
    this.lastYaw = v.yaw;
    this.lastPitch = v.pitch;
    this.init = true;
  }

  private onLand(_f: Fighter, v: AnimView) {
    // plant wherever the feet reached; the inertial offset hides the switch
    for (const ft of this.feet) {
      if (ft.mode !== FootMode.Free) continue;
      ft.mode = FootMode.Planted;
      this.reachable(ft, t1.copy(ft.out));
      ft.plant.set(t1.x, v.pos.y + BODY.ankleY, t1.z);
      ft.inert.set(0, Math.max(-0.1, Math.min(0.25, ft.out.y - ft.plant.y)), 0);
    }
  }

  private snap(v: AnimView, world: World) {
    this.sv.set(v.vel.x, v.vel.y, v.vel.z);
    this.sa.set(0, 0, 0);
    this.pelvisH.x = this.auth.pelvis.y - v.pos.y;
    this.pelvisH.v = 0;
    this.pelvisYaw.x = v.lowerYaw;
    this.pelvisYaw.v = 0;
    this.yawFollow = false;
    this.yawInert = 0;
    this.lastLowerYaw = v.lowerYaw;
    this.contactTimes.length = 0;
    this.pelvisDrop.x = this.pelvisDrop.v = 0;
    this.land.x = this.land.v = 0;
    this.lean.set(this.auth.spineUp.x, this.auth.spineUp.y, this.auth.spineUp.z);
    this.leanV.set(0, 0, 0);
    this.hit.set(0, 0, 0);
    this.hitV.set(0, 0, 0);
    this.grounded = v.onGround;
    this.lastYaw = v.yaw;
    this.lastPitch = v.pitch;
    this.swayYaw.x = this.swayYaw.v = this.swayPitch.x = this.swayPitch.v = 0;
    this.sprint.x = this.sprint.v = 0;
    this.adsS.x = v.ads;
    this.adsS.v = 0;
    for (const ft of this.feet) {
      const a = ft.side < 0 ? this.auth.lAnkle : this.auth.rAnkle;
      ft.out.set(a.x, a.y, a.z);
      ft.prevOut.copy(ft.out);
      ft.inert.set(0, 0, 0);
      ft.yaw = ft.targetYaw = v.lowerYaw;
      if (v.onGround && !v.sliding) {
        ft.mode = FootMode.Planted;
        ft.groundY = this.support(world, a.x, a.z, v.pos.y);
        ft.plant.set(a.x, ft.groundY + BODY.ankleY, a.z);
        ft.out.copy(ft.plant);
      } else {
        ft.mode = FootMode.Free;
        ft.off.set(a.x - this.auth.pelvis.x, a.y - this.auth.pelvis.y, a.z - this.auth.pelvis.z);
        ft.offV.set(0, 0, 0);
      }
    }
    const h = this.auth.head;
    for (const tail of [0, 1]) for (let i = 0; i < 3; i++) {
      this.tails[tail][i].set(h.x, h.y - i * 0.1, h.z);
      this.tailsPrev[tail][i].copy(this.tails[tail][i]);
    }
    this.init = true;
  }

  private feetUpdate(f: Fighter, v: AnimView, dt: number, world: World, hs: number, crouch: number, stagger: number, pel: THREE.Vector3) {
    const auth = this.auth;
    const S = strideLength(hs);
    const yawP = this.pelvisYaw.x;
    const fr = t3.set(Math.cos(yawP), 0, -Math.sin(yawP));
    const frx = fr.x, frz = fr.z, ffx = -Math.sin(yawP), ffz = -Math.cos(yawP);
    const grounded = v.onGround && !v.sliding;
    const speedN = Math.min(hs / MOVE.maxSpeed, 1.2);
    const mx = hs > 0.05 ? v.vel.x / hs : ffx, mz = hs > 0.05 ? v.vel.z / hs : ffz;
    // direction shaping: backpedal = shorter, lower steps; strafe = narrow track, low lift
    const backK = hs > 0.3 ? clamp(-(mx * ffx + mz * ffz), 0, 1) : 0;
    const latK = hs > 0.3 ? Math.abs(mx * frx + mz * frz) : 0;
    const lift = (0.09 + 0.13 * speedN) * (1 - 0.4 * crouch) * (1 - 0.3 * backK - 0.2 * latK);
    let swinging = 0;
    for (const ft of this.feet) {
      if (ft.mode === FootMode.Swing) swinging++;
      const s = ft.side, i = s < 0 ? 0 : 1;
      const st = (s < 0 ? stagger : -stagger) * (1 + 1.2 * crouch);
      restX[i] = v.pos.x + frx * s * (0.1 + 0.05 * crouch) + ffx * st;
      restZ[i] = v.pos.z + frz * s * (0.1 + 0.05 * crouch) + ffz * st;
      restYaw[i] = yawP + s * 0.16 + (s > 0 ? stagger * 2.2 : 0);
    }
    for (const ft of this.feet) {
      const s = ft.side;
      ft.prevOut.copy(ft.out);
      const prevMode = ft.mode;
      // ---- airborne / sliding: feet ride the pelvis toward a pose ----
      if (!grounded) {
        const pushOff = ft.mode !== FootMode.Free && v.vel.y > 0.5 && this.airT < 0.1 && !v.sliding;
        const hip = s < 0 ? this.pose.lHip : this.pose.rHip;
        if (pushOff && ft.out.distanceTo(t1.set(hip.x, hip.y, hip.z)) < STICK.legReach * 0.97) {
          // toes stay on the ground while the legs extend: reads as the jump's launch
        } else {
          if (ft.mode !== FootMode.Free) {
            ft.mode = FootMode.Free;
            ft.off.subVectors(ft.out, pel);
            ft.offV.set(-v.vel.x, -v.vel.y, -v.vel.z).multiplyScalar(0.6);
          }
          const tgt = t2;
          if (v.sliding) {
            const a = s < 0 ? auth.lAnkle : auth.rAnkle;
            tgt.set(a.x - auth.pelvis.x, a.y - auth.pelvis.y, a.z - auth.pelvis.z);
          } else {
            const fall = clamp(-v.vel.y / 9, 0, 1);
            const lead = s > 0;
            const fwdK = (lead ? 0.2 : -0.14) * (1 - fall) + 0.04 * fall;
            const downK = (lead ? -0.44 : -0.6) * (1 - fall) - 0.8 * fall;
            tgt.set(ffx * fwdK + frx * s * (0.1 + 0.03 * fall), downK, ffz * fwdK + frz * s * (0.1 + 0.03 * fall));
            // legs trail the flight direction a touch
            tgt.x -= clamp(v.vel.x * 0.012, -0.12, 0.12);
            tgt.z -= clamp(v.vel.z * 0.012, -0.12, 0.12);
          }
          ft.goal.copy(tgt).add(pel);
          cd3(ft.off, ft.offV, tgt, v.sliding ? 18 : 13, dt);
          ft.out.copy(pel).add(ft.off);
          ft.targetYaw = yawP + s * 0.12;
          ft.toePitch += ((v.sliding ? 0.5 : -0.55) - ft.toePitch) * (1 - Math.exp(-12 * dt));
        }
      } else {
        if (ft.mode === FootMode.Free) {
          ft.mode = FootMode.Planted;
          this.reachable(ft, t1.copy(ft.out));
          ft.plant.set(t1.x, this.support(world, t1.x, t1.z, v.pos.y) + BODY.ankleY, t1.z);
        }
        // ---- grounded: world-locked stance, swings to predicted landings ----
        let ph = (v.gait + (s > 0 ? Math.PI : 0)) % (Math.PI * 2);
        if (ph < 0) ph += Math.PI * 2;
        const fi = s < 0 ? 0 : 1, oi = 1 - fi;
        if (this.moving) {
          // duty from the shared gait model, capped so a stance never outruns the leg's reach
          const duty = Math.min(gaitDuty(hs), STANCE_SPAN / S);
          const swingStart = Math.PI * 2 * duty;
          const inSwing = ph >= swingStart;
          const u = inSwing ? (ph - swingStart) / (Math.PI * 2 - swingStart) : 0;
          // predicted touchdown: where the body will be when this foot lands, plus half a stance ahead
          const tRem = inSwing ? ((Math.PI * 2 - ph) / (Math.PI * 2)) * (S / Math.max(hs, 0.5)) : 0;
          const tRemC = Math.min(tRem, 0.6);
          const wid = (0.075 + 0.05 * crouch) * (1 - 0.45 * latK);
          const reach = S * duty * 0.5 * (1 - 0.2 * backK - 0.1 * latK);
          ft.pred.set(
            v.pos.x + v.vel.x * tRemC + mx * reach + frx * s * wid,
            0,
            v.pos.z + v.vel.z * tRemC + mz * reach + frz * s * wid,
          );
          if (ft.mode === FootMode.Planted && inSwing && u < 0.9) {
            ft.mode = FootMode.Swing;
            ft.phased = true;
            ft.from.copy(ft.out);
            ft.fromYaw = ft.yaw;
            ft.u0 = Math.min(u, 0.7);
            ft.s = 0;
            ft.target.copy(ft.pred);
            ft.fromRel.set(ft.out.x - v.pos.x, 0, ft.out.z - v.pos.z);
            ft.toRel.set(mx * reach + frx * s * wid, 0, mz * reach + frz * s * wid);
            ft.swingT = ((Math.PI * 2 - swingStart) / (Math.PI * 2)) * (S / Math.max(hs, 0.5)) * (1 - ft.u0);
          }
          ft.pred.y = 0;
          if (ft.mode === FootMode.Swing) {
            // desired landing relative to the body; early corrections rate-limited, committed late
            if (ft.s < 0.75) {
              const tx = mx * reach + frx * s * wid, tz = mz * reach + frz * s * wid;
              const dx = tx - ft.toRel.x, dz = tz - ft.toRel.z, dl = Math.hypot(dx, dz), mStep = 5 * dt;
              if (dl > mStep) { ft.toRel.x += (dx / dl) * mStep; ft.toRel.z += (dz / dl) * mStep; } else ft.toRel.set(tx, 0, tz);
            }
          }
          if (ft.mode === FootMode.Swing && ft.phased) {
            if (!inSwing) ft.s = 1;
            else ft.s = clamp((u - ft.u0) / (1 - ft.u0), ft.s, 1);
          }
          ft.targetYaw = yawP + s * 0.06;
          // stance foot left far behind (knockback, corrections), or twisted off the hips: replan it
          if (ft.mode === FootMode.Planted && (Math.hypot(ft.plant.x - v.pos.x, ft.plant.z - v.pos.z) > STANCE_SPAN * 0.5 + 0.25 || Math.abs(wrapAngle(ft.yaw - yawP)) > 1.2)) {
            ft.target.copy(ft.pred);
            this.startTimedSwing(ft);
            swinging++;
          }
        } else {
          ft.pred.set(restX[fi], 0, restZ[fi]);
          if (ft.mode !== FootMode.Swing) ft.target.copy(ft.pred);
          else if (!ft.phased) ft.toRel.set(restX[fi] - v.pos.x, 0, restZ[fi] - v.pos.z);
          ft.targetYaw = restYaw[fi];
          if (ft.mode === FootMode.Swing && ft.phased) ft.phased = false; // finish the step on its own clock
          if (ft.mode === FootMode.Planted && swinging === 0 && this.stepCooldown <= 0) {
            const err = Math.hypot(ft.plant.x - restX[fi], ft.plant.z - restZ[fi]);
            const yawErr = Math.abs(wrapAngle(ft.yaw - restYaw[fi]));
            const other = this.feet[oi];
            const otherErr = other.mode === FootMode.Planted ? Math.hypot(other.plant.x - restX[oi], other.plant.z - restZ[oi]) + Math.abs(wrapAngle(other.yaw - restYaw[oi])) * 0.2 : 0;
            if ((err > 0.17 || yawErr > 0.55 || (err > 0.07 && !this.turning && hs < 0.2)) && err + yawErr * 0.2 >= otherErr) {
              this.startTimedSwing(ft);
              swinging++;
              this.stepCooldown = 0.08;
            }
          }
        }
        // unreachable plant (post-IK error last frame): release and replan instead of dragging it
        if (ft.mode === FootMode.Planted && ft.ikErr > 0.012) {
          ft.target.copy(ft.pred);
          this.startTimedSwing(ft);
          swinging++;
        }
        ft.goal.set(ft.target.x, ft.plant.y, ft.target.z);
        if (ft.mode === FootMode.Swing) {
          if (!ft.phased) ft.s = Math.min(1, ft.s + dt / 0.16);
          ft.groundY = this.support(world, ft.target.x, ft.target.z, v.pos.y);
          const e = smooth01(ft.s);
          const ty = ft.groundY + BODY.ankleY;
          ft.goal.y = ty;
          // body-relative cubic Hermite: tangents match ground speed, so the foot leaves and lands with
          // no skate, kicks back briefly after toe-off and reaches forward before contact
          const q = ft.s, q2 = q * q, q3 = q2 * q;
          const h00 = 2 * q3 - 3 * q2 + 1, h10 = q3 - 2 * q2 + q, h01 = -2 * q3 + 3 * q2, h11 = q3 - q2;
          const T = ft.phased ? ft.swingT : 0;
          const m0x = -v.vel.x * T * 0.8, m0z = -v.vel.z * T * 0.8, m1x = -v.vel.x * T, m1z = -v.vel.z * T;
          ft.out.x = v.pos.x + h00 * ft.fromRel.x + h10 * m0x + h01 * ft.toRel.x + h11 * m1x;
          ft.out.z = v.pos.z + h00 * ft.fromRel.z + h10 * m0z + h01 * ft.toRel.z + h11 * m1z;
          ft.target.set(v.pos.x + ft.toRel.x, 0, v.pos.z + ft.toRel.z);
          ft.out.y = ft.from.y + (ty - ft.from.y) * e + Math.sin(Math.PI * Math.min(1, ft.s * 1.08)) * (this.moving ? lift : 0.06);
          ft.yaw = ft.fromYaw + wrapAngle(ft.targetYaw - ft.fromYaw) * e;
          ft.toePitch = this.moving ? (ft.s < 0.35 ? -0.5 * Math.sin((ft.s / 0.35) * Math.PI) : 0.28 * Math.sin(((ft.s - 0.35) / 0.65) * Math.PI)) : 0;
          if (ft.s >= 1) {
            if (this.moving) this.contactTimes.push(this.clock);
            ft.mode = FootMode.Planted;
            this.reachable(ft, t1.set(ft.out.x, 0, ft.out.z));
            ft.plant.set(t1.x, this.support(world, t1.x, t1.z, v.pos.y) + BODY.ankleY, t1.z);
            ft.out.copy(ft.plant);
            ft.yaw = ft.targetYaw;
          }
        } else {
          ft.out.copy(ft.plant);
          ft.toePitch *= Math.exp(-14 * dt);
        }
      }
      // inertialize discontinuities between modes
      if (prevMode !== ft.mode && (prevMode === FootMode.Free || ft.mode === FootMode.Free)) ft.inert.subVectors(ft.prevOut, ft.out).add(ft.inert).clampLength(0, 0.4);
      ft.inert.multiplyScalar(Math.exp(-18 * dt));
      ft.out.add(ft.inert);
      if (ft.mode === FootMode.Free || prevMode === FootMode.Free) ft.yaw += wrapAngle(ft.targetYaw - ft.yaw) * (1 - Math.exp(-14 * dt));
      void f;
    }
  }

  /**
   * Support height for a foot: the highest walkable surface near the body's own level. A ledge drop
   * further than a step returns the body's level, so a foot at a platform edge never reaches through
   * to the floor underneath.
   */
  private support(world: World, x: number, z: number, bodyY: number) {
    const g = world.surfaceBelow(x, z, 0.04, bodyY + 0.6);
    return g < bodyY - 0.45 ? bodyY : g;
  }

  /** Pull a touchdown point in until the leg can reach it from its hip (horizontal radius). */
  private reachable(ft: Foot, p: THREE.Vector3) {
    const hip = ft.side < 0 ? this.pose.lHip : this.pose.rHip;
    const dx = p.x - hip.x, dz = p.z - hip.z, d = Math.hypot(dx, dz), max = STANCE_SPAN * 0.5 + 0.06;
    if (d > max) {
      p.x = hip.x + (dx / d) * max;
      p.z = hip.z + (dz / d) * max;
    }
    return p;
  }

  private startTimedSwing(ft: Foot) {
    ft.fromRel.set(ft.out.x - this.lastPos.x, 0, ft.out.z - this.lastPos.z);
    ft.toRel.set(ft.pred.x - this.lastPos.x, 0, ft.pred.z - this.lastPos.z);
    ft.mode = FootMode.Swing;
    ft.phased = false;
    ft.from.copy(ft.out);
    ft.fromYaw = ft.yaw;
    ft.s = 0;
    ft.u0 = 0;
  }

  private arms(f: Fighter, v: AnimView, w: WeaponId, dt: number, time: number, hs: number, pelvisTwist: number, grounded: boolean, slide: boolean) {
    const P = this.pose;
    const hold = HOLDS[w];
    const def = WEAPONS[w];
    const ads = cd1(this.adsS, v.ads, 30, dt);
    const adsE = smooth01(ads);
    // aim sway: the weapon lags fast mouse turns a little (presentation only; the reticle never moves)
    const yawRate = dt > 0 ? wrapAngle(v.yaw - this.lastYaw) / dt : 0;
    const pitchRate = dt > 0 ? (v.pitch - this.lastPitch) / dt : 0;
    const swayK = 1 - 0.7 * adsE;
    cd1(this.swayYaw, clamp(-yawRate * 0.012, -0.14, 0.14) * swayK, 13, dt);
    cd1(this.swayPitch, clamp(-pitchRate * 0.01, -0.1, 0.1) * swayK, 13, dt);
    // sprint carry: muzzle drops while running flat out, snaps back on fire/ADS
    const sinceShot = time - f.lastShotTime;
    const busy = ads > 0.05 || (sinceShot >= 0 && sinceShot < 0.45) || f.reloadTimer > 0 || f.meleeWindup > 0;
    const sprintT = !busy && grounded && !slide && hs > MOVE.maxSpeed * 0.82 ? 1 : 0;
    cd1(this.sprint, sprintT, sprintT > this.sprint.x ? 7 : 32, dt);
    const sprint = this.sprint.x;
    // upper-body counter rotation to the stride, plus melee/reload twist
    let twistU = -pelvisTwist * 0.3;
    // shoulders
    const su = P.spineUp;
    const scx = P.chest.x - su.x * 0.045, scy = P.chest.y - su.y * 0.045, scz = P.chest.z - su.z * 0.045;

    // ---- gun transform ----
    const sinceMelee = time - f.lastMeleeTime;
    const recoilK = sinceShot >= 0 && sinceShot < 0.5 ? Math.exp(-sinceShot / hold.kickTau) : 0;
    const drawP = def.drawTime > 0 ? clamp(f.switchTimer / def.drawTime, 0, 1) : 0;
    const reloadP = f.reloadTimer > 0 && def.reloadTime > 0 ? 1 - f.reloadTimer / def.reloadTime : -1;
    const slot = f.weapons[f.cur];
    const boltP = def.bolt && slot.boltLeft > 0 && slot.boltLeft <= def.bolt.time && reloadP < 0 ? 1 - slot.boltLeft / def.bolt.time : -1;
    const reloadE = reloadP >= 0 ? smooth01(reloadP / 0.14) * (1 - smooth01((reloadP - 0.84) / 0.16)) : 0;
    let gx = hold.hip[0] + (hold.ads[0] - hold.hip[0]) * adsE;
    let gy = hold.hip[1] + (hold.ads[1] - hold.hip[1]) * adsE;
    let gz = hold.hip[2] + (hold.ads[2] - hold.hip[2]) * adsE;
    let rp = -hold.drop * (1 - adsE), ry = 0, rr = hold.cant * (1 - adsE);
    // recoil
    gz -= hold.kickBack * recoilK;
    gy += hold.kickBack * 0.25 * recoilK;
    rp += hold.kickRise * recoilK;
    rr += hold.kickRise * 0.15 * recoilK * (f.shotIndex % 2 ? 1 : -1);
    // sprint carry
    rp -= hold.sprintDrop * sprint;
    ry += 0.45 * sprint * (w === 'pistol' ? 0.3 : 1);
    gy -= 0.05 * sprint;
    gx -= 0.03 * sprint;
    // draw: rises from low-ready
    const dE = drawP * drawP;
    rp -= 1.1 * dE;
    gy -= 0.18 * dE;
    gz -= 0.08 * dE;
    // reload: tilt the magwell toward the support hand, pull in
    // (the tilt eases in with the mag-out beat so the swap reads from across the map)
    const tilt = reloadE * (0.75 + 0.25 * Math.sin(clamp((reloadP - 0.2) / 0.6, 0, 1) * Math.PI));
    rr += 0.95 * tilt;
    rp += 0.32 * tilt;
    ry += 0.25 * tilt;
    gx -= 0.1 * reloadE;
    gy += 0.03 * reloadE;
    gz -= 0.06 * reloadE;
    twistU += 0.15 * reloadE;
    // bolt: rock the rifle off the shoulder while cycling
    const boltE = boltP >= 0 ? Math.sin(boltP * Math.PI) : 0;
    rr += 0.18 * boltE;
    rp += 0.06 * boltE;
    // landing / hit: the weapon settles with the body
    gy += this.land.x * 0.35;
    // sway
    ry += this.swayYaw.x;
    rp += this.swayPitch.x;
    gx += this.swayYaw.x * -0.12;
    gy += this.swayPitch.x * -0.1;

    // melee: dedicated arcs around the shoulder
    let meleeActive = false;
    const side = Math.round(f.lastMeleeTime * 120) % 2 === 0 ? 1 : -1;
    let lx = 0, ly = 0, lz = 0;
    if (w === 'melee') {
      const heavy = f.lastMeleeHeavy;
      // guard pose between swings: pencil forward-up in a low fist, free hand up front
      if (f.meleeWindup > 0) {
        // heavy wind-up: cock the pencil back above the shoulder, torso coils away
        const k = smooth01(1 - f.meleeWindup / 0.3);
        gx = 0.2 + 0.06 * k; gy = -0.28 + 0.46 * k; gz = 0.27 - 0.44 * k;
        rp = 0.5 - 0.35 * k;
        twistU -= 0.7 * k;
        meleeActive = true;
      } else if (heavy && sinceMelee >= 0.3 && sinceMelee < 0.85) {
        // stab straight through the aim line, then recover to guard
        const t = sinceMelee - 0.3;
        const k = smooth01(t / 0.07), wS = 1 - smooth01((t - 0.2) / 0.32);
        const sx = 0.26 + (0.05 - 0.26) * k, syy = 0.18 + (-0.06 - 0.18) * k, sz = -0.17 + (0.58 + 0.17) * k;
        gx = sx * wS + 0.2 * (1 - wS);
        gy = syy * wS - 0.28 * (1 - wS);
        gz = sz * wS + 0.27 * (1 - wS);
        rp = 0.1 * wS + 0.5 * (1 - wS);
        twistU += (-0.7 + 1.05 * k) * wS;
        meleeActive = true;
      } else if (!heavy && sinceMelee >= 0 && sinceMelee < 0.4) {
        // light slash: the strike lands on the first tick, so the arc is mostly follow-through
        const k = smooth01(sinceMelee / 0.1), wS = 1 - smooth01((sinceMelee - 0.13) / 0.26);
        const th = side * (1.25 - 2.2 * k);
        const reach = 0.52;
        gx = Math.sin(th) * reach * wS + 0.2 * (1 - wS);
        gz = Math.cos(th) * reach * wS + 0.27 * (1 - wS);
        gy = (0.1 - 0.32 * k) * wS - 0.28 * (1 - wS);
        rp = 0.15 * wS + 0.5 * (1 - wS);
        ry = -th * 0.8 * wS;
        rr = side * 0.8 * wS;
        twistU += side * (-0.35 + 0.8 * k) * wS;
        meleeActive = true;
      }
      lx = -0.06;
      ly = -0.12 + (meleeActive ? 0.05 : 0);
      lz = 0.3 - (meleeActive ? 0.12 : 0);
    }

    // shoulder line with twist
    const ct = Math.cos(twistU), st = Math.sin(twistU);
    UR.set(R.x * ct + R.z * st, 0, -R.x * st + R.z * ct);
    const sw = STICK.shoulderW;
    // shoulders roll forward when aiming down sights
    const fwdSh = 0.03 * adsE;
    P.lShoulder.x = scx - UR.x * sw + F.x * fwdSh;
    P.lShoulder.y = scy;
    P.lShoulder.z = scz - UR.z * sw + F.z * fwdSh;
    P.rShoulder.x = scx + UR.x * sw + F.x * fwdSh;
    P.rShoulder.y = scy - 0.01 * adsE;
    P.rShoulder.z = scz + UR.z * sw + F.z * fwdSh;

    // grip in the (twisted) aim frame from the shoulder centre
    const gR = UR;
    const gp = this.gunPos.set(scx, scy, scz).addScaledVector(gR, gx).addScaledVector(U, gy).addScaledVector(A, gz);
    eul.set(v.pitch, v.yaw + twistU * (meleeActive ? 1 : 0.6), 0);
    qA.setFromEuler(eul);
    eul.set(rp, ry, rr);
    qO.setFromEuler(eul);
    this.gunQuat.copy(qA).multiply(qO);
    this.showGun = true;

    // ---- hand goals ----
    const hr = this.handGoalR.copy(gp);
    if (boltP >= 0 && hold.bolt) {
      const k = Math.sin(clamp(boltP * 1.15, 0, 1) * Math.PI);
      t1.set(hold.bolt[0], hold.bolt[1], hold.bolt[2]).applyQuaternion(this.gunQuat).add(gp);
      hr.lerp(t1, k);
    }
    const hl = this.handGoalL;
    if (hold.support) {
      hl.set(hold.support[0], hold.support[1], hold.support[2]).applyQuaternion(this.gunQuat).add(gp);
      if (reloadP >= 0) {
        // to the magazine, strip it down to the belt, bring a fresh one up, back to the handguard
        t1.set(hold.mag[0], hold.mag[1], hold.mag[2]).applyQuaternion(this.gunQuat).add(gp);
        t2.set(P.pelvis.x, P.pelvis.y + 0.08, P.pelvis.z).addScaledVector(R, -0.16).addScaledVector(F, 0.1);
        const toMag = smooth01((reloadP - 0.06) / 0.14);
        const down = smooth01((reloadP - 0.28) / 0.14) * (1 - smooth01((reloadP - 0.5) / 0.16));
        const back = smooth01((reloadP - 0.78) / 0.14);
        hl.lerp(t1, toMag * (1 - back));
        hl.lerp(t2, down);
      }
    } else {
      hl.set(scx, scy, scz).addScaledVector(UR, lx).addScaledVector(U, ly).addScaledVector(A, lz);
      if (w === 'melee') {
        // free arm counter-swings for balance
        hl.addScaledVector(UR, -0.08 * Math.abs(twistU));
      }
    }
    // draw: support hand joins late
    if (drawP > 0 && hold.support) hl.lerp(t1.set(scx, scy, scz).addScaledVector(R, -0.12).addScaledVector(F, 0.12).addScaledVector(up, -0.3), drawP);
    // sprint: pistol support hand pumps free
    if (w === 'pistol' && sprint > 0) hl.lerp(t1.set(scx, scy, scz).addScaledVector(R, -0.14).addScaledVector(F, 0.16).addScaledVector(up, -0.34 + 0.08 * Math.sin(v.gait)), sprint);

    this.arm(P.rShoulder, P.rElbow, P.rHand, hr, 1);
    this.arm(P.lShoulder, P.lElbow, P.lHand, hl, -1);
  }

  /** Two-bone arm IK with an aim-relative pole (elbows down and out, stable at any pitch). */
  private arm(shoulder: Vec3, elbow: Vec3, hand: Vec3, goal: THREE.Vector3, s: number) {
    let dx = goal.x - shoulder.x, dy = goal.y - shoulder.y, dz = goal.z - shoulder.z;
    const d = Math.hypot(dx, dy, dz);
    const max = STICK.armReach;
    if (d > max) {
      // reach: the shoulder protracts toward the hand before the hand leaves its socket
      const k = Math.min(d - max, 0.09) / d;
      shoulder.x += dx * k;
      shoulder.y += dy * k;
      shoulder.z += dz * k;
      dx = goal.x - shoulder.x;
      dy = goal.y - shoulder.y;
      dz = goal.z - shoulder.z;
    }
    hand.x = goal.x;
    hand.y = goal.y;
    hand.z = goal.z;
    const bx = UR.x * s * 0.62 - U.x * 0.8 - A.x * 0.12;
    const by = UR.y * s * 0.62 - U.y * 0.8 - A.y * 0.12 - 0.25;
    const bz = UR.z * s * 0.62 - U.z * 0.8 - A.z * 0.12;
    ik(shoulder, hand, BODY.upperArm, BODY.forearm, bx, by, bz, elbow);
  }

  private tailsUpdate(dt: number) {
    // short ribbon ends: they trail the head's motion and settle behind it instead of flying around
    const P = this.pose;
    const q = this.headQuat;
    const back = t1.set(0, 0.06, 0.18).applyQuaternion(q).add(t2.set(P.head.x, P.head.y, P.head.z));
    const rt = t3.set(1, 0, 0).applyQuaternion(q);
    const bk = t4.set(0, -0.55, 1).applyQuaternion(q).normalize();
    const h = dt > 0 ? Math.min(dt, 1 / 30) : 0;
    for (let tIdx = 0; tIdx < 2; tIdx++) {
      const pts = this.tails[tIdx], prev = this.tailsPrev[tIdx];
      const side = tIdx ? 0.022 : -0.022;
      pts[0].copy(back).addScaledVector(rt, side);
      prev[0].copy(pts[0]);
      const seg = tIdx ? 0.075 : 0.09;
      if (h > 0) {
        for (let i = 1; i < 3; i++) {
          const p = pts[i], o = prev[i];
          const vx = (p.x - o.x) * 0.82, vy = (p.y - o.y) * 0.82, vz = (p.z - o.z) * 0.82;
          o.copy(p);
          p.x += vx;
          p.y += vy - 4 * h * h;
          p.z += vz;
          // soft pull toward the rest pose trailing behind the head
          const k = 1 - Math.exp(-10 * h);
          p.x += (pts[0].x + (bk.x + rt.x * side * 6) * seg * i - p.x) * k;
          p.y += (pts[0].y + bk.y * seg * i - p.y) * k;
          p.z += (pts[0].z + (bk.z + rt.z * side * 6) * seg * i - p.z) * k;
        }
      }
      for (let i = 1; i < 3; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = b.distanceTo(a) || 1e-4;
        b.lerp(a, 1 - seg / d);
        const hx = b.x - P.head.x, hy = b.y - P.head.y, hz = b.z - P.head.z, hd = Math.hypot(hx, hy, hz), r = STICK.headR + 0.02;
        if (hd < r) b.set(P.head.x + (hx / (hd || 1e-4)) * r, P.head.y + (hy / (hd || 1e-4)) * r, P.head.z + (hz / (hd || 1e-4)) * r);
      }
    }
  }
}
