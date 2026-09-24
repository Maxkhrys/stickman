import type { World } from './world';
import type { Vec3 } from './vec';

// ============================================================================
//  Sketch Slide paint (experimental, opt-in). Pure sim data: bounded surface-local
//  cells with an owner (fighter id) and an expiry tick. Walkable surfaces are the
//  floor, box tops and ramps; each has its own id, so a bridge and the floor under
//  it never share cells. Walls get no gameplay paint. The renderer only reads this.
// ============================================================================

export const PAINT = {
  /** cell edge (m); the usable painted core is exactly the cell */
  cell: 0.5,
  /** radius of one impact's blob (m) */
  radius: 0.62,
  /** seconds a mark stays usable */
  life: 12,
  /** hard cap on live cells; the oldest cell is evicted first */
  maxCells: 2048,
  /** only up-facing hits paint (normal.y above this) */
  minNormalY: 0.6,
  /** slide friction multiplier on your own paint */
  frictionMult: 0.85,
  /** eligibility grace across tiny gaps and cell edges (s) */
  grace: 0.1,
};

export interface PaintCell {
  key: number;
  surface: number;
  cx: number;
  cz: number;
  owner: number;
  /** last tick at which the cell still counts */
  expire: number;
}

const OFF = 4096;
const cellKey = (surface: number, cx: number, cz: number) => (surface * 8192 + (cx + OFF)) * 8192 + (cz + OFF);

export class PaintGrid {
  /** insertion-ordered: re-painting moves a cell to the end, so the first entry is always the oldest */
  readonly cells = new Map<number, PaintCell>();
  /** bumps on every change; renderers rebuild only when it moves */
  version = 0;

  constructor(readonly world: World, private tickRate: number) {}

  clear() {
    if (this.cells.size) this.version++;
    this.cells.clear();
  }

  /**
   * Walkable surface containing the point: 0 = floor, 1 + i = box i top, 1 + boxes + j = ramp j.
   * -1 when the point is not on a walkable surface (walls, air).
   */
  surfaceAt(x: number, y: number, z: number, tol = 0.06): number {
    const w = this.world;
    let best = -1, bestD = tol;
    if (Math.abs(y) <= bestD) { best = 0; bestD = Math.abs(y); }
    for (let i = 0; i < w.boxes.length; i++) {
      const b = w.boxes[i];
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      const d = Math.abs(y - b.max.y);
      if (d <= bestD) { best = 1 + i; bestD = d; }
    }
    for (let j = 0; j < w.ramps.length; j++) {
      const h = w.rampHeight(w.ramps[j], x, z);
      if (h === -Infinity) continue;
      const d = Math.abs(y - h);
      if (d <= bestD) { best = 1 + w.boxes.length + j; bestD = d; }
    }
    return best;
  }

  /** is (x, z) inside the surface's footprint (so blobs never spill off a box top) */
  private onSurface(surface: number, x: number, z: number) {
    const w = this.world;
    if (surface === 0) {
      const bd = w.bounds;
      return x >= bd.minX && x <= bd.maxX && z >= bd.minZ && z <= bd.maxZ;
    }
    if (surface <= w.boxes.length) {
      const b = w.boxes[surface - 1];
      return x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
    }
    return w.rampHeight(w.ramps[surface - 1 - w.boxes.length], x, z) !== -Infinity;
  }

  /**
   * Paint around an authoritative world impact. Returns cells written (0 for walls or non-walkable hits).
   * Later writes in the same tick win; the sim calls this in fighter order, so the result is stable.
   */
  paint(point: Vec3, normal: Vec3 | null, owner: number, tick: number): number {
    if (!normal || normal.y < PAINT.minNormalY) return 0;
    const surface = this.surfaceAt(point.x, point.y, point.z);
    if (surface < 0) return 0;
    const c = PAINT.cell, r = PAINT.radius;
    const expire = tick + Math.round(PAINT.life * this.tickRate);
    const x0 = Math.floor((point.x - r) / c), x1 = Math.floor((point.x + r) / c);
    const z0 = Math.floor((point.z - r) / c), z1 = Math.floor((point.z + r) / c);
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const mx = (cx + 0.5) * c, mz = (cz + 0.5) * c;
      if ((mx - point.x) ** 2 + (mz - point.z) ** 2 > r * r) continue;
      if (!this.onSurface(surface, mx, mz)) continue;
      const key = cellKey(surface, cx, cz);
      this.cells.delete(key);
      if (this.cells.size >= PAINT.maxCells) this.cells.delete(this.cells.keys().next().value!);
      this.cells.set(key, { key, surface, cx, cz, owner, expire });
      n++;
    }
    if (n) this.version++;
    return n;
  }

  /** drop expired cells (they are ordered by paint time, so this stops at the first live one) */
  expire(tick: number) {
    let removed = false;
    for (const [key, cell] of this.cells) {
      if (cell.expire > tick) break;
      this.cells.delete(key);
      removed = true;
    }
    if (removed) this.version++;
  }

  /** owner of the usable cell under feet at (x, y, z), or -1 */
  ownerAt(x: number, y: number, z: number, tick: number): number {
    if (!this.cells.size) return -1;
    const surface = this.surfaceAt(x, y, z, 0.12);
    if (surface < 0) return -1;
    const cell = this.cells.get(cellKey(surface, Math.floor(x / PAINT.cell), Math.floor(z / PAINT.cell)));
    return cell && cell.expire > tick ? cell.owner : -1;
  }

  /** world height of a cell centre (renderer helper) */
  cellHeight(cell: PaintCell): number {
    const w = this.world;
    const x = (cell.cx + 0.5) * PAINT.cell, z = (cell.cz + 0.5) * PAINT.cell;
    if (cell.surface === 0) return 0;
    if (cell.surface <= w.boxes.length) return w.boxes[cell.surface - 1].max.y;
    return w.rampHeight(w.ramps[cell.surface - 1 - w.boxes.length], x, z);
  }
}
