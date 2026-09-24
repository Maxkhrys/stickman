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
export const WNAME: Record<string, string> = { ar: 'Inkblaster', sniper: 'Graphite', pistol: 'Highlighter', melee: 'Pencil', smg: 'Scribbler', carbine: 'Finepoint' };

export type HitKind = 'body' | 'head' | 'kill' | 'blocked';

/**
 * HUD hierarchy (most to least central):
 *   centre: crosshair + hit confirmation only
 *   lower centre: one elimination line
 *   corners: health (BL), weapon/ammo (BR), kill feed (TR, max 4), match timer (TC)
 *   ring around centre: damage direction arcs; screen edge: low-health tint
 */
/** dev/preview-only build identifier, so an old deployment is never reviewed by mistake */
const BUILD_TAG = typeof __BUILD_TAG__ !== 'undefined' && __BUILD_TAG__ ? ` · ${__BUILD_TAG__}` : '';

export class Hud {
  readonly root = el('div', '');
  private xh = el('div', 'xh', '<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i>');
  private hm = el('div', 'hm', '<i></i><i></i><i></i><i></i>');
  private vignette = el('div', 'vignette');
  private hpPanel = el('div', 'panel hp', '<span class="lbl">HP</span><span class="num">100</span><div class="bar"><div></div></div><div class="protect hidden">protected<div class="pbar"><div></div></div></div>');
  private ammoPanel = el('div', 'panel ammo');
  private objectiveKey = '';
  private objectivePanel = el('div', 'objective-panel hidden');
  private top = el('div', 'panel top', '<div class="timer"></div><div class="score"></div>');
  private fpsEl = el('div', 'panel fps');
  private feed = el('div', 'panel feed');
  private notice = el('div', 'panel notice');
  private death = el('div', 'death hidden', '<h1>SCRIBBLED OUT</h1><p class="by"></p><p class="cd"></p>');
  private note = el('div', 'note hidden');
  private sketch = el('div', 'sketch-slide hidden', 'SKETCH SLIDE');
  private stats = el('div', 'panel stats hidden');
  private board = el('div', 'scoreboard hidden');
  private dmgLayer = el('div', '');
  private indLayer = el('div', '');
  private tagLayer = el('div', '');
  private tags = new Map<number, { el: HTMLElement; until: number }>();
  private lastAmmoKey = '';
  private flashT = 0;
  /** frame-clock animations (stay in sync with the game at any frame rate, and in captures) */
  private anims: { el: HTMLElement; t: number; dur: number; apply: (el: HTMLElement, u: number) => void; remove: boolean }[] = [];
  private hmT = 99;
  private hmDur = 0.2;
  private hmKind: HitKind = 'body';
  private noteTimer = 0;
  private noticeTimer = 0;

  constructor(parent: HTMLElement) {
    this.root.id = 'hud';
    for (const e of [this.dmgLayer, this.tagLayer, this.indLayer, this.vignette, this.xh, this.hm, this.hpPanel, this.ammoPanel, this.objectivePanel, this.top, this.fpsEl, this.feed, this.notice, this.note, this.stats, this.death, this.board, this.sketch])
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
    this.tagLayer.innerHTML = '';
    this.tags.clear();
    this.death.classList.add('hidden');
    this.board.classList.add('hidden');
    this.lastAmmoKey = '';
  }

  /** Dynamic crosshair: gap = actual weapon spread in pixels. Fades out as the sights come up. */
  crosshair(spreadRad: number, vfovRad: number, weapon: string, adsE: number, visible: boolean) {
    const px = (Math.tan(spreadRad) / Math.tan(vfovRad / 2)) * (window.innerHeight / 2);
    const gap = 3 + Math.min(px, window.innerHeight * 0.35);
    const [t, b, l, r] = Array.from(this.xh.children) as HTMLElement[];
    t.style.top = `${-gap - 9}px`;
    b.style.top = `${gap}px`;
    l.style.left = `${-gap - 9}px`;
    r.style.left = `${gap}px`;
    this.xh.classList.toggle('melee', weapon === 'melee');
    this.xh.style.opacity = visible ? String(Math.max(0, 1 - adsE * 1.6)) : '0';
  }

  objective(info: MatchInfo, me: Fighter) {
    const o = info.objective;
    this.objectivePanel.classList.toggle('hidden', !o);
    if (!o) return;
    const distance = Math.round(Math.hypot(me.pos.x - o.x, me.pos.z - o.z));
    const state = o.contested ? 'CONTESTED' : o.owner === me.id ? 'SCORING +1 / SEC' : o.owner >= 0 ? 'RIVAL SCORING' : 'CAPTURE THE SKETCH';
    const angle = Math.atan2(o.x - me.pos.x, -(o.z - me.pos.z)) + me.yaw;
    const key = `${state}|${distance}|${Math.ceil(o.rotatesIn)}|${me.stats.objective}|${Math.round(angle * 20)}`;
    if (key === this.objectiveKey) return;
    this.objectiveKey = key;
    this.objectivePanel.innerHTML = `<b>${state}</b><span><i style="transform:rotate(${angle}rad)">↑</i> ${distance}m · moves in ${Math.ceil(o.rotatesIn)}s · you ${me.stats.objective}/${info.scoreLimit}</span>`;
  }

  aimPoint(point: { x: number; y: number } | null, blocked = false) {
    for (const el of [this.xh, this.hm]) {
      el.style.left = point ? `${point.x}px` : '50%';
      el.style.top = point ? `${point.y}px` : '50%';
    }
    this.xh.classList.toggle('obstructed', blocked);
  }

  hitmarker(kind: HitKind) {
    this.hmKind = kind;
    this.hmT = 0;
    this.hmDur = kind === 'kill' ? 0.42 : kind === 'head' ? 0.3 : 0.2;
    this.hm.className = `hm ${kind}`;
  }

  private anim(e: HTMLElement, dur: number, apply: (el: HTMLElement, u: number) => void, remove = true) {
    this.anims.push({ el: e, t: 0, dur, apply, remove });
    apply(e, 0);
  }

  damageNumber(x: number, y: number, dmg: number, head: boolean, kill: boolean) {
    const d = el('div', `dmgnum ${head ? 'head' : ''} ${kill ? 'kill' : ''}`, String(dmg));
    // offset to the side so numbers never sit on the crosshair
    d.style.left = `${x + 34 + Math.random() * 16}px`;
    d.style.top = `${y - 16 - Math.random() * 10}px`;
    this.dmgLayer.appendChild(d);
    this.anim(d, 0.65, (e, u) => {
      e.style.opacity = String(1 - u * u);
      e.style.transform = `translateY(${-34 * u}px) scale(${u < 0.15 ? 1.3 - 2 * u : 1})`;
    });
    while (this.dmgLayer.childElementCount > 6) this.dmgLayer.firstElementChild!.remove();
  }

  /** angle: radians, 0 = in front, positive = to the right. */
  damageIndicator(angle: number, strength: number) {
    const w = el('div', 'dind', '<b></b>');
    w.style.transform = `rotate(${angle}rad)`;
    const base = 0.45 + Math.min(0.55, strength / 60);
    this.indLayer.appendChild(w);
    this.anim(w.firstElementChild as HTMLElement, 1.0, (e, u) => {
      e.style.opacity = String(base * (1 - u));
      e.style.transform = `scale(${1.1 - 0.1 * Math.min(1, u * 4)})`;
    });
    setTimeout(() => w.remove(), 1500);
    while (this.indLayer.childElementCount > 5) this.indLayer.firstElementChild!.remove();
    this.flashT = 0.25;
  }

  killfeed(killer: Fighter, victim: Fighter, weapon: string, headshot: boolean, backstab: boolean, localId: number) {
    const tag = headshot ? ' <span class="hs">HEAD</span>' : backstab ? ' <span class="hs">BACK</span>' : '';
    const d = el(
      'div',
      killer.id === localId || victim.id === localId ? 'me' : '',
      `<span class="chip" style="background:${hex(killer.color)}"></span>${esc(killer.name)}<span class="w">✎ ${WNAME[weapon]}</span><span class="chip" style="background:${hex(victim.color)}"></span>${esc(victim.name)}${tag}`,
    );
    this.feed.appendChild(d);
    setTimeout(() => d.remove(), 4500);
    while (this.feed.childElementCount > 4) this.feed.firstElementChild!.remove();
  }

  /** one line under the crosshair area, well away from the centre */
  killNotice(name: string, tag: string) {
    this.notice.innerHTML = `ERASED <span class="who">${esc(name)}</span>${tag ? ` <span class="tag">${esc(tag)}</span>` : ''}`;
    this.anims = this.anims.filter((a) => a.el !== this.notice);
    this.anim(
      this.notice,
      1.4,
      (e, u) => {
        const s = u < 0.1 ? 1.25 - 2.5 * u : 1;
        e.style.opacity = String(u < 0.08 ? u / 0.08 : u > 0.75 ? (1 - u) / 0.25 : 1);
        e.style.transform = `translateX(-50%) scale(${s})`;
      },
      false,
    );
    this.noticeTimer = 1.4;
  }

  setDeath(show: boolean, by = '', countdown = 0) {
    this.death.classList.toggle('hidden', !show);
    if (show) {
      (this.death.querySelector('.by') as HTMLElement).textContent = by ? `by ${by}` : '';
      (this.death.querySelector('.cd') as HTMLElement).textContent = `redrawing in ${countdown.toFixed(1)}s`;
    }
  }

  /** re-show the last help note (F1) */
  reopenNote(seconds = 8) {
    if (!this.note.innerHTML) return;
    this.note.classList.remove('hidden');
    this.note.style.opacity = '1';
    this.noteTimer = seconds;
  }

  setNote(text: string, seconds = 6) {
    this.note.innerHTML = text;
    this.note.classList.remove('hidden');
    this.note.style.opacity = '1';
    this.noteTimer = seconds;
  }

  /** tiny marker tag, only while the experimental Sketch Slide bonus is active */
  sketchSlide(active: boolean) {
    if (this.sketch.classList.contains('hidden') === !active) return;
    this.sketch.classList.toggle('hidden', !active);
  }

  setStats(html: string | null) {
    this.stats.classList.toggle('hidden', html === null);
    if (html !== null && this.stats.innerHTML !== html) this.stats.innerHTML = html;
  }

  /** remember that we damaged this fighter: show a small name/HP tag above them for a moment */
  tagTarget(id: number, now: number) {
    const t = this.tags.get(id);
    if (t) t.until = now + 2.2;
    else {
      const e = el('div', 'ntag', '<span class="n"></span><div class="hpb"><div></div></div>');
      this.tagLayer.appendChild(e);
      this.tags.set(id, { el: e, until: now + 2.2 });
    }
  }

  updateTags(now: number, fighters: readonly Fighter[], project: (id: number) => { x: number; y: number } | null) {
    for (const [id, t] of this.tags) {
      const f = fighters.find((x) => x.id === id);
      if (!f || !f.alive || now > t.until) {
        t.el.remove();
        this.tags.delete(id);
        continue;
      }
      const p = project(id);
      if (!p) {
        t.el.style.display = 'none';
        continue;
      }
      t.el.style.display = '';
      t.el.style.transform = `translate(${p.x}px, ${p.y - 28}px) translate(-50%, -100%)`;
      (t.el.querySelector('.n') as HTMLElement).textContent = f.name;
      ((t.el.querySelector('.hpb') as HTMLElement).firstElementChild as HTMLElement).style.width = `${(f.hp / f.maxHp) * 100}%`;
      t.el.style.opacity = String(Math.min(1, (t.until - now) / 0.4));
    }
  }

  scoreboard(show: boolean, fighters: readonly Fighter[], localId: number, info: MatchInfo) {
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = fighters
      .filter((f) => f.kind !== 'dummy')
      .slice()
      .sort((a, b) => (info.mode === 'sketch' ? b.stats.objective - a.stats.objective : b.stats.kills - a.stats.kills) || a.stats.deaths - b.stats.deaths)
      .map((f) => {
        const acc = f.stats.shots ? Math.round((f.stats.hits / f.stats.shots) * 100) : 0;
        return `<tr class="${f.id === localId ? 'me' : ''}"><td><span class="chip" style="background:${hex(f.color)}"></span>${esc(f.name)}</td><td>${f.stats.objective}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${(f.stats.kills / Math.max(1, f.stats.deaths)).toFixed(2)}</td><td>${acc}%</td><td>${WNAME[f.weapons[0].id]}</td><td>${f.alive ? '' : '✖'}</td></tr>`;
      })
      .join('');
    this.board.innerHTML = `<h2>${esc(info.mapName)} — first to ${info.scoreLimit}</h2><table><tr><th>Name</th><th>Zone</th><th>K</th><th>D</th><th>K/D</th><th>Acc</th><th>Primary</th><th></th></tr>${rows}</table>`;
  }

  /** advance frame-clock HUD animations */
  private stepAnims(dt: number) {
    for (const a of this.anims) {
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      a.apply(a.el, u);
      if (u >= 1 && a.remove) a.el.remove();
    }
    this.anims = this.anims.filter((a) => a.t < a.dur);
    // hitmarker: pop then fade; kill = bigger, longer, with a twist
    this.hmT += dt;
    const u = Math.min(1, this.hmT / this.hmDur);
    const big = this.hmKind === 'kill' ? 1.9 : this.hmKind === 'head' ? 1.6 : 1.3;
    const settle = this.hmKind === 'kill' ? 1.12 : 1;
    const sc = u < 0.4 ? big + (settle - big) * (u / 0.4) : settle;
    const rot = this.hmKind === 'kill' ? 8 * (1 - u) : this.hmKind === 'head' ? -4 * (1 - u) : 0;
    this.hm.style.opacity = String(u >= 1 ? 0 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45);
    this.hm.style.transform = `scale(${sc}) rotate(${rot}deg)`;
  }

  update(dt: number, me: Fighter | undefined, fighters: readonly Fighter[], info: MatchInfo, fps: number, showFps: boolean) {
    this.stepAnims(dt);
    this.fpsEl.textContent = (showFps ? `${fps} fps` : '') + BUILD_TAG;
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.noteTimer > 0) {
      // the help note collapses as soon as the player starts moving; F1 brings it back
      if (me && Math.hypot(me.vel.x, me.vel.z) > 1.5 && this.noteTimer > 0.4) this.noteTimer = 0.4;
      this.noteTimer -= dt;
      if (this.noteTimer <= 0) this.note.style.opacity = '0';
    }
    if (this.noticeTimer > 0) this.noticeTimer -= dt;
    this.top.classList.toggle('practice', info.mode === 'range');
    if (info.mode !== 'range') {
      const t = Math.max(0, Math.ceil(info.timeLeft));
      this.top.querySelector('.timer')!.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      const others = fighters.filter((f) => f !== me);
      const field = info.mode === 'sketch' ? 'objective' : 'kills';
      const leader = others.reduce((a, b) => (b.stats[field] > a.stats[field] ? b : a), others[0] ?? fighters[0]);
      this.top.querySelector('.score')!.textContent = me ? `you ${me.stats[field]} · best ${leader.name} ${leader.stats[field]} · to ${info.scoreLimit}` : '';
    } else {
      this.top.querySelector('.timer')!.textContent = 'Practice';
      this.top.querySelector('.score')!.textContent = 'free fire · targets reset';
    }
    if (!me) return;
    const hpFrac = me.hp / me.maxHp;
    (this.hpPanel.querySelector('.num') as HTMLElement).textContent = String(Math.ceil(me.hp));
    const bar = this.hpPanel.querySelector('.bar') as HTMLElement;
    (bar.firstElementChild as HTMLElement).style.width = `${hpFrac * 100}%`;
    bar.classList.toggle('low', hpFrac < 0.35);
    const prot = this.hpPanel.querySelector('.protect') as HTMLElement;
    prot.classList.toggle('hidden', !(me.spawnProtect > 0 && me.alive));
    if (me.spawnProtect > 0) ((prot.querySelector('.pbar') as HTMLElement).firstElementChild as HTMLElement).style.width = `${(me.spawnProtect / 2) * 100}%`;
    // restrained low-health: edge tint only, never the centre
    const low = me.alive ? Math.max(0, (0.35 - hpFrac) / 0.35) * 0.7 : 0;
    this.vignette.style.opacity = String(Math.max(low, this.flashT * 1.6));

    const slot = me.weapons[me.cur];
    const def = WEAPONS[slot.id];
    const reloadP = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reloadTime : -1;
    const key = `${slot.id}|${slot.mag}|${me.cur}|${Math.round(reloadP * 20)}|${me.weapons.length}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      // compact slots: the drawn weapon carries its name, the rest are numbered chips
      const slots = me.weapons.map((w, i) => `<span class="${i === me.cur ? 'on' : ''}" title="${WNAME[w.id]}"><b>${i < 4 ? i + 1 : '↕'}</b>${i === me.cur ? ' ' + WNAME[w.id] : ''}</span>`).join('');
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
