import { WEAPONS } from '../config/weapons';
import { MOVE } from '../config/movement';
import type { DummyDef } from './map';
import type { WeaponId } from './types';
import { forwardFromAngles, v3, type Vec3 } from './vec';
import { socketWorld, weaponFrame } from './weaponFrame';

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
  lastJumpTime: number;
  /** air jumps / air dashes left this airtime (refilled on a confirmed landing) */
  airJumpsLeft: number;
  airDashesLeft: number;
  lastAirJumpTime: number;
  /** dash charges (fractional while refilling) */
  dashCharges: number;
  /** remaining active dash time; > 0 = dashing */
  dashTimer: number;
  dashDirX: number;
  dashDirZ: number;
  dashAir: boolean;
  /** remaining ground-dodge-roll time (> 0 = rolling); drives the roll animation and the tucked hit profile */
  rollTimer: number;
  lastDashTime: number;
  slideTime: number;
  lastSlideBoostTime: number;
  /** sim time the current ADS began (for quickscope feedback) */
  adsStartTime: number;
  /** aim origin offset from the eye used by the last command (camera position) */
  aimOX: number;
  aimOY: number;
  aimOZ: number;

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
    lastJumpTime: -99,
    airJumpsLeft: MOVE.airJumps,
    airDashesLeft: MOVE.airDashes,
    lastAirJumpTime: -99,
    dashCharges: MOVE.dashCharges,
    dashTimer: 0,
    dashDirX: 0,
    dashDirZ: -1,
    dashAir: false,
    rollTimer: 0,
    lastDashTime: -99,
    slideTime: 0,
    lastSlideBoostTime: -99,
    adsStartTime: -99,
    aimOX: 0,
    aimOY: 0,
    aimOZ: 0,
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

/** Where the weapon's muzzle is (sim side: shot traces, obstruction, tracer origin for remote fighters). */
export function muzzlePos(f: Fighter): Vec3 {
  const e = eyePos(f);
  const w = weaponFrame(e, f.yaw, f.pitch, f.weapons[f.cur].id, f.ads);
  if (w) return socketWorld(w, w.model.muzzle);
  // melee / no model: a point just ahead of the right shoulder
  const fw = forwardFromAngles(f.yaw, f.pitch);
  return v3(e.x + fw.x * 0.5 + Math.cos(f.yaw) * 0.15, e.y + fw.y * 0.5 - 0.2, e.z + fw.z * 0.5 - Math.sin(f.yaw) * 0.15);
}
