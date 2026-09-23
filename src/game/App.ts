import * as THREE from 'three';
import { WEAPONS } from '../config/weapons';
import { Input } from '../core/Input';
import { FixedLoop } from '../core/Loop';
import { loadSettings, type Settings } from '../core/Settings';
import { Sfx } from '../audio/Sfx';
import { LocalAdapter } from '../net/LocalAdapter';
import type { NetworkAdapter } from '../net/NetworkAdapter';
import { GameRenderer } from '../render/GameRenderer';
import { computeSpread } from '../sim/combat';
import { eyePos, type Fighter } from '../sim/fighter';
import { TICK_DT } from '../sim/match';
import { emptyCommand, type GameEvent } from '../sim/types';
import { forwardFromAngles, flatRight } from '../sim/vec';
import { Hud } from '../ui/Hud';
import { Menus } from '../ui/Menus';

type AppState = 'menu' | 'playing' | 'paused' | 'ended';

const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();

export class App {
  readonly settings: Settings = loadSettings();
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly input = new Input(this.settings, this.canvas);
  readonly sfx = new Sfx();
  readonly renderer = new GameRenderer(this.canvas);
  readonly hud = new Hud(this.ui);
  readonly menus: Menus;
  private adapter: NetworkAdapter = new LocalAdapter();
  private backdrop: NetworkAdapter = new LocalAdapter();
  private state: AppState = 'menu';
  private loop: FixedLoop;
  private showBoard = false;
  private renderTime = 0;
  private lastKillerName = '';
  private lastKillerId = -1;
  private rangeLast = { dmg: 0, dist: 0, part: '' };
  private rangeDps: { t: number; d: number }[] = [];
  private starting = false;

  constructor() {
    this.menus = new Menus(this.ui, this.settings, this.input, {
      play: () => void this.startMatch(),
      resume: () => this.resume(),
      quit: () => this.toMenu(),
      settingsChanged: () => this.applySettings(),
      click: () => {
        this.sfx.unlock();
        this.sfx.ui();
      },
    });
    this.input.onPauseRequest = () => {
      if (this.state === 'playing') this.pause();
    };
    this.input.onScoreboard = (v) => (this.showBoard = v);
    window.addEventListener('resize', () => this.renderer.resize());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) void this.input.lock();
    });
    this.loop = new FixedLoop(TICK_DT, () => this.tick(), (a, fdt) => this.frame(a, fdt));
    this.applySettings();
    this.hud.show(false);
    void this.startBackdrop();
    this.menus.showMain();
    this.loop.start();
  }

  private applySettings() {
    const s = this.settings;
    this.sfx.setVolume(s.volume);
    this.renderer.bobScale = s.cameraBob;
    this.renderer.fovKickOn = s.fovKick;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s.renderScale * 0.75);
    this.hud.setCrosshairColor(s.crosshairColor);
  }

  /** Attract mode: bots fight in the arena behind the main menu. */
  private async startBackdrop() {
    await this.backdrop.start({ mode: 'ffa', difficulty: 'normal', playerName: '', botCount: 6, timeLimit: 1e9, scoreLimit: 1e9 });
    const p = this.backdrop.fighters()[0];
    p.alive = false;
    p.respawnTimer = Infinity;
    p.pos.y = -50;
    this.renderer.loadMap(this.backdrop.map(), this.backdrop.world());
  }

  private me(): Fighter | undefined {
    return this.adapter.fighters().find((f) => f.id === this.adapter.localId);
  }

  async startMatch() {
    if (this.starting) return;
    this.starting = true;
    this.sfx.unlock();
    const s = this.settings;
    this.adapter.stop();
    this.adapter = new LocalAdapter();
    await this.adapter.start({
      mode: s.mode,
      difficulty: s.difficulty,
      playerName: s.playerName,
      botCount: 6,
      timeLimit: 6 * 60,
      scoreLimit: 25,
    });
    this.renderer.loadMap(this.adapter.map(), this.adapter.world());
    const me = this.me()!;
    this.input.yaw = me.yaw;
    this.input.pitch = 0;
    this.hud.reset();
    this.hud.show(true);
    this.menus.hideAll();
    this.state = 'playing';
    this.rangeDps = [];
    if (s.mode === 'range') {
      this.hud.setNote('✎ <b>Gun Range</b> — tune your feel. Hold <kbd>Space</kbd> to bhop, <kbd>Shift</kbd> while running to slide, <kbd>RMB</kbd> to aim. Ramps & boxes on the right.', 9);
    } else {
      this.hud.setNote(`✎ First to 25 erasures wins. Bots: <b>${s.difficulty}</b>. <kbd>Tab</kbd> for scores.`, 5);
    }
    void this.input.lock();
    this.starting = false;
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menus.showPause();
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.menus.hideAll();
    this.state = 'playing';
    void this.input.lock();
  }

  private toMenu() {
    this.state = 'menu';
    this.input.unlock();
    this.adapter.stop();
    this.hud.show(false);
    this.renderer.loadMap(this.backdrop.map(), this.backdrop.world());
    this.menus.showMain();
  }

  // ------------------------------------------------------------------ simulation tick (60 Hz)
  private tick() {
    if (this.state === 'menu') {
      this.backdrop.tick(TICK_DT);
      this.backdrop.drainEvents();
      return;
    }
    if (this.state !== 'playing') return; // single-player pause freezes the sim
    const cmd = this.input.locked ? this.input.buildCommand() : { ...emptyCommand(), yaw: this.input.yaw, pitch: this.input.pitch };
    this.adapter.sendCommand(cmd);
    this.adapter.tick(TICK_DT);
    for (const e of this.adapter.drainEvents()) this.onEvent(e);
  }

  private fighter(id: number) {
    return this.adapter.fighters().find((f) => f.id === id);
  }

  /** stereo pan + distance relative to the local camera */
  private spatial(p: { x: number; z: number }): [number, number] {
    const cam = this.renderer.camera.position;
    const dx = p.x - cam.x, dz = p.z - cam.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = flatRight(this.input.yaw);
    return [d, ((dx * r.x + dz * r.z) / d) * 0.8];
  }

  private onEvent(e: GameEvent) {
    const local = this.adapter.localId;
    const R = this.renderer;
    switch (e.type) {
      case 'shot': {
        const src = this.fighter(e.id);
        if (!src) break;
        tv2.set(e.to.x, e.to.y, e.to.z);
        if (e.id === local) {
          this.sfx.shot(e.weapon, 0);
          R.viewmodel.fire(e.weapon, src.ads);
          R.punch(WEAPONS[e.weapon].viewPunch);
          R.localMuzzleWorld(tv);
          R.effects.tracer(tv, tv2, 0.016, 0xff4f9a);
        } else {
          const [d, pan] = this.spatial(src.pos);
          this.sfx.shot(e.weapon, d, pan);
          const fw = forwardFromAngles(src.yaw, src.pitch);
          const rt = flatRight(src.yaw);
          const eye = eyePos(src);
          tv.set(eye.x + fw.x * 0.6 + rt.x * 0.12, eye.y - 0.25 + fw.y * 0.6, eye.z + fw.z * 0.6 + rt.z * 0.12);
          R.effects.worldFlash(tv, 0.55);
          R.effects.tracer(tv, tv2, 0.03, 0x8b5cf6);
        }
        if (e.hitWorld && e.normal) {
          tv.set(e.normal.x, e.normal.y, e.normal.z);
          R.effects.impact(tv2, tv);
          const [d, pan] = this.spatial(e.to);
          this.sfx.impact(d, pan);
        }
        break;
      }
      case 'hit': {
        const victim = this.fighter(e.victim);
        const head = e.part === 'head';
        tv.set(e.pos.x, e.pos.y, e.pos.z);
        tv2.set(e.dir.x, e.dir.y, e.dir.z);
        const inkColor = victim ? victim.color : 0x1b1b24;
        R.effects.burst(tv, head ? 0xffd23f : inkColor, head ? 10 : 6, 4, 0.06, 0.45, 1, tv2);
        R.effects.burst(tv, 0x1b1b24, 4, 3, 0.05, 0.5, 1, tv2);
        R.stickmanOf(e.victim)?.hurt(e.dir.x, e.dir.z);
        if (e.attacker === local) {
          this.hud.hitmarker(head ? 'head' : 'body', e.killed);
          if (head) this.sfx.headshot();
          else this.sfx.hitmarker();
          if (e.weapon === 'melee') this.sfx.meleeHit();
          const sp = R.project(tv);
          if (sp) this.hud.damageNumber(sp.x, sp.y, e.damage, head, e.killed);
          if (e.backstab) this.hud.popText('BACKSTAB!', '#ff4f9a');
          else if (head && !e.killed) this.hud.popText('HEADSHOT', '#ffd23f');
          if (this.adapter.info().mode === 'range') {
            const me = this.me();
            this.rangeLast = { dmg: e.damage, dist: me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0, part: e.part };
            this.rangeDps.push({ t: this.adapter.info().time, d: e.damage });
          }
        }
        if (e.victim === local) {
          const att = this.fighter(e.attacker);
          const me = this.me();
          if (att && me) {
            const ang = Math.atan2(att.pos.x - me.pos.x, att.pos.z - me.pos.z);
            // convert to screen angle: 0 = ahead
            const fwdAng = Math.atan2(-Math.sin(this.input.yaw), -Math.cos(this.input.yaw));
            this.hud.damageIndicator(-(ang - fwdAng));
          }
          this.sfx.hurt();
          R.hurt(e.damage);
        }
        break;
      }
      case 'kill': {
        const killer = this.fighter(e.killer);
        const victim = this.fighter(e.victim);
        if (!killer || !victim) break;
        this.hud.killfeed(killer, victim, e.weapon, e.headshot, e.backstab, local);
        const floorY = this.adapter.world().surfaceBelow(victim.pos.x, victim.pos.z, 0.3, victim.pos.y + 0.1);
        R.effects.inkSplat(victim.pos.x + e.dir.x * 0.6, floorY, victim.pos.z + e.dir.z * 0.6, victim.color, e.headshot ? 2.6 : 1.8);
        const sm = R.stickmanOf(e.victim);
        if (sm) {
          tv.set(victim.vel.x, victim.vel.y, victim.vel.z);
          tv2.set(e.dir.x * 7, 2 + e.dir.y * 3, e.dir.z * 7);
          sm.startRagdoll(tv, tv2, e.headshot);
          if (e.headshot) {
            R.effects.burst(sm.headWorld, victim.color, 18, 6, 0.08, 0.8, 1);
            R.effects.burst(sm.headWorld, 0x1b1b24, 14, 7, 0.06, 0.8, 1);
          }
        }
        if (e.killer === local && e.victim !== local) {
          this.sfx.kill(e.headshot);
          R.hitStop(0.07);
          const streak = killer.stats.streak;
          const sub = e.headshot ? 'headshot +150' : e.backstab ? 'backstab +200' : '+100';
          this.hud.killNotice(victim.name, streak >= 3 ? `${sub} · ${streak} streak!` : sub);
          if (e.headshot) this.hud.popText('HEADSHOT!', '#ffd23f');
        }
        if (e.victim === local) {
          this.lastKillerName = killer.id === local ? '' : killer.name;
          this.lastKillerId = killer.id;
        }
        break;
      }
      case 'reload':
        if (e.id === local) this.sfx.reload(e.weapon, WEAPONS[e.weapon].reloadTime);
        break;
      case 'switch':
        if (e.id === local) this.sfx.switchWeapon();
        break;
      case 'dryfire':
        if (e.id === local) this.sfx.dryfire();
        break;
      case 'jump':
        if (e.id === local) this.sfx.jump();
        break;
      case 'land':
        if (e.id === local) {
          R.land(e.speed);
          if (e.speed > 4) this.sfx.land(e.speed);
        }
        break;
      case 'step': {
        if (e.id === local) this.sfx.footstep(0);
        else {
          const f = this.fighter(e.id);
          if (f) {
            const [d, pan] = this.spatial(f.pos);
            this.sfx.footstep(d, pan);
          }
        }
        break;
      }
      case 'slide':
        if (e.id === local) this.sfx.slide();
        break;
      case 'melee':
        if (e.id === local) {
          this.sfx.swing(e.heavy);
          R.lastMeleeSide = -R.lastMeleeSide;
        }
        break;
      case 'spawn':
        if (e.id === local) {
          const me = this.me()!;
          this.input.yaw = me.yaw;
          this.input.pitch = 0;
          this.hud.setDeath(false);
        }
        break;
      case 'matchEnd':
        this.state = 'ended';
        this.input.unlock();
        this.sfx.matchEnd();
        this.hud.scoreboard(false, [], 0, this.adapter.info());
        this.menus.showEnd(this.adapter.fighters(), local, () => void this.startMatch());
        break;
      case 'reloadDone':
        break;
    }
  }

  // ------------------------------------------------------------------ render frame (display rate)
  private frame(alpha: number, fdt: number) {
    this.renderTime += fdt;
    const [mdx, mdy] = this.input.consumeFrameDelta();
    if (this.state === 'menu') {
      this.renderer.render({
        fighters: this.backdrop.fighters(),
        localId: -1,
        alpha,
        viewYaw: 0,
        viewPitch: 0,
        mouseDX: 0,
        mouseDY: 0,
        time: this.backdrop.info().time,
        hfov: 90,
        spectateId: -1,
        orbit: true,
      });
      return;
    }
    const me = this.me();
    const info = this.adapter.info();
    if (me) {
      const def = WEAPONS[me.weapons[me.cur].id];
      // ADS sensitivity scales with zoom so tracking feels consistent
      this.input.adsFactor = 1 + (this.settings.adsSensitivity * def.adsFovMult - 1) * me.ads;
    }
    this.renderer.render({
      fighters: this.adapter.fighters(),
      localId: this.adapter.localId,
      alpha: this.state === 'playing' ? alpha : 1,
      viewYaw: this.input.yaw,
      viewPitch: this.input.pitch,
      mouseDX: mdx,
      mouseDY: mdy,
      time: info.time,
      hfov: this.settings.fov,
      spectateId: this.adapter.localId,
      deathLook: me && !me.alive ? this.fighter(this.lastKillerId)?.pos ?? null : null,
    });
    if (!me) return;
    this.hud.update(fdt, me, this.adapter.fighters(), info, this.loop.fps, this.settings.showFps);
    const def = WEAPONS[me.weapons[me.cur].id];
    const vfov = (this.renderer.camera.fov * Math.PI) / 180;
    this.hud.crosshair(computeSpread(me), vfov, def.id, me.ads, me.alive);
    this.hud.scoreboard(this.showBoard && this.state === 'playing', this.adapter.fighters(), this.adapter.localId, info);
    if (!me.alive) this.hud.setDeath(true, this.lastKillerName, Math.max(0, me.respawnTimer));
    if (info.mode === 'range') {
      const now = info.time;
      this.rangeDps = this.rangeDps.filter((x) => now - x.t < 1);
      const dps = this.rangeDps.reduce((a, b) => a + b.d, 0);
      const hs = Math.hypot(me.vel.x, me.vel.z);
      const acc = me.stats.shots ? Math.round((me.stats.hits / me.stats.shots) * 100) : 0;
      this.hud.setStats(
        `<b>speed</b> ${hs.toFixed(1)} m/s ${me.sliding ? '· slide' : ''}<br>` +
          `<b>last hit</b> ${this.rangeLast.dmg} (${this.rangeLast.part || '-'}) @ ${this.rangeLast.dist.toFixed(1)}m<br>` +
          `<b>dps</b> ${dps} · <b>acc</b> ${acc}% · <b>spread</b> ${(computeSpread(me) * 1000).toFixed(1)} mrad<br>` +
          `<b>frame</b> ${this.loop.frameMs.toFixed(2)} ms · ${this.renderer.renderer.info.render.calls} draws`,
      );
    } else this.hud.setStats(null);
  }
}
