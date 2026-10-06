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

type Setup = Partial<Fighter> & { w: WeaponId; vx?: number; vz?: number };
const weaponQ = qs.get('weapon') as WeaponId | null;
const adsQ = Number(qs.get('ads') ?? 0);
const setups: Setup[] = qs.get('set') === 'moves'
  ? [
      { w: weaponQ ?? 'sniper', vz: -6.4 },
      { w: weaponQ ?? 'sniper', vx: 6 },
      { w: weaponQ ?? 'sniper', vz: 5 },
      { w: weaponQ ?? 'sniper', crouching: true, height: MOVE.crouchHeight },
      { w: weaponQ ?? 'sniper', sliding: true, height: MOVE.crouchHeight, vz: -10 },
      { w: weaponQ ?? 'sniper', onGround: false, vz: -5, vy: 3 } as Setup,
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
const cam = new THREE.PerspectiveCamera(view === 'fp' ? 60 : 32, W / H, 0.03, 200);
const span = setups.length * 1.9;
if (view === 'side') { cam.position.set(0, 1.3, span * 1.3); }
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
for (let i = 0; i < 20; i++) rr.update(t / 20, fighters, 1, t * (i + 1) / 20, world, cam, { hideHeadOf: view === 'fp' ? idx : -1, localId: -1, viewYaw: 0, viewPitch: 0 });
r.render(scene, cam);
(window as unknown as { done: boolean }).done = true;
