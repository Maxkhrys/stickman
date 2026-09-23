import * as THREE from 'three';

function canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Graph-paper: off-white with fine cyan grid + bolder lines at the tile edge. Used on tops & floor. */
export function makeGraphPaperTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 248 + Math.random() * 7;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(90,140,200,0.22)';
  g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = (i * s) / 8 + 0.5;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, s);
    g.moveTo(0, p);
    g.lineTo(s, p);
    g.stroke();
  }
  g.strokeStyle = 'rgba(60,90,150,0.35)';
  g.lineWidth = 2.5;
  g.strokeRect(1, 1, s - 2, s - 2);
  return canvasTex(c);
}

/** Pencil cross-hatching + tiny doodles. Used on vertical faces so walls read as "drawn". */
export function makeHatchTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.strokeStyle = k ? 'rgba(40,40,60,0.16)' : 'rgba(40,40,60,0.22)';
    g.lineWidth = 1.1;
    for (let i = -s; i < s * 2; i += 7) {
      g.beginPath();
      const j = (Math.random() - 0.5) * 3;
      if (k) {
        g.moveTo(i + j, 0);
        g.lineTo(i - s + j, s);
      } else {
        g.moveTo(i + j, 0);
        g.lineTo(i + s + j, s);
      }
      g.stroke();
    }
  }
  // scribbled "notes"
  g.strokeStyle = 'rgba(30,30,50,0.45)';
  g.lineWidth = 1.6;
  for (let n = 0; n < 5; n++) {
    let x = Math.random() * s, y = Math.random() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 10; i++) {
      x += 3 + Math.random() * 5;
      y += (Math.random() - 0.5) * 6;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // edge darkening like a pencil outline
  g.strokeStyle = 'rgba(20,20,30,0.35)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, s - 4, s - 4);
  return canvasTex(c);
}

/** Ruled notebook paper (outer walls): blue lines + red margin. */
export function makeRuledTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf9f3';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(80,130,220,0.45)';
  g.lineWidth = 2;
  for (let y = 16; y < s; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(s, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(40,40,60,0.12)';
  g.lineWidth = 1;
  for (let i = -s; i < s * 2; i += 9) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + s, s);
    g.stroke();
  }
  // doodles
  g.strokeStyle = 'rgba(30,30,50,0.55)';
  g.lineWidth = 2;
  const cx = 60 + Math.random() * 140, cy = 60 + Math.random() * 120;
  g.beginPath();
  g.arc(cx, cy, 14, 0, Math.PI * 2);
  g.moveTo(cx - 5, cy - 3);
  g.arc(cx - 5, cy - 3, 1.5, 0, Math.PI * 2);
  g.moveTo(cx + 7, cy - 3);
  g.arc(cx + 5, cy - 3, 1.5, 0, Math.PI * 2);
  g.moveTo(cx + 8, cy + 5);
  g.arc(cx, cy + 3, 8, 0.2, Math.PI - 0.2);
  g.stroke();
  g.font = 'italic 22px "Permanent Marker", "Comic Sans MS", cursive';
  g.fillStyle = 'rgba(30,30,60,0.5)';
  g.fillText(['pew pew', 'STICK!', 'gg ez', 'hi :)', 'ink!'][Math.floor(Math.random() * 5)], 30, 220);
  return canvasTex(c);
}

/** Random ink splat (white alpha mask, tinted per instance). */
export function makeSplatTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = s * (0.15 + Math.random() * 0.25);
    const r = s * (0.03 + Math.random() * 0.07);
    g.beginPath();
    g.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Soft doodle cloud with a pencil outline (sprite). */
export function makeCloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const blobs = [
    [70, 80, 34], [115, 60, 42], [165, 72, 36], [200, 88, 26], [110, 92, 30],
  ];
  g.fillStyle = '#6a6a78';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x, y, r + 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of blobs) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFlashTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,220,120,0.95)');
  grd.addColorStop(0.6, 'rgba(255,150,40,0.35)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // star spikes
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,240,180,0.9)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(s / 2, s / 2);
    g.lineTo(s / 2 + Math.cos(a) * s * 0.48, s / 2 + Math.sin(a) * s * 0.48);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBlobTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function makeLabelTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,20,30,0.75)';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffd84a';
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft ink puff for muzzle smoke. */
export function makeSmokeTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
