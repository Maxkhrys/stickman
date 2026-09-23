import * as THREE from 'three';
import type { WeaponId } from '../sim/types';
import { makeFlashTexture, makeSmokeTexture } from './textures';
import { buildLeftGlove, buildRightGlove, buildSleeve, type HandRig } from './vm/hands';
import { bump, clamp01, seg } from './vm/kit';
import { buildWeaponRigs, type WeaponRig } from './vm/weapons';

class Spring {
  x = 0;
  v = 0;
  constructor(private k: number, private c: number) {}
  step(dt: number) {
    // semi-implicit Euler, sub-stepped for stability at low frame rates
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
  }
}

export interface ViewmodelInput {
  weapon: WeaponId;
  /** linear ADS progress from the sim (interpolated) */
  ads: number;
  /** 1 = draw just started, 0 = done */
  drawProgress: number;
  /** -1 = not reloading, else 0..1 */
  reloadProgress: number;
  /** bolt cycle progress 0..1, or -1 when not cycling */
  boltProgress: number;
  magFrac: number;
  magEmpty: boolean;
  sinceShot: number;
  speed: number;
  grounded: boolean;
  sliding: boolean;
  crouching: boolean;
  mouseDX: number;
  mouseDY: number;
  meleeT: number;
  meleeHeavy: boolean;
  meleeSide: number;
  alive: boolean;
  /** 0..1 camera shake / bob setting */
  motionScale: number;
  /** scope overlay coverage 0..1 (viewmodel hides when fully scoped) */
  scopeCover: number;
}

/** ADS blend curve: fast start, settles without overshoot. Pure function of progress: no drift. */
export const adsEase = (t: number) => Math.sin((clamp01(t) * Math.PI) / 2);

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

function poseOf(o: THREE.Object3D, out: Pose): Pose {
  o.updateWorldMatrix(true, false);
  o.matrixWorld.decompose(out.p, out.q, tmpV2);
  return out;
}

function blendPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.p.lerpVectors(a.p, b.p, t);
  out.q.slerpQuaternions(a.q, b.q, t);
  return out;
}

const mkPose = (): Pose => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rigs: Record<WeaponId, WeaponRig>;
  private cur: WeaponId = 'ar';
  private handR: HandRig;
  private handL: HandRig;
  private sleeveR = buildSleeve();
  private sleeveL = buildSleeve();
  private kickZ = new Spring(320, 30);
  private kickPitch = new Spring(260, 26);
  private kickRoll = new Spring(240, 24);
  private kickX = new Spring(260, 26);
  private landDip = new Spring(140, 15);
  private swayYaw = 0;
  private swayPitch = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private slideTilt = 0;
  private time = 0;
  private flash: THREE.Sprite;
  private flashCore: THREE.Sprite;
  private flashT = 0;
  private flashLife = 0.04;
  private puffs: { s: THREE.Sprite; t: number; life: number; v: THREE.Vector3 }[] = [];
  private puffIdx = 0;
  private droppedMag: { obj: THREE.Object3D; t: number } | null = null;
  private magDropClones = new Map<WeaponId, THREE.Object3D>();
  /** last computed muzzle position in viewmodel camera space */
  readonly muzzleVM = new THREE.Vector3();
  /** eased ADS used for this frame (exposed for sensitivity / HUD sync) */
  adsE = 0;
  /** projected sniper eyepiece rim (px) this frame, for the scope overlay hand-off */
  eyepiece: { x: number; y: number; r: number } | null = null;
  /** the eyepiece glass mesh (its material shows the live scope render) */
  readonly scopeLens: THREE.Mesh;

  private pA = mkPose();
  private pB = mkPose();
  private pC = mkPose();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0b4, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1, 0.5);
    this.scene.add(key);
    this.rigs = buildWeaponRigs();
    for (const r of Object.values(this.rigs)) {
      r.root.visible = false;
      this.scene.add(r.root);
      if (r.parts.mag) {
        const c = r.parts.mag.clone(true);
        c.visible = false;
        this.scene.add(c);
        this.magDropClones.set(r.id, c);
      }
    }
    this.rigs.ar.root.visible = true;
    this.scopeLens = this.rigs.sniper.root.getObjectByName('scopeLens') as THREE.Mesh;
    this.handR = buildRightGlove();
    this.handL = buildLeftGlove();
    this.scene.add(this.handR.group, this.handL.group, this.sleeveR, this.sleeveL);
    const flashTex = makeFlashTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flashCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xfff6d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = this.flashCore.visible = false;
    this.scene.add(this.flash, this.flashCore);
    const smoke = makeSmokeTexture();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, color: 0x2b2d42, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      this.scene.add(s);
      this.puffs.push({ s, t: 0, life: 0.3, v: new THREE.Vector3() });
    }
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** Decorative kick. Gameplay recoil is separate (it moves the camera/aim in the sim). */
  fire(weapon: WeaponId, adsE: number) {
    const a = 1 - adsE;
    if (weapon === 'ar') {
      this.kickZ.v += 0.75;
      this.kickPitch.v += 1.6 * (0.35 + 0.65 * a);
      this.kickRoll.v += (Math.random() - 0.5) * 0.9 * (0.3 + 0.7 * a);
      this.kickX.v += (Math.random() - 0.5) * 0.08 * a;
      this.flashLife = 0.035;
    } else if (weapon === 'pistol') {
      this.kickZ.v += 0.8;
      this.kickPitch.v += 5.2 * (0.4 + 0.6 * a);
      this.kickRoll.v += (Math.random() - 0.5) * 1.2;
      this.flashLife = 0.045;
    } else if (weapon === 'sniper') {
      this.kickZ.v += 1.9;
      this.kickPitch.v += 7.5;
      this.kickRoll.v += 1.4;
      this.flashLife = 0.06;
    }
    this.flashT = this.flashLife;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flashCore.material.rotation = Math.random() * Math.PI;
    const size = (weapon === 'sniper' ? 0.2 : weapon === 'pistol' ? 0.13 : 0.1) * (1 - 0.45 * adsE) * (0.85 + Math.random() * 0.3);
    this.flash.scale.set(size, size, 1);
    this.flashCore.scale.set(size * 0.45, size * 0.45, 1);
    // ink puff drifting off the muzzle
    const p = this.puffs[this.puffIdx];
    this.puffIdx = (this.puffIdx + 1) % this.puffs.length;
    p.t = 0;
    p.life = weapon === 'sniper' ? 0.5 : 0.28;
    p.v.set((Math.random() - 0.5) * 0.05, 0.08 + Math.random() * 0.05, -0.1);
    p.s.visible = true;
    p.s.position.copy(this.muzzleVM);
    p.s.userData.base = weapon === 'sniper' ? 0.09 : 0.05;
  }

  land(speed: number) {
    this.landDip.v -= Math.min(speed, 20) * 0.03;
  }

  private rigFor(w: WeaponId) {
    return this.rigs[w];
  }

  update(dt: number, s: ViewmodelInput) {
    this.time += dt;
    if (s.weapon !== this.cur) {
      this.rigs[this.cur].root.visible = false;
      this.cur = s.weapon;
      this.droppedMag = null;
      for (const c of this.magDropClones.values()) c.visible = false;
    }
    const rig = this.rigFor(this.cur);
    const visible = s.alive && s.scopeCover < 0.999;
    rig.root.visible = visible;
    this.handR.group.visible = this.handL.group.visible = visible;
    this.sleeveR.visible = this.sleeveL.visible = visible;
    if (!s.alive) {
      this.flash.visible = this.flashCore.visible = false;
      return;
    }

    for (const sp of [this.kickZ, this.kickPitch, this.kickRoll, this.kickX, this.landDip]) sp.step(dt);

    const e = adsEase(s.ads);
    this.adsE = e;
    const still = 1 - 0.88 * e; // motion suppression while aiming
    const ms = s.motionScale;

    // ---- sway: lags the mouse, returns to zero (no drift) ----
    const k = 1 - Math.exp(-12 * dt);
    const tYaw = Math.max(-0.06, Math.min(0.06, -s.mouseDX * 0.00055));
    const tPitch = Math.max(-0.05, Math.min(0.05, s.mouseDY * 0.00055));
    this.swayYaw += (tYaw - this.swayYaw) * k;
    this.swayPitch += (tPitch - this.swayPitch) * k;

    // ---- movement bob ----
    const moveT = s.grounded && !s.sliding ? Math.min(s.speed / 8.2, 1.3) : 0;
    this.bobAmt += (moveT - this.bobAmt) * (1 - Math.exp(-8 * dt));
    this.bobPhase += dt * s.speed * 1.75;
    const bob = this.bobAmt * still * ms;
    const bx = Math.sin(this.bobPhase) * 0.011 * bob;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * bob + Math.sin(this.time * 1.7) * 0.0016 * still;
    this.slideTilt += ((s.sliding ? 1 : 0) - this.slideTilt) * (1 - Math.exp(-10 * dt));

    // ---- base pose: hip -> exact sight alignment ----
    const rear = rig.sockets.rearSight.position;
    const adsPos = tmpV.set(-rear.x, -rear.y, -(rig.eyeRelief + rear.z));
    const pos = new THREE.Vector3().lerpVectors(rig.hip.pos, adsPos, e);
    const hipQ = tmpQ.setFromEuler(rig.hip.rot);
    const quat = new THREE.Quaternion().slerpQuaternions(hipQ, tmpQ2.identity(), e);

    // ---- decorative offsets ----
    const off = new THREE.Vector3(bx + this.swayYaw * 0.18 * still, by - this.swayPitch * 0.12 * still + this.landDip.x * 0.4 * ms, 0);
    let pitch = this.swayPitch * 0.6 * still;
    let yaw = this.swayYaw * 0.8 * still;
    let roll = this.slideTilt * 0.28 * ms + this.swayYaw * 1.2 * still;
    off.y -= this.slideTilt * 0.02 + (s.crouching ? 0.008 * (1 - e) : 0);
    // kick: ADS keeps the sight picture (mostly straight back)
    off.z += this.kickZ.x * 0.018;
    off.x += this.kickX.x * 0.01;
    pitch += this.kickPitch.x * 0.03;
    roll += this.kickRoll.x * 0.02;

    // ---- draw ----
    if (s.drawProgress > 0) {
      const d = s.drawProgress * s.drawProgress;
      off.y -= 0.2 * d;
      off.z += 0.04 * d;
      pitch -= 0.5 * d;
      roll -= 0.25 * d;
    }

    // ---- per-weapon mechanical animation ----
    const handRTarget: 'grip' | 'bolt' | 'charge' = 'grip';
    let rHand: string = handRTarget;
    let lBlend = 0; // 0 = support grip, 1 = alt target
    let lTarget: 'mag' | 'pouch' = 'mag';
    let rBlend = 0;
    if (rig.parts.mag && rig.magRest) rig.parts.mag.position.copy(rig.magRest);
    if (rig.parts.mag) rig.parts.mag.visible = true;
    if (rig.parts.charge) rig.parts.charge.position.z = 0.132;
    if (rig.parts.bolt) {
      rig.parts.bolt.rotation.set(0, 0, 0);
      rig.parts.bolt.position.z = 0.06;
    }
    let magFrac = s.magFrac;

    const reload = s.reloadProgress;
    if (reload >= 0 && rig.parts.mag && rig.magRest) {
      const p = reload;
      // present the magwell to the camera: raise, pull in, muzzle up, roll the belly toward us
      const tilt = seg(p, 0, 0.12) * (1 - seg(p, 0.84, 1));
      if (rig.id === 'pistol') {
        roll -= 0.4 * tilt;
        pitch += 0.38 * tilt;
        yaw += 0.12 * tilt;
        off.x -= 0.04 * tilt;
        off.y += 0.1 * tilt;
        off.z -= 0.02 * tilt;
      } else {
        roll -= 0.55 * tilt;
        pitch += 0.22 * tilt;
        yaw -= 0.12 * tilt;
        off.x -= 0.075 * tilt;
        off.y += 0.11 * tilt;
        off.z += 0.03 * tilt;
      }
      const mag = rig.parts.mag;
      if (rig.id === 'pistol') {
        // mag drops free, hand fetches a new one from below
        if (p < 0.36) {
          const fall = seg(p, 0.08, 0.3);
          mag.position.y -= fall * 0.3;
          mag.visible = p < 0.3;
        } else {
          mag.position.y -= (1 - seg(p, 0.36, 0.58)) * 0.22;
        }
        lTarget = p < 0.34 ? 'pouch' : 'mag';
        lBlend = seg(p, 0.1, 0.26) * (1 - seg(p, 0.6, 0.74));
        if (p > 0.26 && p < 0.36) lTarget = 'pouch';
        magFrac = p < 0.36 ? 0 : 1;
      } else {
        // pull the old mag, drop it, bring a new one, seat it (at reloadInsertAt), charge
        if (p < 0.24) mag.position.y -= seg(p, 0.1, 0.24) * 0.12;
        else if (p < 0.42) {
          mag.visible = false;
          if (!this.droppedMag) this.spawnDroppedMag(rig);
        } else mag.position.y -= (1 - seg(p, 0.42, 0.6)) * 0.24;
        lTarget = p >= 0.24 && p < 0.42 ? 'pouch' : 'mag';
        lBlend = seg(p, 0.02, 0.12) * (1 - seg(p, 0.7, 0.84));
        // palm slap to seat the magazine: the whole gun jolts
        off.y += bump(p, 0.6, 0.68) * 0.008;
        roll += bump(p, 0.6, 0.68) * 0.05;
        if (rig.parts.bolt && p > 0.64) this.boltPose(rig, seg(p, 0.64, 0.9));
        magFrac = p < 0.36 ? magFrac : 1;
        if (rig.id === 'sniper' && p > 0.62) {
          // the right hand works the bolt to chamber
          rHand = 'bolt';
          rBlend = seg(p, 0.62, 0.68) * (1 - seg(p, 0.88, 0.95));
          lTarget = 'mag';
          lBlend = seg(p, 0.02, 0.12) * (1 - seg(p, 0.62, 0.72));
        }
      }
      // seat "slap" right at the insert point
      off.y += bump(p, 0.58, 0.64) * 0.006;
    } else if (rig.id === 'pistol' && rig.parts.slide) {
      // slide blowback per shot, locked back on an empty magazine
      const t = s.sinceShot;
      const back = t < 0.015 ? t / 0.015 : Math.max(0, 1 - (t - 0.015) / 0.05);
      rig.parts.slide.position.z = s.magEmpty ? 0.028 : 0.028 * back;
    }
    if (rig.id === 'pistol' && rig.parts.slide && reload >= 0) {
      rig.parts.slide.position.z = s.magEmpty && reload < 0.66 ? 0.028 : 0;
    }
    if (rig.parts.magLevel) rig.parts.magLevel.scale.y = Math.max(0.001, magFrac);

    // bolt cycle after a sniper shot
    if (s.boltProgress >= 0 && rig.parts.bolt) {
      const q = s.boltProgress;
      this.boltPose(rig, q);
      rHand = 'bolt';
      rBlend = seg(q, 0, 0.14) * (1 - seg(q, 0.86, 1));
      // present the bolt: lift, pull in, roll the right side toward the camera
      const pres = seg(q, 0, 0.16) * (1 - seg(q, 0.84, 1));
      roll += 0.32 * pres;
      pitch += 0.1 * pres;
      yaw += 0.08 * pres;
      off.x -= 0.03 * pres;
      off.y += 0.035 * pres;
      off.z -= 0.07 * pres;
    }

    // ---- melee ----
    if (rig.id === 'melee') {
      if (s.meleeT < 0.5) {
        if (s.meleeHeavy) {
          const wind = Math.min(s.meleeT / 0.3, 1);
          const stab = s.meleeT > 0.3 ? Math.sin(Math.min((s.meleeT - 0.3) / 0.18, 1) * Math.PI) : 0;
          off.z += wind * 0.08 * (1 - stab) - stab * 0.26;
          off.y += wind * 0.04;
          pitch += wind * 0.5 - stab * 0.8;
        } else {
          const t = Math.min(s.meleeT / 0.28, 1);
          const a = Math.sin(t * Math.PI);
          const side = s.meleeSide;
          off.x += (0.5 - t) * 0.3 * side * a - 0.05 * a;
          off.z -= a * 0.14;
          yaw += side * (t - 0.5) * 1.3 * a;
          roll += side * 0.8 * a;
          pitch -= a * 0.25;
        }
      }
    }

    // ---- compose root ----
    rig.root.position.copy(pos).add(off);
    tmpE.set(pitch, yaw, roll, 'YXZ');
    rig.root.quaternion.copy(quat).multiply(tmpQ2.setFromEuler(tmpE));
    rig.root.updateMatrixWorld(true);

    // ---- hands locked to sockets ----
    const gripR = poseOf(rig.sockets.gripR, this.pA);
    let rp = gripR;
    if (rHand === 'bolt' && rig.sockets.boltGrab && rBlend > 0) {
      const b = poseOf(rig.sockets.boltGrab, this.pB);
      // palm sits beside the knob
      b.p.add(tmpV.set(0.012, -0.01, 0.012).applyQuaternion(b.q));
      rp = blendPose(gripR, b, rBlend, this.pC);
    }
    this.handR.group.position.copy(rp.p);
    this.handR.group.quaternion.copy(rp.q);

    const gripL = poseOf(rig.sockets.gripL, this.pA);
    let lp = gripL;
    if (lBlend > 0) {
      let target: Pose;
      if (lTarget === 'mag' && rig.sockets.magGrab) target = poseOf(rig.sockets.magGrab, this.pB);
      else {
        // below the screen: fetching a fresh magazine
        target = this.pB;
        target.p.set(-0.05, -0.42, -0.22);
        target.q.copy(gripL.q);
      }
      lp = blendPose(gripL, target, lBlend, this.pC);
    }
    this.handL.group.position.copy(lp.p);
    this.handL.group.quaternion.copy(lp.q);
    if (rig.id === 'melee') {
      this.handL.group.position.set(-0.3 + this.swayYaw * 0.1, -0.36 + by, -0.42);
      this.handL.group.quaternion.setFromEuler(tmpE.set(0.3, 0.2, 0.2));
    }

    // ---- sleeves from wrists toward off-screen elbows ----
    this.attachSleeve(this.sleeveR, this.handR, tmpV.set(0.24, -0.46, 0.18));
    this.attachSleeve(this.sleeveL, this.handL, tmpV.set(-0.26, -0.5, 0.08));

    // ---- dropped magazine falls away ----
    if (this.droppedMag) {
      this.droppedMag.t += dt;
      const t = this.droppedMag.t;
      const o = this.droppedMag.obj;
      o.position.y -= (0.4 + 6 * t) * dt;
      o.position.x -= 0.1 * dt;
      o.rotation.x += 3 * dt;
      if (t > 0.6) {
        o.visible = false;
        this.droppedMag = null;
      }
    }
    if (reload < 0) this.droppedMag = null;

    // ---- muzzle flash + ink puffs ----
    rig.sockets.muzzle.getWorldPosition(this.muzzleVM);
    if (this.flashT > 0) {
      // shown at full strength on the frame of the shot, then gone within ~1-2 frames
      this.flash.position.copy(this.muzzleVM);
      this.flashCore.position.copy(this.muzzleVM);
      const a = Math.max(0, this.flashT / this.flashLife);
      this.flash.material.opacity = a;
      this.flashCore.material.opacity = Math.min(1, a * 1.3);
      this.flash.visible = this.flashCore.visible = rig.id !== 'melee' && visible;
      this.flashT -= dt;
    } else this.flash.visible = this.flashCore.visible = false;
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.t += dt;
      const u = p.t / p.life;
      if (u >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.addScaledVector(p.v, dt);
      const sc = (p.s.userData.base as number) * (0.6 + u * 1.6);
      p.s.scale.set(sc, sc, 1);
      p.s.material.opacity = 0.35 * (1 - u) * (1 - 0.7 * e);
    }

    this.camera.fov = rig.vmFov.hip + (rig.vmFov.ads - rig.vmFov.hip) * e;
    this.camera.updateProjectionMatrix();

    // eyepiece rim on screen (the scope overlay grows out of it)
    this.eyepiece = null;
    if (rig.id === 'sniper') {
      const c = rig.sockets.rearSight.getWorldPosition(tmpV).project(this.camera);
      const rimW = tmpV2.set(0.0172, 0, 0).applyQuaternion(rig.root.quaternion).add(rig.sockets.rearSight.getWorldPosition(new THREE.Vector3())).project(this.camera);
      const W = window.innerWidth, H = window.innerHeight;
      const x = (c.x * 0.5 + 0.5) * W, y = (-c.y * 0.5 + 0.5) * H;
      const rx = (rimW.x * 0.5 + 0.5) * W, ry = (-rimW.y * 0.5 + 0.5) * H;
      this.eyepiece = { x, y, r: Math.hypot(rx - x, ry - y) };
    }
  }

  private boltPose(rig: WeaponRig, q: number) {
    const bolt = rig.parts.bolt!;
    const lift = seg(q, 0.14, 0.28) * (1 - seg(q, 0.7, 0.82));
    const pull = seg(q, 0.3, 0.48) * (1 - seg(q, 0.52, 0.68));
    bolt.rotation.z = 1.05 * lift;
    bolt.position.z = 0.06 + 0.075 * pull;
  }

  private attachSleeve(sleeve: THREE.Group, hand: HandRig, elbow: THREE.Vector3) {
    hand.group.updateMatrixWorld(true);
    const w = hand.wrist.getWorldPosition(tmpV2);
    sleeve.position.copy(w);
    const dir = elbow.clone().sub(w).normalize();
    sleeve.quaternion.setFromUnitVectors(UP, dir);
  }

  private spawnDroppedMag(rig: WeaponRig) {
    const c = this.magDropClones.get(rig.id);
    if (!c || !rig.parts.mag) return;
    rig.parts.mag.updateWorldMatrix(true, false);
    rig.parts.mag.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    c.visible = true;
    this.droppedMag = { obj: c, t: 0 };
  }
}
