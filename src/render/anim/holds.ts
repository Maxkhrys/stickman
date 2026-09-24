import type { WeaponId } from '../../sim/types';

// ============================================================================
//  Third-person weapon handling profiles. Offsets are in the aim frame
//  (R = right, U = aim-up, A = aim direction) from the shoulder centre, and the
//  sockets are in the third-person gun mesh frame (grip at origin, bore -Z,
//  see tpGuns.ts). Presentation only: fire direction comes from the sim.
// ============================================================================

export interface Hold {
  /** grip (trigger hand) offset from the shoulder centre at the hip and aiming down sights */
  hip: [number, number, number];
  ads: [number, number, number];
  /** support hand socket on the gun (gun frame); null = one-handed */
  support: [number, number, number] | null;
  /** magazine well (gun frame) the support hand visits while reloading */
  mag: [number, number, number];
  /** bolt handle (gun frame) the trigger hand visits while cycling */
  bolt: [number, number, number] | null;
  /** hip cant (roll, rad) and hip muzzle drop (pitch, rad) */
  cant: number;
  drop: number;
  /** recoil strength: kick-back metres and muzzle rise radians per shot, decay time */
  kickBack: number;
  kickRise: number;
  kickTau: number;
  /** how far the muzzle lowers while running flat out (rad) */
  sprintDrop: number;
  /** bladed stance: how far the support-side foot leads the trigger-side foot (m) */
  stagger: number;
}

const rifle: Hold = {
  hip: [0.11, -0.085, 0.24],
  ads: [0.04, -0.02, 0.22],
  support: [0, -0.005, -0.33],
  mag: [0, -0.09, -0.12],
  bolt: null,
  cant: 0.1,
  drop: 0.06,
  kickBack: 0.05,
  kickRise: 0.11,
  kickTau: 0.06,
  sprintDrop: 0.55,
  stagger: 0.09,
};

export const HOLDS: Record<WeaponId, Hold> = {
  ar: rifle,
  carbine: { ...rifle, support: [0, -0.005, -0.39], kickBack: 0.06, kickRise: 0.15, kickTau: 0.07 },
  smg: { ...rifle, hip: [0.1, -0.075, 0.26], ads: [0.04, -0.02, 0.24], support: [0, -0.02, -0.22], mag: [0, -0.09, -0.08], kickBack: 0.035, kickRise: 0.06, kickTau: 0.045, cant: 0.14 },
  sniper: {
    ...rifle,
    hip: [0.11, -0.08, 0.21],
    ads: [0.035, -0.015, 0.19],
    support: [0, 0.0, -0.37],
    mag: [0, -0.06, -0.1],
    bolt: [0.07, 0.07, 0.03],
    kickBack: 0.1,
    kickRise: 0.22,
    kickTau: 0.1,
    cant: 0.05,
  },
  pistol: {
    hip: [0.04, -0.1, 0.42],
    ads: [0.0, -0.03, 0.48],
    support: [-0.035, -0.035, 0.015],
    mag: [0, -0.1, 0.02],
    bolt: null,
    cant: 0.04,
    drop: 0.1,
    kickBack: 0.04,
    kickRise: 0.28,
    kickTau: 0.07,
    sprintDrop: 0.75,
    stagger: 0.05,
  },
  melee: {
    hip: [0.2, -0.28, 0.27],
    ads: [0.2, -0.28, 0.27],
    support: null,
    mag: [0, 0, 0],
    bolt: null,
    cant: 0,
    drop: -0.5,
    kickBack: 0,
    kickRise: 0,
    kickTau: 0.05,
    sprintDrop: 0.3,
    stagger: 0.14,
  },
};
