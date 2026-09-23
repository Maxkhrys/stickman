import { buildSkeleton, createSkeleton, type Skeleton } from './body';
import type { Fighter } from './fighter';
import type { HitPart } from './types';
import { v3, type Vec3 } from './vec';

/** capsule (a->b, radius r; sphere when a == b) or oriented box (centre a, axes, half extents). */
export interface Hitbox {
  part: HitPart;
  kind: 'capsule' | 'obb';
  a: Vec3;
  b: Vec3;
  r: number;
  // obb
  ax: Vec3;
  ay: Vec3;
  az: Vec3;
  hx: number;
  hy: number;
  hz: number;
}

function mk(): Hitbox {
  return { part: 'limb', kind: 'capsule', a: v3(), b: v3(), r: 0, ax: v3(), ay: v3(), az: v3(), hx: 0, hy: 0, hz: 0 };
}

const skel = createSkeleton();
const pool: Hitbox[] = Array.from({ length: 16 }, mk);

function cap(i: number, part: HitPart, a: Vec3, b: Vec3, r: number): Hitbox {
  const h = pool[i];
  h.part = part;
  h.kind = 'capsule';
  h.a.x = a.x; h.a.y = a.y; h.a.z = a.z;
  h.b.x = b.x; h.b.y = b.y; h.b.z = b.z;
  h.r = r;
  return h;
}

function obb(i: number, part: HitPart, c: Vec3, sk: Skeleton, hx: number, hy: number, hz: number): Hitbox {
  const h = pool[i];
  h.part = part;
  h.kind = 'obb';
  h.a.x = c.x; h.a.y = c.y; h.a.z = c.z;
  const R = sk.upperRight, U = sk.spineUp;
  // forward axis = up x right (orthonormal frame)
  h.ax.x = R.x; h.ax.y = R.y; h.ax.z = R.z;
  h.ay.x = U.x; h.ay.y = U.y; h.ay.z = U.z;
  h.az.x = U.y * R.z - U.z * R.y;
  h.az.y = U.z * R.x - U.x * R.z;
  h.az.z = U.x * R.y - U.y * R.x;
  h.hx = hx; h.hy = hy; h.hz = hz;
  return h;
}

/** Hitbox dimensions (metres). Head matches the drawn head; torso matches the drawn shirt + shorts. */
export const HIT = {
  headR: 0.2,
  chest: { hx: 0.21, hy: 0.12, hz: 0.13, down: 0.12 },
  stomach: { hx: 0.18, hy: 0.15, hz: 0.12, up: 0.05 },
  neckR: 0.07,
  upperArmR: 0.065,
  forearmR: 0.06,
  thighR: 0.085,
  shinR: 0.075,
  footR: 0.055,
};

/**
 * Hitboxes for a fighter from the shared skeleton. Returned array is reused between calls.
 * Order: head, neck, chest, stomach, arms, legs, feet.
 */
export function buildHitboxes(f: Fighter, out: Hitbox[] = []): Hitbox[] {
  const sk = buildSkeleton(f, f.weapons[f.cur].id, skel);
  out.length = 0;
  out.push(cap(0, 'head', sk.head, sk.head, HIT.headR));
  out.push(cap(1, 'chest', sk.chest, sk.neck, HIT.neckR));
  const su = sk.spineUp;
  const cc = v3(sk.chest.x - su.x * HIT.chest.down, sk.chest.y - su.y * HIT.chest.down, sk.chest.z - su.z * HIT.chest.down);
  out.push(obb(2, 'chest', cc, sk, HIT.chest.hx, HIT.chest.hy, HIT.chest.hz));
  const sc = v3(sk.pelvis.x + su.x * HIT.stomach.up, sk.pelvis.y + su.y * HIT.stomach.up, sk.pelvis.z + su.z * HIT.stomach.up);
  out.push(obb(3, 'stomach', sc, sk, HIT.stomach.hx, HIT.stomach.hy, HIT.stomach.hz));
  out.push(cap(4, 'limb', sk.rShoulder, sk.rElbow, HIT.upperArmR));
  out.push(cap(5, 'limb', sk.rElbow, sk.rHand, HIT.forearmR));
  out.push(cap(6, 'limb', sk.lShoulder, sk.lElbow, HIT.upperArmR));
  out.push(cap(7, 'limb', sk.lElbow, sk.lHand, HIT.forearmR));
  out.push(cap(8, 'limb', sk.rHip, sk.rKnee, HIT.thighR));
  out.push(cap(9, 'limb', sk.rKnee, sk.rAnkle, HIT.shinR));
  out.push(cap(10, 'limb', sk.lHip, sk.lKnee, HIT.thighR));
  out.push(cap(11, 'limb', sk.lKnee, sk.lAnkle, HIT.shinR));
  out.push(cap(12, 'limb', sk.rAnkle, sk.rToe, HIT.footR));
  out.push(cap(13, 'limb', sk.lAnkle, sk.lToe, HIT.footR));
  return out;
}

/** Ray vs hitbox; returns distance or -1. */
export function rayHitbox(ro: Vec3, rd: Vec3, h: Hitbox): number {
  if (h.kind === 'capsule') return rayCapsule(ro, rd, h.a, h.b, h.r);
  return rayObb(ro, rd, h);
}

export function rayObb(ro: Vec3, rd: Vec3, h: Hitbox): number {
  const px = ro.x - h.a.x, py = ro.y - h.a.y, pz = ro.z - h.a.z;
  const o = [px * h.ax.x + py * h.ax.y + pz * h.ax.z, px * h.ay.x + py * h.ay.y + pz * h.ay.z, px * h.az.x + py * h.az.y + pz * h.az.z];
  const d = [
    rd.x * h.ax.x + rd.y * h.ax.y + rd.z * h.ax.z,
    rd.x * h.ay.x + rd.y * h.ay.y + rd.z * h.ay.z,
    rd.x * h.az.x + rd.y * h.az.y + rd.z * h.az.z,
  ];
  const e = [h.hx, h.hy, h.hz];
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -e[i] || o[i] > e[i]) return -1;
      continue;
    }
    let t1 = (-e[i] - o[i]) / d[i];
    let t2 = (e[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

/** Ray vs capsule (Inigo Quilez). Returns distance or -1. Sphere when a == b. */
export function rayCapsule(ro: Vec3, rd: Vec3, pa: Vec3, pb: Vec3, r: number): number {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-8) return raySphere(ro, rd, pa, r);
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (a > 1e-8 && h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
  }
  const t1 = raySphere(ro, rd, pa, r);
  const t2 = raySphere(ro, rd, pb, r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

export function raySphere(ro: Vec3, rd: Vec3, c: Vec3, r: number): number {
  const ox = ro.x - c.x, oy = ro.y - c.y, oz = ro.z - c.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}
