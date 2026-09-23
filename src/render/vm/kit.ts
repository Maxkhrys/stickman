import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SAND, sandMaterial } from '../sand';

// ============================================================================
//  Shared viewmodel toolkit: cel-shaded (toon) materials, constant-thickness ink
//  outlines built from smoothed normals, and shaped-geometry helpers.
// ============================================================================

export const INK = 0x1b1b24;
export const PAL = {
  ink: INK,
  graphite: 0x3a3d4a,
  steel: 0x51566a,
  navy: 0x2b2d42,
  pink: 0xff4f9a,
  pinkDark: 0xd23a7c,
  purple: 0x8b5cf6,
  cyan: 0x22c6e0,
  cyanDark: 0x159bb0,
  yellow: 0xffd23f,
  gold: 0xffc93c,
  wood: 0xf1cf9a,
  white: 0xfbfbf7,
  hiYellow: 0xffe84a,
  green: 0x3ddc84,
};

let gradient: THREE.DataTexture | null = null;
/** 3-band toon ramp: shadow, mid, lit. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([120, 120, 120, 255, 196, 196, 196, 255, 255, 255, 255, 255]);
    gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map<number, THREE.MeshToonMaterial>();
export function toon(color: number): THREE.MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    if (SAND.enabled) sandMaterial(m);
    toonCache.set(color, m);
  }
  return m;
}

const outlineCache = new Map<string, THREE.ShaderMaterial>();
/** Inverted hull pushed out along smoothed normals by a constant object-space thickness (metres). */
export function outlineMaterial(thickness: number, color = INK): THREE.ShaderMaterial {
  const key = `${thickness}|${color}`;
  let m = outlineCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec3 p = position + normal * thickness;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        void main() { gl_FragColor = vec4(color, opacity); }`,
      side: THREE.BackSide,
    });
    outlineCache.set(key, m);
  }
  return m;
}

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Position-only copy with averaged normals so the extruded hull has no cracks at hard edges. */
export function smoothNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = smoothCache.get(geo);
  if (!g) {
    const c = new THREE.BufferGeometry();
    c.setAttribute('position', geo.getAttribute('position').clone());
    if (geo.index) c.setIndex(geo.index.clone());
    g = mergeVertices(c, 1e-4);
    g.computeVertexNormals();
    smoothCache.set(geo, g);
  }
  return g;
}

/** Adds an ink outline child to a mesh (thickness in metres; 0 = none). */
export function outline<T extends THREE.Mesh>(mesh: T, thickness = 0.0011): T {
  if (thickness <= 0) return mesh;
  const o = new THREE.Mesh(smoothNormals(mesh.geometry), outlineMaterial(thickness));
  o.name = 'outline';
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

export interface PartOpts {
  pos?: [number, number, number];
  rot?: [number, number, number];
  outline?: number;
  name?: string;
}

export function part(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color));
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.name) m.name = o.name;
  return outline(m, o.outline ?? 0.0011);
}

// ---------------------------------------------------------------- geometry helpers

/** Rounded box. */
export function rbox(w: number, h: number, d: number, r = Math.min(w, h, d) * 0.2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
}

/** Cylinder along Z (length), optional radial segments. */
export function tubeZ(r: number, len: number, seg = 14, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  g.rotateX(-Math.PI / 2); // +y -> -z: the r2 end points forward (-z)
  return g;
}

/** Cone along -Z (tip forward). */
export function coneZ(r: number, len: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Side-profile extrusion. Profile points are (u, v): u = along the gun toward the muzzle, v = up.
 * Extruded symmetrically across the gun's width (x). Restrained bevel for readable silhouettes.
 */
export function profile(points: [number, number][], width: number, bevel = 0.0025, holes: [number, number][][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const depth = Math.max(1e-4, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // shape x (u) -> -z, extrude z -> x (centred)
  g.rotateY(Math.PI / 2);
  g.translate(-depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Lathe around the Z axis (profile in (radius, z)), for bells, nibs, knobs. */
export function latheZ(pts: [number, number][], seg = 16): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(-Math.PI / 2); // lathe y -> -z
  return g;
}

export function sphere(r: number, seg = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)));
}

export function capsule(r: number, len: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 4, seg);
}

/** Capsule between two points (in the parent's space). */
export function capsuleBetween(r: number, a: THREE.Vector3, b: THREE.Vector3, color: number, outlineT = 0.0011): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = part(capsule(r, Math.max(1e-4, len)), color, { outline: outlineT });
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Empty marker object (socket). */
export function socket(name: string, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(...pos);
  o.rotation.set(rot[0], rot[1], rot[2]);
  return o;
}

// ---------------------------------------------------------------- easing

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** 0 -> 1 -> 0 bump over [a, b] */
export const bump = (x: number, a: number, b: number) => {
  if (x <= a || x >= b) return 0;
  return Math.sin(((x - a) / (b - a)) * Math.PI);
};
/** progress of x through [a, b], clamped and smoothed */
export const seg = (x: number, a: number, b: number) => smooth((x - a) / (b - a));
