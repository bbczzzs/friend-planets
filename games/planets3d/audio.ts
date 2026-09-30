/**
 * Friend Valley audio: 100% synthesized with WebAudio, zero assets. Soft
 * chimes for pickups and hearts, splashes for fishing, and a
 * gentle pentatonic tune that plays slower and lower at night. Silent until
 * unlock() is called from a user gesture and sound is switched on.
 */
const DAY_NOTES = [0, 2, 4, 7, 9, 12, 14, 16];
const NIGHT_NOTES = [-5, -3, 0, 2, 4, 7, 9];

export class ValleyAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private muted = true;
  private paused = false;
  private timer = 0;
  private beat = 0;
  night = false;

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.35;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 1800;
    this.music.connect(lp).connect(this.master);
    this.timer = window.setInterval(() => this.tickMusic(), 260);
  }

  setMuted(m: boolean): void { this.muted = m; if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.03); }
  get isMuted() { return this.muted; }
  setPaused(p: boolean): void { this.paused = p; if (this.ctx && this.master) this.master.gain.setTargetAtTime(p || this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05); }

  private live() { return this.ctx && this.master && !this.muted && !this.paused ? this.ctx : null; }

  private tone(freq: number, at: number, dur: number, vol: number, type: OscillatorType = "triangle", dest?: AudioNode) {
    const c = this.ctx!;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest ?? this.master!);
    o.start(at); o.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, vol: number, freq: number, q = 1) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(at);
  }

  private tickMusic() {
    const c = this.live();
    if (!c || !this.music) return;
    this.beat++;
    const slow = this.night ? 2 : 1;
    if (this.beat % slow) return;
    const notes = this.night ? NIGHT_NOTES : DAY_NOTES;
    const base = this.night ? 196 : 262;
    const t = c.currentTime + 0.02;
    if (this.beat % (8 * slow) === 0) this.tone(base / 2 * Math.pow(2, notes[(this.beat / 8) % 3 | 0] / 12), t, 2.4, 0.18, "sine", this.music);
    if (Math.random() < (this.night ? 0.45 : 0.55)) {
      const n = notes[Math.floor(Math.random() * notes.length)];
      this.tone(base * Math.pow(2, n / 12), t, this.night ? 1.4 : 0.9, 0.12, "sine", this.music);
    }
  }

  blip(freq = 520) { const c = this.live(); if (c) this.tone(freq, c.currentTime, 0.06, 0.07, "square"); }
  pickup() { const c = this.live(); if (!c) return; const t = c.currentTime; this.tone(784, t, 0.12, 0.18); this.tone(1175, t + 0.07, 0.18, 0.16); }
  coin() { const c = this.live(); if (!c) return; const t = c.currentTime; this.tone(988, t, 0.1, 0.2, "square"); this.tone(1319, t + 0.08, 0.3, 0.18, "square"); }
  swish() { const c = this.live(); if (c) this.noise(c.currentTime, 0.18, 0.35, 2400, 0.8); }
  rustle() { const c = this.live(); if (c) { this.noise(c.currentTime, 0.3, 0.3, 3200, 0.6); this.noise(c.currentTime + 0.08, 0.25, 0.2, 2200, 0.6); } }
  splash() { const c = this.live(); if (c) { this.noise(c.currentTime, 0.35, 0.5, 900, 0.7); this.tone(420, c.currentTime, 0.12, 0.08, "sine"); } }
  bite() { const c = this.live(); if (!c) return; const t = c.currentTime; this.tone(1568, t, 0.07, 0.25, "square"); this.tone(1568, t + 0.1, 0.07, 0.25, "square"); }
  catchIt() { const c = this.live(); if (!c) return; const t = c.currentTime; [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.07, 0.25, 0.2)); }
  miss() { const c = this.live(); if (!c) return; const t = c.currentTime; this.tone(392, t, 0.18, 0.18); this.tone(294, t + 0.14, 0.3, 0.18); }
  fanfare() { const c = this.live(); if (!c) return; const t = c.currentTime; [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + i * 0.09, 0.35, 0.2)); }
  launch() { const c = this.live(); if (!c) return; const t = c.currentTime; this.noise(t, 0.9, 0.5, 300, 0.5); [196, 262, 330, 392].forEach((f, i) => this.tone(f, t + 0.1 + i * 0.08, 0.3, 0.12)); }
  land() { const c = this.live(); if (!c) return; const t = c.currentTime; this.noise(t, 0.5, 0.3, 500, 0.6); this.tone(523, t + 0.3, 0.2, 0.15); this.tone(392, t + 0.45, 0.3, 0.15); }
  bonk() { const c = this.live(); if (c) { this.tone(110, c.currentTime, 0.18, 0.25, "square"); this.noise(c.currentTime, 0.15, 0.3, 200, 1); } }
  pop() { const c = this.live(); if (c) this.tone(660, c.currentTime, 0.08, 0.15, "sine"); }

  dispose() {
    window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
