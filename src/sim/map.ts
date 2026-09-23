import { v3, yawTo, type Vec3 } from './vec';

export interface Box {
  min: Vec3;
  max: Vec3;
  color: number;
}

/** Solid wedge. Height goes linearly from h0 at the low coordinate (x0 / z0) to h1 at x1 / z1. */
export interface Ramp {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  axis: 'x' | 'z';
  h0: number;
  h1: number;
  color: number;
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface DummyDef {
  pos: Vec3;
  yaw: number;
  /** strafe amplitude pattern: 0 = static */
  strafe: number;
  period: number;
  crouch?: boolean;
  jump?: boolean;
}

export interface MapDef {
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorColor: number;
  skyColor: number;
  fogColor: number;
  boxes: Box[];
  ramps: Ramp[];
  spawns: SpawnPoint[];
  dummies: DummyDef[];
  props: Prop[];
  capturePoints?: Vec3[];
  labels?: { pos: Vec3; text: string }[];
}

// ---- palette (Krunker-ish bright flats) ----
// Notebook-doodle palette: paper whites + loud stationery colours.
export const C = {
  wall: 0xf3efe6, // paper
  wallDark: 0xe2dccd,
  blue: 0x5b8cff, // ink blue
  teal: 0x22c6e0, // cyan highlighter
  orange: 0xffd23f, // yellow highlighter
  crate: 0xff4f9a, // pink eraser
  crateDark: 0x8b5cf6, // purple
  red: 0xff4f9a,
  yellow: 0xffc93c, // ruler
  purple: 0x8b5cf6,
  green: 0x3ddc84,
  grey: 0x9aa0a8,
};

/** Decorative-but-solid stationery props (rendered specially, collide as a box). */
export interface Prop {
  kind: 'pencil';
  x: number;
  z: number;
  h: number;
  r: number;
  color: number;
}

/** Box helper: centre x/z, width (x), depth (z), height, colour, base y. */
function B(cx: number, cz: number, w: number, d: number, h: number, color: number, y0 = 0): Box {
  return { min: v3(cx - w / 2, y0, cz - d / 2), max: v3(cx + w / 2, y0 + h, cz + d / 2), color };
}

function spawn(x: number, z: number, lookX = 0, lookZ = 0): SpawnPoint {
  return { pos: v3(x, 0, z), yaw: yawTo(lookX - x, lookZ - z) };
}

function mirrorX(boxes: Box[]): Box[] {
  return boxes.map((b) => ({ min: v3(-b.max.x, b.min.y, b.min.z), max: v3(-b.min.x, b.max.y, b.max.z), color: b.color }));
}
function mirrorZ(boxes: Box[]): Box[] {
  return boxes.map((b) => ({ min: v3(b.min.x, b.min.y, -b.max.z), max: v3(b.max.x, b.max.y, -b.min.z), color: b.color }));
}

// ============================================================================
//  ARENA "CROSSFIRE": 3 lanes (north open lane / mid tower / south catwalk),
//  connected by gaps in the dividers for flanks. Spawn plazas at both ends.
//  92 x 60 metres - sized for 1v6 FFA.
// ============================================================================
function buildArena(): MapDef {
  const boxes: Box[] = [];
  const ramps: Ramp[] = [];

  // outer walls
  boxes.push(B(0, -30.5, 94, 1, 7, C.wall));
  boxes.push(B(0, 30.5, 94, 1, 7, C.wall));
  boxes.push(B(-46.5, 0, 1, 62, 7, C.wall));
  boxes.push(B(46.5, 0, 1, 62, 7, C.wall));

  // lane dividers with flank gaps at |x| in 14..20 and centre
  for (const z of [-8, 8]) {
    boxes.push(B(-27, z, 14, 1, 3.2, C.blue));
    boxes.push(B(-9, z, 10, 1, 3.2, C.blue));
    boxes.push(B(9, z, 10, 1, 3.2, C.blue));
    boxes.push(B(27, z, 14, 1, 3.2, C.blue));
  }

  // ---- MID LANE ----
  // central tower + ramps from both sides
  boxes.push(B(0, 0, 8, 6, 2.4, C.teal));
  ramps.push({ x0: -10, x1: -4, z0: -1.5, z1: 1.5, axis: 'x', h0: 0, h1: 2.4, color: C.yellow });
  ramps.push({ x0: 4, x1: 10, z0: -1.5, z1: 1.5, axis: 'x', h0: 2.4, h1: 0, color: C.yellow });
  boxes.push(B(0, -2.2, 1.2, 1.2, 1.0, C.crate, 2.4)); // cover on the tower
  boxes.push(B(0, 2.2, 1.2, 1.2, 1.0, C.crate, 2.4));
  const midSide = [
    B(-16, 3, 2, 2, 1.2, C.crate),
    B(-16, -3.8, 1.2, 1.2, 1.2, C.crateDark),
    B(-25, 0, 1, 4.5, 1.3, C.wallDark),
    B(-33, -4, 2, 2, 2, C.orange),
  ];
  boxes.push(...midSide, ...mirrorZ(mirrorX(midSide)));

  // ---- NORTH LANE (z < -8): open, crate clusters, long cover wall ----
  const north = [
    B(-30, -20, 2, 2, 2, C.crate),
    B(-28.3, -20, 1.4, 1.4, 1.2, C.crateDark),
    B(-19, -14, 1.2, 1.2, 1.2, C.crate),
    B(-12, -19, 1, 8, 2.2, C.wallDark),
    B(-4, -24, 3, 3, 1.2, C.crate),
    B(-4, -24, 1.4, 1.4, 1.1, C.crateDark, 1.2),
    B(-5, -14, 2, 2, 2, C.orange),
  ];
  boxes.push(...north, ...mirrorX(north));
  boxes.push(B(0, -19, 6, 1, 1.3, C.wallDark)); // low wall centre-north

  // ---- SOUTH LANE (z > 8): catwalk at y=3 along the back wall ----
  boxes.push(B(0, 26, 48, 3, 0.4, C.red, 2.6));
  ramps.push({ x0: -32, x1: -24, z0: 24.5, z1: 27.5, axis: 'x', h0: 0, h1: 3.0, color: C.yellow });
  ramps.push({ x0: 24, x1: 32, z0: 24.5, z1: 27.5, axis: 'x', h0: 3.0, h1: 0, color: C.yellow });
  for (const x of [-12, 12]) boxes.push(B(x, 26, 0.8, 0.8, 2.6, C.wallDark)); // pillars
  for (const x of [-14, 14]) boxes.push(B(x, 24.65, 10, 0.3, 0.8, C.red, 3.0)); // railings
  const south = [
    B(-15, 14, 2, 2, 1.2, C.crate),
    B(-7, 17.5, 1.2, 1.2, 1.2, C.crateDark),
    B(-23, 15, 1, 5, 2.2, C.wallDark),
    B(-33, 18, 2, 2, 2, C.orange),
  ];
  boxes.push(...south, ...mirrorX(south));
  boxes.push(B(0, 14, 3, 2, 2, C.orange));
  boxes.push(B(0, 14, 1.3, 1.3, 1.0, C.crate, 2));

  // ---- corner perches (NW / NE) with ramps ----
  const perch = [B(-40, -26, 6, 7, 2.5, C.purple)];
  boxes.push(...perch, ...mirrorX(perch));
  ramps.push({ x0: -42, x1: -38, z0: -22.5, z1: -16.5, axis: 'z', h0: 2.5, h1: 0, color: C.yellow });
  ramps.push({ x0: 38, x1: 42, z0: -22.5, z1: -16.5, axis: 'z', h0: 2.5, h1: 0, color: C.yellow });

  // ---- spawn plazas ----
  const plaza = [B(-40, 2, 2, 2, 1.2, C.crate), B(-41.5, 10, 1.2, 1.2, 1.2, C.crateDark), B(-38, -8, 1.2, 3, 1.3, C.wallDark)];
  boxes.push(...plaza, ...mirrorZ(mirrorX(plaza)));

  // giant pencil pillars (cover + landmarks)
  const props: Prop[] = [];
  const pencil = (x: number, z: number, h: number, color = 0xffc93c) => {
    props.push({ kind: 'pencil', x, z, h, r: 0.75, color });
    boxes.push(B(x, z, 1.3, 1.3, h, color));
  };
  pencil(-20, -22, 7.5);
  pencil(20, -22, 6.5, 0x5b8cff);
  pencil(-20, -4.5, 6);
  pencil(20, 4.5, 6);
  pencil(-35, 21, 8, 0x3ddc84);
  pencil(35, -12, 7);
  pencil(0, -12.5, 5.5, 0xff4f9a);
  // pink trim along the tops of the paper walls
  boxes.push(B(0, -29.9, 92, 0.25, 0.5, C.red, 6.5), B(0, 29.9, 92, 0.25, 0.5, C.red, 6.5));
  boxes.push(B(-45.9, 0, 0.25, 60, 0.5, C.red, 6.5), B(45.9, 0, 0.25, 60, 0.5, C.red, 6.5));

  const spawns = [
    spawn(-43, -4),
    spawn(-43, 6),
    spawn(-42, 14),
    spawn(43, 4),
    spawn(43, -6),
    spawn(42, -12),
    spawn(-22, -25),
    spawn(22, -25),
    spawn(-18, 20),
    spawn(18, 20),
    spawn(-30, 4),
    spawn(30, -4),
    spawn(0, -26),
    spawn(0, 20),
  ];

  return {
    name: 'Crossfire',
    bounds: { minX: -46, maxX: 46, minZ: -30, maxZ: 30 },
    floorColor: 0xf6f3ec,
    skyColor: 0xfbf8f1,
    fogColor: 0xf3efe6,
    boxes,
    ramps,
    spawns,
    dummies: [],
    props,
  };
}

// ============================================================================
//  GUN RANGE: shooting lanes with distance markers + a movement playground.
// ============================================================================
function buildRange(): MapDef {
  const boxes: Box[] = [];
  const ramps: Ramp[] = [];
  const W = 36;
  boxes.push(B(0, -86.5, W + 2, 1, 8, C.wall));
  boxes.push(B(0, 14.5, W + 2, 1, 8, C.wall));
  boxes.push(B(-W / 2 - 0.5, -36, 1, 102, 8, C.wall));
  boxes.push(B(W / 2 + 0.5, -36, 1, 102, 8, C.wall));

  // firing line counter
  boxes.push(B(-3, -2, 10, 0.4, 0.06, C.red)); // firing line
  // distance markers
  const labels: { pos: Vec3; text: string }[] = [];
  boxes.push(B(-15, -40, 1.3, 1.3, 7, 0xffc93c), B(15, -8, 1.3, 1.3, 6, 0x5b8cff));
  for (const d of [10, 20, 30, 50, 75]) {
    boxes.push(B(-10.5, -d, 1, 0.3, 0.12, C.yellow));
    boxes.push(B(3.5, -d, 1, 0.3, 0.12, C.yellow));
    labels.push({ pos: v3(-10.5, 0.8, -d), text: `${d}m` });
  }
  boxes.push(B(-4, -83, 18, 1, 6, C.teal)); // backstop

  // movement playground on the right side (x 6..17)
  boxes.push(B(9, -12, 1.2, 1.2, 1.2, C.crate));
  boxes.push(B(11.5, -15, 2, 2, 2, C.orange));
  boxes.push(B(14, -18, 2, 2, 2.8, C.purple));
  ramps.push({ x0: 7, x1: 11, z0: -30, z1: -24, axis: 'z', h0: 2.4, h1: 0, color: C.yellow });
  boxes.push(B(9, -34, 4, 8, 2.4, C.teal));
  ramps.push({ x0: 7, x1: 11, z0: -46, z1: -38, axis: 'z', h0: 0, h1: 2.4, color: C.yellow });
  boxes.push(B(15, -42, 3, 26, 0.3, C.red, 3.2)); // catwalk
  ramps.push({ x0: 13.5, x1: 16.5, z0: -29, z1: -21, axis: 'z', h0: 3.5, h1: 0, color: C.yellow });
  for (let i = 0; i < 5; i++) boxes.push(B(10, -54 - i * 5, 1.5, 1.5, 0.6 + (i % 2) * 0.6, C.crate));

  const dummies = [
    { pos: v3(-6, 0, -10), yaw: 0, strafe: 0, period: 1 },
    { pos: v3(-2, 0, -20), yaw: 0, strafe: 0, period: 1, crouch: true },
    { pos: v3(-6, 0, -30), yaw: 0, strafe: 1, period: 1.6 },
    { pos: v3(0, 0, -30), yaw: Math.PI, strafe: 0, period: 1 },
    { pos: v3(-4, 0, -50), yaw: 0, strafe: 1, period: 2.2, jump: true },
    { pos: v3(-8, 0, -75), yaw: 0, strafe: 0, period: 1 },
    { pos: v3(-2, 0, -14), yaw: 0, strafe: 1, period: 0.9 },
  ];

  return {
    name: 'Gun Range',
    bounds: { minX: -W / 2, maxX: W / 2, minZ: -86, maxZ: 14 },
    floorColor: 0xf2eee4,
    skyColor: 0xfbf8f1,
    fogColor: 0xf3efe6,
    boxes,
    ramps,
    spawns: [spawn(-3, 3, -3, -30)],
    dummies,
    props: [
      { kind: 'pencil', x: -15, z: -40, h: 7, r: 0.75, color: 0xffc93c },
      { kind: 'pencil', x: 15, z: -8, h: 6, r: 0.75, color: 0x5b8cff },
    ],
    labels,
  };
}

/** Three lanes around a low central plaza. Book stacks break long diagonals;
 * parallel ruler walks reconnect the side routes without trapping spawns. */
function buildBookyard(): MapDef {
  const boxes: Box[] = [
    B(0, -25.5, 74, 1, 6, C.wall), B(0, 25.5, 74, 1, 6, C.wall),
    B(-36.5, 0, 1, 52, 6, C.wall), B(36.5, 0, 1, 52, 6, C.wall),
  ];
  const ramps: Ramp[] = [];
  for (const side of [-1, 1]) {
    for (const x of [-24, -10, 10, 24]) {
      boxes.push(B(x, side * 8, 8, 2, 3.4, side > 0 ? C.blue : C.green));
      boxes.push(B(x + 0.25, side * 8, 7.8, 2.1, 0.18, C.wall, 1.45));
    }
    for (const x of [-27, 27]) boxes.push(B(x, side * 19, 3.5, 2.4, 1.2, C.crate));
    // Solid elevated walks keep collision, visibility and the waypoint graph consistent.
    boxes.push(B(0, side * 18, 16, 3, 2, C.yellow));
    ramps.push({ x0: -16, x1: -8, z0: side * 18 - 1.5, z1: side * 18 + 1.5, axis: 'x', h0: 0, h1: 2, color: C.yellow });
    ramps.push({ x0: 8, x1: 16, z0: side * 18 - 1.5, z1: side * 18 + 1.5, axis: 'x', h0: 2, h1: 0, color: C.yellow });
    boxes.push(B(side * 10, 0, 2, 3, 1.25, C.teal));
    boxes.push(B(side * 30, 1, 2, 5, 2.6, C.orange));
  }
  return {
    name: 'Bookyard', bounds: { minX: -36, maxX: 36, minZ: -25, maxZ: 25 },
    floorColor: 0xf0ede4, skyColor: 0xe1f2ee, fogColor: 0xe1f2ee,
    boxes, ramps, props: [], dummies: [],
    spawns: [spawn(-33, -20), spawn(-33, 20), spawn(33, -20), spawn(33, 20), spawn(-20, 22), spawn(20, -22), spawn(-33, 0), spawn(33, 0)],
    capturePoints: [v3(0, 0, 0), v3(-21, 0, 15), v3(21, 0, -15)],
    labels: [{ pos: v3(0, 5, -25), text: 'BOOKYARD' }, { pos: v3(0, 2.02, 18), text: 'RULER WALK' }],
  };
}

export const MAPS = {
  arena: { ...buildArena(), capturePoints: [v3(0, 2.4, 0), v3(-18, 0, -20), v3(18, 0, 20)] },
  bookyard: buildBookyard(),
  range: buildRange(),
};
