/**
 * Generative ambient audio — no asset files.
 * Drone (A2 sine + E3 triangle → speed-swept lowpass), pink-noise tyre/wind
 * whisper (bandpass, gain follows slip) and pentatonic apex chimes into a
 * ping-pong feedback delay.
 */

const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
const MASTER_LEVEL = 0.9;

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  private send: GainNode | null = null;
  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture (creates or resumes the context). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(muted ? 0 : MASTER_LEVEL, now + 0.15);
  }

  private build(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;
    // Gentle fade-in on first unlock.
    master.gain.linearRampToValueAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime + 1.2);

    // ── Drone ──
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    filter.Q.value = 0.7;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.5;
    filter.connect(droneGain).connect(master);
    this.droneFilter = filter;

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 110;
    o1.detune.value = -4;
    const g1 = ctx.createGain();
    g1.gain.value = 0.11;
    o1.connect(g1).connect(filter);

    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 164.81;
    o2.detune.value = 5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.045;
    o2.connect(g2).connect(filter);
    o1.start();
    o2.start();

    // ── Silk tyre / wind whisper ──
    const noise = ctx.createBufferSource();
    noise.buffer = this.pinkNoise(ctx, 2);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 600;
    band.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = 0;
    noise.connect(band).connect(ng).connect(master);
    noise.start();
    this.noiseGain = ng;
    this.noiseBuf = noise.buffer;

    // ── Engine: two detuned saws through a soft clipper and a lowpass ──
    const eA = ctx.createOscillator();
    const eB = ctx.createOscillator();
    eA.type = 'sawtooth';
    eB.type = 'sawtooth';
    eA.frequency.value = 60;
    eB.frequency.value = 120.5;
    const eBGain = ctx.createGain();
    eBGain.gain.value = 0.45;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 500;
    ef.Q.value = 2.5;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    eA.connect(shaper);
    eB.connect(eBGain).connect(shaper);
    shaper.connect(ef).connect(eg).connect(master);
    eA.start();
    eB.start();
    this.engineA = eA;
    this.engineB = eB;
    this.engineFilter = ef;
    this.engineGain = eg;

    // ── Stereo ping-pong delay for chimes ──
    const send = ctx.createGain();
    send.gain.value = 1;
    const dL = ctx.createDelay(1);
    const dR = ctx.createDelay(1);
    dL.delayTime.value = 0.24;
    dR.delayTime.value = 0.24;
    const fbLR = ctx.createGain();
    const fbRL = ctx.createGain();
    fbLR.gain.value = 0.25;
    fbRL.gain.value = 0.25;
    const merger = ctx.createChannelMerger(2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    send.connect(dL);
    dL.connect(fbLR).connect(dR);
    dR.connect(fbRL).connect(dL);
    dL.connect(merger, 0, 0);
    dR.connect(merger, 0, 1);
    merger.connect(wet).connect(master);
    this.send = send;
  }

  private pinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Paul Kellet's refined pink-noise filter.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // Crossfade the loop seam.
    const fade = Math.min(2048, len >> 2);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * t + d[len - fade + i] * (1 - t);
    }
    return buf;
  }

  /** speedNorm 0…1, slip = |lateral velocity| px/s. */
  /** Engine voice: speed in px/s, gears give the arcade "shift" feel. */
  engine(speed: number, active: boolean, nitro: boolean): void {
    if (!this.ctx || !this.engineA || !this.engineB || !this.engineFilter || !this.engineGain) return;
    const now = this.ctx.currentTime;
    const gears = [0, 240, 320, 400, 480, 1000];
    let g = 1;
    while (g < gears.length - 1 && speed > gears[g]) g++;
    const lo = gears[g - 1];
    const hi = gears[g];
    const rpm = Math.max(0, Math.min(1, (speed - lo) / (hi - lo)));
    const f = (48 + g * 6 + rpm * 70) * (nitro ? 1.12 : 1);
    this.engineA.frequency.setTargetAtTime(f, now, 0.05);
    this.engineB.frequency.setTargetAtTime(f * 2.01, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(380 + rpm * 900 + (nitro ? 600 : 0), now, 0.06);
    this.engineGain.gain.setTargetAtTime(active ? 0.03 + rpm * 0.02 + (nitro ? 0.02 : 0) : 0.012, now, 0.1);
  }

  private burst(dur: number, from: number, to: number, q: number, level: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  }

  private thump(freq: number, dur: number, level: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  crash(): void {
    this.burst(0.5, 1800, 300, 0.8, 0.5);
    this.thump(90, 0.35, 0.4);
  }

  /** Doppler-ish whoosh for a close pass. */
  nearMiss(): void {
    this.burst(0.32, 2600, 500, 3, 0.28);
  }

  takedown(): void {
    this.burst(0.6, 2200, 250, 0.7, 0.45);
    this.thump(70, 0.45, 0.45);
    setTimeout(() => this.chime(7), 60);
  }

  pickup(): void {
    [4, 6, 9].forEach((st, i) => setTimeout(() => this.blip(st, 0.07), i * 55));
  }

  update(speedNorm: number, slip: number, onRoad: boolean): void {
    if (!this.ctx || !this.droneFilter || !this.noiseGain) return;
    const now = this.ctx.currentTime;
    this.droneFilter.frequency.setTargetAtTime(160 + 260 * speedNorm, now, 0.12);
    const slipAmt = Math.min(1, Math.max(0, (slip - 10) / 70));
    const base = 0.012 + speedNorm * 0.012;
    const level = onRoad ? base + slipAmt * 0.12 : base + 0.05;
    this.noiseGain.gain.setTargetAtTime(level, now, 0.08);
  }

  private scale(step: number): number {
    const n = PENTATONIC.length;
    const octave = Math.floor(step / n);
    return PENTATONIC[((step % n) + n) % n] * Math.pow(2, Math.max(-1, Math.min(1, octave)));
  }

  /** Short glassy pluck (orb pickups climb the scale within a chain). */
  blip(step: number, level = 0.07): void {
    if (!this.ctx || !this.master || !this.send) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;
    const f = this.scale(step + 5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    env.connect(this.master);
    env.connect(this.send);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(env);
    o.start(t);
    o.stop(t + 0.3);
    o.onended = () => env.disconnect();
  }

  /** Airy whoosh with a soft low thump. */
  boost(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.002;
    const src = ctx.createBufferSource();
    src.buffer = this.pinkNoise(ctx, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.22, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
  }

  /** Warm major chord — sector reached. */
  chord(): void {
    [0, 2, 4, 6].forEach((step, i) => setTimeout(() => this.chime(step), i * 70));
  }

  /** Gentle falling phrase — the run fades out. */
  fadeOut(): void {
    [7, 5, 3, 0].forEach((step, i) => setTimeout(() => this.chime(step), i * 160));
  }

  /** Soft bell / e-piano note stepping up the C-major pentatonic scale. */
  chime(step: number): void {
    if (!this.ctx || !this.master || !this.send) return;
    const ctx = this.ctx;
    const f = PENTATONIC[((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
    const t = ctx.currentTime + 0.005;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    env.connect(this.master);
    env.connect(this.send);

    const fund = ctx.createOscillator();
    fund.type = 'sine';
    fund.frequency.value = f;
    fund.connect(env);

    const over = ctx.createOscillator();
    over.type = 'sine';
    over.frequency.value = f * 2;
    const overEnv = ctx.createGain();
    overEnv.gain.setValueAtTime(0.0001, t);
    overEnv.gain.linearRampToValueAtTime(0.22, t + 0.015);
    overEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    over.connect(overEnv).connect(env);

    fund.start(t);
    over.start(t);
    fund.stop(t + 1.15);
    over.stop(t + 1.15);
    fund.onended = () => env.disconnect();
  }
}
