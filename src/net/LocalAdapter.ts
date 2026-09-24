import { Match, type MatchInfo, type MatchOptions } from '../sim/match';
import type { GameEvent, InputCommand } from '../sim/types';
import type { NetworkAdapter } from './NetworkAdapter';

/** Offline "server in the same tab". Owns the authoritative Match. */
export class LocalAdapter implements NetworkAdapter {
  readonly localId = 0;
  private match: Match | null = null;

  async start(opts: MatchOptions): Promise<void> {
    this.match = new Match(opts);
  }

  private get m(): Match {
    if (!this.match) throw new Error('LocalAdapter not started');
    return this.match;
  }

  sendCommand(cmd: InputCommand) {
    this.m.submit(this.localId, cmd);
  }

  tick(dt: number) {
    this.m.step(dt);
  }

  fighters() {
    return this.m.fighters;
  }

  info(): MatchInfo {
    return this.m.info;
  }

  map() {
    return this.m.map;
  }

  world() {
    return this.m.world;
  }

  paint() {
    return this.match?.paint ?? null;
  }

  drainEvents(): GameEvent[] {
    return this.m.drainEvents();
  }

  stop() {
    this.match = null;
  }
}
