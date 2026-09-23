import * as THREE from 'three';
import type { World } from '../sim/world';

// joint indices
const HEAD = 0, NECK = 1, PELVIS = 2, LELB = 3, LHAND = 4, RELB = 5, RHAND = 6, LKNEE = 7, LFOOT = 8, RKNEE = 9, RFOOT = 10;
const JOINTS = 11;
const BONES: [number, number, number][] = [
  // [a, b, radius]
  [NECK, PELVIS, 0.075],
  [NECK, LELB, 0.05],
  [LELB, LHAND, 0.045],
  [NECK, RELB, 0.05],
  [RELB, RHAND, 0.045],
  [PELVIS, LKNEE, 0.06],
  [LKNEE, LFOOT, 0.055],
  [PELVIS, RKNEE, 0.06],
  [RKNEE, RFOOT, 0.055],
];
const RAG_LINKS: [number, number][] = [
  [HEAD, NECK], ...BONES.map(([a, b]) => [a, b] as [number, number]),
  [LKNEE, RKNEE], [LELB, PELVIS], [RELB, PELVIS], [HEAD, PELVIS],
];

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

let sharedGeo: { cyl: THREE.CylinderGeometry; sphere: THREE.SphereGeometry; joint: THREE.SphereGeometry; gun: THREE.BoxGeometry; blob: THREE.PlaneGeometry } | null = null;
function geos() {
  if (!sharedGeo) {
    sharedGeo = {
      cyl: new THREE.CylinderGeometry(1, 1, 1, 7, 1, false),
      sphere: new THREE.SphereGeometry(1, 14, 10),
      joint: new THREE.SphereGeometry(1, 8, 6),
      gun: new THREE.BoxGeometry(0.07, 0.1, 0.55),
      blob: new THREE.PlaneGeometry(1, 1),
    };
  }
  return sharedGeo;
}

export interface StickmanState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  height: number;
  onGround: boolean;
  sliding: boolean;
  alive: boolean;
  weapon: string;
  reloading: boolean;
  meleeT: number; // seconds since last melee swing (large = none)
  meleeHeavy: boolean;
  firedT: number; // seconds since last shot
}

export class Stickman {
  readonly group = new THREE.Group();
  private mat: THREE.MeshLambertMaterial;
  private headMat: THREE.MeshLambertMaterial;
  private outlineMat: THREE.MeshBasicMaterial;
  private headColor: THREE.Color;
  private head: THREE.Mesh;
  private headOutline: THREE.Mesh;
  private hurtT = 0;
  private hurtX = 0;
  private hurtZ = 0;
  private bones: THREE.Mesh[] = [];
  private joints: THREE.Mesh[] = [];
  private gun: THREE.Mesh;
  private shadow: THREE.Mesh;
  private j: THREE.Vector3[] = [];
  private phase = 0;
  private crouchS = 0;
  private airS = 0;
  private slideS = 0;
  private leanS = 0;

  // ragdoll
  private dead = false;
  private deadT = 0;
  private rp: THREE.Vector3[] = [];
  private ro: THREE.Vector3[] = [];
  private restLen: number[] = [];
  private headPopped = false;

  constructor(color: number, private blobTex: THREE.Texture) {
    const g = geos();
    // ink body, loud coloured head with a thick outline -> readable on busy paper backgrounds
    this.mat = new THREE.MeshLambertMaterial({ color: 0x1b1b24 });
    this.headColor = new THREE.Color(color);
    this.headMat = new THREE.MeshLambertMaterial({ color });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x111118, side: THREE.BackSide });
    this.head = new THREE.Mesh(g.sphere, this.headMat);
    this.head.scale.setScalar(0.2);
    this.group.add(this.head);
    this.headOutline = new THREE.Mesh(g.sphere, this.outlineMat);
    this.headOutline.scale.setScalar(0.235);
    this.group.add(this.headOutline);
    for (const [, , r] of BONES) {
      const m = new THREE.Mesh(g.cyl, this.mat);
      m.userData.r = r;
      this.bones.push(m);
      this.group.add(m);
    }
    for (const _ of [LELB, RELB, LKNEE, RKNEE, LHAND, RHAND, LFOOT, RFOOT, PELVIS]) {
      void _;
      const m = new THREE.Mesh(g.joint, this.mat);
      m.scale.setScalar(0.065);
      this.joints.push(m);
      this.group.add(m);
    }
    this.gun = new THREE.Mesh(g.gun, new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
    this.group.add(this.gun);
    this.shadow = new THREE.Mesh(g.blob, new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.setScalar(1.1);
    this.group.add(this.shadow);
    for (let i = 0; i < JOINTS; i++) this.j.push(new THREE.Vector3());
  }

  /** Hit reaction: flinch away from the shot + head flash. */
  hurt(dirX: number, dirZ: number) {
    this.hurtT = 0.22;
    this.hurtX = dirX;
    this.hurtZ = dirZ;
  }

  dispose() {
    this.mat.dispose();
    this.headMat.dispose();
    this.outlineMat.dispose();
    (this.gun.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
  }

  get headWorld(): THREE.Vector3 {
    return this.j[HEAD];
  }

  /** Procedural pose from movement state. */
  private pose(s: StickmanState, dt: number) {
    const hs = Math.hypot(s.vx, s.vz);
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    // local velocity (x right, z forward)
    const lvx = s.vx * cy - s.vz * sy;
    const lvz = -s.vx * sy - s.vz * cy;
    const k = 1 - Math.exp(-14 * dt);
    const crouchT = Math.min(1, Math.max(0, (1.8 - s.height) / 0.65));
    this.crouchS += (crouchT - this.crouchS) * k;
    this.airS += ((s.onGround ? 0 : 1) - this.airS) * (1 - Math.exp(-10 * dt));
    this.slideS += ((s.sliding ? 1 : 0) - this.slideS) * k;
    this.leanS += (Math.min(hs / 8, 1.2) * (lvz >= 0 ? 1 : -0.4) - this.leanS) * k;
    if (s.onGround && !s.sliding) this.phase += hs * dt * 1.75;

    const speedT = Math.min(hs / 8.2, 1.3) * (1 - this.airS) * (1 - this.slideS);
    const mdx = hs > 0.3 ? lvx / hs : 0;
    const mdz = hs > 0.3 ? lvz / hs : 1;

    const L: THREE.Vector3[] = this.j; // work in local space, transform at the end
    const cr = this.crouchS, sl = this.slideS, air = this.airS;
    const pelvisY = 0.95 - 0.38 * cr - 0.45 * sl + 0.1 * air + Math.abs(Math.sin(this.phase)) * 0.04 * speedT;
    const lean = 0.12 * this.leanS + 0.35 * cr * (1 - sl) - 0.55 * sl;
    L[PELVIS].set(0, pelvisY, -0.05 * cr);
    L[NECK].set(0, pelvisY + 0.5 * Math.cos(lean), L[PELVIS].z + 0.5 * Math.sin(lean));
    const pitch = s.alive ? s.pitch : 0;
    L[HEAD].set(0, L[NECK].y + 0.22 * Math.cos(lean * 0.5), L[NECK].z + 0.22 * Math.sin(lean * 0.5) + pitch * -0.03);

    // legs
    for (const side of [-1, 1]) {
      const hip = tmpV.set(0.1 * side, pelvisY - 0.02, L[PELVIS].z);
      const ph = this.phase + (side > 0 ? Math.PI : 0);
      const swing = Math.sin(ph) * 0.42 * speedT;
      const lift = Math.max(0, Math.cos(ph)) * 0.28 * speedT;
      const foot = side < 0 ? L[LFOOT] : L[RFOOT];
      foot.set(0.14 * side + mdx * swing, 0.07 + lift, mdz * swing + 0.05 * cr);
      // air: tuck
      foot.y += air * (0.35 + (side > 0 ? 0.1 : 0));
      foot.z += air * (side > 0 ? 0.15 : -0.1);
      // slide: lead leg forward straight, other bent under
      if (sl > 0.01) {
        const sx = side > 0 ? 0.12 : -0.1, sz = side > 0 ? 0.85 : 0.25, syy = side > 0 ? 0.1 : 0.05;
        foot.lerp(tmpV2.set(sx, syy, sz), sl);
      }
      const knee = side < 0 ? L[LKNEE] : L[RKNEE];
      this.ik(hip, foot, knee, 0.5, 0.5, 0, 0, 1, side * 0.15);
    }

    // arms: hold the gun toward aim pitch
    const shoulderY = L[NECK].y - 0.06;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const reach = s.weapon === 'melee' ? 0.4 : 0.52;
    const rh = L[RHAND].set(0.12, shoulderY - 0.18 + sp * reach, L[NECK].z + cp * reach * 0.85);
    const lh = L[LHAND].set(-0.05, shoulderY - 0.15 + sp * (reach + 0.2), L[NECK].z + cp * (reach + 0.18));
    if (s.weapon === 'melee') lh.set(-0.22, shoulderY - 0.35, L[NECK].z + 0.15);
    if (s.reloading) lh.set(-0.05, shoulderY - 0.35, L[NECK].z + 0.3);
    // melee swing arc
    if (s.meleeT < 0.35) {
      const t = s.meleeT / 0.35;
      const a = Math.sin(t * Math.PI);
      rh.set(0.3 - a * 0.5, shoulderY - 0.1 + a * 0.1, L[NECK].z + 0.3 + a * 0.35);
    }
    // recoil kick
    if (s.firedT < 0.08) {
      const kick = (1 - s.firedT / 0.08) * 0.05;
      rh.z -= kick;
      lh.z -= kick;
      rh.y += kick * 0.5;
    }
    // swing arms a bit while running with melee
    if (s.weapon === 'melee' && s.meleeT >= 0.35) {
      rh.z += Math.sin(this.phase) * 0.15 * speedT;
      lh.z -= Math.sin(this.phase) * 0.2 * speedT;
    }
    const shR = tmpV.set(0.14, shoulderY, L[NECK].z);
    this.ik(shR, rh, L[RELB], 0.3, 0.3, 0.6, -1, -0.2, 0);
    const shL = tmpV.set(-0.14, shoulderY, L[NECK].z);
    this.ik(shL, lh, L[LELB], 0.3, 0.33, -0.6, -1, -0.2, 0);

    // hit flinch: upper body snaps away from the shot direction
    if (this.hurtT > 0) {
      const k2 = (this.hurtT / 0.22) * 0.18;
      const lx = this.hurtX * cy - this.hurtZ * sy;
      const lz = -this.hurtX * sy - this.hurtZ * cy;
      for (const idx of [HEAD, NECK, LELB, RELB, LHAND, RHAND]) {
        L[idx].x += lx * k2;
        L[idx].z += lz * k2;
      }
      L[HEAD].y -= k2 * 0.3;
    }

    // local -> world
    const px = s.x, py = s.y, pz = s.z;
    for (const p of L) {
      const lx = p.x, lz = p.z;
      p.set(px + lx * cy - lz * sy, py + p.y, pz - lx * sy - lz * cy);
    }
  }

  /** Two-bone IK: places `out` (elbow/knee) between a and b, bending toward (bx,by,bz) in local space. */
  private ik(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3, l1: number, l2: number, bx: number, by: number, bz: number, side: number) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    let d = Math.hypot(dx, dy, dz);
    const maxD = l1 + l2 - 0.001;
    if (d > maxD) {
      const s = maxD / d;
      b.set(a.x + dx * s, a.y + dy * s, a.z + dz * s);
      d = maxD;
    }
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const nx = dx / d, ny = dy / d, nz = dz / d;
    // bend direction orthogonalised against the limb axis
    let px = bx + side, py = by, pz = bz;
    const dp = px * nx + py * ny + pz * nz;
    px -= nx * dp;
    py -= ny * dp;
    pz -= nz * dp;
    const pl = Math.hypot(px, py, pz) || 1;
    out.set(a.x + nx * along + (px / pl) * h, a.y + ny * along + (py / pl) * h, a.z + nz * along + (pz / pl) * h);
  }

  private placeMeshes(aimYaw: number, aimPitch: number, showGun: boolean) {
    const J = this.j;
    this.head.position.copy(J[HEAD]);
    this.headOutline.position.copy(J[HEAD]);
    this.headOutline.visible = this.head.visible;
    BONES.forEach(([a, b, r], i) => setBone(this.bones[i], J[a], J[b], r));
    const ji = [LELB, RELB, LKNEE, RKNEE, LHAND, RHAND, LFOOT, RFOOT, PELVIS];
    ji.forEach((k, i) => this.joints[i].position.copy(J[k]));
    this.gun.visible = showGun;
    if (showGun) {
      this.gun.position.copy(J[RHAND]).lerp(J[LHAND], 0.35);
      this.gun.rotation.set(aimPitch, aimYaw, 0, 'YXZ');
    }
  }

  update(s: StickmanState, dt: number, world: World) {
    if (!s.alive) {
      if (!this.dead) this.startRagdoll(new THREE.Vector3(s.vx, s.vy, s.vz), new THREE.Vector3(), false);
      this.stepRagdoll(dt, world);
      return;
    }
    if (this.dead) this.revive();
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.headMat.color.copy(this.headColor).lerp(WHITE, this.hurtT > 0.12 ? 0.8 : 0);
    this.pose(s, dt);
    this.placeMeshes(s.yaw, s.pitch, true);
    this.gun.scale.set(1, 1, s.weapon === 'melee' ? 0.45 : s.weapon === 'pistol' ? 0.5 : 1);
    const floor = world.surfaceBelow(s.x, s.z, 0.2, s.y + 0.1);
    this.shadow.position.set(s.x, floor + 0.02, s.z);
    const hAbove = s.y - floor;
    this.shadow.scale.setScalar(Math.max(0.4, 1.1 - hAbove * 0.25));
    this.shadow.visible = true;
  }

  private revive() {
    this.dead = false;
    this.headPopped = false;
    for (const m of [this.mat, this.headMat, this.outlineMat]) {
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
    this.group.visible = true;
    this.head.visible = true;
  }

  /** Called on death with the killing shot direction. */
  startRagdoll(vel: THREE.Vector3, impulse: THREE.Vector3, headPop: boolean) {
    if (this.dead) {
      // upgrade to head pop if kill event arrives after state
      if (headPop && !this.headPopped) this.popHead(impulse);
      return;
    }
    this.dead = true;
    this.deadT = 0;
    this.rp = this.j.map((p) => p.clone());
    this.ro = this.j.map((p, i) => {
      const upper = i === HEAD || i === NECK || i === LELB || i === RELB || i === LHAND || i === RHAND ? 1 : 0.35;
      const v = vel.clone().multiplyScalar(0.9).addScaledVector(impulse, upper);
      return p.clone().addScaledVector(v, -1 / 60);
    });
    this.restLen = RAG_LINKS.map(([a, b]) => this.rp[a].distanceTo(this.rp[b]));
    if (headPop) this.popHead(impulse);
  }

  private popHead(impulse: THREE.Vector3) {
    this.headPopped = true;
    const h = this.rp[HEAD];
    const o = this.ro[HEAD];
    const v = new THREE.Vector3(impulse.x * 0.6 + (Math.random() - 0.5) * 2, 6 + Math.random() * 2, impulse.z * 0.6 + (Math.random() - 0.5) * 2);
    o.copy(h).addScaledVector(v, -1 / 60);
  }

  private stepRagdoll(dt: number, world: World) {
    this.deadT += dt;
    const g = -22 * dt * dt;
    const P = this.rp, O = this.ro;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], o = O[i];
      const vx = (p.x - o.x) * 0.99, vy = (p.y - o.y) * 0.99, vz = (p.z - o.z) * 0.99;
      o.copy(p);
      p.x += vx;
      p.y += vy + g;
      p.z += vz;
    }
    for (let it = 0; it < 5; it++) {
      RAG_LINKS.forEach(([a, b], li) => {
        if (this.headPopped && (a === HEAD || b === HEAD)) return;
        const pa = P[a], pb = P[b];
        tmpV.subVectors(pb, pa);
        const d = tmpV.length() || 1e-4;
        const diff = (d - this.restLen[li]) / d / 2;
        pa.addScaledVector(tmpV, diff);
        pb.addScaledVector(tmpV, -diff);
      });
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const r = i === HEAD ? 0.2 : 0.05;
        const floor = world.surfaceBelow(p.x, p.z, 0.02, p.y + 0.4) + r;
        if (p.y < floor) {
          p.y = floor;
          const o = O[i];
          // friction + bounce for the head
          o.x = p.x - (p.x - o.x) * 0.7;
          o.z = p.z - (p.z - o.z) * 0.7;
          if (i === HEAD && this.headPopped && o.y > p.y) o.y = p.y - (o.y - p.y) * 0.45;
        }
      }
    }
    for (let i = 0; i < JOINTS; i++) this.j[i].copy(P[i]);
    const yaw = Math.atan2(-(P[RHAND].x - P[NECK].x), -(P[RHAND].z - P[NECK].z));
    this.placeMeshes(yaw, 0, true);
    this.shadow.visible = false;
    // fade out
    const fadeStart = 1.6, fadeDur = 0.9;
    if (this.deadT > fadeStart) {
      const a = Math.max(0, 1 - (this.deadT - fadeStart) / fadeDur);
      for (const m of [this.mat, this.headMat, this.outlineMat]) {
        m.transparent = true;
        m.depthWrite = false;
        m.opacity = a;
      }
      this.gun.visible = a > 0.3;
      if (a <= 0) this.group.visible = false;
    }
  }
}

export function setBone(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  tmpV2.subVectors(b, a);
  const len = tmpV2.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-5) m.quaternion.setFromUnitVectors(UP, tmpV2.divideScalar(len));
  m.scale.set(r, len, r);
}
