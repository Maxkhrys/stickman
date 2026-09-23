import * as THREE from 'three';
import { MOVE } from '../config/movement';
import { WEAPONS } from '../config/weapons';
import type { Fighter } from '../sim/fighter';
import type { MapDef } from '../sim/map';
import type { World } from '../sim/world';
import { Effects } from './Effects';
import { buildMapMesh } from './mapMesh';
import { Stickman, type StickmanState } from './Stickman';
import { makeBlobTexture } from './textures';
import { Viewmodel } from './Viewmodel';

class Spring {
  x = 0;
  v = 0;
  constructor(private k: number, private c: number) {}
  step(dt: number) {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
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
  time: number;
  hfov: number;
  spectateId: number;
  /** menu backdrop: slow orbit over the arena, no viewmodel */
  orbit?: boolean;
  /** death cam target (killer position) */
  deathLook?: { x: number; y: number; z: number } | null;
}

const tmp = new THREE.Vector3();

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly effects = new Effects();
  readonly viewmodel = new Viewmodel();
  private mapGroup: THREE.Group | null = null;
  private stickmen = new Map<number, Stickman>();
  private world: World | null = null;
  private blobTex = makeBlobTexture();

  // camera rig state
  private eyeH: number = MOVE.standHeight - MOVE.eyeFromTop;
  private bobPhase = 0;
  private bobAmt = 0;
  private dip = new Spring(140, 16);
  private punchP = new Spring(300, 24);
  private punchY = new Spring(300, 24);
  private shake = 0;
  private roll = 0;
  private fovKick = 0;
  private lastTime = performance.now();
  lastMeleeSide = 1;
  bobScale = 1;
  fovKickOn = true;
  private hitStopT = 0;
  private rings: THREE.Object3D[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x9a917f, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.4, 1, 0.25);
    this.scene.add(sun);
    this.scene.add(this.effects.group);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel.setAspect(w / h);
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
    for (const s of this.stickmen.values()) {
      this.scene.remove(s.group);
      s.dispose();
    }
    this.stickmen.clear();
    this.effects.clear();
    this.world = world;
    this.mapGroup = buildMapMesh(map);
    this.scene.add(this.mapGroup);
    this.rings = this.mapGroup.children.filter((o) => o.name === 'ring');
    this.scene.background = new THREE.Color(map.skyColor);
    this.scene.fog = new THREE.Fog(map.fogColor, 60, 190);
  }

  stickman(f: Fighter): Stickman {
    let s = this.stickmen.get(f.id);
    if (!s) {
      s = new Stickman(f.color, this.blobTex);
      this.stickmen.set(f.id, s);
      this.scene.add(s.group);
    }
    return s;
  }

  // ---- feedback hooks ----
  punch(amount: number) {
    this.punchP.v += amount * 60;
    this.punchY.v += (Math.random() - 0.5) * amount * 25;
  }
  land(speed: number) {
    if (speed < 3) return;
    this.dip.v -= Math.min(speed, 22) * 0.07;
    this.viewmodel.land(speed);
  }
  /** Presentation-only hit-stop: world animation (ragdolls, particles) slows briefly. Sim + mouse keep running. */
  hitStop(seconds: number) {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }
  stickmanOf(id: number): Stickman | undefined {
    return this.stickmen.get(id);
  }
  hurt(amount: number) {
    this.shake = Math.min(1, this.shake + amount / 60);
  }

  /** Project a world position to screen pixels (null if behind camera). */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    tmp.copy(p).project(this.camera);
    if (tmp.z > 1) return null;
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Muzzle position in world space (for local tracers). */
  localMuzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    // viewmodel uses its own FOV, so match the muzzle's *screen* position rather than its 3D offset
    this.viewmodel.muzzleOffset(out);
    out.project(this.viewmodel.camera);
    out.z = 0.5;
    out.unproject(this.camera);
    const cp = this.camera.position;
    out.sub(cp).normalize().multiplyScalar(0.9).add(cp);
    return out;
  }

  render(fi: FrameInput) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const a = fi.alpha;
    const world = this.world!;
    const worldDt = this.hitStopT > 0 ? dt * 0.12 : dt;
    this.hitStopT -= dt;
    for (const r of this.rings) r.rotation.y += dt * (r.userData.spin as number);

    // ---- characters ----
    for (const f of fi.fighters) {
      const sm = this.stickman(f);
      const isViewer = f.id === fi.spectateId && f.alive;
      sm.group.visible = !isViewer || !f.alive;
      if (isViewer && f.alive) continue;
      const def = WEAPONS[f.weapons[f.cur].id];
      const st: StickmanState = {
        x: f.prevPos.x + (f.pos.x - f.prevPos.x) * a,
        y: f.prevPos.y + (f.pos.y - f.prevPos.y) * a,
        z: f.prevPos.z + (f.pos.z - f.prevPos.z) * a,
        vx: f.vel.x,
        vy: f.vel.y,
        vz: f.vel.z,
        yaw: f.prevYaw + angleLerp(f.prevYaw, f.yaw) * a,
        pitch: f.prevPitch + (f.pitch - f.prevPitch) * a,
        height: f.prevHeight + (f.height - f.prevHeight) * a,
        onGround: f.onGround,
        sliding: f.sliding,
        alive: f.alive,
        weapon: def.id,
        reloading: f.reloadTimer > 0,
        meleeT: fi.time - f.lastMeleeTime,
        meleeHeavy: f.lastMeleeHeavy,
        firedT: fi.time - f.lastShotTime,
      };
      sm.update(st, worldDt, world);
    }

    // ---- camera rig ----
    const me = fi.orbit ? undefined : fi.fighters.find((f) => f.id === fi.spectateId);
    if (fi.orbit) {
      const t = fi.time * 0.05;
      this.camera.position.set(Math.cos(t) * 38, 17, Math.sin(t) * 26);
      this.camera.lookAt(0, 1.5, 0);
      const vfov = 2 * Math.atan(Math.tan((85 * Math.PI) / 360) / this.camera.aspect);
      this.camera.fov = (vfov * 180) / Math.PI;
      this.camera.updateProjectionMatrix();
    }
    if (me) {
      const px = me.prevPos.x + (me.pos.x - me.prevPos.x) * a;
      const py = me.prevPos.y + (me.pos.y - me.prevPos.y) * a;
      const pz = me.prevPos.z + (me.pos.z - me.prevPos.z) * a;
      const targetEye = me.height - MOVE.eyeFromTop;
      // smooth crouch (sim height snaps, camera eases); in-air crouch keeps the head in place
      this.eyeH += (targetEye - this.eyeH) * (1 - Math.exp(-18 * dt));
      const hs = Math.hypot(me.vel.x, me.vel.z);
      const moveT = me.onGround && !me.sliding ? Math.min(hs / MOVE.maxSpeed, 1.2) : 0;
      this.bobAmt += (moveT - this.bobAmt) * (1 - Math.exp(-10 * dt));
      this.bobPhase += dt * hs * 1.75;
      this.dip.step(dt);
      this.punchP.step(dt);
      this.punchY.step(dt);
      this.shake = Math.max(0, this.shake - dt * 3);
      const adsK = (1 - me.ads * 0.8) * this.bobScale;
      const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmt * adsK - 0.02 * this.bobAmt;
      const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmt * adsK;

      let camY = py + (me.alive ? this.eyeH : 0.4) + bobY + this.dip.x * 0.35 * (0.3 + 0.7 * this.bobScale);
      if (!me.alive) camY = py + 0.5 + Math.min(1.5, (fi.time - me.deathTime) * 1.2);

      // local strafe for roll
      const sy = Math.sin(fi.viewYaw), cy = Math.cos(fi.viewYaw);
      const lvx = me.vel.x * cy - me.vel.z * sy;
      const targetRoll = ((me.sliding ? 0.07 : 0) + (-lvx / MOVE.maxSpeed) * 0.012) * (0.3 + 0.7 * this.bobScale);
      this.roll += (targetRoll - this.roll) * (1 - Math.exp(-8 * dt));

      const rp = me.prevRecoilPitch + (me.recoilPitch - me.prevRecoilPitch) * a;
      const ry = me.prevRecoilYaw + (me.recoilYaw - me.prevRecoilYaw) * a;
      const sh = this.shake * this.shake;
      const shakeP = (Math.random() - 0.5) * sh * 0.03;
      const shakeY = (Math.random() - 0.5) * sh * 0.03;

      this.camera.position.set(px + bobX * cy, camY, pz - bobX * sy);
      if (me.alive) {
        this.camera.rotation.set(
          fi.viewPitch + rp + this.punchP.x * 0.01 + shakeP,
          fi.viewYaw + ry + this.punchY.x * 0.01 + shakeY,
          this.roll + Math.sin(this.bobPhase) * 0.003 * this.bobAmt,
        );
      } else if (fi.deathLook) {
        // death cam: rise out of the body and stare at whoever erased you
        const q = this.camera.quaternion.clone();
        this.camera.lookAt(fi.deathLook.x, fi.deathLook.y + 1.2, fi.deathLook.z);
        q.slerp(this.camera.quaternion, 1 - Math.exp(-5 * dt));
        this.camera.quaternion.copy(q);
      } else {
        this.camera.rotation.set(-0.5, fi.viewYaw, 0.2);
      }

      // FOV: kick when fast (bhop / sprint) and sliding; zoom when ADS
      const speedKick = Math.max(0, Math.min(1, (hs - MOVE.maxSpeed * 0.9) / 6));
      const targetKick = this.fovKickOn ? speedKick * 8 + (me.sliding ? 6 : 0) : 0;
      this.fovKick += (targetKick - this.fovKick) * (1 - Math.exp(-6 * dt));
      const def = WEAPONS[me.weapons[me.cur].id];
      const zoom = 1 + (def.adsFovMult - 1) * me.ads;
      const hfov = ((fi.hfov + this.fovKick) * zoom * Math.PI) / 180;
      const vfov = 2 * Math.atan(Math.tan(hfov / 2) / this.camera.aspect);
      this.camera.fov = (vfov * 180) / Math.PI;
      this.camera.updateProjectionMatrix();

      // viewmodel
      const reloadP = me.reloadTimer > 0 ? 1 - me.reloadTimer / def.reloadTime : -1;
      this.viewmodel.update(dt, {
        weapon: def.id,
        ads: me.ads,
        reloadProgress: reloadP,
        drawProgress: def.drawTime > 0 ? me.switchTimer / def.drawTime : 0,
        speed: hs,
        grounded: me.onGround,
        sliding: me.sliding,
        crouching: me.crouching,
        mouseDX: fi.mouseDX,
        mouseDY: fi.mouseDY,
        meleeT: fi.time - me.lastMeleeTime,
        meleeHeavy: me.lastMeleeHeavy,
        meleeSide: this.lastMeleeSide,
        alive: me.alive,
      });
    }

    this.effects.update(worldDt);
    this.camera.updateMatrixWorld();

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (me) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }
}

function angleLerp(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
