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
  const before = Math.hypot(f.vel.x, f.vel.z);
  f.vel.x += acc * wx;
  f.vel.z += acc * wz;
  // turning while running never adds speed beyond max(current, wish) (no strafe-running gain)
  capHorizontal(f, Math.max(before, wishSpeed));
}

/**
 * Controlled air steering: push the velocity toward the held direction at a fixed rate, but never
 * above max(speed before steering, wish speed). Turning works, reversing takes time, and air
 * strafing cannot gain speed.
 */
function airSteer(f: Fighter, wx: number, wz: number, wishSpeed: number, dt: number) {
  if (wishSpeed <= 0) return;
  const before = Math.hypot(f.vel.x, f.vel.z);
  const cap = Math.max(before, wishSpeed);
  f.vel.x += wx * MOVE.airAccel * dt;
  f.vel.z += wz * MOVE.airAccel * dt;
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs > cap) {
    f.vel.x *= cap / hs;
    f.vel.z *= cap / hs;
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

function capHorizontal(f: Fighter, cap: number) {
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs > cap) {
    f.vel.x *= cap / hs;
    f.vel.z *= cap / hs;
  }
}

function tryStartSlide(f: Fighter, events: GameEvent[], time: number) {
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs < MOVE.slideMinSpeed) return;
  // the boost is rate limited so slide -> jump -> slide chains cannot pump speed
  const boost = time - f.lastSlideBoostTime >= MOVE.slideBoostCooldown ? MOVE.slideBoost : 0;
  if (boost > 0) f.lastSlideBoostTime = time;
  const ns = Math.min(hs + boost, Math.max(MOVE.slideMaxSpeed, hs));
  f.vel.x *= ns / hs;
  f.vel.z *= ns / hs;
  f.sliding = true;
  f.slideTimer = MOVE.slideMaxTime;
  f.slideTime = time;
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

const boxList: Box[] = [];

function moveAxis(f: Fighter, world: World, axis: 'x' | 'z', delta: number, grounded: boolean) {
  if (delta === 0) return;
  const r = MOVE.radius;
  const old = f.pos[axis];
  f.pos[axis] += delta;

  // ramps: walk up the slope, but their tall sides are walls
  // the whole footprint, not just the centre, so the body can't sink into a ramp's tall side
  const maxStep = grounded ? MOVE.stepHeight : 0.3; // ledge forgiveness while airborne
  const rh = world.rampHeightAt(f.pos.x, f.pos.z);
  const rmax = world.rampHeightMax(f.pos.x, f.pos.z, r - 0.02);
  if (rmax > f.pos.y + maxStep) {
    f.pos[axis] = old;
    f.vel[axis] = 0;
    return;
  }
  if (rh > f.pos.y && (grounded || rh - f.pos.y < 0.3)) f.pos.y = rh;
  else if (!grounded && rmax > f.pos.y) {
    // airborne footprint clipping a ramp's side edge: land on the edge instead of sinking into it
    f.pos.y = rmax;
    f.vel.y = Math.max(f.vel.y, 0);
  }

  const near = world.candidates(f.pos.x - r, f.pos.z - r, f.pos.x + r, f.pos.z + r);
  boxList.length = 0;
  for (const b of near) boxList.push(b);
  for (const b of boxList) {
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

/** Held direction in world space (unit) for this command, or null when no movement key is held. */
function wishDir(yaw: number, forward: number, strafe: number): [number, number, number] {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  let wx = -sy * forward + cy * strafe;
  let wz = -cy * forward - sy * strafe;
  const wl = Math.hypot(wx, wz);
  if (wl < 1e-4) return [0, 0, 0];
  wx /= wl;
  wz /= wl;
  return [wx, wz, Math.min(wl, 1)];
}

/** Ground speed cap for the held direction: full forward, a little less sideways and backwards. */
function directionalSpeed(forward: number, strafe: number): number {
  const l = Math.hypot(forward, strafe) || 1;
  const f = forward / l, s = strafe / l;
  const back = f < 0 ? -f : 0;
  const side = Math.abs(s);
  return MOVE.maxSpeed * (1 - (1 - MOVE.strafeMult) * side * (1 - back) - (1 - MOVE.backMult) * back);
}

/**
 * One fixed tick of character movement. Shared by players, bots and dummies (and later by
 * client-side prediction + the server) - must stay deterministic given the same inputs.
 *
 * Order: timers -> crouch/slide -> jumps (ground, coyote, air) -> dash -> steering -> gravity
 * -> sub-stepped collision -> landing (refills air actions) -> body facing.
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
  // dash charges refill one at a time
  if (f.dashCharges < MOVE.dashCharges) f.dashCharges = Math.min(MOVE.dashCharges, f.dashCharges + dt / MOVE.dashRecharge);

  const [wx, wz, wl] = wishDir(f.yaw, cmd.forward, cmd.strafe);
  const wpn = WEAPONS[f.weapons[f.cur].id];
  const adsMult = wpn.moveSpeedMult * lerp(1, wpn.adsMoveMult, f.ads);

  // ---- crouch / slide ----
  const diff = MOVE.standHeight - MOVE.crouchHeight;
  if (held & BTN.CROUCH) {
    if (!f.crouching) {
      f.crouching = true;
      f.height = MOVE.crouchHeight;
      if (f.onGround) {
        // dash flows into the slide from the dash's exit speed, not its burst speed
        if (f.dashTimer > 0 && Math.hypot(f.vel.x, f.vel.z) >= MOVE.slideMinSpeed) endDash(f);
        tryStartSlide(f, events, time);
      } else f.pos.y += diff; // tuck legs in the air (crouch-jump)
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

  // ---- jumps: a fresh press (or one buffered just before landing) on the ground or in coyote time;
  //      a fresh press in the air spends an air jump. Holding the key never fires the second jump. ----
  let jumped = false;
  if (f.jumpBuffer > 0 && (f.onGround || f.coyote > 0) && f.vel.y <= 0.01) {
    f.vel.y = MOVE.jumpVel;
    f.onGround = false;
    f.coyote = 0;
    f.jumpBuffer = 0;
    f.sliding = false; // slide-hop keeps momentum
    f.lastJumpTime = time;
    if (f.dashTimer > 0) endDash(f); // dash-jump keeps the dash's speed (capped below)
    jumped = true;
    events.push({ type: 'jump', id: f.id });
  } else if (pressed & BTN.JUMP && !f.onGround && f.coyote <= 0 && f.airJumpsLeft > 0 && !landingWithin(f, world, MOVE.jumpBuffer)) {
    f.airJumpsLeft--;
    f.jumpBuffer = 0;
    f.vel.y = MOVE.airJumpVel;
    if (f.dashTimer > 0) endDash(f);
    if (wl > 0) {
      // redirect part of the momentum toward the held direction without inventing speed
      const hs = Math.hypot(f.vel.x, f.vel.z);
      const keep = Math.max(hs, MOVE.maxSpeed * adsMult * 0.85);
      const r = MOVE.airJumpRedirect;
      f.vel.x = f.vel.x * (1 - r) + wx * keep * r;
      f.vel.z = f.vel.z * (1 - r) + wz * keep * r;
      capHorizontal(f, keep);
    }
    f.lastAirJumpTime = time;
    jumped = true;
    events.push({ type: 'airJump', id: f.id });
  }

  // ---- dash: directional burst, one per press, limited charges, one per airtime ----
  if (pressed & BTN.DASH && f.dashCharges >= 1 && time - f.lastDashTime >= MOVE.dashGap && f.dashTimer <= 0 && !f.sliding && (f.onGround || f.airDashesLeft > 0)) {
    let dx = wx, dz = wz;
    if (wl === 0) {
      dx = -Math.sin(f.yaw);
      dz = -Math.cos(f.yaw);
    }
    f.dashCharges -= 1;
    f.dashTimer = MOVE.dashTime;
    f.dashDirX = dx;
    f.dashDirZ = dz;
    f.dashAir = !f.onGround;
    f.rollTimer = f.dashAir ? 0 : MOVE.rollTime;
    f.lastDashTime = time;
    if (f.dashAir) {
      f.airDashesLeft--;
      f.vel.y = Math.max(f.vel.y, MOVE.airDashLift);
    }
    events.push({ type: 'dash', id: f.id, air: f.dashAir, dx, dz });
  }

  // the dodge roll ends when it runs out, or when you leave the ground / start sliding
  f.rollTimer = f.onGround && !f.sliding ? Math.max(0, f.rollTimer - dt) : 0;

  // ---- steering ----
  let maxSp = f.crouching ? MOVE.crouchSpeed : wl > 0 ? directionalSpeed(cmd.forward, cmd.strafe) : MOVE.maxSpeed;
  maxSp *= adsMult;
  const wishSpeed = wl > 0 ? maxSp * wl : 0;

  if (f.dashTimer > 0) {
    // the dash owns horizontal velocity; gravity is held off for an air dash
    f.vel.x = f.dashDirX * MOVE.dashSpeed;
    f.vel.z = f.dashDirZ * MOVE.dashSpeed;
    if (f.dashAir) f.vel.y = Math.max(f.vel.y - MOVE.gravity * 0.25 * dt, 0);
    f.dashTimer -= dt;
    if (f.dashTimer <= 0) endDash(f);
  } else if (f.onGround && !jumped) {
    if (f.sliding) {
      friction(f, MOVE.slideFriction, dt);
      accelerate(f, wx, wz, MOVE.crouchSpeed, MOVE.slideSteer, dt);
      f.slideTimer -= dt;
      if (f.slideTimer <= 0 || Math.hypot(f.vel.x, f.vel.z) < MOVE.slideMinExit) f.sliding = false;
    } else {
      const hs = Math.hypot(f.vel.x, f.vel.z);
      const along = hs > 0.01 ? (f.vel.x * wx + f.vel.z * wz) / hs : 0;
      if (wl > 0 && hs > wishSpeed + 0.05 && along > 0.5) {
        // over the cap but still steering the same way: bleed speed gradually (dash exit, ADS)
        const ns = Math.max(wishSpeed, hs - MOVE.overspeedDecel * dt);
        f.vel.x *= ns / hs;
        f.vel.z *= ns / hs;
        accelerate(f, wx, wz, wishSpeed, MOVE.accel, dt);
      } else {
        friction(f, MOVE.friction, dt);
        accelerate(f, wx, wz, wishSpeed, MOVE.accel, dt);
      }
    }
  } else {
    airSteer(f, wx, wz, wishSpeed, dt);
  }
  if (!f.onGround && !(f.dashTimer > 0 && f.dashAir)) f.vel.y -= MOVE.gravity * dt;
  if (f.dashTimer <= 0) capHorizontal(f, f.sliding ? Math.max(MOVE.slideMaxSpeed, MOVE.maxHorizSpeed) : MOVE.maxHorizSpeed);

  // ---- collide (sub-stepped: a dash moves ~0.14 m per tick, thinner than most walls) ----
  const grounded = f.onGround;
  const mx = f.vel.x * dt, mz = f.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(mz)) / MOVE.maxStep));
  for (let i = 0; i < steps; i++) {
    moveAxis(f, world, 'x', (f.vel.x * dt) / steps, grounded);
    moveAxis(f, world, 'z', (f.vel.z * dt) / steps, grounded);
  }
  const wasAir = !f.onGround;
  moveVertical(f, world, dt, events, time);
  if (wasAir && f.onGround) {
    // confirmed landing: air actions come back
    f.airJumpsLeft = MOVE.airJumps;
    f.airDashesLeft = MOVE.airDashes;
    if (f.crouching && !f.sliding) tryStartSlide(f, events, time); // land into a slide
  }

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

/** Falling onto a floor within `secs`? A jump pressed then is buffered for the landing instead of
 *  spending the air jump on a hop a few centimetres off the ground. */
function landingWithin(f: Fighter, world: World, secs: number): boolean {
  if (f.vel.y >= 0) return false;
  const floor = world.surfaceBelow(f.pos.x, f.pos.z, MOVE.radius - 0.02, f.pos.y + 0.05);
  const gap = f.pos.y - floor;
  return gap <= -f.vel.y * secs + 0.5 * MOVE.gravity * secs * secs;
}

/** Dash over: hand back a readable exit speed along the dash; overspeed then bleeds off smoothly. */
function endDash(f: Fighter) {
  f.dashTimer = 0;
  const hs = Math.hypot(f.vel.x, f.vel.z);
  if (hs > MOVE.dashExitSpeed) {
    f.vel.x *= MOVE.dashExitSpeed / hs;
    f.vel.z *= MOVE.dashExitSpeed / hs;
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
