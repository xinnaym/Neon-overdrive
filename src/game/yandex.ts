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
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YandexSDK> };
  }
}

export async function initYandex(): Promise<YandexSDK | null> {
  try {
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

export async function saveScore(sdk: YandexSDK | null, score: number) {
  try {
    const lb = await sdk?.getLeaderboards?.();
    await lb?.setLeaderboardScore("neonoverdrive", Math.floor(score));
  } catch {
    /* ignore */
  }
}
