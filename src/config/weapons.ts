import type { HitPart, WeaponId } from '../sim/types';

// ============================================================================
//  ALL WEAPON STATS LIVE HERE. Edit freely - everything else reads from this.
//  Angles are radians (half-angle cones). Times are seconds. Distances metres.
// ============================================================================

export type DamageTable = Record<HitPart, number>;

export interface MeleeDef {
  lightDamage: number;
  lightInterval: number;
  lightRange: number;
  heavyDamage: number;
  heavyWindup: number;
  heavyInterval: number;
  heavyRange: number;
  headMult: number;
  backstabDamage: number;
  coneDeg: number;
  lungeRange: number;
  lungeSpeed: number;
  lungeConeDeg: number;
}

export interface BoltDef {
  /** time after the shot before the bolt starts moving (you stay on the scope for the impact) */
  delay: number;
  /** bolt cycle duration; the scope is forced off while cycling */
  time: number;
}

export interface ScopeDef {
  /** world vertical FOV (degrees) when fully scoped */
  vfov: number;
  /** ADS progress where the scope overlay starts / is fully shown */
  overlayStart: number;
  overlayFull: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'hitscan' | 'melee';
  damage: DamageTable;
  magSize: number;
  /** minimum time between shots */
  fireInterval: number;
  auto: boolean;
  reloadTime: number;
  /** reload progress (0..1) at which the new magazine seats and ammo is refilled */
  reloadInsertAt: number;
  drawTime: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;

  // ---- spread (cone half-angle) ----
  spreadHip: number;
  spreadMove: number; // at full run speed
  spreadAir: number;
  spreadPerShot: number; // bloom
  spreadMax: number;
  spreadRecover: number; // bloom recovery per second
  /** multiplier on hip spread + bloom at full ADS accuracy */
  adsSpreadMult: number;
  /** multiplier on movement / air spread at full ADS accuracy */
  adsMoveSpreadMult: number;
  /** ADS accuracy ramps (smoothstep) between these ADS-progress values */
  adsAccuracyStart: number;
  adsAccuracyFull: number;

  // ---- gameplay recoil (moves the actual aim; the camera shows exactly this) ----
  /** sharp per-shot impulse that decays exponentially with time constant kickTau */
  kickPitch: number;
  kickYaw: number; // random +- sideways impulse (kept small)
  kickTau: number;
  /** sustained, learnable climb added per shot; loops from recoilLoopFrom */
  recoilPattern: [number, number][];
  recoilLoopFrom: number;
  recoilRecover: number; // rad/s once you stop firing
  recoilRecoverDelay: number;
  recoilMaxPitch: number;
  adsRecoilMult: number;

  // ---- aiming ----
  adsTime: number; // full ADS entry time
  /** world FOV multiplier at full ADS for iron sights (1 = no zoom) */
  adsZoom: number;
  scope?: ScopeDef;
  moveSpeedMult: number;
  adsMoveMult: number;

  bolt?: BoltDef;
  melee?: MeleeDef;
}

const NO_RECOIL = {
  kickPitch: 0,
  kickYaw: 0,
  kickTau: 0.05,
  recoilPattern: [[0, 0]] as [number, number][],
  recoilLoopFrom: 0,
  recoilRecover: 1,
  recoilRecoverDelay: 0,
  recoilMaxPitch: 0,
  adsRecoilMult: 1,
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // "Inkblaster" - fountain-pen assault rifle. Sharp impulse, short recovery, gentle learnable climb.
  ar: {
    id: 'ar',
    name: 'Inkblaster',
    kind: 'hitscan',
    damage: { head: 60, chest: 25, stomach: 25, limb: 20 },
    magSize: 30,
    fireInterval: 0.1, // 600 RPM
    auto: true,
    reloadTime: 1.9,
    reloadInsertAt: 0.62,
    drawTime: 0.34,
    range: 200,
    falloffStart: 30,
    falloffEnd: 70,
    falloffMin: 0.7,
    spreadHip: 0.011,
    spreadMove: 0.03,
    spreadAir: 0.05,
    spreadPerShot: 0.004,
    spreadMax: 0.028,
    spreadRecover: 0.12,
    adsSpreadMult: 0.12,
    adsMoveSpreadMult: 0.35,
    adsAccuracyStart: 0.3,
    adsAccuracyFull: 0.9,
    kickPitch: 0.009,
    kickYaw: 0.0018,
    kickTau: 0.05,
    // straight up for 5, gentle drift right, then a slow left-right wobble
    recoilPattern: [
      [0.005, 0.0],
      [0.005, 0.0],
      [0.0048, 0.0003],
      [0.0046, 0.0005],
      [0.0044, 0.0008],
      [0.004, 0.0012],
      [0.0036, 0.0012],
      [0.0033, 0.0008],
      [0.003, 0.0],
      [0.0028, -0.0009],
      [0.0027, -0.0013],
      [0.0026, -0.0012],
      [0.0025, -0.0005],
      [0.0025, 0.0004],
      [0.0025, 0.001],
      [0.0024, 0.0008],
    ],
    recoilLoopFrom: 8,
    recoilRecover: 0.32,
    recoilRecoverDelay: 0.1,
    recoilMaxPitch: 0.085,
    adsRecoilMult: 0.75,
    adsTime: 0.17,
    adsZoom: 0.8,
    moveSpeedMult: 1.0,
    adsMoveMult: 0.75,
  },

  // "Graphite" - mechanical-pencil bolt-action sniper built for quickscopes.
  sniper: {
    id: 'sniper',
    name: 'Graphite',
    kind: 'hitscan',
    damage: { head: 150, chest: 110, stomach: 80, limb: 60 },
    magSize: 5,
    fireInterval: 0.12,
    auto: false,
    reloadTime: 2.3,
    reloadInsertAt: 0.6,
    drawTime: 0.45,
    range: 300,
    falloffStart: 999,
    falloffEnd: 1000,
    falloffMin: 1,
    spreadHip: 0.075,
    spreadMove: 0.05,
    spreadAir: 0.08,
    spreadPerShot: 0,
    spreadMax: 0,
    spreadRecover: 1,
    adsSpreadMult: 0,
    adsMoveSpreadMult: 0.12,
    // reliable right as the scope image appears (overlay 0.72 -> 0.85)
    adsAccuracyStart: 0.45,
    adsAccuracyFull: 0.85,
    kickPitch: 0.05,
    kickYaw: 0.004,
    kickTau: 0.09,
    recoilPattern: [[0.012, 0.0]],
    recoilLoopFrom: 0,
    recoilRecover: 0.5,
    recoilRecoverDelay: 0.08,
    recoilMaxPitch: 0.05,
    adsRecoilMult: 0.8,
    adsTime: 0.28,
    adsZoom: 1,
    scope: { vfov: 17, overlayStart: 0.72, overlayFull: 0.85 },
    moveSpeedMult: 0.92,
    adsMoveMult: 0.55,
    bolt: { delay: 0.14, time: 0.78 },
  },

  // "Highlighter" - punchy semi-auto sidearm with a quick draw.
  pistol: {
    id: 'pistol',
    name: 'Highlighter',
    kind: 'hitscan',
    damage: { head: 90, chest: 34, stomach: 34, limb: 28 },
    magSize: 12,
    fireInterval: 0.14,
    auto: false,
    reloadTime: 1.3,
    reloadInsertAt: 0.58,
    drawTime: 0.18,
    range: 200,
    falloffStart: 25,
    falloffEnd: 60,
    falloffMin: 0.75,
    spreadHip: 0.006,
    spreadMove: 0.02,
    spreadAir: 0.04,
    spreadPerShot: 0.01,
    spreadMax: 0.03,
    spreadRecover: 0.12,
    adsSpreadMult: 0.25,
    adsMoveSpreadMult: 0.5,
    adsAccuracyStart: 0.2,
    adsAccuracyFull: 0.85,
    kickPitch: 0.03,
    kickYaw: 0.003,
    kickTau: 0.07,
    recoilPattern: [[0.01, 0.001]],
    recoilLoopFrom: 0,
    recoilRecover: 0.45,
    recoilRecoverDelay: 0.06,
    recoilMaxPitch: 0.06,
    adsRecoilMult: 0.8,
    adsTime: 0.14,
    adsZoom: 0.88,
    moveSpeedMult: 1.05,
    adsMoveMult: 0.8,
  },

  // "Pencil" - quick slash, slower heavy stab, lunge, backstab.
  melee: {
    id: 'melee',
    name: 'Pencil',
    kind: 'melee',
    damage: { head: 75, chest: 50, stomach: 50, limb: 50 },
    magSize: 0,
    fireInterval: 0.42,
    auto: true,
    reloadTime: 0,
    reloadInsertAt: 1,
    drawTime: 0.12,
    range: 2.4,
    falloffStart: 999,
    falloffEnd: 1000,
    falloffMin: 1,
    spreadHip: 0,
    spreadMove: 0,
    spreadAir: 0,
    spreadPerShot: 0,
    spreadMax: 0,
    spreadRecover: 1,
    adsSpreadMult: 1,
    adsMoveSpreadMult: 1,
    adsAccuracyStart: 0,
    adsAccuracyFull: 1,
    ...NO_RECOIL,
    adsTime: 0.1,
    adsZoom: 1,
    moveSpeedMult: 1.12,
    adsMoveMult: 1,
    melee: {
      lightDamage: 50,
      lightInterval: 0.42,
      lightRange: 2.4,
      heavyDamage: 100,
      heavyWindup: 0.3,
      heavyInterval: 0.95,
      heavyRange: 2.8,
      headMult: 1.5,
      backstabDamage: 200,
      coneDeg: 32,
      lungeRange: 6,
      lungeSpeed: 12,
      lungeConeDeg: 14,
    },
  },
};

/** Practice range carries everything. */
export const RANGE_LOADOUT: WeaponId[] = ['ar', 'sniper', 'pistol', 'melee'];
/** Match loadout: chosen primary + sidearm + melee. */
export function matchLoadout(primary: 'ar' | 'sniper'): WeaponId[] {
  return [primary, 'pistol', 'melee'];
}
