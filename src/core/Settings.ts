import type { Difficulty, GameMode } from '../sim/types';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch'
  | 'fire' | 'ads' | 'reload' | 'weapon1' | 'weapon2' | 'weapon3' | 'scoreboard';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', jump: 'Jump', crouch: 'Crouch / Slide',
  fire: 'Fire', ads: 'Aim (ADS) / Heavy', reload: 'Reload', weapon1: 'Rifle', weapon2: 'Pistol', weapon3: 'Pencil', scoreboard: 'Scoreboard',
};

export interface Settings {
  sensitivity: number; // multiplier
  adsSensitivity: number;
  fov: number; // horizontal degrees
  volume: number;
  cameraBob: number; // 0..1
  fovKick: boolean;
  showFps: boolean;
  renderScale: number;
  playerName: string;
  difficulty: Difficulty;
  mode: GameMode;
  crosshairColor: string;
  keys: Record<Action, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 0.8,
  fov: 100,
  volume: 0.7,
  cameraBob: 1,
  fovKick: true,
  showFps: true,
  renderScale: 1,
  playerName: 'You',
  difficulty: 'hard',
  mode: 'range',
  crosshairColor: '#1b1b24',
  keys: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'ShiftLeft',
    fire: 'Mouse0', ads: 'Mouse2', reload: 'KeyR', weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', scoreboard: 'Tab',
  },
};

const KEY = 'stickfight.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const p = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULT_SETTINGS), ...p, keys: { ...DEFAULT_SETTINGS.keys, ...(p.keys ?? {}) } };
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
