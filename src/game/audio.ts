/* ============================================================
   AudioEngine — процедурный синтвейв-саундтрек и SFX
   Полностью на Web Audio API, без аудиофайлов.
   Музыка: секвенсер 132 BPM (AFTERMATH minor), слои по уровню.
   ============================================================ */

const BPM_BASE = 132;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private delaySend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private schedulerId: number | null = null;
  private step = 0;
  private nextTime = 0;
  private bpm = BPM_BASE;
  private intensity = 0;
  private playing = false;
  private built = false;

  muted =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("no-muted") === "1";

  /** Времена запланированных киков — движок игры синхронизирует визуал по ним */
  kickTimes: number[] = [];

  get isMuted() {
    return this.muted;
  }
  get beatDur() {
    return 60 / this.bpm;
  }
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
  get isPlaying() {
    return this.playing;
  }

  /** Создать контекст (вызывать из жеста пользователя) */
  start() {
    this.build();
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(v: boolean) {
    this.muted = v;
    try {
      localStorage.setItem("no-muted", v ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.78, this.ctx.currentTime, 0.04);
    }
  }

  private build() {
    if (this.built) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Мастер-цепь: master -> compressor -> destination
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.78;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.28;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.95;
    this.sfxBus.connect(this.master);

    // Эхо для арпеджио
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / BPM_BASE) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    delay.connect(fb);
    fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    delay.connect(wet);
    wet.connect(this.musicBus);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(delay);

    // Шумовой буфер
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.built = true;
  }

  /* =================== СЕКВЕНСЕР =================== */

  startMusic() {
    this.start();
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.kickTimes = [];
    this.nextTime = this.ctx.currentTime + 0.08;
    this.schedule();
    this.schedulerId = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.playing = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.kickTimes = [];
  }

  setIntensity(i: number) {
    this.intensity = i;
    this.bpm = BPM_BASE + Math.min(4, i) * 4;
  }

  private schedule() {
    if (!this.playing || !this.ctx) return;
    const ahead = this.ctx.currentTime + 0.14;
    let guard = 0;
    while (this.nextTime < ahead && guard++ < 64) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step++;
      this.nextTime = Math.max(this.nextTime, this.ctx.currentTime - 0.5);
    }
  }

  private scheduleStep(s: number, t: number) {
    const s16 = s % 16;
    const bar = Math.floor(s / 16) % 4;
    // Прогрессия Am — F — C — G (корни в миди)
    const roots = [33, 29, 36, 31];
    const root = roots[bar];

    // Кик на каждую четверть
    if (s16 % 4 === 0) {
      this.kick(t);
      this.kickTimes.push(t);
      if (this.kickTimes.length > 32) this.kickTimes.splice(0, 16);
    }
    // Клэп на 2 и 4
    if (this.intensity >= 1 && (s16 === 4 || s16 === 12)) this.clap(t);
    // Хэты
    if (s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.42 : 0.2);
    else if (this.intensity >= 3) this.hat(t, 0.1);
    // Бас — восьмые
    if (s16 % 2 === 0) {
      const up = s16 === 14 && bar % 2 === 1;
      this.bass(t, up ? root + 12 : root, s16 % 4 === 0 ? 0.5 : 0.3);
    }
    // Арпеджио — шестнадцатые
    if (this.intensity >= 2 && s16 % 2 === 0) {
      const scale = [0, 3, 5, 7, 10, 12, 15, 19];
      const m = root + 24 + scale[(s * 3 + bar) % scale.length];
      this.arp(t, m, s16 % 4 === 0 ? 0.15 : 0.09);
    }
    // Стэб-аккорд в начале такта
    if (this.intensity >= 4 && s16 === 0) {
      this.stab(t, [root + 12, root + 15, root + 19]);
    }
  }

  /* =================== ИНСТРУМЕНТЫ =================== */

  private noiseSrc() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    return src;
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g);
    g.connect(this.musicBus!);
    o.start(t);
    o.stop(t + 0.26);

    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.musicBus!);
    n.start(t);
    n.stop(t + 0.05);
  }

  private hat(t: number, vel: number) {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.musicBus!);
    n.start(t);
    n.stop(t + 0.06);
  }

  private clap(t: number) {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.musicBus!);
    n.start(t);
    n.stop(t + 0.25);
  }

  private bass(t: number, midi: number, vol: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(850, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4 * vol * 2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = f / 2;
    const sg = ctx.createGain();
    sg.gain.value = 0.5;

    o.connect(lp);
    sub.connect(sg);
    sg.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus!);
    o.start(t);
    sub.start(t);
    o.stop(t + 0.26);
    sub.stop(t + 0.26);
  }

  private arp(t: number, midi: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.musicBus!);
    g.connect(this.delaySend!);
    o.start(t);
    o.stop(t + 0.18);
  }

  private stab(t: number, midis: number[]) {
    const ctx = this.ctx!;
    midis.forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(m);
      o.detune.value = i === 0 ? -6 : 6;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(lp);
      lp.connect(g);
      g.connect(this.musicBus!);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  /* =================== SFX =================== */

  /** Пикап энергии — высота растёт с комбо (пентатоника) */
  pickup(combo: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
    const m = 81 + scale[combo % scale.length];
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(mtof(m), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m) * 1.5, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.26, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g);
    g.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.22);

    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = mtof(m + 12);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.1, t + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o2.connect(g2);
    g2.connect(this.sfxBus!);
    o2.start(t);
    o2.stop(t + 0.18);
  }

  /** Грейз — пролетел впритык */
  graze() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    o.connect(g);
    g.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.12);

    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.sfxBus!);
    n.start(t);
    n.stop(t + 0.08);
  }

  /** Смена направления */
  flip() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.sfxBus!);
    n.start(t);
    n.stop(t + 0.11);
  }

  /** Новый уровень */
  levelUp() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1760, t + 0.32);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(5200, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.5);

    [69, 72, 76].forEach((m, i) => {
      const os = ctx.createOscillator();
      os.type = "sawtooth";
      os.frequency.value = mtof(m);
      const gs = ctx.createGain();
      const at = t + 0.3 + i * 0.05;
      gs.gain.setValueAtTime(0.0001, at);
      gs.gain.linearRampToValueAtTime(0.12, at + 0.02);
      gs.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      os.connect(gs);
      gs.connect(this.sfxBus!);
      os.start(at);
      os.stop(at + 0.45);
    });
  }

  /** Смерть — большой бум */
  gameOver() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1);
    n.connect(lp);
    lp.connect(g);
    g.connect(this.sfxBus!);
    n.start(t);
    n.stop(t + 1.05);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 0.85);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.8, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    o.connect(g2);
    g2.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 1);
  }

  /** Клик по UI */
  ui() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g);
    g.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.09);
  }
}
