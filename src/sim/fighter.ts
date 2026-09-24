import { WEAPONS } from '../config/weapons';
import { MOVE } from '../config/movement';
import type { DummyDef } from './map';
import type { WeaponId } from './types';
import { v3, type Vec3 } from './vec';

export type FighterKind = 'player' | 'bot' | 'dummy';

export interface WeaponSlot {
  id: WeaponId;
  mag: number;
  /** remaining bolt time (delay + cycle) for bolt-action weapons; 0 = chambered. Persists across switches. */
  boltLeft: number;
}

export interface FighterStats {
  objective: number;
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
  headshots: number;
  damage: number;
  streak: number;
  bestStreak: number;
}

/** Complete simulation state of one character. Plain data -> trivially serialisable for netcode. */
export interface Fighter {
  id: number;
  name: string;
  color: number;
  /** outfit variant index (render only, but chosen by the sim so every client agrees) */
  outfit: number;
  kind: FighterKind;

  pos: Vec3; // feet
  prevPos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  prevYaw: number;
  prevPitch: number;
  height: number;
  prevHeight: number;
  /** lower-body facing (hips follow travel direction, upper body follows aim) */
  lowerYaw: number;
  prevLowerYaw: number;
  /** gait phase (radians), advanced by distance travelled so feet stay planted */
  gait: number;
  prevGait: number;
  /** legs run in reverse under the aim (with hysteresis so the 110 degree boundary cannot flicker) */
  backpedal: boolean;
  /** collision-resolved horizontal travel speed of the last tick (m/s, teleports rejected) */
  travelSpeed: number;
  /** EXPERIMENTAL Sketch Slide: sliding on own paint this tick (reduced slide friction) */
  sketchSlide: boolean;
  sketchGrace: number;

  onGround: boolean;
  crouching: boolean;
  sliding: boolean;
  slideTimer: number;
  slideCooldown: number;
  coyote: number;
  jumpBuffer: number;
  airTime: number;
  stepAccum: number;
  lastLandTime: number;
  lastLandSpeed: number;

  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  lastDamageTime: number;
  lastAttacker: number;
  deathTime: number;
  spawnProtect: number;

  weapons: WeaponSlot[];
  cur: number;
  switchTimer: number;
  reloadTimer: number;
  reloadInserted: boolean;
  fireCooldown: number;
  fireQueuedAt: number;
  /** after (re)spawning, FIRE must be released once before a shot can happen */
  fireLock: boolean;
  meleeWindup: number;
  lastMeleeTime: number;
  lastMeleeHeavy: boolean;

  /** sustained recoil (learnable climb) */
  recoilPitch: number;
  recoilYaw: number;
  prevRecoilPitch: number;
  prevRecoilYaw: number;
  /** transient impulse: value at kickTime, decays exp(-(t-kickTime)/tau) */
  kickPitch: number;
  kickYaw: number;
  kickTime: number;
  kickTau: number;
  shotIndex: number;
  lastShotTime: number;
  bloom: number;
  /** linear ADS progress 0..1 (presentation derives eased curves from this) */
  ads: number;
  prevAds: number;

  prevButtons: number;
  stats: FighterStats;

  dummy?: DummyDef;
  dummyT: number;
}

export function createFighter(id: number, name: string, color: number, kind: FighterKind, loadout: WeaponId[]): Fighter {
  return {
    id,
    name,
    color,
    outfit: id % 6,
    kind,
    pos: v3(),
    prevPos: v3(),
    vel: v3(),
    yaw: 0,
    pitch: 0,
    prevYaw: 0,
    prevPitch: 0,
    height: MOVE.standHeight,
    prevHeight: MOVE.standHeight,
    lowerYaw: 0,
    prevLowerYaw: 0,
    gait: 0,
    prevGait: 0,
    backpedal: false,
    travelSpeed: 0,
    sketchSlide: false,
    sketchGrace: 0,
    onGround: true,
    crouching: false,
    sliding: false,
    slideTimer: 0,
    slideCooldown: 0,
    coyote: 0,
    jumpBuffer: 0,
    airTime: 0,
    stepAccum: 0,
    lastLandTime: -99,
    lastLandSpeed: 0,
    hp: 100,
    maxHp: 100,
    alive: false,
    respawnTimer: 0,
    lastDamageTime: -99,
    lastAttacker: -1,
    deathTime: -99,
    spawnProtect: 0,
    weapons: loadout.map((w) => ({ id: w, mag: WEAPONS[w].magSize, boltLeft: 0 })),
    cur: 0,
    switchTimer: 0,
    reloadTimer: 0,
    reloadInserted: false,
    fireCooldown: 0,
    fireQueuedAt: -99,
    fireLock: true,
    meleeWindup: 0,
    lastMeleeTime: -99,
    lastMeleeHeavy: false,
    recoilPitch: 0,
    recoilYaw: 0,
    prevRecoilPitch: 0,
    prevRecoilYaw: 0,
    kickPitch: 0,
    kickYaw: 0,
    kickTime: -99,
    kickTau: 0.05,
    shotIndex: 0,
    lastShotTime: -99,
    bloom: 0,
    ads: 0,
    prevAds: 0,
    prevButtons: 0,
    stats: { objective: 0, kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0, streak: 0, bestStreak: 0 },
    dummyT: 0,
  };
}

export function eyePos(f: Fighter): Vec3 {
  return v3(f.pos.x, f.pos.y + f.height - MOVE.eyeFromTop, f.pos.z);
}

/** Transient recoil impulse at time t. */
export function kickAt(f: Fighter, t: number): { pitch: number; yaw: number } {
  const dtk = t - f.kickTime;
  if (dtk < 0 || dtk > 1) return { pitch: 0, yaw: 0 };
  const k = Math.exp(-dtk / f.kickTau);
  return { pitch: f.kickPitch * k, yaw: f.kickYaw * k };
}

/** Current weapon definition. */
export function curDef(f: Fighter) {
  return WEAPONS[f.weapons[f.cur].id];
}

/** Where the weapon's barrel sits relative to the eye (sim-side, used for obstruction + 3rd-person tracers). */
export function muzzlePos(f: Fighter): Vec3 {
  const e = eyePos(f);
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  const fw = v3(-sy * cp, sp, -cy * cp);
  const rt = v3(cy, 0, -sy);
  const up = v3(sy * sp, cp, cy * sp);
  const a = f.ads;
  const fwd = 0.55, right = 0.13 * (1 - a), down = 0.15 - 0.09 * a;
  return v3(e.x + fw.x * fwd + rt.x * right - up.x * down, e.y + fw.y * fwd - up.y * down, e.z + fw.z * fwd + rt.z * right - up.z * down);
}
