/**
 * Friend Planets online: runs in the host page (the SDK keeps the game frame
 * offline), joins one shared room over public Nostr relays with Trystero, and
 * relays other players to the game with postMessage. Peer to peer, no server,
 * no wallet addresses: only Friend numbers, where you stand, chat and emotes.
 * Everything received is checked field by field before the game sees it.
 */
import { joinRoom, selfId } from "trystero";

type State = { f: number; fam: number; p: number; n: [number, number, number]; d: [number, number, number]; m: boolean; mode: string; act: string; h?: string; a?: string; lv?: number; gp?: boolean };
type Room = ReturnType<typeof joinRoom>;

const APP = "friend-planets-rarefriends-vibeathon-2026";
const MODES = new Set(["walk", "board", "launch", "fly", "land", "play", "intro", "race"]);
const EMOTES = new Set(["wave", "heart", "party", "laugh"]);

let room: Room | null = null;
type Action = { send: (d: unknown, o?: { target?: string }) => void; onMessage?: (d: unknown, meta: { peerId: string }) => void };
let stateAction: Action | null = null;
let sayAction: Action | null = null;
let emoteAction: Action | null = null;
let mine: State | null = null;
const peers = new Map<string, { last: number; says: number }>();
const frame = () => (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentWindow ?? window;
const toGame = (msg: Record<string, unknown>) => frame().postMessage({ fp: 1, dir: "down", ...msg }, "*");

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
function vec(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(x => num(x, -1.01, 1.01));
  return out.every(x => x !== null) ? (out as [number, number, number]) : null;
}
function cleanState(s: unknown): State | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const f = num(o.f, 1, 9_999_999), fam = num(o.fam, 0, 8), p = num(o.p, 0, 9_999_999), n = vec(o.n), d = vec(o.d);
  const mode = typeof o.mode === "string" && MODES.has(o.mode) ? o.mode : null;
  const act = typeof o.act === "string" && /^[a-z]{0,8}$/.test(o.act) ? o.act : "";
  const h = typeof o.h === "string" && /^hat:[a-z]{1,10}$/.test(o.h) ? o.h : "";
  const a = typeof o.a === "string" && /^aura:[a-z]{1,10}$/.test(o.a) ? o.a : "";
  const lv = Math.floor(num(o.lv, 1, 99) ?? 1), gp = o.gp === true;
  if (f === null || fam === null || p === null || !n || !d || !mode) return null;
  return { f: Math.floor(f), fam: Math.floor(fam), p: Math.floor(p), n, d, m: o.m === true, mode, act, h, a, lv, gp };
}
function cleanText(t: unknown) {
  if (typeof t !== "string") return null;
  const text = t.replace(/https?:\/\/\S+|www\.\S+|[<>]/gi, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return text || null;
}
function allow(peerId: string, kind: "say" | "state") {
  const now = performance.now(), p = peers.get(peerId) ?? { last: 0, says: 0 };
  peers.set(peerId, p);
  if (kind === "state") { if (now - p.last < 50) return false; p.last = now; return true; }
  if (now - p.says < 600) return false;
  p.says = now; return true;
}

function start() {
  if (room) return;
  toGame({ t: "net", status: "connecting", peers: 0 });
  try {
    room = joinRoom({ appId: APP }, "galaxy-v1");
  } catch {
    toGame({ t: "net", status: "off", peers: 0 });
    return;
  }
  stateAction = room.makeAction("state") as unknown as Action;
  sayAction = room.makeAction("say") as unknown as Action;
  emoteAction = room.makeAction("emote") as unknown as Action;
  stateAction!.onMessage = (d, { peerId }) => { const s = cleanState(d); if (s && allow(peerId, "state")) toGame({ t: "peer", id: peerId, s }); };
  sayAction!.onMessage = (d, { peerId }) => { const text = cleanText(d); if (text && allow(peerId, "say")) toGame({ t: "say", id: peerId, text }); };
  emoteAction!.onMessage = (d, { peerId }) => { if (typeof d === "string" && EMOTES.has(d)) toGame({ t: "emote", id: peerId, e: d }); };
  room.onPeerJoin = peerId => { if (mine) stateAction!.send(mine, { target: peerId }); toGame({ t: "net", status: "online", peers: Object.keys(room!.getPeers()).length }); };
  room.onPeerLeave = peerId => { peers.delete(peerId); toGame({ t: "leave", id: peerId }); toGame({ t: "net", status: "online", peers: Object.keys(room!.getPeers()).length }); };
  toGame({ t: "net", status: "online", peers: 0, self: selfId });
}
function stop() {
  room?.leave(); room = null; stateAction = sayAction = emoteAction = null;
  toGame({ t: "net", status: "off", peers: 0 });
}

window.addEventListener("message", ev => {
  const d = ev.data as Record<string, unknown> | null;
  if (!d || d.fp !== 1 || d.dir !== "up") return;
  const game = (document.querySelector("iframe") as HTMLIFrameElement | null)?.contentWindow;
  if (ev.source !== game && ev.source !== window) return;
  if (d.t === "hello") { if (d.online === false) stop(); else start(); }
  else if (d.t === "online") { if (d.on) start(); else stop(); }
  else if (d.t === "state") { const s = cleanState(d.s); if (s) { mine = s; stateAction?.send(s); } }
  else if (d.t === "say") { const text = cleanText(d.text); if (text) sayAction?.send(text); }
  else if (d.t === "emote") { if (typeof d.e === "string" && EMOTES.has(d.e)) emoteAction?.send(d.e); }
});
window.addEventListener("pagehide", () => room?.leave());
if (navigator.webdriver) (window as unknown as { __fpNet?: unknown }).__fpNet = { room: () => room, peers: () => (room ? Object.keys(room.getPeers()).length : -1), self: selfId };
