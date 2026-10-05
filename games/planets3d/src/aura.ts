/**
 * Auras (premium cosmetic): a soft glowing ring on the ground around a Friend
 * and a few sparkles drifting up through it. Bright enough to bloom; cheap
 * (two meshes and a dozen points). The group's +Y is the ground normal.
 */
import * as THREE from "three";

const SPARKS = 14, HEIGHT = 2.3;
const RING = new THREE.RingGeometry(0.72, 0.9, 48).rotateX(-Math.PI / 2);
const DISC = new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2);

export class Aura {
  readonly group = new THREE.Group();
  private sparks: THREE.Points;
  private ring: THREE.Mesh;
  private seeds: { a: number; r: number; y: number; v: number }[] = [];
  constructor(color: string, sparkle: string) {
    // Keep the hue: a slightly-over-one colour still blooms when bloom is on, without washing out to white.
    this.ring = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.15), transparent: true, opacity: 0.95, depthWrite: false }));
    this.ring.position.y = 0.05;
    const disc = new THREE.Mesh(DISC, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.28, depthWrite: false }));
    disc.position.y = 0.04;
    const pos = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) this.seeds.push({ a: Math.random() * Math.PI * 2, r: 0.45 + Math.random() * 0.45, y: Math.random() * HEIGHT, v: 0.45 + Math.random() * 0.5 });
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(sparkle), size: 0.17, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    this.ring.renderOrder = disc.renderOrder = this.sparks.renderOrder = 3;
    this.group.add(disc, this.ring, this.sparks);
    this.update(0, 0);
  }
  update(dt: number, time: number) {
    this.ring.scale.setScalar(1 + Math.sin(time * 2.4) * 0.05);
    const pos = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    this.seeds.forEach((s, i) => {
      s.y += s.v * dt; if (s.y > HEIGHT) s.y -= HEIGHT;
      const a = s.a + time * 0.6;
      pos.setXYZ(i, Math.cos(a) * s.r, s.y, Math.sin(a) * s.r);
    });
    pos.needsUpdate = true;
  }
  dispose() {
    this.group.removeFromParent();
    this.sparks.geometry.dispose();
    for (const o of this.group.children) ((o as THREE.Mesh).material as THREE.Material).dispose();
  }
}
