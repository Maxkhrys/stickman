import { LOADOUT, WEAPONS } from '../config/weapons';
import { MOVE } from '../config/movement';
import type { DummyDef } from './map';
import type { WeaponId } from './types';
import { v3, type Vec3 } from './vec';

export type FighterKind = 'player' | 'bot' | 'dummy';

export interface WeaponSlot {
  id: WeaponId;
  mag: number;
}

export interface FighterStats {
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

  onGround: boolean;
  crouching: boolean;
  sliding: boolean;
  slideTimer: number;
  slideCooldown: number;
  coyote: number;
  jumpBuffer: number;
  airTime: number;
  stepAccum: number;

  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTimer: number;
  lastDamageTime: number;
  lastAttacker: number;
  deathTime: number;

  weapons: WeaponSlot[];
  cur: number;
  switchTimer: number;
  reloadTimer: number;
  fireCooldown: number;
  fireQueuedAt: number;
  meleeWindup: number;
  lastMeleeTime: number;
  lastMeleeHeavy: boolean;

  recoilPitch: number;
  recoilYaw: number;
  prevRecoilPitch: number;
  prevRecoilYaw: number;
  shotIndex: number;
  lastShotTime: number;
  bloom: number;
  ads: number;

  prevButtons: number;
  stats: FighterStats;

  dummy?: DummyDef;
  dummyT: number;
}

export function createFighter(id: number, name: string, color: number, kind: FighterKind): Fighter {
  return {
    id,
    name,
    color,
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
    onGround: true,
    crouching: false,
    sliding: false,
    slideTimer: 0,
    slideCooldown: 0,
    coyote: 0,
    jumpBuffer: 0,
    airTime: 0,
    stepAccum: 0,
    hp: 100,
    maxHp: 100,
    alive: false,
    respawnTimer: 0,
    lastDamageTime: -99,
    lastAttacker: -1,
    deathTime: -99,
    weapons: LOADOUT.map((w) => ({ id: w, mag: WEAPONS[w].magSize })),
    cur: 0,
    switchTimer: 0,
    reloadTimer: 0,
    fireCooldown: 0,
    fireQueuedAt: -99,
    meleeWindup: 0,
    lastMeleeTime: -99,
    lastMeleeHeavy: false,
    recoilPitch: 0,
    recoilYaw: 0,
    prevRecoilPitch: 0,
    prevRecoilYaw: 0,
    shotIndex: 0,
    lastShotTime: -99,
    bloom: 0,
    ads: 0,
    prevButtons: 0,
    stats: { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0, streak: 0, bestStreak: 0 },
    dummyT: 0,
  };
}

export function eyePos(f: Fighter): Vec3 {
  return v3(f.pos.x, f.pos.y + f.height - MOVE.eyeFromTop, f.pos.z);
}

export function chestPos(f: Fighter): Vec3 {
  return v3(f.pos.x, f.pos.y + f.height * 0.66, f.pos.z);
}
