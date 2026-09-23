import { WEAPONS, type WeaponDef } from '../config/weapons';
import type { SimContext } from './context';
import { chestPos, eyePos, type Fighter } from './fighter';
import { buildHitboxes, rayCapsule, type Hitbox } from './hitboxes';
import type { HitPart, WeaponId } from './types';
import {
  clamp,
  flatForward,
  forwardFromAngles,
  lerp,
  v3,
  vaddScaled,
  vclone,
  vdot,
  vnorm,
  vsub,
  type Vec3,
} from './vec';

const hbScratch: Hitbox[] = [];

export interface TraceResult {
  t: number;
  point: Vec3;
  normal: Vec3 | null;
  fighter: Fighter | null;
  part: HitPart | null;
}

/** Hitscan trace against world + every living fighter except the shooter. */
export function traceShot(ctx: SimContext, shooter: Fighter, o: Vec3, d: Vec3, range: number): TraceResult {
  const wh = ctx.world.raycast(o, d, range);
  let bestT = wh ? wh.t : range;
  let normal = wh ? wh.normal : null;
  let hitF: Fighter | null = null;
  let part: HitPart | null = null;
  for (const f of ctx.fighters) {
    if (f === shooter || !f.alive) continue;
    // broadphase: distance from ray to the fighter's centre
    const cx = f.pos.x - o.x, cy = f.pos.y + 0.9 - o.y, cz = f.pos.z - o.z;
    const along = cx * d.x + cy * d.y + cz * d.z;
    if (along < -1 || along > bestT + 1.5) continue;
    const px = cx - d.x * along, py = cy - d.y * along, pz = cz - d.z * along;
    if (px * px + py * py + pz * pz > 2.5 * 2.5) continue;
    buildHitboxes(f, hbScratch);
    for (const hb of hbScratch) {
      const t = rayCapsule(o, d, hb.a, hb.b, hb.r);
      if (t < 0 || t >= bestT) continue;
      // prefer head if two parts are within a hair of each other
      bestT = t;
      hitF = f;
      part = hb.part;
      normal = null;
    }
  }
  return { t: bestT, point: vaddScaled(o, d, bestT), normal, fighter: hitF, part };
}

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
) {
  if (!victim.alive) return;
  dmg = Math.round(dmg);
  const dealt = Math.min(dmg, victim.hp);
  victim.hp -= dealt;
  victim.lastDamageTime = ctx.time;
  victim.lastAttacker = attacker.id;
  attacker.stats.damage += Math.round(dealt);
  const killed = victim.hp <= 0;
  ctx.events.push({
    type: 'hit',
    attacker: attacker.id,
    victim: victim.id,
    damage: dmg,
    part,
    pos: vclone(pos),
    dir: vclone(dir),
    killed,
    backstab,
    weapon,
  });
  ctx.onDamaged(victim, attacker);
  if (killed) {
    victim.hp = 0;
    victim.alive = false;
    victim.deathTime = ctx.time;
    victim.stats.deaths++;
    victim.stats.streak = 0;
    victim.respawnTimer = victim.kind === 'dummy' ? 1.5 : 3;
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
      dir: vclone(dir),
    });
    ctx.onKilled(victim, attacker);
  }
}

export function computeSpread(f: Fighter): number {
  const def = WEAPONS[f.weapons[f.cur].id];
  if (def.kind === 'melee') return 0;
  const hs = Math.hypot(f.vel.x, f.vel.z);
  let s = def.spreadBase + def.spreadMove * clamp(hs / 8.2, 0, 1.4) + (f.onGround ? 0 : def.spreadAir) + f.bloom;
  if (f.crouching && f.onGround && !f.sliding) s *= 0.8;
  return s * lerp(1, def.adsSpreadMult, f.ads);
}

/** Direction for yaw/pitch offset by small angles (dx right, dy up). */
function offsetDir(yaw: number, pitch: number, dx: number, dy: number): Vec3 {
  const fw = forwardFromAngles(yaw, pitch);
  const rt = v3(Math.cos(yaw), 0, -Math.sin(yaw));
  const up = forwardFromAngles(yaw, pitch + Math.PI / 2);
  return vnorm(v3(
    fw.x + rt.x * Math.tan(dx) + up.x * Math.tan(dy),
    fw.y + rt.y * Math.tan(dx) + up.y * Math.tan(dy),
    fw.z + rt.z * Math.tan(dx) + up.z * Math.tan(dy),
  ));
}

export function fireHitscan(ctx: SimContext, f: Fighter, def: WeaponDef) {
  const eye = eyePos(f);
  const spread = computeSpread(f);
  const a = ctx.rng() * Math.PI * 2;
  const r = Math.sqrt(ctx.rng()) * spread;
  const dir = offsetDir(f.yaw + f.recoilYaw, f.pitch + f.recoilPitch, Math.cos(a) * r, Math.sin(a) * r);
  const tr = traceShot(ctx, f, eye, dir, def.range);
  f.stats.shots++;

  ctx.events.push({
    type: 'shot',
    id: f.id,
    weapon: def.id,
    from: eye,
    to: tr.point,
    hitWorld: !tr.fighter && tr.normal !== null,
    normal: tr.normal,
  });

  if (tr.fighter && tr.part) {
    let dmg = tr.part === 'head' ? def.headDamage : tr.part === 'body' ? def.damage : def.damage * def.limbMult;
    if (tr.t > def.falloffStart) {
      const k = clamp((tr.t - def.falloffStart) / (def.falloffEnd - def.falloffStart), 0, 1);
      dmg *= lerp(1, def.falloffMin, k);
    }
    f.stats.hits++;
    if (tr.part === 'head') f.stats.headshots++;
    applyDamage(ctx, f, tr.fighter, dmg, tr.part, tr.point, dir, def.id);
  }

  // learnable recoil pattern
  const pat = def.recoilPattern;
  const loopLen = pat.length - def.recoilLoopFrom;
  const idx = f.shotIndex < pat.length ? f.shotIndex : def.recoilLoopFrom + ((f.shotIndex - pat.length) % Math.max(1, loopLen));
  const [rp, ry] = pat[idx];
  const mult = lerp(1, def.adsRecoilMult, f.ads);
  f.recoilPitch = Math.min(f.recoilPitch + rp * mult, def.recoilMaxPitch);
  f.recoilYaw += (ry + (ctx.rng() * 2 - 1) * def.recoilRandomYaw) * mult;
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
    const c = chestPos(o);
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
  const t = meleeTarget(ctx, f, range, md.coneDeg);
  if (!t) return;
  const eye = eyePos(f);
  const fw = forwardFromAngles(f.yaw, f.pitch);
  // headshot if the crosshair ray passes through the head
  buildHitboxes(t, hbScratch);
  const head = hbScratch[0];
  const head_t = rayCapsule(eye, fw, head.a, head.b, head.r + 0.05);
  const isHead = head_t > 0 && head_t < range + 0.6;
  // backstab: attacker is behind the victim
  const vf = flatForward(t.yaw);
  const toVictim = vnorm(v3(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z));
  const backstab = vdot(vf, toVictim) > 0.45;
  let dmg = heavy ? md.heavyDamage : md.lightDamage;
  if (isHead) dmg *= md.headMult;
  if (backstab) dmg = md.backstabDamage;
  const pos = isHead ? head.a : chestPos(t);
  applyDamage(ctx, f, t, dmg, isHead ? 'head' : 'body', pos, fw, 'melee', backstab);
}
