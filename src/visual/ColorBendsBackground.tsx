import { useEffect, useRef } from "react";
import * as THREE from "three";

interface ColorBendsBackgroundProps {
  intensity: "home" | "workspace";
}

interface VisualProfile {
  dpr: number;
  fps: number;
  speed: number;
  intensity: number;
  mouseInfluence: number;
  parallax: number;
  noise: number;
}

const PROFILES: Record<ColorBendsBackgroundProps["intensity"], VisualProfile> = {
  home: { dpr: 1.2, fps: 45, speed: 0.18, intensity: 1.45, mouseInfluence: 0.32, parallax: 0.2, noise: 0.025 },
  workspace: { dpr: 0.72, fps: 20, speed: 0.08, intensity: 0.3, mouseInfluence: 0.08, parallax: 0.06, noise: 0.012 },
};

const MAX_COLORS = 8;

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

// React Bits ColorBends fragment shader, with Muller-controlled profile uniforms.
const FRAGMENT_SHADER = `
#define MAX_COLORS 8
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  q += (uPointer - rp) * uMouseInfluence * 0.2;

  for (int j = 0; j < 5; j++) {
    if (j >= uIterations - 1) break;
    vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
    q += (rr - q) * 0.15;
  }

  vec2 s = q;
  vec3 col = vec3(0.0);
  float cover = 0.0;
  for (int i = 0; i < MAX_COLORS; ++i) {
    if (i >= uColorCount) break;
    s -= 0.01;
    vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
    float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    float kBelow = clamp(uWarpStrength, 0.0, 1.0);
    float kMix = pow(kBelow, 0.3);
    float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
    vec2 warped = s + (r - s) * kBelow * gain;
    float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    float m = mix(m0, m1, kMix);
    float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
    col += uColors[i] * w;
    cover = max(cover, w);
  }
  col = clamp(col, 0.0, 1.0) * uIntensity;
  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col = clamp(col + (n - 0.5) * uNoise, 0.0, 1.0);
  }
  gl_FragColor = vec4(col * cover, cover);
}
`;

function colorVector(value: string): THREE.Vector3 {
  const color = new THREE.Color(value);
  return new THREE.Vector3(color.r, color.g, color.b);
}

function themeColor(variable: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function readThemeColors(): THREE.Vector3[] {
  return [
    themeColor("--accent", "#b978f2"),
    themeColor("--text-secondary", "#d2cadb"),
    themeColor("--text-muted", "#9b91a5"),
  ].map(colorVector);
}

export function ColorBendsBackground({ intensity }: ColorBendsBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const profileRef = useRef(PROFILES[intensity]);
  const resizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const colors = readThemeColors();
    const colorUniform = Array.from({ length: MAX_COLORS }, (_, index) => colors[index]?.clone() ?? new THREE.Vector3());
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      premultipliedAlpha: true,
      uniforms: {
        uCanvas: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: profileRef.current.speed },
        uRot: { value: new THREE.Vector2(0, 1) },
        uColorCount: { value: colors.length },
        uColors: { value: colorUniform },
        uScale: { value: 1 },
        uFrequency: { value: 1 },
        uWarpStrength: { value: 0.86 },
        uPointer: { value: new THREE.Vector2() },
        uMouseInfluence: { value: profileRef.current.mouseInfluence },
        uParallax: { value: profileRef.current.parallax },
        uNoise: { value: profileRef.current.noise },
        uIterations: { value: 2 },
        uIntensity: { value: profileRef.current.intensity },
        uBandWidth: { value: 5.6 },
      },
    });
    materialRef.current = material;
    scene.add(new THREE.Mesh(geometry, material));

    const updateThemeColors = () => {
      const nextColors = readThemeColors();
      const uniforms = material.uniforms.uColors!.value as THREE.Vector3[];
      nextColors.forEach((color, index) => uniforms[index]?.copy(color));
      material.uniforms.uColorCount!.value = nextColors.length;
      rendererRef.current?.render(scene, camera);
    };
    const themeObserver = new MutationObserver(updateThemeColors);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-source", "style"] });

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf: number | null = null;
    let startedAt = performance.now();
    let previousPaint = Number.NEGATIVE_INFINITY;

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profileRef.current.dpr));
      renderer.setSize(width, height, false);
      (material.uniforms.uCanvas!.value as THREE.Vector2).set(width, height);
      renderer.render(scene, camera);
    };
    resizeRef.current = resize;

    const draw = (time: number) => {
      raf = null;
      if (document.visibilityState !== "visible") return;
      const profile = profileRef.current;
      const interval = 1000 / profile.fps;
      if (time - previousPaint >= interval || reducedMotion.matches) {
        previousPaint = time;
        material.uniforms.uTime!.value = (time - startedAt) / 1000;
        pointerCurrent.lerp(pointerTarget, 0.08);
        (material.uniforms.uPointer!.value as THREE.Vector2).copy(pointerCurrent);
        renderer.render(scene, camera);
      }
      if (!reducedMotion.matches) raf = requestAnimationFrame(draw);
    };
    const start = () => {
      if (raf !== null || document.visibilityState !== "visible") return;
      startedAt = performance.now() - Number(material.uniforms.uTime!.value) * 1000;
      raf = requestAnimationFrame(draw);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };
    const handleMotion = () => {
      if (reducedMotion.matches && raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
        renderer.render(scene, camera);
      } else {
        start();
      }
    };
    const handlePointer = (event: PointerEvent) => {
      pointerTarget.set((event.clientX / Math.max(innerWidth, 1)) * 2 - 1, -((event.clientY / Math.max(innerHeight, 1)) * 2 - 1));
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", handleMotion);
    window.addEventListener("pointermove", handlePointer, { passive: true });
    resize();
    start();
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", handleMotion);
      window.removeEventListener("pointermove", handlePointer);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      rendererRef.current = null;
      materialRef.current = null;
      resizeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const profile = PROFILES[intensity];
    profileRef.current = profile;
    const material = materialRef.current;
    if (material) {
      material.uniforms.uSpeed!.value = profile.speed;
      material.uniforms.uIntensity!.value = profile.intensity;
      material.uniforms.uMouseInfluence!.value = profile.mouseInfluence;
      material.uniforms.uParallax!.value = profile.parallax;
      material.uniforms.uNoise!.value = profile.noise;
    }
    resizeRef.current?.();
  }, [intensity]);

  return <div ref={containerRef} className={`color-bends is-${intensity}`} data-renderer="three-webgl" aria-hidden="true" />;
}
