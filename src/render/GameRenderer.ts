import * as THREE from 'three';
import { ObjectiveMarker } from './ObjectiveMarker';
import type { ObjectiveInfo } from '../sim/match';
import { clipCamera } from './thirdPerson';
import { MOVE } from '../config/movement';
import { WEAPONS } from '../config/weapons';
import { kickAt, type Fighter } from '../sim/fighter';
import type { MapDef } from '../sim/map';
import type { World } from '../sim/world';
import { CharacterRenderer } from './CharacterRenderer';
import { Effects } from './Effects';
import { HitboxDebug } from './HitboxDebug';
import { buildMapMesh } from './mapMesh';
import { Viewmodel, adsEase } from './Viewmodel';

class Spring {
  x = 0;
  v = 0;
  constructor(private k: number, private c: number) {}
  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }
}

export interface FrameInput {
  fighters: readonly Fighter[];
  localId: number;
  alpha: number;
  viewYaw: number;
  viewPitch: number;
  mouseDX: number;
  mouseDY: number;
  /** sim time of the latest tick */
  time: number;
  tickDt: number;
  /** display frame duration (s) - drives all presentation animation */
  frameDt: number;
  hfov: number;
  spectateId: number;
  /** menu backdrop: slow orbit over the arena, no viewmodel */
  orbit?: boolean;
  objective?: ObjectiveInfo | null;
  thirdPerson?: boolean;
  shoulder?: -1 | 1;
  /** death cam target (killer position) */
  deathLook?: { x: number; y: number; z: number } | null;
}

/** What the rest of the client needs to stay in sync with the presented zoom. */
export interface ZoomInfo {
  /** current world vertical FOV (rad) and the un-zoomed one */
  vfov: number;
  baseVfov: number;
  /** eased ADS 0..1 */
  adsE: number;
  /** scope overlay coverage 0..1 */
  scopeCover: number;
  /** projected eyepiece rim for the overlay hand-off */
  eyepiece: { x: number; y: number; r: number } | null;
}

const smooth01 = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly effects = new Effects();
  readonly objective = new ObjectiveMarker();
  readonly viewmodel = new Viewmodel();
  readonly characters: CharacterRenderer;
  readonly hitboxes = new HitboxDebug();
  private mapGroup: THREE.Group | null = null;
  private world: World | null = null;

  // camera rig state
  private eyeH: number = MOVE.standHeight - MOVE.eyeFromTop;
  private bobPhase = 0;
  private bobAmt = 0;
  private dip = new Spring(140, 16);
  private fovPunch = new Spring(260, 22);
  private shake = 0;
  private roll = 0;
  private fovKick = 0;
  /** camera-only smoothing of instant step-ups (stairs, ramp lips); the fighter's position is untouched */
  private stepOff = 0;
  private lastPy = NaN;
  private lastPx = 0;
  private lastPz = 0;
  private lastStepId = -1;
  lastMeleeSide = 1;
  /** camera shake / bob / roll scale (settings) */
  motionScale = 1;
  fovKickOn = true;
  private hitStopT = 0;
  thirdPersonActive = false;
  private shoulderOffset = 0.8;
  private rings: THREE.Object3D[] = [];
  readonly zoom: ZoomInfo = { vfov: 1, baseVfov: 1, adsE: 0, scopeCover: 0, eyepiece: null };
  /** live scope image for the sniper eyepiece while it approaches the eye */
  private scopeRT = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: true });
  private scopeCam = new THREE.PerspectiveCamera(17, 1, 0.05, 400);
  private lensMat = new THREE.MeshBasicMaterial({ map: this.scopeRT.texture });
  private lensDark: THREE.Material | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x9a917f, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, 1, 0.25);
    this.scene.add(sun);
    this.characters = new CharacterRenderer(this.effects);
    this.scene.add(this.characters.group, this.effects.group, this.hitboxes.group, this.objective.group);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(w / h);
    const ink = this.mapGroup?.getObjectByName('inkLines') as (THREE.Mesh & { material: { resolution: THREE.Vector2; linewidth: number } }) | undefined;
    if (ink) {
      ink.material.resolution.set(w, h);
      ink.material.linewidth = Math.max(1.5, Math.min(3.5, 2.4 * h / 900));
    }
  }

  setPixelRatio(r: number) {
    this.renderer.setPixelRatio(r);
    this.resize();
  }

  loadMap(map: MapDef, world: World) {
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          o.geometry.dispose();
          const m = o.material as THREE.Material & { map?: THREE.Texture };
          m.map?.dispose();
          m.dispose();
        }
      });
    }
    this.characters.reset();
    this.effects.clear();
    this.world = world;
    this.mapGroup = buildMapMesh(map);
    this.scene.add(this.mapGroup);
    this.resize();
    this.rings = this.mapGroup.children.filter((o) => o.name === 'ring');
    this.scene.background = new THREE.Color(map.skyColor);
    this.scene.fog = new THREE.Fog(map.fogColor, 70, 200);
  }

  // ---- feedback hooks (presentation only) ----
  punch(amount: number) {
    // FOV punch: feels punchy without moving the aim point
    this.fovPunch.v += amount * 40;
  }
  land(speed: number) {
    if (speed < 3) return;
    this.dip.v -= Math.min(speed, 22) * 0.06;
    this.viewmodel.land(speed);
  }
  hurt(amount: number) {
    this.shake = Math.min(1, this.shake + amount / 70);
  }
  /** Presentation-only hit-stop: world animation (ragdolls, particles) slows briefly. Sim + mouse keep running. */
  hitStop(seconds: number) {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }

  /** Project a world position to screen pixels (null if behind camera). */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const t = p.clone().project(this.camera);
    if (t.z > 1) return null;
    return { x: (t.x * 0.5 + 0.5) * window.innerWidth, y: (-t.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Muzzle in world space for the local tracer: match the viewmodel muzzle's SCREEN position. */
  localMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.viewmodel.muzzleVM).project(this.viewmodel.camera);
    out.z = 0.5;
    out.unproject(this.camera);
    const cp = this.camera.position;
    return out.sub(cp).normalize().multiplyScalar(0.9).add(cp);
  }

  render(fi: FrameInput) {
    const dt = Math.min(0.05, Math.max(0, fi.frameDt));
    const a = fi.alpha;
    const world = this.world!;
    const worldDt = this.hitStopT > 0 ? dt * 0.12 : dt;
    this.hitStopT -= dt;
    for (const r of this.rings) r.rotation.y += dt * (r.userData.spin as number);
    const renderTime = fi.time + a * fi.tickDt;

    // ---------------- camera ----------------
    this.thirdPersonActive = false;
    const me = fi.orbit ? undefined : fi.fighters.find((f) => f.id === fi.spectateId);
    const baseV = 2 * Math.atan(Math.tan((fi.hfov * Math.PI) / 360) / this.camera.aspect);
    this.zoom.baseVfov = baseV;
    if (fi.orbit) {
      const t = fi.time * 0.05;
      this.camera.position.set(Math.cos(t) * 38, 17, Math.sin(t) * 26);
      this.camera.lookAt(0, 1.5, 0);
      const vfov = 2 * Math.atan(Math.tan((85 * Math.PI) / 360) / this.camera.aspect);
      this.camera.fov = (vfov * 180) / Math.PI;
      this.camera.updateProjectionMatrix();
      this.zoom.vfov = vfov;
      this.zoom.adsE = 0;
      this.zoom.scopeCover = 0;
    }
    if (me) {
      const px = me.prevPos.x + (me.pos.x - me.prevPos.x) * a;
      const py = me.prevPos.y + (me.pos.y - me.prevPos.y) * a;
      const pz = me.prevPos.z + (me.pos.z - me.prevPos.z) * a;
      const def = WEAPONS[me.weapons[me.cur].id];
      const ads = me.prevAds + (me.ads - me.prevAds) * a;
      const adsE = adsEase(ads);
      const ms = this.motionScale;
      const targetEye = me.height - MOVE.eyeFromTop;
      this.eyeH += (targetEye - this.eyeH) * (1 - Math.exp(-18 * dt));
      const hs = Math.hypot(me.vel.x, me.vel.z);
      const moveT = me.onGround && !me.sliding ? Math.min(hs / MOVE.maxSpeed, 1.2) : 0;
      this.bobAmt += (moveT - this.bobAmt) * (1 - Math.exp(-10 * dt));
      this.bobPhase += dt * hs * 1.75;
      this.dip.step(dt);
      this.fovPunch.step(dt);
      this.shake = Math.max(0, this.shake - dt * 3);
      const calm = (1 - 0.85 * adsE) * ms;
      const bobY = (Math.abs(Math.sin(this.bobPhase)) * 0.04 - 0.02) * this.bobAmt * calm;
      const bobX = Math.cos(this.bobPhase) * 0.018 * this.bobAmt * calm;

      const stepDy = py - this.lastPy;
      if (this.lastStepId !== me.id || !me.alive || !(Math.abs(stepDy) < 1.5)) this.stepOff = 0;
      // a rise steeper than any ramp (slopes are <= ~0.65) is a step: ease the eye up over ~0.15 s
      else if (me.onGround && stepDy > 0.05 && stepDy > Math.hypot(px - this.lastPx, pz - this.lastPz) * 0.9) this.stepOff = Math.max(-0.6, this.stepOff - stepDy);
      this.stepOff *= Math.exp(-16 * dt);
      this.lastPy = py;
      this.lastPx = px;
      this.lastPz = pz;
      this.lastStepId = me.id;
      let camY = py + this.eyeH + this.stepOff + bobY + this.dip.x * 0.35 * ms;
      if (!me.alive) camY = py + 0.5 + Math.min(1.5, (fi.time - me.deathTime) * 1.2);
      const sy = Math.sin(fi.viewYaw), cy = Math.cos(fi.viewYaw);
      const lvx = me.vel.x * cy - me.vel.z * sy;
      const targetRoll = ((me.sliding ? 0.06 : 0) + (-lvx / MOVE.maxSpeed) * 0.01) * ms * (1 - adsE);
      this.roll += (targetRoll - this.roll) * (1 - Math.exp(-8 * dt));

      // gameplay recoil, shown immediately (latest sim state + analytic impulse decay):
      // the screen centre is exactly where the next shot goes.
      const kick = kickAt(me, renderTime);
      const ry = me.recoilYaw + kick.yaw;
      const rp = me.recoilPitch + kick.pitch;
      const sh = this.shake * this.shake * ms * (1 - this.zoom.scopeCover);
      const shakeRoll = (Math.random() - 0.5) * sh * 0.02;

      this.camera.position.set(px + bobX * cy, camY, pz - bobX * sy);
      if (me.alive) {
        this.camera.rotation.set(fi.viewPitch + rp, fi.viewYaw + ry, this.roll + shakeRoll + Math.sin(this.bobPhase) * 0.002 * this.bobAmt * calm);
      } else if (fi.deathLook) {
        const q = this.camera.quaternion.clone();
        this.camera.lookAt(fi.deathLook.x, fi.deathLook.y + 1.2, fi.deathLook.z);
        q.slerp(this.camera.quaternion, 1 - Math.exp(-5 * dt));
        this.camera.quaternion.copy(q);
      } else {
        this.camera.rotation.set(-0.5, fi.viewYaw, 0.2);
      }

      // Camera is presentation only. Aim remains the fighter's eye ray and the HUD
      // projects its actual impact, so shoulder peeking never creates a camera-origin shot.
      this.thirdPersonActive = !!fi.thirdPerson && me.alive && !(def.scope && ads > 0.05);
      if (this.thirdPersonActive) {
        const side = (fi.shoulder ?? 1) * (0.8 - adsE * 0.35);
        this.shoulderOffset += (side - this.shoulderOffset) * (1 - Math.exp(-16 * dt));
        const back = 3.25 - adsE * 1.6;
        const pivot = { x: px, y: py + this.eyeH, z: pz };
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const desired = {
          x: pivot.x - forward.x * back + cy * this.shoulderOffset,
          y: pivot.y - forward.y * back + 0.22,
          z: pivot.z - forward.z * back - sy * this.shoulderOffset,
        };
        const safe = clipCamera(world, pivot, desired);
        this.camera.position.set(safe.x, safe.y, safe.z);
        // Hide the local body if a wall forces the camera into it.
        if (Math.hypot(safe.x - px, safe.z - pz) < 0.55) { this.thirdPersonActive = false; this.camera.position.set(px + bobX * cy, camY, pz - bobX * sy); }
      }

      // ---- FOV: speed kick at hip, iron-sight zoom, scope zoom synced with the overlay ----
      const speedKick = Math.max(0, Math.min(1, (hs - MOVE.maxSpeed * 0.9) / 6));
      const targetKick = this.fovKickOn ? (speedKick * 7 + (me.sliding ? 5 : 0)) * (1 - adsE) : 0;
      this.fovKick += (targetKick - this.fovKick) * (1 - Math.exp(-6 * dt));
      const hipH = ((fi.hfov + this.fovKick + this.fovPunch.x) * Math.PI) / 360;
      let tanV = Math.tan(hipH) / this.camera.aspect;
      tanV *= 1 + (def.adsZoom - 1) * adsE;
      let scopeCover = 0;
      if (def.scope && me.alive) {
        const sc = def.scope;
        // the world zoom lands exactly when the overlay takes over from the eyepiece
        scopeCover = smooth01((ads - sc.overlayStart) / (sc.overlayFull - sc.overlayStart));
        const tanS = Math.tan((sc.vfov * Math.PI) / 360);
        tanV = tanV + (tanS - tanV) * scopeCover;
      }
      const vfov = 2 * Math.atan(tanV);
      this.camera.fov = (vfov * 180) / Math.PI;
      this.camera.updateProjectionMatrix();
      this.zoom.vfov = vfov;
      this.zoom.adsE = adsE;
      this.zoom.scopeCover = scopeCover;

      // ---- viewmodel ----
      const slot = me.weapons[me.cur];
      const reloading = me.reloadTimer > 0 && def.reloadTime > 0;
      let boltProgress = -1;
      if (def.bolt && slot.boltLeft > 0 && slot.boltLeft <= def.bolt.time && !reloading) boltProgress = 1 - slot.boltLeft / def.bolt.time;
      this.viewmodel.update(dt, {
        weapon: def.id,
        ads,
        drawProgress: def.drawTime > 0 ? Math.min(1, me.switchTimer / def.drawTime) : 0,
        reloadProgress: reloading ? 1 - me.reloadTimer / def.reloadTime : -1,
        boltProgress,
        magFrac: def.magSize ? slot.mag / def.magSize : 1,
        magEmpty: def.magSize > 0 && slot.mag === 0,
        sinceShot: renderTime - me.lastShotTime,
        speed: hs,
        grounded: me.onGround,
        sliding: me.sliding,
        crouching: me.crouching,
        mouseDX: fi.mouseDX,
        mouseDY: fi.mouseDY,
        meleeT: renderTime - me.lastMeleeTime,
        meleeHeavy: me.lastMeleeHeavy,
        meleeSide: this.lastMeleeSide,
        alive: me.alive,
        motionScale: ms,
        scopeCover,
      });
      this.zoom.eyepiece = this.viewmodel.eyepiece;
    }
    this.camera.updateMatrixWorld();
    this.objective.update(fi.objective, fi.localId);

    // ---------------- world ----------------
    this.characters.update(worldDt, fi.fighters, a, renderTime, fi.orbit || this.thirdPersonActive ? -1 : fi.spectateId, world, this.camera);
    this.hitboxes.update(fi.fighters, fi.spectateId);
    this.effects.camPos.copy(this.camera.position);
    this.effects.setWorld(world);
    this.effects.update(worldDt);

    // live scope image inside the eyepiece while it rises to the eye: its field of view matches what the
    // full-screen scope shows inside a circle of the same on-screen size, so the hand-off is seamless
    const lens = this.viewmodel.scopeLens;
    const ep = this.zoom.eyepiece;
    const sniperUp = !this.thirdPersonActive && !!me && me.alive && me.weapons[me.cur].id === 'sniper' && this.zoom.adsE > 0.02 && this.zoom.scopeCover < 0.999 && !!ep;
    if (sniperUp && ep) {
      if (!this.lensDark) this.lensDark = lens.material as THREE.Material;
      lens.material = this.lensMat;
      const scopeV = ((WEAPONS.sniper.scope!.vfov * Math.PI) / 180) * 0.5;
      const frac = Math.min(1.2, (2 * ep.r) / window.innerHeight);
      const half = Math.atan(Math.tan(scopeV) * frac);
      this.scopeCam.fov = Math.max(1, (2 * half * 180) / Math.PI);
      this.scopeCam.position.copy(this.camera.position);
      this.scopeCam.quaternion.copy(this.camera.quaternion);
      this.scopeCam.updateProjectionMatrix();
      this.scopeCam.updateMatrixWorld();
      this.renderer.setRenderTarget(this.scopeRT);
      this.renderer.clear();
      this.renderer.render(this.scene, this.scopeCam);
      this.renderer.setRenderTarget(null);
    } else if (this.lensDark) lens.material = this.lensDark;

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (me && !this.thirdPersonActive && this.zoom.scopeCover < 0.999) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }
}
