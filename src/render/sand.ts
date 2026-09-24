import * as THREE from 'three';

/** Presentation budgets and timings; simulation never reads these. */
export const SAND = {
  enabled: new URLSearchParams(location.search).get('sand') !== '0',
  maxWounds: 4,
  woundLife: 1.5,
  trickleInterval: 0.075,
  impactGrains: 16,
  deathGrains: 80,
  grainSize: 0.018,
  collapseTime: 0.85,
  pileLife: 7,
} as const;

let sharedGrain: THREE.CanvasTexture | null = null;
/**
 * One fixed grain map shared across characters, hands, weapons and sand piles. No animated noise.
 * Coarse two-pixel grains with sparse dark and bright pebbles, over faint wind-laid strata, so the
 * body still reads as sand at combat range after mipmapping instead of averaging to flat colour.
 */
export function sandGrainMap() {
  if (sharedGrain) return sharedGrain;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(S, S);
  let seed = 0x53414e44;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const g = new Float32Array(S * S);
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    const v = (rnd() - 0.5) * 34;
    g[y * S + x] = g[y * S + x + 1] = g[(y + 1) * S + x] = g[(y + 1) * S + x + 1] = v;
  }
  for (let k = 0; k < 260; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), v = rnd() < 0.6 ? -46 : 30;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) g[((y + dy) % S) * S + ((x + dx) % S)] += v;
  }
  for (let y = 0; y < S; y++) {
    const strata = Math.sin((y / S) * Math.PI * 2 * 3 + Math.sin((y / S) * Math.PI * 4) * 0.8) * 9;
    for (let x = 0; x < S; x++) {
      const shade = Math.max(0, Math.min(255, 196 + strata + g[y * S + x]));
      pixels.data.set([shade, shade * 0.985, shade * 0.95, 255], (y * S + x) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  sharedGrain = new THREE.CanvasTexture(canvas);
  sharedGrain.wrapS = sharedGrain.wrapT = THREE.RepeatWrapping;
  sharedGrain.repeat.set(2, 2);
  sharedGrain.minFilter = THREE.LinearMipmapLinearFilter;
  sharedGrain.magFilter = THREE.LinearFilter;
  sharedGrain.generateMipmaps = true;
  return sharedGrain;
}
const grainMap = sandGrainMap;

let sharedGraphite: THREE.CanvasTexture | null = null;
/**
 * Neutral graphite tooth for the stick fighters: fine pencil grain with a few darker flecks, bright
 * on average so the toon ramp still shades the limbs. Read at arm's length, invisible at range.
 */
export function graphiteGrainMap() {
  if (sharedGraphite) return sharedGraphite;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(S, S);
  let seed = 0x47524146;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // diagonal hatching tooth + noise
    const hatch = Math.sin((x + y) * 0.9) * 6;
    let v = 226 + hatch + (rnd() - 0.5) * 30;
    if (rnd() < 0.025) v -= 50;
    v = Math.max(0, Math.min(255, v));
    pixels.data.set([v, v, v * 1.02, 255], (y * S + x) * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  sharedGraphite = new THREE.CanvasTexture(canvas);
  sharedGraphite.wrapS = sharedGraphite.wrapT = THREE.RepeatWrapping;
  sharedGraphite.repeat.set(3, 3);
  sharedGraphite.generateMipmaps = true;
  sharedGraphite.minFilter = THREE.LinearMipmapLinearFilter;
  return sharedGraphite;
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
