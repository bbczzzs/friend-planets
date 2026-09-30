/**
 * The sky follows you: on a planet it is that planet's day, sunset or night
 * (depending on where you stand relative to the sun), and it fades to starry
 * space as your rocket climbs out of the atmosphere.
 */
import * as THREE from "three";
import { mulberry32 } from "./data";

export class Sky {
  readonly group = new THREE.Group();
  private uniforms = {
    uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uAtmos: { value: 1 },
    uDay: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunset: { value: new THREE.Color() }, uNight: { value: new THREE.Color() },
  };
  private stars: THREE.Points;
  private starMaterial: THREE.PointsMaterial;

  constructor() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uUp; uniform vec3 uSun; uniform float uAtmos; uniform vec3 uDay; uniform vec3 uHorizon; uniform vec3 uSunset; uniform vec3 uNight;
        varying vec3 vDir;
        void main(){
          vec3 v = normalize(vDir);
          float h = dot(v, uUp), s = dot(uUp, uSun);
          float day = smoothstep(-0.28, 0.22, s), dusk = exp(-pow(s / 0.26, 2.0));
          vec3 dayCol = mix(uHorizon, uDay, smoothstep(-0.05, 0.5, h));
          vec3 nightCol = mix(uNight * 1.7, uNight, smoothstep(-0.05, 0.55, h));
          vec3 col = mix(nightCol, dayCol, day);
          float toward = max(dot(v, uSun), 0.0);
          col = mix(col, uSunset, clamp(dusk * (0.35 + 0.65 * pow(toward, 2.0)) * (1.0 - smoothstep(-0.1, 0.45, h)), 0.0, 1.0) * 0.9);
          vec3 neb = vec3(0.012, 0.014, 0.035) + vec3(0.07, 0.03, 0.1) * pow(max(dot(v, normalize(vec3(-0.4, 0.25, -0.88))), 0.0), 5.0) + vec3(0.02, 0.06, 0.08) * pow(max(dot(v, normalize(vec3(0.7, -0.3, -0.6))), 0.0), 6.0);
          float a = uAtmos * smoothstep(-0.6, -0.05, h);
          col = mix(neb, col, a);
          float sd = dot(v, uSun);
          col += vec3(1.0, 0.93, 0.78) * (smoothstep(0.9990, 0.9994, sd) * 1.6 + pow(max(sd, 0.0), 90.0) * 0.45 + pow(max(sd, 0.0), 8.0) * 0.08 * (1.0 - uAtmos));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    dome.renderOrder = -10; dome.frustumCulled = false;
    this.group.add(dome);

    const r = mulberry32(7), count = 1800, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      positions.set([s * Math.cos(a) * 900, z * 900, s * Math.sin(a) * 900], i * 3);
      c.set(["#ffffff", "#ffffff", "#fff4d6", "#d6e4ff", "#ffd6f0"][Math.floor(r() * 5)]).multiplyScalar(0.55 + r() * 0.45);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.starMaterial = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
    // Opaque list + additive blending: drawn right after the dome, before (and under) everything else.
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.group.add(this.stars);
  }

  /** `up` is the local up where the camera is; `atmos` 1 on the ground, 0 in open space. */
  update(cameraPosition: THREE.Vector3, up: THREE.Vector3, sun: THREE.Vector3, atmos: number, sky: { day: string; horizon: string; sunset: string; night: string }) {
    this.group.position.copy(cameraPosition);
    const u = this.uniforms;
    u.uUp.value.copy(up); u.uSun.value.copy(sun); u.uAtmos.value = atmos;
    u.uDay.value.set(sky.day); u.uHorizon.value.set(sky.horizon); u.uSunset.value.set(sky.sunset); u.uNight.value.set(sky.night);
    const s = up.dot(sun), day = THREE.MathUtils.smoothstep(s, -0.28, 0.22);
    this.starMaterial.color.setScalar(1 - atmos * (0.2 + day * 0.8));
  }
}
