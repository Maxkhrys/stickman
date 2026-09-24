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
    // warm cream paper tooth
    const n = 247 + Math.random() * 8;
    img.data[i] = n;
    img.data[i + 1] = n - 3;
    img.data[i + 2] = n - 11;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(80,135,225,0.26)';
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
  g.strokeStyle = 'rgba(55,105,210,0.4)';
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
  // doodled yellow star burst with an ink outline (concept muzzle flash)
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const m = s / 2;
  const star = (ro: number, ri: number) => {
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? ri : ro * (i % 4 ? 0.8 : 1);
      g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
    }
    g.closePath();
  };
  g.lineJoin = 'round';
  star(58, 24);
  g.fillStyle = '#ffd23f';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#1b1b24';
  g.stroke();
  star(30, 13);
  g.fillStyle = '#fff6c8';
  g.fill();
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

/**
 * Marker hatch coverage (red channel = ink coverage, 0 = bare paper). Dense diagonal marker passes with
 * gaps and overlaps, like the concept's coloured crates: colour laid on paper in visible strokes.
 */
export function makeMarkerHatchTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(150,0,0)';
  g.fillRect(0, 0, s, s);
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = -s; i < s * 2; i += 11) {
      const j = (Math.random() - 0.5) * 4;
      g.strokeStyle = `rgb(${pass ? 255 : 235 + Math.random() * 20},0,0)`;
      g.lineWidth = 5 + Math.random() * 3;
      g.beginPath();
      // wrap-safe: every stroke also drawn shifted by one tile
      for (const o of [-s, 0, s]) {
        g.moveTo(i + j + o + pass * 5, 0);
        g.lineTo(i + j + o + pass * 5 + s, s);
      }
      g.stroke();
    }
  }
  // a few bare-paper gaps between passes
  g.strokeStyle = 'rgb(40,0,0)';
  g.lineWidth = 1.2;
  for (let i = 0; i < s * 2; i += 23) {
    g.beginPath();
    for (const o of [-s, 0, s]) { g.moveTo(i + o, 0); g.lineTo(i + o + s, s); }
    g.stroke();
  }
  const t = canvasTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Hand-lettered wall note with an optional arrow, black marker on transparent. */
export function makeWallNoteTexture(lines: string[], color = '#1b1b24', arrow: 'down' | 'right' | 'none' = 'none'): THREE.Texture {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.strokeStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = lines.length > 2 ? 58 : 72;
  g.font = `900 ${fs}px "Permanent Marker", "Luckiest Guy", "Comic Sans MS", cursive`;
  const top = H / 2 - ((lines.length - 1) * fs * 0.95) / 2 - (arrow === 'down' ? 30 : 0);
  lines.forEach((l, i) => {
    g.save();
    g.translate(W / 2 - (arrow === 'right' ? 50 : 0), top + i * fs * 0.95);
    g.rotate(-0.04 + i * 0.02);
    g.fillText(l, 0, 0);
    g.restore();
  });
  g.lineWidth = 7;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  if (arrow === 'down') {
    const y0 = top + lines.length * fs * 0.95 - 20;
    g.moveTo(W / 2 - 10, y0); g.quadraticCurveTo(W / 2 + 25, y0 + 30, W / 2, H - 14);
    g.moveTo(W / 2 - 24, H - 40); g.lineTo(W / 2, H - 12); g.lineTo(W / 2 + 22, H - 42);
  } else if (arrow === 'right') {
    g.moveTo(W - 120, H / 2 + 10); g.quadraticCurveTo(W - 70, H / 2 - 20, W - 18, H / 2);
    g.moveTo(W - 50, H / 2 - 30); g.lineTo(W - 16, H / 2); g.lineTo(W - 52, H / 2 + 22);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Yellow smiley doodle sun with wobbly rays. */
export function makeSunTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const m = s / 2;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = '#1b1b24';
  g.lineWidth = 6;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.1;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * 70, m + Math.sin(a) * 70);
    g.lineTo(m + Math.cos(a + 0.05) * 112, m + Math.sin(a + 0.05) * 112);
    g.stroke();
  }
  g.fillStyle = '#ffd23f';
  g.beginPath();
  g.arc(m, m, 58, 0, Math.PI * 2);
  g.fill();
  // hatch shading on the sun
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(230,150,20,0.55)';
  g.lineWidth = 3;
  for (let i = -s; i < s; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); }
  g.restore();
  g.lineWidth = 6;
  g.beginPath(); g.arc(m, m, 58, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1b1b24';
  g.beginPath(); g.arc(m - 20, m - 12, 6, 0, 7); g.arc(m + 20, m - 12, 6, 0, 7); g.fill();
  g.beginPath(); g.arc(m, m + 4, 26, 0.3, Math.PI - 0.3); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hatched pencil-body stripes (sRGB colour texture multiplied by the body colour). */
export function makePencilHatchTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(150,90,0,0.45)';
  g.lineWidth = 3;
  for (let i = -s; i < s * 2; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s * 0.6, s); g.stroke(); }
  return canvasTex(c);
}

/** Pen-line dash alpha along v: uneven dashes with soft ends (tracers). */
export function makeDashTexture(): THREE.Texture {
  const W = 8, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  let y = 2;
  while (y < H - 4) {
    const len = 9 + Math.random() * 12;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, '#444'); grd.addColorStop(0.2, '#fff'); grd.addColorStop(0.85, '#fff'); grd.addColorStop(1, '#333');
    g.fillStyle = grd;
    g.fillRect(1, y, W - 2, Math.min(len, H - y));
    y += len + 3 + Math.random() * 4;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
