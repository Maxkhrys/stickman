import { BTN, type InputCommand } from '../sim/types';
import type { Action, Settings } from './Settings';
import { TouchControls, wantsTouchControls, type TouchAction } from '../ui/TouchControls';

/** Radians per mouse count at sensitivity 1 (close to Krunker/Source defaults). */
const BASE_SENS = 0.0022;

/**
 * Raw input -> InputCommand. Mouse deltas are immediate, without smoothing/acceleration.
 * `locked` retains the App's input-session contract: pointer lock on desktop, an explicit
 * Play/Resume touch session on mobile. `pointerLocked` tracks actual browser pointer lock.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;
  readonly touchMode = wantsTouchControls();
  private pointerLocked = false;
  private touchControls: TouchControls | null = null;
  private touchHeld = new Set<TouchAction>();
  private touchLatched = new Set<TouchAction>();
  private touchForward = 0;
  private touchStrafe = 0;
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
    if (this.touchMode) {
      this.touchControls = new TouchControls({
        move: (forward, strafe) => { this.touchForward = forward; this.touchStrafe = strafe; },
        look: (dx, dy) => {
          if (!this.locked) return;
          // CSS pixels, not device pixels; a screen-width drag turns ~240 degrees at sensitivity 1.
          const s = (Math.PI * 1.35 / Math.max(320, innerWidth)) * this.settings.sensitivity * this.sensScale;
          this.yaw -= dx * s;
          this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * s));
          this.frameDX += dx * s / BASE_SENS;
          this.frameDY += dy * s / BASE_SENS;
        },
        action: (action, down) => {
          if (!this.locked) return;
          if (down) {
            if (!this.touchHeld.has(action)) {
              this.touchLatched.add(action);
              if (action === 'fire') this.lastFirePress = performance.now();
            }
            this.touchHeld.add(action);
          } else this.touchHeld.delete(action);
        },
        cancel: action => { this.touchHeld.delete(action); this.touchLatched.delete(action); },
        cycle: direction => { this.scrollAcc += direction; },
        pause: () => this.onPauseRequest?.(),
        camera: () => this.onToggleCamera?.(),
        shoulder: () => this.onSwapShoulder?.(),
        scoreboard: visible => this.onScoreboard?.(visible),
        hitboxes: () => this.onToggleHitboxes?.(),
      });
    }
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.touchMode) return;
      const was = this.locked;
      this.locked = this.pointerLocked;
      if (was && !this.locked) {
        this.clear();
        this.onPauseRequest?.();
      }
    });
    // browsers refuse re-locking for ~1s after Esc: fall back to a resumable pause screen
    document.addEventListener('pointerlockerror', () => {
      if (!this.touchMode && !this.requestingLock) this.onPauseRequest?.();
    });
    document.addEventListener('mousemove', e => {
      if (!this.pointerLocked || this.touchMode) return;
      const s = BASE_SENS * this.settings.sensitivity * this.sensScale;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      this.frameDX += e.movementX;
      this.frameDY += e.movementY;
    });
    window.addEventListener('keydown', e => {
      if (this.rebindCallback) {
        e.preventDefault();
        this.rebindCallback(e.code);
        return;
      }
      if (this.locked && e.code === 'Escape') { this.unlock(); this.onPauseRequest?.(); return; }
      if (this.locked && e.code === 'Tab') e.preventDefault();
      if (!this.locked) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.press(e.code);
    });
    window.addEventListener('keyup', e => this.release(e.code));
    window.addEventListener('mousedown', e => {
      if (this.rebindCallback && e.target instanceof HTMLElement && e.target.closest('.rebinding')) {
        e.preventDefault();
        this.rebindCallback('Mouse' + e.button);
        return;
      }
      // Ignore touch-generated compatibility mouse events: a tap must never fire twice.
      if (this.pointerLocked && !this.touchMode) this.press('Mouse' + e.button);
    });
    window.addEventListener('mouseup', e => this.release('Mouse' + e.button));
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('wheel', e => {
      if (!this.pointerLocked || this.touchMode) return;
      this.scrollAcc += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('blur', () => {
      this.clear();
      if (this.touchMode && this.locked) this.onPauseRequest?.();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clear();
        if (this.touchMode && this.locked) this.onPauseRequest?.();
      }
    });
    window.addEventListener('resize', () => {
      if (!this.touchMode) return;
      this.clear(); // never keep pre-rotation pointer coordinates or held fire
      if (this.locked && innerHeight > innerWidth) this.onPauseRequest?.();
    });
    window.addEventListener('pagehide', () => {
      this.clear();
      if (this.touchMode && this.locked) this.onPauseRequest?.();
    });
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
    this.touchHeld.clear();
    this.touchLatched.clear();
    this.touchForward = this.touchStrafe = 0;
    this.frameDX = this.frameDY = 0;
    this.slotReq = -1;
    this.scrollAcc = 0;
    this.touchControls?.reset();
    this.onScoreboard?.(false);
  }

  async lock() {
    if (this.touchMode) {
      if (innerHeight > innerWidth) {
        this.onPauseRequest?.(); // menus remain usable; rotate and explicitly Resume
        return;
      }
      this.clear();
      this.locked = true;
      this.touchControls?.setActive(true);
      return;
    }
    if (this.requestingLock) return;
    this.requestingLock = true;
    try {
      await (this.canvas.requestPointerLock as (o?: object) => Promise<void>).call(this.canvas, { unadjustedMovement: true });
    } catch {
      try {
        await (this.canvas.requestPointerLock as () => Promise<void> | void).call(this.canvas);
      } catch {
        this.onPauseRequest?.();
      }
    } finally {
      this.requestingLock = false;
    }
  }

  unlock() {
    if (this.touchMode) {
      this.locked = false;
      this.touchControls?.setActive(false);
      this.clear();
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private down(a: Action): boolean {
    const c = this.settings.keys[a];
    return this.held.has(c) || this.latched.has(c) ||
      this.touchHeld.has(a as TouchAction) || this.touchLatched.has(a as TouchAction);
  }

  /** Build the same command for desktop and touch. Latches keep taps shorter than a tick. */
  buildCommand(): InputCommand {
    let buttons = 0;
    if (this.down('jump')) buttons |= BTN.JUMP;
    if (this.down('crouch')) buttons |= BTN.CROUCH;
    if (this.down('fire')) buttons |= BTN.FIRE;
    if (this.down('ads')) buttons |= BTN.ADS;
    if (this.down('reload')) buttons |= BTN.RELOAD;
    const fwd = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0) + this.touchForward;
    const str = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0) + this.touchStrafe;
    const cmd: InputCommand = {
      seq: this.seq++,
      yaw: this.yaw,
      pitch: this.pitch,
      forward: Math.max(-1, Math.min(1, fwd)),
      strafe: Math.max(-1, Math.min(1, str)),
      buttons,
      slot: this.slotReq,
      scroll: Math.max(-1, Math.min(1, this.scrollAcc)),
    };
    this.slotReq = -1;
    this.scrollAcc = 0;
    this.latched.clear();
    this.touchLatched.clear();
    return cmd;
  }

  consumeFrameDelta(): [number, number] {
    const r: [number, number] = [this.frameDX, this.frameDY];
    this.frameDX = this.frameDY = 0;
    return r;
  }

  isHeld(a: Action) {
    return this.held.has(this.settings.keys[a]) || this.touchHeld.has(a as TouchAction);
  }
}
