// Prints hip height and whole-body pose change versus frame 0 every 0.2 s, to find where the action sits inside the
// 5 s exports (roll, slide, reactions): trim from where 'dev' starts rising to where it settles.
//   node tools/anim/windows.mjs /tmp/all.json clipName [clipName ...]
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(process.argv[2]));
const B = j.bones, nb = B.length;
const dec = c => { const bin = Buffer.from(c.q, 'base64'), a = new Float32Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = bin.readInt16LE(i * 2) / 32767; return a; };
const ang = (a, o1, o2) => 2 * Math.acos(Math.min(1, Math.abs(a[o1] * a[o2] + a[o1 + 1] * a[o2 + 1] + a[o1 + 2] * a[o2 + 2] + a[o1 + 3] * a[o2 + 3])));
for (const name of process.argv.slice(3)) {
  const c = j.clips[name], q = dec(c), F = c.frames, fps = c.fps;
  let line = '', line2 = '';
  const dev = f => { let s = 0; for (let b = 0; b < nb; b++) s += ang(q, b * 4, (f * nb + b) * 4); return s / nb * 180 / Math.PI; };
  for (let f = 0; f < F; f += 6) { line += c.hip[f * 3 + 1].toFixed(2).padStart(6); line2 += dev(f).toFixed(0).padStart(6); }
  console.log(`\n${name}  t = 0, 0.2, ... s`);
  console.log('hipY ' + line); console.log('dev  ' + line2);
}
