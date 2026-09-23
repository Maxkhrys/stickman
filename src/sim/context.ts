import type { Fighter } from './fighter';
import type { GameEvent } from './types';
import type { World } from './world';

/** What sim subsystems (combat, weapons, bots) need from the match. Keeps modules decoupled. */
export interface SimContext {
  time: number;
  rng: () => number;
  world: World;
  fighters: Fighter[];
  events: GameEvent[];
  onDamaged(victim: Fighter, attacker: Fighter): void;
  onKilled(victim: Fighter, killer: Fighter): void;
  /** bots ask before shooting at a human (limits simultaneous attackers); absent = always allowed */
  requestAttack?(bot: Fighter, target: Fighter): boolean;
}
