"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AudioSignalRef } from "@/lib/use-audio-signal";

// Adapted from the OriginKit Lava Lamp sample supplied for MeeTrack.
const MAX_BLOBS = 12;
const CAM_Z = 2.4;
const RAY_FOCAL = 1.4;

const DEFAULTS = {
  top: "#9AF466",
  bottom: "#10A83A",
  sheen: "#D6FF57",
  blobs: 8,
  scale: 5,
  viscosity: 1,
  speed: 13,
  glow: 6,
  gloss: 5,
  wander: 4,
  magnet: 8,
  sizePercent: 78,
};

type Config = {
  top: string;
  bottom: string;
  sheen: string;
  blobs: number;
  scale: number;
  viscosity: number;
  speed: number;
  glow: number;
  gloss: number;
  wander: number;
  magnet: number;
  sizePercent: number;
};

function clamp(value: number, low: number, high: number, fallback: number) {
  const safe = Number.isFinite(value) ? value : fallback;
  return Math.max(low, Math.min(high, safe));
}

function settingsFor(config: Config) {
  return {
    blobs: Math.round(clamp(config.blobs, 1, MAX_BLOBS, DEFAULTS.blobs)),
    scale: 0.12 + clamp(config.scale, 1, 20, DEFAULTS.scale) * 0.022,
    viscosity: 0.05 + clamp(config.viscosity, 1, 20, DEFAULTS.viscosity) * 0.035,
    speed: clamp(config.speed, 0, 20, DEFAULTS.speed) * 0.075,
    glow: 0.3 + clamp(config.glow, 0, 20, DEFAULTS.glow) * 0.06,
    gloss: 8 + clamp(config.gloss, 1, 20, DEFAULTS.gloss) * 5,
    wander: clamp(config.wander, 0, 20, DEFAULTS.wander) * 0.035,
    magnet: clamp(config.magnet, 0, 20, DEFAULTS.magnet) * 0.028,
    zoom: 100 / clamp(config.sizePercent, 20, 200, DEFAULTS.sizePercent),
  };
}

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LAVA_FRAGMENT = /* glsl */ `
  precision highp float;
  #define MAX_BLOBS ${MAX_BLOBS}

  uniform vec2 uResolution;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uSheen;
  uniform float uTime;
  uniform float uCount;
  uniform float uScale;
  uniform float uViscosity;
  uniform float uGlow;
  uniform float uGloss;
  uniform float uWander;
  uniform float uZoom;
  uniform vec2 uPointer;
  uniform float uMagnet;
  varying vec2 vUv;

  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  vec4 blob(int i) {
    float f = float(i);
    float rate = 0.5 + fract(f * 0.37) * 0.6;
    float phase = f * 2.399;
    float y = sin(uTime * rate + phase) * 0.62;
    float x = sin(uTime * rate * 0.61 + phase * 1.7) * uWander;
    float z = cos(uTime * rate * 0.43 + phase * 2.3) * uWander;
    float radius = uScale * (0.75 + fract(f * 0.71) * 0.6);
    vec2 toPointer = uPointer - vec2(x, y);
    float grip = exp(-dot(toPointer, toPointer) * 2.2);
    float give = uMagnet * grip * (1.3 - radius * 1.4);
    vec2 pulled = vec2(x, y) + toPointer * give;
    return vec4(pulled, z, radius);
  }

  float map(vec3 point) {
    float distance = 1e9;
    for (int i = 0; i < MAX_BLOBS; i++) {
      if (float(i) < uCount) {
        vec4 current = blob(i);
        float squash = 1.0 + 0.22 * sin(
          uTime * (0.5 + fract(float(i) * 0.37) * 0.6) + float(i) * 2.399
        );
        vec3 local = point - current.xyz;
        local.y /= squash;
        distance = smin(distance, length(local) - current.w, uViscosity);
      }
    }
    return distance;
  }

  vec3 normalAt(vec3 point) {
    vec2 edge = vec2(0.0018, 0.0);
    return normalize(vec3(
      map(point + edge.xyy) - map(point - edge.xyy),
      map(point + edge.yxy) - map(point - edge.yxy),
      map(point + edge.yyx) - map(point - edge.yyx)
    ));
  }

  void main() {
    vec2 sourceUv = (vUv - 0.5) * uZoom;
    sourceUv.x *= uResolution.x / max(1.0, uResolution.y);
    // Rotate the lamp field clockwise by 90 degrees for the recording layout.
    vec2 uv = vec2(-sourceUv.y, sourceUv.x);
    vec3 rayOrigin = vec3(0.0, 0.0, ${CAM_Z.toFixed(3)});
    vec3 rayDirection = normalize(vec3(uv, -${RAY_FOCAL.toFixed(3)}));

    float travel = 0.0;
    float hit = 0.0;
    float closest = 1e9;
    float closestTravel = 0.0;
    for (int i = 0; i < 60; i++) {
      vec3 point = rayOrigin + rayDirection * travel;
      float distance = map(point);
      if (distance < closest) {
        closest = distance;
        closestTravel = travel;
      }
      if (distance < 0.0009) { hit = 1.0; break; }
      travel += distance * 0.9;
      if (travel > 5.0) break;
    }
    float coverage = 1.0 - smoothstep(0.0009, 0.007, closest);
    if (hit < 0.5) {
      if (coverage < 0.01) discard;
      travel = closestTravel;
    }

    vec3 point = rayOrigin + rayDirection * travel;
    vec3 normal = normalAt(point);
    vec3 view = -rayDirection;
    float height = clamp(point.y * 0.9 + 0.5, 0.0, 1.0);
    vec3 color = mix(uBottom, uTop, height);
    vec3 lightDirection = normalize(vec3(-0.4, 0.7, 0.8));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float wrap = 0.5 + 0.5 * dot(normal, lightDirection);
    color *= 0.35 + diffuse * 0.6 + wrap * 0.25;
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
    color += mix(uBottom, uTop, height) * fresnel * uGlow;
    vec3 halfVector = normalize(lightDirection + view);
    color += uSheen * pow(max(dot(normal, halfVector), 0.0), uGloss) * 0.6;
    gl_FragColor = vec4(color, coverage);
  }
`;

class LavaScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private geometry = new THREE.PlaneGeometry(2, 2);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private grip = 0;
  private gripTarget = 0;
  private time = 0;
  private frameId = 0;
  private lastTime = 0;
  private lastRenderTime = 0;
  private disposed = false;
  private active = true;
  private audioLevel = 0;
  private audioPitch = 0.25;
  private unbind = () => {};

  constructor(
    private container: HTMLElement,
    private config: Config,
    private signal?: AudioSignalRef,
  ) {
    const settings = settingsFor(config);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      touchAction: "none",
    });
    container.appendChild(canvas);

    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTop: { value: new THREE.Color(config.top) },
        uBottom: { value: new THREE.Color(config.bottom) },
        uSheen: { value: new THREE.Color(config.sheen) },
        uTime: { value: 0 },
        uCount: { value: settings.blobs },
        uScale: { value: settings.scale },
        uViscosity: { value: settings.viscosity },
        uGlow: { value: settings.glow },
        uGloss: { value: settings.gloss },
        uWander: { value: settings.wander },
        uZoom: { value: settings.zoom },
        uPointer: { value: new THREE.Vector2() },
        uMagnet: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.bindEvents();
  }

  private toField(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const zoom = settingsFor(this.config).zoom;
    const factor = CAM_Z / RAY_FOCAL;
    const fieldX = ((event.clientX - rect.left) / rect.width - 0.5)
      * zoom * (rect.width / rect.height) * factor;
    const fieldY = (0.5 - (event.clientY - rect.top) / rect.height) * zoom * factor;
    return new THREE.Vector2(-fieldY, fieldX);
  }

  private bindEvents() {
    const canvas = this.renderer.domElement;
    const move = (event: PointerEvent) => {
      const field = this.toField(event);
      if (!field) return;
      this.pointerTarget.copy(field);
      this.gripTarget = 1;
    };
    const leave = () => { this.gripTarget = 0; };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerenter", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", leave);
    this.unbind = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerenter", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", leave);
    };
  }

  start() {
    this.lastTime = performance.now();
    this.lastRenderTime = this.lastTime;
    const loop = (now: number) => {
      this.frameId = requestAnimationFrame(loop);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fps = reduced ? 10 : this.active ? 30 : 10;
      if (document.hidden || now - this.lastRenderTime < 1000 / fps) return;
      this.lastRenderTime = now;
      this.step(now);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  setSize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.material.uniforms.uResolution.value.set(width, height);
  }

  setActive(active: boolean) {
    this.active = active;
  }

  updateConfig(config: Config) {
    if (this.disposed) return;
    this.config = config;
    const settings = settingsFor(config);
    const uniforms = this.material.uniforms;
    uniforms.uTop.value.set(config.top);
    uniforms.uBottom.value.set(config.bottom);
    uniforms.uSheen.value.set(config.sheen);
    uniforms.uCount.value = settings.blobs;
    uniforms.uScale.value = settings.scale;
    uniforms.uViscosity.value = settings.viscosity;
    uniforms.uGlow.value = settings.glow;
    uniforms.uGloss.value = settings.gloss;
    uniforms.uZoom.value = settings.zoom;
  }

  private step(now: number) {
    if (this.disposed) return;
    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    delta = Math.min(delta, 0.08);

    const settings = settingsFor(this.config);
    const signal = this.signal?.current;
    const levelTarget = this.active ? signal?.level ?? 0 : 0;
    const hasPitch = this.active && (signal?.pitchConfidence ?? 0) > 0.42;
    const pitchTarget = hasPitch ? signal?.pitch ?? 0.25 : 0.25;
    this.audioLevel += (levelTarget - this.audioLevel) * (1 - Math.exp(-delta * 8));
    this.audioPitch += (pitchTarget - this.audioPitch) * (1 - Math.exp(-delta * 4.5));

    const speedFactor = this.active
      ? 0.42 + this.audioLevel * 1.25 + this.audioPitch * 0.48
      : 0.045;
    const reactiveWander = settings.wander * (0.72 + this.audioPitch * 1.15)
      + this.audioLevel * 0.12;
    this.time += delta * settings.speed * speedFactor;
    this.grip += (this.gripTarget - this.grip) * (1 - Math.exp(-delta * 4));
    this.pointer.lerp(this.pointerTarget, 1 - Math.exp(-delta * 9));

    const uniforms = this.material.uniforms;
    uniforms.uTime.value = this.time;
    uniforms.uWander.value = reactiveWander;
    uniforms.uPointer.value.copy(this.pointer);
    uniforms.uMagnet.value = settings.magnet * this.grip;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.unbind();
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
    const canvas = this.renderer.domElement;
    if (canvas.parentNode === this.container) this.container.removeChild(canvas);
  }
}

export interface LavaLampProps {
  top?: string;
  bottom?: string;
  sheen?: string;
  blobs?: number;
  scale?: number;
  viscosity?: number;
  speed?: number;
  glow?: number;
  gloss?: number;
  wander?: number;
  magnet?: number;
  sizePercent?: number;
  signal?: AudioSignalRef;
  active?: boolean;
  style?: React.CSSProperties;
}

export default function LavaLamp({
  top = DEFAULTS.top,
  bottom = DEFAULTS.bottom,
  sheen = DEFAULTS.sheen,
  blobs = DEFAULTS.blobs,
  scale = DEFAULTS.scale,
  viscosity = DEFAULTS.viscosity,
  speed = DEFAULTS.speed,
  glow = DEFAULTS.glow,
  gloss = DEFAULTS.gloss,
  wander = DEFAULTS.wander,
  magnet = DEFAULTS.magnet,
  sizePercent = DEFAULTS.sizePercent,
  signal,
  active = true,
  style,
}: LavaLampProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LavaScene>(null);
  const configRef = useRef<Config>(null as unknown as Config);
  configRef.current = {
    top, bottom, sheen, blobs, scale, viscosity, speed, glow, gloss, wander, magnet, sizePercent,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let scene: LavaScene;
    try {
      scene = new LavaScene(container, configRef.current, signal);
    } catch {
      return;
    }
    sceneRef.current = scene;
    scene.setSize(container.clientWidth, container.clientHeight);
    scene.setActive(active);
    scene.start();
    const observer = new ResizeObserver(() => {
      scene.setSize(container.clientWidth, container.clientHeight);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    sceneRef.current?.updateConfig(configRef.current);
  }, [top, bottom, sheen, blobs, scale, viscosity, speed, glow, gloss, wander, magnet, sizePercent]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Audio-reactive lava lamp"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minWidth: 120,
        minHeight: 160,
        overflow: "hidden",
        ...style,
      }}
    />
  );
}

LavaLamp.displayName = "Lava Lamp";
