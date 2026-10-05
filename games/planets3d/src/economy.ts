/**
 * Friend Planets economy: earn RF by playing, spend it in the shop.
 *
 * SIMULATED. Every balance, price and payout here lives in this browser only:
 * no wallet, no signature, no transaction. The Rare Friends team plugs in real
 * $RAREFRIENDS later; this file is the one place to tune or swap that in.
 *
 * Everything you buy is fixed-price and you always know what you get: no loot
 * boxes, no mystery packs, nothing staked on chance.
 */
import { FISH } from "./data";
import { BUGS, FAMILY_TREASURE, TREASURES } from "./extras";
import type { Progress } from "./progress";

export const SIMULATED = true;
export const START_RF = 50;

/** RF paid straight to your wallet for playing well. */
export const EARN = {
  daily: 20,
  quest: 15,
  sportWin: 12, sportPlay: 3,
  landingPerfect: 3, landingNice: 1,
  raceFast: 10, raceMid: 6, raceSlow: 3,
} as const;

/** What the market pays for what you collect, by rarity (1 common … 4 legendary). */
const SELL_BY_RARITY = {
  fish: [0, 4, 8, 18, 45],
  treasure: [0, 3, 6, 15, 40],
  bug: [0, 2, 5, 12, 30],
} as const;
const CROP_PRICE = 3;

export type ItemKind = "rocket" | "hat" | "item" | "gear";
export interface ShopItem { id: string; kind: ItemKind; name: string; icon: string; price: number; text: string; colors?: [string, string]; hat?: string }

export const SHOP: ShopItem[] = [
  // Rocket paint: the body stripe and nose / trim colours.
  { id: "rocket:home", kind: "rocket", name: "Home colours", icon: "🚀", price: 0, text: "Your planet's own paint" },
  { id: "rocket:sunset", kind: "rocket", name: "Sunset", icon: "🌅", price: 40, text: "Warm orange and gold", colors: ["#ff7a59", "#ffd166"] },
  { id: "rocket:ocean", kind: "rocket", name: "Ocean", icon: "🌊", price: 40, text: "Deep blue with sky trim", colors: ["#2f6fdb", "#8ecae6"] },
  { id: "rocket:mint", kind: "rocket", name: "Mint", icon: "🍃", price: 40, text: "Fresh green and cream", colors: ["#3fae7a", "#e9f5d0"] },
  { id: "rocket:candy", kind: "rocket", name: "Candy", icon: "🍬", price: 60, text: "Pink and sky blue", colors: ["#f27bb5", "#9fd8ff"] },
  { id: "rocket:midnight", kind: "rocket", name: "Midnight", icon: "🌙", price: 80, text: "Ink black, silver trim", colors: ["#2b2d42", "#c9d1e0"] },
  { id: "rocket:gold", kind: "rocket", name: "Gold", icon: "🏆", price: 150, text: "For the richest pilots", colors: ["#e0a91f", "#fff1a8"] },
  // Hats: worn on your planet, and other players online see them.
  { id: "hat:none", kind: "hat", name: "No hat", icon: "—", price: 0, text: "Just your Friend" },
  { id: "hat:cap", kind: "hat", name: "Cap", icon: "🧢", price: 25, text: "Casual explorer", hat: "🧢" },
  { id: "hat:bow", kind: "hat", name: "Bow", icon: "🎀", price: 25, text: "Cute and tidy", hat: "🎀" },
  { id: "hat:flower", kind: "hat", name: "Flower", icon: "🌸", price: 30, text: "Fresh from the farm", hat: "🌸" },
  { id: "hat:grad", kind: "hat", name: "Scholar", icon: "🎓", price: 45, text: "Knows every fish", hat: "🎓" },
  { id: "hat:top", kind: "hat", name: "Top hat", icon: "🎩", price: 70, text: "Very fancy", hat: "🎩" },
  { id: "hat:crown", kind: "hat", name: "Crown", icon: "👑", price: 200, text: "Ruler of the galaxy", hat: "👑" },
  // Items you use up.
  { id: "item:bait", kind: "item", name: "Golden bait", icon: "🪱", price: 15, text: "Your next fishing trip has a rare fish in the pond. Catch it if you can!" },
  { id: "item:fert", kind: "item", name: "Fertilizer", icon: "🧪", price: 8, text: "Instantly ripens every crop on the planet you're on" },
  // Upgrades you keep.
  { id: "gear:rod", kind: "gear", name: "Pro rod", icon: "🎣", price: 120, text: "Line tension builds 30% slower in fish fights" },
  { id: "gear:board", kind: "gear", name: "Turbo board", icon: "🛹", price: 100, text: "Hoverboard rides 15% faster in ring races" },
  { id: "gear:seeds", kind: "gear", name: "Super seeds", icon: "🌱", price: 90, text: "Every harvest gives 2 crops" },
];
export const itemById = (id: string) => SHOP.find(i => i.id === id);

/** What the wallet adds to your save. Old saves start with START_RF and nothing else. */
export interface Wallet {
  rf: number;
  bag: Record<string, number>; // "fish:Blue gill" → how many you're carrying
  owned: string[];
  equip: { rocket: string; hat: string };
  items: Record<string, number>; // consumables
  daily: string; // last day the daily bonus was claimed (YYYY-MM-DD)
  earned: number; spent: number; // lifetime totals
}
export function walletOf(p: Progress): Wallet {
  p.wallet ??= { rf: START_RF, bag: {}, owned: ["rocket:home", "hat:none"], equip: { rocket: "rocket:home", hat: "hat:none" }, items: {}, daily: "", earned: 0, spent: 0 };
  return p.wallet;
}

/** One entry per thing you can carry and sell. */
export interface Goods { key: string; name: string; icon: string; price: number }
const GOODS = new Map<string, Goods>();
for (const f of FISH) GOODS.set(`fish:${f.name}`, { key: `fish:${f.name}`, name: f.name, icon: "🐟", price: SELL_BY_RARITY.fish[f.rarity] });
for (const t of [...TREASURES, ...FAMILY_TREASURE]) GOODS.set(`treasure:${t.name}`, { key: `treasure:${t.name}`, name: t.name, icon: t.icon, price: SELL_BY_RARITY.treasure[t.rarity] });
for (const b of BUGS) GOODS.set(`bug:${b.name}`, { key: `bug:${b.name}`, name: b.name, icon: "🦋", price: SELL_BY_RARITY.bug[b.rarity] });
export function goodsOf(key: string): Goods {
  const known = GOODS.get(key); if (known) return known;
  const [kind, name = key] = key.split(":");
  return { key, name, icon: kind === "crop" ? "🌾" : "📦", price: kind === "crop" ? CROP_PRICE : 1 };
}

export function earn(p: Progress, amount: number) { const w = walletOf(p); w.rf += amount; w.earned += amount; }
export function stash(p: Progress, key: string, n = 1) { const w = walletOf(p); w.bag[key] = (w.bag[key] ?? 0) + n; }

/** Sell one stack (or everything with key "all"). Returns RF received. */
export function sell(p: Progress, key: string): number {
  const w = walletOf(p);
  let total = 0;
  for (const k of key === "all" ? Object.keys(w.bag) : [key]) {
    const n = w.bag[k] ?? 0; if (!n) continue;
    total += n * goodsOf(k).price; delete w.bag[k];
  }
  earn(p, total);
  return total;
}

export type BuyResult = { ok: true; item: ShopItem } | { ok: false; why: string };
export function buy(p: Progress, id: string): BuyResult {
  const w = walletOf(p), item = itemById(id);
  if (!item) return { ok: false, why: "That item doesn't exist." };
  const consumable = item.kind === "item";
  if (!consumable && w.owned.includes(id)) return { ok: false, why: "You already own that." };
  if (w.rf < item.price) return { ok: false, why: `You need ${item.price - w.rf} more RF.` };
  w.rf -= item.price; w.spent += item.price;
  if (consumable) w.items[id] = (w.items[id] ?? 0) + 1;
  else {
    w.owned.push(id);
    if (item.kind === "rocket" || item.kind === "hat") w.equip[item.kind] = id;
  }
  return { ok: true, item };
}
export const has = (p: Progress, id: string) => walletOf(p).owned.includes(id);
export function useItem(p: Progress, id: string) {
  const w = walletOf(p); if (!w.items[id]) return false;
  w.items[id]--; if (!w.items[id]) delete w.items[id];
  return true;
}

/** Claims today's bonus if it hasn't been claimed yet. Returns RF paid (0 if already claimed). */
export function claimDaily(p: Progress, now = new Date()): number {
  const w = walletOf(p), today = now.toISOString().slice(0, 10);
  if (w.daily === today) return 0;
  w.daily = today; earn(p, EARN.daily);
  return EARN.daily;
}
