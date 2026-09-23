import { BTN, type InputCommand } from '../sim/types';
import type { Action, Settings } from './Settings';

/** Radians per mouse count at sensitivity 1 (close to Krunker/Source defaults). */
const BASE_SENS = 0.0022;

/**
 * Raw input -> InputCommand. Mouse deltas are applied immediately to yaw/pitch (no smoothing,
 * no acceleration). Key presses are latched so taps shorter than a tick are never lost.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;
  frameDX = 0;
  frameDY = 0;
  /** sensitivity scale set every frame by the game (FOV compensation x ADS/scope multiplier) */
  sensScale = 1;
  /** timestamp of the last fire-button press (for latency measurement) */
  lastFirePress = 0;
  onToggleHitboxes: (() => void) | null = null;
  onToggleCamera: (() => void) | null = null;
  onSwapShoulder: (() => void) | null = null;
  private requestingLock = false;
  private held = new Set<string>();
  private latched = new Set<string>();
  private scrollAcc = 0;
  private slotReq = -1;
  private seq = 0;
  onPauseRequest: (() => void) | null = null;
  onScoreboard: ((show: boolean) => void) | null = null;
  rebindCallback: ((code: string) => void) | null = null;

  constructor(private settings: Settings, private canvas: HTMLCanvasElement) {
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked) {
        this.clear();
        this.onPauseRequest?.();
      }
    });
    // browsers refuse re-locking for ~1s after Esc: fall back to the pause menu instead of a dead state
    document.addEventListener('pointerlockerror', () => { if (!this.requestingLock) this.onPauseRequest?.(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = BASE_SENS * this.settings.sensitivity * this.sensScale;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      this.frameDX += e.movementX;
      this.frameDY += e.movementY;
    });
    window.addEventListener('keydown', (e) => {
      if (this.rebindCallback) {
        e.preventDefault();
        this.rebindCallback(e.code);
        return;
      }
      if (this.locked && e.code === 'Tab') e.preventDefault();
      if (!this.locked) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.press(e.code);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('mousedown', (e) => {
      if (this.rebindCallback && e.target instanceof HTMLElement && e.target.closest('.rebinding')) {
        e.preventDefault();
        this.rebindCallback('Mouse' + e.button);
        return;
      }
      if (this.locked) this.press('Mouse' + e.button);
    });
    window.addEventListener('mouseup', (e) => this.release('Mouse' + e.button));
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.scrollAcc += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    window.addEventListener('blur', () => this.clear());
  }

  private press(code: string) {
    const fresh = !this.held.has(code);
    if (fresh) this.latched.add(code);
    this.held.add(code);
    const k = this.settings.keys;
    if (code === k.weapon1) this.slotReq = 0;
    if (code === k.weapon2) this.slotReq = 1;
    if (code === k.weapon3) this.slotReq = 2;
    if (code === k.weapon4) this.slotReq = 3;
    if (code === k.fire) this.lastFirePress = performance.now();
    if (fresh && code === k.hitboxes) this.onToggleHitboxes?.();
    if (fresh && code === k.camera) this.onToggleCamera?.();
    if (fresh && code === k.shoulder) this.onSwapShoulder?.();
    if (code === k.scoreboard) this.onScoreboard?.(true);
  }

  private release(code: string) {
    this.held.delete(code);
    if (code === this.settings.keys.scoreboard) this.onScoreboard?.(false);
  }

  private clear() {
    this.held.clear();
    this.latched.clear();
    this.slotReq = -1;
    this.scrollAcc = 0;
    this.onScoreboard?.(false);
  }

  async lock() {
    if (this.requestingLock) return;
    this.requestingLock = true;
    try {
      // unadjustedMovement = raw input (no OS acceleration) where supported
      await (this.canvas.requestPointerLock as (o?: object) => Promise<void>).call(this.canvas, { unadjustedMovement: true });
    } catch {
      try {
        await (this.canvas.requestPointerLock as () => Promise<void> | void).call(this.canvas);
      } catch {
        this.onPauseRequest?.(); // fallback also failed; show a resumable pause screen
      }
    } finally {
      this.requestingLock = false;
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private down(a: Action): boolean {
    const c = this.settings.keys[a];
    return this.held.has(c) || this.latched.has(c);
  }

  /** Build the command for this tick and clear one-shot latches. */
  buildCommand(): InputCommand {
    let buttons = 0;
    if (this.down('jump')) buttons |= BTN.JUMP;
    if (this.down('crouch')) buttons |= BTN.CROUCH;
    if (this.down('fire')) buttons |= BTN.FIRE;
    if (this.down('ads')) buttons |= BTN.ADS;
    if (this.down('reload')) buttons |= BTN.RELOAD;
    const fwd = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    const str = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const cmd: InputCommand = {
      seq: this.seq++,
      yaw: this.yaw,
      pitch: this.pitch,
      forward: fwd,
      strafe: str,
      buttons,
      slot: this.slotReq,
      scroll: Math.max(-1, Math.min(1, this.scrollAcc)),
    };
    this.slotReq = -1;
    this.scrollAcc = 0;
    this.latched.clear();
    return cmd;
  }

  consumeFrameDelta(): [number, number] {
    const r: [number, number] = [this.frameDX, this.frameDY];
    this.frameDX = this.frameDY = 0;
    return r;
  }

  isHeld(a: Action) {
    return this.held.has(this.settings.keys[a]);
  }
}
