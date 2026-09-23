import type { Fighter } from './fighter';
import type { HitPart } from './types';
import { flatForward, flatRight, v3, type Vec3 } from './vec';

export interface Hitbox {
  part: HitPart;
  a: Vec3;
  b: Vec3; // same as a for spheres
  r: number;
}

/**
 * Server-side style hitboxes derived from sim state only (not from the render animation),
 * so they are deterministic and lag-compensatable later. Big head (stickman style).
 */
export function buildHitboxes(f: Fighter, out: Hitbox[] = []): Hitbox[] {
  out.length = 0;
  const p = f.pos;
  const h = f.height;
  const fw = flatForward(f.yaw);
  const rt = flatRight(f.yaw);
  const crouchT = (1.8 - h) / 0.65;
  const lean = f.sliding ? -0.25 : crouchT * 0.12;

  const headY = p.y + h - 0.21;
  const neckY = p.y + h - 0.42;
  const hipY = f.sliding ? p.y + 0.42 : p.y + (0.95 - 0.4 * crouchT);
  const head = v3(p.x + fw.x * lean, headY, p.z + fw.z * lean);
  const neck = v3(p.x + fw.x * lean * 0.8, neckY, p.z + fw.z * lean * 0.8);
  const hip = v3(p.x, hipY, p.z);

  out.push({ part: 'head', a: head, b: head, r: 0.22 });
  out.push({ part: 'body', a: neck, b: hip, r: 0.2 });
  // legs
  for (const s of [-1, 1]) {
    const hp = v3(hip.x + rt.x * 0.11 * s, hip.y, hip.z + rt.z * 0.11 * s);
    const fp = f.sliding
      ? v3(p.x + fw.x * (s > 0 ? 0.8 : 0.3) + rt.x * 0.12 * s, p.y + 0.1, p.z + fw.z * (s > 0 ? 0.8 : 0.3) + rt.z * 0.12 * s)
      : v3(p.x + rt.x * 0.14 * s, p.y + 0.08, p.z + rt.z * 0.14 * s);
    out.push({ part: 'limb', a: hp, b: fp, r: 0.12 });
  }
  // arms reaching forward to the gun
  const sh = v3(neck.x, neckY - 0.06, neck.z);
  for (const s of [-1, 1]) {
    const a = v3(sh.x + rt.x * 0.18 * s, sh.y, sh.z + rt.z * 0.18 * s);
    const hand = v3(sh.x + fw.x * 0.5 + rt.x * 0.06 * s, sh.y - 0.12, sh.z + fw.z * 0.5 + rt.z * 0.06 * s);
    out.push({ part: 'limb', a, b: hand, r: 0.09 });
  }
  return out;
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
    if (y > 0 && y < baba) return t;
  }
  // caps
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
