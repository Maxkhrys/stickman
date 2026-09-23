import './touch.css';

export type TouchAction = 'fire' | 'ads' | 'jump' | 'crouch' | 'reload';
export interface TouchPort {
  move: (forward: number, strafe: number) => void;
  look: (dx: number, dy: number) => void;
  action: (action: TouchAction, down: boolean) => void;
  cancel: (action: TouchAction) => void;
  cycle: (direction: number) => void;
  pause: () => void;
  camera: () => void;
  shoulder: () => void;
  scoreboard: (visible: boolean) => void;
  hitboxes: () => void;
}

type Contact = {
  target: HTMLElement;
  kind: 'move' | 'look' | 'fire' | 'jump' | 'crouch';
  x: number;
  y: number;
};

/** Capability detection, not a phone-model list. Override also supports hybrid-device testing. */
export function wantsTouchControls(): boolean {
  const override = new URLSearchParams(location.search).get('controls');
  if (override === 'touch') return true;
  if (override === 'desktop') return false;
  return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

/** Pointer-owned controls: moving, aiming and firing can all be held independently. */
export class TouchControls {
  readonly root = document.createElement('div');
  private contacts = new Map<number, Contact>();
  private enabled = false;
  private ads = false;
  private board = false;
  private stick: HTMLElement;
  private aimButton: HTMLButtonElement;
  private scoreButton: HTMLButtonElement;

  constructor(private port: TouchPort) {
    document.documentElement.classList.add('touch-mode');
    this.root.id = 'touch-controls';
    this.root.setAttribute('aria-label', 'Touch game controls');
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="touch-look" data-touch="look" aria-label="Drag to look"></div>
      <div class="touch-move" data-touch="move" aria-label="Movement stick"><span class="touch-stick"></span><span class="touch-move-label">MOVE</span></div>
      <div class="touch-toolbar">
        <button type="button" data-touch="camera" aria-label="Switch first or third person">VIEW</button>
        <button type="button" data-touch="shoulder" aria-label="Swap camera shoulder">SIDE</button>
        <button type="button" data-touch="score" aria-label="Toggle scoreboard" aria-pressed="false">SCORE</button>
        <button type="button" data-touch="hitboxes" aria-label="Toggle practice hit regions">HITS</button>
      </div>
      <button type="button" class="touch-pause" data-touch="pause" aria-label="Pause game">Ⅱ</button>
      <button type="button" class="touch-fire" data-touch="fire" aria-label="Fire and drag to aim"><span>◎</span>FIRE</button>
      <button type="button" class="touch-aim" data-touch="ads" aria-label="Toggle aim or scope" aria-pressed="false">AIM</button>
      <button type="button" class="touch-jump" data-touch="jump" aria-label="Jump">JUMP</button>
      <button type="button" class="touch-crouch" data-touch="crouch" aria-label="Hold crouch or slide">SLIDE</button>
      <button type="button" class="touch-reload" data-touch="reload" aria-label="Reload">RELOAD</button>
      <button type="button" class="touch-next" data-touch="next" aria-label="Next weapon">NEXT ›</button>
      <button type="button" class="touch-prev" data-touch="previous" aria-label="Previous weapon">‹ GUN</button>
      <span class="touch-tip">Drag the right side to look. Hold FIRE and drag to shoot + aim.</span>`;
    this.stick = this.root.querySelector('.touch-stick')!;
    this.aimButton = this.root.querySelector('[data-touch="ads"]')!;
    this.scoreButton = this.root.querySelector('[data-touch="score"]')!;
    document.body.append(this.root);
    const hint = document.createElement('div');
    hint.className = 'touch-rotate-hint';
    hint.innerHTML = '<b>↻ Turn your phone sideways</b><span>Landscape touch controls · then tap Play or Resume</span>';
    document.body.append(hint);

    this.root.addEventListener('pointerdown', e => this.down(e));
    this.root.addEventListener('pointermove', e => this.move(e));
    this.root.addEventListener('pointerup', e => this.up(e, false));
    this.root.addEventListener('pointercancel', e => this.up(e, true));
    this.root.addEventListener('lostpointercapture', e => this.up(e, true));
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    // Pointer handlers own activation. Suppress compatibility clicks (including double-tap zoom).
    this.root.addEventListener('click', e => e.preventDefault());
  }

  setActive(active: boolean) {
    this.reset();
    this.enabled = active;
    this.root.hidden = !active;
    document.documentElement.classList.toggle('touch-playing', active);
  }

  reset() {
    // Delete ownership first: releasing capture can synchronously deliver lostpointercapture.
    const contacts = [...this.contacts];
    this.contacts.clear();
    for (const [id, c] of contacts) {
      if (c.target.hasPointerCapture(id)) c.target.releasePointerCapture(id);
    }
    this.port.move(0, 0);
    for (const action of ['fire', 'ads', 'jump', 'crouch', 'reload'] as const) this.port.cancel(action);
    this.ads = this.board = false;
    this.port.scoreboard(false);
    this.stick.style.transform = '';
    this.aimButton.setAttribute('aria-pressed', 'false');
    this.scoreButton.setAttribute('aria-pressed', 'false');
    for (const el of this.root.querySelectorAll('.is-down')) el.classList.remove('is-down');
  }

  private down(e: PointerEvent) {
    if (!this.enabled || e.pointerType === 'mouse') return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-touch]');
    if (!target) return;
    e.preventDefault();
    const kind = target.dataset.touch!;
    // Never let a second finger steal an existing stick, look surface or held button.
    if ([...this.contacts.values()].some(c => c.target === target)) return;
    if (kind === 'move' || kind === 'look' || kind === 'fire' || kind === 'jump' || kind === 'crouch') {
      this.contacts.set(e.pointerId, { target, kind, x: e.clientX, y: e.clientY });
      target.setPointerCapture(e.pointerId);
      target.classList.add('is-down');
      if (kind === 'move') this.moveStick(target, e.clientX, e.clientY);
      if (kind === 'fire' || kind === 'jump' || kind === 'crouch') this.port.action(kind, true);
      return;
    }
    switch (kind) {
      case 'ads':
        this.ads = !this.ads;
        this.aimButton.setAttribute('aria-pressed', String(this.ads));
        this.port.action('ads', this.ads);
        break;
      case 'reload': this.port.action('reload', true); this.port.action('reload', false); break;
      case 'next': this.port.cycle(1); break;
      case 'previous': this.port.cycle(-1); break;
      case 'camera': this.port.camera(); break;
      case 'shoulder': this.port.shoulder(); break;
      case 'score':
        this.board = !this.board;
        this.scoreButton.setAttribute('aria-pressed', String(this.board));
        this.port.scoreboard(this.board);
        break;
      case 'hitboxes': this.port.hitboxes(); break;
      case 'pause': this.port.pause(); break;
    }
  }

  private move(e: PointerEvent) {
    const contact = this.contacts.get(e.pointerId);
    if (!this.enabled || !contact) return;
    e.preventDefault();
    if (contact.kind === 'move') this.moveStick(contact.target, e.clientX, e.clientY);
    else if (contact.kind === 'look' || contact.kind === 'fire') {
      this.port.look(e.clientX - contact.x, e.clientY - contact.y);
    }
    contact.x = e.clientX;
    contact.y = e.clientY;
  }

  private moveStick(target: HTMLElement, x: number, y: number) {
    const rect = target.getBoundingClientRect();
    const radius = rect.width * 0.34;
    const dx = (x - rect.left - rect.width / 2) / radius;
    const dy = (y - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(dx, dy);
    // Circular dead zone prevents drift. Clamping prevents diagonal speed gain.
    const strength = Math.max(0, Math.min(1, (length - 0.14) / 0.86));
    const scale = length > 0 ? strength / length : 0;
    this.port.move(-dy * scale, dx * scale);
    this.stick.style.transform = `translate(${dx / Math.max(1, length) * radius}px, ${dy / Math.max(1, length) * radius}px)`;
  }

  private up(e: PointerEvent, cancelled: boolean) {
    const contact = this.contacts.get(e.pointerId);
    if (!contact) return;
    this.contacts.delete(e.pointerId);
    contact.target.classList.remove('is-down');
    if (contact.kind === 'move') {
      this.port.move(0, 0);
      this.stick.style.transform = '';
    } else if (contact.kind !== 'look') {
      if (cancelled) this.port.cancel(contact.kind);
      else this.port.action(contact.kind, false);
    }
    if (contact.target.hasPointerCapture(e.pointerId)) contact.target.releasePointerCapture(e.pointerId);
  }
}
