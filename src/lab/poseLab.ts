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
  /** dodge roll progress 0..1, and the dash direction in degrees from the aim (0 forward, +90 right) */
  roll?: number;
  rdir?: number;
  /** velocity in the facing frame (m/s forward / right) */
  vf?: number;
  vr?: number;
  /** hit reaction from a bullet travelling along (f) / across (r) the facing, that many seconds before the end (f -1 = from the front) */
  hit?: { f: number; r: number; ago: number; head?: boolean };
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
  ? row(7, (i) => ({ w: weaponQ ?? 'ar', roll: (i + 0.5) / 7, rdir: Number(qs.get('rdir') ?? 0), vf: 9 }))
  : qs.get('set') === 'rolldirs'
  ? [0, 90, -90, 155, -155].flatMap((rdir) => [0.18, 0.4, 0.62].map((roll) => ({ w: weaponQ ?? 'ar', roll, rdir, vf: 9 })))
  : qs.get('set') === 'crouchwalk'
  ? [
      { w: 'ar', crouching: true, height: MOVE.crouchHeight },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight, vf: 2.8 },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight, vf: -2.8 },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight, vr: 2.8 },
      { w: 'ar', crouching: true, height: MOVE.crouchHeight, vr: -2.8 },
      { w: 'ar', vf: 6.4 },
      { w: 'ar', vf: 9.5 },
      { w: 'ar', sliding: true, height: MOVE.crouchHeight, vf: 10 },
    ]
  : qs.get('set') === 'react'
  ? [
      { w: 'ar' },
      { w: 'ar', hit: { f: -1, r: 0, ago: 0.12 } },
      { w: 'ar', hit: { f: -1, r: 0, ago: 0.24 } },
      { w: 'ar', hit: { f: 0, r: 1, ago: 0.14 } },
      { w: 'ar', hit: { f: 0, r: -1, ago: 0.14 } },
      { w: 'ar', hit: { f: 1, r: 0, ago: 0.14 } },
      { w: 'ar', hit: { f: -1, r: 0, ago: 0.12, head: true } },
      { w: 'ar', hit: { f: -1, r: 0, ago: 0.26, head: true } },
      { w: 'ar', hit: { f: -1, r: 0, ago: 0.42, head: true } },
      { w: 'ar', deadAgo: 0.9 },
      { w: 'ar', deadAgo: 1.8 },
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
      { w: weaponQ ?? 'sniper', vf: 6.4 },
      { w: weaponQ ?? 'sniper', vr: 6 },
      { w: weaponQ ?? 'sniper', vf: -5 },
      { w: weaponQ ?? 'sniper', crouching: true, height: MOVE.crouchHeight },
      { w: weaponQ ?? 'sniper', sliding: true, height: MOVE.crouchHeight, vf: 10 },
      { w: weaponQ ?? 'sniper', onGround: false, vf: 5, vy: 3 } as Setup,
    ]
  : qs.get('set') === 'walks'
  ? [
      { w: 'ar', vf: 1.5 },
      { w: 'sniper', vf: 1.5 },
      { w: 'sniper', vf: 1.2, ads: 1 },
      { w: 'sniper', vr: 1.2, ads: 1 },
      { w: 'sniper', vr: -1.2, ads: 1 },
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
  if (s.roll !== undefined) { f.rollTimer = MOVE.rollTime * (1 - s.roll); f.dashAir = false; }
  if (s.deadAgo !== undefined) f.alive = true;
});
const cam = new THREE.PerspectiveCamera(view === 'fp' ? 60 : 32, W / H, 0.03, 200);
const span = setups.length * 1.9;
const zoom = Number(qs.get('zoom') ?? 1);
if (view === 'side') { cam.position.set(0, 1.1, (span * 1.3) / zoom); }
else if (view === 'front') { cam.position.set(0, 1.1, (-span * 1.25) / zoom); }
else if (view === 'back') { cam.position.set(0, 1.2, (span * 1.25) / zoom); }
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
setups.forEach((s, i) => {
  const f = fighters[i];
  const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
  if (s.vf !== undefined || s.vr !== undefined) {
    f.vel.x = fx * (s.vf ?? 0) + rx * (s.vr ?? 0);
    f.vel.z = fz * (s.vf ?? 0) + rz * (s.vr ?? 0);
  }
  if (s.roll !== undefined) {
    const a = ((s.rdir ?? 0) * Math.PI) / 180;
    f.dashDirX = fx * Math.cos(a) + rx * Math.sin(a);
    f.dashDirZ = fz * Math.cos(a) + rz * Math.sin(a);
  }
});
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
const swayLo: number[][] = [], swayHi: number[][] = [];
for (let i = 0; i < N; i++) {
  const now = (t * (i + 1)) / N;
  setups.forEach((s, k) => {
    const f = fighters[k], trigger = (ago: number) => now >= t - ago && now - t / N < t - ago;
    if (s.swing && trigger(s.swing.ago)) { f.lastMeleeTime = now; f.lastMeleeHeavy = !!s.swing.heavy; }
    if (s.hit && trigger(s.hit.ago)) {
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
      rr.hurt(f.id, fx * s.hit.f + rx * s.hit.r, fz * s.hit.f + rz * s.hit.r, s.hit.head);
    }
    if (s.deadAgo !== undefined && trigger(s.deadAgo)) f.alive = false;
  });
  rr.update(t / N, fighters, 1, now, world, cam, { hideHeadOf: view === 'fp' ? idx : -1, localId: -1, viewYaw: 0, viewPitch: 0 });
  if (qs.get('swaylog') && i >= N / 2) {
    fighters.forEach((f, k) => {
      const c = (rr as unknown as { chars: Map<number, { guns: Record<string, THREE.Object3D>; gunKey: string | null }> }).chars.get(f.id)!;
      const g = c.gunKey ? c.guns[c.gunKey] : null;
      if (!g) return;
      const lo = (swayLo[k] ??= [1e9, 1e9, 1e9]), hi = (swayHi[k] ??= [-1e9, -1e9, -1e9]);
      [g.position.x - f.pos.x, g.position.y, g.position.z - f.pos.z].forEach((v, j) => { lo[j] = Math.min(lo[j], v); hi[j] = Math.max(hi[j], v); });
    });
  }
}
if (qs.get('swaylog')) fighters.forEach((f, k) => console.error(`gaps sway #${k} ${f.weapons[0].id} gun position range (cm) x ${((swayHi[k][0] - swayLo[k][0]) * 100).toFixed(1)} y ${((swayHi[k][1] - swayLo[k][1]) * 100).toFixed(1)} z ${((swayHi[k][2] - swayLo[k][2]) * 100).toFixed(1)}`));
if (qs.get('gaps')) {
  // how far each hand is from the gun's grip / support socket (cm), per fighter
  const { WEAPON_MODELS, MODEL_FOR } = await import('../config/weaponModels');
  fighters.forEach((f, k) => {
    const c = (rr as unknown as { chars: Map<number, { b: Record<string, THREE.Bone>; guns: Record<string, THREE.Object3D>; gunKey: string | null; root: THREE.Object3D }> }).chars.get(f.id)!;
    const key = c.gunKey as keyof typeof WEAPON_MODELS | null;
    if (!key || !c.guns[key]) { console.error(`gaps #${k} (no gun)`); return; }
    const g = c.guns[key]; g.updateMatrixWorld(true); c.root.updateMatrixWorld(true);
    const m = WEAPON_MODELS[key];
    const sock = (v: number[]) => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(g.matrixWorld);
    const rh = c.b.RightHand.getWorldPosition(new THREE.Vector3()), lh = c.b.LeftHand.getWorldPosition(new THREE.Vector3());
    // the support hand may hold the gun anywhere between the grip and the handguard socket
    const A = sock(m.grip), Bp = sock(m.support), ab = Bp.clone().sub(A), tt = Math.max(0, Math.min(1, lh.clone().sub(A).dot(ab) / Math.max(1e-6, ab.lengthSq())));
    const lineGap = lh.distanceTo(A.clone().addScaledVector(ab, tt));
    console.error(`gaps #${k} ${f.weapons[0].id} R ${(rh.distanceTo(A) * 100).toFixed(1)} cm  L ${(lineGap * 100).toFixed(1)} cm from the gun (socket ${(lh.distanceTo(Bp) * 100).toFixed(1)})`);
  });
  void MODEL_FOR;
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
