import type { Difficulty } from '../sim/types';

// ============================================================================
//  Bot difficulty. Damage rules are identical for everyone; difficulty only changes
//  how bots perceive, react, aim, fire and move.
// ============================================================================
export interface DifficultyDef {
  label: string;
  /** reaction time (s) from genuine detection (line of sight + in view) to first shot */
  reaction: [number, number];
  /** reaction multiplier when re-seeing a target lost moments ago (1 = full reaction again) */
  reacquire: number;
  /** aim wander amplitude (rad) when a target is first acquired */
  aimError: number;
  /** fraction of aimError that never goes away, however long they track you */
  aimErrorFloor: number;
  /** seconds for the error to settle toward the floor while holding a target */
  errorSettle: number;
  /** perception delay (s): how stale their read of your movement is */
  trackLag: number;
  /** how quickly their estimate of your velocity adapts (s). Direction changes beat slow adapters. */
  velAdapt: number;
  /** max turn rate (rad/s) and exponential follow rate (1/s) */
  turnRate: number;
  turnSmooth: number;
  /** chance per engagement of going for the head instead of the torso */
  headChance: number;
  /** shots per burst and pause between bursts (s) */
  burst: [number, number];
  burstPause: [number, number];
  /** how loosely they decide "on target" before pulling the trigger (1 = tight) */
  fireTolerance: number;
  /** 0..1 strafing intensity while shooting */
  strafe: number;
  /** chance to plant their feet for a burst (easier to hit back) */
  plantChance: number;
  jumpRate: number;
  aggression: number;
  /** gunfire hearing radius (m) and error on heard positions (m) */
  hearing: number;
  hearingNoise: number;
  /** how long they remember where they last saw you (s) */
  memory: number;
  fovHalf: number;
  /** max bots allowed to shoot at a human simultaneously */
  maxAttackers: number;
  /** extra wait (s) when a bot newly gets permission to shoot at you */
  tokenDelay: number;
  retreatAt: number;
  recoilComp: number;
  /** how many bots carry the Graphite sniper */
  sniperBots: number;
  /** extra time a sniper bot holds the scope before firing (s) */
  sniperSettle: number;
  /** chance per engagement of aiming down sights at range (rifle/pistol) */
  adsChance: number;
  /** where on the torso they aim: 0 = belt, 1 = collarbone */
  aimHeight: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: {
    label: 'Easy',
    reaction: [0.45, 0.8],
    reacquire: 1,
    aimError: 0.11,
    aimErrorFloor: 0.5,
    errorSettle: 1.8,
    trackLag: 0.26,
    velAdapt: 0.5,
    turnRate: 3.2,
    turnSmooth: 5,
    headChance: 0.03,
    burst: [3, 4],
    burstPause: [0.55, 0.95],
    fireTolerance: 1.6,
    strafe: 0.25,
    plantChance: 0.6,
    jumpRate: 0,
    aggression: 0.3,
    hearing: 22,
    hearingNoise: 4,
    memory: 1.5,
    fovHalf: 0.85,
    maxAttackers: 1,
    tokenDelay: 0.6,
    retreatAt: 0.3,
    recoilComp: 0.6,
    sniperBots: 0,
    sniperSettle: 0.35,
    adsChance: 0,
    aimHeight: 0.3,
  },
  normal: {
    label: 'Normal',
    reaction: [0.3, 0.45],
    reacquire: 0.8,
    aimError: 0.07,
    aimErrorFloor: 0.3,
    errorSettle: 1.0,
    trackLag: 0.17,
    velAdapt: 0.28,
    turnRate: 5,
    turnSmooth: 8,
    headChance: 0.12,
    burst: [4, 7],
    burstPause: [0.3, 0.5],
    fireTolerance: 1.3,
    strafe: 0.55,
    plantChance: 0.3,
    jumpRate: 0.1,
    aggression: 0.5,
    hearing: 35,
    hearingNoise: 2.5,
    memory: 2.5,
    fovHalf: 1.0,
    maxAttackers: 2,
    tokenDelay: 0.35,
    retreatAt: 0.3,
    recoilComp: 0.65,
    sniperBots: 1,
    sniperSettle: 0.2,
    adsChance: 0.5,
    aimHeight: 0.5,
  },
  hard: {
    label: 'Hard',
    reaction: [0.2, 0.28],
    reacquire: 0.6,
    aimError: 0.045,
    aimErrorFloor: 0.18,
    errorSettle: 0.7,
    trackLag: 0.14,
    velAdapt: 0.2,
    turnRate: 8,
    turnSmooth: 12,
    headChance: 0.25,
    burst: [5, 10],
    burstPause: [0.15, 0.3],
    fireTolerance: 1.0,
    strafe: 0.85,
    plantChance: 0.35,
    jumpRate: 0.25,
    aggression: 0.7,
    hearing: 50,
    hearingNoise: 1.5,
    memory: 3.5,
    fovHalf: 1.2,
    maxAttackers: 3,
    tokenDelay: 0.2,
    retreatAt: 0.35,
    recoilComp: 0.85,
    sniperBots: 2,
    sniperSettle: 0.1,
    adsChance: 0.9,
    aimHeight: 0.65,
  },
};
