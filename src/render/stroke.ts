import * as THREE from 'three';
import { markerStrokeMap } from './marker';

// ============================================================================
//  Drawn stickman strokes. The skeleton stays fully 3D; what is drawn is a thick
//  marker line through it: each chain (spine, arm, leg) is a smooth Hermite curve
//  through the joints, expanded into a camera-facing ribbon with round caps, so an
//  arm reads as ONE stroke that flows through the elbow (no ball, no tube). The head
//  is a camera-facing ink disc with a fixed hand-drawn wobble. Everything is written
//  into one preallocated buffer per frame (one draw, no allocation), depth-tested
//  against the world like any other mesh. Wobble is keyed to (seed, sample index),
//  never time, so edges are stable and never boil.
// ============================================================================

const MAX_V = 16000;
const MAX_I = 48000;
const SUB = 5; // curve samples per bone
const CAP = 7; // fan steps per round cap

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3();
const view = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3();
const pts: THREE.Vector3[] = Array.from({ length: 64 }, () => new THREE.Vector3());
const wid: number[] = new Array(64).fill(0);

export class StrokeRenderer {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX_V * 3);
  private col = new Float32Array(MAX_V * 3);
  private uv = new Float32Array(MAX_V * 2);
  private idx = new Uint32Array(MAX_I);
  private nv = 0;
  private ni = 0;
  private cam = new THREE.Vector3();
  private geo = new THREE.BufferGeometry();

  constructor() {
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    // flat, unlit marker: colour comes only from the ink and its dry streaks
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, map: markerStrokeMap(), side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'stickStrokes';
  }

  begin(cam: THREE.Vector3) {
    this.cam.copy(cam);
    this.nv = this.ni = 0;
  }

  end() {
    const g = this.geo;
    g.setDrawRange(0, this.ni);
    for (const k of ['position', 'color', 'uv'] as const) {
      const a = g.getAttribute(k) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.nv * a.itemSize);
      a.needsUpdate = true;
    }
    const ix = g.getIndex()!;
    ix.clearUpdateRanges();
    ix.addUpdateRange(0, this.ni);
    ix.needsUpdate = true;
  }

  private vert(p: THREE.Vector3, c: THREE.Color, u: number, v: number) {
    const i = this.nv++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    return i;
  }

  private tri(a: number, b: number, c: number) {
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }

  /**
   * A marker stroke through the joints. `r0`/`r1` are the half-widths at the ends (subtle taper).
   * `brk` 0..1 breaks the line into drifting fragments (death: the drawing loses cohesion).
   */
  chain(joints: readonly THREE.Vector3[], r0: number, r1: number, color: THREE.Color, seed: number, brk = 0) {
    const n = joints.length;
    if (n < 2 || this.nv + (n - 1) * SUB * 2 + CAP * 4 + 8 > MAX_V) return;
    if (brk > 0.001) {
      // each bone becomes its own shrinking, drifting dash
      for (let i = 0; i < n - 1; i++) {
        const a = joints[i], b = joints[i + 1];
        const s = 0.5 * brk * (0.6 + 0.4 * hash(seed, i));
        const d = brk * 0.12;
        tA.lerpVectors(a, b, s).add(tC.set(hash(seed, i + 9) - 0.5, hash(seed, i + 19) * 0.5, hash(seed, i + 29) - 0.5).multiplyScalar(d));
        tB.lerpVectors(b, a, s).add(tC.set(hash(seed, i + 39) - 0.5, hash(seed, i + 49) * 0.5, hash(seed, i + 59) - 0.5).multiplyScalar(d));
        const w = (r0 + (r1 - r0) * (i / (n - 1))) * (1 - 0.55 * brk);
        pts[0].copy(tA); pts[1].copy(tB); wid[0] = wid[1] = w;
        this.ribbon(2, color, seed + i * 7);
      }
      return;
    }
    // Hermite curve through the joints (soft tangents keep knees/elbows readable, never balloon)
    let m = 0;
    for (let i = 0; i < n - 1; i++) {
      const p0 = joints[Math.max(0, i - 1)], p1 = joints[i], p2 = joints[i + 1], p3 = joints[Math.min(n - 1, i + 2)];
      for (let s = 0; s < SUB; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / SUB;
        pts[m++].copy(hermite(p0, p1, p2, p3, t));
      }
    }
    pts[m++].copy(joints[n - 1]);
    for (let i = 0; i < m; i++) {
      const t = i / (m - 1);
      // subtle taper + fixed hand wobble in width
      wid[i] = (r0 + (r1 - r0) * t) * (0.93 + 0.14 * hash(seed, i));
    }
    this.ribbon(m, color, seed);
  }

  /** camera-facing ribbon through pts[0..m) with round caps */
  private ribbon(m: number, color: THREE.Color, seed: number) {
    const base = this.nv;
    let vAcc = 0;
    for (let i = 0; i < m; i++) {
      const p = pts[i];
      if (i === 0) tan.subVectors(pts[1], pts[0]);
      else if (i === m - 1) tan.subVectors(pts[i], pts[i - 1]);
      else tan.subVectors(pts[i + 1], pts[i - 1]);
      tan.normalize();
      view.subVectors(this.cam, p);
      side.crossVectors(tan, view).normalize().multiplyScalar(wid[i]);
      if (i > 0) vAcc += pts[i].distanceTo(pts[i - 1]) * 2;
      tA.copy(p).add(side);
      tB.copy(p).sub(side);
      this.vert(tA, color, 0, vAcc + seed * 0.37);
      this.vert(tB, color, 1, vAcc + seed * 0.37);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        this.tri(a, a + 1, a + 2);
        this.tri(a + 1, a + 3, a + 2);
      }
    }
    this.cap(pts[0], pts[1], wid[0], color, base, base + 1, seed);
    this.cap(pts[m - 1], pts[m - 2], wid[m - 1], color, base + (m - 1) * 2 + 1, base + (m - 1) * 2, seed + 3);
  }

  /** half-disc fan closing the stroke end at p (pointing away from q) between existing verts l and r */
  private cap(p: THREE.Vector3, q: THREE.Vector3, w: number, color: THREE.Color, l: number, r: number, seed: number) {
    tan.subVectors(p, q).normalize();
    view.subVectors(this.cam, p);
    side.crossVectors(tan, view).normalize();
    const out = tC.crossVectors(view.normalize(), side).normalize();
    if (out.dot(tan) < 0) out.negate();
    const c = this.vert(p, color, 0.5, seed);
    let prev = l;
    for (let k = 1; k < CAP; k++) {
      const a = (k / CAP) * Math.PI;
      const rr = w * (0.94 + 0.1 * hash(seed, k));
      tA.copy(p).addScaledVector(side, Math.cos(a) * rr).addScaledVector(out, Math.sin(a) * rr);
      const v = this.vert(tA, color, 0.5 + 0.5 * Math.cos(a), seed + k * 0.1);
      this.tri(c, prev, v);
      prev = v;
    }
    this.tri(c, prev, r);
  }

  /** filled ink disc facing the camera, with a fixed wobbly marker edge */
  disc(center: THREE.Vector3, r: number, color: THREE.Color, seed: number, rim?: THREE.Color) {
    const N = 22;
    if (this.nv + N * 2 + 4 > MAX_V) return;
    view.subVectors(this.cam, center).normalize();
    side.set(0, 1, 0).cross(view);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = tC.crossVectors(view, side).normalize();
    // pull the disc slightly toward the viewer so the neck stroke tucks behind it
    tB.copy(center).addScaledVector(view, r * 0.6);
    const drawRing = (rad: number, col: THREE.Color, jitter: number) => {
      const c = this.vert(tB, col, 0.5, 0.5 + seed);
      const first = this.nv;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const rr = rad * (1 + jitter * (hash(seed, k) - 0.5));
        tA.copy(tB).addScaledVector(side, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr);
        this.vert(tA, col, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a) + seed);
      }
      for (let k = 0; k < N; k++) this.tri(c, first + k, first + ((k + 1) % N));
    };
    if (rim) {
      drawRing(r * 1.08, rim, 0.07);
      tB.addScaledVector(view, 0.004);
      drawRing(r * 0.9, color, 0.05);
    } else drawRing(r, color, 0.07);
  }
}

const hOut = new THREE.Vector3();
function hermite(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number) {
  const k = 0.32;
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  hOut.set(
    h00 * p1.x + h01 * p2.x + k * (h10 * (p2.x - p0.x) + h11 * (p3.x - p1.x)),
    h00 * p1.y + h01 * p2.y + k * (h10 * (p2.y - p0.y) + h11 * (p3.y - p1.y)),
    h00 * p1.z + h01 * p2.z + k * (h10 * (p2.z - p0.z) + h11 * (p3.z - p1.z)),
  );
  return hOut;
}
