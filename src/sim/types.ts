import type { Vec3 } from './vec';

/** Button bitmask carried by every InputCommand. */
export const BTN = {
  JUMP: 1,
  CROUCH: 2,
  FIRE: 4,
  ADS: 8,
  RELOAD: 16,
} as const;

/**
 * The ONLY way anything (local player, bots, future remote players) acts on the simulation.
 * One command is consumed per fixed tick. This is what a client would send to an authoritative server.
 */
export interface InputCommand {
  seq: number;
  yaw: number;
  pitch: number;
  /** -1..1, +1 = forward */
  forward: number;
  /** -1..1, +1 = right */
  strafe: number;
  buttons: number;
  /** Requested weapon slot this tick, -1 = none (switchWeapon command) */
  slot: number;
  /** Scroll wheel weapon cycling: -1, 0, 1 */
  scroll: number;
}

export function emptyCommand(seq = 0): InputCommand {
  return { seq, yaw: 0, pitch: 0, forward: 0, strafe: 0, buttons: 0, slot: -1, scroll: 0 };
}

export type HitPart = 'head' | 'body' | 'limb';
export type WeaponId = 'ar' | 'pistol' | 'melee';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';
export type GameMode = 'ffa' | 'range';

/** Everything that happens in the sim is reported as events. Renderer/audio/HUD only consume these + state. */
export type GameEvent =
  | { type: 'shot'; id: number; weapon: WeaponId; from: Vec3; to: Vec3; hitWorld: boolean; normal: Vec3 | null }
  | { type: 'melee'; id: number; heavy: boolean; lunge: boolean; windup: boolean }
  | {
      type: 'hit';
      attacker: number;
      victim: number;
      damage: number;
      part: HitPart;
      pos: Vec3;
      dir: Vec3;
      killed: boolean;
      backstab: boolean;
      weapon: WeaponId;
    }
  | {
      type: 'kill';
      killer: number;
      victim: number;
      weapon: WeaponId;
      headshot: boolean;
      backstab: boolean;
      dir: Vec3;
    }
  | { type: 'reload'; id: number; weapon: WeaponId }
  | { type: 'reloadDone'; id: number }
  | { type: 'switch'; id: number; weapon: WeaponId }
  | { type: 'dryfire'; id: number }
  | { type: 'jump'; id: number }
  | { type: 'land'; id: number; speed: number }
  | { type: 'step'; id: number }
  | { type: 'slide'; id: number }
  | { type: 'spawn'; id: number }
  | { type: 'matchEnd' };
