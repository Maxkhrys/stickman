import * as THREE from 'three';
import { Profile } from '../core/Profile';
import { WEAPONS } from '../config/weapons';
import { SAND } from '../render/sand';
import { Input } from '../core/Input';
import { FixedLoop } from '../core/Loop';
import { loadSettings, saveSettings, type Settings } from '../core/Settings';
import { Sfx } from '../audio/Sfx';
import { LocalAdapter } from '../net/LocalAdapter';
import type { NetworkAdapter } from '../net/NetworkAdapter';
import { GameRenderer } from '../render/GameRenderer';
import { aimAngles, computeSpread, traceFireLine } from '../sim/combat';
import { eyePos, type Fighter } from '../sim/fighter';
import { TICK_DT } from '../sim/match';
import { emptyCommand, type GameEvent, type HitPart, type WeaponId } from '../sim/types';
import { flatRight, forwardFromAngles } from '../sim/vec';
import { Hud, WNAME } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { ScopeOverlay } from '../ui/ScopeOverlay';

type AppState = 'menu' | 'playing' | 'paused' | 'ended';

const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();

const PART_LABEL: Record<HitPart, string> = { head: 'head', chest: 'upper chest', stomach: 'stomach', limb: 'limb' };

export class App {
  readonly settings: Settings = loadSettings();
  readonly profile = new Profile();
  private matchId = '';
  private weaponKills: Partial<Record<WeaponId, number>> = {};
  private headshotKills = 0;
  readonly canvas = document.getElementById('game') as HTMLCanvasElement;
  readonly ui = document.getElementById('ui') as HTMLElement;
  readonly input = new Input(this.settings, this.canvas);
  readonly sfx = new Sfx();
  readonly renderer = new GameRenderer(this.canvas);
  readonly hud = new Hud(this.ui);
  readonly scope = new ScopeOverlay(this.ui);
  readonly menus: Menus;
  private adapter: NetworkAdapter = new LocalAdapter();
  private backdrop: NetworkAdapter = new LocalAdapter();
  private state: AppState = 'menu';
  readonly loop: FixedLoop;
  private showBoard = false;
  private lastKillerName = '';
  private lastKillerId = -1;
  private rangeLast = { dmg: 0, dist: 0, part: '-', weapon: '' };
  private rangeDps: { t: number; d: number }[] = [];
  private starting = false;
  /** input latency: click -> shot simulated, click -> first frame showing it */
  readonly latency = { sim: [] as number[], frame: [] as number[] };
  private measuredPress = 0;
  private awaitFrame = 0;

  constructor() {
    if (!this.profile.owns(this.settings.primary)) this.settings.primary = 'ar';
    this.menus = new Menus(this.ui, this.settings, this.input, {
      play: () => void this.startMatch(),
      resume: () => this.resume(),
      quit: () => this.toMenu(),
      settingsChanged: () => this.applySettings(),
      click: () => {
        this.sfx.unlock();
        this.sfx.ui();
      },
    }, this.profile);
    this.input.onToggleCamera = () => {
      this.settings.cameraMode = this.settings.cameraMode === 'first' ? 'third' : 'first';
      saveSettings(this.settings);
    };
    this.input.onSwapShoulder = () => { this.settings.shoulder = this.settings.shoulder === 1 ? -1 : 1; saveSettings(this.settings); };
    this.input.onPauseRequest = () => {
      if (this.state === 'playing') this.pause();
    };
    this.input.onScoreboard = (v) => (this.showBoard = v);
    this.input.onToggleHitboxes = () => {
      if (this.state !== 'playing' || this.adapter.info().mode !== 'range') return;
      this.settings.showHitboxes = !this.settings.showHitboxes;
      saveSettings(this.settings);
      this.applySettings();
    };
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
    this.sfx.setLevels(s.masterVolume, s.weaponVolume, s.feedbackVolume);
    this.renderer.motionScale = s.cameraShake;
    this.renderer.fovKickOn = s.fovKick;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s.renderScale * 0.75);
    this.hud.setCrosshairColor(s.crosshairColor);
    this.renderer.hitboxes.enabled = s.showHitboxes && this.state !== 'menu' && this.adapter.info().mode === 'range';
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
      botCount: s.botCount,
      primary: this.profile.owns(s.primary) ? s.primary : 'ar',
      mapId: s.mapId,
      playerColor: this.profile.color,
      timeLimit: 6 * 60,
      scoreLimit: s.mode === 'sketch' ? 60 : 25,
    });
    this.matchId = crypto.randomUUID();
    this.weaponKills = {}; this.headshotKills = 0;
    this.renderer.loadMap(this.adapter.map(), this.adapter.world());
    const me = this.me()!;
    this.input.yaw = me.yaw;
    this.input.pitch = 0;
    this.hud.reset();
    this.hud.show(true);
    this.menus.hideAll();
    this.state = 'playing';
    this.rangeDps = [];
    this.applySettings();
    if (s.mode === 'range') {
      this.hud.setNote('✎ <b>Practice range</b>: <kbd>1-4</kbd> / wheel swap all 6 weapons · <kbd>H</kbd> show hit regions · <kbd>RMB</kbd> aim / scope. Movement course on the right.', 8);
    } else if (s.mode === 'sketch') {
      this.hud.setNote('Hold the marked zone alone to score. First to 60. Zone moves every 40 seconds. V camera · Q shoulder.', 8);
    } else {
      this.hud.setNote(`✎ First to 25 erasures. ${s.botCount} bots on <b>${s.difficulty}</b>. <kbd>Tab</kbd> scores.`, 5);
    }
    void this.input.lock();
    this.starting = false;
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.unlock();
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
    this.scope.update(0, null);
    this.renderer.loadMap(this.backdrop.map(), this.backdrop.world());
    this.renderer.hitboxes.enabled = false;
    this.menus.showMain();
  }

  // ------------------------------------------------------------------ simulation tick (fixed rate)
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
        tv3.set(e.dir.x, e.dir.y, e.dir.z);
        if (e.id === local) {
          // one event drives flash, kick, sound and tracer - same tick as damage and ammo
          this.sfx.shot(e.weapon, 0);
          R.viewmodel.fire(e.weapon, R.zoom.adsE);
          R.punch(e.weapon === 'sniper' ? 0.08 : e.weapon === 'pistol' ? 0.04 : 0.02);
          if (R.thirdPersonActive) {
            tv.set(e.from.x, e.from.y, e.from.z);
            R.effects.worldFlash(tv, e.weapon === 'sniper' ? 0.8 : 0.5);
          } else R.localMuzzleWorld(tv);
          // latency: first shot after a fresh press (auto-fire continuation isn't a new click)
          const press = this.input.lastFirePress;
          const since = performance.now() - press;
          if (press > this.measuredPress && since < 250) {
            this.measuredPress = press;
            this.latency.sim.push(since);
            if (this.latency.sim.length > 30) this.latency.sim.shift();
            this.awaitFrame = press;
          }
          if (R.zoom.scopeCover < 0.5) R.effects.tracer(tv, tv2, e.weapon === 'sniper' ? 0.03 : 0.022, 0x2b2d42, 1.5 + 2.5 * R.zoom.adsE, e.weapon === 'sniper' ? 420 : 320, e.weapon === 'sniper' ? 6 : 3.2);
        } else {
          const [d, pan] = this.spatial(src.pos);
          this.sfx.shot(e.weapon, d, pan);
          tv.set(e.from.x, e.from.y, e.from.z);
          R.effects.worldFlash(tv, e.weapon === 'sniper' ? 0.8 : 0.5);
          R.effects.tracer(tv, tv2, e.weapon === 'sniper' ? 0.04 : 0.03, 0x8b5cf6, 0, 260, e.weapon === 'sniper' ? 6 : 3.5);
        }
        if (e.hitWorld && e.normal) {
          tv.set(e.normal.x, e.normal.y, e.normal.z);
          R.effects.impact(tv2, tv, tv3);
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
        if (!e.blocked) {
          const ink = victim ? victim.color : 0x1b1b24;
          if (SAND.enabled) {
            R.effects.sandBurst(tv, ink, SAND.impactGrains + (head ? 7 : 0), 3.8, tv2);
            if (victim && !e.killed) R.characters.wound(e.victim, e.pos, victim.yaw);
            const [sd, span] = this.spatial(e.pos);
            this.sfx.sandImpact(sd, span);
          } else {
            R.effects.burst(tv, head ? 0xffd23f : ink, head ? 8 : 5, 3.5, 0.05, 0.4, 1, tv2);
            R.effects.burst(tv, 0x1b1b24, 3, 2.5, 0.04, 0.4, 1, tv2);
          }
          R.characters.hurt(e.victim, e.dir.x, e.dir.z);
        }
        if (e.attacker === local) {
          if (e.blocked) {
            this.hud.hitmarker('blocked');
            this.sfx.blocked();
          } else {
            // kills get their own feedback from the kill event (no double hitmarker/sound)
            if (!e.killed) {
              this.hud.hitmarker(head ? 'head' : 'body');
              if (head) this.sfx.hitHead();
              else this.sfx.hitBody();
            }
            if (e.weapon === 'melee') this.sfx.meleeHit();
            if (this.settings.damageNumbers) {
              const sp = R.project(tv);
              if (sp) this.hud.damageNumber(sp.x, sp.y, e.damage, head, e.killed);
            }
            this.hud.tagTarget(e.victim, performance.now() / 1000);
          }
          const me = this.me();
          this.rangeLast = { dmg: e.damage, dist: me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0, part: PART_LABEL[e.part], weapon: WNAME[e.weapon] };
          this.rangeDps.push({ t: this.adapter.info().time, d: e.damage });
        }
        if (e.victim === local && !e.blocked) {
          const att = this.fighter(e.attacker);
          const me = this.me();
          if (att && me) {
            const ang = Math.atan2(att.pos.x - me.pos.x, att.pos.z - me.pos.z);
            const fwdAng = Math.atan2(-Math.sin(this.input.yaw), -Math.cos(this.input.yaw));
            this.hud.damageIndicator(-(ang - fwdAng), e.damage);
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
        if (!SAND.enabled) R.effects.inkSplat(victim.pos.x + e.dir.x * 0.6, floorY, victim.pos.z + e.dir.z * 0.6, victim.color, e.headshot ? 2.6 : 1.8);
        R.characters.kill(victim, e.dir, e.headshot);
        if (SAND.enabled) {
          const [sd, span] = this.spatial(victim.pos);
          this.sfx.sandCollapse(sd, span);
        }
        if (e.headshot) {
          const h = R.characters.headOf(victim.id);
          if (h) {
            if (SAND.enabled) R.effects.sandBurst(h, victim.color, 28, 4.6, tv2, SAND.pileLife);
            else {
              R.effects.burst(h, victim.color, 16, 5, 0.07, 0.7, 1);
              R.effects.burst(h, 0x1b1b24, 10, 6, 0.05, 0.7, 1);
            }
          }
        }
        if (e.killer === local && e.victim !== local) {
          if (this.adapter.info().mode !== 'range') {
            this.weaponKills[e.weapon] = (this.weaponKills[e.weapon] ?? 0) + 1;
            if (e.headshot) this.headshotKills++;
          }
          this.hud.hitmarker('kill');
          this.sfx.kill(e.headshot);
          R.hitStop(0.06);
          const streak = killer.stats.streak;
          const tag = e.headshot ? 'HEADSHOT' : e.backstab ? 'BACKSTAB' : streak >= 3 ? `${streak} STREAK` : '';
          this.hud.killNotice(victim.name, tag);
        }
        if (e.victim === local) {
          this.lastKillerName = killer.id === local ? '' : killer.name;
          this.lastKillerId = killer.id;
        }
        break;
      }
      case 'reload':
        if (e.id === local) this.sfx.reloadStart(e.weapon, WEAPONS[e.weapon].reloadTime);
        break;
      case 'reloadInsert':
        if (e.id === local) this.sfx.reloadInsert(e.weapon);
        break;
      case 'reloadDone': {
        const f = this.fighter(e.id);
        if (e.id === local && f) this.sfx.reloadDone(f.weapons[f.cur].id);
        break;
      }
      case 'bolt':
        if (e.id === local) this.sfx.bolt(WEAPONS.sniper.bolt!.time);
        break;
      case 'switch':
        if (e.id === local) {
          this.sfx.switchWeapon();
          if (SAND.enabled) this.sfx.sandForm();
        }
        break;
      case 'dryfire': {
        const f = this.fighter(e.id);
        if (e.id === local && f) this.sfx.dryfire(f.weapons[f.cur].id);
        break;
      }
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
      case 'protectEnd':
        if (e.id === local) this.sfx.protectEnd();
        break;
      case 'matchEnd':
        this.state = 'ended';
        this.input.unlock();
        this.sfx.matchEnd();
        this.scope.update(0, null);
        this.hud.scoreboard(false, [], 0, this.adapter.info());
        {
          const info = this.adapter.info(), me = this.me()!;
          const receipt = info.mode !== 'range' ? this.profile.settle({ id: this.matchId, kills: me.stats.kills, headshots: this.headshotKills, objective: me.stats.objective, won: info.winnerId === local, weaponKills: this.weaponKills }) : null;
          this.menus.showEnd(this.adapter.fighters(), local, () => void this.startMatch(), info, receipt);
        }
        break;
    }
  }

  // ------------------------------------------------------------------ render frame (display rate)
  private frame(alpha: number, fdt: number) {
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
        tickDt: TICK_DT,
        frameDt: fdt,
        hfov: 90,
        spectateId: -1,
        orbit: true,
      });
      return;
    }
    const me = this.me();
    const info = this.adapter.info();
    this.renderer.render({
      fighters: this.adapter.fighters(),
      localId: this.adapter.localId,
      alpha: this.state === 'playing' ? alpha : 1,
      viewYaw: this.input.yaw,
      viewPitch: this.input.pitch,
      mouseDX: mdx,
      mouseDY: mdy,
      time: info.time,
      tickDt: TICK_DT,
      frameDt: fdt,
      hfov: this.settings.fov,
      spectateId: this.adapter.localId,
      thirdPerson: this.settings.cameraMode === 'third',
      shoulder: this.settings.shoulder,
      objective: info.objective,
      deathLook: me && !me.alive ? this.fighter(this.lastKillerId)?.pos ?? null : null,
    });
    if (this.awaitFrame > 0) {
      // the frame that shows the muzzle flash has just been submitted
      this.latency.frame.push(performance.now() - this.awaitFrame);
      if (this.latency.frame.length > 30) this.latency.frame.shift();
      this.awaitFrame = 0;
    }
    if (!me) return;
    const z = this.renderer.zoom;
    const def = WEAPONS[me.weapons[me.cur].id];
    // Sensitivity follows the presented zoom (no jumps mid-transition), times the ADS/scope preference.
    const fovRatio = Math.tan(z.vfov / 2) / Math.tan(z.baseVfov / 2);
    const pref = def.scope ? this.settings.scopeSensitivity : this.settings.adsSensitivity;
    this.input.sensScale = fovRatio * (1 + (pref - 1) * z.adsE);
    this.scope.update(me.alive ? z.scopeCover : 0, z.eyepiece);

    this.hud.update(fdt, me, this.adapter.fighters(), info, this.loop.fps, this.settings.showFps);
    this.hud.crosshair(computeSpread(me), z.vfov, def.id, this.renderer.thirdPersonActive ? 0 : Math.max(z.adsE, z.scopeCover), me.alive && z.scopeCover < 0.5);
    if (this.renderer.thirdPersonActive) {
      const aim = aimAngles(me, info.time);
      // A copy reflects immediate mouse input without mutating authoritative state.
      const sight = { ...me, yaw: this.input.yaw, pitch: this.input.pitch };
      const dir = forwardFromAngles(this.input.yaw + aim.yaw - me.yaw, this.input.pitch + aim.pitch - me.pitch);
      const trace = traceFireLine({ world: this.adapter.world(), fighters: this.adapter.fighters() }, sight, dir);
      const point = trace.tr.point;
      this.hud.aimPoint(this.renderer.project(tv.set(point.x, point.y, point.z)), trace.obstructed);
    } else this.hud.aimPoint(null);
    this.hud.objective(info, me);
    this.hud.scoreboard(this.showBoard && this.state === 'playing', this.adapter.fighters(), this.adapter.localId, info);
    this.hud.updateTags(performance.now() / 1000, this.adapter.fighters(), (id) => {
      const h = this.renderer.characters.headOf(id);
      return h ? this.renderer.project(h.setY(h.y + 0.25)) : null;
    });
    if (!me.alive) this.hud.setDeath(true, this.lastKillerName, Math.max(0, me.respawnTimer));
    if (info.mode === 'range') {
      const now = info.time;
      this.rangeDps = this.rangeDps.filter((x) => now - x.t < 1);
      const dps = this.rangeDps.reduce((a, b) => a + b.d, 0);
      const hs = Math.hypot(me.vel.x, me.vel.z);
      const acc = me.stats.shots ? Math.round((me.stats.hits / me.stats.shots) * 100) : 0;
      const lat = this.latency.sim.length ? this.latency.sim.reduce((a, b) => a + b, 0) / this.latency.sim.length : 0;
      const latF = this.latency.frame.length ? this.latency.frame.reduce((a, b) => a + b, 0) / this.latency.frame.length : 0;
      const eye = eyePos(me);
      void eye;
      this.hud.setStats(
        `<b>last hit</b> ${this.rangeLast.dmg} · ${this.rangeLast.part} · ${this.rangeLast.dist.toFixed(1)} m<br>` +
          `<b>dps</b> ${dps} · <b>acc</b> ${acc}% · <b>spread</b> ${(computeSpread(me) * 1000).toFixed(1)} mrad<br>` +
          `<b>speed</b> ${hs.toFixed(1)} m/s${me.sliding ? ' · slide' : ''} · <b>ADS</b> ${Math.round(z.adsE * 100)}%<br>` +
          `<b>click→shot</b> ${lat.toFixed(1)} ms · <b>→frame</b> ${latF.toFixed(1)} ms<br>` +
          `<b>frame</b> ${this.loop.frameMs.toFixed(2)} ms · ${this.renderer.renderer.info.render.calls} draws<br>` +
          `<span class="k">H</span> hit regions ${this.settings.showHitboxes ? 'on' : 'off'} · <span class="k">1-4</span> weapons`,
      );
    } else this.hud.setStats(null);
    void def;
  }
}
