// Movement tuning. Units are metres / seconds. Numbers chosen to feel like Krunker/Source:
// high ground accel + friction (snappy stops), Quake-style air accel with a low wish cap (air strafing),
// no friction on the landing tick when jump is buffered/held (bunny hopping keeps momentum).
export const MOVE = {
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.15,
  eyeFromTop: 0.16,

  maxSpeed: 8.2,
  crouchSpeed: 3.8,

  accel: 13,
  friction: 7.5,
  stopSpeed: 2.8,

  airAccel: 110,
  airWishCap: 0.95,
  maxAirSpeed: 19,

  gravity: 25,
  jumpVel: 8.1,
  stepHeight: 0.55,
  snapDown: 0.42,

  jumpBuffer: 0.13,
  coyoteTime: 0.1,
  autoHop: true, // holding jump re-jumps on the landing tick

  slideMinSpeed: 5.5,
  slideBoost: 4.2,
  slideMaxSpeed: 15.5,
  slideFriction: 0.7,
  slideTime: 0.85,
  slideCooldown: 0.55,
  slideSteer: 4,

  lungeFriction: 3,
} as const;
