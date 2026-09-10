/* ============================================================
   Обёртка над YaGames SDK. Всё опционально: если SDK нет
   (локальный запуск) — игра работает как обычно.
   ============================================================ */

export interface YandexSDK {
  features?: {
    GameplayAPI?: { start(): void; stop(): void };
    LoadingAPI?: { ready(): void };
  };
  getLeaderboards?: () => Promise<{
    setLeaderboardScore(name: string, score: number): Promise<unknown>;
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
  };
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
    const sdk = await window.YaGames.init();
    sdk.features?.LoadingAPI?.ready();
    return sdk;
  } catch {
    return null;
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
    await lb?.setLeaderboardScore("neonoverdrive", Math.floor(score));
  } catch {
    /* ignore */
  }
}
