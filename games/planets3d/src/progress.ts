/** What you've collected, saved per Friend in this browser. Nothing here is on-chain: Stars are play money, and RF purchases are recorded as orders in `wallet`. */
import type { Sport } from "./data";
import type { Wallet } from "./economy";
import type { TaskState } from "./tasks";

export interface PlotState { crop: string | null; plantedAt: number }
export interface Progress {
  v: 1;
  stars: number;
  fish: Record<string, { n: number; best: number }>;
  crops: Record<string, number>;
  trophies: Record<string, Sport>; // planet token id → sport won there
  farms: Record<string, PlotState[]>; // planet token id → 9 plots
  visited: number[]; // planet token ids
  discovered?: number[]; // extra Friends whose planets you found
  quests?: string[];
  treasures?: Record<string, number>;
  bugs?: Record<string, number>;
  wallet?: Wallet; // see economy.ts
  tasks?: TaskState; // today's daily tasks, see tasks.ts
}

export const GROW_MS = 40_000;
const key = (friendId: bigint) => `friend-planets-3d:v1:${friendId}`;

export function emptyProgress(): Progress {
  return { v: 1, stars: 0, fish: {}, crops: {}, trophies: {}, farms: {}, visited: [] };
}
export function loadProgress(friendId: bigint): Progress {
  try {
    const raw = window.localStorage.getItem(key(friendId));
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Progress;
    return p && p.v === 1 ? { ...emptyProgress(), ...p } : emptyProgress();
  } catch { return emptyProgress(); }
}
export function saveProgress(friendId: bigint, p: Progress) {
  try { window.localStorage.setItem(key(friendId), JSON.stringify(p)); } catch { /* private mode: progress lasts this session */ }
}
export function plotsFor(p: Progress, planetId: number): PlotState[] {
  const k = String(planetId);
  if (!p.farms[k] || p.farms[k].length !== 9) p.farms[k] = Array.from({ length: 9 }, () => ({ crop: null, plantedAt: 0 }));
  return p.farms[k];
}
/** 0 empty · 1 sprout · 2 growing · 3 ripe */
export function stageOf(plot: PlotState, now: number, growMs = GROW_MS) {
  if (!plot.crop) return 0;
  const t = (now - plot.plantedAt) / growMs;
  return t >= 1 ? 3 : t >= 0.4 ? 2 : 1;
}
