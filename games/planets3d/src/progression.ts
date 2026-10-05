/**
 * Progression: an explorer level that grows with every ★ you earn (with a title
 * and, at milestones, looks you can't buy), and the Galaxy Pass, a monthly
 * season of 20 tiers filled by playing. The free track pays Stars and items;
 * the premium track (bought once with RF) adds four season-only looks. Every
 * reward is listed up front; nothing is left to chance.
 */
import { itemById, type Offer, type ShopItem } from "./economy";
import type { Progress } from "./progress";

// ---------------------------------------------------------------- levels
export const MAX_LEVEL = 50;
/** Stars needed to go from level n to n + 1. */
const stepFor = (n: number) => 60 + 30 * (n - 1);
export function levelOf(xp: number) {
  let level = 1, left = xp;
  while (level < MAX_LEVEL && left >= stepFor(level)) { left -= stepFor(level); level++; }
  return { level, into: left, need: level < MAX_LEVEL ? stepFor(level) : 1 };
}
const TITLES: [number, string][] = [[1, "Newcomer"], [3, "Wanderer"], [6, "Explorer"], [10, "Pathfinder"], [15, "Star Pilot"], [20, "Voyager"], [30, "Galaxy Legend"], [40, "Cosmic Icon"]];
export function titleFor(level: number) { let t = TITLES[0][1]; for (const [at, name] of TITLES) if (level >= at) t = name; return t; }
/** Looks you earn by levelling up (never sold). */
export const LEVEL_UNLOCKS: Record<number, string> = { 5: "hat:pin", 10: "hat:medal", 15: "aura:wayfinder", 20: "rocket:veteran", 30: "hat:laurel", 40: "aura:legend" };
export const LEVEL_UP_STARS = 20;
export function nextUnlock(level: number) {
  const at = Object.keys(LEVEL_UNLOCKS).map(Number).sort((a, b) => a - b).find(l => l > level);
  return at ? { level: at, item: itemById(LEVEL_UNLOCKS[at])! } : null;
}

// ---------------------------------------------------------------- Galaxy Pass
export const TIERS = 20, TIER_XP = 120;
export const PASS_PRICE = 99; // RF
const SEASON_NAMES = ["Frost", "Lantern", "Bloom", "Rain", "Meadow", "Tide", "Ember", "Harvest", "Mist", "Hollow", "Aurora", "Comet"];
/** Seasons run by calendar month (UTC). */
export function seasonNow(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), end = Date.UTC(y, m + 1, 1);
  return { id: `${y}-${String(m + 1).padStart(2, "0")}`, name: `Season of ${SEASON_NAMES[m]}`, endsInDays: Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000)), set: m % 2 };
}
/** The four season-only looks (two sets, alternating months). */
const PASS_LOOKS = [
  { 5: "hat:sunhat", 10: "aura:nebula", 15: "rocket:aurora", 20: "hat:comet" },
  { 5: "hat:shroom", 10: "aura:comet", 15: "rocket:nebula", 20: "hat:disco" },
] as Record<number, string>[];
export type PassReward = { stars?: number; item?: string; count?: number };
export interface TierView { tier: number; free: PassReward; premium: PassReward; reached: boolean; freeClaimed: boolean; premiumClaimed: boolean }
function rewardsFor(tier: number, set: number): { free: PassReward; premium: PassReward } {
  const free: PassReward = tier % 5 === 0 ? { stars: tier === 20 ? 150 : 60 } : tier % 2 ? { stars: 25 } : { item: tier % 4 === 0 ? "item:fert" : "item:bait", count: 1 };
  const look = PASS_LOOKS[set][tier];
  const premium: PassReward = look ? { item: look } : tier % 4 === 1 ? { stars: 50 } : tier % 4 === 2 ? { item: "item:bait", count: 2 } : tier % 4 === 3 ? { item: "item:fert", count: 2 } : { stars: 80 };
  return { free, premium };
}
export interface SeasonState { id: string; xp: number; premium: boolean; claimed: string[] } // claimed: "f3", "p5"
export function seasonOf(p: Progress): SeasonState {
  const s = seasonNow();
  if (!p.season || p.season.id !== s.id) p.season = { id: s.id, xp: 0, premium: false, claimed: [] };
  return p.season;
}
export function passTiers(p: Progress): TierView[] {
  const st = seasonOf(p), set = seasonNow().set;
  return Array.from({ length: TIERS }, (_, i) => {
    const tier = i + 1, r = rewardsFor(tier, set);
    return { tier, ...r, reached: st.xp >= tier * TIER_XP, freeClaimed: st.claimed.includes(`f${tier}`), premiumClaimed: st.claimed.includes(`p${tier}`) };
  });
}
/** The season-only looks of this month's pass. */
export function passLooks(): ShopItem[] { return Object.values(PASS_LOOKS[seasonNow().set]).map(id => itemById(id)!); }
/** The checkout offer for this season's premium track. */
export function passOffer(): Offer {
  const s = seasonNow(), looks = passLooks();
  return { id: `pass:${s.id}`, name: "Galaxy Pass", icon: "🎟️", text: `Premium track for the ${s.name}: ${looks.length} season-only looks and ${TIERS - looks.length} more rewards`, price: PASS_PRICE, full: PASS_PRICE, looks, pieces: looks, single: null };
}
export function rewardLabel(r: PassReward) {
  if (r.stars) return { icon: "★", text: `${r.stars} ★` };
  const item = r.item ? itemById(r.item) : null;
  return { icon: item?.icon ?? "🎁", text: `${item?.name ?? "Gift"}${r.count && r.count > 1 ? ` ×${r.count}` : ""}` };
}
