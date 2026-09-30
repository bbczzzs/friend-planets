// Third-person orbit camera for walking on a round planet, modelled on the
// "Steal An Egg" FollowCamera (Apache-2.0): it orbits the Friend's head in the
// Friend's own up/forward frame, never auto-rotates, and zooms in steps.
import * as THREE from "three";

export const CAMERA = {
  fov: 62, headHeight: 1.7,
  minDistance: 4, maxDistance: 30, startDistance: 11.5,
  minPitch: -0.05, maxPitch: 1.35, startPitch: 0.3,
  zoomStep: 1.2, keyYawSpeed: 2.1,
};

const offset = new THREE.Vector3(), up = new THREE.Vector3(), focus = new THREE.Vector3();

export class OrbitCamera {
  yaw = 0;
  pitch = CAMERA.startPitch;
  distance = CAMERA.startDistance;
  targetDistance = CAMERA.startDistance;
  private shake = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  rotate(dx: number, dy: number, touch: boolean) {
    const scale = touch ? 0.0075 : 0.0055;
    this.yaw -= dx * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * scale, CAMERA.minPitch, CAMERA.maxPitch);
  }
  zoom(steps: number) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * Math.pow(CAMERA.zoomStep, steps), CAMERA.minDistance, CAMERA.maxDistance);
  }
  addShake(amount: number) { this.shake = Math.min(1, this.shake + amount); }

  /** `position` is the Friend's feet (world), `frame` the Friend's local frame (Y = planet up). */
  update(dt: number, position: THREE.Vector3, frame: THREE.Quaternion, keyYaw: number, reducedMotion: boolean) {
    this.yaw += keyYaw * CAMERA.keyYawSpeed * dt;
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 10);
    const d = this.distance, flat = Math.cos(this.pitch) * d;
    up.set(0, 1, 0).applyQuaternion(frame);
    focus.copy(position).addScaledVector(up, CAMERA.headHeight);
    offset.set(Math.sin(this.yaw) * flat, Math.sin(this.pitch) * d, Math.cos(this.yaw) * flat).applyQuaternion(frame);
    this.camera.position.copy(focus).add(offset);
    if (this.shake > 0.001 && !reducedMotion) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.6;
    }
    this.shake *= Math.exp(-dt * 6);
    this.camera.up.copy(up);
    this.camera.lookAt(focus);
  }
}
