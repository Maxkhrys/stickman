import type { WeaponId } from '../sim/types';

// ============================================================================
//  ALL WEAPON STATS LIVE HERE. Edit freely - everything else reads from this.
//  Angles are radians. Times are seconds. Distances are metres.
// ============================================================================

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

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: 'hitscan' | 'melee';
  damage: number;
  headDamage: number;
  limbMult: number;
  magSize: number;
  fireInterval: number;
  auto: boolean;
  reloadTime: number;
  drawTime: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;

  // cone half-angle spread
  spreadBase: number;
  spreadMove: number;
  spreadAir: number;
  spreadPerShot: number;
  spreadMax: number;
  spreadRecover: number;
  adsSpreadMult: number;

  /** Learnable recoil: [pitchUp, yawRight] added per shot, in order. Loops from recoilLoopFrom. */
  recoilPattern: [number, number][];
  recoilLoopFrom: number;
  recoilRecover: number;
  recoilRecoverDelay: number;
  recoilRandomYaw: number;
  recoilMaxPitch: number;
  adsRecoilMult: number;

  adsFovMult: number;
  adsTime: number;
  moveSpeedMult: number;
  adsMoveMult: number;

  /** Purely visual camera punch per shot (does not affect aim). */
  viewPunch: number;
  melee?: MeleeDef;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: {
    id: 'ar',
    name: 'AR-15',
    kind: 'hitscan',
    damage: 25,
    headDamage: 60,
    limbMult: 0.8,
    magSize: 30,
    fireInterval: 0.1, // 600 RPM
    auto: true,
    reloadTime: 1.55,
    drawTime: 0.32,
    range: 200,
    falloffStart: 30,
    falloffEnd: 70,
    falloffMin: 0.7,
    spreadBase: 0.004,
    spreadMove: 0.028,
    spreadAir: 0.05,
    spreadPerShot: 0.006,
    spreadMax: 0.035,
    spreadRecover: 0.12,
    adsSpreadMult: 0.25,
    // First 5 shots climb straight up, then it drifts right, snaps left, then wobbles.
    recoilPattern: [
      [0.011, 0.0],
      [0.012, 0.0],
      [0.013, 0.0005],
      [0.013, 0.001],
      [0.012, 0.0015],
      [0.011, 0.004],
      [0.010, 0.005],
      [0.009, 0.005],
      [0.008, 0.003],
      [0.007, -0.002],
      [0.007, -0.006],
      [0.006, -0.007],
      [0.006, -0.006],
      [0.005, -0.002],
      [0.005, 0.003],
      [0.005, 0.005],
      [0.004, 0.004],
      [0.004, -0.001],
      [0.004, -0.004],
      [0.004, -0.004],
    ],
    recoilLoopFrom: 12,
    recoilRecover: 0.55,
    recoilRecoverDelay: 0.12,
    recoilRandomYaw: 0.0015,
    recoilMaxPitch: 0.16,
    adsRecoilMult: 0.7,
    adsFovMult: 0.72,
    adsTime: 0.14,
    moveSpeedMult: 1.0,
    adsMoveMult: 0.72,
    viewPunch: 0.012,
  },
  pistol: {
    id: 'pistol',
    name: 'Deagle-ish',
    kind: 'hitscan',
    damage: 34,
    headDamage: 90,
    limbMult: 0.85,
    magSize: 12,
    fireInterval: 0.15,
    auto: false,
    reloadTime: 1.15,
    drawTime: 0.16, // quick draw
    range: 200,
    falloffStart: 25,
    falloffEnd: 60,
    falloffMin: 0.75,
    spreadBase: 0.0015,
    spreadMove: 0.018,
    spreadAir: 0.04,
    spreadPerShot: 0.012,
    spreadMax: 0.03,
    spreadRecover: 0.1,
    adsSpreadMult: 0.3,
    recoilPattern: [[0.026, 0.001]],
    recoilLoopFrom: 0,
    recoilRecover: 0.42,
    recoilRecoverDelay: 0.06,
    recoilRandomYaw: 0.004,
    recoilMaxPitch: 0.12,
    adsRecoilMult: 0.8,
    adsFovMult: 0.8,
    adsTime: 0.11,
    moveSpeedMult: 1.05,
    adsMoveMult: 0.8,
    viewPunch: 0.035,
  },
  melee: {
    id: 'melee',
    name: 'Knife',
    kind: 'melee',
    damage: 50,
    headDamage: 75,
    limbMult: 1,
    magSize: 0,
    fireInterval: 0.42,
    auto: true,
    reloadTime: 0,
    drawTime: 0.12,
    range: 2.4,
    falloffStart: 999,
    falloffEnd: 1000,
    falloffMin: 1,
    spreadBase: 0,
    spreadMove: 0,
    spreadAir: 0,
    spreadPerShot: 0,
    spreadMax: 0,
    spreadRecover: 1,
    adsSpreadMult: 1,
    recoilPattern: [[0, 0]],
    recoilLoopFrom: 0,
    recoilRecover: 1,
    recoilRecoverDelay: 0,
    recoilRandomYaw: 0,
    recoilMaxPitch: 0,
    adsRecoilMult: 1,
    adsFovMult: 1,
    adsTime: 0.1,
    moveSpeedMult: 1.12,
    adsMoveMult: 1,
    viewPunch: 0,
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

/** Loadout order = slot keys 1/2/3. */
export const LOADOUT: WeaponId[] = ['ar', 'pistol', 'melee'];
