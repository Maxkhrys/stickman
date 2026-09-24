import * as THREE from 'three';
import { WEAPONS } from '../config/weapons';
import { BODY, type Skeleton } from '../sim/body';
import type { Fighter } from '../sim/fighter';
import type { WeaponId } from '../sim/types';
import { v3, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';
import type { Effects } from './Effects';
import { makeBlobTexture } from './textures';
import { buildTpGuns } from './tpGuns';
import { toonGradient } from './vm/kit';
import { SAND, graphiteGrainMap, sandMaterial } from './sand';
import { STICK, StickAnim, type AnimView } from './anim/StickAnimator';
import { AnimDebug } from './anim/AnimDebug';

// ============================================================================
//  Instanced stick fighters. Every body part of every character goes through a
//  handful of InstancedMeshes (fill + ink outline), so 8 characters cost about
//  the same draw calls as 1. Each fighter owns a StickAnim that turns the
//  authoritative sim skeleton into a presentation pose (planted feet, weapon
//  IK, springs). Hitboxes never read the presentation pose.
// ============================================================================

type PrimId = 'sphere' | 'head' | 'cyl' | 'torus' | 'gun_ar' | 'gun_sniper' | 'gun_pistol' | 'gun_melee' | 'gun_smg' | 'gun_carbine';

const INK = new THREE.Color(0x0e0e14);
const WHITE = new THREE.Color(0xffffff);
const PROTECT = new THREE.Color(0xffd23f);
/** graphite body; a fighter's ink only tints it, the headband carries the full colour */
const GRAPHITE = new THREE.Color(0x202129);

/** Dark granular material a fighter's body turns into when it tears or collapses. */
export function dustColor(color: number): number {
  return new THREE.Color(0x26262e).lerp(new THREE.Color(color), 0.12).getHex();
}

class Batch {
  readonly fill: THREE.InstancedMesh;
  readonly line: THREE.InstancedMesh;
  n = 0;
  private m = new THREE.Matrix4();
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, max: number, lineMat: THREE.Material) {
    this.fill = new THREE.InstancedMesh(geo, mat, max);
    this.line = new THREE.InstancedMesh(geo, lineMat, max);
    for (const im of [this.fill, this.line]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
    }
    // allocate colour buffers
    this.fill.setColorAt(0, WHITE);
    this.line.setColorAt(0, INK);
  }
  add(p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, color: THREE.Color, ls: THREE.Vector3 | null, lineColor: THREE.Color) {
    if (this.n >= this.fill.instanceMatrix.count) return;
    this.m.compose(p, q, s);
    this.fill.setMatrixAt(this.n, this.m);
    this.fill.setColorAt(this.n, color);
    if (ls) this.m.compose(p, q, ls);
    else this.m.makeScale(0, 0, 0);
    this.line.setMatrixAt(this.n, this.m);
    this.line.setColorAt(this.n, lineColor);
    this.n++;
  }
  commit() {
    for (const im of [this.fill, this.line]) {
      im.count = this.n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.n = 0;
  }
}

interface Wound { bone: number; t: number; or: number; of: number; life: number; tick: number }

interface CharState {
  anim: StickAnim;
  /** the presented skeleton (render pose, or ragdoll joints once dead) */
  sk: Skeleton;
  hurtT: number;
  hurtX: number;
  hurtZ: number;
  dead: boolean;
  deadT: number;
  burst: boolean;
  rp: THREE.Vector3[];
  ro: THREE.Vector3[];
  rest: number[];
  headPop: boolean;
  wounds: Wound[];
  forming: number;
  deathDir: THREE.Vector3;
  deathPulse: number;
  weaponTick: number;
  /** last update() pass this fighter was posed in; a gap means the pose is stale */
  seen: number;
}

const J = ['pelvis', 'chest', 'neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle', 'lToe', 'rToe'] as const;
type JName = (typeof J)[number];
const JI: Record<JName, number> = Object.fromEntries(J.map((n, i) => [n, i])) as Record<JName, number>;
const LINKS: [JName, JName][] = [
  ['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['chest', 'lShoulder'], ['chest', 'rShoulder'], ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'], ['pelvis', 'lHip'], ['pelvis', 'rHip'], ['lHip', 'rHip'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lToe'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rToe'],
  ['lShoulder', 'pelvis'], ['rShoulder', 'pelvis'], ['head', 'chest'],
];

/** Bones that can carry a wound: [from, to, surface radius of the drawn stroke]. */
const BONES: [JName, JName, number][] = [
  ['pelvis', 'chest', 0.06], ['neck', 'head', 0.19],
  ['lShoulder', 'lElbow', 0.045], ['lElbow', 'lHand', 0.045], ['rShoulder', 'rElbow', 0.045], ['rElbow', 'rHand', 0.045],
  ['lHip', 'lKnee', 0.05], ['lKnee', 'lAnkle', 0.05], ['rHip', 'rKnee', 0.05], ['rKnee', 'rAnkle', 0.05],
];
const _fr = { r: new THREE.Vector3(), f: new THREE.Vector3(), ax: new THREE.Vector3() };
/** Orthonormal frame riding a bone: axis along the bone, right from the body frame projected off it. */
function boneFrame(sk: Skeleton, i: number) {
  const a = sk[BONES[i][0]] as Vec3, b = sk[BONES[i][1]] as Vec3;
  const ax = _fr.ax.set(b.x - a.x, b.y - a.y, b.z - a.z);
  if (ax.lengthSq() < 1e-8) ax.set(0, 1, 0);
  ax.normalize();
  const ref = i >= 6 ? sk.lowerRight : sk.upperRight;
  const r = _fr.r.set(ref.x, ref.y, ref.z);
  r.addScaledVector(ax, -r.dot(ax));
  if (r.lengthSq() < 1e-6) r.set(ax.y, -ax.x, 0);
  r.normalize();
  _fr.f.crossVectors(ax, r);
  return _fr;
}

const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const ts = new THREE.Vector3();
const tls = new THREE.Vector3();
const tc = new THREE.Color();
const tm = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const RING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const jp: Record<string, THREE.Vector3> = {};

function V(p: Vec3, out = new THREE.Vector3()) {
  return out.set(p.x, p.y, p.z);
}

function angleLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CharacterRenderer {
  readonly group = new THREE.Group();
  readonly debug = new AnimDebug();
  private batches = new Map<PrimId, Batch>();
  private shadows: THREE.InstancedMesh;
  private shadowN = 0;
  private chars = new Map<number, CharState>();
  private view: AnimView = {
    pos: v3(), vel: v3(), yaw: 0, pitch: 0, lowerYaw: 0, height: 1.8, gait: 0, onGround: true, sliding: false, ads: 0, alive: true,
  };
  private time = 0;
  private pass = 0;
  private lineT = 0.018;
  private camPos = new THREE.Vector3();
  private structure = 1;
  private body = new THREE.Color();
  private accent = new THREE.Color();
  private line = new THREE.Color();

  constructor(private effects: Effects, maxChars = 12) {
    const toonMat = () => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: SAND.enabled ? graphiteGrainMap() : null });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
    const guns = buildTpGuns();
    const gunMat = sandMaterial(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), vertexColors: true }));
    const defs: [PrimId, THREE.BufferGeometry, THREE.Material, number][] = [
      ['sphere', new THREE.SphereGeometry(1, 12, 9), toonMat(), 26],
      ['head', new THREE.SphereGeometry(1, 24, 16), toonMat(), 1],
      ['cyl', new THREE.CylinderGeometry(1, 1, 1, 10), toonMat(), 24],
      ['torus', new THREE.TorusGeometry(1, 0.2, 6, 20), toonMat(), 1],
      ['gun_ar', guns.ar, gunMat, 1],
      ['gun_sniper', guns.sniper, gunMat, 1],
      ['gun_pistol', guns.pistol, gunMat, 1],
      ['gun_melee', guns.melee, gunMat, 1],
      ['gun_smg', guns.smg, gunMat, 1],
      ['gun_carbine', guns.carbine, gunMat, 1],
    ];
    for (const [id, geo, mat, perChar] of defs) {
      const b = new Batch(geo, mat, perChar * maxChars, lineMat);
      this.batches.set(id, b);
      this.group.add(b.line, b.fill);
    }
    const blob = makeBlobTexture();
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      maxChars,
    );
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.group.add(this.shadows, this.debug.lines);
  }

  reset() {
    this.chars.clear();
  }

  /**
   * Attach to the bone segment that was hit: parameter along the bone plus an offset in a frame that
   * bends and twists with that bone, so wounds stay on the limb through elbows, knees, runs and slides.
   */
  wound(id: number, pos: Vec3, _yaw: number) {
    if (!SAND.enabled) return;
    const c = this.chars.get(id);
    if (!c || c.dead) return;
    let bone = 0, bestT = 0, best = Infinity;
    for (let i = 0; i < BONES.length; i++) {
      const a = c.sk[BONES[i][0]] as Vec3, b = c.sk[BONES[i][1]] as Vec3;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz || 1e-6;
      const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (pos.y - a.y) * aby + (pos.z - a.z) * abz) / len2));
      const d = (a.x + abx * t - pos.x) ** 2 + (a.y + aby * t - pos.y) ** 2 + (a.z + abz * t - pos.z) ** 2;
      if (d < best) { best = d; bone = i; bestT = t; }
    }
    const fr = boneFrame(c.sk, bone);
    const a = c.sk[BONES[bone][0]] as Vec3, b = c.sk[BONES[bone][1]] as Vec3;
    const ox = pos.x - (a.x + (b.x - a.x) * bestT), oy = pos.y - (a.y + (b.y - a.y) * bestT), oz = pos.z - (a.z + (b.z - a.z) * bestT);
    let or = ox * fr.r.x + oy * fr.r.y + oz * fr.r.z, of = ox * fr.f.x + oy * fr.f.y + oz * fr.f.z;
    // sit on the limb surface, never floating off it
    const rad = Math.hypot(or, of), maxR = BONES[bone][2];
    if (rad > maxR) { or *= maxR / rad; of *= maxR / rad; }
    if (c.wounds.length >= SAND.maxWounds) c.wounds.shift();
    c.wounds.push({ bone, t: bestT, or, of, life: SAND.woundLife, tick: 0 });
  }

  /** Current world position of a wound on the posed skeleton. */
  woundPos(c: CharState, w: Wound, out: THREE.Vector3) {
    const fr = boneFrame(c.sk, w.bone);
    const a = c.sk[BONES[w.bone][0]] as Vec3, b = c.sk[BONES[w.bone][1]] as Vec3;
    return out.set(
      a.x + (b.x - a.x) * w.t + fr.r.x * w.or + fr.f.x * w.of,
      a.y + (b.y - a.y) * w.t + fr.r.y * w.or + fr.f.y * w.of,
      a.z + (b.z - a.z) * w.t + fr.r.z * w.or + fr.f.z * w.of,
    );
  }

  private stateOf(f: Fighter): CharState {
    let c = this.chars.get(f.id);
    if (!c) {
      const anim = new StickAnim();
      c = {
        anim,
        sk: anim.pose,
        hurtT: 0,
        hurtX: 0,
        hurtZ: 0,
        dead: false,
        deadT: 0,
        burst: false,
        rp: [],
        ro: [],
        rest: [],
        headPop: false,
        wounds: [], forming: 0, deathDir: new THREE.Vector3(), deathPulse: 0, weaponTick: 0,
        seen: -1,
      };
      this.chars.set(f.id, c);
    }
    return c;
  }

  /** Animation state of a fighter (debug readout). */
  animOf(id: number): StickAnim | null {
    return this.chars.get(id)?.anim ?? null;
  }

  hurt(id: number, dirX: number, dirZ: number) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hurtT = 0.22;
    c.hurtX = dirX;
    c.hurtZ = dirZ;
    c.anim.hurt(dirX, dirZ);
  }

  /** Death: short physical collapse of the presented pose, then the body falls apart into grit. */
  kill(f: Fighter, dir: Vec3, headshot: boolean) {
    const c = this.stateOf(f);
    if (c.dead) return;
    c.dead = true;
    c.deadT = 0;
    c.burst = false;
    c.headPop = headshot;
    c.wounds.length = 0;
    c.deathDir.set(dir.x, dir.y, dir.z);
    c.deathPulse = 0;
    const sk = c.sk;
    c.rp = J.map((n) => V(sk[n] as Vec3));
    const imp = new THREE.Vector3(dir.x, Math.max(0.2, dir.y), dir.z).multiplyScalar(5);
    c.ro = c.rp.map((p, i) => {
      const upper = i <= JI.rHand ? 1 : 0.35;
      const vel = new THREE.Vector3(f.vel.x, f.vel.y, f.vel.z).multiplyScalar(0.8).addScaledVector(imp, upper);
      if (headshot && i === JI.head) vel.set(dir.x * 3, 6.5, dir.z * 3);
      return p.clone().addScaledVector(vel, -1 / 60);
    });
    c.rest = LINKS.map(([a, b]) => c.rp[JI[a]].distanceTo(c.rp[JI[b]]));
  }

  private emit(prim: PrimId, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, color: THREE.Color, outline: 'uniform' | 'cyl' | 'none', line: THREE.Color) {
    const t = this.lineT;
    if (SAND.enabled && this.structure < 1) s.multiplyScalar(this.structure);
    let ls: THREE.Vector3 | null = null;
    if (outline === 'uniform') ls = tls.set(s.x + t, s.y + t, s.z + t);
    else if (outline === 'cyl') ls = tls.set(s.x + t, s.y + 0.001, s.z + t);
    this.batches.get(prim)!.add(p, q, s, color, ls, line);
  }

  /** A limb stroke: cylinder a->b. Pair with ball() at the joints so strokes read continuous. */
  private limb(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color, line: THREE.Color) {
    const len = a.distanceTo(b);
    tv.addVectors(a, b).multiplyScalar(0.5);
    tv2.subVectors(b, a);
    if (len > 1e-5) tq.setFromUnitVectors(Y, tv2.divideScalar(len));
    else tq.identity();
    this.emit('cyl', tv, tq, ts.set(r, len, r), color, 'cyl', line);
  }

  private ball(p: THREE.Vector3, r: number, color: THREE.Color, line: THREE.Color, outline = true) {
    this.emit('sphere', p, tq.identity(), ts.set(r, r, r), color, outline ? 'uniform' : 'none', line);
  }

  update(dt: number, fighters: readonly Fighter[], alpha: number, time: number, viewerId: number, world: World, camera: THREE.Camera) {
    const dbg = this.debug;
    const frozen = dbg.flags.freeze;
    this.time += dt;
    this.pass++;
    camera.getWorldPosition(this.camPos);
    dbg.begin();
    let shadowN = 0;
    for (const f of fighters) {
      const c = this.stateOf(f);
      const firstPerson = f.id === viewerId && f.alive;
      if (f.alive && c.dead) {
        c.dead = false;
        c.burst = false;
        c.forming = 0.28;
        c.wounds.length = 0;
        c.sk = c.anim.pose;
        c.anim.reset();
      }
      c.forming = Math.max(0, c.forming - dt);
      c.hurtT = Math.max(0, c.hurtT - dt);
      if (!f.alive && !c.dead) this.kill(f, { x: 0, y: 0, z: 0 }, false);
      const dust = dustColor(f.color);
      if (c.dead) {
        this.stepRagdoll(c, dt, world);
        if (SAND.enabled && c.deadT > 0.12 && c.deadT < SAND.collapseTime && c.deadT - c.deathPulse > 0.105) {
          c.deathPulse = c.deadT;
          const source = c.rp[c.headPop ? JI.head : JI.chest];
          const point = source.clone().lerp(c.rp[JI.pelvis], c.deadT / SAND.collapseTime * 0.65);
          if (c.deathPulse < 0.2) this.effects.sandPile(c.rp[JI.pelvis], dust, c.deathDir);
          this.effects.sandBurst(point, dust, 14, 2.6, c.deathDir, SAND.pileLife, 1.7);
        }
        if (!c.burst && c.deadT > SAND.collapseTime) {
          c.burst = true;
          const center = c.rp[JI.chest].clone().lerp(c.rp[JI.pelvis], 0.5);
          if (SAND.enabled) this.effects.sandBurst(center, dust, 34, 2.4, c.deathDir, SAND.pileLife, 1.7);
          else {
            this.effects.burst(center, f.color, 26, 5.5, 0.09, 0.7, 1);
            this.effects.burst(center, 0x14141c, 24, 6, 0.06, 0.6, 1);
          }
        }
        if (c.burst) continue;
        c.sk = c.anim.pose;
        this.fromRagdoll(c);
      } else {
        if (firstPerson) continue;
        // a fighter that was hidden (first person) or skipped re-snaps instead of animating from a stale pose
        if (c.seen !== this.pass - 1) c.anim.reset();
        c.seen = this.pass;
        if (!frozen) this.pose(f, c, alpha, time, dt, world);
        if (dbg.active) dbg.add(c.anim);
        if (SAND.enabled && !frozen) {
          c.weaponTick += dt;
          if (c.weaponTick > 0.075 && (f.switchTimer > 0 || f.reloadTimer > 0)) {
            c.weaponTick = 0;
            const hand = c.sk.rHand;
            this.effects.sandBurst(new THREE.Vector3(hand.x, hand.y, hand.z), dust, 3, 0.35, undefined, 0.28);
          }
          for (const w of c.wounds) {
            w.life -= dt;
            w.tick += dt;
            if (w.tick < SAND.trickleInterval || w.life <= 0) continue;
            w.tick = 0;
            const p = this.woundPos(c, w, new THREE.Vector3());
            this.effects.sandBurst(p, dust, 2, 0.48, undefined, 1.2);
          }
          c.wounds = c.wounds.filter((w) => w.life > 0);
        }
      }
      // line thickness grows with distance so the figure reads as a drawn stroke far away
      const d = this.camPos.distanceTo(V(c.sk.pelvis, tv));
      this.lineT = Math.min(0.05, Math.max(0.013, d * 0.0024));
      const protectedPulse = f.spawnProtect > 0 ? 0.5 + 0.5 * Math.sin(this.time * 14) : 0;
      this.line.copy(INK).lerp(PROTECT, protectedPulse);
      this.structure = SAND.enabled ? c.dead ? Math.max(0.06, 1 - Math.max(0, c.deadT - 0.17) / (SAND.collapseTime - 0.17)) : 1 - c.forming / 0.28 * 0.72 : 1;
      if (!dbg.flags.hideBody) this.drawBody(f, c, this.line);
      this.structure = 1;
      if (!c.dead) {
        const floor = world.surfaceBelow(c.sk.pelvis.x, c.sk.pelvis.z, 0.2, f.pos.y + 0.1);
        const above = f.pos.y - floor;
        const sc = Math.max(0.4, 0.85 - above * 0.22);
        tm.compose(tv.set(c.sk.pelvis.x, floor + 0.015, c.sk.pelvis.z), tq.identity(), ts.set(sc, 1, sc));
        this.shadows.setMatrixAt(shadowN++, tm);
      }
    }
    for (const b of this.batches.values()) b.commit();
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadowN = shadowN;
    dbg.commit();
    for (const [id] of this.chars) if (!fighters.some((f) => f.id === id)) this.chars.delete(id);
  }

  private pose(f: Fighter, c: CharState, a: number, time: number, dt: number, world: World) {
    const v = this.view;
    v.pos.x = f.prevPos.x + (f.pos.x - f.prevPos.x) * a;
    v.pos.y = f.prevPos.y + (f.pos.y - f.prevPos.y) * a;
    v.pos.z = f.prevPos.z + (f.pos.z - f.prevPos.z) * a;
    v.vel.x = f.vel.x;
    v.vel.y = f.vel.y;
    v.vel.z = f.vel.z;
    v.yaw = angleLerp(f.prevYaw, f.yaw, a);
    v.pitch = f.prevPitch + (f.pitch - f.prevPitch) * a;
    v.lowerYaw = angleLerp(f.prevLowerYaw, f.lowerYaw, a);
    v.height = f.prevHeight + (f.height - f.prevHeight) * a;
    v.gait = angleLerp(f.prevGait, f.gait, a);
    v.onGround = f.onGround;
    v.sliding = f.sliding;
    v.ads = f.prevAds + (f.ads - f.prevAds) * a;
    v.alive = f.alive;
    c.anim.update(f, v, dt, time, world);
    c.sk = c.anim.pose;
  }

  private drawBody(f: Fighter, c: CharState, line: THREE.Color) {
    const sk = c.sk;
    const body = this.body.copy(GRAPHITE).lerp(tc.set(f.color), 0.025);
    if (c.hurtT > 0.1) body.lerp(WHITE, 0.55 * (c.hurtT - 0.1) / 0.12);
    const accent = this.accent.set(f.color);
    for (const n of J) jp[n] = V(sk[n] as Vec3, jp[n] ?? new THREE.Vector3());
    const mid = c.dead ? tv3.copy(jp.pelvis).lerp(jp.chest, 0.5) : c.anim.spineMid;
    const S = STICK;

    // spine: pelvis -> mid -> chest -> neck, one continuous stroke
    this.limb(jp.pelvis, mid, S.spineR, body, line);
    this.limb(mid, jp.chest, S.spineR, body, line);
    this.limb(jp.chest, jp.head, S.spineR * 0.8, body, line);
    this.ball(jp.pelvis, S.spineR, body, line);
    this.ball(mid, S.spineR, body, line);
    this.ball(jp.chest, S.spineR, body, line);
    // head
    const qH = c.dead ? tq2.setFromUnitVectors(Y, V(sk.headUp, tv)) : tq2.copy(c.anim.headQuat);
    this.emit('head', jp.head, qH, ts.set(S.headR, S.headR, S.headR), body, 'uniform', line);
    if (!c.dead || !c.headPop) this.headband(c, jp.head, qH, accent, line);
    // arms: clavicle, upper arm, forearm, hand
    for (const side of [0, 1]) {
      const sh = side ? jp.rShoulder : jp.lShoulder, el = side ? jp.rElbow : jp.lElbow, ha = side ? jp.rHand : jp.lHand;
      this.limb(jp.chest, sh, S.armR, body, line);
      this.ball(sh, S.armR, body, line);
      this.limb(sh, el, S.armR, body, line);
      this.ball(el, S.armR, body, line);
      this.limb(el, ha, S.armR, body, line);
      this.ball(ha, S.handR, body, line);
    }
    // legs: hip, thigh, shin, foot
    for (const side of [0, 1]) {
      const hip = side ? jp.rHip : jp.lHip, kn = side ? jp.rKnee : jp.lKnee, an = side ? jp.rAnkle : jp.lAnkle, to = side ? jp.rToe : jp.lToe;
      this.limb(jp.pelvis, hip, S.legR, body, line);
      this.ball(hip, S.legR, body, line);
      this.limb(hip, kn, S.legR, body, line);
      this.ball(kn, S.legR, body, line);
      this.limb(kn, an, S.legR * 0.94, body, line);
      this.ball(an, S.legR * 0.94, body, line);
      this.limb(an, to, S.footR, body, line);
      this.ball(to, S.footR, body, line);
    }
    // third-person weapon in the hands
    if (!c.dead && c.anim.showGun) {
      const w = f.weapons[f.cur].id as WeaponId;
      const formed = SAND.enabled ? Math.max(0.16, 1 - Math.min(1, f.switchTimer / Math.max(0.01, WEAPONS[w].drawTime)) * 0.84) : 1;
      this.emit(`gun_${w}` as PrimId, c.anim.gunPos, c.anim.gunQuat, ts.set(formed, formed, formed), WHITE, 'uniform', line);
    }
  }

  /** Player-ink headband with two trailing tails: the one splash of colour on a graphite fighter. */
  private headband(c: CharState, head: THREE.Vector3, qH: THREE.Quaternion, accent: THREE.Color, line: THREE.Color) {
    const r = STICK.headR;
    tq.copy(qH).multiply(RING);
    tv3.set(0, 0.055, 0).applyQuaternion(qH).add(head);
    this.emit('torus', tv3, tq, ts.set(r * 1.02, r * 1.02, r * 0.9), accent, 'uniform', line);
    if (c.dead) return;
    for (const tail of c.anim.tails) {
      for (let i = 1; i < tail.length; i++) {
        this.limb(tail[i - 1], tail[i], 0.02, accent, line);
        this.ball(tail[i], 0.02, accent, line);
      }
    }
  }

  private stepRagdoll(c: CharState, dt: number, world: World) {
    c.deadT += dt;
    const P = c.rp, O = c.ro;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      const g = -22 * h * h;
      for (let i = 0; i < P.length; i++) {
        const p = P[i], o = O[i];
        const vx = (p.x - o.x) * 0.99, vy = (p.y - o.y) * 0.99, vz = (p.z - o.z) * 0.99;
        o.copy(p);
        p.x += vx;
        p.y += vy + g;
        p.z += vz;
      }
      for (let it = 0; it < 4; it++) {
        LINKS.forEach(([a, b], li) => {
          if (c.headPop && (a === 'head' || b === 'head')) return;
          const pa = P[JI[a]], pb = P[JI[b]];
          tv.subVectors(pb, pa);
          const d = tv.length() || 1e-4;
          const diff = (d - c.rest[li]) / d / 2;
          pa.addScaledVector(tv, diff);
          pb.addScaledVector(tv, -diff);
        });
        for (let i = 0; i < P.length; i++) {
          const p = P[i];
          const r = i === JI.head ? BODY.headR : 0.06;
          const floor = world.surfaceBelow(p.x, p.z, 0.02, p.y + 0.4) + r;
          if (p.y < floor) {
            p.y = floor;
            const o = O[i];
            o.x = p.x - (p.x - o.x) * 0.6;
            o.z = p.z - (p.z - o.z) * 0.6;
          }
        }
      }
    }
  }

  /** Rebuild skeleton frames from ragdoll joints so the same body drawing code applies. */
  private fromRagdoll(c: CharState) {
    const sk = c.sk;
    J.forEach((n, i) => {
      const p = c.rp[i];
      const t = sk[n] as Vec3;
      t.x = p.x;
      t.y = p.y;
      t.z = p.z;
    });
    const up = tv.set(sk.chest.x - sk.pelvis.x, sk.chest.y - sk.pelvis.y, sk.chest.z - sk.pelvis.z).normalize();
    sk.spineUp.x = up.x;
    sk.spineUp.y = up.y;
    sk.spineUp.z = up.z;
    const r = tv2.set(sk.rShoulder.x - sk.lShoulder.x, sk.rShoulder.y - sk.lShoulder.y, sk.rShoulder.z - sk.lShoulder.z).normalize();
    sk.upperRight.x = r.x;
    sk.upperRight.y = r.y;
    sk.upperRight.z = r.z;
    const lr = tv2.set(sk.rHip.x - sk.lHip.x, sk.rHip.y - sk.lHip.y, sk.rHip.z - sk.lHip.z).normalize();
    sk.lowerRight.x = lr.x;
    sk.lowerRight.y = lr.y;
    sk.lowerRight.z = lr.z;
    const f = new THREE.Vector3().crossVectors(up, r);
    sk.upperFwd.x = f.x;
    sk.upperFwd.y = f.y;
    sk.upperFwd.z = f.z;
    sk.headUp.x = up.x;
    sk.headUp.y = up.y;
    sk.headUp.z = up.z;
  }

  /** Head position for effects (head pop, name tags). */
  headOf(id: number): THREE.Vector3 | null {
    const c = this.chars.get(id);
    if (!c) return null;
    return V(c.sk.head);
  }

  get shadowCount() {
    return this.shadowN;
  }
}
