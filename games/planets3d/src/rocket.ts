/**
 * Your rocket: a chunky low-poly ship that stands on its pad (door facing the
 * plaza), and the cockpit you sit in when you fly — seat, dashboard, throttle,
 * a radar screen and a big window onto space. The cockpit is its own little
 * scene drawn over the world, so it is always crisp and never clips.
 */
import * as THREE from "three";
import { Blocks, glowMaterial, litMaterial } from "./models";
import { burst, inked, particles } from "./look";

/** Where the ramp meets the ground and where the door is, in the rocket's own frame. */
export const RAMP_FOOT = new THREE.Vector3(0, 0.3, 3.35);
export const DOOR_SPOT = new THREE.Vector3(0, 2.1, 1.1);

export class RocketModel {
  readonly group = new THREE.Group();
  readonly flame: THREE.Mesh;
  readonly dust: THREE.Points;
  private flameCore: THREE.Mesh;
  private body = new THREE.Group();
  private door = new THREE.Group();
  private ramp = new THREE.Group();
  private heat: THREE.Mesh;
  private squash = 0;
  constructor(accent: string, trim: string) {
    const body = "#f4f1ea", dark = "#4a4f5c", b = new Blocks(), g = new Blocks(), soft = { smooth: true };
    // Legs and feet.
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + Math.PI / 4, x = Math.cos(a), z = Math.sin(a);
      b.box(0.28, 2.2, 0.28, x * 1.45, 1.05, z * 1.45, dark, { rx: z * 0.35, rz: -x * 0.35 }).add(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 12), x * 1.85, 0.09, z * 1.85, dark, soft);
    }
    b.add(new THREE.CylinderGeometry(0.75, 1.05, 0.9, 16), 0, 0.95, 0, "#6d7280", soft)
      .add(new THREE.CylinderGeometry(1.3, 1.3, 3.3, 24), 0, 3.05, 0, body, soft)
      .add(new THREE.CylinderGeometry(1.33, 1.33, 0.38, 24), 0, 1.75, 0, accent, soft)
      .add(new THREE.CylinderGeometry(1.33, 1.33, 0.2, 24), 0, 4.3, 0, trim, soft)
      .add(new THREE.CylinderGeometry(1.02, 1.3, 1.9, 24), 0, 5.65, 0, body, soft)
      .add(new THREE.ConeGeometry(1.02, 2.1, 24), 0, 7.65, 0, accent, soft)
      .add(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 20), 0, 5.6, 1.08, dark, { rx: Math.PI / 2 - 0.12, smooth: true })
      // Dark doorway behind the hatch.
      .box(0.92, 1.62, 0.1, 0, 2.95, 1.25, "#1c1a26");
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + Math.PI, x = Math.sin(a), z = Math.cos(a);
      b.box(0.18, 2, 1.3, x * 1.55, 1.95, z * 1.55, accent, { ry: a });
    }
    g.add(new THREE.CylinderGeometry(0.5, 0.5, 0.24, 20), 0, 5.6, 1.11, "#9fe6ff", { rx: Math.PI / 2 - 0.12 })
      .add(new THREE.SphereGeometry(0.2, 10, 8), 0, 8.75, 0, "#ff6b61")
      .box(0.5, 0.08, 0.08, 0, 2.02, 1.33, "#8edb7c");
    inked(this.body, b.mesh(litMaterial));
    this.body.add(g.mesh(glowMaterial));
    // Hatch: hinged on its left edge, swings open.
    const hatch = new Blocks().box(1, 1.7, 0.12, 0.5, 0, 0, "#dcd6c8").box(0.14, 0.14, 0.12, 0.82, -0.05, 0.08, "#f2ce68").box(0.6, 0.6, 0.02, 0.5, 0.35, 0.07, "#cfc8b8");
    inked(this.door, hatch.mesh(litMaterial));
    this.door.position.set(-0.5, 2.95, 1.31);
    // Ramp: folds out from under the door down to the pad.
    const plank = new Blocks().box(1.05, 0.1, 2.75, 0, 0, 1.375, dark);
    for (let i = 0; i < 5; i++) plank.box(0.9, 0.05, 0.1, 0, 0.07, 0.35 + i * 0.5, "#f2ce68");
    inked(this.ramp, plank.mesh(litMaterial));
    this.ramp.position.set(0, 2.08, 1.28);
    this.body.add(this.door, this.ramp);
    // Heat glow for atmosphere entry (blooms).
    const heat = new THREE.SphereGeometry(1.9, 20, 14); heat.scale(1, 1.5, 1); heat.translate(0, 6.6, 0);
    this.heat = new THREE.Mesh(heat, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff8a3d").multiplyScalar(2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.body.add(this.heat);
    const flame = new THREE.ConeGeometry(0.75, 3, 16); flame.rotateX(Math.PI); flame.translate(0, -1.4, 0);
    this.flame = new THREE.Mesh(flame, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb347").multiplyScalar(1.8), transparent: true, opacity: 0.9, depthWrite: false }));
    const core = new THREE.ConeGeometry(0.4, 2, 16); core.rotateX(Math.PI); core.translate(0, -0.9, 0);
    this.flameCore = new THREE.Mesh(core, new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff4c2").multiplyScalar(2) }));
    this.flame.add(this.flameCore);
    this.flame.position.y = 0.55; this.flame.visible = false;
    this.body.add(this.flame);
    this.group.add(this.body);
    this.dust = particles(Array.from({ length: 70 }, () => new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6)), { color: "#e9e0d0", size: 0.9, opacity: 0.7, mode: "burst", speed: 0.9, spread: 5.5 });
    this.group.add(this.dust);
    this.setHatch(1);
  }
  setThrust(power: number, t: number) {
    this.flame.visible = power > 0.02;
    const flicker = 0.85 + Math.sin(t * 43) * 0.08 + Math.sin(t * 71) * 0.07;
    this.flame.scale.set(0.8 + power * 0.3, (0.4 + power * 1.3) * flicker, 0.8 + power * 0.3);
  }
  /** 0 closed (flying) … 1 door open and ramp down (parked). */
  setHatch(open: number) {
    const k = THREE.MathUtils.clamp(open, 0, 1), door = Math.min(1, k * 1.8), ramp = Math.max(0, (k - 0.35) / 0.65);
    this.door.rotation.y = -1.95 * door;
    this.ramp.rotation.x = -Math.PI / 2 + (Math.PI / 2 + 0.64) * ramp;
    this.ramp.visible = ramp > 0.01;
  }
  setHeat(h: number) { (this.heat.material as THREE.MeshBasicMaterial).opacity = h * 0.55; this.heat.visible = h > 0.01; }
  /** Touchdown squash, then spring back. */
  land(speed: number) { this.squash = Math.min(0.22, 0.05 + speed * 0.02); burst(this.dust); }
  update(dt: number) {
    this.squash *= Math.exp(-dt * 7);
    this.body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);
  }
}

/** The inside of the nose: drawn with its own camera over the world. */
export class Cockpit {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 20);
  readonly seat = new THREE.Group();
  private throttle: THREE.Object3D;
  private stick: THREE.Object3D;
  private radar: THREE.CanvasTexture;
  private radarCanvas = document.createElement("canvas");
  private landLight: THREE.Mesh;
  private blinkers: THREE.Mesh[] = [];
  private speedNeedle: THREE.Object3D;

  constructor(accent: string) {
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#40445a", 1.5));
    const key = new THREE.DirectionalLight("#fff0da", 1); key.position.set(0.4, 1, 0.6); this.scene.add(key);
    const panel = "#2f3444", trim = "#e9e4da", frame = "#d4cdbf", b = new Blocks();
    // A big panoramic window at z = -1.7 (the world shows through the opening).
    b.box(5.2, 0.34, 0.34, 0, -0.34, -1.7, frame).box(5.2, 0.3, 0.34, 0, 2.12, -1.7, frame)
      .box(0.34, 2.8, 0.34, -2.47, 0.9, -1.7, frame).box(0.34, 2.8, 0.34, 2.47, 0.9, -1.7, frame)
      .box(0.9, 0.3, 0.34, -2.1, 1.85, -1.7, frame, { rz: 0.7 }).box(0.9, 0.3, 0.34, 2.1, 1.85, -1.7, frame, { rz: -0.7 })
      .box(0.9, 0.3, 0.34, -2.1, -0.1, -1.7, frame, { rz: -0.6 }).box(0.9, 0.3, 0.34, 2.1, -0.1, -1.7, frame, { rz: 0.6 });
    // Walls, roof and floor around the window.
    b.box(0.3, 4.2, 4.2, -2.75, 0.8, 0.3, trim, { ry: 0.22 }).box(0.3, 4.2, 4.2, 2.75, 0.8, 0.3, trim, { ry: -0.22 })
      .box(6, 0.3, 4.2, 0, 2.35, 0.3, trim, { rx: -0.12 }).box(6, 0.3, 4.4, 0, -1.55, 0.3, "#3a3f4f");
    // Overhead switches.
    for (let i = 0; i < 7; i++) b.box(0.16, 0.08, 0.16, -0.9 + i * 0.3, 2.14, -1.3, i % 3 ? "#9aa0ae" : "#e8543f");
    // Dashboard, sloping toward you.
    b.box(5, 0.5, 1.1, 0, -0.55, -1.2, panel, { rx: 0.35 }).box(5, 0.9, 0.5, 0, -1.05, -1.25, "#262a36");
    // Centre console with the throttle.
    b.box(0.5, 0.5, 1.6, -0.25, -1.05, -0.2, panel);
    // Your Friend's seat on the left (you ride as co-pilot).
    b.box(1.1, 0.22, 0.9, -1.05, -1.18, 0.15, accent).box(1.1, 0.55, 0.2, -1.05, -0.85, 0.62, accent).box(1.2, 0.3, 1, -1.05, -1.4, 0.15, panel);
    this.scene.add(b.mesh(litMaterial));

    this.throttle = new THREE.Group();
    const lever = new Blocks().box(0.08, 0.45, 0.08, 0, 0.22, 0, "#9aa0ae").box(0.22, 0.14, 0.22, 0, 0.47, 0, "#e8543f").mesh(litMaterial);
    this.throttle.add(lever); this.throttle.position.set(-0.25, -0.8, -0.3); this.scene.add(this.throttle);
    // The pilot's yoke moves with the steering.
    this.stick = new THREE.Group();
    const yoke = new Blocks().box(0.1, 0.1, 0.5, 0, 0, 0.25, "#555a66").box(0.8, 0.1, 0.1, 0, 0, 0.5, "#222222").box(0.1, 0.3, 0.1, -0.4, 0.12, 0.5, "#222222").box(0.1, 0.3, 0.1, 0.4, 0.12, 0.5, "#222222").mesh(litMaterial);
    this.stick.add(yoke); this.stick.position.set(-1.05, -0.35, -0.95); this.scene.add(this.stick);

    // Radar screen (canvas), speed gauge, LAND light and blinking buttons.
    this.radarCanvas.width = 160; this.radarCanvas.height = 160;
    this.radar = new THREE.CanvasTexture(this.radarCanvas); this.radar.colorSpace = THREE.SRGBColorSpace;
    const tilt = -0.95;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: this.radar }));
    screen.position.set(0.6, -0.26, -1.08); screen.rotation.x = tilt; this.scene.add(screen);
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), new THREE.MeshBasicMaterial({ color: "#10141c" }));
    gauge.position.set(1.45, -0.27, -1.08); gauge.rotation.x = tilt; this.scene.add(gauge);
    this.speedNeedle = new THREE.Group();
    const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.2), new THREE.MeshBasicMaterial({ color: "#8edb7c" })); needle.position.y = 0.09;
    this.speedNeedle.add(needle); this.speedNeedle.position.set(1.45, -0.265, -1.075); this.speedNeedle.rotation.x = tilt; this.scene.add(this.speedNeedle);
    const colors = ["#8edb7c", "#ed927e", "#7db4db", "#f2ce68", "#b3a0d8"];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.11), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      m.position.set(i < 6 ? -2.15 + i * 0.17 : 1.95 + ((i - 6) % 3) * 0.17, i < 6 ? -0.36 : -0.36 + Math.floor((i - 6) / 3) * 0.1, i < 6 ? -1.05 : -1.05 - Math.floor((i - 6) / 3) * 0.12);
      m.rotation.x = 0.35; this.scene.add(m); this.blinkers.push(m);
    }
    this.landLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.18), new THREE.MeshBasicMaterial({ color: "#333333" }));
    this.landLight.position.set(0.6, -0.5, -0.8); this.landLight.rotation.x = 0.35; this.scene.add(this.landLight);
    this.seat.position.set(-1.05, -1.07, 0.1);
    this.scene.add(this.seat);
    this.resize(16 / 9, false);
  }

  resize(aspect: number, portrait: boolean) {
    this.camera.aspect = aspect; this.camera.fov = portrait ? 92 : 68;
    this.camera.position.set(portrait ? 0.1 : 0.35, 0.85, portrait ? 1.45 : 1.75);
    this.camera.lookAt(portrait ? -0.1 : 0.15, 0.55, -2);
    this.camera.updateProjectionMatrix();
  }

  /** throttle 0..1, steer x/y -1..1, speed 0..1, canLand lights the LAND button. */
  update(t: number, throttle: number, steerX: number, steerY: number, speed: number, canLand: boolean, dots: { x: number; y: number; color: string; target: boolean }[]) {
    this.throttle.rotation.x = -0.6 + throttle * 1.1;
    this.stick.rotation.set(-steerY * 0.35, 0, -steerX * 0.35);
    this.speedNeedle.rotation.z = 2.2 - speed * 4.4;
    this.blinkers.forEach((m, i) => { (m.material as THREE.MeshBasicMaterial).color.setStyle(Math.sin(t * (2 + i * 0.7) + i) > 0.2 ? ["#8edb7c", "#ed927e", "#7db4db", "#f2ce68", "#b3a0d8"][i % 5] : "#2a2e3a"); });
    (this.landLight.material as THREE.MeshBasicMaterial).color.setStyle(canLand ? (Math.sin(t * 8) > 0 ? "#8edb7c" : "#3f6b38") : "#333333");
    const g = this.radarCanvas.getContext("2d")!;
    g.fillStyle = "#08130c"; g.fillRect(0, 0, 160, 160);
    g.strokeStyle = "#1f5a33"; g.lineWidth = 2;
    for (const r of [25, 50, 75]) { g.beginPath(); g.arc(80, 80, r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(80, 0); g.lineTo(80, 160); g.moveTo(0, 80); g.lineTo(160, 80); g.stroke();
    const sweep = t * 2.4;
    g.strokeStyle = "rgba(204,255,0,0.55)"; g.beginPath(); g.moveTo(80, 80); g.lineTo(80 + Math.cos(sweep) * 78, 80 + Math.sin(sweep) * 78); g.stroke();
    for (const d of dots) {
      g.fillStyle = d.color; g.fillRect(80 + d.x * 75 - 5, 80 + d.y * 75 - 5, 10, 10);
      if (d.target) { g.strokeStyle = "#8edb7c"; g.strokeRect(80 + d.x * 75 - 9, 80 + d.y * 75 - 9, 18, 18); }
    }
    g.fillStyle = "#ffffff"; g.fillRect(77, 77, 6, 6);
    this.radar.needsUpdate = true;
  }
}
