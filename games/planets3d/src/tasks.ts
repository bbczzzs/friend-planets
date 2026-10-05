/**
 * Daily tasks: three small goals picked from the pool each day (the same three
 * for everyone that day), each paying ★ when done, plus a bonus for all three.
 */
import type { Progress } from "./progress";

export type TaskEvent = "fish" | "harvest" | "sell" | "sport" | "visit" | "dig" | "bug" | "landing";
interface TaskDef { id: string; event: TaskEvent; goal: number; reward: number; text: (goal: number) => string }

const POOL: TaskDef[] = [
  { id: "fish", event: "fish", goal: 3, reward: 30, text: g => `Catch ${g} fish` },
  { id: "harvest", event: "harvest", goal: 4, reward: 25, text: g => `Harvest ${g} crops` },
  { id: "sell", event: "sell", goal: 5, reward: 25, text: g => `Sell ${g} things at the market` },
  { id: "sport", event: "sport", goal: 1, reward: 40, text: () => "Win a match on a Friend's planet" },
  { id: "visit", event: "visit", goal: 2, reward: 35, text: g => `Land on ${g} Friends' planets` },
  { id: "dig", event: "dig", goal: 2, reward: 25, text: g => `Dig up ${g} treasures` },
  { id: "bug", event: "bug", goal: 2, reward: 20, text: g => `Catch ${g} butterflies` },
  { id: "landing", event: "landing", goal: 1, reward: 30, text: () => "Make a perfect landing" },
];
export const ALL_DONE_BONUS = 50;

export interface TaskState { day: string; count: Record<string, number>; done: string[]; bonus: boolean }
export interface TaskView { id: string; text: string; n: number; goal: number; reward: number; done: boolean }

const today = (now = new Date()) => now.toISOString().slice(0, 10);
/** Today's three tasks: a stable pick from the pool by date. */
function pick(day: string): TaskDef[] {
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const order = POOL.map((t, i) => ({ t, k: Math.imul(h ^ (i * 2654435761), 2246822519) >>> 0 })).sort((a, b) => a.k - b.k);
  return order.slice(0, 3).map(o => o.t);
}
function stateOf(p: Progress): TaskState {
  const day = today();
  if (!p.tasks || p.tasks.day !== day) p.tasks = { day, count: {}, done: [], bonus: false };
  return p.tasks;
}
export function dailyTasks(p: Progress): TaskView[] {
  const s = stateOf(p);
  return pick(s.day).map(t => ({ id: t.id, text: t.text(t.goal), n: Math.min(t.goal, s.count[t.id] ?? 0), goal: t.goal, reward: t.reward, done: s.done.includes(t.id) }));
}
/**
 * Counts an event toward today's tasks. Returns what was just completed (to
 * celebrate): each finished task, and the all-three bonus. Stars are added here.
 */
export function countTask(p: Progress, event: TaskEvent, n = 1): { text: string; stars: number }[] {
  const s = stateOf(p), out: { text: string; stars: number }[] = [];
  const tasks = pick(s.day);
  for (const t of tasks) {
    if (t.event !== event || s.done.includes(t.id)) continue;
    s.count[t.id] = (s.count[t.id] ?? 0) + n;
    if (s.count[t.id] >= t.goal) { s.done.push(t.id); p.stars += t.reward; out.push({ text: t.text(t.goal), stars: t.reward }); }
  }
  if (!s.bonus && tasks.every(t => s.done.includes(t.id))) { s.bonus = true; p.stars += ALL_DONE_BONUS; out.push({ text: "All of today's tasks", stars: ALL_DONE_BONUS }); }
  return out;
}
