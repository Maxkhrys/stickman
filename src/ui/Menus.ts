import type { Fighter } from '../sim/fighter';
import type { Difficulty, GameMode } from '../sim/types';
import { ACTION_LABELS, DEFAULT_SETTINGS, keyName, saveSettings, type Action, type Settings } from '../core/Settings';
import type { Input } from '../core/Input';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export interface MenuCallbacks {
  play(): void;
  resume(): void;
  quit(): void;
  settingsChanged(): void;
  click(): void;
}

export class Menus {
  private main = document.createElement('div');
  private settingsEl = document.createElement('div');
  private pause = document.createElement('div');
  private end = document.createElement('div');
  private settingsBack: 'main' | 'pause' = 'main';

  constructor(parent: HTMLElement, private s: Settings, private input: Input, private cb: MenuCallbacks) {
    for (const e of [this.main, this.settingsEl, this.pause, this.end]) {
      e.className = 'screen hidden';
      parent.appendChild(e);
    }
    this.buildMain();
    this.buildPause();
  }

  hideAll() {
    for (const e of [this.main, this.settingsEl, this.pause, this.end]) e.classList.add('hidden');
  }

  get anyOpen() {
    return [this.main, this.settingsEl, this.pause, this.end].some((e) => !e.classList.contains('hidden'));
  }

  showMain() {
    this.hideAll();
    this.buildMain();
    this.main.classList.remove('hidden');
  }

  showPause() {
    this.hideAll();
    this.pause.classList.remove('hidden');
  }

  private seg<T extends string>(opts: [T, string][], cur: T, on: (v: T) => void): HTMLElement {
    const d = document.createElement('div');
    d.className = 'seg';
    for (const [v, label] of opts) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = v === cur ? 'on' : '';
      b.onclick = () => {
        this.cb.click();
        on(v);
        d.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
      d.appendChild(b);
    }
    return d;
  }

  private row(label: string, content: HTMLElement): HTMLElement {
    const r = document.createElement('div');
    r.className = 'row';
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l, content);
    return r;
  }

  private btn(text: string, onclick: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = text;
    b.onclick = () => {
      this.cb.click();
      onclick();
    };
    return b;
  }

  private buildMain() {
    const s = this.s;
    this.main.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="title">STICK<br>FIGHT</div><div class="tag">a notebook-doodle arena shooter</div>`;
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 14;
    name.value = s.playerName;
    name.oninput = () => {
      s.playerName = name.value.trim() || 'You';
      saveSettings(s);
    };
    card.appendChild(this.row('Name', name));
    card.appendChild(
      this.row('Mode', this.seg<GameMode>([['range', 'Gun Range'], ['ffa', 'FFA vs 6 bots']], s.mode, (v) => {
        s.mode = v;
        saveSettings(s);
      })),
    );
    card.appendChild(
      this.row('Bots', this.seg<Difficulty>([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['insane', 'Insane']], s.difficulty, (v) => {
        s.difficulty = v;
        saveSettings(s);
      })),
    );
    card.appendChild(this.btn('PLAY', () => this.cb.play(), true));
    card.appendChild(this.btn('Settings', () => this.showSettings('main')));
    const help = document.createElement('div');
    help.className = 'help small';
    help.innerHTML = `<kbd>WASD</kbd> move · <kbd>Space</kbd> jump (hold to bhop) · <kbd>Shift</kbd> crouch / slide · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim / heavy · <kbd>R</kbd> reload · <kbd>1 2 3</kbd>/wheel swap · <kbd>Tab</kbd> scores · <kbd>Esc</kbd> pause`;
    card.appendChild(help);
    this.main.appendChild(card);
  }

  private buildPause() {
    this.pause.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="title" style="font-size:64px">PAUSED</div>`;
    card.appendChild(this.btn('Resume', () => this.cb.resume(), true));
    card.appendChild(this.btn('Settings', () => this.showSettings('pause')));
    card.appendChild(this.btn('Quit to menu', () => this.cb.quit()));
    this.pause.appendChild(card);
  }

  showSettings(back: 'main' | 'pause') {
    this.settingsBack = back;
    this.hideAll();
    const s = this.s;
    const el = this.settingsEl;
    el.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<h2 style="margin:0 0 6px;font-size:40px">Settings</h2>';
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flex = '1';
      wrap.style.gap = '8px';
      const r = document.createElement('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = String(get());
      const v = document.createElement('span');
      v.className = 'val';
      v.textContent = fmt(get());
      r.oninput = () => {
        set(parseFloat(r.value));
        v.textContent = fmt(get());
        saveSettings(s);
        this.cb.settingsChanged();
      };
      wrap.append(r, v);
      card.appendChild(this.row(label, wrap));
    };
    slider('Sensitivity', 0.1, 4, 0.01, () => s.sensitivity, (v) => (s.sensitivity = v));
    slider('ADS sens.', 0.2, 1.5, 0.01, () => s.adsSensitivity, (v) => (s.adsSensitivity = v));
    slider('FOV', 70, 120, 1, () => s.fov, (v) => (s.fov = v), (v) => String(v));
    slider('Volume', 0, 1, 0.01, () => s.volume, (v) => (s.volume = v), (v) => `${Math.round(v * 100)}%`);
    slider('Camera bob', 0, 1, 0.05, () => s.cameraBob, (v) => (s.cameraBob = v), (v) => `${Math.round(v * 100)}%`);
    slider('Render scale', 0.5, 1.5, 0.05, () => s.renderScale, (v) => (s.renderScale = v));
    const tog = (label: string, get: () => boolean, set: (v: boolean) => void) =>
      card.appendChild(
        this.row(label, this.seg<'on' | 'off'>([['on', 'On'], ['off', 'Off']], get() ? 'on' : 'off', (v) => {
          set(v === 'on');
          saveSettings(s);
          this.cb.settingsChanged();
        })),
      );
    tog('FOV kick', () => s.fovKick, (v) => (s.fovKick = v));
    tog('Show FPS', () => s.showFps, (v) => (s.showFps = v));
    card.appendChild(
      this.row('Crosshair', this.seg<string>([['#1b1b24', 'Ink'], ['#ff4f9a', 'Pink'], ['#22c6e0', 'Cyan'], ['#3ddc84', 'Green']], s.crosshairColor, (v) => {
        s.crosshairColor = v;
        saveSettings(s);
        this.cb.settingsChanged();
      })),
    );

    const kh = document.createElement('h2');
    kh.textContent = 'Keybinds';
    kh.style.margin = '14px 0 6px';
    card.appendChild(kh);
    const keys = document.createElement('div');
    keys.className = 'keys';
    for (const a of Object.keys(ACTION_LABELS) as Action[]) {
      const l = document.createElement('span');
      l.textContent = ACTION_LABELS[a];
      const b = document.createElement('button');
      b.textContent = keyName(s.keys[a]);
      b.onclick = (e) => {
        e.stopPropagation();
        if (b.classList.contains('rebinding')) return;
        b.classList.add('rebinding');
        b.textContent = 'press…';
        setTimeout(() => {
          this.input.rebindCallback = (code) => {
            this.input.rebindCallback = null;
            if (code !== 'Escape') s.keys[a] = code;
            b.classList.remove('rebinding');
            b.textContent = keyName(s.keys[a]);
            saveSettings(s);
          };
        }, 0);
      };
      keys.append(l, b);
    }
    card.appendChild(keys);
    card.appendChild(
      this.btn('Reset to defaults', () => {
        const name = s.playerName;
        Object.assign(s, structuredClone(DEFAULT_SETTINGS), { playerName: name, mode: s.mode, difficulty: s.difficulty });
        saveSettings(s);
        this.cb.settingsChanged();
        this.showSettings(this.settingsBack);
      }),
    );
    card.appendChild(
      this.btn('Back', () => {
        this.input.rebindCallback = null;
        if (this.settingsBack === 'main') this.showMain();
        else this.showPause();
      }, true),
    );
    el.appendChild(card);
    el.classList.remove('hidden');
  }

  showEnd(fighters: readonly Fighter[], localId: number, onAgain: () => void) {
    this.hideAll();
    const me = fighters.find((f) => f.id === localId)!;
    const sorted = fighters.filter((f) => f.kind !== 'dummy').slice().sort((a, b) => b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths);
    const winner = sorted[0];
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const card = document.createElement('div');
    card.className = 'card results';
    card.innerHTML =
      `<div class="title" style="font-size:60px">${winner.id === localId ? 'YOU WIN!' : 'MATCH OVER'}</div>` +
      `<div class="tag">${winner.id === localId ? 'top of the class ✎' : `${esc(winner.name)} took it with ${winner.stats.kills} kills`}</div>` +
      `<div class="bigstats">` +
      `<div><b>${me.stats.kills}/${me.stats.deaths}</b>K / D (${(me.stats.kills / Math.max(1, me.stats.deaths)).toFixed(2)})</div>` +
      `<div><b>${pct(me.stats.hits, me.stats.shots)}%</b>accuracy</div>` +
      `<div><b>${pct(me.stats.headshots, me.stats.hits)}%</b>headshots</div>` +
      `<div><b>${me.stats.bestStreak}</b>best streak</div>` +
      `</div>` +
      `<table><tr><th>#</th><th>Name</th><th>K</th><th>D</th><th>Acc</th><th>HS%</th><th>Dmg</th></tr>` +
      sorted
        .map(
          (f, i) =>
            `<tr class="${f.id === localId ? 'me' : ''}"><td>${i + 1}</td><td><span class="chip" style="background:${hex(f.color)}"></span>${esc(f.name)}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${pct(f.stats.hits, f.stats.shots)}%</td><td>${pct(f.stats.headshots, f.stats.hits)}%</td><td>${f.stats.damage}</td></tr>`,
        )
        .join('') +
      `</table>`;
    card.appendChild(this.btn('Play again', onAgain, true));
    card.appendChild(this.btn('Main menu', () => this.cb.quit()));
    this.end.innerHTML = '';
    this.end.appendChild(card);
    this.end.classList.remove('hidden');
  }
}
