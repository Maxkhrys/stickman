import type { WeaponId } from '../sim/types';

/** Short opaque ink strokes; thickness is additionally clamped in screen pixels. */
export const SHOT_STYLE: Record<WeaponId, { width: number; color: number; enemy: number; speed: number; length: number; flash: number }> = {
  ar: { width: 0.022, color: 0x1b1b24, enemy: 0xe8327f, speed: 330, length: 3.2, flash: 0.18 },
  smg: { width: 0.020, color: 0x2b2d42, enemy: 0xe8327f, speed: 300, length: 1.8, flash: 0.15 },
  carbine: { width: 0.014, color: 0x14141c, enemy: 0xe8327f, speed: 380, length: 4.2, flash: 0.20 },
  sniper: { width: 0.030, color: 0x4a4a58, enemy: 0x4a4a58, speed: 440, length: 6.5, flash: 0.26 },
  pistol: { width: 0.025, color: 0xb58100, enemy: 0xff4f9a, speed: 280, length: 1.3, flash: 0.15 },
  melee: { width: 0, color: 0, enemy: 0, speed: 1, length: 0, flash: 0 },
};
