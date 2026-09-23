import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { MapDef } from '../sim/map';
import {
  makeCloudTexture,
  makeGraphPaperTexture,
  makeHatchTexture,
  makeLabelTexture,
  makeRuledTexture,
  makeSplatTexture,
} from './textures';

const TILE = 2; // metres per texture tile
type Bucket = 0 | 1 | 2; // 0 = graph paper (tops), 1 = hatch (sides), 2 = ruled (big walls)

class GeoBuilder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/**
 * Bakes the level into 3 merged meshes (graph-paper tops, hatched sides, ruled outer walls) with
 * baked face shading in vertex colours + one LineSegments ink outline. ~5 draw calls for the level.
 */
export function buildMapMesh(map: MapDef): THREE.Group {
  const group = new THREE.Group();
  const buckets = [new GeoBuilder(), new GeoBuilder(), new GeoBuilder()];
  const lines: number[] = [];
  const c = new THREE.Color();

  const shade = (nx: number, ny: number, nz: number) => {
    if (ny > 0.5) return 1.0;
    if (ny < -0.5) return 0.7;
    return 0.9 + nx * 0.05 + nz * 0.04;
  };

  const quad = (p0: number[], p1: number[], p2: number[], p3: number[], n: number[], color: number, uvs: number[][], bucket: Bucket, uvScale = TILE) => {
    const g = buckets[bucket];
    const base = g.pos.length / 3;
    c.set(color);
    // pastel-ise so paper texture still reads through, but keep colours loud
    const s = shade(n[0], n[1], n[2]);
    for (const [i, p] of [p0, p1, p2, p3].entries()) {
      g.pos.push(p[0], p[1], p[2]);
      g.uv.push(uvs[i][0] / uvScale, uvs[i][1] / uvScale);
      g.col.push(c.r * s, c.g * s, c.b * s);
    }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const edge = (a: number[], b: number[]) => lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);

  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) => {
    const side: Bucket = y1 - y0 >= 5 && color === 0xf3efe6 ? 2 : 1;
    const su = side === 2 ? 8 : TILE;
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], color, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0);
    if (y0 > 0.01) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 1);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color, [[z1, y0], [z0, y0], [z0, y1], [z1, y1]], side, su);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], side, su);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], side, su);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color, [[x1, y0], [x0, y0], [x0, y1], [x1, y1]], side, su);
    const P = (x: number, y: number, z: number) => [x, y, z];
    const corners = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) edge(corners[a], corners[b]);
  };

  // pencils are rendered as props, so skip their collision boxes
  const propKeys = new Set(map.props.map((p) => `${p.x},${p.z}`));
  for (const b of map.boxes) {
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    if (propKeys.has(`${cx},${cz}`) && b.max.x - b.min.x < 1.5) continue;
    box(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, b.color);
  }

  for (const r of map.ramps) {
    const { x0, x1, z0, z1, h0, h1, color } = r;
    if (r.axis === 'x') {
      quad([x0, h0, z1], [x1, h1, z1], [x1, h1, z0], [x0, h0, z0], [0, 1, 0], color, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, 1);
      quad([x0, 0, z1], [x1, 0, z1], [x1, h1, z1], [x0, h0, z1], [0, 0, 1], color, [[x0, 0], [x1, 0], [x1, h1], [x0, h0]], 1);
      quad([x1, 0, z0], [x0, 0, z0], [x0, h0, z0], [x1, h1, z0], [0, 0, -1], color, [[x1, 0], [x0, 0], [x0, h0], [x1, h1]], 1);
      if (h1 > h0) quad([x1, 0, z1], [x1, 0, z0], [x1, h1, z0], [x1, h1, z1], [1, 0, 0], color, [[z1, 0], [z0, 0], [z0, h1], [z1, h1]], 1);
      else quad([x0, 0, z0], [x0, 0, z1], [x0, h0, z1], [x0, h0, z0], [-1, 0, 0], color, [[z0, 0], [z1, 0], [z1, h0], [z0, h0]], 1);
      edge([x0, h0, z0], [x1, h1, z0]); edge([x0, h0, z1], [x1, h1, z1]);
      edge([x0, h0, z0], [x0, h0, z1]); edge([x1, h1, z0], [x1, h1, z1]);
      // ruler tick marks
      for (let x = Math.ceil(x0 * 2) / 2; x < x1; x += 0.5) {
        const y = h0 + ((h1 - h0) * (x - x0)) / (x1 - x0) + 0.01;
        const len = Math.abs(x % 2) < 0.01 ? 0.6 : 0.3;
        edge([x, y, z0], [x, y, z0 + len]);
      }
    } else {
      quad([x0, h1, z1], [x1, h1, z1], [x1, h0, z0], [x0, h0, z0], [0, 1, 0], color, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], 0, 1);
      quad([x1, 0, z1], [x1, 0, z0], [x1, h0, z0], [x1, h1, z1], [1, 0, 0], color, [[z1, 0], [z0, 0], [z0, h0], [z1, h1]], 1);
      quad([x0, 0, z0], [x0, 0, z1], [x0, h1, z1], [x0, h0, z0], [-1, 0, 0], color, [[z0, 0], [z1, 0], [z1, h1], [z0, h0]], 1);
      if (h1 > h0) quad([x0, 0, z1], [x1, 0, z1], [x1, h1, z1], [x0, h1, z1], [0, 0, 1], color, [[x0, 0], [x1, 0], [x1, h1], [x0, h1]], 1);
      else quad([x1, 0, z0], [x0, 0, z0], [x0, h0, z0], [x1, h0, z0], [0, 0, -1], color, [[x1, 0], [x0, 0], [x0, h0], [x1, h0]], 1);
      edge([x0, h0, z0], [x0, h1, z1]); edge([x1, h0, z0], [x1, h1, z1]);
      edge([x0, h0, z0], [x1, h0, z0]); edge([x0, h1, z1], [x1, h1, z1]);
      for (let z = Math.ceil(z0 * 2) / 2; z < z1; z += 0.5) {
        const y = h0 + ((h1 - h0) * (z - z0)) / (z1 - z0) + 0.01;
        const len = Math.abs(z % 2) < 0.01 ? 0.6 : 0.3;
        edge([x0, y, z], [x0 + len, y, z]);
      }
    }
  }

  const bd = map.bounds;
  const m = 2;
  quad(
    [bd.minX - m, 0, bd.maxZ + m], [bd.maxX + m, 0, bd.maxZ + m], [bd.maxX + m, 0, bd.minZ - m], [bd.minX - m, 0, bd.minZ - m],
    [0, 1, 0], map.floorColor,
    [[bd.minX - m, bd.maxZ + m], [bd.maxX + m, bd.maxZ + m], [bd.maxX + m, bd.minZ - m], [bd.minX - m, bd.minZ - m]], 0, 4,
  );

  const texes = [makeGraphPaperTexture(), makeHatchTexture(), makeRuledTexture()];
  buckets.forEach((b, i) => {
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ map: texes[i], vertexColors: true }));
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
  // bold ink outlines: screen-space fat lines (constant pixel width)
  const lg = new LineSegmentsGeometry();
  lg.setPositions(lines);
  const lineMat = new LineMaterial({ color: 0x1b1b24, linewidth: 2, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  lineMat.resolution.set(window.innerWidth, window.innerHeight);
  const outline = new LineSegments2(lg, lineMat);
  outline.name = 'inkLines';
  outline.matrixAutoUpdate = false;
  group.add(outline);

  group.add(buildContactShadows(map));

  // ---- pencils ----
  for (const p of map.props) group.add(buildPencil(p.x, p.z, p.h, p.r, p.color));

  // ---- ink splats on the floor (instanced, one draw call) ----
  const splatColors = [0xff4f9a, 0x8b5cf6, 0x22c6e0, 0xffd23f, 0x3ddc84, 0x1b1b24];
  const nSplat = 70;
  const splats = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: makeSplatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    nSplat,
  );
  const o = new THREE.Object3D();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < nSplat; i++) {
    o.position.set(bd.minX + rnd() * (bd.maxX - bd.minX), 0.012, bd.minZ + rnd() * (bd.maxZ - bd.minZ));
    o.rotation.set(-Math.PI / 2, 0, rnd() * 6.28);
    o.scale.setScalar(0.8 + rnd() * 2.2);
    o.updateMatrix();
    splats.setMatrixAt(i, o.matrix);
    splats.setColorAt(i, c.set(splatColors[Math.floor(rnd() * splatColors.length)]));
  }
  group.add(splats);

  // ---- sky doodles: clouds + floating rings ----
  const cloudTex = makeCloudTexture();
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false }));
    const a = (i / 14) * Math.PI * 2;
    const rx = (bd.maxX - bd.minX) * 0.5 + 10 + rnd() * 25, rz = (bd.maxZ - bd.minZ) * 0.5 + 10 + rnd() * 25;
    sp.position.set(Math.cos(a) * rx + (bd.maxX + bd.minX) / 2, 12 + rnd() * 10, Math.sin(a) * rz + (bd.maxZ + bd.minZ) / 2);
    const sc = 8 + rnd() * 8;
    sp.scale.set(sc, sc / 2, 1);
    group.add(sp);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4f9a });
  const ringGeo = new THREE.TorusGeometry(0.6, 0.12, 6, 18);
  for (let i = 0; i < 10; i++) {
    const r = new THREE.Mesh(ringGeo, ringMat);
    r.position.set(bd.minX + rnd() * (bd.maxX - bd.minX), 7 + rnd() * 5, bd.minZ + rnd() * (bd.maxZ - bd.minZ));
    r.rotation.set(rnd() * 0.6, rnd() * 6, 0);
    r.userData.spin = 0.3 + rnd() * 0.6;
    r.name = 'ring';
    group.add(r);
  }

  for (const l of map.labels ?? []) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(l.text), depthWrite: false }));
    sp.position.set(l.pos.x, l.pos.y, l.pos.z);
    sp.scale.set(1.6, 0.8, 1);
    group.add(sp);
  }
  return group;
}

/** Giant pencil standing tip-up: eraser, ferrule band, hex body, wood cone, graphite tip, ink outline. */
function buildPencil(x: number, z: number, h: number, r: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const lam = (col: number) => new THREE.MeshLambertMaterial({ color: col });
  const eraserH = 0.9, bandH = 0.45, tipH = 1.6;
  const bodyH = h - eraserH - bandH - tipH;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    const ol = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1b1b24, side: THREE.BackSide }));
    ol.position.y = y;
    ol.scale.set(1.06, 1.01, 1.06);
    g.add(ol);
  };
  add(new THREE.CylinderGeometry(r * 0.95, r * 0.95, eraserH, 16), lam(0xff6fae), eraserH / 2);
  add(new THREE.CylinderGeometry(r, r, bandH, 16), lam(0xb8bcc6), eraserH + bandH / 2);
  add(new THREE.CylinderGeometry(r, r, bodyH, 6), lam(color), eraserH + bandH + bodyH / 2);
  add(new THREE.ConeGeometry(r, tipH * 0.75, 6), lam(0xf1cf9a), h - tipH + (tipH * 0.75) / 2);
  const lead = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, tipH * 0.28, 6), lam(0x333340));
  lead.position.y = h - (tipH * 0.28) / 2 + 0.02;
  g.add(lead);
  g.position.set(x, 0, z);
  return g;
}

/**
 * Contact shadows: floor-standing solids are rasterised into an occupancy grid, and a soft ink wash
 * falls off with distance from them. One texture, one quad, no double-darkening where boxes touch.
 */
function buildContactShadows(map: MapDef): THREE.Mesh {
  const bd = map.bounds, cell = 0.2, R = 0.9;
  const W = Math.ceil((bd.maxX - bd.minX) / cell), H = Math.ceil((bd.maxZ - bd.minZ) / cell);
  const occ = new Float32Array(W * H); // occluder strength 0..1 (by height)
  const fill = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    const s = Math.min(1, h / 0.8);
    const i0 = Math.max(0, Math.floor((x0 - bd.minX) / cell)), i1 = Math.min(W - 1, Math.ceil((x1 - bd.minX) / cell) - 1);
    const j0 = Math.max(0, Math.floor((z0 - bd.minZ) / cell)), j1 = Math.min(H - 1, Math.ceil((z1 - bd.minZ) / cell) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * W + i] = Math.max(occ[j * W + i], s);
  };
  for (const b of map.boxes) if (b.min.y < 0.01) fill(b.min.x, b.min.z, b.max.x, b.max.z, b.max.y);
  for (const r of map.ramps) {
    const n = 6;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, h = r.h0 + (r.h1 - r.h0) * (t0 + t1) / 2;
      if (r.axis === 'x') fill(r.x0 + (r.x1 - r.x0) * t0, r.z0, r.x0 + (r.x1 - r.x0) * t1, r.z1, h);
      else fill(r.x0, r.z0 + (r.z1 - r.z0) * t0, r.x1, r.z0 + (r.z1 - r.z0) * t1, h);
    }
  }
  const data = new Uint8Array(W * H * 4);
  const rc = Math.ceil(R / cell);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let best = 0;
    if (occ[j * W + i] > 0) best = occ[j * W + i];
    else for (let dj = -rc; dj <= rc; dj++) {
      const jj = j + dj; if (jj < 0 || jj >= H) continue;
      for (let di = -rc; di <= rc; di++) {
        const ii = i + di; if (ii < 0 || ii >= W) continue;
        const o = occ[jj * W + ii]; if (!o) continue;
        const d = Math.hypot(di, dj) * cell;
        if (d >= R) continue;
        const f = 1 - d / R;
        best = Math.max(best, o * f * f);
      }
    }
    const k = (j * W + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255;
    data[k + 3] = Math.round(best * 0.3 * 255);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(W * cell, H * cell);
  geo.rotateX(-Math.PI / 2);
  // PlaneGeometry v=1 is at -z after rotation; texture row 0 is minZ
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0x2a2440, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.position.set(bd.minX + (W * cell) / 2, 0.006, bd.minZ + (H * cell) / 2);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -1;
  return mesh;
}
