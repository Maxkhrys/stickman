// Continuous-motion review for the stick fighter. Drives the real game with real input (held keys and
// mouse yaw) on a fixed render schedule, records every frame from a world-fixed follow camera, and
// writes per clip: a webm (replayed at the exact schedule), a filmstrip PNG, and per-frame metrics
// (measured travel, cadence, stance/swing, post-IK plant drift, knee flips, pelvis/aim twist, NaN).
//
//   node tests/character.clips.mjs [tag] [filter]      tag defaults to "current"; CLIP_FPS=30|60|120
//
// Output: verification/clips/<tag>/<clip>.{webm,png,json} and summary.json
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const tag = process.argv[2] ?? 'current';
const filter = process.argv[3] ?? '';
const FPS = Number(process.env.CLIP_FPS ?? 60);
const EVERY = Number(process.env.CLIP_EVERY ?? 0); // filmstrip frame step (0 = spread over the clip)
const DIST = Number(process.env.CLIP_DIST ?? 4.2);
const OUT = `verification/clips/${tag}`;
await mkdir(OUT, { recursive: true });
const port = 5200 + Math.floor(Math.random() * 50);
const server = await createServer({ server: { host: '127.0.0.1', port }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await browser.close().catch(() => {}); process.exit(1); });
const page = await browser.newPage({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.stickfight);
await page.evaluate(() => { const a = window.stickfight; a.settings.cameraMode = 'third'; a.settings.mode = 'range'; });
await page.getByRole('button', { name: 'PLAY', exact: true }).click();
await page.waitForFunction(() => window.stickfight.state === 'playing');
await page.evaluate(() => {
  const a = window.stickfight;
  a.loop.stop();
  a.input.locked = true;
  a.hud.root.style.display = 'none';
});

// Scripts run in the page: (t, me) => ({ keys, yaw?, pitch? }). Yaw 0 faces -Z, -PI/2 faces +X.
const CLIPS = [
  { name: 'run-forward', at: [0, 8, 0], cam: Math.PI / 2, sec: 2.2, script: `(t) => ({ keys: t > 0.1 && t < 1.8 ? ['KeyW'] : [] })` },
  { name: 'run-backward', at: [0, -18, 0], cam: Math.PI / 2, sec: 2.2, script: `(t) => ({ keys: t > 0.1 && t < 1.8 ? ['KeyS'] : [] })` },
  { name: 'strafe', at: [-8, 0, 0], cam: 0, sec: 2.0, script: `(t) => ({ keys: t > 0.1 && t < 1.6 ? ['KeyD'] : [] })` },
  { name: 'reversals', at: [-3, 0, 0], cam: 0, sec: 2.6, script: `(t) => ({ keys: t < 0.1 ? [] : (Math.floor((t - 0.1) / 0.32) % 2 ? ['KeyA'] : ['KeyD']) })` },
  { name: 'turn-stationary', at: [-3, 0, 0], cam: 0.6, sec: 3.2, script: `(t) => ({ keys: [], yaw: t < 0.4 ? 0 : t < 1.0 ? Math.PI / 4 : t < 1.7 ? Math.PI * 0.75 : Math.PI * 1.75 })` },
  { name: 'turn-sweep', at: [-3, 0, 0], cam: 0.6, sec: 2.4, script: `(t) => ({ keys: [], yaw: Math.sin(t * 2.6) * 1.6 })` },
  { name: 'backpedal-boundary', at: [-3, 2, 0], cam: 0.9, sec: 2.2, script: `(t) => ({ keys: t > 0.1 ? ['KeyS', 'KeyD'] : [], yaw: -0.35 + Math.sin(t * 9) * 0.12 })` },
  { name: 'run-turn-180', at: [-3, 6, 0], cam: Math.PI / 2, sec: 2.4, script: `(t) => ({ keys: t > 0.1 && t < 2.0 ? ['KeyW'] : [], yaw: t < 0.9 ? 0 : Math.PI })` },
  { name: 'ramp', at: [9, -19, 0], cam: -Math.PI / 2, sec: 2.6, script: `(t) => ({ keys: t > 0.1 && t < 2.1 ? ['KeyW'] : [] })` },
  { name: 'jump', at: [-3, 8, 0], cam: Math.PI / 2, sec: 2.0, script: `(t) => ({ keys: t < 0.1 ? [] : t > 0.6 && t < 0.66 ? ['KeyW', 'Space'] : t < 1.7 ? ['KeyW'] : [] })` },
  { name: 'slide-exit', at: [-3, 8, 0], cam: Math.PI / 2, sec: 2.4, script: `(t) => ({ keys: t < 0.1 ? [] : t > 0.7 && t < 1.2 ? ['KeyW', 'ShiftLeft'] : t < 2.0 ? ['KeyW'] : [] })` },
  { name: 'wall-push', at: [13, 6, -Math.PI / 2], cam: 0, sec: 1.8, script: `(t) => ({ keys: t > 0.1 ? ['KeyW'] : [] })` },
  { name: 'shoot-reload', at: [-3, 6, 0], cam: Math.PI / 2, sec: 2.6, script: `(t) => ({ keys: t < 0.1 ? [] : t < 0.9 ? ['KeyW', 'Mouse0'] : t < 0.95 ? ['KeyW', 'KeyR'] : t < 2.2 ? ['KeyW'] : [] })` },
];

const summary = {};
for (const clip of CLIPS) {
  if (filter && !clip.name.includes(filter)) continue;
  const res = await page.evaluate(async ({ clip, FPS, EVERY, DIST }) => {
    const a = window.stickfight;
    const f = a.adapter.fighters()[0];
    const [x, z, yaw] = clip.at;
    // settle at the start point
    f.pos.x = f.prevPos.x = x; f.pos.z = f.prevPos.z = z; f.pos.y = f.prevPos.y = 0; f.vel.x = f.vel.y = f.vel.z = 0;
    f.yaw = f.prevYaw = f.lowerYaw = f.prevLowerYaw = yaw;
    a.input.yaw = yaw; a.input.pitch = 0; a.input.held.clear();
    a.renderer.characters.reset();
    a.renderer.inspect = { yaw: clip.cam, pitch: 0.12, dist: DIST, height: 0.95, world: true };
    for (let i = 0; i < 30; i++) a.loop.advance(1 / 60);
    const script = eval(clip.script);
    const src = a.renderer.renderer.domElement;
    const w = 320, h = 210;
    const frames = [];
    const metrics = [];
    const dt = 1 / FPS;
    const n = Math.round(clip.sec * FPS);
    let prevAnk = null, prevModes = null, contacts = 0, lastPos = { ...f.pos }, lastT = a.adapter.info().time;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const s = script(t, f);
      a.input.held.clear();
      for (const k of s.keys) a.input.held.add(k);
      if (s.yaw !== undefined) a.input.yaw = yaw + s.yaw;
      if (s.pitch !== undefined) a.input.pitch = s.pitch;
      a.loop.advance(dt);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(src, 0, 0, w, h);
      frames.push(c);
      const an = a.renderer.characters.animOf(f.id);
      const P = an.pose;
      const simT = a.adapter.info().time;
      const travel = simT > lastT ? Math.hypot(f.pos.x - lastPos.x, f.pos.z - lastPos.z) / (simT - lastT) : 0;
      if (simT > lastT) { lastPos = { ...f.pos }; lastT = simT; }
      const modes = an.feet.map((ft) => ft.mode);
      const ank = [P.lAnkle, P.rAnkle].map((q) => ({ x: q.x, y: q.y, z: q.z }));
      let drift = 0;
      if (prevAnk) for (let k = 0; k < 2; k++) {
        if (modes[k] === 0 && prevModes[k] === 0) drift = Math.max(drift, Math.hypot(ank[k].x - prevAnk[k].x, ank[k].y - prevAnk[k].y, ank[k].z - prevAnk[k].z));
        if (modes[k] === 0 && prevModes[k] === 1) contacts++;
      }
      // knee on the wrong side of the hip-ankle line (relative to that foot's facing)
      let kneeFlip = 0;
      for (const [hip, knee, ankle, ft] of [[P.lHip, P.lKnee, P.lAnkle, an.feet[0]], [P.rHip, P.rKnee, P.rAnkle, an.feet[1]]]) {
        const mx = (hip.x + ankle.x) / 2, mz = (hip.z + ankle.z) / 2;
        const d = (knee.x - mx) * -Math.sin(ft.yaw) + (knee.z - mz) * -Math.cos(ft.yaw);
        if (d < -0.02) kneeFlip++;
      }
      let nan = 0;
      for (const k in P) { const q = P[k]; if (q && typeof q === 'object' && (Number.isNaN(q.x) || Number.isNaN(q.y) || Number.isNaN(q.z))) nan++; }
      const wrap = (d) => Math.atan2(Math.sin(d), Math.cos(d));
      const pelvisYaw = Math.atan2(-P.lowerFwd.x, -P.lowerFwd.z);
      metrics.push({
        t: +t.toFixed(3), speed: +Math.hypot(f.vel.x, f.vel.z).toFixed(2), travel: +travel.toFixed(2), state: an.state, modes: modes.join(''),
        drift: +drift.toFixed(4), kneeFlip, nan, twist: +Math.abs(wrap(f.yaw - pelvisYaw)).toFixed(3), gait: +f.gait.toFixed(3),
        plantErr: an.plantError !== undefined ? +an.plantError.toFixed(4) : null, cadence: an.diag?.cadence, jointDev: an.diag ? +an.diag.jointDev.toFixed(3) : null,
      });
      prevAnk = ank; prevModes = modes;
    }
    // filmstrip: every k-th frame
    const pick = EVERY || Math.max(1, Math.round(n / 24));
    const sel = frames.filter((_, i) => i % pick === 0).slice(0, 24);
    const cols = 6, rows = Math.ceil(sel.length / cols);
    const strip = document.createElement('canvas');
    strip.width = cols * w; strip.height = rows * h;
    const g = strip.getContext('2d');
    sel.forEach((c, i) => { g.drawImage(c, (i % cols) * w, Math.floor(i / cols) * h); g.fillStyle = '#000a'; g.fillRect((i % cols) * w, Math.floor(i / cols) * h, 58, 16); g.fillStyle = '#fff'; g.font = '11px monospace'; g.fillText(`${(i * pick * dt).toFixed(2)}s`, (i % cols) * w + 4, Math.floor(i / cols) * h + 12); });
    const png = strip.toDataURL('image/png');
    // webm: replay stored frames at the exact schedule
    const rc = document.createElement('canvas');
    rc.width = w * 2; rc.height = h * 2;
    const rg = rc.getContext('2d');
    rg.drawImage(frames[0], 0, 0, rc.width, rc.height);
    const stream = rc.captureStream(Math.min(FPS, 60));
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_500_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    for (let i = 0; i < frames.length; i++) {
      const due = t0 + i * dt * 1000;
      while (performance.now() < due) await new Promise((r) => setTimeout(r, 2));
      rg.drawImage(frames[i], 0, 0, rc.width, rc.height);
    }
    await new Promise((r) => setTimeout(r, 120));
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const moving = metrics.filter((m) => m.state === 'walk' || m.state === 'run' || m.state === 'sprint');
    const movingSec = moving.length * dt;
    a.renderer.inspect = null;
    return {
      png, webm: btoa(bin), metrics,
      summary: {
        frames: n, fps: FPS,
        meanSpeed: +(moving.reduce((s, m) => s + m.speed, 0) / Math.max(1, moving.length)).toFixed(2),
        meanTravel: +(moving.reduce((s, m) => s + m.travel, 0) / Math.max(1, moving.length)).toFixed(2),
        contactsPerSec: movingSec > 0.3 ? +(contacts / movingSec).toFixed(2) : null,
        contacts,
        maxPlantDrift: Math.max(...metrics.map((m) => m.drift)),
        meanPlantDrift: +(metrics.reduce((s, m) => s + m.drift, 0) / n).toFixed(4),
        kneeFlipFrames: metrics.filter((m) => m.kneeFlip).length,
        nanFrames: metrics.filter((m) => m.nan).length,
        maxTwist: Math.max(...metrics.map((m) => m.twist)),
        stateChanges: metrics.reduce((s, m, i) => s + (i && m.state !== metrics[i - 1].state ? 1 : 0), 0),
        maxJointDev: Math.max(...metrics.map((m) => m.jointDev ?? 0)),
        maxPlantErr: metrics.some((m) => m.plantErr !== null) ? Math.max(...metrics.map((m) => m.plantErr ?? 0)) : null,
      },
    };
  }, { clip, FPS, EVERY, DIST });
  await writeFile(`${OUT}/${clip.name}.png`, Buffer.from(res.png.split(',')[1], 'base64'));
  await writeFile(`${OUT}/${clip.name}.webm`, Buffer.from(res.webm, 'base64'));
  await writeFile(`${OUT}/${clip.name}.json`, JSON.stringify(res.metrics));
  summary[clip.name] = res.summary;
  console.log(clip.name, JSON.stringify(res.summary));
}
await writeFile(`${OUT}/summary${filter ? '-' + filter : ''}-${FPS}fps.json`, JSON.stringify(summary, null, 2));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
await browser.close();
await server.close();
