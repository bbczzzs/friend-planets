"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { Engine, type HudState, type ToastKind } from "./src/engine";
import type { ActivityHud } from "./src/activities";
import { makeGalaxy } from "./src/galaxy";
import { FAMILY_NAMES, RARITY, RARITY_COLOR, SPORTS, perkOf } from "./src/data";
import { loadProgress, saveProgress } from "./src/progress";
import { SHOP, type ItemKind } from "./src/economy";
import { loadPilot, type PilotSprite } from "./pilot";
import { stillClips, fallbackSprite, spriteCanvas } from "./sprites";
import { ValleyAudio } from "./audio";
import "./style.css";

type Toast = { id: number; text: string; kind: ToastKind };
/** What the game is about, in four cards before you play. */
const SLIDES = [
  { icon: "🪐", title: "Every Friend is a planet", text: "Your Friend's own on-chain pixels are drawn across its planet. Walk all the way around it: day on one side, stars and fireflies on the other." },
  { icon: "🚀", title: "Fly between Friends", text: "Board your rocket, fly from the cockpit and land softly on other Friends' planets. Discover any Friend in the collection by its token number." },
  { icon: "🎣", title: "Something to do everywhere", text: "Fish, farm, dig for treasure, catch butterflies, race a hoverboard through rings, and beat each planet's Friend at penalties, tennis or boxing." },
  { icon: "🌐", title: "Meet other players", text: "Everyone online shares the galaxy: see their Friends, chat and wave. Your family perk changes how you play, and Friends you visit come to your campfire." },
];
type Phase = "loading" | "error" | "title" | "playing";
type ShopTab = "sell" | ItemKind;
const SHOP_TABS: { id: ShopTab; label: string }[] = [{ id: "sell", label: "Sell" }, { id: "hat", label: "Hats" }, { id: "rocket", label: "Rockets" }, { id: "item", label: "Items" }, { id: "gear", label: "Upgrades" }];

function Portrait({ pilot, size = 96 }: { pilot: PilotSprite; size?: number }) {
  const src = spriteCanvas(pilot.clips.idle.down[0]).toDataURL();
  return <img className="fp-portrait" src={src} width={size} height={size} alt="" />;
}

/** Thin line icons for the toolbar (currentColor, 24px grid). */
const ICONS = {
  book: <><path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" /><path d="M5 18a2 2 0 0 1 2-2h11.5" /><path d="M9 8.5h6" /></>,
  bag: <><path d="M5.5 8.5h13l-1 11h-11z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.6 2.4 14.4 0 17M12 3.5c-2.4 2.6-2.4 14.4 0 17" /></>,
  soundOn: <><path d="M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5z" /><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  soundOff: <><path d="M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5z" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4" /><path d="M12 16.6v.1" /></>,
  chat: <path d="M4.5 5.5h15v10h-9l-4.5 3.5V15.5h-1.5z" />,
  smile: <><circle cx="12" cy="12" r="8.5" /><path d="M8.8 14.2a4 4 0 0 0 6.4 0M9.3 9.8v.1M14.7 9.8v.1" /></>,
};
function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg className="fp-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}
/** The RF coin: a small gold disc. */
function Coin() {
  return <svg className="fp-coin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" /><circle cx="10" cy="10" r="5.2" /></svg>;
}

function Meter({ m }: { m: NonNullable<ActivityHud["meter"]> }) {
  return <div className="fp-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.value * 100)}>
    {m.zone && <i className="fp-zone" style={{ left: `${m.zone[0] * 100}%`, width: `${(m.zone[1] - m.zone[0]) * 100}%` }} />}
    {m.good && <i className="fp-good" style={{ left: `${m.good[0] * 100}%`, width: `${(m.good[1] - m.good[0]) * 100}%` }} />}
    {!m.zone && !m.good ? <i className="fp-fill" style={{ width: `${m.value * 100}%` }} /> : <b className="fp-mark" style={{ left: `${m.value * 100}%` }} />}
  </div>;
}

/**
 * Friend Planets — Rare Friends Vibeathon (Character Spotlight). Your verified
 * Generations Friend lives on its own tiny 3D planet. Walk all the way around
 * it (day on one side, night on the other), fish off the dock, grow your
 * family's crop, then climb into your rocket and fly from the cockpit to the
 * planets of real Rare Friends — each with its own biome, fish, crop and a
 * sport to play against its Friend. The SDK runtime supplies wallet
 * connection, Friend selection and the ownership gate; nothing costs RF.
 */
export default function FriendPlanets({ friendId, client, paused }: GameComponentProps) {
  const canvas = useRef<HTMLCanvasElement>(null), stickBase = useRef<HTMLDivElement>(null), stickKnob = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null), audio = useRef<ValleyAudio | null>(null), toastId = useRef(0);
  const [phase, setPhase] = useState<Phase>("loading"), [failure, setFailure] = useState("");
  const [pilot, setPilot] = useState<PilotSprite | null>(null);
  const [hud, setHud] = useState<HudState | null>(null), [toasts, setToasts] = useState<Toast[]>([]);
  const [muted, setMuted] = useState(true), [panel, setPanel] = useState<"help" | "book" | "online" | "shop" | null>(null), [touch, setTouch] = useState(false);
  const [chat, setChat] = useState<string | null>(null);
  const [visitId, setVisitId] = useState("");
  const [slide, setSlide] = useState(0);
  const [shopTab, setShopTab] = useState<ShopTab>("sell");
  const [emotes, setEmotes] = useState(false);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = ++toastId.current;
    setToasts(list => [...list.slice(-1), { id, text, kind }]);
    window.setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 3600);
  }, []);

  // Session check + your Friend's canonical sprite, then build the galaxy.
  useEffect(() => {
    let live = true, created: Engine | null = null;
    setPhase("loading"); setFailure(""); setHud(null);
    const kit = new ValleyAudio(); audio.current = kit;
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    const fallback: PilotSprite = { clips: stillClips(fallbackSprite(Number(BigInt.asUintN(32, friendId)))), familyId: Number(friendId % 9n), fallback: true };
    const sprite = Promise.race([loadPilot(friendId), new Promise<PilotSprite>(res => window.setTimeout(() => res(fallback), 9000))]);
    const fonts = Promise.race([document.fonts?.load("700 40px Silkscreen").catch(() => null), new Promise(res => window.setTimeout(res, 1500))]);
    Promise.all([client.read(), sprite, fonts]).then(([, art]) => {
      if (!live) return;
      setPilot(art);
      // Let the loading screen paint before the (synchronous) world build.
      window.setTimeout(() => {
        if (!live) return;
        const world = makeGalaxy(friendId, art.familyId, art.clips.idle.down[0]);
        created = new Engine({ canvas: canvas.current!, stickBase: stickBase.current!, stickKnob: stickKnob.current! }, world, art.clips, friendId, {
          onHud: setHud,
          onToast: toast,
          onProgress: p => saveProgress(friendId, p),
        }, kit, loadProgress(friendId));
        engine.current = created;
        created.setBlocked(true);
        if (navigator.webdriver) (window as unknown as { __fp3?: Engine }).__fp3 = created;
        setPhase("title");
      }, 30);
    }).catch((cause: unknown) => {
      if (!live) return;
      setFailure(cause instanceof Error ? cause.message : "Could not load the game session.");
      setPhase("error");
    });
    return () => { live = false; created?.dispose(); engine.current = null; kit.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, friendId]);

  useEffect(() => { engine.current?.setPaused(paused); audio.current?.setPaused(paused); }, [paused]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (!typing && e.key.toLowerCase() === "t" && hud?.mode === "walk" && !panel) { e.preventDefault(); setChat(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hud?.mode, panel]);
  useEffect(() => { engine.current?.setBlocked(phase !== "playing" || panel !== null || chat !== null); }, [chat]);
  useEffect(() => { engine.current?.setBlocked(phase !== "playing" || panel !== null || chat !== null); }, [phase, panel]);

  function start() {
    audio.current?.unlock();
    setPhase("playing");
    engine.current?.intro();
    window.setTimeout(() => toast("WASD / stick to walk · drag to look · E to use", "info"), 3200);
  }
  function toggleSound() {
    const kit = audio.current; if (!kit) return;
    kit.unlock(); kit.setMuted(!muted); setMuted(!muted);
  }

  const mode = hud?.mode ?? "walk", flying = mode === "fly" || mode === "launch" || mode === "land";
  const planet = hud?.planet ?? null, act = hud?.activity ?? null;
  const fishCaught = hud ? hud.book.fish.filter(f => f.caught).length : 0;

  return (
    <div className="fp-root" data-mode={mode}>
      <canvas ref={canvas} className="fp-canvas" tabIndex={0} aria-label="Friend Planets: a 3D world. Use WASD or the on-screen stick to walk, drag to look around." />
      <div ref={stickBase} className="fp-stick" aria-hidden="true"><div ref={stickKnob} className="fp-knob" /></div>

      {phase === "playing" && hud && <>
        <div className="fp-hud">
          <div className="fp-hud-l">
            {planet && !act && <div className="fp-pill fp-where">
              <b>{planet.name}</b>
              <span>{planet.home ? "Your planet" : `Friend #${planet.host}'s planet`}</span>
            </div>}
            {flying && hud.fly && <div className="fp-pill fp-speed"><b>{hud.fly.speed}</b><span>km/s{hud.fly.boosting ? " · boost" : ""}</span></div>}
            {!act && mode === "walk" && hud.quest && <div className="fp-pill fp-quest">
              <i className="fp-ring" style={{ ["--p" as string]: `${(hud.quest.n - 1) / hud.quest.total * 100}%` }}>{hud.quest.n}</i>
              <span>{hud.quest.text}</span>
            </div>}
          </div>
          <div className="fp-hud-r">
            <button type="button" className="fp-pill fp-rf" onClick={() => setPanel("shop")} title="Simulated RF: earn by playing, spend at the market"><Coin /><b>{hud.wallet.rf}</b><small>RF · sim</small></button>
            {act ? <button type="button" className="fp-pill fp-leave" onClick={() => engine.current?.endActivity()}><kbd>Esc</kbd> Leave</button>
              : <div className="fp-bar-r" role="toolbar" aria-label="Menu">
                <button type="button" className="fp-icon" onClick={() => setPanel("book")} aria-label="Collection" title="Collection"><Icon name="book" />{fishCaught > 0 && <small>{fishCaught}</small>}</button>
                {mode === "walk" && <button type="button" className="fp-icon" onClick={() => setPanel("shop")} aria-label="Market and shop" title="Market"><Icon name="bag" />{hud.wallet.bag.length > 0 && <small className="fp-badge">{hud.wallet.bag.reduce((n, g) => n + g.n, 0)}</small>}</button>}
                <button type="button" className={`fp-icon${hud.online.status === "online" ? " on" : ""}`} onClick={() => setPanel("online")} aria-label="Who's online" title="Online"><Icon name="globe" />{hud.online.status === "online" && <small>{hud.online.players.length + 1}</small>}</button>
                <button type="button" className="fp-icon" onClick={toggleSound} aria-label={muted ? "Turn sound on" : "Turn sound off"} title="Sound"><Icon name={muted ? "soundOff" : "soundOn"} /></button>
                <button type="button" className="fp-icon" onClick={() => setPanel("help")} aria-label="How to play" title="How to play"><Icon name="help" /></button>
              </div>}
          </div>
        </div>

        {mode === "walk" && hud.prompt && <button type="button" className="fp-prompt" onClick={() => engine.current?.useNearest()}>
          <kbd>E</kbd><span><b>{hud.prompt.title}</b>{hud.prompt.detail && <small>{hud.prompt.detail}</small>}</span>
        </button>}
        {(mode === "walk" || mode === "race") && touch && <button type="button" className="fp-jump" onPointerDown={() => engine.current?.jump()} aria-label="Jump">⤒</button>}
        {mode === "race" && hud.race && <div className="fp-racehud">
          {hud.race.countdown > 0 ? <div key={hud.race.countdown} className="fp-count">{hud.race.countdown}</div> : <div className="fp-racetime"><b>{hud.race.time.toFixed(1)}s</b><span>Ring {Math.min(hud.race.ring + 1, hud.race.total)}/{hud.race.total}{hud.race.best ? ` · best ${hud.race.best.toFixed(1)}s` : ""}</span></div>}
          <p className="fp-act-hint">A / D (or the stick) steer · Space jumps for high rings · Shift boosts · Esc quits</p>
        </div>}
        {mode === "walk" && <div className="fp-chatbar">
          {chat === null ? <button type="button" className="fp-icon fp-glass" onClick={() => setChat("")} aria-label="Chat (T)" title="Chat (T)"><Icon name="chat" /></button>
            : <form onSubmit={e => { e.preventDefault(); if (chat.trim()) engine.current?.say(chat); setChat(null); }}>
                <input autoFocus maxLength={80} placeholder="Say something…" value={chat} onChange={e => setChat(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setChat(null); }} />
              </form>}
          <button type="button" className={`fp-icon fp-glass${emotes ? " on" : ""}`} onClick={() => setEmotes(!emotes)} aria-label="Emotes" aria-expanded={emotes}><Icon name="smile" /></button>
          {emotes && <div className="fp-emotes">{(["wave", "heart", "party", "laugh"] as const).map(e => <button key={e} type="button" className="fp-emote" onClick={() => { engine.current?.emote(e); setEmotes(false); }} aria-label={e}>{({ wave: "👋", heart: "❤️", party: "🎉", laugh: "😂" })[e]}</button>)}</div>}
        </div>}

        {mode === "launch" && hud.countdown > 0 && <div key={hud.countdown} className="fp-count">{hud.countdown}</div>}

        {mode === "land" && hud.land && hud.land.phase === "descent" && <div className="fp-landhud">
          <div className="fp-gauge" aria-hidden="true"><i style={{ bottom: `${Math.min(100, hud.land.alt / 38 * 100)}%` }}>🚀</i></div>
          <div className="fp-readout">
            <span>Altitude <b>{hud.land.alt} m</b></span>
            <span>Falling <b className={hud.land.speed < 2.8 ? "ok" : hud.land.speed < 5.5 ? "warn" : "bad"}>{Math.max(0, hud.land.speed).toFixed(1)} m/s</b></span>
            <small>Touch down under 2.8 m/s for a perfect landing</small>
          </div>
          <button type="button" className={`fp-thrust${hud.land.thrusting ? " on" : ""}`} onPointerDown={() => engine.current?.setThrust(true)} onPointerUp={() => engine.current?.setThrust(false)} onPointerLeave={() => engine.current?.setThrust(false)}>THRUST<small>hold Space</small></button>
        </div>}

        {mode === "fly" && hud.fly && <>
          <div className="fp-nav" role="group" aria-label="Autopilot: choose a planet">
            {hud.planets.map(p => <button key={p.index} type="button" className={`fp-chip${hud.fly!.target === p.index ? " on" : ""}${hud.fly!.near === p.index ? " near" : ""}`} onClick={() => engine.current?.setTarget(hud.fly!.target === p.index ? null : p.index)}>
              <span className="fp-chip-ico">{p.home ? "🏠" : p.sport ? SPORTS[p.sport].emoji : "🪐"}</span>
              <span className="fp-chip-txt"><b>{p.name}</b><small>{p.home ? "home" : `#${p.host}`}{p.visited && !p.home ? " ✓" : ""}</small></span>
            </button>)}
          </div>
          <form className="fp-discover" onSubmit={e => { e.preventDefault(); const n = Number(visitId); if (Number.isInteger(n) && n > 0) { engine.current?.discover(n); setVisitId(""); } }}>
            <button type="button" className="fp-disc-btn" disabled={hud.discovering} onClick={() => engine.current?.discover()}>🔭 {hud.discovering ? "Scanning…" : "Discover a Friend"}</button>
            <label><span className="fp-sr">Visit a Friend by token number</span><input inputMode="numeric" placeholder="Friend #" value={visitId} onChange={e => setVisitId(e.target.value.replace(/\D/g, "").slice(0, 7))} /></label>
            <button type="submit" disabled={hud.discovering || !visitId}>Visit</button>
          </form>
          <div className="fp-flybtns">
            <button type="button" className="fp-view" onClick={() => engine.current?.toggleView()}><kbd>C</kbd> {hud.fly.view === "cockpit" ? "Outside view" : "Cockpit view"}</button>
            {hud.fly.near !== null && <button type="button" className="fp-land" onClick={() => engine.current?.land()}><kbd>E</kbd> Land on {hud.planets[hud.fly.near].name}</button>}
            <button type="button" className={`fp-boost${hud.fly.boosting ? " on" : ""}`} onPointerDown={() => engine.current?.setBoost(true)} onPointerUp={() => engine.current?.setBoost(false)} onPointerLeave={() => engine.current?.setBoost(false)}>BOOST<small>Shift</small></button>
          </div>
        </>}

        {act && <div className="fp-act">
          <div className="fp-act-top">
            <div className="fp-act-title">{act.kind === "fish" ? "🎣" : SPORTS[act.kind].emoji} {act.title}</div>
            {act.score && <div className="fp-act-score">{act.score}</div>}
            {act.health && <div className="fp-health">
              <div><span>You</span><i><b style={{ width: `${act.health.me}%` }} /></i></div>
              <div><span>Friend #{planet?.host}</span><i><b className="them" style={{ width: `${act.health.them}%` }} /></i></div>
            </div>}
          </div>
          {act.flash && <div key={act.flash.id} className={`fp-flash${act.flash.good ? " good" : ""}`}>{act.flash.text}</div>}
          {!act.result && <div className="fp-act-bottom">
            {act.hint && <p className="fp-act-hint">{act.hint}</p>}
            {act.meter && <Meter m={act.meter} />}
            {act.bars && <div className="fp-bars">{act.bars.map(b => <div key={b.label} className="fp-bar"><span>{b.label}</span><i><b style={{ width: `${b.value * 100}%`, background: b.color }} /><em style={{ left: `${b.danger * 100}%` }} /></i></div>)}</div>}
            <div className="fp-act-btns">
              {act.sides && <button type="button" className="fp-side" onPointerDown={() => { engine.current?.side(-1); engine.current?.setSteer(-1); }} onPointerUp={() => engine.current?.setSteer(0)} onPointerLeave={() => engine.current?.setSteer(0)} aria-label="Left">◀ <small>A</small></button>}
              <button type="button" className="fp-action" onPointerDown={() => { engine.current?.setAction(true); engine.current?.action(); }} onPointerUp={() => engine.current?.setAction(false)} onPointerLeave={() => engine.current?.setAction(false)} disabled={act.action === "…"}>{act.action}<small>{act.hold ? "hold Space / E" : "Space / E"}</small></button>
              {act.buttons?.map(b => <button key={b.id} type="button" className="fp-side fp-extra" onPointerDown={() => engine.current?.activityButton(b.id, true)} onPointerUp={() => engine.current?.activityButton(b.id, false)} onPointerLeave={() => engine.current?.activityButton(b.id, false)}>{b.label}<small>{b.id === "block" ? "S" : "W"}</small></button>)}
              {act.sides && <button type="button" className="fp-side" onPointerDown={() => { engine.current?.side(1); engine.current?.setSteer(1); }} onPointerUp={() => engine.current?.setSteer(0)} onPointerLeave={() => engine.current?.setSteer(0)} aria-label="Right"><small>D</small> ▶</button>}
            </div>
          </div>}
          {act.result && <div className="fp-result">
            <div className={`fp-card${act.result.good ? " good" : ""}`}>
              <h2>{act.result.title}</h2>
              {act.result.lines.map(l => <p key={l}>{l}</p>)}
              <div className="fp-result-btns">
                <button type="button" className="fp-cta" onClick={() => engine.current?.action()}>{act.action}</button>
                <button type="button" className="fp-cta fp-ghost" onClick={() => engine.current?.endActivity()}>Leave</button>
              </div>
            </div>
          </div>}
        </div>}
      </>}

      <div className="fp-toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`fp-toast ${t.kind}`}>{t.text}</div>)}</div>

      {phase === "loading" && <div className="fp-screen"><div className="fp-card"><div className="fp-spinner" /><p>Building your planet…</p></div></div>}
      {phase === "error" && <div className="fp-screen"><div className="fp-card"><h2>Something went wrong</h2><p>{failure}</p></div></div>}
      {phase === "title" && pilot && <div className="fp-screen fp-title">
        <div className="fp-card">
          <Portrait pilot={pilot} />
          <h1>Friend Planets</h1>
          <p>Friend #{friendId.toString()} · {FAMILY_NAMES[pilot.familyId % 9]} family{pilot.fallback ? " · artwork unavailable, using a stand-in" : ""}</p>
          <p className="fp-perkline">{perkOf(pilot.familyId).icon} <b>{perkOf(pilot.familyId).name}:</b> {perkOf(pilot.familyId).text}</p>
          <div className="fp-slide" aria-live="polite">
            <span className="fp-slide-ico">{SLIDES[slide].icon}</span>
            <div><b>{SLIDES[slide].title}</b><p>{SLIDES[slide].text}</p></div>
          </div>
          <div className="fp-dots">{SLIDES.map((sl, i) => <button key={sl.title} type="button" className={i === slide ? "on" : ""} onClick={() => setSlide(i)} aria-label={`Card ${i + 1} of ${SLIDES.length}`} />)}</div>
          <div className="fp-title-btns">
            {slide < SLIDES.length - 1 && <button type="button" className="fp-cta fp-ghost" onClick={() => setSlide(slide + 1)}>Next</button>}
            <button type="button" className="fp-cta" onClick={start}>Play</button>
          </div>
        </div>
      </div>}
      {panel === "help" && <div className="fp-screen" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="fp-card fp-help" role="dialog" aria-modal="true" aria-label="How to play">
          <h2>How to play</h2>
          <ul>
            <li><b>Walk</b> WASD or the stick · <b>Look</b> drag · <b>Jump</b> Space · <b>Use</b> E</li>
            <li><b>Fly</b> WASD steers, Shift boosts, C swaps the view. Tap a planet for autopilot, E to land. Discover visits any Friend by number.</li>
            <li><b>Play</b> Space / E / tap, A / D to aim or dodge, S blocks, W star punch. Esc leaves.</li>
            <li><b>Market</b> sell what you catch, grow and dig, then buy hats, rocket paint and upgrades. Quests, sports, races and landings pay RF too (simulated for now).</li>
          </ul>
          <button type="button" className="fp-cta" onClick={() => setPanel(null)}>Back to playing</button>
        </div>
      </div>}
      {panel === "online" && hud && <div className="fp-screen" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="fp-card fp-onlinepanel" role="dialog" aria-modal="true" aria-label="Who's online">
          <h2>🌐 Online now</h2>
          <p>{hud.online.status === "online" ? `${hud.online.players.length + 1} Friend${hud.online.players.length ? "s" : ""} in the galaxy (you included).` : hud.online.status === "connecting" ? "Connecting…" : "You're offline."}</p>
          <ul>
            {hud.online.players.map(p => <li key={p.id}>
              <span><b>Friend #{p.friendId}</b> <small>{FAMILY_NAMES[p.family % 9]} · {p.where}</small></span>
              <button type="button" disabled={p.flying || p.here || mode !== "walk" && mode !== "fly"} onClick={() => { engine.current?.goTo(p.planetId); setPanel(null); }}>{p.here ? "Here" : p.flying ? "Flying" : "Go"}</button>
            </li>)}
            {hud.online.status === "online" && !hud.online.players.length && <li className="fp-empty">Nobody else right now. Share the game and meet here!</li>}
          </ul>
          <label className="fp-toggle"><input type="checkbox" checked={hud.online.enabled} onChange={e => engine.current?.setOnline(e.target.checked)} /> Play online (see others, they see you)</label>
          <p className="fp-fine">Peer to peer through public Nostr relays: only your Friend number, where you stand, chat and emotes are shared (no wallet address). Like any peer-to-peer game, other players can see your IP address.</p>
          <button type="button" className="fp-cta" onClick={() => setPanel(null)}>Close</button>
        </div>
      </div>}
      {panel === "shop" && hud && <div className="fp-screen" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="fp-card fp-shop" role="dialog" aria-modal="true" aria-label="Market and shop">
          <div className="fp-shop-head"><h2>Market</h2><div className="fp-shop-bal"><Coin /><b>{hud.wallet.rf}</b> RF</div><button type="button" className="fp-x" onClick={() => setPanel(null)} aria-label="Close">×</button></div>
          <p className="fp-sim">Simulated RF · nothing touches your wallet · fixed prices, no mystery boxes</p>
          <div className="fp-tabs" role="tablist">{SHOP_TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={shopTab === t.id} className={shopTab === t.id ? "on" : ""} onClick={() => setShopTab(t.id)}>{t.label}</button>)}</div>
          {shopTab === "sell" ? <>
            {hud.wallet.bag.length ? <>
              <ul className="fp-goods">{hud.wallet.bag.map(g => <li key={g.key}>
                <span className="fp-goods-ico">{g.icon}</span><span className="fp-goods-name"><b>{g.name}</b><small>×{g.n} · {g.price} RF each</small></span>
                <button type="button" onClick={() => engine.current?.sell(g.key)}>Sell {g.n * g.price}</button>
              </li>)}</ul>
              <button type="button" className="fp-cta" onClick={() => engine.current?.sell("all")}>Sell everything · {hud.wallet.bag.reduce((n, g) => n + g.n * g.price, 0)} RF</button>
            </> : <p className="fp-empty">Your bag is empty. Fish, farm, dig and catch butterflies, then sell them here. Quests, sports, races and good landings pay RF too.</p>}
          </> : <ul className="fp-items">{SHOP.filter(i => i.kind === shopTab).map(i => {
            const owned = hud.wallet.owned.includes(i.id), worn = hud.wallet.equip.rocket === i.id || hud.wallet.equip.hat === i.id, count = hud.wallet.items[i.id] ?? 0;
            return <li key={i.id} className={worn ? "worn" : ""}>
              <span className="fp-item-ico">{i.icon}</span>
              <span className="fp-item-txt"><b>{i.name}{count ? ` ×${count}` : ""}</b><small>{i.text}</small></span>
              {i.kind === "item" ? <span className="fp-item-btns">
                  {i.id === "item:fert" && count > 0 && <button type="button" disabled={!hud.wallet.canFertilize} onClick={() => engine.current?.fertilize()} title={hud.wallet.canFertilize ? "Ripen your crops now" : "Stand on a planet with growing crops"}>Use</button>}
                  <button type="button" disabled={hud.wallet.rf < i.price} onClick={() => engine.current?.buy(i.id)}>{i.price} RF</button>
                </span>
                : worn ? <span className="fp-item-tag">{i.kind === "gear" ? "Owned" : "Wearing"}</span>
                : owned ? (i.kind === "gear" ? <span className="fp-item-tag">Owned</span> : <button type="button" onClick={() => engine.current?.equip(i.id)}>Use</button>)
                : <button type="button" disabled={hud.wallet.rf < i.price} onClick={() => engine.current?.buy(i.id)}>{i.price} RF</button>}
            </li>;
          })}</ul>}
        </div>
      </div>}
      {panel === "book" && hud && <div className="fp-screen" onPointerDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
        <div className="fp-card fp-book" role="dialog" aria-modal="true" aria-label="Collection">
          <div className="fp-shop-head"><h2>Collection</h2><div className="fp-shop-bal fp-starbal">★ <b>{hud.stars}</b></div><button type="button" className="fp-x" onClick={() => setPanel(null)} aria-label="Close">×</button></div>
          <h3>Fish {fishCaught}/{hud.book.fish.length}</h3>
          <div className="fp-fishgrid">
            {hud.book.fish.map(f => <div key={f.name} className={`fp-fish${f.caught ? "" : " unknown"}${f.here ? " here" : ""}`} title={f.caught ? `${f.name} · best ${f.best} cm` : "Not caught yet"}>
              <i style={{ background: f.caught ? f.color : "#bbb", borderColor: RARITY_COLOR[f.rarity] }} />
              <b>{f.caught ? f.name : "???"}</b><small>{RARITY[f.rarity]}{f.caught ? ` · ×${f.caught}` : f.here ? " · swims here" : ""}</small>
            </div>)}
          </div>
          <h3>Treasures {hud.book.treasures.filter(t => t.n).length}/{hud.book.treasures.length}</h3>
          <div className="fp-finds">{hud.book.treasures.map(t => <span key={t.name} className={t.n ? "" : "unknown"} title={t.n ? `${t.name} ×${t.n}` : "Not found yet"}>{t.n ? t.icon : "?"}<small>{t.n ? t.name : RARITY[t.rarity]}</small></span>)}</div>
          <h3>Butterflies {hud.book.bugs.filter(b => b.n).length}/{hud.book.bugs.length}</h3>
          <div className="fp-finds">{hud.book.bugs.map(b => <span key={b.name} className={b.n ? "" : "unknown"} title={b.n ? `${b.name} ×${b.n}` : "Not caught yet"}><i style={{ background: b.n ? b.color : "#bbb" }} /><small>{b.n ? b.name : RARITY[b.rarity]}</small></span>)}</div>
          <h3>Harvest</h3>
          <p>{hud.book.crops.length ? hud.book.crops.map(c => `${c.name} ×${c.n}`).join(" · ") : "Nothing yet: plant something on a farm."}</p>
          <h3>Trophies {hud.book.trophies.length}/7</h3>
          <p>{hud.book.trophies.length ? hud.book.trophies.map(t => `${SPORTS[t.sport].emoji} ${t.planet}`).join(" · ") : "Win the sport on a Friend's planet to earn its trophy."}</p>
        </div>
      </div>}
    </div>
  );
}
