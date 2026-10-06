import { MODEL_FOR, WEAPON_MODELS, adsBlend, type V3, type WeaponModel } from '../config/weaponModels';
import type { WeaponId } from './types';
import { v3, type Vec3 } from './vec';

/** Orthonormal aim frame + the world position of the weapon's eye socket. */
export interface WeaponFrame {
  model: WeaponModel;
  /** world position of the eye socket */
  o: Vec3;
  r: Vec3;
  u: Vec3;
  f: Vec3;
}

export function aimBasis(yaw: number, pitch: number, r: Vec3, u: Vec3, f: Vec3) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  f.x = -sy * cp; f.y = sp; f.z = -cy * cp;
  r.x = cy; r.y = 0; r.z = -sy;
  u.x = sy * sp; u.y = cp; u.z = cy * sp;
}

/**
 * Where the weapon is: eye socket blended from the hip carry to `adsForward` ahead of the eye,
 * oriented along the aim. Deterministic, so the sim muzzle and the drawn muzzle agree.
 */
export function weaponFrame(eye: Vec3, yaw: number, pitch: number, weapon: WeaponId, ads: number, out?: WeaponFrame): WeaponFrame | null {
  const key = MODEL_FOR[weapon];
  if (!key) return null;
  const m = WEAPON_MODELS[key];
  const w = out ?? { model: m, o: v3(), r: v3(), u: v3(), f: v3() };
  w.model = m;
  aimBasis(yaw, pitch, w.r, w.u, w.f);
  const a = adsBlend(ads);
  const hr = m.hip[0] * (1 - a), hu = m.hip[1] * (1 - a), hf = m.hip[2] + (m.adsForward - m.hip[2]) * a;
  w.o.x = eye.x + w.r.x * hr + w.u.x * hu + w.f.x * hf;
  w.o.y = eye.y + w.r.y * hr + w.u.y * hu + w.f.y * hf;
  w.o.z = eye.z + w.r.z * hr + w.u.z * hu + w.f.z * hf;
  return w;
}

/** World position of a socket (model units) in a weapon frame. Model +X = forward, +Y = up, +Z = right. */
export function socketWorld(w: WeaponFrame, s: V3, out: Vec3 = v3()): Vec3 {
  const k = w.model.scale, e = w.model.eye;
  const dx = (s[0] - e[0]) * k, dy = (s[1] - e[1]) * k, dz = (s[2] - e[2]) * k;
  out.x = w.o.x + w.f.x * dx + w.u.x * dy + w.r.x * dz;
  out.y = w.o.y + w.f.y * dx + w.u.y * dy + w.r.y * dz;
  out.z = w.o.z + w.f.z * dx + w.u.z * dy + w.r.z * dz;
  return out;
}
