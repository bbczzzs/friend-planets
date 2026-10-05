/**
 * Hats as pixel art, drawn into your Friend's own sprite so they sit on its
 * head and move with every frame (not stickers floating above it). Same pixel
 * grid as the Friends, a dark outline so they read on any background, and a
 * mirror for the left-facing frames. Also paints shop thumbnails: your Friend
 * wearing a hat, and a little pixel rocket in a paint job's colours.
 */
import type { SpriteRows } from "../sprites";

const PAL: Record<string, string> = {
  y: "#f2c46b", Y: "#c9953a", r: "#e8543f", R: "#a8322a", b: "#4f86e0", B: "#2d4f9a", n: "#2a3156",
  p: "#f48fb9", P: "#c75689", g: "#5fbf6a", G: "#3b8f48", s: "#efd290", S: "#c2a060", w: "#ffffff",
  e: "#dfe4ee", E: "#9aa3b5", c: "#9fe6ff", v: "#b39dff",
};
const OUTLINE = "#16171f";

/** rows: the art, top to bottom; sink: how many rows overlap the top of the head; dx: shift right (side pieces). */
export interface PixelHat { rows: string[]; sink: number; dx?: number }
export const PIXEL_HATS: Record<string, PixelHat> = {
  "hat:cap": { sink: 1, rows: ["..bbbbb...", ".bbbwbbb..", ".bbbbbbb..", ".BBBBBBBBB"] },
  "hat:bow": { sink: 3, dx: 3, rows: [".p...p.", "pPp.pPp", "ppPPPpp", "pPp.pPp", ".p...p."] },
  "hat:flower": { sink: 2, dx: 3, rows: [".w.w.", "wwyww", ".w.w.", "..g.."] },
  "hat:grad": { sink: 1, rows: ["nnnnnnnnnnn", ".nnnnnnnnny", "..nnnnnnn.y", "..nnnnnnn.."] },
  "hat:top": { sink: 1, rows: ["..nnnnnn..", "..nnnnnn..", "..nnnnnn..", "..rrrrrr..", "nnnnnnnnnn"] },
  "hat:phones": { sink: 5, rows: ["...eeeeeeee...", "..e........e..", ".e..........e.", "EEe........eEE", "EEE........EEE", "EEE........EEE"] },
  "hat:crown": { sink: 1, rows: ["y...y...y", "yy.yyy.yy", "yyyyyyyyy", "YrYYbYYrY"] },
  "hat:pin": { sink: 3, dx: 3, rows: ["..y..", ".yyy.", "yyyyy", ".yYy.", ".y.y."] },
  "hat:medal": { sink: 3, dx: 3, rows: [".rb.", ".rb.", "yyyy", "yYYy", ".yy."] },
  "hat:laurel": { sink: 2, rows: [".g.g......g.g.", "gGgGg....gGgGg", ".gGg......gGg."] },
  "hat:sunhat": { sink: 1, rows: ["....ssssss....", "...ssssssss...", "...rrrrrrrr...", "ssssssssssssss", ".SSSSSSSSSSSS."] },
  "hat:comet": { sink: 2, dx: 2, rows: [".....y.", "....yyy", ".cccyy.", "c...y.."] },
  "hat:shroom": { sink: 1, rows: ["...rrrrrr...", ".rrwrrrrwrr.", "rrrrrwwrrrrr", "rRRRRRRRRRRr"] },
  "hat:disco": { sink: 1, rows: ["...e...", "..eEe..", ".eEeEe.", "eEeEeEe", ".eEeEe.", "..eEe.."] },
};

/** Where the head is in a frame: its top row and the middle of its top. */
function headOf(rows: SpriteRows) {
  const top = Math.max(0, rows.findIndex(line => line.includes("#")));
  let min = 16, max = -1;
  for (let y = top; y < Math.min(16, top + 2); y++) for (let x = 0; x < 16; x++) if (rows[y]?.[x] === "#") { min = Math.min(min, x); max = Math.max(max, x); }
  return { top, cx: max < 0 ? 8 : (min + max + 1) / 2 };
}

/**
 * Paints a Friend frame (white halo, black mask) and its hat at grid cell
 * (ox, oy) in pixels of `scale`. `mirror` flips the hat for left-facing frames.
 */
export function paintFriend(ctx: CanvasRenderingContext2D, rows: SpriteRows, hat: PixelHat | null, ox: number, oy: number, scale: number, mirror = false) {
  ctx.fillStyle = "#ffffff";
  rows.forEach((line, y) => [...line].forEach((px, x) => { if (px === "#") ctx.fillRect(ox + (x - 1) * scale, oy + (y - 1) * scale, scale * 3, scale * 3); }));
  ctx.fillStyle = "#000000";
  rows.forEach((line, y) => [...line].forEach((px, x) => { if (px === "#") ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale); }));
  if (!hat) return;
  const { top, cx } = headOf(rows), h = hat.rows.length, w = hat.rows[0].length;
  const x0 = Math.round(cx - w / 2 + (mirror ? -(hat.dx ?? 0) : hat.dx ?? 0)), y0 = top - (h - hat.sink);
  const at = (x: number, y: number) => { const c = hat.rows[y]?.[mirror ? w - 1 - x : x]; return c && c !== "." ? c : null; };
  // Outline first (a dark halo around the hat), then the colours on top.
  ctx.fillStyle = OUTLINE;
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (at(x, y)) continue;
    if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) ctx.fillRect(ox + (x0 + x) * scale, oy + (y0 + y) * scale, scale, scale);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y); if (!c) continue;
    ctx.fillStyle = PAL[c] ?? OUTLINE; ctx.fillRect(ox + (x0 + x) * scale, oy + (y0 + y) * scale, scale, scale);
  }
}

/** Rows of headroom above the 16×16 frame, so hats fit on any Friend. */
export const HEADROOM = 7;

const thumbs = new Map<string, string>();
/** Your Friend wearing a hat, as an image URL (pixel-sized; scale it up with CSS). */
export function friendThumb(rows: SpriteRows, hatId?: string | null): string {
  const key = rows.join("") + (hatId ?? "");
  const hit = thumbs.get(key); if (hit) return hit;
  const c = document.createElement("canvas"); c.width = 20; c.height = 18 + HEADROOM;
  paintFriend(c.getContext("2d")!, rows, hatId ? PIXEL_HATS[hatId] ?? null : null, 2, HEADROOM + 1, 1);
  const url = c.toDataURL(); thumbs.set(key, url);
  return url;
}

const ROCKET = ["....a....", "...aaa...", "...www...", "..wwcww..", "..wcccw..", "..wwcww..", "..bbbbb..", "..wwwww..", ".awwwwwa.", "aawwwwwaa", "aa.www.aa", "...o.o..."];
/** A little pixel rocket in a paint job's colours (stripe, then nose and fins). */
export function rocketThumb(colors: [string, string]): string {
  const key = "rocket" + colors.join("");
  const hit = thumbs.get(key); if (hit) return hit;
  const c = document.createElement("canvas"); c.width = 11; c.height = 14;
  const ctx = c.getContext("2d")!, map: Record<string, string> = { a: colors[1], b: colors[0], w: "#f4f1ea", c: "#9fe6ff", o: "#ffb15c" };
  ctx.fillStyle = OUTLINE;
  const on = (x: number, y: number) => ROCKET[y]?.[x] && ROCKET[y][x] !== ".";
  for (let y = -1; y <= ROCKET.length; y++) for (let x = -1; x <= 9; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) ctx.fillRect(x + 1, y + 1, 1, 1);
  ROCKET.forEach((line, y) => [...line].forEach((px, x) => { if (px !== ".") { ctx.fillStyle = map[px]; ctx.fillRect(x + 1, y + 1, 1, 1); } }));
  const url = c.toDataURL(); thumbs.set(key, url);
  return url;
}
