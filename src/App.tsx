import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Coins,
  Flame,
  Home,
  Keyboard,
  Lock,
  MousePointerClick,
  Pause,
  Play,
  RotateCcw,
  ShoppingBag,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { GameEngine, GamePhase, GameStats } from "./game/engine";
import {
  LeaderboardRow,
  YandexPlayer,
  YandexSDK,
  gameplayStart,
  gameplayStop,
  getYandexLang,
  getYandexPlayer,
  initYandex,
  isPlayerAuthorized,
  loadCloudBest,
  loadLeaderboardTop,
  saveCloudBest,
  saveScore,
  showInterstitial,
  showRewardedVideo,
} from "./game/yandex";
import { Lang, fmtNum, translations } from "./i18n";
import { COLORS, SHIPS, ShipId, ShopState, TRAILS, TrailId, isOwned, loadShop, saveShop } from "./shop";

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const ysdkRef = useRef<YandexSDK | null>(null);
  const playerRef = useRef<YandexPlayer | null>(null);
  const authorizedRef = useRef(false);
  const adShownRef = useRef(false);
  const deathCountRef = useRef(0);

  const [lang, setLang] = useState<Lang>("ru");
  const t = translations[lang];
  const fmt = (n: number) => fmtNum(n, lang);

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

  const [coins, setCoins] = useState(0);
  const [shop, setShopState] = useState<ShopState>(() => loadShop());
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<"ship" | "trail" | "color">("ship");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);

  const applyShop = useCallback((next: ShopState) => {
    setShopState(next);
    saveShop(next);
    engineRef.current?.setCosmetics({
      ship: next.ship,
      trail: next.trail,
      shipColor: next.shipColor,
      trailColor: next.trailColor,
    });
  }, []);

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
      onCoins: setCoins,
    });
    engineRef.current = engine;
    setBest(engine.getBest());
    setCoins(engine.getCoins());
    setMuted(engine.audio.isMuted);
    const savedShop = loadShop();
    engine.setCosmetics({
      ship: savedShop.ship,
      trail: savedShop.trail,
      shipColor: savedShop.shipColor,
      trailColor: savedShop.trailColor,
    });
    initYandex().then(async (sdk) => {
      ysdkRef.current = sdk;
      const l = getYandexLang(sdk);
      setLang(l);
      engine.setLang(l);

      void loadLeaderboardTop(sdk).then(setLeaderboard);

      const player = await getYandexPlayer(sdk);
      playerRef.current = player;
      const authorized = isPlayerAuthorized(player);
      authorizedRef.current = authorized;

      if (authorized) {
        const cloudBest = await loadCloudBest(player);
        const localBest = engine.getBest();
        const merged = Math.max(cloudBest ?? 0, localBest);
        engine.setBest(merged);
        setBest(merged);
        // если в облаке значение отставало от локального — подтягиваем его туда
        if ((cloudBest ?? 0) < merged) void saveCloudBest(player, merged);
      }
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
      void saveScore(ysdkRef.current, stats.best).then(() => {
        void loadLeaderboardTop(ysdkRef.current).then(setLeaderboard);
      });
      if (stats.isNewBest && authorizedRef.current) {
        void saveCloudBest(playerRef.current, stats.best);
      }
      if (!adShownRef.current) {
        adShownRef.current = true;
        let n = 0;
        try {
          n = Number(localStorage.getItem("neon-overdrive-deaths") || 0) || 0;
        } catch {
          /* ignore */
        }
        n += 1;
        try {
          localStorage.setItem("neon-overdrive-deaths", String(n));
        } catch {
          /* ignore */
        }
        deathCountRef.current = n;
        if (n % 2 === 0) showInterstitial(ysdkRef.current);
      }
    }
  }, [phase, stats]);

  /* ---------- Блокировка контекстного меню браузера ---------- */
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

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

  const shipLabel = (id: ShipId) =>
    id === "circle" ? t.shipCircle : id === "star" ? t.shipStar : id === "diamond" ? t.shipDiamond : id === "smile" ? t.shipSmile : t.shipClassic;
  const trailLabel = (id: TrailId) =>
    id === "fade" ? t.trailFade : id === "dash" ? t.trailDash : id === "dotted" ? t.trailDotted : id === "ribbon" ? t.trailRibbon : t.trailGlow;

  const selectOrBuy = (category: "ship" | "trail", id: string, price: number) => {
    const key = `${category}:${id}`;
    clickUi();
    if (isOwned(shop, key)) {
      applyShop({ ...shop, [category]: id } as ShopState);
      return;
    }
    if (coins >= price && engineRef.current?.spendCoins(price)) {
      applyShop({ ...shop, owned: [...shop.owned, key], [category]: id } as ShopState);
    }
  };

  const unlockViaAd = (category: "ship" | "trail", id: string) => {
    clickUi();
    showRewardedVideo(ysdkRef.current, (rewarded) => {
      if (!rewarded) return;
      const key = `${category}:${id}`;
      applyShop({ ...shop, owned: [...shop.owned, key], [category]: id } as ShopState);
    });
  };

  const setColor = (target: "ship" | "trail", hue: number | null) => {
    clickUi();
    applyShop({ ...shop, [target === "ship" ? "shipColor" : "trailColor"]: hue } as ShopState);
  };

  const inRun = phase === "playing" || phase === "dying" || phase === "paused";

  const leaderboardPanel = (
    <div className="fade-up panel hidden w-52 shrink-0 rounded-2xl p-4 text-left sm:block">
      <div className="flex items-center gap-2 text-xs font-bold tracking-widest text-white/70">
        <Trophy size={14} className="text-neon-yellow" /> {t.leaders}
      </div>
      {leaderboard.length === 0 ? (
        <div className="mt-3 text-xs text-white/40">{t.leadersEmpty}</div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {leaderboard.slice(0, 10).map((row) => (
            <div key={row.rank} className="flex items-center justify-between gap-2 text-xs text-white/80">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="w-4 shrink-0 text-white/45">{row.rank}</span>
                <span className="truncate">{row.name}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums text-neon-cyan">{fmt(row.score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

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
              <div className="text-[10px] tracking-[0.3em] text-white/50">{t.score}</div>
              <div className="text-glow-pink text-3xl font-extrabold tabular-nums sm:text-4xl">
                {fmt(score)}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
                <Trophy size={12} className="text-neon-yellow" />
                <span className="tabular-nums">{fmt(Math.max(best, score))}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-white/45">
                <Coins size={12} className="text-neon-yellow" />
                <span className="tabular-nums">{fmt(coins)}</span>
              </div>
            </div>

            {/* комбо */}
            <div className="flex flex-col items-center pt-1">
              {combo >= 2 && (
                <div key={combo} className="hud-pop flex flex-col items-center">
                  <div
                    className={`flex items-center gap-1.5 text-2xl font-black sm:text-3xl ${mult >= 4 ? "text-neon-yellow" : "text-neon-cyan"
                      }`}
                    style={{
                      textShadow: `0 0 18px ${mult >= 4 ? "rgba(255,209,102,.8)" : "rgba(33,230,247,.8)"}`,
                    }}
                  >
                    {mult >= 3 && <Flame size={22} className={mult >= 4 ? "text-neon-yellow" : "text-neon-cyan"} />}
                    ×{mult}
                  </div>
                  <div className="text-[10px] tracking-[0.25em] text-white/50">{t.combo(combo)}</div>
                </div>
              )}
            </div>

            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <div className="fade-up flex items-center gap-2">
                <div className="panel rounded-xl px-3 py-1.5 text-xs font-bold tracking-widest text-white/80">
                  {t.lvl(level)}
                </div>
                <button
                  onClick={() => {
                    clickUi();
                    phase === "playing" ? engineRef.current?.pause() : engineRef.current?.resume();
                  }}
                  className="neon-btn neon-btn-ghost rounded-xl p-2.5 text-white/85"
                  aria-label={t.pause}
                >
                  {phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
                </button>
                <button
                  onClick={toggleMute}
                  className="neon-btn neon-btn-ghost rounded-xl p-2.5 text-white/85"
                  aria-label={t.sound}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
              </div>
            </div>
          </div>

          {/* подсказка */}
          {hint && phase === "playing" && (
            <div className="absolute inset-x-0 bottom-10 flex justify-center px-4">
              <div className="flex items-center gap-3 rounded-full border border-white/15 bg-black/40 px-5 py-2.5 text-xs text-white/80 backdrop-blur-md sm:text-sm">
                <MousePointerClick size={16} className="text-neon-cyan" />
                {t.hint}
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
              {t.levelBanner(banner)}
            </div>
            <div className="mt-2 text-sm tracking-[0.35em] text-neon-cyan text-glow-cyan">{t.speedRising}</div>
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

          <div className="pointer-events-auto absolute left-4 top-1/2 z-10 -translate-y-1/2 sm:left-8">
            {leaderboardPanel}
          </div>

          <div className="float-slow relative flex flex-col items-center text-center">
            <div className="fade-up mb-3 rounded-full border border-white/10 bg-black/40 px-5 py-1.5 text-[11px] font-medium tracking-[0.5em] text-white/75 backdrop-blur-md">
              {t.menuTag}
            </div>
            <h1
              className="fade-up title-grad text-[11.5vw] leading-[1.02] font-black tracking-tight sm:text-6xl md:text-7xl"
              style={{ animationDelay: "0.08s" }}
            >
              {t.titleLine1}
              <br />
              {t.titleLine2}
            </h1>
            <p
              className="fade-up mt-5 max-w-md rounded-2xl border border-white/10 bg-black/45 px-6 py-3.5 text-xs leading-relaxed text-white/85 backdrop-blur-md sm:text-sm"
              style={{ animationDelay: "0.16s" }}
            >
              {t.description}
            </p>

            <div className="fade-up mt-4 flex flex-wrap items-center justify-center gap-2" style={{ animationDelay: "0.22s" }}>
              {best > 0 && (
                <div className="flex items-center gap-2 rounded-full border border-neon-yellow/30 bg-black/45 px-5 py-2 text-sm text-white/85 backdrop-blur-md">
                  <Trophy size={16} className="text-neon-yellow" />
                  {t.bestLabel} <span className="font-bold text-neon-yellow tabular-nums">{fmt(best)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-5 py-2 text-sm text-white/85 backdrop-blur-md">
                <Coins size={16} className="text-neon-yellow" />
                <span className="font-bold tabular-nums">{fmt(coins)}</span>
              </div>
              <button
                onClick={() => {
                  clickUi();
                  setShopOpen(true);
                }}
                className="neon-btn neon-btn-ghost flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold text-white/85"
              >
                <ShoppingBag size={16} /> {t.shop}
              </button>
            </div>

            <button
              onClick={() => {
                play();
              }}
              className="neon-btn neon-btn-pink fade-up mt-8 rounded-2xl px-14 py-5 text-2xl font-black tracking-[0.2em] text-white sm:px-20"
              style={{ animationDelay: "0.3s" }}
            >
              {t.play}
            </button>

            <div className="fade-up mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border border-white/10 bg-black/40 px-6 py-3 text-[11px] text-white/70 backdrop-blur-md" style={{ animationDelay: "0.38s" }}>
              <span className="flex items-center gap-1.5">
                <MousePointerClick size={14} className="text-neon-pink" /> {t.controlTap}
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard size={14} className="text-neon-cyan" /> {t.controlSpace}
              </span>
              <span className="flex items-center gap-1.5">
                <ArrowUp size={14} className="text-neon-cyan" /> {t.controlArrowUp}
              </span>
              <span className="flex items-center gap-1.5">
                <RotateCcw size={14} className="text-neon-violet" /> {t.controlRestart}
              </span>
              <span className="flex items-center gap-1.5">
                <Keyboard size={14} className="text-neon-yellow" /> {t.controlMute}
              </span>
            </div>

            <button
              onClick={toggleMute}
              className="neon-btn neon-btn-ghost fade-up mt-5 flex items-center gap-2 rounded-full px-6 py-2.5 text-[12px] font-bold tracking-widest text-white/85"
              style={{ animationDelay: "0.44s" }}
              aria-label={t.sound}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              {muted ? t.soundOff : t.soundOn}
            </button>
          </div>
        </div>
      )}

      {/* ============ ПАУЗА ============ */}
      {phase === "paused" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="panel hud-pop flex w-full max-w-sm flex-col items-center rounded-3xl p-8 text-center">
            <div className="text-3xl font-black tracking-[0.25em] text-white">{t.paused}</div>
            <div className="mt-2 text-xs text-white/50">{t.pausedHint}</div>
            <button
              onClick={() => {
                clickUi();
                resume();
              }}
              className="neon-btn neon-btn-cyan mt-7 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-bold"
            >
              <Play size={20} /> {t.resume}
            </button>
            <button
              onClick={() => {
                clickUi();
                setShopOpen(true);
              }}
              className="neon-btn neon-btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <ShoppingBag size={18} /> {t.shop}
            </button>
            <button
              onClick={() => {
                clickUi();
                toMenu();
              }}
              className="neon-btn neon-btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <Home size={18} /> {t.toMenu}
            </button>
          </div>
        </div>
      )}

      {/* ============ GAME OVER ============ */}
      {phase === "gameover" && stats && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-4">
          <div className="pointer-events-auto absolute left-4 top-1/2 z-10 -translate-y-1/2 sm:left-8">
            {leaderboardPanel}
          </div>
          <div className="panel hud-pop flex w-full max-w-md flex-col items-center rounded-3xl p-6 text-center sm:p-9">
            <div className="glitch text-4xl font-black tracking-wider text-[#ff2e5c] sm:text-5xl">
              {t.boom}
            </div>
            <div className="mt-2 text-xs tracking-[0.3em] text-white/45">{t.orbitLost}</div>

            {stats.isNewBest && (
              <div className="rec-pulse mt-5 flex items-center gap-2 rounded-full border border-neon-yellow/50 bg-neon-yellow/10 px-5 py-2 text-sm font-bold text-neon-yellow">
                <Trophy size={16} /> {t.newBest}
              </div>
            )}

            <div className="mt-6 w-full">
              <div className="text-[10px] tracking-[0.3em] text-white/45">{t.finalScore}</div>
              <div className="text-glow-pink text-5xl font-black tabular-nums">{fmt(stats.score)}</div>
            </div>

            <div className="mt-6 grid w-full grid-cols-2 gap-2.5 text-left">
              {[
                { icon: Trophy, label: t.statBest, value: fmt(stats.best), color: "text-neon-yellow" },
                { icon: Flame, label: t.statMaxCombo, value: `×${stats.maxCombo}`, color: "text-neon-cyan" },
                { icon: Zap, label: t.statEnergy, value: String(stats.orbs), color: "text-neon-cyan" },
                { icon: Timer, label: t.statTime, value: fmtTime(stats.time), color: "text-neon-violet" },
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
              <div className="text-[10px] tracking-widest text-white/40">{t.closeCalls}</div>
              <div className="mt-1 text-lg font-bold">{t.grazes(stats.grazes, stats.level)}</div>
            </div>

            <button
              onClick={() => {
                clickUi();
                play();
              }}
              className="neon-btn neon-btn-pink mt-7 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-lg font-black tracking-widest"
            >
              <RotateCcw size={20} /> {t.tryAgain}
            </button>
            <button
              onClick={() => {
                clickUi();
                toMenu();
              }}
              className="neon-btn neon-btn-ghost mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <Home size={18} /> {t.toMenu}
            </button>
            <button
              onClick={() => {
                clickUi();
                setShopOpen(true);
              }}
              className="neon-btn neon-btn-ghost mt-2 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white/80"
            >
              <ShoppingBag size={18} /> {t.shop}
            </button>
            <div className="mt-4 text-[10px] text-white/35">{t.quickRestart}</div>
          </div>
        </div>
      )}

      {/* ============ МАГАЗИН ============ */}
      {shopOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="panel hud-pop flex h-[min(680px,88vh)] w-full max-w-lg flex-col rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xl font-black tracking-widest text-white">
                <ShoppingBag size={20} /> {t.shop}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-sm text-white/85">
                  <Coins size={14} className="text-neon-yellow" />
                  <span className="font-bold tabular-nums">{fmt(coins)}</span>
                </div>
                <button
                  onClick={() => {
                    clickUi();
                    setShopOpen(false);
                  }}
                  className="neon-btn neon-btn-ghost rounded-xl p-2 text-white/80"
                  aria-label={t.close}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* вкладки */}
            <div className="mt-4 flex gap-2">
              {(["ship", "trail", "color"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    clickUi();
                    setShopTab(tab);
                  }}
                  className={`neon-btn flex-1 rounded-xl py-2 text-xs font-bold tracking-widest ${shopTab === tab ? "neon-btn-cyan" : "neon-btn-ghost text-white/70"
                    }`}
                >
                  {tab === "ship" ? t.shopTabShip : tab === "trail" ? t.shopTabTrail : t.shopTabColor}
                </button>
              ))}
            </div>

            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              {/* корабли */}
              {shopTab === "ship" && (
                <div className="grid grid-cols-2 items-stretch gap-2.5">
                  {SHIPS.map((item) => {
                    const key = `ship:${item.id}`;
                    const owned = isOwned(shop, key);
                    const active = shop.ship === item.id;
                    return (
                      <div key={item.id} className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
                        <div className="text-sm font-bold text-white/90">{shipLabel(item.id)}</div>
                        <div className="mt-1 text-[11px] text-white/45">
                          {item.price === 0 ? "—" : `${item.price} ${t.coins.toLowerCase()}`}
                        </div>
                        <div className="mt-auto pt-2">
                          <button
                            onClick={() => selectOrBuy("ship", item.id, item.price)}
                            disabled={active}
                            className={`neon-btn w-full rounded-lg py-1.5 text-[11px] font-bold ${active ? "neon-btn-cyan" : owned ? "neon-btn-ghost" : "neon-btn-pink"
                              }`}
                          >
                            {active ? t.equipped : owned ? t.select : `${t.buy} · ${item.price}`}
                          </button>
                          {!owned && coins < item.price && (
                            <button
                              onClick={() => unlockViaAd("ship", item.id)}
                              className="neon-btn neon-btn-ghost mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white/70"
                            >
                              <Lock size={11} /> {t.watchAdUnlock}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* следы */}
              {shopTab === "trail" && (
                <div className="grid grid-cols-2 items-stretch gap-2.5">
                  {TRAILS.map((item) => {
                    const key = `trail:${item.id}`;
                    const owned = isOwned(shop, key);
                    const active = shop.trail === item.id;
                    return (
                      <div key={item.id} className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
                        <div className="text-sm font-bold text-white/90">{trailLabel(item.id)}</div>
                        <div className="mt-1 text-[11px] text-white/45">
                          {item.price === 0 ? "—" : `${item.price} ${t.coins.toLowerCase()}`}
                        </div>
                        <div className="mt-auto pt-2">
                          <button
                            onClick={() => selectOrBuy("trail", item.id, item.price)}
                            disabled={active}
                            className={`neon-btn w-full rounded-lg py-1.5 text-[11px] font-bold ${active ? "neon-btn-cyan" : owned ? "neon-btn-ghost" : "neon-btn-pink"
                              }`}
                          >
                            {active ? t.equipped : owned ? t.select : `${t.buy} · ${item.price}`}
                          </button>
                          {!owned && coins < item.price && (
                            <button
                              onClick={() => unlockViaAd("trail", item.id)}
                              className="neon-btn neon-btn-ghost mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white/70"
                            >
                              <Lock size={11} /> {t.watchAdUnlock}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* цвета — отдельно для корабля и следа, все бесплатные */}
              {shopTab === "color" && (
                <div className="flex flex-col gap-5">
                  <div>
                    <div className="text-xs font-bold tracking-widest text-white/60">{t.shipColorLabel}</div>
                    <div className="mt-2 flex flex-wrap gap-2.5">
                      {COLORS.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setColor("ship", c.hue)}
                          aria-label={c.id}
                          className="h-9 w-9 rounded-full border-2 transition-transform active:scale-90"
                          style={{
                            background: `hsl(${c.hue}, 100%, 65%)`,
                            borderColor: shop.shipColor === c.hue ? "#fff" : "rgba(255,255,255,0.15)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold tracking-widest text-white/60">{t.trailColorLabel}</div>
                    <div className="mt-2 flex flex-wrap gap-2.5">
                      {COLORS.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setColor("trail", c.hue)}
                          aria-label={c.id}
                          className="h-9 w-9 rounded-full border-2 transition-transform active:scale-90"
                          style={{
                            background: `hsl(${c.hue}, 100%, 65%)`,
                            borderColor: shop.trailColor === c.hue ? "#fff" : "rgba(255,255,255,0.15)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
