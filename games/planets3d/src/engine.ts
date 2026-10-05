// The world: planets, your Friend, the rocket, the sky and the loop.
// React (index.tsx) owns menus and the HUD; this class owns everything 3D.
import * as THREE from "three";
import type { Clips } from "../sprites";
import { FAMILY_HELLO, FISH, HOST_LINES, SPORTS, TAU, fishOf, mulberry32, perkOf, planetName, seedOf, themeOf, type Crop, type Perk, type Sport } from "./data";
import { loadPilot } from "../pilot";
import { stillClips, fallbackSprite } from "../sprites";
import { EMOTE_ICONS, NetClient, type NetStatus, type PeerState } from "./net";
import { BUGS, Extras, FAMILY_TREASURE, TREASURES, type Find } from "./extras";
import { ROSTER } from "../sprites";
import { Activity, Boxing, Fishing, Penalty, Tennis, type ActivityHud, type ActivityKind, type Reward } from "./activities";
import { GROW_MS, plotsFor, stageOf, type Progress } from "./progress";
import { SHOP, canBuy, claimDaily, goodsOf, grant, has, itemById, sell, splitFor, stash, useItem, walletOf, type Order, type ShopItem } from "./economy";
import { payments } from "./payments";
import { Aura } from "./aura";
import { Blocks, glowMaterial, litMaterial } from "./models";
import { CAMERA, OrbitCamera } from "./camera";
import { Input } from "./input";
import { FriendBillboard, Label, blobShadow, headTop } from "./models";
import { Planet, SUN_DIR, surfaceFrame, type Station } from "./planet";
import { Cockpit, DOOR_SPOT, RAMP_FOOT, RocketModel } from "./rocket";
import { Sky } from "./sky";
import { PARTICLE_SCALE, TIME } from "./look";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { orbitFor, planetSpecFor, type World } from "./galaxy";
import type { ValleyAudio } from "../audio";

export type Mode = "walk" | "board" | "launch" | "fly" | "land" | "play" | "intro" | "race";
export type LandPhase = "entry" | "flip" | "descent" | "touch" | "exit";
export type ToastKind = "info" | "good" | "bad";
export interface PlanetInfo { index: number; name: string; region: string; home: boolean; host: number | null; sport: Sport | null; fishing: boolean; farm: boolean; visited: boolean }
export interface HudState {
  mode: Mode; planet: PlanetInfo | null; planets: PlanetInfo[];
  prompt: { title: string; detail: string } | null;
  fly: { speed: number; boosting: boolean; target: number | null; near: number | null; view: "cockpit" | "chase" } | null;
  countdown: number;
  land: { phase: LandPhase; alt: number; speed: number; thrusting: boolean } | null;
  perk: Perk;
  quest: { n: number; total: number; text: string } | null;
  online: { status: NetStatus; enabled: boolean; players: { id: string; friendId: number; family: number; where: string; here: boolean; flying: boolean; planetId: number }[] };
  discovering: boolean;
  stars: number;
  activity: ActivityHud | null;
  book: { fish: { name: string; color: string; rarity: number; caught: number; best: number; here: boolean }[]; crops: { name: string; n: number }[]; trophies: { planet: string; sport: Sport }[]; treasures: { name: string; icon: string; rarity: number; n: number }[]; bugs: { name: string; color: string; rarity: number; n: number }[] };
  race: { countdown: number; time: number; ring: number; total: number; best: number | null } | null;
  /** Simulated RF wallet (see economy.ts). */
  wallet: { bag: { key: string; name: string; icon: string; n: number; price: number }[]; owned: string[]; equip: { rocket: string; hat: string; aura: string }; items: Record<string, number>; canFertilize: boolean; simulated: boolean; owner: number | null };
}
export interface EngineHost {
  onHud(state: HudState): void;
  onToast(text: string, kind: ToastKind): void;
  onProgress(progress: Progress): void;
}
export interface EngineElements { canvas: HTMLCanvasElement; stickBase: HTMLElement; stickKnob: HTMLElement }

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
const NOSE_TO_COCKPIT = new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2);
const COCKPIT_HEIGHT = 5.6;
const CRUISE = 75, BOOST = 200, LIFTOFF = 3;
const smooth = (x: number) => x * x * (3 - 2 * x);

type Host = {
  planet: Planet; id: number; family: number; model: FriendBillboard; label: Label; shadow: THREE.Mesh; n: THREE.Vector3; world: THREE.Vector3;
  home: THREE.Vector3; roam: number; target: THREE.Vector3; wait: number; moving: boolean; dir: THREE.Vector3;
  bubble: Label; bubbleT: number; greeted: boolean; chatT: number; visitor: boolean;
};
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
function randomTangent(n: THREE.Vector3) {
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(n, helper).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1), a = Math.random() * TAU;
  return t1.multiplyScalar(Math.cos(a)).add(t2.multiplyScalar(Math.sin(a)));
}
/** A hat is an emoji sprite sitting on a Friend's head (its centre sits this far above the head). */
const HAT_LIFT = 0.02;
function hatFor(id: string | undefined) { return id ? itemById(id)?.hat ?? null : null; }
type PeerView = {
  id: string; s: PeerState; model: FriendBillboard; label: Label; bubble: Label; bubbleT: number; shadow: THREE.Mesh; hat: Label; hatY: number; aura: Aura | null; auraId: string;
  n: THREE.Vector3; world: THREE.Vector3; hop: number; vy: number; clipsFor: number; seen: number;
};
type Quest = { id: string; text: string; target: "pond" | "farm" | "pad" | "sport" | "dig" | "bug" | "race"; done: (e: Engine) => boolean };
const QUESTS: Quest[] = [
  { id: "fish", text: "Catch a fish off the dock", target: "pond", done: e => Object.keys(e.progress.fish).length > 0 },
  { id: "plant", text: "Plant a crop on your farm", target: "farm", done: e => Object.values(e.progress.farms).some(f => f.some(p => p.crop)) || Object.keys(e.progress.crops).length > 0 },
  { id: "dig", text: "Dig up a treasure (look for sparkles)", target: "dig", done: e => Object.keys(e.progress.treasures ?? {}).length > 0 },
  { id: "bug", text: "Catch a butterfly", target: "bug", done: e => Object.keys(e.progress.bugs ?? {}).length > 0 },
  { id: "race", text: "Finish the hoverboard ring race", target: "race", done: e => Object.keys(e.progress.raceBest ?? {}).length > 0 },
  { id: "fly", text: "Fly your rocket to a Friend's planet", target: "pad", done: e => e.progress.visited.some(id => id !== e.planets[0].spec.id) },
  { id: "sport", text: "Beat a Friend at their sport", target: "sport", done: e => Object.keys(e.progress.trophies).length > 0 },
  { id: "harvest", text: "Harvest a crop", target: "farm", done: e => Object.values(e.progress.crops).some(n => n > 0) },
  { id: "discover", text: "Discover a new Friend's planet (🔭 in space)", target: "pad", done: e => (e.progress.discovered?.length ?? 0) > 0 },
  { id: "trophies", text: "Win 3 trophies", target: "sport", done: e => Object.keys(e.progress.trophies).length >= 3 },
];

export class Engine {
  readonly input: Input;
  readonly planets: Planet[] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.6, 0.3, 5000);
  private cam = new OrbitCamera(this.camera);
  private sky = new Sky();
  private sun = new THREE.DirectionalLight("#ffe9c9", 2.1);
  private hemi = new THREE.HemisphereLight("#fff6ec", "#2c3160", 1.25);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  /** Phones and small screens skip shadows and bloom. */
  readonly lowPower = window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 500;
  private friend: FriendBillboard;
  private shadow = blobShadow(0.8);
  private rocket: RocketModel;
  private cockpit: Cockpit;
  private pilot: FriendBillboard;
  private hosts: Host[] = [];
  private spaceLabels: Label[] = [];
  current: Planet;
  mode: Mode = "walk";
  // Walking (planet-local): unit direction, frame (Y = up), hop height.
  private n = new THREE.Vector3(0, 1, 0);
  private Q = new THREE.Quaternion();
  private hop = 0;
  private vy = 0;
  private heading = Math.PI;
  private moving = false;
  private walkClock = 0;
  private solid: { p: THREE.Vector3; r: number }[] = [];
  // Flying (world): position, orientation (nose = +Y), speed.
  private ship = { p: new THREE.Vector3(), o: new THREE.Quaternion(), v: 0, throttle: 0.5, boosting: false, steerX: 0, steerY: 0 };
  private view: "cockpit" | "chase" = "cockpit";
  private target: number | null = null;
  private leftPlanet: Planet | null = null;
  private cut: { pos: THREE.Vector3; dir: THREE.Vector3; walking: boolean } | null = null;
  private cine = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), speed: 4 };
  private camBlend = 0;
  private camBlendRate = 1.4;
  private introT = 0;
  private camFrom = new THREE.Vector3();
  private thrustHeld = false;
  private L = { phase: "entry" as LandPhase, t: 0, dur: 3, alt: 0, vel: 0, pad: new THREE.Vector3(), up: new THREE.Vector3(), padQ: new THREE.Quaternion(), from: new THREE.Vector3(), ctrl: new THREE.Vector3(), entry: new THREE.Vector3(), flipFrom: new THREE.Quaternion(), thrusting: false, touch: 0, planet: null as Planet | null };
  private seq = { t: 0, from: new THREE.Vector3(), fromO: new THREE.Quaternion(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), toO: new THREE.Quaternion(), above: new THREE.Vector3(), planet: null as Planet | null };
  private visited = new Set<number>([0]);
  private time = 0;
  private last = 0;
  private hudAt = 0;
  private hudKey = "";
  private frameHandle = 0;
  private running = true;
  private paused = false;
  private blocked = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private promptStation: Station | null = null;
  private promptPlot = -1;
  private activity: Activity | null = null;
  private activityHost: Host | null = null;
  private plotMeshes: { group: THREE.Group; stage: number; crop: string | null }[] = [];
  private plotsAt = 0;
  private hostClips = new Map<Planet, { clips: Clips; id: number }>();
  private shelf = new THREE.Group();
  private bonkAt = 0;

  readonly perk: Perk;
  private glowLight: THREE.PointLight | null = null;
  private cheer = new Label(0.6);
  private cheerT = 0;
  private pendingCheer: { won: boolean; sport: boolean } | null = null;
  private arrow: THREE.Mesh;
  private questAt = 0;
  private discovering = false;
  private growMs = GROW_MS;
  readonly net = new NetClient();
  private peers = new Map<string, PeerView>();
  private netAt = 0;
  private moveDir = new THREE.Vector3();
  private myBubble = new Label(0.36);
  private myBubbleT = 0;
  private pendingGo: number | null = null;
  onlineEnabled = true;
  extras: Extras | null = null;
  private promptExtra: { kind: "dig" | "bug" | "race"; i: number } | null = null;
  private race = { t: 0, ring: 0, heading: 0, speed: 0, hover: 0 };
  private board3d: THREE.Mesh;
  private myHat = new Label(0.8);
  constructor(private elements: EngineElements, world: World, private clips: Clips, private friendId: bigint, private host: EngineHost, private audio: ValleyAudio | null, readonly progress: Progress) {
    this.renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    if (!this.lowPower) {
      this.renderer.shadowMap.enabled = true;
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 160;
      this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.hemi.position.copy(SUN_DIR);
    this.scene.add(this.sun, this.sun.target, this.hemi, this.sky.group);

    for (const spec of world.specs) {
      const planet = new Planet(spec);
      this.planets.push(planet); this.scene.add(planet.group);
      const label = new Label(0.05);
      label.sprite.material.sizeAttenuation = false;
      label.set([{ text: spec.name, size: 40 }, { text: spec.home ? "home" : `Friend #${spec.id}${spec.sport ? " · " + SPORTS[spec.sport].name : ""}`, color: spec.theme.accent, size: 26 }]);
      label.sprite.position.copy(spec.center).addScaledVector(Y, spec.R * 1.35);
      label.sprite.visible = false;
      this.scene.add(label.sprite); this.spaceLabels.push(label);
    }
    world.hosts.forEach((friend, i) => { if (friend) { this.addHost(this.planets[i], friend.clips, friend.id); this.hostClips.set(this.planets[i], { clips: friend.clips, id: friend.id }); } });
    for (const id of progress.visited) { const p = this.planets.find(q => q.spec.id === id); if (p) this.visited.add(p.spec.index); }

    const home = this.planets[0];
    this.current = home;
    this.homeFamily = home.spec.family;
    this.perk = perkOf(home.spec.family);
    if (this.perk.id === "greenThumb") this.growMs = GROW_MS / 2;
    this.rocket = new RocketModel(...this.rocketColors());
    this.scene.add(this.rocket.group);
    this.friend = new FriendBillboard(clips);
    this.scene.add(this.friend.group, this.shadow);
    this.myHat.sprite.position.set(0, headTop(clips) + HAT_LIFT, 0.05); this.friend.mesh.add(this.myHat.sprite); // tilts with the billboard
    this.wearHat();
    this.wearAura();
    if (this.perk.id === "glow") { this.glowLight = new THREE.PointLight(home.spec.theme.glow, 0, 10, 1.6); this.glowLight.position.set(0, 1.4, 0.3); this.friend.group.add(this.glowLight); }
    this.cheer.sprite.visible = false; this.scene.add(this.cheer.sprite);
    this.myBubble.sprite.visible = false; this.scene.add(this.myBubble.sprite);
    this.board3d = new Blocks().box(1.7, 0.14, 0.75, 0, 0.1, 0, "#1f1c2b").box(1.5, 0.05, 0.55, 0, 0.19, 0, "#ccff00").mesh(glowMaterial);
    this.board3d.visible = false; this.friend.group.add(this.board3d);
    try { this.onlineEnabled = window.localStorage.getItem("friend-planets-3d:online") !== "off"; } catch { /* default on */ }
    this.net.onPeer = (id, st) => this.peerState(id, st);
    this.net.onLeave = id => this.dropPeer(id);
    this.net.onSay = (id, text) => { const p = this.peers.get(id); if (p) { p.bubble.set([{ text, color: "#111111", size: 30 }], true); p.bubbleT = 5; this.audio?.pop(); } };
    this.net.onEmote = (id, e) => { const p = this.peers.get(id); if (p) { p.bubble.set([{ text: EMOTE_ICONS[e] ?? "!", size: 56 }], true); p.bubbleT = 2.5; if (p.hop === 0) { p.vy = 7; p.hop = 0.01; } } };
    this.net.onStatus = () => this.emitHud();
    this.net.hello(this.onlineEnabled);
    // Guide arrow: a flat chevron on the ground in front of you, pointing the way.
    const chevron = new THREE.Shape();
    chevron.moveTo(0, 0.9); chevron.lineTo(0.75, 0); chevron.lineTo(0.38, 0); chevron.lineTo(0, 0.45); chevron.lineTo(-0.38, 0); chevron.lineTo(-0.75, 0); chevron.lineTo(0, 0.9);
    const arrowGeo = new THREE.ShapeGeometry(chevron); arrowGeo.rotateX(Math.PI / 2);
    this.arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#f2c46b").multiplyScalar(1.25), side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    this.arrow.renderOrder = 4;
    this.arrow.visible = false; this.scene.add(this.arrow);
    // Planets you discovered before come back (their artwork is read from the chain again).
    for (const id of progress.discovered ?? []) void loadPilot(BigInt(id)).then(art => { if (this.running && !this.planets.some(p => p.spec.id === id)) this.addPlanet({ id, familyId: art.familyId, clips: art.clips }); });
    this.cockpit = new Cockpit(home.spec.theme.roof);
    this.pilot = new FriendBillboard(clips, 1.3);
    this.pilot.show("up", false, 0);
    this.pilot.group.rotation.y = 0.55;
    this.pilot.group.position.set(0.05, 0.02, -0.3);
    this.cockpit.seat.add(this.pilot.group);

    if (this.lowPower) this.quality = 1;
    this.buildShelf(home);
    this.parkRocket(home);
    this.arrive(home, home.spawn, home.stations.find(s => s.kind === "pad")!.pos);
    this.cam.pitch = 0.36;

    this.input = new Input(elements.canvas, this.cam, { base: elements.stickBase, knob: elements.stickKnob });
    this.input.onTap = () => { if (this.mode === "play") this.action(); };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(elements.canvas.parentElement ?? elements.canvas);
    this.resize();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- setup helpers
  private addHost(planet: Planet, clips: Clips, id: number, visitor = false, at?: THREE.Vector3) {
    const model = new FriendBillboard(clips), label = new Label(0.45), shadow = blobShadow(0.8), bubble = new Label(0.36);
    label.set([{ text: `Friend #${id}`, color: "#ccff00", size: 34 }]);
    bubble.sprite.visible = false;
    const arena = planet.stations.find(s => s.kind === "sport");
    const n = (at ?? (arena ? planet.baseUp.clone().lerp(arena.n, 0.55) : planet.dir(4.5 / planet.R, 0.6))).normalize();
    const family = this.hostClips.get(planet)?.id === id ? planet.spec.family : (this.planets.find(p => p.spec.id === id)?.spec.family ?? 0);
    const world = planet.group.position.clone().addScaledVector(n, planet.surface(n));
    model.group.position.copy(world);
    label.sprite.position.copy(world).addScaledVector(n, 2.6);
    shadow.position.copy(world).addScaledVector(n, 0.04);
    shadow.quaternion.setFromUnitVectors(Y, n);
    this.scene.add(model.group, label.sprite, shadow, bubble.sprite);
    const h: Host = { planet, id, family, model, label, shadow, n, world, home: n.clone(), roam: visitor ? 3.2 : 4.5, target: n.clone(), wait: 1 + Math.random() * 3, moving: false, dir: new THREE.Vector3(), bubble, bubbleT: 0, greeted: false, chatT: 8, visitor };
    this.hosts.push(h);
    return h;
  }
  private hostSay(h: Host, text: string, seconds = 4) {
    h.bubble.set([{ text, color: "#111111", size: 30 }], true);
    h.bubbleT = seconds; this.audio?.pop();
  }
  /** Friends wander around their spot and chat when you're near. */
  private updateHosts(dt: number) {
    const planet = this.current, R = planet.R, me = tmpA.copy(this.n).multiplyScalar(R);
    for (const h of this.hosts) {
      if (h.planet !== planet) continue;
      h.bubbleT -= dt; h.chatT -= dt;
      if (h !== this.activityHost) {
        if (!h.moving) {
          h.wait -= dt;
          if (h.wait <= 0) { h.target.copy(h.home).addScaledVector(randomTangent(h.home), (Math.random() * h.roam) / R).normalize(); h.moving = true; }
        } else {
          const tangent = tmpB.copy(h.target).addScaledVector(h.n, -h.n.dot(h.target));
          const dist = h.n.angleTo(h.target) * R;
          if (dist < 0.25 || tangent.lengthSq() < 1e-8) { h.moving = false; h.wait = 1.5 + Math.random() * 4; }
          else {
            tangent.normalize();
            const next = tmpC.copy(h.n).addScaledVector(tangent, Math.min(dist, 1.7 * dt) / R).normalize();
            if (planet.walkable(next)) { h.n.copy(next); h.dir.copy(tangent); } else { h.moving = false; h.wait = 1; }
          }
        }
        h.world.copy(planet.group.position).addScaledVector(h.n, planet.surface(h.n));
      }
      const d = me.distanceTo(tmpB.copy(h.n).multiplyScalar(R)), lines = HOST_LINES[h.family % 9];
      if (!h.greeted && d < 7) { h.greeted = true; this.hostSay(h, h.visitor ? pick(["Came to see your planet!", "Nice campfire!", "Your planet looks just like you!"]) : pick(lines.hello)); }
      else if (h.greeted && d < 12 && h.chatT <= 0 && h.bubbleT <= -6) { h.chatT = 10 + Math.random() * 10; this.hostSay(h, pick(h.visitor ? ["Thanks for visiting me!", "I love it here.", "Want to go fishing later?"] : lines.idle)); }
    }
  }
  /** Friends you've met come and hang out by your campfire. */
  private syncVisitors(home: Planet) {
    for (const p of this.planets) {
      if (p.spec.home || !this.progress.visited.includes(p.spec.id)) continue;
      if (this.hosts.some(h => h.visitor && h.id === p.spec.id)) continue;
      const clips = this.hostClips.get(p)?.clips;
      if (!clips) continue;
      const at = home.baseUp.clone().addScaledVector(randomTangent(home.baseUp), (3.6 + Math.random() * 2) / home.R).normalize();
      this.addHost(home, clips, p.spec.id, true, at).family = p.spec.family;
    }
  }
  // ---------------------------------------------------------------- online
  private sendState() {
    if (this.net.status !== "online") return;
    const onPlanet = this.mode === "walk" || this.mode === "play" || this.mode === "board" || this.mode === "intro" || this.mode === "race";
    const r3 = (v: THREE.Vector3): [number, number, number] => [Math.round(v.x * 1e4) / 1e4, Math.round(v.y * 1e4) / 1e4, Math.round(v.z * 1e4) / 1e4];
    const d = this.moveDir.lengthSq() > 0 ? this.moveDir.clone().normalize() : new THREE.Vector3(1, 0, 0);
    this.net.state({ f: Number(this.friendId), fam: this.homeFamily % 9, p: onPlanet ? this.current.spec.id : 0, n: r3(this.n), d: r3(d), m: this.moving && this.mode === "walk", mode: this.mode, act: this.activity?.kind ?? "", h: walletOf(this.progress).equip.hat, a: walletOf(this.progress).equip.aura });
  }
  private peerState(id: string, st: PeerState) {
    let p = this.peers.get(id);
    if (!p) {
      const model = new FriendBillboard(stillClips(fallbackSprite(st.f)));
      const label = new Label(0.42), bubble = new Label(0.36), shadow = blobShadow(0.8), hat = new Label(0.8);
      label.set([{ text: `Friend #${st.f}`, color: "#7db4db", size: 34 }]);
      bubble.sprite.visible = false;
      this.scene.add(model.group, label.sprite, bubble.sprite, shadow, hat.sprite);
      p = { id, s: st, model, label, bubble, bubbleT: 0, shadow, hat, hatY: 2, aura: null, auraId: "", n: new THREE.Vector3(...st.n).normalize(), world: new THREE.Vector3(), hop: 0, vy: 0, clipsFor: 0, seen: this.time };
      this.peers.set(id, p);
      this.host.onToast(`Friend #${st.f} is online`, "info");
      const view = p;
      // Their real Friend, read from the chain.
      void loadPilot(BigInt(st.f)).then(art => {
        if (!this.peers.has(id) || view.clipsFor === st.f) return;
        view.clipsFor = st.f;
        const fresh = new FriendBillboard(art.clips);
        this.scene.remove(view.model.group); view.model.dispose();
        view.model = fresh; this.scene.add(fresh.group); view.hatY = headTop(art.clips) + HAT_LIFT;
      });
    }
    if (p.s.p !== st.p) p.n.set(...st.n).normalize();
    p.s = st; p.seen = this.time;
    const hat = hatFor(st.h);
    if (hat) p.hat.set([{ text: hat, size: 40 }]);
    p.hat.sprite.userData.on = !!hat;
    if ((st.a ?? "") !== p.auraId) {
      p.auraId = st.a ?? ""; p.aura?.dispose(); p.aura = null;
      const look = itemById(p.auraId)?.aura;
      if (look) { p.aura = new Aura(look.color, look.sparkle); this.scene.add(p.aura.group); }
    }
  }
  private dropPeer(id: string) {
    const p = this.peers.get(id); if (!p) return;
    this.scene.remove(p.model.group, p.label.sprite, p.bubble.sprite, p.shadow, p.hat.sprite);
    p.model.dispose(); p.label.dispose(); p.bubble.dispose(); p.hat.dispose(); p.aura?.dispose();
    this.peers.delete(id);
  }
  private updatePeers(dt: number) {
    const planet = this.current;
    for (const p of this.peers.values()) {
      if (this.time - p.seen > 20) { this.dropPeer(p.id); continue; }
      const here = p.s.p === planet.spec.id && p.s.mode !== "fly" && (this.mode === "walk" || this.mode === "play" || this.mode === "intro" || this.mode === "race");
      p.model.group.visible = p.label.sprite.visible = p.shadow.visible = here;
      p.hat.sprite.visible = here && p.hat.sprite.userData.on === true;
      if (p.aura) p.aura.group.visible = here;
      p.bubbleT -= dt;
      p.bubble.sprite.visible = here && p.bubbleT > 0;
      if (!here) continue;
      p.n.lerp(tmpA.set(...p.s.n), Math.min(1, dt * 8)).normalize();
      if (p.hop > 0 || p.vy > 0) { p.hop += p.vy * dt; p.vy -= 22 * dt; if (p.hop <= 0) { p.hop = 0; p.vy = 0; } }
      p.world.copy(planet.group.position).addScaledVector(p.n, planet.surface(p.n) + p.hop);
    }
  }
  private drawPeers() {
    const camRight = tmpB.set(1, 0, 0).applyQuaternion(this.camera.quaternion).clone(), camFwd = tmpC.set(0, 0, -1).applyQuaternion(this.camera.quaternion).clone();
    for (const p of this.peers.values()) {
      if (!p.model.group.visible) continue;
      const n = p.n, toCam = tmpA.copy(this.camera.position).sub(p.world);
      const fwd = toCam.addScaledVector(n, -toCam.dot(n)).normalize(), right = new THREE.Vector3().crossVectors(n, fwd).normalize();
      p.model.group.quaternion.setFromRotationMatrix(tmpM.makeBasis(right, n, fwd));
      p.model.group.position.copy(p.world);
      const d = new THREE.Vector3(...p.s.d), dx = d.dot(camRight), dz = d.dot(camFwd);
      const facing = !p.s.m ? "down" : Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "up" : "down";
      p.model.show(facing, p.s.m, Math.floor(this.time * (p.s.m ? 10 : 5)) % 8);
      p.label.sprite.position.copy(p.world).addScaledVector(n, 2.6);
      p.label.sprite.visible = !p.bubble.sprite.visible;
      p.bubble.sprite.position.copy(p.world).addScaledVector(n, 2.6);
      p.hat.sprite.position.copy(p.world).addScaledVector(n, p.hatY);
      if (p.aura) { p.aura.group.position.copy(p.world).addScaledVector(n, -p.hop); p.aura.group.quaternion.setFromUnitVectors(Y, n); }
      p.shadow.position.copy(p.world).addScaledVector(n, 0.04 - p.hop); p.shadow.quaternion.setFromUnitVectors(Y, n);
    }
  }
  /** Say something: a bubble over your Friend that everyone on your planet sees. */
  say(text: string) {
    const clean = text.replace(/https?:\/\/\S+|www\.\S+|[<>]/gi, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!clean) return;
    this.myBubble.set([{ text: clean, color: "#111111", size: 30 }], true); this.myBubbleT = 5;
    this.net.say(clean); this.audio?.pop();
    if (this.net.status !== "online") this.host.onToast("You're offline: only you can see this. Turn on online in 🌐.", "info");
  }
  emote(e: string) {
    this.myBubble.set([{ text: EMOTE_ICONS[e] ?? "!", size: 56 }], true); this.myBubbleT = 2.5;
    if (this.mode === "walk" && this.hop === 0) { this.vy = 7; this.hop = 0.01; }
    this.net.emote(e);
  }
  setOnline(on: boolean) {
    this.onlineEnabled = on;
    try { window.localStorage.setItem("friend-planets-3d:online", on ? "on" : "off"); } catch { /* ignore */ }
    this.net.setOnline(on);
    if (!on) for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.emitHud();
  }
  /** Go to where another player is: board and fly there. */
  goTo(planetId: number) {
    if (planetId === this.current.spec.id && this.mode === "walk") { this.host.onToast("They're right here on this planet!", "info"); return; }
    if (this.mode === "fly") { void this.discover(planetId); return; }
    if (this.mode === "walk") { this.pendingGo = planetId; this.host.onToast("Boarding your rocket…", "info"); this.board(); }
  }
  private onlineHud(): HudState["online"] {
    const players = [...this.peers.values()].map(p => {
      const planet = this.planets.find(q => q.spec.id === p.s.p);
      const where = p.s.mode === "fly" || p.s.p === 0 ? "flying in space" : planet ? `on ${planet.spec.name}${planet.spec.id === p.s.f ? " (home)" : ""}` : `on Friend #${p.s.p}'s planet`;
      return { id: p.id, friendId: p.s.f, family: p.s.fam, where, here: p.s.p === this.current.spec.id && p.s.mode !== "fly", flying: p.s.mode === "fly" || p.s.p === 0, planetId: p.s.p };
    });
    return { status: this.net.status, enabled: this.onlineEnabled, players };
  }

  private celebrate(symbol = "★") {
    this.cheer.set([{ text: symbol, color: "#ccff00", size: 64 }]);
    this.cheerT = 1.6;
    if (this.mode === "walk" && this.hop === 0) { this.vy = 8; this.hop = 0.01; }
  }

  // ---------------------------------------------------------------- a growing galaxy
  /** Fly to a Friend's planet you haven't seen: a random one, or a token number you typed. */
  async discover(id?: number) {
    if (this.discovering) return;
    const existing = id !== undefined ? this.planets.find(p => p.spec.id === id) : undefined;
    if (existing) { this.setTarget(existing.spec.index); return; }
    this.discovering = true; this.emitHud();
    try {
      let found: { id: number; familyId: number; clips: Clips } | null = null;
      for (let i = 0; i < (id !== undefined ? 1 : 5) && !found; i++) {
        const tryId = id ?? 1 + Math.floor(Math.random() * 90000);
        if (this.planets.some(p => p.spec.id === tryId)) continue;
        this.host.onToast(`Scanning the chain for Friend #${tryId}…`, "info");
        const art = await loadPilot(BigInt(tryId));
        if (!art.fallback) found = { id: tryId, familyId: art.familyId, clips: art.clips };
      }
      if (!found && id !== undefined) { this.host.onToast(`Couldn't read Friend #${id} from the chain.`, "bad"); return; }
      if (!found) { const f = pick(ROSTER.filter(r => !this.planets.some(p => p.spec.id === r.id))); if (!f) return; found = { id: f.id, familyId: f.familyId, clips: f.clips }; }
      const planet = this.addPlanet(found);
      this.progress.discovered = [...(this.progress.discovered ?? []), found.id];
      this.host.onProgress(this.progress);
      this.host.onToast(`New planet: ${planet.spec.name}, Friend #${found.id}'s world!`, "good");
      this.audio?.fanfare();
      if (this.mode === "fly") this.setTarget(planet.spec.index);
    } finally { this.discovering = false; this.emitHud(); }
  }
  private addPlanet(friend: { id: number; familyId: number; clips: Clips }) {
    const index = this.planets.length;
    const planet = new Planet(planetSpecFor(friend.id, friend.familyId, friend.clips.idle.down[0], index, orbitFor(index - 1, seedOf(this.friendId)), false));
    this.planets.push(planet); this.scene.add(planet.group);
    const label = new Label(0.05);
    label.sprite.material.sizeAttenuation = false;
    label.set([{ text: planet.spec.name, size: 40 }, { text: `Friend #${friend.id} · ${SPORTS[planet.spec.sport!].name}`, color: planet.spec.theme.accent, size: 26 }]);
    label.sprite.position.copy(planet.group.position).addScaledVector(Y, planet.R * 1.35); label.sprite.visible = false;
    this.scene.add(label.sprite); this.spaceLabels.push(label);
    this.hostClips.set(planet, { clips: friend.clips, id: friend.id });
    this.addHost(planet, friend.clips, friend.id);
    return planet;
  }

  // ---------------------------------------------------------------- quests
  private checkQuests() {
    const p = this.progress; p.quests ??= [];
    for (const q of QUESTS) {
      if (p.quests.includes(q.id) || !q.done(this)) continue;
      p.quests.push(q.id); p.stars += 10;
      this.host.onProgress(p);
      this.host.onToast(`Quest complete: ${q.text} · +10 ★`, "good");
      this.audio?.fanfare(); this.celebrate("★");
      break;
    }
  }
  private questNow() {
    const done = this.progress.quests ?? [];
    const i = QUESTS.findIndex(q => !done.includes(q.id));
    return i < 0 ? null : { n: i + 1, total: QUESTS.length, quest: QUESTS[i] };
  }
  /** Where the guide arrow points on this planet (or null). */
  private questTarget(): THREE.Vector3 | null {
    const q = this.questNow(); if (!q) return null;
    const x = this.extras;
    if (q.quest.target === "race") return x ? x.raceStart : null;
    if (q.quest.target === "dig" || q.quest.target === "bug") {
      if (!x) return null;
      const me = this.n.clone().multiplyScalar(this.current.R);
      const spots = q.quest.target === "dig" ? x.digs.filter(d => d.wait <= 0).map(d => d.n.clone().multiplyScalar(this.current.R)) : x.bugs.filter(b => b.wait <= 0).map(b => b.group.position.clone());
      spots.sort((a, b) => a.distanceTo(me) - b.distanceTo(me));
      return spots[0] ?? null;
    }
    let kind = q.quest.target as Station["kind"];
    if (kind === "sport" && this.current.spec.home) kind = "pad";
    const s = this.current.stations.find(st => st.kind === kind) ?? this.current.stations.find(st => st.kind === "pad");
    return s ? s.pos : null;
  }

  /** Put your Friend down at `at` (unit dir) facing `lookAt` (planet-local point). */
  private arrive(planet: Planet, at: THREE.Vector3, lookAt: THREE.Vector3, camYaw = 0) {
    planet.ensureDetail();
    this.current = planet;
    this.n.copy(at).normalize();
    const m = surfaceFrame(this.n, lookAt.clone().normalize(), 1);
    // Face along +Z of that frame means "toward lookAt"; our forward is -Z, so turn around.
    this.Q.setFromRotationMatrix(m).multiply(tmpQ.setFromAxisAngle(Y, Math.PI));
    // Face the camera (heading 0) while the camera looks past you toward where you are headed.
    this.hop = 0; this.vy = 0; this.heading = camYaw; this.cam.yaw = camYaw; this.cam.pitch = CAMERA.startPitch;
    this.solid = planet.colliders.map(c => ({ p: c.p.clone().setLength(planet.R), r: c.r }));
    this.buildCrops(planet);
    if (this.extras?.planet !== planet) { this.extras?.dispose(); this.extras = new Extras(planet); }
    if (planet.spec.home) this.syncVisitors(planet);
    for (const h of this.hosts) if (h.planet === planet) h.greeted = false;
    for (const p of this.planets) p.setVisitorView(p === planet);
  }

  private parkRocket(planet: Planet) {
    if (this.pendingPaint) { this.pendingPaint = false; this.repaintRocket(); }
    const pos = new THREE.Vector3(), scale = new THREE.Vector3();
    planet.padFrame.decompose(pos, this.ship.o, scale);
    this.ship.p.copy(planet.group.position).add(pos).addScaledVector(pos.normalize(), 0.3);
    this.ship.v = 0;
    this.placeRocket();
    this.rocket.setThrust(0, 0);
    this.rocket.setHatch(1);
  }
  private placeRocket() { this.rocket.group.position.copy(this.ship.p); this.rocket.group.quaternion.copy(this.ship.o); }

  // ---------------------------------------------------------------- loop
  // Auto quality: if frames are slow, drop bloom, then shadows, then resolution.
  private quality = 3;
  private cheapShadows = false;
  private shadowFrame = 0;
  private frameMs = 16;
  private qualityAt = 4;
  lockQuality = false;
  private govern(ms: number) {
    if (this.lockQuality || this.paused || document.hidden || ms > 250) return;
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (this.time < this.qualityAt || this.frameMs < 25 || this.quality <= 0) return;
    this.setQuality(this.quality - 1);
    this.qualityAt = this.time + 3;
  }
  setQuality(q: number) {
    this.quality = q;
    if (q < 3) this.composer = null;
    // Turning shadows off would recompile every shader at once (a long freeze, worst on Windows),
    // so instead the shadow map gets smaller and is redrawn every third frame.
    if (q < 2 && this.renderer.shadowMap.enabled && !this.cheapShadows) {
      this.cheapShadows = true;
      this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
      this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    }
    if (q < 1) { this.renderer.setPixelRatio(1); this.resize(); }
  }
  /** Trailer capture (webdriver only): the loop pauses and each captureStep() renders one fixed-length frame. */
  private capturing = false;
  captureMode(on: boolean) { this.capturing = on; this.last = 0; }
  captureStep(dt: number) { this.update(dt); this.draw(dt); }
  private frame = (now: number) => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.frame);
    if (this.capturing) return;
    if (this.last) this.govern(now - this.last);
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 0; this.last = now;
    if (!this.paused && !this.blocked && !document.hidden && dt > 0) this.update(dt);
    this.draw(this.paused ? 0 : dt);
  };

  private update(dt: number) {
    this.time += dt;
    TIME.value = this.time;
    this.rocket.update(dt);
    for (const p of this.planets) p.update(dt, this.camera.position);
    if (this.mode === "walk") this.updateWalk(dt);
    else if (this.mode === "board") this.updateBoard(dt);
    else if (this.mode === "launch") this.updateLaunch(dt);
    else if (this.mode === "fly") this.updateFly(dt);
    else if (this.mode === "land") this.updateLand(dt);
    else if (this.mode === "play") this.updatePlay(dt);
    else if (this.mode === "intro") this.updateIntro(dt);
    else if (this.mode === "race") this.updateRace(dt);
    if (this.mode === "walk" || this.mode === "race") this.extras?.update(dt, this.time);
    this.prebuild();
    if (this.time >= this.plotsAt) { this.plotsAt = this.time + 0.5; this.refreshCrops(); }
    if (this.mode === "walk" || this.mode === "play") this.updateHosts(dt);
    if (this.time >= this.questAt && this.mode === "walk") { this.questAt = this.time + 1; this.checkQuests(); }
    this.cheerT -= dt;
    this.myAura?.update(dt, this.time);
    for (const p of this.peers.values()) p.aura?.update(dt, this.time);
    this.myBubbleT -= dt;
    this.updatePeers(dt);
    if (this.time >= this.netAt) { this.netAt = this.time + 0.15; this.sendState(); }
    this.input.endFrame();
    if (this.time >= this.hudAt) { this.hudAt = this.time + 0.12; this.emitHud(); }
  }

  /**
   * Planets are built a few milliseconds per frame before you reach them, so
   * flying never freezes: your autopilot target first, then the nearest. On a
   * planet, the closest neighbours get ready in the background.
   */
  private prebuild() {
    const flying = this.mode === "launch" || this.mode === "fly";
    const from = flying ? this.ship.p : this.current.group.position;
    let best: Planet | null = null, bestD = Infinity;
    for (const p of this.planets) {
      if (p.built) continue;
      const d = flying && this.target === p.spec.index ? 0 : p.group.position.distanceTo(from) - p.R;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || (!flying && bestD > 650)) return;
    best.buildSome(flying ? (bestD < 300 ? 10 : 6) : 3);
  }

  // ---------------------------------------------------------------- walking
  private updateWalk(dt: number) {
    const planet = this.current;
    const [mx, my] = this.input.move(), yaw = this.cam.yaw;
    const dx = mx * Math.cos(yaw) - my * Math.sin(yaw), dz = -mx * Math.sin(yaw) - my * Math.cos(yaw);
    const amount = Math.min(1, Math.hypot(dx, dz));
    this.moving = amount > 0.05;
    if (this.moving) {
      const speed = 7.2 * amount * (this.input.held("shift") ? 1.5 : 1), step = speed * dt;
      const ux = dx / amount, uz = dz / amount;
      this.heading = Math.atan2(ux, uz);
      if (!this.step(tmpA.set(ux, 0, uz), step)) { if (!this.step(tmpA.set(ux, 0, 0), step * Math.abs(ux))) this.step(tmpA.set(0, 0, uz), step * Math.abs(uz)); }
      this.walkClock += dt * 11 * Math.max(0.6, amount);
    }
    if (this.input.take(" ") && this.hop === 0) { this.vy = this.perk.id === "float" ? 9.5 : 8.5; this.hop = 0.01; }
    if (this.hop > 0 || this.vy > 0) {
      const floating = this.perk.id === "float" && this.input.held(" ") && this.vy < 0;
      this.hop += this.vy * dt; this.vy -= (floating ? 4 : 24) * dt;
      if (floating) this.vy = Math.max(this.vy, -1.6);
      if (this.hop <= 0) {
        if (this.perk.id === "heavy" && this.vy < -7) { this.cam.addShake(0.35); this.audio?.bonk(); }
        this.hop = 0; this.vy = 0;
      }
    }
    // Nearest thing to use.
    const here = tmpB.copy(this.n).multiplyScalar(planet.R);
    let best: Station | null = null, bestD = Infinity;
    for (const s of planet.stations) {
      if (s.kind === "house" || s.kind === "sign") continue;
      const d = here.distanceTo(tmpC.copy(s.pos).setLength(planet.R));
      if (d < s.reach && d < bestD) { best = s; bestD = d; }
    }
    this.promptStation = best;
    this.promptPlot = best?.kind === "farm" ? this.nearestPlot(here) : -1;
    this.promptExtra = null;
    const x = this.extras;
    if (x) {
      const local = tmpC.copy(this.n).multiplyScalar(planet.surface(this.n));
      const dig = x.nearDig(local), bug = x.nearBug(local.clone().addScaledVector(this.n, 1));
      if (local.distanceTo(x.raceStart) < 3.2) this.promptExtra = { kind: "race", i: 0 };
      else if (dig >= 0) this.promptExtra = { kind: "dig", i: dig };
      else if (bug >= 0) this.promptExtra = { kind: "bug", i: bug };
    }
    if (this.promptExtra && (this.input.take("e") || this.input.take("enter"))) this.useExtra();
    else if (best && (this.input.take("e") || this.input.take("enter"))) this.use(best);
    else { this.input.take("e"); this.input.take("enter"); }
    this.input.take("c"); this.input.take("f");
  }

  /** Move along the planet by `step` in local direction `local`; returns false if blocked. */
  private step(local: THREE.Vector3, step: number) {
    const planet = this.current, R = planet.R;
    const dir = local.applyQuaternion(this.Q);
    this.moveDir.copy(dir);
    const p = tmpC.copy(this.n).multiplyScalar(R).addScaledVector(dir, step);
    for (const c of this.solid) {
      const d = p.distanceTo(c.p), min = c.r + 0.5;
      if (d < min) p.addScaledVector(tmpB.copy(p).sub(c.p).normalize(), min - d);
    }
    const n2 = p.normalize();
    if (!planet.walkable(n2)) return false;
    tmpQ.setFromUnitVectors(this.n, n2);
    this.Q.premultiply(tmpQ);
    this.n.copy(n2);
    return true;
  }

  private use(station: Station) {
    const planet = this.current;
    if (station.kind === "pad") { this.board(); return; }
    if (station.kind === "farm") { this.tendPlot(); return; }
    if (station.kind === "pond") { this.startActivity("fish", station); return; }
    if (station.kind === "sport" && planet.spec.sport) this.startActivity(planet.spec.sport, station);
  }

  // ---------------------------------------------------------------- farming
  private crop(planet: Planet): Crop { return planet.spec.theme.crop; }
  private nearestPlot(here: THREE.Vector3) {
    let best = -1, bestD = 1.6;
    this.current.plots.forEach((plot, i) => { const d = here.distanceTo(tmpC.copy(plot.p).setLength(this.current.R)); if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  private tendPlot() {
    const planet = this.current, i = this.promptPlot;
    if (i < 0) { this.host.onToast("Walk onto a plot of soil to plant or harvest.", "info"); return; }
    const plots = plotsFor(this.progress, planet.spec.id), plot = plots[i], stage = stageOf(plot, Date.now(), this.growMs), crop = this.crop(planet);
    if (stage === 0) {
      plot.crop = crop.name; plot.plantedAt = Date.now();
      this.audio?.pop(); this.host.onToast(`Planted ${crop.name}. Ready in ${Math.round(this.growMs / 1000)}s.`, "info");
    } else if (stage === 3) {
      const name = plot.crop!, n = has(this.progress, "gear:seeds") ? 2 : 1;
      this.progress.crops[name] = (this.progress.crops[name] ?? 0) + n;
      this.progress.stars += 3; stash(this.progress, `crop:${name}`, n);
      plot.crop = null; plot.plantedAt = 0;
      this.audio?.pickup(); this.host.onToast(`Harvested ${n > 1 ? n + " " : ""}${name} · +3 ★`, "good");
    } else {
      this.host.onToast(`${plot.crop} is growing… ${Math.ceil((this.growMs - (Date.now() - plot.plantedAt)) / 1000)}s`, "info");
      return;
    }
    this.host.onProgress(this.progress);
    this.refreshCrops(true);
  }
  private buildCrops(planet: Planet) {
    for (const m of this.plotMeshes) { m.group.removeFromParent(); m.group.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
    this.plotMeshes = planet.plots.map(plot => {
      const group = new THREE.Group();
      new THREE.Matrix4().makeTranslation(planet.group.position).multiply(plot.frame).decompose(group.position, group.quaternion, group.scale);
      this.scene.add(group);
      return { group, stage: -1, crop: null };
    });
    this.refreshCrops(true);
  }
  private refreshCrops(force = false) {
    const planet = this.current;
    if (!planet.plots.length) return;
    const plots = plotsFor(this.progress, planet.spec.id), now = Date.now();
    plots.forEach((plot, i) => {
      const slot = this.plotMeshes[i], stage = stageOf(plot, now, this.growMs);
      if (!slot || (!force && slot.stage === stage && slot.crop === plot.crop)) return;
      slot.stage = stage; slot.crop = plot.crop;
      slot.group.traverse(o => (o as THREE.Mesh).geometry?.dispose()); slot.group.clear();
      if (stage === 0) return;
      const crop = this.cropByName(plot.crop!) ?? this.crop(planet);
      slot.group.add(...cropModel(crop, stage));
    });
  }
  private cropByName(name: string): Crop | undefined { for (const p of this.planets) if (p.spec.theme.crop.name === name) return p.spec.theme.crop; return undefined; }

  // ---------------------------------------------------------------- trophy shelf (home, next to your door)
  private buildShelf(home: Planet) {
    const house = home.stations.find(s => s.kind === "house")!;
    const m = new THREE.Matrix4().makeTranslation(home.group.position).multiply(house.frame).multiply(new THREE.Matrix4().makeTranslation(3.5, 0, 1.4));
    m.decompose(this.shelf.position, this.shelf.quaternion, this.shelf.scale);
    this.shelf.scale.setScalar(1.5);
    this.scene.add(this.shelf);
    const p = new THREE.Vector3(3.5, 0, 1.4).applyMatrix4(house.frame);
    home.colliders.push({ p, r: 1.7 });
    this.refreshShelf();
  }
  private refreshShelf() {
    this.shelf.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    this.shelf.clear();
    const wood = "#a8784e", b = new Blocks(), gold = "#f2c14e";
    b.box(2.6, 0.12, 0.9, 0, 0.8, 0, wood).box(0.14, 0.8, 0.14, -1.15, 0.4, -0.3, wood).box(0.14, 0.8, 0.14, 1.15, 0.4, -0.3, wood).box(0.14, 0.8, 0.14, -1.15, 0.4, 0.3, wood).box(0.14, 0.8, 0.14, 1.15, 0.4, 0.3, wood)
      .box(2.6, 0.12, 0.5, 0, 1.55, -0.2, wood).box(0.12, 0.8, 0.12, -1.2, 1.2, -0.35, wood).box(0.12, 0.8, 0.12, 1.2, 1.2, -0.35, wood);
    const won = Object.values(this.progress.trophies);
    const ball: Record<Sport, string> = { goal: "#ffffff", tennis: "#d9ff3a", boxing: "#e8543f" };
    won.slice(0, 7).forEach((sport, i) => {
      const x = -1 + (i % 4) * 0.66, y = i < 4 ? 0.86 : 1.61, z = i < 4 ? 0.1 : -0.2;
      b.box(0.34, 0.1, 0.34, x, y + 0.05, z, "#6d5a3a").box(0.08, 0.22, 0.08, x, y + 0.21, z, gold)
        .add(new THREE.CylinderGeometry(0.2, 0.1, 0.3, 10), x, y + 0.46, z, gold).box(0.36, 0.06, 0.06, x, y + 0.5, z, gold)
        .add(new THREE.IcosahedronGeometry(0.09, 0), x, y + 0.66, z, ball[sport]);
    });
    this.shelf.add(b.mesh(litMaterial));
    if (!won.length) {
      const sign = new Label(0.28); sign.set([{ text: "trophies", color: "#f2ce68", size: 30 }]); sign.sprite.position.set(0, 1.75, 0); this.shelf.add(sign.sprite);
    }
  }

  // ---------------------------------------------------------------- activities
  private startActivity(kind: ActivityKind, station: Station) {
    const planet = this.current, host = this.hostClips.get(planet) ?? null;
    const root = new THREE.Group();
    const frame = station.frame.clone();
    if (kind === "fish") frame.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    new THREE.Matrix4().makeTranslation(planet.group.position).multiply(frame).decompose(root.position, root.quaternion, root.scale);
    this.scene.add(root);
    root.updateMatrixWorld(true);
    const water = planet.water, R = planet.R;
    const ctx = {
      root, me: this.clips, them: host?.clips ?? null, hostId: host?.id ?? null, family: planet.spec.family,
      floorY: kind === "fish" ? water + 0.55 - R : 0,
      waterY: (x: number, z: number) => Math.sqrt(Math.max(0, water * water - x * x - z * z)) - R,
      audio: this.audio, reward: (r: Reward) => this.reward(r, planet), shake: (a: number) => this.cam.addShake(a),
      pond: planet.pond ? root.worldToLocal(planet.pond.clone().add(planet.group.position)) : undefined,
      perk: this.perk.id,
      bait: kind === "fish" && useItem(this.progress, "item:bait"),
      rod: has(this.progress, "gear:rod"),
      held: () => this.actionHeld || this.input.held(" ") || this.input.held("e") || this.input.held("enter"),
      steer: () => this.steerHeld || (Number(this.input.held("d") || this.input.held("arrowright")) - Number(this.input.held("a") || this.input.held("arrowleft"))),
      move: () => this.input.move(),
      block: () => this.blockHeld || this.input.held("s") || this.input.held("arrowdown"),
    };
    this.activity = kind === "fish" ? new Fishing(ctx) : kind === "goal" ? new Penalty(ctx) : kind === "tennis" ? new Tennis(ctx) : new Boxing(ctx);
    this.activityHost = this.hosts.find(h => h.planet === planet) ?? null;
    if (ctx.bait) { this.host.onProgress(this.progress); this.host.onToast("🪱 Golden bait on the hook: a rare fish is in the pond!", "good"); }
    this.mode = "play";
    this.audio?.blip(760);
  }
  private updatePlay(dt: number) {
    const a = this.activity!;
    a.update(dt);
    if (this.input.take(" ") || this.input.take("e") || this.input.take("enter")) this.action();
    if (this.input.take("a") || this.input.take("arrowleft")) a.side(-1);
    if (this.input.take("d") || this.input.take("arrowright")) a.side(1);
    if (this.input.take("w") || this.input.take("arrowup")) a.special();
    if (this.input.take("escape") || this.input.take("q")) this.endActivity();
  }
  action() { if (this.mode === "play") this.activity?.action(); }
  private actionHeld = false;
  private steerHeld = 0;
  /** On-screen buttons that are held down (fishing reel, steering). */
  setAction(on: boolean) { this.actionHeld = on; }
  setSteer(dir: number) { this.steerHeld = dir; }
  private blockHeld = false;
  activityButton(id: string, down: boolean) {
    if (id === "block") this.blockHeld = down;
    if (id === "star" && down) this.activity?.special();
  }
  side(dir: number) { if (this.mode === "play") this.activity?.side(dir); }
  endActivity() {
    if (!this.activity) return;
    this.actionHeld = false; this.steerHeld = 0;
    const host = this.activityHost;
    this.activity.dispose(); this.activity = null; this.activityHost = null;
    this.mode = "walk";
    if (this.pendingCheer) {
      const { won, sport } = this.pendingCheer;
      if (won) this.celebrate(sport ? "🏆" : "♥");
      if (sport && host) this.hostSay(host, pick(won ? HOST_LINES[host.family % 9].youWin : HOST_LINES[host.family % 9].theyWin), 5);
      this.pendingCheer = null;
    }
    this.audio?.blip(520);
  }
  private reward(r: Reward, planet: Planet) {
    const p = this.progress;
    if (r.kind === "fish") {
      const entry = p.fish[r.fish.name] ?? { n: 0, best: 0 };
      const first = entry.n === 0;
      entry.n++; entry.best = Math.max(entry.best, r.size); p.fish[r.fish.name] = entry;
      p.stars += r.fish.rarity * 5; stash(p, `fish:${r.fish.name}`);
      if (first) this.host.onToast(`New fish for your log: ${r.fish.name}!`, "good");
      this.pendingCheer = { won: true, sport: false };
    } else {
      p.stars += r.stars;
      this.pendingCheer = { won: r.won, sport: true };
      const key = String(planet.spec.id);
      if (r.won && !p.trophies[key]) { p.trophies[key] = r.sport; this.refreshShelf(); this.host.onToast(`🏆 Trophy from ${planet.spec.name} · +${r.stars} ★`, "good"); }
      else this.host.onToast(`+${r.stars} ★`, r.won ? "good" : "info");
    }
    this.host.onProgress(p);
  }

  // ---------------------------------------------------------------- rocket: board, launch, fly, land
  board() {
    if (this.mode !== "walk") return;
    this.mode = "board"; this.seq.t = 0; this.view = "cockpit";
    this.playerWorld(this.seq.from);
    this.audio?.blip(660);
  }
  private rocketPoint(local: THREE.Vector3, out = new THREE.Vector3()) { return out.copy(local).applyQuaternion(this.ship.o).add(this.ship.p); }
  private updateBoard(dt: number) {
    const t = (this.seq.t += dt), walk = 0.8, climb = 1, close = 0.8;
    const foot = this.rocketPoint(RAMP_FOOT), door = this.rocketPoint(DOOR_SPOT);
    // Walk to the ramp, up it and in; then the hatch shuts behind you.
    if (t < walk) this.cut = { pos: this.seq.from.clone().lerp(foot, smooth(t / walk)), dir: foot.clone().sub(this.seq.from), walking: true };
    else if (t < walk + climb) this.cut = { pos: foot.clone().lerp(door, (t - walk) / climb), dir: door.clone().sub(foot), walking: true };
    else { this.cut = null; this.rocket.setHatch(1 - (t - walk - climb) / close); }
    this.cine.pos.copy(this.rocketPoint(new THREE.Vector3(6, 4, 12))); this.cine.look.copy(this.rocketPoint(new THREE.Vector3(0, 2.6, 1.5)));
    this.cine.up.set(0, 1, 0).applyQuaternion(this.ship.o); this.cine.speed = 3;
    if (t > walk + climb + close) {
      this.rocket.setHatch(0);
      this.mode = "launch"; this.seq.t = 0; this.leftPlanet = this.current;
      this.ship.v = 0; this.target = null;
      this.audio?.blip(440);
    }
  }
  private updateLaunch(dt: number) {
    this.seq.t += dt;
    const t = this.seq.t, up = tmpA.set(0, 1, 0).applyQuaternion(this.ship.o);
    if (t > LIFTOFF) {
      if (!this.seqFlag) { this.seqFlag = true; this.audio?.launch(); }
      const lift = t - LIFTOFF;
      this.ship.v = Math.min(CRUISE * 1.2, 3 + lift * lift * 22);
      this.ship.p.addScaledVector(up, this.ship.v * dt);
      this.cam.addShake(dt * 1.6);
    }
    this.rocket.setThrust(t > LIFTOFF - 0.6 ? Math.min(1, (t - LIFTOFF + 0.6) * 1.5) : 0, this.time);
    this.placeRocket();
    const planet = this.current, alt = this.ship.p.distanceTo(planet.group.position) - planet.R;
    if (alt > planet.R * 1.7) {
      this.mode = "fly"; this.seqFlag = false; this.ship.throttle = 0.6;
      if (this.pendingGo !== null) { const id = this.pendingGo; this.pendingGo = null; void this.discover(id); }
      else this.host.onToast("You're in space! Pick a planet to visit.", "good");
    }
  }
  private seqFlag = false;

  private updateFly(dt: number) {
    const s = this.ship;
    const [mx, my] = this.input.move();
    let steerX = mx, steerY = my;
    s.boosting = this.input.held("shift") || this.input.held(" ");
    if (this.target !== null && Math.abs(mx) + Math.abs(my) < 0.05) {
      // Autopilot: turn the nose toward the target planet.
      const goal = this.planets[this.target].group.position;
      const want = tmpA.copy(goal).sub(s.p).normalize();
      const nose = tmpB.set(0, 1, 0).applyQuaternion(s.o);
      const angle = nose.angleTo(want);
      if (angle > 0.002) {
        const axis = tmpC.crossVectors(nose, want).normalize();
        tmpQ.setFromAxisAngle(axis, Math.min(angle, dt * 1.6));
        s.o.premultiply(tmpQ).normalize();
      }
      steerX = THREE.MathUtils.clamp(-want.dot(tmpC.set(1, 0, 0).applyQuaternion(s.o)) * 3, -1, 1);
      steerY = THREE.MathUtils.clamp(want.dot(tmpC.set(0, 0, 1).applyQuaternion(s.o)) * 3, -1, 1);
    } else if (Math.abs(mx) + Math.abs(my) > 0.05) {
      this.target = null;
      s.o.multiply(tmpQ.setFromAxisAngle(Z, -mx * 1.5 * dt)).multiply(tmpQ2.setFromAxisAngle(X, my * 1.3 * dt)).normalize();
    }
    s.steerX += (steerX - s.steerX) * Math.min(1, dt * 8); s.steerY += (steerY - s.steerY) * Math.min(1, dt * 8);
    const wanted = s.boosting ? BOOST : CRUISE;
    s.v += (wanted - s.v) * Math.min(1, dt * (s.boosting ? 1.6 : 1.1));
    s.throttle += ((s.boosting ? 1 : 0.55) - s.throttle) * Math.min(1, dt * 5);
    const nose = tmpA.set(0, 1, 0).applyQuaternion(s.o);
    s.p.addScaledVector(nose, s.v * dt);
    // Don't fly through planets.
    for (const p of this.planets) {
      const d = s.p.distanceTo(p.group.position), min = p.R + 8;
      if (d < min) {
        s.p.copy(p.group.position).addScaledVector(tmpB.copy(s.p).sub(p.group.position).normalize(), min);
        s.v *= 0.4;
        if (this.time - this.bonkAt > 1) { this.bonkAt = this.time; this.audio?.bonk(); this.cam.addShake(0.6); this.host.onToast("Bonk! Press E (or LAND) near a planet to land.", "bad"); }
      }
    }
    this.rocket.setThrust(0.35 + s.throttle * 0.65, this.time);
    this.placeRocket();
    if (this.input.take("c")) this.view = this.view === "cockpit" ? "chase" : "cockpit";
    const near = this.nearPlanet();
    if (this.leftPlanet && s.p.distanceTo(this.leftPlanet.group.position) > this.leftPlanet.R + 140) this.leftPlanet = null;
    if (near && (this.input.take("e") || this.input.take("enter") || (this.target === near.spec.index && s.p.distanceTo(near.group.position) < near.R + 70))) this.startLanding(near);
    this.input.take("e"); this.input.take("enter"); this.input.take("f");
  }

  /** The planet you could land on right now (close enough, not the one you just left). */
  private nearPlanet(): Planet | null {
    let best: Planet | null = null, bestD = Infinity;
    for (const p of this.planets) {
      if (p === this.leftPlanet) continue;
      const d = this.ship.p.distanceTo(p.group.position) - p.R;
      if (d < 110 && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  setTarget(index: number | null) {
    if (this.mode !== "fly") return;
    this.target = index;
    if (index !== null) { this.audio?.blip(880); this.host.onToast(`Autopilot: heading to ${this.planets[index].spec.name}`, "info"); }
  }
  land() { const near = this.nearPlanet(); if (this.mode === "fly" && near) this.startLanding(near); }
  toggleView() { if (this.mode === "fly") this.view = this.view === "cockpit" ? "chase" : "cockpit"; }
  setBoost(on: boolean) { this.input.hold("shift", on); }

  private startLanding(planet: Planet) {
    planet.ensureDetail();
    this.mode = "land";
    const L = this.L, pos = new THREE.Vector3(), scale = new THREE.Vector3();
    planet.padFrame.decompose(pos, L.padQ, scale);
    L.planet = planet; L.phase = "entry"; L.t = 0; L.touch = 0;
    L.up.copy(pos).normalize();
    L.pad.copy(planet.group.position).add(pos).addScaledVector(L.up, 0.3);
    L.entry.copy(L.pad).addScaledVector(L.up, 46);
    L.from.copy(this.ship.p);
    // Arc in over the top so the planet swells in front of you.
    L.ctrl.copy(L.from).lerp(L.entry, 0.5).addScaledVector(L.up, planet.R * 1.2);
    L.dur = THREE.MathUtils.clamp(L.from.distanceTo(L.entry) / 55, 2.6, 4.2);
    this.target = null;
    this.audio?.blip(520);
    this.host.onToast(planet.spec.home ? `Home: ${planet.spec.name}` : `${planet.spec.name}: Friend #${planet.spec.id}'s planet`, "info");
  }
  setThrust(on: boolean) { this.thrustHeld = on; }
  /** Opening shot: your Friend's portrait on its planet, seen from above. */
  intro() {
    this.mode = "intro"; this.introT = 0;
    this.faceShot(this.current, 2.5);
    this.camera.position.copy(this.cine.pos);
    this.host.onToast(`This is ${this.current.spec.name}: your Friend's own planet.`, "good");
    const daily = claimDaily(this.progress);
    if (daily) { this.host.onProgress(this.progress); window.setTimeout(() => this.host.onToast(`☀️ Daily bonus: +${daily} ★`, "good"), 6500); }
  }
  private faceShot(planet: Planet, height: number) {
    const c = planet.group.position, R = planet.R;
    this.cine.pos.copy(c).addScaledVector(planet.faceDir, R * height).addScaledVector(planet.faceUp, -R * 0.35);
    this.cine.look.copy(c).addScaledVector(planet.faceDir, R * 0.95);
    this.cine.up.copy(planet.faceUp);
  }
  private updateIntro(dt: number) {
    this.introT += dt;
    this.faceShot(this.current, 2.5 - Math.min(1, this.introT / 2.6) * 0.5);
    this.cine.speed = 2;
    if (this.introT > 2.8 || this.input.take("e") || this.input.take(" ")) {
      this.camFrom.copy(this.camera.position); this.camBlend = 1; this.camBlendRate = 0.55;
      this.mode = "walk";
    }
  }
  private updateLand(dt: number) {
    const L = this.L, planet = L.planet!;
    L.t += dt;
    const nose = tmpA.set(0, 1, 0).applyQuaternion(this.ship.o);
    if (L.phase === "entry") {
      const t = Math.min(1, L.t / L.dur), u = 1 - t;
      this.ship.p.set(0, 0, 0).addScaledVector(L.from, u * u).addScaledVector(L.ctrl, 2 * u * t).addScaledVector(L.entry, t * t);
      // Nose follows the flight path.
      const tangent = tmpB.copy(L.ctrl).sub(L.from).multiplyScalar(2 * u).addScaledVector(tmpC.copy(L.entry).sub(L.ctrl), 2 * t).normalize();
      this.ship.o.premultiply(tmpQ.setFromUnitVectors(nose, tangent)).normalize();
      const alt = this.ship.p.distanceTo(planet.group.position) - planet.R;
      const heat = (1 - THREE.MathUtils.smoothstep(alt, planet.R * 0.9, planet.R * 2.4)) * (1 - THREE.MathUtils.smoothstep(t, 0.82, 1));
      this.rocket.setHeat(heat);
      this.rocket.setThrust(0.45, this.time);
      if (heat > 0.2) this.cam.addShake(dt * heat * 0.9);
      const planetUp = tmpC.copy(this.ship.p).sub(planet.group.position).normalize();
      if (L.t < 1.6) { this.faceShot(planet, 2.7); this.cine.speed = 3; }
      else {
        this.cine.pos.copy(this.ship.p).addScaledVector(tangent, -17).addScaledVector(planetUp, 5);
        this.cine.look.copy(this.ship.p).addScaledVector(tangent, 20);
        this.cine.up.copy(planetUp); this.cine.speed = 5;
      }
      if (t >= 1) { L.phase = "flip"; L.t = 0; L.flipFrom.copy(this.ship.o); this.rocket.setHeat(0); this.audio?.swish(); }
    } else if (L.phase === "flip") {
      const t = Math.min(1, L.t / 1.3), e = smooth(t);
      this.ship.o.slerpQuaternions(L.flipFrom, L.padQ, e);
      this.ship.p.copy(L.pad).addScaledVector(L.up, 46 - 8 * e);
      this.rocket.setThrust(t > 0.7 ? 0.8 : 0.15, this.time);
      this.sideCam(46 - 8 * e);
      if (t >= 1) { L.phase = "descent"; L.t = 0; L.alt = 38; L.vel = -7; this.host.onToast("Hold SPACE (or THRUST) to fire the engine. Touch down slowly!", "info"); }
    } else if (L.phase === "descent") {
      L.thrusting = this.thrustHeld || this.input.held(" ") || this.input.held("e") || this.input.held("enter") || this.input.held("w") || this.input.held("shift");
      L.vel = THREE.MathUtils.clamp(L.vel + (L.thrusting ? 13 : this.perk.id === "float" ? -5 : -7.5) * dt, -18, 5);
      L.alt += L.vel * dt;
      if (L.alt > 55) { L.alt = 55; L.vel = Math.min(0, L.vel); }
      this.ship.p.copy(L.pad).addScaledVector(L.up, Math.max(0, L.alt));
      this.ship.o.copy(L.padQ);
      this.rocket.setThrust(L.thrusting ? 1 : 0.12, this.time);
      if (L.thrusting && !this.reducedMotion) this.cam.addShake(dt * 0.25);
      this.sideCam(L.alt);
      if (L.alt <= 0) this.touchdown(-L.vel);
    } else if (L.phase === "touch") {
      this.rocket.setThrust(Math.max(0, 0.5 - L.t), this.time);
      this.exitCam();
      if (L.t > 1) { L.phase = "exit"; L.t = 0; this.audio?.blip(660); }
    } else if (L.phase === "exit") {
      const t = L.t, open = 0.9, walkDown = 1.1, walkOut = 0.6;
      this.rocket.setHatch(t / open);
      const door = this.rocketPoint(DOOR_SPOT), foot = this.rocketPoint(RAMP_FOOT), out = this.rocketPoint(new THREE.Vector3(0, 0.3, 5));
      if (t > open - 0.2 && t < open + walkDown) { const k = Math.max(0, (t - open + 0.2) / (walkDown + 0.2)); this.cut = { pos: door.clone().lerp(foot, k), dir: foot.clone().sub(door), walking: true }; }
      else if (t >= open + walkDown) { const k = Math.min(1, (t - open - walkDown) / walkOut); this.cut = { pos: foot.clone().lerp(out, k), dir: out.clone().sub(foot), walking: true }; }
      this.exitCam();
      if (t > open + walkDown + walkOut) this.finishLanding(planet, out);
    }
    this.placeRocket();
  }
  private sideCam(alt: number) {
    const L = this.L, side = tmpC.set(0.62, 0, 0.78).applyQuaternion(L.padQ);
    this.cine.pos.copy(L.pad).addScaledVector(L.up, 4 + alt * 0.6).addScaledVector(side, 22 + alt * 0.3);
    this.cine.look.copy(L.pad).addScaledVector(L.up, 2 + alt * 0.78);
    this.cine.up.copy(L.up); this.cine.speed = 2.6;
  }
  private exitCam() {
    this.cine.pos.copy(this.rocketPoint(new THREE.Vector3(5.2, 3, 10.5)));
    this.cine.look.copy(this.rocketPoint(new THREE.Vector3(0, 1.7, 2.8)));
    this.cine.up.copy(this.L.up); this.cine.speed = 2.2;
  }
  private touchdown(speed: number) {
    const L = this.L;
    L.phase = "touch"; L.t = 0; L.touch = speed;
    this.ship.p.copy(L.pad);
    this.rocket.land(speed);
    this.cam.addShake(Math.min(1, 0.2 + speed * 0.07));
    this.audio?.land();
    if (speed < 2.8) { this.progress.stars += 5; this.host.onProgress(this.progress); this.host.onToast("Perfect landing · +5 ★", "good"); this.audio?.fanfare(); }
    else if (speed < 5.5) { this.progress.stars += 2; this.host.onProgress(this.progress); this.host.onToast("Nice landing · +2 ★", "good"); }
    else { this.audio?.bonk(); this.host.onToast("Bumpy landing! Everyone's fine…", "bad"); }
  }
  private finishLanding(planet: Planet, out: THREE.Vector3) {
    const first = !this.visited.has(planet.spec.index);
    this.visited.add(planet.spec.index);
    if (!this.progress.visited.includes(planet.spec.id)) { this.progress.visited.push(planet.spec.id); this.host.onProgress(this.progress); }
    this.camFrom.copy(this.camera.position); this.camBlend = 1;
    this.cut = null;
    this.arrive(planet, out.clone().sub(planet.group.position).normalize(), planet.baseUp.clone().multiplyScalar(planet.R), -2.5);
    this.mode = "walk"; this.view = "cockpit";
    if (this.L.touch < 2.8) this.celebrate("★");
    if (planet.spec.home) this.host.onToast(`Home sweet home: ${planet.spec.name}`, "good");
    else this.host.onToast(first ? `Friend #${planet.spec.id}: "${FAMILY_HELLO[this.homeFamily % 9]}"` : `Back on ${planet.spec.name}!`, "good");
  }
  homeFamily = 0;

  // ---------------------------------------------------------------- drawing
  private playerWorld(out: THREE.Vector3) {
    const planet = this.current;
    return out.copy(this.n).multiplyScalar(planet.surface(this.n) + this.hop + (this.mode === "race" ? this.race.hover : 0)).add(planet.group.position);
  }

  private draw(dt: number) {
    const inRocket = this.mode === "launch" || this.mode === "fly" || this.mode === "land";
    const cinematic = this.mode === "board" || this.mode === "land" || this.mode === "intro";
    this.board3d.visible = this.mode === "race";
    if (this.extras) this.extras.group.visible = this.mode !== "play";
    const cockpitView = inRocket && this.view === "cockpit" && !cinematic;
    const playing = this.mode === "play" && this.activity;
    this.friend.group.visible = this.shadow.visible = cinematic ? Boolean(this.cut) : !inRocket && !playing;
    for (const h of this.hosts) h.model.group.visible = h.label.sprite.visible = h.shadow.visible = h !== this.activityHost;
    for (const label of this.spaceLabels) label.sprite.visible = this.mode === "fly";

    let skyUp: THREE.Vector3, atmos = 1, skyPlanet = this.current;
    if (cinematic) {
      if (this.camera.position.distanceTo(this.cine.pos) > 400) this.camera.position.copy(this.cine.pos);
      else this.camera.position.lerp(this.cine.pos, Math.min(1, dt * this.cine.speed));
      this.camera.up.lerp(this.cine.up, Math.min(1, dt * 4)).normalize();
      this.camera.lookAt(this.cine.look);
      if (this.cut) {
        // Cut-scene Friend: faces the camera, picks the sprite facing from its walking direction.
        const right = tmpB.set(1, 0, 0).applyQuaternion(this.camera.quaternion), fwd = tmpC.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const dx = this.cut.dir.dot(right), dz = this.cut.dir.dot(fwd);
        const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "up" : "down";
        this.friend.show(facing, this.cut.walking, Math.floor(this.time * 11) % 8);
        this.friend.mesh.rotation.set(0, 0, 0);
        this.friend.group.position.copy(this.cut.pos);
        this.friend.group.quaternion.copy(this.camera.quaternion);
        this.shadow.visible = false;
      }
      let bestD = Infinity;
      for (const p of this.planets) { const d = this.camera.position.distanceTo(p.group.position) - p.R; if (d < bestD) { bestD = d; skyPlanet = p; } }
      skyUp = tmpC.copy(this.camera.position).sub(skyPlanet.group.position).normalize();
      atmos = 1 - THREE.MathUtils.smoothstep(bestD, skyPlanet.R * 0.25, skyPlanet.R * 1.6);
      for (const p of this.planets) p.setVisitorView(p === skyPlanet && bestD < p.R * 1.1);
    } else if (playing) {
      const [pos, look] = this.activity!.view();
      const root = this.activity!.root;
      root.localToWorld(pos); root.localToWorld(look);
      if (this.camera.position.distanceTo(pos) > 25) this.camera.position.copy(pos); else this.camera.position.lerp(pos, Math.min(1, dt * 5));
      this.camera.up.set(0, 1, 0).applyQuaternion(root.quaternion);
      this.camera.lookAt(look);
      skyUp = tmpC.copy(this.n);
    } else if (!inRocket) {
      const me = this.playerWorld(tmpA);
      this.cam.update(dt, me, this.Q, this.input.keyYaw(), this.reducedMotion);
      if (this.camBlend > 0) {
        // Ease from the cinematic shot into the follow camera, swinging around the planet.
        this.camBlend = Math.max(0, this.camBlend - dt * this.camBlendRate);
        if (this.camBlend === 0) this.camBlendRate = 1.4;
        const k = smooth(1 - this.camBlend), c = this.current.group.position;
        const a = tmpB.copy(this.camFrom).sub(c), b = tmpC.copy(this.camera.position).sub(c);
        const la = a.length(), lb = b.length();
        tmpQ.setFromUnitVectors(a.normalize(), b.normalize());
        tmpQ2.identity().slerp(tmpQ, k);
        this.camera.position.copy(a.applyQuaternion(tmpQ2).multiplyScalar(la + (lb - la) * k)).add(c);
        this.camera.lookAt(tmpB.copy(me).addScaledVector(tmpC.set(0, 1, 0).applyQuaternion(this.Q), CAMERA.headHeight));
      }
      const frame = this.moving ? Math.floor(this.walkClock) % 8 : Math.floor(this.time * 5) % 8;
      this.friend.update(this.heading - (this.cam.yaw + Math.PI), this.moving, frame, this.cam.pitch);
      this.friend.group.position.copy(me);
      this.friend.group.quaternion.copy(this.Q).multiply(tmpQ.setFromAxisAngle(Y, this.cam.yaw));
      const ground = tmpB.copy(this.n).multiplyScalar(this.current.surface(this.n) + 0.05).add(this.current.group.position);
      this.shadow.position.copy(ground); this.shadow.quaternion.copy(this.Q); this.shadow.scale.setScalar(1 / (1 + this.hop * 0.3));
      skyUp = tmpC.copy(this.n);
    } else {
      const nose = tmpA.set(0, 1, 0).applyQuaternion(this.ship.o);
      if (cockpitView) {
        this.camera.position.copy(this.ship.p).addScaledVector(nose, COCKPIT_HEIGHT);
        this.camera.quaternion.copy(this.ship.o).multiply(NOSE_TO_COCKPIT).multiply(this.cockpit.camera.quaternion);
        if (this.mode === "launch" && !this.reducedMotion) this.camera.position.addScaledVector(tmpB.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), Math.min(0.12, this.ship.v * 0.004));
      } else {
        const back = 17, lift = 5;
        const viewUp = tmpB.set(0, 0, 1).applyQuaternion(this.ship.o);
        const want = tmpC.copy(this.ship.p).addScaledVector(nose, -back).addScaledVector(viewUp, lift);
        this.camera.position.lerp(want, Math.min(1, dt * 6));
        this.camera.up.copy(viewUp);
        this.camera.lookAt(tmpC.copy(this.ship.p).addScaledVector(nose, 10));
      }
      // Nearest planet decides the sky.
      let bestD = Infinity;
      for (const p of this.planets) { const d = this.camera.position.distanceTo(p.group.position) - p.R; if (d < bestD) { bestD = d; skyPlanet = p; } }
      skyUp = tmpC.copy(this.camera.position).sub(skyPlanet.group.position).normalize();
      atmos = 1 - THREE.MathUtils.smoothstep(bestD, skyPlanet.R * 0.25, skyPlanet.R * 1.6);
      for (const p of this.planets) p.setVisitorView(p === skyPlanet && bestD < p.R * 0.3);
    }
    this.rocket.group.visible = !cockpitView;
    this.setFov(cockpitView ? this.cockpit.camera.fov : this.portrait ? 80 : CAMERA.fov);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const h of this.hosts) {
      // Hosts face you; their sprite turns with the way they walk.
      const toCam = tmpA.copy(this.camera.position).sub(h.world);
      const n = h.n, fwd = toCam.addScaledVector(n, -toCam.dot(n)).normalize();
      const right = tmpB.crossVectors(n, fwd).normalize();
      h.model.group.quaternion.setFromRotationMatrix(tmpM.makeBasis(right, n, fwd));
      h.model.group.position.copy(h.world);
      const dx = h.dir.dot(camRight), dz = h.dir.dot(camFwd);
      const facing = !h.moving ? "down" : Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "up" : "down";
      h.model.show(facing, h.moving, Math.floor(this.time * (h.moving ? 10 : 5)) % 8);
      h.label.sprite.position.copy(h.world).addScaledVector(n, 2.6);
      h.shadow.position.copy(h.world).addScaledVector(n, 0.04); h.shadow.quaternion.setFromUnitVectors(Y, n);
      h.bubble.sprite.visible = h.bubbleT > 0 && h.model.group.visible && h.planet === this.current;
      if (h.bubble.sprite.visible) h.bubble.sprite.position.copy(h.world).addScaledVector(n, 2.6);
      h.label.sprite.visible = h.model.group.visible && !h.bubble.sprite.visible;
    }
    this.drawPeers();
    this.myBubble.sprite.visible = this.myBubbleT > 0 && this.friend.group.visible;
    if (this.myBubble.sprite.visible) this.myBubble.sprite.position.copy(this.playerWorld(tmpA)).addScaledVector(this.n, 2.7);
    // Your Friend's celebration, the quest arrow and the Sparkling glow.
    const me = this.playerWorld(tmpA), upMe = tmpB.copy(this.n);
    this.cheer.sprite.visible = this.cheerT > 0 && this.friend.group.visible;
    if (this.cheer.sprite.visible) this.cheer.sprite.position.copy(me).addScaledVector(upMe, 2.8 + (1.6 - this.cheerT) * 0.6);
    const target = this.mode === "walk" ? this.questTarget() : null;
    this.arrow.visible = false;
    if (target) {
      const t = tmpC.copy(target).add(this.current.group.position).sub(me);
      const along = t.addScaledVector(upMe, -t.dot(upMe));
      if (along.length() > 4.5) {
        along.normalize();
        this.arrow.visible = true;
        this.arrow.position.copy(me).addScaledVector(upMe, 0.35 - this.hop).addScaledVector(along, 1.9 + Math.sin(this.time * 5) * 0.25);
        this.arrow.quaternion.setFromRotationMatrix(tmpM.makeBasis(new THREE.Vector3().crossVectors(upMe, along).normalize(), upMe, along));
      }
    }
    if (this.glowLight) this.glowLight.intensity = (1 - THREE.MathUtils.smoothstep(upMe.dot(SUN_DIR), -0.1, 0.25)) * 14;
    this.sky.update(this.camera.position, skyUp, SUN_DIR, atmos, skyPlanet.spec.theme.sky);
    // Shadows follow whoever is in view.
    const focus = inRocket || cinematic ? this.ship.p : this.playerWorld(tmpA);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 80);
    // No shadows on the night side (the planet itself would be in the way).
    const upHere = tmpB.copy(focus).sub(skyPlanet.group.position).normalize();
    this.sun.shadow.intensity = THREE.MathUtils.smoothstep(upHere.dot(SUN_DIR), -0.05, 0.25);
    if (this.cheapShadows && ++this.shadowFrame % 3 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.clear();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (cockpitView) {
      this.renderer.clearDepth();
      const near = this.nearPlanet();
      const dots = this.planets.map(p => {
        const rel = tmpA.copy(p.group.position).sub(this.ship.p).applyQuaternion(tmpQ.copy(this.ship.o).invert());
        const d = Math.min(1, Math.hypot(rel.x, rel.y, rel.z) / 1200), a = Math.atan2(rel.x, rel.y);
        return { x: Math.sin(a) * d, y: -Math.cos(a) * d, color: p.spec.theme.accent, target: p.spec.index === this.target };
      });
      this.cockpit.update(this.time, this.ship.throttle, this.ship.steerX, this.ship.steerY, this.ship.v / BOOST, Boolean(near) && this.mode === "fly", dots);
      this.pilot.show("up", false, Math.floor(this.time * 4) % 8);
      this.renderer.render(this.cockpit.scene, this.cockpit.camera);
    }
  }

  // ---------------------------------------------------------------- shop & market (simulated RF, see economy.ts)
  private rocketColors(): [string, string] {
    const theme = this.planets[0].spec.theme, colors = itemById(walletOf(this.progress).equip.rocket)?.colors;
    return colors ?? [theme.roof, theme.accent];
  }
  /** Repaint the rocket by rebuilding it where it stands (only while it's parked). */
  private repaintRocket() {
    const old = this.rocket, fresh = new RocketModel(...this.rocketColors());
    fresh.group.position.copy(old.group.position); fresh.group.quaternion.copy(old.group.quaternion); fresh.group.visible = old.group.visible;
    this.scene.remove(old.group); old.group.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    this.rocket = fresh; this.scene.add(fresh.group);
    fresh.setThrust(0, 0); fresh.setHatch(1);
  }
  private wearHat() {
    const hat = hatFor(walletOf(this.progress).equip.hat);
    if (hat) this.myHat.set([{ text: hat, size: 40 }]);
    this.myHat.sprite.visible = !!hat;
  }
  private walletHud(): HudState["wallet"] {
    const w = walletOf(this.progress);
    const plots = this.current.spec.farm ? plotsFor(this.progress, this.current.spec.id) : [];
    return {
      owned: w.owned, equip: w.equip, items: w.items, simulated: payments.simulated,
      bag: Object.entries(w.bag).map(([key, n]) => ({ ...goodsOf(key), n })).sort((a, b) => b.price - a.price),
      canFertilize: this.mode === "walk" && plots.some(p => p.crop && stageOf(p, Date.now(), this.growMs) < 3),
      owner: this.current.spec.home ? null : this.current.spec.id,
    };
  }
  /** ★ items are bought at once; RF items go through checkout() after the player confirms. */
  buy(id: string) {
    const r = canBuy(this.progress, id);
    if (!r.ok) { this.host.onToast(r.why, "bad"); this.audio?.miss(); return; }
    if (r.item.currency === "rf") { void this.checkout(id); return; }
    grant(this.progress, r.item);
    this.gotItem(r.item, null);
  }
  /** The order an RF purchase would make here (for the checkout screen). */
  orderFor(id: string): Order | null {
    const item = itemById(id); if (!item || item.currency !== "rf") return null;
    const owner = this.current.spec.home ? null : this.current.spec.id;
    return { id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, item: id, price: item.price, buyer: String(this.friendId), planetOwner: owner, split: splitFor(item.price, owner), at: Date.now() };
  }
  /** Pays for an RF item through payments.ts; the item is handed over only when that succeeds. */
  async checkout(id: string): Promise<boolean> {
    const r = canBuy(this.progress, id), order = this.orderFor(id);
    if (!r.ok || !order) { this.host.onToast(r.ok ? "That isn't sold for RF." : r.why, "bad"); return false; }
    const paid = await payments.purchase(order);
    if (!this.running) return false;
    if (!paid.ok) { this.host.onToast(paid.why, "bad"); this.audio?.miss(); return false; }
    order.tx = paid.tx;
    const w = walletOf(this.progress); w.orders = [order, ...w.orders].slice(0, 50);
    grant(this.progress, r.item);
    this.gotItem(r.item, order);
    return true;
  }
  private gotItem(item: ShopItem, order: Order | null) {
    const owner = order?.planetOwner ? ` · ${order.split.planetOwner} RF to Friend #${order.planetOwner}'s owner` : "";
    this.host.onToast(`${item.icon} ${item.name} is yours!${owner}`, "good");
    if (item.currency === "rf") { this.audio?.fanfare(); this.celebrate(item.hat ?? item.icon); } else this.audio?.pickup();
    if (item.kind === "rocket" || item.kind === "hat" || item.kind === "aura") this.applyLook(item.kind);
    this.host.onProgress(this.progress); this.emitHud();
  }
  equip(id: string) {
    const item = itemById(id), w = walletOf(this.progress);
    if (!item || (item.kind !== "rocket" && item.kind !== "hat" && item.kind !== "aura") || !w.owned.includes(id)) return;
    w.equip[item.kind] = id; this.applyLook(item.kind);
    this.audio?.blip(660);
    this.host.onProgress(this.progress); this.emitHud();
  }
  private applyLook(kind: "rocket" | "hat" | "aura") {
    if (kind === "hat") { this.wearHat(); this.sendState(); return; }
    if (kind === "aura") { this.wearAura(); this.sendState(); return; }
    if (this.mode === "walk" || this.mode === "play" || this.mode === "race" || this.mode === "intro") this.repaintRocket();
    else this.pendingPaint = true;
  }
  private pendingPaint = false;
  private myAura: Aura | null = null;
  private wearAura() {
    this.myAura?.dispose(); this.myAura = null;
    const look = itemById(walletOf(this.progress).equip.aura)?.aura;
    if (look) { this.myAura = new Aura(look.color, look.sparkle); this.friend.group.add(this.myAura.group); }
  }
  sell(key: string) {
    const got = sell(this.progress, key);
    if (!got) return;
    this.host.onToast(`Sold for ${got} ★`, "good"); this.celebrate("★"); this.audio?.pickup();
    this.host.onProgress(this.progress); this.emitHud();
  }
  fertilize() {
    if (this.mode !== "walk") return;
    const plots = plotsFor(this.progress, this.current.spec.id), now = Date.now();
    const growing = plots.filter(p => p.crop && stageOf(p, now, this.growMs) < 3);
    if (!growing.length) { this.host.onToast("Nothing growing here: plant something first.", "info"); return; }
    if (!useItem(this.progress, "item:fert")) { this.host.onToast("You need Fertilizer from the shop.", "bad"); return; }
    for (const p of growing) p.plantedAt = now - this.growMs - 1;
    this.host.onToast(`🧪 ${growing.length} crop${growing.length > 1 ? "s" : ""} ripened!`, "good"); this.audio?.pickup();
    this.host.onProgress(this.progress); this.refreshCrops(true); this.emitHud();
  }
  readonly shop = SHOP;

  // ---------------------------------------------------------------- HUD & host API
  info(planet: Planet): PlanetInfo {
    const s = planet.spec;
    return { index: s.index, name: s.name, region: s.theme.region, home: s.home, host: s.home ? null : s.id, sport: s.sport, fishing: s.fishing, farm: s.farm, visited: this.visited.has(s.index) };
  }
  emitHud() {
    let prompt = this.mode === "walk" && this.promptStation ? promptFor(this.promptStation, this.current) : null;
    if (this.mode === "walk" && this.promptExtra) {
      const e = this.promptExtra, best = this.progress.raceBest?.[String(this.current.spec.id)];
      prompt = e.kind === "dig" ? { title: "Dig ⛏️", detail: "Something sparkles here" }
        : e.kind === "bug" ? { title: `Catch the ${this.extras!.bugs[e.i].kind.name} 🦋`, detail: this.extras!.bugs[e.i].kind.rarity >= 3 ? "A rare one!" : "Quick, before it flutters off" }
        : { title: "Hoverboard ring race 🛹", detail: best ? `Your best: ${best.toFixed(1)}s` : "10 rings around the planet" };
    }
    if (prompt && this.promptStation?.kind === "farm") {
      const crop = this.crop(this.current);
      if (this.promptPlot < 0) prompt = { title: "Farm", detail: `Stand on a plot to grow ${crop.name}` };
      else {
        const plot = plotsFor(this.progress, this.current.spec.id)[this.promptPlot], stage = stageOf(plot, Date.now(), this.growMs);
        prompt = stage === 0 ? { title: `Plant ${crop.name}`, detail: `Ready in ${Math.round(this.growMs / 1000)}s` }
          : stage === 3 ? { title: `Harvest ${plot.crop}`, detail: "Ready to pick" }
          : { title: `${plot.crop} growing`, detail: `${Math.ceil((this.growMs - (Date.now() - plot.plantedAt)) / 1000)}s left` };
      }
    }
    const near = this.mode === "fly" ? this.nearPlanet() : null;
    const state: HudState = {
      mode: this.mode, planet: this.mode === "walk" || this.mode === "board" || this.mode === "play" ? this.info(this.current) : null, planets: this.planets.map(p => this.info(p)), prompt,
      fly: this.mode === "fly" || this.mode === "launch" || this.mode === "land" ? { speed: Math.round(this.ship.v), boosting: this.ship.boosting, target: this.target, near: near ? near.spec.index : null, view: this.view } : null,
      countdown: this.mode === "launch" ? Math.max(0, Math.ceil(LIFTOFF - this.seq.t)) : 0,
      land: this.mode === "land" ? { phase: this.L.phase, alt: Math.max(0, Math.round(this.L.alt)), speed: Math.round(-this.L.vel * 10) / 10, thrusting: this.L.thrusting } : null,
      stars: this.progress.stars,
      perk: this.perk,
      quest: (() => { const q = this.questNow(); return q ? { n: q.n, total: q.total, text: q.quest.text } : null; })(),
      discovering: this.discovering,
      online: this.onlineHud(),
      race: this.mode === "race" ? { countdown: this.race.t < 0 ? Math.ceil(-this.race.t) : 0, time: Math.max(0, Math.round(this.race.t * 10) / 10), ring: this.race.ring, total: this.extras?.rings.length ?? 10, best: this.progress.raceBest?.[String(this.current.spec.id)] ?? null } : null,
      activity: this.mode === "play" && this.activity ? this.activity.hud() : null,
      book: this.book(),
      wallet: this.walletHud(),
    };
    const key = JSON.stringify(state);
    if (key !== this.hudKey) { this.hudKey = key; this.host.onHud(state); }
  }
  private book(): HudState["book"] {
    const p = this.progress, family = this.current.spec.family, here = new Set(fishOf(family).map(f => f.name));
    return {
      fish: FISH.map(f => ({ name: f.name, color: f.color, rarity: f.rarity, caught: p.fish[f.name]?.n ?? 0, best: p.fish[f.name]?.best ?? 0, here: here.has(f.name) })),
      crops: Object.entries(p.crops).map(([name, n]) => ({ name, n })),
      trophies: Object.entries(p.trophies).map(([id, sport]) => ({ planet: this.planets.find(q => String(q.spec.id) === id)?.spec.name ?? "#" + id, sport })),
      treasures: [...TREASURES, ...FAMILY_TREASURE].map(t => ({ name: t.name, icon: t.icon, rarity: t.rarity, n: p.treasures?.[t.name] ?? 0 })),
      bugs: BUGS.map(b => ({ name: b.name, color: b.color, rarity: b.rarity, n: p.bugs?.[b.name] ?? 0 })),
    };
  }
  useNearest() { if (this.mode === "walk" && this.promptExtra) this.useExtra(); else if (this.mode === "walk" && this.promptStation) this.use(this.promptStation); else if (this.mode === "fly") this.land(); }
  private useExtra() {
    const e = this.promptExtra, x = this.extras; if (!e || !x) return;
    if (e.kind === "race") { this.startRace(); return; }
    const p = this.progress;
    let find: Find;
    if (e.kind === "dig") {
      find = x.dig(e.i, this.current.spec.family);
      p.treasures = { ...(p.treasures ?? {}), [find.name]: (p.treasures?.[find.name] ?? 0) + 1 };
      stash(p, `treasure:${find.name}`);
      this.cam.addShake(0.3); this.audio?.rustle();
    } else {
      find = x.catchBug(e.i);
      p.bugs = { ...(p.bugs ?? {}), [find.name]: (p.bugs?.[find.name] ?? 0) + 1 };
      stash(p, `bug:${find.name}`);
      this.audio?.swish();
    }
    const stars = find.rarity * 4;
    p.stars += stars;
    this.host.onProgress(p);
    this.host.onToast(`${find.icon} ${e.kind === "dig" ? "You dug up" : "You caught"} a ${find.name}${find.rarity === 4 ? " · rare!" : ""} · +${stars} ★`, "good");
    this.audio?.pickup();
    this.celebrate(find.icon);
    this.promptExtra = null;
  }

  // ---------------------------------------------------------------- hoverboard ring race
  private startRace() {
    const x = this.extras; if (!x) return;
    this.mode = "race";
    const r = this.race;
    r.t = -3; r.ring = 0; r.speed = 0; r.hover = 0;
    // Face the first ring.
    const to = x.rings[0].pos.clone().sub(this.n.clone().multiplyScalar(this.current.R));
    const local = to.applyQuaternion(this.Q.clone().invert());
    r.heading = Math.atan2(local.x, local.z);
    x.showRings(0);
    this.board3d.visible = true;
    this.audio?.blip(440);
  }
  private endRace(finished: boolean) {
    const x = this.extras, r = this.race;
    this.mode = "walk"; this.board3d.visible = false; r.hover = 0;
    x?.showRings(-1);
    this.cam.pitch = CAMERA.startPitch; this.cam.targetDistance = CAMERA.startDistance;
    if (!finished) { this.host.onToast("Race cancelled.", "info"); return; }
    const p = this.progress, key = String(this.current.spec.id), best = p.raceBest?.[key];
    const record = best === undefined || r.t < best;
    p.raceBest = { ...(p.raceBest ?? {}), [key]: record ? Math.round(r.t * 10) / 10 : best! };
    const stars = r.t < 30 ? 20 : r.t < 45 ? 12 : 6;
    p.stars += stars; this.host.onProgress(p);
    this.host.onToast(`🛹 ${r.t.toFixed(1)}s${record ? " · new best!" : ` · best ${best!.toFixed(1)}s`} · +${stars} ★`, "good");
    this.audio?.fanfare(); this.celebrate("🏁");
  }
  private updateRace(dt: number) {
    const r = this.race, x = this.extras!, planet = this.current, R = planet.R;
    r.t += dt;
    if (this.input.take("escape") || this.input.take("q")) { this.endRace(false); return; }
    const [mx] = this.input.move();
    r.heading -= mx * 2.3 * dt;
    // The camera sits behind the board.
    this.cam.yaw += Math.atan2(Math.sin(r.heading + Math.PI - this.cam.yaw), Math.cos(r.heading + Math.PI - this.cam.yaw)) * Math.min(1, dt * 6);
    this.cam.pitch += (0.2 - this.cam.pitch) * Math.min(1, dt * 4); this.cam.targetDistance = 9;
    this.heading = r.heading; this.moving = r.t > 0;
    if (r.t > 0) {
      const boost = this.input.held("shift");
      const turbo = has(this.progress, "gear:board") ? 1.15 : 1;
      r.speed += ((boost ? 23 : 18) * turbo - r.speed) * Math.min(1, dt * 1.5);
      const dir = tmpA.set(Math.sin(r.heading), 0, Math.cos(r.heading)).applyQuaternion(this.Q);
      this.moveDir.copy(dir);
      const next = tmpB.copy(this.n).multiplyScalar(R).addScaledVector(dir, r.speed * dt).normalize();
      tmpQ.setFromUnitVectors(this.n, next); this.Q.premultiply(tmpQ); this.n.copy(next);
      this.walkClock += dt * 8;
    }
    if (this.input.take(" ") && this.hop === 0) { this.vy = 10; this.hop = 0.01; }
    if (this.hop > 0 || this.vy > 0) { this.hop += this.vy * dt; this.vy -= 22 * dt; if (this.hop <= 0) { this.hop = 0; this.vy = 0; } }
    // Hover over land and water.
    const ground = planet.surface(this.n), lift = Math.max(planet.water + 0.25 - ground, 0) + 0.8;
    r.hover += (lift - r.hover) * Math.min(1, dt * 8);
    // Rings in order.
    const me = tmpC.copy(this.n).multiplyScalar(ground + r.hover + this.hop + 1);
    const ring = x.rings[r.ring];
    if (ring && me.distanceTo(ring.pos) < 2.1) {
      r.ring++; this.audio?.blip(700 + r.ring * 60); this.cam.addShake(0.1);
      if (r.ring >= x.rings.length) { this.endRace(true); return; }
      x.showRings(r.ring);
    }
    if (r.t > 120) this.endRace(false);
  }
  jump() { this.input.press(" "); }
  setBlocked(blocked: boolean) { this.blocked = blocked; this.input.setEnabled(!blocked && !this.paused); }
  setPaused(paused: boolean) { this.paused = paused; this.input.setEnabled(!paused && !this.blocked); }
  setReducedMotion(reduced: boolean) { this.reducedMotion = reduced; }

  /** Test helpers (webdriver only): jump straight to a planet. */
  teleport(index: number) {
    const planet = this.planets[index];
    this.mode = "walk"; this.cut = null;
    this.parkRocket(planet);
    this.visited.add(index);
    const door = tmpA.copy(Z).multiplyScalar(4.2).applyQuaternion(this.ship.o).add(this.ship.p).sub(planet.group.position).normalize();
    this.arrive(planet, door, planet.baseUp.clone().multiplyScalar(planet.R), 2.45);
  }
  /** Test helper: stand at a station on this planet and use it. */
  testUse(kind: Station["kind"], plot = 0) {
    const s = this.current.stations.find(q => q.kind === kind);
    if (!s) return false;
    this.n.copy(kind === "farm" ? this.current.plots[plot].p : s.pos).normalize();
    this.Q.setFromUnitVectors(Y, this.n);
    this.promptStation = s; this.promptPlot = kind === "farm" ? plot : -1;
    this.use(s);
    return true;
  }
  activityHud() { return this.activity?.hud() ?? null; }
  lookFrom(yaw: number, pitch: number, distance: number) { this.cam.yaw = yaw; this.cam.pitch = pitch; this.cam.distance = this.cam.targetDistance = distance; }
  walkTo(n: THREE.Vector3) { this.n.copy(n).normalize(); }

  private resize() {
    const parent = this.elements.canvas.parentElement ?? this.elements.canvas, width = Math.max(1, parent.clientWidth), height = Math.max(1, parent.clientHeight);
    this.renderer.setPixelRatio(this.quality < 1 ? 1 : Math.min(window.devicePixelRatio || 1, width < 600 ? 1.75 : 2));
    this.renderer.setSize(width, height, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
    PARTICLE_SCALE.value = height * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA.fov) / 2));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.cockpit.resize(width / height, width < height);
    this.portrait = width < height;
  }
  private portrait = false;
  private setFov(fov: number) { if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); } }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.net.dispose();
    this.renderer.dispose();
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}

function promptFor(station: Station, planet: Planet): { title: string; detail: string } {
  switch (station.kind) {
    case "pad": return { title: "Board rocket", detail: "Fly to another planet" };
    case "farm": return { title: "Farm", detail: `Grow ${planet.spec.theme.crop.name}` };
    case "pond": return { title: "Fish", detail: "Cast a line off the dock" };
    case "sport": return { title: SPORTS[planet.spec.sport!].verb, detail: `vs Friend #${planet.spec.id}` };
    default: return { title: "Look", detail: "" };
  }
}

/** A crop on a plot: sprout, growing, then ripe (with a little glow so you spot it). */
function cropModel(crop: Crop, stage: number): THREE.Object3D[] {
  const b = new Blocks(), g = new Blocks();
  const spots: [number, number][] = [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]];
  for (const [x, z] of spots) {
    if (stage === 1) { b.box(0.08, 0.22, 0.08, x, 0.11, z, crop.leaf).box(0.2, 0.05, 0.1, x, 0.24, z, crop.leaf, { ry: 0.6 }); continue; }
    const h = stage === 2 ? 0.45 : 0.6;
    b.box(0.08, h, 0.08, x, h / 2, z, crop.leaf).box(0.34, 0.06, 0.14, x, h * 0.7, z, crop.leaf, { ry: 0.5 }).box(0.3, 0.06, 0.12, x, h * 0.45, z, crop.leaf, { ry: -0.7 });
    if (stage === 3) {
      if (crop.shape === "round") b.add(new THREE.IcosahedronGeometry(0.2, 0), x, 0.22, z + 0.12, crop.color);
      else if (crop.shape === "tall") b.box(0.14, 0.34, 0.14, x + 0.1, h * 0.75, z, crop.color);
      else if (crop.shape === "cap") g.add(new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), x, h, z, crop.color);
      else g.add(new THREE.OctahedronGeometry(0.2, 0), x, h + 0.12, z, crop.color);
    }
  }
  if (stage === 3) g.add(new THREE.OctahedronGeometry(0.09, 0), 0, 1.05, 0, "#ffffff");
  const out: THREE.Object3D[] = [b.mesh(litMaterial)];
  if (!g.empty) out.push(g.mesh(glowMaterial));
  return out;
}
