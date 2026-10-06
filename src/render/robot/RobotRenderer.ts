import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOVE } from '../../config/movement';
import { MODEL_FOR, WEAPON_MODELS, adsBlend, type V3 } from '../../config/weaponModels';
import { WEAPONS } from '../../config/weapons';
import { buildSkeleton, createSkeleton, type Skeleton } from '../../sim/body';
import { eyePos, kickAt, type Fighter } from '../../sim/fighter';
import type { Vec3 } from '../../sim/vec';
import { weaponFrame, type WeaponFrame } from '../../sim/weaponFrame';
import type { World } from '../../sim/world';
import type { Effects } from '../Effects';
import { makeBlobTexture } from '../textures';
import { buildTpGuns } from '../tpGuns';
import { loadClipLibrary, PoseAccumulator, type Clip, type ClipLibrary } from './clips';

// ============================================================================
//  Robot characters. One skinned robot per fighter, animated in layers:
//    1. lower body: phase-locked directional locomotion (walk / run / sprint x
//       F / B / L / R), air clips (jump, tuck, reach, fall, land), hard landing, and the
//       dodge roll / landing roll / death as full-body clip overrides; crouch = upright idle dropped at the hips
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

// ---- distance LOD: a reduced index buffer over the same vertices (tools/asset/lod.mjs) ----
/** fighters further than this from the camera draw the reduced meshes (metres, at a 70° vertical FOV) */
export const LOD_DISTANCE = 14;
const LOD_OF = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
const FULL_OF = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

async function attachLod(scene: THREE.Object3D, glbUrl: string) {
  let mesh: THREE.Mesh | null = null;
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh; });
  if (!mesh) return;
  try {
    const res = await fetch(glbUrl.replace(/\.glb$/, '.lod.bin'));
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    const n = new DataView(buf).getUint32(0, true);
    const full = (mesh as THREE.Mesh).geometry;
    const lod = new THREE.BufferGeometry();
    for (const k of Object.keys(full.attributes)) lod.setAttribute(k, full.attributes[k]);
    lod.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, 4, n), 1));
    lod.boundingBox = full.boundingBox;
    lod.boundingSphere = full.boundingSphere;
    LOD_OF.set(full, lod);
    FULL_OF.set(lod, full);
  } catch { /* LOD is optional: full detail everywhere */ }
}

/** Swap every mesh under obj to its reduced or full geometry (no-op when already there). */
function useLod(obj: THREE.Object3D, on: boolean) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const full = FULL_OF.get(m.geometry) ?? m.geometry;
    const want = on ? LOD_OF.get(full) ?? full : full;
    if (m.geometry !== want) m.geometry = want;
  });
}

/** Load the robot, its baked clips and the weapon models (call once before the robot renderer is used). */
export async function loadRobotAssets(base = '/'): Promise<RobotAssets> {
  if (assets) return assets;
  const loader = new GLTFLoader();
  const keys = Object.keys(CHARACTERS) as CharKey[];
  const [charLoads, guns] = await Promise.all([
    Promise.all(keys.map((k) => Promise.all([loader.loadAsync(base + CHARACTERS[k].glb), loadClipLibrary(base + CHARACTERS[k].anims)]))),
    Promise.all((Object.keys(WEAPON_MODELS) as ModelKey[]).map((k) => loader.loadAsync(base + WEAPON_MODELS[k].url!))),
  ]);
  await Promise.all([
    ...keys.map((k, i) => attachLod(charLoads[i][0].scene, base + CHARACTERS[k].glb)),
    ...(Object.keys(WEAPON_MODELS) as ModelKey[]).map((k, i) => attachLod(guns[i].scene, base + WEAPON_MODELS[k].url!)),
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

let pencilGeo: THREE.BufferGeometry | null = null;
/** The "Pencil" melee weapon: tpGuns' merged pencil, bore turned onto +X (the weapon frame's forward). */
function pencilGeometry() {
  if (!pencilGeo) pencilGeo = buildTpGuns().melee.clone().rotateY(-Math.PI / 2);
  return pencilGeo;
}
const PENCIL_SCALE = 2.4;
const PENCIL_REACH = 0.06;
let pencilMat: THREE.MeshStandardMaterial | null = null;
function makePencil(ch: CharAsset, hand: THREE.Bone) {
  pencilMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const m = new THREE.Mesh(pencilGeometry(), pencilMat);
  m.castShadow = false;
  m.frustumCulled = false;
  // same hand-to-weapon frame the guns use (gripRel), so it sits in the fist like a held weapon
  const q = ch.gripRel.right.clone().invert();
  m.quaternion.copy(q);
  m.scale.setScalar(PENCIL_SCALE / ROBOT_SCALE);
  m.position.set(PENCIL_REACH, 0, 0).applyQuaternion(q).divideScalar(ROBOT_SCALE);
  hand.add(m);
  return m;
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
const tq3 = new THREE.Quaternion();
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
  // r is routinely the shared scratch `tq` itself: copy it before getWorldQuaternion overwrites it
  tq3.copy(r);
  b.getWorldQuaternion(tq);
  setWorldQuat(b, tq.premultiply(tq3));
}

const rs0 = new THREE.Vector3(), rs1 = new THREE.Vector3(), rs2 = new THREE.Vector3(), rs4 = new THREE.Vector3(), rs5 = new THREE.Vector3(), rs6 = new THREE.Vector3(), rs7 = new THREE.Vector3(), rs8 = new THREE.Vector3(), rs9 = new THREE.Vector3();
const rs3 = new THREE.Quaternion();
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

// ---------------------------------------------------------------------------- first-person melee
type P3 = [number, number, number];
interface MeleeKey { p: P3; d: P3 }
/** pencil hand (right, up, forward of the eye, metres) and where the pencil points, per swing keyframe */
const MELEE_REST: MeleeKey = { p: [0.27, -0.3, 0.5], d: [0, 0.4, 1] };
const MELEE_PATHS: Record<string, { keys: MeleeKey[]; at: number[] }> = {
  // overhead raise, diagonal cut to the left, settle
  meleeLight: {
    keys: [MELEE_REST, { p: [0.38, 0.12, 0.4], d: [0.2, 1, 0.5] }, { p: [-0.3, -0.38, 0.66], d: [-0.9, -0.35, 0.7] }, MELEE_REST],
    at: [0, 0.26, 0.6, 1],
  },
  // rising backhand cut from the low left
  meleeLightB: {
    keys: [MELEE_REST, { p: [-0.34, -0.36, 0.5], d: [-0.7, -0.5, 0.8] }, { p: [0.4, 0.12, 0.64], d: [0.8, 0.55, 0.7] }, MELEE_REST],
    at: [0, 0.26, 0.6, 1],
  },
  // pull back, then thrust straight ahead
  meleeHeavy: {
    keys: [MELEE_REST, { p: [0.3, -0.24, 0.16], d: [0.1, 0.5, 1] }, { p: [0.04, -0.06, 1.0], d: [0, 0.04, 1] }, { p: [0.04, -0.06, 1.0], d: [0, 0.04, 1] }, MELEE_REST],
    at: [0, 0.48, 0.66, 0.78, 1],
  },
};
function meleePose(kind: string, u: number, p: P3, d: P3) {
  const path = MELEE_PATHS[kind];
  let a = MELEE_REST, b = MELEE_REST, k = 0;
  if (path && u >= 0 && u < 1) {
    let i = 0;
    while (i < path.at.length - 2 && u >= path.at[i + 1]) i++;
    a = path.keys[i];
    b = path.keys[i + 1];
    k = smooth01((u - path.at[i]) / (path.at[i + 1] - path.at[i]));
  }
  for (let j = 0; j < 3; j++) { p[j] = a.p[j] + (b.p[j] - a.p[j]) * k; d[j] = a.d[j] + (b.d[j] - a.d[j]) * k; }
}

// ---------------------------------------------------------------------------- per-fighter state
interface RobotState {
  /** drawing the reduced meshes (far from the camera) */
  lod: boolean;
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
  /** ground roll (dash) and landing roll timers; -1 = not rolling */
  rollT: number;
  rollDir: number;
  rollKind: 'dash' | 'land';
  hitClip: string;
  hurtDur: number;
  /** which roll clip plays, and whether the body keeps facing the aim (side rolls) or the dash direction */
  rollClip: string;
  rollSide: boolean;
  /** slide: ramp-in, and the stand-up that plays when it ends (-1 = none) */
  slideT: number;
  slideExitT: number;
  /** melee swing: seconds into the clip (-1 = none), which clip, the last swing time seen, alternating side */
  meleeT: number;
  meleeClip: string;
  meleeSeen: number;
  meleeFlip: boolean;
  /** hard (standing) landing timer, -1 = none */
  hardT: number;
  pencil: THREE.Mesh | null;
  /** slow-moving chest position in the character frame (the gun follows the fast part of the chest's motion) */
  chestRef: THREE.Vector3;
  chestInit: boolean;
  /** first-person gun inertia: the gun trails fast turns on a damped spring (yaw, pitch and their speeds) */
  lagYaw: number;
  lagPitch: number;
  lagVYaw: number;
  lagVPitch: number;
  /** arm lengths shoulder -> hand (m), left and right; measured once */
  armLen: [number, number] | null;
  /** chest twist (yaw) and lean (pitch) the reach solver used last frame, eased so the torso never jitters */
  reachYaw: number;
  reachLean: number;
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
  /** local fighter whose weapon is hidden (full-screen scope overlay up, camera inside the scope), -1 for none */
  hideGunOf?: number;
  /** view yaw/pitch for the local fighter (immediate mouse), so its gun tracks the reticle exactly */
  localId: number;
  viewYaw: number;
  viewPitch: number;
  /** how fast the local player is turning the view (rad/s); first-person gun sway */
  lookYawRate?: number;
  lookPitchRate?: number;
  /** third-person shoulder ADS is active: guns come up to the shoulder instead of sliding onto the camera */
  shoulderAds?: boolean;
}

/** the gun rides the chest's motion above this frequency's worth of smoothing (seconds), and no further than this (m) */
const SWAY_SMOOTH = 0.3;
const SWAY_MAX = 0.07;
/** reach solver limits: chest twist (rad), chest lean (rad) and the arm length fraction a hand may be asked for */
const REACH_YAW = 0.62;
const REACH_LEAN = 0.34;
/** shoulder ADS gun pose: pulled forward and in toward the head from the hip carry (m), on top of the raise to eye level */
const SHOULDER_AIM = { forward: 0.05, inward: 0.04 };
const HURT_TIME = 0.42;
/** a headshot snaps the head back for longer */
const HEAD_HURT_TIME = 0.66;
/** gait cycles per second never exceed these, so slow clips at high speed slide a little instead of running in fast forward */
const MAX_CYCLES = { stand: 3.4, crouch: 2.3 };
/** seconds a dash roll / landing roll plays for */
const ROLL_TIME = { dash: MOVE.rollTime, land: 0.62 };
const BLEND_SPEED = { walk: 1.6, run: 3.8, sprint: 5.6 };

export class RobotRenderer {
  readonly group = new THREE.Group();
  private chars = new Map<number, RobotState>();
  private acc!: PoseAccumulator;
  private upperMask!: Float32Array;
  private lowerMask!: Float32Array;
  private masks = new Map<CharKey, { acc: PoseAccumulator; upper: Float32Array; lower: Float32Array; torso: Float32Array; arms: Float32Array; chest: Float32Array }>();
  private torsoMask!: Float32Array;
  private armsMask!: Float32Array;
  private chestMask!: Float32Array;
  /** what the local player plays as; everyone else wears the other skin so enemies read apart */
  playerChar: CharKey = 'armored';
  private shadows: THREE.InstancedMesh;
  private frustum = new THREE.Frustum();
  private camPos = new THREE.Vector3();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  private wf: WeaponFrame | null = null;
  /** counts for the perf overlay */
  drawn = 0;

  constructor(readonly effects: Effects, private A: RobotAssets, maxChars = 16) {
    for (const k of Object.keys(A.chars) as CharKey[]) {
      const bonesK = A.chars[k].lib.bones;
      const upper = new Float32Array(bonesK.length), lower = new Float32Array(bonesK.length), torso = new Float32Array(bonesK.length);
      const arms = new Float32Array(bonesK.length), chest = new Float32Array(bonesK.length);
      bonesK.forEach((name, j) => {
        const up = /Spine1|Spine2|Neck|Head|Shoulder|Arm|Hand/.test(name);
        const spine = name === 'Spine';
        upper[j] = up ? 1 : spine ? 0.5 : 0;
        lower[j] = up ? 0 : spine ? 0.5 : 1;
        torso[j] = /^Spine|Neck|Head/.test(name) && !/Shoulder|Arm|Hand/.test(name) ? 1 : 0;
        arms[j] = /Shoulder|Arm|Hand/.test(name) ? 1 : 0;
        chest[j] = up && !arms[j] ? 1 : spine ? 0.5 : 0;
      });
      this.masks.set(k, { acc: new PoseAccumulator(bonesK.length), upper, lower, torso, arms, chest });
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
      wasGround: true, landT: 9, airT: 0, hurtT: 0, hurtX: 0, hurtZ: 0, rollT: -1, rollDir: 0, rollKind: 'dash', hitClip: 'hitFront', hurtDur: 0.42, rollClip: 'roll', rollSide: false, slideT: 0, slideExitT: -1, meleeT: -1, meleeClip: 'meleeLight', meleeSeen: -99, meleeFlip: false, hardT: -1, pencil: null, chestRef: new THREE.Vector3(), chestInit: false, lagYaw: 0, lagPitch: 0, lagVYaw: 0, lagVPitch: 0, armLen: null, reachYaw: 0, reachLean: 0,
      dead: false, deadT: 0, deathDir: new THREE.Vector3(), lastShot: -99,
      sk: createSkeleton(), head: new THREE.Vector3(), visibleLast: true, lod: false,
    };
    this.chars.set(f.id, c);
    this.group.add(root);
    return c;
  }

  hurt(id: number, dirX: number, dirZ: number, head = false) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hurtDur = head && this.A.chars[c.key].lib.clips.headshot ? HEAD_HURT_TIME : HURT_TIME;
    c.hurtT = c.hurtDur;
    c.hurtX = dirX;
    c.hurtZ = dirZ;
    // pick the reaction from where the shot came from (bullet direction vs the fighter's facing)
    const sy = Math.sin(c.facing), cy = Math.cos(c.facing);
    const along = -(dirX * -sy + dirZ * -cy); // >0: bullet travels against facing = hit from the front
    const side = dirX * cy - dirZ * sy;
    c.hitClip = c.hurtDur === HEAD_HURT_TIME ? 'headshot' : Math.abs(side) > Math.abs(along) ? (side > 0 ? 'hitL' : 'hitR') : along > 0 ? 'hitFront' : 'hitBack';
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
    const pc = camera as THREE.PerspectiveCamera;
    const zoomK = pc.isPerspectiveCamera ? Math.tan((pc.fov * Math.PI) / 360) / Math.tan((70 * Math.PI) / 360) : 1;
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
      this.sphere.center.set(px, py + 1, pz);
      const onScreen = this.frustum.intersectsSphere(this.sphere);
      if (c.dead) {
        c.deadT += dt;
        if (c.deadT > 2.4) {
          c.root.visible = false;
          continue;
        }
      }
      c.root.visible = onScreen;
      if (!onScreen) continue;
      this.drawn++;
      // screen size decides, so a scope's zoom brings full detail back
      const far = f.id !== view.localId && Math.hypot(px - this.camPos.x, py + 1 - this.camPos.y, pz - this.camPos.z) * zoomK > LOD_DISTANCE;
      if (far !== c.lod) { c.lod = far; useLod(c.model, far); }
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

  /**
   * Twist and lean the chest until both hands can reach the gun. The grip and support sockets sit where the aim
   * frame puts them (rifle at the shoulder, arm's length ahead of the face), which the arms cannot reach from an
   * upright torso, so the support hand used to hang in the air while the gun floated. Shoulders come forward with a
   * bladed twist first, then a lean. The result is eased over frames so it never jitters.
   */
  private reachSolve(c: RobotState, grip: THREE.Vector3, support: THREE.Vector3 | null, allowShift: boolean) {
    const B = c.b;
    if (!c.armLen) {
      const len = (a: THREE.Bone, b: THREE.Bone, h: THREE.Bone) => a.getWorldPosition(rs0).distanceTo(b.getWorldPosition(rs1)) + b.getWorldPosition(rs1).distanceTo(h.getWorldPosition(rs2));
      c.armLen = [len(B.LeftArm, B.LeftForeArm, B.LeftHand), len(B.RightArm, B.RightForeArm, B.RightHand)];
    }
    const [lenL, lenR] = c.armLen;
    const chain = [B.Spine, B.Spine1, B.Spine2];
    const turn = (axis: THREE.Vector3, ang: number) => {
      for (const bone of chain) {
        rs3.setFromAxisAngle(axis, ang / 3);
        rotateWorld(bone, rs3);
        bone.updateWorldMatrix(false, true);
      }
    };
    const need = () => {
      B.LeftArm.getWorldPosition(rs0);
      B.RightArm.getWorldPosition(rs1);
      return [support ? rs0.distanceTo(support) - lenL * 0.96 : -1, rs1.distanceTo(grip) - lenR * 0.96] as const;
    };
    let yaw = 0, lean = 0;
    const rightAxis = rs4.set(Math.cos(c.facing), 0, -Math.sin(c.facing));
    for (let it = 0; it < 6; it++) {
      const [nl, nr] = need();
      const worst = Math.max(nl, nr);
      if (worst < 0.004) break;
      const target = nl >= nr ? support! : grip;
      const shoulder = (nl >= nr ? B.LeftArm : B.RightArm).getWorldPosition(rs0);
      rs5.subVectors(target, shoulder).normalize();
      // twist about the vertical through the chest
      B.Spine1.getWorldPosition(rs6);
      rs7.subVectors(shoulder, rs6);
      rs7.y = 0;
      rs8.set(rs7.z, 0, -rs7.x); // up x r
      const rateYaw = rs8.dot(rs5);
      if (Math.abs(rateYaw) > 0.04 && Math.abs(yaw) < REACH_YAW) {
        const d = Math.max(-0.3, Math.min(0.3, worst / rateYaw));
        const next = Math.max(-REACH_YAW, Math.min(REACH_YAW, yaw + d));
        turn(rs9.set(0, 1, 0), next - yaw);
        yaw = next;
        continue;
      }
      // then lean at the waist
      B.Spine.getWorldPosition(rs6);
      rs7.subVectors(shoulder, rs6);
      rs8.crossVectors(rightAxis, rs7);
      const rateLean = rs8.dot(rs5);
      if (Math.abs(rateLean) < 0.04) break;
      const d = Math.max(-0.25, Math.min(0.25, worst / rateLean));
      const next = Math.max(-REACH_LEAN, Math.min(REACH_LEAN, lean + d));
      if (Math.abs(next - lean) < 1e-4) break;
      turn(rightAxis, next - lean);
      lean = next;
    }
    c.reachYaw = yaw;
    c.reachLean = lean;
    // last resort (airborne tucks, mostly): step the whole body toward the gun a little. Never for the local
    // first-person body, whose head is locked to the camera
    if (allowShift) {
      const [nl, nr] = need();
      if (Math.max(nl, nr) > 0.012) {
        const target = nl >= nr ? support! : grip;
        const shoulder = (nl >= nr ? B.LeftArm : B.RightArm).getWorldPosition(rs0);
        rs5.subVectors(target, shoulder).normalize().multiplyScalar(Math.min(Math.max(nl, nr), 0.12));
        c.root.position.add(rs5);
        c.root.updateMatrixWorld(true);
      }
    }
  }

  private animate(f: Fighter, c: RobotState, dt: number, alpha: number, time: number, px: number, py: number, pz: number, world: World, view: RobotViewOptions) {
    const L = c.ch.lib.clips;
    const mk = this.masks.get(c.key)!;
    this.acc = mk.acc;
    this.upperMask = mk.upper;
    this.lowerMask = mk.lower;
    this.torsoMask = mk.torso;
    this.armsMask = mk.arms;
    this.chestMask = mk.chest;
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
    const walkT = 1 - runT;
    if (weapon === 'sniper' && L.walkSniper) {
      // Max's sniper walks: rifle-carry walk forward, aimed sidestep while scoped
      add(L.walkSniper, wF * walkT); add(L.walkB, wB * walkT);
      add(L.walkL, wLt * walkT * (1 - ads)); add(L.walkSniperAdsL, wLt * walkT * ads);
      add(L.walkR, wR * walkT * (1 - ads)); add(L.walkSniperAdsR, wR * walkT * ads);
    } else {
      add(L.walkF, wF * walkT); add(L.walkB, wB * walkT); add(L.walkL, wLt * walkT); add(L.walkR, wR * walkT);
    }
    add(L.runF, wF * runT * (1 - sprintT / Math.max(wF, 1e-3))); add(L.runB, wB * runT); add(L.runL, wLt * runT); add(L.runR, wR * runT);
    add(L.sprintRifle ?? L.sprint, sprintT * runT);
    // crouching swaps the whole family for Max's crouch walks (the stance fades in with the height)
    const crouchW = L.crouchF ? crouch : 0;
    if (crouchW > 0) {
      for (const e of set) e[1] *= 1 - crouchW;
      add(L.crouchF, wF * crouchW); add(L.crouchB, wB * crouchW); add(L.crouchL, wLt * crouchW); add(L.crouchR, wR * crouchW);
    }
    // phase: advance by distance over the blended cycle length so feet stay planted (capped, see MAX_CYCLES)
    let cycle = 0, wsum = 0;
    for (const [clip, w] of set) { cycle += w * clip.stride * ROBOT_SCALE * clip.duration; wsum += w; }
    if (wsum > 0 && cycle > 1e-3) {
      const cps = Math.min(speed / (cycle / wsum), MAX_CYCLES.stand + (MAX_CYCLES.crouch - MAX_CYCLES.stand) * crouchW);
      c.phase = (c.phase + cps * dt) % 1;
    }

    // air / landing
    if (!f.onGround) c.airT += dt; else c.airT = 0;
    if (f.onGround && !c.wasGround) {
      c.landT = 0;
      // hard landing while moving: tuck into a roll instead of a squash
      const hs = Math.hypot(f.vel.x, f.vel.z);
      if (f.lastLandSpeed > 9 && hs > 3.5 && c.rollT < 0 && !f.sliding) { c.rollT = 0; c.rollKind = 'land'; c.rollClip = 'roll'; c.rollSide = false; c.rollDir = Math.atan2(-f.vel.x, -f.vel.z); }
      else if (f.lastLandSpeed > 12 && !f.crouching && L.hardLand) c.hardT = 0;
    }
    c.wasGround = f.onGround;
    // ground dash = dodge roll toward the dash direction (the sim owns its timer); a hard landing at speed
    // tucks into a short visual-only roll
    if (f.rollTimer > 0) {
      if (c.rollKind !== 'dash' || c.rollT < 0) {
        // a fresh dodge: pick the clip from the dash direction relative to where the fighter aims. Forward
        // dashes tumble along the dash; sideways ones keep facing the aim and use the side rolls; backward ones dive
        const fwd = -f.dashDirX * sy - f.dashDirZ * cy, rgt = f.dashDirX * cy - f.dashDirZ * sy;
        const a = Math.atan2(rgt, fwd);
        if (L.rollL && L.rollR && Math.abs(a) > 0.87) {
          c.rollSide = true;
          c.rollClip = Math.abs(a) > 2.2 && L.sideDive ? (a > 0 ? 'sideDive' : 'sideDiveL') : a > 0 ? 'rollR' : 'rollL';
        } else { c.rollSide = false; c.rollClip = 'roll'; }
      }
      c.rollKind = 'dash';
      c.rollT = MOVE.rollTime - f.rollTimer;
      c.rollDir = Math.atan2(-f.dashDirX, -f.dashDirZ);
    } else if (c.rollKind === 'dash') c.rollT = -1;
    else if (c.rollT >= 0) {
      c.rollT += dt;
      if (c.rollT >= ROLL_TIME.land || c.dead || f.sliding || !f.onGround) c.rollT = -1;
    }
    const rolling = c.rollT >= 0 && !c.dead;
    // whole-body clip override: roll while rolling, death clip once dead
    const dying = c.dead;
    const override: Clip | null = dying ? (L.death ?? null) : rolling ? L[c.rollClip] ?? L.roll ?? null : null;
    const overrideU = dying ? clamp01(c.deadT / (override ? override.duration : 1)) : clamp01(c.rollT / ROLL_TIME[c.rollKind]);
    if (rolling) c.root.rotation.set(0, (c.rollSide ? c.facing : c.rollDir) + Math.PI, 0);
    if (dying) c.root.rotation.set(0, Math.atan2(-c.deathDir.x, -c.deathDir.z), 0);
    c.landT += dt;
    c.hurtT = Math.max(0, c.hurtT - dt);
    if (c.hardT >= 0) { c.hardT += dt; if (!f.onGround || c.hardT >= (L.hardLand?.duration ?? 0)) c.hardT = -1; }
    // slide: ease into the held squat, and stand up out of it when the slide ends
    if (f.sliding && f.onGround) { c.slideT = Math.min(1, c.slideT + dt / 0.12); c.slideExitT = -1; }
    else {
      if (c.slideT > 0.5 && f.onGround && L.slideExit) c.slideExitT = 0;
      c.slideT = 0;
      if (c.slideExitT >= 0) { c.slideExitT += dt; if (c.slideExitT >= (L.slideExit?.duration ?? 0) || !f.onGround) c.slideExitT = -1; }
    }
    const slideW = L.slideHold && f.sliding ? smooth01(c.slideT) : 0;
    const exitU = c.slideExitT >= 0 && L.slideExit ? c.slideExitT / L.slideExit.duration : -1;
    const exitW = exitU >= 0 ? 1 - smooth01(exitU) : 0;
    const baseW = Math.max(0, 1 - slideW - exitW);

    const acc = this.acc;
    acc.reset();
    const standIdle = L.idleUp ?? L.idle;
    // idle sway runs at real time, offset per fighter so a crowd does not breathe in unison
    const idleU = (time / standIdle.duration + f.id * 0.37) % 1;
    const lowerW = 1;
    if (override) {
      override.accumulate(overrideU, 1, acc);
    } else if (c.hardT >= 0 && f.onGround) {
      // heavy landing: absorb with the whole lower body
      L.hardLand.accumulate(c.hardT / L.hardLand.duration, 1, acc, this.lowerMask);
    } else if (!f.onGround && !f.sliding) {
      // rising: jump takeoff -> tuck; apex: reach; falling: fall loop
      const vy = f.vel.y;
      const rise = clamp01(vy / 4), fall = clamp01(-vy / 4);
      const takeoff = clamp01(1 - c.airT / 0.18);
      L.jump.accumulate(1 - takeoff, takeoff * rise, acc, this.lowerMask);
      L.tuck.accumulate(clamp01(c.airT / 0.3), (1 - takeoff) * rise, acc, this.lowerMask);
      L.reach.accumulate(0.5, (1 - rise) * (1 - fall), acc, this.lowerMask);
      L.fall.accumulate((c.airT * 0.8) % 1, fall, acc, this.lowerMask);
    } else {
      const idleW = (1 - moveW) * lowerW * baseW;
      // crouching: Max's crouch pose at rest (without those clips: the upright stance dropped at the hips, below)
      standIdle.accumulate(idleU, idleW * (1 - crouchW), acc, this.lowerMask);
      if (crouchW > 0) L.crouchIdle.accumulate(0, idleW * crouchW, acc, this.lowerMask);
      for (const [clip, w] of set) clip.accumulate(c.phase + clip.sync, (w / (wsum || 1)) * moveW * lowerW * baseW, acc, this.lowerMask);
      if (c.landT < 0.22) L.land.accumulate(c.landT / 0.22, 0.6 * (1 - c.landT / 0.22) * baseW, acc, this.lowerMask);
      if (slideW > 0) L.slideHold.accumulate(0.5, slideW, acc, this.lowerMask);
      if (exitW > 0) L.slideExit.accumulate(exitU, exitW, acc, this.lowerMask);
    }
    // upper body: relaxed upright idle (the IK pass puts the hands on the actual weapon); melee and hit reactions layer on top
    if (!override) {
      // melee swing: guard stance for the arms and chest, with the swing clip blended over it
      let swing: Clip | null = null, swingW = 0, swingU = 0;
      if (weapon === 'melee' && f.alive) {
        if (f.lastMeleeTime !== c.meleeSeen) {
          c.meleeSeen = f.lastMeleeTime;
          if (f.lastMeleeTime > time - 0.3) {
            c.meleeT = 0;
            if (f.lastMeleeHeavy) c.meleeClip = 'meleeHeavy';
            else { c.meleeFlip = !c.meleeFlip; c.meleeClip = c.meleeFlip ? 'meleeLightB' : 'meleeLight'; }
          }
        }
        if (c.meleeT >= 0) {
          swing = L[c.meleeClip] ?? null;
          if (swing) {
            c.meleeT += dt;
            swingU = c.meleeT / swing.duration;
            if (swingU >= 1) c.meleeT = -1;
            else swingW = smooth01(Math.min(swingU / 0.18, (1 - swingU) / 0.25, 1));
          } else c.meleeT = -1;
        }
        // arms follow the guard / swing clips; the chest keeps the upright idle (the guard's boxer's hunch looks
        // like a bow over upright legs) and takes only part of the swing's torso twist
        const guard = L.meleeGuard ?? standIdle, twist = swingW * 0.7;
        guard.accumulate((time / guard.duration) % 1, 1 - swingW, acc, this.armsMask);
        standIdle.accumulate(idleU, 1 - twist, acc, this.chestMask);
        if (swing && swingW > 0) {
          swing.accumulate(swingU, swingW, acc, this.armsMask);
          swing.accumulate(swingU, twist, acc, this.chestMask);
        }
      } else {
        c.meleeT = -1;
        standIdle.accumulate(idleU, 1, acc, this.upperMask);
      }
      // sniper bolt: Max's bolt-cycle clip nods the chest and head along with the hands' IK
      const boltSlot = f.weapons[f.cur];
      if (def.bolt && L.bolt && boltSlot.boltLeft > 0 && boltSlot.boltLeft <= def.bolt.time) {
        const bu = 1 - boltSlot.boltLeft / def.bolt.time;
        L.bolt.accumulate(bu, Math.sin(bu * Math.PI) * 0.8, acc, this.chestMask);
      }
      // hit reaction: the matching flinch clip drives spine, neck and head (arms stay on the gun)
      if (c.hurtT > 0 && L[c.hitClip]) {
        const u = 1 - c.hurtT / c.hurtDur;
        const long = c.hitClip !== 'hitFront' && c.hitClip !== 'headshot';
        L[c.hitClip].accumulate(u * (long ? 0.45 : 1), Math.sin(Math.min(1, u * 1.15) * Math.PI), acc, this.torsoMask);
      }
    }
    // reload body motion (arms are re-targeted below, but the torso dips with the clip)
    const reloading = f.reloadTimer > 0 && def.reloadTime > 0;
    const reloadP = reloading ? 1 - f.reloadTimer / def.reloadTime : -1;

    const bones = c.bones;
    for (let j = 0; j < bones.length; j++) acc.read(j, bones[j].quaternion, c.rest[j]);
    const hipW = acc.hipW > 0 ? 1 / acc.hipW : 0;
    c.b.Hips.position.set(c.hipRest.x + acc.hip[0] * hipW, c.hipRest.y + acc.hip[1] * hipW, c.hipRest.z + acc.hip[2] * hipW);

    // ---- hips height: crouch / slide drop (legs re-solved with IK below) ----
    buildSkeleton({ pos: { x: px, y: py, z: pz }, vel: f.vel, yaw, pitch, lowerYaw: c.facing, height, gait: f.gait, onGround: f.onGround, sliding: f.sliding, ads }, weapon, c.sk);
    // Max's crouch and slide clips carry their own hip height and foot placement; without them, drop the hips and re-plant the feet with IK
    let hipDrop = L.crouchF ? 0 : (crouch * 0.3) / ROBOT_SCALE;
    if (f.sliding && !L.slideHold) hipDrop = 0.48 / ROBOT_SCALE;
    const legIK = hipDrop > 1e-4 || (f.sliding && !L.slideHold);
    if (!override) c.b.Hips.position.y -= hipDrop;
    // landing squash
    if (!override && c.landT < 0.25 && f.onGround) c.b.Hips.position.y -= Math.sin((c.landT / 0.25) * Math.PI) * Math.min(0.08, f.lastLandSpeed * 0.008) / ROBOT_SCALE;

    c.root.updateMatrixWorld(true);

    // first person: the camera sits in the head, but the clips lean the head and shoulders out in front of the hips
    // (the crouch walk most of all), which puts the chest in the lens. Slide the body back until the head is over
    // the camera; the arms, IK and gun below are all solved from the shifted body
    if (!override && f.alive && f.id === view.hideHeadOf) {
      c.b.Head.getWorldPosition(tv);
      const sx = px - tv.x, sz = pz - tv.z, sl = Math.hypot(sx, sz);
      // and if the head rides higher than a standing head does (0.16 m under the eye), sink the body: the feet are never seen from the head
      const sy2 = Math.max(-0.4, Math.min(0, py + height - MOVE.eyeFromTop - 0.16 - tv.y));
      if (sl > 1e-4 || sy2 < -1e-4) {
        const k = sl > 1e-4 ? Math.min(1, 0.45 / sl) : 0;
        c.root.position.x += sx * k;
        c.root.position.z += sz * k;
        c.root.position.y += sy2;
        c.root.updateMatrixWorld(true);
      }
    }

    // ---- legs: keep the clip's feet on the ground after the hips moved ----
    if (!override && f.onGround && legIK) {
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
    const lean = f.sliding ? (L.slideHold ? -0.12 : -0.35) : 0;
    // a hit jerks the torso along the bullet's direction on top of the flinch clip (peaks early, settles)
    const hitU = c.hurtT > 0 ? 1 - c.hurtT / c.hurtDur : 1;
    const flinch = c.hurtT > 0 ? Math.sin(Math.min(1, hitU * 1.6) * Math.PI) * 0.42 : 0;
    if (!override) for (const sb of spineBones) {
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
    const gunHidden = f.id === view.hideGunOf;
    for (const k of Object.keys(c.guns) as ModelKey[]) c.guns[k]!.visible = k === key && f.alive && !gunHidden;
    c.gunKey = key;
    const eye = eyePos(f);
    eye.x = px; eye.z = pz;
    eye.y = py + height - MOVE.eyeFromTop;
    const kick = kickAt(f, time);
    // first person: the gun trails fast turns on a damped spring and settles (aiming down sights locks it back on)
    if (f.id === view.hideHeadOf && f.alive && view.lookYawRate !== undefined) {
      const stepSpring = (x: number, v: number, target: number) => {
        const w = 16, z = 0.72, acc = w * w * (target - x) - 2 * z * w * v;
        const nv = v + acc * Math.min(dt, 0.033);
        return [x + nv * Math.min(dt, 0.033), nv] as const;
      };
      const ty = Math.max(-0.09, Math.min(0.09, -(view.lookYawRate ?? 0) * 0.016));
      const tp = Math.max(-0.07, Math.min(0.07, -(view.lookPitchRate ?? 0) * 0.016));
      [c.lagYaw, c.lagVYaw] = stepSpring(c.lagYaw, c.lagVYaw, ty);
      [c.lagPitch, c.lagVPitch] = stepSpring(c.lagPitch, c.lagVPitch, tp);
    } else { c.lagYaw = c.lagPitch = c.lagVYaw = c.lagVPitch = 0; }
    const swayAim = 1 - adsBlend(ads);
    const aimYaw = yaw + f.recoilYaw + kick.yaw + c.lagYaw * swayAim;
    const aimPitch = pitch + f.recoilPitch + kick.pitch + c.lagPitch * swayAim;
    let gun: THREE.Object3D | null = null;
    if (key) {
      gun = c.guns[key] ?? null;
      if (!gun) {
        gun = this.A.weapons[key].clone();
        c.guns[key] = gun;
        this.group.add(gun);
      }
      gun.visible = c.root.visible && f.alive && !gunHidden;
      useLod(gun, c.lod);
      // Rogue Company style ADS (third person, not the sniper): the gun comes up to the cheek on the shoulder it hangs
      // from, raised to eye level and drawn in a little, where the camera can see it over the shoulder, rather than
      // sliding onto the camera line
      const shoulderAim = !!view.shoulderAds && key !== 'sniper' && ads > 0;
      this.wf = weaponFrame(eye, aimYaw, aimPitch, weapon, shoulderAim ? 0 : ads, this.wf ?? undefined)!;
      const w = this.wf;
      if (shoulderAim) {
        const a = adsBlend(ads), hip = w.model.hip;
        const raise = -hip[1] * a, fwd = SHOULDER_AIM.forward * a, inward = Math.min(hip[0], SHOULDER_AIM.inward) * a;
        w.o.x += w.u.x * raise + w.f.x * fwd - w.r.x * inward;
        w.o.y += w.u.y * raise + w.f.y * fwd - w.r.y * inward;
        w.o.z += w.u.z * raise + w.f.z * fwd - w.r.z * inward;
      }
      // the gun rides the fast part of the chest's motion (run bob, stride twist, flinch), measured against a slow
      // reference in the character frame, so it moves with the body and arms instead of hanging in the aim frame.
      // Aiming down sights fades it out: the sights must stay exactly on the camera
      c.b.Spine2.getWorldPosition(rs0);
      c.root.worldToLocal(rs0);
      if (!c.chestInit) { c.chestRef.copy(rs0); c.chestInit = true; }
      c.chestRef.lerp(rs0, 1 - Math.exp(-dt / SWAY_SMOOTH));
      const swayK = 1 - adsBlend(ads);
      rs1.subVectors(rs0, c.chestRef).applyQuaternion(c.root.quaternion);
      if (rs1.length() > SWAY_MAX) rs1.setLength(SWAY_MAX);
      w.o.x += rs1.x * swayK;
      w.o.y += rs1.y * swayK;
      w.o.z += rs1.z * swayK;
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

      if (override) {
        // rolling / dying: the gun rides in the animated right hand (no aim IK)
        const hq = c.b.RightHand.getWorldQuaternion(new THREE.Quaternion());
        qW.copy(hq).multiply(tq2.copy(c.ch.gripRel.right).invert());
        gun.quaternion.copy(qW);
        const hp = c.b.RightHand.getWorldPosition(new THREE.Vector3());
        gun.position.copy(hp).sub(tv.set(mdl.grip[0], mdl.grip[1], mdl.grip[2]).multiplyScalar(mdl.scale).applyQuaternion(qW));
        gun.updateMatrixWorld(true);
      } else {
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
      if (key === 'pistol') {
        // pistols: the support hand cups the trigger hand
        support = grip.clone().addScaledVector(rp, -0.045).addScaledVector(up, -0.02);
      }
      // make both hands reachable: twist / lean the chest toward the gun (near fighters only), and where the arm is
      // still short, take the support hand back along the gun toward the grip so it always touches the weapon
      if (!c.lod) this.reachSolve(c, gripTarget, supportW > 0 ? support : null, f.id !== view.hideHeadOf);
      if (supportW > 0 && c.armLen) {
        const reach = c.armLen[0] * 0.96, dist = c.b.LeftArm.getWorldPosition(rs0).distanceTo(support);
        if (dist > reach + 0.01) {
          const toGrip = new THREE.Vector3().subVectors(grip, support), gl = toGrip.length();
          if (gl > 1e-3) support = support.clone().addScaledVector(toGrip, Math.min(0.85, (dist - reach) / gl));
        }
      }
      twoBoneIK(c.b.RightArm, c.b.RightForeArm, c.b.RightHand, gripTarget, poleR);
      setWorldQuat(c.b.RightHand, tq.copy(qW).multiply(c.ch.gripRel.right));
      twoBoneIK(c.b.LeftArm, c.b.LeftForeArm, c.b.LeftHand, support, poleL, supportW);
      if (reloadP < 0 || reloadP > 0.85) setWorldQuat(c.b.LeftHand, tq.copy(qW).multiply(c.ch.gripRel.left));
      }
    } else if (weapon === 'melee' && f.alive && !override && f.id === view.hideHeadOf) {
      // first person: the camera sits in the head, so the third-person guard / swing clips would play below
      // the screen. Drive the pencil hand along a camera-relative path instead (same timing as the clips).
      const cp = Math.cos(aimPitch), sp = Math.sin(aimPitch), sy2 = Math.sin(aimYaw), cy2 = Math.cos(aimYaw);
      const fw = new THREE.Vector3(-sy2 * cp, sp, -cy2 * cp), rt = new THREE.Vector3(cy2, 0, -sy2);
      const upv = new THREE.Vector3().crossVectors(rt, fw).normalize();
      const clip = c.meleeT >= 0 ? L[c.meleeClip] : null;
      const hp: P3 = [0, 0, 0], hd: P3 = [0, 0, 0];
      meleePose(c.meleeClip, clip ? c.meleeT / clip.duration : -1, hp, hd);
      const tgt = new THREE.Vector3(eye.x, eye.y, eye.z).addScaledVector(rt, hp[0]).addScaledVector(upv, hp[1]).addScaledVector(fw, hp[2]);
      twoBoneIK(c.b.RightArm, c.b.RightForeArm, c.b.RightHand, tgt, rt.clone().multiplyScalar(0.7).addScaledVector(upv, -1));
      const pf = new THREE.Vector3().addScaledVector(rt, hd[0]).addScaledVector(upv, hd[1]).addScaledVector(fw, hd[2]).normalize();
      const pu = upv.clone().addScaledVector(pf, -upv.dot(pf)).normalize();
      const pr = new THREE.Vector3().crossVectors(pf, pu);
      const qP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(pf, pu, pr));
      setWorldQuat(c.b.RightHand, tq.copy(qP).multiply(c.ch.gripRel.right));
      // guard hand: a loose fist low on the left
      const lt = new THREE.Vector3(eye.x, eye.y, eye.z).addScaledVector(rt, -0.3).addScaledVector(upv, -0.36 + hp[1] * 0.05).addScaledVector(fw, 0.38);
      twoBoneIK(c.b.LeftArm, c.b.LeftForeArm, c.b.LeftHand, lt, rt.clone().multiplyScalar(-0.7).addScaledVector(upv, -1));
    } else {
      // melee / unarmed in third person: the guard and swing clips drive the arms
    }

    // ---- the pencil rides in the right hand while the melee weapon is out ----
    if (weapon === 'melee' && !c.pencil) c.pencil = makePencil(c.ch, c.b.RightHand);
    if (c.pencil) c.pencil.visible = weapon === 'melee' && f.alive && f.id !== view.hideGunOf;

    // ---- head: look along the aim; hidden when the camera sits inside it ----
    c.b.Neck.updateWorldMatrix(true, false);
    tq.setFromAxisAngle(right, pitch * 0.3);
    if (!override) rotateWorld(c.b.Head, tq);
    if (!override && c.hurtT > 0 && c.hitClip === 'headshot') {
      // a headshot throws the head back along the bullet's direction
      tq.setFromAxisAngle(tv2.set(c.hurtZ, 0, -c.hurtX).normalize(), Math.sin(Math.min(1, (1 - c.hurtT / c.hurtDur) * 1.8) * Math.PI) * 0.6);
      rotateWorld(c.b.Head, tq);
    }
    const hideHead = f.id === view.hideHeadOf && f.alive;
    c.b.Head.scale.setScalar(hideHead ? 0.001 : 1);

    // ---- death: the death clip plays facing the shot (baked in place), then the body dissolves ----
    if (c.dead && gun) gun.visible = false;
    // spawn protection glow
    c.mat.emissive.setRGB(0, 0, 0);
    if (f.spawnProtect > 0) c.mat.emissive.setRGB(0.35, 0.28, 0.02).multiplyScalar(0.5 + 0.5 * Math.sin(time * 14));
    c.root.updateMatrixWorld(true);
    c.b.Head.getWorldPosition(c.head);
    c.head.y += 0.12;
    void world;
  }
}

function smooth01(x: number) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
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
