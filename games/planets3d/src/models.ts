// Low-poly models, text labels and the Friend billboard.
// Blocks, Label and FriendBillboard are adapted from the "Steal An Egg" FriendSDK
// example (Apache-2.0): merged vertex-coloured geometry, canvas labels, and the
// canonical camera-facing Friend (one-bit mask in black with a white halo).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FACINGS, type Clips, type Facing } from "../sprites";
import { toon } from "./look";

/** Soft cel shading for everything solid; glowing bits are brighter than white so they bloom. */
export const litMaterial = toon({ vertexColors: true });
export const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
glowMaterial.color.setScalar(1.7);
const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion(), tmpPos = new THREE.Vector3(), tmpScale = new THREE.Vector3();

/**
 * Unit shapes built once and copied (copying is far cheaper than rebuilding a
 * shape for each of the thousands of flowers and leaves on a planet). Size them
 * with sx / sy / sz.
 */
const shared = new Map<string, THREE.BufferGeometry>();
function sharedShape(key: string, make: () => THREE.BufferGeometry) {
  let g = shared.get(key);
  if (!g) {
    const built = make();
    g = built.index ? built.toNonIndexed() : built;
    if (g !== built) built.dispose();
    g.deleteAttribute("uv"); g.userData.shared = true;
    shared.set(key, g);
  }
  return g;
}
export const UNIT = {
  box: () => sharedShape("box", () => new THREE.BoxGeometry(1, 1, 1)),
  ico: (detail: number) => sharedShape("ico" + detail, () => new THREE.IcosahedronGeometry(1, detail)),
  dodeca: (detail: number) => sharedShape("dodeca" + detail, () => new THREE.DodecahedronGeometry(1, detail)),
};

type BoxOptions = { rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; smooth?: boolean };
export class Blocks {
  private parts: THREE.BufferGeometry[] = [];
  private frame: THREE.Matrix4 | null = null;
  /** Everything added until the next call is placed in this frame (e.g. standing on a planet). */
  at(frame: THREE.Matrix4 | null) { this.frame = frame; return this; }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, options: BoxOptions = {}) {
    return this.add(UNIT.box(), x, y, z, color, { ...options, sx: w * (options.sx ?? 1), sy: h * (options.sy ?? 1), sz: d * (options.sz ?? 1) });
  }
  add(geometry: THREE.BufferGeometry, x: number, y: number, z: number, color: string, options: BoxOptions = {}) {
    let source: THREE.BufferGeometry;
    if (geometry.userData.shared) source = geometry.clone();
    else {
      source = geometry.index ? geometry.toNonIndexed() : geometry;
      if (source !== geometry) geometry.dispose();
      source.deleteAttribute("uv");
    }
    // Scale, then rotate, then move, then into the frame: one matrix, one pass over the vertices.
    tmpScale.set(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
    tmpQuat.setFromEuler(tmpEuler.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0));
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale);
    if (this.frame) tmpMatrix.premultiply(this.frame);
    // Smooth parts keep their rounded normals; everything else is faceted.
    const faceted = !options.smooth || !source.getAttribute("normal");
    if (faceted) source.deleteAttribute("normal");
    source.applyMatrix4(tmpMatrix);
    if (faceted) source.computeVertexNormals();
    tmpColor.set(color);
    const count = source.getAttribute("position").count, colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = tmpColor.r; colors[i * 3 + 1] = tmpColor.g; colors[i * 3 + 2] = tmpColor.b; }
    source.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(source);
    return this;
  }
  get empty() { return this.parts.length === 0; }
  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false)!;
    for (const part of this.parts) part.dispose();
    this.parts = [];
    return merged;
  }
  mesh(material: THREE.Material = litMaterial) { return new THREE.Mesh(this.build(), material); }
}

// ---- Text labels (canvas sprites) ----
export type LabelLine = { text: string; color?: string; size?: number };
export class Label {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private key = "";
  constructor(private worldHeightPerLine = 0.55) {
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false }));
    this.sprite.renderOrder = 5;
  }
  /** box: draw as a speech bubble (paper box, ink text) instead of outlined text. */
  set(lines: readonly LabelLine[], box = false) {
    const key = JSON.stringify(lines) + box;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext("2d")!, font = (size: number) => `800 ${size}px Archivo, system-ui, sans-serif`;
    // Archivo sits smaller in its em box than the old pixel font: draw a little larger to match.
    const sizes = lines.map(line => (line.size ?? 40) * (box ? 1.35 : 1.15));
    let width = 8;
    lines.forEach((line, i) => { ctx.font = font(sizes[i]); width = Math.max(width, ctx.measureText(line.text).width + (box ? 44 : 28)); });
    const height = sizes.reduce((sum, size) => sum + size * 1.25, 0) + (box ? 26 : 10);
    this.canvas.width = Math.ceil(width); this.canvas.height = Math.ceil(height);
    ctx.clearRect(0, 0, width, height); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    if (box) {
      // Speech bubble: a soft cream pill with a gentle shadow, like the HUD's chalk-white buttons.
      ctx.save();
      ctx.shadowColor = "rgba(6, 8, 20, 0.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = "rgba(247, 244, 236, 0.96)";
      ctx.beginPath(); ctx.roundRect(4, 3, width - 14, height - 12, Math.min(26, (height - 12) / 2)); ctx.fill();
      ctx.restore();
    }
    let y = 5;
    lines.forEach((line, i) => {
      ctx.font = font(sizes[i]); y += sizes[i] * 0.625;
      if (box) { ctx.fillStyle = line.color === "#111111" || !line.color ? "#16171f" : line.color; ctx.fillText(line.text, (width - 6) / 2, y - 3); }
      else {
        ctx.lineWidth = Math.max(5, sizes[i] * 0.18); ctx.strokeStyle = "rgba(16, 17, 28, 0.88)"; ctx.strokeText(line.text, width / 2, y);
        ctx.fillStyle = line.color ?? "#f7f4ec"; ctx.fillText(line.text, width / 2, y);
      }
      y += sizes[i] * 0.625;
    });
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite.material.map = this.texture; this.sprite.material.needsUpdate = true;
    const worldHeight = this.worldHeightPerLine * (height / 50);
    this.sprite.scale.set(worldHeight * (this.canvas.width / this.canvas.height), worldHeight, 1);
    this.sprite.center.set(0.5, 0);
  }
  dispose() { this.texture.dispose(); this.sprite.material.dispose(); }
}

// ---- A Rare Friend as a camera-facing billboard built from its canonical 16×16 frames ----
const CELL = 18, SCALE = 4;
export const FRIEND_SIZE = 2.4;
/** Height of the top of a Friend's head above its feet, from its idle frame. */
export function headTop(clips: Clips, size = FRIEND_SIZE) {
  const rows = clips.idle.down[0], first = Math.max(0, rows.findIndex(line => line.includes("#")));
  return size - size / CELL - (first + 1) * size / CELL;
}
export class FriendBillboard {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private texture: THREE.CanvasTexture;
  constructor(clips: Clips, size = FRIEND_SIZE) {
    const canvas = document.createElement("canvas");
    canvas.width = CELL * SCALE * 16; canvas.height = CELL * SCALE * 4;
    const ctx = canvas.getContext("2d")!;
    FACINGS.forEach((facing, row) => {
      for (let column = 0; column < 16; column++) {
        const walking = column >= 8, clip = clips[walking ? "walk" : "idle"][facing], rows = clip[(column % 8) % clip.length];
        const ox = column * CELL * SCALE + SCALE, oy = row * CELL * SCALE + SCALE;
        // Canonical treatment: unmodified one-bit mask in black with a one-pixel white halo.
        ctx.fillStyle = "#ffffff";
        rows.forEach((line, y) => [...line].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(ox + (x - 1) * SCALE, oy + (y - 1) * SCALE, SCALE * 3, SCALE * 3); }));
        ctx.fillStyle = "#000000";
        rows.forEach((line, y) => [...line].forEach((pixel, x) => { if (pixel === "#") ctx.fillRect(ox + x * SCALE, oy + y * SCALE, SCALE, SCALE); }));
      }
    });
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.repeat.set(1 / 16, 1 / 4);
    const geometry = new THREE.PlaneGeometry(size, size); geometry.translate(0, size / 2 - size / CELL, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.group.add(this.mesh);
    this.show("down", false, 0);
  }
  show(facing: Facing, walking: boolean, frame: number) {
    const row = FACINGS.indexOf(facing), column = (walking ? 8 : 0) + (frame % 8);
    this.texture.offset.set(column / 16, 1 - (row + 1) / 4);
  }
  /** `relative` is the heading relative to the camera's view direction (0 = walking away from the camera). */
  update(relative: number, walking: boolean, frame: number, cameraPitch: number) {
    const turn = Math.atan2(Math.sin(relative), Math.cos(relative));
    const facing: Facing = Math.abs(turn) < Math.PI / 4 ? "up" : Math.abs(turn) > Math.PI * 3 / 4 ? "down" : turn > 0 ? "left" : "right";
    this.show(facing, walking, frame);
    this.mesh.rotation.set(-cameraPitch * 0.5, 0, 0);
  }
  dispose() { this.texture.dispose(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export function blobShadow(radius: number) {
  const geometry = new THREE.CircleGeometry(radius, 18); geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22, depthWrite: false }));
  mesh.renderOrder = 1;
  return mesh;
}
