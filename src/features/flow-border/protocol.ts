export type FlowVisualState = "idle" | "scanning" | "success" | "danger";
export type NavigationDirection = "enter" | "back";
export type FlowRgb = readonly [number, number, number];

export interface FlowBorderAppearance {
  enabled: boolean;
  width: number;
  opacity: number;
  background: FlowRgb;
  highlight: FlowRgb;
  colors: Record<FlowVisualState, FlowRgb>;
}

export interface FlowBorderStats {
  renderer: "webgl2-worker" | "css-fallback";
  fps: number;
  frameTimeMs: number;
  messagesPerSecond: number;
  drawCallsPerFrame: number;
}

export type FlowWorkerInbound =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      dpr: number;
      reducedMotion: boolean;
      appearance: FlowBorderAppearance;
    }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "scrollVelocity"; velocity: number }
  | { type: "navigate"; direction: NavigationDirection; depth: number }
  | { type: "state"; state: FlowVisualState }
  | { type: "appearance"; appearance: FlowBorderAppearance }
  | { type: "visibility"; visible: boolean };

export type FlowWorkerOutbound =
  | { type: "ready" }
  | { type: "stats"; stats: FlowBorderStats }
  | { type: "error"; message: string };
