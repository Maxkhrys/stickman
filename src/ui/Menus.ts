import { ARMORY, CONTRACTS, INKS, type Profile, type RewardReceipt } from '../core/Profile';
import { WEAPONS, type PrimaryId } from '../config/weapons';
import { weaponPortraits } from '../render/weaponPortraits';
import type { MatchInfo } from '../sim/match';
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
  private armory = document.createElement('div');

  constructor(parent: HTMLElement, private s: Settings, private input: Input, private cb: MenuCallbacks, private profile: Profile) {
    for (const e of [this.main, this.settingsEl, this.pause, this.end, this.armory]) {
      e.className = 'screen hidden';
      parent.appendChild(e);
    }
    this.buildMain();
    this.buildPause();
  }

  hideAll() {
    for (const e of [this.main, this.settingsEl, this.pause, this.end, this.armory]) e.classList.add('hidden');
  }

  get anyOpen() {
    return [this.main, this.settingsEl, this.pause, this.end, this.armory].some((e) => !e.classList.contains('hidden'));
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
      b.setAttribute('aria-pressed', String(v === cur));
      b.onclick = () => {
        this.cb.click();
        on(v);
        d.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
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
    content.setAttribute('aria-label', label);
    if (content instanceof HTMLInputElement) { content.id = `setting-${label.replace(/\W/g, '')}`; l.htmlFor = content.id; }
    else content.querySelectorAll('input').forEach(i => i.setAttribute('aria-label', label));
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
    card.className = 'card main-card';
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
    const matchRows: HTMLElement[] = [];
    const syncMode = () => matchRows.forEach((r) => (r.style.opacity = s.mode !== 'range' ? '1' : '0.45'));
    card.appendChild(
      this.row('Mode', this.seg<GameMode>([['range', 'Practice Range'], ['ffa', 'Free-for-all'], ['sketch', 'Hold the Sketch']], s.mode, (v) => {
        s.mode = v;
        saveSettings(s);
        syncMode();
      })),
    );
    const diffRow = this.row('Bot skill', this.seg<Difficulty>([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], s.difficulty, (v) => {
      s.difficulty = v;
      saveSettings(s);
    }));
    const countWrap = document.createElement('div');
    countWrap.style.display = 'flex';
    countWrap.style.flex = '1';
    countWrap.style.gap = '8px';
    const count = document.createElement('input');
    count.type = 'range';
    count.min = '1';
    count.max = '8';
    count.step = '1';
    count.value = String(s.botCount);
    const countVal = document.createElement('span');
    countVal.className = 'val';
    countVal.textContent = String(s.botCount);
    count.oninput = () => {
      s.botCount = parseInt(count.value, 10);
      countVal.textContent = count.value;
      saveSettings(s);
    };
    countWrap.append(count, countVal);
    const countRow = this.row('Bots', countWrap);
    const primRow = this.row('Primary', this.seg<PrimaryId>(ARMORY.filter(a => this.profile.owns(a.id)).map(a => [a.id, WEAPONS[a.id].name]), s.primary, (v) => {
      s.primary = v;
      saveSettings(s);
    }));
    matchRows.push(diffRow, countRow, primRow);
    card.append(diffRow, countRow, primRow);
    card.appendChild(this.row('Arena', this.seg<'arena' | 'bookyard'>([['arena', 'Crossfire'], ['bookyard', 'Bookyard']], s.mapId, v => { s.mapId = v; saveSettings(s); })));
    card.appendChild(this.row('Camera', this.seg<'first' | 'third'>([['first', 'First person'], ['third', 'Third person']], s.cameraMode, v => { s.cameraMode = v; saveSettings(s); })));
    const wallet = document.createElement('div');
    wallet.className = 'wallet';
    wallet.textContent = `${this.profile.data.ink} INK  /  LEVEL ${this.profile.level}`;
    card.appendChild(wallet);
    syncMode();
    card.appendChild(this.btn('PLAY', () => this.cb.play(), true));
    card.appendChild(this.btn('Armory & contracts', () => this.showArmory()));
    card.appendChild(this.btn('Settings', () => this.showSettings('main')));
    const help = document.createElement('div');
    help.className = 'help small';
    help.innerHTML = `<kbd>WASD</kbd> move · <kbd>Space</kbd> jump (hold to bhop) · <kbd>Shift</kbd> crouch / slide · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> aim / scope / heavy · <kbd>R</kbd> reload · <kbd>1-4</kbd>/wheel swap · <kbd>V</kbd> camera · <kbd>Q</kbd> shoulder · <kbd>H</kbd> hit regions (range) · <kbd>Tab</kbd> scores · <kbd>Esc</kbd> pause`;
    card.appendChild(help);
    this.main.appendChild(card);
  }

  showArmory(message = '') {
    this.hideAll();
    this.profile.refreshDay();
    const p = this.profile;
    this.armory.innerHTML = '';
    this.armory.classList.remove('hidden');
    const sheet = document.createElement('div');
    sheet.className = 'card armory-sheet';
    sheet.innerHTML = `<header class="armory-header"><div><span>STICKFIGHT / FIELD KIT</span><h2>THE ARMORY</h2></div><div class="ink-balance"><b>${p.data.ink}</b> Ink<br><small>Level ${p.level} · ${p.data.xp % 500}/500 XP</small></div></header>`;
    const intro = document.createElement('p');
    intro.textContent = '600 Ink to start. Earn more by finishing matches and contracts. Every weapon is free to try in the range.';
    sheet.appendChild(intro);
    const status = document.createElement('p');
    status.className = 'armory-status'; status.setAttribute('role', 'status');
    status.textContent = message || (p.storageAvailable ? 'Gear saves in this browser. Match rewards arrive at the results screen.' : 'Browser storage unavailable. Progress lasts for this session only.');
    sheet.appendChild(status);
    const layout = document.createElement('div'); layout.className = 'armory-layout';
    const catalog = document.createElement('div'); catalog.className = 'weapon-catalog';
    const portraits = weaponPortraits();
    for (const item of ARMORY) {
      const def = WEAPONS[item.id], owned = p.owns(item.id), equipped = this.s.primary === item.id;
      const row = document.createElement('article'); row.className = 'weapon-entry';
      const photo = document.createElement('img'); photo.src = portraits[item.id] ?? ''; photo.alt = `${def.name} weapon model`; photo.width = 270; photo.height = 120;
      const content = document.createElement('div');
      const kills = p.data.mastery[item.id] ?? 0;
      content.innerHTML = `<span class="weapon-role">${item.role}</span><h3>${def.name}</h3><p>${item.description}</p><div class="weapon-stats">${def.damage.chest} DMG · ${def.magSize} ROUNDS · ${Math.round(60 / (def.bolt ? def.bolt.delay + def.bolt.time : def.fireInterval))} RPM</div><small>Mastery ${Math.floor(kills / 25)} · ${kills} eliminations · next badge in ${25 - kills % 25}</small>`;
      const button = this.btn(equipped ? 'Equipped' : owned ? 'Equip' : `Unlock · ${item.price} Ink`, () => {
        if (!owned && !p.buyWeapon(item.id)) { this.showArmory('Not enough Ink. Finish a match or contract.'); return; }
        this.s.primary = item.id; saveSettings(this.s);
        this.showArmory(`${def.name} equipped. Ready for your next match.`);
      });
      button.disabled = equipped || (!owned && p.data.ink < item.price);
      if (!owned && p.data.ink < item.price) button.textContent = `Need ${item.price - p.data.ink} more Ink`;
      content.appendChild(button); row.append(photo, content); catalog.appendChild(row);
    }
    const side = document.createElement('aside'); side.className = 'armory-notes';
    side.innerHTML = '<h3>Today’s contracts</h3><p>Refresh at midnight UTC. Rewards claimed automatically after matches.</p>';
    for (const c of CONTRACTS) {
      const n = Math.min(c.target, p.data.daily[c.field]);
      const entry = document.createElement('div'); entry.className = 'contract';
      entry.innerHTML = `<b>${c.label}</b><span>${n}/${c.target} · ${p.data.daily.claimed.includes(c.id) ? 'Claimed' : '+' + c.reward + ' Ink'}</span><progress max="${c.target}" value="${n}" aria-label="${c.label}"></progress>`;
      side.appendChild(entry);
    }
    const title = document.createElement('h3'); title.textContent = 'Your character ink'; side.appendChild(title);
    for (const ink of INKS) {
      const owned = p.data.inks.includes(ink.id), selected = p.data.equippedInk === ink.id;
      const b = this.btn(`${ink.name}${selected ? ' · wearing' : owned ? ' · equip' : ' · ' + ink.price + ' Ink'}`, () => {
        this.showArmory(p.selectInk(ink.id) ? `${ink.name} selected for next match.` : 'Not enough Ink.');
      });
      b.classList.add('ink-option'); b.style.setProperty('--swatch', hex(ink.color));
      b.disabled = selected || (!owned && p.data.ink < ink.price); side.appendChild(b);
    }
    layout.append(catalog, side); sheet.appendChild(layout);
    sheet.appendChild(this.btn('Back to play', () => this.showMain(), true));
    this.armory.appendChild(sheet);
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
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    slider('Sensitivity', 0.1, 4, 0.01, () => s.sensitivity, (v) => (s.sensitivity = v));
    slider('ADS sens.', 0.3, 1.8, 0.01, () => s.adsSensitivity, (v) => (s.adsSensitivity = v));
    slider('Scope sens.', 0.3, 1.8, 0.01, () => s.scopeSensitivity, (v) => (s.scopeSensitivity = v));
    slider('FOV', 70, 120, 1, () => s.fov, (v) => (s.fov = v), (v) => String(v));
    slider('Camera shake', 0, 1, 0.05, () => s.cameraShake, (v) => (s.cameraShake = v), pct);
    slider('Master volume', 0, 1, 0.01, () => s.masterVolume, (v) => (s.masterVolume = v), pct);
    slider('Weapons', 0, 1, 0.01, () => s.weaponVolume, (v) => (s.weaponVolume = v), pct);
    slider('Hit feedback', 0, 1, 0.01, () => s.feedbackVolume, (v) => (s.feedbackVolume = v), pct);
    slider('Render scale', 0.5, 1.5, 0.05, () => s.renderScale, (v) => (s.renderScale = v));
    slider('Touch look', 0.2, 3, 0.05, () => s.touchSensitivity, (v) => (s.touchSensitivity = v));
    card.appendChild(this.row('Touch aim', this.seg<'toggle' | 'hold'>([['toggle', 'Tap toggles'], ['hold', 'Hold']], s.touchAds, (v) => { s.touchAds = v; saveSettings(s); })));
    card.appendChild(this.row('Graphics', this.seg<'auto' | 'high' | 'medium' | 'low'>([['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], s.graphics, (v) => { s.graphics = v; saveSettings(s); this.cb.settingsChanged(); })));
    const note = document.createElement('div');
    note.className = 'small';
    note.textContent = 'ADS / scope sensitivity are on top of automatic zoom compensation: 100% keeps the same feel at every zoom.';
    card.appendChild(note);
    const tog = (label: string, get: () => boolean, set: (v: boolean) => void) =>
      card.appendChild(
        this.row(label, this.seg<'on' | 'off'>([['on', 'On'], ['off', 'Off']], get() ? 'on' : 'off', (v) => {
          set(v === 'on');
          saveSettings(s);
          this.cb.settingsChanged();
        })),
      );
    card.appendChild(this.row('Camera', this.seg<'first' | 'third'>([['first', 'First person'], ['third', 'Third person']], s.cameraMode, v => { s.cameraMode = v; saveSettings(s); })));
    tog('FOV kick', () => s.fovKick, (v) => (s.fovKick = v));
    tog('Damage numbers', () => s.damageNumbers, (v) => (s.damageNumbers = v));
    tog('Hit regions', () => s.showHitboxes, (v) => (s.showHitboxes = v));
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
        Object.assign(s, structuredClone(DEFAULT_SETTINGS), { playerName: name, mode: s.mode, difficulty: s.difficulty, botCount: s.botCount, primary: s.primary });
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

  showEnd(fighters: readonly Fighter[], localId: number, onAgain: () => void, info: MatchInfo, receipt: RewardReceipt | null) {
    this.hideAll();
    const me = fighters.find((f) => f.id === localId)!;
    const sorted = fighters.filter((f) => f.kind !== 'dummy').slice().sort((a, b) => (info.mode === 'sketch' ? b.stats.objective - a.stats.objective : b.stats.kills - a.stats.kills) || a.stats.deaths - b.stats.deaths);
    const winner = fighters.find(f => f.id === info.winnerId);
    const win = winner?.id === localId;
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
    const card = document.createElement('div');
    card.className = 'card results';
    card.innerHTML =
      `<div class="title" style="font-size:60px">${win ? 'YOU WIN!' : winner ? 'MATCH OVER' : 'DRAW'}</div>` +
      `<div class="tag">${win ? 'top of the class ✎' : winner ? `${esc(winner.name)} wins ${info.mode === 'sketch' ? 'the sketch' : 'the match'}` : 'Same score. Another round?'}</div>` +
      `<div class="bigstats">` +
      `<div><b>${me.stats.kills}/${me.stats.deaths}</b>K / D (${(me.stats.kills / Math.max(1, me.stats.deaths)).toFixed(2)})</div>` +
      `<div><b>${pct(me.stats.hits, me.stats.shots)}%</b>accuracy</div>` +
      `<div><b>${pct(me.stats.headshots, me.stats.hits)}%</b>headshots</div>` +
      `<div><b>${me.stats.bestStreak}</b>best streak</div>` +
      `</div>` +
      `<table><tr><th>#</th><th>Name</th><th>Zone</th><th>K</th><th>D</th><th>Acc</th><th>HS%</th><th>Dmg</th></tr>` +
      sorted
        .map(
          (f, i) =>
            `<tr class="${f.id === localId ? 'me' : ''}"><td>${i + 1}</td><td><span class="chip" style="background:${hex(f.color)}"></span>${esc(f.name)}</td><td>${f.stats.objective}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${pct(f.stats.hits, f.stats.shots)}%</td><td>${pct(f.stats.headshots, f.stats.hits)}%</td><td>${f.stats.damage}</td></tr>`,
        )
        .join('') +
      `</table>`;
    if (receipt) {
      const reward = document.createElement('div');
      reward.className = 'reward-receipt';
      reward.innerHTML = `<strong>+${receipt.ink} Ink</strong><span>+${receipt.xp} XP · Level ${this.profile.level}</span>`;
      for (const label of receipt.contracts) { const p = document.createElement('p'); p.textContent = `Contract complete: ${label}`; reward.appendChild(p); }
      card.appendChild(reward);
    }
    card.appendChild(this.btn('Play again', onAgain, true));
    card.appendChild(this.btn('Main menu', () => this.cb.quit()));
    this.end.innerHTML = '';
    this.end.appendChild(card);
    this.end.classList.remove('hidden');
  }
}
