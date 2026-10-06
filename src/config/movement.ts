// ============================================================================
//  MOVEMENT TUNING. Units are metres / seconds. Every movement rule reads from here.
//  Feel target: Deadlock-style traversal (momentum, double jump, directional dashes,
//  slides) under a readable third-person shooter (Rogue Company presentation).
//  Values are mutable so tests and dev tools can adjust them at runtime.
// ============================================================================
export const MOVE = {
  // ---- body ----
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  /** eye sits this far below the top of the collision box (robot visor height) */
  eyeFromTop: 0.1,

  // ---- ground ----
  /** run speed (forward); strafing and backpedal scale it down */
  maxSpeed: 6.4,
  strafeMult: 0.94,
  backMult: 0.82,
  crouchSpeed: 3.0,
  accel: 15,
  friction: 7,
  stopSpeed: 2.6,
  /** deceleration (m/s^2) when moving faster than the current cap while still steering
   *  (ADS, dash recovery, slide exit): bleeds speed smoothly instead of a friction stop */
  overspeedDecel: 11,

  // ---- jumping ----
  gravity: 22,
  jumpVel: 7.4,
  /** extra jumps available in the air (refilled on a confirmed landing) */
  airJumps: 1,
  airJumpVel: 8.0,
  /** how much of the horizontal velocity the air jump turns toward the held direction (0..1) */
  airJumpRedirect: 0.65,
  /** jump pressed this long before landing still jumps */
  jumpBuffer: 0.12,
  /** after walking off a ledge you can still ground-jump for this long */
  coyoteTime: 0.1,
  stepHeight: 0.55,
  snapDown: 0.42,

  // ---- air control ----
  /** steering acceleration in the air (m/s^2). Never adds speed beyond max(entry speed, run speed). */
  airAccel: 13,

  // ---- dash (Shift) ----
  dashCharges: 2,
  /** seconds to refill one charge (charges refill one at a time) */
  dashRecharge: 2.4,
  dashSpeed: 17,
  dashTime: 0.15,
  /** speed the dash hands back to normal movement; overspeed then bleeds off smoothly */
  dashExitSpeed: 9.5,
  /** minimum time between two dashes */
  dashGap: 0.2,
  /** air dashes allowed per airtime */
  airDashes: 1,
  /** small lift so an air dash reads as a burst, not a drop */
  airDashLift: 1.2,

  // ---- crouch / slide (C) ----
  slideMinSpeed: 5.2,
  slideBoost: 2.6,
  /** the boost is only granted again after this long (no slide-spam acceleration) */
  slideBoostCooldown: 1.1,
  slideMaxSpeed: 13,
  slideFriction: 0.85,
  slideSteer: 3,
  /** slide ends below this speed */
  slideMinExit: 3.4,
  slideMaxTime: 1.6,

  // ---- global ----
  /** hard cap on horizontal speed outside an active dash (no runaway chaining) */
  maxHorizSpeed: 15,
  /** movement sub-step length so fast dashes cannot skip through thin geometry */
  maxStep: 0.12,

  lungeFriction: 3,
};

export type MoveTuning = typeof MOVE;
