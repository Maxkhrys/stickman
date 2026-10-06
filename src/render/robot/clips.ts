import * as THREE from 'three';

// ============================================================================
//  Baked robot clips (tools/anim/bake-robot.mjs). Each clip is a table of
//  robot-local bone quaternions (int16) plus an in-place hips offset. Clips are
//  sampled by hand instead of through AnimationMixer so locomotion can be phase
//  locked, masked per body region and blended with procedural layers.
// ============================================================================

export interface RawClip {
  frames: number;
  fps: number;
  loop: boolean;
  /** robot units per second at which planted feet stay put (0 = stationary clip) */
  stride: number;
  /** root travel speed of the source clip (robot units per second) */
  travel: number;
  /** normalized phase of the left-foot contact, for phase-locked blending */
  sync: number;
  q: string;
  hip: number[];
  source: string;
}

export interface RawClipFile {
  fps: number;
  bones: string[];
  restHip: number[];
  clips: Record<string, RawClip>;
}

export class Clip {
  readonly frames: number;
  readonly duration: number;
  readonly q: Float32Array;
  readonly hip: Float32Array;
  constructor(readonly name: string, readonly raw: RawClip, readonly nb: number) {
    this.frames = raw.frames;
    this.duration = (raw.frames - 1) / raw.fps;
    const bin = atob(raw.q);
    const i16 = new Int16Array(bin.length / 2);
    for (let i = 0; i < i16.length; i++) {
      const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      i16[i] = v > 32767 ? v - 65536 : v;
    }
    this.q = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) this.q[i] = i16[i] / 32767;
    this.hip = Float32Array.from(raw.hip);
  }
  get loop() {
    return this.raw.loop;
  }
  get stride() {
    return this.raw.stride;
  }
  get sync() {
    return this.raw.sync;
  }

  /** Frame index pair + blend for normalized time u (0..1). Loops wrap, one-shots clamp. */
  private locate(u: number): [number, number, number] {
    const n = this.frames - 1;
    let f = (this.loop ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u))) * n;
    if (f >= n) f = n - 1e-6;
    const i = Math.floor(f);
    return [i, Math.min(n, i + 1), f - i];
  }

  /** Accumulate this clip's pose at normalized time u into `acc` with weight w (bone mask optional). */
  accumulate(u: number, w: number, acc: PoseAccumulator, mask?: Float32Array) {
    if (w <= 1e-4) return;
    const [a, b, k] = this.locate(u);
    const nb = this.nb, q = this.q;
    for (let j = 0; j < nb; j++) {
      const wj = mask ? w * mask[j] : w;
      if (wj <= 1e-5) continue;
      const oa = (a * nb + j) * 4, ob = (b * nb + j) * 4;
      let bx = q[ob], by = q[ob + 1], bz = q[ob + 2], bw = q[ob + 3];
      if (q[oa] * bx + q[oa + 1] * by + q[oa + 2] * bz + q[oa + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      acc.add(j, q[oa] + (bx - q[oa]) * k, q[oa + 1] + (by - q[oa + 1]) * k, q[oa + 2] + (bz - q[oa + 2]) * k, q[oa + 3] + (bw - q[oa + 3]) * k, wj);
    }
    if (!mask || mask[0] > 0) {
      const wh = mask ? w * mask[0] : w;
      const h = this.hip;
      acc.hip[0] += (h[a * 3] + (h[b * 3] - h[a * 3]) * k) * wh;
      acc.hip[1] += (h[a * 3 + 1] + (h[b * 3 + 1] - h[a * 3 + 1]) * k) * wh;
      acc.hip[2] += (h[a * 3 + 2] + (h[b * 3 + 2] - h[a * 3 + 2]) * k) * wh;
      acc.hipW += wh;
    }
  }
}

/** Weighted quaternion sum per bone (nlerp blending with hemisphere alignment). */
export class PoseAccumulator {
  readonly q: Float32Array;
  readonly w: Float32Array;
  readonly hip = new Float32Array(3);
  hipW = 0;
  constructor(readonly nb: number) {
    this.q = new Float32Array(nb * 4);
    this.w = new Float32Array(nb);
  }
  reset() {
    this.q.fill(0);
    this.w.fill(0);
    this.hip.fill(0);
    this.hipW = 0;
  }
  add(j: number, x: number, y: number, z: number, w: number, weight: number) {
    const o = j * 4, q = this.q;
    if (this.w[j] > 0 && q[o] * x + q[o + 1] * y + q[o + 2] * z + q[o + 3] * w < 0) weight = -weight;
    q[o] += x * weight;
    q[o + 1] += y * weight;
    q[o + 2] += z * weight;
    q[o + 3] += w * weight;
    this.w[j] += Math.abs(weight);
  }
  /** Normalised result for bone j into `out` (identity-free: falls back to `rest` when unweighted). */
  read(j: number, out: THREE.Quaternion, rest: THREE.Quaternion) {
    if (this.w[j] < 1e-5) return out.copy(rest);
    const o = j * 4;
    return out.set(this.q[o], this.q[o + 1], this.q[o + 2], this.q[o + 3]).normalize();
  }
}

export interface ClipLibrary {
  bones: string[];
  clips: Record<string, Clip>;
  index: Record<string, number>;
}

export async function loadClipLibrary(url: string): Promise<ClipLibrary> {
  const raw = (await (await fetch(url)).json()) as RawClipFile;
  const clips: Record<string, Clip> = {};
  for (const [name, c] of Object.entries(raw.clips)) clips[name] = new Clip(name, c, raw.bones.length);
  const index: Record<string, number> = {};
  raw.bones.forEach((b, i) => (index[b] = i));
  return { bones: raw.bones, clips, index };
}
