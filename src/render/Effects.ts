import * as THREE from 'three';
import { makeFlashTexture, makeSplatTexture } from './textures';

const MAX_PARTICLES = 600;
const MAX_TRACERS = 32;
const MAX_HOLES = 96;
const MAX_SPLATS = 64;

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grav: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

const dummy = new THREE.Object3D();
const Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private pMesh: THREE.InstancedMesh;
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private holes: THREE.InstancedMesh;
  private holeIdx = 0;
  private flashes: { s: THREE.Sprite; life: number }[] = [];
  private flashIdx = 0;
  private color = new THREE.Color();
  private splats: THREE.InstancedMesh;
  private splatIdx = 0;

  constructor() {
    const pg = new THREE.BoxGeometry(1, 1, 1);
    this.pMesh = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0.05, grav: 1 });
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.pMesh.setMatrixAt(i, dummy.matrix);
      this.pMesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.group.add(this.pMesh);

    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(
        tg,
        new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.visible = false;
      m.frustumCulled = false;
      this.tracers.push({ mesh: m, life: 0, max: 0.08 });
      this.group.add(m);
    }

    const hg = new THREE.CircleGeometry(0.06, 8);
    this.holes = new THREE.InstancedMesh(
      hg,
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_HOLES,
    );
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_HOLES; i++) this.holes.setMatrixAt(i, dummy.matrix);
    this.holes.frustumCulled = false;
    this.group.add(this.holes);

    // kill splats: arena gets painted in the colours of the fallen
    this.splats = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeSplatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      MAX_SPLATS,
    );
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_SPLATS; i++) {
      this.splats.setMatrixAt(i, dummy.matrix);
      this.splats.setColorAt(i, this.color.set(0xffffff));
    }
    this.splats.frustumCulled = false;
    this.group.add(this.splats);

    const ft = makeFlashTexture();
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.flashes.push({ s, life: 0 });
      this.group.add(s);
    }
  }

  clear() {
    for (const p of this.particles) p.alive = false;
    for (const t of this.tracers) t.mesh.visible = false;
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_HOLES; i++) this.holes.setMatrixAt(i, dummy.matrix);
    this.holes.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_SPLATS; i++) this.splats.setMatrixAt(i, dummy.matrix);
    this.splats.instanceMatrix.needsUpdate = true;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, thick = 0.018, color = 0xffe9a0) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(thick, thick, len);
    t.life = t.max = 0.07;
    (t.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    t.mesh.visible = true;
  }

  worldFlash(pos: THREE.Vector3, scale = 0.5) {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.s.position.copy(pos);
    f.s.scale.set(scale, scale, 1);
    f.s.material.rotation = Math.random() * Math.PI;
    f.s.visible = true;
    f.life = 0.05;
  }

  inkSplat(x: number, y: number, z: number, color: number, size: number) {
    dummy.position.set(x, y + 0.015 + this.splatIdx * 0.0002, z);
    dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    this.splats.setMatrixAt(this.splatIdx, dummy.matrix);
    this.splats.setColorAt(this.splatIdx, this.color.set(color));
    this.splatIdx = (this.splatIdx + 1) % MAX_SPLATS;
    this.splats.instanceMatrix.needsUpdate = true;
    this.splats.instanceColor!.needsUpdate = true;
  }

  bulletHole(pos: THREE.Vector3, normal: THREE.Vector3) {
    dummy.position.copy(pos).addScaledVector(normal, 0.01);
    dummy.quaternion.setFromUnitVectors(Z, normal);
    dummy.scale.setScalar(0.7 + Math.random() * 0.6);
    dummy.updateMatrix();
    this.holes.setMatrixAt(this.holeIdx, dummy.matrix);
    this.holeIdx = (this.holeIdx + 1) % MAX_HOLES;
    this.holes.instanceMatrix.needsUpdate = true;
  }

  burst(pos: THREE.Vector3, color: number, count: number, speed: number, size = 0.05, life = 0.5, grav = 1, dir?: THREE.Vector3) {
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      const p = this.particles[i];
      if (p.alive) continue;
      p.alive = true;
      p.p.copy(pos);
      p.v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      if (dir) p.v.addScaledVector(dir, speed * 0.6);
      p.v.y += speed * 0.3;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.grav = grav;
      this.pMesh.setColorAt(i, this.color.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      spawned++;
    }
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this.burst(pos, 0xffd070, 5, 5, 0.035, 0.25, 1.2, normal);
    this.burst(pos, 0xbdb6a8, 4, 2, 0.06, 0.45, 0.6, normal);
    this.bulletHole(pos, normal);
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        dummy.scale.setScalar(0);
      } else {
        p.v.y -= 18 * p.grav * dt;
        p.p.addScaledVector(p.v, dt);
        if (p.p.y < 0.02) {
          p.p.y = 0.02;
          p.v.y *= -0.3;
          p.v.x *= 0.7;
          p.v.z *= 0.7;
        }
        dummy.position.copy(p.p);
        dummy.rotation.set(p.life * 10, p.life * 7, 0);
        dummy.scale.setScalar(p.size * Math.min(1, (p.life / p.max) * 2));
      }
      dummy.updateMatrix();
      this.pMesh.setMatrixAt(i, dummy.matrix);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else (t.mesh.material as THREE.MeshBasicMaterial).opacity = t.life / t.max;
    }
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.life -= dt;
      if (f.life <= 0) f.s.visible = false;
    }
  }
}
