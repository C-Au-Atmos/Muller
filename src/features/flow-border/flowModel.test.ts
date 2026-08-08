import { describe, expect, it } from "vitest";

import {
  clamp,
  directionForNavigation,
  profileForState,
  targetForScrollVelocity,
} from "./flowModel";

describe("flow border model", () => {
  it("clamps values to an inclusive range", () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(3, 0, 1)).toBe(1);
  });

  it("maps navigation to clockwise and counter-clockwise directions", () => {
    expect(directionForNavigation("enter")).toBe(1);
    expect(directionForNavigation("back")).toBe(-1);
  });

  it("preserves scroll direction and bounds its speed", () => {
    expect(targetForScrollVelocity(900).direction).toBe(1);
    expect(targetForScrollVelocity(-900).direction).toBe(-1);
    expect(targetForScrollVelocity(0).speed).toBeCloseTo(0.34);
    expect(targetForScrollVelocity(100_000).speed).toBeCloseTo(1.89);
    expect(targetForScrollVelocity(Number.NaN)).toEqual({
      direction: 1,
      speed: 0.34,
    });
  });

  it("keeps four long-trail runners and accelerates them while scanning", () => {
    const idle = profileForState("idle");
    const scanning = profileForState("scanning");

    expect(scanning.segmentCount).toBe(4);
    expect(idle.segmentCount).toBe(4);
    expect(scanning.segmentLength).toBeGreaterThan(0.7);
    expect(scanning.speed).toBeGreaterThan(idle.speed);
    expect(scanning.intensity).toBeGreaterThan(idle.intensity);
  });
});
