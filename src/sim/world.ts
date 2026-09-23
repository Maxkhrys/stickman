import type { Box, MapDef, Ramp } from './map';
import { v3, type Vec3 } from './vec';

export interface RayHit {
  t: number;
  normal: Vec3;
}

/** Static collision world: axis-aligned boxes, solid ramps (wedges) and the floor plane at y=0. */
export class World {
  readonly boxes: Box[];
  readonly ramps: Ramp[];
  readonly bounds: MapDef['bounds'];

  constructor(map: MapDef) {
    this.boxes = map.boxes;
    this.ramps = map.ramps;
    this.bounds = map.bounds;
  }

  rampHeight(r: Ramp, x: number, z: number): number {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return -Infinity;
    const t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
    return r.h0 + (r.h1 - r.h0) * t;
  }

  /** Highest ramp surface under the point (sampled at centre), or -Infinity. */
  rampHeightAt(x: number, z: number): number {
    let h = -Infinity;
    for (const r of this.ramps) {
      const rh = this.rampHeight(r, x, z);
      if (rh > h) h = rh;
    }
    return h;
  }

  /** Highest ramp surface anywhere under a square footprint (centre, edges, corners), or -Infinity. */
  rampHeightMax(x: number, z: number, r: number): number {
    let h = -Infinity;
    for (const r0 of this.ramps) {
      if (x + r < r0.x0 || x - r > r0.x1 || z + r < r0.z0 || z - r > r0.z1) continue;
      // the wedge is linear, so its maximum over the clipped footprint is at a clipped corner
      const cx0 = Math.max(x - r, r0.x0), cx1 = Math.min(x + r, r0.x1), cz0 = Math.max(z - r, r0.z0), cz1 = Math.min(z + r, r0.z1);
      for (const px of [cx0, cx1]) for (const pz of [cz0, cz1]) h = Math.max(h, this.rampHeight(r0, px, pz));
    }
    return h;
  }

  /** Highest walkable surface under a footprint of radius r whose top is <= maxY. */
  surfaceBelow(x: number, z: number, r: number, maxY: number): number {
    let best = 0;
    for (const b of this.boxes) {
      if (b.max.y > maxY || b.max.y <= best) continue;
      if (x + r <= b.min.x || x - r >= b.max.x || z + r <= b.min.z || z - r >= b.max.z) continue;
      best = b.max.y;
    }
    for (const rp of this.ramps) {
      // sample footprint centre and edges so standing on the edge of a ramp still counts
      let rh = this.rampHeight(rp, x, z);
      if (rh === -Infinity) {
        const cx = Math.min(Math.max(x, rp.x0), rp.x1);
        const cz = Math.min(Math.max(z, rp.z0), rp.z1);
        if (Math.abs(cx - x) <= r && Math.abs(cz - z) <= r) rh = this.rampHeight(rp, cx, cz);
      }
      if (rh <= maxY && rh > best) best = rh;
    }
    return best;
  }

  /** Is an upright AABB (feet at y, radius r, height h) free of boxes and ramp solids? */
  isClear(x: number, y: number, z: number, r: number, h: number): boolean {
    for (const b of this.boxes) {
      if (x + r <= b.min.x || x - r >= b.max.x) continue;
      if (z + r <= b.min.z || z - r >= b.max.z) continue;
      if (y + h <= b.min.y + 1e-3 || y >= b.max.y - 1e-3) continue;
      return false;
    }
    if (this.rampHeightAt(x, z) > y + 0.05) return false;
    return true;
  }

  /** Boxes overlapping an upright AABB. */
  overlapping(x: number, y: number, z: number, r: number, h: number, out: Box[]): Box[] {
    out.length = 0;
    for (const b of this.boxes) {
      if (x + r <= b.min.x || x - r >= b.max.x) continue;
      if (z + r <= b.min.z || z - r >= b.max.z) continue;
      if (y + h <= b.min.y + 1e-3 || y >= b.max.y - 1e-3) continue;
      out.push(b);
    }
    return out;
  }

  /** Ray vs world. dir must be normalised. */
  raycast(o: Vec3, d: Vec3, maxDist: number): RayHit | null {
    let bestT = maxDist;
    let bestN: Vec3 | null = null;

    // floor
    if (d.y < -1e-6 && o.y >= 0) {
      const t = -o.y / d.y;
      if (t < bestT) {
        bestT = t;
        bestN = v3(0, 1, 0);
      }
    }

    // boxes (slab test)
    const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
    for (const b of this.boxes) {
      let t1 = (b.min.x - o.x) * ix, t2 = (b.max.x - o.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let axis = 0;
      t1 = (b.min.y - o.y) * iy;
      t2 = (b.max.y - o.y) * iy;
      let lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; axis = 1; }
      if (hi < tmax) tmax = hi;
      t1 = (b.min.z - o.z) * iz;
      t2 = (b.max.z - o.z) * iz;
      lo = Math.min(t1, t2);
      hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; axis = 2; }
      if (hi < tmax) tmax = hi;
      if (tmax < 0 || tmin > tmax || tmin >= bestT || tmin < 0) continue;
      bestT = tmin;
      bestN = axis === 0 ? v3(-Math.sign(d.x), 0, 0) : axis === 1 ? v3(0, -Math.sign(d.y), 0) : v3(0, 0, -Math.sign(d.z));
    }

    // ramp top surfaces
    for (const r of this.ramps) {
      const len = r.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
      const k = (r.h1 - r.h0) / len;
      const c = r.h0 - k * (r.axis === 'x' ? r.x0 : r.z0);
      const oa = r.axis === 'x' ? o.x : o.z;
      const da = r.axis === 'x' ? d.x : d.z;
      const f0 = o.y - k * oa - c;
      const denom = d.y - k * da;
      if (f0 <= 0 || denom >= 0) continue; // must approach from above
      const t = -f0 / denom;
      if (t < 0 || t >= bestT) continue;
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      if (px < r.x0 || px > r.x1 || pz < r.z0 || pz > r.z1) continue;
      bestT = t;
      const nl = Math.hypot(k, 1);
      bestN = r.axis === 'x' ? v3(-k / nl, 1 / nl, 0) : v3(0, 1 / nl, -k / nl);
    }

    return bestN ? { t: bestT, normal: bestN } : null;
  }

  /** Line of sight between two points. */
  los(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    return this.raycast(a, v3(dx / d, dy / d, dz / d), d - 0.05) === null;
  }
}
