/**
 * All sounds are synthesised with WebAudio at runtime - no asset files.
 * Design goal: punchy, short, readable. Every shot = transient click + filtered noise body + sub thump.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private volume = 0.7;

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -10;
      this.comp.knee.value = 6;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.002;
      this.comp.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  /** Output node with gain + stereo pan + optional distance low-pass. */
  private out(gain: number, pan = 0, lowpass = 20000): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    let node: AudioNode = g;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    if (lowpass < 20000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(this.master);
    return g;
  }

  private noiseBurst(dest: AudioNode, start: number, dur: number, type: BiquadFilterType, freq: number, freqEnd: number, q: number, gain: number, attack = 0.001) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, start);
    f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(start, Math.random() * 0.5);
    src.stop(start + dur + 0.02);
  }

  private tone(dest: AudioNode, start: number, dur: number, type: OscillatorType, f0: number, f1: number, gain: number, attack = 0.002) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private ok() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Gunshot. dist in metres (0 = local player), pan -1..1. */
  shot(weapon: string, dist = 0, pan = 0) {
    if (!this.ok() || weapon === 'melee') return;
    const t = this.t;
    const far = Math.min(1, dist / 60);
    const gain = dist === 0 ? 1 : Math.max(0.06, 0.55 * (1 - far));
    const lp = dist === 0 ? 20000 : 9000 - far * 7500;
    const o = this.out(gain, pan, lp);
    if (weapon === 'pistol') {
      this.noiseBurst(o, t, 0.012, 'highpass', 4000, 3000, 0.7, 0.9);
      this.noiseBurst(o, t, 0.22, 'lowpass', 5200, 300, 0.9, 0.9, 0.002);
      this.tone(o, t, 0.16, 'sine', 170, 40, 1.0);
      this.tone(o, t, 0.05, 'square', 900, 200, 0.12);
      this.noiseBurst(o, t + 0.03, 0.35, 'bandpass', 900, 300, 0.6, 0.12, 0.02); // tail
    } else {
      this.noiseBurst(o, t, 0.01, 'highpass', 5000, 3000, 0.7, 0.7);
      this.noiseBurst(o, t, 0.13, 'lowpass', 4200, 350, 1.1, 0.75, 0.0015);
      this.tone(o, t, 0.1, 'sine', 140, 45, 0.85);
      this.tone(o, t, 0.03, 'triangle', 1400, 400, 0.12);
      this.noiseBurst(o, t + 0.02, 0.22, 'bandpass', 700, 250, 0.7, 0.08, 0.02);
    }
  }

  hitmarker() {
    if (!this.ok()) return;
    const o = this.out(0.55);
    const t = this.t;
    this.noiseBurst(o, t, 0.03, 'highpass', 5000, 4000, 0.8, 0.6);
    this.tone(o, t, 0.05, 'square', 1250, 1150, 0.12);
  }

  /** Crisp metallic "tink" + ring - the most satisfying sound in the game. */
  headshot() {
    if (!this.ok()) return;
    const o = this.out(0.6);
    const t = this.t;
    this.noiseBurst(o, t, 0.02, 'highpass', 7000, 6000, 1, 0.5);
    this.tone(o, t, 0.5, 'sine', 2093, 2093, 0.35);
    this.tone(o, t, 0.35, 'sine', 3136, 3136, 0.2);
    this.tone(o, t, 0.2, 'triangle', 4186, 4000, 0.12);
    this.tone(o, t + 0.005, 0.08, 'square', 1600, 1400, 0.06);
  }

  kill(headshot: boolean) {
    if (!this.ok()) return;
    const o = this.out(0.5);
    const t = this.t + 0.03;
    this.tone(o, t, 0.12, 'triangle', 660, 660, 0.4);
    this.tone(o, t + 0.07, 0.22, 'triangle', 990, 990, 0.4);
    if (headshot) this.tone(o, t + 0.14, 0.3, 'triangle', 1320, 1320, 0.3);
    this.tone(o, t, 0.18, 'sine', 90, 50, 0.7);
  }

  hurt() {
    if (!this.ok()) return;
    const o = this.out(0.7);
    const t = this.t;
    this.tone(o, t, 0.18, 'sine', 120, 50, 0.9);
    this.noiseBurst(o, t, 0.12, 'lowpass', 900, 200, 1, 0.5);
  }

  footstep(dist = 0, pan = 0) {
    if (!this.ok()) return;
    const g = dist === 0 ? 0.22 : Math.max(0, 0.3 * (1 - dist / 25));
    if (g <= 0.01) return;
    const o = this.out(g, pan);
    const t = this.t;
    this.noiseBurst(o, t, 0.07, 'lowpass', 1400 + Math.random() * 600, 200, 1.2, 0.8, 0.003);
    this.tone(o, t, 0.05, 'sine', 90, 60, 0.3);
  }

  jump() {
    if (!this.ok()) return;
    const o = this.out(0.18);
    this.noiseBurst(o, this.t, 0.08, 'bandpass', 800, 1400, 1, 0.5);
  }

  land(speed: number) {
    if (!this.ok()) return;
    const o = this.out(Math.min(0.6, 0.12 + speed / 40));
    const t = this.t;
    this.noiseBurst(o, t, 0.12, 'lowpass', 1100, 150, 1, 0.8);
    this.tone(o, t, 0.1, 'sine', 80, 40, 0.6);
  }

  slide() {
    if (!this.ok()) return;
    const o = this.out(0.25);
    this.noiseBurst(o, this.t, 0.55, 'bandpass', 2500, 600, 0.8, 0.5, 0.03);
  }

  /** Reload foley timed to the viewmodel animation (mag out 20%, in 70%, rack 85%). */
  reload(weapon: string, duration: number) {
    if (!this.ok()) return;
    const o = this.out(0.45);
    const t = this.t;
    const click = (at: number, f: number, g: number) => {
      this.noiseBurst(o, t + at, 0.04, 'bandpass', f, f * 0.8, 3, g);
      this.tone(o, t + at, 0.03, 'square', f / 3, f / 4, g * 0.15);
    };
    click(duration * 0.2, 2200, 0.5);
    this.noiseBurst(o, t + duration * 0.25, 0.12, 'bandpass', 1200, 700, 1, 0.15, 0.02);
    click(duration * 0.68, 1700, 0.7);
    click(duration * 0.72, 2600, 0.5);
    if (weapon === 'ar') {
      click(duration * 0.84, 1300, 0.6);
      click(duration * 0.9, 2000, 0.7);
    } else click(duration * 0.86, 2400, 0.6);
  }

  dryfire() {
    if (!this.ok()) return;
    const o = this.out(0.4);
    this.noiseBurst(o, this.t, 0.03, 'bandpass', 3000, 2500, 4, 0.6);
  }

  switchWeapon() {
    if (!this.ok()) return;
    const o = this.out(0.3);
    const t = this.t;
    this.noiseBurst(o, t, 0.05, 'bandpass', 1800, 1500, 2, 0.5);
    this.noiseBurst(o, t + 0.06, 0.04, 'bandpass', 2600, 2200, 3, 0.4);
  }

  swing(heavy: boolean) {
    if (!this.ok()) return;
    const o = this.out(heavy ? 0.45 : 0.3);
    this.noiseBurst(o, this.t + (heavy ? 0.28 : 0), heavy ? 0.25 : 0.16, 'bandpass', 600, 3500, 1.5, 0.7, 0.04);
  }

  meleeHit() {
    if (!this.ok()) return;
    const o = this.out(0.7);
    const t = this.t;
    this.tone(o, t, 0.15, 'sine', 160, 50, 1);
    this.noiseBurst(o, t, 0.1, 'lowpass', 2500, 300, 1, 0.8);
  }

  impact(dist: number, pan: number) {
    if (!this.ok() || dist > 40) return;
    const o = this.out(0.12 * (1 - dist / 40), pan);
    this.noiseBurst(o, this.t, 0.04, 'bandpass', 3000 + Math.random() * 2000, 1500, 2, 0.6);
  }

  ui() {
    if (!this.ok()) return;
    const o = this.out(0.25);
    this.tone(o, this.t, 0.06, 'triangle', 880, 1320, 0.4);
  }

  matchEnd() {
    if (!this.ok()) return;
    const o = this.out(0.5);
    const t = this.t;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.12, 0.35, 'triangle', f, f, 0.35));
  }
}
