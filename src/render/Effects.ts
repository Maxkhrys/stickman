import * as THREE from 'three';
import { makeDashTexture, makeFlashTexture, makeSplatTexture } from './textures';
import { SAND, sandGrainMap } from './sand';
import { markerSmearMap } from './marker';
import type { World } from '../sim/world';

const MAX_PARTICLES = 600;
const MAX_TRACERS = 32;
const MAX_HOLES = 96;
const MAX_SPLATS = 64;
const MAX_PILES = 12;
/** marker skid smears (hard stops, slides, heavy landings): one instanced draw, bounded pool */
const MAX_SMEARS = 16;
const SMEAR_LIFE = 0.9;
const PAPER = new THREE.Color(0xf3efe6);
const SMEAR_INK = new THREE.Color(0x24242c);

interface Pile { alive: boolean; x: number; y: number; z: number; r: number; age: number; life: number; rot: number }

interface Particle {
  alive: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grav: number;
  sand: boolean;
  floor: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  total: number;
  head: number;
  speed: number;
  len: number;
  thick: number;
  active: boolean;
}

const dummy = new THREE.Object3D();
const tv = new THREE.Vector3();
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
  private world: World | null = null;
  private piles: Pile[] = [];
  private pileMesh: THREE.InstancedMesh;
  private pileIdx = 0;
  private stealIdx = 0;
  setWorld(world: World) { this.world = world; }

  private smears: THREE.InstancedMesh;
  private smearState = Array.from({ length: MAX_SMEARS }, () => ({ age: 99, x: 0, y: 0, z: 0, rot: 0, len: 1, w: 0.3 }));
  private smearIdx = 0;

  constructor() {
    const pg = new THREE.IcosahedronGeometry(1, 0);
    this.pMesh = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 0.05, grav: 1, sand: false, floor: 0 });
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.pMesh.setMatrixAt(i, dummy.matrix);
      this.pMesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.group.add(this.pMesh);
    this.smears = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: markerSmearMap(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      MAX_SMEARS,
    );
    this.smears.frustumCulled = false;
    this.smears.count = 0;
    this.smears.setColorAt(0, SMEAR_INK);
    this.group.add(this.smears);

    // settled sand mounds left by collapsed fighters (fixed pool, recycled oldest-first)
    const mound = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    this.pileMesh = new THREE.InstancedMesh(mound, new THREE.MeshLambertMaterial({ map: sandGrainMap() }), MAX_PILES);
    this.pileMesh.frustumCulled = false;
    for (let i = 0; i < MAX_PILES; i++) {
      this.piles.push({ alive: false, x: 0, y: 0, z: 0, r: 0.5, age: 0, life: 1, rot: 0 });
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.pileMesh.setMatrixAt(i, dummy.matrix);
      this.pileMesh.setColorAt(i, this.color.set(0xffffff));
    }
    this.group.add(this.pileMesh);

    // drawn tracer: two crossed tapered strips (tail thin -> head full), dashed pen-line alpha
    const tg = tracerStrokeGeometry();
    const dash = makeDashTexture();
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: dash.clone() }));
      m.visible = false;
      m.frustumCulled = false;
      this.tracers.push({ mesh: m, from: new THREE.Vector3(), dir: new THREE.Vector3(), total: 0, head: 0, speed: 300, len: 3, thick: 0.02, active: false });
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
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, depthWrite: false, transparent: true }));
      s.visible = false;
      this.flashes.push({ s, life: 0 });
      this.group.add(s);
    }
  }

  /** A short dry-marker skid on the floor along the travel direction; dries into the paper. */
  markerSmear(x: number, y: number, z: number, dirX: number, dirZ: number, length: number, width = 0.28) {
    const s = this.smearState[this.smearIdx];
    this.smearIdx = (this.smearIdx + 1) % MAX_SMEARS;
    Object.assign(s, { age: 0, x, y: y + 0.006, z, rot: Math.atan2(-dirZ, dirX), len: Math.max(0.3, Math.min(2.2, length)), w: width });
  }

  private writeSmears(dt: number) {
    let n = 0;
    for (const s of this.smearState) {
      if (s.age >= SMEAR_LIFE) continue;
      s.age += dt;
      const u = Math.min(1, s.age / SMEAR_LIFE);
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.len, 1, s.w * (1 - 0.35 * u));
      dummy.updateMatrix();
      this.smears.setMatrixAt(n, dummy.matrix);
      this.smears.setColorAt(n, this.color.copy(SMEAR_INK).lerp(PAPER, u * u));
      n++;
    }
    this.smears.count = n;
    this.smears.instanceMatrix.needsUpdate = true;
    if (this.smears.instanceColor) this.smears.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const s of this.smearState) s.age = 99;
    this.smears.count = 0;
    for (const p of this.particles) p.alive = false;
    for (const p of this.piles) p.alive = false;
    this.writePiles();
    for (const f of this.flashes) f.s.visible = false;
    for (const t of this.tracers) {
      t.mesh.visible = false;
      t.active = false;
    }
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < MAX_HOLES; i++) this.holes.setMatrixAt(i, dummy.matrix);
    this.holes.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < MAX_SPLATS; i++) this.splats.setMatrixAt(i, dummy.matrix);
    this.splats.instanceMatrix.needsUpdate = true;
  }

  /**
   * Short ink streak travelling from `from` to `to`. `skip` metres are skipped at the start so
   * your own tracers never sit on top of the sight picture.
   */
  tracer(from: THREE.Vector3, to: THREE.Vector3, thick = 0.018, color = 0xffe9a0, skip = 0, speed = 320, len = 3.2) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.total = t.dir.length();
    if (t.total < 0.05) return;
    t.dir.divideScalar(t.total);
    t.head = Math.min(skip, t.total);
    t.speed = speed;
    t.len = len;
    t.thick = thick;
    t.active = true;
    t.mesh.scale.set(thick, thick, 0.001);
    (t.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    const mat = t.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.95;
    // per-shot dash phase: slightly different pen line every shot, fixed for its short life
    mat.alphaMap!.offset.set(0, Math.random());
    mat.alphaMap!.repeat.set(1, Math.max(1, len / 1.1));
    t.mesh.visible = false;
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
      p.sand = false;
      this.pMesh.setColorAt(i, this.color.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      spawned++;
    }
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  /** A body's worth of sand gathering on the surface below, pushed along the death direction. */
  sandPile(pos: THREE.Vector3, color: number, dir: THREE.Vector3, life = SAND.pileLife) {
    if (!SAND.enabled) return;
    const i = this.pileIdx;
    this.pileIdx = (this.pileIdx + 1) % MAX_PILES;
    const h = Math.hypot(dir.x, dir.z) || 1;
    const x = pos.x + (dir.x / h) * 0.35, z = pos.z + (dir.z / h) * 0.35;
    const y = this.world ? this.world.surfaceBelow(x, z, 0.25, pos.y + 0.2) : 0;
    Object.assign(this.piles[i], { alive: true, x, y, z, r: 0.5 + Math.random() * 0.12, age: 0, life, rot: Math.random() * 6.28 });
    this.pileMesh.setColorAt(i, this.color.set(color).offsetHSL(0, -0.05, -0.04));
    if (this.pileMesh.instanceColor) this.pileMesh.instanceColor.needsUpdate = true;
  }

  private writePiles() {
    for (let i = 0; i < MAX_PILES; i++) {
      const p = this.piles[i];
      if (!p.alive) dummy.scale.setScalar(0);
      else {
        // gather (0.6 s ease-out), hold, then sink into the floor over the last 1.5 s
        const grow = 1 - (1 - Math.min(1, p.age / 0.6)) ** 3;
        const sink = Math.min(1, Math.max(0, (p.life - p.age) / 1.5));
        dummy.position.set(p.x, p.y + 0.004, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.set(p.r * (0.55 + 0.45 * grow), 0.2 * grow * sink + 0.001, p.r * 0.8 * (0.55 + 0.45 * grow));
      }
      dummy.updateMatrix();
      this.pileMesh.setMatrixAt(i, dummy.matrix);
    }
    this.pileMesh.instanceMatrix.needsUpdate = true;
  }

  /** Small pooled grains with real collision-surface settling. Never affects hit detection. */
  sandBurst(pos: THREE.Vector3, color: number, count: number, speed: number, dir?: THREE.Vector3, life = 1.4, sizeMul = 1) {
    if (!SAND.enabled) return;
    let spawned = 0;
    let freeLeft = true;
    for (let n = 0; n < MAX_PARTICLES && spawned < count; n++) {
      // free slots first; once the pool is full, fresh grains recycle the oldest ones (round robin)
      let i = n;
      if (freeLeft && this.particles[i].alive) {
        if (n < MAX_PARTICLES - 1) continue;
        freeLeft = false;
      }
      if (!freeLeft) { i = this.stealIdx; this.stealIdx = (this.stealIdx + 1) % MAX_PARTICLES; }
      const p = this.particles[i];
      p.alive = p.sand = true;
      p.p.copy(pos);
      p.v.set(Math.random() - 0.5, Math.random() * 0.8 - 0.15, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.28 + Math.random() * 0.72));
      if (dir) p.v.addScaledVector(dir, speed * 0.72);
      p.v.y += speed * 0.22;
      p.max = p.life = life * (0.75 + Math.random() * 0.45);
      p.size = SAND.grainSize * sizeMul * (0.55 + Math.random() * 0.8);
      p.grav = 1;
      p.floor = 0;
      this.pMesh.setColorAt(i, this.color.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18));
      spawned++;
      if (!freeLeft) n--; // keep stealing until the burst is complete
    }
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  /** Directional impact: sparks + paper flakes kick out along the ricochet, ink dot left behind. */
  impact(pos: THREE.Vector3, normal: THREE.Vector3, shotDir?: THREE.Vector3) {
    const refl = new THREE.Vector3().copy(normal);
    if (shotDir) refl.copy(shotDir).addScaledVector(normal, -2 * shotDir.dot(normal)).normalize().lerp(normal, 0.4).normalize();
    // drawn impact: a few ink and graphite flecks kicked off the paper, no sparks or smoke
    this.burst(pos, 0x1b1b24, 5, 3.5, 0.035, 0.28, 1.1, refl);
    this.burst(pos, 0x5a5a68, 3, 2, 0.03, 0.3, 0.9, refl);
    this.bulletHole(pos, normal);
  }

  /** camera position for distance-scaled tracer width (set by the renderer each frame) */
  readonly camPos = new THREE.Vector3();

  update(dt: number) {
    this.writeSmears(dt);
    let anyPile = false;
    for (const p of this.piles) if (p.alive) { p.age += dt; if (p.age >= p.life) p.alive = false; anyPile = true; }
    if (anyPile) this.writePiles();
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
        // Only sample surfaces below the grain; a pile on a catwalk must stay there.
        const floor = p.sand && this.world ? this.world.surfaceBelow(p.p.x, p.p.z, 0.005, Math.max(0, p.p.y - p.v.y * dt + 0.03)) : 0;
        if (p.p.y < floor + p.size) {
          p.p.y = floor + p.size;
          p.v.y *= p.sand ? -0.12 : -0.3;
          p.v.x *= p.sand ? 0.32 : 0.7;
          p.v.z *= p.sand ? 0.32 : 0.7;
        }
        dummy.position.copy(p.p);
        dummy.rotation.set(p.life * 10, p.life * 7, 0);
        dummy.scale.setScalar(p.size * Math.min(1, (p.life / p.max) * (p.sand ? 6 : 2)));
      }
      dummy.updateMatrix();
      this.pMesh.setMatrixAt(i, dummy.matrix);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.head += t.speed * dt;
      const tail = Math.max(0, t.head - t.len);
      const head = Math.min(t.head, t.total);
      if (tail >= t.total) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const segLen = head - tail;
      if (segLen <= 0.01) {
        t.mesh.visible = false;
        continue;
      }
      t.mesh.visible = true;
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.lookAt(tv.copy(t.from).addScaledVector(t.dir, head));
      t.mesh.scale.z = segLen;
      // keep ~2-3 px wide on screen regardless of distance (thin ink stroke, never a beam)
      const mid = tv.copy(t.from).addScaledVector(t.dir, (tail + head) / 2);
      const w = Math.max(t.thick, this.camPos.distanceTo(mid) * 0.0032);
      t.mesh.scale.x = t.mesh.scale.y = w;
    }
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.life -= dt;
      if (f.life <= 0) f.s.visible = false;
    }
  }
}

/** Tapered crossed strips from z = 0 (tail, 25% width) to z = 1 (head); uv.y runs along the stroke. */
function tracerStrokeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const axis of [0, 1]) {
    const b = pos.length / 3;
    for (const [z, w] of [[0, 0.25], [1, 1]]) {
      for (const s of [-0.5, 0.5]) {
        pos.push(axis ? 0 : s * w, axis ? s * w : 0, z);
        uv.push(s + 0.5, z);
      }
    }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
