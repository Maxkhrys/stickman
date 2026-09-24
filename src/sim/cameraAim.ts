import { WEAPONS } from '../config/weapons';
import { traceShot } from './combat';
import type { SimContext } from './context';
import { eyePos, type Fighter } from './fighter';
import { vdist, vdot, vnorm, vsub, type Vec3 } from './vec';

type TraceContext = { world: SimContext['world']; fighters: readonly Fighter[] };

/**
 * Exact centre-ray convergence, not aim assist. Only geometry actually intersected
 * by this ray can influence the aim. No cone, target selection, sticky state or lead.
 * The client sends the returned angles as ordinary InputCommand angles; combat still
 * originates at the fighter and checks eye/barrel cover. This never mutates the fighter.
 */
export function cameraAimDirection(ctx: TraceContext, f: Fighter, origin: Vec3, direction: Vec3): Vec3 {
  const eye = eyePos(f);
  const dir = vnorm(direction);
  const range = WEAPONS[f.weapons[f.cur].id].range;
  const hit = traceShot(ctx, f, origin, dir, range + vdist(origin, eye));
  const to = vsub(hit.point, eye);
  // A pulled-in shoulder camera can see a surface behind the eye. Never turn the
  // weapon backwards to reach it. The normal eye/barrel obstruction check still runs.
  if (vdot(to, dir) <= 0.15) return dir;
  return vnorm(to);
}
