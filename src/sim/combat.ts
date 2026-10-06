import { WEAPONS, type WeaponDef } from '../config/weapons';
import { MOVE } from '../config/movement';
import { buildSkeleton, createSkeleton } from './body';
import type { SimContext } from './context';
import { eyePos, kickAt, muzzlePos, type Fighter } from './fighter';
import { buildHitboxes, rayHitbox, raySphere, type Hitbox } from './hitboxes';
import type { HitPart, WeaponId } from './types';
import { clamp, flatForward, forwardFromAngles, lerp, v3, vaddScaled, vclone, vdot, vnorm, vsub, type Vec3 } from './vec';

const hbScratch: Hitbox[] = [];
const skel = createSkeleton();

export interface TraceResult {
  t: number;
  point: Vec3;
  normal: Vec3 | null;
  fighter: Fighter | null;
  part: HitPart | null;
}

/** Hitscan trace against world + every living fighter except the shooter. */
export function traceShot(ctx: { world: SimContext['world']; fighters: readonly Fighter[] }, shooter: Fighter, o: Vec3, d: Vec3, range: number): TraceResult {
  const wh = ctx.world.raycast(o, d, range);
  let bestT = wh ? wh.t : range;
  let normal = wh ? wh.normal : null;
  let hitF: Fighter | null = null;
  let part: HitPart | null = null;
  for (const f of ctx.fighters) {
    if (f.id === shooter.id || !f.alive) continue;
    // broadphase: distance from ray to the fighter's centre
    const cx = f.pos.x - o.x, cy = f.pos.y + 0.9 - o.y, cz = f.pos.z - o.z;
    const along = cx * d.x + cy * d.y + cz * d.z;
    if (along < -1.5 || along > bestT + 1.5) continue;
    const px = cx - d.x * along, py = cy - d.y * along, pz = cz - d.z * along;
    if (px * px + py * py + pz * pz > 1.6 * 1.6) continue;
    buildHitboxes(f, hbScratch);
    for (const hb of hbScratch) {
      const t = rayHitbox(o, d, hb);
      if (t < 0 || t >= bestT) continue;
      bestT = t;
      hitF = f;
      part = hb.part;
      normal = null;
    }
  }
  return { t: bestT, point: vaddScaled(o, d, bestT), normal, fighter: hitF, part };
}

/** Shooter state at the moment of the shot, carried on hit/kill events for feedback. */
export interface ShotInfo {
  airborne: boolean;
  quickscope: boolean;
  distance: number;
}
const NO_SHOT: ShotInfo = { airborne: false, quickscope: false, distance: 0 };

/** Quickscope window: a scoped shot fired this soon after starting to aim. */
export const QUICKSCOPE_WINDOW = 0.6;

export function applyDamage(
  ctx: SimContext,
  attacker: Fighter,
  victim: Fighter,
  dmg: number,
  part: HitPart,
  pos: Vec3,
  dir: Vec3,
  weapon: WeaponId,
  backstab = false,
  shot: ShotInfo = NO_SHOT,
) {
  if (!victim.alive) return;
  dmg = Math.round(dmg);
  const blocked = victim.spawnProtect > 0;
  const dealt = blocked ? 0 : Math.min(dmg, victim.hp);
  victim.hp -= dealt;
  if (!blocked) {
    victim.lastDamageTime = ctx.time;
    victim.lastAttacker = attacker.id;
    attacker.stats.damage += Math.round(dealt);
  }
  const killed = victim.hp <= 0;
  ctx.events.push({
    type: 'hit',
    attacker: attacker.id,
    victim: victim.id,
    damage: blocked ? 0 : dmg,
    part,
    pos: vclone(pos),
    dir: vclone(dir),
    killed,
    backstab,
    weapon,
    blocked,
    ...shot,
  });
  ctx.onDamaged(victim, attacker);
  if (killed) {
    victim.hp = 0;
    victim.alive = false;
    victim.deathTime = ctx.time;
    victim.stats.deaths++;
    victim.stats.streak = 0;
    victim.respawnTimer = victim.kind === 'dummy' ? 1.2 : 3;
    if (attacker !== victim) {
      attacker.stats.kills++;
      attacker.stats.streak++;
      attacker.stats.bestStreak = Math.max(attacker.stats.bestStreak, attacker.stats.streak);
    }
    ctx.events.push({
      type: 'kill',
      killer: attacker.id,
      victim: victim.id,
      weapon,
      headshot: part === 'head',
      backstab,
      part,
      dir: vclone(dir),
      ...shot,
    });
    ctx.onKilled(victim, attacker);
  }
}

/** ADS accuracy 0..1 (smoothstep over the weapon's accuracy window). */
export function adsAccuracy(f: Fighter, def: WeaponDef = WEAPONS[f.weapons[f.cur].id]): number {
  const a = clamp((f.ads - def.adsAccuracyStart) / Math.max(1e-3, def.adsAccuracyFull - def.adsAccuracyStart), 0, 1);
  return a * a * (3 - 2 * a);
}

/** Scoped precision is binary past the readiness threshold: weapons with `adsReady` are exact once ready. */
export function adsReady(f: Fighter, def: WeaponDef = WEAPONS[f.weapons[f.cur].id]): boolean {
  return def.adsReady !== undefined && f.ads >= def.adsReady;
}

export function computeSpread(f: Fighter): number {
  const def = WEAPONS[f.weapons[f.cur].id];
  if (def.kind === 'melee') return 0;
  if (def.adsReady !== undefined) {
    if (adsReady(f, def)) return 0;
    const hs = Math.hypot(f.vel.x, f.vel.z);
    return def.spreadHip + def.spreadMove * clamp(hs / MOVE.maxSpeed, 0, 1.4) + (f.onGround ? 0 : def.spreadAir);
  }
  const acc = adsAccuracy(f, def);
  const hs = Math.hypot(f.vel.x, f.vel.z);
  let base = (def.spreadHip + f.bloom) * lerp(1, def.adsSpreadMult, acc);
  if (f.crouching && f.onGround && !f.sliding) base *= 0.8;
  const mov = (def.spreadMove * clamp(hs / MOVE.maxSpeed, 0, 1.4) + (f.onGround ? 0 : def.spreadAir)) * lerp(1, def.adsMoveSpreadMult, acc);
  return base + mov;
}

/** Current aim angles including sustained recoil and the transient kick. */
export function aimAngles(f: Fighter, time: number): { yaw: number; pitch: number } {
  const k = kickAt(f, time);
  return { yaw: f.yaw + f.recoilYaw + k.yaw, pitch: f.pitch + f.recoilPitch + k.pitch };
}

/** Direction for yaw/pitch offset by small angles (dx right, dy up). */
function offsetDir(yaw: number, pitch: number, dx: number, dy: number): Vec3 {
  const fw = forwardFromAngles(yaw, pitch);
  const rt = v3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = forwardFromAngles(yaw, pitch + Math.PI / 2);
  const tx = Math.tan(dx), ty = Math.tan(dy);
  return vnorm(v3(fw.x + rt.x * tx + up.x * ty, fw.y + rt.y * tx + up.y * ty, fw.z + rt.z * tx + up.z * ty));
}

/** Furthest the aim origin (camera) may sit from the eye; anything beyond is treated as the eye. */
export const MAX_AIM_OFFSET = 4.5;

/** Camera position used as the aim origin: eye + the command's offset, clamped and LOS-checked. */
export function aimOrigin(ctx: { world: SimContext['world'] }, f: Fighter): Vec3 {
  const eye = eyePos(f);
  const ox = f.aimOX, oy = f.aimOY, oz = f.aimOZ;
  const len = Math.hypot(ox, oy, oz);
  if (len < 1e-4 || len > MAX_AIM_OFFSET) return eye;
  const o = v3(eye.x + ox, eye.y + oy, eye.z + oz);
  // the camera must be somewhere the fighter could actually look from (no aiming from inside walls)
  if (!ctx.world.los(eye, o)) return eye;
  return o;
}

export interface ShotResolve {
  /** intended point: first world surface or fighter on the camera ray through the reticle */
  aim: Vec3;
  /** what the bullet actually hits, traced from the muzzle toward `aim` */
  tr: TraceResult;
  muzzle: Vec3;
  /** something between the muzzle and the intended point stopped the shot */
  obstructed: boolean;
}

/**
 * Two-stage shot: (1) the intended point is where the camera ray through the reticle first meets the
 * world or a fighter (excluding the shooter and anything behind the shooter's eye plane); (2) the bullet
 * travels from the actual muzzle toward that point and stops at any nearer obstruction. A camera that
 * can see past a corner therefore never lets the barrel shoot through the wall in front of it.
 */
export function resolveShot(ctx: { world: SimContext['world']; fighters: readonly Fighter[] }, f: Fighter, dir: Vec3): ShotResolve {
  const def = WEAPONS[f.weapons[f.cur].id];
  const eye = eyePos(f);
  const o = aimOrigin(ctx, f);
  // start the camera ray level with the eye so nothing between camera and shooter is targeted
  const t0 = Math.max(0, (eye.x - o.x) * dir.x + (eye.y - o.y) * dir.y + (eye.z - o.z) * dir.z);
  const start = vaddScaled(o, dir, t0);
  const cam = traceShot(ctx, f, start, dir, def.range);
  const aim = cam.point;
  const muzzle = muzzlePos(f);

  // barrel inside geometry the eye can see past (hugging a wall)
  const em = vsub(muzzle, eye);
  const emLen = Math.hypot(em.x, em.y, em.z);
  const emDir = vnorm(em);
  const inWall = emLen > 1e-3 ? ctx.world.raycast(eye, emDir, emLen) : null;
  if (inWall) {
    const p = vaddScaled(eye, emDir, inWall.t);
    return { aim, muzzle, obstructed: true, tr: { t: 0, point: p, normal: inWall.normal, fighter: null, part: null } };
  }
  const mt = vsub(aim, muzzle);
  const mtLen = Math.hypot(mt.x, mt.y, mt.z);
  const md = mtLen > 0.25 ? vnorm(mt) : dir;
  const tr = traceShot(ctx, f, muzzle, md, mtLen > 0.25 ? Math.min(def.range, mtLen + 0.06) : def.range);
  // obstructed: stopped clearly short of the intended point by something other than the intended target
  const obstructed = tr.t < mtLen - 0.08 && !(cam.fighter && tr.fighter === cam.fighter);
  if (!tr.fighter && !tr.normal && !cam.normal && !cam.fighter) {
    // open sky: report the far point along the muzzle line
    tr.point = vaddScaled(muzzle, md, def.range);
    tr.t = def.range;
  }
  return { aim, tr, muzzle, obstructed };
}

/** Back-compat helper (HUD): same result shape as before. */
export function traceFireLine(ctx: { world: SimContext['world']; fighters: readonly Fighter[] }, f: Fighter, dir: Vec3) {
  return resolveShot(ctx, f, dir);
}

export function fireHitscan(ctx: SimContext, f: Fighter, def: WeaponDef) {
  const spread = computeSpread(f);
  const a = ctx.rng() * Math.PI * 2;
  const r = Math.sqrt(ctx.rng()) * spread;
  const aim = aimAngles(f, ctx.time);
  const dir = offsetDir(aim.yaw, aim.pitch, Math.cos(a) * r, Math.sin(a) * r);
  const { tr, muzzle, obstructed } = resolveShot(ctx, f, dir);
  const shot: ShotInfo = {
    airborne: !f.onGround,
    quickscope: !!def.scope && adsReady(f, def) && ctx.time - f.adsStartTime <= QUICKSCOPE_WINDOW,
    distance: Math.hypot(tr.point.x - muzzle.x, tr.point.y - muzzle.y, tr.point.z - muzzle.z),
  };
  f.stats.shots++;
  if (f.spawnProtect > 0) {
    f.spawnProtect = 0;
    ctx.events.push({ type: 'protectEnd', id: f.id });
  }

  ctx.events.push({
    type: 'shot',
    id: f.id,
    weapon: def.id,
    from: muzzle,
    to: tr.point,
    dir,
    hitWorld: !tr.fighter && tr.normal !== null,
    normal: tr.normal,
    obstructed,
  });

  if (tr.fighter && tr.part) {
    let dmg = def.damage[tr.part];
    if (shot.distance > def.falloffStart) {
      const k = clamp((shot.distance - def.falloffStart) / (def.falloffEnd - def.falloffStart), 0, 1);
      dmg *= lerp(1, def.falloffMin, k);
    }
    f.stats.hits++;
    if (tr.part === 'head') f.stats.headshots++;
    const hitDir = vnorm(vsub(tr.point, muzzle));
    applyDamage(ctx, f, tr.fighter, dmg, tr.part, tr.point, hitDir, def.id, false, shot);
  }

  // ---- gameplay recoil: sharp impulse + sustained learnable climb ----
  const mult = lerp(1, def.adsRecoilMult, adsAccuracy(f, def));
  const k = kickAt(f, ctx.time);
  f.kickPitch = k.pitch + def.kickPitch * mult;
  f.kickYaw = k.yaw + (ctx.rng() * 2 - 1) * def.kickYaw * mult;
  f.kickTime = ctx.time;
  f.kickTau = def.kickTau;
  const pat = def.recoilPattern;
  const loopLen = pat.length - def.recoilLoopFrom;
  const idx = f.shotIndex < pat.length ? f.shotIndex : def.recoilLoopFrom + ((f.shotIndex - pat.length) % Math.max(1, loopLen));
  const [rp, ry] = pat[idx];
  f.recoilPitch = Math.min(f.recoilPitch + rp * mult, def.recoilMaxPitch);
  f.recoilYaw += ry * mult;
  f.shotIndex++;
  f.lastShotTime = ctx.time;
  f.bloom = Math.min(f.bloom + def.spreadPerShot, def.spreadMax);
}

/** Find the best melee target in a cone. */
function meleeTarget(ctx: SimContext, f: Fighter, range: number, coneDeg: number): Fighter | null {
  const eye = eyePos(f);
  const fw = forwardFromAngles(f.yaw, f.pitch);
  const cosCone = Math.cos((coneDeg * Math.PI) / 180);
  let best: Fighter | null = null;
  let bestScore = Infinity;
  for (const o of ctx.fighters) {
    if (o === f || !o.alive) continue;
    buildSkeleton(o, o.weapons[o.cur].id, skel);
    const c = v3((skel.chest.x + skel.pelvis.x) / 2, (skel.chest.y + skel.pelvis.y) / 2, (skel.chest.z + skel.pelvis.z) / 2);
    const to = vsub(c, eye);
    const d = Math.hypot(to.x, to.y, to.z);
    if (d > range + 0.45) continue;
    const dn = vnorm(to);
    const cos = vdot(dn, fw);
    if (cos < cosCone && d > 0.9) continue;
    if (!ctx.world.los(eye, c)) continue;
    const score = d * (2 - cos);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

export function tryLunge(ctx: SimContext, f: Fighter): boolean {
  const md = WEAPONS.melee.melee!;
  const t = meleeTarget(ctx, f, md.lungeRange, md.lungeConeDeg);
  if (!t) return false;
  const eye = eyePos(f);
  const dist = Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z);
  if (dist < 1.6) return false;
  const fw = flatForward(f.yaw);
  const along = f.vel.x * fw.x + f.vel.z * fw.z;
  const boost = Math.max(md.lungeSpeed - Math.max(along, 0), 0);
  f.vel.x += fw.x * boost;
  f.vel.z += fw.z * boost;
  return true;
}

export function resolveMelee(ctx: SimContext, f: Fighter, heavy: boolean) {
  const md = WEAPONS.melee.melee!;
  const range = heavy ? md.heavyRange : md.lightRange;
  if (f.spawnProtect > 0) {
    f.spawnProtect = 0;
    ctx.events.push({ type: 'protectEnd', id: f.id });
  }
  const t = meleeTarget(ctx, f, range, md.coneDeg);
  if (!t) return;
  const eye = eyePos(f);
  const fw = forwardFromAngles(f.yaw, f.pitch);
  buildSkeleton(t, t.weapons[t.cur].id, skel);
  const headT = raySphere(eye, fw, skel.head, 0.25);
  const isHead = headT > 0 && headT < range + 0.6;
  // backstab: attacker is behind the victim's upper body
  const vf = flatForward(t.yaw);
  const toVictim = vnorm(v3(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z));
  const backstab = vdot(vf, toVictim) > 0.45;
  let dmg = heavy ? md.heavyDamage : md.lightDamage;
  if (isHead) dmg *= md.headMult;
  if (backstab) dmg = md.backstabDamage;
  const pos = isHead ? vclone(skel.head) : v3((skel.chest.x + skel.pelvis.x) / 2, (skel.chest.y + skel.pelvis.y) / 2, (skel.chest.z + skel.pelvis.z) / 2);
  applyDamage(ctx, f, t, dmg, isHead ? 'head' : 'chest', pos, fw, 'melee', backstab);
}
