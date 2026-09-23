import * as THREE from 'three';
import { buildWeaponRigs } from './vm/weapons';
import type { PrimaryId } from '../config/weapons';
let cache: Partial<Record<PrimaryId, string>> | null = null;
/** Photograph actual weapon rigs once. No animation loop or permanent WebGL context. */
export function weaponPortraits(): Partial<Record<PrimaryId, string>> {
  if (cache) return cache;
  cache = {};
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(540, 240);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa8bb, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(2, 4, 3); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 540 / 240, 0.01, 20);
  const rigs = buildWeaponRigs();
  for (const id of ['ar', 'sniper', 'smg', 'carbine'] as const) {
    const model = rigs[id].root;
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.z / camera.aspect, size.y) / (2 * Math.tan(Math.PI / 12)) * 1.55;
    camera.position.copy(center).add(new THREE.Vector3(distance, distance * 0.25, distance * 0.18));
    camera.lookAt(center);
    renderer.render(scene, camera);
    cache[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(model);
  }
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const rig of Object.values(rigs)) rig.root.traverse(o => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
  renderer.dispose(); renderer.forceContextLoss();
  return cache;
}
