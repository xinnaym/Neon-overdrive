/* ============================================================
   ПРОТОТИП магазина скинов: корабль / след / цвет.
   Каталог + персист в localStorage. Косметика применяется в
   движок через engine.setCosmetics(...).
   ============================================================ */

export type ShipId = "classic" | "circle" | "star" | "diamond" | "smile";
export type TrailId = "glow" | "fade" | "dash" | "dotted" | "ribbon";

export interface CatalogItem {
  id: string;
  price: number; // 0 = бесплатно
}

export const SHIPS: (CatalogItem & { id: ShipId })[] = [
  { id: "classic", price: 0 },
  { id: "circle", price: 100 },
  { id: "star", price: 100 },
  { id: "diamond", price: 100 },
  { id: "smile", price: 100 },
];

export const TRAILS: (CatalogItem & { id: TrailId })[] = [
  { id: "glow", price: 0 },
  { id: "fade", price: 100 },
  { id: "dash", price: 100 },
  { id: "dotted", price: 100 },
  { id: "ribbon", price: 100 },
];

// бесплатная палитра — можно назначать отдельно кораблю и следу
export const COLORS: { id: string; hue: number }[] = [
  { id: "pink", hue: 325 },
  { id: "cyan", hue: 190 },
  { id: "violet", hue: 265 },
  { id: "yellow", hue: 46 },
  { id: "green", hue: 140 },
  { id: "orange", hue: 24 },
  { id: "blue", hue: 215 },
  { id: "red", hue: 355 },
  { id: "mint", hue: 165 },
  { id: "lime", hue: 90 },
  { id: "magenta", hue: 300 },
  { id: "gold", hue: 40 },
];

export interface ShopState {
  owned: string[]; // "ship:wing", "trail:dash"
  ship: ShipId;
  trail: TrailId;
  shipColor: number | null; // hue или null = дефолт по прогрессу игры
  trailColor: number | null;
}

const KEY = "neon-overdrive-shop";

function defaultState(): ShopState {
  return { owned: ["ship:classic", "trail:glow"], ship: "classic", trail: "glow", shipColor: null, trailColor: null };
}

export function loadShop(): ShopState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<ShopState>;
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

export function saveShop(s: ShopState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function isOwned(s: ShopState, key: string): boolean {
  return s.owned.includes(key) || key.endsWith(":classic") || key.endsWith(":glow");
}
