import * as THREE from 'three';
import type { Skeleton } from '../../sim/body';
import type { Vec3 } from '../../sim/vec';
import type { StickAnim } from './StickAnimator';

/** Developer toggles for the character animation layer (all presentation only). */
export interface AnimDebugFlags {
  authSkeleton: boolean;
  renderSkeleton: boolean;
  footTargets: boolean;
  handTargets: boolean;
  /** hold every live pose where it is */
  freeze: boolean;
  /** hide the body meshes (see skeletons clearly) */
  hideBody: boolean;
}

const BONES: [keyof Skeleton, keyof Skeleton][] = [
  ['pelvis', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'], ['lElbow', 'lHand'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'],
  ['lHip', 'rHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lToe'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rToe'],
];

const MAX = 4096;

/** One LineSegments with a fixed buffer; no per-frame allocation. */
export class AnimDebug {
  readonly flags: AnimDebugFlags = { authSkeleton: false, renderSkeleton: false, footTargets: false, handTargets: false, freeze: false, hideBody: false };
  readonly lines: THREE.LineSegments;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private n = 0;
  private c = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
  }

  get active() {
    const f = this.flags;
    return f.authSkeleton || f.renderSkeleton || f.footTargets || f.handTargets;
  }

  begin() {
    this.n = 0;
  }

  private seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number) {
    if (this.n + 2 > MAX) return;
    this.c.set(color);
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) {
      const i = this.n * 3;
      this.pos[i] = x;
      this.pos[i + 1] = y;
      this.pos[i + 2] = z;
      this.col[i] = this.c.r;
      this.col[i + 1] = this.c.g;
      this.col[i + 2] = this.c.b;
      this.n++;
    }
  }

  private cross(p: Vec3, r: number, color: number) {
    this.seg(p.x - r, p.y, p.z, p.x + r, p.y, p.z, color);
    this.seg(p.x, p.y - r, p.z, p.x, p.y + r, p.z, color);
    this.seg(p.x, p.y, p.z - r, p.x, p.y, p.z + r, color);
  }

  private skeleton(sk: Skeleton, color: number) {
    for (const [a, b] of BONES) {
      const p = sk[a] as Vec3, q = sk[b] as Vec3;
      this.seg(p.x, p.y, p.z, q.x, q.y, q.z, color);
    }
  }

  add(anim: StickAnim) {
    const f = this.flags;
    if (f.authSkeleton) this.skeleton(anim.auth, 0x2f8bff);
    if (f.renderSkeleton) this.skeleton(anim.pose, 0xff2d95);
    if (f.footTargets) {
      for (const ft of anim.feet) {
        this.cross(ft.goal, 0.07, 0x22dd66);
        this.cross(ft.plant, 0.04, 0xffe14a);
        this.seg(ft.out.x, ft.out.y, ft.out.z, ft.goal.x, ft.goal.y, ft.goal.z, 0x22dd66);
      }
    }
    if (f.handTargets) {
      this.cross(anim.handGoalR, 0.05, 0xffb000);
      this.cross(anim.handGoalL, 0.05, 0x00d0ff);
      const g = anim.gunPos;
      this.seg(g.x, g.y, g.z, g.x + anim.pose.aimDir.x * 0.6, g.y + anim.pose.aimDir.y * 0.6, g.z + anim.pose.aimDir.z * 0.6, 0xffffff);
    }
  }

  commit() {
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.lines.visible = this.n > 0;
  }
}
