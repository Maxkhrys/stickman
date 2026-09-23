import * as THREE from 'three';

/** Presentation budgets and timings; simulation never reads these. */
export const SAND = {
  enabled: new URLSearchParams(location.search).get('sand') !== '0',
  maxWounds: 4,
  woundLife: 1.5,
  trickleInterval: 0.075,
  impactGrains: 16,
  deathGrains: 80,
  grainSize: 0.016,
  collapseTime: 0.85,
  pileLife: 7,
} as const;

let sharedGrain: THREE.CanvasTexture | null = null;
/** One fixed grain map shared across characters, hands and weapons. No animated noise. */
function grainMap() {
  if (sharedGrain) return sharedGrain;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(128, 128);
  let seed = 0x53414e44;
  for (let i = 0; i < 128 * 128; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = 177 + (seed >>> 24) * 0.3;
    pixels.data.set([shade, shade, shade, 255], i * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  sharedGrain = new THREE.CanvasTexture(canvas);
  sharedGrain.wrapS = sharedGrain.wrapT = THREE.RepeatWrapping;
  sharedGrain.repeat.set(3, 3);
  sharedGrain.minFilter = THREE.LinearMipmapLinearFilter;
  sharedGrain.magFilter = THREE.LinearFilter;
  sharedGrain.generateMipmaps = true;
  return sharedGrain;
}

export function sandMaterial<T extends THREE.MeshToonMaterial>(material: T): T {
  // Keep the expressive head's face map; other solids share one cached granular map.
  if (!material.map) material.map = grainMap();
  return material;
}

/** Keep silhouettes, eye relief and scope glass while changing rig colour to mineral pigment. */
export function mineralizeRig(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.name === 'outline' || /lens|glass|reticle/i.test(o.name)) return;
    if (!(o.material instanceof THREE.MeshToonMaterial)) return;
    const mat = o.material.clone();
    const c = mat.color;
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(hsl.s * 0.3 + 0.09, 0.43), Math.max(0.12, Math.min(0.76, hsl.l * 0.7 + 0.13)));
    o.material = sandMaterial(mat);
  });
}
