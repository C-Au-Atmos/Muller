import type {
  FlowVisualState,
  NavigationDirection,
} from "./protocol";

export interface FlowProfile {
  speed: number;
  segmentCount: number;
  segmentLength: number;
  intensity: number;
  color: readonly [number, number, number];
}

export interface ScrollTarget {
  direction: -1 | 1;
  speed: number;
}

const PROFILES: Record<FlowVisualState, FlowProfile> = {
  idle: {
    speed: 0.34,
    segmentCount: 4,
    segmentLength: 0.84,
    intensity: 0.72,
    color: [0.659, 0.333, 0.969],
  },
  scanning: {
    speed: 0.74,
    segmentCount: 4,
    segmentLength: 0.78,
    intensity: 0.98,
    color: [0.659, 0.333, 0.969],
  },
  success: {
    speed: 0.92,
    segmentCount: 4,
    segmentLength: 0.88,
    intensity: 1.05,
    color: [0.769, 0.769, 0.769],
  },
  danger: {
    speed: 0.16,
    segmentCount: 4,
    segmentLength: 0.82,
    intensity: 0.72,
    color: [0.82, 0.17, 0.24],
  },
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function profileForState(state: FlowVisualState): FlowProfile {
  return PROFILES[state];
}

export function directionForNavigation(
  direction: NavigationDirection,
): -1 | 1 {
  return direction === "enter" ? 1 : -1;
}

export function targetForScrollVelocity(velocity: number): ScrollTarget {
  const magnitude = Math.abs(Number.isFinite(velocity) ? velocity : 0);
  const normalized = clamp(magnitude / 2200, 0, 1);

  return {
    direction: velocity < 0 ? -1 : 1,
    speed: 0.34 + normalized * 1.55,
  };
}
