import { MOVE } from '../config/movement';
import type { WeaponId } from './types';
import { clamp, v3, type Vec3 } from './vec';

// ============================================================================
//  Shared body skeleton. ONE deterministic function turns sim state into joint
//  positions. Hitboxes (sim) and the character renderer both use it, so what
//  you see is what you hit. Units: metres, standing height 1.8.
// ============================================================================

export const BODY = {
  headR: 0.2,
  pelvisY: 0.92,
  spine: 0.44, // pelvis centre -> chest top (neck base)
  neck: 0.05,
  headUp: 0.19, // neck -> head centre
  shoulderW: 0.2,
  hipW: 0.1,
  thigh: 0.45,
  shin: 0.44,
  ankleY: 0.07,
  upperArm: 0.3,
  forearm: 0.29,
  footLen: 0.17,
};

/** The subset of fighter state the body depends on (a Fighter satisfies it). */
export interface BodyState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  lowerYaw: number;
  height: number;
  gait: number;
  onGround: boolean;
  sliding: boolean;
  ads: number;
  /** collision-resolved travel speed (fighters carry it); falls back to |velocity| */
  travelSpeed?: number;
}

export interface Skeleton {
  pelvis: Vec3;
  chest: Vec3; // chest top / neck base
  neck: Vec3;
  head: Vec3;
  lShoulder: Vec3;
  rShoulder: Vec3;
  lElbow: Vec3;
  rElbow: Vec3;
  lHand: Vec3;
  rHand: Vec3;
  lHip: Vec3;
  rHip: Vec3;
  lKnee: Vec3;
  rKnee: Vec3;
  lAnkle: Vec3;
  rAnkle: Vec3;
  lToe: Vec3;
  rToe: Vec3;
  /** frames */
  spineUp: Vec3;
  upperFwd: Vec3;
  upperRight: Vec3;
  lowerFwd: Vec3;
  lowerRight: Vec3;
  aimDir: Vec3;
  aimUp: Vec3;
  headUp: Vec3;
  /** gait amplitude 0..1 (render uses it for arm swing etc.) */
  moveAmp: number;
  crouch: number;
}

export function createSkeleton(): Skeleton {
  const n = () => v3();
  return {
    pelvis: n(), chest: n(), neck: n(), head: n(),
    lShoulder: n(), rShoulder: n(), lElbow: n(), rElbow: n(), lHand: n(), rHand: n(),
    lHip: n(), rHip: n(), lKnee: n(), rKnee: n(), lAnkle: n(), rAnkle: n(), lToe: n(), rToe: n(),
    spineUp: n(), upperFwd: n(), upperRight: n(), lowerFwd: n(), lowerRight: n(), aimDir: n(), aimUp: n(), headUp: n(),
    moveAmp: 0, crouch: 0,
  };
}

// ---- gait vocabulary (shared by the sim skeleton and the presentation animator) ----
//   step          one foot contact to the next contact of the OTHER foot (half a cycle)
//   stride        one full cycle: left contact -> right contact -> left contact (two steps)
//   cadence       foot contacts per second (both feet counted)
//   duty          fraction of a cycle one foot spends in stance (on the ground)
// Gait phase advances by collision-resolved travel / stride * 2pi, so the step schedule is set by
// cadence(speed) and the feet stay planted: stance distance = stride * duty.

/** Foot contacts per second. Ordinary full running speed (8.2 m/s) gives about 4.4. */
export function cadence(speed: number): number {
  return clamp(1.7 + speed * 0.33, 1.7, 4.8);
}

/** Full stride length (metres per gait cycle) at a travel speed. */
export function strideLength(speed: number): number {
  return Math.max(1.0, (2 * speed) / cadence(speed));
}

/** Stance fraction of the cycle per foot: long double support at a walk, flight at a run. */
export function gaitDuty(speed: number): number {
  return 0.62 - 0.38 * clamp((speed - 2.5) / 5, 0, 1);
}

function set(o: Vec3, x: number, y: number, z: number) {
  o.x = x;
  o.y = y;
  o.z = z;
}

/** Two-bone IK: writes the middle joint into `out` given root a, end b (b may be pulled in if unreachable). */
export function ik(a: Vec3, b: Vec3, l1: number, l2: number, bendX: number, bendY: number, bendZ: number, out: Vec3) {
  let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  let d = Math.hypot(dx, dy, dz);
  const maxD = l1 + l2 - 1e-3;
  if (d > maxD) {
    const s = maxD / d;
    dx *= s;
    dy *= s;
    dz *= s;
    set(b, a.x + dx, a.y + dy, a.z + dz);
    d = maxD;
  }
  if (d < 1e-4) {
    set(out, a.x + bendX * l1, a.y + bendY * l1, a.z + bendZ * l1);
    return;
  }
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const nx = dx / d, ny = dy / d, nz = dz / d;
  const dp = bendX * nx + bendY * ny + bendZ * nz;
  let px = bendX - nx * dp, py = bendY - ny * dp, pz = bendZ - nz * dp;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  set(out, a.x + nx * along + px * h, a.y + ny * along + py * h, a.z + nz * along + pz * h);
}

/**
 * Deterministic skeleton from state. `weapon` decides how the arms hold things.
 * Only depends on sim data, so a server can rebuild identical hitboxes for lag compensation.
 */
export function buildSkeleton(s: BodyState, weapon: WeaponId, out: Skeleton): Skeleton {
  const p = s.pos;
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  const sp = Math.sin(s.pitch), cp = Math.cos(s.pitch);
  const ly = Math.sin(s.lowerYaw), lc = Math.cos(s.lowerYaw);
  set(out.upperFwd, -sy, 0, -cy);
  set(out.upperRight, cy, 0, -sy);
  set(out.lowerFwd, -ly, 0, -lc);
  set(out.lowerRight, lc, 0, -ly);
  set(out.aimDir, -sy * cp, sp, -cy * cp);
  set(out.aimUp, sy * sp, cp, cy * sp);
  const uF = out.upperFwd, uR = out.upperRight, lF = out.lowerFwd, lR = out.lowerRight;

  const c = clamp((MOVE.standHeight - s.height) / (MOVE.standHeight - MOVE.crouchHeight), 0, 1);
  const slide = s.sliding ? 1 : 0;
  const air = s.onGround ? 0 : 1;
  const hs = s.travelSpeed ?? Math.hypot(s.vel.x, s.vel.z);
  const run = s.onGround && !s.sliding ? clamp(hs / MOVE.maxSpeed, 0, 1.2) : 0;
  out.crouch = c;

  // ---- spine ----
  const fwdSpeed = s.vel.x * uF.x + s.vel.z * uF.z;
  const runLean = s.onGround ? 0.1 * clamp(fwdSpeed / MOVE.maxSpeed, -0.6, 1.2) : 0.05;
  const lean = slide ? -0.55 : runLean + (0.6 - runLean) * c;
  const pelvisY = slide ? 0.36 : BODY.pelvisY + (0.36 - BODY.pelvisY) * c - 0.07 * run * (1 - c) + 0.04 * air;
  set(out.pelvis, p.x, p.y + pelvisY, p.z);
  const su = out.spineUp;
  set(su, uF.x * Math.sin(lean), Math.cos(lean), uF.z * Math.sin(lean));
  const pe = out.pelvis;
  set(out.chest, pe.x + su.x * BODY.spine, pe.y + su.y * BODY.spine, pe.z + su.z * BODY.spine);
  set(out.neck, out.chest.x + su.x * BODY.neck, out.chest.y + su.y * BODY.neck, out.chest.z + su.z * BODY.neck);
  // head sits between spine direction and vertical, nods a little with aim pitch
  const hu = out.headUp;
  set(hu, su.x + uF.x * sp * 0.25, su.y + 1, su.z + uF.z * sp * 0.25);
  const hl = Math.hypot(hu.x, hu.y, hu.z);
  set(hu, hu.x / hl, hu.y / hl, hu.z / hl);
  set(out.head, out.neck.x + hu.x * BODY.headUp, out.neck.y + hu.y * BODY.headUp, out.neck.z + hu.z * BODY.headUp);

  // ---- shoulders ----
  const sc = { x: out.chest.x - su.x * 0.05, y: out.chest.y - su.y * 0.05, z: out.chest.z - su.z * 0.05 };
  set(out.lShoulder, sc.x - uR.x * BODY.shoulderW, sc.y, sc.z - uR.z * BODY.shoulderW);
  set(out.rShoulder, sc.x + uR.x * BODY.shoulderW, sc.y, sc.z + uR.z * BODY.shoulderW);

  // ---- hands hold the weapon along the aim ray ----
  const A = out.aimDir, U = out.aimUp;
  const ads = s.ads;
  const G = out.rHand, L = out.lHand;
  if (weapon === 'pistol') {
    const r = 0.04 - 0.04 * ads, d = 0.09 - 0.05 * ads, f = 0.46;
    set(G, sc.x + uR.x * r - U.x * d + A.x * f, sc.y - U.y * d + A.y * f, sc.z + uR.z * r - U.z * d + A.z * f);
    set(L, G.x - uR.x * 0.05 - U.x * 0.03 - A.x * 0.02, G.y - U.y * 0.03 - A.y * 0.02, G.z - uR.z * 0.05 - U.z * 0.03 - A.z * 0.02);
  } else if (weapon === 'melee') {
    set(G, sc.x + uR.x * 0.2 - U.x * 0.22 + A.x * 0.3, sc.y - U.y * 0.22 + A.y * 0.3, sc.z + uR.z * 0.2 - U.z * 0.22 + A.z * 0.3);
    set(L, out.lShoulder.x + uF.x * 0.12 - uR.x * 0.06, out.lShoulder.y - 0.5, out.lShoulder.z + uF.z * 0.12 - uR.z * 0.06);
  } else {
    // long guns: trigger hand under the shoulder line, support hand out on the handguard
    const r = 0.08 - 0.06 * ads, d = 0.16 - 0.06 * ads, f = 0.22;
    set(G, sc.x + uR.x * r - U.x * d + A.x * f, sc.y - U.y * d + A.y * f, sc.z + uR.z * r - U.z * d + A.z * f);
    const reach = weapon === 'sniper' ? 0.3 : 0.26;
    set(L, G.x + A.x * reach + U.x * 0.04 - uR.x * 0.08, G.y + A.y * reach + U.y * 0.04, G.z + A.z * reach + U.z * 0.04 - uR.z * 0.08);
  }
  // elbows bend down and out
  ik(out.rShoulder, G, BODY.upperArm, BODY.forearm, uR.x * 0.7 - A.x * 0.3, -1, uR.z * 0.7 - A.z * 0.3, out.rElbow);
  ik(out.lShoulder, L, BODY.upperArm, BODY.forearm, -uR.x * 0.7 - A.x * 0.3, -1, -uR.z * 0.7 - A.z * 0.3, out.lElbow);

  // ---- legs: planted gait driven by distance travelled ----
  const hipY = pe.y - 0.04;
  set(out.lHip, pe.x - lR.x * BODY.hipW, hipY, pe.z - lR.z * BODY.hipW);
  set(out.rHip, pe.x + lR.x * BODY.hipW, hipY, pe.z + lR.z * BODY.hipW);
  const amp = clamp(hs / 1.2, 0, 1) * (1 - air) * (1 - slide);
  out.moveAmp = amp;
  const S = strideLength(hs);
  let mx = lF.x, mz = lF.z;
  if (hs > 0.05) {
    mx = s.vel.x / hs;
    mz = s.vel.z / hs;
  }
  const liftH = 0.1 + 0.1 * Math.min(hs / MOVE.maxSpeed, 1);
  for (const side of [-1, 1]) {
    const ankle = side < 0 ? out.lAnkle : out.rAnkle;
    const knee = side < 0 ? out.lKnee : out.rKnee;
    const hip = side < 0 ? out.lHip : out.rHip;
    const toe = side < 0 ? out.lToe : out.rToe;
    let ph = (s.gait + (side > 0 ? Math.PI : 0)) % (Math.PI * 2);
    if (ph < 0) ph += Math.PI * 2;
    // stance covers duty of the cycle; the foot's excursion is capped to what the leg can reach
    const duty = gaitDuty(hs);
    const half = Math.min((S * duty) / 2, 0.45);
    const st = Math.PI * 2 * duty;
    let along: number, lift: number;
    if (ph < st) {
      along = half - 2 * half * (ph / st);
      lift = 0;
    } else {
      const u = (ph - st) / (Math.PI * 2 - st);
      along = -half + 2 * half * (u * u * (3 - 2 * u));
      lift = Math.sin(u * Math.PI) * liftH;
    }
    const wide = 0.12 + 0.07 * c;
    let ax = p.x + lR.x * side * wide + mx * along * amp + lF.x * 0.06 * c;
    let ayy = p.y + BODY.ankleY + lift * amp;
    let az = p.z + lR.z * side * wide + mz * along * amp + lF.z * 0.06 * c;
    if (air) {
      // tuck: one knee up, one trailing
      const up = side > 0 ? 0.42 : 0.52;
      ax = pe.x + lR.x * side * 0.12 + lF.x * (side > 0 ? 0.18 : -0.12);
      ayy = pe.y - up;
      az = pe.z + lR.z * side * 0.12 + lF.z * (side > 0 ? 0.18 : -0.12);
    }
    if (slide) {
      const lead = side > 0;
      ax = pe.x + uF.x * (lead ? 0.78 : 0.22) + uR.x * side * 0.12;
      ayy = p.y + (lead ? 0.12 : 0.07);
      az = pe.z + uF.z * (lead ? 0.78 : 0.22) + uR.z * side * 0.12;
    }
    set(ankle, ax, ayy, az);
    ik(hip, ankle, BODY.thigh, BODY.shin, lF.x, 0.05, lF.z, knee);
    // toe points along the lower body, tipping down while the foot swings
    const tip = lift * amp * 0.6;
    set(toe, ankle.x + lF.x * BODY.footLen, ankle.y - 0.03 - tip, ankle.z + lF.z * BODY.footLen);
  }
  return out;
}
