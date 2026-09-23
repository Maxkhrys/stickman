/**
 * Fixed-timestep simulation (60 Hz) with variable-rate interpolated rendering.
 * Rendering runs at display refresh (144 Hz+). alpha = how far we are between the last two ticks.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;
  fps = 0;
  frameMs = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(
    private readonly dt: number,
    private readonly tick: () => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      let fdt = (now - this.last) / 1000;
      this.last = now;
      if (fdt > 0.25) fdt = 0.25; // avoid spiral of death after tab switch
      this.acc += fdt;
      let steps = 0;
      while (this.acc >= this.dt && steps < 8) {
        this.tick();
        this.acc -= this.dt;
        steps++;
      }
      if (steps === 8) this.acc = 0;
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
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
