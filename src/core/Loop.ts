/**
 * Fixed-timestep simulation (60 Hz) with variable-rate interpolated rendering.
 * Rendering runs at display refresh (144 Hz+). alpha = how far we are between the last two ticks.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;
  /** developer slow motion (sim and presentation together); 1 in normal play */
  timeScale = 1;
  fps = 0;
  frameMs = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly dt: number,
    private readonly tick: () => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  /**
   * Catch-up cap: after a stalled frame we simulate at most this many ticks and drop the rest,
   * so a hitch never turns held fire into a burst of stored-up shots.
   */
  static readonly MAX_CATCHUP = 6;
  ticksLastFrame = 0;
  droppedTime = 0;

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const fdt = (now - this.last) / 1000;
      this.last = now;
      this.advance(fdt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** One display frame: fixed ticks for the elapsed time (capped), then an interpolated render. */
  advance(frameDt: number) {
    const fdt = Math.min(frameDt, 0.25) * this.timeScale; // tab switch / breakpoint
    this.acc += fdt;
    let steps = 0;
    while (this.acc >= this.dt && steps < FixedLoop.MAX_CATCHUP) {
      this.tick();
      this.acc -= this.dt;
      steps++;
    }
    if (this.acc >= this.dt) {
      this.droppedTime += this.acc - (this.acc % this.dt);
      this.acc %= this.dt;
    }
    this.ticksLastFrame = steps;
    const t0 = performance.now();
    this.render(this.acc / this.dt, fdt);
    this.frameMs = performance.now() - t0;
    this.fpsFrames++;
    this.fpsTime += fdt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
