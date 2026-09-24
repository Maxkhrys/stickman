import type { Fighter } from '../sim/fighter';
import type { MatchInfo, MatchOptions } from '../sim/match';
import type { MapDef } from '../sim/map';
import type { GameEvent, InputCommand } from '../sim/types';
import type { World } from '../sim/world';
import type { PaintGrid } from '../sim/paint';

/**
 * The client talks to "the game" only through this interface. Today it's a LocalAdapter that runs the
 * authoritative Match in-process. Later a WebSocketAdapter implements the same contract:
 *   - sendCommand() -> buffers + sends the command to the server, and applies it to a locally
 *     predicted copy of the player (client-side prediction, reconciled on server snapshots)
 *   - update()     -> processes incoming snapshots, interpolates remote fighters ~100 ms in the past
 *   - drainEvents() -> server events (hits confirmed by lag-compensated hitscan, kills, ...)
 * See ARCHITECTURE.md.
 */
export interface NetworkAdapter {
  readonly localId: number;
  start(opts: MatchOptions): Promise<void>;
  sendCommand(cmd: InputCommand): void;
  /** Advance one fixed tick (local: step the sim; remote: prediction step + packet processing). */
  tick(dt: number): void;
  fighters(): readonly Fighter[];
  info(): MatchInfo;
  map(): MapDef;
  world(): World;
  /** Sketch Slide paint state (read only; null when unavailable) */
  paint(): PaintGrid | null;
  drainEvents(): GameEvent[];
  stop(): void;
}
