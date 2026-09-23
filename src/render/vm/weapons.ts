import * as THREE from 'three';
import type { WeaponId } from '../../sim/types';
import { PAL, coneZ, latheZ, part, profile, rbox, socket, sphere, tubeZ } from './kit';

// ============================================================================
//  Viewmodel weapons. Local frame: bore along -Z at y = 0, +Y up, +X right.
//  Every weapon declares an explicit sight reference (rearSight + frontSight on
//  one line parallel to -Z) used to place the ADS pose exactly on screen centre.
// ============================================================================

export interface WeaponRig {
  id: WeaponId;
  /** posed by the viewmodel each frame */
  root: THREE.Group;
  sockets: {
    gripR: THREE.Object3D;
    gripL: THREE.Object3D;
    muzzle: THREE.Object3D;
    rearSight: THREE.Object3D;
    frontSight: THREE.Object3D;
    magGrab?: THREE.Object3D;
    boltGrab?: THREE.Object3D;
    chargeGrab?: THREE.Object3D;
  };
  parts: {
    mag?: THREE.Object3D;
    magLevel?: THREE.Object3D;
    bolt?: THREE.Object3D;
    slide?: THREE.Object3D;
    charge?: THREE.Object3D;
  };
  /** eye to rear sight distance at full ADS */
  eyeRelief: number;
  hip: { pos: THREE.Vector3; rot: THREE.Euler };
  /** viewmodel camera vertical FOV (deg) at hip / ADS: independent of the world FOV setting */
  vmFov: { hip: number; ads: number };
  /** magazine rest transform (for reload animation) */
  magRest?: THREE.Vector3;
}

const O = 0.0011; // standard outline
const THIN = 0.0007;

function trigger(g: THREE.Group, z: number, y: number, guardColor: number) {
  // guard: extruded ring
  g.add(
    part(
      profile(
        [[-0.034, 0], [0.026, 0], [0.026, -0.028], [-0.034, -0.028]],
        0.01,
        0.0015,
        [[[-0.028, -0.004], [0.02, -0.004], [0.02, -0.023], [-0.028, -0.023]]],
      ),
      guardColor,
      { pos: [0, y, z], outline: THIN },
    ),
  );
  g.add(part(rbox(0.006, 0.02, 0.007, 0.002), PAL.ink, { pos: [0, y - 0.012, z - 0.004], rot: [0.35, 0, 0], outline: 0 }));
}

// ---------------------------------------------------------------- Inkblaster (fountain-pen rifle)
function buildInkblaster(): WeaponRig {
  const root = new THREE.Group();
  const SH = 0.094; // tall sight line keeps the receiver out of the sight picture
  // upper receiver (ink navy)
  root.add(part(profile([[-0.14, -0.012], [0.12, -0.012], [0.12, 0.022], [0.1, 0.027], [-0.12, 0.027], [-0.14, 0.018]], 0.036, 0.003), PAL.navy, { outline: O }));
  // ejection port on the right
  root.add(part(rbox(0.004, 0.014, 0.05, 0.0015), PAL.ink, { pos: [0.0185, 0.006, -0.02], outline: 0 }));
  // lower receiver (pink) with magwell
  root.add(
    part(
      profile([[-0.13, -0.012], [0.105, -0.012], [0.105, -0.052], [0.03, -0.052], [0.03, -0.036], [-0.02, -0.036], [-0.06, -0.042], [-0.13, -0.034]], 0.04, 0.0025),
      PAL.pink,
      { outline: O },
    ),
  );
  trigger(root, 0.01, -0.036, PAL.navy);
  // pistol grip, raked back
  root.add(part(profile([[-0.004, -0.036], [-0.03, -0.128], [-0.066, -0.122], [-0.042, -0.036]], 0.032, 0.004), PAL.navy, { outline: O }));
  root.add(part(rbox(0.034, 0.012, 0.04, 0.004), PAL.pink, { pos: [0, -0.127, 0.048], rot: [-0.28, 0, 0], outline: O }));
  // handguard: octagonal pen barrel in cyan with grip rings
  const hg = part(tubeZ(0.025, 0.24, 8), PAL.cyan, { pos: [0, 0.002, -0.24], outline: O });
  hg.rotation.z = Math.PI / 8;
  root.add(hg);
  for (const z of [-0.29, -0.315, -0.34]) root.add(part(new THREE.TorusGeometry(0.0258, 0.0024, 6, 20), PAL.navy, { pos: [0, 0.002, z], outline: 0 }));
  // barrel + fountain-pen nib muzzle
  root.add(part(tubeZ(0.0085, 0.16, 12), PAL.steel, { pos: [0, 0.002, -0.44], outline: THIN }));
  const nib = part(latheZ([[0.0001, 0.07], [0.006, 0.058], [0.013, 0.03], [0.0155, 0.0], [0.0001, 0.0]], 16), PAL.gold, { pos: [0, 0.002, -0.5], outline: THIN });
  nib.scale.set(1, 0.62, 1);
  root.add(nib);
  root.add(part(rbox(0.0016, 0.004, 0.042, 0.0006), PAL.ink, { pos: [0, 0.0105, -0.54], outline: 0 }));
  root.add(part(sphere(0.0026, 8), PAL.ink, { pos: [0, 0.011, -0.515], outline: 0 }));
  // front sight: slim pen-cap tower, thin post, protective ears (open above the post)
  root.add(part(profile([[-0.012, 0.022], [0.012, 0.022], [0.006, SH - 0.02], [-0.006, SH - 0.02]], 0.008, 0.0015), PAL.navy, { pos: [0, 0, -0.33], outline: THIN }));
  root.add(part(new THREE.BoxGeometry(0.0022, 0.02, 0.0028), PAL.ink, { pos: [0, SH - 0.01, -0.33], outline: 0 }));
  for (const sx of [-1, 1]) root.add(part(new THREE.BoxGeometry(0.0016, 0.022, 0.008), PAL.navy, { pos: [sx * 0.0078, SH - 0.017, -0.33], outline: 0 }));
  // rear sight: low gold pen-clip tower, then a thin ink stem up to a thin aperture ring
  root.add(part(profile([[0.03, 0.026], [-0.012, 0.026], [-0.004, SH - 0.042], [0.012, SH - 0.042]], 0.007, 0.0015), PAL.navy, { pos: [0, 0, 0.1], outline: THIN }));
  root.add(part(rbox(0.009, 0.004, 0.018, 0.0015), PAL.gold, { pos: [0, SH - 0.041, 0.1], outline: 0 }));
  root.add(part(new THREE.BoxGeometry(0.0022, 0.032, 0.004), PAL.ink, { pos: [0, SH - 0.0275, 0.1], outline: 0 }));
  root.add(part(new THREE.TorusGeometry(0.0115, 0.0008, 8, 48), PAL.ink, { pos: [0, SH, 0.1], outline: 0 }));
  // skeleton stock with a cut-out
  root.add(
    part(
      profile(
        [[-0.14, 0.02], [-0.36, 0.012], [-0.372, 0.0], [-0.372, -0.078], [-0.355, -0.088], [-0.24, -0.052], [-0.14, -0.022]],
        0.03,
        0.003,
        [[[-0.2, 0.002], [-0.322, -0.004], [-0.33, -0.056], [-0.24, -0.036]]],
      ),
      PAL.pink,
      { outline: O },
    ),
  );
  root.add(part(rbox(0.034, 0.094, 0.014, 0.004), PAL.navy, { pos: [0, -0.036, 0.378], outline: O }));
  // charging handle (pink T), slides back during the reload
  const charge = new THREE.Group();
  charge.add(part(rbox(0.034, 0.006, 0.012, 0.002), PAL.pinkDark, { outline: THIN }));
  charge.position.set(0, 0.031, 0.132);
  root.add(charge);
  // magazine: curved "ink cartridge" with a window showing the ink level (= ammo)
  const mag = new THREE.Group();
  mag.add(part(profile([[-0.022, 0.012], [0.02, 0.012], [0.028, -0.06], [0.036, -0.16], [-0.004, -0.166], [-0.014, -0.06]], 0.028, 0.0025), PAL.cyan, { outline: O }));
  mag.add(part(rbox(0.032, 0.012, 0.048, 0.003), PAL.navy, { pos: [0, -0.168, 0.012], rot: [-0.12, 0, 0], outline: O }));
  const window = part(rbox(0.0305, 0.1, 0.012, 0.002), 0xdff7fb, { pos: [0, -0.09, 0.004], rot: [-0.1, 0, 0], outline: 0 });
  mag.add(window);
  const level = new THREE.Group();
  level.position.set(0, -0.14, 0.004);
  level.rotation.x = -0.1;
  const fill = part(new THREE.BoxGeometry(0.031, 0.1, 0.0125), PAL.purple, { pos: [0, 0.05, 0], outline: 0 });
  level.add(fill);
  mag.add(level);
  const magRest = new THREE.Vector3(0, -0.05, -0.065);
  mag.position.copy(magRest);
  root.add(mag);

  const gripR = socket('gripR', [0, -0.078, 0.03], [-0.28, 0, 0]);
  const gripL = socket('gripL', [0, -0.024, -0.245]);
  const magGrab = socket('magGrab', [-0.004, -0.1, 0.006]);
  mag.add(magGrab);
  // bolt-catch tap on the left of the receiver after seating the magazine
  const chargeGrab = socket('chargeGrab', [-0.034, -0.004, -0.02], [0, 0, -1.2]);
  root.add(chargeGrab);
  const muzzle = socket('muzzle', [0, 0.002, -0.575]);
  const rearSight = socket('rearSight', [0, SH, 0.1]);
  const frontSight = socket('frontSight', [0, SH, -0.33]);
  root.add(gripR, gripL, muzzle, rearSight, frontSight);
  return {
    id: 'ar',
    root,
    sockets: { gripR, gripL, muzzle, rearSight, frontSight, magGrab, chargeGrab },
    parts: { mag, magLevel: level, charge },
    eyeRelief: 0.17,
    hip: { pos: new THREE.Vector3(0.13, -0.165, -0.37), rot: new THREE.Euler(0.03, 0.055, -0.05) },
    vmFov: { hip: 56, ads: 48 },
    magRest,
  };
}

// ---------------------------------------------------------------- Graphite (mechanical-pencil bolt sniper)
function buildGraphite(): WeaponRig {
  const root = new THREE.Group();
  const SH = 0.058; // scope axis above the bore
  // receiver tube + rail
  root.add(part(tubeZ(0.02, 0.29, 16), PAL.graphite, { pos: [0, 0, -0.055], outline: O }));
  root.add(part(rbox(0.018, 0.009, 0.25, 0.003), PAL.navy, { pos: [0, 0.021, -0.06], outline: THIN }));
  // hex "pencil" barrel with bands, sharpened tip muzzle
  const bar = part(tubeZ(0.0165, 0.6, 6), PAL.yellow, { pos: [0, 0, -0.5], outline: O });
  bar.rotation.z = Math.PI / 6;
  root.add(bar);
  root.add(part(tubeZ(0.0185, 0.03, 16), PAL.steel, { pos: [0, 0, -0.215], outline: THIN }));
  root.add(part(tubeZ(0.017, 0.012, 6), PAL.ink, { pos: [0, 0, -0.26], outline: 0 }));
  root.add(part(latheZ([[0.0165, 0.0], [0.0062, 0.052], [0.0001, 0.052]], 12), PAL.wood, { pos: [0, 0, -0.8], outline: THIN }));
  root.add(part(coneZ(0.0062, 0.018, 10), PAL.ink, { pos: [0, 0, -0.861], outline: 0 }));
  // stock: a yellow ruler with tick marks and a thumbhole, pink cheek rest
  root.add(
    part(
      profile(
        [[-0.085, 0.012], [-0.46, 0.01], [-0.466, -0.004], [-0.466, -0.098], [-0.2, -0.062], [-0.12, -0.046], [-0.085, -0.022]],
        0.03,
        0.0025,
        [[[-0.13, -0.012], [-0.2, -0.012], [-0.2, -0.042], [-0.14, -0.034]]],
      ),
      PAL.gold,
      { outline: O },
    ),
  );
  for (let i = 0; i < 16; i++) {
    const z = 0.1 + i * 0.022;
    const long = i % 4 === 0;
    for (const sx of [-1, 1]) root.add(part(new THREE.BoxGeometry(0.0012, long ? 0.018 : 0.01, 0.0018), PAL.ink, { pos: [sx * 0.0152, 0.004 - (long ? 0.009 : 0.005), z], outline: 0 }));
  }
  root.add(part(rbox(0.032, 0.02, 0.11, 0.006), PAL.pink, { pos: [0, 0.022, 0.26], outline: O }));
  root.add(part(rbox(0.034, 0.105, 0.014, 0.004), PAL.navy, { pos: [0, -0.046, 0.468], outline: O }));
  // grip + trigger
  root.add(part(profile([[0.028, -0.02], [0.004, -0.118], [-0.03, -0.112], [-0.012, -0.02]], 0.03, 0.004), PAL.graphite, { outline: O }));
  trigger(root, -0.035, -0.02, PAL.navy);
  // 5-round box magazine
  const mag = new THREE.Group();
  mag.add(part(rbox(0.026, 0.05, 0.062, 0.004), PAL.pink, { pos: [0, -0.025, 0], outline: O }));
  mag.add(part(rbox(0.028, 0.008, 0.066, 0.003), PAL.navy, { pos: [0, -0.052, 0], outline: THIN }));
  const magRest = new THREE.Vector3(0, -0.018, -0.1);
  mag.position.copy(magRest);
  root.add(mag);
  // bolt: body at the rear + handle arm with an eraser knob. Pivots around the bore.
  const bolt = new THREE.Group();
  bolt.position.set(0, 0, 0.06);
  bolt.add(part(tubeZ(0.0095, 0.07, 12), PAL.steel, { pos: [0, 0.004, 0.02], outline: THIN }));
  bolt.add(part(tubeZ(0.004, 0.05, 8), PAL.steel, { pos: [0.03, -0.012, -0.004], rot: [0, Math.PI / 2 - 0.35, 0.4], outline: THIN }));
  bolt.add(part(tubeZ(0.0115, 0.022, 14), PAL.pink, { pos: [0.054, -0.022, -0.004], rot: [0, 0, 0], outline: O }));
  bolt.add(part(tubeZ(0.0118, 0.006, 14), PAL.steel, { pos: [0.054, -0.022, 0.009], outline: 0 }));
  root.add(bolt);
  // scope: ink tube, bells, pink turrets and rings, cyan objective glass
  root.add(part(tubeZ(0.0135, 0.27, 18), PAL.ink, { pos: [0, SH, -0.065], outline: O }));
  root.add(part(latheZ([[0.0135, 0.0], [0.022, 0.04], [0.022, 0.07], [0.0001, 0.07]], 20), PAL.ink, { pos: [0, SH, -0.2], outline: O }));
  root.add(part(new THREE.CircleGeometry(0.0195, 24), PAL.cyan, { pos: [0, SH, -0.2715], rot: [0, Math.PI, 0], outline: 0 }));
  root.add(part(latheZ([[0.018, 0.0], [0.018, 0.028], [0.0135, 0.058]], 24), PAL.ink, { pos: [0, SH, 0.126], outline: O }));
  // eyepiece glass: shows a live render of the scope view (see GameRenderer)
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0172, 40), new THREE.MeshBasicMaterial({ color: 0x10121a }));
  lens.name = 'scopeLens';
  lens.position.set(0, SH, 0.1262);
  root.add(lens);
  root.add(part(new THREE.TorusGeometry(0.0176, 0.0009, 6, 40), PAL.pink, { pos: [0, SH, 0.1264], outline: 0 }));
  root.add(part(tubeZ(0.0072, 0.016, 14), PAL.pink, { pos: [0, SH + 0.018, -0.065], rot: [Math.PI / 2, 0, 0], outline: THIN }));
  root.add(part(tubeZ(0.0072, 0.016, 14), PAL.pink, { pos: [0.018, SH, -0.065], rot: [0, Math.PI / 2, 0], outline: THIN }));
  for (const z of [-0.005, -0.135]) {
    root.add(part(new THREE.TorusGeometry(0.0145, 0.003, 6, 20), PAL.pink, { pos: [0, SH, z], outline: 0 }));
    root.add(part(rbox(0.012, SH - 0.034, 0.012, 0.002), PAL.navy, { pos: [0, 0.026 + (SH - 0.034) / 2, z], outline: THIN }));
  }

  const gripR = socket('gripR', [0, -0.066, 0.012], [-0.24, 0, 0]);
  const gripL = socket('gripL', [0, -0.017, -0.33]);
  const magGrab = socket('magGrab', [-0.004, -0.03, 0.0]);
  mag.add(magGrab);
  const boltGrab = socket('boltGrab', [0.054, -0.022, -0.004], [0, 0, 0.5]);
  bolt.add(boltGrab);
  const muzzle = socket('muzzle', [0, 0, -0.872]);
  const rearSight = socket('rearSight', [0, SH, 0.126]);
  const frontSight = socket('frontSight', [0, SH, -0.27]);
  root.add(gripR, gripL, muzzle, rearSight, frontSight);
  return {
    id: 'sniper',
    root,
    sockets: { gripR, gripL, muzzle, rearSight, frontSight, magGrab, boltGrab },
    parts: { mag, bolt },
    // at full ADS the eyepiece rim fills ~94% of the screen height: it hands off to the scope overlay
    eyeRelief: 0.0405,
    hip: { pos: new THREE.Vector3(0.135, -0.165, -0.3), rot: new THREE.Euler(0.03, 0.055, -0.05) },
    vmFov: { hip: 56, ads: 50 },
    magRest,
  };
}

// ---------------------------------------------------------------- Highlighter (marker pistol)
function buildHighlighter(): WeaponRig {
  const root = new THREE.Group();
  const SH = 0.035;
  // slide (fluorescent yellow marker body) - a group so it can blow back
  const slide = new THREE.Group();
  slide.add(part(profile([[-0.09, -0.008], [0.1, -0.008], [0.1, 0.02], [0.086, 0.026], [-0.076, 0.026], [-0.09, 0.02]], 0.03, 0.0025), PAL.hiYellow, { outline: O }));
  for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) slide.add(part(new THREE.BoxGeometry(0.0012, 0.018, 0.003), PAL.navy, { pos: [sx * 0.0153, 0.01, 0.062 + i * 0.006], outline: 0 }));
  // chisel-tip cap = muzzle
  const cap = part(rbox(0.022, 0.024, 0.032, 0.004), PAL.navy, { pos: [0, 0.008, -0.114], outline: O });
  slide.add(cap);
  slide.add(part(new THREE.BoxGeometry(0.018, 0.006, 0.012), PAL.cyan, { pos: [0, 0.008, -0.132], rot: [0.5, 0, 0], outline: THIN }));
  // sights: narrow front post, rear notch (two posts) - no outlines
  slide.add(part(new THREE.BoxGeometry(0.0022, 0.009, 0.004), PAL.ink, { pos: [0, 0.026 + 0.0045, -0.085], outline: 0 }));
  for (const sx of [-1, 1]) slide.add(part(new THREE.BoxGeometry(0.0034, 0.009, 0.004), PAL.ink, { pos: [sx * 0.0046, 0.026 + 0.0045, 0.078], outline: 0 }));
  root.add(slide);
  // frame + grip
  root.add(part(profile([[-0.082, -0.008], [0.09, -0.008], [0.09, -0.022], [0.02, -0.024], [-0.01, -0.03], [-0.082, -0.025]], 0.028, 0.0025), PAL.navy, { outline: O }));
  trigger(root, -0.005, -0.024, PAL.navy);
  root.add(part(profile([[-0.03, -0.024], [-0.046, -0.112], [-0.086, -0.107], [-0.08, -0.024]], 0.03, 0.004), PAL.pink, { outline: O }));
  // magazine (base plate visible), drops out of the grip on reload
  const mag = new THREE.Group();
  mag.add(part(rbox(0.022, 0.085, 0.032, 0.003), PAL.navy, { pos: [0, 0.04, 0], outline: THIN }));
  mag.add(part(rbox(0.03, 0.01, 0.044, 0.003), PAL.cyan, { pos: [0, -0.004, 0], outline: O }));
  const magRest = new THREE.Vector3(0, -0.108, 0.064);
  mag.position.copy(magRest);
  mag.rotation.x = -0.18;
  root.add(mag);

  const gripR = socket('gripR', [0, -0.066, 0.06], [-0.18, 0, 0]);
  // support hand wraps the grip front from below-left (thumbs forward)
  const gripL = socket('gripL', [-0.012, -0.07, 0.048], [-0.1, 0.25, -0.35]);
  const magGrab = socket('magGrab', [-0.01, -0.004, 0]);
  mag.add(magGrab);
  const muzzle = socket('muzzle', [0, 0.008, -0.135]);
  const rearSight = socket('rearSight', [0, SH, 0.078]);
  const frontSight = socket('frontSight', [0, SH, -0.085]);
  root.add(gripR, gripL, muzzle, rearSight, frontSight);
  return {
    id: 'pistol',
    root,
    sockets: { gripR, gripL, muzzle, rearSight, frontSight, magGrab },
    parts: { mag, slide },
    eyeRelief: 0.27,
    hip: { pos: new THREE.Vector3(0.075, -0.1, -0.3), rot: new THREE.Euler(0.04, 0.08, -0.03) },
    vmFov: { hip: 56, ads: 50 },
    magRest,
  };
}

// ---------------------------------------------------------------- Pencil (melee)
function buildPencil(): WeaponRig {
  const root = new THREE.Group();
  const body = part(tubeZ(0.0125, 0.2, 6), PAL.yellow, { pos: [0, 0, -0.05], outline: O });
  body.rotation.z = Math.PI / 6;
  root.add(body);
  root.add(part(tubeZ(0.0133, 0.022, 14), 0xb8bcc6, { pos: [0, 0, 0.061], outline: THIN }));
  root.add(part(tubeZ(0.0128, 0.03, 14), PAL.pink, { pos: [0, 0, 0.087], outline: O }));
  root.add(part(latheZ([[0.0125, 0.0], [0.004, 0.06], [0.0001, 0.06]], 12), PAL.wood, { pos: [0, 0, -0.15], outline: THIN }));
  root.add(part(coneZ(0.0045, 0.022, 10), PAL.ink, { pos: [0, 0, -0.216], outline: 0 }));
  const gripR = socket('gripR', [0, -0.012, 0.01], [-1.2, 0, 0]);
  const gripL = socket('gripL', [-0.2, -0.25, 0.1]);
  const muzzle = socket('muzzle', [0, 0, -0.23]);
  const rearSight = socket('rearSight', [0, 0.03, 0.05]);
  const frontSight = socket('frontSight', [0, 0.03, -0.1]);
  root.add(gripR, gripL, muzzle, rearSight, frontSight);
  return {
    id: 'melee',
    root,
    sockets: { gripR, gripL, muzzle, rearSight, frontSight },
    parts: {},
    eyeRelief: 0.2,
    hip: { pos: new THREE.Vector3(0.14, -0.14, -0.3), rot: new THREE.Euler(0.25, -0.2, 0.35) },
    vmFov: { hip: 56, ads: 56 },
  };
}

export function buildWeaponRigs(): Record<WeaponId, WeaponRig> {
  return { ar: buildInkblaster(), sniper: buildGraphite(), pistol: buildHighlighter(), melee: buildPencil() };
}
