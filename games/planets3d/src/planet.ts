/**
 * A tiny planet you can walk all the way around. The ground is a displaced
 * icosphere (flat-shaded, vertex coloured) with a water sphere inside it, so
 * dips below the water line become lakes. The "base" (landing pad, house,
 * farm, pond, sport arena) sits on the sunny side around a little plaza;
 * the far side is night, lit by the planet's glowing plants and lamps.
 * Everything is in planet-local coordinates; the group is only translated.
 */
import * as THREE from "three";
import { Blocks, Label, UNIT, glowMaterial, litMaterial } from "./models";
import { TIME, grassField, inked, outline, outlineHull, particles, smoothNormals, toon, waterMaterial, weldPositions } from "./look";
import { mulberry32, TAU, type Sport, type Theme, type TreeKind } from "./data";

export type StationKind = "pad" | "house" | "farm" | "pond" | "sport" | "sign";
export interface Station { kind: StationKind; n: THREE.Vector3; frame: THREE.Matrix4; pos: THREE.Vector3; reach: number; flat: number }
export interface Collider { p: THREE.Vector3; r: number }
export interface Plot { p: THREE.Vector3; frame: THREE.Matrix4 }
export interface PlanetSpec {
  index: number; id: number; name: string; family: number; theme: Theme; R: number; center: THREE.Vector3; seed: number;
  home: boolean; sport: Sport | null; fishing: boolean; farm: boolean; baseUp: THREE.Vector3; rings: boolean; moons: number;
  /** The planet's Friend: its canonical 16×16 front frame ("#" = pixel). */
  mask?: readonly string[];
}

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const angleBetween = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
const shade = (color: string, amount: number) => `#${new THREE.Color(color).multiplyScalar(amount).getHexString()}`;

/** A frame standing on the planet at direction n, facing (+Z) along the surface toward `toward`. */
export function surfaceFrame(n: THREE.Vector3, toward: THREE.Vector3 | null, radius: number, spin = 0, out = new THREE.Matrix4()) {
  const up = n.clone().normalize();
  let fwd = toward ? toward.clone().sub(up.clone().multiplyScalar(toward.dot(up))) : new THREE.Vector3();
  if (fwd.lengthSq() < 1e-6) { fwd = new THREE.Vector3(0, 0, 1).sub(up.clone().multiplyScalar(up.z)); if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0); }
  fwd.normalize();
  if (spin) fwd.applyAxisAngle(up, spin);
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  out.makeBasis(right, up, fwd);
  out.setPosition(up.multiplyScalar(radius));
  return out;
}

type Wave = { d: THREE.Vector3; f: number; a: number; p: number };
type Dip = { d: THREE.Vector3; ang: number; depth: number };
type Flat = { d: THREE.Vector3; ang: number };
type Bump = { d: THREE.Vector3; ang: number; h: number };
type Dock = { inv: THREE.Matrix4; halfW: number; len: number };

export class Planet {
  readonly group = new THREE.Group();
  readonly R: number;
  readonly water: number;
  readonly stations: Station[] = [];
  readonly colliders: Collider[] = [];
  readonly plots: Plot[] = [];
  readonly labels: Label[] = [];
  readonly glowBits: THREE.Object3D[] = [];
  readonly halo: THREE.Mesh;
  readonly padFrame: THREE.Matrix4;
  readonly spawn: THREE.Vector3;
  readonly baseUp: THREE.Vector3;
  arena: { frame: THREE.Matrix4; sport: Sport } | null = null;
  /** Centre of the fishing pond at water level (planet-local). */
  pond: THREE.Vector3 | null = null;
  private waves: Wave[] = [];
  private dips: Dip[] = [];
  private flats: Flat[] = [];
  private bumps: Bump[] = [];
  private docks: Dock[] = [];
  private paths: THREE.Vector3[][] = [];
  private waterMesh: THREE.Mesh;
  /** Things only worth drawing when you're near: outlines, grass, clouds, particles. */
  private detail: THREE.Object3D[] = [];
  private clouds: THREE.Object3D[] = [];
  private flame: THREE.Mesh | null = null;
  private campfire: THREE.Vector3 | null = null;
  private rand: () => number;
  private qBase: THREE.Quaternion;
  /** Where the Friend's portrait sits, and its tangent axes (e1 → right, e2 → top of the picture). */
  readonly faceDir = new THREE.Vector3();
  readonly faceUp = new THREE.Vector3();
  private faceRight = new THREE.Vector3();
  private faceA = 0.74;
  /** 18×18 cells (the 16×16 mask plus a one-cell border): 0 empty, 1 pixel, 2 halo; with top radius. */
  private cells: { kind: number; top: number }[] = [];

  constructor(readonly spec: PlanetSpec) {
    const { R, theme, seed } = spec;
    this.R = R; this.water = R - 1.3;
    this.rand = mulberry32(seed ^ 0x51f15e);
    this.baseUp = spec.baseUp.clone().normalize();
    this.qBase = new THREE.Quaternion().setFromUnitVectors(Y, this.baseUp);
    this.group.position.copy(spec.center);
    const r = this.rand;

    // The Friend's portrait: past the base, on the far side of the sun, so it's lit and clear of the buildings.
    const toSun = new THREE.Vector3().crossVectors(this.baseUp, SUN_DIR);
    if (toSun.lengthSq() < 1e-4) toSun.set(1, 0, 0);
    toSun.normalize();
    this.faceDir.copy(this.baseUp).applyAxisAngle(toSun, 1.95).normalize();
    this.faceUp.copy(this.baseUp).sub(this.faceDir.clone().multiplyScalar(this.baseUp.dot(this.faceDir))).normalize();
    this.faceRight.crossVectors(this.faceUp, this.faceDir).normalize();
    const clearOfFace = (d: THREE.Vector3, pad: number) => angleBetween(d, this.faceDir) > this.faceA + pad;

    // Rolling hills: a few long waves; plus two or three big hills away from the base and the portrait.
    const amps = [0.34, 0.26, 0.2, 0.16, 0.12];
    for (const a of amps) this.waves.push({ d: randomDir(r), f: 2.2 + r() * 5, a, p: r() * TAU });
    for (let i = 0, tries = 0; i < 3 && tries < 40; tries++) {
      const d = this.dir(1.6 + r() * 1.3, r() * TAU);
      if (!clearOfFace(d, 0.6)) continue;
      this.bumps.push({ d, ang: 0.35 + r() * 0.25, h: 2.2 + r() * 2.4 }); i++;
    }

    // ---- base layout (angles from the base's pole) ----
    const at = (theta: number, phi: number) => this.dir(theta, phi);
    const plaza = this.baseUp.clone();
    this.flats.push({ d: plaza, ang: 3.4 / R });
    const padN = at(9.5 / R, 0);
    this.flats.push({ d: padN, ang: 3.6 / R });
    const houseN = at(9 / R, 2.25);
    this.flats.push({ d: houseN, ang: 4 / R });
    const farmN = spec.farm ? at(9.5 / R, 3.95) : null;
    if (farmN) this.flats.push({ d: farmN, ang: 3.8 / R });
    const pondN = spec.fishing ? at(15.5 / R, 1.1) : null;
    if (pondN) this.dips.push({ d: pondN, ang: 7.2 / R, depth: 3.3 });
    const arenaN = spec.sport ? at(13 / R, 5.1) : null;
    if (arenaN) this.flats.push({ d: arenaN, ang: 7.4 / R });
    // A second, bigger lake somewhere on the far side (not on the portrait).
    for (let tries = 0; tries < 40; tries++) {
      const d = this.dir(2.3 + r() * 0.5, r() * TAU);
      if (tries < 39 && !clearOfFace(d, 0.75)) continue;
      this.dips.push({ d, ang: 0.45 + r() * 0.2, depth: 3.2 }); break;
    }
    this.buildCells(spec.mask);

    for (const target of [padN, houseN, farmN, arenaN]) if (target) this.paths.push(arc(plaza, target, 14));
    if (pondN) this.paths.push(arc(plaza, pondN.clone().lerp(plaza, 0.5).normalize(), 12));

    this.spawn = at(4.6 / R, 0);

    // ---- layout of the base (data only: stations, frames, colliders) ----
    this.padFrame = surfaceFrame(padN, plaza, R);
    this.stations.push({ kind: "pad", n: padN, frame: this.padFrame, pos: padN.clone().multiplyScalar(R), reach: 4.4, flat: 3.6 });
    this.colliders.push({ p: padN.clone().multiplyScalar(R), r: 1.7 });
    const houseFrame = surfaceFrame(houseN, plaza, R);
    this.stations.push({ kind: "house", n: houseN, frame: houseFrame, pos: houseN.clone().multiplyScalar(R), reach: 4.2, flat: 4 });
    this.colliders.push({ p: houseN.clone().multiplyScalar(R), r: 2.6 });
    const farmFrame = farmN ? surfaceFrame(farmN, plaza, R) : null;
    if (farmN && farmFrame) this.stations.push({ kind: "farm", n: farmN, frame: farmFrame, pos: farmN.clone().multiplyScalar(R), reach: 3.6, flat: 3.8 });
    let dockFrame: THREE.Matrix4 | null = null;
    if (pondN) {
      // The dock starts on the shore (toward the plaza) and reaches out over the water.
      const shoreN = pondN.clone().lerp(plaza, 0.46).normalize();
      this.pond = pondN.clone().multiplyScalar(this.water);
      dockFrame = surfaceFrame(shoreN, pondN, R - 0.1);
      this.docks.push({ inv: dockFrame.clone().invert(), halfW: 0.95, len: 4.25 });
      const tipN = new THREE.Vector3(0, 0, 3.6).applyMatrix4(dockFrame).normalize();
      this.stations.push({ kind: "pond", n: tipN, frame: surfaceFrame(tipN, pondN, R), pos: tipN.clone().multiplyScalar(this.surface(tipN)), reach: 2.6, flat: 0 });
    }
    if (arenaN) {
      const frame = surfaceFrame(arenaN, plaza, R);
      this.arena = { frame, sport: spec.sport! };
      this.stations.push({ kind: "sport", n: arenaN, frame, pos: arenaN.clone().multiplyScalar(R), reach: 4.5, flat: 7.4 });
    }
    this.layout = { plaza, padN, houseFrame, farmFrame, dockFrame, pondN, signN: at(5.8 / R, -0.55) };

    // ---- what you see from far away: water, a light sphere with the portrait, the atmosphere, rings, moons ----
    this.waterMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(this.water, 12), waterMaterial(theme.water));
    this.waterMesh.receiveShadow = true;
    this.group.add(this.waterMesh);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 40, 24), haloMaterial(theme.sky.horizon));
    this.group.add(this.halo);
    this.lod = this.buildGround(12, false);
    this.group.add(this.lod);
    if (spec.rings) this.group.add(this.buildRings());
    for (let i = 0; i < spec.moons; i++) this.group.add(this.buildMoon(i));
  }
  private layout!: { plaza: THREE.Vector3; padN: THREE.Vector3; houseFrame: THREE.Matrix4; farmFrame: THREE.Matrix4 | null; dockFrame: THREE.Matrix4 | null; pondN: THREE.Vector3 | null; signN: THREE.Vector3 };
  private full: THREE.Object3D[] = [];
  private lod!: THREE.Mesh;
  /** Full detail is finished (until then the far-away stand-in shows). */
  built = false;
  private job: Generator<void, void> | null = null;

  /** Full detail, all at once (landing needs it now). */
  ensureDetail() { while (!this.buildSome(Infinity)); }
  /**
   * Builds full detail a slice at a time so flying past stays smooth: works for
   * about `budgetMs` and returns true once the planet is finished.
   */
  buildSome(budgetMs: number) {
    if (this.built) return true;
    this.job ??= this.detailJob();
    const end = performance.now() + budgetMs;
    do { if (this.job.next().done) { this.job = null; return true; } } while (performance.now() < end);
    return false;
  }
  private *detailJob(): Generator<void, void> {
    const { spec } = this, { R, theme } = spec, L = this.layout;
    const before = new Set(this.group.children);
    // Pieces stay hidden until the planet is finished, then the near/far switch shows them.
    const hideNew = () => { for (const o of this.group.children) if (!before.has(o)) o.visible = false; };
    const ground = yield* this.groundJob();
    this.group.add(ground); hideNew(); yield;
    const lit = new Blocks(), glow = new Blocks();
    this.buildPad(lit, glow, this.padFrame);
    this.buildHouse(lit, glow, L.houseFrame);
    yield;
    if (L.farmFrame) this.buildFarm(lit, L.farmFrame);
    if (L.dockFrame && L.pondN) { this.buildDock(lit, L.dockFrame); this.buildPondDecor(lit, L.pondN); }
    yield;
    if (this.arena) this.buildArena(lit, glow, this.arena.frame, this.arena.sport);
    this.buildPlaza(lit, glow, L.plaza, L.padN);
    yield;
    yield* this.scatter(lit, glow);
    this.buildPathLamps(lit, glow);
    yield;
    const litGeometry = lit.build(); yield;
    const litMesh = new THREE.Mesh(litGeometry, litMaterial);
    litMesh.castShadow = litMesh.receiveShadow = true;
    const welded = weldPositions(litGeometry.getAttribute("position"), 1e-3); yield;
    smoothNormals(welded); yield;
    const litHull = outlineHull(litMesh, welded);
    this.group.add(litMesh, litHull);
    const glowMesh = glow.mesh(glowMaterial);
    this.group.add(glowMesh);
    const glowHull = outline(glowMesh, 0.05);
    this.group.add(glowHull);
    this.detail.push(litHull, glowHull);
    hideNew(); yield;
    this.buildFace(); hideNew(); yield;
    this.buildGrass(); hideNew(); yield;
    this.buildClouds(); hideNew(); yield;
    this.buildParticles(); hideNew(); yield;
    // Sign with the planet's name next to the plaza.
    const sign = new Label(0.4);
    sign.set([{ text: spec.name, color: "#ffffff", size: 44 }, { text: spec.home ? "your planet" : theme.region, color: theme.accent, size: 26 }]);
    sign.sprite.position.copy(L.signN.clone().multiplyScalar(R + 2.25));
    this.group.add(sign.sprite); this.labels.push(sign);
    const post = new Blocks().at(surfaceFrame(L.signN, L.plaza, R)).box(0.22, 2.1, 0.22, 0, 1.05, 0, theme.trunk).box(1.6, 0.5, 0.14, 0, 1.9, 0, theme.wall);
    inked(this.group, post.mesh());
    this.colliders.push({ p: L.signN.clone().multiplyScalar(R), r: 0.4 });
    this.full = this.group.children.filter(o => !before.has(o));
    this.built = true;
    this.near = !this.near; // force the near/far switch to run on the next update
  }

  /** Unit direction at angle theta from the base's pole and azimuth phi around it. */
  dir(theta: number, phi: number) {
    return new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)).applyQuaternion(this.qBase).normalize();
  }

  /** Terrain radius along unit direction n (planet-local). */
  height(n: THREE.Vector3) {
    let h = this.R;
    for (const w of this.waves) h += w.a * Math.sin(w.f * (n.x * w.d.x + n.y * w.d.y + n.z * w.d.z) * 3 + w.p);
    for (const b of this.bumps) { const t = smooth(b.ang, 0, angleBetween(n, b.d)); h += b.h * t * t; }
    for (const d of this.dips) { const a = angleBetween(n, d.d); if (a < d.ang) h -= d.depth * smooth(d.ang, d.ang * 0.45, a) + (h - this.R) * smooth(d.ang, d.ang * 0.6, a); }
    // Flat spots are true planes touching radius R, so buildings and courts sit flush.
    for (const f of this.flats) { const a = angleBetween(n, f.d); if (a < f.ang * 1.8) h += (this.R / Math.cos(a) - h) * smooth(f.ang * 1.8, f.ang, a); }
    const fa = angleBetween(n, this.faceDir);
    if (fa < this.faceA * 1.3) h += (this.R + 0.35 - h) * smooth(this.faceA * 1.3, this.faceA * 1.02, fa) * 0.9;
    return h;
  }
  /** Where your feet go: terrain, or the dock planks over the water. */
  surface(n: THREE.Vector3) {
    const dock = this.onDock(n), ground = this.height(n);
    const cell = this.cellAt(n);
    const top = cell && cell.kind ? Math.max(ground, cell.top) : ground;
    return dock ? Math.max(dock, top) : top;
  }
  /** Which portrait cell a direction falls in (or null outside the picture). */
  cellAt(n: THREE.Vector3) {
    const c = n.dot(this.faceDir);
    if (c < Math.cos(this.faceA * 1.2)) return null;
    const u = Math.atan2(n.dot(this.faceRight), c), v = Math.atan2(n.dot(this.faceUp), c);
    const x = Math.floor((u / this.faceA + 1) * 9), y = Math.floor((1 - v / this.faceA) * 9);
    if (x < 0 || y < 0 || x > 17 || y > 17) return null;
    return this.cells[y * 18 + x];
  }
  private cellDir(x: number, y: number) {
    const u = ((x + 0.5) / 9 - 1) * this.faceA, v = (1 - (y + 0.5) / 9) * this.faceA;
    return this.faceDir.clone().add(this.faceRight.clone().multiplyScalar(Math.tan(u))).add(this.faceUp.clone().multiplyScalar(Math.tan(v))).normalize();
  }
  private buildCells(mask: readonly string[] | undefined) {
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && mask?.[y]?.[x] === "#";
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) {
      const mx = x - 1, my = y - 1;
      let kind = on(mx, my) ? 1 : 0;
      if (!kind) for (let dy = -1; dy <= 1 && !kind; dy++) for (let dx = -1; dx <= 1; dx++) if (on(mx + dx, my + dy)) { kind = 2; break; }
      this.cells.push({ kind, top: 0 });
    }
  }
  private onDock(n: THREE.Vector3): number {
    for (const d of this.docks) {
      const p = n.clone().multiplyScalar(this.R).applyMatrix4(d.inv);
      if (Math.abs(p.x) < d.halfW && p.z > -0.6 && p.z < d.len) return this.water + 0.55;
    }
    return 0;
  }
  walkable(n: THREE.Vector3) { return this.onDock(n) > 0 || this.height(n) > this.water + 0.25; }

  private buildGround(detail?: number, hull?: boolean) {
    const job = this.groundJob(detail, hull);
    for (;;) { const step = job.next(); if (step.done) return step.value; }
  }
  private *groundJob(detail = Math.round(this.spec.R * 1.25), hull = true): Generator<void, THREE.Mesh> {
    const { theme, R } = this.spec;
    const base = new THREE.IcosahedronGeometry(1, detail);
    const geometry = weldPositions(base.getAttribute("position"), 1e-4);
    base.dispose();
    yield;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      n.fromBufferAttribute(pos, i).normalize();
      n.multiplyScalar(this.height(n));
      pos.setXYZ(i, n.x, n.y, n.z);
      if (i % 2000 === 1999) yield;
    }
    geometry.computeVertexNormals();
    yield;
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3), c = new THREE.Color(), tmp = new THREE.Color(), dir = new THREE.Vector3(), nrm = new THREE.Vector3();
    const r = mulberry32(this.spec.seed ^ 0xc0102);
    const grass = theme.grass.map(g => new THREE.Color(g)), patch = randomDir(r), patch2 = randomDir(r), foam = new THREE.Color("#ffffff");
    const shore = new THREE.Color(theme.shore), bed = new THREE.Color(shade(theme.shore, 0.7)), plaza = new THREE.Color(theme.plaza), path = new THREE.Color(theme.path), rock = new THREE.Color(theme.rock);
    for (let i = 0; i < pos.count; i++) {
      dir.fromBufferAttribute(pos, i);
      const h = dir.length(); dir.normalize();
      nrm.fromBufferAttribute(normals, i);
      const slope = 1 - nrm.dot(dir);
      // Grass: two shades in soft patches, a few lighter speckles.
      const k = Math.sin(dir.dot(patch) * 7) + Math.sin(dir.dot(patch2) * 11) * 0.6;
      c.copy(grass[0]).lerp(grass[1], THREE.MathUtils.smoothstep(k, 0.2, 0.9));
      if (r() < 0.08) c.lerp(grass[2], 0.6);
      if (slope > 0.12 || h > R + 2.8) c.lerp(rock, THREE.MathUtils.smoothstep(Math.max(slope * 3, (h - R - 2.8) * 0.8), 0.3, 0.9));
      const pathD = this.pathDistance(dir) * R;
      if (pathD < 1.2) c.lerp(tmp.copy(path).multiplyScalar(0.96 + r() * 0.06), THREE.MathUtils.smoothstep(pathD, 1.2, 0.7));
      const plazaD = angleBetween(dir, this.baseUp) * R;
      if (plazaD < 3.4) c.lerp(tmp.copy(plaza).multiplyScalar(Math.sin(plazaD * 3.2) > 0 ? 1 : 0.94), THREE.MathUtils.smoothstep(plazaD, 3.4, 2.8));
      // Beach, a soft foam line where the water meets the land, and a darker lake bed.
      if (h < this.water + 0.55) c.lerp(shore, THREE.MathUtils.smoothstep(h, this.water + 0.55, this.water + 0.25));
      if (h < this.water - 0.15) c.lerp(bed, THREE.MathUtils.smoothstep(h, this.water - 0.15, this.water - 0.9));
      const foamT = 1 - Math.min(1, Math.abs(h - this.water - 0.02) / 0.14);
      if (foamT > 0) c.lerp(foam, foamT * 0.75);
      // The portrait, so it still shows on the low-detail planet far away.
      const cell = this.cellAt(dir);
      if (cell?.kind === 1) c.set("#23202e"); else if (cell?.kind === 2) c.set("#efe7d6");
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      if (i % 2000 === 1999) yield;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, litMaterial);
    mesh.receiveShadow = true;
    if (hull) { yield; const h = outline(mesh, 0.09); this.detail.push(h); this.group.add(h); }
    return mesh;
  }
  private pathDistance(n: THREE.Vector3) {
    let best = Infinity;
    for (const path of this.paths) for (const p of path) best = Math.min(best, angleBetween(n, p));
    return best;
  }

  private buildPad(lit: Blocks, glow: Blocks, frame: THREE.Matrix4) {
    const { theme } = this.spec;
    lit.at(frame).add(new THREE.CylinderGeometry(3.3, 3.5, 0.5, 20), 0, 0.05, 0, "#6d7280").add(new THREE.CylinderGeometry(2.7, 2.7, 0.52, 20), 0, 0.07, 0, "#8d93a3");
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      lit.box(0.9, 0.54, 0.3, Math.cos(a) * 3.05, 0.07, Math.sin(a) * 3.05, i % 2 ? "#222222" : "#f2ce68", { ry: -a + Math.PI / 2 });
    }
    // A big "H"... for home, a star for visitors.
    lit.box(0.35, 0.54, 1.8, -0.6, 0.08, 0, "#f4f4f4").box(0.35, 0.54, 1.8, 0.6, 0.08, 0, "#f4f4f4").box(1.2, 0.54, 0.3, 0, 0.08, 0, "#f4f4f4");
    glow.at(frame);
    for (const [x, z] of [[-3.1, -3.1], [3.1, -3.1], [-3.1, 3.1], [3.1, 3.1]]) {
      lit.at(frame).box(0.2, 1.1, 0.2, x, 0.55, z, "#555a66");
      glow.box(0.36, 0.36, 0.36, x, 1.25, z, theme.glow);
    }
    lit.at(null); glow.at(null);
  }

  private buildHouse(lit: Blocks, glow: Blocks, frame: THREE.Matrix4) {
    const { theme } = this.spec, wood = shade(theme.trunk, 1.1);
    lit.at(frame)
      .box(5.6, 0.5, 4.8, 0, 0.25, 0, theme.rock)
      .box(5, 3, 4.2, 0, 2, 0, theme.wall)
      .box(5.2, 0.3, 4.4, 0, 3.55, 0, shade(theme.wall, 0.9))
      .box(3.4, 0.35, 5, -1.25, 4.45, 0, theme.roof, { rz: 0.62 })
      .box(3.4, 0.35, 5, 1.25, 4.45, 0, theme.roof, { rz: -0.62 })
      .add(roofGable(), 0, 3.7, 2.05, theme.wall).add(roofGable(), 0, 3.7, -2.05, theme.wall)
      .box(0.7, 1.6, 0.7, 1.5, 5, -0.8, theme.rock)
      .box(1.1, 1.9, 0.2, 0, 1.45, 2.12, wood)
      .box(0.14, 0.14, 0.1, 0.35, 1.45, 2.26, "#f2ce68")
      .box(1.4, 0.18, 0.6, 0, 0.5, 2.6, theme.rock);
    for (const x of [-1.6, 1.6]) {
      lit.box(1.2, 0.14, 0.2, x, 1.55, 2.2, wood).box(1.1, 0.3, 0.3, x, 1.35, 2.3, wood);
      for (let i = 0; i < 3; i++) lit.box(0.26, 0.26, 0.26, x - 0.35 + i * 0.35, 1.62, 2.3, theme.flowers[i % theme.flowers.length]);
      glow.at(frame).box(1, 0.9, 0.12, x, 2.2, 2.12, "#ffe7a3").box(0.12, 0.9, 1, 2.52 * Math.sign(x), 2.2, 0, "#ffe7a3");
    }
    glow.box(0.5, 0.5, 0.12, 0, 4.1, 2.2, "#ffe7a3");
    lit.at(null); glow.at(null);
    const smoke = particles(Array.from({ length: 10 }, () => new THREE.Vector3(1.5, 5.9, -0.8)), { color: "#f4f1ea", size: 0.8, opacity: 0.55, mode: "rise", height: 4.5, speed: 0.12, spread: 1.4 });
    frame.decompose(smoke.position, smoke.quaternion, smoke.scale);
    this.group.add(smoke); this.detail.push(smoke);
  }

  private buildFarm(lit: Blocks, frame: THREE.Matrix4) {
    const { theme } = this.spec, soil = "#7a5236", wood = shade(theme.trunk, 1.15);
    lit.at(frame);
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      const x = gx * 1.9, z = gz * 1.9;
      lit.box(1.6, 0.34, 1.6, x, 0.08, z, soil).box(1.5, 0.06, 0.12, x, 0.26, z - 0.4, shade(soil, 0.85)).box(1.5, 0.06, 0.12, x, 0.26, z + 0.4, shade(soil, 0.85));
      const p = new THREE.Vector3(x, 0.26, z).applyMatrix4(frame);
      const m = frame.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.25, z));
      this.plots.push({ p, frame: m });
    }
    // Fence with a gap facing the plaza (+Z).
    for (let i = -3; i <= 3; i++) {
      for (const [x, z] of [[i * 1.05, -3.3], [-3.3, i * 1.05], [3.3, i * 1.05], [i * 1.05, 3.3]] as const) {
        if (z === 3.3 && Math.abs(x) < 1.2) continue;
        lit.box(0.2, 1, 0.2, x, 0.5, z, wood);
      }
    }
    lit.box(6.6, 0.14, 0.12, 0, 0.72, -3.3, wood).box(0.12, 0.14, 6.6, -3.3, 0.72, 0, wood).box(0.12, 0.14, 6.6, 3.3, 0.72, 0, wood)
      .box(2.3, 0.14, 0.12, -2.2, 0.72, 3.3, wood).box(2.3, 0.14, 0.12, 2.2, 0.72, 3.3, wood);
    // Scarecrow in the back corner.
    lit.box(0.16, 2.4, 0.16, 2.6, 1.2, -2.6, wood).box(1.6, 0.14, 0.14, 2.6, 1.8, -2.6, wood).box(0.8, 0.9, 0.4, 2.6, 1.7, -2.6, theme.accent)
      .box(0.6, 0.6, 0.6, 2.6, 2.5, -2.6, "#f2e2a8").box(0.9, 0.12, 0.9, 2.6, 2.86, -2.6, "#c9a24a").box(0.5, 0.3, 0.5, 2.6, 3.05, -2.6, "#c9a24a");
    lit.at(null);
  }

  private buildDock(lit: Blocks, frame: THREE.Matrix4) {
    const wood = "#b98a58", dark = "#8a6440", top = this.water + 0.55 - (this.R - 0.1);
    lit.at(frame);
    for (let i = 0; i < 8; i++) lit.box(1.7, 0.16, 0.5, 0, top - 0.08, -0.2 + i * 0.55, i % 2 ? wood : shade(wood, 0.93));
    for (const z of [0.6, 2.4, 3.9]) for (const x of [-0.8, 0.8]) lit.box(0.22, 2, 0.22, x, top - 0.9, z, dark);
    lit.box(0.22, 0.9, 0.22, 0.8, top + 0.45, 3.9, dark).box(0.3, 0.3, 0.3, 0.8, top + 0.95, 3.9, "#ed927e");
    // A little bait bucket.
    lit.add(new THREE.CylinderGeometry(0.28, 0.22, 0.4, 8), -0.5, top + 0.2, 3.3, "#7db4db");
    lit.at(null);
  }

  private buildPondDecor(lit: Blocks, pondN: THREE.Vector3) {
    const r = this.rand, { theme } = this.spec;
    for (let i = 0; i < 7; i++) {
      const a = r() * TAU, off = 1.6 + r() * 4;
      const n = pondN.clone().add(tangentAt(pondN, a).multiplyScalar(off / this.R)).normalize();
      if (this.height(n) > this.water - 0.1) continue;
      lit.at(surfaceFrame(n, null, this.water + 0.03, r() * TAU)).add(new THREE.CylinderGeometry(0.45 + r() * 0.2, 0.45, 0.05, 9), 0, 0, 0, "#5fae57");
      if (r() < 0.4) lit.box(0.2, 0.2, 0.2, 0.15, 0.12, 0, theme.flowers[i % theme.flowers.length]);
    }
    // Reeds around the rim.
    for (let i = 0; i < 24; i++) {
      const a = r() * TAU, off = 5.4 + r() * 2;
      const n = pondN.clone().add(tangentAt(pondN, a).multiplyScalar(off / this.R)).normalize(), h = this.height(n);
      if (h < this.water - 0.3 || h > this.water + 0.8) continue;
      lit.at(surfaceFrame(n, null, h, r() * TAU));
      for (let k = 0; k < 3; k++) lit.box(0.08, 1 + r() * 0.8, 0.08, (r() - 0.5) * 0.5, 0.5, (r() - 0.5) * 0.5, "#7f9a45", { rz: (r() - 0.5) * 0.3 });
      lit.box(0.14, 0.4, 0.14, 0, 1.3, 0, "#7a4a2e");
    }
    lit.at(null);
  }

  private buildArena(lit: Blocks, glow: Blocks, frame: THREE.Matrix4, sport: Sport) {
    const { theme } = this.spec;
    lit.at(frame);
    if (sport === "goal") {
      // A little pitch: striped grass, penalty box lines, goal with net.
      for (let i = 0; i < 6; i++) lit.box(8, 0.5, 1.8, 0, -0.2, -5 + i * 1.8, i % 2 ? "#6fc25a" : "#62b44f");
      lit.box(8, 0.1, 0.12, 0, 0.05, -4.6, "#ffffff").box(0.12, 0.1, 3.4, -3.2, 0.05, -2.9, "#ffffff").box(0.12, 0.1, 3.4, 3.2, 0.05, -2.9, "#ffffff")
        .box(6.4, 0.1, 0.12, 0, 0.05, -1.2, "#ffffff").box(0.4, 0.1, 0.4, 0, 0.05, 1.8, "#ffffff");
      lit.box(0.2, 2.3, 0.2, -2.6, 1.15, -4.7, "#ffffff").box(0.2, 2.3, 0.2, 2.6, 1.15, -4.7, "#ffffff").box(5.4, 0.2, 0.2, 0, 2.3, -4.7, "#ffffff");
      // The net: a grid of thin cords on the back, sides and top.
      const cord = "#e8ebf2";
      for (let x = -2.6; x <= 2.61; x += 0.52) lit.box(0.04, 2.2, 0.04, x, 1.1, -5.9, cord).box(0.04, 0.04, 1.2, x, 2.2, -5.3, cord);
      for (let y = 0.2; y <= 2.21; y += 0.5) lit.box(5.2, 0.04, 0.04, 0, y, -5.9, cord).box(0.04, 0.04, 1.2, -2.6, y, -5.3, cord).box(0.04, 0.04, 1.2, 2.6, y, -5.3, cord);
      for (let z = -5.9; z <= -4.7; z += 0.4) lit.box(0.04, 2.2, 0.04, -2.6, 1.1, z, cord).box(0.04, 2.2, 0.04, 2.6, 1.1, z, cord).box(5.2, 0.04, 0.04, 0, 2.2, z, cord);
      this.colliders.push({ p: new THREE.Vector3(-2.6, 0, -4.7).applyMatrix4(frame), r: 0.4 }, { p: new THREE.Vector3(2.6, 0, -4.7).applyMatrix4(frame), r: 0.4 }, { p: new THREE.Vector3(0, 0, -5.5).applyMatrix4(frame), r: 1.2 });
    } else if (sport === "tennis") {
      lit.box(6.4, 0.5, 11.4, 0, -0.16, 0, "#5f9fd6").box(7.4, 0.5, 12.4, 0, -0.2, 0, "#6fbf6a");
      for (const x of [-3.1, 3.1]) lit.box(0.1, 0.14, 11, x, 0.06, 0, "#ffffff");
      for (const z of [-5.5, 5.5]) lit.box(6.3, 0.14, 0.1, 0, 0.06, z, "#ffffff");
      lit.box(0.1, 0.14, 6, 0, 0.06, 0, "#ffffff").box(6.3, 0.14, 0.1, 0, 0.06, -3, "#ffffff").box(6.3, 0.14, 0.1, 0, 0.06, 3, "#ffffff");
      lit.box(0.14, 1.1, 0.14, -3.5, 0.55, 0, "#444444").box(0.14, 1.1, 0.14, 3.5, 0.55, 0, "#444444").box(7, 0.8, 0.04, 0, 0.6, 0, "#eeeeee").box(7, 0.12, 0.08, 0, 1.02, 0, "#ffffff");
      this.colliders.push({ p: new THREE.Vector3(-3.5, 0, 0).applyMatrix4(frame), r: 0.3 }, { p: new THREE.Vector3(3.5, 0, 0).applyMatrix4(frame), r: 0.3 });
    } else {
      // Boxing ring: raised canvas, corner posts, three ropes.
      lit.box(7, 0.8, 7, 0, 0.4, 0, "#3a3f55").box(6.6, 0.1, 6.6, 0, 0.84, 0, "#f4f1ea");
      const posts: [number, number, string][] = [[-3.2, -3.2, "#e8543f"], [3.2, -3.2, "#5a8fd6"], [-3.2, 3.2, "#f2f2f2"], [3.2, 3.2, "#f2f2f2"]];
      for (const [x, z, c] of posts) lit.box(0.3, 2, 0.3, x, 1.8, z, c);
      for (const y of [1.4, 1.9, 2.4]) {
        lit.box(6.4, 0.08, 0.08, 0, y, -3.2, theme.accent).box(6.4, 0.08, 0.08, 0, y, 3.2, theme.accent)
          .box(0.08, 0.08, 6.4, -3.2, y, 0, theme.accent).box(0.08, 0.08, 6.4, 3.2, y, 0, theme.accent);
      }
      lit.box(1.4, 0.4, 0.6, 0, 0.2, 3.9, "#6d7280").box(1.4, 0.2, 0.6, 0, 0.5, 4.3, "#6d7280");
      glow.at(frame).box(0.5, 0.5, 0.5, -3.2, 2.9, -3.2, theme.glow).box(0.5, 0.5, 0.5, 3.2, 2.9, -3.2, theme.glow);
      glow.at(null);
    }
    lit.at(null);
  }

  private buildPlaza(lit: Blocks, glow: Blocks, plaza: THREE.Vector3, padN: THREE.Vector3) {
    const { theme, home } = this.spec, R = this.R;
    const frame = surfaceFrame(plaza, padN, R);
    lit.at(frame);
    if (home) {
      // Campfire with logs to sit on.
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; lit.add(new THREE.DodecahedronGeometry(0.3, 0), Math.cos(a) * 0.9, 0.15, Math.sin(a) * 0.9, theme.rockDark); }
      lit.box(1.1, 0.22, 0.22, 0, 0.2, 0, "#7a4a2e", { ry: 0.6 }).box(1.1, 0.22, 0.22, 0, 0.2, 0, "#6a3e26", { ry: -0.6 });
      for (const a of [0.9, 2.9, 4.7]) lit.box(1.5, 0.4, 0.45, Math.cos(a) * 2.2, 0.2, Math.sin(a) * 2.2, "#b07a48", { ry: -a + Math.PI / 2 });
      const flame = new Blocks().add(new THREE.ConeGeometry(0.5, 1.2, 8), 0, 0.6, 0, "#ff9a3c", { smooth: true }).add(new THREE.ConeGeometry(0.28, 0.85, 8), 0.05, 0.5, 0.08, "#fff1a8", { smooth: true }).mesh(glowMaterial);
      const fm = new THREE.Matrix4().copy(frame).multiply(new THREE.Matrix4().makeTranslation(0, 0.2, 0));
      fm.decompose(flame.position, flame.quaternion, flame.scale);
      this.flame = flame; this.group.add(flame);
      const sparks = particles(Array.from({ length: 26 }, () => new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4)), { color: "#ffb347", size: 0.13, additive: true, mode: "rise", height: 3.2, speed: 0.55, spread: 0.6 });
      frame.decompose(sparks.position, sparks.quaternion, sparks.scale);
      this.group.add(sparks); this.detail.push(sparks);
      this.campfire = plaza.clone().multiplyScalar(R);
      this.colliders.push({ p: plaza.clone().multiplyScalar(R), r: 1.1 });
    } else {
      // A fountain.
      lit.add(new THREE.CylinderGeometry(1.8, 1.9, 0.6, 12), 0, 0.3, 0, theme.plaza === theme.rock ? theme.rockDark : theme.rock)
        .add(new THREE.CylinderGeometry(1.5, 1.5, 0.62, 12), 0, 0.33, 0, theme.water)
        .add(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 8), 0, 1, 0, theme.rock)
        .add(new THREE.CylinderGeometry(0.8, 0.5, 0.3, 10), 0, 1.8, 0, theme.rock);
      glow.at(frame).add(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 10), 0, 1.96, 0, "#dff6ff");
      this.colliders.push({ p: plaza.clone().multiplyScalar(R), r: 2 });
    }
    lit.at(null); glow.at(null);
  }

  private buildPathLamps(lit: Blocks, glow: Blocks) {
    const { theme } = this.spec;
    for (const path of this.paths) {
      for (const k of [5, 10]) {
        if (k >= path.length) continue;
        const n = path[k], side = new THREE.Vector3().crossVectors(n, path[Math.min(k + 1, path.length - 1)].clone().sub(n)).normalize();
        const m = n.clone().add(side.multiplyScalar(1.5 / this.R)).normalize(), h = this.height(m);
        if (h < this.water + 0.4 || this.blocked(m, 1.2)) continue;
        const frame = surfaceFrame(m, null, h);
        lit.at(frame).box(0.18, 2.2, 0.18, 0, 1.1, 0, "#4a4f5c").box(0.5, 0.12, 0.5, 0, 2.2, 0, "#4a4f5c").box(0.5, 0.12, 0.5, 0, 2.75, 0, "#4a4f5c");
        glow.at(frame).box(0.4, 0.45, 0.4, 0, 2.48, 0, theme.glow);
        this.colliders.push({ p: m.clone().multiplyScalar(h), r: 0.35 });
      }
    }
    lit.at(null); glow.at(null);
  }

  private blocked(n: THREE.Vector3, radius: number) {
    const p = n.clone().multiplyScalar(this.R);
    for (const s of this.stations) if (p.distanceTo(s.pos) < s.flat + radius + 0.8) return true;
    if (angleBetween(n, this.baseUp) < 4 / this.R) return true;
    if (angleBetween(n, this.faceDir) < this.faceA * 1.2 + radius / this.R) return true;
    for (const c of this.colliders) if (p.distanceTo(c.p) < c.r + radius) return true;
    return false;
  }

  /** Trees, rocks, flowers and glowing things all over the planet. */
  private *scatter(lit: Blocks, glow: Blocks): Generator<void, void> {
    const { theme, R } = this.spec, r = this.rand;
    const area = R * R;
    const self = this;
    function* place(count: number, radius: number, draw: (frame: THREE.Matrix4, size: number, n: THREE.Vector3) => void, opts: { solid?: boolean; night?: boolean } = {}): Generator<void, void> {
      for (let placed = 0, tries = 0; placed < count && tries < count * 15; tries++) {
        if (tries % 4 === 3) yield;
        const n = randomDir(r);
        if (opts.night && n.dot(SUN_DIR) > 0.1) continue;
        const h = self.height(n);
        if (h < self.water + 0.45) continue;
        if (self.paths.some(path => nearPath(n, path, (1.3 + radius) / R))) continue;
        if (self.blocked(n, radius)) continue;
        const size = 0.8 + r() * 0.5;
        const frame = surfaceFrame(n, null, h - 0.05, r() * TAU);
        draw(frame, size, n);
        if (opts.solid !== false) self.colliders.push({ p: n.clone().multiplyScalar(h), r: radius * size });
        placed++;
      }
    }
    const treeKinds: TreeKind[] = theme.extra ? [theme.tree, theme.tree, theme.extra] : [theme.tree];
    yield* place(Math.round(area * 0.075), 0.7, (frame, s) => this.tree(lit, glow, frame, s, treeKinds[Math.floor(r() * treeKinds.length)]));
    yield* place(Math.round(area * 0.03), 0.8, (frame, s) => {
      const a = 0.85 * s, b = 0.45 * s;
      lit.at(frame).add(UNIT.dodeca(1), 0, 0.3 * s, 0, theme.rock, { sx: a, sy: a * 0.7, sz: a, ry: r() * 3, smooth: true })
        .add(UNIT.dodeca(1), 0.75 * s, 0.15, 0.3, theme.rockDark, { sx: b, sy: b * 0.75, sz: b, smooth: true });
    });
    // Bushes: little clusters of round leaves.
    yield* place(Math.round(area * 0.05), 0.6, (frame, s) => {
      const leaf = theme.leaf[Math.floor(r() * theme.leaf.length)];
      const ball = (k: number) => ({ sx: k, sy: k, sz: k, smooth: true });
      lit.at(frame).add(UNIT.ico(2), 0, 0.4 * s, 0, leaf, ball(0.62 * s))
        .add(UNIT.ico(2), 0.55 * s, 0.3 * s, 0.1, shade(leaf, 1.08), ball(0.46 * s))
        .add(UNIT.ico(2), -0.45 * s, 0.28 * s, -0.2, shade(leaf, 0.94), ball(0.4 * s));
      if (r() < 0.5) lit.add(UNIT.ico(1), 0.2, 0.85 * s, 0.35, theme.flowers[0], ball(0.12));
    });
    yield* place(Math.round(area * 0.22), 0.35, (frame, s) => {
      lit.at(frame);
      const color = theme.flowers[Math.floor(r() * theme.flowers.length)];
      for (let i = 0; i < 3; i++) {
        const x = (r() - 0.5) * 1.1, z = (r() - 0.5) * 1.1, h = 0.35 + r() * 0.3;
        const k = 0.15 * s;
        lit.box(0.05, h, 0.05, x, h / 2, z, theme.leaf[0]).add(UNIT.ico(1), x, h + 0.05, z, color, { sx: k, sy: k * 0.7, sz: k, smooth: true })
          .add(UNIT.ico(0), x, h + 0.14, z, "#fff4c2", { sx: 0.06, sy: 0.06, sz: 0.06, smooth: true });
      }
    }, { solid: false });
    // The night side glows: crystals, glowcaps or lanterns in the planet's colour.
    yield* place(Math.round(area * 0.03), 0.6, (frame, s) => this.nightGlow(lit, glow, frame, s), { night: true });
    lit.at(null); glow.at(null);
  }

  private nightGlow(lit: Blocks, glow: Blocks, frame: THREE.Matrix4, s: number) {
    const { theme } = this.spec, r = this.rand;
    const kind = this.spec.family % 3;
    if (kind === 0) {
      glow.at(frame);
      for (let i = 0; i < 3; i++) glow.add(new THREE.CylinderGeometry(0.22 * s, 0.26 * s, (1.2 + r()) * s, 6), (r() - 0.5) * 0.7, 0.6 * s, (r() - 0.5) * 0.7, theme.glow, { rx: (r() - 0.5) * 0.6, rz: (r() - 0.5) * 0.6 });
    } else if (kind === 1) {
      lit.at(frame).add(new THREE.CylinderGeometry(0.14, 0.18, 0.8 * s, 6), 0, 0.4 * s, 0, "#f4efe2");
      glow.at(frame).add(new THREE.SphereGeometry(0.55 * s, 8, 4, 0, TAU, 0, Math.PI / 2), 0, 0.78 * s, 0, theme.glow);
    } else {
      lit.at(frame).box(0.12, 1.4 * s, 0.12, 0, 0.7 * s, 0, "#4a4f5c");
      glow.at(frame).box(0.45 * s, 0.55 * s, 0.45 * s, 0, 1.55 * s, 0, theme.glow);
    }
  }

  private tree(lit: Blocks, glow: Blocks, frame: THREE.Matrix4, s: number, kind: TreeKind) {
    const { theme } = this.spec, r = this.rand, leaf = theme.leaf[Math.floor(r() * theme.leaf.length)];
    const soft = { smooth: true };
    lit.at(frame);
    switch (kind) {
      case "pine":
        lit.add(new THREE.CylinderGeometry(0.2 * s, 0.32 * s, 1.4 * s, 8), 0, 0.7 * s, 0, theme.trunk)
          .add(new THREE.ConeGeometry(1.55 * s, 2.1 * s, 14), 0, 2 * s, 0, leaf, soft)
          .add(new THREE.ConeGeometry(1.2 * s, 1.8 * s, 14), 0, 3.05 * s, 0, shade(leaf, 1.08), soft)
          .add(new THREE.ConeGeometry(0.8 * s, 1.4 * s, 14), 0, 4 * s, 0, shade(leaf, 1.16), soft);
        if (theme.snow) lit.add(new THREE.ConeGeometry(0.46 * s, 0.62 * s, 14), 0, 4.45 * s, 0, "#ffffff", soft).add(new THREE.CylinderGeometry(0.9 * s, 1.25 * s, 0.22 * s, 14), 0, 3.02 * s, 0, "#ffffff", soft);
        break;
      case "round": case "apple": case "autumn": {
        lit.add(new THREE.CylinderGeometry(0.22 * s, 0.36 * s, 2.3 * s, 8), 0, 1.15 * s, 0, theme.trunk)
          .box(0.9 * s, 0.14 * s, 0.14 * s, 0.35 * s, 1.7 * s, 0, theme.trunk, { rz: 0.6 });
        const blobs: [number, number, number, number][] = [[0, 3, 0, 1.35], [0.85, 2.65, 0.25, 0.95], [-0.8, 2.7, -0.35, 1], [0.15, 3.75, -0.2, 0.9], [-0.25, 2.55, 0.8, 0.8]];
        blobs.forEach(([x, y, z, rad], i) => lit.add(new THREE.IcosahedronGeometry(rad * s, 2), x * s, y * s, z * s, i % 2 ? shade(leaf, 1.07) : leaf, soft));
        if (kind === "apple") for (let i = 0; i < 6; i++) { const a = r() * TAU, y = 2.4 + r() * 1.3; lit.add(new THREE.IcosahedronGeometry(0.17 * s, 1), Math.cos(a) * 1.3 * s, y * s, Math.sin(a) * 1.3 * s, "#e8543f", soft); }
        break;
      }
      case "palm": {
        let x = 0, y = 0;
        for (let i = 0; i < 7; i++) { lit.add(new THREE.CylinderGeometry(0.2 * s, 0.26 * s, 0.7 * s, 8), x, y + 0.35 * s, 0, i % 2 ? theme.trunk : shade(theme.trunk, 1.12), { rz: -0.07 * i }); x += 0.07 * i * s; y += 0.66 * s; }
        for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; lit.add(new THREE.SphereGeometry(1, 10, 6), x + Math.cos(a) * 1.05 * s, y - 0.2 * s, Math.sin(a) * 1.05 * s, i % 2 ? leaf : shade(leaf, 1.1), { sx: 1.3 * s, sy: 0.12 * s, sz: 0.36 * s, ry: -a, rz: -0.45, smooth: true }); }
        lit.add(new THREE.IcosahedronGeometry(0.2 * s, 1), x + 0.2, y - 0.35 * s, 0.1, "#8a5a3a", soft).add(new THREE.IcosahedronGeometry(0.2 * s, 1), x - 0.2, y - 0.4 * s, -0.15, "#8a5a3a", soft);
        break;
      }
      case "candy":
        lit.add(new THREE.CylinderGeometry(0.1 * s, 0.1 * s, 2.6 * s, 8), 0, 1.3 * s, 0, "#ffffff")
          .add(new THREE.IcosahedronGeometry(1.1 * s, 2), 0, 3.1 * s, 0, leaf, soft)
          .add(new THREE.TorusGeometry(0.72 * s, 0.13 * s, 8, 20), 0, 3.1 * s, 0.62 * s, "#ffffff", soft)
          .add(new THREE.TorusGeometry(0.35 * s, 0.12 * s, 8, 16), 0, 3.1 * s, 0.9 * s, shade(leaf, 0.85), soft);
        break;
      case "mushroom": {
        const cap = leaf === theme.leaf[0] ? "#e8543f" : shade(theme.accent, 0.85);
        lit.add(new THREE.CylinderGeometry(0.34 * s, 0.48 * s, 2 * s, 12), 0, 1 * s, 0, "#f4efe2", soft)
          .add(new THREE.SphereGeometry(1.45 * s, 18, 8, 0, TAU, 0, Math.PI / 2), 0, 1.9 * s, 0, cap, { sy: 0.8, smooth: true });
        for (let i = 0; i < 6; i++) { const a = r() * TAU, rr = 0.5 + r() * 0.6; lit.add(new THREE.IcosahedronGeometry(0.16 * s, 1), Math.cos(a) * rr * s, (1.9 + Math.sqrt(Math.max(0, 1 - rr * rr / 2.1)) * 1.1) * s, Math.sin(a) * rr * s, "#ffffff", soft); }
        break;
      }
      case "crystal":
        glow.at(frame);
        for (let i = 0; i < 4; i++) glow.add(new THREE.CylinderGeometry(0.28 * s, 0.34 * s, (1.8 + r() * 1.4) * s, 6), (r() - 0.5) * s, 1 * s, (r() - 0.5) * s, i % 2 ? theme.glow : "#ffffff", { rx: (r() - 0.5) * 0.7, rz: (r() - 0.5) * 0.7 });
        break;
    }
  }

  // ---- the Friend's portrait: raised black pixels with a white halo ----
  private buildFace() {
    const ink = new Blocks(), halo = new Blocks();
    const cell = (2 * this.faceA / 18) * this.R;
    for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) {
      const c = this.cells[y * 18 + x];
      if (!c.kind) continue;
      const n = this.cellDir(x, y), h = this.height(n), raise = c.kind === 1 ? 0.9 : 0.35;
      c.top = h + raise;
      const frame = surfaceFrame(n, n.clone().add(this.faceUp), h);
      (c.kind === 1 ? ink : halo).at(frame).box(cell * 1.02, raise + 0.9, cell * 1.02, 0, raise / 2 - 0.45, 0, c.kind === 1 ? "#23202e" : "#efe7d6");
    }
    if (!ink.empty) {
      const inkMesh = ink.mesh(toon({ vertexColors: true }));
      inkMesh.castShadow = inkMesh.receiveShadow = true;
      this.group.add(inkMesh);
    }
    if (!halo.empty) {
      // The halo glows faintly, so the portrait still reads on the night side.
      const haloMesh = halo.mesh(toon({ vertexColors: true, emissive: "#fff2d6", emissiveIntensity: 0.1 }));
      haloMesh.receiveShadow = true;
      this.group.add(haloMesh);
    }
  }

  // ---- living details ----
  private buildGrass() {
    const { theme, R } = this.spec, r = mulberry32(this.spec.seed ^ 0x6a55);
    const spots: { m: THREE.Matrix4; color: THREE.Color }[] = [];
    const tufts = Math.round(R * R * (theme.snow ? 0.6 : 2.2));
    const shades = theme.snow ? ["#dfe9f5", "#c9d8ea", "#eef5ff"] : [shade(theme.grass[0], 0.92), shade(theme.grass[1], 0.9), shade(theme.grass[2], 1.02), theme.leaf[0]];
    const q = new THREE.Quaternion(), yaw = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let t = 0, tries = 0; t < tufts && tries < tufts * 6; tries++) {
      const n = randomDir(r), h = this.height(n);
      if (h < this.water + 0.5 || h > R + 3) continue;
      const cell = this.cellAt(n);
      if (cell && cell.kind) continue;
      const pd = this.pathDistance(n) * R, plaza = angleBetween(n, this.baseUp) * R;
      if (pd < 1.3 || plaza < 3.8) continue;
      let inStation = false;
      for (const st of this.stations) if (n.clone().multiplyScalar(R).distanceTo(st.pos) < st.flat + 0.6) { inStation = true; break; }
      if (inStation) continue;
      t++;
      q.setFromUnitVectors(Y, n);
      const blades = 3 + Math.floor(r() * 3);
      const color = new THREE.Color(shades[Math.floor(r() * shades.length)]);
      for (let b = 0; b < blades; b++) {
        const tangent = tangentAt(n, r() * TAU).multiplyScalar(r() * 0.35);
        p.copy(n).multiplyScalar(h - 0.04).add(tangent);
        yaw.setFromAxisAngle(Y, r() * TAU);
        const s = 0.7 + r() * 0.7;
        sc.set(s, s * (0.8 + r() * 0.6), s);
        spots.push({ m: new THREE.Matrix4().compose(p, q.clone().multiply(yaw), sc), color: color.clone().multiplyScalar(0.92 + r() * 0.16) });
      }
    }
    const field = grassField(spots);
    this.group.add(field); this.detail.push(field);
  }

  private buildClouds() {
    const { R } = this.spec, r = mulberry32(this.spec.seed ^ 0xc10d);
    // Clouds glow a little from inside so they read as soft and white, not grey.
    const material = toon({ color: "#ffffff", emissive: "#fff6ee", emissiveIntensity: 0.22 });
    const count = 6 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const b = new Blocks(), puffs = 4 + Math.floor(r() * 3);
      for (let k = 0; k < puffs; k++) {
        const x = (k - (puffs - 1) / 2) * 0.95, big = 1 - Math.abs(x) / (puffs * 0.6);
        b.add(new THREE.IcosahedronGeometry(1, 2), x + (r() - 0.5) * 0.3, big * 0.5 + r() * 0.2, (r() - 0.5) * 0.7, "#ffffff", { sx: 0.8 + big * 0.6, sy: 0.7 + big * 0.5, sz: 0.8 + big * 0.4, smooth: true });
      }
      b.add(new THREE.IcosahedronGeometry(1, 2), 0, -0.25, 0, "#ffffff", { sx: puffs * 0.55, sy: 0.45, sz: 0.9, smooth: true });
      const cloud = new THREE.Mesh(b.build(), material);
      cloud.castShadow = true;
      cloud.position.set(0, R + 8.5 + r() * 4, 0);
      cloud.scale.setScalar(0.9 + r() * 0.8);
      const pivot = new THREE.Group();
      pivot.add(cloud, outline(cloud, 0.06));
      pivot.quaternion.setFromUnitVectors(Y, randomDir(r));
      pivot.userData.axis = randomDir(r);
      pivot.userData.speed = 0.02 + r() * 0.025;
      this.group.add(pivot); this.clouds.push(pivot);
    }
  }

  private buildParticles() {
    const { theme, R } = this.spec, r = mulberry32(this.spec.seed ^ 0xf1ef);
    const night: THREE.Vector3[] = [], day: THREE.Vector3[] = [], sparkle: THREE.Vector3[] = [];
    for (let i = 0; i < 900 && (night.length < 140 || day.length < 80 || sparkle.length < 60); i++) {
      const n = randomDir(r), h = this.height(n), lit = n.dot(SUN_DIR);
      if (h < this.water - 0.1) { if (sparkle.length < 60) sparkle.push(n.clone().multiplyScalar(this.water + 0.08)); continue; }
      if (lit < -0.05 && night.length < 140) night.push(n.clone().multiplyScalar(h + 0.6 + r() * 2.2));
      else if (lit > 0.2 && day.length < 80) day.push(n.clone().multiplyScalar(h + 0.4 + r() * 2.5));
    }
    const add = (p: THREE.Points) => { this.group.add(p); this.detail.push(p); };
    add(particles(night, { color: theme.glow, size: 0.2, additive: true, mode: "drift", spread: 0.8 }));
    add(particles(day, { color: "#fffbe6", size: 0.09, additive: true, opacity: 0.6, mode: "drift", spread: 0.6 }));
    if (sparkle.length) add(particles(sparkle, { color: "#ffffff", size: 0.12, additive: true, mode: "drift", spread: 0.05 }));
    void R;
  }

  private buildRings() {
    const { R, theme } = this.spec;
    const geometry = new THREE.RingGeometry(R * 1.55, R * 2.35, 96, 4);
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute, colors = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i)) / R;
      c.set(Math.floor(d * 7) % 2 ? theme.accent : theme.sky.horizon).multiplyScalar(0.85 + 0.15 * Math.sin(d * 23));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2 + 0.35; mesh.rotation.y = 0.4;
    return mesh;
  }

  private buildMoon(i: number) {
    const { R, theme } = this.spec, r = this.rand;
    const pivot = new THREE.Group();
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(R * (0.14 + r() * 0.08), 3), toon({ color: i ? theme.rock : "#e6e2da" }));
    moon.position.set(R * (2.4 + i * 0.7), 0, 0);
    pivot.add(moon);
    pivot.rotation.set(r() * 0.8, r() * TAU, r() * 0.5);
    pivot.userData.spin = 0.04 + r() * 0.05;
    this.glowBits.push(pivot);
    return pivot;
  }

  setVisitorView(inside: boolean) { this.halo.visible = !inside; }
  private near = true;
  update(dt: number, camera: THREE.Vector3) {
    for (const bit of this.glowBits) bit.rotation.y += dt * (bit.userData.spin ?? 0);
    const d = camera.distanceTo(this.group.position), near = this.built && d < this.R * 7;
    if (near !== this.near) {
      // Far away, one light sphere stands in for the whole planet.
      this.near = near;
      for (const o of this.full) o.visible = near;
      for (const o of this.detail) o.visible = near;
      for (const c of this.clouds) c.visible = near;
      this.lod.visible = !near;
    }
    if (!near) return;
    for (const c of this.clouds) {
      c.rotateOnWorldAxis(c.userData.axis, dt * c.userData.speed);
      // Don't let a cloud sit in front of the camera.
      const cloud = c.children[0];
      const w = cloud.getWorldPosition(new THREE.Vector3());
      c.children.forEach(ch => (ch.visible = w.distanceTo(camera) > 7));
    }
    if (this.flame) {
      const f = 0.9 + Math.sin(TIME.value * 13) * 0.08 + Math.sin(TIME.value * 21) * 0.06;
      this.flame.scale.set(1 + Math.sin(TIME.value * 9) * 0.05, f, 1 + Math.cos(TIME.value * 11) * 0.05);
    }
  }
}

export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.56).normalize();

function randomDir(r: () => number) {
  const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z);
  return new THREE.Vector3(s * Math.cos(a), z, s * Math.sin(a));
}
function tangentAt(n: THREE.Vector3, angle: number) {
  const helper = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(n, helper).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
  return t1.multiplyScalar(Math.cos(angle)).add(t2.multiplyScalar(Math.sin(angle)));
}
function arc(a: THREE.Vector3, b: THREE.Vector3, steps: number) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) out.push(a.clone().lerp(b, i / steps).normalize());
  return out;
}
function nearPath(n: THREE.Vector3, path: THREE.Vector3[], width: number) {
  const limit = Math.cos(width);
  for (const p of path) if (n.dot(p) > limit) return true;
  return false;
}
function roofGable() {
  const shape = new THREE.Shape();
  shape.moveTo(-2.5, 0); shape.lineTo(2.5, 0); shape.lineTo(0, 1.55); shape.lineTo(-2.5, 0);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06);
}
function haloMaterial(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vNormal = normalize(mat3(modelMatrix) * normal); vView = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vView;
      void main(){ float f = 1.0 - abs(dot(vNormal, vView)); gl_FragColor = vec4(uColor, pow(f, 2.6) * 0.4); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}
