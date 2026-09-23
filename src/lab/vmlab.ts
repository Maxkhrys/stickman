// Dev-only harness: renders the viewmodel in isolation with scriptable state, and reports where
// the sights project on screen (used by automated alignment checks). Not part of the game build.
import * as THREE from 'three';
import { Viewmodel, type ViewmodelInput } from '../render/Viewmodel';
import type { WeaponId } from '../sim/types';

const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.autoClear = false;
const world = new THREE.Scene();
world.background = new THREE.Color(0xfbf8f1);
const cam = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
// context: a target board 20 m ahead with rings, floor grid
const grid = new THREE.GridHelper(80, 40, 0x9fb7d8, 0xc9d6e8);
grid.position.y = -1.6;
world.add(grid);
for (const [r, c] of [[0.6, 0x1b1b24], [0.45, 0xff4f9a], [0.3, 0xffffff], [0.12, 0x1b1b24]] as const) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: c }));
  m.position.set(0, 0, -20 + (0.6 - r) * 0.01);
  world.add(m);
}
const vm = new Viewmodel();
const state: ViewmodelInput = {
  weapon: 'ar', ads: 0, drawProgress: 0, reloadProgress: -1, boltProgress: -1, magFrac: 0.7, magEmpty: false, sinceShot: 9,
  speed: 0, grounded: true, sliding: false, crouching: false, mouseDX: 0, mouseDY: 0, meleeT: 9, meleeHeavy: false, meleeSide: 1,
  alive: true, motionScale: 1, scopeCover: 0,
};

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  vm.setAspect(w / h);
}
resize();
window.addEventListener('resize', resize);

function frame(dt = 1 / 60) {
  vm.update(dt, state);
  renderer.clear();
  renderer.render(world, cam);
  renderer.clearDepth();
  renderer.render(vm.scene, vm.camera);
}

function project(o: THREE.Object3D) {
  const p = o.getWorldPosition(new THREE.Vector3()).project(vm.camera);
  return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, z: p.z };
}

(window as unknown as { lab: unknown }).lab = {
  set(p: Partial<ViewmodelInput>) {
    Object.assign(state, p);
  },
  /** run n frames (lets springs settle) */
  run(n = 30, dt = 1 / 60) {
    for (let i = 0; i < n; i++) frame(dt);
  },
  fire() {
    vm.fire(state.weapon as WeaponId, vm.adsE);
  },
  sights() {
    const r = vm.rigs[state.weapon as WeaponId];
    const handL = vm.scene.getObjectByName('handL')!;
    return {
      rear: project(r.sockets.rearSight),
      front: project(r.sockets.frontSight),
      muzzle: project(r.sockets.muzzle),
      mag: r.sockets.magGrab ? project(r.sockets.magGrab) : null,
      handL: project(handL),
      w: window.innerWidth,
      h: window.innerHeight,
    };
  },
  info() {
    return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  },
};
frame();
