import type { World } from '../sim/world';
import { v3, type Vec3 } from '../sim/vec';

/** Sweep a small camera volume. Sampling is tighter than its diameter so thin walls cannot be skipped. */
export function clipCamera(world: World, pivot: Vec3, desired: Vec3): Vec3 {
  const dx = desired.x - pivot.x, dy = desired.y - pivot.y, dz = desired.z - pivot.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return v3(pivot.x, pivot.y, pivot.z);
  const steps = Math.ceil(len / 0.08);
  let safe = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = pivot.x + dx * t, y = pivot.y + dy * t, z = pivot.z + dz * t;
    if (y < 0.15 || !world.isClear(x, y - 0.14, z, 0.14, 0.28)) break;
    safe = t;
  }
  return v3(pivot.x + dx * safe, pivot.y + dy * safe, pivot.z + dz * safe);
}
