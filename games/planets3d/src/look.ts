/**
 * The cozy illustrated look: soft cel shading (3-step toon ramp), ink outlines
 * (inverted hulls with smoothed normals, a steady pixel width up close), glowing
 * bits that bloom, swaying grass, puffy clouds and little particle effects
 * (fireflies, sparkles, sparks, smoke, dust). One shared clock drives them all.
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const TIME = { value: 0 };
export const INK = "#2a2238";

function ramp(steps: number[]) {
  const data = new Uint8Array(steps.map(s => Math.round(s * 255)));
  const texture = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
export const TOON_RAMP = ramp([0.42, 0.72, 1]);

export function toon(opts: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...opts });
}

// ---- ink outlines ----
const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(INK) }, uWidth: { value: 0.0032 }, uMax: { value: 0.07 } },
  vertexShader: `uniform float uWidth; uniform float uMax;
    void main(){
      #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
      #else
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
      #endif
      float w = min(uWidth * -mv.z, uMax);
      mv.xyz += n * w;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }`,
  side: THREE.BackSide,
});
/** A hull that draws the mesh's silhouette and creases in ink. */
export function outline(mesh: THREE.Mesh, maxWidth?: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", (mesh.geometry.getAttribute("position") as THREE.BufferAttribute).clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  g.dispose();
  const material = maxWidth === undefined ? outlineMaterial : outlineMaterial.clone();
  if (maxWidth !== undefined) (material as THREE.ShaderMaterial).uniforms.uMax.value = maxWidth;
  const hull = new THREE.Mesh(merged, material);
  hull.userData.outline = true;
  hull.frustumCulled = mesh.frustumCulled;
  return hull;
}
/** Adds a mesh plus its ink outline to a parent; returns the mesh. */
export function inked<T extends THREE.Mesh>(parent: THREE.Object3D, mesh: T, shadows: { cast?: boolean; receive?: boolean } = { cast: true, receive: true }, maxWidth?: number) {
  mesh.castShadow = shadows.cast ?? false; mesh.receiveShadow = shadows.receive ?? false;
  parent.add(mesh, outline(mesh, maxWidth));
  return mesh;
}

// ---- swaying grass (instanced blades) ----
function bladeGeometry() {
  const w = 0.07, h = 0.62;
  const p = [-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, 0, 0, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  // Both windings, all normals up: blades shade like the ground from either side.
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 2, 1, 0, 2, 3, 1, 4, 3, 2]);
  return g;
}
const BLADE = bladeGeometry();
export const grassMaterial = toon();
grassMaterial.onBeforeCompile = shader => {
  shader.uniforms.uTime = TIME;
  shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float phase = instanceMatrix[3].x * 0.45 + instanceMatrix[3].z * 0.35 + instanceMatrix[3].y * 0.25;
      float sway = (sin(uTime * 2.1 + phase) * 0.7 + sin(uTime * 3.7 + phase * 1.7) * 0.3) * 0.2 * position.y;
      transformed.x += sway; transformed.z += sway * 0.4;
    #endif`);
};
export function grassField(spots: { m: THREE.Matrix4; color: THREE.Color }[]) {
  const mesh = new THREE.InstancedMesh(BLADE, grassMaterial, spots.length);
  spots.forEach((s, i) => { mesh.setMatrixAt(i, s.m); mesh.setColorAt(i, s.color); });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- water that gently bobs ----
export function waterMaterial(color: string) {
  const m = toon({ color, transparent: true, opacity: 0.86 });
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = TIME;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      transformed += normal * (sin(uTime * 1.4 + position.x * 0.9 + position.z * 0.7) * 0.05 + sin(uTime * 2.3 + position.y * 1.3) * 0.03);`);
  };
  return m;
}

// ---- particles ----
type ParticleOpts = { color: string; size: number; additive?: boolean; opacity?: number; mode: "drift" | "rise" | "burst"; height?: number; speed?: number; spread?: number };
const particleVertex = `uniform float uTime; uniform float uSize; uniform float uScale; uniform float uHeight; uniform float uSpeed; uniform float uSpread; uniform float uStart; uniform int uMode;
  attribute float aSeed; varying float vAlpha;
  void main(){
    vec3 p = position; float a = 1.0;
    if (uMode == 0) {
      float t = uTime * 0.5 + aSeed * 17.0;
      p += vec3(sin(t * 1.3), sin(t * 0.9 + 1.7) * 0.6, cos(t * 1.1)) * uSpread;
      a = 0.35 + 0.65 * max(0.0, sin(uTime * (1.5 + aSeed) + aSeed * 40.0));
    } else if (uMode == 1) {
      float k = fract(uTime * uSpeed + aSeed);
      p += vec3(sin(aSeed * 91.0 + k * 3.0) * uSpread * k, k * uHeight, cos(aSeed * 57.0 + k * 3.0) * uSpread * k);
      a = sin(k * 3.14159);
    } else {
      float age = clamp((uTime - uStart) * uSpeed, 0.0, 1.0);
      float ang = aSeed * 6.2832;
      p += vec3(cos(ang), 0.15 + fract(aSeed * 7.0) * 0.35, sin(ang)) * uSpread * (1.0 - pow(1.0 - age, 3.0));
      a = (1.0 - age) * step(0.0, uTime - uStart);
    }
    vAlpha = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
  }`;
const particleFragment = `uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
  void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;
/** Screen pixels per world unit at distance 1 (set on resize), so particle sizes are in world units. */
export const PARTICLE_SCALE = { value: 600 };
export function particles(points: THREE.Vector3[], opts: ParticleOpts) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(points.map(() => Math.random()), 1));
  const color = new THREE.Color(opts.color);
  if (opts.additive) color.multiplyScalar(2.2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: TIME, uScale: PARTICLE_SCALE, uColor: { value: color }, uSize: { value: opts.size }, uOpacity: { value: opts.opacity ?? 1 },
      uHeight: { value: opts.height ?? 2 }, uSpeed: { value: opts.speed ?? 0.5 }, uSpread: { value: opts.spread ?? 0.4 }, uStart: { value: -100 },
      uMode: { value: opts.mode === "drift" ? 0 : opts.mode === "rise" ? 1 : 2 },
    },
    vertexShader: particleVertex, fragmentShader: particleFragment,
    transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  return p;
}
/** Restart a "burst" particle system (dust on landing, splashes). */
export function burst(p: THREE.Points) { ((p.material as THREE.ShaderMaterial).uniforms.uStart.value = TIME.value); }
