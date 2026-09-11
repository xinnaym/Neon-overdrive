/* ============================================================
   НЕОНОВЫЙ ОВЕРДРАЙВ — игровой движок (оптимизированный)
   Хайп-аркада в одну кнопку. Вся сложная графика запечена
   в оффскрин-спрайты (свечение, градиенты, солнце, сетка),
   в кадре — только drawImage и дешёвые штрихи.
   ============================================================ */

import { AudioEngine } from "./audio";

export type GamePhase = "menu" | "playing" | "paused" | "dying" | "gameover";

export interface GameStats {
  score: number;
  best: number;
  maxCombo: number;
  level: number;
  time: number;
  orbs: number;
  grazes: number;
  isNewBest: boolean;
}

export interface EngineCallbacks {
  onPhase: (p: GamePhase) => void;
  onScore: (score: number, combo: number, mult: number) => void;
  onLevel: (level: number) => void;
  onGameOver: (stats: GameStats) => void;
}

interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tele: number;
  spin: number;
  grazed: boolean;
  outward: boolean;
}
interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  pulse: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
}
interface Popup {
  x: number;
  y: number;
  txt: string;
  life: number;
  max: number;
  size: number;
  color: string;
}
interface Ring {
  r: number;
  vr: number;
  alpha: number;
  width: number;
  color: string;
}
interface Star {
  x: number;
  y: number;
  r: number;
  ph: number;
}

const TAU = Math.PI * 2;
const BEST_KEY = "neon-overdrive-best";
const SS = 3; // суперсэмплинг спрайтов
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class GameEngine {
  audio = new AudioEngine();

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private raf = 0;
  private lastT = 0;
  private t = 0;

  private w = 0;
  private h = 0;
  private dpr = 1;
  private minDim = 0;
  private cx = 0;
  private cy = 0;
  private R = 0;
  private coreR = 0;
  private horizonY = 0;

  phase: GamePhase = "menu";

  private player = {
    angle: -Math.PI / 2,
    dir: 1,
    x: 0,
    y: 0,
    alive: true,
    trail: [] as { x: number; y: number }[],
  };

  private shards: Shard[] = [];
  private orbs: Orb[] = [];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private rings: Ring[] = [];
  private stars: Star[] = [];
  private starCols: string[] = [];

  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private mult = 1;
  private level = 1;
  private orbsN = 0;
  private grazesN = 0;
  private timeAlive = 0;
  private hue = 305;
  private artDirty = true;

  private shardTimer = 1.3;
  private orbTimer = 0.8;
  private waveTimer = 16;
  private emitTimer = 0;

  private shake = 0;
  private slowmo = 0;
  private deathT = 0;
  private lastKick = -10;
  private lastSpawnAngle: number | null = null;

  // запечённые ассеты
  private skyGrad: CanvasGradient | null = null;
  private sunSprite: HTMLCanvasElement | null = null;
  private gridSprite: HTMLCanvasElement | null = null;
  private haloSprite: HTMLCanvasElement | null = null;
  private shardSprite: HTMLCanvasElement | null = null;
  private orbSprite: HTMLCanvasElement | null = null;
  private coreSprite: HTMLCanvasElement | null = null;
  private shipSprite: HTMLCanvasElement | null = null;
  private gridCol = "";
  private orbitCol = "";
  private trailOuter = "";
  private trailInner = "";

  private onResize = () => this.resize();
  private onVis = () => {
    if (document.hidden) this.pause();
  };

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.cb = cb;
    this.resize();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVis);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVis);
    this.audio.stopMusic();
  }

  /* =================== ПУБЛИЧНОЕ API =================== */

  private bestOverride = 0;

  /** Подставляет рекорд, полученный из облака (берём максимум с локальным). */
  setBest(v: number) {
    if (Number.isFinite(v)) this.bestOverride = Math.max(this.bestOverride, v);
  }

  getBest(): number {
    let local = 0;
    try {
      local = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
    } catch {
      /* ignore */
    }
    return Math.max(local, this.bestOverride);
  }

  startGame() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.mult = 1;
    this.level = 1;
    this.orbsN = 0;
    this.grazesN = 0;
    this.timeAlive = 0;
    if (this.hue !== 305) {
      this.hue = 305;
      this.artDirty = true;
    }
    this.shardTimer = 1.3;
    this.orbTimer = 0.8;
    this.waveTimer = 16;
    this.shards = [];
    this.orbs = [];
    this.popups = [];
    this.rings = [];
    this.particles = [];
    this.player.alive = true;
    // угол и направление НЕ сбрасываем — игрок должен продолжить то же
    // вращение, что было в меню, без скачка на верхнюю мёртвую точку.
    this.player.trail = [];
    this.shake = 0;
    this.slowmo = 0;
    this.setPhase("playing");
    this.audio.start();
    this.audio.setIntensity(0);
    this.audio.startMusic();
    this.cb.onScore(0, 0, 1);
    this.cb.onLevel(1);
  }

  restart() {
    this.startGame();
  }

  toMenu() {
    this.setPhase("menu");
    this.audio.stopMusic();
    this.player.alive = true;
    this.player.trail = [];
    this.shards = [];
    this.orbs = [];
    this.popups = [];
  }

  pause() {
    if (this.phase !== "playing") return;
    this.setPhase("paused");
  }

  resume() {
    if (this.phase !== "paused") return;
    this.setPhase("playing");
  }

  flip() {
    if (this.phase !== "playing") return;
    this.player.dir *= -1;
    this.audio.flip();
    this.shake = Math.max(this.shake, 3);
    this.burst(
      this.player.x,
      this.player.y,
      10,
      240,
      [this.hueStr(120, 100, 70), "#ffffff"],
      2.4,
      0.35
    );
  }

  private setPhase(p: GamePhase) {
    this.phase = p;
    this.cb.onPhase(p);
  }

  /* =================== ЛУП =================== */

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = clamp((now - this.lastT) / 1000, 0, 0.05);
    this.lastT = now;
    this.t += dt;
    this.update(dt);
    this.render();
  };

  private update(dt: number) {
    if (this.artDirty) {
      this.bakeArt();
      this.artDirty = false;
    }

    let ts = 1;
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      ts = 0.22;
    }
    const dw = dt * ts;

    if (this.phase === "menu" || this.phase === "gameover") {
      this.player.angle += 0.55 * dt * this.player.dir;
      this.syncPlayerPos();
      this.pushTrail();
    }

    if (this.phase === "playing" || this.phase === "dying") {
      this.updateWorld(dw, dt);
    }

    // бит-синхронизация: кольца от кика
    if (this.audio.isPlaying) {
      const nowA = this.audio.now();
      while (this.audio.kickTimes.length > 0 && this.audio.kickTimes[0] <= nowA) {
        const kt = this.audio.kickTimes.shift()!;
        this.lastKick = kt;
        if (this.phase === "playing") {
          this.rings.push({
            r: this.coreR,
            vr: this.minDim * 0.9,
            alpha: 0.28,
            width: 2,
            color: this.hueStr(0, 100, 65),
          });
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y -= 46 * dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += r.vr * dt;
      r.alpha *= Math.pow(0.06, dt);
      if (r.alpha < 0.01 || r.r > this.minDim * 1.6) this.rings.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 34);
  }

  private updateWorld(dw: number, dtReal: number) {
    const p = this.player;

    if (this.phase === "playing") {
      this.timeAlive += dw;
      this.score += dw * (2 + this.level);

      p.angle += this.playerSpeed() * p.dir * dw;
      this.syncPlayerPos();
      this.pushTrail();

      this.shardTimer -= dw;
      if (this.shardTimer <= 0) {
        this.spawnShard();
        if (this.level >= 4 && Math.random() < 0.35) this.spawnShard(true);
        this.shardTimer = Math.max(0.34, 1.06 - this.level * 0.055) * rand(0.72, 1);
      }
      this.orbTimer -= dw;
      if (this.orbTimer <= 0) {
        if (this.orbs.length < 5) this.spawnOrb();
        this.orbTimer = Math.max(1.1, 2.1 - this.level * 0.07) * rand(0.8, 1.2);
      }
      if (this.level >= 2) {
        this.waveTimer -= dw;
        if (this.waveTimer <= 0) {
          this.spawnWave();
          this.waveTimer = Math.max(11, 25 - this.level * 1.4);
        }
      }
    }

    // движение осколков
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.spin += dw * 6;
      if (s.tele > 0) {
        s.tele -= dw;
        continue;
      }
      s.x += s.vx * dw;
      s.y += s.vy * dw;
      const dx = s.x - this.cx;
      const dy = s.y - this.cy;
      const dc = Math.sqrt(dx * dx + dy * dy);
      if (!s.outward && dc < this.coreR * 0.7) {
        this.burst(s.x, s.y, 8, 160, ["#ffffff"], 1.6, 0.25);
        this.shards.splice(i, 1);
        continue;
      }
      if (s.outward && dc > this.minDim * 0.85) {
        this.shards.splice(i, 1);
        continue;
      }

      if (this.phase === "playing" && p.alive) {
        const pdx = s.x - p.x;
        const pdy = s.y - p.y;
        const d = Math.sqrt(pdx * pdx + pdy * pdy);
        const hitD = 25;
        if (d < hitD) {
          this.die();
          return;
        }
        if (!s.grazed && d < 56) {
          s.grazed = true;
          this.onGraze();
        }
      }
    }

    // энергия
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dw;
      o.pulse += dw * 5;
      o.x += o.vx * dw;
      o.y += o.vy * dw;
      if (this.phase === "playing" && p.alive) {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 70) {
          const pull = 340 * dw;
          o.x += (dx / d) * pull;
          o.y += (dy / d) * pull;
        }
        if (d < 30) {
          this.collectOrb(o);
          this.orbs.splice(i, 1);
          continue;
        }
      }
      if (o.life <= 0) this.orbs.splice(i, 1);
    }

    if (this.phase === "playing") {
      this.emitTimer -= dtReal;
      if (this.emitTimer <= 0) {
        this.emitTimer = 0.15;
        this.cb.onScore(Math.floor(this.score), this.combo, this.mult);
      }
    }

    if (this.phase === "dying") {
      this.deathT += dtReal;
      if (this.deathT > 1.15) this.endGame();
    }
  }

  /* =================== ГЕЙМПЛЕЙ =================== */

  private playerSpeed() {
    return Math.min(3.3, 2.35 + 0.06 * (this.level - 1));
  }

  private syncPlayerPos() {
    const p = this.player;
    p.x = this.cx + Math.cos(p.angle) * this.R;
    p.y = this.cy + Math.sin(p.angle) * this.R;
  }

  private pushTrail() {
    const p = this.player;
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > 30) p.trail.pop();
  }

  private spawnShard(opposite = false) {
    const a = opposite
      ? (this.lastSpawnAngle ?? 0) + Math.PI + rand(-0.5, 0.5)
      : Math.random() * TAU;
    this.lastSpawnAngle = a;
    const spawnR = this.minDim * 0.66 + 60;
    const x = this.cx + Math.cos(a) * spawnR;
    const y = this.cy + Math.sin(a) * spawnR;
    const speed = this.minDim * (0.34 + 0.02 * this.level) * rand(0.9, 1.1);
    const dx = this.cx - x;
    const dy = this.cy - y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const tilt = rand(-0.3, 0.3);
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    const ux = (dx / dist) * cos - (dy / dist) * sin;
    const uy = (dx / dist) * sin + (dy / dist) * cos;
    this.shards.push({
      x,
      y,
      vx: ux * speed,
      vy: uy * speed,
      tele: 0.34,
      spin: Math.random() * TAU,
      grazed: false,
      outward: false,
    });
  }

  private spawnWave() {
    const n = Math.min(18, 8 + this.level * 2);
    const gapFromPlayer = 1.0;
    const base = this.player.angle + gapFromPlayer + Math.random() * (TAU - 2 * gapFromPlayer);
    const speed = this.minDim * (0.36 + 0.015 * this.level);
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * TAU;
      const x = this.cx + Math.cos(a) * (this.coreR + 10);
      const y = this.cy + Math.sin(a) * (this.coreR + 10);
      this.shards.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        tele: 0.42,
        spin: Math.random() * TAU,
        grazed: false,
        outward: true,
      });
    }
    this.popup(this.cx, this.cy - this.R * 0.5, "ВОЛНА!", this.hueStr(40, 100, 70), Math.max(26, this.minDim * 0.05), 1.1);
    this.rings.push({ r: this.coreR, vr: this.minDim * 1.4, alpha: 0.5, width: 4, color: this.hueStr(40, 100, 70) });
    this.audio.graze();
    this.shake = Math.max(this.shake, 8);
  }

  private spawnOrb() {
    const a = Math.random() * TAU;
    const r = this.R + rand(-30, 30);
    const x = this.cx + Math.cos(a) * r;
    const y = this.cy + Math.sin(a) * r;
    const sp = rand(6, 20) * (Math.random() > 0.5 ? 1 : -1);
    this.orbs.push({
      x,
      y,
      vx: -Math.sin(a) * sp,
      vy: Math.cos(a) * sp,
      life: 6.5,
      pulse: Math.random() * 5,
    });
  }

  private collectOrb(o: Orb) {
    const pts = 10 * this.mult;
    this.score += pts;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.mult = Math.min(8, 1 + Math.floor(this.combo / 6));
    this.orbsN++;
    this.popup(o.x, o.y - 14, `+${pts}`, this.hueStr(160, 100, 72), 20, 0.8);
    this.burst(o.x, o.y, 16, 300, [this.hueStr(160, 100, 70), "#ffffff", this.hueStr(120, 100, 65)], 2.6, 0.5);
    this.rings.push({ r: 8, vr: 300, alpha: 0.5, width: 2.5, color: this.hueStr(160, 100, 75) });
    this.audio.pickup(this.combo);
    if (this.mult >= 4 && this.combo % 6 === 0) {
      this.popup(this.cx, this.cy - this.R * 0.5, `КОМБО x${this.mult}!`, this.hueStr(40, 100, 68), Math.max(22, this.minDim * 0.042), 1);
    }
    const newLevel = 1 + Math.floor(this.orbsN / 8);
    if (newLevel > this.level) this.levelUp(newLevel);
    this.cb.onScore(Math.floor(this.score), this.combo, this.mult);
  }

  private onGraze() {
    const pts = 6 * this.mult;
    this.score += pts;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.mult = Math.min(8, 1 + Math.floor(this.combo / 6));
    this.grazesN++;
    this.popup(this.player.x, this.player.y - 26, "БЛИЗКО!", this.hueStr(40, 100, 72), 17, 0.7);
    this.burst(this.player.x, this.player.y, 6, 200, [this.hueStr(40, 100, 72)], 1.8, 0.3);
    this.audio.graze();
    this.shake = Math.max(this.shake, 6);
    this.cb.onScore(Math.floor(this.score), this.combo, this.mult);
  }

  private levelUp(l: number) {
    this.level = l;
    this.hue = (this.hue + 38) % 360;
    this.artDirty = true;
    this.audio.setIntensity(Math.min(5, l - 1));
    this.audio.levelUp();
    this.popup(this.cx, this.cy - this.R * 0.5, `УРОВЕНЬ ${l}`, "#ffffff", Math.max(30, this.minDim * 0.056), 1.5);
    this.burst(this.player.x, this.player.y, 30, 420, [this.hueStr(0, 100, 70), "#ffffff"], 3, 0.7);
    this.rings.push({ r: this.R * 0.4, vr: this.minDim, alpha: 0.6, width: 4, color: "#ffffff" });
    this.shake = Math.max(this.shake, 10);
    this.cb.onLevel(l);
  }

  private die() {
    const p = this.player;
    p.alive = false;
    this.combo = 0;
    this.setPhase("dying");
    this.deathT = 0;
    this.slowmo = 0.9;
    this.shake = 26;
    this.audio.stopMusic();
    this.audio.gameOver();
    this.burst(p.x, p.y, 110, 640, [this.hueStr(120, 100, 72), this.hueStr(0, 100, 65), "#ffffff", "#ff2ea6"], 3.4, 1);
    this.rings.push({ r: 10, vr: this.minDim * 1.8, alpha: 0.9, width: 6, color: "#ffffff" });
    this.rings.push({ r: 10, vr: this.minDim * 1.2, alpha: 0.6, width: 3, color: this.hueStr(0, 100, 65) });
  }

  private endGame() {
    const finalScore = Math.floor(this.score);
    const best = this.getBest();
    const isNewBest = finalScore > best;
    if (isNewBest) {
      try {
        localStorage.setItem(BEST_KEY, String(finalScore));
      } catch {
        /* ignore */
      }
    }
    this.setPhase("gameover");
    this.cb.onScore(finalScore, this.combo, this.mult);
    this.cb.onGameOver({
      score: finalScore,
      best: Math.max(best, finalScore),
      maxCombo: this.maxCombo,
      level: this.level,
      time: this.timeAlive,
      orbs: this.orbsN,
      grazes: this.grazesN,
      isNewBest,
    });
    this.player.alive = true;
  }

  /* =================== УТИЛИТЫ =================== */

  private hueStr(offset: number, s: number, l: number, a = 1) {
    return `hsla(${(this.hue + offset) % 360}, ${s}%, ${l}%, ${a})`;
  }

  private popup(x: number, y: number, txt: string, color: string, size: number, life: number) {
    this.popups.push({ x, y, txt, life, max: life, size, color });
  }

  private burst(x: number, y: number, n: number, speed: number, colors: string[], size: number, life: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = rand(speed * 0.25, speed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(life * 0.5, life),
        max: life,
        size: rand(size * 0.5, size * 1.4),
        color: colors[i % colors.length],
        drag: 0.94,
      });
    }
    if (this.particles.length > 360) this.particles.splice(0, this.particles.length - 360);
  }

  private resize() {
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.minDim = Math.min(this.w, this.h);
    this.cx = this.w / 2;
    this.cy = this.h * 0.46;
    this.R = this.minDim * 0.32;
    this.coreR = clamp(this.minDim * 0.05, 18, 32);
    this.horizonY = this.h * 0.6;

    this.stars = [];
    const n = Math.floor((this.w * this.horizonY) / 9000);
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.horizonY,
        r: rand(0.6, 2),
        ph: Math.random() * TAU,
      });
    }
    this.syncPlayerPos();
    this.bakeArt();
  }

  private beatPulse(): number {
    if (!this.audio.isPlaying) {
      return 0.35 + 0.2 * Math.sin(this.t * 2.2);
    }
    const dtBeat = (this.audio.now() - this.lastKick) / this.audio.beatDur;
    return Math.exp(-clamp(dtBeat, 0, 4) * 3.2);
  }

  /* =================== ЗАПЕКАНИЕ АССЕТОВ =================== */

  private makeSprite(size: number, draw: (c: CanvasRenderingContext2D, c0: number) => void) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = Math.max(4, Math.ceil(size * SS));
    const c = cv.getContext("2d")!;
    c.scale(SS, SS);
    draw(c, size / 2);
    return cv;
  }

  private bakeArt() {
    const h0 = this.hue;
    const main = this.ctx;

    // небо (градиент зависит от оттенка и высоты)
    const sky = main.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, "#06010f");
    sky.addColorStop(0.45, `hsl(${(h0 + 40) % 360}, 60%, 11%)`);
    sky.addColorStop(0.62, `hsl(${h0}, 75%, 16%)`);
    sky.addColorStop(1, "#0a0118");
    this.skyGrad = sky;

    // солнце — запекаем цельный диск
    const gh = h0;
    this.sunSprite = this.makeSprite(600, (c, c0) => {
      const g = c.createLinearGradient(0, 0, 0, 600);
      g.addColorStop(0, "#7a5230");
      g.addColorStop(0.45, `hsl(${gh}, 68%, 32%)`);
      g.addColorStop(1, `hsl(${gh}, 78%, 22%)`);
      c.fillStyle = g;
      c.beginPath();
      c.arc(c0, c0, c0, 0, TAU);
      c.fill();
    });

    // статичная сетка: вертикали + линия горизонта (в разрешении канваса)
    const grid = document.createElement("canvas");
    grid.width = Math.max(2, this.canvas.width);
    grid.height = Math.max(2, this.canvas.height);
    const g = grid.getContext("2d")!;
    g.scale(this.dpr, this.dpr);
    const col = `hsl(${h0}, 100%, 62%)`;
    for (let i = -11; i <= 11; i++) {
      const xBottom = this.cx + i * this.w * 0.13;
      g.strokeStyle = col;
      g.lineCap = "round";
      g.globalAlpha = 0.1;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(this.cx + i * this.w * 0.006, this.horizonY);
      g.lineTo(xBottom, this.h);
      g.stroke();
      g.globalAlpha = 0.34;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(this.cx + i * this.w * 0.006, this.horizonY);
      g.lineTo(xBottom, this.h);
      g.stroke();
    }
    g.globalAlpha = 0.18;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(0, this.horizonY);
    g.lineTo(this.w, this.horizonY);
    g.stroke();
    g.globalAlpha = 0.85;
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(0, this.horizonY);
    g.lineTo(this.w, this.horizonY);
    g.stroke();
    g.globalAlpha = 1;
    this.gridSprite = grid;
    this.gridCol = col;

    // тёмный ореол-подложка (общий для игрока и осколков)
    this.haloSprite = this.makeSprite(96, (c, c0) => {
      const rg = c.createRadialGradient(c0, c0, 0, c0, c0, c0);
      rg.addColorStop(0, "rgba(5,0,12,0.92)");
      rg.addColorStop(1, "rgba(5,0,12,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.arc(c0, c0, c0, 0, TAU);
      c.fill();
    });

    // осколок: красное свечение + ромб + белая кромка + ядро
    this.shardSprite = this.makeSprite(64, (c, c0) => {
      const rg = c.createRadialGradient(c0, c0, 0, c0, c0, c0);
      rg.addColorStop(0, "rgba(255,45,94,0.6)");
      rg.addColorStop(1, "rgba(255,45,94,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.arc(c0, c0, c0, 0, TAU);
      c.fill();
      const sz = 15.5;
      c.fillStyle = "#ff2d5e";
      c.beginPath();
      c.moveTo(c0 + sz, c0);
      c.lineTo(c0, c0 + sz * 0.74);
      c.lineTo(c0 - sz, c0);
      c.lineTo(c0, c0 - sz * 0.74);
      c.closePath();
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.95)";
      c.lineWidth = 2.6;
      c.lineJoin = "round";
      c.stroke();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(c0, c0, sz * 0.24, 0, TAU);
      c.fill();
    });

    // энерго-шар
    this.orbSprite = this.makeSprite(56, (c, c0) => {
      const rg = c.createRadialGradient(c0, c0, 0, c0, c0, c0);
      rg.addColorStop(0, `hsla(${(h0 + 160) % 360}, 100%, 70%, 0.6)`);
      rg.addColorStop(1, `hsla(${(h0 + 160) % 360}, 100%, 70%, 0)`);
      c.fillStyle = rg;
      c.beginPath();
      c.arc(c0, c0, c0, 0, TAU);
      c.fill();
      c.fillStyle = `hsl(${(h0 + 160) % 360}, 100%, 72%)`;
      c.beginPath();
      c.arc(c0, c0, 9, 0, TAU);
      c.fill();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(c0, c0, 3.6, 0, TAU);
      c.fill();
    });

    // свечение ядра
    this.coreSprite = this.makeSprite(220, (c, c0) => {
      const rg = c.createRadialGradient(c0, c0, 0, c0, c0, 110);
      rg.addColorStop(0, "#ffffff");
      rg.addColorStop(0.28, `hsl(${h0}, 100%, 65%)`);
      rg.addColorStop(0.6, `hsla(${h0}, 100%, 58%, 0.35)`);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.arc(c0, c0, 110, 0, TAU);
      c.fill();
    });

    // кораблик игрока: свечение + дарт + белая обводка
    const pc = `hsl(${(h0 + 120) % 360}, 100%, 72%)`;
    this.shipSprite = this.makeSprite(112, (c, c0) => {
      c.translate(c0, c0);
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, 50);
      rg.addColorStop(0, `hsla(${(h0 + 120) % 360}, 100%, 70%, 0.55)`);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = rg;
      c.beginPath();
      c.arc(0, 0, 50, 0, TAU);
      c.fill();
      c.fillStyle = pc;
      c.beginPath();
      c.moveTo(19, 0);
      c.lineTo(-13.5, 9.5);
      c.lineTo(-7.5, 0);
      c.lineTo(-13.5, -9.5);
      c.closePath();
      c.fill();
      c.strokeStyle = "#ffffff";
      c.lineWidth = 2.6;
      c.lineJoin = "round";
      c.stroke();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.moveTo(12, 0);
      c.lineTo(-6, 4.6);
      c.lineTo(-3.5, 0);
      c.lineTo(-6, -4.6);
      c.closePath();
      c.fill();
    });

    // кеши цветов
    this.orbitCol = `hsla(${h0}, 100%, 70%, 0.28)`;
    this.trailOuter = `hsla(${(h0 + 120) % 360}, 100%, 60%, 0.26)`;
    this.trailInner = `hsla(${(h0 + 120) % 360}, 100%, 70%, 0.72)`;

    // бакеты прозрачности для звёзд
    this.starCols = [];
    for (let i = 0; i < 9; i++) {
      this.starCols.push(`rgba(255,255,255,${(0.1 + i * 0.11).toFixed(2)})`);
    }
  }

  /* =================== РЕНДЕР =================== */

  private render() {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawBackground();
    this.drawEntities();
    ctx.restore();
  }

  private drawBackground() {
    const ctx = this.ctx;
    const { w, h, cx, cy, horizonY } = this;
    const pulse = this.beatPulse();

    // небо
    if (this.skyGrad) {
      ctx.fillStyle = this.skyGrad;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#06010f";
      ctx.fillRect(0, 0, w, h);
    }

    // звёзды (бакеты прозрачности, без создания строк на каждую)
    for (const st of this.stars) {
      const tw = Math.sin(this.t * 1.8 + st.ph) * 0.5 + 0.5;
      const idx = clamp(Math.round((0.3 + 0.7 * tw * tw) * 8), 0, 8);
      ctx.fillStyle = this.starCols[idx];
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }

    // солнце — запечённый диск, центр ровно на ядре
    if (this.sunSprite) {
      const r = this.minDim * 0.27 * (1 + 0.04 * pulse);
      ctx.drawImage(this.sunSprite, cx - r, cy - r, r * 2, r * 2);
    }

    // статичная часть сетки
    if (this.gridSprite) {
      ctx.drawImage(this.gridSprite, 0, 0, w, h);
    }

    // движущиеся горизонтали сетки (двойной штрих вместо shadowBlur)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizonY, w, h - horizonY);
    ctx.clip();
    ctx.strokeStyle = this.gridCol;
    ctx.lineCap = "round";
    for (let i = 0; i < 13; i++) {
      const p = (this.t * 0.32 + i / 13) % 1;
      const y = horizonY + Math.pow(p, 2.7) * (h - horizonY);
      const a = 0.1 + p * 0.4 + pulse * 0.1;
      ctx.globalAlpha = a * 0.3;
      ctx.lineWidth = (1 + p * 2) * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.globalAlpha = Math.min(0.85, a);
      ctx.lineWidth = 1 + p * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawEntities() {
    const ctx = this.ctx;
    const pulse = this.beatPulse();

    // тёмные подложки под сущностями (обычный режим)
    const halo = this.haloSprite;
    if (halo) {
      if (this.player.alive) {
        ctx.drawImage(halo, this.player.x - 40, this.player.y - 40, 80, 80);
      }
      for (let i = 0; i < this.shards.length; i++) {
        const s = this.shards[i];
        if (s.tele > 0) continue;
        ctx.drawImage(halo, s.x - 34, s.y - 34, 68, 68);
      }
    }

    ctx.globalCompositeOperation = "lighter";

    // кольца
    for (const r of this.rings) {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = r.alpha;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ядро
    if (this.coreSprite) {
      const cr = this.coreR * (1 + 0.14 * pulse);
      const gr = cr * 2.6;
      ctx.drawImage(this.coreSprite, this.cx - gr, this.cy - gr, gr * 2, gr * 2);
    }
    // орбита
    ctx.strokeStyle = this.orbitCol;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([2, 10]);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // энергия
    if (this.orbSprite) {
      for (const o of this.orbs) {
        const blink = o.life < 2 ? (Math.sin(o.life * 14) > 0 ? 1 : 0.25) : 1;
        const sz = 56 * (1 + Math.sin(o.pulse) * 0.2);
        ctx.globalAlpha = blink;
        ctx.drawImage(this.orbSprite, o.x - sz / 2, o.y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;

    // осколки
    const shard = this.shardSprite;
    for (const s of this.shards) {
      if (s.tele > 0) {
        // телеграф: мигающий контур
        const a = 0.4 + 0.55 * Math.abs(Math.sin(this.t * 18));
        ctx.globalAlpha = a;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.spin);
        const sz = 11;
        ctx.strokeStyle = "#ff5a82";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sz, 0);
        ctx.lineTo(0, sz * 0.72);
        ctx.lineTo(-sz, 0);
        ctx.lineTo(0, -sz * 0.72);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "#ff5a82";
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (shard) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.spin);
        ctx.drawImage(shard, -32, -32, 64, 64);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // след игрока — сегменты с затуханием к хвосту
    const trail = this.player.trail;
    const tn = trail.length;
    if (tn > 2) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < tn; i++) {
        const k = 1 - i / tn; // 1 у головы, 0 у хвоста
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.strokeStyle = this.trailOuter;
        ctx.lineWidth = 4 + 11 * k;
        ctx.stroke();
        ctx.strokeStyle = this.trailInner;
        ctx.lineWidth = 1.5 + 3 * k;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // игрок
    if (this.player.alive && this.shipSprite) {
      const p = this.player;
      const hx = -Math.sin(p.angle) * p.dir;
      const hy = Math.cos(p.angle) * p.dir;
      const rot = Math.atan2(hy, hx);
      // кольцо-локатор
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.2 * Math.sin(this.t * 6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 + Math.sin(this.t * 6) * 3.5, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rot);
      ctx.drawImage(this.shipSprite, -56, -56, 112, 112);
      ctx.restore();
    }

    // частицы
    for (const pt of this.particles) {
      const a = pt.life / pt.max;
      if (a <= 0) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.5 + a * 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = "source-over";

    // попапы: тёмная обводка вместо shadowBlur
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const pp of this.popups) {
      const a = clamp(pp.life / pp.max, 0, 1);
      const fs = pp.size * (1 + (1 - a) * 0.08);
      ctx.globalAlpha = Math.min(1, a * 2);
      ctx.font = `800 ${fs}px Unbounded, system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, fs * 0.14);
      ctx.strokeStyle = "rgba(3,0,8,0.9)";
      ctx.strokeText(pp.txt, pp.x, pp.y);
      ctx.fillStyle = pp.color;
      ctx.fillText(pp.txt, pp.x, pp.y);
    }
    ctx.globalAlpha = 1;
  }
}
