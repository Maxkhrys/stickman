import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../sim/types';
import { PAL } from './vm/kit';

// Third-person weapons: simplified versions of the viewmodels, merged into ONE geometry per weapon
// with baked vertex colours so every character's gun is a single instanced draw.
// Frame: grip (right hand) at the origin, bore along -Z.

type Piece = { geo: THREE.BufferGeometry; color: number; pos: [number, number, number]; rot?: [number, number, number] };

function bake(pieces: Piece[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  for (const p of pieces) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.deleteAttribute('uv');
    m.compose(new THREE.Vector3(...p.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    c.set(p.color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
    g = null as unknown as THREE.BufferGeometry;
  }
  const merged = mergeGeometries(geos, false)!;
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r: number, len: number, seg = 8) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const coneZ = (r: number, len: number, seg = 8) => new THREE.ConeGeometry(r, len, seg).rotateX(-Math.PI / 2);

export function buildTpGuns(): Record<WeaponId, THREE.BufferGeometry> {
  const ar = bake([
    { geo: box(0.05, 0.07, 0.3), color: PAL.navy, pos: [0, 0.06, -0.08] },
    { geo: box(0.046, 0.05, 0.22), color: PAL.pink, pos: [0, 0.02, -0.06] },
    { geo: cylZ(0.03, 0.26, 8), color: PAL.cyan, pos: [0, 0.06, -0.35] },
    { geo: cylZ(0.011, 0.14, 8), color: PAL.steel, pos: [0, 0.06, -0.54] },
    { geo: coneZ(0.018, 0.06, 8), color: PAL.gold, pos: [0, 0.06, -0.63] },
    { geo: box(0.04, 0.16, 0.05), color: PAL.cyan, pos: [0, -0.04, -0.12], rot: [0.15, 0, 0] },
    { geo: box(0.036, 0.11, 0.04), color: PAL.navy, pos: [0, -0.02, 0.0], rot: [-0.3, 0, 0] },
    { geo: box(0.036, 0.08, 0.2), color: PAL.pink, pos: [0, 0.03, 0.17] },
    { geo: box(0.012, 0.05, 0.03), color: PAL.gold, pos: [0, 0.11, 0.0] },
  ]);
  const sniper = bake([
    { geo: cylZ(0.024, 0.3, 10), color: PAL.graphite, pos: [0, 0.06, -0.1] },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6).rotateX(Math.PI / 2), color: PAL.yellow, pos: [0, 0.06, -0.56] },
    { geo: coneZ(0.02, 0.07, 6), color: PAL.wood, pos: [0, 0.06, -0.9] },
    { geo: cylZ(0.018, 0.3, 10), color: PAL.ink, pos: [0, 0.13, -0.12] },
    { geo: cylZ(0.027, 0.06, 10), color: PAL.ink, pos: [0, 0.13, -0.29] },
    { geo: box(0.036, 0.1, 0.36), color: PAL.gold, pos: [0, 0.02, 0.2] },
    { geo: box(0.036, 0.1, 0.04), color: PAL.graphite, pos: [0, -0.02, 0.0], rot: [-0.25, 0, 0] },
    { geo: box(0.03, 0.05, 0.07), color: PAL.pink, pos: [0, 0.01, -0.12] },
    { geo: new THREE.SphereGeometry(0.016, 8, 6), color: PAL.pink, pos: [0.05, 0.05, 0.02] },
  ]);
  const pistol = bake([
    { geo: box(0.036, 0.04, 0.22), color: PAL.hiYellow, pos: [0, 0.05, -0.06] },
    { geo: box(0.03, 0.03, 0.04), color: PAL.navy, pos: [0, 0.045, -0.19] },
    { geo: box(0.034, 0.1, 0.045), color: PAL.pink, pos: [0, -0.005, 0.0], rot: [-0.25, 0, 0] },
  ]);
  const melee = bake([
    { geo: new THREE.CylinderGeometry(0.016, 0.016, 0.24, 6).rotateX(Math.PI / 2), color: PAL.yellow, pos: [0, 0.0, -0.06] },
    { geo: cylZ(0.017, 0.04, 8), color: PAL.pink, pos: [0, 0.0, 0.08] },
    { geo: coneZ(0.016, 0.06, 6), color: PAL.wood, pos: [0, 0.0, -0.21] },
  ]);
  const smg = ar.clone().scale(1.18, 1, 0.7);
  const carbine = ar.clone().scale(1, 1, 1.18);
  return { ar, sniper, pistol, melee, smg, carbine };
}
