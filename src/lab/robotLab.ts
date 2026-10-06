// Dev-only pose sheet: robotlab.html?clips=idle,runF&phases=5&view=side
// Renders each clip at evenly spaced phases on the robot so retargeting can be judged frame by frame.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadClipLibrary, PoseAccumulator } from '../render/robot/clips';

const qs = new URLSearchParams(location.search);
const lib = await loadClipLibrary(qs.get('lib') ?? '/assets/robot/_candidates.json');
const names = (qs.get('clips') ?? Object.keys(lib.clips).slice(0, 4).join(',')).split(',');
const phases = Number(qs.get('phases') ?? 5);
const view = qs.get('view') ?? 'side';
const W = 220 * phases, H = 260 * names.length;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true });
r.setSize(W, H, false);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7f8fa0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(2, 4, 3);
scene.add(sun);
const gltf = await new GLTFLoader().loadAsync('/assets/robot/robot.glb');
const S = 1.8;
const lbl = document.getElementById('lbl')!;
const acc = new PoseAccumulator(lib.bones.length);
const q = new THREE.Quaternion();
names.forEach((name, row) => {
  const clip = lib.clips[name];
  for (let c = 0; c < phases; c++) {
    const m = SkeletonUtils.clone(gltf.scene);
    m.scale.setScalar(S);
    m.position.set(c * 1.6, -row * 2.2, 0);
    if (view === 'side') m.rotation.y = Math.PI / 2;
    if (view === 'back') m.rotation.y = Math.PI;
    if (view === 'q') m.rotation.y = Math.PI / 4;
    scene.add(m);
    const bones: Record<string, THREE.Bone> = {};
    m.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o as THREE.Bone; });
    const u = phases === 1 ? 0 : c / (phases - (clip.loop ? 0 : 1));
    acc.reset();
    clip.accumulate(u, 1, acc);
    lib.bones.forEach((b, j) => acc.read(j, bones[b].quaternion, q));
    bones.Hips.position.x += acc.hip[0];
    bones.Hips.position.y += acc.hip[1];
    bones.Hips.position.z += acc.hip[2];
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${c * 220 + 4}px;top:${row * 260 + 4}px;color:#fff`;
    d.textContent = `${name} ${u.toFixed(2)}`;
    lbl.appendChild(d);
  }
});
// grid floor lines per row
for (let row = 0; row < names.length; row++) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(1.6 * phases, 0.01, 1.2), new THREE.MeshLambertMaterial({ color: 0x55606c }));
  g.position.set(1.6 * (phases - 1) / 2, -row * 2.2 - 0.005, 0);
  scene.add(g);
}
const cam = new THREE.OrthographicCamera(-0.8, 1.6 * phases - 0.8, 1.15 + 0.85, 1.15 - 2.2 * names.length + 0.85, 0.1, 50);
cam.position.set(0, 0, 10);
r.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
