/**
 * The things to do on a planet, each a small one-button timing game played
 * right there in the world: fishing off the dock, penalty kicks against the
 * planet's Friend in goal, a tennis rally, and a boxing bout. Everything is
 * built in a local frame (`root`): +Z points toward the camera, so billboards
 * face it without turning.
 */
import * as THREE from "three";
import type { Clips } from "../sprites";
import type { ValleyAudio } from "../audio";
import { Blocks, FriendBillboard, Label, blobShadow, glowMaterial, litMaterial } from "./models";
import { burst, outline, particles, toon } from "./look";
import { RARITY, fishOf, mulberry32, type Fish, type PerkId, type Sport } from "./data";

export type ActivityKind = "fish" | Sport;
export type Reward = { kind: "fish"; fish: Fish; size: number } | { kind: "match"; sport: Sport; won: boolean; score: string; stars: number };
export interface ActivityHud {
  kind: ActivityKind; title: string; hint: string; action: string;
  meter: { value: number; zone: [number, number] | null; good: [number, number] | null } | null;
  score: string | null;
  health: { me: number; them: number } | null;
  flash: { text: string; good: boolean; id: number } | null;
  result: { title: string; lines: string[]; good: boolean } | null;
  sides: boolean;
  /** The action button is held (fishing) rather than tapped. */
  hold?: boolean;
  bars?: { label: string; value: number; color: string; danger: number }[];
  buttons?: { id: string; label: string; hold: boolean }[];
}
export interface ActivityContext {
  root: THREE.Group;
  me: Clips; them: Clips | null; hostId: number | null;
  family: number; floorY: number; waterY: (x: number, z: number) => number;
  audio: ValleyAudio | null;
  /** Pond centre in root space (fishing). */
  pond?: THREE.Vector3;
  /** Your Friend's family perk. */
  perk: PerkId;
  /** Golden bait: a rare fish swims in the pond this trip. Pro rod: line tension builds slower. */
  bait?: boolean;
  rod?: boolean;
  /** Is the action button/key held right now? Which way are you steering (-1 left, 1 right)? */
  held(): boolean;
  steer(): number;
  /** Movement stick / WASD: x right, y forward. */
  move(): [number, number];
  block(): boolean;
  reward(r: Reward): void;
  shake(amount: number): void;
}

const rand = mulberry32((Date.now() & 0xffffff) ^ 0x5eed);
const tmp = new THREE.Vector3();

export abstract class Activity {
  done = false;
  protected t = 0;
  protected flashText: ActivityHud["flash"] = null;
  private flashId = 0;
  constructor(protected ctx: ActivityContext) {}
  get root() { return this.ctx.root; }
  abstract readonly kind: ActivityKind;
  abstract update(dt: number): void;
  /** Camera position and look target in root space. */
  abstract view(): [THREE.Vector3, THREE.Vector3];
  abstract action(): void;
  side(_dir: number) { /* only boxing dodges */ }
  special() { /* boxing's star punch */ }
  abstract hud(): ActivityHud;
  /** "Again" after a result card. */
  abstract restart(): void;
  protected flash(text: string, good: boolean) { this.flashText = { text, good, id: ++this.flashId }; }
  protected add<T extends THREE.Object3D>(o: T) { this.ctx.root.add(o); return o; }
  dispose() {
    this.ctx.root.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && mat !== litMaterial && mat !== glowMaterial) { (mat as THREE.MeshBasicMaterial).map?.dispose(); mat.dispose(); }
    });
    this.ctx.root.clear();
    this.ctx.root.removeFromParent();
  }
}

function friend(clips: Clips, facing: "up" | "down" | "left" | "right", size = 2.4) {
  const b = new FriendBillboard(clips, size);
  b.show(facing, false, 0);
  return b;
}
const base = (kind: ActivityKind, title: string): ActivityHud => ({ kind, title, hint: "", action: "", meter: null, score: null, health: null, flash: null, result: null, sides: false });

// ---------------------------------------------------------------- fishing
export function fishModel(fish: Fish, scale = 1) {
  const b = new Blocks();
  b.box(0.7, 0.36, 0.2, 0, 0, 0, fish.color).box(0.28, 0.3, 0.16, -0.12, 0.02, 0, fish.color)
    .box(0.26, 0.34, 0.06, -0.45, 0, 0, fish.fin, { rz: 0.1 }).box(0.24, 0.14, 0.05, 0.02, 0.22, 0, fish.fin)
    .box(0.07, 0.07, 0.22, 0.24, 0.06, 0, "#111111");
  const mesh = b.mesh(litMaterial);
  mesh.scale.setScalar(scale);
  return mesh;
}

type FishPhase = "aim" | "cast" | "wait" | "nibble" | "bite" | "fight" | "caught" | "lost";
type Swimmer = { fish: Fish; size: number; mesh: THREE.Mesh; x: number; z: number; heading: number; speed: number; tx: number; tz: number; state: "wander" | "approach" | "flee"; sparkle: THREE.Mesh | null };

/** A fish-shaped shadow for fish swimming just under the surface. */
function shadowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0); s.quadraticCurveTo(0.3, 0.2, -0.2, 0.14); s.lineTo(-0.42, 0.02); s.lineTo(-0.62, 0.18); s.lineTo(-0.56, 0);
  s.lineTo(-0.62, -0.18); s.lineTo(-0.42, -0.02); s.lineTo(-0.2, -0.14); s.quadraticCurveTo(0.3, -0.2, 0.5, 0);
  const g = new THREE.ShapeGeometry(s, 8); g.rotateX(-Math.PI / 2);
  return g;
}
const SHADOW = shadowGeometry();

export class Fishing extends Activity {
  readonly kind = "fish" as const;
  private me: FriendBillboard;
  private rod: THREE.Mesh;
  private bobber: THREE.Mesh;
  private line: THREE.Line;
  private rodTip = new THREE.Vector3();
  private phase: FishPhase = "aim";
  private phaseT = 0;
  private aimAngle = 0;
  private power = 0;
  private powerDir = 1;
  private charging = false;
  private target = new THREE.Vector3();
  private reticle: THREE.Mesh;
  private swimmers: Swimmer[] = [];
  private hooked: Swimmer | null = null;
  private nibbles = 0;
  private nibbleT = 0;
  private spawnT = 3;
  private tension = 0;
  private distance = 1;
  private surge = 0;
  private surgeDir = 0;
  private nextSurge = 1.5;
  private caughtMesh: THREE.Mesh | null = null;
  private caughtSize = 0;
  private lostWhy = "";
  private bang: Label;
  private ripples: { mesh: THREE.Mesh; t: number }[] = [];
  private splash: THREE.Points;
  private center: THREE.Vector3;
  private radius: number;

  constructor(ctx: ActivityContext) {
    super(ctx);
    const y = ctx.floorY;
    this.center = ctx.pond ?? new THREE.Vector3(0, 0, -3);
    this.radius = 4.4;
    this.me = friend(ctx.me, "up");
    this.me.group.position.set(0, y, 0);
    this.add(this.me.group);
    this.rod = this.add(new Blocks().box(0.06, 0.06, 2.2, 0, 0, -1.1, "#8a5a3a").box(0.11, 0.11, 0.4, 0, 0, 0.1, "#333333").mesh(litMaterial));
    this.rod.position.set(0.55, y + 1.1, 0.1);
    this.bobber = this.add(new Blocks().add(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0, "#e8543f", { smooth: true })
      .add(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0, 0, "#ffffff", { smooth: true }).box(0.04, 0.22, 0.04, 0, 0.2, 0, "#111111").mesh(litMaterial));
    this.bobber.visible = false;
    this.line = this.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: "#ffffff" })));
    const ring = new THREE.RingGeometry(0.28, 0.4, 28); ring.rotateX(-Math.PI / 2);
    this.reticle = this.add(new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: "#ccff00", transparent: true, opacity: 0.9, depthWrite: false })));
    this.bang = new Label(0.7); this.bang.set([{ text: "!", color: "#ccff00", size: 64 }]); this.bang.sprite.visible = false;
    this.add(this.bang.sprite);
    for (let i = 0; i < 3; i++) {
      const rg = new THREE.RingGeometry(0.3, 0.38, 32); rg.rotateX(-Math.PI / 2);
      const mesh = this.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false })));
      this.ripples.push({ mesh, t: 9 });
    }
    this.splash = this.add(particles(Array.from({ length: 40 }, () => new THREE.Vector3()), { color: "#e6f6ff", size: 0.16, mode: "burst", speed: 1.4, spread: 1.3 }));
    for (let i = 0; i < 4; i++) this.addSwimmer();
    if (ctx.bait) this.addSwimmer(true);
  }
  view(): [THREE.Vector3, THREE.Vector3] {
    const y = this.ctx.floorY;
    return this.phase === "fight" ? [new THREE.Vector3(2.6, y + 3.4, 4.2), new THREE.Vector3(0, y - 0.5, -3)] : [new THREE.Vector3(1.6, y + 3.6, 4.6), new THREE.Vector3(0, y - 0.6, -3.4)];
  }
  restart() {
    this.phase = "aim"; this.phaseT = 0; this.power = 0; this.charging = false; this.bobber.visible = false;
    if (this.caughtMesh) { this.caughtMesh.removeFromParent(); this.caughtMesh = null; }
    if (this.hooked) { this.hooked.state = "flee"; this.hooked = null; }
  }

  private water(x: number, z: number) { return this.ctx.waterY(x, z); }
  private inPond(x: number, z: number, margin = 0.6) { return Math.hypot(x - this.center.x, z - this.center.z) < this.radius - margin && z < -0.6; }
  private pickFish(rare = false) {
    const all = fishOf(this.ctx.family), pool = rare ? all.filter(f => f.rarity >= 3) : all;
    const weight = (f: Fish) => [0, 55, 30, 12, 3][f.rarity];
    let total = 0; for (const f of pool) total += weight(f);
    let roll = rand() * total;
    for (const f of pool) { roll -= weight(f); if (roll <= 0) return f; }
    return pool[0];
  }
  private addSwimmer(rare = false) {
    const fish = this.pickFish(rare), size = (0.75 + fish.rarity * 0.18) * (0.8 + rand() * 0.4);
    const mesh = this.add(new THREE.Mesh(SHADOW, new THREE.MeshBasicMaterial({ color: "#0d2033", transparent: true, opacity: 0.42, depthWrite: false })));
    mesh.scale.setScalar(size);
    let x = 0, z = 0;
    for (let i = 0; i < 30; i++) { x = this.center.x + (rand() - 0.5) * this.radius * 2; z = this.center.z + (rand() - 0.5) * this.radius * 2; if (this.inPond(x, z, 1)) break; }
    let sparkle: THREE.Mesh | null = null;
    if (fish.rarity >= 3) { sparkle = this.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glowMaterial)); }
    const s: Swimmer = { fish, size, mesh, x, z, heading: rand() * Math.PI * 2, speed: 0.6 + rand() * 0.4, tx: x, tz: z, state: "wander", sparkle };
    this.swimmers.push(s);
    return s;
  }
  private ripple(x: number, z: number, big = false) {
    const r = this.ripples.reduce((a, b) => (a.t > b.t ? a : b));
    r.t = 0; r.mesh.position.set(x, this.water(x, z) + 0.03, z); r.mesh.userData.big = big;
  }
  private splashAt(x: number, z: number) { this.splash.position.set(x, this.water(x, z), z); burst(this.splash); }

  action() {
    const a = this.ctx.audio;
    if (this.phase === "wait" && this.phaseT > 0.6) { this.reelIn("You reeled in to cast again."); return; }
    if (this.phase === "nibble") { this.lose("Too soon! It swam off."); a?.miss(); return; }
    if (this.phase === "bite") {
      this.phase = "fight"; this.phaseT = 0; this.tension = 0.25; this.distance = 1; this.nextSurge = 0.8; this.surge = 0;
      a?.blip(880); this.ctx.shake(0.3); this.flash("Hooked!", true);
      return;
    }
    if (this.phase === "caught" || this.phase === "lost") this.restart();
  }
  side() { /* steering is read continuously */ }
  private reelIn(msg: string) { this.phase = "aim"; this.bobber.visible = false; this.flash(msg, false); if (this.hooked) { this.hooked.state = "flee"; this.hooked = null; } }
  private lose(why: string) {
    this.phase = "lost"; this.phaseT = 0; this.lostWhy = why; this.flash(why, false);
    if (this.hooked) { this.hooked.state = "flee"; this.hooked.tx = this.center.x + (rand() - 0.5) * 6; this.hooked.tz = this.center.z - 4; this.hooked = null; }
    this.bobber.visible = false;
  }

  update(dt: number) {
    this.t += dt; this.phaseT += dt;
    const held = this.ctx.held(), steer = this.ctx.steer(), a = this.ctx.audio, y = this.ctx.floorY;
    // ---- aim and charge ----
    if (this.phase === "aim") {
      this.aimAngle = THREE.MathUtils.clamp(this.aimAngle - steer * dt * 1.2, -0.75, 0.75);
      if (held) {
        if (!this.charging) { this.charging = true; this.power = 0; this.powerDir = 1; }
        this.power += this.powerDir * dt * 0.85;
        if (this.power > 1) { this.power = 1; this.powerDir = -1; } else if (this.power < 0) { this.power = 0; this.powerDir = 1; }
      } else if (this.charging) {
        this.charging = false;
        this.phase = "cast"; this.phaseT = 0; a?.swish();
      }
      const dist = 1.6 + (this.charging ? this.power : 0.5) * 4.6;
      this.target.set(Math.sin(this.aimAngle) * dist, 0, -Math.cos(this.aimAngle) * dist);
      if (!this.inPond(this.target.x, this.target.z, 0.3)) {
        // Keep the landing spot on the water.
        const dx = this.target.x - this.center.x, dz = this.target.z - this.center.z, d = Math.hypot(dx, dz);
        if (d > this.radius - 0.4) { this.target.x = this.center.x + dx / d * (this.radius - 0.4); this.target.z = this.center.z + dz / d * (this.radius - 0.4); }
      }
      this.target.y = this.water(this.target.x, this.target.z);
      this.reticle.visible = true;
      this.reticle.position.set(this.target.x, this.target.y + 0.04, this.target.z);
      this.reticle.scale.setScalar(1 + Math.sin(this.t * 6) * 0.08);
    } else this.reticle.visible = false;
    if (this.phase === "cast") {
      const k = Math.min(1, this.phaseT / 0.65);
      this.bobber.visible = true;
      this.bobber.position.lerpVectors(this.rodTip, this.target, k);
      this.bobber.position.y += Math.sin(k * Math.PI) * 1.8;
      if (k >= 1) { this.phase = "wait"; this.phaseT = 0; a?.splash(); this.ripple(this.target.x, this.target.z); this.splashAt(this.target.x, this.target.z); }
    }
    // ---- the fish in the pond ----
    for (const s of this.swimmers) {
      if (s === this.hooked && this.phase === "fight") continue;
      if (s.state === "wander" && Math.hypot(s.tx - s.x, s.tz - s.z) < 0.4) {
        for (let i = 0; i < 12; i++) { s.tx = this.center.x + (rand() - 0.5) * this.radius * 2; s.tz = this.center.z + (rand() - 0.5) * this.radius * 2; if (this.inPond(s.tx, s.tz, 0.9)) break; }
      }
      if (s.state === "approach") { s.tx = this.target.x - Math.sin(s.heading) * 0.45; s.tz = this.target.z - Math.cos(s.heading) * 0.45; }
      const want = Math.atan2(s.tx - s.x, s.tz - s.z);
      s.heading += Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)) * Math.min(1, dt * 2.5);
      const close = Math.hypot(s.tx - s.x, s.tz - s.z);
      const speed = s.state === "flee" ? 2.4 : s.state === "approach" ? Math.min(0.9, close) : s.speed * 0.6;
      s.x += Math.sin(s.heading) * speed * dt; s.z += Math.cos(s.heading) * speed * dt;
      if (s.state === "flee" && close < 0.5) s.state = "wander";
    }
    // A fish notices the bobber, comes over and nibbles a few times before it bites.
    if (this.phase === "wait") {
      const near = this.swimmers.filter(s => s.state === "wander" && Math.hypot(s.x - this.target.x, s.z - this.target.z) < 3.2);
      if (!this.hooked && near.length && this.phaseT > 0.8) { this.hooked = near[0]; this.hooked.state = "approach"; }
      if (!this.hooked) { this.spawnT -= dt; if (this.spawnT < 0) { this.spawnT = this.ctx.perk === "glow" ? 1.4 : 3; const s = this.addSwimmer(); s.state = "approach"; this.hooked = s; } }
      if (this.hooked && Math.hypot(this.hooked.x - this.target.x, this.hooked.z - this.target.z) < 0.6) {
        this.phase = "nibble"; this.phaseT = 0; this.nibbles = 1 + Math.floor(rand() * 3); this.nibbleT = 0.4;
      }
      this.bobber.position.y = this.target.y + Math.sin(this.t * 3) * 0.03;
    } else if (this.phase === "nibble") {
      this.nibbleT -= dt;
      const dip = this.nibbleT > 0 && this.nibbleT < 0.18 ? -0.08 : 0;
      this.bobber.position.y = this.target.y + dip + Math.sin(this.t * 3) * 0.03;
      if (this.nibbleT <= 0) {
        this.nibbles--; this.ripple(this.target.x, this.target.z); a?.pop();
        if (this.nibbles <= 0) { this.phase = "bite"; this.phaseT = 0; a?.bite(); a?.splash(); this.splashAt(this.target.x, this.target.z); this.ripple(this.target.x, this.target.z, true); }
        else this.nibbleT = 0.6 + rand() * 0.7;
      }
    } else if (this.phase === "bite") {
      this.bobber.position.y = this.target.y - 0.3 + Math.sin(this.t * 30) * 0.05;
      if (this.phaseT > (this.ctx.perk === "nightOwl" ? 1.6 : 0.9)) { this.lose("Too slow! It stole the bait."); a?.miss(); }
    }
    // ---- the fight: hold to reel, ease off when the line is tight, pull against its runs ----
    if (this.phase === "fight" && this.hooked) {
      const f = this.hooked.fish, strength = 0.6 + f.rarity * 0.22;
      this.nextSurge -= dt;
      if (this.surge <= 0 && this.nextSurge <= 0) { this.surge = 0.7 + rand() * 0.6 * strength; this.surgeDir = rand() < 0.5 ? -1 : 1; this.nextSurge = 1.4 + rand() * 2.2 / strength; a?.splash(); this.splashAt(this.hooked.x, this.hooked.z); }
      const surging = this.surge > 0;
      if (surging) this.surge -= dt;
      const against = surging && steer === -this.surgeDir;
      if (held) {
        this.tension += dt * (surging ? (against ? 0.55 : 1.35) * strength : 0.42) * (this.ctx.rod ? 0.7 : 1);
        this.distance -= dt * (surging ? 0.03 : 0.2 / (0.7 + f.rarity * 0.15));
      } else {
        this.tension -= dt * 0.75;
        this.distance += dt * (surging ? 0.14 * strength : 0.03);
      }
      if (against) this.distance -= dt * 0.06;
      this.tension = Math.max(0, this.tension);
      // Where the fish is: between the dock and the far side, pulled sideways on a run.
      const d = THREE.MathUtils.clamp(this.distance, 0, 1.3);
      const sway = Math.sin(this.t * 1.7) * 0.8 + (surging ? this.surgeDir * 1.4 : 0);
      this.hooked.tx = sway; this.hooked.tz = -0.9 - d * 4.3;
      const s = this.hooked;
      s.x += (s.tx - s.x) * Math.min(1, dt * 2.2); s.z += (s.tz - s.z) * Math.min(1, dt * 2.2);
      s.heading = Math.atan2(-s.x * 0.2 + (surging ? this.surgeDir : 0), -1);
      this.bobber.visible = true;
      this.bobber.position.set(s.x, this.water(s.x, s.z) - 0.05 + (surging ? Math.sin(this.t * 40) * 0.06 : 0), s.z);
      if (surging && Math.floor(this.t * 6) !== Math.floor((this.t - dt) * 6)) this.ripple(s.x, s.z);
      if (this.tension >= 1) { this.lose("Snap! The line broke."); a?.bonk(); this.ctx.shake(0.4); }
      else if (this.distance > 1.3) { this.lose("It swam away…"); a?.miss(); }
      else if (this.distance <= 0) this.land();
    }
    // ---- caught: it leaps out of the water to you ----
    if (this.phase === "caught" && this.caughtMesh) {
      const k = Math.min(1, this.phaseT / 0.9), from = this.target;
      this.caughtMesh.position.lerpVectors(from, tmp.set(0.2, y + 2.9, -0.2), k);
      this.caughtMesh.position.y += Math.sin(k * Math.PI) * 2.2;
      this.caughtMesh.rotation.set(0, this.t * 2, Math.sin(this.t * 14) * 0.5 * (1 - k * 0.7));
    }
    // ---- visuals ----
    for (const s of this.swimmers) {
      s.mesh.visible = !(s === this.hooked && this.phase === "caught");
      s.mesh.position.set(s.x, this.water(s.x, s.z) - 0.18, s.z);
      s.mesh.rotation.y = s.heading - Math.PI / 2 + Math.sin(this.t * 8 + s.size * 5) * 0.12;
      if (s.sparkle) { s.sparkle.visible = s.mesh.visible; s.sparkle.position.set(s.x, s.mesh.position.y + 0.45 + Math.sin(this.t * 4) * 0.08, s.z); s.sparkle.rotation.y = this.t * 3; }
    }
    for (const r of this.ripples) {
      r.t += dt;
      const m = r.mesh.material as THREE.MeshBasicMaterial, k = r.t / (r.mesh.userData.big ? 1.2 : 0.9);
      m.opacity = k < 1 ? (1 - k) * 0.8 : 0;
      r.mesh.scale.setScalar(1 + k * (r.mesh.userData.big ? 5 : 3));
    }
    const bend = this.phase === "fight" ? this.tension * 0.5 : this.phase === "bite" ? 0.3 : 0;
    this.rod.rotation.x = 0.55 - bend;
    this.rodTip.set(0, 0, -2.2).applyEuler(this.rod.rotation).add(this.rod.position);
    this.bang.sprite.visible = this.phase === "bite";
    this.bang.sprite.position.copy(this.bobber.position).add(tmp.set(0, 0.6, 0));
    const tip = this.bobber.visible ? this.bobber.position : this.rodTip;
    const pos = this.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, this.rodTip.x, this.rodTip.y, this.rodTip.z); pos.setXYZ(1, tip.x, tip.y + 0.1, tip.z); pos.needsUpdate = true;
    (this.line.material as THREE.LineBasicMaterial).color.setStyle(this.phase === "fight" ? (this.tension > 0.8 ? "#ff5a3c" : this.tension > 0.55 ? "#ffd23c" : "#ffffff") : "#ffffff");
    this.me.show("up", this.phase === "fight" && held, Math.floor(this.t * (held ? 12 : 4)) % 8);
  }
  private land() {
    const s = this.hooked!, fish = s.fish;
    this.phase = "caught"; this.phaseT = 0;
    this.caughtSize = Math.round((18 + fish.rarity * 9) * s.size * fish.size);
    this.target.set(s.x, this.water(s.x, s.z), s.z);
    this.caughtMesh = this.add(fishModel(fish, 1.3 * fish.size));
    this.splashAt(s.x, s.z); this.ripple(s.x, s.z, true);
    s.mesh.removeFromParent(); s.sparkle?.removeFromParent();
    this.swimmers = this.swimmers.filter(q => q !== s);
    this.hooked = null;
    this.addSwimmer();
    this.ctx.audio?.catchIt(); this.ctx.shake(0.3);
    this.flash(`${fish.name}!`, true);
    this.bobber.visible = false;
    this.ctx.reward({ kind: "fish", fish, size: this.caughtSize });
    this.lastFish = fish;
  }
  private lastFish: Fish | null = null;

  hud(): ActivityHud {
    const h = base("fish", "Fishing");
    h.flash = this.flashText; h.hold = true;
    switch (this.phase) {
      case "aim":
        h.hint = this.charging ? "Let go to cast! Farther out = bigger fish" : "◀ ▶ aim · hold to charge your cast";
        h.action = this.charging ? "Release!" : "Hold to cast"; h.sides = true;
        if (this.charging) h.meter = { value: this.power, zone: null, good: [0.7, 1] };
        break;
      case "cast": h.hint = "Plop!"; h.action = "…"; break;
      case "wait": h.hint = this.hooked ? "A fish is coming… wait for it!" : "Waiting for a fish… (tap to reel in)"; h.action = "Reel in"; break;
      case "nibble": h.hint = "Nibble… not yet!"; h.action = "Wait…"; break;
      case "bite": h.hint = "BITE! Tap now!"; h.action = "HOOK!"; break;
      case "fight": {
        const run = this.surge > 0;
        h.hint = run ? `It's running! Ease off, and pull ${this.surgeDir > 0 ? "◀ left" : "right ▶"}` : "Hold to reel it in · let go before the line turns red";
        h.action = "Hold to reel"; h.sides = true;
        h.bars = [
          { label: "Line tension", value: Math.min(1, this.tension), color: this.tension > 0.8 ? "#ff5a3c" : this.tension > 0.55 ? "#f2ce68" : "#b9d984", danger: 0.8 },
          { label: "Fish distance", value: THREE.MathUtils.clamp(this.distance / 1.3, 0, 1), color: "#7db4db", danger: 0.92 },
        ];
        break;
      }
      case "caught": {
        const f = this.lastFish!;
        h.result = { title: `You caught a ${f.name}!`, lines: [`${RARITY[f.rarity]} · ${this.caughtSize} cm`, `+${f.rarity * 5} ★`], good: true };
        h.action = "Fish again"; break;
      }
      case "lost": h.result = { title: "It got away", lines: [this.lostWhy, "Hold to reel, ease off on its runs, and pull the other way."], good: false }; h.action = "Try again"; break;
    }
    return h;
  }
}

// ---------------------------------------------------------------- shared bits for the sports
const G = -9.8;
function glove(color: string) {
  const b = new Blocks().add(new THREE.SphereGeometry(0.3, 16, 12), 0, 0, 0, color, { sx: 1, sy: 0.95, sz: 1.15, smooth: true })
    .add(new THREE.SphereGeometry(0.13, 10, 8), 0.2, 0.05, 0.08, color, { smooth: true })
    .add(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 14), 0, 0, 0.32, "#f4f1ea", { rx: Math.PI / 2, smooth: true });
  const m = b.mesh(litMaterial);
  const g = new THREE.Group(); g.add(m, outline(m, 0.04));
  return g;
}
function racket() {
  const b = new Blocks().add(new THREE.TorusGeometry(0.28, 0.035, 8, 20), 0, 0.62, 0, "#e8543f", { smooth: true })
    .add(new THREE.CircleGeometry(0.26, 16), 0, 0.62, 0, "#f7f3e8").box(0.06, 0.4, 0.06, 0, 0.2, 0, "#333333");
  const m = b.mesh(litMaterial);
  const g = new THREE.Group(); g.add(m);
  return g;
}
function ballMesh(color: string, r: number) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), toon({ color }));
  const g = new THREE.Group(); g.add(m, outline(m, 0.03));
  return g;
}
/** Where a ball on (p, v) first comes down to height y (or null). */
function landing(p: THREE.Vector3, v: THREE.Vector3, y: number) {
  const a = 0.5 * G, b = v.y, c = p.y - y, disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 ? { t, x: p.x + v.x * t, z: p.z + v.z * t } : null;
}
/** Velocity that takes a ball from p to (x, y, z) in T seconds, raised until it clears the net. */
function shot(p: THREE.Vector3, x: number, y: number, z: number, T: number, net: number) {
  for (let i = 0; i < 8; i++, T += 0.08) {
    const v = new THREE.Vector3((x - p.x) / T, (y - p.y - 0.5 * G * T * T) / T, (z - p.z) / T);
    const tn = -p.z / v.z;
    if (tn <= 0 || tn >= T || p.y + v.y * tn + 0.5 * G * tn * tn > net + 0.25) return v;
  }
  return new THREE.Vector3((x - p.x) / T, (y - p.y - 0.5 * G * T * T) / T, (z - p.z) / T);
}

// ---------------------------------------------------------------- penalty shootout (you shoot, then you save)
type PenPhase = "aim" | "flight" | "runup" | "incoming" | "after" | "over";
export class Penalty extends Activity {
  readonly kind = "goal" as const;
  private shootKicker: FriendBillboard; private shootKeeper: FriendBillboard;
  private saveKicker: FriendBillboard; private saveKeeper: FriendBillboard;
  private get kicker() { return this.turn === "shoot" ? this.shootKicker : this.saveKicker; }
  private get keeper() { return this.turn === "shoot" ? this.shootKeeper : this.saveKeeper; }
  private ball: THREE.Group;
  private ballShadow: THREE.Mesh;
  private reticle: THREE.Mesh;
  private phase: PenPhase = "aim";
  private phaseT = 0;
  private turn: "shoot" | "save" = "shoot";
  private aim = new THREE.Vector2(0, 1.1);
  private power = 0;
  private charging = false;
  private from = new THREE.Vector3(0, 0.28, 1.8);
  private to = new THREE.Vector3();
  private curve = 0;
  private flight = 0.7;
  private keeperX = 0; private keeperY = 0; private diveDir = 0; private diveT = -1;
  private aiPlan = { react: 0.2, guess: 0 };
  private myGoals: boolean[] = [];
  private theirGoals: boolean[] = [];
  private outcome = "";
  private kickTarget = new THREE.Vector2();
  private hintSide = 0;
  constructor(ctx: ActivityContext) {
    super(ctx);
    const them = ctx.them ?? ctx.me;
    this.shootKicker = friend(ctx.me, "up", 2.1); this.shootKeeper = friend(them, "down", 2.3);
    // In goal the camera looks out from behind the net, so these two face the other way.
    this.saveKicker = friend(them, "down", 2.3); this.saveKeeper = friend(ctx.me, "up", 2.3);
    this.saveKicker.group.rotation.y = this.saveKeeper.group.rotation.y = Math.PI;
    for (const b of [this.shootKicker, this.shootKeeper, this.saveKicker, this.saveKeeper]) this.add(b.group);
    const shadow = blobShadow(0.9); shadow.position.set(0, 0.06, -4.3); this.add(shadow); shadow.name = "kshadow";
    this.ball = this.add(ballMesh("#ffffff", 0.24));
    const dots = new Blocks();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; dots.add(new THREE.CircleGeometry(0.07, 5), Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.11, "#111111"); }
    this.ball.children[0].add(dots.mesh(litMaterial));
    this.ballShadow = this.add(blobShadow(0.22));
    const ring = new THREE.RingGeometry(0.24, 0.36, 24);
    this.reticle = this.add(new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: "#ccff00", side: THREE.DoubleSide, depthTest: false, transparent: true })));
    this.reticle.renderOrder = 6;
    this.setupShoot();
  }
  view(): [THREE.Vector3, THREE.Vector3] {
    return this.turn === "shoot" ? [new THREE.Vector3(1.2, 2.5, 8.4), new THREE.Vector3(0.1, 1.1, -4.6)] : [new THREE.Vector3(0.3, 3.5, -6.9), new THREE.Vector3(0, 0.7, 2.6)];
  }
  restart() { this.myGoals = []; this.theirGoals = []; this.setupShoot(); }
  private setupShoot() {
    this.turn = "shoot"; this.phase = "aim"; this.phaseT = 0; this.charging = false; this.power = 0;
    this.aim.set(0, 1.1); this.ball.position.copy(this.from); this.keeperX = 0; this.keeperY = 0; this.diveT = -1;
    this.showRoles();
  }
  private showRoles() {
    const shoot = this.turn === "shoot";
    this.shootKicker.group.visible = this.shootKeeper.group.visible = shoot;
    this.saveKicker.group.visible = this.saveKeeper.group.visible = !shoot;
  }
  private setupSave() {
    this.turn = "save"; this.phase = "runup"; this.phaseT = 0; this.ball.position.copy(this.from); this.keeperX = 0; this.keeperY = 0; this.diveT = -1;
    // Where they'll shoot, and a run-up that gives it away (most of the time).
    const corner = rand() < 0.5 ? -1 : 1;
    this.kickTarget.set(corner * (0.9 + rand() * 1.4), 0.4 + rand() * 1.5);
    if (rand() < 0.18) this.kickTarget.x = (rand() - 0.5) * 0.8;
    this.hintSide = rand() < 0.72 ? Math.sign(this.kickTarget.x) : -Math.sign(this.kickTarget.x);
    this.showRoles();
    this.flash("Your turn in goal!", true);
  }
  action() {
    if (this.phase === "over") { this.restart(); return; }
    if (this.turn === "save" && (this.phase === "runup" || this.phase === "incoming") && this.diveT < 0) {
      this.diveDir = this.ctx.steer(); this.diveT = 0; this.ctx.audio?.swish();
    }
  }
  private kick() {
    const p = this.power;
    this.phase = "flight"; this.phaseT = 0; this.reticle.visible = false;
    let x = this.aim.x + (rand() - 0.5) * 0.25, y = this.aim.y;
    if (p > 0.92) y += 1.1 + rand() * 0.8;
    if (p < 0.35) { x *= 0.7; y = Math.max(0.3, y * 0.6); }
    this.to.set(x, Math.max(0.3, y), -4.85);
    this.curve = this.ctx.steer() * 0.9;
    this.flight = 0.95 - p * 0.45;
    // Keeper AI: sometimes guesses early, otherwise reacts to the ball.
    const poker = this.ctx.perk === "pokerFace";
    this.aiPlan = { react: 0.14 + rand() * 0.16 + (poker ? 0.12 : 0), guess: rand() < (poker ? 0.15 : 0.35) ? (rand() < 0.5 ? -1 : 1) : 0 };
    this.ctx.audio?.swish();
  }
  update(dt: number) {
    this.t += dt; this.phaseT += dt;
    const held = this.ctx.held(), [mx, my] = this.ctx.move(), a = this.ctx.audio;
    // ---------------- you shoot
    if (this.turn === "shoot") {
      if (this.phase === "aim") {
        this.aim.x = THREE.MathUtils.clamp(this.aim.x + mx * dt * 2.6, -2.9, 2.9);
        this.aim.y = THREE.MathUtils.clamp(this.aim.y + my * dt * 2, 0.3, 2.6);
        if (held) { if (!this.charging) { this.charging = true; this.power = 0; } this.power = Math.min(1.1, this.power + dt * 1.05); }
        else if (this.charging) { this.charging = false; this.kick(); }
        this.reticle.visible = true; this.reticle.position.set(this.aim.x, this.aim.y, -4.6);
        this.reticle.scale.setScalar(1 + Math.sin(this.t * 7) * 0.1);
        this.kicker.group.position.set(-1.7 + (this.charging ? this.power * 0.5 : 0), 0, 1.9 + (this.charging ? this.power * 0.4 : 0));
      } else if (this.phase === "flight") {
        const k = Math.min(1, this.phaseT / this.flight);
        this.kicker.group.position.set(-1.2 + k * 0.6, 0, 2.2 - k * 0.3);
        this.ball.position.lerpVectors(this.from, this.to, k);
        this.ball.position.y += Math.sin(k * Math.PI) * 0.5;
        this.ball.position.x += Math.sin(k * Math.PI) * this.curve;
        this.ball.rotation.x -= dt * 20;
        // Keeper dives after its reaction time toward where the ball is heading (or its early guess).
        const react = this.phaseT - this.aiPlan.react;
        const aimX = this.aiPlan.guess ? this.aiPlan.guess * 1.8 : this.to.x;
        if (react > 0 || this.aiPlan.guess) {
          const reach = Math.min(1, Math.max(0, this.aiPlan.guess ? this.phaseT : react) / 0.4);
          this.keeperX += (THREE.MathUtils.clamp(aimX, -2.3, 2.3) - this.keeperX) * Math.min(1, dt * 7);
          this.keeperY = Math.min(1.1, Math.max(0, this.to.y - 0.9)) * reach;
        }
        if (k >= 1) this.resolveShot();
      } else if (this.phase === "after") {
        if (this.outcome === "save") { this.ball.position.z += dt * 5; this.ball.position.y = Math.max(0.28, this.ball.position.y - dt * 3); }
        if (this.phaseT > 1.3) { if (this.finished()) this.finish(); else this.setupSave(); }
      }
    } else {
      // ---------------- you save
      if (this.phase === "runup") {
        const k = Math.min(1, this.phaseT / 1.1);
        this.kicker.group.position.set(this.hintSide * -1.6 * (1 - k) + this.hintSide * -0.4, 0, 4.4 - k * 2.2);
        if (k >= 1) {
          this.phase = "incoming"; this.phaseT = 0; this.flight = 0.62 + rand() * 0.15;
          this.to.set(this.kickTarget.x, this.kickTarget.y, -4.85); this.curve = 0; a?.swish();
        }
      } else if (this.phase === "incoming") {
        const k = Math.min(1, this.phaseT / this.flight);
        this.ball.position.lerpVectors(this.from, this.to, k);
        this.ball.position.y += Math.sin(k * Math.PI) * 0.4;
        this.ball.rotation.x += dt * 20;
        if (k >= 1) this.resolveSave();
      } else if (this.phase === "after") {
        if (this.outcome === "save") { this.ball.position.z += dt * 5; this.ball.position.y = Math.max(0.28, this.ball.position.y - dt * 3); }
        if (this.phaseT > 1.3) { if (this.finished()) this.finish(); else this.setupShoot(); }
      }
      // You move along the line and dive.
      if (this.phase !== "after") {
        if (this.diveT < 0) this.keeperX = THREE.MathUtils.clamp(this.keeperX + mx * dt * 4.5, -2.3, 2.3);
        else { this.diveT += dt; const d = Math.min(1, this.diveT / 0.35); this.keeperX = THREE.MathUtils.clamp(this.keeperX + this.diveDir * dt * 5.2 * (1 - d * 0.5), -2.6, 2.6); this.keeperY = this.diveDir ? Math.sin(d * Math.PI) * 0.6 : Math.sin(d * Math.PI) * 1.1; }
      }
    }
    // Keeper pose.
    const diving = this.turn === "shoot" ? Math.abs(this.keeperX) > 0.4 && this.phase !== "aim" : this.diveT >= 0 && this.diveDir !== 0;
    this.keeper.group.position.set(this.keeperX, this.keeperY, -4.3);
    this.keeper.mesh.rotation.z = diving ? -Math.sign(this.keeperX || this.diveDir) * 1.1 * (this.turn === "save" ? -1 : 1) : 0;
    const shadow = this.ctx.root.getObjectByName("kshadow"); if (shadow) shadow.position.set(this.keeperX, 0.06, -4.3);
    this.ballShadow.position.set(this.ball.position.x, 0.06, this.ball.position.z);
    this.reticle.visible = this.turn === "shoot" && this.phase === "aim";
    this.kicker.show(this.turn === "shoot" ? "up" : "down", this.phase === "runup" || (this.phase === "flight" && this.phaseT < 0.2), Math.floor(this.t * 11) % 8);
    if (!diving) this.keeper.show(this.turn === "shoot" ? "down" : "up", false, Math.floor(this.t * 5) % 8);
  }
  private resolveShot() {
    const x = this.to.x, y = this.to.y, a = this.ctx.audio;
    this.phase = "after"; this.phaseT = 0;
    const reachX = Math.abs(this.keeperX - x) < 0.95, reachY = y < 1.2 + this.keeperY + 0.9;
    if (y > 2.3 || Math.abs(x) > 2.55) { this.outcome = "over"; this.flash(y > 2.3 ? "Over the bar!" : "Wide!", false); a?.miss(); this.myGoals.push(false); }
    else if (reachX && reachY) { this.outcome = "save"; this.flash("SAVED!", false); a?.bonk(); this.myGoals.push(false); }
    else { this.outcome = "goal"; this.flash("GOAL!", true); a?.fanfare(); this.ctx.shake(0.4); this.myGoals.push(true); }
  }
  private resolveSave() {
    const x = this.to.x, y = this.to.y, a = this.ctx.audio;
    this.phase = "after"; this.phaseT = 0;
    const cover = this.diveT >= 0 && this.diveDir !== 0 ? 1.25 : 0.8;
    const high = y < 1.3 + this.keeperY + (this.diveT >= 0 ? 0.8 : 0.5);
    if (Math.abs(this.keeperX - x) < cover && high) { this.outcome = "save"; this.flash("WHAT A SAVE!", true); a?.fanfare(); this.ctx.shake(0.35); this.theirGoals.push(false); }
    else { this.outcome = "goal"; this.flash("They score…", false); a?.miss(); this.theirGoals.push(true); }
  }
  private finished() {
    const m = this.myGoals.filter(Boolean).length, t = this.theirGoals.filter(Boolean).length, n = this.myGoals.length, k = this.theirGoals.length;
    if (n !== k) return false;
    if (n < 5) return m > t + (5 - n) || t > m + (5 - n);
    return m !== t || n >= 8;
  }
  private finish() {
    this.phase = "over";
    const m = this.myGoals.filter(Boolean).length, t = this.theirGoals.filter(Boolean).length, won = m > t;
    this.ctx.reward({ kind: "match", sport: "goal", won, score: `${m}–${t}`, stars: m * 3 + this.theirGoals.filter(g => !g).length * 2 + (won ? 10 : 0) });
  }
  hud(): ActivityHud {
    const h = base("goal", "Penalty shootout");
    const m = this.myGoals.filter(Boolean).length, t = this.theirGoals.filter(Boolean).length;
    h.score = `You ${this.myGoals.map(g => (g ? "⚽" : "✕")).join("")} ${m} – ${t} ${this.theirGoals.map(g => (g ? "⚽" : "✕")).join("")} Friend #${this.ctx.hostId}`;
    h.flash = this.flashText;
    if (this.phase === "over") {
      const won = m > t;
      h.result = { title: won ? "You win the shootout!" : m === t ? "A draw!" : "They win the shootout", lines: [`${m} – ${t}`, won ? "Trophy for your shelf" : "Aim for the corners and don't overhit"], good: won };
      h.action = "Play again"; return h;
    }
    if (this.turn === "shoot") {
      h.hint = this.phase === "aim" ? (this.charging ? "Let go to shoot! (◀ ▶ as you let go = curve)" : "WASD / stick to aim · hold to power up, don't overdo it") : "";
      h.action = this.phase === "aim" ? (this.charging ? "Release!" : "Hold to shoot") : "…"; h.hold = true;
      if (this.charging) h.meter = { value: Math.min(1, this.power), zone: [0.55, 0.92], good: null };
    } else {
      h.hint = this.phase === "runup" ? "Watch the run-up… A / D to move, DIVE as they kick!" : this.phase === "incoming" ? "DIVE!" : "";
      h.action = "Dive"; h.sides = true;
    }
    return h;
  }
}

// ---------------------------------------------------------------- tennis (real rallies)
type Side = "me" | "them";
export class Tennis extends Activity {
  readonly kind = "tennis" as const;
  private me: FriendBillboard;
  private them: FriendBillboard;
  private myRacket: THREE.Group;
  private theirRacket: THREE.Group;
  private ball: THREE.Group;
  private ballShadow: THREE.Mesh;
  private trail: THREE.Mesh[] = [];
  private meP = new THREE.Vector2(0, 5.4);
  private themP = new THREE.Vector2(0, -5.4);
  private p = new THREE.Vector3();
  private v = new THREE.Vector3();
  private live = false;
  private hitter: Side | null = null;
  private bounces = 0;
  private phase: "serve" | "toss" | "rally" | "point" | "over" = "serve";
  private phaseT = 0;
  private server: Side = "me";
  private swingT = 0;
  private theirSwingT = 0;
  private points = [0, 0];
  private games = [0, 0];
  private call = "";
  private aiTarget = new THREE.Vector2(0, -5.4);
  private aiWill = true;
  private lastQuality = 0;
  private moving = false;
  constructor(ctx: ActivityContext) {
    super(ctx);
    this.me = friend(ctx.me, "up"); this.add(this.me.group);
    this.them = friend(ctx.them ?? ctx.me, "down"); this.add(this.them.group);
    this.myRacket = racket(); this.me.group.add(this.myRacket); this.myRacket.position.set(0.7, 0.55, 0.1);
    this.theirRacket = racket(); this.them.group.add(this.theirRacket); this.theirRacket.position.set(-0.7, 0.55, 0.1);
    this.ball = this.add(ballMesh("#d9ff3a", 0.14));
    this.ballShadow = this.add(blobShadow(0.18)); this.ballShadow.position.y = 0.12;
    for (let i = 0; i < 5; i++) this.trail.push(this.add(new THREE.Mesh(new THREE.SphereGeometry(0.12 - i * 0.018, 8, 6), new THREE.MeshBasicMaterial({ color: "#f4ffc2", transparent: true, opacity: 0.35 - i * 0.06, depthWrite: false }))));
    this.newPoint();
  }
  view(): [THREE.Vector3, THREE.Vector3] { return [new THREE.Vector3(this.meP.x * 0.45, 5.3, 12.6), new THREE.Vector3(this.meP.x * 0.3, 0.3, -1.4)]; }
  restart() { this.points = [0, 0]; this.games = [0, 0]; this.server = "me"; this.newPoint(); }
  private newPoint() {
    this.phase = "serve"; this.phaseT = 0; this.live = false; this.hitter = null; this.bounces = 0;
    this.meP.set(this.server === "me" ? 0.9 : -0.9, 5.6); this.themP.set(this.server === "them" ? -0.9 : 0.9, -5.6);
    this.placeServe();
  }
  private placeServe() {
    const s = this.server === "me" ? this.meP : this.themP;
    this.p.set(s.x + (this.server === "me" ? 0.5 : -0.5), 1.1, s.y + (this.server === "me" ? -0.3 : 0.3));
  }
  action() {
    if (this.phase === "over") { this.restart(); return; }
    if (this.phase === "serve" && this.server === "me") { this.phase = "toss"; this.phaseT = 0; this.v.set(0, 5.2, 0); this.ctx.audio?.pop(); return; }
    if (this.swingT <= 0) { this.swingT = 0.3; this.ctx.audio?.swish(); }
  }
  private racketPoint(side: Side) {
    const s = side === "me" ? this.meP : this.themP;
    return new THREE.Vector3(s.x + (side === "me" ? 0.55 : -0.55), 1, s.y + (side === "me" ? -0.25 : 0.25));
  }
  private hit(by: Side, quality: number) {
    const a = this.ctx.audio, toward = by === "me" ? -1 : 1;
    this.hitter = by; this.bounces = 0; this.live = true;
    let tx: number, tz: number, T: number;
    if (by === "me") {
      const steer = this.ctx.steer();
      tx = THREE.MathUtils.clamp(steer * 2.4 + (rand() - 0.5) * 0.6, -2.8, 2.8);
      tz = toward * (3.4 + quality * 1.6 + rand() * 0.4);
      T = quality > 0.75 ? 0.68 : 0.9;
      if (quality > 0.75) { this.flash("Perfect!", true); this.ctx.shake(0.2); }
      a?.blip(quality > 0.75 ? 990 : 640);
      this.lastQuality = quality;
      // Will they get it back? Faster, wider shots are harder.
      const run = Math.abs(tx - this.themP.x);
      this.aiWill = rand() < 0.92 - (quality > 0.75 ? 0.28 : 0) - Math.max(0, run - 2.2) * 0.2 - (this.ctx.perk === "wonky" ? 0.12 : 0);
    } else {
      tx = THREE.MathUtils.clamp((rand() - 0.5) * 5, -2.7, 2.7);
      tz = toward * (3 + rand() * 2.2);
      T = 0.95 + rand() * 0.2;
      a?.blip(560);
      if (!this.aiWill) { tx += (rand() < 0.5 ? -1 : 1) * 3.2; }
    }
    this.v.copy(shot(this.p, tx, 0.23, tz, T, 1.05));
    if (by === "them" && !this.aiWill && rand() < 0.5) this.v.y *= 0.6; // into the net
    this.theirSwingT = by === "them" ? 0.3 : this.theirSwingT;
  }
  private point(winner: Side, why: string) {
    if (this.phase === "point" || this.phase === "over") return;
    const w = winner === "me" ? 0 : 1, l = 1 - w;
    this.points[w]++;
    this.phase = "point"; this.phaseT = 0; this.live = false;
    const a = this.ctx.audio;
    if (winner === "me") a?.coin(); else a?.miss();
    if (this.points[w] >= 4 && this.points[w] - this.points[l] >= 2) {
      this.games[w]++; this.points = [0, 0];
      this.server = this.server === "me" ? "them" : "me";
      if (this.games[w] >= 2) {
        this.phase = "over";
        const won = w === 0;
        this.flash(won ? "Game, set, match!" : "They win…", won);
        this.ctx.reward({ kind: "match", sport: "tennis", won, score: `${this.games[0]}–${this.games[1]}`, stars: this.games[0] * 8 + (won ? 10 : 0) });
        if (won) a?.fanfare();
        return;
      }
      this.call = `${why} · Game ${winner === "me" ? "you" : "them"}!`;
    } else this.call = `${why} · ${this.score()}`;
    this.flash(why, winner === "me");
  }
  private score() {
    const names = ["Love", "15", "30", "40"], [m, t] = this.points;
    if (m >= 3 && t >= 3) return m === t ? "Deuce" : m > t ? "Advantage you" : "Advantage them";
    return `${names[Math.min(3, m)]}–${names[Math.min(3, t)]}`;
  }
  update(dt: number) {
    this.t += dt; this.phaseT += dt;
    this.swingT -= dt; this.theirSwingT -= dt;
    const [mx, my] = this.ctx.move();
    // You move around your half (with a gentle assist toward the ball when you're not steering).
    this.moving = Math.abs(mx) + Math.abs(my) > 0.1;
    if (this.phase !== "serve" && this.phase !== "toss") {
      let vx = mx * 5.6, vz = -my * 5.6;
      if (!this.moving && this.live && this.hitter === "them") {
        const land = landing(this.p, this.v, 0.23);
        if (land) vx = THREE.MathUtils.clamp((land.x - 0.5 - this.meP.x) * 2.5, -3.5, 3.5);
      }
      this.meP.x = THREE.MathUtils.clamp(this.meP.x + vx * dt, -4.2, 4.2);
      this.meP.y = THREE.MathUtils.clamp(this.meP.y + vz * dt, 1.2, 7.6);
    }
    if (this.phase === "serve") {
      this.placeServe();
      if (this.server === "them" && this.phaseT > 1) { this.phase = "toss"; this.phaseT = 0; this.v.set(0, 5.2, 0); }
    } else if (this.phase === "toss") {
      this.v.y += G * dt; this.p.y += this.v.y * dt;
      const peak = this.v.y < 0.6 && this.v.y > -1.8;
      if (this.server === "them" && this.v.y < 0.2) { this.hit("them", 0.6); this.phase = "rally"; }
      else if (this.server === "me" && this.swingT > 0 && this.p.y > 1.6) {
        const q = peak ? 1 : 0.55;
        this.hit("me", q); this.phase = "rally";
        // Serves land in their service box.
        this.v.copy(shot(this.p, THREE.MathUtils.clamp(-this.meP.x * 0.8 + this.ctx.steer() * 1.2, -2.8, 2.8), 0.23, -2.4 - rand() * 0.5, q > 0.9 ? 0.7 : 0.85, 1.05));
      } else if (this.p.y < 0.9 && this.v.y < 0) { this.phase = "serve"; this.phaseT = 0; }
    } else if (this.phase === "rally" && this.live) {
      const before = this.p.z;
      this.v.y += G * dt;
      this.p.addScaledVector(this.v, dt);
      // Net.
      if (Math.sign(before) !== Math.sign(this.p.z) && this.p.y < 1.05) {
        this.v.set(0, Math.min(0, this.v.y), -this.v.z * 0.05); this.p.z = before > 0 ? 0.12 : -0.12;
        this.point(this.hitter === "me" ? "them" : "me", "Net!");
      }
      // Bounce.
      if (this.p.y < 0.23 && this.v.y < 0) {
        this.p.y = 0.23; this.v.y *= -0.72; this.v.x *= 0.86; this.v.z *= 0.86;
        this.bounces++;
        this.ctx.audio?.pop();
        const side: Side = this.p.z > 0 ? "me" : "them";
        const inside = Math.abs(this.p.x) <= 3.15 && Math.abs(this.p.z) <= 5.6;
        if (this.bounces === 1 && (side === this.hitter || !inside)) this.point(this.hitter === "me" ? "them" : "me", "Out!");
        else if (this.bounces >= 2) this.point(this.hitter!, this.hitter === "me" ? "Winner!" : "Too slow!");
      }
      // Your swing connects if the ball is in reach.
      if (this.swingT > 0 && this.hitter === "them" && this.p.z > 0.3) {
        const rp = this.racketPoint("me"), d = Math.hypot(this.p.x - rp.x, this.p.z - rp.z);
        if (d < (this.ctx.perk === "split" ? 1.95 : 1.45) && this.p.y < 2.6) { const quality = 1 - Math.min(1, Math.abs(d - 0.35) / 1.1); this.hit("me", quality); this.swingT = 0; }
      }
      // Their AI runs to the ball and swings.
      if (this.hitter === "me") {
        const land = landing(this.p, this.v, 0.23);
        if (land) this.aiTarget.set(land.x + 0.55 + this.v.x * 0.25, Math.min(-3.8, land.z - 1.6));
        const rp = this.racketPoint("them"), d = Math.hypot(this.p.x - rp.x, this.p.z - rp.z);
        if (this.p.z < -0.5 && d < 1.3 && this.p.y < 2.4 && (this.bounces >= 1 || this.p.z < -4)) {
          this.hit("them", 0.6);
        }
      } else this.aiTarget.set(this.p.x * 0.4, -5.4);
      const speed = this.aiWill || this.hitter !== "me" ? 4.6 : 2.6;
      this.themP.x += THREE.MathUtils.clamp(this.aiTarget.x - this.themP.x, -speed * dt, speed * dt);
      this.themP.y += THREE.MathUtils.clamp(this.aiTarget.y - this.themP.y, -speed * dt, speed * dt);
      if (Math.abs(this.p.z) > 13 || Math.abs(this.p.x) > 11) this.point(this.bounces === 0 ? (this.hitter === "me" ? "them" : "me") : this.hitter!, this.bounces === 0 ? "Out!" : "Winner!");
    } else if (this.phase === "point") {
      this.v.y += G * dt; this.p.addScaledVector(this.v, dt * 0.6);
      if (this.p.y < 0.23) { this.p.y = 0.23; this.v.y *= -0.5; }
      if (this.phaseT > 1.4) this.newPoint();
    }
    // Draw.
    this.ball.position.copy(this.p);
    this.ballShadow.position.set(this.p.x, 0.12, this.p.z);
    this.trail.forEach((m, i) => { m.position.copy(this.p).addScaledVector(this.v, -0.03 * (i + 1)); m.visible = this.live && this.v.length() > 6; });
    this.me.group.position.set(this.meP.x, 0.1, this.meP.y);
    this.them.group.position.set(this.themP.x, 0.1, this.themP.y);
    this.myRacket.rotation.set(0, 0, this.swingT > 0 ? -1.4 + (this.swingT / 0.3) * 2.2 : 0.3);
    this.theirRacket.rotation.set(0, 0, this.theirSwingT > 0 ? 1.4 - (this.theirSwingT / 0.3) * 2.2 : -0.3);
    const themMoving = Math.hypot(this.aiTarget.x - this.themP.x, this.aiTarget.y - this.themP.y) > 0.2 && this.phase === "rally";
    this.me.show(this.moving ? (Math.abs(mx) > Math.abs(my) ? (mx > 0 ? "right" : "left") : "up") : "up", this.moving, Math.floor(this.t * 11) % 8);
    this.them.show("down", themMoving, Math.floor(this.t * 11) % 8);
  }
  hud(): ActivityHud {
    const h = base("tennis", "Tennis");
    h.score = `Games ${this.games[0]}–${this.games[1]} · ${this.score()}   (first to 2 games)`;
    h.flash = this.flashText;
    if (this.phase === "over") {
      const won = this.games[0] > this.games[1];
      h.result = { title: won ? "Game, set, match!" : "They take the match", lines: [`Games ${this.games[0]}–${this.games[1]}`, won ? "Trophy for your shelf" : "Swing just as the ball reaches you; A / D aims"], good: won };
      h.action = "Play again"; return h;
    }
    if (this.phase === "serve") { h.hint = this.server === "me" ? "Your serve: tap to toss, tap again at the top" : "Their serve… get ready"; h.action = this.server === "me" ? "Toss" : "…"; }
    else if (this.phase === "toss") { h.hint = this.server === "me" ? "Hit it at the top!" : "Here it comes!"; h.action = "Serve!"; }
    else if (this.phase === "point") { h.hint = this.call; h.action = "…"; }
    else { h.hint = "Move WASD / stick · SWING as the ball reaches you · hold A or D to aim"; h.action = "Swing"; }
    return h;
  }
}

// ---------------------------------------------------------------- boxing (from behind your Friend)
type Move = "jab" | "hookL" | "hookR" | "upper";
type FoeState = "idle" | "tell" | "strike" | "recover" | "dizzy" | "hurt" | "down";
const MOVES: Record<Move, { tell: number; dmg: number; name: string }> = {
  jab: { tell: 0.42, dmg: 8, name: "Jab" }, hookL: { tell: 0.68, dmg: 14, name: "Left hook" }, hookR: { tell: 0.68, dmg: 14, name: "Right hook" }, upper: { tell: 0.95, dmg: 22, name: "Uppercut" },
};
export class Boxing extends Activity {
  readonly kind = "boxing" as const;
  private me: FriendBillboard;
  private foe: FriendBillboard;
  private myGloves: THREE.Group[];
  private foeGloves: THREE.Group[];
  private hp = [100, 120];
  private state: FoeState = "idle";
  private stateT = 0;
  private stateFor = 1.4;
  private move: Move = "jab";
  private dodge = 0; private dodgeT = 0; private dodged = false;
  private punchT = 0; private punchHand = 0;
  private stars = 0;
  private combo = 0;
  private dizzyLeft = 0;
  private over: "win" | "lose" | null = null;
  private dizzyStars: THREE.Mesh;
  constructor(ctx: ActivityContext) {
    super(ctx);
    const y = 0.89;
    this.foe = friend(ctx.them ?? ctx.me, "down", 2.9); this.foe.group.position.set(0, y, -1.2); this.add(this.foe.group);
    this.me = friend(ctx.me, "up", 2); this.me.group.position.set(0, y, 2.3); this.add(this.me.group);
    (this.me.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    this.myGloves = [glove("#e8543f"), glove("#e8543f")];
    this.foeGloves = [glove("#5a8fd6"), glove("#5a8fd6")];
    for (const g of [...this.myGloves, ...this.foeGloves]) this.add(g);
    const s = new Blocks();
    for (let i = 0; i < 4; i++) s.add(new THREE.OctahedronGeometry(0.15, 0), Math.cos(i * 1.57) * 0.7, 0, Math.sin(i * 1.57) * 0.7, "#f2ce68");
    this.dizzyStars = this.add(s.mesh(glowMaterial)); this.dizzyStars.visible = false;
  }
  view(): [THREE.Vector3, THREE.Vector3] { return [new THREE.Vector3(this.dodgeX() * 0.4, 3.3, 5.6), new THREE.Vector3(0, 2.3, -1.2)]; }
  restart() { this.hp = [100, 120]; this.state = "idle"; this.stateT = 0; this.stateFor = 1.2; this.over = null; this.stars = 0; this.combo = 0; }
  private dodgeX() { return this.dodgeT > 0 ? this.dodge * Math.sin((this.dodgeT / 0.5) * Math.PI) * 1.2 : 0; }
  action() {
    if (this.over) { this.restart(); return; }
    if (this.punchT > 0 || this.dodgeT > 0) return;
    this.punchT = 0.26; this.punchHand = 1 - this.punchHand;
    const a = this.ctx.audio;
    if (this.state === "dizzy" || this.state === "hurt" || this.state === "recover") {
      this.combo++;
      this.damage(6 + Math.min(6, this.combo), this.combo > 2 ? "Combo!" : "POW!");
      this.state = "hurt"; this.stateT = 0;
    } else if (this.state === "tell" && this.move !== "jab") {
      this.damage(11, "Counter!"); this.state = "hurt"; this.stateT = 0; this.dizzyLeft = 0; this.stars = Math.min(3, this.stars + 1);
    } else { this.damage(1, "Blocked"); a?.blip(300); }
  }
  side(dir: number) {
    if (this.over || this.dodgeT > 0) return;
    this.dodge = dir; this.dodgeT = 0.5; this.ctx.audio?.swish();
    if (this.state === "tell" || this.state === "strike") this.dodged = true;
  }
  special() {
    if (this.over || this.stars <= 0 || this.punchT > 0) return;
    this.stars--; this.punchT = 0.4;
    this.damage(24, "STAR PUNCH!"); this.state = "dizzy"; this.stateT = 0; this.dizzyLeft = 1.2; this.ctx.shake(0.6); this.ctx.audio?.fanfare();
  }
  private damage(n: number, text: string) {
    if (this.ctx.perk === "heavy" && n > 2) n = Math.round(n * 1.5);
    this.hp[1] = Math.max(0, this.hp[1] - n);
    if (n > 2) { this.ctx.audio?.bonk(); this.ctx.shake(0.15 + n * 0.01); }
    this.flash(text, n > 2);
    if (this.hp[1] <= 0) this.finish("win");
  }
  private finish(r: "win" | "lose") {
    this.over = r; this.state = "down";
    const won = r === "win";
    this.flash(won ? "K.O.!" : "Knocked out…", won);
    this.ctx.reward({ kind: "match", sport: "boxing", won, score: `${this.hp[0]} HP left`, stars: won ? 10 + Math.round(this.hp[0] / 10) : 2 });
    if (won) this.ctx.audio?.fanfare(); else this.ctx.audio?.miss();
  }
  update(dt: number) {
    this.t += dt; this.stateT += dt;
    this.punchT = Math.max(0, this.punchT - dt);
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    const blocking = this.ctx.block();
    if (!this.over) {
      if (this.state === "idle" && this.stateT > this.stateFor) {
        const r = rand(); this.move = r < 0.35 ? "jab" : r < 0.6 ? "hookL" : r < 0.85 ? "hookR" : "upper";
        this.state = "tell"; this.stateT = 0; this.dodged = false; this.combo = 0; this.ctx.audio?.blip(this.move === "upper" ? 220 : 330);
      } else if (this.state === "tell" && this.stateT > MOVES[this.move].tell * (0.8 + this.hp[1] / 600) * (this.ctx.perk === "echo" ? 1.25 : 1)) { this.state = "strike"; this.stateT = 0; }
      else if (this.state === "strike" && this.stateT > 0.14) {
        const m = MOVES[this.move];
        // Hooks come from one side: dodge away from them. Jabs and uppercuts: dodge either way.
        const right = this.move === "hookL" ? this.dodge > 0 : this.move === "hookR" ? this.dodge < 0 : true;
        if (this.dodged && right) {
          const dizzy = this.move === "upper" ? 1.9 : this.move === "jab" ? 0 : 1.3;
          if (this.move === "upper") this.stars = Math.min(3, this.stars + 1);
          this.state = dizzy ? "dizzy" : "recover"; this.stateT = 0; this.stateFor = 0.5; this.dizzyLeft = dizzy;
          this.flash(dizzy ? "Dodged! Hit back!" : "Dodged!", true); this.ctx.audio?.coin();
        } else {
          const blocked = blocking && this.move !== "upper";
          const dmg = blocked ? Math.round(m.dmg * 0.3) : m.dmg;
          this.hp[0] = Math.max(0, this.hp[0] - dmg); this.ctx.shake(blocked ? 0.2 : 0.6); this.ctx.audio?.bonk();
          this.flash(blocked ? "Blocked!" : this.move === "upper" ? "Uppercut! Ouch!" : "Ouch!", false);
          this.state = "recover"; this.stateT = 0; this.stateFor = 0.5;
          if (this.hp[0] <= 0) this.finish("lose");
        }
      } else if (this.state === "hurt" && this.stateT > 0.3) {
        this.state = this.dizzyLeft > 0 ? "dizzy" : "idle"; this.stateT = 0; this.stateFor = 0.7 + rand() * 1.1;
      } else if ((this.state === "dizzy" && this.dizzyLeft <= 0) || (this.state === "recover" && this.stateT > this.stateFor)) {
        this.state = "idle"; this.stateT = 0; this.stateFor = 0.7 + rand() * 1.1;
      }
      if (this.state === "dizzy" || this.state === "hurt") this.dizzyLeft -= dt;
    }
    // ---- poses: the gloves tell you everything ----
    const dx = this.dodgeX(), duck = this.dodgeT > 0 ? Math.sin((this.dodgeT / 0.5) * Math.PI) * 0.3 : 0;
    const bob = Math.sin(this.t * 5) * 0.05;
    this.me.group.position.set(dx, 0.89 + bob - duck, 2.3);
    this.myGloves.forEach((g, i) => {
      const side = i ? 1 : -1, punching = this.punchT > 0 && this.punchHand === i, k = punching ? Math.sin((this.punchT / (this.punchT > 0.26 ? 0.4 : 0.26)) * Math.PI) : 0;
      const guard = blocking ? 0.25 : 0;
      g.position.set(dx + side * (0.55 - guard) - side * k * 0.4, 2.05 + bob - duck + guard * 0.6 + k * 0.3, 1.75 - k * 2.3 - guard * 0.3);
      g.rotation.set(0, 0, side * 0.2);
    });
    const foe = this.foe.group, m = this.move, tell = this.state === "tell" ? Math.min(1, this.stateT / MOVES[m].tell) : 0, strike = this.state === "strike" ? 1 : 0;
    const sway = this.state === "dizzy" ? Math.sin(this.t * 7) * 0.35 : Math.sin(this.t * 1.6) * 0.15;
    foe.position.set(sway + (this.state === "hurt" ? 0 : 0), 0.89 + (this.over === "win" ? -0.6 : 0) + (m === "upper" && this.state === "tell" ? -0.3 * tell : 0), -1.2 + (this.state === "hurt" ? -0.35 : 0) + strike * 0.9);
    this.foe.mesh.rotation.z = this.over === "win" ? 1.3 : this.state === "dizzy" ? Math.sin(this.t * 9) * 0.18 : this.state === "hurt" ? 0.2 : m === "hookL" ? -0.18 * tell : m === "hookR" ? 0.18 * tell : 0;
    this.foeGloves.forEach((g, i) => {
      const side = i ? 1 : -1;
      let x = foe.position.x + side * 0.62, y = 2.4, z = -0.55;
      const active = (m === "jab" && i === 1) || (m === "hookL" && i === 0) || (m === "hookR" && i === 1) || (m === "upper" && i === 1);
      if ((this.state === "tell" || this.state === "strike") && active) {
        if (m === "jab") { z -= tell * 0.4; z += strike * 2.2; x -= strike * 0.4 * side; }
        else if (m === "upper") { y -= tell * 1.1; z -= tell * 0.2; y += strike * 1.2; z += strike * 2; x -= side * strike * 0.5; }
        else { x += side * tell * 1; z -= tell * 0.6; x -= side * strike * 1.6; z += strike * 2.2; }
        // A little glow on the glove that's about to hit.
        g.scale.setScalar(1 + tell * 0.25);
      } else g.scale.setScalar(1);
      if (this.state === "dizzy") { y -= 0.6; x += side * 0.3; }
      g.position.set(x, y + Math.sin(this.t * 4 + i) * 0.05, z);
    });
    this.dizzyStars.visible = this.state === "dizzy";
    this.dizzyStars.position.set(foe.position.x, 3.7, -1.2); this.dizzyStars.rotation.y = this.t * 4;
    this.me.show("up", this.dodgeT > 0, Math.floor(this.t * 12) % 8);
    this.foe.show("down", this.state === "tell" || this.state === "strike", Math.floor(this.t * 12) % 8);
  }
  hud(): ActivityHud {
    const h = base("boxing", "Boxing");
    h.health = { me: this.hp[0], them: Math.round(this.hp[1] / 1.2) };
    h.flash = this.flashText; h.sides = !this.over;
    h.score = `★ Star punches: ${"★".repeat(this.stars)}${"☆".repeat(3 - this.stars)}`;
    if (this.over) {
      const won = this.over === "win";
      h.result = { title: won ? "K.O.! You win!" : "You got knocked out", lines: [won ? "Trophy for your shelf" : "Read the gloves: dodge away from hooks, dodge any way from jabs and uppercuts"], good: won };
      h.action = "Rematch"; h.sides = false; return h;
    }
    const m = MOVES[this.move];
    h.hint = this.state === "tell" ? (this.move === "hookL" ? "Left hook coming: dodge ▶ right!" : this.move === "hookR" ? "Right hook coming: dodge ◀ left!" : this.move === "upper" ? "UPPERCUT! Dodge! (can't block it)" : "Jab! Dodge or block") + (this.move !== "jab" ? " (or punch first to counter)" : "")
      : this.state === "dizzy" ? "Dizzy! Punch punch punch!" : "Wait for their move… punches now get blocked";
    void m;
    h.action = "Punch";
    h.buttons = [{ id: "block", label: "Block", hold: true }, ...(this.stars ? [{ id: "star", label: "★ Star", hold: false }] : [])];
    return h;
  }
}
