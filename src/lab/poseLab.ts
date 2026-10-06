// Dev-only: robot + weapon pose sheet driven by the real RobotRenderer.
// poselab.html?view=q|side|front|fp&weapon=sniper&ads=0
import * as THREE from 'three';
import { RobotRenderer, loadRobotAssets } from '../render/robot/RobotRenderer';
import { createFighter, eyePos, type Fighter } from '../sim/fighter';
import { MAPS } from '../sim/map';
import { World } from '../sim/world';
import { MOVE } from '../config/movement';
import type { WeaponId } from '../sim/types';
import type { Effects } from '../render/Effects';

const qs = new URLSearchParams(location.search);
const view = qs.get('view') ?? 'q';
const W = Number(qs.get('w') ?? 1400), H = Number(qs.get('h') ?? 700);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true });
r.setSize(W, H, false);
r.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa0b0);
scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a6458, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(2, 4, 3);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x777066 }));
scene.add(floor);
const A = await loadRobotAssets('/');
const rr = new RobotRenderer(null as unknown as Effects, A);
rr.playerChar = (qs.get('char') ?? 'armored') as 'armored' | 'robot';
scene.add(rr.group);
const world = new World({ ...MAPS.range, boxes: [], ramps: [] });

type Setup = Partial<Fighter> & {
  w: WeaponId; vx?: number; vz?: number;
  /** melee swing that began this many seconds before the end of the run */
  swing?: { heavy?: boolean; ago: number };
  /** dodge roll progress 0..1 */
  roll?: number;
  /** hit reaction from this bullet direction, that many seconds before the end */
  hit?: { dx: number; dz: number; ago: number };
  /** killed this many seconds before the end */
  deadAgo?: number;
};
const row = (n: number, f: (i: number) => Setup): Setup[] => Array.from({ length: n }, (_, i) => f(i));
const weaponQ = qs.get('weapon') as WeaponId | null;
const adsQ = Number(qs.get('ads') ?? 0);
const setups: Setup[] = qs.get('set') === 'melee'
  ? [
      { w: 'melee' },
      ...[0.05, 0.1, 0.16, 0.24].map((ago) => ({ w: 'melee' as WeaponId, swing: { ago } })),
      ...[0.1, 0.22, 0.34, 0.48, 0.62].map((ago) => ({ w: 'melee' as WeaponId, swing: { heavy: true, ago } })),
    ]
  : qs.get('set') === 'roll'
  ? row(7, (i) => ({ w: weaponQ ?? 'ar', roll: (i + 0.5) / 7, vz: -9 }))
  : qs.get('set') === 'react'
  ? [
      { w: 'ar', hit: { dx: 0, dz: 1, ago: 0.08 } },
      { w: 'ar', hit: { dx: 0, dz: 1, ago: 0.2 } },
      { w: 'ar', hit: { dx: 1, dz: 0, ago: 0.12 } },
      { w: 'ar', hit: { dx: 1, dz: 0, ago: 0.24 } },
      { w: 'ar', hit: { dx: 0, dz: -1, ago: 0.12 } },
      { w: 'ar', hit: { dx: 0, dz: -1, ago: 0.26 } },
      { w: 'ar', deadAgo: 0.4 },
      { w: 'ar', deadAgo: 0.9 },
      { w: 'ar', deadAgo: 1.5 },
      { w: 'ar', deadAgo: 2.2 },
    ]
  : qs.get('set') === 'stance'
  ? [
      { w: 'ar' },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight, vz: -3 },
      { w: 'sniper', crouching: true, height: MOVE.crouchHeight },
      { w: 'ar', vz: -1.5 },
      { w: 'ar', vz: -6.4 },
      { w: 'ar', sliding: true, height: MOVE.crouchHeight, vz: -10 },
    ]
  : qs.get('set') === 'moves'
  ? [
      { w: weaponQ ?? 'sniper', vz: -6.4 },
      { w: weaponQ ?? 'sniper', vx: 6 },
      { w: weaponQ ?? 'sniper', vz: 5 },
      { w: weaponQ ?? 'sniper', crouching: true, height: MOVE.crouchHeight },
      { w: weaponQ ?? 'sniper', sliding: true, height: MOVE.crouchHeight, vz: -10 },
      { w: weaponQ ?? 'sniper', onGround: false, vz: -5, vy: 3 } as Setup,
    ]
  : qs.get('set') === 'walks'
  ? [
      { w: 'ar', vz: -1.5 },
      { w: 'sniper', vz: -1.5 },
      { w: 'sniper', vz: -1.2, ads: 1 },
      { w: 'sniper', vx: 1.2, ads: 1 },
      { w: 'sniper', vx: -1.2, ads: 1 },
    ]
  : (['sniper', 'ar', 'smg', 'pistol'] as WeaponId[]).flatMap((w) => [{ w, ads: adsQ }, { w, ads: 1 }]);
const fighters: Fighter[] = setups.map((s, i) => {
  const f = createFighter(i, 'f' + i, 0xffffff, 'player', [s.w]);
  f.alive = true;
  f.pos.x = f.prevPos.x = (i - (setups.length - 1) / 2) * 1.9;
  f.yaw = f.prevYaw = Number(qs.get('yaw') ?? 0);
  f.pitch = f.prevPitch = Number(qs.get('pitch') ?? 0);
  f.ads = f.prevAds = s.ads ?? 0;
  f.crouching = !!s.crouching;
  f.sliding = !!s.sliding;
  f.height = f.prevHeight = s.height ?? MOVE.standHeight;
  f.onGround = s.onGround ?? true;
  f.vel.x = s.vx ?? 0;
  f.vel.z = s.vz ?? 0;
  f.vel.y = (s as { vy?: number }).vy ?? 0;
  if (!f.onGround) { f.pos.y = f.prevPos.y = 0.8; }
  f.lastShotTime = -99;
  f.switchTimer = 0;
  return f;
});
setups.forEach((s, i) => {
  const f = fighters[i];
  if (s.roll !== undefined) { f.dashDirX = 0; f.dashDirZ = -1; f.rollTimer = MOVE.rollTime * (1 - s.roll); f.dashAir = false; }
  if (s.deadAgo !== undefined) f.alive = true;
});
const cam = new THREE.PerspectiveCamera(view === 'fp' ? 60 : 32, W / H, 0.03, 200);
const span = setups.length * 1.9;
const zoom = Number(qs.get('zoom') ?? 1);
if (view === 'side') { cam.position.set(0, 1.1, (span * 1.3) / zoom); }
else if (view === 'front') { cam.position.set(0, 1.4, -span * 1.25); }
else if (view === 'back') { cam.position.set(0, 1.6, span * 1.25); }
else if (view === 'top') { cam.position.set(0, span * 1.4, 0.01); }
else { cam.position.set(span * 0.55, 2.2, -span * 0.95); }
cam.lookAt(0, 1.0, 0);
const focus = qs.get('focus');
if (focus !== null) {
  // close-up of one fighter: offset the whole row so it sits at the origin
  const fx = (Number(focus) - (setups.length - 1) / 2) * 1.9;
  const d = Number(qs.get('dist') ?? 2.6);
  const az = Number(qs.get('az') ?? 0.8);
  cam.fov = 40;
  cam.position.set(fx + Math.sin(az) * d, 1.45, -Math.cos(az) * d);
  cam.lookAt(fx, 1.2, 0);
  cam.updateProjectionMatrix();
}
if (view === 'side') { fighters.forEach((f) => { f.yaw = f.prevYaw = -Math.PI / 2 + Number(qs.get('yaw') ?? 0); }); }
const idx = Number(qs.get('fp') ?? 0);
if (view === 'fp') {
  const f = fighters[idx];
  const e = eyePos(f);
  cam.position.set(e.x, e.y, e.z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(f.pitch, f.yaw, 0);
}
cam.updateMatrixWorld();
const t = Number(qs.get('t') ?? 0.4);
const N = 96;
for (let i = 0; i < N; i++) {
  const now = (t * (i + 1)) / N;
  setups.forEach((s, k) => {
    const f = fighters[k], trigger = (ago: number) => now >= t - ago && now - t / N < t - ago;
    if (s.swing && trigger(s.swing.ago)) { f.lastMeleeTime = now; f.lastMeleeHeavy = !!s.swing.heavy; }
    if (s.hit && trigger(s.hit.ago)) { rr.hurt(f.id, s.hit.dx, s.hit.dz); }
    if (s.deadAgo !== undefined && trigger(s.deadAgo)) f.alive = false;
  });
  rr.update(t / N, fighters, 1, now, world, cam, { hideHeadOf: view === 'fp' ? idx : -1, localId: -1, viewYaw: 0, viewPitch: 0 });
}
if (qs.get('dump')) {
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftFoot'];
  fighters.forEach((f, k) => {
    const c = (rr as unknown as { chars: Map<number, { b: Record<string, THREE.Bone>; root: THREE.Object3D }> }).chars.get(f.id)!;
    c.root.updateMatrixWorld(true);
    const out = names.map((n) => { const v = c.b[n].getWorldPosition(new THREE.Vector3()); return `${n}:${(v.x - f.pos.x).toFixed(2)},${v.y.toFixed(2)}`; });
    console.error(`dump #${k}`, out.join(' '));
  });
}
r.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
