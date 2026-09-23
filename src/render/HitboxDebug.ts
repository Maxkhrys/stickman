import * as THREE from 'three';
import type { Fighter } from '../sim/fighter';
import { buildHitboxes, type Hitbox } from '../sim/hitboxes';
import type { HitPart } from '../sim/types';

// Practice-range overlay: draws the exact sim hitboxes (head / chest / stomach / limb).
const COLORS: Record<HitPart, number> = { head: 0xff3b5c, chest: 0xff9a2e, stomach: 0xffe14a, limb: 0x2fd0ff };

export class HitboxDebug {
  readonly group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  private used = 0;
  private mats: Record<HitPart, THREE.MeshBasicMaterial>;
  private sphere = new THREE.SphereGeometry(1, 12, 8);
  private cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  private box = new THREE.BoxGeometry(2, 2, 2);
  private hb: Hitbox[] = [];
  enabled = false;

  constructor() {
    this.mats = Object.fromEntries(
      (Object.keys(COLORS) as HitPart[]).map((k) => [k, new THREE.MeshBasicMaterial({ color: COLORS[k], wireframe: true, transparent: true, opacity: 0.75, depthTest: false })]),
    ) as Record<HitPart, THREE.MeshBasicMaterial>;
    this.group.renderOrder = 10;
  }

  private mesh(geo: THREE.BufferGeometry, part: HitPart): THREE.Mesh {
    let m = this.pool[this.used];
    if (!m) {
      m = new THREE.Mesh(geo, this.mats[part]);
      m.renderOrder = 10;
      this.pool.push(m);
      this.group.add(m);
    }
    m.geometry = geo;
    m.material = this.mats[part];
    m.visible = true;
    this.used++;
    return m;
  }

  update(fighters: readonly Fighter[], skipId: number) {
    this.used = 0;
    if (this.enabled) {
      for (const f of fighters) {
        if (!f.alive || f.id === skipId) continue;
        buildHitboxes(f, this.hb);
        for (const h of this.hb) {
          if (h.kind === 'obb') {
            const m = this.mesh(this.box, h.part);
            m.position.set(h.a.x, h.a.y, h.a.z);
            m.quaternion.setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(new THREE.Vector3(h.ax.x, h.ax.y, h.ax.z), new THREE.Vector3(h.ay.x, h.ay.y, h.ay.z), new THREE.Vector3(h.az.x, h.az.y, h.az.z)),
            );
            m.scale.set(h.hx, h.hy, h.hz);
          } else {
            const a = new THREE.Vector3(h.a.x, h.a.y, h.a.z), b = new THREE.Vector3(h.b.x, h.b.y, h.b.z);
            const len = a.distanceTo(b);
            for (const p of len > 1e-4 ? [a, b] : [a]) {
              const s = this.mesh(this.sphere, h.part);
              s.position.copy(p);
              s.quaternion.identity();
              s.scale.setScalar(h.r);
            }
            if (len > 1e-4) {
              const c = this.mesh(this.cyl, h.part);
              c.position.addVectors(a, b).multiplyScalar(0.5);
              c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
              c.scale.set(h.r, len, h.r);
            }
          }
        }
      }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
