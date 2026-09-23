import type { WeaponId } from '../sim/types';

/**
 * All sounds are synthesised with WebAudio at runtime - no asset files.
 * Buses: weapons (shots, mechanics, reloads) and feedback (hits, kills, UI) under a master bus.
 * Design: every shot = transient click + filtered noise body + sub thump + a mechanical layer.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private weapons!: GainNode;
  private feedback!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private levels = { master: 0.7, weapons: 1, feedback: 1 };

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
      this.weapons = this.ctx.createGain();
      this.feedback = this.ctx.createGain();
      this.weapons.connect(this.master);
      this.feedback.connect(this.master);
      this.master.connect(this.comp).connect(this.ctx.destination);
      this.applyLevels();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setLevels(master: number, weapons: number, feedback: number) {
    this.levels = { master, weapons, feedback };
    this.applyLevels();
  }

  private applyLevels() {
    if (!this.ctx) return;
    this.master.gain.value = this.levels.master;
    this.weapons.gain.value = this.levels.weapons;
    this.feedback.gain.value = this.levels.feedback;
  }

  /** output latency estimate (s) reported by the browser, if available */
  get outputLatency(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return c ? (c.baseLatency ?? 0) + (c.outputLatency ?? 0) : 0;
  }

  private get t() {
    return this.ctx!.currentTime;
  }

  private ok() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private out(bus: 'weapons' | 'feedback', gain: number, pan = 0, lowpass = 20000): AudioNode {
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
    node.connect(bus === 'weapons' ? this.weapons : this.feedback);
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

  /** metallic click (mechanisms) */
  private click(dest: AudioNode, at: number, f: number, g: number) {
    this.noiseBurst(dest, at, 0.035, 'bandpass', f, f * 0.85, 4, g);
    this.tone(dest, at, 0.025, 'square', f / 3.2, f / 4, g * 0.12);
  }

  /** Gunshot. dist in metres (0 = local player), pan -1..1. */
  shot(weapon: WeaponId, dist = 0, pan = 0) {
    if (!this.ok() || weapon === 'melee') return;
    const t = this.t;
    const local = dist === 0;
    const far = Math.min(1, dist / 70);
    const gain = local ? 1 : Math.max(0.05, 0.55 * (1 - far));
    const lp = local ? 20000 : 9000 - far * 7500;
    const o = this.out('weapons', gain, pan, lp);
    if (weapon === 'sniper') {
      this.noiseBurst(o, t, 0.012, 'highpass', 6000, 3500, 0.7, 1.0);
      this.noiseBurst(o, t, 0.4, 'lowpass', 3800, 180, 0.9, 1.0, 0.002);
      this.tone(o, t, 0.28, 'sine', 110, 32, 1.2);
      this.tone(o, t, 0.06, 'square', 700, 160, 0.14);
      this.noiseBurst(o, t + 0.05, 0.9, 'bandpass', 700, 160, 0.5, 0.2, 0.05); // long tail
      if (local) this.tone(o, t + 0.02, 0.5, 'sine', 55, 40, 0.5);
    } else if (weapon === 'smg') {
      this.noiseBurst(o, t, 0.055, 'highpass', 4600, 2200, 0.9, 0.55);
      this.tone(o, t, 0.065, 'triangle', 240, 70, 0.6);
      this.click(o, t + 0.025, 3400, 0.13);
    } else if (weapon === 'carbine') {
      this.noiseBurst(o, t, 0.015, 'highpass', 5500, 3000, 0.8, 0.9);
      this.noiseBurst(o, t, 0.19, 'lowpass', 4200, 280, 1, 0.8);
      this.tone(o, t, 0.18, 'sine', 140, 38, 1.0);
      this.click(o, t + 0.04, 2100, 0.2);
    } else if (weapon === 'pistol') {
      this.noiseBurst(o, t, 0.012, 'highpass', 4500, 3000, 0.7, 0.9);
      this.noiseBurst(o, t, 0.2, 'lowpass', 5200, 320, 0.9, 0.9, 0.002);
      this.tone(o, t, 0.15, 'sine', 180, 42, 1.0);
      this.tone(o, t, 0.045, 'square', 950, 220, 0.12);
      this.noiseBurst(o, t + 0.03, 0.32, 'bandpass', 950, 320, 0.6, 0.1, 0.02);
      if (local) this.click(o, t + 0.045, 3200, 0.18); // slide cycling
    } else {
      this.noiseBurst(o, t, 0.01, 'highpass', 5200, 3000, 0.7, 0.75);
      this.noiseBurst(o, t, 0.12, 'lowpass', 4300, 380, 1.1, 0.75, 0.0015);
      this.tone(o, t, 0.09, 'sine', 150, 46, 0.85);
      this.tone(o, t, 0.028, 'triangle', 1500, 420, 0.13);
      this.noiseBurst(o, t + 0.02, 0.2, 'bandpass', 720, 260, 0.7, 0.07, 0.02);
      if (local) this.click(o, t + 0.03, 2600, 0.08); // bolt carrier
    }
  }

  dryfire(weapon: WeaponId) {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.5);
    this.click(o, this.t, weapon === 'pistol' ? 3600 : 2800, 0.6);
    this.click(o, this.t + 0.06, 2000, 0.25);
  }

  /** start of a reload: magazine release + pull. Seat/tail come from their own events (in sync). */
  reloadStart(weapon: WeaponId, duration: number) {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.5);
    const t = this.t;
    this.click(o, t + duration * 0.12, 2200, 0.5);
    this.noiseBurst(o, t + duration * (weapon === 'pistol' ? 0.1 : 0.16), 0.14, 'bandpass', 1300, 700, 1, 0.16, 0.02);
    this.noiseBurst(o, t + duration * 0.42, 0.1, 'bandpass', 900, 600, 1, 0.1, 0.02);
  }

  /** magazine seats (exactly when ammo refills) */
  reloadInsert(weapon: WeaponId) {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.7);
    const t = this.t;
    this.click(o, t, weapon === 'pistol' ? 2600 : 1800, 0.8);
    this.tone(o, t, 0.06, 'sine', 180, 90, 0.25);
    this.click(o, t + 0.03, 3000, 0.3);
  }

  reloadDone(weapon: WeaponId) {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.45);
    this.click(o, this.t, weapon === 'pistol' ? 3400 : 1500, 0.5);
    this.click(o, this.t + 0.05, 2400, 0.3);
  }

  /** bolt cycle: lift, pull, push, lock (spread over the cycle time) */
  bolt(duration = 0.78) {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.6);
    const t = this.t;
    this.click(o, t + duration * 0.16, 1700, 0.55);
    this.noiseBurst(o, t + duration * 0.3, 0.13, 'bandpass', 2600, 1300, 2, 0.3, 0.01);
    this.click(o, t + duration * 0.46, 2300, 0.4);
    this.noiseBurst(o, t + duration * 0.52, 0.12, 'bandpass', 1400, 2600, 2, 0.28, 0.01);
    this.click(o, t + duration * 0.72, 1300, 0.7);
  }

  switchWeapon() {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.3);
    this.noiseBurst(o, this.t, 0.05, 'bandpass', 1800, 1500, 2, 0.5);
    this.click(o, this.t + 0.06, 2600, 0.35);
  }

  // ---------------- feedback (distinct per result) ----------------
  /** body hit: short dry tick */
  hitBody() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.55);
    const t = this.t;
    this.noiseBurst(o, t, 0.028, 'highpass', 5200, 4200, 0.8, 0.55);
    this.tone(o, t, 0.045, 'square', 1150, 1050, 0.1);
  }

  /** headshot: bright metallic "tink" with a ring - unmistakable */
  hitHead() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.6);
    const t = this.t;
    this.noiseBurst(o, t, 0.02, 'highpass', 7000, 6000, 1, 0.5);
    this.tone(o, t, 0.5, 'sine', 2093, 2093, 0.33);
    this.tone(o, t, 0.34, 'sine', 3136, 3136, 0.2);
    this.tone(o, t, 0.2, 'triangle', 4186, 4000, 0.12);
  }

  /** elimination: ink splat + rising chime (headshot kills add a sparkle) */
  kill(headshot: boolean) {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.55);
    const t = this.t + 0.02;
    this.noiseBurst(o, t, 0.16, 'lowpass', 1600, 250, 1, 0.5, 0.004);
    this.tone(o, t, 0.12, 'triangle', 660, 660, 0.36);
    this.tone(o, t + 0.07, 0.24, 'triangle', 990, 990, 0.36);
    if (headshot) this.tone(o, t + 0.14, 0.32, 'triangle', 1320, 1320, 0.28);
    this.tone(o, t, 0.2, 'sine', 90, 50, 0.6);
  }

  /** hit absorbed by spawn protection */
  blocked() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.35);
    this.tone(o, this.t, 0.08, 'square', 420, 380, 0.08);
  }

  hurt() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.7);
    const t = this.t;
    this.tone(o, t, 0.18, 'sine', 120, 50, 0.9);
    this.noiseBurst(o, t, 0.12, 'lowpass', 900, 200, 1, 0.5);
  }

  footstep(dist = 0, pan = 0) {
    if (!this.ok()) return;
    const g = dist === 0 ? 0.2 : Math.max(0, 0.3 * (1 - dist / 25));
    if (g <= 0.01) return;
    const o = this.out('weapons', g, pan);
    const t = this.t;
    this.noiseBurst(o, t, 0.07, 'lowpass', 1400 + Math.random() * 600, 200, 1.2, 0.8, 0.003);
    this.tone(o, t, 0.05, 'sine', 90, 60, 0.3);
  }

  jump() {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.16);
    this.noiseBurst(o, this.t, 0.08, 'bandpass', 800, 1400, 1, 0.5);
  }

  land(speed: number) {
    if (!this.ok()) return;
    const o = this.out('weapons', Math.min(0.6, 0.12 + speed / 40));
    this.noiseBurst(o, this.t, 0.12, 'lowpass', 1100, 150, 1, 0.8);
    this.tone(o, this.t, 0.1, 'sine', 80, 40, 0.6);
  }

  slide() {
    if (!this.ok()) return;
    const o = this.out('weapons', 0.25);
    this.noiseBurst(o, this.t, 0.55, 'bandpass', 2500, 600, 0.8, 0.5, 0.03);
  }

  swing(heavy: boolean) {
    if (!this.ok()) return;
    const o = this.out('weapons', heavy ? 0.45 : 0.3);
    this.noiseBurst(o, this.t + (heavy ? 0.28 : 0), heavy ? 0.25 : 0.16, 'bandpass', 600, 3500, 1.5, 0.7, 0.04);
  }

  meleeHit() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.7);
    this.tone(o, this.t, 0.15, 'sine', 160, 50, 1);
    this.noiseBurst(o, this.t, 0.1, 'lowpass', 2500, 300, 1, 0.8);
  }

  impact(dist: number, pan: number) {
    if (!this.ok() || dist > 40) return;
    const o = this.out('weapons', 0.12 * (1 - dist / 40), pan);
    this.noiseBurst(o, this.t, 0.04, 'bandpass', 3000 + Math.random() * 2000, 1500, 2, 0.6);
  }

  ui() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.25);
    this.tone(o, this.t, 0.06, 'triangle', 880, 1320, 0.4);
  }

  protectEnd() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.2);
    this.tone(o, this.t, 0.1, 'triangle', 1200, 700, 0.3);
  }

  matchEnd() {
    if (!this.ok()) return;
    const o = this.out('feedback', 0.5);
    const t = this.t;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.12, 0.35, 'triangle', f, f, 0.35));
  }
}
