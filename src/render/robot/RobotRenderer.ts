import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOVE } from '../../config/movement';
import { MODEL_FOR, WEAPON_MODELS, type V3 } from '../../config/weaponModels';
import { WEAPONS } from '../../config/weapons';
import { buildSkeleton, createSkeleton, type Skeleton } from '../../sim/body';
import { eyePos, kickAt, type Fighter } from '../../sim/fighter';
import type { Vec3 } from '../../sim/vec';
import { weaponFrame, type WeaponFrame } from '../../sim/weaponFrame';
import type { World } from '../../sim/world';
import type { Effects } from '../Effects';
import { makeBlobTexture } from '../textures';
import { loadClipLibrary, PoseAccumulator, type Clip, type ClipLibrary } from './clips';

// ============================================================================
//  Robot characters. One skinned robot per fighter, animated in layers:
//    1. lower body: phase-locked directional locomotion (walk / run / sprint x
//       F / B / L / R), air clips (jump, tuck, reach, fall, land), crouch idle
//    2. upper body: rifle aiming idle, then a spine twist + pitch so the chest
//       follows the aim, head looks along the aim
//    3. arms: two-bone IK to the weapon's grip and support sockets, hand
//       orientation calibrated from the aiming clip so fingers wrap the gun
//    4. legs: two-bone IK keeps feet planted when the hips drop (crouch, slide)
//  The weapon mesh sits in the shared weapon frame (src/sim/weaponFrame.ts), so
//  the drawn muzzle is the muzzle the simulation traces shots from. Root motion
//  is baked out of every clip (tools/anim/bake-robot.mjs): only the sim moves
//  the character, the animation never does.
// ============================================================================

const ROBOT_SCALE = 1.8;
type ModelKey = keyof typeof WEAPON_MODELS;

/** Skinned playable characters (both Mixamo-named rigs, 1 unit tall, retargeted per rig). */
export type CharKey = 'armored' | 'robot';
export const CHARACTERS: Record<CharKey, { glb: string; anims: string; label: string }> = {
  armored: { glb: 'assets/armored/armored.glb', anims: 'assets/armored/anims.json', label: 'Armored' },
  robot: { glb: 'assets/robot/robot.glb', anims: 'assets/robot/anims.json', label: 'Robot' },
};

export interface CharAsset {
  scene: THREE.Object3D;
  lib: ClipLibrary;
  /** hand rotation relative to the weapon frame, measured from the aiming clip */
  gripRel: { right: THREE.Quaternion; left: THREE.Quaternion };
}

export interface RobotAssets {
  chars: Record<CharKey, CharAsset>;
  weapons: Record<ModelKey, THREE.Object3D>;
}

let assets: RobotAssets | null = null;
export const robotAssets = () => assets;

/** Load the robot, its baked clips and the weapon models (call once before the robot renderer is used). */
export async function loadRobotAssets(base = '/'): Promise<RobotAssets> {
  if (assets) return assets;
  const loader = new GLTFLoader();
  const keys = Object.keys(CHARACTERS) as CharKey[];
  const [charLoads, guns] = await Promise.all([
    Promise.all(keys.map((k) => Promise.all([loader.loadAsync(base + CHARACTERS[k].glb), loadClipLibrary(base + CHARACTERS[k].anims)]))),
    Promise.all((Object.keys(WEAPON_MODELS) as ModelKey[]).map((k) => loader.loadAsync(base + WEAPON_MODELS[k].url!))),
  ]);
  const weapons = {} as Record<ModelKey, THREE.Object3D>;
  (Object.keys(WEAPON_MODELS) as ModelKey[]).forEach((k, i) => {
    const s = guns[i].scene;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.isMeshStandardMaterial) { mat.metalness = Math.min(mat.metalness, 0.4); mat.roughness = Math.max(mat.roughness, 0.45); }
      }
    });
    weapons[k] = s;
  });
  const chars = {} as Record<CharKey, CharAsset>;
  keys.forEach((k, i) => {
    const [gltf, lib] = charLoads[i];
    gltf.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.isMeshStandardMaterial) { mat.metalness = Math.min(mat.metalness, 0.35); mat.roughness = Math.max(mat.roughness, 0.5); }
      }
    });
    chars[k] = { scene: gltf.scene, lib, gripRel: calibrateGrip(gltf.scene, lib) };
  });
  assets = { chars, weapons };
  return assets;
}

function boneMap(root: THREE.Object3D): Record<string, THREE.Bone> {
  const out: Record<string, THREE.Bone> = {};
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out[o.name.replace(/^mixamorig:?/, '')] = o as THREE.Bone;
  });
  return out;
}

/**
 * Hand orientation relative to the gun, measured once from the rifle aiming clip: the gun's forward is
 * the trigger hand -> support hand line, its up is world up. At runtime hand = weaponFrame * rel, so the
 * clip's finger curls land wrapped around the real weapon whatever the aim direction.
 */
function calibrateGrip(robot: THREE.Object3D, lib: ClipLibrary) {
  const m = SkeletonUtils.clone(robot);
  m.scale.setScalar(ROBOT_SCALE);
  const bones = boneMap(m);
  const acc = new PoseAccumulator(lib.bones.length);
  const q = new THREE.Quaternion();
  lib.clips.idle.accumulate(0, 1, acc);
  lib.bones.forEach((b, j) => acc.read(j, bones[b].quaternion, q.copy(bones[b].quaternion)));
  m.updateMatrixWorld(true);
  const R = bones.RightHand.getWorldPosition(new THREE.Vector3());
  const L = bones.LeftHand.getWorldPosition(new THREE.Vector3());
  const f = L.clone().sub(R);
  f.y *= 0.35; // the support hand sits a little high on the handguard
  f.normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  const gun = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, u, r));
  const inv = gun.clone().invert();
  return {
    right: inv.clone().multiply(bones.RightHand.getWorldQuaternion(new THREE.Quaternion())),
    left: inv.clone().multiply(bones.LeftHand.getWorldQuaternion(new THREE.Quaternion())),
  };
}

// ---------------------------------------------------------------------------- scratch
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tm = new THREE.Matrix4();
const ts = new THREE.Vector3();
const v3of = (p: Vec3, out = new THREE.Vector3()) => out.set(p.x, p.y, p.z);

/** Set a bone's world rotation (its parent's world matrix must be current). */
function setWorldQuat(b: THREE.Object3D, q: THREE.Quaternion) {
  b.parent!.getWorldQuaternion(tq2);
  b.quaternion.copy(tq2.invert().multiply(q));
}
/** Pre-rotate a bone in world space by `r` (parent world matrix must be current). */
function rotateWorld(b: THREE.Object3D, r: THREE.Quaternion) {
  b.getWorldQuaternion(tq);
  setWorldQuat(b, tq.premultiply(r));
}

const ia = new THREE.Vector3(), ib = new THREE.Vector3(), ic = new THREE.Vector3(), it = new THREE.Vector3();
const ie = new THREE.Vector3(), bend = new THREE.Vector3(), nrm = new THREE.Vector3();
const sw = new THREE.Quaternion();

/**
 * Two-bone IK (upper, lower, end) by swing: place the middle joint in the plane of the pole direction,
 * then swing each bone onto its new segment. Twist from the animation is kept. `weight` blends the target.
 */
function twoBoneIK(A: THREE.Bone, B: THREE.Bone, C: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  if (weight <= 0) return;
  A.updateWorldMatrix(true, true);
  A.getWorldPosition(ia);
  B.getWorldPosition(ib);
  C.getWorldPosition(ic);
  it.copy(target);
  if (weight < 1) it.lerpVectors(ic, target, weight);
  const l1 = ib.distanceTo(ia), l2 = ic.distanceTo(ib);
  nrm.subVectors(it, ia);
  let d = nrm.length();
  if (d < 1e-5) return;
  nrm.divideScalar(d);
  d = Math.min(d, l1 + l2 - 1e-4);
  d = Math.max(d, Math.abs(l1 - l2) + 1e-4);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  bend.copy(pole).addScaledVector(nrm, -pole.dot(nrm));
  if (bend.lengthSq() < 1e-8) bend.subVectors(ib, ia).addScaledVector(nrm, -tv.subVectors(ib, ia).dot(nrm));
  bend.normalize();
  ie.copy(ia).addScaledVector(nrm, along).addScaledVector(bend, h);
  it.copy(ia).addScaledVector(nrm, d);
  // swing the upper bone so the middle joint lands on ie
  sw.setFromUnitVectors(tv.subVectors(ib, ia).normalize(), tv2.subVectors(ie, ia).normalize());
  A.getWorldQuaternion(tq);
  setWorldQuat(A, tq.premultiply(sw));
  A.updateWorldMatrix(false, true);
  // swing the lower bone so the end lands on the target
  B.getWorldPosition(ib);
  C.getWorldPosition(ic);
  sw.setFromUnitVectors(tv.subVectors(ic, ib).normalize(), tv2.subVectors(it, ib).normalize());
  B.getWorldQuaternion(tq);
  setWorldQuat(B, tq.premultiply(sw));
  B.updateWorldMatrix(false, true);
}

// ---------------------------------------------------------------------------- per-fighter state
interface RobotState {
  key: CharKey;
  ch: CharAsset;
  root: THREE.Group;
  model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  mat: THREE.MeshStandardMaterial;
  bones: THREE.Bone[];
  b: Record<string, THREE.Bone>;
  rest: THREE.Quaternion[];
  hipRest: THREE.Vector3;
  phase: number;
  facing: number;
  guns: Partial<Record<ModelKey, THREE.Object3D>>;
  gunKey: ModelKey | null;
  wasGround: boolean;
  landT: number;
  airT: number;
  hurtT: number;
  hurtX: number;
  hurtZ: number;
  dead: boolean;
  deadT: number;
  deathDir: THREE.Vector3;
  lastShot: number;
  sk: Skeleton;
  head: THREE.Vector3;
  visibleLast: boolean;
}

export interface RobotViewOptions {
  /** local fighter whose head is hidden (camera inside it), -1 for none */
  hideHeadOf: number;
  /** view yaw/pitch for the local fighter (immediate mouse), so its gun tracks the reticle exactly */
  localId: number;
  viewYaw: number;
  viewPitch: number;
}

const BLEND_SPEED = { walk: 1.6, run: 3.8, sprint: 5.6 };

export class RobotRenderer {
  readonly group = new THREE.Group();
  private chars = new Map<number, RobotState>();
  private acc!: PoseAccumulator;
  private upperMask!: Float32Array;
  private lowerMask!: Float32Array;
  private masks = new Map<CharKey, { acc: PoseAccumulator; upper: Float32Array; lower: Float32Array }>();
  /** what the local player plays as; everyone else wears the other skin so enemies read apart */
  playerChar: CharKey = 'armored';
  private shadows: THREE.InstancedMesh;
  private frustum = new THREE.Frustum();
  private camPos = new THREE.Vector3();
  private wf: WeaponFrame | null = null;
  /** counts for the perf overlay */
  drawn = 0;

  constructor(readonly effects: Effects, private A: RobotAssets, maxChars = 16) {
    for (const k of Object.keys(A.chars) as CharKey[]) {
      const bonesK = A.chars[k].lib.bones;
      const upper = new Float32Array(bonesK.length), lower = new Float32Array(bonesK.length);
      bonesK.forEach((name, j) => {
        const up = /Spine1|Spine2|Neck|Head|Shoulder|Arm|Hand/.test(name);
        const spine = name === 'Spine';
        upper[j] = up ? 1 : spine ? 0.5 : 0;
        lower[j] = up ? 0 : spine ? 0.5 : 1;
      });
      this.masks.set(k, { acc: new PoseAccumulator(bonesK.length), upper, lower });
    }
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      maxChars,
    );
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.group.add(this.shadows);
  }

  reset() {
    for (const c of this.chars.values()) {
      this.group.remove(c.root);
      for (const g of Object.values(c.guns)) if (g) this.group.remove(g);
    }
    this.chars.clear();
  }

  charFor(f: Fighter): CharKey {
    if (f.kind === 'player') return this.playerChar;
    return this.playerChar === 'armored' ? 'robot' : 'armored';
  }

  private stateOf(f: Fighter): RobotState {
    let c = this.chars.get(f.id);
    const key = this.charFor(f);
    if (c && c.key !== key) {
      // skin changed (settings): rebuild this fighter
      this.group.remove(c.root);
      for (const g of Object.values(c.guns)) if (g) this.group.remove(g);
      this.chars.delete(f.id);
      c = undefined;
    }
    if (c) return c;
    const ch = this.A.chars[key];
    const root = new THREE.Group();
    const model = SkeletonUtils.clone(ch.scene);
    model.scale.setScalar(ROBOT_SCALE);
    root.add(model);
    let mesh!: THREE.SkinnedMesh;
    model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
    // per-fighter material: tint toward the fighter colour + spawn-protection glow
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.color.set(0xffffff).lerp(new THREE.Color(f.color), f.kind === 'player' ? 0 : 0.22);
    mesh.material = mat;
    const b = boneMap(model);
    const bones = ch.lib.bones.map((n) => b[n]);
    c = {
      key, ch, root, model, mesh, mat, bones, b,
      rest: bones.map((x) => x.quaternion.clone()),
      hipRest: b.Hips.position.clone(),
      phase: 0, facing: f.yaw, guns: {}, gunKey: null,
      wasGround: true, landT: 9, airT: 0, hurtT: 0, hurtX: 0, hurtZ: 0,
      dead: false, deadT: 0, deathDir: new THREE.Vector3(), lastShot: -99,
      sk: createSkeleton(), head: new THREE.Vector3(), visibleLast: true,
    };
    this.chars.set(f.id, c);
    this.group.add(root);
    return c;
  }

  hurt(id: number, dirX: number, dirZ: number) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hurtT = 0.22;
    c.hurtX = dirX;
    c.hurtZ = dirZ;
  }

  kill(f: Fighter, dir: Vec3, _headshot: boolean) {
    const c = this.stateOf(f);
    if (c.dead) return;
    c.dead = true;
    c.deadT = 0;
    c.deathDir.set(dir.x, 0, dir.z);
    if (c.deathDir.lengthSq() < 1e-6) c.deathDir.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw)).negate();
    c.deathDir.normalize();
  }

  /** wounds are a stickman (sand) effect; robots spark on hit instead */
  wound(_id: number, _pos: Vec3, _yaw: number) {}

  headOf(id: number): THREE.Vector3 | null {
    const c = this.chars.get(id);
    return c ? c.head.clone() : null;
  }

  /** Rendered muzzle of a fighter's current weapon (world). */
  muzzleOf(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const c = this.chars.get(id);
    if (!c || !c.gunKey) return null;
    const g = c.guns[c.gunKey]!;
    const m = WEAPON_MODELS[c.gunKey].muzzle;
    return out.set(m[0], m[1], m[2]).applyMatrix4(g.matrixWorld);
  }

  update(dt: number, fighters: readonly Fighter[], alpha: number, time: number, world: World, camera: THREE.Camera, view: RobotViewOptions) {
    camera.getWorldPosition(this.camPos);
    camera.updateMatrixWorld();
    tm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(tm);
    let shadowN = 0;
    this.drawn = 0;
    for (const f of fighters) {
      const c = this.stateOf(f);
      if (f.alive && c.dead) {
        c.dead = false;
        c.root.visible = true;
      }
      if (!f.alive && !c.dead) this.kill(f, { x: 0, y: 0, z: 0 }, false);
      const px = f.prevPos.x + (f.pos.x - f.prevPos.x) * alpha;
      const py = f.prevPos.y + (f.pos.y - f.prevPos.y) * alpha;
      const pz = f.prevPos.z + (f.pos.z - f.prevPos.z) * alpha;
      // cull: off-screen robots skip animation entirely
      const sphere = new THREE.Sphere(tv.set(px, py + 1, pz), 1.6);
      const onScreen = this.frustum.intersectsSphere(sphere);
      if (c.dead) {
        c.deadT += dt;
        if (c.deadT > 1.4) {
          c.root.visible = false;
          continue;
        }
      }
      c.root.visible = onScreen;
      if (!onScreen) continue;
      this.drawn++;
      this.animate(f, c, dt, alpha, time, px, py, pz, world, view);
      if (!c.dead) {
        const floor = world.surfaceBelow(px, pz, 0.2, py + 0.1);
        const sc = Math.max(0.45, 1.05 - (py - floor) * 0.25);
        tm.compose(tv.set(px, floor + 0.015, pz), tq.identity(), ts.set(sc, 1, sc));
        this.shadows.setMatrixAt(shadowN++, tm);
      }
    }
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    for (const [id, c] of this.chars) if (!fighters.some((f) => f.id === id)) { this.group.remove(c.root); for (const g of Object.values(c.guns)) if (g) this.group.remove(g); this.chars.delete(id); }
  }

  private animate(f: Fighter, c: RobotState, dt: number, alpha: number, time: number, px: number, py: number, pz: number, world: World, view: RobotViewOptions) {
    const L = c.ch.lib.clips;
    const mk = this.masks.get(c.key)!;
    this.acc = mk.acc;
    this.upperMask = mk.upper;
    this.lowerMask = mk.lower;
    const local = f.id === view.localId;
    const yaw = local && f.alive ? view.viewYaw : f.prevYaw + angleDelta(f.prevYaw, f.yaw) * alpha;
    const pitch = local && f.alive ? view.viewPitch : f.prevPitch + (f.pitch - f.prevPitch) * alpha;
    const ads = f.prevAds + (f.ads - f.prevAds) * alpha;
    const height = f.prevHeight + (f.height - f.prevHeight) * alpha;
    const crouch = Math.max(0, Math.min(1, (MOVE.standHeight - height) / (MOVE.standHeight - MOVE.crouchHeight)));
    const weapon = f.weapons[f.cur].id;
    const def = WEAPONS[weapon];

    // ---- root: feet at the sim position, facing the aim (directional clips handle strafing) ----
    c.facing = yaw;
    c.root.position.set(px, py, pz);
    c.root.rotation.set(0, c.facing + Math.PI, 0);

    // ---- locomotion parameters (velocity in the facing frame) ----
    const sy = Math.sin(c.facing), cy = Math.cos(c.facing);
    const vF = -f.vel.x * sy - f.vel.z * cy;
    const vR = f.vel.x * cy - f.vel.z * sy;
    const speed = f.onGround && !f.sliding ? Math.hypot(vF, vR) : 0;
    const ang = Math.atan2(vR, vF);
    let wF = Math.max(0, Math.cos(ang)), wB = Math.max(0, -Math.cos(ang)), wR = Math.max(0, Math.sin(ang)), wLt = Math.max(0, -Math.sin(ang));
    const sum = wF + wB + wR + wLt || 1;
    wF /= sum; wB /= sum; wR /= sum; wLt /= sum;
    const moveW = Math.min(1, speed / 0.6);
    const runT = clamp01((speed - BLEND_SPEED.walk) / (BLEND_SPEED.run - BLEND_SPEED.walk));
    const sprintT = clamp01((speed - BLEND_SPEED.run) / (BLEND_SPEED.sprint - BLEND_SPEED.run)) * wF;

    // weighted clip set (walk/run per direction, sprint replaces part of runF)
    const set: [Clip, number][] = [];
    const add = (clip: Clip, w: number) => { if (w > 1e-3) set.push([clip, w]); };
    add(L.walkF, wF * (1 - runT)); add(L.walkB, wB * (1 - runT)); add(L.walkL, wLt * (1 - runT)); add(L.walkR, wR * (1 - runT));
    add(L.runF, wF * runT * (1 - sprintT / Math.max(wF, 1e-3))); add(L.runB, wB * runT); add(L.runL, wLt * runT); add(L.runR, wR * runT);
    add(L.sprint, sprintT * runT);
    // phase: advance by distance over the blended cycle length so feet stay planted
    let cycle = 0, wsum = 0;
    for (const [clip, w] of set) { cycle += w * clip.stride * ROBOT_SCALE * clip.duration; wsum += w; }
    if (wsum > 0 && cycle > 1e-3) c.phase = (c.phase + (speed * dt) / (cycle / wsum)) % 1;

    // air / landing
    if (!f.onGround) c.airT += dt; else c.airT = 0;
    if (f.onGround && !c.wasGround) c.landT = 0;
    c.wasGround = f.onGround;
    c.landT += dt;
    c.hurtT = Math.max(0, c.hurtT - dt);

    const acc = this.acc;
    acc.reset();
    const lowerW = 1;
    if (!f.onGround && !f.sliding) {
      // rising: jump takeoff -> tuck; apex: reach; falling: fall loop
      const vy = f.vel.y;
      const rise = clamp01(vy / 4), fall = clamp01(-vy / 4);
      const takeoff = clamp01(1 - c.airT / 0.18);
      L.jump.accumulate(1 - takeoff, takeoff * rise, acc, this.lowerMask);
      L.tuck.accumulate(clamp01(c.airT / 0.3), (1 - takeoff) * rise, acc, this.lowerMask);
      L.reach.accumulate(0.5, (1 - rise) * (1 - fall), acc, this.lowerMask);
      L.fall.accumulate((c.airT * 0.8) % 1, fall, acc, this.lowerMask);
    } else {
      const idleW = (1 - moveW) * lowerW;
      L.idle.accumulate((time * 0.33) % 1, idleW * (1 - crouch), acc, this.lowerMask);
      L.crouchIdle.accumulate((time * 0.4) % 1, idleW * crouch, acc, this.lowerMask);
      for (const [clip, w] of set) clip.accumulate(c.phase + clip.sync, (w / (wsum || 1)) * moveW * lowerW, acc, this.lowerMask);
      if (c.landT < 0.22) L.land.accumulate(c.landT / 0.22, 0.6 * (1 - c.landT / 0.22), acc, this.lowerMask);
    }
    // upper body: rifle aiming idle (the IK pass puts the hands on the actual weapon)
    L.idle.accumulate((time * 0.33) % 1, 1, acc, this.upperMask);
    // reload body motion (arms are re-targeted below, but the torso dips with the clip)
    const reloading = f.reloadTimer > 0 && def.reloadTime > 0;
    const reloadP = reloading ? 1 - f.reloadTimer / def.reloadTime : -1;

    const bones = c.bones;
    for (let j = 0; j < bones.length; j++) acc.read(j, bones[j].quaternion, c.rest[j]);
    const hipW = acc.hipW > 0 ? 1 / acc.hipW : 0;
    c.b.Hips.position.set(c.hipRest.x + acc.hip[0] * hipW, c.hipRest.y + acc.hip[1] * hipW, c.hipRest.z + acc.hip[2] * hipW);

    // ---- hips height: crouch / slide drop (legs re-solved with IK below) ----
    buildSkeleton({ pos: { x: px, y: py, z: pz }, vel: f.vel, yaw, pitch, lowerYaw: c.facing, height, gait: f.gait, onGround: f.onGround, sliding: f.sliding, ads }, weapon, c.sk);
    const crouchMove = crouch * moveW;
    let hipDrop = (crouchMove * 0.3 + crouch * (1 - moveW) * 0.04) / ROBOT_SCALE;
    if (f.sliding) hipDrop = 0.48 / ROBOT_SCALE;
    c.b.Hips.position.y -= hipDrop;
    // landing squash
    if (c.landT < 0.25 && f.onGround) c.b.Hips.position.y -= Math.sin((c.landT / 0.25) * Math.PI) * Math.min(0.08, f.lastLandSpeed * 0.008) / ROBOT_SCALE;

    c.root.updateMatrixWorld(true);

    // ---- legs: keep the clip's feet on the ground after the hips moved ----
    if (f.onGround && (hipDrop > 1e-4 || f.sliding)) {
      for (const side of ['Left', 'Right'] as const) {
        const up = c.b[`${side}UpLeg`], lo = c.b[`${side}Leg`], foot = c.b[`${side}Foot`];
        const target = foot.getWorldPosition(new THREE.Vector3());
        if (f.sliding) v3of(side === 'Left' ? c.sk.lAnkle : c.sk.rAnkle, target);
        target.y = Math.max(target.y, py + 0.08);
        const pole = tv.set(-Math.sin(c.facing), 0.15, -Math.cos(c.facing));
        twoBoneIK(up, lo, foot, target, pole.clone());
      }
    }

    // ---- spine: follow the aim pitch, lean into slides, flinch on hits ----
    const spineBones = [c.b.Spine, c.b.Spine1, c.b.Spine2];
    const right = tv.set(Math.cos(c.facing), 0, -Math.sin(c.facing)).clone();
    const fwd = new THREE.Vector3(-Math.sin(c.facing), 0, -Math.cos(c.facing));
    const lean = f.sliding ? -0.35 : 0;
    const flinch = c.hurtT > 0 ? Math.sin((c.hurtT / 0.22) * Math.PI) * 0.12 : 0;
    for (const sb of spineBones) {
      tq.setFromAxisAngle(right, (pitch + lean) / 3);
      rotateWorld(sb, tq);
      if (flinch) {
        tq.setFromAxisAngle(tv2.set(c.hurtZ, 0, -c.hurtX).normalize(), flinch / 3);
        rotateWorld(sb, tq);
      }
      sb.updateWorldMatrix(false, true);
    }

    // ---- weapon in the shared weapon frame ----
    const key = MODEL_FOR[weapon];
    for (const k of Object.keys(c.guns) as ModelKey[]) c.guns[k]!.visible = k === key && f.alive;
    c.gunKey = key;
    const eye = eyePos(f);
    eye.x = px; eye.z = pz;
    eye.y = py + height - MOVE.eyeFromTop;
    const kick = kickAt(f, time);
    const aimYaw = yaw + f.recoilYaw + kick.yaw;
    const aimPitch = pitch + f.recoilPitch + kick.pitch;
    let gun: THREE.Object3D | null = null;
    if (key) {
      gun = c.guns[key] ?? null;
      if (!gun) {
        gun = this.A.weapons[key].clone();
        c.guns[key] = gun;
        this.group.add(gun);
      }
      gun.visible = c.root.visible && f.alive;
      this.wf = weaponFrame(eye, aimYaw, aimPitch, weapon, ads, this.wf ?? undefined)!;
      const w = this.wf;
      const mdl = WEAPON_MODELS[key];
      // presentation offsets: draw (lowered), reload (tilted), shot kick (back + up)
      const draw = def.drawTime > 0 ? Math.min(1, f.switchTimer / def.drawTime) : 0;
      const since = time - f.lastShotTime;
      const shotKick = since >= 0 && since < 0.25 ? Math.exp(-since / 0.06) * (weapon === 'sniper' ? 0.07 : 0.03) : 0;
      const tilt = reloadP >= 0 ? Math.sin(reloadP * Math.PI) : 0;
      const drop = draw * 0.28 + tilt * 0.06;
      w.o.x += -w.f.x * shotKick - w.u.x * drop;
      w.o.y += -w.f.y * shotKick - w.u.y * drop;
      w.o.z += -w.f.z * shotKick - w.u.z * drop;
      const qW = tq.setFromRotationMatrix(tm.makeBasis(tv.set(w.f.x, w.f.y, w.f.z), tv2.set(w.u.x, w.u.y, w.u.z), tv3.set(w.r.x, w.r.y, w.r.z))).clone();
      // reload roll + draw pitch, about the weapon's own axes
      if (tilt > 0) qW.multiply(tq2.setFromAxisAngle(tv.set(1, 0, 0), -tilt * 0.55));
      if (draw > 0) qW.multiply(tq2.setFromAxisAngle(tv.set(0, 0, 1), -draw * 0.9));
      if (shotKick > 0) qW.multiply(tq2.setFromAxisAngle(tv.set(0, 0, 1), shotKick * 1.6));
      const e = mdl.eye;
      gun.quaternion.copy(qW);
      gun.scale.setScalar(mdl.scale);
      gun.position.set(w.o.x, w.o.y, w.o.z).sub(tv.set(e[0], e[1], e[2]).multiplyScalar(mdl.scale).applyQuaternion(qW));
      gun.updateMatrixWorld(true);
      const sock = (s: V3, out: THREE.Vector3) => out.set(s[0], s[1], s[2]).applyMatrix4(gun!.matrixWorld);

      // ---- arms: IK to the grip and support sockets ----
      const grip = sock(mdl.grip, new THREE.Vector3());
      let support = sock(mdl.support, new THREE.Vector3());
      let supportW = 1;
      if (reloadP >= 0) {
        // support hand: magazine out (under the gun), to the belt, back in
        const fw = tv2.set(w.f.x, w.f.y, w.f.z), uw = tv3.set(w.u.x, w.u.y, w.u.z);
        const mag = grip.clone().addScaledVector(fw, 0.13).addScaledVector(uw, -0.13);
        const belt = new THREE.Vector3(px, py + 0.95, pz).addScaledVector(right, -0.15).addScaledVector(fwd, 0.1);
        const p = reloadP;
        if (p < 0.2) support = support.lerp(mag, p / 0.2);
        else if (p < 0.5) support = mag.clone().lerp(belt, Math.sin(((p - 0.2) / 0.3) * Math.PI));
        else if (p < 0.8) support = mag;
        else support = mag.clone().lerp(sock(mdl.support, new THREE.Vector3()), (p - 0.8) / 0.2);
      }
      let gripTarget = grip;
      if (def.bolt) {
        const slot = f.weapons[f.cur];
        if (slot.boltLeft > 0 && slot.boltLeft <= def.bolt.time && reloadP < 0) {
          // bolt: trigger hand to the handle, pull back, push, return
          const p = 1 - slot.boltLeft / def.bolt.time;
          const handle: V3 = [mdl.grip[0] + 4, mdl.eye[1] - 3, 5];
          const back: V3 = [handle[0] - 9, handle[1], 5];
          const h = sock(handle, new THREE.Vector3()), bk = sock(back, new THREE.Vector3());
          if (p < 0.25) gripTarget = grip.clone().lerp(h, p / 0.25);
          else if (p < 0.5) gripTarget = h.lerp(bk, (p - 0.25) / 0.25);
          else if (p < 0.72) gripTarget = bk.lerp(h, (p - 0.5) / 0.22);
          else gripTarget = h.lerp(grip, (p - 0.72) / 0.28);
        }
      }
      if (!f.alive) supportW = 0;
      const rp = new THREE.Vector3(w.r.x, w.r.y, w.r.z);
      const up = new THREE.Vector3(w.u.x, w.u.y, w.u.z);
      const poleR = rp.clone().multiplyScalar(0.6).addScaledVector(up, -1);
      const poleL = rp.clone().multiplyScalar(-0.4).addScaledVector(up, -1);
      twoBoneIK(c.b.RightArm, c.b.RightForeArm, c.b.RightHand, gripTarget, poleR);
      setWorldQuat(c.b.RightHand, tq.copy(qW).multiply(c.ch.gripRel.right));
      if (key === 'pistol') {
        // pistols: the support hand cups the trigger hand
        support = grip.clone().addScaledVector(rp, -0.045).addScaledVector(up, -0.02);
      }
      twoBoneIK(c.b.LeftArm, c.b.LeftForeArm, c.b.LeftHand, support, poleL, supportW);
      if (reloadP < 0 || reloadP > 0.85) setWorldQuat(c.b.LeftHand, tq.copy(qW).multiply(c.ch.gripRel.left));
    } else {
      // melee / unarmed: relaxed arms from the idle clip
    }

    // ---- head: look along the aim; hidden when the camera sits inside it ----
    c.b.Neck.updateWorldMatrix(true, false);
    tq.setFromAxisAngle(right, pitch * 0.3);
    rotateWorld(c.b.Head, tq);
    const hideHead = f.id === view.hideHeadOf && f.alive;
    c.b.Head.scale.setScalar(hideHead ? 0.001 : 1);

    // ---- death: tip over away from the shot, then dissolve ----
    if (c.dead) {
      const t = Math.min(1, c.deadT / 0.45);
      const ax = tv.set(c.deathDir.z, 0, -c.deathDir.x).normalize();
      c.root.quaternion.premultiply(tq.setFromAxisAngle(ax, (t * t) * 1.45));
      c.root.position.y -= Math.max(0, c.deadT - 0.6) * 0.5;
      if (gun) gun.visible = false;
    }
    // spawn protection glow
    c.mat.emissive.setRGB(0, 0, 0);
    if (f.spawnProtect > 0) c.mat.emissive.setRGB(0.35, 0.28, 0.02).multiplyScalar(0.5 + 0.5 * Math.sin(time * 14));
    c.root.updateMatrixWorld(true);
    c.b.Head.getWorldPosition(c.head);
    c.head.y += 0.12;
    void world;
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
