// Sniper scope image. As the 3D eyepiece approaches the eye the overlay grows out of the eyepiece's
// projected rim, then settles into a clean full-screen circle with a thin reticle. Opacity, zoom,
// sensitivity and accuracy are all driven by the same ADS progress, so what you see is when the
// shot becomes precise.
export class ScopeOverlay {
  readonly root = document.createElement('div');
  private mask = document.createElement('div');
  private reticle: SVGSVGElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root.className = 'scope hidden';
    this.mask.className = 'scope-mask';
    this.root.appendChild(this.mask);
    const ns = 'http://www.w3.org/2000/svg';
    this.reticle = document.createElementNS(ns, 'svg') as SVGSVGElement;
    this.reticle.setAttribute('class', 'scope-reticle');
    this.reticle.setAttribute('viewBox', '-100 -100 200 200');
    this.reticle.innerHTML = `
      <circle r="99" fill="none" stroke="#1b1b24" stroke-width="2.2"/>
      <circle r="96.5" fill="none" stroke="#ff4f9a" stroke-width="0.9" opacity="0.7"/>
      <g stroke="#1b1b24" stroke-linecap="round">
        <line x1="-99" y1="0" x2="-30" y2="0" stroke-width="2.4"/>
        <line x1="30" y1="0" x2="99" y2="0" stroke-width="2.4"/>
        <line x1="0" y1="30" x2="0" y2="99" stroke-width="2.4"/>
        <line x1="-30" y1="0" x2="-3.5" y2="0" stroke-width="0.55"/>
        <line x1="3.5" y1="0" x2="30" y2="0" stroke-width="0.55"/>
        <line x1="0" y1="-30" x2="0" y2="-3.5" stroke-width="0.55"/>
        <line x1="0" y1="3.5" x2="0" y2="30" stroke-width="0.55"/>
        <line x1="-12" y1="8" x2="-9" y2="8" stroke-width="0.5"/>
        <line x1="9" y1="8" x2="12" y2="8" stroke-width="0.5"/>
        <line x1="-8" y1="16" x2="-6" y2="16" stroke-width="0.5"/>
        <line x1="6" y1="16" x2="8" y2="16" stroke-width="0.5"/>
      </g>
      <circle r="0.9" fill="#ff4f9a"/>`;
    this.root.appendChild(this.reticle);
    // under the HUD so health / ammo stay readable while scoped
    parent.insertBefore(this.root, parent.firstChild);
  }

  /**
   * cover: 0..1 overlay progress. from: projected eyepiece rim (screen px) at the moment the overlay starts.
   */
  update(cover: number, from: { x: number; y: number; r: number } | null) {
    const W = window.innerWidth, H = window.innerHeight;
    if (cover <= 0.001) {
      if (this.lastKey !== 'off') {
        this.root.classList.add('hidden');
        this.lastKey = 'off';
      }
      return;
    }
    this.root.classList.remove('hidden');
    const fullR = Math.min(W, H) * 0.47;
    // the clear circle IS the eyepiece rim (the eyepiece is sized to reach fullR at full ADS)
    let cx = W / 2, cy = H / 2, r = fullR;
    if (from && cover < 1) {
      const t = cover * cover;
      cx = from.x + (W / 2 - from.x) * t;
      cy = from.y + (H / 2 - from.y) * t;
      r = from.r + (fullR - from.r) * t;
    }
    const key = `${cx.toFixed(1)}|${cy.toFixed(1)}|${r.toFixed(1)}|${cover.toFixed(3)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.style.opacity = String(Math.min(1, cover * 1.25));
    this.mask.style.background = `radial-gradient(circle at ${cx}px ${cy}px, rgba(0,0,0,0) ${r - 1}px, rgba(8,8,14,0.55) ${r}px, rgba(8,8,14,0.97) ${r + 2}px, rgba(8,8,14,0.985) ${Math.max(W, H)}px)`;
    const s = r * 2;
    this.reticle.style.width = `${s}px`;
    this.reticle.style.height = `${s}px`;
    this.reticle.style.left = `${cx - r}px`;
    this.reticle.style.top = `${cy - r}px`;
    this.reticle.style.opacity = String(Math.max(0, (cover - 0.35) / 0.65));
  }
}
