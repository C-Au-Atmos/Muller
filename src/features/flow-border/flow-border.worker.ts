/// <reference lib="webworker" />

import {
  directionForNavigation,
  profileForState,
  targetForScrollVelocity,
  type FlowProfile,
} from "./flowModel";
import type {
  FlowBorderAppearance,
  FlowBorderStats,
  FlowVisualState,
  FlowWorkerInbound,
  FlowWorkerOutbound,
} from "./protocol";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_phase;
uniform float u_segmentCount;
uniform float u_segmentLength;
uniform float u_intensity;
uniform float u_directionPulse;
uniform float u_borderWidth;
uniform float u_borderRadius;
uniform float u_opacity;
uniform vec3 u_color;
uniform vec3 u_backgroundColor;
uniform vec3 u_highlightColor;

out vec4 outColor;

void main() {
  vec2 p = gl_FragCoord.xy;
  float width = u_resolution.x;
  float height = u_resolution.y;
  vec2 center = u_resolution * 0.5;
  vec2 halfSize = max(center - vec2(0.5), vec2(0.5));
  float radius = min(u_borderRadius, min(halfSize.x, halfSize.y));
  vec2 rounded = abs(p - center) - (halfSize - vec2(radius));
  float outerDistance = length(max(rounded, vec2(0.0))) + min(max(rounded.x, rounded.y), 0.0) - radius;
  float topDistance = height - p.y;
  float rightDistance = width - p.x;
  float bottomDistance = p.y;
  float leftDistance = p.x;
  float edgeDistance = max(0.0, -outerDistance);
  float perimeter = 2.0 * (width + height);
  float along;

  if (topDistance <= rightDistance && topDistance <= bottomDistance && topDistance <= leftDistance) {
    along = p.x;
  } else if (rightDistance <= bottomDistance && rightDistance <= leftDistance) {
    along = width + topDistance;
  } else if (bottomDistance <= leftDistance) {
    along = width + height + (width - p.x);
  } else {
    along = 2.0 * width + height + p.y;
  }

  float s = along / perimeter;
  float cell = fract(s * u_segmentCount - u_phase);
  float centerDistance = abs(cell - 0.5) * 2.0;
  float segment = 1.0 - smoothstep(u_segmentLength * 0.45, u_segmentLength, centerDistance);
  float core = pow(segment, 2.4);
  float outerCoverage = 1.0 - smoothstep(-0.75, 0.75, outerDistance);
  float innerFade = (1.0 - smoothstep(u_borderWidth * 0.35, u_borderWidth, edgeDistance)) * outerCoverage;
  float outerLine = 1.0 - smoothstep(0.0, 1.5, edgeDistance);
  float pulse = u_directionPulse * (0.32 + 0.68 * segment);
  vec3 signalColor = mix(u_color, u_highlightColor, core * 0.38 + pulse * 0.34);
  float brightness = (0.16 + segment * u_intensity + pulse) * innerFade;
  vec3 color = u_backgroundColor + signalColor * brightness + u_color * outerLine * 0.28;
  float alpha = clamp(0.82 * innerFade + core * 0.18, 0.0, 1.0) * u_opacity;

  outColor = vec4(color, alpha);
}
`;

interface SpringValue {
  value: number;
  velocity: number;
}

interface RendererState {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  phase: number;
  direction: -1 | 1;
  targetDirection: -1 | 1;
  speed: SpringValue;
  segmentCount: SpringValue;
  segmentLength: SpringValue;
  intensity: SpringValue;
  color: [SpringValue, SpringValue, SpringValue];
  pulse: number;
  profile: FlowProfile;
  scrollTargetSpeed: number;
  visualState: FlowVisualState;
  appearance: FlowBorderAppearance;
  width: number;
  height: number;
  dpr: number;
  visible: boolean;
  reducedMotion: boolean;
  lastFrameAt: number;
  lastScrollAt: number;
  navBoostUntil: number;
  framesInWindow: number;
  messagesInWindow: number;
  statsWindowStartedAt: number;
  frameTimeTotal: number;
  uniforms: {
    resolution: WebGLUniformLocation;
    phase: WebGLUniformLocation;
    segmentCount: WebGLUniformLocation;
    segmentLength: WebGLUniformLocation;
    intensity: WebGLUniformLocation;
    directionPulse: WebGLUniformLocation;
    borderWidth: WebGLUniformLocation;
    borderRadius: WebGLUniformLocation;
    opacity: WebGLUniformLocation;
    color: WebGLUniformLocation;
    backgroundColor: WebGLUniformLocation;
    highlightColor: WebGLUniformLocation;
  };
}

let renderer: RendererState | null = null;

function post(message: FlowWorkerOutbound): void {
  workerScope.postMessage(message);
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to allocate WebGL shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(details);
  }

  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();

  if (!program) {
    throw new Error("Unable to allocate WebGL program");
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program) ?? "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(details);
  }

  return program;
}

function uniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing shader uniform: ${name}`);
  }
  return location;
}

function spring(value: number): SpringValue {
  return { value, velocity: 0 };
}

function initialize(message: Extract<FlowWorkerInbound, { type: "init" }>): void {
  const gl = message.canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    failIfMajorPerformanceCaveat: false,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });

  if (!gl) {
    throw new Error("WebGL2 is unavailable in the OffscreenCanvas Worker");
  }

  const program = createProgram(gl);
  gl.useProgram(program);

  const positions = gl.createBuffer();
  if (!positions) {
    throw new Error("Unable to allocate flow-border geometry");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, positions);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.SCISSOR_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  const profile = {
    ...profileForState("idle"),
    color: [...message.appearance.colors.idle] as [number, number, number],
  };
  const now = performance.now();
  renderer = {
    canvas: message.canvas,
    gl,
    program,
    phase: 0,
    direction: 1,
    targetDirection: 1,
    speed: spring(profile.speed),
    segmentCount: spring(profile.segmentCount),
    segmentLength: spring(profile.segmentLength),
    intensity: spring(profile.intensity),
    color: profile.color.map((channel) => spring(channel)) as [
      SpringValue,
      SpringValue,
      SpringValue,
    ],
    pulse: 0,
    profile,
    scrollTargetSpeed: profile.speed,
    visualState: "idle",
    appearance: message.appearance,
    width: 1,
    height: 1,
    dpr: 1,
    visible: true,
    reducedMotion: message.reducedMotion,
    lastFrameAt: now,
    lastScrollAt: Number.NEGATIVE_INFINITY,
    navBoostUntil: 0,
    framesInWindow: 0,
    messagesInWindow: 0,
    statsWindowStartedAt: now,
    frameTimeTotal: 0,
    uniforms: {
      resolution: uniform(gl, program, "u_resolution"),
      phase: uniform(gl, program, "u_phase"),
      segmentCount: uniform(gl, program, "u_segmentCount"),
      segmentLength: uniform(gl, program, "u_segmentLength"),
      intensity: uniform(gl, program, "u_intensity"),
      directionPulse: uniform(gl, program, "u_directionPulse"),
      borderWidth: uniform(gl, program, "u_borderWidth"),
      borderRadius: uniform(gl, program, "u_borderRadius"),
      opacity: uniform(gl, program, "u_opacity"),
      color: uniform(gl, program, "u_color"),
      backgroundColor: uniform(gl, program, "u_backgroundColor"),
      highlightColor: uniform(gl, program, "u_highlightColor"),
    },
  };

  resize(message.width, message.height, message.dpr);
  post({ type: "ready" });
  scheduleFrame(renderFrame);
}

function resize(width: number, height: number, dpr: number): void {
  if (!renderer) return;

  renderer.dpr = Math.min(Math.max(dpr, 1), 2);
  renderer.width = Math.max(1, Math.floor(width * renderer.dpr));
  renderer.height = Math.max(1, Math.floor(height * renderer.dpr));
  renderer.canvas.width = renderer.width;
  renderer.canvas.height = renderer.height;
  renderer.gl.viewport(0, 0, renderer.width, renderer.height);
}

function advanceSpring(
  current: SpringValue,
  target: number,
  dt: number,
  reducedMotion: boolean,
): void {
  if (reducedMotion) {
    current.value = target;
    current.velocity = 0;
    return;
  }

  const stiffness = 175;
  const damping = 24;
  const acceleration = stiffness * (target - current.value) - damping * current.velocity;
  current.velocity += acceleration * dt;
  current.value += current.velocity * dt;
}

function updateTargets(state: RendererState, now: number, dt: number): void {
  const scrolling = now - state.lastScrollAt < 135;
  const navigating = now < state.navBoostUntil;
  let targetSpeed = scrolling ? state.scrollTargetSpeed : state.profile.speed;

  if (navigating) {
    targetSpeed = Math.max(targetSpeed, 1.18);
  }

  if (state.direction !== state.targetDirection && Math.abs(state.speed.value) < 0.3) {
    state.direction = state.targetDirection;
  } else if (state.direction !== state.targetDirection) {
    targetSpeed = 0.02;
  }

  advanceSpring(state.speed, targetSpeed, dt, state.reducedMotion);
  advanceSpring(
    state.segmentCount,
    state.profile.segmentCount,
    dt,
    state.reducedMotion,
  );
  advanceSpring(
    state.segmentLength,
    state.profile.segmentLength,
    dt,
    state.reducedMotion,
  );
  advanceSpring(
    state.intensity,
    state.profile.intensity,
    dt,
    state.reducedMotion,
  );
  state.color.forEach((channel, index) => {
    advanceSpring(
      channel,
      state.profile.color[index] ?? 0,
      dt,
      state.reducedMotion,
    );
  });
  state.pulse *= Math.exp(-5.2 * dt);
  state.phase = (state.phase + state.speed.value * state.direction * dt) % 1;
}

function drawEdge(
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return;
  gl.scissor(x, y, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function draw(state: RendererState): void {
  const { gl, uniforms, width, height } = state;
  const ribbonWidth = Math.max(1, Math.round(state.appearance.width * state.dpr));

  gl.scissor(0, 0, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!state.appearance.enabled || state.appearance.opacity <= 0) return;

  gl.useProgram(state.program);
  gl.uniform2f(uniforms.resolution, width, height);
  gl.uniform1f(uniforms.phase, state.phase);
  gl.uniform1f(uniforms.segmentCount, state.segmentCount.value);
  gl.uniform1f(uniforms.segmentLength, state.segmentLength.value);
  gl.uniform1f(uniforms.intensity, state.intensity.value);
  gl.uniform1f(uniforms.directionPulse, state.pulse);
  gl.uniform1f(uniforms.borderWidth, ribbonWidth);
  gl.uniform1f(uniforms.borderRadius, state.appearance.radius * state.dpr);
  gl.uniform1f(uniforms.opacity, state.appearance.opacity);
  gl.uniform3f(
    uniforms.color,
    state.color[0].value,
    state.color[1].value,
    state.color[2].value,
  );
  gl.uniform3f(
    uniforms.backgroundColor,
    state.appearance.background[0],
    state.appearance.background[1],
    state.appearance.background[2],
  );
  gl.uniform3f(
    uniforms.highlightColor,
    state.appearance.highlight[0],
    state.appearance.highlight[1],
    state.appearance.highlight[2],
  );

  const cornerExtent = Math.min(
    Math.ceil((state.appearance.radius + state.appearance.width + 2) * state.dpr),
    Math.floor(Math.min(width, height) / 2),
  );
  drawEdge(gl, 0, 0, width, cornerExtent);
  drawEdge(gl, 0, height - cornerExtent, width, cornerExtent);
  drawEdge(gl, 0, cornerExtent, cornerExtent, height - cornerExtent * 2);
  drawEdge(gl, width - cornerExtent, cornerExtent, cornerExtent, height - cornerExtent * 2);
}

function publishStats(state: RendererState, now: number): void {
  const elapsed = now - state.statsWindowStartedAt;
  if (elapsed < 1000) return;

  const stats: FlowBorderStats = {
    renderer: "webgl2-worker",
    fps: Math.round((state.framesInWindow * 1000) / elapsed),
    frameTimeMs:
      state.framesInWindow === 0 ? 0 : state.frameTimeTotal / state.framesInWindow,
    messagesPerSecond: Math.round((state.messagesInWindow * 1000) / elapsed),
    drawCallsPerFrame: 4,
  };
  post({ type: "stats", stats });
  state.framesInWindow = 0;
  state.messagesInWindow = 0;
  state.frameTimeTotal = 0;
  state.statsWindowStartedAt = now;
}

function renderFrame(now: number): void {
  const state = renderer;
  if (!state) return;

  const startedAt = performance.now();
  const dt = Math.min(Math.max((now - state.lastFrameAt) / 1000, 0), 0.05);
  state.lastFrameAt = now;

  if (state.visible) {
    updateTargets(state, now, dt);
    draw(state);
    state.framesInWindow += 1;
    state.frameTimeTotal += performance.now() - startedAt;
  }

  publishStats(state, now);
  scheduleFrame(renderFrame);
}

function scheduleFrame(callback: (now: number) => void): void {
  const scope = workerScope as DedicatedWorkerGlobalScope & {
    requestAnimationFrame?: (handler: (now: number) => void) => number;
  };

  if (scope.requestAnimationFrame) {
    scope.requestAnimationFrame(callback);
  } else {
    workerScope.setTimeout(() => callback(performance.now()), 1000 / 60);
  }
}

workerScope.onmessage = ({ data }: MessageEvent<FlowWorkerInbound>) => {
  try {
    if (data.type === "init") {
      initialize(data);
      return;
    }

    if (!renderer) return;
    renderer.messagesInWindow += 1;

    switch (data.type) {
      case "resize":
        resize(data.width, data.height, data.dpr);
        break;
      case "scrollVelocity": {
        const target = targetForScrollVelocity(data.velocity);
        renderer.targetDirection = target.direction;
        renderer.scrollTargetSpeed = target.speed;
        renderer.lastScrollAt = performance.now();
        break;
      }
      case "navigate":
        renderer.targetDirection = directionForNavigation(data.direction);
        renderer.pulse = 1;
        renderer.navBoostUntil = performance.now() + 420;
        void data.depth;
        break;
      case "state":
        renderer.visualState = data.state;
        renderer.profile = {
          ...profileForState(data.state),
          color: [...renderer.appearance.colors[data.state]],
        };
        if (data.state === "success") renderer.pulse = 1;
        break;
      case "appearance":
        renderer.appearance = data.appearance;
        renderer.profile = {
          ...profileForState(renderer.visualState),
          color: [...data.appearance.colors[renderer.visualState]],
        };
        break;
      case "visibility":
        renderer.visible = data.visible;
        renderer.lastFrameAt = performance.now();
        break;
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : "Unknown Worker error",
    });
  }
};

export {};
