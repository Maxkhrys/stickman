// Tiny allocation-light vector helpers used by the simulation.
// The sim deliberately does not depend on three.js so it can run headless on a server.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vclone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export function vcopy(o: Vec3, a: Vec3): Vec3 {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
}
export const vadd = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const vsub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const vscale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const vaddScaled = (a: Vec3, b: Vec3, s: number): Vec3 => v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vdist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdistH = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export function vnorm(a: Vec3): Vec3 {
  const l = vlen(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const vcross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

// Angle convention (matches a three.js camera with rotation order 'YXZ'):
// yaw = 0 looks down -Z, positive yaw turns left. Positive pitch looks up.
export function forwardFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return v3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
export const flatForward = (yaw: number): Vec3 => v3(-Math.sin(yaw), 0, -Math.cos(yaw));
export const flatRight = (yaw: number): Vec3 => v3(Math.cos(yaw), 0, -Math.sin(yaw));
export const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const pitchTo = (dy: number, horiz: number): number => Math.atan2(dy, horiz);
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Deterministic PRNG so a server and clients can agree on spread given a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
