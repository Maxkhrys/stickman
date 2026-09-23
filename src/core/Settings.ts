import type { PrimaryId } from '../config/weapons';
import type { Difficulty, GameMode } from '../sim/types';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch'
  | 'fire' | 'ads' | 'reload' | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'scoreboard' | 'hitboxes' | 'camera' | 'shoulder';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump', crouch: 'Crouch / Slide',
  fire: 'Fire', ads: 'Aim (ADS) / Heavy', reload: 'Reload', weapon1: 'Slot 1', weapon2: 'Slot 2', weapon3: 'Slot 3', weapon4: 'Slot 4',
  scoreboard: 'Scoreboard', hitboxes: 'Hit regions (range)', camera: 'First / third person', shoulder: 'Swap shoulder',
};

export interface Settings {
  /** hip-fire mouse sensitivity multiplier */
  sensitivity: number;
  /** iron-sight ADS multiplier (applied on top of the automatic FOV compensation) */
  adsSensitivity: number;
  /** sniper scope multiplier (applied on top of the automatic FOV compensation) */
  scopeSensitivity: number;
  fov: number; // horizontal degrees
  masterVolume: number;
  weaponVolume: number;
  feedbackVolume: number;
  /** 0..1 camera bob / sway / landing dip / roll / hit shake */
  cameraShake: number;
  fovKick: boolean;
  showFps: boolean;
  damageNumbers: boolean;
  showHitboxes: boolean;
  renderScale: number;
  playerName: string;
  difficulty: Difficulty;
  botCount: number;
  primary: PrimaryId;
  cameraMode: 'first' | 'third';
  shoulder: -1 | 1;
  mapId: 'arena' | 'bookyard';
  mode: GameMode;
  crosshairColor: string;
  /** touch look speed multiplier (phones / tablets) */
  touchSensitivity: number;
  /** touch ADS button: tap to toggle, or hold */
  touchAds: 'toggle' | 'hold';
  /** sand / effect detail: auto picks low on touch devices, high elsewhere */
  graphics: 'auto' | 'high' | 'medium' | 'low';
  keys: Record<Action, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 1,
  scopeSensitivity: 1,
  fov: 100,
  masterVolume: 0.7,
  weaponVolume: 1,
  feedbackVolume: 1,
  cameraShake: 0.7,
  fovKick: true,
  showFps: true,
  damageNumbers: true,
  showHitboxes: false,
  renderScale: 1,
  playerName: 'You',
  difficulty: 'easy',
  botCount: 6,
  primary: 'ar',
  cameraMode: 'first',
  shoulder: 1,
  mapId: 'arena',
  mode: 'range',
  crosshairColor: '#1b1b24',
  touchSensitivity: 1,
  touchAds: 'toggle',
  graphics: 'auto',
  keys: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ShiftLeft',
    fire: 'Mouse0', ads: 'Mouse2', reload: 'KeyR', weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4',
    scoreboard: 'Tab', hitboxes: 'KeyH', camera: 'KeyV', shoulder: 'KeyQ',
  },
};

const KEY = 'stickfight.settings.v2';
const OLD_KEY = 'stickfight.settings.v1';

function sanitize(p: Partial<Settings> & { volume?: number; cameraBob?: number }): Settings {
  const s: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...p, keys: { ...DEFAULT_SETTINGS.keys, ...(p.keys ?? {}) } };
  if (!['easy', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = 'hard';
  if (p.volume !== undefined && p.masterVolume === undefined) s.masterVolume = p.volume;
  if (p.cameraBob !== undefined && p.cameraShake === undefined) s.cameraShake = p.cameraBob;
  if (!['ar', 'sniper', 'smg', 'carbine'].includes(s.primary)) s.primary = 'ar';
  if (!['ffa', 'range', 'sketch'].includes(s.mode)) s.mode = 'range';
  if (s.cameraMode !== 'third') s.cameraMode = 'first';
  if (s.mapId !== 'bookyard') s.mapId = 'arena';
  s.shoulder = s.shoulder === -1 ? -1 : 1;
  s.botCount = Math.max(1, Math.min(8, Math.round(s.botCount || 6)));
  s.fov = Math.max(70, Math.min(120, s.fov));
  s.touchSensitivity = Math.max(0.2, Math.min(3, Number(s.touchSensitivity) || 1));
  if (s.touchAds !== 'hold') s.touchAds = 'toggle';
  if (!['auto', 'high', 'medium', 'low'].includes(s.graphics)) s.graphics = 'auto';
  delete (s as unknown as Record<string, unknown>).volume;
  delete (s as unknown as Record<string, unknown>).cameraBob;
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return sanitize(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) - settings just won't persist */
  }
}

export function keyName(code: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse1') return 'MMB';
  if (code === 'Mouse2') return 'RMB';
  if (code.startsWith('Mouse')) return 'M' + code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace('Left', 'L-').replace('Right', 'R-');
}
