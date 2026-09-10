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

function loadSdkScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YaGames) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    // относительный путь — для хостинга на сервере Яндекса (рекомендуемый вариант).
    // при деплое на свой домен заменить на "https://sdk.games.s3.yandex.net/sdk.js"
    script.src = "/sdk.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Yandex SDK script failed to load"));
    document.head.appendChild(script);
  });
}

export async function initYandex(): Promise<YandexSDK | null> {
  try {
    await loadSdkScript();
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
