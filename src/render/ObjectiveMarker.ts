import * as THREE from 'three';
import type { ObjectiveInfo } from '../sim/match';

export class ObjectiveMarker {
  readonly group = new THREE.Group();
  private material = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  private fill = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  constructor() {
    const edge = new THREE.Mesh(new THREE.RingGeometry(3.87, 4, 64), this.material);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(3.87, 48), this.fill);
    for (const m of [fill, edge]) { m.rotation.x = -Math.PI / 2; this.group.add(m); }
    for (let i = 0; i < 4; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), this.material);
      post.position.set(Math.cos(i * Math.PI / 2) * 4, 0.3, Math.sin(i * Math.PI / 2) * 4);
      this.group.add(post);
    }
    this.group.visible = false;
  }
  update(info: ObjectiveInfo | null | undefined, local: number) {
    this.group.visible = !!info;
    if (!info) return;
    this.group.position.set(info.x, info.y + 0.035, info.z);
    const color = info.contested ? 0xff4f9a : info.owner === local ? 0x3ddc84 : info.owner >= 0 ? 0xff715b : 0xffd23f;
    this.material.color.setHex(color); this.fill.color.setHex(color);
  }
}
