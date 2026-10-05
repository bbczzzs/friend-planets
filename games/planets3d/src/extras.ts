/**
 * Little things all over each planet: sparkling spots to dig up treasure and
 * butterflies to catch. Built when you arrive, cleared when you leave.
 */
import * as THREE from "three";
import { Blocks, glowMaterial, litMaterial } from "./models";
import { particles } from "./look";
import { mulberry32, TAU } from "./data";
import { surfaceFrame, type Planet } from "./planet";

export interface Find { name: string; icon: string; rarity: 1 | 2 | 3 | 4; color: string }
export const TREASURES: Find[] = [
  { name: "Shiny pebble", icon: "🪨", rarity: 1, color: "#b9bdc6" }, { name: "Old boot", icon: "🥾", rarity: 1, color: "#8a5a3a" },
  { name: "Bottle cap", icon: "🔘", rarity: 1, color: "#e8543f" }, { name: "Fossil", icon: "🦴", rarity: 2, color: "#e6dcc6" },
  { name: "Gem shard", icon: "💎", rarity: 2, color: "#7db4db" }, { name: "Gold coin", icon: "🪙", rarity: 3, color: "#f2c14e" },
];
/** Each family's planet hides one rare treasure of its own. */
export const FAMILY_TREASURE: Find[] = [
  { name: "Frozen crown", icon: "👑", rarity: 4, color: "#bcd8f2" }, { name: "Golden mask", icon: "🎭", rarity: 4, color: "#f2c14e" },
  { name: "Grandma's locket", icon: "📿", rarity: 4, color: "#ed927e" }, { name: "Glow spore", icon: "🍄", rarity: 4, color: "#a8f0c8" },
  { name: "Crooked compass", icon: "🧭", rarity: 4, color: "#d9a05b" }, { name: "Candy crystal", icon: "🍬", rarity: 4, color: "#f6aacb" },
  { name: "Giant's tooth", icon: "🦷", rarity: 4, color: "#f4f1ea" }, { name: "Rainbow pearl", icon: "🫧", rarity: 4, color: "#7ff3ff" },
  { name: "Echo shell", icon: "🐚", rarity: 4, color: "#b3a0d8" },
];
export const BUGS: Find[] = [
  { name: "Cabbage white", icon: "🦋", rarity: 1, color: "#f4f1ea" }, { name: "Sunny sulphur", icon: "🦋", rarity: 1, color: "#f2ce68" },
  { name: "Sky blue", icon: "🦋", rarity: 2, color: "#7db4db" }, { name: "Coral wing", icon: "🦋", rarity: 2, color: "#ed927e" },
  { name: "Lilac dream", icon: "🦋", rarity: 3, color: "#b3a0d8" }, { name: "Golden monarch", icon: "🦋", rarity: 4, color: "#f2a33a" },
];
const pickBy = (list: Find[], r: () => number) => {
  const weight = (f: Find) => [0, 50, 26, 10, 3][f.rarity];
  let total = 0; for (const f of list) total += weight(f);
  let roll = r() * total;
  for (const f of list) { roll -= weight(f); if (roll <= 0) return f; }
  return list[0];
};

type Dig = { n: THREE.Vector3; group: THREE.Group; wait: number };
type Bug = { n: THREE.Vector3; target: THREE.Vector3; lift: number; kind: Find; group: THREE.Group; wings: THREE.Mesh[]; wait: number; phase: number };

export class Extras {
  readonly group = new THREE.Group();
  readonly digs: Dig[] = [];
  readonly bugs: Bug[] = [];
  private rand: () => number;

  constructor(readonly planet: Planet) {
    this.rand = mulberry32(planet.spec.seed ^ 0xe7a5);
    planet.group.add(this.group);
    for (let i = 0; i < 4; i++) this.digs.push(this.makeDig());
    for (let i = 0; i < 6; i++) this.bugs.push(this.makeBug());
  }

  private spot(maxAngle: number) {
    const planet = this.planet, R = planet.R;
    for (let i = 0; i < 60; i++) {
      const n = planet.baseUp.clone().add(new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(maxAngle * 2)).normalize();
      if (!planet.walkable(n) || planet.height(n) < planet.water + 0.5) continue;
      const p = n.clone().multiplyScalar(R);
      if (planet.stations.some(s => p.distanceTo(s.pos) < s.flat + 1.5)) continue;
      if (n.angleTo(planet.baseUp) < 4.5 / R) continue;
      return n;
    }
    return planet.baseUp.clone();
  }
  private makeDig(): Dig {
    const n = this.spot(0.75), h = this.planet.height(n), group = new THREE.Group();
    const frame = surfaceFrame(n, null, h);
    group.add(new Blocks().at(frame).add(new THREE.SphereGeometry(0.55, 10, 6, 0, TAU, 0, Math.PI / 2), 0, -0.05, 0, "#8a5a3a", { sy: 0.45, smooth: true }).mesh(litMaterial));
    const sparkle = particles(Array.from({ length: 10 }, () => new THREE.Vector3((this.rand() - 0.5) * 0.8, 0.4, (this.rand() - 0.5) * 0.8)), { color: "#fff4a8", size: 0.12, additive: true, mode: "rise", height: 1.2, speed: 0.6, spread: 0.3 });
    frame.decompose(sparkle.position, sparkle.quaternion, sparkle.scale);
    group.add(sparkle);
    this.group.add(group);
    return { n, group, wait: 0 };
  }
  private makeBug(): Bug {
    const kind = pickBy(BUGS, this.rand), group = new THREE.Group(), wings: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), new THREE.MeshLambertMaterial({ color: kind.color, side: THREE.DoubleSide, emissive: kind.color, emissiveIntensity: 0.25 }));
      w.geometry.translate(side * 0.2, 0, 0); w.geometry.scale(1, 1.3, 1);
      const pivot = new THREE.Group(); pivot.add(w); group.add(pivot); wings.push(w);
      w.userData.side = side;
    }
    group.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.22, 4, 6), new THREE.MeshBasicMaterial({ color: "#222222" })));
    if (kind.rarity >= 3) group.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), glowMaterial));
    const n = this.spot(0.8);
    this.group.add(group);
    return { n, target: n.clone(), lift: 1.2 + this.rand(), kind, group, wings, wait: 0, phase: this.rand() * 10 };
  }

  update(dt: number, t: number) {
    const planet = this.planet, R = planet.R;
    for (const d of this.digs) {
      if (d.wait > 0) { d.wait -= dt; if (d.wait <= 0) { const nd = this.makeDig(); this.group.remove(d.group); d.n = nd.n; d.group = nd.group; } }
      d.group.visible = d.wait <= 0;
    }
    for (const b of this.bugs) {
      if (b.wait > 0) { b.wait -= dt; b.group.visible = false; if (b.wait <= 0) { b.n.copy(this.spot(0.8)); b.target.copy(b.n); b.kind = pickBy(BUGS, this.rand); } continue; }
      b.group.visible = true;
      if (b.n.angleTo(b.target) < 0.01) b.target.copy(b.n).add(new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(8 / R)).normalize();
      const tangent = b.target.clone().sub(b.n.clone().multiplyScalar(b.n.dot(b.target)));
      if (tangent.lengthSq() > 1e-8) b.n.addScaledVector(tangent.normalize(), (1.3 * dt) / R).normalize();
      if (!planet.walkable(b.n)) b.target.copy(planet.baseUp);
      const h = Math.max(planet.height(b.n), planet.water) + b.lift + Math.sin(t * 2 + b.phase) * 0.35;
      b.group.position.copy(b.n).multiplyScalar(h);
      b.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.n);
      const flap = Math.sin(t * 18 + b.phase) * 0.9;
      b.wings.forEach(w => { (w.parent as THREE.Object3D).rotation.set(0, (w.userData.side as number) * flap * 0.8, 0); });
    }
  }

  /** The dig spot or bug near you (planet-local position `p`). */
  nearDig(p: THREE.Vector3) { return this.digs.findIndex(d => d.wait <= 0 && d.n.clone().multiplyScalar(this.planet.R).distanceTo(p) < 1.8); }
  nearBug(p: THREE.Vector3) { return this.bugs.findIndex(b => b.wait <= 0 && b.group.position.distanceTo(p) < 2.6); }
  dig(i: number, family: number): Find {
    this.digs[i].wait = 45;
    return this.rand() < 0.1 ? FAMILY_TREASURE[family % 9] : pickBy(TREASURES, this.rand);
  }
  catchBug(i: number): Find { const b = this.bugs[i]; b.wait = 30; return b.kind; }
  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    this.group.removeFromParent();
  }
}
