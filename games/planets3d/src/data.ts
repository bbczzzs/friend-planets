/**
 * Friend Planets 3D — pure data. Every planet belongs to a real Rare Friend:
 * the Friend's family picks the planet's biome, colours, sky, fish and crop;
 * the token number names the planet and seeds its layout.
 */

export const TAU = Math.PI * 2;

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (id: bigint | number) => Number(BigInt.asUintN(32, BigInt(id) * 2654435761n)) >>> 0;

export const FAMILY_NAMES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;

export type TreeKind = "pine" | "round" | "apple" | "mushroom" | "palm" | "candy" | "crystal" | "autumn";
export interface Crop { name: string; color: string; leaf: string; shape: "round" | "tall" | "star" | "cap" }
export interface Theme {
  region: string;
  grass: [string, string, string]; shore: string; path: string; plaza: string; rock: string; rockDark: string;
  water: string; leaf: string[]; trunk: string; tree: TreeKind; extra: TreeKind | null;
  flowers: string[]; glow: string; wall: string; roof: string; accent: string;
  sky: { day: string; horizon: string; sunset: string; night: string };
  snow?: boolean; crop: Crop;
}

export const THEMES: Theme[] = [
  { region: "Moonbone Tundra", grass: ["#eef2f8", "#dfe7f1", "#f8fbff"], shore: "#cfd9e6", path: "#bfb2a4", plaza: "#d9d3cb", rock: "#a9afbf", rockDark: "#868c9e",
    water: "#6c9fd0", leaf: ["#4f7f78", "#5f8f86", "#416b66"], trunk: "#6b5040", tree: "pine", extra: "crystal", flowers: ["#b3a0d8", "#7db4db", "#ffffff"],
    glow: "#9fe6ff", wall: "#ece6dc", roof: "#7db4db", accent: "#b3a0d8", sky: { day: "#8ec3ee", horizon: "#eaf4ff", sunset: "#f5b3a3", night: "#10163a" }, snow: true,
    crop: { name: "Frostberry", color: "#8fb8ff", leaf: "#4f7f78", shape: "round" } },
  { region: "Lantern Isles", grass: ["#a3d176", "#8cc262", "#b7df8a"], shore: "#f2e2a8", path: "#e6cf9a", plaza: "#eadbb3", rock: "#bdb39e", rockDark: "#978d78",
    water: "#5aa8df", leaf: ["#5fa65c", "#4f9450", "#72b86a"], trunk: "#8a5a3a", tree: "round", extra: null, flowers: ["#f2ce68", "#ed927e", "#ffffff"],
    glow: "#ffb347", wall: "#f4ead6", roof: "#ed927e", accent: "#f2ce68", sky: { day: "#86cdf5", horizon: "#fff1cc", sunset: "#ff9f7a", night: "#1b1840" },
    crop: { name: "Lanternfruit", color: "#f7a238", leaf: "#4f9450", shape: "round" } },
  { region: "Hearth Meadow", grass: ["#a9d67b", "#93c566", "#bfe392"], shore: "#f0dca0", path: "#e2c28f", plaza: "#e6d5b5", rock: "#c2b8a4", rockDark: "#9d937e",
    water: "#5da9e0", leaf: ["#6bb05a", "#5a9e4c", "#7fc16a"], trunk: "#8a5a3a", tree: "apple", extra: null, flowers: ["#ed927e", "#f2ce68", "#ffffff", "#b3a0d8"],
    glow: "#ffd27a", wall: "#f6ecd9", roof: "#e8543f", accent: "#7db4db", sky: { day: "#84c6f2", horizon: "#fdf2d8", sunset: "#ff9a76", night: "#171a3d" },
    crop: { name: "Pumpkin", color: "#f28a2e", leaf: "#5a9e4c", shape: "round" } },
  { region: "Moss Garden", grass: ["#7cc47a", "#64ad63", "#95d68c"], shore: "#dcd4a4", path: "#cbb68c", plaza: "#c9c7a8", rock: "#9eab96", rockDark: "#7a8873",
    water: "#3f9aa6", leaf: ["#3f8f4f", "#2f7a42", "#57a860"], trunk: "#6a4a32", tree: "mushroom", extra: "round", flowers: ["#ccff00", "#ffffff", "#f2ce68"],
    glow: "#b6ff5c", wall: "#efe9d6", roof: "#b3a0d8", accent: "#ccff00", sky: { day: "#98e0d2", horizon: "#f0ffe8", sunset: "#f8b48c", night: "#0e2528" },
    crop: { name: "Glowcap", color: "#d8ff6a", leaf: "#2f7a42", shape: "cap" } },
  { region: "Crooked Dunes", grass: ["#ecd08e", "#dfbf78", "#f5dfa6"], shore: "#f6e3b3", path: "#d9ab6d", plaza: "#e6c79a", rock: "#d0a36c", rockDark: "#a97f4d",
    water: "#4fb3cc", leaf: ["#7fae4f", "#6a9a40", "#93c060"], trunk: "#a8784e", tree: "palm", extra: null, flowers: ["#ed927e", "#ffffff", "#b3a0d8"],
    glow: "#ffc36a", wall: "#f3e1c2", roof: "#c2481f", accent: "#ed927e", sky: { day: "#94d2f0", horizon: "#ffe9c2", sunset: "#ff8f5a", night: "#1d1535" },
    crop: { name: "Sweet date", color: "#9a5a2e", leaf: "#6a9a40", shape: "tall" } },
  { region: "Cloud Candy", grass: ["#f2cdef", "#e6b8e4", "#fbe2f7"], shore: "#fff0f6", path: "#fff7fa", plaza: "#fde8f1", rock: "#dcc5e6", rockDark: "#b79ec6",
    water: "#9a8ce3", leaf: ["#f6aacb", "#9fd8ff", "#fff29a"], trunk: "#ffffff", tree: "candy", extra: null, flowers: ["#ffffff", "#f2ce68", "#7db4db", "#ed927e"],
    glow: "#ffe36e", wall: "#fff8fb", roof: "#7db4db", accent: "#f2ce68", sky: { day: "#c4b6ff", horizon: "#ffe4f3", sunset: "#ffa7c4", night: "#221943" },
    crop: { name: "Starfruit", color: "#ffe066", leaf: "#8fd09a", shape: "star" } },
  { region: "Titan Ridge", grass: ["#b9b78c", "#a4a277", "#cbc99f"], shore: "#e0c29e", path: "#c9a27a", plaza: "#cdbfa8", rock: "#a8a296", rockDark: "#837d72",
    water: "#6388b3", leaf: ["#5a7f5a", "#4a6f4c", "#6d916a"], trunk: "#6a4a32", tree: "pine", extra: "round", flowers: ["#f2ce68", "#ffffff", "#ed927e"],
    glow: "#ffcf6a", wall: "#e7ddcb", roof: "#c2481f", accent: "#f2ce68", sky: { day: "#a4c4e2", horizon: "#f5e6d0", sunset: "#f39a70", night: "#161a33" },
    crop: { name: "Ridge corn", color: "#f2ce48", leaf: "#4a6f4c", shape: "tall" } },
  { region: "Glimmer Reef", grass: ["#92ddc9", "#7ccfb9", "#b0ecdc"], shore: "#f7ecc8", path: "#f2e6c0", plaza: "#e9f4ea", rock: "#b9dcd3", rockDark: "#8fbab0",
    water: "#3c9ed9", leaf: ["#4fb07a", "#3d9a68", "#66c48c"], trunk: "#b08a5a", tree: "crystal", extra: "palm", flowers: ["#ed927e", "#ffffff", "#f2ce68"],
    glow: "#7ff3ff", wall: "#f3fbf8", roof: "#ed927e", accent: "#ccff00", sky: { day: "#86dcff", horizon: "#e9fff9", sunset: "#ff9fb0", night: "#0d1d3a" },
    crop: { name: "Seaglass pea", color: "#7ff3d8", leaf: "#3d9a68", shape: "round" } },
  { region: "Hollow Grove", grass: ["#a1b68c", "#8ea57a", "#b6c8a2"], shore: "#ddd0b0", path: "#baa686", plaza: "#cbbfa6", rock: "#aaa698", rockDark: "#858173",
    water: "#56769a", leaf: ["#d98a4a", "#e0a24f", "#c46a3a"], trunk: "#5a4432", tree: "autumn", extra: "mushroom", flowers: ["#b3a0d8", "#f2ce68", "#ffffff"],
    glow: "#ffb45c", wall: "#ebe0cd", roof: "#7a4a8a", accent: "#b3a0d8", sky: { day: "#b0a4d8", horizon: "#ffe0c8", sunset: "#ff8f7a", night: "#16122a" },
    crop: { name: "Hollow fig", color: "#7a4a8a", leaf: "#8ea57a", shape: "round" } },
];
export const themeOf = (family: number) => THEMES[((family % 9) + 9) % 9];

/** Fish: each family's waters have their own, plus a few that swim everywhere. Rarity 1 common … 4 legendary. */
export interface Fish { name: string; color: string; fin: string; rarity: 1 | 2 | 3 | 4; family: number; size: number }
export const FISH: Fish[] = [
  { name: "Pebble minnow", color: "#9aa7b8", fin: "#c9d3df", rarity: 1, family: -1, size: 0.7 },
  { name: "Sunny perch", color: "#f2c14e", fin: "#ed927e", rarity: 1, family: -1, size: 0.9 },
  { name: "Blue gill", color: "#5a8fd6", fin: "#9fd0ff", rarity: 1, family: -1, size: 0.9 },
  { name: "Bubble puffer", color: "#f6e08a", fin: "#f2a33a", rarity: 2, family: -1, size: 0.8 },
  { name: "Frost trout", color: "#bcd8f2", fin: "#ffffff", rarity: 2, family: 0 }, { name: "Bone koi", color: "#f4f1ea", fin: "#111111", rarity: 4, family: 0 },
  { name: "Lantern fish", color: "#ffb347", fin: "#fff1a8", rarity: 2, family: 1 }, { name: "Masked ray", color: "#3d3d5c", fin: "#ed927e", rarity: 3, family: 1 },
  { name: "Hearth carp", color: "#e8543f", fin: "#f2ce68", rarity: 2, family: 2 }, { name: "Golden goby", color: "#ffd43b", fin: "#fff6c2", rarity: 4, family: 2 },
  { name: "Moss eel", color: "#57a860", fin: "#ccff00", rarity: 2, family: 3 }, { name: "Split jelly", color: "#b6ff5c", fin: "#e8ffd0", rarity: 3, family: 3 },
  { name: "Dune snapper", color: "#d9a05b", fin: "#ed927e", rarity: 2, family: 4 }, { name: "Crooked pike", color: "#8a6a4a", fin: "#f2ce68", rarity: 3, family: 4 },
  { name: "Candy guppy", color: "#f6aacb", fin: "#9fd8ff", rarity: 2, family: 5 }, { name: "Cloud whale", color: "#e8e4ff", fin: "#b3a0d8", rarity: 4, family: 5 },
  { name: "Titan bass", color: "#6d7a5a", fin: "#c2481f", rarity: 2, family: 6 }, { name: "Boulder grouper", color: "#8b857a", fin: "#f2ce68", rarity: 3, family: 6 },
  { name: "Glimmer tang", color: "#3cc6e8", fin: "#ccff00", rarity: 2, family: 7 }, { name: "Prism angel", color: "#7ff3ff", fin: "#ff9fd0", rarity: 4, family: 7 },
  { name: "Hollow catfish", color: "#5a4a6a", fin: "#b3a0d8", rarity: 2, family: 8 }, { name: "Ember loach", color: "#ff8a3d", fin: "#ffd27a", rarity: 3, family: 8 },
].map(f => ({ size: 1, ...f })) as Fish[];
export const RARITY = ["", "Common", "Uncommon", "Rare", "Legendary"] as const;
export const RARITY_COLOR = ["", "#c9c9c9", "#b9d984", "#7db4db", "#f2ce68"] as const;
export const fishOf = (family: number) => FISH.filter(f => f.family === -1 || f.family === family);

/** Activities: fishing and farming on most planets; each neighbour has its own sport. */
export type Sport = "goal" | "tennis" | "boxing";
export const SPORTS: Record<Sport, { name: string; emoji: string; verb: string }> = {
  goal: { name: "Penalty kicks", emoji: "⚽", verb: "Take penalties" },
  tennis: { name: "Tennis", emoji: "🎾", verb: "Play tennis" },
  boxing: { name: "Boxing", emoji: "🥊", verb: "Box" },
};

export const FAMILY_HELLO = [
  "Ooh, a Skeleton! Aren't you chilly up there?",
  "A Mask! What's under there? …Never mind, I like it.",
  "A Family Friend! Welcome, welcome.",
  "A Cellular! Do you ever split in two? Handy for carrying.",
  "An Asymmetry! I love your wonky style.",
  "A Hoverer! You didn't even need the rocket, did you?",
  "Whoa, a Colossus! Mind the flowers, big one.",
  "A Sparkling! You're lighting up my whole planet.",
  "A Hollow… so mysterious. Welcome anyway!",
];

const SYL = ["ka", "mi", "lo", "ru", "ve", "no", "ta", "shi", "po", "lu", "zi", "mo", "ne", "ki", "ra", "yu", "be", "sa", "do", "fi"];
export function planetName(id: bigint | number): string {
  const r = mulberry32(seedOf(id) ^ 0x5bd1e995);
  const n = 2 + Math.floor(r() * 2);
  let s = "";
  for (let i = 0; i < n; i++) s += SYL[Math.floor(r() * SYL.length)];
  return s[0].toUpperCase() + s.slice(1);
}

/** Each family is a character, not a skin: one perk that shows up across the whole game. */
export type PerkId = "nightOwl" | "pokerFace" | "greenThumb" | "split" | "wonky" | "float" | "heavy" | "glow" | "echo";
export interface Perk { id: PerkId; name: string; icon: string; text: string }
export const PERKS: Perk[] = [
  { id: "nightOwl", name: "Night owl", icon: "🦴", text: "Fish bites last longer for you" },
  { id: "pokerFace", name: "Poker face", icon: "🎭", text: "Keepers can't read your penalties" },
  { id: "greenThumb", name: "Green thumb", icon: "🌱", text: "Your crops grow twice as fast" },
  { id: "split", name: "Split", icon: "🧫", text: "Extra reach on the tennis court" },
  { id: "wonky", name: "Wonky spin", icon: "🌀", text: "Your tennis shots are harder to return" },
  { id: "float", name: "Float", icon: "🪶", text: "Hold jump to float; gentler rocket landings" },
  { id: "heavy", name: "Heavy hitter", icon: "💪", text: "Punches land 50% harder; jumps shake the ground" },
  { id: "glow", name: "Glow", icon: "✨", text: "You light up the night; fish come to you faster" },
  { id: "echo", name: "Echo", icon: "👻", text: "Boxers' wind-ups last longer for you" },
];
export const perkOf = (family: number) => PERKS[((family % 9) + 9) % 9];

/** What a planet's Friend says, in its family's voice. */
export const HOST_LINES: { hello: string[]; idle: string[]; theyWin: string[]; youWin: string[] }[] = [
  { hello: ["Welcome to the tundra! Mind the ice.", "Brr, a visitor! Come warm up."], idle: ["My bones rattle when it snows.", "The fish here are frosty but tasty."], theyWin: ["Cold as ice! Better luck next time.", "Skeleton 1, you 0!"], youWin: ["You beat me? I'm shaking!", "Good game, frostbite and all."] },
  { hello: ["Oh! A guest! Let me put on my best mask.", "Welcome to the lantern isles!"], idle: ["Nobody knows what's under here.", "The lanterns light up at night, you'll see."], theyWin: ["Hehe, you didn't see that coming!", "Masks win again!"], youWin: ["I'm smiling under here, promise.", "Well played! You're good."] },
  { hello: ["Welcome, welcome! Make yourself at home.", "Family's always welcome here!"], idle: ["Pick an apple, they're fresh!", "My pumpkins are the biggest around."], theyWin: ["Family wins, that's the rule!", "Aw, don't be sad, have a pumpkin."], youWin: ["You're part of the family now!", "Great game! Stay for dinner?"] },
  { hello: ["Hi! Hi! Hi! (that's all of me saying hi)", "Welcome to the moss garden!"], idle: ["Sometimes I split in two just for fun.", "The glowcaps light up the dark side."], theyWin: ["Two of me against one of you!", "Hehe, cell-ebration time!"], youWin: ["You beat both of me!", "Wow. I need to divide and rethink."] },
  { hello: ["Welcome to the crooked dunes!", "Hey you! Nothing's straight here, relax."], idle: ["My left side is my good side.", "The dates here are sweet."], theyWin: ["Wonky wins!", "Didn't see that angle coming, did you?"], youWin: ["That was crooked-ly good!", "Okay, okay, you win this one."] },
  { hello: ["Oh, you walked here? Cute!", "Welcome to cloud candy! Float around!"], idle: ["I haven't touched the ground in years.", "Everything here tastes like sugar."], theyWin: ["Floated right past you!", "Too light to catch!"], youWin: ["You knocked me off my cloud!", "Sweet win! Well played."] },
  { hello: ["WELCOME. Sorry, was that loud?", "Mind the flowers, I'm big."], idle: ["I once sat on a mountain. Oops.", "The ridge is quiet. I like quiet."], theyWin: ["BIG WIN.", "Colossus stays undefeated!"], youWin: ["Small but strong! Respect.", "You toppled a giant!"] },
  { hello: ["✨ A visitor! Everything sparkles more now!", "Welcome to the glimmer reef!"], idle: ["The crystals hum at night.", "Did you see that fish shimmer?"], theyWin: ["Dazzled you!", "Sparkle power!"], youWin: ["You outshone me!", "Brilliant game!"] },
  { hello: ["...oh. Hello. Welcome.", "The grove is quiet. Stay a while."], idle: ["Listen. Can you hear the echo?", "The leaves never stop falling here."], theyWin: ["...boo.", "The hollow always wins."], youWin: ["You filled the hollow with joy.", "Well played, stranger."] },
];
