// Fully synthesized sound effects and a small procedural music loop (WebAudio, no asset files).
import { settings } from './settings';

export type Sfx =
  | 'punch'
  | 'heavy'
  | 'block'
  | 'perfect'
  | 'whoosh'
  | 'jump'
  | 'boost'
  | 'land'
  | 'summon'
  | 'dismiss'
  | 'ts_start'
  | 'ts_end'
  | 'tick'
  | 'knife'
  | 'knife_hit'
  | 'gun'
  | 'ko'
  | 'ui'
  | 'announce'
  | 'menace'
  | 'break';

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private comp!: DynamicsCompressorNode;
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private lastPlay = new Map<string, number>();
  musicIntensity = 0;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 1.5;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfxBus.gain.value = settings.sfx;
    this.musicBus.gain.value = settings.music * 0.55;
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, attack = 0.003, q = 1, bus?: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(filt).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
  }

  private tone(t: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.004, bus?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + attack + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, peak, dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  /** vol is 0..1 (distance attenuation computed by caller). */
  play(name: Sfx, vol = 1, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || vol < 0.02) return;
    // de-duplicate identical sounds in the same few ms (barrages fire many hits per frame)
    const now = ctx.currentTime;
    const last = this.lastPlay.get(name) ?? 0;
    const minGap = name === 'punch' ? 0.035 : 0.02;
    if (now - last < minGap) return;
    this.lastPlay.set(name, now);
    const t = now + 0.005;
    const v = vol;
    const p = pitch * (0.94 + Math.random() * 0.12);
    switch (name) {
      case 'punch':
        this.noise(t, 0.09, 'bandpass', 1600 * p, 500, 0.7 * v, 0.002, 1.2);
        this.tone(t, 0.12, 'sine', 160 * p, 50, 0.9 * v);
        break;
      case 'heavy':
        this.noise(t, 0.25, 'lowpass', 2400, 200, 0.9 * v, 0.002);
        this.tone(t, 0.32, 'sine', 120 * p, 35, 1.0 * v);
        this.tone(t, 0.16, 'square', 90 * p, 40, 0.25 * v);
        break;
      case 'block':
        this.noise(t, 0.08, 'lowpass', 700, 200, 0.6 * v);
        this.tone(t, 0.06, 'triangle', 300 * p, 180, 0.35 * v);
        break;
      case 'perfect':
        this.tone(t, 0.5, 'sine', 1760 * p, 1700, 0.4 * v);
        this.tone(t + 0.02, 0.6, 'sine', 2637 * p, 2600, 0.3 * v);
        this.noise(t, 0.15, 'highpass', 6000, 9000, 0.25 * v);
        break;
      case 'break':
        this.noise(t, 0.4, 'bandpass', 900, 200, 0.8 * v, 0.002, 2);
        this.tone(t, 0.4, 'sawtooth', 220, 60, 0.3 * v);
        break;
      case 'whoosh':
        this.noise(t, 0.22, 'bandpass', 500 * p, 2600 * p, 0.45 * v, 0.02, 1.4);
        break;
      case 'jump':
        this.noise(t, 0.12, 'bandpass', 700, 1500, 0.18 * v, 0.01);
        break;
      case 'boost':
        this.noise(t, 0.35, 'bandpass', 300, 2400, 0.4 * v, 0.02, 1.5);
        this.tone(t, 0.35, 'triangle', 220 * p, 660 * p, 0.2 * v, 0.02);
        break;
      case 'land':
        this.noise(t, 0.12, 'lowpass', 500, 120, 0.5 * v);
        this.tone(t, 0.12, 'sine', 90, 40, 0.5 * v);
        break;
      case 'summon': {
        this.tone(t, 0.5, 'sawtooth', 110 * p, 440 * p, 0.12 * v, 0.05);
        this.tone(t + 0.05, 0.6, 'sine', 880 * p, 1320 * p, 0.15 * v, 0.05);
        this.tone(t + 0.1, 0.6, 'sine', 1320 * p, 1760 * p, 0.1 * v, 0.05);
        this.noise(t, 0.45, 'highpass', 3000, 8000, 0.12 * v, 0.08);
        break;
      }
      case 'dismiss':
        this.tone(t, 0.35, 'sine', 990 * p, 220, 0.12 * v, 0.02);
        this.noise(t, 0.3, 'bandpass', 3000, 600, 0.1 * v, 0.02);
        break;
      case 'ts_start': {
        // reverse swell → deep impact → descending warble
        this.noise(t, 0.6, 'bandpass', 400, 4000, 0.5 * v, 0.55, 0.8);
        this.tone(t + 0.6, 1.6, 'sine', 900, 50, 0.6 * v, 0.01);
        this.tone(t + 0.6, 1.2, 'triangle', 450, 40, 0.3 * v, 0.01);
        this.tone(t + 0.6, 0.9, 'sine', 70, 30, 1.0 * v, 0.005);
        this.noise(t + 0.6, 1.0, 'lowpass', 1500, 80, 0.6 * v, 0.005);
        break;
      }
      case 'ts_end':
        this.noise(t, 0.5, 'bandpass', 200, 3000, 0.35 * v, 0.4);
        this.tone(t, 0.7, 'sine', 60, 700, 0.35 * v, 0.3);
        break;
      case 'tick':
        this.noise(t, 0.03, 'highpass', 4000, 5000, 0.35 * v, 0.001);
        this.tone(t, 0.05, 'square', 2200, 2000, 0.06 * v, 0.001);
        break;
      case 'knife':
        this.noise(t, 0.15, 'bandpass', 2500, 5000, 0.3 * v, 0.01, 2);
        this.tone(t, 0.18, 'sine', 3400 * p, 3000, 0.08 * v, 0.003);
        break;
      case 'knife_hit':
        this.tone(t, 0.2, 'triangle', 2100 * p, 1900, 0.2 * v);
        this.noise(t, 0.05, 'highpass', 3000, 4000, 0.3 * v);
        break;
      case 'gun':
        this.noise(t, 0.2, 'lowpass', 5000, 300, 1.0 * v, 0.001);
        this.tone(t, 0.15, 'sine', 140, 40, 0.8 * v);
        break;
      case 'ko':
        this.tone(t, 0.9, 'sine', 70, 30, 1.0 * v);
        this.noise(t, 0.8, 'lowpass', 3000, 100, 0.8 * v);
        this.tone(t + 0.05, 1.2, 'sine', 523, 520, 0.18 * v);
        this.tone(t + 0.05, 1.2, 'sine', 659, 655, 0.14 * v);
        break;
      case 'ui':
        this.tone(t, 0.06, 'square', 880, 1200, 0.07 * v);
        break;
      case 'announce':
        this.tone(t, 0.5, 'sawtooth', 220, 218, 0.12 * v, 0.01);
        this.tone(t, 0.5, 'sawtooth', 277, 275, 0.1 * v, 0.01);
        this.tone(t, 0.5, 'sawtooth', 330, 329, 0.1 * v, 0.01);
        this.noise(t, 0.25, 'highpass', 5000, 9000, 0.12 * v);
        break;
      case 'menace':
        this.tone(t, 1.4, 'sawtooth', 55, 52, 0.12 * v, 0.3);
        this.tone(t, 1.4, 'sine', 110, 104, 0.15 * v, 0.3);
        break;
    }
  }

  // --------------------------------------------------------------- music
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    if (settings.music <= 0.001) {
      this.nextNote = ctx.currentTime + 0.1;
      return;
    }
    const bpm = 118;
    const s16 = 60 / bpm / 4;
    // E minor funk riff (original)
    const bass = [40, 0, 40, 52, 0, 40, 50, 0, 47, 0, 45, 0, 43, 45, 47, 0, 40, 0, 40, 52, 0, 40, 55, 0, 54, 0, 52, 0, 50, 47, 45, 43];
    while (this.nextNote < ctx.currentTime + 0.2) {
      const st = this.step % 32;
      const t = this.nextNote;
      const n = bass[st];
      if (n) {
        const f = 440 * Math.pow(2, (n - 69) / 12);
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(900 + this.musicIntensity * 1400, t);
        filt.frequency.exponentialRampToValueAtTime(200, t + s16 * 1.6);
        filt.Q.value = 6;
        const g = ctx.createGain();
        this.env(g, t, 0.005, 0.22, s16 * 1.6);
        o.connect(filt).connect(g).connect(this.musicBus);
        o.start(t);
        o.stop(t + s16 * 2);
      }
      if (st % 4 === 0) this.tone(t, 0.18, 'sine', 140, 40, 0.5, 0.002, this.musicBus);
      if (st % 8 === 4) this.noise(t, 0.12, 'bandpass', 1800, 900, 0.35, 0.002, 0.8, this.musicBus);
      if (st % 2 === 1 || this.musicIntensity > 0.5) this.noise(t, 0.03, 'highpass', 7000, 9000, 0.12 + this.musicIntensity * 0.08, 0.001, 1, this.musicBus);
      if (this.musicIntensity > 0.3 && st % 16 === 0) {
        for (const m of [64, 67, 71]) this.tone(t, s16 * 6, 'triangle', 440 * Math.pow(2, (m - 69) / 12), 440 * Math.pow(2, (m - 69) / 12), 0.04, 0.02, this.musicBus);
      }
      this.nextNote += s16;
      this.step++;
    }
  }
}

export const audio = new AudioSys();
