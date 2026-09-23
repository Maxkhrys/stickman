import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '../config/weapons';
import { BODY, buildSkeleton, createSkeleton, ik, type BodyState, type Skeleton } from '../sim/body';
import type { Fighter } from '../sim/fighter';
import type { WeaponId } from '../sim/types';
import { v3, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';
import type { Effects } from './Effects';
import { makeBlobTexture } from './textures';
import { buildTpGuns } from './tpGuns';
import { toonGradient } from './vm/kit';
import { SAND, sandMaterial } from './sand';

// ============================================================================
//  Instanced characters. Every body part of every character goes through a
//  handful of InstancedMeshes (fill + ink outline), so 8 characters cost about
//  the same draw calls as 1. Pose comes from the shared sim skeleton, so the
//  drawn body matches the hitboxes; cosmetic layers (breathing, kick, flinch,
//  reload hand, landing squash) sit on top.
// ============================================================================

type PrimId = 'sphere' | 'head' | 'cyl' | 'torso' | 'box' | 'dome' | 'torus' | 'gun_ar' | 'gun_sniper' | 'gun_pistol' | 'gun_melee' | 'gun_smg' | 'gun_carbine';

const INK = new THREE.Color(0x14141c);
const WHITE = new THREE.Color(0xffffff);
const PROTECT = new THREE.Color(0xffd23f);

interface Outfit {
  body: number;
  pants: number;
  acc: 'cap' | 'headband' | 'beanie' | 'scarf' | 'backpack' | 'tuft';
  backpack: boolean;
}
const OUTFITS: Outfit[] = [
  { body: 0x2b2d42, pants: 0x1e1f2e, acc: 'cap', backpack: false },
  { body: 0x33343f, pants: 0x22232b, acc: 'headband', backpack: true },
  { body: 0x3a2d5c, pants: 0x241c3a, acc: 'beanie', backpack: false },
  { body: 0x1f3f47, pants: 0x162d33, acc: 'scarf', backpack: false },
  { body: 0x1b1b24, pants: 0x121218, acc: 'cap', backpack: true },
  { body: 0x28324f, pants: 0x1a2136, acc: 'tuft', backpack: false },
];

function taperedBox(): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 0.84 + (y + 0.5) * 0.16; // narrower at the waist
    p.setX(i, p.getX(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function makeFaceTexture(): THREE.Texture {
  // plain head colour with brows + mouth drawn around u = 0.75 (the -Z side of a three.js sphere)
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#14141c';
  g.lineCap = 'round';
  g.lineWidth = 5;
  // brows
  g.beginPath();
  g.moveTo(176, 40);
  g.lineTo(186, 44);
  g.moveTo(198, 44);
  g.lineTo(208, 40);
  g.stroke();
  // grin
  g.lineWidth = 4;
  g.beginPath();
  g.arc(192, 66, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

/** Interpolated per-frame view of a fighter (BodyState + render extras). */
interface ViewState extends BodyState {
  alive: boolean;
}

interface CharState {
  sk: Skeleton;
  outfit: Outfit;
  head: THREE.Color;
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
  blinkT: number;
  wounds: { bone: number; t: number; or: number; of: number; life: number; tick: number }[];
  forming: number;
  deathDir: THREE.Vector3;
  deathPulse: number;
  weaponTick: number;
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

/** Bones that can carry a wound: [from, to, surface radius]. */
const BONES: [JName, JName, number][] = [
  ['pelvis', 'chest', 0.2], ['neck', 'head', 0.2],
  ['lShoulder', 'lElbow', 0.07], ['lElbow', 'lHand', 0.065], ['rShoulder', 'rElbow', 0.07], ['rElbow', 'rHand', 0.065],
  ['lHip', 'lKnee', 0.09], ['lKnee', 'lAnkle', 0.08], ['rHip', 'rKnee', 0.09], ['rKnee', 'rAnkle', 0.08],
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
const tq = new THREE.Quaternion();
const ts = new THREE.Vector3();
const tls = new THREE.Vector3();
const tc = new THREE.Color();
const tm = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();

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
  private batches = new Map<PrimId, Batch>();
  private shadows: THREE.InstancedMesh;
  private shadowN = 0;
  private chars = new Map<number, CharState>();
  private view: ViewState = {
    pos: v3(), vel: v3(), yaw: 0, pitch: 0, lowerYaw: 0, height: 1.8, gait: 0, onGround: true, sliding: false, ads: 0, alive: true,
  };
  private time = 0;
  private lineT = 0.018;
  private camPos = new THREE.Vector3();
  private structure = 1;

  constructor(private effects: Effects, maxChars = 12) {
    const toonMat = () => sandMaterial(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() }));
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
    const guns = buildTpGuns();
    const face = makeFaceTexture();
    const headMat = sandMaterial(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), map: face }));
    const gunMat = sandMaterial(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), vertexColors: true }));
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
    const dome = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const defs: [PrimId, THREE.BufferGeometry, THREE.Material, number][] = [
      ['sphere', new THREE.SphereGeometry(1, 12, 9), toonMat(), 20],
      ['head', new THREE.SphereGeometry(1, 20, 14), headMat, 1],
      ['cyl', cyl, toonMat(), 10],
      ['torso', taperedBox(), toonMat(), 1],
      ['box', new RoundedBoxGeometry(1, 1, 1, 2, 0.18), toonMat(), 6],
      ['dome', dome, toonMat(), 2],
      ['torus', new THREE.TorusGeometry(1, 0.2, 6, 16), toonMat(), 1],
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
    this.group.add(this.shadows);
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
  woundPos(c: CharState, w: CharState['wounds'][number], out: THREE.Vector3) {
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
      c = {
        sk: createSkeleton(),
        outfit: OUTFITS[f.outfit % OUTFITS.length],
        head: new THREE.Color(f.color),
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
        blinkT: Math.random() * 4,
        wounds: [], forming: 0, deathDir: new THREE.Vector3(), deathPulse: 0, weaponTick: 0,
      };
      this.chars.set(f.id, c);
    }
    return c;
  }

  hurt(id: number, dirX: number, dirZ: number) {
    const c = this.chars.get(id);
    if (!c) return;
    c.hurtT = 0.22;
    c.hurtX = dirX;
    c.hurtZ = dirZ;
  }

  /** Death: short physical collapse, then an ink burst. */
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

  private emit(prim: PrimId, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, color: THREE.Color, outline: 'uniform' | 'box' | 'cyl' | 'none', line: THREE.Color) {
    const t = this.lineT;
    if (SAND.enabled && this.structure < 1) s.multiplyScalar(this.structure);
    let ls: THREE.Vector3 | null = null;
    if (outline === 'uniform') ls = tls.set(s.x + t, s.y + t, s.z + t);
    else if (outline === 'box') ls = tls.set(s.x + 2 * t, s.y + 2 * t, s.z + 2 * t);
    else if (outline === 'cyl') ls = tls.set(s.x + t, s.y + 0.001, s.z + t);
    this.batches.get(prim)!.add(p, q, s, color, ls, line);
  }

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

  /** orientation from right + up vectors (forward = -z) */
  private basis(right: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion) {
    by.copy(up).normalize();
    bx.copy(right).addScaledVector(by, -right.dot(by)).normalize();
    bz.crossVectors(bx, by);
    tm.makeBasis(bx, by, bz);
    return out.setFromRotationMatrix(tm);
  }

  update(dt: number, fighters: readonly Fighter[], alpha: number, time: number, viewerId: number, world: World, camera: THREE.Camera) {
    this.time += dt;
    camera.getWorldPosition(this.camPos);
    let shadowN = 0;
    for (const f of fighters) {
      const c = this.stateOf(f);
      const firstPerson = f.id === viewerId && f.alive;
      if (f.alive && c.dead) {
        c.dead = false;
        c.burst = false;
        c.forming = 0.28;
        c.wounds.length = 0;
      }
      c.forming = Math.max(0, c.forming - dt);
      c.hurtT = Math.max(0, c.hurtT - dt);
      if (!f.alive && !c.dead) this.kill(f, { x: 0, y: 0, z: 0 }, false);
      if (c.dead) {
        this.stepRagdoll(c, dt, world);
        if (SAND.enabled && c.deadT > 0.12 && c.deadT < SAND.collapseTime && c.deadT - c.deathPulse > 0.105) {
          c.deathPulse = c.deadT;
          const source = c.rp[c.headPop ? JI.head : JI.chest];
          const point = source.clone().lerp(c.rp[JI.pelvis], c.deadT / SAND.collapseTime * 0.65);
          if (c.deathPulse < 0.2) this.effects.sandPile(c.rp[JI.pelvis], f.color, c.deathDir);
          this.effects.sandBurst(point, f.color, 14, 2.6, c.deathDir, SAND.pileLife, 1.7);
        }
        if (!c.burst && c.deadT > SAND.collapseTime) {
          c.burst = true;
          const center = c.rp[JI.chest].clone().lerp(c.rp[JI.pelvis], 0.5);
          if (SAND.enabled) this.effects.sandBurst(center, f.color, 34, 2.4, c.deathDir, SAND.pileLife, 1.7);
          else {
            this.effects.burst(center, f.color, 26, 5.5, 0.09, 0.7, 1);
            this.effects.burst(center, c.outfit.body, 20, 4.5, 0.08, 0.7, 1);
            this.effects.burst(center, 0x14141c, 14, 6, 0.06, 0.6, 1);
          }
        }
        if (c.burst) continue;
        this.fromRagdoll(c);
      } else {
        if (firstPerson) continue;
        this.pose(f, c, alpha, time);
        if (SAND.enabled) {
          c.weaponTick += dt;
          if (c.weaponTick > 0.075 && (f.switchTimer > 0 || f.reloadTimer > 0)) {
            c.weaponTick = 0;
            const hand = c.sk.rHand;
            this.effects.sandBurst(new THREE.Vector3(hand.x, hand.y, hand.z), f.color, 3, 0.35, undefined, 0.28);
          }
        }
        if (SAND.enabled) for (const w of c.wounds) {
          w.life -= dt;
          w.tick += dt;
          if (w.tick < SAND.trickleInterval || w.life <= 0) continue;
          w.tick = 0;
          const p = this.woundPos(c, w, new THREE.Vector3());
          this.effects.sandBurst(p, f.color, 2, 0.48, undefined, 1.2);
        }
        c.wounds = c.wounds.filter((w) => w.life > 0);
      }
      // line thickness grows with distance so outlines stay readable
      const d = this.camPos.distanceTo(V(c.sk.pelvis, tv));
      this.lineT = Math.min(0.045, Math.max(0.014, d * 0.0021));
      const protectedPulse = f.spawnProtect > 0 ? 0.5 + 0.5 * Math.sin(this.time * 14) : 0;
      const line = tc.copy(INK).lerp(PROTECT, protectedPulse);
      this.structure = SAND.enabled ? c.dead ? Math.max(0.06, 1 - Math.max(0, c.deadT - 0.17) / (SAND.collapseTime - 0.17)) : 1 - c.forming / 0.28 * 0.72 : 1;
      this.drawBody(f, c, line.clone(), time);
      this.structure = 1;
      if (!c.dead) {
        const floor = world.surfaceBelow(c.sk.pelvis.x, c.sk.pelvis.z, 0.2, f.pos.y + 0.1);
        const above = f.pos.y - floor;
        const sc = Math.max(0.45, 1.05 - above * 0.25);
        tm.compose(tv.set(c.sk.pelvis.x, floor + 0.015, c.sk.pelvis.z), tq.identity(), ts.set(sc, 1, sc));
        this.shadows.setMatrixAt(shadowN++, tm);
      }
    }
    for (const b of this.batches.values()) b.commit();
    this.shadows.count = shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadowN = shadowN;
    for (const [id] of this.chars) if (!fighters.some((f) => f.id === id)) this.chars.delete(id);
  }

  private pose(f: Fighter, c: CharState, a: number, time: number) {
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
    const w = f.weapons[f.cur].id;
    const sk = buildSkeleton(v, w, c.sk);

    // ---- cosmetic layers ----
    const upper: JName[] = ['chest', 'neck', 'head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lHand', 'rHand'];
    // breathing when idle
    const breathe = Math.sin(this.time * 1.9 + f.id) * 0.007 * (1 - sk.moveAmp);
    for (const n of upper) (sk[n] as Vec3).y += breathe;
    // landing squash
    const sinceLand = time - f.lastLandTime;
    const squash = sinceLand >= 0 && sinceLand < 0.4 ? Math.exp(-sinceLand / 0.1) * Math.min(1, f.lastLandSpeed / 12) * 0.09 : 0;
    if (squash > 0.001) {
      for (const n of ['pelvis', 'lHip', 'rHip', ...upper] as JName[]) (sk[n] as Vec3).y -= squash;
      ik(sk.lHip, sk.lAnkle, BODY.thigh, BODY.shin, sk.lowerFwd.x, 0.05, sk.lowerFwd.z, sk.lKnee);
      ik(sk.rHip, sk.rAnkle, BODY.thigh, BODY.shin, sk.lowerFwd.x, 0.05, sk.lowerFwd.z, sk.rKnee);
    }
    // weapon handling: fire kick, draw, reload hand
    const def = WEAPONS[w];
    const sinceShot = time - f.lastShotTime;
    const kick = sinceShot >= 0 && sinceShot < 0.3 ? Math.exp(-sinceShot / (w === 'sniper' ? 0.1 : 0.05)) * (w === 'sniper' ? 0.09 : 0.045) : 0;
    const draw = def.drawTime > 0 ? Math.min(1, f.switchTimer / def.drawTime) : 0;
    const A = sk.aimDir;
    for (const h of [sk.rHand, sk.lHand]) {
      h.x -= A.x * kick;
      h.y -= A.y * kick - kick * 0.4 - draw * 0.25;
      h.z -= A.z * kick;
    }
    if (f.reloadTimer > 0 && def.reloadTime > 0) {
      const p = 1 - f.reloadTimer / def.reloadTime;
      // support hand drops to the magazine, pulls it, brings a new one up
      const toMag = Math.min(1, p / 0.12) * (1 - Math.max(0, (p - 0.8) / 0.2));
      const dip = Math.sin(Math.min(1, Math.max(0, (p - 0.2) / 0.45)) * Math.PI) * 0.22;
      const mx = sk.rHand.x + A.x * 0.12, my = sk.rHand.y - 0.1 - dip, mz = sk.rHand.z + A.z * 0.12;
      sk.lHand.x += (mx - sk.lHand.x) * toMag;
      sk.lHand.y += (my - sk.lHand.y) * toMag;
      sk.lHand.z += (mz - sk.lHand.z) * toMag;
    }
    // hit flinch: upper body snaps away from the shot
    if (c.hurtT > 0) {
      const k = (c.hurtT / 0.22) * 0.12;
      for (const n of upper) {
        const p = sk[n] as Vec3;
        p.x += c.hurtX * k;
        p.z += c.hurtZ * k;
      }
    }
    // melee swing arc
    if (w === 'melee') {
      const mt = time - f.lastMeleeTime;
      if (mt >= 0 && mt < 0.35) {
        const s = Math.sin((mt / 0.35) * Math.PI);
        sk.rHand.x += (sk.upperFwd.x * 0.35 - sk.upperRight.x * 0.3) * s;
        sk.rHand.y += 0.15 * s;
        sk.rHand.z += (sk.upperFwd.z * 0.35 - sk.upperRight.z * 0.3) * s;
      }
    }
    // elbows follow the (possibly moved) hands
    ik(sk.rShoulder, sk.rHand, BODY.upperArm, BODY.forearm, sk.upperRight.x * 0.7 - A.x * 0.3, -1, sk.upperRight.z * 0.7 - A.z * 0.3, sk.rElbow);
    ik(sk.lShoulder, sk.lHand, BODY.upperArm, BODY.forearm, -sk.upperRight.x * 0.7 - A.x * 0.3, -1, -sk.upperRight.z * 0.7 - A.z * 0.3, sk.lElbow);
  }

  private drawBody(f: Fighter, c: CharState, line: THREE.Color, time: number) {
    const sk = c.sk;
    const o = c.outfit;
    const body = tc.set(SAND.enabled ? f.color : o.body).clone().multiplyScalar(SAND.enabled ? 0.73 : 1);
    const pants = new THREE.Color(SAND.enabled ? f.color : o.pants).multiplyScalar(SAND.enabled ? 0.58 : 1);
    const glove = new THREE.Color(SAND.enabled ? f.color : 0xfbfbf7).multiplyScalar(SAND.enabled ? 0.92 : 1);
    const head = c.head.clone();
    if (c.hurtT > 0.12) head.lerp(WHITE, 0.75);
    const accent = c.head.clone();
    const P = (n: JName, out = new THREE.Vector3()) => V(sk[n] as Vec3, out);
    const pel = P('pelvis'), chest = P('chest'), neck = P('neck'), hd = P('head');
    const up = V(sk.spineUp, new THREE.Vector3());
    const upR = V(sk.upperRight, new THREE.Vector3());
    const loR = V(sk.lowerRight, new THREE.Vector3());

    // torso (hoodie) from just above the pelvis to the chest
    const tBot = pel.clone().addScaledVector(up, 0.02);
    const tLen = tBot.distanceTo(chest) + 0.03;
    const tMid = tBot.clone().add(chest).multiplyScalar(0.5);
    const qT = this.basis(upR, up, new THREE.Quaternion());
    this.emit('torso', tMid, qT, ts.set(0.42, tLen, 0.25), body, 'box', line);
    // accent stripe across the chest
    this.emit('box', chest.clone().addScaledVector(up, -0.12).addScaledVector(V(sk.upperFwd, tv2), 0.118), qT, ts.set(0.3, 0.05, 0.03), accent, 'none', line);
    // shorts / hips
    const qP = this.basis(loR, up, new THREE.Quaternion());
    this.emit('box', pel.clone().addScaledVector(up, -0.02), qP, ts.set(0.36, 0.17, 0.23), pants, 'box', line);
    // neck
    this.limb(chest, neck, 0.06, head, line);
    // head (+ face on the -Z side) oriented by aim
    const qH = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.alive ? f.pitch * 0.55 : 0.3, f.alive ? f.yaw : 0, 0, 'YXZ'));
    if (!c.dead) qH.setFromEuler(new THREE.Euler(f.pitch * 0.55, f.yaw, 0, 'YXZ'));
    else this.basis(upR, V(sk.headUp, new THREE.Vector3()), qH);
    {
      this.emit('head', hd, qH, ts.set(BODY.headR, BODY.headR, BODY.headR), head, 'uniform', line);
      // eyes: white sclera + ink pupils, blink now and then
      c.blinkT -= 1 / 60;
      const blink = c.blinkT < 0.12 ? 0.15 : 1;
      if (c.blinkT < 0) c.blinkT = 2.5 + Math.random() * 3;
      const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(qH);
      const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(qH);
      const hu = new THREE.Vector3(0, 1, 0).applyQuaternion(qH);
      for (const sx of [-1, 1]) {
        const e = hd.clone().addScaledVector(fw, 0.165).addScaledVector(rt, sx * 0.072).addScaledVector(hu, 0.035);
        this.emit('sphere', e, qH, ts.set(0.052, 0.058 * blink, 0.03), glove, 'uniform', line);
        const pupil = e.clone().addScaledVector(fw, 0.026).addScaledVector(hu, -0.006);
        this.emit('sphere', pupil, qH, ts.set(0.024, 0.028 * blink, 0.012), INK, 'none', line);
      }
      this.accessory(c, hd, qH, fw, rt, hu, accent, line);
    }
    // arms: shirt-colour upper arms, gloves
    const lS = P('lShoulder'), rS = P('rShoulder'), lE = P('lElbow'), rE = P('rElbow'), lH = P('lHand'), rH = P('rHand');
    this.ball(lS, 0.075, body, line);
    this.ball(rS, 0.075, body, line);
    this.limb(lS, lE, 0.062, body, line);
    this.limb(rS, rE, 0.062, body, line);
    this.ball(lE, 0.058, body, line);
    this.ball(rE, 0.058, body, line);
    this.limb(lE, lH, 0.052, body, line);
    this.limb(rE, rH, 0.052, body, line);
    this.ball(lH, 0.062, glove, line);
    this.ball(rH, 0.062, glove, line);
    // legs
    const lHip = P('lHip'), rHip = P('rHip'), lK = P('lKnee'), rK = P('rKnee'), lA = P('lAnkle'), rA = P('rAnkle'), lT = P('lToe'), rT = P('rToe');
    this.limb(lHip, lK, 0.08, pants, line);
    this.limb(rHip, rK, 0.08, pants, line);
    this.ball(lK, 0.072, pants, line);
    this.ball(rK, 0.072, pants, line);
    this.limb(lK, lA, 0.068, pants, line);
    this.limb(rK, rA, 0.068, pants, line);
    // shoes (accent colour) from ankle to toe
    for (const [a, t] of [[lA, lT], [rA, rT]] as const) {
      const mid = a.clone().lerp(t, 0.55);
      mid.y -= 0.02;
      const dir = t.clone().sub(a);
      const qF = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.normalize());
      this.emit('box', mid, qF, ts.set(0.12, 0.085, 0.24), accent, 'box', line);
    }
    // backpack
    if (o.backpack && !SAND.enabled) {
      const back = chest.clone().addScaledVector(up, -0.2).addScaledVector(V(sk.upperFwd, tv2), -0.18);
      this.emit('box', back, qT, ts.set(0.3, 0.32, 0.14), accent.clone().multiplyScalar(0.8), 'box', line);
    }
    // third-person weapon in the right hand, along the aim
    if (!c.dead) {
      const w = f.weapons[f.cur].id as WeaponId;
      const qG = new THREE.Quaternion().setFromEuler(new THREE.Euler(f.pitch, f.yaw, 0, 'YXZ'));
      const reload = f.reloadTimer > 0 ? Math.sin(Math.min(1, 1 - f.reloadTimer / Math.max(0.01, WEAPONS[w].reloadTime)) * Math.PI) : 0;
      if (reload > 0) qG.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 * reload, 0, 0.6 * reload)));
      const formed = SAND.enabled ? Math.max(0.16, 1 - Math.min(1, f.switchTimer / Math.max(0.01, WEAPONS[w].drawTime)) * 0.84) : 1;
      this.emit(`gun_${w}` as PrimId, rH, qG, ts.set(formed, formed, formed), WHITE, 'uniform', line);
    }
    void time;
  }

  private accessory(c: CharState, hd: THREE.Vector3, qH: THREE.Quaternion, fw: THREE.Vector3, rt: THREE.Vector3, hu: THREE.Vector3, accent: THREE.Color, line: THREE.Color) {
    const acc = c.outfit.acc;
    if (acc === 'cap') {
      this.emit('dome', hd.clone().addScaledVector(hu, 0.03), qH, ts.set(0.212, 0.15, 0.212), accent.clone().multiplyScalar(0.85), 'uniform', line);
      this.emit('box', hd.clone().addScaledVector(hu, 0.07).addScaledVector(fw, 0.2), qH, ts.set(0.22, 0.03, 0.14), accent.clone().multiplyScalar(0.85), 'box', line);
    } else if (acc === 'headband') {
      const q = qH.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      this.emit('torus', hd.clone().addScaledVector(hu, 0.07), q, ts.set(0.195, 0.195, 0.2), new THREE.Color(0xfbfbf7), 'uniform', line);
    } else if (acc === 'beanie') {
      this.emit('dome', hd.clone().addScaledVector(hu, 0.02), qH, ts.set(0.215, 0.2, 0.215), accent, 'uniform', line);
      this.ball(hd.clone().addScaledVector(hu, 0.24), 0.05, new THREE.Color(0xfbfbf7), line);
    } else if (acc === 'scarf') {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), V(c.sk.spineUp, new THREE.Vector3()));
      this.emit('torus', V(c.sk.neck, new THREE.Vector3()).addScaledVector(V(c.sk.spineUp, tv2), -0.02), q, ts.set(0.12, 0.12, 0.3), accent, 'uniform', line);
    } else if (acc === 'tuft') {
      const q = qH.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3));
      this.emit('dome', hd.clone().addScaledVector(hu, 0.12).addScaledVector(rt, 0.03), q, ts.set(0.13, 0.12, 0.13), INK.clone(), 'uniform', line);
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
