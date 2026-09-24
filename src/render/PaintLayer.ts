import * as THREE from 'three';
import type { Fighter } from '../sim/fighter';
import { PAINT, type PaintGrid } from '../sim/paint';
import { paintCellMap } from './marker';

// Sketch Slide paint, drawn from the sim's cell data in ONE instanced draw with a fixed budget.
// Each quad is 1.5 cells wide: the opaque core of the texture is exactly the gameplay cell, the
// feathered rim outside it is decoration only. Rebuilt only when the grid's version changes; the
// last 1.5 s of a cell's life dries toward the paper so expiry is visible before it happens.

const DRY = 1.5;
const PAPER = new THREE.Color(0xf3efe6);
const dummy = new THREE.Object3D();
const col = new THREE.Color();

export class PaintLayer {
  readonly mesh: THREE.InstancedMesh;
  private version = -1;
  private grid: PaintGrid | null = null;
  private nextRebuild = 0;

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(PAINT.cell * 1.5, PAINT.cell * 1.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: paintCellMap(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      PAINT.maxCells,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, col.set(0xffffff));
    this.mesh.renderOrder = 1;
  }

  reset() {
    this.grid = null;
    this.version = -1;
    this.mesh.count = 0;
  }

  update(grid: PaintGrid | null, fighters: readonly Fighter[], tick: number, tickRate: number) {
    if (!grid) {
      this.mesh.count = 0;
      return;
    }
    // rebuild on change, and while any cell is drying (colour fades toward paper)
    if (grid === this.grid && grid.version === this.version && tick < this.nextRebuild) return;
    this.grid = grid;
    this.version = grid.version;
    const world = grid.world;
    let n = 0;
    let next = Infinity;
    for (const cell of grid.cells.values()) {
      if (cell.expire <= tick) continue;
      const x = (cell.cx + 0.5) * PAINT.cell, z = (cell.cz + 0.5) * PAINT.cell;
      dummy.position.set(x, grid.cellHeight(cell) + 0.012, z);
      dummy.rotation.set(0, 0, 0);
      const ri = cell.surface - 1 - world.boxes.length;
      if (ri >= 0) {
        const r = world.ramps[ri];
        const k = (r.h1 - r.h0) / (r.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0);
        if (r.axis === 'x') dummy.rotation.set(0, 0, Math.atan(k));
        else dummy.rotation.set(-Math.atan(k), 0, 0);
      }
      dummy.updateMatrix();
      this.mesh.setMatrixAt(n, dummy.matrix);
      const owner = fighters.find((f) => f.id === cell.owner);
      col.set(owner ? owner.color : 0x24242c);
      const left = (cell.expire - tick) / tickRate;
      if (left < DRY) {
        col.lerp(PAPER, 1 - left / DRY);
        next = tick + 1; // drying cells animate every tick
      } else next = Math.min(next, cell.expire - DRY * tickRate);
      this.mesh.setColorAt(n, col);
      n++;
    }
    this.nextRebuild = next;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
