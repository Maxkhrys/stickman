import * as THREE from 'three';

// ============================================================================
//  Procedural marker / pencil textures for the stick fighters (cached, built once).
//  Cylinder UVs run u around the limb and v along it, so vertical streaks in these
//  textures follow each limb's length and stay glued to it when the body moves.
// ============================================================================

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

let strokeMap: THREE.CanvasTexture | null = null;
/**
 * Dense dry-marker fill: a dark, even base with a few long streaks where the paper shows through,
 * sparse pencil hatches, and a darker pooled seam. Mostly mid-grey so the material colour carries
 * the ink; the brighter streaks read as marker drag only up close.
 */
export function markerStrokeMap(): THREE.CanvasTexture {
  if (strokeMap) return strokeMap;
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(0x4d41524b);
  g.fillStyle = 'rgb(150,150,156)';
  g.fillRect(0, 0, W, H);
  // overlapping marker passes: wide, faint bands along v (the limb's length)
  for (let i = 0; i < 7; i++) {
    const x = r() * W, w = 10 + r() * 22;
    g.fillStyle = `rgba(${r() < 0.5 ? '25,25,32' : '190,188,182'},${0.05 + r() * 0.06})`;
    g.fillRect(x, 0, w, H);
    g.fillRect(x - W, 0, w, H);
  }
  // dry drags: short broken streaks where the nib skipped, never a full-length seam
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H, len = 14 + r() * 60, w = 0.8 + r() * 1.8;
    const bright = r() < 0.45;
    g.strokeStyle = bright ? `rgba(225,222,215,${0.08 + r() * 0.16})` : `rgba(20,20,26,${0.15 + r() * 0.25})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 2.5, y + len);
    g.stroke();
  }
  // a handful of stable pencil hatches across the stroke
  g.strokeStyle = 'rgba(30,30,36,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const y = r() * H, x = r() * W;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 18 + r() * 10, y - 9 - r() * 6);
    g.stroke();
  }
  // grain
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  strokeMap = new THREE.CanvasTexture(c);
  strokeMap.wrapS = strokeMap.wrapT = THREE.RepeatWrapping;
  strokeMap.colorSpace = THREE.SRGBColorSpace;
  strokeMap.generateMipmaps = true;
  strokeMap.minFilter = THREE.LinearMipmapLinearFilter;
  return strokeMap;
}

let restrained: THREE.DataTexture | null = null;
/** Two soft toon bands only: enough to give the limbs volume without a plastic highlight. */
export function markerGradient(): THREE.DataTexture {
  if (restrained) return restrained;
  const data = new Uint8Array([178, 178, 178, 255, 218, 218, 218, 255, 240, 240, 240, 255]);
  restrained = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  restrained.minFilter = restrained.magFilter = THREE.NearestFilter;
  restrained.generateMipmaps = false;
  restrained.needsUpdate = true;
  return restrained;
}

/**
 * Hand-drawn outline hull: the same primitive with a fixed, low-frequency radial wobble, so ink edges
 * look slightly irregular. The wobble is baked in object space: it moves with the limb and never
 * boils or jitters from frame to frame.
 */
export function wobbleHull(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const g = geo.clone();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ang = Math.atan2(v.z, v.x);
    const k = 1 + amount * (Math.sin(ang * 3 + seed) * 0.6 + Math.sin(ang * 5 + v.y * 7 + seed * 2) * 0.4);
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

let smearMap: THREE.CanvasTexture | null = null;
/** Short marker skid streak for floor smears (alpha texture, drawn with a tint). */
export function markerSmearMap(): THREE.CanvasTexture {
  if (smearMap) return smearMap;
  const W = 256, H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(0x534d4541);
  for (let i = 0; i < 9; i++) {
    const y = 16 + r() * 32, x0 = 10 + r() * 30, x1 = W - 10 - r() * 70;
    g.strokeStyle = `rgba(255,255,255,${0.35 + r() * 0.45})`;
    g.lineWidth = 2 + r() * 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x0, y);
    g.quadraticCurveTo((x0 + x1) / 2, y + (r() - 0.5) * 10, x1, y + (r() - 0.5) * 6);
    g.stroke();
  }
  // dry tail: fade toward the start of the skid
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  smearMap = new THREE.CanvasTexture(c);
  return smearMap;
}

let paintMap: THREE.CanvasTexture | null = null;
/** Marker paint splat for Sketch Slide cells: solid core with a feathered, decorative rim. */
export function paintCellMap(): THREE.CanvasTexture {
  if (paintMap) return paintMap;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(0x50414e54);
  // the core (inner 2/3 of the quad = exactly the gameplay cell) is fully opaque
  g.fillStyle = '#fff';
  g.fillRect(S / 6, S / 6, (S * 2) / 3, (S * 2) / 3);
  // feathered decorative rim outside the cell
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = S / 3 + r() * (S / 6 - 2);
    g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.4})`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d * 0.9, S / 2 + Math.sin(a) * d * 0.9, 1.5 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  paintMap = new THREE.CanvasTexture(c);
  return paintMap;
}
