import type { FixedLoop } from '../core/Loop';
import type { GameRenderer } from '../render/GameRenderer';
import type { Fighter } from '../sim/fighter';

// Character animation tuning panel. Enabled with ?animdebug in the URL; presentation only.
//   F6  cycle skeleton overlay (off / authoritative / render / both)
//   F7  toggle foot + hand IK targets
//   F8  freeze animation      F9  slow motion (1, 0.5, 0.25, 0.1)
//   F10 orbit camera (off / front / side / rear / three-quarter)     F11 hide body
const ORBITS = [null, { yaw: Math.PI, pitch: 0.12, dist: 3.2, height: 1 }, { yaw: Math.PI / 2, pitch: 0.08, dist: 3.2, height: 0.95 }, { yaw: 0, pitch: 0.15, dist: 3.2, height: 1 }, { yaw: Math.PI * 0.75, pitch: 0.2, dist: 3.1, height: 1 }];
const SPEEDS = [1, 0.5, 0.25, 0.1];

export class AnimDebugPanel {
  private el = document.createElement('div');
  private skel = 0;
  private speed = 0;
  private orbit = 0;
  private hitboxes = false;

  constructor(parent: HTMLElement, private renderer: GameRenderer, loop: FixedLoop) {
    this.el.className = 'anim-debug';
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      const f = renderer.characters.debug.flags;
      const k = e.code;
      if (!/^F(6|7|8|9|10|11|12)$/.test(k)) return;
      e.preventDefault();
      if (k === 'F6') {
        this.skel = (this.skel + 1) % 4;
        f.authSkeleton = this.skel === 1 || this.skel === 3;
        f.renderSkeleton = this.skel >= 2;
      } else if (k === 'F7') f.footTargets = f.handTargets = !f.footTargets;
      else if (k === 'F8') f.freeze = !f.freeze;
      else if (k === 'F9') {
        this.speed = (this.speed + 1) % SPEEDS.length;
        loop.timeScale = SPEEDS[this.speed];
      } else if (k === 'F10') {
        this.orbit = (this.orbit + 1) % ORBITS.length;
        renderer.inspect = ORBITS[this.orbit] ? { ...ORBITS[this.orbit]! } : null;
      } else if (k === 'F11') f.hideBody = !f.hideBody;
      else if (k === 'F12') {
        this.hitboxes = !this.hitboxes;
        renderer.hitboxes.enabled = this.hitboxes;
      }
    });
  }

  update(me: Fighter | undefined) {
    const f = this.renderer.characters.debug.flags;
    const anim = me ? this.renderer.characters.animOf(me.id) : null;
    const hs = me ? Math.hypot(me.vel.x, me.vel.z) : 0;
    const feet = anim ? anim.feet.map((ft) => ['plant', 'swing', 'free'][ft.mode] + (ft.mode === 1 ? ` ${Math.round(ft.s * 100)}%` : '')).join(' · ') : '-';
    const on = (b: boolean) => (b ? '<b>on</b>' : 'off');
    this.el.innerHTML =
      `<b>ANIM</b> ${anim?.state ?? '-'} · ${hs.toFixed(1)} m/s${me ? ` · gait ${me.gait.toFixed(2)}` : ''}<br>` +
      `feet L/R ${feet}<br>` +
      (anim ? `travel ${anim.diag.travel.toFixed(1)} m/s · cadence ${anim.diag.cadence}/s · plant err ${(anim.plantError * 100).toFixed(1)} cm<br>` +
        `pelvis↔aim ${(anim.diag.twist * 57.3).toFixed(0)}° · drawn↔hitbox skeleton ${(anim.diag.jointDev * 100).toFixed(1)} cm (${anim.diag.jointDevName})<br>` +
        `torso: hit OBB 42 cm wide, drawn spine 10 cm (known mismatch)<br>` : '') +
      `F6 skeleton ${['off', 'auth', 'render', 'both'][this.skel]} · F7 targets ${on(f.footTargets)}<br>` +
      `F8 freeze ${on(f.freeze)} · F9 speed ×${SPEEDS[this.speed]}<br>` +
      `F10 orbit ${['off', 'front', 'side', 'rear', '¾'][this.orbit]} · F11 body ${on(!f.hideBody)} · F12 hitboxes ${on(this.hitboxes)}`;
  }
}
