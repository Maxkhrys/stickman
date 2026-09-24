import type * as THREE from 'three';

// ============================================================================
//  Allocation-free springs for presentation animation. Critically damped
//  springs reach their target as fast as possible without overshoot, so they
//  smooth without the sluggish tail of an exponential lerp. Under-damped
//  springs are used only where a visible bounce is wanted (hit reactions).
// ============================================================================

/** e^-x approximation used by the closed-form critically damped step (stable for any dt). */
function decay(x: number) {
  return 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
}

/** Scalar spring state. */
export interface S1 {
  x: number;
  v: number;
}

export const s1 = (x = 0): S1 => ({ x, v: 0 });

/** Critically damped step toward `target` with angular frequency `w` (rad/s). */
export function cd1(s: S1, target: number, w: number, dt: number) {
  if (dt <= 0) return s.x;
  const e = decay(w * dt);
  const change = s.x - target;
  const temp = (s.v + w * change) * dt;
  s.v = (s.v - w * temp) * e;
  s.x = target + (change + temp) * e;
  return s.x;
}

/** Critically damped angle step: wraps the error so it always takes the short way round. */
export function cdAngle(s: S1, target: number, w: number, dt: number) {
  let d = target - s.x;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cd1(s, s.x + d, w, dt);
}

/** Critically damped vector spring: `x` moves toward `target`, `v` is its velocity (both mutated). */
export function cd3(x: THREE.Vector3, v: THREE.Vector3, target: THREE.Vector3, w: number, dt: number) {
  if (dt <= 0) return x;
  const e = decay(w * dt);
  const cx = x.x - target.x, cy = x.y - target.y, cz = x.z - target.z;
  const tx = (v.x + w * cx) * dt, ty = (v.y + w * cy) * dt, tz = (v.z + w * cz) * dt;
  v.set((v.x - w * tx) * e, (v.y - w * ty) * e, (v.z - w * tz) * e);
  x.set(target.x + (cx + tx) * e, target.y + (cy + ty) * e, target.z + (cz + tz) * e);
  return x;
}

/** Damped spring toward 0 with ratio `zeta` (< 1 bounces). Semi-implicit sub-steps keep it stable. */
export function spring1(s: S1, w: number, zeta: number, dt: number) {
  const n = Math.max(1, Math.ceil(dt / 0.006));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-w * w * s.x - 2 * zeta * w * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

export function spring3(x: THREE.Vector3, v: THREE.Vector3, w: number, zeta: number, dt: number) {
  const n = Math.max(1, Math.ceil(dt / 0.006));
  const h = dt / n;
  const k = w * w, c = 2 * zeta * w;
  for (let i = 0; i < n; i++) {
    v.x += (-k * x.x - c * v.x) * h;
    v.y += (-k * x.y - c * v.y) * h;
    v.z += (-k * x.z - c * v.z) * h;
    x.x += v.x * h;
    x.y += v.y * h;
    x.z += v.z * h;
  }
  return x;
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(d: number) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
