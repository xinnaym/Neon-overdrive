import { useCallback, useEffect, useRef, useState } from "react";
import {
  Flame,
  Home,
  Keyboard,
  MousePointerClick,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { GameEngine, GamePhase, GameStats } from "./game/engine";
import {
  YandexSDK,
  gameplayStart,
  gameplayStop,
  initYandex,
  saveScore,
  showInterstitial,
} from "./game/yandex";

const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const ysdkRef = useRef<YandexSDK | null>(null);
  const adShownRef = useRef(false);

  const [phase, setPhase] = useState<GamePhase>("menu");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [mult, setMult] = useState(1);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [muted, setMuted] = useState(false);
  const [banner, setBanner] = useState<number | null>(null);
  const [hint, setHint] = useState(false);

  /* ---------- инициализация движка ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, {
      onPhase: setPhase,
      onScore: (s, c, m) => {
        setScore(s);
        setCombo(c);
        setMult(m);
      },
      onLevel: (l) => {
        setLevel(l);
        if (l > 1) setBanner(l);
      },
      onGameOver: (st) => {
        setStats(st);
        setBest(st.best);
      },
    });
    engineRef.current = engine;
    setBest(engine.getBest());
    setMuted(engine.audio.isMuted);
    initYandex().then((sdk) => {
      ysdkRef.current = sdk;
    });
    return () => engine.dispose();
  }, []);

  /* ---------- авто-скрытие баннера ---------- */
  useEffect(() => {
    if (banner === null) return;
    const id = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(id);
  }, [banner]);

  /* ---------- подсказка в начале забега ---------- */
  useEffect(() => {
    if (phase === "playing") {
      setHint(true);
      const id = setTimeout(() => setHint(false), 4200);
      return () => clearTimeout(id);
    }
    setHint(false);
    return undefined;
  }, [phase]);

  /* ---------- Яндекс: gameplay API + лидерборды ---------- */
  useEffect(() => {
    if (phase === "playing") {
      gameplayStart(ysdkRef.current);
      adShownRef.current = false;
    }
    if (phase === "paused" || phase === "gameover") gameplayStop(ysdkRef.current);
    if (phase === "gameover" && stats) {
      void saveScore(ysdkRef.current, stats.score);
      if (!adShownRef.current) {
        adShownRef.current = true;
        showInterstitial(ysdkRef.current);
      }
    }
  }, [phase, stats]);

  /* ---------- действия ---------- */
  const play = useCallback(() => engineRef.current?.startGame(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);
  const toMenu = useCallback(() => engineRef.current?.toMenu(), []);
  const toggleMute = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const v = !e.audio.isMuted;
    e.audio.start();
    e.audio.setMuted(v);
    setMuted(v);
  }, []);
  const clickUi = useCallback(() => engineRef.current?.audio.ui(), []);

  /* ---------- клавиатура ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        if (eng.phase === "menu") eng.startGame();
        else if (eng.phase === "playing") eng.flip();
        else if (eng.phase === "paused") eng.resume();
        else if (eng.phase === "gameover") eng.startGame();
      }
      if (e.code === "KeyR" && (eng.phase === "gameover" || eng.phase === "playing")) {
        eng.startGame();
      }
      if ((e.code === "KeyP" || e.code === "Escape") && eng.phase === "playing") eng.pause();
      else if ((e.code === "KeyP" || e.code === "Escape") && eng.phase === "paused") eng.resume();
      if (e.code === "KeyM") toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute]);

  const inRun = phase === "playing" || phase === "dying" || phase === "paused";

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05010d] font-display">
      {/* КАНВАС */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          e.preventDefault();
          engineRef.current?.flip();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* пост-эффекты */}
      <div className="vignette pointer-events-none absolute inset-0" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-70" />

      {/* ============ HUD ============ */}
      {inRun && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* верхняя панель */}
          <div className="flex items-start justify-between gap-3 p-4 sm:p-6">
            <div className="fade-up">
              <div className="text-[10px] tracking-[0.3em] text-white/50">СЧЁТ</div>
              <div className="text-glow-pink text-3xl font-extrabold tabular-nums sm:text-4xl">
                {fmt(score)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
                <Trophy size={12} className="text-neon-yellow" />
                <span className="tabular-nums">{fmt(Math.max(best, score))}</span>
              </div>
            </div>

            {/* комбо */}
            <div className="flex flex-col items-center pt-1">
              {combo >= 2 && (
                <div key={combo} className="hud-pop flex flex-col items-center">
                  <div
                    className={`flex items-center gap-1.5 text-2xl font-black sm:text-3xl ${
                      mult >= 4 ? "text-neon-yellow" : "text-neon-cyan"
                    }`}
                    style={{
                      textShadow: `0 0 18px ${mult >= 4 ? "rgba(255,209,102,.8)" : "rgba(33,230,247,.8)"}`,
                    }}
                  >
                    {mult >= 3 && <Flame size={22} className={mult >= 4 ? "text-neon-yellow" : "text-neon-cyan"} />}
                    ×{mult}
                  </div>
                  <div className="text-[10px] tracking-[0.25em] text-white/50">КОМБО {combo}</div>
                </div>
              )}
            </div>

            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <div className="fade-up flex items-center gap-2">
                <div className="panel rounded-xl px-3 py-1.5 text-xs font-bold tracking-widest text-white/80">
                  LVL {level}
                </div>
                <button
                  onClick={() => {
                    clickUi();
                    phase === "playing" ? engineRef.current?.pause() : engineRef.current?.resume();
                  }}
                  className="neon-btn neon-btn-ghost rounded-xl p-2.5 text-white/85"
                  aria-label="Пауза"
                >
                  {phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
                </button>
                <button
                  onClick={toggleMute}
                  className="neon-btn neon-btn-ghost rounded-xl p-2.5 text-white/85"
                  aria-label="Звук"
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
              </div>
            </div>
          </div>

          {/* подсказка */}
          {hint && phase === "playing" && (
            <div className="absolute inset-x-0 bottom-10 flex justify-center px-4">
              <div className="hint-pulse flex items-center gap-3 rounded-full border border-white/15 bg-black/40 px-5 py-2.5 text-xs text-white/80 backdrop-blur-md sm:text-sm">
                <MousePointerClick size={16} className="text-neon-cyan" />
                ТАП или ПРОБЕЛ — сменить направление
              </div>
            </div>
          )}
        </div>
      )}

      {/* баннер уровня */}
      {banner !== null && inRun && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div key={banner} className="banner-anim text-center">
            <div className="text-4xl font-black tracking-widest text-white sm:text-6xl" style={{ textShadow: "0 0 30px rgba(255,255,255,.7), 0 0 80px rgba(123,46,255,.6)" }}>
              УРОВЕНЬ {banner}
            </div>
            <div className="mt-2 text-sm tracking-[0.35em] text-neon-cyan text-glow-cyan">СКОРОСТЬ РАСТЁТ</div>
          </div>
        </div>
      )}

      {/* ============ МЕНЮ ============ */}
      {phase === "menu" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-4">
          {/* затемнение за контентом меню для читаемости */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 75% 70% at 50% 50%, rgba(3,0,10,0.72) 0%, rgba(3,0,10,0.35) 55%, transparent 100%)",
            }}
          />

          <div className="fade-up panel absolute top-6 right-6 flex items-center gap-2 rounded-2xl px-4 py-2 text-xs text-white/80 max-sm:top-4 max-sm:right-4">
            <Zap size={14} className="text-neon-yellow" />
            ГИПЕР-АРКАДА В ОДНУ КНОПКУ
          </div>

          <div className="float-slow relative flex flex-col items-center text-center">
            <div className="fade-up mb-3 rounded-full border border-white/10 bg-black/40 px-5 py-1.5 text-[11px] font-medium tracking-[0.5em] text-white/75 backdrop-blur-md">
              НЕОН • СКОРОСТЬ • КОМБО
            </div>
            <h1
              className="fade-up title-grad text-[11.5vw] leading-[1.02] font-black tracking-tight sm:text-6xl md:text-7xl"
              style={{ animationDelay: "0.08s" }}
            >
              НЕОНОВЫЙ
              <br />
              ОВЕРДРАЙВ
            </h1>
            <p
              className="fade-up mt-5 max-w-md rounded-2xl border border-white/10 bg-black/45 px-6 py-3.5 text-xs leading-relaxed text-white/85 backdrop-blur-md sm:text-sm"
              style={{ animationDelay: "0.16s" }}
            >
              Несись по орбите под синтвейв. Уворачивайся от осколков, собирай
              энергию, разгоняй комбо до ×8 и не взорвись.
            </p>

            {best > 0 && (
              <div className="fade-up mt-4 flex items-center gap-2 rounded-full border border-neon-yellow/30 bg-black/45 px-5 py-2 text-sm text-white/85 backdrop-blur-md" style={{ animationDelay: "0.22s" }}>
                <Trophy size={16} className="text-neon-yellow" />
                РЕКОРД: <span className="font-bold text-neon-yellow tabular-nums">{fmt(best)}</span>
              </div>
            )}

            <button
              onClick={() => {
                play();
              }}
              className="neon-btn neon-btn-pink fade-up mt-8 rounded-2xl px-14 py-5 text-2xl font-black tracking-[0.2em] text-white sm:px-20"
              style={{ animationDelay: "0.3s" }}
            >
              ИГРАТЬ
            </button>

            <div className="fade-up mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-black/40 px-6 py-3 text-[11px] text-white/70 backdrop-blur-md" style={{ animationDelay: "0.38s" }}>
              <span className="flex items-center gap-1.5">
                <MousePointerClick size={14} className="text-neon-pink" /> тап — разворот
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard size={14} className="text-neon-cyan" /> пробел — разворот
              </span>
              <span className="flex items-center gap-1.5">
                <RotateCcw size={14} className="text-neon-violet" /> R — рестарт
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard size={14} className="text-neon-yellow" /> M — звук
              </span>
            </div>

            <button
              onClick={toggleMute}
              className="neon-btn neon-btn-ghost fade-up mt-5 flex items-center gap-2 rounded-full px-6 py-2.5 text-[12px] font-bold tracking-widest text-white/85"
              style={{ animationDelay: "0.44s" }}
              aria-label="Звук"
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              {muted ? "ЗВУК ВЫКЛЮЧЕН" : "ЗВУК ВКЛЮЧЁН"}
            </button>
          </div>
        </div>
      )}

      {/* ============ ПАУЗА ============ */}
      {phase === "paused" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="panel hud-pop flex w-full max-w-sm flex-col items-center rounded-3xl p-8 text-center">
            <div className="text-3xl font-black tracking-[0.25em] text-white">ПАУЗА</div>
            <div className="mt-2 text-xs text-white/50">Орбита замерла. Бит ждёт.</div>
            <button
              onClick={() => {
                clickUi();
                resume();
              }}
              className="neon-btn neon-btn-cyan mt-7 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-bold"
            >
              <Play size={20} /> ПРОДОЛЖИТЬ
            </button>
            <button
              onClick={() => {
                clickUi();
                toMenu();
              }}
              className="neon-btn neon-btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <Home size={18} /> В МЕНЮ
            </button>
          </div>
        </div>
      )}

      {/* ============ GAME OVER ============ */}
      {phase === "gameover" && stats && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="panel hud-pop flex w-full max-w-md flex-col items-center rounded-3xl p-6 text-center sm:p-9">
            <div className="glitch text-4xl font-black tracking-wider text-[#ff2e5c] sm:text-5xl">
              ВЗРЫВ!
            </div>
            <div className="mt-2 text-xs tracking-[0.3em] text-white/45">ОРБИТА ПОТЕРЯНА</div>

            {stats.isNewBest && (
              <div className="rec-pulse mt-5 flex items-center gap-2 rounded-full border border-neon-yellow/50 bg-neon-yellow/10 px-5 py-2 text-sm font-bold text-neon-yellow">
                <Trophy size={16} /> НОВЫЙ РЕКОРД!
              </div>
            )}

            <div className="mt-6 w-full">
              <div className="text-[10px] tracking-[0.3em] text-white/45">ФИНАЛЬНЫЙ СЧЁТ</div>
              <div className="text-glow-pink text-5xl font-black tabular-nums">{fmt(stats.score)}</div>
            </div>

            <div className="mt-6 grid w-full grid-cols-2 gap-2.5 text-left">
              {[
                { icon: Trophy, label: "РЕКОРД", value: fmt(stats.best), color: "text-neon-yellow" },
                { icon: Flame, label: "МАКС КОМБО", value: `×${stats.maxCombo}`, color: "text-neon-cyan" },
                { icon: Zap, label: "ЭНЕРГИИ", value: String(stats.orbs), color: "text-neon-cyan" },
                { icon: Timer, label: "ВРЕМЯ", value: fmtTime(stats.time), color: "text-neon-violet" },
              ].map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] tracking-widest text-white/40">
                    <Icon size={12} className={color} /> {label}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
              <div className="text-[10px] tracking-widest text-white/40">ПРОШЛЫ ВПЛОТНУЮ</div>
              <div className="mt-1 text-lg font-bold">{stats.grazes} <span className="text-xs text-white/50">грейзов</span> · уровень {stats.level}</div>
            </div>

            <button
              onClick={() => {
                clickUi();
                play();
              }}
              className="neon-btn neon-btn-pink mt-7 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black tracking-widest"
            >
              <RotateCcw size={20} /> ЕЩЁ РАЗ
            </button>
            <button
              onClick={() => {
                clickUi();
                toMenu();
              }}
              className="neon-btn neon-btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <Home size={18} /> В МЕНЮ
            </button>
            <div className="mt-4 text-[10px] text-white/35">R — быстрый рестарт</div>
          </div>
        </div>
      )}
    </div>
  );
}
