import * as THREE from 'three';
import { PAL, capsuleBetween, part, rbox, tubeZ } from './kit';

// Cartoon gloves (3 fingers + thumb) built in a "socket frame" so they can be snapped onto any
// weapon socket. Right hand frame: origin = centre of the pistol grip where the palm sits,
// +y up the grip, -z toward the muzzle, +x = right side of the gun. Left hand frame: origin =
// underside of the handguard, -z forward, +y up.

const GLOVE = PAL.white;
const CUFF = PAL.pink;
const T = 0.0012; // outline thickness

export interface HandRig {
  group: THREE.Group;
  /** where the sleeve attaches (in hand space) */
  wrist: THREE.Object3D;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildRightGlove(): HandRig {
  const g = new THREE.Group();
  g.name = 'handR';
  // back of the hand on the right side of the grip
  g.add(part(rbox(0.026, 0.07, 0.078, 0.012), GLOVE, { pos: [0.029, -0.006, 0.004], rot: [0.05, 0, -0.08], outline: T }));
  // three fingers wrapping the front of the grip
  for (let i = 0; i < 3; i++) {
    const y = 0.006 - i * 0.021;
    g.add(capsuleBetween(0.0105, v(0.03, y, -0.022), v(-0.012, y - 0.002, -0.03), GLOVE, T));
  }
  // trigger finger along the frame toward the trigger
  g.add(capsuleBetween(0.0098, v(0.026, 0.03, -0.022), v(0.012, 0.028, -0.062), GLOVE, T));
  // thumb over the tang
  g.add(capsuleBetween(0.011, v(0.028, 0.034, 0.02), v(-0.01, 0.046, -0.004), GLOVE, T));
  // cuff
  const cuff = part(tubeZ(0.03, 0.03, 14), CUFF, { outline: T });
  cuff.position.set(0.034, -0.05, 0.032);
  cuff.rotation.set(0.95, 0.35, 0);
  g.add(cuff);
  const wrist = new THREE.Object3D();
  wrist.position.set(0.036, -0.058, 0.042);
  g.add(wrist);
  return { group: g, wrist };
}

export function buildLeftGlove(): HandRig {
  const g = new THREE.Group();
  g.name = 'handL';
  // palm cradling the underside
  g.add(part(rbox(0.066, 0.024, 0.074, 0.01), GLOVE, { pos: [-0.004, -0.013, 0.004], rot: [0, 0, 0.12], outline: T }));
  // fingers curl up the left side
  for (let i = 0; i < 3; i++) {
    const z = -0.022 + i * 0.022;
    g.add(capsuleBetween(0.0102, v(-0.03, -0.012, z), v(-0.033, 0.016, z - 0.004), GLOVE, T));
  }
  // thumb along the right side
  g.add(capsuleBetween(0.0108, v(0.026, -0.012, 0.03), v(0.03, 0.008, -0.018), GLOVE, T));
  const cuff = part(tubeZ(0.03, 0.03, 14), CUFF, { outline: T });
  cuff.position.set(-0.012, -0.036, 0.05);
  cuff.rotation.set(0.55, -0.25, 0);
  g.add(cuff);
  const wrist = new THREE.Object3D();
  wrist.position.set(-0.014, -0.042, 0.06);
  g.add(wrist);
  return { group: g, wrist };
}

/** Sleeve from wrist toward the elbow along +y (fixed length, runs off-screen). Navy with a pink stripe. */
export const SLEEVE_LEN = 0.42;
export function buildSleeve(): THREE.Group {
  const g = new THREE.Group();
  const body = part(new THREE.CylinderGeometry(0.037, 0.031, SLEEVE_LEN, 14), PAL.navy, { outline: T });
  body.position.y = SLEEVE_LEN / 2;
  g.add(body);
  const stripe = part(new THREE.CylinderGeometry(0.0335, 0.0335, 0.04, 14), PAL.pink, { outline: 0 });
  stripe.position.y = 0.06;
  g.add(stripe);
  return g;
}
