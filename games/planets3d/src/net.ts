/**
 * The game's side of Friend Planets online. The game frame can't open network
 * connections itself; the host page does that (host/net.ts) and we talk to it
 * with postMessage. If no host answers (e.g. an older host), the game simply
 * stays single-player.
 */
export type PeerState = { f: number; fam: number; p: number; n: [number, number, number]; d: [number, number, number]; m: boolean; mode: string; act: string; h?: string; a?: string; lv?: number; gp?: boolean };
export type NetStatus = "off" | "connecting" | "online";
export const EMOTE_ICONS: Record<string, string> = { wave: "👋", heart: "❤️", party: "🎉", laugh: "😂" };

export class NetClient {
  status: NetStatus = "off";
  count = 0;
  onPeer: ((id: string, s: PeerState) => void) | null = null;
  onLeave: ((id: string) => void) | null = null;
  onSay: ((id: string, text: string) => void) | null = null;
  onEmote: ((id: string, e: string) => void) | null = null;
  onStatus: (() => void) | null = null;

  constructor() { window.addEventListener("message", this.receive); }
  private post(msg: Record<string, unknown>) { try { window.parent.postMessage({ fp: 1, dir: "up", ...msg }, "*"); } catch { /* no host */ } }
  hello(online: boolean) { this.post({ t: "hello", online }); }
  setOnline(on: boolean) { this.post({ t: "online", on }); if (!on) { this.status = "off"; this.count = 0; this.onStatus?.(); } }
  state(s: PeerState) { if (this.status === "online") this.post({ t: "state", s }); }
  say(text: string) { this.post({ t: "say", text }); }
  emote(e: string) { this.post({ t: "emote", e }); }

  private receive = (ev: MessageEvent) => {
    const d = ev.data as Record<string, unknown> | null;
    if (!d || d.fp !== 1 || d.dir !== "down" || ev.source !== window.parent) return;
    if (d.t === "net") { this.status = d.status as NetStatus; this.count = Number(d.peers) || 0; this.onStatus?.(); }
    else if (d.t === "peer" && typeof d.id === "string") this.onPeer?.(d.id, d.s as PeerState);
    else if (d.t === "leave" && typeof d.id === "string") this.onLeave?.(d.id);
    else if (d.t === "say" && typeof d.id === "string" && typeof d.text === "string") this.onSay?.(d.id, d.text);
    else if (d.t === "emote" && typeof d.id === "string" && typeof d.e === "string") this.onEmote?.(d.id, d.e);
  };
  dispose() { window.removeEventListener("message", this.receive); }
}
