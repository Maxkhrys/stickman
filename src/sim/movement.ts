import { MOVE } from '../config/movement';
import { WEAPONS } from '../config/weapons';
import type { Fighter } from './fighter';
import { BTN, type GameEvent, type InputCommand } from './types';
import { angleDiff, clamp, lerp, yawTo } from './vec';
import { strideLength } from './body';
import type { World } from './world';
import type { Box } from './map';

const scratch: Box[] = [];

function accelerate(f: Fighter, wx: number, wz: number, wishSpeed: number, accel: number, dt: number) {
  const cur = f.vel.x * wx + f.vel.z * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const acc = Math.min(accel * dt * wishSpeed, add);
  f.vel.x += acc * wx;
  f.vel.z += acc * wz;
}

/** Quake/Source air acceleration: the wish speed is capped (tiny) but accel is not -> air strafing. */
function airAccelerate(f: Fighter, wx: number, wz: number, wishSpeed: number, dt: number) {
  const capped = Math.min(wishSpeed, MOVE.airWishCap);
  const cur = f.vel.x * wx + f.vel.z * wz;
  const add = capped - cur;
  if (add <= 0) return;
  const acc = Math.min(MOVE.airAccel * wishSpeed * dt, add);
  f.vel.x += acc * wx;
  f.vel.z += acc * wz;
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs > MOVE.maxAirSpeed) {
    f.vel.x *= MOVE.maxAirSpeed / hs;
    f.vel.z *= MOVE.maxAirSpeed / hs;
  }
}

function friction(f: Fighter, amount: number, dt: number) {
  const speed = Math.hypot(f.vel.x, f.vel.z);
  if (speed < 0.01) {
    f.vel.x = 0;
    f.vel.z = 0;
    return;
  }
  const control = Math.max(speed, MOVE.stopSpeed);
  const drop = control * amount * dt;
  const ns = Math.max(speed - drop, 0) / speed;
  f.vel.x *= ns;
  f.vel.z *= ns;
}

function tryStartSlide(f: Fighter, events: GameEvent[]) {
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs < MOVE.slideMinSpeed || f.slideCooldown > 0) return;
  const ns = Math.min(hs + MOVE.slideBoost, Math.max(MOVE.slideMaxSpeed, hs));
  f.vel.x *= ns / hs;
  f.vel.z *= ns / hs;
  f.sliding = true;
  f.slideTimer = MOVE.slideTime;
  f.slideCooldown = MOVE.slideTime + MOVE.slideCooldown;
  events.push({ type: 'slide', id: f.id });
}

function overlapsBox(f: Fighter, b: Box, r: number): boolean {
  return (
    f.pos.x + r > b.min.x &&
    f.pos.x - r < b.max.x &&
    f.pos.z + r > b.min.z &&
    f.pos.z - r < b.max.z &&
    f.pos.y + f.height > b.min.y + 1e-3 &&
    f.pos.y < b.max.y - 1e-3
  );
}

function moveAxis(f: Fighter, world: World, axis: 'x' | 'z', delta: number, grounded: boolean) {
  if (delta === 0) return;
  const r = MOVE.radius;
  const old = f.pos[axis];
  f.pos[axis] += delta;

  // ramps: walk up the slope, but their tall sides are walls
  const rh = world.rampHeightAt(f.pos.x, f.pos.z);
  if (rh > f.pos.y + MOVE.stepHeight) {
    f.pos[axis] = old;
    f.vel[axis] = 0;
    return;
  }
  if (rh > f.pos.y && (grounded || rh - f.pos.y < 0.3)) f.pos.y = rh;

  const maxStep = grounded ? MOVE.stepHeight : 0.3; // ledge forgiveness while airborne
  for (const b of world.boxes) {
    if (!overlapsBox(f, b, r)) continue;
    const stepH = b.max.y - f.pos.y;
    if (stepH > 0 && stepH <= maxStep && f.vel.y <= 1 && world.isClear(f.pos.x, b.max.y + 0.001, f.pos.z, r, f.height)) {
      f.pos.y = b.max.y;
      if (!grounded) f.vel.y = Math.max(f.vel.y, 0);
      continue;
    }
    f.pos[axis] = delta > 0 ? b.min[axis] - r - 1e-4 : b.max[axis] + r + 1e-4;
    f.vel[axis] = 0;
  }
}

function moveVertical(f: Fighter, world: World, dt: number, events: GameEvent[], time: number) {
  const r = MOVE.radius;
  const wasGround = f.onGround;
  let ny = f.pos.y + f.vel.y * dt;

  if (f.vel.y > 0) {
    world.overlapping(f.pos.x, f.pos.y, f.pos.z, r - 0.01, f.height + f.vel.y * dt + 0.01, scratch);
    for (const b of scratch) {
      if (b.min.y >= f.pos.y + f.height - 0.05 && ny + f.height > b.min.y) {
        ny = b.min.y - f.height;
        f.vel.y = 0;
      }
    }
  }

  const floor = world.surfaceBelow(f.pos.x, f.pos.z, r - 0.02, f.pos.y + 0.05);
  if (ny <= floor) {
    if (!wasGround) {
      events.push({ type: 'land', id: f.id, speed: -f.vel.y });
      f.airTime = 0;
      f.lastLandTime = time;
      f.lastLandSpeed = -f.vel.y;
    }
    ny = floor;
    if (f.vel.y < 0) f.vel.y = 0;
    f.onGround = true;
  } else if (wasGround && f.vel.y <= 0 && f.pos.y - floor <= MOVE.snapDown) {
    ny = floor; // stick to slopes / small steps going down
    f.vel.y = 0;
    f.onGround = true;
  } else {
    f.onGround = false;
  }
  f.pos.y = ny;
}

/**
 * One fixed tick of character movement. Shared by players, bots and dummies (and later by
 * client-side prediction + the server) - must stay deterministic given the same inputs.
 */
export function simulateMovement(f: Fighter, cmd: InputCommand, dt: number, world: World, events: GameEvent[], time = 0) {
  const held = cmd.buttons;
  const pressed = held & ~f.prevButtons;
  f.yaw = cmd.yaw;
  f.pitch = clamp(cmd.pitch, -1.55, 1.55);

  f.jumpBuffer = pressed & BTN.JUMP ? MOVE.jumpBuffer : Math.max(0, f.jumpBuffer - dt);
  f.slideCooldown = Math.max(0, f.slideCooldown - dt);
  f.coyote = f.onGround ? MOVE.coyoteTime : Math.max(0, f.coyote - dt);
  if (!f.onGround) f.airTime += dt;

  // ---- crouch / slide ----
  const diff = MOVE.standHeight - MOVE.crouchHeight;
  if (held & BTN.CROUCH) {
    if (!f.crouching) {
      f.crouching = true;
      f.height = MOVE.crouchHeight;
      if (f.onGround) tryStartSlide(f, events);
      else f.pos.y += diff; // tuck legs in the air (crouch-jump)
    }
  } else if (f.crouching) {
    if (f.onGround) {
      if (world.isClear(f.pos.x, f.pos.y, f.pos.z, MOVE.radius, MOVE.standHeight)) {
        f.crouching = false;
        f.sliding = false;
        f.height = MOVE.standHeight;
      }
    } else {
      const below = world.surfaceBelow(f.pos.x, f.pos.z, MOVE.radius, f.pos.y + 0.01);
      const ny = Math.max(below, f.pos.y - diff);
      if (world.isClear(f.pos.x, ny, f.pos.z, MOVE.radius, MOVE.standHeight)) {
        f.pos.y = ny;
        f.crouching = false;
        f.height = MOVE.standHeight;
      }
    }
  }

  // ---- jump (buffer + coyote + auto-hop) ----
  let jumped = false;
  const wantJump = f.jumpBuffer > 0 || (MOVE.autoHop && held & BTN.JUMP);
  if (wantJump && (f.onGround || f.coyote > 0) && f.vel.y <= 0.01) {
    f.vel.y = MOVE.jumpVel;
    f.onGround = false;
    f.coyote = 0;
    f.jumpBuffer = 0;
    f.sliding = false; // slide-hop keeps momentum
    jumped = true;
    events.push({ type: 'jump', id: f.id });
  }

  // ---- wish direction ----
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  let wx = -sy * cmd.forward + cy * cmd.strafe;
  let wz = -cy * cmd.forward - sy * cmd.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) {
    wx /= wl;
    wz /= wl;
  }
  const wpn = WEAPONS[f.weapons[f.cur].id];
  let maxSp = f.crouching ? MOVE.crouchSpeed : MOVE.maxSpeed;
  maxSp *= wpn.moveSpeedMult * lerp(1, wpn.adsMoveMult, f.ads);
  const wishSpeed = wl > 1e-4 ? maxSp * Math.min(wl, 1) : 0;

  if (f.onGround && !jumped) {
    if (f.sliding) {
      friction(f, MOVE.slideFriction, dt);
      accelerate(f, wx, wz, MOVE.crouchSpeed, MOVE.slideSteer, dt);
      f.slideTimer -= dt;
      if (f.slideTimer <= 0 || Math.hypot(f.vel.x, f.vel.z) < MOVE.crouchSpeed + 0.4) f.sliding = false;
    } else {
      friction(f, MOVE.friction, dt);
      accelerate(f, wx, wz, wishSpeed, MOVE.accel, dt);
    }
  } else {
    airAccelerate(f, wx, wz, wishSpeed, dt);
  }
  if (!f.onGround) f.vel.y -= MOVE.gravity * dt;

  // ---- collide ----
  const grounded = f.onGround;
  moveAxis(f, world, 'x', f.vel.x * dt, grounded);
  moveAxis(f, world, 'z', f.vel.z * dt, grounded);
  const wasAir = !f.onGround;
  moveVertical(f, world, dt, events, time);
  if (wasAir && f.onGround && f.crouching && !f.sliding) tryStartSlide(f, events); // land into a slide

  // world bounds safety
  const bd = world.bounds;
  f.pos.x = clamp(f.pos.x, bd.minX + MOVE.radius, bd.maxX - MOVE.radius);
  f.pos.z = clamp(f.pos.z, bd.minZ + MOVE.radius, bd.maxZ - MOVE.radius);

  updateBodyFacing(f, dt);

  // footsteps
  if (f.onGround && !f.sliding) {
    const hs = Math.hypot(f.vel.x, f.vel.z);
    f.stepAccum += hs * dt;
    if (f.stepAccum > (f.crouching ? 1.6 : 2.3)) {
      f.stepAccum = 0;
      if (!f.crouching && hs > 3) events.push({ type: 'step', id: f.id });
    }
  }
}

const DEG = Math.PI / 180;

/**
 * Lower body turns toward the travel direction (within limits of the aim), gait phase advances by
 * distance travelled so feet stay planted. Deterministic -> hitboxes and animation agree everywhere.
 */
function updateBodyFacing(f: Fighter, dt: number) {
  const hs = Math.hypot(f.vel.x, f.vel.z);
  let target = f.yaw;
  if (hs > 1 && f.onGround && !f.sliding) {
    const moveYaw = yawTo(f.vel.x, f.vel.z);
    let rel = angleDiff(moveYaw, f.yaw);
    // running backwards: hips face the aim, legs run in reverse
    if (Math.abs(rel) > 110 * DEG) rel = angleDiff(moveYaw + Math.PI, f.yaw);
    target = f.yaw + clamp(rel, -70 * DEG, 70 * DEG);
  }
  const d = angleDiff(target, f.lowerYaw);
  const maxTurn = 12 * dt;
  f.lowerYaw += clamp(d, -maxTurn, maxTurn);
  // never let the hips drift further than 80 degrees from the aim
  const off = angleDiff(f.lowerYaw, f.yaw);
  if (Math.abs(off) > 80 * DEG) f.lowerYaw = f.yaw + Math.sign(off) * 80 * DEG;
  if (f.onGround && !f.sliding && hs > 0.05) {
    f.gait = (f.gait + ((hs * dt) / strideLength(hs)) * Math.PI * 2) % (Math.PI * 2);
  }
}
