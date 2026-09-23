import type { Difficulty } from '../sim/types';

export interface DifficultyDef {
  /** Reaction time range (s) from first seeing a target to first shot. */
  reaction: [number, number];
  /** Base angular aim error (rad) when a target is first acquired. */
  aimError: number;
  /** How fast the error shrinks the longer they hold you (1/s). */
  trackImprove: number;
  /** Aim follow rate (1/s). Higher = snappier tracking. */
  turnSpeed: number;
  /** 0..1 how much they strafe while shooting. */
  strafe: number;
  /** 0..1 pushing / flanking vs. holding / retreating. */
  aggression: number;
  /** Chance per second of jumping during fights. */
  jumpRate: number;
  /** Chance of aiming for the head per engagement. */
  headChance: number;
  /** 0..1 how well they pull down against recoil. */
  recoilComp: number;
  /** Hearing radius for gunfire (m). */
  hearing: number;
  /** View cone half-angle (rad). */
  fovHalf: number;
  /** Health fraction at which they retreat. */
  retreatAt: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: {
    reaction: [0.5, 0.75],
    aimError: 0.11,
    trackImprove: 0.35,
    turnSpeed: 4.5,
    strafe: 0.25,
    aggression: 0.3,
    jumpRate: 0.05,
    headChance: 0.05,
    recoilComp: 0.3,
    hearing: 30,
    fovHalf: 0.9,
    retreatAt: 0.25,
  },
  normal: {
    reaction: [0.32, 0.45],
    aimError: 0.07,
    trackImprove: 0.6,
    turnSpeed: 7,
    strafe: 0.55,
    aggression: 0.5,
    jumpRate: 0.15,
    headChance: 0.15,
    recoilComp: 0.6,
    hearing: 45,
    fovHalf: 1.05,
    retreatAt: 0.3,
  },
  hard: {
    reaction: [0.18, 0.25],
    aimError: 0.045,
    trackImprove: 1.0,
    turnSpeed: 11,
    strafe: 0.85,
    aggression: 0.7,
    jumpRate: 0.3,
    headChance: 0.3,
    recoilComp: 0.85,
    hearing: 60,
    fovHalf: 1.2,
    retreatAt: 0.35,
  },
  insane: {
    reaction: [0.12, 0.17],
    aimError: 0.028,
    trackImprove: 1.6,
    turnSpeed: 17,
    strafe: 1.0,
    aggression: 0.9,
    jumpRate: 0.45,
    headChance: 0.5,
    recoilComp: 0.95,
    hearing: 75,
    fovHalf: 1.3,
    retreatAt: 0.3,
  },
};
