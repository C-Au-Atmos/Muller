import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type {
  FlowBorderAppearance,
  FlowBorderStats,
  FlowVisualState,
  NavigationDirection,
  FlowWorkerInbound,
  FlowWorkerOutbound,
} from "./protocol";

export interface FlowBorderHandle {
  navigate: (direction: NavigationDirection, depth: number) => void;
  scroll: (velocity: number) => void;
  setState: (state: FlowVisualState) => void;
}

interface FlowBorderProps {
  onStats: (stats: FlowBorderStats) => void;
  onError: (message: string) => void;
}

interface FlowBorderRuntime {
  dispose: () => void;
}

const FALLBACK_STATS: FlowBorderStats = {
  renderer: "css-fallback",
  fps: 0,
  frameTimeMs: 0,
  messagesPerSecond: 0,
  drawCallsPerFrame: 0,
};

const DEFAULT_APPEARANCE: FlowBorderAppearance = {
  enabled: true,
  width: 3,
  opacity: 0.82,
  background: [23 / 255, 16 / 255, 32 / 255],
  highlight: [247 / 255, 244 / 255, 250 / 255],
  colors: {
    idle: [185 / 255, 120 / 255, 242 / 255],
    scanning: [109 / 255, 168 / 255, 232 / 255],
    success: [85 / 255, 184 / 255, 122 / 255],
    danger: [225 / 255, 107 / 255, 120 / 255],
  },
};

function cssColorToRgb(variable: string, fallback: FlowBorderAppearance["background"]) {
  const rootStyle = window.getComputedStyle(document.documentElement);
  const value = rootStyle.getPropertyValue(variable).trim();
  if (!value || !document.body) return fallback;

  const probe = document.createElement("span");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.color = value;
  document.body.append(probe);
  const channels = window.getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  probe.remove();
  if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return fallback;
  return channels.map((channel) => channel / 255) as [number, number, number];
}

function readFlowBorderAppearance(): FlowBorderAppearance {
  const style = window.getComputedStyle(document.documentElement);
  const width = Number.parseFloat(style.getPropertyValue("--flow-border-width"));
  const opacity = Number.parseFloat(style.getPropertyValue("--flow-border-opacity"));
  return {
    enabled: Number.parseFloat(style.getPropertyValue("--flow-border-enabled")) !== 0,
    width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 8) : DEFAULT_APPEARANCE.width,
    opacity: Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : DEFAULT_APPEARANCE.opacity,
    background: cssColorToRgb("--flow-border-background", DEFAULT_APPEARANCE.background),
    highlight: cssColorToRgb("--flow-border-highlight", DEFAULT_APPEARANCE.highlight),
    colors: {
      idle: cssColorToRgb("--flow-border-idle", DEFAULT_APPEARANCE.colors.idle),
      scanning: cssColorToRgb("--flow-border-scanning", DEFAULT_APPEARANCE.colors.scanning),
      success: cssColorToRgb("--flow-border-success", DEFAULT_APPEARANCE.colors.success),
      danger: cssColorToRgb("--flow-border-danger", DEFAULT_APPEARANCE.colors.danger),
    },
  };
}

function supportsWorkerWebGl(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype
  );
}

export const FlowBorder = forwardRef<FlowBorderHandle, FlowBorderProps>(
  function FlowBorder({ onStats, onError }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const workerRef = useRef<Worker | null>(null);
    const runtimeRef = useRef<FlowBorderRuntime | null>(null);
    const cleanupTimerRef = useRef<number | null>(null);
    const [fallback, setFallback] = useState(false);

    const post = useCallback((message: FlowWorkerInbound): void => {
      workerRef.current?.postMessage(message);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        navigate(direction, depth) {
          post({ type: "navigate", direction, depth });
          if (fallback) {
            document.documentElement.dataset.flowDirection = direction;
          }
        },
        scroll(velocity) {
          post({ type: "scrollVelocity", velocity });
        },
        setState(state) {
          post({ type: "state", state });
          document.documentElement.dataset.flowState = state;
        },
      }),
      [fallback, post],
    );

    useEffect(() => {
      const scheduleDispose = () => {
        cleanupTimerRef.current = window.setTimeout(() => {
          runtimeRef.current?.dispose();
          runtimeRef.current = null;
          cleanupTimerRef.current = null;
        }, 0);
      };

      // Strict Mode replays effects without replacing the transferred canvas.
      if (runtimeRef.current) {
        if (cleanupTimerRef.current !== null) {
          window.clearTimeout(cleanupTimerRef.current);
          cleanupTimerRef.current = null;
        }
        return scheduleDispose;
      }

      const canvas = canvasRef.current;

      if (!canvas || !supportsWorkerWebGl()) {
        setFallback(true);
        onStats(FALLBACK_STATS);
        return;
      }

      let worker: Worker | null = null;

      try {
        const offscreen = canvas.transferControlToOffscreen();
        worker = new Worker(new URL("./flow-border.worker.ts", import.meta.url), {
          type: "module",
          name: "muller-flow-border",
        });
        workerRef.current = worker;

        worker.onmessage = ({ data }: MessageEvent<FlowWorkerOutbound>) => {
          if (data.type === "stats") {
            onStats(data.stats);
          } else if (data.type === "error") {
            onError(data.message);
            setFallback(true);
          }
        };

        worker.onerror = (event) => {
          onError(event.message || "Flow-border Worker failed");
          setFallback(true);
        };

        worker.postMessage(
          {
            type: "init",
            canvas: offscreen,
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
            reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches,
            appearance: readFlowBorderAppearance(),
          } satisfies FlowWorkerInbound,
          [offscreen],
        );

        const resize = () => {
          worker?.postMessage({
            type: "resize",
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
          } satisfies FlowWorkerInbound);
        };

        const visibility = () => {
          worker?.postMessage({
            type: "visibility",
            visible: document.visibilityState === "visible",
          } satisfies FlowWorkerInbound);
        };

        window.addEventListener("resize", resize, { passive: true });
        document.addEventListener("visibilitychange", visibility);

        runtimeRef.current = {
          dispose: () => {
            window.removeEventListener("resize", resize);
            document.removeEventListener("visibilitychange", visibility);
            worker?.terminate();
            workerRef.current = null;
          },
        };

        return scheduleDispose;
      } catch (error) {
        worker?.terminate();
        workerRef.current = null;
        setFallback(true);
        onStats(FALLBACK_STATS);
        onError(error instanceof Error ? error.message : "Unable to start flow border");
      }
    }, [onError, onStats]);

    useEffect(() => {
      let syncFrame: number | null = null;
      const syncAppearance = () => {
        if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
        syncFrame = window.requestAnimationFrame(() => {
          syncFrame = null;
          post({ type: "appearance", appearance: readFlowBorderAppearance() });
        });
      };
      const observer = new MutationObserver(syncAppearance);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style", "data-theme", "data-theme-source"],
      });
      syncAppearance();
      return () => {
        observer.disconnect();
        if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
      };
    }, [post]);

    return (
      <div className="flow-border" aria-hidden="true">
        <canvas
          className={fallback ? "flow-canvas is-hidden" : "flow-canvas"}
          ref={canvasRef}
          data-testid="flow-canvas"
        />
        {fallback ? <div className="flow-css-fallback" /> : null}
      </div>
    );
  },
);
