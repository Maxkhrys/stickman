import type { Box, DummyDef, MapDef, Ramp, SpawnPoint } from '../map';
import { v3, yawTo, type Vec3 } from '../vec';

// ============================================================================
//  FOUNDRY: industrial / urban sniper arena. 150 x 110 m usable (about 3x the
//  92 x 60 Crossfire arena) on three elevation bands:
//    L0  ground (0 m)           yards, lanes, warehouse floors
//    L1  4.0 - 5.2 m            smelter balconies, north catwalk, pipe bridge,
//                               warehouse mezzanines, single container tops (2.6)
//    L2  7.5 - 9 m              warehouse roofs, smelter roof, stacked containers
//
//  Height language (validated by tests/foundry.test.ts against the real
//  movement code): crates 1.2 m = single jump, containers 2.6 m = double jump,
//  north catwalk gap 5.5 m = double jump,
//  pipe-bridge gap 9 m = double jump + air dash.
//
//  Layout (x east, z south; -z is "north"):
//    north lane (z -55..-28): long sightlines, containers, gantry crane, catwalk at 4.5
//    centre: smelter block (16 x 16 x 9) with chimney landmark and balconies at 4.4
//    south (z 22..50): two warehouses (roofs 7.5) linked by a broken pipe bridge at 4.4
//    west yard: water tower; east yard: silo. Spawns spread over all of it.
// ============================================================================

export const FOUNDRY_MAT = {
  concrete: 0xb9b4aa,
  concreteDark: 0x8f8a82,
  brick: 0x9b5a43,
  steel: 0x5b6470,
  rust: 0x9a5b34,
  grate: 0x6d7580,
  hazard: 0xe6b422,
  containerR: 0xb2402f,
  containerB: 0x2f6aa8,
  containerG: 0x3f8a55,
  containerY: 0xd99a26,
  crate: 0xa77b4c,
  barrel: 0x37627a,
  pipe: 0x7a8794,
  roof: 0x6f747a,
} as const;
export type FoundryMat = keyof typeof FOUNDRY_MAT;

const boxes: Box[] = [];
const ramps: Ramp[] = [];

/** Box from centre x/z, size w (x) d (z) h, base y. */
function B(cx: number, cz: number, w: number, d: number, h: number, mat: FoundryMat, y0 = 0): Box {
  const b: Box = { min: v3(cx - w / 2, y0, cz - d / 2), max: v3(cx + w / 2, y0 + h, cz + d / 2), color: FOUNDRY_MAT[mat], mat };
  boxes.push(b);
  return b;
}
/** Box from min/max corners. */
function X(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: FoundryMat): Box {
  const b: Box = { min: v3(x0, y0, z0), max: v3(x1, y1, z1), color: FOUNDRY_MAT[mat], mat };
  boxes.push(b);
  return b;
}
function R(x0: number, x1: number, z0: number, z1: number, axis: 'x' | 'z', h0: number, h1: number): Ramp {
  const r: Ramp = { x0, x1, z0, z1, axis, h0, h1, color: FOUNDRY_MAT.hazard };
  ramps.push(r);
  return r;
}
/** Shipping container (6.1 x 2.45 x 2.6); `along` = 'x' or 'z' for its long axis. */
function container(cx: number, cz: number, along: 'x' | 'z', mat: FoundryMat, y0 = 0) {
  return along === 'x' ? B(cx, cz, 6.1, 2.45, 2.6, mat, y0) : B(cx, cz, 2.45, 6.1, 2.6, mat, y0);
}
function crate(cx: number, cz: number, s = 1.4, h = 1.2, y0 = 0) {
  return B(cx, cz, s, s, h, 'crate', y0);
}
function barrels(cx: number, cz: number, n: number) {
  for (let i = 0; i < n; i++) B(cx + (i % 2) * 0.9, cz + Math.floor(i / 2) * 0.9, 0.75, 0.75, 1.0, 'barrel');
}
function spawn(x: number, z: number, lookX: number, lookZ: number, y = 0): SpawnPoint {
  return { pos: v3(x, y, z), yaw: yawTo(lookX - x, lookZ - z) };
}
/** Mirror the boxes/ramps added since `fromBox`/`fromRamp` through the origin's x axis (x -> -x). */
function mirrorSinceX(fromBox: number, fromRamp: number) {
  const nb = boxes.length, nr = ramps.length;
  for (let i = fromBox; i < nb; i++) {
    const b = boxes[i];
    boxes.push({ min: v3(-b.max.x, b.min.y, b.min.z), max: v3(-b.min.x, b.max.y, b.max.z), color: b.color, mat: b.mat });
  }
  for (let i = fromRamp; i < nr; i++) {
    const r = ramps[i];
    ramps.push(r.axis === 'x'
      ? { ...r, x0: -r.x1, x1: -r.x0, h0: r.h1, h1: r.h0 }
      : { ...r, x0: -r.x1, x1: -r.x0 });
  }
}

export const FOUNDRY_GEOM = {
  smelterTop: 9,
  balconyTop: 4.4,
  catwalkTop: 4.5,
  /** north catwalk double-jump gap (x range) */
  catwalkGap: [18, 23.5] as [number, number],
  bridgeTop: 4.4,
  /** pipe bridge gap (x range) */
  bridgeGap: [-4.5, 4.5] as [number, number],
  warehouseRoof: 7.5,
  container: 2.6,
};

export function buildFoundry(): MapDef {
  boxes.length = 0;
  ramps.length = 0;
  const minX = -75, maxX = 75, minZ = -55, maxZ = 55;

  // ---- perimeter: brick factory walls ----
  X(minX - 1, minZ - 1, maxX + 1, minZ, 0, 12, 'brick');
  X(minX - 1, maxZ, maxX + 1, maxZ + 1, 0, 12, 'brick');
  X(minX - 1, minZ, minX, maxZ, 0, 12, 'brick');
  X(maxX, minZ, maxX + 1, maxZ, 0, 12, 'brick');

  // ==========================================================================
  //  CENTRE: smelter block, chimney, balconies (L1 4.4), roof (L2 9)
  // ==========================================================================
  B(0, 0, 16, 16, 9, 'rust');
  B(3.5, 3.5, 3.2, 3.2, 15, 'brick', 9); // chimney landmark (top 24 m)
  B(-3.5, -3, 2.2, 2.2, 1.2, 'steel', 9); // roof vents = cover
  B(-4, 3.5, 1.4, 3.2, 1.0, 'steel', 9);
  X(-5.5, -8, 8, -7.7, 9, 9.8, 'steel'); // roof parapets (low, crouch cover); gaps over the balcony crates
  X(-8, 7.7, 5.5, 8, 9, 9.8, 'steel');
  // north balcony (z -11..-8) with ramp up from the east, south balcony mirrored (ramp from the west)
  X(-10, -11, 10, -8, 4.0, 4.4, 'grate');
  X(-6, -11, 6, -10.85, 4.4, 5.4, 'steel'); // railing with gaps at both ends
  for (const x of [-9.7, 9.7]) X(x - 0.25, -10.95, x + 0.25, -10.45, 0, 4.0, 'steel');
  R(10, 22, -11, -8, 'x', 4.4, 0);
  X(-10, 8, 10, 11, 4.0, 4.4, 'grate');
  X(-6, 10.85, 6, 11, 4.4, 5.4, 'steel');
  for (const x of [-9.7, 9.7]) X(x - 0.25, 10.45, x + 0.25, 10.95, 0, 4.0, 'steel');
  R(-22, -10, 8, 11, 'x', 0, 4.4);
  // roof access: crate on each balcony (top 6.6) -> double jump onto the 9 m roof
  crate(-7.2, -9.2, 1.6, 2.2, 4.4);
  crate(7.2, 9.2, 1.6, 2.2, 4.4);
  // ground cover round the smelter
  crate(-12, -3, 1.4, 1.2);
  crate(12, 3, 1.4, 1.2);
  B(-12.5, 4, 1.2, 4, 1.3, 'concreteDark');
  B(12.5, -4, 1.2, 4, 1.3, 'concreteDark');
  barrels(-15, -14, 4);
  barrels(14, 13, 4);

  // ==========================================================================
  //  NORTH LANE (z -55..-28): containers, gantry crane, catwalk L1 4.5
  // ==========================================================================
  // catwalk with a 5.5 m double-jump gap (x 18..23.5): single jump falls short
  X(-50, -53.5, 18, -50.5, 4.1, 4.5, 'grate');
  X(23.5, -53.5, 50, -50.5, 4.1, 4.5, 'grate');
  for (let x = -48; x <= 48; x += 12) X(x - 0.3, -51.2, x + 0.3, -50.6, 0, 4.1, 'steel');
  for (const [a, b] of [[-46, -30], [-20, -4], [4, 17], [30, 46]]) X(a, -50.65, b, -50.5, 4.5, 5.5, 'steel');
  R(-62, -50, -53.5, -50.5, 'x', 0, 4.5);
  R(50, 62, -53.5, -50.5, 'x', 4.5, 0);
  // containers: singles are double-jump ledges (2.6), stacks make L2 perches (5.2)
  container(-33, -40, 'x', 'containerR');
  container(-34.5, -40, 'x', 'containerB', 2.6);
  container(-14, -34, 'z', 'containerG');
  container(0, -45, 'x', 'containerY');
  container(14, -36, 'z', 'containerB');
  container(33, -42, 'x', 'containerR');
  container(34.5, -42, 'x', 'containerG', 2.6);
  container(-50, -32, 'z', 'containerY');
  container(50, -46, 'z', 'containerB');
  crate(-27.5, -38.5, 1.4, 1.2); // step onto the stack's lower container
  crate(27.5, -43.5, 1.4, 1.2);
  crate(-22, -46, 1.4, 1.2);
  crate(22, -31, 1.4, 1.2);
  crate(-5, -30, 1.4, 1.2);
  crate(6, -51, 1.4, 1.2);
  barrels(-26, -31, 3);
  barrels(25, -49, 3);
  // gantry crane: legs, beam (11 - 12.4), hanging block. Landmark over the lane.
  for (const x of [-25, 25]) for (const z of [-44, -36]) B(x, z, 1.1, 1.1, 11, 'hazard');
  X(-25.5, -44.6, 25.5, -43.4, 11, 12.4, 'hazard');
  X(-25.5, -36.6, 25.5, -35.4, 11, 12.4, 'hazard');
  X(4, -44, 7, -36, 12.4, 13.6, 'steel'); // trolley
  B(5.5, -40, 1.6, 1.6, 1.4, 'steel', 7.6); // hanging hook block
  B(5.5, -40, 0.12, 0.12, 3.4, 'steel', 9);
  // low walls between lane and centre
  B(-22, -22, 10, 0.8, 1.3, 'concrete');
  B(22, -22, 10, 0.8, 1.3, 'concrete');
  B(0, -20, 6, 0.8, 1.3, 'concrete');
  B(-40, -18, 0.8, 8, 1.3, 'concrete');
  B(40, -18, 0.8, 8, 1.3, 'concrete');

  // ==========================================================================
  //  SOUTH WAREHOUSES (z 24..48), roofs L2 7.5, mezzanines L1 4.0.
  //  Built for the west one, mirrored to the east.
  // ==========================================================================
  const wb = boxes.length, wr = ramps.length;
  {
    const x0 = -52, x1 = -22, z0 = 24, z1 = 48, t = 0.6, wallTop = 7.1;
    X(x0, z0, x1, z1, wallTop, 7.5, 'roof'); // roof slab
    // north wall with two doors (x -45..-41, -33..-29), lintel above 3.6
    X(x0, z0, -45, z0 + t, 0, wallTop, 'concrete');
    X(-41, z0, -33, z0 + t, 0, wallTop, 'concrete');
    X(-29, z0, x1, z0 + t, 0, wallTop, 'concrete');
    X(-45, z0, -41, z0 + t, 3.6, wallTop, 'concrete');
    X(-33, z0, -29, z0 + t, 3.6, wallTop, 'concrete');
    // south wall
    X(x0, z1 - t, x1, z1, 0, wallTop, 'concrete');
    // west wall with a door (z 30..34)
    X(x0, z0, x0 + t, 30, 0, wallTop, 'concrete');
    X(x0, 34, x0 + t, z1, 0, wallTop, 'concrete');
    X(x0, 30, x0 + t, 34, 3.6, wallTop, 'concrete');
    // east wall (toward the courtyard) with a door (z 37..41)
    X(x1 - t, z0, x1, 37, 0, wallTop, 'concrete');
    X(x1 - t, 41, x1, z1, 0, wallTop, 'concrete');
    X(x1 - t, 37, x1, 41, 3.6, wallTop, 'concrete');
    // mezzanine along the south wall (top 4.0) + inner ramp
    X(x0 + t, 44.4, -36, z1 - t, 3.6, 4.0, 'grate');
    R(-36, -27, 44.4, 47.4, 'x', 4.0, 0);
    X(-48, 44.25, -38, 44.4, 4.0, 5.0, 'steel'); // mezzanine railing
    // interior cover: shelving rows and crates
    B(-44, 33, 7, 1.2, 2.4, 'steel');
    B(-31, 30, 1.2, 5, 2.4, 'steel');
    crate(-38, 38, 1.6, 1.2);
    crate(-36.6, 38, 1.2, 1.2);
    crate(-27, 33, 1.4, 1.2);
    crate(-48, 40, 1.4, 1.2);
    // exterior: stair ramp to a 4.4 landing on the courtyard side, then the pipe bridge
    X(-22, 27, -17, 33, 4.0, 4.4, 'grate'); // landing
    R(-21, -18, 15, 27, 'z', 0, 4.4); // ramp from the north
    // roof access: crate stack on the landing (4.4 + 1.2 = 5.6) -> double jump onto the 7.5 roof
    crate(-21.1, 32, 1.4, 1.2, 4.4);
    // pipe bridge west half: x -17..-4.5 at z 29..31, top 4.4
    X(-17, 29, -4.5, 31, 4.0, 4.4, 'grate');
    X(-17, 31, -4.5, 31.9, 4.6, 5.5, 'pipe'); // big pipe alongside (cover)
    X(-11.2, 29.6, -10.6, 30.4, 0, 4.0, 'steel'); // support
    // courtyard cover
    container(-12, 44, 'z', 'containerG');
    crate(-8, 20, 1.4, 1.2);
    barrels(-15, 50, 4);
  }
  mirrorSinceX(wb, wr);
  // courtyard centre
  B(0, 38, 3, 6, 1.3, 'concreteDark');
  crate(0, 46, 1.6, 1.2);
  crate(-1.5, 22, 1.2, 1.2);
  crate(1.5, 22, 1.2, 1.2);

  // ==========================================================================
  //  WEST YARD: water tower landmark, guard hut, containers
  // ==========================================================================
  for (const dx of [-2.2, 2.2]) for (const dz of [-2.2, 2.2]) B(-64 + dx, -24 + dz, 0.5, 0.5, 8, 'steel');
  B(-64, -24, 6, 6, 5, 'rust', 8); // tank (top 13)
  B(-64, -24, 7, 7, 0.3, 'grate', 7.7); // walkway ring under the tank
  B(-62, 6, 5, 4, 2.6, 'concrete'); // guard hut (roof 2.6: double jump)
  container(-68, 18, 'z', 'containerR');
  container(-56, -8, 'x', 'containerB');
  crate(-58, 10, 1.4, 1.2);
  crate(-70, -4, 1.4, 1.2);
  barrels(-50, 14, 3);
  B(-46, 2, 0.8, 8, 1.3, 'concrete');

  // ==========================================================================
  //  EAST YARD: silo landmark, loading dock (L1 1.2 dock, ramp)
  // ==========================================================================
  B(64, 24, 7, 7, 14, 'concrete'); // silo
  B(64, 24, 7.6, 7.6, 0.6, 'steel', 14);
  X(66, -16, 75, 0, 0, 1.2, 'concreteDark'); // loading dock
  R(60, 66, -14, -6, 'x', 0, 1.2);
  container(70, -10, 'z', 'containerY', 1.2);
  container(56, 8, 'x', 'containerG');
  crate(58, -24, 1.4, 1.2);
  crate(70, 8, 1.4, 1.2);
  barrels(50, -4, 3);
  B(46, -2, 0.8, 8, 1.3, 'concrete');

  const spawns: SpawnPoint[] = [
    spawn(-70, -12, 0, 0),
    spawn(-70, 10, 0, 0),
    spawn(-58, -46, 0, -40),
    spawn(-60, 40, 0, 30),
    spawn(70, 12, 0, 0),
    spawn(70, -28, 0, 0),
    spawn(58, -40, 0, -40),
    spawn(60, 40, 0, 30),
    spawn(-36, 41, -36, 30), // west warehouse interior
    spawn(36, 41, 36, 30), // east warehouse interior
    spawn(-30, -26, 0, -40),
    spawn(30, -26, 0, -40),
    spawn(2, -52, 2, -30),
    spawn(0, 52, 0, 30),
    spawn(-24, 8, 0, 0),
    spawn(24, -8, 0, 0),
  ];

  // practice: start on the west end of the north lane looking east down it
  const trainingSpawn = spawn(-64, -40, 0, -40);
  const D = (x: number, y: number, z: number, faceX: number, faceZ: number, extra: Partial<DummyDef> = {}): DummyDef => ({
    pos: v3(x, y, z), yaw: yawTo(faceX - x, faceZ - z), strafe: 0, period: 1, ...extra,
  });
  const T = trainingSpawn.pos;
  const dummies: DummyDef[] = [
    D(-50, 0, -42, T.x, T.z), // 14 m
    D(-40, 0, -46, T.x, T.z, { crouch: true }), // 25 m crouched
    D(-24, 0, -40, T.x, T.z, { strafe: 1, period: 1.4 }), // 40 m strafing
    D(-6, 0, -38, T.x, T.z, { strafe: 1, period: 1.1, jump: true }), // 58 m jumping strafer
    D(10, 0, -46, T.x, T.z), // 75 m
    D(42, 0, -38, T.x, T.z, { strafe: 1, period: 1.8 }), // 106 m
    D(-14, 2.6, -34, T.x, T.z), // container top (L1)
    D(-34, 5.2, -40, T.x, T.z), // stacked containers (L2)
    D(36, 4.5, -52, 36, -40, { strafe: 1, period: 2 }), // catwalk walker
    D(0, 4.4, -9.5, T.x, T.z), // smelter balcony
    D(1, 9, -4.5, T.x, T.z), // smelter roof
  ];

  const labels = [
    { pos: v3(0, 25, 0), text: 'SMELTER' },
    { pos: v3(0, 13.6, -40), text: 'GANTRY' },
    { pos: v3(-64, 14, -24), text: 'WATER TOWER' },
    { pos: v3(64, 15.5, 24), text: 'SILO' },
    { pos: v3(0, 6, 30), text: 'PIPE BRIDGE' },
    { pos: v3(-37, 8.3, 24), text: 'WAREHOUSE W' },
    { pos: v3(37, 8.3, 24), text: 'WAREHOUSE E' },
  ];
  for (const d of [15, 25, 40, 60, 80, 100]) labels.push({ pos: v3(T.x + d, 0.3, -48.5), text: `${d}m` });

  const capturePoints: Vec3[] = [v3(0, 0, -40), v3(0, 0, 40), v3(-60, 0, 0), v3(60, 0, 0)];

  return {
    name: 'Foundry',
    bounds: { minX, maxX, minZ, maxZ },
    floorColor: 0x7d7a74,
    skyColor: 0xc9d3dc,
    fogColor: 0xb8c2cb,
    boxes: boxes.slice(),
    ramps: ramps.slice(),
    spawns,
    dummies,
    props: [],
    capturePoints,
    labels,
    trainingSpawn,
    style: 'industrial',
  };
}
