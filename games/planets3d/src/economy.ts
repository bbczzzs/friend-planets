/**
 * Friend Planets economy. Two currencies:
 *
 * - ★ Stars: earned by playing (catches, harvests, quests, sports, races, landings)
 *   and by selling what you collect at the market. They cost nobody anything, so
 *   they buy the everyday things: bait, fertilizer, upgrades, starter cosmetics.
 * - RF ($RAREFRIENDS): the game never gives any out. It only comes from the
 *   player's own wallet and buys premium cosmetics (hats, rocket paint, auras),
 *   which other players see online. Premium is cosmetic only: nobody pays to win.
 *
 * Every RF purchase becomes an Order handed to payments.ts, which the Rare Friends
 * team settles on-chain (simulated until they plug it in). Buying on another
 * Friend's planet gives that Friend's owner a cut, recorded in the order, so RF
 * that reaches players comes from other players' purchases. Everything is
 * fixed-price: no loot boxes, no mystery packs, nothing staked on chance.
 * See ECONOMY.md.
 */
import { FISH } from "./data";
import { BUGS, FAMILY_TREASURE, TREASURES } from "./extras";
import type { Progress } from "./progress";

/** How each RF purchase is split (shares of the price). Confirm with the Rare Friends team. */
export const RF_SPLIT = { builder: 0.75, rareFriends: 0.25 } as const;
/** On another Friend's planet, this share of the price goes to that Friend's owner (out of the builder's share). */
export const OWNER_CUT = 0.1;
/** Stars for the first visit each day. */
export const DAILY_STARS = 25;

/** What the market pays in ★ for what you collect, by rarity (1 common … 4 legendary). */
const SELL_BY_RARITY = {
  fish: [0, 10, 20, 45, 110],
  treasure: [0, 8, 15, 40, 100],
  bug: [0, 5, 12, 30, 75],
} as const;
const CROP_PRICE = 8;

export type Currency = "star" | "rf";
export type ItemKind = "hat" | "rocket" | "aura" | "item" | "gear";
export interface ShopItem {
  id: string; kind: ItemKind; name: string; icon: string; price: number; currency: Currency; text: string;
  colors?: [string, string]; hat?: string; aura?: { color: string; sparkle: string };
}

export const SHOP: ShopItem[] = [
  // Hats: worn on your planet, and other players online see them.
  { id: "hat:none", kind: "hat", name: "No hat", icon: "—", price: 0, currency: "star", text: "Just your Friend" },
  { id: "hat:cap", kind: "hat", name: "Cap", icon: "🧢", price: 80, currency: "star", text: "Casual explorer", hat: "🧢" },
  { id: "hat:bow", kind: "hat", name: "Bow", icon: "🎀", price: 80, currency: "star", text: "Cute and tidy", hat: "🎀" },
  { id: "hat:flower", kind: "hat", name: "Flower", icon: "🌸", price: 120, currency: "star", text: "Fresh from the farm", hat: "🌸" },
  { id: "hat:grad", kind: "hat", name: "Scholar", icon: "🎓", price: 25, currency: "rf", text: "Knows every fish in the galaxy", hat: "🎓" },
  { id: "hat:top", kind: "hat", name: "Top hat", icon: "🎩", price: 40, currency: "rf", text: "For Friends of distinction", hat: "🎩" },
  { id: "hat:phones", kind: "hat", name: "DJ phones", icon: "🎧", price: 60, currency: "rf", text: "The galaxy is your dance floor", hat: "🎧" },
  { id: "hat:crown", kind: "hat", name: "Crown", icon: "👑", price: 150, currency: "rf", text: "Ruler of the galaxy. Everyone will know.", hat: "👑" },
  // Rocket paint: the body stripe and nose / trim colours.
  { id: "rocket:home", kind: "rocket", name: "Home colours", icon: "🚀", price: 0, currency: "star", text: "Your planet's own paint" },
  { id: "rocket:sunset", kind: "rocket", name: "Sunset", icon: "🌅", price: 150, currency: "star", text: "Warm orange and gold", colors: ["#ff7a59", "#ffd166"] },
  { id: "rocket:ocean", kind: "rocket", name: "Ocean", icon: "🌊", price: 150, currency: "star", text: "Deep blue with sky trim", colors: ["#2f6fdb", "#8ecae6"] },
  { id: "rocket:mint", kind: "rocket", name: "Mint", icon: "🍃", price: 30, currency: "rf", text: "Fresh green and cream", colors: ["#3fae7a", "#e9f5d0"] },
  { id: "rocket:midnight", kind: "rocket", name: "Midnight", icon: "🌙", price: 50, currency: "rf", text: "Ink black, silver trim", colors: ["#2b2d42", "#c9d1e0"] },
  { id: "rocket:gold", kind: "rocket", name: "Solid gold", icon: "🏆", price: 120, currency: "rf", text: "For the richest pilots", colors: ["#e0a91f", "#fff1a8"] },
  // Auras: a glowing ring and sparkles around your Friend, seen by everyone on your planet.
  { id: "aura:none", kind: "aura", name: "No aura", icon: "—", price: 0, currency: "star", text: "Keep it simple" },
  { id: "aura:frost", kind: "aura", name: "Frost", icon: "❄️", price: 35, currency: "rf", text: "Cool blue shimmer", aura: { color: "#9fe6ff", sparkle: "#e8fbff" } },
  { id: "aura:ember", kind: "aura", name: "Ember", icon: "🔥", price: 35, currency: "rf", text: "Warm drifting sparks", aura: { color: "#ff9a70", sparkle: "#ffd27a" } },
  { id: "aura:meadow", kind: "aura", name: "Meadow", icon: "🍀", price: 35, currency: "rf", text: "Fresh green glow", aura: { color: "#8edb7c", sparkle: "#e9ffd8" } },
  { id: "aura:starlight", kind: "aura", name: "Starlight", icon: "✨", price: 80, currency: "rf", text: "Bright white stars that follow you", aura: { color: "#f7f4ec", sparkle: "#ffffff" } },
  { id: "aura:golden", kind: "aura", name: "Golden", icon: "🌟", price: 140, currency: "rf", text: "The rarest glow in the galaxy", aura: { color: "#f2c46b", sparkle: "#fff1a8" } },
  // Items you use up.
  { id: "item:bait", kind: "item", name: "Golden bait", icon: "🪱", price: 40, currency: "star", text: "Your next fishing trip has a rare fish in the pond. Catch it if you can!" },
  { id: "item:fert", kind: "item", name: "Fertilizer", icon: "🧪", price: 25, currency: "star", text: "Instantly ripens every crop on the planet you're on" },
  // Upgrades you keep.
  { id: "gear:rod", kind: "gear", name: "Pro rod", icon: "🎣", price: 400, currency: "star", text: "Line tension builds 30% slower in fish fights" },
  { id: "gear:board", kind: "gear", name: "Turbo board", icon: "🛹", price: 350, currency: "star", text: "Hoverboard rides 15% faster in ring races" },
  { id: "gear:seeds", kind: "gear", name: "Super seeds", icon: "🌱", price: 300, currency: "star", text: "Every harvest gives 2 crops" },
];
export const itemById = (id: string) => SHOP.find(i => i.id === id);

/**
 * This week's featured shelf: three premium items, rotating every Monday (UTC).
 * Everything comes back around later; the rotation is just a spotlight.
 */
export function featured(now = Date.now()) {
  const premium = SHOP.filter(i => i.currency === "rf");
  const week = Math.floor((now / 86_400_000 + 3) / 7); // weeks since a Monday
  const picks: ShopItem[] = [];
  for (let k = 0; picks.length < 3 && k < premium.length * 2; k++) {
    const item = premium[(week * 5 + k * 7) % premium.length];
    if (!picks.includes(item)) picks.push(item);
  }
  const ends = (week + 1) * 7 * 86_400_000 - 3 * 86_400_000;
  return { items: picks, endsInDays: Math.max(1, Math.ceil((ends - now) / 86_400_000)) };
}

/** One RF purchase, as handed to payments.ts (and kept in the save while simulated). */
export interface Order {
  id: string;
  item: string;
  price: number; // RF (whole tokens)
  buyer: string; // buyer's Friend token number
  planetOwner: number | null; // Friend whose planet it was bought on (gets OWNER_CUT), or null at home
  split: { builder: number; rareFriends: number; planetOwner: number }; // RF amounts, summing to price
  at: number; // ms since epoch
  tx?: string;
}

/** What the wallet adds to your save. */
export interface Wallet {
  v: 2;
  bag: Record<string, number>; // "fish:Blue gill" → how many you're carrying
  owned: string[];
  equip: { rocket: string; hat: string; aura: string };
  items: Record<string, number>; // consumables
  daily: string; // last day the daily bonus was claimed (YYYY-MM-DD)
  orders: Order[]; // last RF purchases (simulated ledger)
}
const STARTER = ["rocket:home", "hat:none", "aura:none"];
const freshWallet = (): Wallet => ({ v: 2, bag: {}, owned: [...STARTER], equip: { rocket: "rocket:home", hat: "hat:none", aura: "aura:none" }, items: {}, daily: "", orders: [] });
export function walletOf(p: Progress): Wallet {
  const w = p.wallet as (Wallet | { v?: number } | undefined);
  if (!w || w.v !== 2) {
    // The first version handed out RF for playing: keep what was carried and bought, drop that balance.
    const old = w as Partial<Wallet> | undefined, fresh = freshWallet();
    if (old) {
      fresh.bag = old.bag ?? {}; fresh.items = old.items ?? {}; fresh.daily = old.daily ?? "";
      fresh.owned = [...new Set([...STARTER, ...(old.owned ?? [])])].filter(id => itemById(id));
      if (old.equip) fresh.equip = { ...fresh.equip, ...old.equip };
      for (const k of ["rocket", "hat", "aura"] as const) if (!fresh.owned.includes(fresh.equip[k])) fresh.equip[k] = `${k}:${k === "rocket" ? "home" : "none"}`;
    }
    p.wallet = fresh;
  }
  return p.wallet!;
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

export function stash(p: Progress, key: string, n = 1) { const w = walletOf(p); w.bag[key] = (w.bag[key] ?? 0) + n; }

/** Sell one stack (or everything with key "all") for ★. Returns stars received. */
export function sell(p: Progress, key: string): number {
  const w = walletOf(p);
  let total = 0;
  for (const k of key === "all" ? Object.keys(w.bag) : [key]) {
    const n = w.bag[k] ?? 0; if (!n) continue;
    total += n * goodsOf(k).price; delete w.bag[k];
  }
  p.stars += total;
  return total;
}

export type BuyCheck = { ok: true; item: ShopItem } | { ok: false; why: string };
/** Can this item be bought? (RF items: the wallet decides at checkout.) */
export function canBuy(p: Progress, id: string): BuyCheck {
  const w = walletOf(p), item = itemById(id);
  if (!item) return { ok: false, why: "That item doesn't exist." };
  if (item.kind !== "item" && w.owned.includes(id)) return { ok: false, why: "You already own that." };
  if (item.currency === "star" && p.stars < item.price) return { ok: false, why: `You need ${item.price - p.stars} more ★. Sell catches at the market or finish quests.` };
  return { ok: true, item };
}
/** Takes ★ for star items (RF is paid through payments.ts first) and hands the item over. */
export function grant(p: Progress, item: ShopItem) {
  const w = walletOf(p);
  if (item.currency === "star") p.stars -= item.price;
  if (item.kind === "item") w.items[item.id] = (w.items[item.id] ?? 0) + 1;
  else {
    if (!w.owned.includes(item.id)) w.owned.push(item.id);
    if (item.kind === "rocket" || item.kind === "hat" || item.kind === "aura") w.equip[item.kind] = item.id;
  }
}
/** The RF split for a purchase made on `planetOwner`'s planet (null at home). */
export function splitFor(price: number, planetOwner: number | null) {
  const cents = (x: number) => Math.round(x * 100) / 100;
  const owner = planetOwner === null ? 0 : cents(price * OWNER_CUT), rareFriends = cents(price * RF_SPLIT.rareFriends);
  return { builder: cents(price - rareFriends - owner), rareFriends, planetOwner: owner };
}

export const has = (p: Progress, id: string) => walletOf(p).owned.includes(id);
export function useItem(p: Progress, id: string) {
  const w = walletOf(p); if (!w.items[id]) return false;
  w.items[id]--; if (!w.items[id]) delete w.items[id];
  return true;
}

/** Claims today's ★ bonus if it hasn't been claimed yet. Returns stars paid (0 if already claimed). */
export function claimDaily(p: Progress, now = new Date()): number {
  const w = walletOf(p), today = now.toISOString().slice(0, 10);
  if (w.daily === today) return 0;
  w.daily = today; p.stars += DAILY_STARS;
  return DAILY_STARS;
}

/** Bundles: a complete look, 20% off the pieces you don't own yet (so owning one piece never costs you). */
export interface Bundle { id: string; name: string; icon: string; text: string; items: string[]; discount: number }
export const BUNDLES: Bundle[] = [
  { id: "bundle:royal", name: "Royal set", icon: "👑", text: "Crown, Golden aura and a Solid gold rocket", items: ["hat:crown", "aura:golden", "rocket:gold"], discount: 0.2 },
  { id: "bundle:night", name: "Night sky set", icon: "🌙", text: "Top hat, Starlight aura and Midnight paint", items: ["hat:top", "aura:starlight", "rocket:midnight"], discount: 0.2 },
  { id: "bundle:party", name: "Party set", icon: "🎧", text: "DJ phones, Ember aura and Mint paint", items: ["hat:phones", "aura:ember", "rocket:mint"], discount: 0.2 },
];

/** What a checkout sells: one RF item, or a bundle priced for what you already own. */
export interface Offer { id: string; name: string; icon: string; text: string; price: number; full: number; looks: ShopItem[]; pieces: ShopItem[]; single: ShopItem | null } // looks: what you'd get; pieces: the whole set
export function offerFor(id: string, owned: string[]): Offer | null {
  const item = itemById(id);
  if (item) return item.currency === "rf" ? { id, name: item.name, icon: item.icon, text: item.text, price: item.price, full: item.price, looks: [item], pieces: [item], single: item } : null;
  const b = BUNDLES.find(x => x.id === id); if (!b) return null;
  const pieces = b.items.map(i => itemById(i)!), missing = pieces.filter(i => !owned.includes(i.id));
  const full = missing.reduce((n, i) => n + i.price, 0);
  return { id, name: b.name, icon: b.icon, text: b.text, price: Math.round(full * (1 - b.discount)), full, looks: missing.length ? missing : pieces, pieces, single: null };
}
