/** All game sounds are synthesised with WebAudio, so there are no asset files to load. */
export class AudioFX {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private hornGain!: GainNode;
  private nitroGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);

    // Engine: saw + sub square through a resonant low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineFilter.Q.value = 3;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const sub = ctx.createGain();
    sub.gain.value = 0.45;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(sub).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Horn: two detuned squares.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 1800;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornFilter);
      o.start();
    }
    hornFilter.connect(this.hornGain).connect(this.master);

    // Nitro: looping filtered noise hiss.
    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0;
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    ns.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1400;
    hp.Q.value = 0.6;
    ns.connect(hp).connect(this.nitroGain).connect(this.master);
    ns.start();
  }

  get isMuted() {
    return this.muted;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Fake a gearbox so the pitch climbs and drops like a real car. */
  engine(kmh: number, throttle: number, on: boolean) {
    if (!this.ctx) return;
    const gears = [0, 45, 80, 120, 160, 205, 250, 400];
    let g = 1;
    while (g < gears.length - 1 && kmh > gears[g]) g++;
    const lo = gears[g - 1];
    const hi = gears[g];
    const frac = Math.min(1, Math.max(0, (kmh - lo) / (hi - lo)));
    const f = 46 + frac * 92 + g * 7;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.06);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(380 + throttle * 1100 + frac * 500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(on ? 0.06 + throttle * 0.05 : 0, t, 0.12);
  }

  horn(on: boolean) {
    if (this.ctx) this.hornGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, 0.02);
  }

  nitro(on: boolean) {
    if (this.ctx) this.nitroGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.08);
  }

  private burst(duration: number, type: BiquadFilterType, f0: number, f1: number, gain: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, duration: number, gain: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  crash() {
    this.burst(1.1, 'lowpass', 2400, 120, 1.2);
    this.burst(0.5, 'highpass', 3000, 6000, 0.35);
    this.tone('sine', 90, 30, 0.6, 0.9);
  }

  whoosh() {
    this.burst(0.35, 'bandpass', 500, 2600, 0.5);
  }

  scrape() {
    this.burst(0.12, 'highpass', 2500, 4000, 0.15);
  }

  beep(high = false) {
    this.tone('square', high ? 880 : 440, high ? 880 : 440, high ? 0.45 : 0.18, 0.12);
  }
}
