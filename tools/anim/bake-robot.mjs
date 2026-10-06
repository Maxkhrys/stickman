// Retargets Mixamo FBX clips from the shared animation collection onto the robot mannequin and bakes
// only the clips the shooter uses into one compact file.
//
//   node tools/anim/bake-robot.mjs catalog <packsDir>             measure every clip in every pack
//   node tools/anim/bake-robot.mjs check <packsDir>               print rest-pose axes of source and robot
//   node tools/anim/bake-robot.mjs bake <packsDir> <out.json>     bake PICKS
//
// <packsDir> holds the unzipped packs from the anthonysadveture repo ("Basic Shooter Pack/...", etc.)
// plus a "Singles" folder for the loose FBX files. Raw packs stay out of this repo (size + licence).
//
// Retargeting: the robot rests in an A-pose with Tripo-style bone axes; Mixamo sources rest in a
// T-pose with Mixamo axes. Copying local rotations would be wrong for both reasons. Each robot bone
// instead takes the source bone's world rotation change from its rest (Δ = M·M0⁻¹), applied after C,
// the swing that turns the robot's rest bone direction onto the source rest bone direction:
//   W = Δ · C · R0      (R0 = robot rest world rotation)
// so robot bones point where the mocap bones point, twist included, while keeping robot lengths.
// Hips travel is scaled by the hip-height ratio. Loops are baked in place (the controller owns
// movement); one-shots keep a separate root curve that the runtime ignores (no double root motion).
import fs from 'node:fs';
import path from 'node:path';
import * as T from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { robotSkeleton, readGlbJson } from './robotRig.mjs';

const FPS = 30;
const ROBOT = process.env.CHAR_GLB ? path.resolve(process.env.CHAR_GLB) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../public/assets/robot/robot.glb');
const rig = robotSkeleton(ROBOT);

// Every robot bone that skins something; finger tips and *_End are leaves with no weights.
const BONES = rig.names.filter(n => !/_End$|4$/.test(n));
const CHILD = {};
for (const n of BONES) {
  const b = rig.bones[n];
  const kids = b.children.filter(c => c.isBone).map(c => c.name);
  const pref = { Hips: 'Spine', Spine2: 'Neck', LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1', Neck: 'Head', Head: 'HeadTop_End' }[n];
  CHILD[n] = pref ?? kids[0];
}
const PARENT = Object.fromEntries(BONES.map(n => [n, rig.bones[n].parent?.isBone ? rig.bones[n].parent.name : null]));
const R0 = {}, P0 = {};
for (const n of rig.names) { R0[n] = rig.bones[n].getWorldQuaternion(new T.Quaternion()); P0[n] = rig.bones[n].getWorldPosition(new T.Vector3()); }
const robotDir = n => P0[CHILD[n]].clone().sub(P0[n]).normalize();
const ROBOT_HIP_Y = P0.Hips.y;

// three's FBXLoader guesses where the node records end from the footer size; some Mixamo exports
// have a longer footer and it then parses footer bytes as a node. Cut the file right after the
// last top-level record (plus the slack the loader expects) so the guess lands correctly.
function trimFooter(b) {
  const ver = b.readUInt32LE(23), big = ver >= 7500;
  let o = 27;
  for (;;) {
    const end = big ? Number(b.readBigUInt64LE(o)) : b.readUInt32LE(o);
    if (end === 0 || end > b.length) break;
    o = end;
  }
  return b.subarray(0, Math.min(b.length, o + 176));
}

function load(file) {
  const b = trimFooter(fs.readFileSync(file));
  const obj = new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  const bones = {};
  obj.traverse(o => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] ??= o; });
  return { obj, bones, clip: obj.animations[0] };
}

// Source rest pose is taken from the X Bot bind pose each pack ships with (T-pose), not frame 0.
let SRC_REST = null;
function sourceRest(packsDir) {
  if (SRC_REST) return SRC_REST;
  const { obj, bones } = load(path.join(packsDir, 'Basic Shooter Pack', 'X Bot.fbx'));
  obj.updateMatrixWorld(true);
  const q = {}, p = {};
  for (const [n, b] of Object.entries(bones)) { q[n] = b.getWorldQuaternion(new T.Quaternion()); p[n] = b.getWorldPosition(new T.Vector3()); }
  return (SRC_REST = { q, p });
}

/** Sample a clip into robot-local quaternions + hips position (robot units, root motion included). */
function sample(packsDir, file) {
  const rest = sourceRest(packsDir);
  const { obj, bones, clip } = load(file);
  const C = {};
  for (const n of BONES) {
    if (!bones[n] || !rest.p[CHILD[n]]) throw new Error(`${path.basename(file)} lacks ${n}`);
    const ds = rest.p[CHILD[n]].clone().sub(rest.p[n]).normalize();
    C[n] = new T.Quaternion().setFromUnitVectors(robotDir(n), ds);
  }
  const scale = ROBOT_HIP_Y / rest.p.Hips.y;
  const mixer = new T.AnimationMixer(obj), act = mixer.clipAction(clip);
  act.setLoop(T.LoopOnce); act.clampWhenFinished = true; act.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1), out = [];
  const inv = new T.Quaternion(), world = {};
  for (let f = 0; f < frames; f++) {
    mixer.setTime(Math.min(clip.duration, f / FPS)); obj.updateMatrixWorld(true);
    for (const n of BONES) {
      const m = bones[n].getWorldQuaternion(new T.Quaternion());
      world[n] = m.multiply(inv.copy(rest.q[n]).invert()).multiply(C[n]).multiply(R0[n]);
    }
    const q = {};
    for (const n of BONES) q[n] = PARENT[n] ? world[PARENT[n]].clone().invert().multiply(world[n]) : world[n].clone();
    const hip = bones.Hips.getWorldPosition(new T.Vector3()).sub(rest.p.Hips).multiplyScalar(scale).add(P0.Hips);
    out.push({ q, hip });
  }
  return { frames: out, duration: (frames - 1) / FPS, name: path.basename(file, '.fbx') };
}

// GLB sources ("file.glb#animation name"): clips authored on a Mixamo-named rig (Tripo exports).
// The source rest is that file's own node pose; sampling is linear/slerp per keyframe, as glTF says.
function glbAccessor(json, bin, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  if (a.componentType !== 5126) throw new Error('only float accessors');
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? n * 4, out = new Float32Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = bin.readFloatLE(off + k * stride + c * 4);
  return out;
}
function sampleGlb(spec) {
  const [file, animName] = spec.split('#');
  const json = readGlbJson(file), raw = fs.readFileSync(file);
  const jl = raw.readUInt32LE(12), bin = raw.subarray(20 + jl + 8);
  const anim = json.animations.find(a => a.name === animName);
  if (!anim) throw new Error(`${file} has no animation "${animName}"`);
  const { root, bones } = robotSkeleton(file);
  const restQ = {}, restP = {};
  for (const [n, b] of Object.entries(bones)) { restQ[n] = b.getWorldQuaternion(new T.Quaternion()); restP[n] = b.getWorldPosition(new T.Vector3()); }
  const byNode = {};
  json.nodes.forEach((nd, i) => { if (/^mixamorig/.test(nd.name ?? '')) byNode[i] = bones[nd.name.replace(/^mixamorig:?/, '')]; });
  const tracks = anim.channels.filter(c => byNode[c.target.node] && c.target.path !== 'scale').map(c => {
    const s = anim.samplers[c.sampler];
    return { bone: byNode[c.target.node], path: c.target.path, t: glbAccessor(json, bin, s.input), v: glbAccessor(json, bin, s.output) };
  });
  const duration = Math.max(...tracks.map(k => k.t[k.t.length - 1]));
  const C = {};
  for (const n of BONES) {
    if (!bones[n] || !restP[CHILD[n]]) throw new Error(`${path.basename(file)} lacks ${n}`);
    C[n] = new T.Quaternion().setFromUnitVectors(robotDir(n), restP[CHILD[n]].clone().sub(restP[n]).normalize());
  }
  const scale = ROBOT_HIP_Y / restP.Hips.y;
  const frames = Math.max(2, Math.round(duration * FPS) + 1), out = [], inv = new T.Quaternion(), world = {};
  const qa = new T.Quaternion(), qb = new T.Quaternion();
  for (let f = 0; f < frames; f++) {
    const time = Math.min(duration, f / FPS);
    for (const k of tracks) {
      let i = 0; while (i < k.t.length - 2 && k.t[i + 1] <= time) i++;
      const span = k.t.length > 1 ? k.t[i + 1] - k.t[i] : 1, u = k.t.length > 1 ? Math.min(1, Math.max(0, (time - k.t[i]) / span)) : 0;
      const j = Math.min(i + 1, k.t.length - 1);
      if (k.path === 'rotation') k.bone.quaternion.copy(qa.fromArray(k.v, i * 4).slerp(qb.fromArray(k.v, j * 4), u));
      else k.bone.position.set(...[0, 1, 2].map(c => k.v[i * 3 + c] + (k.v[j * 3 + c] - k.v[i * 3 + c]) * u));
    }
    root.updateMatrixWorld(true);
    for (const n of BONES) world[n] = bones[n].getWorldQuaternion(new T.Quaternion()).multiply(inv.copy(restQ[n]).invert()).multiply(C[n]).multiply(R0[n]);
    const q = {};
    for (const n of BONES) q[n] = PARENT[n] ? world[PARENT[n]].clone().invert().multiply(world[n]) : world[n].clone();
    const hip = bones.Hips.getWorldPosition(new T.Vector3()).sub(restP.Hips).multiplyScalar(scale).add(P0.Hips);
    out.push({ q, hip });
  }
  return { frames: out, duration: (frames - 1) / FPS, name: animName };
}

// Forward kinematics on the robot skeleton, to measure what the robot actually does with a clip.
function robotFK() {
  const { root, bones } = robotSkeleton(ROBOT);
  return {
    bones,
    pose(fr, hip) {
      for (const n of BONES) bones[n].quaternion.copy(fr.q[n]);
      bones.Hips.position.copy(hip ?? fr.hip);
      root.updateMatrixWorld(true);
      return ['Left', 'Right'].map(s => bones[s + 'ToeBase'].getWorldPosition(new T.Vector3()).add(bones[s + 'Foot'].getWorldPosition(new T.Vector3())).multiplyScalar(0.5));
    },
  };
}

/** Speeds, loop seam, contact. "stride" = ground speed at which a planted foot stays put (robot units/s). */
function measure(clip) {
  const F = clip.frames, n = F.length, a = F[0].hip, z = F[n - 1].hip;
  const travel = new T.Vector3(z.x - a.x, 0, z.z - a.z), rootSpeed = travel.length() / clip.duration;
  const fk = robotFK(), lin = f => new T.Vector3(a.x + travel.x * f / (n - 1), 0, a.z + travel.z * f / (n - 1));
  const feet = F.map((fr, f) => fk.pose(fr, fr.hip.clone().sub(lin(f))));
  const floor = Math.min(...feet.flat().map(p => p.y));
  let vx = 0, vz = 0, k = 0;
  const thr = 0.035;
  for (let f = 1; f < n; f++) for (const s of [0, 1]) {
    if (feet[f][s].y < floor + thr && feet[f - 1][s].y < floor + thr) {
      vx += (feet[f][s].x - feet[f - 1][s].x) * FPS; vz += (feet[f][s].z - feet[f - 1][s].z) * FPS; k++;
    }
  }
  const planted = k ? new T.Vector3(-vx / k, 0, -vz / k) : new T.Vector3();
  let seam = 0; for (const b of BONES) seam += F[0].q[b].angleTo(F[n - 1].q[b]); seam = seam / BONES.length * 180 / Math.PI;
  const down = feet.map(p => p[0].y < floor + thr);
  let sync = 0; for (let f = 1; f < n; f++) if (down[f] && !down[f - 1]) { sync = f / (n - 1); break; }
  return { sync, rootSpeed, stride: planted.length(), dir: Math.atan2(planted.x, planted.z) * 180 / Math.PI, seam, contact: k / (2 * (n - 1)), floor, hipY: a.y };
}

const r4 = v => Math.round(v * 1e4) / 1e4;
/** Left/right mirror (x -> -x) of a sampled clip: each bone takes its opposite's rest-relative rotation. */
function mirrorClip(clip) {
  const opp = n => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
  const m = q => new T.Quaternion(q.x, -q.y, -q.z, q.w);
  return { ...clip, name: clip.name + ' (mirrored)', frames: clip.frames.map(fr => {
    const world = {};
    for (const n of BONES) {
      let w = fr.q[n].clone();
      for (let p = PARENT[n]; p; p = PARENT[p]) w = fr.q[p].clone().multiply(w);
      world[n] = w;
    }
    const out = {};
    for (const n of BONES) { const o = opp(n); out[n] = m(world[o].clone().multiply(R0[o].clone().invert())).multiply(R0[n]); }
    const q = {};
    for (const n of BONES) q[n] = PARENT[n] ? out[PARENT[n]].clone().invert().multiply(out[n]) : out[n].clone();
    return { q, hip: new T.Vector3(2 * P0.Hips.x - fr.hip.x, fr.hip.y, fr.hip.z) };
  }) };
}

function bake(clip, { loop = false, trim = [0, Infinity], speed = 1, flatY = false, mirror = false, strideFromTravel = false, center = false }) {
  if (mirror) clip = mirrorClip(clip);
  const s = Math.round(trim[0] * FPS), e = Math.min(clip.frames.length - 1, Math.round(trim[1] * FPS));
  let F = clip.frames.slice(s, e + 1);
  const n = F.length, a = F[0].hip.clone(), z = F[n - 1].hip.clone();
  const m = measure({ ...clip, frames: F, duration: (n - 1) / FPS });
  const q = new Int16Array(n * BONES.length * 4), hip = [];
  F.forEach((fr, f) => {
    BONES.forEach((b, k) => {
      const v = fr.q[b]; const o = (f * BONES.length + k) * 4;
      // keep w >= 0 per sample so int16 interpolation never crosses the double cover
      const sgn = v.w < 0 ? -1 : 1;
      q[o] = Math.round(v.x * sgn * 32767); q[o + 1] = Math.round(v.y * sgn * 32767); q[o + 2] = Math.round(v.z * sgn * 32767); q[o + 3] = Math.round(v.w * sgn * 32767);
    });
    // In place: loops lose their average travel; one-shots lose all horizontal travel.
    const off = loop ? new T.Vector3((z.x - a.x) * f / (n - 1), 0, (z.z - a.z) * f / (n - 1)) : new T.Vector3(fr.hip.x - a.x, 0, fr.hip.z - a.z);
    // center: a clip cut mid-walk starts away from the origin; pull its first frame back over the feet' origin
    const cx = center ? a.x - P0.Hips.x : 0, cz = center ? a.z - P0.Hips.z : 0;
    hip.push(r4(fr.hip.x - off.x - cx - P0.Hips.x), r4((flatY ? a.y : fr.hip.y) - P0.Hips.y), r4(fr.hip.z - off.z - cz - P0.Hips.z));
  });
  return { frames: n, fps: FPS * speed, loop, stride: r4((strideFromTravel ? m.rootSpeed : m.stride) * speed), travel: r4(m.rootSpeed * speed), sync: r4(m.sync), q: Buffer.from(q.buffer).toString('base64'), hip };
}

// Chosen clips: [runtime name, pack/file, options]. Reasons in docs/ANIMATION_SOURCES.md.
const MAX = 'Max/walking with sniper.glb';
const S = 'Basic Shooter Pack/', A = 'Action Adventure Pack/', M = 'Magic Locomotion Pack/', P = 'Pro Sword and Shield Pack/', G = 'Singles/', f = x => x / FPS;
export const PICKS = [
  // Rifle stance: full body at rest, and the upper-body base layer while moving.
  ['idle', S + 'rifle aiming idle', { loop: true }],
  // Directional locomotion (lower body). One family (Magic pack) so stance, cadence and phase
  // match between directions; its arms are replaced by the rifle layer.
  ['walkF', M + 'Standing Walk Forward', { loop: true }],
  ['walkB', M + 'Standing Walk Back', { loop: true }],
  ['walkL', M + 'Standing Walk Left', { loop: true }],
  ['walkR', M + 'Standing Walk Right', { loop: true }],
  ['runF', M + 'Standing Run Forward', { loop: true }],
  ['runB', M + 'Standing Run Back', { loop: true }],
  ['runL', M + 'Standing Run Left', { loop: true }],
  ['runR', M + 'Standing Run Right', { loop: true }],
  ['sprint', M + 'Standing Sprint Forward', { loop: true }],
  // Air: rifle jump split into takeoff, tuck and reach-for-floor; vertical travel removed
  // (the controller owns height). Falling idle for long drops.
  ['jump', S + 'rifle jump', { trim: [f(2), f(9)], flatY: true }],
  ['tuck', S + 'rifle jump', { trim: [f(8), f(12)], flatY: true }],
  ['reach', S + 'rifle jump', { trim: [f(12), f(15)], flatY: true }],
  ['fall', A + 'falling idle', { loop: true, flatY: true }],
  ['land', S + 'rifle jump', { trim: [f(15), f(18)] }],
  // Upper-body actions.
  ['reload', S + 'reloading', {}],
  ['fire', S + 'firing rifle', {}],
  // Sniper walk pair from Max (Tripo export on the robot rig): hip carry and scoped walk.
  // Each is trimmed to one whole step cycle (the export runs 4 1/6), matching the other walks; the scoped one is a
  // sidestep to the right while aiming, mirrored for the left. Planted-foot speed = root travel.
  ['walkSniper', MAX + '#walking holding a sniper.001', { loop: true, trim: [f(18), f(54)], strideFromTravel: true, center: true }],
  ['walkSniperAdsR', MAX + '#aimed down sights with sniper walking.001', { loop: true, trim: [f(30), f(66)], strideFromTravel: true, center: true }],
  ['walkSniperAdsL', MAX + '#aimed down sights with sniper walking.001', { loop: true, trim: [f(30), f(66)], strideFromTravel: true, mirror: true, center: true }],
  // ---- combat / traversal pass ----
  // Relaxed upright stance for the legs and spine (the rifle idle is a deep bladed crouch). The arms are IK'd
  // onto the weapon, so only legs, hips and spine of this clip show.
  ['idleUp', 'Locomotion Pack/idle', { loop: true }],
  // Dodge roll (ground dash): the tumble part of the sprinting roll, sped up to fit MOVE.rollTime.
  ['roll', G + 'Sprinting Forward Roll', { trim: [f(11), f(35)], speed: 1.6 }],
  // Landing roll (hard landing at speed) and heavy landing (hard landing standing still).
  ['rollLand', A + 'falling to roll', { trim: [f(10), f(44)], speed: 1.5 }],
  ['hardLand', A + 'hard landing', { trim: [f(8), f(48)], speed: 2 }],
  // Hit reactions: front (Basic Shooter) and large flinches from the left / back, mirrored for the right.
  ['hitFront', S + 'hit reaction', {}],
  ['hitL', G + 'Standing React Large From Left', {}],
  ['hitR', G + 'Standing React Large From Left', { mirror: true }],
  ['hitBack', G + 'Standing React Large From Back', {}],
  ['death', P + 'sword and shield death', {}],
  // Melee ("Pencil"): fighting guard for the arms and torso, a quick overhead cut (alternating sides) and
  // a heavy lunging slash. They overlay the torso and arms; the legs keep the locomotion cycle.
  ['meleeGuard', P + 'sword and shield idle (4)', { loop: true }],
  ['meleeLight', P + 'sword and shield slash (3)', { trim: [f(15), f(42)], speed: 2.6 }],
  ['meleeLightB', P + 'sword and shield slash', { trim: [f(12), f(35)], speed: 2.4 }],
  ['meleeHeavy', P + 'sword and shield attack (2)', { trim: [0, f(31)], speed: 1.8 }],
];

const [cmd, dir, outFile] = process.argv.slice(2);
if (cmd === 'catalog') {
  console.log(['pack', 'clip', 'sec', 'root/s', 'stride/s', 'dir°', 'seam°', 'contact%', 'hipY'].join('\t'));
  for (const pack of fs.readdirSync(dir).sort()) for (const fl of fs.readdirSync(path.join(dir, pack)).sort()) {
    if (!fl.endsWith('.fbx') || fl.startsWith('X Bot')) continue;
    try {
      const c = sample(dir, path.join(dir, pack, fl)), m = measure(c);
      console.log([pack.replace(' Pack', ''), c.name, c.duration.toFixed(2), m.rootSpeed.toFixed(2), m.stride.toFixed(2), m.dir.toFixed(0), m.seam.toFixed(1), (m.contact * 100).toFixed(0), m.hipY.toFixed(3)].join('\t'));
    } catch (e) { console.log([pack, fl, 'ERR ' + e.message].join('\t')); }
  }
} else if (cmd === 'check') {
  const rest = sourceRest(dir);
  for (const n of ['Hips', 'Spine2', 'LeftArm', 'LeftForeArm', 'LeftUpLeg', 'LeftFoot', 'Head']) console.log(n, 'src', rest.p[CHILD[n]].clone().sub(rest.p[n]).normalize().toArray().map(v => v.toFixed(2)).join(','), 'robot', robotDir(n).toArray().map(v => v.toFixed(2)).join(','));
  console.log('src hipY', rest.p.Hips.y.toFixed(2), 'robot hipY', ROBOT_HIP_Y.toFixed(3));
} else if (cmd === 'bake') {
  const clips = {};
  for (const [name, file, opt] of PICKS) {
    const glbSrc = file.includes('.glb#');
    clips[name] = bake(glbSrc ? sampleGlb(path.join(dir, file)) : sample(dir, path.join(dir, file + '.fbx')), opt);
    clips[name].source = glbSrc ? file : file + '.fbx';
    console.error(name.padEnd(11), String(clips[name].frames).padStart(3), 'frames, stride', clips[name].stride, 'travel', clips[name].travel, 'sync', clips[name].sync, '<-', file);
  }
  fs.writeFileSync(outFile, JSON.stringify({ fps: FPS, bones: BONES, restHip: P0.Hips.toArray(), clips }));
  console.error('wrote', outFile, (fs.statSync(outFile).size / 1024).toFixed(0), 'KB');
}
