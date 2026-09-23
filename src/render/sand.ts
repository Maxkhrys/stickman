import * as THREE from 'three';

/** Presentation budgets and timings; simulation never reads these. */
export const SAND = {
  enabled: new URLSearchParams(location.search).get('sand') !== '0',
  maxWounds: 4,
  woundLife: 1.6,
  trickleInterval: 0.07,
  impactGrains: 16,
  deathGrains: 80,
  grainSize: 0.018,
  /** body holds together for this long after death, then cohesion fails top-down */
  collapseTime: 1.35,
  pileLife: 8,
} as const;

// ---------------------------------------------------------------------------
//  Quality tiers. High = desktop default, Low = phones / weak GPUs.
//  Tier changes shader taps (grain samples, vertex roughness) and particle budgets,
//  never gameplay.
// ---------------------------------------------------------------------------
export type SandQuality = 'high' | 'medium' | 'low';
const TAPS: Record<SandQuality, number> = { high: 3, medium: 2, low: 1 };
export const SAND_BUDGET: Record<SandQuality, { particles: number; ambient: number; farCull: number }> = {
  high: { particles: 600, ambient: 1, farCull: 32 },
  medium: { particles: 420, ambient: 0.6, farCull: 24 },
  low: { particles: 260, ambient: 0.35, farCull: 16 },
};
let quality: SandQuality = 'high';
const registered = new Set<THREE.Material>();
export function sandQuality() {
  return quality;
}
export function setSandQuality(q: SandQuality) {
  if (q === quality) return;
  quality = q;
  for (const m of registered) m.needsUpdate = true;
}

/** Shared uniforms: one time value drives the slow grain creep on every sand surface. */
export const SAND_UNIFORMS = {
  uSandTime: { value: 0 },
  uSandGrain: { value: null as THREE.Texture | null },
};

/**
 * Sand look for any team colour: keep the hue (players stay readable), pull saturation down and
 * warm it slightly toward natural sand so it reads as coloured sand, not painted plastic.
 */
export function sandTint(color: number | THREE.Color, out = new THREE.Color(), shade = 1): THREE.Color {
  out.set(color as THREE.ColorRepresentation);
  const hsl = { h: 0, s: 0, l: 0 };
  out.getHSL(hsl);
  out.setHSL(hsl.h, Math.min(0.72, hsl.s * 0.66), Math.min(0.72, 0.2 + hsl.l * 0.62) * shade);
  return out.lerp(SAND_BEIGE, 0.14);
}
const SAND_BEIGE = new THREE.Color(0xc9a878);

let sharedGrain: THREE.CanvasTexture | null = null;
/**
 * One fixed multi-scale grain map shared by characters, hands, weapons and piles. No animated noise.
 *  R: fine two-pixel grains with sparse dark and bright pebbles (per-grain albedo)
 *  G: soft clumps a few centimetres across (survive mipmapping, so sand reads at range)
 *  B: packed-grain relief used for erosion thresholds
 * Legacy users sample it as a grey multiplier (R); the sand shader uses all three channels.
 */
export function sandGrainMap() {
  if (sharedGrain) return sharedGrain;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(S, S);
  let seed = 0x53414e44;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const fine = new Float32Array(S * S);
  for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
    const v = (rnd() - 0.5) * 40;
    fine[y * S + x] = fine[y * S + x + 1] = fine[(y + 1) * S + x] = fine[(y + 1) * S + x + 1] = v;
  }
  for (let k = 0; k < 900; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), v = rnd() < 0.62 ? -58 : 42;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) fine[((y + dy) % S) * S + ((x + dx) % S)] += v;
  }
  // tileable value noise for clumps / relief
  const grid = (cells: number) => {
    const g = new Float32Array(cells * cells).map(() => rnd());
    return (x: number, y: number) => {
      const fx = (x / S) * cells, fy = (y / S) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const n8 = grid(8), n16 = grid(16), n32 = grid(32), n64 = grid(64);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const r = Math.max(0, Math.min(255, 190 + fine[i]));
    const clump = n8(x, y) * 0.55 + n16(x, y) * 0.45;
    const relief = n32(x, y) * 0.6 + n64(x, y) * 0.4;
    pixels.data.set([r, Math.round(clump * 255), Math.round(relief * 255), 255], i * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  sharedGrain = new THREE.CanvasTexture(canvas);
  sharedGrain.wrapS = sharedGrain.wrapT = THREE.RepeatWrapping;
  sharedGrain.repeat.set(2, 2);
  sharedGrain.minFilter = THREE.LinearMipmapLinearFilter;
  sharedGrain.magFilter = THREE.LinearFilter;
  sharedGrain.generateMipmaps = true;
  SAND_UNIFORMS.uSandGrain.value = sharedGrain;
  return sharedGrain;
}

// ---------------------------------------------------------------------------
//  Shader. Grain coordinates are in metres on each body part (instance scale applied), so a long
//  thin bone and a round joint show the same grain size and the grain rides the limb instead of
//  swimming through it. aDisturb (0..1 per instance) = local loss of cohesion: impacts, wounds,
//  heavy damage, death erosion. The ink hull uses the same field so eroded holes read as openings.
// ---------------------------------------------------------------------------
const VERT_DECL = /* glsl */ `
varying vec3 vSandP;
varying vec3 vSandN;
varying float vSandD;
#ifdef SAND_DISTURB
attribute float aDisturb;
attribute vec4 aWound;
varying vec4 vSandW;
varying vec3 vSandWorld;
#endif
float sandHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
`;
const VERT_BODY = /* glsl */ `
vec3 sS = vec3(1.0);
#ifdef USE_INSTANCING
sS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#endif
vSandP = position * sS + vec3(float(gl_InstanceID) * 0.618, float(gl_InstanceID) * 0.271, 0.0);
vSandN = normal;
vSandD = 0.0;
#ifdef SAND_DISTURB
vSandD = aDisturb;
vSandW = aWound;
{
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  vSandWorld = (modelMatrix * wp).xyz;
}
#endif
#if SAND_TAPS >= 3 && defined(USE_INSTANCING)
{
  // tiny packed-grain roughness, stronger where cohesion is weakening (lumpy, never spiky)
  float h = sandHash(floor(vSandP * 70.0));
  float amp = 0.0022 + vSandD * 0.012;
  transformed += normal * ((h - 0.5) * amp) / max(dot(abs(normal), sS), 1e-3);
}
#endif
`;
const FRAG_DECL = /* glsl */ `
varying vec3 vSandP;
varying vec3 vSandN;
varying float vSandD;
#ifdef SAND_DISTURB
varying vec4 vSandW;
varying vec3 vSandWorld;
#endif
uniform sampler2D uSandGrain;
uniform float uSandTime;
vec3 sandSample(float scale, float creep) {
  vec3 an = abs(normalize(vSandN));
  vec2 drift = vec2(0.0, uSandTime * creep);
#if SAND_TAPS >= 2
  vec3 a = texture2D(uSandGrain, vSandP.xy * scale + drift).rgb;
  vec3 b = texture2D(uSandGrain, vSandP.zy * scale + drift + 0.37).rgb;
  vec3 s = mix(a, b, an.x / (an.x + an.z + 1e-4));
  #if SAND_TAPS >= 3
  vec3 c = texture2D(uSandGrain, vSandP.xz * scale + 0.71).rgb;
  s = mix(s, c, smoothstep(0.55, 0.85, an.y));
  #endif
  return s;
#else
  return texture2D(uSandGrain, (vSandP.xy + vSandP.zy * 0.73) * scale + drift).rgb;
#endif
}
/** cohesion loss here: part-wide value, plus a crater around the part's nearest wound */
float sandLoss() {
  float d = vSandD;
#ifdef SAND_DISTURB
  if (vSandW.w > 0.0) d = max(d, vSandW.w * 1.15 * (1.0 - smoothstep(0.012, 0.07, distance(vSandWorld, vSandW.xyz))));
#endif
  return d;
}
`;
/** albedo breakup + erosion discard, applied after the (optional) face map */
const FRAG_BODY = /* glsl */ `
{
  vec3 g = sandSample(2.2, -0.012);          // fine grains (~3.5 mm), creeping slowly downhill
  vec3 m = sandSample(0.75, -0.006);         // coarse grains (~1 cm): still visible at combat range
  vec3 k = sandSample(1.6, 0.0);             // clumps (G) and packed relief (B), 2-8 cm
  float erode = k.b * 0.65 + g.r * 0.35;
  float loss = sandLoss();
  if (loss > 0.02 && erode < loss * 0.95 - 0.02) discard;
  float grain = mix(g.r, m.r, 0.5);
  vec3 col = diffuseColor.rgb;
  col *= 0.62 + grain * 0.52 + (k.g - 0.5) * 0.3;
  col *= 0.88 + k.b * 0.22;                                        // packed relief catches light
  col *= 1.0 - 0.38 * smoothstep(0.6, 0.46, m.r);                  // dark mineral grains
  col = mix(col, col * 1.22 + 0.035, smoothstep(0.86, 0.97, g.r) * 0.75); // light quartz grains
  // loosened sand around an eroding region (wound rim, collapsing body) is darker and rougher
  float rim = step(0.02, loss) * smoothstep(-0.25, 0.05, loss * 0.95 - erode);
  col *= 1.0 - rim * 0.45;
  diffuseColor.rgb = col;
}
`;

function injectSand(sh: THREE.WebGLProgramParametersWithUniforms, frag: string) {
  sh.uniforms.uSandTime = SAND_UNIFORMS.uSandTime;
  sh.uniforms.uSandGrain = SAND_UNIFORMS.uSandGrain;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_DECL}`);
  const anchor = sh.fragmentShader.includes('#include <map_fragment>') ? '#include <map_fragment>' : '#include <color_fragment>';
  sh.fragmentShader = sh.fragmentShader.replace(anchor, `${anchor}\n${frag}`);
}

/**
 * Turn a toon material into living sand. `disturb` = the geometry carries a per-instance aDisturb
 * attribute (character batches). Safe on plain meshes (viewmodel) where it is off.
 */
export function sandMaterial<T extends THREE.MeshToonMaterial>(material: T, disturb = false): T {
  if (!SAND.enabled) return material;
  sandGrainMap();
  material.defines = { ...(material.defines ?? {}), SAND_TAPS: TAPS[quality] };
  if (disturb) material.defines.SAND_DISTURB = '';
  material.onBeforeCompile = (sh) => {
    material.defines!.SAND_TAPS = TAPS[quality];
    sh.defines = { ...sh.defines, SAND_TAPS: TAPS[quality] };
    injectSand(sh, FRAG_BODY);
  };
  material.customProgramCacheKey = () => `sand|${quality}|${disturb ? 1 : 0}|${material.map ? 1 : 0}`;
  registered.add(material);
  return material;
}

/**
 * Ink hull for sand bodies: shares the erosion field so eroded regions open up, and a light
 * clumpy breakup gives the silhouette a granular (not machined) edge.
 */
export function sandOutline<T extends THREE.MeshBasicMaterial>(material: T): T {
  if (!SAND.enabled) return material;
  sandGrainMap();
  material.defines = { ...(material.defines ?? {}), SAND_TAPS: 1, SAND_DISTURB: '' };
  material.onBeforeCompile = (sh) => {
    injectSand(sh, /* glsl */ `
{
  vec3 k = sandSample(1.6, 0.0);
  vec3 m = sandSample(0.75, 0.0);
  float erode = k.b * 0.65 + m.r * 0.35;
  float loss = sandLoss();
  if (loss > 0.02 && erode < loss * 0.95 + 0.04) discard;
  if (m.r < 0.42) discard; // granular ink edge at the ~1 cm grain scale (reads at range)
}
`);
  };
  material.customProgramCacheKey = () => 'sand-outline';
  registered.add(material);
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
