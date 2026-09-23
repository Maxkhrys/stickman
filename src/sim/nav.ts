import type { World } from './world';
import { type Vec3 } from './vec';

export interface NavEdge {
  to: number;
  cost: number;
  jump: boolean;
}

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: NavEdge[];
}

const AGENT_R = 0.4;
const AGENT_H = 1.8;

/**
 * Waypoint graph auto-generated from map geometry: samples every walkable surface on a grid
 * (floor, box tops, ramps), then links neighbours that are walkable, jumpable (<=1.25m up) or droppable.
 */
export class NavGraph {
  nodes: NavNode[] = [];
  private cells = new Map<number, number[]>();
  private readonly minX: number;
  private readonly minZ: number;

  constructor(private world: World, private spacing = 2) {
    const b = world.bounds;
    this.minX = b.minX;
    this.minZ = b.minZ;
    const nx = Math.floor((b.maxX - b.minX) / spacing);
    const nz = Math.floor((b.maxZ - b.minZ) / spacing);
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = b.minX + (ix + 0.5) * spacing;
        const z = b.minZ + (iz + 0.5) * spacing;
        const heights = new Set<number>([0]);
        for (const bx of world.boxes) {
          if (x > bx.min.x + 0.15 && x < bx.max.x - 0.15 && z > bx.min.z + 0.15 && z < bx.max.z - 0.15) heights.add(bx.max.y);
        }
        const rh = world.rampHeightAt(x, z);
        if (rh > -Infinity) heights.add(Math.round(rh * 100) / 100);
        for (const h of heights) {
          if (!world.isClear(x, h + 0.02, z, AGENT_R, AGENT_H)) continue;
          const surf = world.surfaceBelow(x, z, 0.05, h + 0.05);
          if (Math.abs(surf - h) > 0.06) continue;
          const id = this.nodes.length;
          this.nodes.push({ id, x, y: h, z, edges: [] });
          const key = ix * 10000 + iz;
          const arr = this.cells.get(key);
          if (arr) arr.push(id);
          else this.cells.set(key, [id]);
        }
      }
    }
    // link neighbours
    for (const n of this.nodes) {
      const ix = Math.floor((n.x - this.minX) / spacing);
      const iz = Math.floor((n.z - this.minZ) / spacing);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const arr = this.cells.get((ix + dx) * 10000 + iz + dz);
          if (!arr) continue;
          for (const m of arr) {
            const o = this.nodes[m];
            const dy = o.y - n.y;
            if (dy > 1.25) continue;
            if (!this.walkable(n, o)) continue;
            const d = Math.hypot(o.x - n.x, dy, o.z - n.z);
            n.edges.push({ to: m, cost: d + (dy > 0.55 ? 1.5 : 0), jump: dy > 0.55 });
          }
        }
      }
    }
  }

  private walkable(a: NavNode, b: NavNode): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / 0.35);
    const top = Math.max(a.y, b.y);
    const low = Math.min(a.y, b.y);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const s = this.world.surfaceBelow(x, z, 0.15, top + 0.6);
      if (s < low - 0.6 && b.y >= a.y) return false; // gap going up
      // leaving a jump: allow clearance at the upper height
      const y = b.y > a.y + 0.55 ? Math.max(s, a.y + (b.y - a.y) * Math.min(1, t * 2)) : s;
      if (!this.world.isClear(x, y + 0.05, z, 0.3, 1.7)) return false;
    }
    return true;
  }

  nearest(p: Vec3): number {
    const ix = Math.floor((p.x - this.minX) / this.spacing);
    const iz = Math.floor((p.z - this.minZ) / this.spacing);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const arr = this.cells.get((ix + dx) * 10000 + iz + dz);
          if (!arr) continue;
          for (const id of arr) {
            const n = this.nodes[id];
            const dy = n.y - p.y;
            if (dy > 1.3) continue;
            const d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(dy) * 2;
            if (d < bestD && n.edges.length > 0) {
              bestD = d;
              best = id;
            }
          }
        }
      }
    }
    if (best < 0) {
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - p.x, (n.y - p.y) * 2, n.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = n.id;
        }
      }
    }
    return best;
  }

  /** A* returning node ids (excluding start). Empty if unreachable. */
  findPath(from: number, to: number): number[] {
    if (from < 0 || to < 0) return [];
    if (from === to) return [to];
    const nodes = this.nodes;
    const g = new Float64Array(nodes.length).fill(Infinity);
    const came = new Int32Array(nodes.length).fill(-1);
    const closed = new Uint8Array(nodes.length);
    const heap: [number, number][] = [];
    const push = (id: number, f: number) => {
      heap.push([f, id]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top[1];
    };
    const goal = nodes[to];
    const h = (id: number) => {
      const n = nodes[id];
      return Math.hypot(n.x - goal.x, n.y - goal.y, n.z - goal.z);
    };
    g[from] = 0;
    push(from, h(from));
    let iter = 0;
    while (heap.length && iter++ < 20000) {
      const cur = pop();
      if (cur === to) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      for (const e of nodes[cur].edges) {
        const ng = g[cur] + e.cost;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = cur;
          push(e.to, ng + h(e.to));
        }
      }
    }
    if (came[to] < 0) return [];
    const path: number[] = [];
    for (let c = to; c !== from && c >= 0; c = came[c]) path.push(c);
    path.reverse();
    return path;
  }

  edgeIsJump(a: number, b: number): boolean {
    const n = this.nodes[a];
    if (!n) return false;
    for (const e of n.edges) if (e.to === b) return e.jump;
    return false;
  }
}
