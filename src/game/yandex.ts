/* ============================================================
   Обёртка над YaGames SDK. Всё опционально: если SDK нет
   (локальный запуск) — игра работает как обычно.
   ============================================================ */

export interface YandexPlayer {
  getMode?(): string;
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}

export interface YandexSDK {
  features?: {
    GameplayAPI?: { start(): void; stop(): void };
    LoadingAPI?: { ready(): void };
  };
  environment?: { i18n?: { lang?: string } };
  getPlayer?: (options?: { scopes?: boolean }) => Promise<YandexPlayer>;
  getLeaderboards?: () => Promise<{
    setLeaderboardScore(name: string, score: number): Promise<unknown>;
    getLeaderboardEntries(
      name: string,
      options?: { quantityTop?: number; includeUser?: boolean },
    ): Promise<{ entries: LeaderboardEntry[] }>;
  }>;
  adv?: {
    showFullscreenAdv(params: {
      callbacks?: {
        onOpen?: () => void;
        onClose?: (wasShown: boolean) => void;
        onError?: (error: unknown) => void;
        onOffline?: () => void;
      };
    }): void;
    showRewardedVideo(params: {
      callbacks?: {
        onOpen?: () => void;
        onRewarded?: () => void;
        onClose?: () => void;
        onError?: (error: unknown) => void;
      };
    }): void;
  };
}

export interface LeaderboardEntry {
  score: number;
  rank: number;
  player: { publicName?: string; uniqueID?: string };
}

/** Язык интерфейса из SDK. Поддерживаем ru/en, остальное — фолбэк на ru. */
export function getYandexLang(sdk: YandexSDK | null): "ru" | "en" {
  return sdk?.environment?.i18n?.lang === "en" ? "en" : "ru";
}

/**
 * Игрок для облачных сохранений. scopes:false — не запрашиваем разрешение
 * на доступ к имени/аватарке, нам нужны только данные best-score.
 */
export async function getYandexPlayer(sdk: YandexSDK | null): Promise<YandexPlayer | null> {
  try {
    const player = await sdk?.getPlayer?.({ scopes: false });
    return player ?? null;
  } catch {
    return null;
  }
}

/** "lite" — анонимный (неавторизованный) игрок, для него нет облака. */
export function isPlayerAuthorized(player: YandexPlayer | null): boolean {
  try {
    return !!player && player.getMode?.() !== "lite";
  } catch {
    return false;
  }
}

export async function loadCloudBest(player: YandexPlayer | null): Promise<number | null> {
  if (!player) return null;
  try {
    const data = await player.getData(["best"]);
    const v = Number(data?.best);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return null;
  }
}

export async function saveCloudBest(player: YandexPlayer | null, value: number): Promise<void> {
  if (!player) return;
  try {
    await player.setData({ best: value }, true);
  } catch {
    /* ignore */
  }
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSDK> };
  }
}

function waitForYaGames(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YaGames) {
      resolve();
      return;
    }
    const start = performance.now();
    const iv = setInterval(() => {
      if (window.YaGames) {
        clearInterval(iv);
        resolve();
      } else if (performance.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error("Yandex SDK script (/sdk.js) did not load in time"));
      }
    }, 50);
  });
}

export async function initYandex(): Promise<YandexSDK | null> {
  try {
    // скрипт /sdk.js подключён статически в index.html (обязательное
    // требование — Яндекс проксирует/подменяет этот путь только для
    // тега, присутствующего в исходной разметке). Ждём его загрузки,
    // т.к. атрибут async не гарантирует, что он готов раньше нашего
    // модульного бандла.
    await waitForYaGames();
    if (!window.YaGames) return null;
    return await window.YaGames.init();
  } catch {
    return null;
  }
}

/**
 * Сигнал платформе "игра готова к игре" (п.1.19 Требований платформы).
 * Вызывать ТОЛЬКО когда интерфейс реально отрисован и доступен для
 * взаимодействия — не сразу после готовности SDK. См. вызов в App.tsx:
 * двойной requestAnimationFrame гарантирует, что браузер уже отрисовал
 * кадр с меню на экране.
 */
export function notifyGameReady(sdk: YandexSDK | null) {
  try {
    sdk?.features?.LoadingAPI?.ready();
  } catch {
    /* ignore */
  }
}

export function gameplayStart(sdk: YandexSDK | null) {
  try {
    sdk?.features?.GameplayAPI?.start();
  } catch {
    /* ignore */
  }
}

export function gameplayStop(sdk: YandexSDK | null) {
  try {
    sdk?.features?.GameplayAPI?.stop();
  } catch {
    /* ignore */
  }
}

/**
 * Показывает полноэкранную рекламу, если это разрешит сам SDK
 * (частота показов, оффлайн и т.д. — на стороне Яндекса, мы просто
 * реагируем на итог через колбэки). Перед вызовом GameplayAPI уже
 * должен быть остановлен (см. App.tsx: gameplayStop идёт раньше).
 */
export function showInterstitial(
  sdk: YandexSDK | null,
  onClose?: (wasShown: boolean) => void,
) {
  try {
    if (!sdk?.adv?.showFullscreenAdv) {
      onClose?.(false);
      return;
    }
    sdk.adv.showFullscreenAdv({
      callbacks: {
        onClose: (wasShown) => onClose?.(wasShown),
        onError: () => onClose?.(false),
        onOffline: () => onClose?.(false),
      },
    });
  } catch {
    onClose?.(false);
  }
}

export async function saveScore(sdk: YandexSDK | null, score: number) {
  try {
    const lb = await sdk?.getLeaderboards?.();
    await lb?.setLeaderboardScore("leaderbordScore", Math.floor(score));
  } catch {
    /* ignore */
  }
}

/** Рекламный анлок скина в магазине. onReward(true) — только если ролик реально досмотрен. */
export function showRewardedVideo(sdk: YandexSDK | null, onReward: (rewarded: boolean) => void) {
  try {
    if (!sdk?.adv?.showRewardedVideo) {
      onReward(false);
      return;
    }
    let rewarded = false;
    sdk.adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => {
          rewarded = true;
        },
        onClose: () => onReward(rewarded),
        onError: () => onReward(false),
      },
    });
  } catch {
    onReward(false);
  }
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
}

export async function loadLeaderboardTop(sdk: YandexSDK | null, quantityTop = 10): Promise<LeaderboardRow[]> {
  try {
    const lb = await sdk?.getLeaderboards?.();
    const res = await lb?.getLeaderboardEntries("leaderbordScore", { quantityTop, includeUser: false });
    return (res?.entries ?? []).map((e) => ({
      rank: e.rank,
      name: e.player?.publicName || "—",
      score: e.score,
    }));
  } catch {
    return [];
  }
}
