import type { Action, Settings } from '../core/Settings';
import type { Input } from '../core/Input';

/**
 * On-screen controls for phones and tablets. They only ever call Input's touch methods, so
 * touch play produces exactly the same InputCommands (and the same simulation) as keyboard +
 * mouse. Every finger is owned by the control it started on (pointer capture), so fingers can
 * cross over other controls without stealing or dropping input.
 *
 *  left half:   floating analog stick (appears under the thumb)
 *  right half:  drag anywhere to look; FIRE and ADS also aim while held and dragged
 *  buttons:     FIRE, ADS, JUMP, CROUCH/SLIDE, RELOAD, SWAP weapon, camera, scores, pause
 */

type Owner =
  | { kind: 'stick'; x0: number; y0: number }
  | { kind: 'look'; x: number; y: number }
  | { kind: 'button'; action: Action | 'swap' | 'pause'; x: number; y: number; looking: boolean; moved: number };

const STICK_R = 58; // px travel for full deflection
const DEAD = 0.12;
const LOOK_SLOP = 5; // px before a held FIRE/ADS finger starts aiming (keeps taps steady)

interface ButtonDef {
  id: Action | 'swap' | 'pause';
  label: string;
  cls: string;
  /** a finger that starts here can also aim by dragging */
  aims?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { id: 'fire', label: 'FIRE', cls: 'tb fire', aims: true },
  { id: 'ads', label: 'AIM', cls: 'tb ads', aims: true },
  { id: 'jump', label: 'JUMP', cls: 'tb jump' },
  { id: 'crouch', label: 'SLIDE', cls: 'tb crouch' },
  { id: 'reload', label: 'R', cls: 'tb reload' },
  { id: 'swap', label: '⇄', cls: 'tb swap' },
  { id: 'camera', label: '👁', cls: 'tb small cam' },
  { id: 'scoreboard', label: '☰', cls: 'tb small board' },
  { id: 'pause', label: 'Ⅱ', cls: 'tb small pause' },
];

export class TouchControls {
  readonly root = document.createElement('div');
  private stickBase = document.createElement('div');
  private stickKnob = document.createElement('div');
  private owners = new Map<number, Owner>();
  private btn = new Map<string, HTMLElement>();
  private adsToggled = false;
  private active = false;
  onPause: (() => void) | null = null;

  constructor(private input: Input, private settings: Settings) {
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.stickBase.className = 'stick hidden';
    this.stickKnob.className = 'knob';
    this.stickBase.appendChild(this.stickKnob);
    this.root.appendChild(this.stickBase);
    for (const b of BUTTONS) {
      const e = document.createElement('div');
      e.className = b.cls;
      e.dataset.action = b.id;
      e.innerHTML = `<span>${b.label}</span>`;
      this.root.appendChild(e);
      this.btn.set(b.id, e);
    }
    const rotate = document.createElement('div');
    rotate.className = 'rotate-hint';
    rotate.innerHTML = '<div class="phone"></div><p>Turn your phone sideways to play</p>';
    document.body.appendChild(rotate);

    const opts = { passive: false } as const;
    this.root.addEventListener('pointerdown', (e) => this.down(e), opts);
    this.root.addEventListener('pointermove', (e) => this.move(e), opts);
    this.root.addEventListener('pointerup', (e) => this.up(e), opts);
    this.root.addEventListener('pointercancel', (e) => this.up(e), opts);
    this.root.addEventListener('lostpointercapture', (e) => this.up(e));
    // no browser gestures while playing: scrolling, pinch zoom, long-press menus, text selection
    for (const t of ['touchstart', 'touchmove', 'gesturestart', 'contextmenu', 'selectstart'] as const) {
      this.root.addEventListener(t, (e) => e.preventDefault(), opts);
    }
  }

  /** shown only while actually playing */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) this.releaseAll();
  }

  /** forget toggled ADS etc. (death, pause, weapon lost) */
  releaseAll() {
    for (const [, o] of this.owners) if (o.kind === 'button') this.releaseButton(o);
    this.owners.clear();
    this.adsToggled = false;
    this.input.touchRelease('ads');
    this.input.touchMove(0, 0);
    this.stickBase.classList.add('hidden');
    for (const e of this.btn.values()) e.classList.remove('on');
  }

  /** per-frame HUD sync: weapon name on the swap button, ADS toggle state, reload hint */
  update(weaponName: string, canAds: boolean, mag: number, magSize: number) {
    const swap = this.btn.get('swap')!;
    if (swap.dataset.w !== weaponName) {
      swap.dataset.w = weaponName;
      swap.innerHTML = `<span>⇄</span><small>${weaponName}</small>`;
    }
    this.btn.get('ads')!.classList.toggle('on', this.adsToggled || this.input.touchHeld('ads'));
    this.btn.get('ads')!.classList.toggle('off', !canAds);
    this.btn.get('reload')!.classList.toggle('hint', magSize > 0 && mag <= Math.ceil(magSize * 0.2));
  }

  private down(e: PointerEvent) {
    if (!this.active) return;
    e.preventDefault();
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests can't be captured; ownership map still works */
    }
    if (t) {
      const action = t.dataset.action as Action | 'swap' | 'pause';
      const o: Owner = { kind: 'button', action, x: e.clientX, y: e.clientY, looking: false, moved: 0 };
      this.owners.set(e.pointerId, o);
      t.classList.add('on');
      if (action === 'pause') {
        this.onPause?.();
        return;
      }
      if (action === 'swap') {
        this.input.touchScroll(1);
        return;
      }
      if (action === 'ads' && this.settings.touchAds === 'toggle') {
        this.adsToggled = !this.adsToggled;
        if (this.adsToggled) this.input.touchPress('ads');
        else this.input.touchRelease('ads');
        return;
      }
      this.input.touchPress(action);
      return;
    }
    if (e.clientX < window.innerWidth * 0.42) {
      // floating stick: the base appears under the thumb (clamped away from screen edges)
      const x0 = Math.max(STICK_R + 8, Math.min(window.innerWidth * 0.42 - STICK_R, e.clientX));
      const y0 = Math.max(STICK_R + 8, Math.min(window.innerHeight - STICK_R - 8, e.clientY));
      this.owners.set(e.pointerId, { kind: 'stick', x0, y0 });
      this.stickBase.style.transform = `translate(${x0}px, ${y0}px)`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.remove('hidden');
      this.stickTo(e.clientX, e.clientY, x0, y0);
      return;
    }
    this.owners.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
  }

  private move(e: PointerEvent) {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    e.preventDefault();
    // coalesced samples: every hardware sample counts (fast flicks), still applied this frame
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = evs.length ? evs : [e];
    const last = samples[samples.length - 1];
    if (o.kind === 'stick') {
      this.stickTo(last.clientX, last.clientY, o.x0, o.y0);
      return;
    }
    let dx = 0, dy = 0;
    let x = o.x, y = o.y;
    for (const s of samples) {
      dx += s.clientX - x;
      dy += s.clientY - y;
      x = s.clientX;
      y = s.clientY;
    }
    o.x = x;
    o.y = y;
    if (o.kind === 'look') {
      this.input.touchLook(dx, dy);
      return;
    }
    const def = BUTTONS.find((b) => b.id === o.action);
    if (!def?.aims) return;
    o.moved += Math.hypot(dx, dy);
    if (!o.looking && o.moved < LOOK_SLOP) return;
    o.looking = true;
    this.input.touchLook(dx, dy);
  }

  private up(e: PointerEvent) {
    const o = this.owners.get(e.pointerId);
    if (!o) return;
    this.owners.delete(e.pointerId);
    if (o.kind === 'stick') {
      this.input.touchMove(0, 0);
      this.stickBase.classList.add('hidden');
    } else if (o.kind === 'button') this.releaseButton(o);
  }

  private releaseButton(o: Extract<Owner, { kind: 'button' }>) {
    const el = this.btn.get(o.action);
    if (o.action === 'ads' && this.settings.touchAds === 'toggle') {
      el?.classList.toggle('on', this.adsToggled);
      return;
    }
    el?.classList.remove('on');
    if (o.action !== 'swap' && o.action !== 'pause') this.input.touchRelease(o.action);
  }

  private stickTo(x: number, y: number, x0: number, y0: number) {
    let dx = x - x0, dy = y - y0;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx *= STICK_R / d;
      dy *= STICK_R / d;
    }
    this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let m = Math.min(1, d / STICK_R);
    // dead zone, then a gentle curve so small tilts walk and full tilt runs
    m = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    m = Math.min(1, m * 1.08);
    const len = Math.hypot(dx, dy) || 1;
    this.input.touchMove((-dy / len) * m, (dx / len) * m);
  }
}
