import { WEAPONS } from '../config/weapons';
import type { Fighter } from '../sim/fighter';
import type { MatchInfo } from '../sim/match';

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const WNAME: Record<string, string> = { ar: 'Inkblaster', pistol: 'Highlighter', melee: 'Pencil' };

export class Hud {
  readonly root = el('div', '');
  private xh = el('div', 'xh', '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i>');
  private hm = el('div', 'hm', '<i></i><i></i><i></i><i></i>');
  private pop = el('div', 'pop');
  private vignette = el('div', 'vignette');
  private hpPanel = el('div', 'panel hp', '<span class="lbl">INK</span><span class="num">100</span><div class="bar"><div></div></div>');
  private ammoPanel = el('div', 'panel ammo');
  private top = el('div', 'panel top', '<div class="timer"></div><div class="score"></div>');
  private modeEl = el('div', 'panel mode');
  private fpsEl = el('div', 'panel fps');
  private feed = el('div', 'panel feed');
  private notice = el('div', 'panel notice');
  private death = el('div', 'death hidden', '<h1>SCRIBBLED OUT</h1><p class="by"></p><p class="cd"></p>');
  private note = el('div', 'note hidden');
  private stats = el('div', 'panel stats hidden');
  private board = el('div', 'scoreboard hidden');
  private dmgLayer = el('div', '');
  private indLayer = el('div', '');
  private lastAmmoKey = '';
  private flashT = 0;
  private noteTimer = 0;

  constructor(parent: HTMLElement) {
    this.root.id = 'hud';
    for (const e of [this.dmgLayer, this.indLayer, this.vignette, this.xh, this.hm, this.pop, this.hpPanel, this.ammoPanel, this.top, this.modeEl, this.fpsEl, this.feed, this.notice, this.note, this.stats, this.death, this.board])
      this.root.appendChild(e);
    parent.appendChild(this.root);
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  setCrosshairColor(c: string) {
    this.xh.style.setProperty('--xh', c);
  }

  reset() {
    this.feed.innerHTML = '';
    this.dmgLayer.innerHTML = '';
    this.indLayer.innerHTML = '';
    this.death.classList.add('hidden');
    this.board.classList.add('hidden');
    this.lastAmmoKey = '';
  }

  /** Dynamic crosshair: gap follows actual weapon spread converted to pixels. */
  crosshair(spreadRad: number, vfovRad: number, weapon: string, ads: number, visible: boolean) {
    const px = (Math.tan(spreadRad) / Math.tan(vfovRad / 2)) * (window.innerHeight / 2);
    const gap = 4 + px;
    const [t, b, l, r] = Array.from(this.xh.children) as HTMLElement[];
    t.style.top = `${-gap - 9}px`;
    b.style.top = `${gap}px`;
    l.style.left = `${-gap - 9}px`;
    r.style.left = `${gap}px`;
    this.xh.classList.toggle('melee', weapon === 'melee');
    this.xh.style.opacity = visible ? String(1 - ads * 0.85) : '0';
  }

  hitmarker(kind: 'body' | 'head', kill: boolean) {
    this.hm.className = 'hm';
    void this.hm.offsetWidth; // restart animation
    this.hm.className = `hm show ${kind === 'head' ? 'head' : ''} ${kill ? 'kill' : ''}`;
  }

  popText(text: string, color = '') {
    this.pop.textContent = text;
    this.pop.style.color = color;
    this.pop.className = 'pop';
    void this.pop.offsetWidth;
    this.pop.className = 'pop show';
  }

  damageNumber(x: number, y: number, dmg: number, head: boolean, kill: boolean) {
    const d = el('div', `dmgnum ${head ? 'head' : ''} ${kill ? 'kill' : ''}`, String(dmg));
    d.style.left = `${x + (Math.random() - 0.5) * 24}px`;
    d.style.top = `${y - 10}px`;
    this.dmgLayer.appendChild(d);
    setTimeout(() => d.remove(), 720);
    while (this.dmgLayer.childElementCount > 24) this.dmgLayer.firstElementChild!.remove();
  }

  /** angle: radians, 0 = in front, positive = to the right. */
  damageIndicator(angle: number) {
    const w = el('div', 'dind', '<b></b>');
    w.style.transform = `rotate(${angle}rad)`;
    this.indLayer.appendChild(w);
    setTimeout(() => w.remove(), 1100);
    this.flashT = 0.3;
  }

  killfeed(killer: Fighter, victim: Fighter, weapon: string, headshot: boolean, backstab: boolean, localId: number) {
    const tag = headshot ? ' <span class="hs">HEADSHOT</span>' : backstab ? ' <span class="hs">BACKSTAB</span>' : '';
    const d = el(
      'div',
      killer.id === localId || victim.id === localId ? 'me' : '',
      `<span class="chip" style="background:${hex(killer.color)}"></span>${esc(killer.name)}<span class="w">✎ ${WNAME[weapon]}</span><span class="chip" style="background:${hex(victim.color)}"></span>${esc(victim.name)}${tag}`,
    );
    this.feed.appendChild(d);
    setTimeout(() => d.remove(), 5000);
    while (this.feed.childElementCount > 6) this.feed.firstElementChild!.remove();
  }

  killNotice(name: string, sub: string) {
    this.notice.innerHTML = `ERASED <span style="color:var(--pink)">${esc(name)}</span><div class="sub">${esc(sub)}</div>`;
    this.notice.className = 'panel notice';
    void this.notice.offsetWidth;
    this.notice.className = 'panel notice show';
  }

  setDeath(show: boolean, by = '', countdown = 0) {
    this.death.classList.toggle('hidden', !show);
    if (show) {
      (this.death.querySelector('.by') as HTMLElement).textContent = by ? `by ${by}` : '';
      (this.death.querySelector('.cd') as HTMLElement).textContent = `redrawing in ${countdown.toFixed(1)}s`;
    }
  }

  setNote(text: string, seconds = 6) {
    this.note.innerHTML = text;
    this.note.classList.remove('hidden');
    this.note.style.opacity = '1';
    this.noteTimer = seconds;
  }

  setStats(html: string | null) {
    this.stats.classList.toggle('hidden', html === null);
    if (html !== null) this.stats.innerHTML = html;
  }

  scoreboard(show: boolean, fighters: readonly Fighter[], localId: number, info: MatchInfo) {
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = fighters
      .filter((f) => f.kind !== 'dummy')
      .slice()
      .sort((a, b) => b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths)
      .map((f) => {
        const acc = f.stats.shots ? Math.round((f.stats.hits / f.stats.shots) * 100) : 0;
        return `<tr class="${f.id === localId ? 'me' : ''}"><td><span class="chip" style="background:${hex(f.color)}"></span>${esc(f.name)}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${(f.stats.kills / Math.max(1, f.stats.deaths)).toFixed(2)}</td><td>${acc}%</td><td>${f.alive ? '' : '✖'}</td></tr>`;
      })
      .join('');
    this.board.innerHTML = `<h2>${esc(info.mapName)} — first to ${info.scoreLimit}</h2><table><tr><th>Name</th><th>K</th><th>D</th><th>K/D</th><th>Acc</th><th></th></tr>${rows}</table>`;
  }

  update(dt: number, me: Fighter | undefined, fighters: readonly Fighter[], info: MatchInfo, fps: number, showFps: boolean) {
    this.fpsEl.textContent = showFps ? `${fps} fps` : '';
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.noteTimer > 0) {
      this.noteTimer -= dt;
      if (this.noteTimer <= 0) this.note.style.opacity = '0';
    }
    if (info.mode === 'ffa') {
      const t = Math.max(0, Math.ceil(info.timeLeft));
      this.top.querySelector('.timer')!.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      const leader = fighters.reduce((a, b) => (b.stats.kills > a.stats.kills ? b : a), fighters[0]);
      this.top.querySelector('.score')!.textContent = me
        ? `you ${me.stats.kills}  ·  lead ${leader.stats.kills} (${leader.name})  ·  to ${info.scoreLimit}`
        : '';
      this.modeEl.textContent = 'FREE FOR ALL';
    } else {
      this.top.querySelector('.timer')!.textContent = '';
      this.top.querySelector('.score')!.textContent = '';
      this.modeEl.textContent = 'GUN RANGE';
    }
    if (!me) return;
    const hpFrac = me.hp / me.maxHp;
    (this.hpPanel.querySelector('.num') as HTMLElement).textContent = String(Math.ceil(me.hp));
    const bar = this.hpPanel.querySelector('.bar') as HTMLElement;
    (bar.firstElementChild as HTMLElement).style.width = `${hpFrac * 100}%`;
    bar.classList.toggle('low', hpFrac < 0.35);
    this.vignette.style.opacity = String(Math.max(me.alive ? (0.35 - hpFrac) * 2 : 0, this.flashT * 2));

    const slot = me.weapons[me.cur];
    const def = WEAPONS[slot.id];
    const reloadP = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reloadTime : -1;
    const key = `${slot.id}|${slot.mag}|${me.cur}|${Math.round(reloadP * 20)}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      const slots = me.weapons.map((w, i) => `<span class="${i === me.cur ? 'on' : ''}">${i + 1} ${WNAME[w.id]}</span>`).join('');
      const mag = def.kind === 'melee' ? '✎' : String(slot.mag);
      this.ammoPanel.innerHTML =
        `<div class="wname">${WNAME[slot.id]}</div>` +
        `<span class="mag ${def.kind !== 'melee' && slot.mag === 0 ? 'empty' : ''}">${mag}</span>` +
        (def.kind === 'melee' ? '' : `<span class="res"> / ${def.magSize}</span>`) +
        (reloadP >= 0 ? `<div class="reloadbar"><div style="width:${reloadP * 100}%"></div></div>` : '') +
        `<div class="slots">${slots}</div>`;
    }
  }
}
