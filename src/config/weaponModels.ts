import type { WeaponId } from '../sim/types';

// ============================================================================
//  Weapon model sockets, shared by the simulation (muzzle position for shot
//  traces) and the renderer (where the mesh, hands and camera go). Socket
//  coordinates are in the model's own units: +X toward the muzzle, +Y up,
//  +Z to the weapon's right. They were measured from the uploaded GLBs with
//  tools/asset/profile (see docs/SNIPER_UPGRADE.md).
//
//  Placement is defined in the aim frame (right, up, forward) by where the
//  "eye socket" (the point on the sight line the eye looks through) sits
//  relative to the fighter's eye: `hip` at the hip/shoulder carry, and
//  `adsForward` metres straight ahead of the eye when fully aimed, so ADS
//  puts the camera exactly behind the sights (third person -> first person).
// ============================================================================

export type V3 = [number, number, number];

export interface WeaponModel {
  /** GLB under public/, or null for the procedural fallback mesh */
  url: string | null;
  /** metres per model unit */
  scale: number;
  eye: V3;
  muzzle: V3;
  /** trigger hand (palm centre on the grip) */
  grip: V3;
  /** support hand */
  support: V3;
  /** stock butt (shoulder contact) */
  butt: V3;
  /** eye-socket offset from the eye at hip carry, aim frame metres [right, up, forward] */
  hip: V3;
  /** eye-socket distance ahead of the eye at full ADS */
  adsForward: number;
  /** grip rotation: how far the trigger hand's knuckles roll under the weapon (rad) */
  gripRoll: number;
  /** support hand: palm under the handguard (true) or wrapped over the trigger hand (pistols) */
  supportUnder: boolean;
  /** model has no textures: the renderer gives it a dark gunmetal material */
  untextured?: boolean;
}

export const WEAPON_MODELS: Record<'sniper' | 'ar' | 'smg' | 'pistol', WeaponModel> = {
  // Futuristic bolt sniper: 98 units = 1.25 m. Scope axis y=23, bore y=17.4.
  sniper: {
    url: 'assets/weapons/sniper.glb',
    scale: 1.25 / 98,
    eye: [-35, 23, 0],
    muzzle: [49, 17.4, 0],
    grip: [-24, 8.5, 0],
    support: [5, 12.5, 0],
    butt: [-48, 10.5, 0],
    hip: [0.16, -0.1, 0.16],
    adsForward: 0,
    gripRoll: 0.2,
    supportUnder: true,
  },
  // Futuristic assault rifle (textured re-export).
  // 1 unit = 0.9 m. Iron sight line y=0.293.
  ar: {
    url: 'assets/weapons/ar.glb',
    scale: 0.9,
    eye: [-0.33, 0.293, 0],
    muzzle: [0.5, 0.227, 0],
    grip: [-0.23, 0.1, 0],
    support: [0.17, 0.175, 0],
    butt: [-0.49, 0.18, 0],
    hip: [0.16, -0.11, 0.16],
    adsForward: 0.04,
    gripRoll: 0.2,
    supportUnder: true,
  },
  // Futuristic compact rifle (SMG slot): 98 units = 0.72 m. Iron sight line y=48.5.
  smg: {
    url: 'assets/weapons/gun.glb',
    scale: 0.72 / 98,
    eye: [-30, 48.5, 0],
    muzzle: [49, 40.5, 0],
    grip: [-21, 14, 0],
    support: [24, 31, 0],
    butt: [-48, 28, 0],
    hip: [0.16, -0.11, 0.16],
    adsForward: 0.05,
    gripRoll: 0.2,
    supportUnder: true,
  },
  // Futuristic pistol: 98 units = 0.22 m. Sight line y=70.5 at the rear sight.
  pistol: {
    url: 'assets/weapons/pistol.glb',
    scale: 0.22 / 98,
    eye: [-48, 70.5, 0],
    muzzle: [49, 57, 0],
    grip: [-34, 28, 0],
    support: [-30, 22, 0],
    butt: [-46, 30, 0],
    hip: [0.13, -0.2, 0.42],
    adsForward: 0.36,
    gripRoll: 0.1,
    supportUnder: false,
  },
};

/** Which model each weapon id uses. Melee has no gun model (procedural pencil). */
export const MODEL_FOR: Record<WeaponId, keyof typeof WEAPON_MODELS | null> = {
  sniper: 'sniper',
  ar: 'ar',
  smg: 'smg',
  carbine: 'ar',
  pistol: 'pistol',
  melee: null,
};

/** ADS blend curve shared by the camera, the weapon pose and the sim muzzle. */
export function adsBlend(ads: number): number {
  const t = ads < 0 ? 0 : ads > 1 ? 1 : ads;
  return t * t * (3 - 2 * t);
}
