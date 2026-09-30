/**
 * Real Rare Friends Generations sprites. Every Friend has on-chain idle and walk
 * clips in four directions (64 frames); the villagers' sheets are read from the
 * artwork registry and baked into friends.json, and your own Friend is read live
 * through the SDK (pilot.ts). Nothing is redrawn: pixels are the canonical ones.
 */
import { decodeSpriteBitmap } from "@rarefriends/friendsdk";
import raw from "./friends.json";

export type SpriteRows = readonly string[];
export type Facing = "down" | "up" | "left" | "right";
export const FACINGS: Facing[] = ["down", "up", "left", "right"];
export interface Clips { idle: Record<Facing, SpriteRows[]>; walk: Record<Facing, SpriteRows[]> }
export interface RosterFriend { id: number; familyId: number; clips: Clips }

export const FAMILY_NAMES = [
  "Skeleton", "Mask", "Family", "Cellular", "Asymmetry",
  "Hoverer", "Colossus", "Sparkling", "Hollow",
] as const;

const EMPTY: SpriteRows = Array.from({ length: 16 }, () => ".".repeat(16));
const hasPixels = (rows: SpriteRows) => rows.some(r => r.includes("#"));
const mirror = (rows: SpriteRows): SpriteRows => rows.map(r => [...r].reverse().join(""));

/**
 * Splits the registry's 64 frames into clips (idle 0-31, walk 32-63; down, up,
 * left, right × 8). Colossus has no up/down art, so vertical moves keep a side
 * view, as the SDK recommends; a missing side is mirrored from the other.
 */
export function clipsFrom(frames: readonly SpriteRows[]): Clips {
  const part = (off: number) => Object.fromEntries(FACINGS.map((f, i) => [f, frames.slice(off + i * 8, off + i * 8 + 8).filter(hasPixels)])) as Record<Facing, SpriteRows[]>;
  const c: Clips = { idle: part(0), walk: part(32) };
  const any = [...FACINGS.map(f => c.idle[f]), ...FACINGS.map(f => c.walk[f])].find(x => x.length) ?? [fallbackSprite(1)];
  for (const k of ["idle", "walk"] as const) {
    const m = c[k];
    if (!m.left.length && m.right.length) m.left = m.right.map(mirror);
    if (!m.right.length && m.left.length) m.right = m.left.map(mirror);
    for (const f of ["down", "up"] as const) if (!m[f].length) m[f] = m.right.length ? m.right : m.left;
  }
  for (const f of FACINGS) {
    if (!c.idle[f].length) c.idle[f] = c.walk[f].length ? [c.walk[f][0]] : any;
    if (!c.walk[f].length) c.walk[f] = c.idle[f];
  }
  return c;
}

export function stillClips(rows: SpriteRows): Clips {
  const m = () => ({ down: [rows], up: [rows], left: [mirror(rows)], right: [rows] });
  return { idle: m(), walk: m() };
}

type Raw = { id: number; f: number; b: string[] }[];
export const ROSTER: RosterFriend[] = (raw as Raw).map(r => ({
  id: r.id,
  familyId: r.f,
  clips: clipsFrom(r.b.map(h => (h === "0" ? EMPTY : decodeSpriteBitmap(BigInt("0x" + h)).rows))),
}));

/** Frame to draw for a clip at time t (seconds). */
export function frameAt(c: Clips, facing: Facing, walking: boolean, t: number): SpriteRows {
  const clip = c[walking ? "walk" : "idle"][facing];
  const fps = walking ? 10 : 4;
  return clip[Math.floor(t * fps) % clip.length];
}

export function fallbackSprite(seed: number): SpriteRows {
  let a = seed ^ 0x9e3779b9;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill("."));
  for (let y = 3; y < 15; y++) for (let x = 3; x < 8; x++) {
    if (((x - 7.5) / 4.6) ** 2 + ((y - 8.5) / 5.8) ** 2 <= 1 && rnd() < 0.82) { g[y][x] = "#"; g[y][15 - x] = "#"; }
  }
  g[7][5] = "."; g[7][10] = ".";
  return g.map(r => r.join(""));
}

const K = "#111111", WHITE = "#ffffff";
const cache = new Map<string, HTMLCanvasElement>();
/** 16×16 sprite on an 18×18 canvas with a 1px outline (Friends: black on white). */
export function spriteCanvas(rows: SpriteRows, fill = K, outline = WHITE): HTMLCanvasElement {
  const key = fill + outline + rows.join("");
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 18; c.height = 18;
  const g = c.getContext("2d")!;
  const on = (x: number, y: number) => y >= 0 && y < 16 && x >= 0 && x < 16 && rows[y]?.[x] === "#";
  g.fillStyle = outline;
  for (let y = -1; y <= 16; y++) for (let x = -1; x <= 16; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x + 1, y + 1, 1, 1);
  g.fillStyle = fill;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (on(x, y)) g.fillRect(x + 1, y + 1, 1, 1);
  cache.set(key, c);
  return c;
}

/** Lowest drawn row of a sprite (so feet sit on the ground whatever the art). */
export function feetRow(rows: SpriteRows): number {
  for (let y = 15; y >= 0; y--) if (rows[y]?.includes("#")) return y;
  return 15;
}
