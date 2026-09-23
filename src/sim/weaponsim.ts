import { WEAPONS, type WeaponDef } from '../config/weapons';
import type { SimContext } from './context';
import { fireHitscan, resolveMelee, tryLunge } from './combat';
import type { Fighter, WeaponSlot } from './fighter';
import { BTN, type InputCommand } from './types';
import { approach } from './vec';

// ============================================================================
//  Weapon state machine. Explicit rules (checked every tick, in this order):
//
//  DEAD       -> nothing happens; respawn resets everything and arms fireLock.
//  fireLock   -> after spawning, FIRE must be released once (no accidental shots).
//  SWITCH     -> allowed any time. Cancels ADS and an unfinished reload (a magazine
//                that already seated stays full). Bolt state belongs to the weapon
//                slot and is NOT reset by switching (no bolt-skip exploit).
//  DRAWING    -> cannot fire, aim or reload until the draw finishes.
//  RELOADING  -> cannot fire or aim. Ammo refills at reloadInsertAt (in sync with the
//                magazine seating in the animation), the rest is the handling tail.
//                Firing never cancels a reload; only switching does.
//  BOLTING    -> (bolt-action) after a shot the bolt waits `delay`, then cycles for `time`.
//                While cycling, ADS is forced out. Cannot fire until chambered.
//  READY      -> fire when cooldown allows. Semi-auto clicks are buffered briefly.
//                Empty mag: dry-fire click on press + automatic reload.
// ============================================================================

export type WeaponState = 'dead' | 'drawing' | 'reloading' | 'bolting' | 'ready';

export function weaponState(f: Fighter): WeaponState {
  if (!f.alive) return 'dead';
  if (f.switchTimer > 0) return 'drawing';
  if (f.reloadTimer > 0) return 'reloading';
  if (f.weapons[f.cur].boltLeft > 0) return 'bolting';
  return 'ready';
}

/** Bolt is actively cycling (scope forced off) as opposed to the short post-shot delay. */
export function boltCycling(f: Fighter, def: WeaponDef = WEAPONS[f.weapons[f.cur].id]): boolean {
  const s = f.weapons[f.cur];
  return !!def.bolt && s.boltLeft > 0 && s.boltLeft <= def.bolt.time;
}

function startReload(ctx: SimContext, f: Fighter, slot: WeaponSlot, def: WeaponDef) {
  if (def.kind !== 'hitscan' || f.reloadTimer > 0 || f.switchTimer > 0 || slot.mag >= def.magSize) return;
  if (slot.boltLeft > 0 && def.bolt && slot.boltLeft > def.bolt.time) return; // let the shot finish
  f.reloadTimer = def.reloadTime;
  f.reloadInserted = false;
  ctx.events.push({ type: 'reload', id: f.id, weapon: def.id });
}

export interface WeaponOptions {
  /** practice range: near-instant weapon switching */
  instantSwitch: boolean;
}

export function updateWeapon(ctx: SimContext, f: Fighter, cmd: InputCommand, dt: number, opts: WeaponOptions) {
  const held = cmd.buttons;
  const pressed = held & ~f.prevButtons;
  const n = f.weapons.length;
  f.prevAds = f.ads;
  if (!f.alive) return;

  if (f.fireLock && !(held & BTN.FIRE)) f.fireLock = false;

  // ---------------- switch ----------------
  let target = -1;
  if (cmd.slot >= 0 && cmd.slot < n && cmd.slot !== f.cur) target = cmd.slot;
  else if (cmd.scroll !== 0) target = (((f.cur + cmd.scroll) % n) + n) % n;
  if (target >= 0 && target !== f.cur && f.meleeWindup <= 0) {
    f.cur = target;
    const d = WEAPONS[f.weapons[f.cur].id];
    f.switchTimer = opts.instantSwitch ? Math.min(0.05, d.drawTime) : d.drawTime;
    f.reloadTimer = 0; // an unfinished reload is lost; a seated mag already counted
    f.reloadInserted = false;
    f.fireQueuedAt = -99;
    f.shotIndex = 0;
    f.fireCooldown = 0;
    f.ads = 0;
    f.prevAds = 0;
    ctx.events.push({ type: 'switch', id: f.id, weapon: d.id });
  }

  const slot = f.weapons[f.cur];
  const def = WEAPONS[slot.id];
  f.switchTimer = Math.max(0, f.switchTimer - dt);
  f.fireCooldown = Math.max(0, f.fireCooldown - dt);
  const drawing = f.switchTimer > 0;

  // ---------------- bolt (only advances on the weapon in hand, after the draw) ----------------
  if (slot.boltLeft > 0 && !drawing && def.bolt) {
    const before = slot.boltLeft;
    slot.boltLeft = Math.max(0, slot.boltLeft - dt);
    if (before > def.bolt.time && slot.boltLeft <= def.bolt.time) ctx.events.push({ type: 'bolt', id: f.id });
  }

  // ---------------- reload ----------------
  if (f.reloadTimer > 0) {
    f.reloadTimer -= dt;
    const progress = 1 - Math.max(0, f.reloadTimer) / def.reloadTime;
    if (!f.reloadInserted && progress >= def.reloadInsertAt) {
      f.reloadInserted = true;
      slot.mag = def.magSize;
      // a fresh magazine on an empty bolt gun is chambered as part of the reload
      slot.boltLeft = 0;
      ctx.events.push({ type: 'reloadInsert', id: f.id, weapon: def.id });
    }
    if (f.reloadTimer <= 0) {
      f.reloadTimer = 0;
      ctx.events.push({ type: 'reloadDone', id: f.id });
    }
  }
  const reloading = f.reloadTimer > 0;

  // ---------------- ADS ----------------
  const cycling = boltCycling(f, def);
  const canAds = def.kind === 'hitscan' && !drawing && !reloading && !cycling;
  const wantAds = canAds && (held & BTN.ADS) !== 0;
  f.ads = approach(f.ads, wantAds ? 1 : 0, wantAds ? dt / def.adsTime : dt / (def.adsTime * 0.75));

  // ---------------- recoil / bloom recovery ----------------
  const since = ctx.time - f.lastShotTime;
  if (since > def.recoilRecoverDelay) {
    f.recoilPitch = approach(f.recoilPitch, 0, def.recoilRecover * dt);
    f.recoilYaw = approach(f.recoilYaw, 0, def.recoilRecover * 0.8 * dt);
  }
  if (since > def.fireInterval + 0.12) f.shotIndex = 0;
  f.bloom = approach(f.bloom, 0, def.spreadRecover * dt * (since > def.fireInterval * 1.5 ? 1 : 0.25));

  // ---------------- melee ----------------
  if (def.kind === 'melee') {
    if (f.meleeWindup > 0) {
      f.meleeWindup -= dt;
      if (f.meleeWindup <= 0) {
        f.meleeWindup = 0;
        resolveMelee(ctx, f, true);
      }
    }
    if (f.fireCooldown > 1e-6 || drawing || f.meleeWindup > 0 || f.fireLock) return;
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

  // ---------------- reload input ----------------
  if (pressed & BTN.RELOAD && !drawing) startReload(ctx, f, slot, def);

  // ---------------- fire ----------------
  if (pressed & BTN.FIRE && !f.fireLock) f.fireQueuedAt = ctx.time;
  const want = !f.fireLock && (def.auto ? (held & BTN.FIRE) !== 0 : ctx.time - f.fireQueuedAt < 0.15);
  const ready = !drawing && f.reloadTimer <= 0 && slot.boltLeft <= 0 && f.fireCooldown <= 1e-6;
  if (want && ready) {
    if (slot.mag <= 0) {
      if (pressed & BTN.FIRE) ctx.events.push({ type: 'dryfire', id: f.id });
      f.fireQueuedAt = -99;
      startReload(ctx, f, slot, def);
    } else {
      fireHitscan(ctx, f, def);
      slot.mag--;
      f.fireCooldown = def.fireInterval;
      f.fireQueuedAt = -99;
      if (def.bolt) slot.boltLeft = def.bolt.delay + def.bolt.time;
    }
  }
  // automatic reload once empty and idle
  if (slot.mag <= 0 && f.fireCooldown <= 1e-6 && !reloading && !drawing && !(def.bolt && slot.boltLeft > def.bolt.time)) {
    startReload(ctx, f, slot, def);
  }
}
