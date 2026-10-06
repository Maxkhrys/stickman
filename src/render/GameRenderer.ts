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
import { ADS_CAMERA_FORWARD, adsBlend } from '../config/weaponModels';
import { RobotRenderer, robotAssets } from './robot/RobotRenderer';

/** Shoulder camera tuning (metres, in the aim frame). See docs/SNIPER_UPGRADE.md. */
export const CAM = { right: 0.62, up: 0.2, back: 2.35 };

const camTmp = new THREE.Vector3();
const camTmp2 = new THREE.Vector3();
const camTmp3 = new THREE.Vector3();
const camTmp4 = new THREE.Vector3();

/** What App and the HUD need from whichever character renderer is active. */
export interface CharacterView {
  readonly group: THREE.Group;
  reset(): void;
  wound(id: number, pos: { x: number; y: number; z: number }, yaw: number): void;
  hurt(id: number, dirX: number, dirZ: number, head?: boolean): void;
  kill(f: Fighter, dir: { x: number; y: number; z: number }, headshot: boolean): void;
  headOf(id: number): THREE.Vector3 | null;
}

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
  readonly stick: CharacterRenderer;
  robots: RobotRenderer | null = null;
  useRobot = false;
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
  /** camera lean into a dodge roll (rad, eased) */
  private rollTilt = 0;
  private fovKick = 0;
  /** camera-only smoothing of instant step-ups (stairs, ramp lips); the fighter's position is untouched */
  private stepOff = 0;
  private lastPy = NaN;
  private lastPx = 0;
  private lastPz = 0;
  private lastStepId = -1;
  lastMeleeSide = 1;
  /** third-person follow smoothing (settings): 0 = rigid, 1 = smooth, 2 = floaty */
  cameraSmoothing = 1;
  /** third-person pivot (the point the shoulder rig hangs from) and its filtered velocity */
  private pivot = new THREE.Vector3();
  private pivotVel = new THREE.Vector3();
  private pivotTarget = new THREE.Vector3();
  private pivotId = -1;
  private pivotInit = false;
  /** how fast the player is turning the view (rad/s, lightly filtered): drives the first-person gun sway */
  private lookYawRate = 0;
  private lookPitchRate = 0;
  private lastViewYaw = NaN;
  private lastViewPitch = 0;
  /** camera shake / bob / roll scale (settings) */
  motionScale = 1;
  fovKickOn = true;
  private hitStopT = 0;
  thirdPersonActive = false;
  /** camera rig state */
  private shoulderSide = 1;
  private camFrac = 1;
  private rigPrev = { id: -1, r: 0, u: 0, b: 0, frac: 1 };
  /** view correction this frame (App adds it to the input angles) */
  readonly aimFix = { yaw: 0, pitch: 0 };
  /** camera position relative to the sim eye (sent with each command as the aim origin) */
  readonly aimOffset = { x: 0, y: 0, z: 0 };
  renderYaw = 0;
  renderPitch = 0;
  private localBodyVisible = true;
  private hideHead = false;
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
    this.stick = new CharacterRenderer(this.effects);
    this.scene.add(this.stick.group, this.effects.group, this.hitboxes.group, this.objective.group);
    this.resize();
  }

  /** the active character renderer */
  get characters(): CharacterView {
    return this.useRobot && this.robots ? this.robots : this.stick;
  }

  /** Switch the playable character's presentation (robot needs its assets loaded). */
  setCharacter(kind: 'armored' | 'robot' | 'stickman') {
    const A = robotAssets();
    if (kind !== 'stickman' && A && !this.robots) {
      this.robots = new RobotRenderer(this.effects, A);
      this.scene.add(this.robots.group);
    }
    this.useRobot = kind !== 'stickman' && !!this.robots;
    if (this.robots && kind !== 'stickman') this.robots.playerChar = kind;
    this.stick.group.visible = !this.useRobot;
    if (this.robots) this.robots.group.visible = this.useRobot;
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
    this.stick.reset();
    this.robots?.reset();
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
  /** local dash / dodge roll started: FOV punch and a small camera dip (presentation only) */
  dashFx(air: boolean) {
    this.fovPunch.v += (air ? 0.8 : 1.4) * 40;
    if (!air) this.dip.v -= 1.2;
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

  /**
   * Predict-and-correct follow filter. The pivot advances with a slowed-down copy of the target's velocity (so a
   * steady run has no lag at all) and is pulled to the target with a short time constant (so a step, a dash start
   * or a landing is spread over a fraction of a second). The lag is capped, and the pivot never sits behind a wall.
   */
  private smoothPivot(id: number, x: number, y: number, z: number, dt: number, world: World) {
    const k = this.cameraSmoothing >= 2 ? 1.8 : 1;
    const off2 = (x - this.pivot.x) ** 2 + (y - this.pivot.y) ** 2 + (z - this.pivot.z) ** 2;
    if (!this.pivotInit || this.pivotId !== id || dt <= 0 || off2 > 25) {
      this.pivot.set(x, y, z);
      this.pivotVel.set(0, 0, 0);
      this.pivotTarget.set(x, y, z);
      this.pivotId = id;
      this.pivotInit = true;
      return;
    }
    const kv = 1 - Math.exp(-dt / (0.1 * k)), kp = 1 - Math.exp(-dt / (0.07 * k));
    const vx = (x - this.pivotTarget.x) / dt, vy = (y - this.pivotTarget.y) / dt, vz = (z - this.pivotTarget.z) / dt;
    this.pivotVel.x += (vx - this.pivotVel.x) * kv;
    this.pivotVel.y += (vy - this.pivotVel.y) * kv;
    this.pivotVel.z += (vz - this.pivotVel.z) * kv;
    this.pivot.addScaledVector(this.pivotVel, dt);
    this.pivot.x += (x - this.pivot.x) * kp;
    this.pivot.y += (y - this.pivot.y) * kp;
    this.pivot.z += (z - this.pivot.z) * kp;
    this.pivotTarget.set(x, y, z);
    // cap the lag, then keep the pivot on the near side of any wall between it and the real eye
    const lag = this.pivot.distanceTo(this.pivotTarget), cap = 0.5 * k;
    if (lag > cap) this.pivot.lerp(this.pivotTarget, 1 - cap / lag);
    const d = this.pivot.distanceTo(this.pivotTarget);
    if (d > 0.02) {
      const dir = camTmp.subVectors(this.pivot, this.pivotTarget).divideScalar(d);
      const hit = world.raycast({ x, y, z }, { x: dir.x, y: dir.y, z: dir.z }, d + 0.1);
      if (hit && hit.t < d + 0.05) this.pivot.set(x, y, z);
    }
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
      // smooth stride bob: a dip on each footfall with rounded ends (sin^2 has no cusps, |sin| had), plus a gentle
      // sway side to side
      const bobY = (Math.pow(Math.sin(this.bobPhase), 2) * 0.034 - 0.017) * this.bobAmt * calm;
      const bobX = Math.cos(this.bobPhase) * 0.013 * this.bobAmt * calm;
      // how fast the view is turning (for the first-person gun sway)
      if (Number.isNaN(this.lastViewYaw) || dt <= 0) { this.lastViewYaw = fi.viewYaw; this.lastViewPitch = fi.viewPitch; }
      let dyaw = fi.viewYaw - this.lastViewYaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const kLook = 1 - Math.exp(-dt / 0.045);
      this.lookYawRate += (Math.max(-12, Math.min(12, dt > 0 ? dyaw / dt : 0)) - this.lookYawRate) * kLook;
      this.lookPitchRate += (Math.max(-12, Math.min(12, dt > 0 ? (fi.viewPitch - this.lastViewPitch) / dt : 0)) - this.lookPitchRate) * kLook;
      this.lastViewYaw = fi.viewYaw;
      this.lastViewPitch = fi.viewPitch;

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
      // dodge roll: lean the first-person camera into the roll, easing in fast and out slowly
      const rollP = me.rollTimer > 0 ? 1 - me.rollTimer / MOVE.rollTime : -1;
      const rollEnv = rollP >= 0 ? Math.sin(Math.min(1, rollP) * Math.PI) : 0;
      const dashRight = me.dashDirX * cy - me.dashDirZ * sy;
      const rollTarget = -dashRight * 0.2 * rollEnv * ms * (1 - adsE);
      this.rollTilt += (rollTarget - this.rollTilt) * (1 - Math.exp(-(rollTarget === 0 ? 7 : 16) * dt));

      // gameplay recoil, shown immediately (latest sim state + analytic impulse decay):
      // the screen centre is exactly where the next shot goes.
      const kick = kickAt(me, renderTime);
      const ry = me.recoilYaw + kick.yaw;
      const rp = me.recoilPitch + kick.pitch;
      const sh = this.shake * this.shake * ms * (1 - this.zoom.scopeCover);
      const shakeRoll = (Math.random() - 0.5) * sh * 0.02;

      // ---- camera rig: shoulder camera that slides into the eye as ADS completes (3rd -> 1st person) ----
      const robot = this.useRobot;
      const tp = !!fi.thirdPerson && me.alive;
      const adsC = adsBlend(ads); // same curve the weapon frame uses, so sights meet the eye together
      const side = fi.shoulder ?? 1;
      this.shoulderSide += (side - this.shoulderSide) * (1 - Math.exp(-14 * dt));
      // local offset in the aim frame: right, up, back (metres)
      const hipR = tp ? CAM.right * this.shoulderSide : 0, hipU = tp ? CAM.up : 0, hipB = tp ? CAM.back : 0;
      const keep = robot || !def.scope ? 1 - adsC : Math.max(0, 1 - ads * 4); // stickman scopes cut straight to the viewmodel
      // robots end inside the sights: ADS_CAMERA_FORWARD ahead of the eye (negative 'back')
      let lr = hipR * keep, lu = hipU * keep, lb = hipB * keep - (robot ? ADS_CAMERA_FORWARD * adsC : 0);
      let viewYaw = fi.viewYaw, viewPitch = fi.viewPitch;
      let eyeX = px, eyeY = py + this.eyeH + (tp ? 0 : this.stepOff + bobY + this.dip.x * 0.35 * ms), eyeZ = pz;
      if (tp && me.alive && this.cameraSmoothing > 0) {
        // third person: the camera hangs from a damped pivot, so dashes, slides, landings and stair steps ease in
        // instead of jolting the whole frame
        this.smoothPivot(me.id, eyeX, eyeY, eyeZ, dt, world);
        eyeX = this.pivot.x; eyeY = this.pivot.y; eyeZ = this.pivot.z;
      } else this.pivotInit = false;
      const offsetAt = (yawA: number, pitchA: number, r: number, u: number, bk: number, frac: number, out: THREE.Vector3) => {
        const cpp = Math.cos(pitchA), spp = Math.sin(pitchA), syy = Math.sin(yawA), cyy = Math.cos(yawA);
        // forward f, right rt, up (pitched) u
        const fx = -syy * cpp, fy = spp, fz = -cyy * cpp;
        const ux = syy * spp, uy = cpp, uz = cyy * spp;
        return out.set((cyy * r + ux * u - fx * bk) * frac, (uy * u - fy * bk) * frac, (-syy * r + uz * u - fz * bk) * frac);
      };
      // collision: compress instantly, return smoothly
      const desired = offsetAt(viewYaw, viewPitch, lr, lu, lb, 1, camTmp);
      const pivot = { x: eyeX, y: eyeY, z: eyeZ };
      let frac = 1;
      if (desired.lengthSq() > 1e-6) {
        const safe = clipCamera(world, pivot, { x: eyeX + desired.x, y: eyeY + desired.y, z: eyeZ + desired.z });
        frac = Math.hypot(safe.x - eyeX, safe.y - eyeY, safe.z - eyeZ) / desired.length();
      }
      this.camFrac = frac < this.camFrac ? frac : this.camFrac + (frac - this.camFrac) * (1 - Math.exp(-5 * dt));
      // aim-point coherence: when the rig (not the mouse) moves the camera, turn the view so the point
      // under the reticle stays put; shots go along the camera ray, so what you aimed at is what you hit
      this.aimFix.yaw = 0;
      this.aimFix.pitch = 0;
      const prev = offsetAt(viewYaw, viewPitch, this.rigPrev.r, this.rigPrev.u, this.rigPrev.b, this.rigPrev.frac, camTmp2);
      const next = offsetAt(viewYaw, viewPitch, lr, lu, lb, this.camFrac, camTmp3);
      if (me.alive && this.rigPrev.id === me.id && prev.distanceToSquared(next) > 1e-8) {
        const kick0 = kickAt(me, renderTime);
        const dir = camTmp4.set(0, 0, -1).applyEuler(new THREE.Euler(viewPitch + me.recoilPitch + kick0.pitch, viewYaw + me.recoilYaw + kick0.yaw, 0, 'YXZ'));
        const o = { x: eyeX + prev.x, y: eyeY + prev.y, z: eyeZ + prev.z };
        const hit = world.raycast(o, { x: dir.x, y: dir.y, z: dir.z }, 400);
        const dist = hit ? hit.t : 400;
        if (dist > 1.5) {
          const tx = o.x + dir.x * dist - (eyeX + next.x), ty = o.y + dir.y * dist - (eyeY + next.y), tz = o.z + dir.z * dist - (eyeZ + next.z);
          const ny = Math.atan2(-tx, -tz), np = Math.atan2(ty, Math.hypot(tx, tz));
          let dy = ny - Math.atan2(-dir.x, -dir.z);
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const dp = np - Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
          if (Math.abs(dy) < 0.2 && Math.abs(dp) < 0.2) {
            this.aimFix.yaw = dy;
            this.aimFix.pitch = dp;
            viewYaw += dy;
            viewPitch += dp;
          }
        }
      }
      this.rigPrev = { id: me.id, r: lr, u: lu, b: lb, frac: this.camFrac };
      const off = offsetAt(viewYaw, viewPitch, lr, lu, lb, this.camFrac, camTmp);
      this.camera.position.set(eyeX + off.x, eyeY + off.y, eyeZ + off.z);
      if (!tp && me.alive) this.camera.position.x += bobX * cy, this.camera.position.z -= bobX * sy;
      // aim origin for the sim (camera relative to the eye the sim uses this tick)
      const simEye = me.pos.y + me.height - MOVE.eyeFromTop;
      this.aimOffset.x = this.camera.position.x - me.pos.x;
      this.aimOffset.y = this.camera.position.y - simEye;
      this.aimOffset.z = this.camera.position.z - me.pos.z;
      if (!me.alive) this.aimOffset.x = this.aimOffset.y = this.aimOffset.z = 0;
      this.renderYaw = viewYaw;
      this.renderPitch = viewPitch;
      if (me.alive) {
        this.camera.rotation.set(viewPitch + rp, viewYaw + ry, (tp ? 0 : this.roll + this.rollTilt) + shakeRoll + (tp ? 0 : Math.sin(this.bobPhase) * 0.002 * this.bobAmt * calm));
      } else {
        this.camera.position.set(px, camY, pz);
        if (fi.deathLook) {
          const q = this.camera.quaternion.clone();
          this.camera.lookAt(fi.deathLook.x, fi.deathLook.y + 1.2, fi.deathLook.z);
          q.slerp(this.camera.quaternion, 1 - Math.exp(-5 * dt));
          this.camera.quaternion.copy(q);
        } else this.camera.rotation.set(-0.5, fi.viewYaw, 0.2);
      }
      const camDist = off.length();
      // the local body is drawn whenever the camera is outside the head; the robot keeps its arms and
      // weapon in view all the way into first person, the stickman hands over to its viewmodel
      this.thirdPersonActive = me.alive && camDist > 0.3;
      this.localBodyVisible = robot ? true : camDist > 0.45 || !me.alive;
      // the robot rigs' heads (hair, helmet) reach well past 0.45 m from the eye: clear them early in ADS
      this.hideHead = robot && me.alive && camDist < 0.9;

      // ---- FOV: speed kick at hip, iron-sight zoom, scope zoom synced with the overlay ----
      const speedKick = Math.max(0, Math.min(1, (hs - MOVE.maxSpeed * 0.9) / 6));
      const targetKick = this.fovKickOn ? (speedKick * 7 + (me.sliding ? 5 : 0) + (me.rollTimer > 0 ? 4 : 0)) * (1 - adsE) : 0;
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

      // ---- viewmodel (stickman first person only; the robot's own arms and weapon are the viewmodel) ----
      if (this.useRobot) this.zoom.eyepiece = null;
      else {
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
    }
    this.camera.updateMatrixWorld();
    this.objective.update(fi.objective, fi.localId);

    // ---------------- world ----------------
    if (this.useRobot && this.robots) {
      this.robots.update(worldDt, fi.fighters, a, renderTime, world, this.camera, {
        hideHeadOf: this.hideHead && !fi.orbit ? fi.spectateId : -1,
        hideGunOf: this.zoom.scopeCover > 0.02 && !fi.orbit ? fi.spectateId : -1,
        localId: fi.orbit ? -1 : fi.spectateId,
        viewYaw: this.renderYaw,
        viewPitch: this.renderPitch,
        lookYawRate: this.lookYawRate,
        lookPitchRate: this.lookPitchRate,
      });
    } else this.stick.update(worldDt, fi.fighters, a, renderTime, fi.orbit || this.localBodyVisible ? -1 : fi.spectateId, world, this.camera);
    this.hitboxes.update(fi.fighters, fi.spectateId);
    this.effects.camPos.copy(this.camera.position);
    this.effects.setWorld(world);
    this.effects.update(worldDt);

    // live scope image inside the eyepiece while it rises to the eye: its field of view matches what the
    // full-screen scope shows inside a circle of the same on-screen size, so the hand-off is seamless
    const lens = this.viewmodel.scopeLens;
    const ep = this.zoom.eyepiece;
    const sniperUp = !this.useRobot && !this.localBodyVisible && !!me && me.alive && me.weapons[me.cur].id === 'sniper' && this.zoom.adsE > 0.02 && this.zoom.scopeCover < 0.999 && !!ep;
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
    if (me && !this.useRobot && !this.localBodyVisible && this.zoom.scopeCover < 0.999) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }
}
