// Finds gait-cycle windows in baked clips: for each clip, the shortest windows whose first and last pose match (the loop
// seam, in degrees of lower-body rotation) among the stretches where the legs actually move.
//   node tools/anim/bake-robot.mjs glb <file.glb> /tmp/all.json        (bake every clip whole)
//   node tools/anim/loops.mjs /tmp/all.json [clipName ...]
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2]));
const only = process.argv.slice(3);
const B = j.bones, idx = Object.fromEntries(B.map((b, i) => [b, i]));
const low = B.filter(b => /UpLeg|Leg$|Foot|ToeBase|Spine$/.test(b) && !/End/.test(b)).map(b => idx[b]);
function decode(c) {
  const bin = Buffer.from(c.q, 'base64'); const n = bin.length / 2, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = bin.readInt16LE(i * 2) / 32767; return a;
}
const ang = (a, o1, o2) => { let d = Math.abs(a[o1] * a[o2] + a[o1 + 1] * a[o2 + 1] + a[o1 + 2] * a[o2 + 2] + a[o1 + 3] * a[o2 + 3]); return 2 * Math.acos(Math.min(1, d)); };
for (const [name, c] of Object.entries(j.clips)) {
  if (only.length && !only.includes(name)) continue;
  const q = decode(c), nb = B.length, F = c.frames, fps = c.fps;
  const seam = (f0, f1) => { let s = 0; for (const b of low) s += ang(q, (f0 * nb + b) * 4, (f1 * nb + b) * 4); return s / low.length * 180 / Math.PI; };
  // activity per frame: lower-body motion speed
  const act = []; for (let f = 1; f < F; f++) { let s = 0; for (const b of low) s += ang(q, ((f - 1) * nb + b) * 4, (f * nb + b) * 4); act.push(s / low.length * 180 / Math.PI * fps); }
  const results = [];
  for (let T = Math.round(0.4 * fps); T <= Math.min(F - 2, Math.round(3.4 * fps)); T++) for (let f0 = 0; f0 + T < F; f0++) {
    const s = seam(f0, f0 + T);
    // mean activity inside the window: reject windows that are mostly still
    let a = 0; for (let f = f0; f < f0 + T; f++) a += act[f]; a /= T;
    results.push({ f0, T, s, a });
  }
  const maxA = Math.max(...results.map(r => r.a));
  const good = results.filter(r => r.a > 0.45 * maxA);
  good.sort((x, y) => x.s - y.s);
  console.log(`\n${name}  (${F} frames @${fps}, max activity ${maxA.toFixed(0)} deg/s)`);
  const seen = [];
  for (const r of good) { if (seen.some(o => Math.abs(o.T - r.T) < 3 && Math.abs(o.f0 - r.f0) < 6)) continue; seen.push(r); if (seen.length >= 5) break; console.log(`  start ${(r.f0 / fps).toFixed(2)}s len ${(r.T / fps).toFixed(2)}s seam ${r.s.toFixed(1)} deg activity ${r.a.toFixed(0)}`); }
}
