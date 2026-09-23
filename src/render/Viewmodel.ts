import * as THREE from 'three';
import { makeFlashTexture } from './textures';
import { setBone } from './Stickman';
import type { WeaponId } from '../sim/types';

interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  mag: THREE.Object3D | null;
  gripR: THREE.Object3D;
  gripL: THREE.Object3D;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
}

class Spring {
  x = 0;
  v = 0;
  constructor(private k: number, private c: number) {}
  step(dt: number) {
    this.v += (-this.k * this.x - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
}

const INK = 0x1b1b24;
const PINK = 0xff4f9a;
const PURPLE = 0x8b5cf6;
const CYAN = 0x22c6e0;
const YELLOW = 0xffd23f;
const ARM = 0x1b1b24;

const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, color: number, x = 0, y = 0, z = 0, seg = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), new THREE.MeshLambertMaterial({ color }));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function ball(r: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

/** Comic ink outline: inverted-hull copy of every mesh, slightly inflated. */
function outline(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material !== outlineMat) meshes.push(o);
  });
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, outlineMat);
    m.geometry.computeBoundingSphere();
    const r = m.geometry.boundingSphere!.radius;
    o.scale.setScalar(1 + Math.min(0.12, 0.006 / Math.max(r, 0.01)) );
    m.add(o);
  }
}

/** "Inkblaster" AR: chunky pink toy body, purple ink tank on top, yellow barrel, cyan mag. */
function buildAR(): GunModel {
  const g = new THREE.Group();
  g.add(box(0.085, 0.11, 0.42, PINK, 0, 0, 0));
  g.add(box(0.09, 0.05, 0.22, PURPLE, 0, -0.02, -0.26));
  g.add(cyl(0.024, 0.2, YELLOW, 0, 0.01, -0.45, 8));
  g.add(cyl(0.034, 0.05, INK, 0, 0.01, -0.56, 8));
  g.add(box(0.07, 0.11, 0.2, PURPLE, 0, -0.015, 0.29));
  // side-mounted ink tank (kept out of the sight line)
  g.add(ball(0.046, PURPLE, 0.062, -0.01, 0.06));
  g.add(cyl(0.012, 0.05, INK, 0.03, 0.0, 0.06, 8));
  const grip = box(0.055, 0.13, 0.06, INK, 0, -0.1, 0.1);
  grip.rotation.x = -0.35;
  g.add(grip);
  const mag = new THREE.Group();
  const magMesh = box(0.055, 0.17, 0.085, CYAN, 0, -0.08, 0);
  magMesh.rotation.x = 0.18;
  mag.add(magMesh);
  mag.position.set(0, -0.05, -0.08);
  g.add(mag);
  g.add(box(0.008, 0.03, 0.01, INK, 0, 0.07, -0.34)); // front post, tip at y=0.085
  // pink ring reflex sight centred on y = 0.085
  g.add(box(0.012, 0.03, 0.02, INK, 0, 0.062, 0.02));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0045, 6, 24), new THREE.MeshLambertMaterial({ color: PINK }));
  ring.position.set(0, 0.085, 0.02);
  g.add(ring);
  outline(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.62);
  g.add(muzzle);
  const gripR = new THREE.Object3D();
  gripR.position.set(0.0, -0.13, 0.12);
  g.add(gripR);
  const gripL = new THREE.Object3D();
  gripL.position.set(0.0, -0.06, -0.28);
  g.add(gripL);
  return { group: g, muzzle, mag, gripR, gripL, hip: new THREE.Vector3(0.2, -0.23, -0.5), ads: new THREE.Vector3(0, -0.085, -0.47) };
}

/** "Highlighter" pistol: cyan slide, yellow frame, pink grip. */
function buildPistol(): GunModel {
  const g = new THREE.Group();
  g.add(box(0.055, 0.07, 0.26, CYAN, 0, 0.03, -0.03));
  g.add(box(0.05, 0.045, 0.2, YELLOW, 0, -0.02, -0.02));
  g.add(cyl(0.018, 0.03, INK, 0, 0.03, -0.17, 8));
  const grip = box(0.05, 0.14, 0.065, PINK, 0, -0.08, 0.07);
  grip.rotation.x = -0.25;
  g.add(grip);
  const mag = new THREE.Group();
  mag.add(box(0.036, 0.11, 0.05, PURPLE, 0, -0.06, 0));
  mag.position.set(0, -0.05, 0.075);
  mag.rotation.x = -0.25;
  g.add(mag);
  g.add(box(0.008, 0.018, 0.012, INK, 0, 0.072, -0.14)); // front post tip at 0.081
  g.add(box(0.009, 0.02, 0.012, INK, -0.014, 0.072, 0.08)); // rear notch
  g.add(box(0.009, 0.02, 0.012, INK, 0.014, 0.072, 0.08));
  outline(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.19);
  g.add(muzzle);
  const gripR = new THREE.Object3D();
  gripR.position.set(0.005, -0.1, 0.09);
  g.add(gripR);
  const gripL = new THREE.Object3D();
  gripL.position.set(-0.03, -0.11, 0.08);
  g.add(gripL);
  return { group: g, muzzle, mag, gripR, gripL, hip: new THREE.Vector3(0.16, -0.19, -0.4), ads: new THREE.Vector3(0, -0.081, -0.36) };
}

/** Sharpened pencil shiv: wood blade + graphite point, yellow hex handle, pink eraser pommel. */
function buildKnife(): GunModel {
  const g = new THREE.Group();
  g.add(cyl(0.024, 0.14, YELLOW, 0, 0, 0.02, 6));
  g.add(cyl(0.026, 0.03, 0xb8bcc6, 0, 0, 0.1, 12));
  g.add(cyl(0.024, 0.04, PINK, 0, 0, 0.13, 12));
  const wood = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.2, 6), new THREE.MeshLambertMaterial({ color: 0xf1cf9a }));
  wood.rotation.x = -Math.PI / 2;
  wood.position.set(0, 0, -0.15);
  g.add(wood);
  const lead = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.06, 6), new THREE.MeshLambertMaterial({ color: 0x333340 }));
  lead.rotation.x = -Math.PI / 2;
  lead.position.set(0, 0, -0.24);
  g.add(lead);
  outline(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.3);
  g.add(muzzle);
  const gripR = new THREE.Object3D();
  gripR.position.set(0, 0, 0.04);
  g.add(gripR);
  const gripL = new THREE.Object3D();
  gripL.position.set(-0.3, -0.25, 0.1);
  g.add(gripL);
  return { group: g, muzzle, mag: null, gripR, gripL, hip: new THREE.Vector3(0.2, -0.2, -0.36), ads: new THREE.Vector3(0.2, -0.2, -0.36) };
}

export interface ViewmodelInput {
  weapon: WeaponId;
  ads: number;
  reloadProgress: number; // -1 none, 0..1
  drawProgress: number; // 0 = done, 1 = just started
  speed: number;
  grounded: boolean;
  sliding: boolean;
  crouching: boolean;
  mouseDX: number;
  mouseDY: number;
  meleeT: number; // since last melee
  meleeHeavy: boolean;
  meleeSide: number;
  alive: boolean;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private guns: Record<WeaponId, GunModel>;
  private root = new THREE.Group();
  private armR: THREE.Mesh;
  private armL: THREE.Mesh;
  private flash: THREE.Sprite;
  private flashT = 0;
  private kickZ = new Spring(260, 22);
  private kickRot = new Spring(220, 18);
  private kickSide = new Spring(200, 20);
  private landDip = new Spring(120, 14);
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private slideTilt = 0;
  private cur: WeaponId = 'ar';
  private adsSmooth = 0;
  private time = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(0.5, 1, 0.3);
    this.scene.add(dl);
    this.guns = { ar: buildAR(), pistol: buildPistol(), melee: buildKnife() };
    for (const g of Object.values(this.guns)) {
      g.group.visible = false;
      this.root.add(g.group);
    }
    this.scene.add(this.root);
    const armMat = new THREE.MeshLambertMaterial({ color: ARM });
    const cg = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.armR = new THREE.Mesh(cg, armMat);
    this.armL = new THREE.Mesh(cg, armMat);
    const hand = new THREE.SphereGeometry(1, 10, 8);
    const hr = new THREE.Mesh(hand, armMat);
    const hl = new THREE.Mesh(hand, armMat);
    hr.name = 'handR';
    hl.name = 'handL';
    this.scene.add(this.armR, this.armL, hr, hl);
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeFlashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.flash.visible = false;
    this.scene.add(this.flash);
    this.guns.ar.group.visible = true;
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  fire(weapon: WeaponId, ads: number) {
    const s = weapon === 'pistol' ? 1.6 : 1;
    const a = 1 - ads * 0.55;
    this.kickZ.v += 1.8 * s * a;
    this.kickRot.v += 4.2 * s * a;
    this.kickSide.v += (Math.random() - 0.5) * 1.2 * a;
    this.flashT = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const sc = (weapon === 'pistol' ? 0.2 : 0.17) * (0.8 + Math.random() * 0.4);
    this.flash.scale.set(sc, sc, 1);
  }

  land(speed: number) {
    this.landDip.v -= Math.min(speed, 20) * 0.045;
  }

  /** world-space muzzle position for tracers (in viewmodel camera space) */
  muzzleOffset(out: THREE.Vector3): THREE.Vector3 {
    const g = this.guns[this.cur];
    g.muzzle.getWorldPosition(out);
    return out;
  }

  update(dt: number, s: ViewmodelInput) {
    this.time += dt;
    if (s.weapon !== this.cur) {
      this.guns[this.cur].group.visible = false;
      this.cur = s.weapon;
      this.guns[this.cur].group.visible = true;
    }
    const gun = this.guns[this.cur];
    this.root.visible = s.alive;
    this.armL.visible = this.armR.visible = s.alive;
    for (const n of ['handR', 'handL']) this.scene.getObjectByName(n)!.visible = s.alive;
    if (!s.alive) {
      this.flash.visible = false;
      return;
    }

    this.kickZ.step(dt);
    this.kickRot.step(dt);
    this.kickSide.step(dt);
    this.landDip.step(dt);
    this.adsSmooth += (s.ads - this.adsSmooth) * (1 - Math.exp(-30 * dt));
    const ads = this.adsSmooth;

    // sway (lags behind mouse)
    const k = 1 - Math.exp(-10 * dt);
    const sm = 1 - ads * 0.8;
    this.swayX += (Math.max(-0.05, Math.min(0.05, -s.mouseDX * 0.0004)) * sm - this.swayX) * k;
    this.swayY += (Math.max(-0.04, Math.min(0.04, s.mouseDY * 0.0004)) * sm - this.swayY) * k;

    // bob
    const moveT = s.grounded && !s.sliding ? Math.min(s.speed / 8, 1.3) : 0;
    this.bobAmt += (moveT - this.bobAmt) * (1 - Math.exp(-8 * dt));
    this.bobPhase += dt * (s.speed * 1.75);
    const bobM = this.bobAmt * (1 - ads * 0.85);
    const bx = Math.sin(this.bobPhase) * 0.014 * bobM;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobM + Math.sin(this.time * 1.6) * 0.003 * (1 - ads);
    this.slideTilt += ((s.sliding ? 1 : 0) - this.slideTilt) * (1 - Math.exp(-10 * dt));

    const base = new THREE.Vector3().lerpVectors(gun.hip, gun.ads, ads);
    const p = gun.group.position;
    p.copy(base);
    p.x += bx + this.swayX + this.slideTilt * -0.04;
    p.y += by + this.swayY + this.landDip.x * 0.5 - this.slideTilt * 0.03 + (s.crouching ? -0.01 : 0);
    p.z += this.kickZ.x * 0.06;
    const r = gun.group.rotation;
    r.set(this.kickRot.x * 0.08 + this.swayY * 2, this.swayX * 2 + this.kickSide.x * 0.03, this.slideTilt * 0.35 + this.swayX * 3, 'YXZ');

    // draw (switch) animation
    if (s.drawProgress > 0) {
      const e = s.drawProgress * s.drawProgress;
      p.y -= 0.25 * e;
      r.x += 0.5 * e;
      r.z -= 0.4 * e;
    }

    // reload animation
    if (gun.mag) gun.mag.position.y = this.cur === 'ar' ? -0.05 : -0.05;
    if (s.reloadProgress >= 0 && gun.mag) {
      const t = s.reloadProgress;
      const env = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
      const eenv = env * env * (3 - 2 * env);
      r.z += 0.55 * eenv;
      r.x += 0.25 * eenv;
      p.y -= 0.04 * eenv;
      p.x -= 0.03 * eenv;
      let magDrop = 0;
      if (t > 0.2 && t < 0.4) magDrop = (t - 0.2) / 0.2;
      else if (t >= 0.4 && t < 0.55) magDrop = 1;
      else if (t >= 0.55 && t < 0.75) magDrop = 1 - (t - 0.55) / 0.2;
      gun.mag.position.y = -0.05 - magDrop * 0.3;
      gun.mag.visible = !(t > 0.38 && t < 0.57);
      if (t > 0.78 && t < 0.9) {
        const j = Math.sin(((t - 0.78) / 0.12) * Math.PI);
        p.z += j * 0.03;
        r.x += j * 0.08;
      }
    } else if (gun.mag) gun.mag.visible = true;

    // melee animation
    if (this.cur === 'melee') {
      r.set(0.2, -0.25, 0.3, 'YXZ');
      if (s.meleeT < 0.5) {
        if (s.meleeHeavy) {
          const wind = Math.min(s.meleeT / 0.3, 1);
          const stab = s.meleeT > 0.3 ? Math.sin(Math.min((s.meleeT - 0.3) / 0.18, 1) * Math.PI) : 0;
          p.z += wind * 0.12 * (1 - stab) - stab * 0.28;
          p.y += wind * 0.05;
          r.x += wind * 0.6 - stab * 0.9;
        } else {
          const t = Math.min(s.meleeT / 0.28, 1);
          const a = Math.sin(t * Math.PI);
          const side = s.meleeSide;
          p.x += (0.5 - t) * 0.35 * side * a - 0.05 * a;
          p.z -= a * 0.15;
          r.y += side * (t - 0.5) * 1.4 * a;
          r.z += side * 0.9 * a;
          r.x -= a * 0.3;
        }
      }
    }

    // arms (stickman lines from off-screen shoulders to grips)
    this.scene.updateMatrixWorld(true);
    const gr = new THREE.Vector3();
    const gl = new THREE.Vector3();
    gun.gripR.getWorldPosition(gr);
    gun.gripL.getWorldPosition(gl);
    if (this.cur === 'melee') gl.set(-0.35 + this.swayX, -0.35 + by, -0.4);
    if (s.reloadProgress >= 0 && gun.mag && s.reloadProgress > 0.15 && s.reloadProgress < 0.8) {
      gun.mag.getWorldPosition(gl);
      gl.y -= 0.06;
    }
    const shR = new THREE.Vector3(0.32, -0.55, 0.05);
    const shL = new THREE.Vector3(-0.32, -0.55, 0.0);
    setBone(this.armR, shR, gr, 0.028);
    setBone(this.armL, shL, gl, 0.028);
    const hr = this.scene.getObjectByName('handR')!;
    const hl = this.scene.getObjectByName('handL')!;
    hr.position.copy(gr);
    hl.position.copy(gl);
    hr.scale.setScalar(0.034);
    hl.scale.setScalar(0.034);

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      gun.muzzle.getWorldPosition(this.flash.position);
      this.flash.visible = this.cur !== 'melee';
    } else this.flash.visible = false;

    this.camera.fov = 60 - ads * 8;
    this.camera.updateProjectionMatrix();
  }
}
