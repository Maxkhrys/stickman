import { WEAPONS } from '../config/weapons';
import type { SimContext } from './context';
import { fireHitscan, resolveMelee, tryLunge } from './combat';
import type { Fighter } from './fighter';
import { BTN, type InputCommand } from './types';
import { approach } from './vec';

function startReload(ctx: SimContext, f: Fighter) {
  const slot = f.weapons[f.cur];
  const def = WEAPONS[slot.id];
  if (def.kind !== 'hitscan' || f.reloadTimer > 0 || f.switchTimer > 0 || slot.mag >= def.magSize) return;
  f.reloadTimer = def.reloadTime;
  ctx.events.push({ type: 'reload', id: f.id, weapon: def.id });
}

/** Weapon state machine: switch / reload / ADS / fire / melee. Driven purely by InputCommands. */
export function updateWeapon(ctx: SimContext, f: Fighter, cmd: InputCommand, dt: number) {
  const held = cmd.buttons;
  const pressed = held & ~f.prevButtons;
  const n = f.weapons.length;

  // ---- switchWeapon ----
  let target = -1;
  if (cmd.slot >= 0 && cmd.slot < n && cmd.slot !== f.cur) target = cmd.slot;
  else if (cmd.scroll !== 0) target = (((f.cur + cmd.scroll) % n) + n) % n;
  if (target >= 0 && target !== f.cur) {
    f.cur = target;
    const d = WEAPONS[f.weapons[f.cur].id];
    f.switchTimer = d.drawTime;
    f.reloadTimer = 0;
    f.meleeWindup = 0;
    f.fireQueuedAt = -99;
    f.shotIndex = 0;
    f.fireCooldown = 0;
    ctx.events.push({ type: 'switch', id: f.id, weapon: d.id });
  }

  const slot = f.weapons[f.cur];
  const def = WEAPONS[slot.id];
  f.switchTimer = Math.max(0, f.switchTimer - dt);
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);

  if (f.reloadTimer > 0) {
    f.reloadTimer -= dt;
    if (f.reloadTimer <= 0) {
      f.reloadTimer = 0;
      slot.mag = def.magSize;
      ctx.events.push({ type: 'reloadDone', id: f.id });
    }
  }

  const wantAds = def.kind === 'hitscan' && (held & BTN.ADS) !== 0 && f.reloadTimer <= 0;
  f.ads = approach(f.ads, wantAds ? 1 : 0, dt / def.adsTime);

  // recoil / bloom recovery
  const since = ctx.time - f.lastShotTime;
  if (since > def.recoilRecoverDelay) {
    f.recoilPitch = approach(f.recoilPitch, 0, def.recoilRecover * dt);
    f.recoilYaw = approach(f.recoilYaw, 0, def.recoilRecover * 0.8 * dt);
  }
  if (since > def.fireInterval + 0.1) f.shotIndex = 0;
  f.bloom = approach(f.bloom, 0, def.spreadRecover * dt * (since > def.fireInterval * 1.5 ? 1 : 0.25));

  if (!f.alive) return;

  if (def.kind === 'melee') {
    if (f.meleeWindup > 0) {
      f.meleeWindup -= dt;
      if (f.meleeWindup <= 0) {
        f.meleeWindup = 0;
        resolveMelee(ctx, f, true);
      }
    }
    if (f.fireCooldown > 1e-6 || f.switchTimer > 0 || f.meleeWindup > 0) return;
    const md = def.melee!;
    if (held & BTN.FIRE) {
      const lunge = tryLunge(ctx, f);
      f.fireCooldown = md.lightInterval;
      f.lastMeleeTime = ctx.time;
      f.lastMeleeHeavy = false;
      ctx.events.push({ type: 'melee', id: f.id, heavy: false, lunge, windup: false });
      resolveMelee(ctx, f, false);
    } else if (pressed & BTN.ADS) {
      const lunge = tryLunge(ctx, f);
      f.fireCooldown = md.heavyInterval;
      f.meleeWindup = md.heavyWindup;
      f.lastMeleeTime = ctx.time;
      f.lastMeleeHeavy = true;
      ctx.events.push({ type: 'melee', id: f.id, heavy: true, lunge, windup: true });
    }
    return;
  }

  if (pressed & BTN.RELOAD) startReload(ctx, f);

  // semi-auto click buffering so fast taps are never eaten
  if (pressed & BTN.FIRE) f.fireQueuedAt = ctx.time;
  const want = def.auto ? (held & BTN.FIRE) !== 0 : ctx.time - f.fireQueuedAt < 0.18;
  if (want && f.fireCooldown <= 1e-6 && f.switchTimer <= 0 && f.reloadTimer <= 0) {
    if (slot.mag <= 0) {
      if (pressed & BTN.FIRE) ctx.events.push({ type: 'dryfire', id: f.id });
      startReload(ctx, f);
      f.fireQueuedAt = -99;
    } else {
      fireHitscan(ctx, f, def);
      slot.mag--;
      f.fireCooldown = def.fireInterval;
      f.fireQueuedAt = -99;
    }
  }
  // auto reload when empty
  if (slot.mag <= 0 && f.fireCooldown <= 1e-6 && f.reloadTimer <= 0 && f.switchTimer <= 0) startReload(ctx, f);
}
